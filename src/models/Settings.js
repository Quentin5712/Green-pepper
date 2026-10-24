'use strict';
const mongoose = require('mongoose');
const SettingsSchema = new mongoose.Schema({
  key:   { type: String, unique: true, required: true },
  value: mongoose.Schema.Types.Mixed,
}, { timestamps: true });
module.exports = mongoose.model('Settings', SettingsSchema);
