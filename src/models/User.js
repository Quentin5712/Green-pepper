'use strict';
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

const UserSchema = new mongoose.Schema({
  name:         { type: String, required: true, trim: true, maxlength: 100 },
  email:        { type: String, required: true, unique: true, lowercase: true, trim: true },
  password:     { type: String, required: true, select: false, minlength: 6 },
  phone:        { type: String, trim: true },
  role:         { type: String, enum: ['customer','merchant','admin'], default: 'customer' },
  shopId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Shop', default: null },
  // Auth sécurisée
  tokenVersion: { type: Number, default: 0 },
  // Statut
  isActive:     { type: Boolean, default: true },
  isBanned:     { type: Boolean, default: false },
  banReason:    { type: String, default: '' },
  bannedAt:     { type: Date },
  isDeleted:    { type: Boolean, default: false },
  deletedAt:    { type: Date },
  // Activité temps réel
  isOnline:     { type: Boolean, default: false, index: true },
  lastActive:   { type: Date },
  currentIP:    { type: String, default: '' },
  sessionId:    { type: String, default: '' },
  // KYC
  kycStatus:    { type: String, enum: ['PENDING','VERIFIED'], default: 'PENDING' },
  kycDocUrl:    { type: String, default: '' },
  // Marchand
  storeName:    { type: String, trim: true },
  expiresAt:    { type: Date },
}, {
  timestamps: true,
  toJSON: {
    transform: (doc, ret) => {
      delete ret.password;
      delete ret.__v;
      if (ret.phone) ret.phoneMasked = maskPhone(ret.phone);
      return ret;
    }
  }
});

function maskPhone(p) {
  if (!p || p.length < 9) return '***';
  const s = String(p).replace(/\s/g, '');
  return s.slice(0, 5) + '** **' + ' ' + s.slice(-2);
}

UserSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

UserSchema.methods.comparePassword = function(c) {
  return bcrypt.compare(c, this.password);
};

UserSchema.index({ email: 1 });
UserSchema.index({ isOnline: 1, lastActive: -1 });
UserSchema.index({ isDeleted: 1, role: 1 });

module.exports = mongoose.model('User', UserSchema);
