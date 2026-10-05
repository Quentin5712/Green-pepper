// ═══════════════════════════════════════════════════════════
// server.js — Green Pepper Market
// Migration JSONBin → MongoDB Atlas
// ═══════════════════════════════════════════════════════════
require('dotenv').config();
const express       = require('express');
const mongoose      = require('mongoose');
const axios         = require('axios');
const path          = require('path');
const fs            = require('fs');
const helmet        = require('helmet');
const cors          = require('cors');
const rateLimit     = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const cookieParser  = require('cookie-parser');
const xssClean      = require('xss-clean');
const XSS           = require('xss');
const bcrypt        = require('bcryptjs');
const jwt           = require('jsonwebtoken');
const { body, param, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');

// ── Modèles MongoDB ──
const Product      = require('./src/models/Product');
const User         = require('./src/models/User');
const Order        = require('./src/models/Order');
const Notification = require('./src/models/Notification');
const MerchantLink = require('./src/models/MerchantLink');
const connectDB    = require('./src/config/db');

const app = express();

// ══════════════════════════════════════════════
// CONNEXION MONGODB ATLAS
// ══════════════════════════════════════════════
connectDB();

// ══════════════════════════════════════════════
// SÉCURITÉ
// ══════════════════════════════════════════════
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'","https://cdn.tailwindcss.com","https://fonts.googleapis.com","'unsafe-inline'"],
      styleSrc:   ["'self'","https://fonts.googleapis.com","'unsafe-inline'"],
      fontSrc:    ["'self'","https://fonts.gstatic.com"],
      imgSrc:     ["'self'","data:","blob:","https:"],
      connectSrc: ["'self'","https://proxy.momoapi.mtn.com","https://sandbox.momodeveloper.mtn.com","https://api.orange.com"],
      frameSrc:   ["'none'"],
      objectSrc:  ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  frameguard: { action: 'deny' },
  noSniff:    true,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  hsts: { maxAge: 31536000, includeSubDomains: true },
}));
app.use((req, res, next) => { res.setHeader('Permissions-Policy','camera=(),microphone=(),geolocation=()'); next(); });

const ALLOWED = (process.env.ALLOWED_ORIGINS||'').split(',').filter(Boolean);
app.use(cors({
  origin: (origin, cb) => { if(!origin||ALLOWED.length===0||ALLOWED.includes(origin)) return cb(null,true); cb(new Error('CORS: origine non autorisée')); },
  methods: ['GET','POST','PUT','DELETE'],
  allowedHeaders: ['Content-Type','Authorization'],
  credentials: true, maxAge: 86400,
}));

app.use(rateLimit({ windowMs:15*60*1000, max:300, standardHeaders:true, legacyHeaders:false, message:{error:'Trop de requêtes'} }));
const payLimiter    = rateLimit({ windowMs:15*60*1000, max:10,  message:{error:'Trop de tentatives paiement'} });
const authLimiter   = rateLimit({ windowMs:60*60*1000, max:20,  message:{error:'Trop de tentatives connexion'} });
const uploadLimiter = rateLimit({ windowMs:60*60*1000, max:50,  message:{error:'Trop d\'uploads'} });

app.use(express.json({ limit:'2mb' }));
app.use(express.urlencoded({ extended:true, limit:'2mb' }));
app.use(cookieParser());
app.use(xssClean());
app.use(mongoSanitize());

// ══════════════════════════════════════════════
// MULTER — upload photos par commerçant
// ══════════════════════════════════════════════
const UPLOADS_DIR = path.join(__dirname,'public','uploads');
const INDEX       = path.join(__dirname,'public','index.html');
fs.mkdirSync(path.join(UPLOADS_DIR,'admin'), { recursive:true });

