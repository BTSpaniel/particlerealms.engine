// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * AIAimingSystem.js - High-level NPC aiming system controller
 * 
 * Features:
 * - LOD-based update frequency (distance from player)
 * - Full NPC combat state machine
 * - Integrates all aiming subsystems
 * - Performance optimizations (staggered updates)
 */

import {
  vec3,
  vec3Sub,
  vec3Length,
  vec3Normalize,
  vec3Scale,
  vec3Add,
  vec3Dot,
} from "../../core/math/EngineMath.js";
import {
  SKILL_LEVELS,
  createTargetMemory,
  updateTargetMemory,
  getAimPointFromMemory,
  predictiveAim,
  predictiveAimWithAcceleration,
  applyAccuracySpread3D,
  calculateAccuracyModifier,
  selectTarget,
  hasLineOfSight,
  degToRad,
  distance,
  distanceSquared,
} from "./AIAiming.js";
import {
  createMeleeAttackState,
  startMeleeAttack,
  updateMeleeAttack,
  checkMeleeHits,
} from "./AIMelee.js";
import {
  WEAPON_TYPE,
  createWeaponController,
  addWeapon,
  selectBestWeapon,
  canFireWeapon,
  recordWeaponFire,
  fireHitscan,
  fireShotgun,
  createProjectile,
  resolveCircularAoE,
  resolveConeAoE,
  fireBeam,
} from "./AIWeapons.js";
import {
  createSpatialHash,
  spatialHashQueryRadius,
  spatialHashUpdate,
} from "./SpatialHash.js";
import {
  setBlackboardValue,
  getBlackboardValue,
} from "./Blackboard.js";

// ============================================================================
// CONSTANTS
// ============================================================================

/** NPC combat states */
export const COMBAT_STATE = {
  IDLE: 0,
  SEARCHING: 1,
  ENGAGING: 2,
  REPOSITIONING: 3,
  RETREATING: 4,
  DEAD: 5,
};

/** LOD update frequencies (frame intervals) */
export const LOD_UPDATE_INTERVALS = {
  veryClose: 1, // < 10m: every frame
  close: 2, // < 30m: every 2 frames
  medium: 4, // < 60m: every 4 frames
  far: 8, // < 100m: every 8 frames
  veryFar: 16, // > 100m: every 16 frames
};

// ============================================================================
// NPC COMBAT CONTROLLER
// ============================================================================

/**
 * Create an NPC combat controller
 * @param {Object} config - NPC configuration
 * @returns {Object} NPC combat controller
 */
export function createNPCCombatController(config = {}) {
  const skillLevel = SKILL_LEVELS[config.skill || "average"];

  return {
    // Identity
    id: config.id ?? 0,
    team: config.team ?? 0,

    // Position/movement
    position: config.position ? [...config.position] : [0, 0, 0],
    velocity: [0, 0, 0],
    facing: config.facing ? vec3Normalize(config.facing) : [0, 0, 1],
    moveSpeed: config.moveSpeed ?? 5,

    // Combat state
    state: COMBAT_STATE.IDLE,
    health: config.health ?? 100,
    maxHealth: config.maxHealth ?? 100,
    isDead: false,

    // Targeting
    targetMemory: createTargetMemory(),
    currentTarget: null,
    currentTargetId: null,
    lastKnownTargetPos: null,
    recentDamageFrom: {},

    // Aiming
    aimDirection: [0, 0, 1],
    desiredAimDirection: [0, 0, 1],
    skill: skillLevel,
    reactionTimer: 0,
    recoilAccumulated: 0,
    lastShotTime: 0,

    // Weapons
    weapons: createWeaponController(),
    meleeState: null,

    // LOD
    distanceToPlayer: Infinity,
    updateInterval: LOD_UPDATE_INTERVALS.veryFar,
    lastUpdateFrame: 0,

    // Blackboard for behavior tree integration
    blackboard: null,
  };
}

/**
 * Initialize weapons for an NPC
 * @param {Object} npc - NPC combat controller
 * @param {Array<{name: string, config: Object}>} weaponList - Weapons to add
 */
