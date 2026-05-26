const { GoogleGenAI } = require('@google/genai');
require('dotenv').config();

async function listModels() {
  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    apiVersion: 'v1'
  });

  try {
    console.log('--- Listing All Models ---');
    const response = await ai.models.list();
    console.log('Response Structure:', Object.keys(response));
    const models = response.models || response;
    if (Array.isArray(models)) {
      models.forEach(m => {
        console.log(`- ${m.name} (Methods: ${m.supportedMethods.join(', ')})`);
      });
    } else {
      console.log('Models is not an array:', typeof models);
    }
  } catch (err) {
    console.error('Error listing models:', err.message);
    
    console.log('\n--- Trying v1beta ---');
    try {
      const aiBeta = new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY,
        apiVersion: 'v1beta'
      });
      const modelsBeta = await aiBeta.models.list();
      modelsBeta.forEach(m => {
        console.log(`- ${m.name} (Methods: ${m.supportedMethods.join(', ')})`);
      });
    } catch (err2) {
      console.error('Error listing models in v1beta:', err2.message);
    }
  }
}

listModels();
