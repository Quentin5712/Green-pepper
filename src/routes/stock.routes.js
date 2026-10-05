'use strict';
const express   = require('express');
const { body, param, query } = require('express-validator');
const rateLimit  = require('express-rate-limit');
const stockSvc   = require('../services/stock.service');
const { ProductVariant, StockMovement } = require('../models/Product');

const router = express.Router();

// Validate helper
const validate = (req, res, next) => {
  const { validationResult } = require('express-validator');
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  next();
};

// Rate limit strict sur les ops de stock
const stockLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, message: { error: 'Trop de requêtes stock' } });

// ══════════════════════════════════════════════
// GET /api/stock/:variantId
// Stock disponible d'un variant
// ══════════════════════════════════════════════
router.get('/:variantId',
  param('variantId').isMongoId(),
  validate,
  async (req, res) => {
    try {
      const data = await stockSvc.getAvailableStock(req.params.variantId);
      res.json(data);
    } catch (e) {
      res.status(404).json({ error: e.message });
    }
  }
);

// ══════════════════════════════════════════════
// GET /api/stock/vendor/:vendorId
// Stock de tous les variants d'un vendeur
// ══════════════════════════════════════════════
router.get('/vendor/:vendorId',
  param('vendorId').notEmpty().isString(),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('lowStockOnly').optional().isBoolean(),
  validate,
  async (req, res) => {
    try {
      const { page = 1, limit = 50, lowStockOnly = false } = req.query;
      const data = await stockSvc.getVendorStock(req.params.vendorId, {
        page: Number(page),
        limit: Number(limit),
        lowStockOnly: lowStockOnly === 'true',
      });
      res.json({ vendorId: req.params.vendorId, count: data.length, variants: data });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

// ══════════════════════════════════════════════
// GET /api/stock/low-stock
// Tous les variants sous le seuil d'alerte (admin)
// ══════════════════════════════════════════════
router.get('/admin/low-stock',
  async (req, res) => {
    try {
      const variants = await ProductVariant.aggregate([
        { $match: { isActive: true } },
        {
          $addFields: {
            stockDisponible: { $subtract: ['$stockPhysique', '$stockReserve'] }
          }
        },
        {
          $match: {
            $expr: { $lte: ['$stockDisponible', '$lowLimit'] }
          }
        },
        {
          $lookup: {
            from: 'products',
            localField: 'productId',
            foreignField: '_id',
            as: 'product'
          }
        },
        { $unwind: { path: '$product', preserveNullAndEmpty: true } },
        {
          $project: {
            sku: 1, vendorId: 1, attributes: 1, price: 1,
            stockPhysique: 1, stockReserve: 1, stockDisponible: 1, lowLimit: 1,
            'product.title': 1, 'product.vendorId': 1,
          }
        },
        { $sort: { stockDisponible: 1 } },
      ]);
      res.json({ count: variants.length, variants });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

// ══════════════════════════════════════════════
// POST /api/stock/reserve
// Réservation panier (atomique)
// ══════════════════════════════════════════════
router.post('/reserve',
  stockLimiter,
  body('variantId').isMongoId(),
  body('quantity').isInt({ min: 1, max: 999 }),
  body('cartId').notEmpty().isString(),
  validate,
  async (req, res) => {
    try {
      const { variantId, quantity, cartId } = req.body;
      const result = await stockSvc.reserveStock(variantId, Number(quantity), cartId);
      res.json({ success: true, ...result });
    } catch (e) {
      res.status(409).json({ error: e.message }); // 409 Conflict = stock insuffisant
    }
  }
);

// ══════════════════════════════════════════════
// POST /api/stock/confirm
// Confirmation commande payée : RESERVE → OUT
// ══════════════════════════════════════════════
router.post('/confirm',
  stockLimiter,
  body('orderId').notEmpty(),
  body('items').isArray({ min: 1 }),
  body('items.*.variantId').isMongoId(),
  body('items.*.quantity').isInt({ min: 1 }),
  validate,
  async (req, res) => {
    try {
      const { orderId, items } = req.body;
      const result = await stockSvc.confirmStock(orderId, items);
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

// ══════════════════════════════════════════════
// POST /api/stock/add
// Marchand ajoute du stock (entrée physique)
// ══════════════════════════════════════════════
router.post('/add',
  stockLimiter,
  body('variantId').isMongoId(),
  body('quantity').isInt({ min: 1, max: 99999 }),
  body('reason').optional().isString().isLength({ max: 300 }),
  validate,
  async (req, res) => {
    try {
      const { variantId, quantity, reason } = req.body;
      const result = await stockSvc.addStock(variantId, Number(quantity), reason);
      res.json({ success: true, ...result });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

// ══════════════════════════════════════════════
// POST /api/stock/adjust
// Correction d'inventaire (admin/marchand)
// ══════════════════════════════════════════════
router.post('/adjust',
  stockLimiter,
  body('variantId').isMongoId(),
  body('newPhysique').isInt({ min: 0 }),
  body('reason').notEmpty().isString(),
  validate,
  async (req, res) => {
    try {
      const { variantId, newPhysique, reason } = req.body;
      const result = await stockSvc.adjustStock(variantId, Number(newPhysique), reason);
      res.json({ success: true, ...result });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

// ══════════════════════════════════════════════
// GET /api/stock/movements/:variantId
// Historique des mouvements
// ══════════════════════════════════════════════
router.get('/movements/:variantId',
  param('variantId').isMongoId(),
  query('limit').optional().isInt({ min: 1, max: 200 }),
  validate,
  async (req, res) => {
    try {
      const limit = Number(req.query.limit) || 50;
      const data = await stockSvc.getMovements(req.params.variantId, limit);
      res.json({ variantId: req.params.variantId, count: data.length, movements: data });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

// ══════════════════════════════════════════════
// POST /api/stock/release-expired (cron manuel)
// ══════════════════════════════════════════════
router.post('/release-expired', async (req, res) => {
  try {
    const result = await stockSvc.releaseExpiredCarts();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
