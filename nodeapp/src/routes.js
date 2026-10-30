"use strict";
const express = require("express");
const crypto = require("crypto");
const S = require("./store");
const V = require("./views");
const A = require("./auth");
const AI = require("./ai");
const F = require("./files");
const Scan = require("./scan");
const Mailer = require("./mailer");
const TOTP = require("./totp");
const Privacy = require("./privacy");
const config = require("./config");
const R = require("./rules");

const router = express.Router();
const C = require("./cache");
const RL = require("./ratelimit");
const PW = require("./passwords");
/** Budgets per client address. Only failures count for guessable secrets, so busy offices behind one address are not locked out. */
const limit = {
  register: RL.limiter("register", { windowMs: config.rateLimits.registerWindowMin * 60e3, max: config.rateLimits.registerMax }),
  login:    RL.limiter("login",    { windowMs: config.rateLimits.windowMin * 60e3, max: config.rateLimits.loginMax, count: "failures" }),
  setup:    RL.limiter("setup",    { windowMs: config.rateLimits.windowMin * 60e3, max: config.rateLimits.setupMax, count: "failures" }),
  token:    RL.limiter("token",    { windowMs: config.rateLimits.windowMin * 60e3, max: config.rateLimits.tokenMax, count: "failures" }),
  mfa:      RL.limiter("mfa",      { windowMs: config.rateLimits.windowMin * 60e3, max: config.rateLimits.mfaMax, count: "failures" }),
  forgot:   RL.limiter("forgot",   { windowMs: config.rateLimits.windowMin * 60e3, max: config.rateLimits.forgotMax }),          // every request counts: it can send mail
  forgotEmail: RL.limiter("forgot-email", { windowMs: 3600e3, max: config.rateLimits.forgotEmailMax, by: (req) => String((req.body && req.body.email) || "").trim().toLowerCase().slice(0, 190) }),
  resend:   RL.limiter("resend",   { windowMs: 3600e3, max: 3, by: (req) => "acct" + req.account.id }),
  password: RL.limiter("password", { windowMs: config.rateLimits.windowMin * 60e3, max: config.rateLimits.passwordMax, count: "failures", by: (req) => "acct" + req.account.id }),
};
router.use(C.invalidateOnWrite);   // every successful write bumps the cache version before the response is sent

/* ---------- helpers ---------- */
class Fail extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}
const bad      = (m) => new Fail(400, m);
const denied   = ()  => new Fail(403, "You do not have access to this record.");
const missing  = (w) => new Fail(404, `${w} was not found.`);
const conflict = (m) => new Fail(409, m);

const wrap = (fn) => (req, res, next) => {
  Promise.resolve().then(() => fn(req, res, next)).catch(next);
};

