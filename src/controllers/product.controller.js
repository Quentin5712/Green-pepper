'use strict';
const Product = require('../models/Product');
const { clean, safeUrl, safeHttpsUrl } = require('../utils/clean');
const User = require('../models/User');
const Shop = require('../models/Shop');

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
    p.shop = shop ? { name: shop.name, logoUrl: shop.logoUrl || '', country: shop.country || '' } : (u && u.storeName ? { name: u.storeName, logoUrl: '', country: u.country || '' } : null);
    p.storeName = u ? (u.storeName || u.name || '') : '';
  });
  return list;
}
const san = s => typeof s==='string' ? clean(s, 2000) : s;
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
    if (shopId)   filter.shopId   = shopId;
    if (sellerId) filter.sellerId = san(String(sellerId));
    if (req.query.promo === '1') { filter.discount = { $gt: 0 }; filter.discountExpiresAt = { $gt: new Date() }; }       // section « Promotions »
    if (q)        filter.$text    = { $search: san(q) };
    if (minPrice || maxPrice) { filter.price={}; if(minPrice) filter.price.$gte=Number(minPrice); if(maxPrice) filter.price.$lte=Number(maxPrice); }
    const [products, total] = await Promise.all([
      Product.find(filter).sort({ createdAt:-1 }).skip((Number(page)-1)*Number(limit)).limit(Number(limit)).lean({ virtuals:true }),
      Product.countDocuments(filter),
    ]);
    await withSeller(products);
    products.forEach(p => Object.assign(p, priceInfo(p)));
    res.json({ products, total, page:Number(page), pages:Math.ceil(total/Number(limit)) });
  } catch(e) { res.status(500).json({ error: e.message }); }
}

async function getOne(req, res) {
  try {
    const p = await Product.findOne({ _id:req.params.id, isDeleted:false }).lean({ virtuals:true });
    if (!p || !p.isActive) return res.status(404).json({ error:'Produit introuvable' });
    await withSeller([p]);
    Object.assign(p, priceInfo(p));
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
    const p = await Product.create({ name:san(name), price:Number(price), stock:Number(stock)||0, category:normCat(category), description:san(description||''), imageUrl:safeUrl(imageUrl), unit:san(unit||'unité'), type, digitalUrl, sellerId:req.user.id, shopId:req.user.shopId||null });
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

module.exports = { getAll, getOne, create, update, remove, addStock, seed, getCategories };
