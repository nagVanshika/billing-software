const app = require('../billing-backend/src/app');
const connectDB = require('../billing-backend/src/config/database');

// Export the Vercel serverless function
module.exports = async (req, res) => {
  // Ensure we connect using the identical mongoose package located in the billing-backend module
  await connectDB();
  return app(req, res);
};
