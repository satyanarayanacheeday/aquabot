const { GoogleGenAI } = require('@google/genai');
require('dotenv').config();

async function testModels() {
  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    apiVersion: 'v1beta'
  });

  try {
    const modelsResponse = await ai.models.list();
    for await (const model of modelsResponse) {
      if (model.name.includes('gemini')) {
        console.log(`Found model: ${model.name}`);
      }
    }
  } catch (e) {
    console.error('Error:', e.message);
  }
}

testModels();
