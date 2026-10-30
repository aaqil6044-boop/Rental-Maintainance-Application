"use strict";
// Renders a finished run (plus an optional regression comparison and trends) as ONE self-contained HTML file: no scripts, no external
// requests, charts are inline SVG. It prints well and works offline. Every number comes from the run's own measurements.
const { analyze } = require("./analysis");

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const n = (v, d = 1) => (v == null || !Number.isFinite(Number(v)) ? "–" : String(Math.round(Number(v) * 10 ** d) / 10 ** d));
const COLORS = { blue: "#2a78d6", orange: "#eb6834", aqua: "#1baf7a", red: "#d03b3b", grey: "#8a94a6" };

function nice(max) { if (!(max > 0)) return 1; const p = 10 ** Math.floor(Math.log10(max)); const f = max / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; }

/** series: [{ name, color, values: [y...], dash? }] sharing xs (seconds). */
function lineChart({ xs, series, unit = "", height = 190, bands = null, ariaLabel }) {
  const W = 760, H = height, L = 46, R = 12, T = 12, B = 26;
  const all = series.flatMap((s) => s.values).filter((v) => v != null && Number.isFinite(v));
  if (!xs.length || !all.length) return `<p class="muted">No data was recorded for this chart.</p>`;
  const top = nice(Math.max(...all) * 1.05 || 1), xmax = Math.max(...xs, 1);
  const X = (x) => L + ((W - L - R) * x) / xmax, Y = (y) => T + (H - T - B) * (1 - y / top);
  let g = "";
  for (let i = 0; i <= 4; i++) { const v = (top * i) / 4, y = Y(v); g += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" class="grid"/><text x="${L - 6}" y="${y + 4}" class="tick" text-anchor="end">${esc(n(v, v < 10 ? 1 : 0))}</text>`; }
  for (let i = 0; i <= 5; i++) { const v = (xmax * i) / 5; g += `<text x="${X(v)}" y="${H - 8}" class="tick" text-anchor="middle">${esc(n(v, 0))}s</text>`; }
  let b = "";
  if (bands) bands.forEach((s, i) => { if (i % 2 === 0) b += `<rect x="${X(s.start)}" y="${T}" width="${Math.max(0, X(s.end) - X(s.start))}" height="${H - T - B}" class="band"><title>${esc(s.name)}</title></rect>`; });
  const lines = series.map((s) => {
    let d = "", pen = false;
    s.values.forEach((v, i) => { if (v == null || !Number.isFinite(v)) { pen = false; return; } d += `${pen ? "L" : "M"}${X(xs[i]).toFixed(1)},${Y(v).toFixed(1)}`; pen = true; });
    return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" ${s.dash ? `stroke-dasharray="${s.dash}"` : ""}/>`;
  }).join("");
  const legend = series.map((s) => `<span class="key"><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join("");
  return `<div class="legend">${legend}<span class="muted">${esc(unit)}</span></div><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(ariaLabel || "chart")}">${b}${g}${lines}</svg>`;
}
function barChart({ rows, unit = "", max = null, fmt = (v) => n(v) }) {
  if (!rows.length) return `<p class="muted">No data was recorded for this chart.</p>`;
  const top = max || nice(Math.max(...rows.map((r) => r.value || 0)) * 1.05 || 1);
  return `<div class="bars">${rows.map((r) => `<div class="bar"><span class="lbl" title="${esc(r.label)}">${esc(r.label)}</span><span class="track"><span class="fill" style="width:${Math.max(0.5, Math.min(100, ((r.value || 0) / top) * 100))}%;background:${r.color || COLORS.blue}"></span></span><span class="val">${esc(fmt(r.value))}${esc(unit)}${r.note ? ` <small>${esc(r.note)}</small>` : ""}</span></div>`).join("")}</div>`;
}
const table = (head, rows, cls = "") => `<div class="scroll"><table class="${cls}"><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c == null ? "" : c}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="${head.length}" class="muted">None</td></tr>`}</tbody></table></div>`;
const chip = (label, kind) => `<span class="chip ${esc(kind || String(label).toLowerCase())}">${esc(label)}</span>`;

const CSS = `
:root{--bg:#f6f7f9;--card:#fff;--ink:#1c2430;--mute:#5d6878;--line:#dfe3ea;--grid:#e8ebf0;--band:rgba(42,120,214,.06);--good:#157a52;--warn:#9a5b00;--bad:#b3261e;--info:#2a5fa8}
@media (prefers-color-scheme:dark){:root{--bg:#10151c;--card:#171e28;--ink:#e6ebf2;--mute:#9aa6b8;--line:#2a3442;--grid:#242d3a;--band:rgba(90,160,255,.08);--good:#4cc790;--warn:#e0a63c;--bad:#ff7b72;--info:#7fb2ff}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:1040px;margin:0 auto;padding:24px 16px 64px}h1{font-size:1.6rem;margin:0 0 4px}h2{font-size:1.2rem;margin:32px 0 10px}h3{font-size:1rem;margin:20px 0 6px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 18px;margin:12px 0}.muted{color:var(--mute)}small{color:var(--mute)}
.chip{display:inline-block;padding:2px 10px;border-radius:99px;font-size:.8rem;font-weight:600;border:1px solid currentColor}.chip.passed,.chip.pass,.chip.completed{color:var(--good)}.chip.failed,.chip.regression,.chip.critical{color:var(--bad)}.chip.warning,.chip.inconclusive,.chip.cancelled{color:var(--warn)}.chip.info{color:var(--info)}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:12px 0}.tile{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 12px}.tile b{display:block;font-size:1.35rem}.tile span{color:var(--mute);font-size:.82rem}
table{border-collapse:collapse;width:100%;font-size:.88rem}th,td{padding:6px 8px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}th{color:var(--mute);font-weight:600;white-space:nowrap}td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}.scroll{overflow-x:auto}
svg{width:100%;height:auto;display:block}.grid{stroke:var(--grid)}.tick{fill:var(--mute);font-size:11px}.band{fill:var(--band)}
.legend{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:.82rem;margin-bottom:4px}.key i{display:inline-block;width:12px;height:3px;margin-right:6px;vertical-align:middle;border-radius:2px}
.bars{display:grid;gap:5px}.bar{display:grid;grid-template-columns:minmax(120px,38%) 1fr auto;gap:8px;align-items:center;font-size:.85rem}.lbl{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.track{background:var(--grid);border-radius:4px;height:12px;overflow:hidden}.fill{display:block;height:100%;border-radius:4px}.val{font-variant-numeric:tabular-nums}
.banner{border-left:5px solid var(--line);padding:10px 14px;border-radius:8px;background:var(--card);border:1px solid var(--line)}.banner.pass{border-left-color:var(--good)}.banner.regression{border-left-color:var(--bad)}.banner.warning,.banner.inconclusive{border-left-color:var(--warn)}
ul{margin:6px 0 6px 18px;padding:0}code{background:var(--grid);padding:1px 5px;border-radius:4px;font-size:.85em}
@media (max-width:560px){.bar{grid-template-columns:90px 1fr auto}main{padding:16px 12px 48px}}
@media print{body{background:#fff}.card{break-inside:avoid}}`;

function sev(v) { return chip(v, String(v).toLowerCase()); }
function deltaText(f) {
  if (f.delta == null) return "–";
  const sign = f.delta > 0 ? "+" : "";
  return `${sign}${n(f.delta, 2)}${f.unit === "%" ? " pp" : f.unit ? " " + esc(f.unit) : ""}${f.deltaPct != null && f.unit !== "%" ? ` (${sign}${n(f.deltaPct)}%)` : ""}`;
}

function render(run, { comparison = null, trends = null, generatedAt = new Date().toISOString() } = {}) {
  const s = run.summary || {}, cfg = run.config || {}, meta = run.meta || {}, an = analyze(run), tl = run.timeline || [];
  const lat = s.latency || {}, tot = s.totals || {}, tp = s.throughput || {}, sec = s.security || {};
  const xs = tl.map((p) => p.t);
  const stages = s.stagesPlan || null;
  const verdictKind = run.verdict ? run.verdict : run.state;
  const failedTh = (run.thresholds || []).filter((t) => !t.passed);
  const summaryText = [
    `${esc(run.name)} ran as a ${esc(cfg.profile || "linear")} profile for ${n(s.elapsedSec, 0)} s with up to ${esc(cfg.maxUsers)} virtual users (peak reached: ${esc(s.peakActiveUsers)}).`,
    `${tot.requests ? `${tot.requests.toLocaleString("en-US")} requests were made (${n(s.avgRps)} req/s on average) across ${tot.iterations || 0} user journeys; ${n(s.errorRatePct, 2)}% of requests failed.` : "No requests were recorded."}`,
    lat.p95 != null ? `Response time: median ${n(lat.p50)} ms, p95 ${n(lat.p95)} ms, p99 ${n(lat.p99)} ms.` : "",
    failedTh.length ? `Thresholds missed: ${failedTh.map((t) => `${esc(t.label)} (${n(t.actual, 2)}${esc(t.unit)} vs limit ${esc(t.limit)}${esc(t.unit)})`).join("; ")}.` : (run.thresholds || []).length ? "All configured thresholds were met." : "",
    sec.checks ? (sec.leaks ? `<b>${sec.leaks} authorization leak(s) were found.</b>` : `${sec.checks} negative authorization checks ran and every one was refused correctly.`) : "",
  ].filter(Boolean).map((t) => `<p>${t}</p>`).join("");

  const charts = [];
  charts.push(`<h3>Load: configured users, active users, running journeys and sessions</h3>` + lineChart({ xs, bands: stages, unit: "count", ariaLabel: "Virtual users over time", series: [
    { name: "Configured virtual users", color: COLORS.grey, dash: "5 4", values: tl.map((p) => p.target) },
    { name: "Active virtual users", color: COLORS.blue, values: tl.map((p) => p.active) },
    { name: "Active iterations (journey in progress)", color: COLORS.orange, values: tl.map((p) => p.busy) },
    { name: "Authenticated sessions", color: COLORS.aqua, values: tl.map((p) => p.sessions) }] }));
  charts.push(`<h3>Requests per second</h3>` + lineChart({ xs, bands: stages, unit: "requests / second", ariaLabel: "Requests per second", series: [{ name: "Requests per second", color: COLORS.blue, values: tl.map((p) => p.rps) }, { name: "Successful requests per second", color: COLORS.aqua, values: tl.map((p) => p.okRps) }] }));
  charts.push(`<h3>Response times</h3>` + lineChart({ xs, bands: stages, unit: "milliseconds (per second of the run)", ariaLabel: "Response time percentiles over time", series: [{ name: "p50", color: COLORS.aqua, values: tl.map((p) => p.p50) }, { name: "p95", color: COLORS.orange, values: tl.map((p) => p.p95) }, { name: "p99", color: COLORS.red, values: tl.map((p) => p.p99) }] }));
  charts.push(`<h3>Error rate</h3>` + lineChart({ xs, bands: stages, unit: "% of requests failing", ariaLabel: "Error rate over time", series: [{ name: "Error rate", color: COLORS.red, values: tl.map((p) => p.errorPct) }] }));
  charts.push(`<h3>Throughput: journeys per second</h3>` + lineChart({ xs, bands: stages, unit: "journeys / second", ariaLabel: "Journeys per second", series: [{ name: "Journeys started and finished", color: COLORS.blue, values: tl.map((p) => p.journeys) }, { name: "Journeys with no failed request", color: COLORS.aqua, values: tl.map((p) => p.journeysOk) }] }));

  const ep = (s.endpoints || []).filter((e) => e.count >= 5).slice(0, 12);
  const epChart = barChart({ rows: ep.map((e) => ({ label: e.key, value: e.p95, note: `n=${e.count}`, color: e.errors ? COLORS.red : COLORS.blue })), unit: " ms" });
  const roleChart = barChart({ rows: (s.personas || []).map((p) => ({ label: p.persona, value: p.p95, note: `${p.requests} req` })), unit: " ms" });
  const jChart = barChart({ rows: (s.scenarios || []).filter((x) => x.completionPct != null).map((x) => ({ label: x.key, value: x.completionPct, note: `${x.iterations} runs`, color: x.completionPct < 95 ? COLORS.red : COLORS.aqua })), unit: "%", max: 100 });

  const th = table(["Threshold", "Limit", "Measured", "Result"], (run.thresholds || []).map((t) => [esc(t.label), `${esc(t.limit)}${esc(t.unit)}`, `${n(t.actual, 2)}${esc(t.unit)}`, chip(t.passed ? "PASS" : "FAIL", t.passed ? "pass" : "failed")]));
  const stageTable = table(["Stage", "Peak users", "Requests", "Req/s", "p95 ms", "p99 ms", "Errors %"], (s.stages || []).map((x) => [esc(x.name), x.users, x.requests, n(x.rps), n(x.p95), n(x.p99), n(x.errorRatePct, 2)]), "num");
  const epTable = table(["Endpoint", "Operation", "Count", "p50", "p95", "p99", "max", "Errors %"], (s.endpoints || []).map((e) => [`<code>${esc(e.key)}</code>`, esc(e.operation), e.count, n(e.p50), n(e.p95), n(e.p99), n(e.max), n(e.errorRatePct, 2)]));
  const opTable = table(["Business operation", "Count", "avg", "p95", "p99", "Errors %"], (s.operations || []).map((o) => [esc(o.name), o.count, n(o.avg), n(o.p95), n(o.p99), n(o.errorRatePct, 2)]));
  const roleTable = table(["Role", "Sessions", "Journeys", "Requests", "p50", "p95", "p99", "Errors %", "Journey p95 ms"], (s.personas || []).map((p) => [esc(p.persona), p.sessions, p.journeys, p.requests, n(p.p50), n(p.p95), n(p.p99), n(p.errorRatePct, 2), n(p.journeyP95Ms)]));
  const scTable = table(["Journey", "Role", "Runs", "Completed %", "p50 ms", "p95 ms", "p99 ms"], (s.scenarios || []).map((x) => [esc(x.key), esc(x.persona), x.iterations, n(x.completionPct), n(x.p50Ms), n(x.p95Ms), n(x.p99Ms)]));
  const secTable = table(["Check", "Runs", "Refused correctly", "Leaks", "Unclear (5xx/timeout)"], (sec.byCheck || []).map((c) => [esc(c.check), c.checks, c.denied, c.leaks ? `<b>${c.leaks}</b>` : 0, c.errors]));
  const bn = an.bottlenecks.map((o) => `<li>${chip(o.severity, o.severity)} <b>${esc(o.title)}</b><br><span class="muted">${esc(o.detail)}</span></li>`).join("");

  const res = run.resources || {};
  const resBlock = res.available
    ? `<p class="muted">${esc(res.source)}. ${esc(res.note || "")}</p><div class="tiles"><div class="tile"><b>${n(res.peak && res.peak.cpuPct)}%</b><span>peak server CPU (one core)</span></div><div class="tile"><b>${n(res.peak && res.peak.rssMb, 0)} MB</b><span>peak memory (RSS)</span></div><div class="tile"><b>${n(res.peak && res.peak.lagP95Ms)} ms</b><span>peak event-loop delay</span></div><div class="tile"><b>${n(res.peak && res.peak.dbMb)} MB</b><span>database file</span></div></div>` + lineChart({ xs: (res.series || []).map((p) => p.t), unit: "% of one core / MB", ariaLabel: "Server resources over time", series: [{ name: "CPU %", color: COLORS.orange, values: (res.series || []).map((p) => p.cpuPct) }, { name: "Memory MB", color: COLORS.blue, values: (res.series || []).map((p) => p.rssMb) }] })
    : `<p><b>Not available.</b> ${esc(res.reason || "Server resource metrics were not measured.")}</p>`;

  let cmp = "";
  if (comparison) {
    const c = comparison;
    cmp = `<h2 id="comparison">Comparison with ${esc(c.base.name)} (#${esc(c.base.id)})</h2>
<div class="banner ${esc(c.classification.toLowerCase())}"><b>${chip(c.classification)}</b> ${c.reasons.map(esc).join(" ")}<br><small>Baseline: run #${esc(c.base.id)}${c.base.knownGood ? " (known-good reference)" : ""}${c.base.gitCommit ? ", commit " + esc(c.base.gitCommit) : ""}. Current: run #${esc(c.current.id)}${c.current.gitCommit ? ", commit " + esc(c.current.gitCommit) : ""}. ${c.counts.regression} regression(s), ${c.counts.warning} warning(s), ${c.counts.inconclusive} inconclusive.</small></div>
${c.comparability.blocking.length ? `<h3>Why this comparison is not conclusive</h3><ul>${c.comparability.blocking.map((b) => `<li>${esc(b.message)}</li>`).join("")}</ul>` : ""}
${c.comparability.warnings.length ? `<h3>Comparability notes</h3><ul>${c.comparability.warnings.map((b) => `<li>${esc(b.message)}</li>`).join("")}</ul>` : ""}
<h3>Headline metrics</h3>${table(["Metric", "Baseline", "Current", "Change", "Limit", "Result"], c.headline.map((f) => [esc(f.metric), n(f.base, 2), n(f.current, 2), deltaText(f), f.limitPp != null ? `+${f.limitPp} pp` : f.limitPct != null ? `${f.limitPct}%` : "–", sev(f.severity) + (f.note ? `<br><small>${esc(f.note)}</small>` : "")]))}
<h3>Where it changed</h3><p class="muted">Every difference beyond a limit, traced to the endpoint, journey, role, operation or load stage where it was measured.</p>
${table(["Result", "Scope", "Subject", "Metric", "Baseline", "Current", "Change", "Load"], c.findings.filter((f) => f.scope !== "global" && f.severity !== "PASS").slice(0, 60).map((f) => [sev(f.severity), esc(f.scope), `<code>${esc(f.subject)}</code>`, esc(f.metric), n(f.base, 2), n(f.current, 2), deltaText(f), esc(f.load || "")]))}
<h3>Limits of this comparison</h3><ul>${c.limitations.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>`;
  }
  let trendHtml = "";
  if (trends && trends.length && trends[0].series.length >= 2) {
    trendHtml = `<h2>Trends across comparable runs</h2>` + trends.map((t) => `<div class="card"><b>${esc(t.label)}</b> ${t.direction !== "stable" ? chip(t.direction, t.direction === "degrading" ? "regression" : "pass") : ""} ${t.gradual ? chip("gradual drift", "warning") : ""}<br><small>${esc(t.note)}</small>${lineChart({ xs: t.series.map((_, i) => i + 1), height: 120, unit: "run number (oldest to newest)", ariaLabel: t.label + " across runs", series: [{ name: t.label, color: COLORS.blue, values: t.series.map((p) => p.value) }] })}</div>`).join("");
  }

  const metaRows = [["Run", `#${esc(run.id)} — ${esc(run.name)}`], ["State / verdict", `${esc(run.state)} / ${esc(run.verdict || "none")}`], ["Started", esc(run.startedAt || "")], ["Environment", `${esc((meta.environment || {}).name)} (${esc((meta.environment || {}).kind)})`],
    ["Application version", `${esc(meta.appVersion)}${meta.gitCommit ? " · commit " + esc(meta.gitCommit) : " · commit unavailable"}`], ["Framework", esc(meta.framework)], ["Scenario version", esc(meta.scenarioVersion)],
    ["Dataset", meta.dataset ? `${esc(meta.datasetId)} — ${meta.dataset.orgs} organization(s), ${meta.dataset.accounts} accounts, ${meta.dataset.units} units` : esc(meta.datasetId || "not recorded")],
    ["Infrastructure", meta.infrastructure ? `${esc(meta.infrastructure.platform)}, ${esc(meta.infrastructure.cpuCores)} cores, ${esc(meta.infrastructure.memoryMb)} MB RAM, Node ${esc(meta.infrastructure.node)}<br><small>${esc(meta.infrastructure.loadGenerator)}. Server metrics: ${esc(meta.infrastructure.serverMetrics)}</small>` : "not recorded"],
    ["Random seed", esc(cfg.resolvedSeed != null ? cfg.resolvedSeed : cfg.seed)], ["Report generated", esc(generatedAt)]];

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(run.name)} – EstateOps performance report</title><style>${CSS}</style></head><body><main>
<h1>${esc(run.name)}</h1><p class="muted">EstateOps Performance Testing Center · run #${esc(run.id)} · ${chip(String(verdictKind || "").toUpperCase(), String(verdictKind || "").toLowerCase())}${comparison ? " · regression check " + chip(comparison.classification) : ""}</p>
<h2>Executive summary</h2><div class="card">${summaryText}</div>
<div class="tiles"><div class="tile"><b>${n(lat.p95)} ms</b><span>p95 response time</span></div><div class="tile"><b>${n(lat.p99)} ms</b><span>p99 response time</span></div><div class="tile"><b>${n(tp.requestsPerSec)}</b><span>requests / second</span></div><div class="tile"><b>${n(tp.successfulRequestsPerSec)}</b><span>successful requests / second</span></div><div class="tile"><b>${n(tp.journeysPerSec, 2)}</b><span>journeys / second</span></div><div class="tile"><b>${n(s.errorRatePct, 2)}%</b><span>error rate</span></div><div class="tile"><b>${tot.sessions || 0}</b><span>sessions (sign-ins)</span></div><div class="tile"><b>${s.peakActiveUsers == null ? "–" : s.peakActiveUsers}</b><span>peak active users</span></div></div>
<h3>Reliability</h3><div class="tiles"><div class="tile"><b>${tot.requests || 0}</b><span>requests</span></div><div class="tile"><b>${tot.failed || 0}</b><span>failed requests</span></div><div class="tile"><b>${(s.errorKinds || {}).http5xx || 0}</b><span>server errors (5xx)</span></div><div class="tile"><b>${tot.timeouts || 0}</b><span>timeouts</span></div><div class="tile"><b>${tot.networkErrors || 0}</b><span>connection failures</span></div><div class="tile"><b>${(s.journeys || {}).completionPct == null ? "–" : n((s.journeys || {}).completionPct) + "%"}</b><span>journeys completed cleanly</span></div></div>
${(run.warnings || []).length ? `<div class="card"><b>Notes and warnings</b><ul>${run.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></div>` : ""}
<h2>Thresholds</h2><div class="card">${th}</div>
${cmp}
<h2>Charts</h2><div class="card">${charts.join("")}</div>
<div class="card"><h3>Endpoint performance (p95, slowest 12; red = had errors)</h3>${epChart}</div>
<div class="card"><h3>Role performance (p95)</h3>${roleChart}</div>
<div class="card"><h3>Journey completion</h3>${jChart}</div>
<h2>Analysis</h2><div class="card"><h3>Bottleneck indicators</h3><ul>${bn}</ul></div>
<h3>By ramp stage</h3><div class="card">${stageTable}</div>
<h3>By business operation</h3><div class="card">${opTable}</div>
<h3>By role</h3><div class="card">${roleTable}</div>
<h3>By journey</h3><div class="card">${scTable}</div>
<h3>By endpoint</h3><div class="card">${epTable}</div>
<h2>Security checks (reported separately from errors)</h2><div class="card"><p class="muted">Negative authorization and cross-tenant checks. A refusal is the correct result and is not counted as an application error; a success is an authorization leak.</p>${secTable}</div>
<h2>Server resources</h2><div class="card">${resBlock}</div>
${trendHtml}
<h2>Run details</h2><div class="card">${table(["", ""], metaRows)}<h3>Configuration</h3><pre style="white-space:pre-wrap;overflow-x:auto;font-size:.8rem">${esc(JSON.stringify({ ...cfg, confirmTarget: undefined }, null, 2))}</pre></div>
<p class="muted">User types: tenant, manager (property manager), technician, vendor and admin are simulated. <b>Owner</b> is not available: EstateOps has no owner account role yet.</p>
</main></body></html>`;
}
module.exports = { render, lineChart, barChart, esc };