function str(value, field, max, required = true) {
  const v = (value == null ? "" : String(value)).trim();
  if (!v) { if (required) throw bad(`${field} is required.`); return null; }
  if (v.length > max) throw bad(`${field} must be ${max} characters or fewer.`);
  return v;
}
function oneOf(value, allowed, field, fallback) {
  if (value == null || value === "") return fallback;
  const v = String(value).toUpperCase();
  if (!allowed.includes(v)) throw bad(`${field} must be one of: ${allowed.join(", ")}.`);
  return v;
}
function emailOf(value) {
  const email = str(value, "Email", 190).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad("That email address does not look right.");
  return email;
}
function passwordOf(value, who = "your password", ctx) {
  const p = String(value || "");
  if (p.length < config.auth.passwordMinLength) throw bad(`Use at least ${config.auth.passwordMinLength} characters for ${who}.`);
  if (p.length > 200) throw bad("That password is too long.");
  const weak = PW.weakness(p, ctx);
  if (weak) throw bad(weak);
  return p;
}
/** An optional calendar date written YYYY-MM-DD. Anything else (or a date that does not exist, such as 2026-02-31) is refused. */
function dateOf(value, field) {
  const v = str(value, field, 10, false);
  if (v === null) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v), d = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (!m || d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) throw bad(`${field} must be a real date written as YYYY-MM-DD.`);
  return v;
}
function centsOf(value, what) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw bad(`${what} must be greater than zero.`);
  if (n > config.maxAmount) throw bad(`${what} is too large.`);
  return Math.round(n * 100);
}
const nice = (v) => String(v).replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());
const authBody = (a, req) => ({ token: A.issue(a, req), email: a.email, fullName: a.full_name, role: a.role, accountId: a.id, emailVerified: !!a.email_verified });
const sameKey = (a, b) => {
  const x = Buffer.from(String(a || "")), y = Buffer.from(String(b || ""));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const needOrg = (account) => { if (!account.org_id) throw denied(); return account.org_id; };

function loadVisibleRequest(account, id) {
  const r = S.findRequest(Number(id));
  if (!r) throw missing("That request");
  if (!R.mayView(account, r)) throw denied();
  return r;
}
/** Scoped lookups: another organization's record is reported as not found. */
function orgUnit(account, id) {
  const u = S.findUnit(Number(id));
  if (!u || u.org_id !== account.org_id) throw missing("That unit");
  return u;
}
function orgVendor(account, id) {
  const v = S.findVendor(Number(id));
  if (!v || v.org_id !== account.org_id) throw missing("That vendor");
  return v;
}
function orgAccount(account, id) {
  const a = S.findAccount(Number(id));
  if (!a || a.org_id !== account.org_id) throw missing("That account");
  return a;
}
/** Everyone who should hear about a change on a request, except the person who made it. */
function participants(r, exceptId) {
  const ids = new Set([r.reporter_id]);
  if (r.technician_id) ids.add(r.technician_id);
  if (r.vendor_id) S.db.prepare("SELECT id FROM accounts WHERE vendor_id = ? AND active = 1").all(r.vendor_id).forEach((a) => ids.add(a.id));
  S.managersOf(r.org_id).forEach((m) => ids.add(m.id));
  ids.delete(exceptId);
  return [...ids];
}
const tell = (r, exceptId, message) => participants(r, exceptId).forEach((id) => S.notify(id, message, r.id));

/* ================= first-run setup ================= */
router.get("/setup/status", C.route("global"), wrap((req, res) =>
  res.json({ needsSetup: S.countAccounts() === 0, requiresSetupKey: config.production, selfRegistration: config.selfRegistration })));

router.post("/setup", limit.setup, wrap((req, res) => {
  if (S.countAccounts() > 0) throw conflict("Setup has already been completed.");
  if (config.production && !(config.setupKey && sameKey(req.body.setupKey, config.setupKey))) {
    throw new Fail(403, "The setup key is missing or wrong.");
  }
  const email = emailOf(req.body.email);
  const password = passwordOf(req.body.password, "your password", { email, name: req.body.fullName });
  const fullName = str(req.body.fullName, "Full name", 120);
  const orgName = str(req.body.organizationName, "Organization name", 160);
  const account = S.db.transaction(() => {
    if (S.countAccounts() > 0) throw conflict("Setup has already been completed.");
    const org = S.createOrganization(orgName);
    const a = S.createAccount({ email, passwordHash: A.hash(password), fullName, role: "MANAGER",
                                orgId: org.id, orgAdmin: 1, profileComplete: 1 });
    S.audit(a, "SETUP_COMPLETED", "organization", org.id, orgName);
    return a;
  })();
  res.status(201).json(authBody(A.loadAccount(account.id), req));
}));

/* ================= authentication ================= */
router.post("/auth/register", limit.register, wrap((req, res) => {
  if (!config.selfRegistration) throw new Fail(403, "Sign-up is switched off for this installation. Ask your property manager for an invitation.");
  const email = emailOf(req.body.email);
  const password = passwordOf(req.body.password, "your password", { email, name: req.body.fullName });
  const fullName = str(req.body.fullName, "Full name", 120);
  // Self-registration is tenant-only. Any role in the body is ignored. The tenant has no access
  // to any unit until a manager links them or they accept an invitation.
  if (S.findAccountByEmail(email)) throw conflict("That email is already registered. Switch to Sign in.");
  const a = S.createAccount({ email, passwordHash: A.hash(password), fullName, role: "TENANT", emailVerified: 0 });
  sendVerification(a);
  res.status(201).json(authBody(a, req));
}));

/** Emails a fresh verification link (fire and forget: mail trouble must never fail the request). */
function sendVerification(a) {
  if (!config.mail.enabled || a.email_verified) return;
  const token = A.newToken();
  S.createAccountToken(a.id, "VERIFY", A.hashToken(token), config.verifyLinkHours);
  Mailer.sendTemplate("verify", { to: a.email, name: a.full_name, token, hours: config.verifyLinkHours });
}

/* ---- self-service password reset and email verification (links are emailed; tokens are single-use, stored as hashes) ---- */
router.post("/auth/forgot-password", limit.forgot, limit.forgotEmail, wrap((req, res) => {
  const email = str(req.body.email, "Email", 190).toLowerCase();
  const a = A.loadAccountByEmail(email);
  if (a && a.active && config.mail.enabled) {
    const token = A.newToken();
    S.createAccountToken(a.id, "RESET", A.hashToken(token), config.auth.resetLinkHours);
    S.audit(a, "PASSWORD_RESET_REQUESTED", "account", a.id, null);
    Mailer.sendTemplate("forgot", { to: a.email, name: a.full_name, token, hours: config.auth.resetLinkHours });
  }
  // The same answer whether or not the address has an account: this endpoint must not reveal who is registered.
  res.status(202).json({ message: "If that email belongs to an account, a link to choose a new password is on its way." });
}));

router.post("/auth/reset-password", limit.token, wrap((req, res) => {
  const t = S.findAccountToken(A.hashToken(String(req.body.token || "")), "RESET");
  const a = t && S.findAccount(t.account_id);
  if (!t || !a || !a.active) throw new Fail(404, "This link is not valid or has expired. Ask for a new one.");
  const password = passwordOf(req.body.password, "your password", { email: a.email, name: a.full_name });
  S.db.transaction(() => {
    if (!S.useAccountToken(t.id)) throw new Fail(404, "This link is not valid or has expired. Ask for a new one.");
    S.setPassword(a.id, A.hash(password));        // also ends every session this account holds
    S.markEmailVerified(a.id);                     // opening a link sent to the address proves it
    S.audit(a, "PASSWORD_RESET_COMPLETED", "account", a.id, "self-service");
  })();
  res.status(204).end();
}));

router.post("/auth/verify-email", limit.token, wrap((req, res) => {
  const t = S.findAccountToken(A.hashToken(String(req.body.token || "")), "VERIFY");
  if (!t) throw new Fail(404, "This link is not valid or has expired. Sign in and ask for a new one.");
  S.db.transaction(() => {
    if (!S.useAccountToken(t.id)) throw new Fail(404, "This link is not valid or has expired. Sign in and ask for a new one.");
    S.markEmailVerified(t.account_id);
    S.audit(S.findAccount(t.account_id), "EMAIL_VERIFIED", "account", t.account_id, null);
  })();
  res.status(204).end();
}));

router.post("/auth/login", limit.login, wrap(async (req, res) => {
  const email = str(req.body.email, "Email", 190).toLowerCase();
  const password = String(req.body.password || "");
  if (A.throttled(req, email)) throw new Fail(429, "Too many attempts. Wait a few minutes and try again.");
  const a = A.loadAccountByEmail(email);
  const good = await A.verifyAsync(password, a ? a.password_hash : A.DUMMY_HASH);   // always pay for one hash check: unknown emails must not answer faster
  if (!a || !good) {
    A.recordFailure(req, email);
    throw new Fail(401, "Wrong email or password.");
  }
  if (!a.active) throw new Fail(403, "This account has been deactivated.");
  A.clearFailures(req, email);
  if (a.mfa_enabled) return res.json({ mfaRequired: true, mfaToken: A.issueMfaToken(a) });   // password was right; the second factor decides
  res.json(authBody(a, req));
}));

/* ---- invitations: the only way staff, vendors and extra managers get an account ---- */
function validInvitation(token) {
  const inv = S.findInvitationByHash(A.hashToken(token || ""));
  if (!inv || inv.accepted_at || inv.revoked_at || inv.expires_at <= S.now()) {
    throw new Fail(404, "This invitation link is not valid or has expired.");
  }
  return inv;
}
router.get("/invitations/lookup", limit.token, wrap((req, res) => {
  const inv = validInvitation(req.query.token);
  res.json({ email: inv.email, role: inv.role, kind: inv.kind, organizationName: inv.org_name,
             vendorName: inv.vendor_name || null,
             unit: inv.unit_label ? `${inv.property_name} ${inv.unit_label}` : null });
}));

router.post("/invitations/accept", limit.token, wrap((req, res) => {
  const inv = validInvitation(req.body.token);
  const password = passwordOf(req.body.password, "your password", { email: inv.email, name: req.body.fullName });
  const result = S.db.transaction(() => {
    if (inv.kind === "RESET") {
      const target = S.findAccount(inv.account_id);
      if (!target || !target.active) throw new Fail(404, "This invitation link is not valid or has expired.");
      S.setPassword(target.id, A.hash(password));
      S.acceptInvitation(inv.id);
      S.audit(target, "PASSWORD_RESET_COMPLETED", "account", target.id, null);
      return target;
    }
    if (S.findAccountByEmail(inv.email)) throw conflict("An account with this email already exists. Sign in instead.");
    const fullName = str(req.body.fullName, "Full name", 120);
    const a = S.createAccount({
      email: inv.email, passwordHash: A.hash(password), fullName, role: inv.role,
      orgId: inv.org_id, vendorId: inv.role === "VENDOR" ? inv.vendor_id : null,
      phone: str(req.body.phone, "Phone", 40, false),
      skills: inv.role === "TECHNICIAN" ? str(req.body.skills, "Skills", 200, false) : null,
      profileComplete: 1,
    });
    if (inv.role === "TENANT" && inv.unit_id) S.assignTenantToUnit(a.id, inv.unit_id);
    S.acceptInvitation(inv.id);
    S.audit(a, "INVITATION_ACCEPTED", "account", a.id, inv.role);
    S.managersOf(inv.org_id).forEach((m) => S.notify(m.id, `${fullName} accepted the invitation and joined as ${inv.role.toLowerCase()}.`, null));
    return a;
  })();
  res.status(201).json(authBody(A.loadAccount(result.id), req));
}));

router.post("/auth/mfa/verify", limit.mfa, wrap((req, res) => {
  const uid = A.readMfaToken(req.body.mfaToken);
  const a = uid && A.loadAccount(uid);
  if (!a || !a.active || !a.mfa_enabled) throw new Fail(401, "Sign in again.");
  const key = "mfa:" + a.id;
  if (A.throttled(req, key)) throw new Fail(429, "Too many attempts. Wait a few minutes and try again.");
  if (!secondFactorOk(a, req.body.code)) { A.recordFailure(req, key); throw new Fail(401, "That code is not right. Check the time on your phone and try again."); }
  A.clearFailures(req, key);
  if (TOTP.looksLikeRecovery(req.body.code)) S.audit(a, "MFA_RECOVERY_CODE_USED", "account", a.id, `${S.mfaRecoveryLeft(a.id)} left`);
  res.json(authBody(a, req));
}));

router.use(A.authenticate);
   // everything below requires a valid, current token

router.get("/auth/me", wrap((req, res) => res.json(V.meView(req.account))));

router.post("/auth/resend-verification", limit.resend, wrap((req, res) => {
  if (req.account.email_verified) return res.status(204).end();
  if (!config.mail.enabled) throw new Fail(409, "Email is not switched on for this installation.");
  sendVerification(req.account);
  res.status(202).json({ message: "A new verification link is on its way." });
}));

/** Second-factor policy: with MFA_REQUIRED_FOR_MANAGERS=1 a manager who has not enrolled can reach only the account/sign-in endpoints. */
router.use((req, res, next) => {
  const a = req.account;
  if (config.mfa.requireForManagers && a.role === "MANAGER" && !a.mfa_enabled && !req.path.startsWith("/auth/")
      && !(config.loadtest.enabled && /^loadtest-[a-z]+-\d+-o\d+@loadtest\.invalid$/.test(a.email))) {
    return res.status(403).json({ timestamp: new Date().toISOString(), status: 403, code: "MFA_REQUIRED",
      message: "Managers must turn on two-factor sign-in before using EstateOps. Open Account and set it up." });
  }
  next();
});

router.post("/auth/logout", wrap((req, res) => {
  S.revokeSession(req.session.id, req.account.id);   // this device only; the others stay signed in
  res.status(204).end();
}));
router.post("/auth/logout-all", wrap((req, res) => {
  S.bumpTokenVersion(req.account.id);                // every token this account holds stops working
  S.revokeAccountSessions(req.account.id);
  S.audit(req.account, "SIGNED_OUT_EVERYWHERE", "account", req.account.id, null);
  res.status(204).end();
}));
router.get("/auth/sessions", wrap((req, res) => res.json(S.activeSessions(req.account.id).map((s) => ({
  id: s.id, current: s.id === req.session.id, createdAt: s.created_at, lastSeenAt: s.last_seen_at, expiresAt: s.expires_at,
  device: s.user_agent || null, ip: s.ip || null })))));
router.post("/auth/sessions/:id/revoke", wrap((req, res) => {
  if (!S.revokeSession(Number(req.params.id), req.account.id)) throw missing("That session");
  res.status(204).end();
}));

/* ---- two-factor sign-in (authenticator app) ---- */
/** True when `code` is a current authenticator code or an unused recovery code. Each can be used once. */
function secondFactorOk(account, code) {
  if (TOTP.looksLikeRecovery(code)) return S.mfaUseRecovery(account.id, TOTP.hashRecovery(code));
  const step = TOTP.verify(TOTP.open(account.mfa_secret), code);
  return step !== null && S.mfaClaimStep(account.id, step);
}
const wrongCode = () => new Fail(401, "That code is not right. Check the time on your phone and try again.");
router.post("/auth/mfa/setup", limit.password, wrap(async (req, res) => {
  if (req.account.mfa_enabled) throw conflict("Two-factor sign-in is already on. Turn it off first to set it up again.");
  if (!(await A.verifyAsync(String(req.body.password || ""), req.account.password_hash))) throw new Fail(401, "Your password is wrong.");
  const secret = TOTP.newSecret();
  S.mfaBegin(req.account.id, TOTP.seal(secret));
  res.json({ secret, otpauthUrl: TOTP.otpauthUrl(secret, req.account.email) });
}));
router.post("/auth/mfa/enable", limit.password, wrap((req, res) => {
  const a = A.loadAccount(req.account.id);
  if (a.mfa_enabled) throw conflict("Two-factor sign-in is already on.");
  if (!a.mfa_secret) throw bad("Start the setup first.");
  const step = TOTP.verify(TOTP.open(a.mfa_secret), req.body.code);
  if (step === null) throw wrongCode();
  const codes = TOTP.newRecoveryCodes();
  S.mfaEnable(a.id, step, codes.map(TOTP.hashRecovery));
  S.audit(a, "MFA_ENABLED", "account", a.id, null);
  res.json({ recoveryCodes: codes });
}));
router.post("/auth/mfa/disable", limit.password, wrap(async (req, res) => {
  const a = A.loadAccount(req.account.id);
  if (!a.mfa_enabled) throw conflict("Two-factor sign-in is not on.");
  if (!(await A.verifyAsync(String(req.body.password || ""), a.password_hash))) throw new Fail(401, "Your password is wrong.");
  if (!secondFactorOk(a, req.body.code)) throw wrongCode();
  S.mfaDisable(a.id); S.revokeAccountSessions(a.id, req.session.id);
  S.audit(a, "MFA_DISABLED", "account", a.id, null);
  res.status(204).end();
}));
router.post("/accounts/:id/mfa-reset", A.requireRole("MANAGER"), wrap((req, res) => {
  const target = orgAccount(req.account, req.params.id);
  if (target.id === req.account.id) throw bad("Use Turn off two-factor on your Account page.");
  if (target.role === "MANAGER" && !req.account.org_admin) throw denied();
  S.mfaDisable(target.id); S.revokeAccountSessions(target.id);
  S.audit(req.account, "MFA_RESET", "account", target.id, target.email);
  res.status(204).end();
}));


router.post("/auth/change-password", limit.password, wrap(async (req, res) => {
  if (!(await A.verifyAsync(String(req.body.currentPassword || ""), req.account.password_hash))) {
    throw new Fail(401, "Your current password is wrong.");
  }
  S.setPassword(req.account.id, A.hash(passwordOf(req.body.newPassword, "the new password", { email: req.account.email, name: req.account.full_name })));
  S.audit(req.account, "PASSWORD_CHANGED", "account", req.account.id, null);
  res.json({ token: A.issue(A.loadAccount(req.account.id), req) });   // other sessions are signed out
}));

/* ---- your personal data (DPDP / GDPR): a copy of everything, and erasure ---- */
router.get("/auth/my-data", wrap((req, res) => {
  const data = Privacy.exportAccount(req.account.id);
  S.audit(req.account, "DATA_EXPORTED", "account", req.account.id, null);
  res.set("Content-Disposition", `attachment; filename="estateops-my-data-${req.account.id}.json"`);
  res.json(data);
}));

router.post("/auth/delete-account", limit.password, wrap(async (req, res) => {
  if (!(await A.verifyAsync(String(req.body.password || ""), req.account.password_hash))) throw new Fail(401, "Your password is wrong.");
  if (String(req.body.confirm || "").trim().toUpperCase() !== "DELETE") throw bad('Type DELETE to confirm that you want your account erased.');
  if (req.account.role === "MANAGER" && req.account.org_admin
      && S.accountsByRole(req.account.org_id, "MANAGER").filter((m) => m.org_admin && m.active).length === 1) {
    throw conflict("You are the only administrator of this organization. Make someone else an administrator first.");
  }
  Privacy.eraseAccount(req.account.id, req.account);
  res.status(204).end();
}));

router.post("/accounts/:id/erase", A.requireRole("MANAGER"), wrap((req, res) => {
  const target = orgAccount(req.account, req.params.id);
  if (target.id === req.account.id) throw bad("Use Delete my account on your own Account page.");
  if (target.role === "MANAGER" && !req.account.org_admin) throw denied();
  if (target.active) throw conflict("Deactivate the account first, so nobody loses access unexpectedly.");
  if (String(req.body.confirm || "").trim().toUpperCase() !== "ERASE") throw bad('Type ERASE to confirm. This removes the person\'s name and contact details for good.');
  const out = Privacy.eraseAccount(target.id, req.account);
  res.json({ id: target.id, erased: true, already: !!out.already });
}));

router.put("/auth/profile", wrap((req, res) => {
  S.updateProfile(req.account.id, str(req.body.fullName, "Full name", 120),
    str(req.body.phone, "Phone", 40, false),
    req.account.role === "TECHNICIAN" ? str(req.body.skills, "Skills", 200, false) : req.account.skills);
  res.json(V.meView(A.loadAccount(req.account.id)));
}));

/* ================= organization and people (manager) ================= */
router.get("/organization", A.requireRole("MANAGER"), C.route("org", { vary: (r) => (r.account.org_admin ? "admin" : "") }), wrap((req, res) => {
  const o = S.findOrganization(needOrg(req.account));
  res.json({ name: o.name, approvalLimit: o.approval_limit_cents == null ? null : V.money(o.approval_limit_cents),
             isAdmin: !!req.account.org_admin });
}));
router.put("/organization", A.requireRole("MANAGER"), wrap((req, res) => {
  if (!req.account.org_admin) throw denied();
  const name = str(req.body.name, "Organization name", 160);
  const limit = req.body.approvalLimit == null || req.body.approvalLimit === ""
    ? null : centsOf(req.body.approvalLimit, "The approval limit");
  S.updateOrganization(req.account.org_id, name, limit);
  S.audit(req.account, "ORGANIZATION_UPDATED", "organization", req.account.org_id, `limit=${limit}`);
  res.json({ name, approvalLimit: limit == null ? null : V.money(limit), isAdmin: true });
}));

router.get("/team", A.requireRole("MANAGER"), C.route("org"), wrap((req, res) =>
  res.json(S.teamOf(needOrg(req.account)).map(V.teamView))));
router.get("/technicians", A.requireRole("MANAGER"), C.route("org"), wrap((req, res) =>
  res.json(S.accountsByRole(needOrg(req.account), "TECHNICIAN").map((a) => ({ ...V.accountView(a), skills: a.skills || null })))));
router.get("/tenants", A.requireRole("MANAGER"), C.route("org"), wrap((req, res) =>
  res.json(S.accountsByRole(needOrg(req.account), "TENANT").map(V.accountView))));

/** Rules shared by direct account creation and invitations. */
function checkProvisionable(actor, role, vendorId) {
  if (!R.INVITABLE.includes(role)) throw bad(`Role must be one of: ${R.INVITABLE.join(", ")}.`);
  if (role === "MANAGER" && !actor.org_admin) {
    throw new Fail(403, "Only an organization admin can add another manager.");
  }
  if (role === "VENDOR") {
    if (!vendorId) throw bad("Choose the vendor company this person works for.");
    const v = orgVendor(actor, vendorId);
    if (v.status === "INACTIVE") throw bad("That vendor is inactive.");
    return v;
  }
  return null;
}

router.post("/accounts", A.requireRole("MANAGER"), wrap((req, res) => {
  const orgId = needOrg(req.account);
  const email = emailOf(req.body.email);
  const password = passwordOf(req.body.password, "the password", { email, name: req.body.fullName });
  const fullName = str(req.body.fullName, "Full name", 120);
  const role = oneOf(req.body.role, R.INVITABLE, "Role", null);
  if (!role) throw bad("A role is required.");
  const vendor = checkProvisionable(req.account, role, req.body.vendorId);
  if (S.findAccountByEmail(email)) throw conflict("That email is already registered.");
  const a = S.createAccount({ email, passwordHash: A.hash(password), fullName, role, orgId,
                              vendorId: vendor ? vendor.id : null,
                              skills: role === "TECHNICIAN" ? str(req.body.skills, "Skills", 200, false) : null });
  S.audit(req.account, "ACCOUNT_CREATED", "account", a.id, `${role} ${email}`);
  res.status(201).json(V.accountView(a));
}));

router.post("/accounts/:id/status", A.requireRole("MANAGER"), wrap((req, res) => {
  const target = orgAccount(req.account, req.params.id);
  if (target.id === req.account.id) throw bad("You cannot deactivate your own account.");
  if (target.role === "MANAGER" && !req.account.org_admin) throw denied();
  if (typeof req.body.active !== "boolean") throw bad("active must be true or false.");
  S.setAccountActive(target.id, req.body.active);
  S.audit(req.account, req.body.active ? "ACCOUNT_REACTIVATED" : "ACCOUNT_DEACTIVATED", "account", target.id, target.email);
  res.json({ id: target.id, active: req.body.active });
}));

router.post("/accounts/:id/reset-link", A.requireRole("MANAGER"), wrap(async (req, res) => {
  const target = orgAccount(req.account, req.params.id);
  if (target.id === req.account.id) throw bad("Use Change password for your own account.");
  if (target.role === "MANAGER" && !req.account.org_admin) throw denied();
  const token = A.newToken();
  const inv = S.createInvitation({ tokenHash: A.hashToken(token), kind: "RESET", email: target.email, role: target.role,
    orgId: req.account.org_id, accountId: target.id, invitedBy: req.account.id,
    expiresAt: new Date(Date.now() + config.auth.resetLinkHours * 3600000).toISOString() });
  S.audit(req.account, "PASSWORD_RESET_ISSUED", "account", target.id, target.email);
  const mailed = await Mailer.sendTemplate("managerReset", { to: target.email, name: target.full_name, token, hours: config.auth.resetLinkHours });
  res.status(201).json({ ...V.invitationView(inv), token, path: `/accept.html?token=${token}`, emailed: mailed.delivered });
}));

router.get("/invitations", A.requireRole("MANAGER"), wrap((req, res) =>
  res.json(S.pendingInvitations(needOrg(req.account)).map(V.invitationView))));

router.post("/invitations", A.requireRole("MANAGER"), wrap(async (req, res) => {
  const orgId = needOrg(req.account);
  const email = emailOf(req.body.email);
  const role = oneOf(req.body.role, R.INVITABLE, "Role", null);
  if (!role) throw bad("A role is required.");
  const vendor = checkProvisionable(req.account, role, req.body.vendorId);
  let unit = null;
  if (req.body.unitId) {
    if (role !== "TENANT") throw bad("Only a tenant invitation can include a unit.");
    unit = orgUnit(req.account, req.body.unitId);
  }
  if (S.findAccountByEmail(email)) throw conflict("That email already has an account.");
  S.pendingInvitations(orgId).filter((i) => i.email.toLowerCase() === email && i.kind === "INVITE")
    .forEach((i) => S.revokeInvitation(i.id));
  const token = A.newToken();
  const inv = S.createInvitation({ tokenHash: A.hashToken(token), email, role, orgId,
    unitId: unit && unit.id, vendorId: vendor && vendor.id, invitedBy: req.account.id,
    expiresAt: new Date(Date.now() + config.inviteTtlDays * 86400000).toISOString() });
  S.audit(req.account, "INVITATION_CREATED", "invitation", inv.id, `${role} ${email}`);
  const org = S.db.prepare("SELECT name FROM organizations WHERE id = ?").get(orgId);
  const mailed = await Mailer.sendTemplate("invitation", { to: email, orgName: org.name, role, token, days: config.inviteTtlDays });
  res.status(201).json({ ...V.invitationView(S.pendingInvitations(orgId).find((i) => i.id === inv.id)),
                         token, path: `/accept.html?token=${token}`, emailed: mailed.delivered });
}));

router.post("/invitations/:id/revoke", A.requireRole("MANAGER"), wrap((req, res) => {
  const inv = S.findInvitation(Number(req.params.id));
  if (!inv || inv.org_id !== req.account.org_id) throw missing("That invitation");
  S.revokeInvitation(inv.id);
  S.audit(req.account, "INVITATION_REVOKED", "invitation", inv.id, inv.email);
  res.status(204).end();
}));

/* ================= vendors ================= */
const categoriesOf = (v) => {
  const list = Array.isArray(v) ? v : String(v || "").split(",");
  const out = [...new Set(list.map((x) => String(x).trim().toUpperCase()).filter(Boolean))];
  for (const c of out) if (!R.CATEGORIES.includes(c)) throw bad(`Unknown service category ${c}.`);
  return out.join(",");
};
router.get("/vendors", A.requireRole("MANAGER"), C.route("org"), wrap((req, res) =>
  res.json(S.vendorsOf(needOrg(req.account), oneOf(req.query.status, R.VENDOR_STATUSES, "Status", null)).map(V.vendorView))));

router.post("/vendors", A.requireRole("MANAGER"), wrap((req, res) => {
  const orgId = needOrg(req.account);
  const name = str(req.body.name, "Vendor name", 160);
  if (S.vendorNameTaken(orgId, name)) throw conflict(`A vendor called ${name} already exists.`);
  const v = S.createVendor({ orgId, name, contactEmail: emailOf(req.body.contactEmail),
    phone: str(req.body.phone, "Phone", 40, false), categories: categoriesOf(req.body.categories), status: "PENDING" });
  S.audit(req.account, "VENDOR_CREATED", "vendor", v.id, name);
  res.status(201).json(V.vendorView({ ...v, member_count: 0, open_jobs: 0 }));
}));

router.post("/vendors/:id/status", A.requireRole("MANAGER"), wrap((req, res) => {
  const v = orgVendor(req.account, req.params.id);
  const status = oneOf(req.body.status, R.VENDOR_STATUSES, "Status", null);
  if (!status) throw bad("A status is required.");
  S.setVendorStatus(v.id, status);
  S.audit(req.account, "VENDOR_STATUS_CHANGED", "vendor", v.id, `${v.status} -> ${status}`);
  S.db.prepare("SELECT id FROM accounts WHERE vendor_id = ? AND active = 1").all(v.id)
    .forEach((a) => S.notify(a.id, `${v.name} is now ${status.toLowerCase()}.`, null));
  res.json(V.vendorView(S.vendorsOf(req.account.org_id, null, true).find((x) => x.id === v.id)));
}));

router.get("/vendors/me", A.requireRole("VENDOR"), wrap((req, res) => {
  const v = S.vendorsOf(S.findVendor(req.account.vendor_id).org_id, null, true).find((x) => x.id === req.account.vendor_id);
  res.json(V.vendorView(v));
}));
router.put("/vendors/me", A.requireRole("VENDOR"), wrap((req, res) => {
  const v = S.findVendor(req.account.vendor_id);
  S.updateVendorProfile(v.id, str(req.body.phone, "Phone", 40, false), categoriesOf(req.body.categories));
  res.json(V.vendorView(S.vendorsOf(v.org_id, null, true).find((x) => x.id === v.id)));
}));

/* ================= properties and units ================= */
router.get("/properties", A.requireRole("MANAGER"), C.route("org"), wrap((req, res) =>
  res.json(S.listProperties(needOrg(req.account)).map(V.propertyView))));

router.post("/properties", A.requireRole("MANAGER"), wrap((req, res) => {
  const orgId = needOrg(req.account);
  const p = S.createProperty({ name: str(req.body.name, "Property name", 160),
    address: str(req.body.address, "Address", 255, false),
    propertyType: str(req.body.propertyType, "Type", 40, false) || "complex",
    managerId: req.account.id, orgId });
  S.audit(req.account, "PROPERTY_CREATED", "property", p.id, p.name);
  res.status(201).json(V.propertyView(p));
}));

router.get("/properties/:id/units", A.requireRole("MANAGER"), C.route("org"), wrap((req, res) => {
  const p = S.findProperty(Number(req.params.id));
  if (!p || p.org_id !== req.account.org_id) throw missing("That property");
  res.json(S.unitsOfProperty(p.id).map((u) => V.unitView(u, true)));
}));

router.post("/units", A.requireRole("MANAGER"), wrap((req, res) => {
  const p = S.findProperty(Number(req.body.propertyId));
  if (!p || p.org_id !== req.account.org_id) throw missing("That property");
  const label = str(req.body.label, "Unit label", 40);
  if (S.unitLabelTaken(p.id, label)) throw conflict(`A unit called ${label} already exists in this property.`);
  const u = S.createUnit(p.id, label);
  S.audit(req.account, "UNIT_CREATED", "unit", u.id, `${p.name} ${label}`);
  res.status(201).json(V.unitView(u));
}));

router.get("/units/reportable", A.requireRole("MANAGER", "TENANT"), C.route("scoped"), wrap((req, res) => {
  const list = req.account.role === "MANAGER" ? S.allActiveUnits(needOrg(req.account)) : S.unitsForTenant(req.account.id);
  res.json(list.map((u) => V.unitView(u)));
}));

/** Manager approval of tenancy: link an existing tenant account (found by email) to a unit. */
router.post("/units/:unitId/tenants", A.requireRole("MANAGER"), wrap((req, res) => {
  const unit = orgUnit(req.account, req.params.unitId);
  const tenant = S.findAccountByEmail(emailOf(req.body.email));
  if (!tenant || tenant.role !== "TENANT" || !tenant.active) {
    throw new Fail(404, "No tenant account uses that email. Send them an invitation instead.");
  }
  if (tenant.org_id && tenant.org_id !== req.account.org_id) {
    throw conflict("That tenant already belongs to a different organization.");
  }
  if (config.requireEmailVerification && !tenant.email_verified) {
    throw conflict("That tenant has not confirmed their email address yet, so they cannot be linked by email. Send them an invitation instead.");
  }
  S.db.transaction(() => {
    if (!tenant.org_id) S.setAccountOrg(tenant.id, req.account.org_id);
    S.assignTenantToUnit(tenant.id, unit.id);
  })();
  S.audit(req.account, "TENANT_LINKED", "unit", unit.id, `${tenant.email} -> ${unit.property_name} ${unit.label}`);
  S.notify(tenant.id, `You were added to ${unit.property_name} ${unit.label}. You can now report issues for it.`, null);
  res.status(204).end();
}));

/* ================= maintenance requests ================= */
router.get("/maintenance-requests", C.route("scoped", { ttl: 15 }), wrap((req, res) => {
  const q = String(req.query.q || "").trim().slice(0, 100);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || config.paging.defaultSize, 1), config.paging.maxSize);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  const { rows, total } = S.listRequests(req.account, {
    status: oneOf(req.query.status, Object.keys(R.TRANSITIONS), "Status", null),
    priority: oneOf(req.query.priority, R.PRIORITIES, "Priority", null),
    category: oneOf(req.query.category, R.CATEGORIES, "Category", null),
    q: q || null, limit, offset });
  res.set("X-Total-Count", String(total));
  res.json(rows.map((x) => V.requestView(x, req.account)));
}));

