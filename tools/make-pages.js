// Generates the static pages GitHub Pages needs for clean addresses, from index.html:
//   watchlist.html          → <site>/watchlist            (noindex: personal view)
//   network/<slug>.html     → <site>/network/<slug>       (one per seed channel, indexable)
//   404.html                → any other address, e.g. a rare channel (noindex)
//   sitemap.xml             → the feed and the channel pages, for search engines
// Run after editing index.html or the channel lists in networks.js:
//   node tools/make-pages.js
// With a nightly snapshot (tools/fetch-schedule.js), channel pages also get the upcoming
// shows as plain HTML, readable without JavaScript (the app replaces it once it runs):
//   node tools/make-pages.js --data data/schedule
const fs = require("node:fs");
const path = require("node:path");
const { SEED_NETWORKS, networkSlug, networkMeta } = require("../networks.js");
const root = path.join(__dirname, "..");

const NOTE = "<!-- Generated from index.html by tools/make-pages.js — do not edit by hand. -->";
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function siteUrl(indexHtml) {
  const m = indexHtml.match(/<link rel="canonical" href="([^"]+)">/);
  if (!m) throw new Error("index.html has no canonical link");
  return m[1];
}

function swap(html, re, value) {
  if (!re.test(html)) throw new Error("index.html is missing " + re);
  return html.replace(re, (_, a, b) => a + value + b);
}

// Every generated page: a note after the doctype, and <base href> to the app root so
// relative scripts and styles resolve from any depth.
function derive(indexHtml, { base, noindex }) {
  const html = indexHtml.replace(/^<!DOCTYPE html>\n/i, (d) => d + NOTE + "\n");
  const extra = (base ? `\n  <base href="${base}">` : "") + (noindex ? '\n  <meta name="robots" content="noindex">' : "");
  return html.replace(/(<meta charset="UTF-8">)/, "$1" + extra);
}

const MAX_PER_MONTH = 60;
const fmtDay = (d) => new Date(d + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const fmtMonth = (k) => new Date(k + "-01T00:00:00Z").toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

// Static list of a channel's upcoming shows (first episode of each show per month).
function prerender(name, data) {
  if (!data || !data.index.channels[name]) return "";
  const slug = data.index.channels[name];
  const months = [];
  for (const monthKey of data.index.months) {
    const items = data.read(monthKey, slug).filter((it) => it.airdate && it.airdate >= data.today);
    const firstByShow = new Map();
    for (const it of items.sort((a, b) => a.airdate.localeCompare(b.airdate))) {
      if (!firstByShow.has(it.show.id)) firstByShow.set(it.show.id, it);
    }
    const rows = [...firstByShow.values()].slice(0, MAX_PER_MONTH).map((it) => {
      const ep = it.season != null && it.number != null ? ` · S${it.season}E${it.number}` : "";
      const tag = it.number === 1 ? (it.season === 1 ? " — series premiere" : " — season premiere") : "";
      return `<li><time datetime="${esc(it.airdate)}">${esc(fmtDay(it.airdate))}</time> · <strong>${esc(it.show.name)}</strong>${esc(ep)}${esc(tag)}</li>`;
    });
    if (rows.length) months.push(`<h3>${esc(fmtMonth(monthKey))}</h3>\n      <ul>\n        ${rows.join("\n        ")}\n      </ul>`);
  }
  const body = months.length ? months.join("\n      ") : "<p>No upcoming episodes listed yet.</p>";
  return `\n    <section class="prerender" aria-labelledby="prerender-title">\n      <h2 id="prerender-title">Upcoming on ${esc(name)}</h2>\n      ${body}\n    </section>\n  `;
}

function networkPage(indexHtml, name, data) {
  const m = networkMeta(name);
  const json = (v) => JSON.stringify(v).slice(1, -1); // string body, safe inside "…" in JSON-LD
  let html = derive(indexHtml, { base: "../" });
  html = swap(html, /(<title>)[^<]*(<\/title>)/, esc(m.title));
  html = swap(html, /(<meta name="description" content=")[^"]*(">)/, esc(m.description));
  html = swap(html, /(<link rel="canonical" href=")[^"]*(">)/, esc(m.url));
  html = swap(html, /(<meta property="og:url" content=")[^"]*(">)/, esc(m.url));
  html = swap(html, /(<meta property="og:title" content=")[^"]*(">)/, esc(m.title));
  html = swap(html, /(<meta property="og:description" content=")[^"]*(">)/, esc(m.description));
  html = swap(html, /(<meta name="twitter:title" content=")[^"]*(">)/, esc(m.title));
  html = swap(html, /(<meta name="twitter:description" content=")[^"]*(">)/, esc(m.twitterDescription));
  // Structured data: same description as the page, plus its own address.
  html = swap(html, /("description": ")[^"]*(",)/, json(m.description) + '",\n    "url": "' + json(m.url));
  const list = prerender(name, data);
  if (list) html = swap(html, /(<main id="grid"[^>]*>)(<\/main>)/, list);
  return html;
}

// { relativePath: content } for every generated file.
function build(indexHtml, data) {
  const files = {
    "watchlist.html": derive(indexHtml, { noindex: true }),
    "404.html": derive(indexHtml, { base: new URL(siteUrl(indexHtml)).pathname, noindex: true }),
  };
  const seen = new Map();
  for (const name of new Set(SEED_NETWORKS)) {
    const slug = networkSlug(name);
    if (seen.has(slug)) throw new Error(`slug collision: "${seen.get(slug)}" and "${name}" → ${slug}`);
    seen.set(slug, name);
    files[`network/${slug}.html`] = networkPage(indexHtml, name, data);
  }
  const site = siteUrl(indexHtml);
  const urls = [site, ...[...seen.keys()].map((s) => site + "network/" + s)];
  files["sitemap.xml"] = '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map((u) => `  <url><loc>${esc(u)}</loc></url>`).join("\n") + "\n</urlset>\n";
  // No robots.txt: on a project site it would sit in a sub-folder, where crawlers never
  // read it. Submit sitemap.xml in Google Search Console instead.
  return files;
}
module.exports = { build };

// Snapshot reader for build(): { index, read(monthKey, slug), today }.
function loadData(dir) {
  const index = JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8"));
  const read = (monthKey, slug) => {
    try { return JSON.parse(fs.readFileSync(path.join(dir, monthKey, slug + ".json"), "utf8")); }
    catch { return []; }
  };
  return { index, read, today: new Date().toISOString().slice(0, 10) };
}
module.exports.loadData = loadData;

if (require.main === module) {
  const i = process.argv.indexOf("--data");
  const data = i > -1 ? loadData(path.resolve(process.argv[i + 1])) : null;
  const files = build(fs.readFileSync(path.join(root, "index.html"), "utf8"), data);
  const dir = path.join(root, "network");
  fs.rmSync(dir, { recursive: true, force: true }); // drop pages of removed channels
  fs.mkdirSync(dir);
  for (const [rel, html] of Object.entries(files)) fs.writeFileSync(path.join(root, rel), html);
  console.log(`${Object.keys(files).length} pages written`);
}
