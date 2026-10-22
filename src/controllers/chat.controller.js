'use strict';
const Message = require('../models/Message');
const Order   = require('../models/Order');
const Product = require('../models/Product');
const xss     = require('xss');

async function sendMessage(req, res) {
  try {
    const { shopId, productId, message, priceProposed } = req.body;
    if (!shopId || !productId || !message) return res.status(400).json({ error: 'shopId, productId et message requis' });
    const clean = xss(message.trim()).slice(0, 500);
    const prod  = await Product.findById(productId);
    if (!prod) return res.status(404).json({ error: 'Produit introuvable' });
    const msg = await Message.create({
      shopId, productId, clientId: req.user.id,
      sender: req.user.role === 'merchant' ? 'merchant' : 'client',
      message: clean,
      priceProposed: Number(priceProposed) > 0 ? Number(priceProposed) : 0,
    });
    res.status(201).json(msg);
  } catch(e) { res.status(500).json({ error: e.message }); }
}

async function getChat(req, res) {
  try {
    const { shopId } = req.params;
    const filter = { shopId };
    if (req.user.role === 'customer') filter.clientId = req.user.id;
    const messages = await Message.find(filter).sort({ createdAt: 1 }).populate('clientId','name').lean();
    res.json({ messages, count: messages.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
}

async function respondMessage(req, res) {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!['ACCEPTED','REFUSED'].includes(status)) return res.status(400).json({ error: 'status doit être ACCEPTED ou REFUSED' });
    const msg = await Message.findById(id);
    if (!msg) return res.status(404).json({ error: 'Message introuvable' });
    msg.status = status;
    await msg.save();
    if (status === 'ACCEPTED' && msg.priceProposed > 0) {
      await Order.create({
        userId: msg.clientId, items:[{ productId: msg.productId, qty:1, priceAtPurchase: msg.priceProposed }],
        amount: msg.priceProposed, finalAmount: msg.priceProposed,
        commission: Math.round(msg.priceProposed * 0.10),
        status: 'NEGOCIATED', externalId: 'NEG-'+Date.now(), provider: 'MTN_MOMO_CMR',
      });
    }
    res.json({ success: true, message: msg });
  } catch(e) { res.status(500).json({ error: e.message }); }
}

module.exports = { sendMessage, getChat, respondMessage };
