const { sendTextMessage, sendButtonMessage } = require('./whatsapp');
const { insertPondLog, saveChatHistory, scheduleFollowUp } = require('../models/database');
const { setState, getState, clearState, updateStateData } = require('../state/conversationState');

/**
 * Follow-Up Check-In Service — Empathic 3-State Outcome Tracking
 *
 * Flow (3 possible outcomes):
 *   🟢 Recovered & Clean  → Ask "What treatment worked?" → Save followup_result log
 *   🟡 Still Watching     → Schedule a 2-day extension follow-up and sign off warmly
 *   🔴 Needs Help         → Route to advanced diagnosis via eventFollowUp (triage)
 *
 * This replaces the old binary Improved/Same/Worse approach.
 */

// ========================
// START FOLLOW-UP CHECK-IN
// ========================

async function startFollowupCheckIn(phone, farmerId, pondId, eventType) {
  const { getFarmerById } = require('../models/database');
  const farmer = await getFarmerById(farmerId);
  const lang = farmer?.preferred_language || 'English';

  setState(phone, {
    flow: 'followup_checkin',
    step: 0,
    data: {},
    farmerId,
    pondId,
    eventType,
  });

  const eventName = (eventType || '').replace(/_/g, ' ');
  await sendButtonMessage(
    phone,
    t('greet_followup', lang).replace('{event}', eventName),
    [
      { id: 'fu_recovered', title: t('btn_recovered', lang) },
      { id: 'fu_watching',  title: t('btn_watching', lang) },
      { id: 'fu_help',      title: t('btn_help', lang) },
    ]
  );
}

// ========================
// HANDLE FOLLOW-UP STEP
// ========================

async function handleFollowupStep(phone, message) {
  const state = getState(phone);
  if (!state || state.flow !== 'followup_checkin') return false;

  const { getFarmerById } = require('../models/database');
  const farmer = await getFarmerById(state.farmerId);
  const lang = farmer?.preferred_language || 'English';

  const input = message.toLowerCase().trim();

  // ────────────────────────────────────────
  // STEP 0: Collect the 3-state outcome
  // ────────────────────────────────────────
  if (state.step === 0) {
    let status = null;

    // 🟢 Recovered
    if (input === 'fu_recovered' || input.includes('recover') || input.includes('clean') || input.includes('better')) {
      status = 'recovered';
    }
    // 🟡 Still Watching
    else if (input === 'fu_watching' || input.includes('watch') || input.includes('same') || input.includes('monitor')) {
      status = 'watching';
    }
    // 🔴 Needs Help
    else if (input === 'fu_help' || input.includes('help') || input.includes('worse') || input.includes('bad')) {
      status = 'needs_help';
    }
    else {
      // Re-ask — invalid response
      await sendButtonMessage(phone,
        t('q_outcome', lang),
        [
          { id: 'fu_recovered', title: t('btn_recovered', lang) },
          { id: 'fu_watching',  title: t('btn_watching', lang) },
          { id: 'fu_help',      title: t('btn_help', lang) },
        ]
      );
      return true;
    }

    updateStateData(phone, { status });

    // ── 🟢 RECOVERED: Ask what treatment worked ──
    if (status === 'recovered') {
      setState(phone, { ...getState(phone), step: 1 });
      await sendTextMessage(phone, t('msg_recovered_ask_treatment', lang));
      return true;
    }

    // ── 🟡 STILL WATCHING: Schedule 2-day extension ──
    if (status === 'watching') {
      await handleWatching(phone, state, lang);
      return true;
    }

    // ── 🔴 NEEDS HELP: Route to advanced triage ──
    if (status === 'needs_help') {
      await handleNeedsHelp(phone, state, lang);
      return true;
    }
  }

  // ────────────────────────────────────────
  // STEP 1: Collect treatment used (after 🟢 Recovered)
  // ────────────────────────────────────────
  if (state.step === 1) {
    const treatmentUsed = message.trim();
    updateStateData(phone, { treatment_used: treatmentUsed });
    await finalizeFollowup(phone, lang);
    return true;
  }

  return false;
}

// ========================
// 🟡 WATCHING HANDLER
// ========================

