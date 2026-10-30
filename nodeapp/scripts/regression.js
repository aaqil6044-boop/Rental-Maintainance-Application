"use strict";
// Runs the regression suite, builds report/EstateOps-regression-report.html, compares it with the previous run
// and opens the report in your browser.
//   npm run regression              run quietly, then open the report
//   npm run regression:watch        run in a VISIBLE Chrome window, slowly, then open the report
//   add  --no-open  to skip opening the report
const { spawnSync, exec } = require("child_process");
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const reportDir = path.join(root, "report"), histDir = path.join(reportDir, "history");
const args = process.argv.slice(2);
const watch = args.includes("--watch"), noOpen = args.includes("--no-open");
const passthrough = args.filter((a) => !["--watch", "--no-open"].includes(a));
fs.mkdirSync(histDir, { recursive: true });

const env = { ...process.env, REPORT_SUFFIX: "-regression" };
if (watch) env.SLOWMO = env.SLOWMO || "500";
const pwArgs = [require.resolve("@playwright/test/cli"), "test", "e2e/regression.spec.js", ...(watch ? ["--headed"] : []), ...passthrough];

const latestFile = path.join(histDir, "regression-latest.json");
const previous = fs.existsSync(latestFile) ? JSON.parse(fs.readFileSync(latestFile, "utf8")) : null;

const pw = spawnSync(process.execPath, pwArgs, { cwd: root, env, stdio: "inherit" });

// ---- summarise this run
function summarise() {
  const file = path.join(reportDir, "e2e-results-regression.json");
  if (!fs.existsSync(file)) return null;
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  const tests = [];
  (function walk(s) {
    for (const sp of s.specs || []) for (const t of sp.tests) {
      const r = t.results[t.results.length - 1] || {};
      const id = (/^(REG-\d+)/.exec(sp.title) || [])[1] || sp.title;
      tests.push({ id, title: sp.title, status: t.status === "expected" ? "passed" : t.status === "unexpected" ? "failed" : t.status, ms: Math.round(r.duration || 0) });
    }
    (s.suites || []).forEach(walk);
  })({ suites: data.suites });
  const count = (st) => tests.filter((t) => t.status === st).length;
  return { when: new Date().toISOString(), total: tests.length, passed: count("passed"), failed: count("failed"), flaky: count("flaky"), ms: tests.reduce((a, t) => a + t.ms, 0), tests };
}
const current = summarise();
if (!current) { console.error("No results were produced. Check the output above."); process.exit(pw.status || 1); }

// ---- compare with the previous run
function compare(prev, cur) {
  if (!prev) return { first: true };
  const before = new Map(prev.tests.map((t) => [t.id, t])), after = new Map(cur.tests.map((t) => [t.id, t]));
  const out = { first: false, previousWhen: prev.when, previous: { total: prev.total, passed: prev.passed, failed: prev.failed }, newFailures: [], fixed: [], added: [], removed: [], slower: [], flakyNow: [] };
  for (const [id, t] of after) {
    const b = before.get(id);
    if (!b) { out.added.push(t); continue; }
    if (b.status === "passed" && t.status !== "passed") out.newFailures.push({ ...t, was: b.status });
    else if (b.status !== "passed" && t.status === "passed") out.fixed.push({ ...t, was: b.status });
    if (t.status === "flaky") out.flakyNow.push(t);
    if (t.ms > 500 && b.ms > 0 && t.ms > b.ms * 2) out.slower.push({ ...t, was: b.ms });
  }
  for (const [id, b] of before) if (!after.has(id)) out.removed.push(b);
  return out;
}
const diff = compare(previous, current);
fs.writeFileSync(path.join(reportDir, "regression-compare.json"), JSON.stringify({ current: { when: current.when, total: current.total, passed: current.passed, failed: current.failed, flaky: current.flaky }, diff }, null, 2));

// ---- console summary
console.log("\n==== Regression summary ====");
console.log(`This run : ${current.passed}/${current.total} passed, ${current.failed} failed, ${current.flaky} flaky`);
if (diff.first) console.log("Previous : none (this run becomes the baseline)");
else {
  console.log(`Previous : ${diff.previous.passed}/${diff.previous.total} passed, ${diff.previous.failed} failed  (${new Date(diff.previousWhen).toLocaleString()})`);
  const list = (label, a, f) => { if (a.length) { console.log(`${label} (${a.length}):`); a.forEach((t) => console.log("   - " + f(t))); } };
  list("NEWLY FAILING", diff.newFailures, (t) => `${t.id} ${t.title}  [was ${t.was}]`);
  list("Fixed since last run", diff.fixed, (t) => `${t.id} ${t.title}`);
  list("New tests", diff.added, (t) => `${t.id} ${t.title}`);
  list("Removed tests", diff.removed, (t) => `${t.id} ${t.title}`);
  list("Much slower than before", diff.slower, (t) => `${t.id} ${t.was}ms -> ${t.ms}ms`);
  if (!diff.newFailures.length && !diff.fixed.length && !diff.added.length && !diff.removed.length) console.log("No change in results since the previous run.");
}

// ---- build the report (reads regression-compare.json), then save this run as history
const rep = spawnSync(process.execPath, ["scripts/e2e-report.js"], { cwd: root, env, stdio: "inherit" });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
fs.writeFileSync(path.join(histDir, `regression-${stamp}.json`), JSON.stringify(current, null, 2));
fs.writeFileSync(latestFile, JSON.stringify(current, null, 2));
const reportFile = path.join(reportDir, "EstateOps-regression-report.html");
fs.copyFileSync(reportFile, path.join(histDir, `regression-${stamp}.html`));
console.log("\nReport  : " + reportFile + "\nHistory : " + histDir);

// ---- open it
if (!noOpen && !process.env.CI) {
  const cmd = process.platform === "win32" ? `start "" "${reportFile}"` : process.platform === "darwin" ? `open "${reportFile}"` : `xdg-open "${reportFile}"`;
  exec(cmd, () => {});
}
process.exit(pw.status || rep.status || 0);
