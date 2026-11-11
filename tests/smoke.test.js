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
  assert.match(html, /sync-core\.js\?v=1\.26\.0/);
  assert.match(html, /auth\.js\?v=1\.26\.0/);
});

test("release 1.26.0 is consistent", () => {
  assert.match(read("app.js"), /const APP_VERSION = "1\.26\.0"/);
  assert.match(read("index.html"), /styles\.css\?v=1\.26\.0/);
  assert.match(read("README.md"), /version-1\.26\.0-blue/);
  assert.match(read("CHANGELOG.md"), /^## 1\.26\.0 — \d{4}-\d{2}-\d{2}/m);
});

test("privacy page exists and exposes no personal email", () => {
  const html = read("privacy.html");
  assert.match(html, /<title>Privacy/);
  assert.doesNotMatch(html, /@gmail\.com/);
  assert.match(html, /delete/i);
});

test("applyPrefs respects a #network= deep link and refetches new sources", () => {
  const fn = read("app.js").match(/function applyPrefs[\s\S]*?\n}\n/)[0];
  assert.match(fn, /parseHash\(\)\.network/);
  assert.match(fn, /neededSources\(state\.followed\)/);
  assert.match(fn, /try \{[\s\S]*finally \{\s*applyingPrefs = false/);
});

test("scripts are deferred so a slow CDN cannot block the app", () => {
  const html = read("index.html");
  for (const f of ["supabase-config.js", "sync-core.js", "config.js", "app.js", "auth.js"]) {
    assert.match(html, new RegExp(`<script defer src="${f.replace(".", "\\.")}`), f);
  }
  assert.match(html, /<script defer src="https:\/\/cdn\.jsdelivr\.net/);
});

test("auth.js restores focus after re-render, toasts on sync error and labels the sync state", () => {
  const src = read("auth.js");
  assert.match(src, /function focusAccountDialog/);
  assert.match(src, /toast\("Sync failed/);
  assert.match(src, /accountBtn\.setAttribute\("aria-label"/);
});

test("README dev server port matches the documented redirect URL", () => {
  const md = read("README.md");
  const port = md.match(/http\.server (\d+)/)[1];
  assert.match(md, new RegExp(`http://localhost:${port}/`));
  assert.doesNotMatch(md, /localhost:8080/);
});

test("watchlist.html is index.html + noindex (run node tools/make-watchlist.js)", () => {
  const { build } = require("../tools/make-watchlist.js");
  assert.equal(read("watchlist.html"), build(read("index.html")));
});

test("routing: clean /watchlist path, no '#' left behind", () => {
  const src = read("app.js");
  assert.match(src, /const APP_BASE = /);
  assert.match(src, /addEventListener\("popstate", applyRoute\)/);
  assert.doesNotMatch(src, /location\.hash = /);
  assert.match(read("auth.js"), /const redirectTo = location\.origin \+ APP_BASE/);
});
