// Screenshot comparison, a refactoring aid (npm run test:visual; not run in CI, where fonts
// render differently). The first run records the reference images in
// tests/e2e/__screenshots__/ (git-ignored); later runs fail on any visible change.
// To accept a deliberate change: npx playwright test --project=visual --update-snapshots
const { test, expect } = require("./fixtures");

const VIEWS = [
  { name: "home", path: "./", ready: ".card" },
  { name: "country", path: "country/united-kingdom", ready: ".card" },
  { name: "not-found", path: "no/such/page", ready: ".not-found" },
];
// The version number changes with every release: masked, so a bump is not a "change".
const opts = (page, extra = {}) => ({ mask: [page.locator("#appVersion")], ...extra });
const SIZES = [{ name: "desktop", width: 1280, height: 900 }, { name: "phone", width: 390, height: 844 }];

for (const theme of ["light", "dark"]) {
  for (const size of SIZES) {
    for (const view of VIEWS) {
      test(`${view.name} — ${size.name} — ${theme}`, async ({ page }) => {
        await page.setViewportSize(size);
        await page.addInitScript((t) => localStorage.setItem("tv:theme", t), theme);
        await page.goto(view.path);
        await expect(page.locator(view.ready).first()).toBeVisible();
        await page.waitForLoadState("networkidle");
        await expect(page).toHaveScreenshot(`${view.name}-${size.name}-${theme}.png`, opts(page, { fullPage: true }));
      });
    }
    test(`dialog — ${size.name} — ${theme}`, async ({ page }) => {
      await page.setViewportSize(size);
      await page.addInitScript((t) => localStorage.setItem("tv:theme", t), theme);
      await page.goto("./");
      await page.locator(".card", { hasText: "Beta Returns" }).getByRole("button", { name: "Beta Returns", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Beta Returns" })).toBeVisible();
      await expect(page).toHaveScreenshot(`dialog-${size.name}-${theme}.png`, opts(page));
    });
  }
}
