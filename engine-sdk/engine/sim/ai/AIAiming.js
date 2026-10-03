// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>

//

// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha



/**

 * AIAiming.js - Core NPC targeting and aiming mechanics

 * 

 * Features:

 * - Ray-AABB and ray-sphere intersection (slab method)

 * - Predictive aim for moving targets (quadratic intercept)

 * - Gaussian accuracy spread (Box-Muller)

 * - Weighted threat scoring with hysteresis

 * - Target persistence and memory

 * - Voxel terrain LOS via DDA ray traversal

 * 

 * Uses engine vec3 utilities from EngineMath.js

 * 

 * ⚠️ MULTIPLAYER: Uses deterministic RNG from AIRandom.js

 */



import { aiRng } from './AIRandom.js';
import { degreesToRadians, radiansToDegrees } from "../../core/math/UnitMath.js";


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



// Voxel raycast, used for terrain line-of-sight checks.
//
// This was previously a top-level `await import()` of
// `../../../game/client/src/world/VoxelRaycast.js`, wrapped in a try/catch.
// That path resolves outside the repository root and does not exist in this
// layout, so the catch swallowed the failure on every load and terrain LOS
// checks were silently skipped — AI could see through solid rock. The module
// it wants is the engine's own voxel raycaster, which exports exactly this
// function.
//
// Imported statically so the dependency is visible to the bundler and a
// future move breaks the build loudly instead of degrading the AI in silence.
// It also removes a top-level await from a module that has to survive
// classic-script bundling.

import { hasVoxelLineOfSight } from "../../voxel/VoxelRaycast.js";



// ============================================================================

// CONSTANTS

// ============================================================================



/** Skill level presets for accuracy parameters */

export const SKILL_LEVELS = {

  novice: {

    baseAccuracy: 0.45,

    reactionTimeMs: 600,

    spreadAngleDeg: 10,

    trackingSpeedRadPerSec: 1.5,

  },

  average: {

    baseAccuracy: 0.70,

    reactionTimeMs: 350,

    spreadAngleDeg: 5,

    trackingSpeedRadPerSec: 4,

  },

  expert: {

    baseAccuracy: 0.90,

    reactionTimeMs: 200,

    spreadAngleDeg: 2,

    trackingSpeedRadPerSec: 8,

  },

};



/** Default threat weight factors */

export const DEFAULT_THREAT_WEIGHTS = {

  distance: 0.25,

  damagePotential: 0.20,

  isTargetingMe: 0.20,

  recentDamage: 0.15,

  lineOfSight: 0.20,

};



/** Hysteresis threshold - only switch targets if new threat exceeds by this factor */

export const TARGET_SWITCH_THRESHOLD = 1.5;



/** Time to remember lost targets (ms) */

export const TARGET_MEMORY_DURATION_MS = 3000;



// ============================================================================

// RAY STRUCTURE

// ============================================================================



/**

 * Create a ray with pre-computed inverse direction for fast intersection tests

 * @param {number[]} origin - [x, y, z] ray origin

 * @param {number[]} direction - [x, y, z] normalized direction

 * @returns {Object} Ray object with origin, direction, and invDir

 */

export function createRay(origin, direction) {

  const dir = vec3Normalize(direction);

  const EPSILON = 1e-10;

  return {

    origin: [...origin],

    direction: dir,

    invDir: [

      1.0 / (Math.abs(dir[0]) < EPSILON ? EPSILON : dir[0]),

      1.0 / (Math.abs(dir[1]) < EPSILON ? EPSILON : dir[1]),

      1.0 / (Math.abs(dir[2]) < EPSILON ? EPSILON : dir[2]),

    ],

  };

}



// ============================================================================

// RAY INTERSECTION - SLAB METHOD (AABB)

// ============================================================================



/**

 * Ray-AABB intersection using the slab method

 * Used by NVIDIA OptiX and other professional engines

 * @param {Object} ray - Ray with origin, direction, invDir

 * @param {number[]} aabbMin - [x, y, z] minimum corner

 * @param {number[]} aabbMax - [x, y, z] maximum corner

 * @returns {number} Distance to intersection, or -1 if no hit

 */

