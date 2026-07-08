// Thin WebSocket wrapper for online matches. The server is authoritative
// for HP/knockdown/KO resolution; this client just sends the player's
// actions and reacts to the state/events the server broadcasts back.

function wsUrlFromLocation() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/ws`;
}

export class NetClient {
  constructor(handlers = {}) {
    this.handlers = handlers;
    this.ws = null;
    this.connected = false;
  }

  connect(roomCode) {
    return new Promise((resolve, reject) => {
      const url = wsUrlFromLocation();
      let settled = false;
      const ws = new WebSocket(url);
      this.ws = ws;

      const failTimer = setTimeout(() => {
        if (!settled) { settled = true; reject(new Error("接続がタイムアウトしました")); ws.close(); }
      }, 8000);

      ws.onopen = () => {
        this.connected = true;
        ws.send(JSON.stringify({ type: "join", roomCode: roomCode || undefined }));
      };
      ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.type === "joined" && !settled) {
          settled = true;
          clearTimeout(failTimer);
          resolve(msg);
        }
        this.handlers.onMessage?.(msg);
      };
      ws.onerror = () => {
        if (!settled) { settled = true; clearTimeout(failTimer); reject(new Error("接続エラー")); }
      };
      ws.onclose = () => {
        this.connected = false;
        this.handlers.onClose?.();
        if (!settled) { settled = true; clearTimeout(failTimer); reject(new Error("切断されました")); }
      };
    });
  }

  sendPunch(hand, punchType, power) {
    this._send({ type: "punch", hand, punchType, power });
  }

  sendBlock(active) {
    this._send({ type: "block", active });
  }

  sendReady() {
    this._send({ type: "ready" });
  }

  _send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  close() {
    this.ws?.close();
    this.ws = null;
    this.connected = false;
  }
}
