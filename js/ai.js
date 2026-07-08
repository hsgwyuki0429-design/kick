/* ai.js — CPU対戦の思考ルーチン (要件②)
 * Match からは「もう一人のプレイヤー」として振る舞う:
 *  - match.enemyPunch(side, type) を呼んでパンチ
 *  - guardZone にゾーンを入れるとそのゾーンへの攻撃をブロック
 */
class CpuBrain {
  constructor(match) {
    this.match = match;
    this.thinkT = 1.2;       // 開始直後は少し待つ
    this.guard = null;       // {zone, until}
    this.now = 0;
    this.pendingReactions = [];
  }

  /* 自分(CPU)が今このゾーンをガードしているか */
  blocks(zone) {
    return !!(this.guard && this.now < this.guard.until && this.guard.zone === zone);
  }

  /* プレイヤーがパンチを出した瞬間に呼ばれる → 反応ガード */
  onPlayerPunch(zone, impactIn) {
    if (Math.random() > 0.34) return; // 反応率
    const reaction = 0.12 + Math.random() * 0.14;
    if (reaction >= impactIn) return; // 間に合わない
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
      // パンチ: ストレート多め、たまに大技
      const p = Math.random();
      const type = p < 0.42 ? 'straight' : p < 0.64 ? 'body' : p < 0.84 ? 'hook' : 'uppercut';
      const side = Math.random() < 0.5 ? 'L' : 'R';
      this.match.enemyPunch(side, type);
    } else if (r < 0.85) {
      // 先読みガード
      const zones = ['face', 'face', 'chestL', 'chestR'];
      const zone = zones[Math.floor(Math.random() * zones.length)];
      const dur = 0.5 + Math.random() * 0.6;
      this.guard = { zone, until: this.now + dur };
      this.match.showCpuGuard(zone, dur);
    }
    // 残りは様子見
  }

  /* CPUがスタンさせられた → ガード解除 (要件⑥) */
  onStunned() {
    this.guard = null;
    this.pendingReactions.length = 0;
  }
}
