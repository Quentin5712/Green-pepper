'use strict';
const mongoose = require('mongoose');

const AuditSchema = new mongoose.Schema({
  adminId:   { type: String, required: true },
  action:    { type: String, required: true },
  targetId:  { type: String, default: '' },
  details:   { type: mongoose.Schema.Types.Mixed },
  ip:        { type: String },
  date:      { type: Date, default: Date.now },
}, { timestamps: false });

AuditSchema.index({ adminId: 1, date: -1 });
AuditSchema.index({ action: 1 });

module.exports = mongoose.model('AuditLog', AuditSchema);
