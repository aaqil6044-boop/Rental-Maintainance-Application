"use strict";
// Engine tests against a local mock service (never the real application).
const test = require("node:test");
const assert = require("node:assert/strict");
const { Engine, SetupError } = require("../../src/loadtest/engine");
const { validate } = require("../../src/loadtest/config");
const { startMock, accounts } = require("./mock");

const cfg = (o = {}) => {
  const want = o.durationSec === undefined ? 6 : o.durationSec;
  const r = validate({ name: "engine test", durationSec: Math.max(want, 5), startUsers: 1, maxUsers: 4, rampUpSec: 2, rampDownSec: 1, thinkMinMs: 10, thinkMaxMs: 40, pacingMs: 10, timeoutMs: 1000, seed: 42, ...o, ...(o.durationSec === undefined ? {} : { durationSec: Math.max(want, 5) }) });
  assert.ok(r.ok, JSON.stringify(r.errors));
  return { ...r.value, durationSec: want }; // validation enforces the product minimum; the engine is tested with shorter runs
};
const mk = (mock, c, extra = {}) => new Engine({ config: c, baseUrl: mock.url, accounts: accounts(), tag: "[LOADTEST r1]", seed: c.seed, hardMaxUsers: 50, maxRequests: 100000, ...extra });

test("engine: runs for the configured duration, ramps up and never exceeds the concurrency cap", async () => {
  const mock = await startMock({ delayMs: 20 });
  try {
    const c = cfg({ securityPct: 0 }); const t0 = Date.now(); const e = mk(mock, c); const out = await e.run(); const took = (Date.now() - t0) / 1000;
    assert.ok(took >= 5.5 && took < 9.5, `took ${took}s`);
    assert.ok(out.snapshot.totals.requests > 20, "traffic was generated");
    assert.ok(mock.stat.maxInflight <= c.maxUsers, `in-flight peaked at ${mock.stat.maxInflight}, cap ${c.maxUsers}`);
    const peak = Math.max(...out.snapshot.timeline.map((p) => p.active));
    assert.ok(peak <= c.maxUsers && peak >= 3, `peak active ${peak}`);
    const first = out.snapshot.timeline[0], mid = out.snapshot.timeline.find((p) => p.t >= 3);
    assert.ok(first.target >= 1 && first.target < 4 && mid.target === 4, "target ramps from start to max");
    assert.equal(out.leakedUsers, 0, "all virtual users finished");
    assert.equal(out.snapshot.totals.requests, mock.stat.total - 4 /* setup sign-ins */, "client count equals what the server saw");
  } finally { await mock.close(); }
});

test("engine: the hard server cap overrides a higher configured maximum", async () => {
  const mock = await startMock({ delayMs: 30 });
  try {
    const c = cfg({ startUsers: 10, maxUsers: 20, rampUpSec: 0, rampDownSec: 0, durationSec: 3 });
    const out = await mk(mock, c, { hardMaxUsers: 5 }).run();
    assert.ok(mock.stat.maxInflight <= 5, `in-flight ${mock.stat.maxInflight}`);
    assert.ok(Math.max(...out.snapshot.timeline.map((p) => p.active)) <= 5);
  } finally { await mock.close(); }
});

test("engine: same seed gives the same request sequence for a user; a different seed differs", async () => {
  const run = async (seed) => {
    const mock = await startMock({ delayMs: 1 });
    try { const c = cfg({ seed, durationSec: 3, rampUpSec: 0, rampDownSec: 0, startUsers: 1, maxUsers: 1, thinkMinMs: 1, thinkMaxMs: 2, pacingMs: 1, optionalPct: 50 }); await mk(mock, c).run(); return mock.stat.seq.slice(0, 40).join("|"); }
    finally { await mock.close(); }
  };
  const a = await run(5), b = await run(5), c = await run(6);
  assert.ok(a.split("|").length >= 40, "enough traffic to compare");
  assert.equal(a, b, "same seed -> identical sequence");
  assert.notEqual(a, c, "different seed -> different sequence");
});

test("engine: graceful stop ends early and leaves no running users", async () => {
  const mock = await startMock({ delayMs: 20 });
  try {
    const e = mk(mock, cfg({ durationSec: 30, rampUpSec: 1, rampDownSec: 1 })); const p = e.run();
    await new Promise((r) => setTimeout(r, 1500)); e.stop("graceful", "user");
    const t0 = Date.now(); const out = await p;
    assert.equal(out.stoppedEarly, true); assert.equal(out.leakedUsers, 0); assert.ok(Date.now() - t0 < 6000, "wound down promptly");
    await new Promise((r) => setTimeout(r, 300)); const n = mock.stat.total; await new Promise((r) => setTimeout(r, 500));
    assert.equal(mock.stat.total, n, "no traffic after stop");
  } finally { await mock.close(); }
});

