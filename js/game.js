/* game.js — 試合本体。3Dシーン、パンチ解決、ガード判定、KO、エフェクト、メモリ管理。 */

const Sfx = (() => {
  let ctx = null;
  function ac() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function tone(freq, dur, vol, type = 'sine', slideTo = null) {
    try {
      const c = ac(), t = c.currentTime;
      const o = c.createOscillator(), g = c.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g); g.connect(c.destination);
      o.start(t); o.stop(t + dur + 0.02);
    } catch (e) { }
  }
  return {
    unlock: () => { try { ac(); } catch (e) {} },
    hit:   heavy => { tone(heavy ? 100 : 150, 0.16, 0.5, 'sine', 40); tone(700, 0.05, 0.18, 'square', 200); },
    block: () => tone(320, 0.09, 0.3, 'triangle', 480),
    whoosh:() => tone(900, 0.08, 0.06, 'sawtooth', 300),
    bell:  () => { tone(880, 0.7, 0.35, 'triangle'); tone(1320, 0.5, 0.15, 'sine'); },
    down:  () => tone(220, 0.6, 0.4, 'sawtooth', 55),
  };
})();

const Game = (() => {
  let renderer = null;

  const ANCHORS = {
    face:   [0.5,  1/6],
    belly:  [0.5,  5/6],
    chestL: [0.25, 0.5],
    chestR: [0.75, 0.5]
  };

  function anchorPx(zone) {
    const a = ANCHORS[zone];
    return { x: a[0] * innerWidth, y: a[1] * innerHeight };
  }

  function targetZone(type, side) {
    if (type === 'straight') return side === 'L' ? 'chestR' : 'chestL';
    if (type === 'body')     return side === 'L' ? 'chestL' : 'chestR';
    if (type === 'hook')     return 'belly';
    return 'face';
  }

  function koChance(prevDowns, elapsedSec) {
    return Math.min(0.85, 0.05 + prevDowns * 0.12 + (elapsedSec / 60) * 0.03);
  }

  /* ---- 駆け引き用パラメータ ---- */
  const STA_MAX = 100;
  const STA_COST = { straight: 12, body: 15, uppercut: 19, hook: 22 }; // パンチのスタミナ消費
  const STA_REGEN = 11;        // 通常回復量 (毎秒)
  const STA_REGEN_GUARD = 5;   // ガード中は回復が遅い → ガード固めを抑止
  const TIRED_MUL = 0.45;      // スタミナ切れパンチの威力倍率
  const JUST_WINDOW_MS = 300;  // 出したてのガードで防ぐと「ジャストガード」
  const STUN_MS = 900;         // 通常ブロックされた側の硬直
  const JUST_STUN_MS = 1600;   // ジャストガードされた側の硬直(大きな隙)
  const COUNTER_MS = 2200;     // ジャストガード後のカウンター猶予
  const COUNTER_MUL = 1.6;     // カウンター一発の威力倍率

  class Match {
    constructor(opts) {
      this.mode = opts.mode;
      this.net = opts.net || null;
      this.onEnd = opts.onEnd;
      this.myName = opts.myName;
      this.oppName = opts.oppName;
      this.alive = true;
      this.state = 'intro';
      this.elapsed = 0;
      this.me  = { hp: 100, downs: 0, stunUntil: 0, sta: STA_MAX, counterUntil: 0 };
      this.opp = { hp: 100, downs: 0, stunUntil: 0, sta: STA_MAX, counterUntil: 0 };
      this.timers = [];
      this.shake = 0;
      
      this.lastGuardSend = { L: 0, R: 0 };
      
      // CPUガード競合バグ防止用のID管理
      this.cpuGuardId = 0;

      this.initScene(opts);
      this.initHud();
      this.bindInput();

      if (this.mode === 'cpu') this.cpu = new CpuBrain(this);
      else this.bindNet();

      this.banner('READY...');
      this.after(1.4, () => {
        this.banner('FIGHT!');
        Sfx.bell();
        this.state = 'fight';
        this.after(0.9, () => this.banner(null));
      });

      this.clock = performance.now();
      this.loop = this.loop.bind(this);
      requestAnimationFrame(this.loop);
    }

    initScene(opts) {
      const canvas = document.getElementById('game-canvas');
      if (!renderer) {
        renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      }
      renderer.setSize(innerWidth, innerHeight);

      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(0x0a0c16);
      this.scene.fog = new THREE.Fog(0x0a0c16, 6, 16);

      // 一人称の視野を広めに(75→85): 相手の全身とテレグラフを視認しやすくする
      this.camera = new THREE.PerspectiveCamera(85, innerWidth / innerHeight, 0.05, 50);

      this.scene.add(new THREE.AmbientLight(0x8890b0, 0.9));
      const key = new THREE.DirectionalLight(0xfff2dd, 0.9);
      key.position.set(2, 6, 3);
      this.scene.add(key);
      const spot = new THREE.PointLight(0xffe9c0, 0.8, 12);
      spot.position.set(0, 4.5, 0);
      this.scene.add(spot);
      const back = new THREE.PointLight(0xccd6ff, 0.7, 8);
      back.position.set(0, 2.2, 2.6);
      this.scene.add(back);

      this.buildRing();

      this.myBoxer = Boxer.create({ trunks: 0x2244cc, glove: 0xcc2222, faceURL: opts.myFace });
      this.myBoxer.group.position.set(0, 0, 0.72);
      this.myBoxer.group.rotation.y = Math.PI;
      this.myBoxer.setHeadVisible(false);
      this.scene.add(this.myBoxer.group);

      this.oppBoxer = Boxer.create({ trunks: 0xcc2244, glove: 0x222266, skin: 0xd39a63, faceURL: opts.oppFace });
      this.oppBoxer.group.position.set(0, 0, -0.72);
      this.scene.add(this.oppBoxer.group);

      this.sparks = [];
      this.onResize = () => {
        if (!this.alive) return;
        renderer.setSize(innerWidth, innerHeight);
        this.camera.aspect = innerWidth / innerHeight;
        this.camera.updateProjectionMatrix();
      };
      window.addEventListener('resize', this.onResize);
    }

    buildRing() {
      const floor = new THREE.Mesh(
        new THREE.BoxGeometry(6, 0.3, 6),
        new THREE.MeshLambertMaterial({ color: 0x3a63c0 })
      );
      floor.position.y = -0.15;
      this.scene.add(floor);

      const mat = new THREE.MeshLambertMaterial({ color: 0xdddddd });
      const ropeMat = new THREE.MeshBasicMaterial({ color: 0xff4444 });
      const R = 2.9;
      const corners = [[-R, -R], [R, -R], [R, R], [-R, R]];
      corners.forEach(([x, z]) => {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.4, 8), mat);
        post.position.set(x, 0.7, z);
        this.scene.add(post);
      });
      for (let h = 0; h < 3; h++) {
        const y = 0.5 + h * 0.35;
        for (let i = 0; i < 4; i++) {
          const [x1, z1] = corners[i], [x2, z2] = corners[(i + 1) % 4];
          const len = Math.hypot(x2 - x1, z2 - z1);
          const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, len, 6), ropeMat);
          rope.position.set((x1 + x2) / 2, y, (z1 + z2) / 2);
          rope.rotation.z = Math.PI / 2;
          rope.rotation.y = Math.atan2(z2 - z1, x2 - x1) * -1;
          this.scene.add(rope);
        }
      }
    }

    initHud() {
      document.getElementById('hud-name-me').textContent = this.myName;
      document.getElementById('hud-name-opp').textContent = this.oppName;
      document.getElementById('result-overlay').classList.add('hidden');
      for (const id of ['stun-note', 'just-note', 'counter-note']) {
        document.getElementById(id).classList.add('hidden');
      }
      this.updateHud();
    }

    updateHud() {
      for (const [who, id] of [[this.me, 'me'], [this.opp, 'opp']]) {
        const el = document.getElementById('hp-' + id);
        const pct = Math.max(0, who.hp);
        el.style.width = pct + '%';
        el.className = 'hpfill' + (pct < 25 ? ' danger' : pct < 55 ? ' warn' : '');
        const sta = document.getElementById('sta-' + id);
        sta.style.width = Math.max(0, who.sta) + '%';
        sta.className = 'stafill' + (who.sta < 25 ? ' low' : '');
        document.getElementById('downs-' + id).textContent = '●'.repeat(who.downs);
      }
      document.getElementById('counter-note').classList.toggle(
        'hidden', performance.now() >= this.me.counterUntil || this.state !== 'fight');
      const t = Math.floor(this.elapsed);
      document.getElementById('hud-timer').textContent =
        Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
      document.getElementById('hud-ko').textContent =
        'KO率 ' + Math.round(koChance(Math.max(this.me.downs, this.opp.downs), this.elapsed) * 100) + '%';
    }

    banner(text) {
      const el = document.getElementById('banner');
      if (!text) { el.classList.add('hidden'); return; }
      el.textContent = text;
      el.classList.remove('hidden');
      el.style.animation = 'none';
      void el.offsetWidth;
      el.style.animation = '';
    }

    bindInput() {
      Gesture.attach(document.getElementById('screen-game'), {
        punch: (side, type, sx, sy) => this.onMyPunch(side, type, sx, sy),
        guardStart: (side, nx, ny) => this.onMyGuard(side, nx, ny, true),
        guardMove: (side, nx, ny) => this.onMyGuard(side, nx, ny, false),
        guardEnd: side => {
          this.myBoxer.setGuardTarget(side, null);
          if (this.mode === 'online') this.net.game({ k: 'guard', side, on: false });
        },
      });
      Gesture.setEnabled(true);
    }

    canIAct() {
      return this.state === 'fight' && performance.now() >= this.me.stunUntil && this.me.hp > 0;
    }

    guardLocal(nx, ny) {
      const localX = (0.5 - nx) * 1.2; 
      const localY = 1.7 - ny * 1.0;
      const localZ = 0.35 + (0.5 - Math.abs(0.5 - ny)) * 0.1;
      return new THREE.Vector3(localX, localY, localZ);
    }

    onMyGuard(side, nx, ny, isStart) {
      if (this.state !== 'fight') return;
      if (performance.now() < this.me.stunUntil) return;

      this.myBoxer.setGuardTarget(side, this.guardLocal(nx, ny));
      if (this.mode === 'online') {
        const now = performance.now();
        if (isStart || now - this.lastGuardSend[side] > 80) {
          this.lastGuardSend[side] = now;
          this.net.game({ k: 'guard', side, on: true, nx, ny, sta: Math.round(this.me.sta) });
        }
      }
    }

    /* 相手の各部位をスクリーン座標に投影し、タッチ開始位置に一番近い部位を返す */
    aimZone(px, py) {
      let best = null, bd = Infinity;
      for (const zone of ['face', 'belly', 'chestL', 'chestR']) {
        const v = this.oppBoxer.getZonePos(zone).project(this.camera);
        const sx = (v.x + 1) * innerWidth / 2;
        const sy = (1 - v.y) * innerHeight / 2;
        const d = Math.hypot(sx - px, sy - py);
        if (d < bd) { bd = d; best = zone; }
      }
      return best;
    }

    /* 狙った部位に黄色いリングを一瞬表示して「そこへ飛ぶ」ことを伝える */
    aimFlash(zone) {
      const v = this.oppBoxer.getZonePos(zone).project(this.camera);
      const el = document.createElement('div');
      el.className = 'aim-flash';
      el.style.left = (v.x + 1) * innerWidth / 2 + 'px';
      el.style.top = (1 - v.y) * innerHeight / 2 + 'px';
      document.getElementById('screen-game').appendChild(el);
      this.after(0.35, () => el.remove());
    }

    onMyPunch(side, type, sx, sy) {
      if (!this.canIAct()) return;
      // タッチした位置に近い部位を狙う。座標が無い場合は従来のパンチ種別→部位マップ
      const zone = sx != null ? this.aimZone(sx, sy) : targetZone(type, side);
      const spec = Boxer.PUNCH_SPECS[type];

      // スタミナとカウンター補正: 疲れていると弱く、ジャストガード直後の一発は強い
      const cost = STA_COST[type];
      let mul = 1;
      if (this.me.sta < cost) mul *= TIRED_MUL;
      const counter = performance.now() < this.me.counterUntil;
      if (counter) mul *= COUNTER_MUL;

      const target = this.oppBoxer.getZonePos(zone);
      const started = this.myBoxer.startPunch(side, type, target, () => {
        if (this.mode === 'cpu') this.resolveMyPunchOnCpu(zone, spec, side, mul);
      });
      if (!started) return;
      this.me.sta = Math.max(0, this.me.sta - cost);
      if (counter) this.me.counterUntil = 0; // カウンターは一発限り
      this.aimFlash(zone);
      Sfx.whoosh();
      if (this.mode === 'online') this.net.game({ k: 'punch', side, type, zone, mul, sta: Math.round(this.me.sta) });
      else this.cpu.onPlayerPunch(zone, spec.impact);
    }

    resolveMyPunchOnCpu(zone, spec, side, mul) {
      if (this.state !== 'fight' || !this.alive) return;
      const b = this.cpu.blocks(zone);
      if (b) {
        this.applyBlockedByOpp(side, b.just);
        if (b.just) {
          this.opp.counterUntil = performance.now() + COUNTER_MS;
          this.cpu.onJustBlock();
        }
      } else {
        this.applyHitOnOpp(Math.round(spec.dmg * mul), side);
      }
    }

    applyBlockedByOpp(side, just) {
      const stunMs = just ? JUST_STUN_MS : STUN_MS;
      this.me.stunUntil = performance.now() + stunMs;
      Sfx.block();
      this.spark(this.myBoxer.getGloveWorld(side), just ? 0xffd75e : 0x88ccff);
      const note = document.getElementById('stun-note');
      note.textContent = just ? 'ジャストガードされた! 大きな隙!' : 'ガードされた!';
      note.classList.remove('hidden');

      Gesture.cancelAll(); // 強制キャンセル
      Gesture.setStunned(true);
      this.after(stunMs / 1000, () => {
        if (performance.now() < this.me.stunUntil) return; // 別のブロックでスタンが延長された
        note.classList.add('hidden');
        Gesture.setStunned(false);
      });

      this.myBoxer.setGuardTarget('L', null);
      this.myBoxer.setGuardTarget('R', null);
      if (this.mode === 'online') {
        this.net.game({ k: 'guard', side: 'L', on: false });
        this.net.game({ k: 'guard', side: 'R', on: false });
      }
    }

    applyHitOnOpp(dmg, side, hpFromNet = null) {
      this.opp.hp = hpFromNet !== null ? hpFromNet : Math.max(0, this.opp.hp - dmg);
      Sfx.hit(dmg >= 12);
      this.spark(this.myBoxer.getGloveWorld(side), 0xffdd66);
      this.updateHud();
      if (this.mode === 'cpu' && this.opp.hp <= 0 && this.state === 'fight') this.doDown('opp');
    }

    enemyPunch(side, type, mul = 1, aimedZone = null) {
      if (this.state !== 'fight' || !this.alive) return;
      const zone = aimedZone || targetZone(type, side);
      const spec = Boxer.PUNCH_SPECS[type];
      const target = this.myBoxer.getZonePos(zone);
      this.oppBoxer.startPunch(side, type, target, () => this.resolveIncoming(zone, spec, side, mul));
      this.telegraph(zone, spec.impact);
    }

    /* CPUのパンチ: プレイヤーと同じスタミナ・カウンター補正を通す */
    cpuPunch(side, type) {
      const cost = STA_COST[type];
      let mul = 1;
      if (this.opp.sta < cost) mul *= TIRED_MUL;
      if (performance.now() < this.opp.counterUntil) {
        mul *= COUNTER_MUL;
        this.opp.counterUntil = 0;
      }
      this.opp.sta = Math.max(0, this.opp.sta - cost);
      this.enemyPunch(side, type, mul);
    }

    telegraph(zone, dur) {
      const p = anchorPx(zone);
      const el = document.createElement('div');
      el.className = 'telegraph';
      el.style.left = p.x + 'px';
      el.style.top = p.y + 'px';
      el.style.animationDuration = dur + 's';
      document.getElementById('screen-game').appendChild(el);
      this.after(dur + 0.05, () => el.remove());
    }

    resolveIncoming(zone, spec, side, mul = 1) {
      if (this.state !== 'fight' || !this.alive) return;
      const p = anchorPx(zone);
      const stunned = performance.now() < this.me.stunUntil;
      const g = Gesture.getGuards(stunned).find(r =>
        Math.abs(p.x - r.x) < r.w / 2 + 24 && Math.abs(p.y - r.y) < r.h / 2 + 24
      );
      if (g) {
        // 出したてのガードで防ぐと「ジャストガード」: 相手に大きな隙+カウンター権
        const just = g.age <= JUST_WINDOW_MS;
        Gesture.flashBlock(g.side, just);
        Sfx.block();
        this.spark(this.oppBoxer.getGloveWorld(side), just ? 0xffd75e : 0x88ccff);
        if (just) {
          this.me.counterUntil = performance.now() + COUNTER_MS;
          this.flashNote('just-note');
        }

        if (this.mode === 'cpu') {
          this.opp.stunUntil = performance.now() + (just ? JUST_STUN_MS : STUN_MS);
          this.cpu.onStunned();
          this.oppBoxer.setGuardTarget('L', null);
          this.oppBoxer.setGuardTarget('R', null);
        } else {
          this.net.game({ k: 'result', blocked: true, just, side });
        }
      } else {
        this.takeDamage(Math.round(spec.dmg * mul));
        if (this.mode === 'online') this.net.game({ k: 'result', blocked: false, hp: this.me.hp, side });
      }
    }

    flashNote(id) {
      const el = document.getElementById(id);
      el.classList.remove('hidden');
      el.style.animation = 'none';
      void el.offsetWidth;
      el.style.animation = '';
      this.after(0.8, () => el.classList.add('hidden'));
    }

    takeDamage(dmg) {
      this.me.hp = Math.max(0, this.me.hp - dmg);
      Sfx.hit(dmg >= 12);
      this.shake = Math.min(1, this.shake + dmg / 16);
      const v = document.getElementById('vignette');
      v.style.transition = 'none';
      v.style.opacity = Math.min(0.95, 0.35 + dmg / 18);
      void v.offsetWidth;
      v.style.transition = 'opacity 0.6s ease-out';
      v.style.opacity = 0;
      this.updateHud();
      if (this.me.hp <= 0 && this.state === 'fight') this.doDown('me');
    }

    doDown(whoKey) {
      const who = this[whoKey];
      const boxer = whoKey === 'me' ? this.myBoxer : this.oppBoxer;
      const chance = koChance(who.downs, this.elapsed);
      who.downs++;
      const tko = who.downs >= 4;
      const ko = tko || Math.random() < chance;
      this.state = 'down';
      this.me.counterUntil = 0;
      this.opp.counterUntil = 0;

      Gesture.cancelAll(); // ダウンしたらガード等も強制解除

      boxer.setDown(true);
      Sfx.down();
      this.banner('DOWN!');

      if (this.mode === 'online' && whoKey === 'me') {
        this.net.game({ k: 'down', ko, tko, downs: who.downs });
      }

      if (ko) {
        this.after(1.5, () => this.finish(whoKey === 'me' ? 'lose' : 'win', tko ? 'TKO' : 'KO'));
        return;
      }
      this.after(3.0, () => {
        if (!this.alive || this.state === 'over') return;
        who.hp = Math.max(25, 60 - who.downs * 10);
        this.me.sta = STA_MAX;
        this.opp.sta = STA_MAX;
        boxer.setDown(false);
        this.banner('FIGHT!');
        Sfx.bell();
        this.state = 'fight';
        this.updateHud();
        if (this.mode === 'online' && whoKey === 'me') this.net.game({ k: 'getup', hp: who.hp });
        this.after(0.8, () => this.state === 'fight' && this.banner(null));
      });
    }

    finish(result, how) {
      if (this.state === 'over') return;
      this.state = 'over';
      this.banner(how || 'KO');
      Gesture.setEnabled(false);
      Gesture.cancelAll();
      
      this.after(1.6, () => {
        this.banner(null);
        document.getElementById('result-title').textContent = result === 'win' ? 'YOU WIN!' : 'YOU LOSE...';
        document.getElementById('result-sub').textContent =
          (how || 'KO') + ' — ' + (result === 'win' ? this.myName + ' の勝利!' : this.oppName + ' の勝利');
        document.getElementById('result-overlay').classList.remove('hidden');
        const btn = document.getElementById('result-ok');
        btn.onclick = () => {
          document.getElementById('result-overlay').classList.add('hidden');
          this.destroy();
          this.onEnd(result);
        };
      });
    }

    bindNet() {
      this.net.on('game', m => {
        const d = m.d;
        if (!d || !this.alive) return;
        switch (d.k) {
          case 'punch':
            if (typeof d.sta === 'number') this.opp.sta = d.sta;
            this.enemyPunch(d.side, d.type, d.mul || 1, d.zone);
            break;
          case 'guard':
            if (typeof d.sta === 'number') this.opp.sta = d.sta;
            if (d.on) this.oppBoxer.setGuardTarget(d.side, this.guardLocal(d.nx, d.ny));
            else this.oppBoxer.setGuardTarget(d.side, null);
            break;
          case 'face':
            this.oppBoxer.setFace(d.data);
            break;
          case 'result':
            if (d.blocked) this.applyBlockedByOpp(d.side || 'R', d.just);
            else this.applyHitOnOpp(0, d.side || 'R', d.hp);
            break;
          case 'down': {
            this.opp.hp = 0;
            this.opp.downs = d.downs;
            this.state = 'down';
            this.oppBoxer.setDown(true);
            Sfx.down();
            this.banner('DOWN!');
            this.updateHud();
            if (d.ko) this.after(1.5, () => this.finish('win', d.tko ? 'TKO' : 'KO'));
            break;
          }
          case 'getup':
            this.opp.hp = d.hp;
            this.me.sta = STA_MAX;
            this.opp.sta = STA_MAX;
            this.oppBoxer.setDown(false);
            this.state = 'fight';
            this.banner(null);
            this.updateHud();
            break;
        }
      });
      this.net.on('opponentLeft', () => {
        if (this.state !== 'over') this.finish('win', '相手が退室');
      });
      this.net.on('disconnected', () => {
        if (this.state !== 'over') this.finish('lose', '回線切断');
      });
    }

    showCpuGuard(zone, dur) {
      const side = zone === 'chestL' ? 'L' : zone === 'chestR' ? 'R' : zone === 'belly' ? (Math.random() < 0.5 ? 'L' : 'R') : 'R';
      const pos = zone === 'face' ? new THREE.Vector3(0, 1.56, 0.34)
        : zone === 'belly' ? new THREE.Vector3(0, 1.05, 0.32)
        : zone === 'chestL' ? new THREE.Vector3(0.25, 1.35, 0.32)
        : new THREE.Vector3(-0.25, 1.35, 0.32);
      
      this.oppBoxer.setGuardTarget(side, pos);
      
      // 修正: ガード痙攣バグ防止。常に最新のタイマーIDだけが解除権限を持つ
      const currentGuardId = ++this.cpuGuardId;
      
      this.after(dur, () => {
        if (this.alive && this.cpuGuardId === currentGuardId) {
          if (!this.cpu.guard || this.cpu.now >= this.cpu.guard.until) {
            this.oppBoxer.setGuardTarget('L', null);
            this.oppBoxer.setGuardTarget('R', null);
          }
        }
      });
    }

    spark(worldPos, color) {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(0.06, 8, 6),
        new THREE.MeshBasicMaterial({ color, transparent: true })
      );
      m.position.copy(worldPos);
      this.scene.add(m);
      this.sparks.push({ m, ttl: 0.22 });
    }

    loop() {
      if (!this.alive) return;
      requestAnimationFrame(this.loop);
      const now = performance.now();
      const dt = Math.min(0.05, (now - this.clock) / 1000);
      this.clock = now;

      if (this.state === 'fight' || this.state === 'down') this.elapsed += dt;

      // スタミナ回復。ガードで守りを固めている間は回復が遅い(攻めと守りのトレードオフ)
      if (this.state === 'fight') {
        const meGuarding = Gesture.getGuards(now < this.me.stunUntil).length > 0;
        this.me.sta = Math.min(STA_MAX, this.me.sta + dt * (meGuarding ? STA_REGEN_GUARD : STA_REGEN));
        if (this.mode === 'cpu') {
          const oppGuarding = !!(this.cpu.guard && this.cpu.now < this.cpu.guard.until);
          this.opp.sta = Math.min(STA_MAX, this.opp.sta + dt * (oppGuarding ? STA_REGEN_GUARD : STA_REGEN));
        }
      }

      for (let i = this.timers.length - 1; i >= 0; i--) {
        const t = this.timers[i];
        t.left -= dt;
        if (t.left <= 0) { this.timers.splice(i, 1); t.fn(); }
      }

      if (this.cpu) {
        const canAct = this.state === 'fight' && now >= this.opp.stunUntil && this.opp.hp > 0;
        this.cpu.update(dt, canAct);
      }

      this.myBoxer.update(dt);
      this.oppBoxer.update(dt);

      const head = this.myBoxer.getHeadWorld();
      this.shake = Math.max(0, this.shake - dt * 3.5);
      const s = this.shake * 0.05;
      this.camera.position.set(
        head.x + (Math.random() - 0.5) * s,
        head.y + 0.04 + (Math.random() - 0.5) * s,
        head.z - 0.02
      );
      const look = this.oppBoxer.getHeadWorld();
      this.camera.lookAt(look.x, look.y - 0.1, look.z);

      for (let i = this.sparks.length - 1; i >= 0; i--) {
        const sp = this.sparks[i];
        sp.ttl -= dt;
        sp.m.scale.multiplyScalar(1 + dt * 14);
        sp.m.material.opacity = Math.max(0, sp.ttl / 0.22);
        if (sp.ttl <= 0) { 
          this.scene.remove(sp.m);
          sp.m.geometry.dispose(); 
          sp.m.material.dispose(); 
          this.sparks.splice(i, 1); 
        }
      }

      if ((this.state === 'fight' || this.state === 'down')) this.updateHud();

      renderer.render(this.scene, this.camera);
    }

    after(sec, fn) { this.timers.push({ left: sec, fn }); }

    destroy() {
      this.alive = false;
      this.timers = [];
      Gesture.setEnabled(false);
      Gesture.cancelAll();
      
      window.removeEventListener('resize', this.onResize);
      document.querySelectorAll('.telegraph, .aim-flash').forEach(e => e.remove());
      
      if (this.net) {
        this.net.on('game', null);
        this.net.on('opponentLeft', null);
      }

      if (this.scene) {
        this.scene.traverse((object) => {
          if (object.isMesh) {
            if (object.geometry) object.geometry.dispose();
            if (object.material) {
              if (Array.isArray(object.material)) {
                object.material.forEach(mat => {
                  if (mat.map) mat.map.dispose(); 
                  mat.dispose();
                });
              } else {
                if (object.material.map) object.material.map.dispose(); 
                object.material.dispose();
              }
            }
          }
        });
        renderer.clear();
      }
    }
  }

  return { Match };
})();