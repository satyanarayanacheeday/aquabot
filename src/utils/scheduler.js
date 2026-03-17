const cron = require('node-cron');
const { getAllFarmers } = require('../models/database');
const { sendTextMessage } = require('../services/whatsapp');
const { generateAdvisory } = require('../services/advisory');

/**
 * Start all scheduled cron jobs
 */
function startScheduler() {
  console.log('⏰ Starting scheduler...');

  // ========================
  // DAILY DATA REMINDER — 6:00 AM every day
  // ========================
  cron.schedule('0 6 * * *', async () => {
    console.log('📤 Sending daily data reminders...');
    try {
      const farmers = await getAllFarmers();
      for (const farmer of farmers) {
        try {
          await sendTextMessage(farmer.phone,
            `Good morning ☀️\n\n` +
            `Please update today's pond data.\n\n` +
            `Reply with:\n` +
            `*DO:* (dissolved oxygen)\n` +
            `*pH:* (pH level)\n` +
            `*Feed:* (kg given today)\n\n` +
            `Or just type "update" and I'll guide you step by step! 📝`
          );
          // Small delay between messages to avoid rate limiting
          await sleep(1000);
        } catch (err) {
          console.error(`Failed to send daily reminder to ${farmer.phone}:`, err.message);
        }
      }
      console.log(`✅ Daily reminders sent to ${farmers.length} farmers`);
    } catch (err) {
      console.error('❌ Daily reminder job failed:', err.message);
    }
  }, {
    timezone: 'Asia/Kolkata',
  });

  // ========================
  // WEEKLY SAMPLING REMINDER — 6:00 AM every Monday
  // ========================
  cron.schedule('0 6 * * 1', async () => {
    console.log('📤 Sending weekly sampling reminders...');
    try {
      const farmers = await getAllFarmers();
      for (const farmer of farmers) {
        try {
          await sendTextMessage(farmer.phone,
            `📋 *Weekly Water & Growth Report*\n\n` +
            `Time for your weekly check!\n\n` +
            `Please share:\n` +
            `⚖️ Avg Weight & 📊 Survival\n` +
            `🧪 Ammonia & Nitrite\n` +
            `🧪 Alkalinity & Hardness\n\n` +
            `Type "sampling" or "water" to begin! 📝`
          );
          await sleep(1000);
        } catch (err) {
          console.error(`Failed to send weekly reminder to ${farmer.phone}:`, err.message);
        }
      }
      console.log(`✅ Weekly reminders sent to ${farmers.length} farmers`);
    } catch (err) {
      console.error('❌ Weekly reminder job failed:', err.message);
    }
  }, {
    timezone: 'Asia/Kolkata',
  });

    // ========================
    // DAILY ADVISORY — 7:00 AM every day
    // ========================
    cron.schedule('0 7 * * *', async () => {
      console.log('📤 Generating and sending daily advisory...');
      try {
        const farmers = await getAllFarmers();
        for (const farmer of farmers) {
          try {
            const advisory = await generateAdvisory(farmer.id, farmer.location, farmer.preferred_language);
          if (advisory) {
            await sendTextMessage(farmer.phone,
              `📋 *Today's Advisory*\n\n${advisory}`
            );
          }
          await sleep(2000); // Longer delay for advisory (API calls)
        } catch (err) {
          console.error(`Failed to send advisory to ${farmer.phone}:`, err.message);
        }
      }
      console.log(`✅ Advisory sent to ${farmers.length} farmers`);
    } catch (err) {
      console.error('❌ Advisory job failed:', err.message);
    }
  }, {
    timezone: 'Asia/Kolkata',
  });

  console.log('✅ Scheduler started:');
  console.log('   📌 Daily data reminder  → 6:00 AM IST');
  console.log('   📌 Weekly sampling      → 6:00 AM IST (Monday)');
  console.log('   📌 Daily advisory       → 7:00 AM IST');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { startScheduler };
