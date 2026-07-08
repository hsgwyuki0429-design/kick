/* ai.js — CPU対戦の思考ルーチン。スタミナ管理・ジャストガード・カウンターも行う */
class CpuBrain {
  constructor(match) {
    this.match = match;
    this.thinkT = 1.2;
    this.guard = null;
    this.now = 0;
    this.pendingReactions = [];
  }

  /* ブロック成否。成功時は { just } を返す(ジャストガードなら相手に大きな隙) */
  blocks(zone) {
    if (this.guard && this.now < this.guard.until && this.guard.zone === zone) {
      return { just: !!this.guard.just };
    }
    return null;
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
          // 反応ガードは一部がジャストガード扱い(タイミングが完璧だった想定)
          this.guard = { zone: r.zone, until: this.now + 0.55, just: Math.random() < 0.28 };
          this.match.showCpuGuard(r.zone, 0.55);
        }
      }
    }

    if (!canAct) return;

    this.thinkT -= dt;
    if (this.thinkT > 0) return;
    this.thinkT = 0.55 + Math.random() * 0.75;

    const sta = this.match.opp.sta;
    const hasCounter = performance.now() < this.match.opp.counterUntil;

    // カウンター権を持っている間は積極的に強打を狙う
    if (hasCounter && Math.random() < 0.85) {
      const type = Math.random() < 0.5 ? 'hook' : 'uppercut';
      this.match.cpuPunch(Math.random() < 0.5 ? 'L' : 'R', type);
      return;
    }

    // スタミナが減るほど攻撃頻度を落とし、守りと回復に回る
    const punchP = sta > 60 ? 0.62 : sta > 30 ? 0.42 : 0.18;
    const r = Math.random();
    if (r < punchP) {
      const p = Math.random();
      const type = p < 0.42 ? 'straight' : p < 0.64 ? 'body' : p < 0.84 ? 'hook' : 'uppercut';
      const side = Math.random() < 0.5 ? 'L' : 'R';
      this.match.cpuPunch(side, type);
    } else if (r < punchP + 0.23) {
      // 先読みガード(置きガードなのでジャスト扱いにはしない)
      const zones = ['face', 'belly', 'chestL', 'chestR'];
      const zone = zones[Math.floor(Math.random() * zones.length)];
      const dur = 0.5 + Math.random() * 0.6;
      this.guard = { zone, until: this.now + dur, just: false };
      this.match.showCpuGuard(zone, dur);
    }
  }

  /* ジャストガード成功直後: すぐカウンターを打ちに行く */
  onJustBlock() {
    this.thinkT = Math.min(this.thinkT, 0.25);
  }

  onStunned() {
    this.guard = null;
    this.pendingReactions.length = 0;
  }
}
