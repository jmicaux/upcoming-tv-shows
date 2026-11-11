const test = require("node:test");
const assert = require("node:assert/strict");
const { mergePrefs, isValidPrefs, createSync, STATE_KEY } = require("../sync-core.js");

const L = (o) => ({
  app: "lineup", version: 1, theme: "dark",
  followedNetworks: ["HBO"], knownNetworks: ["HBO"],
  favorites: { "1": { id: 1, name: "A" } }, watchOverrides: { Max: "Canal+" },
  ...o,
});
const fav = (...ids) => Object.fromEntries(ids.map((i) => [String(i), { id: i, name: "S" + i }]));
const keys = (o) => Object.keys(o).sort();

/* ---------- mergePrefs: legacy data (no clock) keeps the union behaviour ---------- */

test("invalid remote → local wins untouched", () => {
  const out = mergePrefs(L(), { version: 2 });
  assert.deepEqual(out.followedNetworks, ["HBO"]);
  assert.equal(isValidPrefs("nope"), false);
  assert.equal(isValidPrefs({ version: 1, favorites: [] }), false);
  assert.equal(isValidPrefs({ version: 1, clock: [] }), false);
  assert.equal(isValidPrefs(L()), true);
});

test("followed: null (never chosen) defers to the other side", () => {
  assert.equal(mergePrefs(L({ followedNetworks: null }), null).followedNetworks, null);
  assert.equal(mergePrefs(L({ followedNetworks: null }), L({ followedNetworks: null })).followedNetworks, null);
  assert.deepEqual(mergePrefs(L({ followedNetworks: null }), L({ followedNetworks: ["BBC"] })).followedNetworks, ["BBC"]);
  assert.deepEqual(mergePrefs(L(), L({ followedNetworks: null })).followedNetworks, ["HBO"]);
});

test("followed: legacy empty selection loses to a non-empty side", () => {
  assert.deepEqual(mergePrefs(L({ followedNetworks: [] }), L({ followedNetworks: ["BBC"] })).followedNetworks, ["BBC"]);
  assert.deepEqual(mergePrefs(L({ followedNetworks: [] }), L({ followedNetworks: [] })).followedNetworks, []);
});

test("legacy: union for followed/known/favorites, remote wins on override conflict and theme", () => {
  const out = mergePrefs(L(), L({
    followedNetworks: ["BBC"], knownNetworks: ["BBC"],
    favorites: fav(2), watchOverrides: { Max: "Prime Video" }, theme: "light",
  }));
  assert.deepEqual([...out.followedNetworks].sort(), ["BBC", "HBO"]);
  assert.deepEqual([...out.knownNetworks].sort(), ["BBC", "HBO"]);
  assert.deepEqual(keys(out.favorites), ["1", "2"]);
  assert.equal(out.watchOverrides.Max, "Prime Video");
  assert.equal(out.theme, "light");
  assert.equal(mergePrefs(L(), L({ theme: undefined })).theme, "dark");
});

/* ---------- mergePrefs: per-item clocks, the newest change wins ---------- */

test("a newer removal beats an older presence, on either side", () => {
  const local = L({ favorites: fav(1), clock: { favorites: { "2": 200 } } });   // removed 2 at t=200
  const remote = L({ favorites: fav(1, 2), clock: { favorites: { "2": 100 } } }); // added 2 at t=100
  assert.deepEqual(keys(mergePrefs(local, remote).favorites), ["1"]);
  assert.deepEqual(keys(mergePrefs(remote, local).favorites), ["1"]);
  assert.equal(mergePrefs(local, remote).clock.favorites["2"], 200);
});

test("a newer addition beats an older removal", () => {
  const local = L({ favorites: fav(1, 2), clock: { favorites: { "2": 300 } } });
  const remote = L({ favorites: fav(1), clock: { favorites: { "2": 200 } } });
  assert.deepEqual(keys(mergePrefs(local, remote).favorites), ["1", "2"]);
});

test("clocks also govern followed channels, overrides and theme", () => {
  const local = L({
    followedNetworks: ["HBO"], watchOverrides: {}, theme: "dark",
    clock: { followedNetworks: { BBC: 50 }, watchOverrides: { Max: 90 }, theme: 10 },
  });
  const remote = L({
    followedNetworks: ["HBO", "BBC"], watchOverrides: { Max: "Prime Video" }, theme: "light",
    clock: { followedNetworks: { BBC: 40 }, watchOverrides: { Max: 80 }, theme: 20 },
  });
  const out = mergePrefs(local, remote);
  assert.deepEqual(out.followedNetworks, ["HBO"]);  // BBC unfollowed after it was followed
  assert.deepEqual(out.watchOverrides, {});          // override removed after it was set
  assert.equal(out.theme, "light");                  // remote theme change is newer
});

