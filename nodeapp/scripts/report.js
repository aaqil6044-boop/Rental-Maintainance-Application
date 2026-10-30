"use strict";
// Runs every test suite and writes report/test-report.html (open it in a browser).
const { spawnSync } = require("child_process");
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const suites = [
  ["Unit: rules.js", ["--test", "tests/unit/rules.test.js"], (o) => [+(/# pass (\d+)/.exec(o) || [])[1] || 0, +(/# fail (\d+)/.exec(o) || [])[1] || 0]],
  ["API and role permissions", ["tests/api.test.js"], null],
  ["Database migration", ["tests/migration.test.js"], null],
  ["Dev seed", ["tests/seed.test.js"], null],
  ["API docs vs real routes (incl. load-test endpoints)", ["tests/spec.test.js"], null],
  ["Load test: unit (validation, ramp, percentiles, seeds, thresholds)", ["--test", "tests/unit/loadtest.test.js"], (o) => [+(/# pass (\d+)/.exec(o) || [])[1] || 0, +(/# fail (\d+)/.exec(o) || [])[1] || 0]],
  ["Load test: generator vs mock service (cap, ramp, stop, timeouts)", ["--test", "tests/loadtest/engine.test.js"], (o) => [+(/# pass (\d+)/.exec(o) || [])[1] || 0, +(/# fail (\d+)/.exec(o) || [])[1] || 0]],
  ["Load test: API, safety, real run, cleanup, export", ["tests/loadtest.api.test.js"], null],
];
const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const rows = []; let allOk = true;
for (const [name, args, parse] of suites) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8", env: { ...process.env, LOG_REQUESTS: "0" } });
  const out = (r.stdout || "") + (r.stderr || "");
  let pass, fail;
  if (parse) [pass, fail] = parse(out); else { const m = /(\d+) passed, (\d+) failed/.exec(out); pass = m ? +m[1] : 0; fail = m ? +m[2] : 1; }
  const ok = r.status === 0 && fail === 0; if (!ok) allOk = false;
  rows.push({ name, pass, fail, ok, ms: Date.now() - t0, out });
  console.log((ok ? "PASS " : "FAIL ") + name + `  ${pass} passed, ${fail} failed`);
}
const total = rows.reduce((a, r) => a + r.pass, 0), failed = rows.reduce((a, r) => a + r.fail, 0);
const html = `<!doctype html><meta charset="utf-8"><title>EstateOps test report</title>
<style>body{font:15px system-ui;max-width:900px;margin:2rem auto;padding:0 1rem;color:#1a1a1a}
table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:.5rem;text-align:left}
.ok{color:#0a7d33;font-weight:600}.bad{color:#c0262d;font-weight:600}details{margin:.5rem 0}pre{background:#f5f5f5;padding:.75rem;overflow:auto;font-size:12px}</style>
<h1>EstateOps test report</h1>
<p>Run: ${new Date().toLocaleString()} &middot; Node ${process.version} &middot; <span class="${allOk ? "ok" : "bad"}">${allOk ? "ALL PASSED" : "FAILURES"}</span> &middot; ${total} passed, ${failed} failed</p>
<table><tr><th>Suite</th><th>Passed</th><th>Failed</th><th>Time</th><th>Result</th></tr>
${rows.map((r) => `<tr><td>${r.name}</td><td>${r.pass}</td><td>${r.fail}</td><td>${(r.ms / 1000).toFixed(1)}s</td><td class="${r.ok ? "ok" : "bad"}">${r.ok ? "PASS" : "FAIL"}</td></tr>`).join("")}</table>
<p>The browser journey test (tests/ui.test.py) needs Playwright and is run separately.</p>
<h2>Detail</h2>${rows.map((r) => `<details><summary>${r.name}</summary><pre>${esc(r.out)}</pre></details>`).join("")}`;
fs.mkdirSync(path.join(root, "report"), { recursive: true });
fs.writeFileSync(path.join(root, "report", "test-report.html"), html);
console.log("Report: " + path.join(root, "report", "test-report.html"));
if (!process.env.NO_OPEN) { try { // open it in the default browser
  const f = path.join(root, "report", "test-report.html");
  if (process.platform === "win32") spawnSync("cmd", ["/c", "start", "", f], { stdio: "ignore" });
  else if (process.platform === "darwin") spawnSync("open", [f], { stdio: "ignore" });
} catch (e) {} }
process.exit(allOk ? 0 : 1);
