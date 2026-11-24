/*
 * Lead gate — shared by both tool pages.
 * One successful submission unlocks BOTH tools on this device
 * (localStorage flag). The share checkbox is optional and never
 * required to unlock; only a checked box makes a lead sellable.
 */
(function () {
  'use strict';

  var FLAG = 'whbToolsUnlocked';

  function unlock() {
    var gate = document.getElementById('gate');
    var tool = document.getElementById('tool');
    if (gate) gate.classList.add('hidden');
    if (tool) tool.classList.remove('hidden');
    document.dispatchEvent(new CustomEvent('whb:unlocked'));
  }

  document.addEventListener('DOMContentLoaded', function () {
    // Point every Privacy Policy link at the configured URL.
    fetch('/api/config')
      .then(function (r) { return r.json(); })
      .then(function (cfg) {
        if (cfg && cfg.privacyPolicyUrl) {
          document.querySelectorAll('a.privacy-link').forEach(function (a) {
            a.setAttribute('href', cfg.privacyPolicyUrl);
          });
        }
      })
      .catch(function () { /* default hrefs in the HTML stand */ });

    var unlocked = false;
    try { unlocked = window.localStorage.getItem(FLAG) === '1'; } catch (e) { unlocked = false; }
    if (unlocked) { unlock(); return; }

    var openBtn = document.getElementById('gate-open');
    var form = document.getElementById('gate-form');
    var error = document.getElementById('gate-error');
    if (!openBtn || !form) return;

    openBtn.addEventListener('click', function () {
      form.classList.remove('hidden');
      openBtn.classList.add('hidden');
      var first = document.getElementById('gate-first');
      if (first) first.focus();
    });

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var firstName = document.getElementById('gate-first').value.trim();
      var email = document.getElementById('gate-email').value.trim();
      var phone = document.getElementById('gate-phone').value.trim();
      var share = document.getElementById('gate-share').checked;
      error.style.display = 'none';
      if (!firstName || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        error.textContent = 'Please add your first name and a valid email — the tools unlock right after.';
        error.style.display = 'block';
        return;
      }
      var submitBtn = form.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Unlocking…';
      fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: firstName,
          email: email,
          phone: phone,
          shareOptIn: share,
          sourceTool: document.body.getAttribute('data-tool') || ''
        })
      })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (result) {
          if (!result.ok) throw new Error('lead rejected');
          try { window.localStorage.setItem(FLAG, '1'); } catch (e) { /* private mode: unlock for this visit only */ }
          unlock();
        })
        .catch(function () {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Unlock my free tools';
          error.textContent = 'Something went wrong saving that — please try again.';
          error.style.display = 'block';
        });
    });
  });
})();
