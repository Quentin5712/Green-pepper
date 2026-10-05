'use strict';
const mongoose = require('mongoose');
const { Schema } = mongoose;

// Liens d'invitation générés par l'admin pour les commerçants
const MerchantLinkSchema = new Schema({
  token:     { type: String, unique: true, required: true },
  days:      { type: Number, default: 30 },
  usedBy:    { type: String, default: null },
  usedAt:    { type: Date },
  createdBy: { type: String, default: 'admin' },
}, { timestamps: true });

module.exports = mongoose.model('MerchantLink', MerchantLinkSchema);
