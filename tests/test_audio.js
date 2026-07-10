/**
 * Unit & Integration Tests for Audio Message Processing
 */

// Configure dummy environment variables
process.env.SARVAM_API_KEY = 'mock_sarvam_key';
process.env.WHATSAPP_TOKEN = 'mock_wa_token';
process.env.WHATSAPP_PHONE_NUMBER_ID = 'mock_phone_id';
process.env.ENABLE_AUDIO_RESPONSE = 'true';

const assert = require('assert');
const axios = require('axios');

// Mock WhatsApp media download BEFORE importing webhookController
const whatsappService = require('../src/services/whatsapp');
whatsappService.downloadMedia = async (mediaId) => {
  if (mediaId === 'short_audio_id') {
    return Buffer.alloc(1000); // 1KB
  }
  return Buffer.alloc(10000); // 10KB
};

const { getMessageLog, clearMessageLog, inMemoryDB } = require('./test_framework');

// Overwrite again after test_framework to ensure it isn't overridden
whatsappService.downloadMedia = async (mediaId) => {
  if (mediaId === 'short_audio_id') {
    return Buffer.alloc(1000); // 1KB
  }
  return Buffer.alloc(10000); // 10KB
};

const eventBus = require('../src/utils/eventBus');
const originalSendTextMessage = whatsappService.sendTextMessage;
whatsappService.sendTextMessage = async (phone, text) => {
  await originalSendTextMessage(phone, text);
  eventBus.emit('message', { to: phone, text });
};

whatsappService.sendAudioMessage = async (phone, mediaId) => {
  getMessageLog().push({ from: 'bot', to: phone, text: `🔊 [Audio Response] (mediaId: ${mediaId})` });
  console.log(`\x1b[32m🤖 Bot:\x1b[0m 🔊 [Audio Response] (mediaId: ${mediaId})\n`);
};


const webhookController = require('../src/controllers/webhookController');
const { clearState } = require('../src/state/conversationState');
const { getFarmerByPhone, createFarmer, createPond } = require('../src/models/database');
const audioService = require('../src/services/audio');

// Mock Axios for Sarvam API requests
let mockSttResponse = {
  data: {
    transcript: 'Hello, how is the weather today?',
    language_code: 'en-IN'
  }
};

let mockTtsResponse = {
  data: {
    audios: [Buffer.from('mock_wav_audio_data').toString('base64')]
  }
};

let apiCalls = [];

axios.post = async (url, data, config) => {
  apiCalls.push({ url, data, config });

  if (url.includes('speech-to-text')) {
    return mockSttResponse;
  }
  if (url.includes('text-to-speech')) {
    return mockTtsResponse;
  }
  // WhatsApp Cloud API media upload mock (if hit by axios directly)
  if (url.includes('/media')) {
    return { data: { id: 'mock_uploaded_media_id_123' } };
  }
  // WhatsApp message sending mock
  if (url.includes('/messages')) {
    return { data: { message_id: 'mock_msg_id_sent' } };
  }

  throw new Error(`Unhandled mock post request to: ${url}`);
};


