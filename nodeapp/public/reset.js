(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var token = new URLSearchParams(location.search).get('token') || '';
  function post(path, body) {
    return fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(function (r) {
      if (r.status === 204) return {};
      return r.json().then(function (d) { if (!r.ok) throw new Error(d.message || 'Something went wrong.'); return d; });
    });
  }
  if (token) { $('ask').hidden = true; $('set').hidden = false; $('title').textContent = 'Choose a new password'; $('blurb').textContent = 'Pick a password you do not use anywhere else.'; }

  $('ask').addEventListener('submit', function (e) {
    e.preventDefault(); $('askErr').textContent = '';
    var email = $('email').value.trim();
    if (!email) { $('askErr').textContent = 'Enter your email address.'; return; }
    $('askBtn').disabled = true;
    post('/api/auth/forgot-password', { email: email }).then(function (d) {
      $('ask').hidden = true; $('blurb').textContent = d.message || 'Check your email for the link.';
    }).catch(function (x) { $('askErr').textContent = x.message; $('askBtn').disabled = false; });
  });
  $('set').addEventListener('submit', function (e) {
    e.preventDefault(); $('setErr').textContent = '';
    if ($('pw').value.length < 8) { $('setErr').textContent = 'Use at least 8 characters for your password.'; return; }
    $('setBtn').disabled = true;
    post('/api/auth/reset-password', { token: token, password: $('pw').value }).then(function () {
      location.href = 'login.html?reset=1';
    }).catch(function (x) { $('setErr').textContent = x.message; $('setBtn').disabled = false; });
  });
})();
