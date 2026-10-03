require('dotenv').config();
const express       = require('express');
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

const app = express();

// ══════════════════════════════════════════════
// 1. HELMET — En-têtes HTTP sécurisés
// ══════════════════════════════════════════════
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "https://cdn.tailwindcss.com", "https://fonts.googleapis.com", "'unsafe-inline'"],
      styleSrc:   ["'self'", "https://fonts.googleapis.com", "'unsafe-inline'"],
      fontSrc:    ["'self'", "https://fonts.gstatic.com"],
      imgSrc:     ["'self'", "data:", "blob:", "https:"],
      connectSrc: ["'self'", "https://api.jsonbin.io", "https://proxy.momoapi.mtn.com", "https://sandbox.momodeveloper.mtn.com", "https://api.orange.com"],
      frameSrc:   ["'none'"],
      objectSrc:  ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  frameguard:  { action: 'deny' },
  noSniff:     true,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  hsts:        { maxAge: 31536000, includeSubDomains: true },
  dnsPrefetchControl: { allow: false },
}));
app.use((req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

// ══════════════════════════════════════════════
// 2. CORS
// ══════════════════════════════════════════════
const ALLOWED = (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED.length === 0 || ALLOWED.includes(origin)) return cb(null, true);
    cb(new Error('CORS: origine non autorisée'));
  },
  methods: ['GET','POST','PUT','DELETE'],
  allowedHeaders: ['Content-Type','Authorization'],
  credentials: true,
  maxAge: 86400,
}));

// ══════════════════════════════════════════════
// 3. RATE LIMITING
// ══════════════════════════════════════════════
app.use(rateLimit({ windowMs: 15*60*1000, max: 300, standardHeaders: true, legacyHeaders: false, message: { error: 'Trop de requêtes. Réessayez dans 15 minutes.' } }));
const payLimiter    = rateLimit({ windowMs: 15*60*1000, max: 10,  message: { error: 'Trop de tentatives de paiement.' } });
const authLimiter   = rateLimit({ windowMs: 60*60*1000, max: 20,  message: { error: 'Trop de tentatives de connexion.' } });
const uploadLimiter = rateLimit({ windowMs: 60*60*1000, max: 50,  message: { error: 'Trop d\'uploads.' } });

// ══════════════════════════════════════════════
// 4. BODY + COOKIE + SANITISATION
// ══════════════════════════════════════════════
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(cookieParser());
app.use(xssClean());             // nettoie req.body, req.query, req.params
app.use(mongoSanitize());        // bloque les injections NoSQL ($, .)

// ══════════════════════════════════════════════
// 5. MULTER — Upload sécurisé
// ══════════════════════════════════════════════
let upload = null;
try {
  const multer  = require('multer');
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      const mid = safeMID(req.params.merchantId);
      const dir = path.join(UPLOADS_DIR, mid);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (!['.jpg','.jpeg','.png','.gif','.webp'].includes(ext)) return cb(new Error('Extension non autorisée'));
      cb(null, 'img_' + Date.now() + '_' + uuidv4().slice(0,8) + ext);
    }
  });
  upload = multer({
    storage,
    limits: { fileSize: 5*1024*1024, files: 1 },
    fileFilter: (req, file, cb) => {
      const ok = ['image/jpeg','image/png','image/gif','image/webp'].includes(file.mimetype);
      ok ? cb(null, true) : cb(new Error('Images uniquement (JPEG, PNG, GIF, WEBP)'));
    }
  });
} catch(e) { console.log('multer non dispo'); }

// ══════════════════════════════════════════════
// CONFIG
// ══════════════════════════════════════════════
const PORT         = process.env.PORT                  || 3000;
const BIN_ID       = process.env.BIN_ID;
const BIN_KEY      = process.env.API_KEY;
const CALLBACK_URL = (process.env.CALLBACK_URL || '').replace(/\/$/, '');
const MOMO_ENV     = process.env.MOMO_ENV              || 'mtncameroon';
const MOMO_BASE    = MOMO_ENV === 'sandbox'
  ? 'https://sandbox.momodeveloper.mtn.com'
  : 'https://proxy.momoapi.mtn.com';
