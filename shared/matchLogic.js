// Core boxing match rules shared by the client (offline vs CPU) and the
// server (authoritative resolution for online matches). Pure functions /
// plain objects only -- no browser or Node APIs -- so this file can be
// imported unchanged from either environment.

export const MAX_HP = 100;
export const REVIVE_HP = 20;
export const BASE_REVIVE_CHANCE = 0.85; // chance to get back up the 1st time HP hits 0
export const REVIVE_CHANCE_STEP = 0.25; // chance drops by this much per prior knockdown
export const BLOCK_DAMAGE_REDUCTION = 0.8; // 80% less damage while blocking

const PUNCH_PROFILES = {
  straight: { min: 5, max: 12 },
  hook: { min: 8, max: 16 },
  uppercut: { min: 10, max: 20 },
};

export function createMatchState() {
  return {
    hp: MAX_HP,
    knockdowns: 0,
    ko: false,
  };
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

// power: 0..1, how committed/fast the swipe was.
// Returns the raw (pre-block) damage a punch would deal. A very weak swipe
// (power < 0.12) is treated as a miss/graze so players are rewarded for
// committed swipes rather than tiny taps.
export function computeDamage(punchType, power) {
  const profile = PUNCH_PROFILES[punchType] || PUNCH_PROFILES.straight;
  const p = clamp01(power);
  if (p < 0.12) return 0;
  const base = profile.min + (profile.max - profile.min) * p;
  const variance = base * (0.9 + Math.random() * 0.2); // +/-10%
  return Math.round(variance);
}

// Applies damage to a defender's match state, resolving block reduction and
// the HP-zero revival roll. Mutates `state` in place and returns a summary
// of what happened for animation/UI/network purposes.
export function applyDamage(state, rawDamage, isBlocking) {
  if (state.ko) {
    return { damage: 0, blocked: isBlocking, knockedDown: false, ko: true, alreadyOver: true };
  }

  let dmg = rawDamage;
  const blocked = !!isBlocking && rawDamage > 0;
  if (blocked) dmg = Math.round(dmg * (1 - BLOCK_DAMAGE_REDUCTION));

  state.hp = Math.max(0, state.hp - dmg);

  let knockedDown = false;
  let ko = false;

  if (state.hp <= 0 && dmg > 0) {
    knockedDown = true;
    const reviveChance = Math.max(0, BASE_REVIVE_CHANCE - state.knockdowns * REVIVE_CHANCE_STEP);
    if (Math.random() < reviveChance) {
      state.hp = REVIVE_HP;
      state.knockdowns += 1;
    } else {
      state.hp = 0;
      state.ko = true;
      ko = true;
    }
  }

  return { damage: dmg, blocked, knockedDown, ko };
}

export function reviveChanceFor(knockdowns) {
  return Math.max(0, BASE_REVIVE_CHANCE - knockdowns * REVIVE_CHANCE_STEP);
}
