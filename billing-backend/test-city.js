const axios = require('axios');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const getSystemToken = () => {
  return jwt.sign(
    { type: 'system', name: 'BillingBackend' },
    process.env.EXTERNAL_API_SECRET || process.env.ACCESS_TOKEN_SECRET,
    { expiresIn: '1h' }
  );
};

const testCityData = async () => {
  try {
    const token = getSystemToken();
    const url = 'https://app.carmaacarcare.com/api/admin/v1/get-city-data';
    
    console.log('Fetching from:', url);
    const resp = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 10000
    });
    
    console.log('Response Status:', resp.status);
    console.log('Response Data:', JSON.stringify(resp.data, null, 2));
  } catch (error) {
    console.error('Fetch failed:', error.response?.data || error.message);
  }
};

testCityData();
