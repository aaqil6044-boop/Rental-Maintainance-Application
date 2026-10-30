(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var token = new URLSearchParams(location.search).get('token') || '';
  var info = null;
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]; }); }
  var ROLE = { TENANT: 'tenant', MANAGER: 'manager', TECHNICIAN: 'technician', VENDOR: 'vendor' };

  fetch('/api/invitations/lookup?token=' + encodeURIComponent(token)).then(function (r) {
    return r.json().then(function (d) { if (!r.ok) throw new Error(d.message); return d; });
  }).then(function (d) {
    info = d;
    var reset = d.kind === 'RESET';
    $('title').textContent = reset ? 'Choose a new password' : 'Join ' + d.organizationName;
    $('blurb').textContent = reset ? 'Set a new password for your account.' : 'You were invited as a ' + ROLE[d.role] + '. Finish setting up your account.';
    var rows = '<dt>Email</dt><dd>' + esc(d.email) + '</dd>';
    if (!reset) {
      rows += '<dt>Organization</dt><dd>' + esc(d.organizationName) + '</dd><dt>Role</dt><dd>' + esc(ROLE[d.role]) + '</dd>';
      if (d.vendorName) rows += '<dt>Company</dt><dd>' + esc(d.vendorName) + '</dd>';
      if (d.unit) rows += '<dt>Unit</dt><dd>' + esc(d.unit) + '</dd>';
    }
    $('facts').innerHTML = rows; $('facts').hidden = false;
    $('nameRow').hidden = reset; $('phoneRow').hidden = reset;
    $('skillsRow').hidden = reset || d.role !== 'TECHNICIAN';
    $('submit').textContent = reset ? 'Save new password' : 'Create my account';
    $('form').hidden = false; $('bad').textContent = '';
  }).catch(function (e) {
    $('title').textContent = 'This link does not work';
    $('bad').textContent = (e && e.message) || 'This invitation link is not valid or has expired.';
    $('blurb').textContent = 'Ask your manager to send you a new one.';
  });

  $('form').addEventListener('submit', function (e) {
    e.preventDefault(); $('err').textContent = '';
    var reset = info.kind === 'RESET';
    if (!reset && !$('name').value.trim()) { $('err').textContent = 'Enter your full name.'; return; }
    if ($('pw').value.length < 8) { $('err').textContent = 'Use at least 8 characters for your password.'; return; }
    $('submit').disabled = true;
    fetch('/api/invitations/accept', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token, fullName: $('name').value.trim(), phone: $('phone').value.trim(),
                             skills: $('skills').value.trim(), password: $('pw').value }) })
      .then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.message); return d; }); })
      .then(function (d) { try { localStorage.setItem('eo_auth', JSON.stringify(d)); } catch (x) {} location.href = 'app.html'; })
      .catch(function (x) { $('err').textContent = x.message; $('submit').disabled = false; });
  });
})();