export function initNPCWeapons(npc, weaponList) {
  for (const { name, config } of weaponList) {
    addWeapon(npc.weapons, name, config || {});
  }
}

/**
 * Initialize melee for an NPC
 * @param {Object} npc - NPC combat controller
 * @param {Object} config - Melee configuration
 */
export function initNPCMelee(npc, config = {}) {
  npc.meleeState = createMeleeAttackState({
    range: config.range ?? 2.5,
    arcAngleDeg: config.arcAngleDeg ?? 90,
    damage: config.damage ?? 25,
    windupMs: config.windupMs ?? 200,
    activeMs: config.activeMs ?? 100,
    recoveryMs: config.recoveryMs ?? 300,
  });
}

// ============================================================================
// AIMING SYSTEM
// ============================================================================

/**
 * Create the main AI aiming system
 * @param {Object} config - System configuration
 * @returns {Object} AI aiming system
 */
export function createAIAimingSystem(config = {}) {
  return {
    npcs: new Map(),
    targetSpatialHash: createSpatialHash(config.spatialCellSize || 10),
    obstacleSpatialHash: createSpatialHash(config.spatialCellSize || 10),

    // Player reference for LOD
    playerPosition: [0, 0, 0],
    playerId: config.playerId ?? -1,

    // Frame counter for staggered updates
    frameCount: 0,

    // Global settings
    maxTargetRange: config.maxTargetRange ?? 100,
    threatWeights: config.threatWeights ?? null,

    // Debug
    debugMode: config.debugMode ?? false,
    debugLogs: [],
  };
}

/**
 * Register an NPC with the aiming system
 * @param {Object} system - AI aiming system
 * @param {Object} npc - NPC combat controller
 */
export function registerNPC(system, npc) {
  system.npcs.set(npc.id, npc);
}

/**
 * Unregister an NPC from the aiming system
 * @param {Object} system - AI aiming system
 * @param {number} npcId - NPC ID
 */
export function unregisterNPC(system, npcId) {
  system.npcs.delete(npcId);
}

/**
 * Update player position for LOD calculations
 * @param {Object} system - AI aiming system
 * @param {number[]} position - [x, y, z] player position
 */
export function updatePlayerPosition(system, position) {
  system.playerPosition = [...position];
}

/**
 * Main update function for the AI aiming system
 * @param {Object} system - AI aiming system
 * @param {number} deltaTimeMs - Delta time in milliseconds
 * @param {Array<Object>} potentialTargets - All potential targets {id, position, velocity, team, dps}
 * @param {Array<Object>} obstacles - Obstacle AABBs {min, max}
 */
export function updateAIAimingSystem(system, deltaTimeMs, potentialTargets, obstacles) {
  system.frameCount++;

  // Update LOD for all NPCs
  for (const [id, npc] of system.npcs) {
    npc.distanceToPlayer = distance(npc.position, system.playerPosition);
    npc.updateInterval = getUpdateInterval(npc.distanceToPlayer);
  }

  // Staggered NPC updates
  for (const [id, npc] of system.npcs) {
    if (npc.isDead) continue;

    // LOD check - skip if not due for update
    if (system.frameCount % npc.updateInterval !== 0) continue;

    updateNPCAiming(system, npc, deltaTimeMs * npc.updateInterval, potentialTargets, obstacles);
  }

  // Clear debug logs periodically
  if (system.debugMode && system.debugLogs.length > 1000) {
    system.debugLogs.splice(0, 500);
  }
}

/**
 * Get update interval based on distance (LOD)
 * @param {number} dist - Distance to player
 * @returns {number} Update interval in frames
 */
function getUpdateInterval(dist) {
  if (dist < 10) return LOD_UPDATE_INTERVALS.veryClose;
  if (dist < 30) return LOD_UPDATE_INTERVALS.close;
  if (dist < 60) return LOD_UPDATE_INTERVALS.medium;
  if (dist < 100) return LOD_UPDATE_INTERVALS.far;
  return LOD_UPDATE_INTERVALS.veryFar;
}

