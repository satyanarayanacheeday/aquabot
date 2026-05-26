const { getMessageLog, clearMessageLog, inMemoryDB } = require('./test_framework');
const webhookController = require('../src/controllers/webhookController');
const { startFollowupCheckIn } = require('../src/services/followupCheckIn');
const { getDueFollowUps, markFollowUpCompleted, getFarmerById } = require('../src/models/database');

async function simulateMessage(phone, text, type = 'text', interactiveData = null) {
  console.log(`\x1b[36m🧑‍🌾 Farmer (${phone}):\x1b[0m ${text}`);
  const req = {
    body: {
      object: 'whatsapp_business_account',
      entry: [{
        changes: [{
          value: {
            messages: [{
              from: phone, id: 'test_msg_' + Date.now(), type, text: type === 'text' ? { body: text } : undefined, interactive: interactiveData
            }]
          }
        }]
      }]
    }
  };
  const res = { sendStatus: () => {} };
  await webhookController.handleIncoming(req, res);
}

function assert(condition, message) {
  if (!condition) {
    console.error(`\x1b[31m❌ ASSERTION FAILED:\x1b[0m ${message}`);
    process.exit(1);
  }
}

async function runTests() {
  const phone = '919876543210';
  
  // Need to run onboarding first to set up the DB
  await simulateMessage(phone, 'Hi');
  await simulateMessage(phone, 'English', 'interactive', { button_reply: { id: 'lang_en', title: 'English' }});
  await simulateMessage(phone, 'Shrimp', 'interactive', { button_reply: { id: 'farm_shrimp', title: 'Shrimp' }});
  await simulateMessage(phone, 'Bhimavaram');
  await simulateMessage(phone, '1', 'interactive', { button_reply: { id: 'ponds_1', title: '1' }});
  await simulateMessage(phone, 'Vannamei', 'interactive', { list_reply: { id: 'sp_vannamei', title: 'Vannamei' }});
  await simulateMessage(phone, 'This month', 'interactive', { button_reply: { id: 'stock_month', title: 'This month' }});
  await simulateMessage(phone, '1-3 acres', 'interactive', { button_reply: { id: 'size_medium', title: '1-3 acres' }});
  await simulateMessage(phone, 'Disease', 'interactive', { list_reply: { id: 'prob_disease', title: 'Disease' }});

  console.log("\n==============================================");
  console.log("🛠️  TESTING PROACTIVE SCHEDULED FOLLOW-UP");
  console.log("==============================================\n");

  clearMessageLog();

  // 1. Trigger disease event
  await simulateMessage(phone, 'I see white spots on my shrimp');
  
  // Answer disease questions
  await simulateMessage(phone, 'White spots', 'interactive', { button_reply: { id: 'dis_spots', title: 'White spots' }});
  await simulateMessage(phone, 'A few', 'interactive', { button_reply: { id: 'dis_few', title: 'A few' }});
  await simulateMessage(phone, 'Today', 'interactive', { button_reply: { id: 'dis_today', title: 'Today' }});

  // Verify schedule logic (Follow-up date should be +1 day from today)
  assert(inMemoryDB.scheduled_followups.length === 1, "Should schedule a follow-up");
  const fu = inMemoryDB.scheduled_followups[0];
  
  const expectedDate = new Date();
  expectedDate.setDate(expectedDate.getDate() + 1);
  assert(fu.followup_date === expectedDate.toISOString().split('T')[0], "Disease follow-up should be scheduled for tomorrow");
  assert(fu.event_type === 'disease', "Event type should be disease");

  console.log("✅ Follow-up scheduled successfully");

  clearMessageLog();

  // 2. Fast forward time by modifying the scheduled date to today
  const todayStr = new Date().toISOString().split('T')[0];
  fu.followup_date = todayStr;

  // 3. Simulate the Cron Job firing at 8:00 AM
  console.log("\n⏰ [Cron Job] Running daily 8:00 AM follow-up job...");
  const dueFollowUps = await getDueFollowUps(todayStr);
  assert(dueFollowUps.length === 1, "Should find 1 due follow-up");

  for (const followUp of dueFollowUps) {
    const farmer = await getFarmerById(followUp.farmer_id);
    await startFollowupCheckIn(farmer.phone, followUp.farmer_id, followUp.pond_id, followUp.event_type);
    await markFollowUpCompleted(followUp.id);
  }

  assert(inMemoryDB.scheduled_followups[0].status === 'completed', "Follow-up should be marked completed");
  assert(getMessageLog().slice(-1)[0].text.includes('checking in on your recent report of *disease*'), "Bot should send proactive message");

  // 4. Simulate user answering the check-in
  await simulateMessage(phone, 'Yes, Improved', 'interactive', { button_reply: { id: 'fu_improved', title: 'Yes, Improved' }});

  // Check if log is not yet saved (still in step 1)
  assert(getMessageLog().slice(-1)[0].text.includes('wonderful news'), "Bot should encourage farmer on improvement");
  assert(getMessageLog().slice(-1)[0].text.includes('What product or treatment did you use'), "Bot should ask for the treatment");

  // 5. Simulate user answering what they used
  await simulateMessage(phone, 'Growel Pond Pro');

  assert(inMemoryDB.logs.find(l => l.log_group === 'followup_result' && l.log_data.status === 'improved' && l.log_data.treatment_used === 'Growel Pond Pro'), "Follow-up result and treatment should be logged");
  assert(getMessageLog().slice(-1)[0].text.includes('Thank you for sharing'), "Bot should thank the farmer for sharing");

  console.log("\n🎉 ALL FOLLOW-UP TESTS PASSED SUCCESSFULLY! 🎉\n");
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
