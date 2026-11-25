'use strict';
// /api/pay/* — moyens de paiement au-delà du Mobile Money direct : page hébergée (carte Visa/Mastercard + autres opérateurs) et USDT (TRC20)
const express = require('express');
const router  = express.Router();
const Order   = require('../models/Order');
const kpay    = require('../utils/kpay');
const wallet  = require('../utils/wallet');
const rates   = require('../utils/rates');
const nowpayments = require('../utils/nowpayments');
const checkout    = require('../utils/checkout');
const logger  = require('../utils/logger');
const { authIfPresent } = require('../middlewares/auth');
const limits  = require('../middlewares/rateLimiters');
const { COUNTRIES, PROVIDERS, providerInfo, providersOfCountry } = require('../utils/countries');

const origin = req => (process.env.SITE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
const USDT_WINDOW_MIN = 60;                                   // au-delà, la commande expire et le stock est libéré

// ── Ce qui est disponible (la page de paiement grise ce qui ne l'est pas) ──
router.get('/config', async (req, res) => {
  let cfg = null; try { cfg = await kpay.getKpayConfig(); } catch (e) {}
  const kpayOk = !!(cfg && cfg.apiKey && cfg.merchantNumber);
  res.json({
    siteName: process.env.SITE_NAME || 'Marketplace Afrique',
    mode: cfg ? cfg.mode : null,
    methods: { momo: kpayOk, gateway: kpayOk && process.env.KPAY_GATEWAY_ENABLED !== 'off', usdt: nowpayments.isConfigured() },
    countries: Object.entries(COUNTRIES).map(([iso, c]) => ({ iso, name: c.name, cc: c.cc, currency: c.currency, flag: c.flag, providers: providersOfCountry(iso) })),
  });
});

// ── Prix en FCFA + équivalent USDT ──
router.get('/quote', async (req, res) => {
  const amount = Math.round(Number(req.query.amount));
  if (!Number.isFinite(amount) || amount < 0 || amount > 1e10) return res.status(400).json({ error: 'Montant invalide' });
  const q = await rates.quote(amount);
  res.json({ amountFcfa: amount, usdt: q.usdt, xafPerUsdt: q.rate, margin: q.margin, validMinutes: q.validMinutes || null });
});

// ── Page de paiement hébergée KPay : carte Visa/Mastercard et opérateurs choisis par le client ──
router.post('/gateway', limits.pay, authIfPresent, async (req, res) => {
  try {
    const r = await checkout.createCheckoutOrder(req, { method: 'GATEWAY', phone: (req.body || {}).phone });
    if (!r.ok) return res.status(r.status).json(r.body);
    const o = r.order;
    if (r.existing) return res.json({ status: o.status, kpayId: o.kpayId, externalId: o.externalId, orderNumber: o.orderNumber, trackToken: r.trackToken, orderType: o.orderType, existing: true });
    let gw;
    try {
      gw = await kpay.initGateway({ amount: o.finalAmount, externalId: o.externalId, orderNumber: o.orderNumber, description: `Commande ${o.orderNumber}`,
        returnUrl: `${origin(req)}/suivi.html?ext=${encodeURIComponent(o.externalId)}`, cancelUrl: `${origin(req)}/paiement.html?cancel=1` });
    } catch (e) {
      await wallet.markFailed(o, 'FAILED', { error: e.message });
      return res.status(502).json({ error: 'Impossible d\'ouvrir la page de paiement. Réessayez ou choisissez un autre moyen.', code: e.code });
    }
    await Order.updateOne({ _id: o._id }, { $set: { kpayId: gw.id || ('gw_' + o.externalId), kpayRef: gw.reference || '' } });
    res.json({ status: 'PENDING', redirectUrl: gw.gatewayUrl, kpayId: gw.id || ('gw_' + o.externalId), externalId: o.externalId, orderNumber: o.orderNumber, trackToken: r.trackToken, orderType: o.orderType });
  } catch (e) { logger.error(`pay/gateway: ${e.message}`); res.status(500).json({ error: 'Erreur serveur paiement' }); }
});

// ── USDT (TRC20) : adresse + montant exact à envoyer ──
router.post('/usdt', limits.pay, authIfPresent, async (req, res) => {
  try {
    if (!nowpayments.isConfigured()) return res.status(503).json({ error: 'Le paiement en USDT n\'est pas encore activé.' });
    const r = await checkout.createCheckoutOrder(req, { method: 'USDT', phone: (req.body || {}).phone });
    if (!r.ok) return res.status(r.status).json(r.body);
    const o = r.order;
    const view = ord => ({ status: ord.status, kpayId: ord.kpayId, externalId: ord.externalId, orderNumber: ord.orderNumber, trackToken: r.trackToken, orderType: ord.orderType,
      crypto: { address: ord.crypto?.payAddress, amount: ord.crypto?.payAmount, currency: 'USDT', network: 'TRC20', expiresAt: ord.crypto?.expiresAt }, priceUsd: ord.crypto?.priceUsd });
    if (r.existing) return res.json({ ...view(o), existing: true });

    const q = await rates.quote(o.finalAmount);
    if (!q.usdt) { await wallet.markFailed(o, 'FAILED', { error: 'taux indisponible' }); return res.status(503).json({ error: 'USDT indisponible : taux de change introuvable. Réessayez dans un instant.' }); }
    let np;
    try { np = await nowpayments.createPayment({ priceUsd: q.usdt, orderId: o.externalId, description: `Commande ${o.orderNumber}`, ipnUrl: `${origin(req)}/api/pay/usdt/ipn` }); }
    catch (e) { await wallet.markFailed(o, 'FAILED', { error: e.message }); return res.status(502).json({ error: 'Impossible de créer le paiement USDT. Réessayez ou choisissez un autre moyen.' }); }
    const crypto_ = { paymentId: String(np.payment_id), payAddress: np.pay_address, payAmount: Number(np.pay_amount), priceUsd: q.usdt, rate: q.rate, status: np.payment_status || 'waiting', actuallyPaid: 0, expiresAt: new Date(Date.now() + USDT_WINDOW_MIN * 60000) };
    await Order.updateOne({ _id: o._id }, { $set: { crypto: crypto_, kpayId: 'np_' + crypto_.paymentId } });
    logger.info(`USDT créé: order=${o.orderNumber} np=${crypto_.paymentId} ${crypto_.payAmount} USDT (${o.finalAmount} FCFA, taux ${q.rate})`);
    res.json(view({ ...o.toObject?.() || o, status: 'PENDING', kpayId: 'np_' + crypto_.paymentId, crypto: crypto_ }));
  } catch (e) { logger.error(`pay/usdt: ${e.message}`); res.status(500).json({ error: 'Erreur serveur paiement' }); }
});

// ── Notification NOWPayments : signature HMAC-SHA512 obligatoire, puis le statut est relu chez NOWPayments ──
router.post('/usdt/ipn', async (req, res) => {
  try {
    if (!nowpayments.verifyIpn(req.body, req.get('x-nowpayments-sig'))) { logger.warn(`USDT IPN signature invalide ip=${req.ip}`); return res.status(401).json({ error: 'Signature invalide' }); }
    const order = await Order.findOne({ externalId: String((req.body || {}).order_id || ''), paymentMethod: 'USDT' });
    if (!order) return res.status(404).json({ error: 'Commande introuvable' });
    logger.info(`WEBHOOK USDT: order=${order.orderNumber} statut=${(req.body || {}).payment_status}`);
    try { await wallet.reconcileOrder(order); } catch (e) { logger.error(`USDT IPN réconciliation: ${e.message}`); return res.status(500).json({ error: 'Réessayez' }); }
    res.json({ ok: true });
  } catch (e) { logger.error(`pay/usdt/ipn: ${e.message}`); res.status(500).json({ error: 'Erreur serveur' }); }
});

module.exports = router;
