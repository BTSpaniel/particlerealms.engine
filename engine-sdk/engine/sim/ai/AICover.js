// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * AICover.js - Tactical cover system for NPCs
 * 
 * Features:
 * - Cover point detection and scoring
 * - Blind fire from cover
 * - Peek/lean mechanics
 * - Cover validity checking (destructible)
 * - Suppression tracking
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
import {
  createRay,
  rayAABBIntersect,
  hasLineOfSight,
  distance,
  distanceSquared,
} from "./AIAiming.js";

// ============================================================================
// CONSTANTS
// ============================================================================

/** Cover quality thresholds */
export const COVER_QUALITY = {
  NONE: 0,
  LOW: 1, // Crouching only
  HIGH: 2, // Standing
  FULL: 3, // Complete protection
};

/** Cover action types */
export const COVER_ACTION = {
  NONE: 0,
  CROUCH: 1,
  LEAN_LEFT: 2,
  LEAN_RIGHT: 3,
  PEEK_OVER: 4,
  BLIND_FIRE: 5,
};

// ============================================================================
// COVER POINT
// ============================================================================

/**
 * Create a cover point definition
 * @param {number[]} position - [x, y, z] cover position
 * @param {number[]} normal - [x, y, z] direction cover faces (away from threat)
 * @param {Object} options - Cover options
 * @returns {Object} Cover point
 */
export function createCoverPoint(position, normal, options = {}) {
  return {
    position: [...position],
    normal: vec3Normalize(normal),
    quality: options.quality ?? COVER_QUALITY.HIGH,
    width: options.width ?? 1.5, // Width of cover
    height: options.height ?? 1.8, // Height of cover
    destructible: options.destructible ?? false,
    currentHealth: options.health ?? 100,
    maxHealth: options.health ?? 100,
    occupiedBy: null,
    lastUsedTime: 0,
    
    // Pre-computed peek positions
    peekLeftPos: null,
    peekRightPos: null,
    peekOverPos: null,
  };
}

/**
 * Pre-compute peek positions for a cover point
 * @param {Object} cover - Cover point
 */
export function computePeekPositions(cover) {
  // Calculate tangent (perpendicular to normal on XZ plane)
  const tangent = vec3Normalize(vec3Cross(cover.normal, [0, 1, 0]));
  
  // Peek positions offset from cover
  const peekDist = 0.6;
  const peekForward = 0.3;
  
  cover.peekLeftPos = vec3Add(
    vec3Add(cover.position, vec3Scale(tangent, -cover.width * 0.5 - peekDist)),
    vec3Scale(cover.normal, -peekForward)
  );
  
  cover.peekRightPos = vec3Add(
    vec3Add(cover.position, vec3Scale(tangent, cover.width * 0.5 + peekDist)),
    vec3Scale(cover.normal, -peekForward)
  );
  
  // Peek over (crouch to stand transition)
  cover.peekOverPos = vec3Add(cover.position, [0, cover.height * 0.3, 0]);
}

// ============================================================================
// COVER DETECTION
// ============================================================================

/**
 * Find cover points from obstacle geometry
 * @param {Array<{min: number[], max: number[]}>} obstacles - AABB obstacles
 * @param {number} sampleSpacing - Distance between sample points
 * @returns {Array<Object>} Cover points
 */
export function detectCoverPoints(obstacles, sampleSpacing = 2) {
  const coverPoints = [];
  
  for (const obs of obstacles) {
    const size = [
      obs.max[0] - obs.min[0],
      obs.max[1] - obs.min[1],
      obs.max[2] - obs.min[2],
    ];
    
    // Skip if too small to be cover
    if (size[1] < 0.8) continue;
    
    const quality = size[1] >= 1.5 ? COVER_QUALITY.HIGH : COVER_QUALITY.LOW;
    
    // Sample cover points along each face
    const faces = [
      { normal: [1, 0, 0], axis: 2, offset: obs.max[0] },
      { normal: [-1, 0, 0], axis: 2, offset: obs.min[0] },
      { normal: [0, 0, 1], axis: 0, offset: obs.max[2] },
      { normal: [0, 0, -1], axis: 0, offset: obs.min[2] },
    ];
    
    for (const face of faces) {
      const perpAxis = face.axis;
      const start = obs.min[perpAxis];
      const end = obs.max[perpAxis];
      const samples = Math.max(1, Math.floor((end - start) / sampleSpacing));
      
      for (let i = 0; i <= samples; i++) {
        const t = samples > 0 ? i / samples : 0.5;
        const perpPos = start + t * (end - start);
        
        const pos = [0, obs.min[1], 0];
        if (face.axis === 0) {
          pos[0] = perpPos;
          pos[2] = face.offset + face.normal[2] * 0.1;
        } else {
          pos[0] = face.offset + face.normal[0] * 0.1;
          pos[2] = perpPos;
        }
        
        const cover = createCoverPoint(pos, face.normal, {
          quality,
          width: sampleSpacing,
          height: size[1],
        });
        computePeekPositions(cover);
        coverPoints.push(cover);
      }
    }
  }
  
  return coverPoints;
}

