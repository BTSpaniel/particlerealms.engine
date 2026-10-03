// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * AIHitDetection.js - Advanced Hit Detection for Spells and Projectiles
 * 
 * Features:
 * - Swept sphere/capsule collision (prevents tunneling)
 * - Time of impact calculation for accurate VFX
 * - Damage falloff curves (linear, quadratic, inverse square)
 * - Multiple hitbox types (sphere, capsule, AABB)
 * - Spatial hashing for efficient broad phase
 * 
 * Based on industry best practices:
 * - Conservative Advancement (Bullet Physics)
 * - GJK-based swept tests
 * - Motion clamping for CCD
 */

import {
  vec3,
  vec3Add,
  vec3Sub,
  vec3Scale,
  vec3Dot,
  vec3Length,
  vec3LengthSq,
  vec3Normalize,
  vec3Cross,
  vec3Lerp,
} from "../../core/math/EngineMath.js";

// ============================================================================
// CONSTANTS
// ============================================================================

/** Damage falloff types */
export const FALLOFF_TYPE = {
  NONE: 'none',           // Full damage at any distance
  LINEAR: 'linear',       // Damage = max * (1 - dist/radius)
  QUADRATIC: 'quadratic', // Damage = max * (1 - (dist/radius)²)
  INVERSE_SQ: 'inverse',  // Damage = max / (1 + dist²)
  STEP: 'step',           // Full damage in inner radius, reduced in outer
};

/** Hitbox types */
export const HITBOX_TYPE = {
  SPHERE: 'sphere',
  CAPSULE: 'capsule',
  AABB: 'aabb',
  CYLINDER: 'cylinder',
};

/** Default spatial hash cell size */
const DEFAULT_CELL_SIZE = 5.0;

// ============================================================================
// SWEPT SPHERE COLLISION (Prevents Tunneling)
// ============================================================================

/**
 * Swept sphere vs static sphere intersection
 * Finds time t in [0,1] when moving sphere first touches static sphere
 * 
 * @param {number[]} sphereStart - Moving sphere center at t=0
 * @param {number[]} sphereEnd - Moving sphere center at t=1
 * @param {number} sphereRadius - Moving sphere radius
 * @param {number[]} targetCenter - Static sphere center
 * @param {number} targetRadius - Static sphere radius
 * @returns {Object|null} {t, point, normal} or null if no hit
 */
export function sweptSphereSphere(sphereStart, sphereEnd, sphereRadius, targetCenter, targetRadius) {
  // Combined radius for Minkowski sum
  const combinedRadius = sphereRadius + targetRadius;
  
  // Direction and length of motion
  const d = vec3Sub(sphereEnd, sphereStart);
  const dLenSq = vec3LengthSq(d);
  
  // If not moving, just check overlap
  if (dLenSq < 1e-10) {
    const dist = vec3Length(vec3Sub(sphereStart, targetCenter));
    if (dist <= combinedRadius) {
      return { t: 0, point: sphereStart, normal: vec3Normalize(vec3Sub(sphereStart, targetCenter)) };
    }
    return null;
  }
  
  // Vector from target to start position
  const m = vec3Sub(sphereStart, targetCenter);
  
  // Quadratic coefficients: at² + bt + c = 0
  const a = dLenSq;
  const b = 2 * vec3Dot(m, d);
  const c = vec3Dot(m, m) - combinedRadius * combinedRadius;
  
  // Check if already overlapping at start
  if (c < 0) {
    return { t: 0, point: [...sphereStart], normal: vec3Normalize(m) };
  }
  
  const discriminant = b * b - 4 * a * c;
  
  // No intersection
  if (discriminant < 0) return null;
  
  // Find smallest positive t in [0, 1]
  const sqrtDisc = Math.sqrt(discriminant);
  const t1 = (-b - sqrtDisc) / (2 * a);
  const t2 = (-b + sqrtDisc) / (2 * a);
  
  let t = -1;
  if (t1 >= 0 && t1 <= 1) {
    t = t1;
  } else if (t2 >= 0 && t2 <= 1) {
    t = t2;
  }
  
  if (t < 0) return null;
  
  // Calculate hit point and normal
  const hitCenter = vec3Lerp(sphereStart, sphereEnd, t);
  const normal = vec3Normalize(vec3Sub(hitCenter, targetCenter));
  const hitPoint = vec3Add(targetCenter, vec3Scale(normal, targetRadius));
  
  return { t, point: hitPoint, normal };
}

