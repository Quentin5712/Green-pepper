'use strict';
const Product = require('../models/Product');
const { clean, safeUrl, safeHttpsUrl } = require('../utils/clean');
const User = require('../models/User');
const Shop = require('../models/Shop');
const Order = require('../models/Order');

// ── Fiche détaillée : lecture tolérante (tableau OU texte « une ligne par élément ») + nettoyage anti-XSS ──
const toLines = (v, max, maxLen) => (Array.isArray(v) ? v : String(v == null ? '' : v).split(/\r?\n/)).map(x => clean(String(x), maxLen).trim()).filter(Boolean).slice(0, max);
function toPairs(v, max) {
  const rows = Array.isArray(v) ? v : String(v == null ? '' : v).split(/\r?\n/);
  return rows.map(r => {
    if (r && typeof r === 'object') return { label: clean(String(r.label || ''), 40).trim(), value: clean(String(r.value || ''), 120).trim() };
    const i = String(r).indexOf(':'); if (i < 1) return null;
    return { label: clean(String(r).slice(0, i), 40).trim(), value: clean(String(r).slice(i + 1), 120).trim() };
  }).filter(x => x && x.label && x.value).slice(0, max);
}
// Remise : 1 à 90 %, date de fin OBLIGATOIRE et future (180 jours max) — modifiable par l'admin ET par chaque marchand sur SES produits
function parseDiscount(body) {
  if (body.discount === undefined && body.discountExpiresAt === undefined) return { set: false };
  const pct = Math.round(Number(body.discount) || 0);
  if (pct <= 0) return { set: true, discount: 0, discountExpiresAt: null };
  if (pct > 90) return { error: 'Remise : 90 % maximum' };
  const end = new Date(body.discountExpiresAt);
  if (!body.discountExpiresAt || isNaN(end)) return { error: 'Remise : indiquez la date de fin de l\'offre' };
  if (end <= new Date()) return { error: 'Remise : la date de fin doit être dans le futur' };
  if (end - new Date() > 180 * 86400000) return { error: 'Remise : 180 jours maximum' };
  return { set: true, discount: pct, discountExpiresAt: end };
}
function detailsFrom(body, partial) {
  const d = {}; const has = k => body[k] !== undefined;
  if (!partial || has('images'))       d.images = (Array.isArray(body.images) ? body.images : []).map(safeUrl).filter(Boolean).slice(0, 4);
  if (!partial || has('brand'))        d.brand = clean(String(body.brand || ''), 80);
  if (!partial || has('origin'))       d.origin = clean(String(body.origin || ''), 60);
  if (!partial || has('deliveryInfo')) d.deliveryInfo = clean(String(body.deliveryInfo || ''), 300);
  if (!partial || has('highlights'))   d.highlights = toPairs(body.highlights, 8);
  if (!partial || has('bullets'))      d.bullets = toLines(body.bullets, 10, 220);
  if (!partial || has('specs'))        d.specs = toPairs(body.specs, 20);
  return d;
}

// Prix affiché : la réduction n'apparaît que si elle est encore valable. (.lean() ne calcule pas les champs virtuels : on le fait ici)
function priceInfo(p) {
  const active = p.discount > 0 && p.discountExpiresAt && new Date(p.discountExpiresAt) > new Date();
  const finalPrice = active ? Math.round(p.price * (1 - p.discount / 100)) : p.price;
  return { finalPrice, discountActive: !!active, discountPercent: active ? p.discount : 0, discountExpiresAt: active ? p.discountExpiresAt : null, savings: p.price - finalPrice };
}

