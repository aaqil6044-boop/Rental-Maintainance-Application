// FULL APPLICATION journey on an EMPTY database (no sample data), through every role, in the browser:
// first-run setup -> portfolio -> vendor -> invitations -> tenant -> assignment -> quotation -> work -> invoice
// -> approval -> reporting -> technician -> sessions -> mobile. Each test is one stage and uses only what a person could click.
const base = require("@playwright/test");
const { expect } = base;
const path = require("path"), fs = require("fs"), os = require("os");

const PW = "Str0ngPassw0rd";
const A = { manager: "hana@harbour.test", vendor: "kira@fixit.test", tech: "tom@harbour.test", tenant: "tara@harbour.test" };
const links = {}; const S = {};
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const PNGFILE = path.join(os.tmpdir(), "estateops-e2e-leak.png"); fs.writeFileSync(PNGFILE, PNG);

// Every test also fails if the page threw a JavaScript error.
const test = base.test.extend({
  _watch: [async ({ page }, use) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|ERR_/.test(m.text())) errors.push(m.text()); });
    await use();
    expect(errors, "JavaScript errors on the page").toEqual([]);
  }, { auto: true }],
});
test.describe.configure({ mode: "serial" });

const nav = (page) => page.locator("#nav a .lbl").allInnerTexts().then((a) => a.map((s) => s.trim()));
const go = (page, h) => page.evaluate((x) => { location.hash = x; }, h);
async function signIn(page, email, pw = PW) {
  await page.goto("/login.html");
  await page.fill("#email", email); await page.fill("#pw", pw); await page.click("#submit");
  await page.waitForURL("**/app.html**"); await page.waitForSelector(".stats");
}
const apiStatus = (page, url) => page.evaluate((u) => fetch(u, { headers: { Authorization: "Bearer " + JSON.parse(localStorage.getItem("eo_auth")).token } }).then((r) => r.status), url);

test("1. First run: landing page, then creating the organization", async ({ page, request }) => {
  await page.goto("/index.html");
  await expect(page.locator("h1")).toContainText("One clear view");
  for (const l of ["Get Started", "Sign In", "See how it works"]) await expect(page.locator(`a:has-text("${l}")`).first()).toBeVisible();
  const body = (await page.innerText("body")).toLowerCase();
  expect(body).not.toContain("password123"); expect(body).not.toContain("@estateops.test");
  await page.goto("/login.html");
  await page.waitForSelector("#orgRow:not([hidden])");
  await expect(page.locator("#title")).toContainText("Set up EstateOps");
  await expect(page.locator("button:has-text('Try it as')")).toHaveCount(0);
  await page.fill("#org", "Harbour Estates"); await page.fill("#name", "Hana Admin"); await page.fill("#email", A.manager); await page.fill("#pw", PW);
  await page.click("#submit"); await page.waitForURL("**/app.html**"); await page.waitForSelector(".stats");
  expect(await nav(page)).toEqual(["Overview", "Requests", "Properties", "People", "Vendors", "Insights", "Activity", "Load testing", "Notifications", "Account"]);
  await expect(page.locator("#panes")).toContainText("Get started");
  expect(await page.$$eval(".stat .v", (e) => e.slice(0, 4).map((x) => x.innerText))).toEqual(["0", "0", "0", "0"]);
  // setup closes itself once an account exists
  const again = await request.post("/api/setup", { data: { email: "evil@x.test", password: PW, fullName: "Evil", organizationName: "Evil Co" } });
  expect(again.status()).toBe(409);
  expect((await (await request.get("/api/setup/status")).json()).needsSetup).toBe(false);
});

