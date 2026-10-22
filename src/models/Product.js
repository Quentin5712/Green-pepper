'use strict';
const mongoose = require('mongoose');

const ProductSchema = new mongoose.Schema({
  name:          { type: String, required: true, trim: true, maxlength: 200 },
  description:   { type: String, trim: true, maxlength: 2000, default: '' },
  price:         { type: Number, required: true, min: 0 },
  originalPrice: { type: Number, default: null },
  stock:         { type: Number, default: 0, min: 0 },
  reserved:      { type: Number, default: 0, min: 0 },
  category:      { type: String, trim: true, default: 'Divers' },
  unit:          { type: String, default: 'unité' },
  sellerId:      { type: String, required: true },
  shopId:        { type: mongoose.Schema.Types.ObjectId, ref: 'Shop', default: null },
  imageUrl:      { type: String, default: '' },
  rating:        { type: Number, default: 4.5, min: 0, max: 5 },
  reviewCount:   { type: Number, default: 0 },
  isActive:      { type: Boolean, default: true },
  isDeleted:     { type: Boolean, default: false },
  // Réduction
  discount:      { type: Number, default: 0, min: 0, max: 90 },
  discountExpiresAt: { type: Date, default: null },
}, { timestamps: true, toJSON: { virtuals: true } });

ProductSchema.virtual('finalPrice').get(function() {
  if (this.discount > 0 && this.discountExpiresAt && this.discountExpiresAt > new Date()) {
    return Math.round(this.price * (1 - this.discount / 100));
  }
  return this.price;
});

ProductSchema.virtual('stockAvailable').get(function() {
  return Math.max(0, this.stock - this.reserved);
});

ProductSchema.index({ sellerId: 1, isActive: 1, isDeleted: 1 });
ProductSchema.index({ category: 1, isActive: 1 });
ProductSchema.index({ name: 'text', description: 'text' });
ProductSchema.index({ shopId: 1, isActive: 1 });

module.exports = mongoose.model('Product', ProductSchema);
