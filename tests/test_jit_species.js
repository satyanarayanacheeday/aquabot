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

  // ==========================================
  // SCENARIO 4: Simplified Onboarding Check
  // ==========================================
  console.log('--- Scenario 4: Verify simplified onboarding (Language + Species only) ---');
  const phone4 = '919000000004';
  clearMessageLog();

  // 1. Farmer says hi -> asks for language
  await simulateMessage(phone4, 'Hi');
  assert(getMessageLog().slice(-1)[0].text.includes('Welcome to *aquaIQ*'), "Should welcome farmer");
  assert(getMessageLog().slice(-1)[0].text.includes('English'), "Should ask for language");

  // 2. Select language -> asks for species/farm type immediately (skipping village)
  await simulateMessage(phone4, 'English', 'interactive', { button_reply: { id: 'lang_en', title: 'English' }});
  assert(getMessageLog().slice(-1)[0].text.includes('What species are you growing'), "Should ask what species they farm immediately");

  // 3. Select farm type -> completes onboarding
  await simulateMessage(phone4, 'Shrimp', 'interactive', { button_reply: { id: 'farm_shrimp', title: 'Shrimp' }});
  assert(getMessageLog().some(m => m.text.includes('Registration Successful')), "Should complete onboarding");

  const farmer4 = await getFarmerByPhone(phone4);
  assert(farmer4.onboarding_complete === true, "Farmer should be onboarded");
  assert(farmer4.village === null, "Farmer village should be null initially");

  const pond4 = await getFirstPondByFarmer(farmer4.id);
  assert(pond4.species === 'default_shrimp', "Pond species should start as default_shrimp placeholder");
  console.log('✅ Scenario 4: Passed!\n');

  // ==========================================
  // SCENARIO 5: JIT Village Collection (Post-Success)
  // ==========================================
  console.log('--- Scenario 5: JIT Village prompt triggers after diagnostic flow completes ---');
  const phone5 = '919000000005';
  clearMessageLog();

  // Create farmer with onboarding_complete: true and village: null, pond with specific species (so we don't trigger species JIT)
  const farmer5 = await createFarmer({ phone: phone5, onboarding_complete: true, village: null });
  await createPond({ farmer_id: farmer5.id, pond_number: 1, species: 'vannamei' });

  // Farmer triggers disease event
  await simulateMessage(phone5, 'my shrimp are sick');
  
  // Answer Q1: Symptoms
  await simulateMessage(phone5, 'White spots', 'interactive', { list_reply: { id: 'dis_spots', title: 'White spots' } });
  // Answer Q2: Affected
  await simulateMessage(phone5, 'A few', 'interactive', { button_reply: { id: 'dis_few', title: 'A few' } });

  // Diagnostic flow should finalize, show assessment, and then prompt for village
  logs = getMessageLog();
  assert(logs.some(m => m.text.includes('Assessment')), "Should show final diagnostic assessment");
  assert(logs.slice(-1)[0].text.includes('which village or town is your farm located in'), "Should ask for village after diagnosis");

  // Farmer enters village
  await simulateMessage(phone5, 'Bhimavaram');
  
  const farmer5Updated = await getFarmerByPhone(phone5);
  assert(farmer5Updated.village === 'Bhimavaram', "Farmer village should update to Bhimavaram in DB");
  
  logs = getMessageLog();
  assert(logs.slice(-1)[0].text.includes('updated your farm location to *Bhimavaram*'), "Should confirm village registration");
  console.log('✅ Scenario 5: Passed!\n');

  // ==========================================
  // SCENARIO 6: JIT Seed Count (Initial Count)
  // ==========================================
  console.log('--- Scenario 6: JIT Seed Count prompt triggers during Feed Plan flow ---');
  const phone6 = '919000000006';
  clearMessageLog();

  // Onboarded farmer, species is set, stocking date is set, but seed_count is null
  const farmer6 = await createFarmer({ phone: phone6, onboarding_complete: true });
  await createPond({ farmer_id: farmer6.id, pond_number: 1, species: 'vannamei', stocking_date: '2026-05-10', seed_count: null });

  // Farmer asks for feed
  await simulateMessage(phone6, 'Feed entha evvali');

  logs = getMessageLog();
  assert(logs[0].text.includes('How many seeds did you stock'), "Should ask for initial stocking/seed count");

  // Farmer enters seed count
  await simulateMessage(phone6, '150,000');

  const pond6 = await getFirstPondByFarmer(farmer6.id);
  assert(pond6.seed_count === 150000, "Pond seed count should update in DB");

  logs = getMessageLog();
  assert(logs.slice(-1)[0].text.includes('current shrimp count'), "Should automatically proceed to ask current count (ABW)");
  console.log('✅ Scenario 6: Passed!\n');

  // ==========================================
  // SCENARIO 7: General AI Q&A JIT Collection
  // ==========================================
  console.log('--- Scenario 7: General AI Q&A triggers sequential JIT context collection ---');
  const phone7 = '919000000007';
  clearMessageLog();

  // Create onboarded farmer, species is default placeholder, stocking_date/seed_count/pond_size are null
  const farmer7 = await createFarmer({ phone: phone7, onboarding_complete: true, preferred_language: 'English' });
  await createPond({ 
    farmer_id: farmer7.id, 
    pond_number: 1, 
    species: 'default_shrimp', 
    stocking_date: null, 
    seed_count: null, 
    pond_size: null 
  });

  // Farmer asks a general Q&A / RAG question
  await simulateMessage(phone7, 'what is the best water pH for shrimp?');

  logs = getMessageLog();
  // 1. Should first intercept and ask for species
  assert(logs[0].text.includes('Which shrimp species'), "Should ask for specific species first");

  // Select species Vannamei
  await simulateMessage(phone7, 'Vannamei', 'interactive', { button_reply: { id: 'spec_vannamei', title: 'Vannamei' } });

  // 2. Should automatically ask for stocking date next
  logs = getMessageLog();
  assert(logs.slice(-1)[0].text.includes('Stocking Date'), "Should ask for Stocking Date next");

  // Enter stocking date
  await simulateMessage(phone7, '10/05/2026');

  // 3. Should automatically ask for seed count next
  logs = getMessageLog();
  assert(logs.slice(-1)[0].text.includes('How many seeds'), "Should ask for Seed Count next");

  // Enter seed count
  await simulateMessage(phone7, '200,000');

  // 4. Should automatically ask for pond size next
  logs = getMessageLog();
  assert(logs.slice(-1)[0].text.includes('pond size'), "Should ask for Pond Size next");

  // Enter pond size
  await simulateMessage(phone7, '1-3 acres', 'interactive', { button_reply: { id: 'jit_size_m', title: '1-3 acres' } });

  // 5. Once all details are filled, the bot must automatically call AI Q&A to answer the original question
  logs = getMessageLog();
  assert(logs.slice(-1)[0].text.includes('mocked AI response'), "Should automatically answer the original question with RAG");
  console.log('✅ Scenario 7: Passed!\n');

  console.log('🎉 ALL JIT BOT TESTS PASSED SUCCESSFULLY! 🎉');
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});

