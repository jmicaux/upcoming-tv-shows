# Changelog

All notable changes to Lineup are documented here. This project follows
[semver](https://semver.org/).

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