/**
 * Update aiming for a single NPC
 * @param {Object} system - AI aiming system
 * @param {Object} npc - NPC combat controller
 * @param {number} deltaTimeMs - Delta time in milliseconds
 * @param {Array<Object>} potentialTargets - All potential targets
 * @param {Array<Object>} obstacles - Obstacles
 */
function updateNPCAiming(system, npc, deltaTimeMs, potentialTargets, obstacles) {
  const deltaTimeSec = deltaTimeMs / 1000;
  const now = performance.now();

  // Filter targets by team
  const validTargets = potentialTargets.filter(
    (t) => t.team !== npc.team && t.id !== npc.id
  );

  // Select target
  const visibleTargets = validTargets.filter((t) =>
    hasLineOfSight(npc.position, t.position, obstacles)
  );

  const selectedTarget = selectTarget(
    { ...npc, position: npc.position, currentTargetId: npc.currentTargetId },
    visibleTargets,
    { maxRange: system.maxTargetRange, obstacles, weights: system.threatWeights }
  );

  // Update target memory
  updateTargetMemory(npc.targetMemory, selectedTarget, now);
  npc.currentTarget = selectedTarget;
  npc.currentTargetId = selectedTarget?.id ?? null;

  // Get aim point (with prediction if we have velocity data)
  let aimPoint = getAimPointFromMemory(npc.targetMemory, selectedTarget, now);

  if (!aimPoint) {
    // No target - stay in current facing
    npc.state = COMBAT_STATE.SEARCHING;
    return;
  }

  npc.state = COMBAT_STATE.ENGAGING;
  npc.lastKnownTargetPos = [...aimPoint];

  // Predictive aiming
  const currentWeapon = npc.weapons.weapons.get(npc.weapons.currentWeapon);
  if (selectedTarget && selectedTarget.velocity && currentWeapon) {
    const projectileSpeed = currentWeapon.projectileSpeed || 1000; // Hitscan = very fast

    let prediction;
    if (selectedTarget.acceleration) {
      prediction = predictiveAimWithAcceleration(
        npc.position,
        projectileSpeed,
        selectedTarget.position,
        selectedTarget.velocity,
        selectedTarget.acceleration
      );
    } else {
      prediction = predictiveAim(
        npc.position,
        projectileSpeed,
        selectedTarget.position,
        selectedTarget.velocity
      );
    }

    if (prediction) {
      aimPoint = prediction.aimPoint;
    }
  }

  // Calculate desired aim direction
  const toTarget = vec3Sub(aimPoint, npc.position);
  const toTargetDist = vec3Length(toTarget);
  if (toTargetDist > 0.001) {
    npc.desiredAimDirection = vec3Normalize(toTarget);
  }

  // Apply reaction time delay
  if (npc.reactionTimer > 0) {
    npc.reactionTimer -= deltaTimeMs;
    return; // Still reacting, don't update aim
  }

  // Smooth aim rotation (tracking speed)
  const maxRotation = npc.skill.trackingSpeedRadPerSec * deltaTimeSec;
  npc.aimDirection = rotateToward(npc.aimDirection, npc.desiredAimDirection, maxRotation);

  // Apply accuracy modifiers
  const accuracyMod = calculateAccuracyModifier({
    distance: toTargetDist,
    maxAccurateRange: currentWeapon?.maxRange || 50,
    shooterSpeed: vec3Length(npc.velocity),
    targetSpeed: selectedTarget?.velocity ? vec3Length(selectedTarget.velocity) : 0,
    recoilAccumulated: npc.recoilAccumulated,
    timeSinceLastShot: (now - npc.lastShotTime) / 1000,
  });

  // Recover recoil
  const recoilRecovery = 15 * deltaTimeSec;
  npc.recoilAccumulated = Math.max(0, npc.recoilAccumulated - recoilRecovery);

  // Update blackboard for behavior tree
  if (npc.blackboard) {
    setBlackboardValue(npc.blackboard, "targetId", npc.currentTargetId);
    setBlackboardValue(npc.blackboard, "targetDistance", toTargetDist);
    setBlackboardValue(npc.blackboard, "hasLOS", visibleTargets.length > 0);
    setBlackboardValue(npc.blackboard, "accuracyMod", accuracyMod);
  }

  // Debug log
  if (system.debugMode) {
    system.debugLogs.push({
      npcId: npc.id,
      targetId: npc.currentTargetId,
      aimPoint,
      accuracy: accuracyMod,
      time: now,
    });
  }
}

