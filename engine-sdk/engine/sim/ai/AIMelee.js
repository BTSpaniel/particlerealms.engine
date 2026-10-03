// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * AIMelee.js - Melee attack arc collision and timing phases
 * 
 * Features:
 * - Arc-based (pie-slice) collision detection
 * - Attack phase timing (windup, active, recovery)
 * - Multi-target sweep detection
 * - Combo chain support
 */

import {
  vec3,
  vec3Sub,
  vec3Dot,
  vec3Length,
  vec3Normalize,
} from "../../core/math/EngineMath.js";
import { degToRad, distanceSquared } from "./AIAiming.js";

// ============================================================================
// CONSTANTS
// ============================================================================

/** Attack phase types */
export const ATTACK_PHASE = {
  IDLE: 0,
  WINDUP: 1,
  ACTIVE: 2,
  RECOVERY: 3,
};

/** Default phase durations in milliseconds */
export const DEFAULT_PHASE_DURATIONS = {
  light: { windup: 150, active: 100, recovery: 200 },
  medium: { windup: 250, active: 125, recovery: 300 },
  heavy: { windup: 400, active: 150, recovery: 500 },
};

// ============================================================================
// MELEE ATTACK ARC
// ============================================================================

/**
 * Create a melee attack arc (pie-slice shaped hitbox)
 * @param {number[]} origin - [x, y, z] attack origin
 * @param {number[]} direction - [x, y, z] facing direction (normalized)
 * @param {number} range - Attack range in meters
 * @param {number} arcAngleDeg - Total arc angle in degrees (symmetric around direction)
 * @returns {Object} Melee attack arc
 */
export function createMeleeArc(origin, direction, range, arcAngleDeg) {
  const dirNorm = vec3Normalize(direction);
  const halfAngleRad = degToRad(arcAngleDeg / 2);

  return {
    origin: [...origin],
    direction: dirNorm,
    range,
    halfAngle: halfAngleRad,
    cosHalfAngle: Math.cos(halfAngleRad),
  };
}

/**
 * Check if a point is within the melee arc (2D horizontal check)
 * Uses cosine comparison for efficiency (avoids atan2)
 * @param {Object} arc - Melee arc from createMeleeArc
 * @param {number[]} targetPos - [x, y, z] target position
 * @param {number} targetRadius - Target hitbox radius (default 0)
 * @returns {boolean} True if target is hit
 */
export function isInMeleeArc(arc, targetPos, targetRadius = 0) {
  // Vector from origin to target (XZ plane for horizontal arc)
  const toTarget = [
    targetPos[0] - arc.origin[0],
    0, // Ignore Y for horizontal arc
    targetPos[2] - arc.origin[2],
  ];

  const distSq = toTarget[0] * toTarget[0] + toTarget[2] * toTarget[2];
  const effectiveRange = arc.range + targetRadius;

  // Range check (squared to avoid sqrt)
  if (distSq > effectiveRange * effectiveRange) return false;

  const dist = Math.sqrt(distSq);
  if (dist < 0.001) return true; // At origin = always hit

  // Angle check using dot product
  const dirFlat = [arc.direction[0], 0, arc.direction[2]];
  const dirFlatLen = Math.sqrt(dirFlat[0] * dirFlat[0] + dirFlat[2] * dirFlat[2]);
  if (dirFlatLen < 0.001) return false;

  const dotProduct = (toTarget[0] * dirFlat[0] + toTarget[2] * dirFlat[2]) / (dist * dirFlatLen);

  return dotProduct >= arc.cosHalfAngle;
}

/**
 * Check if target is in 3D melee arc (includes vertical angle)
 * @param {Object} arc - Melee arc
 * @param {number[]} targetPos - [x, y, z]
 * @param {number} targetRadius - Target radius
 * @param {number} verticalToleranceRad - Vertical angle tolerance (default ±45°)
 * @returns {boolean} True if hit
 */
export function isInMeleeArc3D(arc, targetPos, targetRadius = 0, verticalToleranceRad = Math.PI / 4) {
  const toTarget = vec3Sub(targetPos, arc.origin);
  const distSq = vec3Dot(toTarget, toTarget);
  const effectiveRange = arc.range + targetRadius;

  if (distSq > effectiveRange * effectiveRange) return false;

  const dist = Math.sqrt(distSq);
  if (dist < 0.001) return true;

  const toTargetNorm = [toTarget[0] / dist, toTarget[1] / dist, toTarget[2] / dist];

  // Horizontal angle check
  const horizontalDot = arc.direction[0] * toTargetNorm[0] + arc.direction[2] * toTargetNorm[2];
  const horizLen =
    Math.sqrt(arc.direction[0] ** 2 + arc.direction[2] ** 2) *
    Math.sqrt(toTargetNorm[0] ** 2 + toTargetNorm[2] ** 2);

  if (horizLen > 0.001) {
    const horizCos = horizontalDot / horizLen;
    if (horizCos < arc.cosHalfAngle) return false;
  }

  // Vertical angle check
  const verticalAngle = Math.asin(Math.abs(toTargetNorm[1]));
  if (verticalAngle > verticalToleranceRad) return false;

  return true;
}

