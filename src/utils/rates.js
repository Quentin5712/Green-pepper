'use strict';
// Taux FCFA → USDT. Source gratuite sans clé : open.er-api.com (USD de base). Mis en cache 15 min.
// Si la source tombe : on garde le dernier taux connu 6 h max, puis le prix USDT est masqué (jamais un taux inventé).
const axios  = require('axios');
const logger = require('./logger');

let cache = { rate: null, at: 0 };
const FRESH = 15 * 60 * 1000, STALE = 6 * 3600 * 1000;

async function getXafPerUsd() {
  const manual = Number(process.env.XAF_PER_USD_OVERRIDE);
  if (Number.isFinite(manual) && manual > 0) return manual;
  if (cache.rate && Date.now() - cache.at < FRESH) return cache.rate;
  try {
    const r = await axios.get(process.env.FX_RATES_URL || 'https://open.er-api.com/v6/latest/USD', { timeout: 8000 });
    const xaf = Number(r.data?.rates?.XAF);
    if (!(xaf > 100 && xaf < 5000)) throw new Error('taux XAF illisible');
    cache = { rate: xaf, at: Date.now() };
    return xaf;
  } catch (e) {
    logger.warn(`FX: source de taux indisponible (${e.message})`);
    if (cache.rate && Date.now() - cache.at < STALE) return cache.rate;
    return null;
  }
}
const margin = () => { const m = Number(process.env.USDT_MARGIN); return Number.isFinite(m) && m >= 0 && m <= 0.2 ? m : 0.015; };

// Montant USDT à payer pour un prix en FCFA (marge de change incluse, arrondi au centime supérieur)
async function quote(amountFcfa) {
  const rate = await getXafPerUsd();
  if (!rate) return { usdt: null, rate: null, margin: margin() };
  const usd = Math.ceil((Number(amountFcfa) / rate) * (1 + margin()) * 100) / 100;
  return { usdt: usd, rate, margin: margin(), validMinutes: 20 };
}
module.exports = { getXafPerUsd, quote };
