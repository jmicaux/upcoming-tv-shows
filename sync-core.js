"use strict";
// Account sync — pure logic, no DOM, no network. Runs in the browser (window.SyncCore)
// and under `node --test` (module.exports). auth.js injects the real I/O.
//
// Model: every device keeps a per-item clock (time of the last add, change or removal of
// each favorite, followed channel and watch redirect, plus the theme). Merging two sides
// keeps, for each item, the side that changed it last. Every push is fetch → merge → push,
// so a device holding stale data can never wipe what another device added.
(function (root) {
  const PREFS_VERSION = 1;
  const COLLECTIONS = ["favorites", "followedNetworks", "watchOverrides"];

  const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
  const isStrArray = (x) => Array.isArray(x) && x.every((s) => typeof s === "string");

  // A preferences object as produced by app.js buildPrefs(), optionally with a `clock`.
  function isValidPrefs(x) {
    if (!isObj(x) || x.version !== PREFS_VERSION) return false;
    if ("followedNetworks" in x && x.followedNetworks !== null && !isStrArray(x.followedNetworks)) return false;
    if ("knownNetworks" in x && !isStrArray(x.knownNetworks)) return false;
    if ("favorites" in x && !isObj(x.favorites)) return false;
    if ("watchOverrides" in x && !isObj(x.watchOverrides)) return false;
    if ("theme" in x && x.theme !== undefined && x.theme !== "light" && x.theme !== "dark") return false;
    if ("clock" in x && x.clock !== undefined && !isObj(x.clock)) return false;
    return true;
  }

  const union = (a, b) => [...new Set([...(a || []), ...(b || [])])];
  const asMap = (list) => (list == null ? null : Object.fromEntries(list.map((n) => [n, true])));
  const clockOf = (p, name) => (p && isObj(p.clock) && isObj(p.clock[name]) ? p.clock[name] : {});

  // Per-key merge. The side with the newer clock entry decides presence and value; with no
  // clock on either side (legacy data) an item present anywhere is kept, remote value first.
  function mergeMap(lMap, rMap, lClock, rClock) {
    const out = {}, clock = {};
    const all = new Set([...Object.keys(lMap), ...Object.keys(rMap), ...Object.keys(lClock), ...Object.keys(rClock)]);
    for (const k of all) {
      const lt = Number(lClock[k]) || 0, rt = Number(rClock[k]) || 0;
      if (lt || rt) clock[k] = Math.max(lt, rt);
      if (lt > rt) { if (k in lMap) out[k] = lMap[k]; }
      else if (rt > lt) { if (k in rMap) out[k] = rMap[k]; }
      else if (k in rMap) out[k] = rMap[k];
      else if (k in lMap) out[k] = lMap[k];
    }
    return { out, clock };
  }

  function mergePrefs(local, remote) {
    const l = local || {};
    if (!isValidPrefs(remote)) {
      return { ...l, app: "lineup", version: PREFS_VERSION, followedNetworks: l.followedNetworks == null ? null : l.followedNetworks };
    }
    const r = remote;
    const clock = {};

    const fav = mergeMap(l.favorites || {}, r.favorites || {}, clockOf(l, "favorites"), clockOf(r, "favorites"));
    const ovr = mergeMap(l.watchOverrides || {}, r.watchOverrides || {}, clockOf(l, "watchOverrides"), clockOf(r, "watchOverrides"));
    clock.favorites = fav.clock;
    clock.watchOverrides = ovr.clock;

    // Followed channels: null = never chosen on that side (the app keeps its curated
    // defaults there), so it defers to the other side.
    let followed;
    const lf = asMap(l.followedNetworks), rf = asMap(r.followedNetworks);
    const lfc = clockOf(l, "followedNetworks"), rfc = clockOf(r, "followedNetworks");
    if (lf == null && rf == null) { followed = null; clock.followedNetworks = { ...lfc, ...rfc }; }
    else if (lf == null) { followed = r.followedNetworks; clock.followedNetworks = rfc; }
    else if (rf == null) { followed = l.followedNetworks; clock.followedNetworks = lfc; }
    else {
      const m = mergeMap(lf, rf, lfc, rfc);
      followed = Object.keys(m.out);
      clock.followedNetworks = m.clock;
    }

    const lt = Number(l.clock && l.clock.theme) || 0, rt = Number(r.clock && r.clock.theme) || 0;
    const theme = lt > rt ? (l.theme || r.theme) : (r.theme || l.theme);
    if (lt || rt) clock.theme = Math.max(lt, rt);

    return {
      app: "lineup",
      version: PREFS_VERSION,
      exportedAt: new Date().toISOString(),
      theme,
      followedNetworks: followed,
      knownNetworks: union(l.knownNetworks, r.knownNetworks),
      favorites: fav.out,
      watchOverrides: ovr.out,
      clock,
    };
  }

  // Order-independent fingerprint of the synced content, to skip no-op applies and pushes.
  function fingerprint(p) {
    if (!isObj(p)) return "";
    const sortObj = (o) => Object.keys(o || {}).sort().map((k) => [k, o[k]]);
    return JSON.stringify([
      p.theme || null,
      p.followedNetworks == null ? null : [...p.followedNetworks].sort(),
      [...(p.knownNetworks || [])].sort(),
      Object.keys(p.favorites || {}).sort(),
      sortObj(p.watchOverrides),
      COLLECTIONS.map((c) => sortObj(clockOf(p, c))),
      (p.clock && p.clock.theme) || 0,
    ]);
  }

  const MARKER_KEY = "tv:syncedUser";
  const STATE_KEY = "tv:syncState";     // { clock, snap }: this device's clocks + last seen prefs
  const LEGACY_PENDING_KEY = "tv:syncPending";
  const PUSH_DEBOUNCE_MS = 1000;

  // The sync engine. All I/O is injected so it can be unit-tested without a browser:
  //   getLocal()            → prefs (followedNetworks may be null = never chosen here)
  //   applyLocal(prefs)     → write prefs into the app (silently)
  //   storage               → localStorage-like { getItem, setItem, removeItem }
  //   fetchRemote()         → Promise<{ data, updated_at } | null>
  //   pushRemote(prefs, updatedAt) → Promise<void>  (updatedAt: ISO string to store with the row)
  //   now()                 → ms timestamp
  //   onStatus(status)      → "idle" | "syncing" | "synced" | "error" | "offline"
  function createSync(deps) {
    const { getLocal, applyLocal, storage, fetchRemote, pushRemote, onStatus } = deps;
    const schedule = deps.setTimeout, unschedule = deps.clearTimeout;
    let signedIn = false;
    let ready = false;     // a first fetch+merge succeeded for this sign-in; pushes allowed
    let timer = null;
    let dirty = false;
    let lastRemoteAt = null;
    let running = Promise.resolve();
    let currentUser = null;

    const status = (s) => { if (onStatus) onStatus(s); };
    const remoteValid = (r) => !!(r && isValidPrefs(r.data));
    try { storage.removeItem(LEGACY_PENDING_KEY); } catch (_) { /* ignore */ }

    /* ----- per-device clock ----- */
    function loadState() {
      try {
        const s = JSON.parse(storage.getItem(STATE_KEY));
        if (isObj(s) && isObj(s.clock) && isObj(s.snap)) return s;
      } catch (_) { /* fall through */ }
      return null;
    }
    function saveState(s) {
      try { storage.setItem(STATE_KEY, JSON.stringify(s)); } catch (_) { /* quota: clocks are best effort */ }
    }
    const snapshot = (p) => ({
      favorites: Object.keys(p.favorites || {}),
      followedNetworks: p.followedNetworks == null ? null : [...p.followedNetworks],
      watchOverrides: { ...(p.watchOverrides || {}) },
      theme: p.theme || null,
    });

    // Record the time of every local change since the last snapshot, including removals.
    function stamp() {
      const cur = getLocal();
      const st = loadState();
      if (!st) { saveState({ clock: {}, snap: snapshot(cur) }); return; } // first run: legacy items, no clock
      const t = deps.now();
      const prev = st.snap, next = snapshot(cur), clock = st.clock;
      const bump = (name, k) => { (clock[name] = isObj(clock[name]) ? clock[name] : {})[k] = t; };

      const pf = new Set(prev.favorites), nf = new Set(next.favorites);
      for (const k of new Set([...pf, ...nf])) if (pf.has(k) !== nf.has(k)) bump("favorites", k);

      if (next.followedNetworks != null) {
        const pn = new Set(prev.followedNetworks || []), nn = new Set(next.followedNetworks);
        if (prev.followedNetworks == null) nn.forEach((k) => bump("followedNetworks", k));
        else for (const k of new Set([...pn, ...nn])) if (pn.has(k) !== nn.has(k)) bump("followedNetworks", k);
      }

      const po = prev.watchOverrides || {}, no = next.watchOverrides;
      for (const k of new Set([...Object.keys(po), ...Object.keys(no)])) if (po[k] !== no[k]) bump("watchOverrides", k);

      if ((prev.theme || null) !== next.theme) clock.theme = t;
      saveState({ clock, snap: next });
    }
    function localWithClock() {
      stamp();
      return { ...getLocal(), clock: (loadState() || { clock: {} }).clock };
    }

    async function push(prefs) {
      status("syncing");
      const at = new Date(deps.now()).toISOString();
      try {
        await pushRemote(prefs, at);
        dirty = false;
        lastRemoteAt = at; // what the row now holds; onVisible must not re-apply our own push
        status("synced");
        return true;
      } catch {
        dirty = true;
        status("error");
        return false;
      }
    }

    // fetch → merge → apply locally if it changed → push if the account differs.
    async function reconcile(prefetched) {
      status("syncing");
      let remote = prefetched;
      if (remote === undefined) {
        try { remote = await fetchRemote(); }
        catch { status("offline"); return false; }
      }
      const valid = remoteValid(remote);
      const local = localWithClock();
      const merged = mergePrefs(local, valid ? remote.data : null);
      if (!merged.clock) merged.clock = local.clock;

      if (fingerprint(merged) !== fingerprint(local)) applyLocal(merged);
      saveState({ clock: merged.clock, snap: snapshot(getLocal()) });

      if (valid && fingerprint(merged) === fingerprint(remote.data)) {
        if (remote.updated_at) lastRemoteAt = remote.updated_at;
        dirty = false;
        status("synced");
        return true;
      }
      return push(merged);
    }
    const serial = (fn) => (running = running.then(fn, fn));

    async function onSignedIn(userId) {
      signedIn = true;
      ready = false;
      currentUser = userId;
      return serial(async () => {
        if (!signedIn) return;
        if (await reconcile() !== false || dirty) ready = true;
        if (ready) storage.setItem(MARKER_KEY, userId);
      });
    }

    function onSignedOut() {
      signedIn = false;
      ready = false;
      if (timer !== null) { unschedule(timer); timer = null; }
      status("idle");
    }

    function onLocalChange() {
      stamp(); // also while signed out, so the change wins over older data at next sign-in
      if (!signedIn) return;
      dirty = true;
      if (!ready) return; // merged by the retried sign-in
      if (timer !== null) unschedule(timer);
      timer = schedule(async () => { timer = null; await flush(); }, PUSH_DEBOUNCE_MS);
    }

    async function flush() {
      if (!signedIn || !ready || !dirty) return;
      if (timer !== null) { unschedule(timer); timer = null; }
      await serial(() => reconcile());
    }

    async function onVisible() {
      if (!signedIn) return;
      if (!ready) return onSignedIn(currentUser);
      await serial(async () => {
        let remote;
        try { remote = await fetchRemote(); }
        catch { status("offline"); return; }
        const newer = remoteValid(remote) && !(lastRemoteAt && remote.updated_at && remote.updated_at <= lastRemoteAt);
        if (newer || dirty) await reconcile(remote);
      });
    }

    return { onSignedIn, onSignedOut, onLocalChange, onVisible, flush };
  }

  const api = { isValidPrefs, mergePrefs, createSync, MARKER_KEY, STATE_KEY };
  root.SyncCore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