const MOMO_SUB    = process.env.MOMO_SUBSCRIPTION_KEY  || '';
const MOMO_USER   = process.env.MOMO_API_USER           || '';
const MOMO_APIKEY = process.env.MOMO_API_KEY            || '';
const OM_ID       = process.env.OM_CLIENT_ID            || '';
const OM_SEC      = process.env.OM_CLIENT_SECRET        || '';
const OM_MKEY     = process.env.OM_MERCHANT_KEY         || '';
const JWT_SECRET  = process.env.JWT_SECRET              || uuidv4();

const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
const INDEX       = path.join(__dirname, 'public', 'index.html');
fs.mkdirSync(path.join(UPLOADS_DIR, 'admin'), { recursive: true });

// ══════════════════════════════════════════════
// UTILS
// ══════════════════════════════════════════════
function safeMID(raw) { return (raw||'admin').replace(/[^a-zA-Z0-9\-_]/g,'').slice(0,50)||'admin'; }
function sanitize(s) { return typeof s==='string' ? XSS(s.trim()) : s; }
function validate(req,res,next){ const e=validationResult(req); if(!e.isEmpty()) return res.status(400).json({errors:e.array()}); next(); }

function formatPhone(p) {
  p = String(p).replace(/[\s\-\+\.]/g,'');
  if (p.startsWith('00237')) p = p.slice(2);
  if (p.startsWith('237') && p.length===12) return p;
  return '237' + p.slice(-9);
}

async function getMomoToken() {
  const creds = Buffer.from(`${MOMO_USER}:${MOMO_APIKEY}`).toString('base64');
  const r = await axios.post(`${MOMO_BASE}/collection/token/`,{},{
    headers:{'Authorization':`Basic ${creds}`,'Ocp-Apim-Subscription-Key':MOMO_SUB}
  });
  return r.data.access_token;
}
async function getOrangeToken() {
  const creds = Buffer.from(`${OM_ID}:${OM_SEC}`).toString('base64');
  const r = await axios.post('https://api.orange.com/oauth/v3/token','grant_type=client_credentials',{
    headers:{'Authorization':`Basic ${creds}`,'Content-Type':'application/x-www-form-urlencoded'}
  });
  return r.data.access_token;
}

// JSONBin
async function dbRead() {
  const r = await axios.get(`https://api.jsonbin.io/v3/b/${BIN_ID}/latest`,{
    headers:{'X-Master-Key':BIN_KEY,'X-Bin-Meta':'false'}
  });
  return r.data;
}
async function dbWrite(d) {
  await axios.put(`https://api.jsonbin.io/v3/b/${BIN_ID}`,d,{
    headers:{'Content-Type':'application/json','X-Master-Key':BIN_KEY}
  });
}
async function dbUp(fn){ const d=await dbRead(); const nd=fn(d); if(nd) await dbWrite(nd); return nd; }

