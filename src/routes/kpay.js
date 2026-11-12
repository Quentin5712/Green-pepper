'use strict';
// ═══════════════════════════════════════════════════════════════════
// /api/kpay/*  — paiement, webhook, statut, livraison avec photo, litige, portefeuille vendeur
// ═══════════════════════════════════════════════════════════════════
const express = require('express');
const crypto  = require('crypto');
const router  = express.Router();
const Order   = require('../models/Order');
const Product = require('../models/Product');
const User    = require('../models/User');
const kpay    = require('../utils/kpay');
const wallet  = require('../utils/wallet');
const logger  = require('../utils/logger');
const { authIfPresent, verifyToken, verifyMerchant } = require('../middlewares/auth');
const limits  = require('../middlewares/rateLimiters');
const { clean, PHONE_RE } = require('../utils/clean');
const { notifyUser } = require('../utils/notify');

const isHex24  = s => /^[a-f0-9]{24}$/.test(String(s || ''));
const isKpayId = s => /^[A-Za-z0-9_\-]{4,100}$/.test(String(s || ''));
const PROVIDERS = ['MTN_MOMO_CMR', 'ORANGE_CMR'];
const MIN_AMOUNT = 500;                       // minimum KPay au Cameroun

function safeEqual(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

// L'acheteur prouve qu'il est l'acheteur : compte connecté propriétaire, OU jeton de suivi remis au paiement
async function findForBuyer(req, { kpayId, orderId, token }) {
  let order = null;
  if (kpayId && isKpayId(kpayId)) order = await Order.findOne({ kpayId }).select('+trackToken');
  else if (orderId && isHex24(orderId)) order = await Order.findById(orderId).select('+trackToken');
  if (!order) return { status: 404, error: 'Commande introuvable' };
  const isOwner = !!(req.user && order.userId && String(order.userId) === String(req.user.id));
  const isAdmin = !!(req.user && req.user.role === 'admin');
  const tokenOk = safeEqual(token, order.trackToken);
  if (!isOwner && !isAdmin && !tokenOk) return { status: 403, error: 'Accès refusé' };
  return { order, isOwner, isAdmin, tokenOk };
}

// ══════════════ POST /api/kpay/pay ══════════════
router.post('/pay', limits.pay, authIfPresent, async (req, res) => {
  const reserved = [];
  const release = () => Promise.all(reserved.map(r => Product.findByIdAndUpdate(r.productId, { $inc: { stock: r.qty, reserved: -r.qty } })));
  try {
    let cfg;
    try { cfg = await kpay.getKpayConfig(); }
    catch (e) { logger.error(`KPay config invalide: ${e.message}`); return res.status(503).json({ error: 'Paiement indisponible (configuration).' }); }
    if (!cfg.apiKey) return res.status(503).json({ error: 'Paiement indisponible : clé KPay non configurée.' });
    if (!cfg.merchantNumber) { logger.error('ADMIN_PHONE manquant — paiement refusé'); return res.status(503).json({ error: 'Paiement indisponible : numéro de réception non configuré.' }); }

    const { phone, provider, items, address, customerName } = req.body || {};
    const phoneNum = String(phone || '').trim();
    if (!PHONE_RE.test(phoneNum)) return res.status(400).json({ error: 'Numéro Mobile Money invalide' });
    if (!PROVIDERS.includes(provider)) return res.status(400).json({ error: 'Opérateur invalide (MTN_MOMO_CMR ou ORANGE_CMR)' });
    if (!Array.isArray(items) || !items.length || items.length > 20) return res.status(400).json({ error: 'Panier invalide' });

    const wanted = new Map();
    for (const it of items) {
      const id = String(it?.productId || ''), qty = Number(it?.qty);
      if (!isHex24(id) || !Number.isInteger(qty) || qty < 1 || qty > 10) return res.status(400).json({ error: 'Produit ou quantité invalide (1 à 10)' });
      wanted.set(id, (wanted.get(id) || 0) + qty);
    }
    for (const q of wanted.values()) if (q > 10) return res.status(400).json({ error: 'Maximum 10 unités par produit' });

    const ids = [...wanted.keys()];
    const prods = await Product.find({ _id: { $in: ids }, isActive: true, isDeleted: false }).select('sellerId type');
    if (prods.length !== ids.length) return res.status(404).json({ error: 'Un produit du panier n\'est plus disponible' });
    if (new Set(prods.map(p => String(p.sellerId))).size > 1) return res.status(400).json({ error: 'Un paiement = une seule boutique. Commandez les boutiques séparément.' });
    if (new Set(prods.map(p => p.type || 'physical')).size > 1) return res.status(400).json({ error: 'Passez les produits physiques et digitaux en deux commandes séparées.' });

    // Prix TOUJOURS depuis la base ; stock réservé de façon atomique (jamais de survente)
    const orderItems = []; let amount = 0;
    for (const [pid, qty] of wanted) {
      const prod = await Product.findOneAndUpdate({ _id: pid, isDeleted: false, isActive: true, stock: { $gte: qty } }, { $inc: { stock: -qty, reserved: qty } }, { new: true });
      if (!prod) { await release(); return res.status(409).json({ error: 'Stock insuffisant pour un produit du panier' }); }
      reserved.push({ productId: pid, qty });
      const unit = prod.finalPrice;
      orderItems.push({ productId: prod._id, name: prod.name, qty, priceAtPurchase: unit, discountApplied: prod.discount || 0, sellerId: prod.sellerId });
      amount += unit * qty;
    }
    amount = Math.round(amount);
    if (amount < MIN_AMOUNT) { await release(); return res.status(400).json({ error: `Montant minimum : ${MIN_AMOUNT} FCFA` }); }

    const externalId = 'GP-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex').toUpperCase();
    const trackToken = crypto.randomBytes(24).toString('hex');
    let order;
    try {
      order = await Order.create({
        userId: req.user?.id || null, guestPhone: req.user ? '' : phoneNum, payerPhone: kpay.formatPhone(phoneNum),
        customerName: clean(customerName || '', 80), address: clean(address || '', 300),
        items: orderItems, amount, finalAmount: amount,
        status: 'PENDING', externalId, provider, trackToken,
        vendorId: String(prods[0].sellerId), orderType: prods[0].type || 'physical', receiverPhone: cfg.merchantNumber,
      });
    } catch (e) { await release(); throw e; }
    logger.info(`PENDING: order=${order.orderNumber} ext=${externalId} ${amount} XAF type=${order.orderType} mode=${cfg.mode}`);

    let pay;
    try {
      pay = await kpay.initPayment({ amount, provider, phoneNumber: phoneNum, externalId, orderNumber: order.orderNumber, description: `Commande ${order.orderNumber}` });
    } catch (e) {
      await wallet.markFailed(order, 'FAILED', { error: e.message });            // libère le stock
      return res.status(502).json({ error: 'Impossible de lancer le paiement. Vérifiez le numéro et réessayez.', code: e.code });
    }
    const upd = { kpayRef: pay.reference || '' };
    if (pay.id) upd.kpayId = pay.id;
    if (pay.feeAmount != null) upd.kpayFee = pay.feeAmount;
    if (pay.netAmount != null) upd.kpayNet = pay.netAmount;
    await Order.updateOne({ _id: order._id }, { $set: upd });

    res.json({
      status: 'PENDING', kpayId: pay.id || null, externalId, orderNumber: order.orderNumber, trackToken,
      orderType: order.orderType,
      message: provider === 'MTN_MOMO_CMR' ? 'Composez *126# et validez le paiement, ou attendez la demande MoMo.' : 'Validez le paiement sur votre téléphone Orange Money.',
    });
  } catch (e) {
    try { await release(); } catch (x) {}
    logger.error(`kpay/pay: ${e.message}`);
    res.status(500).json({ error: 'Erreur serveur paiement' });
  }
});

