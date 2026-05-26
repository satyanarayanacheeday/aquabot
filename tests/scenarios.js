const { getMessageLog, clearMessageLog, inMemoryDB } = require('./test_framework');
const webhookController = require('../src/controllers/webhookController');
const dailyCheckIn = require('../src/services/dailyCheckIn'); // To mock checkInType

// Helper to simulate an incoming WhatsApp message via the webhook controller
async function simulateMessage(phone, text, type = 'text', interactiveData = null) {
  console.log(`\x1b[36m🧑‍🌾 Farmer (${phone}):\x1b[0m ${text}`);
  
  const req = {
    body: {
      object: 'whatsapp_business_account',
      entry: [{
        changes: [{
          value: {
            messages: [{
              from: phone,
              id: 'test_msg_' + Date.now(),
              type: type,
              text: type === 'text' ? { body: text } : undefined,
              interactive: type === 'interactive' ? interactiveData : undefined
            }]
          }
        }]
      }]
    }
  };
  
  const res = { sendStatus: () => {} }; // Mock Express res
  
  await webhookController.handleIncoming(req, res);
}

// Simple assertion helper
function assert(condition, message) {
  if (!condition) {
    console.error(`\x1b[31m❌ ASSERTION FAILED:\x1b[0m ${message}`);
    process.exit(1);
  }
}

