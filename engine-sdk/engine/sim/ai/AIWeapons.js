// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * AIWeapons.js - Weapon types for NPC combat
 * 
 * Features:
 * - Hitscan weapons (instant ray-based)
 * - Projectile weapons (ballistic trajectories)
 * - AoE spells (circular, cone)
 * - Beam weapons (continuous tracking)
 * - Grenades (bouncing, cooking)
 * - Damage falloff calculations
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
  raySphereIntersect,
  applyAccuracySpread3D,
  degToRad,
  distanceSquared,
  distance,
} from "./AIAiming.js";

// ============================================================================
// WEAPON TYPE REGISTRY
// ============================================================================

/** Weapon type constants */
export const WEAPON_TYPE = {
  HITSCAN: "hitscan",
  PROJECTILE: "projectile",
  MELEE: "melee",
  AOE_CIRCLE: "aoe_circle",
  AOE_CONE: "aoe_cone",
  BEAM: "beam",
  GRENADE: "grenade",
};

/** Default weapon configurations */
export const WEAPON_PRESETS = {
  pistol: {
    type: WEAPON_TYPE.HITSCAN,
    baseDamage: 25,
    maxRange: 50,
    spreadAngleDeg: 2,
    fireRateMs: 400,
    rangeModifier: 0.98,
  },
  rifle: {
    type: WEAPON_TYPE.HITSCAN,
    baseDamage: 35,
    maxRange: 150,
    spreadAngleDeg: 1,
    fireRateMs: 100,
    rangeModifier: 0.99,
  },
  shotgun: {
    type: WEAPON_TYPE.HITSCAN,
    baseDamage: 15,
    maxRange: 20,
    spreadAngleDeg: 8,
    fireRateMs: 900,
    pelletCount: 8,
    rangeModifier: 0.92,
  },
  arrow: {
    type: WEAPON_TYPE.PROJECTILE,
    baseDamage: 45,
    maxRange: 80,
    projectileSpeed: 55,
    gravity: 9.81,
    fireRateMs: 1200,
  },
  fireball: {
    type: WEAPON_TYPE.PROJECTILE,
    baseDamage: 60,
    maxRange: 40,
    projectileSpeed: 25,
    gravity: 0,
    fireRateMs: 2000,
    aoeRadius: 3,
  },
  flamethrower: {
    type: WEAPON_TYPE.AOE_CONE,
    baseDamage: 15,
    range: 10,
    coneAngleDeg: 45,
    dps: 50,
  },
  laser: {
    type: WEAPON_TYPE.BEAM,
    maxRange: 100,
    dps: 80,
    trackingSpeedRadPerSec: 3,
  },
  grenade: {
    type: WEAPON_TYPE.GRENADE,
    baseDamage: 100,
    maxRange: 40,
    fuseTimeMs: 3000,
    bounciness: 0.6,
    aoeRadius: 5,
    launchSpeed: 20,
  },
};

// ============================================================================
// HITSCAN WEAPONS
// ============================================================================

/**
 * Fire a hitscan weapon (instant ray hit)
 * @param {number[]} origin - [x, y, z] muzzle position
 * @param {number[]} direction - [x, y, z] aim direction
 * @param {Object} weapon - Weapon config
 * @param {Array<{id, min, max}|{id, center, radius}>} targets - Targets (AABB or sphere)
 * @param {Array<{min, max}>} obstacles - Obstacle AABBs
 * @returns {Object} {hit: boolean, targetId, damage, point, distance}
 */
export function fireHitscan(origin, direction, weapon, targets, obstacles = []) {
  const spreadRad = degToRad(weapon.spreadAngleDeg || 0);
  const spreadDir = spreadRad > 0 ? applyAccuracySpread3D(direction, spreadRad) : vec3Normalize(direction);
  const ray = createRay(origin, spreadDir);
  const maxRange = weapon.maxRange || 100;

  let closestT = maxRange;
  let hitTargetId = null;

  // Check obstacles first
  for (const obs of obstacles) {
    const t = rayAABBIntersect(ray, obs.min, obs.max);
    if (t > 0 && t < closestT) {
      closestT = t;
      hitTargetId = null; // Hit obstacle, not target
    }
  }

  // Check targets
  for (const target of targets) {
    let t;
    if (target.center !== undefined) {
      // Sphere collider
      t = raySphereIntersect(ray.origin, ray.direction, target.center, target.radius);
    } else if (target.min !== undefined) {
      // AABB collider
      t = rayAABBIntersect(ray, target.min, target.max);
    }

    if (t !== null && t > 0 && t < closestT) {
      closestT = t;
      hitTargetId = target.id;
    }
  }

  if (hitTargetId !== null) {
    const hitPoint = vec3Add(origin, vec3Scale(ray.direction, closestT));
    const damage = calculateDamageFalloff(
      weapon.baseDamage,
      closestT,
      weapon.rangeModifier || 0.98
    );

    return {
      hit: true,
      targetId: hitTargetId,
      damage,
      point: hitPoint,
      distance: closestT,
    };
  }

  return {
    hit: closestT < maxRange, // Hit something but not a target
    targetId: null,
    damage: 0,
    point: vec3Add(origin, vec3Scale(ray.direction, closestT)),
    distance: closestT,
  };
}