/**
 * Swept sphere vs moving sphere intersection
 * Handles both objects moving (relative velocity approach)
 * 
 * @param {Object} sphereA - {start, end, radius}
 * @param {Object} sphereB - {start, end, radius}
 * @returns {Object|null} {t, point, normal} or null
 */
export function sweptSphereSphereMoving(sphereA, sphereB) {
  // Compute relative motion: treat B as stationary, A moves relative
  const relStart = sphereA.start;
  const relEnd = vec3Add(
    sphereA.end,
    vec3Sub(sphereB.start, sphereB.end) // Subtract B's motion
  );
  
  return sweptSphereSphere(
    relStart, relEnd, sphereA.radius,
    sphereB.start, sphereB.radius
  );
}

/**
 * Swept capsule collision (projectile path as line segment)
 * Creates a capsule from start to end position with given radius
 * 
 * @param {number[]} capsuleStart - Capsule line start
 * @param {number[]} capsuleEnd - Capsule line end
 * @param {number} capsuleRadius - Capsule radius
 * @param {number[]} targetCenter - Target sphere center
 * @param {number} targetRadius - Target sphere radius
 * @returns {Object|null} {t, point, normal, distance} or null
 */
export function capsuleSphereIntersect(capsuleStart, capsuleEnd, capsuleRadius, targetCenter, targetRadius) {
  const combinedRadius = capsuleRadius + targetRadius;
  
  // Capsule axis
  const axis = vec3Sub(capsuleEnd, capsuleStart);
  const axisLenSq = vec3LengthSq(axis);
  
  if (axisLenSq < 1e-10) {
    // Degenerate capsule (point)
    const dist = vec3Length(vec3Sub(capsuleStart, targetCenter));
    if (dist <= combinedRadius) {
      return { t: 0, point: capsuleStart, distance: dist };
    }
    return null;
  }
  
  const axisLen = Math.sqrt(axisLenSq);
  const axisNorm = vec3Scale(axis, 1 / axisLen);
  
  // Project target center onto capsule axis
  const toTarget = vec3Sub(targetCenter, capsuleStart);
  const projection = vec3Dot(toTarget, axisNorm);
  
  // Clamp to capsule segment
  const clampedProj = Math.max(0, Math.min(axisLen, projection));
  
  // Closest point on capsule axis
  const closestPoint = vec3Add(capsuleStart, vec3Scale(axisNorm, clampedProj));
  
  // Distance from closest point to target center
  const diff = vec3Sub(targetCenter, closestPoint);
  const distSq = vec3LengthSq(diff);
  
  if (distSq <= combinedRadius * combinedRadius) {
    const dist = Math.sqrt(distSq);
    const t = clampedProj / axisLen; // Normalized position along capsule
    const normal = dist > 1e-6 ? vec3Scale(diff, 1 / dist) : [0, 1, 0];
    const point = vec3Add(closestPoint, vec3Scale(normal, capsuleRadius));
    
    return { t, point, normal, distance: dist };
  }
  
  return null;
}

// ============================================================================
// DAMAGE FALLOFF CALCULATIONS
// ============================================================================

/**
 * Calculate damage with distance falloff
 * 
 * @param {number} baseDamage - Maximum damage at center
 * @param {number} distance - Distance from effect center
 * @param {number} radius - Effect radius
 * @param {string} falloffType - Type of falloff curve
 * @param {Object} options - Additional options
 * @returns {number} Calculated damage
 */
