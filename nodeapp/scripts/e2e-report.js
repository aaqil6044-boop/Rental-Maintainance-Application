"use strict";
// Turns report/e2e-results.json (written by `npm run e2e`) into ONE self-contained HTML file with screenshots.
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const SFX = process.env.REPORT_SUFFIX || "";
const data = JSON.parse(fs.readFileSync(path.join(root, "report", `e2e-results${SFX}.json`), "utf8"));
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])).replace(/\u001b\[[0-9;]*m/g, "");
const TITLES = { "regression.spec.js": "Regression suite: critical paths, key rules and the important positive scenarios", "maintenance-workflow.spec.js": "A. Maintenance request workflow (sample-data install)", "platform.spec.js": "B. Platform: service, API docs, role matrix, lists, uploads (sample-data install)", "landing.spec.js": "D. Public landing page (message, links, honesty, accessibility, responsive)", "full-journey.spec.js": "C. Full application journey on an empty database (all four roles)" };
const files = {};
(function walk(suite, file) {
  file = suite.file || file;
  for (const sp of suite.specs || []) for (const t of sp.tests) {
    const r = t.results[t.results.length - 1] || {};
    const shot = (r.attachments || []).find((a) => a.name === "screenshot" && a.path && fs.existsSync(a.path));
    const video = (r.attachments || []).find((a) => a.name === "video");
    (files[file] = files[file] || []).push({ group: suite.title && suite.title !== file ? suite.title : "", title: sp.title, status: t.status === "expected" ? "passed" : t.status, ms: r.duration || 0,
      shot: shot && "data:image/png;base64," + fs.readFileSync(shot.path).toString("base64"), error: r.error && r.error.message });
  }
  for (const s of suite.suites || []) walk(s, file);
})({ suites: data.suites }, "");
const all = Object.values(files).flat();
const passed = all.filter((t) => t.status === "passed").length;
const secs = all.reduce((a, t) => a + t.ms, 0) / 1000;
let body = "";
for (const [f, tests] of Object.entries(files)) {
  const p = tests.filter((t) => t.status === "passed").length;
  body += `<h2>${esc(TITLES[path.basename(f)] || f)} <span class="${p === tests.length ? "ok" : "bad"}">${p}/${tests.length}</span></h2>`;
  let last = null;
  for (const t of tests) {
    if (t.group !== last) { body += t.group ? `<h3>${esc(t.group)}</h3>` : ""; last = t.group; }
    const ok = t.status === "passed";
    body += `<details><summary><span class="${ok ? "ok" : "bad"}">${ok ? "PASS" : "FAIL"}</span> ${esc(t.title)} <span class="ms">${(t.ms / 1000).toFixed(1)}s</span></summary>` +
      (t.error ? `<pre>${esc(t.error).slice(0, 1500)}</pre>` : "") + (t.shot ? `<img src="${t.shot}" alt="final screenshot">` : "") + "</details>";
  }
}
const html = `<!doctype html><meta charset="utf-8"><title>EstateOps ${SFX ? "regression" : "full-application integration and UI"} test report</title>
<style>body{font:15px system-ui;max-width:1000px;margin:2rem auto;padding:0 1rem;color:#1a1a1a}h2{margin-top:2rem;border-bottom:2px solid #1d5a48;padding-bottom:.3rem}h3{margin:1rem 0 .2rem;color:#444}
.ok{color:#0a7d33;font-weight:700}.bad{color:#c0262d;font-weight:700}.ms{color:#777;float:right}details{border-bottom:1px solid #e3e3e3;padding:.4rem 0}summary{cursor:pointer}
img{max-width:100%;border:1px solid #ddd;margin-top:.6rem}pre{background:#f5f5f5;padding:.7rem;overflow:auto;font-size:12px}
.card{display:flex;gap:1rem;margin:1rem 0}.card div{flex:1;border:1px solid #ddd;border-radius:8px;padding:.8rem}.card b{display:block;font-size:26px}
.cmp{border:1px solid #ddd;border-radius:8px;padding:.2rem 1rem;margin:1rem 0;background:#FBFAF6}.cmp h2{border:0;margin:.6rem 0 0}</style>
<h1>EstateOps ${SFX ? "regression" : "full-application integration and UI"} test report</h1>
<p>Real server, real database, real Chromium browser acting as each user. Run: ${new Date(data.stats.startTime).toLocaleString()} &middot; Node ${process.version}</p>
<div class="card"><div><b class="${passed === all.length ? "ok" : "bad"}">${passed}/${all.length}</b>tests passed</div><div><b>${all.length - passed}</b>failed</div><div><b>${secs.toFixed(0)}s</b>total test time</div></div>
<p>Click a test to see its final screenshot. Videos and replayable traces for every test are in <code>report/e2e-html</code> (open with <code>npm run ${SFX ? "regression:report" : "e2e:report"}</code>).</p>${body}`;
const NAME = SFX ? "EstateOps-regression-report.html" : "EstateOps-full-integration-ui-report.html";
let compareHtml = "";
const cmpFile = path.join(root, "report", "regression-compare.json");
if (SFX && fs.existsSync(cmpFile)) {
  const { diff } = JSON.parse(fs.readFileSync(cmpFile, "utf8"));
  const li = (a, f) => a.map((t) => `<li>${esc(f(t))}</li>`).join("");
  compareHtml = diff.first
    ? `<div class="cmp"><h2>Compared with the previous run</h2><p>No earlier run was found, so this run is the baseline. The next run will be compared with it.</p></div>`
    : `<div class="cmp"><h2>Compared with the previous run</h2>
<p>Previous run: ${new Date(diff.previousWhen).toLocaleString()} &middot; ${diff.previous.passed}/${diff.previous.total} passed, ${diff.previous.failed} failed. This run: ${passed}/${all.length} passed.</p>
${diff.newFailures.length ? `<p class="bad">Newly failing (${diff.newFailures.length})</p><ul>${li(diff.newFailures, (t) => `${t.id} ${t.title} (was ${t.was})`)}</ul>` : `<p class="ok">No newly failing tests.</p>`}
${diff.fixed.length ? `<p class="ok">Fixed since last run (${diff.fixed.length})</p><ul>${li(diff.fixed, (t) => `${t.id} ${t.title}`)}</ul>` : ""}
${diff.added.length ? `<p>New tests (${diff.added.length})</p><ul>${li(diff.added, (t) => `${t.id} ${t.title}`)}</ul>` : ""}
${diff.removed.length ? `<p>Removed tests (${diff.removed.length})</p><ul>${li(diff.removed, (t) => `${t.id} ${t.title}`)}</ul>` : ""}
${diff.slower.length ? `<p>Much slower than before (${diff.slower.length})</p><ul>${li(diff.slower, (t) => `${t.id}: ${t.was}ms to ${t.ms}ms`)}</ul>` : ""}
${!diff.newFailures.length && !diff.fixed.length && !diff.added.length && !diff.removed.length ? "<p>Results are identical to the previous run.</p>" : ""}</div>`;
}
const out = path.join(root, "report", NAME);
fs.writeFileSync(out, html);
console.log(`${passed}/${all.length} passed. Report: ${out}`);
process.exit(passed === all.length ? 0 : 1);
