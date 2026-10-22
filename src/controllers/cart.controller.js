'use strict';
const Cart    = require('../models/Cart');
const Product = require('../models/Product');

async function addToCart(req, res) {
  try {
    const { productId, qty } = req.body;
    const q = Number(qty) || 1;
    if (q < 1 || q > 10) return res.status(400).json({ error: 'qty doit être entre 1 et 10' });

    // Réserver atomiquement
    const prod = await Product.findOneAndUpdate(
      { _id: productId, isDeleted: false, isActive: true, stock: { $gte: q } },
      { $inc: { stock: -q, reserved: q } },
      { new: true }
    );
    if (!prod) return res.status(409).json({ error: 'Stock insuffisant ou produit introuvable' });

    // Supprimer ancienne entrée panier si existe
    const existing = await Cart.findOne({ userId: req.user.id, productId });
    if (existing) {
      await Product.findByIdAndUpdate(productId, { $inc: { stock: existing.qty, reserved: -existing.qty } });
      await existing.deleteOne();
    }

    const cart = await Cart.create({
      userId:     req.user.id,
      productId:  prod._id,
      qty:        q,
      priceAtAdd: prod.finalPrice,
      shopId:     prod.shopId,
      expiresAt:  new Date(Date.now() + 60000),
    });

    res.status(201).json({ success: true, cart, expiresAt: cart.expiresAt, stockRemaining: prod.stock });
  } catch(e) { res.status(500).json({ error: e.message }); }
}

async function getCart(req, res) {
  try {
    const items = await Cart.find({ userId: req.user.id }).populate('productId','name price imageUrl finalPrice').lean();
    const total = items.reduce((a, c) => a + c.priceAtAdd * c.qty, 0);
    res.json({ items, total, count: items.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
}

async function removeFromCart(req, res) {
  try {
    const item = await Cart.findOne({ userId: req.user.id, productId: req.params.productId });
    if (!item) return res.status(404).json({ error: 'Article introuvable dans le panier' });
    await Product.findByIdAndUpdate(item.productId, { $inc: { stock: item.qty, reserved: -item.qty } });
    await item.deleteOne();
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
}

async function clearCart(req, res) {
  try {
    const items = await Cart.find({ userId: req.user.id });
    for (const item of items) await Product.findByIdAndUpdate(item.productId, { $inc: { stock: item.qty, reserved: -item.qty } });
    await Cart.deleteMany({ userId: req.user.id });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
}

module.exports = { addToCart, getCart, removeFromCart, clearCart };
