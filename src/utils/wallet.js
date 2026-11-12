'use strict';
// ═══════════════════════════════════════════════════════════════════
// Portefeuille & répartition automatique (split)
//   client paie → KPay → webhook "payé" → commission plateforme + part vendeur
//   DIGITAL  : versement immédiat
//   PHYSIQUE : argent BLOQUÉ jusqu'à « J'ai reçu ma commande » + PHOTO du produit
// Aucun versement : sans photo (physique) · en litige · si solde KPay insuffisant · deux fois.
// ═══════════════════════════════════════════════════════════════════
const Order    = require('../models/Order');
const Product  = require('../models/Product');
const Cart     = require('../models/Cart');
const User     = require('../models/User');
const AuditLog = require('../models/AuditLog');
const kpay     = require('./kpay');
const logger   = require('./logger');
const { notifyUser } = require('./notify');
const { generateInvoice } = require('./invoice');

const PAID_STATUSES = ['VALIDÉ', 'LIVRÉ'];
const MAX_ATTEMPTS  = 5;
const isHex24 = s => /^[a-f0-9]{24}$/.test(String(s || ''));

// Commission : fixée côté serveur (env COMMISSION_RATE, défaut 10 %). Jamais modifiable par un vendeur.
function commissionRate() {
  const r = Number(process.env.COMMISSION_RATE);
  return Number.isFinite(r) && r >= 0 && r <= 0.5 ? r : 0.10;
}

// 10 000 FCFA → commission 1 000 (plateforme) + 9 000 (vendeur)
function splitPayment(order) {
  const total = Math.round(Number(order.finalAmount || order.amount || 0));
  const rate = commissionRate();
  const commission = Math.round(total * rate);
  return { rate, total, commission, montant_vendeur: total - commission };
}

async function audit(action, targetId, details = {}, by = 'system', ip = '') {
  try { await AuditLog.create({ adminId: String(by), action, targetId: String(targetId || ''), details, ip }); }
  catch (e) { logger.error(`audit ${action}: ${e.message}`); }
}
async function notifyAdmins(message) {
  try {
    const ids = await User.find({ role: 'admin', isDeleted: false }).distinct('_id');
    await Promise.all(ids.map(id => notifyUser(id, 'admin', message, 'PAYMENT')));
  } catch (e) { logger.error(`notifyAdmins: ${e.message}`); }
}
async function notifyVendor(vendorId, message, refId) {
  if (isHex24(vendorId)) await notifyUser(vendorId, 'merchant', message, 'PAYMENT', String(refId || ''));
}
async function isPlatformSeller(vendorId) {
  if (!vendorId || vendorId === 'admin') return true;
  if (!isHex24(vendorId)) return false;
  return !!(await User.exists({ _id: vendorId, role: 'admin' }));
}

// ── Soldes d'un vendeur ──
async function getVendorBalance(vendorId) {
  const rows = await Order.aggregate([
    { $match: { vendorId: String(vendorId), status: { $in: PAID_STATUSES } } },
    { $group: { _id: '$payoutStatus', total: { $sum: '$montant_vendeur' } } },
  ]);
  const by = {}; rows.forEach(r => { by[r._id] = r.total; });
  const sum = keys => keys.reduce((a, k) => a + (by[k] || 0), 0);
  return {
    solde_bloque:     sum(['BLOCKED', 'BLOCKED_DISPUTE']),                                   // en attente de validation / litige
    solde_disponible: sum(['READY', 'PROCESSING', 'WAITING_FUNDS', 'FAILED', 'UNCERTAIN']),  // libéré, pas encore reçu
    total_verse:      sum(['PAID']),
  };
}

