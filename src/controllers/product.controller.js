'use strict';
const Product = require('../models/Product');
const { clean, safeUrl } = require('../utils/clean');
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
    if (q)        filter.$text    = { $search: san(q) };
    if (minPrice || maxPrice) { filter.price={}; if(minPrice) filter.price.$gte=Number(minPrice); if(maxPrice) filter.price.$lte=Number(maxPrice); }
    const [products, total] = await Promise.all([
      Product.find(filter).sort({ createdAt:-1 }).skip((Number(page)-1)*Number(limit)).limit(Number(limit)).lean({ virtuals:true }),
      Product.countDocuments(filter),
    ]);
    res.json({ products, total, page:Number(page), pages:Math.ceil(total/Number(limit)) });
  } catch(e) { res.status(500).json({ error: e.message }); }
}

async function getOne(req, res) {
  try {
    const p = await Product.findOne({ _id:req.params.id, isDeleted:false }).lean({ virtuals:true });
    if (!p || !p.isActive) return res.status(404).json({ error:'Produit introuvable' });
    res.json(p);
  } catch(e) { res.status(500).json({ error:e.message }); }
}

async function create(req, res) {
  try {
    const { name, price, stock, category, description, imageUrl, unit, shopId } = req.body;
    if (!name || !price || !req.user?.id) return res.status(400).json({ error:'name, price requis' });
    const p = await Product.create({ name:san(name), price:Number(price), stock:Number(stock)||0, category:normCat(category), description:san(description||''), imageUrl:safeUrl(imageUrl), unit:san(unit||'unité'), sellerId:req.user.id, shopId:req.user.shopId||null });
    res.status(201).json(p);
  } catch(e) { res.status(500).json({ error:e.message }); }
}

async function update(req, res) {
  try {
    if (!(await ownProduct(req, res))) return;
    const allowed = ['name','price','stock','category','description','imageUrl','unit','isActive'];
    const upd = {};
    allowed.forEach(k => { if(req.body[k]!==undefined) upd[k]=req.body[k]; });
    if(upd.name)        upd.name        = san(upd.name);
    if(upd.description) upd.description = san(upd.description);
    if(upd.category) upd.category = normCat(upd.category);
    if(upd.unit) upd.unit = san(upd.unit);
    if(upd.imageUrl !== undefined) upd.imageUrl = safeUrl(upd.imageUrl);
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
