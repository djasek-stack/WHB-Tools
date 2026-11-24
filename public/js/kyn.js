/* Know Your Numbers — borrower-first calculator. */
(function () {
  'use strict';
  var M = window.WHBMath;

  var avgRate = 6.50;      // replaced by /api/rates when it answers
  var rateIsFallback = true;
  var rateWeekOf = null;

  function $(id) { return document.getElementById(id); }
  function num(id, fallback) {
    var v = parseFloat($(id).value);
    return Number.isFinite(v) ? v : fallback;
  }
  function money(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function workingRate() {
    var override = parseFloat($('in-rate-override').value);
    return (Number.isFinite(override) && override > 0) ? override : avgRate;
  }

  function renderRateLine() {
    var el = $('rate-line');
    if (rateIsFallback) {
      el.innerHTML = '<strong>Example 30-year rate: ' + avgRate.toFixed(2) + '%</strong> ' +
        '<span class="hint">(the live national average was not available just now, so this example rate is pre-filled — enter a lender quote in Fine-tune if you have one)</span>';
    } else {
      var when = rateWeekOf ? new Date(rateWeekOf + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '';
      el.innerHTML = '<strong>Today\'s average 30-year rate: ' + avgRate.toFixed(2) + '%</strong>' +
        (when ? ' <span class="hint">(Freddie Mac weekly average, week of ' + esc(when) + ')</span>' : '');
    }
  }

  function compute() {
    var pay = Math.max(0, num('in-pay', 0));
    var debts = Math.max(0, num('in-debts', 0));
    var down = Math.max(0, num('in-down', 0));
    var rent = Math.max(0, num('in-rent', 0));
    var rate = workingRate();
    var opts = {
      down: down,
      ratePct: rate,
      taxRatePct: num('in-tax', M.DEFAULTS.taxRatePct),
      insuranceMonthly: num('in-ins', M.DEFAULTS.insuranceMonthly),
      pmiRatePct: num('in-pmi', M.DEFAULTS.pmiRatePct)
    };
    var closingPct = num('in-closing', M.DEFAULTS.closingPct);
    var stayYears = Math.min(30, Math.max(1, num('in-stay', 5)));
    var appr = num('in-appr', 3);
    var rentInc = num('in-rentinc', 0);

    var b = M.budgets(pay, debts);
    var price = M.solvePrice(b.comfortable, opts);
    var a = M.allIn(price, opts);
    var lenderPrice = M.solvePrice(b.lender, opts);
    var lenderPayment = M.allIn(lenderPrice, opts).total;
    var cash = M.cashToClose(price, down, closingPct);
    var rvo = M.rentVsOwn({
      price: price, down: down, ratePct: rate,
      taxRatePct: opts.taxRatePct, insuranceMonthly: opts.insuranceMonthly, pmiRatePct: opts.pmiRatePct,
      closingPct: closingPct, monthlyRent: rent, stayYears: stayYears,
      appreciationPct: appr, rentIncreasePct: rentInc
    });
    var interest = M.lifeInterest(a.loan, rate, 30);

    var html = '<h2>Your results</h2>';
    if (price <= 0 || pay <= 0) {
      html += '<p>Add your monthly pay above and your numbers will appear here.</p>';
      $('results').innerHTML = html;
      return;
    }
    html += '<p>Your comfortable monthly housing budget is <strong>' + money(b.comfortable) + '</strong> ' +
      '(28% of your pay, checked against the 36% rule lenders use).</p>';
    html += '<p class="big-number">' + money(price) + '</p>';
    html += '<p>That\'s the home price that fits your life, with <strong>' + money(down) + '</strong> down ' +
      'at a ' + rate.toFixed(2) + '% rate.</p>';

    html += '<h3>Your all-in monthly payment</h3>';
    html += '<table class="breakdown">' +
      '<tr><td>Principal &amp; interest</td><td>' + money(a.pi) + '</td></tr>' +
      '<tr><td>Property taxes</td><td>' + money(a.taxes) + '</td></tr>' +
      '<tr><td>Home insurance</td><td>' + money(a.insurance) + '</td></tr>' +
      (a.pmi > 0 ? '<tr><td>PMI (until you reach 20% equity)</td><td>' + money(a.pmi) + '</td></tr>' : '') +
      '<tr class="total"><td>All-in payment</td><td>' + money(a.total) + '/mo</td></tr></table>';

    html += '<div class="warn"><strong>Approved doesn\'t mean comfortable.</strong> A lender using only the ' +
      '36% rule might approve you up to about <strong>' + money(lenderPrice) + '</strong> — a ' + money(lenderPayment) +
      '/mo payment. That\'s ' + money(lenderPayment - a.total) + '/mo more than your comfortable budget, with no ' +
      'breathing room left for the rest of your life.</div>';

    html += '<h3>Cash you\'ll need at closing</h3>';
    html += '<table class="breakdown">' +
      '<tr><td>Down payment</td><td>' + money(cash.downPayment) + '</td></tr>' +
      '<tr><td>Closing costs (est. ' + closingPct + '% of price)</td><td>' + money(cash.closingCosts) + '</td></tr>' +
      '<tr class="total"><td>Total cash to close</td><td>' + money(cash.total) + '</td></tr></table>';
    html += '<p>Your saved down payment covers the first ' + money(cash.downPayment) + ' — plan on about ' +
      '<strong>' + money(cash.stillNeeded) + ' more</strong> at closing.</p>';

    html += '<h3>Rent vs. own over ' + stayYears + ' years</h3>';
    html += '<p>Renting at ' + money(rent) + '/mo costs <strong>' + money(rvo.rentTotal) + '</strong> over ' +
      stayYears + ' years and builds no equity. Buying at ' + money(price) + ', you\'d build about <strong>' +
      money(rvo.equityEnd) + '</strong> in equity (paydown plus appreciation) and hold a home worth about ' +
      money(rvo.valueEnd) + '.</p>';
    if (rvo.ahead >= 0) {
      html += '<div class="good">All-in, buying comes out about <strong>' + money(rvo.ahead) + ' ahead</strong> of renting over ' + stayYears + ' years on these assumptions.</div>';
    } else {
      html += '<div class="warn">On these assumptions, renting comes out about <strong>' + money(-rvo.ahead) + ' ahead</strong> over ' + stayYears + ' years — a longer stay or a lower price would change that picture.</div>';
    }

    html += '<p class="disclaimer">Interest over the full 30-year loan at this price: about ' + money(interest) +
      '. Paying the loan off faster — or buying at a lower price — cuts that number hard.</p>';

    // Optional: check a specific home they're looking at.
    var looking = parseFloat($('in-looking').value);
    if (Number.isFinite(looking) && looking > 0) {
      var la = M.allIn(looking, opts);
      html += '<h3>The home you\'re looking at: ' + money(looking) + '</h3>';
      html += '<p>Its all-in payment would be about <strong>' + money(la.total) + '/mo</strong> with your ' + money(down) + ' down.</p>';
      if (la.total > b.comfortable) {
        html += '<div class="warn"><strong>Over your comfortable budget</strong> by ' + money(la.total - b.comfortable) +
          '/mo. It fits the lender\'s math only if it stays under ' + money(b.lender) + '/mo — being approved for it is not the same as it being comfortable.</div>';
      } else {
        html += '<div class="good">That payment fits inside your comfortable budget of ' + money(b.comfortable) + '/mo.</div>';
      }
    }

    $('results').innerHTML = html;
  }

  document.addEventListener('DOMContentLoaded', function () {
    fetch('/api/rates')
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j && Number.isFinite(j.rate)) {
          avgRate = j.rate;
          rateIsFallback = j.isFallback === true;
          rateWeekOf = j.weekOf || null;
        }
      })
      .catch(function () { /* fallback rate already in place */ })
      .then(function () { renderRateLine(); compute(); });

    $('kyn-form').addEventListener('input', compute);
    $('rate-clear').addEventListener('click', function () {
      $('in-rate-override').value = '';
      compute();
    });
    compute();
  });
})();
