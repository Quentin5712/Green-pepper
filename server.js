// ═══════════════════════════════════════════════
// server.js — Green Pepper Market
// MTN MoMo RequestToPay → compte 651364481
// ═══════════════════════════════════════════════
const express = require('express');
const axios   = require('axios');
const path    = require('path');
const fs      = require('fs');
const app     = express();

app.use(express.json({ limit: '5mb' }));

// ── MULTER (upload photos) ──
let upload = null;
try {
  const multer  = require('multer');
  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(__dirname, 'public', 'uploads')),
    filename:    (req, file, cb) => cb(null, `img_${Date.now()}.jpg`)
  });
  upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });
} catch(e) { console.log('multer non dispo'); }

// ── CONFIG ──
const PORT          = process.env.PORT || 3000;
const INDEX         = path.join(__dirname, 'public', 'index.html');
const UPLOADS_DIR   = path.join(__dirname, 'public', 'uploads');
const BIN_ID        = process.env.BIN_ID  || '6a4cdd5cf5f4af5e296bb50b';
const BIN_KEY       = process.env.API_KEY || '$2a$10$WiRdDM1vwwyaoA.yf/.XkuA/2173q1VIdQ56RJyfD4vGgp8U5tu.O';
const MERCHANT      = process.env.MERCHANT_PHONE || '651364481';
const CALLBACK_URL  = process.env.CALLBACK_URL   || '';

// MTN MoMo
const MOMO_ENV      = process.env.MOMO_ENV              || 'sandbox';
const MOMO_BASE     = MOMO_ENV === 'sandbox'
  ? 'https://sandbox.momodeveloper.mtn.com'
  : 'https://proxy.momoapi.mtn.com';
const MOMO_SUB_KEY  = process.env.MOMO_SUBSCRIPTION_KEY || '';
const MOMO_API_USER = process.env.MOMO_API_USER          || '';
const MOMO_API_KEY  = process.env.MOMO_API_KEY           || '';

// Créer dossier uploads
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ── JSONBin ──
async function dbRead() {
  try {
    const r = await axios.get(`https://api.jsonbin.io/v3/b/${BIN_ID}/latest`, {
      headers: { 'X-Master-Key': BIN_KEY, 'X-Bin-Meta': 'false' }
    });
    return r.data;
  } catch(e) { return null; }
}
async function dbWrite(data) {
  try {
    await axios.put(`https://api.jsonbin.io/v3/b/${BIN_ID}`, data, {
      headers: { 'Content-Type': 'application/json', 'X-Master-Key': BIN_KEY }
    });
  } catch(e) {}
}
async function dbUp(fn) {
  const d = await dbRead(); if (!d) return null;
  const nd = fn(d); if (nd) await dbWrite(nd); return nd;
}

// ── MTN MoMo : obtenir token ──
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

// ── Formater numéro camerounais ──
function formatPhone(phone) {
  let p = String(phone).replace(/[\s\-\+]/g, '');
  if (p.startsWith('00237')) p = p.slice(2);
  if (!p.startsWith('237') && p.length <= 9) p = '237' + p;
  return p;
}

// ════════════════════════════════════════
// ROUTE : Déclencher le paiement
// Le serveur appelle MTN MoMo → le client
// reçoit une notification sur son téléphone
// et entre son PIN pour confirmer
// L'argent va sur le compte 651364481
// ════════════════════════════════════════
app.post('/api/commande', async (req, res) => {
  const {
    montant, telephone, produitId, orderId,
    operator, items, userId, userName,
    location, delivery, subtotal
  } = req.body;

  const reference = orderId || `CMD-${Date.now()}`;
  const payerPhone = formatPhone(telephone);

  console.log(`\n📦 Nouvelle commande`);
  console.log(`   Réf     : ${reference}`);
  console.log(`   Client  : ${userName} (${payerPhone})`);
  console.log(`   Montant : ${montant} XAF`);
  console.log(`   Opérat. : ${operator}`);
  console.log(`   Vers    : ${MERCHANT}`);

  try {
    // 1. Sauvegarder commande "en attente de paiement" en DB
    await dbUp(d => {
      d.orders = d.orders || [];
      if (!d.orders.find(o => o.id === reference)) {
        d.orders.unshift({
          id: reference, userId, userName, location,
          items: items || [],
          subtotal: subtotal || 0,
          delivery: delivery || 0,
          total: montant,
          operator, phone: telephone,
          merchantPhone: MERCHANT,
          status: 'pending_payment',
          createdAt: new Date().toISOString()
        });
      }
      return d;
    });

    // 2. Appeler MTN MoMo si clés configurées
    if (MOMO_SUB_KEY && MOMO_API_USER && MOMO_API_KEY) {
      const token = await getMomoToken();

      // RequestToPay : MTN envoie une notification push au client
      // Le client entre son PIN → l'argent est débité et va sur 651364481
      await axios.post(
        `${MOMO_BASE}/collection/v1_0/requesttopay`,
        {
          amount:       String(montant),
          currency:     'XAF',
          externalId:   reference,
          payer: {
            partyIdType: 'MSISDN',
            partyId:     payerPhone
          },
          payerMessage: `Green Pepper Market - ${produitId}`,
          payeeNote:    `Commande ${reference}`
        },
        {
          headers: {
            'Authorization':             `Bearer ${token}`,
            'X-Reference-Id':            reference,
            'X-Target-Environment':      MOMO_ENV,
            'Ocp-Apim-Subscription-Key': MOMO_SUB_KEY,
            'Content-Type':              'application/json',
            ...(CALLBACK_URL ? { 'X-Callback-Url': CALLBACK_URL } : {})
          }
        }
      );

      console.log(`✅ RequestToPay envoyé → notification sur ${payerPhone}`);
      console.log(`   Le client entre son PIN MTN/Orange → débit automatique`);
      console.log(`   L'argent arrive sur ${MERCHANT}`);

      res.json({ statut: 'en_attente_pin_client', reference, mode: 'momo' });

    } else {
      // Mode test (sans clés MoMo)
      console.log(`⚠️  Mode simulation — clés MoMo non configurées`);
      console.log(`   En production, ajoutez MOMO_SUBSCRIPTION_KEY, MOMO_API_USER, MOMO_API_KEY`);
      res.json({ statut: 'en_attente_pin_client', reference, mode: 'simulation' });
    }

  } catch(e) {
    const msg = e.response?.data?.message || e.message;
    console.error(`❌ Erreur MoMo : ${msg}`);
    // Même en cas d'erreur MoMo, on retourne ok pour le mode test
    res.json({ statut: 'en_attente_pin_client', reference, mode: 'erreur', detail: msg });
  }
});

