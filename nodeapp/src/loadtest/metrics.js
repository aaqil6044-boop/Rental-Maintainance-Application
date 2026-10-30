"use strict";
const { Samples, percentile, round } = require("./stats");
const { operationOf } = require("./operations");

/** Remove anything that could be a secret or personal data from text that is shown or stored. */
function redact(text) {
  return String(text == null ? "" : text)
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, "[token]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [token]")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/\b[a-f0-9]{32,}\b/gi, "[secret]")
    .replace(/(password|token|secret|authorization)"?\s*[:=]\s*"?[^\s",}]+/gi, "$1=[redacted]")
    .slice(0, 200);
}

const group = (map, key, make) => { let g = map.get(key); if (!g) { g = make(); map.set(key, g); } return g; };

class Metrics {
  constructor() {
    this.all = new Samples();
    this.endpoints = new Map(); this.scenarios = new Map(); this.personas = new Map(); this.stages = new Map(); this.ops = new Map();
    this.status = {}; this.kinds = { timeout: 0, network: 0, http4xx: 0, http5xx: 0, unexpected: 0 };
    this.totals = { requests: 0, ok: 0, failed: 0, timeouts: 0, networkErrors: 0, iterations: 0, failedIterations: 0, sessions: 0, reauths: 0 };
    // Negative authorization checks are tracked apart: a correctly refused request is a PASS, not an application error.
    this.security = { checks: 0, denied: 0, leaks: 0, errors: 0, samples: new Samples(), byCheck: new Map(), leakList: [] };
    this.sec = { reqs: 0, ok: 0, errors: 0, lat: [], iters: 0, itersOk: 0 };
    this.timeline = []; this.errors = []; this.window = []; this.stageName = "start"; this.stageTarget = 0;
  }
  setStage(name, target) { this.stageName = name; this.stageTarget = target; }
  _ep(key) { return group(this.endpoints, key, () => ({ key, samples: new Samples(), errors: 0, status: {} })); }
  _sc(key, persona) { return group(this.scenarios, key, () => ({ key, persona, iterations: 0, failed: 0, errors: 0, samples: new Samples() })); }
  _pe(p) { return group(this.personas, p, () => ({ persona: p, requests: 0, errors: 0, samples: new Samples(), iterations: 0, failed: 0, sessions: 0, journey: new Samples() })); }
  _st(name) { return group(this.stages, name, () => ({ name, requests: 0, errors: 0, samples: new Samples(), iterations: 0, failed: 0, firstT: null, lastT: null, users: 0 })); }
  _op(name) { return group(this.ops, name, () => ({ name, samples: new Samples(), errors: 0 })); }

  /** outcome: "ok" | "http" | "timeout" | "network" */
  record({ key, scenario, persona, status, outcome, ms, ok, message }) {
    const t = this.totals; t.requests++; this.sec.reqs++;
    this.all.add(ms); this.sec.lat.push(ms);
    const e = this._ep(key); e.samples.add(ms);
    const sc = scenario ? this._sc(scenario, persona) : null;
    const pe = persona ? this._pe(persona) : null; if (pe) { pe.requests++; pe.samples.add(ms); }
    const st = this._st(this.stageName); st.requests++; st.samples.add(ms); st.users = Math.max(st.users, this.stageTarget);
    const op = this._op(operationOf(key)); op.samples.add(ms);
    const label = outcome === "timeout" ? "timeout" : outcome === "network" ? "error" : String(status);
    this.status[label] = (this.status[label] || 0) + 1; e.status[label] = (e.status[label] || 0) + 1;
    if (ok) { t.ok++; this.sec.ok++; return; }
    t.failed++; this.sec.errors++; e.errors++; op.errors++; st.errors++; if (sc) sc.errors++; if (pe) pe.errors++;
    if (outcome === "timeout") { t.timeouts++; this.kinds.timeout++; }
    else if (outcome === "network") { t.networkErrors++; this.kinds.network++; }
    else if (status >= 500) this.kinds.http5xx++; else if (status >= 400) this.kinds.http4xx++; else this.kinds.unexpected++;
    if (this.errors.length >= 50) this.errors.shift();
    this.errors.push({ at: new Date().toISOString(), endpoint: key, scenario: scenario || null, persona: persona || null, status: status || null, kind: outcome === "http" ? (status >= 500 ? "http5xx" : status >= 400 ? "http4xx" : "unexpected") : outcome, message: redact(message || (outcome === "http" ? `HTTP ${status}` : outcome)) });
  }

  /**
   * An authorization probe. verdict: "denied" (refused as it should be), "leak" (the server allowed what it must refuse) or "error"
   * (5xx, timeout, network - the probe could not tell). Denials never touch the ordinary error rate or latency; leaks and errors do.
   */
  recordSecurity({ check, key, persona, status, outcome, ms, verdict, message }) {
    const s = this.security; s.checks++; s.samples.add(ms);
    const c = group(s.byCheck, check, () => ({ check, checks: 0, denied: 0, leaks: 0, errors: 0 }));
    c.checks++;
    if (verdict === "denied") { s.denied++; c.denied++; return; }
    if (verdict === "leak") {
      s.leaks++; c.leaks++;
      if (s.leakList.length < 25) s.leakList.push({ at: new Date().toISOString(), check, endpoint: key, persona, status });
    } else { s.errors++; c.errors++; }
    this.record({ key, persona, status, outcome, ms, ok: false, message: verdict === "leak" ? `Authorization leak: HTTP ${status} where a refusal was required (${check})` : message });
  }
  sessionStarted(persona, relogin = false) { this.totals.sessions++; if (relogin) this.totals.reauths++; this._pe(persona).sessions++; }
  iteration({ key, persona, ms, failed }) {
    const t = this.totals; t.iterations++; if (failed) t.failedIterations++;
    this.sec.iters++; if (!failed) this.sec.itersOk++;
    const s = this._sc(key, persona); s.iterations++; if (failed) s.failed++; s.samples.add(ms);
    const pe = this._pe(persona); pe.iterations++; if (failed) pe.failed++; pe.journey.add(ms);
    const st = this._st(this.stageName); st.iterations++; if (failed) st.failed++;
  }
  /** Called once a second: closes the current one-second bucket into the timeline. */
  tick(t, target, active, extra = {}) {
    const lat = Float64Array.from(this.sec.lat).sort();
    const pt = { t, target, active, busy: extra.busy || 0, sessions: extra.sessions != null ? extra.sessions : active, stage: this.stageName,
      requests: this.sec.reqs, errors: this.sec.errors, rps: this.sec.reqs, okRps: this.sec.ok, journeys: this.sec.iters, journeysOk: this.sec.itersOk,
      errorPct: this.sec.reqs ? round((this.sec.errors / this.sec.reqs) * 100) : 0,
      p50: percentile(lat, 50), p95: percentile(lat, 95), p99: percentile(lat, 99) };
    this.timeline.push(pt);
    const st = this._st(this.stageName); if (st.firstT == null) st.firstT = t; st.lastT = t;
    this.window.push(this.sec.reqs); if (this.window.length > 5) this.window.shift();
    this.sec = { reqs: 0, ok: 0, errors: 0, lat: [], iters: 0, itersOk: 0 };
    return pt;
  }
  currentRps() { return this.window.length ? round(this.window.reduce((a, b) => a + b, 0) / this.window.length) : 0; }
  summary(elapsedSec) {
    const t = this.totals; const sm = (x) => x.samples.summary();
    const rate = (n, d) => (d ? round((n / d) * 100) : 0);
    const sec = this.security;
    return {
      elapsedSec: round(elapsedSec),
      totals: { ...t },
      errorRatePct: rate(t.failed, t.requests),
      avgRps: elapsedSec > 0 ? round(t.requests / elapsedSec) : 0,
      currentRps: this.currentRps(),
      throughput: { requestsPerSec: elapsedSec > 0 ? round(t.requests / elapsedSec) : 0, successfulRequestsPerSec: elapsedSec > 0 ? round(t.ok / elapsedSec) : 0,
                    journeysPerSec: elapsedSec > 0 ? round(t.iterations / elapsedSec) : 0, successfulJourneysPerSec: elapsedSec > 0 ? round((t.iterations - t.failedIterations) / elapsedSec) : 0 },
      journeys: { total: t.iterations, failed: t.failedIterations, completionPct: t.iterations ? round(((t.iterations - t.failedIterations) / t.iterations) * 100) : null },
      latency: this.all.summary(),
      statusCodes: { ...this.status },
      errorKinds: { ...this.kinds },
      endpoints: [...this.endpoints.values()].map((e) => ({ key: e.key, operation: operationOf(e.key), ...e.samples.summary(), errors: e.errors, errorRatePct: rate(e.errors, e.samples.count), statusCodes: e.status })).sort((a, b) => (b.p95 || 0) - (a.p95 || 0)),
      operations: [...this.ops.values()].map((o) => ({ name: o.name, ...sm(o), errors: o.errors, errorRatePct: rate(o.errors, o.samples.count) })).sort((a, b) => (b.p95 || 0) - (a.p95 || 0)),
      scenarios: [...this.scenarios.values()].filter((s) => s.iterations > 0).map((s) => ({ key: s.key, persona: s.persona, iterations: s.iterations, failedIterations: s.failed, requestErrors: s.errors, completionPct: s.iterations ? round(((s.iterations - s.failed) / s.iterations) * 100) : null, avgMs: sm(s).avg, p50Ms: sm(s).p50, p95Ms: sm(s).p95, p99Ms: sm(s).p99 })).sort((a, b) => b.iterations - a.iterations),
      personas: [...this.personas.values()].map((p) => ({ persona: p.persona, requests: p.requests, errors: p.errors, errorRatePct: rate(p.errors, p.requests), sessions: p.sessions, journeys: p.iterations, failedJourneys: p.failed, ...pick(sm(p), ["avg", "p50", "p95", "p99", "max"]), journeyP95Ms: p.journey.summary().p95 })).sort((a, b) => b.requests - a.requests),
      stages: [...this.stages.values()].map((s) => { const sp = s.firstT != null ? Math.max(1, s.lastT - s.firstT + 1) : null; return { name: s.name, users: s.users, requests: s.requests, errors: s.errors, errorRatePct: rate(s.errors, s.requests), rps: sp ? round(s.requests / sp) : null, journeys: s.iterations, durationSec: sp, ...pick(sm(s), ["avg", "p50", "p95", "p99", "max"]) }; }),
      security: { checks: sec.checks, denied: sec.denied, leaks: sec.leaks, errors: sec.errors, latency: sec.samples.summary(), byCheck: [...sec.byCheck.values()], leakList: sec.leakList },
      recentErrors: this.errors.slice(-20).reverse(),
      sampleCapReached: this.all.count > this.all.n,
    };
  }
}
function pick(o, keys) { const r = {}; for (const k of keys) r[k] = o[k]; return r; }
module.exports = { Metrics, redact };
