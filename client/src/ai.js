// Simple offline CPU opponent used for the practice mode. Not part of the
// online netcode -- online matches are driven entirely by the remote
// player's real input via netClient.js.

const HAND_CHOICES = ["L", "R"];
const TYPE_WEIGHTS = [
  ["straight", 0.45],
  ["hook", 0.3],
  ["uppercut", 0.25],
];

function pickWeighted(pairs) {
  const r = Math.random();
  let acc = 0;
  for (const [value, w] of pairs) {
    acc += w;
    if (r <= acc) return value;
  }
  return pairs[0][0];
}

export class CpuOpponent {
  constructor({ onTelegraph, onPunch, onBlockChange, getOwnHp }) {
    this.onTelegraph = onTelegraph;
    this.onPunch = onPunch;
    this.onBlockChange = onBlockChange;
    this.getOwnHp = getOwnHp;
    this.timers = [];
    this.blocking = false;
  }

  start() {
    this.stop();
    this._scheduleAttack();
    this._scheduleBlockToggle();
  }

  stop() {
    for (const id of this.timers) clearTimeout(id);
    this.timers = [];
    if (this.blocking) {
      this.blocking = false;
      this.onBlockChange?.(false);
    }
  }

  _t(fn, ms) {
    const id = setTimeout(() => {
      this.timers = this.timers.filter((x) => x !== id);
      fn();
    }, ms);
    this.timers.push(id);
    return id;
  }

  _scheduleAttack() {
    const hp = this.getOwnHp?.() ?? 100;
    const aggression = hp < 35 ? 0.7 : 1; // slightly slower / more cautious when hurt
    const delay = (900 + Math.random() * 1300) / aggression;
    this._t(() => {
      const hand = HAND_CHOICES[Math.floor(Math.random() * 2)];
      const type = pickWeighted(TYPE_WEIGHTS);
      this.onTelegraph?.(hand, type);
      const telegraphMs = 380 + Math.random() * 260;
      this._t(() => {
        if (!this.blocking) {
          const power = 0.5 + Math.random() * 0.5;
          this.onPunch?.(hand, type, power);
        }
        this._scheduleAttack();
      }, telegraphMs);
    }, delay);
  }

  _scheduleBlockToggle() {
    const hp = this.getOwnHp?.() ?? 100;
    const blockChance = hp < 35 ? 0.55 : 0.3;
    const delay = 1400 + Math.random() * 1800;
    this._t(() => {
      if (!this.blocking && Math.random() < blockChance) {
        this.blocking = true;
        this.onBlockChange?.(true);
        const holdMs = 500 + Math.random() * 700;
        this._t(() => {
          this.blocking = false;
          this.onBlockChange?.(false);
          this._scheduleBlockToggle();
        }, holdMs);
      } else {
        this._scheduleBlockToggle();
      }
    }, delay);
  }
}
