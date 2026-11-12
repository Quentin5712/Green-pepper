'use strict';
const mongoose = require('mongoose');
const crypto   = require('crypto');

const genOrderNumber = () => 'GP-' + new Date().getFullYear() + '-' + crypto.randomBytes(3).toString('hex').toUpperCase();

const OrderSchema = new mongoose.Schema({
  orderNumber:  { type: String, default: genOrderNumber, unique: true },
  userId:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  guestPhone:   { type: String, default: '' },
  customerName: { type: String, default: '' },
  payerPhone:   { type: String, default: '' },
  vendorId:     { type: String, default: '', index: true },          // une commande = un vendeur
  orderType:    { type: String, enum: ['physical', 'digital'], default: 'physical' },
  shopId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Shop' },
  items: [{
    productId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    name:            String,
    qty:             { type: Number, default: 1 },
    priceAtPurchase: Number,
    discountApplied: { type: Number, default: 0 },
    sellerId:        String,
  }],
  amount:       { type: Number, required: true },
  finalAmount:  { type: Number, required: true },
  commission:   { type: Number, default: 0 },
  commissionRate: { type: Number, default: 0 },
  montant_vendeur: { type: Number, default: 0 },
  deliveryFee:  { type: Number, default: 0 },
  address:      { type: String, default: '' },

  // ── Paiement client → KPay ──
  status:       { type: String, enum: ['PENDING','VALIDÉ','REFUSÉ','EXPIRED','NEGOCIATED','LIVRÉ'], default: 'PENDING' },
  externalId:   { type: String, required: true, unique: true },
  kpayId:       { type: String, index: true },                       // le .id renvoyé par KPay : sert à vérifier le paiement
  kpayRef:      { type: String, default: '' },
  kpayTxId:     { type: String, default: '' },
  kpayFee:      { type: Number },                                    // commission KPay (si renvoyée)
  kpayNet:      { type: Number },                                    // net réellement reçu (si renvoyé)
  provider:     { type: String, enum: ['MTN_MOMO_CMR','ORANGE_CMR'], required: true },
  receiverPhone:{ type: String, default: '' },                       // numéro admin au moment de la commande
  trackToken:   { type: String, select: false },                     // secret remis à l'acheteur (suivi sans compte)
  paidAt:       { type: Date },

  // ── Livraison (produits physiques) ──
  deliveryStatus: { type: String, enum: ['NONE','AWAITING','VALIDATED','DISPUTE','REFUND_DUE'], default: 'NONE' },
  photo_livraison:           { type: mongoose.Schema.Types.ObjectId, ref: 'Image', default: null },
  photoUploadedAt:           { type: Date },
  date_validation_livraison: { type: Date },
  shippedAt:                 { type: Date },
  trackingNumber:            { type: String, default: '' },
  validationRequestedAt:     { type: Date },
  disputeReason:             { type: String, default: '' },
  disputeOpenedAt:           { type: Date },

  // ── Versement au vendeur ──
  payoutStatus: { type: String, enum: ['NONE','BLOCKED','READY','PROCESSING','PAID','FAILED','WAITING_FUNDS','UNCERTAIN','BLOCKED_DISPUTE'], default: 'NONE', index: true },
  payoutExternalId: { type: String },                                // PAYOUT-vendeurId-timestamp (unique)
  payoutKpayId:     { type: String, default: '' },
  payoutAttempts:   { type: Number, default: 0 },
  payoutLastError:  { type: String, default: '' },
  payoutPaidAt:     { type: Date },

  kpayResponse: { type: mongoose.Schema.Types.Mixed },
}, { timestamps: true });

OrderSchema.index({ payoutExternalId: 1 }, { unique: true, sparse: true });
OrderSchema.index({ userId: 1, status: 1 });
OrderSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('Order', OrderSchema);
