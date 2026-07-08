// Translates pointer (touch/mouse) gestures into boxing actions:
//  - quick swipe        -> punch (hand decided by screen side, type by angle)
//  - press & hold still -> block, released on pointerup/cancel or movement

const SWIPE_MIN_DIST = 26; // px
const HOLD_MS = 200; // time before a stationary press becomes a block
const HOLD_MOVE_TOLERANCE = 14; // px of wiggle still allowed while "holding"
const MAX_SWIPE_SPEED_PX_MS = 3.2; // used to normalize power to 0..1

export class InputController {
  constructor(target, { onPunch, onBlockChange }) {
    this.target = target;
    this.onPunch = onPunch;
    this.onBlockChange = onBlockChange;
    this.pointers = new Map(); // id -> state
    this.blocking = false;

    target.addEventListener("pointerdown", this._onDown, { passive: false });
    target.addEventListener("pointermove", this._onMove, { passive: false });
    target.addEventListener("pointerup", this._onUp, { passive: false });
    target.addEventListener("pointercancel", this._onUp, { passive: false });
    target.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  _onDown = (e) => {
    e.preventDefault();
    try { this.target.setPointerCapture?.(e.pointerId); } catch { /* ignore: pointer already gone */ }
    const state = {
      x0: e.clientX, y0: e.clientY,
      x: e.clientX, y: e.clientY,
      t0: performance.now(),
      moved: false,
      isBlocking: false,
    };
    state.holdTimer = setTimeout(() => this._maybeStartBlock(e.pointerId), HOLD_MS);
    this.pointers.set(e.pointerId, state);
  };

  _onMove = (e) => {
    const state = this.pointers.get(e.pointerId);
    if (!state) return;
    e.preventDefault();
    state.x = e.clientX;
    state.y = e.clientY;
    const dist = Math.hypot(state.x - state.x0, state.y - state.y0);
    if (dist > HOLD_MOVE_TOLERANCE) {
      state.moved = true;
      if (state.holdTimer) { clearTimeout(state.holdTimer); state.holdTimer = null; }
    }
  };

  _onUp = (e) => {
    const state = this.pointers.get(e.pointerId);
    if (!state) return;
    e.preventDefault();
    if (state.holdTimer) clearTimeout(state.holdTimer);

    const wasBlocking = state.isBlocking;
    this.pointers.delete(e.pointerId);

    if (wasBlocking) {
      this._endBlockIfNeeded();
    } else {
      this._resolveSwipe(state);
    }
  };

  _maybeStartBlock(pointerId) {
    const state = this.pointers.get(pointerId);
    if (!state || state.moved) return;
    state.isBlocking = true;
    this.blocking = true;
    this.onBlockChange?.(true);
  }

  _endBlockIfNeeded() {
    // Only actually release block once no other pointer is still holding it.
    const stillBlocking = [...this.pointers.values()].some((s) => s.isBlocking);
    if (!stillBlocking && this.blocking) {
      this.blocking = false;
      this.onBlockChange?.(false);
    }
  }

  _resolveSwipe(state) {
    const dx = state.x - state.x0;
    const dy = state.y - state.y0;
    const dist = Math.hypot(dx, dy);
    const dt = Math.max(1, performance.now() - state.t0);
    if (dist < SWIPE_MIN_DIST) return; // tap, ignore

    const hand = state.x0 < window.innerWidth / 2 ? "L" : "R";
    const type = classifyPunch(dx, dy);
    const speed = dist / dt; // px/ms
    const power = Math.max(0, Math.min(1, speed / MAX_SWIPE_SPEED_PX_MS));
    this.onPunch?.(hand, type, power);
  }

  destroy() {
    this.target.removeEventListener("pointerdown", this._onDown);
    this.target.removeEventListener("pointermove", this._onMove);
    this.target.removeEventListener("pointerup", this._onUp);
    this.target.removeEventListener("pointercancel", this._onUp);
  }
}

// angle measured from straight-up (0 = up, 90 = sideways)
function classifyPunch(dx, dy) {
  const angleFromUp = Math.abs(Math.atan2(dx, -dy)) * (180 / Math.PI);
  if (angleFromUp < 32) return "straight";
  if (angleFromUp < 68) return "uppercut";
  return "hook";
}
