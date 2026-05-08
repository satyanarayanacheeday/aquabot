const cron = require('node-cron');
const { getAllFarmers, hasPendingDailyCheckIn, scheduleFollowUp } = require('../models/database');
const { startDailyCheckIn, GROUP_MAP } = require('../services/dailyCheckIn');
const { sendButtonMessage } = require('../services/whatsapp');

/**
 * Start all scheduled cron jobs
 *
 * Schedule:
 *   6:00 AM Mon   → Feed check-in reminder
 *   6:00 AM Wed   → Water check-in reminder
 *   6:00 AM Fri   → Health check-in reminder
 *   6:00 AM Sun   → Weekly check-in reminder
 *   7:00 AM daily → Daily advisory (auto-collected, no farmer input)
 */
function startScheduler() {
  console.log('⏰ Starting scheduler...');

  // ========================
  // MONDAY — Feed Check-In Reminder
  // ========================
  cron.schedule('0 6 * * 1', async () => {
    console.log('📤 [Mon] Sending feed check-in reminders...');
    await sendCheckInReminders('daily_feed',
      '🍽️ *Feed Check-In*\n\nGood morning! Quick 3-question feed check. Takes 30 seconds!',
      'btn_update'
    );
  }, { timezone: 'Asia/Kolkata' });

  // ========================
  // WEDNESDAY — Water Check-In Reminder
  // ========================
  cron.schedule('0 6 * * 3', async () => {
    console.log('📤 [Wed] Sending water check-in reminders...');
    await sendCheckInReminders('daily_water',
      '💧 *Water Check-In*\n\nGood morning! Let\'s check your pond water. Just 3 taps!',
      'btn_update'
    );
  }, { timezone: 'Asia/Kolkata' });

  // ========================
  // FRIDAY — Health Check-In Reminder
  // ========================
  cron.schedule('0 6 * * 5', async () => {
    console.log('📤 [Fri] Sending health check-in directly...');
    await sendCheckInReminders('daily_health', null, null, true);
  }, { timezone: 'Asia/Kolkata' });

  // ========================
  // SUNDAY — Weekly Check-In Reminder
  // ========================
  cron.schedule('0 6 * * 0', async () => {
    console.log('📤 [Sun] Sending weekly check-in reminders...');
    await sendCheckInReminders('weekly',
      '📋 *Weekly Check-In*\n\nGood morning! Time for your quick weekly summary.',
      'btn_weekly'
    );
  }, { timezone: 'Asia/Kolkata' });

  // ========================
  // PROACTIVE EVENT FOLLOW-UPS — 8:00 PM every day (Night time check-in)
  // ========================
  cron.schedule('0 20 * * *', async () => {
    console.log('📤 [Daily] Sending proactive event follow-ups (8 PM)...');
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
            await sleep(2000); // rate limiting
          }
        } catch (err) {
          console.error(`Failed to send follow-up to farmer ${fu.farmer_id}:`, err.message);
        }
      }
      console.log(`✅ Proactive follow-ups sent to ${dueFollowUps.length} farmers`);
    } catch (err) {
      console.error('❌ Proactive follow-up job failed:', err.message);
    }
  }, { timezone: 'Asia/Kolkata' });

  // ========================
  // DAILY ADVISORY — 7:00 AM every day
  // Advisory auto-generated, no farmer input needed
  // ========================
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
          await sleep(2000); // rate limiting
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
  console.log('   🍽️ Monday 6:00 AM    → Feed check-in');
  console.log('   💧 Wednesday 6:00 AM  → Water check-in');
  console.log('   🔬 Friday 6:00 AM     → Health check-in');
  console.log('   📋 Sunday 6:00 AM     → Weekly check-in');
  console.log('   ☀️ Daily 7:00 AM      → Advisory');
  console.log('   🔍 Daily 8:00 PM      → Proactive Event Follow-ups');
}

/**
 * Send check-in reminders with interactive buttons to all registered farmers
 */
async function sendCheckInReminders(type, bodyText, buttonKey, directStart = false) {
  try {
    const farmers = await getAllFarmers();
    const { translations, startDailyCheckIn } = require('../services/dailyCheckIn');

    for (const farmer of farmers) {
      try {
        if (type !== 'weekly') {
          const hasPending = await hasPendingDailyCheckIn(farmer.id);
          if (hasPending) {
            console.log(`⏭️ Skipping ${farmer.phone} — they haven't responded to a previous daily check-in.`);
            continue;
          }
        }

        if (directStart) {
          await startDailyCheckIn(farmer.phone, farmer.id, type);
        } else {
          const lang = farmer.preferred_language || 'English';
          const buttonLabel = translations[lang]?.[buttonKey] || translations['English']?.[buttonKey] || 'Update';
          
          await sendButtonMessage(farmer.phone, bodyText, [
            { id: type === 'weekly' ? 'weekly' : 'checkin', title: buttonLabel }
          ]);
        }
        
        if (type !== 'weekly') {
          await scheduleFollowUp(farmer.id, null, 'daily_checkin', new Date().toISOString());
        }

        await sleep(1000); // rate limiting
      } catch (err) {
        console.error(`Failed to send reminder to ${farmer.phone}:`, err.message);
      }
    }
    console.log(`✅ ${type} reminders sent to ${farmers.length} farmers`);
  } catch (err) {
    console.error(`❌ ${type} reminder job failed:`, err.message);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { startScheduler };
