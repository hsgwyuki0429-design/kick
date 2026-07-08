/* gesture.js - タッチジェスチャーと角度ベースのスワイプ判定 */
const Gesture = (() => {
  let el = null;
  let cb = {};
  let enabled = false;
  let isAttached = false;
  let stunned = false;

  let touches = {};

  // ガード判定サイズ。game.js側の当たり判定(±24pxマージン)込みの実効範囲を可視化する
  const GUARD_SIZE = 120, GUARD_PAD = 24;

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

  /* ---- 防御範囲の可視化 ---- */
  function makeRect(t) {
    const d = document.createElement('div');
    d.className = 'guard-rect' + (stunned ? ' stunned' : '');
    const size = GUARD_SIZE + GUARD_PAD * 2; // 実際にブロックできる範囲と一致させる
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
      const side = isGuardBtn ? e.target.dataset.side : getSide(e.clientX);
      
      touches[e.pointerId] = {
        startX: e.clientX, startY: e.clientY,
        currX: e.clientX, currY: e.clientY,
        side: side,
        isGuard: false,
        rect: null,
        guardAt: 0,
        fired: false
      };

      if (isGuardBtn) {
        beginGuard(touches[e.pointerId]); // ボタンタッチなら初手からガード確定
      } else {
        touches[e.pointerId].guardTimer = setTimeout(() => {
          const t = touches[e.pointerId];
          if (t && !t.fired && !t.isGuard) beginGuard(t);
        }, 120);
      }
    });

    el.addEventListener('pointermove', e => {
      if (!enabled) return;
      const t = touches[e.pointerId];
      if (!t) return;
      
      t.currX = e.clientX;
      t.currY = e.clientY;
      
      if (t.isGuard) {
        if (t.rect) moveRect(t.rect, t.currX, t.currY);
        if (cb.guardMove) cb.guardMove(t.side, t.currX / innerWidth, t.currY / innerHeight);
        return;
      }
      
      if (t.fired) return;
      
      const dx = e.clientX - t.startX;
      const dy = e.clientY - t.startY;
      const dist = Math.hypot(dx, dy);
      
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
            if (dy < -10) { 
               type = 'hook';
            } else {
               type = 'body';
            }
          } else {
            type = 'hook';
          }
        }
        
        // 開始位置も渡す: タッチした場所に近い部位を狙えるようにする(エイム)
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
    
    // 修正: 画面外スワイプによる「ゴーストタッチ」の完全防止。
    // 指が画面（ベゼル）の外に出た瞬間に強制リセットし、ガードしっぱなし状態を回避。
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

  /* ブロック成功時に防御範囲を光らせる。ジャストガードは金色 */
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

  /* スタン中はガードが無効なことを灰色表示で伝える */
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

  return { attach, setEnabled, getGuards, flashBlock, setStunned, cancelAll };
})();