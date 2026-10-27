'use strict';
const Order  = require('../models/Order');
const Product= require('../models/Product');
const TransactionLog = require('../models/TransactionLog');
const User   = require('../models/User');

async function getStats(req, res) {
  try {
    const shopId   = req.user.shopId;
    const sellerId = req.user.id;
    const today    = new Date(); today.setHours(0,0,0,0);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

    const [caToday, caMonth, ordersPending, lowStock, onlineClients] = await Promise.all([
      Order.aggregate([{ $match:{ 'items.sellerId':sellerId, status:'VALIDÉ', createdAt:{ $gte:today } } },{ $group:{ _id:null, total:{ $sum:'$finalAmount' } } }]),
      Order.aggregate([{ $match:{ 'items.sellerId':sellerId, status:'VALIDÉ', createdAt:{ $gte:monthStart } } },{ $group:{ _id:null, total:{ $sum:'$finalAmount' } } }]),
      Order.countDocuments({ 'items.sellerId':sellerId, status:'PENDING' }),
      Product.countDocuments({ sellerId, stock:{ $lt:5 }, isDeleted:false }),
      User.countDocuments({ isOnline:true, isDeleted:false }),
    ]);

    res.json({
      caToday:  caToday[0]?.total || 0,
      caMonth:  caMonth[0]?.total || 0,
      ordersPending,
      lowStock,
      onlineClients,
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
}

async function getJournalCsv(req, res) {
  try {
    const logs = await TransactionLog.find({ $or: [{ shopId: req.user.shopId }, { 'order.sellerId': req.user.id }] }).sort({ date:-1 }).lean();
    const head = 'date;orderId;externalId;amount;finalAmount;commission;status';
    const body = logs.map(l => [new Date(l.date).toLocaleString('fr-FR'),l.orderId,l.externalId,l.amount,l.finalAmount,l.commission,l.status].join(';'));
    res.setHeader('Content-Type','text/csv;charset=utf-8');
    res.setHeader('Content-Disposition','attachment;filename=journal_marchand.csv');
    res.send([head,...body].join('\n'));
  } catch(e) { res.status(500).json({ error: e.message }); }
}

module.exports = { getStats, getJournalCsv };