export function rayAABBIntersect(ray, aabbMin, aabbMax) {

  const t1x = (aabbMin[0] - ray.origin[0]) * ray.invDir[0];

  const t2x = (aabbMax[0] - ray.origin[0]) * ray.invDir[0];



  let tmin = Math.min(t1x, t2x);

  let tmax = Math.max(t1x, t2x);



  const t1y = (aabbMin[1] - ray.origin[1]) * ray.invDir[1];

  const t2y = (aabbMax[1] - ray.origin[1]) * ray.invDir[1];



  tmin = Math.max(tmin, Math.min(t1y, t2y));

  tmax = Math.min(tmax, Math.max(t1y, t2y));



  const t1z = (aabbMin[2] - ray.origin[2]) * ray.invDir[2];

  const t2z = (aabbMax[2] - ray.origin[2]) * ray.invDir[2];



  tmin = Math.max(tmin, Math.min(t1z, t2z));

  tmax = Math.min(tmax, Math.max(t1z, t2z));



  if (tmax >= Math.max(tmin, 0.0)) {

    return tmin >= 0 ? tmin : tmax;

  }

  return -1; // No hit

}



// ============================================================================

// RAY INTERSECTION - SPHERE (Quadratic)

// ============================================================================



/**

 * Ray-sphere intersection using quadratic formula

 * Good for character hitboxes and bounding spheres

 * @param {number[]} rayOrigin - [x, y, z]

 * @param {number[]} rayDir - [x, y, z] normalized direction

 * @param {number[]} sphereCenter - [x, y, z]

 * @param {number} radius - Sphere radius

 * @returns {number|null} Distance to intersection, or null if no hit

 */

export function raySphereIntersect(rayOrigin, rayDir, sphereCenter, radius) {

  const oc = vec3Sub(rayOrigin, sphereCenter);



  const a = vec3Dot(rayDir, rayDir);

  const b = 2.0 * vec3Dot(oc, rayDir);

  const c = vec3Dot(oc, oc) - radius * radius;



  const discriminant = b * b - 4 * a * c;

  if (discriminant < 0) return null;



  const sqrtDisc = Math.sqrt(discriminant);

  const t1 = (-b - sqrtDisc) / (2 * a);



  if (t1 > 0) return t1;



  const t2 = (-b + sqrtDisc) / (2 * a);

  return t2 > 0 ? t2 : null;

}



// ============================================================================

// LINE OF SIGHT CHECK

// ============================================================================



/**

 * Check line of sight between two points against obstacle list

 * @param {number[]} from - [x, y, z] start position

 * @param {number[]} to - [x, y, z] end position

 * @param {Array<{min: number[], max: number[]}>} obstacles - AABB obstacles

 * @param {Object} options - Optional settings

 * @param {Function} options.getVoxel - (x,y,z) => material ID for voxel terrain checks

 * @returns {boolean} True if line of sight is clear

 */

export function hasLineOfSight(from, to, obstacles, options = {}) {

  const direction = vec3Sub(to, from);

  const distance = vec3Length(direction);

  if (distance < 0.001) return true;



  // Check voxel terrain first (usually faster for terrain-heavy scenes)

  if (options.getVoxel && hasVoxelLineOfSight) {

    if (!hasVoxelLineOfSight(from, to, options.getVoxel, { maxDistance: distance })) {

      return false;

    }

  }



  // Then check AABB obstacles (entities, props, etc.)

  if (obstacles && obstacles.length > 0) {

    const ray = createRay(from, direction);

    for (let i = 0; i < obstacles.length; i++) {

      const obs = obstacles[i];

      const t = rayAABBIntersect(ray, obs.min, obs.max);

      if (t > 0 && t < distance) {

        return false;

      }

    }

  }

  return true;

}



/**

 * Check line of sight with sphere obstacles (characters)

 * @param {number[]} from - [x, y, z]

 * @param {number[]} to - [x, y, z]

 * @param {Array<{center: number[], radius: number}>} spheres - Sphere colliders

 * @param {number[]} ignoreIds - Entity IDs to ignore (self, target)

 * @returns {boolean} True if clear

 */

