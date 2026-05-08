require('dotenv').config({ path: './.env' });
const { createFarmer, hasPendingDailyCheckIn, scheduleFollowUp, markPendingCheckInsCompleted } = require('../src/models/database');
const { v4: uuidv4 } = require('uuid');

async function test() {
  const phone = 'test_' + Date.now();
  console.log(`Creating farmer with phone ${phone}...`);
  const farmer = await createFarmer({ phone, preferred_language: 'English', onboarding_complete: true });
  console.log('Farmer created:', farmer.id);
  
  let pending = await hasPendingDailyCheckIn(farmer.id);
  console.log('1. Initial pending status:', pending);
  
  console.log('2. Scheduling check-in...');
  await scheduleFollowUp(farmer.id, null, 'daily_checkin', new Date().toISOString());
  
  pending = await hasPendingDailyCheckIn(farmer.id);
  console.log('3. Pending status after schedule:', pending);
  
  console.log('4. Completing check-in...');
  await markPendingCheckInsCompleted(farmer.id);
  
  pending = await hasPendingDailyCheckIn(farmer.id);
  console.log('5. Pending status after complete:', pending);
}

test().catch(console.error);
