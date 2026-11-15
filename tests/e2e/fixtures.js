// Shared set-up for the end-to-end tests.
// - The date is frozen (TODAY) so "past", "this month" and the snapshot age never drift.
// - The nightly snapshot (data/schedule/) is replaced by a small fixture that covers every
//   seed channel: the app then makes no live schedule call at all.
// - Every external request is answered locally (TVmaze show/search fixtures, a 1-px image)
//   or aborted (TMDB, analytics, the Supabase CDN): a test can never depend on the network.
// - Any uncaught page error fails the test.
const base = require("@playwright/test");
const { SEED_NETWORKS, networkSlug } = require("../../networks.js");

const TODAY = "2026-11-15";
const NOW = new Date(`${TODAY}T12:00:00+01:00`);

const show = (id, name, channel, genres, { streaming = false } = {}) => ({
  id, name, genres,
  channel: { name: channel, streaming },
  image: { medium: `https://static.tvmaze.com/test/${id}.jpg`, original: `https://static.tvmaze.com/test/${id}-big.jpg` },
  summary: `<p>${name} summary.</p>`,
  premiered: "2020-01-01",
});
const ep = (id, s, season, number, airdate) => ({ id, season, number, airdate, show: s });

const SHOWS = {
  alpha: show(101, "Alpha Saga", "Netflix", ["Drama"], { streaming: true }),
  beta: show(102, "Beta Returns", "HBO", ["Comedy"]),
  gamma: show(103, "Gamma Files", "BBC One", ["Crime"]),
  delta: show(104, "Delta Quiz", "ITV1", ["Game Show"]),
  epsilon: { ...show("tmdb:900", "Epsilon", "Canal+", ["Drama"]), image: null },
  eta: show(106, "Eta Hospital", "CBS", ["Drama"]),
  zeta: show(107, "Zeta Rising", "Netflix", ["Science-Fiction"], { streaming: true }),
};
// Month → channel → episodes. Followed by default: Netflix, HBO, BBC One, ITV1, Canal+.
// CBS is not, so Eta only shows on its channel and country pages.
const SCHEDULE = {
  "2026-11": {
    Netflix: [ep(1, SHOWS.alpha, 1, 1, "2026-11-20")],
    HBO: [ep(2, SHOWS.beta, 3, 1, "2026-11-18"), ep(3, SHOWS.beta, 3, 2, "2026-11-25")],
    "BBC One": [ep(4, SHOWS.gamma, 1, 1, "2026-11-10")],
    ITV1: [ep(5, SHOWS.delta, 5, 1, "2026-11-22")],
    "Canal+": [ep(6, SHOWS.epsilon, 1, 1, "2026-11-28")],
    CBS: [ep(7, SHOWS.eta, 1, 1, "2026-11-19")],
  },
  "2026-12": {
    Netflix: [ep(8, SHOWS.zeta, 2, 1, "2026-12-05")],
  },
};
const MONTHS = ["2026-11", "2026-12", "2027-01"];

const channels = Object.fromEntries([...new Set(SEED_NETWORKS)].map((n) => [n, networkSlug(n)]));
const bySlug = Object.fromEntries(Object.entries(channels).map(([n, s]) => [s, n]));
const INDEX = { generatedAt: `${TODAY}T04:00:00Z`, months: MONTHS, channels };

// TVmaze /shows/{id}?embed=nextepisode, used by the Watchlist.
const NEXT = { 101: ep(1, null, 1, 1, "2026-11-20"), 102: ep(2, null, 3, 1, "2026-11-18"), 107: ep(8, null, 2, 1, "2026-12-05") };
function tvmazeShow(id) {
  const s = Object.values(SHOWS).find((x) => String(x.id) === String(id));
  if (!s) return null;
  const chan = { name: s.channel.name };
  const next = NEXT[id];
  return {
    id: s.id, name: s.name, genres: s.genres, summary: s.summary, premiered: s.premiered, status: "Running",
    network: s.channel.streaming ? null : chan, webChannel: s.channel.streaming ? chan : null,
    image: s.image,
    _embedded: next ? { nextepisode: { airdate: next.airdate, season: next.season, number: next.number } } : {},
  };
}

const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkqH9QDwAEUgHXx5cMXAAAAABJRU5ErkJggg==", "base64");
const json = (route, body) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });

async function mockNetwork(page) {
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "localhost") {
      const m = url.pathname.match(/\/data\/schedule\/(?:index\.json|(\d{4}-\d{2})\/([^/]+)\.json)$/);
      if (m && !m[1]) return json(route, INDEX);
      if (m) return json(route, (SCHEDULE[m[1]] || {})[bySlug[m[2]]] || []);
      if (url.pathname.endsWith("/config.js")) return route.fulfill({ contentType: "text/javascript", body: "" }); // no local TMDB key
      return route.continue();
    }
    if (url.hostname === "api.tvmaze.com") {
      const s = url.pathname.match(/^\/shows\/(\d+)$/);
      if (s) { const body = tvmazeShow(s[1]); return body ? json(route, body) : route.fulfill({ status: 404 }); }
      if (url.pathname === "/search/shows") {
        const q = (url.searchParams.get("q") || "").toLowerCase();
        return json(route, Object.values(SHOWS).filter((x) => typeof x.id === "number" && x.name.toLowerCase().includes(q))
          .map((x) => ({ score: 1, show: tvmazeShow(x.id) })));
      }
      return json(route, []); // live schedules: not expected, harmless
    }
    if (route.request().resourceType() === "image") return route.fulfill({ contentType: "image/png", body: PIXEL });
    return route.abort(); // TMDB, analytics, Supabase CDN…
  });
}

const test = base.test.extend({
  page: async ({ page }, use) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.clock.setFixedTime(NOW);
    await mockNetwork(page);
    await use(page);
    base.expect(errors, "uncaught errors in the page").toEqual([]);
  },
});

// Card titles currently rendered in the main grid (or in one month block), in order.
const cardTitles = (scope) => scope.locator(".card:not(.skeleton) .card-title").allInnerTexts();
// The block of one month in the feed, by its heading ("November 2026").
const monthBlock = (page, name) => page.locator(".month-block").filter({ has: page.getByRole("heading", { name, exact: true }) });

module.exports = { test, expect: base.expect, cardTitles, monthBlock, SHOWS, TODAY };
