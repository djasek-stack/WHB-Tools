/*
 * The Wise Homebuyer — free tools server.
 *
 * Zero-dependency Node (>= 20) HTTP server. Serves the hub and the two
 * tools, the live Freddie Mac average rate, RentCast property lookups for
 * the Deal Analyzer, and the lead-gate form submissions.
 *
 * Environment variables (see .env.example / render.yaml):
 *   PORT                - set by Render automatically; defaults to 3000.
 *   RENTCAST_API_KEY    - RentCast API key. If unset, the Deal Analyzer
 *                         serves its clearly labeled sample report.
 *   CC360_WEBHOOK_URL   - Course Creator 360 inbound webhook URL. If set,
 *                         every lead is also POSTed there. If unset, leads
 *                         are only stored in data/leads.json and marked
 *                         "stored_only" — delivery is never faked.
 *   PRIVACY_POLICY_URL  - linked from the lead form and page footers.
 *
 * Note on storage: leads and the lookup cache live in data/ on the local
 * disk. On Render that disk resets when the service restarts or redeploys,
 * so treat data/leads.json as a backup — the CC360 webhook is the durable
 * home for leads.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const LEADS_FILE = path.join(DATA_DIR, 'leads.json');
const CACHE_FILE = path.join(DATA_DIR, 'cache.json');
const PRIVACY_POLICY_URL = process.env.PRIVACY_POLICY_URL || 'https://thewisehomebuyer.com/privacy-policy';
const CONSENT_VERSION = 'consent_v1';
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

fs.mkdirSync(DATA_DIR, { recursive: true });

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

function writeJson(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, Object.assign({}, options, { signal: controller.signal }))
    .finally(() => clearTimeout(timer));
}

function round1000(n) { return Math.round(n / 1000) * 1000; }

/* ------------------------------------------------------------------ */
/* GET /api/rates — Freddie Mac weekly average 30-yr rate via FRED     */
/* ------------------------------------------------------------------ */

let ratesCache = null; // { day: 'YYYY-MM-DD', payload: {...} }

async function getRates() {
  const today = new Date().toISOString().slice(0, 10);
  if (ratesCache && ratesCache.day === today) return ratesCache.payload;
  try {
    const resp = await fetchWithTimeout(
      'https://fred.stlouisfed.org/graph/fredgraph.csv?id=MORTGAGE30US',
      { headers: { 'User-Agent': 'whb-tools/1.0' } },
      8000
    );
    if (!resp.ok) throw new Error('FRED HTTP ' + resp.status);
    const csv = await resp.text();
    let last = null;
    for (const line of csv.split(/\r?\n/)) {
      const parts = line.split(',');
      if (parts.length >= 2 && /^\d{4}-\d{2}-\d{2}$/.test(parts[0].trim())) {
        const value = parseFloat(parts[1]);
        if (Number.isFinite(value)) last = { date: parts[0].trim(), rate: value };
      }
    }
    if (!last) throw new Error('no rate rows in FRED CSV');
    const payload = { rate: last.rate, weekOf: last.date, isFallback: false };
    ratesCache = { day: today, payload };
    return payload;
  } catch (e) {
    // Designed degradation: the page labels this as an example rate.
    return { rate: 6.50, weekOf: null, isFallback: true };
  }
}

/* ------------------------------------------------------------------ */
/* GET /api/lookup — RentCast property record + AVM, cached 30 days    */
/* ------------------------------------------------------------------ */

function normalizeAddress(address) {
  return String(address || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

async function rentcast(pathname, params) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, v);
  }
  const resp = await fetchWithTimeout(
    'https://api.rentcast.io/v1' + pathname + '?' + qs.toString(),
    { headers: { 'X-Api-Key': process.env.RENTCAST_API_KEY, 'Accept': 'application/json' } },
    15000
  );
  if (!resp.ok) throw new Error('RentCast HTTP ' + resp.status);
  return resp.json();
}

// Amortized balance of a loan, `monthsPaid` payments in.
function amortizedBalance(principal, annualRatePct, termYears, monthsPaid) {
  const r = annualRatePct / 100 / 12;
  const n = termYears * 12;
  if (r === 0) return Math.max(0, principal - (principal / n) * monthsPaid);
  const fT = Math.pow(1 + r, n);
  const pmt = principal * r * fT / (fT - 1);
  const f = Math.pow(1 + r, monthsPaid);
  return Math.max(0, principal * f - pmt * ((f - 1) / r));
}

