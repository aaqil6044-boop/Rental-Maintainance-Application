"use strict";
// Engine behaviour added by the Performance Testing Center, against the local mock (never the real application).
const test = require("node:test");
const assert = require("node:assert/strict");
const { Engine } = require("../../src/loadtest/engine");
const { validate } = require("../../src/loadtest/config");
const { startMock, accountsFull } = require("./mock");

const cfg = (o = {}) => {
  const r = validate({ name: "perf engine", durationSec: 6, startUsers: 2, maxUsers: 6, rampUpSec: 1, rampDownSec: 1, thinkMinMs: 5, thinkMaxMs: 20, pacingMs: 5, timeoutMs: 1500, seed: 7, optionalPct: 90, ...o });
  assert.ok(r.ok, JSON.stringify(r.errors)); return { ...r.value, durationSec: o.durationSec || 6 };
};
const mk = (mock, c, extra = {}) => new Engine({ config: c, baseUrl: mock.url, accounts: accountsFull(), tag: "[LOADTEST r1]", seed: c.seed, hardMaxUsers: 50, maxRequests: 200000, ...extra });
const run = async (mockOpts, cfgOpts, extra) => { const mock = await startMock({ delayMs: 2, ...mockOpts }); try { const e = mk(mock, cfg(cfgOpts), extra); const out = await e.run(); return { out, s: out.snapshot, mock, e }; } finally { await mock.close(); } };

test("all five user types generate traffic, each with its own metrics; owner never appears", async () => {
  const { s } = await run({ enforce: true }, { durationSec: 8, startUsers: 5, maxUsers: 10, rampUpSec: 0, rampDownSec: 1, personaWeights: { tenant: 30, manager: 20, technician: 15, vendor: 20, admin: 15 } });
  const got = s.personas.map((p) => p.persona).sort();
  assert.deepEqual(got, ["admin", "manager", "technician", "tenant", "vendor"]);
  assert.ok(!s.personas.some((p) => p.persona === "owner"));
  assert.equal(s.personas.reduce((a, p) => a + p.requests, 0), s.totals.requests, "per-role requests add up to the total");
  for (const p of s.personas) { assert.ok(p.sessions > 0 && p.p95 != null, p.persona); }
  assert.ok(s.scenarios.some((x) => x.key.startsWith("vendor.")) && s.scenarios.some((x) => x.key.startsWith("admin.")));
});

test("a session signs in once, runs a bounded number of journeys, then leaves; new users arrive in their place", async () => {
  const { s, mock, e } = await run({ enforce: true }, { durationSec: 8, startUsers: 3, maxUsers: 3, rampUpSec: 0, rampDownSec: 0, sessionMinIterations: 2, sessionMaxIterations: 3, securityPct: 0 });
  assert.ok(s.totals.sessions > 3 * 1.5, `many more sessions than concurrent users (${s.totals.sessions})`);
  assert.equal(mock.logins(), accountsFull().length + s.totals.sessions, "one sign-in per session plus the setup sign-ins - never one per request");
  assert.ok(s.totals.iterations / s.totals.sessions <= 3.01 && s.totals.iterations / s.totals.sessions >= 1, "journeys per session respect the configured range");
  assert.ok(s.peakActiveUsers <= 3 + 0, "concurrency never exceeds the configured users");
  void e;
});

test("an expired token is refreshed with one sign-in and the journey carries on", async () => {
  const { s } = await run({ enforce: true, expireFirstToken: true }, { durationSec: 6, startUsers: 2, maxUsers: 2, rampUpSec: 0, rampDownSec: 0, securityPct: 0 });
  assert.ok(s.totals.reauths >= 1, "re-authenticated"); assert.ok(s.totals.iterations > 2, "work continued after the refresh");
});

test("negative authorization checks: correct refusals are PASS and do not touch the error rate or latency", async () => {
  const { s } = await run({ enforce: true }, { durationSec: 8, startUsers: 6, maxUsers: 6, rampUpSec: 0, rampDownSec: 0, securityPct: 100, personaWeights: { tenant: 30, manager: 20, technician: 15, vendor: 20, admin: 15 } });
  const sec = s.security;
  assert.ok(sec.checks >= 20, `checks ran (${sec.checks})`); assert.equal(sec.leaks, 0); assert.equal(sec.denied, sec.checks - sec.errors);
  assert.equal(s.errorRatePct, 0, "refusals are not application errors"); assert.equal(s.totals.failed, 0);
  const names = sec.byCheck.map((c) => c.check);
  for (const n of ["unauthenticated request is refused", "manager-only page refused to other roles", "cannot read another organization's request"]) assert.ok(names.includes(n), n);
  assert.ok(sec.latency.count === sec.checks, "probe latency is tracked on its own");
  assert.ok(!s.endpoints.some((e) => /\[probe\]/.test(e.key)));
});

