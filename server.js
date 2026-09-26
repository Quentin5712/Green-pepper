const express  = require('express');
const axios    = require('axios');
const path     = require('path');
const fs       = require('fs');
const app      = express();

// Multer pour l'upload de fichiers
let multer;
try { multer = require('multer'); } catch(e) { multer = null; }

app.use(express.json({ limit: '10mb' }));

const PORT   = process.env.PORT || 3000;
const INDEX  = path.join(__dirname, 'public', 'index.html');
const UPLOAD = path.join(__dirname, 'public', 'uploads');

// Créer dossier uploads si inexistant
if (!fs.existsSync(UPLOAD)) fs.mkdirSync(UPLOAD, { recursive: true });

// ── JSONBIN ──
const BIN_ID  = process.env.BIN_ID  || '6a4cdd5cf5f4af5e296bb50b';
const BIN_KEY = process.env.API_KEY || '$2a$10$WiRdDM1vwwyaoA.yf/.XkuA/2173q1VIdQ56RJyfD4vGgp8U5tu.O';

// ── MTN MoMo ──
const MOMO_ENV     = process.env.MOMO_ENV || 'sandbox';
const MOMO_BASE    = 'https://sandbox.momodeveloper.mtn.com';
const MOMO_SUB_KEY = process.env.MOMO_SUBSCRIPTION_KEY || '';
const MOMO_API_USER= process.env.MOMO_API_USER || '';
const MOMO_API_KEY = process.env.MOMO_API_KEY  || '';
const CALLBACK_URL = process.env.CALLBACK_URL  || '';
const MERCHANT     = process.env.MERCHANT_PHONE || '651364481';

// ── DB ──
async function dbRead() {
  try {
    const r = await axios.get(`https://api.jsonbin.io/v3/b/${BIN_ID}/latest`,
      { headers: { 'X-Master-Key': BIN_KEY, 'X-Bin-Meta': 'false' } });
    return r.data;
  } catch(e) { return null; }
}
async function dbWrite(data) {
  try {
    await axios.put(`https://api.jsonbin.io/v3/b/${BIN_ID}`, data,
      { headers: { 'Content-Type': 'application/json', 'X-Master-Key': BIN_KEY } });
  } catch(e) { console.error('dbWrite:', e.message); }
}
async function dbUp(fn) {
  const d = await dbRead(); if (!d) return null;
  const nd = fn(d); if (nd) await dbWrite(nd); return nd;
}

// ── MTN Token ──
async function getToken() {
  const creds = Buffer.from(`${MOMO_API_USER}:${MOMO_API_KEY}`).toString('base64');
  const r = await axios.post(`${MOMO_BASE}/collection/token/`, {},
    { headers: { 'Authorization': `Basic ${creds}`, 'Ocp-Apim-Subscription-Key': MOMO_SUB_KEY } });
  return r.data.access_token;
}
function formatPhone(p) {
  p = String(p).replace(/[\s\-]/g, '');
  if (p.startsWith('+')) p = p.substring(1);
  if (!p.startsWith('237') && p.length === 9) p = '237' + p;
  if (p.startsWith('0')) p = '237' + p.substring(1);
  return p;
}

// ════════════════════════════════════════
// UPLOAD IMAGE
// POST /api/upload
// ════════════════════════════════════════
if (multer) {
  const storage = multer.diskStorage({
    destination: UPLOAD,
    filename: (req, file, cb) => {
      cb(null, `img_${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`);
    }
  });
  const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
    fileFilter: (req, file, cb) => {
      if (file.mimetype.startsWith('image/')) cb(null, true);
      else cb(new Error('Image only'));
    }
  });

  app.post('/api/upload', upload.single('image'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const url = `/uploads/${req.file.filename}`;
    console.log(`📸 Image uploadée: ${url}`);
    res.json({ url, filename: req.file.filename });
  });
} else {
  // Fallback sans multer: recevoir base64
  app.post('/api/upload', (req, res) => {
    const { data, ext } = req.body;
    if (!data) return res.status(400).json({ error: 'No data' });
    const filename = `img_${Date.now()}.${ext || 'jpg'}`;
    const filepath = path.join(UPLOAD, filename);
    const b64 = data.replace(/^data:image\/\w+;base64,/, '');
    fs.writeFileSync(filepath, Buffer.from(b64, 'base64'));
    res.json({ url: `/uploads/${filename}` });
  });
}