test("engine: immediate stop (emergency) aborts in-flight requests without counting them as errors", async () => {
  const mock = await startMock({ delayMs: 400 });
  try {
    const e = mk(mock, cfg({ durationSec: 30, rampUpSec: 0, rampDownSec: 0, startUsers: 4, maxUsers: 4, timeoutMs: 5000 })); const p = e.run();
    await new Promise((r) => setTimeout(r, 1200)); const t0 = Date.now(); e.stop("now", "emergency");
    const out = await p; assert.ok(Date.now() - t0 < 1500, "stopped fast"); assert.equal(out.leakedUsers, 0);
    assert.ok(out.snapshot.errorKinds.timeout === undefined || out.snapshot.errorKinds.timeout === 0, "aborts are not timeouts");
  } finally { await mock.close(); }
});

test("engine: slow responses are recorded as timeouts", async () => {
  const mock = await startMock({ delayMs: 600 });
  try {
    const out = await mk(mock, cfg({ durationSec: 4, rampUpSec: 0, rampDownSec: 0, startUsers: 2, maxUsers: 2, timeoutMs: 100 })).run();
    assert.ok(out.snapshot.totals.timeouts > 0, JSON.stringify(out.snapshot.totals)); assert.ok(out.snapshot.errorRatePct > 50);
  } finally { await mock.close(); }
});

test("engine: a target that fails every request stops itself (safety auto-stop)", async () => {
  const mock = await startMock({ delayMs: 1, failWith: 500 });
  try {
    const out = await mk(mock, cfg({ durationSec: 30, rampUpSec: 0, rampDownSec: 0, startUsers: 4, maxUsers: 4, thinkMinMs: 1, thinkMaxMs: 2, pacingMs: 1 }), { abort: { errorRatePct: 50, minRequests: 60 } }).run();
    assert.equal(out.safetyStop, true); assert.equal(out.stoppedEarly, true); assert.match(out.stopReason, /error rate/i);
  } finally { await mock.close(); }
});

test("engine: an unavailable target fails setup clearly and sends no load", async () => {
  const mock = await startMock(); const url = mock.url; await mock.close();
  const e = new Engine({ config: cfg(), baseUrl: url, accounts: accounts(), tag: "x", seed: 1, hardMaxUsers: 10, maxRequests: 1000 });
  await assert.rejects(() => e.run(), (err) => err instanceof SetupError);
});

test("engine: failed sign-in is a setup error that does not leak the password", async () => {
  const mock = await startMock({ loginFail: true });
  try { await assert.rejects(() => mk(mock, cfg()).run(), (err) => err instanceof SetupError && !/password|"x"/i.test(err.message.replace(/wrong email or password/i, ""))); } finally { await mock.close(); }
});

test("engine: the request limit stops the run", async () => {
  const mock = await startMock({ delayMs: 1 });
  try {
    const out = await mk(mock, cfg({ durationSec: 30, rampUpSec: 0, rampDownSec: 0, startUsers: 3, maxUsers: 3, thinkMinMs: 1, thinkMaxMs: 2, pacingMs: 1 }), { maxRequests: 80 }).run();
    assert.equal(out.stoppedEarly, true); assert.ok(out.snapshot.totals.requests <= 80 + 3, `sent ${out.snapshot.totals.requests}`);
  } finally { await mock.close(); }
});

test("engine: only /api/ paths are ever requested and no secrets are in the recorded metadata", async () => {
  const mock = await startMock({ delayMs: 1, failWith: 500 });
  try {
    const out = await mk(mock, cfg({ durationSec: 2, rampUpSec: 0, rampDownSec: 0, startUsers: 2, maxUsers: 2 })).run();
    for (const k of Object.keys(mock.stat.paths)) assert.ok(k.split(" ")[1].startsWith("/api/"), k);
    const dump = JSON.stringify(out.snapshot); assert.ok(mock.stat.tokens.length > 0 && mock.stat.tokens.every((t) => !dump.includes(t)), "no bearer tokens"); assert.ok(!dump.includes("loadtest.invalid"), "no emails");
  } finally { await mock.close(); }
});