// ── Le versement est-il autorisé ? ──
function canPayout(order, opts = {}) {
  if (!order) return { ok: false, reason: 'COMMANDE_INTROUVABLE' };
  if (!PAID_STATUSES.includes(order.status)) return { ok: false, reason: 'NON_PAYEE' };
  if (!(order.montant_vendeur > 0)) return { ok: false, reason: 'MONTANT_NUL' };
  if (['PAID', 'PROCESSING'].includes(order.payoutStatus)) return { ok: false, reason: 'DEJA_TRAITE' };
  if (order.payoutStatus === 'UNCERTAIN') return { ok: false, reason: 'VERIFICATION_MANUELLE_REQUISE' };
  if (order.deliveryStatus === 'DISPUTE' || order.payoutStatus === 'BLOCKED_DISPUTE') return { ok: false, reason: 'LITIGE' };
  if (order.orderType === 'physical') {
    if (!order.photo_livraison) return { ok: false, reason: 'PHOTO_MANQUANTE' };
    if (order.deliveryStatus !== 'VALIDATED' || !order.date_validation_livraison) return { ok: false, reason: 'LIVRAISON_NON_VALIDEE' };
  }
  if (order.kpayNet > 0 && order.montant_vendeur > order.kpayNet) return { ok: false, reason: 'MONTANT_SUPERIEUR_AU_NET_RECU' };
  if (!['READY', 'WAITING_FUNDS', 'FAILED'].includes(order.payoutStatus)) return { ok: false, reason: 'STATUT_' + order.payoutStatus };
  if (!opts.ignoreAttempts && (order.payoutAttempts || 0) >= MAX_ATTEMPTS) return { ok: false, reason: 'TROP_DE_TENTATIVES' };
  return { ok: true, reason: 'OK' };
}

// ── Paiement confirmé par KPay (webhook ou vérification par kpayId) ──
async function markPaid(order, info = {}, ip = '') {
  const platform = await isPlatformSeller(order.vendorId);
  const sp = splitPayment(order);
  const physical = order.orderType === 'physical';
  const set = {
    status: 'VALIDÉ', paidAt: new Date(),
    kpayTxId: info.txId || '',
    commission: platform ? sp.total : sp.commission,
    commissionRate: sp.rate,
    montant_vendeur: platform ? 0 : sp.montant_vendeur,
    payoutStatus: platform ? 'NONE' : (physical ? 'BLOCKED' : 'READY'),
    deliveryStatus: physical ? 'AWAITING' : 'NONE',
  };
  if (info.fee != null) set.kpayFee = info.fee;
  if (info.net != null) set.kpayNet = info.net;
  if (info.raw) set.kpayResponse = info.raw;

  // verrou atomique : un seul traitement, même si webhook + vérification arrivent ensemble
  const before = await Order.findOneAndUpdate({ _id: order._id, status: { $in: ['PENDING', 'EXPIRED'] } }, { $set: set }, { new: false });
  if (!before) return { changed: false, order: await Order.findById(order._id) };
  const locked = await Order.findById(order._id);

  if (before.status === 'EXPIRED') {
    for (const it of locked.items) {
      if (it.productId) await Product.findOneAndUpdate({ _id: it.productId, stock: { $gte: it.qty } }, { $inc: { stock: -it.qty } });
    }
    await notifyAdmins(`⚠️ Paiement reçu APRÈS expiration de ${locked.orderNumber} — vérifiez le stock`);
  } else {
    for (const it of locked.items) {
      if (it.productId) await Product.findByIdAndUpdate(it.productId, { $inc: { reserved: -it.qty } });
    }
  }
  if (locked.userId) await Cart.deleteMany({ userId: locked.userId });
  await generateInvoice(locked);

  logger.info(`VALIDÉ: order=${locked.orderNumber} kpayId=${locked.kpayId} montant=${locked.finalAmount} commission=${locked.commission} vendeur=${locked.montant_vendeur} type=${locked.orderType} payout=${locked.payoutStatus}`);
  await audit('PAYMENT_CONFIRMED', locked._id, { montant: locked.finalAmount, commission: locked.commission, montant_vendeur: locked.montant_vendeur, type: locked.orderType }, 'system', ip);
  if (locked.userId) await notifyUser(locked.userId, 'customer', `✅ Paiement confirmé — ${locked.orderNumber}`, 'PAYMENT', String(locked._id));
  await notifyVendor(locked.vendorId, locked.orderType === 'physical'
    ? `🛒 Nouvelle commande payée ${locked.orderNumber} — ${locked.montant_vendeur} FCFA seront versés après validation de la livraison par le client`
    : `🛒 Vente digitale ${locked.orderNumber} — ${locked.montant_vendeur} FCFA en cours de versement`, locked._id);

  // DIGITAL : split instantané, sans clic
  if (locked.orderType === 'digital' && locked.payoutStatus === 'READY') {
    releasePayout(locked._id, 'auto:digital').catch(e => logger.error(`releasePayout digital: ${e.message}`));
  }
  return { changed: true, order: locked };
}

