'use strict';
const axios  = require('axios');
const crypto = require('crypto');
const logger = require('./logger');

const API_KEY  = process.env.KPAY_API_KEY;
const G_SECRET = process.env.KPAY_GATEWAY_SECRET;

// --- Détection automatique TEST / LIVE à partir de la clé ---
function getMode() {
  const key = String(API_KEY || '').toLowerCase();
  const forced = String(process.env.KPAY_MODE || process.env.KPAY_ENV || '').toLowerCase();
  if (forced === 'live' || forced === 'prod' || forced === 'production') return 'LIVE';
  if (forced === 'test' || forced === 'sandbox') return 'TEST';
  if (key.includes('live') || key.includes('prod')) return 'LIVE';
  if (key.includes('test') || key.includes('sandbox')) return 'TEST';
  return 'TEST';
}

function getBaseUrl() {
  const mode = getMode();
  if (mode === 'LIVE') {
    return process.env.KPAY_LIVE_BASE_URL || process.env.KPAY_BASE_URL || 'https://admin.kpay.site';
  }
  return process.env.KPAY_TEST_BASE_URL || process.env.KPAY_BASE_URL || 'https://admin.kpay.site';
}

function formatPhone(phone) {
  let p = String(phone).replace(/[\s\-\+\.]/g, '');
  if (p.startsWith('00237')) p = p.slice(2);
  if (p.startsWith('237') && p.length === 12) return p;
  return '237' + p.slice(-9);
}

async function initPayment({ amount, provider, phoneNumber, externalId, description }) {
  if (!API_KEY) throw new Error('KPAY_API_KEY manquant');
  const mode = getMode();
  const BASE_URL = getBaseUrl();
  const payload = { amount: Math.round(amount), provider, phoneNumber: formatPhone(phoneNumber), externalId, description: description || 'Green Pepper Market' };
  logger.info(`KPay [${mode}] init: ${provider} ${payload.phoneNumber} ${payload.amount} XAF ${externalId} -> ${BASE_URL}`);
  try {
    const r = await axios.post(`${BASE_URL}/api/v1/payments/init`, payload, {
      headers: {
        'x-api-key': API_KEY,
        'x-secret-key': G_SECRET,
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 10000,
    });
    logger.info(`KPay [${mode}] response: ${JSON.stringify(r.data)}`);
    return r.data;
  } catch (err) {
    logger.error(`KPay [${mode}] init failed: status=${err.response?.status} data=${JSON.stringify(err.response?.data)} message=${err.message}`);
    throw err;
  }
}

async function getStatus(externalId) {
  if (!API_KEY) throw new Error('KPAY_API_KEY manquant');
  const mode = getMode();
  const BASE_URL = getBaseUrl();
  try {
    const r = await axios.get(`${BASE_URL}/api/v1/payments/${externalId}`, {
      headers: {
        'x-api-key': API_KEY,
        'x-secret-key': G_SECRET,
        'Authorization': `Bearer ${API_KEY}`
      },
      timeout: 10000,
    });
    return r.data;
  } catch (err) {
    logger.error(`KPay [${mode}] getStatus failed: status=${err.response?.status} data=${JSON.stringify(err.response?.data)} message=${err.message}`);
    throw err;
  }
}

function verifyHmac(body, sigHeader) {
  const secret = process.env.KPAY_WEBHOOK_SECRET || process.env.KPAY_GATEWAY_SECRET || G_SECRET;
  if (!secret || !sigHeader) return false;
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  const received = String(sigHeader).replace(/^sha256=/i, '').trim();
  try {
    return received.length === expected.length &&
           crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected));
  } catch(e) { return false; }
}

module.exports = { initPayment, getStatus, verifyHmac, formatPhone, getMode, getBaseUrl };
