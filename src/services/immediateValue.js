const { sendTextMessage } = require('./whatsapp');

/**
 * Deliver immediate value right after onboarding.
 * Makes the farmer feel: "This assistant is helping me immediately."
 *
 * Shows:
 *  - Problem-specific advice based on what they selected
 *  - 2-3 action items
 */
async function deliverImmediateValue(phone, farmerId, village, currentProblem, language = 'English') {
  try {
    // 1. Get problem-specific advice
    const problemLabel = getProblemLabel(currentProblem, language);
    let adviceMsg = '';

    // Try AI-generated advice if Gemini is configured
    if (process.env.GEMINI_API_KEY && !process.env.GEMINI_API_KEY.includes('your_')) {
      try {
        const { answerQuestion } = require('./ai');
        const prompt = `A farmer just registered. They farm in ${village} and their main concern is: ${problemLabel}.\n\n` +
          `Give 2-3 specific, immediately useful tips. Keep it very short (max 100 words), practical, and encouraging. ` +
          `Format for WhatsApp with emojis.`;
        adviceMsg = await answerQuestion(prompt, farmerId, language);
      } catch (err) {
        console.warn('⚠️ AI advice failed:', err.message);
        adviceMsg = getDefaultAdvice(currentProblem, language);
      }
    } else {
      adviceMsg = getDefaultAdvice(currentProblem, language);
    }

    // 2. Combine and send
    let fullMessage = '';
    fullMessage += t('msg_quick_tips', language).replace('{problem}', problemLabel) + '\n\n' + adviceMsg;
    fullMessage += t('msg_footer', language);

    await sendTextMessage(phone, fullMessage);

  } catch (error) {
    console.error('❌ Immediate value delivery failed:', error.message);
    // Non-critical — don't throw. At minimum send a welcome.
    try {
      await sendTextMessage(phone, t('msg_welcome', language));
    } catch (e) {
      // ignore
    }
  }
}

function getProblemLabel(problem, lang = 'English') {
  const keys = {
    disease: 'label_disease',
    water_quality: 'label_water_quality',
    feed: 'label_feed',
    slow_growth: 'label_slow_growth',
    mortality: 'label_mortality',
  };
  return t(keys[problem] || 'label_general', lang);
}

function getDefaultAdvice(problem, lang = 'English') {
  const keys = {
    disease: 'adv_disease',
    water_quality: 'adv_water_quality',
    feed: 'adv_feed',
    slow_growth: 'adv_slow_growth',
    mortality: 'adv_mortality',
  };
  return t(keys[problem] || 'adv_general', lang);
}

