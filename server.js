const express = require('express');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config();

const logger = require('./src/utils/logger');

// ========================
// ENVIRONMENT VALIDATION — fail fast
// ========================
const REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_KEY', 'GEMINI_API_KEY', 'WHATSAPP_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'VERIFY_TOKEN'];
const missing = REQUIRED_ENV.filter(key => !process.env[key] || process.env[key].startsWith('your_'));

if (missing.length > 0 && process.env.NODE_ENV === 'production') {
  logger.error(`❌ Missing required environment variables: ${missing.join(', ')}`);
  logger.error('   Copy .env.example to .env and fill in your credentials.');
  process.exit(1);
}
if (missing.length > 0) {
  logger.warn(`⚠️ Missing env vars (non-production): ${missing.join(', ')} — some features may not work`);
}

// Production security check
if (process.env.NODE_ENV === 'production' && !process.env.WHATSAPP_APP_SECRET) {
  logger.error('❌ WHATSAPP_APP_SECRET is required in production for webhook signature validation.');
  process.exit(1);
}

const helmet = require('helmet');
const morgan = require('morgan');
const hpp = require('hpp');
const webhookRoutes = require('./src/routes/webhook');
const { handleIncoming } = require('./src/controllers/webhookController');
const eventBus = require('./src/utils/eventBus');
const { startScheduler } = require('./src/utils/scheduler');
const { getActiveSessionCount } = require('./src/state/conversationState');

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';

// Trust reverse proxies (needed for rate-limiting behind Ngrok/Render)
app.set('trust proxy', 1);

// Standard JSON parsing with raw body access for webhook signatures
app.use(express.json({
  limit: '1mb',
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

// Security
app.use(helmet({ contentSecurityPolicy: false }));
app.use(hpp());

// Logging: concise in production, verbose in dev
app.use(morgan(isProduction ? 'combined' : 'dev', {
  stream: { write: (msg) => logger.info(msg.trim()) },
  skip: (req) => req.url === '/health',  // Don't log health checks
}));

// ========================
// HEALTH CHECK (for load balancers, Docker, uptime monitors)
// ========================
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    version: require('./package.json').version,
    environment: process.env.NODE_ENV || 'development',
    memory: {
      rss: Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB',
      heap: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
    },
    activeSessions: getActiveSessionCount(),
    timestamp: new Date().toISOString(),
  });
});

// ========================
// WEBHOOK ROUTES (production API)
// ========================
app.use('/webhook', webhookRoutes);

// ========================
// STATIC FRONTEND (served in all environments)
// ========================
app.use(express.static(path.join(__dirname, 'public')));

// ========================
// TEST UI — SSE stream + send (all environments)
// ========================

// SSE Connections for test UI
const clients = new Set();

app.get('/api/test/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  clients.add(res);
  logger.debug(`🔌 [SSE] Connected. Total: ${clients.size}`);

  res.write(': keep-alive\n\n');

  req.on('close', () => {
    clients.delete(res);
    logger.debug(`🔌 [SSE] Disconnected. Remaining: ${clients.size}`);
  });
});

// Heartbeat to keep SSE alive every 20s
setInterval(() => {
  for (const client of clients) {
    client.write(': keep-alive\n\n');
  }
}, 20000);

app.post('/api/test/send', (req, res) => {
  const { phone, text } = req.body;
  if (!phone || !text) return res.status(400).send('Missing phone or text');

  logger.info(`💬 [Test UI] Input from ${phone}: "${text}"`);

  const mockPayload = {
    object: 'whatsapp_business_account',
    entry: [{
      changes: [{
        value: {
          messages: [{
            from: phone,
            id: 'mock_' + Date.now(),
            type: 'text',
            text: { body: text }
          }]
        }
      }]
    }]
  };

  handleIncoming({ body: mockPayload }, { sendStatus: () => {} });
  res.sendStatus(200);
});

eventBus.on('message', (data) => {
  const { to, text } = data;
  const payload = JSON.stringify({ to, text });
  for (const client of clients) {
    try {
      client.write(`data: ${payload}\n\n`);
    } catch (err) {
      logger.error('Failed to write to SSE client', { error: err.message });
    }
  }
});

logger.info('🧪 Test UI enabled at /');


// ========================
// 404 HANDLER
// ========================
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ========================
// GLOBAL ERROR HANDLER
// ========================
app.use((err, req, res, next) => {
  logger.error('Unhandled Express error', { error: err.message, stack: err.stack, url: req.url });
  res.status(500).json({ error: 'Internal server error' });
});

// ========================
// START SERVER
// ========================
const server = app.listen(PORT, () => {
  logger.info(`🚀 AQUORIX v${require('./package.json').version} running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);
  startScheduler();
});

// ========================
// GRACEFUL SHUTDOWN
// ========================
let isShuttingDown = false;

function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info(`${signal} received. Starting graceful shutdown...`);

  // Stop accepting new connections
  server.close(() => {
    logger.info('✅ HTTP server closed');
    process.exit(0);
  });

  // Force shutdown after 10 seconds if connections don't close
  setTimeout(() => {
    logger.error('⚠️ Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Fatal error logging
process.on('uncaughtException', (err) => {
  logger.error('🚨 UNCAUGHT EXCEPTION', { error: err.message, stack: err.stack });
  if (isProduction) process.exit(1); // In production, crash and let the process manager restart
});

process.on('unhandledRejection', (reason) => {
  logger.error('🚨 UNHANDLED REJECTION', { reason: reason?.message || reason });
});
