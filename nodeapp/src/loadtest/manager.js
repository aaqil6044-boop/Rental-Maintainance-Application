"use strict";
/**
 * Owns the lifecycle of load-test runs.
 *   VALIDATING -> RUNNING -> (STOPPING) -> COMPLETED | FAILED | CANCELLED
 *   COMPLETED  = ran to its planned end.      Its VERDICT (PASSED / FAILED) says whether the thresholds were met.
 *   CANCELLED  = stopped by a person.         Results are kept, verdict is INCONCLUSIVE (the profile did not finish).
 *   FAILED     = could not start, crashed, was interrupted by a restart, or tripped the safety stop.
 * Only one run can be active (this is one SQLite server on one machine). A second start is refused with 409.
 */
const path = require("path");
const fs = require("fs");
const { fork } = require("child_process");
const { monitorEventLoopDelay } = require("perf_hooks");
const db = require("../db");
const config = require("../config");
const S = require("../store");
const { validate } = require("./config");
const { limits } = require("./limits");
const T = require("./targets");
const F = require("./fixtures");
const { evaluateThresholds } = require("./stats");
const { phases } = require("./profile");
const os = require("os");
const { SCENARIO_VERSION } = require("./scenarios");
const FRAMEWORK = "EstateOps Performance Testing Center 1.0 (in-house Node engine)";

let gitCache;
function gitCommit() {
  if (gitCache !== undefined) return gitCache;
  if (process.env.GIT_COMMIT) return (gitCache = String(process.env.GIT_COMMIT).slice(0, 12));
  try { gitCache = require("child_process").execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: path.join(__dirname, "..", ".."), timeout: 2000, stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || null; }
  catch (e) { gitCache = null; }
  return gitCache;
}
/** Everything needed to decide later whether two reports are comparable, and to reproduce a run. */
function buildMeta(cfg, target, dataset, resourcesMeasured) {
  const cpus = os.cpus() || [];
  return {
    appVersion: require("../../package.json").version, gitCommit: gitCommit(), framework: FRAMEWORK, scenarioVersion: SCENARIO_VERSION,
    environment: { name: cfg.target, kind: target.kind, baseUrl: target.baseUrl },
    datasetId: dataset ? dataset.id : null, dataset: dataset || null,
    infrastructure: { node: process.version, platform: `${os.platform()} ${os.release()}`, cpuCores: cpus.length, cpuModel: cpus[0] ? cpus[0].model : null, memoryMb: Math.round(os.totalmem() / 1048576),
      loadGenerator: target.kind === "local" ? "separate Node.js process on the same machine as the server" : "separate Node.js process on the machine running the server (remote target is measured over the network)",
      serverMetrics: resourcesMeasured ? "measured (server process CPU, memory, event-loop lag, database size)" : "not available for this target" },
    generatedAt: new Date().toISOString(),
  };
}

const ACTIVE = ["VALIDATING", "RUNNING", "STOPPING"];
let current = null;   // { id, orgId, child, live, resources, timers, mode }

class LoadTestError extends Error { constructor(status, message, extra) { super(message); this.status = status; Object.assign(this, extra); } }
const now = () => new Date().toISOString();
const J = (x) => (x == null ? null : JSON.stringify(x));
const P = (x) => { try { return x ? JSON.parse(x) : null; } catch (e) { return null; } };

