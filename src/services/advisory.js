const ai = require('../config/gemini');
const SYSTEM_PROMPT = require('../prompts/systemPrompt');
const { getFirstPondByFarmer, getRecentPondLogs, getLatestHealthScore } = require('../models/database');
const { getWeather } = require('./weather');

/**
 * Generate a personalized daily advisory for a farmer.
 * Uses auto-collected weather + recent pond data + health score.
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

    // 4. Get weather (auto-collected, never ask farmer)
    const weather = await getWeather(farmerVillage);

    // 5. Build context
    let context = `Generate a brief daily advisory for this farmer's pond.\n\n`;
    context += `## Pond Profile:\n`;
    context += `- Species: ${pond.species}\n`;
    context += `- Pond Size: ${pond.pond_size}\n`;
    context += `- Stocking: ${pond.stocking_date}\n`;

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

    if (weather) {
      context += `\n## Today's Weather (${weather.location}):\n`;
      context += `- Temperature: ${weather.temperature}°C (feels like ${weather.feelsLike}°C)\n`;
      context += `- Humidity: ${weather.humidity}%\n`;
      context += `- Rainfall: ${weather.rainfall}mm\n`;
      context += `- Conditions: ${weather.description}\n`;
      context += `- Wind: ${weather.windSpeed} m/s\n`;
    }

    context += `\nProvide a concise daily advisory (max 100 words) formatted for WhatsApp with emojis. Include:
1. One key observation from data or weather
2. 2 specific action items for today
3. One encouraging note
Do NOT ask the farmer about weather — you already have it.`;

    const langInstruction = `\n\n## Language\nReply in **${preferredLanguage}**. Casual, communicative language.`;

    // 6. Call Gemini
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: context + langInstruction }] }],
      config: {
        systemInstruction: SYSTEM_PROMPT,
        temperature: 0.7,
        maxOutputTokens: 300,
      }
    });

    return response.text;
  } catch (error) {
    console.error('❌ Advisory generation failed:', error.message);
    return null;
  }
}

module.exports = { generateAdvisory };
