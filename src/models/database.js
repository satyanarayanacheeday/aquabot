const supabase = require('../config/supabase');
const { v4: uuidv4 } = require('uuid');

/**
 * In-memory mock store for local testing without Supabase.
 * Activated automatically when SUPABASE_URL is not set.
 */
const USE_MOCK = !process.env.SUPABASE_URL || !process.env.SUPABASE_KEY;

const mockStore = {
  farmers: [],
  ponds: [],
  pond_logs: [],
  pond_health_scores: [],
  chat_history: [],
  knowledge_embeddings: [],
  scheduled_followups: [],
};

if (USE_MOCK) {
  console.log('📦 Using in-memory mock database (no Supabase configured)');
}

// ========================
// FARMERS
// ========================

async function createFarmer(data) {
  if (USE_MOCK) {
    const farmer = { id: uuidv4(), created_at: new Date().toISOString(), ...data };
    mockStore.farmers.push(farmer);
    return farmer;
  }
  const { data: farmer, error } = await supabase.from('farmers').insert(data).select().single();
  if (error) throw error;
  return farmer;
}

async function getFarmerByPhone(phone) {
  if (USE_MOCK) {
    return mockStore.farmers.find(f => f.phone === phone) || null;
  }
  const { data: farmer, error } = await supabase.from('farmers').select('*').eq('phone', phone).single();
  if (error && error.code !== 'PGRST116') throw error;
  return farmer || null;
}

async function getFarmerById(id) {
  if (USE_MOCK) {
    return mockStore.farmers.find(f => f.id === id) || null;
  }
  const { data: farmer, error } = await supabase.from('farmers').select('*').eq('id', id).single();
  if (error && error.code !== 'PGRST116') throw error;
  return farmer || null;
}

async function updateFarmer(id, data) {
  if (USE_MOCK) {
    const idx = mockStore.farmers.findIndex(f => f.id === id);
    if (idx === -1) throw new Error('Farmer not found');
    mockStore.farmers[idx] = { ...mockStore.farmers[idx], ...data };
    return mockStore.farmers[idx];
  }
  const { data: farmer, error } = await supabase.from('farmers').update(data).eq('id', id).select().single();
  if (error) throw error;
  return farmer;
}

async function getAllFarmers() {
  if (USE_MOCK) {
    return mockStore.farmers.filter(f => f.onboarding_complete);
  }
  const { data: farmers, error } = await supabase.from('farmers').select('*').eq('onboarding_complete', true);
  if (error) throw error;
  return farmers || [];
}

// ========================
// PONDS
// ========================

async function createPond(data) {
  if (USE_MOCK) {
    const pond = { id: uuidv4(), created_at: new Date().toISOString(), ...data };
    mockStore.ponds.push(pond);
    return pond;
  }
  const { data: pond, error } = await supabase.from('ponds').insert(data).select().single();
  if (error) throw error;
  return pond;
}

async function getPondsByFarmer(farmerId) {
  if (USE_MOCK) {
    return mockStore.ponds.filter(p => p.farmer_id === farmerId).sort((a, b) => (a.pond_number || 1) - (b.pond_number || 1));
  }
  const { data: ponds, error } = await supabase.from('ponds').select('*').eq('farmer_id', farmerId).order('pond_number', { ascending: true });
  if (error) throw error;
  return ponds || [];
}

async function getFirstPondByFarmer(farmerId) {
  if (USE_MOCK) {
    const ponds = mockStore.ponds.filter(p => p.farmer_id === farmerId).sort((a, b) => (a.pond_number || 1) - (b.pond_number || 1));
    return ponds[0] || null;
  }
  const { data: pond, error } = await supabase.from('ponds').select('*').eq('farmer_id', farmerId).order('pond_number', { ascending: true }).limit(1).single();
  if (error && error.code !== 'PGRST116') throw error;
  return pond || null;
}

async function getPondById(id) {
  if (USE_MOCK) {
    return mockStore.ponds.find(p => p.id === id) || null;
  }
  const { data: pond, error } = await supabase.from('ponds').select('*').eq('id', id).single();
  if (error && error.code !== 'PGRST116') throw error;
  return pond || null;
}


