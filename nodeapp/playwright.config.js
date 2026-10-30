// Integration / UI tests. Starts the real server on a throw-away database with sample data,
// then drives it in a real browser. Run: npm run e2e   (headed: npm run e2e:headed)
const { defineConfig, devices } = require("@playwright/test");
const os = require("os"), path = require("path"), fs = require("fs");

const PORT = process.env.E2E_PORT || "4010";
const FRESH_PORT = String(Number(PORT) + 1);
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "estateops-e2e-"));
const DATA_FRESH = fs.mkdtempSync(path.join(os.tmpdir(), "estateops-e2e-fresh-"));
const chrome = process.env.CHROME;
const SFX = process.env.REPORT_SUFFIX || ""; // e.g. "-regression" keeps the regression run from overwriting the full run // optional: path to an existing Chrome/Chromium

module.exports = defineConfig({
  testDir: "./e2e",
  // Artifacts go to the system temp folder: on Windows, antivirus/indexing/cloud-sync can lock files inside the project (EBUSY).
  outputDir: path.join(os.tmpdir(), "estateops-pw-artifacts"),
  fullyParallel: false,
  workers: 1,
  retries: 1,
  timeout: 45000,
  expect: { timeout: 8000 },
  reporter: [
    ["list"],
    ["html", { outputFolder: `report/e2e-html${SFX}`, open: "never" }],
    ["junit", { outputFile: `report/e2e-junit${SFX}.xml` }],
    ["json", { outputFile: `report/e2e-results${SFX}.json` }],
  ],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    screenshot: "on",          // a screenshot at the end of every test
    video: "on",               // a recording of every test
    trace: "retain-on-failure", // step-by-step trace kept for failed tests (viewable in the report)
    viewport: { width: 1360, height: 900 },
    launchOptions: { ...(chrome ? { executablePath: chrome } : {}), slowMo: Number(process.env.SLOWMO || 0) },
  },
  projects: [
    { name: "sample-data", testMatch: ["maintenance-workflow.spec.js", "security-ui.spec.js", "platform.spec.js", "landing.spec.js", "regression.spec.js", "loadtest.spec.js"], use: { ...devices["Desktop Chrome"], viewport: { width: 1360, height: 900 } } },
    { name: "fresh-install", testMatch: ["full-journey.spec.js"], use: { ...devices["Desktop Chrome"], viewport: { width: 1360, height: 900 }, baseURL: `http://127.0.0.1:${FRESH_PORT}` } },
  ],
  webServer: [{
    command: "node scripts/dev.js",
    url: `http://127.0.0.1:${PORT}/health`,
    reuseExistingServer: false,
    timeout: 60000,
    env: { PORT, DATA_DIR: DATA, UPLOAD_DIR: path.join(DATA, "uploads"), LOG_REQUESTS: "0", SEED_PASSWORD: "password123" },
  }, {
    // second server with an EMPTY database (no sample data) for the first-run journey
    command: "node server.js",
    url: `http://127.0.0.1:${FRESH_PORT}/health`,
    reuseExistingServer: false,
    timeout: 60000,
    env: { PORT: FRESH_PORT, NODE_ENV: "development", DATA_DIR: DATA_FRESH, UPLOAD_DIR: path.join(DATA_FRESH, "uploads"), LOG_REQUESTS: "0" },
  }],
});
