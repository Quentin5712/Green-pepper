'use strict';
const axios = require('axios');

const MOMO_ENV  = process.env.MOMO_ENV || 'mtncameroon';
const MOMO_BASE = MOMO_ENV === 'sandbox'
  ? 'https://sandbox.momodeveloper.mtn.com'
  : 'https://proxy.momoapi.mtn.com';
const MOMO_SUB  = process.env.MOMO_SUBSCRIPTION_KEY || '';
const MOMO_USER = process.env.MOMO_API_USER         || '';
const MOMO_KEY  = process.env.MOMO_API_KEY          || '';

/**
 * Formate un numéro camerounais en 237XXXXXXXXX
 */
function formatPhone(phone) {
  let p = String(phone).replace(/[\s\-\+\.]/g, '');
  if (p.startsWith('00237')) p = p.slice(2);
  if (p.startsWith('237') && p.length === 12) return p;
  return '237' + p.slice(-9);
}

/**
 * Obtenir un token d'accès MTN MoMo
 */
async function getMomoToken() {
  if (!MOMO_SUB || !MOMO_USER || !MOMO_KEY) {
    throw new Error('Clés MTN MoMo manquantes (MOMO_SUBSCRIPTION_KEY, MOMO_API_USER, MOMO_API_KEY)');
  }
  const creds = Buffer.from(`${MOMO_USER}:${MOMO_KEY}`).toString('base64');
  const r = await axios.post(
    `${MOMO_BASE}/collection/token/`,
    {},
    {
      headers: {
        'Authorization': `Basic ${creds}`,
        'Ocp-Apim-Subscription-Key': MOMO_SUB,
      },
      timeout: 15000,
    }
  );
  return r.data.access_token;
}

/**
 * Déclencher un RequestToPay MTN MoMo
 * → Envoie une notification push au client pour entrer son PIN
 */
async function requestToPay({ reference, amount, phone, productNames, callbackUrl }) {
  const token      = await getMomoToken();
  const payerMSISDN = formatPhone(phone);

  await axios.post(
    `${MOMO_BASE}/collection/v1_0/requesttopay`,
    {
      amount:       String(Math.round(amount)),
      currency:     'XAF',
      externalId:   reference,
      payer:        { partyIdType: 'MSISDN', partyId: payerMSISDN },
      payerMessage: `Green Pepper Market — ${productNames}`,
      payeeNote:    `Commande ${reference}`,
    },
    {
      headers: {
        'Authorization':             `Bearer ${token}`,
        'X-Reference-Id':            reference,
        'X-Target-Environment':      MOMO_ENV,
        'Ocp-Apim-Subscription-Key': MOMO_SUB,
        'Content-Type':              'application/json',
        ...(callbackUrl ? { 'X-Callback-Url': callbackUrl } : {}),
      },
      timeout: 20000,
    }
  );

  console.log(`✅ MTN RequestToPay envoyé → ${payerMSISDN} (ref: ${reference})`);
  return { reference, phone: payerMSISDN };
}

/**
 * Vérifier le statut d'un paiement MTN
 */
async function getPaymentStatus(reference) {
  const token = await getMomoToken();
  const r = await axios.get(
    `${MOMO_BASE}/collection/v1_0/requesttopay/${reference}`,
    {
      headers: {
        'Authorization':             `Bearer ${token}`,
        'X-Target-Environment':      MOMO_ENV,
        'Ocp-Apim-Subscription-Key': MOMO_SUB,
      },
      timeout: 10000,
    }
  );
  return r.data; // { status: 'SUCCESSFUL'|'FAILED'|'PENDING', financialTransactionId, ... }
}

/**
 * Orange Money — obtenir token OAuth
 */
async function getOrangeToken() {
  const OM_ID  = process.env.OM_CLIENT_ID     || '';
  const OM_SEC = process.env.OM_CLIENT_SECRET  || '';
  if (!OM_ID || !OM_SEC) throw new Error('Clés Orange Money manquantes');
  const creds = Buffer.from(`${OM_ID}:${OM_SEC}`).toString('base64');
  const r = await axios.post(
    'https://api.orange.com/oauth/v3/token',
    'grant_type=client_credentials',
    {
      headers: {
        'Authorization': `Basic ${creds}`,
        'Content-Type':  'application/x-www-form-urlencoded',
      },
      timeout: 15000,
    }
  );
  return r.data.access_token;
}

/**
 * Orange Money — initier un paiement web
 */
async function orangeRequestToPay({ reference, amount, callbackUrl }) {
  const token    = await getOrangeToken();
  const OM_MKEY  = process.env.OM_MERCHANT_KEY || '';
  const r = await axios.post(
    'https://api.orange.com/orange-money-webpay/cm/v1/webpayment',
    {
      merchant_key: OM_MKEY,
      currency:     'XAF',
      order_id:     reference,
      amount:       String(Math.round(amount)),
      return_url:   callbackUrl || '/',
      cancel_url:   callbackUrl || '/',
      notif_url:    callbackUrl ? callbackUrl.replace('/callback', '/callback-om') : '/',
      lang:         'fr',
      reference,
    },
    {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type':  'application/json',
      },
      timeout: 20000,
    }
  );
  return r.data; // { payment_url, ... }
}

module.exports = { formatPhone, getMomoToken, requestToPay, getPaymentStatus, getOrangeToken, orangeRequestToPay };