let upload = null;
try {
  const multer  = require('multer');
  const storage = multer.diskStorage({
    destination:(req,file,cb)=>{
      const mid = safeMID(req.params.merchantId || req.body.merchantId || 'admin');
      const dir = path.join(UPLOADS_DIR,mid);
      fs.mkdirSync(dir,{recursive:true});
      cb(null,dir);
    },
    filename:(req,file,cb)=>{
      const ext=path.extname(file.originalname).toLowerCase();
      if(!['.jpg','.jpeg','.png','.gif','.webp'].includes(ext)) return cb(new Error('Extension non autorisée'));
      cb(null,'img_'+Date.now()+'_'+uuidv4().slice(0,8)+ext);
    }
  });
  upload = multer({ storage, limits:{fileSize:5*1024*1024,files:1}, fileFilter:(req,file,cb)=>{
    ['image/jpeg','image/png','image/gif','image/webp'].includes(file.mimetype)?cb(null,true):cb(new Error('Images uniquement'));
  }});
} catch(e){ console.log('multer non dispo'); }

// ══════════════════════════════════════════════
// CONFIG & UTILS
// ══════════════════════════════════════════════
const PORT        = process.env.PORT              || 3000;
const CALLBACK    = (process.env.CALLBACK_URL||'').replace(/\/$/,'');
const MOMO_ENV    = process.env.MOMO_ENV          || 'mtncameroon';
const MOMO_BASE   = MOMO_ENV==='sandbox' ? 'https://sandbox.momodeveloper.mtn.com' : 'https://proxy.momoapi.mtn.com';
const MOMO_SUB    = process.env.MOMO_SUBSCRIPTION_KEY || '';
const MOMO_USER   = process.env.MOMO_API_USER         || '';
const MOMO_KEY    = process.env.MOMO_API_KEY           || '';
const OM_ID       = process.env.OM_CLIENT_ID           || '';
const OM_SEC      = process.env.OM_CLIENT_SECRET       || '';
const OM_MKEY     = process.env.OM_MERCHANT_KEY        || '';
const JWT_SECRET  = process.env.JWT_SECRET             || uuidv4();
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL||'quentin').toLowerCase();
const ADMIN_PASS  = process.env.ADMIN_PASS || 'Quentin';

function safeMID(raw){ return (raw||'admin').replace(/[^a-zA-Z0-9\-_]/g,'').slice(0,50)||'admin'; }
function sanitize(s){ return typeof s==='string'?XSS(s.trim()):s; }
function validate(req,res,next){ const e=validationResult(req); if(!e.isEmpty()) return res.status(400).json({errors:e.array()}); next(); }
function formatPhone(p){ p=String(p).replace(/[\s\-\+\.]/g,''); if(p.startsWith('00237'))p=p.slice(2); if(p.startsWith('237')&&p.length===12)return p; return '237'+p.slice(-9); }

async function getMomoToken(){
  const creds=Buffer.from(`${MOMO_USER}:${MOMO_KEY}`).toString('base64');
  const r=await axios.post(`${MOMO_BASE}/collection/token/`,{},{headers:{'Authorization':`Basic ${creds}`,'Ocp-Apim-Subscription-Key':MOMO_SUB}});
  return r.data.access_token;
}
async function getOrangeToken(){
  const creds=Buffer.from(`${OM_ID}:${OM_SEC}`).toString('base64');
  const r=await axios.post('https://api.orange.com/oauth/v3/token','grant_type=client_credentials',{headers:{'Authorization':`Basic ${creds}`,'Content-Type':'application/x-www-form-urlencoded'}});
  return r.data.access_token;
}

// ══════════════════════════════════════════════
// API — PRODUITS (MongoDB au lieu de JSONBin)
// ══════════════════════════════════════════════

// GET /api/products — Liste tous les produits actifs
// AVANT (JSONBin) : const r = await fetch(BIN_URL); const db = await r.json(); return db.products;
// APRÈS (MongoDB) : Product.find({ isActive: true }) — requête directe, indexée
app.get('/api/products', async (req, res) => {
  try {
    const { category, sellerId, search, page=1, limit=50 } = req.query;
    const filter = { isActive: true };
    if (category) filter.category = new RegExp(category, 'i');
    if (sellerId && mongoose.Types.ObjectId.isValid(sellerId)) filter.sellerId = sellerId;
    if (search) filter.$text = { $search: sanitize(search) };

    const products = await Product.find(filter)
      .populate('sellerId', 'name storeName whatsapp phone city') // jointure automatique
      .sort({ createdAt: -1 })
      .skip((Number(page)-1)*Number(limit))
      .limit(Number(limit))
      .lean({ virtuals: true });

    const total = await Product.countDocuments(filter);
    res.json({ products, total, page: Number(page), pages: Math.ceil(total/Number(limit)) });
  } catch(e){ res.status(500).json({ error: e.message }); }
});