// ══════════════ POST /api/kpay/webhook ══════════════
// On ne fait JAMAIS confiance au corps seul : signature HMAC valide, sinon vérification auprès de KPay avec kpayId.
router.post('/webhook', async (req, res) => {
  try {
    const body = req.body || {};
    const d = body.data || body.payment || body.payout || {};
    const evt = String(body.event || body.type || '').toLowerCase();
    const externalId = String(body.externalId || body.external_id || d.externalId || d.external_id || '');
    const kpayId = String(body.id || body.paymentId || d.id || d.paymentId || '');
    let outcome = kpay.normalizeStatus(body.status || d.status);
    if (outcome === 'PENDING') {
      if (/completed|success/.test(evt)) outcome = 'SUCCESS';
      else if (/failed|cancel|expired/.test(evt)) outcome = 'FAILED';
    }
    const sig = req.get('x-kpay-signature') || req.get('x-webhook-signature') || req.get('x-signature') || '';
    const signed = kpay.verifyHmac(req.rawBody || JSON.stringify(body), sig);
    logger.info(`WEBHOOK KPay: event=${evt || '-'} ext=${externalId || '-'} kpayId=${kpayId || '-'} outcome=${outcome} signé=${signed}`);

    // ── Résultat d'un versement vendeur ──
    if (evt.startsWith('payout') || externalId.startsWith('PAYOUT-')) {
      if (!signed) { logger.warn('WEBHOOK payout non signé — ignoré'); return res.status(401).json({ error: 'Signature invalide' }); }
      const o = await Order.findOne({ payoutExternalId: externalId });
      if (!o) return res.json({ ok: true, ignored: true });
      await wallet.applyPayoutResult(o, outcome, body.failureReason || d.failureReason || '');
      return res.json({ ok: true });
    }

    // ── Résultat d'un paiement client ──
    let order = null;
    if (externalId) order = await Order.findOne({ externalId });
    if (!order && kpayId && isKpayId(kpayId)) order = await Order.findOne({ kpayId });
    if (!order) { logger.warn(`WEBHOOK: commande introuvable ext=${externalId} kpayId=${kpayId}`); return res.status(404).json({ error: 'Commande introuvable' }); }
    if (!['PENDING', 'EXPIRED'].includes(order.status)) return res.json({ ok: true, status: order.status });

    let verified, fee = d.feeAmount ?? body.feeAmount ?? null, net = d.netAmount ?? body.netAmount ?? null;
    if (signed) verified = outcome;
    else if (order.kpayId) {
      try { const remote = await kpay.getStatus(order.kpayId); verified = remote.status; fee = remote.feeAmount; net = remote.netAmount; }
      catch (e) { logger.warn(`WEBHOOK non vérifiable ext=${externalId}: ${e.message}`); return res.status(401).json({ error: 'Callback non vérifiable' }); }
    } else { logger.warn(`WEBHOOK non signé et sans kpayId ext=${externalId} — refusé`); return res.status(401).json({ error: 'Callback non vérifiable' }); }

    if (verified === 'SUCCESS') await wallet.markPaid(order, { txId: kpayId || order.kpayId, fee: fee != null ? Number(fee) : null, net: net != null ? Number(net) : null, raw: body }, req.ip);
    else if (verified === 'FAILED') await wallet.markFailed(order, 'FAILED', body);
    return res.json({ ok: true });
  } catch (e) {
    logger.error(`kpay/webhook: ${e.message}`);
    res.status(500).json({ error: 'Erreur traitement webhook' });
  }
});