function monthsBetween(fromDate, toDate) {
  return Math.max(0, (toDate.getFullYear() - fromDate.getFullYear()) * 12 + (toDate.getMonth() - fromDate.getMonth()));
}

/*
 * The labeled sample report. Used ONLY when live data can't be reached
 * (no API key, API failure, or a record with no usable value). The
 * isSample flag is always true and the page banners it as a sample.
 */
function sampleReport() {
  const origination = new Date(2019, 5, 15); // June 15, 2019
  const monthsPaid = monthsBetween(origination, new Date());
  const originalLoan = 500000;
  const balance = amortizedBalance(originalLoan, 3.25, 30, monthsPaid);
  const value = 1050000;
  const comps = [
    { address: '4792 Samplewood Ave, Encino, CA 91316', status: 'SOLD', date: '2026-10-14', price: 1020000, squareFootage: 2310, distance: 0.1 },
    { address: '4815 Samplewood Ave, Encino, CA 91316', status: 'SOLD', date: '2026-08-29', price: 1089000, squareFootage: 2455, distance: 0.2 },
    { address: '4750 Oakmore Dr, Encino, CA 91316', status: 'SOLD', date: '2026-09-08', price: 998000, squareFootage: 2290, distance: 0.4 },
    { address: '4821 Samplewood Ave, Encino, CA 91316', status: 'FOR SALE', date: '2026-11-03', price: 1099000, squareFootage: 2502, distance: 0.1 },
    { address: '17320 Sample Ct, Encino, CA 91316', status: 'SOLD', date: '2026-07-19', price: 1150000, squareFootage: 2610, distance: 0.6 },
    { address: '17401 Sample Ct, Encino, CA 91316', status: 'FOR SALE', date: '2026-10-21', price: 1075000, squareFootage: 2402, distance: 0.5 }
  ].map(c => Object.assign({}, c, { pricePerSqft: c.squareFootage ? c.price / c.squareFootage : null }));
  const sold = comps.filter(c => c.status === 'SOLD' && c.pricePerSqft);
  const avgSoldPsf = sold.reduce((s, c) => s + c.pricePerSqft, 0) / sold.length;
  return {
    isSample: true,
    notFound: false,
    address: '4800 Samplewood Ave, Encino, CA 91316',
    property: {
      bedrooms: 4, bathrooms: 3, squareFootage: 2380, lotSize: 7500,
      yearBuilt: 1962, propertyType: 'Single Family',
      lastSaleDate: '2019-06-15', lastSalePrice: 780000
    },
    value: { price: value, low: 945000, high: 1155000, source: 'sample', adjusted: false, note: null },
    comps,
    avgSoldPsf,
    psfBasis: 'sold',
    mortgage: {
      originalLoan,
      ratePct: 3.25,
      startDate: '2019-06-15',
      estimatedBalance: Math.round(balance * 100) / 100,
      equity: Math.round((value - balance) * 100) / 100,
      note: 'Modeled estimate from the recorded loan amount, rate and start date — not a payoff statement.'
    }
  };
}

function normalizeComps(rawComps) {
  const seen = new Set();
  const out = [];
  for (const c of rawComps || []) {
    const addr = c.formattedAddress || [c.addressLine1, c.city, c.state, c.zipCode].filter(Boolean).join(', ');
    if (!addr || seen.has(addr.toLowerCase())) continue;
    seen.add(addr.toLowerCase());
    let status = 'FOR SALE';
    let date = c.listedDate || c.lastSeenDate || null;
    if (c.saleDate) { status = 'SOLD'; date = c.saleDate; }
    else if (c.removedDate) { status = 'SOLD'; date = c.removedDate; }
    else if (String(c.status || '').toLowerCase().includes('sold')) { status = 'SOLD'; date = c.saleDate || c.removedDate || c.lastSeenDate || null; }
    out.push({
      address: addr,
      status,
      date: date ? String(date).slice(0, 10) : null,
      price: c.price || null,
      squareFootage: c.squareFootage || null,
      pricePerSqft: (c.price && c.squareFootage) ? c.price / c.squareFootage : (c.pricePerSquareFoot || null),
      distance: (c.distance != null) ? Math.round(c.distance * 10) / 10 : null
    });
  }
  return out;
}

