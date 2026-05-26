const { getRecommendations } = require('./src/services/recommendation');

console.log('--- Test 1: White Gut ---');
console.log(getRecommendations('My shrimp have white gut and slow growth', { species: 'vannamei' }));

console.log('--- Test 2: High Ammonia ---');
console.log(getRecommendations('Pond has very high ammonia and bad smell', { species: 'monodon' }));

console.log('--- Test 3: Low FCR ---');
console.log(getRecommendations('The FCR is very low and they are eating too much', { species: 'vannamei' }));
