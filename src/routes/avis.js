'use strict';
// Avis clients : réservés aux clients qui ont REÇU leur commande ; photo facultative ; modération par l'admin.
const express   = require('express');
const crypto    = require('crypto');
const rateLimit = require('express-rate-limit');
const router    = express.Router();
const Avis      = require('../models/Avis');
const Order     = require('../models/Order');
const Product   = require('../models/Product');
const Shop      = require('../models/Shop');
const Image     = require('../models/Image');
const logger    = require('../utils/logger');
const uploadMw  = require('../middlewares/upload');
const { authIfPresent } = require('../middlewares/auth');
const { detectMime } = require('../controllers/image.controller');
const { clean } = require('../utils/clean');

const limiter = rateLimit({ windowMs: 3600e3, max: 10, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Trop d\'avis envoyés. Réessayez plus tard.' }, skip: () => process.env.NODE_ENV !== 'production' });
const isKpayId = s => /^[A-Za-z0-9_\-]{4,100}$/.test(String(s || ''));
const isHex24  = s => /^[a-f0-9]{24}$/.test(String(s || ''));
function safeEqual(a, b) { const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || '')); return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y); }
const reviewable = o => o.status === 'LIVRÉ' || (o.orderType === 'digital' && o.status === 'VALIDÉ');   // « lorsqu'ils reçoivent leurs produits »

async function orderOf(req, kpayId, token) {
  if (!isKpayId(kpayId)) return { status: 400, error: 'Commande invalide' };
  const order = await Order.findOne({ kpayId }).select('+trackToken');
  if (!order) return { status: 404, error: 'Commande introuvable' };
  const owner = !!(req.user && order.userId && String(order.userId) === String(req.user.id));
  if (!owner && !safeEqual(token, order.trackToken)) return { status: 403, error: 'Accès refusé' };
  return { order };
}
const view = a => ({ id: a._id, firstName: a.firstName, lastName: a.lastName, location: a.location, rating: a.rating, comment: a.comment, photoUrl: a.photoUrl, productName: a.productName, shopName: a.shopName, createdAt: a.createdAt });

// ── Liste publique + note moyenne ──
router.get('/', async (req, res) => {
  try {
    const filter = { status: 'PUBLISHED' };
    if (isHex24(req.query.productId)) filter.productId = req.query.productId;
    if (isHex24(req.query.shopId)) filter.shopId = req.query.shopId;
    const page = Math.max(1, Number(req.query.page) || 1), limit = Math.min(30, Math.max(1, Number(req.query.limit) || 12));
    const [rows, total, dist] = await Promise.all([
      Avis.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Avis.countDocuments(filter),
      Avis.aggregate([{ $match: filter }, { $group: { _id: '$rating', n: { $sum: 1 } } }]),
    ]);
    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }; let sum = 0, n = 0;
    dist.forEach(d => { distribution[d._id] = d.n; sum += d._id * d.n; n += d.n; });
    res.json({ reviews: rows.map(view), total, page, average: n ? Math.round((sum / n) * 10) / 10 : 0, distribution });
  } catch (e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

// ── Cette commande peut-elle recevoir un avis ? ──
router.get('/eligible', authIfPresent, async (req, res) => {
  try {
    const f = await orderOf(req, req.query.kpayId, req.query.token);
    if (f.error) return res.status(f.status).json({ error: f.error });
    const o = f.order;
    if (!reviewable(o)) return res.json({ eligible: false, reason: 'Vous pourrez donner votre avis une fois votre commande reçue.' });
    const done = (await Avis.find({ orderId: o._id })).map(a => String(a.productId));
    const products = (o.items || []).map(i => ({ id: String(i.productId), name: i.name, reviewed: done.includes(String(i.productId)) }));
    res.json({ eligible: products.some(p => !p.reviewed), reason: products.every(p => p.reviewed) ? 'Vous avez déjà donné votre avis sur cette commande. Merci !' : '', products, orderNumber: o.orderNumber });
  } catch (e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

// ── Donner un avis (multipart : champs + photo facultative) ──
router.post('/', limiter, authIfPresent, uploadMw, async (req, res) => {
  try {
    const b = req.body || {};
    const f = await orderOf(req, b.kpayId, b.token);
    if (f.error) return res.status(f.status).json({ error: f.error });
    const o = f.order;
    if (!reviewable(o)) return res.status(409).json({ error: 'Votre commande n\'est pas encore reçue : l\'avis sera possible à la réception.' });
    const item = (o.items || []).find(i => String(i.productId) === String(b.productId));
    if (!item) return res.status(400).json({ error: 'Produit non présent dans cette commande' });

    const firstName = clean(b.firstName, 40), lastName = clean(b.lastName, 40), location = clean(b.location, 80), comment = clean(b.comment, 1000);
    const rating = Number(b.rating);
    if (firstName.length < 2 || lastName.length < 2) return res.status(400).json({ error: 'Prénom et nom requis' });
    if (location.length < 2) return res.status(400).json({ error: 'Localisation requise (ville, pays)' });
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return res.status(400).json({ error: 'Note de 1 à 5 requise' });
    if (comment.length < 10) return res.status(400).json({ error: 'Votre avis doit faire au moins 10 caractères' });
    if (!['1', 'true', 'on', true].includes(b.consent)) return res.status(400).json({ error: 'Vous devez accepter la publication de votre avis' });
    if (await Avis.findOne({ orderId: o._id, productId: item.productId })) return res.status(409).json({ error: 'Vous avez déjà donné votre avis sur ce produit' });

    let photoUrl = '';
    if (req.file) {
      const mime = detectMime(req.file.buffer);
      if (!mime) return res.status(400).json({ error: 'Photo invalide : JPG, PNG ou WebP uniquement' });
      const img = await Image.create({ data: req.file.buffer, mime, size: req.file.size, ownerId: String(o.userId || 'guest'), kind: 'review' });
      photoUrl = `/api/images/${img._id}`;
    }
    const prod = await Product.findById(item.productId).select('shopId name');
    const shop = prod && prod.shopId ? await Shop.findById(prod.shopId).select('name') : null;
    const a = await Avis.create({ orderId: o._id, productId: item.productId, productName: item.name || prod?.name || '', shopId: prod?.shopId || null, shopName: shop?.name || '', vendorId: o.vendorId || '',
      firstName, lastName, location, rating, comment, photoUrl });
    await recomputeProduct(item.productId);
    logger.info(`AVIS: order=${o.orderNumber} produit=${item.productId} note=${rating} photo=${photoUrl ? 'oui' : 'non'}`);
    res.status(201).json({ success: true, message: 'Merci ! Votre avis est publié.', review: view(a) });
  } catch (e) {
    if (e && e.code === 11000) return res.status(409).json({ error: 'Vous avez déjà donné votre avis sur ce produit' });
    logger.error(`avis: ${e.message}`); res.status(500).json({ error: 'Erreur serveur' });
  }
});

async function recomputeProduct(productId) {
  const r = await Avis.aggregate([{ $match: { productId, status: 'PUBLISHED' } }, { $group: { _id: null, avg: { $avg: '$rating' }, n: { $sum: 1 } } }]);
  await Product.findByIdAndUpdate(productId, { rating: r.length ? Math.round(r[0].avg * 10) / 10 : 0, reviewCount: r.length ? r[0].n : 0 });
}
router.recomputeProduct = recomputeProduct;
module.exports = router;
