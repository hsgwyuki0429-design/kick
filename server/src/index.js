import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { WebSocketServer } from "ws";
import { Room, randomRoomCode } from "./room.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIR = path.join(__dirname, "..", "..", "client");
const SHARED_DIR = path.join(__dirname, "..", "..", "shared");
const PORT = process.env.PORT || 8787;

const app = express();
app.use(express.static(CLIENT_DIR));
// The client imports shared/matchLogic.js via a relative path ("../../shared/..."),
// which resolves to /shared/... once served from the client's root - serve it there.
app.use("/shared", express.static(SHARED_DIR));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

const rooms = new Map(); // code -> Room
let quickQueue = null; // Room waiting for a 2nd quick-match player

function freshCode() {
  let code;
  do { code = randomRoomCode(); } while (rooms.has(code));
  return code;
}

function joinRoom(ws, requestedCode) {
  let room;
  if (requestedCode) {
    room = rooms.get(requestedCode);
    if (!room || room.isFull()) {
      room = new Room(requestedCode);
      rooms.set(requestedCode, room);
    }
  } else {
    if (quickQueue && !quickQueue.isFull()) {
      room = quickQueue;
    } else {
      room = new Room(freshCode());
      rooms.set(room.code, room);
      quickQueue = room;
    }
  }

  const index = room.addPlayer(ws);
  ws.send(JSON.stringify({ type: "joined", roomCode: room.code, you: index === 0 ? "a" : "b" }));

  if (room.isFull()) {
    if (quickQueue === room) quickQueue = null;
    room.begin();
  } else {
    ws.send(JSON.stringify({ type: "waiting" }));
  }
}

wss.on("connection", (ws) => {
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (!msg || typeof msg.type !== "string") return;

    switch (msg.type) {
      case "join": {
        if (ws.room) return; // already joined
        const code = typeof msg.roomCode === "string" ? msg.roomCode.trim().toUpperCase().slice(0, 8) : null;
        joinRoom(ws, code || null);
        break;
      }
      case "punch":
        if (ws.room) ws.room.handlePunch(ws.playerIndex, msg);
        break;
      case "block":
        if (ws.room) ws.room.handleBlock(ws.playerIndex, !!msg.active);
        break;
      case "ready":
        if (ws.room) ws.room.handleReady(ws.playerIndex);
        break;
      default:
        break;
    }
  });

  ws.on("close", () => {
    if (ws.room) {
      ws.room.handleDisconnect(ws.playerIndex);
      if (rooms.get(ws.room.code) === ws.room) rooms.delete(ws.room.code);
      if (quickQueue === ws.room) quickQueue = null;
    }
  });
});

// Drop dead connections so abandoned rooms get cleaned up.
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);
wss.on("close", () => clearInterval(heartbeat));

server.listen(PORT, () => {
  console.log(`Boxing server listening on http://localhost:${PORT}`);
});
