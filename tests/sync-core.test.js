const test = require("node:test");
const assert = require("node:assert/strict");
const { mergePrefs, isValidPrefs } = require("../sync-core.js");

const L = (o) => ({
  app: "lineup", version: 1, theme: "dark",
  followedNetworks: ["HBO"], knownNetworks: ["HBO"],
  favorites: { "1": { id: 1, name: "A" } }, watchOverrides: { Max: "Canal+" },
  ...o,
});

test("invalid remote → local wins untouched", () => {
  const out = mergePrefs(L(), { version: 2 });
  assert.deepEqual(out.followedNetworks, ["HBO"]);
  assert.equal(isValidPrefs("nope"), false);
  assert.equal(isValidPrefs({ version: 1, favorites: [] }), false);
  assert.equal(isValidPrefs(L()), true);
});

test("invalid remote with never-written local → followed defaults to []", () => {
  assert.deepEqual(mergePrefs(L({ followedNetworks: null }), null).followedNetworks, []);
});

test("followed: never-written local defers to remote", () => {
  assert.deepEqual(mergePrefs(L({ followedNetworks: null }), L({ followedNetworks: ["BBC"] })).followedNetworks, ["BBC"]);
});

test("followed: empty means show-all and loses to a non-empty side", () => {
  assert.deepEqual(mergePrefs(L({ followedNetworks: [] }), L({ followedNetworks: ["BBC"] })).followedNetworks, ["BBC"]);
  assert.deepEqual(mergePrefs(L(), L({ followedNetworks: [] })).followedNetworks, ["HBO"]);
  assert.deepEqual(mergePrefs(L({ followedNetworks: [] }), L({ followedNetworks: [] })).followedNetworks, []);
});

test("union for followed/known/favorites, remote wins on override conflict, remote theme wins", () => {
  const out = mergePrefs(L(), L({
    followedNetworks: ["BBC"], knownNetworks: ["BBC"],
    favorites: { "2": { id: 2, name: "B" } }, watchOverrides: { Max: "Prime Video" }, theme: "light",
  }));
  assert.deepEqual([...out.followedNetworks].sort(), ["BBC", "HBO"]);
  assert.deepEqual([...out.knownNetworks].sort(), ["BBC", "HBO"]);
  assert.deepEqual(Object.keys(out.favorites).sort(), ["1", "2"]);
  assert.equal(out.watchOverrides.Max, "Prime Video");
  assert.equal(out.theme, "light");
  assert.equal(out.version, 1);
  assert.equal(out.app, "lineup");
});

test("theme falls back to local when remote has none", () => {
  assert.equal(mergePrefs(L(), L({ theme: undefined })).theme, "dark");
});

/* ---------- createSync ---------- */
const { createSync } = require("../sync-core.js");

function harness({ remote = null, pushFails = 0, fetchFails = false } = {}) {
  const store = new Map();
  const storage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const h = {
    storage, store, local: L(), applied: [], pushes: [], statuses: [], timers: [], remote, pushFails,
    fetchCalls: 0,
  };
  h.sync = createSync({
    getLocal: () => h.local,
    applyLocal: (p) => { h.applied.push(p); h.local = { ...p }; },
    storage,
    fetchRemote: async () => { h.fetchCalls++; if (fetchFails) throw new Error("net"); return h.remote; },
    pushRemote: async (p) => { if (h.pushFails > 0) { h.pushFails--; throw new Error("net"); } h.pushes.push(p); },
    now: () => 0,
    setTimeout: (fn, ms) => { h.timers.push({ fn, ms }); return h.timers.length; },
    clearTimeout: (id) => { if (h.timers[id - 1]) h.timers[id - 1].fn = null; },
    onStatus: (s) => h.statuses.push(s),
  });
  h.fire = async () => { const t = h.timers.pop(); if (t && t.fn) await t.fn(); };
  return h;
}
const R = (o, updated_at = "2026-11-10T10:00:00Z") => ({ data: L(o), updated_at });

test("first sign-in merges, applies, pushes and sets the marker", async () => {
  const h = harness({ remote: R({ followedNetworks: ["BBC"] }) });
  await h.sync.onSignedIn("u1");
  assert.equal(h.store.get("tv:syncedUser"), "u1");
  assert.deepEqual([...h.applied[0].followedNetworks].sort(), ["BBC", "HBO"]);
  assert.equal(h.pushes.length, 1);
  assert.equal(h.statuses.at(-1), "synced");
});

