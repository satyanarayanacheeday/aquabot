const ai = require('../config/gemini');
const { getFarmerById, getRecentChats, updateFarmer } = require('../models/database');

const SUMMARY_REFRESH_THRESHOLD = 5; // Regenerate summary every 5 new messages

const SUMMARY_PROMPT = `You are summarizing a farmer's conversation history with an aquaculture assistant bot.

Summarize the key information in 150 words or less. Focus on:
- Problems reported (diseases, mortality, water issues)
- Treatments or products used and their outcomes
- Current ongoing concerns
- Pond conditions and trends observed

Format as short bullet points. Be factual, no opinions. Use present tense for ongoing issues, past tense for resolved ones.`;

/**
 * Get cached summary or refresh if stale (5+ new messages since last summary)
 * @param {string} farmerId
 * @returns {string} Summary text or empty string
 */
async function getOrRefreshSummary(farmerId) {
  try {
    const farmer = await getFarmerById(farmerId);
    if (!farmer) return '';

    const cachedSummary = farmer.conversation_summary || '';
    const lastSummaryCount = farmer.summary_message_count || 0;

    // Get current total chat count
    const allChats = await getRecentChats(farmerId, 50);
    const totalCount = allChats.length;

    // If not enough messages yet, no need for summary
    if (totalCount <= 4) return '';

    // Check if we need to refresh
    if (cachedSummary && (totalCount - lastSummaryCount) < SUMMARY_REFRESH_THRESHOLD) {
      return cachedSummary;
    }

    // Generate new summary from older messages (skip last 4 which are sent as multi-turn)
    const olderChats = allChats.slice(0, Math.max(0, totalCount - 4));
    if (olderChats.length === 0) return cachedSummary || '';

    const summary = await generateSummary(olderChats);

    // Cache it
    try {
      await updateFarmer(farmerId, {
        conversation_summary: summary,
        summary_message_count: totalCount,
      });
    } catch (err) {
      console.warn('⚠️ Could not cache conversation summary:', err.message);
    }

    return summary;
  } catch (err) {
    console.warn('⚠️ Conversation summary failed:', err.message);
    return '';
  }
}

/**
 * Generate a summary of conversation history using Gemini Flash
 * @param {Array} chats - Array of chat history entries
 * @returns {string} Summary text
 */
async function generateSummary(chats) {
  // Build conversation text for summarization
  let conversationText = '';
  for (const chat of chats) {
    const date = new Date(chat.created_at).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
    conversationText += `[${date}] Farmer: ${chat.message}\n`;
    conversationText += `[${date}] Bot: ${chat.response?.substring(0, 200) || '...'}\n\n`;
  }

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [
      {
        role: 'user',
        parts: [{ text: `${SUMMARY_PROMPT}\n\n--- CONVERSATION ---\n${conversationText}` }],
      },
    ],
    config: {
      temperature: 0.3,
      maxOutputTokens: 200,
    },
  });

  return response.text || '';
}

module.exports = {
  getOrRefreshSummary,
};
