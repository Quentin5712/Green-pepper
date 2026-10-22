'use strict';
const mongoose = require('mongoose');

const CartSchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  qty:       { type: Number, required: true, min: 1, max: 10 },
  priceAtAdd:{ type: Number, required: true },
  shopId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Shop' },
  expiresAt: { type: Date, default: () => new Date(Date.now() + 60000) },
}, { timestamps: true });

// TTL : MongoDB supprime l'entrée à expiresAt automatiquement
CartSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
CartSchema.index({ userId: 1 });

module.exports = mongoose.model('Cart', CartSchema);
