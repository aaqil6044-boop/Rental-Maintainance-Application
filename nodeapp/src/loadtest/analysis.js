"use strict";
// Turns one finished run into observations a person can act on. Everything here is derived from measured data; where the data
// needed for a conclusion is missing, the observation says so instead of guessing.
const round = (v, d = 1) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

function analyze(run) {
  const s = run.summary || {}, cfg = run.config || {}, tl = run.timeline || [], res = run.resources || {};
  const obs = []; const add = (severity, kind, title, detail, evidence) => obs.push({ severity, kind, title, detail, evidence: evidence || null });
  const eps = (s.endpoints || []).filter((e) => e.count >= 10);

  const slowest = eps.slice().sort((a, b) => (b.p95 || 0) - (a.p95 || 0)).slice(0, 5).map((e) => ({ key: e.key, operation: e.operation, p95: e.p95, p99: e.p99, count: e.count }));
  const errorProne = eps.filter((e) => e.errors > 0).sort((a, b) => b.errorRatePct - a.errorRatePct).slice(0, 5).map((e) => ({ key: e.key, errorRatePct: e.errorRatePct, errors: e.errors, count: e.count, statusCodes: e.statusCodes }));
  const byRole = (s.personas || []).map((p) => ({ persona: p.persona, requests: p.requests, p95: p.p95, errorRatePct: p.errorRatePct, sessions: p.sessions, journeys: p.journeys }));
  const byScenario = (s.scenarios || []).map((x) => ({ key: x.key, persona: x.persona, iterations: x.iterations, completionPct: x.completionPct, p95Ms: x.p95Ms }));
  const byStage = (s.stages || []).map((x) => ({ name: x.name, users: x.users, requests: x.requests, rps: x.rps, p95: x.p95, errorRatePct: x.errorRatePct }));

  /* ---- saturation: did throughput stop growing while load kept growing, and did latency bend upward? */
  const growth = byStage.filter((x) => x.rps != null && x.p95 != null && x.requests >= 50);
  for (let i = 1; i < growth.length; i++) {
    const a = growth[i - 1], b = growth[i];
    if (b.users > a.users * 1.2 && a.rps > 0) {
      const usersUp = ((b.users - a.users) / a.users) * 100, rpsUp = ((b.rps - a.rps) / a.rps) * 100, p95Up = a.p95 > 0 ? ((b.p95 - a.p95) / a.p95) * 100 : 0;
      if (rpsUp < usersUp * 0.4 && p95Up > 40) add("warning", "saturation", `Throughput stopped scaling at "${b.name}"`, `Users grew ${round(usersUp, 0)}% from "${a.name}" to "${b.name}" but throughput grew only ${round(rpsUp, 0)}% while p95 rose ${round(p95Up, 0)}%. The system is close to its capacity around ${b.users} users.`, { from: a, to: b });
    }
  }
  const steadyLike = tl.filter((p) => p.target >= (cfg.maxUsers || 1) * 0.9 && p.requests >= 3);

  /* ---- drift in a long steady period (soak) */
  if (steadyLike.length >= 60) {
    const third = Math.floor(steadyLike.length / 3);
    const head = steadyLike.slice(0, third), tail = steadyLike.slice(-third);
    const h = avg(head.map((p) => p.p95).filter((v) => v != null)), t = avg(tail.map((p) => p.p95).filter((v) => v != null));
    if (h && t && (t - h) / h > 0.25 && t - h > 10) add((t - h) / h > 0.5 ? "warning" : "info", "drift", "Latency drifted upward during the steady period", `Average per-second p95 rose from ${round(h)} ms in the first third of the steady period to ${round(t)} ms in the last third (${round(((t - h) / h) * 100, 0)}%). Under constant load this suggests a leak, a growing table or cache pressure.`, { first: round(h), last: round(t) });
    const he = avg(head.map((p) => p.errorPct)), te = avg(tail.map((p) => p.errorPct));
    if (te - he >= 0.5) add("warning", "drift", "Error rate rose during the steady period", `From ${round(he, 2)}% to ${round(te, 2)}%.`, null);
  } else if (cfg.profile === "soak") add("info", "drift", "Soak run too short to assess drift", `Only ${steadyLike.length}s of steady load were recorded; at least 60s are needed to compare the start and end of the steady period.`, null);

  /* ---- server resources, only if they were measured */
  if (res.available && res.series && res.series.length >= 10) {
    const rs = res.series;
    const cpuHigh = rs.filter((x) => x.cpuPct >= 85).length;
    if (cpuHigh >= Math.max(5, rs.length * 0.2)) add("warning", "cpu", "Server process CPU was saturated", `CPU of the server process was at or above 85% of one core for ${cpuHigh} of ${rs.length} seconds. Node.js handles requests on one thread, so this is a likely bottleneck.`, { peak: res.peak && res.peak.cpuPct });
    if (res.peak && res.peak.lagP95Ms >= 50) add("warning", "event-loop", "Event-loop delay was high", `The event loop was delayed up to ${res.peak.lagP95Ms} ms (p95 in a one-second window). Requests queue behind synchronous work such as password hashing, large JSON or database calls.`, { lagP95Ms: res.peak.lagP95Ms });
    const q = Math.floor(rs.length / 4); const r0 = avg(rs.slice(0, q).map((x) => x.rssMb)), r1 = avg(rs.slice(-q).map((x) => x.rssMb));
    if (r0 && r1 && r1 > r0 * 1.3 && r1 - r0 > 30) add("info", "memory", "Server memory grew during the run", `Resident memory rose from about ${round(r0, 0)} MB to ${round(r1, 0)} MB. Short runs naturally grow as caches warm; a soak run that keeps growing points to a leak.`, { from: round(r0, 0), to: round(r1, 0) });
    if (res.peak && res.peak.walMb >= 64) add("info", "database", "The database write-ahead log grew large", `The WAL reached ${res.peak.walMb} MB. Write-heavy runs on SQLite may be limited by checkpointing.`, null);
  } else add("info", "resources", "Server resource metrics are not available for this run", (res && res.reason) || "They are only measured when the server under test is the local one.", null);

  /* ---- error patterns */
  const kinds = s.errorKinds || {};
  if (kinds.http5xx > 0) add("critical", "errors", "Server errors (5xx) occurred", `${kinds.http5xx} request(s) returned a 5xx status. These are application faults, not load-test artefacts.`, kinds);
  if (kinds.timeout > 0) add("warning", "errors", "Requests timed out", `${kinds.timeout} request(s) got no response within ${cfg.timeoutMs} ms.`, null);
  if (kinds.network > 0) add("warning", "errors", "Connection failures", `${kinds.network} request(s) failed to connect or were reset.`, null);
  if (s.security && s.security.leaks > 0) add("critical", "security", "Authorization leaks detected", `${s.security.leaks} negative check(s) succeeded where the server must refuse: ${s.security.byCheck.filter((c) => c.leaks).map((c) => c.check).join("; ")}.`, s.security.leakList);
  const slowJourney = (s.scenarios || []).filter((x) => x.iterations >= 10 && x.completionPct != null && x.completionPct < 95);
  for (const j of slowJourney) add("warning", "journeys", `Journey "${j.key}" completes only ${j.completionPct}% of the time`, "Some requests inside the journey failed unexpectedly.", { iterations: j.iterations });
  if (s.generator && s.generator.cpuPct > 80) add("warning", "generator", "The load generator itself was busy", "Its CPU was above 80%, so client-side delay may be included in the numbers. Use a stronger machine or fewer users.", s.generator);
  if (!obs.some((o) => o.severity !== "info")) add("info", "summary", "No bottleneck indicators found", "No saturation, drift, resource or error signals were detected at this load level. This does not prove the system is fast at higher loads.", null);

  return { slowestEndpoints: slowest, highestErrorEndpoints: errorProne, byRole, byScenario, byStage, bottlenecks: obs };
}
module.exports = { analyze };
