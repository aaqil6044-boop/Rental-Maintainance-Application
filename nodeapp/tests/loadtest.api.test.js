"use strict";
// Load-testing backend, end to end through the real HTTP API, with a REAL (small) run against this server.
const { isolate, reporter } = require("./helpers");
isolate();
const T = reporter("Load-test API");
const { ok, section } = T;
const app = require("../server");
const config = require("../src/config");
const db = require("../src/db");
const S = require("../src/store");
const A = require("../src/auth");
const M = require("../src/loadtest/manager");
const X = require("../src/loadtest/export");
require("../src/seed")();

let BASE;
async function call(method, p, token, body) {
  const res = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text(); let data = null; if (text) { try { data = JSON.parse(text); } catch (e) { data = text; } }
  return { status: res.status, data, headers: res.headers, text };
}
const login = async (email, password = "password123") => (await call("POST", "/api/auth/login", null, { email, password })).data.token;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(tok, id, states, ms = 45000) {
  const t0 = Date.now();
  for (;;) { const r = await call("GET", "/api/loadtests/" + id, tok); if (states.includes(r.data.state)) return r.data; if (Date.now() - t0 > ms) return r.data; await sleep(250); }
}
const quick = (o = {}) => ({ name: "API smoke", durationSec: 6, startUsers: 1, maxUsers: 3, rampUpSec: 1, rampDownSec: 1, thinkMinMs: 20, thinkMaxMs: 80, pacingMs: 30, timeoutMs: 5000, seed: 7, maxCreates: 15, thresholds: { maxErrorRatePct: 5, maxP95Ms: 5000 }, ...o });
const realRequests = () => db.prepare("SELECT id, title, status, updated_at FROM requests WHERE title NOT LIKE '[LOADTEST%'").all();