// ══════════════════════════════════════════════
// ROUTES PAIEMENT
// ══════════════════════════════════════════════
app.post('/api/commande',
  payLimiter,
  body('montant').isNumeric().isFloat({min:1}),
  body('telephone').matches(/^[0-9\s\+\-\.]{8,15}$/),
  body('operator').isIn(['mtn','om']),
  body('location').notEmpty().isLength({max:200}),
  validate,
  async (req,res) => {
    const montant    = Number(req.body.montant);
    const telephone  = req.body.telephone;
    const operator   = req.body.operator;
    const reference  = (req.body.orderId||'CMD-'+Date.now()).replace(/[^a-zA-Z0-9\-_]/g,'').slice(0,50);
    const clientName = sanitize(req.body.clientName||'Anonyme').slice(0,80);
    const location   = sanitize(req.body.location).slice(0,200);
    const items      = (req.body.items||[]).map(i=>({id:String(i.id||'').slice(0,50),name:sanitize(String(i.name||'')).slice(0,100),price:Number(i.price)||0}));
    const payerPhone = formatPhone(telephone);
    const montantStr = String(Math.round(montant));

    console.log(`\n🟢 ${reference} | ${clientName} | ${payerPhone} | ${montantStr} XAF | ${operator}`);

    try { await dbUp(d=>{ d.orders=d.orders||[]; if(!d.orders.find(o=>o.id===reference)) d.orders.unshift({id:reference,clientName,location,items,subtotal:Number(req.body.subtotal)||0,delivery:Number(req.body.delivery)||0,total:montant,operator,phone:telephone,status:'pending_payment',createdAt:new Date().toISOString()}); return d; }); } catch(e){ console.error('DB:',e.message); }

    try {
      if (operator==='mtn') {
        if(!MOMO_SUB||!MOMO_USER||!MOMO_APIKEY) return res.status(503).json({error:'Clés MTN MoMo manquantes sur Render (MOMO_SUBSCRIPTION_KEY, MOMO_API_USER, MOMO_API_KEY)'});
        const token = await getMomoToken();
        await axios.post(`${MOMO_BASE}/collection/v1_0/requesttopay`,
          {amount:montantStr,currency:'XAF',externalId:reference,payer:{partyIdType:'MSISDN',partyId:payerPhone},payerMessage:`Green Pepper — ${items.map(i=>i.name).join(', ')}`,payeeNote:`Commande ${reference}`},
          {headers:{'Authorization':`Bearer ${token}`,'X-Reference-Id':reference,'X-Target-Environment':MOMO_ENV,'Ocp-Apim-Subscription-Key':MOMO_SUB,'Content-Type':'application/json',...(CALLBACK_URL?{'X-Callback-Url':`${CALLBACK_URL}/api/paiement/callback`}:{})}}
        );
        console.log(`✅ MTN RequestToPay → ${payerPhone}`);
        return res.json({statut:'en_attente_pin',reference,operator:'mtn'});
      } else {
        if(!OM_ID||!OM_SEC) return res.status(503).json({error:'Clés Orange Money manquantes (OM_CLIENT_ID, OM_CLIENT_SECRET)'});
        const tok = await getOrangeToken();
        const r = await axios.post('https://api.orange.com/orange-money-webpay/cm/v1/webpayment',
          {merchant_key:OM_MKEY,currency:'XAF',order_id:reference,amount:montantStr,return_url:CALLBACK_URL||'/',cancel_url:CALLBACK_URL||'/',notif_url:`${CALLBACK_URL}/api/paiement/callback-om`,lang:'fr',reference},
          {headers:{'Authorization':`Bearer ${tok}`,'Content-Type':'application/json'}}
        );
        console.log(`✅ Orange Money initié`);
        return res.json({statut:'en_attente_pin',reference,operator:'om',payment_url:r.data.payment_url});
      }
    } catch(e) {
      const d = e.response?.data||e.message;
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
      console.log(`📊 ${req.params.ref}: ${r.data.status}`);
      res.json({status:r.data.status,financialTransactionId:r.data.financialTransactionId});
    } catch(e){ res.json({status:'PENDING'}); }
  }
);

app.post('/api/paiement/callback', async (req,res) => {
  const {referenceId,status,financialTransactionId} = req.body;
  console.log(`\n🔔 MTN Callback: ${referenceId} → ${status}`);
  if(status==='SUCCESSFUL') {
    try {
      await dbUp(d=>{
        const o=(d.orders||[]).find(x=>x.id===referenceId);
        if(o){
          o.status='paid'; o.paidAt=new Date().toISOString(); o.momoTxId=financialTransactionId;
          (o.items||[]).forEach(item=>{const p=(d.products||[]).find(x=>x.id===item.id);if(p&&p.stock>0)p.stock--;});
          const byM={};
          (o.items||[]).forEach(item=>{const p=(d.products||[]).find(x=>x.id===item.id);if(p?.merchantId){if(!byM[p.merchantId])byM[p.merchantId]=[];byM[p.merchantId].push(item);}});
          d.notifications=d.notifications||[];
          Object.keys(byM).forEach(mid=>{d.notifications.unshift({id:'n'+Date.now()+mid,merchantId:mid,type:'order',message:`🛒 Commande payée de ${o.clientName} — ${byM[mid].map(i=>i.name).join(', ')} — ${o.total.toLocaleString()} FCFA`,read:false,date:new Date().toISOString()});});
          console.log(`✅ ${referenceId} payée — tx:${financialTransactionId}`);
        }
        return d;
      });
    } catch(e){ console.error('Callback DB:',e.message); }
  }
  res.sendStatus(200);
});

app.post('/api/paiement/callback-om', async (req,res) => {
  const {order_id,status,txnid}=req.body;
  if(status==='SUCCESS') try{ await dbUp(d=>{const o=(d.orders||[]).find(x=>x.id===order_id);if(o){o.status='paid';o.paidAt=new Date().toISOString();o.omTxId=txnid;}return d;}); }catch(e){}
  res.sendStatus(200);
});