/* ---------------------------------------------------------------- persistence */
const getRow = (id) => db.prepare("SELECT r.*, a.full_name AS starter_name FROM loadtest_runs r LEFT JOIN accounts a ON a.id = r.started_by WHERE r.id = ?").get(id);
function update(id, f) {
  const cols = Object.keys(f); if (!cols.length) return;
  db.prepare(`UPDATE loadtest_runs SET ${cols.map((c) => c + " = ?").join(", ")} WHERE id = ?`).run(...cols.map((c) => f[c]), id);
}
function brief(r) {
  const cfg = P(r.config_json) || {}, sum = P(r.summary_json);
  return { id: r.id, name: r.name, target: r.target, state: r.state, verdict: r.verdict, startedBy: { id: r.started_by, name: r.starter_name || "Unknown" },
    createdAt: r.created_at, startedAt: r.started_at, finishedAt: r.finished_at, plannedDurationSec: cfg.durationSec, maxUsers: cfg.maxUsers, seed: r.seed,
    peakUsers: sum ? sum.peakActiveUsers : null, requests: sum ? sum.totals.requests : null, errorRatePct: sum ? sum.errorRatePct : null,
    p95Ms: sum && sum.latency ? sum.latency.p95 : null, avgRps: sum ? sum.avgRps : null, stopReason: r.stop_reason, error: r.error,
    createdRecords: r.created_records, cleanedUp: !!r.cleaned_up, profile: cfg.profile || "linear", orgs: cfg.orgs || 1, knownGood: !!r.known_good,
    journeysPerSec: sum && sum.throughput ? sum.throughput.journeysPerSec : null, securityLeaks: sum && sum.security ? sum.security.leaks : null, datasetId: (P(r.meta_json) || {}).datasetId || null };
}
function detail(r) {
  const live = current && current.id === r.id ? current : null;
  const sum = live && live.live ? live.live : P(r.summary_json);
  const { timeline, ...summary } = sum || {};
  return { ...brief(r), meta: P(r.meta_json), knownGood: !!r.known_good, config: P(r.config_json), summary: sum ? summary : null, timeline: timeline || [], thresholds: P(r.thresholds_json) || [],
    warnings: P(r.warnings_json) || [], resources: live ? resourceView(live) : P(r.resources_json) || unavailable("No server measurements were recorded for this run."),
    isLive: !!live, elapsedSec: sum ? sum.elapsedSec : 0, phase: sum ? sum.phase : null, targetUsers: sum ? sum.targetUsers : null, activeUsers: sum ? sum.activeUsers : null };
}
const unavailable = (reason) => ({ available: false, reason, source: null, series: [], peak: null, avg: null, generator: null });

/* ---------------------------------------------------------------- server-side resource sampling (local target only) */
function startSampler(run) {
  const lag = monitorEventLoopDelay({ resolution: 10 }); lag.enable();
  const dbFile = path.join(config.dataDir, "estateops.db");
  let prev = process.cpuUsage(), prevT = process.hrtime.bigint();
  const size = (f) => { try { return fs.statSync(f).size; } catch (e) { return 0; } };
  run.resources = { series: [], lag };
  run.timers.push(setInterval(() => {
    const cpu = process.cpuUsage(), t = process.hrtime.bigint();
    const cpuPct = ((cpu.user + cpu.system - prev.user - prev.system) / 1000) / (Number(t - prevT) / 1e6) * 100;
    prev = cpu; prevT = t;
    const m = process.memoryUsage();
    run.resources.series.push({ t: run.resources.series.length + 1, cpuPct: Math.round(cpuPct * 10) / 10, rssMb: Math.round(m.rss / 1048576), heapMb: Math.round(m.heapUsed / 1048576),
      lagP95Ms: Math.round(lag.percentile(95) / 1e4) / 100, lagMaxMs: Math.round(lag.max / 1e4) / 100, dbMb: Math.round(size(dbFile) / 10485.76) / 100, walMb: Math.round(size(dbFile + "-wal") / 10485.76) / 100 });
    lag.reset();
    if (run.resources.series.length > 3700) run.resources.series.shift();
  }, 1000));
}
function resourceView(run) {
  if (!run.resources) return unavailable(run.resourceReason || "Server resource metrics are only measured for the local target. A remote server's CPU and memory are not visible from here.");
  const s = run.resources.series; const agg = (k, f) => (s.length ? f(s.map((x) => x[k])) : null);
  const max = (a) => Math.max(...a), avg = (a) => Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10;
  return { available: true, source: "EstateOps server process (this Node.js process)", reason: null, series: s.slice(-600),
    peak: { cpuPct: agg("cpuPct", max), rssMb: agg("rssMb", max), heapMb: agg("heapMb", max), lagP95Ms: agg("lagP95Ms", max), lagMaxMs: agg("lagMaxMs", max), dbMb: agg("dbMb", max), walMb: agg("walMb", max) },
    avg: { cpuPct: agg("cpuPct", avg), rssMb: agg("rssMb", avg) }, generator: run.live ? run.live.generator : null,
    note: "CPU is the server process only, as a percentage of one core. The load generator runs in a separate process on the same machine, so it competes for the same CPU." };
}

