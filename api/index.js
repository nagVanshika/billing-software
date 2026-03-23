const mongoose = require('mongoose');
const app = require('../billing-backend/src/app');
const logger = require('../billing-backend/src/config/logger');

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
    logger.info('Connected to MongoDB (Vercel Serverless)');
  } catch (err) {
    logger.error('Error connecting to MongoDB in Serverless:', err.message);
  }
};

// Export the Vercel serverless function
module.exports = async (req, res) => {
  await connectDB();
  return app(req, res);
};
