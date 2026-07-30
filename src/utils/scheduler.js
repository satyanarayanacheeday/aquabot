const cron = require('node-cron');
const { getAllFarmers, hasPendingDailyCheckIn, scheduleFollowUp, getLatestHealthScore } = require('../models/database');
const { startDailyCheckIn, GROUP_MAP } = require('../services/dailyCheckIn');
const { sendButtonMessage, sendTextMessage } = require('../services/whatsapp');
const { formatHealthScoreBadge } = require('../services/healthScore');

/**
 * Scheduler — Optimal Timing & High-Engagement Reminders
 *
 * Schedule (IST):
 *   07:30 AM Mon   → Feed check-in reminder (primary)
 *   07:30 AM Wed   → Water check-in reminder (primary)
 *   07:30 AM Fri   → Health check-in (direct start, no tap needed)
 *   07:30 AM Sun   → Weekly check-in reminder
 *   01:30 PM Mon/Wed → Gentle nudge for non-responders
 *   05:30 PM Mon/Wed/Sun → Evening resend for farmers still missing
 *   06:00 PM daily → Event follow-up delivery
 */
function startScheduler() {
  console.log('⏰ Starting scheduler...');

  // ════════════════════════════════════════
  // PRIMARY MORNING REMINDERS — 07:30 AM
  // ════════════════════════════════════════

  // MONDAY — Feed Check-In
  cron.schedule('30 7 * * 1', async () => {
    console.log('📤 [Mon 7:30AM] Feed check-in reminders...');
    await sendCheckInReminders('daily_feed', 'primary');
  }, { timezone: 'Asia/Kolkata' });

  // WEDNESDAY — Water Check-In
  cron.schedule('30 7 * * 3', async () => {
    console.log('📤 [Wed 7:30AM] Water check-in reminders...');
    await sendCheckInReminders('daily_water', 'primary');
  }, { timezone: 'Asia/Kolkata' });

  // FRIDAY — Health Check-In (direct start — no tap needed)
  cron.schedule('30 7 * * 5', async () => {
    console.log('📤 [Fri 7:30AM] Health check-in direct start...');
    await sendCheckInReminders('daily_health', 'direct');
  }, { timezone: 'Asia/Kolkata' });

  // SUNDAY — Weekly Check-In
  cron.schedule('30 7 * * 0', async () => {
    console.log('📤 [Sun 7:30AM] Weekly check-in reminders...');
    await sendCheckInReminders('weekly', 'primary');
  }, { timezone: 'Asia/Kolkata' });

  // ════════════════════════════════════════
  // GENTLE NUDGE — 01:30 PM (Mon/Wed only)
  // Sent only to farmers who have NOT responded to the morning reminder
  // ════════════════════════════════════════
  cron.schedule('30 13 * * 1', async () => {
    console.log('📤 [Mon 1:30PM] Gentle nudge for non-responders...');
    await sendCheckInReminders('daily_feed', 'nudge');
  }, { timezone: 'Asia/Kolkata' });

  cron.schedule('30 13 * * 3', async () => {
    console.log('📤 [Wed 1:30PM] Gentle nudge for non-responders...');
    await sendCheckInReminders('daily_water', 'nudge');
  }, { timezone: 'Asia/Kolkata' });

  // ════════════════════════════════════════
  // EVENING RESEND — 05:30 PM (Mon/Wed/Sun)
  // Final send for the day — warm & non-pushy
  // ════════════════════════════════════════
  cron.schedule('30 17 * * 1', async () => {
    console.log('📤 [Mon 5:30PM] Evening resend...');
    await sendCheckInReminders('daily_feed', 'evening');
  }, { timezone: 'Asia/Kolkata' });

  cron.schedule('30 17 * * 3', async () => {
    console.log('📤 [Wed 5:30PM] Evening resend...');
    await sendCheckInReminders('daily_water', 'evening');
  }, { timezone: 'Asia/Kolkata' });

  cron.schedule('30 17 * * 0', async () => {
    console.log('📤 [Sun 5:30PM] Weekly evening resend...');
    await sendCheckInReminders('weekly', 'evening');
  }, { timezone: 'Asia/Kolkata' });

  // ════════════════════════════════════════
  // EVENT FOLLOW-UPS — 06:00 PM every day
  // Moved from 8 PM: farmers more active early evening
  // ════════════════════════════════════════
  cron.schedule('0 18 * * *', async () => {
    console.log('📤 [Daily 6:00PM] Proactive event follow-ups...');
    try {
      const { getDueFollowUps, getFarmerById, markFollowUpCompleted } = require('../models/database');
      const { startFollowupCheckIn } = require('../services/followupCheckIn');

      const today = new Date().toISOString().split('T')[0];
      const dueFollowUps = await getDueFollowUps(today);

      for (const fu of dueFollowUps) {
        try {
          const farmer = await getFarmerById(fu.farmer_id);
          if (farmer) {
            await startFollowupCheckIn(farmer.phone, fu.farmer_id, fu.pond_id, fu.event_type);
            await markFollowUpCompleted(fu.id);
            await sleep(2000);
          }
        } catch (err) {
          console.error(`Failed to send follow-up to farmer ${fu.farmer_id}:`, err.message);
        }
      }
      console.log(`✅ Follow-ups sent to ${dueFollowUps.length} farmers`);
    } catch (err) {
      console.error('❌ Follow-up job failed:', err.message);
    }
  }, { timezone: 'Asia/Kolkata' });

  // ════════════════════════════════════════
  // DAILY ADVISORY — 07:00 AM every day
  // ════════════════════════════════════════
  cron.schedule('0 7 * * *', async () => {
    console.log('📤 Generating daily advisories...');
    try {
      const farmers = await getAllFarmers();
      for (const farmer of farmers) {
        try {
          const { generateAdvisory } = require('../services/advisory');
          const advisory = await generateAdvisory(
            farmer.id,
            farmer.village,
            farmer.preferred_language
          );
          if (advisory) {
            await sendTextMessage(farmer.phone,
              `☀️ *Today's Advisory*\n\n${advisory}`
            );
          }
          await sleep(2000);
        } catch (err) {
          console.error(`Failed to send advisory to ${farmer.phone}:`, err.message);
        }
      }
      console.log(`✅ Advisory sent to ${farmers.length} farmers`);
    } catch (err) {
      console.error('❌ Advisory job failed:', err.message);
    }
  }, { timezone: 'Asia/Kolkata' });

  console.log('✅ Scheduler started:');
  console.log('   🍽️ Monday    7:30 AM  → Feed check-in (primary)');
  console.log('   🍽️ Monday    1:30 PM  → Feed nudge');
  console.log('   🍽️ Monday    5:30 PM  → Feed evening resend');
  console.log('   💧 Wednesday 7:30 AM  → Water check-in (primary)');
  console.log('   💧 Wednesday 1:30 PM  → Water nudge');
  console.log('   💧 Wednesday 5:30 PM  → Water evening resend');
  console.log('   🔬 Friday    7:30 AM  → Health check-in (direct)');
  console.log('   📋 Sunday    7:30 AM  → Weekly check-in (primary)');
  console.log('   📋 Sunday    5:30 PM  → Weekly evening resend');
  console.log('   ☀️ Daily     7:00 AM  → Advisory');
  console.log('   🔍 Daily     6:00 PM  → Event follow-ups');
}

