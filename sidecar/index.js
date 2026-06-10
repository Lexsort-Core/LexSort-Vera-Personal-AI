const http = require('http');
const { init: initGuardian } = require('./modules/process-guardian');
const { getHardwareProfile } = require('./modules/hardware-profiler');
const { getSelectedModel } = require('./modules/quantization-selector');
const { checkHealth } = require('./modules/ollama-manager');
const { db } = require('./modules/conversation-store');

initGuardian();

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:58732');
  
  // Existing /health, /profile, /chat endpoints...
  // Adding Vault endpoints:
  if (req.url === '/vault/count') {
    const row = db.prepare('SELECT COUNT(*) as count FROM conversations').get();
    res.end(JSON.stringify(row));
  } else if (req.url === '/vault' && req.method === 'DELETE') {
    db.exec('DELETE FROM messages; DELETE FROM conversations;');
    res.end(JSON.stringify({ cleared: true }));
  } else {
    // Fallback logic from previous step
    res.end();
  }
});

server.listen(58732, '127.0.0.1');
