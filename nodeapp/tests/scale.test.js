"use strict";
// Scale-out integration test: REAL processes. Two app instances share one database behind the load balancer, then a
// 2-worker cluster. Proves the things scaling must not break: a write on one instance is seen by the other, a login
// token issued by one instance works on the other, every instance serves traffic, and losing an instance loses no requests.
const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path"), http = require("http");
const assert = require("assert/strict");
const ROOT = path.join(__dirname, "..");
const { create } = require("../scripts/balancer");

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const procs = [];
function launch(script, env) { const p = spawn(process.execPath, [script], { cwd: ROOT, env: { ...process.env, ...env }, stdio: "ignore" }); procs.push(p); return p; }
function call(port, method, p, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({ host: "127.0.0.1", port, method, path: p, agent: false, headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}), ...(data ? { "content-length": Buffer.byteLength(data) } : {}) } },
      (x) => { let b = ""; x.on("data", (c) => b += c); x.on("end", () => { let j = null; try { j = JSON.parse(b); } catch {} resolve({ status: x.statusCode, headers: x.headers, body: j }); }); });
    r.on("error", reject); if (data) r.write(data); r.end();
  });
}
async function ready(port) { for (let i = 0; i < 120; i++) { try { if ((await call(port, "GET", "/health")).status === 200) return; } catch {} await wait(250); } throw new Error("server on " + port + " did not start"); }
const stop = () => procs.splice(0).forEach((p) => { try { p.kill("SIGKILL"); } catch {} });
process.on("exit", stop);

(async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "eo-scaletest-"));
  const env = { DATA_DIR: data, UPLOAD_DIR: path.join(data, "uploads"), LOG_REQUESTS: "0", NODE_ENV: "development", SEED_PASSWORD: "password123", TRUST_PROXY: "1" };
  const base = 19000 + Math.floor(Math.random() * 800);
  const checks = []; const ok = (name) => { checks.push(name); console.log("  ✓ " + name); };

  console.log("Two instances behind the load balancer, one shared database");
  const a = base, b = base + 1, lbPort = base + 2;
  launch("scripts/dev.js", { ...env, PORT: String(a), SEED_DEV: "1" }); await ready(a);
  launch("server.js", { ...env, PORT: String(b), EO_SECONDARY: "1" }); await ready(b);
  const lb = create({ backends: [`127.0.0.1:${a}`, `127.0.0.1:${b}`], strategy: "round-robin", checkMs: 500 });
  await new Promise((r) => lb.server.listen(lbPort, "127.0.0.1", r));

  const login = await call(lbPort, "POST", "/api/auth/login", { email: "manager@estateops.test", password: "password123" });
  assert.equal(login.status, 200); const token = login.body.token;
  ok("sign-in works through the balancer (async password check)");
  const bad = await call(lbPort, "POST", "/api/auth/login", { email: "manager@estateops.test", password: "wrong-password" });
  assert.equal(bad.status, 401); ok("a wrong password is still refused with 401");

  const served = new Set();
  for (let i = 0; i < 20; i++) { const r = await call(lbPort, "GET", "/api/dashboard", null, token); assert.equal(r.status, 200); served.add(r.headers["x-served-by"]); }
  assert.equal(served.size, 2); ok("a token issued once is accepted by BOTH instances; both serve traffic");

  const name = "Scale probe " + Date.now();
  const created = await call(a, "POST", "/api/properties", { name, address: "1 Test Road" }, token);
  assert.equal(created.status, 201);
  const onB = (await call(b, "GET", "/api/properties", null, token)).body; const listB = Array.isArray(onB) ? onB : (onB.items || onB.content || []);
  assert.ok(JSON.stringify(listB).includes(name), "instance B did not see the property created on instance A");
  ok("a write on instance A is immediately visible on instance B (shared database)");

  // failover: kill instance B while requests keep flowing
  const procB = procs[1]; let failures = 0, total = 0, killed = false;
  const driver = (async () => { for (let i = 0; i < 80; i++) { if (i === 20 && !killed) { killed = true; procB.kill("SIGKILL"); } const r = await call(lbPort, "GET", "/api/dashboard", null, token).catch(() => ({ status: 0 })); total++; if (r.status !== 200) failures++; await wait(25); } })();
  await driver;
  assert.equal(failures, 0, `${failures}/${total} requests failed during failover`); ok(`killing an instance mid-traffic lost ${failures} of ${total} requests (GETs are retried on the survivor)`);
  const st = (await call(lbPort, "GET", "/__lb")).body;
  assert.equal(st.backends[1].healthy, false); ok("the balancer marked the dead instance DOWN and stopped sending it traffic");
  await lb.close(); stop(); await wait(500);

  console.log("Worker cluster (one port, 2 workers)");
  const cport = base + 10;
  const data2 = fs.mkdtempSync(path.join(os.tmpdir(), "eo-scaletest-"));
  const cluster = launch("scripts/cluster.js", { ...env, DATA_DIR: data2, UPLOAD_DIR: path.join(data2, "uploads"), PORT: String(cport), WORKERS: "2", SEED_DEV: "1" });
  await ready(cport);
  const l2 = await call(cport, "POST", "/api/auth/login", { email: "manager@estateops.test", password: "password123" });
  assert.equal(l2.status, 200); ok("the cluster seeded the database once and serves sign-ins");
  const burst = await Promise.all(Array.from({ length: 40 }, () => call(cport, "GET", "/api/dashboard", null, l2.body.token)));
  assert.ok(burst.every((r) => r.status === 200)); ok("40 concurrent requests across workers all succeeded");
  cluster.kill("SIGTERM"); await wait(1800); stop();

  console.log(`\n${checks.length} scale-out checks passed`);
  process.exit(0);
})().catch((e) => { console.error("FAILED:", e.message); stop(); process.exit(1); });