/**
 * Rotate a direction toward another with max angle
 * @param {number[]} current - Current direction
 * @param {number[]} desired - Desired direction
 * @param {number} maxAngleRad - Maximum rotation in radians
 * @returns {number[]} New direction
 */
function rotateToward(current, desired, maxAngleRad) {
  const dot = vec3Dot(current, desired);
  const clampedDot = Math.min(1, Math.max(-1, dot));
  const angle = Math.acos(clampedDot);

  if (angle < 0.001) return [...desired];

  const t = Math.min(1, maxAngleRad / angle);

  return vec3Normalize([
    current[0] * (1 - t) + desired[0] * t,
    current[1] * (1 - t) + desired[1] * t,
    current[2] * (1 - t) + desired[2] * t,
  ]);
}

// ============================================================================
// COMBAT ACTIONS
// ============================================================================

/**
 * Command NPC to fire current weapon
 * @param {Object} system - AI aiming system
 * @param {Object} npc - NPC combat controller
 * @param {Array<Object>} targets - Target colliders
 * @param {Array<Object>} obstacles - Obstacle colliders
 * @returns {Object|null} Fire result or null
 */
export function npcFireWeapon(system, npc, targets, obstacles) {
  const now = performance.now();
  const weaponName = npc.weapons.currentWeapon;

  if (!canFireWeapon(npc.weapons, weaponName, now)) {
    return null;
  }

  const weapon = npc.weapons.weapons.get(weaponName);
  if (!weapon) return null;

  // Apply spread based on skill
  const spreadRad = degToRad(npc.skill.spreadAngleDeg);
  const finalAim = applyAccuracySpread3D(npc.aimDirection, spreadRad);

  let result;

  switch (weapon.type) {
    case WEAPON_TYPE.HITSCAN:
      if (weapon.pelletCount > 1) {
        result = fireShotgun(npc.position, finalAim, weapon, targets, obstacles);
      } else {
        result = fireHitscan(npc.position, finalAim, weapon, targets, obstacles);
      }
      break;

    case WEAPON_TYPE.PROJECTILE:
      result = {
        type: "projectile",
        projectile: createProjectile(npc.position, vec3Scale(finalAim, weapon.projectileSpeed), {
          baseDamage: weapon.baseDamage,
          gravity: weapon.gravity,
          aoeRadius: weapon.aoeRadius,
          ownerId: npc.id,
        }),
      };
      break;

    case WEAPON_TYPE.AOE_CIRCLE:
      result = resolveCircularAoE(
        npc.lastKnownTargetPos || npc.position,
        weapon.aoeRadius || 5,
        weapon.baseDamage,
        targets
      );
      break;

    case WEAPON_TYPE.AOE_CONE:
      result = resolveConeAoE(
        npc.position,
        finalAim,
        weapon.coneAngleDeg || 45,
        weapon.range || 10,
        weapon.dps || 50,
        targets
      );
      break;

    default:
      return null;
  }

  // Record fire
  recordWeaponFire(npc.weapons, weaponName, now);
  npc.lastShotTime = now;
  npc.recoilAccumulated += weapon.recoilPerShot || 2;

  // Reaction time after shooting
  npc.reactionTimer = npc.skill.reactionTimeMs * 0.2; // Brief pause after shot

  return result;
}

/**
 * Command NPC to perform melee attack
 * @param {Object} npc - NPC combat controller
 * @param {Array<Object>} targets - Nearby targets
 * @returns {Array<Object>} Hit results
 */
