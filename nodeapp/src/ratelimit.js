"use strict";
// Small in-memory rate limiter for the endpoints an anonymous attacker can reach.
//   count "all"      every request counts            (sign-up: stops mass account creation)
//   count "failures" only 4xx/5xx answers count      (sign-in, setup key, invitation tokens: stops guessing without punishing normal use)
// The budget is per client address (or per account for signed-in routes). It is held in this process, so with N instances behind a
// balancer the effective budget is N times larger; set matching limits on the reverse proxy as well (see SECURITY.md).
const config = require("./config");

const buckets = new Map();           // `${name}|${key}` -> { n, resetAt }
let lastSweep = 0;

function sweep(now) {
  if (now - lastSweep < 30000 && buckets.size < 20000) return;
  lastSweep = now;
  for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  if (buckets.size > 100000) buckets.clear();     // hard ceiling: never let a flood of addresses grow memory without bound
}

function limiter(name, { windowMs, max, count = "all", by = (req) => req.ip }) {
  return function rateLimit(req, res, next) {
    if (!config.rateLimit) return next();
    const now = Date.now(); sweep(now);
    const key = `${name}|${by(req)}`;
    let b = buckets.get(key);
    if (!b || b.resetAt <= now) { b = { n: 0, resetAt: now + windowMs }; buckets.set(key, b); }
    if (b.n >= max) {
      res.set("Retry-After", String(Math.max(1, Math.ceil((b.resetAt - now) / 1000))));
      return res.status(429).json({ timestamp: new Date().toISOString(), status: 429, message: "Too many attempts. Wait a few minutes and try again." });
    }
    if (count === "all") b.n++;
    else res.on("finish", () => { if (res.statusCode >= 400 && res.statusCode !== 429) b.n++; });
    next();
  };
}

const reset = () => buckets.clear();
module.exports = { limiter, reset };
