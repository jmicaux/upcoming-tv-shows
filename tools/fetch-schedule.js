// Nightly snapshot of the schedule, so visitors and crawlers do not hit TVmaze themselves.
//   node tools/fetch-schedule.js [outDir=data/schedule] [months=3]
// Writes <outDir>/<YYYY-MM>/<slug>.json (one array of items per seed channel and month)
// and <outDir>/index.json { generatedAt, months, channels: { name: slug } }.
// A source with any failed day is left out of the index, so the app fetches it live.
// French channels need TMDB_KEY in the environment; without it they stay live too.
const fs = require("node:fs");
const path = require("node:path");
const { SEED_NETWORKS, networkSlug } = require("../networks.js");
const F = require("../feed-core.js");

const outDir = path.resolve(process.argv[2] || "data/schedule");
const monthCount = Number(process.argv[3]) || 3;
const GAP_MS = 550; // same throttle as the app: ~18 requests / 10 s, under TVmaze's limit
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = { "User-Agent": "upcoming-tv-shows snapshot (GitHub Actions)" };

let last = 0;
async function getJson(url) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const wait = GAP_MS - (Date.now() - last);
    if (wait > 0) await sleep(wait);
    const res = await fetch(url, { headers: UA });
    last = Date.now();
    if (res.status === 429) { await sleep(2000 * (attempt + 1)); continue; }
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return res.json();
  }
  throw new Error("rate limited: " + url);
}
const tmdb = (p) =>
  fetch(`https://api.themoviedb.org/3/${p}${p.includes("?") ? "&" : "?"}api_key=${process.env.TMDB_KEY}`, { headers: UA })
    .then((r) => { if (!r.ok) throw new Error(`TMDB ${r.status}`); return r.json(); });

async function main() {
  const now = new Date();
  const months = Array.from({ length: monthCount }, (_, i) => new Date(now.getFullYear(), now.getMonth() + i, 1));
  const seeds = [...new Set(SEED_NETWORKS)];
  const bucket = new Map(); // "YYYY-MM|channel" -> items
  const add = (monthKey, item) => {
    const name = item.show.channel && item.show.channel.name;
    if (!seeds.includes(name)) return;
    const k = monthKey + "|" + name;
    if (!bucket.has(k)) bucket.set(k, []);
    bucket.get(k).push(item);
  };

  const okSources = new Set();
  for (const src of F.DAY_SOURCES) {
    let ok = true;
    for (const month of months) {
      const monthKey = F.ymd(month).slice(0, 7);
      for (const day of F.monthDays(month)) {
        try { (await F.fetchScheduleDay(getJson, src, day)).forEach((it) => add(monthKey, it)); }
        catch (err) { ok = false; console.error(`${src} ${day}: ${err.message}`); }
      }
    }
    if (ok) okSources.add(src);
    console.log(`${src}: ${ok ? "ok" : "FAILED (left live)"}`);
  }

  if (process.env.TMDB_KEY) {
    let ok = true;
    for (const month of months) {
      const monthKey = F.ymd(month).slice(0, 7);
      try { (await F.fetchFrMonth(tmdb, month)).forEach((it) => add(monthKey, it)); }
      catch (err) { ok = false; console.error(`FR ${monthKey}: ${err.message}`); }
    }
    if (ok) okSources.add("FR");
    console.log(`FR: ${ok ? "ok" : "FAILED (left live)"}`);
  } else {
    console.log("FR: skipped (no TMDB_KEY)");
  }

  fs.rmSync(outDir, { recursive: true, force: true });
  const channels = {};
  const monthKeys = months.map((m) => F.ymd(m).slice(0, 7));
  for (const name of seeds) {
    if (!okSources.has(F.sourceOf(name))) continue;
    const slug = networkSlug(name);
    channels[name] = slug;
    for (const monthKey of monthKeys) {
      fs.mkdirSync(path.join(outDir, monthKey), { recursive: true });
      fs.writeFileSync(path.join(outDir, monthKey, slug + ".json"), JSON.stringify(bucket.get(monthKey + "|" + name) || []));
    }
  }
  const index = { generatedAt: new Date().toISOString(), months: monthKeys, channels };
  fs.writeFileSync(path.join(outDir, "index.json"), JSON.stringify(index, null, 1));
  console.log(`${Object.keys(channels).length} channels × ${monthKeys.length} months → ${outDir}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
