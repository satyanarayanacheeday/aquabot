const supabase = require('../config/supabase');

// ========================
// FARMERS
// ========================

async function createFarmer(data) {
  const { data: farmer, error } = await supabase
    .from('farmers')
    .insert(data)
    .select()
    .single();
  if (error) throw error;
  return farmer;
}

async function getFarmerByPhone(phone) {
  const { data: farmer, error } = await supabase
    .from('farmers')
    .select('*')
    .eq('phone', phone)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return farmer || null;
}

async function getFarmerById(id) {
  const { data: farmer, error } = await supabase
    .from('farmers')
    .select('*')
    .eq('id', id)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return farmer || null;
}

async function updateFarmer(id, data) {
  const { data: farmer, error } = await supabase
    .from('farmers')
    .update(data)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return farmer;
}

async function getAllFarmers() {
  const { data: farmers, error } = await supabase
    .from('farmers')
    .select('*')
    .eq('registration_complete', true);
  if (error) throw error;
  return farmers || [];
}

// ========================
// FARMS
// ========================

async function createFarm(data) {
  const { data: farm, error } = await supabase
    .from('farms')
    .insert(data)
    .select()
    .single();
  if (error) throw error;
  return farm;
}

async function getFarmsByFarmer(farmerId) {
  const { data: farms, error } = await supabase
    .from('farms')
    .select('*')
    .eq('farmer_id', farmerId);
  if (error) throw error;
  return farms || [];
}

async function getFirstFarmByFarmer(farmerId) {
  const { data: farm, error } = await supabase
    .from('farms')
    .select('*')
    .eq('farmer_id', farmerId)
    .limit(1)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return farm || null;
}

// ========================
// DAILY POND DATA
// ========================

async function insertDailyData(data) {
  const { data: record, error } = await supabase
    .from('daily_pond_data')
    .insert(data)
    .select()
    .single();
  if (error) throw error;
  return record;
}

async function getRecentDailyData(farmId, days = 7) {
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - days);

  const { data: records, error } = await supabase
    .from('daily_pond_data')
    .select('*')
    .eq('farm_id', farmId)
    .gte('date', fromDate.toISOString().split('T')[0])
    .order('date', { ascending: false });
  if (error) throw error;
  return records || [];
}

// ========================
// GROWTH DATA
// ========================

async function insertGrowthData(data) {
  const { data: record, error } = await supabase
    .from('growth_data')
    .insert(data)
    .select()
    .single();
  if (error) throw error;
  return record;
}

async function getRecentGrowthData(farmId, count = 4) {
  const { data: records, error } = await supabase
    .from('growth_data')
    .select('*')
    .eq('farm_id', farmId)
    .order('date', { ascending: false })
    .limit(count);
  if (error) throw error;
  return records || [];
}

// ========================
// CHAT HISTORY
// ========================

async function saveChatHistory(data) {
  const { error } = await supabase
    .from('chat_history')
    .insert(data);
  if (error) throw error;
}

async function getRecentChats(farmerId, limit = 10) {
  const { data: chats, error } = await supabase
    .from('chat_history')
    .select('*')
    .eq('farmer_id', farmerId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (chats || []).reverse();
}

// ========================
// KNOWLEDGE EMBEDDINGS
// ========================

async function searchKnowledge(embedding, limit = 5, threshold = 0.7) {
  const { data, error } = await supabase
    .rpc('match_knowledge', {
      query_embedding: embedding,
      match_threshold: threshold,
      match_count: limit,
    });
  if (error) throw error;
  return data || [];
}

async function insertKnowledgeEmbedding(content, embedding, metadata = {}) {
  const { error } = await supabase
    .from('knowledge_embeddings')
    .insert({ content, embedding, metadata });
  if (error) throw error;
}

module.exports = {
  createFarmer,
  getFarmerByPhone,
  getFarmerById,
  updateFarmer,
  getAllFarmers,
  createFarm,
  getFarmsByFarmer,
  getFirstFarmByFarmer,
  insertDailyData,
  getRecentDailyData,
  insertGrowthData,
  getRecentGrowthData,
  saveChatHistory,
  getRecentChats,
  searchKnowledge,
  insertKnowledgeEmbedding,
};
