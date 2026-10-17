'use strict';
const mongoose = require('mongoose');

const ProductSchema = new mongoose.Schema({
  name:        { type: String, required: true, trim: true, maxlength: 200 },
  price:       { type: Number, required: true, min: 0 },
  image:       { type: String, default: '' },
  stock:       { type: Number, default: 0, min: 0 },
  category:    { type: String, trim: true, default: 'Divers' },
  sellerId:    { type: String, required: true },
  description: { type: String, trim: true, maxlength: 2000, default: '' },
  rating:      { type: Number, default: 4.5, min: 0, max: 5 },
  reviewCount: { type: Number, default: 0 },
  isActive:    { type: Boolean, default: true },
  unit:        { type: String, default: 'unité' }, // ex: "kg", "litre", "bouteille"
}, { timestamps: true, toJSON: { virtuals: true } });

ProductSchema.index({ sellerId: 1, isActive: 1 });
ProductSchema.index({ category: 1, isActive: 1 });
ProductSchema.index({ name: 'text', description: 'text', category: 'text' });

module.exports = mongoose.model('Product', ProductSchema);
