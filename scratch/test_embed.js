const { GoogleGenAI } = require('@google/genai');
require('dotenv').config();

async function testEmbed() {
  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    apiVersion: 'v1beta'
  });

  try {
    const response = await ai.models.embedContent({
      model: 'gemini-embedding-2',
      contents: [{ parts: [{ text: 'Hello world' }] }]
    });
    console.log(JSON.stringify(response, null, 2));
  } catch (e) {
    console.error('Error:', e.message);
  }
}

testEmbed();
