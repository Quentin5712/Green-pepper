'use strict';
const Notification = require('../models/Notification');
const logger       = require('./logger');

async function notifyUser(userId, role, message, type = 'SYSTEM', refId = '') {
  try {
    await Notification.create({ userId, role, message, type, refId });
  } catch(e) { logger.error('notifyUser:', e.message); }
}

async function notifyAdmin(adminId, message, type = 'SYSTEM') {
  await notifyUser(adminId, 'admin', message, type);
}

async function notifyMerchant(merchantId, message, type = 'ORDER') {
  await notifyUser(merchantId, 'merchant', message, type);
}

module.exports = { notifyUser, notifyAdmin, notifyMerchant };
