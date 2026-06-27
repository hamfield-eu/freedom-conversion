'use strict';

require('dotenv').config();
const path = require('path');
const express = require('express');
const { getConversionRate } = require('./rates');

const app = express();
const PORT = process.env.PORT || 8081;
const TTL = (Number(process.env.RATE_CACHE_TTL) || 3600) * 1000;

app.disable('x-powered-by');

// ---- Static PWA ----
const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir, { extensions: ['html'] }));

// ---- Currency rate endpoint ----
const ALLOWED = new Set(['USD', 'EUR', 'GBP', 'CAD', 'CNY', 'MXN']);
// A forced refresh (?fresh=1) is honored at most once per hour per pair.
// Frankfurter uses ECB rates that update only once per working day, so there's
// no point hitting it more often — this keeps us a polite API citizen.
const REFRESH_MIN_MS = 60 * 60 * 1000;

const cache = new Map(); // key: "USD>EUR" -> { value, expires, fetchedAt }

app.get('/api/rate', async (req, res) => {
  const from = String(req.query.from || 'USD').toUpperCase().slice(0, 3);
  const to = String(req.query.to || 'EUR').toUpperCase().slice(0, 3);
  const fresh = req.query.fresh === '1';

  if (!ALLOWED.has(from) || !ALLOWED.has(to)) {
    return res.status(400).json({ error: 'unsupported_currency' });
  }

  const now = Date.now();
  const key = `${from}>${to}`;
  const hit = cache.get(key);
  const nextRefreshAt = hit ? hit.fetchedAt + REFRESH_MIN_MS : now;

  // Decide whether to actually call Frankfurter.
  //  - normal request: only when the cache is empty or past its TTL
  //  - forced refresh : only when the last fetch was > REFRESH_MIN_MS ago
  const stale = !hit || hit.expires <= now;
  const refreshAllowed = !hit || now - hit.fetchedAt >= REFRESH_MIN_MS;
  const shouldFetch = fresh ? refreshAllowed : stale;

  if (!shouldFetch && hit) {
    return res.json({ ...hit.value, cached: true, nextRefreshAt });
  }

  try {
    const result = await getConversionRate(from, to);
    const value = { from, to, rate: result.rate, date: result.date };
    cache.set(key, { value, expires: now + TTL, fetchedAt: now });
    res.json({ ...value, cached: false, nextRefreshAt: now + REFRESH_MIN_MS });
  } catch (err) {
    console.error('[rate] error:', err.message);
    // Serve a stale cached value if we have one, rather than failing outright.
    if (hit) return res.json({ ...hit.value, cached: true, stale: true, nextRefreshAt });
    res.status(502).json({ error: 'rate_unavailable', detail: err.message });
  }
});

app.get('/healthz', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Freedom Units running on http://0.0.0.0:${PORT}`);
});
