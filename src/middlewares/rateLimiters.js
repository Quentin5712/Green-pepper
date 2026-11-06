'use strict';
const rateLimit = require('express-rate-limit');
const isProd    = () => process.env.NODE_ENV === 'production';

const global_ = rateLimit({
  windowMs: 15 * 60 * 1000, max: 600,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Trop de requêtes. Réessayez dans 15 minutes.' },
  skip: req => !isProd() || req.originalUrl.startsWith('/api/images/'),
});

const auth_ = rateLimit({
  windowMs: 15 * 60 * 1000, max: 5, skipSuccessfulRequests: true,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Trop de tentatives. Réessayez dans 15 minutes.' },
  skip: () => !isProd(),
});

const pay_ = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Trop de tentatives de paiement.' },
  skip: () => !isProd(),
});

const upload_ = rateLimit({
  windowMs: 60 * 60 * 1000, max: 60,
  standardHeaders: true, legacyHeaders: false,
  message: { error: "Trop d'envois de photos. Réessayez dans une heure." },
  skip: () => !isProd(),
});

module.exports = { global: global_, auth: auth_, pay: pay_, upload: upload_ };
