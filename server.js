'use strict';
require('dotenv').config();
const express    = require('express');
const axios      = require('axios');
const path       = require('path');
const fs         = require('fs');
const helmet     = require('helmet');
const cors       = require('cors');
const rateLimit  = require('express-rate-limit');
const mongoSan   = require('express-mongo-sanitize');
const cookieP    = require('cookie-parser');
const XSS        = require('xss');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const { body, param, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');

const app = express();

// ══════════════════════════════════════════════
// TRUST PROXY — obligatoire sur Render
// Sans ça : crash ERR_ERL_UNEXPECTED_X_FORWARDED_FOR
// ══════════════════════════════════════════════
app.set('trust proxy', 1);

// ══════════════════════════════════════════════
// CONFIG
// ══════════════════════════════════════════════
const PORT        = process.env.PORT                  || 3000;
const BIN_ID      = process.env.BIN_ID;
const BIN_KEY     = process.env.API_KEY;
const CALLBACK    = (process.env.CALLBACK_URL || '').replace(/\/$/, '');
const MOMO_ENV    = process.env.MOMO_ENV              || 'mtncameroon';
const MOMO_BASE   = MOMO_ENV === 'sandbox'
  ? 'https://sandbox.momodeveloper.mtn.com'
  : 'https://proxy.momoapi.mtn.com';
const MOMO_SUB    = process.env.MOMO_SUBSCRIPTION_KEY || '';
const MOMO_USER   = process.env.MOMO_API_USER         || '';
const MOMO_KEY    = process.env.MOMO_API_KEY          || '';
const OM_ID       = process.env.OM_CLIENT_ID          || '';
const OM_SEC      = process.env.OM_CLIENT_SECRET      || '';
const OM_MKEY     = process.env.OM_MERCHANT_KEY       || '';
const JWT_SECRET  = process.env.JWT_SECRET            || uuidv4();
const ALLOWED     = (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean);
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
const INDEX       = path.join(__dirname, 'public', 'index.html');

// Créer dossiers au démarrage
[UPLOADS_DIR, path.join(UPLOADS_DIR, 'admin')].forEach(d => {
  try { fs.mkdirSync(d, { recursive: true }); } catch(e) {}
});

// ══════════════════════════════════════════════
// 1. HELMET
// ══════════════════════════════════════════════
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "https://fonts.googleapis.com", "'unsafe-inline'"],
      styleSrc:   ["'self'", "https://fonts.googleapis.com", "'unsafe-inline'"],
      fontSrc:    ["'self'", "https://fonts.gstatic.com"],
      imgSrc:     ["'self'", "data:", "blob:", "https:"],
      connectSrc: ["'self'", "https://api.jsonbin.io",
        "https://proxy.momoapi.mtn.com",
        "https://sandbox.momodeveloper.mtn.com",
        "https://api.orange.com"],
      frameSrc:  ["'none'"],
      objectSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  frameguard:     { action: 'deny' },
  noSniff:        true,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  hsts:           { maxAge: 31536000, includeSubDomains: true },
}));
app.use((req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

// ══════════════════════════════════════════════
// 2. CORS
// ══════════════════════════════════════════════
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED.length === 0 || ALLOWED.includes(origin)) return cb(null, true);
    cb(new Error('CORS: origine non autorisée'));
  },
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
  credentials: true,
  maxAge: 86400,
}));

// ══════════════════════════════════════════════
// 3. RATE LIMITING
// skip=false en prod, skip=true en dev local
// ══════════════════════════════════════════════
const mkLimit = (windowMs, max, msg) => rateLimit({
  windowMs, max,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: msg },
  skip: () => process.env.NODE_ENV !== 'production',
});
app.use(mkLimit(15*60*1000, 500, 'Trop de requêtes.'));
const payLimiter    = mkLimit(15*60*1000, 15, 'Trop de tentatives paiement.');
const authLimiter   = mkLimit(60*60*1000, 30, 'Trop de tentatives connexion.');
const uploadLimiter = mkLimit(60*60*1000, 60, "Trop d'uploads.");

// ══════════════════════════════════════════════
// 4. BODY + SANITISATION
// ══════════════════════════════════════════════
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(cookieP());
app.use(mongoSan());

function sanitize(s) {
  if (typeof s !== 'string') return s;
  return XSS(s.trim()).slice(0, 2000);
}
function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  next();
}