/**
 * Fire a shotgun (multiple pellets in ring pattern)
 * @param {number[]} origin - [x, y, z]
 * @param {number[]} direction - [x, y, z]
 * @param {Object} weapon - Weapon config
 * @param {Array} targets - Targets
 * @param {Array} obstacles - Obstacles
 * @returns {Array<Object>} Array of hit results per pellet
 */
export function fireShotgun(origin, direction, weapon, targets, obstacles = []) {
  const pelletCount = weapon.pelletCount || 8;
  const spreadAngleDeg = weapon.spreadAngleDeg || 10;
  const hits = [];

  // Center pellet (full accuracy)
  const centerWeapon = { ...weapon, spreadAngleDeg: 0 };
  hits.push(fireHitscan(origin, direction, centerWeapon, targets, obstacles));

  // Distribute remaining pellets in concentric rings
  const innerCount = Math.floor((pelletCount - 1) * 0.4);
  const outerCount = pelletCount - 1 - innerCount;

  // Inner ring (50% spread)
  for (let i = 0; i < innerCount; i++) {
    const angle = (i / innerCount) * 2 * Math.PI;
    const pelletDir = getDirectionAtSpread(direction, spreadAngleDeg * 0.5, angle);
    hits.push(fireHitscan(origin, pelletDir, centerWeapon, targets, obstacles));
  }

  // Outer ring (full spread)
  for (let i = 0; i < outerCount; i++) {
    const angle = (i / outerCount) * 2 * Math.PI + Math.PI / outerCount;
    const pelletDir = getDirectionAtSpread(direction, spreadAngleDeg, angle);
    hits.push(fireHitscan(origin, pelletDir, centerWeapon, targets, obstacles));
  }

  return hits;
}

/**
 * Get direction at a specific spread angle and rotation
 * @param {number[]} direction - Base direction
 * @param {number} spreadAngleDeg - Spread angle in degrees
 * @param {number} rotationRad - Rotation around base direction in radians
 * @returns {number[]} Spread direction
 */
function getDirectionAtSpread(direction, spreadAngleDeg, rotationRad) {
  const theta = degToRad(spreadAngleDeg);

  // Build orthonormal basis
  let up = [0, 1, 0];
  if (Math.abs(vec3Dot(direction, up)) > 0.99) {
    up = [1, 0, 0];
  }

  const right = vec3Normalize(vec3Cross(direction, up));
  const actualUp = vec3Cross(right, direction);

  const sinTheta = Math.sin(theta);
  const cosTheta = Math.cos(theta);
  const cosPhi = Math.cos(rotationRad);
  const sinPhi = Math.sin(rotationRad);

  return vec3Normalize([
    direction[0] * cosTheta + right[0] * sinTheta * cosPhi + actualUp[0] * sinTheta * sinPhi,
    direction[1] * cosTheta + right[1] * sinTheta * cosPhi + actualUp[1] * sinTheta * sinPhi,
    direction[2] * cosTheta + right[2] * sinTheta * cosPhi + actualUp[2] * sinTheta * sinPhi,
  ]);
}

/**
 * Calculate damage falloff (CS:GO style exponential)
 * @param {number} baseDamage - Base weapon damage
 * @param {number} distance - Distance to target
 * @param {number} rangeModifier - Falloff rate (0.98 = 2% per 500 units)
 * @returns {number} Final damage
 */
export function calculateDamageFalloff(baseDamage, distance, rangeModifier = 0.98) {
  return baseDamage * Math.pow(rangeModifier, distance / 500);
}

// ============================================================================
// PROJECTILE WEAPONS
// ============================================================================