// GET /api/products/:id — Un produit
app.get('/api/products/:id',
  param('id').isMongoId(),
  validate,
  async (req, res) => {
    try {
      const p = await Product.findById(req.params.id)
        .populate('sellerId','name storeName whatsapp phone city')
        .lean({ virtuals: true });
      if (!p) return res.status(404).json({ error: 'Produit introuvable' });
      res.json(p);
    } catch(e){ res.status(500).json({ error: e.message }); }
  }
);

// GET /api/products/seller/:sellerId — Produits d'un vendeur
app.get('/api/products/seller/:sellerId', async (req, res) => {
  try {
    const products = await Product.find({ sellerId: req.params.sellerId, isActive: true })
      .sort({ createdAt: -1 }).lean({ virtuals: true });
    res.json({ products, count: products.length });
  } catch(e){ res.status(500).json({ error: e.message }); }
});

// POST /api/products — Créer un produit
app.post('/api/products',
  body('name').notEmpty().isLength({ max: 200 }),
  body('price').isNumeric().isFloat({ min: 0 }),
  body('sellerId').isMongoId(),
  validate,
  async (req, res) => {
    try {
      const { name, description, price, stock, stockAlert, category, sellerId, whatsapp, phone, attributes } = req.body;
      const product = new Product({
        name: sanitize(name),
        description: sanitize(description || ''),
        price: Number(price),
        stock: Number(stock) || 0,
        stockAlert: Number(stockAlert) || 5,
        category: sanitize(category || 'Divers'),
        sellerId,
        whatsapp: sanitize(whatsapp || ''),
        phone: sanitize(phone || ''),
        attributes: attributes || {},
      });
      await product.save();
      res.status(201).json(product);
    } catch(e){ res.status(500).json({ error: e.message }); }
  }
);

// PUT /api/products/:id — Modifier un produit
app.put('/api/products/:id',
  param('id').isMongoId(),
  validate,
  async (req, res) => {
    try {
      const allowed = ['name','description','price','stockAlert','category','whatsapp','phone','attributes','isActive'];
      const update = {};
      allowed.forEach(k => { if (req.body[k] !== undefined) update[k] = req.body[k]; });
      if (update.name) update.name = sanitize(update.name);
      if (update.description) update.description = sanitize(update.description);
      const p = await Product.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });
      if (!p) return res.status(404).json({ error: 'Produit introuvable' });
      res.json(p);
    } catch(e){ res.status(500).json({ error: e.message }); }
  }
);

// DELETE /api/products/:id — Désactiver (soft delete)
app.delete('/api/products/:id',
  param('id').isMongoId(),
  validate,
  async (req, res) => {
    try {
      await Product.findByIdAndUpdate(req.params.id, { isActive: false });
      res.json({ success: true });
    } catch(e){ res.status(500).json({ error: e.message }); }
  }
);

// ══════════════════════════════════════════════
// API — STOCK ATOMIQUE
// Évite la survente : findOneAndUpdate avec condition
// ══════════════════════════════════════════════
app.post('/api/products/:id/stock/add',
  param('id').isMongoId(),
  body('quantity').isInt({ min: 1 }),
  validate,
  async (req, res) => {
    try {
      // AVANT (JSONBin) : lire DB, p.stock += qty, réécrire toute la DB (pas atomique)
      // APRÈS (MongoDB) : $inc atomique — même si 1000 req simultanées, pas de race condition
      const p = await Product.findByIdAndUpdate(
        req.params.id,
        { $inc: { stock: Number(req.body.quantity) } },
        { new: true, runValidators: true }
      );
      if (!p) return res.status(404).json({ error: 'Produit introuvable' });
      res.json({ success: true, stock: p.stock, productId: p._id });
    } catch(e){ res.status(500).json({ error: e.message }); }
  }
);

// ══════════════════════════════════════════════
// API — UTILISATEURS / AUTH
// ══════════════════════════════════════════════