// ══════════════ GET /api/kpay/status/:kpayId ══════════════
const lastCheck = new Map();
router.get('/status/:kpayId', authIfPresent, async (req, res) => {
  try {
    if (!isKpayId(req.params.kpayId)) return res.status(400).json({ error: 'kpayId invalide' });
    let order = await Order.findOne({ kpayId: req.params.kpayId }).select('+trackToken');
    if (!order) return res.status(404).json({ error: 'Commande introuvable' });

    if (order.status === 'PENDING' && process.env.KPAY_API_KEY && Date.now() - (lastCheck.get(order.kpayId) || 0) > 4000) {
      lastCheck.set(order.kpayId, Date.now());
      if (lastCheck.size > 500) lastCheck.clear();
      try { await wallet.reconcileOrder(order); order = await Order.findOne({ kpayId: req.params.kpayId }).select('+trackToken'); } catch (e) { /* KPay injoignable : on renvoie l'état connu */ }
    }
    const isOwner = !!(req.user && order.userId && String(order.userId) === String(req.user.id));
    const allowed = isOwner || (req.user && req.user.role === 'admin') || safeEqual(req.query.token, order.trackToken);
    if (!allowed) return res.json({ status: order.status });             // sans preuve : l'état seulement

    const paid = ['VALIDÉ', 'LIVRÉ'].includes(order.status);
    let digitalLinks = [];
    if (paid && order.orderType === 'digital') {
      const ps = await Product.find({ _id: { $in: order.items.map(i => i.productId).filter(Boolean) } }).select('name +digitalUrl');
      digitalLinks = ps.filter(p => p.digitalUrl).map(p => ({ name: p.name, url: p.digitalUrl }));
    }
    res.json({
      kpayId: order.kpayId, orderNumber: order.orderNumber, status: order.status, finalAmount: order.finalAmount,
      orderType: order.orderType, deliveryStatus: order.deliveryStatus, photoUploaded: !!order.photo_livraison,
      shippedAt: order.shippedAt || null, paidAt: order.paidAt || null, createdAt: order.createdAt,
      items: order.items.map(i => ({ name: i.name, qty: i.qty })), digitalLinks,
    });
  } catch (e) { logger.error(`kpay/status: ${e.message}`); res.status(500).json({ error: 'Erreur serveur' }); }
});