// ════════════════════════════════════════
// SEND CHECK-IN REMINDERS
// mode: 'primary' | 'nudge' | 'evening' | 'direct'
// ════════════════════════════════════════

async function sendCheckInReminders(type, mode = 'primary') {
  try {
    const farmers = await getAllFarmers();
    const { startDailyCheckIn } = require('../services/dailyCheckIn');

    for (const farmer of farmers) {
      try {
        const lang = farmer.preferred_language || 'English';

        // Skip farmers who have already completed today's check-in
        if (type !== 'weekly') {
          const hasPending = await hasPendingDailyCheckIn(farmer.id);
          if (!hasPending && mode !== 'primary') {
            // They already completed — skip nudge/evening resend
            console.log(`⏭️ Skipping ${farmer.phone} — check-in already completed.`);
            continue;
          }
          if (hasPending === false && mode === 'nudge') {
            // hasPendingDailyCheckIn returns true if there's a PENDING (unanswered) reminder
            // If there's no pending, they already completed it — skip
            continue;
          }
        }

        // DIRECT START — no button tap needed (Friday health check-in)
        if (mode === 'direct') {
          await startDailyCheckIn(farmer.phone, farmer.id, type);
          await sleep(1500);
          continue;
        }

        // Build the reminder message with health score context
        const reminderText = await buildReminderMessage(type, mode, farmer);

        // Button label
        const buttonLabel = getReminderButtonLabel(type, lang);

        await sendButtonMessage(farmer.phone, reminderText, [
          { id: type === 'weekly' ? 'weekly' : 'checkin', title: buttonLabel }
        ]);

        // Schedule a follow-up marker for this check-in (to track non-responders)
        if (type !== 'weekly' && mode === 'primary') {
          await scheduleFollowUp(farmer.id, null, 'daily_checkin', new Date().toISOString());
        }

        await sleep(1000);
      } catch (err) {
        console.error(`Failed to send ${mode} reminder to ${farmer.phone}:`, err.message);
      }
    }
    console.log(`✅ ${type} ${mode} reminders sent to ${farmers.length} farmers`);
  } catch (err) {
    console.error(`❌ ${type} ${mode} reminder job failed:`, err.message);
  }
}