// Ajoute le WhatsApp (237 + 9 chiffres) et le nom de la boutique du vendeur ; le lien digital n'est JAMAIS exposé ici
async function withSeller(list) {
  const ids = [...new Set(list.map(p => String(p.sellerId)).filter(x => /^[a-f0-9]{24}$/.test(x)))];
  const users = ids.length ? await User.find({ _id: { $in: ids }, isDeleted: false }).select('whatsapp storeName name shopId country').lean() : [];
  const by = {}; users.forEach(u => { by[String(u._id)] = u; });
  const shopIds = [...new Set([...list.map(p => p.shopId), ...users.map(u => u.shopId)].filter(Boolean).map(String))];
  const shops = shopIds.length ? await Shop.find({ _id: { $in: shopIds } }).select('name logoUrl country').lean() : [];
  const sh = {}; shops.forEach(x => { sh[String(x._id)] = x; });
  list.forEach(p => {
    const u = by[String(p.sellerId)];
    p.sellerWhatsapp = u && /^[1-9][0-9]{7,14}$/.test(u.whatsapp || '') ? u.whatsapp : '';
    const shop = sh[String(p.shopId || (u && u.shopId) || '')];
    p.shop = shop ? { id: String(shop._id), name: shop.name, logoUrl: shop.logoUrl || '', country: shop.country || '' } : (u && u.storeName ? { name: u.storeName, logoUrl: '', country: u.country || '' } : null);
    p.storeName = u ? (u.storeName || u.name || '') : '';
  });
  return list;
}
const san = s => typeof s==='string' ? clean(s, 5000) : s;
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// « boissons », « Boissons  » et « BOISSONS » deviennent la même catégorie
const normCat = s => { const c = clean(String(s || ''), 50).replace(/\s+/g, ' '); return c ? c.charAt(0).toUpperCase() + c.slice(1) : 'Divers'; };

// Un marchand ne modifie que SES produits ; l'admin modifie tout
async function ownProduct(req, res) {
  const p = await Product.findOne({ _id: req.params.id, isDeleted: false });
  if (!p) { res.status(404).json({ error: 'Produit introuvable' }); return null; }
  if (req.user.role !== 'admin' && String(p.sellerId) !== String(req.user.id)) {
    res.status(403).json({ error: 'Ce produit ne vous appartient pas' }); return null;
  }
  return p;
}

async function getAll(req, res) {
  try {
    const { q, category, minPrice, maxPrice, shopId, sellerId, page=1, limit=48 } = req.query;
    const filter = { isActive:true, isDeleted:false };
    if (category) filter.category = new RegExp('^' + escRe(san(category)) + '$', 'i');
    if (shopId) {
      if (!/^[a-f0-9]{24}$/.test(String(shopId))) return res.json({ products: [], total: 0, page: 1, pages: 0 });
      const sh = await Shop.findById(String(shopId)).select('ownerId').lean();
      filter.$or = [{ shopId: String(shopId) }].concat(sh && sh.ownerId ? [{ sellerId: String(sh.ownerId) }] : []);
    }
    if (sellerId) filter.sellerId = san(String(sellerId));
    if (req.query.promo === '1') { filter.discount = { $gt: 0 }; filter.discountExpiresAt = { $gt: new Date() }; }       // section « Promotions »
    if (q)        filter.$text    = { $search: san(q) };
    if (minPrice || maxPrice) { filter.price={}; if(minPrice) filter.price.$gte=Number(minPrice); if(maxPrice) filter.price.$lte=Number(maxPrice); }
    const [products, total] = await Promise.all([
      Product.find(filter).sort({ createdAt:-1 }).skip((Number(page)-1)*Number(limit)).limit(Number(limit)).lean({ virtuals:true }),
      Product.countDocuments(filter),
    ]);
    await withSeller(products);
    products.forEach(p => { Object.assign(p, priceInfo(p)); if (!p.reviewCount) p.rating = 0; });
    res.json({ products, total, page:Number(page), pages:Math.ceil(total/Number(limit)) });
  } catch(e) { res.status(500).json({ error: e.message }); }
}

async function getOne(req, res) {
  try {
    const p = await Product.findOne({ _id:req.params.id, isDeleted:false }).lean({ virtuals:true });
    if (!p || !p.isActive) return res.status(404).json({ error:'Produit introuvable' });
    await withSeller([p]);
    Object.assign(p, priceInfo(p));
    if (!p.reviewCount) p.rating = 0;
    // « N achetés au cours du mois dernier » : vraies commandes payées uniquement
    p.sold30 = await Order.countDocuments({ 'items.productId': p._id, status: { $in: ['VALIDÉ', 'LIVRÉ'] }, createdAt: { $gte: new Date(Date.now() - 30 * 86400000) } });
    res.json(p);
  } catch(e) { res.status(500).json({ error:e.message }); }
}

