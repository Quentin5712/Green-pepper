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

// POST /api/payment/callback — webhook KPay avec HMAC
async function callback(req, res) {
  try {
    const sig = req.headers['x-kpay-signature'] || req.headers['x-signature'] || '';
    const rawBody = req.rawBody || JSON.stringify(req.body); // rawBody depuis middleware

    if (!kpay.verifyHmac(rawBody, sig)) {
      logger.warn(`CALLBACK HMAC INVALID: ip=${req.ip}`);
      return res.status(401).json({ error: 'Signature HMAC invalide' });
    }

    const { externalId, status, transactionId } = req.body;
    if (!externalId || !status) return res.status(400).json({ error: 'externalId et status requis' });

    const order = await Order.findOne({ externalId });
    if (!order) { logger.warn(`CALLBACK: order not found ext=${externalId}`); return res.status(404).json({ error: 'Commande introuvable' }); }

    // Idempotence — déjà traité
    if (order.status !== 'PENDING') return res.json({ ok: true, status: order.status });

    const isSuccess = ['SUCCESS','SUCCESSFUL','PAID'].includes(status);
    const newStatus = isSuccess ? 'VALIDÉ' : 'REFUSÉ';

    await Order.findByIdAndUpdate(order._id, { status: newStatus, kpayTxId: transactionId || '', kpayResponse: req.body });
    await TransactionLog.create({ orderId: order._id, externalId, amount: order.amount, finalAmount: order.finalAmount, commission: order.commission, status: newStatus, provider: order.provider, ip: req.ip });

    if (isSuccess) {
      // Libérer les reserved (stock déjà décrémenté à la commande)
      for (const item of order.items) {
        if (item.productId) await Product.findByIdAndUpdate(item.productId, { $inc: { reserved: -item.qty } });
      }
      // Vider le panier si user connecté
      if (order.userId) await Cart.deleteMany({ userId: order.userId });

      // Générer facture PDF
      const invoicePath = await generateInvoice(order);

      // Notifier
      if (order.userId) await notifyUser(order.userId, 'customer', `✅ Commande ${order.orderNumber} confirmée — ${order.finalAmount.toLocaleString('fr-FR')} FCFA`, 'PAYMENT', String(order._id));
      const sellerIds = [...new Set((order.items||[]).map(i=>i.sellerId).filter(Boolean))];
      for (const sid of sellerIds) await notifyMerchant(sid, `🛒 Nouvelle commande VALIDÉE — ${order.orderNumber} — ${order.finalAmount.toLocaleString('fr-FR')} FCFA`, 'ORDER');

      logger.info(`VALIDÉ: order=${order._id} ext=${externalId} tx=${transactionId}`);
    } else {
      // Remettre le stock en cas de refus
      for (const item of order.items) {
        if (item.productId) await Product.findByIdAndUpdate(item.productId, { $inc: { stock: item.qty, reserved: -item.qty } });
      }
      if (order.userId) await notifyUser(order.userId, 'customer', `❌ Paiement refusé pour la commande ${order.orderNumber}`, 'PAYMENT', String(order._id));
      logger.info(`REFUSÉ: order=${order._id} ext=${externalId}`);
    }

    return res.json({ ok: true });
  } catch(e) {
    logger.error('callback:', e.message);
    res.status(500).json({ error: 'Erreur traitement callback' });
  }
}

// GET /api/payment/status/:externalId
async function getStatus(req, res) {
  try {
    const order = await Order.findOne({ externalId: req.params.externalId }).select('status orderNumber finalAmount createdAt kpayTxId').lean();
    if (!order) return res.status(404).json({ error: 'Commande introuvable' });
    res.json(order);
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
