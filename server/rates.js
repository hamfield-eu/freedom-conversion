'use strict';

/*
 * Exchange rates via the Frankfurter API — https://frankfurter.dev
 *
 * Free, open source, no API key or authentication. Rates are European Central
 * Bank reference rates, published once per working day (~16:00 CET).
 *
 *   GET {base}/latest?base=USD&symbols=EUR
 *   -> { "amount": 1.0, "base": "USD", "date": "2026-06-23", "rates": { "EUR": 0.87781 } }
 */

const BASE = (process.env.FRANKFURTER_BASE_URL || 'https://api.frankfurter.dev/v1').replace(/\/$/, '');

/**
 * Fetch the exchange rate for 1 unit of `from` expressed in `to`.
 * @returns {Promise<{rate:number, date:string, raw:object}>}
 */
async function getConversionRate(from, to) {
  const url = `${BASE}/latest?base=${encodeURIComponent(from)}&symbols=${encodeURIComponent(to)}`;

  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Frankfurter API ${res.status}: ${text.slice(0, 300)}`);
  }

  let json;
  try { json = JSON.parse(text); } catch {
    throw new Error(`Unexpected non-JSON response: ${text.slice(0, 200)}`);
  }

  const rate = Number(json.rates && json.rates[to]);
  if (!isFinite(rate) || rate <= 0) {
    throw new Error(`No rate for ${from} -> ${to} in response: ${text.slice(0, 200)}`);
  }

  return {
    rate,
    date: json.date || new Date().toISOString().slice(0, 10),
    raw: json,
  };
}

module.exports = { getConversionRate };
