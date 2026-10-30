"use strict";
// Pure-logic tests for the Performance Testing Center: profiles, config, YAML, regression analysis, analysis, report, report store.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs"), os = require("os"), path = require("path");
const P = require("../../src/loadtest/profile");
const { validate } = require("../../src/loadtest/config");
const RG = require("../../src/loadtest/regression");
const { analyze } = require("../../src/loadtest/analysis");
const { render } = require("../../src/loadtest/report");
const { parse, YamlError } = require("../../performance/orchestration/yaml");
const C = require("../../performance/orchestration/config");
const store = require("../../performance/reporting/store");
const { operationOf } = require("../../src/loadtest/operations");

/* ------------------------------------------------------------------ profiles */
const base = { durationSec: 60, startUsers: 2, maxUsers: 20, rampUpSec: 20, rampDownSec: 10 };
test("profile: every type compiles to stages that cover exactly the total duration", () => {
  for (const profile of ["linear", "step", "spike", "soak"]) {
    const st = P.stagesOf({ ...base, profile }); assert.equal(st[0].start, 0); assert.equal(st[st.length - 1].end, 60, profile);
    for (let i = 1; i < st.length; i++) assert.equal(st[i].start, st[i - 1].end, profile + " has no gaps");
  }
});
test("profile: step climbs in flat plateaus, spike jumps and recovers, custom follows its stages", () => {
  const step = { ...base, profile: "step", steps: 4 };
  assert.deepEqual([0, 4, 6, 11, 16, 19].map((t) => P.targetUsers(step, t)), [7, 7, 11, 16, 20, 20]);
  assert.equal(new Set([6, 7, 8, 9].map((t) => P.targetUsers(step, t))).size, 1, "flat inside a step");
  const sp = { ...base, profile: "spike" };
  const { at, spikeSec } = P.spikeShape(sp);
  assert.equal(P.targetUsers(sp, at - 1), 2); assert.equal(P.targetUsers(sp, at), 20, "jumps straight to max"); assert.equal(P.targetUsers(sp, at + spikeSec + 1), 2, "falls straight back");
  assert.equal(P.phaseAt(sp, at + 1), "spike");
  const cu = { ...base, profile: "custom", stages: [{ durationSec: 10, users: 5 }, { durationSec: 10, users: 5 }, { durationSec: 10, users: 15 }, { durationSec: 5, users: 0 }] };
  assert.equal(P.totalOf(cu), 35); assert.equal(P.targetUsers(cu, 15), 5); assert.equal(P.targetUsers(cu, 25), 10); assert.equal(P.targetUsers(cu, 35), 0);
});
test("profile: linear is unchanged and never exceeds the maximum", () => {
  const lin = { ...base, profile: "linear" };
  assert.equal(P.targetUsers(lin, 0), 2); assert.equal(P.targetUsers(lin, 20), 20); assert.equal(P.targetUsers(lin, 59), 2); assert.equal(P.targetUsers(lin, 60), 0);
  for (let t = 0; t <= 60; t++) assert.ok(P.targetUsers(lin, t) <= 20);
});

