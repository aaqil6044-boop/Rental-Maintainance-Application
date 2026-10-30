// Sign-in security in the browser: devices list, two-factor set-up and sign-in (with a recovery code), turning it off, forgot-password page.
const base = require("@playwright/test");
const { expect } = base;
const TOTP = require("../src/totp");

const test = base.test.extend({
  _watch: [async ({ page }, use) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|ERR_|40[0-9]|50[0-9]/.test(m.text())) errors.push(m.text()); });
    await use();
    expect(errors, "JavaScript errors on the page").toEqual([]);
  }, { auto: true }],
});
test.describe.configure({ mode: "serial" });

const EMAIL = "tech@estateops.test", PW = "password123";
const S = { recovery: [] };
async function signIn(page) {
  await page.goto("/login.html");
  await page.fill("#email", EMAIL); await page.fill("#pw", PW); await page.click("#submit");
}

test("the account page lists the devices that are signed in", async ({ page }) => {
  await signIn(page);
  await page.waitForURL("**/app.html");
  await page.evaluate(() => { location.hash = "#/account"; });
  await expect(page.getByRole("heading", { name: "Where you are signed in" })).toBeVisible();
  await expect(page.locator("main, body").getByText("This device").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out everywhere" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Two-factor sign-in" })).toBeVisible();
});

test("a person can turn on two-factor with an authenticator key and gets recovery codes", async ({ page }) => {
  await signIn(page);
  await page.waitForURL("**/app.html");
  await page.evaluate(() => { location.hash = "#/account"; });
  await page.fill("#mfsPw", "wrong-password"); await page.getByRole("button", { name: "Set up two-factor" }).click();
  await expect(page.locator("#mfsErr")).toContainText("password is wrong");
  await page.fill("#mfsPw", PW); await page.getByRole("button", { name: "Set up two-factor" }).click();
  const key = (await page.locator("#mfaBox code").innerText()).replace(/\s/g, "");
  expect(key).toMatch(/^[A-Z2-7]{32}$/);
  await page.fill("#mfeCode", "000000"); await page.getByRole("button", { name: "Turn on two-factor" }).click();
  await expect(page.locator("#mfeErr")).toContainText("not right");
  await page.fill("#mfeCode", TOTP.code(TOTP.unbase32(key), TOTP.stepAt()));
  await page.getByRole("button", { name: "Turn on two-factor" }).click();
  await expect(page.getByText("Two-factor sign-in is on.")).toBeVisible();
  S.recovery = (await page.locator("#mfaBox pre").innerText()).trim().split(/\s+/);
  expect(S.recovery).toHaveLength(10);
  await page.getByRole("button", { name: "I have saved them" }).click();
  await expect(page.getByRole("button", { name: "Turn off two-factor" })).toBeVisible();
});

test("signing in then asks for the code; a recovery code works once", async ({ page }) => {
  await signIn(page);
  await expect(page.locator("#codeRow")).toBeVisible();
  await expect(page.locator("#title")).toHaveText("Two-factor sign-in");
  await page.fill("#code", "123456"); await page.click("#submit");
  await expect(page.locator("#err")).toContainText("not right");
  await page.fill("#code", S.recovery[0]); await page.click("#submit");
  await page.waitForURL("**/app.html");
  await expect(page.locator("#who")).not.toHaveText("");
});

test("turning two-factor off needs the password and a code", async ({ page }) => {
  await signIn(page);
  await page.fill("#code", S.recovery[1]); await page.click("#submit");
  await page.waitForURL("**/app.html");
  await page.evaluate(() => { location.hash = "#/account"; });
  await page.fill("#mfoPw", PW); await page.fill("#mfoCode", "000000");
  await page.getByRole("button", { name: "Turn off two-factor" }).click();
  await expect(page.locator("#mfoErr")).toContainText("not right");
  await page.fill("#mfoCode", S.recovery[2]);
  await page.getByRole("button", { name: "Turn off two-factor" }).click();
  await expect(page.getByRole("button", { name: "Set up two-factor" })).toBeVisible();
});

test("forgot password: the page always answers the same way", async ({ page }) => {
  await page.goto("/login.html");
  await page.getByRole("link", { name: "Forgotten your password?" }).click();
  await expect(page).toHaveURL(/reset\.html/);
  await page.fill("#email", "nobody-at-all@example.test"); await page.getByRole("button", { name: "Send me a link" }).click();
  await expect(page.locator("#blurb")).toContainText("If that email belongs to an account");
});

test("the reset and verify pages explain a bad link", async ({ page }) => {
  await page.goto("/reset.html?token=not-a-real-token");
  await page.fill("#pw", "Tr0ub4dor&Horse-9"); await page.getByRole("button", { name: "Save new password" }).click();
  await expect(page.locator("#setErr")).toContainText("not valid or has expired");
  await page.goto("/verify.html?token=not-a-real-token");
  await expect(page.locator("#title")).toHaveText("This link does not work");
});

test("pages no longer contact Google for fonts", async ({ page }) => {
  const hosts = new Set();
  page.on("request", (r) => hosts.add(new URL(r.url()).host));
  for (const p of ["/index.html", "/login.html", "/accept.html?token=x"]) await page.goto(p);
  expect([...hosts].filter((h) => !/^127\.0\.0\.1/.test(h))).toEqual([]);
  const ok = await page.evaluate(async () => { await document.fonts.ready; return [...document.fonts].some((f) => f.family.includes("Bricolage") && f.status === "loaded"); });
  expect(ok).toBe(true);
});

test("a person can download their data and sees the erase option", async ({ page }) => {
  await signIn(page);
  await page.waitForURL("**/app.html");
  await page.evaluate(() => { location.hash = "#/account"; });
  await expect(page.getByRole("heading", { name: "Your data" })).toBeVisible();
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download my data" }).click()]);
  expect(dl.suggestedFilename()).toBe("estateops-my-data.json");
  await expect(page.getByRole("button", { name: "Erase my account" })).toBeVisible();
  await page.fill("#delPw", "password123"); await page.fill("#delConfirm", "nope");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Erase my account" }).click();
  await expect(page.locator("#delErr")).toContainText("Type DELETE");
});
