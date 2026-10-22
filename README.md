# 🌶️ Green Pepper Market

Marketplace camerounais — Paiement KPay (MTN MoMo & Orange Money)

## Stack
- **Backend**: Node.js + Express + MongoDB Atlas
- **Auth**: JWT Access (1h) + Refresh httpOnly Cookie (7j)
- **Paiement**: KPay Production (`KPAY_API_KEY`)
- **Sécurité**: Helmet, CORS, Rate-limit, mongoSanitize, HPP, HMAC callback, bcrypt 12 rounds

## Démarrage rapide

```bash
cp .env.example .env   # remplir les vraies valeurs
npm install
node server.js
```

## Variables Render (obligatoires)

| Variable | Description |
|---|---|
| `MONGO_URI` | URI MongoDB Atlas |
| `JWT_SECRET` | Secret JWT (32+ chars) |
| `JWT_REFRESH_SECRET` | Secret Refresh JWT (différent) |
| `ADMIN_USER` | Login admin (ex: quentin) |
| `ADMIN_PASS_HASH` | Hash bcrypt du mot de passe admin |
| `KPAY_API_KEY` | Clé API KPay production (`kpay_live_...`) |
| `KPAY_GATEWAY_SECRET` | Secret HMAC pour les callbacks KPay |
| `ALLOWED_ORIGINS` | Domaines CORS autorisés |

## Générer ADMIN_PASS_HASH
```bash
node -e "require('bcryptjs').hash('VotreMotDePasseAdmin',12).then(console.log)"
```

## Arborescence
```
green-pepper-market/
├── server.js
├── package.json
├── .env.example
├── src/
│   ├── config/db.js + env.js
│   ├── models/ (User, Product, Order, Cart, Shop, Message, Review, Notification, TransactionLog, AuditLog)
│   ├── middlewares/ (auth.js, activityTracker.js, rateLimiters.js, upload.js)
│   ├── controllers/ (auth, product, payment, cart, chat, review, merchant, admin, notification, shop)
│   ├── routes/index.js
│   ├── jobs/ (offlineCron.js, discountExpiryCron.js)
│   └── utils/ (kpay.js, logger.js, notify.js, invoice.js)
└── public/
    ├── index.html / login.html / register.html / admin.html / merchant.html
    ├── css/style.css
    └── js/ (app.js, admin.js, merchant.js)
```

## Sécurité
- Mots de passe : bcrypt 12 rounds
- JWT Access 1h + Refresh 7j httpOnly
- Ban user → tokenVersion++ → invalide tous les tokens
- HMAC SHA-256 sur les callbacks KPay
- Rate limit : 100/15min global, 5/15min auth, 10/15min paiement
- XSS clean sur tous les inputs texte
- mongoSanitize contre injections NoSQL
- HPP contre pollution paramètres HTTP
- Helmet CSP strict

## Routes API principales
- `POST /api/auth/register` — inscription
- `POST /api/auth/login` — connexion
- `POST /api/admin/login` — connexion admin (quentin/oceane)
- `GET  /api/products` — liste produits (public)
- `POST /api/payment/pay` — paiement (guest ou connecté)
- `POST /api/payment/callback` — webhook KPay (HMAC vérifié)
- `GET  /api/admin/users/online` — utilisateurs connectés (admin)
- `GET  /health` — santé du serveur