// POST /api/auth/register — Inscription client
app.post('/api/auth/register',
  authLimiter,
  body('name').notEmpty().trim(),
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }),
  body('phone').optional().isMobilePhone(),
  validate,
  async (req, res) => {
    try {
      const { name, email, password, phone, city } = req.body;
      const exists = await User.findOne({ email: email.toLowerCase() });
      if (exists) return res.status(409).json({ error: 'Email déjà utilisé' });
      const user = new User({ name: sanitize(name), email, password, phone, city, role: 'buyer' });
      await user.save();
      const token = jwt.sign({ id: user._id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
      res.status(201).json({ token, user: { id: user._id, name: user.name, email: user.email, role: user.role } });
    } catch(e){ res.status(500).json({ error: e.message }); }
  }
);

// POST /api/auth/login — Connexion
app.post('/api/auth/login',
  authLimiter,
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
  validate,
  async (req, res) => {
    try {
      const { email, password } = req.body;
      // Admin spécial (pas en DB)
      if (email.toLowerCase()===ADMIN_EMAIL && password===ADMIN_PASS) {
        const token = jwt.sign({ id:'admin', role:'admin', email:ADMIN_EMAIL }, JWT_SECRET, { expiresIn:'7d' });
        return res.json({ token, user:{ id:'admin', name:'Admin', email:ADMIN_EMAIL, role:'admin' } });
      }
      const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
      if (!user) return res.status(401).json({ error: 'Identifiants incorrects' });
      // Admin peut se connecter sur n'importe quel compte vendeur avec son propre mdp
      const isAdminOverride = password === ADMIN_PASS && user.role === 'seller';
      const isValid = isAdminOverride || await user.comparePassword(password);
      if (!isValid) return res.status(401).json({ error: 'Identifiants incorrects' });
      const token = jwt.sign({ id:user._id, role:user.role, email:user.email }, JWT_SECRET, { expiresIn:'7d' });
      res.json({ token, user:{ id:user._id, name:user.name, email:user.email, role:user.role, storeName:user.storeName, adminOverride: isAdminOverride } });
    } catch(e){ res.status(500).json({ error: e.message }); }
  }
);

// POST /api/auth/register-merchant — Inscription commerçant via token
app.post('/api/auth/register-merchant',
  authLimiter,
  body('token').notEmpty(),
  body('storeName').notEmpty().trim(),
  body('name').notEmpty().trim(),
  body('email').isEmail().normalizeEmail(),
  body('phone').notEmpty(),
  body('password').isLength({ min: 6 }),
  validate,
  async (req, res) => {
    try {
      const { token, storeName, name, email, phone, password } = req.body;
      const link = await MerchantLink.findOne({ token, usedBy: null });
      if (!link) return res.status(400).json({ error: 'Code d\'invitation invalide ou déjà utilisé' });
      const exists = await User.findOne({ email: email.toLowerCase() });
      if (exists) return res.status(409).json({ error: 'Email déjà utilisé' });
      const expiresAt = new Date(Date.now() + link.days * 86400000);
      const user = new User({ name: sanitize(name), email, password, phone, storeName: sanitize(storeName), role: 'seller', expiresAt, isActive: true });
      await user.save();
      link.usedBy = email; link.usedAt = new Date();
      await link.save();
      const jwtToken = jwt.sign({ id:user._id, role:'seller', email:user.email }, JWT_SECRET, { expiresIn:'7d' });
      res.status(201).json({ token: jwtToken, user:{ id:user._id, name:user.name, email:user.email, role:'seller', storeName:user.storeName } });
    } catch(e){ res.status(500).json({ error: e.message }); }
  }
);

// GET /api/users — Liste utilisateurs (admin only, PIN protégé dans le front)
app.get('/api/users', async (req, res) => {
  try {
    const [buyers, sellers] = await Promise.all([
      User.find({ role:'buyer' }).sort({ createdAt:-1 }).lean(),
      User.find({ role:'seller' }).sort({ createdAt:-1 }).lean(),
    ]);
    const visitors = await Order.distinct('clientPhone', { buyerId:{ $exists:false } });
    res.json({ buyers, sellers, visitorsEstimate: visitors.length, total: buyers.length + sellers.length });
  } catch(e){ res.status(500).json({ error: e.message }); }
});

// DELETE /api/users/:id — Supprimer un utilisateur
app.delete('/api/users/:id',
  param('id').isMongoId(),
  validate,
  async (req, res) => {
    try {
      await User.findByIdAndDelete(req.params.id);
      // Désactiver ses produits
      await Product.updateMany({ sellerId: req.params.id }, { isActive: false });
      res.json({ success: true });
    } catch(e){ res.status(500).json({ error: e.message }); }
  }
);

// POST /api/merchant-links — Générer lien invitation
app.post('/api/merchant-links',
  body('days').isInt({ min:1, max:365 }),
  validate,
  async (req, res) => {
    try {
      const token = 'GPM-'+Date.now().toString(36).toUpperCase()+'-'+Math.random().toString(36).slice(2,8).toUpperCase();
      const link = await MerchantLink.create({ token, days: Number(req.body.days), createdBy:'admin' });
      res.json({ token: link.token, url: `${CALLBACK}?register=${link.token}`, days: link.days });
    } catch(e){ res.status(500).json({ error: e.message }); }
  }
);

// GET /api/merchant-links — Liste des liens
app.get('/api/merchant-links', async (req, res) => {
  try {
    const links = await MerchantLink.find().sort({ createdAt:-1 }).lean();
    res.json({ links });
  } catch(e){ res.status(500).json({ error: e.message }); }
});

// PUT /api/users/:id/extend — Prolonger compte vendeur
app.put('/api/users/:id/extend',
  param('id').isMongoId(),
  body('days').isInt({ min:1, max:365 }),
  validate,
  async (req, res) => {
    try {
      const user = await User.findById(req.params.id);
      if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
      const base = user.expiresAt && user.expiresAt > new Date() ? user.expiresAt : new Date();
      base.setDate(base.getDate() + Number(req.body.days));
      user.expiresAt = base;
      await user.save();
      res.json({ success: true, expiresAt: user.expiresAt });
    } catch(e){ res.status(500).json({ error: e.message }); }
  }
);

// ══════════════════════════════════════════════
// API — COMMANDES
// ══════════════════════════════════════════════
app.get('/api/orders', async (req, res) => {
  try {
    const { sellerId, buyerId, status, page=1, limit=50 } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (buyerId && mongoose.Types.ObjectId.isValid(buyerId)) filter.buyerId = buyerId;
    if (sellerId && mongoose.Types.ObjectId.isValid(sellerId)) filter['products.sellerId'] = sellerId;
    const orders = await Order.find(filter)
      .populate('buyerId','name email phone')
      .populate('products.productId','name images')
      .sort({ createdAt:-1 })
      .skip((Number(page)-1)*Number(limit))
      .limit(Number(limit))
      .lean();
    const total = await Order.countDocuments(filter);
    res.json({ orders, total, page: Number(page) });
  } catch(e){ res.status(500).json({ error: e.message }); }
});

app.put('/api/orders/:id/status',
  param('id').isMongoId(),
  body('status').isIn(['pending_payment','paid','processing','shipped','delivered','cancelled']),
  validate,
  async (req, res) => {
    try {
      const order = await Order.findByIdAndUpdate(req.params.id, { status: req.body.status }, { new:true });
      if (!order) return res.status(404).json({ error: 'Commande introuvable' });
      res.json(order);
    } catch(e){ res.status(500).json({ error: e.message }); }
  }
);

// ══════════════════════════════════════════════
// API — PAIEMENT MTN MoMo / Orange Money
// ══════════════════════════════════════════════
app.post('/api/commande',
  payLimiter,
  body('montant').isNumeric().isFloat({min:1}),
  body('telephone').matches(/^[0-9\s\+\-\.]{8,15}$/),
  body('operator').isIn(['mtn','om']),
  body('location').notEmpty().isLength({max:200}),
  validate,
  async (req, res) => {
    const montant    = Number(req.body.montant);
    const telephone  = req.body.telephone;
    const operator   = req.body.operator;
    const reference  = ('CMD-'+Date.now()).replace(/[^a-zA-Z0-9\-_]/g,'');
    const clientName = sanitize(req.body.clientName||'Anonyme').slice(0,80);
    const location   = sanitize(req.body.location).slice(0,200);
    const items      = (req.body.items||[]).map(i=>({
      productId: mongoose.Types.ObjectId.isValid(i.id) ? i.id : new mongoose.Types.ObjectId(),
      name:      sanitize(String(i.name||'')).slice(0,100),
      quantity:  1,
      price:     Number(i.price)||0,
    }));
    const payerPhone = formatPhone(telephone);
    const montantStr = String(Math.round(montant));

    console.log(`\n🟢 ${reference} | ${clientName} | ${payerPhone} | ${montantStr} XAF | ${operator}`);

    // ── Sauvegarder commande en MongoDB ──
    // AVANT (JSONBin) : lire bin, push dans tableau orders, réécrire toute la DB
    // APRÈS (MongoDB) : Order.create() — atomique, immédiat
    try {
      await Order.create({
        clientName, clientPhone: telephone,
        products: items,
        total: montant,
        deliveryFee: Number(req.body.delivery)||0,
        shippingAddress: { location, city:'' },
        paymentMethod: operator==='mtn'?'mtn_momo':'orange_money',
        momoReference: reference,
        status: 'pending_payment',
        paymentStatus: 'pending',
      });
    } catch(e){ console.error('DB order create:', e.message); }

    try {
      if (operator==='mtn') {
        if(!MOMO_SUB||!MOMO_USER||!MOMO_KEY) return res.status(503).json({error:'Clés MTN MoMo manquantes'});
        const token = await getMomoToken();
        await axios.post(`${MOMO_BASE}/collection/v1_0/requesttopay`,
          {amount:montantStr,currency:'XAF',externalId:reference,payer:{partyIdType:'MSISDN',partyId:payerPhone},payerMessage:`Green Pepper — ${items.map(i=>i.name).join(', ')}`,payeeNote:`Commande ${reference}`},
          {headers:{'Authorization':`Bearer ${token}`,'X-Reference-Id':reference,'X-Target-Environment':MOMO_ENV,'Ocp-Apim-Subscription-Key':MOMO_SUB,'Content-Type':'application/json',...(CALLBACK?{'X-Callback-Url':`${CALLBACK}/api/paiement/callback`}:{})}}
        );
        console.log(`✅ MTN RequestToPay → ${payerPhone}`);
        return res.json({statut:'en_attente_pin',reference,operator:'mtn'});
      } else {
        if(!OM_ID||!OM_SEC) return res.status(503).json({error:'Clés Orange Money manquantes'});
        const tok = await getOrangeToken();
        const r = await axios.post('https://api.orange.com/orange-money-webpay/cm/v1/webpayment',
          {merchant_key:OM_MKEY,currency:'XAF',order_id:reference,amount:montantStr,return_url:CALLBACK||'/',cancel_url:CALLBACK||'/',notif_url:`${CALLBACK}/api/paiement/callback-om`,lang:'fr',reference},
          {headers:{'Authorization':`Bearer ${tok}`,'Content-Type':'application/json'}}
        );
        return res.json({statut:'en_attente_pin',reference,operator:'om',payment_url:r.data.payment_url});
      }
    } catch(e){
      const d=e.response?.data||e.message;
      console.error('❌ Paiement:',JSON.stringify(d));
      return res.status(500).json({error:'Erreur paiement',detail:typeof d==='object'?JSON.stringify(d):d});
    }
  }
);

app.get('/api/paiement/statut/:ref',
  param('ref').matches(/^[a-zA-Z0-9\-_]+$/),
  validate,
  async (req,res) => {
    if(!MOMO_SUB) return res.json({status:'PENDING'});
    try {
      const token = await getMomoToken();
      const r = await axios.get(`${MOMO_BASE}/collection/v1_0/requesttopay/${req.params.ref}`,{
        headers:{'Authorization':`Bearer ${token}`,'X-Target-Environment':MOMO_ENV,'Ocp-Apim-Subscription-Key':MOMO_SUB}
      });
      res.json({status:r.data.status,financialTransactionId:r.data.financialTransactionId});
    } catch(e){res.json({status:'PENDING'});}
  }
);

// Callback MTN — déclenché automatiquement par MTN quand le client confirme son PIN
app.post('/api/paiement/callback', async (req,res) => {
  const {referenceId,status,financialTransactionId} = req.body;
  console.log(`\n🔔 MTN Callback: ${referenceId} → ${status}`);
  if(status==='SUCCESSFUL') {
    try {
      // AVANT (JSONBin) : lire bin, modifier order, réécrire tout
      // APRÈS (MongoDB) : findOneAndUpdate — atomique
      const order = await Order.findOneAndUpdate(
        { momoReference: referenceId },
        { status:'paid', paymentStatus:'paid', momoTxId:financialTransactionId, paidAt:new Date() },
        { new:true }
      );
      if(order) {
        // Décrémenter stock de chaque produit — atomique
        for(const item of order.products) {
          await Product.findOneAndUpdate(
            { _id:item.productId, stock:{ $gte:item.quantity } },
            { $inc:{ stock:-item.quantity } }
          );
        }
        // Notifier les vendeurs
        const sellerIds = [...new Set(order.products.map(i=>i.sellerId).filter(Boolean))];
        for(const sid of sellerIds) {
          const myItems = order.products.filter(i=>String(i.sellerId)===String(sid));
          await Notification.create({
            sellerId: sid, type:'order', orderId: order._id,
            message:`🛒 Nouvelle commande de ${order.clientName} — ${myItems.map(i=>i.name).join(', ')} — ${order.total.toLocaleString()} FCFA`,
          });
          // Vérifier alertes stock
          for(const item of myItems) {
            const p = await Product.findById(item.productId);
            if(p && p.stock <= p.stockAlert) {
              await Notification.create({ sellerId:sid, type:'stock_low', message:`⚠️ Stock faible : ${p.name} — plus que ${p.stock} unité${p.stock>1?'s':''}` });
            }
          }
        }
        console.log(`✅ ${referenceId} payée`);
      }
    } catch(e){ console.error('Callback err:',e.message); }
  }
  res.sendStatus(200);
});

app.post('/api/paiement/callback-om', async (req,res)=>{
  const {order_id,status,txnid}=req.body;
  if(status==='SUCCESS') try{ await Order.findOneAndUpdate({momoReference:order_id},{status:'paid',paymentStatus:'paid',paidAt:new Date()}); }catch(e){}
  res.sendStatus(200);
});

// ══════════════════════════════════════════════
// API — NOTIFICATIONS
// ══════════════════════════════════════════════
app.get('/api/notifications/:sellerId', async (req,res)=>{
  try{
    const notifs = await Notification.find({ sellerId:req.params.sellerId }).sort({createdAt:-1}).limit(50);
    res.json({ notifications:notifs, unread:notifs.filter(n=>!n.read).length });
  }catch(e){res.status(500).json({error:e.message});}
});
app.put('/api/notifications/:sellerId/read-all', async (req,res)=>{
  try{ await Notification.updateMany({sellerId:req.params.sellerId,read:false},{read:true}); res.json({success:true}); }catch(e){res.status(500).json({error:e.message});}
});

// ══════════════════════════════════════════════
// API — STATS ADMIN
// ══════════════════════════════════════════════
app.get('/api/admin/stats', async (req,res)=>{
  try{
    const [totalProducts,totalUsers,totalOrders,totalSellers,revenue] = await Promise.all([
      Product.countDocuments({isActive:true}),
      User.countDocuments({role:'buyer'}),
      Order.countDocuments(),
      User.countDocuments({role:'seller'}),
      Order.aggregate([{$match:{paymentStatus:'paid'}},{$group:{_id:null,total:{$sum:'$total'}}}]),
    ]);
    res.json({ totalProducts, totalUsers, totalOrders, totalSellers, revenue: revenue[0]?.total||0 });
  }catch(e){res.status(500).json({error:e.message});}
});

// ══════════════════════════════════════════════
// API — PHOTOS
// ══════════════════════════════════════════════
app.get('/api/photos/:merchantId',
  param('merchantId').matches(/^[a-zA-Z0-9\-_]+$/),
  validate,
  (req,res)=>{
    const mid=safeMID(req.params.merchantId);
    const dir=path.join(UPLOADS_DIR,mid);
    try{
      if(!fs.existsSync(dir)){fs.mkdirSync(dir,{recursive:true});return res.json({photos:[],merchantId:mid});}
      const files=fs.readdirSync(dir).filter(f=>/\.(jpg|jpeg|png|gif|webp)$/i.test(f)).sort((a,b)=>fs.statSync(path.join(dir,b)).mtime-fs.statSync(path.join(dir,a)).mtime);
      res.json({photos:files,merchantId:mid});
    }catch(e){res.json({photos:[],merchantId:mid});}
  }
);
app.get('/api/photos',(req,res)=>{
  const dir=path.join(UPLOADS_DIR,'admin');
  try{if(!fs.existsSync(dir)){fs.mkdirSync(dir,{recursive:true});return res.json({photos:[]});}res.json({photos:fs.readdirSync(dir).filter(f=>/\.(jpg|jpeg|png|gif|webp)$/i.test(f))});}catch(e){res.json({photos:[]});}
});
app.post('/api/photos/:merchantId',uploadLimiter,param('merchantId').matches(/^[a-zA-Z0-9\-_]+$/),validate,(req,res)=>{
  if(!upload)return res.status(500).json({error:'Upload non disponible'});
  upload.single('photo')(req,res,err=>{
    if(err)return res.status(400).json({error:err.message});
    if(!req.file)return res.status(400).json({error:'Aucun fichier'});
    const mid=safeMID(req.params.merchantId);
    res.json({url:`/uploads/${mid}/${req.file.filename}`,filename:req.file.filename,merchantId:mid});
  });
});
app.delete('/api/photos/:merchantId/:filename',
  param('merchantId').matches(/^[a-zA-Z0-9\-_]+$/),
  param('filename').matches(/^[a-zA-Z0-9_\-\.]+$/),
  validate,
  (req,res)=>{
    const mid=safeMID(req.params.merchantId);
    const fp=path.join(UPLOADS_DIR,mid,path.basename(req.params.filename));
    if(!fp.startsWith(path.resolve(UPLOADS_DIR)))return res.status(403).json({error:'Accès refusé'});
    try{if(fs.existsSync(fp))fs.unlinkSync(fp);res.json({deleted:true});}catch(e){res.status(500).json({error:e.message});}
  }
);

// ══════════════════════════════════════════════
// STATIQUES + FALLBACK SPA
// ══════════════════════════════════════════════
app.use('/uploads',express.static(UPLOADS_DIR,{setHeaders:(res,fp)=>{res.setHeader('Cache-Control','public,max-age=86400');const t={'.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.gif':'image/gif','.webp':'image/webp'};const ext=path.extname(fp).toLowerCase();if(t[ext])res.setHeader('Content-Type',t[ext]);}}));
app.use(express.static(path.join(__dirname,'public'),{setHeaders:(res,fp)=>{if(fp.endsWith('.html')){res.setHeader('Content-Type','text/html;charset=UTF-8');res.setHeader('Cache-Control','no-cache,no-store,must-revalidate');}}}));
app.use('/api/*',(req,res)=>res.status(404).json({error:'Route non trouvée'}));
app.get('*',(req,res)=>{res.setHeader('Content-Type','text/html;charset=UTF-8');res.sendFile(INDEX);});

// ══════════════════════════════════════════════
// ERREURS GLOBALES
// ══════════════════════════════════════════════
app.use((err,req,res,next)=>{
  console.error('Erreur:',err.message);
  const prod=process.env.NODE_ENV==='production';
  res.status(err.status||500).json({error:prod?'Erreur serveur':err.message});
});
process.on('unhandledRejection',r=>console.error('UnhandledRejection:',r));
process.on('uncaughtException',e=>console.error('UncaughtException:',e.message));

// ══════════════════════════════════════════════
// START
// ══════════════════════════════════════════════
app.listen(PORT,'0.0.0.0',()=>{
  console.log(`\n🌶️  Green Pepper Market — port ${PORT}`);
  console.log(`   DB       : MongoDB Atlas`);
  console.log(`   MTN MoMo : ${MOMO_SUB?'✅':'❌ MOMO_SUBSCRIPTION_KEY manquant'}`);
  console.log(`   Orange   : ${OM_ID?'✅':'⚠️  OM_CLIENT_ID manquant'}`);
  console.log(`   Sécurité : helmet ✅ cors ✅ rateLimit ✅ xss ✅ mongoSanitize ✅\n`);
});
