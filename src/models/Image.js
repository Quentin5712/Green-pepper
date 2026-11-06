'use strict';
const mongoose = require('mongoose');
// Les photos sont stockées en base : le disque de Render est effacé à chaque redéploiement.
const ImageSchema = new mongoose.Schema({
  data:    { type: Buffer, required: true },
  mime:    { type: String, enum: ['image/jpeg','image/png','image/webp'], required: true },
  size:    { type: Number, required: true },
  ownerId: { type: String, required: true, index: true },
}, { timestamps: true });
module.exports = mongoose.model('Image', ImageSchema);
