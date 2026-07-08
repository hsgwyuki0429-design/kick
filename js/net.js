/* net.js — オンライン対戦クライアント (要件⑧⑨)
 * server.js と JSON メッセージで通信する薄いラッパー。
 */
class Net {
  constructor() {
    this.ws = null;
    this.handlers = {};
    this.connected = false;
  }

  on(type, fn) { this.handlers[type] = fn; return this; }

  emit(type, msg) { this.handlers[type] && this.handlers[type](msg); }

  connect(url, name) {
    return new Promise((resolve, reject) => {
      let settled = false;
      try {
        this.ws = new WebSocket(url);
      } catch (e) {
        reject(new Error('URLが不正です')); return;
      }
      this.ws.onopen = () => this.send({ t: 'hello', name });
      this.ws.onmessage = ev => {
        let m;
        try { m = JSON.parse(ev.data); } catch { return; }
        if (!settled) {
          if (m.t === 'welcome') { settled = true; this.connected = true; resolve(m); }
          else if (m.t === 'nameTaken') { settled = true; this.ws.close(); reject(new Error('nameTaken')); }
          else if (m.t === 'badName') { settled = true; this.ws.close(); reject(new Error('badName')); }
          return;
        }
        this.emit(m.t, m);
      };
      this.ws.onerror = () => {
        if (!settled) { settled = true; reject(new Error('サーバーに接続できません')); }
      };
      this.ws.onclose = () => {
        const was = this.connected;
        this.connected = false;
        if (!settled) { settled = true; reject(new Error('サーバーに接続できません')); }
        else if (was) this.emit('disconnected', {});
      };
    });
  }

  send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  join(pass)       { this.send({ t: 'join', pass }); }
  leaveRoom()      { this.send({ t: 'leave' }); }
  challenge(to)    { this.send({ t: 'challenge', to }); }
  accept(from)     { this.send({ t: 'accept', from }); }
  decline(from)    { this.send({ t: 'decline', from }); }
  game(d)          { this.send({ t: 'game', d }); }
  endMatch()       { this.send({ t: 'endMatch' }); }

  close() {
    this.connected = false;
    if (this.ws) { try { this.ws.close(); } catch {} this.ws = null; }
  }
}
