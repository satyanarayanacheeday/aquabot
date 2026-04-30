const whatsapp = require('../src/services/whatsapp');
const database = require('../src/models/database');
const weather = require('../src/services/weather');
const ai = require('../src/config/gemini');

// --- 1. WhatsApp Mock ---
let messageLog = [];

whatsapp.sendTextMessage = async (phone, text) => {
  messageLog.push({ from: 'bot', to: phone, text });
  console.log(`\x1b[32m🤖 Bot:\x1b[0m ${text}\n`);
};
whatsapp.sendButtonMessage = async (phone, text, buttons) => {
  const btnText = buttons.map(b => `[${b.title || b.reply?.title}]`).join(' ');
  const fullText = `${text}\n👉 Buttons: ${btnText}`;
  messageLog.push({ from: 'bot', to: phone, text: fullText });
  console.log(`\x1b[32m🤖 Bot:\x1b[0m ${fullText}\n`);
};
whatsapp.sendListMessage = async (phone, text, buttonText, sections) => {
  const listItems = sections.flatMap(s => s.rows.map(r => `[${r.title}]`)).join(' ');
  const fullText = `${text}\n👉 List (${buttonText}): ${listItems}`;
  messageLog.push({ from: 'bot', to: phone, text: fullText });
  console.log(`\x1b[32m🤖 Bot:\x1b[0m ${fullText}\n`);
};
whatsapp.markAsRead = async () => {};
whatsapp.downloadMedia = async () => Buffer.from('mock');

const getMessageLog = () => messageLog;
const clearMessageLog = () => { messageLog = []; };

// --- 2. Database Mock ---
const inMemoryDB = {
  farmers: [],
  ponds: [],
  logs: [],
  chats: [],
  scheduled_followups: []
};

database.getFarmerByPhone = async (phone) => inMemoryDB.farmers.find(f => f.phone === phone);
database.getFarmerById = async (id) => inMemoryDB.farmers.find(f => f.id === id);
database.createFarmer = async (farmer) => {
  const id = inMemoryDB.farmers.length + 1;
  const newFarmer = { id, ...farmer };
  inMemoryDB.farmers.push(newFarmer);
  return newFarmer;
};
database.updateFarmer = async (id, updates) => {
  const f = inMemoryDB.farmers.find(f => f.id === id);
  if (f) Object.assign(f, updates);
};

database.createPond = async (pond) => {
  const id = inMemoryDB.ponds.length + 1;
  const newPond = { id, ...pond };
  inMemoryDB.ponds.push(newPond);
  return newPond;
};
database.getFirstPondByFarmer = async (farmerId) => inMemoryDB.ponds.find(p => p.farmer_id === farmerId);
database.updatePond = async (id, updates) => {
  const p = inMemoryDB.ponds.find(p => p.id === id);
  if (p) Object.assign(p, updates);
};

database.insertPondLog = async (log) => {
  const id = inMemoryDB.logs.length + 1;
  const newLog = { id, ...log, created_at: new Date().toISOString() };
  inMemoryDB.logs.push(newLog);
  return newLog;
};
database.getRecentPondLogs = async (pondId, group, limit = 5) => {
  let logs = inMemoryDB.logs.filter(l => l.pond_id === pondId);
  if (group) logs = logs.filter(l => l.log_group === group);
  return logs.slice(-limit);
};
database.saveHealthScore = async (score) => {
  inMemoryDB.logs.push({ log_group: 'health_score', log_data: score, pond_id: score.pond_id });
};
database.getLatestHealthScore = async (pondId) => {
  const scores = inMemoryDB.logs.filter(l => l.pond_id === pondId && l.log_group === 'health_score');
  return scores.length > 0 ? scores[scores.length - 1].log_data : { score: 'green', factors: ['Healthy'] };
};

database.saveChatHistory = async (chat) => inMemoryDB.chats.push(chat);
database.getRecentChats = async () => [];
database.searchKnowledge = async () => [];

database.scheduleFollowUp = async (farmerId, pondId, eventType, followUpDate) => {
  const entry = { id: inMemoryDB.scheduled_followups.length + 1, farmer_id: farmerId, pond_id: pondId, event_type: eventType, followup_date: followUpDate, status: 'pending' };
  inMemoryDB.scheduled_followups.push(entry);
  return entry;
};
database.getDueFollowUps = async (dateStr) => inMemoryDB.scheduled_followups.filter(f => f.status === 'pending' && f.followup_date <= dateStr);
database.markFollowUpCompleted = async (id) => {
  const fu = inMemoryDB.scheduled_followups.find(f => f.id === id);
  if (fu) fu.status = 'completed';
};

// --- 3. Weather Mock ---
weather.getWeather = async () => ({
  location: 'Mock Village',
  temperature: 30,
  feelsLike: 34,
  humidity: 75,
  description: 'Sunny',
  rainfall: 0,
  windSpeed: 3
});

// --- 4. AI Mock ---
// For the recommendation test, we want to see if the recommendations are passed into Gemini.
// We intercept AI generation and return a dummy response that echoes the context.
ai.models = {
  embedContent: async () => ({ embedding: { values: [0.1, 0.2] } }),
  generateContent: async (req) => {
    // If the system instruction contains our local market recommendations, we mention them in the reply
    const sysInst = req.config?.systemInstruction || '';
    if (sysInst.includes('Local Market Recommendations for')) {
      return { text: "I see you have an ammonia problem! Based on local availability, I recommend using Growel Pond Pro or Blue Aqua Nitro Clear to quickly reduce ammonia levels. Make sure to follow the dosage of 1-2kg/acre!" };
    }
    
    // For Advisory
    if (req.contents[0].parts[0].text.includes('advisory')) {
      return { text: "Daily Advisory: Water quality looks stable. Keep feeding at normal rates and observe for any loose shells." };
    }

    return { text: "This is a mocked AI response to your query." };
  }
};

module.exports = {
  getMessageLog,
  clearMessageLog,
  inMemoryDB
};
