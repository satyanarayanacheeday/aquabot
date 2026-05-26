/**
 * Test JIT Specific Species Collection
 */

const { getMessageLog, clearMessageLog, inMemoryDB } = require('./test_framework');
const webhookController = require('../src/controllers/webhookController');
const { getFarmerByPhone, createFarmer, createPond, getFirstPondByFarmer } = require('../src/models/database');

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
  console.log('🧪 Testing JIT Specific Species Collection Flow...\n');

  // ==========================================
  // SCENARIO 1: Shrimp Farmer JIT Prompt
  // ==========================================
  console.log('--- Scenario 1: Shrimp Farmer triggers Disease ---');
  const phone1 = '919000000001';
  
  // Create onboarding-completed farmer + pond with default_shrimp
  const farmer1 = await createFarmer({ phone: phone1, onboarding_complete: true });
  await createPond({ farmer_id: farmer1.id, pond_number: 1, species: 'default_shrimp' });

  clearMessageLog();

  // Farmer triggers topic selection (clicks "Disease" from menu)
  await simulateMessage(phone1, 'prob_disease');

  let logs = getMessageLog();
  assert(logs.length > 0, "Bot should reply");
  assert(logs[0].text.includes('Which shrimp species'), "Should prompt for shrimp species choice");
  assert(logs[0].text.includes('Vannamei') && logs[0].text.includes('Tiger'), "Should show Vannamei & Tiger buttons");

  // Farmer clicks Vannamei
  await simulateMessage(phone1, 'Vannamei', 'interactive', { button_reply: { id: 'spec_vannamei', title: 'Vannamei' } });

  const pond1 = await getFirstPondByFarmer(farmer1.id);
  assert(pond1.species === 'vannamei', "Pond species should update to 'vannamei' in DB");

  logs = getMessageLog();
  assert(logs.some(m => m.text.includes('Disease Investigation')), "Should automatically resume to original Disease flow");
  assert(logs.slice(-1)[0].text.includes('What symptoms'), "Should ask first disease symptom question");

  console.log('✅ Scenario 1: Passed!\n');

  // ==========================================
  // SCENARIO 2: Fish Farmer JIT Prompt
  // ==========================================
  console.log('--- Scenario 2: Fish Farmer triggers Disease ---');
  const phone2 = '919000000002';
  
  const farmer2 = await createFarmer({ phone: phone2, onboarding_complete: true });
  await createPond({ farmer_id: farmer2.id, pond_number: 1, species: 'default_fish' });

  clearMessageLog();

  // Farmer sends text that triggers event flow
  await simulateMessage(phone2, 'some fish are sick');

  logs = getMessageLog();
  assert(logs[0].text.includes('Which fish species'), "Should prompt for fish species choice");
  assert(logs[0].text.includes('Tilapia') && logs[0].text.includes('Rohu'), "Should list fish options");

  // Farmer selects Tilapia
  await simulateMessage(phone2, 'Tilapia', 'interactive', { list_reply: { id: 'spec_tilapia', title: 'Tilapia' } });

  const pond2 = await getFirstPondByFarmer(farmer2.id);
  assert(pond2.species === 'tilapia', "Pond species should update to 'tilapia' in DB");

  logs = getMessageLog();
  assert(logs.some(m => m.text.includes('Disease Investigation')), "Should resume to Disease flow");
  console.log('✅ Scenario 2: Passed!\n');

  // ==========================================
  // SCENARIO 3: Both (Mixed) Farmer JIT Prompt
  // ==========================================
  console.log('--- Scenario 3: Mixed Farmer triggers Disease ---');
  const phone3 = '919000000003';
  
  const farmer3 = await createFarmer({ phone: phone3, onboarding_complete: true });
  await createPond({ farmer_id: farmer3.id, pond_number: 1, species: 'default_both' });

  clearMessageLog();

  // Farmer clicks Disease
  await simulateMessage(phone3, 'prob_disease');

  logs = getMessageLog();
  assert(logs[0].text.includes('Which species is this issue about'), "Should prompt for mixed species choice");
  assert(logs[0].text.includes('Vannamei') && logs[0].text.includes('Tilapia'), "Should show both lists");

  // Farmer selects Tiger Shrimp
  await simulateMessage(phone3, 'Tiger Shrimp', 'interactive', { list_reply: { id: 'spec_monodon', title: 'Tiger Shrimp' } });

  const pond3 = await getFirstPondByFarmer(farmer3.id);
  assert(pond3.species === 'monodon', "Pond species should update to 'monodon' in DB");

  logs = getMessageLog();
  assert(logs.some(m => m.text.includes('Disease Investigation')), "Should resume to Disease flow");
  console.log('✅ Scenario 3: Passed!\n');

  console.log('🎉 ALL JIT BOT TESTS PASSED SUCCESSFULLY! 🎉');
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
