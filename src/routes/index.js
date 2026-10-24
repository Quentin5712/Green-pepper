'use strict';
const express  = require('express');
const router   = express.Router();
const { verifyToken, verifyAdmin, verifyMerchant, optionalAuth } = require('../middlewares/auth');
const limits   = require('../middlewares/rateLimiters');
const upload   = require('../middlewares/upload');

const authCtrl    = require('../controllers/auth.controller');
const adminCtrl   = require('../controllers/admin.controller');
const productCtrl = require('../controllers/product.controller');
const payCtrl     = require('../controllers/payment.controller');
const cartCtrl    = require('../controllers/cart.controller');
const chatCtrl    = require('../controllers/chat.controller');
const reviewCtrl  = require('../controllers/review.controller');
const merchantCtrl= require('../controllers/merchant.controller');
const notifCtrl   = require('../controllers/notification.controller');
const shopCtrl    = require('../controllers/shop.controller');

// ── AUTH ──
router.post('/auth/register', limits.auth, authCtrl.register);
router.post('/auth/login',    limits.auth, authCtrl.login);
router.post('/auth/logout',   authCtrl.logout);
router.post('/auth/refresh',  authCtrl.refresh);
router.get ('/auth/me',       verifyToken, authCtrl.me);
router.delete('/auth/me',     verifyToken, authCtrl.deleteMe);

// ── PRODUCTS (public) ──
router.get ('/products',             optionalAuth, productCtrl.getAll);
router.get ('/products/seed',        productCtrl.seed);
router.get ('/products/:id',         productCtrl.getOne);
router.post('/products',             verifyToken, productCtrl.create);
router.put ('/products/:id',         verifyToken, productCtrl.update);
router.delete('/products/:id',       verifyToken, productCtrl.remove);
router.post('/products/:id/stock/add', verifyToken, productCtrl.addStock);

// ── SHOPS ──
router.get ('/shops',     shopCtrl.getAll);
router.get ('/shops/:id', shopCtrl.getOne);
router.post('/shops',     verifyToken, shopCtrl.create);
router.put ('/shops/:id', verifyToken, shopCtrl.update);

// ── CART ──
router.post  ('/cart/add',        verifyToken, cartCtrl.addToCart);
router.get   ('/cart',            verifyToken, cartCtrl.getCart);
router.delete('/cart/:productId', verifyToken, cartCtrl.removeFromCart);
router.delete('/cart',            verifyToken, cartCtrl.clearCart);

// ── PAYMENT ──
router.post('/payment/pay',                  limits.pay, optionalAuth, payCtrl.pay);
router.post('/payment/callback',             payCtrl.callback);
router.get ('/payment/status/:externalId',   payCtrl.getStatus);

// ── ORDERS ──
router.get('/orders',              verifyToken, payCtrl.getOrders);
router.get('/orders/:id/invoice',  verifyToken, payCtrl.getInvoice);
router.put('/orders/:id/status',   verifyToken, payCtrl.updateOrderStatus);

// ── CHAT ──
router.post('/chat/send',          verifyToken, chatCtrl.sendMessage);
router.get ('/chat/:shopId',       verifyToken, chatCtrl.getChat);
router.put ('/chat/:id/respond',   verifyToken, chatCtrl.respondMessage);

// ── REVIEWS ──
router.post('/reviews/:productId', verifyToken, reviewCtrl.createReview);
router.get ('/reviews/:productId', reviewCtrl.getReviews);

// ── NOTIFICATIONS ──
router.get('/notifications',       verifyToken, notifCtrl.getNotifications);
router.put('/notifications/read',  verifyToken, notifCtrl.markRead);

// ── MERCHANT ──
router.get('/merchant/stats',   verifyMerchant, merchantCtrl.getStats);
router.get('/merchant/journal', verifyMerchant, merchantCtrl.getJournalCsv);

// ── ADMIN — Auth ──
router.post('/admin/login',          limits.auth, adminCtrl.adminLogin);
router.post('/admin/login-as-shop',  limits.auth, adminCtrl.loginAsShop);

// ── ADMIN — Stats & Dashboard ──
router.get('/admin/stats',           verifyAdmin, adminCtrl.getStats);

// ── ADMIN — Utilisateurs ──
router.get   ('/admin/users',                   verifyAdmin, adminCtrl.getUsers);
router.get   ('/admin/users/online',            verifyAdmin, adminCtrl.getOnlineUsers);
router.get   ('/admin/users/:id/activity',      verifyAdmin, adminCtrl.getUserActivity);
router.get   ('/admin/users/:id/phone',         verifyAdmin, adminCtrl.revealPhone);
router.put   ('/admin/users/:id/ban',           verifyAdmin, adminCtrl.banUser);
router.delete('/admin/users/:id',               verifyAdmin, adminCtrl.deleteUser);

// ── ADMIN — Produits ──
router.put   ('/admin/products/:id/discount',   verifyAdmin, adminCtrl.setDiscount);
router.delete('/admin/products/:id/discount',   verifyAdmin, adminCtrl.removeDiscount);

// ── ADMIN — Boutiques ──
router.get   ('/admin/shops',                   verifyAdmin, adminCtrl.getShops);
router.put   ('/admin/shops/:id/kyc',           verifyAdmin, adminCtrl.verifyShopKyc);
router.delete('/admin/shops/:id',               verifyAdmin, adminCtrl.deleteShop);

// ── ADMIN — Commandes ──
router.get('/admin/orders',                     verifyAdmin, adminCtrl.getOrders);

// ── ADMIN — Audit & Journal ──
router.get('/admin/audit',                      verifyAdmin, adminCtrl.getAudit);
router.get('/admin/journal',                    verifyAdmin, adminCtrl.getJournalCsv);

// ── ADMIN — Paramètres ──
router.get('/admin/settings',                   verifyAdmin, adminCtrl.getSettings);
router.put('/admin/settings',                   verifyAdmin, adminCtrl.updateSettings);

// ── UPLOAD ──
router.post('/upload', verifyToken, upload, (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu' });
  res.json({ url: `/uploads/${req.file.filename}` });
});

module.exports = router;
