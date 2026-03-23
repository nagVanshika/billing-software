const mongoose = require('mongoose');
const logger = require('./logger');

let isConnected = false;

const connectDB = async () => {
  if (isConnected) {
    return;
  }
  
  if (!process.env.MONGODB_URI) {
    logger.error('MONGODB_URI is undefined. Cannot connect to local or remote DB.');
    return;
  }

  try {
    const db = await mongoose.connect(process.env.MONGODB_URI, {
      maxPoolSize: 10,
    });
    isConnected = db.connections[0].readyState;
    logger.info('Connected to MongoDB (Vercel Serverless) via shared internal module');
  } catch (err) {
    logger.error('Error connecting to MongoDB in Serverless:', err.message);
  }
};

module.exports = connectDB;
