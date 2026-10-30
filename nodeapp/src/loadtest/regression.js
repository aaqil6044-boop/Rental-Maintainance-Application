"use strict";
// Performance regression analysis. Pure functions over two (or more) finished run reports - no I/O, no clock.
//
//   classification  PASS | WARNING | REGRESSION | INCONCLUSIVE
//   Every finding names the metric, the subject (endpoint / journey / role / stage / operation) and the load it was measured under,
//   so a regression can be traced to where it happened.
//
// What this does NOT claim: one run against one baseline cannot separate a real change from run-to-run noise. The module therefore
//  (1) refuses a verdict when the two runs were not measured under comparable conditions,
//  (2) ignores differences smaller than the measured noise when 3+ comparable runs exist, and
//  (3) otherwise checks the two runs' per-second latency samples and downgrades a REGRESSION to a WARNING when the difference
//      is inside that within-run variation. Repeat the run (or keep history) for a firm conclusion.
const SEVERITY = { PASS: 0, INCONCLUSIVE: 1, WARNING: 2, REGRESSION: 3 };
const worst = (a, b) => (SEVERITY[b] > SEVERITY[a] ? b : a);
const round = (v, d = 2) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);

const DEFAULT_RULES = {
  global: { p95LatencyIncreasePercent: 15, p99LatencyIncreasePercent: 20, throughputDecreasePercent: 10, errorRateIncreasePercentagePoints: 0.5 },
  minAbsoluteMs: { p95: 10, p99: 20, p50: 5 },       // a change smaller than this many milliseconds is never a regression
  minSamples: { requests: 300, endpoint: 30, journey: 20, role: 100, stage: 50, operation: 30 },
  strongSamples: 100,                                 // below this many samples in either run, a sub-scope finding is at most a WARNING (its p95 rests on a handful of requests)
  warnAtFraction: 0.5,                                // a change beyond half the limit is a WARNING
  noiseSigmas: 2,                                     // measured noise band = this many standard deviations of comparable history
  endpoints: {},                                      // per-endpoint overrides, e.g. { "GET /api/dashboard": { p95LatencyIncreasePercent: 25 } }
  journeys: {},                                       // per-journey overrides, e.g. { "tenant.report": { p95LatencyIncreasePercent: 30 } }
};

function mergeRules(user = {}) {
  const u = user || {};
  return {
    ...DEFAULT_RULES, ...u,
    global: { ...DEFAULT_RULES.global, ...(u.global || {}) },
    minAbsoluteMs: { ...DEFAULT_RULES.minAbsoluteMs, ...(u.minAbsoluteMs || {}) },
    minSamples: { ...DEFAULT_RULES.minSamples, ...(u.minSamples || {}) },
    endpoints: { ...(u.endpoints || {}) }, journeys: { ...(u.journeys || {}) },
  };
}

/* ------------------------------------------------------------------------------------------------ comparability */
const shares = (w = {}) => { const keys = ["tenant", "manager", "technician", "vendor", "admin"]; const sum = keys.reduce((a, k) => a + (Number(w[k]) || 0), 0) || 1; return Object.fromEntries(keys.map((k) => [k, ((Number(w[k]) || 0) / sum) * 100])); };

/**
 * Are the two runs measured under conditions that make a performance comparison meaningful?
 * `blocking` problems make the result INCONCLUSIVE; `warnings` are shown but allow a verdict.
 */