export function hasLineOfSightSpheres(from, to, spheres, ignoreIds = []) {

  const direction = vec3Sub(to, from);

  const distance = vec3Length(direction);

  if (distance < 0.001) return true;



  const dirNorm = vec3Normalize(direction);



  for (let i = 0; i < spheres.length; i++) {

    const sphere = spheres[i];

    if (ignoreIds.includes(sphere.id)) continue;



    const t = raySphereIntersect(from, dirNorm, sphere.center, sphere.radius);

    if (t !== null && t > 0 && t < distance) {

      return false;

    }

  }

  return true;

}



// ============================================================================

// PREDICTIVE AIMING - INTERCEPT CALCULATION

// ============================================================================



/**

 * Calculate aim point to intercept a moving target

 * Solves: |P + V×t|² = (S×t)² (quadratic intercept equation)

 * 

 * @param {number[]} shooterPos - [x, y, z] shooter position

 * @param {number} projectileSpeed - Speed of projectile (m/s)

 * @param {number[]} targetPos - [x, y, z] current target position

 * @param {number[]} targetVel - [x, y, z] target velocity

 * @returns {Object|null} {aimPoint: [x,y,z], timeToHit: number} or null if impossible

 */

export function predictiveAim(shooterPos, projectileSpeed, targetPos, targetVel) {

  const delta = vec3Sub(targetPos, shooterPos);



  // Quadratic: at² + bt + c = 0

  // Where: a = |V|² - S², b = 2(P·V), c = |P|²

  const a = vec3Dot(targetVel, targetVel) - projectileSpeed * projectileSpeed;

  const b = 2 * vec3Dot(delta, targetVel);

  const c = vec3Dot(delta, delta);



  // Handle edge case: projectile speed matches target speed exactly

  if (Math.abs(a) < 1e-6) {

    if (Math.abs(b) < 1e-6) return null; // No solution

    const t = -c / b;

    if (t < 0) return null;

    return {

      aimPoint: vec3Add(targetPos, vec3Scale(targetVel, t)),

      timeToHit: t,

    };

  }



  const discriminant = b * b - 4 * a * c;

  if (discriminant < 0) return null; // Target too fast to intercept



  // Use stable quadratic formula to avoid catastrophic cancellation

  const sqrtDisc = Math.sqrt(discriminant);

  const t = 2 * c / (sqrtDisc - b);



  if (t < 0) return null;



  return {

    aimPoint: vec3Add(targetPos, vec3Scale(targetVel, t)),

    timeToHit: t,

  };

}



/**

 * Iterative predictive aim for accelerating targets

 * @param {number[]} shooterPos - [x, y, z]

 * @param {number} projectileSpeed - m/s

 * @param {number[]} targetPos - [x, y, z]

 * @param {number[]} targetVel - [x, y, z]

 * @param {number[]} targetAccel - [x, y, z] acceleration

 * @param {number} iterations - Number of refinement iterations (default 4)

 * @returns {Object|null} {aimPoint, timeToHit} or null

 */

export function predictiveAimWithAcceleration(

  shooterPos,

  projectileSpeed,

  targetPos,

  targetVel,

  targetAccel,

  iterations = 4

) {

  let estimatedTime = vec3Length(vec3Sub(targetPos, shooterPos)) / projectileSpeed;



  for (let i = 0; i < iterations; i++) {

    // Predict target position at estimated time: P + Vt + 0.5at²

    const predictedPos = vec3Add(

      vec3Add(targetPos, vec3Scale(targetVel, estimatedTime)),

      vec3Scale(targetAccel, 0.5 * estimatedTime * estimatedTime)

    );



    const travelDist = vec3Length(vec3Sub(predictedPos, shooterPos));

    estimatedTime = travelDist / projectileSpeed;

  }



  const finalPos = vec3Add(

    vec3Add(targetPos, vec3Scale(targetVel, estimatedTime)),

    vec3Scale(targetAccel, 0.5 * estimatedTime * estimatedTime)

  );



  return {

    aimPoint: finalPos,

    timeToHit: estimatedTime,

  };

}



