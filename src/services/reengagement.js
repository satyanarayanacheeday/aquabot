const {
  getAllFarmers,
  getIncompleteOnboardingFarmers,
  getFirstPondByFarmer,
  getLatestHealthScore,
  updateFarmer,
} = require('../models/database');
const { sendTextMessage } = require('./whatsapp');

/**
 * Re-Engagement / Dormancy Service
 *
 * Two gaps this covers:
 *  1. Stalled onboarding — farmer started but never finished (single nudge).
 *  2. Dormant active farmer — no activity for N days, tiered nudges that
 *     escalate faster if their last known pond health score was red.
 *
 * Every proactive send here checks `notifications_paused` (set when the
 * farmer replies STOP) and is skipped for paused farmers.
 */

const ONBOARDING_STALL_HOURS = 24;

const STAGE_ORDER = ['nudge_1', 'nudge_2', 'final'];

const NORMAL_TIERS = [
  { day: 3, stage: 'nudge_1' },
  { day: 7, stage: 'nudge_2' },
  { day: 21, stage: 'final' },
];

// Faster cadence when the pond's last known health score was red — a silent
// high-risk pond is the worst case to leave unattended.
const HIGH_RISK_TIERS = [
  { day: 1, stage: 'nudge_1' },
  { day: 3, stage: 'nudge_2' },
  { day: 7, stage: 'final' },
];

function daysSince(dateStr) {
  if (!dateStr) return 0;
  return (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24);
}

/**
 * Pick the most advanced tier that is now due and hasn't been sent yet.
 * If a sweep is missed for a few days, this jumps straight to the highest
 * applicable tier instead of sending nudge_1 and nudge_2 back-to-back.
 */
function pickDueTier(days, isHighRisk, currentStage) {
  const tiers = isHighRisk ? HIGH_RISK_TIERS : NORMAL_TIERS;
  const currentIdx = currentStage ? STAGE_ORDER.indexOf(currentStage) : -1;
  let due = null;
  for (const tier of tiers) {
    if (days >= tier.day && STAGE_ORDER.indexOf(tier.stage) > currentIdx) {
      due = tier;
    }
  }
  return due;
}

async function isHighRiskFarmer(farmerId) {
  try {
    const pond = await getFirstPondByFarmer(farmerId);
    if (!pond) return false;
    const score = await getLatestHealthScore(pond.id);
    return score?.score === 'red';
  } catch (err) {
    return false;
  }
}

// ========================
// MAIN SWEEP — called once daily by the scheduler
// ========================

async function runReengagementSweep() {
  await sweepStalledOnboarding();
  await sweepDormantFarmers();
}

