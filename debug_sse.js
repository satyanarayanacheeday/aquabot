const express = require('express');
const app = express();
const clients = new Set();

app.get('/stream', (req, res) => {
  console.log('🔌 Client connecting to /stream');
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  clients.add(res);
  res.write('data: {"msg": "connected"}\n\n');
  
  req.on('close', () => {
    console.log('🔌 Client disconnected');
    clients.delete(res);
  });
});

app.listen(3005, () => {
  console.log('🚀 Debug server on port 3005');
});
