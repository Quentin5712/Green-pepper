'use strict';
const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/product.controller');
const { param, body } = require('express-validator');
const { validationResult } = require('express-validator');

const validate = (req, res, next) => {
  const e = validationResult(req);
  if (!e.isEmpty()) return res.status(400).json({ errors: e.array() });
  next();
};

router.get('/',        ctrl.getAll);
router.get('/seed',    ctrl.seed);
router.get('/:id',     param('id').isMongoId(), validate, ctrl.getOne);
router.post('/',       body('name').notEmpty(), body('price').isNumeric(), body('sellerId').notEmpty(), validate, ctrl.create);
router.put('/:id',     param('id').isMongoId(), validate, ctrl.update);
router.delete('/:id',  param('id').isMongoId(), validate, ctrl.remove);

module.exports = router;
