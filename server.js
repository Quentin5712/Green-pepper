const express = require('express');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const app = express();

app.use(express.json());

const PORT = process.env.PORT || 3000;
const BIN_ID = process.env.BIN_ID || '6a4cdd5cf5f4af5e296bb50b';
const BIN_KEY = process.env.API_KEY || '$2a$10$WiRdDM1vwwyaoA.yf/.XkuA/2173q1VIdQ56RJyfD4vGgp8U5tu.O';
const SUB_KEY = process.env.MOMO_SUBSCRIPTION_KEY || '';
const API_USER = process.env.MOMO_API_USER || '';
const API_KEY_MOMO = process.env.MOMO_API_KEY || '';
const ENV = process.env.MOMO_ENV || 'sandbox';
const BASE = 'https://sandbox.momodeveloper.mtn.com';
const CALLBACK = process.env.CALLBACK_URL || '';

// Servir index.html explicitement pour toutes les routes HTML
const INDEX = path.join(__dirname, 'public', 'index.html');

// DB JSONBin
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

// MTN Token
async function getToken() {
  const r = await axios.post(`${BASE}/collection/token/`, {}, {
    headers: {
      'Ocp-Apim-Subscription-Key': SUB_KEY,
      'Authorization': 'Basic ' + Buffer.from(`${API_USER}:${API_KEY_MOMO}`).toString('base64'),
    },
  });
  return r.data.access_token;
}

// API routes
app.post('/api/commande', async (req, res) => {
  const { montant, telephone, produitId, orderId, operator, items, userId, userName, location, delivery, subtotal } = req.body;
  const reference = orderId || `CMD-${Date.now()}`;
  try {
    const db = await dbRead();
    if (db) {
      db.orders = db.orders || [];
      db.orders.unshift({ id: reference, userId, userName, location, items: items||[], subtotal: subtotal||0, delivery: delivery||0, total: montant, operator, phone: telephone, status: 'pending_payment', createdAt: new Date().toISOString() });
      await dbWrite(db);
    }
    if (SUB_KEY && API_USER && API_KEY_MOMO) {
      const token = await getToken();
      await axios.post(`${BASE}/collection/v1_0/requesttopay`,
        { amount: String(montant), currency: 'XAF', payer: { partyIdType: 'MSISDN', partyId: telephone.replace(/^0/, '237') }, payerMessage: `Achat: ${produitId}`, payeeNote: `Commande ${reference}` },
        { headers: { 'Authorization': `Bearer ${token}`, 'X-Reference-Id': reference, 'X-Callback-Url': CALLBACK, 'X-Target-Environment': ENV, 'Ocp-Apim-Subscription-Key': SUB_KEY, 'Content-Type': 'application/json' } }
      );
    }
    res.json({ statut: 'en_attente_validation_client', reference });
  } catch(e) {
    res.json({ statut: 'en_attente_validation_client', reference });
  }
});

app.get('/api/paiement/statut/:reference', async (req, res) => {
  if (!SUB_KEY) return res.json({ status: 'PENDING' });
  try {
    const token = await getToken();
    const r = await axios.get(`${BASE}/collection/v1_0/requesttopay/${req.params.reference}`, {
      headers: { 'Authorization': `Bearer ${token}`, 'X-Target-Environment': ENV, 'Ocp-Apim-Subscription-Key': SUB_KEY }
    });
    res.json({ status: r.data.status });
  } catch(e) { res.json({ status: 'PENDING' }); }
});

app.post('/api/paiement/callback', async (req, res) => {
  const { referenceId, status } = req.body;
  if (status === 'SUCCESSFUL') {
    const db = await dbRead();
    if (db) {
      const order = (db.orders||[]).find(o => o.id === referenceId);
      if (order) {
        order.status = 'paid';
        order.paidAt = new Date().toISOString();
        await dbWrite(db);
      }
    }
  }
  res.sendStatus(200);
});

// Route principale - EXPLICITE avec Content-Type correct
app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=UTF-8');
  res.sendFile(INDEX);
});

// Fichiers statiques
app.use(express.static(path.join(__dirname, 'public')));

// Fallback
app.get('*', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=UTF-8');
  res.sendFile(INDEX);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Green Pepper Market - Port ${PORT}`);
  console.log(`Index: ${INDEX}`);
  console.log(`Index exists: ${fs.existsSync(INDEX)}`);
});
