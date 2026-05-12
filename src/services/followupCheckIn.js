const { sendTextMessage, sendButtonMessage } = require('./whatsapp');
const { insertPondLog, saveChatHistory } = require('../models/database');
const { setState, getState, clearState, updateStateData } = require('../state/conversationState');

/**
 * Handles the farmer's response to a proactive event follow-up.
 */

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

  const eventName = eventType.replace('_', ' ');
  await sendButtonMessage(phone,
    t('greet_followup', lang).replace('{event}', eventName),
    [
      { id: 'fu_improved', title: t('btn_improved', lang) },
      { id: 'fu_same', title: t('btn_same', lang) },
      { id: 'fu_worse', title: t('btn_worse', lang) }
    ]
  );
}

async function handleFollowupStep(phone, message) {
  const state = getState(phone);
  if (!state || state.flow !== 'followup_checkin') return false;

  const { getFarmerById } = require('../models/database');
  const farmer = await getFarmerById(state.farmerId);
  const lang = farmer?.preferred_language || 'English';

  const input = message.toLowerCase().trim();

  // STEP 0: Ask if situation improved
  if (state.step === 0) {
    let status = null;
    if (input.includes('improved') || input.includes('yes') || input === 'fu_improved') {
      status = 'improved';
    } else if (input.includes('same') || input.includes('no') || input === 'fu_same') {
      status = 'same';
    } else if (input.includes('worse') || input === 'fu_worse') {
      status = 'worse';
    } else {
      // Re-ask
      await sendButtonMessage(phone,
        t('q_improved', lang),
        [
          { id: 'fu_improved', title: t('btn_improved', lang) },
          { id: 'fu_same', title: t('btn_same', lang) },
          { id: 'fu_worse', title: t('btn_worse', lang) }
        ]
      );
      return true;
    }

    if (status === 'improved') {
      // Move to step 1 to ask for treatment
      updateStateData(phone, { status });
      setState(phone, { ...getState(phone), step: 1 });
      await sendTextMessage(phone, t('msg_improved', lang));
      return true;
    } else {
      // Finalize immediately for negative outcomes
      updateStateData(phone, { status });
      await finalizeFollowup(phone);
      await sendTextMessage(phone, t('msg_worse', lang));
      return true;
    }
  }

  // STEP 1: Collect treatment used
  if (state.step === 1) {
    updateStateData(phone, { treatment_used: message.trim() });
    await finalizeFollowup(phone);
    await sendTextMessage(phone, t('msg_thanks_sharing', lang));
    return true;
  }

  return false;
}