router.post("/maintenance-requests", A.requireRole("TENANT", "MANAGER"), wrap((req, res) => {
  const account = req.account;
  const unit = S.findUnit(Number(req.body.unitId));
  if (!unit) throw missing("That unit");
  if (account.role === "MANAGER" ? unit.org_id !== account.org_id : !S.tenantHasUnit(account.id, unit.id)) {
    throw account.role === "MANAGER" ? missing("That unit") : denied();
  }
  if (!unit.active) throw bad("That unit is deactivated and cannot take new requests.");

  const created = S.createRequest({
    unitId: unit.id, reporterId: account.id,
    title: str(req.body.title, "Title", 160),
    description: str(req.body.description, "Description", 4000),
    category: oneOf(req.body.category, R.CATEGORIES, "Category", "OTHER"),
    priority: oneOf(req.body.priority, R.PRIORITIES, "Priority", "MEDIUM"),
  });
  S.addEvent(created.id, account.id, null, "REPORTED", "Request raised");
  S.managersOf(unit.org_id).filter((m) => m.id !== account.id)
    .forEach((m) => S.notify(m.id, `New request: ${created.title} (${unit.property_name} ${unit.label})`, created.id));
  res.status(201).json(V.requestView(created, account));
}));

router.get("/maintenance-requests/:id", C.route("scoped", { ttl: 15 }), wrap((req, res) => {
  const account = req.account;
  const r = loadVisibleRequest(account, req.params.id);
  const expenses = S.expensesOf(r.id, account);
  const approved = expenses.filter((x) => x.approved).reduce((s, x) => s + x.amount_cents, 0);
  const pending = expenses.filter((x) => !x.approved).reduce((s, x) => s + x.amount_cents, 0);
  res.json({
    request: V.requestView(r, account),
    comments: S.commentsOf(r.id).map(V.commentView),
    history: S.eventsOf(r.id).map(V.eventView),
    attachments: S.attachmentsOf(r.id).map(V.attachmentView),
    expenses: expenses.map(V.expenseView),
    totalExpense: V.money(approved),
    pendingExpense: V.money(pending),
    quotations: S.quotationsOf(r.id, account).map(V.quotationView),
    aiSuggestion: account.role === "MANAGER" ? V.suggestionView(S.latestSuggestion(r.id)) : null,
  });
}));

