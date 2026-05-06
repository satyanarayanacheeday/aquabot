/**
 * 🤖 Aquabot Manual Test Agent — Perfect Flow Simulation
 */

const { handleTextMessage } = require('../src/controllers/webhookController');
const { clearState, getState } = require('../src/state/conversationState');

const TEST_PHONE = '9876543210';

async function runScenario(name, inputs) {
  console.log(`\n🚀 SCENARIO: ${name}`);
  console.log('='.repeat(50));
  
  clearState(TEST_PHONE);

  for (const input of inputs) {
    console.log(`👤 User: "${input}"`);
    await handleTextMessage(TEST_PHONE, input);
    const state = getState(TEST_PHONE);
    console.log(`🤖 State: ${state ? state.flow + ' (Step ' + state.step + ')' : 'Idle'}`);
    console.log('-'.repeat(30));
  }
}

async function startTesting() {
  // Scenario: Full Onboarding -> Knowledge Question -> Problem Report -> Cancellation
  await runScenario('End-to-End Success & Exit', [
    'Hi',           // Start Onboarding
    'English',      // Select Language
    'Shrimp',       // Select Species
    'Nellore',      // Village
    '1-3 acres',    // Pond Size
    'Disease',      // Interest
    'What is WSSV?', // Knowledge Question (Should work since onboarded)
    'I have many dead shrimp', // Report mortality (Start Event Flow)
    'Stop'          // EMERGENCY EXIT
  ]);

  console.log('\n✅ All simulation scenarios completed.');
}

// Ensure clean farmer profile
async function ensureFarmer() {
  const { getFarmerByPhone, createFarmer, updateFarmer } = require('../src/models/database');
  let farmer = await getFarmerByPhone(TEST_PHONE);
  if (!farmer) {
    farmer = await createFarmer({ phone: TEST_PHONE });
  }
  await updateFarmer(farmer.id, { onboarding_complete: false });
}

ensureFarmer().then(() => startTesting());