test("same user again: remote overwrites local, nothing pushed", async () => {
  const h = harness({ remote: R({ followedNetworks: ["BBC"], favorites: {} }) });
  h.store.set("tv:syncedUser", "u1");
  await h.sync.onSignedIn("u1");
  assert.deepEqual(h.applied[0].followedNetworks, ["BBC"]);
  assert.deepEqual(h.applied[0].favorites, {});
  assert.equal(h.pushes.length, 0);
});

test("same user again but no remote row: local is pushed as-is", async () => {
  const h = harness({ remote: null });
  h.store.set("tv:syncedUser", "u1");
  await h.sync.onSignedIn("u1");
  assert.equal(h.applied.length, 0);
  assert.equal(h.pushes.length, 1);
});

test("different user: merge runs again and marker switches", async () => {
  const h = harness({ remote: R({ followedNetworks: ["BBC"] }) });
  h.store.set("tv:syncedUser", "u1");
  await h.sync.onSignedIn("u2");
  assert.equal(h.store.get("tv:syncedUser"), "u2");
  assert.deepEqual([...h.applied[0].followedNetworks].sort(), ["BBC", "HBO"]);
});

test("empty remote on first sign-in pushes local as-is (followed null → [])", async () => {
  const h = harness({ remote: null });
  h.local = L({ followedNetworks: null });
  await h.sync.onSignedIn("u1");
  assert.equal(h.pushes.length, 1);
  assert.deepEqual(h.pushes[0].followedNetworks, []);
  assert.deepEqual(h.pushes[0].favorites, h.local.favorites);
});

test("corrupt remote data is ignored, local kept", async () => {
  const h = harness({ remote: { data: "garbage", updated_at: "x" } });
  await h.sync.onSignedIn("u1");
  assert.deepEqual(h.pushes[0].followedNetworks, ["HBO"]);
});

test("ten local changes → one push after 1000 ms", async () => {
  const h = harness();
  await h.sync.onSignedIn("u1");
  h.pushes.length = 0;
  for (let i = 0; i < 10; i++) h.sync.onLocalChange();
  assert.equal(h.timers.filter((t) => t.fn).length, 1);
  assert.equal(h.timers.at(-1).ms, 1000);
  await h.fire();
  assert.equal(h.pushes.length, 1);
});

test("local changes while signed out are ignored", () => {
  const h = harness();
  h.sync.onLocalChange();
  assert.equal(h.timers.length, 0);
});

test("failed push reports error and retries on next change", async () => {
  const h = harness();
  await h.sync.onSignedIn("u1");
  h.pushFails = 1;
  h.sync.onLocalChange();
  await h.fire();
  assert.equal(h.statuses.at(-1), "error");
  h.sync.onLocalChange();
  await h.fire();
  assert.equal(h.pushes.length, 2);
  assert.equal(h.statuses.at(-1), "synced");
});

test("flush pushes a pending change immediately", async () => {
  const h = harness();
  await h.sync.onSignedIn("u1");
  h.pushes.length = 0;
  h.sync.onLocalChange();
  await h.sync.flush();
  assert.equal(h.pushes.length, 1);
});

test("fetchRemote rejection reports offline and does not throw", async () => {
  const h = harness({ fetchFails: true });
  await h.sync.onSignedIn("u1");
  assert.equal(h.statuses.at(-1), "offline");
  assert.equal(h.store.has("tv:syncedUser"), false);
});

test("onVisible applies newer remote only", async () => {
  const h = harness({ remote: R({}, "2026-11-10T10:00:00Z") });
  await h.sync.onSignedIn("u1");
  h.applied.length = 0;
  await h.sync.onVisible();
  assert.equal(h.applied.length, 0);
  h.remote = R({ theme: "light" }, "2026-11-10T11:00:00Z");
  await h.sync.onVisible();
  assert.equal(h.applied.length, 1);
  assert.equal(h.applied[0].theme, "light");
});

test("onSignedOut stops pushes and keeps the marker", async () => {
  const h = harness();
  await h.sync.onSignedIn("u1");
  h.sync.onSignedOut();
  h.sync.onLocalChange();
  assert.equal(h.timers.filter((t) => t.fn).length, 0);
  assert.equal(h.store.get("tv:syncedUser"), "u1");
});