// ════════════════════════════════════════
// COMMANDE + MTN MoMo
// POST /api/commande
// ════════════════════════════════════════
app.post('/api/commande', async (req, res) => {
  const { montant, telephone, produitId, orderId, operator,
          items, userId, userName, location, delivery, subtotal } = req.body;
  const reference = orderId || `CMD-${Date.now()}`;
  const payerPhone = formatPhone(telephone);

  console.log(`\n📦 Commande ${reference} — ${userName} — ${montant} XAF`);

  try {
    // Sauvegarder en DB
    await dbUp(d => {
      d.orders = d.orders || [];
      if (!d.orders.find(o => o.id === reference)) {
        d.orders.unshift({
          id: reference, userId, userName, location,
          items: items || [], subtotal: subtotal || 0,
          delivery: delivery || 0, total: montant,
          operator, phone: telephone, merchantPhone: MERCHANT,
          status: 'pending_payment', createdAt: new Date().toISOString()
        });
      }
      return d;
    });

    // Appel MTN MoMo
    if (MOMO_SUB_KEY && MOMO_API_USER && MOMO_API_KEY) {
      const token = await getToken();
      await axios.post(`${MOMO_BASE}/collection/v1_0/requesttopay`,
        {
          amount: String(montant), currency: 'XAF',
          externalId: reference,
          payer: { partyIdType: 'MSISDN', partyId: payerPhone },
          payerMessage: `Green Pepper - ${produitId}`,
          payeeNote: `Commande ${reference}`,
        },
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'X-Reference-Id': reference,
            'X-Target-Environment': MOMO_ENV,
            'Ocp-Apim-Subscription-Key': MOMO_SUB_KEY,
            'Content-Type': 'application/json',
            ...(CALLBACK_URL ? { 'X-Callback-Url': CALLBACK_URL } : {})
          }
        }
      );
      console.log(`✅ RequestToPay → ${payerPhone} pour ${montant} XAF (marchand: ${MERCHANT})`);
    } else {
      console.log('⚠️  Mode simulation (clés MoMo non configurées)');
    }

    res.json({ statut: 'en_attente_validation_client', reference });
  } catch(e) {
    console.error('❌ MoMo:', e.response?.data || e.message);
    res.json({ statut: 'en_attente_validation_client', reference, note: 'simulation' });
  }
});

// GET /api/paiement/statut/:ref
app.get('/api/paiement/statut/:reference', async (req, res) => {
  if (!MOMO_SUB_KEY) return res.json({ status: 'PENDING' });
  try {
    const token = await getToken();
    const r = await axios.get(`${MOMO_BASE}/collection/v1_0/requesttopay/${req.params.reference}`,
      { headers: { 'Authorization': `Bearer ${token}`, 'X-Target-Environment': MOMO_ENV, 'Ocp-Apim-Subscription-Key': MOMO_SUB_KEY } });
    res.json({ status: r.data.status });
  } catch(e) { res.json({ status: 'PENDING' }); }
});

// POST /api/paiement/callback
app.post('/api/paiement/callback', async (req, res) => {
  const { referenceId, status, financialTransactionId } = req.body;
  console.log(`🔔 Callback: ${referenceId} → ${status}`);
  if (status === 'SUCCESSFUL') {
    await dbUp(d => {
      const o = (d.orders || []).find(x => x.id === referenceId);
      if (o) { o.status = 'paid'; o.paidAt = new Date().toISOString(); o.momoTxId = financialTransactionId; }
      return d;
    });
  }
  res.sendStatus(200);
});

// ── Route liste photos ──
app.get('/api/photos', (req, res) => {
  try {
    if (!fs.existsSync(UPLOAD)) return res.json({ photos: [] });
    const files = fs.readdirSync(UPLOAD)
      .filter(f => /\.(jpg|jpeg|png|gif|webp)$/i.test(f))
      .sort((a, b) => {
        const sa = fs.statSync(path.join(UPLOAD, a));
        const sb = fs.statSync(path.join(UPLOAD, b));
        return sb.mtime - sa.mtime; // Plus récent en premier
      });
    res.json({ photos: files });
  } catch(e) {
    res.json({ photos: [] });
  }
});

// ── Fichiers statiques ──
app.use('/uploads', express.static(UPLOAD));
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, fp) => { if (fp.endsWith('.html')) res.setHeader('Content-Type', 'text/html; charset=UTF-8'); }
}));
app.get('/', (req, res) => { res.setHeader('Content-Type', 'text/html; charset=UTF-8'); res.sendFile(INDEX); });
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Not found' });
  res.setHeader('Content-Type', 'text/html; charset=UTF-8'); res.sendFile(INDEX);
});

// ── START ──
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🌶️  Green Pepper Market — Port ${PORT}`);
  console.log(`   Uploads: ${UPLOAD}`);
  console.log(`   Merchant: ${MERCHANT}`);
  console.log(`   MoMo: ${MOMO_SUB_KEY ? 'OUI ✅' : 'Mode test'}`);
  console.log(`   Index: ${fs.existsSync(INDEX) ? 'OK ✅' : '❌ MANQUANT'}\n`);
});
