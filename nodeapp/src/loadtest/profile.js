"use strict";
// The load profile: how many virtual users are active at each second.
// Every profile compiles to the same thing, a list of STAGES, so the engine, the validator, the charts and the
// per-stage metrics all share one definition.
//
//   linear  start -> max over the ramp-up, hold, then fall to 0 over the ramp-down.
//   step    like linear, but the ramp-up climbs in `steps` flat plateaus (shows where capacity runs out).
//   spike   a low baseline, a sudden jump to max for `spikeSec`, back to baseline, then ramp-down (tests recovery).
//   soak    linear shape intended for a long steady period; the analysis also looks for latency/error drift over time.
//   custom  explicit stages: [{ durationSec, users }]. Users move in a straight line from the previous stage's level.
//
// The configured duration is the TOTAL. Ramp-up and ramp-down are INCLUDED in it, never added on top.
const TYPES = ["linear", "step", "spike", "soak", "custom"];

function spikeShape(cfg) {
  const total = cfg.durationSec, down = cfg.rampDownSec;
  const span = Math.max(1, total - down);
  const spikeSec = cfg.spikeSec != null ? cfg.spikeSec : Math.max(3, Math.round(span * 0.2));
  const at = cfg.spikeAtSec != null ? cfg.spikeAtSec : Math.max(1, Math.round(span * 0.4));
  return { at, spikeSec };
}

/** The planned profile as stages: { name, kind: "ramp"|"hold"|"jump", start, end, from, to }. */
function stagesOf(cfg) {
  const total = cfg.durationSec, S = cfg.startUsers, M = cfg.maxUsers, up = cfg.rampUpSec || 0, down = cfg.rampDownSec || 0;
  const out = []; let t = 0;
  const add = (name, kind, dur, from, to) => { if (dur <= 0) return; out.push({ name, kind, start: t, end: t + dur, from, to }); t += dur; };
  const type = cfg.profile || "linear";
  if (type === "custom") {
    let prev = S;
    (cfg.stages || []).forEach((s, i) => { add(`stage ${i + 1}`, s.users === prev ? "hold" : "ramp", s.durationSec, prev, s.users); prev = s.users; });
    return out;
  }
  if (type === "spike") {
    const { at, spikeSec } = spikeShape(cfg);
    add("baseline", "hold", at, S, S);
    add("spike", "jump", spikeSec, M, M);
    add("recovery", "hold", Math.max(0, total - down - at - spikeSec), S, S);
    add("ramp-down", "ramp", down, S, 0);
    return out;
  }
  const steady = total - up - down;
  if (type === "step") {
    const n = Math.max(2, cfg.steps || 4);
    const each = up / n;
    for (let i = 0; i < n && up > 0; i++) {
      const level = Math.round(S + ((M - S) * (i + 1)) / n);
      const dur = i === n - 1 ? up - Math.round(each * i) : Math.round(each * (i + 1)) - Math.round(each * i);
      add(`step ${i + 1}`, "hold", dur, level, level);
    }
    add("steady", "hold", steady, M, M);
    add("ramp-down", "ramp", down, M, 0);
    return out;
  }
  add("ramp-up", "ramp", up, S, M);
  add("steady", "hold", steady, M, M);
  add("ramp-down", "ramp", down, M, 0);
  return out;
}

function totalOf(cfg) {
  if ((cfg.profile || "linear") === "custom") return (cfg.stages || []).reduce((a, s) => a + s.durationSec, 0);
  return cfg.durationSec;
}

/** Legacy helper kept for callers that think in ramp-up / steady / ramp-down. */
function phases(cfg) {
  const type = cfg.profile || "linear";
  if (type === "linear" || type === "soak" || type === "step") {
    return { rampUpSec: cfg.rampUpSec, steadySec: cfg.durationSec - cfg.rampUpSec - cfg.rampDownSec, rampDownSec: cfg.rampDownSec, durationSec: cfg.durationSec };
  }
  const st = stagesOf(cfg); const hold = st.filter((s) => s.kind !== "ramp").reduce((a, s) => a + (s.end - s.start), 0);
  return { rampUpSec: 0, steadySec: hold, rampDownSec: cfg.rampDownSec || 0, durationSec: totalOf(cfg) };
}

function stageIndexAt(cfg, t, stages = stagesOf(cfg)) {
  for (let i = 0; i < stages.length; i++) if (t < stages[i].end) return i;
  return -1;
}

/** Target number of concurrent virtual users at elapsed second t. */
function targetUsers(cfg, t, stages = stagesOf(cfg)) {
  const i = stageIndexAt(cfg, t, stages); if (i < 0) return 0;
  const s = stages[i];
  const v = s.kind === "ramp" || (cfg.profile === "custom" && s.from !== s.to) ? s.from + (s.to - s.from) * ((t - s.start) / (s.end - s.start)) : s.to;
  return Math.max(0, Math.min(cfg.maxUsers, Math.round(v)));
}
/** Name of the stage at second t ("finished" after the end). */
function phaseAt(cfg, t, stages = stagesOf(cfg)) { const i = stageIndexAt(cfg, t, stages); return i < 0 ? "finished" : stages[i].name; }

/** The planned profile as points, for drawing the timeline before a test starts. */
function plan(cfg, stepSec = 1) {
  const stages = stagesOf(cfg), total = totalOf(cfg), pts = [];
  for (let t = 0; t <= total; t += stepSec) pts.push({ t, users: targetUsers(cfg, t, stages) });
  return pts;
}
module.exports = { TYPES, stagesOf, totalOf, phases, targetUsers, phaseAt, stageIndexAt, plan, spikeShape };