// ========================
// TRANSLATIONS
// ========================
const translations = {
  English: {
    label_disease: 'Disease detection & prevention',
    label_water_quality: 'Water quality management',
    label_feed: 'Feed management',
    label_slow_growth: 'Slow growth concerns',
    label_mortality: 'Mortality concerns',
    label_general: 'General pond management',
    msg_quick_tips: '💡 *Quick tips for {problem}:*',
    msg_footer: '\n\n---\nI\'ll check in with you regularly to help manage your pond! 🦐\nType *help* anytime to see what I can do.',
    msg_welcome: '🦐 Welcome aboard! I\'ll be your pond assistant.\n\nType *help* to see what I can do.\nType *update* to log pond data.\nSend a 📸 photo for disease detection.',
    adv_disease: '🔬 Check for white spots, red body, or unusual behavior daily.\n💊 Maintain good water quality — it\'s the best prevention.\n🧪 Keep DO above 5 mg/L and pH between 7.5-8.5.',
    adv_water_quality: '💧 Check water color daily — green is good, dark/brown needs attention.\n🫧 Keep aerators running, especially at night.\n🧪 Ideal: DO > 5 mg/L, pH 7.5-8.5.',
    adv_feed: '🍽️ Don\'t overfeed — leftover feed pollutes water.\n📊 Reduce feed by 20% during cloudy/rainy days.\n⏰ Feed 3-4 times daily at fixed times.',
    adv_slow_growth: '📈 Check if feed amount matches shrimp/fish size.\n💧 Poor water quality often causes slow growth.\n🧪 Check ammonia — high levels reduce growth.',
    adv_mortality: '⚠️ Check water quality immediately — DO, pH, ammonia.\n🔍 Look for disease signs: white spots, red body, white gut.\n🫧 Increase aeration right away.',
    adv_general: '💡 Keep monitoring your pond daily.\n💧 Good water quality is the foundation of healthy farming.'
  },
  Telugu: {
    label_disease: 'వ్యాధి గుర్తింపు మరియు నివారణ',
    label_water_quality: 'నీటి నాణ్యత నిర్వహణ',
    label_feed: 'మేత నిర్వహణ',
    label_slow_growth: 'నెమ్మదిగా పెరుగుదల సమస్యలు',
    label_mortality: 'మరణాల సమస్యలు',
    label_general: 'సాధారణ చెరువు నిర్వహణ',
    msg_quick_tips: '💡 *{problem} కోసం త్వరిత చిట్కాలు:*',
    msg_footer: '\n\n---\nమీ చెరువును నిర్వహించడంలో సహాయపడటానికి నేను క్రమం తప్పకుండా మిమ్మల్ని సంప్రదిస్తాను! 🦐\nనేను ఏమి చేయగలనో చూడటానికి ఎప్పుడైనా *help* అని టైప్ చేయండి.',
    msg_welcome: '🦐 స్వాగతం! నేను మీ చెరువు సహాయకుడిని.\n\nనేను ఏమి చేయగలనో చూడటానికి *help* అని టైప్ చేయండి.\nచెరువు డేటాను రికార్డ్ చేయడానికి *update* అని టైప్ చేయండి.\nవ్యాధి గుర్తింపు కోసం 📸 ఫోటో పంపండి.',
    adv_disease: '🔬 ప్రతిరోజూ తెల్ల మచ్చలు, ఎర్రటి శరీరం లేదా అసాధారణ ప్రవర్తన కోసం తనిఖీ చేయండి.\n💊 మంచి నీటి నాణ్యతను నిర్వహించండి — ఇదే ఉత్తమ నివారణ.\n🧪 DO 5 mg/L కంటే ఎక్కువగా మరియు pH 7.5-8.5 మధ్య ఉంచండి.',
    adv_water_quality: '💧 ప్రతిరోజూ నీటి రంగును తనిఖీ చేయండి — ఆకుపచ్చగా ఉంటే మంచిది, ముదురు/గోధుమ రంగులో ఉంటే శ్రద్ధ అవసరం.\n🫧 ఎరేటర్లను రన్నింగ్‌లో ఉంచండి, ముఖ్యంగా రాత్రిపూట.\n🧪 ఆదర్శం: DO > 5 mg/L, pH 7.5-8.5.',
    adv_feed: '🍽️ మేత ఎక్కువ వేయవద్దు — మిగిలిపోయిన మేత నీటిని కలుషితం చేస్తుంది.\n📊 మేఘావృతమైన/వర్షపు రోజులలో మేతను 20% తగ్గించండి.\n⏰ నిర్ణీత సమయాల్లో రోజుకు 3-4 సార్లు మేత వేయండి.',
    adv_slow_growth: '📈 మేత పరిమాణం రొయ్యలు/చేపల పరిమాణానికి సరిపోతుందో లేదో చూడండి.\n💧 నీటి నాణ్యత తక్కువగా ఉంటే తరచుగా నెమ్మదిగా పెరుగుదలకు కారణమవుతుంది.\n🧪 అమ్మోనియాను తనిఖీ చేయండి — అధిక స్థాయిలు పెరుగుదలను తగ్గిస్తాయి.',
    adv_mortality: '⚠️ వెంటనే నీటి నాణ్యతను తనిఖీ చేయండి — DO, pH, అమ్మోనియా.\n🔍 వ్యాధి లక్షణాల కోసం చూడండి: తెల్ల మచ్చలు, ఎర్రటి శరీరం, తెల్లటి పేగు.\n🫧 వెంటనే ఎరేషన్ పెంచండి.',
    adv_general: '💡 ప్రతిరోజూ మీ చెరువును గమనిస్తూ ఉండండి.\n💧 మంచి నీటి నాణ్యతే ఆరోగ్యకరమైన సాగుకు పునాది.'
  },
  Hindi: {
    label_disease: 'रोग की पहचान और रोकथाम',
    label_water_quality: 'पानी की गुणवत्ता प्रबंधन',
    label_feed: 'चारा प्रबंधन',
    label_slow_growth: 'धीमी वृद्धि की चिंताएं',
    label_mortality: 'मृत्यु दर की चिंताएं',
    label_general: 'सामान्य तालाब प्रबंधन',
    msg_quick_tips: '💡 *{problem} के लिए त्वरित सुझाव:*',
    msg_footer: '\n\n---\nमैं आपके तालाब को प्रबंधित करने में मदद करने के लिए नियमित रूप से आपसे संपर्क करूँगा! 🦐\nमैं क्या कर सकता हूँ यह देखने के लिए कभी भी *help* टाइप करें।',
    msg_welcome: '🦐 स्वागत है! मैं आपका तालाब सहायक बनूँगा।\n\nमैं क्या कर सकता हूँ यह देखने के लिए *help* टाइप करें।\nतालाब डेटा लॉग करने के लिए *update* टाइप करें।\nरोग की पहचान के लिए 📸 फोटो भेजें।',
    adv_disease: '🔬 रोजाना सफेद धब्बे, लाल शरीर या असामान्य व्यवहार की जांच करें।\n💊 पानी की अच्छी गुणवत्ता बनाए रखें — यह सबसे अच्छा बचाव है।\n🧪 DO को 5 mg/L से ऊपर और pH को 7.5-8.5 के बीच रखें।',
    adv_water_quality: '💧 रोजाना पानी के रंग की जांच करें — हरा अच्छा है, गहरा/भूरा होने पर ध्यान देने की जरूरत है।\n🫧 एरेटर चालू रखें, खासकर रात में।\n🧪 आदर्श: DO > 5 mg/L, pH 7.5-8.5.',
    adv_feed: '🍽️ अधिक चारा न डालें — बचा हुआ चारा पानी को प्रदूषित करता है।\n📊 बादलों वाले/बारिश के दिनों में चारा 20% कम कर दें।\n⏰ दिन में 3-4 बार निश्चित समय पर चारा डालें।',
    adv_slow_growth: '📈 जांचें कि क्या चारे की मात्रा झींगा/मछली के आकार से मेल खाती है।\n💧 खराब पानी की गुणवत्ता अक्सर धीमी वृद्धि का कारण बनती है।\n🧪 अमोनिया की जांच करें — उच्च स्तर वृद्धि को कम करता है।',
    adv_mortality: '⚠️ तुरंत पानी की गुणवत्ता की जांच करें — DO, pH, अमोनिया।\n🔍 बीमारी के लक्षणों की तलाश करें: सफेद धब्बे, लाल शरीर, सफेद आंत।\n🫧 तुरंत वातन (aeration) बढ़ाएं।',
    adv_general: '💡 रोजाना अपने तालाब की निगरानी करते रहें।\n💧 पानी की अच्छी गुणवत्ता स्वस्थ खेती की नींव है।'
  }
};

function t(key, lang = 'English') {
  return translations[lang]?.[key] || translations['English']?.[key] || key;
}

module.exports = {
  deliverImmediateValue,
  translations,
  t
};
