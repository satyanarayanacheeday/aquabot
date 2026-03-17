-- ============================================================
-- Aquorix MVP — Database Schema
-- Run this in your Supabase SQL Editor to set up all tables
-- ============================================================

-- Enable pgvector extension for RAG embeddings
CREATE EXTENSION IF NOT EXISTS vector;

-- ========================
-- FARMERS TABLE
-- ========================
CREATE TABLE IF NOT EXISTS farmers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT,
  phone TEXT UNIQUE NOT NULL,
  location TEXT,
  preferred_language TEXT DEFAULT 'English',
  registration_complete BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ========================
-- FARMS TABLE
-- ========================
CREATE TABLE IF NOT EXISTS farms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farmer_id UUID REFERENCES farmers(id) ON DELETE CASCADE,
  pond_size TEXT,
  number_of_ponds INTEGER DEFAULT 1,
  species TEXT,
  stocking_date DATE,
  pl_count INTEGER,
  aerators INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ========================
-- DAILY POND DATA TABLE
-- ========================
CREATE TABLE IF NOT EXISTS daily_pond_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id UUID REFERENCES farms(id) ON DELETE CASCADE,
  date DATE DEFAULT CURRENT_DATE,
  dissolved_oxygen DECIMAL,
  ph DECIMAL,
  feed_amount DECIMAL,
  temperature DECIMAL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ========================
-- GROWTH DATA TABLE (weekly sampling)
-- ========================
CREATE TABLE IF NOT EXISTS growth_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id UUID REFERENCES farms(id) ON DELETE CASCADE,
  date DATE DEFAULT CURRENT_DATE,
  avg_weight DECIMAL,
  survival_rate FLOAT,      -- Estimated %
  water_color TEXT,         -- Description
  ammonia FLOAT,            -- mg/L
  nitrite FLOAT,            -- mg/L
  alkalinity FLOAT,         -- ppm
  hardness FLOAT,           -- ppm
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ========================
-- CHAT HISTORY TABLE
-- ========================
CREATE TABLE IF NOT EXISTS chat_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farmer_id UUID REFERENCES farmers(id) ON DELETE CASCADE,
  message TEXT,
  response TEXT,
  message_type TEXT DEFAULT 'text',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ========================
-- KNOWLEDGE EMBEDDINGS TABLE (for RAG)
-- ========================
CREATE TABLE IF NOT EXISTS knowledge_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  embedding vector(3072),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Note: We are not creating an ivfflat index here because pgvector's ivfflat
-- is limited to 2000 dimensions, and our Gemini embeddings are 3072.
-- For a typical MVP knowledge base, exact search (sequential scan) is very fast.

-- ========================
-- SIMILARITY SEARCH FUNCTION
-- ========================
CREATE OR REPLACE FUNCTION match_knowledge(
  query_embedding vector(3072),
  match_threshold FLOAT DEFAULT 0.7,
  match_count INT DEFAULT 5
)
RETURNS TABLE (
  id UUID,
  content TEXT,
  metadata JSONB,
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ke.id,
    ke.content,
    ke.metadata,
    1 - (ke.embedding <=> query_embedding) AS similarity
  FROM knowledge_embeddings ke
  WHERE 1 - (ke.embedding <=> query_embedding) > match_threshold
  ORDER BY ke.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- ========================
-- ROW LEVEL SECURITY
-- ========================
ALTER TABLE farmers ENABLE ROW LEVEL SECURITY;
ALTER TABLE farms ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_pond_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE growth_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_embeddings ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (the backend uses service role key)
CREATE POLICY "Service role full access" ON farmers FOR ALL USING (true);
CREATE POLICY "Service role full access" ON farms FOR ALL USING (true);
CREATE POLICY "Service role full access" ON daily_pond_data FOR ALL USING (true);
CREATE POLICY "Service role full access" ON growth_data FOR ALL USING (true);
CREATE POLICY "Service role full access" ON chat_history FOR ALL USING (true);
CREATE POLICY "Service role full access" ON knowledge_embeddings FOR ALL USING (true);