// ============================================================================
// ATTACK STATE MACHINE
// ============================================================================

/**
 * Create a melee attack state tracker
 * @param {Object} config - Attack configuration
 * @param {number} config.windupMs - Windup duration in ms
 * @param {number} config.activeMs - Active (damaging) duration in ms
 * @param {number} config.recoveryMs - Recovery duration in ms
 * @param {number} config.range - Attack range
 * @param {number} config.arcAngleDeg - Attack arc in degrees
 * @param {number} config.damage - Base damage
 * @returns {Object} Attack state
 */
export function createMeleeAttackState(config) {
  const durations = DEFAULT_PHASE_DURATIONS.medium;

  return {
    phase: ATTACK_PHASE.IDLE,
    phaseStartTime: 0,
    windupMs: config.windupMs ?? durations.windup,
    activeMs: config.activeMs ?? durations.active,
    recoveryMs: config.recoveryMs ?? durations.recovery,
    range: config.range ?? 2.5,
    arcAngleDeg: config.arcAngleDeg ?? 90,
    damage: config.damage ?? 25,
    hitTargets: new Set(), // Track targets hit this swing
    canBeInterrupted: true,
    comboStep: 0,
    maxCombo: config.maxCombo ?? 3,
  };
}

/**
 * Start a melee attack
 * @param {Object} state - Attack state
 * @param {number} now - Current timestamp (ms)
 * @returns {boolean} True if attack started
 */
export function startMeleeAttack(state, now) {
  if (state.phase !== ATTACK_PHASE.IDLE) return false;

  state.phase = ATTACK_PHASE.WINDUP;
  state.phaseStartTime = now;
  state.hitTargets.clear();
  state.canBeInterrupted = true;

  return true;
}

/**
 * Update melee attack state and check phase transitions
 * @param {Object} state - Attack state
 * @param {number} now - Current timestamp (ms)
 * @returns {Object} {phase, justEntered, justExited}
 */
export function updateMeleeAttack(state, now) {
  const elapsed = now - state.phaseStartTime;
  let justEntered = null;
  let justExited = null;

  switch (state.phase) {
    case ATTACK_PHASE.WINDUP:
      if (elapsed >= state.windupMs) {
        justExited = ATTACK_PHASE.WINDUP;
        state.phase = ATTACK_PHASE.ACTIVE;
        state.phaseStartTime = now;
        state.canBeInterrupted = false;
        justEntered = ATTACK_PHASE.ACTIVE;
      }
      break;

    case ATTACK_PHASE.ACTIVE:
      if (elapsed >= state.activeMs) {
        justExited = ATTACK_PHASE.ACTIVE;
        state.phase = ATTACK_PHASE.RECOVERY;
        state.phaseStartTime = now;
        justEntered = ATTACK_PHASE.RECOVERY;
      }
      break;

    case ATTACK_PHASE.RECOVERY:
      if (elapsed >= state.recoveryMs) {
        justExited = ATTACK_PHASE.RECOVERY;
        state.phase = ATTACK_PHASE.IDLE;
        state.canBeInterrupted = true;
        // Reset combo if too much time passes
        if (elapsed > state.recoveryMs + 500) {
          state.comboStep = 0;
        }
        justEntered = ATTACK_PHASE.IDLE;
      }
      break;
  }

  return {
    phase: state.phase,
    justEntered,
    justExited,
  };
}

/**
 * Try to interrupt a melee attack (e.g., from stagger)
 * @param {Object} state - Attack state
 * @returns {boolean} True if interrupted
 */
export function interruptMeleeAttack(state) {
  if (!state.canBeInterrupted) return false;

  state.phase = ATTACK_PHASE.IDLE;
  state.comboStep = 0;
  return true;
}

/**
 * Check for hits during active phase
 * @param {Object} state - Attack state
 * @param {number[]} attackerPos - [x, y, z] attacker position
 * @param {number[]} attackerDir - [x, y, z] facing direction
 * @param {Array<{id: number, position: number[], radius: number}>} targets - Potential targets
 * @returns {Array<{id: number, damage: number}>} Hits this frame
 */
