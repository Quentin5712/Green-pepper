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
const ALLOWED = (process.env.ALLOWED_ORIGINS || 'https://investpro-fxar.onrender.com,https://green-pepper.onrender.com,http://localhost:3000').split(',').map(s=>s.trim());

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
      connectSrc: ["'self'", "https://kpay.site", "https://admin.kpay.site", "https://api.kpay.site", "https://proxy.momoapi.mtn.com", "https://api.orange.com"],
      scriptSrcAttr: ["'unsafe-inline'"],
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
app.use(cors((req, cb) => {
  const origin = req.header('Origin');
  const selfOrigin = `${req.protocol}://${req.get('host')}`;
  const ok = !origin || origin === selfOrigin || ALLOWED.includes(origin);
  cb(null, {
    origin: ok,
    methods: ['GET','POST','PUT','DELETE','OPTIONS'],
    allowedHeaders: ['Content-Type','Authorization'],
    credentials: true,
    maxAge: 86400,
  });
}));

// ── Rate limit global ──
app.use('/api', globalLimit);

// ── Body parsing (+ rawBody conservé pour vérifier la signature HMAC du webhook) ──
app.use(express.json({ limit:'2mb', verify: (req, res, buf) => { req.rawBody = buf.toString('utf8'); } }));
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

// ── KPAY - NE PAS EFFACER ──

// 1. Fichier de vérification du domaine
app.get('/.well-known/kpay-verification.txt', (req, res) => {
  res.type('text/plain').send('6a71101356ed2153f85a2eed3a1f5223');
});

// 2. Webhook KPay - KPay appelle cette adresse quand quelqu'un paie
// URL à mettre dans KPay : https://investpro-fxar.onrender.com/api/kpay/webhook
app.post('/api/kpay/webhook', (req, res) => {
  try {
    console.log('📩 Webhook KPay reçu :', JSON.stringify(req.body));
    const event = req.body;
    if (event.status === 'SUCCESS' || event.data?.status === 'SUCCESS') {
      console.log('✅ Paiement réussi pour :', event.reference || event.data?.reference);
      // TODO: ici tu mets à jour ta commande en base comme "payée"
    }
    // Toujours répondre 200, sinon KPay renvoie le webhook 10 fois
    res.status(200).json({ received: true });
  } catch (e) {
    console.error('Erreur webhook KPay:', e.message);
    res.status(200).json({ received: true });
  }
});

// 3. Créer un paiement - ton bouton "Payer" appelle cette adresse
app.post('/api/kpay/pay', async (req, res) => {
  try {
    const { amount, phone, reference, description } = req.body;
    if (!amount || !phone) {
      return res.status(400).json({ error: 'Montant et numéro de téléphone requis' });
    }
    const response = await fetch('https://api.kpay.site/api/v1/payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.KPAY_API_KEY}`,
      },
      body: JSON.stringify({
        amount: Number(amount),
        phone: phone,
        reference: reference || 'INV-' + Date.now(),
        description: description || 'Paiement InvestPro',
        callback_url: 'https://investpro-fxar.onrender.com/api/kpay/webhook',
        return_url: 'https://investpro-fxar.onrender.com/success',
      }),
    });
    const data = await response.json();
    console.log('KPay réponse:', data);
    res.status(response.status).json(data);
  } catch (e) {
    console.error('Erreur KPay pay:', e.message);
    res.status(500).json({ error: 'Erreur lors de la création du paiement' });
  }
});

// ── Fichiers statiques ──
app.use('/uploads', express.static(path.join(__dirname,'public','uploads'), { setHeaders:(res)=>res.setHeader('Cache-Control','public,max-age=86400') }));
app.use(express.static(path.join(__dirname,'public'), {
  dotfiles: 'allow',
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