/**
 * Create a projectile entity
 * @param {number[]} position - [x, y, z] spawn position
 * @param {number[]} velocity - [x, y, z] initial velocity
 * @param {Object} config - Projectile config
 * @returns {Object} Projectile state
 */
export function createProjectile(position, velocity, config = {}) {
  return {
    position: [...position],
    velocity: [...velocity],
    gravity: config.gravity ?? 9.81,
    baseDamage: config.baseDamage ?? 50,
    aoeRadius: config.aoeRadius ?? 0,
    lifetime: config.lifetime ?? 5000,
    spawnTime: performance.now(),
    active: true,
    ownerId: config.ownerId ?? null,
  };
}

/**
 * Update projectile position (kinematic motion)
 * @param {Object} projectile - Projectile state
 * @param {number} deltaTimeSec - Delta time in seconds
 */
export function updateProjectile(projectile, deltaTimeSec) {
  if (!projectile.active) return;

  // Apply gravity
  projectile.velocity[1] -= projectile.gravity * deltaTimeSec;

  // Update position
  projectile.position[0] += projectile.velocity[0] * deltaTimeSec;
  projectile.position[1] += projectile.velocity[1] * deltaTimeSec;
  projectile.position[2] += projectile.velocity[2] * deltaTimeSec;

  // Check lifetime
  if (performance.now() - projectile.spawnTime > projectile.lifetime) {
    projectile.active = false;
  }
}

/**
 * Get projectile position at future time (prediction)
 * P(t) = P₀ + V₀×t + ½×g×t²
 * @param {Object} projectile - Projectile state
 * @param {number} timeSec - Time in seconds
 * @returns {number[]} [x, y, z] predicted position
 */
export function getProjectilePositionAtTime(projectile, timeSec) {
  const gVec = [0, -projectile.gravity, 0];
  return [
    projectile.position[0] + projectile.velocity[0] * timeSec + 0.5 * gVec[0] * timeSec * timeSec,
    projectile.position[1] + projectile.velocity[1] * timeSec + 0.5 * gVec[1] * timeSec * timeSec,
    projectile.position[2] + projectile.velocity[2] * timeSec + 0.5 * gVec[2] * timeSec * timeSec,
  ];
}

/**
 * Check projectile collision with targets
 * @param {Object} projectile - Projectile state
 * @param {Array<{id, center, radius}>} targets - Sphere colliders
 * @param {number} projectileRadius - Projectile hitbox radius
 * @returns {Object|null} {targetId, point} or null
 */
export function checkProjectileCollision(projectile, targets, projectileRadius = 0.5) {
  for (const target of targets) {
    if (target.id === projectile.ownerId) continue;

    const dist = distance(projectile.position, target.center);
    if (dist < projectileRadius + target.radius) {
      return {
        targetId: target.id,
        point: [...projectile.position],
      };
    }
  }
  return null;
}

// ============================================================================
// AREA OF EFFECT (AoE)
// ============================================================================

/**
 * Check if target is in circular AoE
 * @param {number[]} targetPos - [x, y, z]
 * @param {number[]} center - [x, y, z] AoE center
 * @param {number} radius - AoE radius
 * @returns {boolean} True if in AoE
 */
export function isInCircularAoE(targetPos, center, radius) {
  return distanceSquared(targetPos, center) <= radius * radius;
}

/**
 * Calculate AoE damage with quadratic falloff
 * @param {number} baseDamage - Base damage at center
 * @param {number} distance - Distance from center
 * @param {number} radius - AoE radius
 * @returns {number} Damage amount
 */
export function calculateAoEDamage(baseDamage, dist, radius) {
  if (dist >= radius) return 0;
  const normalized = dist / radius;
  return baseDamage * (1 - normalized * normalized);
}

/**
 * Get all targets in circular AoE with damage
 * @param {number[]} center - [x, y, z] AoE center
 * @param {number} radius - AoE radius
 * @param {number} baseDamage - Base damage
 * @param {Array<{id, position}>} targets - Potential targets
 * @returns {Array<{id, damage, distance}>} Affected targets
 */
export function resolveCircularAoE(center, radius, baseDamage, targets) {
  const results = [];

  for (const target of targets) {
    const dist = distance(center, target.position);
    if (dist < radius) {
      results.push({
        id: target.id,
        damage: calculateAoEDamage(baseDamage, dist, radius),
        distance: dist,
      });
    }
  }

  return results;
}

/**
 * Check if target is in cone AoE
 * @param {number[]} targetPos - [x, y, z]
 * @param {number[]} origin - [x, y, z] cone origin
 * @param {number[]} direction - [x, y, z] cone direction
 * @param {number} halfAngleRad - Half cone angle in radians
 * @param {number} range - Cone range
 * @returns {boolean} True if in cone
 */
