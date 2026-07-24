"use strict";

/* ---------- Version ---------- */
const APP_VERSION = "1.21.0"; // single source of truth — bump on each release

/* ---------- Config ---------- */
const API = "https://api.tvmaze.com";
const CACHE_PREFIX = "tvmaze:sched:v3:"; // v3: US + streaming + selected FR channels
const FUTURE_TTL_MS = 6 * 60 * 60 * 1000; // 6h for today/future days
const REQUEST_GAP_MS = 550;               // throttle: ~18 req / 10s, under TVMaze's ~20/10s
const FOLLOW_KEY = "tv:followedNetworks";
const KNOWN_KEY = "tv:knownNetworks";

// Seed list so the major US channels are pickable before any month is browsed.
const SEED_NETWORKS = [
  // Broadcast / cable
  "ABC", "CBS", "NBC", "FOX", "The CW", "PBS",
  "AMC", "FX", "FXX", "USA Network", "TNT", "TBS", "HBO", "Showtime", "Starz",
  "A&E", "History", "Bravo", "E!", "Syfy", "Comedy Central", "MTV",
  "Cartoon Network", "Adult Swim", "Nickelodeon", "Disney Channel", "Freeform",
  "TLC", "HGTV", "Food Network", "Discovery Channel", "National Geographic",
  "Lifetime", "Hallmark Channel", "Paramount Network", "BET", "truTV",
  // Streaming (US-available)
  "Netflix", "Prime Video", "Hulu", "Disney+", "Max", "Apple TV",
  "Peacock", "Paramount+", "AMC+", "Starz", "Shudder", "ESPN+",
  // Selected French channels (sourced from TMDB)
  "Canal+", "ARTE", "TF1", "M6", "France 2", "France 3",
];

// Big networks pre-selected on the very first visit (until the user changes it).
const DEFAULT_FOLLOWED = [
  "HBO", "Max", "Showtime", "Starz", "FX", "AMC",
  "Netflix", "Hulu", "Prime Video", "Disney+", "Apple TV", "Paramount+", "Peacock",
  "Canal+", "ARTE", "TF1", "M6", "France 2", "France 3",
];

// Web/streaming platforms to keep from the (worldwide) web schedule.
const STREAMING_ALLOWLIST = /^(Netflix|Prime Video|Amazon|Hulu|Disney\+|Max|HBO Max|Apple TV\+?|Peacock|Paramount\+|Starz|Showtime|AMC\+|Shudder|Acorn TV|BritBox|Crunchyroll|ESPN\+|Discovery\+|Tubi|Freevee|MGM\+|Hallmark\+|Fox Nation)$/i;

// French channels come from TMDB (far better FR coverage than TVMaze).
// Key is provided at runtime by config.js (git-ignored) — see config.example.js.
const TMDB_KEY_STORAGE = "tv:tmdbKey";
// Priority: a key entered in-app (localStorage) → a build-time config.js key → none.
let TMDB_KEY = localStorage.getItem(TMDB_KEY_STORAGE) || (window.LINEUP_CONFIG && window.LINEUP_CONFIG.TMDB_KEY) || "";
const TMDB_NETWORKS = "285|1628|290|712|361|249"; // Canal+ | ARTE | TF1 | M6 | France 2 | France 3
const TMDB_CHANNEL_NAMES = { 285: "Canal+", 1628: "ARTE", 290: "TF1", 712: "M6", 361: "France 2", 249: "France 3" };
const TMDB_IMG = "https://image.tmdb.org/t/p/w342";
const TMDB_IMG_ORIG = "https://image.tmdb.org/t/p/original";
const TMDB_CACHE_PREFIX = "tmdb:fr:v1:"; // keyed by YYYY-MM
const FAV_KEY = "tv:favorites";
const OVERRIDES_KEY = "tv:watchOverrides"; // { sourceChannel: providerChannel } for "Watch on" links

/* ---------- State ---------- */
const state = {
  firstMonth: startOfMonth(new Date()), // first month shown (current month)
  blocks: [],                       // [{ month: Date, items: [], el: HTMLElement }]
  loading: false,                   // a month block is currently loading
  reachedEnd: false,                // no further scheduling data upstream
  emptyStreak: 0,                   // consecutive empty months (for end detection)
  followed: new Set(loadFollowed()),                 // networks the user picked; empty = show all
  known: new Set([...SEED_NETWORKS, ...loadArray(KNOWN_KEY)]), // all pickable networks
  networkSearch: "",
  genreSearch: "",
  search: "",                       // free-text title search (lowercased)
  genres: new Set(),                // selected genres (empty = all); a show matches any
  availableGenres: new Set(),       // genres present in the loaded feed
  premieresOnly: true,
  hidePast: false,                  // hide already-aired days in the current month
  view: "month",                    // "month" | "watchlist"
  favorites: loadObject(FAV_KEY),   // { showId: { id, name } } — lean; details are re-fetchable by id
  showCache: {},                    // showId -> full trimmed show (in-memory hydration, not persisted)
  watchOverrides: loadObject(OVERRIDES_KEY), // { sourceChannel: providerChannel }
  navCard: null,                    // current card element for modal prev/next
  searching: false,                 // showing catalog search results (vs the month feed)
  searchShows: {},                  // id -> trimmed show, from the TVMaze catalog search
  nextEp: {},                       // showId -> { airdate, label } | null (watchlist cache)
};

function loadArray(key) {
  try { return JSON.parse(localStorage.getItem(key)) || []; } catch { return []; }
}
// First visit (no saved value) → curated defaults; afterwards respect the user's choice
// (an explicit empty selection means "show all").
function loadFollowed() {
  return localStorage.getItem(FOLLOW_KEY) !== null ? loadArray(FOLLOW_KEY) : DEFAULT_FOLLOWED;
}
function loadObject(key) {
  try { return JSON.parse(localStorage.getItem(key)) || {}; } catch { return {}; }
}
function saveSet(key, set) {
  try { localStorage.setItem(key, JSON.stringify([...set])); } catch { /* ignore quota */ }
}
function saveFavorites() {
  try { localStorage.setItem(FAV_KEY, JSON.stringify(state.favorites)); }
  catch { toast("Storage full — your watchlist may not be saved."); }
}

/* ---------- DOM ---------- */
const el = {
  grid: document.getElementById("grid"),
  networkBtn: document.getElementById("networkBtn"),
  networkBtnCount: document.getElementById("networkBtnCount"),
  networkPanel: document.getElementById("networkPanel"),
  networkList: document.getElementById("networkList"),
  networkSearch: document.getElementById("networkSearch"),
  networkClear: document.getElementById("networkClear"),
  networkDropdown: document.getElementById("networkDropdown"),
  genreDropdown: document.getElementById("genreDropdown"),
  genreBtn: document.getElementById("genreBtn"),
  genreBtnCount: document.getElementById("genreBtnCount"),
  genrePanel: document.getElementById("genrePanel"),
  genreList: document.getElementById("genreList"),
  genreSearch: document.getElementById("genreSearch"),
  genreClear: document.getElementById("genreClear"),
  premieresOnly: document.getElementById("premieresOnly"),
  hidePast: document.getElementById("hidePast"),
  search: document.getElementById("search"),
  searchInput: document.getElementById("searchInput"),
  searchToggle: document.getElementById("searchToggle"),
  searchClear: document.getElementById("searchClear"),
  resetFilters: document.getElementById("resetFilters"),
  clearNetwork: document.getElementById("clearNetwork"),
  resultCount: document.getElementById("resultCount"),
  modal: document.getElementById("modal"),
  modalCard: document.querySelector(".modal-card"),
  modalBody: document.getElementById("modalBody"),
  modalPrev: document.getElementById("modalPrev"),
  modalNext: document.getElementById("modalNext"),
  themeBtn: document.getElementById("themeBtn"),
  viewBtn: document.getElementById("viewBtn"),
  exportBtn: document.getElementById("exportBtn"),
  importBtn: document.getElementById("importBtn"),
  importFile: document.getElementById("importFile"),
  settingsBtn: document.getElementById("settingsBtn"),
};

