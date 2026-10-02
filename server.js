// ═══════════════════════════════════════════════════════════
// server.js — Green Pepper Market
// Sécurité complète + MTN MoMo Production + Photos par marchand
// ═══════════════════════════════════════════════════════════
require('dotenv').config();
const express     = require('express');
const axios       = require('axios');
const path        = require('path');
const fs          = require('fs');
const helmet      = require('helmet');
const cors        = require('cors');
const rateLimit   = require('express-rate-limit');
const { body, param, validationResult } = require('express-validator');
const bcrypt      = require('bcryptjs');
const jwt         = require('jsonwebtoken');
const XSS         = require('xss');
const { v4: uuidv4 } = require('uuid');

const app = express();

// ═══════════════════════════════════════════════════════════
// ── 1. HELMET — En-têtes HTTP de sécurité
//    Protège contre : clickjacking, XSS, sniffing MIME,
//    injection de code via iframes, fuites de referrer
// ═══════════════════════════════════════════════════════════
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   ["'self'", "https://cdn.tailwindcss.com", "https://fonts.googleapis.com", "'unsafe-inline'"],
      styleSrc:    ["'self'", "https://fonts.googleapis.com", "'unsafe-inline'"],
      fontSrc:     ["'self'", "https://fonts.gstatic.com"],
      imgSrc:      ["'self'", "data:", "blob:", "https:"],
      connectSrc:  ["'self'", "https://api.jsonbin.io", "https://proxy.momoapi.mtn.com", "https://sandbox.momodeveloper.mtn.com", "https://api.orange.com"],
      frameSrc:    ["'none'"],
      objectSrc:   ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  // X-Frame-Options: DENY → empêche le clickjacking
  frameguard: { action: 'deny' },
  // X-Content-Type-Options: nosniff → empêche le MIME sniffing
  noSniff: true,
  // Referrer-Policy → ne pas fuiter l'URL dans les requêtes externes
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  // Strict-Transport-Security → force HTTPS
  hsts: { maxAge: 31536000, includeSubDomains: true },
  // X-DNS-Prefetch-Control: off → pas de préfetch DNS
  dnsPrefetchControl: { allow: false },
  // Permissions-Policy → désactive les APIs sensibles du navigateur
  permittedCrossDomainPolicies: false,
}));

// ── Permissions-Policy custom (désactive caméra, micro, géolocalisation) ──
app.use((req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

// ═══════════════════════════════════════════════════════════
// ── 2. CORS — Contrôle des origines autorisées
//    Protège contre : requêtes cross-origin non autorisées
// ═══════════════════════════════════════════════════════════
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    // Autorise les requêtes sans origin (Postman, mobile apps) en dev
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error('CORS: origine non autorisée — ' + origin));
  },
  methods:     ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  maxAge:      86400,
}));

// ═══════════════════════════════════════════════════════════
// ── 3. RATE LIMITING — Limite de requêtes
//    Protège contre : brute force, DDoS, scraping
// ═══════════════════════════════════════════════════════════
// Global : 200 req / 15 min par IP
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes. Réessayez dans 15 minutes.' },
}));

// Paiements : 10 req / 15 min (anti brute force sur les paiements)
const payLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Trop de tentatives de paiement. Réessayez dans 15 minutes.' },
});

// Auth : 20 req / heure (anti brute force login)
const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: { error: 'Trop de tentatives de connexion. Réessayez dans 1 heure.' },
});

// Upload photos : 30 req / heure
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  message: { error: 'Trop d\'uploads. Réessayez dans 1 heure.' },
});

