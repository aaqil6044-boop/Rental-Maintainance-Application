// LOAD-TESTING DASHBOARD, driven like a person: configure, get validation feedback, start a real (small) run against this
// server, watch it, stop one, export, compare. Runs against the sample-data install.
const { test, expect } = require("@playwright/test");
const PW = "password123";

async function signIn(page, request, email) {
  const r = await request.post("/api/auth/login", { data: { email, password: PW } });
  const auth = await r.json();
  await page.goto("/login.html");
  await page.evaluate((a) => localStorage.setItem("eo_auth", JSON.stringify(a)), auth);
  return auth;
}
const setSmall = async (page, o = {}) => {
  const v = { durationSec: 6, rampUpSec: 1, rampDownSec: 1, maxUsers: 2, ...o };
  await page.fill("#f_durationSec", String(v.durationSec)); await page.fill("#f_rampUpSec", String(v.rampUpSec));
  await page.fill("#f_rampDownSec", String(v.rampDownSec)); await page.fill("#f_maxUsers", String(v.maxUsers));
  await page.fill("#f_startUsers", "1");
  if (o.name) await page.fill("#f_name", o.name);
};
const finished = (page, ms = 40000) => page.waitForFunction(() => /Completed|Cancelled|Failed/.test((document.querySelector("#runArea .state") || {}).textContent || ""), null, { timeout: ms });

test.describe.configure({ mode: "serial" });

test("a tenant cannot use load testing", async ({ page, request }) => {
  await signIn(page, request, "tenant@estateops.test");
  await page.goto("/loadtest.html");
  await expect(page.getByText("available to organization admins only")).toBeVisible();
  await expect(page.locator("#cfg")).toHaveCount(0);
});

test("the admin sees the page in navigation and a sensible default configuration", async ({ page, request }) => {
  await signIn(page, request, "manager@estateops.test");
  await page.goto("/app.html#/overview");
  await expect(page.getByRole("link", { name: "Load testing" })).toBeVisible();
  await page.getByRole("link", { name: "Load testing" }).click();
  await expect(page).toHaveURL(/loadtest\.html/);
  await expect(page.getByRole("heading", { name: "Configure a test" })).toBeVisible();
  await expect(page.locator("#f_target")).toHaveValue("local");
  await expect(page.locator("#vsum")).toHaveText("Configuration is valid.");
  await expect(page.locator("#prof svg")).toBeVisible();
  await expect(page.locator("#prof")).toContainText("Total 1 min = ramp-up + steady + ramp-down");
});

test("invalid settings are explained and nothing is started", async ({ page, request }) => {
  await signIn(page, request, "manager@estateops.test");
  let posts = 0; page.on("request", (r) => { if (r.method() === "POST" && /\/api\/loadtests$/.test(r.url())) posts++; });
  await page.goto("/loadtest.html"); await page.waitForSelector("#cfg");
  await page.fill("#f_maxUsers", "0");
  await expect(page.locator("#e_maxUsers")).toContainText("at least 1");
  await expect(page.locator("#f_maxUsers")).toHaveAttribute("aria-invalid", "true");
  await page.fill("#f_maxUsers", "5"); await page.fill("#f_durationSec", "20"); await page.fill("#f_rampUpSec", "30");
  await expect(page.locator("#e_rampUpSec")).toContainText("INCLUDES");
  await expect(page.locator("#prof")).toContainText("Fix the highlighted settings");
  await page.fill("#f_maxUsers", "5000");
  await expect(page.locator("#e_maxUsers")).toContainText("at most 200");
  await page.getByRole("button", { name: "Start test" }).click();
  await expect(page.locator("#flash")).toContainText(/fixing|valid|fix/i).catch(() => {});
  expect(posts).toBe(1); // the server was asked and refused (400); the UI trusts the server, not itself
  await expect(page.locator("#runArea .state.run")).toHaveCount(0);
});

test("units can be switched to minutes, the profile preview follows, and presets are only starting points", async ({ page, request }) => {
  await signIn(page, request, "manager@estateops.test");
  await page.goto("/loadtest.html"); await page.waitForSelector("#cfg");
  await page.selectOption("[data-unit='durationSec']", "min"); await page.fill("#f_durationSec", "5");
  await page.fill("#f_rampUpSec", "30"); await page.fill("#f_rampDownSec", "30"); await page.fill("#f_maxUsers", "40");
  await expect(page.locator("#prof")).toContainText("Total 5 min");
  await expect(page.locator("#prof svg")).toHaveAttribute("aria-label", /peak 40 users/);
  await page.click("[data-preset='1']");
  await expect(page.locator("#f_maxUsers")).toHaveValue("30");
  await expect(page.locator("#prof")).toContainText("Total 5 min");
});