// ============================================================================
// COVER SCORING
// ============================================================================

/**
 * Score a cover point for a given tactical situation
 * @param {Object} cover - Cover point
 * @param {number[]} npcPos - NPC current position
 * @param {number[]} threatPos - Threat position
 * @param {Array<{min, max}>} obstacles - Obstacles for LOS check
 * @param {Object} options - Scoring options
 * @returns {number} Cover score (higher = better)
 */
export function scoreCoverPoint(cover, npcPos, threatPos, obstacles, options = {}) {
  if (cover.occupiedBy !== null) return -1; // Already occupied
  
  const weights = {
    distance: options.distanceWeight ?? 0.3,
    protection: options.protectionWeight ?? 0.4,
    flanking: options.flankingWeight ?? 0.2,
    freshness: options.freshnessWeight ?? 0.1,
  };
  
  let score = 0;
  
  // Distance factor (prefer closer cover, but not too close to threat)
  const distToNpc = distance(cover.position, npcPos);
  const distToThreat = distance(cover.position, threatPos);
  const idealDist = options.idealDistance ?? 15;
  
  // Penalty for being too far from NPC
  const npcDistScore = Math.max(0, 1 - distToNpc / 30);
  
  // Penalty for being too close to threat
  const threatDistScore = Math.min(1, distToThreat / 10);
  
  score += weights.distance * (npcDistScore * 0.6 + threatDistScore * 0.4);
  
  // Protection factor (cover normal should face threat)
  const toThreat = vec3Normalize(vec3Sub(threatPos, cover.position));
  const facingThreat = vec3Dot(cover.normal, toThreat);
  
  // Cover should face toward threat (normal points away from cover)
  // So we want negative dot product (cover between us and threat)
  const protectionScore = Math.max(0, -facingThreat);
  score += weights.protection * protectionScore * (cover.quality / COVER_QUALITY.FULL);
  
  // Flanking potential (can we shoot from peek positions?)
  let flankScore = 0;
  if (cover.peekLeftPos && hasLineOfSight(cover.peekLeftPos, threatPos, obstacles)) {
    flankScore += 0.5;
  }
  if (cover.peekRightPos && hasLineOfSight(cover.peekRightPos, threatPos, obstacles)) {
    flankScore += 0.5;
  }
  score += weights.flanking * flankScore;
  
  // Freshness (avoid recently used cover)
  const timeSinceUsed = performance.now() - cover.lastUsedTime;
  const freshnessScore = Math.min(1, timeSinceUsed / 5000);
  score += weights.freshness * freshnessScore;
  
  // Destructible penalty
  if (cover.destructible && cover.currentHealth < cover.maxHealth * 0.5) {
    score *= 0.5;
  }
  
  return score;
}

/**
 * Find best cover point from available options
 * @param {Array<Object>} coverPoints - Available cover points
 * @param {number[]} npcPos - NPC position
 * @param {number[]} threatPos - Threat position
 * @param {Array} obstacles - Obstacles
 * @param {Object} options - Options
 * @returns {Object|null} Best cover point or null
 */
export function findBestCover(coverPoints, npcPos, threatPos, obstacles, options = {}) {
  let bestCover = null;
  let bestScore = -Infinity;
  
  for (const cover of coverPoints) {
    const score = scoreCoverPoint(cover, npcPos, threatPos, obstacles, options);
    if (score > bestScore) {
      bestScore = score;
      bestCover = cover;
    }
  }
  
  return bestScore > 0 ? bestCover : null;
}

// ============================================================================
// COVER STATE
// ============================================================================

/**
 * Create NPC cover state tracker
 * @returns {Object} Cover state
 */
