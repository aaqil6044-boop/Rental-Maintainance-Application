// REGRESSION SUITE - the checks that must never break. Short on purpose: critical paths, key rules and the important
// positive scenarios. Mostly API-level (fast, stable) with three browser checks. Runs against the sample-data install.
// Run: npm run regression
const { test, expect } = require("@playwright/test");

const PW = "password123";
const ACC = { manager: "manager@estateops.test", tenant: "tenant@estateops.test", tenant2: "tenant2@estateops.test", tech: "tech@estateops.test", tech2: "tech2@estateops.test", vendor: "vendor@estateops.test" };
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const UID = Date.now();

async function login(request, email, password = PW) {
  const r = await request.post("/api/auth/login", { data: { email, password } });
  if (r.status() !== 200) return { status: r.status() };
  const b = await r.json();
  return { status: 200, id: b.accountId, role: b.role, token: b.token, h: { Authorization: "Bearer " + b.token } };
}
const get = (request, a, url) => request.get(url, { headers: a.h });
const post = (request, a, url, data) => request.post(url, { headers: a.h, data });
const json = async (r) => r.json();

let U; // logged-in users
test.beforeAll(async ({ playwright, baseURL }) => {
  const ctx = await playwright.request.newContext({ baseURL });
  U = {};
  for (const k of Object.keys(ACC)) U[k] = await login(ctx, ACC[k]);
  await ctx.dispose();
});

/* ------------------------------------------------------------------ Access and sessions */
test.describe("Access and sessions", () => {
  test("REG-01 service is up and the database is reachable", async ({ request }) => {
    expect((await request.get("/health")).status()).toBe(200);
  });
  test("REG-02 every role can sign in and reaches its own dashboard", async ({ request }) => {
    for (const [k, role] of [["manager", "MANAGER"], ["tenant", "TENANT"], ["tech", "TECHNICIAN"], ["vendor", "VENDOR"]]) {
      expect(U[k].status, k).toBe(200); expect(U[k].role).toBe(role);
      expect((await get(request, U[k], "/api/dashboard")).status(), k).toBe(200);
    }
  });
  test("REG-03 wrong password and missing token are refused", async ({ request }) => {
    expect((await login(request, ACC.manager, "wrong-password")).status).toBe(401);
    expect((await request.get("/api/maintenance-requests")).status()).toBe(401);
  });
  test("REG-04 signing out invalidates the token everywhere", async ({ request }) => {
    // a throw-away account: signing out ends ALL sessions of that account, so never use a shared one here
    await request.post("/api/auth/register", { data: { email: `out${UID}@x.test`, password: "Str0ngPassw0rd", fullName: "Sign Out" } });
    const s = await login(request, `out${UID}@x.test`, "Str0ngPassw0rd");
    expect((await get(request, s, "/api/auth/me")).status()).toBe(200);
    expect((await post(request, s, "/api/auth/logout")).status()).toBe(204);
    expect((await get(request, s, "/api/auth/me")).status()).toBe(401);
  });
  test("REG-05 public sign-up can only create a tenant", async ({ request }) => {
    const r = await request.post("/api/auth/register", { data: { email: `reg${UID}@x.test`, password: "Str0ngPassw0rd", fullName: "Reg Tenant", role: "MANAGER" } });
    expect(r.status()).toBe(201); expect((await r.json()).role).toBe("TENANT");
  });
  test("REG-06 a deactivated account can no longer sign in", async ({ request }) => {
    const made = await json(await post(request, U.manager, "/api/accounts", { email: `deact${UID}@x.test`, password: "Str0ngPassw0rd", fullName: "Deact", role: "TECHNICIAN" }));
    expect((await login(request, `deact${UID}@x.test`, "Str0ngPassw0rd")).status).toBe(200);
    expect((await post(request, U.manager, `/api/accounts/${made.id}/status`, { active: false })).status()).toBe(200);
    expect([401, 403]).toContain((await login(request, `deact${UID}@x.test`, "Str0ngPassw0rd")).status);
  });
});