function comparability(base, cur) {
  const blocking = [], warnings = [];
  const a = base.config || {}, b = cur.config || {}, ma = base.meta || {}, mb = cur.meta || {};
  const block = (field, x, y, msg) => blocking.push({ field, base: x, current: y, message: msg });
  const warn = (field, x, y, msg) => warnings.push({ field, base: x, current: y, message: msg });
  const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
  const pa = a.profile || "linear", pb = b.profile || "linear";
  if (pa !== pb) block("profile", pa, pb, `Load profiles differ (${pa} vs ${pb}).`);
  if (a.maxUsers !== b.maxUsers) block("maxUsers", a.maxUsers, b.maxUsers, `Peak users differ (${a.maxUsers} vs ${b.maxUsers}).`);
  if (a.startUsers !== b.startUsers && pa !== "custom") warn("startUsers", a.startUsers, b.startUsers, `Starting users differ (${a.startUsers} vs ${b.startUsers}).`);
  if (a.durationSec && b.durationSec && Math.abs(a.durationSec - b.durationSec) / Math.max(a.durationSec, b.durationSec) > 0.1) block("durationSec", a.durationSec, b.durationSec, `Durations differ by more than 10% (${a.durationSec}s vs ${b.durationSec}s).`);
  else if (a.durationSec !== b.durationSec) warn("durationSec", a.durationSec, b.durationSec, `Durations differ slightly (${a.durationSec}s vs ${b.durationSec}s).`);
  if (a.rampUpSec !== b.rampUpSec || a.rampDownSec !== b.rampDownSec) warn("ramp", [a.rampUpSec, a.rampDownSec], [b.rampUpSec, b.rampDownSec], "Ramp-up or ramp-down lengths differ.");
  if (pa === "custom" && !same(a.stages, b.stages)) block("stages", a.stages, b.stages, "Custom stage definitions differ.");
  const sa = shares(a.personaWeights), sb = shares(b.personaWeights);
  const drift = Object.keys(sa).filter((k) => Math.abs(sa[k] - sb[k]) > 5);
  if (drift.length) block("personaWeights", sa, sb, `User-type mix differs by more than 5 points for: ${drift.join(", ")}.`);
  if ((a.orgs || 1) !== (b.orgs || 1)) block("orgs", a.orgs || 1, b.orgs || 1, `Number of test organizations differs (${a.orgs || 1} vs ${b.orgs || 1}).`);
  if (!!a.includeWrites !== !!b.includeWrites) block("includeWrites", a.includeWrites, b.includeWrites, "One run wrote records and the other did not.");
  if (ma.scenarioVersion && mb.scenarioVersion && ma.scenarioVersion !== mb.scenarioVersion) block("scenarioVersion", ma.scenarioVersion, mb.scenarioVersion, "The journey definitions changed between the runs (scenario version differs).");
  const ea = (ma.environment || {}), eb = (mb.environment || {});
  if (ea.name !== eb.name || ea.kind !== eb.kind) block("environment", ea.name, eb.name, `Different environments (${ea.name || "?"} vs ${eb.name || "?"}).`);
  if (ma.datasetId && mb.datasetId && ma.datasetId !== mb.datasetId) block("datasetId", ma.datasetId, mb.datasetId, "The synthetic dataset differs in scale or shape.");
  if (!ma.datasetId || !mb.datasetId) warn("datasetId", ma.datasetId || null, mb.datasetId || null, "A dataset id is missing, so dataset comparability could not be checked.");
  if (a.seed !== b.seed || (a.resolvedSeed != null && b.resolvedSeed != null && a.resolvedSeed !== b.resolvedSeed)) warn("seed", a.resolvedSeed != null ? a.resolvedSeed : a.seed, b.resolvedSeed != null ? b.resolvedSeed : b.seed, "Different random seeds: the traffic was not identical, which adds noise.");
  if (!same([a.thinkMinMs, a.thinkMaxMs, a.pacingMs, a.thinkKinds], [b.thinkMinMs, b.thinkMaxMs, b.pacingMs, b.thinkKinds])) warn("thinkTime", null, null, "Think times or pacing differ, which changes the request rate.");
  if (a.randomization !== b.randomization) warn("randomization", a.randomization, b.randomization, "Randomization differs.");
  const ia = ma.infrastructure || {}, ib = mb.infrastructure || {};
  if (ia.cpuCores && ib.cpuCores && ia.cpuCores !== ib.cpuCores) warn("cpuCores", ia.cpuCores, ib.cpuCores, `Different CPU core counts (${ia.cpuCores} vs ${ib.cpuCores}): the machines are not alike.`);
  if (ia.node && ib.node && ia.node !== ib.node) warn("node", ia.node, ib.node, `Different Node.js versions (${ia.node} vs ${ib.node}).`);
  if (ia.platform && ib.platform && ia.platform !== ib.platform) warn("platform", ia.platform, ib.platform, "Different operating systems.");
  if (ma.gitCommit && mb.gitCommit && ma.gitCommit === mb.gitCommit) warnings.push({ field: "gitCommit", base: ma.gitCommit, current: mb.gitCommit, message: "Both runs are the same code version: any difference is noise, not a regression." });
  for (const r of [base, cur]) if (r.state && r.state !== "COMPLETED") warn("state", r.state, null, `Run #${r.id} did not complete (${r.state}); its profile was cut short.`);
  return { comparable: blocking.length === 0, blocking, warnings };
}

