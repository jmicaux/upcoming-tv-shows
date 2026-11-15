// Addresses: channel and country pages, not-found, in-app navigation and Back.
const { test, expect, cardTitles, monthBlock } = require("./fixtures");

const nov = (page) => cardTitles(monthBlock(page, "November 2026"));

test("a channel page shows that channel only, without touching the saved selection", async ({ page }) => {
  await page.goto("network/cbs");
  await expect(page).toHaveTitle("Upcoming CBS shows and premieres — Upcoming TV Shows");
  await expect(page.locator("h1.view-title")).toHaveText("Upcoming CBS shows");
  await expect(page.locator("#breadcrumb")).toContainText("CBS");
  await expect.poll(() => nov(page)).toEqual(["Eta Hospital"]);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://jmicaux.github.io/upcoming-tv-shows/network/cbs");

  await page.getByRole("button", { name: "Clear CBS filter" }).click();
  await expect(page).toHaveURL(/\/upcoming-tv-shows\/$/);
  await expect(page.locator("h1.view-title")).toHaveText("Upcoming TV premieres");
  await expect.poll(() => nov(page)).not.toContain("Eta Hospital");
});

test("a country page shows all its channels", async ({ page }) => {
  await page.goto("country/united-kingdom");
  await expect(page).toHaveTitle("Upcoming TV shows in the United Kingdom — Upcoming TV Shows");
  await expect(page.locator("h1.view-title")).toHaveText("Upcoming TV shows in the United Kingdom");
  await expect.poll(() => nov(page)).toEqual(["Gamma Files", "Delta Quiz"]);
  await expect(page.getByRole("button", { name: "Clear United Kingdom filter" })).toBeVisible();
});

test("a channel link on a card filters in place, and Back returns", async ({ page }) => {
  await page.goto("./");
  await page.locator(".card", { hasText: "Beta Returns" }).getByRole("link", { name: "HBO", exact: true }).click();
  await expect(page).toHaveURL(/\/network\/hbo$/);
  await expect.poll(() => nov(page)).toEqual(["Beta Returns"]);
  await page.goBack();
  await expect(page.locator("h1.view-title")).toHaveText("Upcoming TV premieres");
  await expect.poll(() => nov(page)).toContain("Alpha Saga");
});

test("footer country link navigates without reloading the app", async ({ page }) => {
  await page.goto("./");
  await page.evaluate(() => { window.__sameDocument = true; });
  await page.locator(".site-footer").getByRole("link", { name: "France", exact: true }).click();
  await expect(page).toHaveURL(/\/country\/france$/);
  await expect(page.locator("h1.view-title")).toHaveText("Upcoming TV shows in France");
  expect(await page.evaluate(() => window.__sameDocument)).toBe(true);
  await expect.poll(() => nov(page)).toEqual(["Epsilon"]);
});

test("an unknown address shows a useful not-found page, not indexed", async ({ page }) => {
  await page.goto("no/such/page");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Page not found");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex");
  await page.locator(".not-found").getByRole("link", { name: "Netflix" }).click();
  await expect(page).toHaveURL(/\/network\/netflix$/);
  await expect(page.locator("h1.view-title")).toHaveText("Upcoming Netflix shows");
});

test("generated pages are readable without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
  await page.goto("country/sweden");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Upcoming TV shows in Sweden");
  await expect(page.getByRole("main").getByRole("link", { name: "SVT1" })).toBeVisible();
  await context.close();
});