test("a server that lets forbidden requests through is reported as authorization leaks and fails the error accounting", async () => {
  const { s } = await run({ enforce: true, leak: true }, { durationSec: 6, startUsers: 4, maxUsers: 4, rampUpSec: 0, rampDownSec: 0, securityPct: 100 });
  assert.ok(s.security.leaks > 0, "leaks detected"); assert.ok(s.security.leakList.length > 0 && s.security.leakList[0].check);
  assert.ok(s.totals.failed >= s.security.leaks, "leaks count as failures"); assert.ok(s.recentErrors.some((e) => /Authorization leak/.test(e.message)));
});

test("a spike profile jumps to the maximum and falls back; stage metrics are kept per stage", async () => {
  const c = cfg({ profile: "spike", durationSec: 10, startUsers: 1, maxUsers: 8, rampUpSec: 0, rampDownSec: 2, spikeAtSec: 3, spikeSec: 3, securityPct: 0 });
  const mock = await startMock({ delayMs: 2, enforce: true });
  try {
    const s = (await mk(mock, c).run()).snapshot; const tl = s.timeline;
    const at = (t) => tl.find((p) => p.t === t);
    assert.equal(at(2).target, 1); assert.equal(at(4).target, 8); assert.equal(at(7).target, 1);
    assert.ok(Math.max(...tl.filter((p) => p.t >= 4 && p.t <= 6).map((p) => p.active)) >= 7, "users really jumped");
    assert.deepEqual(s.stages.map((x) => x.name).sort(), ["baseline", "ramp-down", "recovery", "spike"]);
    const spike = s.stages.find((x) => x.name === "spike"); assert.ok(spike.requests > 0 && spike.users === 8);
    assert.equal(s.stages.reduce((a, x) => a + x.requests, 0), s.totals.requests, "stage requests add up to the total");
  } finally { await mock.close(); }
});

test("a step profile holds each plateau", async () => {
  const c = cfg({ profile: "step", steps: 3, durationSec: 9, startUsers: 1, maxUsers: 6, rampUpSec: 6, rampDownSec: 1, securityPct: 0 });
  const mock = await startMock({ delayMs: 2 });
  try {
    const s = (await mk(mock, c).run()).snapshot; const t = s.timeline;
    assert.deepEqual([...new Set(t.slice(0, 6).map((p) => p.target))], [3, 4, 6].map((v, i) => [Math.round(1 + (5 * (i + 1)) / 3)][0]));
    assert.ok(s.stages.some((x) => x.name === "step 1") && s.stages.some((x) => x.name === "step 3"));
  } finally { await mock.close(); }
});

test("a user type with no accounts on the target is reported, not silently dropped", async () => {
  const mock = await startMock({ delayMs: 2 });
  try {
    const only = accountsFull().filter((a) => a.persona === "tenant" || a.persona === "manager");
    const e = new Engine({ config: cfg({ securityPct: 0 }), baseUrl: mock.url, accounts: only, tag: "x", seed: 1, hardMaxUsers: 20, maxRequests: 100000 });
    const s = (await e.run()).snapshot; assert.deepEqual(s.missingPersonas.sort(), ["admin", "technician", "vendor"]);
    assert.ok(s.personas.every((p) => ["tenant", "manager"].includes(p.persona)));
  } finally { await mock.close(); }
});

test("think times: per-action ranges are used when configured, otherwise scaled (forms take longer than reads)", async () => {
  const mock = await startMock();
  try {
    const e = mk(mock, cfg({ thinkKinds: { read: [100, 200], form: [1000, 2000], review: [500, 700] } }));
    assert.deepEqual(e._thinkRange("form"), [1000, 2000]); assert.deepEqual(e._thinkRange("read"), [100, 200]);
    const d = mk(mock, cfg({ thinkMinMs: 100, thinkMaxMs: 200 }));
    assert.deepEqual(d._thinkRange("read"), [100, 200]); assert.deepEqual(d._thinkRange("form"), [300, 600]); assert.deepEqual(d._thinkRange("review"), [200, 400]);
  } finally { await mock.close(); }
});

test("timeline separates configured users, active users, journeys in progress, sessions and throughput", async () => {
  const { s } = await run({ enforce: true }, { durationSec: 6, startUsers: 4, maxUsers: 4, rampUpSec: 0, rampDownSec: 0 });
  const p = s.timeline.find((x) => x.t === 3);
  for (const k of ["target", "active", "busy", "sessions", "rps", "okRps", "journeys", "journeysOk", "errorPct"]) assert.ok(k in p, k);
  assert.ok(s.throughput.journeysPerSec > 0 && s.throughput.successfulRequestsPerSec > 0); assert.ok(s.journeys.completionPct === 100);
  assert.ok(s.operations.some((o) => o.name === "Login") && s.operations.some((o) => o.name === "Dashboard"));
});