/* ---------- Theme ---------- */
const THEME_KEY = "tv:theme";
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  el.themeBtn.textContent = theme === "dark" ? "☀" : "☾";
  el.themeBtn.title = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
}
let currentTheme =
  localStorage.getItem(THEME_KEY) ||
  (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
applyTheme(currentTheme);
el.themeBtn.addEventListener("click", () => {
  currentTheme = currentTheme === "dark" ? "light" : "dark";
  localStorage.setItem(THEME_KEY, currentTheme);
  applyTheme(currentTheme);
});

/* ---------- Date helpers ---------- */
function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }

function ymd(d) {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function monthDays(firstOfMonth) {
  const days = [];
  const y = firstOfMonth.getFullYear();
  const m = firstOfMonth.getMonth();
  const d = new Date(y, m, 1);
  while (d.getMonth() === m) {
    days.push(ymd(d));
    d.setDate(d.getDate() + 1);
  }
  return days;
}

function monthLabel(d) {
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function isPastDate(dateStr) {
  return dateStr < ymd(new Date());
}

/* ---------- Cache ---------- */
function readCache(dateStr) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + dateStr);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (!isPastDate(dateStr) && Date.now() - entry.ts > FUTURE_TTL_MS) return null;
    return entry.data;
  } catch {
    return null;
  }
}

function writeCache(dateStr, data) {
  const entry = JSON.stringify({ ts: Date.now(), data });
  try {
    localStorage.setItem(CACHE_PREFIX + dateStr, entry);
  } catch {
    // Quota hit: drop the oldest schedule entries and retry once.
    pruneCache();
    try { localStorage.setItem(CACHE_PREFIX + dateStr, entry); } catch { /* give up */ }
  }
}

function pruneCache() {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(CACHE_PREFIX)) keys.push(k);
  }
  keys.sort(); // date-ordered; drop the earliest half
  keys.slice(0, Math.ceil(keys.length / 2)).forEach((k) => localStorage.removeItem(k));
}

/* ---------- Fetch ---------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Global throttle: every live TVMaze call is spaced by REQUEST_GAP_MS.
let lastCallTs = 0;
async function throttledJson(url) {
  const wait = REQUEST_GAP_MS - (Date.now() - lastCallTs);
  if (wait > 0) await sleep(wait);
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url);
    lastCallTs = Date.now();
    if (res.status === 429) { await sleep(2000); continue; }
    if (!res.ok) throw new Error(`TVMaze ${res.status}`);
    return res.json();
  }
  throw new Error("TVMaze rate limit persistant");
}

// Keep only the fields the UI needs, to stay within localStorage quota.
// `channel` unifies broadcast network and streaming webChannel; precedence
// follows the source schedule (web items are labelled by their platform).
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

// Rebuild a full show object from the TVmaze /shows/{id} payload — used to rehydrate
// a lean favorite (only { id, name } is persisted; everything else is fetched by id).
function showFromTvmaze(d) {
  const chan = d.network || d.webChannel;
  return {
    id: d.id,
    name: d.name,
    genres: d.genres || [],
    channel: chan ? { name: chan.name, streaming: !d.network && !!d.webChannel } : null,
    image: d.image ? { medium: d.image.medium, original: d.image.original } : null,
    summary: d.summary || "",
    premiered: d.premiered || null,
    status: d.status || null,
  };
}

// Same, from a TMDB tv/{id} payload (French channels use the "tmdb:" id prefix).
function showFromTmdb(d, id) {
  return {
    id,
    name: d.name,
    genres: (d.genres || []).map((g) => g.name),
    channel: { name: tmdbChannel(d.networks), streaming: false },
    image: d.poster_path
      ? { medium: TMDB_IMG + d.poster_path, original: TMDB_IMG_ORIG + d.poster_path }
      : null,
    summary: d.overview ? `<p>${escapeHtml(d.overview)}</p>` : "",
    premiered: d.first_air_date || null,
    status: d.status || null,
  };
}

async function fetchDay(dateStr) {
  const cached = readCache(dateStr);
  if (cached) return { data: cached, fromCache: true };

  // 1) Broadcast / cable: US schedule, keep items that have a network.
  const bcRaw = await throttledJson(`${API}/schedule?country=US&date=${dateStr}`);
  const broadcast = bcRaw
    .filter((it) => it.show && it.show.network)
    .map((it) => trimItem(it, it.show, false));

  // 2) Streaming: worldwide web schedule (Netflix/Prime are global), kept via allow-list.
  const webRaw = await throttledJson(`${API}/schedule/web?date=${dateStr}`);
  const streaming = webRaw
    .map((it) => ({ it, s: it._embedded && it._embedded.show }))
    .filter(({ s }) => {
      const chan = s && (s.webChannel || s.network);
      return chan && STREAMING_ALLOWLIST.test(chan.name);
    })
    .map(({ it, s }) => trimItem(it, s, true));

  const data = [...broadcast, ...streaming];
  writeCache(dateStr, data);
  return { data, fromCache: false };
}

/* ---------- French channels via TMDB ---------- */
const tmdb = (path) =>
  fetch(`https://api.themoviedb.org/3/${path}${path.includes("?") ? "&" : "?"}api_key=${TMDB_KEY}`)
    .then((r) => { if (!r.ok) throw new Error(`TMDB ${r.status}`); return r.json(); });

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
      image: show.poster_path
        ? { medium: TMDB_IMG + show.poster_path, original: TMDB_IMG_ORIG + show.poster_path }
        : null,
      summary: show.overview ? `<p>${escapeHtml(show.overview)}</p>` : "",
      premiered: show.first_air_date || null,
    },
  };
}

// One TMDB pass per month (Canal+ / ARTE episodes airing in the window).
async function fetchFrMonth(firstOfMonth) {
  if (!TMDB_KEY) return []; // no key configured → skip French channels
  const gte = ymd(firstOfMonth);
  const lastDay = ymd(new Date(firstOfMonth.getFullYear(), firstOfMonth.getMonth() + 1, 0));
  const monthKey = gte.slice(0, 7);

  const cached = readTmdbCache(monthKey, lastDay);
  if (cached) return cached;

  const items = [];
  try {
    const disc = await tmdb(
      `discover/tv?with_networks=${TMDB_NETWORKS}&air_date.gte=${gte}&air_date.lte=${lastDay}&sort_by=popularity.desc`
    );
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
  } catch (err) {
    console.error("TMDB FR:", err);
  }

  writeTmdbCache(monthKey, items);
  return items;
}

function readTmdbCache(monthKey, lastDay) {
  try {
    const raw = localStorage.getItem(TMDB_CACHE_PREFIX + monthKey);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (lastDay >= ymd(new Date()) && Date.now() - entry.ts > FUTURE_TTL_MS) return null;
    return entry.data;
  } catch { return null; }
}

function writeTmdbCache(monthKey, data) {
  try { localStorage.setItem(TMDB_CACHE_PREFIX + monthKey, JSON.stringify({ ts: Date.now(), data })); }
  catch { /* ignore quota */ }
}

const MAX_MONTHS = 24;       // safety cap for the infinite scroll
const EMPTY_MONTHS_END = 3;  // stop only after this many consecutive empty months

function monthAt(offset) {
  return new Date(state.firstMonth.getFullYear(), state.firstMonth.getMonth() + offset, 1);
}

function allItems() {
  return state.blocks.flatMap((b) => b.items);
}

// Resolve a show object by id from any source (favorites, search results, or the feed).
function showFor(id) {
  return state.showCache[id] || state.favorites[id] || state.searchShows[id] ||
    ((allItems().find((x) => String(x.show.id) === String(id)) || {}).show);
}