// ============================================================================

// ACCURACY SPREAD - GAUSSIAN (Box-Muller)

// ============================================================================



/**

 * Generate Gaussian-distributed random number using Box-Muller transform

 * @param {number} mean - Mean of distribution (default 0)

 * @param {number} stdDev - Standard deviation (default 1)

 * @returns {number} Gaussian-distributed value

 */

export function gaussianRandom(mean = 0, stdDev = 1, rng = null) {

  // Use provided RNG or fall back to aiRng for deterministic behavior

  const u1 = rng ? rng.float() : aiRng.float();

  const u2 = rng ? rng.float() : aiRng.float();

  // Avoid log(0)

  const safeU1 = Math.max(u1, 1e-10);

  const z0 = Math.sqrt(-2 * Math.log(safeU1)) * Math.cos(2 * Math.PI * u2);

  return mean + z0 * stdDev;

}



/**

 * Apply accuracy spread to aim direction (2D version)

 * @param {number[]} aimDirection - [x, y] normalized 2D direction

 * @param {number} spreadAngleRad - Spread angle in radians

 * @returns {number[]} [x, y] spread direction

 */

export function applyAccuracySpread2D(aimDirection, spreadAngleRad) {

  const currentAngle = Math.atan2(aimDirection[1], aimDirection[0]);

  const spreadOffset = gaussianRandom(0, spreadAngleRad);

  const newAngle = currentAngle + spreadOffset;



  return [Math.cos(newAngle), Math.sin(newAngle)];

}



/**

 * Apply accuracy spread to aim direction (3D version)

 * Generates a cone of spread around the aim direction

 * @param {number[]} aimDirection - [x, y, z] normalized 3D direction

 * @param {number} spreadAngleRad - Spread angle in radians

 * @returns {number[]} [x, y, z] spread direction

 */

export function applyAccuracySpread3D(aimDirection, spreadAngleRad) {

  // Generate random rotation angle around the aim vector

  const phi = aiRng.float() * 2 * Math.PI;



  // Generate spread angle with Gaussian distribution

  const theta = Math.abs(gaussianRandom(0, spreadAngleRad));



  // Find a perpendicular vector to build rotation basis

  let up = [0, 1, 0];

  if (Math.abs(vec3Dot(aimDirection, up)) > 0.99) {

    up = [1, 0, 0];

  }



  const right = vec3Normalize(vec3Cross(aimDirection, up));

  const actualUp = vec3Cross(right, aimDirection);



  // Apply cone spread

  const sinTheta = Math.sin(theta);

  const cosTheta = Math.cos(theta);

  const cosPhi = Math.cos(phi);

  const sinPhi = Math.sin(phi);



  return vec3Normalize([

    aimDirection[0] * cosTheta + right[0] * sinTheta * cosPhi + actualUp[0] * sinTheta * sinPhi,

    aimDirection[1] * cosTheta + right[1] * sinTheta * cosPhi + actualUp[1] * sinTheta * sinPhi,

    aimDirection[2] * cosTheta + right[2] * sinTheta * cosPhi + actualUp[2] * sinTheta * sinPhi,

  ]);

}



// ============================================================================

// THREAT SCORING

// ============================================================================



/**

 * Calculate threat score for a potential target

 * @param {Object} npc - NPC data {position, recentDamageFrom, currentTarget}

 * @param {Object} target - Target data {id, position, dps, currentTarget}

 * @param {Object} options - Options {maxRange, maxDps, obstacles, weights}

 * @returns {number} Threat score 0-1

 */