router.post("/maintenance-requests/:id/status", wrap((req, res) => {
  const account = req.account;
  const r = loadVisibleRequest(account, req.params.id);
  const to = oneOf(req.body.target, Object.keys(R.TRANSITIONS), "Target status", null);
  if (!to) throw bad("A target status is required.");
  if (!R.mayTransition(account, r, to)) throw denied();       // who you are is checked before what you ask for
  if (!R.canMoveTo(r.status, to)) throw bad(`A request cannot move from ${r.status} to ${to}.`);

  let notes = null;
  if (to === "COMPLETED") {
    notes = str(req.body.completionNotes, "Completion notes", 2000, false);
    if (!notes) throw bad("Completion notes are required before marking work complete.");
  }
  if (to === "ASSIGNED" && !r.technician_id && !r.vendor_id) {
    throw bad("Assign a technician or vendor before moving the request to ASSIGNED.");
  }
  const updated = S.updateRequestStatus(r.id, to, notes, r.status);
  if (!updated) throw conflict("This request was just changed by someone else. Reload it and try again.");
  S.addEvent(r.id, account.id, r.status, to, str(req.body.note, "Note", 500, false) || `Moved from ${nice(r.status)} to ${nice(to)}`);
  S.audit(account, "STATUS_CHANGED", "request", r.id, `${r.status} -> ${to}`);
  tell(r, account.id, to === "COMPLETED"
    ? `Work finished on "${r.title}". It is ready for review.`
    : `"${r.title}" is now ${to.replace("_", " ").toLowerCase()}.`);
  res.json(V.requestView(updated, account));
}));

