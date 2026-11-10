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

test("index.html wires accounts", () => {
  const html = read("index.html");
  assert.match(html, /id="accountBtn"/);
  assert.match(html, /script-src 'self' https:\/\/cloud\.umami\.is https:\/\/cdn\.jsdelivr\.net/);
  assert.match(html, /supabase-js@2\.\d+\.\d+\/dist\/umd\/supabase\.js" integrity="sha384-/);
  assert.match(html, /sync-core\.js\?v=1\.25\.0/);
  assert.match(html, /auth\.js\?v=1\.25\.0/);
});

test("release 1.25.0 is consistent", () => {
  assert.match(read("app.js"), /const APP_VERSION = "1\.25\.0"/);
  assert.match(read("index.html"), /styles\.css\?v=1\.25\.0/);
  assert.match(read("README.md"), /version-1\.25\.0-blue/);
  assert.match(read("CHANGELOG.md"), /^## 1\.25\.0 — \d{4}-\d{2}-\d{2}/m);
});

test("privacy page exists and exposes no personal email", () => {
  const html = read("privacy.html");
  assert.match(html, /<title>Privacy/);
  assert.doesNotMatch(html, /@gmail\.com/);
  assert.match(html, /delete/i);
});