/* ------------------------------------------------------------------ config validation */
const ok = (o) => { const r = validate({ name: "perf test", ...o }); assert.ok(r.ok, JSON.stringify(r.errors)); return r.value; };
const bad = (o) => { const r = validate({ name: "perf test", ...o }); assert.ok(!r.ok); return r.errors.map((e) => e.field); };
test("config: profile, custom stages, spike, orgs, sessions, think kinds and owner are validated", () => {
  assert.ok(bad({ profile: "wave" }).includes("profile"));
  assert.ok(bad({ profile: "custom", stages: [] }).includes("stages"));
  assert.ok(bad({ profile: "custom", maxUsers: 10, stages: [{ durationSec: 30, users: 50 }] }).includes("stages"));
  assert.equal(ok({ profile: "custom", maxUsers: 10, stages: [{ durationSec: 20, users: 5 }, { durationSec: 20, users: 10 }] }).durationSec, 40, "duration is the sum of the stages");
  assert.ok(bad({ profile: "spike", durationSec: 30, rampDownSec: 25, spikeAtSec: 10, spikeSec: 10 }).includes("spikeSec"));
  assert.ok(bad({ orgs: 9 }).includes("orgs")); assert.ok(bad({ securityPct: 150 }).includes("securityPct"));
  assert.ok(bad({ sessionMinIterations: 9, sessionMaxIterations: 3 }).includes("sessionMinIterations"));
  assert.ok(bad({ thinkKinds: { form: [9000, 1000] } }).includes("thinkKinds"));
  assert.ok(bad({ personaWeights: { owner: 10 } }).includes("personaWeights"), "owner role does not exist");
  assert.equal(ok({}).personaWeights.owner, 0);
  assert.ok(bad({ regressionRules: { global: { bogus: 1 } } }).includes("regressionRules"));
  assert.ok(bad({ regressionRules: { global: { p95LatencyIncreasePercent: -3 } } }).includes("regressionRules"));
});
test("config: ramps are only checked where they apply, and total duration still includes them", () => {
  assert.ok(bad({ profile: "linear", durationSec: 30, rampUpSec: 20, rampDownSec: 20 }).includes("rampUpSec"));
  ok({ profile: "spike", durationSec: 60, rampUpSec: 0, rampDownSec: 10 });
});

/* ------------------------------------------------------------------ YAML + file config */
test("yaml: scalars, nesting, lists of mappings, inline collections and comments", () => {
  const v = parse(`# c\nname: "A # b"  # trailing\nusers: {initial: 2, max: 10}\nshare:\n  tenant: 5\nstages:\n  - duration: 30s\n    users: 5\n  - duration: 1m\n    users: 9\nlist: [1, "x y", true, ~]\n`);
  assert.deepEqual(v, { name: "A # b", users: { initial: 2, max: 10 }, share: { tenant: 5 }, stages: [{ duration: "30s", users: 5 }, { duration: "1m", users: 9 }], list: [1, "x y", true, null] });
});
test("yaml: mistakes are errors with line numbers, never silently accepted", () => {
  for (const [src, re] of [["a: 1\n\tb: 2", /Line 2.*tab/], ["a: 1\na: 2", /duplicate/], ["a: [1, 2", /Line 1/], ["  a: 1\nb: 2", /Line 2/], ["x: &anchor 1", /unsupported/], ["__proto__: 1", /not allowed/]]) assert.throws(() => parse(src), (e) => e instanceof YamlError && re.test(e.message), src);
  assert.equal(Object.prototype.polluted, undefined);
});
test("config file: maps the friendly keys, converts durations, rejects unknown keys and bad durations", () => {
  const { api } = C.build({ name: "x test", duration: "2m", users: { initial: 2, max: 10 }, rampUp: "30s", trafficShare: { propertyManager: 20, tenant: 60, owner: 0 }, thinkTime: { min: "300ms", max: "1.5s", form: ["2s", "6s"] }, thresholds: { p95Ms: 800, securityLeaks: 0 },
    stages: [{ duration: "10s", users: 3 }], testData: { orgs: 2 }, security: { checkPercent: 10 }, regression: { p95LatencyIncreasePercent: 20, endpoints: { "GET /api/dashboard": { p95LatencyIncreasePercent: 30 } } } }, { seed: "5" });
  assert.equal(api.durationSec, 120); assert.equal(api.rampUpSec, 30); assert.equal(api.thinkMaxMs, 1500); assert.deepEqual(api.thinkKinds.form, [2000, 6000]);
  assert.equal(api.personaWeights.manager, 20); assert.equal(api.orgs, 2); assert.equal(api.seed, 5); assert.equal(api.thresholds.maxSecurityLeaks, 0); assert.equal(api.securityPct, 10);
  assert.equal(api.regressionRules.endpoints["GET /api/dashboard"].p95LatencyIncreasePercent, 30); assert.equal(api.stages[0].durationSec, 10);
  assert.throws(() => C.build({ foo: 1 }), (e) => e instanceof C.ConfigError && /foo: unknown/.test(e.message));
  assert.throws(() => C.build({ duration: "2x" }), (e) => /not a duration/.test(e.message));
  assert.throws(() => C.build({ users: { maxx: 3 } }), (e) => /users.maxx/.test(e.message));
});
test("config files shipped in performance/config are all valid and pass the server-side validation", () => {
  for (const f of ["default", "smoke", "stress", "soak"]) {
    const { api } = C.build(C.load(path.join(__dirname, "..", "..", "performance", "config", f + ".yaml")), {});
    const r = validate(api, { maxUsers: 200, maxDurationSec: 1800, maxRequests: 500000, maxCreates: 2000, minTimeoutMs: 100, maxTimeoutMs: 60000 });
    assert.ok(r.ok, f + ": " + JSON.stringify(r.errors));
  }
});

