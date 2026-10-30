// Integration module under test: the MAINTENANCE REQUEST WORKFLOW
//   tenant reports -> manager reviews and assigns -> technician works -> manager closes -> tenant sees the result.
// Every step is done through the browser exactly as a person would, and cross-checked against the API and the database rules.
const { test, expect } = require("@playwright/test");

const PW = "password123";
const ACCOUNTS = { manager: "manager@estateops.test", tenant: "tenant@estateops.test", tenant2: "tenant2@estateops.test", tech: "tech@estateops.test", vendor: "vendor@estateops.test" };
const TITLE = "E2E: bathroom basin leaking " + Date.now();
const state = {}; // shared between the ordered steps of the workflow

async function signIn(page, email) {
  await page.goto("/login.html");
  await page.fill("#email", email);
  await page.fill("#pw", PW);
  await page.click("#submit");
  await page.waitForURL("**/app.html**");
  await expect(page.locator("#nav a").first()).toBeVisible();
}
async function api(request, email) {
  const r = await request.post("/api/auth/login", { data: { email, password: PW } });
  expect(r.status()).toBe(200);
  const body = await r.json();
  return { token: body.token, me: { id: body.accountId }, headers: { Authorization: "Bearer " + body.token } };
}
const navLabels = (page) => page.locator("#nav a .lbl").allInnerTexts().then((a) => a.map((s) => s.trim()));
const go = async (page, hash) => { await page.evaluate((h) => { location.hash = h; }, hash); };

test.describe.configure({ mode: "serial" });

test.describe("1. Public pages and sign-in", () => {
  test("landing page shows the product message and no demo credentials", async ({ page }) => {
    await page.goto("/index.html");
    await expect(page.locator("h1")).toContainText("One clear view");
    for (const label of ["Get Started", "Sign In", "See how it works"]) await expect(page.locator(`a:has-text("${label}")`).first()).toBeVisible();
    const text = (await page.innerText("body")).toLowerCase();
    expect(text).not.toContain("password123");
    expect(text).not.toContain("@estateops.test");
  });

  test("wrong password is rejected with a message and stays on the sign-in page", async ({ page }) => {
    await page.goto("/login.html");
    await page.fill("#email", ACCOUNTS.manager);
    await page.fill("#pw", "definitely-wrong");
    await page.click("#submit");
    await expect(page.locator("#err")).not.toBeEmpty();
    await expect(page).toHaveURL(/login\.html/);
  });

  test("login page has no shortcut buttons that sign in as a preset role", async ({ page }) => {
    await page.goto("/login.html");
    await expect(page.locator("button:has-text('Try it as')")).toHaveCount(0);
    await expect(page.locator(".demo")).toHaveCount(0);
  });

  test("app pages refuse a visitor who is not signed in", async ({ page }) => {
    await page.goto("/app.html");
    await page.waitForURL("**/login.html**");
  });
});

test.describe("2. Role separation in the browser", () => {
  const expected = {
    manager: ["Overview", "Requests", "Properties", "People", "Vendors", "Insights", "Activity", "Load testing", "Notifications", "Account"],
    tenant: ["Overview", "Report an issue", "My requests", "Notifications", "Account"],
    tech: null, vendor: ["Overview", "Work orders", "Company", "Notifications", "Account"],
  };
  for (const role of ["manager", "tenant", "vendor"]) {
    test(`${role} sees only their own navigation`, async ({ page }) => {
      await signIn(page, ACCOUNTS[role]);
      expect(await navLabels(page)).toEqual(expected[role]);
    });
  }
  test("a tenant who types a manager-only address is sent back, and the server refuses the call too", async ({ page }) => {
    await signIn(page, ACCOUNTS.tenant);
    await go(page, "#/people");
    await expect.poll(() => page.evaluate(() => location.hash)).toBe("#/overview");
    const status = await page.evaluate(() => fetch("/api/vendors", { headers: { Authorization: "Bearer " + JSON.parse(localStorage.getItem("eo_auth")).token } }).then((r) => r.status));
    expect(status).toBe(403);
  });
  test("signing out ends the session: the old token no longer works", async ({ page, request }) => {
    await signIn(page, ACCOUNTS.tenant2);
    const token = await page.evaluate(() => JSON.parse(localStorage.getItem("eo_auth")).token);
    await page.click("#logout");
    await page.waitForURL("**/login.html**");
    const r = await request.get("/api/auth/me", { headers: { Authorization: "Bearer " + token } });
    expect(r.status()).toBe(401);
  });
});

