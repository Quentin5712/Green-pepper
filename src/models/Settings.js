'use strict';
const mongoose = require('mongoose');

// Un seul document (key = 'main') : les réglages modifiables SANS redéployer.
// La valeur en base prime ; le .env (ADMIN_PHONE / KPAY_MERCHANT_NUMBER) ne sert que de repli.
const SettingsSchema = new mongoose.Schema({
  key:                { type: String, default: 'main', unique: true },
  adminPhone:         { type: String, default: '' },   // 237 + 9 chiffres
  kpayMerchantNumber: { type: String, default: '' },   // idem (alternative)
  updatedBy:          { type: String, default: '' },
}, { timestamps: true });                               // createdAt + updatedAt automatiques

SettingsSchema.statics.getMain = function () { return this.findOne({ key: 'main' }).lean(); };

module.exports = mongoose.model('Settings', SettingsSchema);
