const ai = require('../config/gemini');
const SYSTEM_PROMPT = require('../prompts/systemPrompt');
const { getFirstFarmByFarmer, getRecentDailyData, getRecentGrowthData } = require('../models/database');
const { getWeather } = require('./weather');

/**
 * Generate a personalized daily advisory for a farmer
 */
async function generateAdvisory(farmerId, farmerLocation, preferredLanguage = 'English') {
  try {
    // 1. Get farm info
    const farm = await getFirstFarmByFarmer(farmerId);
    if (!farm) return null;

    // 2. Get recent pond data
    const recentDaily = await getRecentDailyData(farm.id, 7);
    const recentGrowth = await getRecentGrowthData(farm.id, 2);

    // 3. Get weather
    const weather = await getWeather(farmerLocation);

    // 4. Build context
    let context = `Generate a brief daily advisory for this farmer's pond.\n\n`;
    context += `## Farm Profile:\n`;
    context += `- Species: ${farm.species}\n`;
    context += `- Pond Size: ${farm.pond_size}\n`;
    context += `- Number of Ponds: ${farm.number_of_ponds}\n`;
    context += `- Stocking Date: ${farm.stocking_date}\n`;
    context += `- PL Count: ${farm.pl_count}\n`;

    if (recentDaily.length > 0) {
      context += `\n## Recent Daily Data (last ${recentDaily.length} entries):\n`;
      recentDaily.forEach(d => {
        context += `- ${d.date}: DO=${d.dissolved_oxygen} mg/L, pH=${d.ph}, Feed=${d.feed_amount}kg\n`;
      });
    } else {
      context += `\n(No recent daily data available)\n`;
    }

    if (recentGrowth.length > 0) {
      context += `\n## Recent Growth Data:\n`;
      recentGrowth.forEach(g => {
        context += `- ${g.date}: Weight=${g.avg_weight}g, Survival=${g.survival_rate}%, Water=${g.water_color}\n`;
      });
    }

    if (weather) {
      context += `\n## Today's Weather (${weather.location}):\n`;
      context += `- Temperature: ${weather.temperature}°C (feels like ${weather.feelsLike}°C)\n`;
      context += `- Humidity: ${weather.humidity}%\n`;
      context += `- Rainfall: ${weather.rainfall}mm\n`;
      context += `- Conditions: ${weather.description}\n`;
      context += `- Wind: ${weather.windSpeed} m/s\n`;
    }

    context += `\nProvide a concise daily advisory (max 150 words) formatted for WhatsApp with emojis. Include:
1. Key observation from data
2. Weather impact on pond
3. 2-3 specific action items for today
4. One encouraging note`;

    const langInstruction = `\n\n## Language Constraints\nYou MUST reply in **${preferredLanguage}**. Use casual, communicative language. Do NOT use overly deep, formal, or complex literary vocabulary.`;

    // 5. Call Gemini
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: context,
      config: {
        systemInstruction: SYSTEM_PROMPT + langInstruction,
        temperature: 0.7,
      }
    });

    return response.text;
  } catch (error) {
    console.error('❌ Advisory generation failed:', error.message);
    return null;
  }
}

module.exports = { generateAdvisory };
