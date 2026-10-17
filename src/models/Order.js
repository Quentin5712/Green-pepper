'use strict';
const mongoose = require('mongoose');

const OrderSchema = new mongoose.Schema({
  customerPhone:      { type: String, required: true },
  customerName:       { type: String, default: 'Client anonyme' },
  location:           { type: String, default: '' },
  products: [{
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    name:      String,
    price:     Number,
    quantity:  { type: Number, default: 1 },
    sellerId:  String,
  }],
  total:              { type: Number, required: true },
  deliveryFee:        { type: Number, default: 0 },
  status:             { type: String, enum: ['PENDING','VALIDÉ','REFUSÉ'], default: 'PENDING' },
  kpayTransactionId:  { type: String, default: '' },
  externalId:         { type: String, required: true, unique: true },
  provider:           { type: String, enum: ['MTN_MOMO_CMR','ORANGE_CMR'], required: true },
  kpayResponse:       { type: mongoose.Schema.Types.Mixed },
}, { timestamps: true });

OrderSchema.index({ externalId: 1 });
OrderSchema.index({ status: 1, createdAt: -1 });
OrderSchema.index({ customerPhone: 1 });

module.exports = mongoose.model('Order', OrderSchema);