async function handleWatching(phone, state, lang) {
  // Save intermediate log
  try {
    await insertPondLog({
      pond_id: state.pondId,
      log_group: 'followup_result',
      log_data: {
        event_type: state.eventType,
        status: 'watching',
        treatment_used: null,
      },
    });
  } catch (err) {
    console.warn('⚠️ Could not save watching log:', err.message);
  }

  // Schedule a 2-day extension follow-up
  try {
    const followUpDate = new Date();
    followUpDate.setDate(followUpDate.getDate() + 2);
    const followUpDateStr = followUpDate.toISOString().split('T')[0];
    await scheduleFollowUp(
      state.farmerId,
      state.pondId,
      state.eventType,
      followUpDateStr
    );
    console.log(`📅 2-day extension follow-up scheduled for farmer ${state.farmerId}`);
  } catch (err) {
    console.warn('⚠️ Could not schedule 2-day extension:', err.message);
  }

  // Save chat history
  try {
    await saveChatHistory({
      farmer_id: state.farmerId,
      message: `[Follow-up: ${state.eventType}] Status: Still watching`,
      response: t('msg_watching', lang),
      message_type: 'followup',
    });
  } catch (err) {
    console.warn('⚠️ Could not save chat history:', err.message);
  }

  clearState(phone);
  await sendTextMessage(phone, t('msg_watching', lang));
}

// ========================
// 🔴 NEEDS HELP HANDLER
// ========================

async function handleNeedsHelp(phone, state, lang) {
  // Save intermediate log
  try {
    await insertPondLog({
      pond_id: state.pondId,
      log_group: 'followup_result',
      log_data: {
        event_type: state.eventType,
        status: 'needs_help',
        treatment_used: null,
      },
    });
  } catch (err) {
    console.warn('⚠️ Could not save needs_help log:', err.message);
  }

  // Route to advanced event triage
  try {
    const { startEventFollowUp } = require('./eventFollowUp');
    clearState(phone);
    await sendTextMessage(phone, t('msg_needs_help_routing', lang));
    await startEventFollowUp(phone, state.farmerId, state.eventType);
  } catch (err) {
    console.warn('⚠️ Could not route to eventFollowUp:', err.message);
    clearState(phone);
    await sendTextMessage(phone, t('msg_needs_help_fallback', lang));
  }
}

// ========================
// FINALIZE (after 🟢 Recovered + treatment collected)
// ========================

async function finalizeFollowup(phone, lang) {
  const state = getState(phone);

  // Save follow-up result log with treatment details
  if (state.pondId) {
    try {
      await insertPondLog({
        pond_id: state.pondId,
        log_group: 'followup_result',
        log_data: {
          event_type: state.eventType,
          status: state.data.status,
          treatment_used: state.data.treatment_used || null,
        },
      });
    } catch (err) {
      console.warn('⚠️ Could not save followup log:', err.message);
    }
  }

  // Save to chat history so AI remembers treatment outcomes
  try {
    const eventName = (state.eventType || 'unknown').replace(/_/g, ' ');
    const summaryMsg = `[Follow-up: ${eventName}] Status: ${state.data.status || 'recovered'}${state.data.treatment_used ? ` | Treatment: ${state.data.treatment_used}` : ''}`;
    const responseMsg = `Farmer recovered. Treatment used: ${state.data.treatment_used || 'Not specified'}`;
    await saveChatHistory({
      farmer_id: state.farmerId,
      message: summaryMsg,
      response: responseMsg,
      message_type: 'followup',
    });
  } catch (err) {
    console.warn('⚠️ Could not save followup to chat history:', err.message);
  }

  clearState(phone);
  await sendTextMessage(phone, t('msg_thanks_sharing', lang));
}

