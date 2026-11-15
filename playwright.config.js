// End-to-end tests: the real app in a real browser, against a fixed date and a fixture
// schedule (tests/e2e/fixtures.js) — no call ever leaves the machine, so runs are
// deterministic and work offline.
//   npm run test:e2e      behaviour tests (desktop + mobile), run in CI
//   npm run test:visual   screenshot comparison, local refactoring aid (not in CI: font
//                         rendering differs between machines). First run records the
//                         reference images, later runs compare against them.
const { defineConfig, devices } = require("@playwright/test");

const PORT = 8765;
const BASE = "/upcoming-tv-shows/";

module.exports = defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  snapshotPathTemplate: "tests/e2e/__screenshots__/{projectName}/{arg}{ext}",
  use: {
    baseURL: `http://localhost:${PORT}${BASE}`,
    locale: "en-US",
    timezoneId: "Europe/Paris",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", testIgnore: /(visual|mobile)\.spec/, use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } } },
    { name: "mobile", testMatch: /mobile\.spec/, use: { ...devices["Pixel 7"] } },
    { name: "visual", testMatch: /visual\.spec/, use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } } },
  ],
  // Generated pages (network/, country/, 404.html…) are rebuilt first, without data.
  webServer: {
    command: `node tools/make-pages.js && node tools/serve.js`,
    env: { PORT: String(PORT), BASE },
    url: `http://localhost:${PORT}${BASE}`,
    reuseExistingServer: !process.env.CI,
  },
});