/* ------------------------------------------------------------------------------------------------ noise */
const mean = (x) => x.reduce((s, v) => s + v, 0) / x.length;
const sd = (x) => { if (x.length < 2) return 0; const m = mean(x); return Math.sqrt(x.reduce((s, v) => s + (v - m) ** 2, 0) / (x.length - 1)); };

/** Run-to-run noise (percent of the mean) of a metric across comparable history runs. Needs 3+ runs; otherwise null. */
function historyNoise(runs, get, sigmas = 2) {
  const v = runs.map(get).filter((x) => x != null && Number.isFinite(x)); if (v.length < 3) return null;
  const m = mean(v); if (!m) return null;
  return { runs: v.length, meanValue: round(m), sdValue: round(sd(v)), noisePct: round((sigmas * sd(v) / m) * 100) };
}
/** Within-run variation: mean and standard error of the per-second values in the steady part of a run. */
function intervalOf(run, field) {
  const tl = (run.timeline || []).filter((p) => p.requests >= 3 && p[field] != null);
  if (tl.length < 8) return null;
  const mid = tl.slice(Math.floor(tl.length * 0.25), Math.ceil(tl.length * 0.85));
  const v = mid.map((p) => p[field]); const m = mean(v);
  return { mean: m, se: sd(v) / Math.sqrt(v.length), n: v.length };
}
function withinNoise(base, cur, field, delta) {
  const a = intervalOf(base, field), b = intervalOf(cur, field); if (!a || !b) return false;
  const bound = 1.96 * Math.sqrt(a.se ** 2 + b.se ** 2);
  return Math.abs(delta) <= bound;
}

/* ------------------------------------------------------------------------------------------------ judging */
function grade({ pct, limit, absDelta, minAbs, warnAt }) {
  if (pct == null) return "PASS";
  if (absDelta < minAbs) return "PASS";
  if (pct >= limit) return "REGRESSION";
  if (pct >= limit * warnAt) return "WARNING";
  return "PASS";
}
const dir = (delta, worseWhenUp) => (delta === 0 || delta == null ? "same" : (delta > 0) === worseWhenUp ? "worse" : "better");

function latencyFinding({ scope, subject, metric, base, cur, nBase, nCur, minSamples, limit, minAbs, warnAt, noisePct, noiseNote, load, intervalCheck, support, strongSamples }) {
  const f = { scope, subject, metric, unit: "ms", base, current: cur, delta: null, deltaPct: null, direction: "same", limitPct: limit, severity: "PASS", load: load || null, note: null };
  if (base == null || cur == null) { f.severity = "INCONCLUSIVE"; f.note = "No measurement in one of the runs."; return f; }
  f.delta = round(cur - base); f.deltaPct = base > 0 ? round(((cur - base) / base) * 100, 1) : null; f.direction = dir(cur - base, true);
  if (Math.min(nBase || 0, nCur || 0) < minSamples) { f.severity = "INCONCLUSIVE"; f.note = `Too few samples (${nBase}/${nCur}; need ${minSamples} in both runs).`; return f; }
  let effective = limit; if (noisePct != null && noisePct > limit) { effective = noisePct; f.note = `Limit raised to ${noisePct}% because comparable runs vary that much on their own.`; }
  f.limitPct = effective;
  f.severity = f.direction === "worse" ? grade({ pct: f.deltaPct, limit: effective, absDelta: Math.abs(cur - base), minAbs, warnAt }) : "PASS";
  if (f.severity === "REGRESSION" && intervalCheck && intervalCheck(cur - base)) { f.severity = "WARNING"; f.note = "The difference is within the variation seen inside the runs themselves; repeat the run to confirm."; }
  // A sub-scope (endpoint, journey, role, ...) has far fewer samples than the whole run, and its p95 can be moved by two or three slow requests.
  // So a REGRESSION there needs (a) enough samples and (b) corroboration: the median or the average moved too, i.e. the whole distribution shifted.
  if (f.severity === "REGRESSION" && support) {
    const pctOf = (a, b) => (a > 0 && b != null ? ((b - a) / a) * 100 : null);
    const p50 = pctOf(support.baseP50, support.curP50), avg = pctOf(support.baseAvg, support.curAvg);
    const shifted = (p50 != null && p50 >= effective * warnAt) || (avg != null && avg >= effective);
    if (!shifted) { f.severity = "WARNING"; f.note = "Only the slowest requests changed; the median and average did not. That looks like a few outliers, not a shift. Repeat the run to confirm."; }
    else if (Math.min(nBase, nCur) < (strongSamples || 0)) { f.severity = "WARNING"; f.note = `Based on only ${Math.min(nBase, nCur)} requests in one run (need ${strongSamples} for a firm conclusion).`; }
  }
  if (noiseNote && !f.note) f.note = noiseNote;
  return f;
}

