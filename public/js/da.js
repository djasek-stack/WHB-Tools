/* Deal Analyzer — address lookup, your numbers, traffic-light verdict. */
(function () {
  'use strict';
  var M = window.WHBMath;
  var report = null;

  function $(id) { return document.getElementById(id); }
  function num(id, fallback) {
    var v = parseFloat($(id).value);
    return Number.isFinite(v) ? v : fallback;
  }
  function money(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(String(iso).slice(0, 10) + 'T12:00:00');
    return isNaN(d.getTime()) ? esc(iso) : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function renderReport() {
    var box = $('report');
    if (!report) { box.innerHTML = ''; return; }
    if (report.notFound) {
      box.innerHTML = '<div class="notfound"><strong>We couldn\'t find that home.</strong> ' +
        'Check the address — a full street address with city, state, and ZIP works best — and try again.</div>';
      return;
    }
    var p = report.property || {};
    var v = report.value || {};
    var html = '';
    if (report.isSample) {
      html += '<div class="sample-banner">SAMPLE REPORT — this is a labeled sample property ' +
        'shown because live data for that address could not be reached. The numbers below are ' +
        'an example, not a real home\'s record.</div>';
    }
    html += '<h3>' + esc(report.address) + '</h3>';
    var facts = [];
    if (p.bedrooms != null) facts.push(p.bedrooms + ' bed');
    if (p.bathrooms != null) facts.push(p.bathrooms + ' bath');
    if (p.squareFootage) facts.push(Number(p.squareFootage).toLocaleString('en-US') + ' sq ft');
    if (p.lotSize) facts.push('lot ' + Number(p.lotSize).toLocaleString('en-US') + ' sq ft');
    if (p.yearBuilt) facts.push('built ' + p.yearBuilt);
    if (p.propertyType) facts.push(esc(p.propertyType));
    if (facts.length) html += '<p>' + facts.join(' · ') + '</p>';
    if (v.price) {
      html += '<p><strong>Estimated value: ' + money(v.price) + '</strong>' +
        (v.low && v.high ? ' <span class="hint">(range ' + money(v.low) + ' – ' + money(v.high) + ')</span>' : '') + '</p>';
      if (v.note) html += '<p class="hint">' + esc(v.note) + '</p>';
    }
    if (p.lastSalePrice) {
      html += '<p class="hint">Last recorded sale: ' + money(p.lastSalePrice) +
        (p.lastSaleDate ? ' on ' + fmtDate(p.lastSaleDate) : '') + '.</p>';
    }
    if (report.mortgage) {
      var mg = report.mortgage;
      html += '<p><strong>Seller\'s loan (modeled estimate):</strong> original loan ' + money(mg.originalLoan) +
        ' at ' + mg.ratePct + '% from ' + fmtDate(mg.startDate) + '; estimated balance today about <strong>' +
        money(mg.estimatedBalance) + '</strong>, leaving roughly ' + money(mg.equity) + ' in equity. ' +
        '<span class="hint">' + esc(mg.note || '') + '</span></p>';
    }
    if (report.comps && report.comps.length) {
      html += '<h3>Comparable homes nearby</h3>';
      report.comps.forEach(function (c) {
        html += '<div class="comp"><span class="addr">' + esc(c.address) + '</span> ' +
          (c.status === 'SOLD'
            ? '<span class="badge sold">SOLD</span> ' + fmtDate(c.date)
            : '<span class="badge forsale">FOR SALE</span> listed ' + fmtDate(c.date)) +
          '<br>' + (c.price ? money(c.price) : '') +
          (c.squareFootage ? ' · ' + Number(c.squareFootage).toLocaleString('en-US') + ' sq ft' : '') +
          (c.pricePerSqft ? ' · $' + Math.round(c.pricePerSqft) + '/sq ft' : '') +
          (c.distance != null ? ' · ' + c.distance + ' mi' : '') + '</div>';
      });
      if (report.avgSoldPsf) {
        html += '<p class="hint">Average: $' + Math.round(report.avgSoldPsf) + '/sq ft from ' +
          (report.psfBasis === 'sold' ? 'sold' : 'currently listed') + ' comparable homes.' +
          (report.psfBasis !== 'sold' ? ' Averages built from asking prices — treat with care.' : '') + '</p>';
      }
    }
    box.innerHTML = html;
  }

  function lamp(status, title, text) {
    return '<div class="lamp-row"><span class="lamp ' + status + '"></span><div>' +
      '<span class="lamp-title">' + esc(title) + '</span><br>' + text + '</div></div>';
  }

  function computeVerdict() {
    var box = $('verdict');
    if (!report || report.notFound || !report.value || !report.value.price) {
      box.innerHTML = '<p class="hint">Look up a home in Step 1 and your verdict will appear here.</p>';
      return;
    }
    var income = Math.max(0, num('in-income', 0));
    var debts = Math.max(0, num('in-debts', 0));
    var down = Math.max(0, num('in-down', 0));
    var offer = num('in-offer', report.value.price);
    var rate = num('in-rate', 6.5);
    var term = Math.min(40, Math.max(1, num('in-term', 30)));
    var value = report.value.price;

    // Check 1 — price vs. market value.
    var ratio = offer / value;
    var priceCheck;
    if (ratio <= 1.0) priceCheck = { status: 'green', title: 'Price vs. market — at or under', text: 'Your offer of ' + money(offer) + ' is at or under the estimated market value of ' + money(value) + '.' };
    else if (ratio <= 1.05) priceCheck = { status: 'yellow', title: 'Price vs. market — a little over', text: 'Your offer of ' + money(offer) + ' is about ' + Math.round((ratio - 1) * 100) + '% over the estimated value of ' + money(value) + '. That gap comes out of your pocket at appraisal time.' };
    else priceCheck = { status: 'red', title: 'Price vs. market — over', text: 'Your offer of ' + money(offer) + ' is about ' + Math.round((ratio - 1) * 100) + '% over the estimated value of ' + money(value) + '. Expect an appraisal fight or cash to cover the gap.' };

    // Check 2 — payment fit (same 28%/36% math as Know Your Numbers).
    var a = M.allIn(offer, { down: down, ratePct: rate, termYears: term });
    var b = M.budgets(income, debts);
    var fitCheck;
    if (income <= 0) {
      fitCheck = { status: 'grey', title: 'Payment fit — add your income', text: 'Add your monthly income in Step 2 to check the payment against your budget.' };
    } else if (a.total <= b.comfortable) {
      fitCheck = { status: 'green', title: 'Payment fit — comfortable', text: 'The all-in payment of about ' + money(a.total) + '/mo fits your comfortable budget of ' + money(b.comfortable) + '/mo.' };
    } else if (a.total <= b.lender) {
      fitCheck = { status: 'yellow', title: 'Payment fit — a stretch', text: 'The all-in payment of about ' + money(a.total) + '/mo is over your comfortable budget of ' + money(b.comfortable) + '/mo, though under the lender max of ' + money(b.lender) + '/mo. Approved doesn\'t mean comfortable.' };
    } else {
      fitCheck = { status: 'red', title: 'Payment fit — over budget', text: 'The all-in payment of about ' + money(a.total) + '/mo is over even the lender-max budget of ' + money(b.lender) + '/mo for your income and debts.' };
    }

    // Check 3 — negotiation room from the seller's estimated equity.
    var negoCheck;
    if (!report.mortgage) {
      negoCheck = { status: 'grey', title: 'Negotiation room — no data', text: 'No mortgage data is available for this home, so the seller\'s room to move can\'t be estimated here.' };
    } else {
      var equityPct = value > 0 ? (report.mortgage.equity / value) * 100 : 0;
      var negoText = 'The seller\'s estimated balance is about ' + money(report.mortgage.estimatedBalance) +
        ' against a value of ' + money(value) + ' — roughly ' + money(report.mortgage.equity) + ' (' + Math.round(equityPct) + '%) in equity. ' +
        'That balance is a modeled estimate, not a payoff statement.';
      if (equityPct >= 25) negoCheck = { status: 'green', title: 'Negotiation room — the seller has room', text: negoText };
      else if (equityPct >= 10) negoCheck = { status: 'yellow', title: 'Negotiation room — some room', text: negoText };
      else negoCheck = { status: 'red', title: 'Negotiation room — little room', text: negoText };
    }

    // Overall verdict from the scored checks (grey checks don't vote).
    var checks = [priceCheck, fitCheck, negoCheck];
    var scores = { green: 2, yellow: 1, red: 0 };
    var scored = checks.filter(function (c) { return c.status !== 'grey'; });
    var avg = scored.reduce(function (s, c) { return s + scores[c.status]; }, 0) / scored.length;
    var overall, overallClass;
    if (avg >= 1.5) { overall = 'This will work'; overallClass = 'green'; }
    else if (avg >= 0.75) { overall = 'This may work'; overallClass = 'yellow'; }
    else { overall = 'This won\'t work'; overallClass = 'red'; }

    box.innerHTML =
      '<div class="lamp-row"><span class="lamp ' + overallClass + '"></span><div class="verdict">' + esc(overall) + '</div></div>' +
      '<div class="lamps">' +
      lamp(priceCheck.status, priceCheck.title, priceCheck.text) +
      lamp(fitCheck.status, fitCheck.title, fitCheck.text) +
      lamp(negoCheck.status, negoCheck.title, negoCheck.text) +
      '</div>' +
      '<p class="hint">Payment breakdown at your offer price: principal &amp; interest ' + money(a.pi) +
      ', taxes ' + money(a.taxes) + ', insurance ' + money(a.insurance) +
      (a.pmi > 0 ? ', PMI ' + money(a.pmi) : '') + ' — all-in ' + money(a.total) + '/mo.</p>';
  }

  function doLookup() {
    var address = $('in-address').value.trim();
    var status = $('lookup-status');
    if (address.length < 6) {
      status.textContent = 'Type the full address — street, city, state, and ZIP.';
      return;
    }
    var btn = $('lookup-btn');
    btn.disabled = true;
    status.textContent = 'Looking up that home…';
    fetch('/api/lookup?address=' + encodeURIComponent(address))
      .then(function (r) { return r.json(); })
      .then(function (j) {
        report = j;
        status.textContent = '';
        renderReport();
        if (report && !report.notFound && report.value && report.value.price) {
          $('in-offer').value = report.value.price;
        }
        computeVerdict();
      })
      .catch(function () {
        status.textContent = 'The lookup didn\'t go through — check your connection and try again.';
      })
      .then(function () { btn.disabled = false; });
  }

  document.addEventListener('DOMContentLoaded', function () {
    $('lookup-btn').addEventListener('click', doLookup);
    $('in-address').addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); doLookup(); }
    });
    ['in-income', 'in-debts', 'in-down', 'in-offer', 'in-rate', 'in-term'].forEach(function (id) {
      $(id).addEventListener('input', computeVerdict);
    });
  });
})();