/* ---------------------------------------------------------------- verdict and warnings */
function warningsFor(cfg, sum, target, resources, early) {
  const w = []; const ph = phases(cfg);
  if (target.kind === "local") w.push("The load generator and the server under test share one machine. Their CPU use competes, so absolute numbers are pessimistic compared with a dedicated client. Use results to compare runs on the same machine.");
  if (!resources) w.push("Server CPU, memory and database metrics were not measured: they are only available for the local target.");
  if (cfg.seed == null) w.push("No seed was set, so this exact traffic pattern cannot be repeated. Set a seed to compare runs on like-for-like traffic.");
  if (ph.steadySec < 30) w.push(`The steady-state period is only ${ph.steadySec}s. Short runs mostly measure warm-up; use at least 30s of steady state for stable percentiles.`);
  if (sum) {
    if (sum.totals.requests < 100) w.push(`Only ${sum.totals.requests} requests were measured, so p95 and p99 are based on very few samples.`);
    if (sum.sampleCapReached) w.push("The sample buffer limit was reached; percentiles describe the first part of the run only.");
    if (sum.peakActiveUsers < Math.min(cfg.maxUsers, limits().maxUsers) && !early) w.push(`The generator peaked at ${sum.peakActiveUsers} active users, below the configured maximum of ${cfg.maxUsers}.`);
    if (cfg.includeWrites && sum.createdRecords >= cfg.maxCreates && cfg.maxCreates > 0) w.push(`The record creation cap (${cfg.maxCreates}) was reached; later iterations skipped write actions, so the read/write mix shifted during the run.`);
    if (cfg.includeWrites && target.kind !== "local") w.push("Records created on a remote target cannot be cleaned up from here. Remove them there; they are titled \"[LOADTEST r…]\".");
  }
  if (sum && sum.missingPersonas && sum.missingPersonas.length) w.push(`No test account exists on this target for: ${sum.missingPersonas.join(", ")}. Their share of the traffic was redistributed to the other user types.`);
  if (sum && sum.security && cfg.securityPct > 0 && sum.security.checks === 0) w.push("Authorization checks were enabled but none ran (the run was too short or had too few journeys).");
  if (sum && sum.security && sum.security.leaks > 0) w.push(`SECURITY: ${sum.security.leaks} request(s) succeeded where the server must refuse. Review the authorization leaks below.`);
  if ((cfg.orgs || 1) > 1 && cfg.target !== "local") w.push("Extra test organizations exist only on the local target; the remote run used the accounts you configured.");
  if (early) w.push("The run did not complete its planned profile, so its thresholds are shown but the verdict is inconclusive.");
  return w;
}
function verdictOf(state, thresholds, early, safety, hasData) {
  if (safety) return "FAILED";                       // the safety stop tripped: the target was struggling
  if (!hasData) return null;                         // nothing was measured, so no performance verdict
  if (early || state === "CANCELLED") return "INCONCLUSIVE";
  if (state !== "COMPLETED") return null;
  return thresholds.every((t) => t.passed) ? "PASSED" : "FAILED";
}

