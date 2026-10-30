"use strict";
// Validation of a load-test configuration. Nothing invalid is silently accepted or silently corrected.
const SCENARIO_KEYS = require("./scenarios").KEYS;
const { TYPES, spikeShape } = require("./profile");
const PERSONAS = ["tenant", "manager", "technician", "vendor", "admin"];
const THINK_KINDS = ["read", "form", "review"];

const DEFAULTS = {
  name: "Smoke test",
  target: "local",
  profile: "linear",        // linear | step | spike | soak | custom
  steps: 4,                 // step profile: number of plateaus in the ramp-up
  spikeAtSec: null,         // spike profile: when the jump happens (null = automatic)
  spikeSec: null,           // spike profile: how long the peak lasts (null = automatic)
  stages: [],               // custom profile: [{ durationSec, users }]
  orgs: 1,                  // independent test organizations (1 = just your own organization's fixtures)
  securityPct: 6,           // % of journeys that also run negative authorization / cross-tenant checks
  sessionMinIterations: 4,  // a virtual user's session ends after a random number of journeys in this range
  sessionMaxIterations: 14,
  regressionRules: null,    // optional overrides for the regression limits (global, per endpoint, per journey)
  thinkKinds: null,         // optional { read:[min,max], form:[min,max], review:[min,max] } in ms; null = scaled from the base range
  durationSec: 60,          // TOTAL, includes ramp-up and ramp-down
  startUsers: 2,
  maxUsers: 10,
  rampUpSec: 15,
  rampDownSec: 10,
  pacingMs: 500,            // average pause between one scenario run and the next
  thinkMinMs: 300,          // pause between actions inside a scenario
  thinkMaxMs: 1500,
  timeoutMs: 10000,
  randomization: 60,        // 0 = predictable, 100 = fully varied
  seed: null,
  loginPct: 0,              // % of journeys that begin with a fresh sign-in (every session already signs in once)
  optionalPct: 40,          // base chance that an optional action (comment, assignment, ...) happens
  cleanupAfter: true,       // delete this run's test records when it finishes
  includeWrites: true,      // scenarios that create or update test records
  maxCreates: 200,          // hard cap on records created by the whole run
  personaWeights: { tenant: 56, manager: 20, technician: 10, vendor: 9, admin: 5, owner: 0 },
  scenarioWeights: {},      // empty = each scenario's built-in default weight
  thresholds: { maxErrorRatePct: 1, maxP95Ms: 800, maxP99Ms: null, minRps: null, maxSecurityLeaks: 0 },
  confirmTarget: null,
};

const DEFAULT_LIMITS = { maxUsers: 200, maxDurationSec: 1800, maxRequests: 500000, maxCreates: 2000, minTimeoutMs: 100, maxTimeoutMs: 60000 };

function num(v) { return typeof v === "string" && v.trim() !== "" ? Number(v) : v; }

