const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { verifyWebhook, handleIncoming } = require('../controllers/webhookController');

/**
 * Middleware to verify Meta's webhook signature (X-Hub-Signature-256)
 * Requires process.env.WHATSAPP_APP_SECRET
 */
function verifyMetaSignature(req, res, next) {
  // During local test mock (from our own test UI), we skip validation
  if (req.body?.object === 'whatsapp_business_account' && req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.id?.startsWith('mock_msg_')) {
    return next();
  }

  const signaturePath = req.headers['x-hub-signature-256'];
  const appSecret = process.env.WHATSAPP_APP_SECRET;

  if (!appSecret) {
    console.warn('⚠️ WHATSAPP_APP_SECRET not set. Skipping signature validation. (NOT RECOMMENDED FOR PRODUCTION)');
    return next();
  }

  if (!signaturePath || !req.rawBody) {
    console.warn('⚠️ Missing webhook signature or raw body');
    return res.status(403).send('Signature missing');
  }

  const signature = signaturePath.split('sha256=')[1];
  const expectedHash = crypto
    .createHmac('sha256', appSecret)
    .update(req.rawBody)
    .digest('hex');

  // Use crypto.timingSafeEqual to prevent timing attacks
  try {
    if (!crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expectedHash, 'hex'))) {
      console.warn('❌ Webhook signature mismatch');
      return res.status(403).send('Invalid signature');
    }
  } catch (err) {
    console.warn('❌ Error verifying signature:', err.message);
    return res.status(403).send('Verification failed');
  }

  next();
}

// Webhook verification (Meta sends GET to verify your endpoint)
router.get('/', verifyWebhook);

// Incoming messages (Meta sends POST with message payloads)
router.post('/', verifyMetaSignature, handleIncoming);

module.exports = router;