/* ---------------------------------------------------------------- start */
function start(account, input, req) {
  if (!config.loadtest.enabled) throw new LoadTestError(403, "Load testing is switched off on this server (LOADTEST_ENABLED).");
  const lim = limits();
  const v = validate(input, lim, T.names());
  if (!v.ok) throw new LoadTestError(400, "The test configuration is not valid.", { errors: v.errors });
  const cfg = v.value;
  if (current) throw new LoadTestError(409, `Load test #${current.id} is already ${current.mode === "stopping" ? "stopping" : "running"}. Only one test can run at a time; wait for it to finish or stop it.`, { activeId: current.id });
  let target; try { target = T.resolve(cfg.target, cfg.confirmTarget, req); } catch (e) { throw new LoadTestError(e.status || 400, e.message, e.field ? { errors: [{ field: e.field, message: e.message }] } : {}); }
  delete cfg.confirmTarget;   // the confirmation is checked and then discarded, never stored

  const id = db.prepare(`INSERT INTO loadtest_runs (org_id, started_by, name, target, state, seed, config_json, created_at)
                         VALUES (?,?,?,?, 'VALIDATING', ?, ?, ?)`).run(account.org_id, account.id, cfg.name, cfg.target, cfg.seed, J(cfg), now()).lastInsertRowid;
  const run = { id, orgId: account.org_id, child: null, live: null, resources: null, timers: [], mode: "starting", cfg, target, accountId: account.id, finished: false, stopRequest: null };
  current = run;
  try {
    let accounts;
    if (target.kind === "local") { const fx = F.ensure(account, { orgs: cfg.orgs }); accounts = fx.accounts; run.dataset = fx.dataset; }
    else accounts = T.remoteAccounts();
    const seed = cfg.seed != null ? cfg.seed : Math.floor(Math.random() * 4294967296);
    if (cfg.seed == null) update(id, { seed });
    cfg.resolvedSeed = seed;
    const tag = `[LOADTEST r${id}]`;
    const child = fork(path.join(__dirname, "worker.js"), [], { stdio: ["ignore", "ignore", "pipe", "ipc"], env: { PATH: process.env.PATH, NODE_ENV: process.env.NODE_ENV || "" }, execArgv: ["--max-old-space-size=512"] });
    run.child = child; run.stderr = "";
    child.stderr.on("data", (d) => { run.stderr = (run.stderr + d).slice(-800); });
    child.on("message", (m) => onMessage(run, m));
    child.on("exit", (code, sig) => onExit(run, code, sig));
    child.on("error", (e) => finish(run, { state: "FAILED", error: "Could not start the load generator: " + e.message }));
    child.send({ type: "start", options: { config: cfg, baseUrl: target.baseUrl, accounts, tag, seed, hardMaxUsers: lim.maxUsers, maxRequests: lim.maxRequests, abort: { errorRatePct: config.loadtest.abortErrorRatePct, minRequests: 200 } } });
    if (target.kind === "local") startSampler(run); else run.resourceReason = "Server resource metrics are only measured for the local target.";
    run.mode = "running"; run.startedAt = Date.now();
    update(id, { state: "RUNNING", started_at: now(), meta_json: J(buildMeta(cfg, target, run.dataset || null, target.kind === "local")) });
    S.audit(account, "LOADTEST_STARTED", "loadtest", id, `${cfg.name} target=${cfg.target} users=${cfg.startUsers}-${cfg.maxUsers} ${cfg.durationSec}s`);
    // watchdog: the generator must be finished well after the planned end, whatever happens
    run.timers.push(setTimeout(() => { if (!run.finished) { try { run.child.kill("SIGKILL"); } catch (e) {} } }, (cfg.durationSec + (cfg.timeoutMs / 1000) + 45) * 1000));
  } catch (e) {
    finish(run, { state: "FAILED", error: "Could not prepare the test: " + String(e.message).slice(0, 300) });
    throw new LoadTestError(500, "Could not prepare the test: " + e.message);
  }
  return detail(getRow(id));
}

