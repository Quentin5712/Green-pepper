'use strict';
const jwt  = require('jsonwebtoken');
const User = require('../models/User');

async function verifyToken(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Token manquant' });
  const token = auth.slice(7);
  let payload;
  try { payload = jwt.verify(token, process.env.JWT_SECRET); }
  catch(e) { return res.status(401).json({ error: 'Token expiré ou invalide' }); }
  const user = await User.findById(payload.id).select('tokenVersion isBanned isDeleted role shopId');
  if (!user || user.isDeleted)        return res.status(401).json({ error: 'Utilisateur introuvable' });
  if (user.isBanned)                  return res.status(403).json({ error: 'Compte banni' });
  if (user.tokenVersion !== payload.tv) return res.status(401).json({ error: 'Session révoquée. Reconnectez-vous.' });
  req.user = { id: String(payload.id), role: user.role, shopId: user.shopId, email: payload.email, isImpersonated: payload.isImpersonated || false };
  next();
}

async function verifyAdmin(req, res, next) {
  await verifyToken(req, res, () => {
    if (req.user.role !== 'admin' || req.user.isImpersonated) return res.status(403).json({ error: 'Accès admin uniquement' });
    next();
  });
}

async function verifyMerchant(req, res, next) {
  await verifyToken(req, res, () => {
    if (req.user.role !== 'merchant' && req.user.role !== 'admin') return res.status(403).json({ error: 'Accès marchand requis' });
    next();
  });
}

function optionalAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return next();
  const token = auth.slice(7);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: String(payload.id), role: payload.role, shopId: payload.shopId, isImpersonated: payload.isImpersonated || false };
  } catch(e) {}
  next();
}

module.exports = { verifyToken, verifyAdmin, verifyMerchant, optionalAuth };
