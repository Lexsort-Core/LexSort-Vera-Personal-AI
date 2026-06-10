const http = require('http');
const { init: initGuardian } = require('./modules/process-guardian');

initGuardian();

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }
  
  if (req.url === '/chat' && req.method === 'POST') {
    res.setHeader('Content-Type', 'text/event-stream');
    const options = { hostname: '127.0.0.1', port: 11434, path: '/api/generate', method: 'POST' };
    const ollamaReq = http.request(options, (ollamaRes) => {
      ollamaRes.on('data', (chunk) => {
        try {
          const json = JSON.parse(chunk);
          res.write(`data: ${JSON.stringify({ token: json.response })}\n\n`);
          if (json.done) res.end();
        } catch (e) {}
      });
    });
    req.on('data', (d) => ollamaReq.write(d));
    req.on('end', () => ollamaReq.end());
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(58732, '127.0.0.1');
