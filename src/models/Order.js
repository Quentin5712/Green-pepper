'use strict';
const mongoose = require('mongoose');

function genOrderNumber() {
  return 'GP-' + new Date().getFullYear() + '-' + String(Math.floor(Math.random()*9000)+1000);
}

const OrderSchema = new mongoose.Schema({
  orderNumber:   { type: String, default: genOrderNumber, unique: true },
  userId:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  guestPhone:    { type: String, default: '' },
  shopId:        { type: mongoose.Schema.Types.ObjectId, ref: 'Shop' },
  items: [{
    productId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    name:            String,
    qty:             { type: Number, default: 1 },
    priceAtPurchase: Number,
    discountApplied: { type: Number, default: 0 },
    sellerId:        String,
  }],
  amount:        { type: Number, required: true },
  finalAmount:   { type: Number, required: true },
  commission:    { type: Number, default: 0 },
  deliveryFee:   { type: Number, default: 0 },
  address:       { type: String, default: '' },
  status:        { type: String, enum: ['PENDING','VALIDÉ','REFUSÉ','EXPIRED','NEGOCIATED','LIVRÉ'], default: 'PENDING' },
  externalId:    { type: String, required: true, unique: true },
  provider:      { type: String, enum: ['MTN_MOMO_CMR','ORANGE_CMR'], required: true },
  kpayTxId:      { type: String, default: '' },
  trackingNumber:{ type: String, default: '' },
  kpayResponse:  { type: mongoose.Schema.Types.Mixed },
}, { timestamps: true });

OrderSchema.index({ externalId: 1 });
OrderSchema.index({ userId: 1, status: 1 });
OrderSchema.index({ shopId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('Order', OrderSchema);
