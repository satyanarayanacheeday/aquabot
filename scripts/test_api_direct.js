const axios = require('axios');
require('dotenv').config();

async function testDirect() {
  const key = process.env.GEMINI_API_KEY;
  console.log('Testing Direct API call...');
  
  try {
    const res = await axios.get(`https://generativelanguage.googleapis.com/v1/models?key=${key}`);
    console.log('v1 Models count:', res.data.models?.length);
  } catch (err) {
    console.error('v1 failed:', err.response?.status, err.response?.data);
  }

  try {
    const res = await axios.get(`https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash?key=${key}`);
    console.log('v1 gemini-1.5-flash status:', res.status);
  } catch (err) {
    console.error('v1 gemini-1.5-flash failed:', err.response?.status, err.response?.data);
  }
}

testDirect();
