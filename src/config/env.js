'use strict';

// Validation souple : seuls MONGO_URI et JWT_SECRET sont obligatoires
// Toutes les autres variables ont des valeurs par défaut
const required = ['MONGO_URI', 'JWT_SECRET'];
const missing  = required.filter(k => !process.env[k]);

if (missing.length) {
  console.error('❌ Variables obligatoires manquantes:', missing.join(', '));
  console.error('   Ajoutez-les sur Render → Environment');
  process.exit(1);
}

// JWT_REFRESH_SECRET par défaut = JWT_SECRET + "_refresh"
if (!process.env.JWT_REFRESH_SECRET) {
  process.env.JWT_REFRESH_SECRET = process.env.JWT_SECRET + '_refresh_secret_green_pepper';
}

// ADMIN_USER par défaut = quentin
if (!process.env.ADMIN_USER) process.env.ADMIN_USER = 'quentin';

// KPAY optionnel — warning si absent
if (!process.env.KPAY_API_KEY) {
  console.warn('⚠️  KPAY_API_KEY manquant — le paiement KPay sera désactivé');
}
if (!process.env.ADMIN_PASS_HASH) {
  console.warn('⚠️  ADMIN_PASS_HASH manquant — générez-le avec : node -e "require(\'bcryptjs\').hash(\'VotreMotDePasse\',12).then(console.log)"');
}

console.log('✅ Configuration validée');
module.exports = process.env;