/**
 * Compare `cur` against `base`.
 * @param opts.rules    threshold overrides (see DEFAULT_RULES)
 * @param opts.history  earlier comparable runs (excluding base and cur) used to measure run-to-run noise
 */
function compare(base, cur, opts = {}) {
  const rules = mergeRules(opts.rules); const warnAt = rules.warnAtFraction;
  const comp = comparability(base, cur);
  const bs = base.summary || {}, cs = cur.summary || {};
  const findings = [];
  const hist = (opts.history || []).concat([base]);
  const noise = {
    p95: historyNoise(hist.concat([cur]), (r) => r.summary && r.summary.latency && r.summary.latency.p95, rules.noiseSigmas),
    p99: historyNoise(hist.concat([cur]), (r) => r.summary && r.summary.latency && r.summary.latency.p99, rules.noiseSigmas),
    rps: historyNoise(hist.concat([cur]), (r) => r.summary && r.summary.avgRps, rules.noiseSigmas),
  };
  const g = rules.global;
  const reqB = bs.totals ? bs.totals.requests : 0, reqC = cs.totals ? cs.totals.requests : 0;

  /* ---- headline metrics */
  const loadLabel = `${cur.config ? cur.config.maxUsers : "?"} users peak, ${cur.config ? cur.config.profile || "linear" : ""} profile`;
  const hb = bs.latency || {}, hc = cs.latency || {};
  findings.push(latencyFinding({ scope: "global", subject: "all requests", metric: "p95 latency", base: hb.p95, cur: hc.p95, nBase: reqB, nCur: reqC, minSamples: rules.minSamples.requests, limit: g.p95LatencyIncreasePercent, minAbs: rules.minAbsoluteMs.p95, warnAt, noisePct: noise.p95 && noise.p95.noisePct, load: loadLabel, intervalCheck: (d) => withinNoise(base, cur, "p95", d) }));
  findings.push(latencyFinding({ scope: "global", subject: "all requests", metric: "p99 latency", base: hb.p99, cur: hc.p99, nBase: reqB, nCur: reqC, minSamples: rules.minSamples.requests, limit: g.p99LatencyIncreasePercent, minAbs: rules.minAbsoluteMs.p99, warnAt, noisePct: noise.p99 && noise.p99.noisePct, load: loadLabel }));
  findings.push(latencyFinding({ scope: "global", subject: "all requests", metric: "median latency", base: hb.p50, cur: hc.p50, nBase: reqB, nCur: reqC, minSamples: rules.minSamples.requests, limit: g.p95LatencyIncreasePercent, minAbs: rules.minAbsoluteMs.p50, warnAt, load: loadLabel, intervalCheck: (d) => withinNoise(base, cur, "p50", d) }));
  // throughput
  {
    const bv = bs.avgRps, cv = cs.avgRps; const f = { scope: "global", subject: "all requests", metric: "throughput", unit: "req/s", base: bv, current: cv, delta: null, deltaPct: null, direction: "same", limitPct: g.throughputDecreasePercent, severity: "PASS", load: loadLabel, note: null };
    if (bv == null || cv == null || Math.min(reqB, reqC) < rules.minSamples.requests) { f.severity = "INCONCLUSIVE"; f.note = "Too few requests to compare throughput."; }
    else {
      f.delta = round(cv - bv); f.deltaPct = bv > 0 ? round(((cv - bv) / bv) * 100, 1) : null; f.direction = dir(cv - bv, false);
      let lim = g.throughputDecreasePercent; if (noise.rps && noise.rps.noisePct > lim) { lim = noise.rps.noisePct; f.limitPct = lim; f.note = `Limit raised to ${lim}% because comparable runs vary that much on their own.`; }
      if (f.direction === "worse") f.severity = grade({ pct: Math.abs(f.deltaPct), limit: lim, absDelta: Math.abs(cv - bv), minAbs: 0.5, warnAt });
      if (f.severity === "REGRESSION" && withinNoise(base, cur, "rps", cv - bv)) { f.severity = "WARNING"; f.note = "The difference is within the variation seen inside the runs themselves; repeat the run to confirm."; }
    }
    findings.push(f);
  }
  // error rate (percentage points)
  {
    const bv = bs.errorRatePct, cv = cs.errorRatePct; const lim = g.errorRateIncreasePercentagePoints;
    const f = { scope: "global", subject: "all requests", metric: "error rate", unit: "%", base: bv, current: cv, delta: null, deltaPct: null, direction: "same", limitPp: lim, severity: "PASS", load: loadLabel, note: null };
    if (bv == null || cv == null || Math.min(reqB, reqC) < rules.minSamples.requests) { f.severity = "INCONCLUSIVE"; f.note = "Too few requests to compare the error rate."; }
    else {
      f.delta = round(cv - bv); f.direction = dir(cv - bv, true);
      if (f.direction === "worse") f.severity = f.delta >= lim ? "REGRESSION" : f.delta >= lim * warnAt ? "WARNING" : "PASS";
      f.note = `${f.delta >= 0 ? "+" : ""}${f.delta} percentage points`;
    }
    findings.push(f);
  }
  // security: any leak is a regression regardless of the baseline
  {
    const cl = cs.security ? cs.security.leaks : null, bl = bs.security ? bs.security.leaks : null;
    if (cl != null) findings.push({ scope: "security", subject: "authorization checks", metric: "authorization leaks", unit: "", base: bl, current: cl, delta: bl != null ? cl - bl : null, deltaPct: null, direction: cl > (bl || 0) ? "worse" : "same",
      severity: cl > 0 ? "REGRESSION" : "PASS", load: loadLabel, note: cl > 0 ? "Requests succeeded where the server must refuse. This is a security defect, not a performance one." : `${cs.security.checks} checks, all refused correctly.` });
  }
  // absolute thresholds of the current run
  for (const t of cur.thresholds || []) if (!t.passed) findings.push({ scope: "threshold", subject: t.label, metric: "absolute threshold", unit: t.unit, base: t.limit, current: t.actual, delta: null, deltaPct: null, direction: "worse", severity: "REGRESSION", load: loadLabel, note: `Limit ${t.limit}${t.unit}, measured ${t.actual}${t.unit}.` });

  /* ---- by subject */
  const sub = (list, keyOf) => new Map((list || []).map((x) => [keyOf(x), x]));
  const lat = (scope, name, b, c, nb, nc, over, minS, loadLabel2, support) => {
    const lim = (over && over.p95LatencyIncreasePercent) || g.p95LatencyIncreasePercent;
    return latencyFinding({ scope, subject: name, metric: "p95 latency", base: b, cur: c, nBase: nb, nCur: nc, minSamples: minS, limit: lim, minAbs: rules.minAbsoluteMs.p95, warnAt, load: loadLabel2 || loadLabel, support, strongSamples: rules.strongSamples });
  };
  const eb = sub(bs.endpoints, (e) => e.key);
  for (const e of cs.endpoints || []) {
    const p = eb.get(e.key); if (!p) continue;
    const f = lat("endpoint", e.key, p.p95, e.p95, p.count, e.count, rules.endpoints[e.key], rules.minSamples.endpoint, null, { baseP50: p.p50, curP50: e.p50, baseAvg: p.avg, curAvg: e.avg });
    f.operation = e.operation || null;
    const erl = (rules.endpoints[e.key] && rules.endpoints[e.key].errorRateIncreasePercentagePoints) || g.errorRateIncreasePercentagePoints;
    findings.push(f);
    if (Math.min(p.count, e.count) >= rules.minSamples.endpoint && e.errorRatePct - p.errorRatePct >= erl) findings.push({ scope: "endpoint", subject: e.key, metric: "error rate", unit: "%", base: p.errorRatePct, current: e.errorRatePct, delta: round(e.errorRatePct - p.errorRatePct), deltaPct: null, direction: "worse", severity: "REGRESSION", load: loadLabel, note: null });
  }
  const jb = sub(bs.scenarios, (s) => s.key);
  for (const s of cs.scenarios || []) {
    const p = jb.get(s.key); if (!p) continue;
    const f = lat("journey", s.key, p.p95Ms, s.p95Ms, p.iterations, s.iterations, rules.journeys[s.key], rules.minSamples.journey, null, { baseP50: p.p50Ms, curP50: s.p50Ms, baseAvg: p.avgMs, curAvg: s.avgMs }); f.persona = s.persona; f.metric = "p95 journey duration";
    findings.push(f);
    if (Math.min(p.iterations, s.iterations) >= rules.minSamples.journey && p.completionPct != null && s.completionPct != null && p.completionPct - s.completionPct >= 5) findings.push({ scope: "journey", subject: s.key, persona: s.persona, metric: "journey completion", unit: "%", base: p.completionPct, current: s.completionPct, delta: round(s.completionPct - p.completionPct), deltaPct: null, direction: "worse", severity: p.completionPct - s.completionPct >= 10 ? "REGRESSION" : "WARNING", load: loadLabel, note: null });
  }
  const pb = sub(bs.personas, (p) => p.persona);
  for (const p of cs.personas || []) { const q = pb.get(p.persona); if (!q) continue; const f = lat("role", p.persona, q.p95, p.p95, q.requests, p.requests, null, rules.minSamples.role, null, { baseP50: q.p50, curP50: p.p50, baseAvg: q.avg, curAvg: p.avg }); findings.push(f); }
  const ob = sub(bs.operations, (o) => o.name);
  for (const o of cs.operations || []) { const q = ob.get(o.name); if (!q) continue; findings.push(lat("operation", o.name, q.p95, o.p95, q.count, o.count, null, rules.minSamples.operation, null, { baseP50: q.p50, curP50: o.p50, baseAvg: q.avg, curAvg: o.avg })); }
  // stages are comparable only when both runs have the same stage layout
  const stb = sub(bs.stages, (s) => s.name);
  const sameStages = (bs.stages || []).length === (cs.stages || []).length && (cs.stages || []).every((s) => stb.has(s.name));
  if (sameStages) for (const s of cs.stages || []) { const q = stb.get(s.name); findings.push(lat("stage", s.name, q.p95, s.p95, q.requests, s.requests, null, rules.minSamples.stage, `stage "${s.name}" (up to ${s.users} users)`, { baseP50: q.p50, curP50: s.p50, baseAvg: q.avg, curAvg: s.avg })); }

  /* ---- classification */
  let overall = "PASS"; let inconclusiveHeadline = false;
  for (const f of findings) {
    if (f.scope === "global" && f.severity === "INCONCLUSIVE" && f.metric !== "median latency") inconclusiveHeadline = true;
    overall = worst(overall, f.severity === "INCONCLUSIVE" ? "PASS" : f.severity);
  }
  const possible = findings.filter((f) => f.severity === "REGRESSION" || f.severity === "WARNING");
  let classification = overall;
  const reasons = [];
  if (!comp.comparable) {
    classification = "INCONCLUSIVE";
    reasons.push("The runs are not comparable: " + comp.blocking.map((b) => b.message).join(" "));
    if (possible.length) reasons.push(`${possible.length} difference(s) were observed but cannot be attributed to the application because the conditions differ.`);
  } else if (inconclusiveHeadline && overall === "PASS") {
    classification = "INCONCLUSIVE"; reasons.push("Too few requests in one or both runs to judge the headline metrics. Run a longer or busier test.");
  } else if (overall === "PASS") reasons.push("No metric moved beyond its limit.");
  else if (overall === "WARNING") reasons.push("Some metrics moved noticeably but not beyond their limits, or the change is within the runs' own variation.");
  else reasons.push("At least one metric moved beyond its limit under comparable conditions.");
  const limitations = [];
  if (!noise.p95) limitations.push("Run-to-run noise could not be measured: fewer than three comparable earlier runs exist. A single comparison cannot tell a real change from normal variation; per-second variation inside each run was used as a guard.");
  if (comp.warnings.length) limitations.push(`${comp.warnings.length} comparability warning(s) apply.`);
  limitations.push("Latency percentiles are exact over every request in each run, but they include warm-up and ramp periods, and the load generator shares the machine with the server for local runs.");

  const counts = { regression: 0, warning: 0, inconclusive: 0, pass: 0 };
  for (const f of findings) counts[f.severity.toLowerCase()]++;
  return {
    classification, reasons, comparability: comp, noise, limitations, rules,
    base: ref(base), current: ref(cur), counts,
    findings: findings.sort((a, b) => SEVERITY[b.severity] - SEVERITY[a.severity] || Math.abs(b.deltaPct || 0) - Math.abs(a.deltaPct || 0)),
    headline: findings.filter((f) => f.scope === "global" || f.scope === "security"),
  };
}
const ref = (r) => ({ id: r.id, name: r.name, createdAt: r.createdAt || r.startedAt || null, gitCommit: r.meta && r.meta.gitCommit || null, appVersion: r.meta && r.meta.appVersion || null, knownGood: !!r.knownGood });

