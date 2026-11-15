// Watchlist, the show dialog, catalog search, settings and theme.
const { test, expect, cardTitles } = require("./fixtures");

test.beforeEach(async ({ page }) => {
  await page.goto("./");
  await expect(page.locator(".card", { hasText: "Alpha Saga" })).toBeVisible();
});

test("starring a show adds it to the Watchlist, grouped by its next episode", async ({ page }) => {
  await page.getByRole("button", { name: "Add Alpha Saga to watchlist" }).first().click();
  await page.getByRole("button", { name: "Add Beta Returns to watchlist" }).first().click();
  await expect(page.locator("#viewBtn")).toContainText("2");

  await page.locator("#viewBtn").click();
  await expect(page).toHaveURL(/\/watchlist$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Watchlist");
  await expect.poll(() => cardTitles(page.locator("#grid"))).toEqual(["Beta Returns", "Alpha Saga"]);
  await expect(page.locator(".card", { hasText: "Alpha Saga" }).locator(".card-date")).toContainText("S1E1");

  // Watchlist toggles are its own: Series premieres only keeps Alpha (S1E1), not Beta (S3E1).
  await page.getByLabel("Series premieres only").check();
  await expect.poll(() => cardTitles(page.locator("#grid"))).toEqual(["Alpha Saga"]);

  await page.reload(); // favorites persist
  await expect.poll(() => cardTitles(page.locator("#grid"))).toEqual(["Beta Returns", "Alpha Saga"]);

  await page.getByRole("button", { name: "Add Alpha Saga to watchlist" }).click(); // un-star
  await page.getByRole("button", { name: "Add Beta Returns to watchlist" }).click();
  await page.goto("watchlist");
  await expect(page.getByText("No favorites yet.")).toBeVisible();
});

test("the show dialog: content, keyboard navigation, focus return", async ({ page }) => {
  const opener = page.locator(".card", { hasText: "Beta Returns" }).getByRole("button", { name: "Beta Returns", exact: true });
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "Beta Returns" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Beta Returns" })).toBeVisible();
  await expect(dialog).toContainText("S3E1");
  await expect(dialog.getByRole("link", { name: /Watch on HBO/ })).toHaveAttribute("target", "_blank");

  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("dialog", { name: "Alpha Saga" })).toBeVisible();

  await page.getByRole("dialog", { name: "Alpha Saga" }).getByRole("button", { name: "☆ Add to watchlist" }).click();
  await expect(page.locator(".modal-fav")).toHaveAttribute("aria-pressed", "true");

  await page.keyboard.press("Escape");
  await expect(page.locator("#modal")).toBeHidden();
  await expect(page.locator(".card", { hasText: "Beta Returns" }).getByRole("button", { name: "Beta Returns", exact: true })).toBeFocused();
  await expect(page.locator("#viewBtn")).toContainText("1");
});

test("Back closes the dialog instead of leaving the page", async ({ page }) => {
  await page.locator(".card", { hasText: "Delta Quiz" }).getByRole("button", { name: "Delta Quiz", exact: true }).click();
  await expect(page.locator("#modal")).toBeVisible();
  await page.goBack();
  await expect(page.locator("#modal")).toBeHidden();
  await expect(page).toHaveURL(/\/upcoming-tv-shows\/$/);
});

test("catalog search finds shows and Escape returns to the feed", async ({ page }) => {
  await page.getByRole("button", { name: "Search shows" }).click();
  await page.getByRole("searchbox", { name: "Search shows" }).fill("zeta");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Search results for “zeta”");
  await expect.poll(() => cardTitles(page.locator("#grid"))).toEqual(["Zeta Rising"]);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Upcoming TV premieres");
});

// Regression: cards already on screen used to keep their old "Watch on" link (the feed
// reuses card nodes) until a reload.
test("settings: a watch redirect changes the Watch on links", async ({ page }) => {
  await page.getByRole("button", { name: "Settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await dialog.getByRole("button", { name: "+ Add mapping" }).click();
  await dialog.getByRole("combobox", { name: "Source channel" }).selectOption("HBO");
  await dialog.getByRole("combobox", { name: "Watch provider" }).selectOption("Canal+");
  await page.keyboard.press("Escape");
  await expect(page.locator(".card", { hasText: "Beta Returns" }).locator(".card-watch")).toContainText("Watch on Canal+");
});

test("theme toggle switches and persists", async ({ page }) => {
  const initial = await page.locator("html").getAttribute("data-theme");
  await page.locator("#themeBtn").click();
  const next = initial === "dark" ? "light" : "dark";
  await expect(page.locator("html")).toHaveAttribute("data-theme", next);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", next);
});

// Regression: the Watchlist asks TVmaze for every favorite at once; the request limiter
// computed its wait from a shared timestamp, so concurrent calls all left together and
// TVmaze answered 429 (shows then wrongly read "No upcoming episode").
test("TVmaze requests are spaced out, even when made at the same time", async ({ page }) => {
  const sent = [];
  page.on("request", (r) => { if (/api\.tvmaze\.com\/shows\/\d+/.test(r.url())) sent.push(Date.now()); });
  for (const name of ["Alpha Saga", "Beta Returns", "Gamma Files"]) {
    await page.getByRole("button", { name: `Add ${name} to watchlist` }).first().click();
  }
  await page.locator("#viewBtn").click();
  await expect.poll(() => cardTitles(page.locator("#grid"))).toHaveLength(3);
  expect(sent).toHaveLength(3);
  const gaps = sent.slice(1).map((t, i) => t - sent[i]);
  expect(Math.min(...gaps), `gaps between requests: ${gaps.join(", ")} ms`).toBeGreaterThanOrEqual(450);
});

// Importing a preferences file (the plain file-input path).
const prefsFile = (prefs) => ({
  name: "prefs.json", mimeType: "application/json",
  buffer: Buffer.from(JSON.stringify({ app: "lineup", version: 1, ...prefs })),
});

test("importing preferences loads newly followed channels and applies watch redirects", async ({ page }) => {
  page.on("dialog", (d) => d.accept()); // "Replace your current favorites…?"
  await page.locator("#importFile").setInputFiles(prefsFile({
    followedNetworks: ["CBS", "HBO"], watchOverrides: { HBO: "Canal+" },
  }));
  await expect.poll(() => cardTitles(page.locator("#grid"))).toEqual(["Beta Returns", "Eta Hospital"]);
  await expect(page.locator(".card", { hasText: "Beta Returns" }).locator(".card-watch")).toContainText("Watch on Canal+");
});

test("importing preferences on a channel page keeps the page, and saves the selection for later", async ({ page }) => {
  page.on("dialog", (d) => d.accept());
  await page.goto("network/hbo");
  await expect(page.locator(".card", { hasText: "Beta Returns" })).toBeVisible();
  await page.locator("#importFile").setInputFiles(prefsFile({ followedNetworks: ["CBS"] }));
  await expect(page.locator("h1.view-title")).toHaveText("Upcoming HBO shows");
  await expect.poll(() => cardTitles(page.locator("#grid"))).toEqual(["Beta Returns"]);
  await page.getByRole("button", { name: "Clear HBO filter" }).click();
  await expect.poll(() => cardTitles(page.locator("#grid"))).toEqual(["Eta Hospital"]);
});
