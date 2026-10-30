"use strict";
// Response cache for read endpoints. Correctness first: a cached answer is only ever served when NOTHING it could depend on has changed.
//
// WHAT IS CACHED, AND FOR WHOM
//   shared by every manager of an organization   team, technicians, tenants, vendors, properties, units of a property,
//     (same answer for all of them)              reportable units (manager view), organization, insights, audit log,
//                                                 request list + request detail (manager view), dashboard (manager view)
//   per user (same user asking again)            notifications, and the tenant / technician / vendor views of the request
//                                                 list, request detail, reportable units and dashboard
//   shared by everyone                           setup status
//   NEVER cached                                 sign-in, /auth/me, attachments (files), anything that writes
//
// HOW IT STAYS CORRECT
//   * The key contains the organization, the kind of viewer (manager of org 3 / user 17 ...), the full URL with its query string,
//     and a VERSION. Different organizations and different users can never read each other's entries.
//   * The cache sits AFTER authentication and the role check on each route, so a hit can only be served to someone who passed both.
//     Only 200 answers are stored; refusals (401/403/404) are never cached.
//   * Every successful write (POST/PUT/PATCH/DELETE) bumps the organization's version BEFORE its response is sent, so the writer
//     always reads their own change and all older entries of that organization stop matching. Writes with no signed-in account
//     (register, accept invitation, first setup) bump a global version.
//   * Versions live in SQLite (table cache_versions), not in memory, so several app instances / workers behind a balancer see each
//     other's writes immediately. Reading a version is one indexed lookup.
//   * Every entry also expires after a short TTL, as a safety net for changes made outside the HTTP layer (scripts, fixtures)
//     and for values that depend on the clock (overdue flags).
//   * CACHE=off in the environment turns the whole thing off.
const db = require("./db");

const ENABLED = String(process.env.CACHE || "on").toLowerCase() !== "off";
const MAX_ENTRIES = Number(process.env.CACHE_MAX_ENTRIES) || 2000;
const store = new Map();            // key -> { body, total, exp }   (Map keeps insertion order: oldest first, used for eviction)
const stats = { hits: 0, misses: 0, stores: 0, evictions: 0, bumps: 0 };

const readVer = db.prepare("SELECT COALESCE(SUM(v), 0) AS v FROM cache_versions WHERE scope IN ('global', ?)");
const bumpVer = db.prepare("INSERT INTO cache_versions (scope, v) VALUES (?, 1) ON CONFLICT(scope) DO UPDATE SET v = v + 1");
const version = (orgId) => readVer.get("org:" + orgId).v;
function bump(scope = "global") { bumpVer.run(scope === "global" ? "global" : String(scope)); stats.bumps++; }
const bumpOrg = (orgId) => bump("org:" + orgId);

function put(key, entry) {
  if (store.size >= MAX_ENTRIES) {                      // evict the oldest 10%
    let n = Math.ceil(MAX_ENTRIES / 10); for (const k of store.keys()) { store.delete(k); stats.evictions++; if (--n <= 0) break; }
  }
  store.delete(key); store.set(key, entry); stats.stores++;
}

/** Who the answer is "for". Managers of one organization share; everyone else is individual. */
const viewer = {
  org: (req, vary) => `o${req.account.org_id}:M${vary ? ":" + vary(req) : ""}`,
  user: (req) => `u${req.account.id}`,
  global: () => "g",
  scoped: (req, vary) => req.account.role === "MANAGER" ? viewer.org(req, vary) : viewer.user(req),
};

/**
 * Route middleware. Put it AFTER A.requireRole(...) so authorization has already happened.
 *   kind  "org" | "user" | "global" | "scoped"
 *   ttl   seconds an entry may live at most
 *   vary  extra part of the key when managers differ (e.g. administrator or not)
 *   patch (body, req) -> body: fields that must be fresh for every request even on a hit (e.g. the caller's own unread count)
 */
function route(kind, { ttl = 30, vary = null, patch = null } = {}) {
  return (req, res, next) => {
    if (!ENABLED || req.method !== "GET" || !req.account) return kind === "global" && ENABLED && req.method === "GET" ? global(req, res, next) : next();
    const org = req.account.org_id;
    const key = `${version(org)}|${viewer[kind](req, vary)}|${req.originalUrl}`;
    const hit = store.get(key);
    if (hit && hit.exp > Date.now()) {
      stats.hits++;
      res.set("X-Cache", "HIT"); if (hit.total != null) res.set("X-Total-Count", hit.total);
      return res.type("json").send(patch ? JSON.stringify(patch(JSON.parse(hit.body), req)) : hit.body);
    }
    stats.misses++; res.set("X-Cache", "MISS");
    const json = res.json.bind(res);
    res.json = (obj) => {
      if (res.statusCode === 200) put(key, { body: JSON.stringify(obj), total: res.get("X-Total-Count") || null, exp: Date.now() + ttl * 1000 * require("./config").cacheTtlScale });
      return json(patch && res.statusCode === 200 ? patch(JSON.parse(JSON.stringify(obj)), req) : obj);
    };
    next();
  };
}
function global(req, res, next) {                        // routes with no account (setup status)
  const key = `${version("none")}|g|${req.originalUrl}`, hit = store.get(key);
  if (hit && hit.exp > Date.now()) { stats.hits++; res.set("X-Cache", "HIT"); return res.type("json").send(hit.body); }
  stats.misses++; res.set("X-Cache", "MISS");
  const json = res.json.bind(res);
  res.json = (obj) => { if (res.statusCode === 200) put(key, { body: JSON.stringify(obj), total: null, exp: Date.now() + 5000 }); return json(obj); };
  next();
}

/** Router-level: any successful write invalidates, before the response leaves. */
function invalidateOnWrite(req, res, next) {
  if (!ENABLED || req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
  if (req.method === "POST" && /\/auth\/login$/.test(req.path)) return next();   // signing in changes no cached data
  const end = res.end;
  res.end = function (...args) {
    res.end = end;
    try { if (res.statusCode < 400) (req.account && req.account.org_id ? bumpOrg(req.account.org_id) : bump("global")); } catch { /* never fail a request because of the cache */ }
    return end.apply(this, args);
  };
  next();
}

const snapshot = () => ({ enabled: ENABLED, entries: store.size, ...stats, hitRate: stats.hits + stats.misses ? Math.round((stats.hits / (stats.hits + stats.misses)) * 1000) / 10 : null });
const clear = () => store.clear();
const resetStats = () => { for (const k of Object.keys(stats)) stats[k] = 0; };

module.exports = { route, invalidateOnWrite, bump, bumpOrg, version, snapshot, clear, resetStats, ENABLED };
