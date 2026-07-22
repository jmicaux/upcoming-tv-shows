"use strict";

/* ---------- Version ---------- */
const APP_VERSION = "1.2.0"; // single source of truth — bump on each release

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
  "Canal+", "ARTE",
];

// Big networks pre-selected on the very first visit (until the user changes it).
const DEFAULT_FOLLOWED = [
  "HBO", "Max", "Showtime", "Starz", "FX", "AMC",
  "Netflix", "Hulu", "Prime Video", "Disney+", "Apple TV", "Paramount+", "Peacock",
  "Canal+", "ARTE",
];

// Web/streaming platforms to keep from the (worldwide) web schedule.
const STREAMING_ALLOWLIST = /^(Netflix|Prime Video|Amazon|Hulu|Disney\+|Max|HBO Max|Apple TV\+?|Peacock|Paramount\+|Starz|Showtime|AMC\+|Shudder|Acorn TV|BritBox|Crunchyroll|ESPN\+|Discovery\+|Tubi|Freevee|MGM\+|Hallmark\+|Fox Nation)$/i;

// French channels come from TMDB (far better FR coverage than TVMaze).
// Key is provided at runtime by config.js (git-ignored) — see config.example.js.
const TMDB_KEY = (window.LINEUP_CONFIG && window.LINEUP_CONFIG.TMDB_KEY) || "";
const TMDB_NETWORKS = "285|1628"; // Canal+ (285) | ARTE (1628)
const TMDB_IMG = "https://image.tmdb.org/t/p/w342";
const TMDB_IMG_ORIG = "https://image.tmdb.org/t/p/original";
const TMDB_CACHE_PREFIX = "tmdb:fr:v1:"; // keyed by YYYY-MM
const FAV_KEY = "tv:favorites";

/* ---------- State ---------- */
const state = {
  cursor: startOfMonth(new Date()), // first day of the displayed month
  items: [],                        // trimmed schedule items for the month
  followed: new Set(loadFollowed()),                 // networks the user picked; empty = show all
  known: new Set([...SEED_NETWORKS, ...loadArray(KNOWN_KEY)]), // all pickable networks
  networkSearch: "",
  genre: "",
  premieresOnly: true,
  view: "month",                    // "month" | "watchlist"
  favorites: loadObject(FAV_KEY),   // { showId: trimmed show object }
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
  try { localStorage.setItem(FAV_KEY, JSON.stringify(state.favorites)); } catch { /* ignore quota */ }
}

