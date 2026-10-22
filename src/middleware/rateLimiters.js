'use strict';
const rateLimit = require('express-rate-limit');
const isProd    = () => process.env.NODE_ENV === 'production';

const global_ = rateLimit({
  windowMs: 15 * 60 * 1000, max: 100,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Trop de requêtes. Réessayez dans 15 minutes.' },
  skip: () => !isProd(),
});

const auth_ = rateLimit({
  windowMs: 15 * 60 * 1000, max: 5,
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

module.exports = { global: global_, auth: auth_, pay: pay_ };
