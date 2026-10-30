#!/usr/bin/env node
"use strict";
// Scalability test: runs the SAME load profile against different server topologies and reports what each one sustained.
//
//   node performance/scripts/scale.js [--topologies single,cluster,balanced] [--workers 2] [--config performance/config/scale.yaml]
//
//   single    one Node process (the baseline)
//   cluster   scripts/cluster.js: N workers sharing one port
//   balanced  N separate instances behind scripts/balancer.js (round-robin), sharing one database, like several app servers
//   autoscale starts with ONE instance behind the balancer; scripts/autoscale.js starts more when the break point is reached (max N)
//
// Every topology gets a fresh database with sample data. The balanced topology also proves the balancer: traffic is spread
// across all instances, and one instance is killed mid-test to show failover. Output: a table plus performance/reports/scale-*.json.
// Honest limit: on one machine the load generator competes with the servers for CPU, so absolute numbers are pessimistic;
// compare the topologies with each other, not with production.
const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path"), http = require("http");
const ROOT = path.join(__dirname, "..", "..");

const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const TOPOLOGIES = String(arg("topologies", "single,cluster,balanced,autoscale")).split(",");
const WORKERS = Number(arg("workers", Math.min(4, os.availableParallelism ? os.availableParallelism() : os.cpus().length)));
const CONFIG = path.resolve(ROOT, arg("config", "performance/config/scale.yaml"));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const get = (port, p) => new Promise((resolve) => { const r = http.get({ host: "127.0.0.1", port, path: p, agent: false, timeout: 2000 }, (x) => { let b = ""; x.on("data", (c) => b += c); x.on("end", () => { try { resolve({ status: x.statusCode, body: JSON.parse(b) }); } catch { resolve({ status: x.statusCode, body: null }); } }); }); r.on("error", () => resolve(null)); r.on("timeout", () => { r.destroy(); resolve(null); }); });
async function until(port, p = "/health", ms = 30000) { const t = Date.now(); while (Date.now() - t < ms) { const r = await get(port, p); if (r && r.status === 200) return; await wait(250); } throw new Error(`Nothing answered on :${port}${p}`); }
const procs = [];
const launch = (cmd, args, env) => { const p = spawn(process.execPath, [cmd, ...args], { cwd: ROOT, env: { ...process.env, ...env }, stdio: ["ignore", "ignore", "pipe"] }); p.stderr.on("data", () => {}); procs.push(p); return p; };
const killAll = () => { for (const p of procs.splice(0)) { try { p.kill("SIGTERM"); } catch {} } };
process.on("exit", killAll); process.on("SIGINT", () => { killAll(); process.exit(130); });
const free = () => 18000 + Math.floor(Math.random() * 1500);

async function runLoad(url, label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eo-scale-"));
  const code = await new Promise((resolve) => {
    const p = spawn(process.execPath, ["performance/scripts/cli.js", "run", "--config", CONFIG, "--url", url, "--email", "manager@estateops.test", "--password", "password123", "--report-dir", dir, "--no-open"], { cwd: ROOT, stdio: ["ignore", "pipe", "inherit"] });
    p.stdout.on("data", (d) => { if (process.env.SCALE_DEBUG) process.stdout.write(d); }); p.on("exit", resolve);
  });
  const sub = fs.readdirSync(dir).filter((d) => fs.existsSync(path.join(dir, d, "report.json")))[0];
  if (!sub) throw new Error(`The load run for "${label}" produced no report (exit ${code}).`);
  const rep = JSON.parse(fs.readFileSync(path.join(dir, sub, "report.json"), "utf8")); const run = rep.run || rep;
  return { exit: code, summary: run.summary, stages: run.summary.stages || [] };
}