// ========================
// TRANSLATIONS
// ========================
const translations = {
  English: {
    greet_followup: '👋 Hi! Checking in on your *{event}* report from 48 hours ago.\n\nHow is the situation now?',
    btn_recovered:  '🟢 Recovered & Clean',
    btn_watching:   '🟡 Still Watching',
    btn_help:       '🔴 Needs Help',
    q_outcome: 'How is the situation now?',
    msg_recovered_ask_treatment:
      '✅ *Excellent news!* Really glad to hear that! 🎉\n\n*What product or treatment worked for you?*\n(Your experience will help us advise other farmers — every detail matters!)',
    msg_watching:
      '👀 *Understood — we will keep watching together.*\n\nI have scheduled a check-in for you in 2 days. Keep monitoring and let me know if anything changes before then.\n\n💡 *Tip:* Maintain your aeration and avoid sudden water changes for now.',
    msg_needs_help_routing:
      '🔴 *I hear you — let\'s work through this together.*\n\nLet me pull up a more detailed diagnosis to help you right now...',
    msg_needs_help_fallback:
      '🔴 *I hear you.* Since the situation has worsened, please consult your local aquaculture expert immediately.\n\n💡 In the meantime: increase aeration, reduce feed by 50%, and avoid water exchange until you get expert advice.',
    msg_thanks_sharing:
      '🙏 *Thank you for sharing!* Your experience helps the whole farming community.\n\nKeep monitoring closely over the next few days and reach out anytime if you need help! 🌊',
  },
  Telugu: {
    greet_followup: '👋 నమస్కారం! 48 గంటల క్రితం మీరు నివేదించిన *{event}* గురించి తెలుసుకోవడానికి వచ్చాను.\n\nప్రస్తుతం పరిస్థితి ఎలా ఉంది?',
    btn_recovered:  '🟢 కోలుకున్నాను & పరిష్కారమైంది',
    btn_watching:   '🟡 ఇంకా గమనిస్తున్నాను',
    btn_help:       '🔴 సహాయం అవసరం',
    q_outcome: 'ప్రస్తుతం పరిస్థితి ఎలా ఉంది?',
    msg_recovered_ask_treatment:
      '✅ *అద్భుతమైన వార్త!* నిజంగా సంతోషంగా ఉంది! 🎉\n\n*ఏ ఉత్పత్తి లేదా చికిత్స పని చేసింది?*\n(మీ అనుభవం ఇతర రైతులకు సహాయపడుతుంది — ప్రతి వివరం ముఖ్యం!)',
    msg_watching:
      '👀 *అర్థమైంది — మనం కలిసి గమనిస్తాం.*\n\n2 రోజుల్లో మళ్ళీ తనిఖీ చేయడానికి నేను షెడ్యూల్ చేశాను. నిరంతరం గమనిస్తూ ఉండండి.\n\n💡 *చిట్కా:* ఆయేషన్ కొనసాగించండి మరియు హఠాత్తుగా నీటి మార్పు చేయకండి.',
    msg_needs_help_routing:
      '🔴 *నేను అర్థం చేసుకున్నాను — మనం కలిసి పని చేద్దాం.*\n\nమీకు ఇప్పుడు సహాయపడే వివరమైన విశ్లేషణ తెస్తున్నాను...',
    msg_needs_help_fallback:
      '🔴 *అర్థమైంది.* పరిస్థితి మరింత దిగజారినందున, వెంటనే స్థానిక నిపుణుడిని సంప్రదించండి.\n\n💡 ఇప్పుడు: ఆయేషన్ పెంచండి, 50% మేత తగ్గించండి, నిపుణుడి సలహా వచ్చే వరకు నీటి మార్పు చేయకండి.',
    msg_thanks_sharing:
      '🙏 *సమాచారం పంచుకున్నందుకు ధన్యవాదాలు!* మీ అనుభవం మొత్తం రైతుల సమాజానికి సహాయపడుతుంది.\n\nవచ్చే కొన్ని రోజులు నిశితంగా గమనిస్తూ, సహాయం అవసరమైతే మాకు తెలియజేయండి! 🌊',
  },
  Hindi: {
    greet_followup: '👋 नमस्ते! 48 घंटे पहले आपने *{event}* की जो रिपोर्ट की थी, उसके बारे में जाँच करने आए हैं।\n\nअभी स्थिति कैसी है?',
    btn_recovered:  '🟢 ठीक हो गए और साफ है',
    btn_watching:   '🟡 अभी भी देख रहे हैं',
    btn_help:       '🔴 मदद चाहिए',
    q_outcome: 'अभी स्थिति कैसी है?',
    msg_recovered_ask_treatment:
      '✅ *बहुत अच्छी खबर!* यह सुनकर सच में खुशी हुई! 🎉\n\n*किस उत्पाद या उपचार ने काम किया?*\n(आपका अनुभव दूसरे किसानों की मदद करेगा — हर विवरण मायने रखता है!)',
    msg_watching:
      '👀 *समझ गए — हम मिलकर निगरानी करेंगे।*\n\nमैंने आपके लिए 2 दिनों में फिर जाँच शेड्यूल कर दी है। निगरानी जारी रखें।\n\n💡 *सुझाव:* वातन बनाए रखें और अचानक पानी न बदलें।',
    msg_needs_help_routing:
      '🔴 *समझ गया — चलिए मिलकर इसे सुलझाते हैं।*\n\nआपके लिए अभी एक विस्तृत विश्लेषण ला रहे हैं...',
    msg_needs_help_fallback:
      '🔴 *समझ गया।* चूँकि स्थिति और खराब हुई है, तुरंत स्थानीय विशेषज्ञ से परामर्श करें।\n\n💡 अभी के लिए: वातन बढ़ाएं, 50% चारा कम करें, विशेषज्ञ सलाह मिलने तक पानी न बदलें।',
    msg_thanks_sharing:
      '🙏 *साझा करने के लिए धन्यवाद!* आपका अनुभव पूरे किसान समुदाय की मदद करता है।\n\nअगले कुछ दिनों तक ध्यान से निगरानी करें और जब भी ज़रूरत हो, संपर्क करें! 🌊',
  },
};

function t(key, lang = 'English') {
  return translations[lang]?.[key] || translations['English']?.[key] || key;
}

module.exports = {
  startFollowupCheckIn,
  handleFollowupStep,
};
