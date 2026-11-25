# Marketplace Afrique

Boutique multi-marchands pour toute l'Afrique : Mobile Money (KPay), carte Visa/Mastercard, USDT (TRC20).

* `server.js` — démarrage ; `src/` — API (Express + MongoDB) ; `public/` — site (HTML/CSS/JS purs)
* `docs/PAIEMENT.md` — moyens de paiement, parcours, échecs, prix FCFA/USDT, pays
* `docs/KPAY.md` — variables et mise en ligne
* `tests/` — `npm test` (logique d'argent, avis, réductions…)
* `public/js/site-config.js` — nom, e-mail et WhatsApp du support, mentions légales

Démarrage local : `cp .env.example .env` (remplir) puis `npm install && npm start`.
