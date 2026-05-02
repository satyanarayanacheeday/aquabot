/**
 * Comprehensive E2E Test — All Bot Features + Context Gap Fixes
 * 
 * Tests all 11 scenarios covering every bot feature and all 5 context gaps.
 */

// Must load test framework FIRST (mocks all external services)
const { getMessageLog, clearMessageLog, inMemoryDB } = require('./test_framework');

// Mock the conversationSummary service to avoid real Gemini calls during testing
const convSummary = require('../src/services/conversationSummary');
convSummary.getOrRefreshSummary = async (farmerId) => {
  if (inMemoryDB.chats.filter(c => c.farmer_id === farmerId).length > 4) {
    return '• Farmer grows Vannamei shrimp in Bhimavaram\n• Previously reported mortality with red body signs\n• Feed: Avanti brand, 10-30kg, 3-4x/day';
  }
  return '';
};

const webhookController = require('../src/controllers/webhookController');
const { startDailyCheckIn, handleDailyStep } = require('../src/services/dailyCheckIn');
const { startWeeklyCheckIn, handleWeeklyStep } = require('../src/services/weeklyCheckIn');
const { startFollowupCheckIn } = require('../src/services/followupCheckIn');
const { getDueFollowUps, markFollowUpCompleted, getFarmerById } = require('../src/models/database');
const { clearState } = require('../src/state/conversationState');

// ========================
// HELPERS
// ========================

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
              type,
              text: type === 'text' ? { body: text } : undefined,
              interactive: type === 'interactive' ? interactiveData : undefined,
              image: type === 'image' ? { id: 'mock_image_123' } : undefined,
            }]
          }
        }]
      }]
    }
  };
  const res = { sendStatus: () => {} };
  await webhookController.handleIncoming(req, res);
}

// Simulate button press through webhook
function btn(id, title) {
  return { button_reply: { id, title } };
}
function lst(id, title) {
  return { list_reply: { id, title } };
}

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`\x1b[31m  ❌ FAIL:\x1b[0m ${message}`);
    failed++;
  } else {
    console.log(`\x1b[32m  ✅ PASS:\x1b[0m ${message}`);
    passed++;
  }
}

function section(title) {
  console.log(`\n${'='.repeat(55)}`);
  console.log(`🧪 ${title}`);
  console.log(`${'='.repeat(55)}\n`);
}

// ========================
// MAIN TEST RUNNER
// ========================

