const mongoose = require('mongoose');

const connectDB = async () => {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.log('No MONGO_URI found');
    return;
  }
  try {
    await mongoose.connect(uri);
    console.log('MongoDB Atlas connected');
  } catch (err) {
    console.error('MongoDB error:', err.message);
  }
};

module.exports = connectDB;
