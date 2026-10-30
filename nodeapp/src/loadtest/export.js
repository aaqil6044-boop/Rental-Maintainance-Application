"use strict";
// CSV / JSON export and run comparison. Pure functions over a run's detail object.

/** RFC 4180 quoting, plus a guard so a spreadsheet never executes a cell that starts with = + - @ */
function cell(v) {
  if (v == null) return "";
  let s = typeof v === "object" ? JSON.stringify(v) : String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
const csv = (header, rows) => [header.map(cell).join(","), ...rows.map((r) => r.map(cell).join(","))].join("\r\n") + "\r\n";

const PARTS = ["summary", "endpoints", "scenarios", "timeline", "errors", "thresholds"];

function toCsv(run, part) {
  const s = run.summary || {}, l = s.latency || {};
  switch (part) {
    case "summary": return csv(["metric", "value", "unit"], [
      ["run_id", run.id, ""], ["name", run.name, ""], ["target", run.target, ""], ["state", run.state, ""], ["verdict", run.verdict, ""], ["started_by", run.startedBy.name, ""],
      ["started_at", run.startedAt, ""], ["finished_at", run.finishedAt, ""], ["seed", run.seed, ""],
      ["planned_duration", run.plannedDurationSec, "s"], ["elapsed", s.elapsedSec, "s"], ["max_users_configured", run.maxUsers, "users"], ["peak_active_users", s.peakActiveUsers, "users"],
      ["requests", s.totals && s.totals.requests, "requests"], ["succeeded", s.totals && s.totals.ok, "requests"], ["failed", s.totals && s.totals.failed, "requests"], ["timeouts", s.totals && s.totals.timeouts, "requests"],
      ["iterations", s.totals && s.totals.iterations, "scenario runs"], ["error_rate", s.errorRatePct, "%"], ["avg_throughput", s.avgRps, "requests/s"],
      ["latency_min", l.min, "ms"], ["latency_avg", l.avg, "ms"], ["latency_p50", l.p50, "ms"], ["latency_p90", l.p90, "ms"], ["latency_p95", l.p95, "ms"], ["latency_p99", l.p99, "ms"], ["latency_max", l.max, "ms"],
    ]);
    case "endpoints": return csv(["endpoint", "requests", "errors", "error_rate_pct", "min_ms", "avg_ms", "p50_ms", "p90_ms", "p95_ms", "p99_ms", "max_ms"],
      (s.endpoints || []).map((e) => [e.key, e.count, e.errors, e.errorRatePct, e.min, e.avg, e.p50, e.p90, e.p95, e.p99, e.max]));
    case "scenarios": return csv(["scenario", "user_type", "iterations", "failed_iterations", "request_errors", "avg_ms", "p95_ms"],
      (s.scenarios || []).map((x) => [x.key, x.persona, x.iterations, x.failedIterations, x.requestErrors, x.avgMs, x.p95Ms]));
    case "timeline": return csv(["second", "target_users", "active_users", "requests", "errors", "requests_per_s", "p50_ms", "p95_ms", "p99_ms"],
      (run.timeline || []).map((p) => [p.t, p.target, p.active, p.requests, p.errors, p.rps, p.p50, p.p95, p.p99]));
    case "errors": return csv(["kind", "count", "detail"], [
      ...Object.entries(s.statusCodes || {}).map(([k, v]) => ["http_status", v, k]), ...Object.entries(s.errorKinds || {}).map(([k, v]) => ["error_kind", v, k]),
      ...(s.recentErrors || []).map((e) => ["recent", 1, `${e.endpoint || e.key || ""} ${e.status || ""} ${e.message || ""}`.trim()])]);
    case "thresholds": return csv(["threshold", "limit", "actual", "passed"], (run.thresholds || []).map((t) => [t.label, t.limit, t.actual, t.passed ? "yes" : "no"]));
    default: return null;
  }
}

const METRICS = [
  ["p95Ms", "p95 latency", "ms", "lower"], ["p99Ms", "p99 latency", "ms", "lower"], ["avgRps", "Throughput", "req/s", "higher"],
  ["errorRatePct", "Error rate", "%", "lower"], ["requests", "Requests", "", "none"], ["peakUsers", "Peak users", "", "none"],
];
function metricsOf(r) { const l = (r.summary && r.summary.latency) || {}; return { p95Ms: l.p95 ?? null, p99Ms: l.p99 ?? null, avgRps: r.avgRps, errorRatePct: r.errorRatePct, requests: r.requests, peakUsers: r.peakUsers }; }

/** Compares runs to the first one (the baseline). Differences are reported with the direction that counts as better. */
function compare(runs) {
  const base = runs[0]; const bm = metricsOf(base);
  const rows = runs.map((r) => {
    const m = metricsOf(r); const out = { id: r.id, name: r.name, state: r.state, verdict: r.verdict, metrics: m, vsBaseline: {} };
    if (r !== base) for (const [k, , , better] of METRICS) {
      const a = bm[k], b = m[k]; if (a == null || b == null) { out.vsBaseline[k] = null; continue; }
      const delta = Math.round((b - a) * 100) / 100, pct = a !== 0 ? Math.round(((b - a) / a) * 1000) / 10 : null;
      const verdict = better === "none" || delta === 0 || (pct != null && Math.abs(pct) < 5) ? "similar" : (better === "lower" ? delta < 0 : delta > 0) ? "improved" : "regressed";
      out.vsBaseline[k] = { delta, pct, verdict };
    }
    return out;
  });
  const keys = ["maxUsers", "startUsers", "durationSec", "rampUpSec", "rampDownSec", "thinkMinMs", "thinkMaxMs", "pacingMs", "randomization", "seed", "includeWrites", "target"];
  const differing = keys.filter((k) => runs.some((r) => JSON.stringify((r.config || {})[k]) !== JSON.stringify((base.config || {})[k])));
  const notes = [];
  if (differing.length) notes.push(`These runs used different settings (${differing.join(", ")}), so differences may come from the test, not the application.`);
  if (runs.some((r) => r.state !== "COMPLETED")) notes.push("At least one run did not complete; its numbers cover only part of the planned profile.");
  if (runs.some((r) => r.config && r.config.seed == null)) notes.push("At least one run had no seed, so its traffic mix was not reproducible.");
  return { baselineId: base.id, metrics: METRICS.map(([key, label, unit, better]) => ({ key, label, unit, better })), runs: rows, differingSettings: differing, notes };
}
module.exports = { toCsv, compare, PARTS, cell };
