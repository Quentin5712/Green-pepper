'use strict';
const multer = require('multer');
const path   = require('path');
const crypto = require('crypto');
const fs     = require('fs');

const UPLOAD_DIR = path.join(__dirname, '../../public/uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_MIME  = ['image/jpeg','image/png','image/webp'];
const MAGIC_NUMBERS = { 'ffd8ff': 'image/jpeg', '89504e': 'image/png', '524946': 'image/webp' };

function checkMagic(buffer) {
  const hex = buffer.slice(0,3).toString('hex');
  return Object.keys(MAGIC_NUMBERS).some(m => hex.startsWith(m));
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename:    (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, crypto.randomUUID() + ext);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.includes(file.mimetype)) return cb(new Error('Format non autorisé (jpg/png/webp)'));
    cb(null, true);
  },
}).single('image');

function uploadMiddleware(req, res, next) {
  upload(req, res, err => {
    if (err) return res.status(400).json({ error: err.message });
    if (req.file) {
      const buf = fs.readFileSync(req.file.path).slice(0, 3);
      if (!checkMagic(buf)) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'Fichier invalide (magic number)' });
      }
    }
    next();
  });
}

module.exports = uploadMiddleware;
