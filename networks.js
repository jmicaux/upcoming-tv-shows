"use strict";
// Channel lists shared by the app (window.UpcomingNetworks) and tools/make-pages.js, which
// generates one page per seed channel at network/<slug>.html.
(function (root) {
  // Seed list so the major US channels are pickable before any month is browsed.
  // Flagship international broadcasters kept from each country's TVmaze schedule.
  // (We fetch the whole country schedule but keep only these networks — "flagship only".)
  const UK_NETWORKS = [
    "BBC One", "BBC Two", "BBC Three", "BBC Four",
    "ITV1", "ITV2", "Channel 4", "5", "Sky Atlantic", "Sky Max", "E4", // TVmaze labels Channel 5 as "5"
  ];
  const AU_NETWORKS = ["ABC", "Seven Network", "Nine Network", "Network 10", "SBS"];
  // Nordic flagship channels, per country (incl. the messy real TVmaze name variants).
  const SE_NETWORKS = ["SVT1", "SVT2", "TV4"];
  const NO_NETWORKS = ["NRK1", "NRK2", "TV 2", "TV 2 Direkte"];
  const DK_NETWORKS = ["DR1", "DR2", "TV2"];          // Denmark's channel has no space on TVmaze
  const FI_NETWORKS = ["Yle TV1", "Yle TV2", "MTV3"];
  const IS_NETWORKS = ["RÚV", "Stöð 2"];
  // country code -> flagship channels. A country's schedule is only fetched when the user
  // follows at least one of its channels, so API calls stay proportional to the selection.
  const COUNTRY_NETWORKS = {
    GB: UK_NETWORKS, AU: AU_NETWORKS,
    SE: SE_NETWORKS, NO: NO_NETWORKS, DK: DK_NETWORKS, FI: FI_NETWORKS, IS: IS_NETWORKS,
  };
  const NORDIC_NETWORKS = [...SE_NETWORKS, ...NO_NETWORKS, ...DK_NETWORKS, ...FI_NETWORKS, ...IS_NETWORKS];
  // Keep only flagship broadcasters from those schedules. Prefix-anchored (not fully anchored)
  // so messy real-world variants still match: "TV 2 Direkte", "SVT2", "ABC News", "5STAR"…
  const FLAGSHIP_RE = /^(BBC (One|Two|Three|Four)|ITV\d|Channel 4|E4|5|Sky (Atlantic|Max)|ABC|Seven Network|Nine Network|Network 10|SBS|SVT\d?|TV4|NRK\d?|TV ?2|DR\d?|Yle TV\d?|MTV3|RÚV|Stöð 2)/i;

  const US_BROADCAST = [
    "ABC", "CBS", "NBC", "FOX", "The CW", "PBS",
    "AMC", "FX", "FXX", "USA Network", "TNT", "TBS", "HBO", "Showtime", "Starz",
    "A&E", "History", "Bravo", "E!", "Syfy", "Comedy Central", "MTV",
    "Cartoon Network", "Adult Swim", "Nickelodeon", "Disney Channel", "Freeform",
    "TLC", "HGTV", "Food Network", "Discovery Channel", "National Geographic",
    "Lifetime", "Hallmark Channel", "Paramount Network", "BET", "truTV",
  ];
  const STREAMING_NETWORKS = [
    "Netflix", "Prime Video", "Hulu", "Disney+", "Max", "Apple TV",
    "Peacock", "Paramount+", "AMC+", "Shudder", "ESPN+",
  ];
  const FR_NETWORKS = ["Canal+", "ARTE", "TF1", "M6", "France 2", "France 3"];

  const SEED_NETWORKS = [
    ...US_BROADCAST, ...STREAMING_NETWORKS, ...FR_NETWORKS,
    ...UK_NETWORKS, ...AU_NETWORKS, ...NORDIC_NETWORKS,
  ];

// Grouped view for the channel picker (label + the channels that belong to each group),
  // so the user can select/clear a whole country at once.
  const NETWORK_GROUPS = [
    { label: "🇺🇸 United States", names: US_BROADCAST },
    { label: "📺 Streaming", names: STREAMING_NETWORKS },
    { label: "🇫🇷 France", names: FR_NETWORKS },
    { label: "🇬🇧 United Kingdom", names: UK_NETWORKS },
    { label: "🇦🇺 Australia", names: AU_NETWORKS },
    { label: "🇸🇪 Sweden", names: SE_NETWORKS },
    { label: "🇳🇴 Norway", names: NO_NETWORKS },
    { label: "🇩🇰 Denmark", names: DK_NETWORKS },
    { label: "🇫🇮 Finland", names: FI_NETWORKS },
    { label: "🇮🇸 Iceland", names: IS_NETWORKS },
  ];

  // URL segment for a channel: a readable slug for the seed channels (served by a generated
  // page), the encoded name for any other channel (served by 404.html).
  function networkSlug(name) {
    return String(name)
      .replace(/ð/gi, "d").replace(/þ/gi, "th").replace(/æ/gi, "ae").replace(/ø/gi, "o")
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/\+/g, " plus ").replace(/&/g, " and ")
      .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }
  const SLUG_TO_NAME = new Map(SEED_NETWORKS.map((n) => [networkSlug(n), n]));
  function networkSegment(name) {
    const slug = networkSlug(name);
    return SLUG_TO_NAME.get(slug) === name ? slug : encodeURIComponent(name);
  }
  function networkFromSegment(seg) {
    const s = String(seg).replace(/\.html$/, "");
    if (SLUG_TO_NAME.has(s)) return SLUG_TO_NAME.get(s);
    try { return decodeURIComponent(s); } catch { return s; }
  }

  // Page texts. SITE_META must match index.html (checked by tests/smoke.test.js).
  const SITE_URL = "https://jmicaux.github.io/upcoming-tv-shows/";
  const SITE_META = {
    title: "Upcoming TV Shows",
    description: "Track upcoming TV and streaming premieres month by month across US, UK, Australian, Nordic and French channels. Follow your favorites and filter by genre.",
    twitterDescription: "Upcoming TV and streaming premieres month by month — US, UK, Australian, Nordic and French channels. Filter by genre.",
    url: SITE_URL,
  };
  // Title, description and URL of a channel page (generated page and in-app navigation alike).
  function networkMeta(name) {
    const description = `New and returning ${name} series, month by month: premiere dates, seasons and episodes. Free, no account needed.`;
    return {
      title: `Upcoming ${name} shows and premieres — Upcoming TV Shows`,
      description, twitterDescription: description,
      url: SITE_URL + "network/" + networkSegment(name),
    };
  }

  const api = {
    UK_NETWORKS, AU_NETWORKS, SE_NETWORKS, NO_NETWORKS, DK_NETWORKS, FI_NETWORKS, IS_NETWORKS, COUNTRY_NETWORKS, NORDIC_NETWORKS, FLAGSHIP_RE, US_BROADCAST, STREAMING_NETWORKS, FR_NETWORKS, SEED_NETWORKS,
    networkSlug, networkSegment, networkFromSegment, SITE_META, networkMeta, NETWORK_GROUPS,
  };
  root.UpcomingNetworks = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
