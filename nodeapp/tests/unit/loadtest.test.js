"use strict";
// Unit tests: configuration, load profile, statistics, randomness, scenario catalogue. No server, no network.
const test = require("node:test");
const assert = require("node:assert/strict");
const { validate, DEFAULTS, DEFAULT_LIMITS } = require("../../src/loadtest/config");
const { targetUsers, phases, phaseAt } = require("../../src/loadtest/profile");
const { Samples, percentile, percentileOf, evaluateThresholds } = require("../../src/loadtest/stats");
const { Rng } = require("../../src/loadtest/rng");
const { redact } = require("../../src/loadtest/metrics");
const { SCENARIOS, KEYS } = require("../../src/loadtest/scenarios");
const spec = require("../../src/openapi");

const good = (o = {}) => validate({ ...DEFAULTS, ...o });
const bad = (o) => validate({ ...DEFAULTS, ...o });
const fields = (r) => r.errors.map((e) => e.field);

test("config: defaults are valid", () => assert.equal(validate({}).ok, true));
test("config: rejects zero or negative users and duration", () => {
  assert.ok(fields(bad({ maxUsers: 0 })).includes("maxUsers"));
  assert.ok(fields(bad({ maxUsers: -5 })).includes("maxUsers"));
  assert.ok(fields(bad({ durationSec: -1 })).includes("durationSec"));
  assert.ok(fields(bad({ durationSec: 0 })).includes("durationSec"));
  assert.ok(fields(bad({ startUsers: 0 })).includes("startUsers"));
});
test("config: rejects a ramp longer than the total duration, and explains that ramps are included", () => {
  const r = bad({ durationSec: 60, rampUpSec: 50, rampDownSec: 20 });
  assert.equal(r.ok, false);
  assert.match(r.errors.find((e) => e.field === "rampUpSec").message, /INCLUDES/);
  assert.equal(bad({ durationSec: 60, rampUpSec: 30, rampDownSec: 30 }).ok, true, "exactly equal is allowed (no steady state)");
});
test("config: starting users cannot exceed maximum users", () => assert.ok(fields(bad({ startUsers: 20, maxUsers: 10 })).includes("startUsers")));
test("config: server safety limits are enforced", () => {
  assert.ok(fields(validate({ maxUsers: 500 }, { ...DEFAULT_LIMITS, maxUsers: 200 })).includes("maxUsers"));
  assert.ok(fields(validate({ durationSec: 9999 }, { ...DEFAULT_LIMITS, maxDurationSec: 1800 })).includes("durationSec"));
  assert.ok(fields(validate({ maxCreates: 99999 })).includes("maxCreates"));
});
test("config: non-numbers and fractions are not silently accepted", () => {
  assert.ok(fields(bad({ maxUsers: "abc" })).includes("maxUsers"));
  assert.ok(fields(bad({ maxUsers: 2.5 })).includes("maxUsers"));
  assert.equal(good({ maxUsers: "12" }).value.maxUsers, 12, "numeric strings from a form are converted");
});
test("config: target must be a configured environment; arbitrary URLs are rejected", () => {
  assert.ok(fields(validate({ target: "http://evil.example" })).includes("target"));
  assert.ok(fields(validate({ target: "staging" }, DEFAULT_LIMITS, ["local"])).includes("target"));
  assert.equal(validate({ target: "staging" }, DEFAULT_LIMITS, ["local", "staging"]).ok, true);
});
test("config: weights, think time, timeout, thresholds and seed are validated", () => {
  assert.ok(fields(bad({ personaWeights: { tenant: 0, manager: 0, technician: 0, vendor: 0, admin: 0 } })).includes("personaWeights"));
  assert.ok(fields(bad({ scenarioWeights: { "no.such": 1 } })).includes("scenarioWeights"));
  assert.ok(fields(bad({ thinkMinMs: 5000, thinkMaxMs: 100 })).includes("thinkMinMs"));
  assert.ok(fields(bad({ timeoutMs: 5 })).includes("timeoutMs"));
  assert.ok(fields(bad({ thresholds: { maxErrorRatePct: 150 } })).includes("thresholds.maxErrorRatePct"));
  assert.ok(fields(bad({ seed: -3 })).includes("seed"));
  assert.equal(good({ seed: "" }).value.seed, null);
});

const P = { startUsers: 5, maxUsers: 100, durationSec: 17 * 60, rampUpSec: 5 * 60, rampDownSec: 2 * 60 }; // the example in the brief: 5 -> 100, 5 min up, 10 min steady, 2 min down
test("profile: phases add up and the duration includes the ramps", () => {
  const p = phases(P); assert.equal(p.steadySec, 600); assert.equal(p.rampUpSec + p.steadySec + p.rampDownSec, P.durationSec);
});
test("profile: starts at the starting users, ramps linearly, holds, then falls to zero", () => {
  assert.equal(targetUsers(P, 0), 5);
  assert.equal(targetUsers(P, 150), Math.round(5 + 95 * 0.5));
  assert.equal(targetUsers(P, 300), 100);
  assert.equal(targetUsers(P, 600), 100);
  assert.equal(targetUsers(P, 900), 100);
  assert.equal(targetUsers(P, 960), 50);
  assert.equal(targetUsers(P, 1019), 1);
  assert.equal(targetUsers(P, 1020), 0);
  assert.equal(targetUsers(P, 5000), 0);
});
test("profile: never exceeds the maximum and is monotonic within each phase", () => {
  let prev = 0;
  for (let t = 0; t < P.rampUpSec; t++) { const u = targetUsers(P, t); assert.ok(u >= prev && u <= P.maxUsers); prev = u; }
  prev = P.maxUsers + 1;
  for (let t = P.rampUpSec + 600; t < P.durationSec; t++) { const u = targetUsers(P, t); assert.ok(u <= prev && u >= 0); prev = u; }
});
test("profile: zero-length ramps jump straight to the maximum", () => {
  const c = { startUsers: 1, maxUsers: 10, durationSec: 10, rampUpSec: 0, rampDownSec: 0 };
  assert.equal(targetUsers(c, 0), 10); assert.equal(targetUsers(c, 9), 10); assert.equal(targetUsers(c, 10), 0);
  assert.equal(phaseAt(P, 10), "ramp-up"); assert.equal(phaseAt(P, 400), "steady"); assert.equal(phaseAt(P, 1000), "ramp-down");
});

