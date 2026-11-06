'use strict';
const multer = require('multer');

// En mémoire (pas de fichier sur le disque), 1,5 Mo max, JPG/PNG/WebP uniquement
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1.5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) =>
    ['image/jpeg','image/png','image/webp'].includes(file.mimetype)
      ? cb(null, true)
      : cb(new Error('Format non autorisé (JPG, PNG ou WebP)')),
}).single('image');

module.exports = (req, res, next) => upload(req, res, err => {
  if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Photo trop lourde (1,5 Mo max)' : err.message });
  next();
});
