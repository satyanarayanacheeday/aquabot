require('dotenv').config({ path: './.env' });
const supabase = require('../src/config/supabase');

async function test() {
  const { data, error } = await supabase.from('scheduled_followups').insert({
    farmer_id: 'd9b9a650-71a0-47b1-b9cd-90f779774681', // some valid UUID
    pond_id: null,
    event_type: 'daily_checkin',
    followup_date: new Date().toISOString(),
    status: 'pending'
  }).select();
  console.log('Error:', error);
}
test();
