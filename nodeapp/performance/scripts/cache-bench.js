#!/usr/bin/env node
"use strict";
// Cache benchmark: the SAME requests against the SAME data, once with the response cache OFF and once ON.
//
//   node performance/scripts/cache-bench.js [--size 4000] [--requests 600] [--concurrency 8] [--mixed-seconds 15]
//
// 1. builds a database bigger than the sample data (properties, units, thousands of requests, events, comments, notifications, audit rows),
// 2. for each variant starts a fresh server on a copy of that database (CACHE=off, then CACHE=on),
// 3. READ test: every read endpoint is called --requests times at --concurrency, as a manager and as a tenant, latency measured per endpoint,
// 4. MIXED test: realistic traffic where 2% and then 10% of calls are writes (new comments), which invalidate the cache,
// 5. prints a side-by-side table and saves performance/reports/cache-bench-<time>.json.
// The load generator and the server share this machine; run it on an otherwise idle computer and compare the two columns, not absolute numbers.
const { spawn, spawnSync } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path"), http = require("http");
const ROOT = path.join(__dirname, "..", "..");
const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };

/* ------------------------------------------------------------------ seed mode (runs in a child so the database module loads cleanly) */
if (process.argv[2] === "__seed") {
  const size = Number(process.argv[3]);
  const S = require("../../src/store"); require("../../src/seed")();
  const mgr = S.findAccountByEmail("manager@estateops.test"), tenant = S.findAccountByEmail("tenant@estateops.test"), tech = S.findAccountByEmail("tech@estateops.test");
  const cats = ["PLUMBING", "ELECTRICAL", "HVAC", "APPLIANCE", "OTHER"], prios = ["LOW", "MEDIUM", "HIGH", "URGENT"], units = [];
  S.db.transaction(() => {
    for (let p = 0; p < 30; p++) {
      const prop = S.createProperty({ name: `Bench Tower ${p + 1}`, address: `${p + 1} Bench Road`, propertyType: "apartment", managerId: mgr.id, orgId: mgr.org_id });
      for (let u = 0; u < 40; u++) { const unit = S.createUnit(prop.id, `B${p + 1}-${u + 1}`); units.push(unit.id); if (units.length <= 60) S.assignTenantToUnit(tenant.id, unit.id); }
    }
    for (let i = 0; i < size; i++) {
      const r = S.createRequest({ unitId: units[i % units.length], reporterId: tenant.id, title: `Bench issue ${i + 1}: ${cats[i % 5].toLowerCase()} fault`, description: "Reported during benchmark seeding. ".repeat(3), category: cats[i % 5], priority: prios[i % 4] });
      S.addEvent(r.id, tenant.id, null, "REPORTED", "Request raised");
      if (i % 3 === 0) S.addComment(r.id, mgr.id, "Looking into this.");
      if (i % 5 === 0) S.db.prepare("UPDATE requests SET technician_id = ?, status = 'ASSIGNED' WHERE id = ?").run(tech.id, r.id);
    }
    for (let i = 0; i < 300; i++) S.notify(mgr.id, `Bench notification ${i}`, null);
    for (let i = 0; i < 500; i++) S.audit(mgr, "BENCH", "request", 1, `row ${i}`);
  })();
  S.db.pragma("wal_checkpoint(TRUNCATE)");
  process.exit(0);
}

/* ------------------------------------------------------------------ helpers */
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (a, p) => a.length ? a[Math.min(a.length - 1, Math.ceil(a.length * p) - 1)] : 0;
const stats = (ms) => { const s = ms.slice().sort((a, b) => a - b); return { n: s.length, avg: s.reduce((x, y) => x + y, 0) / (s.length || 1), p50: pct(s, 0.5), p95: pct(s, 0.95), p99: pct(s, 0.99) }; };
const f1 = (x) => (x == null ? "—" : x.toFixed(2));