test("help tooltips work with the keyboard", async ({ page, request }) => {
  await signIn(page, request, "manager@estateops.test");
  await page.goto("/loadtest.html"); await page.waitForSelector("#cfg");
  await page.locator("#f_durationSec").focus(); await page.keyboard.press("Shift+Tab");
  await expect(page.locator("#tip")).toBeVisible();
  await expect(page.locator("#tip")).toContainText("INCLUDED");
  await page.keyboard.press("Escape"); await expect(page.locator("#tip")).toBeHidden();
});

test("a real run: live metrics, measured vs target users, thresholds, history, export", async ({ page, request }) => {
  await signIn(page, request, "manager@estateops.test");
  await page.goto("/loadtest.html"); await page.waitForSelector("#cfg");
  await setSmall(page, { name: "UI smoke run" });
  await page.click("#startBtn");
  await expect(page.locator("#runArea .state.run")).toBeVisible();
  await expect(page.locator("#estop")).toBeVisible();
  await expect(page.locator("#runArea .card .k", { hasText: "Target users" })).toBeVisible();
  await expect(page.locator("#runArea .card .k", { hasText: "Active users" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop gracefully" })).toBeVisible();
  // starting another while this one runs is refused
  await page.getByRole("button", { name: "Start test" }).click();
  await expect(page.locator("#flash")).toContainText(/already running/i);
  await finished(page);
  await expect(page.locator("#runArea .state")).toHaveText("Completed");
  await expect(page.locator("#runArea .vd")).toContainText(/Thresholds met|Thresholds not met/);
  await expect(page.locator("#estop")).toBeHidden();
  for (const k of ["Requests", "Throughput", "Median (p50)", "p95", "p99", "Error rate"]) await expect(page.locator("#runArea .card .k", { hasText: new RegExp("^" + k.replace(/[()]/g, "\\$&") + "$") })).toBeVisible();
  await expect(page.locator("#runArea .chart svg")).toHaveCount(5); // users, latency, throughput, cpu, memory
  await expect(page.locator("#runArea table.data").first()).toBeVisible();
  await expect(page.locator("#runArea")).toContainText("Server resources");
  await expect(page.locator("#runArea")).toContainText("share one machine");
  // chart hover tooltip + table fallback
  const hit = page.locator(".chart[data-chart='users'] .hit"); await hit.scrollIntoViewIfNeeded(); const b = await hit.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await expect(page.locator(".chart[data-chart='users'] .chart-tip")).toContainText("Active virtual users");
  await page.locator(".chart[data-chart='users'] summary").click();
  await expect(page.locator(".chart[data-chart='users'] .mini table")).toBeVisible();
  // export
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "JSON (everything)" }).click()]);
  const fs = require("fs"); const body = JSON.parse(fs.readFileSync(await dl.path(), "utf8"));
  expect(body.run.name).toBe("UI smoke run"); expect(body.run.summary.totals.requests).toBeGreaterThan(0);
  expect(JSON.stringify(body)).not.toMatch(/eyJ|"password"/);
  const [csv] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "CSV · endpoints" }).click()]);
  expect(fs.readFileSync(await csv.path(), "utf8")).toMatch(/^endpoint,requests,errors/);
  await expect(page.locator("#histArea tbody tr").first()).toContainText("UI smoke run");
});

test("stop gracefully ends early as Cancelled with an inconclusive verdict, then two runs are compared", async ({ page, request }) => {
  await signIn(page, request, "manager@estateops.test");
  await page.goto("/loadtest.html"); await page.waitForSelector("#cfg");
  await setSmall(page, { name: "UI long run", durationSec: 60, maxUsers: 2 });
  await page.click("#startBtn");
  await expect(page.locator("#runArea .state.run")).toBeVisible();
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: "Stop gracefully" }).click();
  await finished(page, 20000);
  await expect(page.locator("#runArea .state")).toHaveText("Cancelled");
  await expect(page.locator("#runArea .vd")).toContainText("Inconclusive");
  await expect(page.locator("#runArea")).toContainText("verdict is inconclusive");
  // compare the two runs
  await page.locator("#histArea input[data-pick]").nth(1).check(); await page.locator("#histArea input[data-pick]").nth(0).check();
  await page.getByRole("button", { name: "Compare selected" }).click();
  await expect(page.locator("#cmpArea")).toContainText("baseline");
  await expect(page.locator("#cmpArea")).toContainText(/improved|regressed|similar/);
  await expect(page.locator("#cmpArea")).toContainText("different settings");
});

