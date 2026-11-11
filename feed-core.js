"use strict";
// Schedule fetching shared by the browser app (window.FeedCore) and the nightly snapshot
// (tools/fetch-schedule.js). No DOM, no storage: callers inject getJson / tmdb fetchers.
(function (root) {
  const N = root.UpcomingNetworks || (typeof require === "function" ? require("./networks.js") : null);
  const { FLAGSHIP_RE, COUNTRY_NETWORKS, FR_NETWORKS } = N;

  const API = "https://api.tvmaze.com";
  // Web/streaming platforms to keep from the (worldwide) web schedule.
  const STREAMING_ALLOWLIST = /^(Netflix|Prime Video|Amazon|Hulu|Disney\+|Max|HBO Max|Apple TV\+?|Peacock|Paramount\+|Starz|Showtime|AMC\+|Shudder|Acorn TV|BritBox|Crunchyroll|ESPN\+|Discovery\+|Tubi|Freevee|MGM\+|Hallmark\+|Fox Nation)$/i;
  // French channels come from TMDB (far better FR coverage than TVMaze).
  const TMDB_NETWORKS = "285|1628|290|712|361|249"; // Canal+ | ARTE | TF1 | M6 | France 2 | France 3
  const TMDB_CHANNEL_NAMES = { 285: "Canal+", 1628: "ARTE", 290: "TF1", 712: "M6", 361: "France 2", 249: "France 3" };
  const TMDB_IMG = "https://image.tmdb.org/t/p/w342";
  const TMDB_IMG_ORIG = "https://image.tmdb.org/t/p/original";
  // Per-day TVmaze sources; "FR" is fetched per month from TMDB.
  const DAY_SOURCES = ["US", "web", ...Object.keys(COUNTRY_NETWORKS)];

  const escapeText = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  function ymd(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function monthDays(firstOfMonth) {
    const days = [], m = firstOfMonth.getMonth();
    const d = new Date(firstOfMonth.getFullYear(), m, 1);
    while (d.getMonth() === m) { days.push(ymd(d)); d.setDate(d.getDate() + 1); }
    return days;
  }

  // Keep only the fields the UI needs. `channel` unifies broadcast network and streaming
  // webChannel; precedence follows the source schedule (web items are labelled by platform).
  function trimItem(it, s, streaming) {
    const chan = streaming ? (s.webChannel || s.network) : (s.network || s.webChannel);
    return {
      id: it.id,
      season: it.season,
      number: it.number,
      airdate: it.airdate,
      show: {
        id: s.id,
        name: s.name,
        genres: s.genres || [],
        channel: chan ? { name: chan.name, streaming } : null,
        image: s.image ? { medium: s.image.medium, original: s.image.original } : null,
        summary: s.summary || "",
        premiered: s.premiered || null,
      },
    };
  }

  // Which upstream source carries a channel: "web", "FR", a country code, or "US" (catch-all).
  function sourceOf(name) {
    if (STREAMING_ALLOWLIST.test(name)) return "web";
    if (FR_NETWORKS.includes(name)) return "FR";
    for (const cc in COUNTRY_NETWORKS) if (COUNTRY_NETWORKS[cc].includes(name)) return cc;
    return "US";
  }
  function neededSources(followed) {
    const sources = new Set();
    for (const name of followed) sources.add(sourceOf(name));
    return sources;
  }

  // One source, one day, from TVmaze. Throws on network/HTTP errors (callers decide).
  async function fetchScheduleDay(getJson, src, dateStr) {
    if (src === "US") {
      const raw = await getJson(`${API}/schedule?country=US&date=${dateStr}`);
      return raw.filter((it) => it.show && it.show.network).map((it) => trimItem(it, it.show, false));
    }
    if (src === "web") {
      const raw = await getJson(`${API}/schedule/web?date=${dateStr}`);
      return raw
        .map((it) => ({ it, s: it._embedded && it._embedded.show }))
        .filter(({ s }) => { const chan = s && (s.webChannel || s.network); return chan && STREAMING_ALLOWLIST.test(chan.name); })
        .map(({ it, s }) => trimItem(it, s, true));
    }
    // International country code: keep flagship channels only.
    const raw = await getJson(`${API}/schedule?country=${src}&date=${dateStr}`);
    return raw
      .filter((it) => it.show && it.show.network && FLAGSHIP_RE.test(it.show.network.name))
      .map((it) => trimItem(it, it.show, false));
  }

  function tmdbChannel(networks) {
    for (const n of networks || []) if (TMDB_CHANNEL_NAMES[n.id]) return TMDB_CHANNEL_NAMES[n.id];
    return "";
  }
  function makeFrItem(show, season, ep) {
    return {
      id: ep.id,
      season,
      number: ep.episode_number,
      airdate: ep.air_date,
      show: {
        id: "tmdb:" + show.id,
        name: show.name,
        genres: (show.genres || []).map((g) => g.name),
        channel: { name: tmdbChannel(show.networks), streaming: false },
        image: show.poster_path ? { medium: TMDB_IMG + show.poster_path, original: TMDB_IMG_ORIG + show.poster_path } : null,
        summary: show.overview ? `<p>${escapeText(show.overview)}</p>` : "",
        premiered: show.first_air_date || null,
      },
    };
  }
  // French channels for one month (TMDB). `tmdb(path)` resolves to parsed JSON.
  async function fetchFrMonth(tmdb, firstOfMonth) {
    const gte = ymd(firstOfMonth);
    const lastDay = ymd(new Date(firstOfMonth.getFullYear(), firstOfMonth.getMonth() + 1, 0));
    const items = [];
    const disc = await tmdb(`discover/tv?with_networks=${TMDB_NETWORKS}&air_date.gte=${gte}&air_date.lte=${lastDay}&sort_by=popularity.desc`);
    for (const r of disc.results || []) {
      const show = await tmdb(`tv/${r.id}`);
      const marker = show.next_episode_to_air || show.last_episode_to_air;
      if (!marker) continue;
      let season;
      try { season = await tmdb(`tv/${show.id}/season/${marker.season_number}`); }
      catch { continue; }
      (season.episodes || [])
        .filter((e) => e.air_date && e.air_date >= gte && e.air_date <= lastDay)
        .forEach((e) => items.push(makeFrItem(show, marker.season_number, e)));
    }
    return items;
  }

  /* ---------- Nightly snapshot (data/schedule/) ---------- */
  const SNAPSHOT_MAX_AGE_MS = 36 * 60 * 60 * 1000;

  // Split a month of followed channels between the snapshot and live fetching. A source is
  // read from the snapshot only when the snapshot is fresh, has that month, and has a file
  // for every followed channel of that source; otherwise the whole source stays live.
  function planMonth(followed, index, monthKey, now) {
    const live = new Set(), files = [];
    const fresh = !!(index && index.generatedAt && now - Date.parse(index.generatedAt) < SNAPSHOT_MAX_AGE_MS &&
      Array.isArray(index.months) && index.months.includes(monthKey) && index.channels);
    const bySource = new Map();
    for (const name of followed) {
      const src = sourceOf(name);
      if (!bySource.has(src)) bySource.set(src, []);
      bySource.get(src).push(name);
    }
    for (const [src, names] of bySource) {
      if (fresh && names.every((n) => index.channels[n])) names.forEach((n) => files.push(index.channels[n]));
      else live.add(src);
    }
    return { live, files };
  }

  const api = {
    API, STREAMING_ALLOWLIST, TMDB_NETWORKS, TMDB_CHANNEL_NAMES, TMDB_IMG, TMDB_IMG_ORIG, DAY_SOURCES,
    ymd, monthDays, trimItem, sourceOf, neededSources, fetchScheduleDay,
    tmdbChannel, makeFrItem, fetchFrMonth, planMonth, SNAPSHOT_MAX_AGE_MS,
  };
  root.FeedCore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