async function updatePond(id, data) {
  if (USE_MOCK) {
    const idx = mockStore.ponds.findIndex(p => p.id === id);
    if (idx === -1) throw new Error('Pond not found');
    mockStore.ponds[idx] = { ...mockStore.ponds[idx], ...data };
    return mockStore.ponds[idx];
  }
  const { data: pond, error } = await supabase.from('ponds').update(data).eq('id', id).select().single();
  if (error) throw error;
  return pond;
}

// ========================
// POND LOGS
// ========================

async function insertPondLog(data) {
  if (USE_MOCK) {
    const log = { id: uuidv4(), created_at: new Date().toISOString(), ...data };
    mockStore.pond_logs.push(log);
    return log;
  }
  const { data: log, error } = await supabase.from('pond_logs').insert(data).select().single();
  if (error) throw error;
  return log;
}

async function getRecentPondLogs(pondId, logGroup, limit = 7) {
  if (USE_MOCK) {
    let logs = mockStore.pond_logs.filter(l => l.pond_id === pondId);
    if (logGroup) logs = logs.filter(l => l.log_group === logGroup);
    return logs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, limit);
  }
  const query = supabase.from('pond_logs').select('*').eq('pond_id', pondId).order('created_at', { ascending: false }).limit(limit);
  if (logGroup) query.eq('log_group', logGroup);
  const { data: logs, error } = await query;
  if (error) throw error;
  return logs || [];
}

async function getAllRecentPondLogs(pondId, days = 7) {
  if (USE_MOCK) {
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - days);
    return mockStore.pond_logs
      .filter(l => l.pond_id === pondId && new Date(l.created_at) >= fromDate)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - days);
  const { data: logs, error } = await supabase.from('pond_logs').select('*').eq('pond_id', pondId).gte('created_at', fromDate.toISOString()).order('created_at', { ascending: false });
  if (error) throw error;
  return logs || [];
}

// ========================
// POND HEALTH SCORES
// ========================

async function upsertHealthScore(pondId, score, factors) {
  if (USE_MOCK) {
    const today = new Date().toISOString().split('T')[0];
    const existing = mockStore.pond_health_scores.find(s => s.pond_id === pondId && s.created_at.startsWith(today));
    if (existing) {
      existing.score = score;
      existing.factors = factors;
      return existing;
    }
    const entry = { id: uuidv4(), pond_id: pondId, score, factors, created_at: new Date().toISOString() };
    mockStore.pond_health_scores.push(entry);
    return entry;
  }

  const today = new Date().toISOString().split('T')[0];
  const { data: existing } = await supabase.from('pond_health_scores').select('id').eq('pond_id', pondId).gte('created_at', today).limit(1).single();
  if (existing) {
    const { data: updated, error } = await supabase.from('pond_health_scores').update({ score, factors }).eq('id', existing.id).select().single();
    if (error) throw error;
    return updated;
  }
  const { data: created, error } = await supabase.from('pond_health_scores').insert({ pond_id: pondId, score, factors }).select().single();
  if (error) throw error;
  return created;
}

async function getLatestHealthScore(pondId) {
  if (USE_MOCK) {
    const scores = mockStore.pond_health_scores.filter(s => s.pond_id === pondId).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return scores[0] || null;
  }
  const { data: score, error } = await supabase.from('pond_health_scores').select('*').eq('pond_id', pondId).order('created_at', { ascending: false }).limit(1).single();
  if (error && error.code !== 'PGRST116') throw error;
  return score || null;
}

// ========================
// CHAT HISTORY
// ========================

async function saveChatHistory(data) {
  if (USE_MOCK) {
    const entry = { id: uuidv4(), created_at: new Date().toISOString(), ...data };
    mockStore.chat_history.push(entry);
    return entry;
  }
  const { data: result, error } = await supabase.from('chat_history').insert(data).select().single();
  if (error) throw error;
  return result;
}

