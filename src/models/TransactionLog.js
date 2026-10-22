'use strict';
const mongoose = require('mongoose');

// Ledger immuable — pas de update/delete
const TxSchema = new mongoose.Schema({
  shopId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Shop' },
  orderId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
  externalId:  { type: String },
  amount:      { type: Number, required: true },
  finalAmount: { type: Number, required: true },
  commission:  { type: Number, default: 0 },
  status:      { type: String, enum: ['PENDING','VALIDÉ','REFUSÉ','EXPIRED','NEGOCIATED'], required: true },
  provider:    { type: String },
  ip:          { type: String },
  date:        { type: Date, default: Date.now },
}, { timestamps: false });

TxSchema.index({ shopId: 1, date: -1 });
TxSchema.index({ orderId: 1 });

module.exports = mongoose.model('TransactionLog', TxSchema);
