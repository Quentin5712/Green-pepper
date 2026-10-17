'use strict';
const mongoose = require('mongoose');

const connectDB = async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('❌ MONGO_URI manquant dans les variables d\'environnement');
    console.error('   Ajoutez MONGO_URI sur Render → Environment');
    process.exit(1);
  }
  await mongoose.connect(uri, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  });
  console.log(`✅ MongoDB connecté : ${mongoose.connection.host}`);

  mongoose.connection.on('disconnected', () => console.warn('⚠️  MongoDB déconnecté'));
  mongoose.connection.on('reconnected',  () => console.log('✅ MongoDB reconnecté'));
};

module.exports = connectDB;
