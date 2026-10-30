#!/usr/bin/env node
"use strict";
// EstateOps Performance Testing Center - command line.
//
//   node performance/scripts/cli.js run      [--config file.yaml] [options]   run a test, write the report, compare with a baseline
//   node performance/scripts/cli.js compare  [--current ref] [--baseline previous|known-good|ref]   compare two stored reports
//   node performance/scripts/cli.js report   [ref]                               rebuild the HTML report of a stored run
//   node performance/scripts/cli.js list                                         list stored reports
//   node performance/scripts/cli.js baseline set <ref> | show                    manage the known-good reference
//   node performance/scripts/cli.js data     seed|validate|cleanup|reset [--yes]  manage the synthetic test data (local database)
//
// Exit codes:  0 pass (or warning)   1 failed thresholds / authorization leak / REGRESSION / run failed
//              2 could not run (bad config, server unreachable)   3 inconclusive and --fail-on-inconclusive (or a cancelled run)
const { spawn, exec } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");
const RG = require("../../src/loadtest/regression");
const { render } = require("../../src/loadtest/report");
const { analyze } = require("../../src/loadtest/analysis");
const C = require("../orchestration/config");
const store = require("../reporting/store");
const appRoot = path.join(__dirname, "..", "..");

const argv = process.argv.slice(2);
const cmd = argv[0] && !argv[0].startsWith("--") ? argv[0] : "run";
const rest = argv[0] && !argv[0].startsWith("--") ? argv.slice(1) : argv;
const opt = {}, pos = [];
for (let i = 0; i < rest.length; i++) { if (rest[i].startsWith("--")) { const k = rest[i].slice(2); opt[k] = rest[i + 1] !== undefined && !rest[i + 1].startsWith("--") ? rest[++i] : true; } else pos.push(rest[i]); }
const BOOL = ["no-open", "strict", "fail-on-inconclusive", "yes", "read-only", "help", "h"];
// a boolean flag followed by a positional value must not swallow it
for (const b of BOOL) if (opt[b] && opt[b] !== true) { pos.unshift(opt[b]); opt[b] = true; }
const log = (m = "") => console.log(m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nf = (v, d = 1) => (v == null || Number.isNaN(Number(v)) ? "–" : Number(v).toLocaleString("en-US", { maximumFractionDigits: d }));
const fail = (code, msg) => { if (msg) console.error(msg); cleanup(); process.exit(code); };

if (opt.help || opt.h) { log(fs.readFileSync(__filename, "utf8").split("\n").slice(2, 15).join("\n").replace(/^\/\/ ?/gm, "")); process.exit(0); }

/* ------------------------------------------------------------------ server + API */
let child = null, base = null, token = null, runId = null;
async function api(method, p, body) {
  const r = await fetch(base + "/api" + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const t = await r.text(); let d = null; try { d = t ? JSON.parse(t) : null; } catch (e) { d = t; }
  if (!r.ok) { const e = new Error((d && d.message) || `HTTP ${r.status}`); e.data = d; e.status = r.status; throw e; }
  return d;
}
async function startServer() {
  const port = 4300 + Math.floor(Math.random() * 400); base = `http://127.0.0.1:${port}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "estateops-perf-"));
  child = spawn(process.execPath, [path.join(appRoot, "scripts", "dev.js")], { cwd: appRoot, env: { ...process.env, PORT: String(port), DATA_DIR: dir, LOG_REQUESTS: "0", LOADTEST_ENABLED: "1" }, stdio: "ignore" });
  for (let i = 0; i < 80; i++) { await sleep(500); try { if ((await fetch(base + "/health")).ok) return; } catch (e) { /* not up yet */ } }
  throw new Error("The temporary test server did not start.");
}
function cleanup() { if (child) { try { child.kill(); } catch (e) { /* already gone */ } child = null; } }
process.on("exit", cleanup);
process.on("SIGINT", async () => { log("\nStopping the test…"); try { if (runId) await api("POST", `/loadtests/${runId}/stop`, { mode: "now" }); } catch (e) { /* best effort */ } cleanup(); process.exit(2); });

/* ------------------------------------------------------------------ output helpers */
const sevMark = { REGRESSION: "REGRESSION", WARNING: "warning   ", INCONCLUSIVE: "inconclus.", PASS: "ok        " };
function printComparison(c) {
  log(`\nRegression check against ${c.base.name} (${c.base.id}): ${c.classification}`);
  c.reasons.forEach((r) => log("  " + r));
  c.headline.forEach((f) => log(`  ${sevMark[f.severity]}  ${f.metric.padEnd(20)} ${nf(f.base, 2)} → ${nf(f.current, 2)} ${f.unit || ""}${f.delta != null ? `  (${f.delta > 0 ? "+" : ""}${nf(f.delta, 2)}${f.deltaPct != null && f.unit !== "%" ? `, ${f.deltaPct > 0 ? "+" : ""}${nf(f.deltaPct, 1)}%` : ""})` : ""}`));
  const detail = c.findings.filter((f) => f.scope !== "global" && f.scope !== "security" && (f.severity === "REGRESSION" || f.severity === "WARNING")).slice(0, 8);
  if (detail.length) { log("  where:"); detail.forEach((f) => log(`    ${sevMark[f.severity]}  [${f.scope}] ${f.subject} — ${f.metric}: ${nf(f.base, 1)} → ${nf(f.current, 1)}${f.deltaPct != null ? ` (${f.deltaPct > 0 ? "+" : ""}${nf(f.deltaPct, 1)}%)` : ""}`)); }
  c.comparability.blocking.forEach((b) => log("  not comparable: " + b.message));
  c.comparability.warnings.slice(0, 4).forEach((b) => log("  note: " + b.message));
}
const openFile = (f) => { if (opt["no-open"] || process.env.CI) return; if (process.platform === "win32") exec(`start "" "${f}"`); else if (process.platform === "darwin") exec(`open "${f}"`); };
function exitCodeFor(run, comparison) {
  if (run && (run.state === "FAILED" || run.verdict === "FAILED")) return 1;
  if (comparison && comparison.classification === "REGRESSION") return 1;
  if (opt.strict && comparison && comparison.classification === "WARNING") return 1;
  if (run && (run.verdict === "INCONCLUSIVE" || run.state === "CANCELLED")) return 3;
  if (opt["fail-on-inconclusive"] && comparison && comparison.classification === "INCONCLUSIVE") return 3;
  return 0;
}

/* ------------------------------------------------------------------ run */
async function run() {
  let setup;
  try { setup = C.build(opt.config ? C.load(path.resolve(String(opt.config))) : C.load(path.join(__dirname, "..", "config", "default.yaml")), opt); }
  catch (e) { if (e instanceof C.ConfigError) fail(2, "The configuration is not valid:\n" + e.errors.map((x) => " - " + x).join("\n")); throw e; }
  const reportDir = setup.reportDir ? path.resolve(setup.reportDir) : store.defaultDir();
  if (setup.api.target !== "local") {
    if (opt.confirm !== setup.api.target) fail(2, `"${setup.api.target}" is not a local environment. Re-run with --confirm ${setup.api.target} to confirm you are authorised to load-test it. Stress and soak tests should never target production.`);
    setup.api.confirmTarget = opt.confirm;
  }
  base = setup.baseUrl ? String(setup.baseUrl).replace(/\/$/, "") : null;
  if (!base) { log("Starting a temporary EstateOps server with sample data…"); await startServer(); }
  else if (!/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(base) && opt["allow-remote-control"] !== true) log(`Note: ${base} is not this machine. The test runs from that server, against the target "${setup.api.target}".`);
  const email = opt.email || process.env.LT_EMAIL || "manager@estateops.test", password = opt.password || process.env.LT_PASSWORD || "password123";
  try { token = (await api("POST", "/auth/login", { email, password })).token; } catch (e) { fail(2, `Could not sign in as ${email}: ${e.message}. Use --email and --password (or LT_EMAIL / LT_PASSWORD) for an organization admin.`); }
  const v = await api("POST", "/loadtests/validate", setup.api);
  if (!v.valid) fail(2, "The settings are not valid:\n" + v.errors.map((e) => " - " + e.message).join("\n"));
  v.warnings.forEach((w) => log("Note: " + w));
  let started; try { started = await api("POST", "/loadtests", setup.api); } catch (e) { fail(2, "Could not start the test: " + e.message + (e.data && e.data.errors ? "\n" + e.data.errors.map((x) => " - " + x.message).join("\n") : "")); }
  runId = started.id;
  const c = started.config;
  log(`Performance test #${runId} "${c.name}": ${c.profile} profile, ${c.durationSec}s total (ramps included), ${c.startUsers} → ${c.maxUsers} users, ${c.orgs} organization(s), seed ${c.resolvedSeed != null ? c.resolvedSeed : c.seed}\n`);
  let d;
  for (;;) {
    await sleep(2000); d = await api("GET", `/loadtests/${runId}`);
    const s = d.summary;
    if (s && process.stdout.isTTY) process.stdout.write(`\r  ${String(d.state).padEnd(9)} ${String(Math.round(d.elapsedSec)).padStart(4)}s/${c.durationSec}s  ${String(d.phase || "").padEnd(10)} users ${String(d.activeUsers ?? 0).padStart(3)}/${String(d.targetUsers ?? 0).padStart(3)}  req ${String(s.totals.requests).padStart(6)}  ${String(s.currentRps).padStart(6)}/s  p95 ${String(s.latency.p95 ?? "–").padStart(7)} ms  err ${s.errorRatePct}%   `);
    else if (s && Math.round(d.elapsedSec) % 10 === 0) log(`  ${d.state} ${Math.round(d.elapsedSec)}s/${c.durationSec}s users ${d.activeUsers} req ${s.totals.requests} p95 ${s.latency.p95} ms err ${s.errorRatePct}%`);
    if (!d.isLive) break;
  }
  if (process.stdout.isTTY) process.stdout.write("\n");
  log();
  if (!d.summary || !d.summary.totals || !d.summary.totals.requests) fail(2, "The test produced no measurements. " + (d.error || (d.warnings || [])[0] || ""));
  const report = { schema: "estateops.performance-report.v1", ...d, runId: d.id, baselineSpec: setup.baseline };
  report.analysis = analyze(report);
  // regression check
  let comparison = null, trends = null, why = null;
  if (report.state === "COMPLETED") {
    const b = store.pickBaseline({ ...report, id: "current" }, setup.baseline, reportDir);
    if (b.base) {
      comparison = RG.compare(b.base, { ...report, id: report.runId }, { rules: report.config.regressionRules, history: b.history });
      comparison.base = { ...comparison.base, id: b.base.id }; comparison.how = b.how;
      const same = [...b.history, b.base].filter((r) => RG.comparability(report, r).comparable);
      if (same.length >= 2) trends = RG.trends([...same, report]);
    } else why = b.reason;
  }
  report.comparison = comparison;
  const html = render(report, { comparison, trends });
  const saved = store.save(report, html, reportDir);
  fs.writeFileSync(path.join(reportDir, "latest.html"), html);

  const T = report.summary.totals, L = report.summary.latency, S = report.summary;
  log(`State: ${report.state}   Verdict: ${report.verdict || "–"}`);
  log(`Requests ${T.requests} (${nf(S.avgRps)}/s), journeys ${T.iterations}, sessions ${T.sessions}, errors ${nf(S.errorRatePct, 2)}%, p50 ${L.p50} ms, p95 ${L.p95} ms, p99 ${L.p99} ms, peak users ${S.peakActiveUsers}`);
  if (S.security && S.security.checks) log(`Authorization checks: ${S.security.checks} run, ${S.security.denied} refused correctly, ${S.security.leaks} LEAKS`);
  (report.thresholds || []).forEach((t) => log(`  threshold ${t.passed ? "met     " : "EXCEEDED"}  ${t.label}: ${nf(t.actual, 2)}${t.unit} (limit ${t.limit}${t.unit})`));
  report.analysis.bottlenecks.filter((o) => o.severity !== "info").forEach((o) => log(`  ${o.severity}: ${o.title}`));
  if (comparison) printComparison(comparison); else if (why) log(`\nNo regression check: ${why}`);
  (report.warnings || []).slice(0, 4).forEach((w) => log("Note: " + w));
  log(`\nReport: ${saved.html}\nData:   ${saved.json}`);
  const code = exitCodeFor(report, comparison);
  cleanup(); openFile(saved.html);
  process.exit(code);
}

/* ------------------------------------------------------------------ compare / report / list / baseline */
function compareCmd() {
  const dir = opt["report-dir"] ? path.resolve(String(opt["report-dir"])) : store.defaultDir();
  const cur = store.resolve(opt.current || pos[0] || "latest", dir); if (!cur) fail(2, "No stored report found. Run a test first: npm run loadtest");
  const b = store.pickBaseline(cur, opt.baseline || pos[1] || "previous", dir); if (!b.base) fail(2, b.reason);
  const comparison = RG.compare(b.base, cur, { rules: cur.config && cur.config.regressionRules, history: b.history });
  comparison.how = b.how; printComparison(comparison);
  const html = render({ ...cur, comparison }, { comparison, trends: null });
  const out = path.join(cur._dir, `comparison-vs-${path.basename(b.base._dir || "baseline")}.html`); fs.writeFileSync(out, html);
  log(`\nComparison report: ${out}`);
  openFile(out); process.exit(exitCodeFor(null, comparison));
}
function reportCmd() {
  const dir = opt["report-dir"] ? path.resolve(String(opt["report-dir"])) : store.defaultDir();
  const cur = store.resolve(pos[0] || opt.current || "latest", dir); if (!cur) fail(2, "No stored report found.");
  const b = opt.baseline === "none" ? { reason: "none" } : store.pickBaseline(cur, opt.baseline || "previous", dir);
  const comparison = b.base ? RG.compare(b.base, cur, { rules: cur.config && cur.config.regressionRules, history: b.history }) : null;
  const same = store.list(dir).filter((r) => RG.comparability(cur, r).comparable);
  const html = render(cur, { comparison, trends: same.length >= 3 ? RG.trends(same) : null });
  const out = path.join(cur._dir, "report.html"); fs.writeFileSync(out, html); fs.writeFileSync(path.join(dir, "latest.html"), html);
  log(`Report rebuilt: ${out}`); openFile(out);
}
function listCmd() {
  const all = store.list(opt["report-dir"] ? path.resolve(String(opt["report-dir"])) : store.defaultDir());
  if (!all.length) return log("No stored reports yet. Run: npm run loadtest");
  log("report".padEnd(40) + "profile  users  p95 ms  p99 ms  req/s  err %  verdict");
  all.forEach((r) => { const s = r.summary, c = r.config || {}; log(`${path.basename(r._dir).padEnd(40)}${String(c.profile || "linear").padEnd(9)}${String(c.maxUsers).padEnd(7)}${nf(s.latency.p95).padEnd(8)}${nf(s.latency.p99).padEnd(8)}${nf(s.avgRps).padEnd(7)}${nf(s.errorRatePct, 2).padEnd(7)}${r.verdict || r.state}`); });
}
function baselineCmd() {
  const sub = pos[0];
  if (sub === "set") { const r = store.resolve(pos[1] || "latest", opt["report-dir"] ? path.resolve(String(opt["report-dir"])) : store.defaultDir()); if (!r) fail(2, "Report not found."); if (r.state !== "COMPLETED") fail(2, "Only a completed run can be the known-good baseline."); log("Known-good baseline saved: " + store.setKnownGood(r)); }
  else if (sub === "show") { const k = store.knownGood(); log(k ? `Known-good baseline: ${k.name} (${k.startedAt}), p95 ${k.summary.latency.p95} ms, commit ${k.meta && k.meta.gitCommit || "unknown"}` : "No known-good baseline is set."); }
  else fail(2, "Usage: baseline set <report> | baseline show");
}

/* ------------------------------------------------------------------ test data (local database) */
function dataCmd() {
  const sub = pos[0];
  if (!["seed", "validate", "cleanup", "reset"].includes(sub)) fail(2, "Usage: data seed|validate|cleanup|reset [--org <id>] [--yes]\nThis works on the database in DATA_DIR (default ./data) - the one the local server uses.");
  const db = require("../../src/db"), S = require("../../src/store"), F = require("../../src/loadtest/fixtures");
  const admin = opt.org ? db.prepare("SELECT * FROM accounts WHERE org_id = ? AND org_admin = 1 AND role = 'MANAGER' AND email NOT LIKE 'loadtest-%' LIMIT 1").get(Number(opt.org)) : db.prepare("SELECT * FROM accounts WHERE org_admin = 1 AND role = 'MANAGER' AND email NOT LIKE 'loadtest-%' ORDER BY id LIMIT 1").get();
  if (!admin) fail(2, "No organization admin exists in this database yet.");
  const active = db.prepare("SELECT COUNT(*) n FROM loadtest_runs WHERE state IN ('VALIDATING','RUNNING','STOPPING')").get().n;
  log(`Database organization #${admin.org_id}. Only accounts @loadtest.invalid and requests titled "[LOADTEST r…]" are ever touched.`);
  if (sub === "validate") { const r = F.validateIntegrity(admin.org_id, { running: active > 0 }); r.checks.forEach((c) => log(`  ${c.ok ? "ok  " : "FAIL"}  ${c.name} — ${c.detail}`)); process.exit(r.ok ? 0 : 1); }
  if (active) fail(2, "A load test is marked as running in this database. Stop it first.");
  if (sub === "seed") { const r = F.ensure(admin, { orgs: Number(opt.orgs) || 1 }); F.deactivate(admin.org_id); log(`Fixtures ready: ${r.dataset.accounts} accounts, ${r.dataset.orgs} organization(s), dataset ${r.dataset.id}. They stay inactive until a test runs.`); return; }
  if (!opt.yes) fail(2, `This will delete load-test records (${sub}). Re-run with --yes to confirm.`);
  const r = F.cleanup(admin.org_id); if (sub === "reset") F.deactivate(admin.org_id);
  log(`Deleted ${r.requests} test request(s) and ${r.notifications} notification(s).${sub === "reset" ? " Fixtures deactivated." : ""}`);
  void S;
}

(async () => {
  switch (cmd) {
    case "run": return run();
    case "compare": return compareCmd();
    case "report": return reportCmd();
    case "list": return listCmd();
    case "baseline": return baselineCmd();
    case "data": return dataCmd();
    default: fail(2, `Unknown command "${cmd}". Commands: run, compare, report, list, baseline, data.`);
  }
})().catch((e) => { console.error("\nPerformance test could not run: " + e.message); cleanup(); process.exit(2); });