test.describe("3. The workflow, step by step", () => {
  test("step 1 - tenant reports an issue and it validates input", async ({ page, request }) => {
    await signIn(page, ACCOUNTS.tenant);
    await go(page, "#/report");
    await page.waitForSelector("#reportForm");
    await page.click("#reportForm button[type=submit]");
    await expect(page.locator("#rErr")).toContainText(/short title/i);
    await page.fill("#rTitle", TITLE);
    await page.fill("#rDesc", "Water drips from the base of the basin tap and pools on the floor.");
    await page.selectOption("#rCat", "PLUMBING");
    await page.selectOption("#rPri", "HIGH");
    await page.click("#reportForm button[type=submit]");
    await expect(page.locator("#panes")).toContainText(TITLE);
    await expect(page.locator("#panes")).toContainText(/Reported/i);
    state.id = Number((await page.evaluate(() => location.hash)).split("/").pop());
    expect(state.id).toBeGreaterThan(0);
    // tenants get no manager controls and no cost information
    await expect(page.locator("#assignForm")).toHaveCount(0);
    await expect(page.locator("button:has-text('Close request')")).toHaveCount(0);
  });

  test("step 2 - the report is stored with the right details (API cross-check)", async ({ request }) => {
    const m = await api(request, ACCOUNTS.manager);
    const r = await request.get(`/api/maintenance-requests/${state.id}`, { headers: m.headers });
    expect(r.status()).toBe(200);
    const body = (await r.json()).request;
    expect(body).toMatchObject({ title: TITLE, category: "PLUMBING", priority: "HIGH", status: "REPORTED" });
    expect(body.allowedNext).toEqual(expect.arrayContaining(["UNDER_REVIEW", "ASSIGNED"]));
  });

  test("step 3 - another tenant cannot see it, in the UI or the API", async ({ page, request }) => {
    const t2 = await api(request, ACCOUNTS.tenant2);
    const r = await request.get(`/api/maintenance-requests/${state.id}`, { headers: t2.headers });
    expect(r.status()).toBe(403);
    await signIn(page, ACCOUNTS.tenant2);
    await go(page, `#/request/${state.id}`);
    await expect(page.locator("#panes")).not.toContainText(TITLE);
  });

  test("step 4 - manager finds it by search, reviews it and assigns the technician", async ({ page, request }) => {
    state.techId = (await api(request, ACCOUNTS.tech)).me.id;
    await signIn(page, ACCOUNTS.manager);
    await go(page, "#/requests");
    await page.waitForSelector("tr.clickable");
    await page.fill("#fq", "zzz-no-such-request");
    await expect(page.locator("text=No matching requests")).toBeVisible();
    await page.fill("#fq", "bathroom basin");
    await expect(page.locator("tr.clickable")).toHaveCount(1);
    await page.click("tr.clickable");
    await page.waitForSelector("#assignForm");
    await page.click("button:has-text('Start review')");
    await expect(page.locator("#panes")).toContainText(/Under review/i);
    await page.waitForSelector("#assignForm");
    await page.fill("#aDue", "2030-05-01");
    await page.selectOption("#aWho", "T:" + state.techId);
    await page.click("#assignForm button[type=submit]");
    await expect(page.locator("#panes")).toContainText(/Assigned/i);
  });

  test("step 5 - the assigned technician sees the job; the other technician does not", async ({ page, request }) => {
    const other = await api(request, "tech2@estateops.test");
    expect((await request.get(`/api/maintenance-requests/${state.id}`, { headers: other.headers })).status()).toBe(403);
    await signIn(page, ACCOUNTS.tech);
    await go(page, "#/requests");
    await expect(page.locator("tr.clickable", { hasText: TITLE })).toHaveCount(1);
  });

  test("step 6 - technician cannot close the request, but can start and finish the work", async ({ page, request }) => {
    const t = await api(request, ACCOUNTS.tech);
    const denied = await request.post(`/api/maintenance-requests/${state.id}/status`, { headers: t.headers, data: { target: "CLOSED" } });
    expect(denied.status()).toBe(403);
    await signIn(page, ACCOUNTS.tech);
    await go(page, `#/request/${state.id}`);
    await expect(page.locator("button:has-text('Close request')")).toHaveCount(0);
    await page.click("button:has-text('Start work')");
    await expect(page.locator("button:has-text('Mark work complete')")).toBeVisible();
    await page.click("button:has-text('Mark work complete')");
    await page.click("#completeForm button[type=submit]");
    await expect(page.locator("#cErr")).toContainText(/describe what was done/i);
    await page.fill("#cNotes", "Replaced the washer and sealed the base. No leak after a 10 minute test.");
    await page.click("#completeForm button[type=submit]");
    await expect(page.locator("#panes")).toContainText(/Completed/i);
  });

  test("step 7 - manager closes the completed request", async ({ page }) => {
    await signIn(page, ACCOUNTS.manager);
    await go(page, `#/request/${state.id}`);
    await expect(page.locator("#panes")).toContainText("Replaced the washer");
    await page.click("button:has-text('Close request')");
    await expect(page.locator("#panes")).toContainText(/Closed/i);
    await expect(page.locator("button:has-text('Close request')")).toHaveCount(0);
  });

  test("step 8 - the history records every move, in order", async ({ request }) => {
    const m = await api(request, ACCOUNTS.manager);
    const detail = await (await request.get(`/api/maintenance-requests/${state.id}`, { headers: m.headers })).json();
    expect(detail.request.status).toBe("CLOSED");
    const trail = detail.history.map((e) => e.toStatus).filter(Boolean);
    expect(trail.slice(-5)).toEqual(["UNDER_REVIEW", "ASSIGNED", "IN_PROGRESS", "COMPLETED", "CLOSED"]);
  });

  test("step 9 - the tenant was notified and can see the final outcome", async ({ page, request }) => {
    const t = await api(request, ACCOUNTS.tenant);
    const notes = await (await request.get("/api/notifications", { headers: t.headers })).json();
    expect(notes.length).toBeGreaterThan(0);
    await signIn(page, ACCOUNTS.tenant);
    await go(page, `#/request/${state.id}`);
    await expect(page.locator("#panes")).toContainText(/Closed/i);
    await expect(page.locator("#panes")).toContainText("Replaced the washer");
  });

  test("step 10 - a closed request cannot be pushed back to an invalid state", async ({ request }) => {
    const m = await api(request, ACCOUNTS.manager);
    const bad = await request.post(`/api/maintenance-requests/${state.id}/status`, { headers: m.headers, data: { target: "IN_PROGRESS" } });
    expect(bad.status()).toBe(400);
  });
});

test.describe("4. Responsive layout", () => {
  test("the manager dashboard has no sideways scrolling on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await signIn(page, ACCOUNTS.manager);
    await page.waitForSelector(".stats");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
