'use strict';
const Shop = require('../models/Shop');
const { clean, safeUrl } = require('../utils/clean');
const san  = s => typeof s==='string' ? clean(s, 2000) : s;

async function getAll(req, res) {
  try {
    const { q, page=1, limit=20 } = req.query;
    const filter = { isDeleted:false, isActive:true };
    if (q) filter.$text = { $search: san(q) };
    const [shops, total] = await Promise.all([
      Shop.find(filter).populate('ownerId','name email').sort({ createdAt:-1 }).skip((Number(page)-1)*Number(limit)).limit(Number(limit)).lean(),
      Shop.countDocuments(filter),
    ]);
    res.json({ shops, total, page:Number(page) });
  } catch(e) { res.status(500).json({ error:e.message }); }
}

async function getOne(req, res) {
  try {
    const shop = await Shop.findOne({ _id:req.params.id, isDeleted:false }).populate('ownerId','name').lean();
    if (!shop) return res.status(404).json({ error:'Boutique introuvable' });
    res.json(shop);
  } catch(e) { res.status(500).json({ error:e.message }); }
}

async function create(req, res) {
  try {
    const { name, description, category, city, phone } = req.body;
    if (!name) return res.status(400).json({ error:'name requis' });
    const shop = await Shop.create({ name:san(name), description:san(description||''), category:san(category||'Général'), city:san(city||''), phone:san(phone||''), ownerId:req.user.id });
    res.status(201).json(shop);
  } catch(e) { res.status(500).json({ error:e.message }); }
}

async function update(req, res) {
  try {
    const allowed = ['name','description','category','city','phone','logoUrl'];
    const upd = {};
    allowed.forEach(k => { if(req.body[k]!==undefined) upd[k]=req.body[k]; });
    if(upd.name)        upd.name        = san(upd.name);
    if(upd.description) upd.description = san(upd.description);
    for (const k of ['category','city','phone']) if (upd[k]) upd[k] = san(upd[k]);
    if (upd.logoUrl !== undefined) upd.logoUrl = safeUrl(upd.logoUrl);
    const own = await Shop.findOne({ _id: req.params.id, isDeleted: false });
    if (!own) return res.status(404).json({ error:'Boutique introuvable' });
    if (req.user.role !== 'admin' && String(own.ownerId) !== String(req.user.id)) return res.status(403).json({ error:'Cette boutique ne vous appartient pas' });
    const shop = await Shop.findByIdAndUpdate(req.params.id, upd, { new:true });
    if (!shop) return res.status(404).json({ error:'Boutique introuvable' });
    res.json(shop);
  } catch(e) { res.status(500).json({ error:e.message }); }
}

module.exports = { getAll, getOne, create, update };