export function calculateThreatScore(npc, target, options = {}) {

  const maxRange = options.maxRange || 100;

  const maxDps = options.maxDps || 100;

  const weights = options.weights || DEFAULT_THREAT_WEIGHTS;

  const obstacles = options.obstacles || [];



  // Distance factor (closer = higher threat)

  const dist = vec3Length(vec3Sub(target.position, npc.position));

  const distanceFactor = 1 - Math.min(dist / maxRange, 1);



  // Damage potential factor

  const damageFactor = Math.min((target.dps || 0) / maxDps, 1);



  // Is targeting me factor

  const targetingMeFactor = target.currentTarget === npc.id ? 1 : 0;



  // Recent damage factor

  const recentDamage = (npc.recentDamageFrom && npc.recentDamageFrom[target.id]) || 0;

  const recentDamageFactor = Math.min(recentDamage / 100, 1);



  // Line of sight factor

  const losFactor = hasLineOfSight(npc.position, target.position, obstacles) ? 1 : 0;



  // Calculate weighted score

  return (

    distanceFactor * weights.distance +

    damageFactor * weights.damagePotential +

    targetingMeFactor * weights.isTargetingMe +

    recentDamageFactor * weights.recentDamage +

    losFactor * weights.lineOfSight

  );

}



/**

 * Select best target from candidates with hysteresis

 * @param {Object} npc - NPC data

 * @param {Array<Object>} candidates - Potential targets

 * @param {Object} options - Scoring options

 * @returns {Object|null} Best target or null

 */

export function selectTarget(npc, candidates, options = {}) {

  if (!candidates || candidates.length === 0) return null;



  let bestTarget = null;

  let bestScore = -Infinity;



  // Score current target if exists

  let currentScore = 0;

  const currentTargetId = npc.currentTargetId;



  for (const candidate of candidates) {

    const score = calculateThreatScore(npc, candidate, options);



    if (candidate.id === currentTargetId) {

      currentScore = score;

    }



    if (score > bestScore) {

      bestScore = score;

      bestTarget = candidate;

    }

  }



  // Apply hysteresis - only switch if significantly better

  if (currentTargetId && bestTarget && bestTarget.id !== currentTargetId) {

    if (bestScore < currentScore * TARGET_SWITCH_THRESHOLD) {

      // Stick with current target

      return candidates.find((c) => c.id === currentTargetId) || bestTarget;

    }

  }



  return bestTarget;

}



// ============================================================================

// TARGET MEMORY / PERSISTENCE

// ============================================================================



/**

 * Create a target memory tracker for an NPC

 * Remembers lost targets for a duration

 * @returns {Object} Target memory manager

 */

export function createTargetMemory() {

  return {

    /** @type {Map<number, {lastKnownPos: number[], lostTime: number}>} */

    lostTargets: new Map(),

    currentTargetId: null,

    lastSeenPos: null,

    lastSeenTime: 0,

  };

}



/**

 * Update target memory with current perception

 * @param {Object} memory - Target memory object

 * @param {Object|null} visibleTarget - Currently visible target or null

 * @param {number} now - Current timestamp (ms)

 */

export function updateTargetMemory(memory, visibleTarget, now) {

  // Clean up expired memories

  for (const [id, data] of memory.lostTargets) {

    if (now - data.lostTime > TARGET_MEMORY_DURATION_MS) {

      memory.lostTargets.delete(id);

    }

  }



  if (visibleTarget) {

    // Target is visible - update tracking

    if (memory.currentTargetId !== visibleTarget.id) {

      // Switched targets - remember old one if we had one

      if (memory.currentTargetId !== null && memory.lastSeenPos) {

        memory.lostTargets.set(memory.currentTargetId, {

          lastKnownPos: [...memory.lastSeenPos],

          lostTime: now,

        });

      }

      memory.currentTargetId = visibleTarget.id;

    }

    memory.lastSeenPos = [...visibleTarget.position];

    memory.lastSeenTime = now;

    memory.lostTargets.delete(visibleTarget.id);

  } else if (memory.currentTargetId !== null) {

    // Lost sight of target - add to lost targets

    if (memory.lastSeenPos) {

      memory.lostTargets.set(memory.currentTargetId, {

        lastKnownPos: [...memory.lastSeenPos],

        lostTime: now,

      });

    }

    memory.currentTargetId = null;

  }

}



/**

 * Get aim point considering target memory

 * @param {Object} memory - Target memory

 * @param {Object|null} visibleTarget - Currently visible target

 * @param {number} now - Current timestamp (ms)

 * @returns {number[]|null} Aim point [x, y, z] or null

 */

