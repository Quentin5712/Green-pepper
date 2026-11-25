# Section Paiement — Marketplace Afrique

Moyens proposés : **MTN MoMo · Orange Money · Visa/Mastercard · USDT (TRC20)** + « autre opérateur Mobile Money » (Airtel, Moov, Free, M-Pesa…).
Page : `/paiement.html` · Code : `public/js/paiement.js`, `src/routes/kpay.js`, `src/routes/pay.js`, `src/utils/checkout.js`.

---

## 1. Quel prestataire pour chaque moyen

| Moyen | Prestataire | Pourquoi | Ce qu'il faut |
|---|---|---|---|
| **MTN MoMo** et **Orange Money** (Cameroun) | **KPay** (déjà en place) | Demande directe sur le téléphone du client (USSD) | `KPAY_API_KEY` |
| **Carte Visa / Mastercard** | **KPay — page de paiement hébergée** | Même prestataire, même portefeuille : les versements aux vendeurs puisent au même endroit | Activer « Paiements bancaires » dans le tableau KPay (tu l'as déjà coché) |
| **Autres opérateurs** (Airtel Gabon/Congo, MTN/Orange Côte d'Ivoire, Free/Orange Sénégal, Moov/MTN Bénin…) | **KPay — même page hébergée** | Le client choisit son opérateur et son numéro chez KPay | Cocher les pays voulus dans le tableau KPay |
| **USDT TRC20** | **NOWPayments** | API documentée, notifications signées, gère sous-paiement / surpaiement | `NOWPAYMENTS_API_KEY` + `NOWPAYMENTS_IPN_SECRET` |

Le site n'a **aucun blocage par pays** : n'importe qui peut ouvrir la boutique. Ce qui limite, ce sont les moyens de paiement disponibles dans le pays du client (voir §6).

---

## 2. Parcours client

**MTN / Orange** — *Payer* → il choisit MTN ou Orange → il entre son numéro → **il valide sur son téléphone** (MTN : `*126#`) → la page se met à jour toute seule → confirmation. Produit digital : lien de téléchargement tout de suite. Produit physique : l'argent est conservé jusqu'à la photo de réception.

**Visa / Mastercard / autre opérateur** — *Payer* → il est redirigé vers la **page sécurisée de KPay** → il choisit carte ou opérateur → il valide → il revient sur « Suivi de commande » (déjà à jour grâce au webhook).

**USDT** — *Payer* → la page affiche **l'adresse TRC20 et le montant exact** (copier/coller, compte à rebours) → il envoie depuis son portefeuille → la page affiche « confirmation en cours » puis « payé » toute seule.

Dans tous les cas : **il reçoit son produit** (digital : lien ; physique : livraison, puis il confirme avec une photo et le vendeur est payé).

---

## 3. Quand ça se passe mal

| Cas | Ce que fait le site |
|---|---|
| **Paiement refusé / expiré** | Commande REFUSÉE, **stock remis**, message clair + boutons « Réessayer » / « Choisir un autre moyen ». Nouvelle tentative = nouvelle référence. |
| **Le client clique deux fois / rafraîchit** | Chaque tentative a une référence unique (`clientRef`) : le serveur renvoie **la même commande**, il n'en crée pas une deuxième. Le formulaire se verrouille pendant le paiement. |
| **Le webhook se perd** | La page interroge le prestataire (par `kpayId`) ; un contrôle automatique toutes les 5 minutes rattrape aussi les paiements non confirmés. |
| **Webhook rejoué 2 fois** | Ignoré (traitement unique verrouillé). |
| **Faux webhook** | Rejeté : signature obligatoire, et le statut est **relu chez le prestataire** avant de valider. |
| **Paiement reçu après expiration** | La commande est validée quand même, l'admin est prévenu (vérifier le stock). |
| **USDT : montant incomplet** | Reste en attente, la page indique le complément à envoyer à la **même adresse**, l'admin est alerté. |
| **USDT : trop payé** | Commande validée, l'admin est alerté avec le montant à rembourser. |
| **USDT : mauvais réseau / mauvaise crypto** | Non récupérable (blockchain). La page l'écrit en gras avant l'envoi. |
| **Client débité mais commande pas validée** | Procédure : Admin > Paiement, vérifier chez KPay/NOWPayments, rembourser à la main (pas d'API de remboursement). |

---

## 3 bis. Prix : FCFA + USDT

* Tous les prix du site sont en **FCFA** (XAF et XOF ont la même valeur : 1 XAF = 1 XOF).
* L'équivalent **USDT** s'affiche sur la fiche produit et sur la page de paiement : `prix FCFA ÷ taux FCFA/USD × (1 + marge)`, arrondi au centime supérieur.
* Taux : `open.er-api.com` (gratuit, sans clé), mis en cache 15 min ; si la source tombe, **le prix USDT est masqué** (jamais un taux inventé). Forcer un taux : `XAF_PER_USD_OVERRIDE`.
* Marge de change : **1,5 %** par défaut (`USDT_MARGIN`) pour absorber les variations et frais.
* Le montant exact en USDT est figé au moment du paiement (message « garanti 20 min »).
* L'USDT vaut ≈ 1 USD ; l'affichage est « ≈ ».

---

## 4. Installation

Variables Render : voir `.env.example`. Résumé :

* KPay : `KPAY_API_KEY`, `KPAY_WEBHOOK_SECRET` (+ `KPAY_GATEWAY_SECRET`). Webhook à déclarer chez KPay : `https://TON-SITE/api/kpay/webhook`.
* USDT : `NOWPAYMENTS_API_KEY`, `NOWPAYMENTS_IPN_SECRET`. URL de notification (envoyée automatiquement par le site) : `https://TON-SITE/api/pay/usdt/ipn`. Test : `NOWPAYMENTS_SANDBOX=1`.
* Tant qu'un moyen n'est pas configuré, son bouton est **grisé « Bientôt disponible »** : rien ne casse.

---

## 5. Ce qui est vérifié, et ce qui reste à confirmer avec tes clés

**Vérifié par les tests automatiques** (`node tests/backend.test.js`) : calcul du prix côté serveur, anti double-clic, stock, split commission, versements (national et transfrontalier), blocage sans photo, signatures de webhook, USDT (création, signature, partiel, surpaiement, expiration, paiement tardif), cotation FCFA→USDT, avis, réductions.

**À confirmer au premier essai (je n'ai pas pu les appeler depuis mon environnement)** :
1. **Page hébergée KPay** : adresse d'appel (`KPAY_GATEWAY_PATH`, défaut `/api/v1/payments/init` avec `mode: GATEWAY`) et nom du champ qui renvoie l'adresse de la page. Si KPay répond autrement, les logs affichent « KPay gateway: aucune adresse de paiement… » avec la réponse : envoie-la-moi.
2. **Versement et solde KPay** : `KPAY_PAYOUT_PATH` (défaut `/api/v1/payouts/init`), `KPAY_BALANCE_PATH` (défaut `/api/v1/balance`), champ `sourceCountry` du versement transfrontalier.
3. **Signature des webhooks KPay** : en-tête `X-KPAY-Signature`. Même sans elle, le site relit le statut chez KPay.
4. **NOWPayments** : code `usdttrc20`, statuts et signature (HMAC-SHA512 sur le JSON trié) conformes à leur documentation ; à tester en `NOWPAYMENTS_SANDBOX=1`.

Premier essai conseillé : 500 FCFA (minimum) en MTN, puis en carte, puis 1 USDT en bac à sable.

---

## 6. Vendre au Cameroun, Congo, Gabon, Côte d'Ivoire, Nigeria « sans être bloqué »

| Pays | Mobile Money (via KPay) | Carte | USDT |
|---|---|---|---|
| Cameroun | MTN, Orange (direct) | oui | oui |
| Congo-Brazzaville | MTN, Airtel (page hébergée) | oui | oui |
| Gabon | Airtel (page hébergée) | oui | oui |
| Côte d'Ivoire | MTN, Orange (page hébergée) | oui | oui |
| Nigeria | **pas de Mobile Money KPay** | oui | oui |

Checklist :
1. **Cocher chaque pays** dans le tableau KPay (« Votre région ») : sinon le client de ce pays ne voit pas son opérateur.
2. **Nigeria** : seuls carte et USDT s'appliquent. Pour offrir virement / USSD en naira, il faudra un prestataire dédié (Paystack ou Flutterwave) : non branché ici.
3. **Domaine vérifié** : KPay refuse les clés de production tant que le domaine du site n'est pas vérifié (un nom en `onrender.com` ne peut pas l'être : prends un nom de domaine).
4. **Ne jamais bloquer par pays ou par IP** côté site (le site ne le fait pas) ; si tu mets Cloudflare ou un pare-feu, n'active pas le blocage géographique.
5. **Devises** : XAF (Cameroun, Gabon, Congo) et XOF (Côte d'Ivoire, Sénégal, Bénin) = FCFA. Les vendeurs hors zone FCFA sont payés en monnaie locale par **versement transfrontalier** (conversion faite par KPay).
6. **Montant minimum** : 500 FCFA (carte : 300 FCFA selon KPay).
7. **Réglementation — à faire valider par ton conseil juridique ou ta banque** : réception de devises et change dans la zone CEMAC/UEMOA ; statut des crypto-actifs (non encadré de façon claire dans la zone CEMAC, régulé au Nigeria) ; obligations de déclaration. Ce n'est pas un avis juridique.
