const ai = require('../config/gemini');
const SYSTEM_PROMPT = require('../prompts/systemPrompt');
const { searchKnowledge, getRecentChats, getPondsByFarmer, getFarmerById, getRecentPondLogs, getLatestHealthScore } = require('../models/database');
const { getRecommendations } = require('./recommendation');
const { getOrRefreshSummary } = require('./conversationSummary');

/**
 * Generate an embedding for a given text
 */
async function generateEmbedding(text) {
  try {
    const response = await ai.models.embedContent({
      model: 'gemini-embedding-2',
      contents: [{ parts: [{ text: text }] }]
    });
    
    if (response.embedding && response.embedding.values) {
      return response.embedding.values;
    }
    
    if (response.embeddings && response.embeddings[0] && response.embeddings[0].values) {
      return response.embeddings[0].values;
    }

    console.warn('⚠️ Unexpected embedding response structure:', JSON.stringify(response));
    return null;
  } catch (error) {
    console.error('⚠️ Embedding generation failed:', error.message);
    return null;
  }
}

/**
 * Answer a farmer's question using RAG + Gemini
 */
async function answerQuestion(question, farmerId, preferredLanguage = 'English') {
  // 1. Sanitize input
  const sanitizedQuestion = question.trim().substring(0, 1000);

  try {
    // 2. Fetch context in parallel (MASSIVE speedup)
    const [
      embedding,
      farmerData,
      allPonds,
      chats,
      summary
    ] = await Promise.all([
      generateEmbedding(sanitizedQuestion),
      getFarmerById(farmerId),
      getPondsByFarmer(farmerId),
      getRecentChats(farmerId, 6),
      getOrRefreshSummary(farmerId)
    ]);

    // 3. Process Embedding & Knowledge
    let knowledgeContext = '';
    if (embedding) {
      try {
        const matches = await searchKnowledge(embedding, 3, 0.4);
        if (matches.length > 0) {
          knowledgeContext = '\n\n## Relevant Knowledge Base:\n' +
            matches.map(m => `- ${m.content}`).join('\n');
        }
      } catch (err) {}
    }

    // 4. Process Farm & Pond Details
    let farmContext = '';
    let healthContext = '';
    let recommendationContext = '';
    let feedPlanContext = '';

    if (farmerData) {
      farmContext += `\n\n## 🧑‍🌾 FARMER PROFILE:\n`;
      farmContext += `- Village: ${farmerData.village || 'Unknown'}\n`;
      farmContext += `- Farm type: ${farmerData.farm_type || 'Unknown'}\n`;
    }

    // Determine target pond
    const pondNumMatch = sanitizedQuestion.match(/pond\s*(\d+)/i);
    let pond = null;
    if (pondNumMatch) {
      const requestedNum = parseInt(pondNumMatch[1]);
      pond = allPonds.find(p => p.pond_number === requestedNum) || allPonds[0] || null;
    } else {
      pond = allPonds[0] || null;
    }

    if (pond) {
      // Fetch Pond-Specific data in parallel
      const [recentLogs, healthScore] = await Promise.all([
        getRecentPondLogs(pond.id, null, 10),
        getLatestHealthScore(pond.id)
      ]);

      recommendationContext = getRecommendations(sanitizedQuestion, pond);

      // Feed Plan check
      const feedKeywords = ['feed plan', 'how much feed', 'feeding schedule', 'feed calculator', 'feeding', 'మేత', 'మేత ప్రణాళిక', 'चारा', 'चारा योजना'];
      if (feedKeywords.some(k => sanitizedQuestion.toLowerCase().includes(k))) {
        try {
          const { getFeedPlan } = require('./feedPlan');
          const feedPlanData = await getFeedPlan(farmerId, preferredLanguage);
          if (feedPlanData?.type === 'success') {
            feedPlanContext = `\n\n## 🍽️ AUTOMATED FEED PLAN:\n${feedPlanData.message}\n\nIMPORTANT: Use the data above to give a precise feeding recommendation.`;
          }
        } catch (err) {}
      }

      farmContext += `\n\n## 🏊 POND DETAILS:\n`;
      farmContext += `- Species: ${pond.species}\n`;
      farmContext += `- Pond Size: ${pond.pond_size}\n`;
      farmContext += `- Stocking: ${pond.stocking_date}\n`;
      farmContext += `- Stock Count: ${pond.seed_count || 'Missing'}\n`;

      if (recentLogs.length > 0) {
        farmContext += `\n\n## 📊 RECENT POND DATA:\n`;
        recentLogs.forEach(log => {
          farmContext += `- [${log.log_group}] ${new Date(log.created_at).toLocaleDateString()}: ${JSON.stringify(log.log_data)}\n`;
        });
      }

      if (healthScore) {
        healthContext = `\n\n## 📊 POND HEALTH SCORE: ${healthScore.score.toUpperCase()}\n`;
        healthContext += `- Factors: ${JSON.stringify(healthScore.factors)}\n`;
      }
    }

    // 5. Build Chat Contents
    let contents = [];
    if (chats.length > 0) {
      chats.forEach(c => {
        if (c.message) contents.push({ role: 'user', parts: [{ text: c.message.trim() }] });
        if (c.response) contents.push({ role: 'model', parts: [{ text: c.response.trim() }] });
      });
    }
    contents.push({ role: 'user', parts: [{ text: sanitizedQuestion }] });

    // 6. Final Call
    const conversationSummary = summary ? `\n\n## Previous Conversation Summary\n${summary}` : '';
    const langInstruction = `\n\n## Language Constraints\nYou MUST reply in **${preferredLanguage}**. Use casual, communicative language.`;
    
    const systemInstruction = SYSTEM_PROMPT +
      conversationSummary +
      knowledgeContext +
      (sanitizedQuestion.length > 10 ? farmContext + healthContext + recommendationContext + feedPlanContext : '') +
      langInstruction;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: contents,
      config: {
        systemInstruction: systemInstruction,
        temperature: 0.7,
        maxOutputTokens: 4000,
      }
    });

    return response.text;
  } catch (error) {
    console.error('❌ AI answer failed:', error);
    throw error;
  }
}

module.exports = {
  answerQuestion,
  generateEmbedding,
};
