const { GoogleGenAI } = require('@google/genai');
require('dotenv').config();

async function test() {
  try {
    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      apiVersion: 'v1'
    });

    console.log('--- Listing Models (Default) ---');
    try {
      const models = await ai.models.list();
      console.log('Available Models:');
      models.forEach(m => console.log(`- ${m.name}`));
    } catch (err) {
      console.error('Error listing models:', err.message);
    }

    const modelsToTry = [
      'gemini-1.5-flash',
      'gemini-1.5-flash-latest',
      'gemini-1.5-flash-001',
      'gemini-1.5-flash-8b',
      'gemini-1.0-pro'
    ];

    for (const modelName of modelsToTry) {
      console.log(`\n--- Testing ${modelName} ---`);
      try {
        const response = await ai.models.generateContent({
          model: modelName,
          contents: [{ role: 'user', parts: [{ text: 'Hi' }] }]
        });
        console.log(`Success with ${modelName}!`);
        return; // Stop if one works
      } catch (err) {
        console.error(`Error with ${modelName}:`, err.message);
      }
    }
  } catch (error) {
    console.error('Global Error:', error);
  }
}

test();
