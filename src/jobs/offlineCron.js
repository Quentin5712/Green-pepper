'use strict';
const User   = require('../models/User');
const logger = require('../utils/logger');

function startOfflineCron() {
  const INACTIVE_MS = 5 * 60 * 1000;
  async function run() {
    try {
      // Passer les users inactifs hors ligne
      const cutoff = new Date(Date.now() - INACTIVE_MS);
      const r = await User.updateMany({ isOnline: true, lastActive: { $lt: cutoff }, isDeleted: false }, { $set: { isOnline: false } });
      if (r.modifiedCount > 0) logger.info(`[OfflineCron] ${r.modifiedCount} user(s) passés hors ligne`);

      // Libérer le stock des carts expirés (MongoDB TTL supprime le doc mais pas le stock)
      const Product = require('../models/Product');
      const Cart    = require('../models/Cart');
      const expiredCarts = await Cart.find({ expiresAt: { $lt: new Date() } }).lean();
      for (const cart of expiredCarts) {
        await Product.findByIdAndUpdate(cart.productId, { $inc: { stock: cart.qty, reserved: -cart.qty } });
        await Cart.findByIdAndDelete(cart._id);
      }
      if (expiredCarts.length > 0) logger.info(`[OfflineCron] ${expiredCarts.length} cart(s) expirés libérés`);
    } catch(e) { logger.error('[OfflineCron]', e.message); }
  }
  try {
    const cron = require('node-cron');
    cron.schedule('*/2 * * * *', run);
    logger.info('[OfflineCron] node-cron actif (2 min)');
  } catch(e) {
    setInterval(run, 2 * 60 * 1000);
    logger.info('[OfflineCron] setInterval actif (2 min)');
  }
  run();
}

module.exports = { startOfflineCron };