export function isInConeAoE(targetPos, origin, direction, halfAngleRad, range) {
  const toTarget = vec3Sub(targetPos, origin);
  const distSq = vec3Dot(toTarget, toTarget);

  if (distSq > range * range) return false;
  if (distSq < 0.0001) return true;

  const dist = Math.sqrt(distSq);
  const toTargetNorm = vec3Scale(toTarget, 1 / dist);

  const dot = vec3Dot(toTargetNorm, direction);
  return dot >= Math.cos(halfAngleRad);
}

/**
 * Get all targets in cone AoE
 * @param {number[]} origin - [x, y, z]
 * @param {number[]} direction - [x, y, z]
 * @param {number} coneAngleDeg - Full cone angle in degrees
 * @param {number} range - Cone range
 * @param {number} baseDamage - Base damage
 * @param {Array<{id, position}>} targets - Potential targets
 * @returns {Array<{id, damage, distance}>} Affected targets
 */
export function resolveConeAoE(origin, direction, coneAngleDeg, range, baseDamage, targets) {
  const halfAngleRad = degToRad(coneAngleDeg / 2);
  const dirNorm = vec3Normalize(direction);
  const results = [];

  for (const target of targets) {
    if (isInConeAoE(target.position, origin, dirNorm, halfAngleRad, range)) {
      const dist = distance(origin, target.position);
      // Linear falloff for cones
      const damage = baseDamage * (1 - dist / range);
      results.push({
        id: target.id,
        damage: Math.max(0, damage),
        distance: dist,
      });
    }
  }

  return results;
}

// ============================================================================
// BEAM WEAPONS
// ============================================================================

/**
 * Create a beam weapon state
 * @param {Object} config - Beam config
 * @returns {Object} Beam weapon state
 */
export function createBeamWeapon(config = {}) {
  return {
    maxRange: config.maxRange || 100,
    dps: config.dps || 50,
    trackingSpeedRadPerSec: config.trackingSpeedRadPerSec || 3,
    currentDirection: [1, 0, 0],
    active: false,
  };
}

/**
 * Update beam weapon direction toward target
 * @param {Object} beam - Beam weapon state
 * @param {number[]} origin - [x, y, z] beam origin
 * @param {number[]} targetPos - [x, y, z] target position
 * @param {number} deltaTimeSec - Delta time in seconds
 */
export function updateBeamTracking(beam, origin, targetPos, deltaTimeSec) {
  const desiredDir = vec3Normalize(vec3Sub(targetPos, origin));
  const maxAngle = beam.trackingSpeedRadPerSec * deltaTimeSec;

  // Rotate current direction toward desired
  const dot = vec3Dot(beam.currentDirection, desiredDir);
  const clampedDot = Math.min(1, Math.max(-1, dot));
  const angle = Math.acos(clampedDot);

  if (angle < 0.001) {
    beam.currentDirection = [...desiredDir];
    return;
  }

  const t = Math.min(1, maxAngle / angle);

  // Slerp-like interpolation
  beam.currentDirection = vec3Normalize([
    beam.currentDirection[0] * (1 - t) + desiredDir[0] * t,
    beam.currentDirection[1] * (1 - t) + desiredDir[1] * t,
    beam.currentDirection[2] * (1 - t) + desiredDir[2] * t,
  ]);
}

/**
 * Fire beam weapon (continuous damage)
 * @param {Object} beam - Beam weapon state
 * @param {number[]} origin - [x, y, z]
 * @param {Array} targets - Targets
 * @param {Array} obstacles - Obstacles
 * @param {number} deltaTimeSec - Delta time
 * @returns {Object} {hit, targetId, damage, endPoint}
 */
export function fireBeam(beam, origin, targets, obstacles, deltaTimeSec) {
  if (!beam.active) {
    return { hit: false, targetId: null, damage: 0, endPoint: origin };
  }

  const ray = createRay(origin, beam.currentDirection);
  let closestT = beam.maxRange;
  let hitTargetId = null;

  // Check obstacles
  for (const obs of obstacles) {
    const t = rayAABBIntersect(ray, obs.min, obs.max);
    if (t > 0 && t < closestT) {
      closestT = t;
      hitTargetId = null;
    }
  }

  // Check targets
  for (const target of targets) {
    let t;
    if (target.center !== undefined) {
      t = raySphereIntersect(ray.origin, ray.direction, target.center, target.radius);
    } else if (target.min !== undefined) {
      t = rayAABBIntersect(ray, target.min, target.max);
    }

    if (t !== null && t > 0 && t < closestT) {
      closestT = t;
      hitTargetId = target.id;
    }
  }

  const endPoint = vec3Add(origin, vec3Scale(ray.direction, closestT));
  const damage = hitTargetId !== null ? beam.dps * deltaTimeSec : 0;

  return {
    hit: hitTargetId !== null,
    targetId: hitTargetId,
    damage,
    endPoint,
  };
}