async function updateChatHistory(id, data) {
  if (USE_MOCK) {
    const idx = mockStore.chat_history.findIndex(c => c.id === id);
    if (idx === -1) throw new Error('Chat history not found');
    mockStore.chat_history[idx] = { ...mockStore.chat_history[idx], ...data };
    return mockStore.chat_history[idx];
  }
  const { data: result, error } = await supabase.from('chat_history').update(data).eq('id', id).select().single();
  if (error) throw error;
  return result;
}

async function getRecentChats(farmerId, limit = 10) {
  if (USE_MOCK) {
    return mockStore.chat_history
      .filter(c => c.farmer_id === farmerId)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, limit)
      .reverse();
  }
  const { data: chats, error } = await supabase.from('chat_history').select('*').eq('farmer_id', farmerId).order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return (chats || []).reverse();
}

// ========================
// KNOWLEDGE EMBEDDINGS
// ========================

async function searchKnowledge(embedding, limit = 5, threshold = 0.7) {
  if (USE_MOCK) {
    return []; // no knowledge in mock mode
  }
  const { data, error } = await supabase.rpc('match_knowledge', {
    query_embedding: embedding,
    match_threshold: threshold,
    match_count: limit,
  });
  if (error) throw error;
  return data || [];
}

async function clearKnowledgeBase() {
  if (USE_MOCK) return;
  // Delete all rows in knowledge_embeddings where id is not null (so, all rows)
  const { error } = await supabase.from('knowledge_embeddings').delete().not('id', 'is', null);
  if (error) throw error;
  console.log('🗑️ Cleared existing knowledge base embeddings to prevent duplicates.');
}

async function insertKnowledgeEmbedding(content, embedding, metadata = {}) {
  if (USE_MOCK) {
    mockStore.knowledge_embeddings.push({ id: uuidv4(), content, embedding, metadata, created_at: new Date().toISOString() });
    return;
  }
  const { error } = await supabase.from('knowledge_embeddings').insert({ content, embedding, metadata });
  if (error) throw error;
}

// ========================
// SCHEDULED FOLLOW-UPS
// ========================

async function scheduleFollowUp(farmerId, pondId, eventType, followUpDate) {
  if (USE_MOCK) {
    const entry = {
      id: uuidv4(),
      farmer_id: farmerId,
      pond_id: pondId,
      event_type: eventType,
      followup_date: followUpDate,
      status: 'pending',
      created_at: new Date().toISOString()
    };
    mockStore.scheduled_followups.push(entry);
    return entry;
  }
  const { data, error } = await supabase.from('scheduled_followups').insert({
    farmer_id: farmerId,
    pond_id: pondId,
    event_type: eventType,
    followup_date: followUpDate,
    status: 'pending'
  }).select().single();
  if (error) {
    console.warn('⚠️ Note: scheduled_followups table might not exist in Supabase yet.');
    throw error;
  }
  return data;
}

async function getDueFollowUps(dateStr) {
  if (USE_MOCK) {
    return mockStore.scheduled_followups.filter(f => f.status === 'pending' && f.followup_date <= dateStr);
  }
  const { data, error } = await supabase.from('scheduled_followups')
    .select('*')
    .eq('status', 'pending')
    .lte('followup_date', dateStr);
  if (error) {
    console.warn('⚠️ Scheduled followups fetch failed. Table may not exist.');
    return [];
  }
  return data || [];
}

async function markFollowUpCompleted(id) {
  if (USE_MOCK) {
    const idx = mockStore.scheduled_followups.findIndex(f => f.id === id);
    if (idx !== -1) mockStore.scheduled_followups[idx].status = 'completed';
    return;
  }
  await supabase.from('scheduled_followups').update({ status: 'completed' }).eq('id', id);
}

async function hasPendingDailyCheckIn(farmerId) {
  if (USE_MOCK) {
    return mockStore.scheduled_followups.some(f => f.farmer_id === farmerId && f.event_type === 'daily_checkin' && f.status === 'pending');
  }
  const { data, error } = await supabase.from('scheduled_followups')
    .select('id')
    .eq('farmer_id', farmerId)
    .eq('event_type', 'daily_checkin')
    .eq('status', 'pending')
    .limit(1);
  if (error) return false;
  return data && data.length > 0;
}