// ════════════════════════════════════════
// ROUTE : Vérifier statut (polling toutes 5s)
// Le frontend poll pour savoir si le client
// a confirmé son PIN
// ════════════════════════════════════════
app.get('/api/paiement/statut/:reference', async (req, res) => {
  const { reference } = req.params;

  if (!MOMO_SUB_KEY) {
    // Mode test : retourner PENDING (client confirme manuellement)
    return res.json({ status: 'PENDING' });
  }

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
    console.log(`📊 Statut ${reference} : ${r.data.status}`);
    res.json({ status: r.data.status });
  } catch(e) {
    res.json({ status: 'PENDING' });
  }
});

// ════════════════════════════════════════
// ROUTE : Callback MTN (webhook automatique)
// MTN appelle cette URL dès que le client
// a confirmé son PIN → commande marquée payée
// ════════════════════════════════════════
app.post('/api/paiement/callback', async (req, res) => {
  const { referenceId, status, financialTransactionId } = req.body;
  console.log(`\n🔔 Callback MTN : ${referenceId} → ${status}`);

  if (status === 'SUCCESSFUL') {
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
        console.log(`✅ Commande ${referenceId} payée — tx: ${financialTransactionId}`);
      }
      return d;
    });
  }
  res.sendStatus(200);
});

// ════════════════════════════════════════
// ROUTE : Liste des photos dispo
// ════════════════════════════════════════
app.get('/api/photos', (req, res) => {
  try {
    if (!fs.existsSync(UPLOADS_DIR)) return res.json({ photos: [] });
    const files = fs.readdirSync(UPLOADS_DIR)
      .filter(f => /\.(jpg|jpeg|png|gif|webp)$/i.test(f))
      .sort((a, b) => {
        const sa = fs.statSync(path.join(UPLOADS_DIR, a)).mtime;
        const sb = fs.statSync(path.join(UPLOADS_DIR, b)).mtime;
        return sb - sa;
      });
    res.json({ photos: files });
  } catch(e) {
    res.json({ photos: [] });
  }
});

// ════════════════════════════════════════
// Fichiers statiques
// ════════════════════════════════════════
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, fp) => {
    if (fp.endsWith('.html')) res.setHeader('Content-Type', 'text/html; charset=UTF-8');
  }
}));

app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=UTF-8');
  res.sendFile(INDEX);
});
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Route non trouvée' });
  res.setHeader('Content-Type', 'text/html; charset=UTF-8');
  res.sendFile(INDEX);
});

// ════════════════════════════════════════
// START
// ════════════════════════════════════════
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🌶️  Green Pepper Market démarré`);
  console.log(`   Port     : ${PORT}`);
  console.log(`   Marchand : ${MERCHANT}`);
  console.log(`   MoMo     : ${MOMO_SUB_KEY ? `✅ Configuré (${MOMO_ENV})` : '⚠️  Non configuré (mode test)'}`);
  console.log(`   JSONBin  : ${BIN_ID}`);
  console.log(`   Uploads  : ${UPLOADS_DIR}`);
  console.log(`   Index    : ${fs.existsSync(INDEX) ? '✅' : '❌ MANQUANT'}\n`);
  if (!MOMO_SUB_KEY) {
    console.log('   ℹ️  Pour activer MTN MoMo en production, définissez :');
    console.log('      MOMO_SUBSCRIPTION_KEY, MOMO_API_USER, MOMO_API_KEY');
    console.log('      MOMO_ENV=mtnliberia (ou votre environnement)');
    console.log('      CALLBACK_URL=https://votre-site.onrender.com/api/paiement/callback\n');
  }
});
