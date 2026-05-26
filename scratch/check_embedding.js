const { GoogleGenAI } = require('@google/genai');
require('dotenv').config();

async function checkEmbedding() {
  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    apiVersion: 'v1'
  });

  try {
    console.log('--- Testing text-embedding-004 ---');
    const response = await ai.models.embedContent({
      model: 'text-embedding-004',
      contents: [{ parts: [{ text: 'Testing embeddings' }] }]
    });
    console.log('Response:', JSON.stringify(response, null, 2));
  } catch (err) {
    console.error('text-embedding-004 failed:', err.message);
  }

  try {
    console.log('\n--- Testing gemini-embedding-2 (current) ---');
    const response = await ai.models.embedContent({
      model: 'gemini-embedding-2',
      contents: [{ parts: [{ text: 'Testing embeddings' }] }]
    });
    console.log('Response:', JSON.stringify(response, null, 2));
  } catch (err) {
    console.error('gemini-embedding-2 failed:', err.message);
  }
}

checkEmbedding();
