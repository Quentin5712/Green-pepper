'use strict';
// /api/admin/* — réglages de paiement + suivi des versements. RÉSERVÉ À L'ADMIN.
// (verifyAdmin est posé route par route : /api/admin/login doit rester public)
const express  = require('express');
const router   = express.Router();
const Settings = require('../models/Settings');
const Order    = require('../models/Order');
const User     = require('../models/User');
const AuditLog = require('../models/AuditLog');
const kpay     = require('../utils/kpay');
const wallet   = require('../utils/wallet');
const logger   = require('../utils/logger');
const { verifyAdmin } = require('../middlewares/auth');

const isHex24 = s => /^[a-f0-9]{24}$/.test(String(s || ''));
const who = req => req.user.adminName || req.user.email || req.user.id;

// ── GET /api/admin/settings ──
router.get('/settings', verifyAdmin, async (req, res) => {
  try {
    const [doc, hist] = await Promise.all([
      Settings.getMain(),
      AuditLog.find({ action: 'CHANGE_ADMIN_PHONE' }).sort({ date: -1 }).limit(10).lean(),
    ]);
    let info;
    try { info = await kpay.describeConfig(); }
    catch (e) { info = { mode: 'invalide', isLive: false, baseUrl: '', hasApiKey: !!process.env.KPAY_API_KEY, merchantNumber: '', merchantSource: 'AUCUN', configError: e.message }; }
    res.json({
      adminPhone: info.merchantNumber, source: info.merchantSource,
      kpayMerchantNumber: doc?.kpayMerchantNumber || '',
      mode: info.mode, isLive: info.isLive, baseUrl: info.baseUrl, hasApiKey: info.hasApiKey, configError: info.configError || null,
      commissionRate: wallet.commissionRate(),
      updatedAt: doc?.updatedAt || null, updatedBy: doc?.updatedBy || '',
      history: hist.map(h => ({ old: h.details?.old || '', new: h.details?.new || '', by: h.adminId, date: h.date })),
    });
  } catch (e) { logger.error(`admin/settings GET: ${e.message}`); res.status(500).json({ error: 'Erreur serveur' }); }
});

// ── PUT /api/admin/settings  { adminPhone } ──
router.put('/settings', verifyAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    const phone = kpay.normalizeAdminPhone(body.adminPhone);
    if (!phone) return res.status(400).json({ error: 'Numéro invalide, mets 237XXXXXXXXX' });
    const set = { adminPhone: phone, updatedBy: who(req) };
    if (body.kpayMerchantNumber !== undefined && body.kpayMerchantNumber !== '') {
      const m = kpay.normalizeAdminPhone(body.kpayMerchantNumber);
      if (!m) return res.status(400).json({ error: 'Numéro invalide, mets 237XXXXXXXXX' });
      set.kpayMerchantNumber = m;
    }
    const before = (await kpay.getKpayConfig(true).catch(() => ({}))).merchantNumber || '';
    const doc = await Settings.findOneAndUpdate({ key: 'main' }, { $set: set }, { upsert: true, new: true });
    kpay.invalidateConfigCache();                                   // effet immédiat, sans redéployer
    await AuditLog.create({ adminId: set.updatedBy, action: 'CHANGE_ADMIN_PHONE', targetId: 'settings', details: { old: before, new: phone }, ip: req.ip });
    logger.info(`ADMIN_PHONE modifié : ${before || 'aucun'} → ${phone} | par ${set.updatedBy} | ip=${req.ip} | ${doc.updatedAt.toISOString()}`);
    res.json({ success: true, adminPhone: phone, updatedAt: doc.updatedAt, updatedBy: set.updatedBy, message: 'Numéro admin changé, les prochains paiements arriveront sur le nouveau numéro' });
  } catch (e) { logger.error(`admin/settings PUT: ${e.message}`); res.status(500).json({ error: 'Erreur serveur' }); }
});

