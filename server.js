const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');

const PORT    = 3000;
const API_KEY = process.env.GROQ_API_KEY || '';
if (!API_KEY) console.warn('WARNING: GROQ_API_KEY is not set! Add it to your .env file.');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css' : 'text/css',
  '.js'  : 'application/javascript',
  '.json': 'application/json',
  '.ico' : 'image/x-icon',
  '.png' : 'image/png',
};

const rateLimits = new Map();
function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateLimits.get(ip) || { count: 0, reset: now + 60000 };
  if (now > entry.reset) { entry.count = 0; entry.reset = now + 60000; }
  entry.count++;
  rateLimits.set(ip, entry);
  return entry.count > 20;
}

const server = http.createServer((req, res) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  if (req.method === 'POST' && req.url === '/api/chat') {
    if (isRateLimited(ip)) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Too many messages. Please wait a minute.' }));
    }

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      let parsed;
      try { parsed = JSON.parse(body); }
      catch { res.writeHead(400); return res.end(JSON.stringify({ error: 'Invalid JSON' })); }

      const { messages, system } = parsed;

      const groqMessages = [
        { role: 'system', content: system || 'You are a helpful AI tutor for students.' },
        ...messages.slice(-10)
      ];

      const payload = JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: groqMessages,
        max_tokens: 1024,
        temperature: 0.7,
      });

      const options = {
        hostname: 'api.groq.com',
        path: '/openai/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + API_KEY,
          'Content-Length': Buffer.byteLength(payload),
        },
      };

      const apiReq = https.request(options, apiRes => {
        let data = '';
        apiRes.on('data', chunk => data += chunk);
        apiRes.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.error) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              return res.end(JSON.stringify({ error: json.error.message }));
            }
            const text = json.choices[0].message.content;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ text }));
          } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Parse error: ' + e.message }));
          }
        });
      });

      apiReq.on('error', err => {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      });

      apiReq.write(payload);
      apiReq.end();
    });
    return;
  }

  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(__dirname, 'public', urlPath);

  if (!filePath.startsWith(path.join(__dirname, 'public'))) {
    res.writeHead(403); return res.end('Forbidden');
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404); res.end('404 Not Found');
    } else {
      const ext = path.extname(filePath);
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
      res.end(content);
    }
  });
});

server.listen(PORT, () => {
  console.log('\n  ✦  Student Helping AI running with Groq!\n  →  http://localhost:' + PORT + '\n');
});