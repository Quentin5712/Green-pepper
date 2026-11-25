'use strict';
// Création d'une commande depuis le panier : prix relus en base, stock réservé atomiquement,
// un paiement = une boutique + un type de produit, anti double-clic (clientRef).
const crypto  = require('crypto');
const Order   = require('../models/Order');
const Product = require('../models/Product');
const kpay    = require('./kpay');
const logger  = require('./logger');
const { clean } = require('./clean');
const { providerInfo } = require('./countries');

const isHex24 = s => /^[a-f0-9]{24}$/.test(String(s || ''));
const MIN_AMOUNT = 500;

async function createCheckoutOrder(req, { method, provider, phone }) {
  const reserved = [];
  const release = () => Promise.all(reserved.map(r => Product.findByIdAndUpdate(r.productId, { $inc: { stock: r.qty, reserved: -r.qty } })));
  const bad = (status, error, extra = {}) => ({ ok: false, status, body: { error, ...extra } });
  try {
    let cfg = null;
    if (method !== 'USDT') {
      try { cfg = await kpay.getKpayConfig(); }
      catch (e) { logger.error(`KPay config invalide: ${e.message}`); return bad(503, 'Paiement indisponible (configuration).'); }
      if (!cfg.apiKey) return bad(503, 'Paiement indisponible : clé KPay non configurée.');
      if (!cfg.merchantNumber) { logger.error('ADMIN_PHONE manquant — paiement refusé'); return bad(503, 'Paiement indisponible : numéro de réception non configuré.'); }
    }
    const { items, address, customerName, clientRef } = req.body || {};
    if (!Array.isArray(items) || !items.length || items.length > 20) return bad(400, 'Panier invalide');

    // Même clientRef = même commande (double clic, rafraîchissement) : on renvoie la première, on n'en crée pas une deuxième
    const ref = /^[A-Za-z0-9_\-]{8,64}$/.test(String(clientRef || '')) ? String(clientRef) : '';
    if (ref) {
      const ex = await Order.findOne({ clientRef: ref, paymentMethod: method, createdAt: { $gte: new Date(Date.now() - 15 * 60000) }, status: { $in: ['PENDING', 'VALIDÉ', 'LIVRÉ'] } }).select('+trackToken');
      if (ex) return { ok: true, existing: true, order: ex, trackToken: ex.trackToken };
    }

    const wanted = new Map();
    for (const it of items) {
      const id = String(it?.productId || ''), qty = Number(it?.qty);
      if (!isHex24(id) || !Number.isInteger(qty) || qty < 1 || qty > 10) return bad(400, 'Produit ou quantité invalide (1 à 10)');
      wanted.set(id, (wanted.get(id) || 0) + qty);
    }
    for (const q of wanted.values()) if (q > 10) return bad(400, 'Maximum 10 unités par produit');
    const ids = [...wanted.keys()];
    const prods = await Product.find({ _id: { $in: ids }, isActive: true, isDeleted: false }).select('sellerId type');
    if (prods.length !== ids.length) return bad(404, 'Un produit du panier n\'est plus disponible');
    if (new Set(prods.map(p => String(p.sellerId))).size > 1) return bad(400, 'Un paiement = une seule boutique. Commandez les boutiques séparément.');
    if (new Set(prods.map(p => p.type || 'physical')).size > 1) return bad(400, 'Passez les produits physiques et digitaux en deux commandes séparées.');

    const orderItems = []; let amount = 0;
    for (const [pid, qty] of wanted) {
      const prod = await Product.findOneAndUpdate({ _id: pid, isDeleted: false, isActive: true, stock: { $gte: qty } }, { $inc: { stock: -qty, reserved: qty } }, { new: true });
      if (!prod) { await release(); return bad(409, 'Stock insuffisant pour un produit du panier'); }
      reserved.push({ productId: pid, qty });
      const unit = prod.finalPrice;                                     // réduction éventuelle appliquée côté serveur
      orderItems.push({ productId: prod._id, name: prod.name, qty, priceAtPurchase: unit, discountApplied: prod.discount || 0, sellerId: prod.sellerId });
      amount += unit * qty;
    }
    amount = Math.round(amount);
    if (amount < MIN_AMOUNT) { await release(); return bad(400, `Montant minimum : ${MIN_AMOUNT} FCFA`); }

    const pinfo = method === 'MOMO' ? providerInfo(provider) : null;
    const externalId = 'GP-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex').toUpperCase();
    const trackToken = crypto.randomBytes(24).toString('hex');
    let order;
    try {
      order = await Order.create({
        userId: req.user?.id || null, guestPhone: req.user || !/^[0-9+\s.\-]{8,15}$/.test(String(phone || '')) ? '' : String(phone).trim(),
        payerPhone: pinfo ? kpay.formatPhone(phone, pinfo.country) : '',
        customerName: clean(customerName || '', 80), address: clean(address || '', 300),
        items: orderItems, amount, finalAmount: amount, status: 'PENDING', externalId, trackToken,
        provider: method === 'MOMO' ? provider : (method === 'USDT' ? 'USDT_TRC20' : 'GATEWAY'), paymentMethod: method,
        walletCountry: pinfo ? pinfo.country : (process.env.KPAY_WALLET_COUNTRY || 'CMR'),
        vendorId: String(prods[0].sellerId), orderType: prods[0].type || 'physical',
        receiverPhone: cfg ? cfg.merchantNumber : '', clientRef: ref || undefined,
      });
    } catch (e) { await release(); throw e; }
    logger.info(`PENDING: order=${order.orderNumber} ext=${externalId} ${amount} FCFA method=${method} type=${order.orderType}${cfg ? ' mode=' + cfg.mode : ''}`);
    return { ok: true, order, trackToken, cfg };
  } catch (e) { try { await release(); } catch (x) {} throw e; }
}
module.exports = { createCheckoutOrder, MIN_AMOUNT };