export function npcMeleeAttack(npc, targets) {
  if (!npc.meleeState) return [];

  const now = performance.now();

  // Start attack if idle
  if (npc.meleeState.phase === 0) {
    startMeleeAttack(npc.meleeState, now);
  }

  // Update attack state
  updateMeleeAttack(npc.meleeState, now);

  // Check for hits during active phase
  return checkMeleeHits(npc.meleeState, npc.position, npc.facing, targets);
}

/**
 * Apply damage to NPC
 * @param {Object} npc - NPC combat controller
 * @param {number} damage - Damage amount
 * @param {number} attackerId - Attacker ID
 */
export function applyDamageToNPC(npc, damage, attackerId) {
  npc.health = Math.max(0, npc.health - damage);

  // Track damage source for threat calculation
  npc.recentDamageFrom[attackerId] = (npc.recentDamageFrom[attackerId] || 0) + damage;

  // Set reaction timer (flinch)
  npc.reactionTimer = Math.max(npc.reactionTimer, 100);

  if (npc.health <= 0) {
    npc.isDead = true;
    npc.state = COMBAT_STATE.DEAD;
  }
}

/**
 * Decay recent damage memory over time
 * @param {Object} npc - NPC combat controller
 * @param {number} deltaTimeMs - Delta time in ms
 * @param {number} decayRate - Decay per second (default 10)
 */
export function decayDamageMemory(npc, deltaTimeMs, decayRate = 10) {
  const decay = decayRate * (deltaTimeMs / 1000);
  for (const id in npc.recentDamageFrom) {
    npc.recentDamageFrom[id] -= decay;
    if (npc.recentDamageFrom[id] <= 0) {
      delete npc.recentDamageFrom[id];
    }
  }
}

// ============================================================================
// BATCH OPERATIONS
// ============================================================================

/**
 * Get all rays for GPU batch processing
 * @param {Object} system - AI aiming system
 * @returns {Array<{origin: number[], direction: number[], npcId: number}>} Ray data
 */
export function getBatchRays(system) {
  const rays = [];

  for (const [id, npc] of system.npcs) {
    if (npc.isDead || npc.state !== COMBAT_STATE.ENGAGING) continue;

    rays.push({
      origin: [...npc.position],
      direction: [...npc.aimDirection],
      npcId: id,
    });
  }

  return rays;
}

/**
 * Apply batch ray results from GPU
 * @param {Object} system - AI aiming system
 * @param {Array<{npcId: number, hitDistance: number, hitTargetId: number}>} results - GPU results
 */
export function applyBatchRayResults(system, results) {
  for (const result of results) {
    const npc = system.npcs.get(result.npcId);
    if (!npc) continue;

    // Store for weapon firing decision
    if (npc.blackboard) {
      setBlackboardValue(npc.blackboard, "rayHitDistance", result.hitDistance);
      setBlackboardValue(npc.blackboard, "rayHitTarget", result.hitTargetId);
    }
  }
}

// ============================================================================
// EXPORTS INDEX
// ============================================================================

export {
  // Re-export from sub-modules for convenience
  SKILL_LEVELS,
  createRay,
  rayAABBIntersect,
  raySphereIntersect,
  predictiveAim,
  predictiveAimWithAcceleration,
  applyAccuracySpread3D,
  gaussianRandom,
  calculateThreatScore,
} from "./AIAiming.js";

export {
  ATTACK_PHASE,
  createMeleeArc,
  isInMeleeArc,
  createMeleeAttackState,
} from "./AIMelee.js";

export {
  WEAPON_TYPE,
  WEAPON_PRESETS,
  fireHitscan,
  fireShotgun,
  createProjectile,
  updateProjectile,
  isInCircularAoE,
  isInConeAoE,
  createGrenade,
  updateGrenade,
} from "./AIWeapons.js";

export {
  createSpatialHash,
  spatialHashInsert,
  spatialHashRemove,
  spatialHashUpdate,
  spatialHashQueryRadius,
  createObjectPool,
  poolAcquire,
  poolRelease,
} from "./SpatialHash.js";
