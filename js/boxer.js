/* boxer.js — 3D人型ボクサー。2ボーンIKでパンチ種別ごとに腕が実際に動く (要件④)
 * 座標系: ボクサーのローカル +z が「正面(相手方向)」。
 * 左腕 = ローカル +x 側、右腕 = ローカル -x 側 (自分から見た左右)。
 */
const Boxer = (() => {
  const LU = 0.34, LF = 0.32, GLOVE = 0.095; // 上腕・前腕の長さ、グローブ半径
  const SHOULDER_Y = 1.42, SHOULDER_X = 0.24;

  // パンチ種別ごとの性能 (要件③): impact=着弾までの秒, total=腕が戻るまで, dmg=ダメージ
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

  function limb(mesh, a, b) { // 円柱メッシュを関節 a→b 間に配置
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    _limbDir.copy(b).sub(a).normalize();
    mesh.quaternion.setFromUnitVectors(UP, _limbDir);
  }

  // 2ボーンIK: 肩S・手先H・ポールベクトルから肘位置を求める
  function solveElbow(S, H, side, out) {
    _dir.copy(H).sub(S);
    let d = _dir.length();
    const maxD = LU + LF - 0.01;
    if (d < 0.05) { d = 0.05; _dir.set(0, 0, 1).multiplyScalar(d); }
    if (d > maxD) { d = maxD; _dir.setLength(d); H = _hClamp.copy(S).add(_dir); }
    const n = _dir.normalize();
    const x = (LU * LU - LF * LF + d * d) / (2 * d);
    const r = Math.sqrt(Math.max(0.0001, LU * LU - x * x));
    // 肘は外側やや下に張り出す
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

    const group = new THREE.Group();       // 外部が位置・向きを決める
    const body = new THREE.Group();        // ダウン・前傾・ひねり用
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
    box(0.40, 0.26, 0.25, matTrunks, 0, 0.88, 0);           // トランクス
    box(0.15, 0.62, 0.16, matSkin, 0.11, 0.44, 0);           // 脚
    box(0.15, 0.62, 0.16, matSkin, -0.11, 0.44, 0);
    box(0.16, 0.12, 0.30, matDark, 0.11, 0.06, 0.04);        // シューズ
    box(0.16, 0.12, 0.30, matDark, -0.11, 0.06, 0.04);

    // 頭 + 顔テクスチャ(前面プレーン)
    const headGroup = new THREE.Group();
    headGroup.position.set(0, 1.60, 0);
    body.add(headGroup);
    const skull = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.30, 0.26), matSkin);
    headGroup.add(skull);
    const faceMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const facePlane = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.28), faceMat);
    facePlane.position.z = 0.132;
    headGroup.add(facePlane);
    box(0.28, 0.05, 0.28, matDark, 0, 0.175, 0, headGroup);  // ヘアライン

    function setFace(dataURL) {
      if (!dataURL) return;
      faceMat.map = makeFaceTexture(dataURL);
      faceMat.needsUpdate = true;
    }
    if (opts.faceURL) setFace(opts.faceURL);

    // 腕: 円柱2本 + グローブ球。update() で毎フレーム関節位置から配置する
    function makeArm(sideSign) {
      const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.055, LU, 10), matSkin);
      const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.05, LF, 10), matSkin);
      const gloveM = new THREE.Mesh(new THREE.SphereGeometry(GLOVE, 12, 10), matGlove);
      body.add(upper, fore, gloveM);
      return {
        sideSign, upper, fore, glove: gloveM,
        hand: new THREE.Vector3(sideSign * 0.17, 1.40, 0.30), // 現在の手先位置(ローカル)
        elbow: new THREE.Vector3(),
        mode: 'idle',           // idle | punch | guard
        punch: null,            // {type,spec,t,start,target,ctrl,fired,onImpact,onDone}
        guardTarget: new THREE.Vector3(),
      };
    }
    const arms = { L: makeArm(1), R: makeArm(-1) };

    function basePose(arm, t) { // 構え(顎の前に両拳)+ 揺れ
      return _v1.set(
        arm.sideSign * 0.17 + Math.sin(t * 1.7) * 0.008,
        1.40 + Math.sin(t * 2.3 + arm.sideSign) * 0.015,
        0.30
      );
    }

    // ---- パンチ開始。targetWorld = 相手の部位のワールド座標 ----
    function startPunch(side, type, targetWorld, onImpact, onDone) {
      const arm = arms[side];
      if (arm.mode === 'punch') return false;
      const spec = PUNCH_SPECS[type];
      const target = body.worldToLocal(targetWorld.clone());
      const start = arm.hand.clone();
      const mid = start.clone().add(target).multiplyScalar(0.5);
      const s = arm.sideSign;
      const ctrl = mid.clone();
      switch (type) { // 軌道: ベジェ制御点で腕の振りを変える (要件④)
        case 'straight': ctrl.y += 0.02; break;
        case 'hook':     ctrl.x += s * 0.55; ctrl.y += 0.06; ctrl.z += 0.10; break;
        case 'uppercut': ctrl.x += s * 0.10; ctrl.y -= 0.42; ctrl.z += 0.15; break;
        case 'body':     ctrl.x += s * 0.38; ctrl.y -= 0.18; ctrl.z += 0.05; break;
      }
      arm.mode = 'punch';
      arm.punch = { type, spec, t: 0, start, target, ctrl, fired: false, onImpact, onDone };
      return true;
    }

    function setGuardTarget(side, localPos) { // null でガード解除
      const arm = arms[side];
      if (arm.mode === 'punch') { if (localPos) arm.pendingGuard = localPos.clone(); return; }
      if (localPos) { arm.mode = 'guard'; arm.guardTarget.copy(localPos); }
      else if (arm.mode === 'guard') arm.mode = 'idle';
    }

    // ---- ダウン / KO / 立ち上がり (要件⑦) ----
    let downState = 0; // 0=通常, 1=倒れ中, 2=倒れたまま, 3=起き上がり中
    let downK = 0;
    function setDown(v) { downState = v ? 1 : (downState >= 2 ? 3 : 0); }

    let idleT = Math.random() * 10;

    function update(dt) {
      idleT += dt;

      // ダウンアニメーション: 後ろへ倒れる
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
            const k = s * s * (3 - 2 * s); // smoothstep
            // 2次ベジェ
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

        // IK解決 → メッシュ配置
        const S = _v3.set(arm.sideSign * SHOULDER_X, SHOULDER_Y, 0.03);
        const H = solveElbow(S, arm.hand, arm.sideSign, arm.elbow);
        limb(arm.upper, S, arm.elbow);
        limb(arm.fore, arm.elbow, H);
        arm.glove.position.copy(H);
      }

      // パンチに合わせて上体が踏み込み・ひねり
      if (!downState) {
        body.position.z += lunge;
        body.rotation.y = twist;
        torso.rotation.y = twist * 0.5;
      }
    }

    // 攻撃対象部位のワールド座標 (zone: face / chestL / chestR ※本人から見た左右)
    function getZonePos(zone) {
      const p = zone === 'face' ? _v1.set(0, 1.60, 0.14)
        : zone === 'chestL' ? _v1.set(0.13, 1.24, 0.14)
        : _v1.set(-0.13, 1.24, 0.14);
      return body.localToWorld(p.clone());
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
