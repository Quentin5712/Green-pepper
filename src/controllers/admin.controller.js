'use strict';
const bcrypt   = require('bcryptjs');
const Settings = require('../models/Settings');
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

// ══════════════════════════════════════════════
// CONNEXION ADMIN (quentin ou oceane)
// ══════════════════════════════════════════════
async function adminLogin(req, res) {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'username et password requis' });

    const ADMIN_USER = process.env.ADMIN_USER || 'quentin';
    const ADMIN_PASS_HASH = process.env.ADMIN_PASS_HASH || '';

    // Vérifier le username
    const validUsers = [ADMIN_USER, 'oceane'];
    if (!validUsers.includes(username.toLowerCase())) {
      logger.warn(`ADMIN LOGIN FAILED: username=${username} ip=${req.ip}`);
      return res.status(401).json({ error: 'Identifiants admin incorrects' });
    }

    // Si ADMIN_PASS_HASH défini → vérifier bcrypt
    // Sinon → accepter n'importe quel mot de passe (mode dev uniquement)
    let ok = false;
    if (ADMIN_PASS_HASH) {
      ok = await bcrypt.compare(password, ADMIN_PASS_HASH);
    } else {
      ok = password.length >= 4; // mode dev sans hash
      if (ok) logger.warn('ADMIN_PASS_HASH non défini — auth admin en mode développement');
    }

    if (!ok) {
      logger.warn(`ADMIN LOGIN FAILED: username=${username} ip=${req.ip}`);
      return res.status(401).json({ error: 'Identifiants admin incorrects' });
    }

    // Trouver ou créer l'admin en DB
    let admin = await User.findOne({ role: 'admin', isDeleted: false });
    if (!admin) {
      const hashed = await bcrypt.hash(password, 12);
      admin = new User({ name: username.charAt(0).toUpperCase() + username.slice(1), email: `${username}@greenpeppermarket.cm`, password: hashed, role: 'admin' });
      await admin.save();
    }

    const token = jwt.sign(
      { id: admin._id, email: admin.email, role: 'admin', tv: admin.tokenVersion },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    await User.findByIdAndUpdate(admin._id, { lastActive: new Date(), isOnline: true, currentIP: req.ip || '' });
    logger.info(`ADMIN LOGIN: ${username} ip=${req.ip}`);
    return res.json({ token, user: { id: admin._id, name: admin.name, role: 'admin' } });
  } catch(e) { logger.error('adminLogin:', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
}

// ══════════════════════════════════════════════
// IMPERSONATE — entrer dans une boutique marchand
// ══════════════════════════════════════════════
async function loginAsShop(req, res) {
  try {
    const { adminLogin: adminUser, adminPassword, merchantEmail } = req.body;
    if (!adminUser || !adminPassword || !merchantEmail) return res.status(400).json({ error: 'adminLogin, adminPassword et merchantEmail requis' });

    const ADMIN_USER = process.env.ADMIN_USER || 'quentin';
    const ADMIN_PASS_HASH = process.env.ADMIN_PASS_HASH || '';
    if (adminUser.toLowerCase() !== ADMIN_USER && adminUser.toLowerCase() !== 'oceane') return res.status(401).json({ error: 'Identifiants admin incorrects' });

    let ok = false;
    if (ADMIN_PASS_HASH) ok = await bcrypt.compare(adminPassword, ADMIN_PASS_HASH);
    else ok = adminPassword.length >= 4;
    if (!ok) return res.status(401).json({ error: 'Mot de passe admin incorrect' });

    const merchant = await User.findOne({ email: merchantEmail.toLowerCase(), role: 'merchant', isDeleted: false });
    if (!merchant) return res.status(404).json({ error: 'Marchand introuvable' });

    const token = jwt.sign(
      { id: merchant._id, email: merchant.email, role: 'merchant', shopId: merchant.shopId, tv: merchant.tokenVersion, isImpersonated: true, impersonatedBy: adminUser },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    await AuditLog.create({ adminId: adminUser, action: 'ADMIN_IMPERSONATE_SHOP', targetId: String(merchant._id), details: { merchantEmail, shopId: merchant.shopId }, ip: req.ip });
    logger.info(`IMPERSONATE: ${adminUser} → ${merchantEmail} ip=${req.ip}`);
    return res.json({ token, shopId: merchant.shopId, merchantName: merchant.name, message: `Connecté comme ${merchant.name}` });
  } catch(e) { logger.error('loginAsShop:', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
}

function maskPhone(p) {
  if (!p) return '—';
  const s = String(p).replace(/\s/g, '');
  return s.slice(0, 5) + '** **' + ' ' + s.slice(-2);
}

// ══════════════════════════════════════════════
// UTILISATEURS
// ══════════════════════════════════════════════
async function getUsers(req, res) {
  try {
    const { page=1, limit=50, role, search } = req.query;
    const filter = { isDeleted: false };
    if (role) filter.role = role;
    if (search) filter.$or = [{ name: new RegExp(search,'i') }, { email: new RegExp(search,'i') }];
    const [users, total] = await Promise.all([
      User.find(filter).select('-password').sort({ createdAt:-1 }).skip((Number(page)-1)*Number(limit)).limit(Number(limit)).lean(),
      User.countDocuments(filter),
    ]);
    res.json({ users, total, page: Number(page) });
  } catch(e) { res.status(500).json({ error: e.message }); }
}

// Utilisateurs connectés en temps réel
async function getOnlineUsers(req, res) {
  try {
    const users = await User.find({ isOnline: true, isDeleted: false }).select('-password').sort({ lastActive: -1 }).lean();
    const result = await Promise.all(users.map(async u => {
      const [cart, order] = await Promise.all([
        Cart.find({ userId: u._id }).populate('productId','name price').lean(),
        Order.findOne({ userId: u._id, status: { $in: ['PENDING','NEGOCIATED'] } }).sort({ createdAt:-1 }).lean(),
      ]);
      return { ...u, phoneMasked: maskPhone(u.phone), phone: undefined, cart, currentOrder: order };
    }));
    res.json({ users: result, count: result.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
}

async function getUserActivity(req, res) {
  try {
    const [txLogs, messages, cart] = await Promise.all([
      TransactionLog.find({ orderId: { $in: (await Order.find({ userId: req.params.id }).distinct('_id')) } }).sort({ date:-1 }).limit(50).lean(),
      Message.find({ clientId: req.params.id }).sort({ createdAt:-1 }).limit(50).lean(),
      Cart.find({ userId: req.params.id }).populate('productId','name price').lean(),
    ]);
    res.json({ txLogs, messages, cart });
  } catch(e) { res.status(500).json({ error: e.message }); }
}

async function banUser(req, res) {
  try {
    const { isBanned, banReason } = req.body;
    const upd = { isBanned, banReason: banReason||'', $inc: { tokenVersion: 1 } };
    if (isBanned) upd.isOnline = false;
    const user = await User.findByIdAndUpdate(req.params.id, upd, { new: true }).select('-password');
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
    await AuditLog.create({ adminId: req.user.id, action: isBanned?'BAN_USER':'UNBAN_USER', targetId: req.params.id, details: { banReason }, ip: req.ip });
    logger.info(`${isBanned?'BAN':'UNBAN'}: user=${req.params.id} ip=${req.ip}`);
    res.json({ success: true, user });
  } catch(e) { res.status(500).json({ error: e.message }); }
}

async function deleteUser(req, res) {
  try {
    await User.findByIdAndUpdate(req.params.id, { isDeleted: true, deletedAt: new Date(), isOnline: false, $inc: { tokenVersion: 1 } });
    await AuditLog.create({ adminId: req.user.id, action: 'DELETE_USER', targetId: req.params.id, ip: req.ip });
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

// ══════════════════════════════════════════════
// PRODUITS + RÉDUCTIONS
// ══════════════════════════════════════════════
async function setDiscount(req, res) {
  try {
    const { percent, expiresAt } = req.body;
    if (percent < 0 || percent > 90) return res.status(400).json({ error: 'percent doit être entre 0 et 90' });
    const exp = new Date(expiresAt);
    if (exp <= new Date()) return res.status(400).json({ error: 'expiresAt doit être dans le futur' });
    const prod = await Product.findById(req.params.id);
    if (!prod) return res.status(404).json({ error: 'Produit introuvable' });
    prod.discount = percent;
    prod.discountExpiresAt = exp;
    prod.originalPrice = prod.originalPrice || prod.price;
    await prod.save();
    await AuditLog.create({ adminId: req.user.id, action: 'SET_DISCOUNT', targetId: req.params.id, details: { percent, expiresAt }, ip: req.ip });
    res.json({ success: true, finalPrice: Math.round(prod.price*(1-percent/100)), product: prod });
  } catch(e) { res.status(500).json({ error: e.message }); }
}

async function removeDiscount(req, res) {
  try {
    await Product.findByIdAndUpdate(req.params.id, { discount: 0, discountExpiresAt: null });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
}

// ══════════════════════════════════════════════
// BOUTIQUES
// ══════════════════════════════════════════════
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

// ══════════════════════════════════════════════
// STATS DASHBOARD
// ══════════════════════════════════════════════
async function getStats(req, res) {
  try {
    const [users, merchants, products, orders, pending, valide, online, revenue] = await Promise.all([
      User.countDocuments({ role:'customer', isDeleted:false }),
      User.countDocuments({ role:'merchant', isDeleted:false }),
      Product.countDocuments({ isDeleted:false }),
      Order.countDocuments(),
      Order.countDocuments({ status:'PENDING' }),
      Order.countDocuments({ status:'VALIDÉ' }),
      User.countDocuments({ isOnline:true, isDeleted:false }),
      Order.aggregate([{ $match:{ status:'VALIDÉ' } },{ $group:{ _id:null, total:{ $sum:'$finalAmount' } } }]),
    ]);
    res.json({ users, merchants, products, orders, pending, valide, online, revenue: revenue[0]?.total||0 });
  } catch(e) { res.status(500).json({ error: e.message }); }
}

// ══════════════════════════════════════════════
// COMMANDES ADMIN
// ══════════════════════════════════════════════
async function getOrders(req, res) {
  try {
    const { status, page=1, limit=100 } = req.query;
    const filter = {};
    if (status) filter.status = status;
    const [orders, total, agg] = await Promise.all([
      Order.find(filter).sort({ createdAt:-1 }).skip((Number(page)-1)*Number(limit)).limit(Number(limit)).lean(),
      Order.countDocuments(filter),
      Order.aggregate([{ $group:{ _id:'$status', count:{ $sum:1 } } }]),
    ]);
    const stats = {}; agg.forEach(s => stats[s._id] = s.count);
    res.json({ orders, total, page: Number(page), stats: { pending: stats.PENDING||0, valide: stats['VALIDÉ']||0, refuse: stats['REFUSÉ']||0 } });
  } catch(e) { res.status(500).json({ error: e.message }); }
}

// ══════════════════════════════════════════════
// AUDIT LOG
// ══════════════════════════════════════════════
async function getAudit(req, res) {
  try {
    const logs = await AuditLog.find().sort({ date:-1 }).limit(200).lean();
    res.json({ logs, count: logs.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
}

// ══════════════════════════════════════════════
// JOURNAL CSV — toutes transactions
// ══════════════════════════════════════════════
async function getJournalCsv(req, res) {
  try {
    const logs = await TransactionLog.find().sort({ date:-1 }).lean();
    const head = 'date;orderId;externalId;amount;finalAmount;commission;status;provider';
    const body = logs.map(l => [
      new Date(l.date).toLocaleString('fr-FR'),
      String(l.orderId||''), l.externalId||'',
      l.amount, l.finalAmount, l.commission, l.status, l.provider||''
    ].join(';'));
    res.setHeader('Content-Type','text/csv;charset=utf-8');
    res.setHeader('Content-Disposition','attachment;filename=journal_global.csv');
    res.send([head,...body].join('\n'));
  } catch(e) { res.status(500).json({ error: e.message }); }
}

// ══════════════════════════════════════════════
// PARAMÈTRES — frais de livraison
// ══════════════════════════════════════════════
async function getSettings(req, res) {
  try {
    const settings = await Settings.find().lean();
    const obj = {}; settings.forEach(s => obj[s.key] = s.value);
    res.json(obj);
  } catch(e) { res.status(500).json({ error: e.message }); }
}

async function updateSettings(req, res) {
  try {
    const Settings = require('../models/Settings');
    const { key, value } = req.body;
    if (!key) return res.status(400).json({ error: 'key requis' });
    await Settings.findOneAndUpdate({ key }, { value }, { upsert: true, new: true });
    await AuditLog.create({ adminId: req.user.id, action: 'UPDATE_SETTINGS', details: { key, value }, ip: req.ip });
    res.json({ success: true, key, value });
  } catch(e) { res.status(500).json({ error: e.message }); }
}

module.exports = {
  adminLogin, loginAsShop,
  getUsers, getOnlineUsers, getUserActivity, banUser, deleteUser, revealPhone,
  setDiscount, removeDiscount,
  getShops, verifyShopKyc, deleteShop,
  getStats, getOrders,
  getAudit, getJournalCsv,
  getSettings, updateSettings,
};