async function runAudioTests() {
  console.log('\n=======================================================');
  console.log('🧪 RUNNING AUDIO PROCESSING TESTS');
  console.log('=======================================================\n');

  const phone = '919999999999';
  
  // 1. Create a dummy onboarded farmer
  let farmer = await getFarmerByPhone(phone);
  if (!farmer) {
    farmer = await createFarmer({
      phone,
      preferred_language: 'English',
      onboarding_complete: true,
      village: 'Bhimavaram'
    });
    await createPond({
      farmer_id: farmer.id,
      pond_number: 1,
      species: 'vannamei',
      stocking_date: '2024-05-15',
      pond_size: '1_3_acres',
      seed_count: 100000
    });
  }

  // ----------------------------------------------------
  // TEST CASE 1: Successful voice input to audio response
  // ----------------------------------------------------
  console.log('▶️ TEST 1: Voice in → Text process → Voice out');
  clearMessageLog();
  clearState(phone);
  apiCalls = [];

  mockSttResponse.data.transcript = 'how is my pond doing?';

  const req = {
    body: {
      object: 'whatsapp_business_account',
      entry: [{
        changes: [{
          value: {
            messages: [{
              from: phone,
              id: 'audio_msg_test_1',
              type: 'audio',
              audio: { id: 'valid_audio_id', mime_type: 'audio/ogg' }
            }]
          }
        }]
      }]
    }
  };
  const res = { sendStatus: () => {} };

  await webhookController.handleIncoming(req, res);

  // Wait a small bit for setImmediate background processing to complete
  await new Promise(resolve => setTimeout(resolve, 500));

  // Verify processing indicator sent
  assert(getMessageLog().some(m => m.text.includes('Processing')), 'Sent processing indicator');
  console.log('✅ Processing indicator sent');

  // Verify STT was called
  const sttCall = apiCalls.find(c => c.url.includes('speech-to-text'));
  assert(sttCall, 'Sarvam STT API was called');
  console.log('✅ Sarvam STT API was called');

  // Verify text pipeline response was sent
  assert(getMessageLog().some(m => m.text.includes('mocked AI response') || m.text.includes('Pond Health')), 'Text reply was sent');
  console.log('✅ Text reply was sent');

  // Verify TTS was called
  const ttsCall = apiCalls.find(c => c.url.includes('text-to-speech'));
  assert(ttsCall, 'Sarvam TTS API was called');
  assert(ttsCall.data.text.includes('mocked AI response') || ttsCall.data.text.includes('Pond Health'), 'TTS converted correct text');
  console.log('✅ Sarvam TTS API was called with correct text');

  // Verify audio reply was sent
  assert(getMessageLog().some(m => m.text.includes('[Audio Response]')), 'Audio reply message was sent back');
  console.log('✅ Audio reply sent back successfully');

  // ----------------------------------------------------
  // TEST CASE 2: Skipping short audio (<1s)
  // ----------------------------------------------------
  console.log('\n▶️ TEST 2: Skip short audio clips (<1s)');
  clearMessageLog();
  clearState(phone);
  apiCalls = [];

  req.body.entry[0].changes[0].value.messages[0].id = 'audio_msg_test_2';
  req.body.entry[0].changes[0].value.messages[0].audio.id = 'short_audio_id';

  await webhookController.handleIncoming(req, res);

  assert(getMessageLog().some(m => m.text.includes('too short')), 'Sent "too short" error message');
  assert(!apiCalls.some(c => c.url.includes('speech-to-text')), 'Did NOT call STT for short audio');
  console.log('✅ Accidental/short audio successfully skipped');

  // ----------------------------------------------------
  // TEST CASE 3: TTS Caching (Repeat requests)
  // ----------------------------------------------------
  console.log('\n▶️ TEST 3: TTS LRU Caching');
  apiCalls = [];

  // Call TTS twice on the same text
  await audioService.textToSpeech('This is a test of caching and it has to be longer', 'English');
  const callCountBefore = apiCalls.filter(c => c.url.includes('text-to-speech')).length;

  await audioService.textToSpeech('This is a test of caching and it has to be longer', 'English');
  const callCountAfter = apiCalls.filter(c => c.url.includes('text-to-speech')).length;

  assert.strictEqual(callCountBefore, 1, 'First call hit API');
  assert.strictEqual(callCountAfter, 1, 'Second call served from cache (no extra API call)');
  console.log('✅ Caching is active and prevented duplicate API calls');

  // ----------------------------------------------------
  // TEST CASE 4: Disable audio response toggle
  // ----------------------------------------------------
  console.log('\n▶️ TEST 4: ENABLE_AUDIO_RESPONSE toggle');
  clearMessageLog();
  clearState(phone);
  apiCalls = [];

  process.env.ENABLE_AUDIO_RESPONSE = 'false';
  req.body.entry[0].changes[0].value.messages[0].id = 'audio_msg_test_4';
  req.body.entry[0].changes[0].value.messages[0].audio.id = 'valid_audio_id';

  await webhookController.handleIncoming(req, res);

  assert(getMessageLog().some(m => m.text.includes('mocked AI response')), 'Sent text response');
  assert(!apiCalls.some(c => c.url.includes('text-to-speech')), 'Did NOT generate TTS when disabled');
  console.log('✅ Toggle successfully disabled TTS generation');

  console.log('\n🎉 ALL AUDIO PROCESSING TESTS PASSED!\n');
}

runAudioTests().catch(err => {
  console.error('❌ Audio tests failed:', err);
  process.exit(1);
});