/* ------------------------------------------------------------------------------------------------ trends */
const TREND_METRICS = [
  { key: "p95", label: "p95 latency (ms)", get: (r) => r.summary && r.summary.latency && r.summary.latency.p95, worseWhenUp: true, limit: "p95LatencyIncreasePercent" },
  { key: "p99", label: "p99 latency (ms)", get: (r) => r.summary && r.summary.latency && r.summary.latency.p99, worseWhenUp: true, limit: "p99LatencyIncreasePercent" },
  { key: "rps", label: "Throughput (req/s)", get: (r) => r.summary && r.summary.avgRps, worseWhenUp: false, limit: "throughputDecreasePercent" },
  { key: "err", label: "Error rate (%)", get: (r) => r.summary && r.summary.errorRatePct, worseWhenUp: true, limit: null },
];
/** Series over runs (oldest first) plus a verdict on gradual drift that no single pair of runs would reveal. */
function trends(runs, rules) {
  const rr = mergeRules(rules);
  return TREND_METRICS.map((m) => {
    const series = runs.map((r) => ({ id: r.id, name: r.name, at: r.createdAt || r.startedAt, gitCommit: r.meta && r.meta.gitCommit || null, value: m.get(r) })).filter((p) => p.value != null);
    let direction = "stable", note = "Not enough runs for a trend (need 3).", changePct = null, gradual = false;
    if (series.length >= 3) {
      const first = series[0].value, last = series[series.length - 1].value;
      changePct = first ? round(((last - first) / Math.abs(first)) * 100, 1) : null;
      const worseOrBetter = (last - first) > 0 === m.worseWhenUp ? "degrading" : "improving";
      const limit = m.limit ? rr.global[m.limit] : null;
      const big = m.key === "err" ? Math.abs(last - first) >= rr.global.errorRateIncreasePercentagePoints : changePct != null && Math.abs(changePct) >= (limit || 10);
      direction = big ? worseOrBetter : "stable";
      // gradual: each of the last 3 steps is worse than the one before, although no single step crossed its limit
      const tail = series.slice(-4).map((p) => p.value);
      const steps = tail.slice(1).map((v, i) => v - tail[i]);
      gradual = steps.length >= 2 && steps.every((d) => (d > 0) === m.worseWhenUp && d !== 0) && direction === "degrading";
      note = direction === "stable" ? "No meaningful drift across these runs." : `${direction} by ${Math.abs(changePct)}% from the first to the latest run${gradual ? "; every recent run was worse than the one before (gradual degradation)" : ""}.`;
    }
    return { key: m.key, label: m.label, worseWhenUp: m.worseWhenUp, series, direction, changePct, gradual, note };
  });
}

module.exports = { DEFAULT_RULES, SEVERITY, mergeRules, comparability, compare, trends, historyNoise, intervalOf };
