"use strict";
// Email: invitations and resets are emailed, self-service forgot-password never reveals who is registered, links are single-use,
// public sign-ups must verify their address before a manager can link them by email.
const { isolate, reporter } = require("./helpers");
const dir = isolate();
const T = reporter("Email");
const { section } = T;
const ok = (cond, what, extra) => T.ok(what, cond, extra);
process.env.RATE_LIMIT = "1";
const fs = require("fs"), path = require("path");
const app = require("../server");
const S = require("../src/store");
const RL = require("../src/ratelimit");
const config = require("../src/config");
require("../src/seed")();

let BASE;
async function call(method, p, token, body) {
  const res = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text(); let data = null; if (text) { try { data = JSON.parse(text); } catch { data = text; } }
  return { status: res.status, data, text };
}
const outbox = () => { const d = path.join(dir, "outbox"); return fs.existsSync(d) ? fs.readdirSync(d).sort().map((f) => JSON.parse(fs.readFileSync(path.join(d, f), "utf8"))) : []; };
const tokenIn = (m) => decodeURIComponent(/token=([^\s&]+)/.exec(m.text)[1]);
const login = async (email, password = "password123") => (await call("POST", "/api/auth/login", null, { email, password })).data;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const server = app.listen(0); await new Promise((r) => server.once("listening", r)); BASE = "http://127.0.0.1:" + server.address().port;
  const mgr = await login("manager@estateops.test");

  section("Invitations and manager resets are emailed");
  ok(config.mail.transport === "outbox", "tests use the outbox (nothing is sent anywhere)");
  let r = await call("POST", "/api/invitations", mgr.token, { email: "new.tech@x.test", role: "TECHNICIAN" });
  ok(r.status === 201 && r.data.emailed === true, "invitation created and emailed");
  let mails = outbox();
  ok(mails.length === 1 && mails[0].to === "new.tech@x.test" && /accept\.html\?token=/.test(mails[0].text), "the email has the accept link");
  ok(tokenIn(mails[0]) === r.data.token, "and it is the same link the manager sees");
  const team = (await call("GET", "/api/team", mgr.token)).data; const tenantAcc = team.find((a) => a.role === "TENANT") || S.accountsByRole(S.findAccountByEmail("manager@estateops.test").org_id, "TENANT")[0];
  r = await call("POST", `/api/accounts/${tenantAcc.id}/reset-link`, mgr.token);
  ok(r.status === 201 && r.data.emailed === true, "manager-issued reset is emailed");
  mails = outbox(); ok(/accept\.html\?token=/.test(mails[mails.length - 1].text), "and points at the accept page");

  section("Forgot password never reveals who is registered");
  const before = outbox().length;
  const known = await call("POST", "/api/auth/forgot-password", null, { email: "tenant@estateops.test" });
  const unknown = await call("POST", "/api/auth/forgot-password", null, { email: "nobody@nowhere.test" });
  ok(known.status === 202 && unknown.status === 202 && known.text === unknown.text, "same status and same body for a known and an unknown address");
  await wait(100);
  mails = outbox();
  ok(mails.length === before + 1 && mails[mails.length - 1].to === "tenant@estateops.test", "mail is sent only for the real account");
  const deact = S.findAccountByEmail("tenant@estateops.test");
  S.db.prepare("INSERT INTO accounts (email, password_hash, full_name, role, active, created_at, email_verified) VALUES ('off@x.test','x','Off','TENANT',0,?,1)").run(S.now());
  await call("POST", "/api/auth/forgot-password", null, { email: "off@x.test" }); await wait(50);
  ok(outbox().length === before + 1, "no mail for a deactivated account");
  void deact;

  section("Reset link: single use, strong password, ends old sessions");
  const resetMail = outbox()[outbox().length - 1], tok = tokenIn(resetMail);
  const oldSession = await login("tenant@estateops.test");
  ok(/reset\.html\?token=/.test(resetMail.text), "the email points at the reset page");
  r = await call("POST", "/api/auth/reset-password", null, { token: tok, password: "12345678" }); ok(r.status === 400, "a weak password is refused");
  r = await call("POST", "/api/auth/reset-password", null, { token: "wrong-token", password: "Tr0ub4dor&Horse-9" }); ok(r.status === 404, "an unknown token is refused");
  r = await call("POST", "/api/auth/reset-password", null, { token: tok, password: "Tr0ub4dor&Horse-9" }); ok(r.status === 204, "the link sets the password");
  r = await call("POST", "/api/auth/reset-password", null, { token: tok, password: "An0ther&Strong-77" }); ok(r.status === 404, "the same link cannot be used twice");
  ok((await call("GET", "/api/auth/me", oldSession.token)).status === 401, "the old session stopped working");
  ok((await call("POST", "/api/auth/login", null, { email: "tenant@estateops.test", password: "password123" })).status === 401, "the old password no longer works");
  ok((await login("tenant@estateops.test", "Tr0ub4dor&Horse-9")).token, "the new password works");
  ok(S.db.prepare("SELECT token_hash FROM account_tokens").all().every((t) => /^[0-9a-f]{64}$/.test(t.token_hash)) && !JSON.stringify(S.db.prepare("SELECT * FROM account_tokens").all()).includes(tok), "only hashes are stored");
  await call("POST", "/api/auth/forgot-password", null, { email: "tenant@estateops.test" }); await wait(50);
  const first = tokenIn(outbox().pop());
  RL.reset(); await call("POST", "/api/auth/forgot-password", null, { email: "tenant@estateops.test" }); await wait(50);
  const second = tokenIn(outbox().pop());
  r = await call("POST", "/api/auth/reset-password", null, { token: first, password: "An0ther&Strong-77" }); ok(r.status === 404, "asking again invalidates the earlier link");
  r = await call("POST", "/api/auth/reset-password", null, { token: second, password: "An0ther&Strong-77" }); ok(r.status === 204, "the newest link works");
  const exp = "expired-token-value-123456789"; S.createAccountToken(deact.id, "RESET", require("../src/auth").hashToken(exp), 1);
  S.db.prepare("UPDATE account_tokens SET expires_at = ? WHERE token_hash = ?").run(new Date(Date.now() - 1000).toISOString(), require("../src/auth").hashToken(exp));
  ok((await call("POST", "/api/auth/reset-password", null, { token: exp, password: "Fresh&Strong-4242" })).status === 404, "an expired link is refused");

  section("Forgot-password is rate limited (it can send mail)");
  RL.reset(); const codes = [];
  for (let i = 0; i < 6; i++) codes.push((await call("POST", "/api/auth/forgot-password", null, { email: "tenant@estateops.test" })).status);
  ok(codes.slice(0, 3).every((c) => c === 202) && codes.slice(3).every((c) => c === 429), `one address gets 3 mails an hour, then 429 (${codes})`);
  RL.reset();

  section("Email verification for public sign-ups");
  r = await call("POST", "/api/auth/register", null, { email: "stranger@x.test", password: "Tr0ub4dor&Horse-9", fullName: "Stranger" });
  ok(r.status === 201 && r.data.emailVerified === false, "a public sign-up starts unverified");
  await wait(50); const vmail = outbox().pop();
  ok(vmail.to === "stranger@x.test" && /verify\.html\?token=/.test(vmail.text), "a verification email is sent");
  ok((await call("GET", "/api/auth/me", r.data.token)).data.emailVerified === false, "/auth/me reports it");
  config.requireEmailVerification = true;                      // what production does by default when real email is configured
  const unit = S.db.prepare("SELECT id FROM units LIMIT 1").get();
  r = await call("POST", `/api/units/${unit.id}/tenants`, mgr.token, { email: "stranger@x.test" });
  ok(r.status === 409 && /confirmed their email/.test(r.data.message), "a manager cannot link an unverified tenant by email");
  ok((await call("POST", "/api/auth/verify-email", null, { token: "nope" })).status === 404, "a wrong verification token is refused");
  r = await call("POST", "/api/auth/verify-email", null, { token: tokenIn(vmail) }); ok(r.status === 204, "the link verifies the address");
  ok((await call("POST", "/api/auth/verify-email", null, { token: tokenIn(vmail) })).status === 404, "and works once");
  r = await call("POST", `/api/units/${unit.id}/tenants`, mgr.token, { email: "stranger@x.test" }); ok(r.status === 204, "after verification the tenant can be linked");
  config.requireEmailVerification = false;
  const sg = await login("stranger@x.test", "Tr0ub4dor&Horse-9");
  r = await call("POST", "/api/auth/resend-verification", sg.token); ok(r.status === 204, "resend on a verified account does nothing");
  S.db.prepare("INSERT INTO accounts (email, password_hash, full_name, role, active, created_at, email_verified) VALUES ('u@x.test',?,'U','TENANT',1,?,0)").run(require("../src/auth").hash("Tr0ub4dor&Horse-9"), S.now());
  const u = await login("u@x.test", "Tr0ub4dor&Horse-9"); const n0 = outbox().length;
  r = await call("POST", "/api/auth/resend-verification", u.token); ok(r.status === 202, "resend sends a new link"); await wait(50);
  ok(outbox().length === n0 + 1, "one email");
  const codes2 = []; for (let i = 0; i < 4; i++) codes2.push((await call("POST", "/api/auth/resend-verification", u.token)).status);
  ok(codes2.includes(429), `resend is limited to 3 an hour (${codes2})`);
  ok(S.findAccountByEmail("manager@estateops.test").email_verified === 1 && S.findAccountByEmail("tenant@estateops.test").email_verified === 1, "invited, seeded and existing accounts count as verified");

  section("Mail trouble never breaks the request");
  const Mailer = require("../src/mailer"); const saved = config.mail.transport;
  config.mail.transport = "smtp"; config.mail.smtp.host = "127.0.0.1"; config.mail.smtp.port = 1;
  const t0 = Date.now(); r = await call("POST", "/api/invitations", mgr.token, { email: "smtp.down@x.test", role: "VENDOR", vendorId: S.db.prepare("SELECT id FROM vendors LIMIT 1").get().id });
  ok(r.status === 201 && r.data.emailed === false && r.data.token, `invitation still created when the mail server is down (emailed:false, ${Date.now() - t0} ms)`);
  ok(!/ECONN|127\.0\.0\.1/.test(r.text), "no mail-server details in the answer");
  config.mail.transport = "off"; config.mail.enabled = false;
  r = await call("POST", "/api/invitations", mgr.token, { email: "off.mail@x.test", role: "TECHNICIAN" }); ok(r.status === 201 && r.data.emailed === false, "with email off the manager still gets the link to hand over");
  const n1 = outbox().length; await call("POST", "/api/auth/forgot-password", null, { email: "manager@estateops.test" }); ok(outbox().length === n1, "and nothing is written");
  config.mail.transport = saved; config.mail.enabled = true;
  const m = Mailer.templates.forgot({ to: "a@b.c", name: "Evil\r\nBcc: x@y.z", token: "t", hours: 1 });
  ok(!/\r|\n.*Bcc/.test(m.text.split("\n")[0]), "names with line breaks cannot inject headers or extra lines in the greeting");

  server.close(); T.done();
})().catch((e) => { console.error(e); process.exit(1); });