async function sweepStalledOnboarding() {
  try {
    const incomplete = await getIncompleteOnboardingFarmers();
    for (const farmer of incomplete) {
      try {
        if (farmer.notifications_paused) continue;
        if (farmer.reengagement_stage === 'onboarding_nudge') continue;

        const hoursSince = daysSince(farmer.created_at) * 24;
        if (hoursSince < ONBOARDING_STALL_HOURS) continue;

        const lang = farmer.preferred_language || 'English';
        await sendTextMessage(farmer.phone, t('msg_onboarding_stall', lang));
        await updateFarmer(farmer.id, { reengagement_stage: 'onboarding_nudge' });
        await sleep(1000);
      } catch (err) {
        console.error(`Failed onboarding nudge for farmer ${farmer.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error('❌ Onboarding re-engagement sweep failed:', err.message);
  }
}

async function sweepDormantFarmers() {
  try {
    const farmers = await getAllFarmers();
    for (const farmer of farmers) {
      try {
        if (farmer.notifications_paused) continue;

        const days = daysSince(farmer.last_active_at || farmer.created_at);
        const highRisk = await isHighRiskFarmer(farmer.id);
        const tier = pickDueTier(days, highRisk, farmer.reengagement_stage);
        if (!tier) continue;

        const lang = farmer.preferred_language || 'English';
        const key = `msg_${tier.stage}${highRisk ? '_risk' : ''}`;
        await sendTextMessage(farmer.phone, t(key, lang));
        await updateFarmer(farmer.id, { reengagement_stage: tier.stage });
        await sleep(1000);
      } catch (err) {
        console.error(`Failed re-engagement nudge for farmer ${farmer.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error('❌ Dormancy re-engagement sweep failed:', err.message);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ========================
// TRANSLATIONS
// ========================
const translations = {
  English: {
    msg_onboarding_stall: "👋 Hey! You started setting up your pond assistant but didn't finish — it only takes 10 seconds. Reply *Hi* to pick up where you left off!",
    msg_nudge_1: "🐋 Haven't heard from you in a few days — how's your pond doing? Reply anytime, we're here to help!",
    msg_nudge_1_risk: "🔴 We noticed your pond was flagged high-risk and haven't heard back — is everything okay? Reply anytime, we're here to help.",
    msg_nudge_2: "💡 It's been a week since your last update! A quick check-in helps us catch problems early. Reply *Hi* to update your pond status.",
    msg_nudge_2_risk: "🔴 *Still concerned about your pond* — it was flagged high-risk a few days ago and we haven't heard from you since. Please reply so we can help before it gets worse.",
    msg_final: "🙏 We haven't heard from you in a while, so this will be our last check-in for now. Whenever you're ready, just say *Hi* and we'll be here.\n\n_Reply STOP if you'd like to pause these reminders._",
    msg_final_risk: "🔴 *Final check-in:* Your pond was flagged high-risk and we still haven't heard back. Please reply if you need help — your shrimp/fish may be at serious risk.\n\n_Reply STOP if you'd like to pause these reminders._",
  },
  Telugu: {
    msg_onboarding_stall: "👋 హాయ్! మీరు మీ పాండ్ అసిస్టెంట్ సెటప్ మొదలుపెట్టారు కానీ పూర్తి చేయలేదు — ఇది కేవలం 10 సెకన్లు పడుతుంది. మీరు వదిలేసిన చోటు నుండి కొనసాగించడానికి *Hi* అని రిప్లై చేయండి!",
    msg_nudge_1: "🐋 కొన్ని రోజులుగా మీ నుండి సమాచారం లేదు — మీ చెరువు ఎలా ఉంది? ఎప్పుడైనా రిప్లై చేయండి, మేము సహాయం చేయడానికి ఇక్కడ ఉన్నాం!",
    msg_nudge_1_risk: "🔴 మీ చెరువు అధిక-ప్రమాదంగా గుర్తించబడింది మరియు మీ నుండి సమాచారం లేదు — అంతా బాగుందా? ఎప్పుడైనా రిప్లై చేయండి, మేము సహాయం చేస్తాం.",
    msg_nudge_2: "💡 మీ చివరి అప్‌డేట్ నుండి ఒక వారం అయింది! త్వరిత చెక్-ఇన్ సమస్యలను ముందుగానే గుర్తించడంలో సహాయపడుతుంది. మీ చెరువు స్థితిని అప్‌డేట్ చేయడానికి *Hi* అని రిప్లై చేయండి.",
    msg_nudge_2_risk: "🔴 *మీ చెరువు గురించి ఇంకా ఆందోళనగా ఉంది* — కొన్ని రోజుల క్రితం ఇది అధిక-ప్రమాదంగా గుర్తించబడింది మరియు అప్పటి నుండి మీ నుండి సమాచారం లేదు. పరిస్థితి మరింత దిగజారే ముందు మేము సహాయం చేయడానికి దయచేసి రిప్లై చేయండి.",
    msg_final: "🙏 చాలా రోజులుగా మీ నుండి సమాచారం లేదు, కాబట్టి ఇది ఇప్పటికి మా చివరి చెక్-ఇన్. మీరు సిద్ధంగా ఉన్నప్పుడు, *Hi* అని చెప్పండి, మేము ఇక్కడే ఉంటాం.\n\n_ఈ రిమైండర్‌లను నిలిపివేయాలనుకుంటే STOP అని రిప్లై చేయండి._",
    msg_final_risk: "🔴 *చివరి చెక్-ఇన్:* మీ చెరువు అధిక-ప్రమాదంగా గుర్తించబడింది మరియు ఇప్పటికీ మీ నుండి సమాచారం లేదు. మీకు సహాయం కావాలంటే దయచేసి రిప్లై చేయండి — మీ రొయ్యలు/చేపలు తీవ్రమైన ప్రమాదంలో ఉండవచ్చు.\n\n_ఈ రిమైండర్‌లను నిలిపివేయాలనుకుంటే STOP అని రిప్లై చేయండి._",
  },
  Hindi: {
    msg_onboarding_stall: "👋 नमस्ते! आपने अपना तालाब सहायक सेटअप शुरू किया था लेकिन पूरा नहीं किया — इसमें केवल 10 सेकंड लगते हैं। जहाँ आपने छोड़ा था वहाँ से जारी रखने के लिए *Hi* भेजें!",
    msg_nudge_1: "🐋 कुछ दिनों से आपसे कोई जानकारी नहीं मिली — आपका तालाब कैसा है? कभी भी जवाब दें, हम मदद के लिए यहाँ हैं!",
    msg_nudge_1_risk: "🔴 हमने देखा कि आपका तालाब उच्च-जोखिम के रूप में चिह्नित था और आपसे कोई जवाब नहीं मिला — क्या सब ठीक है? कभी भी जवाब दें, हम मदद करेंगे।",
    msg_nudge_2: "💡 आपके पिछले अपडेट को एक हफ्ता हो गया है! एक त्वरित चेक-इन समस्याओं को जल्दी पकड़ने में मदद करता है। अपने तालाब की स्थिति अपडेट करने के लिए *Hi* भेजें।",
    msg_nudge_2_risk: "🔴 *आपके तालाब को लेकर अभी भी चिंता है* — कुछ दिन पहले इसे उच्च-जोखिम के रूप में चिह्नित किया गया था और तब से आपसे कोई जवाब नहीं मिला। स्थिति और खराब होने से पहले कृपया जवाब दें ताकि हम मदद कर सकें।",
    msg_final: "🙏 काफी समय से आपसे कोई जानकारी नहीं मिली, इसलिए अभी के लिए यह हमारी आखिरी चेक-इन होगी। जब भी आप तैयार हों, बस *Hi* कहें, हम यहाँ मौजूद रहेंगे।\n\n_यदि आप इन रिमाइंडर को रोकना चाहते हैं तो STOP भेजें।_",
    msg_final_risk: "🔴 *आखिरी चेक-इन:* आपका तालाब उच्च-जोखिम के रूप में चिह्नित था और अभी भी आपसे कोई जवाब नहीं मिला। यदि आपको मदद चाहिए तो कृपया जवाब दें — आपकी मछली/झींगा गंभीर खतरे में हो सकते हैं।\n\n_यदि आप इन रिमाइंडर को रोकना चाहते हैं तो STOP भेजें।_",
  },
};

function t(key, lang = 'English') {
  return translations[lang]?.[key] || translations['English']?.[key] || key;
}

module.exports = {
  runReengagementSweep,
  pickDueTier,
  daysSince,
};
