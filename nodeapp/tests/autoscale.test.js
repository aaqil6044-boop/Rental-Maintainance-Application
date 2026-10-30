"use strict";
// Autoscaling: when the running instances hit their break point, ANOTHER instance must start and join the load balancer
// without losing requests; when the load goes away it must be drained and stopped. The decision rules are tested as pure
// functions; the behaviour is tested with real processes and real traffic.
const fs = require("fs"), os = require("os"), path = require("path"), http = require("http");
const assert = require("assert/strict");

const data = fs.mkdtempSync(path.join(os.tmpdir(), "eo-autoscale-"));
Object.assign(process.env, { DATA_DIR: data, UPLOAD_DIR: path.join(data, "uploads"), LOG_REQUESTS: "0", NODE_ENV: "development", SEED_DEV: "1", SEED_PASSWORD: "password123" });
const { decide, createAutoscaler, appSpawner } = require("../scripts/autoscale");

let passed = 0; const ok = (n) => { passed++; console.log("  ✓ " + n); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- decision rules (no processes) ---------- */
{
  const hot = { instances: 1, inflightPerInstance: 8, p95Ms: 900, rps: 40 };
  let st = {}; const seq = [0, 1, 2].map((i) => decide(st, hot, {}, 1e6 + i * 1000).action);
  assert.deepEqual(seq, ["none", "none", "up"]); ok("scale-up only after the saturation is SUSTAINED (3 s), not on a blip");
  st = {}; decide(st, hot, {}, 1e6); decide(st, { ...hot, inflightPerInstance: 0.1, p95Ms: 20 }, {}, 1e6 + 1000); decide(st, hot, {}, 1e6 + 2000);
  assert.equal(decide(st, hot, {}, 1e6 + 3000).action, "none"); ok("a quiet second resets the count");
  st = { lastChange: 1e6 }; for (let i = 0; i < 5; i++) var r = decide(st, hot, {}, 1e6 + 1000 + i * 1000);
  assert.equal(r.action, "none"); ok("no second scale-up during the cool-down after a change");
  st = {}; for (let i = 0; i < 5; i++) r = decide(st, { ...hot, instances: 4 }, { max: 4 }, 1e6 + i * 1000);
  assert.equal(r.action, "none"); assert.match(r.reason, /maximum/); ok("never exceeds the maximum, and says why");
  st = {}; for (let i = 0; i < 30; i++) r = decide(st, { instances: 3, inflightPerInstance: 0, p95Ms: 5, rps: 0 }, { min: 1 }, 1e6 + i * 1000);
  assert.equal(r.action, "down"); ok("scales down after 30 s of low load");
  st = {}; for (let i = 0; i < 40; i++) r = decide(st, { instances: 1, inflightPerInstance: 0, p95Ms: 0, rps: 0 }, { min: 1 }, 1e6 + i * 1000);
  assert.equal(r.action, "none"); ok("never goes below the minimum");
}

/* ---------- real processes ---------- */
const post = (port, body) => new Promise((resolve) => {
  const d = JSON.stringify(body);
  const q = http.request({ host: "127.0.0.1", port, method: "POST", path: "/api/auth/login", agent: false, headers: { "content-type": "application/json", "content-length": Buffer.byteLength(d) } },
    (x) => { x.resume(); x.on("end", () => resolve(x.statusCode)); });
  q.on("error", () => resolve(0)); q.write(d); q.end();
});

(async () => {
  console.log("Real traffic, real processes");
  require("../server");                                   // migrate this fresh database
  require("../src/seed")();
  const base = 19500 + Math.floor(Math.random() * 300);
  const as = createAutoscaler({ listen: base, basePort: base + 1, min: 1, max: 3, upInflight: 3, upP95Ms: 100000, upSustain: 2, cooldownSec: 3, downIdleSec: 6, spawnInstance: appSpawner({}), log: () => {} });
  await as.start();
  assert.equal(as.instances.length, 1); ok("starts with the minimum of 1 instance behind the balancer");

  let stop = false, total = 0, bad = 0;
  const worker = async () => { while (!stop) { const c = await post(base, { email: "manager@estateops.test", password: "password123" }); total++; if (c !== 200) bad++; } };
  const workers = Array.from({ length: 24 }, worker);        // 24 concurrent sign-ins: CPU-heavy, saturates one process

  const t0 = Date.now(); while (as.instances.length < 2 && Date.now() - t0 < 40000) await wait(250);
  assert.ok(as.instances.length >= 2, "no second instance started under saturation");
  ok(`break point detected → instance #2 started after ${Math.round((Date.now() - t0) / 1000)} s of load`);

  await wait(4000);
  const lbStat = await new Promise((r) => http.get({ host: "127.0.0.1", port: base, path: "/__lb", agent: false }, (x) => { let b = ""; x.on("data", (c) => b += c); x.on("end", () => r(JSON.parse(b))); }));
  const sharing = lbStat.backends.filter((b) => b.requests > 0).length;
  assert.ok(sharing >= 2, "the new instance received no traffic"); ok("the new instance joined the balancer and is serving traffic");

  stop = true; await Promise.all(workers);
  assert.equal(bad, 0, `${bad} of ${total} requests failed while scaling`); ok(`${total} requests during the scale-up, ${bad} failed`);

  const t1 = Date.now(); while (as.instances.length > 1 && Date.now() - t1 < 40000) await wait(500);
  assert.equal(as.instances.length, 1); ok("when the load stopped, the extra instance was drained and stopped (back to the minimum)");
  assert.ok(as.events.some((e) => /started/.test(e.event)) && as.events.some((e) => /stopped/.test(e.event))); ok("the scaling events are recorded");

  await as.stop();
  console.log(`\n${passed} autoscaling checks passed`);
  process.exit(0);
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
