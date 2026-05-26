const { parseUserCount } = require('../src/services/feedPlan');

const testCases = [
  { input: '100 count', expected: 10 },
  { input: '60', expected: 16.66 }, // 1000/60
  { input: '15g', expected: 15 },
  { input: '10', expected: 10 },
  { input: 'I have 80 count', expected: 12.5 },
  { input: 'size is 12 grams', expected: 12 }
];

console.log('🧪 Testing Count Parser:');
testCases.forEach(tc => {
  const result = parseUserCount(tc.input);
  console.log(`Input: "${tc.input}" -> Result: ${result?.toFixed(2)}g (Expected: ~${tc.expected}g)`);
});
