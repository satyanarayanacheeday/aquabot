const { getRecentPondLogs, getPondById } = require('../models/database');

/**
 * Finds the most recent value for a specific key in pond logs or metadata.
 * Useful for skipping questions the user has already answered.
 * 
 * @param {string} pondId 
 * @param {string} key - The key to look for (e.g., 'water_color', 'feed_brand')
 * @param {number} maxHours - Time window to search in logs
 * @returns {Promise<any|null>} - The found value or null
 */
async function findRecentAnswer(pondId, key, maxHours = 24) {
  if (!pondId) return null;

  // 1. Check Pond Metadata first (Static data)
  try {
    const pond = await getPondById(pondId);
    if (pond && pond[key] !== undefined && pond[key] !== null) {
      // Special case: feed_brand is often in the main table
      return pond[key];
    }
  } catch (err) {
    console.warn(`Error checking pond metadata for ${key}:`, err.message);
  }

  // 2. Check Recent Logs
  try {
    const logs = await getRecentPondLogs(pondId, null, 10); // Check last 10 logs
    const now = new Date();

    for (const log of logs) {
      const logDate = new Date(log.created_at);
      const diffHours = (now - logDate) / (1000 * 60 * 60);

      if (diffHours <= maxHours) {
        const data = log.log_data || {};
        
        // Map common keys if they differ between flows
        const mappings = {
          'body_signs': ['body_signs', 'symptoms', 'disease_signs'],
          'symptoms': ['symptoms', 'disease_signs', 'body_signs'],
          'water_color': ['water_color', 'pond_color'],
          'pond_color': ['pond_color', 'water_color'],
        };

        const keysToTry = mappings[key] || [key];
        
        for (const k of keysToTry) {
          if (data[k] !== undefined && data[k] !== null && data[k] !== 'none' && data[k] !== 'no') {
            return data[k];
          }
        }
      }
    }
  } catch (err) {
    console.warn(`Error checking recent logs for ${key}:`, err.message);
  }

  return null;
}

module.exports = {
  findRecentAnswer
};
