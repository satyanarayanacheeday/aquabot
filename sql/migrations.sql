-- ============================================================
-- Aquorix v2 — Database Schema (Progressive Collection)
-- Run this in your Supabase SQL Editor to set up all tables
-- ============================================================

-- Enable pgvector extension for RAG embeddings
CREATE EXTENSION IF NOT EXISTS vector;

-- ========================
-- FARMERS TABLE
-- ========================
-- Simplified: no name on Day 1, collected progressively
CREATE TABLE IF NOT EXISTS farmers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT UNIQUE NOT NULL,
  name TEXT,                                    -- collected later (progressive)
  village TEXT,                                 -- collected during onboarding
  farm_type TEXT,                               -- 'shrimp' | 'fish' | 'both'
  preferred_language TEXT DEFAULT 'English',
  pond_count INTEGER DEFAULT 1,
  current_problem TEXT,                         -- what they want help with today
  onboarding_complete BOOLEAN DEFAULT false,
  onboarding_day INTEGER DEFAULT 0,            -- tracks progressive day (1-7+)
  last_checkin_date DATE,                       -- last daily check-in date
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ========================
-- PONDS TABLE
-- ========================
-- One row per pond. Replaces old 'farms' table.
CREATE TABLE IF NOT EXISTS ponds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farmer_id UUID REFERENCES farmers(id) ON DELETE CASCADE,
  pond_number INTEGER DEFAULT 1,
  species TEXT,                                 -- 'vannamei' | 'tiger_shrimp' | 'tilapia' | 'rohu' | 'catla' | 'other'
  stocking_date TEXT,                           -- approximate: 'this_week' | 'this_month' | '1_2_months' | '3_plus_months'
  pond_size TEXT,                               -- 'less_than_1_acre' | '1_3_acres' | 'more_than_3_acres'
  -- Progressive data (collected over weeks/months):
  feed_brand TEXT,
  feed_frequency INTEGER,                       -- times per day
  water_source TEXT,
  aerator_count INTEGER,
  aerator_hours DECIMAL,
  seed_supplier TEXT,
  seed_count INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ========================
-- POND LOGS TABLE
-- ========================
-- Flexible log storage. Replaces daily_pond_data + growth_data.
-- Each log belongs to a group: 'feed', 'water', 'health', 'weekly', 'event'
CREATE TABLE IF NOT EXISTS pond_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pond_id UUID REFERENCES ponds(id) ON DELETE CASCADE,
  log_group TEXT NOT NULL,                      -- 'feed' | 'water' | 'health' | 'weekly' | 'event'
  log_data JSONB NOT NULL DEFAULT '{}',         -- flexible: {feed_kg: '10-30', feed_times: 3, ...}
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ========================
-- POND HEALTH SCORES TABLE
-- ========================
CREATE TABLE IF NOT EXISTS pond_health_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pond_id UUID REFERENCES ponds(id) ON DELETE CASCADE,
  score TEXT NOT NULL DEFAULT 'green',           -- 'green' | 'yellow' | 'red'
  factors JSONB NOT NULL DEFAULT '{}',           -- {feed: 'green', water: 'yellow', ...}
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ========================
-- CHAT HISTORY TABLE (unchanged)
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
-- KNOWLEDGE EMBEDDINGS TABLE (unchanged)
-- ========================
CREATE TABLE IF NOT EXISTS knowledge_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  embedding vector(3072),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ========================
-- SIMILARITY SEARCH FUNCTION (unchanged)
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
ALTER TABLE ponds ENABLE ROW LEVEL SECURITY;
ALTER TABLE pond_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE pond_health_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_embeddings ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (the backend uses service role key)
CREATE POLICY "Service role full access" ON farmers FOR ALL USING (true);
CREATE POLICY "Service role full access" ON ponds FOR ALL USING (true);
CREATE POLICY "Service role full access" ON pond_logs FOR ALL USING (true);
CREATE POLICY "Service role full access" ON pond_health_scores FOR ALL USING (true);
CREATE POLICY "Service role full access" ON chat_history FOR ALL USING (true);
CREATE POLICY "Service role full access" ON knowledge_embeddings FOR ALL USING (true);

-- ========================
-- SCHEDULED FOLLOW-UPS TABLE
-- ========================
CREATE TABLE IF NOT EXISTS scheduled_followups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farmer_id UUID REFERENCES farmers(id) ON DELETE CASCADE,
  pond_id UUID REFERENCES ponds(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  followup_date DATE NOT NULL,
  status TEXT DEFAULT 'pending', -- 'pending' or 'completed'
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE scheduled_followups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON scheduled_followups FOR ALL USING (true);

-- ========================
-- CONVERSATION SUMMARY (for LLM-based chat summarization)
-- ========================
ALTER TABLE farmers ADD COLUMN IF NOT EXISTS conversation_summary TEXT;
ALTER TABLE farmers ADD COLUMN IF NOT EXISTS summary_message_count INTEGER DEFAULT 0;