async function create(req, res) {
  try {
    const { name, price, stock, category, description, imageUrl, unit, shopId } = req.body;
    if (!name || !price || !req.user?.id) return res.status(400).json({ error:'name, price requis' });
    const type = req.body.type === 'digital' ? 'digital' : 'physical';
    const digitalUrl = type === 'digital' ? safeHttpsUrl(req.body.digitalUrl) : '';
    if (type === 'digital' && !digitalUrl) return res.status(400).json({ error:'Produit digital : lien de téléchargement https:// obligatoire' });
    const disc = parseDiscount(req.body); if (disc.error) return res.status(400).json({ error: disc.error });
    const extra = detailsFrom(req.body, false);
    if (disc.set) { extra.discount = disc.discount; extra.discountExpiresAt = disc.discountExpiresAt; }
    const p = await Product.create({ name:san(name), price:Number(price), stock:Number(stock)||0, category:normCat(category), description:san(description||''), imageUrl:safeUrl(imageUrl), unit:san(unit||'unité'), type, digitalUrl, sellerId:req.user.id, shopId:req.user.shopId||null, ...extra });
    res.status(201).json(p);
  } catch(e) { res.status(500).json({ error:e.message }); }
}

async function update(req, res) {
  try {
    if (!(await ownProduct(req, res))) return;
    const allowed = ['name','price','stock','category','description','imageUrl','unit','isActive','type','digitalUrl'];
    const upd = {};
    allowed.forEach(k => { if(req.body[k]!==undefined) upd[k]=req.body[k]; });
    if(upd.name)        upd.name        = san(upd.name);
    if(upd.description) upd.description = san(upd.description);
    if(upd.category) upd.category = normCat(upd.category);
    if(upd.unit) upd.unit = san(upd.unit);
    if(upd.imageUrl !== undefined) upd.imageUrl = safeUrl(upd.imageUrl);
    if(upd.type !== undefined) upd.type = upd.type === 'digital' ? 'digital' : 'physical';
    if(upd.digitalUrl !== undefined) {
      const link = safeHttpsUrl(upd.digitalUrl);
      if (link) upd.digitalUrl = link; else delete upd.digitalUrl;            // vide : on garde le lien actuel
    }
    if(upd.type === 'physical') upd.digitalUrl = '';
    if(upd.price)       upd.price       = Number(upd.price);
    if(upd.stock!==undefined) upd.stock = Number(upd.stock);
    Object.assign(upd, detailsFrom(req.body, true));
    const disc = parseDiscount(req.body); if (disc.error) return res.status(400).json({ error: disc.error });
    if (disc.set) { upd.discount = disc.discount; upd.discountExpiresAt = disc.discountExpiresAt; }
    const p = await Product.findByIdAndUpdate(req.params.id, upd, { new:true, runValidators:true });
    if (!p) return res.status(404).json({ error:'Produit introuvable' });
    res.json(p);
  } catch(e) { res.status(500).json({ error:e.message }); }
}

async function remove(req, res) {
  try {
    if (!(await ownProduct(req, res))) return;
    await Product.findByIdAndUpdate(req.params.id, { isDeleted:true, isActive:false });
    res.json({ success:true });
  } catch(e) { res.status(500).json({ error:e.message }); }
}

async function addStock(req, res) {
  try {
    if (!(await ownProduct(req, res))) return;
    const qty = Number(req.body.quantity);
    if (!qty || qty < 1) return res.status(400).json({ error:'quantity invalide' });
    const p = await Product.findByIdAndUpdate(req.params.id, { $inc:{ stock:qty } }, { new:true });
    if (!p) return res.status(404).json({ error:'Produit introuvable' });
    res.json({ success:true, stock:p.stock });
  } catch(e) { res.status(500).json({ error:e.message }); }
}