/* ---------- DOM ---------- */
const el = {
  grid: document.getElementById("grid"),
  monthLabel: document.getElementById("monthLabel"),
  networkBtn: document.getElementById("networkBtn"),
  networkBtnCount: document.getElementById("networkBtnCount"),
  networkPanel: document.getElementById("networkPanel"),
  networkList: document.getElementById("networkList"),
  networkSearch: document.getElementById("networkSearch"),
  networkClear: document.getElementById("networkClear"),
  networkDropdown: document.getElementById("networkDropdown"),
  genreFilter: document.getElementById("genreFilter"),
  premieresOnly: document.getElementById("premieresOnly"),
  resultCount: document.getElementById("resultCount"),
  progress: document.getElementById("progress"),
  progressBar: document.getElementById("progressBar"),
  progressText: document.getElementById("progressText"),
  modal: document.getElementById("modal"),
  modalBody: document.getElementById("modalBody"),
  themeBtn: document.getElementById("themeBtn"),
  viewBtn: document.getElementById("viewBtn"),
  exportBtn: document.getElementById("exportBtn"),
  importBtn: document.getElementById("importBtn"),
  importFile: document.getElementById("importFile"),
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
  return (networks || []).some((n) => n.id === 285) ? "Canal+" : "ARTE";
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
      summary: show.overview ? `<p>${show.overview}</p>` : "",
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

let loadSeq = 0;
async function loadMonth() {
  const seq = ++loadSeq; // guard against overlapping month navigations
  const days = monthDays(state.cursor);
  state.items = [];
  el.monthLabel.textContent = monthLabel(state.cursor);
  if (state.view === "month") el.grid.innerHTML = ""; // keep the watchlist grid if we booted into it
  showProgress(0, days.length);

  let lastRender = 0;
  for (let i = 0; i < days.length; i++) {
    let res;
    try {
      res = await fetchDay(days[i]);
    } catch (err) {
      if (seq !== loadSeq) return;
      console.error(err);
      showProgress(i + 1, days.length, "network error, continuing…");
      continue;
    }
    if (seq !== loadSeq) return; // a newer load started; drop this one
    state.items.push(...res.data);
    showProgress(i + 1, days.length);

    // Progressive render: show what we have so far, throttled to limit reflow.
    const now = Date.now();
    if (state.view === "month" && state.items.length && now - lastRender > 250) {
      lastRender = now;
      rebuildFilterOptions();
      render();
    }
  }

  showProgress(days.length, days.length, "Canal+ / ARTE…");
  const fr = await fetchFrMonth(state.cursor);
  if (seq !== loadSeq) return;
  state.items.push(...fr);

  hideProgress();
  rebuildFilterOptions();
  if (state.view === "month") render();
}

/* ---------- Progress UI ---------- */
function showProgress(done, total, note) {
  el.progress.hidden = false;
  el.progressBar.style.width = `${Math.round((done / total) * 100)}%`;
  el.progressText.textContent = note || `Loading ${done}/${total} days…`;
}
function hideProgress() { el.progress.hidden = true; }

/* ---------- Filtering ---------- */
function visibleItems() {
  const filtering = state.followed.size > 0;
  return state.items.filter((it) => {
    if (state.premieresOnly && it.number !== 1) return false;
    if (filtering && (!it.show.channel || !state.followed.has(it.show.channel.name))) return false;
    if (state.genre && !it.show.genres.includes(state.genre)) return false;
    return true;
  });
}

function rebuildFilterOptions() {
  const genres = new Set();
  let added = false;
  for (const it of state.items) {
    if (it.show.channel && !state.known.has(it.show.channel.name)) {
      state.known.add(it.show.channel.name);
      added = true;
    }
    it.show.genres.forEach((g) => genres.add(g));
  }
  if (added) saveSet(KNOWN_KEY, state.known);
  fillSelect(el.genreFilter, genres, state.genre);
  renderNetworkList();
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
  updateNetworkButton();
  render();
}

function updateNetworkButton() {
  const n = state.followed.size;
  el.networkBtn.childNodes[0].nodeValue = n === 0 ? "All " : "Selected ";
  el.networkBtnCount.textContent = n > 0 ? String(n) : "";
  el.networkBtnCount.classList.toggle("show", n > 0);
}

function fillSelect(select, valueSet, current) {
  const values = [...valueSet].sort((a, b) => a.localeCompare(b, "en"));
  select.innerHTML = '<option value="">All</option>' +
    values.map((v) => `<option value="${escapeAttr(v)}">${escapeHtml(v)}</option>`).join("");
  select.value = current && values.includes(current) ? current : "";
}

/* ---------- Render ---------- */
function render() {
  el.monthLabel.textContent = monthLabel(state.cursor);
  const items = visibleItems();

  // One card per show+date (a show can premiere several seasons? rare — dedupe by show+airdate).
  const seen = new Set();
  const cards = [];
  for (const it of items) {
    const key = `${it.show.id}:${it.airdate}`;
    if (seen.has(key)) continue;
    seen.add(key);
    cards.push(it);
  }
  cards.sort((a, b) => a.airdate.localeCompare(b.airdate) || a.show.name.localeCompare(b.show.name));

  el.resultCount.textContent = `${cards.length} result${cards.length !== 1 ? "s" : ""}`;

  if (cards.length === 0) {
    el.grid.innerHTML = '<p class="empty">No shows match these filters this month.</p>';
    return;
  }

  el.grid.innerHTML = cards.map(cardHtml).join("");
  el.grid.querySelectorAll(".card").forEach((c) => {
    const id = c.dataset.showId;
    c.addEventListener("click", () => openModal(id, c.dataset.airdate));
    c.querySelector(".fav-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      toggleFav(id);
    });
  });
}

/* ---------- Favorites & Watchlist ---------- */
function toggleFav(id, showObj) {
  if (state.favorites[id]) {
    delete state.favorites[id];
  } else {
    const show = showObj || (state.items.find((x) => String(x.show.id) === String(id)) || {}).show;
    if (!show) return;
    state.favorites[id] = show;
  }
  saveFavorites();
  updateViewButton();
  if (state.view === "watchlist") renderWatchlist();
  else render();
}

function routeView() {
  return location.hash.replace(/^#/, "") === "watchlist" ? "watchlist" : "month";
}

function setView(v) {
  state.view = v;
  document.body.setAttribute("data-view", v);
  updateViewButton();
  if (v === "watchlist") renderWatchlist();
  else render();
}

function updateViewButton() {
  const n = Object.keys(state.favorites).length;
  el.viewBtn.innerHTML = state.view === "watchlist"
    ? "‹ Browse"
    : `★ Watchlist${n ? ` <span class="count">${n}</span>` : ""}`;
}

function renderWatchlist() {
  el.resultCount.textContent = "";
  const favs = Object.values(state.favorites).sort((a, b) => a.name.localeCompare(b.name));

  if (favs.length === 0) {
    el.grid.innerHTML = '<p class="empty">No favorites yet. Tap the ☆ on any show to add it to your watchlist.</p>';
    return;
  }

  el.grid.innerHTML = favs.map(watchlistCardHtml).join("");
  el.grid.querySelectorAll(".card").forEach((c) => {
    const id = c.dataset.showId;
    const show = state.favorites[id];
    c.addEventListener("click", () => showModal(show, epContext(id)));
    c.querySelector(".fav-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      toggleFav(id);
    });
  });

  favs.forEach(loadNextEpisode); // async enrichment of the "next episode" line
}

