(function () {
  'use strict';
  var token = new URLSearchParams(location.search).get('token') || '';
  function done(title, text) { document.getElementById('title').textContent = title; document.getElementById('blurb').textContent = text; }
  fetch('/api/auth/verify-email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: token }) })
    .then(function (r) {
      if (r.status === 204) return done('Email confirmed', 'Thank you. Your property manager can now link you to your home.');
      return r.json().then(function (d) { done('This link does not work', d.message || 'The link is not valid or has expired.'); });
    }).catch(function () { done('Something went wrong', 'Please try again in a moment.'); });
})();
