"use strict";
// Reads a performance test definition (YAML or JSON), applies command-line overrides and turns it into the configuration the
// EstateOps load-test API validates (src/loadtest/config.js). Unknown keys are errors, never silently ignored.
const fs = require("fs"), path = require("path");
const { parse, YamlError } = require("./yaml");

class ConfigError extends Error { constructor(errors) { super(errors.join("\n")); this.errors = errors; } }

/** "90", "90s", "2m", "1h", "500ms" -> milliseconds. */
function ms(v, field, errs) {
  if (v == null) return null;
  if (typeof v === "number") return v;   // a bare number is already in the field's own unit
  const m = /^(\d+(?:\.\d+)?)\s*(ms|s|sec|m|min|h)?$/i.exec(String(v).trim());
  if (!m) { errs.push(`${field}: "${v}" is not a duration. Use e.g. 500ms, 30s, 2m, 1h.`); return null; }
  return Math.round(Number(m[1]) * ({ ms: 1, s: 1000, sec: 1000, m: 60000, min: 60000, h: 3600000 }[(m[2] || "s").toLowerCase()]));
}
const secs = (v, f, e) => { const x = ms(v, f, e); return x == null ? null : typeof v === "number" ? v : Math.round(x / 1000); };
const millis = (v, f, e) => { const x = ms(v, f, e); return x == null ? null : typeof v === "number" ? v : x; };

const KNOWN = {
  top: ["name", "environment", "duration", "profile", "users", "rampUp", "rampDown", "steps", "spike", "stages", "trafficShare", "scenarioWeights", "thinkTime", "pacing", "timeout",
    "sessions", "testData", "security", "thresholds", "seed", "randomization", "regression", "baseline", "reports", "description"],
  environment: ["name", "baseUrl"], users: ["initial", "max"], spike: ["at", "duration"], thinkTime: ["min", "max", "read", "form", "review"], sessions: ["minJourneys", "maxJourneys"],
  testData: ["orgs", "cleanup", "writes", "maxCreates"], security: ["checkPercent"], thresholds: ["p95Ms", "p99Ms", "errorRatePct", "minRps", "securityLeaks"],
  trafficShare: ["tenant", "propertyManager", "manager", "technician", "vendor", "admin", "owner"], reports: ["dir"],
  regression: ["p95LatencyIncreasePercent", "p99LatencyIncreasePercent", "throughputDecreasePercent", "errorRateIncreasePercentagePoints", "endpoints", "journeys"],
};
function checkKeys(obj, allowed, where, errs) { if (obj && typeof obj === "object" && !Array.isArray(obj)) for (const k of Object.keys(obj)) if (!allowed.includes(k)) errs.push(`${where}${k}: unknown setting. Allowed here: ${allowed.join(", ")}.`); else if (obj[k] !== null && typeof obj[k] === "object" && KNOWN[k] && !Array.isArray(obj[k]) && where === "") checkKeys(obj[k], KNOWN[k], k + ".", errs); }

function load(file) {
  let text; try { text = fs.readFileSync(file, "utf8"); } catch (e) { throw new ConfigError([`Cannot read ${file}: ${e.code === "ENOENT" ? "file not found" : e.message}`]); }
  try { const v = /\.json$/i.test(file) ? JSON.parse(text) : parse(text); if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("the file must contain a mapping of settings"); return v; }
  catch (e) { throw new ConfigError([`${path.basename(file)}: ${e instanceof YamlError || e instanceof SyntaxError || e.message ? e.message : e}`]); }
}

