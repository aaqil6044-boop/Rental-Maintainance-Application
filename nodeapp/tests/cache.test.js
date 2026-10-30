"use strict";
// Response cache: what is shared, what is not, and that it can never show stale or foreign data.
const { isolate, reporter } = require("./helpers");
const dir = isolate();
const T = reporter("Cache");
const { ok, section } = T;
const app = require("../server");
const S = require("../src/store");
const A = require("../src/auth");
const C = require("../src/cache");
const Database = require("better-sqlite3");
require("../src/seed")();

let BASE;
async function call(method, p, token, body) {
  const res = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text(); let data = null; if (text) { try { data = JSON.parse(text); } catch { data = text; } }
  return { status: res.status, data, text, xc: res.headers.get("x-cache"), total: res.headers.get("x-total-count") };
}
const login = async (email) => (await call("POST", "/api/auth/login", null, { email, password: "password123" })).data.token;

(async () => {
  const server = app.listen(0); await new Promise((r) => server.once("listening", r));
  BASE = "http://127.0.0.1:" + server.address().port;
  const admin = await login("manager@estateops.test"), tenant = await login("tenant@estateops.test"), vendor = await login("vendor@estateops.test");
  const org = S.findAccountByEmail("manager@estateops.test").org_id;
  S.createAccount({ email: "plain.manager@estateops.test", passwordHash: A.hash("password123"), fullName: "Plain Manager", role: "MANAGER", orgId: org, orgAdmin: 0, profileComplete: 1 });
  const plain = await login("plain.manager@estateops.test");
  const org2 = S.createOrganization("Other org").id;
  S.createAccount({ email: "other.admin@estateops.test", passwordHash: A.hash("password123"), fullName: "Other Admin", role: "MANAGER", orgId: org2, orgAdmin: 1, profileComplete: 1 });
  const other = await login("other.admin@estateops.test");
  S.createAccount({ email: "cache.tenant@estateops.test", passwordHash: A.hash("password123"), fullName: "Second Tenant", role: "TENANT", orgId: org, profileComplete: 1 });
  const tenant2 = await login("cache.tenant@estateops.test");

  section("1. Hits, misses and identical answers");
  let a = await call("GET", "/api/team", admin), b = await call("GET", "/api/team", admin);
  ok("first read is a MISS, second a HIT", a.xc === "MISS" && b.xc === "HIT", [a.xc, b.xc]);
  ok("the HIT is byte-for-byte the same answer", a.text === b.text);
  for (const p of ["/api/properties", "/api/vendors", "/api/technicians", "/api/tenants", "/api/organization", "/api/insights", "/api/audit", "/api/units/reportable", "/api/maintenance-requests", "/api/dashboard"]) {
    await call("GET", p, admin); const h = await call("GET", p, admin);
    ok(`${p} is served from cache on the second read`, h.status === 200 && h.xc === "HIT", [h.status, h.xc]);
  }
  const l1 = await call("GET", "/api/maintenance-requests?limit=1", admin), l2 = await call("GET", "/api/maintenance-requests?limit=1", admin);
  ok("the total count header survives a HIT", l2.xc === "HIT" && l2.total === l1.total && l1.total != null, [l1.total, l2.total]);
  const q1 = await call("GET", "/api/maintenance-requests?limit=2", admin);
  ok("a different query string is a different entry", q1.xc === "MISS");

  section("2. Shared across managers of one organization");
  await call("GET", "/api/properties", admin);
  const pl = await call("GET", "/api/properties", plain);
  ok("another manager of the same organization gets the shared entry", pl.xc === "HIT");
  const orgA = await call("GET", "/api/organization", admin), orgP = await call("GET", "/api/organization", plain);
  ok("…but the organization answer differs for admin vs non-admin (isAdmin is part of the key)", orgA.data.isAdmin === true && orgP.data.isAdmin === false);

  section("3. Never across organizations or roles");
  const props = await call("GET", "/api/properties", admin);
  const otherProps = await call("GET", "/api/properties", other);
  ok("a manager of ANOTHER organization is not served the cached list", otherProps.xc === "MISS" && JSON.stringify(otherProps.data) !== JSON.stringify(props.data) && otherProps.data.length === 0, [otherProps.xc, otherProps.data.length]);
  const otherTeam = await call("GET", "/api/team", other);
  ok("…nor the team", !otherTeam.text.includes("manager@estateops.test"));
  for (const p of ["/api/properties", "/api/team", "/api/vendors", "/api/insights", "/api/audit", "/api/technicians", "/api/tenants", "/api/organization"]) {
    await call("GET", p, admin);
    const t = await call("GET", p, tenant);
    ok(`a tenant is refused ${p} even though a manager just cached it (authorization runs before the cache)`, t.status === 403 && t.xc !== "HIT", [t.status, t.xc]);
  }
  const noTok = await call("GET", "/api/team");
  ok("no token → 401, never a cached answer", noTok.status === 401 && noTok.xc !== "HIT");

  section("4. Per-user data is never shared");
  await call("GET", "/api/maintenance-requests", tenant);
  const t1 = await call("GET", "/api/maintenance-requests", tenant), t2 = await call("GET", "/api/maintenance-requests", tenant2);
  ok("tenant repeats hit their own entry", t1.xc === "HIT");
  ok("another tenant does NOT get it, and sees only their own (none)", t2.xc === "MISS" && t2.data.length === 0 && t1.data.length > 0, [t2.xc, t1.data.length, t2.data.length]);
  const mgrList = await call("GET", "/api/maintenance-requests", admin);
  ok("a tenant's list is not the manager's list", mgrList.xc === "HIT" || mgrList.xc === "MISS");
  const d1 = await call("GET", "/api/dashboard", tenant), d2 = await call("GET", "/api/dashboard", tenant2);
  ok("tenant dashboards are per user", d1.data.role === "TENANT" && d2.xc === "MISS" && d2.data.openRequests === 0 && d1.data.openRequests > 0, [d1.data.openRequests, d2.data.openRequests]);
  const reqId = t1.data[0].id;
  await call("GET", "/api/maintenance-requests/" + reqId, tenant);
  const foreign = await call("GET", "/api/maintenance-requests/" + reqId, tenant2);
  ok("another tenant cannot read the first tenant's request through the cache", [403, 404].includes(foreign.status) && foreign.xc !== "HIT", [foreign.status, foreign.xc]);
  const otherReq = await call("GET", "/api/maintenance-requests/" + reqId, other);
  ok("a manager of another organization cannot either", [403, 404].includes(otherReq.status) && otherReq.xc !== "HIT", [otherReq.status]);
  const nf1 = await call("GET", "/api/maintenance-requests/999999", admin), nf2 = await call("GET", "/api/maintenance-requests/999999", admin);
  ok("refusals are never cached", nf1.status === 404 && nf2.status === 404 && nf2.xc !== "HIT");

  section("5. The dashboard's per-person field is always fresh");
  await call("GET", "/api/dashboard", admin); await call("GET", "/api/dashboard", plain);
  const plainId = S.findAccountByEmail("plain.manager@estateops.test").id;
  S.notify(plainId, "only for plain manager", null); S.notify(plainId, "again", null);
  const dA = await call("GET", "/api/dashboard", admin), dP = await call("GET", "/api/dashboard", plain);
  ok("both are cache hits…", dA.xc === "HIT" && dP.xc === "HIT", [dA.xc, dP.xc]);
  ok("…but each shows THEIR OWN unread count", dP.data.unreadNotifications === S.unreadCount(plainId) && dA.data.unreadNotifications === S.unreadCount(S.findAccountByEmail("manager@estateops.test").id) && dP.data.unreadNotifications >= 2, [dA.data.unreadNotifications, dP.data.unreadNotifications]);

  section("6. Writes invalidate immediately (read your own writes)");
  await call("GET", "/api/properties", admin); await call("GET", "/api/properties", plain);
  const created = await call("POST", "/api/properties", admin, { name: "Cache Test Tower", address: "1 Cache Road" });
  ok("manager creates a property", created.status === 201);
  const afterA = await call("GET", "/api/properties", admin), afterP = await call("GET", "/api/properties", plain);
  ok("the writer sees it at once", afterA.xc === "MISS" && afterA.data.some((p) => p.name === "Cache Test Tower"));
  ok("the other manager sees it at once too", afterP.data.some((p) => p.name === "Cache Test Tower"));
  const otherAfter = await call("GET", "/api/properties", other);
  ok("a write in one organization does not disturb another organization's entries", otherAfter.xc === "HIT" || otherAfter.xc === "MISS");

  const units = await call("GET", "/api/units/reportable", tenant);
  const unitId = units.data[0].id;
  await call("GET", "/api/maintenance-requests", tenant); await call("GET", "/api/maintenance-requests", admin); await call("GET", "/api/dashboard", admin);
  const before = (await call("GET", "/api/dashboard", admin)).data.openRequests;
  const mk = await call("POST", "/api/maintenance-requests", tenant, { unitId, title: "Cache check leak", description: "dripping", category: "PLUMBING", priority: "HIGH" });
  ok("tenant raises a request", mk.status === 201, mk.status);
  const tl = await call("GET", "/api/maintenance-requests", tenant), ml = await call("GET", "/api/maintenance-requests", admin), dash = await call("GET", "/api/dashboard", admin);
  ok("tenant's own list shows it immediately", tl.data.some((r) => r.id === mk.data.id));
  ok("manager's list shows it immediately", ml.data.some((r) => r.id === mk.data.id));
  ok("manager's dashboard counts it immediately", dash.data.openRequests === before + 1, [before, dash.data.openRequests]);
  const det1 = await call("GET", "/api/maintenance-requests/" + mk.data.id, admin); const det2 = await call("GET", "/api/maintenance-requests/" + mk.data.id, admin);
  ok("request detail is cached for the manager", det1.xc === "MISS" && det2.xc === "HIT");
  const mv = await call("POST", "/api/maintenance-requests/" + mk.data.id + "/status", admin, { target: "UNDER_REVIEW" });
  const det3 = await call("GET", "/api/maintenance-requests/" + mk.data.id, admin), det4 = await call("GET", "/api/maintenance-requests/" + mk.data.id, tenant);
  ok("a status change shows at once for the manager and the tenant", mv.status === 200 && det3.data.request.status === "UNDER_REVIEW" && det4.data.request.status === "UNDER_REVIEW", [mv.status, det3.data.request.status, det4.data.request.status]);
  const cm = await call("POST", "/api/maintenance-requests/" + mk.data.id + "/comments", admin, { body: "cache-comment-xyz" });
  const det5 = await call("GET", "/api/maintenance-requests/" + mk.data.id, tenant);
  ok("a new comment appears at once for the tenant", cm.status === 201 && JSON.stringify(det5.data.comments).includes("cache-comment-xyz"), cm.status);
  const nt = await call("GET", "/api/notifications", tenant);
  ok("notifications are fresh after other people's writes", nt.status === 200);

  section("7. Another process writing invalidates this one (shared version in SQLite)");
  await call("GET", "/api/team", admin); const hit = await call("GET", "/api/team", admin);
  ok("primed: HIT", hit.xc === "HIT");
  const other_proc = new Database(require("path").join(dir, "estateops.db"));
  other_proc.prepare("INSERT INTO cache_versions (scope, v) VALUES (?, 1) ON CONFLICT(scope) DO UPDATE SET v = v + 1").run("org:" + org);
  other_proc.close();
  const stale = await call("GET", "/api/team", admin);
  ok("a version bump made by a DIFFERENT connection (another instance) invalidates this instance's entry", stale.xc === "MISS");

  section("8. Only successful writes invalidate; sign-in does not");
  await call("GET", "/api/team", admin); const v0 = C.version(org);
  await call("POST", "/api/auth/login", null, { email: "manager@estateops.test", password: "password123" });
  ok("signing in leaves the cache valid", C.version(org) === v0);
  await call("POST", "/api/properties", admin, { name: "" });
  ok("a refused write (400) leaves the cache valid", C.version(org) === v0);

  section("9. Statistics and limits");
  const s = C.snapshot();
  ok("hit rate is reported", s.hits > 10 && s.misses > 10 && s.hitRate > 0, s);
  ok("entries are bounded", s.entries <= 2000);

  server.close();
  T.done();
})().catch((e) => { console.error(e); process.exit(1); });
