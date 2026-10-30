"use strict";
// The load generator. It runs in its OWN process (see worker.js) so that generating load does not slow the server being tested.
// Concurrency is bounded: a "virtual user" is one async loop, there is never more than `hardMaxUsers` of them,
// and each runs one request at a time. Nothing here can fire requests outside those loops.
const { performance } = require("perf_hooks");
const { Rng } = require("./rng");
const { Metrics } = require("./metrics");
const { stagesOf, targetUsers, phaseAt } = require("./profile");
const { SCENARIOS, PERSONAS } = require("./scenarios");
const security = require("./security");

class SetupError extends Error {}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Engine {
  /**
   * @param cfg       a validated configuration
   * @param baseUrl   origin of the target, e.g. http://127.0.0.1:8080
   * @param accounts  [{persona, email, password, id}] dedicated test accounts (kept in memory only)
   */
  constructor({ config, baseUrl, accounts, tag = "[LOADTEST]", seed, hardMaxUsers = 200, maxRequests = 500000, fetchImpl, onSnapshot, snapshotEveryMs = 1000,
                abort = { errorRatePct: 50, minRequests: 200 }, controllerMs = 200 }) {
    this.cfg = config; this.base = baseUrl.replace(/\/+$/, ""); this.accounts = accounts; this.tag = tag;
    this.seed = seed != null ? seed >>> 0 : (config.seed != null ? config.seed >>> 0 : (Math.random() * 4294967296) >>> 0);
    this.rng = new Rng(this.seed);
    this.hardMax = Math.min(hardMaxUsers, config.maxUsers); this.maxRequests = maxRequests;
    this.fetch = fetchImpl || globalThis.fetch; this.onSnapshot = onSnapshot || (() => {}); this.snapEvery = snapshotEveryMs;
    this.abortRule = abort; this.controllerMs = controllerMs;
    this.m = new Metrics(); this.pool = Object.fromEntries(PERSONAS.map((p) => [p, []]));
    this.stages = stagesOf(this.cfg); this.registry = []; this.orgData = new Map();
    this.vus = new Set(); this.nextVu = 0; this.peakActive = 0; this.created = 0;
    this.stopping = null; this.inflight = new Set(); this.target = 0; this.acctCursor = Object.fromEntries(PERSONAS.map((p) => [p, 0]));
    this.setup = { ms: 0, logins: 0 };
    this.runnable = this._runnableScenarios();
  }

  _runnableScenarios() {
    const out = Object.fromEntries(PERSONAS.map((p) => [p, []]));
    for (const s of SCENARIOS) {
      if (!this.cfg.includeWrites && s.writes) continue;
      const w = this.cfg.scenarioWeights[s.key] != null ? this.cfg.scenarioWeights[s.key] : s.weight;
      if (w > 0) out[s.persona].push({ ...s, w });
    }
    return out;
  }

