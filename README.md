# Marketplace Afrique

Boutique multi-marchands pour toute l'Afrique : Mobile Money (KPay), carte Visa/Mastercard, USDT (TRC20).

* `server.js` — démarrage ; `src/` — API (Express + MongoDB) ; `public/` — site (HTML/CSS/JS purs)
* `docs/PAIEMENT.md` — moyens de paiement, parcours, échecs, prix FCFA/USDT, pays
* `docs/KPAY.md` — variables et mise en ligne
* `tests/` — `npm test` (logique d'argent, avis, réductions…)
* `public/js/site-config.js` — nom, e-mail et WhatsApp du support, mentions légales

Démarrage local : `cp .env.example .env` (remplir) puis `npm install && npm start`.

## Fiche produit et remises
* **Fiche détaillée** (marchand ou admin) : marque, origine, livraison, points forts, « à propos », spécifications, 4 photos en plus, description complète.
* **Remise** : chaque marchand gère SES remises (1 à 90 %, date de fin obligatoire, 180 jours maximum) depuis le formulaire produit ; l'admin peut le faire sur tous les produits.
* **Logo + nom de la boutique** et **bouton WhatsApp** : sur chaque produit ; WhatsApp obligatoire à la création d'un marchand.
