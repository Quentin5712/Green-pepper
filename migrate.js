/**
 * migrate.js — Migration JSONBin → MongoDB Atlas
 *
 * Ce script lit toutes vos données depuis JSONBin et les insère dans MongoDB.
 *
 * UTILISATION :
 *   1. Créez .env avec MONGO_URI et BIN_ID et API_KEY
 *   2. node migrate.js
 *   3. Vérifiez les logs, puis supprimez ce fichier (il ne sert qu'une fois)
 */
require('dotenv').config();
const mongoose  = require('mongoose');
const axios     = require('axios');
const bcrypt    = require('bcryptjs');

// Importer les modèles
const Product      = require('./src/models/Product');
const User         = require('./src/models/User');
const Order        = require('./src/models/Order');
const Notification = require('./src/models/Notification');
const MerchantLink = require('./src/models/MerchantLink');

const BIN_ID  = process.env.BIN_ID;
const BIN_KEY = process.env.API_KEY;

// ── Stats de migration ──
let stats = { users: 0, products: 0, orders: 0, notifs: 0, links: 0, errors: [] };

// ── Lire JSONBin ──
async function readBin() {
  console.log('\n📖 Lecture des données JSONBin...');
  const r = await axios.get(`https://api.jsonbin.io/v3/b/${BIN_ID}/latest`, {
    headers: { 'X-Master-Key': BIN_KEY, 'X-Bin-Meta': 'false' }
  });
  return r.data;
}

// ── Migrer les commerçants (anciens "merchants") → User avec role=seller ──
async function migrateMerchants(merchants = []) {
  console.log(`\n👥 Migration ${merchants.length} commerçants...`);
  for (const m of merchants) {
    try {
      // Vérifier si déjà migré
      const exists = await User.findOne({ email: m.email });
      if (exists) { console.log(`   ⏭️  ${m.email} déjà existant`); continue; }

      const user = new User({
        name:      m.name,
        email:     m.email.toLowerCase(),
        password:  m.pass || 'Quentin123!', // sera hashé par le pre-save
        role:      'seller',
        phone:     m.phone,
        storeName: m.storeName,
        whatsapp:  m.phone,
        expiresAt: m.expiresAt ? new Date(m.expiresAt) : null,
        isActive:  true,
        joinedAt:  m.joinedAt ? new Date(m.joinedAt) : new Date(),
      });
      await user.save();
      // Conserver la correspondance ancien ID → nouvel ObjectId MongoDB
      m._mongoId = user._id;
      stats.users++;
      console.log(`   ✅ Commerçant migré : ${m.name} (${m.email})`);
    } catch (e) {
      stats.errors.push({ type: 'merchant', id: m.email, error: e.message });
      console.error(`   ❌ ${m.email} : ${e.message}`);
    }
  }
}

// ── Migrer les utilisateurs (anciens "users") → User avec role=buyer ──
async function migrateUsers(users = []) {
  console.log(`\n👤 Migration ${users.length} clients...`);
  for (const u of users) {
    try {
      const exists = await User.findOne({ email: u.email });
      if (exists) { console.log(`   ⏭️  ${u.email} déjà existant`); continue; }

      const user = new User({
        name:     u.name,
        email:    u.email.toLowerCase(),
        password: u.pass || 'TempPass123!',
        role:     'buyer',
        phone:    u.phone,
        joinedAt: u.joinedAt ? new Date(u.joinedAt) : new Date(),
        isActive: true,
      });
      await user.save();
      u._mongoId = user._id;
      stats.users++;
      console.log(`   ✅ Client migré : ${u.name}`);
    } catch (e) {
      stats.errors.push({ type: 'user', id: u.email, error: e.message });
      console.error(`   ❌ ${u.email} : ${e.message}`);
    }
  }
}

// ── Migrer les produits ──
async function migrateProducts(products = [], merchants = []) {
  console.log(`\n📦 Migration ${products.length} produits...`);
  for (const p of products) {
    try {
      // Trouver le vendeur correspondant dans MongoDB
      const merchant = merchants.find(m => m.id === p.merchantId);
      let seller = null;
      if (merchant) {
        seller = await User.findOne({ email: merchant.email });
      }
      if (!seller) {
        // Créer un vendeur générique si introuvable
        seller = await User.findOne({ role: 'admin' });
      }

      const exists = await Product.findOne({ name: p.name, sellerId: seller?._id });
      if (exists) { console.log(`   ⏭️  Produit "${p.name}" déjà existant`); continue; }

      const product = new Product({
        name:        p.name,
        description: p.desc || p.description || '',
        price:       Number(p.price) || 0,
        stock:       Number(p.stock) || 0,
        stockAlert:  Number(p.stockAlert) || 5,
        category:    p.category || p.catId || 'Divers',
        sellerId:    seller?._id,
        images:      p.img ? [{ url: p.img, filename: '' }] : [],
        isActive:    true,
      });
      await product.save();
      p._mongoId = product._id;
      stats.products++;
      console.log(`   ✅ Produit migré : ${p.name}`);
    } catch (e) {
      stats.errors.push({ type: 'product', id: p.name, error: e.message });
      console.error(`   ❌ ${p.name} : ${e.message}`);
    }
  }
}

