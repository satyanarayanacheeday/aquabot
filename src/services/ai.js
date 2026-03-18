const ai = require('../config/gemini');
const SYSTEM_PROMPT = require('../prompts/systemPrompt');
const { searchKnowledge, getRecentChats, getRecentDailyData, getFirstFarmByFarmer, getFarmerById } = require('../models/database');
const { getWeather } = require('./weather');

/**
 * Generate an embedding for a given text
 */
async function generateEmbedding(text) {
  try {
    console.log('generateEmbedding: Calling ai.models.embedContent (text-embedding-004)');
    const response = await ai.models.embedContent({
      model: 'text-embedding-004',
      contents: text
    });
    console.log('generateEmbedding: Success');
    return response.embedding.values;
  } catch (error) {
    console.error('⚠️ Embedding generation failed:', error.message);
    // Don't throw, return null to allow partial RAG fallback
    return null;
  }
}

/**
 * Answer a farmer's question using RAG + Gemini
 */
async function answerQuestion(question, farmerId, preferredLanguage = 'English') {
  try {
    // 1. Generate embedding for the question
    console.log('Step 3: Generating embedding');
    const embedding = await generateEmbedding(question);

    // 2. Search knowledge base for relevant context
    let knowledgeContext = '';
    if (embedding) {
      console.log('Step 2: Searching knowledge base');
      try {
        const matches = await searchKnowledge(embedding, 3, 0.4); // slightly lower threshold
        if (matches.length > 0) {
          knowledgeContext = '\n\n## Relevant Knowledge Base:\n' +
            matches.map(m => `- ${m.content}`).join('\n');
          console.log(`   [AI LOG] Step 2: Found ${matches.length} matches`);
        } else {
          console.log('Step 2: No knowledge matches found');
        }
      } catch (err) {
        console.warn('⚠️ Knowledge search failed:', err.message);
      }
    } else {
      console.log('Step 2: Skipping knowledge search (no embedding)');
    }

    // 3. Get farmer and farm context
    let farmContext = '';
    let weatherContext = '';
    try {
      const farmerData = await getFarmerById(farmerId);
      if (farmerData && farmerData.location) {
        console.log(`Step 3: Fetching weather for ${farmerData.location}`);
        const weather = await getWeather(farmerData.location);
        if (weather) {
          weatherContext = `\n\n## Current Weather in ${weather.location}:\n- Temp: ${weather.temperature}°C (Feels like ${weather.feelsLike}°C)\n- Humidity: ${weather.humidity}%\n- Condition: ${weather.description}\n- Rainfall: ${weather.rainfall}mm/h\n- Wind: ${weather.windSpeed}m/s`;
          console.log('Step 3: Weather data integrated');
        }
      }

      const farm = await getFirstFarmByFarmer(farmerId);
      if (farm) {
        farmContext = `\n\n## Farmer's Farm Info:\n- Species: ${farm.species}\n- Pond Size: ${farm.pond_size}\n- Stocking Date: ${farm.stocking_date}\n- PL Count: ${farm.pl_count}`;

        const recentData = await getRecentDailyData(farm.id, 3);
        if (recentData.length > 0) {
          farmContext += `\n\n## Recent Pond Data:\n`;
          recentData.forEach(d => {
            farmContext += `- ${d.date}: DO=${d.dissolved_oxygen}, pH=${d.ph}, Feed=${d.feed_amount}kg\n`;
          });
        }
      }
    } catch (err) {
      console.warn('⚠️ Could not fetch farm context:', err.message);
    }

    // 4. Get recent chat history for continuity
    let contents = [];
    try {
      const recentChats = await getRecentChats(farmerId, 5);
      if (recentChats.length > 0) {
        // Build role-based history for Gemini
        recentChats.forEach(c => {
          contents.push({ role: 'user', parts: [{ text: c.message }] });
          contents.push({ role: 'model', parts: [{ text: c.response }] });
        });
      }
    } catch (err) {
      // Non-critical
    }

    // Add the current question as the final user message
    contents.push({ role: 'user', parts: [{ text: question }] });

    // 5. Call Gemini
    console.log('Step 5: Calling Gemini (gemini-1.5-flash)');
    const langInstruction = `\n\n## Language Constraints\nYou MUST reply in **${preferredLanguage}**. Use casual, communicative language. Do NOT use overly deep, formal, or complex literary vocabulary.`;
    const systemInstruction = SYSTEM_PROMPT + knowledgeContext + farmContext + weatherContext + langInstruction;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: contents,
      config: {
        systemInstruction: systemInstruction,
        temperature: 0.7,
        maxOutputTokens: 1000,
      }
    });
    
    const textRes = response.text;
    return textRes;
  } catch (error) {
    console.error('❌ AI answer failed:', error);
    return `I'm having trouble processing your question right now. Please try again in a moment.\n\nIf this is urgent, please consult your local aquaculture expert. 🙏`;
  }
}

module.exports = {
  answerQuestion,
  generateEmbedding,
};
