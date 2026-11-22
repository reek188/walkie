const fs = require('fs');
const path = require('path');
const express = require('express');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const app = express();
app.use(express.static(path.join(__dirname, 'public')));

// If key.pem + cert.pem exist, serve HTTPS (needed for mic access from other devices on your LAN)
const useHttps = fs.existsSync('key.pem') && fs.existsSync('cert.pem');
const server = useHttps
  ? require('https').createServer({ key: fs.readFileSync('key.pem'), cert: fs.readFileSync('cert.pem') }, app)
  : require('http').createServer(app);

const wss = new WebSocketServer({ server });
const speakers = new Set(); // everyone currently holding the talk button (any number)
let nextId = 0;

const send = (ws, obj) => ws.readyState === 1 && ws.send(JSON.stringify(obj));
const broadcast = (obj) => wss.clients.forEach((c) => c.name && send(c, obj));
const sendUsers = () =>
  broadcast({ type: 'users', users: [...wss.clients].filter((c) => c.name).map((c) => c.name) });
const sendSpeakers = () =>
  broadcast({ type: 'speakers', speakers: [...speakers].map((s) => ({ id: s.id, name: s.name })) });

wss.on('connection', (ws) => {
  ws.id = nextId++ % 256; // 1-byte sender id, used to tag audio so clients can mix voices separately

  ws.on('message', (data, isBinary) => {
    // Audio chunk: tag with sender id, relay to everyone except the sender
    if (isBinary) {
      if (!speakers.has(ws)) return;
      const tagged = Buffer.concat([Buffer.from([ws.id]), data]);
      wss.clients.forEach((c) => c !== ws && c.name && c.readyState === 1 && c.send(tagged, { binary: true }));
      return;
    }

    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }

    if (msg.type === 'join') {
      ws.name = String(msg.name || '').trim().slice(0, 24) || 'Anonymous';
      send(ws, { type: 'joined', name: ws.name, id: ws.id });
      sendUsers();
      sendSpeakers();
      return;
    }
    if (!ws.name) return;

    if (msg.type === 'start') {
      speakers.add(ws);
      send(ws, { type: 'granted' });
      sendSpeakers();
    } else if (msg.type === 'stop' && speakers.delete(ws)) {
      sendSpeakers();
    }
  });

  ws.on('close', () => {
    if (speakers.delete(ws)) sendSpeakers();
    sendUsers();
  });
});

server.listen(PORT, () => {
  console.log(`Walkie running on ${useHttps ? 'https' : 'http'}://localhost:${PORT}`);
});