/* ------------------------------------------------------------------ Role fences */
test.describe("Role fences", () => {
  test("REG-07 manager-only areas refuse tenant, technician and vendor", async ({ request }) => {
    for (const url of ["/api/team", "/api/vendors", "/api/audit", "/api/properties", "/api/invitations", "/api/insights"]) {
      expect((await get(request, U.manager, url)).status(), "manager " + url).toBe(200);
      for (const k of ["tenant", "tech", "vendor"]) expect((await get(request, U[k], url)).status(), `${k} ${url}`).toBe(403);
    }
  });
  test("REG-08 a tenant sees only their own requests", async ({ request }) => {
    const mine = await json(await get(request, U.tenant, "/api/maintenance-requests?limit=100"));
    expect(mine.length).toBeGreaterThan(0);
    for (const r of mine) expect(r.reporterId).toBe(U.tenant.id);
  });
  test("REG-09 a technician sees only jobs assigned to them; another technician's job is forbidden", async ({ request }) => {
    for (const r of await json(await get(request, U.tech, "/api/maintenance-requests?limit=100"))) expect(r.technicianId).toBe(U.tech.id);
    const others = await json(await get(request, U.tech2, "/api/maintenance-requests?limit=100"));
    expect(others.length).toBeGreaterThan(0);
    expect((await get(request, U.tech, `/api/maintenance-requests/${others[0].id}`)).status()).toBe(403);
  });
  test("REG-10 a tenant cannot open another tenant's request", async ({ request }) => {
    const theirs = await json(await get(request, U.tenant2, "/api/maintenance-requests?limit=100"));
    expect(theirs.length).toBeGreaterThan(0);
    expect((await get(request, U.tenant, `/api/maintenance-requests/${theirs[0].id}`)).status()).toBe(403);
  });
  test("REG-11 a tenant cannot report an issue on a unit that is not theirs", async ({ request }) => {
    const mine = (await json(await get(request, U.tenant, "/api/units/reportable"))).map((u) => u.id);
    let other = null;
    for (const p of await json(await get(request, U.manager, "/api/properties"))) for (const u of await json(await get(request, U.manager, `/api/properties/${p.id}/units`))) if (!mine.includes(u.id)) other = u.id;
    const r = await post(request, U.tenant, "/api/maintenance-requests", { unitId: other, title: "Not mine", description: "x", category: "OTHER", priority: "LOW" });
    expect([403, 404]).toContain(r.status());
  });
});

/* ------------------------------------------------------------------ Core workflow */
test.describe("Request lifecycle (happy path and its guard rails)", () => {
  test.describe.configure({ mode: "serial" });
  let id;
  test("REG-12 tenant reports an issue", async ({ request }) => {
    const unit = (await json(await get(request, U.tenant, "/api/units/reportable")))[0].id;
    const r = await post(request, U.tenant, "/api/maintenance-requests", { unitId: unit, title: `Regression leak ${UID}`, description: "Water under sink.", category: "PLUMBING", priority: "HIGH" });
    expect(r.status()).toBe(201); id = (await r.json()).id;
    const d = (await json(await get(request, U.manager, `/api/maintenance-requests/${id}`))).request;
    expect(d).toMatchObject({ status: "REPORTED", category: "PLUMBING", priority: "HIGH" });
  });
  test("REG-13 an incomplete report is rejected with a message", async ({ request }) => {
    const unit = (await json(await get(request, U.tenant, "/api/units/reportable")))[0].id;
    const r = await post(request, U.tenant, "/api/maintenance-requests", { unitId: unit, title: "", description: "" });
    expect(r.status()).toBe(400); expect((await r.json()).message).toBeTruthy();
  });
  test("REG-14 steps that skip the lifecycle or exceed a role are refused", async ({ request }) => {
    expect((await post(request, U.manager, `/api/maintenance-requests/${id}/status`, { target: "COMPLETED" })).status()).toBe(400);
    expect((await post(request, U.tenant, `/api/maintenance-requests/${id}/status`, { target: "ASSIGNED" })).status()).toBe(403);
  });
  test("REG-15 manager reviews and assigns a technician", async ({ request }) => {
    expect((await post(request, U.manager, `/api/maintenance-requests/${id}/status`, { target: "UNDER_REVIEW" })).status()).toBe(200);
    expect((await post(request, U.manager, `/api/maintenance-requests/${id}/assign`, { technicianId: U.tech.id, dueDate: "2031-01-01" })).status()).toBe(200);
  });
  test("REG-16 a technician who is not assigned cannot work on it", async ({ request }) => {
    expect((await post(request, U.tech2, `/api/maintenance-requests/${id}/status`, { target: "IN_PROGRESS" })).status()).toBe(403);
  });
  test("REG-17 assigned technician starts and completes; cannot close", async ({ request }) => {
    expect((await post(request, U.tech, `/api/maintenance-requests/${id}/status`, { target: "IN_PROGRESS" })).status()).toBe(200);
    expect((await post(request, U.tech, `/api/maintenance-requests/${id}/status`, { target: "COMPLETED", completionNotes: "Fixed." })).status()).toBe(200);
    expect((await post(request, U.tech, `/api/maintenance-requests/${id}/status`, { target: "CLOSED" })).status()).toBe(403);
  });
  test("REG-18 manager closes it and the history is complete and in order", async ({ request }) => {
    expect((await post(request, U.manager, `/api/maintenance-requests/${id}/status`, { target: "CLOSED" })).status()).toBe(200);
    const d = await json(await get(request, U.manager, `/api/maintenance-requests/${id}`));
    expect(d.request.status).toBe("CLOSED");
    expect(d.history.map((e) => e.toStatus).filter(Boolean).slice(-5)).toEqual(["UNDER_REVIEW", "ASSIGNED", "IN_PROGRESS", "COMPLETED", "CLOSED"]);
  });
  test("REG-19 a closed request cannot be pushed to an invalid state, and can be reopened by the manager", async ({ request }) => {
    expect((await post(request, U.manager, `/api/maintenance-requests/${id}/status`, { target: "IN_PROGRESS" })).status()).toBe(400);
    expect((await post(request, U.manager, `/api/maintenance-requests/${id}/status`, { target: "REOPENED" })).status()).toBe(200);
  });
  test("REG-20 the tenant was notified about progress and can mark it read", async ({ request }) => {
    const notes = await json(await get(request, U.tenant, "/api/notifications"));
    expect(notes.some((n) => n.requestId === id)).toBe(true);
    expect((await post(request, U.tenant, "/api/notifications/read-all")).status()).toBe(204);
    expect((await json(await get(request, U.tenant, "/api/notifications"))).every((n) => n.read)).toBe(true);
  });
});

