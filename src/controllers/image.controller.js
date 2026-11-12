'use strict';
const Image  = require('../models/Image');
const logger = require('../utils/logger');

// On ne fait pas confiance au type annoncé : on lit les premiers octets du fichier
function detectMime(b) {
  if (!b || b.length < 12) return null;
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'image/jpeg';
  if (b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) return 'image/png';
  if (b.slice(0, 4).toString('ascii') === 'RIFF' && b.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

// POST /api/upload  (marchand ou admin)
async function create(req, res) {
  try {
    if (!req.file) return res.status(400).json({ error: 'Aucune photo reçue' });
    const mime = detectMime(req.file.buffer);
    if (!mime) return res.status(400).json({ error: 'Fichier invalide : ce n\'est pas une image JPG, PNG ou WebP' });
    const owner = String(req.user.id);
    if ((await Image.countDocuments({ ownerId: owner })) >= 300) return res.status(429).json({ error: 'Quota de photos atteint (300)' });
    const img = await Image.create({ data: req.file.buffer, mime, size: req.file.size, ownerId: owner });
    logger.info(`IMAGE: ${img._id} ${mime} ${req.file.size}o par ${owner}`);
    res.status(201).json({ url: `/api/images/${img._id}` });
  } catch(e) { logger.error('image.create:', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
}

// GET /api/images/:id  (public — c'est la vitrine qui l'affiche)
async function get(req, res) {
  try {
    if (!/^[a-f0-9]{24}$/.test(req.params.id)) return res.status(404).end();
    const img = await Image.findById(req.params.id);
    if (!img || (img.kind && img.kind !== 'product')) return res.status(404).end();   // les photos de livraison ne sont JAMAIS publiques
    res.set({
      'Content-Type': img.mime,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
      'Content-Disposition': 'inline',
    });
    res.send(img.data);
  } catch(e) { res.status(404).end(); }
}

module.exports = { create, get, detectMime };