/** file: the parsed definition; cli: parsed command-line options. Returns { api, meta } where api is the body for POST /api/loadtests. */
function build(file, cli = {}) {
  const errs = []; const f = JSON.parse(JSON.stringify(file || {}));
  checkKeys(f, KNOWN.top, "", errs);
  const api = {};
  const pick = (cliKey, fileVal) => (cli[cliKey] !== undefined && cli[cliKey] !== true ? cli[cliKey] : fileVal);
  api.name = String(pick("name", f.name) || "Performance test");
  api.profile = pick("profile", f.profile) || "linear";
  const dur = pick("duration", f.duration); if (dur != null) api.durationSec = secs(dur, "duration", errs);
  const u = f.users || {};
  const maxU = pick("users", u.max), iniU = pick("start", u.initial);
  if (maxU != null) api.maxUsers = Number(maxU); if (iniU != null) api.startUsers = Number(iniU);
  const up = pick("ramp-up", f.rampUp), down = pick("ramp-down", f.rampDown);
  if (up != null) api.rampUpSec = secs(up, "rampUp", errs); if (down != null) api.rampDownSec = secs(down, "rampDown", errs);
  if (f.steps != null || cli.steps != null) api.steps = Number(pick("steps", f.steps));
  if (f.spike) { if (f.spike.at != null) api.spikeAtSec = secs(f.spike.at, "spike.at", errs); if (f.spike.duration != null) api.spikeSec = secs(f.spike.duration, "spike.duration", errs); }
  if (Array.isArray(f.stages)) api.stages = f.stages.map((s, i) => { if (!s || typeof s !== "object") { errs.push(`stages[${i}]: expected "duration" and "users".`); return {}; } checkKeys(s, ["duration", "users"], `stages[${i}].`, errs); return { durationSec: secs(s.duration, `stages[${i}].duration`, errs), users: Number(s.users) }; });
  const ts = f.trafficShare || {};
  const share = {}; for (const [k, v] of Object.entries(ts)) share[k === "propertyManager" ? "manager" : k] = Number(v);
  for (const r of ["tenant", "manager", "technician", "vendor", "admin", "owner"]) if (cli[r] !== undefined && cli[r] !== true) share[r] = Number(cli[r]);
  if (Object.keys(share).length) api.personaWeights = share;
  if (f.scenarioWeights) api.scenarioWeights = f.scenarioWeights;
  const tt = f.thinkTime || {};
  if (tt.min != null || cli["think-min"] != null) api.thinkMinMs = millis(pick("think-min", tt.min), "thinkTime.min", errs);
  if (tt.max != null || cli["think-max"] != null) api.thinkMaxMs = millis(pick("think-max", tt.max), "thinkTime.max", errs);
  const kinds = {}; for (const k of ["read", "form", "review"]) if (Array.isArray(tt[k])) kinds[k] = tt[k].map((x, i) => millis(x, `thinkTime.${k}[${i}]`, errs)); else if (tt[k] != null) errs.push(`thinkTime.${k}: expected [min, max], e.g. [3s, 8s].`);
  if (Object.keys(kinds).length) api.thinkKinds = kinds;
  if (f.pacing != null || cli.pacing != null) api.pacingMs = millis(pick("pacing", f.pacing), "pacing", errs);
  if (f.timeout != null) api.timeoutMs = millis(f.timeout, "timeout", errs);
  if (f.sessions) { if (f.sessions.minJourneys != null) api.sessionMinIterations = Number(f.sessions.minJourneys); if (f.sessions.maxJourneys != null) api.sessionMaxIterations = Number(f.sessions.maxJourneys); }
  const td = f.testData || {};
  if (td.orgs != null || cli.orgs != null) api.orgs = Number(pick("orgs", td.orgs));
  if (td.cleanup != null) api.cleanupAfter = !!td.cleanup; if (td.writes != null) api.includeWrites = !!td.writes; if (td.maxCreates != null) api.maxCreates = Number(td.maxCreates);
  if (cli["read-only"]) api.includeWrites = false;
  if (f.security && f.security.checkPercent != null) api.securityPct = Number(f.security.checkPercent);
  const th = f.thresholds || {}; api.thresholds = {};
  const tv = (cliKey, v) => (cli[cliKey] !== undefined && cli[cliKey] !== true ? Number(cli[cliKey]) : v);
  if (tv("max-p95", th.p95Ms) != null) api.thresholds.maxP95Ms = tv("max-p95", th.p95Ms);
  if (tv("max-p99", th.p99Ms) != null) api.thresholds.maxP99Ms = tv("max-p99", th.p99Ms);
  if (tv("max-error", th.errorRatePct) != null) api.thresholds.maxErrorRatePct = tv("max-error", th.errorRatePct);
  if (th.minRps != null) api.thresholds.minRps = th.minRps; if (th.securityLeaks != null) api.thresholds.maxSecurityLeaks = th.securityLeaks;
  const seed = pick("seed", f.seed); if (seed != null) api.seed = Number(seed);
  const rnd = pick("randomization", f.randomization); if (rnd != null) api.randomization = Number(rnd);
  if (f.regression) {
    const { endpoints, journeys, ...global } = f.regression;
    api.regressionRules = { global, endpoints: endpoints || {}, journeys: journeys || {} };
  }
  const env = f.environment || {};
  api.target = cli.target || env.name || "local";
  for (const k of Object.keys(api)) if (api[k] === null || (typeof api[k] === "number" && Number.isNaN(api[k]))) { if (!errs.length) errs.push(`${k}: not a valid value.`); delete api[k]; }
  if (errs.length) throw new ConfigError(errs);
  return { api, baseUrl: cli.url || env.baseUrl || null, baseline: pick("baseline", f.baseline) || "previous", reportDir: cli["report-dir"] || (f.reports && f.reports.dir) || null };
}
module.exports = { load, build, ConfigError, ms };
