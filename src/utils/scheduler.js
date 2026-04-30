const cron = require('node-cron');
const { getAllFarmers } = require('../models/database');
const { sendTextMessage } = require('../services/whatsapp');
const { generateAdvisory } = require('../services/advisory');
const { startDailyCheckIn } = require('../services/dailyCheckIn');

/**
 * Start all scheduled cron jobs
 *
 * Schedule:
 *   6:00 AM Mon   → Feed check-in reminder
 *   6:00 AM Wed   → Water check-in reminder
 *   6:00 AM Fri   → Health check-in reminder
 *   6:00 AM Sun   → Weekly check-in reminder
 *   7:00 AM daily → Weather + advisory (auto-collected, no farmer input)
 */
function startScheduler() {
  console.log('⏰ Starting scheduler...');

  // ========================
  // MONDAY — Feed Check-In Reminder
  // ========================
  cron.schedule('0 6 * * 1', async () => {
    console.log('📤 [Mon] Sending feed check-in reminders...');
    await sendCheckInReminders('daily_feed',
      '🍽️ *Feed Check-In*\n\nGood morning! Quick 3-question feed check. Takes 30 seconds!\n\nType "update" to start 📝'
    );
  }, { timezone: 'Asia/Kolkata' });

  // ========================
  // WEDNESDAY — Water Check-In Reminder
  // ========================
  cron.schedule('0 6 * * 3', async () => {
    console.log('📤 [Wed] Sending water check-in reminders...');
    await sendCheckInReminders('daily_water',
      '💧 *Water Check-In*\n\nGood morning! Let\'s check your pond water. Just 3 taps!\n\nType "update" to start 📝'
    );
  }, { timezone: 'Asia/Kolkata' });

  // ========================
  // FRIDAY — Health Check-In Reminder
  // ========================
  cron.schedule('0 6 * * 5', async () => {
    console.log('📤 [Fri] Sending health check-in reminders...');
    await sendCheckInReminders('daily_health',
      '🔬 *Health Check-In*\n\nGood morning! Quick health check for your pond.\n\nType "update" to start 📝'
    );
  }, { timezone: 'Asia/Kolkata' });

  // ========================
  // SUNDAY — Weekly Check-In Reminder
  // ========================
  cron.schedule('0 6 * * 0', async () => {
    console.log('📤 [Sun] Sending weekly check-in reminders...');
    await sendCheckInReminders('weekly',
      '📋 *Weekly Check-In*\n\nGood morning! Time for your quick weekly summary.\n\nType "weekly" to start 📝'
    );
  }, { timezone: 'Asia/Kolkata' });

  // ========================
  // PROACTIVE EVENT FOLLOW-UPS — 8:00 AM every day
  // ========================
  cron.schedule('0 8 * * *', async () => {
    console.log('📤 [Daily] Sending proactive event follow-ups...');
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
  // Weather + advice auto-generated, no farmer input needed
  // ========================
  cron.schedule('0 7 * * *', async () => {
    console.log('📤 Generating daily advisories...');
    try {
      const farmers = await getAllFarmers();
      for (const farmer of farmers) {
        try {
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
  console.log('   🔍 Daily 8:00 AM      → Proactive Event Follow-ups');
}

/**
 * Send check-in reminders to all registered farmers
 */
async function sendCheckInReminders(type, message) {
  try {
    const farmers = await getAllFarmers();
    for (const farmer of farmers) {
      try {
        await sendTextMessage(farmer.phone, message);
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
