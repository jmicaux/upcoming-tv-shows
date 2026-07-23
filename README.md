# Lineup — Upcoming TV Shows

A lightweight web app that lists **upcoming TV and streaming premieres, month by month**.
Browse US networks and streaming platforms, plus French channels **Canal+** and **Arte**,
follow only the ones you care about, and filter by genre. No build step, no backend —
just static files (plus a free TMDB key for the French channels).

![version](https://img.shields.io/badge/version-1.14.1-blue) ![vanilla](https://img.shields.io/badge/stack-vanilla_JS-f7df1e) ![no build](https://img.shields.io/badge/build-none-brightgreen) ![data](https://img.shields.io/badge/data-TVMaze_+_TMDB-3b82f6)

**🔗 Live preview: [jmicaux.github.io/upcoming-tv-shows](https://jmicaux.github.io/upcoming-tv-shows/)**

> The hosted preview covers US channels only — Canal+ / Arte need a local TMDB key (see below).

## Features

- **Continuous month feed** — starts on the current month and lazy-loads the next months as
  you scroll (infinite scroll), with a sticky heading for each month.
- **Broadcast, cable and streaming** in one place — ABC, CBS, NBC, FOX, AMC, FX, HBO…
  plus Netflix, Prime Video, Hulu, Disney+, Max, Apple TV+, Peacock, Paramount+ and more.
- **French channels** Canal+ and Arte, sourced from TMDB for reliable FR coverage.
- **Pick-and-choose channels** — check the networks/platforms you follow; your selection
  is saved in the browser and applies across every month. No selection = show everything.
- **Genre filter**, **title search** and a **Premieres only** toggle (season & series
  premieres), all combinable, with a one-click **Reset filters**.
- **"Watch on <platform>" links** on every card and in the detail view — jump straight to
  the platform's search (or JustWatch as a fallback) to start watching. Optional **watch
  settings** (⚙) let you remap a channel to a provider you already subscribe to (e.g. a show
  on Apple TV → "Watch on Canal+").
- **Detail view** per show: poster, channel, air date, season/episode, genres, summary.
- **Favorites & Watchlist** — star any show; a dedicated Watchlist view lists your
  followed shows with their next upcoming episode.
- **Export / import preferences** — save your favorites, followed channels and theme to a
  JSON file and load them on another machine. Point it at a cloud-synced folder
  (OneDrive/Dropbox/Drive) for cross-device sync without a backend.
- **Dark / light theme** toggle that persists and overrides the OS preference.
- **Local caching** so revisited months load instantly, with request throttling to stay
  within the TVMaze rate limit.

## Running it

The app is fully static. TVMaze sends permissive CORS headers, so in most browsers you can
just open `index.html` directly. If your browser blocks `fetch` on `file://`, serve the folder:

```bash
cd tv-us-upcoming
python -m http.server 8000
# then open http://localhost:8000
```

Any static server works (`npx serve`, VS Code Live Server, etc.).

### Enabling the French channels (optional)

Canal+ and Arte need a free [TMDB API key](https://www.themoviedb.org/settings/api):

```bash
cp config.example.js config.js   # then paste your key into config.js
```

`config.js` is git-ignored, so your key stays out of the repo. Without it, the app runs
fine and simply omits the French channels.

## Project structure

```
tv-us-upcoming/
├── index.html          # markup: header, filters, grid, detail modal
├── styles.css          # theming (dark/light via data-theme), responsive grid
├── app.js              # data fetching, caching, filtering, rendering
├── config.example.js   # template for your TMDB key
├── config.js           # your real key (git-ignored, create from the example)
├── presets/            # importable preferences snapshots (Export → Import)
└── README.md
```

No dependencies, no package.json — everything runs in the browser.

## Data sources

**US TV & streaming** — the free [TVMaze API](https://www.tvmaze.com/api) (no key required):

- **Broadcast / cable** — `GET /schedule?country=US&date=YYYY-MM-DD` (items with a `network`).
- **Streaming** — `GET /schedule/web?date=YYYY-MM-DD` (queried worldwide, because platforms
  like Netflix and Prime Video are global in TVMaze), filtered to a US-available allow-list.

A month is built by aggregating one pair of calls per day, then grouping client-side.

**French channels (Canal+, Arte)** — [TMDB](https://www.themoviedb.org/) `discover/tv`, whose
FR coverage is far better than TVMaze's. One pass per month resolves each show's episodes that
air in the window. **Requires a free TMDB API key** in `TMDB_KEY` (see below).

## Customization

Everything configurable lives at the top of `app.js`:

| Constant | Purpose |
| --- | --- |
| `SEED_NETWORKS` | Channels shown in the picker before any month is browsed. |
| `STREAMING_ALLOWLIST` | Regex of streaming platforms kept from the worldwide web schedule. |
| `TMDB_KEY` | Your free TMDB API key (v3), required for the Canal+ / Arte data. |
| `TMDB_NETWORKS` | Pipe-separated TMDB network IDs to pull (Canal+ = 285, ARTE = 1628). |
| `FUTURE_TTL_MS` | Cache lifetime for today/future days (past days are cached permanently). |
| `REQUEST_GAP_MS` | Delay between live TVMaze calls (throttle). |

## Limitations

- A cold month makes ~2 calls per day (~60/month → ~24s behind the progress bar); cached
  months are instant. Background prefetch of the next month is a planned improvement.
- TVMaze streaming coverage is less complete than its broadcast/cable data.
- Some daily news/talk shows use odd episode numbering; they're naturally excluded while
  "Premieres only" is on.
- The TMDB key ships in client-side JS (no server), so it is publicly visible. Fine for a
  personal deployment; a public one should proxy TMDB behind a small backend to hide the key.
- Export/import uses the File System Access API on Chrome/Edge (over https/localhost) and
  remembers the chosen file for one-click re-sync; other browsers fall back to a plain
  download / file upload.

## Roadmap ideas

- Background prefetch of the adjacent month for instant navigation.
- More non-US channels via TMDB network IDs.

## Versioning

The app version is defined once as `APP_VERSION` at the top of `app.js` and shown next to
the title (and logged to the console). Bump it on each release following
[semver](https://semver.org/) — patch for fixes, minor for features, major for breaking
changes.

On every release, update the version in **three** places so browsers pick up fresh assets:

1. `APP_VERSION` in `app.js`
2. the `?v=` cache-busting query on `styles.css` / `app.js` in `index.html`
3. the version badge above

The `?v=` query forces browsers to re-download the CSS/JS after a deploy instead of serving
a stale cached copy.

## Credits

Data by [TVMaze](https://www.tvmaze.com/) and [TMDB](https://www.themoviedb.org/). This
product uses the TMDB API but is not endorsed or certified by TMDB. Not affiliated with any
network or platform.

Built with the help of [Claude](https://claude.ai/code).