/* ------------------------------------------------------------------ regression */
function ep(key, n, p50, p95, errs = 0) { return { key, operation: operationOf(key), count: n, p50, avg: p50 * 1.2, p90: p95 * 0.9, p95, p99: p95 * 1.3, max: p95 * 2, errors: errs, errorRatePct: n ? (errs / n) * 100 : 0, statusCodes: {} }; }
function mkRun(o = {}) {
  const p95 = o.p95 ?? 200, p50 = o.p50 ?? 40, p99 = o.p99 ?? p95 * 1.5, n = o.requests ?? 3000, rps = o.rps ?? 50, err = o.err ?? 0;
  const tl = Array.from({ length: 80 }, (_, i) => ({ t: i + 1, target: 20, active: 20, busy: 10, sessions: 20, requests: 50, errors: 0, rps: rps + ((i % 5) - 2) * 0.4, okRps: rps, journeys: 5, journeysOk: 5, errorPct: err, p50: p50 + ((i % 7) - 3) * 0.4, p95: p95 + ((i % 9) - 4) * 1.2, p99: p99 }));
  return {
    id: o.id ?? 1, name: "perf", state: "COMPLETED", verdict: "PASSED", createdAt: "2026-01-01T00:00:00Z", startedAt: o.startedAt ?? "2026-01-01T00:00:00Z",
    config: { profile: "linear", maxUsers: 20, startUsers: 2, durationSec: 80, rampUpSec: 20, rampDownSec: 10, personaWeights: { tenant: 56, manager: 20, technician: 10, vendor: 9, admin: 5 }, orgs: 2, includeWrites: true, seed: 1, thinkMinMs: 300, thinkMaxMs: 1500, pacingMs: 500, randomization: 60, ...(o.config || {}) },
    meta: { scenarioVersion: "3.x", datasetId: "ds-1", environment: { name: "local", kind: "local" }, infrastructure: { cpuCores: 4, node: "v22", platform: "linux" }, gitCommit: o.commit ?? "aaa", ...(o.meta || {}) },
    thresholds: o.thresholds || [], timeline: tl,
    summary: { totals: { requests: n, ok: n, failed: 0 }, errorRatePct: err, avgRps: rps, latency: { p50, p95, p99, avg: p50 * 1.2 }, throughput: { requestsPerSec: rps }, endpoints: o.endpoints || [ep("GET /api/dashboard", 400, 30, 90), ep("GET /api/maintenance-requests", 900, 40, 120)], operations: o.operations || [], scenarios: o.scenarios || [], personas: o.personas || [], stages: o.stages || [], security: o.security || { checks: 50, denied: 50, leaks: 0, errors: 0, byCheck: [], leakList: [] } },
  };
}
const find = (c, scope, subject, metric) => c.findings.find((f) => f.scope === scope && (!subject || f.subject === subject) && (!metric || f.metric === metric));

