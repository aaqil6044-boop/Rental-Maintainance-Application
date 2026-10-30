"use strict";
// A throw-away stand-in for EstateOps used to test the load generator without putting load on the real application.
const http = require("http");
function startMock({ delayMs = 5, failWith = null, loginFail = false, enforce = false, leak = false, expireFirstToken = false } = {}) {
  const stat = { total: 0, inflight: 0, maxInflight: 0, paths: {}, created: 0, headers: [], tokens: [], seq: [] };
  const opts = { delayMs, failWith, loginFail, enforce, leak }; const who = new Map(), owner = new Map(); let loginCount = 0;
  const server = http.createServer((req, res) => {
    stat.total++; stat.inflight++; stat.maxInflight = Math.max(stat.maxInflight, stat.inflight);
    const path = req.url.split("?")[0].replace(/\/\d+/g, "/{id}");
    const key = `${req.method} ${path}`; stat.paths[key] = (stat.paths[key] || 0) + 1; if (key !== "POST /api/auth/login") stat.seq.push(key);
    stat.headers.push(req.headers["authorization"] ? "auth" : "anon");
    let body = ""; req.on("data", (c) => (body += c));
    req.on("end", () => setTimeout(() => {
      stat.inflight--;
      const send = (code, obj, h = {}) => { res.writeHead(code, { "content-type": "application/json", ...h }); res.end(JSON.stringify(obj)); };
      if (key === "POST /api/auth/login") {
        if (opts.loginFail) return send(401, { message: "Wrong email or password." });
        let email = ""; try { email = JSON.parse(body).email || ""; } catch (e) {}
        const tk = "t." + Math.random().toString(36).slice(2); stat.tokens.push(tk); loginCount++;
        who.set(tk, { email, role: { t: "tenant", m: "manager", k: "technician", v: "vendor", a: "admin" }[email[0]] || "tenant", org: Number((/-o(\d+)@/.exec(email) || [0, 0])[1]) });
        return send(200, { token: tk, accountId: 1, role: "TENANT" });
      }
      if (opts.failWith) return send(opts.failWith, { message: "boom" });
      if (!req.headers["authorization"]) return send(401, { message: "no token" });
      const tk = String(req.headers["authorization"]).replace(/^Bearer /, ""), me = who.get(tk);
      if (expireFirstToken && stat.expired == null && me) { stat.expired = tk; }
      if (expireFirstToken && stat.expired === tk) return send(401, { message: "expired" });
      if (opts.enforce && me && !opts.leak) {
        const isMgr = me.role === "manager" || me.role === "admin";
        if (/^GET \/api\/(audit|team|insights|invitations|organization|vendors)$/.test(key) && !isMgr) return send(403, { message: "no" });
        if (key === "GET /api/vendors/me" && me.role !== "vendor") return send(403, { message: "no" });
        if (key.endsWith("/quotations") && me.role !== "vendor") return send(403, { message: "no" });
        if (key === "POST /api/maintenance-requests/{id}/status" && me.role === "tenant") return send(403, { message: "no" });
        const id = Number((/\/(\d+)/.exec(req.url) || [])[1]);
        const own = owner.get(id);
        if (own && /maintenance-requests\/\d+(\/comments|\/status)?/.test(req.url) && ((own.org !== me.org) || (me.role === "tenant" && own.email !== me.email))) return send(404, { message: "not found" });
      }
      if (key === "GET /api/units/reportable") return send(200, [{ id: 1 }]);
      if (key === "GET /api/maintenance-requests") return send(200, [{ id: 11 }, { id: 12 }]);
      if (key === "GET /api/maintenance-requests/{id}" && /\/(11|12)$/.test(req.url.split("?")[0])) return send(200, { request: { id: 11 }, quotations: [{ id: 5, status: "PENDING" }], expenses: [{ id: 6, approved: false }] });
      if (key === "GET /api/maintenance-requests/{id}") return send(200, { request: { id: 11 } });
      if (key === "POST /api/maintenance-requests") { stat.created++; owner.set(100 + stat.created, { org: me ? me.org : 0, email: me ? me.email : "" }); return send(201, { id: 100 + stat.created }); }
      if (key.endsWith("/comments") || key.endsWith("/expenses")) return send(201, { id: 1 });
      if (key.endsWith("/status") || key.endsWith("/assign") || key.endsWith("/decision") || key.endsWith("/approve")) return send(200, { ok: true });
      if (key.endsWith("/quotations")) return send(201, { id: 5 });
      if (key === "GET /redirect") return send(302, {}, { location: "/elsewhere" });
      return send(200, {});
    }, opts.delayMs));
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({
    url: `http://127.0.0.1:${server.address().port}`, stat, opts, logins: () => loginCount, close: () => new Promise((r) => { server.closeAllConnections && server.closeAllConnections(); server.close(r); }),
  })));
}
const accounts = () => [
  { persona: "tenant", email: "t1@loadtest.invalid", password: "x", id: 1 }, { persona: "tenant", email: "t2@loadtest.invalid", password: "x", id: 2 },
  { persona: "manager", email: "m1@loadtest.invalid", password: "x", id: 3 }, { persona: "technician", email: "k1@loadtest.invalid", password: "x", id: 4 },
];
/** Two organizations and all five user types, for multi-tenant and authorization tests. */
const accountsFull = () => [
  { persona: "tenant", email: "t1-o0@loadtest.invalid", password: "x", id: 1, org: 0 }, { persona: "tenant", email: "t2-o0@loadtest.invalid", password: "x", id: 2, org: 0 },
  { persona: "tenant", email: "t1-o1@loadtest.invalid", password: "x", id: 11, org: 1 },
  { persona: "manager", email: "m1-o0@loadtest.invalid", password: "x", id: 3, org: 0 }, { persona: "manager", email: "m1-o1@loadtest.invalid", password: "x", id: 13, org: 1 },
  { persona: "technician", email: "k1-o0@loadtest.invalid", password: "x", id: 4, org: 0 },
  { persona: "vendor", email: "v1-o0@loadtest.invalid", password: "x", id: 5, org: 0, vendorId: 1 }, { persona: "vendor", email: "v1-o1@loadtest.invalid", password: "x", id: 15, org: 1, vendorId: 2 },
  { persona: "admin", email: "a1-o0@loadtest.invalid", password: "x", id: 6, org: 0 },
];
module.exports = { startMock, accounts, accountsFull };
