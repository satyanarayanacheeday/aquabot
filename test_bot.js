// test_bot.js
require('dotenv').config();
const { answerQuestion } = require('./src/services/ai');

// Mock the database functions to avoid connection errors during testing
const db = require('./src/models/database');
db.searchKnowledge = async () => [];
db.getFarmerById = async () => ({ village: 'Bhimavaram', farm_type: 'Shrimp' });
db.getFirstPondByFarmer = async () => ({ species: 'vannamei', pond_size: '1 acre', stocking_date: '2026-03-01', feed_brand: 'Avanti' });
db.getRecentPondLogs = async () => [];
db.getLatestHealthScore = async () => ({ score: 'yellow', factors: ['High Ammonia'] });
db.getRecentChats = async () => [];

// Mock weather to avoid API calls
const weather = require('./src/services/weather');
weather.getWeather = async () => ({
  location: 'Bhimavaram',
  temperature: 32,
  feelsLike: 35,
  humidity: 80,
  description: 'Sunny',
  rainfall: 0,
  windSpeed: 2
});

async function test() {
  console.log("💬 Farmer: My pond has very high ammonia and bad smell. What should I do?");
  console.log("⏳ Bot is thinking...\n");
  try {
    const reply = await answerQuestion("My pond has very high ammonia and bad smell. What should I do?", 1, "English");
    console.log("🤖 Bot Reply:\n");
    console.log(reply);
  } catch (error) {
    console.error("Test failed. Make sure you have a valid GEMINI_API_KEY in your .env file.");
    console.error(error.message);
  }
}

test();
