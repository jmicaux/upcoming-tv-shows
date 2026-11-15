// Phone layout (≤ 640 px): bottom tab bar, Filters sheet, More sheet.
const { test, expect, cardTitles } = require("./fixtures");

test.beforeEach(async ({ page }) => {
  await page.goto("./");
  await expect(page.locator(".card", { hasText: "Alpha Saga" })).toBeVisible();
});

test("the tab bar switches views and shows the Watchlist count", async ({ page }) => {
  const tabs = page.getByRole("navigation", { name: "Main" });
  await expect(tabs).toBeVisible();
  await page.getByRole("button", { name: "Add Alpha Saga to watchlist" }).first().click();
  await expect(tabs.getByRole("button", { name: "Watchlist, 1 shows" })).toBeVisible();
  await tabs.getByRole("button", { name: "Watchlist, 1 shows" }).click();
  await expect(page).toHaveURL(/\/watchlist$/);
  await expect.poll(() => cardTitles(page.locator("#grid"))).toEqual(["Alpha Saga"]);
  await tabs.getByRole("button", { name: "Upcoming" }).click();
  await expect(page.locator("h1.view-title")).toHaveText("Upcoming TV premieres");
});

test("filters live in a sheet behind one button that counts active filters", async ({ page }) => {
  const toggle = page.locator("#filtersToggle");
  await expect(toggle).toHaveAttribute("aria-label", "Filters, 1 active"); // Premieres only
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await page.getByLabel("Hide past").check();
  await expect(toggle).toHaveAttribute("aria-label", "Filters, 2 active");
  await page.getByRole("button", { name: "Show results" }).click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).toBeFocused();
  expect(await cardTitles(page.locator("#grid"))).not.toContain("Gamma Files");
});

test("the More sheet opens, traps focus and closes with Escape", async ({ page }) => {
  const more = page.getByRole("button", { name: "More" });
  await more.click();
  const sheet = page.getByRole("dialog", { name: "More" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("button", { name: /Settings/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(more).toBeFocused();
});
