// ═══════════════════════════════════════════════════════════
// server.js — Green Pepper Market
// MTN MoMo RequestToPay PRODUCTION
// Photos par commerçant : /public/uploads/{merchantId}/
// ═══════════════════════════════════════════════════════════
const express = require('express');
const axios   = require('axios');
const path    = require('path');
const fs      = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json({ limit: '10mb' }));

// ── MULTER (upload photos) ──
let upload = null;
try {
  const multer  = require('multer');
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      const merchantId = req.params.merchantId || 'admin';
      const dir = path.join(__dirname, 'public', 'uploads', merchantId);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || '.jpg';
      cb(null, 'img_' + Date.now() + ext);
    }
  });
  upload = multer({
    storage,
    limits: { fileSize: 8 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      if (/image\/(jpeg|png|gif|webp)/.test(file.mimetype)) cb(null, true);
      else cb(new Error('Image uniquement'));
    }
  });
} catch(e) { console.log('multer non disponible'); }

// ── CONFIG ──
const PORT           = process.env.PORT           || 3000;
const BIN_ID         = process.env.BIN_ID         || '6a4cdd5cf5f4af5e296bb50b';
const BIN_KEY        = process.env.API_KEY;
const MERCHANT_PHONE = process.env.MERCHANT_PHONE || '651364481';
const CALLBACK_URL   = process.env.CALLBACK_URL   || '';

// MTN MoMo
const MOMO_ENV       = process.env.MOMO_ENV              || 'mtncameroon'; // production
const MOMO_BASE      = MOMO_ENV === 'sandbox'
  ? 'https://sandbox.momodeveloper.mtn.com'
  : 'https://proxy.momoapi.mtn.com';
const MOMO_SUB_KEY   = process.env.MOMO_SUBSCRIPTION_KEY || '';
const MOMO_API_USER  = process.env.MOMO_API_USER          || '';
const MOMO_API_KEY   = process.env.MOMO_API_KEY           || '';

// Orange Money (API Cameroun)
const OM_CLIENT_ID     = process.env.OM_CLIENT_ID     || '';
const OM_CLIENT_SECRET = process.env.OM_CLIENT_SECRET || '';
const OM_MERCHANT_KEY  = process.env.OM_MERCHANT_KEY  || '';

const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
const INDEX       = path.join(__dirname, 'public', 'index.html');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
fs.mkdirSync(path.join(UPLOADS_DIR, 'admin'), { recursive: true });

// ── JSONBin ──
async function dbRead() {
  const r = await axios.get(`https://api.jsonbin.io/v3/b/${BIN_ID}/latest`, {
    headers: { 'X-Master-Key': BIN_KEY, 'X-Bin-Meta': 'false' }
  });
  return r.data;
}
async function dbWrite(data) {
  await axios.put(`https://api.jsonbin.io/v3/b/${BIN_ID}`, data, {
    headers: { 'Content-Type': 'application/json', 'X-Master-Key': BIN_KEY }
  });
}
async function dbUp(fn) {
  const d = await dbRead();
  const nd = fn(d);
  if (nd) await dbWrite(nd);
  return nd;
}

// ─────────────────────────────────────
// MTN MoMo — TOKEN
// ─────────────────────────────────────
async function getMomoToken() {
  const creds = Buffer.from(`${MOMO_API_USER}:${MOMO_API_KEY}`).toString('base64');
  const r = await axios.post(`${MOMO_BASE}/collection/token/`, {}, {
    headers: {
      'Authorization': `Basic ${creds}`,
      'Ocp-Apim-Subscription-Key': MOMO_SUB_KEY
    }
  });
  return r.data.access_token;
}

// ─────────────────────────────────────
// FORMAT TÉLÉPHONE CAMEROUN → 237XXXXXXXXX
// ─────────────────────────────────────
function formatPhone(phone) {
  let p = String(phone).replace(/[\s\-\+\.]/g, '');
  if (p.startsWith('00237')) p = p.slice(2);
  if (p.startsWith('237') && p.length === 12) return p;
  if (p.length === 9) return '237' + p;
  if (p.length === 8) return '237' + p;
  return '237' + p.slice(-9);
}

