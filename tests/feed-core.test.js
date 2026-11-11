const test = require("node:test");
const assert = require("node:assert/strict");
const F = require("../feed-core.js");

const show = (id, name, network, extra = {}) => ({ id, name, genres: [], network: network && { name: network }, webChannel: null, image: null, summary: "", premiered: null, ...extra });
const ep = (id, s, season = 1, number = 1, airdate = "2026-11-12") => ({ id, season, number, airdate, show: s });

test("US schedule keeps items with a network, trimmed", async () => {
  const raw = [ep(1, show(10, "A", "HBO")), ep(2, show(11, "B", null))];
  const items = await F.fetchScheduleDay(async () => raw, "US", "2026-11-12");
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].show.channel, { name: "HBO", streaming: false });
});

test("web schedule keeps allow-listed platforms only, labelled by platform", async () => {
  const net = (id, name, wc) => ({ id, season: 1, number: 1, airdate: "2026-11-12", _embedded: { show: show(id, name, null, { webChannel: { name: wc } }) } });
  const items = await F.fetchScheduleDay(async () => [net(1, "A", "Netflix"), net(2, "B", "Some Web Thing")], "web", "2026-11-12");
  assert.deepEqual(items.map((i) => i.show.channel), [{ name: "Netflix", streaming: true }]);
});

test("country schedule keeps flagship channels only", async () => {
  const raw = [ep(1, show(10, "A", "BBC One")), ep(2, show(11, "B", "Local TV"))];
  const items = await F.fetchScheduleDay(async () => raw, "GB", "2026-11-12");
  assert.deepEqual(items.map((i) => i.show.channel.name), ["BBC One"]);
});

test("sourceOf routes channels to their upstream source", () => {
  assert.equal(F.sourceOf("Netflix"), "web");
  assert.equal(F.sourceOf("Canal+"), "FR");
  assert.equal(F.sourceOf("BBC One"), "GB");
  assert.equal(F.sourceOf("HBO"), "US");
  assert.equal(F.sourceOf("Unknown Cable"), "US");
});

const NOW = Date.parse("2026-11-11T12:00:00Z");
const index = {
  generatedAt: "2026-11-11T04:00:00Z",
  months: ["2026-11", "2026-12"],
  channels: { Netflix: "netflix", Hulu: "hulu", HBO: "hbo", "BBC One": "bbc-one" },
};

test("planMonth: covered sources come from the snapshot, no live source", () => {
  const plan = F.planMonth(new Set(["Netflix", "HBO", "BBC One"]), index, "2026-11", NOW);
  assert.deepEqual(plan.files.sort(), ["bbc-one", "hbo", "netflix"]);
  assert.equal(plan.live.size, 0);
});

test("planMonth: one uncovered channel keeps its whole source live", () => {
  const plan = F.planMonth(new Set(["Netflix", "HBO", "Some Rare US Channel"]), index, "2026-11", NOW);
  assert.deepEqual(plan.files, ["netflix"]);
  assert.deepEqual([...plan.live], ["US"]);
});

test("planMonth: stale snapshot, missing month or no snapshot → everything live", () => {
  const followed = new Set(["Netflix", "HBO"]);
  const stale = { ...index, generatedAt: "2026-11-09T04:00:00Z" };
  assert.deepEqual([...F.planMonth(followed, stale, "2026-11", NOW).live].sort(), ["US", "web"]);
  assert.deepEqual([...F.planMonth(followed, index, "2027-01", NOW).live].sort(), ["US", "web"]);
  assert.deepEqual([...F.planMonth(followed, null, "2026-11", NOW).live].sort(), ["US", "web"]);
});

test("make-pages --data bakes the upcoming list into channel pages only", () => {
  const { build } = require("../tools/make-pages.js");
  const fs = require("node:fs");
  const indexHtml = fs.readFileSync(__dirname + "/../index.html", "utf8");
  const item = (id, name, airdate, season, number) => ({ id, season, number, airdate, show: { id: name, name, channel: { name: "Netflix" } } });
  const data = {
    index: { months: ["2026-11"], channels: { Netflix: "netflix" } },
    read: () => [
      item(1, "Old Show", "2026-11-01", 2, 1),           // before today → dropped
      item(2, "New <Show>", "2026-11-20", 1, 1),
      item(3, "New <Show>", "2026-11-27", 1, 2),         // same show again → first only
      item(4, "Returning", "2026-11-15", 3, 1),
    ],
    today: "2026-11-11",
  };
  const files = build(indexHtml, data);
  const page = files["network/netflix.html"];
  assert.match(page, /<h2 id="prerender-title">Upcoming on Netflix<\/h2>/);
  assert.match(page, /<time datetime="2026-11-15">Nov 15<\/time> · <strong>Returning<\/strong> · S3E1 — season premiere/);
  assert.match(page, /<strong>New &lt;Show&gt;<\/strong> · S1E1 — series premiere/);
  assert.doesNotMatch(page, /Old Show/);
  assert.equal((page.match(/New &lt;Show&gt;/g) || []).length, 1);
  assert.ok(page.indexOf("Returning") < page.indexOf("New &lt;Show&gt;"), "sorted by date");
  assert.doesNotMatch(files["network/hulu.html"], /class="prerender"/);
  assert.doesNotMatch(files["watchlist.html"], /class="prerender"/);
});
