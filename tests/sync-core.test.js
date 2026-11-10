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
