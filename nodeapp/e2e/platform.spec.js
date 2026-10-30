// PLATFORM checks on the sample-data install: health, API docs, security headers, role matrix, lists, uploads, notifications.
const { test, expect } = require("@playwright/test");
const PW = "password123";
const ACC = { manager: "manager@estateops.test", tenant: "tenant@estateops.test", tech: "tech@estateops.test", vendor: "vendor@estateops.test" };
async function login(request, email) {
  const r = await request.post("/api/auth/login", { data: { email, password: PW } });
  expect(r.status()).toBe(200);
  const b = await r.json(); return { headers: { Authorization: "Bearer " + b.token }, token: b.token, id: b.accountId };
}

test.describe("Service", () => {
  test("health check reports the database is reachable", async ({ request }) => {
    const r = await request.get("/health"); expect(r.status()).toBe(200);
    expect(JSON.stringify(await r.json()).toLowerCase()).toMatch(/ok|up/);
  });
  test("security headers are set and the server does not advertise itself", async ({ request }) => {
    const h = (await request.get("/index.html")).headers();
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["x-frame-options"] || h["content-security-policy"]).toBeTruthy();
    expect(h["x-powered-by"]).toBeUndefined();
  });
  test("unknown API paths return JSON, not an HTML error page", async ({ request }) => {
    const m = await login(request, ACC.manager);
    const r = await request.get("/api/does-not-exist", { headers: m.headers }); expect(r.status()).toBe(404);
    expect(r.headers()["content-type"]).toContain("json");
  });
  test("a request without a token is refused", async ({ request }) => {
    expect((await request.get("/api/maintenance-requests")).status()).toBe(401);
  });
});

test.describe("API documentation in the browser", () => {
  test("openapi.json is served and describes the API", async ({ request }) => {
    const spec = await (await request.get("/openapi.json")).json();
    expect(spec.openapi).toMatch(/^3\./); expect(Object.keys(spec.paths).length).toBeGreaterThan(40);
  });
  test("Swagger UI loads, lists operations and can execute a public call", async ({ page }) => {
    await page.goto("/docs");
    await expect(page.locator(".swagger-ui .info .title")).toBeVisible();
    expect(await page.locator(".opblock").count()).toBeGreaterThan(30);
    await page.locator("#operations-Service-get_health .opblock-summary, [id*='get_health'] .opblock-summary").first().click();
    await page.locator(".execute").first().click();
    await expect(page.locator(".live-responses-table tbody .response-col_status").first()).toContainText("200");
  });
});

test.describe("Role matrix: every role against the same endpoints", () => {
  const matrix = [
    ["GET /api/team", "/api/team", { manager: 200, tenant: 403, tech: 403, vendor: 403 }],
    ["GET /api/vendors", "/api/vendors", { manager: 200, tenant: 403, tech: 403, vendor: 403 }],
    ["GET /api/invitations", "/api/invitations", { manager: 200, tenant: 403, tech: 403, vendor: 403 }],
    ["GET /api/audit", "/api/audit", { manager: 200, tenant: 403, tech: 403, vendor: 403 }],
    ["GET /api/insights", "/api/insights", { manager: 200, tenant: 403, tech: 403, vendor: 403 }],
    ["GET /api/properties", "/api/properties", { manager: 200, tenant: 403, tech: 403, vendor: 403 }],
    ["GET /api/dashboard", "/api/dashboard", { manager: 200, tenant: 200, tech: 200, vendor: 200 }],
    ["GET /api/notifications", "/api/notifications", { manager: 200, tenant: 200, tech: 200, vendor: 200 }],
    ["GET /api/maintenance-requests", "/api/maintenance-requests", { manager: 200, tenant: 200, tech: 200, vendor: 200 }],
    ["GET /api/vendors/me", "/api/vendors/me", { manager: 403, tenant: 403, tech: 403, vendor: 200 }],
  ];
  for (const [label, url, want] of matrix) {
    test(label, async ({ request }) => {
      for (const role of Object.keys(want)) {
        const a = await login(request, ACC[role]);
        expect({ role, status: (await request.get(url, { headers: a.headers })).status() }).toEqual({ role, status: want[role] });
      }
    });
  }
  test("each role sees only the requests it is allowed to see", async ({ request }) => {
    const m = await login(request, ACC.manager), t = await login(request, ACC.tenant), k = await login(request, ACC.tech), v = await login(request, ACC.vendor);
    const all = await (await request.get("/api/maintenance-requests?limit=100", { headers: m.headers })).json();
    expect(all.length).toBeGreaterThan(3);
    const mine = await (await request.get("/api/maintenance-requests?limit=100", { headers: t.headers })).json();
    expect(mine.length).toBeGreaterThan(0); expect(mine.length).toBeLessThan(all.length);
    for (const r of mine) expect(r.reporterId).toBe(t.id);
    for (const r of await (await request.get("/api/maintenance-requests?limit=100", { headers: k.headers })).json()) expect(r.technicianId).toBe(k.id);
    for (const r of await (await request.get("/api/maintenance-requests?limit=100", { headers: v.headers })).json()) expect(r.vendorId).not.toBeNull();
  });
});

