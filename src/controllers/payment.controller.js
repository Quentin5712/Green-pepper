'use strict';
const Order   = require('../models/Order');
const Product = require('../models/Product');
const kpay    = require('../utils/kpay');
const crypto  = require('crypto');

// ══════════════════════════════════════════════
// POST /api/payment/pay
// 1. Valider les données
// 2. Créer la commande PENDING en DB
// 3. Appeler KPay
// 4. Retourner PENDING au frontend
// ══════════════════════════════════════════════
async function pay(req, res) {
  try {
    const { phone, operator, items, customerName, location, deliveryFee } = req.body;

    // Validation basique
    if (!phone || !operator || !items?.length) {
      return res.status(400).json({ error: 'Téléphone, opérateur et produits requis' });
    }
    if (!['MTN_MOMO_CMR','ORANGE_CMR'].includes(operator)) {
      return res.status(400).json({ error: 'Opérateur invalide (MTN_MOMO_CMR ou ORANGE_CMR)' });
    }

    // Vérifier les produits et calculer le total
    const productIds = items.map(i => i.productId).filter(Boolean);
    const dbProducts = await Product.find({ _id: { $in: productIds }, isActive: true }).lean();

    const orderProducts = [];
    let subtotal = 0;

    for (const item of items) {
      const prod = dbProducts.find(p => String(p._id) === String(item.productId));
      if (!prod) return res.status(404).json({ error: `Produit introuvable: ${item.productId}` });
      if (prod.stock < (item.quantity || 1)) {
        return res.status(409).json({ error: `Stock insuffisant pour: ${prod.name}` });
      }
      const qty = Number(item.quantity) || 1;
      orderProducts.push({
        productId: prod._id,
        name:      prod.name,
        price:     prod.price,
        quantity:  qty,
        sellerId:  prod.sellerId,
      });
      subtotal += prod.price * qty;
    }

    const total      = subtotal + (Number(deliveryFee) || 0);
    const externalId = 'GP-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex').toUpperCase();

    // Créer commande PENDING
    const order = await Order.create({
      customerPhone: kpay.formatPhone(phone),
      customerName:  customerName || 'Client anonyme',
      location:      location || '',
      products:      orderProducts,
      total,
      deliveryFee:   Number(deliveryFee) || 0,
      status:        'PENDING',
      externalId,
      provider:      operator,
    });

    console.log(`🟡 Commande créée PENDING: ${externalId} | ${total} XAF | ${operator}`);

    // Appeler KPay
    let kpayData;
    try {
      kpayData = await kpay.initPayment({
        amount:      total,
        provider:    operator,
        phoneNumber: phone,
        externalId,
        description: `Green Pepper — ${orderProducts.map(p => p.name).join(', ')}`,
      });
      // Sauvegarder la réponse KPay
      await Order.findByIdAndUpdate(order._id, { kpayResponse: kpayData });
    } catch(e) {
      // KPay en erreur → on marque REFUSÉ et on informe le client
      await Order.findByIdAndUpdate(order._id, { status: 'REFUSÉ', kpayResponse: { error: e.message } });
      console.error('❌ KPay erreur:', e.message);
      return res.status(502).json({
        error:  'Erreur initialisation paiement KPay',
        detail: e.response?.data || e.message,
      });
    }

    // Répondre PENDING → frontend affiche "Vérifie ton *126#"
    return res.json({
      status:     'PENDING',
      externalId,
      orderId:    order._id,
      message:    operator === 'MTN_MOMO_CMR'
        ? 'Composez *126# et validez le paiement, ou attendez la notification MoMo'
        : 'Validez le paiement Orange Money sur votre téléphone',
      kpay:       kpayData,
    });

  } catch(e) {
    console.error('❌ pay() error:', e.message);
    res.status(500).json({ error: 'Erreur serveur paiement' });
  }
}

// ══════════════════════════════════════════════
// POST /api/payment/callback
// Webhook KPay — décide du statut final
// Body attendu: { externalId, status, transactionId, ... }
// ══════════════════════════════════════════════
async function callback(req, res) {
  try {
    const { externalId, status, transactionId, kpayTransactionId } = req.body;
    const txId = transactionId || kpayTransactionId || '';

    console.log(`🔔 KPay Callback: ${externalId} → ${status} | tx: ${txId}`);

    if (!externalId || !status) {
      return res.status(400).json({ error: 'externalId et status requis' });
    }

    // Trouver la commande
    const order = await Order.findOne({ externalId });
    if (!order) {
      console.warn(`⚠️  Commande introuvable pour externalId: ${externalId}`);
      return res.status(404).json({ error: 'Commande introuvable' });
    }

    // Déjà traité
    if (order.status !== 'PENDING') {
      console.log(`ℹ️  Commande ${externalId} déjà traitée (${order.status})`);
      return res.json({ ok: true, status: order.status });
    }

    if (status === 'SUCCESS' || status === 'SUCCESSFUL' || status === 'PAID') {
      // ── PAIEMENT VALIDÉ ──
      await Order.findByIdAndUpdate(order._id, {
        status:            'VALIDÉ',
        kpayTransactionId: txId,
        kpayResponse:      req.body,
      });

      // Décrémenter les stocks atomiquement
      for (const item of order.products) {
        if (item.productId) {
          await Product.findOneAndUpdate(
            { _id: item.productId, stock: { $gte: item.quantity } },
            { $inc: { stock: -item.quantity } }
          );
        }
      }

      console.log(`✅ Commande VALIDÉE: ${externalId} | tx: ${txId}`);

    } else {
      // ── PAIEMENT REFUSÉ ──
      await Order.findByIdAndUpdate(order._id, {
        status:       'REFUSÉ',
        kpayResponse: req.body,
      });
      console.log(`❌ Commande REFUSÉE: ${externalId} | status KPay: ${status}`);
    }

    // KPay attend un 200 pour ne pas retenter
    return res.json({ ok: true });

  } catch(e) {
    console.error('❌ callback() error:', e.message);
    res.status(500).json({ error: 'Erreur traitement callback' });
  }
}

// ══════════════════════════════════════════════
// GET /api/payment/status/:externalId
// Polling depuis le frontend pour vérifier le statut
// ══════════════════════════════════════════════
async function getStatus(req, res) {
  try {
    const order = await Order.findOne({ externalId: req.params.externalId })
      .select('status externalId total createdAt kpayTransactionId')
      .lean();
    if (!order) return res.status(404).json({ error: 'Commande introuvable' });
    res.json(order);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}

// ══════════════════════════════════════════════
// GET /api/orders
// Admin — liste toutes les commandes
// ══════════════════════════════════════════════
async function getOrders(req, res) {
  try {
    const { status, page = 1, limit = 50 } = req.query;
    const filter = {};
    if (status && ['PENDING','VALIDÉ','REFUSÉ'].includes(status)) filter.status = status;

    const orders = await Order.find(filter)
      .sort({ createdAt: -1 })
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit))
      .lean();

    const total = await Order.countDocuments(filter);

    // Stats pour le tableau admin
    const [pending, valide, refuse] = await Promise.all([
      Order.countDocuments({ status: 'PENDING' }),
      Order.countDocuments({ status: 'VALIDÉ' }),
      Order.countDocuments({ status: 'REFUSÉ' }),
    ]);

    res.json({ orders, total, page: Number(page), stats: { pending, valide, refuse } });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}

module.exports = { pay, callback, getStatus, getOrders };