// ============================================================================
// GRENADES
// ============================================================================

/**
 * Create a grenade projectile
 * @param {number[]} position - [x, y, z] spawn position
 * @param {number[]} velocity - [x, y, z] initial velocity
 * @param {Object} config - Grenade config
 * @returns {Object} Grenade state
 */
export function createGrenade(position, velocity, config = {}) {
  return {
    position: [...position],
    velocity: [...velocity],
    gravity: config.gravity ?? 9.81,
    bounciness: config.bounciness ?? 0.6,
    fuseTimeMs: config.fuseTimeMs ?? 3000,
    cookTimeMs: config.cookTimeMs ?? 0, // Pre-cooked time
    spawnTime: performance.now(),
    baseDamage: config.baseDamage ?? 100,
    aoeRadius: config.aoeRadius ?? 5,
    active: true,
    bounceCount: 0,
    maxBounces: config.maxBounces ?? 5,
  };
}

/**
 * Update grenade physics
 * @param {Object} grenade - Grenade state
 * @param {number} deltaTimeSec - Delta time in seconds
 * @param {Array<{normal: number[], min: number[], max: number[]}>} surfaces - Bounce surfaces
 * @returns {boolean} True if exploded
 */
export function updateGrenade(grenade, deltaTimeSec, surfaces = []) {
  if (!grenade.active) return false;

  // Apply gravity
  grenade.velocity[1] -= grenade.gravity * deltaTimeSec;

  // Previous position for collision
  const prevPos = [...grenade.position];

  // Update position
  grenade.position[0] += grenade.velocity[0] * deltaTimeSec;
  grenade.position[1] += grenade.velocity[1] * deltaTimeSec;
  grenade.position[2] += grenade.velocity[2] * deltaTimeSec;

  // Check bounces against surfaces
  for (const surface of surfaces) {
    if (isPointInAABB(grenade.position, surface.min, surface.max)) {
      bounceGrenade(grenade, surface.normal);
    }
  }

  // Ground bounce (Y = 0)
  if (grenade.position[1] < 0) {
    grenade.position[1] = 0;
    bounceGrenade(grenade, [0, 1, 0]);
  }

  // Check fuse
  const elapsed = performance.now() - grenade.spawnTime + grenade.cookTimeMs;
  if (elapsed >= grenade.fuseTimeMs) {
    grenade.active = false;
    return true; // Exploded
  }

  return false;
}

/**
 * Apply bounce to grenade
 * @param {Object} grenade - Grenade state
 * @param {number[]} surfaceNormal - Surface normal [x, y, z]
 */
function bounceGrenade(grenade, surfaceNormal) {
  if (grenade.bounceCount >= grenade.maxBounces) {
    // Too many bounces, just stop
    grenade.velocity = [0, 0, 0];
    return;
  }

  // Reflect velocity: V' = V - 2(V·N)N
  const dot = vec3Dot(grenade.velocity, surfaceNormal);
  grenade.velocity = vec3Scale(
    vec3Sub(grenade.velocity, vec3Scale(surfaceNormal, 2 * dot)),
    grenade.bounciness
  );

  grenade.bounceCount++;
}

/**
 * Check if point is inside AABB
 * @param {number[]} point - [x, y, z]
 * @param {number[]} min - AABB min
 * @param {number[]} max - AABB max
 * @returns {boolean} True if inside
 */
function isPointInAABB(point, min, max) {
  return (
    point[0] >= min[0] &&
    point[0] <= max[0] &&
    point[1] >= min[1] &&
    point[1] <= max[1] &&
    point[2] >= min[2] &&
    point[2] <= max[2]
  );
}

/**
 * Calculate grenade launch velocity to hit target
 * @param {number[]} start - [x, y, z] throw position
 * @param {number[]} target - [x, y, z] target position
 * @param {number} gravity - Gravity value
 * @param {number} launchAngleDeg - Launch angle in degrees
 * @returns {number[]|null} [x, y, z] launch velocity or null if impossible
 */
