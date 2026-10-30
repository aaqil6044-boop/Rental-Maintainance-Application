"use strict";
// Admin-only load-testing API. Registered directly on the main router so the OpenAPI parity test covers it.
const M = require("./manager");
const T = require("./targets");
const X = require("./export");
const config = require("../config");
const { limits } = require("./limits");
const { validate, DEFAULTS } = require("./config");
const { catalog } = require("./scenarios");
const { plan, phases, stagesOf, totalOf } = require("./profile");
const RG = require("./regression");
const render = require("./report").render;
const { analyze } = require("./analysis");

module.exports = function register(router, { wrap, Fail, S }) {
  const admin = (req, res, next) => (req.account.role === "MANAGER" && req.account.org_admin
    ? next() : res.status(403).json({ status: 403, message: "Only an organization admin can use load testing." }));
  const fail = (e) => { throw e instanceof M.LoadTestError ? Object.assign(new Fail(e.status, e.message, e.errors ? "VALIDATION" : undefined), { errors: e.errors, activeId: e.activeId }) : e; };
  const idOf = (req) => { const n = Number(req.params.id); return Number.isInteger(n) && n > 0 ? n : null; };
  const find = (req) => { const id = idOf(req); const r = id && M.get(req.account.org_id, id); if (!r) throw new Fail(404, "Load test was not found."); return r; };
  const view = (req) => { const t = T.describe(); const lim = limits(); return {
    enabled: config.loadtest.enabled, limits: { maxUsers: lim.maxUsers, maxDurationSec: lim.maxDurationSec, maxRequests: lim.maxRequests, maxCreates: lim.maxCreates, minTimeoutMs: lim.minTimeoutMs, maxTimeoutMs: lim.maxTimeoutMs, abortErrorRatePct: config.loadtest.abortErrorRatePct },
    targets: t.targets, rejectedTargets: t.rejected, defaults: DEFAULTS, scenarios: catalog(), activeId: M.activeId() }; };

  router.get("/loadtests/config", admin, wrap((req, res) => res.json(view(req))));

  router.post("/loadtests/validate", admin, wrap((req, res) => {
    const v = validate(req.body, limits(), T.names());
    if (!v.ok) return res.json({ valid: false, errors: v.errors, profile: null, warnings: [] });
    const c = v.value, ph = phases(c); const warnings = [];
    if (ph.steadySec < 30) warnings.push(`Steady state is only ${ph.steadySec}s; short runs mostly measure warm-up.`);
    if (c.seed == null) warnings.push("No seed: this traffic pattern will not be exactly repeatable.");
    if (c.target !== "local") warnings.push("Not a local target: you will be asked to confirm before it starts.");
    res.json({ valid: true, errors: [], profile: { ...ph, type: c.profile, stages: stagesOf(c), points: plan(c, Math.max(1, Math.ceil(totalOf(c) / 120))) }, warnings });
  }));

  router.post("/loadtests", admin, wrap((req, res) => {
    let run; try { run = M.start(req.account, req.body, req); } catch (e) { fail(e); }
    res.status(201).json(run);
  }));

  router.get("/loadtests", admin, wrap((req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    res.json(M.list(req.account.org_id, limit));
  }));

  // literal paths before /loadtests/:id
  router.post("/loadtests/stop-all", admin, wrap((req, res) => res.json(M.stopAll(req.account))));

  router.post("/loadtests/cleanup", admin, wrap((req, res) => {
    if (M.activeId()) throw new Fail(409, "A load test is running. Stop it before cleaning up.");
    const F = require("./fixtures");
    const r = F.cleanup(req.account.org_id);
    S.audit(req.account, "LOADTEST_CLEANUP", "loadtest", null, `requests=${r.requests}`);
    res.json(r);
  }));

  /** Pick the baseline for `run`: "previous" (latest earlier comparable run), "known-good", or a run id. */
  function chooseBaseline(orgId, run, spec) {
    const earlier = M.finishedRuns(orgId, { beforeId: run.id, limit: 30 });
    const how = String(spec || "previous");
    if (how === "known-good") { const k = M.finishedRuns(orgId, { limit: 50 }).find((r) => r.knownGood && r.id !== run.id); return k ? { base: k, how, history: earlier.filter((r) => r.id !== k.id) } : { reason: "No run is marked as the known-good reference yet. Mark a good run first." }; }
    if (/^\d+$/.test(how)) { const b = M.get(orgId, Number(how)); if (!b || !b.summary || b.id === run.id) return { reason: "That baseline run was not found or has no measurements." }; return { base: b, how: "selected", history: earlier.filter((r) => r.id !== b.id) }; }
    if (how !== "previous") throw new Fail(400, 'baseline must be "previous", "known-good" or a run id.');
    const comparable = earlier.find((r) => RG.comparability(r, run).comparable) || earlier[0];
    return comparable ? { base: comparable, how: "previous", history: earlier.filter((r) => r.id !== comparable.id && RG.comparability(r, run).comparable) } : { reason: "There is no earlier completed run to compare with." };
  }
  function regression(req, run) {
    if (!run.summary) return { available: false, reason: "This run has no measurements yet.", baseline: null, comparison: null };
    const c = chooseBaseline(req.account.org_id, run, req.query.baseline);
    if (!c.base) return { available: false, reason: c.reason, baseline: null, comparison: null };
    const rules = run.config && run.config.regressionRules;
    const comparison = RG.compare(c.base, run, { rules, history: c.history });
    return { available: true, reason: null, baseline: { id: c.base.id, how: c.how }, comparison };
  }

  router.get("/loadtests/data", admin, wrap((req, res) => {
    const F = require("./fixtures");
    res.json(F.validateIntegrity(req.account.org_id, { running: !!M.activeId() }));
  }));

  router.get("/loadtests/trends", admin, wrap((req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 2), 30);
    const all = M.finishedRuns(req.account.org_id, { limit: 60 });
    if (!all.length) return res.json({ referenceId: null, runs: [], excluded: 0, trends: RG.trends([]) });
    const ref = req.query.runId ? all.find((r) => r.id === Number(req.query.runId)) : all[0];
    if (!ref) throw new Fail(404, "Load test was not found.");
    const same = all.filter((r) => r.id === ref.id || RG.comparability(ref, r).comparable).slice(0, limit).reverse();
    res.json({ referenceId: ref.id, runs: same.map((r) => ({ id: r.id, name: r.name, createdAt: r.createdAt, gitCommit: r.meta && r.meta.gitCommit || null, knownGood: r.knownGood })),
      excluded: all.length - same.length, trends: RG.trends(same, ref.config && ref.config.regressionRules) });
  }));

  router.get("/loadtests/compare", admin, wrap((req, res) => {
    const ids = String(req.query.ids || "").split(",").map((x) => Number(x.trim())).filter((x, i, a) => Number.isInteger(x) && x > 0 && a.indexOf(x) === i);
    if (ids.length < 2 || ids.length > 5) throw new Fail(400, "Choose between 2 and 5 runs to compare.");
    const runs = ids.map((id) => M.get(req.account.org_id, id));
    if (runs.some((r) => !r)) throw new Fail(404, "One of those load tests was not found.");
    if (runs.some((r) => !r.summary)) throw new Fail(400, "A run with no measurements cannot be compared.");
    res.json(X.compare(runs));
  }));

  router.get("/loadtests/:id", admin, wrap((req, res) => res.json(find(req))));

  router.post("/loadtests/:id/stop", admin, wrap((req, res) => {
    const run = find(req); const mode = req.body && req.body.mode === "now" ? "now" : "graceful";
    if (req.body && req.body.mode != null && !["graceful", "now"].includes(req.body.mode)) throw new Fail(400, 'mode must be "graceful" or "now".');
    try { res.json(M.stop(run.id, mode, req.account)); } catch (e) { fail(e); }
  }));

  router.post("/loadtests/:id/cleanup", admin, wrap((req, res) => {
    const run = find(req);
    if (run.isLive) throw new Fail(409, "This test is still running.");
    if (run.target !== "local") throw new Fail(400, "Records on a remote target cannot be cleaned up from here.");
    const F = require("./fixtures"); const r = F.cleanup(req.account.org_id, run.id);
    require("../db").prepare("UPDATE loadtest_runs SET cleaned_up = 1 WHERE id = ?").run(run.id);
    S.audit(req.account, "LOADTEST_CLEANUP", "loadtest", run.id, `requests=${r.requests}`);
    res.json(r);
  }));

  router.get("/loadtests/:id/regression", admin, wrap((req, res) => res.json(regression(req, find(req)))));

  router.post("/loadtests/:id/known-good", admin, wrap((req, res) => {
    const run = find(req);
    if (!req.body || typeof req.body.value !== "boolean") throw new Fail(400, "value must be true or false.");
    let out; try { out = M.setKnownGood(req.account.org_id, run.id, req.body.value); } catch (e) { fail(e); }
    S.audit(req.account, "LOADTEST_KNOWN_GOOD", "loadtest", run.id, String(req.body.value));
    res.json(out);
  }));

  router.get("/loadtests/:id/export", admin, wrap((req, res) => {
    const run = find(req); const format = String(req.query.format || "json").toLowerCase();
    if (!["json", "csv", "html"].includes(format)) throw new Fail(400, 'format must be "json", "csv" or "html".');
    res.set("Cache-Control", "no-store");
    if (format === "html") {
      const reg = run.summary && req.query.baseline !== "none" ? (() => { try { return regression(req, run); } catch (e) { return null; } })() : null;
      const all = M.finishedRuns(req.account.org_id, { limit: 30 }); const same = all.filter((r) => r.id === run.id || RG.comparability(run, r).comparable).reverse();
      res.set("Content-Disposition", `attachment; filename="loadtest-${run.id}-report.html"`);
      return res.type("text/html").send(render(run, { comparison: reg && reg.available ? reg.comparison : null, trends: same.length >= 3 ? RG.trends(same) : null }));
    }
    if (format === "json") {
      res.set("Content-Disposition", `attachment; filename="loadtest-${run.id}.json"`);
      return res.type("application/json").send(JSON.stringify({ schema: "estateops.performance-report.v1", exportedAt: new Date().toISOString(), run, analysis: run.summary ? analyze(run) : null }, null, 2));
    }
    const part = String(req.query.part || "summary");
    if (!X.PARTS.includes(part)) throw new Fail(400, `part must be one of: ${X.PARTS.join(", ")}.`);
    res.set("Content-Disposition", `attachment; filename="loadtest-${run.id}-${part}.csv"`);
    res.type("text/csv").send(X.toCsv(run, part));
  }));
};