// ── Paiement refusé / expiré ──
async function markFailed(order, outcome = 'FAILED', raw = null) {
  const upd = { status: outcome === 'EXPIRED' ? 'EXPIRED' : 'REFUSÉ' };
  if (raw) upd.kpayResponse = raw;
  const before = await Order.findOneAndUpdate({ _id: order._id, status: 'PENDING' }, { $set: upd }, { new: false });
  if (!before) return { changed: false };
  for (const it of before.items) {
    if (it.productId) await Product.findByIdAndUpdate(it.productId, { $inc: { stock: it.qty, reserved: -it.qty } });
  }
  logger.info(`${upd.status}: order=${before.orderNumber} kpayId=${before.kpayId}`);
  await audit('PAYMENT_' + upd.status, before._id, {}, 'system');
  if (before.userId) await notifyUser(before.userId, 'customer', `❌ Paiement non abouti — ${before.orderNumber}`, 'PAYMENT', String(before._id));
  return { changed: true };
}

// ── Interroge KPay par kpayId et applique le résultat (webhook perdu, polling) ──
async function reconcileOrder(order) {
  if (!order || order.status !== 'PENDING' || !order.kpayId) return { changed: false };
  const remote = await kpay.getStatus(order.kpayId);
  if (remote.status === 'SUCCESS') return markPaid(order, { txId: order.kpayId, fee: remote.feeAmount, net: remote.netAmount, raw: remote.raw });
  if (remote.status === 'FAILED')  return markFailed(order, 'FAILED', remote.raw);
  return { changed: false, pending: true };
}

// ── Versement au vendeur ──
async function releasePayout(orderId, by = 'auto', opts = {}) {
  const snap = await Order.findById(orderId);
  const chk = canPayout(snap, opts);
  if (!chk.ok) { logger.info(`PAYOUT non lancé order=${orderId} raison=${chk.reason}`); return { ok: false, reason: chk.reason }; }

  const vendorId   = String(snap.vendorId);
  const externalId = `PAYOUT-${vendorId}-${Date.now()}`;           // unique : PAYOUT-vendeurId-timestamp
  const order = await Order.findOneAndUpdate(
    { _id: snap._id, payoutStatus: { $in: ['READY', 'WAITING_FUNDS', 'FAILED'] }, deliveryStatus: { $ne: 'DISPUTE' } },
    { $set: { payoutStatus: 'PROCESSING', payoutExternalId: externalId, payoutLastError: '' }, $inc: { payoutAttempts: 1 } },
    { new: true });
  if (!order) return { ok: false, reason: 'DEJA_EN_COURS_OU_BLOQUE' };

  const fail = async (status, msg, quiet = false) => {
    await Order.updateOne({ _id: order._id }, { $set: { payoutStatus: status, payoutLastError: msg } });
    logger.error(`PAYOUT ${status} order=${order.orderNumber} vendeur=${vendorId} montant=${order.montant_vendeur} : ${msg} (par ${by})`);
    await audit('PAYOUT_' + status, order._id, { msg, montant: order.montant_vendeur, externalId }, 'system');
    if (!quiet) await notifyAdmins(`⚠️ Versement ${status} — ${order.orderNumber} (${order.montant_vendeur} FCFA) : ${msg}`);
    return { ok: false, reason: status, error: msg };
  };

  const vendor = isHex24(vendorId) ? await User.findOne({ _id: vendorId, isDeleted: false }).select('name storeName phone payoutProvider isBanned') : null;
  if (!vendor || vendor.isBanned) return fail('FAILED', 'Vendeur introuvable ou banni');
  const phone = kpay.formatPhone(vendor.phone || '');
  if (!/^237[0-9]{9}$/.test(phone)) return fail('FAILED', 'Téléphone du vendeur invalide');
  const provider = vendor.payoutProvider || kpay.detectProviderFromPhone(phone);
  if (!provider) return fail('FAILED', 'Opérateur du vendeur inconnu (à renseigner)');

  let res;
  try {
    res = await kpay.payoutToVendor({
      amount: order.montant_vendeur, provider, phoneNumber: phone, externalId,
      description: `Versement ${order.orderNumber} ${vendor.storeName || vendor.name || ''}`.trim().slice(0, 100),
    });
  } catch (e) {
    if (e.code === 'INSUFFICIENT_BALANCE' || e.code === 'BALANCE_UNKNOWN') {
      await Order.updateOne({ _id: order._id }, { $inc: { payoutAttempts: -1 } });      // attente de fonds ≠ tentative ratée
      return fail('WAITING_FUNDS', e.code === 'BALANCE_UNKNOWN' ? 'Solde KPay indisponible' : 'Solde KPay insuffisant', snap.payoutStatus === 'WAITING_FUNDS');
    }
    if (e.ambiguous || e.code === 'CONFLICT') return fail('UNCERTAIN', `Réponse KPay incertaine (${e.code}) — vérifier chez KPay avant tout nouvel essai`);
    return fail('FAILED', `${e.code}: ${e.message}`);
  }
  if (res.status === 'FAILED') return fail('FAILED', 'KPay a refusé le versement');

  const set = { payoutKpayId: res.id || '' };
  if (res.status === 'SUCCESS') { set.payoutStatus = 'PAID'; set.payoutPaidAt = new Date(); }
  await Order.updateOne({ _id: order._id }, { $set: set });
  logger.info(`PAYOUT ${set.payoutStatus || 'PROCESSING'} order=${order.orderNumber} vendeur=${vendorId} montant=${order.montant_vendeur} externalId=${externalId} (par ${by})`);
  await audit('PAYOUT_' + (set.payoutStatus || 'PROCESSING'), order._id, { montant: order.montant_vendeur, externalId, by }, 'system');
  if (set.payoutStatus === 'PAID') await notifyVendor(vendorId, `💸 ${order.montant_vendeur} FCFA versés sur votre numéro — ${order.orderNumber}`, order._id);
  return { ok: true, status: set.payoutStatus || 'PROCESSING' };
}