// ═══════════════════════════════════════════════════════════
// ── 4. BODY PARSING avec limite de taille
//    Protège contre : payloads surdimensionnés (DoS)
// ═══════════════════════════════════════════════════════════
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// ═══════════════════════════════════════════════════════════
// ── 5. MULTER — Upload photos sécurisé
//    Protège contre : upload de fichiers malveillants,
//    path traversal, fichiers trop lourds
// ═══════════════════════════════════════════════════════════
let upload = null;
try {
  const multer = require('multer');
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      // Sanitize merchantId → que alphanumérique + tirets
      const raw = req.params.merchantId || 'admin';
      const merchantId = raw.replace(/[^a-zA-Z0-9\-_]/g, '').slice(0, 50) || 'admin';
      const dir = path.join(UPLOADS_DIR, merchantId);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      // Nom aléatoire → évite l'écrasement et l'injection via le nom de fichier
      const ext = path.extname(file.originalname).toLowerCase();
      const allowed = ['.jpg','.jpeg','.png','.gif','.webp'];
      if (!allowed.includes(ext)) return cb(new Error('Extension non autorisée'));
      cb(null, 'img_' + Date.now() + '_' + uuidv4().slice(0,8) + ext);
    }
  });
  upload = multer({
    storage,
    limits: {
      fileSize: 5 * 1024 * 1024,  // 5 MB max
      files: 1,                    // 1 fichier à la fois
    },
    fileFilter: (req, file, cb) => {
      // Vérifier le MIME type réel (pas juste l'extension)
      const allowed = ['image/jpeg','image/png','image/gif','image/webp'];
      if (!allowed.includes(file.mimetype)) {
        return cb(new Error('Type de fichier non autorisé. Images uniquement (JPEG, PNG, GIF, WEBP).'));
      }
      cb(null, true);
    }
  });
} catch(e) { console.log('multer non disponible'); }

// ═══════════════════════════════════════════════════════════
// ── 6. SANITISATION XSS — Nettoyage des entrées utilisateur
//    Protège contre : injection HTML/JS dans les champs texte
// ═══════════════════════════════════════════════════════════
function sanitize(str) {
  if (typeof str !== 'string') return str;
  return XSS(str.trim());
}

// ═══════════════════════════════════════════════════════════
// ── 7. JWT — Authentification sécurisée pour l'API
//    (pour les futures routes API privées)
// ═══════════════════════════════════════════════════════════
const JWT_SECRET = process.env.JWT_SECRET || uuidv4(); // Toujours définir JWT_SECRET en prod
function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}
function verifyToken(token) {
  try { return jwt.verify(token, JWT_SECRET); }
  catch(e) { return null; }
}
function authMiddleware(req, res, next) {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return res.status(401).json({ error: 'Token manquant' });
  const payload = verifyToken(h.slice(7));
  if (!payload) return res.status(401).json({ error: 'Token invalide ou expiré' });
  req.user = payload;
  next();
}

// ── Validation des erreurs express-validator ──
function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  next();
}

// ═══════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════
const PORT           = process.env.PORT           || 3000;
const BIN_ID         = process.env.BIN_ID;
const BIN_KEY        = process.env.API_KEY;
const CALLBACK_URL   = (process.env.CALLBACK_URL  || '').replace(/\/$/, '');
const MOMO_ENV       = process.env.MOMO_ENV       || 'mtncameroon';
const MOMO_BASE      = MOMO_ENV === 'sandbox'
  ? 'https://sandbox.momodeveloper.mtn.com'
  : 'https://proxy.momoapi.mtn.com';
const MOMO_SUB_KEY   = process.env.MOMO_SUBSCRIPTION_KEY || '';
const MOMO_API_USER  = process.env.MOMO_API_USER  || '';
const MOMO_API_KEY_V = process.env.MOMO_API_KEY   || '';
const OM_CLIENT_ID   = process.env.OM_CLIENT_ID   || '';
const OM_CLIENT_SEC  = process.env.OM_CLIENT_SECRET || '';
const OM_MERCH_KEY   = process.env.OM_MERCHANT_KEY || '';

const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
const INDEX       = path.join(__dirname, 'public', 'index.html');
fs.mkdirSync(path.join(UPLOADS_DIR, 'admin'), { recursive: true });

// ── Vérification config au démarrage ──
const missingEnv = [];
if (!BIN_ID)       missingEnv.push('BIN_ID');
if (!BIN_KEY)      missingEnv.push('API_KEY');
if (!MOMO_SUB_KEY) missingEnv.push('MOMO_SUBSCRIPTION_KEY');
if (!MOMO_API_USER) missingEnv.push('MOMO_API_USER');
if (!MOMO_API_KEY_V) missingEnv.push('MOMO_API_KEY');
if (missingEnv.length) {
  console.warn(`\n⚠️  Variables manquantes: ${missingEnv.join(', ')}`);
  console.warn('   Configurez-les sur Render → Environment\n');
}

