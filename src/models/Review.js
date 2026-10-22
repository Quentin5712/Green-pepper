'use strict';
const mongoose = require('mongoose');

const ReviewSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  orderId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },
  rating:    { type: Number, required: true, min: 1, max: 5 },
  comment:   { type: String, trim: true, maxlength: 1000, default: '' },
}, { timestamps: true });

ReviewSchema.index({ productId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('Review', ReviewSchema);
