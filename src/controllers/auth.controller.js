'use strict';
const jwt    = require('jsonwebtoken');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const User   = require('../models/User');
const logger = require('../utils/logger');

function signTokens(user, sessionId) {
  const tv = user.tokenVersion;
  const access  = jwt.sign({ id: user._id, email: user.email, role: user.role, shopId: user.shopId, tv, sessionId }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const refresh = jwt.sign({ id: user._id, tv, sessionId }, process.env.JWT_REFRESH_SECRET, { expiresIn: '7d' });
  return { access, refresh };
}

function setRefreshCookie(res, token) {
  res.cookie('gp_refresh', token, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge:   7 * 24 * 60 * 60 * 1000,
  });
}

async function register(req, res) {
  try {
    const { name, email, phone, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'name, email et password requis' });
    if (!/^[A-Z]/.test(password)) return res.status(400).json({ error: 'Le mot de passe doit commencer par une majuscule' });
    if (password.length < 6) return res.status(400).json({ error: 'Mot de passe trop court (6 min)' });
    const exists = await User.findOne({ email: email.toLowerCase(), isDeleted: false });
    if (exists) return res.status(409).json({ error: 'Email déjà utilisé' });
    const user = new User({ name, email, phone, password, role: 'customer' });
    await user.save();
    const sessionId = crypto.randomBytes(16).toString('hex');
    const { access, refresh } = signTokens(user, sessionId);
    setRefreshCookie(res, refresh);
    logger.info(`REGISTER: ${email} ip=${req.ip}`);
    return res.status(201).json({ token: access, user: { id: user._id, name: user.name, email: user.email, role: user.role } });
  } catch(e) { logger.error('register:', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
}

async function login(req, res) {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis' });
    const em = email.toLowerCase().trim();
    const user = await User.findOne({ email: em, isDeleted: false }).select('+password');
    if (!user) { logger.warn(`LOGIN FAILED: ${em} ip=${req.ip}`); return res.status(401).json({ error: 'Identifiants incorrects' }); }
    if (user.isBanned) return res.status(403).json({ error: `Compte banni${user.banReason ? ': ' + user.banReason : ''}` });
    const ok = await user.comparePassword(password);
    if (!ok) { logger.warn(`LOGIN FAILED: ${em} ip=${req.ip}`); return res.status(401).json({ error: 'Identifiants incorrects' }); }
    if (user.expiresAt && user.expiresAt < new Date()) return res.status(403).json({ error: 'Compte expiré' });
    const sessionId = crypto.randomBytes(16).toString('hex');
    const { access, refresh } = signTokens(user, sessionId);
    setRefreshCookie(res, refresh);
    await User.findByIdAndUpdate(user._id, { lastActive: new Date(), isOnline: true, currentIP: req.ip || '', sessionId });
    logger.info(`LOGIN: ${em} role=${user.role} ip=${req.ip}`);
    return res.json({ token: access, user: { id: user._id, name: user.name, email: user.email, role: user.role, shopId: user.shopId } });
  } catch(e) { logger.error('login:', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
}

async function logout(req, res) {
  try {
    res.clearCookie('gp_refresh');
    const auth = req.headers.authorization;
    if (auth?.startsWith('Bearer ')) {
      try {
        const p = jwt.verify(auth.slice(7), process.env.JWT_SECRET);
        if (p?.id) await User.findByIdAndUpdate(p.id, { isOnline: false, sessionId: '' });
      } catch(e) {}
    }
    return res.json({ success: true });
  } catch(e) { res.status(500).json({ error: 'Erreur serveur' }); }
}

async function refresh(req, res) {
  try {
    const token = req.cookies?.gp_refresh;
    if (!token) return res.status(401).json({ error: 'Refresh token manquant' });
    let payload;
    try { payload = jwt.verify(token, process.env.JWT_REFRESH_SECRET); }
    catch(e) { return res.status(401).json({ error: 'Session expirée, reconnectez-vous' }); }
    const user = await User.findById(payload.id).select('name email role tokenVersion isBanned isDeleted shopId');
    if (!user || user.isDeleted || user.isBanned) return res.status(403).json({ error: 'Accès refusé' });
    if (user.tokenVersion !== payload.tv) return res.status(401).json({ error: 'Session révoquée' });
    const sessionId = crypto.randomBytes(16).toString('hex');
    const { access, refresh: newRefresh } = signTokens(user, sessionId);
    setRefreshCookie(res, newRefresh);
    return res.json({ token: access });
  } catch(e) { res.status(500).json({ error: 'Erreur serveur' }); }
}

async function me(req, res) {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
    res.json(user);
  } catch(e) { res.status(500).json({ error: 'Erreur serveur' }); }
}

async function deleteMe(req, res) {
  try {
    const uid = req.user.id;
    await User.findByIdAndUpdate(uid, {
      isDeleted: true, deletedAt: new Date(), isOnline: false,
      name: 'Utilisateur supprimé',
      email: `deleted_${uid}_${Date.now()}@anon.gp`,
      phone: '',
      $inc: { tokenVersion: 1 },
    });
    res.clearCookie('gp_refresh');
    res.json({ success: true, message: 'Compte anonymisé (RGPD)' });
  } catch(e) { res.status(500).json({ error: 'Erreur serveur' }); }
}

module.exports = { register, login, logout, refresh, me, deleteMe };