function validate(input, limits = DEFAULT_LIMITS, targets = ["local"]) {
  const errors = [];
  const err = (field, message) => errors.push({ field, message });
  const src = input && typeof input === "object" ? input : {};
  const v = {
    ...DEFAULTS, ...src,
    personaWeights: { ...DEFAULTS.personaWeights, ...(src.personaWeights || {}) },
    scenarioWeights: { ...(src.scenarioWeights || {}) },
    thresholds: { ...DEFAULTS.thresholds, ...(src.thresholds || {}) },
  };
  for (const k of ["durationSec", "startUsers", "maxUsers", "rampUpSec", "rampDownSec", "pacingMs", "thinkMinMs", "thinkMaxMs", "timeoutMs", "randomization", "loginPct", "optionalPct", "maxCreates", "steps", "orgs", "securityPct", "sessionMinIterations", "sessionMaxIterations"]) v[k] = num(v[k]);
  for (const k of ["spikeAtSec", "spikeSec"]) { if (v[k] === "" || v[k] === undefined) v[k] = null; else if (v[k] != null) v[k] = num(v[k]); }
  if (v.seed === "" || v.seed === undefined) v.seed = null; else if (v.seed != null) v.seed = num(v.seed);

  const ok0 = (f) => !errors.some((e) => e.field === f);
  const int = (field, label, min, max, unit) => {
    const x = v[field];
    if (typeof x !== "number" || !Number.isFinite(x)) return err(field, `${label} must be a number${unit ? " of " + unit : ""}.`);
    if (!Number.isInteger(x)) return err(field, `${label} must be a whole number.`);
    if (x < min) return err(field, `${label} must be at least ${min}${unit ? " " + unit : ""}.`);
    if (max != null && x > max) return err(field, `${label} must be at most ${max}${unit ? " " + unit : ""} (the server's safety limit or the allowed range).`);
  };
  const name = typeof v.name === "string" ? v.name.trim() : "";
  if (name.length < 3 || name.length > 80) err("name", "Give the test a name of 3 to 80 characters.");
  v.name = name;
  if (typeof v.target !== "string" || !targets.includes(v.target)) err("target", `Target must be one of the configured environments: ${targets.join(", ")}.`);

  if (!TYPES.includes(v.profile)) err("profile", `Profile must be one of: ${TYPES.join(", ")}.`);
  if (v.profile === "custom") {
    const st = Array.isArray(v.stages) ? v.stages : [];
    if (!st.length || st.length > 50) err("stages", "A custom profile needs 1 to 50 stages, each with a duration and a number of users.");
    else {
      let sum = 0; let bad = false;
      v.stages = st.map((x, i) => {
        const d = num(x && x.durationSec), u = num(x && x.users);
        if (!Number.isInteger(d) || d < 1 || !Number.isInteger(u) || u < 0) { err("stages", `Stage ${i + 1} needs a whole-number duration of at least 1 second and a user count of 0 or more.`); bad = true; return { durationSec: 1, users: 0 }; }
        sum += d; return { durationSec: d, users: u };
      });
      if (!bad) {
        if (Number.isInteger(v.maxUsers) && v.stages.some((x) => x.users > v.maxUsers)) err("stages", `A stage asks for more users than the maximum (${v.maxUsers}).`);
        v.durationSec = sum;   // a custom profile's duration is the sum of its stages
        v.rampUpSec = 0; v.rampDownSec = 0;
      }
    }
  } else v.stages = [];
  int("steps", "Number of steps", 2, 20);
  int("orgs", "Test organizations", 1, 4);
  int("securityPct", "Authorization-check share", 0, 100, "%");
  int("sessionMinIterations", "Minimum session length", 1, 1000, "journeys");
  int("sessionMaxIterations", "Maximum session length", 1, 1000, "journeys");
  if (ok0("sessionMinIterations") && ok0("sessionMaxIterations") && v.sessionMinIterations > v.sessionMaxIterations) err("sessionMinIterations", "Minimum session length cannot exceed the maximum.");
  if (v.thinkKinds != null) {
    if (typeof v.thinkKinds !== "object") err("thinkKinds", "Think times per action must be an object like { read: [3000, 8000] }.");
    else for (const k of Object.keys(v.thinkKinds)) {
      const r = v.thinkKinds[k];
      if (!THINK_KINDS.includes(k) || !Array.isArray(r) || r.length !== 2 || !r.every((n) => Number.isFinite(num(n)) && num(n) >= 0 && num(n) <= 600000) || num(r[0]) > num(r[1])) err("thinkKinds", `Think time "${k}" must be one of ${THINK_KINDS.join("/")} with [min, max] in ms and min not above max.`);
      else v.thinkKinds[k] = [num(r[0]), num(r[1])];
    }
  }
  int("durationSec", "Total duration", 5, limits.maxDurationSec, "seconds");
  int("maxUsers", "Maximum users", 1, limits.maxUsers, "users");
  int("startUsers", "Starting users", 1, null, "users");
  int("rampUpSec", "Ramp-up duration", 0, null, "seconds");
  int("rampDownSec", "Ramp-down duration", 0, null, "seconds");
  int("pacingMs", "Request pacing", 0, 600000, "ms");
  int("thinkMinMs", "Minimum think time", 0, 600000, "ms");
  int("thinkMaxMs", "Maximum think time", 0, 600000, "ms");
  int("timeoutMs", "Request timeout", limits.minTimeoutMs, limits.maxTimeoutMs, "ms");
  int("randomization", "Randomization", 0, 100, "%");
  int("loginPct", "Fresh sign-in share", 0, 100, "%");
  int("optionalPct", "Optional-action chance", 0, 100, "%");
  int("maxCreates", "Record creation cap", 0, limits.maxCreates, "records");
  if (v.seed != null && (!Number.isInteger(v.seed) || v.seed < 0 || v.seed > 4294967295)) err("seed", "Seed must be a whole number from 0 to 4294967295, or left empty.");

  const ok = (f) => !errors.some((e) => e.field === f);
  if (ok("startUsers") && ok("maxUsers") && v.startUsers > v.maxUsers) err("startUsers", "Starting users cannot be more than the maximum users.");
  if (ok("thinkMinMs") && ok("thinkMaxMs") && v.thinkMinMs > v.thinkMaxMs) err("thinkMinMs", "Minimum think time cannot be longer than the maximum.");
  if (v.profile === "spike" && ok("durationSec") && ok("rampDownSec")) {
    const sp = spikeShape(v);
    if (sp.at + sp.spikeSec + v.rampDownSec > v.durationSec) err("spikeSec", `The spike (starting at ${sp.at}s and lasting ${sp.spikeSec}s) plus the ${v.rampDownSec}s ramp-down does not fit in ${v.durationSec}s.`);
  }
  if (v.profile !== "custom" && v.profile !== "spike" && ok("durationSec") && ok("rampUpSec") && ok("rampDownSec") && v.rampUpSec + v.rampDownSec > v.durationSec) {
    err("rampUpSec", `Ramp-up (${v.rampUpSec}s) plus ramp-down (${v.rampDownSec}s) is longer than the total duration (${v.durationSec}s). The total duration INCLUDES both ramps; the remainder is the steady state.`);
  }

  const pw = v.personaWeights; let pSum = 0;
  if (num(pw.owner) > 0) err("personaWeights", "The owner user type is not available: EstateOps has no owner account role yet. Set its share to 0.");
  pw.owner = 0;
  for (const p of PERSONAS) {
    const x = num(pw[p]); pw[p] = x;
    if (typeof x !== "number" || !Number.isFinite(x) || x < 0 || x > 1000) err("personaWeights", `The ${p} weight must be a number from 0 to 1000.`); else pSum += x;
  }
  if (ok("personaWeights") && pSum <= 0) err("personaWeights", "At least one user type needs a weight above 0.");
  for (const [k, w] of Object.entries(v.scenarioWeights)) {
    if (!SCENARIO_KEYS.includes(k)) { err("scenarioWeights", `Unknown scenario "${k}".`); continue; }
    const x = num(w); v.scenarioWeights[k] = x;
    if (typeof x !== "number" || !Number.isFinite(x) || x < 0 || x > 1000) err("scenarioWeights", `The weight of "${k}" must be a number from 0 to 1000.`);
  }
  const th = v.thresholds;
  for (const [k, label, max] of [["maxSecurityLeaks", "Security-leak threshold", 1e6], ["maxErrorRatePct", "Error-rate threshold", 100], ["maxP95Ms", "p95 threshold", 600000], ["maxP99Ms", "p99 threshold", 600000], ["minRps", "Throughput threshold", 1e6]]) {
    if (th[k] === "" || th[k] === undefined) th[k] = null;
    if (th[k] != null) { th[k] = num(th[k]); if (typeof th[k] !== "number" || !Number.isFinite(th[k]) || th[k] < 0 || th[k] > max) err("thresholds." + k, `${label} must be a number from 0 to ${max}, or left empty.`); }
  }
  if (v.regressionRules != null) {
    const r = v.regressionRules, bad = (x) => typeof x !== "number" || !Number.isFinite(x) || x < 0 || x > 100000;
    if (typeof r !== "object" || Array.isArray(r)) err("regressionRules", "Regression rules must be an object.");
    else {
      const g = r.global || {}; const known = ["p95LatencyIncreasePercent", "p99LatencyIncreasePercent", "throughputDecreasePercent", "errorRateIncreasePercentagePoints"];
      for (const k of Object.keys(g)) { if (!known.includes(k)) err("regressionRules", `Unknown regression limit "${k}".`); else { g[k] = num(g[k]); if (bad(g[k])) err("regressionRules", `The "${k}" limit must be a non-negative number.`); } }
      for (const grp of ["endpoints", "journeys"]) for (const [name, o] of Object.entries(r[grp] || {})) for (const k of Object.keys(o || {})) { if (!known.includes(k)) err("regressionRules", `Unknown regression limit "${k}" for ${name}.`); else { o[k] = num(o[k]); if (bad(o[k])) err("regressionRules", `The "${k}" limit for ${name} must be a non-negative number.`); } }
    }
  } else v.regressionRules = null;
  v.includeWrites = v.includeWrites === true || v.includeWrites === "true";
  v.cleanupAfter = !(v.cleanupAfter === false || v.cleanupAfter === "false");
  return { ok: errors.length === 0, errors, value: v };
}

module.exports = { DEFAULTS, DEFAULT_LIMITS, validate, PERSONAS, THINK_KINDS };