// ── Résultat d'un versement annoncé par webhook (payout.completed / payout.failed) ──
async function applyPayoutResult(order, outcome, reason = '') {
  if (outcome === 'SUCCESS') {
    const o = await Order.findOneAndUpdate({ _id: order._id, payoutStatus: { $in: ['PROCESSING', 'UNCERTAIN'] } }, { $set: { payoutStatus: 'PAID', payoutPaidAt: new Date() } }, { new: true });
    if (o) { logger.info(`PAYOUT PAID (webhook) order=${o.orderNumber} montant=${o.montant_vendeur}`); await audit('PAYOUT_PAID', o._id, { via: 'webhook' }); await notifyVendor(o.vendorId, `💸 ${o.montant_vendeur} FCFA versés — ${o.orderNumber}`, o._id); }
    return !!o;
  }
  if (outcome === 'FAILED') {
    const o = await Order.findOneAndUpdate({ _id: order._id, payoutStatus: { $in: ['PROCESSING', 'UNCERTAIN'] } }, { $set: { payoutStatus: 'FAILED', payoutLastError: String(reason || 'Échec signalé par KPay').slice(0, 200) } }, { new: true });
    if (o) { logger.error(`PAYOUT FAILED (webhook) order=${o.orderNumber} : ${reason}`); await audit('PAYOUT_FAILED', o._id, { via: 'webhook', reason }); await notifyAdmins(`⚠️ Versement échoué — ${o.orderNumber} : ${reason || 'voir KPay'}`); }
    return !!o;
  }
  return false;
}

// ── « J'ai reçu ma commande » : exige la photo, puis libère le versement ──
async function confirmDelivery(orderId) {
  const o = await Order.findOneAndUpdate(
    { _id: orderId, status: 'VALIDÉ', orderType: 'physical', deliveryStatus: 'AWAITING', photo_livraison: { $ne: null } },
    { $set: { deliveryStatus: 'VALIDATED', date_validation_livraison: new Date(), status: 'LIVRÉ' } },
    { new: true });
  if (!o) return { ok: false, reason: 'NON_VALIDABLE' };
  await Order.updateOne({ _id: o._id, payoutStatus: 'BLOCKED' }, { $set: { payoutStatus: 'READY' } });
  logger.info(`LIVRAISON VALIDÉE PAR PHOTO order=${o.orderNumber}`);
  await audit('DELIVERY_VALIDATED', o._id, { montant_vendeur: o.montant_vendeur });
  await notifyVendor(o.vendorId, `📸 Livraison validée par photo — ${o.orderNumber}. Versement de ${o.montant_vendeur} FCFA en cours.`, o._id);
  if (o.payoutStatus !== 'NONE') releasePayout(o._id, 'auto:livraison').catch(e => logger.error(`releasePayout livraison: ${e.message}`));
  return { ok: true };
}