/* ---------- createSync ---------- */

// A fake account row shared by any number of devices (browser tabs on different origins).
function cloud() {
  return { row: null, t: Date.parse("2026-11-11T12:00:00Z") };
}
function device(c, { local = L(), pushFails = 0, fetchFails = false } = {}) {
  const store = new Map();
  const storage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const d = { store, local, applied: [], pushes: [], statuses: [], timers: [], pushFails, fetchFails, fetchCalls: 0 };
  const copy = (x) => JSON.parse(JSON.stringify(x));
  d.sync = createSync({
    getLocal: () => copy(d.local),
    // Like app.js applyPrefs(): a null followedNetworks leaves the local selection alone.
    applyLocal: (p) => {
      d.applied.push(copy(p));
      const next = { ...d.local, ...copy(p) };
      if (!Array.isArray(p.followedNetworks)) next.followedNetworks = d.local.followedNetworks;
      delete next.clock;
      d.local = next;
    },
    storage,
    fetchRemote: async () => { d.fetchCalls++; if (d.fetchFails) throw new Error("net"); return c.row && copy(c.row); },
    pushRemote: async (p, at) => {
      if (d.pushFails > 0) { d.pushFails--; throw new Error("net"); }
      d.pushes.push(copy(p));
      c.row = { data: copy(p), updated_at: at };
    },
    now: () => ++c.t,
    setTimeout: (fn, ms) => { d.timers.push({ fn, ms }); return d.timers.length; },
    clearTimeout: (id) => { if (d.timers[id - 1]) d.timers[id - 1].fn = null; },
    onStatus: (s) => d.statuses.push(s),
  });
  d.fire = async () => { const t = d.timers.pop(); if (t && t.fn) await t.fn(); };
  d.change = async (patch) => { d.local = { ...d.local, ...patch }; d.sync.onLocalChange(); await d.fire(); };
  return d;
}

test("first sign-in merges local and account, applies and pushes", async () => {
  const c = cloud();
  c.row = { data: L({ followedNetworks: ["BBC"], favorites: fav(9) }), updated_at: "2026-11-11T10:00:00Z" };
  const d = device(c);
  await d.sync.onSignedIn("u1");
  assert.deepEqual([...d.local.followedNetworks].sort(), ["BBC", "HBO"]);
  assert.deepEqual(keys(d.local.favorites), ["1", "9"]);
  assert.deepEqual(keys(c.row.data.favorites), ["1", "9"]);
  assert.equal(d.statuses.at(-1), "synced");
});

test("REGRESSION: a stale tab can no longer wipe favorites merged by another device", async () => {
  const c = cloud();
  const lh = device(c, { local: L({ favorites: fav(1, 2) }) });
  await lh.sync.onSignedIn("u1");
  const prod = device(c, { local: L({ favorites: fav(...Array.from({ length: 52 }, (_, i) => 100 + i)) }) });
  await prod.sync.onSignedIn("u1");
  assert.equal(Object.keys(c.row.data.favorites).length, 54);

  // The localhost tab never saw the merge, then a favorite is added there.
  await lh.change({ favorites: fav(1, 2, 3) });
  assert.equal(Object.keys(c.row.data.favorites).length, 55);

  await prod.sync.onVisible();
  assert.equal(Object.keys(prod.local.favorites).length, 55);
});

test("REGRESSION: favorites added while signed out survive the next sign-in", async () => {
  const c = cloud();
  const d = device(c, { local: L({ favorites: fav(1) }) });
  await d.sync.onSignedIn("u1");
  d.sync.onSignedOut();
  d.local = { ...d.local, favorites: fav(1, 2, 3) };
  d.sync.onLocalChange();
  await d.sync.onSignedIn("u1");
  assert.deepEqual(keys(d.local.favorites), ["1", "2", "3"]);
  assert.deepEqual(keys(c.row.data.favorites), ["1", "2", "3"]);
});

