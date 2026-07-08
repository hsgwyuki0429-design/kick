import * as THREE from "three";

const clamp01 = (v) => Math.max(0, Math.min(1, v));
function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
function easeInCubic(t) { return t * t * t; }

// Drives a short "punch out, punch back" tween on an Object3D's local
// position/rotation relative to a resting pose. Used for both the
// opponent's arm pivots and the player's own first-person glove viewmodels.
export class Puncher {
  constructor(object3D, idlePos, idleEuler = new THREE.Euler()) {
    this.object = object3D;
    this.idlePos = idlePos.clone();
    this.idleQuat = new THREE.Quaternion().setFromEuler(idleEuler);
    this.anim = null; // { start, outMs, backMs, deltaPos, deltaQuat }
    this.object.position.copy(this.idlePos);
    this.object.quaternion.copy(this.idleQuat);
  }

  trigger(deltaPos, deltaEuler = new THREE.Euler(), outMs = 100, backMs = 190) {
    this.anim = {
      start: performance.now(),
      outMs,
      backMs,
      deltaPos,
      deltaQuat: new THREE.Quaternion().setFromEuler(deltaEuler),
    };
  }

  // Persistent pose shift (e.g. guard-up while blocking) that holds until
  // released, rather than snapping back automatically.
  setHold(deltaPos, deltaEuler, active) {
    this._holdTarget = active
      ? { pos: deltaPos, quat: new THREE.Quaternion().setFromEuler(deltaEuler) }
      : null;
  }

  update(now, extraOffset = null) {
    let pos = this.idlePos.clone();
    let quat = this.idleQuat.clone();

    // Blend toward the held guard pose (if any) smoothly, and ease back out
    // of the last one when guard is released.
    if (this._holdBlend === undefined) this._holdBlend = 0;
    const targetBlend = this._holdTarget ? 1 : 0;
    this._holdBlend += (targetBlend - this._holdBlend) * 0.25;
    const blendPose = this._holdTarget || this._lastHoldTarget;
    if (blendPose && this._holdBlend > 0.001) {
      pos = pos.clone().lerp(pos.clone().add(blendPose.pos), this._holdBlend);
      quat = quat.clone().slerp(quat.clone().multiply(blendPose.quat), this._holdBlend);
    }
    if (this._holdTarget) this._lastHoldTarget = this._holdTarget;

    if (this.anim) {
      const { start, outMs, backMs, deltaPos, deltaQuat } = this.anim;
      const t = now - start;
      if (t < outMs) {
        const f = easeOutCubic(clamp01(t / outMs));
        pos.add(deltaPos.clone().multiplyScalar(f));
        quat.multiply(new THREE.Quaternion().slerp(deltaQuat, f));
      } else if (t < outMs + backMs) {
        const f = 1 - easeInCubic(clamp01((t - outMs) / backMs));
        pos.add(deltaPos.clone().multiplyScalar(f));
        quat.multiply(new THREE.Quaternion().identity().slerp(deltaQuat, f));
      } else {
        this.anim = null;
      }
    }

    if (extraOffset) pos.add(extraOffset);
    this.object.position.copy(pos);
    this.object.quaternion.copy(quat);
  }
}

const PUNCH_OFFSETS = {
  // Local-space offsets used for the opponent's arm pivots (forward = +Z)
  opponent: {
    straight: { pos: new THREE.Vector3(0, 0.02, 0.55), rot: new THREE.Euler(0.1, 0, 0), out: 110, back: 190 },
    hook: { pos: new THREE.Vector3(0.15, 0.05, 0.4), rot: new THREE.Euler(0, 0.9, 0.5), out: 140, back: 230 },
    uppercut: { pos: new THREE.Vector3(0, 0.35, 0.35), rot: new THREE.Euler(-0.9, 0, 0), out: 150, back: 240 },
  },
  // Local-space offsets for the player's own camera-attached glove viewmodel
  // (forward = -Z, into the screen)
  player: {
    straight: { pos: new THREE.Vector3(0, 0.05, -0.5), rot: new THREE.Euler(-0.1, 0, 0), out: 90, back: 160 },
    hook: { pos: new THREE.Vector3(0.35, 0.02, -0.3), rot: new THREE.Euler(0, -0.6, -0.4), out: 110, back: 190 },
    uppercut: { pos: new THREE.Vector3(0, -0.15, -0.35), rot: new THREE.Euler(0.8, 0, 0), out: 130, back: 210 },
  },
};

export function punchOffset(side, type) {
  const table = PUNCH_OFFSETS[side];
  return table[type] || table.straight;
}
