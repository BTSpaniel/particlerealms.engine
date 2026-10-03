// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * AIEvasion.js
 * 
 * ⚠️ MULTIPLAYER: Uses deterministic RNG from AIRandom.js
 */

import { aiRng } from './AIRandom.js';

/**
 * AIEvasion.js (original) - NPC evasion and dodge mechanics
 * 
 * Features:
 * - Dodge roll / sidestep
 * - Strafe movement
 * - Projectile prediction and avoidance
 * - Grenade awareness
 * - Threat direction tracking
 */

import {
  vec3,
  vec3Add,
  vec3Sub,
  vec3Scale,
  vec3Dot,
  vec3Length,
  vec3Normalize,
  vec3Cross,
} from "../../core/math/EngineMath.js";
import { distance, distanceSquared, gaussianRandom } from "./AIAiming.js";

// ============================================================================
// CONSTANTS
// ============================================================================

/** Evasion action types */
export const EVASION_TYPE = {
  NONE: 0,
  DODGE_LEFT: 1,
  DODGE_RIGHT: 2,
  DODGE_BACK: 3,
  DIVE: 4,
  STRAFE_LEFT: 5,
  STRAFE_RIGHT: 6,
  JUMP: 7,
};

/** Default evasion parameters */
export const DEFAULT_EVASION_PARAMS = {
  dodgeDistance: 2.5,
  dodgeDuration: 400, // ms
  dodgeCooldown: 1000, // ms
  strafeDuration: 600, // ms
  strafeSpeed: 5, // m/s
  dodgeChance: 0.4, // Base chance to dodge
  reactionTime: 200, // ms to react to threat
  grenadeFleeRadius: 8,
  projectileDetectRadius: 3,
};

// ============================================================================
// EVASION STATE
// ============================================================================

/**
 * Create evasion state for an NPC
 * @param {Object} params - Evasion parameters
 * @returns {Object} Evasion state
 */
export function createEvasionState(params = {}) {
  const p = { ...DEFAULT_EVASION_PARAMS, ...params };
  
  return {
    // Current action
    action: EVASION_TYPE.NONE,
    actionStartTime: 0,
    actionEndTime: 0,
    actionVelocity: [0, 0, 0],
    
    // Cooldowns
    dodgeCooldownEnd: 0,
    
    // Parameters
    dodgeDistance: p.dodgeDistance,
    dodgeDuration: p.dodgeDuration,
    dodgeCooldown: p.dodgeCooldown,
    strafeDuration: p.strafeDuration,
    strafeSpeed: p.strafeSpeed,
    dodgeChance: p.dodgeChance,
    reactionTime: p.reactionTime,
    grenadeFleeRadius: p.grenadeFleeRadius,
    projectileDetectRadius: p.projectileDetectRadius,
    
    // Threat tracking
    lastThreatDirection: null,
    threatReactionTime: 0,
    
    // Strafe state
    strafeDirection: 0, // -1 = left, 0 = none, 1 = right
    strafeTimer: 0,
    strafeChangeInterval: 1500, // Change strafe direction every 1.5s
  };
}

// ============================================================================
// DODGE ACTIONS
// ============================================================================

/**
 * Attempt to dodge in a direction
 * @param {Object} state - Evasion state
 * @param {number} dodgeType - EVASION_TYPE
 * @param {number[]} npcPos - NPC position
 * @param {number[]} npcFacing - NPC facing direction
 * @param {number} now - Current time
 * @returns {boolean} True if dodge started
 */
export function startDodge(state, dodgeType, npcPos, npcFacing, now) {
  if (state.action !== EVASION_TYPE.NONE) return false;
  if (now < state.dodgeCooldownEnd) return false;
  
  // Calculate dodge direction based on type and facing
  let dodgeDir;
  const facingNorm = vec3Normalize(npcFacing);
  const right = vec3Normalize(vec3Cross(facingNorm, [0, 1, 0]));
  
  switch (dodgeType) {
    case EVASION_TYPE.DODGE_LEFT:
      dodgeDir = vec3Scale(right, -1);
      break;
    case EVASION_TYPE.DODGE_RIGHT:
      dodgeDir = right;
      break;
    case EVASION_TYPE.DODGE_BACK:
      dodgeDir = vec3Scale(facingNorm, -1);
      break;
    case EVASION_TYPE.DIVE:
      dodgeDir = facingNorm;
      break;
    default:
      return false;
  }
  
  // Calculate velocity needed to cover dodge distance in duration
  const speed = state.dodgeDistance / (state.dodgeDuration / 1000);
  state.actionVelocity = vec3Scale(dodgeDir, speed);
  
  state.action = dodgeType;
  state.actionStartTime = now;
  state.actionEndTime = now + state.dodgeDuration;
  state.dodgeCooldownEnd = state.actionEndTime + state.dodgeCooldown;
  
  return true;
}

/**
 * Update evasion state
 * @param {Object} state - Evasion state
 * @param {number} now - Current time
 * @returns {{velocity: number[], actionEnded: boolean}}
 */