export function calculateGrenadeLaunchVelocity(start, target, gravity, launchAngleDeg) {
  const dx = target[0] - start[0];
  const dy = target[1] - start[1];
  const dz = target[2] - start[2];
  const horizontalDist = Math.sqrt(dx * dx + dz * dz);

  const angleRad = degToRad(launchAngleDeg);
  const cosTheta = Math.cos(angleRad);
  const tanTheta = Math.tan(angleRad);

  // Calculate required speed
  const numerator = gravity * horizontalDist * horizontalDist;
  const denominator = 2 * cosTheta * cosTheta * (horizontalDist * tanTheta - dy);

  if (denominator <= 0) return null; // Impossible trajectory

  const speed = Math.sqrt(numerator / denominator);

  // Direction in XZ plane
  const horizontalDir = horizontalDist > 0.001 ? [dx / horizontalDist, dz / horizontalDist] : [1, 0];

  return [
    speed * cosTheta * horizontalDir[0],
    speed * Math.sin(angleRad),
    speed * cosTheta * horizontalDir[1],
  ];
}

// ============================================================================
// WEAPON CONTROLLER
// ============================================================================

/**
 * Create an NPC weapon controller for multi-weapon management
 * @returns {Object} Weapon controller
 */
export function createWeaponController() {
  return {
    weapons: new Map(),
    currentWeapon: null,
    switchCooldownMs: 500,
    lastSwitchTime: 0,
    lastFireTimes: new Map(),
  };
}

/**
 * Add weapon to controller
 * @param {Object} controller - Weapon controller
 * @param {string} name - Weapon name
 * @param {Object} config - Weapon config
 */
export function addWeapon(controller, name, config) {
  const preset = WEAPON_PRESETS[name] || {};
  controller.weapons.set(name, { ...preset, ...config, name });
  if (!controller.currentWeapon) {
    controller.currentWeapon = name;
  }
}

/**
 * Select best weapon for situation
 * @param {Object} controller - Weapon controller
 * @param {Object} params - Selection parameters
 * @param {number} params.targetDistance - Distance to target
 * @param {boolean} params.hasLineOfSight - Whether LOS is clear
 * @param {boolean} params.multipleTargets - Whether multiple targets are present
 * @returns {string|null} Best weapon name
 */
export function selectBestWeapon(controller, params) {
  const { targetDistance, hasLineOfSight, multipleTargets } = params;
  let bestWeapon = null;
  let bestScore = -Infinity;

  for (const [name, weapon] of controller.weapons) {
    let score = 0;
    const minRange = weapon.minRange || 0;
    const maxRange = weapon.maxRange || 100;

    // Range suitability
    if (targetDistance >= minRange && targetDistance <= maxRange) {
      score += 50;
      const optimal = (minRange + maxRange) / 2;
      score -= Math.abs(targetDistance - optimal) * 0.1;
    } else {
      score -= 50;
    }

    // Line of sight requirement
    if ((weapon.type === WEAPON_TYPE.HITSCAN || weapon.type === WEAPON_TYPE.BEAM) && !hasLineOfSight) {
      score -= 100;
    }

    // AoE bonus for multiple targets
    if (multipleTargets && (weapon.aoeRadius > 0 || weapon.type === WEAPON_TYPE.GRENADE)) {
      score += 30;
    }

    // Prefer current weapon (avoid constant switching)
    if (name === controller.currentWeapon) {
      score += 10;
    }

    if (score > bestScore) {
      bestScore = score;
      bestWeapon = name;
    }
  }

  return bestWeapon;
}

/**
 * Check if weapon can fire (fire rate cooldown)
 * @param {Object} controller - Weapon controller
 * @param {string} weaponName - Weapon to check
 * @param {number} now - Current timestamp (ms)
 * @returns {boolean} True if can fire
 */
export function canFireWeapon(controller, weaponName, now) {
  const weapon = controller.weapons.get(weaponName);
  if (!weapon) return false;

  const lastFire = controller.lastFireTimes.get(weaponName) || 0;
  const fireRate = weapon.fireRateMs || 500;

  return now - lastFire >= fireRate;
}

/**
 * Record weapon fire
 * @param {Object} controller - Weapon controller
 * @param {string} weaponName - Weapon fired
 * @param {number} now - Current timestamp (ms)
 */
export function recordWeaponFire(controller, weaponName, now) {
  controller.lastFireTimes.set(weaponName, now);
}
