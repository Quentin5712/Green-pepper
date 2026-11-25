'use strict';
// USDT (TRC20) via NOWPayments : création du paiement, lecture du statut, signature des notifications (HMAC-SHA512).
const axios  = require('axios');
const crypto = require('crypto');
const logger = require('./logger');

const base = () => (process.env.NOWPAYMENTS_BASE_URL || (process.env.NOWPAYMENTS_SANDBOX === '1' ? 'https://api-sandbox.nowpayments.io/v1' : 'https://api.nowpayments.io/v1')).replace(/\/+$/, '');
const key  = () => process.env.NOWPAYMENTS_API_KEY || '';
const isConfigured = () => !!(key() && process.env.NOWPAYMENTS_IPN_SECRET);

function fail(label, e) {
  logger.error(`${label}: status=${e.response?.status} data=${JSON.stringify(e.response?.data || null)} message=${e.message}`);
  const err = new Error(e.response?.data?.message || e.message); err.status = e.response?.status; return err;
}

async function createPayment({ priceUsd, orderId, description, ipnUrl }) {
  if (!isConfigured()) throw new Error('NOWPayments non configuré');
  try {
    const r = await axios.post(base() + '/payment', {
      price_amount: priceUsd, price_currency: 'usd', pay_currency: 'usdttrc20',
      order_id: orderId, order_description: String(description || '').slice(0, 120), ipn_callback_url: ipnUrl,
    }, { headers: { 'x-api-key': key(), 'Content-Type': 'application/json' }, timeout: 15000 });
    return r.data;
  } catch (e) { throw fail('NOWPayments create failed', e); }
}
async function getPayment(paymentId) {
  if (!key()) throw new Error('NOWPayments non configuré');
  try { return (await axios.get(base() + '/payment/' + encodeURIComponent(paymentId), { headers: { 'x-api-key': key() }, timeout: 15000 })).data; }
  catch (e) { throw fail('NOWPayments status failed', e); }
}

// La signature porte sur le corps JSON dont les clés sont triées (récursivement)
function sortDeep(o) {
  if (Array.isArray(o)) return o.map(sortDeep);
  if (o && typeof o === 'object') return Object.keys(o).sort().reduce((a, k) => { a[k] = sortDeep(o[k]); return a; }, {});
  return o;
}
function verifyIpn(body, sig) {
  const secret = process.env.NOWPAYMENTS_IPN_SECRET || '';
  if (!secret || !sig) return false;
  const expected = crypto.createHmac('sha512', secret).update(JSON.stringify(sortDeep(body || {}))).digest('hex');
  const got = String(sig).trim().toLowerCase();
  try { return got.length === expected.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected)); } catch (e) { return false; }
}
function normalizeStatus(s) {
  const st = String(s || '').toLowerCase();
  if (st === 'finished') return 'SUCCESS';
  if (['failed', 'expired', 'refunded'].includes(st)) return 'FAILED';
  if (st === 'partially_paid') return 'PARTIAL';
  return 'PENDING';                                     // waiting, confirming, confirmed, sending
}
module.exports = { isConfigured, createPayment, getPayment, verifyIpn, sortDeep, normalizeStatus };
