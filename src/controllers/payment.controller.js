'use strict';
const crypto   = require('crypto');
const Order    = require('../models/Order');
const Product  = require('../models/Product');
const Cart     = require('../models/Cart');
const TransactionLog = require('../models/TransactionLog');
const kpay     = require('../utils/kpay');
const { generateInvoice } = require('../utils/invoice');
const { notifyMerchant, notifyAdmin, notifyUser } = require('../utils/notify');
const logger   = require('../utils/logger');
const path     = require('path');
const fs       = require('fs');

// POST /api/payment/pay — guest ou connecté
async function pay(req, res) {
  try {
    const { phone, provider, items, address, customerName } = req.body;
    if (!phone || !provider || !items?.length) return res.status(400).json({ error: 'phone, provider et items requis' });
    if (!['MTN_MOMO_CMR','ORANGE_CMR'].includes(provider)) return res.status(400).json({ error: 'provider invalide' });

    // Vérifier et réserver le stock atomiquement
    const orderItems = [];
    let amount = 0;

    for (const item of items) {
      const qty = Number(item.qty) || 1;
      if (qty < 1 || qty > 10) return res.status(400).json({ error: 'qty doit être entre 1 et 10' });

      // Prix TOUJOURS depuis la DB — jamais depuis le frontend
      const prod = await Product.findOneAndUpdate(
        { _id: item.productId, isDeleted: false, isActive: true, stock: { $gte: qty } },
        { $inc: { stock: -qty, reserved: qty } },
        { new: true }
      );
      if (!prod) return res.status(409).json({ error: `Stock insuffisant pour le produit ${item.productId}` });

      const unitPrice = prod.finalPrice; // virtual — applique la réduction si active
      orderItems.push({
        productId:       prod._id,
        name:            prod.name,
        qty,
        priceAtPurchase: unitPrice,
        discountApplied: prod.discount || 0,
        sellerId:        prod.sellerId,
      });
      amount += unitPrice * qty;
    }

    const finalAmount = amount;
    const commission  = Math.round(finalAmount * 0.10);
    const externalId  = 'GP-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex').toUpperCase();

    const order = await Order.create({
      userId:      req.user?.id || null,
      guestPhone:  req.user ? '' : phone,
      items:       orderItems,
      amount,
      finalAmount,
      commission,
      address:     address || '',
      status:      'PENDING',
      externalId,
      provider,
    });

    // Log immuable
    await TransactionLog.create({ orderId: order._id, externalId, amount, finalAmount, commission, status: 'PENDING', provider, ip: req.ip });

    // Appel KPay
    let kpayData;
    try {
      kpayData = await kpay.initPayment({
        amount: finalAmount, provider, phoneNumber: phone, externalId,
        description: `Green Pepper — ${orderItems.map(i=>i.name).join(', ')}`,
      });
      await Order.findByIdAndUpdate(order._id, { kpayResponse: kpayData });
    } catch(e) {
      // Libérer le stock si KPay échoue
      for (const item of orderItems) {
        await Product.findByIdAndUpdate(item.productId, { $inc: { stock: item.qty, reserved: -item.qty } });
      }
      await Order.findByIdAndUpdate(order._id, { status: 'REFUSÉ' });
      await TransactionLog.create({ orderId: order._id, externalId, amount, finalAmount, commission, status: 'REFUSÉ', provider, ip: req.ip });
      logger.error('KPay init failed:', e.message);
      return res.status(502).json({ error: 'Erreur initialisation paiement', detail: e.response?.data || e.message });
    }

    logger.info(`PENDING: order=${order._id} ext=${externalId} amount=${finalAmount}`);
    return res.json({
      status:     'PENDING',
      externalId,
      orderId:    order._id,
      orderNumber:order.orderNumber,
      message:    provider === 'MTN_MOMO_CMR'
        ? 'Composez *126# et confirmez le paiement, ou attendez la notification MoMo'
        : 'Validez le paiement sur votre téléphone Orange Money',
    });
  } catch(e) {
    logger.error('pay:', e.message);
    res.status(500).json({ error: 'Erreur serveur paiement' });
  }
}