router.post("/maintenance-requests/:id/assign", A.requireRole("MANAGER"), wrap((req, res) => {
  const account = req.account;
  const r = loadVisibleRequest(account, req.params.id);
  if (!R.ASSIGNABLE.includes(r.status)) throw bad(`A request that is ${r.status} cannot be reassigned.`);
  const hasTech = req.body.technicianId != null && req.body.technicianId !== "";
  const hasVendor = req.body.vendorId != null && req.body.vendorId !== "";
  if (hasTech === hasVendor) throw bad("Choose either a technician or a vendor, not both.");

  let technicianId = null, vendorId = null, label;
  if (hasTech) {
    const t = S.findAccount(Number(req.body.technicianId));
    if (!t || t.org_id !== account.org_id) throw missing("That technician");
    if (t.role !== "TECHNICIAN") throw bad("Only a technician account can be assigned here.");
    if (!t.active) throw bad("That technician account is deactivated.");
    technicianId = t.id; label = t.full_name;
  } else {
    const v = orgVendor(account, req.body.vendorId);
    if (v.status !== "ACTIVE") throw bad(`${v.name} is ${v.status.toLowerCase()} and cannot take work.`);
    vendorId = v.id; label = v.name;
  }
  const next = R.canMoveTo(r.status, "ASSIGNED") ? "ASSIGNED" : r.status;
  const updated = S.updateAssignment(r.id, { technicianId, vendorId,
    dueDate: dateOf(req.body.dueDate, "Due date"),
    priority: oneOf(req.body.priority, R.PRIORITIES, "Priority", null),
    category: oneOf(req.body.category, R.CATEGORIES, "Category", null), status: next, expectedStatus: r.status });
  if (!updated) throw conflict("This request was just changed by someone else. Reload it and try again.");
  S.addEvent(r.id, account.id, r.status, next, `Assigned to ${label}`);
  S.audit(account, "REQUEST_ASSIGNED", "request", r.id, label);
  if (technicianId) S.notify(technicianId, `You have been assigned: ${r.title}`, r.id);
  if (vendorId) S.db.prepare("SELECT id FROM accounts WHERE vendor_id = ? AND active = 1").all(vendorId)
    .forEach((a) => S.notify(a.id, `New work order for ${label}: ${r.title}`, r.id));
  S.notify(r.reporter_id, `Your request "${r.title}" was assigned.`, r.id);
  res.json(V.requestView(updated, account));
}));