function watchlistCardHtml(show) {
  const chan = show.channel ? show.channel.name : "—";
  const streaming = show.channel && show.channel.streaming;
  return `
    <article class="card" data-show-id="${escapeAttr(String(show.id))}">
      ${favBtnHtml(show.id)}
      ${imageHtml(show)}
      <div class="card-body">
        <div class="card-date" data-next="${escapeAttr(String(show.id))}">${escapeHtml(nextEpLabel(state.nextEp[show.id]))}</div>
        <h3 class="card-title">${escapeHtml(show.name)}</h3>
        <div class="card-meta">${escapeHtml(chan)}${streaming ? ' <span class="tag-stream">streaming</span>' : ""}</div>
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

async function loadNextEpisode(show) {
  const id = show.id;
  if (state.nextEp[id] !== undefined) { updateNextEpCell(id); return; }

  let ep = null;
  try {
    if (String(id).startsWith("tmdb:")) {
      if (TMDB_KEY) {
        const d = await tmdb(`tv/${String(id).slice(5)}`);
        const e = d.next_episode_to_air;
        if (e) ep = { airdate: e.air_date, season: e.season_number, number: e.episode_number, label: `S${e.season_number}E${e.episode_number}` };
      }
    } else {
      const d = await throttledJson(`${API}/shows/${id}?embed=nextepisode`);
      const e = d._embedded && d._embedded.nextepisode;
      if (e) ep = { airdate: e.airdate, season: e.season, number: e.number, label: `S${e.season}E${e.number}` };
    }
  } catch { ep = null; }

  state.nextEp[id] = ep;
  updateNextEpCell(id);
}

function updateNextEpCell(id) {
  const cell = el.grid.querySelector(`.card-date[data-next="${CSS.escape(String(id))}"]`);
  if (cell) cell.textContent = nextEpLabel(state.nextEp[id]);
}

function favBtnHtml(id) {
  const on = state.favorites[id] ? "on" : "";
  return `<button class="fav-btn ${on}" data-fav="${escapeAttr(String(id))}" title="Toggle favorite" aria-label="Toggle favorite">${on ? "★" : "☆"}</button>`;
}

function imageHtml(show) {
  return show.image
    ? `<img class="card-img" loading="lazy" src="${escapeAttr(show.image.medium)}" alt="${escapeAttr(show.name)}">`
    : `<div class="card-no-img">${escapeHtml(show.name)}</div>`;
}

function cardHtml(it) {
  const chan = it.show.channel ? it.show.channel.name : "—";
  const streaming = it.show.channel && it.show.channel.streaming;
  const premiere = it.number === 1
    ? (it.season === 1 ? "Series premiere" : `Season ${it.season}`)
    : `S${it.season}E${it.number}`;
  return `
    <article class="card" data-show-id="${escapeAttr(String(it.show.id))}" data-airdate="${escapeAttr(it.airdate)}">
      ${favBtnHtml(it.show.id)}
      ${imageHtml(it.show)}
      <div class="card-body">
        <div class="card-date">${formatDay(it.airdate)}</div>
        <h3 class="card-title">${escapeHtml(it.show.name)}</h3>
        <div class="card-meta">${escapeHtml(chan)}${streaming ? ' <span class="tag-stream">streaming</span>' : ""}</div>
        <span class="badge">${escapeHtml(premiere)}</span>
      </div>
    </article>`;
}

function formatDay(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

/* ---------- Modal ---------- */
function openModal(showId, airdate) {
  const it = state.items.find((x) => String(x.show.id) === String(showId) && x.airdate === airdate);
  if (it) showModal(it.show, { airdate: it.airdate, season: it.season, number: it.number });
}

function showModal(s, ep) {
  const img = s.image ? `<img src="${escapeAttr(s.image.original || s.image.medium)}" alt="">` : "";
  const genres = s.genres.length
    ? `<div class="modal-genres">${s.genres.map((g) => `<span class="badge">${escapeHtml(g)}</span>`).join(" ")}</div>`
    : "";
  const summary = s.summary || "<p>No summary available.</p>";

  const sub = [s.channel ? s.channel.name + (s.channel.streaming ? " (streaming)" : "") : "—"];
  if (ep && ep.airdate) sub.push(formatDay(ep.airdate));
  if (ep && ep.season != null) sub.push(`S${ep.season}E${ep.number}`);

  const favOn = state.favorites[s.id] ? "on" : "";
  el.modalBody.innerHTML = `
    <div class="modal-head">
      ${img}
      <div>
        <h2 class="modal-title">${escapeHtml(s.name)}</h2>
        <p class="modal-sub">${escapeHtml(sub.join(" · "))}</p>
        ${genres}
        <button class="modal-fav ${favOn}">${favOn ? "★ In watchlist" : "☆ Add to watchlist"}</button>
      </div>
    </div>
    <div class="modal-summary">${summary}</div>`;

  const favBtn = el.modalBody.querySelector(".modal-fav");
  favBtn.addEventListener("click", () => {
    toggleFav(s.id, s);
    const on = !!state.favorites[s.id];
    favBtn.classList.toggle("on", on);
    favBtn.textContent = on ? "★ In watchlist" : "☆ Add to watchlist";
  });

  el.modal.hidden = false;
}

function closeModal() { el.modal.hidden = true; }

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
  el.modalBody.innerHTML = '<div class="modal-summary">Loading…</div>';
  el.modal.hidden = false;
  try {
    const res = await fetch(`CHANGELOG.md?v=${APP_VERSION}`);
    if (!res.ok) throw new Error(res.status);
    el.modalBody.innerHTML = `<div class="changelog">${renderMarkdown(await res.text())}</div>`;
  } catch {
    el.modalBody.innerHTML = '<div class="modal-summary">Changelog unavailable.</div>';
  }
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
  };
}

function applyPrefs(data) {
  if (!data || typeof data !== "object") return;
  if (Array.isArray(data.followedNetworks)) {
    state.followed = new Set(data.followedNetworks);
    saveSet(FOLLOW_KEY, state.followed);
    data.followedNetworks.forEach((n) => state.known.add(n));
    saveSet(KNOWN_KEY, state.known);
  }
  if (data.favorites && typeof data.favorites === "object") {
    state.favorites = data.favorites;
    saveFavorites();
  }
  if (data.theme === "light" || data.theme === "dark") {
    currentTheme = data.theme;
    localStorage.setItem(THEME_KEY, currentTheme);
    applyTheme(currentTheme);
  }
  updateViewButton();
  renderNetworkList();
  if (state.view === "watchlist") renderWatchlist();
  else render();
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
document.getElementById("prevMonth").addEventListener("click", () => {
  state.cursor = new Date(state.cursor.getFullYear(), state.cursor.getMonth() - 1, 1);
  loadMonth();
});
document.getElementById("nextMonth").addEventListener("click", () => {
  state.cursor = new Date(state.cursor.getFullYear(), state.cursor.getMonth() + 1, 1);
  loadMonth();
});
document.getElementById("todayBtn").addEventListener("click", () => {
  state.cursor = startOfMonth(new Date());
  loadMonth();
});
el.networkBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  el.networkPanel.hidden = !el.networkPanel.hidden;
});
el.networkSearch.addEventListener("input", (e) => { state.networkSearch = e.target.value; renderNetworkList(); });
el.networkClear.addEventListener("click", () => {
  state.followed.clear();
  saveSet(FOLLOW_KEY, state.followed);
  renderNetworkList();
  render();
});
el.networkPanel.addEventListener("click", (e) => e.stopPropagation());
document.addEventListener("click", () => { el.networkPanel.hidden = true; });

el.genreFilter.addEventListener("change", (e) => { state.genre = e.target.value; render(); });
el.premieresOnly.addEventListener("change", (e) => { state.premieresOnly = e.target.checked; render(); });

el.viewBtn.addEventListener("click", () => {
  location.hash = state.view === "watchlist" ? "" : "watchlist";
});
window.addEventListener("hashchange", () => setView(routeView()));

el.exportBtn.addEventListener("click", exportPrefs);
el.importBtn.addEventListener("click", importPrefs);
el.importFile.addEventListener("change", async (e) => {
  const f = e.target.files[0];
  if (f) {
    try { applyPrefs(JSON.parse(await f.text())); }
    catch { toast("Invalid preferences file"); }
  }
  e.target.value = "";
});

el.modal.querySelectorAll("[data-close]").forEach((n) => n.addEventListener("click", closeModal));
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

/* ---------- Boot ---------- */
console.log(`Lineup v${APP_VERSION}`);
const versionEl = document.getElementById("appVersion");
if (versionEl) {
  versionEl.textContent = `v${APP_VERSION}`;
  versionEl.title = "View changelog";
  versionEl.addEventListener("click", showChangelog);
}
state.view = routeView(); // honor #watchlist in a bookmarked URL
document.body.setAttribute("data-view", state.view);
updateViewButton();
renderNetworkList(); // show the network list + pre-selection immediately (from the seed)
if (state.view === "watchlist") renderWatchlist();
loadMonth();
