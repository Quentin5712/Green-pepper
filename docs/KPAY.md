# Mémo de déploiement — KPay, USDT, numéro admin

Voir aussi `docs/PAIEMENT.md` (parcours, échecs, prix FCFA/USDT, pays).

## 1. Variables Render (Environment)
Obligatoires : `MONGO_URI`, `JWT_SECRET`, `KPAY_API_KEY`, `ADMIN_PASSWORD` (ou `ADMIN_PASS_HASH`).
Recommandées : `KPAY_WEBHOOK_SECRET`, `KPAY_GATEWAY_SECRET`, `SITE_NAME`.
USDT (facultatif) : `NOWPAYMENTS_API_KEY`, `NOWPAYMENTS_IPN_SECRET`.
Repli seulement (la vraie valeur est en base : Admin > Paiement) : `ADMIN_PHONE`, `KPAY_MERCHANT_NUMBER`.
`KPAY_MODE=auto` détecte TEST/LIVE avec la clé (`kpay_test_…` / `kpay_live_…`).

## 2. Dans le tableau de bord KPay
Webhook : `https://TON-SITE/api/kpay/webhook`. Cocher les pays et « Paiements bancaires ».

## 3. Réglages avancés
`KPAY_PAYOUT_PATH`, `KPAY_BALANCE_PATH`, `KPAY_STATUS_PATH`, `KPAY_GATEWAY_PATH`, `KPAY_WALLET_COUNTRY`, `COMMISSION_RATE` (0.10), `USDT_MARGIN` (0.015).

## 4. Avant de publier
1. Ouvrir `public/js/site-config.js` et renseigner : e-mail et WhatsApp du support, raison sociale, RCCM, NIU, adresse. Les pages légales les affichent.
2. Remplir les cadres en pointillés des 4 pages `public/legal/*.html` (produits, délais et frais de livraison, conditions de remboursement, frais de retour, taxes).
3. Faire relire les pages légales par un juriste.
4. Remplacer les logos de paiement simplifiés (`public/images/pay/*.svg`) par les logos officiels de chaque marque.
