const { GoogleGenAI } = require('@google/genai');

if (!process.env.GEMINI_API_KEY) {
  console.warn('⚠️  GEMINI_API_KEY not set. AI features will fail.');
  console.warn('   Copy .env.example to .env and fill in your credentials.');
}

// Initialize the Google GenAI SDK
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || 'not-configured',
  apiVersion: 'v1'
});

module.exports = ai;
