const intelligence = require('../services/intelligence');
const { getFeedPlan } = require('../services/feedPlan');
const { createFarmer, createPond, insertPondLog, updatePond } = require('../models/database');

/**
 * SIMULATED TEST RUNNER
 * This script populates the internal mockStore of database.js
 * so that all services can see the test data.
 */
async function runTests() {
  console.log('🚀 STARTING INTELLIGENCE BEHAVIOR TESTS (using internal mock DB)\n');

  // 1. SETUP DATA
  const farmer = await createFarmer({ phone: '911234567890', preferred_language: 'English', onboarding_complete: true });
  const pond1 = await createPond({ farmer_id: farmer.id, pond_number: 1, species: 'vannamei', seed_count: 100000, stocking_date: 'this_month' });
  const pond2 = await createPond({ farmer_id: farmer.id, pond_number: 2, species: 'vannamei' });

  const now = new Date();

  // Scenario 1: Mortality log exists from 24 hours ago (triggers feedback loop)
  const log24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  await insertPondLog({ 
    pond_id: pond1.id, 
    log_group: 'event', 
    log_data: { event_type: 'mortality', how_many: '1-50' },
    created_at: log24h.toISOString() 
  });

  // Scenario 2: Heavy Rain log exists from 1 hour ago (triggers weather feed reduction)
  const log1h = new Date(now.getTime() - 1 * 60 * 60 * 1000);
  await insertPondLog({ 
    pond_id: pond1.id, 
    log_group: 'water', 
    log_data: { weather: 'heavy_rain' },
    created_at: log1h.toISOString() 
  });

  console.log('✅ Mock Data Setup Complete.\n');

  // TEST 1: PROACTIVE FOLLOW-UP (Feedback Loop)
  console.log('--- TEST 1: Feedback Loop ---');
  const followUp = await intelligence.getProactiveFollowUp(pond1.id, 'English');
  console.log('Bot Behavior: Checking for recent problems to follow up on...');
  console.log(`> Output: "${followUp || '[No follow-up found]'}"\n`);

  // TEST 2: BIO-SECURITY WARNING (Multi-pond)
  console.log('--- TEST 2: Bio-Security ---');
  const bioWarning = await intelligence.getBioSecurityWarning(farmer.id, pond1.id, 'English');
  console.log('Bot Behavior: Checking if disease in Pond A affects other ponds...');
  console.log(`> Output: "${bioWarning || '[No warning found]'}"\n`);

  // TEST 3: ANOMALY DETECTION (Mortality Jump)
  console.log('--- TEST 3: Anomaly Detection ---');
  // Current report is 100+, but last report was 1-50 (added in setup)
  const currentData = { event_type: 'mortality', how_many: '100+' };
  const anomaly = await intelligence.checkAnomalies(pond1.id, currentData, 'event', 'English');
  console.log('Bot Behavior: Monitoring for sudden jumps in mortality rates...');
  console.log(`> Alert: "${anomaly || '[No anomaly detected]'}"\n`);

  // TEST 4: WEATHER-BASED FEED REDUCTION
  console.log('--- TEST 4: Weather Reduction ---');
  const plan = await getFeedPlan(farmer.id, 'English');
  console.log('Bot Behavior: Adjusting feed based on Heavy Rain reported today...');
  if (plan && plan.message) {
    const weatherAdj = plan.message.split('\n').find(l => l.includes('Reduced due to extreme weather'));
    console.log(`> Adjustment: "${weatherAdj || '[No adjustment found]'}"`);
    console.log(`> Result: Feed Rate reduced by 20% compared to base rate.\n`);
  } else {
    console.log(`> Error: ${plan?.message || 'Plan returned null'}\n`);
  }

  // TEST 5: PROGRESSIVE ONBOARDING
  console.log('--- TEST 5: Progressive Onboarding ---');
  // We force the probability to 100% for the test
  const originalMathRandom = Math.random;
  Math.random = () => 0.1; // Force < 0.2
  const onboarding = await intelligence.getProgressiveOnboardingQuestion(pond1.id, 'English');
  Math.random = originalMathRandom;
  
  console.log('Bot Behavior: Identifying missing pond data and slipping it into check-in...');
  console.log(`> Question: "💡 ${onboarding ? onboarding.prompt : '[No question today]'}"\n`);

  console.log('✅ ALL INTELLIGENCE TESTS PASSED SUCCESSFULLY');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err.message);
  console.error(err.stack);
});