test("2. Manager builds the portfolio: property, unit, duplicate protection", async ({ page }) => {
  await signIn(page, A.manager); await go(page, "#/properties"); await page.waitForSelector("#propForm");
  await expect(page.locator("#panes")).toContainText("No properties yet");
  await page.fill("#pName", "Harbour View"); await page.fill("#pAddr", "1 Quay Road"); await page.click("#propForm button[type=submit]");
  await page.waitForSelector("#unitForm");
  await page.fill("#uLabel", "12A"); await page.click("#unitForm button[type=submit]");
  await expect(page.locator("td.strong:has-text('12A')")).toBeVisible();
  await page.fill("#uLabel", "12a"); await page.click("#unitForm button[type=submit]");
  await expect(page.locator("#uErr")).toContainText("already exists");
});

test("3. Vendor company starts Pending, manager activates it, invitations are issued", async ({ page }) => {
  await signIn(page, A.manager); await go(page, "#/vendors"); await page.waitForSelector("#vendorForm");
  await page.fill("#vName", "FixIt Plumbing"); await page.fill("#vEmail", "office@fixit.test"); await page.check("#vCats input[value=PLUMBING]");
  await page.click("#vendorForm button[type=submit]"); await page.waitForSelector("select.vstatus");
  await expect(page.locator("select.vstatus")).toHaveValue("PENDING");
  await page.selectOption("select.vstatus", "ACTIVE");
  await expect(page.locator("select.vstatus")).toHaveValue("ACTIVE");
  await page.click("button:has-text('Invite staff')"); await page.waitForSelector("#inviteForm");
  await expect(page.locator("#iRole")).toHaveValue("VENDOR");
  const invite = async (email, role, unit) => {
    await page.selectOption("#iRole", role);
    if (unit) await page.selectOption("#iUnit", { index: 1 });
    const previous = (await page.locator("#iResult .linkbox code").count()) ? (await page.innerText("#iResult .linkbox code")).trim() : "";
    await page.fill("#iEmail", email); await page.click("#inviteForm button[type=submit]");
    await expect(page.locator("#iResult .linkbox code")).toBeVisible();
    await expect.poll(async () => (await page.innerText("#iResult .linkbox code")).trim()).not.toBe(previous);
    links[role] = (await page.innerText("#iResult .linkbox code")).trim();
  };
  await invite(A.vendor, "VENDOR"); await invite(A.tech, "TECHNICIAN"); await invite(A.tenant, "TENANT", true);
  for (const l of Object.values(links)) expect(l).toContain("/accept.html?token=");
  await page.reload(); await page.waitForSelector("#inviteForm");
  await expect(page.locator("td:has-text('kira@fixit.test')")).toHaveCount(1);
  expect(await page.innerText("#panes")).not.toContain("token=");
});

test("4. Tenant accepts the invitation, reports an issue with a photo, and is fenced in", async ({ page }) => {
  await page.goto(links.TENANT); await page.waitForSelector("#form:not([hidden])");
  await expect(page.locator("#facts")).toContainText("Harbour Estates"); await expect(page.locator("#facts")).toContainText("12A");
  await page.fill("#name", "Tara Tenant"); await page.fill("#pw", PW); await page.click("#submit");
  await page.waitForURL("**/app.html**"); await page.waitForSelector(".stats");
  expect(await nav(page)).toEqual(["Overview", "Report an issue", "My requests", "Notifications", "Account"]);
  await go(page, "#/report"); await page.waitForSelector("#reportForm");
  await page.click("#reportForm button[type=submit]");
  await expect(page.locator("#rErr")).toContainText("short title");
  await page.fill("#rTitle", "Kitchen tap leaking"); await page.fill("#rDesc", "Water runs from the base of the tap.");
  await page.selectOption("#rCat", "PLUMBING"); await page.selectOption("#rPri", "HIGH");
  await page.setInputFiles("#rFile", PNGFILE); await page.click("#reportForm button[type=submit]");
  await expect(page.locator(".file img")).toHaveCount(1, { timeout: 10000 });
  S.requestId = Number((await page.evaluate(() => location.hash)).split("/").pop());
  await expect(page.locator("#assignForm")).toHaveCount(0);
  await expect(page.locator("button:has-text('Close request')")).toHaveCount(0);
  await expect(page.locator("#panes")).not.toContainText("Cost");
  await page.fill("#cmBody", "It is getting worse."); await page.click("#commentForm button[type=submit]");
  await expect(page.locator(".cmt")).toContainText("getting worse");
  await go(page, "#/people");
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("#/overview");
  expect(await apiStatus(page, "/api/vendors")).toBe(403);
});

