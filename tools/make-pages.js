// Generates the static pages GitHub Pages needs for clean addresses, from index.html:
//   watchlist.html          → <site>/watchlist            (noindex: personal view)
//   network/<slug>.html     → <site>/network/<slug>       (one per seed channel, indexable)
//   404.html                → any other address, e.g. a rare channel (noindex)
//   sitemap.xml             → the feed and the channel pages, for search engines
// Run after editing index.html or the channel lists in networks.js:
//   node tools/make-pages.js
const fs = require("node:fs");
const path = require("node:path");
const { SEED_NETWORKS, networkSlug, networkMeta } = require("../networks.js");
const root = path.join(__dirname, "..");

const NOTE = "<!-- Generated from index.html by tools/make-pages.js — do not edit by hand. -->";
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

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

function networkPage(indexHtml, name) {
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
  return html;
}

// { relativePath: content } for every generated file.
function build(indexHtml) {
  const files = {
    "watchlist.html": derive(indexHtml, { noindex: true }),
    "404.html": derive(indexHtml, { base: new URL(siteUrl(indexHtml)).pathname, noindex: true }),
  };
  const seen = new Map();
  for (const name of new Set(SEED_NETWORKS)) {
    const slug = networkSlug(name);
    if (seen.has(slug)) throw new Error(`slug collision: "${seen.get(slug)}" and "${name}" → ${slug}`);
    seen.set(slug, name);
    files[`network/${slug}.html`] = networkPage(indexHtml, name);
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

if (require.main === module) {
  const files = build(fs.readFileSync(path.join(root, "index.html"), "utf8"));
  const dir = path.join(root, "network");
  fs.rmSync(dir, { recursive: true, force: true }); // drop pages of removed channels
  fs.mkdirSync(dir);
  for (const [rel, html] of Object.entries(files)) fs.writeFileSync(path.join(root, rel), html);
  console.log(`${Object.keys(files).length} pages written`);
}