async function topology(kind) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "eo-data-"));
  const base = { DATA_DIR: data, UPLOAD_DIR: path.join(data, "uploads"), LOG_REQUESTS: "0", SEED_DEV: "1", SEED_PASSWORD: "password123", NODE_ENV: "development", TRUST_PROXY: "1" };
  const info = { kind, processes: 1, balancer: null };
  let url, lb = null, instances = [], auto = null;
  if (kind === "single") { const port = free(); launch("scripts/dev.js", [], { ...base, PORT: String(port) }); url = `http://127.0.0.1:${port}`; await until(port); }
  else if (kind === "cluster") { const port = free(); launch("scripts/cluster.js", [], { ...base, PORT: String(port), WORKERS: String(WORKERS) }); url = `http://127.0.0.1:${port}`; info.processes = WORKERS; await until(port); }
  else if (kind === "balanced") {
    const seed = free(); const first = launch("scripts/dev.js", [], { ...base, PORT: String(seed) }); await until(seed);   // the first instance migrates + seeds
    instances.push({ port: seed, proc: first });
    for (let i = 1; i < WORKERS; i++) { const port = seed + i; const p = launch("server.js", [], { ...base, SEED_DEV: "0", EO_SECONDARY: "1", PORT: String(port) }); instances.push({ port, proc: p }); await until(port); }
    const { create } = require("../../scripts/balancer");
    lb = create({ backends: instances.map((i) => `127.0.0.1:${i.port}`), strategy: "round-robin", checkMs: 1000 });
    const lbPort = seed + 100; await new Promise((r) => lb.server.listen(lbPort, "127.0.0.1", r)); url = `http://127.0.0.1:${lbPort}`; info.processes = instances.length; info.balancer = "round-robin";
  } else if (kind === "autoscale") {
    const seed = free(); const first = launch("scripts/dev.js", [], { ...base, PORT: String(seed) }); await until(seed);   // migrate + seed once, then hand over
    first.kill("SIGTERM"); await wait(800);
    const { createAutoscaler, appSpawner } = require("../../scripts/autoscale");
    const lbPort = seed + 100;
    auto = createAutoscaler({ listen: lbPort, basePort: seed + 1, min: 1, max: WORKERS, upInflight: 6, upSustain: 3, cooldownSec: 8, downIdleSec: 600, spawnInstance: appSpawner({ ...base, SEED_DEV: "0" }), log: process.env.SCALE_DEBUG ? console.log : () => {} });
    await auto.start(); url = `http://127.0.0.1:${lbPort}`; info.balancer = "round-robin + autoscaler";
  } else throw new Error(`Unknown topology "${kind}".`);

  let killed = null;
  if (lb && instances.length > 1) setTimeout(() => { const v = instances[instances.length - 1]; killed = v.port; try { v.proc.kill("SIGKILL"); } catch {} }, 55000);   // failover: lose one instance mid-test
  const r = await runLoad(url, kind);
  if (lb) { info.lb = (await get(Number(url.split(":").pop()), "/__lb")).body; info.killedInstance = killed; await lb.close(); }
  if (auto) { info.processes = auto.instances.length; info.scaling = auto.events; await auto.stop(); }
  killAll(); await wait(500);
  return { ...info, url, exit: r.exit, summary: r.summary, stages: r.stages };
}

(async () => {
  const out = [];
  for (const k of TOPOLOGIES) { process.stdout.write(`\n▶ ${k}: `); try { const r = await topology(k); out.push(r); const s = r.summary; console.log(`${s.totals.requests} requests, ${s.avgRps} req/s, p95 ${s.latency.p95} ms, errors ${s.errorRatePct}%`); } catch (e) { console.log("FAILED: " + e.message); killAll(); out.push({ kind: k, error: e.message }); } }
  const ok = out.filter((o) => o.summary), base = ok.find((o) => o.kind === "single") || ok[0];
  console.log("\nTopology   Procs  Req/s  vs single   p50 ms   p95 ms   p99 ms   Errors   Peak step req/s");
  for (const o of ok) { const s = o.summary, peak = Math.max(...o.stages.map((x) => x.rps || 0)); console.log(`${o.kind.padEnd(10)} ${String(o.processes).padStart(5)} ${String(s.avgRps).padStart(6)} ${(base ? "x" + (s.avgRps / base.summary.avgRps).toFixed(2) : "").padStart(10)} ${String(s.latency.p50).padStart(8)} ${String(s.latency.p95).padStart(8)} ${String(s.latency.p99).padStart(8)} ${(s.errorRatePct + "%").padStart(8)} ${String(peak).padStart(10)}`); }
  for (const o of ok) if (o.lb) { console.log(`\nBalancer (${o.lb.strategy}), instance :${o.killedInstance} was killed mid-test:`); o.lb.backends.forEach((b) => console.log(`  ${b.name}  requests ${b.requests}  failures ${b.failures}  retried ${b.retried}  ${b.healthy ? "healthy" : "DOWN"}`)); }
  for (const o of ok) if (o.scaling) { console.log(`\nAutoscaler timeline (${o.kind}):`); o.scaling.forEach((e) => console.log(`  ${e.at.slice(11, 19)}  ${e.event}${e.instances != null ? " → " + e.instances + " instance(s)" : ""}${e.reason ? "  (" + e.reason + ")" : ""}`)); }
  const dir = path.join(ROOT, "performance", "reports"); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `scale-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(file, JSON.stringify({ schema: "estateops.scale-test.v1", cpuCores: os.cpus().length, workers: WORKERS, config: path.basename(CONFIG), results: out.map((o) => ({ topology: o.kind, processes: o.processes, balancer: o.balancer, error: o.error || null, avgRps: o.summary && o.summary.avgRps, p50: o.summary && o.summary.latency.p50, p95: o.summary && o.summary.latency.p95, p99: o.summary && o.summary.latency.p99, errorRatePct: o.summary && o.summary.errorRatePct, requests: o.summary && o.summary.totals.requests, balancerStats: o.lb || null, scalingEvents: o.scaling || null, killedInstance: o.killedInstance || null })) }, null, 2));
  console.log(`\nSaved ${path.relative(ROOT, file)}`);
  process.exit(out.some((o) => o.error) ? 2 : 0);
})();
