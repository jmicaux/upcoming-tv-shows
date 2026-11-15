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

// Known bug: cards already on screen keep their old "Watch on" link (the feed reuses
// existing card nodes); the redirect only shows after a reload. Remove test.fail() once fixed.
test("settings: a watch redirect changes the Watch on links", async ({ page }) => {
  test.fail();
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
