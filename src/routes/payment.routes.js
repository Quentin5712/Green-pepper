'use strict';
const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/payment.controller');
const rateLimit = require('express-rate-limit');

const payLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Trop de tentatives de paiement. Réessayez dans 15 minutes.' },
  skip: () => process.env.NODE_ENV !== 'production',
});

router.post('/payment/pay',               payLimiter, ctrl.pay);
router.post('/payment/callback',          ctrl.callback);
router.get('/payment/status/:externalId', ctrl.getStatus);
router.get('/orders',                     ctrl.getOrders);

module.exports = router;
