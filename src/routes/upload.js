'use strict';
// Photo de livraison : envoyée par l'acheteur, stockée EN PRIVÉ (jamais servie publiquement)
const express   = require('express');
const crypto    = require('crypto');
const rateLimit = require('express-rate-limit');
const router    = express.Router();
const Image     = require('../models/Image');
const Order     = require('../models/Order');
const logger    = require('../utils/logger');
const uploadMw  = require('../middlewares/upload');
const { authIfPresent } = require('../middlewares/auth');
const { detectMime } = require('../controllers/image.controller');

const limiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false,
  message: { error: "Trop d'envois de photos. Réessayez plus tard." },
  skip: () => process.env.NODE_ENV !== 'production',
});
const isKpayId = s => /^[A-Za-z0-9_\-]{4,100}$/.test(String(s || ''));
const isHex24  = s => /^[a-f0-9]{24}$/.test(String(s || ''));
function safeEqual(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

// POST /api/upload/delivery  (multipart : image + kpayId + token)
router.post('/delivery', limiter, authIfPresent, uploadMw, async (req, res) => {
  try {
    const { kpayId, token } = req.body || {};
    if (!isKpayId(kpayId)) return res.status(400).json({ error: 'Commande invalide' });
    if (!req.file) return res.status(400).json({ error: 'Aucune photo reçue' });
    const order = await Order.findOne({ kpayId }).select('+trackToken');
    if (!order) return res.status(404).json({ error: 'Commande introuvable' });
    const isOwner = !!(req.user && order.userId && String(order.userId) === String(req.user.id));
    if (!isOwner && !safeEqual(token, order.trackToken)) return res.status(403).json({ error: 'Accès refusé' });
    if (order.orderType !== 'physical' || order.status !== 'VALIDÉ' || order.deliveryStatus !== 'AWAITING') {
      return res.status(409).json({ error: 'Photo impossible pour cette commande (non payée, déjà validée ou en litige)' });
    }
    const mime = detectMime(req.file.buffer);
    if (!mime) return res.status(400).json({ error: 'Fichier invalide : photo JPG, PNG ou WebP uniquement' });

    const img = await Image.create({ data: req.file.buffer, mime, size: req.file.size, ownerId: order.userId ? String(order.userId) : 'guest', kind: 'delivery' });
    const prev = order.photo_livraison;
    await Order.updateOne({ _id: order._id, deliveryStatus: 'AWAITING' }, { $set: { photo_livraison: img._id, photoUploadedAt: new Date() } });
    if (prev) await Image.deleteOne({ _id: prev, kind: 'delivery' });
    logger.info(`PHOTO LIVRAISON order=${order.orderNumber} image=${img._id} ${mime} ${req.file.size}o`);
    res.status(201).json({ success: true, message: 'Photo reçue. Vous pouvez maintenant confirmer la réception.' });
  } catch (e) { logger.error(`upload/delivery: ${e.message}`); res.status(500).json({ error: 'Erreur serveur' }); }
});

// GET /api/upload/delivery-photo/:orderId  (admin, vendeur de la commande, acheteur)
router.get('/delivery-photo/:orderId', authIfPresent, async (req, res) => {
  try {
    if (!isHex24(req.params.orderId)) return res.status(404).end();
    const order = await Order.findById(req.params.orderId).select('+trackToken');
    if (!order || !order.photo_livraison) return res.status(404).end();
    const isAdmin  = req.user && req.user.role === 'admin';
    const isVendor = req.user && String(order.vendorId) === String(req.user.id);
    const isOwner  = req.user && order.userId && String(order.userId) === String(req.user.id);
    if (!isAdmin && !isVendor && !isOwner && !safeEqual(req.query.token, order.trackToken)) return res.status(403).end();
    const img = await Image.findOne({ _id: order.photo_livraison, kind: 'delivery' });
    if (!img) return res.status(404).end();
    res.set({ 'Content-Type': img.mime, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" });
    res.send(img.data);
  } catch (e) { res.status(404).end(); }
});

module.exports = router;
