/**
 * Test Recommendation Engine
 */

const productEngine = require('../src/services/productEngine');
const { detectEventType } = require('../src/services/eventFollowUp');

console.log('🧪 Testing Aquabot Recommendation Engine\n');

// 1. Test Pond Size Calculation
console.log('--- Pond Size Mapping ---');
const sizes = ['less_than_1_acre', '1_3_acres', 'more_than_3_acres'];
sizes.forEach(s => {
  console.log(`${s} -> ${productEngine.getPondSizeValue(s)} acres`);
});

// 2. Test Water Quality Recommendation (Derived Logic)
console.log('\n--- Scenario: Dark Water + Strong Smell ---');
const pondSizeValue = productEngine.getPondSizeValue('1_3_acres');
const waterRec = productEngine.getRecommendation('ammonia', { pondSizeValue });
console.log(productEngine.formatRecommendation(waterRec));

// 3. Test Slow Growth Recommendation (Cross-day Logic)
console.log('\n--- Scenario: Slow Growth + High Feeding ---');
const growthRec = productEngine.getRecommendation('slow_growth', { pondSizeValue });
console.log(productEngine.formatRecommendation(growthRec));

// 4. Test Disease Recommendation (Event Flow)
console.log('\n--- Scenario: White Spots (Emergency) ---');
const wssvRec = productEngine.getRecommendation('wssv_emergency', { pondSizeValue });
console.log(productEngine.formatRecommendation(wssvRec));

// 5. Test Event Detection
console.log('\n--- Event Detection ---');
const messages = [
  "Many shrimp are dead today",
  "they are not growing well",
  "white spot signs on body"
];
messages.forEach(m => {
  console.log(`"${m}" -> Detected: ${detectEventType(m)}`);
});