async function markPendingCheckInsCompleted(farmerId) {
  if (USE_MOCK) {
    mockStore.scheduled_followups.forEach(f => {
      if (f.farmer_id === farmerId && f.event_type === 'daily_checkin' && f.status === 'pending') {
        f.status = 'completed';
      }
    });
    return;
  }
  await supabase.from('scheduled_followups')
    .update({ status: 'completed' })
    .eq('farmer_id', farmerId)
    .eq('event_type', 'daily_checkin')
    .eq('status', 'pending');
}

module.exports = {
  createFarmer, getFarmerByPhone, getFarmerById, updateFarmer, getAllFarmers,
  createPond, getPondsByFarmer, getFirstPondByFarmer, getPondById, updatePond,
  insertPondLog, getRecentPondLogs, getAllRecentPondLogs,
  upsertHealthScore, getLatestHealthScore,
  saveChatHistory, updateChatHistory, getRecentChats,
  searchKnowledge, insertKnowledgeEmbedding, clearKnowledgeBase,
  scheduleFollowUp, getDueFollowUps, markFollowUpCompleted,
  hasPendingDailyCheckIn, markPendingCheckInsCompleted,
  getDashboardStats, getAllFarmersForDashboard, getFullChatHistory
};

// ========================
// DASHBOARD AGGREGATIONS
// ========================

async function getDashboardStats() {
  if (USE_MOCK) {
    const totalFarmers = mockStore.farmers.length;
    const completedOnboarding = mockStore.farmers.filter(f => f.onboarding_complete).length;
    const totalPonds = mockStore.ponds.length;
    const healthCounts = { green: 0, yellow: 0, red: 0 };
    mockStore.pond_health_scores.forEach(s => {
      healthCounts[s.score] = (healthCounts[s.score] || 0) + 1;
    });
    return {
      totalFarmers,
      onboardingRate: totalFarmers ? Math.round((completedOnboarding / totalFarmers) * 100) : 0,
      totalPonds,
      healthDistribution: healthCounts
    };
  }

  const { count: totalFarmers } = await supabase.from('farmers').select('*', { count: 'exact', head: true });
  const { count: completedOnboarding } = await supabase.from('farmers').select('*', { count: 'exact', head: true }).eq('onboarding_complete', true);
  const { count: totalPonds } = await supabase.from('ponds').select('*', { count: 'exact', head: true });
  
  // Get health distribution
  const { data: healthScores } = await supabase.from('pond_health_scores').select('score');
  const healthDistribution = (healthScores || []).reduce((acc, curr) => {
    acc[curr.score] = (acc[curr.score] || 0) + 1;
    return acc;
  }, { green: 0, yellow: 0, red: 0 });

  return {
    totalFarmers: totalFarmers || 0,
    onboardingRate: totalFarmers ? Math.round((completedOnboarding / totalFarmers) * 100) : 0,
    totalPonds: totalPonds || 0,
    healthDistribution
  };
}

async function getAllFarmersForDashboard() {
  if (USE_MOCK) {
    return mockStore.farmers.map(f => {
      const pondCount = mockStore.ponds.filter(p => p.farmer_id === f.id).length;
      return { ...f, pondCount };
    });
  }
  // Fetch farmers
  const { data: farmers, error } = await supabase.from('farmers').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  
  // Fetch pond counts separately for reliability (or use a view if performance was an issue)
  const { data: pondCounts, error: pondError } = await supabase.from('ponds').select('farmer_id');
  if (pondError) throw pondError;
  
  const countMap = (pondCounts || []).reduce((acc, p) => {
    acc[p.farmer_id] = (acc[p.farmer_id] || 0) + 1;
    return acc;
  }, {});

  return farmers.map(f => ({
    ...f,
    pondCount: countMap[f.id] || 0
  }));
}

async function getFullChatHistory(farmerId) {
  if (USE_MOCK) {
    return mockStore.chat_history
      .filter(c => c.farmer_id === farmerId)
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  }
  const { data: chats, error } = await supabase.from('chat_history')
    .select('*')
    .eq('farmer_id', farmerId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return chats || [];
}
