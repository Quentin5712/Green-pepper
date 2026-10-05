'use strict';
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');
const { Schema } = mongoose;

const UserSchema = new Schema({
  name:     { type: String, required: true, trim: true, maxlength: 100 },
  email:    { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true, minlength: 6, select: false }, // select:false = jamais renvoyé par défaut
  role:     { type: String, enum: ['buyer','seller','admin'], default: 'buyer' },
  phone:    { type: String, trim: true },
  city:     { type: String, trim: true },
  avatar:   { type: String },

  // Infos vendeur (rempli seulement si role=seller)
  storeName:  { type: String, trim: true },
  whatsapp:   { type: String, trim: true },
  storeDesc:  { type: String, trim: true },
  expiresAt:  { type: Date },           // expiration compte vendeur
  isActive:   { type: Boolean, default: true },

  // Notification tokens (optionnel, pour push notifications futures)
  fcmToken:   { type: String, select: false },

  joinedAt:   { type: Date, default: Date.now },
}, {
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform: (doc, ret) => {
      delete ret.password; // Ne jamais exposer le mot de passe
      delete ret.__v;
      return ret;
    }
  }
});

// Hash du mot de passe avant sauvegarde
UserSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// Méthode pour comparer le mot de passe lors du login
UserSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

UserSchema.index({ email: 1 });
UserSchema.index({ role: 1, isActive: 1 });

module.exports = mongoose.model('User', UserSchema);
