'use strict';
require('dotenv').config();
const express      = require('express');
const path         = require('path');
const fs           = require('fs');
const helmet       = require('helmet');
const cors         = require('cors');
const rateLimit    = require('express-rate-limit');
const mongoSan     = require('express-mongo-sanitize');
const cookieParser = require('cookie-parser');
const { v4: uuidv4 } = require('uuid');

const connectDB        = require('./src/config/db');
const productRoutes    = require('./src/routes/product.routes');
const paymentRoutes    = require('./src/routes/payment.routes');

const app     = express();
const PORT    = process.env.PORT || 3000;
const ALLOWED = (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean);
const INDEX   = path.join(__dirname, 'public', 'index.html');

// ── Trust proxy (Render / Heroku / Railway) ──
app.set('trust proxy', 1);

// ── Helmet ──
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "https://cdn.tailwindcss.com", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com", "'unsafe-inline'"],
      styleSrc:   ["'self'", "https://cdn.tailwindcss.com", "https://fonts.googleapis.com", "'unsafe-inline'"],
      fontSrc:    ["'self'", "https://fonts.gstatic.com"],
      imgSrc:     ["'self'", "data:", "blob:", "https:"],
      connectSrc: ["'self'", "https://proxy.momoapi.mtn.com", "https://sandbox.momodeveloper.mtn.com", "https://api.orange.com"],
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
app.use((req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

// ── CORS ──
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED.length === 0 || ALLOWED.includes(origin)) return cb(null, true);
    cb(new Error('CORS bloqué: ' + origin));
  },
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
  credentials: true,
  maxAge: 86400,
}));

// ── Rate limiting ──
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Trop de requêtes. Réessayez dans 15 minutes.' },
  skip: () => process.env.NODE_ENV !== 'production',
}));

// ── Body parsing + sanitisation ──
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(cookieParser());
app.use(mongoSan());

// ── Routes API ──
app.use('/api/products', productRoutes);
app.use('/api',          paymentRoutes);

// ── Health check ──
app.get('/health', (req, res) => {
  const mongoose = require('mongoose');
  res.json({
    status:    'ok',
    db:        mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    uptime:    Math.floor(process.uptime()),
    memory:    Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB',
    timestamp: new Date().toISOString(),
  });
});

// ── Fichiers statiques ──
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, fp) => {
    if (fp.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Content-Type', 'text/html; charset=UTF-8');
    }
  },
}));

// ── SPA fallback ──
app.use('/api/*', (req, res) => res.status(404).json({ error: 'Route non trouvée' }));
app.get('*', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(INDEX);
});

// ── Erreurs globales ──
app.use((err, req, res, next) => {
  console.error(`❌ [${new Date().toISOString()}] ${err.message}`);
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production' ? 'Erreur serveur' : err.message,
  });
});

// ── Résilience processus ──
process.on('unhandledRejection', r => console.error('⚠️  UnhandledRejection:', r));
process.on('uncaughtException',  e => console.error('💥 UncaughtException:', e.message));
process.on('SIGTERM', () => { console.log('📴 Arrêt propre'); process.exit(0); });
process.on('SIGINT',  () => { console.log('📴 Arrêt propre'); process.exit(0); });

// ── Connexion MongoDB → démarrage serveur ──
connectDB().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🌶️  Green Pepper Market — port ${PORT}`);
    console.log(`   MongoDB   : ✅ connecté`);
    console.log(`   MTN MoMo  : ${process.env.MOMO_SUBSCRIPTION_KEY ? '✅' : '❌ clé manquante'}`);
    console.log(`   Orange    : ${process.env.OM_CLIENT_ID ? '✅' : '⚠️  clé manquante'}`);
    console.log(`   Index     : ${fs.existsSync(INDEX) ? '✅' : '❌ INTROUVABLE'}`);
    console.log(`   Env       : ${process.env.NODE_ENV || 'development'}\n`);
  });
}).catch(err => {
  console.error('❌ Impossible de démarrer — MongoDB:', err.message);
  process.exit(1);
});
