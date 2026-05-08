const ai = require('../config/gemini');
const SYSTEM_PROMPT = require('../prompts/systemPrompt');
const { getFirstPondByFarmer, getRecentPondLogs, getLatestHealthScore } = require('../models/database');

/**
 * Generate a personalized daily advisory for a farmer.
 * Uses recent pond data + health score.
 */
async function generateAdvisory(farmerId, farmerVillage, preferredLanguage = 'English') {
  try {
    // 1. Get pond info
    const pond = await getFirstPondByFarmer(farmerId);
    if (!pond) return null;

    // 2. Get recent pond logs
    const recentLogs = await getRecentPondLogs(pond.id, null, 10);

    // 3. Get health score
    const healthScore = await getLatestHealthScore(pond.id);

    const { getFarmerById } = require('../models/database');
    const farmer = await getFarmerById(farmerId);

    // 5. Build context
    let context = `Generate a brief daily advisory for this farmer's pond.\n\n`;
    context += `## Farmer Profile:\n`;
    context += `- Village: ${farmer?.village || 'Unknown'}\n`;
    context += `- Farm Type: ${farmer?.farm_type || 'Unknown'}\n`;
    context += `\n## Pond Profile:\n`;
    context += `- Species: ${pond.species}\n`;
    context += `- Pond Size: ${pond.pond_size}\n`;
    context += `- Stocking: ${pond.stocking_date}\n`;
    if (pond.feed_brand) context += `- Feed Brand: ${pond.feed_brand}\n`;

    if (recentLogs.length > 0) {
      context += `\n## Recent Pond Data (last ${recentLogs.length} entries):\n`;
      recentLogs.forEach(log => {
        context += `- [${log.log_group}] ${new Date(log.created_at).toLocaleDateString()}: ${JSON.stringify(log.log_data)}\n`;
      });
    } else {
      context += `\n(No recent data. Encourage the farmer to do a check-in.)\n`;
    }

    if (healthScore) {
      context += `\n## Pond Health Score: ${healthScore.score.toUpperCase()}\n`;
      context += `Factors: ${JSON.stringify(healthScore.factors)}\n`;
    }


    context += `\nProvide a comprehensive and deeply personalized daily advisory (approx 150-200 words) formatted for WhatsApp with emojis. 

CRITICAL INSTRUCTIONS:
1. ANALYZE TRENDS: Look at the logs over time. Is water color deteriorating? Is feed quantity increasing correctly for the growth stage? Mention these trends.
2. ACTIONABLE STEPS: Provide 3-4 very specific action items for today (e.g., "Increase aeration by 2 hours tonight due to low oxygen signs in your last log").
3. EXPERT TONE: Speak like a senior aquaculture consultant who knows their farm history.
4. NO PLACEHOLDERS: Use the data provided. If data is missing, suggest a check-in.
`;

    const langInstruction = `\n\n## Language\nReply in **${preferredLanguage}**. Casual, communicative language.`;

    const response = await ai.models.generateContent({
      model: 'gemini-1.5-flash',
      contents: [{ role: 'user', parts: [{ text: context + langInstruction }] }],
      config: {
        systemInstruction: SYSTEM_PROMPT,
        temperature: 0.7,
        maxOutputTokens: 4000,
      }
    });

    return response.text;
  } catch (error) {
    console.error('❌ Advisory generation failed:', error.message);
    return null;
  }
}

module.exports = { generateAdvisory };