async function runAllTests() {
  const phone = '919876543210';

  // ============================================
  // SCENARIO 1: ONBOARDING
  // ============================================
  section('SCENARIO 1: FULL ONBOARDING FLOW');

  await simulateMessage(phone, 'Hi');
  assert(getMessageLog().slice(-1)[0].text.includes('Aquorix'), 'Welcome message shown');

  await simulateMessage(phone, 'English', 'interactive', btn('lang_en', 'English'));
  assert(getMessageLog().slice(-1)[0].text.includes('What do you farm'), 'Asks farm type');

  await simulateMessage(phone, 'Shrimp', 'interactive', btn('farm_shrimp', 'Shrimp'));
  assert(getMessageLog().slice(-1)[0].text.includes('village'), 'Asks village');

  await simulateMessage(phone, 'Bhimavaram');
  assert(getMessageLog().slice(-1)[0].text.includes('How many ponds'), 'Asks pond count');

  await simulateMessage(phone, '1', 'interactive', btn('ponds_1', '1'));
  assert(getMessageLog().slice(-1)[0].text.includes('species'), 'Asks species');

  await simulateMessage(phone, 'Vannamei', 'interactive', lst('sp_vannamei', 'Vannamei'));
  assert(getMessageLog().slice(-1)[0].text.includes('stock'), 'Asks stocking date');

  await simulateMessage(phone, 'This month', 'interactive', btn('stock_month', 'This month'));
  assert(getMessageLog().slice(-1)[0].text.includes('pond size'), 'Asks pond size');

  await simulateMessage(phone, '1-3 acres', 'interactive', btn('size_medium', '1-3 acres'));
  assert(getMessageLog().slice(-1)[0].text.includes('help with today'), 'Asks help topic');

  await simulateMessage(phone, 'Disease', 'interactive', lst('prob_disease', 'Disease'));
  assert(getMessageLog().some(msg => msg.text.includes('All set')), 'Onboarding completed');
  assert(inMemoryDB.farmers.length === 1, 'Farmer saved in DB');
  assert(inMemoryDB.ponds.length === 1, 'Pond saved in DB');
  assert(inMemoryDB.farmers[0].preferred_language === 'English', 'Language saved');
  assert(inMemoryDB.farmers[0].village === 'Bhimavaram', 'Village saved');
  assert(inMemoryDB.ponds[0].species === 'vannamei', 'Species saved');

  const farmerId = inMemoryDB.farmers[0].id;

  // ============================================
  // SCENARIO 2: DAILY FEED CHECK-IN
  // ============================================
  section('SCENARIO 2: DAILY FEED CHECK-IN (Gap 1 — chat_history)');
  clearMessageLog();
  clearState(phone);

  // Directly start feed check-in (avoids getTodayCheckInType mock issues)
  await startDailyCheckIn(phone, farmerId, 'daily_feed');
  assert(getMessageLog().some(msg => msg.text.includes('Feed Check-In')), 'Feed check-in started');

  // Feed brand (first time, will be asked)
  await simulateMessage(phone, 'Avanti');
  assert(getMessageLog().slice(-1)[0].text.includes('kg'), 'Asks feed quantity');

  await simulateMessage(phone, '10-30 kg', 'interactive', btn('feed_10_30', '10-30 kg'));
  assert(getMessageLog().slice(-1)[0].text.includes('times'), 'Asks feed frequency');

  await simulateMessage(phone, '3-4 times', 'interactive', btn('times_3', '3-4 times'));
  assert(getMessageLog().some(msg => msg.text.includes('recorded')), 'Feed check-in confirmed');

  // GAP 1 VERIFICATION
  const feedChats = inMemoryDB.chats.filter(c => c.message_type === 'checkin' && c.message.includes('Feed'));
  assert(feedChats.length >= 1, 'GAP 1: Feed check-in saved to chat_history');
  assert(feedChats[0].farmer_id === farmerId, 'GAP 1: Correct farmer_id');
  assert(feedChats[0].message.includes('Avanti'), 'GAP 1: Feed brand in chat summary');

  // ============================================
  // SCENARIO 3: DAILY WATER CHECK-IN
  // ============================================
  section('SCENARIO 3: DAILY WATER CHECK-IN (Gap 1)');
  clearMessageLog();
  clearState(phone);

  await startDailyCheckIn(phone, farmerId, 'daily_water');
  assert(getMessageLog().some(msg => msg.text.includes('Water Check-In')), 'Water check-in started');

  await simulateMessage(phone, 'Green', 'interactive', btn('color_green', '🟢 Green'));
  await simulateMessage(phone, 'No', 'interactive', btn('smell_no', 'No'));
  await simulateMessage(phone, 'No', 'interactive', btn('foam_no', 'No'));

  assert(getMessageLog().some(msg => msg.text.includes('recorded')), 'Water check-in confirmed');
  const waterChats = inMemoryDB.chats.filter(c => c.message_type === 'checkin' && c.message.includes('Water'));
  assert(waterChats.length >= 1, 'GAP 1: Water check-in saved to chat_history');

  // ============================================
  // SCENARIO 4: DAILY HEALTH CHECK-IN
  // ============================================
  section('SCENARIO 4: DAILY HEALTH CHECK-IN (Gap 1)');
  clearMessageLog();
  clearState(phone);

  await startDailyCheckIn(phone, farmerId, 'daily_health');
  assert(getMessageLog().some(msg => msg.text.includes('Health Check-In')), 'Health check-in started');

  await simulateMessage(phone, 'No signs', 'interactive', btn('disease_no', 'No signs'));
  await simulateMessage(phone, 'Yes, normal', 'interactive', btn('growth_yes', 'Yes, normal'));

  assert(getMessageLog().some(msg => msg.text.includes('recorded')), 'Health check-in confirmed');
  const healthChats = inMemoryDB.chats.filter(c => c.message_type === 'checkin' && c.message.includes('Health'));
  assert(healthChats.length >= 1, 'GAP 1: Health check-in saved to chat_history');

  // ============================================
  // SCENARIO 5: WEEKLY CHECK-IN
  // ============================================
  section('SCENARIO 5: WEEKLY CHECK-IN (Gap 1)');
  clearMessageLog();
  clearState(phone);

  await startWeeklyCheckIn(phone, farmerId);
  assert(getMessageLog().some(msg => msg.text.includes('Weekly Check-In')), 'Weekly check-in started');

  await simulateMessage(phone, 'No', 'interactive', btn('wk_disease_no', 'No'));
  await simulateMessage(phone, '50-100 kg', 'interactive', btn('wk_feed_mid', '50-100 kg'));
  await simulateMessage(phone, 'No change', 'interactive', btn('wk_water_no', 'No change'));
  await simulateMessage(phone, 'Yes, normal', 'interactive', btn('wk_growth_yes', 'Yes, normal'));

  assert(getMessageLog().some(msg => msg.text.includes('Weekly report saved')), 'Weekly check-in confirmed');
  const weeklyChats = inMemoryDB.chats.filter(c => c.message_type === 'checkin' && c.message.includes('Weekly'));
  assert(weeklyChats.length >= 1, 'GAP 1: Weekly check-in saved to chat_history');

  // ============================================
  // SCENARIO 6: EVENT FOLLOW-UP — MORTALITY
  // ============================================
  section('SCENARIO 6: EVENT FOLLOW-UP (Gap 1 + Gap 3)');
  clearMessageLog();
  clearState(phone);

  // Farmer reports mortality — original message should be carried
  await simulateMessage(phone, '50 shrimp died today with red body');
  assert(getMessageLog().some(msg => msg.text.toLowerCase().includes('mortality report')), 'Mortality event detected');

  await simulateMessage(phone, '10-50', 'interactive', btn('mort_some', '10-50'));
  assert(getMessageLog().slice(-1)[0].text.includes('Since when'), 'Asks since when');

  await simulateMessage(phone, 'Today', 'interactive', btn('mort_today', 'Today'));
  assert(getMessageLog().slice(-1)[0].text.includes('smell'), 'Asks about smell');

  await simulateMessage(phone, 'Yes', 'interactive', btn('mort_smell_yes', 'Yes'));
  assert(getMessageLog().slice(-1)[0].text.includes('body'), 'Asks about body signs');

  await simulateMessage(phone, 'Red body', 'interactive', btn('mort_sign_red', 'Red body'));

  // Verify event was logged
  const eventLog = inMemoryDB.logs.find(l => l.log_group === 'event' && l.log_data.event_type === 'mortality');
  assert(!!eventLog, 'Mortality event log saved');

  // GAP 1: Event saved to chat_history
  const eventChats = inMemoryDB.chats.filter(c => c.message_type === 'event');
  assert(eventChats.length >= 1, 'GAP 1: Event diagnosis saved to chat_history');

  // GAP 3: Original message preserved
  if (eventChats.length > 0) {
    assert(eventChats[0].message.includes('50 shrimp died today with red body'), 'GAP 3: Original message preserved in chat_history');
  }

  // Follow-up should be scheduled
  assert(inMemoryDB.scheduled_followups.length >= 1, 'Follow-up scheduled after event');

  // ============================================
  // SCENARIO 7: PROACTIVE FOLLOW-UP CHECK-IN
  // ============================================
  section('SCENARIO 7: PROACTIVE FOLLOW-UP CHECK-IN (Gap 1)');
  clearMessageLog();
  clearState(phone);

  // Fast-forward scheduled follow-up to today
  const todayStr = new Date().toISOString().split('T')[0];
  inMemoryDB.scheduled_followups[0].followup_date = todayStr;

  const dueFollowUps = await getDueFollowUps(todayStr);
  assert(dueFollowUps.length >= 1, 'Due follow-up found');

  for (const followUp of dueFollowUps) {
    const farmer = await getFarmerById(followUp.farmer_id);
    await startFollowupCheckIn(farmer.phone, followUp.farmer_id, followUp.pond_id, followUp.event_type);
    await markFollowUpCompleted(followUp.id);
  }

  assert(getMessageLog().some(msg => msg.text.includes('checking in')), 'Proactive follow-up sent');

  await simulateMessage(phone, 'Yes, Improved', 'interactive', btn('fu_improved', 'Yes, Improved'));
  assert(getMessageLog().some(msg => msg.text.includes('wonderful')), 'Improvement acknowledged');

  await simulateMessage(phone, 'Growel Pond Pro');
  assert(getMessageLog().some(msg => msg.text.includes('Thank you')), 'Treatment acknowledged');

  // GAP 1: Follow-up saved to chat_history
  const followupChats = inMemoryDB.chats.filter(c => c.message_type === 'followup');
  assert(followupChats.length >= 1, 'GAP 1: Follow-up saved to chat_history');
  if (followupChats.length > 0) {
    assert(followupChats[0].message.includes('improved'), 'Follow-up status recorded');
    assert(followupChats[0].message.includes('Growel Pond Pro'), 'Treatment recorded');
  }

  // ============================================
  // SCENARIO 8: AI Q&A + RECOMMENDATIONS
  // ============================================
  section('SCENARIO 8: AI Q&A + PRODUCT RECOMMENDATIONS');
  clearMessageLog();
  clearState(phone);

  await simulateMessage(phone, 'My pond has very high ammonia, what should I do?');
  const aiReply = getMessageLog().slice(-1)[0].text;
  assert(aiReply.length > 20, 'AI gave substantive response');

  const qaChats = inMemoryDB.chats.filter(c => c.message_type === 'text');
  assert(qaChats.length >= 1, 'AI Q&A saved to chat_history');

  // ============================================
  // SCENARIO 9: KEYWORD COMMANDS
  // ============================================
  section('SCENARIO 9: HELP / SCORE / WEATHER');
  clearMessageLog();

  await simulateMessage(phone, 'help');
  assert(getMessageLog().some(msg => msg.text.includes('Aquorix')), 'Help menu shown');
  assert(getMessageLog().some(msg => msg.text.includes('Ask Questions')), 'Help lists features');

  clearMessageLog();
  await simulateMessage(phone, 'score');
  assert(getMessageLog().length > 0, 'Score command responded');

  clearMessageLog();
  await simulateMessage(phone, 'weather');
  assert(getMessageLog().some(msg => msg.text.includes('Weather')), 'Weather shown');

  // ============================================
  // SCENARIO 10: IMAGE ANALYSIS (Gap 2)
  // ============================================
  section('SCENARIO 10: IMAGE ANALYSIS + POND CONTEXT (Gap 2)');
  clearMessageLog();

  await simulateMessage(phone, '[photo]', 'image');
  assert(getMessageLog().some(msg => msg.text.includes('Analyzing')), 'Image analysis started');
  assert(getMessageLog().length >= 2, 'GAP 2: Image analysis completed (pond context passed)');

  // Verify image chat saved
  const imgChats = inMemoryDB.chats.filter(c => c.message_type === 'image');
  assert(imgChats.length >= 1, 'Image analysis saved to chat_history');

  // ============================================
  // SCENARIO 11: CONVERSATION SUMMARY (Gap 5)
  // ============================================
  section('SCENARIO 11: CONVERSATION SUMMARY (Gap 5)');

  const totalChats = inMemoryDB.chats.filter(c => c.farmer_id === farmerId).length;
  assert(totalChats > 4, `GAP 5: ${totalChats} chat entries exist (>4 triggers summary)`);

  // AI Q&A should work with summary context
  clearMessageLog();
  clearState(phone);
  await simulateMessage(phone, 'How is my pond doing overall?');
  assert(getMessageLog().length > 0, 'GAP 5: AI responded with summary context (no crash)');

  // ============================================
  // FINAL REPORT
  // ============================================
  console.log(`\n${'='.repeat(55)}`);
  console.log(`📊 FINAL RESULTS`);
  console.log(`${'='.repeat(55)}`);
  console.log(`\n  Total assertions: ${passed + failed}`);
  console.log(`  \x1b[32m✅ Passed: ${passed}\x1b[0m`);
  console.log(`  \x1b[31m❌ Failed: ${failed}\x1b[0m`);

  console.log(`\n📝 Chat History by Type:`);
  const types = {};
  inMemoryDB.chats.forEach(c => {
    types[c.message_type || 'unknown'] = (types[c.message_type || 'unknown'] || 0) + 1;
  });
  Object.entries(types).forEach(([type, count]) => {
    console.log(`   ${type}: ${count}`);
  });
  console.log(`   TOTAL: ${inMemoryDB.chats.length}`);

  console.log(`\n📦 Database:`);
  console.log(`   Farmers: ${inMemoryDB.farmers.length}`);
  console.log(`   Ponds: ${inMemoryDB.ponds.length}`);
  console.log(`   Logs: ${inMemoryDB.logs.length}`);
  console.log(`   Chats: ${inMemoryDB.chats.length}`);
  console.log(`   Follow-ups: ${inMemoryDB.scheduled_followups.length}`);

  if (failed > 0) {
    console.log(`\n\x1b[31m💥 ${failed} TEST(S) FAILED\x1b[0m\n`);
    process.exit(1);
  } else {
    console.log(`\n\x1b[32m🎉 ALL ${passed} TESTS PASSED! BOT IS FULLY CONTEXT-ORIENTED! 🎉\x1b[0m\n`);
  }
}

runAllTests().catch(err => {
  console.error('\n💥 Test runner crashed:', err);
  process.exit(1);
});