// Migrate legacy full-snapshot favorites (from before the lean format) to { id, name },
// seeding the session cache with the old data so nothing needs re-fetching right now.
function normalizeFavorites() {
  let changed = false;
  for (const [id, fav] of Object.entries(state.favorites)) {
    if (fav && (fav.summary !== undefined || fav.image !== undefined || fav.channel !== undefined)) {
      state.showCache[id] = fav;
      state.favorites[id] = { id: fav.id, name: fav.name };
      changed = true;
    }
  }
  if (changed) saveFavorites();
}

// Load the next month's data, appending a block and rendering it progressively.
async function loadNextMonth() {
  if (state.loading || state.reachedEnd || state.blocks.length >= MAX_MONTHS) return;
  state.loading = true;
  setSentinel(`Loading ${monthLabel(monthAt(state.blocks.length))}…`);

  const month = monthAt(state.blocks.length);
  const block = { month, items: [], el: null };
  state.blocks.push(block);
  block.el = createBlockEl(block);

  const days = monthDays(month);
  let lastRender = 0;
  for (const day of days) {
    try {
      const res = await fetchDay(day);
      block.items.push(...res.data);
    } catch (err) {
      console.error(err);
      continue;
    }
    const now = Date.now();
    if (now - lastRender > 250) { lastRender = now; rebuildFilterOptions(); renderBlock(block); }
  }
  block.items.push(...(await fetchFrMonth(month)));
  rebuildFilterOptions();
  renderBlock(block);
  updateResultCount();

  state.loading = false;
  // A single empty month isn't the end (a far-future month may simply have no data yet).
  // Only stop after several empty months in a row so the feed keeps flowing past gaps.
  if (block.items.length === 0) {
    state.emptyStreak += 1;
    if (state.emptyStreak >= EMPTY_MONTHS_END) { state.reachedEnd = true; setSentinel("No further scheduling data."); return; }
  } else {
    state.emptyStreak = 0;
  }
  setSentinel("");

  // Auto-fill the viewport while the page is too short to scroll. Guard against
  // restrictive filters (raw data but 0 visible cards) chaining through many months:
  // only keep auto-loading past the first few months when the block actually rendered cards.
  const visibleCount = dedupeSort(visibleItemsIn(block.items)).length;
  const sentinelNear = sentinelEl.getBoundingClientRect().top < window.innerHeight + 200;
  if (state.view === "month" && sentinelNear && (visibleCount > 0 || state.blocks.length < 3)) {
    loadNextMonth();
  }
}

/* ---------- Catalog search (TVMaze /search/shows) ---------- */
// Debounced title search across the whole TVMaze catalog — finds shows even when they
// have no upcoming premiere in the loaded feed (e.g. ended shows), with a status label.
let searchTimer;
function onSearchInput(value) {
  state.search = value.trim();
  el.searchClear.hidden = !value;
  clearTimeout(searchTimer);
  if (state.search.length >= 2) searchTimer = setTimeout(runCatalogSearch, 350);
  else exitSearch();
}

function trimSearchShow(s) {
  const chan = s.network || s.webChannel;
  return {
    id: s.id,
    name: s.name,
    genres: s.genres || [],
    channel: chan ? { name: chan.name, streaming: !s.network && !!s.webChannel } : null,
    image: s.image ? { medium: s.image.medium, original: s.image.original } : null,
    summary: s.summary || "",
    premiered: s.premiered || null,
    status: s.status || "",
  };
}

async function runCatalogSearch() {
  if (state.view !== "month") return;
  const q = state.search;
  state.searching = true;
  el.grid.innerHTML = '<div class="sentinel">Searching…</div>';
  el.resultCount.textContent = "";
  let results = [];
  try { results = await throttledJson(`${API}/search/shows?q=${encodeURIComponent(q)}`); }
  catch (e) { console.error(e); }
  if (state.search !== q || !state.searching) return; // superseded by newer input
  const shows = results.map((r) => trimSearchShow(r.show));
  state.searchShows = {};
  shows.forEach((s) => { state.searchShows[s.id] = s; });
  renderSearchResults(shows, q);
}

function renderSearchResults(shows, q) {
  el.resultCount.textContent = `${shows.length} result${shows.length !== 1 ? "s" : ""}`;
  if (!shows.length) {
    el.grid.innerHTML = `<p class="empty">No shows found for “${escapeHtml(q)}”.</p>`;
    return;
  }
  el.grid.innerHTML =
    `<section class="month-block"><h2 class="month-heading">Search results</h2>` +
    `<div class="month-grid">${shows.map(searchCardHtml).join("")}</div></section>`;
  wireCards(el.grid);
}

function exitSearch() {
  if (!state.searching) return;
  state.searching = false;
  state.searchShows = {};
  enterMonthView();
}

function statusLabel(show) {
  return ({
    "Running": "Running",
    "Ended": "Ended",
    "To Be Determined": "TBD",
    "In Development": "In development",
  })[show.status] || show.status || "—";
}

function searchCardHtml(show) {
  const chan = show.channel ? show.channel.name : "—";
  return `
    <article class="card" role="button" tabindex="0" aria-label="${escapeAttr(`${show.name}, ${chan}. View details`)}" data-show-id="${escapeAttr(String(show.id))}">
      ${favBtnHtml(show.id)}
      ${imageHtml(show)}
      <div class="card-body">
        <div class="card-status">${escapeHtml(statusLabel(show))}</div>
        <h3 class="card-title">${escapeHtml(show.name)}</h3>
        <div class="card-meta">${chanMetaHtml(show.channel)}</div>
        ${watchLinkHtml(show.channel && show.channel.name, show.name, "card-watch")}
      </div>
    </article>`;
}

/* ---------- Filtering ---------- */
function visibleItemsIn(items) {
  const filtering = state.followed.size > 0;
  return items.filter((it) => {
    if (state.premieresOnly && it.number !== 1) return false;
    if (state.hidePast && isPastDate(it.airdate)) return false;
    if (filtering && (!it.show.channel || !state.followed.has(it.show.channel.name))) return false;
    if (state.genres.size && !it.show.genres.some((g) => state.genres.has(g))) return false;
    return true;
  });
}