async function finalizeFollowup(phone) {
  const state = getState(phone);
  if (state.pondId) {
    try {
      await insertPondLog({
        pond_id: state.pondId,
        log_group: 'followup_result',
        log_data: { 
          event_type: state.eventType, 
          status: state.data.status,
          treatment_used: state.data.treatment_used || null
        },
      });
    } catch (err) {
      console.warn('⚠️ Could not save followup log:', err.message);
    }
  }

  // Save to chat history so AI remembers follow-up outcomes
  try {
    const eventName = state.eventType?.replace('_', ' ') || 'unknown';
    const summaryMsg = `[Follow-up on ${eventName}] Status: ${state.data.status || 'unknown'}${state.data.treatment_used ? `, Treatment: ${state.data.treatment_used}` : ''}`;
    const responseMsg = state.data.status === 'improved'
      ? 'Situation improved. Farmer shared treatment details.'
      : `Situation ${state.data.status || 'unchanged'}. Advised to consult local expert.`;
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
}

// ========================
// TRANSLATIONS
// ========================
const translations = {
  English: {
    greet_followup: 'Hi! 👋 We\'re checking in on your recent report of *{event}*.\n\nHas the situation improved?',
    btn_improved: 'Yes, Improved',
    btn_same: 'No, Same',
    btn_worse: 'Worse',
    q_improved: 'Has the situation improved?',
    msg_improved: '✅ That is wonderful news!\n\n*What product or treatment did you use?*\nThis helps us learn and advise other farmers better in the future!',
    msg_worse: '⚠️ I am sorry to hear that. Since the situation hasn\'t improved, I strongly recommend consulting a local aquaculture expert or technician immediately. You may also want to temporarily reduce or stop feeding to maintain water quality.',
    msg_thanks_sharing: '🙏 Thank you for sharing! Keep monitoring the water quality and feeding rate closely. Let me know if anything changes!'
  },
  Telugu: {
    greet_followup: 'నమస్కారం! 👋 మీ ఇటీవలి నివేదిక *{event}* గురించి తెలుసుకోవడానికి మేము వచ్చాము.\n\nపరిస్థితి మెరుగుపడిందా?',
    btn_improved: 'అవును, మెరుగుపడింది',
    btn_same: 'లేదు, అలాగే ఉంది',
    btn_worse: 'మరింత దిగజారింది',
    q_improved: 'పరిస్థితి మెరుగుపడిందా?',
    msg_improved: '✅ ఇది అద్భుతమైన వార్త!\n\n*మీరు ఏ ఉత్పత్తి లేదా చికిత్సను ఉపయోగించారు?*\nఇది భవిష్యత్తులో ఇతర రైతులకు మెరుగ్గా సలహా ఇవ్వడానికి మాకు సహాయపడుతుంది!',
    msg_worse: '⚠️ అది వినడానికి విచారంగా ఉంది. పరిస్థితి మెరుగుపడనందున, మీరు వెంటనే స్థానిక ఆక్వాకల్చర్ నిపుణుడిని లేదా టెక్నీషియన్‌ను సంప్రదించాలని నేను గట్టిగా సిఫార్సు చేస్తున్నాను. నీటి నాణ్యతను కాపాడుకోవడానికి మీరు మేతను తాత్కాలికంగా తగ్గించవచ్చు లేదా ఆపివేయవచ్చు.',
    msg_thanks_sharing: '🙏 సమాచారాన్ని పంచుకున్నందుకు ధన్యవాదాలు! నీటి నాణ్యత మరియు మేత వేగాన్ని నిశితంగా గమనిస్తూ ఉండండి. ఏదైనా మార్పు ఉంటే నాకు తెలియజేయండి!'
  },
  Hindi: {
    greet_followup: 'नमस्ते! 👋 हम आपकी हालिया रिपोर्ट *{event}* के बारे में जाँच कर रहे हैं।\n\nक्या स्थिति में सुधार हुआ है?',
    btn_improved: 'हाँ, सुधार हुआ है',
    btn_same: 'नहीं, वैसा ही है',
    btn_worse: 'और खराब हो गया',
    q_improved: 'क्या स्थिति में सुधार हुआ है?',
    msg_improved: '✅ यह बहुत अच्छी खबर है!\n\n*आपने किस उत्पाद या उपचार का उपयोग किया?*\nइससे हमें भविष्य में अन्य किसानों को बेहतर सलाह देने में मदद मिलती है!',
    msg_worse: '⚠️ यह सुनकर दुख हुआ। चूँकि स्थिति में सुधार नहीं हुआ है, इसलिए मैं तुरंत एक स्थानीय जलीय कृषि विशेषज्ञ या तकनीशियन से परामर्श करने की दृढ़ता से अनुशंसा करता हूँ। पानी की गुणवत्ता बनाए रखने के लिए आप अस्थायी रूप से चारा कम कर सकते हैं या बंद कर सकते हैं।',
    msg_thanks_sharing: '🙏 साझा करने के लिए धन्यवाद! पानी की गुणवत्ता और चारे की दर पर बारीकी से नज़र रखें। अगर कुछ बदलता है तो मुझे बताएं!'
  }
};

function t(key, lang = 'English') {
  return translations[lang]?.[key] || translations['English']?.[key] || key;
}

module.exports = {
  startFollowupCheckIn,
  handleFollowupStep,
};