test.describe("Lists in the browser", () => {
  async function signIn(page, email) {
    await page.goto("/login.html"); await page.fill("#email", email); await page.fill("#pw", PW); await page.click("#submit");
    await page.waitForURL("**/app.html**"); await page.waitForSelector(".stats");
  }
  test("manager's request list: filter by status, search, and clear", async ({ page }) => {
    await signIn(page, ACC.manager);
    await page.evaluate(() => { location.hash = "#/requests"; }); await page.waitForSelector("tr.clickable");
    const total = await page.locator("tr.clickable").count(); expect(total).toBeGreaterThan(3);
    await page.fill("#fq", "zzzz-nothing"); await expect(page.locator("text=No matching requests")).toBeVisible();
    await page.fill("#fq", ""); await expect(page.locator("tr.clickable")).toHaveCount(total);
  });
  test("every manager page loads without an error banner", async ({ page }) => {
    await signIn(page, ACC.manager);
    for (const h of ["overview", "requests", "properties", "people", "vendors", "insights", "activity", "notifications", "account"]) {
      await page.evaluate((x) => { location.hash = "#/" + x; }, h);
      await page.waitForTimeout(500);
      await expect(page.locator("#panes")).not.toContainText(/something went wrong|undefined|\[object/i);
      await expect(page.locator("#panes")).not.toBeEmpty();
    }
  });
  test("notifications can be marked as read in the page", async ({ page }) => {
    await signIn(page, ACC.tenant);
    await page.evaluate(() => { location.hash = "#/notifications"; }); await page.waitForSelector("ul.tl li");
    const btn = page.locator("button:has-text('Mark all as read')");
    if (await btn.count()) { await btn.first().click(); await page.waitForTimeout(600); }
    const unread = await page.evaluate(() => fetch("/api/notifications", { headers: { Authorization: "Bearer " + JSON.parse(localStorage.getItem("eo_auth")).token } }).then((r) => r.json()).then((n) => n.filter((x) => !x.read).length));
    expect(unread).toBe(0);
  });
});

test.describe("Uploads and validation", () => {
  test("a file that is not really an image is refused", async ({ request }) => {
    const t = await login(request, ACC.tenant);
    const reqs = await (await request.get("/api/maintenance-requests", { headers: t.headers })).json();
    const r = await request.post(`/api/maintenance-requests/${reqs[0].id}/attachments`, { headers: t.headers,
      multipart: { file: { name: "evil.png", mimeType: "image/png", buffer: Buffer.from("<script>alert(1)</script>") } } });
    expect(r.status()).toBe(400);
  });
  test("bad input is rejected with a message, not a crash", async ({ request }) => {
    const t = await login(request, ACC.tenant);
    const unit = (await (await request.get("/api/units/reportable", { headers: t.headers })).json())[0].id;
    const r = await request.post("/api/maintenance-requests", { headers: t.headers, data: { unitId: unit, title: "", description: "" } });
    expect(r.status()).toBe(400); expect((await r.json()).message).toBeTruthy();
  });
  test("a tenant cannot report on a unit they do not live in", async ({ request }) => {
    const t = await login(request, ACC.tenant), m = await login(request, ACC.manager);
    const mine = (await (await request.get("/api/units/reportable", { headers: t.headers })).json()).map((u) => u.id);
    const props = await (await request.get("/api/properties", { headers: m.headers })).json();
    let other = null;
    for (const p of props) for (const u of await (await request.get(`/api/properties/${p.id}/units`, { headers: m.headers })).json()) if (!mine.includes(u.id)) other = u.id;
    expect(other).not.toBeNull();
    const r = await request.post("/api/maintenance-requests", { headers: t.headers, data: { unitId: other, title: "Not mine", description: "x", category: "OTHER", priority: "LOW" } });
    expect([403, 404]).toContain(r.status());
  });
  test("self-registration can only ever create a tenant", async ({ request }) => {
    const r = await request.post("/api/auth/register", { data: { email: "sneaky@x.test", password: "Str0ngPassw0rd", fullName: "Sneaky", role: "MANAGER", orgId: 1 } });
    expect([201, 400]).toContain(r.status());
    if (r.status() === 201) expect((await r.json()).role).toBe("TENANT");
  });
  test("repeated wrong passwords are throttled", async ({ request }) => {
    let last = 0;
    for (let i = 0; i < 10; i++) last = (await request.post("/api/auth/login", { data: { email: "throttle@estateops.test", password: "bad" + i } })).status();
    expect(last).toBe(429);
  });
});
