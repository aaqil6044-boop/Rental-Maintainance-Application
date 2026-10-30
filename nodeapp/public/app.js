(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var CURRENCY = 'INR';
  var PAGE = 20;

  /* ---------------- session ---------------- */
  var auth = null;
  try { auth = JSON.parse(localStorage.getItem('eo_auth') || 'null'); } catch (e) { auth = null; }
  if (!auth || !auth.token) { location.replace('login.html'); return; }
  var me = null, pendingInvite = null, listState = { q: '', status: '', priority: '', page: 0 };
  var blobUrls = [];

  function leave() { try { localStorage.removeItem('eo_auth'); } catch (e) {} location.replace('login.html'); }

  /* ---------------- http ---------------- */
  function api(path, opts) {
    opts = opts || {};
    var h = { 'Authorization': 'Bearer ' + auth.token };
    var body = opts.body;
    if (body !== undefined && !(body instanceof FormData)) { h['Content-Type'] = 'application/json'; body = JSON.stringify(body); }
    return fetch('/api' + path, { method: opts.method || (body !== undefined ? 'POST' : 'GET'), headers: h, body: body }).then(function (res) {
      if (res.status === 401 && !/^\/auth\/(mfa\/|change-password)/.test(path)) { leave(); throw new Error('Your session has ended. Please sign in again.'); }
      if (res.status === 204) return { data: null, total: 0 };
      return res.text().then(function (text) {
        var data = null;
        if (text) { try { data = JSON.parse(text); } catch (e) { data = null; } }
        if (!res.ok) { var err = new Error((data && data.message) || ('Request failed (' + res.status + ').')); err.code = data && data.code; if (err.code === 'MFA_REQUIRED' && location.hash !== '#/account') location.hash = '#/account'; throw err; }
        return { data: data, total: Number(res.headers.get('X-Total-Count') || 0) };
      });
    });
  }
  function get(path) { return api(path).then(function (r) { return r.data; }); }
  function send(path, body, method) { return api(path, { body: body === undefined ? {} : body, method: method }).then(function (r) { return r.data; }); }

  /* ---------------- helpers ---------------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]; }); }
  function nice(v) { return String(v || '').replace(/_/g, ' ').toLowerCase().replace(/^./, function (c) { return c.toUpperCase(); }); }
  var fmt = new Intl.NumberFormat('en-IN', { style: 'currency', currency: CURRENCY });
  function money(n) { return n == null ? '—' : fmt.format(n); }
  var STATUS_CLASS = { REPORTED: 's-wait', UNDER_REVIEW: 's-hold', ASSIGNED: 's-prog', IN_PROGRESS: 's-prog', COMPLETED: 's-ver', CLOSED: 's-ok', REOPENED: 's-esc' };
  function chip(status) { return '<span class="chip ' + (STATUS_CLASS[status] || 's-wait') + '"><span class="bullet"></span>' + esc(nice(status)) + '</span>'; }
  function prio(p) { return '<span class="pill' + (p === 'URGENT' ? ' pill--urgent' : p === 'HIGH' ? ' pill--high' : '') + '">' + esc(nice(p)) + '</span>'; }
  function opts(list, sel, blank) {
    return (blank ? '<option value="">' + esc(blank) + '</option>' : '') + list.map(function (o) {
      var v = Array.isArray(o) ? o[0] : o, l = Array.isArray(o) ? o[1] : nice(o);
      return '<option value="' + esc(v) + '"' + (String(v) === String(sel) ? ' selected' : '') + '>' + esc(l) + '</option>';
    }).join('');
  }
  var CATEGORIES = ['PLUMBING', 'ELECTRICAL', 'HVAC', 'STRUCTURAL', 'APPLIANCE', 'OTHER'];
  var PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
  function flash(msg, ok) { var f = $('flash'); f.textContent = msg || ''; f.className = 'alert' + (ok ? ' alert--ok' : ''); if (msg) window.scrollTo({ top: 0, behavior: 'smooth' }); }
  function stat(label, value, cls) { return '<div class="stat"><div class="k">' + esc(label) + '</div><div class="v ' + (cls || '') + '">' + esc(value) + '</div></div>'; }
  function panel(title, body, bar) { return '<section class="panel"><div class="panel-bar"><h2>' + esc(title) + '</h2>' + (bar ? '<div class="grow">' + bar + '</div>' : '') + '</div>' + body + '</section>'; }
  function empty(title, text, action) { return '<div class="empty"><h3>' + esc(title) + '</h3><p>' + esc(text) + '</p>' + (action || '') + '</div>'; }
  function fieldRow(label, input, wide) { return '<div' + (wide ? ' class="wide"' : '') + '><label>' + label + '</label>' + input + '</div>'; }
  function size(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
  // Always remember the button's own label before replacing it, otherwise a failed submit leaves the button saying "Working…" for good.
  function busy(btn, on, text) { if (!btn) return; btn.disabled = on; if (on) btn.dataset.t = btn.dataset.t || btn.textContent; btn.textContent = on ? (text || 'Working…') : (btn.dataset.t || btn.textContent); }
  function copyText(t) { if (navigator.clipboard) return navigator.clipboard.writeText(t); var a = document.createElement('textarea'); a.value = t; document.body.appendChild(a); a.select(); document.execCommand('copy'); a.remove(); return Promise.resolve(); }
  function origin() { return location.origin; }
  function linkBox(path, what, emailed) {
    var url = origin() + path;
    return '<div class="linkbox"><div style="flex-basis:100%"><b>' + esc(what) + '</b> ' + (emailed ? 'It was also emailed to them. ' : 'Send this link to them. ') + 'It works once and is shown only now.</div><code>' + esc(url) + '</code><button type="button" class="btn btn--sm btn--line" data-act="copy" data-text="' + esc(url) + '">Copy link</button></div>';
  }

  /* ---------------- navigation ---------------- */
  var ICON = {
    overview: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
    requests: 'M5 6h14M5 12h14M5 18h9',
    report: 'M12 5v14M5 12h14',
    properties: 'M4 20V8l8-4 8 4v12M9 20v-6h6v6',
    people: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20c0-3 3-5 6-5s6 2 6 5M17 11a2.5 2.5 0 1 0 0-5M21 19c0-2-1.5-3.6-4-4',
    vendors: 'M4 8h16v11H4zM9 8V5h6v3',
    company: 'M4 8h16v11H4zM9 8V5h6v3',
    insights: 'M5 20V10M12 20V4M19 20v-7',
    activity: 'M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
    notifications: 'M6 17V11a6 6 0 0 1 12 0v6l1.5 2h-15zM10 21h4',
    loadtest: 'M3 17l5-6 4 3 5-8 4 5',
    account: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 4-6 8-6s8 2 8 6'
  };
  var NAV = {
    TENANT:     [['overview', 'Overview'], ['report', 'Report an issue'], ['requests', 'My requests'], ['notifications', 'Notifications'], ['account', 'Account']],
    MANAGER:    [['overview', 'Overview'], ['requests', 'Requests'], ['properties', 'Properties'], ['people', 'People'], ['vendors', 'Vendors'], ['insights', 'Insights'], ['activity', 'Activity'], ['loadtest', 'Load testing'], ['notifications', 'Notifications'], ['account', 'Account']],
    TECHNICIAN: [['overview', 'Overview'], ['requests', 'My jobs'], ['notifications', 'Notifications'], ['account', 'Account']],
    VENDOR:     [['overview', 'Overview'], ['requests', 'Work orders'], ['company', 'Company'], ['notifications', 'Notifications'], ['account', 'Account']]
  };
  var TITLES = { overview: 'Overview', report: 'Report an issue', properties: 'Properties', people: 'People', vendors: 'Vendors', insights: 'Insights', activity: 'Activity', notifications: 'Notifications', account: 'Account', company: 'Company' };

  function route() {
    var h = (location.hash || '#/overview').replace(/^#\/?/, '').split('/');
    return { name: h[0] || 'overview', arg: h[1] };
  }
  function renderNav(active, unread) {
    $('nav').innerHTML = NAV[me.role].filter(function (n) { return n[0] !== 'loadtest' || me.orgAdmin; }).map(function (n) {
      var t = (me.role === 'TENANT' && n[0] === 'requests') ? 'My requests' : n[1];
      return '<a href="' + (n[0] === 'loadtest' ? 'loadtest.html' : '#/' + n[0]) + '"' + (n[0] === active ? ' aria-current="page"' : '') + '><svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="' + ICON[n[0]] + '" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg><span class="lbl">' + esc(t) + '</span>' +
        (n[0] === 'notifications' && unread ? '<span class="badge dotn">' + unread + '</span>' : '') + '</a>';
    }).join('');
  }

  var VIEWS = {};
  function go() {
    var r = route();
    if (r.name === 'loadtest') { location.replace('loadtest.html'); return; }
    var allowed = NAV[me.role].map(function (n) { return n[0]; });
    var name = r.name === 'request' ? 'requests' : r.name;
    if (allowed.indexOf(name) < 0) { location.hash = '#/overview'; return; }
    flash('');
    blobUrls.forEach(function (u) { URL.revokeObjectURL(u); }); blobUrls = [];
    $('topActions').innerHTML = '';
    $('viewTitle').textContent = r.name === 'request' ? 'Request' : (r.name === 'requests' ? NAV[me.role].filter(function (n) { return n[0] === 'requests'; })[0][1] : TITLES[r.name]);
    $('panes').innerHTML = '<p class="muted">Loading…</p>';
    get('/notifications').then(function (n) { renderNav(name, n.filter(function (x) { return !x.read; }).length); }).catch(function () { renderNav(name, 0); });
    var view = VIEWS[r.name];
    Promise.resolve(view(r.arg)).catch(function (e) {
      $('panes').innerHTML = panel('Something went wrong', empty('This page could not load', e.message || 'Try again.'));
    });
    document.title = $('viewTitle').textContent + ' — EstateOps';
  }
  function show() { $('panes').innerHTML = Array.prototype.join.call(arguments, ''); }
  function reload() { go(); }

  /* ---------------- request table ---------------- */
  function requestTable(rows) {
    var staff = me.role === 'MANAGER';
    var head = '<th>ID</th><th>Issue</th><th>Priority</th><th>Status</th>' + (me.role === 'TENANT' ? '' : '<th>Assigned</th>') + '<th>Due</th>';
    return '<div class="sheet"><table class="data data--wide"><thead><tr>' + head + '</tr></thead><tbody>' + rows.map(function (r) {
      var who = r.technicianName || r.vendorName || '—';
      return '<tr class="clickable" data-act="open" data-id="' + r.id + '"><td class="id">REQ-' + r.id + '</td>' +
        '<td><div class="strong">' + esc(r.title) + '</div><div class="sub">' + esc(r.propertyName) + ' · ' + esc(r.unitLabel) + (staff ? ' · ' + esc(r.reporterName) : '') + '</div></td>' +
        '<td>' + prio(r.priority) + '</td><td>' + chip(r.status) + (r.overdue ? ' <span class="pill pill--urgent">Overdue</span>' : '') + '</td>' +
        (me.role === 'TENANT' ? '' : '<td>' + esc(who) + '</td>') + '<td>' + esc(r.dueDate || '—') + '</td></tr>';
    }).join('') + '</tbody></table></div>';
  }

  /* ================= overview ================= */
  VIEWS.overview = function () {
    return get('/dashboard').then(function (d) {
      var tiles = '', extra = '', head = '';
      if (me.role === 'MANAGER') {
        tiles = stat('Open requests', d.openRequests) + stat('Awaiting assignment', d.awaitingAssignment, d.awaitingAssignment ? 'sig' : '') + stat('High priority', d.highPriority, d.highPriority ? 'sig' : '') + stat('Overdue', d.overdue, d.overdue ? 'sig' : '') +
          stat('In progress', d.inProgress, 'calm') + stat('Awaiting your review', d.completedAwaitingReview, 'pine') + stat('Approved spend, 30 days', money(d.monthlySpend)) +
          stat('Awaiting approval', d.pendingApprovals + (d.pendingQuotations ? ' + ' + d.pendingQuotations + ' quotes' : '')) +
          stat('Average turnaround', d.averageTurnaroundDays == null ? '—' : d.averageTurnaroundDays + ' days');
        if (d.propertyCount === 0) head = panel('Get started', '<div class="panel-body"><ol class="note" style="padding-left:18px;margin:0;display:grid;gap:6px"><li><a href="#/properties" style="color:var(--pine);text-decoration:underline">Add a property and its units</a></li><li><a href="#/people" style="color:var(--pine);text-decoration:underline">Invite tenants and technicians</a> (and <a href="#/vendors" style="color:var(--pine);text-decoration:underline">add vendors</a> you work with)</li><li>Tenants report issues. You assign them and follow them to closed.</li></ol></div>');
        var max = Math.max.apply(null, d.trend.map(function (t) { return t.reported; }).concat([1]));
        extra = '<div class="two-col">' +
          panel('Open work by assignee', d.assignments.length ? '<div class="panel-body"><div class="bars">' + d.assignments.map(function (a) { return '<div class="bar" style="grid-template-columns:150px 1fr 40px"><span>' + esc(a.name) + '</span><span class="track"><i class="a" style="width:' + (a.openJobs * 100 / Math.max.apply(null, d.assignments.map(function (x) { return x.openJobs; }))) + '%"></i></span><b>' + a.openJobs + '</b></div>'; }).join('') + '</div></div>' : empty('Nothing assigned', 'Open requests that have a technician or vendor appear here.')) +
          panel('Requests per month', d.trend.length ? '<div class="panel-body"><div class="bars">' + d.trend.map(function (t) { return '<div class="bar"><span>' + esc(t.month) + '</span><span class="track"><i class="a" style="width:' + (t.reported * 100 / max) + '%"></i></span><span>' + t.reported + ' / ' + t.closed + ' closed</span></div>'; }).join('') + '</div></div>' : empty('No history yet', 'Monthly totals appear after the first request.')) + '</div>' +
          panel('Recent activity', d.recentActivity.length ? '<div class="panel-body"><ul class="tl">' + d.recentActivity.map(function (e) { return '<li><span class="when">' + esc(e.createdAt) + '</span><span>' + esc(e.note) + ' <span class="who">— ' + esc(e.actorName) + '</span></span></li>'; }).join('') + '</ul></div>' : empty('No activity yet', 'Changes to requests will be listed here.'));
      } else if (me.role === 'TENANT') {
        tiles = stat('Open requests', d.openRequests) + stat('In progress', d.inProgress, 'calm') + stat('Waiting for your manager', d.completedAwaitingReview, 'pine') + stat('Closed', d.closedTotal);
        head = d.units.length ? panel('Your units', '<div class="panel-body"><div class="row">' + d.units.map(function (u) { return '<span class="pill">' + esc(u.propertyName) + ' · ' + esc(u.label) + '</span>'; }).join('') + '<a class="btn btn--sm grow" href="#/report">Report an issue</a></div></div>') :
          '<div class="callout callout--warn"><b>Your account is not linked to a unit yet.</b><br>Give your property manager this email address, <b>' + esc(me.email) + '</b>, and ask them to add you to your unit. You can also open an invitation link if they sent you one. Until then you cannot report issues.</div>';
      } else if (me.role === 'TECHNICIAN') {
        tiles = stat('Open jobs', d.openRequests) + stat('In progress', d.inProgress, 'calm') + stat('Overdue', d.overdue, d.overdue ? 'sig' : '') + stat('Sent for review', d.completedAwaitingReview, 'pine') + stat('Expenses approved, 30 days', money(d.monthlySpend)) + stat('Expenses awaiting approval', money(d.pendingSpend));
        if (!me.profileComplete) head = '<div class="callout"><b>Complete your profile.</b> Add your phone number and trades so managers know who to assign. <a href="#/account" style="text-decoration:underline">Open account</a></div>';
      } else {
        var st = d.vendor.status;
        if (st !== 'ACTIVE') head = '<div class="callout callout--warn"><b>' + esc(d.vendor.name) + ' is ' + esc(st.toLowerCase()) + '.</b> ' + (st === 'PENDING' ? 'A manager must approve your company before work orders appear here.' : 'You cannot receive new work while this is the case. Contact the manager.') + '</div>';
        tiles = stat('Open work orders', d.openRequests) + stat('In progress', d.inProgress, 'calm') + stat('Quotations awaiting a decision', d.pendingQuotations) + stat('Sent for review', d.completedAwaitingReview, 'pine') + stat('Invoices paid out, 30 days', money(d.monthlySpend)) + stat('Invoices awaiting approval', money(d.pendingSpend));
      }
      var attention = d.attention.length ? panel(me.role === 'TENANT' ? 'Your latest requests' : 'Needs attention', requestTable(d.attention)) :
        panel(me.role === 'TENANT' ? 'Your latest requests' : 'Needs attention', empty(me.role === 'TENANT' ? 'No open requests' : 'Nothing needs attention', me.role === 'MANAGER' ? 'New, urgent and overdue requests appear here.' : 'Open work appears here.'));
      show(head + '<div class="stats">' + tiles + '</div>' + attention + extra);
    });
  };

  /* ================= request list ================= */
  VIEWS.requests = function () {
    var qs = '?limit=' + PAGE + '&offset=' + (listState.page * PAGE) + (listState.q ? '&q=' + encodeURIComponent(listState.q) : '') + (listState.status ? '&status=' + listState.status : '') + (listState.priority ? '&priority=' + listState.priority : '');
    return api('/maintenance-requests' + qs).then(function (r) {
      var pages = Math.max(1, Math.ceil(r.total / PAGE));
      var filters = '<div class="filters"><input class="field field--sm" id="fq" type="search" placeholder="Search title, unit or property" value="' + esc(listState.q) + '" aria-label="Search">' +
        '<select class="field field--sm" id="fs" aria-label="Status">' + opts(['REPORTED', 'UNDER_REVIEW', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CLOSED', 'REOPENED'], listState.status, 'All statuses') + '</select>' +
        '<select class="field field--sm" id="fp" aria-label="Priority">' + opts(PRIORITIES, listState.priority, 'All priorities') + '</select></div>';
      var body = r.data.length ? requestTable(r.data) : empty(listState.q || listState.status || listState.priority ? 'No matching requests' : (me.role === 'TENANT' ? 'You have not reported anything yet' : 'Nothing here yet'),
        me.role === 'TENANT' ? 'When you report an issue it appears here with its progress.' : me.role === 'MANAGER' ? 'Requests reported by tenants appear here.' : 'Work assigned to you appears here.',
        me.role === 'TENANT' ? '<p style="margin-top:14px"><a class="btn btn--sm" href="#/report">Report an issue</a></p>' : '');
      show(panel(me.role === 'TECHNICIAN' ? 'My jobs' : me.role === 'VENDOR' ? 'Work orders' : 'Requests', body +
        '<div class="panel-foot"><span>' + r.total + ' request' + (r.total === 1 ? '' : 's') + '</span><span class="grow"><button class="btn btn--sm btn--line" data-act="page" data-d="-1"' + (listState.page === 0 ? ' disabled' : '') + '>Previous</button><span>Page ' + (listState.page + 1) + ' of ' + pages + '</span><button class="btn btn--sm btn--line" data-act="page" data-d="1"' + (listState.page + 1 >= pages ? ' disabled' : '') + '>Next</button></span></div>', filters));
      var q = $('fq'); if (q && document.activeElement !== q && listState.focusSearch) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
      listState.focusSearch = false;
      if (me.role === 'TENANT') $('topActions').innerHTML = '<a class="btn btn--sm" href="#/report">Report an issue</a>';
    });
  };

  /* ================= report an issue (tenant) ================= */
  VIEWS.report = function () {
    return get('/units/reportable').then(function (units) {
      if (!units.length) { show(panel('Report an issue', '<div class="panel-body"><div class="callout callout--warn"><b>Your account is not linked to a unit yet.</b><br>Ask your property manager to add <b>' + esc(me.email) + '</b> to your unit, then come back.</div></div>')); return; }
      show(panel('What needs fixing?', '<form class="form panel-body" id="reportForm" novalidate><div class="form-grid">' +
        fieldRow('Unit', '<select class="field" id="rUnit">' + opts(units.map(function (u) { return [u.id, u.propertyName + ' · ' + u.label]; })) + '</select>') +
        fieldRow('Category', '<select class="field" id="rCat">' + opts(CATEGORIES, 'OTHER') + '</select>') +
        fieldRow('Short title', '<input class="field" id="rTitle" maxlength="160" placeholder="For example: Kitchen tap is leaking">', true) +
        fieldRow('Describe the problem', '<textarea class="field" id="rDesc" maxlength="4000" placeholder="Where is it, when did it start, and is it getting worse?"></textarea>', true) +
        fieldRow('How urgent is it?', '<select class="field" id="rPri">' + opts(PRIORITIES, 'MEDIUM') + '</select>') +
        fieldRow('Photo <span class="opt">(optional, PNG, JPEG, WebP or PDF, up to 5 MB)</span>', '<input class="field" id="rFile" type="file" accept="image/png,image/jpeg,image/webp,application/pdf">') +
        '</div><p class="alert" id="rErr" role="alert"></p><div><button class="btn" type="submit">Send report</button></div></form>'));
    });
  };

  /* ================= request detail ================= */
  var LABEL = { UNDER_REVIEW: 'Start review', IN_PROGRESS: 'Start work', COMPLETED: 'Mark work complete', CLOSED: 'Close request', REOPENED: 'Reopen' };
  VIEWS.request = function (id) {
    var mgr = me.role === 'MANAGER';
    return Promise.all([get('/maintenance-requests/' + id), mgr ? get('/technicians') : null, mgr ? get('/vendors?status=ACTIVE') : null]).then(function (res) {
      var d = res[0], techs = res[1], vendors = res[2];
      var r = d.request, isMgr = me.role === 'MANAGER', closed = r.status === 'CLOSED';
      var buttons = r.allowedNext.filter(function (t) { return t !== 'ASSIGNED'; }).map(function (t) {
        return '<button class="btn btn--sm' + (t === 'REOPENED' ? ' btn--line' : '') + '" data-act="status" data-id="' + r.id + '" data-to="' + t + '">' + esc(LABEL[t] || nice(t)) + '</button>';
      }).join('');
      var head = '<div class="panel-body"><div class="row" style="margin-bottom:14px">' + chip(r.status) + prio(r.priority) + '<span class="pill">' + esc(nice(r.category)) + '</span>' + (r.overdue ? '<span class="pill pill--urgent">Overdue</span>' : '') + '<span class="grow actions">' + buttons + '</span></div>' +
        '<p style="white-space:pre-wrap;margin-bottom:16px">' + esc(r.description) + '</p>' +
        '<dl class="kv"><dt>UNIT</dt><dd>' + esc(r.propertyName) + ' · ' + esc(r.unitLabel) + '</dd><dt>REPORTED BY</dt><dd>' + esc(r.reporterName) + ' · ' + esc(r.createdAt) + '</dd>' +
        '<dt>ASSIGNED TO</dt><dd>' + esc(r.technicianName ? r.technicianName + ' (technician)' : r.vendorName ? r.vendorName + ' (vendor)' : 'Not assigned yet') + '</dd><dt>DUE</dt><dd>' + esc(r.dueDate || '—') + '</dd>' +
        (r.completionNotes ? '<dt>COMPLETION</dt><dd style="white-space:pre-wrap">' + esc(r.completionNotes) + '</dd>' : '') + '</dl>' +
        '<form class="form hidden" id="completeForm" data-id="' + r.id + '" style="margin-top:16px"><label for="cNotes">What was done?</label><textarea class="field" id="cNotes" maxlength="2000" placeholder="Describe the work completed"></textarea><p class="alert" id="cErr" role="alert"></p><div class="actions"><button class="btn btn--sm" type="submit">Send for review</button><button class="btn btn--sm btn--quiet" type="button" data-act="cancelComplete">Cancel</button></div></form></div>';
      var blocks = panel('REQ-' + r.id + ' · ' + r.title, head);

      if (isMgr && ['REPORTED', 'UNDER_REVIEW', 'ASSIGNED', 'REOPENED'].indexOf(r.status) >= 0) blocks += assignPanel(r, techs, vendors);
      if (isMgr) blocks += aiPanel(r, d.aiSuggestion);

      var left = blocks;
      var right = '';
      left += panel('Photos and files', '<div class="panel-body">' + (d.attachments.length ? '<div class="files">' + d.attachments.map(function (a) {
        return '<div class="file"><div class="thumb" data-att="' + a.id + '" data-mime="' + esc(a.mime) + '">' + (a.mime === 'application/pdf' ? 'PDF' : 'Loading') + '</div><b style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(a.name) + '">' + esc(a.name) + '</b><span class="muted-sm">' + esc(nice(a.kind)) + ' · ' + size(a.sizeBytes) + ' · ' + esc(a.uploaderName) + '</span><button type="button" class="btn btn--sm btn--line" data-act="openfile" data-att="' + a.id + '">Open</button></div>';
      }).join('') + '</div>' : '<p class="note">No files yet.</p>') + (closed ? '' : '<form class="row" id="fileForm" data-id="' + r.id + '" style="margin-top:14px"><input class="field field--sm" id="fFile" type="file" accept="image/png,image/jpeg,image/webp,application/pdf" style="max-width:320px"><button class="btn btn--sm btn--line" type="submit">' + (me.role === 'TENANT' ? 'Add a photo' : 'Add evidence') + '</button></form><p class="alert" id="fErr" role="alert"></p>') + '</div>');

      if (me.role !== 'TENANT') left += costPanel(d, r);
      if (isMgr || me.role === 'VENDOR') left += quotePanel(d, r);

      right += panel('Conversation', '<div class="panel-body">' + (d.comments.length ? d.comments.map(function (c) { return '<div class="cmt"><div class="hd"><span class="nm">' + esc(c.authorName) + '</span><span class="muted-sm">' + esc(nice(c.authorRole)) + ' · ' + esc(c.createdAt) + '</span></div><div style="white-space:pre-wrap">' + esc(c.body) + '</div></div>'; }).join('') : '<p class="note">No comments yet.</p>') +
        (closed ? '<p class="note" style="margin-top:12px">This request is closed. Reopen it to add comments.</p>' : '<form class="form" id="commentForm" data-id="' + r.id + '" style="margin-top:14px"><textarea class="field" id="cmBody" maxlength="2000" placeholder="Write a message"></textarea><p class="alert" id="cmErr" role="alert"></p><div><button class="btn btn--sm" type="submit">Post comment</button></div></form>') + '</div>');
      right += panel('History', '<div class="panel-body"><ul class="tl">' + d.history.map(function (h) { return '<li><span class="when">' + esc(h.createdAt) + '</span><span>' + esc(h.note) + (h.toStatus && h.toStatus !== h.fromStatus ? ' <span class="muted-sm">→ ' + esc(nice(h.toStatus)) + '</span>' : '') + ' <span class="who">— ' + esc(h.actorName) + '</span></span></li>'; }).join('') + '</ul></div>');

      show('<p><a href="#/requests" style="color:var(--pine);text-decoration:underline">← Back to the list</a></p><div class="two-col"><div class="stack">' + left + '</div><div class="stack">' + right + '</div></div>');
      loadThumbs();
    });
  };

  function assignPanel(r, techs, vendors) {
    var groups = '<option value="">Choose who does the work</option>' +
      (techs.length ? '<optgroup label="Technicians">' + techs.map(function (t) { return '<option value="T:' + t.id + '"' + (r.technicianId === t.id ? ' selected' : '') + '>' + esc(t.fullName) + (t.skills ? ' — ' + esc(t.skills) : '') + '</option>'; }).join('') + '</optgroup>' : '') +
      (vendors.length ? '<optgroup label="Vendors">' + vendors.map(function (v) { return '<option value="V:' + v.id + '"' + (r.vendorId === v.id ? ' selected' : '') + '>' + esc(v.name) + (v.categories.length ? ' — ' + esc(v.categories.map(nice).join(', ')) : '') + '</option>'; }).join('') + '</optgroup>' : '');
    var none = (!techs.length && !vendors.length) ? '<div class="callout callout--warn" style="margin-bottom:14px">There is nobody to assign yet. <a href="#/people" style="text-decoration:underline">Invite a technician</a> or <a href="#/vendors" style="text-decoration:underline">add and approve a vendor</a>.</div>' : '';
    return panel(r.technicianId || r.vendorId ? 'Reassign' : 'Assign', '<form class="form panel-body" id="assignForm" data-id="' + r.id + '">' + none + '<div class="form-grid">' +
      fieldRow('Assign to', '<select class="field" id="aWho">' + groups + '</select>', true) +
      fieldRow('Due date <span class="opt">(optional)</span>', '<input class="field" id="aDue" type="date" value="' + esc(r.dueDate || '') + '">') +
      fieldRow('Priority', '<select class="field" id="aPri">' + opts(PRIORITIES, r.priority) + '</select>') +
      '</div><p class="alert" id="aErr" role="alert"></p><div><button class="btn btn--sm" type="submit">' + (r.technicianId || r.vendorId ? 'Reassign' : 'Assign') + '</button></div></form>');
  }
  function aiPanel(r, s) {
    var body = '<div class="panel-body" id="aiBody">';
    if (s && !s.decision) body += '<p><b>' + esc(nice(s.category)) + '</b> · priority <b>' + esc(nice(s.priority)) + '</b></p><p class="note" style="margin:6px 0 12px">' + esc(s.explanation) + '</p><div class="actions"><button class="btn btn--sm" data-act="aiDecide" data-id="' + s.id + '" data-d="ACCEPT">Accept and apply</button><button class="btn btn--sm btn--line" data-act="aiDecide" data-id="' + s.id + '" data-d="REJECT">Ignore</button></div>';
    else {
      if (s) body += '<p class="note" style="margin-bottom:10px">Last suggestion: ' + esc(nice(s.category)) + ', ' + esc(nice(s.priority)) + ' — ' + esc(s.decision.toLowerCase()) + '.</p>';
      body += '<p class="note" style="margin-bottom:10px">Ask the AI to suggest a category and priority from the description. You decide whether to use it.</p><button class="btn btn--sm btn--line" data-act="aiAsk" data-id="' + r.id + '">Suggest category and priority</button>';
    }
    return panel('AI suggestion', body + '<p class="alert" id="aiErr" role="alert" style="margin-top:10px"></p></div>');
  }
  function costPanel(d, r) {
    var label = me.role === 'VENDOR' ? 'Invoice' : 'Expense';
    var rows = d.expenses.length ? '<div class="sheet"><table class="data"><thead><tr><th>Type</th><th>Description</th><th class="num">Amount</th><th>Status</th></tr></thead><tbody>' + d.expenses.map(function (x) {
      return '<tr><td>' + esc(nice(x.kind)) + '</td><td><div>' + esc(x.description) + '</div><div class="sub">' + esc(x.recordedByName) + ' · ' + esc(x.createdAt) + '</div></td><td class="num">' + money(x.amount) + '</td><td>' + (x.approved ? '<span class="chip s-ver"><span class="bullet"></span>Approved</span><div class="sub">' + esc(x.approvedByName) + '</div>' : (me.role === 'MANAGER' && x.recordedByName !== me.fullName ? '<button class="btn btn--sm" data-act="approve" data-id="' + x.id + '">Approve</button>' : '<span class="chip s-hold"><span class="bullet"></span>Awaiting approval</span>')) + '</td></tr>';
    }).join('') + '</tbody></table></div>' : '<div class="panel-body"><p class="note">Nothing recorded yet.</p></div>';
    var form = r.status === 'CLOSED' ? '' : '<form class="form panel-body" id="expForm" data-id="' + r.id + '" style="border-top:1px solid var(--rule)"><div class="form-grid">' + fieldRow('Amount', '<input class="field field--sm" id="eAmt" type="number" min="0.01" step="0.01" inputmode="decimal" placeholder="0.00">') + fieldRow('What for', '<input class="field field--sm" id="eDesc" maxlength="300" placeholder="Parts, labour…">') + '</div><p class="alert" id="eErr" role="alert"></p><div><button class="btn btn--sm btn--line" type="submit">Record ' + label.toLowerCase() + '</button></div></form>';
    return panel('Cost', rows + form, '<span class="muted-sm">Approved ' + money(d.totalExpense) + ' · Awaiting ' + money(d.pendingExpense) + '</span>');
  }
  function quotePanel(d, r) {
    var rows = d.quotations.length ? '<div class="sheet"><table class="data"><thead><tr><th>Vendor</th><th>Scope</th><th class="num">Amount</th><th>Status</th></tr></thead><tbody>' + d.quotations.map(function (q) {
      return '<tr><td>' + esc(q.vendorName) + '</td><td>' + esc(q.description) + '<div class="sub">' + esc(q.createdAt) + '</div></td><td class="num">' + money(q.amount) + '</td><td>' + (q.status === 'PENDING' && me.role === 'MANAGER' ? '<div class="actions"><button class="btn btn--sm" data-act="quote" data-id="' + q.id + '" data-d="APPROVE">Approve</button><button class="btn btn--sm btn--line" data-act="quote" data-id="' + q.id + '" data-d="REJECT">Reject</button></div>' : esc(nice(q.status))) + '</td></tr>';
    }).join('') + '</tbody></table></div>' : '<div class="panel-body"><p class="note">No quotations.</p></div>';
    var form = (me.role === 'VENDOR' && ['COMPLETED', 'CLOSED'].indexOf(r.status) < 0) ? '<form class="form panel-body" id="quoteForm" data-id="' + r.id + '" style="border-top:1px solid var(--rule)"><div class="form-grid">' + fieldRow('Quote amount', '<input class="field field--sm" id="qAmt" type="number" min="0.01" step="0.01" inputmode="decimal">') + fieldRow('Scope of work', '<input class="field field--sm" id="qDesc" maxlength="500">') + '</div><p class="alert" id="qErr" role="alert"></p><div><button class="btn btn--sm btn--line" type="submit">Submit quotation</button></div></form>' : '';
    return panel('Quotations', rows + form);
  }

  /* ================= properties ================= */
  var selProp = null;
  VIEWS.properties = function () {
    return get('/properties').then(function (props) {
      var table = props.length ? '<div class="sheet"><table class="data data--wide"><thead><tr><th>Property</th><th>Address</th><th>Type</th><th class="num">Units</th><th></th></tr></thead><tbody>' + props.map(function (p) {
        return '<tr' + (selProp === p.id ? ' style="background:#F4F8F5"' : '') + '><td class="strong">' + esc(p.name) + '</td><td class="sub">' + esc(p.address || '—') + '</td><td>' + esc(nice(p.propertyType)) + '</td><td class="num">' + p.unitCount + '</td><td><button class="btn btn--sm btn--line" data-act="units" data-id="' + p.id + '">Units</button></td></tr>';
      }).join('') + '</tbody></table></div>' : empty('No properties yet', 'Add your first property below, then add its units.');
      var form = '<form class="form panel-body" id="propForm" style="border-top:1px solid var(--rule)"><div class="form-grid">' + fieldRow('Property name', '<input class="field field--sm" id="pName" maxlength="160">') + fieldRow('Address <span class="opt">(optional)</span>', '<input class="field field--sm" id="pAddr" maxlength="255">') + '</div><p class="alert" id="pErr" role="alert"></p><div><button class="btn btn--sm" type="submit">Add property</button></div></form>';
      show(panel('Properties', table + form) + '<div id="unitsHolder"></div>');
      if (selProp && props.some(function (p) { return p.id === selProp; })) return loadUnits(selProp, props);
    });
  };
  function loadUnits(id, props) {
    selProp = id;
    return get('/properties/' + id + '/units').then(function (units) {
      var p = (props || []).filter(function (x) { return x.id === id; })[0];
      var rows = units.length ? '<div class="sheet"><table class="data data--wide"><thead><tr><th>Unit</th><th>Tenants</th><th>Add a tenant by email</th></tr></thead><tbody>' + units.map(function (u) {
        return '<tr><td class="strong">' + esc(u.label) + '</td><td>' + esc(u.tenantNames || '—') + '</td><td><form class="row linkForm" data-unit="' + u.id + '"><input class="field field--sm" type="email" placeholder="tenant@example.com" style="max-width:240px" aria-label="Tenant email"><button class="btn btn--sm btn--line" type="submit">Add</button></form></td></tr>';
      }).join('') + '</tbody></table></div>' : empty('No units yet', 'Add the flats or rooms in this property.');
      var form = '<form class="form panel-body" id="unitForm" data-prop="' + id + '" style="border-top:1px solid var(--rule)"><div class="row"><input class="field field--sm" id="uLabel" maxlength="40" placeholder="Unit label, for example 7B" style="max-width:260px"><button class="btn btn--sm" type="submit">Add unit</button></div><p class="alert" id="uErr" role="alert"></p></form>';
      var hint = '<div class="panel-body" style="padding-top:0"><p class="note">The tenant must already have an account (they can sign up on the sign-in page), or <a href="#/people" style="text-decoration:underline">send them an invitation</a> for this unit.</p></div>';
      var holder = $('unitsHolder');
      if (holder) holder.innerHTML = panel((p ? p.name : 'Property') + ' · units', rows + hint + form);
    });
  }

  /* ================= people ================= */
  VIEWS.people = function () {
    return Promise.all([get('/team'), get('/invitations'), get('/vendors'), get('/properties'), get('/organization')]).then(function (res) {
      var team = res[0], invites = res[1], vendors = res[2], props = res[3], org = res[4];
      return Promise.all(props.map(function (p) { return get('/properties/' + p.id + '/units'); })).then(function (unitLists) {
        var units = [];
        unitLists.forEach(function (l, i) { l.forEach(function (u) { units.push([u.id, props[i].name + ' · ' + u.label]); }); });
        var pre = pendingInvite || {}; pendingInvite = null;
        var roles = [['TENANT', 'Tenant'], ['TECHNICIAN', 'Technician'], ['VENDOR', 'Vendor staff member']].concat(org.isAdmin ? [['MANAGER', 'Manager']] : []);
        var invite = '<form class="form panel-body" id="inviteForm"><div class="form-grid">' + fieldRow('Email', '<input class="field field--sm" id="iEmail" type="email" placeholder="person@example.com">') +
          fieldRow('Role', '<select class="field field--sm" id="iRole">' + opts(roles, pre.role || 'TENANT') + '</select>') +
          '<div id="iUnitRow">' + fieldRow('Unit <span class="opt">(optional)</span>', '<select class="field field--sm" id="iUnit">' + opts(units, '', 'No unit yet') + '</select>') + '</div>' +
          '<div id="iVendorRow" class="hidden">' + fieldRow('Vendor company', '<select class="field field--sm" id="iVendor">' + opts(vendors.map(function (v) { return [v.id, v.name + ' (' + v.status.toLowerCase() + ')']; }), pre.vendorId, 'Choose a company') + '</select>') + '</div></div>' +
          '<p class="alert" id="iErr" role="alert"></p><div id="iResult"></div><div><button class="btn btn--sm" type="submit">Create invitation</button></div></form>';
        var pend = invites.length ? '<div class="sheet"><table class="data data--wide"><thead><tr><th>Email</th><th>Role</th><th>For</th><th>Expires</th><th></th></tr></thead><tbody>' + invites.map(function (i) {
          return '<tr><td>' + esc(i.email) + '</td><td>' + esc(nice(i.role)) + (i.kind === 'RESET' ? ' (password reset)' : '') + '</td><td>' + esc(i.vendorName || i.unit || '—') + '</td><td class="sub">' + esc(i.expiresAt) + '</td><td><button class="btn btn--sm btn--quiet" data-act="revoke" data-id="' + i.id + '">Revoke</button></td></tr>';
        }).join('') + '</tbody></table></div>' : '<div class="panel-body"><p class="note">No invitations waiting.</p></div>';
        var people = '<div class="sheet"><table class="data data--wide"><thead><tr><th>Name</th><th>Role</th><th>Email</th><th>Status</th><th></th></tr></thead><tbody>' + team.map(function (t) {
          return '<tr><td class="strong">' + esc(t.fullName) + (t.skills ? '<div class="sub">' + esc(t.skills) + '</div>' : '') + (t.vendorName ? '<div class="sub">' + esc(t.vendorName) + '</div>' : '') + '</td><td>' + esc(nice(t.role)) + (t.orgAdmin ? ' <span class="pill">Admin</span>' : '') + '</td><td class="sub">' + esc(t.email) + '</td><td>' + (t.active ? 'Active' : '<span class="pill pill--urgent">Deactivated</span>') + '</td><td>' +
            (t.email === me.email ? '' : '<div class="actions"><button class="btn btn--sm btn--quiet" data-act="toggle" data-id="' + t.id + '" data-active="' + (t.active ? 'false' : 'true') + '">' + (t.active ? 'Deactivate' : 'Reactivate') + '</button><button class="btn btn--sm btn--quiet" data-act="reset" data-id="' + t.id + '">Reset link</button><button class="btn btn--sm btn--quiet" data-act="mfaReset" data-id="' + t.id + '" title="Use when someone lost their phone">Reset two-factor</button>' + (t.active ? '' : '<button class="btn btn--sm btn--quiet" data-act="erase" data-id="' + t.id + '" title="Remove this person\'s name and contact details for good">Erase personal data</button>') + '</div>') + '</td></tr>';
        }).join('') + '</tbody></table></div><div class="panel-body" id="resetResult" style="padding-top:0"></div>';
        var orgForm = '<form class="form panel-body" id="orgForm"><div class="form-grid">' + fieldRow('Organization name', '<input class="field field--sm" id="oName" value="' + esc(org.name) + '"' + (org.isAdmin ? '' : ' disabled') + '>') + fieldRow('Approval limit <span class="opt">(managers other than the admin cannot approve above this; empty = no limit)</span>', '<input class="field field--sm" id="oLimit" type="number" min="0.01" step="0.01" value="' + (org.approvalLimit == null ? '' : org.approvalLimit) + '"' + (org.isAdmin ? '' : ' disabled') + '>') + '</div><p class="alert" id="oErr" role="alert"></p>' + (org.isAdmin ? '<div><button class="btn btn--sm btn--line" type="submit">Save</button></div>' : '<p class="note">Only the organization admin can change these.</p>') + '</form>';
        show(panel('Invite someone', invite) + panel('Waiting for a reply', pend) + panel('People in ' + org.name, people) + panel('Organization settings', orgForm));
        toggleInviteRows();
      });
    });
  };
  function toggleInviteRows() {
    var role = $('iRole'); if (!role) return;
    $('iUnitRow').classList.toggle('hidden', role.value !== 'TENANT');
    $('iVendorRow').classList.toggle('hidden', role.value !== 'VENDOR');
  }

  /* ================= vendors ================= */
  VIEWS.vendors = function () {
    return get('/vendors').then(function (vs) {
      var table = vs.length ? '<div class="sheet"><table class="data data--wide"><thead><tr><th>Company</th><th>Services</th><th>Contact</th><th class="num">Staff</th><th class="num">Open jobs</th><th>Status</th><th></th></tr></thead><tbody>' + vs.map(function (v) {
        return '<tr><td class="strong">' + esc(v.name) + '</td><td class="sub">' + esc(v.categories.map(nice).join(', ') || '—') + '</td><td class="sub">' + esc(v.contactEmail) + (v.phone ? '<br>' + esc(v.phone) : '') + '</td><td class="num">' + v.memberCount + '</td><td class="num">' + v.openJobs + '</td>' +
          '<td><select class="field field--sm vstatus" data-id="' + v.id + '" aria-label="Status of ' + esc(v.name) + '">' + opts(['PENDING', 'ACTIVE', 'SUSPENDED', 'INACTIVE'], v.status) + '</select></td><td><button class="btn btn--sm btn--line" data-act="inviteVendor" data-id="' + v.id + '">Invite staff</button></td></tr>';
      }).join('') + '</tbody></table></div><div class="panel-body" style="padding-top:12px"><p class="note">A vendor starts as <b>Pending</b>. Set it to <b>Active</b> to let it receive work. Suspended or inactive vendors lose access to their work orders.</p></div>' : empty('No vendors yet', 'Add the maintenance companies you work with.');
      var form = '<form class="form panel-body" id="vendorForm" style="border-top:1px solid var(--rule)"><div class="form-grid">' + fieldRow('Company name', '<input class="field field--sm" id="vName" maxlength="160">') + fieldRow('Contact email', '<input class="field field--sm" id="vEmail" type="email">') + fieldRow('Phone <span class="opt">(optional)</span>', '<input class="field field--sm" id="vPhone" maxlength="40">') +
        fieldRow('Services', '<div class="checks" id="vCats">' + CATEGORIES.map(function (c) { return '<label><input type="checkbox" value="' + c + '"> ' + esc(nice(c)) + '</label>'; }).join('') + '</div>') + '</div><p class="alert" id="vErr" role="alert"></p><div><button class="btn btn--sm" type="submit">Add vendor</button></div></form>';
      show(panel('Vendors', table + form));
    });
  };

  VIEWS.company = function () {
    return get('/vendors/me').then(function (v) {
      show(panel(v.name, '<form class="form panel-body" id="companyForm"><div class="callout' + (v.status === 'ACTIVE' ? '' : ' callout--warn') + '">Status: <b>' + esc(nice(v.status)) + '</b>. ' + (v.status === 'ACTIVE' ? 'You can receive work orders.' : v.status === 'PENDING' ? 'A manager must approve your company before you can receive work.' : 'You cannot receive new work.') + '</div><div class="form-grid">' +
        fieldRow('Contact email', '<input class="field" value="' + esc(v.contactEmail) + '" disabled>') + fieldRow('Phone', '<input class="field" id="cPhone" maxlength="40" value="' + esc(v.phone || '') + '">') +
        fieldRow('Services you offer', '<div class="checks" id="cCats">' + CATEGORIES.map(function (c) { return '<label><input type="checkbox" value="' + c + '"' + (v.categories.indexOf(c) >= 0 ? ' checked' : '') + '> ' + esc(nice(c)) + '</label>'; }).join('') + '</div>', true) +
        '</div><p class="alert" id="cErr2" role="alert"></p><div><button class="btn btn--sm" type="submit">Save</button></div></form>'));
    });
  };

  /* ================= insights, activity, notifications ================= */
  VIEWS.insights = function () {
    return Promise.all([get('/insights'), get('/ai/status')]).then(function (res) {
      var i = res[0], ai = res[1];
      function list(items, none) { return items.length ? '<div class="panel-body"><ul class="tl">' + items.join('') + '</ul></div>' : empty('Nothing to flag', none); }
      show('<p class="note">Analysis of your stored requests and expenses. It uses simple rules, not an AI model.</p>' +
        panel('Repeat problems', list(i.recurringIssues.map(function (x) { return '<li><span class="when">' + x.occurrences + ' reports</span><span><b>' + esc(x.propertyName) + ' · ' + esc(x.unitLabel) + '</b> — ' + esc(x.explanation) + '</span></li>'; }), 'No unit has reported the same kind of problem more than once in 90 days.')) +
        panel('Unusual costs', list(i.costAnomalies.map(function (x) { return '<li><span class="when">' + money(x.amount) + '</span><span><a href="#/request/' + x.requestId + '" style="text-decoration:underline">' + esc(x.title) + '</a> — ' + esc(x.explanation) + '</span></li>'; }), 'Needs at least four expenses in a category to compare.')) +
        panel('AI suggestions', '<div class="panel-body"><p class="note">' + (ai.configured ? 'Connected to ' + esc(ai.provider) + ' (' + esc(ai.model) + '). Open a request and press <b>Suggest category and priority</b>.' : 'Not set up. Add <code>GEMINI_API_KEY</code> to the server settings to turn on category and priority suggestions. Everything else works without it.') + '</p></div>'));
    });
  };
  VIEWS.activity = function () {
    return get('/audit?limit=100').then(function (rows) {
      show(panel('Activity log', rows.length ? '<div class="sheet"><table class="data data--wide"><thead><tr><th>When</th><th>Who</th><th>What</th><th>Detail</th></tr></thead><tbody>' + rows.map(function (l) { return '<tr><td class="sub">' + esc(l.createdAt) + '</td><td>' + esc(l.actorName) + '</td><td>' + esc(nice(l.action)) + '</td><td class="sub">' + esc(l.detail || '') + '</td></tr>'; }).join('') + '</tbody></table></div>' : empty('Nothing recorded', 'Administrative and financial actions appear here.'), '<span class="muted-sm">Latest 100</span>'));
    });
  };
  VIEWS.notifications = function () {
    return get('/notifications').then(function (list) {
      show(panel('Notifications', list.length ? '<div class="panel-body"><ul class="tl">' + list.map(function (n) { return '<li' + (n.requestId ? ' class="clickable" data-act="notif" data-id="' + n.id + '" data-req="' + n.requestId + '"' : '') + '><span class="when">' + esc(n.createdAt) + '</span><span' + (n.read ? ' style="color:var(--slate)"' : ' style="font-weight:500"') + '>' + esc(n.message) + '</span></li>'; }).join('') + '</ul></div>' : empty('You are up to date', 'Updates about your requests appear here.'),
        list.some(function (n) { return !n.read; }) ? '<button class="btn btn--sm btn--line" data-act="readall">Mark all as read</button>' : ''));
    });
  };

  /* ================= account ================= */
  function mfaPanel(m) {
    var banner = m.mfaRequired ? '<p class="alert" style="display:block;margin:0 0 12px">Your organization requires managers to use two-factor sign-in. Set it up here to continue.</p>' : '';
    if (m.mfaEnabled) {
      return '<form class="form panel-body" id="mfaOffForm">' + banner + '<p class="note" style="margin:0 0 10px">Two-factor sign-in is <b>on</b>. To turn it off, confirm with your password and a current code (or a recovery code).</p><div class="form-grid">' +
        fieldRow('Password', '<input class="field" id="mfoPw" type="password" autocomplete="current-password">') + fieldRow('Code', '<input class="field" id="mfoCode" inputmode="numeric" autocomplete="one-time-code" maxlength="12">') +
        '</div><p class="alert" id="mfoErr" role="alert"></p><div><button class="btn btn--sm btn--line" type="submit">Turn off two-factor</button></div></form>';
    }
    return '<div class="panel-body" id="mfaBox">' + banner + '<p class="note" style="margin:0 0 10px">Add a second step to signing in: a 6-digit code from an authenticator app such as Google Authenticator, Microsoft Authenticator or 1Password.</p>' +
      '<form class="form" id="mfaStartForm"><div class="form-grid">' + fieldRow('Your password', '<input class="field" id="mfsPw" type="password" autocomplete="current-password">') + '</div><p class="alert" id="mfsErr" role="alert"></p><div><button class="btn btn--sm" type="submit">Set up two-factor</button></div></form></div>';
  }
  function dataPanel() {
    return '<div class="panel-body"><p class="note" style="margin:0 0 10px">You can download everything EstateOps holds about you, or ask for your account to be erased.</p>' +
      '<div class="actions" style="margin-bottom:16px"><button class="btn btn--sm btn--line" data-act="exportData">Download my data</button></div>' +
      '<form class="form" id="deleteAccountForm"><p class="note" style="margin:0 0 10px"><b>Erase my account.</b> Your name, email, phone and anything you wrote are removed for good. Maintenance records for the property stay, shown as “Deleted user”. This cannot be undone.</p><div class="form-grid">' +
      fieldRow('Your password', '<input class="field" id="delPw" type="password" autocomplete="current-password">') +
      fieldRow('Type DELETE to confirm', '<input class="field" id="delConfirm" autocomplete="off" placeholder="DELETE">') +
      '</div><p class="alert" id="delErr" role="alert"></p><div><button class="btn btn--sm btn--line" type="submit">Erase my account</button></div></form></div>';
  }
  function sessionsPanel(list) {
    var rows = list.map(function (s) {
      return '<tr><td>' + esc((s.device || 'Unknown device').slice(0, 70)) + (s.current ? ' <span class="tag">This device</span>' : '') + '</td><td class="sub">' + esc(s.ip || '') + '</td><td class="sub">' + esc(new Date(s.lastSeenAt).toLocaleString()) + '</td><td>' +
        (s.current ? '' : '<button class="btn btn--sm btn--quiet" data-act="endSession" data-id="' + s.id + '">Sign out</button>') + '</td></tr>';
    }).join('');
    return '<div class="sheet"><table class="data"><thead><tr><th>Device</th><th>Address</th><th>Last active</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="panel-foot"><span class="grow"><button class="btn btn--sm btn--line" data-act="logoutAll">Sign out everywhere</button></span></div>';
  }

  VIEWS.account = function () {
    return Promise.all([get('/auth/me'), get('/auth/sessions')]).then(function (res) {
      var m = res[0], sessions = res[1];
      me = m;
      show(panel('Your profile', '<form class="form panel-body" id="profileForm"><div class="form-grid">' + fieldRow('Full name', '<input class="field" id="aName" maxlength="120" value="' + esc(m.fullName) + '">') + fieldRow('Email', '<input class="field" value="' + esc(m.email) + '" disabled>') + fieldRow('Phone', '<input class="field" id="aPhone" maxlength="40" value="' + esc(m.phone || '') + '">') +
        (m.role === 'TECHNICIAN' ? fieldRow('Skills and trades', '<input class="field" id="aSkills" maxlength="200" value="' + esc(m.skills || '') + '">') : '') + fieldRow('Role', '<input class="field" value="' + esc(nice(m.role)) + (m.vendorName ? ' at ' + esc(m.vendorName) : '') + (m.organizationName ? ' · ' + esc(m.organizationName) : '') + '" disabled>', true) + '</div><p class="alert" id="prErr" role="alert"></p><div><button class="btn btn--sm" type="submit">Save profile</button></div></form>') +
        panel('Change password', '<form class="form panel-body" id="pwForm"><div class="form-grid">' + fieldRow('Current password', '<input class="field" id="pwCur" type="password" autocomplete="current-password">') + fieldRow('New password', '<input class="field" id="pwNew" type="password" autocomplete="new-password" placeholder="At least 8 characters">') + '</div><p class="alert" id="pwErr" role="alert"></p><div><button class="btn btn--sm" type="submit">Change password</button></div><p class="note">Changing your password signs you out on your other devices.</p></form>'),
        panel('Two-factor sign-in', mfaPanel(m)),
        panel('Where you are signed in', sessionsPanel(sessions)),
        panel('Your data', dataPanel()));
    });
  };

  /* ================= files ================= */
  function fetchBlob(id) {
    return fetch('/api/attachments/' + id, { headers: { Authorization: 'Bearer ' + auth.token } }).then(function (r) {
      if (!r.ok) throw new Error('That file could not be opened.');
      return r.blob();
    });
  }
  function loadThumbs() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-att]'), function (el) {
      if (el.tagName === 'BUTTON' || (el.dataset.mime || '').indexOf('image/') !== 0) return;
      fetchBlob(el.dataset.att).then(function (b) {
        var u = URL.createObjectURL(b); blobUrls.push(u);
        el.innerHTML = '<img alt="Attached photo" src="' + u + '">';
      }).catch(function () { el.textContent = 'Unavailable'; });
    });
  }

  /* ================= actions (clicks) ================= */
  function done(msg) { reload(); if (msg) setTimeout(function () { flash(msg, true); }, 60); }
  function fail(e) { flash(e.message || 'That did not work.'); }
  function inlineErr(id, e) { var el = $(id); if (el) el.textContent = e.message || 'That did not work.'; }

  var ACTIONS = {
    open: function (el) { location.hash = '#/request/' + el.dataset.id; },
    page: function (el) { listState.page = Math.max(0, listState.page + Number(el.dataset.d)); reload(); },
    copy: function (el) { copyText(el.dataset.text).then(function () { el.textContent = 'Copied'; }); },
    status: function (el) {
      if (el.dataset.to === 'COMPLETED') { $('completeForm').classList.remove('hidden'); $('cNotes').focus(); return; }
      busy(el, true);
      send('/maintenance-requests/' + el.dataset.id + '/status', { target: el.dataset.to }).then(function () { done('Status updated.'); }).catch(function (e) { busy(el, false); fail(e); });
    },
    cancelComplete: function () { $('completeForm').classList.add('hidden'); },
    aiAsk: function (el) { busy(el, true, 'Asking…'); send('/maintenance-requests/' + el.dataset.id + '/ai-suggestion').then(function () { done(); }).catch(function (e) { busy(el, false); inlineErr('aiErr', e); }); },
    aiDecide: function (el) { send('/ai-suggestions/' + el.dataset.id + '/decision', { decision: el.dataset.d }).then(function () { done(el.dataset.d === 'ACCEPT' ? 'Suggestion applied.' : 'Suggestion ignored.'); }).catch(fail); },
    approve: function (el) { busy(el, true); send('/expenses/' + el.dataset.id + '/approve').then(function () { done('Approved.'); }).catch(function (e) { busy(el, false); fail(e); }); },
    quote: function (el) { send('/quotations/' + el.dataset.id + '/decision', { decision: el.dataset.d }).then(function () { done('Quotation ' + (el.dataset.d === 'APPROVE' ? 'approved.' : 'rejected.')); }).catch(fail); },
    openfile: function (el) {
      var w = window.open('', '_blank');
      fetchBlob(el.dataset.att).then(function (b) { var u = URL.createObjectURL(b); blobUrls.push(u); if (w) w.location = u; else location.href = u; }).catch(function (e) { if (w) w.close(); fail(e); });
    },
    units: function (el) { selProp = Number(el.dataset.id); reload(); },
    revoke: function (el) { send('/invitations/' + el.dataset.id + '/revoke').then(function () { done('Invitation revoked.'); }).catch(fail); },
    toggle: function (el) { send('/accounts/' + el.dataset.id + '/status', { active: el.dataset.active === 'true' }).then(function () { done('Account updated.'); }).catch(fail); },
    reset: function (el) {
      send('/accounts/' + el.dataset.id + '/reset-link').then(function (r) { $('resetResult').innerHTML = linkBox(r.path, 'Password reset link for ' + r.email + '.', r.emailed); }).catch(fail);
    },
    erase: function (el) {
      if (!window.confirm('Erase this person\'s personal data? Their name, email and phone are removed for good. Maintenance records stay, shown as “Deleted user”. This cannot be undone.')) return;
      send('/accounts/' + el.dataset.id + '/erase', { confirm: 'ERASE' }).then(function () { done('Personal data erased.'); }).catch(fail);
    },
    mfaReset: function (el) { if (!window.confirm('Switch off two-factor sign-in for this person? Use this only if they lost their phone and recovery codes.')) return; send('/accounts/' + el.dataset.id + '/mfa-reset').then(function () { done('Two-factor sign-in was switched off for that person.'); }).catch(fail); },
    exportData: function (el) {
      busy(el, true, 'Preparing…');
      api('/auth/my-data').then(function (r) {
        var u = URL.createObjectURL(new Blob([JSON.stringify(r.data, null, 2)], { type: 'application/json' }));
        var a = document.createElement('a'); a.href = u; a.download = 'estateops-my-data.json'; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(u); }, 10000);
        busy(el, false); flash('Your data was downloaded.', true);
      }).catch(function (e) { busy(el, false); fail(e); });
    },
    endSession: function (el) { send('/auth/sessions/' + el.dataset.id + '/revoke').then(function () { done('Device signed out.'); }).catch(fail); },
    logoutAll: function () { send('/auth/logout-all').then(leave).catch(fail); },
    reloadAccount: function () { reload(); },
    inviteVendor: function (el) { pendingInvite = { role: 'VENDOR', vendorId: el.dataset.id }; location.hash = '#/people'; },
    notif: function (el) { send('/notifications/' + el.dataset.id + '/read').then(function () { location.hash = '#/request/' + el.dataset.req; }).catch(function () { location.hash = '#/request/' + el.dataset.req; }); },
    readall: function () { send('/notifications/read-all').then(function () { reload(); }).catch(fail); }
  };
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]');
    if (!el || !ACTIONS[el.dataset.act]) return;
    if (el.tagName === 'A') e.preventDefault();
    ACTIONS[el.dataset.act](el, e);
  });

  /* ---- filters and selects ---- */
  var searchTimer = null;
  document.addEventListener('input', function (e) {
    if (e.target.id === 'fq') {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () { listState.q = e.target.value.trim(); listState.page = 0; listState.focusSearch = true; reload(); }, 280);
    }
  });
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t.id === 'fs') { listState.status = t.value; listState.page = 0; reload(); }
    else if (t.id === 'fp') { listState.priority = t.value; listState.page = 0; reload(); }
    else if (t.id === 'iRole') toggleInviteRows();
    else if (t.classList.contains('vstatus')) {
      send('/vendors/' + t.dataset.id + '/status', { status: t.value }).then(function () { flash('Vendor status updated.', true); reload(); }).catch(fail);
    }
  });

  /* ================= forms ================= */
  function categoriesFrom(id) { return Array.prototype.map.call(document.querySelectorAll('#' + id + ' input:checked'), function (c) { return c.value; }); }
  function uploadFile(requestId, file) {
    var fd = new FormData(); fd.append('file', file);
    return api('/maintenance-requests/' + requestId + '/attachments', { body: fd });
  }
  var FORMS = {
    reportForm: function (f, btn) {
      var title = $('rTitle').value.trim(), desc = $('rDesc').value.trim(), file = $('rFile').files[0];
      if (!title) return inlineErr('rErr', new Error('Give the problem a short title.'));
      if (!desc) return inlineErr('rErr', new Error('Describe the problem so it can be fixed.'));
      busy(btn, true, 'Sending…');
      send('/maintenance-requests', { unitId: Number($('rUnit').value), title: title, description: desc, category: $('rCat').value, priority: $('rPri').value }).then(function (r) {
        var up = file ? uploadFile(r.id, file).catch(function (e) { flash('Your report was sent, but the photo could not be added: ' + e.message); }) : Promise.resolve();
        return up.then(function () { location.hash = '#/request/' + r.id; });
      }).catch(function (e) { busy(btn, false); inlineErr('rErr', e); });
    },
    completeForm: function (f, btn) {
      var n = $('cNotes').value.trim(); if (!n) return inlineErr('cErr', new Error('Describe what was done.'));
      busy(btn, true);
      send('/maintenance-requests/' + f.dataset.id + '/status', { target: 'COMPLETED', completionNotes: n }).then(function () { done('Sent for review.'); }).catch(function (e) { busy(btn, false); inlineErr('cErr', e); });
    },
    fileForm: function (f, btn) {
      var file = $('fFile').files[0]; if (!file) return inlineErr('fErr', new Error('Choose a file first.'));
      busy(btn, true, 'Uploading…');
      uploadFile(f.dataset.id, file).then(function () { done('File added.'); }).catch(function (e) { busy(btn, false); inlineErr('fErr', e); });
    },
    commentForm: function (f, btn) {
      var b = $('cmBody').value.trim(); if (!b) return inlineErr('cmErr', new Error('Write a message first.'));
      busy(btn, true);
      send('/maintenance-requests/' + f.dataset.id + '/comments', { body: b }).then(function () { reload(); }).catch(function (e) { busy(btn, false); inlineErr('cmErr', e); });
    },
    expForm: function (f, btn) {
      busy(btn, true);
      send('/maintenance-requests/' + f.dataset.id + '/expenses', { amount: Number($('eAmt').value), description: $('eDesc').value.trim() }).then(function () { done('Recorded. A manager must approve it.'); }).catch(function (e) { busy(btn, false); inlineErr('eErr', e); });
    },
    quoteForm: function (f, btn) {
      busy(btn, true);
      send('/maintenance-requests/' + f.dataset.id + '/quotations', { amount: Number($('qAmt').value), description: $('qDesc').value.trim() }).then(function () { done('Quotation sent.'); }).catch(function (e) { busy(btn, false); inlineErr('qErr', e); });
    },
    assignForm: function (f, btn) {
      var who = $('aWho').value; if (!who) return inlineErr('aErr', new Error('Choose who should do the work.'));
      var body = { dueDate: $('aDue').value || undefined, priority: $('aPri').value };
      if (who.charAt(0) === 'T') body.technicianId = Number(who.slice(2)); else body.vendorId = Number(who.slice(2));
      busy(btn, true);
      send('/maintenance-requests/' + f.dataset.id + '/assign', body).then(function () { done('Assigned.'); }).catch(function (e) { busy(btn, false); inlineErr('aErr', e); });
    },
    propForm: function (f, btn) {
      busy(btn, true);
      send('/properties', { name: $('pName').value.trim(), address: $('pAddr').value.trim() }).then(function (p) { selProp = p.id; done('Property added. Now add its units.'); }).catch(function (e) { busy(btn, false); inlineErr('pErr', e); });
    },
    unitForm: function (f, btn) {
      busy(btn, true);
      send('/units', { propertyId: Number(f.dataset.prop), label: $('uLabel').value.trim() }).then(function () { done('Unit added.'); }).catch(function (e) { busy(btn, false); inlineErr('uErr', e); });
    },
    inviteForm: function (f, btn) {
      var role = $('iRole').value, body = { email: $('iEmail').value.trim(), role: role };
      if (role === 'TENANT' && $('iUnit').value) body.unitId = Number($('iUnit').value);
      if (role === 'VENDOR') body.vendorId = Number($('iVendor').value) || undefined;
      busy(btn, true);
      send('/invitations', body).then(function (r) {
        busy(btn, false); $('iErr').textContent = ''; $('iEmail').value = '';
        $('iResult').innerHTML = linkBox(r.path, 'Invitation created for ' + r.email + '.', r.emailed);
      }).catch(function (e) { busy(btn, false); inlineErr('iErr', e); });
    },
    orgForm: function (f, btn) {
      if (!btn) return;
      var lim = $('oLimit').value;
      send('/organization', { name: $('oName').value.trim(), approvalLimit: lim === '' ? null : Number(lim) }, 'PUT').then(function () { done('Organization updated.'); }).catch(function (e) { inlineErr('oErr', e); });
    },
    vendorForm: function (f, btn) {
      busy(btn, true);
      send('/vendors', { name: $('vName').value.trim(), contactEmail: $('vEmail').value.trim(), phone: $('vPhone').value.trim(), categories: categoriesFrom('vCats') }).then(function () { done('Vendor added as pending. Set it to Active when you are ready to send it work.'); }).catch(function (e) { busy(btn, false); inlineErr('vErr', e); });
    },
    companyForm: function (f, btn) {
      busy(btn, true);
      send('/vendors/me', { phone: $('cPhone').value.trim(), categories: categoriesFrom('cCats') }, 'PUT').then(function () { done('Saved.'); }).catch(function (e) { busy(btn, false); inlineErr('cErr2', e); });
    },
    profileForm: function (f, btn) {
      busy(btn, true);
      send('/auth/profile', { fullName: $('aName').value.trim(), phone: $('aPhone').value.trim(), skills: $('aSkills') ? $('aSkills').value.trim() : undefined }, 'PUT').then(function (m) { me = m; fillUser(); done('Profile saved.'); }).catch(function (e) { busy(btn, false); inlineErr('prErr', e); });
    },
    mfaStartForm: function (f, btn) {
      busy(btn, true);
      send('/auth/mfa/setup', { password: $('mfsPw').value }).then(function (r) {
        $('mfaBox').innerHTML = '<p class="note" style="margin:0 0 10px"><b>1.</b> In your authenticator app choose “Enter a setup key” and type this key (account: ' + esc(me.email) + ', type: time-based):</p><p><code style="font-size:15px;letter-spacing:.08em;word-break:break-all">' + esc(r.secret.replace(/(.{4})/g, '$1 ').trim()) + '</code></p>' +
          '<p class="note" style="margin:10px 0"><b>2.</b> Enter the 6-digit code the app now shows:</p><form class="form" id="mfaEnableForm"><div class="form-grid">' + fieldRow('Code', '<input class="field" id="mfeCode" inputmode="numeric" autocomplete="one-time-code" maxlength="8">') + '</div><p class="alert" id="mfeErr" role="alert"></p><div><button class="btn btn--sm" type="submit">Turn on two-factor</button></div></form>';
        $('mfeCode').focus();
      }).catch(function (e) { busy(btn, false); inlineErr('mfsErr', e); });
    },
    mfaEnableForm: function (f, btn) {
      busy(btn, true);
      send('/auth/mfa/enable', { code: $('mfeCode').value }).then(function (r) {
        $('mfaBox').innerHTML = '<p><b>Two-factor sign-in is on.</b></p><p class="note" style="margin:8px 0">Save these recovery codes somewhere safe, such as a password manager. Each one works once if you lose your phone. <b>They are shown only now.</b></p>' +
          '<pre style="background:var(--paper-2);padding:12px;border-radius:6px;columns:2;margin:0 0 12px">' + r.recoveryCodes.map(esc).join('\n') + '</pre><button class="btn btn--sm" data-act="reloadAccount">I have saved them</button>';
      }).catch(function (e) { busy(btn, false); inlineErr('mfeErr', e); });
    },
    mfaOffForm: function (f, btn) {
      busy(btn, true);
      send('/auth/mfa/disable', { password: $('mfoPw').value, code: $('mfoCode').value }).then(function () { done('Two-factor sign-in turned off.'); }).catch(function (e) { busy(btn, false); inlineErr('mfoErr', e); });
    },
    deleteAccountForm: function (f, btn) {
      if (!window.confirm('Erase your account? This cannot be undone.')) return;
      busy(btn, true);
      send('/auth/delete-account', { password: $('delPw').value, confirm: $('delConfirm').value }).then(function () {
        window.alert('Your account has been erased.'); leave();
      }).catch(function (e) { busy(btn, false); inlineErr('delErr', e); });
    },
    pwForm: function (f, btn) {
      busy(btn, true);
      send('/auth/change-password', { currentPassword: $('pwCur').value, newPassword: $('pwNew').value }).then(function (r) {
        auth.token = r.token; try { localStorage.setItem('eo_auth', JSON.stringify(auth)); } catch (x) {}
        done('Password changed. Other devices were signed out.');
      }).catch(function (e) { busy(btn, false); inlineErr('pwErr', e); });
    }
  };
  document.addEventListener('submit', function (e) {
    var f = e.target;
    e.preventDefault();
    var btn = f.querySelector('button[type=submit]');
    if (f.classList.contains('linkForm')) {
      var email = f.querySelector('input').value.trim();
      if (!email) return;
      send('/units/' + f.dataset.unit + '/tenants', { email: email }).then(function () { done('Tenant added to the unit.'); }).catch(fail);
      return;
    }
    if (FORMS[f.id]) FORMS[f.id](f, btn);
  });

  /* ================= start ================= */
  function fillUser() {
    $('who').textContent = me.fullName;
    $('whoRole').textContent = nice(me.role) + (me.vendorName ? ' · ' + me.vendorName : '');
    $('avatar').textContent = (me.fullName || '?').split(/\s+/).map(function (p) { return p[0]; }).slice(0, 2).join('').toUpperCase();
  }
  $('logout').addEventListener('click', function () {
    api('/auth/logout', { method: 'POST', body: {} }).catch(function () {}).then(leave);
  });
  get('/auth/me').then(function (m) {
    me = m; fillUser();
    window.addEventListener('hashchange', go);
    go();
  }).catch(function (e) { $('panes').innerHTML = panel('Cannot load', empty('Could not reach the server', e.message)); });
})();