test("a removal on one device propagates to the others", async () => {
  const c = cloud();
  const a = device(c, { local: L({ favorites: fav(1, 2) }) });
  const b = device(c, { local: L({ favorites: fav(1, 2) }) });
  await a.sync.onSignedIn("u1");
  await b.sync.onSignedIn("u1");
  await a.change({ favorites: fav(1) });
  await b.sync.onVisible();
  assert.deepEqual(keys(b.local.favorites), ["1"]);
  // ...and b's stale copy does not resurrect it on its next push.
  await b.change({ theme: "light" });
  assert.deepEqual(keys(c.row.data.favorites), ["1"]);
});

test("a removal made while signed out is kept at the next sign-in", async () => {
  const c = cloud();
  const d = device(c, { local: L({ favorites: fav(1, 2) }) });
  await d.sync.onSignedIn("u1");
  d.sync.onSignedOut();
  d.local = { ...d.local, favorites: fav(1) };
  d.sync.onLocalChange();
  await d.sync.onSignedIn("u1");
  assert.deepEqual(keys(c.row.data.favorites), ["1"]);
});

test("never-chosen channels stay null through sign-in", async () => {
  const c = cloud();
  const d = device(c, { local: L({ followedNetworks: null }) });
  await d.sync.onSignedIn("u1");
  assert.equal(c.row.data.followedNetworks, null);
  assert.equal(d.local.followedNetworks, null);
});

test("corrupt remote data is ignored, local kept", async () => {
  const c = cloud();
  c.row = { data: "garbage", updated_at: "x" };
  const d = device(c);
  await d.sync.onSignedIn("u1");
  assert.deepEqual(d.pushes[0].followedNetworks, ["HBO"]);
});

test("nothing is pushed when the account already matches", async () => {
  const c = cloud();
  const d = device(c);
  await d.sync.onSignedIn("u1");
  d.pushes.length = 0;
  const other = device(c);
  await other.sync.onSignedIn("u1");
  assert.equal(other.pushes.length, 0);
});

test("ten local changes → one push after 1000 ms", async () => {
  const c = cloud();
  const d = device(c);
  await d.sync.onSignedIn("u1");
  d.pushes.length = 0;
  for (let i = 0; i < 10; i++) { d.local = { ...d.local, favorites: fav(1, 50 + i) }; d.sync.onLocalChange(); }
  assert.equal(d.timers.filter((t) => t.fn).length, 1);
  assert.equal(d.timers.at(-1).ms, 1000);
  await d.fire();
  assert.equal(d.pushes.length, 1);
});

test("local changes while signed out schedule nothing", () => {
  const d = device(cloud());
  d.sync.onLocalChange();
  assert.equal(d.timers.length, 0);
});

test("failed push reports error and retries on next change", async () => {
  const c = cloud();
  const d = device(c);
  await d.sync.onSignedIn("u1");
  d.pushFails = 1;
  await d.change({ favorites: fav(1, 2) });
  assert.equal(d.statuses.at(-1), "error");
  await d.change({ favorites: fav(1, 2, 3) });
  assert.deepEqual(keys(c.row.data.favorites), ["1", "2", "3"]);
  assert.equal(d.statuses.at(-1), "synced");
});

test("flush pushes a pending change immediately", async () => {
  const c = cloud();
  const d = device(c);
  await d.sync.onSignedIn("u1");
  d.pushes.length = 0;
  d.local = { ...d.local, favorites: fav(1, 2) };
  d.sync.onLocalChange();
  await d.sync.flush();
  assert.equal(d.pushes.length, 1);
});

test("fetchRemote rejection reports offline; onVisible retries and merges", async () => {
  const c = cloud();
  const d = device(c, { fetchFails: true });
  await d.sync.onSignedIn("u1");
  assert.equal(d.statuses.at(-1), "offline");
  d.local = { ...d.local, favorites: fav(1, 2) };
  d.sync.onLocalChange();
  await d.fire();
  assert.equal(d.pushes.length, 0, "no push before the first merge");
  d.fetchFails = false;
  c.row = { data: L({ favorites: fav(9) }), updated_at: "2026-11-11T10:00:00Z" };
  await d.sync.onVisible();
  assert.deepEqual(keys(c.row.data.favorites), ["1", "2", "9"]);
});

test("onVisible does not re-apply our own push", async () => {
  const c = cloud();
  const d = device(c);
  await d.sync.onSignedIn("u1");
  await d.change({ favorites: fav(1, 2) });
  d.applied.length = 0;
  await d.sync.onVisible();
  assert.equal(d.applied.length, 0);
});

test("sync state is kept under its own storage key", async () => {
  const c = cloud();
  const d = device(c);
  await d.sync.onSignedIn("u1");
  assert.ok(d.store.has(STATE_KEY));
});