(async () => {
  const server = app.listen(0); await new Promise((r) => server.once("listening", r));
  BASE = "http://127.0.0.1:" + server.address().port;

  const admin = await login("manager@estateops.test"), tenant = await login("tenant@estateops.test"), tech = await login("tech@estateops.test");
  const org = S.findAccountByEmail("manager@estateops.test").org_id;
  S.createAccount({ email: "plain.manager@estateops.test", passwordHash: A.hash("password123"), fullName: "Plain Manager", role: "MANAGER", orgId: org, orgAdmin: 0, profileComplete: 1 });
  const plain = await login("plain.manager@estateops.test");
  const org2 = S.createOrganization("Other org").id;
  S.createAccount({ email: "other.admin@estateops.test", passwordHash: A.hash("password123"), fullName: "Other Admin", role: "MANAGER", orgId: org2, orgAdmin: 1, profileComplete: 1 });
  const other = await login("other.admin@estateops.test");

  section("1. Only authenticated organization admins can use it");
  for (const [m, p, b] of [["GET", "/api/loadtests"], ["GET", "/api/loadtests/config"], ["POST", "/api/loadtests", {}], ["POST", "/api/loadtests/stop-all"], ["GET", "/api/loadtests/1"], ["GET", "/api/loadtests/compare?ids=1,2"], ["POST", "/api/loadtests/cleanup"]]) {
    const r = await call(m, p, null, b); ok(`anonymous ${m} ${p} -> 401`, r.status === 401, r.status);
  }
  for (const [who, tk] of [["tenant", tenant], ["technician", tech], ["non-admin manager", plain]]) {
    for (const [m, p, b] of [["GET", "/api/loadtests"], ["POST", "/api/loadtests", quick()], ["POST", "/api/loadtests/stop-all"], ["GET", "/api/loadtests/config"], ["POST", "/api/loadtests/validate", {}]]) {
      const r = await call(m, p, tk, b); ok(`${who}: ${m} ${p} -> 403`, r.status === 403, r.status);
    }
  }
  ok("a forged role/org in the body changes nothing (still 403 for a tenant)", (await call("POST", "/api/loadtests", tenant, { ...quick(), role: "MANAGER", orgAdmin: true })).status === 403);
  const noRunsYet = await call("GET", "/api/loadtests", admin);
  ok("admin can list (empty at first)", noRunsYet.status === 200 && Array.isArray(noRunsYet.data) && noRunsYet.data.length === 0);

  section("2. Setup information");
  const cfg = (await call("GET", "/api/loadtests/config", admin)).data;
  ok("limits, defaults, scenarios and targets are returned", cfg.limits.maxUsers === 200 && cfg.defaults.durationSec === 60 && cfg.scenarios.length === 18 && cfg.targets[0].name === "local");
  ok("every scenario states whether it writes", cfg.scenarios.every((s) => typeof s.writes === "boolean" && s.endpoints.length > 0));
  ok("nothing secret is exposed (no tokens, passwords or credential settings)", !/eyJ|"password"|remoteAccounts|LOADTEST_REMOTE/.test(JSON.stringify(cfg)));

  section("3. Validation is strict and explains itself");
  const val = (b) => call("POST", "/api/loadtests/validate", admin, b);
  const bad = async (what, b, field) => { const r = await val(b); ok(`${what} is rejected on field ${field}`, r.data.valid === false && r.data.errors.some((e) => e.field === field), r.data.errors); };
  await bad("zero maximum users", { maxUsers: 0 }, "maxUsers");
  await bad("negative duration", { durationSec: -10 }, "durationSec");
  await bad("ramp-up longer than the duration", { durationSec: 30, rampUpSec: 40 }, "rampUpSec");
  await bad("ramps that together exceed the duration", { durationSec: 30, rampUpSec: 20, rampDownSec: 20 }, "rampUpSec");
  await bad("starting users above maximum", { startUsers: 50, maxUsers: 10 }, "startUsers");
  await bad("above the server's user cap", { maxUsers: 5000 }, "maxUsers");
  await bad("above the server's duration cap", { durationSec: 999999 }, "durationSec");
  await bad("an arbitrary URL as the target", { target: "http://169.254.169.254/latest" }, "target");
  await bad("an unknown scenario", { scenarioWeights: { "nope.nothing": 1 } }, "scenarioWeights");
  const good = (await val(quick({ durationSec: 600, rampUpSec: 120, rampDownSec: 60 }))).data;
  ok("a valid configuration returns its profile; ramps are inside the total", good.valid && good.profile.rampUpSec + good.profile.steadySec + good.profile.rampDownSec === 600 && good.profile.steadySec === 420);
  ok("profile points start at the starting users and never exceed the maximum", good.profile.points[0].users === 1 && Math.max(...good.profile.points.map((p) => p.users)) === 3);
  const invalidStart = await call("POST", "/api/loadtests", admin, { maxUsers: 0 });
  ok("starting with an invalid configuration -> 400 with field errors", invalidStart.status === 400 && invalidStart.data.errors.some((e) => e.field === "maxUsers"));
  ok("…and no run was created", (await call("GET", "/api/loadtests", admin)).data.length === 0);

  section("4. Target protection");
  const startWith = (b) => call("POST", "/api/loadtests", admin, quick(b));
  ok("an arbitrary URL is refused", (await startWith({ target: "https://example.com" })).status === 400);
  ok("an unconfigured name is refused", (await startWith({ target: "staging" })).status === 400);
  config.loadtest.targets = "staging=https://staging.example.com, meta=http://169.254.169.254, bad=ftp://x.example.com, path=https://x.example.com/admin, cred=https://u:p@x.example.com";
  const described = (await call("GET", "/api/loadtests/config", admin)).data;
  ok("only the valid remote target is offered", described.targets.map((t) => t.name).join() === "local,staging", described.targets.map((t) => t.name));
  ok("metadata, non-http, path and credential URLs are rejected with reasons", ["meta", "bad", "path", "cred"].every((n) => described.rejectedTargets.some((r) => r.name === n)));
  ok("the remote target's credentials/URL are not exposed beyond its host", !JSON.stringify(described).includes("https://staging.example.com"));
  const r1 = await startWith({ target: "staging", confirmTarget: "staging" });
  ok("remote testing is off by default -> 403", r1.status === 403, r1.data.message);
  config.loadtest.allowRemote = true;
  const r2 = await startWith({ target: "staging" });
  ok("remote needs the target name typed to confirm -> 400", r2.status === 400 && r2.data.errors[0].field === "confirmTarget", r2.data);
  const r3 = await startWith({ target: "staging", confirmTarget: "staging" });
  ok("remote needs credentials from the environment -> 400", r3.status === 400 && /LOADTEST_REMOTE_ACCOUNTS/.test(r3.data.message), r3.data.message);
  config.loadtest.allowRemote = false; config.loadtest.targets = "";
  config.loadtest.maxUsers = 5;
  ok("an administrator-lowered user cap is enforced", (await startWith({ maxUsers: 6 })).status === 400);
  config.loadtest.maxUsers = 200;
  config.loadtest.enabled = false;
  ok("the feature can be switched off -> 403", (await startWith({})).status === 403);
  config.loadtest.enabled = true;
  ok("none of the rejected attempts created a run", (await call("GET", "/api/loadtests", admin)).data.length === 0);

  section("5. A real run: lifecycle, overlap, concurrency and isolation");
  const before = JSON.stringify(realRequests());
  const accountsBefore = db.prepare("SELECT COUNT(*) n FROM accounts WHERE email NOT LIKE 'loadtest-%'").get().n;
  const started = await call("POST", "/api/loadtests", admin, quick());
  ok("start -> 201 and RUNNING", started.status === 201 && started.data.state === "RUNNING", started.data);
  const id = started.data.id;
  ok("the starter is recorded", started.data.startedBy.name.length > 0 && started.data.startedBy.id === S.findAccountByEmail("manager@estateops.test").id);
  const dup = await startWith({ name: "Second at once" });
  ok("a second start while one is active -> 409 naming the active run", dup.status === 409 && dup.data.activeId === id, dup.data);
  ok("cleanup is refused while a test is running -> 409", (await call("POST", "/api/loadtests/cleanup", admin)).status === 409);
  await sleep(3200);
  const mid = (await call("GET", "/api/loadtests/" + id, admin)).data;
  ok("progress is live: isLive, elapsed, phase", mid.isLive === true && mid.elapsedSec >= 1 && ["ramp-up", "steady", "ramp-down"].includes(mid.phase), [mid.isLive, mid.elapsedSec, mid.phase]);
  ok("target and actual users are reported separately and never exceed the cap", typeof mid.targetUsers === "number" && typeof mid.activeUsers === "number" && mid.activeUsers <= 3 && mid.targetUsers <= 3, [mid.targetUsers, mid.activeUsers]);
  ok("another organization cannot see the run (404)", (await call("GET", "/api/loadtests/" + id, other)).status === 404);
  const done = await waitFor(admin, id, ["COMPLETED", "FAILED", "CANCELLED"]);
  ok("the run COMPLETED", done.state === "COMPLETED", [done.state, done.error]);
  ok("the child process is gone and no run is active", M._state() === null && M.activeId() === null);
  const s = done.summary;
  ok("traffic was generated and every request is accounted for", s.totals.requests > 20 && s.totals.ok + s.totals.failed === s.totals.requests, s.totals);
  ok("endpoint rows add up to the total request count", s.endpoints.reduce((a, e) => a + e.count, 0) === s.totals.requests);
  ok("only real /api endpoints were exercised", s.endpoints.every((e) => /^(GET|POST) \/api\//.test(e.key)), s.endpoints.map((e) => e.key));
  ok("peak users never exceeded the configured maximum", s.peakActiveUsers <= 3 && s.peakActiveUsers >= 1, s.peakActiveUsers);
  ok("percentiles are ordered min<=p50<=p90<=p95<=p99<=max", s.latency.min <= s.latency.p50 && s.latency.p50 <= s.latency.p90 && s.latency.p90 <= s.latency.p95 && s.latency.p95 <= s.latency.p99 && s.latency.p99 <= s.latency.max, s.latency);
  ok("the timeline covers the run and ends with zero target users", done.timeline.length >= 5 && done.timeline[done.timeline.length - 1].target === 0);
  ok("thresholds were evaluated and the verdict reflects them", done.thresholds.length === 3 && done.thresholds.some((t) => t.key === "securityLeaks") && done.verdict === (done.thresholds.every((t) => t.passed) ? "PASSED" : "FAILED"), [done.verdict, done.thresholds]);
  ok("server resources were measured for the local target", done.resources.available === true && done.resources.series.length >= 3 && done.resources.peak.rssMb > 0, done.resources.reason);
  ok("limitations are stated as warnings", done.warnings.some((w) => /share one machine/.test(w)));
  ok("a fixed seed was recorded", done.seed === 7);
  ok("the run is listed with its summary", (await call("GET", "/api/loadtests", admin)).data.some((r) => r.id === id && r.state === "COMPLETED" && r.requests === s.totals.requests));

  section("6. Test data is isolated and cleaned up");
  const after = JSON.stringify(realRequests());
  ok("real maintenance requests were not changed", before === after);
  ok("no load-test records remain (cleaned automatically)", db.prepare("SELECT COUNT(*) n FROM requests WHERE title LIKE '[LOADTEST%'").get().n === 0);
  ok("the run reports how many records it created and that they were cleaned up", done.createdRecords >= 0 && done.cleanedUp === true, [done.createdRecords, done.cleanedUp]);
  ok("no real account was created or changed", db.prepare("SELECT COUNT(*) n FROM accounts WHERE email NOT LIKE 'loadtest-%'").get().n === accountsBefore);
  ok("fixtures use the reserved .invalid domain and are deactivated between runs", db.prepare("SELECT COUNT(*) n FROM accounts WHERE email LIKE 'loadtest-%'").get().n > 0 && db.prepare("SELECT COUNT(*) n FROM accounts WHERE email LIKE 'loadtest-%' AND (active = 1 OR email NOT LIKE '%@loadtest.invalid')").get().n === 0);
  const seen = async (p) => JSON.stringify((await call("GET", p, admin)).data).toLowerCase();
  ok("fixtures do not appear in the real team, technician, tenant, property or unit lists", !(await seen("/api/team")).includes("loadtest") && !(await seen("/api/technicians")).includes("loadtest") && !(await seen("/api/tenants")).includes("loadtest") && !(await seen("/api/properties")).includes("loadtest") && !(await seen("/api/units/reportable")).includes("lt-0"));
  ok("no notifications were left for real managers", db.prepare("SELECT COUNT(*) n FROM notifications WHERE message LIKE '%LOADTEST%'").get().n === 0);

  section("7. Cleanup deletes only what it should");
  const fx = db.prepare("SELECT id FROM accounts WHERE email LIKE 'loadtest-tenant-1-%'").get().id;
  const real = S.findAccountByEmail("tenant@estateops.test").id; const unit = db.prepare("SELECT id FROM units LIMIT 1").get().id;
  const ins = (rep, title) => db.prepare("INSERT INTO requests (unit_id, reporter_id, title, description, created_at, updated_at) VALUES (?,?,?,?,datetime('now'),datetime('now'))").run(unit, rep, title, "x").lastInsertRowid;
  const imposter = ins(real, "[LOADTEST r999] a real tenant used the tag"), plainFx = ins(fx, "A fixture account, normal title"), target = ins(fx, "[LOADTEST r999] genuine test record");
  db.prepare("INSERT INTO notifications (recipient_id, message, request_id, read_flag, created_at) VALUES (?,?,?,0,datetime('now'))").run(real, "caused by the test record", target);
  const c = await call("POST", "/api/loadtests/cleanup", admin);
  const alive = (rid) => !!db.prepare("SELECT 1 FROM requests WHERE id = ?").get(rid);
  ok("cleanup -> 200 and deleted exactly one request", c.status === 200 && c.data.requests === 1, c.data);
  ok("a real tenant's request that merely used the tag survives", alive(imposter));
  ok("a fixture's request without the tag survives", alive(plainFx));
  ok("the genuine test record and its notification are gone", !alive(target) && db.prepare("SELECT COUNT(*) n FROM notifications WHERE request_id = ?").get(target).n === 0);
  db.prepare("DELETE FROM requests WHERE id IN (?,?)").run(imposter, plainFx);
  ok("another organization's cleanup touches nothing of ours", (await call("POST", "/api/loadtests/cleanup", other)).data.requests === 0);

  section("8. Export and comparison");
  const j = await call("GET", `/api/loadtests/${id}/export?format=json`, admin);
  ok("JSON export is a download containing the full run", j.status === 200 && /attachment/.test(j.headers.get("content-disposition")) && j.data.run.id === id && j.data.run.summary.totals.requests === s.totals.requests);
  const csvOf = async (part) => (await call("GET", `/api/loadtests/${id}/export?format=csv&part=${part}`, admin));
  const parse = (t) => t.trim().split("\r\n").map((l) => l.split(","));
  const sumCsv = await csvOf("summary"); const rows = Object.fromEntries(parse(sumCsv.text).slice(1).map((r) => [r[0], r[1]]));
  ok("CSV summary matches the stored results", sumCsv.status === 200 && /text\/csv/.test(sumCsv.headers.get("content-type")) && Number(rows.requests) === s.totals.requests && Number(rows.latency_p95) === s.latency.p95 && Number(rows.error_rate) === s.errorRatePct);
  const epCsv = parse((await csvOf("endpoints")).text); ok("CSV endpoints: one row per endpoint, request counts add up", epCsv.length - 1 === s.endpoints.length && epCsv.slice(1).reduce((a, r) => a + Number(r[1]), 0) === s.totals.requests);
  const tl = parse((await csvOf("timeline")).text); ok("CSV timeline: one row per second", tl.length - 1 === done.timeline.length);
  for (const part of X.PARTS) ok(`CSV part "${part}" is available`, (await csvOf(part)).status === 200);
  ok("an unknown CSV part or format -> 400", (await call("GET", `/api/loadtests/${id}/export?format=csv&part=x`, admin)).status === 400 && (await call("GET", `/api/loadtests/${id}/export?format=xml`, admin)).status === 400);
  ok("spreadsheet formula injection is neutralised", X.cell("=HYPERLINK(\"http://x\")").includes("'=HYPERLINK") && X.cell("@SUM(A1)").startsWith("'@") && X.cell("a,b") === '"a,b"' && X.cell(-5) === "-5");
  ok("exports contain no secrets", !/eyJ|Bearer|"password"|password=/i.test(j.text) && !/eyJ|Bearer/.test(sumCsv.text));
  ok("another organization cannot export it (404)", (await call("GET", `/api/loadtests/${id}/export`, other)).status === 404);

  const second = (await call("POST", "/api/loadtests", admin, quick({ name: "Second run", maxUsers: 2 }))).data;
  await waitFor(admin, second.id, ["COMPLETED", "FAILED", "CANCELLED"]);
  const cmp = await call("GET", `/api/loadtests/compare?ids=${id},${second.id}`, admin);
  ok("compare -> baseline is the first id, with deltas and a direction for the second", cmp.status === 200 && cmp.data.baselineId === id && ["improved", "regressed", "similar"].includes(cmp.data.runs[1].vsBaseline.p95Ms.verdict), cmp.data);
  ok("compare warns that the settings differ", cmp.data.differingSettings.includes("maxUsers") && cmp.data.notes.length > 0);
  ok("compare needs 2 to 5 runs and real ids", (await call("GET", `/api/loadtests/compare?ids=${id}`, admin)).status === 400 && (await call("GET", `/api/loadtests/compare?ids=${id},99999`, admin)).status === 404);
  ok("another organization cannot compare ours (404)", (await call("GET", `/api/loadtests/compare?ids=${id},${second.id}`, other)).status === 404);

  section("9. Stopping and cancelling");
  const long = (await call("POST", "/api/loadtests", admin, quick({ name: "Long run to stop", durationSec: 60, rampUpSec: 1, rampDownSec: 1, maxUsers: 3 }))).data;
  await sleep(2500);
  const t0 = Date.now(); const stopping = await call("POST", `/api/loadtests/${long.id}/stop`, admin, { mode: "graceful" });
  ok("graceful stop -> 200 and STOPPING", stopping.status === 200 && stopping.data.state === "STOPPING", stopping.data.state);
  const stopped = await waitFor(admin, long.id, ["CANCELLED", "COMPLETED", "FAILED"], 20000);
  ok("it ends CANCELLED within seconds, not at the planned end", stopped.state === "CANCELLED" && Date.now() - t0 < 12000, [stopped.state, Date.now() - t0]);
  ok("a stopped run's verdict is INCONCLUSIVE, never PASSED", stopped.verdict === "INCONCLUSIVE");
  ok("partial results are kept", stopped.summary && stopped.summary.totals.requests > 0 && /Stopped by/.test(stopped.stopReason), stopped.stopReason);
  ok("no process or active run is left behind", M._state() === null);
  ok("stopping a finished run -> 409", (await call("POST", `/api/loadtests/${long.id}/stop`, admin, {})).status === 409);
  ok("a bad stop mode -> 400", (await call("POST", `/api/loadtests/${second.id}/stop`, admin, { mode: "sideways" })).status === 400);

  const em = (await call("POST", "/api/loadtests", admin, quick({ name: "Emergency", durationSec: 60 }))).data;
  await sleep(2000);
  const kill = await call("POST", "/api/loadtests/stop-all", other);
  ok("an admin from another org may trigger the emergency stop (shared server)", kill.status === 200 && kill.data.stopped === 1, kill.data);
  const killed = await waitFor(admin, em.id, ["CANCELLED", "FAILED", "COMPLETED"], 15000);
  ok("emergency stop ends the run as CANCELLED", killed.state === "CANCELLED" && /Emergency stop/.test(killed.stopReason), [killed.state, killed.stopReason]);
  ok("…and nothing is running afterwards", M._state() === null && (await call("POST", "/api/loadtests/stop-all", admin)).data.stopped === 0);

  section("10. Failure handling");
  config.loadtest.targets = "dead=http://127.0.0.1:9"; config.loadtest.allowRemote = true;
  config.loadtest.remoteAccounts = JSON.stringify([{ persona: "tenant", email: "a@x.invalid", password: "secret-pass-1" }, { persona: "manager", email: "b@x.invalid", password: "secret-pass-2" }, { persona: "technician", email: "c@x.invalid", password: "secret-pass-3" }]);
  const dead = await call("POST", "/api/loadtests", admin, quick({ target: "dead", confirmTarget: "dead", name: "Unreachable" }));
  ok("a configured but unreachable target starts…", dead.status === 201, dead.data);
  const deadDone = await waitFor(admin, dead.data.id, ["FAILED", "COMPLETED", "CANCELLED"], 20000);
  ok("…and ends FAILED with a clear message and no verdict", deadDone.state === "FAILED" && /sign in/i.test(deadDone.error) && deadDone.verdict === null, [deadDone.state, deadDone.error, deadDone.verdict]);
  ok("the remote credentials never appear in the stored result", !JSON.stringify(deadDone).includes("secret-pass") && !JSON.stringify(deadDone).includes("a@x.invalid"));
  ok("remote runs say server metrics are unavailable instead of inventing them", deadDone.resources.available === false && /local target/.test(deadDone.resources.reason));
  config.loadtest.targets = ""; config.loadtest.allowRemote = false; config.loadtest.remoteAccounts = null;

  section("11. Server restart policy");
  const orphan = db.prepare("INSERT INTO loadtest_runs (org_id, started_by, name, target, state, config_json, created_at) VALUES (?,?,?,?,?,?,datetime('now'))").run(org, S.findAccountByEmail("manager@estateops.test").id, "Was running", "local", "RUNNING", "{}").lastInsertRowid;
  ok("recover() reports one interrupted run", M.recover() === 1);
  const rec = (await call("GET", "/api/loadtests/" + orphan, admin)).data;
  ok("it is marked FAILED with the reason, never left 'running'", rec.state === "FAILED" && /restarted/.test(rec.error) && rec.finishedAt, rec);

  section("12. Audit trail");
  const audit = (await call("GET", "/api/audit?limit=200", admin)).data.map((a) => a.action);
  ok("starts, stops and cleanups are audited", ["LOADTEST_STARTED", "LOADTEST_COMPLETED", "LOADTEST_STOPPING", "LOADTEST_CANCELLED", "LOADTEST_FAILED", "LOADTEST_CLEANUP"].every((a) => audit.includes(a)), audit.filter((a) => a.startsWith("LOADTEST")));
  ok("the emergency stop is audited in the organization of the admin who pressed it", (await call("GET", "/api/audit?limit=50", other)).data.some((a) => a.action === "LOADTEST_EMERGENCY_STOP"));

  server.close(); T.done();
})().catch((e) => { console.error("CRASH", e); M.shutdown(); process.exit(1); });