router.post("/maintenance-requests/:id/comments", wrap((req, res) => {
  const account = req.account;
  const r = loadVisibleRequest(account, req.params.id);
  if (!R.isOpen(r.status)) throw bad("This request is closed. Reopen it before adding a comment.");
  const c = S.addComment(r.id, account.id, str(req.body.body, "Comment", 2000));
  tell(r, account.id, `New comment on "${r.title}".`);
  res.status(201).json(V.commentView(c));
}));

/* ---- expenses (technician, manager) and invoices (vendor) ---- */
router.post("/maintenance-requests/:id/expenses", A.requireRole("MANAGER", "TECHNICIAN", "VENDOR"), wrap((req, res) => {
  const account = req.account;
  const r = loadVisibleRequest(account, req.params.id);
  if (!R.isOpen(r.status)) throw bad("This request is closed. Reopen it before recording cost.");
  const cents = centsOf(req.body.amount, "An expense amount");
  const kind = account.role === "VENDOR" ? "INVOICE" : "EXPENSE";
  const x = S.addExpense(r.id, account.id, cents, str(req.body.description, "Description", 300), kind);
  S.addEvent(r.id, account.id, r.status, r.status, `${kind === "INVOICE" ? "Invoice" : "Expense"} recorded: ${V.money(cents)}`);
  S.audit(account, `${kind}_RECORDED`, "expense", x.id, String(V.money(cents)));
  if (account.role !== "MANAGER") S.managersOf(r.org_id).forEach((m) => S.notify(m.id, `${kind === "INVOICE" ? "Invoice" : "Expense"} awaiting approval on "${r.title}".`, r.id));
  res.status(201).json(V.expenseView(x));
}));

