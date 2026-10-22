'use strict';
const Review  = require('../models/Review');
const Order   = require('../models/Order');
const Product = require('../models/Product');
const xss     = require('xss');

async function createReview(req, res) {
  try {
    const { productId } = req.params;
    const { rating, comment, orderId } = req.body;
    if (!rating || rating < 1 || rating > 5) return res.status(400).json({ error: 'rating doit être entre 1 et 5' });

    // Vérifier que l'utilisateur a bien acheté ce produit
    const order = await Order.findOne({ _id: orderId, userId: req.user.id, status: 'VALIDÉ', 'items.productId': productId });
    if (!order) return res.status(403).json({ error: 'Vous devez avoir acheté ce produit pour laisser un avis' });

    const exists = await Review.findOne({ productId, userId: req.user.id });
    if (exists) return res.status(409).json({ error: 'Avis déjà soumis pour ce produit' });

    const review = await Review.create({ productId, userId: req.user.id, orderId, rating: Number(rating), comment: xss((comment||'').trim()).slice(0,1000) });

    // Recalculer la note moyenne
    const agg = await Review.aggregate([{ $match:{ productId: review.productId } },{ $group:{ _id:null, avg:{ $avg:'$rating' }, count:{ $sum:1 } } }]);
    if (agg.length) await Product.findByIdAndUpdate(productId, { rating: Math.round(agg[0].avg*10)/10, reviewCount: agg[0].count });

    res.status(201).json(review);
  } catch(e) { res.status(500).json({ error: e.message }); }
}

async function getReviews(req, res) {
  try {
    const reviews = await Review.find({ productId: req.params.productId }).populate('userId','name').sort({ createdAt:-1 }).lean();
    res.json({ reviews, count: reviews.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
}

module.exports = { createReview, getReviews };