function onMessage(run, m) {
  if (!m || run.finished) return;
  if (m.type === "snapshot") {
    run.live = m.data;
    if (run.resources) run.live.serverResources = true;
    if (Date.now() - (run.lastSave || 0) > 5000) { run.lastSave = Date.now(); update(run.id, { summary_json: J(m.data) }); }
  } else if (m.type === "done") {
    run.result = m.result; run.live = m.result.snapshot;
  } else if (m.type === "failed") {
    run.failure = m;
  }
}
function onExit(run, code, sig) {
  if (run.finished) return;
  const r = run.result, f = run.failure;
  if (r) {
    const early = r.stoppedEarly;
    if (r.safetyStop) return finish(run, { state: "FAILED", early: true, safety: true, error: r.stopReason });
    if (early) return finish(run, { state: "CANCELLED", early: true, stopReason: r.stopReason });
    return finish(run, { state: "COMPLETED" });
  }
  if (f) return finish(run, { state: "FAILED", error: f.setup ? f.message : "The load generator stopped unexpectedly: " + f.message });
  if (run.stopRequest) return finish(run, { state: "CANCELLED", early: true, stopReason: run.stopRequest });
  finish(run, { state: "FAILED", error: `The load generator exited unexpectedly (${sig || "code " + code}).${run.stderr ? " " + require("./metrics").redact(run.stderr).slice(-200) : ""}` });
}

function finish(run, o) {
  if (run.finished) return; run.finished = true;
  run.timers.forEach((t) => { clearInterval(t); clearTimeout(t); });
  if (run.resources && run.resources.lag) run.resources.lag.disable();
  const cfg = run.cfg, sum = run.live || null;
  if (sum) sum.createdRecords = run.target.kind === "local" ? F.countRecords(run.orgId, run.id) : sum.createdRecords;
  const thresholds = sum && sum.totals ? evaluateThresholds(cfg.thresholds, sum) : [];
  if (sum) sum.stagesPlan = sum.stagesPlan || null;
  const state = o.state, early = !!o.early;
  const verdict = verdictOf(state, thresholds, early, !!o.safety, !!(sum && sum.totals && sum.totals.requests > 0));
  const resources = run.resources ? resourceView(run) : unavailable(run.resourceReason);
  const warnings = warningsFor(cfg, sum, run.target, run.resources, early);
  if (o.error) warnings.unshift(o.error);
  let cleaned = 0, created = sum ? sum.createdRecords : 0;
  if (run.target.kind === "local") {
    try {
      if (cfg.cleanupAfter) { F.cleanup(run.orgId, run.id); cleaned = 1; }
      F.deactivate(run.orgId);
    } catch (e) { warnings.push("Cleanup failed: " + e.message); }
  }
  update(run.id, { state, verdict, stop_reason: o.stopReason || null, error: o.error || null, summary_json: J(sum), thresholds_json: J(thresholds), warnings_json: J(warnings),
    resources_json: J(resources), created_records: created, cleaned_up: cleaned, finished_at: now() });
  try { S.audit({ id: run.accountId, org_id: run.orgId }, "LOADTEST_" + state, "loadtest", run.id, `${verdict || "-"}${o.stopReason ? " " + o.stopReason : ""}`.slice(0, 200)); } catch (e) {}
  try { if (run.child && run.child.connected) run.child.disconnect(); } catch (e) {}
  if (current === run) current = null;
}

