'use strict';
const axios  = require('axios');
const crypto = require('crypto');
const logger = require('./logger');

const BASE_URL = process.env.KPAY_BASE_URL  || 'https://admin.kpay.site';
const API_KEY  = process.env.KPAY_API_KEY;
const G_SECRET = process.env.KPAY_GATEWAY_SECRET;

function formatPhone(phone) {
  let p = String(phone).replace(/[\s\-\+\.]/g, '');
  if (p.startsWith('00237')) p = p.slice(2);
  if (p.startsWith('237') && p.length === 12) return p;
  return '237' + p.slice(-9);
}

async function initPayment({ amount, provider, phoneNumber, externalId, description }) {
  if (!API_KEY) throw new Error('KPAY_API_KEY manquant');
  const payload = { amount: Math.round(amount), provider, phoneNumber: formatPhone(phoneNumber), externalId, description: description || 'Green Pepper Market' };
  logger.info(`KPay init: ${provider} ${payload.phoneNumber} ${payload.amount} XAF ${externalId}`);
  const r = await axios.post(`${BASE_URL}/api/v1/payments/init`, payload, {
    headers: { 'x-api-key': API_KEY, 'Content-Type': 'application/json' },
    timeout: 10000,
  });
  logger.info(`KPay response: ${JSON.stringify(r.data)}`);
  return r.data;
}

async function getStatus(externalId) {
  if (!API_KEY) throw new Error('KPAY_API_KEY manquant');
  const r = await axios.get(`${BASE_URL}/api/v1/payments/${externalId}`, {
    headers: { 'x-api-key': API_KEY }, timeout: 10000,
  });
  return r.data;
}

function verifyHmac(body, sigHeader) {
  if (!G_SECRET) return false;
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const expected = crypto.createHmac('sha256', G_SECRET).update(raw).digest('hex');
  try { return sigHeader.length === expected.length && crypto.timingSafeEqual(Buffer.from(sigHeader), Buffer.from(expected)); }
  catch(e) { return false; }
}

module.exports = { initPayment, getStatus, verifyHmac, formatPhone };
