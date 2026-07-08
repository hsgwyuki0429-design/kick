/* gesture.js - タッチジェスチャーと角度ベースのスワイプ判定 */
const Gesture = (() => {
  let el = null;
  let cb = {};
  let enabled = false;
  let isAttached = false; 
  
  let touches = {}; 

  function getSide(x) {
    return x < innerWidth / 2 ? 'L' : 'R';
  }

  function getGuards(stunned) {
    if (stunned) return [];
    const res = [];
    for (const id in touches) {
      const t = touches[id];
      if (t.isGuard) {
        res.push({ side: t.side, x: t.currX, y: t.currY, w: 120, h: 120 });
      }
    }
    return res;
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
        isGuard: isGuardBtn, // ボタンタッチなら初手からガード確定
        fired: false
      };
      
      if (isGuardBtn) {
        if (cb.guardStart) cb.guardStart(side, e.clientX / innerWidth, e.clientY / innerHeight);
      } else {
        touches[e.pointerId].guardTimer = setTimeout(() => {
          const t = touches[e.pointerId];
          if (t && !t.fired && !t.isGuard) {
            t.isGuard = true;
            if (cb.guardStart) cb.guardStart(t.side, t.currX / innerWidth, t.currY / innerHeight);
          }
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
        
        if (cb.punch) cb.punch(t.side, type);
      }
    });

    const end = e => {
      const t = touches[e.pointerId];
      if (!t) return;
      clearTimeout(t.guardTimer);
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
  
  function flashBlock(side) {}

  function cancelAll() {
    for (const id in touches) {
      clearTimeout(touches[id].guardTimer);
      if (touches[id].isGuard && cb.guardEnd) {
        cb.guardEnd(touches[id].side);
      }
    }
    touches = {};
  }

  return { attach, setEnabled, getGuards, flashBlock, cancelAll };
})();