test("stats: percentiles use the nearest-rank method on the real samples", () => {
  const s = new Samples(); for (let i = 1; i <= 100; i++) s.add(i);
  const r = s.summary();
  assert.deepEqual([r.min, r.p50, r.p90, r.p95, r.p99, r.max, r.count], [1, 50, 90, 95, 99, 100, 100]);
  assert.equal(r.avg, 50.5);
});
test("stats: a skewed set is not summarised by its average", () => {
  const s = new Samples(); for (let i = 0; i < 98; i++) s.add(10); s.add(5000); s.add(6000);
  const r = s.summary(); assert.equal(r.p50, 10); assert.equal(r.p95, 10); assert.equal(r.p99, 5000); assert.equal(r.max, 6000); assert.ok(r.avg > 100);
});
test("stats: tiny and empty sets", () => {
  assert.equal(new Samples().summary().p95, null);
  const s = new Samples(); s.add(42); assert.equal(s.summary().p99, 42);
  assert.equal(percentileOf([3, 1, 2], 50), 2);
});
test("stats: thresholds judge the performance, not completion", () => {
  const summary = { errorRatePct: 2, avgRps: 40, latency: { p95: 900, p99: 1500 } };
  const r = evaluateThresholds({ maxErrorRatePct: 1, maxP95Ms: 1000, maxP99Ms: 1000, minRps: 50 }, summary);
  const by = Object.fromEntries(r.map((x) => [x.key, x.passed]));
  assert.deepEqual(by, { errorRate: false, p95: true, p99: false, rps: false });
  assert.deepEqual(evaluateThresholds({}, summary), []);
});

test("rng: the same seed gives the same sequence; different seeds differ", () => {
  const a = new Rng(7), b = new Rng(7), c = new Rng(8);
  const sa = Array.from({ length: 20 }, () => a.next()), sb = Array.from({ length: 20 }, () => b.next()), sc = Array.from({ length: 20 }, () => c.next());
  assert.deepEqual(sa, sb); assert.notDeepEqual(sa, sc);
});
test("rng: per-user streams are independent but reproducible", () => {
  const root = new Rng(99); const u1 = root.fork(1), u2 = root.fork(2);
  assert.notEqual(u1.next(), u2.next());
  assert.equal(new Rng(99).fork(1).next(), new Rng(99).fork(1).next());
});
test("rng: weighted selection follows the weights and ignores zero weights", () => {
  const r = new Rng(1); const items = [{ k: "a", w: 70 }, { k: "b", w: 30 }, { k: "z", w: 0 }]; const n = { a: 0, b: 0, z: 0 };
  for (let i = 0; i < 20000; i++) n[r.weighted(items, (x) => x.w).k]++;
  assert.equal(n.z, 0); assert.ok(Math.abs(n.a / 20000 - 0.7) < 0.02, `a share ${n.a / 20000}`);
  assert.equal(r.weighted([{ w: 0 }], (x) => x.w), undefined);
});
test("rng: shuffle keeps every element", () => assert.deepEqual(new Rng(3).shuffle([1, 2, 3, 4, 5]).sort(), [1, 2, 3, 4, 5]));

test("metrics: secrets are redacted from anything shown or stored", () => {
  const t = redact("Bearer abc.def.ghi failed for jane@example.com token=eyJhbGciOiJIUzI1NiJ9.eyJ1aWQiOjF9.abcdefghij password: hunter2 " + "a".repeat(40));
  for (const leak of ["jane@example.com", "hunter2", "eyJhbGci", "abc.def.ghi", "a".repeat(40)]) assert.ok(!t.includes(leak), leak);
});

test("scenarios: every scenario uses only endpoints that exist in the OpenAPI document", () => {
  for (const s of SCENARIOS) for (const e of s.endpoints) {
    const [method, p] = e.split(" "); assert.ok(spec.paths[p] && spec.paths[p][method.toLowerCase()], `${s.key} uses undocumented ${e}`);
  }
});
test("scenarios: keys are unique, personas valid, weights positive, read-only ones do not write", () => {
  assert.equal(new Set(KEYS).size, KEYS.length);
  for (const s of SCENARIOS) { assert.ok(["tenant", "manager", "technician", "vendor", "admin"].includes(s.persona)); assert.ok(s.weight > 0); if (!s.writes) assert.ok(!s.endpoints.some((e) => e.startsWith("POST") && !e.includes("/auth/")), s.key); }
});