// ════════════════════════════════════════
// BUILD LOCALIZED REMINDER MESSAGE
// ════════════════════════════════════════

async function buildReminderMessage(type, mode, farmer) {
  const lang = farmer.preferred_language || 'English';

  // Try to fetch the farmer's latest pond health score for context
  let scoreBadge = '';
  try {
    const { getFirstPondByFarmer } = require('../models/database');
    const pond = await getFirstPondByFarmer(farmer.id);
    if (pond) {
      const scoreData = await getLatestHealthScore(pond.id);
      if (scoreData) {
        scoreBadge = formatHealthScoreBadge(scoreData, lang);
      }
    }
  } catch (err) {
    // Non-critical — skip silently
  }

  const messages = {
    daily_feed: {
      primary: {
        English: `🌅 *Good morning!*\n\nTime for your quick Feed Check-In — 3 taps and you're done! 🍽️${scoreBadge ? `\n\n📊 ${scoreBadge}` : ''}`,
        Telugu:  `🌅 *శుభోదయం!*\n\nమీ మేత చెక్-ఇన్ సమయం వచ్చింది — 3 ట్యాప్‌లలో పూర్తవుతుంది! 🍽️${scoreBadge ? `\n\n📊 ${scoreBadge}` : ''}`,
        Hindi:   `🌅 *सुप्रभात!*\n\nआपका फीड चेक-इन का समय आ गया है — बस 3 टैप में हो जाएगा! 🍽️${scoreBadge ? `\n\n📊 ${scoreBadge}` : ''}`,
      },
      nudge: {
        English: `👋 *Just a gentle reminder!*\n\nYour morning Feed Check-In is waiting — it's only 30 seconds! 🍽️`,
        Telugu:  `👋 *చిన్న గుర్తు చేస్తున్నాను!*\n\nమీ మేత చెక్-ఇన్ వేచి ఉంది — కేవలం 30 సెకండ్లు! 🍽️`,
        Hindi:   `👋 *एक छोटी याद दिलाना!*\n\nआपका फीड चेक-इन इंतज़ार कर रहा है — बस 30 सेकंड! 🍽️`,
      },
      evening: {
        English: `🌆 *Before you wind down for the day...*\n\nDid you do your Feed Check-In today? Takes just a minute! 🍽️`,
        Telugu:  `🌆 *రోజు ముగించే ముందు...*\n\nఈరోజు మేత చెక్-ఇన్ చేశారా? కేవలం ఒక్క నిమిషం! 🍽️`,
        Hindi:   `🌆 *दिन खत्म करने से पहले...*\n\nक्या आपने आज अपना फीड चेक-इन किया? बस एक मिनट! 🍽️`,
      },
    },
    daily_water: {
      primary: {
        English: `🌅 *Good morning!*\n\nWater Check-In time! How is your pond looking today? 💧${scoreBadge ? `\n\n📊 ${scoreBadge}` : ''}`,
        Telugu:  `🌅 *శుభోదయం!*\n\nనీటి చెక్-ఇన్ సమయం! ఈరోజు మీ చెరువు ఎలా ఉంది? 💧${scoreBadge ? `\n\n📊 ${scoreBadge}` : ''}`,
        Hindi:   `🌅 *सुप्रभात!*\n\nपानी चेक-इन का समय! आज आपका तालाब कैसा दिख रहा है? 💧${scoreBadge ? `\n\n📊 ${scoreBadge}` : ''}`,
      },
      nudge: {
        English: `👋 *Quick reminder!*\n\nWater quality check — just 3 questions for the health of your pond! 💧`,
        Telugu:  `👋 *గుర్తుచేస్తున్నాను!*\n\nనీటి నాణ్యత తనిఖీ — మీ చెరువు ఆరోగ్యానికి కేవలం 3 ప్రశ్నలు! 💧`,
        Hindi:   `👋 *याद दिलाना!*\n\nपानी की गुणवत्ता जाँच — आपके तालाब की सेहत के लिए बस 3 सवाल! 💧`,
      },
      evening: {
        English: `🌆 *Evening pond check!*\n\nDid you do your Water Check-In today? Your pond data keeps your fish safe! 💧`,
        Telugu:  `🌆 *సాయంకాలం చెరువు తనిఖీ!*\n\nఈరోజు నీటి చెక్-ఇన్ చేశారా? మీ చెరువు డేటా మీ చేపలను సురక్షితంగా ఉంచుతుంది! 💧`,
        Hindi:   `🌆 *शाम का तालाब निरीक्षण!*\n\nक्या आपने आज पानी की जाँच की? आपके तालाब का डेटा आपकी मछलियों को सुरक्षित रखता है! 💧`,
      },
    },
    weekly: {
      primary: {
        English: `🌅 *Good morning!*\n\nTime for your Weekly Summary — see how your pond performed this week! 📋${scoreBadge ? `\n\n📊 ${scoreBadge}` : ''}`,
        Telugu:  `🌅 *శుభోదయం!*\n\nవారపు సారాంశ సమయం — ఈ వారం మీ చెరువు ఎలా పని చేసిందో చూడండి! 📋${scoreBadge ? `\n\n📊 ${scoreBadge}` : ''}`,
        Hindi:   `🌅 *सुप्रभात!*\n\nसाप्ताहिक सारांश का समय — देखें इस हफ्ते आपका तालाब कैसा रहा! 📋${scoreBadge ? `\n\n📊 ${scoreBadge}` : ''}`,
      },
      evening: {
        English: `🌆 *Weekly check-in is still open!*\n\nTake 2 minutes to log your week — it helps us give you better advice! 📋`,
        Telugu:  `🌆 *వారపు చెక్-ఇన్ ఇంకా తెరిచే ఉంది!*\n\nమీ వారాన్ని లాగ్ చేయడానికి 2 నిమిషాలు తీసుకోండి — ఇది మాకు మెరుగైన సలహా ఇవ్వడానికి సహాయపడుతుంది! 📋`,
        Hindi:   `🌆 *साप्ताहिक चेक-इन अभी भी खुला है!*\n\nअपना हफ्ता लॉग करने में 2 मिनट लें — इससे हम आपको बेहतर सलाह दे सकते हैं! 📋`,
      },
    },
  };

  const typeMessages = messages[type] || messages['daily_feed'];
  const modeMessages = typeMessages[mode] || typeMessages['primary'];
  return modeMessages[lang] || modeMessages['English'];
}

// ════════════════════════════════════════
// REMINDER BUTTON LABELS
// ════════════════════════════════════════

function getReminderButtonLabel(type, lang = 'English') {
  const labels = {
    daily_feed: {
      English: 'Feed Check-In 🍽️',
      Telugu:  'మేత చెక్-ఇన్ 🍽️',
      Hindi:   'फीड चेक-इन 🍽️',
    },
    daily_water: {
      English: 'Water Check-In 💧',
      Telugu:  'నీటి చెక్-ఇన్ 💧',
      Hindi:   'पानी चेक-इन 💧',
    },
    weekly: {
      English: 'Weekly Report 📋',
      Telugu:  'వారపు నివేదిక 📋',
      Hindi:   'साप्ताहिक रिपोर्ट 📋',
    },
  };
  return labels[type]?.[lang] || labels[type]?.['English'] || 'Update 📝';
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { startScheduler };
