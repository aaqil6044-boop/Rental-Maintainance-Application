"use strict";
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const db = require("./db");
const config = require("./config");

const hash = (plain) => bcrypt.hashSync(plain, config.auth.bcryptRounds);
const verify = (plain, hashed) => bcrypt.compareSync(plain, hashed);
/** Non-blocking check: bcryptjs yields to the event loop between work chunks, so a login does not freeze every other request.
 *  (The synchronous version held the single Node thread for ~100+ ms per sign-in; the stress test showed it as the main stall.) */
const verifyAsync = (plain, hashed) => bcrypt.compare(plain, hashed);
/** Compared against when the email is unknown, so "no such account" costs the same time as "wrong password" (no account enumeration by timing). */
const DUMMY_HASH = bcrypt.hashSync("not-a-real-account-password", config.auth.bcryptRounds);

/** tv = token_version: bumping it on the account invalidates every token issued before (sign out everywhere, password change).
 *  sid = this sign-in's own session row: ending it signs out this device only. */
function issue(account, req) {
  const sid = crypto.randomBytes(18).toString("base64url");
  const token = jwt.sign({ uid: account.id, role: account.role, tv: account.token_version, sid },
                         config.jwtSecret, { algorithm: "HS256", expiresIn: config.jwtTtl });
  const exp = new Date(jwt.decode(token).exp * 1000).toISOString();
  S().createSession(account.id, sid, exp, req && req.ip, req && req.get && req.get("user-agent"), config.maxSessionsPerAccount);
  return token;
}
const S = () => require("./store");          // loaded lazily: store requires config/db only, but auth is imported by store's callers first

/** Short-lived proof that the password step succeeded; only /auth/mfa/verify accepts it. It has no sid, so it can never open the API. */
const issueMfaToken = (account) => jwt.sign({ uid: account.id, purpose: "mfa" }, config.jwtSecret, { algorithm: "HS256", expiresIn: "5m" });
function readMfaToken(token) {
  try {
    const c = jwt.verify(String(token || ""), config.jwtSecret, { algorithms: ["HS256"] });
    return c.purpose === "mfa" ? c.uid : null;
  } catch { return null; }
}

const ACCOUNT_WITH_VENDOR = `
  SELECT a.*, v.status AS vendor_status, v.name AS vendor_name, o.name AS org_name
    FROM accounts a
    LEFT JOIN vendors v ON v.id = a.vendor_id
    LEFT JOIN organizations o ON o.id = a.org_id`;

const loadAccount = (id) => db.prepare(ACCOUNT_WITH_VENDOR + " WHERE a.id = ?").get(id);
const loadAccountByEmail = (email) =>
  db.prepare(ACCOUNT_WITH_VENDOR + " WHERE a.email = ? COLLATE NOCASE").get(email);

/** Resolves the account from the bearer token. Never trusts anything the client sends in a body. */
function authenticate(req, res, next) {
  const header = req.get("authorization") || "";
  if (!header.startsWith("Bearer ")) {
    return res.status(401).json({ status: 401, message: "Not signed in." });
  }
  let claims;
  try {
    claims = jwt.verify(header.slice(7).trim(), config.jwtSecret, { algorithms: ["HS256"] });
  } catch (e) {
    return res.status(401).json({ status: 401, message: "Your session is no longer valid." });
  }
  const account = claims.sid ? loadAccount(claims.uid) : null;           // tokens without a session id (from before sessions existed) must sign in again
  if (!account || !account.active || account.token_version !== claims.tv) {
    return res.status(401).json({ status: 401, message: "Your session is no longer valid." });
  }
  const sess = S().findSession(claims.sid, account.id);
  const t = Date.now();
  if (!sess || sess.revoked_at || sess.expires_at <= new Date(t).toISOString()) {
    return res.status(401).json({ status: 401, message: "Your session is no longer valid." });
  }
  const idle = config.sessionIdleMin * 60000, seen = Date.parse(sess.last_seen_at);
  if (idle && t - seen > idle) {
    S().revokeSession(sess.id, account.id);
    return res.status(401).json({ status: 401, message: "You were signed out after a period of inactivity. Please sign in again." });
  }
  if (t - seen > 60000) S().touchSession(sess.id);                          // at most one write a minute per session
  req.account = account; req.session = sess;
  next();
}

const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.account.role)
    ? next()
    : res.status(403).json({ status: 403, message: "You do not have access to this record." });

/* ---- invitation tokens: random, shown once, stored only as a hash ---- */
const newToken = () => crypto.randomBytes(32).toString("base64url");
const hashToken = (t) => crypto.createHash("sha256").update(String(t)).digest("hex");

/* ---- login throttling: slows password guessing without needing a store ---- */
const attempts = new Map();
const WINDOW_MS = config.auth.lockoutMinutes * 60 * 1000, MAX_FAILS = config.auth.maxLoginFailures;
const throttleKey = (req, email) => `${req.ip}|${String(email).toLowerCase()}`;
function throttled(req, email) {
  const e = attempts.get(throttleKey(req, email));
  return !!e && e.resetAt > Date.now() && e.count >= MAX_FAILS;
}
function recordFailure(req, email) {
  if (attempts.size > 5000) {                       // keep memory bounded under a flood of made-up emails
    const now = Date.now();
    for (const [key, v] of attempts) if (v.resetAt <= now) attempts.delete(key);
    while (attempts.size > 20000) attempts.delete(attempts.keys().next().value);
  }
  const k = throttleKey(req, email), e = attempts.get(k);
  if (!e || e.resetAt <= Date.now()) attempts.set(k, { count: 1, resetAt: Date.now() + WINDOW_MS });
  else e.count++;
}
const clearFailures = (req, email) => attempts.delete(throttleKey(req, email));

module.exports = { issueMfaToken, readMfaToken, hash, verify, verifyAsync, DUMMY_HASH, issue, authenticate, requireRole, loadAccount, loadAccountByEmail,
                   newToken, hashToken, throttled, recordFailure, clearFailures };
