const ai = require('../config/gemini');
const SYSTEM_PROMPT = require('../prompts/systemPrompt');
const { searchKnowledge, getRecentChats, getFirstPondByFarmer, getPondsByFarmer, getFarmerById, getRecentPondLogs, getLatestHealthScore } = require('../models/database');
const { getWeather } = require('./weather');
const { getRecommendations } = require('./recommendation');
const { getOrRefreshSummary } = require('./conversationSummary');

/**
 * Generate an embedding for a given text
 */
async function generateEmbedding(text) {
  try {
    const response = await ai.models.embedContent({
      model: 'gemini-embedding-2',
      contents: text
    });
    return response.embedding.values;
  } catch (error) {
    console.error('⚠️ Embedding generation failed:', error.message);
    return null;
  }
}

/**
 * Answer a farmer's question using RAG + Gemini
 */
async function answerQuestion(question, farmerId, preferredLanguage = 'English') {
  try {
    // 1. Generate embedding & search knowledge base
    const embedding = await generateEmbedding(question);
    let knowledgeContext = '';
    if (embedding) {
      try {
        const matches = await searchKnowledge(embedding, 3, 0.4);
        if (matches.length > 0) {
          knowledgeContext = '\n\n## Relevant Knowledge Base:\n' +
            matches.map(m => `- ${m.content}`).join('\n');
        }
      } catch (err) {
        console.warn('⚠️ Knowledge search failed:', err.message);
      }
    }

    // 2. Get farmer and pond context
    let farmContext = '';
    let weatherContext = '';
    let healthContext = '';
    let recommendationContext = '';

    try {
      const farmerData = await getFarmerById(farmerId);

      if (farmerData) {
        farmContext += `\n\n## 🧑‍🌾 FARMER PROFILE:\n`;
        farmContext += `- Village: ${farmerData.village || 'Unknown'}\n`;
        farmContext += `- Farm type: ${farmerData.farm_type || 'Unknown'}\n`;

        // Get weather automatically (never ask the farmer)
        if (farmerData.village) {
          const weather = await getWeather(farmerData.village);
          if (weather) {
            weatherContext = `\n\n## 🌍 CURRENT WEATHER (AUTO-COLLECTED):\n` +
              `- Location: ${weather.location}\n` +
              `- Temp: ${weather.temperature}°C (Feels like ${weather.feelsLike}°C)\n` +
              `- Humidity: ${weather.humidity}%\n` +
              `- Condition: ${weather.description}\n` +
              `- Rainfall: ${weather.rainfall}mm/h\n` +
              `- Wind: ${weather.windSpeed}m/s\n` +
              `NOTE: You already know the weather. Do NOT ask the farmer about it.`;
          }
        }
      }

      // Get pond data (detect pond number from question)
      let pond = null;
      const pondNumMatch = question.match(/pond\s*(\d+)/i);
      if (pondNumMatch) {
        const requestedNum = parseInt(pondNumMatch[1]);
        const allPonds = await getPondsByFarmer(farmerId);
        pond = allPonds.find(p => p.pond_number === requestedNum) || allPonds[0] || null;
      } else {
        pond = await getFirstPondByFarmer(farmerId);
      }
      if (pond) {
        recommendationContext = getRecommendations(question, pond);
        
        farmContext += `\n\n## 🏊 POND DETAILS:\n`;
        farmContext += `- Species: ${pond.species}\n`;
        farmContext += `- Pond Size: ${pond.pond_size}\n`;
        farmContext += `- Stocking: ${pond.stocking_date}\n`;
        if (pond.feed_brand) farmContext += `- Feed Brand: ${pond.feed_brand}\n`;

        // Get recent logs
        const recentLogs = await getRecentPondLogs(pond.id, null, 10);
        if (recentLogs.length > 0) {
          farmContext += `\n\n## 📊 RECENT POND DATA:\n`;
          recentLogs.forEach(log => {
            const data = log.log_data;
            farmContext += `- [${log.log_group}] ${new Date(log.created_at).toLocaleDateString()}: ${JSON.stringify(data)}\n`;
          });
        }

        // Get health score
        const healthScore = await getLatestHealthScore(pond.id);
        if (healthScore) {
          healthContext = `\n\n## 📊 POND HEALTH SCORE:\n`;
          healthContext += `- Overall: ${healthScore.score.toUpperCase()}\n`;
          healthContext += `- Factors: ${JSON.stringify(healthScore.factors)}\n`;
          healthContext += `Use this score in your advice. If yellow/red, mention specific actions.`;
        }
      }
    } catch (err) {
      console.warn('⚠️ Could not fetch farm context:', err.message);
    }

    // 3. Get conversation summary (LLM-based, cached per farmer)
    let conversationSummary = '';
    try {
      conversationSummary = await getOrRefreshSummary(farmerId);
      if (conversationSummary) {
        conversationSummary = `\n\n## Previous Conversation Summary\n${conversationSummary}`;
      }
    } catch (err) {
      console.warn('⚠️ Conversation summary fetch failed:', err.message);
    }

    // 4. Get recent chat history (only last 4 for multi-turn, older ones are summarized above)
    let contents = [];
    try {
      const recentChats = await getRecentChats(farmerId, 4);
      if (recentChats.length > 0) {
        recentChats.forEach(c => {
          contents.push({ role: 'user', parts: [{ text: c.message }] });
          contents.push({ role: 'model', parts: [{ text: c.response }] });
        });
      }
    } catch (err) {
      // Non-critical
    }

    // Add current question
    contents.push({ role: 'user', parts: [{ text: question }] });

    // 5. Call Gemini
    const langInstruction = `\n\n## Language Constraints\nYou MUST reply in **${preferredLanguage}**. Use casual, communicative language. Do NOT use overly deep, formal, or complex literary vocabulary.`;
    const systemInstruction = SYSTEM_PROMPT + conversationSummary + knowledgeContext + farmContext + weatherContext + healthContext + recommendationContext + langInstruction;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: contents,
      config: {
        systemInstruction: systemInstruction,
        temperature: 0.7,
        maxOutputTokens: 500, // shorter responses — cost conscious
      }
    });

    return response.text;
  } catch (error) {
    console.error('❌ AI answer failed:', error);

    if (error.message?.includes('404') || error.status === 404) {
      console.error('💡 TIP: Gemini API may be disabled or model name is incorrect.');
    }

    throw error;
  }
}

module.exports = {
  answerQuestion,
  generateEmbedding,
};
