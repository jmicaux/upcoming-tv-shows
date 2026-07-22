# Lineup — Upcoming US Shows

A lightweight web app that lists **upcoming US TV and streaming premieres, month by month**.
Browse every US network and streaming platform, follow only the ones you care about,
and filter by genre. No build step, no backend, no API key — just three static files.

![vanilla](https://img.shields.io/badge/stack-vanilla_JS-f7df1e) ![no build](https://img.shields.io/badge/build-none-brightgreen) ![data](https://img.shields.io/badge/data-TVMaze-3b82f6)

## Features

- **Month view** with prev / next navigation and a "Today" shortcut.
- **Broadcast, cable and streaming** in one place — ABC, CBS, NBC, FOX, AMC, FX, HBO…
  plus Netflix, Prime Video, Hulu, Disney+, Max, Apple TV+, Peacock, Paramount+ and more.
- **Pick-and-choose channels** — check the networks/platforms you follow; your selection
  is saved in the browser and applies across every month. No selection = show everything.
- **Genre filter** and a **Premieres only** toggle (season & series premieres), all combinable.
- **Detail view** per show: poster, channel, air date, season/episode, genres, summary.
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

## Project structure

```
tv-us-upcoming/
├── index.html   # markup: header, filters, grid, detail modal
├── styles.css   # theming (dark/light via data-theme), responsive grid
├── app.js       # data fetching, caching, filtering, rendering
└── README.md
```

No dependencies, no package.json — everything runs in the browser.

## Data source

Powered by the free [TVMaze API](https://www.tvmaze.com/api) (no key required):

- **Broadcast / cable** — `GET /schedule?country=US&date=YYYY-MM-DD` (items with a `network`).
- **Streaming** — `GET /schedule/web?date=YYYY-MM-DD` (queried worldwide, because platforms
  like Netflix and Prime Video are global in TVMaze), filtered to a US-available allow-list.

A month is built by aggregating one pair of calls per day, then grouping client-side.

## Customization

Everything configurable lives at the top of `app.js`:

| Constant | Purpose |
| --- | --- |
| `SEED_NETWORKS` | Channels shown in the picker before any month is browsed. |
| `STREAMING_ALLOWLIST` | Regex of streaming platforms kept from the worldwide web schedule. |
| `FUTURE_TTL_MS` | Cache lifetime for today/future days (past days are cached permanently). |
| `REQUEST_GAP_MS` | Delay between live API calls (throttle). |

## Limitations

- A cold month makes ~2 calls per day (~60/month → ~24s behind the progress bar); cached
  months are instant. Background prefetch of the next month is a planned improvement.
- TVMaze streaming coverage is less complete than its broadcast/cable data.
- Some daily news/talk shows use odd episode numbering; they're naturally excluded while
  "Premieres only" is on.

## Roadmap ideas

- Background prefetch of the adjacent month for instant navigation.
- Text search across shows.
- Favorites / watchlist.
- Richer artwork and synopses via TMDB.

## Credits

Data by [TVMaze](https://www.tvmaze.com/). Not affiliated with any network or platform.