async function seed(req, res) {
  try {
    const count = await Product.countDocuments();
    if (count > 0) return res.json({ message:`Déjà ${count} produits en base`, count });
    await Product.insertMany([
      { name:'Jus de Bissap',    price:1500, stock:200, category:'Boissons',  unit:'bouteille 50cl', description:'Jus d\'hibiscus naturel du Cameroun, riche en vitamine C',  imageUrl:'https://images.unsplash.com/photo-1600271886742-f049cd451bba?w=400', rating:4.8, sellerId:'admin' },
      { name:'Jus de Baobab',    price:1500, stock:150, category:'Boissons',  unit:'bouteille 50cl', description:'Jus de fruit du baobab, source naturelle de calcium',         imageUrl:'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?w=400', rating:4.7, sellerId:'admin' },
      { name:'Jus de Gingembre', price:1200, stock:180, category:'Boissons',  unit:'bouteille 33cl', description:'Jus de gingembre frais, réchauffant et digestif',              imageUrl:'https://images.unsplash.com/photo-1576673442511-7e39b6545c87?w=400', rating:4.9, sellerId:'admin' },
      { name:'Jus de Foléré',    price:1000, stock:120, category:'Boissons',  unit:'bouteille 50cl', description:'Jus de fleurs de roselle, antioxydant naturel',                imageUrl:'https://images.unsplash.com/photo-1560508180-03f285f67ded?w=400', rating:4.6, sellerId:'admin' },
      { name:'Jus d\'Ananas',    price:1200, stock:160, category:'Boissons',  unit:'bouteille 50cl', description:'Jus d\'ananas frais de la Moungo, sucré naturellement',        imageUrl:'https://images.unsplash.com/photo-1550258987-190a2d41a8ba?w=400', rating:4.8, sellerId:'admin' },
      { name:'Jus de Tamarin',   price:1000, stock:100, category:'Boissons',  unit:'bouteille 33cl', description:'Jus de tamarin, doux et acidulé, riche en fer',                imageUrl:'https://images.unsplash.com/photo-1505252585461-04db1eb84625?w=400', rating:4.5, sellerId:'admin' },
    ]);
    res.json({ message:'✅ 6 produits insérés', count:6 });
  } catch(e) { res.status(500).json({ error:e.message }); }
}

// GET /api/categories : chaque catégorie avec son nombre de produits et jusqu'à 4 photos
async function getCategories(req, res) {
  try {
    const categories = await Product.aggregate([
      { $match: { isActive: true, isDeleted: false } },
      { $sort: { createdAt: -1 } },
      { $group: {
          _id: { $toLower: { $ifNull: ['$category', 'Divers'] } },
          name: { $first: { $ifNull: ['$category', 'Divers'] } },
          count: { $sum: 1 },
          images: { $push: '$imageUrl' } } },
      { $project: { _id: 0, name: 1, count: 1,
          images: { $slice: [ { $filter: { input: '$images', as: 'i', cond: { $and: [ { $ne: ['$$i', null] }, { $ne: ['$$i', ''] } ] } } }, 4 ] } } },
      { $sort: { name: 1 } },
    ]);
    res.json({ categories });
  } catch(e) { res.status(500).json({ error: e.message }); }
}

// ── Autres produits de la même boutique + produits similaires ──
async function related(req, res) {
  try {
    const p = await Product.findOne({ _id: req.params.id, isDeleted: false, isActive: true }).lean();
    if (!p) return res.status(404).json({ error: 'Produit introuvable' });
    const base = { isDeleted: false, isActive: true, _id: { $ne: p._id } };
    const same = await Product.find({ ...base, sellerId: p.sellerId }).sort({ createdAt: -1 }).limit(8).lean();
    const sim  = await Product.find({ ...base, category: p.category, sellerId: { $ne: p.sellerId } }).sort({ createdAt: -1 }).limit(8).lean();
    for (const list of [same, sim]) { await withSeller(list); list.forEach(x => { Object.assign(x, priceInfo(x)); if (!x.reviewCount) x.rating = 0; }); }
    res.json({ sameShop: same, similar: sim });
  } catch (e) { res.status(500).json({ error: 'Erreur serveur' }); }
}
// ── Remise rapide : le marchand sur SES produits (ou l'admin) ──
async function setDiscount(req, res) {
  try {
    if (!(await ownProduct(req, res))) return;
    const d = parseDiscount({ discount: req.body.discount, discountExpiresAt: req.body.discountExpiresAt });
    if (d.error) return res.status(400).json({ error: d.error });
    if (!d.set || d.discount <= 0) return res.status(400).json({ error: 'Indiquez un pourcentage de 1 à 90' });
    const p = await Product.findByIdAndUpdate(req.params.id, { discount: d.discount, discountExpiresAt: d.discountExpiresAt }, { new: true });
    res.json({ success: true, discount: p.discount, discountExpiresAt: p.discountExpiresAt });
  } catch (e) { res.status(500).json({ error: 'Erreur serveur' }); }
}
async function removeDiscount(req, res) {
  try {
    if (!(await ownProduct(req, res))) return;
    await Product.findByIdAndUpdate(req.params.id, { discount: 0, discountExpiresAt: null });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Erreur serveur' }); }
}
module.exports = { getAll, getOne, create, update, remove, addStock, seed, getCategories, related, setDiscount, removeDiscount };
