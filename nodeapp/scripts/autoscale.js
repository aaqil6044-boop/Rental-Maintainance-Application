"use strict";
// Autoscaler: runs the load balancer and a pool of app instances, and starts ANOTHER instance when the current ones hit
// their break point, then stops it again when the load goes away.
//
//   node scripts/autoscale.js --listen 9000 --min 1 --max 4 [--base-port 8101]
//
// Break point = saturation, seen from the balancer's own measurements (nothing is guessed):
//   * in-flight requests per instance >= --up-inflight (default 6): requests are queuing behind a busy process, OR
//   * p95 latency over the last 5 s >= --up-p95 (default 800 ms) while traffic is flowing,
//   sustained for --up-sustain consecutive seconds (default 3), so a one-second blip does not start a process.
// After a scale-up there is a --cooldown (default 10 s) to let the new instance take its share before judging again.
// Scale-down: load stays low (in-flight < 0.5 per instance and p95 < 200 ms) for --down-idle seconds (default 30): the
// newest instance is DRAINED (no new traffic, in-flight requests finish) and stopped. Never below --min.
// Limit: every instance shares one SQLite database, so this scales app CPU on ONE host; separate hosts need PostgreSQL.
const { spawn } = require("child_process");
const path = require("path");
const { create } = require("./balancer");

const DEFAULTS = { min: 1, max: 4, upInflight: 6, upP95Ms: 800, upSustain: 3, cooldownSec: 10, downIdleSec: 30, downInflight: 0.5, downP95Ms: 200 };

/** Pure decision: given the live figures, say what to do. Easy to test without any processes. */
function decide(state, sample, cfg = DEFAULTS, now = Date.now()) {
  const c = { ...DEFAULTS, ...cfg };
  const busy = sample.rps > 0 && (sample.inflightPerInstance >= c.upInflight || sample.p95Ms >= c.upP95Ms);
  const quiet = sample.inflightPerInstance < c.downInflight && sample.p95Ms < c.downP95Ms;
  state.busyTicks = busy ? (state.busyTicks || 0) + 1 : 0;
  state.quietTicks = quiet ? (state.quietTicks || 0) + 1 : 0;
  const cooling = state.lastChange && now - state.lastChange < c.cooldownSec * 1000;
  if (!cooling && state.busyTicks >= c.upSustain && sample.instances < c.max)
    return { action: "up", reason: `break point reached: ${sample.inflightPerInstance.toFixed(1)} in flight per instance, p95 ${Math.round(sample.p95Ms)} ms, for ${state.busyTicks}s` };
  if (!cooling && state.quietTicks >= c.downIdleSec && sample.instances > c.min)
    return { action: "down", reason: `load has been low for ${state.quietTicks}s` };
  return { action: "none", reason: busy && sample.instances >= c.max ? "saturated but already at the maximum number of instances" : "" };
}

function createAutoscaler(opts) {
  const cfg = { ...DEFAULTS, ...opts };
  const { listen, basePort, spawnInstance, log = () => {} } = cfg;
  const lb = create({ backends: [], dynamic: true, strategy: cfg.strategy || "round-robin", checkMs: 1000 });
  const instances = []; const events = []; const state = {};
  let timer = null;
  const note = (e) => { events.push({ at: new Date().toISOString(), ...e }); log(`[autoscale] ${e.event}${e.instances != null ? " → " + e.instances + " instance(s)" : ""}${e.reason ? " (" + e.reason + ")" : ""}`); };

  async function addInstance(reason) {
    const used = new Set(instances.map((i) => i.port)); let p = basePort; while (used.has(p)) p++;
    const proc = await spawnInstance(p);
    const name = `127.0.0.1:${p}`;
    const t = Date.now(); let up = false;
    while (Date.now() - t < 30000) { if (await ping(p)) { up = true; break; } await new Promise((r) => setTimeout(r, 200)); }
    if (!up) { try { proc.kill("SIGKILL"); } catch {} throw new Error(`instance on :${p} did not become ready`); }
    instances.push({ port: p, name, proc }); lb.addBackend(name);
    note({ event: "instance started on :" + p, instances: instances.length, reason }); return p;
  }
  async function removeInstance(reason) {
    const inst = instances[instances.length - 1]; if (!inst) return;
    instances.pop(); await lb.drain(inst.name); try { inst.proc.kill("SIGTERM"); } catch {}
    note({ event: "instance stopped on :" + inst.port, instances: instances.length, reason });
  }
  let busyOp = false;
  function tick() {
    if (busyOp) return;
    const sample = lb.stats(5000);
    const d = decide(state, sample, cfg);
    if (d.action === "none") return;
    busyOp = true; state.lastChange = Date.now(); state.busyTicks = 0; state.quietTicks = 0;
    (d.action === "up" ? addInstance(d.reason) : removeInstance(d.reason)).catch((e) => note({ event: "scaling failed: " + e.message })).finally(() => { busyOp = false; state.lastChange = Date.now(); });
  }
  return {
    lb, instances, events,
    async start() { for (let i = 0; i < cfg.min; i++) await addInstance("minimum"); await new Promise((r) => lb.server.listen(listen, "127.0.0.1", r)); timer = setInterval(tick, 1000); },
    async stop() { clearInterval(timer); await lb.close(); for (const i of instances.splice(0)) { try { i.proc.kill("SIGTERM"); } catch {} } },
    tick,
  };
}
const http = require("http");
const ping = (port) => new Promise((r) => { const q = http.get({ host: "127.0.0.1", port, path: "/health", agent: false, timeout: 1000 }, (x) => { x.resume(); r(x.statusCode === 200); }); q.on("error", () => r(false)); q.on("timeout", () => { q.destroy(); r(false); }); });

/** The standard way to start one EstateOps instance (secondary: the launcher already migrated/seeded). */
function appSpawner(env) {
  return async (port) => spawn(process.execPath, [path.join(__dirname, "..", "server.js")], { env: { ...process.env, ...env, PORT: String(port), EO_SECONDARY: "1", TRUST_PROXY: "1" }, stdio: "ignore" });
}

module.exports = { decide, createAutoscaler, appSpawner, DEFAULTS };

if (require.main === module) {
  const a = process.argv.slice(2); const get = (k, d) => { const i = a.indexOf("--" + k); return i >= 0 ? a[i + 1] : d; };
  process.env.NODE_ENV = process.env.NODE_ENV || "production";
  require("../server");                                  // load the database module once: migrations
  const config = require("../src/config");
  if (config.seedDev) require("../src/seed")();
  require("../src/loadtest/manager").recover();
  const as = createAutoscaler({
    listen: Number(get("listen", 9000)), basePort: Number(get("base-port", 8101)), min: Number(get("min", 1)), max: Number(get("max", 4)),
    upInflight: Number(get("up-inflight", DEFAULTS.upInflight)), upP95Ms: Number(get("up-p95", DEFAULTS.upP95Ms)), upSustain: Number(get("up-sustain", DEFAULTS.upSustain)),
    cooldownSec: Number(get("cooldown", DEFAULTS.cooldownSec)), downIdleSec: Number(get("down-idle", DEFAULTS.downIdleSec)),
    spawnInstance: appSpawner({}), log: (m) => console.log(m),
  });
  as.start().then(() => console.log(`[autoscale] balancer on :${get("listen", 9000)}, ${get("min", 1)}–${get("max", 4)} instances; open http://127.0.0.1:${get("listen", 9000)}   (status: /__lb)`));
  const stop = () => as.stop().then(() => process.exit(0)); process.once("SIGINT", stop); process.once("SIGTERM", stop);
}
