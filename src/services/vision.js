const ai = require('../config/gemini');

const VISION_PROMPT = `You are an aquaculture disease detection assistant. Analyze this image of shrimp or fish.

Your task:
1. Identify what is shown (shrimp, fish, pond water, etc.)
2. Look for signs of disease, stress, or abnormal conditions
3. If disease signs are detected, identify the most likely disease
4. Provide recommended actions

Format your response as a valid JSON object with the following structure:
{
  "text": "Your formatted response for WhatsApp (short, scannable). Start with what you observe, name the condition, list 2-3 specific remedies (with commercial brand examples if applicable), and add this exact disclaimer: '⚠️ *Caution:* Please consult a local expert before applying any treatments.'",
  "metadata": {
    "species": "identified species or 'unknown'",
    "disease_predicted": "identified disease or 'none'",
    "confidence_level": "high/medium/low",
    "objects_detected": ["list", "of", "things", "seen"]
  }
}

IMPORTANT: Never diagnose with 100% certainty. Always say "possible" or "may indicate" in the text response. Return ONLY valid JSON, without any markdown formatting blocks.`;

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

    let rawText = response.text;
    
    // Clean up potential markdown formatting around the JSON
    if (rawText.startsWith('```json')) {
      rawText = rawText.replace(/^```json\n/, '').replace(/\n```$/, '');
    }

    try {
      const parsed = JSON.parse(rawText);
      return {
        text: parsed.text,
        metadata: parsed.metadata || {}
      };
    } catch (parseError) {
      console.error('Failed to parse Vision JSON response:', rawText);
      // Fallback if the model ignores the JSON instruction
      return {
        text: rawText,
        metadata: { error: 'Failed to parse JSON' }
      };
    }
    
  } catch (error) {
    console.error('❌ Vision analysis failed:', error.message);
    return {
      text: t('err_vision_fail', preferredLanguage),
      metadata: {}
    };
  }
}

// ========================
// TRANSLATIONS
// ========================
const translations = {
  English: {
    err_vision_fail: 'I couldn\'t analyze this image right now. Please try again.\n\nIf you notice disease symptoms, please consult an aquaculture expert immediately. 🙏'
  },
  Telugu: {
    err_vision_fail: 'నేను ప్రస్తుతం ఈ చిత్రాన్ని విశ్లేషించలేకపోయాను. దయచేసి మళ్ళీ ప్రయత్నించండి.\n\nమీరు వ్యాధి లక్షణాలను గమనించినట్లయితే, దయచేసి వెంటనే ఆక్వాకల్చర్ నిపుణుడిని సంప్రదించండి. 🙏'
  },
  Hindi: {
    err_vision_fail: 'मैं अभी इस छवि का विश्लेषण नहीं कर सका। कृपया पुनः प्रयास करें।\n\nयदि आप रोग के लक्षण देखते हैं, तो कृपया तुरंत जलीय कृषि विशेषज्ञ से परामर्श करें। 🙏'
  }
};

function t(key, lang = 'English') {
  return translations[lang]?.[key] || translations['English']?.[key] || key;
}

module.exports = {
  analyzeImage,
  translations,
  t
};

