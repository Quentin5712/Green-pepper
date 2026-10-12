# Green Pepper Market

## Structure GitHub (RACINE du repo)
```
green-pepper-market/
├── server.js          ← point d'entrée
├── package.json
├── .env.example
├── .gitignore
├── public/
│   ├── index.html     ← le site
│   └── uploads/
│       └── admin/
└── src/
    ├── config/db.js
    └── models/...
```

## Render — Configuration
- **Build command** : `npm install`
- **Start command** : `node server.js`

## Variables d'environnement Render
```
MONGO_URI     = mongodb+srv://...
NODE_ENV      = production
JWT_SECRET    = clé_longue_aléatoire
MOMO_ENV      = mtncameroon
MOMO_SUBSCRIPTION_KEY = ...
MOMO_API_USER = ...
MOMO_API_KEY  = ...
CALLBACK_URL  = https://votre-app.onrender.com
ALLOWED_ORIGINS = https://votre-app.onrender.com
BIN_ID        = 6a4cdd5cf5f4af5e296bb50b
API_KEY       = votre_clé_jsonbin
```

## Pourquoi le site ne se met pas à jour sur Render ?
1. Vérifier que `public/index.html` est bien dans le repo GitHub
2. Après chaque push → Render redéploie automatiquement
3. Vider le cache navigateur (Ctrl+Shift+R)