// ══════════════════════════════════════════════
// ROUTES PHOTOS — un dossier par commerçant
// ══════════════════════════════════════════════
app.get('/api/photos/:merchantId',
  param('merchantId').matches(/^[a-zA-Z0-9\-_]+$/),
  validate,
  (req,res) => {
    const mid = safeMID(req.params.merchantId);
    const dir = path.join(UPLOADS_DIR,mid);
    try {
      if(!fs.existsSync(dir)){ fs.mkdirSync(dir,{recursive:true}); return res.json({photos:[],merchantId:mid}); }
      const files = fs.readdirSync(dir).filter(f=>/\.(jpg|jpeg|png|gif|webp)$/i.test(f)).sort((a,b)=>fs.statSync(path.join(dir,b)).mtime-fs.statSync(path.join(dir,a)).mtime);
      res.json({photos:files,merchantId:mid});
    } catch(e){ res.json({photos:[],merchantId:mid}); }
  }
);

app.get('/api/photos',(req,res)=>{
  const dir=path.join(UPLOADS_DIR,'admin');
  try{ if(!fs.existsSync(dir)){fs.mkdirSync(dir,{recursive:true});return res.json({photos:[]});} res.json({photos:fs.readdirSync(dir).filter(f=>/\.(jpg|jpeg|png|gif|webp)$/i.test(f))}); }catch(e){res.json({photos:[]});}
});

app.post('/api/photos/:merchantId',
  uploadLimiter,
  param('merchantId').matches(/^[a-zA-Z0-9\-_]+$/),
  validate,
  (req,res)=>{
    if(!upload) return res.status(500).json({error:'Upload non disponible'});
    upload.single('photo')(req,res,err=>{
      if(err) return res.status(400).json({error:err.message});
      if(!req.file) return res.status(400).json({error:'Aucun fichier reçu'});
      const mid=safeMID(req.params.merchantId);
      const url=`/uploads/${mid}/${req.file.filename}`;
      console.log(`📸 Photo: ${url}`);
      res.json({url,filename:req.file.filename,merchantId:mid});
    });
  }
);

app.delete('/api/photos/:merchantId/:filename',
  param('merchantId').matches(/^[a-zA-Z0-9\-_]+$/),
  param('filename').matches(/^[a-zA-Z0-9_\-\.]+$/),
  validate,
  (req,res)=>{
    const mid=safeMID(req.params.merchantId);
    const fp=path.join(UPLOADS_DIR,mid,path.basename(req.params.filename));
    if(!fp.startsWith(path.resolve(UPLOADS_DIR))) return res.status(403).json({error:'Accès refusé'});
    try{ if(fs.existsSync(fp)) fs.unlinkSync(fp); res.json({deleted:true}); }catch(e){res.status(500).json({error:e.message});}
  }
);

// ══════════════════════════════════════════════
// FICHIERS STATIQUES
// ══════════════════════════════════════════════
app.use('/uploads', express.static(UPLOADS_DIR,{
  setHeaders:(res,fp)=>{
    res.setHeader('Cache-Control','public,max-age=86400');
    const t={'.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.gif':'image/gif','.webp':'image/webp'};
    const ext=path.extname(fp).toLowerCase(); if(t[ext]) res.setHeader('Content-Type',t[ext]);
  }
}));
app.use(express.static(path.join(__dirname,'public'),{
  setHeaders:(res,fp)=>{ if(fp.endsWith('.html')){ res.setHeader('Content-Type','text/html;charset=UTF-8'); res.setHeader('Cache-Control','no-cache,no-store,must-revalidate'); } }
}));
app.use('/api/*',(req,res)=>res.status(404).json({error:'Route non trouvée'}));
app.get('*',(req,res)=>{ res.setHeader('Content-Type','text/html;charset=UTF-8'); res.sendFile(INDEX); });

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
  console.log(`   MTN MoMo : ${MOMO_SUB?'✅':'❌ MOMO_SUBSCRIPTION_KEY manquant'}`);
  console.log(`   Orange   : ${OM_ID?'✅':'⚠️  OM_CLIENT_ID manquant'}`);
  console.log(`   JSONBin  : ${BIN_KEY?'✅':'❌ API_KEY manquant'}`);
  console.log(`   Sécurité : helmet ✅ cors ✅ rateLimit ✅ xss ✅ mongoSanitize ✅\n`);
});