/* ---------------------------------------------------------------- control */
function stop(id, mode, account) {
  const run = current && current.id === id ? current : null;
  if (!run) throw new LoadTestError(409, "That test is not running.");
  const m = mode === "now" ? "now" : "graceful";
  const reason = (m === "now" ? "Cancelled" : "Stopped") + " by " + (account.full_name || "an administrator");
  run.stopRequest = reason; run.mode = "stopping";
  update(id, { state: "STOPPING", stop_reason: reason });
  try { run.child.send({ type: "stop", mode: m, reason }); } catch (e) {}
  if (m === "now") run.timers.push(setTimeout(() => { try { run.child.kill("SIGKILL"); } catch (e) {} }, 4000));
  S.audit(account, m === "now" ? "LOADTEST_CANCELLED" : "LOADTEST_STOPPING", "loadtest", id, reason);
  return detail(getRow(id));
}
/** Emergency stop: kills the generator process now, for any organization. Traffic ends within a request or two. */
function stopAll(account) {
  if (!current) return { stopped: 0 };
  const run = current; const reason = "Emergency stop by " + (account.full_name || "an administrator");
  run.stopRequest = reason; run.mode = "stopping";
  try { run.child.send({ type: "stop", mode: "now", reason }); } catch (e) {}
  setTimeout(() => { try { run.child.kill("SIGKILL"); } catch (e) {} }, 1500).unref();
  S.audit(account, "LOADTEST_EMERGENCY_STOP", "loadtest", run.id, reason);
  return { stopped: 1 };
}

/** Policy for a server restart: a run cannot survive it (the generator dies with the server), so anything left active is marked FAILED. */
function recover() {
  const rows = db.prepare(`SELECT id, org_id FROM loadtest_runs WHERE state IN ('VALIDATING','RUNNING','STOPPING')`).all();
  for (const r of rows) {
    update(r.id, { state: "FAILED", verdict: "FAILED", error: "Interrupted: the server restarted while this test was running. Partial results, if any, are kept.", finished_at: now(), warnings_json: J(["The server restarted during the run; the load generator was stopped with it."]) });
    try { F.deactivate(r.org_id); } catch (e) {}
  }
  return rows.length;
}
function shutdown() { if (current && current.child) try { current.child.kill("SIGKILL"); } catch (e) {} }

/* ---------------------------------------------------------------- queries */
const list = (orgId, limit = 50) => db.prepare("SELECT r.*, a.full_name AS starter_name FROM loadtest_runs r LEFT JOIN accounts a ON a.id = r.started_by WHERE r.org_id = ? ORDER BY r.id DESC LIMIT ?").all(orgId, limit).map(brief);
function get(orgId, id) { const r = Number.isInteger(id) ? getRow(id) : null; return r && r.org_id === orgId ? detail(r) : null; }
const activeId = () => (current ? current.id : null);

/** Finished runs that have measurements, newest first, as full details (used for comparison and trends). */
function finishedRuns(orgId, { beforeId = null, limit = 30 } = {}) {
  const rows = db.prepare(`SELECT r.*, a.full_name AS starter_name FROM loadtest_runs r LEFT JOIN accounts a ON a.id = r.started_by
                           WHERE r.org_id = ? AND r.state = 'COMPLETED' AND r.summary_json IS NOT NULL ${beforeId ? "AND r.id < ?" : ""} ORDER BY r.id DESC LIMIT ?`)
    .all(...(beforeId ? [orgId, beforeId, limit] : [orgId, limit]));
  return rows.map((r) => detail(r));
}
function setKnownGood(orgId, id, value) {
  const r = getRow(id); if (!r || r.org_id !== orgId) throw new LoadTestError(404, "Load test was not found.");
  if (r.state !== "COMPLETED" || !r.summary_json) throw new LoadTestError(400, "Only a completed run with measurements can be the known-good reference.");
  db.transaction(() => {
    if (value) db.prepare("UPDATE loadtest_runs SET known_good = 0 WHERE org_id = ?").run(orgId);
    db.prepare("UPDATE loadtest_runs SET known_good = ? WHERE id = ?").run(value ? 1 : 0, id);
  })();
  return detail(getRow(id));
}

module.exports = { start, stop, stopAll, recover, shutdown, list, get, activeId, finishedRuns, setKnownGood, LoadTestError, ACTIVE, _state: () => current };