// ══════════════ POST /api/kpay/confirm-delivery  (PHOTO OBLIGATOIRE) ══════════════
router.post('/confirm-delivery', limits.pay, authIfPresent, async (req, res) => {
  try {
    const f = await findForBuyer(req, req.body || {});
    if (f.error) return res.status(f.status).json({ error: f.error });
    if (!f.isOwner && !f.tokenOk) return res.status(403).json({ error: 'Seul l\'acheteur peut confirmer la réception' });
    const o = f.order;
    if (o.orderType !== 'physical') return res.status(400).json({ error: 'Produit digital : rien à confirmer' });
    if (o.status !== 'VALIDÉ' || o.deliveryStatus !== 'AWAITING') return res.status(409).json({ error: 'Cette commande ne peut pas être validée (déjà validée, en litige ou non payée)' });
    if (!o.photo_livraison) return res.status(400).json({ error: 'Photo du produit reçu obligatoire avant de confirmer.' });
    const r = await wallet.confirmDelivery(o._id);
    if (!r.ok) return res.status(409).json({ error: 'Validation impossible' });
    res.json({ success: true, message: 'Livraison validée par photo. Le vendeur va être payé.' });
  } catch (e) { logger.error(`kpay/confirm-delivery: ${e.message}`); res.status(500).json({ error: 'Erreur serveur' }); }
});

// ══════════════ POST /api/kpay/dispute (acheteur) ══════════════
router.post('/dispute', limits.pay, authIfPresent, async (req, res) => {
  try {
    const f = await findForBuyer(req, req.body || {});
    if (f.error) return res.status(f.status).json({ error: f.error });
    if (!f.isOwner && !f.tokenOk) return res.status(403).json({ error: 'Accès refusé' });
    const reason = clean((req.body || {}).reason || '', 300);
    if (reason.length < 5) return res.status(400).json({ error: 'Expliquez le problème (5 caractères minimum)' });
    const r = await wallet.openDispute(f.order._id, reason, f.isOwner ? 'client:' + req.user.id : 'client:token');
    if (!r.ok) return res.status(409).json({ error: 'Litige impossible (versement déjà effectué ou commande non éligible)' });
    res.json({ success: true, message: 'Litige enregistré : le versement au vendeur est suspendu.' });
  } catch (e) { logger.error(`kpay/dispute: ${e.message}`); res.status(500).json({ error: 'Erreur serveur' }); }
});