export function checkMeleeHits(state, attackerPos, attackerDir, targets) {
  if (state.phase !== ATTACK_PHASE.ACTIVE) return [];

  const arc = createMeleeArc(attackerPos, attackerDir, state.range, state.arcAngleDeg);
  const hits = [];

  for (const target of targets) {
    // Skip already-hit targets this swing
    if (state.hitTargets.has(target.id)) continue;

    if (isInMeleeArc(arc, target.position, target.radius || 0)) {
      state.hitTargets.add(target.id);
      hits.push({
        id: target.id,
        damage: state.damage,
        comboStep: state.comboStep,
      });
    }
  }

  return hits;
}

// ============================================================================
// COMBO SYSTEM
// ============================================================================

/**
 * Chain to next combo attack
 * @param {Object} state - Attack state
 * @param {number} now - Current timestamp (ms)
 * @returns {boolean} True if combo continues
 */
export function chainComboAttack(state, now) {
  // Can only chain during recovery phase
  if (state.phase !== ATTACK_PHASE.RECOVERY) return false;

  const elapsed = now - state.phaseStartTime;
  // Must be at least 50% through recovery to chain
  if (elapsed < state.recoveryMs * 0.5) return false;

  state.comboStep = (state.comboStep + 1) % state.maxCombo;

  // Combo attacks are faster
  const speedBonus = 0.85;
  state.phase = ATTACK_PHASE.WINDUP;
  state.phaseStartTime = now;
  state.windupMs *= speedBonus;
  state.activeMs *= speedBonus;
  state.recoveryMs *= speedBonus;
  state.hitTargets.clear();

  // Damage increases with combo
  state.damage *= 1.15;

  return true;
}

/**
 * Get combo multiplier for current step
 * @param {number} comboStep - Current combo step (0-indexed)
 * @returns {number} Damage multiplier
 */
export function getComboMultiplier(comboStep) {
  const multipliers = [1.0, 1.15, 1.35, 1.5];
  return multipliers[Math.min(comboStep, multipliers.length - 1)];
}

// ============================================================================
// SWEEP DETECTION (Multi-target)
// ============================================================================

/**
 * Perform a sweeping melee attack across multiple positions
 * Useful for wide slash attacks
 * @param {number[]} origin - [x, y, z]
 * @param {number[]} startDir - [x, y, z] start of sweep
 * @param {number[]} endDir - [x, y, z] end of sweep
 * @param {number} range - Attack range
 * @param {Array<{id: number, position: number[], radius: number}>} targets - Targets
 * @param {number} sweepSamples - Number of arc samples (default 5)
 * @returns {Array<{id: number, hitAngle: number}>} Targets hit by sweep
 */
export function sweepMeleeArc(origin, startDir, endDir, range, targets, sweepSamples = 5) {
  const hitTargets = new Map();

  // Interpolate direction across sweep
  for (let i = 0; i <= sweepSamples; i++) {
    const t = i / sweepSamples;
    const dir = vec3Normalize([
      startDir[0] * (1 - t) + endDir[0] * t,
      startDir[1] * (1 - t) + endDir[1] * t,
      startDir[2] * (1 - t) + endDir[2] * t,
    ]);

    // Check narrow cone at each sample
    const arc = createMeleeArc(origin, dir, range, 30); // 30 degree cone per sample

    for (const target of targets) {
      if (hitTargets.has(target.id)) continue;

      if (isInMeleeArc(arc, target.position, target.radius || 0)) {
        hitTargets.set(target.id, { id: target.id, hitAngle: t * 180 });
      }
    }
  }

  return Array.from(hitTargets.values());
}

// ============================================================================
// UTILITY
// ============================================================================

/**
 * Get remaining time in current phase
 * @param {Object} state - Attack state
 * @param {number} now - Current timestamp (ms)
 * @returns {number} Remaining time in ms, or 0 if idle
 */
export function getPhaseTimeRemaining(state, now) {
  if (state.phase === ATTACK_PHASE.IDLE) return 0;

  const elapsed = now - state.phaseStartTime;
  let duration = 0;

  switch (state.phase) {
    case ATTACK_PHASE.WINDUP:
      duration = state.windupMs;
      break;
    case ATTACK_PHASE.ACTIVE:
      duration = state.activeMs;
      break;
    case ATTACK_PHASE.RECOVERY:
      duration = state.recoveryMs;
      break;
  }

  return Math.max(0, duration - elapsed);
}

/**
 * Get phase progress (0-1)
 * @param {Object} state - Attack state
 * @param {number} now - Current timestamp (ms)
 * @returns {number} Progress 0-1
 */
export function getPhaseProgress(state, now) {
  if (state.phase === ATTACK_PHASE.IDLE) return 0;

  const elapsed = now - state.phaseStartTime;
  let duration = state.windupMs;

  switch (state.phase) {
    case ATTACK_PHASE.ACTIVE:
      duration = state.activeMs;
      break;
    case ATTACK_PHASE.RECOVERY:
      duration = state.recoveryMs;
      break;
  }

  return Math.min(1, elapsed / duration);
}