// ── Litige : le versement est bloqué ──
async function openDispute(orderId, reason, by = 'client') {
  const o = await Order.findOneAndUpdate(
    { _id: orderId, status: { $in: PAID_STATUSES }, orderType: 'physical', deliveryStatus: { $in: ['AWAITING', 'VALIDATED'] }, payoutStatus: { $in: ['BLOCKED', 'READY', 'WAITING_FUNDS', 'FAILED'] } },
    { $set: { deliveryStatus: 'DISPUTE', payoutStatus: 'BLOCKED_DISPUTE', disputeReason: String(reason || '').slice(0, 300), disputeOpenedAt: new Date() } },
    { new: true });
  if (!o) return { ok: false, reason: 'LITIGE_IMPOSSIBLE' };     // ex. versement déjà effectué
  logger.warn(`LITIGE ouvert order=${o.orderNumber} par ${by} : ${o.disputeReason}`);
  await audit('DISPUTE_OPENED', o._id, { reason: o.disputeReason, by });
  await notifyAdmins(`⚠️ Litige ouvert — ${o.orderNumber} : ${o.disputeReason || 'sans motif'}`);
  await notifyVendor(o.vendorId, `⚠️ Litige ouvert sur ${o.orderNumber} — versement suspendu`, o._id);
  return { ok: true };
}

// ── Décision de l'admin sur un litige ──
async function resolveDispute(orderId, resolution, by) {
  const o = await Order.findOne({ _id: orderId, deliveryStatus: 'DISPUTE', payoutStatus: 'BLOCKED_DISPUTE' });
  if (!o) return { ok: false, reason: 'AUCUN_LITIGE' };
  if (resolution === 'release') {
    if (!o.photo_livraison) return { ok: false, reason: 'PHOTO_MANQUANTE' };          // pas de payout sans photo, même après litige
    await Order.updateOne({ _id: o._id }, { $set: { deliveryStatus: 'VALIDATED', date_validation_livraison: new Date(), status: 'LIVRÉ', payoutStatus: 'READY' } });
    await audit('DISPUTE_RELEASED', o._id, { by }, by);
    releasePayout(o._id, `admin:${by}`).catch(e => logger.error(`releasePayout litige: ${e.message}`));
    return { ok: true, message: 'Litige tranché : versement au vendeur lancé' };
  }
  if (resolution === 'refund') {
    await Order.updateOne({ _id: o._id }, { $set: { deliveryStatus: 'REFUND_DUE' } });  // le versement reste bloqué
    await audit('DISPUTE_REFUND_DUE', o._id, { by }, by);
    return { ok: true, message: 'Remboursement client à faire manuellement ; le versement vendeur reste bloqué' };
  }
  return { ok: false, reason: 'DECISION_INVALIDE' };
}

// ── Tâches périodiques ──
async function reconcilePending() {
  const orders = await Order.find({ status: 'PENDING', kpayId: { $exists: true, $ne: '' }, createdAt: { $lt: new Date(Date.now() - 2 * 60 * 1000) } }).limit(50);
  for (const o of orders) {
    try {
      const r = await reconcileOrder(o);
      if (r.pending && Date.now() - o.createdAt.getTime() > 45 * 60 * 1000) await markFailed(o, 'EXPIRED');
    } catch (e) { /* KPay injoignable : on garde PENDING, jamais d'expiration à l'aveugle */ }
  }
}
async function retryWaitingPayouts() {
  const orders = await Order.find({ payoutStatus: 'WAITING_FUNDS' }).limit(20);
  for (const o of orders) await releasePayout(o._id, 'cron');
}
async function flagStuckPayouts() {
  const r = await Order.updateMany({ payoutStatus: 'PROCESSING', updatedAt: { $lt: new Date(Date.now() - 30 * 60 * 1000) } }, { $set: { payoutStatus: 'UNCERTAIN', payoutLastError: 'Sans confirmation depuis 30 min — vérifier chez KPay' } });
  if (r.modifiedCount) { logger.warn(`${r.modifiedCount} versement(s) sans confirmation → UNCERTAIN`); await notifyAdmins(`⚠️ ${r.modifiedCount} versement(s) sans confirmation : à vérifier chez KPay`); }
}

module.exports = {
  commissionRate, splitPayment, getVendorBalance, canPayout,
  markPaid, markFailed, reconcileOrder, releasePayout, applyPayoutResult,
  confirmDelivery, openDispute, resolveDispute,
  reconcilePending, retryWaitingPayouts, flagStuckPayouts, notifyAdmins, audit,
};
