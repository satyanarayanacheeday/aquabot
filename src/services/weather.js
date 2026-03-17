const axios = require('axios');

const OPENWEATHER_BASE_URL = 'https://api.openweathermap.org/data/2.5/weather';

/**
 * Fetch current weather for a location
 * @param {string} location — City name or "lat,lon"
 * @returns {{ temperature, humidity, rainfall, description, windSpeed }}
 */
async function getWeather(location) {
  try {
    const apiKey = process.env.OPENWEATHER_API_KEY;
    if (!apiKey) {
      console.warn('⚠️ OPENWEATHER_API_KEY not set, skipping weather data');
      return null;
    }

    let params = {
      appid: apiKey,
      units: 'metric',
    };

    // Check if location is lat,lon format
    if (location && location.includes(',')) {
      const [lat, lon] = location.split(',').map(s => s.trim());
      params.lat = lat;
      params.lon = lon;
    } else {
      params.q = location || 'India';
    }

    const response = await axios.get(OPENWEATHER_BASE_URL, { params });
    const data = response.data;

    return {
      temperature: Math.round(data.main.temp),
      feelsLike: Math.round(data.main.feels_like),
      humidity: data.main.humidity,
      rainfall: data.rain ? data.rain['1h'] || data.rain['3h'] || 0 : 0,
      description: data.weather[0]?.description || 'Unknown',
      windSpeed: data.wind?.speed || 0,
      location: data.name,
    };
  } catch (error) {
    console.error('❌ Weather fetch failed:', error.message);
    return null;
  }
}

module.exports = { getWeather };
