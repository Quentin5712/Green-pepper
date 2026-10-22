'use strict';
const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
  shopId:        { type: mongoose.Schema.Types.ObjectId, ref: 'Shop', required: true },
  productId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  clientId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  sender:        { type: String, enum: ['client','merchant'], required: true },
  message:       { type: String, required: true, maxlength: 500, trim: true },
  priceProposed: { type: Number, default: 0, min: 0 },
  status:        { type: String, enum: ['PENDING','ACCEPTED','REFUSED'], default: 'PENDING' },
}, { timestamps: true });

MessageSchema.index({ shopId: 1, clientId: 1, createdAt: -1 });

module.exports = mongoose.model('Message', MessageSchema);