/* ------------------------------------------------------------------ Costs and approvals */
test.describe("Costs and approvals", () => {
  test.describe.configure({ mode: "serial" });
  let reqId, expId;
  test("REG-21 technician records an expense that waits for approval", async ({ request }) => {
    const mine = await json(await get(request, U.tech, "/api/maintenance-requests?limit=100"));
    reqId = mine.find((r) => r.status !== "CLOSED").id;
    const r = await post(request, U.tech, `/api/maintenance-requests/${reqId}/expenses`, { amount: 120.5, description: "Regression part" });
    expect(r.status()).toBe(201); const x = await r.json(); expId = x.id; expect(x.approved).toBe(false);
  });
  test("REG-22 technician and tenant cannot approve; the manager can", async ({ request }) => {
    expect((await post(request, U.tech, `/api/expenses/${expId}/approve`)).status()).toBe(403);
    expect((await post(request, U.tenant, `/api/expenses/${expId}/approve`)).status()).toBe(403);
    const ok = await post(request, U.manager, `/api/expenses/${expId}/approve`);
    expect(ok.status()).toBe(200); expect((await ok.json()).approved).toBe(true);
    expect((await post(request, U.manager, `/api/expenses/${expId}/approve`)).status()).toBe(400); // not twice
  });
  test("REG-23 nobody can approve a cost they recorded themselves", async ({ request }) => {
    const mine = await json(await get(request, U.manager, "/api/maintenance-requests?limit=100"));
    const open = mine.find((r) => r.status !== "CLOSED");
    const x = await json(await post(request, U.manager, `/api/maintenance-requests/${open.id}/expenses`, { amount: 10, description: "Self recorded" }));
    expect((await post(request, U.manager, `/api/expenses/${x.id}/approve`)).status()).toBe(400);
  });
  test("REG-24 tenants never see costs", async ({ request }) => {
    const own = await json(await get(request, U.tenant, "/api/maintenance-requests?limit=100"));
    for (const r of own) expect((await json(await get(request, U.tenant, `/api/maintenance-requests/${r.id}`))).expenses).toEqual([]);
  });
  test("REG-25 vendor sends a quotation; the manager approves it; the vendor cannot approve its own", async ({ request }) => {
    const jobs = await json(await get(request, U.vendor, "/api/maintenance-requests?limit=100"));
    const job = jobs.find((r) => r.status === "ASSIGNED") || jobs[0];
    const q = await post(request, U.vendor, `/api/maintenance-requests/${job.id}/quotations`, { amount: 500, description: "Regression quote" });
    expect(q.status()).toBe(201); const qid = (await q.json()).id;
    expect((await post(request, U.vendor, `/api/quotations/${qid}/decision`, { decision: "APPROVE" })).status()).toBe(403);
    const d = await post(request, U.manager, `/api/quotations/${qid}/decision`, { decision: "APPROVE" });
    expect(d.status()).toBe(200); expect((await d.json()).status).toBe("APPROVED");
  });
});

