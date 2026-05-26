const { getRecentPondLogs, getPondById, getPondsByFarmer } = require('../models/database');
// No longer needed: const { t } = require('./dailyCheckIn');

/**
 * Checks for anomalies in recently reported data compared to history.
 * @returns {string|null} - Alert message if anomaly found
 */
async function checkAnomalies(pondId, currentData, logGroup, lang = 'English') {
  try {
    const recentLogs = await getRecentPondLogs(pondId, logGroup, 2);
    if (recentLogs.length < 1) return null;

    const lastLog = recentLogs[0].log_data;

    // 1. Mortality Jump
    if (logGroup === 'event' && currentData.event_type === 'mortality') {
      const currentVal = parseInt(currentData.how_many) || 0;
      const lastVal = parseInt(lastLog.how_many) || 0;
      
      // If current is significantly higher than last (e.g., jumping to a higher bracket)
      if (currentData.how_many === '100+' && (lastLog.how_many === '1-50' || !lastLog.how_many)) {
        return lang === 'Telugu' ? '🚨 మరణాల సంఖ్య అకస్మాత్తుగా పెరిగింది! ఇది అత్యవసర పరిస్థితి కావచ్చు.' : 
               (lang === 'Hindi' ? '🚨 मृत्यु दर में अचानक वृद्धि! यह एक आपात स्थिति हो सकती है।' : 
               '🚨 Sudden jump in mortality! This could be an emergency.');
      }
    }

    // 2. Feed Drop
    if (logGroup === 'feed') {
      // Logic for drastic feed drop can go here
    }

  } catch (err) {
    console.warn('Anomaly check failed:', err.message);
  }
  return null;
}

/**
 * Checks if there's an outstanding piece of advice to follow up on.
 */
async function getProactiveFollowUp(pondId, lang = 'English') {
  try {
    const recentEvents = await getRecentPondLogs(pondId, 'event', 5);
    const now = new Date();

    for (const log of recentEvents) {
      const logDate = new Date(log.created_at);
      const diffHours = (now - logDate) / (1000 * 60 * 60);

      // Follow up on events between 12 and 48 hours old
      if (diffHours >= 12 && diffHours <= 48) {
        const type = log.log_data.event_type;
        const msgMap = {
          mortality: {
            English: `Earlier you reported mortality. Is the situation under control now?`,
            Telugu: `ముందు మీరు మరణాల గురించి నివేదించారు. ఇప్పుడు పరిస్థితి అదుపులో ఉందా?`,
            Hindi: `पहले आपने मृत्यु दर की सूचना दी थी। क्या अब स्थिति नियंत्रण में है?`
          },
          disease: {
            English: `How are the disease symptoms you reported recently? Any improvement?`,
            Telugu: `మీరు ఇటీవల నివేదించిన వ్యాధి లక్షణాలు ఎలా ఉన్నాయి? ఏమైనా మెరుగుదల ఉందా?`,
            Hindi: `हाल ही में आपके द्वारा बताए गए रोग के लक्षण कैसे हैं? क्या कोई सुधार हुआ है?`
          }
        };
        
        if (msgMap[type]) return msgMap[type][lang] || msgMap[type]['English'];
      }
    }
  } catch (err) {
    console.warn('Proactive follow-up check failed:', err.message);
  }
  return null;
}

/**
 * Generates bio-security warnings if multiple ponds exist.
 */
async function getBioSecurityWarning(farmerId, pondId, lang = 'English') {
  try {
    const ponds = await getPondsByFarmer(farmerId);
    if (ponds.length > 1) {
      return lang === 'Telugu' ? '⚠️ గమనిక: మీ ఇతర చెరువులకు వ్యాధి వ్యాపించకుండా ఉండటానికి ప్రత్యేక వలలు మరియు పరికరాలను ఉపయోగించండి.' :
             (lang === 'Hindi' ? '⚠️ ध्यान दें: अन्य तालाबों में संक्रमण फैलने से रोकने के लिए अलग जाल और उपकरणों का उपयोग करें।' :
             '⚠️ Note: Use separate nets and equipment for your other ponds to prevent the infection from spreading.');
    }
  } catch (err) {
    console.warn('Bio-security check failed:', err.message);
  }
  return null;
}

/**
 * Checks for missing metadata and returns a "By the way" question.
 */
async function getProgressiveOnboardingQuestion(pondId, lang = 'English') {
  // 20% chance to ask
  if (Math.random() > 0.2) return null;

  try {
    const pond = await getPondById(pondId);
    if (!pond) return null;

    const missingFields = [
      { key: 'aerator_count', q: { English: 'By the way, how many aerators do you have in this pond?', Telugu: 'అన్నట్టు, ఈ చెరువులో మీకు ఎన్ని ఎరేటర్లు ఉన్నాయి?', Hindi: 'वैसे, इस तालाब में आपके पास कितने एरेटर हैं?' } },
      { key: 'water_source', q: { English: 'What is the main water source for this pond (Bore/Canal)?', Telugu: 'ఈ చెరువుకు ప్రధాన నీటి వనరు ఏమిటి (బోరు/కాలువ)?', Hindi: 'इस तालाब के लिए मुख्य जल स्रोत (बोर/नहर) क्या है?' } }
    ];

    for (const field of missingFields) {
      if (!pond[field.key]) {
        return {
          key: field.key,
          prompt: field.q[lang] || field.q['English']
        };
      }
    }
  } catch (err) {
    console.warn('Progressive onboarding check failed:', err.message);
  }
  return null;
}

module.exports = {
  checkAnomalies,
  getProactiveFollowUp,
  getBioSecurityWarning,
  getProgressiveOnboardingQuestion
};