router.post("/expenses/:id/approve", A.requireRole("MANAGER"), wrap((req, res) => {
  const x = S.findExpense(Number(req.params.id));
  if (!x || x.org_id !== req.account.org_id) throw missing("That expense");
  if (x.recorded_by_id === req.account.id) throw bad("An expense cannot be approved by the person who recorded it.");
  if (x.approved) throw bad("That expense is already approved.");
  const org = S.findOrganization(req.account.org_id);
  if (org.approval_limit_cents != null && x.amount_cents > org.approval_limit_cents && !req.account.org_admin) {
    throw new Fail(403, "This amount is above your approval limit. An organization admin must approve it.");
  }
  const done = S.approveExpense(x.id, req.account.id);
  if (!done) throw conflict("That expense is already approved.");
  S.audit(req.account, "EXPENSE_APPROVED", "expense", x.id, String(V.money(x.amount_cents)));
  S.notify(x.recorded_by_id, `Your ${x.kind.toLowerCase()} of ${V.money(x.amount_cents)} on "${x.request_title}" was approved.`, x.request_id);
  res.json(V.expenseView(done));
}));

/* ---- vendor quotations ---- */
router.post("/maintenance-requests/:id/quotations", A.requireRole("VENDOR"), wrap((req, res) => {
  const account = req.account;
  const r = loadVisibleRequest(account, req.params.id);
  if (["COMPLETED", "CLOSED"].includes(r.status)) throw bad("A quotation can no longer be submitted for this request.");
  const q = S.addQuotation(r.id, account.vendor_id, account.id, centsOf(req.body.amount, "A quotation amount"),
                           str(req.body.description, "Description", 500));
  S.audit(account, "QUOTATION_SUBMITTED", "quotation", q.id, String(V.money(q.amount_cents)));
  S.managersOf(r.org_id).forEach((m) => S.notify(m.id, `${q.vendor_name} quoted ${V.money(q.amount_cents)} for "${r.title}".`, r.id));
  res.status(201).json(V.quotationView(q));
}));

router.post("/quotations/:id/decision", A.requireRole("MANAGER"), wrap((req, res) => {
  const q = S.findQuotation(Number(req.params.id));
  const r = q && S.findRequest(q.request_id);
  if (!q || !r || r.org_id !== req.account.org_id) throw missing("That quotation");
  if (q.status !== "PENDING") throw bad("That quotation has already been decided.");
  const decision = oneOf(req.body.decision, ["APPROVE", "REJECT"], "Decision", null);
  if (!decision) throw bad("A decision of APPROVE or REJECT is required.");
  const done = S.decideQuotation(q.id, decision === "APPROVE" ? "APPROVED" : "REJECTED", req.account.id);
  if (!done) throw conflict("That quotation has already been decided.");
  S.audit(req.account, `QUOTATION_${done.status}`, "quotation", q.id, String(V.money(q.amount_cents)));
  S.db.prepare("SELECT id FROM accounts WHERE vendor_id = ? AND active = 1").all(q.vendor_id)
    .forEach((a) => S.notify(a.id, `Your quotation for "${r.title}" was ${done.status.toLowerCase()}.`, r.id));
  res.json(V.quotationView(done));
}));

/* ---- attachments: real files, checked by content, stored outside the web root ---- */
const checkCanAttach = (req, res, next) => {
  try {
    const r = loadVisibleRequest(req.account, req.params.id);
    if (!R.isOpen(r.status)) throw bad("This request is closed. Reopen it before adding files.");
    if (S.countAttachments(r.id) >= config.maxAttachmentsPerRequest) {
      throw bad(`A request can hold at most ${config.maxAttachmentsPerRequest} files.`);
    }
    req.target = r; next();
  } catch (e) { next(e); }
};
const receive = (req, res, next) => F.upload.single("file")(req, res, (err) => {
  if (!err) return next();
  next(err.code === "LIMIT_FILE_SIZE"
    ? bad(`That file is too large. The limit is ${Math.round(config.maxUploadBytes / 1048576)} MB.`)
    : bad("The upload could not be read."));
});
router.post("/maintenance-requests/:id/attachments", checkCanAttach, receive, wrap(async (req, res) => {
  if (!req.file) throw bad("Choose a file to upload.");
  if (!F.sniff(req.file.buffer)) throw bad("Only PNG, JPEG, WebP images and PDF files can be uploaded.");
  try { await Scan.check(req.file.buffer); } catch (e) { throw e instanceof Scan.ScanError ? new Fail(e.status, e.message, e.code) : e; }                    // malware scan (when configured) before anything is written to disk
  const saved = F.save(req.file.buffer);
  if (!saved) throw bad("Only PNG, JPEG, WebP images and PDF files can be uploaded.");
  const a = S.addAttachment({ requestId: req.target.id, uploaderId: req.account.id,
    originalName: F.safeName(req.file.originalname), storedName: saved.storedName, mime: saved.mime,
    size: req.file.size, kind: req.account.role === "TENANT" ? "PHOTO" : "EVIDENCE" });
  S.addEvent(req.target.id, req.account.id, req.target.status, req.target.status, `File added: ${a.original_name}`);
  res.status(201).json(V.attachmentView(a));
}));

router.get("/attachments/:id", wrap((req, res, next) => {
  const a = S.findAttachment(Number(req.params.id));
  if (!a) throw missing("That file");
  const r = S.findRequest(a.request_id);
  if (!r || !R.mayView(req.account, r)) throw denied();
  res.set({ "Content-Type": a.mime, "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; sandbox", "Cross-Origin-Resource-Policy": "same-origin",
            "Content-Disposition": `inline; filename="${F.safeName(a.original_name)}"`,
            "Cache-Control": "private, max-age=0" });
  res.sendFile(F.pathOf(a.stored_name), (err) => { if (err && !res.headersSent) next(missing("That file")); });
}));

/* ---- AI: advisory classification, decided by a person ---- */
router.get("/ai/status", A.requireRole("MANAGER"), wrap((req, res) => res.json(AI.status())));

router.post("/maintenance-requests/:id/ai-suggestion", A.requireRole("MANAGER"), wrap(async (req, res) => {
  const r = loadVisibleRequest(req.account, req.params.id);
  const s = await AI.classify({ title: r.title, description: r.description });
  const saved = S.addSuggestion(r.id, s, AI.status().model);
  S.audit(req.account, "AI_SUGGESTION_CREATED", "request", r.id, `${s.category}/${s.priority}`);
  res.status(201).json(V.suggestionView(saved));
}));