// ── Normalisation du statut KPay ──
const OK_STATUS   = ['SUCCESS','SUCCESSFUL','PAID','COMPLETED','VALIDATED'];
const FAIL_STATUS = ['FAILED','REJECTED','CANCELLED','CANCELED','EXPIRED','REFUSED','DECLINED'];
function normalizeStatus(raw) {
  const st = String(raw || '').toUpperCase();
  if (OK_STATUS.includes(st))   return 'SUCCESS';
  if (FAIL_STATUS.includes(st)) return 'FAILED';
  return 'PENDING';
}

// ── Applique le résultat final sur une commande (idempotent) ──
async function applyResult(order, outcome, txId, raw, ip) {
  if (order.status !== 'PENDING') return order.status;
  const isSuccess = outcome === 'SUCCESS';
  const newStatus = isSuccess ? 'VALIDÉ' : 'REFUSÉ';

  // Verrou atomique : un seul traitement même si callback + polling arrivent ensemble
  const locked = await Order.findOneAndUpdate(
    { _id: order._id, status: 'PENDING' },
    { status: newStatus, kpayTxId: txId || '', kpayResponse: raw },
    { new: true }
  );
  if (!locked) return order.status;

  await TransactionLog.create({ orderId: order._id, externalId: order.externalId, amount: order.amount, finalAmount: order.finalAmount, commission: order.commission, status: newStatus, provider: order.provider, ip });

  if (isSuccess) {
    for (const item of order.items) {
      if (item.productId) await Product.findByIdAndUpdate(item.productId, { $inc: { reserved: -item.qty } });
    }
    if (order.userId) await Cart.deleteMany({ userId: order.userId });
    await generateInvoice(locked);
    if (order.userId) await notifyUser(order.userId, 'customer', `✅ Commande ${order.orderNumber} confirmée — ${order.finalAmount.toLocaleString('fr-FR')} FCFA`, 'PAYMENT', String(order._id));
    const sellerIds = [...new Set((order.items||[]).map(i=>i.sellerId).filter(Boolean))];
    for (const sid of sellerIds) await notifyMerchant(sid, `🛒 Nouvelle commande VALIDÉE — ${order.orderNumber} — ${order.finalAmount.toLocaleString('fr-FR')} FCFA`, 'ORDER');
    logger.info(`VALIDÉ: order=${order._id} ext=${order.externalId} tx=${txId}`);
  } else {
    for (const item of order.items) {
      if (item.productId) await Product.findByIdAndUpdate(item.productId, { $inc: { stock: item.qty, reserved: -item.qty } });
    }
    if (order.userId) await notifyUser(order.userId, 'customer', `❌ Paiement refusé pour la commande ${order.orderNumber}`, 'PAYMENT', String(order._id));
    logger.info(`REFUSÉ: order=${order._id} ext=${order.externalId}`);
  }
  return newStatus;
}

// POST /api/payment/callback — webhook KPay
// Sécurité : on ne fait JAMAIS confiance au corps du webhook seul.
//  1) signature HMAC valide → on accepte le statut reçu
//  2) sinon → on interroge KPay directement avec notre clé API (serveur à serveur)
async function callback(req, res) {
  try {
    const body = req.body || {};
    const d = body.data || body.payment || {};
    const externalId = body.externalId || body.external_id || d.externalId || d.external_id;
    const evt = String(body.event || body.type || '').toLowerCase();
    let status = body.status || d.status;
    if (!status) {
      if (evt.includes('completed') || evt.includes('success')) status = 'SUCCESS';
      else if (evt.includes('failed') || evt.includes('cancel') || evt.includes('expired')) status = 'FAILED';
    }
    const transactionId = body.transactionId || body.id || d.transactionId || d.id || '';
    if (!externalId) return res.status(400).json({ error: 'externalId requis' });

    const order = await Order.findOne({ externalId });
    if (!order) { logger.warn(`CALLBACK: order not found ext=${externalId}`); return res.status(404).json({ error: 'Commande introuvable' }); }
    if (order.status !== 'PENDING') return res.json({ ok: true, status: order.status });

    const sig = req.headers['x-kpay-signature'] || req.headers['x-signature'] || '';
    let outcome = null, txId = transactionId || '';

    if (sig && kpay.verifyHmac(req.rawBody || JSON.stringify(req.body), sig)) {
      outcome = normalizeStatus(status);
    } else {
      try {
        const remote = await kpay.getStatus(externalId);
        const rs = remote.status || remote.data?.status;
        outcome = normalizeStatus(rs);
        txId = remote.transactionId || remote.data?.transactionId || txId;
      } catch(e) {
        logger.warn(`CALLBACK non vérifiable ext=${externalId} ip=${req.ip}: ${e.message}`);
        return res.status(401).json({ error: 'Callback non vérifiable' });
      }
    }

    if (outcome === 'PENDING') return res.json({ ok: true, status: 'PENDING' });
    const final = await applyResult(order, outcome, txId, req.body, req.ip);
    return res.json({ ok: true, status: final });
  } catch(e) {
    logger.error('callback:', e.message);
    res.status(500).json({ error: 'Erreur traitement callback' });
  }
}

