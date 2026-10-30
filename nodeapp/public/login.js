(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var form = $('form'), err = $('err'), submit = $('submit');
  var mode = 'login', needsKey = false, mfaToken = null;

  var COPY = {
    login:    { title: 'Sign in', blurb: 'Use the email and password for your account.', btn: 'Sign in', busy: 'Signing in…', path: '/api/auth/login' },
    register: { title: 'Create a tenant account', blurb: 'You can report issues once your manager links you to your unit, or you accept their invitation.', btn: 'Create account', busy: 'Creating account…', path: '/api/auth/register' },
    setup:    { title: 'Set up EstateOps', blurb: 'This is a new installation. Create the organization and the first manager account.', btn: 'Create organization', busy: 'Setting up…', path: '/api/setup' }
  };

  function setMode(next) {
    mode = next;
    var c = COPY[mode];
    $('title').textContent = c.title;
    $('blurb').textContent = c.blurb;
    submit.textContent = c.btn;
    $('orgRow').hidden = mode !== 'setup';
    $('nameRow').hidden = mode === 'login';
    $('keyRow').hidden = !(mode === 'setup' && needsKey);
    $('tabs').hidden = mode === 'setup';
    $('help').hidden = mode !== 'login';
    $('pw').setAttribute('autocomplete', mode === 'login' ? 'current-password' : 'new-password');
    $('pw').placeholder = mode === 'login' ? 'Your password' : 'At least 8 characters';
    $('mLogin').setAttribute('aria-pressed', mode === 'login' ? 'true' : 'false');
    $('mRegister').setAttribute('aria-pressed', mode === 'register' ? 'true' : 'false');
    err.textContent = '';
  }
  function fail(msg, field) { err.textContent = msg; if (field) field.focus(); }

  $('mLogin').addEventListener('click', function () { setMode('login'); });
  $('mRegister').addEventListener('click', function () { setMode('register'); });
  $('reveal').addEventListener('click', function () {
    var pw = $('pw'), shown = pw.type === 'text';
    pw.type = shown ? 'password' : 'text';
    this.textContent = shown ? 'Show' : 'Hide';
    pw.focus();
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    err.textContent = '';
    if (mfaToken) return verifyCode();
    var mail = $('email').value.trim(), pass = $('pw').value;
    if (!mail) return fail('Enter your email.', $('email'));
    if (mail.indexOf('@') < 1) return fail('That email address does not look right.', $('email'));
    if (!pass) return fail('Enter your password.', $('pw'));
    if (mode !== 'login' && pass.length < 8) return fail('Use at least 8 characters for your password.', $('pw'));
    if (mode !== 'login' && !$('name').value.trim()) return fail('Enter your full name.', $('name'));
    if (mode === 'setup' && !$('org').value.trim()) return fail('Enter your organization name.', $('org'));

    var body = { email: mail, password: pass };
    if (mode !== 'login') body.fullName = $('name').value.trim();
    if (mode === 'setup') { body.organizationName = $('org').value.trim(); if (needsKey) body.setupKey = $('key').value; }

    submit.disabled = true; submit.textContent = COPY[mode].busy;
    post(COPY[mode].path, body)
      .then(function (data) {
        if (data.mfaRequired) { askForCode(data.mfaToken); return; }
        finish(data);
      })
      .catch(function (e) {
        fail(e && e.name === 'TypeError' ? 'Cannot reach the server. Check that EstateOps is running.' : e.message);
        submit.disabled = false; submit.textContent = COPY[mode].btn;
      });
  });

  function post(path, body) {
    return fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (!res.ok) { var er = new Error(data.message || ('Could not complete that (error ' + res.status + ').')); er.status = res.status; throw er; }
          return data;
        });
      });
  }
  function finish(data) {
    try { localStorage.setItem('eo_auth', JSON.stringify(data)); } catch (x) {}
    location.href = 'app.html';
  }
  /* second step of a two-factor sign-in */
  function askForCode(token) {
    mfaToken = token;
    $('title').textContent = 'Two-factor sign-in';
    $('blurb').textContent = 'Your account is protected with an authenticator app.';
    document.querySelectorAll('#form > div').forEach(function (d) { if (d.id !== 'codeRow') d.hidden = true; });
    $('codeRow').hidden = false; $('tabs').hidden = true; $('help').hidden = true;
    submit.disabled = false; submit.textContent = 'Verify'; err.textContent = '';
    $('code').focus();
  }
  function verifyCode() {
    var code = $('code').value.trim();
    if (!code) return fail('Enter the code from your authenticator app.', $('code'));
    submit.disabled = true; submit.textContent = 'Checking…';
    post('/api/auth/mfa/verify', { mfaToken: mfaToken, code: code }).then(finish).catch(function (e) {
      if (e.status === 401 && /Sign in again/.test(e.message)) { location.reload(); return; }
      fail(e.message, $('code')); submit.disabled = false; submit.textContent = 'Verify';
    });
  }

  fetch('/api/setup/status').then(function (r) { return r.json(); }).then(function (s) {
    needsKey = !!s.requiresSetupKey;
    var canRegister = s.selfRegistration !== false;
    setMode(s.needsSetup ? 'setup' : (canRegister && /[?&]mode=register\b/.test(location.search) ? 'register' : 'login'));
    if (/[?&]reset=1\b/.test(location.search) && mode === 'login') $('blurb').textContent = 'Your password was changed. Sign in with the new one.';
    if (!s.needsSetup) $('tabs').hidden = !canRegister;   // sign-up switched off: no tabs, just sign in
  }).catch(function () { setMode('login'); $('tabs').hidden = false; });
  $('email').focus();
})();