async function liveLookup(address) {
  const records = await rentcast('/properties', { address, limit: 1 });
  if (!Array.isArray(records) || records.length === 0) {
    return { isSample: false, notFound: true, address };
  }
  const prop = records[0];
  let avm = null;
  try {
    avm = await rentcast('/avm/value', { address });
  } catch (e) {
    avm = null;
  }
  const comps = normalizeComps(avm && avm.comparables);
  const soldComps = comps.filter(c => c.status === 'SOLD' && c.pricePerSqft);
  const avgSoldPsf = soldComps.length
    ? soldComps.reduce((s, c) => s + c.pricePerSqft, 0) / soldComps.length
    : null;
  const allPsf = comps.filter(c => c.pricePerSqft);
  const avgAllPsf = allPsf.length
    ? allPsf.reduce((s, c) => s + c.pricePerSqft, 0) / allPsf.length
    : null;

  let value = null;
  if (avm && Number.isFinite(avm.price)) {
    value = {
      price: avm.price,
      low: avm.priceRangeLow || null,
      high: avm.priceRangeHigh || null,
      source: 'avm',
      adjusted: false,
      note: null
    };
    // Value sanity check: if the model estimate is wildly off from
    // RentCast's own last recorded sale for this property, replace it
    // with a comp-based value (sold-comp $/sqft x subject sqft).
    const lastSale = prop.lastSalePrice;
    const lastSaleDate = prop.lastSaleDate ? new Date(prop.lastSaleDate) : null;
    const saleAgeYears = lastSaleDate ? (Date.now() - lastSaleDate.getTime()) / (365.25 * 24 * 3600 * 1000) : Infinity;
    if (lastSale && saleAgeYears <= 15 && soldComps.length >= 3 && prop.squareFootage) {
      const ratio = avm.price / lastSale;
      if (ratio > 1.6 || ratio < 0.55) {
        const compValue = round1000(avgSoldPsf * prop.squareFootage);
        value = {
          price: compValue,
          low: null,
          high: null,
          source: 'comps',
          adjusted: true,
          note: 'The automated estimate for this home looked off against its last recorded sale, so this value is built from comparable sold homes instead.'
        };
      }
    }
  } else if (prop.lastSalePrice) {
    value = {
      price: prop.lastSalePrice,
      low: null,
      high: null,
      source: 'lastSale',
      adjusted: false,
      note: 'Based on the last recorded sale price; no current automated estimate was available.'
    };
  } else {
    // A record with no usable value: fall back to the labeled sample.
    return sampleReport();
  }

  return {
    isSample: false,
    notFound: false,
    address: prop.formattedAddress || address,
    property: {
      bedrooms: prop.bedrooms != null ? prop.bedrooms : null,
      bathrooms: prop.bathrooms != null ? prop.bathrooms : null,
      squareFootage: prop.squareFootage || null,
      lotSize: prop.lotSize || null,
      yearBuilt: prop.yearBuilt || null,
      propertyType: prop.propertyType || null,
      lastSaleDate: prop.lastSaleDate ? String(prop.lastSaleDate).slice(0, 10) : null,
      lastSalePrice: prop.lastSalePrice || null
    },
    value,
    comps,
    avgSoldPsf: avgSoldPsf || avgAllPsf,
    psfBasis: avgSoldPsf ? 'sold' : 'listed',
    // RentCast property records do not carry the seller's mortgage, so
    // live reports have no negotiation data (the page shows the grey
    // "no data" lamp). Balances are never invented.
    mortgage: null
  };
}

async function getLookup(address) {
  const key = normalizeAddress(address);
  const cache = readJson(CACHE_FILE, {});
  const hit = cache[key];
  if (hit && (Date.now() - hit.cachedAt) < CACHE_TTL_MS) {
    return hit.report;
  }
  let report;
  if (!process.env.RENTCAST_API_KEY) {
    report = sampleReport();
  } else {
    try {
      report = await liveLookup(address);
    } catch (e) {
      report = sampleReport();
    }
  }
  // Cache real and sample reports alike (30 days), but never cache a
  // "not found" — a corrected address should be retryable right away.
  if (!report.notFound) {
    cache[key] = { cachedAt: Date.now(), report };
    try { writeJson(CACHE_FILE, cache); } catch (e) { /* cache is best-effort */ }
  }
  return report;
}

/* ------------------------------------------------------------------ */
/* POST /api/leads — store every lead; forward to CC360 if configured  */
/* ------------------------------------------------------------------ */

