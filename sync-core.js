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

  const api = { isValidPrefs, mergePrefs };
  root.SyncCore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
