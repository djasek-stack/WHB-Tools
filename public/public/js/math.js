/*
 * Wise Homebuyer shared math.
 * Used by the Know Your Numbers page and the Deal Analyzer page in the
 * browser, and by the test script in Node (UMD wrapper).
 *
 * The rules everywhere: a comfortable home payment is 28% of gross monthly
 * pay, capped by the 36% back-end rule (all debts + housing <= 36% of pay).
 * Taxes default to 1.20% of price per year, insurance $100/mo, PMI 0.50% of
 * the loan per year while the down payment is under 20%.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.WHBMath = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEFAULTS = {
    termYears: 30,
    taxRatePct: 1.20,      // % of home price per year
    insuranceMonthly: 100, // $ per month
    pmiRatePct: 0.50,      // % of loan per year, charged while down < 20%
    closingPct: 3.0        // % of price, estimated closing costs
  };

  // Monthly principal & interest payment.
  function monthlyPI(loan, annualRatePct, termYears) {
    var r = annualRatePct / 100 / 12;
    var n = termYears * 12;
    if (loan <= 0) return 0;
    if (r === 0) return loan / n;
    var f = Math.pow(1 + r, n);
    return loan * r * f / (f - 1);
  }

  // Remaining loan balance after `monthsPaid` monthly payments.
  function loanBalance(loan, annualRatePct, termYears, monthsPaid) {
    var r = annualRatePct / 100 / 12;
    if (loan <= 0) return 0;
    if (r === 0) return Math.max(0, loan - (loan / (termYears * 12)) * monthsPaid);
    var f = Math.pow(1 + r, monthsPaid);
    var bal = loan * f - monthlyPI(loan, annualRatePct, termYears) * ((f - 1) / r);
    return Math.max(0, bal);
  }

  // Itemized all-in monthly payment for a home price.
  // opts: { down, ratePct, termYears, taxRatePct, insuranceMonthly, pmiRatePct }
  function allIn(price, opts) {
    opts = opts || {};
    var down = opts.down || 0;
    var ratePct = opts.ratePct != null ? opts.ratePct : 6.5;
    var termYears = opts.termYears || DEFAULTS.termYears;
    var taxRatePct = opts.taxRatePct != null ? opts.taxRatePct : DEFAULTS.taxRatePct;
    var insuranceMonthly = opts.insuranceMonthly != null ? opts.insuranceMonthly : DEFAULTS.insuranceMonthly;
    var pmiRatePct = opts.pmiRatePct != null ? opts.pmiRatePct : DEFAULTS.pmiRatePct;
    var loan = Math.max(0, price - down);
    var pi = monthlyPI(loan, ratePct, termYears);
    var taxes = price * taxRatePct / 100 / 12;
    var pmi = (price > 0 && down / price < 0.20) ? loan * pmiRatePct / 100 / 12 : 0;
    return {
      price: price,
      down: down,
      loan: loan,
      pi: pi,
      taxes: taxes,
      insurance: insuranceMonthly,
      pmi: pmi,
      total: pi + taxes + insuranceMonthly + pmi
    };
  }

  // Highest home price (rounded down to the nearest $100) whose all-in
  // payment fits the given monthly housing budget.
  function solvePrice(budget, opts) {
    if (!(budget > 0)) return 0;
    var lo = (opts && opts.down) || 0;
    var hi = 5000000;
    for (var i = 0; i < 80; i++) {
      var mid = (lo + hi) / 2;
      if (allIn(mid, opts).total <= budget) lo = mid; else hi = mid;
    }
    return Math.floor(lo / 100) * 100;
  }

  // The two budgets: comfortable (28% front-end, capped by 36% back-end)
  // and the lender max (36% back-end only).
  function budgets(monthlyPay, monthlyDebts) {
    var lender = 0.36 * monthlyPay - monthlyDebts;
    var comfortable = Math.min(0.28 * monthlyPay, lender);
    return { comfortable: Math.max(0, comfortable), lender: Math.max(0, lender) };
  }

  // Itemized cash needed at closing.
  function cashToClose(price, downSaved, closingPct) {
    var pct = closingPct != null ? closingPct : DEFAULTS.closingPct;
    var closing = price * pct / 100;
    return {
      downPayment: downSaved,
      closingCosts: closing,
      total: downSaved + closing,
      // The visitor's savings are the down payment itself, so what is still
      // needed at closing is the closing costs on top of it.
      stillNeeded: closing
    };
  }

  /*
   * Rent vs. own over the stay period.
   * Net cost of renting  = every rent cheque over the stay.
   * Net cost of owning   = down payment + closing costs + every all-in
   *                        payment, minus the equity you walk away with
   *                        (appreciated value - remaining loan balance).
   * ahead > 0 means buying comes out ahead.
   */
  function rentVsOwn(args) {
    var months = Math.round(args.stayYears * 12);
    var rentTotal = 0;
    for (var m = 0; m < months; m++) {
      var yearIndex = Math.floor(m / 12);
      rentTotal += args.monthlyRent * Math.pow(1 + (args.rentIncreasePct || 0) / 100, yearIndex);
    }
    var a = allIn(args.price, args);
    var balanceEnd = loanBalance(a.loan, args.ratePct, args.termYears || DEFAULTS.termYears, months);
    var valueEnd = args.price * Math.pow(1 + (args.appreciationPct || 0) / 100, args.stayYears);
    var equityEnd = valueEnd - balanceEnd;
    var closing = args.price * (args.closingPct != null ? args.closingPct : DEFAULTS.closingPct) / 100;
    var netOwnCost = a.down + closing + a.total * months - equityEnd;
    return {
      months: months,
      rentTotal: rentTotal,
      netOwnCost: netOwnCost,
      ahead: rentTotal - netOwnCost,
      equityEnd: equityEnd,
      valueEnd: valueEnd,
      balanceEnd: balanceEnd,
      principalPaid: a.loan - balanceEnd,
      appreciation: valueEnd - args.price
    };
  }

  // Total interest over the full life of a loan.
  function lifeInterest(loan, annualRatePct, termYears) {
    return monthlyPI(loan, annualRatePct, termYears) * termYears * 12 - loan;
  }

  return {
    DEFAULTS: DEFAULTS,
    monthlyPI: monthlyPI,
    loanBalance: loanBalance,
    allIn: allIn,
    solvePrice: solvePrice,
    budgets: budgets,
    cashToClose: cashToClose,
    rentVsOwn: rentVsOwn,
    lifeInterest: lifeInterest
  };
});
