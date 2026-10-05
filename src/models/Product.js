'use strict';
const mongoose = require('mongoose');
const { Schema } = mongoose;

// PRODUIT GÉNÉRALISTE — fonctionne pour tout type de produit
// La catégorie est LIBRE (String), pas un enum figé.
const ProductSchema = new Schema({
  name:        { type: String, required: true, trim: true, maxlength: 200 },
  description: { type: String, trim: true, maxlength: 5000 },
  price:       { type: Number, required: true, min: 0 },
  stock:       { type: Number, default: 0, min: 0 },
  stockAlert:  { type: Number, default: 5 },
  category:    { type: String, trim: true, maxlength: 100 },
  city:        { type: String, trim: true },
  sellerId:    { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  images:      [{ url: String, filename: String }],
  whatsapp:    { type: String, trim: true },
  phone:       { type: String, trim: true },
  attributes:  { type: Map, of: String, default: {} },
  rating:      { type: Number, default: 0, min: 0, max: 5 },
  reviewCount: { type: Number, default: 0 },
  likes:       [{ type: String }],
  isActive:    { type: Boolean, default: true },
}, {
  timestamps: true,
  toJSON: { virtuals: true, transform: (doc, ret) => { delete ret.__v; return ret; } }
});

ProductSchema.index({ name: 'text', description: 'text', category: 'text' });
ProductSchema.index({ sellerId: 1, isActive: 1 });
ProductSchema.index({ category: 1, isActive: 1 });
ProductSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Product', ProductSchema);
