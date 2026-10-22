#!/bin/bash
# ══════════════════════════════════════════════
# Green Pepper Market — setup.sh
# Crée toute la structure du projet
# Usage : bash setup.sh
# ══════════════════════════════════════════════
echo "🌶️  Création de la structure Green Pepper Market..."

# Créer les dossiers
mkdir -p src/config
mkdir -p src/models
mkdir -p src/controllers
mkdir -p src/routes
mkdir -p src/middlewares
mkdir -p src/utils
mkdir -p public/css
mkdir -p public/js
mkdir -p public/uploads/admin

# Créer les fichiers vides (tu les remplis avec le contenu du ZIP)
touch server.js
touch package.json
touch .gitignore
touch .env.example

touch src/config/db.js
touch src/models/Product.js
touch src/models/Order.js
touch src/controllers/product.controller.js
touch src/controllers/payment.controller.js
touch src/routes/product.routes.js
touch src/routes/payment.routes.js
touch src/middlewares/verifyPayment.js
touch src/utils/kpay.js
touch src/utils/momo.js

touch public/index.html
touch public/admin.html
touch public/css/style.css
touch public/js/app.js
touch public/js/admin.js
touch public/uploads/admin/.gitkeep

echo ""
echo "✅ Structure créée ! Voici les fichiers :"
find . -not -path "./node_modules/*" -not -path "./.git/*" -type f | sort

echo ""
echo "📌 Prochaine étape :"
echo "   1. Copie le contenu de chaque fichier du ZIP"
echo "   2. Crée le fichier .env avec MONGO_URI et KPAY_API_KEY"
echo "   3. npm install"
echo "   4. node server.js"