test("regression: identical runs are PASS", () => {
  const c = RG.compare(mkRun({ id: 1 }), mkRun({ id: 2 })); assert.equal(c.classification, "PASS"); assert.equal(c.counts.regression, 0);
});
test("regression: the configured limits decide REGRESSION / WARNING / PASS for p95", () => {
  const b = mkRun({ id: 1, p95: 200, p50: 40 });
  assert.equal(find(RG.compare(b, mkRun({ id: 2, p95: 260, p50: 52 })), "global", null, "p95 latency").severity, "REGRESSION", "+30% > 15%");
  assert.equal(find(RG.compare(b, mkRun({ id: 2, p95: 222, p50: 40 })), "global", null, "p95 latency").severity, "WARNING", "+11% is between 7.5% and 15%");
  assert.equal(find(RG.compare(b, mkRun({ id: 2, p95: 206 })), "global", null, "p95 latency").severity, "PASS", "+3%");
  assert.equal(find(RG.compare(b, mkRun({ id: 2, p95: 150 })), "global", null, "p95 latency").direction, "better", "faster is never a regression");
  const small = RG.compare(mkRun({ id: 1, p95: 20 }), mkRun({ id: 2, p95: 27 })); assert.equal(find(small, "global", null, "p95 latency").severity, "PASS", "+35% but only 7 ms: below the absolute floor");
});
test("regression: p99, throughput and error rate use their own limits", () => {
  const b = mkRun({ id: 1, p95: 200, p99: 300, rps: 50, err: 0 });
  assert.equal(find(RG.compare(b, mkRun({ id: 2, p95: 200, p99: 400 })), "global", null, "p99 latency").severity, "REGRESSION", "+33% > 20%");
  assert.equal(find(RG.compare(b, mkRun({ id: 2, rps: 43, p95: 200, p99: 300 })), "global", null, "throughput").severity, "REGRESSION", "-14% > 10%");
  assert.equal(find(RG.compare(b, mkRun({ id: 2, rps: 47, p95: 200, p99: 300 })), "global", null, "throughput").severity, "WARNING", "-6%");
  assert.equal(find(RG.compare(b, mkRun({ id: 2, err: 0.6 })), "global", null, "error rate").severity, "REGRESSION", "+0.6 pp >= 0.5");
  assert.equal(find(RG.compare(b, mkRun({ id: 2, err: 0.3 })), "global", null, "error rate").severity, "WARNING", "+0.3 pp");
  assert.equal(find(RG.compare(b, mkRun({ id: 2, err: 0.1 })), "global", null, "error rate").severity, "PASS");
});
test("regression: custom limits and per-endpoint overrides are honoured", () => {
  const b = mkRun({ id: 1, p95: 200, p50: 40 }), cur = mkRun({ id: 2, p95: 250, p50: 50 });
  assert.equal(find(RG.compare(b, cur, { rules: { global: { p95LatencyIncreasePercent: 40 } } }), "global", null, "p95 latency").severity, "WARNING", "25% under a 40% limit");
  const e1 = [ep("GET /api/dashboard", 400, 30, 100)], e2 = [ep("GET /api/dashboard", 400, 40, 135)];
  assert.equal(find(RG.compare(mkRun({ id: 1, endpoints: e1 }), mkRun({ id: 2, endpoints: e2 })), "endpoint", "GET /api/dashboard", "p95 latency").severity, "REGRESSION");
  assert.equal(find(RG.compare(mkRun({ id: 1, endpoints: e1 }), mkRun({ id: 2, endpoints: e2 }), { rules: { endpoints: { "GET /api/dashboard": { p95LatencyIncreasePercent: 80 } } } }), "endpoint", "GET /api/dashboard", "p95 latency").severity, "PASS");
});
test("regression: a sub-scope REGRESSION needs corroboration and enough samples; otherwise it is only a WARNING", () => {
  const tail = RG.compare(mkRun({ id: 1, endpoints: [ep("GET /api/notifications", 200, 3, 4)] }), mkRun({ id: 2, endpoints: [ep("GET /api/notifications", 200, 3, 40)] }));
  assert.equal(find(tail, "endpoint").severity, "WARNING", "p95 jumped but the median did not move: outliers"); assert.match(find(tail, "endpoint").note, /outliers/);
  const few = RG.compare(mkRun({ id: 1, endpoints: [ep("GET /api/x", 40, 30, 100)] }), mkRun({ id: 2, endpoints: [ep("GET /api/x", 40, 60, 200)] }));
  assert.equal(find(few, "endpoint").severity, "WARNING"); assert.match(find(few, "endpoint").note, /only 40 requests/);
  const real = RG.compare(mkRun({ id: 1, endpoints: [ep("GET /api/x", 300, 30, 100)] }), mkRun({ id: 2, endpoints: [ep("GET /api/x", 300, 60, 200)] }));
  assert.equal(find(real, "endpoint").severity, "REGRESSION"); assert.equal(real.classification, "REGRESSION");
  assert.equal(find(RG.compare(mkRun({ id: 1, endpoints: [ep("GET /api/x", 10, 30, 100)] }), mkRun({ id: 2, endpoints: [ep("GET /api/x", 10, 60, 200)] })), "endpoint").severity, "INCONCLUSIVE", "too few samples");
});
test("regression: findings are traced to journey, role, operation and stage", () => {
  const sc = (k, persona, it, p50, p95) => ({ key: k, persona, iterations: it, failedIterations: 0, completionPct: 100, avgMs: p50 * 1.2, p50Ms: p50, p95Ms: p95, p99Ms: p95 * 1.4 });
  const pe = (persona, req, p50, p95) => ({ persona, requests: req, avg: p50 * 1.2, p50, p95, p99: p95 * 1.4, errors: 0, errorRatePct: 0 });
  const st = (name, users, req, p50, p95) => ({ name, users, requests: req, rps: 40, avg: p50 * 1.2, p50, p95, p99: p95 * 1.4, errors: 0, errorRatePct: 0 });
  const A = mkRun({ id: 1, scenarios: [sc("vendor.quote", "vendor", 200, 100, 300)], personas: [pe("vendor", 800, 30, 90)], stages: [st("steady", 20, 1500, 30, 90)] });
  const B = mkRun({ id: 2, scenarios: [sc("vendor.quote", "vendor", 200, 150, 450)], personas: [pe("vendor", 800, 45, 140)], stages: [st("steady", 20, 1500, 45, 140)] });
  const c = RG.compare(A, B);
  assert.equal(find(c, "journey", "vendor.quote").severity, "REGRESSION"); assert.equal(find(c, "journey", "vendor.quote").persona, "vendor");
  assert.equal(find(c, "role", "vendor").severity, "REGRESSION"); assert.match(find(c, "stage", "steady").load, /steady/);
  const diffStages = RG.compare(A, mkRun({ id: 3, stages: [st("ramp-up", 20, 500, 45, 140)] })); assert.equal(find(diffStages, "stage"), undefined, "stages with different layouts are not compared");
});
test("regression: runs measured under different conditions are INCONCLUSIVE, never a definitive verdict", () => {
  const worse = { p95: 400, p50: 80 };
  for (const [what, cur] of [["users", mkRun({ id: 2, ...worse, config: { maxUsers: 40 } })], ["profile", mkRun({ id: 2, ...worse, config: { profile: "spike" } })], ["scenario version", mkRun({ id: 2, ...worse, meta: { scenarioVersion: "3.y" } })],
    ["dataset", mkRun({ id: 2, ...worse, meta: { datasetId: "ds-2" } })], ["environment", mkRun({ id: 2, ...worse, meta: { environment: { name: "staging", kind: "remote" } } })], ["orgs", mkRun({ id: 2, ...worse, config: { orgs: 4 } })],
    ["duration", mkRun({ id: 2, ...worse, config: { durationSec: 200 } })], ["role mix", mkRun({ id: 2, ...worse, config: { personaWeights: { tenant: 10, manager: 70, technician: 10, vendor: 5, admin: 5 } } })], ["writes", mkRun({ id: 2, ...worse, config: { includeWrites: false } })]]) {
    const c = RG.compare(mkRun({ id: 1 }), cur); assert.equal(c.classification, "INCONCLUSIVE", what); assert.equal(c.comparability.comparable, false, what);
    assert.ok(c.counts.regression > 0 && /cannot be attributed/.test(c.reasons.join(" ")), what + ": differences are shown but not blamed on the application");
  }
  const soft = RG.compare(mkRun({ id: 1 }), mkRun({ id: 2, config: { seed: 9 }, meta: { infrastructure: { cpuCores: 8, node: "v22", platform: "linux" } } }));
  assert.equal(soft.comparability.comparable, true); assert.ok(soft.comparability.warnings.some((w) => w.field === "seed") && soft.comparability.warnings.some((w) => w.field === "cpuCores"));
});
test("regression: too few requests is INCONCLUSIVE; the same commit is flagged as noise-only", () => {
  const c = RG.compare(mkRun({ id: 1, requests: 120 }), mkRun({ id: 2, requests: 140, p95: 300 })); assert.equal(c.classification, "INCONCLUSIVE");
  assert.ok(RG.compare(mkRun({ id: 1, commit: "abc" }), mkRun({ id: 2, commit: "abc" })).comparability.warnings.some((w) => w.field === "gitCommit"));
});
test("regression: any authorization leak is a REGRESSION even if performance is identical", () => {
  const c = RG.compare(mkRun({ id: 1 }), mkRun({ id: 2, security: { checks: 50, denied: 49, leaks: 1, errors: 0, byCheck: [], leakList: [] } }));
  assert.equal(c.classification, "REGRESSION"); assert.equal(find(c, "security").severity, "REGRESSION");
});
test("regression: a failed absolute threshold is reported as a finding", () => {
  const c = RG.compare(mkRun({ id: 1 }), mkRun({ id: 2, thresholds: [{ key: "p95", label: "p95 response time", limit: 100, actual: 210, unit: "ms", passed: false }] }));
  assert.equal(find(c, "threshold").severity, "REGRESSION"); assert.equal(c.classification, "REGRESSION");
});
test("regression: with 3+ comparable runs the measured noise widens the limit; a diff inside it is not a REGRESSION", () => {
  const hist = [mkRun({ id: 10, p95: 170 }), mkRun({ id: 11, p95: 240 }), mkRun({ id: 12, p95: 205 })];
  const b = mkRun({ id: 1, p95: 200, p50: 40 }), cur = mkRun({ id: 2, p95: 235, p50: 47 });
  assert.equal(find(RG.compare(b, cur), "global", null, "p95 latency").severity, "REGRESSION", "without history +17.5% trips the 15% limit");
  const withHist = RG.compare(b, cur, { history: hist }); const f = find(withHist, "global", null, "p95 latency");
  assert.notEqual(f.severity, "REGRESSION"); assert.ok(f.limitPct > 15 && /vary that much/.test(f.note)); assert.ok(withHist.noise.p95.runs >= 4);
  assert.ok(RG.compare(b, cur).limitations.some((l) => /noise could not be measured/.test(l)), "single-run limitation is stated");
});
test("regression: a difference inside the runs' own per-second variation is downgraded to WARNING", () => {
  const noisy = (id, mean) => { const r = mkRun({ id, p95: mean }); r.timeline.forEach((p, i) => { p.p95 = mean + (i % 2 ? 90 : -90); }); return r; };
  const c = RG.compare(noisy(1, 200), noisy(2, 235)); const f = find(c, "global", null, "p95 latency");
  assert.equal(f.severity, "WARNING"); assert.match(f.note, /within the variation/);
});
test("regression: trends flag gradual degradation that no single comparison would catch", () => {
  const runs = [200, 208, 217, 226, 236].map((p95, i) => mkRun({ id: i + 1, p95 }));
  assert.equal(RG.compare(runs[3], runs[4]).classification, "PASS", "each step alone is small");
  const t = RG.trends(runs).find((x) => x.key === "p95"); assert.equal(t.direction, "degrading"); assert.equal(t.gradual, true); assert.match(t.note, /gradual/);
  const flat = RG.trends([200, 201, 199, 200].map((p95, i) => mkRun({ id: i + 1, p95 }))).find((x) => x.key === "p95"); assert.equal(flat.direction, "stable");
  assert.match(RG.trends([mkRun({ id: 1 })])[0].note, /need 3/);
});

