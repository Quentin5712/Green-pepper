'use strict';
const crypto = require('crypto');

/**
 * Vérifie la signature HMAC-SHA256 du callback de paiement
 * Protège contre les callbacks falsifiés
 */
function verifyReturn(query, gatewaySecret) {
  const { status, reference, externalId = '', ts, sig } = query;

  if (!status || !reference || !ts || !sig) return false;

  const stringToSign = `${status}|${reference}|${externalId}|${ts}`;
  const expected = crypto
    .createHmac('sha256', gatewaySecret)
    .update(stringToSign)
    .digest('hex');

  // Comparaison sécurisée (évite les timing attacks)
  const ok =
    sig.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));

  // Vérifier que le timestamp est récent (< 10 minutes)
  const fresh = Date.now() - Number(ts) < 10 * 60 * 1000;

  return ok && fresh;
}

/**
 * Middleware Express pour protéger les routes de callback
 */
function verifyPaymentMiddleware(req, res, next) {
  const secret = process.env.GATEWAY_SECRET;
  if (!secret) {
    console.warn('⚠️  GATEWAY_SECRET manquant — vérification désactivée');
    return next();
  }
  const query = { ...req.query, ...req.body };
  if (!verifyReturn(query, secret)) {
    console.warn('❌ Signature callback invalide:', JSON.stringify(query));
    return res.status(401).json({ error: 'Signature invalide' });
  }
  next();
}

module.exports = { verifyReturn, verifyPaymentMiddleware };
