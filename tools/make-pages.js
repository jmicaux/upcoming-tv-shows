// Generates the static pages GitHub Pages needs, from index.html:
//   index.html              → fills its generated regions (h1 + intro, footer with links
//                              to every channel page); with data, also "Next premieres"
//   watchlist.html          → <site>/watchlist            (noindex: personal view)
//   network/<slug>.html     → <site>/network/<slug>       (one per seed channel, indexable)
//   404.html                → any other address, e.g. a rare channel (noindex)
//   sitemap.xml             → the feed, About and the channel pages, for search engines
// Run after editing index.html or the channel lists in networks.js:
//   node tools/make-pages.js
// With a nightly snapshot (tools/fetch-schedule.js), pages also get the upcoming shows as
// plain HTML, readable without JavaScript (the app replaces it once it runs):
//   node tools/make-pages.js --data data/schedule
// Generated regions sit between <!-- name:start --> and <!-- name:end --> markers, so the
// script is idempotent: running it again (with or without data) rewrites them in place.
const fs = require("node:fs");
const path = require("node:path");
const { SEED_NETWORKS, NETWORK_GROUPS, networkSlug, networkMeta } = require("../networks.js");
const root = path.join(__dirname, "..");

const NOTE = "<!-- Generated from index.html by tools/make-pages.js — do not edit by hand. -->";
const REPO = "https://github.com/jmicaux/upcoming-tv-shows";
const BMC = "https://buymeacoffee.com/jmicaux";
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

// Replace the content of a marked region.
function region(html, name, content) {
  const re = new RegExp(`(<!-- ${name}:start -->)[\\s\\S]*?(<!-- ${name}:end -->)`);
  if (!re.test(html)) throw new Error(`index.html is missing the ${name} region`);
  return html.replace(re, (_, a, b) => a + content + b);
}

// Every derived page: a note after the doctype, and <base href> to the app root so
// relative scripts, styles and links resolve from any depth.
function derive(indexHtml, { base, noindex }) {
  const html = indexHtml.replace(/^<!DOCTYPE html>\n/i, (d) => d + NOTE + "\n");
  const extra = (base ? `\n  <base href="${base}">` : "") + (noindex ? '\n  <meta name="robots" content="noindex">' : "");
  return html.replace(/(<meta charset="UTF-8">)/, "$1" + extra);
}

