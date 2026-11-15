// The month feed: what is listed, and how every filter changes it.
const { test, expect, cardTitles, monthBlock } = require("./fixtures");

const november = (page) => monthBlock(page, "November 2026");
const nov = (page) => cardTitles(november(page));

test.beforeEach(async ({ page }) => {
  await page.goto("./");
  await expect(november(page).locator(".card").first()).toBeVisible();
});

test("lists this month's premieres of the default channels, in date order", async ({ page }) => {
  await expect(page).toHaveTitle("Upcoming TV Shows");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Upcoming TV premieres");
  // Premieres only (default): Beta's S3E2 is left out; CBS is not followed by default.
  await expect.poll(() => nov(page)).toEqual(["Gamma Files", "Beta Returns", "Alpha Saga", "Delta Quiz", "Epsilon"]);
  await expect(page.locator("#resultCount")).toHaveText("6 results"); // + Zeta in December
  const gamma = page.locator(".card", { hasText: "Gamma Files" });
  await expect(gamma).toHaveClass(/past/);
  await expect(gamma.locator(".aired-flag")).toHaveText("Aired");
  await expect(gamma.locator(".badge")).toHaveText("Series premiere");
  await expect(page.locator(".card", { hasText: "Beta Returns" }).locator(".badge")).toHaveText("Season 3");
});

test("the premiere toggles, Hide past and Reset filters", async ({ page }) => {
  await page.getByLabel("Premieres only", { exact: true }).uncheck();
  await expect.poll(() => nov(page)).toContain("Beta Returns");
  expect((await nov(page)).filter((t) => t === "Beta Returns")).toHaveLength(2);

  await page.getByLabel("Series premieres only").check();
  await expect.poll(() => nov(page)).toEqual(["Gamma Files", "Alpha Saga", "Epsilon"]);

  await page.getByLabel("Hide past").check();
  await expect.poll(() => nov(page)).toEqual(["Alpha Saga", "Epsilon"]);

  await page.getByRole("button", { name: "Reset filters" }).click();
  await expect(page.getByLabel("Premieres only", { exact: true })).toBeChecked();
  await expect(page.getByLabel("Series premieres only")).not.toBeChecked();
  await expect(page.getByLabel("Hide past")).not.toBeChecked();
  await expect.poll(() => nov(page)).toEqual(["Gamma Files", "Beta Returns", "Alpha Saga", "Delta Quiz", "Epsilon"]);
});

test("genre filter", async ({ page }) => {
  await page.locator("#genreBtn").click();
  await page.locator("#genreList").getByLabel("Comedy").check();
  await expect.poll(() => nov(page)).toEqual(["Beta Returns"]);
  await expect(page.locator("#genreBtnCount")).toHaveText("1");
  await page.locator("#genreClear").click();
  await expect.poll(() => cardTitles(page.locator("#grid"))).toHaveLength(6);
});

test("channel picker: a choice persists across reloads; an empty selection shows nothing", async ({ page }) => {
  await page.locator("#networkBtn").click();
  await page.locator("#networkList").getByLabel("Netflix", { exact: true }).uncheck();
  await expect.poll(() => nov(page)).not.toContain("Alpha Saga");

  await page.reload();
  await expect(page.locator(".card", { hasText: "Beta Returns" })).toBeVisible();
  expect(await nov(page)).not.toContain("Alpha Saga");

  await page.locator("#networkBtn").click();
  await page.locator("#networkClear").click();
  await expect(page.locator("#resultCount")).toHaveText("0 results");
  await expect(page.locator("#grid .card")).toHaveCount(0);
});

// Regression: CBS shares HBO's source, which was already loaded, but its snapshot file was
// not — its shows used to appear only after a reload.
test("selecting a whole country group follows its channels", async ({ page }) => {
  await page.locator("#networkBtn").click();
  await page.getByRole("button", { name: "Select all United States channels" }).click();
  await expect.poll(() => nov(page)).toContain("Eta Hospital");
});

test("the next month loads on demand", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "December 2026" })).toBeVisible();
  await expect(page.locator(".card", { hasText: "Zeta Rising" })).toBeVisible();
  await page.getByRole("button", { name: "Load January 2027" }).click();
  await expect(page.getByRole("heading", { name: "January 2027" })).toBeFocused();
});