export function calculateDamageFalloff(baseDamage, distance, radius, falloffType = FALLOFF_TYPE.LINEAR, options = {}) {
  if (distance >= radius) return 0;
  if (distance <= 0) return baseDamage;
  
  const normalized = distance / radius; // 0 at center, 1 at edge
  
  switch (falloffType) {
    case FALLOFF_TYPE.NONE:
      return baseDamage;
      
    case FALLOFF_TYPE.LINEAR:
      // Linear falloff: full at center, zero at edge
      return baseDamage * (1 - normalized);
      
    case FALLOFF_TYPE.QUADRATIC:
      // Quadratic falloff: sharper drop near edge
      return baseDamage * (1 - normalized * normalized);
      
    case FALLOFF_TYPE.INVERSE_SQ:
      // Inverse square: realistic explosion physics
      const minDist = options.minDistance ?? 0.5;
      const effectiveDist = Math.max(distance, minDist);
      return baseDamage / (1 + (effectiveDist * effectiveDist));
      
    case FALLOFF_TYPE.STEP:
      // Step function: full damage in inner radius, reduced in outer ring
      const innerRadius = options.innerRadius ?? (radius * 0.5);
      if (distance <= innerRadius) {
        return baseDamage;
      }
      const outerNorm = (distance - innerRadius) / (radius - innerRadius);
      return baseDamage * (1 - outerNorm) * (options.outerMultiplier ?? 0.5);
      
    default:
      return baseDamage * (1 - normalized);
  }
}

// ============================================================================
// AOE HIT DETECTION
// ============================================================================

/**
 * Find all targets within an Area of Effect
 * 
 * @param {number[]} center - AoE center position
 * @param {number} radius - AoE radius
 * @param {Array} targets - Array of {id, position, radius}
 * @param {Object} options - Detection options
 * @returns {Array} Array of {target, distance, damage}
 */
export function getAoETargets(center, radius, targets, options = {}) {
  const {
    baseDamage = 100,
    falloffType = FALLOFF_TYPE.LINEAR,
    excludeIds = [],
    requireLOS = false,
    losChecker = null, // Function(from, to) => boolean
  } = options;
  
  const hits = [];
  
  for (const target of targets) {
    if (excludeIds.includes(target.id)) continue;
    
    const diff = vec3Sub(target.position, center);
    const dist = vec3Length(diff);
    
    // Check if within range (accounting for target's own radius)
    const effectiveRadius = radius + (target.radius ?? 0);
    if (dist > effectiveRadius) continue;
    
    // Optional line-of-sight check
    if (requireLOS && losChecker && !losChecker(center, target.position)) {
      continue;
    }
    
    const damage = calculateDamageFalloff(baseDamage, dist, radius, falloffType, options);
    
    hits.push({
      target,
      distance: dist,
      damage,
      direction: dist > 0.001 ? vec3Scale(diff, 1 / dist) : [0, 0, 0],
    });
  }
  
  // Sort by distance (closest first)
  hits.sort((a, b) => a.distance - b.distance);
  
  return hits;
}

/**
 * Cone-shaped AoE (dragon breath, flamethrower)
 * 
 * @param {number[]} origin - Cone apex
 * @param {number[]} direction - Cone direction (normalized)
 * @param {number} halfAngle - Half angle in radians
 * @param {number} range - Cone length
 * @param {Array} targets - Array of {id, position, radius}
 * @param {Object} options - Detection options
 * @returns {Array} Array of {target, distance, damage, angle}
 */