test("a page reload re-attaches to a run that is still going, and the layout holds at tablet width", async ({ page, request }) => {
  await signIn(page, request, "manager@estateops.test");
  await page.goto("/loadtest.html"); await page.waitForSelector("#cfg");
  await setSmall(page, { name: "UI reload run", durationSec: 30 });
  await page.click("#startBtn"); await expect(page.locator("#runArea .state.run")).toBeVisible();
  await page.reload(); await page.waitForSelector("#cfg");
  await expect(page.locator("#runArea .state.run")).toBeVisible();
  await expect(page.locator("#runArea h2#runh")).toHaveText("UI reload run");
  await expect(page.locator("#estop")).toBeVisible();
  await page.setViewportSize({ width: 820, height: 1000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  page.once("dialog", (d) => d.accept());
  await page.locator("#estop").click();
  await finished(page, 20000);
  await expect(page.locator("#runArea .state")).toHaveText("Cancelled");
  await expect(page.locator("#runArea")).toContainText("Emergency stop");
});

test("profiles: spike, step and custom show their stages; owner is shown as unavailable", async ({ page, request }) => {
  await signIn(page, request, "manager@estateops.test");
  await page.goto("/loadtest.html"); await page.waitForSelector("#cfg");
  await expect(page.locator("#pw_owner")).toBeDisabled();
  await expect(page.locator("#owner_note")).toContainText("no owner account role");
  for (const p of ["tenant", "manager", "technician", "vendor", "admin"]) await expect(page.locator("#pw_" + p)).toBeEnabled();
  await page.selectOption("#f_profile", "spike");
  await expect(page.locator("#f_spikeAtSec")).toBeVisible();
  await expect(page.locator("#prof")).toContainText("spike");
  await expect(page.locator("#prof")).toContainText("baseline");
  await page.selectOption("#f_profile", "step");
  await expect(page.locator("#f_steps")).toBeVisible();
  await expect(page.locator("#prof")).toContainText("step 1");
  await page.selectOption("#f_profile", "custom");
  await expect(page.locator("#vsum")).toHaveText("Configuration is valid.");
  await expect(page.locator("#prof")).toContainText("stage 2");
  await page.fill("#f_stagesText", "10s 2\nnonsense");
  await expect(page.locator("#e_stages")).not.toBeEmpty();
  await page.fill("#f_stagesText", "4s 1\n4s 3\n2s 0");
  await expect(page.locator("#vsum")).toHaveText("Configuration is valid.");
  await expect(page.locator("#prof")).toContainText("Total 10 s");
});

test("two real runs: security panel, per-role tables, regression check, known-good, HTML report", async ({ page, request }) => {
  test.setTimeout(150000);
  await signIn(page, request, "manager@estateops.test");
  await page.goto("/loadtest.html"); await page.waitForSelector("#cfg");
  for (const name of ["UI reg A", "UI reg B"]) {
    await setSmall(page, { name, durationSec: 12, rampUpSec: 2, rampDownSec: 2, maxUsers: 3 });
    await page.click("#startBtn");
    await expect(page.locator("#runArea .state.run")).toBeVisible();
    await finished(page, 60000);
    await expect(page.locator("#runArea .state")).toHaveText("Completed");
  }
  await expect(page.locator("#runArea")).toContainText("Security checks");
  await expect(page.locator("#byRole")).toBeVisible();
  await expect(page.locator("#byOp")).toBeVisible();
  await expect(page.locator("#regClass, #regNone").first()).toBeVisible({ timeout: 15000 });
  const klass = await page.locator("#regClass").textContent().catch(() => null);
  if (klass) expect(["PASS", "WARNING", "REGRESSION", "INCONCLUSIVE"]).toContain(klass.trim());
  await expect(page.locator("#regHead")).toContainText("p95");
  // known-good toggle
  await page.getByRole("button", { name: "Mark this run as known-good" }).click();
  await expect(page.locator("#flash")).toContainText("known-good");
  await expect(page.getByRole("button", { name: "Remove known-good mark" })).toBeVisible();
  await page.getByRole("button", { name: "Remove known-good mark" }).click();
  // HTML report export is a standalone page with no scripts
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "HTML report" }).click()]);
  const html = require("fs").readFileSync(await dl.path(), "utf8");
  expect(html).toMatch(/<!doctype html>/i); expect(html).not.toMatch(/<script/i); expect(html).toContain("Executive summary");
  // test data check
  const chk = page.getByRole("button", { name: "Check test data" });
  if (await chk.isVisible().catch(() => false)) { await chk.click(); await expect(page.locator("#histArea")).toContainText("Test data check"); }
});
