/* server.js — FIST FURY 3D 対戦サーバー
 * 役割:
 *  - ゲーム本体(静的ファイル)のHTTP配信
 *  - WebSocket: 名前の重複禁止(要件⑨) / 合言葉ルーム(要件⑧) / 対戦申請・承認 / 二人だけなら自動開始 / 試合メッセージ中継
 * 起動: npm install && npm start  → http://localhost:8787
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8787;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json',
};

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(__dirname, path.normalize(p));
  if (!file.startsWith(__dirname)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server, maxPayload: 1024 * 1024 });

const byName = new Map(); // name -> ws (接続中の名前は重複禁止)
const rooms = new Map();  // 合言葉 -> Set<ws>

const send = (ws, obj) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); };

function roomMembers(pass) {
  const set = rooms.get(pass);
  if (!set) return [];
  return [...set].map(w => ({ name: w.name, busy: !!w.peer }));
}

function broadcastRoom(pass) {
  const set = rooms.get(pass);
  if (!set) return;
  const msg = { t: 'room', room: pass, members: roomMembers(pass) };
  for (const w of set) send(w, msg);
}

function leaveRoom(ws, notify = true) {
  const pass = ws.room;
  if (!pass) return;
  const set = rooms.get(pass);
  if (set) {
    set.delete(ws);
    if (set.size === 0) rooms.delete(pass);
    else if (notify) broadcastRoom(pass);
  }
  ws.room = null;
}

function startMatch(a, b) {
  a.peer = b; b.peer = a;
  send(a, { t: 'matchStart', opponent: b.name, youAre: 'A' });
  send(b, { t: 'matchStart', opponent: a.name, youAre: 'B' });
  if (a.room) broadcastRoom(a.room);
}

function endMatch(ws) {
  const peer = ws.peer;
  ws.peer = null;
  if (peer && peer.peer === ws) peer.peer = null;
  if (ws.room) broadcastRoom(ws.room);
}

wss.on('connection', ws => {
  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }

    switch (m.t) {
      case 'hello': { // 名前登録。重複は拒否 (要件⑨)
        const name = String(m.name || '').trim();
        if (name.length < 1 || name.length > 12) { send(ws, { t: 'badName' }); return; }
        if (byName.has(name)) { send(ws, { t: 'nameTaken' }); return; }
        ws.name = name;
        byName.set(name, ws);
        send(ws, { t: 'welcome', name });
        break;
      }
      case 'join': { // 合言葉 = 部屋 (要件⑧)
        if (!ws.name || ws.peer) return;
        const pass = String(m.pass || '').trim().slice(0, 24);
        if (!pass) return;
        leaveRoom(ws);
        if (!rooms.has(pass)) rooms.set(pass, new Set());
        rooms.get(pass).add(ws);
        ws.room = pass;
        broadcastRoom(pass);
        // 部屋に二人しかいなければ自動で対戦開始 (要件⑧)
        const free = [...rooms.get(pass)].filter(w => !w.peer);
        if (rooms.get(pass).size === 2 && free.length === 2) startMatch(free[0], free[1]);
        break;
      }
      case 'challenge': { // 対戦申請 (要件⑧)
        if (!ws.name || ws.peer || !ws.room) return;
        const to = byName.get(String(m.to || ''));
        if (to && to !== ws && to.room === ws.room && !to.peer) {
          send(to, { t: 'challenged', from: ws.name });
        }
        break;
      }
      case 'accept': {
        const from = byName.get(String(m.from || ''));
        if (from && from !== ws && from.room === ws.room && !from.peer && !ws.peer) {
          startMatch(from, ws);
        }
        break;
      }
      case 'decline': {
        const from = byName.get(String(m.from || ''));
        if (from) send(from, { t: 'declined', by: ws.name });
        break;
      }
      case 'game': // 試合中メッセージの中継
        if (ws.peer) send(ws.peer, { t: 'game', d: m.d });
        break;
      case 'endMatch':
        endMatch(ws);
        break;
      case 'leave':
        leaveRoom(ws);
        break;
    }
  });

  ws.on('close', () => {
    if (ws.peer) {
      send(ws.peer, { t: 'opponentLeft' });
      endMatch(ws);
    }
    leaveRoom(ws);
    if (ws.name && byName.get(ws.name) === ws) byName.delete(ws.name);
  });
});

server.listen(PORT, () => {
  console.log(`FIST FURY 3D server: http://localhost:${PORT}`);
});
