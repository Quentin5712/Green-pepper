'use strict';
const Shop = require('../models/Shop');
const xss  = require('xss');
const san  = s => typeof s==='string' ? xss(s.trim()).slice(0,2000) : s;

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
    const shop = await Shop.create({ name:san(name), description:san(description||''), category:category||'Général', city:city||'', phone:phone||'', ownerId:req.user.id });
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
    const shop = await Shop.findByIdAndUpdate(req.params.id, upd, { new:true });
    if (!shop) return res.status(404).json({ error:'Boutique introuvable' });
    res.json(shop);
  } catch(e) { res.status(500).json({ error:e.message }); }
}

module.exports = { getAll, getOne, create, update };
