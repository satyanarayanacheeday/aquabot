require('dotenv').config({ path: './.env' });
const { searchKnowledge } = require('../src/models/database');
const { generateEmbedding } = require('../src/services/ai');

async function testSearch() {
  const query = "What should I do if my shrimp have white feces?";
  console.log("Generating embedding for query...");
  const embedding = await generateEmbedding(query);
  
  if (!embedding) {
    console.log("Failed to generate embedding.");
    return;
  }
  
  console.log("Searching knowledge base...");
  try {
    const matches = await searchKnowledge(embedding, 3, 0.4);
    console.log(`Found ${matches.length} matches.`);
    matches.forEach((m, i) => {
      console.log(`\nMatch ${i+1} (similarity: ${m.similarity}):`);
      console.log(m.content.substring(0, 200) + "...");
    });
  } catch (e) {
    console.error("Search failed:", e);
  }
}

testSearch();