export function getConeTargets(origin, direction, halfAngle, range, targets, options = {}) {
  const {
    baseDamage = 100,
    falloffType = FALLOFF_TYPE.LINEAR,
    excludeIds = [],
  } = options;
  
  const cosHalfAngle = Math.cos(halfAngle);
  const hits = [];
  
  for (const target of targets) {
    if (excludeIds.includes(target.id)) continue;
    
    const toTarget = vec3Sub(target.position, origin);
    const dist = vec3Length(toTarget);
    
    if (dist > range + (target.radius ?? 0)) continue;
    if (dist < 0.001) continue;
    
    const toTargetNorm = vec3Scale(toTarget, 1 / dist);
    const cosAngle = vec3Dot(direction, toTargetNorm);
    
    // Check if within cone angle
    if (cosAngle < cosHalfAngle) continue;
    
    const damage = calculateDamageFalloff(baseDamage, dist, range, falloffType, options);
    const angle = Math.acos(Math.min(1, Math.max(-1, cosAngle)));
    
    hits.push({
      target,
      distance: dist,
      damage,
      angle,
      direction: toTargetNorm,
    });
  }
  
  hits.sort((a, b) => a.distance - b.distance);
  return hits;
}

// ============================================================================
// SPATIAL HASHING (Broad Phase Optimization)
// ============================================================================

/**
 * Spatial hash for efficient broad-phase collision detection
 */
export class SpatialHash {
  constructor(cellSize = DEFAULT_CELL_SIZE) {
    this.cellSize = cellSize;
    this.cells = new Map();
    this.entityToCell = new Map();
  }
  
  /**
   * Hash a world position to cell key
   */
  hash(x, y, z) {
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    const cz = Math.floor(z / this.cellSize);
    return `${cx},${cy},${cz}`;
  }
  
  /**
   * Clear all entries
   */
  clear() {
    this.cells.clear();
    this.entityToCell.clear();
  }
  
  /**
   * Insert an entity at a position
   */
  insert(entity, position) {
    const key = this.hash(position[0], position[1], position[2]);
    
    if (!this.cells.has(key)) {
      this.cells.set(key, new Set());
    }
    
    this.cells.get(key).add(entity);
    this.entityToCell.set(entity.id, key);
  }
  
  /**
   * Remove an entity
   */
  remove(entityId) {
    const key = this.entityToCell.get(entityId);
    if (key && this.cells.has(key)) {
      const cell = this.cells.get(key);
      for (const entity of cell) {
        if (entity.id === entityId) {
          cell.delete(entity);
          break;
        }
      }
    }
    this.entityToCell.delete(entityId);
  }
  
  /**
   * Query all entities within radius of a position
   */
  queryRadius(position, radius) {
    const results = [];
    const cellRadius = Math.ceil(radius / this.cellSize);
    
    const cx = Math.floor(position[0] / this.cellSize);
    const cy = Math.floor(position[1] / this.cellSize);
    const cz = Math.floor(position[2] / this.cellSize);
    
    for (let dx = -cellRadius; dx <= cellRadius; dx++) {
      for (let dy = -cellRadius; dy <= cellRadius; dy++) {
        for (let dz = -cellRadius; dz <= cellRadius; dz++) {
          const key = `${cx + dx},${cy + dy},${cz + dz}`;
          const cell = this.cells.get(key);
          if (cell) {
            for (const entity of cell) {
              results.push(entity);
            }
          }
        }
      }
    }
    
    return results;
  }
  
  /**
   * Query entities along a ray/path (for swept collision)
   */
  queryPath(start, end, radius) {
    const results = new Set();
    
    const dir = vec3Sub(end, start);
    const len = vec3Length(dir);
    if (len < 0.001) {
      return this.queryRadius(start, radius);
    }
    
    // Step along the path
    const stepSize = this.cellSize * 0.5;
    const steps = Math.ceil(len / stepSize);
    
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const pos = vec3Lerp(start, end, t);
      const nearby = this.queryRadius(pos, radius + this.cellSize);
      for (const entity of nearby) {
        results.add(entity);
      }
    }
    
    return Array.from(results);
  }
}

// ============================================================================
// PROJECTILE HIT DETECTION (Complete System)
// ============================================================================

/**
 * Check projectile hit with swept collision and spatial optimization
 * 
 * @param {Object} projectile - {prevPosition, position, radius, velocity, ownerId}
 * @param {Array} targets - Array of {id, position, radius}
 * @param {Object} options - Detection options
 * @returns {Object|null} {target, t, point, normal, damage} or null
 */