function client(port, conc) {
  const agent = new http.Agent({ keepAlive: true, maxSockets: conc });
  return (method, p, token, body) => new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null, t0 = process.hrtime.bigint();
    const r = http.request({ host: "127.0.0.1", port, method, path: p, agent, headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}), ...(data ? { "content-length": Buffer.byteLength(data) } : {}) } }, (x) => {
      let b = ""; x.on("data", (c) => b += c);
      x.on("end", () => resolve({ status: x.statusCode, ms: Number(process.hrtime.bigint() - t0) / 1e6, hit: x.headers["x-cache"] === "HIT", body: b }));
    });
    r.on("error", reject); if (data) r.write(data); r.end();
  });
}
async function pool(total, conc, fn) { let i = 0; await Promise.all(Array.from({ length: conc }, async () => { while (i < total) { const k = i++; await fn(k); } })); }

/* ------------------------------------------------------------------ one variant */
async function variant(label, cacheMode, baseDir, port, o) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eo-bench-")); fs.cpSync(baseDir, dir, { recursive: true });
  const srv = spawn(process.execPath, ["server.js"], { cwd: ROOT, stdio: "ignore", env: { ...process.env, DATA_DIR: dir, UPLOAD_DIR: path.join(dir, "uploads"), PORT: String(port), CACHE: cacheMode, NODE_ENV: "development", LOG_REQUESTS: "0", SEED_DEV: "0" } });
  try {
    const call = client(port, o.concurrency);
    for (let i = 0; i < 80; i++) { try { if ((await call("GET", "/health")).status === 200) break; } catch {} await wait(250); }
    const login = async (email) => JSON.parse((await call("POST", "/api/auth/login", null, { email, password: "password123" })).body).token;
    const mgr = await login("manager@estateops.test"), ten = await login("tenant@estateops.test");
    const ids = JSON.parse((await call("GET", "/api/maintenance-requests?limit=50", mgr)).body).map((r) => r.id);
    const hot = ids.slice(0, 20);
    const managerEps = ["/api/dashboard", "/api/insights", "/api/audit", "/api/team", "/api/properties", "/api/vendors", "/api/technicians", "/api/tenants", "/api/units/reportable", "/api/maintenance-requests", "/api/maintenance-requests?status=REPORTED&limit=50", "/api/maintenance-requests/@id", "/api/notifications", "/api/organization"];
    const tenantEps = ["/api/dashboard", "/api/maintenance-requests", "/api/units/reportable", "/api/notifications"];
    const out = { label, read: {}, mixed: {} };
    const run = async (name, ep, token) => {
      const ms = [], t = []; let hits = 0, bad = 0, k = 0;
      const url = () => ep.replace("@id", hot[k++ % hot.length]);
      for (let w = 0; w < 20; w++) await call("GET", url(), token);                 // warm-up, not counted
      const t0 = Date.now();
      await pool(o.requests, o.concurrency, async () => { const r = await call("GET", url(), token); if (r.status !== 200) bad++; if (r.hit) hits++; ms.push(r.ms); });
      out.read[name] = { ...stats(ms), hitPct: Math.round((hits / ms.length) * 100), errors: bad, rps: Math.round(ms.length / ((Date.now() - t0) / 1000)) };
    };
    for (const ep of managerEps) await run("manager " + ep.replace("/api/", ""), ep, mgr);
    for (const ep of tenantEps) await run("tenant  " + ep.replace("/api/", ""), ep, ten);

    for (const writePct of [2, 10]) {
      const ms = [], wms = []; let hits = 0, reads = 0, writes = 0, bad = 0; const end = Date.now() + o.mixedSeconds * 1000; let seq = 0;
      const t0 = Date.now();
      await Promise.all(Array.from({ length: o.concurrency }, async () => {
        while (Date.now() < end) {
          const n = seq++;
          if ((n * 7919) % 100 < writePct) { const r = await call("POST", `/api/maintenance-requests/${hot[n % hot.length]}/comments`, mgr, { body: "bench " + n }); if (r.status !== 201) bad++; wms.push(r.ms); writes++; }
          else { const ep = managerEps[n % managerEps.length].replace("@id", hot[n % hot.length]); const r = await call("GET", ep, mgr); if (r.status !== 200) bad++; if (r.hit) hits++; ms.push(r.ms); reads++; }
        }
      }));
      const secs = (Date.now() - t0) / 1000;
      out.mixed[writePct + "% writes"] = { reads, writes, errors: bad, rps: Math.round((reads + writes) / secs), hitPct: Math.round((hits / Math.max(1, reads)) * 100), read: stats(ms), write: stats(wms) };
    }
    return out;
  } finally { srv.kill("SIGKILL"); await wait(300); }
}

