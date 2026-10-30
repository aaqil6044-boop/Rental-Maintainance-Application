"use strict";
// Opens ONE visible Chrome window and uses EstateOps like a person would, start to finish, on a brand-new empty database.
// The window stays open the whole time (and after it finishes) so you can watch and look around.
//   npm run watch            (slower, easy to follow)
//   set SPEED=fast & npm run watch
const { chromium, expect } = require("@playwright/test");
const { spawn } = require("child_process");
const path = require("path"), os = require("os"), fs = require("fs");

const HEADLESS = process.env.HEADLESS === "1";
const SLOW = process.env.SPEED === "fast" ? 120 : Number(process.env.SLOWMO || 450);
const PORT = process.env.WATCH_PORT || "4020", BASE = `http://127.0.0.1:${PORT}`;
const PW = "Str0ngPassw0rd";
const A = { manager: "hana@harbour.test", vendor: "kira@fixit.test", tech: "tom@harbour.test", tenant: "tara@harbour.test" };
const links = {}; let requestId;
const PNGFILE = path.join(os.tmpdir(), "estateops-watch.png");
fs.writeFileSync(PNGFILE, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"));
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "estateops-watch-"));
let passed = 0, failed = 0; const results = [];

const server = spawn(process.execPath, ["server.js"], { cwd: path.join(__dirname, ".."), stdio: "ignore",
  env: { ...process.env, PORT, NODE_ENV: "development", DATA_DIR: DATA, UPLOAD_DIR: path.join(DATA, "uploads"), LOG_REQUESTS: "0", SEED_DEV: "0" } });
const stop = () => { try { server.kill(); } catch (e) {} };
process.on("exit", stop); process.on("SIGINT", () => { stop(); process.exit(130); });

async function waitForServer() {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE + "/health")).ok) return; } catch (e) {} await new Promise((r) => setTimeout(r, 500)); }
  throw new Error("The server did not start.");
}

const esc = (x) => String(x).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
function writeReport() {
  const dir = path.join(__dirname, "..", "report"); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "EstateOps-walkthrough-report.html");
  const total = results.reduce((a, r) => a + r.ms, 0) / 1000;
  const html = `<!doctype html><meta charset="utf-8"><title>EstateOps walkthrough report</title>
<style>body{font:15px system-ui;max-width:1000px;margin:2rem auto;padding:0 1rem;color:#1a1a1a}.ok{color:#0a7d33;font-weight:700}.bad{color:#c0262d;font-weight:700}
.card{display:flex;gap:1rem;margin:1rem 0}.card div{flex:1;border:1px solid #ddd;border-radius:8px;padding:.8rem}.card b{display:block;font-size:26px}
details{border-bottom:1px solid #e3e3e3;padding:.45rem 0}summary{cursor:pointer}.ms{float:right;color:#777}img{max-width:100%;border:1px solid #ddd;margin-top:.6rem}pre{background:#f5f5f5;padding:.7rem;overflow:auto}</style>
<h1>EstateOps walkthrough report</h1>
<p>One browser window, one empty database, every role. Run: ${new Date().toLocaleString()} &middot; Node ${process.version}</p>
<div class="card"><div><b class="${failed ? "bad" : "ok"}">${passed}/${results.length}</b>steps passed</div><div><b>${failed}</b>failed</div><div><b>${total.toFixed(0)}s</b>total time</div></div>
<p>Click a step to see the screen as it looked when that step finished.</p>
${results.map((r, i) => `<details><summary><span class="${r.ok ? "ok" : "bad"}">${r.ok ? "PASS" : "FAIL"}</span> ${i + 1}. ${esc(r.title)} <span class="ms">${(r.ms / 1000).toFixed(1)}s</span></summary>${r.error ? "<pre>" + esc(r.error) + "</pre>" : ""}${r.shot ? `<img alt="screen after this step" src="data:image/png;base64,${r.shot}">` : ""}</details>`).join("")}`;
  fs.writeFileSync(file, html);
  console.log("\nReport saved: " + file);
}

