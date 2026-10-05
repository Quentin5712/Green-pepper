# Green Pepper Market — Déploiement Render

## Variables d'environnement (obligatoires sur Render)

```
# JSONBin
BIN_ID        = 6a4cdd5cf5f4af5e296bb50b
API_KEY       = $2a$10$WiRdDM1vwwyaoA.yf/.XkuA/2173q1VIdQ56RJyfD4vGgp8U5tu.O
PORT          = 3000

# MTN MoMo PRODUCTION (obtenir sur developer.mtn.com)
MOMO_SUBSCRIPTION_KEY = votre_clé_abonnement
MOMO_API_USER         = votre_uuid_api_user
MOMO_API_KEY          = votre_api_key
MOMO_ENV              = mtncameroon
CALLBACK_URL          = https://votre-app.onrender.com

# Orange Money (optionnel, obtenir sur developer.orange.com)
OM_CLIENT_ID      = votre_client_id
OM_CLIENT_SECRET  = votre_client_secret
OM_MERCHANT_KEY   = votre_merchant_key
```

## Build & Start
- Build command: `npm install`
- Start command: `node server.js`

## Photos
- Admin: `/public/uploads/admin/`
- Commerçant ID "m123": `/public/uploads/m123/`
- Upload via le picker dans le dashboard (bouton 📤)

## Connexion admin
- Email: quentin | Mot de passe: Quentin

## PIN clients (section Clients)
- 1239
