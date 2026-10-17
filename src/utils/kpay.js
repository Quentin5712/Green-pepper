'use strict';
const axios = require('axios');

const BASE_URL = process.env.KPAY_BASE_URL || 'https://admin.kpay.site';
const API_KEY  = process.env.KPAY_API_KEY  || '';

/**
 * Initier un paiement KPay Production
 * POST /api/v1/payments/init
 */
async function initPayment({ amount, provider, phoneNumber, externalId, description }) {
  if (!API_KEY) throw new Error('KPAY_API_KEY manquant dans les variables d\'environnement');

  const payload = {
    amount:      Math.round(Number(amount)),
    provider,    // 'MTN_MOMO_CMR' | 'ORANGE_CMR'
    phoneNumber: formatPhone(phoneNumber),
    externalId,
    description: description || 'Green Pepper Market',
  };

  console.log(`🟡 KPay init: ${provider} | ${payload.phoneNumber} | ${payload.amount} XAF | ${externalId}`);

  const r = await axios.post(
    `${BASE_URL}/api/v1/payments/init`,
    payload,
    {
      headers: {
        'x-api-key':    API_KEY,
        'Content-Type': 'application/json',
      },
      timeout: 20000,
    }
  );

  console.log(`✅ KPay réponse:`, JSON.stringify(r.data));
  return r.data;
}

/**
 * Vérifier le statut d'un paiement KPay
 * GET /api/v1/payments/:externalId
 */
async function getPaymentStatus(externalId) {
  if (!API_KEY) throw new Error('KPAY_API_KEY manquant');
  const r = await axios.get(
    `${BASE_URL}/api/v1/payments/${externalId}`,
    {
      headers: { 'x-api-key': API_KEY },
      timeout: 10000,
    }
  );
  return r.data;
}

/**
 * Formater un numéro camerounais en 237XXXXXXXXX
 */
function formatPhone(phone) {
  let p = String(phone).replace(/[\s\-\+\.]/g, '');
  if (p.startsWith('00237')) p = p.slice(2);
  if (p.startsWith('237') && p.length === 12) return p;
  return '237' + p.slice(-9);
}

module.exports = { initPayment, getPaymentStatus, formatPhone };
