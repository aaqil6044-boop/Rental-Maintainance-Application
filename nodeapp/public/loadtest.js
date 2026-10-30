(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var auth = null;
  try { auth = JSON.parse(localStorage.getItem('eo_auth') || 'null'); } catch (e) {}
  if (!auth || !auth.token) { location.replace('login.html'); return; }

  /* ---------------- http ---------------- */
  function api(path, o) {
    o = o || {}; var h = { Authorization: 'Bearer ' + auth.token }, body = o.body;
    if (body !== undefined) { h['Content-Type'] = 'application/json'; body = JSON.stringify(body); }
    return fetch('/api' + path, { method: o.method || (body !== undefined ? 'POST' : 'GET'), headers: h, body: body }).then(function (res) {
      if (res.status === 401) { try { localStorage.removeItem('eo_auth'); } catch (e) {} location.replace('login.html'); throw new Error('Your session has ended.'); }
      return res.text().then(function (t) {
        var d = null; if (t) { try { d = JSON.parse(t); } catch (e) {} }
        if (!res.ok) { var err = new Error((d && d.message) || 'Request failed (' + res.status + ').'); err.status = res.status; err.data = d; throw err; }
        return d;
      });
    });
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function flash(msg, ok) { var f = $('flash'); f.textContent = msg || ''; f.className = 'alert' + (ok ? ' alert--ok' : ''); if (msg) window.scrollTo({ top: 0, behavior: 'smooth' }); }
  function nf(n, d) { return n == null || isNaN(n) ? '—' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: d == null ? 0 : d }); }
  function ms(n) { return n == null ? '—' : (n >= 1000 ? nf(n / 1000, 2) + ' s' : nf(n, n < 10 ? 1 : 0) + ' ms'); }
  function dur(s) { s = Math.round(s || 0); return s >= 60 ? Math.floor(s / 60) + ' min ' + (s % 60 ? (s % 60) + ' s' : '') : s + ' s'; }

  /* ---------------- state ---------------- */
  var setup = null, form = null, errors = {}, serverProfile = null, runId = null, run = null, timer = null, history = [], picked = {}, cmp = null, reg = null, regFor = null, regBase = 'previous', trendData = null, dataCheck = null;
  var DUR_UNIT = { durationSec: 's', rampUpSec: 's', rampDownSec: 's' };
  var PRESETS = [
    ['Smoke', 'A quick check that everything works: a few users for under a minute.', { name: 'Smoke test', durationSec: 30, startUsers: 1, maxUsers: 3, rampUpSec: 8, rampDownSec: 5 }],
    ['Load', 'Typical busy period: a steady crowd for several minutes.', { name: 'Load test', durationSec: 300, startUsers: 5, maxUsers: 30, rampUpSec: 60, rampDownSec: 30 }],
    ['Stress', 'Push past normal to see where it bends. Raise limits first if needed.', { name: 'Stress test', profile: 'step', steps: 5, durationSec: 600, startUsers: 10, maxUsers: 100, rampUpSec: 180, rampDownSec: 60 }],
    ['Spike', 'A sudden jump to the maximum and back, to test recovery.', { name: 'Spike test', profile: 'spike', durationSec: 120, startUsers: 3, maxUsers: 40, rampUpSec: 0, rampDownSec: 20, spikeAtSec: 30, spikeSec: 20 }],
    ['Soak', 'Moderate steady load for a long time, to expose leaks and drift.', { name: 'Soak test', profile: 'soak', durationSec: 1800, startUsers: 5, maxUsers: 20, rampUpSec: 120, rampDownSec: 60 }]
  ];
  var PERSONAS = ['tenant', 'manager', 'technician', 'vendor', 'admin'];
  var PNAME = { tenant: 'Tenant', manager: 'Property manager', technician: 'Technician', vendor: 'Vendor', admin: 'Admin' };
  var TIPS = {
    name: 'A descriptive name so you can find this run later.',
    target: 'Only environments an administrator has configured. This server is always available. Anything else needs LOADTEST_ALLOW_REMOTE and a typed confirmation.',
    durationSec: 'TOTAL time of the test. Ramp-up and ramp-down are INCLUDED in it; the remainder is the steady state.',
    maxUsers: 'Most virtual users active at once. A hard server-side cap applies even if you type a bigger number.',
    startUsers: 'Virtual users active at second 0. Rises to the maximum during ramp-up.',
    rampUpSec: 'How long it takes to go from the starting users to the maximum. Counts toward the total duration.',
    rampDownSec: 'How long users are reduced to zero at the end. Counts toward the total duration.',
    pacingMs: 'Average pause after a user finishes one scenario, before the next one starts. Varied by the randomization level.',
    thinkMinMs: 'Shortest pause between actions inside one scenario, imitating a person reading a screen.',
    thinkMaxMs: 'Longest pause between actions inside one scenario.',
    timeoutMs: 'A request with no response after this long is counted as a timeout and as a failure.',
    randomization: '0 = every user follows the same predictable order and think time. 100 = scenario choice, action order, data and timings all vary. Always within valid workflows.',
    seed: 'Optional. The same seed repeats the same choices, so two runs can be compared on like-for-like traffic. Leave empty for a different mix each time.',
    maxErrorRatePct: 'The run FAILS its verdict if more than this share of requests fail. Completing is not the same as passing.',
    maxP95Ms: '95% of requests must be faster than this, or the verdict fails. Leave empty to ignore.',
    maxP99Ms: '99% of requests must be faster than this. Leave empty to ignore.',
    minRps: 'Average throughput must reach at least this. Leave empty to ignore.',
    loginPct: 'Share of scenario runs that start with a fresh sign-in, as returning users do.',
    optionalPct: 'Base chance that optional actions (add a comment, open a second request, attach an expense) happen.',
    includeWrites: 'Allow scenarios that create or update records. They only ever touch records titled “[LOADTEST r…]” made by load-test accounts.',
    maxCreates: 'Hard cap on records created by the whole run. Writes stop at this number, so repeated tests cannot grow the database without limit.',
    cleanupAfter: 'Delete this run’s test records when it ends. Real records are never touched either way.',
    personaWeights: 'How virtual users are split between the user types. Each uses only what its role may do. Owner is not available: EstateOps has no owner account role yet.',
    profile: 'Linear: straight ramp up, hold, ramp down. Step: climbs in flat plateaus to find where it breaks. Spike: sudden jump and recovery. Soak: long steady load to find drift and leaks. Custom: your own stages.',
    steps: 'How many flat plateaus the ramp-up is divided into.',
    spikeAtSec: 'Second at which users jump to the maximum. Leave empty for automatic.',
    spikeSec: 'How long the peak lasts. Leave empty for automatic.',
    stagesText: 'One stage per line: a duration and a number of users, for example “30s 10”. Users move in a straight line from the previous stage’s level. The total duration is the sum of the stages.',
    orgs: 'Number of independent test organizations. More than 1 gives real multi-tenant traffic and lets the authorization checks try to cross from one organization into another.',
    securityPct: 'Share of journeys that also run a negative authorization check (a request that MUST be refused). Refusals are a pass and never count as errors; a success is reported as a leak.',
    sessionMinIterations: 'A session ends after a random number of journeys in this range; the user leaves and a new one arrives, who signs in once.',
    sessionMaxIterations: 'Upper end of the session length.',
    scenarioWeights: 'Relative frequency of each scenario within its user type. Empty uses the built-in weight; 0 turns it off.'
  };
  var TIPKEYS = TIPS;

  function defaultsForm(cfg) {
    var d = JSON.parse(JSON.stringify(cfg.defaults)); d.seed = ''; d.thresholds.maxP99Ms = ''; d.thresholds.minRps = ''; d.confirmTarget = ''; d.scenarioWeights = {}; d.spikeAtSec = ''; d.spikeSec = ''; d.stagesText = '30s 3\n60s 8\n30s 8\n20s 0'; d.regressionRules = null; return d;
  }
  var unit = function (k, v) { return DUR_UNIT[k] === 'min' ? v / 60 : v; };

  /* ---------------- start ---------------- */
  Promise.all([api('/auth/me'), api('/loadtests/config').catch(function (e) { return { _err: e }; })]).then(function (r) {
    var me = r[0], c = r[1];
    if (me.role !== 'MANAGER' || !me.orgAdmin) { $('app').innerHTML = noAccess('Load testing is available to organization admins only.'); return; }
    if (c._err) { $('app').innerHTML = noAccess(c._err.message); return; }
    setup = c; form = defaultsForm(c);
    if (!c.enabled) { $('app').innerHTML = '<div class="callout callout--warn">Load testing is switched off on this server. An administrator can enable it with <code>LOADTEST_ENABLED=1</code>.</div>'; return; }
    render(); refreshHistory(true); validateSoon();
  }).catch(function (e) { $('app').innerHTML = noAccess(e.message); });
  function noAccess(m) { return '<section class="panel"><div class="empty"><h3>Not available</h3><p>' + esc(m) + '</p><p><a class="btn btn--sm" href="app.html">Back to EstateOps</a></p></div></section>'; }

  /* ---------------- form ---------------- */
  function help(k) { return '<button type="button" class="help" data-tip="' + esc(TIPS[k]) + '" aria-label="About this setting: ' + esc(TIPS[k]) + '">?</button>'; }
  function lab(id, text, k, unitText) { return '<div class="fl"><label for="' + id + '">' + text + '</label>' + (k ? help(k) : '') + (unitText ? '<span class="unit">' + unitText + '</span>' : '') + '</div>'; }
  function errBox(k) { return '<div class="ferr" id="e_' + k + '" role="alert"></div>'; }
  function numField(k, text, unitText, o) {
    o = o || {}; var v = o.th ? form.thresholds[k] : form[k];
    return '<div>' + lab('f_' + k, text, k, unitText) + '<input class="field" id="f_' + k + '" data-k="' + k + '"' + (o.th ? ' data-th="1"' : '') + ' type="number" inputmode="numeric" min="0" step="1" value="' + esc(v == null ? '' : v) + '"' + (o.ph ? ' placeholder="' + o.ph + '"' : '') + ' aria-describedby="e_' + k + '">' + errBox(o.th ? 'thresholds.' + k : k) + '</div>';
  }
  function slideField(k, text, unitText, max) {
    return '<div>' + lab('f_' + k, text, k, unitText) + '<div class="slide"><input type="range" data-k="' + k + '" data-slider="1" min="' + (k === 'randomization' ? 0 : 1) + '" max="' + max + '" step="1" value="' + form[k] + '" aria-label="' + text + ' slider"><input class="field" id="f_' + k + '" data-k="' + k + '" type="number" min="0" step="1" value="' + form[k] + '" aria-describedby="e_' + k + '"></div>' + errBox(k) + '</div>';
  }
  function durField(k, text) {
    var u = DUR_UNIT[k], v = unit(k, form[k]);
    return '<div>' + lab('f_' + k, text, k) + '<div class="durbox"><input class="field" id="f_' + k + '" data-k="' + k + '" data-dur="1" type="number" min="0" step="any" value="' + esc(v) + '" aria-describedby="e_' + k + '"><select class="field" data-unit="' + k + '" aria-label="' + text + ' unit"><option value="s"' + (u === 's' ? ' selected' : '') + '>seconds</option><option value="min"' + (u === 'min' ? ' selected' : '') + '>minutes</option></select></div>' + errBox(k) + '</div>';
  }
  function profileExtra() {
    if (form.profile === 'step') return numField('steps', 'Number of steps', 'plateaus');
    if (form.profile === 'spike') return numField('spikeAtSec', 'Spike starts at', 'seconds, optional') + numField('spikeSec', 'Spike lasts', 'seconds, optional');
    if (form.profile === 'custom') return '<div style="grid-column:1/-1">' + lab('f_stagesText', 'Stages', 'stagesText', 'duration users, one per line') + '<textarea class="field" id="f_stagesText" data-k="stagesText" rows="5" spellcheck="false">' + esc(form.stagesText) + '</textarea>' + errBox('stages') + '<p class="hint">Total duration becomes the sum of the stages; ramp-up and ramp-down below are ignored.</p></div>';
    return '<div></div>';
  }
  function render() {
    var L = setup.limits;
    var target = '<div>' + lab('f_target', 'Target environment', 'target') + '<select class="field" id="f_target" data-k="target">' + setup.targets.map(function (t) { return '<option value="' + esc(t.name) + '"' + (t.name === form.target ? ' selected' : '') + (t.available ? '' : ' disabled') + '>' + esc(t.label) + (t.available ? '' : ' — unavailable') + '</option>'; }).join('') + '</select>' + errBox('target') + '<div id="remoteBox"></div></div>';
    var scn = PERSONAS.map(function (p) {
      return '<div class="fl" style="margin-top:12px"><b style="font-size:13px">' + PNAME[p] + ' scenarios</b></div><div class="scn">' + setup.scenarios.filter(function (s) { return s.persona === p; }).map(function (s) {
        return '<div class="nm"><span>' + esc(s.label.replace(/^[^:]+:\s*/, '')) + (s.writes ? '<span class="tag tag--w">writes</span>' : '<span class="tag">read-only</span>') + '</span><small>' + esc(s.description) + ' Default weight ' + s.defaultWeight + '.</small><small>' + esc(s.endpoints.join(' · ')) + '</small></div><input class="field" data-scn="' + esc(s.key) + '" type="number" min="0" step="1" placeholder="' + s.defaultWeight + '" value="' + esc(form.scenarioWeights[s.key] == null ? '' : form.scenarioWeights[s.key]) + '" aria-label="Weight of ' + esc(s.label) + '">';
      }).join('') + '</div>';
    }).join('');
    $('app').innerHTML =
      '<div class="lt-grid"><section class="panel" aria-labelledby="cfgh"><div class="panel-bar"><h2 id="cfgh">Configure a test</h2><div class="grow presets"><span class="lbl">Start from</span>' +
      PRESETS.map(function (p, i) { return '<button type="button" class="btn btn--sm btn--line" data-preset="' + i + '" data-tip="' + esc(p[1] + ' (An illustration — edit freely.)') + '">' + p[0] + '</button>'; }).join('') + '</div></div>' +
      '<form id="cfg" novalidate autocomplete="off">' +
      '<div class="fgroup"><fieldset class="fieldset"><legend>1 · What to test</legend><div class="f2"><div>' + lab('f_name', 'Test name', 'name') + '<input class="field" id="f_name" data-k="name" maxlength="80" value="' + esc(form.name) + '" aria-describedby="e_name">' + errBox('name') + '</div>' + target + '</div></fieldset></div>' +
      '<div class="fgroup"><fieldset class="fieldset"><legend>2 · Users and time</legend><div class="f2"><div>' + lab('f_profile', 'Load profile', 'profile') + '<select class="field" id="f_profile" data-k="profile">' + ['linear', 'step', 'spike', 'soak', 'custom'].map(function (t) { return '<option value="' + t + '"' + (form.profile === t ? ' selected' : '') + '>' + t[0].toUpperCase() + t.slice(1) + '</option>'; }).join('') + '</select>' + errBox('profile') + '</div>' + profileExtra() + durField('durationSec', 'Total duration') + '<div></div>' + slideField('startUsers', 'Starting users', 'users', L.maxUsers) + slideField('maxUsers', 'Maximum concurrent users', 'cap ' + L.maxUsers, L.maxUsers) + durField('rampUpSec', 'Ramp-up') + durField('rampDownSec', 'Ramp-down') + '</div><p class="hint">Total duration <b>includes</b> ramp-up and ramp-down. Steady state = total − ramp-up − ramp-down.</p></fieldset></div>' +
      '<div class="fgroup"><fieldset class="fieldset"><legend>3 · Pass / fail thresholds</legend><div class="f2">' + numField('maxErrorRatePct', 'Acceptable error rate', '% of requests', { th: 1 }) + numField('maxP95Ms', 'Slowest acceptable p95', 'ms', { th: 1, ph: 'no limit' }) + numField('maxP99Ms', 'Slowest acceptable p99', 'ms', { th: 1, ph: 'no limit' }) + numField('minRps', 'Minimum throughput', 'requests/s', { th: 1, ph: 'no limit' }) + '</div></fieldset></div>' +
      '<details class="adv"><summary>Realism and advanced settings</summary><div class="fgroup" style="border-top:1px solid var(--rule)"><div class="f2">' + numField('pacingMs', 'Request pacing', 'ms between scenario runs') + numField('timeoutMs', 'Request timeout', 'ms') + numField('thinkMinMs', 'Think time, minimum', 'ms') + numField('thinkMaxMs', 'Think time, maximum', 'ms') +
      slideField('randomization', 'Randomization level', '% · 0 predictable, 100 varied', 100) + '<div>' + lab('f_seed', 'Random seed', 'seed', 'optional') + '<input class="field" id="f_seed" data-k="seed" type="number" min="0" step="1" value="' + esc(form.seed) + '" placeholder="different every run" aria-describedby="e_seed">' + errBox('seed') + '</div>' +
      numField('loginPct', 'Extra fresh sign-ins', '% of journeys') + numField('optionalPct', 'Optional-action chance', '%') + numField('orgs', 'Test organizations', '1 to 4') + numField('securityPct', 'Authorization checks', '% of journeys') + numField('sessionMinIterations', 'Session length, minimum', 'journeys') + numField('sessionMaxIterations', 'Session length, maximum', 'journeys') + '</div></div>' +
      '<div class="fgroup"><div class="fl"><b style="font-size:13.5px">Who the virtual users are</b>' + help('personaWeights') + '</div><div class="f3">' + PERSONAS.map(function (p) { return '<div><label for="pw_' + p + '">' + PNAME[p] + ' <span class="opt">weight</span></label><input class="field" id="pw_' + p + '" data-pw="' + p + '" type="number" min="0" step="1" value="' + esc(form.personaWeights[p]) + '"></div>'; }).join('') + '<div><label for="pw_owner">Owner <span class="opt">not available</span></label><input class="field" id="pw_owner" type="number" value="0" disabled aria-describedby="owner_note"></div></div><p class="hint" id="owner_note">The owner user type cannot be simulated: EstateOps has no owner account role yet, so no owner endpoints exist to test.</p>' + errBox('personaWeights') +
      '<div class="fl" style="margin-top:16px"><b style="font-size:13.5px">What they do</b>' + help('scenarioWeights') + '</div>' + errBox('scenarioWeights') + scn + '</div>' +
      '<div class="fgroup"><div class="fl"><b style="font-size:13.5px">Test data</b></div><div class="checks"><label><input type="checkbox" data-k="includeWrites"' + (form.includeWrites ? ' checked' : '') + '> Include scenarios that write</label>' + help('includeWrites') + '<label><input type="checkbox" data-k="cleanupAfter"' + (form.cleanupAfter ? ' checked' : '') + '> Delete test records afterwards</label>' + help('cleanupAfter') + '</div><div class="f2" style="margin-top:12px">' + numField('maxCreates', 'Cap on records created', '≤ ' + L.maxCreates) + '</div></div></details>' +
      '<div class="formfoot"><button type="submit" class="btn" id="startBtn">Start test</button><button type="button" class="btn btn--line btn--sm" id="resetBtn">Reset to defaults</button><span class="grow muted-sm" id="vsum" aria-live="polite"></span></div></form></section>' +
      '<aside class="lt-sticky stack"><section class="panel"><div class="panel-bar"><h2>Planned load profile</h2></div><div class="panel-body prof" id="prof"><p class="muted-sm">Checking…</p></div></section>' +
      '<section class="panel"><div class="panel-bar"><h2>Safety</h2></div><div class="panel-body note">' + safetyNote() + '</div></section></aside></div>' +
      '<div id="runArea"></div><div id="histArea"></div>';
    syncRemote(); drawHistory();
    if (run) drawRun();
  }
  function safetyNote() {
    var L = setup.limits;
    return 'Limits set by the server: <b>' + L.maxUsers + '</b> users, <b>' + dur(L.maxDurationSec) + '</b>, <b>' + nf(L.maxRequests) + '</b> requests per run. Only one test runs at a time. A run stops itself if more than <b>' + L.abortErrorRatePct + '%</b> of requests fail. The <b>Emergency stop</b> button (top right) ends all traffic immediately.' +
      '<br><br>Test traffic uses dedicated <code>loadtest-…@loadtest.invalid</code> accounts and a fixture property. Records it creates are titled <code>[LOADTEST r…]</code>; real records are never read as test data or changed.';
  }
  function syncRemote() {
    var t = setup.targets.filter(function (x) { return x.name === form.target; })[0], box = $('remoteBox'); if (!box) return;
    box.innerHTML = t && t.requiresConfirmation ? '<div class="confirm"><label for="f_confirm">This is not a local target. Type <b>' + esc(t.name) + '</b> to confirm you are authorised to load-test ' + esc(t.host) + '.</label><input class="field" id="f_confirm" data-k="confirmTarget" value="' + esc(form.confirmTarget) + '" autocomplete="off" aria-describedby="e_confirmTarget">' + errBox('confirmTarget') + '</div>' : '';
  }

  /* ---------------- form events ---------------- */
  function setVal(k, raw, el) {
    if (el && el.dataset.th) { form.thresholds[k] = raw === '' ? '' : Number(raw); return; }
    if (el && el.dataset.dur) { var n = raw === '' ? NaN : Number(raw); form[k] = isNaN(n) ? '' : Math.round(DUR_UNIT[k] === 'min' ? n * 60 : n); return; }
    if (el && (el.type === 'number' || el.type === 'range')) form[k] = raw === '' ? (k === 'seed' ? '' : '') : Number(raw);
    else form[k] = raw;
  }
  document.addEventListener('input', function (e) {
    var el = e.target; if (!form || !el.closest || !el.closest('#cfg')) return;
    if (el.dataset.pw) { form.personaWeights[el.dataset.pw] = el.value === '' ? '' : Number(el.value); }
    else if (el.dataset.scn) { if (el.value === '') delete form.scenarioWeights[el.dataset.scn]; else form.scenarioWeights[el.dataset.scn] = Number(el.value); }
    else if (el.dataset.k) {
      if (el.type === 'checkbox') form[el.dataset.k] = el.checked; else setVal(el.dataset.k, el.value, el);
      if (el.dataset.slider || el.type === 'number') { var other = document.querySelectorAll('[data-k="' + el.dataset.k + '"]'); other.forEach(function (o) { if (o !== el && o.type !== 'checkbox') o.value = el.value; }); }
    }
    validateSoon();
  });
  document.addEventListener('change', function (e) {
    var el = e.target; if (!form) return;
    if (el.dataset && el.dataset.unit) { var k = el.dataset.unit; DUR_UNIT[k] = el.value; var inp = $('f_' + k); inp.value = unit(k, form[k]); }
    if (el.dataset && el.dataset.k === 'target') { syncRemote(); validateSoon(); }
    if (el.dataset && el.dataset.k === 'profile') { form.profile = el.value; keepRun(); validateSoon(); }
  });
  document.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('[data-preset]') : null;
    if (b) { var p = PRESETS[Number(b.dataset.preset)][2]; form.profile = 'linear'; form.steps = form.steps || 4; Object.keys(p).forEach(function (k) { form[k] = p[k]; }); form.seed = form.seed; DUR_UNIT.durationSec = p.durationSec >= 120 && p.durationSec % 60 === 0 ? 'min' : 's'; DUR_UNIT.rampUpSec = p.rampUpSec >= 120 && p.rampUpSec % 60 === 0 ? 'min' : 's'; DUR_UNIT.rampDownSec = p.rampDownSec >= 120 && p.rampDownSec % 60 === 0 ? 'min' : 's'; keepRun(); validateSoon(); return; }
    if (e.target.id === 'resetBtn') { form = defaultsForm(setup); DUR_UNIT = { durationSec: 's', rampUpSec: 's', rampDownSec: 's' }; keepRun(); validateSoon(); }
  });
  function keepRun() { var y = window.scrollY; render(); window.scrollTo(0, y); }

  /* ---------------- validation + profile preview ---------------- */
  var vt = null, vseq = 0;
  function payload() {
    var f = JSON.parse(JSON.stringify(form)); f.thresholds = f.thresholds || {};
    Object.keys(f.thresholds).forEach(function (k) { if (f.thresholds[k] === '') f.thresholds[k] = null; });
    if (f.seed === '') f.seed = null; if (!f.confirmTarget) delete f.confirmTarget;
    f.stages = []; if (f.profile === 'custom') f.stages = parseStages(f.stagesText);
    delete f.stagesText; ['spikeAtSec', 'spikeSec'].forEach(function (k) { if (f[k] === '') f[k] = null; });
    return f;
  }
  function parseStages(text) {
    return String(text || '').split(/\n/).map(function (l) { return l.trim(); }).filter(Boolean).map(function (l) {
      var m = /^(\d+(?:\.\d+)?)\s*(s|sec|m|min|h)?\s+(\d+)$/i.exec(l); if (!m) return { durationSec: NaN, users: NaN };
      return { durationSec: Math.round(Number(m[1]) * ({ m: 60, min: 60, h: 3600 }[(m[2] || 's').toLowerCase()] || 1)), users: Number(m[3]) };
    });
  }
  function validateSoon() { clearTimeout(vt); vt = setTimeout(validateNow, 250); }
  function showErrors(list) {
    errors = {}; (list || []).forEach(function (x) { errors[x.field] = (errors[x.field] ? errors[x.field] + ' ' : '') + x.message; });
    document.querySelectorAll('.ferr').forEach(function (n) { n.textContent = ''; });
    document.querySelectorAll('[aria-invalid]').forEach(function (n) { n.removeAttribute('aria-invalid'); });
    Object.keys(errors).forEach(function (f) {
      var box = $('e_' + f); if (box) box.textContent = errors[f];
      var inp = $('f_' + f.replace('thresholds.', '')) || document.querySelector('[data-k="' + f + '"]'); if (inp) inp.setAttribute('aria-invalid', 'true');
    });
  }
  function validateNow() {
    var my = ++vseq;
    api('/loadtests/validate', { body: payload() }).then(function (r) {
      if (my !== vseq) return;
      showErrors(r.errors); serverProfile = r.valid ? r : null;
      var s = $('vsum'); if (s) s.textContent = r.valid ? 'Configuration is valid.' : r.errors.length + ' thing' + (r.errors.length > 1 ? 's' : '') + ' to fix.';
      drawProfile(r);
    }).catch(function (e) { var p = $('prof'); if (p) p.innerHTML = '<p class="ferr">' + esc(e.message) + '</p>'; });
  }
  function drawProfile(r) {
    var p = $('prof'); if (!p) return;
    if (!r.valid) { p.innerHTML = '<div class="na">Fix the highlighted settings to see the planned profile.<ul class="vlist">' + r.errors.slice(0, 4).map(function (e) { return '<li>' + esc(e.message) + '</li>'; }).join('') + '</ul></div>'; return; }
    var pr = r.profile, W = 560, H = 190, pl = 40, pr_ = 12, pt = 12, pb = 26, pts = pr.points, T = pts[pts.length - 1].t || 1, M = Math.max.apply(null, pts.map(function (q) { return q.users; })) || 1;
    var x = function (t) { return pl + (W - pl - pr_) * t / T; }, y = function (u) { return pt + (H - pt - pb) * (1 - u / M); };
    var path = pts.map(function (q, i) { return (i ? 'L' : 'M') + x(q.t).toFixed(1) + ' ' + y(q.users).toFixed(1); }).join(' ');
    var bandSrc = pr.stages && pr.stages.length ? pr.stages.map(function (st, i) { return [st.start, st.end, ['#2a78d6', '#1baf7a', '#eb6834', '#8a94a6'][i % 4]]; }) : [[0, pr.rampUpSec, '#2a78d6'], [pr.rampUpSec, pr.rampUpSec + pr.steadySec, '#1baf7a'], [pr.rampUpSec + pr.steadySec, T, '#eb6834']];
    var bands = bandSrc.filter(function (b) { return b[1] > b[0]; })
      .map(function (b) { return '<rect x="' + x(b[0]).toFixed(1) + '" y="' + pt + '" width="' + (x(b[1]) - x(b[0])).toFixed(1) + '" height="' + (H - pt - pb) + '" fill="' + b[2] + '" opacity=".08"/>'; }).join('');
    var grid = [0, .5, 1].map(function (f) { var v = Math.round(M * f); return '<line x1="' + pl + '" x2="' + (W - pr_) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '" stroke="#e4e4e0"/><text x="' + (pl - 6) + '" y="' + (y(v) + 4).toFixed(1) + '" text-anchor="end" font-size="11" fill="#52514e">' + v + '</text>'; }).join('');
    var xl = [0, .25, .5, .75, 1].map(function (f) { return '<text x="' + x(T * f).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="11" fill="#52514e">' + dur(T * f) + '</text>'; }).join('');
    p.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Planned virtual users over time: ' + pr.rampUpSec + ' seconds ramp-up, ' + pr.steadySec + ' seconds steady, ' + pr.rampDownSec + ' seconds ramp-down, peak ' + M + ' users">' + bands + grid + xl + '<path d="' + path + '" fill="none" stroke="#2a78d6" stroke-width="2.2" stroke-linejoin="round"/></svg>' +
      (pr.stages && pr.stages.length && pr.type !== 'linear' && pr.type !== 'soak' ? '<ul class="warnlist" style="margin:8px 0 0">' + pr.stages.map(function (st) { return '<li>' + esc(st.name) + ': ' + dur(st.end - st.start) + (st.from === st.to ? ', ' + st.to + ' users' : ', ' + st.from + ' → ' + st.to + ' users') + '</li>'; }).join('') + '</ul>' : '<div class="phases" style="display:grid;grid-template-columns:' + [pr.rampUpSec, pr.steadySec, pr.rampDownSec].map(function (v) { return Math.max(v, T * .12) + 'fr'; }).join(' ') + '"><span class="up">Ramp-up ' + dur(pr.rampUpSec) + '</span><span class="st">Steady ' + dur(pr.steadySec) + '</span><span class="dn">Ramp-down ' + dur(pr.rampDownSec) + '</span></div>') +
      '<p class="hint">Total ' + dur(T) + (pr.type === 'linear' || pr.type === 'soak' ? ' = ramp-up + steady + ramp-down' : '') + '. Peak ' + M + ' users.</p>' + (r.warnings.length ? '<ul class="warnlist" style="margin-top:8px">' + r.warnings.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul>' : '');
  }

  /* ---------------- start / control ---------------- */
  document.addEventListener('submit', function (e) {
    if (e.target.id !== 'cfg') return; e.preventDefault(); flash('');
    if (run && run.isLive) { flash('A test is already running. Stop it before starting another.'); return; }
    var btn = $('startBtn'); btn.disabled = true; btn.textContent = 'Starting…';
    api('/loadtests', { body: payload() }).then(function (r) { runId = r.id; run = r; cmp = null; startPolling(); drawRun(); $('runArea').scrollIntoView({ behavior: 'smooth' }); })
      .catch(function (err) {
        if (err.data && err.data.errors) { showErrors(err.data.errors); flash('Some settings need fixing before the test can start.'); }
        else flash(err.message);
        if (err.status === 409 && err.data && err.data.activeId) { runId = err.data.activeId; load(); startPolling(); }
      }).then(function () { btn.disabled = false; btn.textContent = 'Start test'; });
  });
  document.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('[data-act]') : null; if (!t) return;
    var a = t.dataset.act;
    if (a === 'stop') ctl(t, 'graceful'); else if (a === 'cancel') ctl(t, 'now');
    else if (a === 'open') { runId = Number(t.dataset.id); cmp = null; load(); $('runArea').scrollIntoView({ behavior: 'smooth' }); }
    else if (a === 'exp') download(t.dataset.fmt, t.dataset.part);
    else if (a === 'cleanup') { if (confirm('Delete the records this run created? Only “[LOADTEST r' + runId + ']” records from load-test accounts are removed.')) api('/loadtests/' + runId + '/cleanup', { body: {} }).then(function (r) { flash('Deleted ' + r.requests + ' test record(s).', true); load(); }).catch(function (x) { flash(x.message); }); }
    else if (a === 'compare') doCompare();
    else if (a === 'knowngood') { api('/loadtests/' + runId + '/known-good', { body: { value: !run.knownGood } }).then(function (r) { run = r; flash(r.knownGood ? 'This run is now the known-good reference.' : 'Known-good reference removed.', true); refreshHistory(); regFor = null; drawRun(); }).catch(function (x) { flash(x.message); }); }
    else if (a === 'datacheck') { api('/loadtests/data').then(function (r) { dataCheck = r; drawHistory(); }).catch(function (x) { flash(x.message); }); }
  });
  function ctl(btn, mode) {
    btn.disabled = true;
    api('/loadtests/' + runId + '/stop', { body: { mode: mode } }).then(function (r) { run = r; drawRun(); startPolling(); }).catch(function (x) { flash(x.message); btn.disabled = false; });
  }
  $('estop').addEventListener('click', function () {
    if (!confirm('Emergency stop: end ALL load-test traffic immediately?')) return;
    api('/loadtests/stop-all', { body: {} }).then(function (r) { flash(r.stopped ? 'Emergency stop sent.' : 'Nothing was running.', true); startPolling(); }).catch(function (x) { flash(x.message); });
  });
  function download(fmt, part) {
    fetch('/api/loadtests/' + runId + '/export?format=' + fmt + (part ? '&part=' + part : ''), { headers: { Authorization: 'Bearer ' + auth.token } }).then(function (r) {
      if (!r.ok) throw new Error('Export failed (' + r.status + ').'); return r.blob();
    }).then(function (b) { var a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'loadtest-' + runId + (fmt === 'csv' ? '-' + part + '.csv' : fmt === 'html' ? '-report.html' : '.json'); document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500); }).catch(function (x) { flash(x.message); });
  }

  /* ---------------- polling ---------------- */
  var lseq = 0;
  function load() { if (!runId) return Promise.resolve(); var my = ++lseq, rid = runId; return api('/loadtests/' + runId).then(function (r) { if (my !== lseq || rid !== runId) return; run = r; drawRun(); if (!r.isLive) { stopPolling(); refreshHistory(); } }).catch(function (e) { flash(e.message); stopPolling(); }); }
  function startPolling() { stopPolling(); timer = setInterval(function () { if (document.hidden) return; load(); }, 1000); }
  function stopPolling() { if (timer) clearInterval(timer); timer = null; }
  function refreshEstop() { $('estop').hidden = !(run && run.isLive); }
  function refreshHistory(first) {
    return api('/loadtests?limit=50').then(function (list) {
      history = list; drawHistory();
      var active = list.filter(function (r) { return ['VALIDATING', 'RUNNING', 'STOPPING'].indexOf(r.state) >= 0; })[0];
      if (first) { if (active) { runId = active.id; load(); startPolling(); } else if (list.length) { runId = list[0].id; load(); } }
    }).catch(function (e) { flash(e.message); });
  }

  /* ---------------- charts (inline SVG, hover tooltip, data-table fallback) ---------------- */
  function chart(id, title, sub, xs, series, o) {
    o = o || {}; var xf = o.xfmt || dur; var W = 520, H = 190, pl = 46, pr = 10, pt = 10, pb = 24;
    var n = xs.length; if (n < 2) return '<div class="chart"><h3>' + esc(title) + '</h3><div class="na">Waiting for data…</div></div>';
    var max = 0; series.forEach(function (s) { s.values.forEach(function (v) { if (v != null && v > max) max = v; }); }); max = max || 1;
    var step = Math.pow(10, Math.floor(Math.log10(max))); var top = Math.ceil(max / step * 2) / 2 * step; if (top < max) top = max; 
    var x = function (i) { return pl + (W - pl - pr) * i / (n - 1); }, y = function (v) { return pt + (H - pt - pb) * (1 - v / top); };
    var grid = [0, .25, .5, .75, 1].map(function (f) { var v = top * f; return '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '" stroke="#e8e8e4"/><text x="' + (pl - 6) + '" y="' + (y(v) + 4).toFixed(1) + '" text-anchor="end" font-size="10.5" fill="#52514e">' + nf(v, top < 10 ? 1 : 0) + '</text>'; }).join('');
    var xl = [0, .5, 1].map(function (f) { var i = Math.round((n - 1) * f); return '<text x="' + x(i).toFixed(1) + '" y="' + (H - 7) + '" text-anchor="' + (f === 0 ? 'start' : f === 1 ? 'end' : 'middle') + '" font-size="10.5" fill="#52514e">' + xf(xs[i]) + '</text>'; }).join('');
    var lines = series.map(function (s) {
      var d = '', pen = false; s.values.forEach(function (v, i) { if (v == null) { pen = false; return; } d += (pen ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1) + ' '; pen = true; });
      return '<path d="' + d + '" fill="none" stroke="' + s.color + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"' + (s.dash ? ' stroke-dasharray="5 4"' : '') + '/>';
    }).join('');
    var legend = '<div class="legend">' + series.map(function (s) { return '<span><i' + (s.dash ? ' class="dash" style="color:' + s.color + '"' : ' style="background:' + s.color + '"') + '></i>' + esc(s.name) + '</span>'; }).join('') + '</div>';
    var rows = xs.map(function (t, i) { return '<tr><td>' + t + '</td>' + series.map(function (s) { return '<td>' + (s.values[i] == null ? '—' : nf(s.values[i], 1)) + '</td>'; }).join('') + '</tr>'; }).join('');
    return '<div class="chart" data-chart="' + id + '"><h3>' + esc(title) + '</h3><div class="sub">' + esc(sub) + '</div>' + legend + '<div class="chart-wrap"><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(title + ': ' + series.map(function (s) { var last = s.values[n - 1]; return s.name + ' ' + (last == null ? 'no data' : nf(last, 1) + ' ' + (o.unit || '')); }).join(', ')) + '">' + grid + xl + lines + '<line class="cur" y1="' + pt + '" y2="' + (H - pb) + '" stroke="#52514e" stroke-width="1" visibility="hidden"/><rect class="hit" x="' + pl + '" y="' + pt + '" width="' + (W - pl - pr) + '" height="' + (H - pt - pb) + '" fill="transparent"/></svg><div class="chart-tip" hidden></div></div>' +
      '<details><summary>View as table</summary><div class="mini"><table><thead><tr><th>second</th>' + series.map(function (s) { return '<th>' + esc(s.name) + '</th>'; }).join('') + '</tr></thead><tbody>' + rows + '</tbody></table></div></details></div>';
  }
  var chartData = {};
  function wireCharts() {
    document.querySelectorAll('.chart[data-chart]').forEach(function (c) {
      var d = chartData[c.dataset.chart]; if (!d) return; var svg = c.querySelector('svg'), hit = c.querySelector('.hit'), cur = c.querySelector('.cur'), tip = c.querySelector('.chart-tip');
      hit.addEventListener('mousemove', function (ev) {
        var r = svg.getBoundingClientRect(), W = 520, pl = 46, pr = 10, px = (ev.clientX - r.left) / r.width * W;
        var i = Math.max(0, Math.min(d.xs.length - 1, Math.round((px - pl) / (W - pl - pr) * (d.xs.length - 1)))), cx = pl + (W - pl - pr) * i / (d.xs.length - 1);
        cur.setAttribute('x1', cx); cur.setAttribute('x2', cx); cur.setAttribute('visibility', 'visible');
        tip.hidden = false; tip.innerHTML = '<b>' + (d.xfmt || dur)(d.xs[i]) + '</b><br>' + d.series.map(function (s) { return esc(s.name) + ': ' + (s.values[i] == null ? '—' : nf(s.values[i], 1) + (d.unit ? ' ' + d.unit : '')); }).join('<br>');
        tip.style.left = Math.max(60, Math.min(r.width - 60, cx / W * r.width)) + 'px'; tip.style.top = '8px';
      });
      hit.addEventListener('mouseleave', function () { cur.setAttribute('visibility', 'hidden'); tip.hidden = true; });
    });
  }

  /* ---------------- run view ---------------- */
  function stateBadge(r) { var c = r.state === 'RUNNING' || r.state === 'STOPPING' || r.state === 'VALIDATING' ? 'run' : r.state === 'COMPLETED' ? 'ok' : r.state === 'FAILED' ? 'bad' : 'warn'; return '<span class="state ' + c + '">' + esc(r.state.charAt(0) + r.state.slice(1).toLowerCase()) + '</span>'; }
  function card(k, v, u, s, bad) { return '<div class="card' + (bad ? ' bad' : '') + '"><div class="k">' + esc(k) + '</div><div class="v">' + v + (u ? '<span class="u">' + esc(u) + '</span>' : '') + '</div>' + (s ? '<div class="s">' + esc(s) + '</div>' : '') + '</div>'; }
  function drawRun() {
    refreshEstop();
    var box = $('runArea'); if (!box) return;
    if (!run) { box.innerHTML = '<section class="panel"><div class="empty"><h3>No test selected</h3><p>Configure a test above and press Start, or pick a previous run from the history.</p></div></section>'; return; }
    var r = run, s = r.summary, L = s && s.latency || {}, T = s && s.totals || {}, planned = r.plannedDurationSec || 1;
    var pct = Math.min(100, Math.round((r.elapsedSec || 0) / planned * 100)); if (!r.isLive && r.state === 'COMPLETED') pct = 100;
    var h = '<section class="panel" aria-labelledby="runh"><div class="runhead"><h2 id="runh">' + esc(r.name) + '</h2>' + stateBadge(r) + (r.verdict ? '<span class="vd vd--' + r.verdict + '">' + (r.verdict === 'PASSED' ? '✓ Thresholds met' : r.verdict === 'FAILED' ? '✕ Thresholds not met' : '? Inconclusive') + '</span>' : '') +
      '<span class="grow">' + (r.isLive ? '<button type="button" class="btn btn--sm btn--line" data-act="stop"' + (r.state === 'STOPPING' ? ' disabled' : '') + '>Stop gracefully</button><button type="button" class="btn btn--sm btn--line" data-act="cancel">Cancel now</button>' : '') + '</span></div>' +
      '<div class="muted-sm" style="padding:0 18px 10px">Run #' + r.id + ' · started by ' + esc(r.startedBy.name) + ' · target ' + esc(r.target) + (r.seed != null ? ' · seed ' + r.seed : '') + (r.startedAt ? ' · ' + new Date(r.startedAt).toLocaleString() : '') + '</div>' +
      '<div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '" aria-label="Test progress"><i style="width:' + pct + '%"></i></div>' +
      '<div class="progmeta"><span>' + dur(r.elapsedSec) + ' of ' + dur(planned) + ' planned' + (r.phase && r.isLive ? ' · phase: ' + esc(r.phase) : '') + '</span><span>' + pct + '%</span></div>';
    if (r.error) h += '<div class="sec"><p class="alert">' + esc(r.error) + '</p></div>';
    if (r.stopReason && r.state !== 'FAILED') h += '<div class="sec"><p class="alert alert--ok" style="background:var(--wait-soft);color:#64500C">' + esc(r.stopReason) + '. The profile did not finish, so the verdict is inconclusive.</p></div>';
    if (!s) { h += '<div class="sec"><div class="na">' + (r.isLive ? 'Signing in test accounts and warming up…' : 'No measurements were recorded for this run.') + '</div></div></section>'; box.innerHTML = h; return; }
    var errPct = s.errorRatePct, cur = s.currentRps;
    h += '<div class="cards" role="list" aria-label="Key measurements">' +
      card('Target users', nf(s.targetUsers != null ? s.targetUsers : r.targetUsers), '', 'what the plan asks for now') + card('Active users', nf(s.activeUsers != null ? s.activeUsers : r.activeUsers), '', 'measured · peak ' + nf(s.peakActiveUsers) + ' of max ' + nf(r.maxUsers)) +
      card('Requests', nf(T.requests), '', nf(T.iterations) + ' scenario runs') + card('Throughput', nf(r.isLive ? cur : s.avgRps, 1), 'req/s', r.isLive ? 'last 5 s · avg ' + nf(s.avgRps, 1) : 'average over the run') +
      card('Succeeded', nf(T.ok), '') + card('Failed', nf(T.failed), '', nf(T.timeouts) + ' timeouts · ' + nf(T.networkErrors) + ' connection', T.failed > 0) + card('Error rate', nf(errPct, 2), '%', 'failed ÷ requests', errPct > (r.config.thresholds.maxErrorRatePct == null ? 100 : r.config.thresholds.maxErrorRatePct)) +
      card('Average', ms(L.avg).replace(' ms', ''), 'ms') + card('Median (p50)', ms(L.p50).replace(' ms', ''), 'ms') + card('p90', ms(L.p90).replace(' ms', ''), 'ms') + card('p95', ms(L.p95).replace(' ms', ''), 'ms') + card('p99', ms(L.p99).replace(' ms', ''), 'ms') + card('Min', ms(L.min).replace(' ms', ''), 'ms') + card('Max', ms(L.max).replace(' ms', ''), 'ms') + '</div>';
    var tl = r.timeline || [], xs = tl.map(function (p) { return p.t; });
    chartData.users = { xs: xs, unit: 'users', series: [{ name: 'Configured virtual users', color: '#52514e', dash: true, values: tl.map(function (p) { return p.target; }) }, { name: 'Active virtual users', color: '#2a78d6', values: tl.map(function (p) { return p.active; }) }, { name: 'Active iterations (journey in progress)', color: '#eb6834', values: tl.map(function (p) { return p.busy; }) }, { name: 'Authenticated sessions', color: '#1baf7a', values: tl.map(function (p) { return p.sessions; }) }] };
    chartData.lat = { xs: xs, unit: 'ms', series: [{ name: 'p50', color: '#2a78d6', values: tl.map(function (p) { return p.p50; }) }, { name: 'p95', color: '#eb6834', values: tl.map(function (p) { return p.p95; }) }, { name: 'p99', color: '#1baf7a', values: tl.map(function (p) { return p.p99; }) }] };
    chartData.rps = { xs: xs, unit: '/s', series: [{ name: 'Requests per second', color: '#2a78d6', values: tl.map(function (p) { return p.rps; }) }, { name: 'Successful requests per second', color: '#1baf7a', values: tl.map(function (p) { return p.okRps; }) }, { name: 'Journeys per second', color: '#eb6834', values: tl.map(function (p) { return p.journeys; }) }, { name: 'Failed per second', color: '#d03b3b', values: tl.map(function (p) { return p.errors; }) }] };
    h += '<div class="charts">' + chart('users', 'Users, journeys and sessions', 'Configured vs. active users, journeys in progress and signed-in sessions', xs, chartData.users.series, { unit: '' }) + chart('lat', 'Response time', 'Per-second percentiles, milliseconds', xs, chartData.lat.series, { unit: 'ms' }) + chart('rps', 'Throughput and failures', 'Requests and journeys completed each second', xs, chartData.rps.series, { unit: '/s' }) + '</div>';
    h += securityView(s) + breakdownView(s);
    h += resourcesView(r);
    h += thresholdsView(r) + (r.warnings && r.warnings.length ? '<div class="sec"><h3>Warnings and limitations</h3><ul class="warnlist">' + r.warnings.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul></div>' : '');
    h += distView(s) + endpointsView(s) + errorsView(s);
    if (!r.isLive) h += '<div class="sec"><h3>Export and clean up</h3><div class="actions"><button type="button" class="btn btn--sm btn--line" data-act="exp" data-fmt="html">HTML report</button><button type="button" class="btn btn--sm btn--line" data-act="exp" data-fmt="json">JSON (everything)</button>' + ['summary', 'endpoints', 'scenarios', 'timeline', 'errors', 'thresholds'].map(function (p) { return '<button type="button" class="btn btn--sm btn--line" data-act="exp" data-fmt="csv" data-part="' + p + '">CSV · ' + p + '</button>'; }).join('') + (r.target === 'local' && !r.cleanedUp ? '<button type="button" class="btn btn--sm btn--line" data-act="cleanup">Delete this run’s test records</button>' : '') + '</div><p class="hint">' + (r.cleanedUp ? 'Test records for this run were deleted.' : r.target === 'local' ? 'Test records from this run are still in the database (titled “[LOADTEST r' + r.id + ']”).' : 'Records on a remote target must be removed there.') + ' Created during the run: ' + nf(r.createdRecords) + '.</p></div>';
    box.innerHTML = h + (!r.isLive && r.state === 'COMPLETED' ? '<div class="sec" id="regArea"></div>' : '') + '</section>';
    wireCharts(); if (!r.isLive && r.state === 'COMPLETED') { if (regFor !== r.id) { regFor = r.id; reg = null; trendData = null; loadRegression(); } else drawRegression(); }
  }
  /* ---------------- security, roles, stages, operations ---------------- */
  function securityView(s) {
    var x = s.security;
    if (!x || !x.checks) return '<div class="sec"><h3>Security checks</h3><div class="na">No authorization checks ran in this test (the setting is 0% or the run was too short).</div></div>';
    return '<div class="sec"><h3>Security checks <span class="tag">reported separately from errors</span></h3><p class="hint" style="margin:0 0 8px">Negative checks: requests that MUST be refused (no sign-in, wrong role, another organization, another tenant). A refusal is a pass and is not an application error. <b>' + nf(x.checks) + '</b> run · <b>' + nf(x.denied) + '</b> refused correctly · <b' + (x.leaks ? ' class="bad-t"' : '') + '>' + nf(x.leaks) + ' leaks</b>' + (x.errors ? ' · ' + nf(x.errors) + ' unclear (server error or timeout)' : '') + '.</p>' +
      '<div class="sheet"><table class="data dense" id="secTable"><thead><tr><th>Check</th><th class="r">Run</th><th class="r">Refused</th><th class="r">Leaks</th><th class="r">Unclear</th></tr></thead><tbody>' +
      (x.byCheck || []).map(function (c) { return '<tr><td>' + esc(c.check) + '</td><td class="r">' + nf(c.checks) + '</td><td class="r">' + nf(c.denied) + '</td><td class="r' + (c.leaks ? ' bad-t' : '') + '">' + nf(c.leaks) + '</td><td class="r">' + nf(c.errors) + '</td></tr>'; }).join('') + '</tbody></table></div></div>';
  }
  function breakdownView(s) {
    var t = function (head, rows, id) { return '<div class="sheet"><table class="data dense" id="' + id + '"><thead><tr>' + head.map(function (h, i) { return '<th' + (i ? ' class="r"' : '') + '>' + h + '</th>'; }).join('') + '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>'; };
    var row = function (cells) { return '<tr>' + cells.map(function (c, i) { return '<td' + (i ? ' class="r"' : '') + '>' + c + '</td>'; }).join('') + '</tr>'; };
    var h = '';
    if ((s.personas || []).length) h += '<div class="sec"><h3>By user type</h3>' + t(['User type', 'Sessions', 'Journeys', 'Requests', 'p50', 'p95', 'p99', 'Errors'], s.personas.map(function (p) { return row([esc(PNAME[p.persona] || p.persona), nf(p.sessions), nf(p.journeys), nf(p.requests), ms(p.p50), ms(p.p95), ms(p.p99), nf(p.errorRatePct, 2) + '%']); }), 'byRole') + '<p class="hint">Owner is not simulated: EstateOps has no owner role.' + ((s.missingPersonas || []).length ? ' No test account existed for: ' + esc(s.missingPersonas.join(', ')) + '.' : '') + '</p></div>';
    if ((s.stages || []).length > 1) h += '<div class="sec"><h3>By load stage</h3>' + t(['Stage', 'Peak users', 'Requests', 'Req/s', 'p50', 'p95', 'p99', 'Errors'], s.stages.map(function (x) { return row([esc(x.name), nf(x.users), nf(x.requests), nf(x.rps, 1), ms(x.p50), ms(x.p95), ms(x.p99), nf(x.errorRatePct, 2) + '%']); }), 'byStage') + '</div>';
    if ((s.operations || []).length) h += '<div class="sec"><h3>By business operation <span class="muted-sm">what a person does, not which URL</span></h3>' + t(['Operation', 'Requests', 'Average', 'p95', 'p99', 'Errors'], s.operations.map(function (x) { return row([esc(x.name), nf(x.count), ms(x.avg), ms(x.p95), ms(x.p99), nf(x.errorRatePct, 2) + '%']); }), 'byOp') + '</div>';
    return h;
  }

  /* ---------------- regression check ---------------- */
  var SEV = { PASS: 'ok-t', WARNING: 'warn-t', REGRESSION: 'bad-t', INCONCLUSIVE: 'warn-t' };
  function loadRegression() {
    var my = runId;
    api('/loadtests/' + my + '/regression?baseline=' + encodeURIComponent(regBase)).then(function (r) { if (my !== runId) return; reg = r; drawRegression(); })
      .catch(function (e) { reg = { available: false, reason: e.message }; drawRegression(); });
    api('/loadtests/trends?runId=' + my).then(function (t) { if (my !== runId) return; trendData = t; drawRegression(); }).catch(function () {});
  }
  function drawRegression() {
    var box = $('regArea'); if (!box || !run) return;
    var opts = '<option value="previous"' + (regBase === 'previous' ? ' selected' : '') + '>Previous comparable run</option><option value="known-good"' + (regBase === 'known-good' ? ' selected' : '') + '>Known-good reference</option>' +
      history.filter(function (h) { return h.id !== run.id && h.state === 'COMPLETED' && h.requests != null; }).map(function (h) { return '<option value="' + h.id + '"' + (String(h.id) === String(regBase) ? ' selected' : '') + '>#' + h.id + ' ' + esc(h.name) + (h.knownGood ? ' (known-good)' : '') + '</option>'; }).join('');
    var h = '<h3>Regression check <span class="muted-sm">is this run worse than a baseline?</span></h3><div class="actions" style="margin-bottom:10px"><label for="regBase" class="muted-sm">Compare with</label><select class="field" id="regBase" style="max-width:340px">' + opts + '</select><button type="button" class="btn btn--sm btn--line" data-act="knowngood">' + (run.knownGood ? 'Remove known-good mark' : 'Mark this run as known-good') + '</button></div>';
    if (!reg) { box.innerHTML = h + '<div class="na">Comparing…</div>'; wireRegBase(); return; }
    if (!reg.available) { box.innerHTML = h + '<div class="na" id="regNone">' + esc(reg.reason || 'No comparison is available.') + '</div>' + trendsView(); wireRegBase(); wireCharts(); return; }
    var c = reg.comparison;
    h += '<div class="alert regbanner" style="margin:0 0 10px"><b id="regClass">' + esc(c.classification) + '</b> · ' + esc((c.reasons || []).join(' ')) + '<div class="muted-sm">Baseline: run #' + esc(c.base.id) + ' ' + esc(c.base.name) + (c.base.knownGood ? ' (known-good)' : '') + (c.base.gitCommit ? ' · commit ' + esc(c.base.gitCommit) : '') + ' → this run #' + esc(c.current.id) + (c.current.gitCommit ? ' · commit ' + esc(c.current.gitCommit) : '') + ' · ' + c.counts.regression + ' regression(s), ' + c.counts.warning + ' warning(s), ' + c.counts.inconclusive + ' inconclusive</div></div>';
    if (c.comparability.blocking.length) h += '<p><b>Why this is not conclusive</b></p><ul class="warnlist">' + c.comparability.blocking.map(function (b) { return '<li>' + esc(b.message) + '</li>'; }).join('') + '</ul>';
    if (c.comparability.warnings.length) h += '<p><b>Comparability notes</b></p><ul class="warnlist">' + c.comparability.warnings.map(function (b) { return '<li>' + esc(b.message) + '</li>'; }).join('') + '</ul>';
    var fmt = function (f, v) { return v == null ? '—' : nf(v, 2) + (f.unit === '%' ? '%' : f.unit ? ' ' + f.unit : ''); };
    var chg = function (f) { return f.delta == null ? '—' : (f.delta > 0 ? '+' : '') + nf(f.delta, 2) + (f.unit === '%' ? ' pp' : f.deltaPct != null ? ' (' + (f.deltaPct > 0 ? '+' : '') + nf(f.deltaPct, 1) + '%)' : ''); };
    h += '<div class="sheet"><table class="data dense" id="regHead"><thead><tr><th>Metric</th><th class="r">Baseline</th><th class="r">This run</th><th class="r">Change</th><th class="r">Limit</th><th>Result</th></tr></thead><tbody>' +
      c.headline.map(function (f) { return '<tr><td>' + esc(f.metric) + '</td><td class="r">' + fmt(f, f.base) + '</td><td class="r">' + fmt(f, f.current) + '</td><td class="r">' + chg(f) + '</td><td class="r">' + (f.limitPp != null ? '+' + f.limitPp + ' pp' : f.limitPct != null ? f.limitPct + '%' : '—') + '</td><td class="' + SEV[f.severity] + '">' + esc(f.severity) + (f.note ? '<div class="sub">' + esc(f.note) + '</div>' : '') + '</td></tr>'; }).join('') + '</tbody></table></div>';
    var where = c.findings.filter(function (f) { return f.scope !== 'global' && f.scope !== 'security' && f.severity !== 'PASS'; }).slice(0, 40);
    h += '<h3 style="margin-top:14px">Where it changed</h3>' + (where.length ? '<div class="sheet"><table class="data dense" id="regWhere"><thead><tr><th>Result</th><th>Scope</th><th>Subject</th><th>Metric</th><th class="r">Baseline</th><th class="r">This run</th><th class="r">Change</th></tr></thead><tbody>' + where.map(function (f) { return '<tr><td class="' + SEV[f.severity] + '">' + esc(f.severity) + '</td><td>' + esc(f.scope) + '</td><td><code>' + esc(f.subject) + '</code>' + (f.note ? '<div class="sub">' + esc(f.note) + '</div>' : '') + '</td><td>' + esc(f.metric) + '</td><td class="r">' + fmt(f, f.base) + '</td><td class="r">' + fmt(f, f.current) + '</td><td class="r">' + chg(f) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<div class="na">No endpoint, journey, role, operation or stage moved beyond its limit.</div>');
    h += '<p class="hint">' + (c.limitations || []).map(esc).join(' ') + '</p>' + trendsView();
    box.innerHTML = h; wireRegBase(); wireCharts();
  }
  function trendsView() {
    var t = trendData; if (!t || !t.runs || t.runs.length < 3) return '<p class="hint">Trends appear once there are at least 3 comparable runs.</p>';
    var out = '<h3 style="margin-top:14px">Trends across ' + t.runs.length + ' comparable runs' + (t.excluded ? ' <span class="muted-sm">(' + t.excluded + ' earlier run(s) excluded: measured under different conditions)</span>' : '') + '</h3><div class="charts" style="padding:0">';
    (t.trends || []).forEach(function (x, i) {
      var xfmt = function (v) { return 'run ' + v; };
      chartData['tr' + i] = { xs: x.series.map(function (_, j) { return j + 1; }), unit: '', xfmt: xfmt, series: [{ name: x.label, color: '#2a78d6', values: x.series.map(function (p) { return p.value; }) }] };
      out += chart('tr' + i, x.label, (x.note || '') + (x.gradual ? ' ⚠ gradual degradation' : ''), chartData['tr' + i].xs, chartData['tr' + i].series, { xfmt: xfmt });
    });
    return out + '</div>';
  }
  function wireRegBase() { var s = $('regBase'); if (s) s.onchange = function () { regBase = s.value; reg = null; drawRegression(); loadRegression(); }; }

  function resourcesView(r) {
    var x = r.resources; if (!x) return '';
    if (!x.available) return '<div class="sec"><h3>Server resources</h3><div class="na">Not measured. ' + esc(x.reason || '') + '</div></div>';
    var sr = x.series || [], xs = sr.map(function (p) { return p.t; });
    chartData.cpu = { xs: xs, unit: '', series: [{ name: 'Server CPU % of one core', color: '#eb6834', values: sr.map(function (p) { return p.cpuPct; }) }, { name: 'Event-loop lag p95 (ms)', color: '#1baf7a', values: sr.map(function (p) { return p.lagP95Ms; }) }] };
    chartData.mem = { xs: xs, unit: 'MB', series: [{ name: 'Server memory (RSS)', color: '#2a78d6', values: sr.map(function (p) { return p.rssMb; }) }, { name: 'Database file', color: '#52514e', values: sr.map(function (p) { return p.dbMb; }) }] };
    var pk = x.peak || {};
    return '<div class="sec"><h3>Server resources <span class="tag">measured · this server process only</span></h3><p class="hint" style="margin:0 0 8px">' + esc(x.note || '') + ' Peak CPU ' + nf(pk.cpuPct, 0) + '% · peak memory ' + nf(pk.rssMb) + ' MB · peak event-loop lag ' + nf(pk.lagMaxMs, 1) + ' ms · database ' + nf(pk.dbMb, 1) + ' MB (WAL ' + nf(pk.walMb, 1) + ' MB).' + (x.generator ? ' <b>Load generator (separate process, client side):</b> ' + nf(x.generator.cpuPct, 0) + '% CPU, ' + nf(x.generator.rssMb) + ' MB.' : '') + '</p><div class="charts" style="padding:0">' + chart('cpu', 'CPU and responsiveness', 'Server side', xs, chartData.cpu.series, {}) + chart('mem', 'Memory and database size', 'Server side', xs, chartData.mem.series, { unit: 'MB' }) + '</div></div>';
  }
  function thresholdsView(r) {
    var t = r.thresholds || []; if (r.isLive && !t.length) return '<div class="sec"><h3>Thresholds</h3><div class="na">Judged when the run ends: error rate ≤ ' + esc(r.config.thresholds.maxErrorRatePct == null ? 'no limit' : r.config.thresholds.maxErrorRatePct + '%') + ', p95 ≤ ' + esc(r.config.thresholds.maxP95Ms == null ? 'no limit' : r.config.thresholds.maxP95Ms + ' ms') + '.</div></div>'; if (!t.length) return '<div class="sec"><h3>Thresholds</h3><div class="na">No thresholds were configured, so this run has no pass/fail verdict.</div></div>';
    return '<div class="sec"><h3>Thresholds</h3><div class="sheet"><table class="data dense"><thead><tr><th>Check</th><th class="r">Limit</th><th class="r">Actual</th><th>Result</th></tr></thead><tbody>' + t.map(function (x) { return '<tr><td>' + esc(x.label) + '</td><td class="r">' + (x.key === 'rps' ? '≥ ' : '≤ ') + nf(x.limit, 2) + ' ' + esc(x.unit) + '</td><td class="r">' + nf(x.actual, 2) + ' ' + esc(x.unit) + '</td><td class="' + (x.passed ? 'ok-t">✓ Met' : 'bad-t">✕ Exceeded') + '</td></tr>'; }).join('') + '</tbody></table></div>' + (r.verdict === 'INCONCLUSIVE' ? '<p class="hint">The run was stopped early, so these figures cover only part of the plan.</p>' : '') + '</div>';
  }
  function distView(s) {
    var codes = Object.keys(s.statusCodes || {}), total = s.totals.requests || 1;
    var c = codes.sort().map(function (k) { var v = s.statusCodes[k], bad = !/^2/.test(k); return '<div><span>' + esc(k === '0' ? 'none' : k) + '</span><span class="t"><i class="' + (bad ? 'e' : '') + '" style="width:' + Math.max(1, v / total * 100) + '%"></i></span><span class="num">' + nf(v) + '</span></div>'; }).join('');
    var kinds = Object.keys(s.errorKinds || {}), k = kinds.map(function (n) { return '<div><span>' + esc(n) + '</span><span class="t"><i class="e" style="width:' + Math.max(1, s.errorKinds[n] / total * 100) + '%"></i></span><span class="num">' + nf(s.errorKinds[n]) + '</span></div>'; }).join('');
    return '<div class="sec"><div class="twocol"><div><h3>HTTP status codes</h3><div class="dist">' + (c || '<div class="na">None yet</div>') + '</div></div><div><h3>Failure kinds</h3><div class="dist">' + (k || '<span class="muted-sm">No failures.</span>') + '</div></div></div></div>';
  }
  function endpointsView(s) {
    var e = s.endpoints || []; if (!e.length) return '';
    var sc = s.scenarios || [];
    return '<div class="sec"><h3>Endpoints <span class="muted-sm">slowest p95 first</span></h3><div class="sheet"><table class="data dense"><thead><tr><th>Endpoint</th><th class="r">Requests</th><th class="r">Errors</th><th class="r">Min</th><th class="r">Avg</th><th class="r">p50</th><th class="r">p90</th><th class="r">p95</th><th class="r">p99</th><th class="r">Max</th></tr></thead><tbody>' +
      e.map(function (x) { return '<tr><td><code>' + esc(x.key) + '</code></td><td class="r">' + nf(x.count) + '</td><td class="r ' + (x.errors ? 'bad-t' : '') + '">' + nf(x.errors) + ' (' + nf(x.errorRatePct, 1) + '%)</td>' + ['min', 'avg', 'p50', 'p90', 'p95', 'p99', 'max'].map(function (k) { return '<td class="r">' + nf(x[k], 1) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div><p class="hint">Times in milliseconds.</p></div>' +
      '<div class="sec"><h3>Scenarios</h3><div class="sheet"><table class="data dense"><thead><tr><th>Scenario</th><th>User type</th><th class="r">Runs</th><th class="r">Runs with a failure</th><th class="r">Failed requests</th><th class="r">p95 whole run (incl. think time)</th></tr></thead><tbody>' +
      sc.map(function (x) { return '<tr><td><code>' + esc(x.key) + '</code></td><td>' + esc(x.persona) + '</td><td class="r">' + nf(x.iterations) + '</td><td class="r">' + nf(x.failedIterations) + '</td><td class="r">' + nf(x.requestErrors) + '</td><td class="r">' + nf(x.p95Ms, 1) + ' ms</td></tr>'; }).join('') + '</tbody></table></div></div>';
  }
  function errorsView(s) {
    var e = s.recentErrors || []; return '<div class="sec"><h3>Recent errors <span class="muted-sm">emails, tokens and passwords are redacted</span></h3>' + (e.length ? '<div class="errlist">' + e.map(function (x) { return '<div>' + esc((x.endpoint || x.key || '') + ' ' + (x.status || '') + ' ' + (x.message || '')) + (x.scenario ? ' · ' + esc(x.scenario) : '') + '</div>'; }).join('') + '</div>' : '<span class="muted-sm">No errors recorded.</span>') + '</div>';
  }

  /* ---------------- history + compare ---------------- */
  function drawHistory() {
    var box = $('histArea'); if (!box) return;
    var rows = history.map(function (r) {
      return '<tr><td><input type="checkbox" data-pick="' + r.id + '"' + (picked[r.id] ? ' checked' : '') + ' aria-label="Select run ' + r.id + ' for comparison"' + (r.requests == null ? ' disabled' : '') + '></td><td class="id">#' + r.id + '</td><td class="strong">' + esc(r.name) + (r.knownGood ? ' <span class="tag">known-good</span>' : '') + '<div class="sub">' + esc(r.profile || 'linear') + ' · ' + r.orgs + ' org · ' + esc(r.startedBy.name) + ' · ' + (r.createdAt ? new Date(r.createdAt).toLocaleString() : '') + '</div></td><td>' + stateBadge(r) + '</td><td>' + (r.verdict ? '<span class="vd vd--' + r.verdict + '" style="font-size:13px">' + esc(r.verdict.charAt(0) + r.verdict.slice(1).toLowerCase()) + '</span>' : '—') + '</td><td class="r">' + nf(r.maxUsers) + '</td><td class="r">' + nf(r.requests) + '</td><td class="r">' + nf(r.avgRps, 1) + '</td><td class="r">' + (r.p95Ms == null ? '—' : nf(r.p95Ms, 1) + ' ms') + '</td><td class="r">' + (r.errorRatePct == null ? '—' : nf(r.errorRatePct, 2) + '%') + '</td><td><button type="button" class="btn btn--sm btn--line" data-act="open" data-id="' + r.id + '">Open</button></td></tr>';
    }).join('');
    box.innerHTML = '<section class="panel" aria-labelledby="histh"><div class="panel-bar"><h2 id="histh">History</h2><div class="grow"><button type="button" class="btn btn--sm btn--line" data-act="datacheck">Check test data</button> <button type="button" class="btn btn--sm" data-act="compare" id="cmpBtn" disabled>Compare selected</button></div></div>' +
      (dataCheck ? '<div class="sec"><h3>Test data check <span class="tag">' + (dataCheck.ok ? 'all good' : 'needs attention') + '</span></h3><ul class="warnlist">' + dataCheck.checks.map(function (c) { return '<li>' + (c.ok ? '✓ ' : '✕ ') + esc(c.name) + ' — ' + esc(c.detail) + '</li>'; }).join('') + '</ul></div>' : '') + (history.length ? '<div class="sheet"><table class="data dense"><thead><tr><th><span class="sr">Select</span></th><th>Run</th><th>Name</th><th>State</th><th>Verdict</th><th class="r">Max users</th><th class="r">Requests</th><th class="r">Req/s</th><th class="r">p95</th><th class="r">Errors</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div><p class="hint" style="padding:0 18px 14px">Choose 2 to 5 runs. The first one you choose is the baseline.</p>' : '<div class="empty"><h3>No tests yet</h3><p>Completed, stopped and failed runs appear here, so you can open them and compare.</p></div>') +
      '<div id="cmpArea"></div></section>';
    updateCmpBtn(); if (cmp) drawCmp();
  }
  var pickOrder = [];
  document.addEventListener('change', function (e) {
    var id = e.target.dataset && e.target.dataset.pick; if (!id) return; id = Number(id);
    if (e.target.checked) { if (pickOrder.length >= 5) { e.target.checked = false; flash('You can compare up to 5 runs.'); return; } picked[id] = true; pickOrder.push(id); } else { delete picked[id]; pickOrder = pickOrder.filter(function (x) { return x !== id; }); }
    updateCmpBtn();
  });
  function updateCmpBtn() { var b = $('cmpBtn'); if (b) b.disabled = pickOrder.length < 2; }
  function doCompare() { api('/loadtests/compare?ids=' + pickOrder.join(',')).then(function (r) { cmp = r; drawCmp(); $('cmpArea').scrollIntoView({ behavior: 'smooth' }); }).catch(function (e) { flash(e.message); }); }
  function drawCmp() {
    var box = $('cmpArea'); if (!box || !cmp) return;
    var cell = function (r, m) {
      var v = r.metrics[m.key], d = r.vsBaseline[m.key], fmtv = v == null ? '—' : nf(v, m.key === 'errorRatePct' ? 2 : 1) + (m.unit ? ' ' + m.unit : '');
      if (!d) return '<td class="r">' + fmtv + '</td>';
      return '<td class="r">' + fmtv + '<div class="sub cmp' + (d.verdict === 'improved' ? 'good' : d.verdict === 'regressed' ? 'bad' : 'sim') + '">' + (d.delta > 0 ? '+' : '') + nf(d.delta, 2) + (d.pct != null ? ' (' + (d.pct > 0 ? '+' : '') + d.pct + '%)' : '') + ' · ' + d.verdict + '</div></td>';
    };
    box.innerHTML = '<div class="sec"><h3>Comparison <span class="muted-sm">baseline: run #' + cmp.baselineId + '</span></h3>' + (cmp.notes.length ? '<ul class="warnlist" style="margin-bottom:10px">' + cmp.notes.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul>' : '') +
      '<div class="sheet"><table class="data dense"><thead><tr><th>Run</th>' + cmp.metrics.map(function (m) { return '<th class="r">' + esc(m.label) + '</th>'; }).join('') + '<th>Verdict</th></tr></thead><tbody>' + cmp.runs.map(function (r) { return '<tr><td><b>#' + r.id + '</b> ' + esc(r.name) + (r.id === cmp.baselineId ? ' <span class="tag">baseline</span>' : '') + '</td>' + cmp.metrics.map(function (m) { return cell(r, m); }).join('') + '<td>' + esc(r.verdict || '—') + '</td></tr>'; }).join('') + '</tbody></table></div><p class="hint">Lower is better for latency and errors; higher is better for throughput. Differences under 5% are called similar.</p></div>';
  }

  /* ---------------- tooltips for the (?) buttons ---------------- */
  var tip = $('tip');
  function showTip(el) { var r = el.getBoundingClientRect(); tip.textContent = el.dataset.tip; tip.hidden = false; var w = tip.offsetWidth; tip.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + 'px'; tip.style.top = (r.bottom + 8) + 'px'; }
  document.addEventListener('mouseover', function (e) { var t = e.target.closest && e.target.closest('[data-tip]'); if (t) showTip(t); });
  document.addEventListener('mouseout', function (e) { if (e.target.closest && e.target.closest('[data-tip]')) tip.hidden = true; });
  document.addEventListener('focusin', function (e) { var t = e.target.closest && e.target.closest('[data-tip]'); if (t) showTip(t); });
  document.addEventListener('focusout', function () { tip.hidden = true; });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') tip.hidden = true; });
  window.addEventListener('beforeunload', function () { /* the test keeps running on the server: closing this tab never leaves it uncontrolled, and it ends by itself at its planned duration */ });
})();
