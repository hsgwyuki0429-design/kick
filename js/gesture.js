/* gesture.js — 2本指タッチ操作 (要件③⑥)
 * 画面左半分 = 左腕 / 右半分 = 右腕。各半分につき同時に1本の指。
 *  - タップ ............... ストレート
 *  - 内側へのサイドスワイプ . 相手の反対側の胸へのボディ
 *  - 真ん中から上スワイプ ... 顔面(アッパー)
 *  - 下から真ん中へ上フリック フック
 *  - 長押し(押している間) .. ガード。角の取れた縦長の矩形が指に追従する
 */
const Gesture = (() => {
  const HOLD_MS = 160;      // これ以上押しっぱなしでガード開始
  const GUARD_MOVE_PX = 22; // ガード判定を壊さない指ブレ許容量
  const SWIPE_PX = 42;      // スワイプ確定距離

  let root = null, cb = {}, enabled = false;
  const pointers = new Map();   // pointerId -> state
  const guards = { L: null, R: null }; // side -> {x,y,el}

  function rectSize() {
    const w = Math.max(64, Math.min(innerWidth, innerHeight) * 0.16);
    return { w, h: w * 2.5 };
  }

  function classifySwipe(p) {
    const dx = p.x - p.x0, dy = p.y - p.y0;
    const h = innerHeight;
    if (Math.abs(dy) >= Math.abs(dx) && dy < 0) {
      // 上方向: 開始位置が下寄りならフック、真ん中付近なら顔面アッパー
      return p.y0 > h * 0.62 ? 'hook' : 'uppercut';
    }
    const inward = (p.side === 'L' && dx > 0) || (p.side === 'R' && dx < 0);
    if (inward && Math.abs(dx) > Math.abs(dy)) return 'body';
    return 'straight'; // 外側/下方向スワイプはストレート扱い
  }

  function startGuard(p) {
    p.mode = 'guard';
    const { w, h } = rectSize();
    const el = document.createElement('div');
    el.className = 'guard-rect';
    el.style.width = w + 'px';
    el.style.height = h + 'px';
    el.style.left = p.x + 'px';
    el.style.top = p.y + 'px';
    root.appendChild(el);
    guards[p.side] = { x: p.x, y: p.y, el };
    cb.guardStart && cb.guardStart(p.side, p.x / innerWidth, p.y / innerHeight);
  }

  function endGuard(side) {
    const g = guards[side];
    if (!g) return;
    g.el.remove();
    guards[side] = null;
    cb.guardEnd && cb.guardEnd(side);
  }

  function onDown(e) {
    if (!enabled) return;
    const side = e.clientX < innerWidth / 2 ? 'L' : 'R';
    for (const p of pointers.values()) if (p.side === side) return; // 片側1本まで
    const p = {
      id: e.pointerId, side,
      x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY,
      t0: performance.now(), mode: 'pending', timer: 0,
    };
    p.timer = setTimeout(() => {
      if (p.mode === 'pending' && dist(p) < GUARD_MOVE_PX) startGuard(p);
    }, HOLD_MS);
    pointers.set(e.pointerId, p);
    root.setPointerCapture && root.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function dist(p) {
    return Math.hypot(p.x - p.x0, p.y - p.y0);
  }

  function onMove(e) {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX; p.y = e.clientY;
    if (p.mode === 'pending' && dist(p) > SWIPE_PX) {
      p.mode = 'done';
      clearTimeout(p.timer);
      cb.punch && cb.punch(p.side, classifySwipe(p));
    } else if (p.mode === 'guard') {
      const g = guards[p.side];
      if (g) {
        g.x = p.x; g.y = p.y;
        g.el.style.left = p.x + 'px';
        g.el.style.top = p.y + 'px';
        cb.guardMove && cb.guardMove(p.side, p.x / innerWidth, p.y / innerHeight);
      }
    }
    e.preventDefault();
  }

  function onUp(e) {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    clearTimeout(p.timer);
    pointers.delete(e.pointerId);
    if (p.mode === 'guard') {
      endGuard(p.side);
    } else if (p.mode === 'pending') {
      // 短押し = タップ = ストレート
      cb.punch && cb.punch(p.side, dist(p) > SWIPE_PX ? classifySwipe(p) : 'straight');
    }
  }

  function attach(rootEl, callbacks) {
    root = rootEl;
    cb = callbacks;
    root.addEventListener('pointerdown', onDown);
    root.addEventListener('pointermove', onMove);
    root.addEventListener('pointerup', onUp);
    root.addEventListener('pointercancel', onUp);
  }

  function setEnabled(v) {
    enabled = v;
    if (!v) {
      for (const p of pointers.values()) clearTimeout(p.timer);
      pointers.clear();
      endGuard('L'); endGuard('R');
    }
  }

  /* ガード矩形の当たり判定 (px)。stunned の腕は無効。 */
  function getGuards(stunned) {
    const { w, h } = rectSize();
    const out = [];
    for (const side of ['L', 'R']) {
      const g = guards[side];
      if (!g) continue;
      g.el.classList.toggle('stunned', !!stunned);
      if (stunned) continue;
      out.push({ side, x: g.x, y: g.y, w, h });
    }
    return out;
  }

  function flashBlock(side) {
    const g = guards[side];
    if (!g) return;
    g.el.classList.add('blocked');
    setTimeout(() => g && g.el && g.el.classList.remove('blocked'), 200);
  }

  return { attach, setEnabled, getGuards, flashBlock };
})();
