# Guide Migration JSONBin → MongoDB Atlas
# Green Pepper Market

═══════════════════════════════════════════════════════
## ÉTAPE 1 — Installation
═══════════════════════════════════════════════════════

```bash
npm install
```

Votre package.json inclut déjà mongoose et dotenv.

═══════════════════════════════════════════════════════
## ÉTAPE 2 — Créer votre compte MongoDB Atlas (gratuit)
═══════════════════════════════════════════════════════

1. Allez sur https://cloud.mongodb.com
2. Cliquez "Try Free" → créez un compte
3. Choisissez "M0" (gratuit, 512Mo, illimité)
4. Région : choisissez AWS eu-west-1 (Paris) ou us-east-1
5. Cluster name : greenpepperDB
6. Cliquez "Create"

Récupérer l'URI de connexion :
  Atlas → Database → Connect → Drivers → Node.js
  Copiez : mongodb+srv://USERNAME:PASSWORD@cluster0.xxxxx.mongodb.net/greenpepperDB

Whitelist votre IP :
  Atlas → Network Access → Add IP Address → Allow Access from Anywhere (0.0.0.0/0)
  (Pour Render : mettre 0.0.0.0/0 car les IPs changent)

═══════════════════════════════════════════════════════
## ÉTAPE 3 — Fichier .env LOCAL (JAMAIS sur GitHub)
═══════════════════════════════════════════════════════

```bash
cp .env.example .env
```

Éditez .env et remplacez les valeurs :
  MONGO_URI=mongodb+srv://votreUser:votreMotDePasse@cluster0.xxxxx.mongodb.net/greenpepperDB

⚠️ .env est dans .gitignore — il ne partira JAMAIS sur GitHub

═══════════════════════════════════════════════════════
## ÉTAPE 4 — Migrer vos données JSONBin → MongoDB
═══════════════════════════════════════════════════════

Assurez-vous que .env contient aussi BIN_ID et API_KEY (temporairement).

```bash
node migrate.js
```

Le script :
  - Lit toutes vos données JSONBin
  - Les insère dans MongoDB
  - Affiche un rapport

Après migration réussie : supprimez migrate.js et BIN_ID/API_KEY du .env

═══════════════════════════════════════════════════════
## ÉTAPE 5 — Tester en local
═══════════════════════════════════════════════════════

```bash
node server.js
```

Vérifiez les logs :
  ✅ MongoDB Atlas connecté : cluster0.xxxxx.mongodb.net
  ✅ Base de données : greenpepperDB

Tester l'API :
  curl http://localhost:3000/api/products
  curl http://localhost:3000/api/admin/stats

═══════════════════════════════════════════════════════
## ÉTAPE 6 — Déploiement sur Render
═══════════════════════════════════════════════════════

1. Dashboard Render → votre service → Environment
2. Add Variable :
   Key   : MONGO_URI
   Value : mongodb+srv://user:pass@cluster.mongodb.net/greenpepperDB

3. Ajoutez toutes les autres variables de .env.example
4. Cliquez "Save Changes" → Render redéploie automatiquement

╔══════════════════════════════════════════════════════════════╗
║ TABLEAU RÉCAPITULATIF                                        ║
╠══════════════════════════╦═══════════╦══════════════════════╣
║ Fichier                  ║ Action    ║ Rôle                 ║
╠══════════════════════════╬═══════════╬══════════════════════╣
║ .env.example             ║ Créer     ║ Template des secrets ║
║ .env                     ║ Créer     ║ Vos vrais secrets    ║
║ .gitignore               ║ Créer     ║ Exclure .env de Git  ║
║ src/config/db.js         ║ Créer     ║ Connexion MongoDB    ║
║ src/models/Product.js    ║ Créer     ║ Modèle produit       ║
║ src/models/User.js       ║ Créer     ║ Modèle utilisateur   ║
║ src/models/Order.js      ║ Créer     ║ Modèle commande      ║
║ src/models/Notification  ║ Créer     ║ Notifs commerçants   ║
║ src/models/MerchantLink  ║ Créer     ║ Liens invitation     ║
║ migrate.js               ║ Créer     ║ Script migration     ║
║ server.js                ║ Modifier  ║ JSONBin → MongoDB    ║
║ package.json             ║ Modifier  ║ + mongoose + dotenv  ║
╚══════════════════════════╩═══════════╩══════════════════════╝

AVANT (JSONBin) → APRÈS (MongoDB) — les grands changements :

  dbRead() → Product.find()         // requête indexée, pas de lecture totale
  dbWrite() → product.save()        // écriture atomique par document
  db.orders.push() → Order.create() // insertion directe, sans lire toute la DB
  stock++ → $inc atomique           // anti-survente garanti

