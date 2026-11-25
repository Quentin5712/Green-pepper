'use strict';
const mongoose = require('mongoose');
// Nouvelle collection « avis » (l'ancien modèle Review avait un index unique incompatible avec les clients sans compte)
const AvisSchema = new mongoose.Schema({
  orderId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },
  productId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  productName: { type: String, default: '' },
  shopId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Shop', default: null },
  shopName:    { type: String, default: '' },
  vendorId:    { type: String, default: '' },
  firstName:   { type: String, required: true, trim: true, maxlength: 40 },
  lastName:    { type: String, required: true, trim: true, maxlength: 40 },
  location:    { type: String, required: true, trim: true, maxlength: 80 },
  rating:      { type: Number, required: true, min: 1, max: 5 },
  comment:     { type: String, required: true, trim: true, maxlength: 1000 },
  photoUrl:    { type: String, default: '' },
  status:      { type: String, enum: ['PUBLISHED', 'HIDDEN'], default: 'PUBLISHED', index: true },
}, { timestamps: true });
AvisSchema.index({ orderId: 1, productId: 1 }, { unique: true });
AvisSchema.index({ productId: 1, status: 1, createdAt: -1 });
module.exports = mongoose.model('Avis', AvisSchema, 'avis');