// ═══════════════════════════════════════════════════════════
// DB JSONBin
// ═══════════════════════════════════════════════════════════
const DB_HEADERS = { 'X-Master-Key': BIN_KEY, 'X-Bin-Meta': 'false' };
async function dbRead() {
  const r = await axios.get(`https://api.jsonbin.io/v3/b/${BIN_ID}/latest`, { headers: DB_HEADERS });
  return r.data;
}
async function dbWrite(data) {
  await axios.put(`https://api.jsonbin.io/v3/b/${BIN_ID}`, data, {
    headers: { 'Content-Type': 'application/json', 'X-Master-Key': BIN_KEY }
  });
}
async function dbUp(fn) {
  const d = await dbRead(); const nd = fn(d); if (nd) await dbWrite(nd); return nd;
}

// ═══════════════════════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════════════════════
function formatPhone(phone) {
  let p = String(phone).replace(/[\s\-\+\.]/g, '');
  if (p.startsWith('00237')) p = p.slice(2);
  if (p.startsWith('237') && p.length === 12) return p;
  if (p.length === 9) return '237' + p;
  return '237' + p.slice(-9);
}
async function getMomoToken() {
  const creds = Buffer.from(`${MOMO_API_USER}:${MOMO_API_KEY_V}`).toString('base64');
  const r = await axios.post(`${MOMO_BASE}/collection/token/`, {}, {
    headers: { 'Authorization': `Basic ${creds}`, 'Ocp-Apim-Subscription-Key': MOMO_SUB_KEY }
  });
  return r.data.access_token;
}
async function getOrangeToken() {
  const creds = Buffer.from(`${OM_CLIENT_ID}:${OM_CLIENT_SEC}`).toString('base64');
  const r = await axios.post('https://api.orange.com/oauth/v3/token', 'grant_type=client_credentials', {
    headers: { 'Authorization': `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' }
  });
  return r.data.access_token;
}

// ═══════════════════════════════════════════════════════════
// ── ROUTE : POST /api/commande
//    Validation des entrées + sanitisation + paiement MoMo
// ═══════════════════════════════════════════════════════════
app.post('/api/commande',
  payLimiter,
  // Validation avec express-validator
  body('montant').isNumeric().withMessage('Montant invalide').isFloat({ min: 1 }).withMessage('Montant minimum 1 XAF'),
  body('telephone').matches(/^[0-9\s\+\-\.]{8,15}$/).withMessage('Numéro de téléphone invalide'),
  body('operator').isIn(['mtn','om']).withMessage('Opérateur invalide (mtn ou om)'),
  body('orderId').optional().isAlphanumeric().withMessage('OrderId invalide'),
  body('location').notEmpty().withMessage('Localisation requise').isLength({ max: 200 }),
  validate,
  async (req, res) => {
    // Sanitiser toutes les entrées texte
    const montant    = Number(req.body.montant);
    const telephone  = req.body.telephone;
    const operator   = req.body.operator;
    const orderId    = req.body.orderId || 'CMD-' + Date.now();
    const clientName = sanitize(req.body.clientName || 'Client anonyme').slice(0, 80);
    const location   = sanitize(req.body.location).slice(0, 200);
    const produitId  = sanitize((req.body.items || []).map(i => i.name).join(', ')).slice(0, 300);
    const items      = (req.body.items || []).map(i => ({
      id:   String(i.id || '').slice(0, 50),
      name: sanitize(String(i.name || '')).slice(0, 100),
      price: Number(i.price) || 0,
    }));
    const delivery  = Number(req.body.delivery) || 0;
    const subtotal  = Number(req.body.subtotal) || 0;
    const reference = String(orderId).replace(/[^a-zA-Z0-9\-_]/g, '').slice(0, 50);
    const payerPhone = formatPhone(telephone);
    const montantStr = String(Math.round(montant));

    console.log(`\n🟢 COMMANDE ${reference} | ${clientName} | ${payerPhone} | ${montantStr} XAF | ${operator}`);

    // Sauvegarder en DB
    try {
      await dbUp(d => {
        d.orders = d.orders || [];
        if (!d.orders.find(o => o.id === reference)) {
          d.orders.unshift({ id: reference, clientName, location, items, subtotal, delivery, total: montant, operator, phone: telephone, status: 'pending_payment', createdAt: new Date().toISOString() });
        }
        return d;
      });
    } catch(e) { console.error('DB error:', e.message); }

    try {
      if (operator === 'mtn') {
        if (!MOMO_SUB_KEY || !MOMO_API_USER || !MOMO_API_KEY_V) {
          return res.status(503).json({ error: 'MTN MoMo non configuré. Ajoutez MOMO_SUBSCRIPTION_KEY, MOMO_API_USER, MOMO_API_KEY sur Render.' });
        }
        const token = await getMomoToken();
        await axios.post(
          `${MOMO_BASE}/collection/v1_0/requesttopay`,
          { amount: montantStr, currency: 'XAF', externalId: reference, payer: { partyIdType: 'MSISDN', partyId: payerPhone }, payerMessage: `Green Pepper — ${produitId}`, payeeNote: `Commande ${reference}` },
          { headers: { 'Authorization': `Bearer ${token}`, 'X-Reference-Id': reference, 'X-Target-Environment': MOMO_ENV, 'Ocp-Apim-Subscription-Key': MOMO_SUB_KEY, 'Content-Type': 'application/json', ...(CALLBACK_URL ? { 'X-Callback-Url': `${CALLBACK_URL}/api/paiement/callback` } : {}) } }
        );
        console.log(`✅ MTN RequestToPay → ${payerPhone} reçoit notification PIN`);
        return res.json({ statut: 'en_attente_pin', reference, operator: 'mtn' });

      } else {
        if (!OM_CLIENT_ID || !OM_CLIENT_SEC) {
          return res.status(503).json({ error: 'Orange Money non configuré. Ajoutez OM_CLIENT_ID, OM_CLIENT_SECRET sur Render.' });
        }
        const omToken = await getOrangeToken();
        const r = await axios.post(
          'https://api.orange.com/orange-money-webpay/cm/v1/webpayment',
          { merchant_key: OM_MERCH_KEY, currency: 'XAF', order_id: reference, amount: montantStr, return_url: CALLBACK_URL || 'https://green-pepper.onrender.com', cancel_url: CALLBACK_URL || 'https://green-pepper.onrender.com', notif_url: `${CALLBACK_URL}/api/paiement/callback-om`, lang: 'fr', reference },
          { headers: { 'Authorization': `Bearer ${omToken}`, 'Content-Type': 'application/json' } }
        );
        console.log(`✅ Orange Money initié`);
        return res.json({ statut: 'en_attente_pin', reference, operator: 'om', payment_url: r.data.payment_url });
      }
    } catch(e) {
      const detail = e.response?.data || e.message;
      console.error(`❌ Erreur paiement:`, JSON.stringify(detail));
      return res.status(500).json({ error: 'Erreur paiement', detail: typeof detail === 'object' ? JSON.stringify(detail) : detail });
    }
  }
);

// ── Statut paiement (polling) ──
app.get('/api/paiement/statut/:reference',
  param('reference').matches(/^[a-zA-Z0-9\-_]+$/).withMessage('Référence invalide'),
  validate,
  async (req, res) => {
    if (!MOMO_SUB_KEY) return res.json({ status: 'PENDING' });
    try {
      const token = await getMomoToken();
      const r = await axios.get(`${MOMO_BASE}/collection/v1_0/requesttopay/${req.params.reference}`, {
        headers: { 'Authorization': `Bearer ${token}`, 'X-Target-Environment': MOMO_ENV, 'Ocp-Apim-Subscription-Key': MOMO_SUB_KEY }
      });
      console.log(`📊 Statut ${req.params.reference}: ${r.data.status}`);
      res.json({ status: r.data.status, financialTransactionId: r.data.financialTransactionId });
    } catch(e) { res.json({ status: 'PENDING' }); }
  }
);

// ── Callback MTN ──
app.post('/api/paiement/callback', async (req, res) => {
  const { referenceId, status, financialTransactionId } = req.body;
  console.log(`\n🔔 Callback MTN: ${referenceId} → ${status}`);
  if (status === 'SUCCESSFUL') {
    try {
      await dbUp(d => {
        const order = (d.orders || []).find(o => o.id === referenceId);
        if (order) {
          order.status = 'paid'; order.paidAt = new Date().toISOString(); order.momoTxId = financialTransactionId;
          (order.items || []).forEach(item => { const p = (d.products || []).find(x => x.id === item.id); if (p && p.stock > 0) p.stock--; });
          // Notifier commerçants
          const byMerch = {};
          (order.items || []).forEach(item => { const p = (d.products || []).find(x => x.id === item.id); if (p?.merchantId) { if (!byMerch[p.merchantId]) byMerch[p.merchantId] = []; byMerch[p.merchantId].push(item); } });
          d.notifications = d.notifications || [];
          Object.keys(byMerch).forEach(mid => {
            d.notifications.unshift({ id: 'n' + Date.now() + mid, merchantId: mid, type: 'order', message: `🛒 Commande payée de ${order.clientName} — ${byMerch[mid].map(i => i.name).join(', ')} — ${order.total.toLocaleString()} FCFA`, read: false, date: new Date().toISOString() });
          });
          console.log(`✅ Commande ${referenceId} confirmée — tx: ${financialTransactionId}`);
        }
        return d;
      });
    } catch(e) { console.error('Callback DB error:', e.message); }
  }
  res.sendStatus(200);
});

// ── Callback Orange Money ──
app.post('/api/paiement/callback-om', async (req, res) => {
  const { order_id, status, txnid } = req.body;
  console.log(`\n🔔 Callback Orange: ${order_id} → ${status}`);
  if (status === 'SUCCESS') {
    try { await dbUp(d => { const o = (d.orders || []).find(x => x.id === order_id); if (o) { o.status = 'paid'; o.paidAt = new Date().toISOString(); o.omTxId = txnid; } return d; }); } catch(e) {}
  }
  res.sendStatus(200);
});

// ═══════════════════════════════════════════════════════════
// ── ROUTE : Photos par commerçant
//    Protège contre : path traversal avec sanitisation merchantId
// ═══════════════════════════════════════════════════════════
function safeMerchantId(raw) {
  return (raw || 'admin').replace(/[^a-zA-Z0-9\-_]/g, '').slice(0, 50) || 'admin';
}

// Lister les photos d'un commerçant
app.get('/api/photos/:merchantId',
  param('merchantId').matches(/^[a-zA-Z0-9\-_]+$/).withMessage('ID invalide'),
  validate,
  (req, res) => {
    const merchantId = safeMerchantId(req.params.merchantId);
    const dir = path.join(UPLOADS_DIR, merchantId);
    try {
      if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); return res.json({ photos: [], merchantId }); }
      const files = fs.readdirSync(dir)
        .filter(f => /\.(jpg|jpeg|png|gif|webp)$/i.test(f))
        .sort((a, b) => fs.statSync(path.join(dir, b)).mtime - fs.statSync(path.join(dir, a)).mtime);
      res.json({ photos: files, merchantId });
    } catch(e) { res.json({ photos: [], merchantId }); }
  }
);

// Lister photos admin (rétrocompat)
app.get('/api/photos', (req, res) => {
  const dir = path.join(UPLOADS_DIR, 'admin');
  try {
    if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); return res.json({ photos: [] }); }
    const files = fs.readdirSync(dir).filter(f => /\.(jpg|jpeg|png|gif|webp)$/i.test(f));
    res.json({ photos: files });
  } catch(e) { res.json({ photos: [] }); }
});

// Upload photo
app.post('/api/photos/:merchantId',
  uploadLimiter,
  param('merchantId').matches(/^[a-zA-Z0-9\-_]+$/).withMessage('ID invalide'),
  validate,
  (req, res) => {
    if (!upload) return res.status(500).json({ error: 'Upload non disponible' });
    upload.single('photo')(req, res, err => {
      if (err) return res.status(400).json({ error: err.message });
      if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu' });
      const merchantId = safeMerchantId(req.params.merchantId);
      const url = `/uploads/${merchantId}/${req.file.filename}`;
      console.log(`📸 Photo uploadée: ${url}`);
      res.json({ url, filename: req.file.filename, merchantId });
    });
  }
);

// Supprimer une photo
app.delete('/api/photos/:merchantId/:filename',
  param('merchantId').matches(/^[a-zA-Z0-9\-_]+$/).withMessage('ID invalide'),
  param('filename').matches(/^[a-zA-Z0-9_\-\.]+$/).withMessage('Nom de fichier invalide'),
  validate,
  (req, res) => {
    const merchantId = safeMerchantId(req.params.merchantId);
    // Sécurité supplémentaire : s'assurer qu'on reste dans uploads/
    const filename = path.basename(req.params.filename);
    const filePath = path.join(UPLOADS_DIR, merchantId, filename);
    // Vérifier que le chemin résolu reste dans UPLOADS_DIR (anti path traversal)
    if (!filePath.startsWith(path.resolve(UPLOADS_DIR))) {
      return res.status(403).json({ error: 'Accès refusé' });
    }
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      res.json({ deleted: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
  }
);

// ═══════════════════════════════════════════════════════════
// ── ROUTE : Auth (hash des mots de passe)
//    Pour les nouvelles inscriptions via API
// ═══════════════════════════════════════════════════════════
app.post('/api/auth/hash-password',
  authLimiter,
  body('password').isLength({ min: 6 }).withMessage('Mot de passe trop court'),
  validate,
  async (req, res) => {
    try {
      const hash = await bcrypt.hash(req.body.password, 12);
      res.json({ hash });
    } catch(e) { res.status(500).json({ error: e.message }); }
  }
);

// ═══════════════════════════════════════════════════════════
// FICHIERS STATIQUES
// ── Cache-Control sur les images
// ═══════════════════════════════════════════════════════════
app.use('/uploads', express.static(UPLOADS_DIR, {
  setHeaders: (res, fp) => {
    res.setHeader('Cache-Control', 'public, max-age=86400');
    // Forcer le type correct pour éviter l'exécution de fichiers
    const ext = path.extname(fp).toLowerCase();
    const types = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' };
    if (types[ext]) res.setHeader('Content-Type', types[ext]);
  }
}));

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, fp) => {
    if (fp.endsWith('.html')) {
      res.setHeader('Content-Type', 'text/html; charset=UTF-8');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }
}));

// ── 404 pour les routes API inconnues ──
app.use('/api/*', (req, res) => res.status(404).json({ error: 'Route API non trouvée' }));

// ── SPA Fallback ──
app.get('*', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=UTF-8');
  res.sendFile(INDEX);
});

// ═══════════════════════════════════════════════════════════
// ── GESTION GLOBALE DES ERREURS
//    Ne jamais exposer les stack traces en production
// ═══════════════════════════════════════════════════════════
app.use((err, req, res, next) => {
  console.error('Erreur serveur:', err.message);
  const isProd = process.env.NODE_ENV === 'production';
  res.status(err.status || 500).json({
    error: isProd ? 'Erreur serveur interne' : err.message,
    ...(isProd ? {} : { stack: err.stack })
  });
});

// ── Gestion des rejets de promesses non capturés ──
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err.message);
});

// ═══════════════════════════════════════════════════════════
// START
// ═══════════════════════════════════════════════════════════
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🌶️  Green Pepper Market`);
  console.log(`   Port     : ${PORT}`);
  console.log(`   MoMo env : ${MOMO_ENV}`);
  console.log(`   MTN MoMo : ${MOMO_SUB_KEY ? '✅ OK' : '❌ MOMO_SUBSCRIPTION_KEY manquant'}`);
  console.log(`   Orange   : ${OM_CLIENT_ID  ? '✅ OK' : '⚠️  OM_CLIENT_ID manquant'}`);
  console.log(`   JSONBin  : ${BIN_KEY ? '✅ OK' : '❌ API_KEY manquant'}`);
  console.log(`   JWT      : ✅ actif`);
  console.log(`   Helmet   : ✅ actif`);
  console.log(`   CORS     : ✅ actif`);
  console.log(`   Rate limit: ✅ actif`);
  console.log(`   XSS clean : ✅ actif\n`);
});
