const { sendTextMessage, sendButtonMessage } = require('./whatsapp');
const { insertPondLog, saveChatHistory } = require('../models/database');
const { setState, getState, clearState, updateStateData } = require('../state/conversationState');

/**
 * Handles the farmer's response to a proactive event follow-up.
 */

async function startFollowupCheckIn(phone, farmerId, pondId, eventType) {
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
    `Hi! 👋 We're checking in on your recent report of *${eventName}*.\n\nHas the situation improved?`,
    [
      { id: 'fu_improved', title: 'Yes, Improved' },
      { id: 'fu_same', title: 'No, Same' },
      { id: 'fu_worse', title: 'Worse' }
    ]
  );
}

async function handleFollowupStep(phone, message) {
  const state = getState(phone);
  if (!state || state.flow !== 'followup_checkin') return false;

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
        `Has the situation improved?`,
        [
          { id: 'fu_improved', title: 'Yes, Improved' },
          { id: 'fu_same', title: 'No, Same' },
          { id: 'fu_worse', title: 'Worse' }
        ]
      );
      return true;
    }

    if (status === 'improved') {
      // Move to step 1 to ask for treatment
      updateStateData(phone, { status });
      setState(phone, { ...getState(phone), step: 1 });
      await sendTextMessage(phone, '✅ That is wonderful news!\n\n*What product or treatment did you use?*\nThis helps us learn and advise other farmers better in the future!');
      return true;
    } else {
      // Finalize immediately for negative outcomes
      updateStateData(phone, { status });
      await finalizeFollowup(phone);
      await sendTextMessage(phone, '⚠️ I am sorry to hear that. Since the situation hasn\'t improved, I strongly recommend consulting a local aquaculture expert or technician immediately. You may also want to temporarily reduce or stop feeding to maintain water quality.');
      return true;
    }
  }

  // STEP 1: Collect treatment used
  if (state.step === 1) {
    updateStateData(phone, { treatment_used: message.trim() });
    await finalizeFollowup(phone);
    await sendTextMessage(phone, '🙏 Thank you for sharing! Keep monitoring the water quality and feeding rate closely. Let me know if anything changes!');
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

module.exports = {
  startFollowupCheckIn,
  handleFollowupStep,
};
