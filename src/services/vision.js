const ai = require('../config/gemini');

const VISION_PROMPT = `You are an aquaculture disease detection assistant. Analyze this image of shrimp or fish.

Your task:
1. Identify what is shown (shrimp, fish, pond water, etc.)
2. Look for signs of disease, stress, or abnormal conditions
3. If disease signs are detected, identify the most likely disease
4. Provide recommended actions

Format your response for WhatsApp (short, scannable):
- Start with what you observe
- Name the possible condition/disease
- List 2-3 specific recommended actions, remedies, or feed adjustments
- If recommending remedies, give specific commercial brand name examples, noting that availability varies by region.
- Add this exact disclaimer: "⚠️ *Caution:* Please consult a local expert before applying any treatments."

If the image is unclear or not aquaculture-related, politely say so.

IMPORTANT: Never diagnose with 100% certainty. Always say "possible" or "may indicate".`;

/**
 * Analyze a shrimp/fish image for disease detection using Gemini
 * @param {Buffer} imageBuffer - The image data
 * @param {string} preferredLanguage - Language for the response
 * @param {object} pondContext - Optional pond context for personalized analysis
 * @param {string} pondContext.species - Species being farmed
 * @param {string} pondContext.pondSize - Pond size
 * @param {string} pondContext.healthScore - Current health score
 * @param {Array} pondContext.recentIssues - Recent health/water issues
 */
async function analyzeImage(imageBuffer, preferredLanguage = 'English', pondContext = null) {
  try {
    const base64Image = imageBuffer.toString('base64');

    let contextStr = '';
    if (pondContext) {
      contextStr = `\n\n## Farmer's Pond Context (use this to give more relevant advice):\n`;
      if (pondContext.species) contextStr += `- Species: ${pondContext.species}\n`;
      if (pondContext.pondSize) contextStr += `- Pond size: ${pondContext.pondSize}\n`;
      if (pondContext.healthScore) contextStr += `- Current health score: ${pondContext.healthScore}\n`;
      if (pondContext.recentIssues && pondContext.recentIssues.length > 0) {
        contextStr += `- Recent issues: ${pondContext.recentIssues.join(', ')}\n`;
      }
      contextStr += `Use this context to tailor your disease analysis and recommendations specifically for this species and pond condition.\n`;
    }

    const langInstruction = `\n\n## Language Constraints\nYou MUST reply in **${preferredLanguage}**. Use casual, communicative language. Do NOT use overly deep, formal, or complex literary vocabulary.`;

    // Using gemini-1.5-flash which has vision capabilities native
    // NOTE: Fixed typo from gemini-2.5-flash
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        {
          role: 'user',
          parts: [
            { text: VISION_PROMPT + contextStr + langInstruction },
            {
              inlineData: {
                data: base64Image,
                mimeType: 'image/jpeg'
              }
            }
          ]
        }
      ]
    });

    return response.text;
  } catch (error) {
    console.error('❌ Vision analysis failed:', error.message);
    return `I couldn't analyze this image right now. Please try again.\n\nIf you notice disease symptoms, please consult an aquaculture expert immediately. 🙏`;
  }
}

module.exports = {
  analyzeImage,
};