// Dedupe by show+airdate and sort chronologically.
function dedupeSort(items) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const key = `${it.show.id}:${it.airdate}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  out.sort((a, b) => a.airdate.localeCompare(b.airdate) || a.show.name.localeCompare(b.show.name));
  return out;
}

function rebuildFilterOptions() {
  const genres = new Set();
  let added = false;
  for (const it of allItems()) {
    if (it.show.channel && !state.known.has(it.show.channel.name)) {
      state.known.add(it.show.channel.name);
      added = true;
    }
    it.show.genres.forEach((g) => genres.add(g));
  }
  if (added) saveSet(KNOWN_KEY, state.known);
  state.availableGenres = genres;
  renderGenreList();
  renderNetworkList();
}

function renderGenreList() {
  const q = state.genreSearch.trim().toLowerCase();
  const names = [...state.availableGenres]
    .filter((n) => !q || n.toLowerCase().includes(q))
    .sort((a, b) => a.localeCompare(b, "en"));
  if (names.length === 0) {
    el.genreList.innerHTML = `<div class="none">${state.availableGenres.size ? "No genre matches." : "No genres yet."}</div>`;
  } else {
    el.genreList.innerHTML = names.map((n) => {
      const checked = state.genres.has(n) ? "checked" : "";
      return `<label><input type="checkbox" value="${escapeAttr(n)}" ${checked}>${escapeHtml(n)}</label>`;
    }).join("");
    el.genreList.querySelectorAll("input").forEach((cb) => {
      cb.addEventListener("change", () => toggleGenre(cb.value, cb.checked));
    });
  }
  updateGenreButton();
}

function toggleGenre(name, on) {
  if (on) state.genres.add(name);
  else state.genres.delete(name);
  updateGenreButton();
  renderAllBlocks();
}

function updateGenreButton() {
  const n = state.genres.size;
  el.genreBtn.childNodes[0].nodeValue = n === 0 ? "All " : "Selected ";
  el.genreBtnCount.textContent = n > 0 ? String(n) : "";
  el.genreBtnCount.classList.toggle("show", n > 0);
}

function renderNetworkList() {
  const q = state.networkSearch.trim().toLowerCase();
  const names = [...state.known]
    .filter((n) => !q || n.toLowerCase().includes(q))
    .sort((a, b) => a.localeCompare(b, "en"));

  if (names.length === 0) {
    el.networkList.innerHTML = '<div class="none">No channel matches.</div>';
  } else {
    el.networkList.innerHTML = names.map((n) => {
      const checked = state.followed.has(n) ? "checked" : "";
      return `<label><input type="checkbox" value="${escapeAttr(n)}" ${checked}>${escapeHtml(n)}</label>`;
    }).join("");
    el.networkList.querySelectorAll("input").forEach((cb) => {
      cb.addEventListener("change", () => toggleNetwork(cb.value, cb.checked));
    });
  }
  updateNetworkButton();
}

function toggleNetwork(name, on) {
  if (on) state.followed.add(name);
  else state.followed.delete(name);
  saveSet(FOLLOW_KEY, state.followed);
  dropNetworkHash();       // user is hand-editing the selection now
  updateNetworkButton();
  updateActiveNetwork();
  renderAllBlocks();
}

// Quick filter: narrow the feed to a single network via the URL hash. Transient and
// reversible — Back, Reset, or the ✕ pill restores the saved channel selection.
function filterToNetwork(name) {
  state.known.add(name);
  saveSet(KNOWN_KEY, state.known);
  location.hash = "network=" + encodeURIComponent(name);
  toast(`Showing ${name} only`);
}

function updateNetworkButton() {
  const n = state.followed.size;
  el.networkBtn.childNodes[0].nodeValue = n === 0 ? "All " : "Selected ";
  el.networkBtnCount.textContent = n > 0 ? String(n) : "";
  el.networkBtnCount.classList.toggle("show", n > 0);
}

/* ---------- Render (month blocks + infinite scroll) ---------- */
const sentinelEl = document.createElement("div");
sentinelEl.className = "sentinel";
const scrollObserver = new IntersectionObserver((entries) => {
  if (entries[0].isIntersecting && state.view === "month" && !state.loading && !state.searching) loadNextMonth();
}, { rootMargin: "600px" });

function setSentinel(text) { sentinelEl.textContent = text; }

// (Re)build the month view from state.blocks — used on boot and when returning from watchlist.
function enterMonthView() {
  el.grid.innerHTML = "";
  el.grid.appendChild(sentinelEl);
  for (const b of state.blocks) { b.el = createBlockEl(b); renderBlock(b); }
  updateResultCount();
  if (state.blocks.length === 0) loadNextMonth();
}

function createBlockEl(block) {
  const sec = document.createElement("section");
  sec.className = "month-block";
  sec.innerHTML =
    `<h2 class="month-heading">${escapeHtml(monthLabel(block.month))}</h2>` +
    `<div class="month-grid"></div>` +
    `<p class="month-empty" hidden>No shows match these filters this month.</p>`;
  el.grid.insertBefore(sec, sentinelEl);
  return sec;
}

function renderBlock(block) {
  if (!block.el) return;
  const grid = block.el.querySelector(".month-grid");
  const emptyEl = block.el.querySelector(".month-empty");
  const cards = dedupeSort(visibleItemsIn(block.items));
  if (cards.length === 0) {
    grid.innerHTML = "";
    emptyEl.hidden = false;
  } else {
    emptyEl.hidden = true;
    grid.innerHTML = cards.map(cardHtml).join("");
    wireCards(grid);
  }
}

function renderAllBlocks() {
  for (const b of state.blocks) renderBlock(b);
  updateResultCount();
}

function updateResultCount() {
  let n = 0;
  for (const b of state.blocks) n += dedupeSort(visibleItemsIn(b.items)).length;
  el.resultCount.textContent = `${n} result${n !== 1 ? "s" : ""}`;
}

// Shared card wiring for month blocks and the watchlist grid.
function wireCards(container) {
  container.querySelectorAll(".card").forEach((c) => {
    const id = c.dataset.showId;
    const airdate = c.dataset.airdate;
    c.addEventListener("click", () => openFromCard(c));
    // Keyboard activation for the role="button" card (ignore keys from inner controls).
    c.addEventListener("keydown", (e) => {
      if (e.target !== c) return;
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openFromCard(c); }
    });
    c.querySelector(".fav-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      toggleFav(id);
    });
    const watch = c.querySelector(".card-watch");
    if (watch) watch.addEventListener("click", (e) => e.stopPropagation());
    const chan = c.querySelector(".chan-link");
    if (chan) chan.addEventListener("click", (e) => { e.stopPropagation(); filterToNetwork(chan.dataset.chan); });
  });
}

/* ---------- Favorites & Watchlist ---------- */
function toggleFav(id, showObj) {
  if (state.favorites[id]) {
    delete state.favorites[id];
  } else {
    const show = showObj || showFor(id);
    if (!show) return;
    state.favorites[id] = { id: show.id, name: show.name }; // lean; details re-fetchable by id
    state.showCache[id] = show;                             // keep full data for this session
  }
  saveFavorites();
  updateViewButton();
  if (state.view === "watchlist") { renderWatchlist(); return; }
  // Month view: update the star buttons in place (a show may appear in several months).
  const on = !!state.favorites[id];
  document.querySelectorAll(`.fav-btn[data-fav="${CSS.escape(String(id))}"]`).forEach((b) => {
    b.classList.toggle("on", on);
    b.textContent = on ? "★" : "☆";
    b.setAttribute("aria-pressed", String(on));
    b.setAttribute("aria-label", on ? "Remove from watchlist" : "Add to watchlist");
  });
}

// URL routing via the hash: "#watchlist" or "#network=<name>" (bookmarkable).
function parseHash() {
  const raw = location.hash.replace(/^#/, "");
  if (raw === "watchlist") return { view: "watchlist", network: null };
  if (raw.startsWith("network=")) return { view: "month", network: decodeURIComponent(raw.slice(8)) };
  return { view: "month", network: null };
}

// A network in the URL filters the feed transiently — it reflects the link, it does not
// overwrite the user's saved channel selection (that returns on a plain reload).
function applyRoute() {
  const { view, network } = parseHash();
  state.followed = network ? new Set([network]) : new Set(loadFollowed());
  if (network) state.known.add(network);
  updateNetworkButton();
  updateActiveNetwork();
  renderNetworkList();
  setView(view);
}

// The removable "Netflix ✕" pill shown while a transient network filter is active.
function updateActiveNetwork() {
  const { network } = parseHash();
  if (network) {
    el.clearNetwork.hidden = false;
    el.clearNetwork.innerHTML = `${escapeHtml(network)} <span aria-hidden="true">✕</span>`;
    el.clearNetwork.setAttribute("aria-label", `Clear ${network} filter`);
  } else {
    el.clearNetwork.hidden = true;
  }
}

// Silently drop a "#network=" hash (used when the user edits the selection by hand, so the
// URL doesn't misrepresent it) without firing a route change.
function dropNetworkHash() {
  if (location.hash.startsWith("#network=")) history.replaceState(null, "", location.pathname + location.search);
}

function setView(v) {
  // A catalog search belongs to the feed only — reset it when changing views.
  if (state.searching || state.search) {
    state.searching = false;
    state.searchShows = {};
    state.search = "";
    el.searchInput.value = "";
    el.searchClear.hidden = true;
  }
  state.view = v;
  document.body.setAttribute("data-view", v);
  updateViewButton();
  window.scrollTo(0, 0);
  if (v === "watchlist") renderWatchlist();
  else enterMonthView();
}

function updateViewButton() {
  const n = Object.keys(state.favorites).length;
  el.viewBtn.innerHTML = state.view === "watchlist"
    ? "‹ Browse"
    : `★ Watchlist${n ? ` <span class="count">${n}</span>` : ""}`;
}

async function renderWatchlist() {
  el.resultCount.textContent = "";
  const favs = Object.values(state.favorites);

  if (favs.length === 0) {
    el.grid.innerHTML = '<p class="empty">No favorites yet. Tap the ☆ on any show to add it to your watchlist.</p>';
    return;
  }

  // Group by the month of each show's next episode → need those dates first.
  if (favs.some((s) => state.nextEp[s.id] === undefined)) {
    el.grid.innerHTML = '<div class="sentinel">Loading your watchlist…</div>';
  }
  await Promise.all(favs.map(ensureNextEpisode));
  if (state.view !== "watchlist") return; // user navigated away while loading

  const groups = new Map(); // monthKey -> { label, sortKey, shows: [] }
  for (const show of favs) {
    const ep = state.nextEp[show.id];
    const key = ep && ep.airdate ? ep.airdate.slice(0, 7) : "none";
    if (!groups.has(key)) {
      groups.set(key, ep && ep.airdate
        ? { label: monthLabel(new Date(ep.airdate + "T00:00:00")), sortKey: key, shows: [] }
        : { label: "No upcoming episode", sortKey: "9999-99", shows: [] });
    }
    groups.get(key).shows.push(show);
  }

  const ordered = [...groups.values()].sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  el.grid.innerHTML = ordered.map((g) => {
    const cards = g.shows
      .sort((a, b) => {
        const ea = state.nextEp[a.id], eb = state.nextEp[b.id];
        return ((ea && ea.airdate) || "9999").localeCompare((eb && eb.airdate) || "9999") ||
          a.name.localeCompare(b.name);
      })
      .map(watchlistCardHtml).join("");
    return `<section class="month-block"><h2 class="month-heading">${escapeHtml(g.label)}</h2><div class="month-grid">${cards}</div></section>`;
  }).join("");
  wireCards(el.grid);
}

function watchlistCardHtml(fav) {
  const show = showFor(fav.id) || fav; // fav is lean { id, name }; details come from the hydration cache
  const chan = show.channel ? show.channel.name : "—";
  return `
    <article class="card" role="button" tabindex="0" aria-label="${escapeAttr(`${show.name}, ${chan}. View details`)}" data-show-id="${escapeAttr(String(show.id))}">
      ${favBtnHtml(show.id)}
      ${imageHtml(show)}
      <div class="card-body">
        <div class="card-date">${escapeHtml(nextEpLabel(state.nextEp[show.id]))}</div>
        <h3 class="card-title">${escapeHtml(show.name)}</h3>
        <div class="card-meta">${chanMetaHtml(show.channel)}</div>
        ${watchLinkHtml(show.channel && show.channel.name, show.name, "card-watch")}
      </div>
    </article>`;
}

function nextEpLabel(ep) {
  if (ep === undefined) return "…";
  if (ep === null) return "No upcoming episode";
  return `${formatDay(ep.airdate)} · ${ep.label}`;
}

function epContext(id) {
  const ep = state.nextEp[id];
  return ep ? { airdate: ep.airdate, season: ep.season, number: ep.number } : null;
}

async function ensureNextEpisode(show) {
  const id = show.id;
  if (state.nextEp[id] !== undefined) return state.nextEp[id];

  let ep = null;
  try {
    if (String(id).startsWith("tmdb:")) {
      if (TMDB_KEY) {
        const d = await tmdb(`tv/${String(id).slice(5)}`);
        state.showCache[id] = showFromTmdb(d, id); // rehydrate the lean favorite from the same call
        const e = d.next_episode_to_air;
        if (e) ep = { airdate: e.air_date, season: e.season_number, number: e.episode_number, label: `S${e.season_number}E${e.episode_number}` };
      }
    } else {
      // This call already returns the full show — cache it so lean favorites render
      // (poster, channel, summary) without a second request.
      const d = await throttledJson(`${API}/shows/${id}?embed=nextepisode`);
      state.showCache[id] = showFromTvmaze(d);
      const e = d._embedded && d._embedded.nextepisode;
      if (e) ep = { airdate: e.airdate, season: e.season, number: e.number, label: `S${e.season}E${e.number}` };
    }
  } catch { ep = null; }

  state.nextEp[id] = ep;
  return ep;
}

function favBtnHtml(id) {
  const on = !!state.favorites[id];
  return `<button class="fav-btn ${on ? "on" : ""}" data-fav="${escapeAttr(String(id))}" title="Toggle favorite" aria-label="Add to watchlist" aria-pressed="${on}">${on ? "★" : "☆"}</button>`;
}

function imageHtml(show) {
  return show.image
    ? `<img class="card-img" loading="lazy" src="${escapeAttr(show.image.medium)}" alt="${escapeAttr(show.name)}">`
    : `<div class="card-no-img">${escapeHtml(show.name)}</div>`;
}

// "Watch on <platform>" links. Platforms rarely expose a stable on-site search URL, so we
// use a site-scoped Google search per provider; anything unlisted falls back to JustWatch.
const WATCH_DOMAINS = {
  "Netflix": "netflix.com",
  "Prime Video": "primevideo.com",
  "Hulu": "hulu.com",
  "Disney+": "disneyplus.com",
  "Max": "max.com",
  "HBO": "max.com",
  "Apple TV": "tv.apple.com",
  "Peacock": "peacocktv.com",
  "Paramount+": "paramountplus.com",
  "Showtime": "paramountplus.com",
  "Canal+": "canalplus.com",
  "ARTE": "arte.tv",
  "TF1": "tf1.fr",
  "M6": "m6.fr",
  "France 2": "france.tv",
  "France 3": "france.tv",
};

// Optional user remap: e.g. a show on "Apple TV" watched via "Canal+".
function resolveProvider(channelName) {
  return (channelName && state.watchOverrides[channelName]) || channelName;
}

function watchUrl(channelName, title) {
  const q = encodeURIComponent(title);
  const domain = WATCH_DOMAINS[resolveProvider(channelName)];
  return domain
    ? `https://www.google.com/search?q=site:${domain}+${q}`
    : `https://www.justwatch.com/us/search?q=${q}`;
}

