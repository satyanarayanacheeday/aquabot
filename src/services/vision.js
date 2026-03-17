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
 */
async function analyzeImage(imageBuffer, preferredLanguage = 'English') {
  try {
    const base64Image = imageBuffer.toString('base64');
    
    const langInstruction = `\n\n## Language Constraints\nYou MUST reply in **${preferredLanguage}**. Use casual, communicative language. Do NOT use overly deep, formal, or complex literary vocabulary.`;

    // Using gemini-2.5-flash which has vision capabilities native
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        VISION_PROMPT + langInstruction,
        {
          inlineData: {
            data: base64Image,
            mimeType: 'image/jpeg'
          }
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