router.post("/ai-suggestions/:id/decision", A.requireRole("MANAGER"), wrap((req, res) => {
  const s = S.findSuggestion(Number(req.params.id));
  const r = s && S.findRequest(s.request_id);
  if (!s || !r || r.org_id !== req.account.org_id) throw missing("That suggestion");
  if (s.decision) throw bad("That suggestion has already been decided.");
  const decision = oneOf(req.body.decision, ["ACCEPT", "REJECT"], "Decision", null);
  if (!decision) throw bad("A decision of ACCEPT or REJECT is required.");
  S.db.transaction(() => {
    if (!S.decideSuggestion(s.id, decision === "ACCEPT" ? "ACCEPTED" : "REJECTED", req.account.id)) throw conflict("That suggestion has already been decided.");
    if (decision === "ACCEPT") {
      S.setClassification(r.id, s.category, s.priority);
      S.addEvent(r.id, req.account.id, r.status, r.status, `AI suggestion accepted: ${s.category}, ${s.priority}`);
    }
    S.audit(req.account, `AI_SUGGESTION_${decision}ED`, "request", r.id, `${s.category}/${s.priority}`);
  })();
  res.json(V.suggestionView(S.findSuggestion(s.id)));
}));

/* ================= notifications ================= */
router.get("/notifications", C.route("user", { ttl: 10 }), wrap((req, res) =>
  res.json(S.notificationsFor(req.account.id).map(V.notificationView))));
router.post("/notifications/read-all", wrap((req, res) => { S.markAllRead(req.account.id); res.status(204).end(); }));
router.post("/notifications/:id/read", wrap((req, res) => {
  const n = S.findNotification(Number(req.params.id));
  if (!n) throw missing("That notification");
  if (n.recipient_id !== req.account.id) throw denied();
  S.markRead(n.id);
  res.status(204).end();
}));

/* ================= dashboard, insights, audit ================= */
router.get("/dashboard", C.route("scoped", { ttl: 15, patch: (b, r) => { b.unreadNotifications = S.unreadCount(r.account.id); return b; } }), wrap((req, res) => {
  const account = req.account;
  const { role, id } = account;
  const scope = S.listRequests(account).rows;

  let open = 0, high = 0, overdue = 0, inProgress = 0, awaitingReview = 0, awaitingAssignment = 0, closed = 0;
  let turnMs = 0, turnN = 0;
  const attention = [];
  const months = new Map();
  const load = new Map();
  for (const r of scope) {
    if (R.isOpen(r.status)) open++;
    if (r.status === "IN_PROGRESS") inProgress++;
    if (r.status === "COMPLETED") awaitingReview++;
    if (r.status === "REPORTED" || r.status === "UNDER_REVIEW") awaitingAssignment++;
    if (r.status === "CLOSED") closed++;
    if (R.isOpen(r.status) && (r.priority === "HIGH" || r.priority === "URGENT")) high++;
    if (V.isOverdue(r)) overdue++;
    if (r.status === "CLOSED" && r.closed_at) { turnMs += new Date(r.closed_at) - new Date(r.created_at); turnN++; }
    if (R.isOpen(r.status) && (V.isOverdue(r) || r.priority === "URGENT" || r.status === "REPORTED") && attention.length < 8) attention.push(r);
    const m = r.created_at.slice(0, 7);
    const row = months.get(m) || { month: m, reported: 0, closed: 0 };
    row.reported++; if (r.status === "CLOSED") row.closed++;
    months.set(m, row);
    if (R.isOpen(r.status) && (r.technician_name || r.vendor_name)) {
      const key = (r.technician_name ? "Technician: " : "Vendor: ") + (r.technician_name || r.vendor_name);
      load.set(key, (load.get(key) || 0) + 1);
    }
  }
  const spend = S.spendSince(account, new Date(Date.now() - 30 * 86400000).toISOString());
  const out = {
    role,
    openRequests: open, highPriority: high, overdue, inProgress,
    completedAwaitingReview: awaitingReview, awaitingAssignment, closedTotal: closed,
    monthlySpend: V.money(spend.approved), pendingSpend: V.money(spend.pending),
    averageTurnaroundDays: turnN ? Math.round((turnMs / turnN / 86400000) * 100) / 100 : null,
    unreadNotifications: S.unreadCount(id),
    attention: attention.map((x) => V.requestView(x, account)),
    recentActivity: [], trend: [], assignments: [],
  };
  if (role === "MANAGER") {
    const orgId = needOrg(account);
    out.recentActivity = S.recentEvents(orgId, 10).map(V.eventView);
    out.trend = [...months.values()].sort((a, b) => a.month.localeCompare(b.month)).slice(-6);
    out.assignments = [...load.entries()].map(([name, openJobs]) => ({ name, openJobs })).sort((a, b) => b.openJobs - a.openJobs);
    out.propertyCount = S.listProperties(orgId).length;
    out.pendingQuotations = S.pendingQuotationCount(orgId);
    out.pendingApprovals = S.db.prepare(`SELECT COUNT(*) AS n FROM expenses x JOIN requests r ON r.id = x.request_id
      JOIN units u ON u.id = r.unit_id JOIN properties p ON p.id = u.property_id
     WHERE p.org_id = ? AND x.approved = 0`).get(orgId).n;
    out.activeVendors = S.vendorsOf(orgId, "ACTIVE").length;
  }
  if (role === "TENANT") out.units = S.unitsForTenant(id).map((u) => V.unitView(u));
  if (role === "VENDOR") {
    const v = S.findVendor(account.vendor_id);
    out.vendor = { name: v.name, status: v.status };
    out.pendingQuotations = S.db.prepare("SELECT COUNT(*) AS n FROM quotations WHERE vendor_id = ? AND status = 'PENDING'").get(v.id).n;
  }
  res.json(out);
}));

router.get("/insights", A.requireRole("MANAGER"), C.route("org", { ttl: 60 }), wrap((req, res) => {
  const orgId = needOrg(req.account);
  res.json({
    method: "rule-based analysis of your stored requests and expenses (not an AI model)",
    recurringIssues: S.recurringIssues(orgId).map((x) => ({
      unitLabel: x.unit_label, propertyName: x.property_name, category: x.category, occurrences: x.occurrences,
      explanation: `${x.category.toLowerCase()} problems were reported ${x.occurrences} times in the last 90 days. The cause may not be fixed.` })),
    costAnomalies: S.costAnomalies(orgId).map((x) => ({
      requestId: x.request_id, title: x.title, category: x.category, amount: V.money(x.amount_cents),
      typicalAmount: V.money(x.typical_cents),
      explanation: `${V.money(x.amount_cents)} is more than twice the typical ${x.category.toLowerCase()} cost of ${V.money(x.typical_cents)}.` })),
  });
}));

router.get("/audit", A.requireRole("MANAGER"), C.route("org"), wrap((req, res) =>
  res.json(S.auditOf(needOrg(req.account), Math.min(parseInt(req.query.limit, 10) || config.paging.defaultSize, config.paging.maxSize)).map(V.auditView))));

/* ---------- load testing (organization admins only; see LOADTEST.md) ---------- */
require("./loadtest/routes")(router, { wrap, Fail, S });

/* ---------- error shape ---------- */
router.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500 && !(err instanceof AI.AiError) && !(err instanceof Fail && err.code)) console.error(err);
  // Only messages this application wrote are shown for server errors. A database or library error (which carries its own
  // `code`, such as SQLITE_CONSTRAINT_UNIQUE) must never reach the client.
  const authored = err instanceof Fail || err instanceof AI.AiError;
  const body = {
    timestamp: new Date().toISOString(), status,
    message: status < 500 || (authored && err.code) ? err.message : "Something went wrong handling that request.",
  };
  if (authored && err.code) body.code = err.code;
  if (err.errors) body.errors = err.errors;          // field-level validation messages
  if (err.activeId) body.activeId = err.activeId;
  res.status(status).json(body);
});

module.exports = router;
