require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { generateEmbedding } = require('../src/services/ai');
const { insertKnowledgeEmbedding, clearKnowledgeBase } = require('../src/models/database');

const KNOWLEDGE_DIR = path.join(__dirname, '../knowledge');

/**
 * Chunks text by double newlines (paragraphs/sections)
 */
function chunkText(text) {
  // Split by double newline to separate paragraphs/sections
  const paragraphs = text.split(/\n\s*\n/);
  const chunks = [];
  
  // Basic chunking: group small paragraphs, split large ones
  let currentChunk = '';
  
  for (const p of paragraphs) {
    const trimmed = p.trim();
    if (!trimmed) continue;

    // If chunk > 1000 characters, push the current one and start fresh
    if (currentChunk.length + trimmed.length > 1000) {
      if (currentChunk) chunks.push(currentChunk.trim());
      currentChunk = trimmed;
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + trimmed;
    }
  }
  
  if (currentChunk) chunks.push(currentChunk.trim());
  
  return chunks;
}

async function seedKnowledge() {
  console.log('🌱 Starting knowledge seeding...');

  try {
    await clearKnowledgeBase();
    const files = fs.readdirSync(KNOWLEDGE_DIR).filter(f => f.endsWith('.md'));

    if (files.length === 0) {
      console.log('⚠️ No markdown files found in the knowledge directory.');
      return;
    }

    let totalChunks = 0;

    for (const file of files) {
      console.log(`\n📄 Processing ${file}...`);
      const filePath = path.join(KNOWLEDGE_DIR, file);
      const content = fs.readFileSync(filePath, 'utf-8');

      const chunks = chunkText(content);
      console.log(`   Split into ${chunks.length} chunks.`);

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        
        // Generate embedding
        process.stdout.write(`   Embedding chunk ${i + 1}/${chunks.length}... `);
        const embedding = await generateEmbedding(chunk);
        
        if (!embedding) {
          process.stdout.write(`❌ Failed (Skipped)\n`);
          continue;
        }

        // Save to DB
        await insertKnowledgeEmbedding(chunk, embedding, { source_file: file, chunk_index: i });
        process.stdout.write(`✅ Saved\n`);
        
        totalChunks++;
        
        // Slight delay to avoid hitting Gemini API rate limits (15 RPM for free tier)
        await new Promise(resolve => setTimeout(resolve, 15000));
      }
    }

    console.log(`\n🎉 Seeding complete! Added ${totalChunks} knowledge articles to Supabase.`);
    process.exit(0);

  } catch (err) {
    console.error('\n❌ Seeding failed:', err.message);
    process.exit(1);
  }
}

seedKnowledge();