(async () => {
  const o = { size: Number(arg("size", 4000)), requests: Number(arg("requests", 600)), concurrency: Number(arg("concurrency", 8)), mixedSeconds: Number(arg("mixed-seconds", 15)) };
  console.log(`Building a test database (${o.size} requests, 30 properties, 1,200 units)…`);
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "eo-bench-base-"));
  const seed = spawnSync(process.execPath, [__filename, "__seed", String(o.size)], { cwd: ROOT, env: { ...process.env, DATA_DIR: base, UPLOAD_DIR: path.join(base, "uploads"), NODE_ENV: "development", SEED_DEV: "1", SEED_PASSWORD: "password123", LOG_REQUESTS: "0" }, encoding: "utf8" });
  if (seed.status !== 0) { console.error("Seeding failed:\n" + (seed.stderr || seed.stdout)); process.exit(2); }
  const port = 18900 + Math.floor(Math.random() * 500);
  console.log(`Running each variant: ${o.requests} calls per endpoint at concurrency ${o.concurrency}, then ${o.mixedSeconds}s mixed traffic ×2…\n`);
  const off = await variant("cache OFF", "off", base, port, o); console.log("  cache OFF done");
  const on = await variant("cache ON", "on", base, port + 1, o); console.log("  cache ON done\n");

  const ratio = (a, b) => (b > 0 ? a / b : null);
  console.log("READ-ONLY, per endpoint (milliseconds per request; lower is better)");
  console.log("endpoint".padEnd(52) + "OFF avg   OFF p95 |  ON avg    ON p95   hit%  | faster (avg)");
  const rows = [];
  for (const k of Object.keys(off.read)) {
    const a = off.read[k], b = on.read[k], x = ratio(a.avg, b.avg); rows.push({ endpoint: k, off: a, on: b, speedup: x });
    console.log(k.padEnd(52) + f1(a.avg).padStart(7) + f1(a.p95).padStart(10) + " | " + f1(b.avg).padStart(7) + f1(b.p95).padStart(10) + String(b.hitPct + "%").padStart(7) + "  | " + (x ? "x" + x.toFixed(1) : "—").padStart(8));
  }
  const tot = (v) => Object.values(v.read).reduce((s, r) => s + r.avg, 0) / Object.keys(v.read).length;
  console.log(`\nAverage across endpoints: OFF ${f1(tot(off))} ms → ON ${f1(tot(on))} ms  (x${(tot(off) / tot(on)).toFixed(2)})`);
  console.log("\nMIXED TRAFFIC (reads and writes together)");
  console.log("writes".padEnd(12) + "variant".padEnd(11) + "req/s".padStart(7) + "read avg".padStart(10) + "read p95".padStart(10) + "hit%".padStart(7) + "errors".padStart(8));
  for (const w of Object.keys(off.mixed)) for (const v of [off, on]) { const m = v.mixed[w]; console.log(w.padEnd(12) + v.label.padEnd(11) + String(m.rps).padStart(7) + f1(m.read.avg).padStart(10) + f1(m.read.p95).padStart(10) + String(m.hitPct + "%").padStart(7) + String(m.errors).padStart(8)); }
  const errs = [off, on].flatMap((v) => [...Object.values(v.read).map((r) => r.errors), ...Object.values(v.mixed).map((m) => m.errors)]).reduce((a, b) => a + b, 0);
  console.log(`\nErrors during the whole benchmark: ${errs}`);
  const dirR = path.join(ROOT, "performance", "reports"); fs.mkdirSync(dirR, { recursive: true });
  const file = path.join(dirR, `cache-bench-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(file, JSON.stringify({ schema: "estateops.cache-benchmark.v1", options: o, cpuCores: os.cpus().length, off, on, rows }, null, 2));
  console.log("Saved " + path.relative(ROOT, file));
  process.exit(errs ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
