/* gesture.js - タッチジェスチャーと角度ベースのスワイプ判定 (多重登録バグ修正済) */
const Gesture = (() => {
  let el = null;
  let cb = {};
  let enabled = false;
  let isAttached = false; // リスナーの多重登録を防ぐフラグ
  
  let touches = {}; // pointerId -> 状態

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
    cb = callbacks; // コールバックは毎回最新の試合のものに差し替える
    
    if (isAttached) return; // 既にイベントが紐付いていればリスナー追加はスキップ
    isAttached = true;
    
    el.addEventListener('pointerdown', e => {
      if (!enabled) return;
      const side = getSide(e.clientX);
      touches[e.pointerId] = {
        startX: e.clientX, startY: e.clientY,
        currX: e.clientX, currY: e.clientY,
        side: side,
        isGuard: false,
        fired: false
      };
      
      // 120msホールドでガード開始とする
      touches[e.pointerId].guardTimer = setTimeout(() => {
        const t = touches[e.pointerId];
        if (t && !t.fired) {
          t.isGuard = true;
          if (cb.guardStart) cb.guardStart(t.side, t.currX / innerWidth, t.currY / innerHeight);
        }
      }, 120);
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
      
      // 40px動いたらスワイプ（パンチ）判定
      if (dist > 40) { 
        clearTimeout(t.guardTimer);
        t.fired = true;
        
        // 移動量から角度を計算 (-180度 ~ 180度)
        // 0: 右, 90: 下, 180/-180: 左, -90: 上
        const angle = Math.atan2(dy, dx) * 180 / Math.PI;
        
        let type = 'straight';
        
        if (angle >= 45 && angle <= 135) {
          // 下方向へのスワイプ
          type = 'straight';
        } else if (angle <= -45 && angle >= -135) {
          // 上方向へのスワイプ
          type = 'uppercut';
        } else {
          // 横方向 (内側か外側かを判定)
          const isInnerSwipe = (t.side === 'L' && (angle >= -45 && angle <= 45)) || 
                               (t.side === 'R' && (angle >= 135 || angle <= -135));
          
          if (isInnerSwipe) {
            // 内側へ向かっている
            if (dy < -10) { 
               // 斜め上(下から内側上部へ)ならフック
               type = 'hook';
            } else {
               // 水平〜斜め下ならボディ (クロス)
               type = 'body';
            }
          } else {
            // 外側へ逃げるようなスワイプ
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
  }

  function setEnabled(v) { 
    enabled = v; 
    if (!v) cancelAll(); // 無効化されたら現在のタッチもリセット
  }
  
  function flashBlock(side) {
    // ブロック成功時の追加エフェクト用 (現在はSfxとSparkで表現)
  }

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