// ── Migrer les commandes ──
async function migrateOrders(orders = [], products = []) {
  console.log(`\n🛒 Migration ${orders.length} commandes...`);
  for (const o of orders) {
    try {
      const exists = await Order.findOne({ momoReference: o.id });
      if (exists) { console.log(`   ⏭️  Commande ${o.id} déjà existante`); continue; }

      // Reconstruire les items
      const items = (o.items || []).map(item => {
        const prod = products.find(p => p.id === item.id);
        return {
          productId: prod?._mongoId || new mongoose.Types.ObjectId(),
          name:      item.name || 'Produit',
          quantity:  1,
          price:     item.price || 0,
        };
      });

      const order = new Order({
        clientName:  o.clientName || o.userName || 'Client',
        clientPhone: o.phone || '',
        products:    items,
        total:       Number(o.total) || 0,
        deliveryFee: Number(o.delivery) || 0,
        status:      o.status === 'done' ? 'delivered' : o.status === 'paid' ? 'paid' : 'pending_payment',
        shippingAddress: { location: o.location || '', city: '' },
        paymentMethod:   o.operator === 'mtn' ? 'mtn_momo' : o.operator === 'om' ? 'orange_money' : 'mtn_momo',
        paymentStatus:   o.status === 'paid' || o.status === 'done' ? 'paid' : 'pending',
        momoReference:   o.id,
        momoTxId:        o.momoTxId || null,
        paidAt:          o.paidAt ? new Date(o.paidAt) : null,
        createdAt:       o.date ? new Date(o.date) : new Date(),
      });
      await order.save();
      stats.orders++;
      console.log(`   ✅ Commande migrée : ${o.id} — ${o.clientName}`);
    } catch (e) {
      stats.errors.push({ type: 'order', id: o.id, error: e.message });
      console.error(`   ❌ ${o.id} : ${e.message}`);
    }
  }
}

// ── Migrer les liens commerçants ──
async function migrateLinks(links = []) {
  console.log(`\n🔗 Migration ${links.length} liens d'invitation...`);
  for (const l of links) {
    try {
      const exists = await MerchantLink.findOne({ token: l.token });
      if (exists) continue;
      await MerchantLink.create({
        token:   l.token,
        days:    l.days || 30,
        usedBy:  l.usedBy || null,
        usedAt:  l.usedAt ? new Date(l.usedAt) : null,
        createdAt: l.createdAt ? new Date(l.createdAt) : new Date(),
      });
      stats.links++;
    } catch (e) {
      stats.errors.push({ type: 'link', id: l.token, error: e.message });
    }
  }
  console.log(`   ✅ ${stats.links} liens migrés`);
}

// ── MAIN ──────────────────────────────────────────────────
async function main() {
  console.log('🌶️  Green Pepper Market — Migration JSONBin → MongoDB Atlas');
  console.log('════════════════════════════════════════════════════════════');

  if (!process.env.MONGO_URI) {
    console.error('❌ MONGO_URI manquant dans .env');
    process.exit(1);
  }
  if (!BIN_ID || !BIN_KEY) {
    console.error('❌ BIN_ID ou API_KEY manquant dans .env');
    process.exit(1);
  }

  // 1. Connexion MongoDB
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });
  console.log('✅ MongoDB connecté\n');

  // 2. Lecture JSONBin
  const data = await readBin();
  console.log(`📊 Données trouvées :`);
  console.log(`   - Commerçants : ${(data.merchants||[]).length}`);
  console.log(`   - Clients     : ${(data.users||[]).length}`);
  console.log(`   - Produits    : ${(data.products||[]).length}`);
  console.log(`   - Commandes   : ${(data.orders||[]).length}`);
  console.log(`   - Liens       : ${(data.merchantLinks||[]).length}`);

  // 3. Migration dans l'ordre (les dépendances d'abord)
  await migrateMerchants(data.merchants || []);
  await migrateUsers(data.users || []);
  await migrateProducts(data.products || [], data.merchants || []);
  await migrateOrders(data.orders || [], data.products || []);
  await migrateLinks(data.merchantLinks || []);

  // 4. Rapport final
  console.log('\n════════════════════════════════════════════════════════════');
  console.log('📋 RAPPORT DE MIGRATION');
  console.log('════════════════════════════════════════════════════════════');
  console.log(`✅ Utilisateurs migrés : ${stats.users}`);
  console.log(`✅ Produits migrés     : ${stats.products}`);
  console.log(`✅ Commandes migrées   : ${stats.orders}`);
  console.log(`✅ Liens migrés        : ${stats.links}`);
  if (stats.errors.length) {
    console.log(`\n⚠️  ${stats.errors.length} erreur(s) :`);
    stats.errors.forEach(e => console.log(`   - [${e.type}] ${e.id} : ${e.error}`));
  } else {
    console.log('\n🎉 Migration terminée sans erreur !');
  }
  console.log('\n📌 Prochaines étapes :');
  console.log('   1. Vérifiez sur MongoDB Atlas Compass que les données sont bien là');
  console.log('   2. Supprimez ce fichier migrate.js (il ne sert qu\'une seule fois)');
  console.log('   3. Redéployez sur Render avec MONGO_URI dans les variables d\'env');

  await mongoose.disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error('💥 Erreur fatale :', err.message);
  process.exit(1);
});