// ══════════════════════════════════════════════
// 5. MULTER — upload photos
// ══════════════════════════════════════════════
let upload = null;
try {
  const multer  = require('multer');
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      const mid = safeMID(req.params.merchantId || 'admin');
      const dir = path.join(UPLOADS_DIR, mid);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (!['.jpg','.jpeg','.png','.gif','.webp'].includes(ext))
        return cb(new Error('Extension non autorisée'));
      cb(null, `img_${Date.now()}_${uuidv4().slice(0,8)}${ext}`);
    },
  });
  upload = multer({
    storage,
    limits: { fileSize: 5*1024*1024, files: 1 },
    fileFilter: (req, file, cb) => {
      ['image/jpeg','image/png','image/gif','image/webp'].includes(file.mimetype)
        ? cb(null, true) : cb(new Error('Images uniquement'));
    },
  });
} catch(e) { console.warn('multer non dispo:', e.message); }

// ══════════════════════════════════════════════
// 6. CIRCUIT BREAKER — JSONBin
// Évite de bloquer si JSONBin est en panne
// ══════════════════════════════════════════════
let CB_FAILS = 0, CB_OPEN_UNTIL = 0;
const CB_MAX = 5, CB_TIMEOUT = 60000;

async function dbRead() {
  if (!BIN_ID || !BIN_KEY) throw new Error('BIN_ID ou API_KEY manquant');
  if (CB_FAILS >= CB_MAX && Date.now() < CB_OPEN_UNTIL)
    throw new Error('Circuit breaker ouvert — JSONBin temporairement inaccessible');
  try {
    const r = await axios.get(
      `https://api.jsonbin.io/v3/b/${BIN_ID}/latest`,
      { headers: { 'X-Master-Key': BIN_KEY, 'X-Bin-Meta': 'false' }, timeout: 10000 }
    );
    CB_FAILS = 0;
    return r.data;
  } catch(e) {
    if (++CB_FAILS >= CB_MAX) {
      CB_OPEN_UNTIL = Date.now() + CB_TIMEOUT;
      console.error(`⚡ Circuit breaker ouvert (${CB_FAILS} échecs JSONBin)`);
    }
    throw e;
  }
}
async function dbWrite(data) {
  if (!BIN_ID || !BIN_KEY) throw new Error('BIN_ID ou API_KEY manquant');
  await axios.put(
    `https://api.jsonbin.io/v3/b/${BIN_ID}`,
    data,
    { headers: { 'Content-Type': 'application/json', 'X-Master-Key': BIN_KEY }, timeout: 10000 }
  );
}
async function dbUp(fn) {
  const d = await dbRead();
  const nd = fn(d);
  if (nd) await dbWrite(nd);
  return nd;
}

