const { GoogleGenAI } = require('@google/genai');
require('dotenv').config();

async function testGenerate() {
  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    apiVersion: 'v1beta'
  });

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
      config: {
        systemInstruction: "You are a helpful assistant.",
        temperature: 0.7,
        maxOutputTokens: 1000,
      }
    });
    console.log("response.text type:", typeof response.text);
    if (typeof response.text === 'function') {
      console.log("response.text():", response.text());
    } else {
      console.log("response.text property:", response.text);
    }
  } catch (e) {
    console.error('Error:', e.message);
  }
}

testGenerate();
