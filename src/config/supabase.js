const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

let supabase;

if (supabaseUrl && supabaseKey) {
  supabase = createClient(supabaseUrl, supabaseKey);
  console.log('✅ Supabase client initialized');
} else {
  console.warn('⚠️  SUPABASE_URL or SUPABASE_KEY not set. Database operations will fail.');
  console.warn('   Copy .env.example to .env and fill in your credentials.');
  // Create a proxy that throws helpful errors
  supabase = new Proxy({}, {
    get: () => () => {
      throw new Error('Supabase not configured. Set SUPABASE_URL and SUPABASE_KEY in .env');
    },
  });
}

module.exports = supabase;