// ── GET /api/admin/kpay-balance ──
router.get('/kpay-balance', verifyAdmin, async (req, res) => {
  try { res.json(await kpay.getBalance('XAF')); }
  catch (e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

// ── GET /api/admin/payouts ──
router.get('/payouts', verifyAdmin, async (req, res) => {
  try {
    const st = String(req.query.status || '');
    const filter = { payoutStatus: st ? st : { $ne: 'NONE' } };
    const orders = await Order.find(filter).sort({ updatedAt: -1 }).limit(100).lean();
    const ids = [...new Set(orders.map(o => String(o.vendorId)).filter(isHex24))];
    const users = ids.length ? await User.find({ _id: { $in: ids } }).select('name storeName').lean() : [];
    const names = {}; users.forEach(u => { names[String(u._id)] = u.storeName || u.name; });
    res.json({ payouts: orders.map(o => ({
      id: o._id, orderNumber: o.orderNumber, vendorId: o.vendorId, vendorName: names[o.vendorId] || o.vendorId,
      finalAmount: o.finalAmount, commission: o.commission, montant_vendeur: o.montant_vendeur,
      orderType: o.orderType, deliveryStatus: o.deliveryStatus, photo: !!o.photo_livraison,
      payoutStatus: o.payoutStatus, payoutLastError: o.payoutLastError, payoutAttempts: o.payoutAttempts,
      disputeReason: o.disputeReason, paidAt: o.paidAt, payoutPaidAt: o.payoutPaidAt,
    })) });
  } catch (e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

// ── Relancer un versement (WAITING_FUNDS / FAILED) ──
router.post('/payouts/:orderId/retry', verifyAdmin, async (req, res) => {
  try {
    if (!isHex24(req.params.orderId)) return res.status(400).json({ error: 'Commande invalide' });
    const r = await wallet.releasePayout(req.params.orderId, `admin:${who(req)}`, { ignoreAttempts: true });
    await wallet.audit('PAYOUT_RETRY', req.params.orderId, { result: r.reason || r.status }, who(req), req.ip);
    res.json(r);
  } catch (e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

// ── Versement « incertain » : l'admin a vérifié chez KPay ──
router.post('/payouts/:orderId/resolve-uncertain', verifyAdmin, async (req, res) => {
  try {
    if (!isHex24(req.params.orderId)) return res.status(400).json({ error: 'Commande invalide' });
    const outcome = (req.body || {}).outcome;
    if (!['paid', 'failed'].includes(outcome)) return res.status(400).json({ error: 'outcome = paid ou failed' });
    const upd = outcome === 'paid'
      ? { payoutStatus: 'PAID', payoutPaidAt: new Date(), payoutLastError: 'Confirmé manuellement par ' + who(req) }
      : { payoutStatus: 'FAILED', payoutLastError: 'Marqué non versé par ' + who(req) };
    const o = await Order.findOneAndUpdate({ _id: req.params.orderId, payoutStatus: 'UNCERTAIN' }, { $set: upd }, { new: true });
    if (!o) return res.status(409).json({ error: 'Aucun versement incertain sur cette commande' });
    await wallet.audit('PAYOUT_UNCERTAIN_RESOLVED', o._id, { outcome }, who(req), req.ip);
    res.json({ success: true, payoutStatus: o.payoutStatus });
  } catch (e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

// ── Trancher un litige : release (paie le vendeur, photo exigée) ou refund (remboursement manuel) ──
router.post('/orders/:orderId/dispute-resolve', verifyAdmin, async (req, res) => {
  try {
    if (!isHex24(req.params.orderId)) return res.status(400).json({ error: 'Commande invalide' });
    const r = await wallet.resolveDispute(req.params.orderId, (req.body || {}).resolution, who(req));
    if (!r.ok) return res.status(409).json({ error: r.reason === 'PHOTO_MANQUANTE' ? 'Pas de versement sans photo de livraison' : 'Décision impossible', reason: r.reason });
    res.json(r);
  } catch (e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

// ── Numéro / opérateur de VERSEMENT d'un marchand (admin seulement, journalisé) ──
// Un vendeur ne peut JAMAIS changer lui-même le numéro où il est payé (risque de détournement).
router.put('/merchants/:id/payout', verifyAdmin, async (req, res) => {
  try {
    if (!isHex24(req.params.id)) return res.status(400).json({ error: 'Marchand invalide' });
    const phone = kpay.normalizeAdminPhone((req.body || {}).phone);
    if (!phone) return res.status(400).json({ error: 'Numéro invalide, mets 237XXXXXXXXX' });
    const provider = (req.body || {}).payoutProvider || '';
    if (!['', 'MTN_MOMO_CMR', 'ORANGE_CMR'].includes(provider)) return res.status(400).json({ error: 'Opérateur invalide' });
    const before = await User.findOne({ _id: req.params.id, role: 'merchant', isDeleted: false }).select('phone payoutProvider name');
    if (!before) return res.status(404).json({ error: 'Marchand introuvable' });
    const oldPhone = before.phone || '', oldProvider = before.payoutProvider || '';       // valeurs AVANT modification
    await User.updateOne({ _id: before._id }, { $set: { phone, payoutProvider: provider } });
    await wallet.audit('CHANGE_MERCHANT_PAYOUT', before._id, { old: oldPhone, new: phone, oldProvider, provider }, who(req), req.ip);
    logger.info(`PAYOUT_NUMBER marchand=${before._id} : ${oldPhone || 'aucun'} → ${phone} (${provider || 'auto'}) | par ${who(req)} | ip=${req.ip}`);
    res.json({ success: true, phone, payoutProvider: provider });
  } catch (e) { logger.error(`admin/merchants payout: ${e.message}`); res.status(500).json({ error: 'Erreur serveur' }); }
});

module.exports = router;