export function getAimPointFromMemory(memory, visibleTarget, now) {

  if (visibleTarget) {

    return [...visibleTarget.position];

  }



  // Check for remembered targets

  if (memory.currentTargetId !== null) {

    const lost = memory.lostTargets.get(memory.currentTargetId);

    if (lost && now - lost.lostTime < TARGET_MEMORY_DURATION_MS) {

      return [...lost.lastKnownPos];

    }

  }



  return null;

}



// ============================================================================

// ACCURACY DEGRADATION

// ============================================================================



/**

 * Calculate accuracy modifier based on combat conditions

 * @param {Object} params - Combat parameters

 * @param {number} params.distance - Distance to target

 * @param {number} params.maxAccurateRange - Range at which accuracy starts degrading

 * @param {number} params.shooterSpeed - Shooter movement speed

 * @param {number} params.targetSpeed - Target movement speed

 * @param {number} params.recoilAccumulated - Accumulated recoil from sustained fire (degrees)

 * @param {number} params.recoilRecoveryRate - Recoil recovery rate (degrees/second)

 * @param {number} params.timeSinceLastShot - Time since last shot (seconds)

 * @returns {number} Accuracy multiplier 0-1

 */

export function calculateAccuracyModifier(params) {

  const {

    distance = 0,

    maxAccurateRange = 50,

    shooterSpeed = 0,

    targetSpeed = 0,

    recoilAccumulated = 0,

    recoilRecoveryRate = 20,

    timeSinceLastShot = Infinity,

  } = params;



  let modifier = 1.0;



  // Distance penalty (quadratic falloff beyond max range)

  if (distance > maxAccurateRange) {

    const overRange = (distance - maxAccurateRange) / maxAccurateRange;

    modifier *= Math.max(0.3, 1 - overRange * overRange * 0.5);

  }



  // Shooter movement penalty

  if (shooterSpeed > 1) {

    modifier *= Math.max(0.5, 1 - shooterSpeed * 0.05);

  }



  // Target movement penalty

  if (targetSpeed > 2) {

    modifier *= Math.max(0.6, 1 - targetSpeed * 0.03);

  }



  // Recoil penalty with recovery

  if (recoilAccumulated > 0) {

    const recoveredRecoil = Math.max(0, recoilAccumulated - recoilRecoveryRate * timeSinceLastShot);

    const recoilPenalty = Math.min(recoveredRecoil / 30, 0.5);

    modifier *= 1 - recoilPenalty;

  }



  return Math.max(0.1, modifier);

}



/**

 * Convert degrees to radians

 * @param {number} deg - Degrees

 * @returns {number} Radians

 */

export function degToRad(deg) {

  return degreesToRadians(deg);
}



/**

 * Convert radians to degrees

 * @param {number} rad - Radians

 * @returns {number} Degrees

 */

export function radToDeg(rad) {

  return radiansToDegrees(rad);
}



// ============================================================================

// UTILITY: Distance helpers (avoid sqrt when possible)

// ============================================================================



/**

 * Squared distance between two points (faster than actual distance)

 * @param {number[]} a - [x, y, z]

 * @param {number[]} b - [x, y, z]

 * @returns {number} Squared distance

 */

export function distanceSquared(a, b) {

  const dx = b[0] - a[0];

  const dy = b[1] - a[1];

  const dz = b[2] - a[2];

  return dx * dx + dy * dy + dz * dz;

}



/**

 * Actual distance between two points

 * @param {number[]} a - [x, y, z]

 * @param {number[]} b - [x, y, z]

 * @returns {number} Distance

 */

export function distance(a, b) {

  return Math.sqrt(distanceSquared(a, b));

}



/**

 * Check if distance is within range (uses squared comparison)

 * @param {number[]} a - [x, y, z]

 * @param {number[]} b - [x, y, z]

 * @param {number} range - Maximum range

 * @returns {boolean} True if within range

 */

export function isWithinRange(a, b, range) {

  return distanceSquared(a, b) <= range * range;

}

