# Paiement KPay, versements et numéro admin — mémo de déploiement

## 1. Variables Render (Environment)
Obligatoires : `MONGO_URI`, `JWT_SECRET`, `KPAY_API_KEY`, `ADMIN_PASSWORD` (ou `ADMIN_PASS_HASH`).
Recommandées : `KPAY_WEBHOOK_SECRET` (secret de signature des webhooks), `KPAY_GATEWAY_SECRET`.
Repli seulement (la vraie valeur est en base, onglet Admin > Paiement) : `ADMIN_PHONE`, `KPAY_MERCHANT_NUMBER`.
`KPAY_MODE=auto` détecte TEST/LIVE avec la clé (`kpay_test_…` / `kpay_live_…`).

## 2. Dans le tableau de bord KPay
Webhook (chemin seulement) : `/api/kpay/webhook`  → https://TON-SITE/api/kpay/webhook

## 3. Réglages avancés (si KPay utilise d'autres adresses que celles supposées)
`KPAY_PAYOUT_PATH` (défaut `/api/v1/payouts/init`), `KPAY_BALANCE_PATH` (défaut `/api/v1/balance`),
`KPAY_STATUS_PATH` (défaut `/api/v1/payments/{id}`), `COMMISSION_RATE` (défaut `0.10`).
Si l'adresse du solde est fausse, les versements restent « en attente de solde » (jamais envoyés à l'aveugle).

## 4. Premier test (mode TEST, clé `kpay_test_…`)
1. Logs au démarrage : `KPay MODE = test …` et `KPay Admin Merchant Number = … | Source = …`.
2. Admin > Paiement : saisir le numéro de réception (237 + 9 chiffres) > Enregistrer.
3. Admin > Boutiques : créer un marchand (téléphone Mobile Money de versement obligatoire).
4. Commander un produit (≥ 500 FCFA) : logs `KPay init OK: id=…`, puis `VALIDÉ: …`.
5. Physique : page Suivi > photo > « J'ai reçu ma commande » > logs `PAYOUT …`.
