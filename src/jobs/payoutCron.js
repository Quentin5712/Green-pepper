'use strict';
const wallet = require('../utils/wallet');
const logger = require('../utils/logger');

// Toutes les 5 min : confirme les paiements dont le webhook s'est perdu, relance les versements
// en attente de fonds, signale les versements restés sans confirmation.
function startPayoutCron() {
  async function run() {
    try {
      await wallet.reconcilePending();
      await wallet.retryWaitingPayouts();
      await wallet.flagStuckPayouts();
    } catch (e) { logger.error(`[PayoutCron] ${e.message}`); }
  }
  try { require('node-cron').schedule('*/5 * * * *', run); logger.info('[PayoutCron] node-cron actif (5 min)'); }
  catch (e) { setInterval(run, 5 * 60 * 1000); logger.info('[PayoutCron] setInterval actif (5 min)'); }
}
module.exports = { startPayoutCron };
