'use strict';
// Le paiement (pay / webhook / statut) est dans src/routes/kpay.js.
// Ici : liste des commandes, facture PDF, expédition par le vendeur.
const path   = require('path');
const fs     = require('fs');
const Order  = require('../models/Order');
const logger = require('../utils/logger');
const { generateInvoice } = require('../utils/invoice');
const { notifyUser } = require('../utils/notify');

const STATUSES = ['PENDING', 'VALIDÉ', 'REFUSÉ', 'EXPIRED', 'NEGOCIATED', 'LIVRÉ'];

async function getOrders(req, res) {
  try {
    const { status, page = 1, limit = 50 } = req.query;
    const filter = {};
    if (status && STATUSES.includes(status)) filter.status = status;
    if (req.user?.role === 'merchant') filter['items.sellerId'] = req.user.id;
    else if (req.user?.role === 'customer') filter.userId = req.user.id;
    const base = { ...filter }; delete base.status;                    // les compteurs ignorent le filtre de statut
    const [orders, total, agg] = await Promise.all([
      Order.find(filter).sort({ createdAt: -1 }).skip((Number(page) - 1) * Number(limit)).limit(Math.min(Number(limit), 200)).lean(),
      Order.countDocuments(filter),
      Order.aggregate([{ $match: base }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    ]);
    const st = {}; agg.forEach(s => { st[s._id] = s.count; });
    res.json({ orders, total, page: Number(page), stats: { pending: st.PENDING || 0, valide: (st['VALIDÉ'] || 0) + (st['LIVRÉ'] || 0), refuse: st['REFUSÉ'] || 0 } });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

async function getInvoice(req, res) {
  try {
    const order = await Order.findById(req.params.id).lean();
    if (!order) return res.status(404).json({ error: 'Commande introuvable' });
    const isSeller = (order.items || []).some(i => String(i.sellerId) === String(req.user?.id));
    if (req.user?.role !== 'admin' && String(order.userId) !== String(req.user?.id) && !isSeller) return res.status(403).json({ error: 'Accès refusé' });
    const filePath = path.join(__dirname, '../../invoices', `facture-${order.orderNumber}.pdf`);
    if (!fs.existsSync(filePath)) {
      const generated = await generateInvoice(order);
      if (!generated) return res.status(500).json({ error: 'Impossible de générer la facture' });
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=facture-${order.orderNumber}.pdf`);
    fs.createReadStream(filePath).pipe(res);
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// Le vendeur déclare « expédié ». Cela NE valide PAS la livraison et ne déclenche AUCUN versement :
// seule la photo de l'acheteur le fait.
async function updateOrderStatus(req, res) {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Commande introuvable' });
    const isSeller = (order.items || []).some(i => String(i.sellerId) === String(req.user.id));
    if (req.user.role !== 'admin' && !isSeller) return res.status(403).json({ error: 'Accès refusé' });
    if (order.status !== 'VALIDÉ') return res.status(400).json({ error: 'Seule une commande payée peut être expédiée' });
    if (order.orderType !== 'physical') return res.status(400).json({ error: 'Produit digital : rien à expédier' });
    order.shippedAt = new Date();
    order.trackingNumber = order.trackingNumber || 'GP-TRK-' + Date.now();
    await order.save();
    logger.info(`EXPÉDIÉ: order=${order.orderNumber} par ${req.user.id}`);
    if (order.userId) await notifyUser(order.userId, 'customer', `📦 Votre commande ${order.orderNumber} a été expédiée. À la réception, confirmez avec une photo du produit.`, 'ORDER', String(order._id));
    res.json({ success: true, shippedAt: order.shippedAt });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

module.exports = { getOrders, getInvoice, updateOrderStatus };
