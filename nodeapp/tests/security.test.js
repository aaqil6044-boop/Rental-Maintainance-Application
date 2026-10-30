"use strict";
// Regression tests for the security audit (SECURITY.md). Each block is an attack that must stay blocked.
const { isolate, reporter } = require("./helpers");
isolate();
process.env.RATE_LIMIT = "1";           // abuse protection is on in production; switch it on here to test it
const T = reporter("Security");
const { section } = T;
const ok = (cond, what, extra) => T.ok(what, cond, extra);   // condition first, then the sentence it proves
const crypto = require("crypto");
const app = require("../server");
const S = require("../src/store");
const A = require("../src/auth");
const RL = require("../src/ratelimit");
const PW = require("../src/passwords");
require("../src/seed")();

let BASE;
async function call(method, p, token, body, headers = {}) {
  const res = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...headers, ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text(); let data = null; if (text) { try { data = JSON.parse(text); } catch { data = text; } }
  return { status: res.status, data, text, h: res.headers };
}
const login = async (email, password = "password123") => (await call("POST", "/api/auth/login", null, { email, password })).data;

(async () => {
  const server = app.listen(0); await new Promise((r) => server.once("listening", r));
  BASE = "http://127.0.0.1:" + server.address().port;

  section("Password rules");
  ok(PW.weakness("12345678"), "12345678 refused");
  ok(PW.weakness("Password123".toLowerCase()), "password123 refused");
  ok(PW.weakness("aaaaaaaa"), "a repeated character refused");
  ok(PW.weakness("abababab"), "a repeated pattern refused");
  ok(PW.weakness("abcdefgh"), "a consecutive run refused");
  ok(PW.weakness("maya.iqbal2026", { email: "maya.iqbal@x.test" }), "a password containing the email name refused");
  ok(PW.weakness("Str0ngPassw0rd!") === null, "a normal strong password accepted");
  ok(PW.weakness("correct horse battery staple") === null, "a long passphrase accepted");
  let r = await call("POST", "/api/auth/register", null, { email: "weak@x.test", password: "12345678", fullName: "Weak" });
  ok(r.status === 400, "register refuses 12345678");
  r = await call("POST", "/api/auth/register", null, { email: "strong@x.test", password: "Str0ngPassw0rd!", fullName: "Strong" });
  ok(r.status === 201, "register accepts a strong password");
  const mgr = await login("manager@estateops.test");
  r = await call("POST", "/api/auth/change-password", mgr.token, { currentPassword: "password123", newPassword: "qwerty123" });
  ok(r.status === 400, "change-password refuses a common password");
  r = await call("POST", "/api/accounts", mgr.token, { email: "weak.staff@x.test", password: "11111111", fullName: "W", role: "TENANT" });
  ok(r.status === 400, "manager cannot create an account with a common password");

  section("Sign-in: no account enumeration by timing");
  const time = async (email) => { const t = process.hrtime.bigint(); await call("POST", "/api/auth/login", null, { email, password: "wrong-wrong-1" }); return Number(process.hrtime.bigint() - t) / 1e6; };
  const med = (a) => a.sort((x, y) => x - y)[a.length >> 1];
  const known = [], unknown = [];
  for (let i = 0; i < 5; i++) { known.push(await time(i % 2 ? "tenant@estateops.test" : "tenant2@estateops.test")); unknown.push(await time(`nobody${i}@x.test`)); }
  ok(med(unknown) > med(known) / 3, `unknown email costs about the same as a known one (${med(known).toFixed(0)}ms vs ${med(unknown).toFixed(0)}ms)`);
  r = await call("POST", "/api/auth/login", null, { email: "tenant@estateops.test", password: "x" });
  const r2 = await call("POST", "/api/auth/login", null, { email: "nobody@x.test", password: "x" });
  ok(r.data.message === r2.data.message && r.status === r2.status, "same status and message for unknown email and wrong password");

  section("Tokens");
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const none = `${b64({ alg: "none", typ: "JWT" })}.${b64({ uid: 1, role: "MANAGER", tv: 0 })}.`;
  ok((await call("GET", "/api/auth/me", none)).status === 401, "alg=none token refused");
  const h = b64({ alg: "HS512", typ: "JWT" }), p = b64({ uid: 1, role: "MANAGER", tv: 0, exp: 9999999999 });
  const hs512 = `${h}.${p}.${crypto.createHmac("sha512", require("../src/config").jwtSecret).update(h + "." + p).digest("base64url")}`;
  ok((await call("GET", "/api/auth/me", hs512)).status === 401, "a token signed with another algorithm is refused even with the right secret");
  const raw = A.issue(S.findAccountByEmail("tenant@estateops.test"));
  ok(JSON.parse(Buffer.from(raw.split(".")[0], "base64url")).alg === "HS256", "issued tokens are HS256");

  section("Rate limits (production setting)");
  RL.reset();
  let codes = []; for (let i = 0; i < 25; i++) codes.push((await call("POST", "/api/auth/register", null, { email: `bulk${i}@x.test`, password: "Str0ngPassw0rd!", fullName: "Bulk" })).status);
  ok(codes.filter((c) => c === 201).length === 20 && codes.filter((c) => c === 429).length === 5, `sign-up: 20 per hour per address, then 429 (${codes.filter((c) => c === 201).length} created)`);
  r = await call("POST", "/api/auth/register", null, { email: "again@x.test", password: "Str0ngPassw0rd!", fullName: "x" });
  ok(r.status === 429 && Number(r.h.get("retry-after")) > 0, "429 carries Retry-After");
  RL.reset();
  codes = []; for (let i = 0; i < 70; i++) codes.push((await call("POST", "/api/auth/login", null, { email: `spray${i}@x.test`, password: "bad" })).status);
  ok(codes.includes(429), `password spraying across many emails is stopped (first 429 after ${codes.indexOf(429)} failures)`);
  r = await call("POST", "/api/auth/login", null, { email: "manager@estateops.test", password: "password123" }, { "X-Forwarded-For": "1.2.3.4" });
  ok(r.status === 429, "the lockout cannot be dodged with a fake X-Forwarded-For (TRUST_PROXY is off)");
  RL.reset();
  const good = []; for (let i = 0; i < 80; i++) good.push((await call("POST", "/api/auth/login", null, { email: "tenant@estateops.test", password: "password123" })).status);
  ok(good.every((c) => c === 200), "80 successful sign-ins from one address are never blocked (only failures count)");
  RL.reset();
  const tok = (await login("tech@estateops.test")).token; codes = [];
  for (let i = 0; i < 12; i++) codes.push((await call("POST", "/api/auth/change-password", tok, { currentPassword: "wrong" + i, newPassword: "Str0ngPassw0rd!" })).status);
  ok(codes.slice(0, 8).every((c) => c === 401) && codes[8] === 429, "current-password guessing: 8 tries, then 429");
  RL.reset();
  codes = []; for (let i = 0; i < 35; i++) codes.push((await call("GET", "/api/invitations/lookup?token=" + crypto.randomBytes(24).toString("base64url"))).status);
  ok(codes.includes(429), "guessing invitation tokens is stopped");
  RL.reset();
  codes = []; for (let i = 0; i < 12; i++) codes.push((await call("POST", "/api/setup", null, { email: "a@b.co", password: "Str0ngPassw0rd!", fullName: "A", organizationName: "O", setupKey: "k" + i })).status);
  ok(codes.includes(429) || codes.every((c) => c === 409), "setup endpoint is rate limited (or already closed)");
  RL.reset();

  section("Error handling does not leak internals");
  r = await fetch(BASE + "/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{bad" });
  const txt = await r.text(); ok(r.status === 400 && !/SyntaxError|node_modules| at /.test(txt), "malformed JSON gives a clean 400");
  // force a raw database error with a `code` through the router's error handler
  const orig = S.markAllRead;
  S.markAllRead = () => { const e = new Error("UNIQUE constraint failed: accounts.email"); e.code = "SQLITE_CONSTRAINT_UNIQUE"; throw e; };
  r = await call("POST", "/api/notifications/read-all", mgr.token);
  S.markAllRead = orig;
  ok(r.status === 500 && !/UNIQUE|SQLITE|accounts/i.test(r.text), "a database error with a code is replaced by a generic message");
  ok(!("code" in (r.data || {})), "and its internal code is not returned");

  section("Headers and exposure");
  r = await call("GET", "/login.html");
  const csp = r.h.get("content-security-policy") || "";
  ok(/default-src 'self'/.test(csp) && /script-src 'self'(;|$)/.test(csp) && !/script-src[^;]*unsafe-inline/.test(csp), "pages: scripts only from this site, no inline script");
  ok(/frame-ancestors 'none'/.test(csp) && /object-src 'none'/.test(csp) && /base-uri 'none'/.test(csp), "pages: no framing, no plugins, no <base> hijack");
  ok(r.h.get("x-frame-options") === "DENY" && r.h.get("x-content-type-options") === "nosniff", "framing and MIME sniffing blocked");
  for (const f of ["login.html", "accept.html"]) ok(!/<script>/i.test(require("fs").readFileSync(require("path").join(__dirname, "..", "public", f), "utf8")), `${f} has no inline script`);
  r = await call("GET", "/api/setup/status");
  ok(/no-store/.test(r.h.get("cache-control") || ""), "API answers are not cacheable (no-store)");
  r = await call("GET", "/api/dashboard", mgr.token);
  ok(/no-store/.test(r.h.get("cache-control") || ""), "signed-in API answers are not cacheable");
  ok(r.h.get("cross-origin-resource-policy") === "same-origin", "other sites cannot embed API responses");
  r = await call("OPTIONS", "/api/dashboard", null, undefined, { Origin: "https://evil.example", "Access-Control-Request-Method": "GET" });
  ok(!r.h.get("access-control-allow-origin"), "no cross-origin access granted by default");
  for (const f of ["/package.json", "/server.js", "/.env", "/src/config.js", "/data/estateops.db", "/../server.js", "/%2e%2e/server.js"]) {
    const x = await call("GET", f); ok(x.status === 404, `${f} is not downloadable`);
  }

  section("Attachments are served defensively");
  const tenant = await login("tenant@estateops.test");
  const mine = (await call("GET", "/api/maintenance-requests", tenant.token)).data[0];
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("<script>alert(1)</script>")]);
  const fd = new FormData(); fd.append("file", new Blob([png], { type: "text/html" }), "../../x.png");
  const up = await fetch(BASE + `/api/maintenance-requests/${mine.id}/attachments`, { method: "POST", headers: { Authorization: "Bearer " + tenant.token }, body: fd });
  ok(up.status === 201, "a real PNG is accepted whatever the claimed type");
  const att = await up.json();
  const got = await fetch(BASE + `/api/attachments/${att.id}`, { headers: { Authorization: "Bearer " + tenant.token } });
  ok(got.headers.get("content-type") === "image/png" && got.headers.get("x-content-type-options") === "nosniff", "served as image/png with nosniff, never as HTML");
  ok(/sandbox/.test(got.headers.get("content-security-policy") || ""), "served with a sandboxing Content-Security-Policy");
  ok(!/\.\./.test(got.headers.get("content-disposition") || ""), "the stored file name cannot carry a path");
  for (const [name, bytes, type] of [["a.png", Buffer.from("<html><script>1</script></html>"), "image/png"], ["a.svg", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'), "image/svg+xml"], ["a.pdf", Buffer.from("MZ fake program"), "application/pdf"]]) {
    const f2 = new FormData(); f2.append("file", new Blob([bytes], { type }), name);
    const x = await fetch(BASE + `/api/maintenance-requests/${mine.id}/attachments`, { method: "POST", headers: { Authorization: "Bearer " + tenant.token }, body: f2 });
    ok(x.status === 400, `${name} (${type}) with non-image content is refused`);
  }

  section("Sign-up switch");
  const cfg = require("../src/config");
  cfg.selfRegistration = false;
  r = await call("POST", "/api/auth/register", null, { email: "closed@x.test", password: "Str0ngPassw0rd!", fullName: "C" });
  ok(r.status === 403, "SELF_REGISTRATION=0 refuses sign-up");
  r = await call("GET", "/api/setup/status"); ok(r.data.selfRegistration === false || r.data.selfRegistration === true, "setup status reports the switch");
  cfg.selfRegistration = true;

  server.close(); T.done();
})().catch((e) => { console.error(e); process.exit(1); });