  /* ------------------------------------------------------------------ http */
  async _request(method, path, { token, body, expect, tpl, scenario, persona, countAsLoad = true, timeoutMs = this.cfg.timeoutMs, probe = null }) {
    if (!path.startsWith("/api/")) throw new Error("Refusing to call a path outside /api/");
    const key = `${method} ${tpl || path.split("?")[0]}`;
    const ctl = new AbortController(); let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, timeoutMs);
    this.inflight.add(ctl);
    const t0 = performance.now();
    let status = 0, json = null, outcome = "ok", message = "";
    try {
      const res = await this.fetch(this.base + path, {
        method, redirect: "manual", signal: ctl.signal,
        headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: "Bearer " + token } : {}), "X-Load-Test": "1" },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      status = res.status;
      const text = await res.text();
      if (text && (res.headers.get("content-type") || "").includes("json")) { try { json = JSON.parse(text); } catch (e) {} }
      const good = expect ? expect.includes(status) : status >= 200 && status < 300;
      outcome = good ? "ok" : "http";
      if (!good) message = (json && json.message) || (status >= 300 && status < 400 ? "Unexpected redirect" : `HTTP ${status}`);
    } catch (e) {
      outcome = timedOut ? "timeout" : "network"; message = timedOut ? `No response within ${timeoutMs} ms` : (e && e.cause && e.cause.code) || (e && e.name) || "Network error";
      if (!timedOut && this.stopping === "now") { clearTimeout(timer); this.inflight.delete(ctl); return { ok: false, status: 0, json: null, aborted: true }; }
    }
    clearTimeout(timer); this.inflight.delete(ctl);
    const ms = performance.now() - t0;
    if (probe) {
      // 2xx on something that must be refused = leak; any 4xx = refused correctly; everything else = the server could not answer
      const verdict = outcome === "timeout" || outcome === "network" ? "error" : status >= 200 && status < 300 ? "leak" : status >= 400 && status < 500 ? "denied" : "error";
      this.m.recordSecurity({ check: probe, key: `${method} ${tpl || path.split("?")[0]}`, persona, status, outcome: verdict === "error" && outcome === "ok" ? "http" : outcome, ms, verdict, message });
      this._budget();
      return { ok: verdict === "denied", status, json, probe: verdict };
    }
    if (countAsLoad) {
      this.m.record({ key, scenario, persona, status, outcome, ms, ok: outcome === "ok", message });
      this._budget();
    }
    return { ok: outcome === "ok", status, json };
  }
  // hard request budget: checked on every request, not once a second, so a fast target cannot overshoot it
  _budget() { if (this.m.totals.requests + this.m.security.checks >= this.maxRequests && !this.stopping) { this.safety = true; this.stop("graceful", `Request limit reached (${this.maxRequests})`); } }

  /* ------------------------------------------------------------------ setup: sign the test accounts in once */
  async _signIn() {
    const t0 = performance.now(); const failures = [];
    let i = 0;
    const worker = async () => {
      while (i < this.accounts.length) {
        const a = this.accounts[i++];
        const r = await this._request("POST", "/api/auth/login", { body: { email: a.email, password: a.password }, countAsLoad: false, timeoutMs: Math.max(this.cfg.timeoutMs, 10000) });
        if (r.ok && r.json && r.json.token) { this.pool[a.persona].push({ token: r.json.token, id: r.json.accountId || a.id, email: a.email, password: a.password, org: a.org || 0, orgId: a.orgId, vendorId: a.vendorId || null }); this.setup.logins++; }
        else failures.push(`${a.persona} account ${a.email.replace(/^(.).*(@.*)$/, "$1***$2")}: ${r.status ? "HTTP " + r.status : "no response"}`);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    this.setup.ms = Math.round(performance.now() - t0);
    if (failures.length) throw new SetupError(`Could not sign in ${failures.length} test account(s) on the target: ${failures.slice(0, 3).join("; ")}. Check that the test accounts exist there and the credentials are correct.`);
    for (const a of this.pool.technician) this._org(a.org).technicianIds.push(a.id);
    for (const a of this.pool.vendor) if (a.vendorId) this._org(a.org).vendorId = a.vendorId;
    this.missing = [];
    for (const p of Object.keys(this.runnable)) if (!this.pool[p].length) { if ((this.cfg.personaWeights[p] || 0) > 0) this.missing.push(p); this.runnable[p] = []; }
    if (!Object.entries(this.cfg.personaWeights).some(([p, w]) => w > 0 && this.runnable[p].length)) throw new SetupError("No user type with a weight above 0 has any runnable scenario or test account. Enable a persona or allow scenarios that write.");
  }

  _org(i) { let o = this.orgData.get(i); if (!o) { o = { technicianIds: [], vendorId: null }; this.orgData.set(i, o); } return o; }

  /* ------------------------------------------------------------------ virtual users */
  // A virtual user is one SESSION: it signs in once, runs a random number of journeys, then leaves. The controller
  // replaces it with a new user (new random persona, new sign-in), so people come and go like they do in real life.
  _spawn() {
    const id = ++this.nextVu, rng = this.rng.fork(id);
    const personas = PERSONAS.filter((p) => this.runnable[p].length && this.cfg.personaWeights[p] > 0);
    const persona = rng.weighted(personas, (p) => this.cfg.personaWeights[p]);
    const acct = this.pool[persona][(this.acctCursor[persona]++) % this.pool[persona].length];
    const cfg = this.cfg;
    const vu = { id, persona, rng, token: null, acct, retire: false, wake: null, credit: {}, done: null, busy: false, errs: 0,
                 left: rng.int(cfg.sessionMinIterations, Math.max(cfg.sessionMinIterations, cfg.sessionMaxIterations)) };
    this.vus.add(vu); this.peakActive = Math.max(this.peakActive, this.vus.size);
    vu.done = this._loop(vu).catch((e) => { this.m.record({ key: "INTERNAL", status: 0, outcome: "network", ms: 0, ok: false, message: String(e && e.message) }); }).finally(() => this.vus.delete(vu));
  }
  _vuSleep(vu, ms) { return new Promise((resolve) => { const t = setTimeout(resolve, ms); vu.wake = () => { clearTimeout(t); resolve(); }; }); }

  /** One sign-in per session (and one more only if a token is refused). Returns false when it could not sign in. */
  async _signInSession(vu, relogin = false) {
    const l = await this._request("POST", "/api/auth/login", { body: { email: vu.acct.email, password: vu.acct.password }, scenario: "session", persona: vu.persona });
    if (l.ok && l.json && l.json.token) { vu.token = l.json.token; this.m.sessionStarted(vu.persona, relogin); return true; }
    return false;
  }

  _pickScenario(vu) {
    const list = this.runnable[vu.persona]; const r = this.cfg.randomization / 100;
    if (vu.rng.chance(r)) return vu.rng.weighted(list, (s) => s.w);
    // predictable mode: smooth weighted round-robin, so weights are still honoured exactly over time
    let best = null, total = 0;
    for (const s of list) { vu.credit[s.key] = (vu.credit[s.key] || 0) + s.w; total += s.w; if (!best || vu.credit[s.key] > vu.credit[best.key]) best = s; }
    vu.credit[best.key] -= total; return best;
  }

  /** Think-time range for an action kind: explicit per-kind ranges if configured, otherwise the base range scaled (forms take longer than reads). */
  _thinkRange(kind) {
    const k = this.cfg.thinkKinds && this.cfg.thinkKinds[kind]; if (k) return k;
    const f = { read: 1, form: 3, review: 2 }[kind] || 1;
    return [this.cfg.thinkMinMs * f, this.cfg.thinkMaxMs * f];
  }

  _context(vu, scenario) {
    const eng = this, cfg = this.cfg, r = cfg.randomization / 100, od = this._org(vu.acct.org);
    const think = async (kind = "read") => {
      const [lo, hi] = eng._thinkRange(kind);
      const mid = (lo + hi) / 2, half = (hi - lo) / 2;
      const ms = Math.max(0, mid + (vu.rng.next() * 2 - 1) * half * r);
      if (ms > 0 && !vu.retire && !eng.stopping) await eng._vuSleep(vu, ms);
    };
    const send = async (method, path, body, o) => {
      let res = await eng._request(method, path, { token: vu.token, body, expect: o.expect, tpl: o.tpl, scenario: scenario.key, persona: vu.persona });
      if (res.status === 401 && !eng.stopping && !vu.retire) {   // the token expired or was refused: sign in again once, then retry
        if (await eng._signInSession(vu, true)) res = await eng._request(method, path, { token: vu.token, body, expect: o.expect, tpl: o.tpl, scenario: scenario.key, persona: vu.persona });
      }
      if (!res.ok) vu.errs++;
      return res;
    };
    const foreign = (pred) => { const c = eng.registry.filter(pred); return c.length ? vu.rng.pick(c) : null; };
    return {
      rng: vu.rng, r, tag: eng.tag, persona: vu.persona, technicianIds: od.technicianIds, vendorId: od.vendorId,
      get: (path, o = {}) => send("GET", path, undefined, o),
      post: (path, body, o = {}) => send("POST", path, body, o),
      think,
      uniq: () => `${vu.id}-${vu.rng.int(1000, 9999)}`,
      optional: (factor = 1) => vu.rng.chance(Math.min(1, Math.max(0, (cfg.optionalPct / 100) * factor * (1 + (vu.rng.next() - 0.5) * r)))),
      choose: (arr) => (arr.length ? (vu.rng.chance(r) ? vu.rng.pick(arr) : arr[0]) : undefined),
      takeCreate: () => (eng.created < cfg.maxCreates ? (eng.created++, true) : false),
      created: (id) => { eng.registry.push({ id, org: vu.acct.org, owner: vu.acct.id }); if (eng.registry.length > 300) eng.registry.shift(); },
      anyCreated: () => foreign(() => true),
      foreignOrgCreated: () => foreign((x) => x.org !== vu.acct.org),
      otherTenantCreated: () => foreign((x) => x.org === vu.acct.org && x.owner !== vu.acct.id),
      /** A negative authorization check: see security.js. */
      probe: (check, method, path, o = {}) => eng._request(method, path, { token: o.token === false ? undefined : vu.token, body: o.body, tpl: o.tpl, scenario: "security", persona: vu.persona, probe: check }),
      async anyOrder(fns) {
        const order = vu.rng.chance(r) ? vu.rng.shuffle(fns) : fns;
        for (let i = 0; i < order.length; i++) { if (vu.retire || eng.stopping) return; await order[i](); if (i < order.length - 1) await think(); }
      },
    };
  }

  async _loop(vu) {
    const cfg = this.cfg, r = cfg.randomization / 100;
    // stagger arrivals so users do not move in lock-step - except inside a spike, where the sudden arrival IS the test
    if (this.m.stageName !== "spike") { const wait = vu.rng.range(0, Math.min(2000, Math.max(200, cfg.pacingMs * 2))); if (wait > 0) await this._vuSleep(vu, wait); }
    if (vu.retire || this.stopping) return;
    if (!(await this._signInSession(vu))) { await this._vuSleep(vu, 1000); return; }   // the controller will replace this user
    while (!vu.retire && !this.stopping) {
      const scenario = this._pickScenario(vu); if (!scenario) break;
      const errorsBefore = vu.errs, t0 = performance.now();
      if (cfg.loginPct > 0 && vu.rng.chance(cfg.loginPct / 100)) await this._signInSession(vu, true);
      vu.busy = true;
      try { await scenario.run(this._context(vu, scenario)); }
      catch (e) { this.m.record({ key: `SCENARIO ${scenario.key}`, scenario: scenario.key, persona: vu.persona, status: 0, outcome: "network", ms: 0, ok: false, message: String(e && e.message) }); }
      if (this.stopping === "now") { vu.busy = false; break; }
      this.m.iteration({ key: scenario.key, persona: vu.persona, ms: performance.now() - t0, failed: vu.errs > errorsBefore });
      if (cfg.securityPct > 0 && !vu.retire && !this.stopping && vu.rng.chance(cfg.securityPct / 100)) {
        const checks = security.forPersona(vu.persona);
        if (checks.length) { try { await vu.rng.pick(checks).run(this._context(vu, { key: "security" })); } catch (e) { /* a probe that cannot run is simply skipped */ } }
      }
      vu.busy = false;
      if (--vu.left <= 0) break;                       // this session is over; the user leaves and a new one will arrive
      if (vu.retire || this.stopping) break;
      const pace = Math.max(0, cfg.pacingMs * (1 + (vu.rng.next() * 2 - 1) * 0.5 * r));
      if (pace > 0) await this._vuSleep(vu, pace);
    }
  }

  /* ------------------------------------------------------------------ control */
  stop(mode = "graceful", reason = "Stopped by user") {
    if (!this.stopping) { this.stopping = mode; this.stopReason = reason; }
    else if (mode === "now" && this.stopping !== "now") this.stopping = "now";
    for (const vu of this.vus) { vu.retire = true; if (vu.wake) vu.wake(); }
    if (this.stopping === "now") for (const c of this.inflight) c.abort();
  }
  _control(elapsed) {
    const want = this.stopping ? 0 : Math.min(this.hardMax, targetUsers(this.cfg, elapsed, this.stages));
    this.target = want; this.m.setStage(phaseAt(this.cfg, elapsed, this.stages), want);
    const live = [...this.vus].filter((v) => !v.retire);
    if (live.length < want) { for (let i = live.length; i < want && this.vus.size < this.hardMax; i++) this._spawn(); }
    else if (live.length > want) {
      const surplus = live.sort((a, b) => b.id - a.id).slice(0, live.length - want);
      for (const v of surplus) { v.retire = true; if (v.wake) v.wake(); }
    }
  }

  snapshot(elapsed, final = false) {
    const s = this.m.summary(elapsed);
    const cpu = process.cpuUsage(); const now = performance.now();
    const cpuPct = this._cpuPrev ? Math.round(((cpu.user + cpu.system - this._cpuPrev.v) / 1000 / Math.max(1, now - this._cpuPrev.t)) * 1000) / 10 : 0;
    this._cpuPrev = { v: cpu.user + cpu.system, t: now };
    return { ...s, phase: final ? "finished" : phaseAt(this.cfg, elapsed, this.stages), stagesPlan: this.stages.map((x) => ({ name: x.name, start: x.start, end: x.end, kind: x.kind, from: x.from, to: x.to })), missingPersonas: this.missing || [], targetUsers: this.target, activeUsers: this.vus.size, peakActiveUsers: this.peakActive,
      createdRecords: this.created, seed: this.seed, setup: this.setup, generator: { cpuPct, rssMb: Math.round(process.memoryUsage().rss / 1048576) },
      timeline: final ? this.m.timeline : this.m.timeline.slice(-600), stopping: this.stopping || null };
  }

  /* ------------------------------------------------------------------ run */
  async run() {
    await this._signIn();
    const total = this.cfg.durationSec * 1000, t0 = performance.now();
    let nextSnap = this.snapEvery, nextTick = 1000, tickNo = 0;
    for (;;) {
      const elapsedMs = performance.now() - t0, elapsed = elapsedMs / 1000;
      if (elapsedMs >= total || this.stopping) break;
      this._control(elapsed);
      if (elapsedMs >= nextTick) {
        nextTick += 1000; tickNo++;
        const pt = this.m.tick(tickNo, this.target, this.vus.size, { busy: [...this.vus].filter((v) => v.busy).length, sessions: [...this.vus].filter((v) => v.token).length });
        const t = this.m.totals;
        if (t.requests >= this.abortRule.minRequests && (t.failed / t.requests) * 100 > this.abortRule.errorRatePct) this.stop("graceful", `Safety stop: error rate above ${this.abortRule.errorRatePct}% (${t.failed} of ${t.requests} requests failed)`), this.safety = true;
        else if (t.requests + this.m.security.checks >= this.maxRequests) this.stop("graceful", `Request limit reached (${this.maxRequests})`), this.safety = true;
      }
      if (elapsedMs >= nextSnap) { nextSnap += this.snapEvery; this.onSnapshot(this.snapshot(elapsed)); }
      await sleep(this.controllerMs);
    }
    // wind down: every user finishes its current request, nobody starts a new one
    if (!this.stopping) this.stopping = "finishing";
    for (const vu of this.vus) { vu.retire = true; if (vu.wake) vu.wake(); }
    this.target = 0;
    const grace = this.stopping === "now" ? 1500 : this.cfg.timeoutMs + 2000;
    await Promise.race([Promise.allSettled([...this.vus].map((v) => v.done)), sleep(grace)]);
    for (const c of this.inflight) c.abort();
    await sleep(50);
    const elapsed = (performance.now() - t0) / 1000;
    if (this.m.sec.reqs || this.m.sec.lat.length) this.m.tick(tickNo + 1, 0, this.vus.size, { busy: 0, sessions: 0 });
    const early = !!this.stopReason && this.stopping !== "finishing";
    const snap = this.snapshot(elapsed, true);
    snap.activeUsers = this.vus.size;
    return { snapshot: snap, stoppedEarly: early, stopReason: early ? this.stopReason : null, safetyStop: !!this.safety, leakedUsers: this.vus.size };
  }
}
module.exports = { Engine, SetupError };
