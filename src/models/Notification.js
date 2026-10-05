'use strict';
const mongoose = require('mongoose');
const { Schema } = mongoose;

const NotificationSchema = new Schema({
  sellerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type:     { type: String, enum: ['order','stock_low','system'], default: 'order' },
  message:  { type: String, required: true, maxlength: 500 },
  orderId:  { type: Schema.Types.ObjectId, ref: 'Order', sparse: true },
  read:     { type: Boolean, default: false },
}, { timestamps: true });

NotificationSchema.index({ sellerId: 1, read: 1 });
NotificationSchema.index({ createdAt: -1 });
// TTL : supprimer les notifs lues après 30 jours
NotificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 3600, partialFilterExpression: { read: true } });

module.exports = mongoose.model('Notification', NotificationSchema);
