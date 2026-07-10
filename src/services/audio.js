const axios = require('axios');
const FormData = require('form-data');
const logger = require('../utils/logger');

// ========================
// CONFIGURATION
// ========================
const SARVAM_API_URL = 'https://api.sarvam.ai';
const SARVAM_API_KEY = process.env.SARVAM_API_KEY;
const TTS_SPEAKER = process.env.SARVAM_TTS_SPEAKER || 'shubh';
const ENABLE_AUDIO_RESPONSE = process.env.ENABLE_AUDIO_RESPONSE !== 'false'; // default: true

// Cost optimization: limits
const MIN_AUDIO_SIZE_BYTES = 2000;   // ~1 second of compressed audio — skip tiny accidental taps
const MAX_TTS_TEXT_LENGTH = 500;     // Truncate TTS input to save characters
const MIN_TTS_TEXT_LENGTH = 30;      // Skip TTS for very short responses

// Simulated transcripts for local test UI
const simulatedTranscripts = new Map();

function addSimulatedTranscript(audioId, text) {
  simulatedTranscripts.set(audioId, text);
}

// ========================
// LANGUAGE MAPPING
// ========================
const LANGUAGE_CONFIG = {
  English: { sttCode: 'en-IN', ttsCode: 'en-IN', speaker: TTS_SPEAKER },
  Telugu:  { sttCode: 'te-IN', ttsCode: 'te-IN', speaker: TTS_SPEAKER },
  Hindi:   { sttCode: 'hi-IN', ttsCode: 'hi-IN', speaker: TTS_SPEAKER },
};

function getLangConfig(language) {
  return LANGUAGE_CONFIG[language] || LANGUAGE_CONFIG['English'];
}

// ========================
// TTS CACHE (LRU)
// ========================
const TTS_CACHE_MAX = 50;
const TTS_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const ttsCache = new Map();

function getCacheKey(text, langCode) {
  // Simple hash: first 100 chars + language + length
  const snippet = text.substring(0, 100);
  return `${langCode}:${snippet}:${text.length}`;
}

function getCachedAudio(key) {
  const entry = ttsCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > TTS_CACHE_TTL_MS) {
    ttsCache.delete(key);
    return null;
  }
  return entry.buffer;
}

function setCachedAudio(key, buffer) {
  // Evict oldest if at capacity
  if (ttsCache.size >= TTS_CACHE_MAX) {
    const oldestKey = ttsCache.keys().next().value;
    ttsCache.delete(oldestKey);
  }
  ttsCache.set(key, { buffer, timestamp: Date.now() });
}

// ========================
// SPEECH-TO-TEXT (Saaras v3)
// ========================

const PHONETIC_CORRECTIONS = {
  // Telugu misheard terms
  'బయటకటట': 'వైట్ గట్',
  'బయట కటట': 'వైట్ గట్',
  'బయట కట్': 'వైట్ గట్',
  'బయటకట్': 'వైట్ గట్',
  'వైట్ గట్టు': 'వైట్ గట్',
  'వైట్ గడ్డు': 'వైట్ గట్',
  'లూస్ షెల్': 'లూజ్ షెల్',
  'లూస్ షెడ్డు': 'లూజ్ షెల్',
};

function applyPhoneticCorrections(text) {
  if (!text) return text;
  let corrected = text;
  for (const [misheard, correct] of Object.entries(PHONETIC_CORRECTIONS)) {
    const regex = new RegExp(misheard, 'g');
    corrected = corrected.replace(regex, correct);
  }
  return corrected;
}

/**
 * Transcribe audio using Sarvam AI (Saaras v3)
 * @param {Buffer} audioBuffer - Raw audio data from WhatsApp
 * @param {string} mimeType - Audio MIME type (e.g., 'audio/ogg')
 * @param {string} language - Farmer's preferred language ('English', 'Telugu', 'Hindi')
 * @returns {Promise<{transcript: string, languageCode: string}>}
 */
async function transcribeAudio(audioBuffer, mimeType, language, audioId = null) {
  const langConfig = getLangConfig(language);

  // Check for simulated transcript (for local test UI simulation)
  if (audioId && simulatedTranscripts.has(audioId)) {
    const text = simulatedTranscripts.get(audioId);
    logger.info(`🎯 [LOCAL] Using simulated transcript for ${audioId}: "${text}"`);
    simulatedTranscripts.delete(audioId); // clean up after use
    return {
      transcript: applyPhoneticCorrections(text),
      languageCode: langConfig.sttCode,
      skipped: false
    };
  }

  if (!SARVAM_API_KEY) {
    throw new Error('SARVAM_API_KEY not configured');
  }

  // Cost optimization: skip tiny audio clips (likely accidental)
  if (audioBuffer.length < MIN_AUDIO_SIZE_BYTES) {
    logger.info(`⏭️ Skipping STT — audio too small (${audioBuffer.length} bytes)`);
    return { transcript: null, languageCode: null, skipped: true };
  }


  
  // Determine file extension from MIME type
  const extMap = {
    'audio/ogg': 'ogg',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'mp4',
    'audio/wav': 'wav',
    'audio/amr': 'amr',
    'audio/aac': 'aac',
  };
  const cleanMimeType = (mimeType || 'audio/ogg').split(';')[0].trim();
  const ext = extMap[cleanMimeType] || 'ogg';

  // Build multipart form data
  const form = new FormData();
  form.append('file', audioBuffer, {
    filename: `voice.${ext}`,
    contentType: cleanMimeType,
  });
  form.append('language_code', 'unknown');
  form.append('model', 'saaras:v3');

  try {
    logger.info(`🎤 Sarvam STT: Transcribing ${audioBuffer.length} bytes (auto-detect)`);
    
    const response = await axios.post(`${SARVAM_API_URL}/speech-to-text`, form, {
      headers: {
        ...form.getHeaders(),
        'api-subscription-key': SARVAM_API_KEY,
      },
      timeout: 30000, // 30s timeout
    });

    const { transcript, language_code } = response.data;
    const finalTranscript = applyPhoneticCorrections(transcript || '');
    logger.info(`✅ STT result: "${finalTranscript.substring(0, 80)}..." (lang: ${language_code})`);
    
    return {
      transcript: finalTranscript,
      languageCode: language_code || langConfig.sttCode,
      skipped: false,
    };
  } catch (error) {
    logger.error('❌ Sarvam STT failed:', {
      error: error.response?.data || error.message,
      status: error.response?.status,
    });
    throw error;
  }
}

