/* ai.js — CPU対戦の思考ルーチン */
class CpuBrain {
  constructor(match) {
    this.match = match;
    this.thinkT = 1.2;
    this.guard = null;
    this.now = 0;
    this.pendingReactions = [];
  }

  blocks(zone) {
    return !!(this.guard && this.now < this.guard.until && this.guard.zone === zone);
  }

  onPlayerPunch(zone, impactIn) {
    if (Math.random() > 0.34) return;
    const reaction = 0.12 + Math.random() * 0.14;
    if (reaction >= impactIn) return;
    this.pendingReactions.push({ at: this.now + reaction, zone });
  }

  update(dt, canAct) {
    this.now += dt;

    for (let i = this.pendingReactions.length - 1; i >= 0; i--) {
      const r = this.pendingReactions[i];
      if (this.now >= r.at) {
        this.pendingReactions.splice(i, 1);
        if (canAct && !this.match.oppBoxer.isPunching()) {
          this.guard = { zone: r.zone, until: this.now + 0.55 };
          this.match.showCpuGuard(r.zone, 0.55);
        }
      }
    }

    if (!canAct) return;

    this.thinkT -= dt;
    if (this.thinkT > 0) return;
    this.thinkT = 0.55 + Math.random() * 0.75;

    const r = Math.random();
    if (r < 0.62) {
      const p = Math.random();
      const type = p < 0.42 ? 'straight' : p < 0.64 ? 'body' : p < 0.84 ? 'hook' : 'uppercut';
      const side = Math.random() < 0.5 ? 'L' : 'R';
      this.match.enemyPunch(side, type);
    } else if (r < 0.85) {
      // 先読みガード（腹も候補に追加）
      const zones = ['face', 'belly', 'chestL', 'chestR'];
      const zone = zones[Math.floor(Math.random() * zones.length)];
      const dur = 0.5 + Math.random() * 0.6;
      this.guard = { zone, until: this.now + dur };
      this.match.showCpuGuard(zone, dur);
    }
  }

  onStunned() {
    this.guard = null;
    this.pendingReactions.length = 0;
  }
}