"use strict";
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const db = require("./db");
const config = require("./config");

const hash = (plain) => bcrypt.hashSync(plain, 10);
const verify = (plain, hashed) => bcrypt.compareSync(plain, hashed);

/** tv = token_version: bumping it on the account invalidates every token issued before. */
const issue = (account) =>
  jwt.sign({ uid: account.id, role: account.role, tv: account.token_version },
           config.jwtSecret, { expiresIn: config.jwtTtl });

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
    claims = jwt.verify(header.slice(7).trim(), config.jwtSecret);
  } catch (e) {
    return res.status(401).json({ status: 401, message: "Your session is no longer valid." });
  }
  const account = loadAccount(claims.uid);
  if (!account || !account.active || account.token_version !== claims.tv) {
    return res.status(401).json({ status: 401, message: "Your session is no longer valid." });
  }
  req.account = account;
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
const WINDOW_MS = 15 * 60 * 1000, MAX_FAILS = 8;
const throttleKey = (req, email) => `${req.ip}|${String(email).toLowerCase()}`;
function throttled(req, email) {
  const e = attempts.get(throttleKey(req, email));
  return !!e && e.resetAt > Date.now() && e.count >= MAX_FAILS;
}
function recordFailure(req, email) {
  const k = throttleKey(req, email), e = attempts.get(k);
  if (!e || e.resetAt <= Date.now()) attempts.set(k, { count: 1, resetAt: Date.now() + WINDOW_MS });
  else e.count++;
}
const clearFailures = (req, email) => attempts.delete(throttleKey(req, email));

module.exports = { hash, verify, issue, authenticate, requireRole, loadAccount, loadAccountByEmail,
                   newToken, hashToken, throttled, recordFailure, clearFailures };