// ─────────────────────────────────────
// ORANGE MONEY — TOKEN
// ─────────────────────────────────────
async function getOrangeToken() {
  const creds = Buffer.from(`${OM_CLIENT_ID}:${OM_CLIENT_SECRET}`).toString('base64');
  const r = await axios.post('https://api.orange.com/oauth/v3/token', 'grant_type=client_credentials', {
    headers: {
      'Authorization': `Basic ${creds}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  });
  return r.data.access_token;
}

// ═══════════════════════════════════════════════════════════
// ROUTE POST /api/commande
// Déclenche RequestToPay MTN MoMo ou Orange Money PRODUCTION
// → notification push sur le téléphone du client
// → client entre son PIN → argent débité → arrive sur 651364481
// ═══════════════════════════════════════════════════════════
app.post('/api/commande', async (req, res) => {
  const {
    montant, telephone, produitId, orderId,
    operator, items, clientName, location, delivery, subtotal
  } = req.body;

  const reference  = orderId || ('CMD-' + Date.now());
  const payerPhone = formatPhone(telephone);
  const montantStr = String(Math.round(Number(montant)));

  console.log(`\n🟢 NOUVELLE COMMANDE`);
  console.log(`   Réf      : ${reference}`);
  console.log(`   Client   : ${clientName} — ${payerPhone}`);
  console.log(`   Montant  : ${montantStr} XAF`);
  console.log(`   Opérateur: ${operator}`);
  console.log(`   Produits : ${produitId}`);

  // ── Sauvegarder en DB (pending) ──
  try {
    await dbUp(d => {
      d.orders = d.orders || [];
      if (!d.orders.find(o => o.id === reference)) {
        d.orders.unshift({
          id: reference, clientName, location,
          items: items || [], subtotal, delivery,
          total: Number(montant), operator,
          phone: telephone, status: 'pending_payment',
          createdAt: new Date().toISOString()
        });
      }
      return d;
    });
  } catch(e) { console.error('DB write error:', e.message); }

  try {
    if (operator === 'mtn') {
      // ── MTN MoMo RequestToPay ──
      if (!MOMO_SUB_KEY || !MOMO_API_USER || !MOMO_API_KEY) {
        return res.status(500).json({ error: 'Clés MTN MoMo manquantes. Configurez MOMO_SUBSCRIPTION_KEY, MOMO_API_USER, MOMO_API_KEY dans les variables d\'environnement Render.' });
      }
      const token = await getMomoToken();
      await axios.post(
        `${MOMO_BASE}/collection/v1_0/requesttopay`,
        {
          amount:       montantStr,
          currency:     'XAF',
          externalId:   reference,
          payer:        { partyIdType: 'MSISDN', partyId: payerPhone },
          payerMessage: `Green Pepper Market — ${produitId}`,
          payeeNote:    `Commande ${reference}`
        },
        {
          headers: {
            'Authorization':             `Bearer ${token}`,
            'X-Reference-Id':            reference,
            'X-Target-Environment':      MOMO_ENV,
            'Ocp-Apim-Subscription-Key': MOMO_SUB_KEY,
            'Content-Type':              'application/json',
            ...(CALLBACK_URL ? { 'X-Callback-Url': `${CALLBACK_URL}/api/paiement/callback` } : {})
          }
        }
      );
      console.log(`✅ MTN RequestToPay envoyé → ${payerPhone} entre son PIN`);
      res.json({ statut: 'en_attente_pin', reference, operator: 'mtn' });

    } else if (operator === 'om') {
      // ── Orange Money Payment ──
      if (!OM_CLIENT_ID || !OM_CLIENT_SECRET) {
        return res.status(500).json({ error: 'Clés Orange Money manquantes. Configurez OM_CLIENT_ID, OM_CLIENT_SECRET dans les variables d\'environnement Render.' });
      }
      const omToken = await getOrangeToken();
      const r = await axios.post(
        'https://api.orange.com/orange-money-webpay/cm/v1/webpayment',
        {
          merchant_key:   OM_MERCHANT_KEY,
          currency:       'XAF',
          order_id:       reference,
          amount:         montantStr,
          return_url:     CALLBACK_URL || BASE_URL,
          cancel_url:     CALLBACK_URL || BASE_URL,
          notif_url:      `${CALLBACK_URL}/api/paiement/callback-om`,
          lang:           'fr',
          reference:      reference
        },
        {
          headers: {
            'Authorization':  `Bearer ${omToken}`,
            'Content-Type':   'application/json',
            'Accept':         'application/json'
          }
        }
      );
      console.log(`✅ Orange Money paiement initié`);
      res.json({ statut: 'en_attente_pin', reference, operator: 'om', payment_url: r.data.payment_url });

    } else {
      res.status(400).json({ error: 'Opérateur inconnu: ' + operator });
    }

  } catch(e) {
    const detail = e.response?.data || e.message;
    console.error(`❌ Erreur paiement (${operator}):`, JSON.stringify(detail));
    res.status(500).json({
      error: 'Erreur lors du déclenchement du paiement',
      detail: typeof detail === 'object' ? JSON.stringify(detail) : detail
    });
  }
});

// ═══════════════════════════════════════════════════════════
// ROUTE GET /api/paiement/statut/:reference
// Polling toutes les 5s pour savoir si le client a entré son PIN
// ═══════════════════════════════════════════════════════════
app.get('/api/paiement/statut/:reference', async (req, res) => {
  const { reference } = req.params;
  if (!MOMO_SUB_KEY) return res.json({ status: 'PENDING' });
  try {
    const token = await getMomoToken();
    const r = await axios.get(
      `${MOMO_BASE}/collection/v1_0/requesttopay/${reference}`,
      {
        headers: {
          'Authorization':             `Bearer ${token}`,
          'X-Target-Environment':      MOMO_ENV,
          'Ocp-Apim-Subscription-Key': MOMO_SUB_KEY
        }
      }
    );
    console.log(`📊 Statut ${reference}: ${r.data.status}`);
    res.json({ status: r.data.status, financialTransactionId: r.data.financialTransactionId });
  } catch(e) {
    res.json({ status: 'PENDING' });
  }
});

// ═══════════════════════════════════════════════════════════
// CALLBACK MTN — webhook déclenché automatiquement par MTN
// dès que le client a entré son PIN et que le débit est effectué
// ═══════════════════════════════════════════════════════════
app.post('/api/paiement/callback', async (req, res) => {
  const { referenceId, status, financialTransactionId, reason } = req.body;
  console.log(`\n🔔 Callback MTN: ${referenceId} → ${status}`);
  if (status === 'SUCCESSFUL') {
    try {
      await dbUp(d => {
        const order = (d.orders || []).find(o => o.id === referenceId);
        if (order) {
          order.status = 'paid';
          order.paidAt = new Date().toISOString();
          order.momoTxId = financialTransactionId;
          // Décrémenter stocks
          (order.items || []).forEach(item => {
            const p = (d.products || []).find(x => x.id === item.id);
            if (p && p.stock > 0) p.stock--;
          });
          // Notifier commerçants
          const byMerch = {};
          (order.items || []).forEach(item => {
            const p = (d.products || []).find(x => x.id === item.id);
            if (p?.merchantId) {
              if (!byMerch[p.merchantId]) byMerch[p.merchantId] = [];
              byMerch[p.merchantId].push(item);
            }
          });
          d.notifications = d.notifications || [];
          Object.keys(byMerch).forEach(mid => {
            d.notifications.unshift({
              id: 'n' + Date.now() + mid, merchantId: mid, type: 'order',
              message: `🛒 Commande payée de ${order.clientName} — ${byMerch[mid].map(i => i.name).join(', ')} — ${order.total.toLocaleString()} FCFA`,
              read: false, date: new Date().toISOString()
            });
          });
          console.log(`✅ Commande ${referenceId} payée — tx: ${financialTransactionId}`);
        }
        return d;
      });
    } catch(e) { console.error('Callback DB error:', e.message); }
  } else {
    console.log(`⚠️  Paiement ${referenceId} échoué: ${reason}`);
  }
  res.sendStatus(200);
});

// CALLBACK Orange Money
app.post('/api/paiement/callback-om', async (req, res) => {
  const { order_id, status, txnid } = req.body;
  console.log(`\n🔔 Callback Orange Money: ${order_id} → ${status}`);
  if (status === 'SUCCESS') {
    try {
      await dbUp(d => {
        const order = (d.orders || []).find(o => o.id === order_id);
        if (order) { order.status = 'paid'; order.paidAt = new Date().toISOString(); order.omTxId = txnid; }
        return d;
      });
    } catch(e) {}
  }
  res.sendStatus(200);
});

// ═══════════════════════════════════════════════════════════
// PHOTOS — un dossier par commerçant + un dossier admin
// ═══════════════════════════════════════════════════════════

// Lister les photos d'un commerçant (ou admin)
app.get('/api/photos/:merchantId', (req, res) => {
  const { merchantId } = req.params;
  const dir = path.join(UPLOADS_DIR, merchantId);
  try {
    if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); return res.json({ photos: [], merchantId }); }
    const files = fs.readdirSync(dir)
      .filter(f => /\.(jpg|jpeg|png|gif|webp)$/i.test(f))
      .sort((a, b) => fs.statSync(path.join(dir, b)).mtime - fs.statSync(path.join(dir, a)).mtime);
    res.json({ photos: files, merchantId });
  } catch(e) { res.json({ photos: [], merchantId }); }
});

// Lister les photos admin (rétrocompatibilité)
app.get('/api/photos', (req, res) => {
  const dir = path.join(UPLOADS_DIR, 'admin');
  try {
    if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); return res.json({ photos: [] }); }
    const files = fs.readdirSync(dir).filter(f => /\.(jpg|jpeg|png|gif|webp)$/i.test(f));
    res.json({ photos: files });
  } catch(e) { res.json({ photos: [] }); }
});

// Upload photo pour un commerçant
app.post('/api/photos/:merchantId', (req, res) => {
  if (!upload) return res.status(500).json({ error: 'multer non disponible' });
  upload.single('photo')(req, res, err => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Aucun fichier' });
    const { merchantId } = req.params;
    const url = `/uploads/${merchantId}/${req.file.filename}`;
    console.log(`📸 Photo uploadée: ${url}`);
    res.json({ url, filename: req.file.filename, merchantId });
  });
});

// Supprimer une photo
app.delete('/api/photos/:merchantId/:filename', (req, res) => {
  const { merchantId, filename } = req.params;
  const filePath = path.join(UPLOADS_DIR, merchantId, filename);
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.json({ deleted: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════
// FICHIERS STATIQUES
// ═══════════════════════════════════════════════════════════
app.use('/uploads', express.static(UPLOADS_DIR, {
  setHeaders: (res, fp) => { res.setHeader('Cache-Control', 'public, max-age=86400'); }
}));
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, fp) => {
    if (fp.endsWith('.html')) res.setHeader('Content-Type', 'text/html; charset=UTF-8');
  }
}));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Route non trouvée' });
  res.setHeader('Content-Type', 'text/html; charset=UTF-8');
  res.sendFile(INDEX);
});

// ═══════════════════════════════════════════════════════════
// START
// ═══════════════════════════════════════════════════════════
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🌶️  Green Pepper Market — Serveur démarré`);
  console.log(`   Port      : ${PORT}`);
  console.log(`   Marchand  : ${MERCHANT_PHONE}`);
  console.log(`   MoMo env  : ${MOMO_ENV}`);
  console.log(`   MTN MoMo  : ${MOMO_SUB_KEY ? '✅ Configuré' : '❌ MOMO_SUBSCRIPTION_KEY manquant'}`);
  console.log(`   Orange    : ${OM_CLIENT_ID ? '✅ Configuré' : '⚠️  OM_CLIENT_ID manquant'}`);
  console.log(`   JSONBin   : ${BIN_KEY ? '✅' : '❌ API_KEY manquant'}`);
  console.log(`   Uploads   : ${UPLOADS_DIR}`);
  console.log(`   Index     : ${fs.existsSync(INDEX) ? '✅' : '❌ MANQUANT'}`);
  if (!MOMO_SUB_KEY) {
    console.log(`\n   ⚠️  Variables MTN MoMo requises sur Render :`);
    console.log(`      MOMO_SUBSCRIPTION_KEY  — clé d'abonnement MTN`);
    console.log(`      MOMO_API_USER          — UUID utilisateur API`);
    console.log(`      MOMO_API_KEY           — clé API`);
    console.log(`      MOMO_ENV               — mtncameroon (production)`);
    console.log(`      CALLBACK_URL           — https://votre-site.onrender.com`);
  }
  console.log('');
});