export function checkProjectileHit(projectile, targets, options = {}) {
  const {
    baseDamage = 50,
    useSweep = true,
    spatialHash = null,
  } = options;
  
  const prevPos = projectile.prevPosition ?? projectile.position;
  const currPos = projectile.position;
  const projRadius = projectile.radius ?? 0.3;
  
  // Use spatial hash if available for broad phase
  const candidates = spatialHash 
    ? spatialHash.queryPath(prevPos, currPos, projRadius + 5) // 5 = max target radius estimate
    : targets;
  
  let closestHit = null;
  let closestT = Infinity;
  
  for (const target of candidates) {
    if (target.id === projectile.ownerId) continue;
    
    let hit;
    
    if (useSweep) {
      // Swept sphere test (prevents tunneling)
      hit = sweptSphereSphere(
        prevPos, currPos, projRadius,
        target.position, target.radius ?? 0.5
      );
    } else {
      // Simple discrete check
      hit = capsuleSphereIntersect(
        prevPos, currPos, projRadius,
        target.position, target.radius ?? 0.5
      );
    }
    
    if (hit && hit.t < closestT) {
      closestT = hit.t;
      closestHit = {
        target,
        t: hit.t,
        point: hit.point,
        normal: hit.normal,
        distance: hit.distance ?? 0,
        damage: baseDamage,
      };
    }
  }
  
  return closestHit;
}

/**
 * Check beam/ray hit against multiple targets
 * 
 * @param {number[]} origin - Ray origin
 * @param {number[]} direction - Ray direction (normalized)
 * @param {number} maxRange - Maximum ray length
 * @param {Array} targets - Array of {id, position, radius} or {id, min, max} for AABB
 * @param {Object} options - Detection options
 * @returns {Object|null} {target, t, point, normal}
 */
export function checkBeamHit(origin, direction, maxRange, targets, options = {}) {
  const {
    excludeIds = [],
    piercing = false, // If true, returns all hits
  } = options;
  
  const hits = [];
  
  for (const target of targets) {
    if (excludeIds.includes(target.id)) continue;
    
    let t = null;
    
    if (target.position !== undefined) {
      // Sphere target
      t = raySphereIntersect(origin, direction, target.position, target.radius ?? 0.5);
    } else if (target.min !== undefined) {
      // AABB target
      t = rayAABBIntersect({ origin, direction, invDir: computeInvDir(direction) }, target.min, target.max);
    }
    
    if (t !== null && t > 0 && t <= maxRange) {
      const point = vec3Add(origin, vec3Scale(direction, t));
      const normal = target.position 
        ? vec3Normalize(vec3Sub(point, target.position))
        : [0, 1, 0]; // Simplified for AABB
        
      hits.push({ target, t, point, normal });
    }
  }
  
  if (hits.length === 0) return null;
  
  hits.sort((a, b) => a.t - b.t);
  
  return piercing ? hits : hits[0];
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function computeInvDir(direction) {
  const EPSILON = 1e-10;
  return [
    1.0 / (Math.abs(direction[0]) < EPSILON ? EPSILON : direction[0]),
    1.0 / (Math.abs(direction[1]) < EPSILON ? EPSILON : direction[1]),
    1.0 / (Math.abs(direction[2]) < EPSILON ? EPSILON : direction[2]),
  ];
}

function raySphereIntersect(rayOrigin, rayDir, sphereCenter, radius) {
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

function rayAABBIntersect(ray, aabbMin, aabbMax) {
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
  return null;
}

// ============================================================================
// EXPORTS SUMMARY
// ============================================================================

export default {
  // Swept collision
  sweptSphereSphere,
  sweptSphereSphereMoving,
  capsuleSphereIntersect,
  
  // Damage
  calculateDamageFalloff,
  FALLOFF_TYPE,
  
  // AoE
  getAoETargets,
  getConeTargets,
  
  // Spatial optimization
  SpatialHash,
  
  // Complete systems
  checkProjectileHit,
  checkBeamHit,
};
