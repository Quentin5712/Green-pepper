'use strict';
const mongoose = require('mongoose');

const ShopSchema = new mongoose.Schema({
  name:      { type: String, required: true, trim: true },
  ownerId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  description:{ type: String, trim: true, maxlength: 2000, default: '' },
  category:  { type: String, default: 'Général' },
  logoUrl:   { type: String, default: '' },
  city:      { type: String, default: '' },
  phone:     { type: String, default: '' },
  isActive:  { type: Boolean, default: true },
  isDeleted: { type: Boolean, default: false },
  kycStatus: { type: String, enum: ['PENDING','VERIFIED'], default: 'PENDING' },
  rating:    { type: Number, default: 0 },
  reviewCount:{ type: Number, default: 0 },
}, { timestamps: true });

ShopSchema.index({ ownerId: 1 });
ShopSchema.index({ name: 'text', description: 'text' });

module.exports = mongoose.model('Shop', ShopSchema);
