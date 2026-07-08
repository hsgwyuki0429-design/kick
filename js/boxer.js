/* boxer.js — 3D人型ボクサー。パンチ種別ごとに腕が実際に指定の部位へ動く */
const Boxer = (() => {
  const LU = 0.34, LF = 0.32, GLOVE = 0.095;
  const SHOULDER_Y = 1.42, SHOULDER_X = 0.24;

  const PUNCH_SPECS = {
    straight: { impact: 0.20, total: 0.44, dmg: 7 },
    body:     { impact: 0.26, total: 0.54, dmg: 9 },
    uppercut: { impact: 0.30, total: 0.62, dmg: 12 },
    hook:     { impact: 0.32, total: 0.64, dmg: 14 },
  };

  const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
  const _dir = new THREE.Vector3(), _hClamp = new THREE.Vector3(), _pole = new THREE.Vector3();
  const _limbDir = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);

  function limb(mesh, a, b) {
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    _limbDir.copy(b).sub(a).normalize();
    mesh.quaternion.setFromUnitVectors(UP, _limbDir);
  }

  function solveElbow(S, H, side, out) {
    _dir.copy(H).sub(S);
    let d = _dir.length();
    const maxD = LU + LF - 0.01;
    if (d < 0.05) { d = 0.05; _dir.set(0, 0, 1).multiplyScalar(d); }
    if (d > maxD) { d = maxD; _dir.setLength(d); H = _hClamp.copy(S).add(_dir); }
    const n = _dir.normalize();
    const x = (LU * LU - LF * LF + d * d) / (2 * d);
    const r = Math.sqrt(Math.max(0.0001, LU * LU - x * x));
    _pole.set(side * 0.9, -0.7, -0.15);
    _pole.addScaledVector(n, -_pole.dot(n)).normalize();
    out.copy(S).addScaledVector(n, x).addScaledVector(_pole, r);
    return H;
  }

  function makeFaceTexture(dataURL) {
    const tex = new THREE.Texture();
    const img = new Image();
    img.onload = () => { tex.image = img; tex.needsUpdate = true; };
    img.src = dataURL;
    return tex;
  }

  function create(opts = {}) {
    const skin = opts.skin ?? 0xe0aa72;
    const trunks = opts.trunks ?? 0x2244cc;
    const gloveColor = opts.glove ?? 0xcc2222;

    const group = new THREE.Group();
    const body = new THREE.Group();
    group.add(body);

    const matSkin = new THREE.MeshLambertMaterial({ color: skin });
    const matTrunks = new THREE.MeshLambertMaterial({ color: trunks });
    const matGlove = new THREE.MeshLambertMaterial({ color: gloveColor });
    const matDark = new THREE.MeshLambertMaterial({ color: 0x222222 });

    function box(w, h, d, mat, x, y, z, parent) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      (parent || body).add(m);
      return m;
    }

    const torso = box(0.44, 0.52, 0.26, matSkin, 0, 1.19, 0);
    box(0.40, 0.26, 0.25, matTrunks, 0, 0.88, 0);
    box(0.15, 0.62, 0.16, matSkin, 0.11, 0.44, 0);
    box(0.15, 0.62, 0.16, matSkin, -0.11, 0.44, 0);
    box(0.16, 0.12, 0.30, matDark, 0.11, 0.06, 0.04);
    box(0.16, 0.12, 0.30, matDark, -0.11, 0.06, 0.04);

    const headGroup = new THREE.Group();
    headGroup.position.set(0, 1.60, 0);
    body.add(headGroup);
    const skull = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.30, 0.26), matSkin);
    headGroup.add(skull);
    const faceMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const facePlane = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.28), faceMat);
    facePlane.position.z = 0.132;
    headGroup.add(facePlane);
    box(0.28, 0.05, 0.28, matDark, 0, 0.175, 0, headGroup);

    function setFace(dataURL) {
      if (!dataURL) return;
      faceMat.map = makeFaceTexture(dataURL);
      faceMat.needsUpdate = true;
    }
    if (opts.faceURL) setFace(opts.faceURL);

    // 左腕(L)はローカルの+x側(sideSign=1), 右腕(R)は-x側(sideSign=-1)
    function makeArm(sideSign) {
      const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.055, LU, 10), matSkin);
      const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.05, LF, 10), matSkin);
      const gloveM = new THREE.Mesh(new THREE.SphereGeometry(GLOVE, 12, 10), matGlove);
      body.add(upper, fore, gloveM);
      return {
        sideSign, upper, fore, glove: gloveM,
        hand: new THREE.Vector3(sideSign * 0.17, 1.40, 0.30),
        elbow: new THREE.Vector3(),
        mode: 'idle',
        punch: null,
        guardTarget: new THREE.Vector3(),
      };
    }
    const arms = { L: makeArm(1), R: makeArm(-1) };

    function basePose(arm, t) {
      return _v1.set(
        arm.sideSign * 0.17 + Math.sin(t * 1.7) * 0.008,
        1.40 + Math.sin(t * 2.3 + arm.sideSign) * 0.015,
        0.30
      );
    }

    function startPunch(side, type, targetWorld, onImpact, onDone) {
      const arm = arms[side];
      if (arm.mode === 'punch') return false;
      const spec = PUNCH_SPECS[type];
      const target = body.worldToLocal(targetWorld.clone());
      const start = arm.hand.clone();
      const mid = start.clone().add(target).multiplyScalar(0.5);
      const s = arm.sideSign;
      const ctrl = mid.clone();

      // 各パンチの自然な軌道を作るための制御点調整
      switch (type) {
        case 'straight': 
          // まっすぐ打ち出す
          ctrl.y += 0.05; 
          ctrl.x += s * 0.05; 
          break; 
        case 'body': // クロス
          // 内側を通りつつ下へえぐる
          ctrl.x -= s * 0.15; 
          ctrl.y -= 0.10; 
          ctrl.z += 0.05; 
          break; 
        case 'hook':     
          // 外側から大きく回る
          ctrl.x += s * 0.35; 
          ctrl.y += 0.05; 
          ctrl.z += 0.10; 
          break;
        case 'uppercut': 
          // 下から突き上げる
          ctrl.x += s * 0.05; 
          ctrl.y -= 0.30; 
          ctrl.z += 0.10; 
          break;
      }
      arm.mode = 'punch';
      arm.punch = { type, spec, t: 0, start, target, ctrl, fired: false, onImpact, onDone };
      return true;
    }

    function setGuardTarget(side, localPos) {
      const arm = arms[side];
      if (arm.mode === 'punch') { if (localPos) arm.pendingGuard = localPos.clone(); return; }
      if (localPos) { arm.mode = 'guard'; arm.guardTarget.copy(localPos); }
      else if (arm.mode === 'guard') arm.mode = 'idle';
    }

    let downState = 0;
    let downK = 0;
    function setDown(v) { downState = v ? 1 : (downState >= 2 ? 3 : 0); }

    let idleT = Math.random() * 10;

    function update(dt) {
      idleT += dt;

      if (downState === 1) { downK = Math.min(1, downK + dt * 2.2); if (downK >= 1) downState = 2; }
      if (downState === 3) { downK = Math.max(0, downK - dt * 1.4); if (downK <= 0) downState = 0; }
      const e = downK * downK * (3 - 2 * downK);
      body.rotation.x = -e * 1.45;
      body.position.y = -e * 0.28 + (downState ? 0 : Math.abs(Math.sin(idleT * 2.3)) * 0.02);
      body.position.z = -e * 0.55;

      let lunge = 0, twist = 0;
      for (const side of ['L', 'R']) {
        const arm = arms[side];
        const base = basePose(arm, idleT);

        if (arm.mode === 'punch') {
          const p = arm.punch;
          p.t += dt;
          if (p.t <= p.spec.impact) {
            const s = p.t / p.spec.impact;
            const k = s * s * (3 - 2 * s);
            _v2.copy(p.start).multiplyScalar((1 - k) * (1 - k))
               .addScaledVector(p.ctrl, 2 * (1 - k) * k)
               .addScaledVector(p.target, k * k);
            arm.hand.copy(_v2);
            const w = Math.sin(Math.PI * Math.min(1, s + 0.15));
            lunge = Math.max(lunge, w * 0.30);
            twist += -arm.sideSign * w * 0.45;
          } else {
            if (!p.fired) { p.fired = true; p.onImpact && p.onImpact(); }
            const s = Math.min(1, (p.t - p.spec.impact) / (p.spec.total - p.spec.impact));
            arm.hand.lerpVectors(p.target, base, s * s * (3 - 2 * s));
            const w = 1 - s;
            lunge = Math.max(lunge, w * 0.18);
            twist += -arm.sideSign * w * 0.2;
            if (p.t >= p.spec.total) {
              arm.mode = 'idle';
              const done = p.onDone; arm.punch = null;
              if (arm.pendingGuard) { setGuardTarget(side, arm.pendingGuard); arm.pendingGuard = null; }
              done && done();
            }
          }
        } else if (arm.mode === 'guard') {
          arm.hand.lerp(arm.guardTarget, Math.min(1, dt * 14));
        } else {
          arm.hand.lerp(base, Math.min(1, dt * 9));
        }

        const S = _v3.set(arm.sideSign * SHOULDER_X, SHOULDER_Y, 0.03);
        const H = solveElbow(S, arm.hand, arm.sideSign, arm.elbow);
        limb(arm.upper, S, arm.elbow);
        limb(arm.fore, arm.elbow, H);
        arm.glove.position.copy(H);
      }

      if (!downState) {
        body.position.z += lunge;
        body.rotation.y = twist;
        torso.rotation.y = twist * 0.5;
      }
    }

    // 攻撃対象部位のワールド座標
    function getZonePos(zone) {
      // 相手からの顔面への攻撃が「カメラの真ん中」に来るように y, z をカメラ位置付近に合わせる
      if (zone === 'face')   return body.localToWorld(_v1.set(0, 1.62, 0.20).clone());
      if (zone === 'belly')  return body.localToWorld(_v1.set(0, 1.10, 0.18).clone());
      // chestL は本人の左胸 (ローカル+x)、chestR は本人の右胸 (ローカル-x)
      if (zone === 'chestL') return body.localToWorld(_v1.set(0.16, 1.35, 0.18).clone());
      return body.localToWorld(_v1.set(-0.16, 1.35, 0.18).clone());
    }

    function getHeadWorld() {
      return headGroup.getWorldPosition(new THREE.Vector3());
    }

    function getGloveWorld(side) {
      return arms[side].glove.getWorldPosition(new THREE.Vector3());
    }

    function setHeadVisible(v) {
      headGroup.visible = v;
    }

    function isPunching(side) {
      return side ? arms[side].mode === 'punch'
        : (arms.L.mode === 'punch' || arms.R.mode === 'punch');
    }

    return {
      group, body, setFace, update, startPunch, setGuardTarget, setDown,
      getZonePos, getHeadWorld, getGloveWorld, setHeadVisible, isPunching,
      get downK() { return downK; },
    };
  }

  return { create, PUNCH_SPECS };
})();