const { getFeedPlan } = require('../src/services/feedPlan');
const { createFarmer, createPond, insertPondLog } = require('../src/models/database');

async function testScenario() {
  console.log('🧪 TESTING FEED PLAN SCENARIO');
  console.log('Target: 100 count (10g) | 45 Days | 100k Stock\n');

  // 1. Setup Mock
  const farmer = await createFarmer({ phone: '910000000001', preferred_language: 'English', onboarding_complete: true });
  const pond = await createPond({ 
    farmer_id: farmer.id, 
    pond_number: 1, 
    species: 'vannamei', 
    seed_count: 100000, 
    stocking_date: '1_2_months' // Maps to 45 Days
  });

  // 2. Run Plan
  const plan = await getFeedPlan(farmer.id, 'English');

  if (plan && plan.type === 'success') {
    console.log(plan.message);
    
    // Log internal data for analysis
    const { dailyFeedKg, biomassKg, abw, survival } = plan.data;
    console.log('\n--- Internal Analysis ---');
    console.log(`Estimated ABW: ${abw.toFixed(1)}g`);
    console.log(`Estimated Survival: ${(survival * 100).toFixed(0)}%`);
    console.log(`Estimated Biomass: ${biomassKg.toFixed(0)} kg`);
    console.log(`Total Feed: ${dailyFeedKg.toFixed(1)} kg`);
    console.log(`Feed Rate used: ${((dailyFeedKg / biomassKg) * 100).toFixed(2)}%`);
  } else {
    console.error('❌ Plan failed:', plan?.message);
  }
}

testScenario().catch(console.error);
