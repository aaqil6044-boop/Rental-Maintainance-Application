"use strict";
// Exact percentiles (nearest-rank) over every recorded sample. No averaging tricks, no estimation.
class Samples {
  constructor(cap = 1 << 20) { this.cap = cap; this.a = new Float64Array(1024); this.n = 0; this.count = 0; this.sum = 0; this.min = Infinity; this.max = 0; }
  add(v) {
    if (this.n === this.a.length) { const b = new Float64Array(Math.min(this.cap, this.a.length * 2)); b.set(this.a); this.a = b; }
    if (this.n < this.a.length) this.a[this.n++] = v;
    this.sum += v; this.count++;
    if (v < this.min) this.min = v; if (v > this.max) this.max = v;
  }
  get size() { return this.n; }
  sorted() { const s = this.a.slice(0, this.n); s.sort(); return s; }
  summary() {
    if (!this.n) return { count: 0, min: null, avg: null, p50: null, p90: null, p95: null, p99: null, max: null };
    const s = this.sorted();
    return { count: this.count, min: round(this.min), avg: round(this.sum / this.count), p50: percentile(s, 50), p90: percentile(s, 90), p95: percentile(s, 95), p99: percentile(s, 99), max: round(this.max) };
  }
}
const round = (v) => Math.round(v * 100) / 100;
/** Nearest-rank percentile of an ASCENDING array. p in (0,100]. */
function percentile(sorted, p) {
  if (!sorted.length) return null;
  const rank = Math.ceil((p / 100) * sorted.length);
  return round(sorted[Math.min(sorted.length, Math.max(1, rank)) - 1]);
}
function percentileOf(values, p) { const s = Float64Array.from(values).sort(); return percentile(s, p); }

/** Evaluate configured thresholds against a summary. Passing means the PERFORMANCE met the thresholds, not merely that the run finished. */
function evaluateThresholds(th, s) {
  const out = [];
  const add = (key, label, limit, actual, ok, unit) => out.push({ key, label, limit, actual, unit, passed: ok });
  if (th.maxErrorRatePct != null) add("errorRate", "Error rate", th.maxErrorRatePct, s.errorRatePct, s.errorRatePct != null && s.errorRatePct <= th.maxErrorRatePct, "%");
  if (th.maxP95Ms != null) add("p95", "p95 response time", th.maxP95Ms, s.latency.p95, s.latency.p95 != null && s.latency.p95 <= th.maxP95Ms, "ms");
  if (th.maxP99Ms != null) add("p99", "p99 response time", th.maxP99Ms, s.latency.p99, s.latency.p99 != null && s.latency.p99 <= th.maxP99Ms, "ms");
  if (th.minRps != null) add("rps", "Throughput", th.minRps, s.avgRps, s.avgRps != null && s.avgRps >= th.minRps, "req/s");
  if (th.maxSecurityLeaks != null && s.security) add("securityLeaks", "Authorization leaks", th.maxSecurityLeaks, s.security.leaks, s.security.leaks <= th.maxSecurityLeaks, "");
  return out;
}
module.exports = { Samples, percentile, percentileOf, evaluateThresholds, round };