// Official domains per channel → used to fetch a small network favicon.
const NETWORK_DOMAINS = {
  "ABC": "abc.com", "CBS": "cbs.com", "NBC": "nbc.com", "FOX": "fox.com",
  "The CW": "cwtv.com", "PBS": "pbs.org",
  "AMC": "amc.com", "FX": "fxnetworks.com", "FXX": "fxnetworks.com",
  "USA Network": "usanetwork.com", "TNT": "tntdrama.com", "TBS": "tbs.com",
  "HBO": "hbo.com", "Showtime": "sho.com", "Starz": "starz.com",
  "A&E": "aetv.com", "History": "history.com", "Bravo": "bravotv.com",
  "E!": "eonline.com", "Syfy": "syfy.com", "Comedy Central": "cc.com", "MTV": "mtv.com",
  "Cartoon Network": "cartoonnetwork.com", "Adult Swim": "adultswim.com",
  "Nickelodeon": "nick.com", "Disney Channel": "disneynow.com", "Freeform": "freeform.com",
  "TLC": "tlc.com", "HGTV": "hgtv.com", "Food Network": "foodnetwork.com",
  "Discovery Channel": "discovery.com", "National Geographic": "nationalgeographic.com",
  "Lifetime": "mylifetime.com", "Hallmark Channel": "hallmarkchannel.com",
  "Paramount Network": "paramountnetwork.com", "BET": "bet.com", "truTV": "trutv.com",
  "Netflix": "netflix.com", "Prime Video": "primevideo.com", "Hulu": "hulu.com",
  "Disney+": "disneyplus.com", "Max": "max.com", "Apple TV": "tv.apple.com",
  "Peacock": "peacocktv.com", "Paramount+": "paramountplus.com", "AMC+": "amcplus.com",
  "Shudder": "shudder.com", "ESPN+": "espn.com",
  "Canal+": "canalplus.com", "ARTE": "arte.tv", "TF1": "tf1.fr", "M6": "m6.fr",
  "France 2": "france.tv", "France 3": "france.tv",
};

