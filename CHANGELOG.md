# Changelog

All notable changes to Lineup are documented here. This project follows
[semver](https://semver.org/).

## 1.14.0 — 2026-07-23

### Changed
- All "Watch on" links now use a site-scoped Google search per platform (more durable than
  guessing each platform's on-site search URL); JustWatch remains the fallback.
- Reduced the detail modal height (it was too tall).

## 1.13.3 — 2026-07-23

### Fixed
- Disney+ "Watch on" link now uses a `site:disneyplus.com` Google search (same reason as Canal+).

## 1.13.2 — 2026-07-23

### Fixed
- Canal+ "Watch on" link now uses a `site:canalplus.com` Google search (Canal+ exposes no
  usable on-site search).

## 1.13.1 — 2026-07-23

### Changed
- The detail modal now has a constant size: the header (poster, title, actions) stays
  pinned and only the summary scrolls, so it no longer resizes between shows in the carousel.

## 1.13.0 — 2026-07-23

### Changed
- Search now queries the whole TVMaze catalog (debounced) instead of only the loaded feed,
  so it finds any show — including ones with no upcoming premiere. Results show a status
  label (Running / Ended / TBD…) and open the same detail modal. Clearing the search
  returns to the month feed.

## 1.12.0 — 2026-07-23

### Added
- The channel quick-filter is now bookmarkable: clicking a channel sets `#network=<name>`
  in the URL. It's transient — it does not overwrite your saved channel selection.
- A removable "<network> ✕" pill shows the active network filter; clicking it (or the
  browser Back button, or Reset filters) restores your previous selection.
- Clear (✕) button in the header search field.

### Fixed
- The detail modal no longer forces a tall fixed height (which left a large empty area);
  it fits its content and scrolls internally only when the content is too long.

## 1.11.0 — 2026-07-23

### Added
- Channel name on cards is now a quick-filter link: click it to narrow the feed to that
  network only (a first step toward browsing by network).

## 1.10.1 — 2026-07-23

### Changed
- The detail modal now keeps a constant size and scrolls internally for long content,
  so it no longer resizes when stepping through shows with the carousel.

## 1.10.0 — 2026-07-23

### Added
- Carousel navigation in the detail modal: prev/next arrows (and ←/→ keys) step through the
  visible shows without closing the modal. Arrows hide at the ends and are disabled for the
  settings and changelog dialogs.

## 1.9.1 — 2026-07-23

### Changed
- Channel favicon chip is now square (rounded corners) instead of a circle, to avoid
  clipping brand logos.
- On cards, the "Watch on" link is shortened to "Watch" (the channel already shows in the
  card meta); it still names the provider when a watch-setting override redirects elsewhere.

## 1.9.0 — 2026-07-23

### Added
- "Episode guide ↗" link in the detail modal, pointing to the show's epguides.com page.

## 1.8.1 — 2026-07-23

### Fixed
- The month feed no longer stops permanently at the first empty month; it keeps loading
  past gaps and only ends after several consecutive empty months.
- Escaped TMDB show summaries before rendering them (prevents HTML injection from data).

### Changed
- Importing preferences now asks for confirmation before replacing your favorites and settings.
- Channel favicons fall back to a colored initial chip if the icon fails to load (no broken
  image, no lingering external dependency).
- Storage-quota failures now surface a toast instead of silently dropping your data.

## 1.8.0 — 2026-07-23

### Changed
- Title search moved to the header as an expanding magnifier: click the loupe to reveal the
  field, it collapses when left empty, and Escape clears and closes it. Declutters the
  filters bar and follows the common search-to-expand pattern.

## 1.7.1 — 2026-07-23

### Changed
- The channel favicon in the detail modal is now a uniform round chip (clipped, fixed size,
  neutral background) instead of a raw, inconsistently-sized favicon.

## 1.7.0 — 2026-07-23

### Added
- **Watch settings** (⚙ in the header): optionally remap a channel to a provider you
  already have, so the "Watch on" link points there instead (e.g. a show on Apple TV →
  "Watch on Canal+"). Mappings persist locally and travel with export/import preferences.

## 1.6.0 — 2026-07-23

### Accessibility
- Show cards are now keyboard-operable (`role="button"`, focusable, Enter/Space to open)
  with a visible focus ring.
- Detail modal manages focus: it moves focus into the dialog on open, traps Tab inside
  while open, returns focus to the triggering card on close, and exposes an accessible name.
- Favorite buttons expose their state via `aria-pressed`; the network dropdown exposes
  `aria-haspopup`/`aria-expanded`; the channel search field and modal close button got
  proper labels (and the label language now matches the page).
- Result count is announced via an `aria-live` region instead of re-announcing the whole grid.
- Fixed low-contrast colors: the gold "In watchlist" button (unreadable in light mode) and
  the red "Watch on" / streaming text now use theme-aware, AA-compliant colors.
- Honors `prefers-reduced-motion` by dropping hover/transition animations.

## 1.5.1 — 2026-07-23

### Added
- Network favicon next to the channel name in the detail modal (known channels only).

## 1.5.0 — 2026-07-23

### Added
- **Text search** — filter the feed by show title, combinable with the network,
  genre and premieres filters.
- **Reset filters** button that clears search, genre and the premieres toggle in one click.
- **"Watch on <platform>" links** on every card and in the detail modal — jump straight
  to the platform's search (Netflix, Prime Video, Hulu, Disney+, Max, Apple TV, Paramount+,
  Canal+, Arte…), falling back to JustWatch for anything else.

### Changed
- Detail modal groups the watch and watchlist buttons into a single action row.

## 1.4.1 — 2026-07-23

### Changed
- More visible card date (accent-filled badge) and a larger, higher-contrast favorite star.

## 1.4.0 — 2026-07-23

### Changed
- Watchlist now groups shows by the month of their next episode, using the same big
  sticky month headings as the main feed (shows with no upcoming episode go last).
- Larger, more prominent month headings across both views.

## 1.3.0 — 2026-07-23

### Changed
- Replaced the month carousel (prev/next/today) with a single continuous feed: the
  current month shows first and the next months load lazily as you scroll, each under a
  sticky month heading. Filters and favorites apply across all loaded months.

## 1.2.0 — 2026-07-23

### Added
- Bookmarkable Watchlist: the view is reflected in the URL (`#watchlist`), so you can
  bookmark it and the browser's back/forward buttons work.

## 1.1.0 — 2026-07-23

### Added
- In-app changelog — click the version number in the header to read it.

## 1.0.0 — 2026-07-23

First release.

### Added
- Month-by-month view of upcoming US TV premieres, powered by the TVMaze API.
- Broadcast, cable and streaming in one grid (Netflix, Prime Video, Hulu, Disney+,
  Max, Apple TV, Peacock, Paramount+ and more).
- French channels Canal+ and Arte, sourced from TMDB.
- Pick-and-choose channel filter with the major networks pre-selected by default.
- Genre filter and a "Premieres only" toggle.
- Favorites with a dedicated Watchlist view showing each show's next episode.
- Export / import preferences to a JSON file (File System Access on Chrome/Edge)
  for cross-device sync via a cloud-synced folder.
- Dark / light theme toggle that persists and overrides the OS preference.
- Detail view per show: poster, channel, air date, season/episode, genres, summary.

### Notes
- Progressive rendering: results appear as days load instead of all at once.
- Local caching keeps revisited months instant; requests are throttled to respect
  the TVMaze rate limit.
