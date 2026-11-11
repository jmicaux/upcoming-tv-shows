// Reuses the schedule snapshot already published on the live site, so a code deploy does
// not query TVmaze again (only the nightly run does).
//   node tools/pull-snapshot.js <siteUrl> [outDir=data/schedule] [maxAgeHours=36]
// Exit code 0: snapshot copied to outDir. Exit code 1: missing, stale or incomplete —
// the caller then runs tools/fetch-schedule.js instead.
const fs = require("node:fs");
const path = require("node:path");

const site = (process.argv[2] || "").replace(/\/?$/, "/");
const outDir = path.resolve(process.argv[3] || "data/schedule");
const maxAgeMs = (Number(process.argv[4]) || 36) * 3600 * 1000;
const UA = { "User-Agent": "upcoming-tv-shows deploy (GitHub Actions)" };

async function getJson(url) {
  const res = await fetch(url, { headers: UA, cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function main() {
  if (!/^https:\/\//.test(site)) throw new Error("usage: pull-snapshot.js <https site url> [outDir] [maxAgeHours]");
  const base = site + "data/schedule/";
  const index = await getJson(base + "index.json");
  const age = Date.now() - Date.parse(index.generatedAt);
  if (!(age >= 0 && age < maxAgeMs)) throw new Error(`published snapshot is ${Math.round(age / 3600000)} h old`);

  const jobs = [];
  for (const month of index.months) for (const slug of Object.values(index.channels)) jobs.push([month, slug]);
  const files = new Map();
  // A few requests at a time: same-origin static files, quick to fetch.
  for (let i = 0; i < jobs.length; i += 12) {
    await Promise.all(jobs.slice(i, i + 12).map(async ([month, slug]) => {
      const list = await getJson(`${base}${month}/${slug}.json`);
      if (!Array.isArray(list)) throw new Error(`not a list: ${month}/${slug}`);
      files.set(`${month}/${slug}.json`, list);
    }));
  }

  fs.rmSync(outDir, { recursive: true, force: true });
  for (const [rel, list] of files) {
    fs.mkdirSync(path.dirname(path.join(outDir, rel)), { recursive: true });
    fs.writeFileSync(path.join(outDir, rel), JSON.stringify(list));
  }
  fs.writeFileSync(path.join(outDir, "index.json"), JSON.stringify(index, null, 1));
  console.log(`Reused the published snapshot (${files.size} files, generated ${index.generatedAt}).`);
}

main().catch((err) => { console.error(`Cannot reuse the published snapshot: ${err.message}`); process.exit(1); });
