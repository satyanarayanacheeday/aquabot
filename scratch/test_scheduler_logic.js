require('dotenv').config({ path: './.env' });
const { hasPendingDailyCheckIn, markPendingCheckInsCompleted, scheduleFollowUp } = require('../src/models/database');

async function testSchedulerLogic() {
  const farmerId = 'test_farmer_123';
  console.log('1. Checking pending status...');
  let pending = await hasPendingDailyCheckIn(farmerId);
  console.log(`Pending: ${pending}`);
  
  if (!pending) {
    console.log('2. Scheduling a new check-in...');
    await scheduleFollowUp(farmerId, null, 'daily_checkin', new Date().toISOString());
    pending = await hasPendingDailyCheckIn(farmerId);
    console.log(`Pending after schedule: ${pending}`);
  }
  
  console.log('3. Simulating farmer completing the check-in...');
  await markPendingCheckInsCompleted(farmerId);
  
  pending = await hasPendingDailyCheckIn(farmerId);
  console.log(`Pending after completion: ${pending}`);
}

testSchedulerLogic();