export function createCoverState() {
  return {
    currentCover: null,
    action: COVER_ACTION.NONE,
    inCover: false,
    peekTimer: 0,
    peekDuration: 500, // ms to peek
    peekCooldown: 0,
    blindFireAccuracyPenalty: 0.7, // 70% worse accuracy
    suppressedUntil: 0,
    lastCoverChangeTime: 0,
  };
}

/**
 * Enter cover at a cover point
 * @param {Object} state - Cover state
 * @param {Object} cover - Cover point to enter
 * @param {number} npcId - NPC ID
 */
export function enterCover(state, cover, npcId) {
  if (state.currentCover) {
    state.currentCover.occupiedBy = null;
  }
  
  state.currentCover = cover;
  state.inCover = true;
  state.action = COVER_ACTION.CROUCH;
  cover.occupiedBy = npcId;
  cover.lastUsedTime = performance.now();
  state.lastCoverChangeTime = performance.now();
}

/**
 * Exit current cover
 * @param {Object} state - Cover state
 */
export function exitCover(state) {
  if (state.currentCover) {
    state.currentCover.occupiedBy = null;
  }
  
  state.currentCover = null;
  state.inCover = false;
  state.action = COVER_ACTION.NONE;
}

/**
 * Start peek action from cover
 * @param {Object} state - Cover state
 * @param {number} action - COVER_ACTION type
 * @param {number} now - Current time
 * @returns {boolean} True if peek started
 */
export function startPeek(state, action, now) {
  if (!state.inCover || state.peekCooldown > now) return false;
  if (state.action !== COVER_ACTION.CROUCH) return false;
  
  state.action = action;
  state.peekTimer = now + state.peekDuration;
  return true;
}

/**
 * Update cover state
 * @param {Object} state - Cover state
 * @param {number} now - Current time
 */
export function updateCoverState(state, now) {
  // End peek when timer expires
  if (state.peekTimer > 0 && now >= state.peekTimer) {
    state.action = COVER_ACTION.CROUCH;
    state.peekTimer = 0;
    state.peekCooldown = now + 300; // Brief cooldown before next peek
  }
  
  // Check if suppressed
  if (state.suppressedUntil > now) {
    // Force back into cover if suppressed
    if (state.action !== COVER_ACTION.CROUCH && state.action !== COVER_ACTION.BLIND_FIRE) {
      state.action = COVER_ACTION.CROUCH;
    }
  }
}

/**
 * Get current shoot position based on cover action
 * @param {Object} state - Cover state
 * @param {number[]} basePos - Base NPC position
 * @returns {number[]} Shoot position
 */
export function getCoverShootPosition(state, basePos) {
  if (!state.currentCover) return basePos;
  
  switch (state.action) {
    case COVER_ACTION.LEAN_LEFT:
      return state.currentCover.peekLeftPos || basePos;
    case COVER_ACTION.LEAN_RIGHT:
      return state.currentCover.peekRightPos || basePos;
    case COVER_ACTION.PEEK_OVER:
      return state.currentCover.peekOverPos || basePos;
    default:
      return basePos;
  }
}

/**
 * Check if NPC can shoot from current cover state
 * @param {Object} state - Cover state
 * @returns {{canShoot: boolean, accuracyMod: number}}
 */
export function canShootFromCover(state) {
  if (!state.inCover) {
    return { canShoot: true, accuracyMod: 1.0 };
  }
  
  switch (state.action) {
    case COVER_ACTION.CROUCH:
      return { canShoot: false, accuracyMod: 0 };
    case COVER_ACTION.LEAN_LEFT:
    case COVER_ACTION.LEAN_RIGHT:
      return { canShoot: true, accuracyMod: 0.9 };
    case COVER_ACTION.PEEK_OVER:
      return { canShoot: true, accuracyMod: 0.85 };
    case COVER_ACTION.BLIND_FIRE:
      return { canShoot: true, accuracyMod: 1 - state.blindFireAccuracyPenalty };
    default:
      return { canShoot: false, accuracyMod: 0 };
  }
}

// ============================================================================
// SUPPRESSION
// ============================================================================

/**
 * Apply suppression to an NPC
 * @param {Object} state - Cover state
 * @param {number} duration - Suppression duration in ms
 * @param {number} now - Current time
 */
export function applySuppression(state, duration, now) {
  state.suppressedUntil = Math.max(state.suppressedUntil, now + duration);
}

/**
 * Check if NPC is suppressed
 * @param {Object} state - Cover state
 * @param {number} now - Current time
 * @returns {boolean} True if suppressed
 */
export function isSuppressed(state, now) {
  return state.suppressedUntil > now;
}