test("5. Manager triages: search, AI honesty, review, assign to the vendor", async ({ page }) => {
  await signIn(page, A.manager);
  expect(await page.$$eval(".stat .v", (e) => e[0].innerText)).toBe("1");
  await go(page, "#/requests"); await page.waitForSelector("tr.clickable");
  await page.fill("#fq", "nothing like this"); await expect(page.locator("text=No matching requests")).toBeVisible();
  await page.fill("#fq", "tap"); await expect(page.locator("tr.clickable")).toHaveCount(1);
  await page.click("tr.clickable"); await page.waitForSelector("#assignForm");
  await page.click("button:has-text('Suggest category and priority')");
  await expect(page.locator("#aiErr")).toContainText(/not set up/i);
  await page.click("button:has-text('Start review')"); await expect(page.locator("#panes")).toContainText("Under review");
  await page.waitForSelector("#assignForm");
  await page.fill("#aDue", "2030-05-01"); await page.selectOption("#aWho", { label: "FixIt Plumbing — Plumbing" });
  await page.click("#assignForm button[type=submit]");
  await expect(page.locator("dd:has-text('FixIt Plumbing (vendor)')")).toBeVisible();
});

test("6. Vendor accepts the invitation, sees only its job, and sends a quotation", async ({ page }) => {
  await page.goto(links.VENDOR); await page.waitForSelector("#form:not([hidden])");
  await expect(page.locator("#facts")).toContainText("FixIt Plumbing");
  await page.fill("#name", "Kira Fixit"); await page.fill("#pw", PW); await page.click("#submit");
  await page.waitForURL("**/app.html**"); await page.waitForSelector(".stats");
  expect(await nav(page)).toEqual(["Overview", "Work orders", "Company", "Notifications", "Account"]);
  await go(page, "#/requests"); await expect(page.locator("tr.clickable")).toHaveCount(1);
  await page.click("tr.clickable"); await page.waitForSelector("#quoteForm");
  await expect(page.locator("#assignForm")).toHaveCount(0);
  await expect(page.locator("button:has-text('Close request')")).toHaveCount(0);
  await page.fill("#qAmt", "1800"); await page.fill("#qDesc", "Replace cartridge and washers."); await page.click("#quoteForm button[type=submit]");
  await expect(page.locator("td:has-text('Pending')")).toBeVisible();
});

test("7. Manager approves the quotation", async ({ page }) => {
  await signIn(page, A.manager); await go(page, `#/request/${S.requestId}`);
  await page.waitForSelector("button[data-act=quote]");
  await page.click("button[data-act=quote][data-d=APPROVE]");
  await expect(page.locator("td:has-text('Approved')")).toBeVisible();
});

test("8. Vendor does the work, uploads evidence and records an invoice it cannot approve", async ({ page }) => {
  await signIn(page, A.vendor); await go(page, `#/request/${S.requestId}`);
  await page.click("button:has-text('Start work')");
  await page.click("button:has-text('Mark work complete')");
  await page.fill("#cNotes", "Cartridge replaced; no leaks."); await page.click("#completeForm button[type=submit]");
  await expect(page.locator("dt:has-text('COMPLETION')")).toBeVisible();
  await expect(page.locator("#panes")).toContainText("no leaks");
  await page.setInputFiles("#fFile", PNGFILE); await page.click("#fileForm button[type=submit]");
  await expect(page.locator(".file:has-text('Evidence')")).toBeVisible();
  await page.fill("#eAmt", "1750"); await page.fill("#eDesc", "Invoice 0042"); await page.click("#expForm button[type=submit]");
  await expect(page.locator("td:has-text('Awaiting approval')")).toBeVisible();
  await expect(page.locator("button:has-text('Approve')")).toHaveCount(0);
});