// ══════════════════════════════════════════════
// UTILS
// ══════════════════════════════════════════════
function safeMID(raw) {
  return String(raw || 'admin').replace(/[^a-zA-Z0-9\-_]/g,'').slice(0,50) || 'admin';
}
function formatPhone(p) {
  p = String(p).replace(/[\s\-\+\.]/g,'');
  if (p.startsWith('00237')) p = p.slice(2);
  if (p.startsWith('237') && p.length === 12) return p;
  return '237' + p.slice(-9);
}
async function getMomoToken() {
  const creds = Buffer.from(`${MOMO_USER}:${MOMO_KEY}`).toString('base64');
  const r = await axios.post(`${MOMO_BASE}/collection/token/`, {},
    { headers: { 'Authorization': `Basic ${creds}`, 'Ocp-Apim-Subscription-Key': MOMO_SUB }, timeout: 15000 });
  return r.data.access_token;
}
async function getOrangeToken() {
  const creds = Buffer.from(`${OM_ID}:${OM_SEC}`).toString('base64');
  const r = await axios.post('https://api.orange.com/oauth/v3/token',
    'grant_type=client_credentials',
    { headers: { 'Authorization': `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 });
  return r.data.access_token;
}

// ══════════════════════════════════════════════
// HEALTH CHECK — Render le ping pour garder le service actif
// ══════════════════════════════════════════════
// ── SEED DATA (à supprimer après test) ──
app.get('/seed-juices', async (req, res) => {
  try {
    let Product;
    try { Product = require('./src/models/Product'); } catch(e) { return res.send('MongoDB non connecté'); }
    const count = await Product.countDocuments();
    if (count > 0) return res.send(`Déjà ${count} produits - <a href='/api/products'>voir /api/products</a>`);
    await Product.insertMany([
      { name:"Jus Bissap",   price:1500, category:"jus", stock:100, sellerId:"admin", description:"Jus naturel" },
      { name:"Jus Baobab",   price:1500, category:"jus", stock:100, sellerId:"admin", description:"Jus naturel" },
      { name:"Jus Gingembre",price:1200, category:"jus", stock:100, sellerId:"admin", description:"Jus naturel" }
    ]);
    res.send("✅ 3 jus ajoutés ! <a href='/api/products'>voir /api/products</a>");
  } catch(e) { res.status(500).send("Erreur: " + e.message); }
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    memory: Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB',
    circuit: CB_FAILS >= CB_MAX ? 'open' : 'closed',
    index_exists: fs.existsSync(INDEX),
    timestamp: new Date().toISOString(),
  });
});

// ══════════════════════════════════════════════
// PAIEMENT
// ══════════════════════════════════════════════
app.post('/api/commande',
  payLimiter,
  body('montant').isNumeric().isFloat({ min: 1 }),
  body('telephone').matches(/^[0-9\s\+\-\.]{8,15}$/),
  body('operator').isIn(['mtn','om']),
  body('location').notEmpty().isLength({ max: 300 }),
  validate,
  async (req, res) => {
    const montant    = Math.round(Number(req.body.montant));
    const telephone  = req.body.telephone;
    const operator   = req.body.operator;
    const reference  = (req.body.orderId || 'CMD-'+Date.now()).replace(/[^a-zA-Z0-9\-_]/g,'').slice(0,50);
    const clientName = sanitize(req.body.clientName || 'Client anonyme').slice(0,80);
    const location   = sanitize(req.body.location).slice(0,300);
    const items      = (req.body.items||[]).map(i=>({ id:String(i.id||'').slice(0,50), name:sanitize(String(i.name||'')).slice(0,100), price:Number(i.price)||0 }));
    const payerPhone = formatPhone(telephone);
    console.log(`🟢 ${reference} | ${clientName} | ${payerPhone} | ${montant} XAF | ${operator}`);
    try {
      await dbUp(d=>{
        d.orders=d.orders||[];
        if(!d.orders.find(o=>o.id===reference))
          d.orders.unshift({id:reference,clientName,location,items,subtotal:Number(req.body.subtotal)||0,delivery:Number(req.body.delivery)||0,total:montant,operator,phone:telephone,status:'pending_payment',date:new Date().toISOString()});
        return d;
      });
    } catch(e){ console.error('DB save:', e.message); }
    try {
      if (operator==='mtn') {
        if (!MOMO_SUB||!MOMO_USER||!MOMO_KEY) return res.status(503).json({error:'MTN MoMo non configuré. Ajoutez MOMO_SUBSCRIPTION_KEY, MOMO_API_USER, MOMO_API_KEY sur Render.'});
        const token = await getMomoToken();
        await axios.post(`${MOMO_BASE}/collection/v1_0/requesttopay`,
          {amount:String(montant),currency:'XAF',externalId:reference,payer:{partyIdType:'MSISDN',partyId:payerPhone},payerMessage:`Green Pepper — ${items.map(i=>i.name).join(', ')}`,payeeNote:`Commande ${reference}`},
          {headers:{'Authorization':`Bearer ${token}`,'X-Reference-Id':reference,'X-Target-Environment':MOMO_ENV,'Ocp-Apim-Subscription-Key':MOMO_SUB,'Content-Type':'application/json',...(CALLBACK?{'X-Callback-Url':`${CALLBACK}/api/paiement/callback`}:{})},timeout:20000});
        console.log(`✅ MTN RequestToPay → ${payerPhone}`);
        return res.json({statut:'en_attente_pin',reference,operator:'mtn'});
      } else {
        if (!OM_ID||!OM_SEC) return res.status(503).json({error:'Orange Money non configuré.'});
        const tok = await getOrangeToken();
        const r = await axios.post('https://api.orange.com/orange-money-webpay/cm/v1/webpayment',
          {merchant_key:OM_MKEY,currency:'XAF',order_id:reference,amount:String(montant),return_url:CALLBACK||'/',cancel_url:CALLBACK||'/',notif_url:`${CALLBACK}/api/paiement/callback-om`,lang:'fr',reference},
          {headers:{'Authorization':`Bearer ${tok}`,'Content-Type':'application/json'},timeout:20000});
        return res.json({statut:'en_attente_pin',reference,operator:'om',payment_url:r.data.payment_url});
      }
    } catch(e) {
      const d = e.response?.data||e.message;
      console.error(`❌ Paiement:`,JSON.stringify(d));
      return res.status(500).json({error:'Erreur paiement',detail:typeof d==='object'?JSON.stringify(d):d});
    }
  }
);

app.get('/api/paiement/statut/:ref',
  param('ref').matches(/^[a-zA-Z0-9\-_]+$/), validate,
  async (req,res) => {
    if (!MOMO_SUB) return res.json({status:'PENDING'});
    try {
      const token = await getMomoToken();
      const r = await axios.get(`${MOMO_BASE}/collection/v1_0/requesttopay/${req.params.ref}`,
        {headers:{'Authorization':`Bearer ${token}`,'X-Target-Environment':MOMO_ENV,'Ocp-Apim-Subscription-Key':MOMO_SUB},timeout:10000});
      console.log(`📊 ${req.params.ref}: ${r.data.status}`);
      res.json({status:r.data.status,financialTransactionId:r.data.financialTransactionId});
    } catch(e){ res.json({status:'PENDING'}); }
  }
);

app.post('/api/paiement/callback', async (req,res) => {
  const {referenceId,status,financialTransactionId} = req.body;
  console.log(`🔔 MTN: ${referenceId} → ${status}`);
  if (status==='SUCCESSFUL') {
    try {
      await dbUp(d=>{
        const o=(d.orders||[]).find(x=>x.id===referenceId);
        if(o){
          o.status='paid';o.paidAt=new Date().toISOString();o.momoTxId=financialTransactionId;
          (o.items||[]).forEach(item=>{const p=(d.products||[]).find(x=>x.id===item.id);if(p&&p.stock>0)p.stock--;});
          const byM={};
          (o.items||[]).forEach(item=>{const p=(d.products||[]).find(x=>x.id===item.id);if(p?.merchantId){byM[p.merchantId]=byM[p.merchantId]||[];byM[p.merchantId].push(item);}});
          d.notifications=d.notifications||[];
          Object.keys(byM).forEach(mid=>d.notifications.unshift({id:'n'+Date.now()+mid,merchantId:mid,type:'order',message:`🛒 Commande payée de ${o.clientName} — ${byM[mid].map(i=>i.name).join(', ')} — ${o.total.toLocaleString()} FCFA`,read:false,date:new Date().toISOString()}));
        }
        return d;
      });
    } catch(e){ console.error('Callback DB:', e.message); }
  }
  res.sendStatus(200);
});

app.post('/api/paiement/callback-om', async (req,res)=>{
  const {order_id,status,txnid}=req.body;
  if(status==='SUCCESS') try{ await dbUp(d=>{const o=(d.orders||[]).find(x=>x.id===order_id);if(o){o.status='paid';o.paidAt=new Date().toISOString();o.omTxId=txnid;}return d;}); }catch(e){}
  res.sendStatus(200);
});

// ══════════════════════════════════════════════
// PHOTOS
// ══════════════════════════════════════════════
app.get('/api/photos/:merchantId',
  param('merchantId').matches(/^[a-zA-Z0-9\-_]+$/), validate,
  (req,res)=>{
    const mid=safeMID(req.params.merchantId);const dir=path.join(UPLOADS_DIR,mid);
    try{if(!fs.existsSync(dir)){fs.mkdirSync(dir,{recursive:true});return res.json({photos:[],merchantId:mid});}
    const files=fs.readdirSync(dir).filter(f=>/\.(jpg|jpeg|png|gif|webp)$/i.test(f)).sort((a,b)=>fs.statSync(path.join(dir,b)).mtime-fs.statSync(path.join(dir,a)).mtime);
    res.json({photos:files,merchantId:mid});}catch(e){res.json({photos:[],merchantId:mid});}
  }
);
app.get('/api/photos',(req,res)=>{
  const dir=path.join(UPLOADS_DIR,'admin');
  try{res.json({photos:fs.existsSync(dir)?fs.readdirSync(dir).filter(f=>/\.(jpg|jpeg|png|gif|webp)$/i.test(f)):[]});}catch(e){res.json({photos:[]});}
});
app.post('/api/photos/:merchantId', uploadLimiter,
  param('merchantId').matches(/^[a-zA-Z0-9\-_]+$/), validate,
  (req,res)=>{
    if(!upload) return res.status(500).json({error:'Upload non disponible'});
    upload.single('photo')(req,res,err=>{
      if(err) return res.status(400).json({error:err.message});
      if(!req.file) return res.status(400).json({error:'Aucun fichier'});
      const mid=safeMID(req.params.merchantId);
      res.json({url:`/uploads/${mid}/${req.file.filename}`,filename:req.file.filename,merchantId:mid});
    });
  }
);
app.delete('/api/photos/:merchantId/:filename',
  param('merchantId').matches(/^[a-zA-Z0-9\-_]+$/),
  param('filename').matches(/^[a-zA-Z0-9_\-\.]+$/), validate,
  (req,res)=>{
    const mid=safeMID(req.params.merchantId);
    const fp=path.join(UPLOADS_DIR,mid,path.basename(req.params.filename));
    if(!fp.startsWith(path.resolve(UPLOADS_DIR))) return res.status(403).json({error:'Accès refusé'});
    try{if(fs.existsSync(fp))fs.unlinkSync(fp);res.json({deleted:true});}catch(e){res.status(500).json({error:e.message});}
  }
);

// ══════════════════════════════════════════════
// FICHIERS STATIQUES
// ══════════════════════════════════════════════
app.use('/uploads', express.static(UPLOADS_DIR, {
  setHeaders:(res,fp)=>{
    res.setHeader('Cache-Control','public, max-age=86400');
    const t={'.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.gif':'image/gif','.webp':'image/webp'};
    const ext=path.extname(fp).toLowerCase();if(t[ext])res.setHeader('Content-Type',t[ext]);
  }
}));

app.use(express.static(path.join(__dirname,'public'),{
  setHeaders:(res,fp)=>{
    if(fp.endsWith('.html')){
      res.setHeader('Content-Type','text/html; charset=UTF-8');
      res.setHeader('Cache-Control','no-cache, no-store, must-revalidate');
      res.setHeader('Pragma','no-cache');
      res.setHeader('Expires','0');
    }
  }
}));

app.use('/api/*',(req,res)=>res.status(404).json({error:'Route API non trouvée'}));

app.get('*',(req,res)=>{
  res.setHeader('Content-Type','text/html; charset=UTF-8');
  res.setHeader('Cache-Control','no-cache, no-store, must-revalidate');
  res.sendFile(INDEX);
});

// ══════════════════════════════════════════════
// ERREURS GLOBALES
// ══════════════════════════════════════════════
app.use((err,req,res,next)=>{
  console.error(`❌ [${new Date().toISOString()}] ${err.message}`);
  const isProd=process.env.NODE_ENV==='production';
  res.status(err.status||500).json({error:isProd?'Erreur serveur interne':err.message});
});

// ══════════════════════════════════════════════
// RÉSILIENCE — le serveur ne s'arrête JAMAIS
// ══════════════════════════════════════════════
process.on('unhandledRejection', r => console.error(`⚠️  UnhandledRejection: ${r}`));
process.on('uncaughtException',  e => console.error(`💥 UncaughtException: ${e.message}`));
process.on('SIGTERM', () => { console.log('📴 Arrêt propre'); process.exit(0); });
process.on('SIGINT',  () => { console.log('📴 Arrêt propre'); process.exit(0); });

// ══════════════════════════════════════════════
// DÉMARRAGE
// ══════════════════════════════════════════════
// Connexion MongoDB si MONGO_URI défini
let connectDB = null;
try {
  if (process.env.MONGO_URI) {
    connectDB = require('./src/config/db');
    connectDB().then(() => console.log('✅ MongoDB Atlas connecté'))
              .catch(e => console.warn('⚠️  MongoDB:', e.message));
  }
} catch(e) { console.warn('⚠️  MongoDB module absent:', e.message); }

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🌶️  Green Pepper Market — port ${PORT}`);
  console.log(`   JSONBin   : ${BIN_KEY  ? '✅' : '❌ API_KEY manquant'}`);
  console.log(`   MTN MoMo  : ${MOMO_SUB ? '✅' : '❌ MOMO_SUBSCRIPTION_KEY manquant'}`);
  console.log(`   Orange    : ${OM_ID    ? '✅' : '⚠️  OM_CLIENT_ID manquant'}`);
  console.log(`   Index     : ${fs.existsSync(INDEX) ? '✅' : '❌ INTROUVABLE: '+INDEX}`);
  console.log(`   Trust proxy: ✅  Helmet: ✅  Rate limit: ✅  Circuit CB: ✅\n`);
});