/**
 * Apply damage to cover point
 * @param {Object} cover - Cover point
 * @param {number} damage - Damage amount
 * @returns {boolean} True if cover was destroyed
 */
export function damageCover(cover, damage) {
  if (!cover.destructible) return false;
  
  cover.currentHealth -= damage;
  
  if (cover.currentHealth <= 0) {
    cover.quality = COVER_QUALITY.NONE;
    return true;
  }
  
  // Degrade quality as health drops
  const healthPercent = cover.currentHealth / cover.maxHealth;
  if (healthPercent < 0.3) {
    cover.quality = COVER_QUALITY.LOW;
  } else if (healthPercent < 0.6) {
    cover.quality = Math.min(cover.quality, COVER_QUALITY.HIGH);
  }
  
  return false;
}

// ============================================================================
// FLANKING
// ============================================================================

/**
 * Find flanking positions around a target
 * @param {number[]} targetPos - Target position
 * @param {number[]} targetFacing - Target facing direction
 * @param {number} flankDistance - Distance to flank from
 * @param {Array<Object>} coverPoints - Available cover points
 * @param {Array} obstacles - Obstacles
 * @returns {Array<{position: number[], cover: Object|null, angle: number}>} Flank positions
 */
export function findFlankingPositions(targetPos, targetFacing, flankDistance, coverPoints, obstacles) {
  const results = [];
  const targetFacingNorm = vec3Normalize(targetFacing);
  
  // Check 8 directions around target
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const dir = [Math.cos(angle), 0, Math.sin(angle)];
    
    // Calculate how "flanking" this angle is (perpendicular to facing = good)
    const facingDot = Math.abs(vec3Dot(dir, targetFacingNorm));
    const flankValue = 1 - facingDot; // 1 = perfect flank, 0 = frontal
    
    if (flankValue < 0.5) continue; // Not flanking enough
    
    const flankPos = vec3Add(targetPos, vec3Scale(dir, flankDistance));
    
    // Check for cover near this position
    let nearestCover = null;
    let nearestDist = Infinity;
    
    for (const cover of coverPoints) {
      const dist = distance(cover.position, flankPos);
      if (dist < 5 && dist < nearestDist && cover.occupiedBy === null) {
        nearestDist = dist;
        nearestCover = cover;
      }
    }
    
    // Verify LOS to target from flank position
    const checkPos = nearestCover ? nearestCover.position : flankPos;
    if (hasLineOfSight(checkPos, targetPos, obstacles)) {
      results.push({
        position: checkPos,
        cover: nearestCover,
        angle: angle,
        flankValue,
      });
    }
  }
  
  // Sort by flank value (best flanks first)
  results.sort((a, b) => b.flankValue - a.flankValue);
  
  return results;
}

// ============================================================================
// RETREAT / FALL BACK
// ============================================================================

/**
 * Find retreat positions away from threat
 * @param {number[]} npcPos - NPC position
 * @param {number[]} threatPos - Threat position
 * @param {Array<Object>} coverPoints - Available cover
 * @param {Array} obstacles - Obstacles
 * @param {number} minRetreatDist - Minimum retreat distance
 * @returns {Array<Object>} Retreat cover points sorted by safety
 */
export function findRetreatCover(npcPos, threatPos, coverPoints, obstacles, minRetreatDist = 10) {
  const retreatDir = vec3Normalize(vec3Sub(npcPos, threatPos));
  const currentDist = distance(npcPos, threatPos);
  
  const candidates = [];
  
  for (const cover of coverPoints) {
    if (cover.occupiedBy !== null) continue;
    
    const coverDist = distance(cover.position, threatPos);
    
    // Must be further from threat than current position
    if (coverDist <= currentDist + minRetreatDist) continue;
    
    // Check if retreat path is relatively clear
    const toCover = vec3Normalize(vec3Sub(cover.position, npcPos));
    const retreatAlignment = vec3Dot(toCover, retreatDir);
    
    if (retreatAlignment < 0.3) continue; // Not retreating, going sideways or toward
    
    const score = scoreCoverPoint(cover, npcPos, threatPos, obstacles, {
      distanceWeight: 0.2,
      protectionWeight: 0.5,
      flankingWeight: 0.1,
      freshnessWeight: 0.2,
    });
    
    if (score > 0) {
      candidates.push({ cover, score, distance: coverDist });
    }
  }
  
  // Sort by score
  candidates.sort((a, b) => b.score - a.score);
  
  return candidates.map((c) => c.cover);
}
