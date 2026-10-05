'use strict';
const mongoose = require('mongoose');
const { Schema } = mongoose;

const OrderItemSchema = new Schema({
  productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  name:      { type: String, required: true },
  quantity:  { type: Number, required: true, min: 1 },
  price:     { type: Number, required: true },
  sellerId:  { type: Schema.Types.ObjectId, ref: 'User' },
}, { _id: true });

const OrderSchema = new Schema({
  buyerId:        { type: Schema.Types.ObjectId, ref: 'User', index: true },
  clientName:     { type: String, trim: true },   // pour commandes sans compte
  clientPhone:    { type: String, trim: true },
  products:       [OrderItemSchema],
  total:          { type: Number, required: true, min: 0 },
  deliveryFee:    { type: Number, default: 0 },
  status:         {
    type: String,
    enum: ['pending_payment','paid','processing','shipped','delivered','cancelled','refunded'],
    default: 'pending_payment',
  },
  shippingAddress: {
    location: String,
    city:     String,
    details:  String,
  },
  paymentStatus:  { type: String, enum: ['pending','paid','failed','refunded'], default: 'pending' },
  paymentMethod:  { type: String, enum: ['mtn_momo','orange_money','cash'], default: 'mtn_momo' },
  momoReference:  { type: String, index: true, sparse: true },
  momoTxId:       { type: String },
  paidAt:         { type: Date },
}, {
  timestamps: true,
  toJSON: { virtuals: true, transform: (doc, ret) => { delete ret.__v; return ret; } }
});

OrderSchema.index({ buyerId: 1, createdAt: -1 });
OrderSchema.index({ 'products.sellerId': 1 });
OrderSchema.index({ status: 1 });
OrderSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Order', OrderSchema);