// Deterministic chip color from the channel name (for the initial fallback).
function chipColor(name) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h} 55% 42%)`;
}

function channelIconHtml(channelName) {
  const domain = channelName && NETWORK_DOMAINS[channelName];
  if (!domain) return "";
  const initial = escapeAttr(channelName.trim()[0].toUpperCase());
  // Favicon with a graceful fallback: if it fails to load, drop it and show a colored
  // initial chip instead (no broken image, no lingering Google dependency).
  return `<span class="channel-chip" data-initial="${initial}" style="--chip-bg:${chipColor(channelName)}">` +
    `<img src="https://www.google.com/s2/favicons?domain=${domain}&sz=64" alt="" loading="lazy" ` +
    `onerror="this.remove();this.parentNode.classList.add('is-initial')"></span>`;
}

function watchLinkHtml(channelName, title, cls) {
  const provider = resolveProvider(channelName);
  const label = provider ? `Watch on ${escapeHtml(provider)}` : "Where to watch";
  return `<a class="${cls}" href="${escapeAttr(watchUrl(channelName, title))}" target="_blank" rel="noopener">▸ ${label}</a>`;
}

// Card meta line: channel name as a quick-filter link (+ streaming tag).
function chanMetaHtml(channel) {
  if (!channel) return "—";
  const stream = channel.streaming ? ' <span class="tag-stream">streaming</span>' : "";
  return `<button class="chan-link" data-chan="${escapeAttr(channel.name)}" title="Show ${escapeAttr(channel.name)} only">${escapeHtml(channel.name)}</button>${stream}`;
}

function cardHtml(it) {
  const chan = it.show.channel ? it.show.channel.name : "—";
  const past = isPastDate(it.airdate);
  const premiere = it.number === 1
    ? (it.season === 1 ? "Series premiere" : `Season ${it.season}`)
    : `S${it.season}E${it.number}`;
  return `
    <article class="card${past ? " past" : ""}" role="button" tabindex="0" aria-label="${escapeAttr(`${it.show.name} — ${formatDay(it.airdate)}${past ? " (aired)" : ""}, ${chan}. View details`)}" data-show-id="${escapeAttr(String(it.show.id))}" data-airdate="${escapeAttr(it.airdate)}">
      ${favBtnHtml(it.show.id)}
      ${imageHtml(it.show)}
      <div class="card-body">
        <div class="card-date">${formatDay(it.airdate)}</div>
        <h3 class="card-title">${escapeHtml(it.show.name)}</h3>
        <div class="card-meta">${chanMetaHtml(it.show.channel)}</div>
        <span class="badge">${escapeHtml(premiere)}</span>
        ${watchLinkHtml(it.show.channel && it.show.channel.name, it.show.name, "card-watch")}
      </div>
    </article>`;
}

function formatDay(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

/* ---------- Modal ---------- */
let lastFocused = null;

// Open the detail modal for a card, remembering it so prev/next can walk the feed.
function openFromCard(c) {
  state.navCard = c;
  const id = c.dataset.showId;
  const airdate = c.dataset.airdate;
  if (airdate) openModal(id, airdate);
  else showModal(showFor(id), epContext(id));
  updateModalNav();
}

// Step to the previous/next visible card (dir = -1 | 1) without leaving the modal.
function modalNav(dir) {
  if (!state.navCard) return;
  const cards = [...el.grid.querySelectorAll(".card")];
  const idx = cards.indexOf(state.navCard);
  const next = idx === -1 ? null : cards[idx + dir];
  if (!next) return;
  next.scrollIntoView({ block: "nearest" });
  openFromCard(next);
}

function updateModalNav() {
  const cards = state.navCard ? [...el.grid.querySelectorAll(".card")] : [];
  const idx = state.navCard ? cards.indexOf(state.navCard) : -1;
  el.modalPrev.hidden = idx <= 0;
  el.modalNext.hidden = idx === -1 || idx >= cards.length - 1;
}

// Reveal the modal with an accessible name, remembering the trigger so focus can
// return to it on close, and move focus inside the dialog.
function revealModal(label) {
  el.modalCard.setAttribute("aria-label", label);
  if (!el.modal.hidden) return; // already open (carousel navigation swapped content in place)
  lastFocused = document.activeElement;
  el.modal.hidden = false;
  const closeBtn = el.modal.querySelector(".modal-close");
  (closeBtn || el.modalCard).focus();
}

function openModal(showId, airdate) {
  const it = allItems().find((x) => String(x.show.id) === String(showId) && x.airdate === airdate);
  if (it) showModal(it.show, { airdate: it.airdate, season: it.season, number: it.number });
}

function showModal(s, ep) {
  if (!s) return;
  const img = s.image ? `<img src="${escapeAttr(s.image.original || s.image.medium)}" alt="">` : "";
  const genreList = s.genres || []; // a lean favorite that failed to hydrate has no genres
  const genres = genreList.length
    ? `<div class="modal-genres">${genreList.map((g) => `<span class="badge">${escapeHtml(g)}</span>`).join(" ")}</div>`
    : "";
  const summary = s.summary || "<p>No summary available.</p>";

  const sub = [s.channel ? s.channel.name + (s.channel.streaming ? " (streaming)" : "") : "—"];
  if (ep && ep.airdate) sub.push(formatDay(ep.airdate));
  else if (s.status) sub.push(s.status);
  if (ep && ep.season != null) sub.push(`S${ep.season}E${ep.number}`);

  const favOn = state.favorites[s.id] ? "on" : "";
  const watch = watchLinkHtml(s.channel && s.channel.name, s.name, "modal-watch");
  // epguides episode guide — path is the title with non-alphanumerics stripped
  // (epguides runs on a case-insensitive server, so casing doesn't matter).
  const guideUrl = `https://epguides.com/${s.name.replace(/[^A-Za-z0-9]/g, "")}/`;
  el.modalBody.innerHTML = `
    <div class="modal-head">
      ${img}
      <div>
        <h2 class="modal-title">${escapeHtml(s.name)}</h2>
        <p class="modal-sub">${s.channel ? channelIconHtml(s.channel.name) : ""}${escapeHtml(sub.join(" · "))}</p>
        ${genres}
        <div class="modal-actions">
          ${watch}
          <button class="modal-fav ${favOn}" aria-pressed="${!!favOn}">${favOn ? "★ In watchlist" : "☆ Add to watchlist"}</button>
          <a class="modal-epguides" href="${escapeAttr(guideUrl)}" target="_blank" rel="noopener">Episode guide ↗</a>
        </div>
      </div>
    </div>
    <div class="modal-summary">${summary}</div>`;

  const favBtn = el.modalBody.querySelector(".modal-fav");
  favBtn.addEventListener("click", () => {
    toggleFav(s.id, s);
    const on = !!state.favorites[s.id];
    favBtn.classList.toggle("on", on);
    favBtn.textContent = on ? "★ In watchlist" : "☆ Add to watchlist";
    favBtn.setAttribute("aria-pressed", String(on));
  });

  revealModal(s.name);
}

function closeModal() {
  el.modal.hidden = true;
  state.navCard = null;
  if (lastFocused && typeof lastFocused.focus === "function") lastFocused.focus();
  lastFocused = null;
}