async function handleLead(req, res) {
  let raw = '';
  req.on('data', chunk => {
    raw += chunk;
    if (raw.length > 20000) req.destroy();
  });
  req.on('end', async () => {
    let body;
    try {
      body = JSON.parse(raw || '{}');
    } catch (e) {
      return sendJson(res, 400, { ok: false, error: 'invalid_json' });
    }
    const firstName = String(body.firstName || '').trim();
    const email = String(body.email || '').trim();
    if (!firstName || !email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return sendJson(res, 400, { ok: false, error: 'first_name_and_valid_email_required' });
    }
    const lead = {
      firstName,
      email,
      phone: String(body.phone || '').trim(),
      shareOptIn: body.shareOptIn === true,
      sourceTool: String(body.sourceTool || '').trim().slice(0, 40),
      timestamp: new Date().toISOString(),
      consentVersion: CONSENT_VERSION,
      deliveryStatus: 'stored_only'
    };
    const webhook = process.env.CC360_WEBHOOK_URL;
    if (webhook) {
      try {
        const resp = await fetchWithTimeout(webhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(lead)
        }, 5000);
        lead.deliveryStatus = resp.ok ? 'sent_to_cc360' : 'cc360_failed';
      } catch (e) {
        lead.deliveryStatus = 'cc360_failed';
      }
    }
    const leads = readJson(LEADS_FILE, []);
    leads.push(lead);
    try {
      writeJson(LEADS_FILE, leads);
    } catch (e) {
      return sendJson(res, 500, { ok: false, error: 'storage_failed' });
    }
    return sendJson(res, 200, { ok: true, deliveryStatus: lead.deliveryStatus });
  });
}

/* ------------------------------------------------------------------ */
/* Static files + routes                                               */
/* ------------------------------------------------------------------ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8'
};

function serveFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
}

// Site files may live at the repo root (when uploaded via GitHub's front
// page) or in public/ — the root copy wins when both exist. Only the
// site's own files are resolved this way; server files and data/ are
// never served.
function pickSiteFile(rel) {
  const rootPath = path.join(__dirname, rel);
  if (fs.existsSync(rootPath) && fs.statSync(rootPath).isFile()) return rootPath;
  const pubPath = path.join(PUBLIC_DIR, rel);
  if (fs.existsSync(pubPath) && fs.statSync(pubPath).isFile()) return pubPath;
  return null;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);

  try {
    if (req.method === 'GET' && pathname === '/api/rates') {
      return sendJson(res, 200, await getRates());
    }
    if (req.method === 'GET' && pathname === '/api/config') {
      return sendJson(res, 200, { privacyPolicyUrl: PRIVACY_POLICY_URL });
    }
    if (req.method === 'GET' && pathname === '/api/lookup') {
      const address = url.searchParams.get('address') || '';
      if (address.trim().length < 6) {
        return sendJson(res, 400, { ok: false, error: 'address_required' });
      }
      return sendJson(res, 200, await getLookup(address));
    }
    if (req.method === 'POST' && pathname === '/api/leads') {
      return handleLead(req, res);
    }
    if (req.method === 'GET') {
      const pageFor = {
        '/': 'index.html', '/index.html': 'index.html',
        '/know-your-numbers': 'know-your-numbers.html', '/know-your-numbers.html': 'know-your-numbers.html',
        '/deal-analyzer': 'deal-analyzer.html', '/deal-analyzer.html': 'deal-analyzer.html',
        '/self-employed-qualifier': 'self-employed-qualifier.html', '/self-employed-qualifier.html': 'self-employed-qualifier.html'
      };
      if (pageFor[pathname]) {
        const page = pickSiteFile(pageFor[pathname]);
        if (page) return serveFile(res, page);
      }
      // Static assets: only the site's css/js folders and logo, resolved
      // root-first with the same fallback. Everything else 404s.
      if (/^\/(css|js)\/[\w.-]+$/.test(pathname) || pathname === '/logo.jpg' || pathname === '/logo.png' || pathname === '/home-fit-icon.png' || pathname === '/affordability-icon.png') {
        const asset = pickSiteFile(pathname.slice(1));
        if (asset) return serveFile(res, asset);
      }
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Server error');
  }
});

server.listen(PORT, () => {
  console.log('WHB tools listening on port ' + PORT);
});
