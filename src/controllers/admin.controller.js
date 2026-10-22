'use strict';
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const User     = require('../models/User');
const Product  = require('../models/Product');
const Order    = require('../models/Order');
const Shop     = require('../models/Shop');
const AuditLog = require('../models/AuditLog');
const TransactionLog = require('../models/TransactionLog');
const Cart     = require('../models/Cart');
const Message  = require('../models/Message');
const logger   = require('../utils/logger');
const { createObjectCsvStringifier } = require('csv-writer');

// ── Connexion admin spéciale (quentin/oceane) ──
async function adminLogin(req, res) {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'username et password requis' });
    if (username !== process.env.ADMIN_USER) {
      logger.warn(`ADMIN LOGIN FAILED: username=${username} ip=${req.ip}`);
      return res.status(401).json({ error: 'Identifiants admin incorrects' });
    }
    const ok = await bcrypt.compare(password, process.env.ADMIN_PASS_HASH);
    if (!ok) {
      logger.warn(`ADMIN LOGIN FAILED: username=${username} ip=${req.ip}`);
      return res.status(401).json({ error: 'Identifiants admin incorrects' });
    }
    // Trouver ou créer l'admin en DB
    let admin = await User.findOne({ role: 'admin', isDeleted: false });
    if (!admin) {
      admin = new User({ name: 'Admin', email: `${username}@greenpeppermarket.cm`, password: password, role: 'admin' });
      await admin.save();
    }
    const token = jwt.sign({ id: admin._id, email: admin.email, role: 'admin', tv: admin.tokenVersion }, process.env.JWT_SECRET, { expiresIn: '8h' });
    await User.findByIdAndUpdate(admin._id, { lastActive: new Date(), isOnline: true, currentIP: req.ip || '' });
    logger.info(`ADMIN LOGIN: ${username} ip=${req.ip}`);
    return res.json({ token, user: { id: admin._id, name: admin.name, role: 'admin' } });
  } catch(e) { logger.error('adminLogin:', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
}

// ── Impersonate marchand ──
async function loginAsShop(req, res) {
  try {
    const { adminLogin: adminUser, adminPassword, merchantEmail } = req.body;
    if (!adminUser || !adminPassword || !merchantEmail) return res.status(400).json({ error: 'adminLogin, adminPassword et merchantEmail requis' });
    if (adminUser !== process.env.ADMIN_USER) return res.status(401).json({ error: 'Identifiants admin incorrects' });
    const ok = await bcrypt.compare(adminPassword, process.env.ADMIN_PASS_HASH);
    if (!ok) return res.status(401).json({ error: 'Identifiants admin incorrects' });
    const merchant = await User.findOne({ email: merchantEmail.toLowerCase(), role: 'merchant', isDeleted: false });
    if (!merchant) return res.status(404).json({ error: 'Marchand introuvable' });
    const token = jwt.sign({
      id: merchant._id, email: merchant.email, role: 'merchant',
      shopId: merchant.shopId, tv: merchant.tokenVersion,
      isImpersonated: true, impersonatedBy: adminUser,
    }, process.env.JWT_SECRET, { expiresIn: '1h' });
    // AuditLog
    const admin = await User.findOne({ role: 'admin', isDeleted: false });
    await AuditLog.create({ adminId: adminUser, action: 'ADMIN_IMPERSONATE_SHOP', targetId: String(merchant._id), details: { merchantEmail, shopId: merchant.shopId }, ip: req.ip });
    logger.info(`IMPERSONATE: ${adminUser} → ${merchantEmail} ip=${req.ip}`);
    return res.json({ token, shopId: merchant.shopId, merchantName: merchant.name, message: `Connecté comme ${merchant.name}` });
  } catch(e) { logger.error('loginAsShop:', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
}

// ── Users ──
async function getUsers(req, res) {
  try {
    const { page = 1, limit = 50, role, search } = req.query;
    const filter = { isDeleted: false };
    if (role) filter.role = role;
    if (search) filter.$or = [{ name: new RegExp(search, 'i') }, { email: new RegExp(search, 'i') }];
    const [users, total] = await Promise.all([
      User.find(filter).select('-password').sort({ createdAt: -1 }).skip((Number(page)-1)*Number(limit)).limit(Number(limit)).lean(),
      User.countDocuments(filter),
    ]);
    res.json({ users, total, page: Number(page) });
  } catch(e) { res.status(500).json({ error: e.message }); }
}

async function getOnlineUsers(req, res) {
  try {
    const users = await User.find({ isOnline: true, isDeleted: false })
      .select('-password')
      .sort({ lastActive: -1 })
      .lean();

    const result = await Promise.all(users.map(async u => {
      const [cart, order] = await Promise.all([
        Cart.find({ userId: u._id }).populate('productId', 'name price').lean(),
        Order.findOne({ userId: u._id, status: { $in: ['PENDING','NEGOCIATED'] } }).sort({ createdAt: -1 }).lean(),
      ]);
      return {
        ...u,
        phone:    undefined,
        phoneMasked: maskPhone(u.phone),
        currentIP: u.currentIP,
        cart,
        currentOrder: order,
      };
    }));

    res.json({ users: result, count: result.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
}

function maskPhone(p) {
  if (!p || p.length < 9) return '***';
  const s = String(p).replace(/\s/g, '');
  return s.slice(0,5) + '** **' + ' ' + s.slice(-2);
}

async function getUserActivity(req, res) {
  try {
    const { id } = req.params;
    const [txLogs, messages, cart] = await Promise.all([
      TransactionLog.find({ $or: [{ 'order.userId': id }] }).sort({ date: -1 }).limit(50).lean(),
      Message.find({ clientId: id }).sort({ createdAt: -1 }).limit(50).lean(),
      Cart.find({ userId: id }).populate('productId', 'name price').lean(),
    ]);
    res.json({ txLogs, messages, cart });
  } catch(e) { res.status(500).json({ error: e.message }); }
}

async function banUser(req, res) {
  try {
    const { id } = req.params;
    const { isBanned, banReason } = req.body;
    const update = { isBanned, banReason: banReason || '', $inc: { tokenVersion: 1 } };
    if (isBanned) update.isOnline = false;
    const user = await User.findByIdAndUpdate(id, update, { new: true }).select('-password');
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
    await AuditLog.create({ adminId: req.user.id, action: isBanned ? 'BAN_USER' : 'UNBAN_USER', targetId: id, details: { banReason }, ip: req.ip });
    logger.info(`${isBanned?'BAN':'UNBAN'}: user=${id} by admin ip=${req.ip}`);
    res.json({ success: true, user });
  } catch(e) { res.status(500).json({ error: e.message }); }
}

async function deleteUser(req, res) {
  try {
    const { id } = req.params;
    await User.findByIdAndUpdate(id, { isDeleted: true, deletedAt: new Date(), isOnline: false, $inc: { tokenVersion: 1 } });
    await AuditLog.create({ adminId: req.user.id, action: 'DELETE_USER', targetId: id, ip: req.ip });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
}

async function revealPhone(req, res) {
  try {
    const user = await User.findById(req.params.id).select('phone').lean();
    if (!user) return res.status(404).json({ error: 'Introuvable' });
    await AuditLog.create({ adminId: req.user.id, action: 'REVEAL_PHONE', targetId: req.params.id, ip: req.ip });
    res.json({ phone: user.phone });
  } catch(e) { res.status(500).json({ error: e.message }); }
}

// ── Produits + réductions ──
async function setDiscount(req, res) {
  try {
    const { id } = req.params;
    const { percent, expiresAt } = req.body;
    if (percent < 0 || percent > 90) return res.status(400).json({ error: 'percent doit être entre 0 et 90' });
    const exp = new Date(expiresAt);
    if (exp <= new Date()) return res.status(400).json({ error: 'expiresAt doit être dans le futur' });
    const prod = await Product.findById(id);
    if (!prod) return res.status(404).json({ error: 'Produit introuvable' });
    const originalPrice = prod.originalPrice || prod.price;
    prod.discount = percent;
    prod.discountExpiresAt = exp;
    prod.originalPrice = originalPrice;
    await prod.save();
    await AuditLog.create({ adminId: req.user.id, action: 'SET_DISCOUNT', targetId: id, details: { percent, expiresAt }, ip: req.ip });
    res.json({ success: true, finalPrice: Math.round(prod.price * (1 - percent/100)), product: prod });
  } catch(e) { res.status(500).json({ error: e.message }); }
}

// ── Shops CRUD ──
async function getShops(req, res) {
  try {
    const shops = await Shop.find({ isDeleted: false }).populate('ownerId','name email').sort({ createdAt:-1 }).lean();
    res.json({ shops, count: shops.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
}

async function verifyShopKyc(req, res) {
  try {
    const shop = await Shop.findByIdAndUpdate(req.params.id, { kycStatus: 'VERIFIED' }, { new: true });
    if (!shop) return res.status(404).json({ error: 'Boutique introuvable' });
    await AuditLog.create({ adminId: req.user.id, action: 'VERIFY_KYC', targetId: req.params.id, ip: req.ip });
    res.json({ success: true, shop });
  } catch(e) { res.status(500).json({ error: e.message }); }
}

async function deleteShop(req, res) {
  try {
    await Shop.findByIdAndUpdate(req.params.id, { isDeleted: true, isActive: false });
    await AuditLog.create({ adminId: req.user.id, action: 'DELETE_SHOP', targetId: req.params.id, ip: req.ip });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
}

// ── Audit + Journal CSV ──
async function getAudit(req, res) {
  try {
    const { page=1, limit=100 } = req.query;
    const logs = await AuditLog.find().sort({ date:-1 }).skip((Number(page)-1)*Number(limit)).limit(Number(limit)).lean();
    res.json({ logs, count: logs.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
}

async function getJournalCsv(req, res) {
  try {
    const logs = await TransactionLog.find().sort({ date:-1 }).lean();
    const rows = logs.map(l => ({
      date:        new Date(l.date).toLocaleString('fr-FR'),
      orderId:     String(l.orderId||''),
      externalId:  l.externalId||'',
      amount:      l.amount,
      finalAmount: l.finalAmount,
      commission:  l.commission,
      status:      l.status,
      provider:    l.provider||'',
    }));
    const csv = buildCsv(['date','orderId','externalId','amount','finalAmount','commission','status','provider'], rows);
    res.setHeader('Content-Type','text/csv;charset=utf-8');
    res.setHeader('Content-Disposition','attachment;filename=journal_global.csv');
    res.send(csv);
  } catch(e) { res.status(500).json({ error: e.message }); }
}

function buildCsv(headers, rows) {
  const head = headers.join(';');
  const body = rows.map(r => headers.map(h => String(r[h]||'').replace(/;/g,',')).join(';'));
  return [head, ...body].join('\n');
}

// ── Stats admin ──
async function getStats(req, res) {
  try {
    const [users, merchants, products, orders, pending, valide, revenue] = await Promise.all([
      User.countDocuments({ role:'customer', isDeleted:false }),
      User.countDocuments({ role:'merchant', isDeleted:false }),
      Product.countDocuments({ isDeleted:false }),
      Order.countDocuments(),
      Order.countDocuments({ status:'PENDING' }),
      Order.countDocuments({ status:'VALIDÉ' }),
      Order.aggregate([{ $match:{ status:'VALIDÉ' } },{ $group:{ _id:null, total:{ $sum:'$finalAmount' } } }]),
    ]);
    const online = await User.countDocuments({ isOnline:true, isDeleted:false });
    res.json({ users, merchants, products, orders, pending, valide, online, revenue: revenue[0]?.total||0 });
  } catch(e) { res.status(500).json({ error: e.message }); }
}

module.exports = { adminLogin, loginAsShop, getUsers, getOnlineUsers, getUserActivity, banUser, deleteUser, revealPhone, setDiscount, getShops, verifyShopKyc, deleteShop, getAudit, getJournalCsv, getStats };