// ========================
// TEXT-TO-SPEECH (Bulbul v3)
// ========================

function detectTextLanguage(text, defaultLang) {
  // Check for Telugu script characters (range: U+0C00 to U+0C7F)
  const teluguRegex = /[\u0C00-\u0C7F]/;
  if (teluguRegex.test(text)) {
    return 'Telugu';
  }

  // Check for Devanagari (Hindi) script characters (range: U+0900 to U+097F)
  const hindiRegex = /[\u0900-\u097F]/;
  if (hindiRegex.test(text)) {
    return 'Hindi';
  }

  // Otherwise, fallback to the preferred language
  return defaultLang || 'English';
}

/**
 * Convert text to speech using Sarvam AI (Bulbul v3)
 * @param {string} text - Text to convert
 * @param {string} language - Farmer's preferred language
 * @returns {Promise<Buffer|null>} WAV audio buffer, or null if skipped
 */
async function textToSpeech(text, language) {
  if (!SARVAM_API_KEY) {
    throw new Error('SARVAM_API_KEY not configured');
  }

  // Cost optimization: skip short text
  if (!text || text.length < MIN_TTS_TEXT_LENGTH) {
    logger.info(`⏭️ Skipping TTS — text too short (${text?.length || 0} chars)`);
    return null;
  }

  const detectedLanguage = detectTextLanguage(text, language);
  const langConfig = getLangConfig(detectedLanguage);

  // Cost optimization: truncate long text
  let ttsText = text;
  if (ttsText.length > MAX_TTS_TEXT_LENGTH) {
    ttsText = ttsText.substring(0, MAX_TTS_TEXT_LENGTH) + '...';
    logger.info(`✂️ Truncated TTS text from ${text.length} to ${MAX_TTS_TEXT_LENGTH} chars`);
  }

  // Strip WhatsApp formatting (* for bold) to produce cleaner speech
  ttsText = ttsText.replace(/\*/g, '');

  // Cost optimization: check cache
  const cacheKey = getCacheKey(ttsText, langConfig.ttsCode);
  const cached = getCachedAudio(cacheKey);
  if (cached) {
    logger.info(`📦 TTS cache HIT — saved one API call`);
    return cached;
  }

  try {
    logger.info(`🔊 Sarvam TTS: Converting ${ttsText.length} chars (${langConfig.ttsCode}, speaker: ${langConfig.speaker})`);
    
    const response = await axios.post(`${SARVAM_API_URL}/text-to-speech`, {
      text: ttsText,
      target_language_code: langConfig.ttsCode,
      speaker: langConfig.speaker,
      model: 'bulbul:v3',
    }, {
      headers: {
        'api-subscription-key': SARVAM_API_KEY,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    // Sarvam returns base64-encoded WAV audio in the `audios` array
    const audios = response.data.audios;
    if (!audios || audios.length === 0) {
      logger.warn('⚠️ Sarvam TTS returned empty audios array');
      return null;
    }

    // Combine all audio chunks and decode from base64
    const combinedBase64 = audios.join('');
    const audioBuffer = Buffer.from(combinedBase64, 'base64');
    
    logger.info(`✅ TTS result: ${audioBuffer.length} bytes WAV audio`);

    // Store in cache
    setCachedAudio(cacheKey, audioBuffer);

    return audioBuffer;
  } catch (error) {
    logger.error('❌ Sarvam TTS failed:', {
      error: error.response?.data || error.message,
      status: error.response?.status,
    });
    throw error;
  }
}

// ========================
// OPTIMIZATION HELPERS
// ========================

/**
 * Determine if we should generate audio for this response.
 * Cost optimization: skip TTS for short, interactive, or disabled responses.
 * 
 * @param {string} responseText - The bot's text response
 * @param {string} responseType - Type of response ('text', 'button', 'list')
 * @returns {boolean}
 */
function shouldGenerateAudio(responseText, responseType = 'text') {
  // Global toggle
  if (!ENABLE_AUDIO_RESPONSE) {
    return false;
  }

  // Skip for interactive messages (buttons/lists) — farmer needs to tap, not listen
  if (responseType === 'button' || responseType === 'list') {
    return false;
  }

  // Skip for very short responses
  if (!responseText || responseText.length < MIN_TTS_TEXT_LENGTH) {
    return false;
  }

  return true;
}

module.exports = {
  transcribeAudio,
  textToSpeech,
  shouldGenerateAudio,
  getLangConfig,
  ENABLE_AUDIO_RESPONSE,
  MIN_AUDIO_SIZE_BYTES,
  addSimulatedTranscript,
};