async function runTests() {
  const phone = '919876543210';
  
  console.log("\n==============================================");
  console.log("🛠️  SCENARIO 1: ONBOARDING FLOW");
  console.log("==============================================\n");
  
  // 1. Farmer says hi -> asks for language
  await simulateMessage(phone, 'Hi');
  assert(getMessageLog().slice(-1)[0].text.includes('aquaIQ'), "Should welcome farmer");
  assert(getMessageLog().slice(-1)[0].text.includes('English'), "Should ask for language");

  // 2. Select language -> asks for farm type
  await simulateMessage(phone, 'English', 'interactive', { button_reply: { id: 'lang_en', title: 'English' }});
  assert(getMessageLog().slice(-1)[0].text.includes('What do you farm'), "Should ask what they farm");

  // 3. Select farm type -> asks for village
  await simulateMessage(phone, 'Shrimp', 'interactive', { button_reply: { id: 'farm_shrimp', title: 'Shrimp' }});
  assert(getMessageLog().slice(-1)[0].text.includes('village'), "Should ask for village");

  // 4. Enter village -> asks for pond count
  await simulateMessage(phone, 'Bhimavaram');
  assert(getMessageLog().slice(-1)[0].text.includes('How many ponds'), "Should ask for pond count");

  // 5. Select pond count -> asks for species
  await simulateMessage(phone, '1', 'interactive', { button_reply: { id: 'ponds_1', title: '1' }});
  assert(getMessageLog().slice(-1)[0].text.includes('What species'), "Should ask for species");

  // 6. Select species -> asks for stocking date
  await simulateMessage(phone, 'Vannamei', 'interactive', { list_reply: { id: 'sp_vannamei', title: 'Vannamei' }});
  assert(getMessageLog().slice(-1)[0].text.includes('When did you stock'), "Should ask for stocking date");

  // 7. Select stocking date -> asks for pond size
  await simulateMessage(phone, 'This month', 'interactive', { button_reply: { id: 'stock_month', title: 'This month' }});
  assert(getMessageLog().slice(-1)[0].text.includes('pond size'), "Should ask for pond size");

  // 8. Select pond size -> asks for help topic
  await simulateMessage(phone, '1-3 acres', 'interactive', { button_reply: { id: 'size_medium', title: '1-3 acres' }});
  assert(getMessageLog().slice(-1)[0].text.includes('help with today'), "Should ask for help topic");

  // 9. Select help topic -> finalizes onboarding
  await simulateMessage(phone, 'Disease', 'interactive', { list_reply: { id: 'prob_disease', title: 'Disease' }});
  assert(getMessageLog().some(msg => msg.text.includes('All set')), "Should complete onboarding");
  
  assert(inMemoryDB.farmers.length === 1, "Farmer should be saved in DB");
  assert(inMemoryDB.ponds.length === 1, "Pond should be saved in DB");

  console.log("\n✅ SCENARIO 1 PASSED");
  
  console.log("\n==============================================");
  console.log("🛠️  SCENARIO 2: DAILY CHECK-IN (FEED)");
  console.log("==============================================\n");
  
  clearMessageLog();
  
  // Force the daily check-in type to be 'daily_feed'
  const originalGetCheckIn = dailyCheckIn.getTodayCheckInType;
  dailyCheckIn.getTodayCheckInType = () => 'daily_feed';

  await simulateMessage(phone, 'update');
  assert(getMessageLog().some(msg => msg.text.includes('Feed Check-In')), "Should start feed check-in");
  assert(getMessageLog().slice(-1)[0].text.includes('feed brand'), "Should ask for feed brand");

  // Answer Q1: Feed Brand
  await simulateMessage(phone, 'Avanti');
  assert(getMessageLog().slice(-1)[0].text.includes('kg of feed'), "Should ask for feed kg");

  // Answer Q2: Feed Kg
  await simulateMessage(phone, '10-30 kg', 'interactive', { button_reply: { id: 'feed_10_30', title: '10-30 kg' }});
  assert(getMessageLog().slice(-1)[0].text.includes('times do you feed'), "Should ask for feed times");

  // Answer Q3: Feed Times
  await simulateMessage(phone, '3 times', 'interactive', { button_reply: { id: 'times_3', title: '3-4 times' }});
  assert(getMessageLog().some(msg => msg.text.includes('recorded')), "Should confirm check-in saved");
  
  assert(inMemoryDB.logs.length > 0, "Daily log should be saved");
  
  // Restore
  dailyCheckIn.getTodayCheckInType = originalGetCheckIn;

  console.log("\n✅ SCENARIO 2 PASSED");

  console.log("\n==============================================");
  console.log("🛠️  SCENARIO 3: EVENT FOLLOW-UP (DIAGNOSTIC)");
  console.log("==============================================\n");
  
  clearMessageLog();
  // Farmer sends a text that triggers the 'mortality' event
  await simulateMessage(phone, 'My shrimp are dying');
  
  // Should trigger event followup, not standard AI
  assert(getMessageLog().some(msg => msg.text.toLowerCase().includes('mortality report')), "Should detect mortality event");
  assert(getMessageLog().slice(-1)[0].text.includes('How many died'), "Should ask diagnostic question 1");

  // Answer Q1
  await simulateMessage(phone, '1-10', 'interactive', { button_reply: { id: 'mort_few', title: '1-10' }});
  assert(getMessageLog().slice(-1)[0].text.includes('Since when'), "Should ask diagnostic question 2");
  
  // Answer Q2
  await simulateMessage(phone, 'Today', 'interactive', { button_reply: { id: 'mort_today', title: 'Today' }});
  assert(getMessageLog().slice(-1)[0].text.includes('smell'), "Should ask diagnostic question 3");

  // Answer Q3
  await simulateMessage(phone, 'No', 'interactive', { button_reply: { id: 'mort_smell_no', title: 'No' }});
  assert(getMessageLog().slice(-1)[0].text.includes('body'), "Should ask diagnostic question 4");

  // Answer Q4
  await simulateMessage(phone, 'No signs', 'interactive', { button_reply: { id: 'mort_sign_none', title: 'No signs' }});
  
  assert(inMemoryDB.logs.find(l => l.log_group === 'event' && l.log_data.event_type === 'mortality'), "Mortality event log should be saved");
  console.log("\n✅ SCENARIO 3 PASSED");

  console.log("\n==============================================");
  console.log("🛠️  SCENARIO 4: AI & RECOMMENDATION DB INTEGRATION");
  console.log("==============================================\n");
  
  clearMessageLog();
  // Farmer asks a question containing a problem keyword from the AP Brands DB
  await simulateMessage(phone, 'My pond has very high ammonia, what should I do?');
  
  const lastReply = getMessageLog().slice(-1)[0].text;
  assert(lastReply.includes('Growel Pond Pro'), "AI should recommend Growel Pond Pro based on AP Brands DB");
  assert(lastReply.includes('Blue Aqua Nitro Clear'), "AI should recommend Blue Aqua Nitro Clear based on AP Brands DB");
  
  console.log("\n✅ SCENARIO 4 PASSED");
  
  console.log("\n🎉 ALL E2E BOT TESTS PASSED SUCCESSFULLY! 🎉\n");
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
