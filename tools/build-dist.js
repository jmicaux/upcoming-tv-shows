// Assembles dist/: everything a web server needs to host the site, and nothing else
// (allow-list: never the repo's notes, tests, tools, secrets or stray local files).
//   node tools/build-dist.js                      pages without schedule data
//   node tools/build-dist.js --data data/schedule pages with the upcoming shows baked in,
//                                                 plus the snapshot the app reads
// Used by .github/workflows/pages.yml, so a local dist/ is what GitHub Pages serves.
// config.js (local TMDB key) is never copied: the app works without it.
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const root = path.join(__dirname, "..");
const dist = path.join(root, "dist");

const FILES = [
  "index.html", "watchlist.html", "404.html", "about.html", "privacy.html", "accessibility.html",
  "app.js", "auth.js", "sync-core.js", "networks.js", "feed-core.js", "supabase-config.js", "theme.js",
  "styles.css", "og-image.png", "sitemap.xml",
];
const DIRS = ["network", "country"];

const i = process.argv.indexOf("--data");
const dataDir = i > -1 ? path.resolve(process.argv[i + 1]) : null;
if (dataDir && !fs.existsSync(path.join(dataDir, "index.json"))) throw new Error(`no snapshot in ${dataDir}`);

// Regenerate the pages first, so dist/ never ships stale ones.
execFileSync(process.execPath, [path.join(__dirname, "make-pages.js"), ...(dataDir ? ["--data", dataDir] : [])], { stdio: "inherit" });

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist);
const verification = fs.readdirSync(root).filter((f) => /^google[0-9a-f]+\.html$/.test(f)); // Search Console
for (const f of [...FILES, ...verification]) fs.copyFileSync(path.join(root, f), path.join(dist, f));
for (const d of DIRS) fs.cpSync(path.join(root, d), path.join(dist, d), { recursive: true });
if (dataDir) fs.cpSync(dataDir, path.join(dist, "data", "schedule"), { recursive: true });
// make-pages --data also rewrote the tracked index.html: put the repo back as committed.
if (dataDir) execFileSync(process.execPath, [path.join(__dirname, "make-pages.js")], { stdio: "ignore" });

const count = (dir) => fs.readdirSync(dir, { withFileTypes: true })
  .reduce((n, e) => n + (e.isDirectory() ? count(path.join(dir, e.name)) : 1), 0);
console.log(`dist/: ${count(dist)} files${dataDir ? " (with schedule snapshot)" : " (no snapshot: the app fetches schedules live)"}`);