/* ------------------------------------------------------------------ Vendors, invitations, files */
test.describe("Vendors, invitations and files", () => {
  test("REG-26 a suspended vendor loses access to its work, and gets it back when reactivated", async ({ request }) => {
    const me = await json(await get(request, U.vendor, "/api/auth/me"));
    expect((await json(await get(request, U.vendor, "/api/maintenance-requests?limit=100"))).length).toBeGreaterThan(0);
    try {
      expect((await post(request, U.manager, `/api/vendors/${me.vendorId}/status`, { status: "SUSPENDED" })).status()).toBe(200);
      expect(await json(await get(request, U.vendor, "/api/maintenance-requests?limit=100"))).toEqual([]);
    } finally {
      await post(request, U.manager, `/api/vendors/${me.vendorId}/status`, { status: "ACTIVE" });
    }
    expect((await json(await get(request, U.vendor, "/api/maintenance-requests?limit=100"))).length).toBeGreaterThan(0);
  });
  test("REG-27 invitation: issued by a manager, accepted once, creates the right role", async ({ request }) => {
    const inv = await json(await post(request, U.manager, "/api/invitations", { email: `inv${UID}@x.test`, role: "TECHNICIAN" }));
    expect(inv.token).toBeTruthy();
    expect((await request.get("/api/invitations/lookup?token=" + inv.token)).status()).toBe(200);
    const acc = await request.post("/api/invitations/accept", { data: { token: inv.token, fullName: "Invited Tech", password: "Str0ngPassw0rd" } });
    expect(acc.status()).toBe(201); expect((await acc.json()).role).toBe("TECHNICIAN");
    expect((await request.post("/api/invitations/accept", { data: { token: inv.token, fullName: "Again", password: "Str0ngPassw0rd" } })).status()).toBe(404);
  });
  test("REG-28 a real image is accepted, a disguised file is rejected, and only people with access can download", async ({ request }) => {
    const rid = (await json(await get(request, U.tenant, "/api/maintenance-requests?limit=100")))[0].id;
    const good = await request.post(`/api/maintenance-requests/${rid}/attachments`, { headers: U.tenant.h, multipart: { file: { name: "ok.png", mimeType: "image/png", buffer: PNG } } });
    expect(good.status()).toBe(201); const aid = (await good.json()).id;
    const bad = await request.post(`/api/maintenance-requests/${rid}/attachments`, { headers: U.tenant.h, multipart: { file: { name: "evil.png", mimeType: "image/png", buffer: Buffer.from("<script>alert(1)</script>") } } });
    expect(bad.status()).toBe(400);
    expect((await get(request, U.manager, `/api/attachments/${aid}`)).status()).toBe(200);
    expect((await get(request, U.tenant2, `/api/attachments/${aid}`)).status()).toBe(403);
  });
  test("REG-29 the audit log records what was done", async ({ request }) => {
    const log = await json(await get(request, U.manager, "/api/audit"));
    expect((log.rows || log).length).toBeGreaterThan(0);
  });
  test("REG-30 API documentation is published", async ({ request }) => {
    expect((await request.get("/docs")).status()).toBe(200);
    expect(Object.keys((await json(await request.get("/openapi.json"))).paths).length).toBeGreaterThan(40);
  });
});

/* ------------------------------------------------------------------ Browser: the screens people actually use */
test.describe("Browser smoke", () => {
  async function signIn(page, email) {
    await page.goto("/login.html"); await page.fill("#email", email); await page.fill("#pw", PW); await page.click("#submit");
    await page.waitForURL("**/app.html**"); await page.waitForSelector(".stats");
  }
  test("REG-31 landing page leads to sign-in and sign-up", async ({ page }) => {
    await page.goto("/index.html");
    await expect(page.locator("h1")).toContainText("One clear view");
    await page.locator("a:has-text('Sign In')").first().click(); await page.waitForURL("**/login.html");
    await page.goto("/index.html"); await page.locator("a:has-text('Get Started')").first().click(); await page.waitForURL("**/login.html?mode=register");
  });
  test("REG-32 each role sees only its own navigation, and a tenant is turned away from manager pages", async ({ page }) => {
    const labels = async () => (await page.locator("#nav a .lbl").allInnerTexts()).map((s) => s.trim());
    await signIn(page, ACC.manager); expect(await labels()).toContain("Properties");
    await page.click("#logout"); await page.waitForURL("**/login.html**");
    await signIn(page, ACC.tenant); expect(await labels()).toEqual(["Overview", "Report an issue", "My requests", "Notifications", "Account"]);
    await page.evaluate(() => { location.hash = "#/people"; });
    await expect.poll(() => page.evaluate(() => location.hash)).toBe("#/overview");
  });
  test("REG-33 a tenant reports an issue in the browser and sees it saved", async ({ page }) => {
    const title = `Browser regression ${UID}`;
    await signIn(page, ACC.tenant);
    await page.evaluate(() => { location.hash = "#/report"; }); await page.waitForSelector("#reportForm");
    await page.click("#reportForm button[type=submit]"); await expect(page.locator("#rErr")).toContainText(/short title/i);
    await page.fill("#rTitle", title); await page.fill("#rDesc", "Created by the regression suite."); await page.selectOption("#rCat", "PLUMBING");
    await page.click("#reportForm button[type=submit]");
    await expect(page.locator("#panes")).toContainText(title);
  });
});