const MAX_PER_MONTH = 60;
const MAX_HOME = 24;
const fmtDay = (d) => new Date(d + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const fmtLong = (d) => new Date(d + "T00:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const fmtMonth = (k) => new Date(k + "-01T00:00:00Z").toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const premiereTag = (it) => (it.number === 1 ? (it.season === 1 ? "series premiere" : "season premiere") : "");
const epCode = (it) => (it.season != null && it.number != null ? `S${it.season}E${it.number}` : "");

/* ---------- Snapshot helpers ---------- */
// Upcoming items of one channel (from today), sorted by date.
function channelItems(name, data) {
  if (!data || !data.index.channels[name]) return null; // channel not in the snapshot
  const slug = data.index.channels[name];
  return data.index.months
    .flatMap((k) => data.read(k, slug))
    .filter((it) => it.airdate && it.airdate >= data.today)
    .sort((a, b) => a.airdate.localeCompare(b.airdate) || a.show.name.localeCompare(b.show.name));
}
const firstPerShow = (items) => {
  const seen = new Set();
  return items.filter((it) => (seen.has(it.show.id) ? false : (seen.add(it.show.id), true)));
};
const updatedLine = (data) =>
  `<p class="prerender-meta">Updated <time datetime="${esc(data.index.generatedAt)}">${esc(fmtLong(data.index.generatedAt.slice(0, 10)))}</time> · Schedule data from <a href="https://www.tvmaze.com/">TVmaze</a> and <a href="https://www.themoviedb.org/">TMDB</a>.</p>`;

/* ---------- Generated regions ---------- */
function footerHtml() {
  const groups = NETWORK_GROUPS.map((g) => {
    const links = [...new Set(g.names)].map((n) => `<li><a href="network/${networkSlug(n)}">${esc(n)}</a></li>`).join("");
    const label = g.label.replace(/^\S+\s/, ""); // drop the flag emoji
    return `<div class="footer-group"><h3>${esc(label)}</h3><ul>${links}</ul></div>`;
  }).join("");
  return `
    <nav class="footer-channels" aria-labelledby="footer-channels-title">
      <h2 id="footer-channels-title">Upcoming shows by channel</h2>
      <div class="footer-groups">${groups}</div>
    </nav>
    <p class="footer-links"><a href="./">Home</a> · <a href="about.html">About</a> · <a href="privacy.html">Privacy</a> · <a href="accessibilite.html" lang="fr">Accessibilité : non conforme</a> · <a href="${REPO}/issues">Contact &amp; feedback</a> · <a href="${REPO}">Source on GitHub</a> · <a href="${BMC}">☕ Buy me a coffee</a></p>
  `;
}

function homeHtml(data) {
  let body = `<p class="prerender-intro">Upcoming TV Shows lists new and returning series month by month across ${new Set(SEED_NETWORKS).size} US, UK, Australian, Nordic, French and streaming channels, with premiere dates, seasons and where to watch. Free, no account needed.</p>`;
  if (data) {
    const premieres = Object.keys(data.index.channels)
      .flatMap((n) => channelItems(n, data).filter((it) => it.number === 1))
      .sort((a, b) => a.airdate.localeCompare(b.airdate) || a.show.name.localeCompare(b.show.name));
    const rows = firstPerShow(premieres).slice(0, MAX_HOME).map((it) => {
      const chan = it.show.channel.name;
      return `<li><time datetime="${esc(it.airdate)}">${esc(fmtDay(it.airdate))}</time> · <strong>${esc(it.show.name)}</strong> · <a href="network/${networkSlug(chan)}">${esc(chan)}</a> — ${esc(premiereTag(it))}</li>`;
    });
    if (rows.length) body += `\n      <h2>Next premieres</h2>\n      <ul>\n        ${rows.join("\n        ")}\n      </ul>`;
    body += "\n      " + updatedLine(data);
  }
  return `\n    <section class="prerender" aria-labelledby="prerender-title">\n      <h1 id="prerender-title">New and returning TV series, by premiere date</h1>\n      ${body}\n    </section>\n  `;
}

// Channel page body: h1, a factual opening sentence, then the list by month.
function networkHtml(name, data) {
  const h1 = `<h1 id="prerender-title">Upcoming ${esc(name)} shows</h1>`;
  const items = channelItems(name, data);
  if (!items) {
    return `\n    <section class="prerender" aria-labelledby="prerender-title">\n      ${h1}\n      <p class="prerender-intro">New and returning ${esc(name)} series, month by month: premiere dates, seasons and episodes.</p>\n    </section>\n  `;
  }
  const shows = firstPerShow(items);
  const next = items.find((it) => it.number === 1);
  const months = [];
  for (const monthKey of data.index.months) {
    const rows = firstPerShow(items.filter((it) => it.airdate.startsWith(monthKey))).slice(0, MAX_PER_MONTH).map((it) => {
      const code = epCode(it), tag = premiereTag(it);
      return `<li><time datetime="${esc(it.airdate)}">${esc(fmtDay(it.airdate))}</time> · <strong>${esc(it.show.name)}</strong>${code ? " · " + esc(code) : ""}${tag ? " — " + esc(tag) : ""}</li>`;
    });
    if (rows.length) months.push(`<h2>${esc(fmtMonth(monthKey))}</h2>\n      <ul>\n        ${rows.join("\n        ")}\n      </ul>`);
  }
  const lastMonth = fmtMonth(data.index.months[data.index.months.length - 1]);
  const intro = shows.length
    ? `${esc(name)} has ${shows.length} new and returning series scheduled from ${esc(fmtLong(data.today))} through the end of ${esc(lastMonth)}.` +
      (next ? ` Next premiere: <strong>${esc(next.show.name)}</strong> (${esc(premiereTag(next))}, ${esc(fmtLong(next.airdate))}).` : "")
    : `No upcoming ${esc(name)} episodes are listed yet for the next months.`;
  return `\n    <section class="prerender" aria-labelledby="prerender-title">\n      ${h1}\n      <p class="prerender-intro">${intro}</p>\n      ${months.join("\n      ")}\n      ${updatedLine(data)}\n    </section>\n  `;
}
const hasUpcoming = (name, data) => { const it = channelItems(name, data); return !it || it.length > 0; };

function networkPage(indexHtml, name, data) {
  const m = networkMeta(name);
  const items = channelItems(name, data);
  const next = items && items.find((it) => it.number === 1);
  // A fact of the day makes each channel's description unique.
  const desc = items && items.length
    ? `${firstPerShow(items).length} new and returning ${name} series scheduled${next ? `; next premiere: ${next.show.name} (${fmtDay(next.airdate)})` : ""}. Premiere dates, seasons and episodes, updated daily.`
    : m.description;
  const json = (v) => JSON.stringify(v).slice(1, -1); // string body, safe inside "…" in JSON-LD
  let html = derive(indexHtml, { base: "../", noindex: !hasUpcoming(name, data) });
  html = swap(html, /(<title>)[^<]*(<\/title>)/, esc(m.title));
  html = swap(html, /(<meta name="description" content=")[^"]*(">)/, esc(desc));
  html = swap(html, /(<link rel="canonical" href=")[^"]*(">)/, esc(m.url));
  html = swap(html, /(<meta property="og:url" content=")[^"]*(">)/, esc(m.url));
  html = swap(html, /(<meta property="og:title" content=")[^"]*(">)/, esc(m.title));
  html = swap(html, /(<meta property="og:description" content=")[^"]*(">)/, esc(desc));
  html = swap(html, /(<meta name="twitter:title" content=")[^"]*(">)/, esc(m.title));
  html = swap(html, /(<meta name="twitter:description" content=")[^"]*(">)/, esc(desc));
  // Structured data: same description as the page, plus its own address.
  html = swap(html, /("description": ")[^"]*(",)/, json(desc) + '",\n    "url": "' + json(m.url));
  return region(html, "prerender", networkHtml(name, data));
}

// Index with its regions filled; dateModified added to the JSON-LD when data is present.
function buildIndex(indexHtml, data) {
  let html = region(region(indexHtml, "footer", footerHtml()), "prerender", homeHtml(data));
  html = html.replace(/\n    "dateModified": "[^"]*",/, "");
  if (data) html = html.replace(/("applicationCategory")/, `"dateModified": "${data.index.generatedAt}",\n    $1`);
  return html;
}

// { relativePath: content } for every generated file (index.html included).
function build(indexHtml, data) {
  const index = buildIndex(indexHtml, data);
  const files = {
    "index.html": index,
    "watchlist.html": derive(region(index, "prerender", ""), { noindex: true }),
    "404.html": derive(region(index, "prerender", ""), { base: new URL(siteUrl(index)).pathname, noindex: true }),
  };
  const seen = new Map();
  for (const name of new Set(SEED_NETWORKS)) {
    const slug = networkSlug(name);
    if (seen.has(slug)) throw new Error(`slug collision: "${seen.get(slug)}" and "${name}" → ${slug}`);
    seen.set(slug, name);
    files[`network/${slug}.html`] = networkPage(index, name, data);
  }
  const site = siteUrl(index);
  const indexable = [...seen].filter(([, name]) => hasUpcoming(name, data)).map(([slug]) => site + "network/" + slug);
  const urls = [site, site + "about.html", site + "accessibilite.html", ...indexable];
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
  console.log(`${Object.keys(files).length} pages written${data ? " (with schedule data)" : ""}`);
}
