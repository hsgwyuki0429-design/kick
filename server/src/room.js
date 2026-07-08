import { createMatchState, applyDamage, computeDamage } from "../../shared/matchLogic.js";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I

export function randomRoomCode(len = 4) {
  let s = "";
  for (let i = 0; i < len; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

function send(ws, obj) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

export class Room {
  constructor(code) {
    this.code = code;
    this.players = []; // [ws, ws]
    this.state = [null, null]; // MatchState per player index
    this.blocking = [false, false];
    this.readyForRematch = [false, false];
    this.finished = false;
  }

  isFull() {
    return this.players.length >= 2;
  }

  addPlayer(ws) {
    const index = this.players.length;
    this.players.push(ws);
    ws.room = this;
    ws.playerIndex = index;
    return index;
  }

  otherIndex(index) {
    return index === 0 ? 1 : 0;
  }

  begin() {
    this.state = [createMatchState(), createMatchState()];
    this.blocking = [false, false];
    this.readyForRematch = [false, false];
    this.finished = false;
    for (const ws of this.players) send(ws, { type: "start" });
  }

  handlePunch(index, { hand, punchType, power }) {
    if (this.finished || !this.isFull()) return;
    const defenderIndex = this.otherIndex(index);
    const safePower = clamp01(Number(power) || 0);
    const safeType = ["straight", "hook", "uppercut"].includes(punchType) ? punchType : "straight";
    const safeHand = hand === "L" ? "L" : "R";

    const rawDamage = computeDamage(safeType, safePower);
    const result = applyDamage(this.state[defenderIndex], rawDamage, this.blocking[defenderIndex]);

    // Personalized "hit" event: from each recipient's perspective, who took the damage.
    send(this.players[index], {
      type: "hit", target: "opp", hand: safeHand, punchType: safeType, ...result,
    });
    send(this.players[defenderIndex], {
      type: "hit", target: "you", hand: safeHand, punchType: safeType, ...result,
    });

    this._broadcastState();

    if (result.ko) {
      this.finished = true;
      send(this.players[index], { type: "ko", winner: "opp" });
      send(this.players[defenderIndex], { type: "ko", winner: "you" });
    }
  }

  handleBlock(index, active) {
    this.blocking[index] = !!active;
    const other = this.players[this.otherIndex(index)];
    send(other, { type: "opponentBlock", active: this.blocking[index] });
  }

  handleReady(index) {
    this.readyForRematch[index] = true;
    if (this.players.length === 2 && this.readyForRematch[0] && this.readyForRematch[1]) {
      this.begin();
    }
  }

  handleDisconnect(index) {
    this.finished = true;
    const other = this.players[this.otherIndex(index)];
    send(other, { type: "opponentLeft" });
  }

  _broadcastState() {
    for (let i = 0; i < this.players.length; i++) {
      const other = this.otherIndex(i);
      send(this.players[i], {
        type: "state",
        you: { hp: this.state[i].hp, knockdowns: this.state[i].knockdowns },
        opp: { hp: this.state[other].hp, knockdowns: this.state[other].knockdowns },
      });
    }
  }
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}