/* ---------- Changelog ---------- */
// Minimal, safe Markdown → HTML for our own CHANGELOG.md (escape first, then format).
function renderMarkdown(md) {
  const inline = (s) => escapeHtml(s)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  let html = "";
  let inList = false;
  const closeList = () => { if (inList) { html += "</ul>"; inList = false; } };
  for (const raw of md.split("\n")) {
    const line = raw.trimEnd();
    if (/^###\s+/.test(line)) { closeList(); html += `<h4>${inline(line.replace(/^###\s+/, ""))}</h4>`; }
    else if (/^##\s+/.test(line)) { closeList(); html += `<h3>${inline(line.replace(/^##\s+/, ""))}</h3>`; }
    else if (/^#\s+/.test(line)) { closeList(); html += `<h2>${inline(line.replace(/^#\s+/, ""))}</h2>`; }
    else if (/^[-*]\s+/.test(line)) { if (!inList) { html += "<ul>"; inList = true; } html += `<li>${inline(line.replace(/^[-*]\s+/, ""))}</li>`; }
    else if (line === "") { closeList(); }
    else { closeList(); html += `<p>${inline(line)}</p>`; }
  }
  closeList();
  return html;
}

async function showChangelog() {
  state.navCard = null;
  el.modalBody.innerHTML = '<div class="modal-summary">Loading…</div>';
  revealModal("Changelog");
  updateModalNav();
  try {
    const res = await fetch(`CHANGELOG.md?v=${APP_VERSION}`);
    if (!res.ok) throw new Error(res.status);
    el.modalBody.innerHTML = `<div class="changelog">${renderMarkdown(await res.text())}</div>`;
  } catch {
    el.modalBody.innerHTML = '<div class="modal-summary">Changelog unavailable.</div>';
  }
}

/* ---------- Watch settings (channel → provider overrides) ---------- */
function saveOverrides() {
  try { localStorage.setItem(OVERRIDES_KEY, JSON.stringify(state.watchOverrides)); }
  catch { toast("Storage full — watch settings may not be saved."); }
}

// Every channel the user could pick as a source or a watch provider.
function allProviderNames() {
  return [...new Set([...state.known, ...Object.keys(WATCH_DOMAINS), ...Object.keys(NETWORK_DOMAINS)])]
    .sort((a, b) => a.localeCompare(b, "en"));
}

function providerOptions(selected) {
  return allProviderNames()
    .map((n) => `<option value="${escapeAttr(n)}" ${n === selected ? "selected" : ""}>${escapeHtml(n)}</option>`)
    .join("");
}

function showSettings() {
  state.navCard = null;
  renderSettings();
  revealModal("Settings");
  updateModalNav();
}

function renderSettings() {
  const rows = Object.entries(state.watchOverrides).map(([src, tgt]) => `
    <div class="ov-row">
      <select class="ov-src" aria-label="Source channel">${providerOptions(src)}</select>
      <span class="ov-arrow" aria-hidden="true">→</span>
      <select class="ov-tgt" aria-label="Watch provider">${providerOptions(tgt)}</select>
      <button class="ov-del icon-btn" aria-label="Remove mapping">×</button>
    </div>`).join("");

  el.modalBody.innerHTML = `
    <div class="settings">
      <h2 class="modal-title">Settings</h2>

      <h3 class="settings-h">French channels</h3>
      <p class="settings-note">Add your free <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noopener">TMDB API key</a> to load the French channels (Canal+, Arte, TF1, M6, France 2/3). Stored only in this browser.</p>
      <div class="tmdb-row">
        <input type="password" id="tmdbKeyInput" class="tmdb-input" placeholder="TMDB API key" value="${escapeAttr(TMDB_KEY)}" autocomplete="off">
        <button type="button" class="tmdb-save">Save</button>
      </div>

      <h3 class="settings-h">Watch redirects</h3>
      <p class="settings-note">Send a channel's “Watch on” link to a provider you already have
        (e.g. a show on Apple TV → Watch on Canal+).</p>
      <div class="ov-list">${rows || '<p class="ov-empty">No mappings yet.</p>'}</div>
      <button type="button" class="ov-add">+ Add mapping</button>
    </div>`;
  wireSettings();
}

function clearTmdbCache() {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (k && k.startsWith(TMDB_CACHE_PREFIX)) localStorage.removeItem(k);
  }
}

function saveTmdbKey(value) {
  const key = value.trim();
  TMDB_KEY = key;
  try { key ? localStorage.setItem(TMDB_KEY_STORAGE, key) : localStorage.removeItem(TMDB_KEY_STORAGE); }
  catch { /* ignore quota */ }
  clearTmdbCache();
  toast(key ? "TMDB key saved — reloading French channels" : "TMDB key cleared");
  // Rebuild the feed from scratch so months re-fetch (now) with the FR channels.
  state.blocks = [];
  state.reachedEnd = false;
  state.emptyStreak = 0;
  if (state.view === "month" && !state.searching) enterMonthView();
}

function wireSettings() {
  const keyInput = el.modalBody.querySelector("#tmdbKeyInput");
  const save = () => saveTmdbKey(keyInput.value);
  el.modalBody.querySelector(".tmdb-save").addEventListener("click", save);
  keyInput.addEventListener("keydown", (e) => { if (e.key === "Enter") save(); });

  el.modalBody.querySelectorAll(".ov-row").forEach((row) => {
    row.querySelector(".ov-src").addEventListener("change", commitSettings);
    row.querySelector(".ov-tgt").addEventListener("change", commitSettings);
    row.querySelector(".ov-del").addEventListener("click", () => { row.remove(); commitSettings(); renderSettings(); });
  });
  el.modalBody.querySelector(".ov-add").addEventListener("click", () => {
    const names = allProviderNames();
    const used = new Set(Object.keys(state.watchOverrides));
    const src = names.find((n) => !used.has(n)) || names[0];
    if (src) { state.watchOverrides[src] = src; saveOverrides(); renderSettings(); }
  });
}

// Rebuild the overrides object from the current rows, then refresh the links.
function commitSettings() {
  const next = {};
  el.modalBody.querySelectorAll(".ov-row").forEach((row) => {
    const s = row.querySelector(".ov-src").value;
    const t = row.querySelector(".ov-tgt").value;
    if (s && t) next[s] = t;
  });
  state.watchOverrides = next;
  saveOverrides();
  if (state.view === "watchlist") renderWatchlist();
  else renderAllBlocks();
}

/* ---------- Escaping ---------- */
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(str) { return escapeHtml(str); }

/* ---------- Preferences export / import ---------- */
const FS_SUPPORTED = "showSaveFilePicker" in window;

function buildPrefs() {
  return {
    app: "lineup",
    version: 1,
    exportedAt: new Date().toISOString(),
    theme: currentTheme,
    followedNetworks: [...state.followed],
    favorites: state.favorites,
    watchOverrides: state.watchOverrides,
  };
}

function applyPrefs(data) {
  if (!data || typeof data !== "object") return;
  // Importing overwrites local state — confirm when there's something to lose.
  const hasData = Object.keys(state.favorites).length > 0 || state.followed.size > 0;
  if (hasData && !confirm("Replace your current favorites, followed channels and settings with this file?")) return;
  if (Array.isArray(data.followedNetworks)) {
    state.followed = new Set(data.followedNetworks);
    saveSet(FOLLOW_KEY, state.followed);
    data.followedNetworks.forEach((n) => state.known.add(n));
    saveSet(KNOWN_KEY, state.known);
  }
  if (data.favorites && typeof data.favorites === "object") {
    state.favorites = data.favorites;
    state.showCache = {};
    normalizeFavorites(); // lean the import if it carries legacy full snapshots; saves too
    saveFavorites();
  }
  if (data.watchOverrides && typeof data.watchOverrides === "object") {
    state.watchOverrides = data.watchOverrides;
    saveOverrides();
  }
  if (data.theme === "light" || data.theme === "dark") {
    currentTheme = data.theme;
    localStorage.setItem(THEME_KEY, currentTheme);
    applyTheme(currentTheme);
  }
  updateViewButton();
  renderNetworkList();
  if (state.view === "watchlist") renderWatchlist();
  else renderAllBlocks();
  toast("Preferences imported");
}

// Tiny IndexedDB kv to remember the chosen prefs file handle.
function idbOpen() {
  return new Promise((res, rej) => {
    const r = indexedDB.open("lineup", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("kv");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbGet(key) {
  const db = await idbOpen();
  return new Promise((res) => {
    const t = db.transaction("kv").objectStore("kv").get(key);
    t.onsuccess = () => res(t.result);
    t.onerror = () => res(null);
  });
}
async function idbSet(key, val) {
  const db = await idbOpen();
  return new Promise((res) => {
    const t = db.transaction("kv", "readwrite").objectStore("kv").put(val, key);
    t.oncomplete = () => res();
    t.onerror = () => res();
  });
}

async function ensurePermission(handle, write) {
  const opts = { mode: write ? "readwrite" : "read" };
  if ((await handle.queryPermission(opts)) === "granted") return true;
  return (await handle.requestPermission(opts)) === "granted";
}

async function exportPrefs() {
  const json = JSON.stringify(buildPrefs(), null, 2);
  if (!FS_SUPPORTED) { downloadJson("lineup-preferences.json", json); return; }
  try {
    let handle = await idbGet("prefsHandle");
    if (handle && !(await ensurePermission(handle, true))) handle = null;
    if (!handle) {
      handle = await window.showSaveFilePicker({
        id: "lineup-prefs",
        suggestedName: "lineup-preferences.json",
        startIn: "documents",
        types: [{ description: "JSON", accept: { "application/json": [".json"] } }],
      });
      await idbSet("prefsHandle", handle);
    }
    const w = await handle.createWritable();
    await w.write(json);
    await w.close();
    toast("Preferences saved");
  } catch (e) {
    if (e.name !== "AbortError") console.error(e);
  }
}

async function importPrefs() {
  if (!FS_SUPPORTED) { el.importFile.click(); return; }
  try {
    let handle = await idbGet("prefsHandle");
    if (handle && !(await ensurePermission(handle, false))) handle = null;
    if (!handle) {
      [handle] = await window.showOpenFilePicker({
        id: "lineup-prefs",
        startIn: "documents",
        types: [{ description: "JSON", accept: { "application/json": [".json"] } }],
      });
      await idbSet("prefsHandle", handle);
    }
    const file = await handle.getFile();
    applyPrefs(JSON.parse(await file.text()));
  } catch (e) {
    if (e.name !== "AbortError") console.error(e);
  }
}

function downloadJson(name, text) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

let toastTimer;
function toast(msg) {
  let t = document.getElementById("toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "toast";
    t.className = "toast";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
}

/* ---------- Events ---------- */
function setNetworkPanel(open) {
  el.networkPanel.hidden = !open;
  el.networkBtn.setAttribute("aria-expanded", String(open));
}
el.networkBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  setNetworkPanel(el.networkPanel.hidden);
});
el.networkSearch.addEventListener("input", (e) => { state.networkSearch = e.target.value; renderNetworkList(); });
el.networkClear.addEventListener("click", () => {
  state.followed.clear();
  saveSet(FOLLOW_KEY, state.followed);
  dropNetworkHash();
  updateActiveNetwork();
  renderNetworkList();
  renderAllBlocks();
});
el.clearNetwork.addEventListener("click", () => { location.hash = ""; });
el.networkPanel.addEventListener("click", (e) => e.stopPropagation());

function setGenrePanel(open) {
  el.genrePanel.hidden = !open;
  el.genreBtn.setAttribute("aria-expanded", String(open));
}
el.genreBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  setGenrePanel(el.genrePanel.hidden);
});
el.genreSearch.addEventListener("input", (e) => { state.genreSearch = e.target.value; renderGenreList(); });
el.genreClear.addEventListener("click", () => {
  state.genres.clear();
  renderGenreList();
  renderAllBlocks();
});
el.genrePanel.addEventListener("click", (e) => e.stopPropagation());

// One outside-click closes any open filter dropdown.
document.addEventListener("click", () => { setNetworkPanel(false); setGenrePanel(false); });

el.premieresOnly.addEventListener("change", (e) => { state.premieresOnly = e.target.checked; renderAllBlocks(); });
el.hidePast.addEventListener("change", (e) => { state.hidePast = e.target.checked; renderAllBlocks(); });
el.searchInput.addEventListener("input", (e) => onSearchInput(e.target.value));
el.searchClear.addEventListener("click", () => { clearSearch(); el.searchInput.focus(); });
el.resetFilters.addEventListener("click", resetFilters);

// Header search: a magnifier that expands into a field on demand, collapsing when
// left empty (Escape clears + collapses and returns focus to the icon).
function collapseSearch() {
  el.search.classList.remove("open");
  el.searchToggle.setAttribute("aria-expanded", "false");
}
function clearSearch() {
  if (!el.searchInput.value) return;
  el.searchInput.value = "";
  state.search = "";
  el.searchClear.hidden = true;
  clearTimeout(searchTimer);
  exitSearch();
}
el.searchToggle.addEventListener("click", () => {
  const open = el.search.classList.toggle("open");
  el.searchToggle.setAttribute("aria-expanded", String(open));
  if (open) el.searchInput.focus();
  else clearSearch();
});
el.searchInput.addEventListener("blur", () => { if (!el.searchInput.value) collapseSearch(); });
el.searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { clearSearch(); collapseSearch(); el.searchToggle.focus(); }
});

// Reset the transient feed filters (search, genre, premieres) to their defaults.
// Network selection has its own "Show all" control in the dropdown and is left intact.
function resetFilters() {
  state.search = "";
  state.genres.clear();
  state.premieresOnly = true;
  state.hidePast = false;
  el.searchInput.value = "";
  el.searchClear.hidden = true;
  el.premieresOnly.checked = true;
  el.hidePast.checked = false;
  renderGenreList();
  collapseSearch();
  // If a transient network filter is active, exit it and restore the saved selection —
  // applyRoute() re-renders with the search/genre/premieres we just reset above.
  if (location.hash.startsWith("#network=")) { location.hash = ""; return; }
  renderAllBlocks();
}

el.viewBtn.addEventListener("click", () => {
  location.hash = state.view === "watchlist" ? "" : "watchlist";
});
window.addEventListener("hashchange", applyRoute);

el.exportBtn.addEventListener("click", exportPrefs);
el.importBtn.addEventListener("click", importPrefs);
el.settingsBtn.addEventListener("click", showSettings);
el.importFile.addEventListener("change", async (e) => {
  const f = e.target.files[0];
  if (f) {
    try { applyPrefs(JSON.parse(await f.text())); }
    catch { toast("Invalid preferences file"); }
  }
  e.target.value = "";
});

el.modal.querySelectorAll("[data-close]").forEach((n) => n.addEventListener("click", closeModal));
el.modalPrev.addEventListener("click", () => modalNav(-1));
el.modalNext.addEventListener("click", () => modalNav(1));
document.addEventListener("keydown", (e) => {
  if (el.modal.hidden) return;
  if (e.key === "Escape") closeModal();
  else if (e.key === "ArrowLeft") modalNav(-1);
  else if (e.key === "ArrowRight") modalNav(1);
});

// Keep Tab focus cycling inside the open dialog.
el.modal.addEventListener("keydown", (e) => {
  if (e.key !== "Tab") return;
  const f = [...el.modalCard.querySelectorAll('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
    .filter((x) => !x.disabled && x.offsetParent !== null);
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});

/* ---------- Boot ---------- */
// Keep sticky month headings tucked right under the (sticky, wrap-variable) top bar.
function syncTopbarHeight() {
  const bar = document.querySelector(".topbar");
  if (bar) document.documentElement.style.setProperty("--topbar-h", `${bar.offsetHeight}px`);
}
syncTopbarHeight();
window.addEventListener("resize", syncTopbarHeight);

console.log(`Lineup v${APP_VERSION}`);
const versionEl = document.getElementById("appVersion");
if (versionEl) {
  versionEl.textContent = `v${APP_VERSION}`;
  versionEl.title = "View changelog";
  versionEl.addEventListener("click", showChangelog);
}
normalizeFavorites(); // shrink any legacy full-snapshot favorites to { id, name }
updateViewButton();
renderNetworkList(); // show the network list + pre-selection immediately (from the seed)
renderGenreList();   // initialise the (empty) genre picker; fills in as months load
scrollObserver.observe(sentinelEl);
applyRoute(); // honor "#watchlist" or "#network=…" in a bookmarked URL