(async () => {
  await waitForServer();
  const browser = await chromium.launch({ headless: HEADLESS, slowMo: SLOW, executablePath: process.env.CHROME || undefined, args: ["--window-size=1400,950"] });
  const ctx = await browser.newContext({ viewport: HEADLESS ? { width: 1360, height: 900 } : null, baseURL: BASE });
  await ctx.addInitScript(() => {
    // on-screen caption that survives page navigations
    const draw = () => {
      if (!document.body) return;
      let b = document.getElementById("__cap");
      if (!b) { b = document.createElement("div"); b.id = "__cap";
        b.style.cssText = "position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:2147483647;background:#0E1B24;color:#fff;font:600 15px system-ui;padding:10px 18px;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.35);max-width:90vw;pointer-events:none";
        document.body.appendChild(b); }
      b.textContent = sessionStorage.getItem("__cap") || "";
      b.style.display = b.textContent ? "block" : "none";
    };
    document.addEventListener("DOMContentLoaded", draw); setInterval(draw, 300);
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);

  const caption = (t) => page.evaluate((x) => sessionStorage.setItem("__cap", x), t).catch(() => {});
  const nav = () => page.locator("#nav a .lbl").allInnerTexts().then((a) => a.map((s) => s.trim()));
  const go = (h) => page.evaluate((x) => { location.hash = x; }, h);
  async function step(title, fn) {
    console.log("\n▶ " + title);
    await caption(title);
    const t0 = Date.now();
    const snap = async () => { try { await page.waitForTimeout(300); return (await page.screenshot()).toString("base64"); } catch (e) { return null; } };
    try { await fn(); passed++; console.log("  ✓ ok"); results.push({ title, ok: true, ms: Date.now() - t0, shot: await snap() }); }
    catch (e) { failed++; const msg = String(e.message || e).split("\n").slice(0, 6).join("\n"); console.log("  ✗ FAILED: " + msg.split("\n")[0]);
      results.push({ title, ok: false, ms: Date.now() - t0, shot: await snap(), error: msg }); await caption("FAILED: " + title).catch(() => {}); throw e; }
    await page.waitForTimeout(700);
  }
  async function signOut() {
    if (await page.locator("#logout").count()) { await page.click("#logout"); await page.waitForURL("**/login.html**"); }
    else await page.goto("/login.html");
  }
  async function signIn(email) {
    await page.goto("/login.html"); await page.fill("#email", email); await page.fill("#pw", PW); await page.click("#submit");
    await page.waitForURL("**/app.html**"); await page.waitForSelector(".stats");
  }
  async function accept(link, extra) {
    await page.goto(link); await page.waitForSelector("#form:not([hidden])", { state: "attached" });
    await extra(); await page.fill("#pw", PW); await page.click("#submit");
    await page.waitForURL("**/app.html**"); await page.waitForSelector(".stats");
  }

  try {
    await step("Visitor opens the landing page", async () => {
      await page.goto("/index.html");
      await expect(page.locator("h1")).toContainText("One clear view");
      await page.waitForTimeout(2500);
      await page.mouse.wheel(0, 1400); await page.waitForTimeout(900); await page.mouse.wheel(0, 1600); await page.waitForTimeout(900);
      await page.evaluate(() => scrollTo(0, 0));
    });
    await step("First run: the first manager creates the organization", async () => {
      await page.click("a:has-text('Get Started') >> nth=0");
      await page.waitForSelector("#orgRow:not([hidden])");
      await page.fill("#org", "Harbour Estates"); await page.fill("#name", "Hana Admin"); await page.fill("#email", A.manager); await page.fill("#pw", PW);
      await page.click("#submit"); await page.waitForURL("**/app.html**"); await page.waitForSelector(".stats");
      expect(await nav()).toContain("Properties");
    });
    await step("Manager adds a property and a unit", async () => {
      await go("#/properties"); await page.waitForSelector("#propForm");
      await page.fill("#pName", "Harbour View"); await page.fill("#pAddr", "1 Quay Road"); await page.click("#propForm button[type=submit]");
      await page.waitForSelector("#unitForm"); await page.fill("#uLabel", "12A"); await page.click("#unitForm button[type=submit]");
      await expect(page.locator("td.strong:has-text('12A')")).toBeVisible();
    });
    await step("Manager adds a vendor, activates it and invites people", async () => {
      await go("#/vendors"); await page.waitForSelector("#vendorForm");
      await page.fill("#vName", "FixIt Plumbing"); await page.fill("#vEmail", "office@fixit.test"); await page.check("#vCats input[value=PLUMBING]");
      await page.click("#vendorForm button[type=submit]"); await page.waitForSelector("select.vstatus");
      await page.selectOption("select.vstatus", "ACTIVE"); await expect(page.locator("select.vstatus")).toHaveValue("ACTIVE");
      await page.click("button:has-text('Invite staff')"); await page.waitForSelector("#inviteForm");
      const invite = async (email, role, unit) => {
        await page.selectOption("#iRole", role); if (unit) await page.selectOption("#iUnit", { index: 1 });
        const prev = (await page.locator("#iResult .linkbox code").count()) ? (await page.innerText("#iResult .linkbox code")).trim() : "";
        await page.fill("#iEmail", email); await page.click("#inviteForm button[type=submit]");
        await expect.poll(async () => (await page.locator("#iResult .linkbox code").count()) ? (await page.innerText("#iResult .linkbox code")).trim() : "").not.toBe(prev);
        links[role] = (await page.innerText("#iResult .linkbox code")).trim();
      };
      await invite(A.vendor, "VENDOR"); await invite(A.tech, "TECHNICIAN"); await invite(A.tenant, "TENANT", true);
    });
    await step("Tenant accepts the invitation and reports a leaking tap with a photo", async () => {
      await signOut();
      await accept(links.TENANT, async () => { await page.fill("#name", "Tara Tenant"); });
      expect(await nav()).toEqual(["Overview", "Report an issue", "My requests", "Notifications", "Account"]);
      await go("#/report"); await page.waitForSelector("#reportForm");
      await page.click("#reportForm button[type=submit]"); await expect(page.locator("#rErr")).toContainText("short title");
      await page.fill("#rTitle", "Kitchen tap leaking"); await page.fill("#rDesc", "Water runs from the base of the tap.");
      await page.selectOption("#rCat", "PLUMBING"); await page.selectOption("#rPri", "HIGH");
      await page.setInputFiles("#rFile", PNGFILE); await page.click("#reportForm button[type=submit]");
      await expect(page.locator(".file img")).toHaveCount(1, { timeout: 10000 });
      requestId = Number((await page.evaluate(() => location.hash)).split("/").pop());
    });
    await step("Manager reviews the request and assigns it to the vendor", async () => {
      await signOut(); await signIn(A.manager);
      await go("#/requests"); await page.waitForSelector("tr.clickable");
      await page.fill("#fq", "tap"); await expect(page.locator("tr.clickable")).toHaveCount(1);
      await page.click("tr.clickable"); await page.waitForSelector("#assignForm");
      await page.click("button:has-text('Start review')"); await expect(page.locator("#panes")).toContainText("Under review");
      await page.waitForSelector("#assignForm"); await page.fill("#aDue", "2030-05-01");
      await page.selectOption("#aWho", { label: "FixIt Plumbing — Plumbing" }); await page.click("#assignForm button[type=submit]");
      await expect(page.locator("dd:has-text('FixIt Plumbing (vendor)')")).toBeVisible();
    });
    await step("Vendor accepts the invitation and sends a quotation", async () => {
      await signOut();
      await accept(links.VENDOR, async () => { await page.fill("#name", "Kira Fixit"); });
      expect(await nav()).toEqual(["Overview", "Work orders", "Company", "Notifications", "Account"]);
      await go("#/requests"); await expect(page.locator("tr.clickable")).toHaveCount(1);
      await page.click("tr.clickable"); await page.waitForSelector("#quoteForm");
      await page.fill("#qAmt", "1800"); await page.fill("#qDesc", "Replace cartridge and washers."); await page.click("#quoteForm button[type=submit]");
      await expect(page.locator("td:has-text('Pending')")).toBeVisible();
    });
    await step("Manager approves the quotation", async () => {
      await signOut(); await signIn(A.manager); await go(`#/request/${requestId}`);
      await page.waitForSelector("button[data-act=quote]"); await page.click("button[data-act=quote][data-d=APPROVE]");
      await expect(page.locator("td:has-text('Approved')")).toBeVisible();
    });
    await step("Vendor does the work, uploads evidence and records an invoice", async () => {
      await signOut(); await signIn(A.vendor); await go(`#/request/${requestId}`);
      await page.click("button:has-text('Start work')"); await page.click("button:has-text('Mark work complete')");
      await page.fill("#cNotes", "Cartridge replaced; no leaks."); await page.click("#completeForm button[type=submit]");
      await expect(page.locator("#panes")).toContainText("no leaks");
      await page.setInputFiles("#fFile", PNGFILE); await page.click("#fileForm button[type=submit]");
      await expect(page.locator(".file:has-text('Evidence')")).toBeVisible();
      await page.fill("#eAmt", "1750"); await page.fill("#eDesc", "Invoice 0042"); await page.click("#expForm button[type=submit]");
      await expect(page.locator("td:has-text('Awaiting approval')")).toBeVisible();
      await expect(page.locator("button:has-text('Approve')")).toHaveCount(0);
    });
    await step("Manager approves the invoice and closes the request", async () => {
      await signOut(); await signIn(A.manager); await go(`#/request/${requestId}`);
      await page.click("button[data-act=approve]"); await expect(page.locator("span.chip:has-text('Approved')")).toBeVisible();
      await page.click("button:has-text('Close request')"); await expect(page.locator(".row .chip:has-text('Closed')")).toBeVisible();
      await go("#/overview"); await page.waitForSelector(".stats"); await page.waitForTimeout(1500);
      await go("#/activity"); await page.waitForSelector("table.data"); await page.waitForTimeout(1500);
    });
    await step("Tenant sees the finished repair", async () => {
      await signOut(); await signIn(A.tenant); await go(`#/request/${requestId}`);
      await expect(page.locator(".row")).toContainText("Closed");
      await go("#/notifications"); await page.waitForSelector("ul.tl li"); await page.waitForTimeout(1200);
    });
    await step("Technician accepts the invitation and sees only their own area", async () => {
      await signOut();
      await accept(links.TECHNICIAN, async () => { await page.waitForSelector("#skillsRow:not([hidden])"); await page.fill("#name", "Tom Tech"); await page.fill("#skills", "Electrical"); });
      expect(await nav()).toEqual(["Overview", "My jobs", "Notifications", "Account"]);
      await go("#/requests"); await expect(page.locator("#panes")).toContainText("Nothing here yet");
    });
    await step("Wrong password is refused", async () => {
      await signOut(); await page.fill("#email", A.tenant); await page.fill("#pw", "wrong-wrong"); await page.click("#submit");
      await expect(page.locator("#err")).toContainText("Wrong email or password");
    });
    await caption(`Finished: ${passed} steps passed, ${failed} failed`);
    console.log(`\nFinished: ${passed} steps passed, ${failed} failed.`);
  } catch (e) {
    console.log("\nStopped at the first failure. The browser stays open so you can look at the screen.");
  }

  writeReport();
  if (!HEADLESS) {
    console.log("\nThe browser window stays open. Press Enter here (or close the window) to finish.");
    await new Promise((resolve) => { process.stdin.resume(); process.stdin.once("data", resolve); browser.on("disconnected", resolve); });
  }
  await browser.close().catch(() => {}); stop();
  fs.rmSync(DATA, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); stop(); process.exit(2); });
