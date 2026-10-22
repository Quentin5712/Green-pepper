'use strict';
const mongoose = require('mongoose');

const NotificationSchema = new mongoose.Schema({
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  role:     { type: String, enum: ['customer','merchant','admin'], default: 'customer' },
  message:  { type: String, required: true, maxlength: 500 },
  type:     { type: String, enum: ['ORDER','PAYMENT','STOCK','CHAT','SYSTEM'], default: 'SYSTEM' },
  isRead:   { type: Boolean, default: false },
  refId:    { type: String, default: '' },
}, { timestamps: true });

NotificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });
NotificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 3600 });

module.exports = mongoose.model('Notification', NotificationSchema);
