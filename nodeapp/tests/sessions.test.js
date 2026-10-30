"use strict";
// Sessions (per-device sign-out, idle timeout, device list) and two-factor sign-in (TOTP, recovery codes, policy).
const { isolate, reporter } = require("./helpers");
isolate();
const T = reporter("Sessions and two-factor");
const { section } = T;
const ok = (cond, what, extra) => T.ok(what, cond, extra);
process.env.RATE_LIMIT = "1";
const app = require("../server");
const S = require("../src/store");
const A = require("../src/auth");
const RL = require("../src/ratelimit");
const TOTP = require("../src/totp");
const config = require("../src/config");
require("../src/seed")();

let BASE;
async function call(method, p, token, body) {
  const res = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", "User-Agent": "TestBrowser/1.0", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text(); let data = null; if (text) { try { data = JSON.parse(text); } catch { data = text; } }
  return { status: res.status, data, text };
}
const login = async (email, password = "password123") => (await call("POST", "/api/auth/login", null, { email, password })).data;
const GOOD = "Tr0ub4dor&Horse-9";

(async () => {
  const server = app.listen(0); await new Promise((r) => server.once("listening", r)); BASE = "http://127.0.0.1:" + server.address().port;

  section("TOTP matches the RFC 6238 test vectors");
  const rfc = Buffer.from("12345678901234567890");
  ok(TOTP.code(rfc, Math.floor(59 / 30), 8) === "94287082", "T=59 -> 94287082");
  ok(TOTP.code(rfc, Math.floor(1111111109 / 30), 8) === "07081804", "T=1111111109 -> 07081804");
  ok(TOTP.code(rfc, Math.floor(20000000000 / 30), 8) === "65353130", "T=20000000000 -> 65353130");
  ok(TOTP.base32(rfc) === "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ" && TOTP.unbase32(TOTP.base32(rfc)).equals(rfc), "base32 round-trips");
  const sec = TOTP.newSecret(), now = 1_700_000_000_000;
  const c0 = TOTP.code(TOTP.unbase32(sec), TOTP.stepAt(now));
  ok(TOTP.verify(sec, c0, now) === TOTP.stepAt(now), "the current code is accepted");
  ok(TOTP.verify(sec, TOTP.code(TOTP.unbase32(sec), TOTP.stepAt(now) - 1), now) !== null, "one step of clock drift is accepted");
  ok(TOTP.verify(sec, TOTP.code(TOTP.unbase32(sec), TOTP.stepAt(now) - 3), now) === null, "three steps old is refused");
  ok(TOTP.verify(sec, "12345", now) === null && TOTP.verify(sec, "abcdef", now) === null && TOTP.verify(sec, undefined, now) === null, "malformed codes are refused");
  const sealed = TOTP.seal(sec); ok(TOTP.open(sealed) === sec && !sealed.includes(sec), "the secret is stored encrypted and decrypts back");
  let tampered = sealed.split("."); tampered[2] = Buffer.from("x" + Buffer.from(tampered[2], "base64").toString("latin1").slice(1), "latin1").toString("base64");
  let threw = false; try { TOTP.open(tampered.join(".")); } catch { threw = true; } ok(threw, "a tampered sealed secret is rejected");

  section("Each sign-in is its own session");
  const a1 = await login("tenant@estateops.test"), a2 = await login("tenant@estateops.test");
  ok(a1.token !== a2.token, "two sign-ins, two tokens");
  ok((await call("GET", "/api/auth/me", a1.token)).status === 200 && (await call("GET", "/api/auth/me", a2.token)).status === 200, "both work");
  let r = await call("GET", "/api/auth/sessions", a1.token);
  ok(r.status === 200 && r.data.length === 2 && r.data.filter((s) => s.current).length === 1, "the device list shows both, one marked current");
  ok(r.data[0].device === "TestBrowser/1.0" && !("sid" in r.data[0]) && !JSON.stringify(r.data).includes(require("jsonwebtoken").decode(a1.token).sid), "device shown; the secret session id is never returned");
  r = await call("POST", "/api/auth/logout", a1.token); ok(r.status === 204, "sign out on device 1");
  ok((await call("GET", "/api/auth/me", a1.token)).status === 401, "device 1 is signed out");
  ok((await call("GET", "/api/auth/me", a2.token)).status === 200, "device 2 is still signed in");
  const a3 = await login("tenant@estateops.test");
  const sess = (await call("GET", "/api/auth/sessions", a2.token)).data.find((s) => !s.current);
  r = await call("POST", `/api/auth/sessions/${sess.id}/revoke`, a2.token); ok(r.status === 204, "device 2 signs device 3 out remotely");
  ok((await call("GET", "/api/auth/me", a3.token)).status === 401, "device 3 is signed out");
  ok((await call("POST", `/api/auth/sessions/${sess.id}/revoke`, a2.token)).status === 404, "an already-ended session answers 404");
  const other = await login("manager@estateops.test"); const osess = (await call("GET", "/api/auth/sessions", other.token)).data[0];
  ok((await call("POST", `/api/auth/sessions/${osess.id}/revoke`, a2.token)).status === 404, "nobody can end another person's session");
  ok((await call("GET", "/api/auth/me", other.token)).status === 200, "and theirs is untouched");
  const a4 = await login("tenant@estateops.test");
  r = await call("POST", "/api/auth/logout-all", a2.token); ok(r.status === 204, "sign out everywhere");
  ok((await call("GET", "/api/auth/me", a2.token)).status === 401 && (await call("GET", "/api/auth/me", a4.token)).status === 401, "every device is signed out");
  ok((await call("GET", "/api/auth/sessions", (await login("tenant@estateops.test")).token)).data.length === 1, "the list is truthful afterwards (only the new sign-in)");
  const b1 = await login("tenant@estateops.test"), b2 = await login("tenant@estateops.test");
  r = await call("POST", "/api/auth/change-password", b1.token, { currentPassword: "password123", newPassword: GOOD });
  ok(r.status === 200 && (await call("GET", "/api/auth/me", r.data.token)).status === 200, "change password keeps this device signed in");
  ok((await call("GET", "/api/auth/me", b2.token)).status === 401, "and signs the others out");
  ok((await call("GET", "/api/auth/me", b1.token)).status === 401, "(the old token for this device is replaced by the new one)");

  section("Old-style tokens, expiry, and the cap");
  const jwt = require("jsonwebtoken"), acct = S.findAccountByEmail("tenant@estateops.test");
  const noSid = jwt.sign({ uid: acct.id, role: acct.role, tv: acct.token_version }, config.jwtSecret, { algorithm: "HS256", expiresIn: "1h" });
  ok((await call("GET", "/api/auth/me", noSid)).status === 401, "a token with no session id is refused (forces a fresh sign-in after the upgrade)");
  const c = await login("tenant@estateops.test", GOOD);
  S.db.prepare("UPDATE sessions SET expires_at = ? WHERE sid = ?").run(new Date(Date.now() - 1000).toISOString(), jwt.decode(c.token).sid);
  ok((await call("GET", "/api/auth/me", c.token)).status === 401, "an expired session row is refused");
  const keep = config.maxSessionsPerAccount; config.maxSessionsPerAccount = 3;
  const many = []; for (let i = 0; i < 5; i++) many.push((await login("tenant@estateops.test", GOOD)).token);
  const live = []; for (const t of many) live.push((await call("GET", "/api/auth/me", t)).status);
  ok(live.filter((s) => s === 200).length === 3 && live[0] === 401 && live[4] === 200, `only the newest 3 sessions stay live (${live})`);
  config.maxSessionsPerAccount = keep;
  ok(S.purgeSessions() >= 0, "housekeeping runs");

  section("Idle timeout");
  config.sessionIdleMin = 30;
  const d = await login("tenant@estateops.test", GOOD), dsid = jwt.decode(d.token).sid;
  ok((await call("GET", "/api/auth/me", d.token)).status === 200, "active session works");
  S.db.prepare("UPDATE sessions SET last_seen_at = ? WHERE sid = ?").run(new Date(Date.now() - 10 * 60000).toISOString(), dsid);
  ok((await call("GET", "/api/auth/me", d.token)).status === 200, "10 minutes idle is fine");
  const seenAfter = S.db.prepare("SELECT last_seen_at FROM sessions WHERE sid = ?").get(dsid).last_seen_at;
  ok(Date.now() - Date.parse(seenAfter) < 5000, "using it refreshes last_seen");
  S.db.prepare("UPDATE sessions SET last_seen_at = ? WHERE sid = ?").run(new Date(Date.now() - 31 * 60000).toISOString(), dsid);
  r = await call("GET", "/api/auth/me", d.token); ok(r.status === 401 && /inactivity/.test(r.data.message), "31 minutes idle: signed out, with a clear reason");
  ok((await call("GET", "/api/auth/me", d.token)).status === 401, "and it stays signed out");
  config.sessionIdleMin = 0;
  const e = await login("tenant@estateops.test", GOOD); S.db.prepare("UPDATE sessions SET last_seen_at = ? WHERE sid = ?").run(new Date(Date.now() - 86400000).toISOString(), jwt.decode(e.token).sid);
  ok((await call("GET", "/api/auth/me", e.token)).status === 200, "with the timeout off a long idle gap is allowed (the token's own 12 h limit still applies)");

  section("Two-factor: set up");
  const m = await login("manager@estateops.test");
  r = await call("POST", "/api/auth/mfa/setup", m.token, { password: "wrong" }); ok(r.status === 401, "setup needs the password");
  r = await call("POST", "/api/auth/mfa/enable", m.token, { code: "123456" }); ok(r.status === 400, "enable before setup is refused");
  r = await call("POST", "/api/auth/mfa/setup", m.token, { password: "password123" });
  ok(r.status === 200 && /^[A-Z2-7]{32}$/.test(r.data.secret) && r.data.otpauthUrl.startsWith("otpauth://totp/EstateOps:"), "setup returns a key and an otpauth link");
  const secret = r.data.secret;
  ok(!S.db.prepare("SELECT mfa_secret FROM accounts WHERE email = 'manager@estateops.test'").get().mfa_secret.includes(secret), "the key is stored encrypted");
  ok((await login("manager@estateops.test")).token, "not active yet: sign-in still works with the password alone");
  r = await call("POST", "/api/auth/mfa/enable", m.token, { code: "000000" }); ok(r.status === 401, "a wrong code does not enable it");
  const codeNow = () => TOTP.code(TOTP.unbase32(secret), TOTP.stepAt());
  r = await call("POST", "/api/auth/mfa/enable", m.token, { code: codeNow() });
  ok(r.status === 200 && r.data.recoveryCodes.length === 10 && r.data.recoveryCodes.every((x) => /^[0-9a-f]{5}-[0-9a-f]{5}$/.test(x)), "the right code enables it and returns ten recovery codes");
  const recovery = r.data.recoveryCodes;
  ok(!JSON.stringify(S.db.prepare("SELECT * FROM mfa_recovery").all()).includes(recovery[0]), "recovery codes are stored only as hashes");
  ok((await call("GET", "/api/auth/me", m.token)).data.mfaEnabled === true, "/auth/me reports it");
  ok((await call("POST", "/api/auth/mfa/setup", m.token, { password: "password123" })).status === 409, "cannot set up twice");

  section("Two-factor: signing in");
  RL.reset();
  r = await call("POST", "/api/auth/login", null, { email: "manager@estateops.test", password: "password123" });
  ok(r.status === 200 && r.data.mfaRequired === true && r.data.mfaToken && !r.data.token, "password alone gives a challenge, not a session");
  const mt = r.data.mfaToken;
  ok((await call("GET", "/api/auth/me", mt)).status === 401, "the challenge token cannot open the API");
  ok((await call("POST", "/api/auth/mfa/verify", null, { mfaToken: "garbage", code: codeNow() })).status === 401, "a bad challenge token is refused");
  ok((await call("POST", "/api/auth/mfa/verify", null, { mfaToken: m.token, code: codeNow() })).status === 401, "a normal session token is not a challenge token");
  r = await call("POST", "/api/auth/mfa/verify", null, { mfaToken: mt, code: "111111" }); ok(r.status === 401, "a wrong code is refused");
  // The step used to enable it is spent: wait for the next one by moving the clock for the replay check.
  const realNow = Date.now; Date.now = () => realNow() + 30000;
  const next = codeNow();
  r = await call("POST", "/api/auth/mfa/verify", null, { mfaToken: mt, code: next });
  ok(r.status === 200 && r.data.token, "the right code completes the sign-in");
  const mfaSession = r.data.token;
  r = await call("POST", "/api/auth/login", null, { email: "manager@estateops.test", password: "password123" });
  r = await call("POST", "/api/auth/mfa/verify", null, { mfaToken: r.data.mfaToken, code: next }); ok(r.status === 401, "the same code cannot be used twice (replay)");
  Date.now = realNow;
  ok((await call("GET", "/api/auth/me", mfaSession)).status === 200, "the session works");
  r = await call("POST", "/api/auth/login", null, { email: "manager@estateops.test", password: "password123" });
  const rc = recovery[0];
  r = await call("POST", "/api/auth/mfa/verify", null, { mfaToken: r.data.mfaToken, code: rc.toUpperCase() }); ok(r.status === 200, "a recovery code signs in");
  r = await call("POST", "/api/auth/login", null, { email: "manager@estateops.test", password: "password123" });
  ok((await call("POST", "/api/auth/mfa/verify", null, { mfaToken: r.data.mfaToken, code: rc })).status === 401, "and works only once");
  ok(S.mfaRecoveryLeft(S.findAccountByEmail("manager@estateops.test").id) === 9, "nine recovery codes left");
  ok(S.db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action = 'MFA_RECOVERY_CODE_USED'").get().n === 1, "using one is audited");

  section("Two-factor: guessing is limited");
  RL.reset(); const mcodes = [];
  for (const ip of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) A.clearFailures({ ip }, "mfa:" + S.findAccountByEmail("manager@estateops.test").id);
  for (let i = 0; i < 10; i++) { const l = await call("POST", "/api/auth/login", null, { email: "manager@estateops.test", password: "password123" }); mcodes.push((await call("POST", "/api/auth/mfa/verify", null, { mfaToken: l.data.mfaToken, code: String(100000 + i) })).status); }
  ok(mcodes.slice(0, 8).every((x) => x === 401) && mcodes.slice(8).every((x) => x === 429), `after 8 wrong codes the account is locked for a while (${mcodes})`);
  r = await call("POST", "/api/auth/login", null, { email: "manager@estateops.test", password: "password123" });
  ok((await call("POST", "/api/auth/mfa/verify", null, { mfaToken: r.data.mfaToken, code: recovery[1] })).status === 429, "even a correct recovery code is refused while locked");
  RL.reset(); require("../src/auth").clearFailures({ ip: "::ffff:127.0.0.1" }, "mfa:" + S.findAccountByEmail("manager@estateops.test").id);
  for (const ip of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) A.clearFailures({ ip }, "mfa:" + S.findAccountByEmail("manager@estateops.test").id);

  section("Two-factor: turning it off, and lost phones");
  const mm = (await (async () => { const l = await call("POST", "/api/auth/login", null, { email: "manager@estateops.test", password: "password123" }); return call("POST", "/api/auth/mfa/verify", null, { mfaToken: l.data.mfaToken, code: recovery[2] }); })()).data;
  ok(!!mm.token, "signed in with a recovery code");
  r = await call("POST", "/api/auth/mfa/disable", mm.token, { password: "bad", code: recovery[3] }); ok(r.status === 401, "turning off needs the password");
  r = await call("POST", "/api/auth/mfa/disable", mm.token, { password: "password123", code: "000000" }); ok(r.status === 401, "and a valid code");
  r = await call("POST", `/api/accounts/${acct.id}/mfa-reset`, mm.token); ok(r.status === 204, "a manager can reset a tenant's two-factor (it ends that person's sessions)");
  const other2 = await login("tenant@estateops.test", GOOD);
  r = await call("POST", "/api/auth/mfa/disable", mm.token, { password: "password123", code: recovery[3] }); ok(r.status === 204, "password plus recovery code turns it off");
  ok((await login("manager@estateops.test")).token, "sign-in is password-only again");
  ok(S.db.prepare("SELECT COUNT(*) n FROM mfa_recovery WHERE account_id = ?").get(S.findAccountByEmail("manager@estateops.test").id).n === 0, "recovery codes are deleted");
  // lost phone: an org admin resets a team member
  const adminTok = (await login("manager@estateops.test")).token;
  const tech = S.findAccountByEmail("tech@estateops.test");
  S.mfaBegin(tech.id, TOTP.seal(TOTP.newSecret())); S.mfaEnable(tech.id, 1, [TOTP.hashRecovery("aaaaa-bbbbb")]);
  ok((await call("POST", "/api/auth/login", null, { email: "tech@estateops.test", password: "password123" })).data.mfaRequired === true, "the technician has two-factor on");
  ok((await call("POST", `/api/accounts/${tech.id}/mfa-reset`, adminTok)).status === 204, "a manager resets it for a lost phone");
  ok((await login("tech@estateops.test")).token, "the technician can sign in with the password again");
  ok((await call("POST", `/api/accounts/${tech.id}/mfa-reset`, other2.token)).status === 403, "a tenant cannot reset anyone's two-factor");
  const outsider = S.createAccount({ email: "mgr.b@other.test", passwordHash: A.hash("password123"), fullName: "Other Org", role: "MANAGER", orgId: S.createOrganization("Other").id, orgAdmin: 1, profileComplete: 1 });
  const outTok = (await login("mgr.b@other.test")).token;
  ok((await call("POST", `/api/accounts/${tech.id}/mfa-reset`, outTok)).status === 404, "a manager of another organization cannot reset it (404)");
  void outsider;

  section("Policy: managers must use two-factor");
  config.mfa.requireForManagers = true;
  const pm = await login("manager@estateops.test");
  r = await call("GET", "/api/maintenance-requests", pm.token); ok(r.status === 403 && r.data.code === "MFA_REQUIRED", "an unenrolled manager is blocked from the API");
  r = await call("GET", "/api/auth/me", pm.token); ok(r.status === 200 && r.data.mfaRequired === true, "but can still reach their account (and sees the flag)");
  r = await call("POST", "/api/auth/mfa/setup", pm.token, { password: "password123" }); ok(r.status === 200, "and can enrol");
  const ps = r.data.secret; RL.reset();
  r = await call("POST", "/api/auth/mfa/enable", pm.token, { code: TOTP.code(TOTP.unbase32(ps), TOTP.stepAt()) }); ok(r.status === 200, "enrolled");
  ok((await call("GET", "/api/maintenance-requests", pm.token)).status === 200, "after enrolling the API opens");
  ok((await call("GET", "/api/maintenance-requests", (await login("tenant@estateops.test", GOOD)).token)).status === 200, "tenants are not affected");
  config.mfa.requireForManagers = false;

  section("Sign-out and auditing");
  ok(S.db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action IN ('MFA_ENABLED','MFA_DISABLED','MFA_RESET','SIGNED_OUT_EVERYWHERE')").get().n >= 4, "enable, disable, reset and sign-out-everywhere are audited");
  const dump = JSON.stringify(S.db.prepare("SELECT * FROM audit_log").all());
  ok(!dump.includes(secret) && !recovery.some((x) => dump.includes(x)), "no secret or recovery code appears in the audit log");

  server.close(); T.done();
})().catch((e) => { console.error(e); process.exit(1); });