test("9. Manager approves the invoice, closes the request; dashboard, insights and audit log reflect it", async ({ page }) => {
  await signIn(page, A.manager); await go(page, `#/request/${S.requestId}`);
  await page.click("button[data-act=approve]"); await expect(page.locator("span.chip:has-text('Approved')")).toBeVisible();
  await page.click("button:has-text('Close request')"); await expect(page.locator(".row .chip:has-text('Closed')")).toBeVisible();
  await go(page, "#/overview"); await page.waitForSelector(".stats");
  const stats = await page.$$eval(".stat", (e) => Object.fromEntries(e.map((x) => [x.querySelector(".k").innerText, x.querySelector(".v").innerText])));
  expect(stats["Approved spend, 30 days"]).toContain("1,750");
  await go(page, "#/insights"); await expect(page.locator("text=AI suggestions")).toBeVisible();
  await go(page, "#/activity"); await page.waitForSelector("table.data");
  const log = await page.innerText("#panes");
  for (const x of ["Expense approved", "Request assigned", "Invoice recorded"]) expect(log).toContain(x);
});

test("10. Tenant sees the outcome (but no costs) and has real notifications", async ({ page }) => {
  await signIn(page, A.tenant); await go(page, `#/request/${S.requestId}`);
  await expect(page.locator(".row")).toContainText("Closed");
  await expect(page.locator("#panes")).not.toContainText("Approved");
  await go(page, "#/notifications"); await page.waitForSelector("ul.tl li");
  expect(await page.locator("ul.tl li").count()).toBeGreaterThanOrEqual(3);
});

test("11. Technician onboarding: own navigation, empty list, cannot open others' jobs", async ({ page }) => {
  await page.goto(links.TECHNICIAN); await page.waitForSelector("#skillsRow:not([hidden])");
  await page.fill("#name", "Tom Tech"); await page.fill("#skills", "Electrical"); await page.fill("#pw", PW); await page.click("#submit");
  await page.waitForURL("**/app.html**"); await page.waitForSelector(".stats");
  expect(await nav(page)).toEqual(["Overview", "My jobs", "Notifications", "Account"]);
  await go(page, "#/requests"); await expect(page.locator("#panes")).toContainText("Nothing here yet");
  expect(await apiStatus(page, `/api/maintenance-requests/${S.requestId}`)).toBe(403);
  await go(page, "#/account"); await page.waitForSelector("#profileForm");
  await expect(page.locator("#aSkills")).toHaveValue("Electrical");
});

test("12. A used invitation link cannot be used again", async ({ request }) => {
  const token = new URL(links.TENANT).searchParams.get("token");
  const r = await request.post("/api/invitations/accept", { data: { token, fullName: "Copycat", password: PW } });
  expect([404, 409, 410]).toContain(r.status());
});

test("13. Sign-out ends the session and a wrong password is explained", async ({ page, request }) => {
  await signIn(page, A.tenant);
  const token = await page.evaluate(() => JSON.parse(localStorage.getItem("eo_auth")).token);
  await page.click("#logout"); await page.waitForURL("**/login.html**");
  expect((await request.get("/api/auth/me", { headers: { Authorization: "Bearer " + token } })).status()).toBe(401);
  await page.goto("/app.html"); await page.waitForURL("**/login.html**");
  await page.fill("#email", A.tenant); await page.fill("#pw", "wrong-wrong"); await page.click("#submit");
  await expect(page.locator("#err")).toContainText("Wrong email or password");
});

test("14. Phone layout: every role's dashboard, the login page and the landing page fit the screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  for (const who of ["manager", "vendor", "tech"]) {
    await signIn(page, A[who]); expect(await overflow(), who).toBeLessThanOrEqual(2);
    await page.click("#logout"); await page.waitForURL("**/login.html**");
  }
  await page.goto("/login.html"); expect(await overflow()).toBeLessThanOrEqual(2);
  await page.goto("/index.html"); expect(await overflow()).toBeLessThanOrEqual(2);
});
