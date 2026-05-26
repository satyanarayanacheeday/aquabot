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
      if (model.name.includes('embed') || model.supportedMethods?.includes('embedContent')) {
        console.log(`Found embedding model: ${model.name}`);
        console.log(`- Methods: ${model.supportedMethods?.join(', ')}`);
      }
    }
  } catch (e) {
    console.error('Error:', e.message);
  }
}

testModels();
