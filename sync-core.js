"use strict";
// Account sync — pure logic, no DOM, no network. Runs in the browser (window.SyncCore)
// and under `node --test` (module.exports). auth.js injects the real I/O.
(function (root) {
  const PREFS_VERSION = 1;

  const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
  const isStrArray = (x) => Array.isArray(x) && x.every((s) => typeof s === "string");

  // A preferences object as produced by app.js buildPrefs(). Every field is optional,
  // but a present field must have the right shape.
  function isValidPrefs(x) {
    if (!isObj(x) || x.version !== PREFS_VERSION) return false;
    if ("followedNetworks" in x && x.followedNetworks !== null && !isStrArray(x.followedNetworks)) return false;
    if ("knownNetworks" in x && !isStrArray(x.knownNetworks)) return false;
    if ("favorites" in x && !isObj(x.favorites)) return false;
    if ("watchOverrides" in x && !isObj(x.watchOverrides)) return false;
    if ("theme" in x && x.theme !== undefined && x.theme !== "light" && x.theme !== "dark") return false;
    return true;
  }

  const union = (a, b) => [...new Set([...(a || []), ...(b || [])])];

  // Followed channels: null = never chosen on this device, [] = "show all" (a real choice
  // that still yields to a non-empty selection), otherwise the union.
  function mergeFollowed(local, remote) {
    if (local == null) return remote || [];
    if (remote == null) return local;
    if (local.length === 0) return remote;
    if (remote.length === 0) return local;
    return union(local, remote);
  }

  function mergePrefs(local, remote) {
    const l = local || {};
    if (!isValidPrefs(remote)) {
      return { ...l, app: "lineup", version: PREFS_VERSION, followedNetworks: l.followedNetworks || [] };
    }
    return {
      app: "lineup",
      version: PREFS_VERSION,
      exportedAt: new Date().toISOString(),
      theme: remote.theme || l.theme,
      followedNetworks: mergeFollowed(l.followedNetworks, remote.followedNetworks),
      knownNetworks: union(l.knownNetworks, remote.knownNetworks),
      favorites: { ...(l.favorites || {}), ...(remote.favorites || {}) },
      watchOverrides: { ...(l.watchOverrides || {}), ...(remote.watchOverrides || {}) },
    };
  }

  const MARKER_KEY = "tv:syncedUser";
  const PUSH_DEBOUNCE_MS = 1000;

  // The sync engine. All I/O is injected so it can be unit-tested without a browser:
  //   getLocal()            → prefs (followedNetworks may be null = never chosen here)
  //   applyLocal(prefs)     → write prefs into the app (silently)
  //   storage               → localStorage-like { getItem, setItem, removeItem }
  //   fetchRemote()         → Promise<{ data, updated_at } | null>
  //   pushRemote(prefs)     → Promise<void>
  //   onStatus(status)      → "idle" | "syncing" | "synced" | "error" | "offline"
  function createSync(deps) {
    const { getLocal, applyLocal, storage, fetchRemote, pushRemote, onStatus } = deps;
    const schedule = deps.setTimeout, unschedule = deps.clearTimeout;
    let signedIn = false;
    let timer = null;
    let dirty = false;
    let lastRemoteAt = null;

    const status = (s) => { if (onStatus) onStatus(s); };
    const remoteValid = (r) => !!(r && isValidPrefs(r.data));

    async function push(prefs) {
      status("syncing");
      try {
        await pushRemote(prefs);
        dirty = false;
        status("synced");
      } catch {
        dirty = true;
        status("error");
      }
    }

    async function onSignedIn(userId) {
      signedIn = true;
      status("syncing");
      let remote;
      try { remote = await fetchRemote(); }
      catch { status("offline"); return; }
      if (remote && remote.updated_at) lastRemoteAt = remote.updated_at;

      if (storage.getItem(MARKER_KEY) === userId) {
        // This device already met this account: the account is the source of truth.
        if (remoteValid(remote)) { applyLocal(remote.data); status("synced"); }
        else await push(mergePrefs(getLocal(), null));
        return;
      }
      // First time this account signs in here: merge, so nothing local is lost.
      const merged = mergePrefs(getLocal(), remoteValid(remote) ? remote.data : null);
      applyLocal(merged);
      await push(merged);
      storage.setItem(MARKER_KEY, userId);
    }

    function onSignedOut() {
      signedIn = false;
      if (timer !== null) { unschedule(timer); timer = null; }
      status("idle");
    }

    function onLocalChange() {
      if (!signedIn) return;
      dirty = true;
      if (timer !== null) unschedule(timer);
      timer = schedule(async () => { timer = null; await flush(); }, PUSH_DEBOUNCE_MS);
    }

    async function flush() {
      if (!signedIn || !dirty) return;
      if (timer !== null) { unschedule(timer); timer = null; }
      await push(getLocal());
    }

    async function onVisible() {
      if (!signedIn) return;
      let remote;
      try { remote = await fetchRemote(); }
      catch { status("offline"); return; }
      if (!remoteValid(remote)) return;
      if (lastRemoteAt && remote.updated_at && remote.updated_at <= lastRemoteAt) return;
      lastRemoteAt = remote.updated_at;
      applyLocal(remote.data);
      status("synced");
    }

    return { onSignedIn, onSignedOut, onLocalChange, onVisible, flush };
  }

  const api = { isValidPrefs, mergePrefs, createSync, MARKER_KEY };
  root.SyncCore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
