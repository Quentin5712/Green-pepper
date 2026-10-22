'use strict';
const Product = require('../models/Product');
const logger  = require('../utils/logger');

function startDiscountExpiryCron() {
  async function run() {
    try {
      const now = new Date();
      const r = await Product.updateMany(
        { discount: { $gt: 0 }, discountExpiresAt: { $lt: now }, isDeleted: false },
        { $set: { discount: 0, discountExpiresAt: null }, $unset: { originalPrice: '' } }
      );
      if (r.modifiedCount > 0) logger.info(`[DiscountCron] ${r.modifiedCount} réduction(s) expirée(s) supprimées`);
    } catch(e) { logger.error('[DiscountCron]', e.message); }
  }
  try {
    const cron = require('node-cron');
    cron.schedule('*/5 * * * *', run);
  } catch(e) {
    setInterval(run, 5 * 60 * 1000);
  }
  run();
}

module.exports = { startDiscountExpiryCron };
