'use strict';
require('dotenv').config();
require('./src/config/env'); // Validation Joi au démarrage

const express      = require('express');
const path         = require('path');
const fs           = require('fs');
const helmet       = require('helmet');
const cors         = require('cors');
const mongoSan     = require('express-mongo-sanitize');
const cookieParser = require('cookie-parser');
const hpp          = require('hpp');
const connectDB    = require('./src/config/db');
const logger       = require('./src/utils/logger');
const activityTracker = require('./src/middlewares/activityTracker');
const { global: globalLimit } = require('./src/middlewares/rateLimiters');
const { startOfflineCron }    = require('./src/jobs/offlineCron');
const { startDiscountExpiryCron } = require('./src/jobs/discountExpiryCron');
const apiRoutes    = require('./src/routes/index');

const app     = express();
const PORT    = process.env.PORT || 3000;
const INDEX   = path.join(__dirname, 'public', 'index.html');
const ALLOWED = (process.env.ALLOWED_ORIGINS || 'https://green-pepper.onrender.com,http://localhost:3000').split(',').map(s=>s.trim());

fs.mkdirSync(path.join(__dirname,'public','uploads'), { recursive:true });
fs.mkdirSync(path.join(__dirname,'invoices'), { recursive:true });
fs.mkdirSync(path.join(__dirname,'logs'), { recursive:true });

// ── Trust proxy (Render) ──
app.set('trust proxy', 1);

// ── Helmet ──
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "https://cdn.tailwindcss.com", "https://fonts.googleapis.com", "'unsafe-inline'"],
      styleSrc:   ["'self'", "https://cdn.tailwindcss.com", "https://fonts.googleapis.com", "'unsafe-inline'"],
      fontSrc:    ["'self'", "https://fonts.gstatic.com"],
      imgSrc:     ["'self'", "data:", "blob:", "https:"],
      connectSrc: ["'self'", "https://admin.kpay.site", "https://proxy.momoapi.mtn.com", "https://api.orange.com"],
      frameSrc:   ["'none'"],
      objectSrc:  ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  frameguard:     { action:'deny' },
  noSniff:        true,
  referrerPolicy: { policy:'strict-origin-when-cross-origin' },
  hsts:           { maxAge:31536000, includeSubDomains:true },
}));
app.use((req,res,next) => { res.setHeader('Permissions-Policy','camera=(),microphone=(),geolocation=()'); next(); });

// ── CORS ──
app.use(cors({
  origin: (origin, cb) => { if(!origin||ALLOWED.includes(origin)) return cb(null,true); cb(new Error('CORS bloqué: '+origin)); },
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
  credentials: true,
  maxAge: 86400,
}));

// ── Rate limit global ──
app.use(globalLimit);

// ── Body parsing + rawBody pour HMAC callback ──
// On capture le rawBody SEULEMENT pour /api/payment/callback via express.raw()
app.use('/api/payment/callback', (req, res, next) => {
  let data = Buffer.alloc(0);
  req.on('data', chunk => { data = Buffer.concat([data, chunk]); });
  req.on('end', () => { req.rawBody = data.toString('utf8'); next(); });
});
app.use(express.json({ limit:'2mb' }));
app.use(express.urlencoded({ extended:true, limit:'2mb' }));
app.use(cookieParser());
app.use(mongoSan());
app.use(hpp());

// ── Activity tracker ──
app.use(activityTracker);

// ── API ──
app.use('/api', apiRoutes);

// ── Health check ──
app.get('/health', (req, res) => {
  const mongoose = require('mongoose');
  res.json({ status:'ok', db:mongoose.connection.readyState===1?'connected':'disconnected', uptime:Math.floor(process.uptime()), memory:Math.round(process.memoryUsage().rss/1024/1024)+'MB', ts:new Date().toISOString() });
});

// ── Fichiers statiques ──
app.use('/uploads', express.static(path.join(__dirname,'public','uploads'), { setHeaders:(res)=>res.setHeader('Cache-Control','public,max-age=86400') }));
app.use(express.static(path.join(__dirname,'public'), {
  setHeaders:(res,fp) => {
    if(fp.endsWith('.html')) { res.setHeader('Cache-Control','no-cache,no-store,must-revalidate'); res.setHeader('Content-Type','text/html;charset=UTF-8'); }
  }
}));

app.use('/api/*', (req,res) => res.status(404).json({ error:'Route API introuvable' }));
app.get('*', (req,res) => { res.setHeader('Cache-Control','no-cache,no-store,must-revalidate'); res.sendFile(INDEX); });

// ── Erreurs ──
app.use((err, req, res, next) => {
  logger.error(`${req.method} ${req.path} — ${err.message} — ip=${req.ip}`);
  res.status(err.status||500).json({ error:process.env.NODE_ENV==='production'?'Erreur serveur':err.message });
});

// ── Résilience ──
process.on('unhandledRejection', r => logger.error('UnhandledRejection:'+r));
process.on('uncaughtException',  e => logger.error('UncaughtException:'+e.message));
process.on('SIGTERM', () => { logger.info('SIGTERM reçu'); process.exit(0); });
process.on('SIGINT',  () => { logger.info('SIGINT reçu');  process.exit(0); });

// ── Démarrage ──
connectDB().then(() => {
  startOfflineCron();
  startDiscountExpiryCron();
  app.listen(PORT, '0.0.0.0', () => {
    logger.info(`🌶️  Green Pepper Market — port ${PORT} — ${process.env.NODE_ENV}`);
    logger.info(`   MongoDB    : ✅`);
    logger.info(`   KPay       : ${process.env.KPAY_API_KEY?'✅':'❌ KPAY_API_KEY manquant'}`);
    logger.info(`   Index      : ${fs.existsSync(INDEX)?'✅':'❌ INTROUVABLE'}`);
  });
}).catch(e => { logger.error('MongoDB connexion échouée: '+e.message); process.exit(1); });
