/* gesture.js - タッチジェスチャーと角度ベースのスワイプ、ボタン入力判定 */
const Gesture = (() => {
  let el = null;
  let cb = {};
  let enabled = false;
  let isAttached = false;
  let stunned = false;
  let currentMode = 'button'; // 'button' or 'swipe'

  let touches = {};

  const GUARD_SIZE = 120, GUARD_PAD = 24;

  function setMode(mode) { currentMode = mode; }

  function getSide(x) {
    return x < innerWidth / 2 ? 'L' : 'R';
  }

  function getGuards(isStunned) {
    if (isStunned) return [];
    const now = performance.now();
    const res = [];
    for (const id in touches) {
      const t = touches[id];
      if (t.isGuard) {
        res.push({ side: t.side, x: t.currX, y: t.currY, w: GUARD_SIZE, h: GUARD_SIZE, age: now - t.guardAt });
      }
    }
    return res;
  }

  function makeRect(t) {
    const d = document.createElement('div');
    d.className = 'guard-rect' + (stunned ? ' stunned' : '');
    const size = GUARD_SIZE + GUARD_PAD * 2;
    d.style.width = size + 'px';
    d.style.height = size + 'px';
    moveRect(d, t.currX, t.currY);
    el.appendChild(d);
    return d;
  }

  function moveRect(d, x, y) {
    d.style.left = x + 'px';
    d.style.top = y + 'px';
  }

  function beginGuard(t) {
    t.isGuard = true;
    t.guardAt = performance.now();
    if (!t.rect) t.rect = makeRect(t);
    if (cb.guardStart) cb.guardStart(t.side, t.currX / innerWidth, t.currY / innerHeight);
  }

  function dropRect(t) {
    if (t.rect) { t.rect.remove(); t.rect = null; }
  }

  function attach(target, callbacks) {
    el = target;
    cb = callbacks; 
    
    if (isAttached) return; 
    isAttached = true;
    
    el.addEventListener('pointerdown', e => {
      if (!enabled) return;
      
      const isGuardBtn = e.target.classList.contains('guard-btn');
      const isAtkBtn = e.target.classList.contains('atk-btn');
      const side = (isGuardBtn || isAtkBtn) ? e.target.dataset.side : getSide(e.clientX);
      
      touches[e.pointerId] = {
        startX: e.clientX, startY: e.clientY,
        currX: e.clientX, currY: e.clientY,
        side: side,
        isGuard: false,
        rect: null,
        guardAt: 0,
        fired: false
      };

      const t = touches[e.pointerId];

      if (currentMode === 'button') {
        if (isAtkBtn) {
          // ボタン式: 攻撃ボタン押下で即座にパンチ発動
          t.fired = true;
          const type = e.target.dataset.type;
          // タッチ位置ベースのエイムはせず、固定部位へ飛ばすためにnullを渡す
          if (cb.punch) cb.punch(side, type, null, null);
        } else {
          // ボタン式: ボタン以外の空きスペースを押したら即ガード開始
          beginGuard(t);
        }
      } else {
        // スワイプ式: 従来通り
        if (isGuardBtn) {
          beginGuard(t);
        } else {
          t.guardTimer = setTimeout(() => {
            if (t && !t.fired && !t.isGuard) beginGuard(t);
          }, 120);
        }
      }
    });

    el.addEventListener('pointermove', e => {
      if (!enabled) return;
      const t = touches[e.pointerId];
      if (!t) return;
      
      t.currX = e.clientX;
      t.currY = e.clientY;
      
      // ガード中は盾を動かす
      if (t.isGuard) {
        if (t.rect) moveRect(t.rect, t.currX, t.currY);
        if (cb.guardMove) cb.guardMove(t.side, t.currX / innerWidth, t.currY / innerHeight);
        return;
      }
      
      if (t.fired) return;

      // ボタン式の場合は攻撃がスワイプで暴発しないようにする
      if (currentMode === 'button') return;
      
      const dx = e.clientX - t.startX;
      const dy = e.clientY - t.startY;
      const dist = Math.hypot(dx, dy);
      
      // スワイプ式: スワイプ距離による攻撃判定
      if (dist > 40) { 
        clearTimeout(t.guardTimer);
        t.fired = true;
        
        const angle = Math.atan2(dy, dx) * 180 / Math.PI;
        let type = 'straight';
        
        if (angle >= 45 && angle <= 135) {
          type = 'straight';
        } else if (angle <= -45 && angle >= -135) {
          type = 'uppercut';
        } else {
          const isInnerSwipe = (t.side === 'L' && (angle >= -45 && angle <= 45)) || 
                               (t.side === 'R' && (angle >= 135 || angle <= -135));
          if (isInnerSwipe) {
            type = (dy < -10) ? 'hook' : 'body';
          } else {
            type = 'hook';
          }
        }
        
        if (cb.punch) cb.punch(t.side, type, t.startX, t.startY);
      }
    });

    const end = e => {
      const t = touches[e.pointerId];
      if (!t) return;
      clearTimeout(t.guardTimer);
      dropRect(t);
      if (t.isGuard) {
        if (cb.guardEnd) cb.guardEnd(t.side);
      }
      delete touches[e.pointerId];
    };
    
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('pointerleave', end);
    document.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'touch' && Object.keys(touches).length > 0) {
        cancelAll();
      }
    });
  }

  function setEnabled(v) {
    enabled = v;
    if (!v) cancelAll();
  }

  function flashBlock(side, just) {
    for (const id in touches) {
      const t = touches[id];
      if (t.isGuard && t.side === side && t.rect) {
        const rect = t.rect;
        rect.classList.add('blocked');
        if (just) rect.classList.add('just');
        setTimeout(() => rect.classList.remove('blocked', 'just'), 220);
        return;
      }
    }
  }

  function setStunned(v) {
    stunned = v;
    for (const id in touches) {
      const t = touches[id];
      if (t.rect) t.rect.classList.toggle('stunned', v);
    }
  }

  function cancelAll() {
    for (const id in touches) {
      clearTimeout(touches[id].guardTimer);
      dropRect(touches[id]);
      if (touches[id].isGuard && cb.guardEnd) {
        cb.guardEnd(touches[id].side);
      }
    }
    touches = {};
    stunned = false;
  }

  return { setMode, attach, setEnabled, getGuards, flashBlock, setStunned, cancelAll };
})();