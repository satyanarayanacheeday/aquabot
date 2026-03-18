const express = require('express');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config();

const helmet = require('helmet');
const morgan = require('morgan');
const hpp = require('hpp');
const webhookRoutes = require('./src/routes/webhook');
const { handleIncoming } = require('./src/controllers/webhookController');
const eventBus = require('./src/utils/eventBus');

const app = express();
const PORT = process.env.PORT || 3000;

// Standard JSON parsing with raw body access for webhook signatures
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

// Security 
app.use(helmet({ contentSecurityPolicy: false }));
app.use(hpp());
app.use(morgan('dev'));

// Serve static frontend
app.use(express.static(path.join(__dirname, 'public')));

// SSE Connections
const clients = new Set();

app.get('/api/test/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  clients.add(res);
  console.log(`🔌 [SSE] Connected. Total: ${clients.size}`);
  
  // Send initial keep-alive
  res.write(': keep-alive\n\n');

  req.on('close', () => {
    clients.delete(res);
    console.log(`🔌 [SSE] Disconnected. Remaining: ${clients.size}`);
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
  
  console.log(`💬 [Local Test] Input from ${phone}: "${text}"`);

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
  console.log(`📡 [SSE] Broadcasting to ${clients.size} clients for ${to}`);
  const payload = JSON.stringify({ to, text });
  for (const client of clients) {
    try {
      client.write(`data: ${payload}\n\n`);
    } catch (err) {
      console.error('❌ Failed to write to SSE client:', err.message);
    }
  }
});

app.use('/webhook', webhookRoutes);

app.listen(PORT, () => {
  console.log(`🚀 STABLE SERVER RUNNING ON PORT ${PORT}`);
});

// Minimal fatal error logging
process.on('uncaughtException', (err) => {
  console.error('🚨 UNCAUGHT EXCEPTION:', err.stack || err);
});
process.on('unhandledRejection', (reason) => {
  console.error('🚨 UNHANDLED REJECTION:', reason);
});