export function updateEvasion(state, now) {
  let velocity = [0, 0, 0];
  let actionEnded = false;
  
  // Check if current action has ended
  if (state.action !== EVASION_TYPE.NONE && now >= state.actionEndTime) {
    state.action = EVASION_TYPE.NONE;
    state.actionVelocity = [0, 0, 0];
    actionEnded = true;
  }
  
  // Return velocity if still in action
  if (state.action !== EVASION_TYPE.NONE) {
    velocity = [...state.actionVelocity];
  }
  
  return { velocity, actionEnded };
}

/**
 * Check if NPC is currently evading
 * @param {Object} state - Evasion state
 * @returns {boolean} True if in evasion action
 */
export function isEvading(state) {
  return state.action !== EVASION_TYPE.NONE;
}

/**
 * Check if NPC can dodge
 * @param {Object} state - Evasion state
 * @param {number} now - Current time
 * @returns {boolean} True if dodge is available
 */
export function canDodge(state, now) {
  return state.action === EVASION_TYPE.NONE && now >= state.dodgeCooldownEnd;
}

// ============================================================================
// STRAFE MOVEMENT
// ============================================================================

/**
 * Update strafe behavior
 * @param {Object} state - Evasion state
 * @param {number[]} npcFacing - NPC facing direction
 * @param {number} deltaTime - Delta time in ms
 * @returns {number[]} Strafe velocity [x, y, z]
 */
export function updateStrafe(state, npcFacing, deltaTime) {
  if (state.action !== EVASION_TYPE.NONE) {
    return [0, 0, 0]; // Can't strafe while dodging
  }
  
  state.strafeTimer += deltaTime;
  
  // Periodically change strafe direction
  if (state.strafeTimer >= state.strafeChangeInterval) {
    state.strafeTimer = 0;
    
    // Random strafe pattern: left, right, or pause
    const roll = aiRng.float();
    if (roll < 0.35) {
      state.strafeDirection = -1;
    } else if (roll < 0.7) {
      state.strafeDirection = 1;
    } else {
      state.strafeDirection = 0;
    }
  }
  
  if (state.strafeDirection === 0) {
    return [0, 0, 0];
  }
  
  // Calculate strafe velocity perpendicular to facing
  const facingNorm = vec3Normalize(npcFacing);
  const right = vec3Normalize(vec3Cross(facingNorm, [0, 1, 0]));
  
  return vec3Scale(right, state.strafeDirection * state.strafeSpeed);
}

/**
 * Set explicit strafe direction
 * @param {Object} state - Evasion state
 * @param {number} direction - -1 (left), 0 (none), 1 (right)
 */
export function setStrafeDirection(state, direction) {
  state.strafeDirection = Math.sign(direction);
  state.strafeTimer = 0;
}

// ============================================================================
// THREAT RESPONSE
// ============================================================================

/**
 * React to incoming threat (projectile, attack)
 * @param {Object} state - Evasion state
 * @param {number[]} npcPos - NPC position
 * @param {number[]} npcFacing - NPC facing
 * @param {number[]} threatDir - Direction threat is coming from
 * @param {number} now - Current time
 * @param {Object} options - Reaction options
 * @returns {boolean} True if evasion started
 */
export function reactToThreat(state, npcPos, npcFacing, threatDir, now, options = {}) {
  // Check reaction time
  if (state.threatReactionTime > now) {
    return false;
  }
  
  // Skill-based dodge chance
  const dodgeChance = options.dodgeChance ?? state.dodgeChance;
  if (!aiRng.chance(dodgeChance)) {
    state.threatReactionTime = now + state.reactionTime;
    return false;
  }
  
  state.lastThreatDirection = [...threatDir];
  
  // Choose dodge direction based on threat direction
  const threatNorm = vec3Normalize(threatDir);
  const facingNorm = vec3Normalize(npcFacing);
  const right = vec3Normalize(vec3Cross(facingNorm, [0, 1, 0]));
  
  // Determine which side threat is coming from
  const threatFromRight = vec3Dot(threatNorm, right) > 0;
  
  // Dodge opposite to threat direction
  let dodgeType;
  if (threatFromRight) {
    dodgeType = EVASION_TYPE.DODGE_LEFT;
  } else {
    dodgeType = EVASION_TYPE.DODGE_RIGHT;
  }
  
  // Sometimes dive forward instead
  if (aiRng.chance(0.2)) {
    dodgeType = EVASION_TYPE.DIVE;
  }
  
  return startDodge(state, dodgeType, npcPos, npcFacing, now);
}

/**
 * Check for incoming projectiles and react
 * @param {Object} state - Evasion state
 * @param {number[]} npcPos - NPC position
 * @param {number[]} npcFacing - NPC facing
 * @param {Array<{position: number[], velocity: number[]}>} projectiles - Active projectiles
 * @param {number} now - Current time
 * @returns {boolean} True if evasion triggered
 */
