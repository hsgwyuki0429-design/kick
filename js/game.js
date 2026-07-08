/* game.js — 試合本体。3Dシーン、パンチ解決、ガード判定、KO、エフェクト。 */

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

  // 画面上のガードアンカー位置 (自分視点)
  const ANCHORS = {
    face:   [0.5,  1/6],
    belly:  [0.5,  5/6],
    chestL: [0.25, 0.5], // 画面左側 (＝自分の左胸)
    chestR: [0.75, 0.5]  // 画面右側 (＝自分の右胸)
  };

  function anchorPx(zone) {
    const a = ANCHORS[zone];
    return { x: a[0] * innerWidth, y: a[1] * innerHeight };
  }

  function targetZone(type, side) {
    // まっすぐ打つストレートは、相手の対角の胸に当たる（自分の左腕 L → 相手の右胸 chestR）
    if (type === 'straight') return side === 'L' ? 'chestR' : 'chestL';
    // 内側へスワイプするボディは、クロスして相手の同じ側の胸に当たる（左腕 L → 相手の左胸 chestL）
    if (type === 'body')     return side === 'L' ? 'chestL' : 'chestR';
    if (type === 'hook')     return 'belly'; // 腹
    return 'face';                           // 顔
  }

  function koChance(prevDowns, elapsedSec) {
    return Math.min(0.85, 0.05 + prevDowns * 0.12 + (elapsedSec / 60) * 0.03);
  }

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
      this.me  = { hp: 100, downs: 0, stunUntil: 0 };
      this.opp = { hp: 100, downs: 0, stunUntil: 0 };
      this.timers = [];
      this.shake = 0;

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
        renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      }
      renderer.setSize(innerWidth, innerHeight);

      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(0x0a0c16);
      this.scene.fog = new THREE.Fog(0x0a0c16, 6, 16);

      this.camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 50);

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
        renderer.setSize(innerWidth, innerHeight);
        this.camera.aspect = innerWidth / innerHeight;
        this.camera.updateProjectionMatrix();
      };
      addEventListener('resize', this.onResize);
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
      this.updateHud();
    }

    updateHud() {
      for (const [who, id] of [[this.me, 'me'], [this.opp, 'opp']]) {
        const el = document.getElementById('hp-' + id);
        const pct = Math.max(0, who.hp);
        el.style.width = pct + '%';
        el.className = 'hpfill' + (pct < 25 ? ' danger' : pct < 55 ? ' warn' : '');
        document.getElementById('downs-' + id).textContent = '●'.repeat(who.downs);
      }
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
        punch: (side, type) => this.onMyPunch(side, type),
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
      return new THREE.Vector3((0.5 - nx) * 1.2, 1.35 + (0.5 - ny) * 1.2, 0.36);
    }

    onMyGuard(side, nx, ny, isStart) {
      if (this.state !== 'fight' && this.state !== 'down') return;
      this.myBoxer.setGuardTarget(side, this.guardLocal(nx, ny));
      if (this.mode === 'online') {
        const now = performance.now();
        if (isStart || now - (this.lastGuardSend || 0) > 80) {
          this.lastGuardSend = now;
          this.net.game({ k: 'guard', side, on: true, nx, ny });
        }
      }
    }

    onMyPunch(side, type) {
      if (!this.canIAct()) return;
      const zone = targetZone(type, side);
      const spec = Boxer.PUNCH_SPECS[type];
      const target = this.oppBoxer.getZonePos(zone);
      const started = this.myBoxer.startPunch(side, type, target, () => {
        if (this.mode === 'cpu') this.resolveMyPunchOnCpu(zone, spec, side);
      });
      if (!started) return;
      Sfx.whoosh();
      if (this.mode === 'online') this.net.game({ k: 'punch', side, type });
      else this.cpu.onPlayerPunch(zone, spec.impact);
    }

    resolveMyPunchOnCpu(zone, spec, side) {
      if (this.state !== 'fight' || !this.alive) return;
      if (this.cpu.blocks(zone)) this.applyBlockedByOpp(side);
      else this.applyHitOnOpp(spec.dmg, side);
    }

    applyBlockedByOpp(side) {
      this.me.stunUntil = performance.now() + 200;
      Sfx.block();
      this.spark(this.myBoxer.getGloveWorld(side), 0x88ccff);
      const note = document.getElementById('stun-note');
      note.classList.remove('hidden');
      this.after(0.5, () => note.classList.add('hidden'));
    }

    applyHitOnOpp(dmg, side, hpFromNet = null) {
      this.opp.hp = hpFromNet !== null ? hpFromNet : Math.max(0, this.opp.hp - dmg);
      Sfx.hit(dmg >= 12);
      this.spark(this.myBoxer.getGloveWorld(side), 0xffdd66);
      this.updateHud();
      if (this.mode === 'cpu' && this.opp.hp <= 0 && this.state === 'fight') this.doDown('opp');
    }

    enemyPunch(side, type) {
      if (this.state !== 'fight' || !this.alive) return;
      const zone = targetZone(type, side);
      const spec = Boxer.PUNCH_SPECS[type];
      const target = this.myBoxer.getZonePos(zone);
      this.oppBoxer.startPunch(side, type, target, () => this.resolveIncoming(zone, spec, side));
      this.telegraph(zone, spec.impact);
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

    resolveIncoming(zone, spec, side) {
      if (this.state !== 'fight' || !this.alive) return;
      const p = anchorPx(zone);
      const stunned = performance.now() < this.me.stunUntil;
      const g = Gesture.getGuards(stunned).find(r =>
        // 遊びやすさの究極の微調整: 判定に余裕を持たせ、指が少しずれてもガード成功とする (+24px)
        Math.abs(p.x - r.x) < r.w / 2 + 24 && Math.abs(p.y - r.y) < r.h / 2 + 24
      );
      if (g) {
        Gesture.flashBlock(g.side);
        Sfx.block();
        this.spark(this.oppBoxer.getGloveWorld(side), 0x88ccff);
        if (this.mode === 'cpu') { this.opp.stunUntil = performance.now() + 200; this.cpu.onStunned(); }
        else this.net.game({ k: 'result', blocked: true, side });
      } else {
        this.takeDamage(spec.dmg);
        if (this.mode === 'online') this.net.game({ k: 'result', blocked: false, hp: this.me.hp, side });
      }
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
          case 'punch': this.enemyPunch(d.side, d.type); break;
          case 'guard':
            if (d.on) this.oppBoxer.setGuardTarget(d.side, this.guardLocal(d.nx, d.ny));
            else this.oppBoxer.setGuardTarget(d.side, null);
            break;
          case 'face':
            this.oppBoxer.setFace(d.data);
            break;
          case 'result':
            if (d.blocked) this.applyBlockedByOpp(d.side || 'R');
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
        : zone === 'chestL' ? new THREE.Vector3(0.16, 1.35, 0.32)
        : new THREE.Vector3(-0.16, 1.35, 0.32);
      this.oppBoxer.setGuardTarget(side, pos);
      this.after(dur, () => {
        if (this.alive && (!this.cpu.guard || this.cpu.now >= this.cpu.guard.until)) {
          this.oppBoxer.setGuardTarget(side, null);
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
        if (sp.ttl <= 0) { this.scene.remove(sp.m); this.sparks.splice(i, 1); }
      }

      if ((this.state === 'fight' || this.state === 'down')) this.updateHud();

      renderer.render(this.scene, this.camera);
    }

    after(sec, fn) { this.timers.push({ left: sec, fn }); }

    destroy() {
      this.alive = false;
      Gesture.setEnabled(false);
      removeEventListener('resize', this.onResize);
      document.querySelectorAll('.telegraph').forEach(e => e.remove());
      if (this.net) {
        this.net.on('game', null);
        this.net.on('opponentLeft', null);
      }
    }
  }

  return { Match };
})();