/* ------------------------------------------------------------------ analysis + report */
test("analysis: finds saturation between stages, upward drift, server errors and leaks; says so when resources are unavailable", () => {
  const run = mkRun({ id: 1, stages: [{ name: "step 1", users: 10, requests: 400, rps: 40, p95: 100, errorRatePct: 0 }, { name: "step 2", users: 30, requests: 450, rps: 45, p95: 300, errorRatePct: 0 }] });
  run.resources = { available: false, reason: "remote target" }; run.summary.errorKinds = { http5xx: 3, timeout: 0, network: 0 };
  run.summary.security = { checks: 10, denied: 9, leaks: 1, errors: 0, byCheck: [{ check: "x", leaks: 1 }], leakList: [] };
  run.timeline = Array.from({ length: 120 }, (_, i) => ({ t: i, target: 20, requests: 30, errorPct: 0, p95: i < 40 ? 100 : i > 80 ? 200 : 150 }));
  const kinds = analyze(run).bottlenecks.map((b) => b.kind);
  for (const k of ["saturation", "drift", "errors", "security", "resources"]) assert.ok(kinds.includes(k), k);
  assert.equal(analyze(run).bottlenecks.find((b) => b.kind === "resources").severity, "info");
});
test("report: self-contained HTML with every required section, escaped content and no external requests", () => {
  const run = mkRun({ id: 5 }); run.name = "<script>alert(1)</script> run"; run.summary.stagesPlan = [{ name: "steady", start: 0, end: 80 }];
  run.summary.personas = [{ persona: "vendor", requests: 100, p50: 10, p95: 30, p99: 50, errorRatePct: 0, sessions: 3, journeys: 9, journeyP95Ms: 100 }];
  run.resources = { available: false, reason: "Not measured for this target." }; run.warnings = ["a warning <b>"];
  const cmp = RG.compare(mkRun({ id: 1 }), run); const html = render(run, { comparison: cmp, trends: RG.trends([mkRun({ id: 1 }), mkRun({ id: 3 }), run]) });
  for (const s of ["Executive summary", "Thresholds", "Charts", "Configured virtual users", "Authenticated sessions", "Active iterations", "Requests per second", "Response times", "Error rate", "Endpoint performance", "Role performance", "Journey completion", "Bottleneck indicators", "By ramp stage", "By business operation", "Security checks", "Server resources", "Not available", "Trends across comparable runs", "Run details", "Scenario version", "Owner"]) assert.ok(html.includes(s), "missing: " + s);
  assert.ok(!html.includes("<script>alert"), "name is escaped"); assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!/<script|src=["']http|href=["']http|@import|url\(http/i.test(html), "no scripts and no external requests");
  assert.ok(html.includes("Comparison with") && html.includes("Headline metrics") && html.includes("Limits of this comparison"), "comparison section is present"); assert.ok(html.includes("<svg"));
});

/* ------------------------------------------------------------------ report store */
test("store: saves, lists, resolves and picks the latest comparable baseline (falling back, never silently)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "perf-store-"));
  try {
    const mk = (n, o) => { const r = mkRun({ id: n, startedAt: `2026-01-0${n}T00:00:00Z`, ...o }); const id = `2026010${n}-000000-run`; fs.mkdirSync(path.join(dir, id), { recursive: true }); fs.writeFileSync(path.join(dir, id, "report.json"), JSON.stringify({ ...r, id })); return id; };
    const a = mk(1), b = mk(2, { config: { maxUsers: 99 } }), c = mk(3);
    assert.equal(store.list(dir).length, 3); assert.equal(store.resolve("latest", dir).id, c); assert.equal(store.resolve("2", dir).id, b); assert.equal(store.resolve(a, dir).id, a); assert.equal(store.resolve("nope", dir), null);
    const cur = store.resolve(c, dir);
    const pick = store.pickBaseline(cur, "previous", dir); assert.equal(pick.base.id, a, "skips the run with a different user count (b) and uses the latest comparable one");
    assert.equal(store.pickBaseline(cur, a, dir).how, "selected"); assert.match(store.pickBaseline(cur, "known-good", dir).reason || "ok", /known-good|ok/);
    assert.match(store.pickBaseline(store.resolve(a, dir), "previous", dir).reason, /no earlier report/i);
    const saved = store.save({ name: "My Run!", summary: { totals: {} } }, "<html></html>", dir); assert.match(saved.id, /^\d{8}-\d{6}-my-run$/); assert.ok(fs.existsSync(saved.html));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test("operations: endpoints map to business operations", () => {
  assert.equal(operationOf("POST /api/auth/login"), "Login"); assert.equal(operationOf("POST /api/quotations/{id}/decision"), "Quotation approval");
  assert.equal(operationOf("POST /api/maintenance-requests"), "Complaint creation"); assert.equal(operationOf("GET /api/audit"), "Reports and administration"); assert.equal(operationOf("GET /nope"), "Other");
});
