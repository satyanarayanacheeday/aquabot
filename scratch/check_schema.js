require('dotenv').config({ path: './.env' });
const supabase = require('../src/config/supabase');

async function test() {
  const { data, error } = await supabase.from('farmers').select('*').limit(1);
  if (error) console.error(error);
  else console.log(Object.keys(data[0] || {}));
}
test();