export function checkProjectileThreats(state, npcPos, npcFacing, projectiles, now) {
  if (!canDodge(state, now)) return false;
  
  for (const proj of projectiles) {
    // Check if projectile is heading toward NPC
    const toNpc = vec3Sub(npcPos, proj.position);
    const projDir = vec3Normalize(proj.velocity);
    
    // Project NPC position onto projectile path
    const projDist = vec3Dot(toNpc, projDir);
    if (projDist < 0) continue; // Projectile moving away
    
    // Calculate closest approach distance
    const closestPoint = vec3Add(proj.position, vec3Scale(projDir, projDist));
    const missDistance = distance(closestPoint, npcPos);
    
    if (missDistance < state.projectileDetectRadius) {
      // Projectile will pass close - try to dodge
      const threatDir = vec3Scale(projDir, -1);
      return reactToThreat(state, npcPos, npcFacing, threatDir, now);
    }
  }
  
  return false;
}

/**
 * Check for grenades and react
 * @param {Object} state - Evasion state
 * @param {number[]} npcPos - NPC position
 * @param {number[]} npcFacing - NPC facing
 * @param {Array<{position: number[], fuseTimeRemaining: number}>} grenades - Active grenades
 * @param {number} now - Current time
 * @returns {{shouldFlee: boolean, fleeDirection: number[]|null}}
 */
export function checkGrenadeThreats(state, npcPos, npcFacing, grenades, now) {
  let closestGrenade = null;
  let closestDist = state.grenadeFleeRadius;
  
  for (const grenade of grenades) {
    const dist = distance(grenade.position, npcPos);
    if (dist < closestDist) {
      closestDist = dist;
      closestGrenade = grenade;
    }
  }
  
  if (!closestGrenade) {
    return { shouldFlee: false, fleeDirection: null };
  }
  
  // Calculate flee direction (away from grenade)
  const fleeDirection = vec3Normalize(vec3Sub(npcPos, closestGrenade.position));
  
  return {
    shouldFlee: true,
    fleeDirection,
    grenade: closestGrenade,
  };
}

// ============================================================================
// COMBAT MOVEMENT PATTERNS
// ============================================================================

/**
 * Generate unpredictable movement pattern
 * @param {Object} state - Evasion state
 * @param {number[]} npcPos - NPC position
 * @param {number[]} targetPos - Target position
 * @param {number} deltaTimeMs - Delta time in ms
 * @returns {number[]} Movement velocity
 */
export function generateCombatMovement(state, npcPos, targetPos, deltaTimeMs) {
  const toTarget = vec3Sub(targetPos, npcPos);
  const dist = vec3Length(toTarget);
  
  if (dist < 0.001) return [0, 0, 0];
  
  const toTargetNorm = vec3Scale(toTarget, 1 / dist);
  const right = vec3Normalize(vec3Cross(toTargetNorm, [0, 1, 0]));
  
  // Base strafe from current state
  const strafeVel = updateStrafe(state, toTargetNorm, deltaTimeMs);
  
  // Add some randomness
  const jitter = gaussianRandom(0, 0.3);
  const jitterVel = vec3Scale(right, jitter);
  
  // Combine
  return vec3Add(strafeVel, jitterVel);
}

/**
 * Calculate circle-strafe velocity around target
 * @param {number[]} npcPos - NPC position
 * @param {number[]} targetPos - Target position
 * @param {number} direction - -1 (counter-clockwise) or 1 (clockwise)
 * @param {number} speed - Movement speed
 * @returns {number[]} Circle-strafe velocity
 */
export function circleStrafe(npcPos, targetPos, direction, speed) {
  const toTarget = vec3Sub(targetPos, npcPos);
  const dist = vec3Length(toTarget);
  
  if (dist < 1) return [0, 0, 0];
  
  const toTargetNorm = vec3Scale(toTarget, 1 / dist);
  
  // Perpendicular direction (tangent to circle)
  const tangent = [
    -toTargetNorm[2] * direction,
    0,
    toTargetNorm[0] * direction,
  ];
  
  return vec3Scale(tangent, speed);
}

// ============================================================================
// SKILL-BASED EVASION
// ============================================================================

/**
 * Get evasion parameters for skill level
 * @param {string} skill - "novice", "average", "expert"
 * @returns {Object} Evasion parameters
 */
export function getEvasionParamsForSkill(skill) {
  switch (skill) {
    case "novice":
      return {
        dodgeChance: 0.15,
        reactionTime: 400,
        strafeChangeInterval: 2500,
        dodgeCooldown: 2000,
      };
    case "expert":
      return {
        dodgeChance: 0.7,
        reactionTime: 100,
        strafeChangeInterval: 800,
        dodgeCooldown: 600,
      };
    case "average":
    default:
      return {
        dodgeChance: 0.4,
        reactionTime: 200,
        strafeChangeInterval: 1500,
        dodgeCooldown: 1000,
      };
  }
}
