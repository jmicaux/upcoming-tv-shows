const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const read = (f) => fs.readFileSync(__dirname + "/../" + f, "utf8");

test("app.js declares the sync hooks", () => {
  const src = read("app.js");
  assert.match(src, /function localPrefsForSync\(/);
  assert.match(src, /knownNetworks: \[\.\.\.state\.known\]/);
  assert.match(src, /new CustomEvent\("prefs:changed"\)/);
});