// GET /api/payment/status/:externalId
async function getStatus(req, res) {
  try {
    let order = await Order.findOne({ externalId: req.params.externalId });
    if (!order) return res.status(404).json({ error: 'Commande introuvable' });

    // Si le webhook n'est pas encore arrivé, on interroge KPay directement
    if (order.status === 'PENDING' && process.env.KPAY_API_KEY) {
      try {
        const remote = await kpay.getStatus(order.externalId);
        const outcome = normalizeStatus(remote.status || remote.data?.status);
        if (outcome !== 'PENDING') {
          await applyResult(order, outcome, remote.transactionId || remote.data?.transactionId || '', remote, req.ip);
          order = await Order.findById(order._id);
        }
      } catch(e) { /* KPay injoignable : on renvoie l'état connu */ }
    }
    res.json({ status: order.status, orderNumber: order.orderNumber, finalAmount: order.finalAmount, createdAt: order.createdAt, kpayTxId: order.kpayTxId });
  } catch(e) { res.status(500).json({ error: e.message }); }
}

// GET /api/orders — liste commandes
async function getOrders(req, res) {
  try {
    const { status, page=1, limit=50 } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (req.user?.role === 'merchant') filter['items.sellerId'] = req.user.id;
    else if (req.user?.role === 'customer') filter.userId = req.user.id;
    const [orders, total, stats] = await Promise.all([
      Order.find(filter).sort({ createdAt:-1 }).skip((Number(page)-1)*Number(limit)).limit(Number(limit)).lean(),
      Order.countDocuments(filter),
      Order.aggregate([{ $group:{ _id:'$status', count:{ $sum:1 } } }]),
    ]);
    const statMap = {}; stats.forEach(s=>statMap[s._id]=s.count);
    res.json({ orders, total, page:Number(page), stats:{ pending:statMap.PENDING||0, valide:statMap['VALIDÉ']||0, refuse:statMap['REFUSÉ']||0 } });
  } catch(e) { res.status(500).json({ error: e.message }); }
}

// GET /api/orders/:id/invoice
async function getInvoice(req, res) {
  try {
    const order = await Order.findById(req.params.id).lean();
    if (!order) return res.status(404).json({ error: 'Commande introuvable' });
    if (req.user?.role !== 'admin' && String(order.userId) !== req.user?.id) return res.status(403).json({ error: 'Accès refusé' });
    const filePath = path.join(__dirname, '../../invoices', `facture-${order.orderNumber}.pdf`);
    if (!fs.existsSync(filePath)) {
      const generated = await generateInvoice(order);
      if (!generated) return res.status(500).json({ error: 'Impossible de générer la facture' });
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=facture-${order.orderNumber}.pdf`);
    fs.createReadStream(filePath).pipe(res);
  } catch(e) { res.status(500).json({ error: e.message }); }
}

// PUT /api/orders/:id/status (marchand → LIVRÉ)
async function updateOrderStatus(req, res) {
  try {
    const { status } = req.body;
    if (!['LIVRÉ'].includes(status)) return res.status(400).json({ error: 'Seul LIVRÉ est autorisé ici' });
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Commande introuvable' });
    const isMerchant = req.user.role === 'merchant' && order.items.some(i => String(i.sellerId) === req.user.id);
    if (!isMerchant && req.user.role !== 'admin') return res.status(403).json({ error: 'Accès refusé' });
    order.status = status;
    order.trackingNumber = 'GP-TRK-' + Date.now();
    await order.save();
    if (order.userId) await notifyUser(order.userId, 'customer', `📦 Commande ${order.orderNumber} marquée comme LIVRÉE`, 'ORDER', String(order._id));
    res.json({ success: true, order });
  } catch(e) { res.status(500).json({ error: e.message }); }
}

module.exports = { pay, callback, getStatus, getOrders, getInvoice, updateOrderStatus };
