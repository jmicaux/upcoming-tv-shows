"use strict";

/* ---------- Config ---------- */
const API = "https://api.tvmaze.com";
const CACHE_PREFIX = "tvmaze:sched:v2:US:"; // v2: unified broadcast + streaming
const FUTURE_TTL_MS = 6 * 60 * 60 * 1000; // 6h for today/future days
const REQUEST_GAP_MS = 400;               // throttle: stay under ~20 req / 10s
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
  "Netflix", "Prime Video", "Hulu", "Disney+", "Max", "Apple TV+",
  "Peacock", "Paramount+", "AMC+", "Starz", "Shudder", "ESPN+",
];

// Web/streaming platforms to keep from the (worldwide) web schedule.
const STREAMING_ALLOWLIST = /^(Netflix|Prime Video|Amazon|Hulu|Disney\+|Max|HBO Max|Apple TV\+?|Peacock|Paramount\+|Starz|Showtime|AMC\+|Shudder|Acorn TV|BritBox|Crunchyroll|ESPN\+|Discovery\+|Tubi|Freevee|MGM\+|Hallmark\+|Fox Nation)$/i;

/* ---------- State ---------- */
const state = {
  cursor: startOfMonth(new Date()), // first day of the displayed month
  items: [],                        // trimmed schedule items for the month
  followed: new Set(loadArray(FOLLOW_KEY)),          // networks the user picked; empty = show all
  known: new Set([...SEED_NETWORKS, ...loadArray(KNOWN_KEY)]), // all pickable networks
  networkSearch: "",
  genre: "",
  premieresOnly: true,
};

function loadArray(key) {
  try { return JSON.parse(localStorage.getItem(key)) || []; } catch { return []; }
}
function saveSet(key, set) {
  try { localStorage.setItem(key, JSON.stringify([...set])); } catch { /* ignore quota */ }
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

async function loadMonth() {
  const days = monthDays(state.cursor);
  const all = [];
  showProgress(0, days.length);

  for (let i = 0; i < days.length; i++) {
    try {
      const res = await fetchDay(days[i]);
      all.push(...res.data);
    } catch (err) {
      console.error(err);
      showProgress(i + 1, days.length, "network error, continuing…");
      continue;
    }
    showProgress(i + 1, days.length);
  }

  state.items = all;
  hideProgress();
  rebuildFilterOptions();
  render();
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
    c.addEventListener("click", () => openModal(c.dataset.showId, c.dataset.airdate));
  });
}

function cardHtml(it) {
  const img = it.show.image
    ? `<img class="card-img" loading="lazy" src="${escapeAttr(it.show.image.medium)}" alt="${escapeAttr(it.show.name)}">`
    : `<div class="card-no-img">${escapeHtml(it.show.name)}</div>`;
  const chan = it.show.channel ? it.show.channel.name : "—";
  const streaming = it.show.channel && it.show.channel.streaming;
  const premiere = it.number === 1
    ? (it.season === 1 ? "Series premiere" : `Season ${it.season}`)
    : `S${it.season}E${it.number}`;
  return `
    <article class="card" data-show-id="${it.show.id}" data-airdate="${escapeAttr(it.airdate)}">
      ${img}
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
  if (!it) return;
  const s = it.show;
  const img = s.image ? `<img src="${escapeAttr(s.image.original || s.image.medium)}" alt="">` : "";
  const genres = s.genres.length
    ? `<div class="modal-genres">${s.genres.map((g) => `<span class="badge">${escapeHtml(g)}</span>`).join(" ")}</div>`
    : "";
  const summary = s.summary || "<p>No summary available.</p>";
  el.modalBody.innerHTML = `
    <div class="modal-head">
      ${img}
      <div>
        <h2 class="modal-title">${escapeHtml(s.name)}</h2>
        <p class="modal-sub">${escapeHtml(s.channel ? s.channel.name : "—")}${s.channel && s.channel.streaming ? " (streaming)" : ""} · ${formatDay(it.airdate)} · S${it.season}E${it.number}</p>
        ${genres}
      </div>
    </div>
    <div class="modal-summary">${summary}</div>`;
  el.modal.hidden = false;
}

function closeModal() { el.modal.hidden = true; }

/* ---------- Escaping ---------- */
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(str) { return escapeHtml(str); }

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

el.modal.querySelectorAll("[data-close]").forEach((n) => n.addEventListener("click", closeModal));
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

/* ---------- Boot ---------- */
loadMonth();