// ══════════════ GET /api/kpay/my-orders (compte connecté) ══════════════
router.get('/my-orders', verifyToken, async (req, res) => {
  try {
    const orders = await Order.find({ userId: req.user.id, kpayId: { $exists: true, $ne: '' } }).sort({ createdAt: -1 }).limit(50)
      .select('kpayId orderNumber status finalAmount orderType deliveryStatus createdAt').lean();
    res.json({ orders });
  } catch (e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

// ══════════════ Vendeur : demander la validation après 3 jours (jamais de payout sans photo) ══════════════
router.post('/request-validation', verifyMerchant, async (req, res) => {
  try {
    const orderId = String((req.body || {}).orderId || '');
    if (!isHex24(orderId)) return res.status(400).json({ error: 'Commande invalide' });
    const o = await Order.findById(orderId);
    if (!o) return res.status(404).json({ error: 'Commande introuvable' });
    if (req.user.role !== 'admin' && String(o.vendorId) !== String(req.user.id)) return res.status(403).json({ error: 'Cette commande n\'est pas la vôtre' });
    if (o.status !== 'VALIDÉ' || o.orderType !== 'physical' || o.deliveryStatus !== 'AWAITING') return res.status(409).json({ error: 'Rien à valider sur cette commande' });
    if (!o.paidAt || Date.now() - o.paidAt.getTime() < 3 * 86400000) return res.status(409).json({ error: 'Disponible 3 jours après le paiement' });
    if (o.validationRequestedAt && Date.now() - o.validationRequestedAt.getTime() < 86400000) return res.status(429).json({ error: 'Demande déjà envoyée aujourd\'hui' });
    await Order.updateOne({ _id: o._id }, { $set: { validationRequestedAt: new Date() } });
    if (o.userId) await notifyUser(o.userId, 'customer', `📦 Le vendeur demande la validation de ${o.orderNumber} : confirmez la réception avec une photo`, 'ORDER', String(o._id));
    await wallet.notifyAdmins(`Demande de validation du vendeur — ${o.orderNumber}`);
    await wallet.audit('VALIDATION_REQUESTED', o._id, { vendeur: req.user.id }, req.user.id);
    res.json({ success: true, message: 'Demande envoyée. Le versement n\'est lancé qu\'après la photo de l\'acheteur.' });
  } catch (e) { logger.error(`kpay/request-validation: ${e.message}`); res.status(500).json({ error: 'Erreur serveur' }); }
});

// ══════════════ Vendeur : portefeuille + WhatsApp ══════════════
router.get('/merchant/wallet', verifyMerchant, async (req, res) => {
  try {
    const [bal, me, recent] = await Promise.all([
      wallet.getVendorBalance(req.user.id),
      User.findById(req.user.id).select('whatsapp phone payoutProvider').lean(),
      Order.find({ vendorId: String(req.user.id), payoutStatus: { $ne: 'NONE' } }).sort({ updatedAt: -1 }).limit(20)
        .select('orderNumber montant_vendeur payoutStatus deliveryStatus orderType paidAt').lean(),
    ]);
    res.json({ ...bal, whatsapp: me?.whatsapp || '', payoutProvider: me?.payoutProvider || '', commissionRate: wallet.commissionRate(), recent });
  } catch (e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

router.put('/merchant/profile', verifyMerchant, async (req, res) => {
  try {
    const raw = String((req.body || {}).whatsapp || '').replace(/\s+/g, '');
    if (raw && !/^237[0-9]{9}$/.test(raw)) return res.status(400).json({ error: 'WhatsApp invalide : mets 237XXXXXXXXX' });
    await User.updateOne({ _id: req.user.id }, { $set: { whatsapp: raw } });   // seul champ modifiable : jamais commission ni numéro de versement
    res.json({ success: true, whatsapp: raw });
  } catch (e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

module.exports = router;
