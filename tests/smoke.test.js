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
  assert.match(html, /sync-core\.js\?v=1\.28\.3/);
  assert.match(html, /auth\.js\?v=1\.28\.3/);
});

test("release 1.26.0 is consistent", () => {
  assert.match(read("app.js"), /const APP_VERSION = "1\.28\.3"/);
  assert.match(read("index.html"), /styles\.css\?v=1\.28\.3/);
  assert.match(read("README.md"), /version-1\.28\.3-blue/);
  assert.match(read("CHANGELOG.md"), /^## 1\.28\.3 — \d{4}-\d{2}-\d{2}/m);
});

test("privacy page exists and exposes no personal email", () => {
  const html = read("privacy.html");
  assert.match(html, /<title>Privacy/);
  assert.doesNotMatch(html, /@gmail\.com/);
  assert.match(html, /delete/i);
});

test("applyPrefs respects a network/<slug> deep link and refetches new sources", () => {
  const fn = read("app.js").match(/function applyPrefs[\s\S]*?\n}\n/)[0];
  assert.match(fn, /parseRoute\(\)\.network/);
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

test("index.html generated regions are up to date (run node tools/make-pages.js)", () => {
  const { build } = require("../tools/make-pages.js");
  const files = build(read("index.html"));
  assert.equal(read("index.html"), files["index.html"], "index.html is stale");
  assert.ok(Object.keys(files).filter((f) => f.startsWith("network/")).length >= 80);
  assert.match(files["network/netflix.html"], /<title>Upcoming Netflix shows/);
  assert.match(files["network/netflix.html"], /<base href="\.\.\/">/);
  assert.match(files["network/netflix.html"], /canonical" href="https:\/\/jmicaux\.github\.io\/upcoming-tv-shows\/network\/netflix"/);
  assert.doesNotMatch(files["network/netflix.html"], /noindex/);
  assert.match(files["watchlist.html"], /noindex/);
  assert.match(files["404.html"], /<base href="\/upcoming-tv-shows\/">/);
});

test("network slugs round-trip", () => {
  const N = require("../networks.js");
  for (const n of N.SEED_NETWORKS) assert.equal(N.networkFromSegment(N.networkSegment(n)), n);
  assert.equal(N.networkSegment("Disney+"), "disney-plus");
  assert.equal(N.networkSegment("Some Rare Channel"), "Some%20Rare%20Channel");
  assert.equal(N.networkFromSegment("Some%20Rare%20Channel"), "Some Rare Channel");
});

test("routing: clean /watchlist path, no '#' left behind", () => {
  const src = read("app.js");
  assert.match(src, /const APP_BASE = new URL\("\.", document\.baseURI\)\.pathname/);
  assert.match(src, /navigate\(networkUrl\(name\)\)/);
  assert.match(src, /addEventListener\("popstate", \(\) => \{\s*if \(!el\.modal\.hidden\) \{ hideModal\(\); return; \}[^\n]*\n\s*applyRoute\(\);/);
  assert.doesNotMatch(src, /location\.hash = /);
  assert.match(read("auth.js"), /const redirectTo = location\.origin \+ APP_BASE/);
});

test("channel pages: every description tag and the JSON-LD agree", () => {
  const html = require("../tools/make-pages.js").build(read("index.html"))["network/netflix.html"];
  const descs = [
    html.match(/<meta name="description" content="([^"]+)"/)[1],
    html.match(/<meta property="og:description" content="([^"]+)"/)[1],
    html.match(/<meta name="twitter:description" content="([^"]+)"/)[1],
    JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]).description,
  ];
  assert.equal(new Set(descs).size, 1, descs.join("\n"));
  assert.match(descs[0], /Netflix/);
  assert.equal(JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]).url,
    "https://jmicaux.github.io/upcoming-tv-shows/network/netflix");
});

test("SITE_META matches index.html (used when navigating back to the feed)", () => {
  const { SITE_META } = require("../networks.js");
  const html = read("index.html");
  assert.match(html, new RegExp(`<title>${SITE_META.title}</title>`));
  assert.ok(html.includes(`<meta name="description" content="${SITE_META.description}">`));
  assert.ok(html.includes(`<meta property="og:description" content="${SITE_META.description}">`));
  assert.ok(html.includes(`<meta name="twitter:description" content="${SITE_META.twitterDescription}">`));
  assert.ok(html.includes(`<link rel="canonical" href="${SITE_META.url}">`));
});

test("unknown addresses render a not-found view; noindex follows the view", () => {
  const src = read("app.js");
  assert.match(src, /return \{ view: "notfound", network: null \}/);
  assert.match(src, /function renderNotFound\(/);
  assert.match(src, /const indexable = view === "month" && \(!network \|\| SEED_NETWORKS\.includes\(network\)\)/);
  assert.match(src, /if \(indexable && robots\) robots\.remove\(\)/);
});

test("index.html: no empty button, every form field labelled (WAVE errors)", () => {
  const html = read("index.html");
  assert.doesNotMatch(html, /<button[^>]*>\s*<\/button>/, "empty button");
  for (const input of html.match(/<input\b[^>]*>/g)) {
    const id = (input.match(/id="([^"]+)"/) || [])[1];
    const labelled = /aria-label="[^"]+"|aria-labelledby=/.test(input) || (id && html.includes(`for="${id}"`)) ||
      // wrapped in a <label>
      new RegExp(`<label[^>]*>\\s*${input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(html);
    assert.ok(labelled, "unlabelled: " + input);
  }
});

test("cards: no role=button wrapper, decorative posters, named controls", () => {
  const src = read("app.js");
  assert.doesNotMatch(src, /<article class="card[^\n]*role="button"/);
  assert.match(src, /class="card-img" loading="lazy" src="[^"]*" alt=""/);
  assert.match(src, /class="sr-only">: \$\{escapeHtml\(title\)\} \(opens in a new tab\)/);
  assert.match(src, /const label = `Add \$\{/);
});

test("styles: no text smaller than 0.75rem (12px, WAVE 'very small text')", () => {
  const sizes = [...read("styles.css").matchAll(/font-size:\s*([\d.]+)rem/g)].map((m) => Number(m[1]));
  assert.deepEqual(sizes.filter((n) => n < 0.75), []);
});

test("static pages: skip link, header, footer up to date (run node tools/make-pages.js)", () => {
  const { fillStatic, STATIC_PAGES } = require("../tools/make-pages.js");
  for (const rel of STATIC_PAGES) {
    const html = read(rel);
    assert.equal(html, fillStatic(html), rel + " footer is stale");
    assert.match(html, /<a class="skip-link" href="#content">/, rel);
    assert.match(html, /<main class="page" id="content"/, rel);
    assert.match(html, /<footer class="site-footer">[\s\S]*Upcoming shows by channel/, rel);
  }
});
