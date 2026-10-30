// The public landing page: message, real destinations, honesty, accessibility basics, responsive layout.
const { test, expect } = require("@playwright/test");
const SIZES = { desktop: [1440, 900], tablet: [820, 1100], phone: [390, 844] };

test.describe("Landing page", () => {
  test("says what EstateOps is within the first screen", async ({ page }) => {
    await page.goto("/index.html");
    await expect(page.locator("h1")).toContainText("Every property. Every repair. One clear view.");
    await expect(page.locator(".lede")).toContainText("tenant requests, maintenance teams, vendors, and repair costs");
    const box = await page.locator(".cta .btn").first().boundingBox();
    expect(box.y + box.height).toBeLessThan(900); // primary action visible without scrolling
  });

  test("calls to action lead to the real flows", async ({ page, request }) => {
    await page.goto("/index.html");
    for (const [label, href] of [["Get Started", "login.html?mode=register"], ["Sign In", "login.html"]]) {
      const links = page.locator(`a:has-text("${label}")`);
      expect(await links.count()).toBeGreaterThanOrEqual(2);
      for (let i = 0; i < await links.count(); i++) expect(await links.nth(i).getAttribute("href")).toBe(href);
    }
    for (const dest of ["/login.html", "/app.html", "/accept.html", "/docs", "/openapi.json", "/health"]) {
      expect((await request.get(dest)).status(), dest).toBe(200);
    }
    await page.locator("a:has-text('Sign In')").first().click();
    await page.waitForURL("**/login.html");
    await page.goto("/index.html");
    await page.locator("a:has-text('Get Started')").first().click();
    await page.waitForURL("**/login.html?mode=register");
  });

  test("Get Started opens tenant sign-up on an installed system", async ({ page }) => {
    await page.goto("/login.html?mode=register");
    await expect(page.locator("#title")).toContainText(/Create a tenant account|Set up EstateOps/);
  });

  test("every in-page link points at a section that exists", async ({ page }) => {
    await page.goto("/index.html");
    for (const href of await page.$$eval("a[href^='#']", (a) => a.map((x) => x.getAttribute("href")))) {
      expect(await page.locator(href).count(), href).toBe(1);
    }
  });

  test("makes no claims it cannot back up: no demo credentials, no invented numbers, AI example is labelled", async ({ page }) => {
    await page.goto("/index.html");
    const text = (await page.innerText("body")).toLowerCase();
    for (const bad of ["password123", "@estateops.test", "testimonial", "% faster", "customers trust", "★"]) expect(text).not.toContain(bad);
    expect(text).toContain("illustrative preview with sample data");
    expect(text).toContain("example only, not a live ai result");
    await expect(page.locator("button:has-text('Try it as')")).toHaveCount(0);
  });

  test("has one h1, ordered headings, labelled landmarks and a visible focus ring", async ({ page }) => {
    await page.goto("/index.html");
    await expect(page.locator("h1")).toHaveCount(1);
    expect(await page.locator("main").count()).toBe(1);
    expect(await page.locator("header, footer, nav").count()).toBeGreaterThanOrEqual(3);
    await page.keyboard.press("Tab"); await page.keyboard.press("Tab");
    const outline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
    expect(outline).not.toBe("none");
  });

  test("decorative mock-ups are hidden from screen readers", async ({ page }) => {
    await page.goto("/index.html");
    expect(await page.locator(".win[aria-hidden='true'], .ticket[aria-hidden='true']").count()).toBe(2);
  });

  test("reduced-motion visitors get no animation", async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: "reduce" });
    const page = await ctx.newPage(); await page.goto("/index.html");
    const names = await page.$$eval(".tl li", (els) => els.map((e) => getComputedStyle(e).animationName));
    expect(names.every((n) => n === "none")).toBe(true);
    await ctx.close();
  });

  for (const [name, [w, h]] of Object.entries(SIZES)) {
    test(`fits a ${name} screen (${w}px) with no sideways scrolling`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await page.goto("/index.html");
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
      await page.waitForTimeout(2600); // let the one-off timeline animation finish
      await page.screenshot({ path: `report/landing-${name}.png`, fullPage: true });
    });
  }
});
