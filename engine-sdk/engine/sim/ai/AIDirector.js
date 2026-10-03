// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * AIDirector.js - Game Director / Drama Manager
 * 
 * Like Left 4 Dead's AI Director:
 * - Pacing and intensity management
 * - Dynamic difficulty adjustment
 * - Spawn management
 * - Player stress tracking
 * - Dramatic tension curves
 * 
 * ⚠️ MULTIPLAYER: Uses deterministic RNG from AIRandom.js
 */

import { aiRng } from './AIRandom.js';

// ============================================================================
// CONSTANTS
// ============================================================================

/** Pacing states */
export const PACING_STATE = {
  BUILD_UP: "build_up",     // Quiet, building tension
  PEAK: "peak",             // Intense action
  RELAX: "relax",           // Recovery period
  SUSTAIN: "sustain",       // Maintain current level
};

/** Intensity levels */
export const INTENSITY_LEVEL = {
  CALM: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  EXTREME: 4,
};

// ============================================================================
// PLAYER STATE TRACKING
// ============================================================================

/**
 * Create player state tracker
 * @returns {Object} Player state
 */
export function createPlayerState() {
  return {
    // Health/resources
    healthPercent: 1.0,
    ammoPercent: 1.0,
    teamHealthAvg: 1.0,
    
    // Performance metrics
    accuracy: 0.5,
    killsRecent: 0,
    deathsRecent: 0,
    damageDealtRecent: 0,
    damageTakenRecent: 0,
    
    // Time tracking
    timeSinceLastDamage: 0,
    timeSinceLastKill: 0,
    timeSinceLastDeath: 0,
    timeInCombat: 0,
    timeOutOfCombat: 0,
    
    // Calculated stress
    stressLevel: 0, // 0-1
    fatigueLevel: 0, // 0-1
    
    // Skill estimation
    estimatedSkill: 0.5, // 0-1
    
    // Position/movement
    distanceTraveled: 0,
    currentSpeed: 0,
    isStationary: false,
  };
}

/**
 * Update player state metrics
 * @param {Object} state - Player state
 * @param {Object} data - Raw gameplay data
 * @param {number} deltaTime - Time elapsed
 */
export function updatePlayerState(state, data, deltaTime) {
  // Update from raw data
  state.healthPercent = data.health / data.maxHealth;
  state.ammoPercent = data.ammo / data.maxAmmo;
  state.teamHealthAvg = data.teamHealth || state.healthPercent;
  
  // Update timers
  state.timeSinceLastDamage += deltaTime;
  state.timeSinceLastKill += deltaTime;
  state.timeSinceLastDeath += deltaTime;
  
  // Update combat time
  if (data.inCombat) {
    state.timeInCombat += deltaTime;
    state.timeOutOfCombat = 0;
  } else {
    state.timeOutOfCombat += deltaTime;
    if (state.timeOutOfCombat > 10) {
      state.timeInCombat = Math.max(0, state.timeInCombat - deltaTime);
    }
  }
  
  // Calculate stress level
  state.stressLevel = calculateStress(state);
  
  // Calculate fatigue
  state.fatigueLevel = calculateFatigue(state);
  
  // Estimate skill
  updateSkillEstimate(state, data);
  
  // Decay recent counters
  const decayRate = 0.1 * deltaTime;
  state.killsRecent *= (1 - decayRate);
  state.deathsRecent *= (1 - decayRate);
  state.damageDealtRecent *= (1 - decayRate);
  state.damageTakenRecent *= (1 - decayRate);
}

/**
 * Calculate player stress level
 */
function calculateStress(state) {
  let stress = 0;
  
  // Low health = high stress
  stress += (1 - state.healthPercent) * 0.4;
  
  // Recent damage = stress
  stress += Math.min(0.3, state.damageTakenRecent * 0.01);
  
  // Low ammo = stress
  stress += (1 - state.ammoPercent) * 0.1;
  
  // Time in combat = stress
  stress += Math.min(0.2, state.timeInCombat * 0.01);
  
  // Recent deaths = stress
  stress += state.deathsRecent * 0.1;
  
  // Cap and return
  return Math.max(0, Math.min(1, stress));
}

/**
 * Calculate fatigue level
 */
function calculateFatigue(state) {
  let fatigue = 0;
  
  // Prolonged combat = fatigue
  fatigue += Math.min(0.5, state.timeInCombat * 0.005);
  
  // Distance traveled = fatigue
  fatigue += Math.min(0.3, state.distanceTraveled * 0.0001);
  
  // Recovery during rest
  if (state.timeOutOfCombat > 30) {
    fatigue -= state.timeOutOfCombat * 0.01;
  }
  
  return Math.max(0, Math.min(1, fatigue));
}

/**
 * Update skill estimate
 */
function updateSkillEstimate(state, data) {
  // Weighted moving average of performance
  const accuracyFactor = state.accuracy;
  const kdRatio = state.killsRecent / Math.max(1, state.deathsRecent);
  const efficiencyFactor = state.damageDealtRecent / Math.max(1, state.damageTakenRecent);
  
  const newEstimate = (accuracyFactor * 0.3 + Math.min(1, kdRatio / 3) * 0.4 + Math.min(1, efficiencyFactor / 2) * 0.3);
  
  // Smooth updates
  state.estimatedSkill = state.estimatedSkill * 0.95 + newEstimate * 0.05;
}

// ============================================================================
// PACING SYSTEM
// ============================================================================

/**
 * Create pacing controller
 * @param {Object} config - Pacing config
 * @returns {Object} Pacing controller
 */
export function createPacingController(config = {}) {
  return {
    currentState: PACING_STATE.BUILD_UP,
    currentIntensity: INTENSITY_LEVEL.CALM,
    targetIntensity: INTENSITY_LEVEL.MEDIUM,
    
    // Timing
    stateTimer: 0,
    stateDuration: 0,
    
    // Configuration
    buildUpDuration: config.buildUpDuration ?? [30, 60],   // Seconds [min, max]
    peakDuration: config.peakDuration ?? [20, 40],
    relaxDuration: config.relaxDuration ?? [20, 45],
    sustainDuration: config.sustainDuration ?? [10, 20],
    
    // Intensity curve
    intensityRampRate: config.intensityRampRate ?? 0.1, // Per second during build-up
    intensityDecayRate: config.intensityDecayRate ?? 0.15, // Per second during relax
    
    // Thresholds
    peakIntensityThreshold: config.peakIntensityThreshold ?? INTENSITY_LEVEL.HIGH,
    relaxIntensityThreshold: config.relaxIntensityThreshold ?? INTENSITY_LEVEL.LOW,
    
    // History
    stateHistory: [],
    intensityHistory: [],
  };
}

/**
 * Update pacing state
 * @param {Object} pacing - Pacing controller
 * @param {Object} playerState - Player state
 * @param {number} deltaTime - Seconds elapsed
 * @returns {{stateChanged: boolean, shouldSpawn: boolean, spawnIntensity: number}}
 */
export function updatePacing(pacing, playerState, deltaTime) {
  pacing.stateTimer += deltaTime;
  
  let stateChanged = false;
  let shouldSpawn = false;
  let spawnIntensity = 0;
  
  // Record history
  pacing.intensityHistory.push(pacing.currentIntensity);
  if (pacing.intensityHistory.length > 100) pacing.intensityHistory.shift();
  
  switch (pacing.currentState) {
    case PACING_STATE.BUILD_UP:
      // Gradually increase intensity
      pacing.currentIntensity += pacing.intensityRampRate * deltaTime;
      shouldSpawn = aiRng.chance(pacing.currentIntensity * 0.1 * deltaTime);
      spawnIntensity = pacing.currentIntensity;
      
      // Transition to peak when intensity is high enough
      if (pacing.currentIntensity >= pacing.peakIntensityThreshold || 
          pacing.stateTimer >= pacing.stateDuration) {
        transitionPacingState(pacing, PACING_STATE.PEAK);
        stateChanged = true;
      }
      break;
      
    case PACING_STATE.PEAK:
      // High intensity, lots of spawns
      shouldSpawn = aiRng.chance(0.3 * deltaTime);
      spawnIntensity = INTENSITY_LEVEL.HIGH;
      
      // Check player stress - end peak if too stressed
      if (playerState.stressLevel > 0.8 || pacing.stateTimer >= pacing.stateDuration) {
        transitionPacingState(pacing, PACING_STATE.RELAX);
        stateChanged = true;
      }
      break;
      
    case PACING_STATE.RELAX:
      // Decrease intensity, minimal spawns
      pacing.currentIntensity = Math.max(0, pacing.currentIntensity - pacing.intensityDecayRate * deltaTime);
      shouldSpawn = false;
      
      // Transition when relaxed enough or time elapsed
      if ((pacing.currentIntensity <= pacing.relaxIntensityThreshold && playerState.stressLevel < 0.3) ||
          pacing.stateTimer >= pacing.stateDuration) {
        transitionPacingState(pacing, PACING_STATE.BUILD_UP);
        stateChanged = true;
      }
      break;
      
    case PACING_STATE.SUSTAIN:
      // Maintain current level
      shouldSpawn = aiRng.chance(pacing.currentIntensity * 0.05 * deltaTime);
      spawnIntensity = pacing.currentIntensity;
      
      if (pacing.stateTimer >= pacing.stateDuration) {
        // Decide next state based on player state
        if (playerState.stressLevel < 0.4) {
          transitionPacingState(pacing, PACING_STATE.BUILD_UP);
        } else {
          transitionPacingState(pacing, PACING_STATE.RELAX);
        }
        stateChanged = true;
      }
      break;
  }
  
  return { stateChanged, shouldSpawn, spawnIntensity };
}

/**
 * Transition to new pacing state
 */
function transitionPacingState(pacing, newState) {
  pacing.stateHistory.push({ state: pacing.currentState, duration: pacing.stateTimer });
  if (pacing.stateHistory.length > 20) pacing.stateHistory.shift();
  
  pacing.currentState = newState;
  pacing.stateTimer = 0;
  
  // Set duration for new state
  let durationRange;
  switch (newState) {
    case PACING_STATE.BUILD_UP: durationRange = pacing.buildUpDuration; break;
    case PACING_STATE.PEAK: durationRange = pacing.peakDuration; break;
    case PACING_STATE.RELAX: durationRange = pacing.relaxDuration; break;
    case PACING_STATE.SUSTAIN: durationRange = pacing.sustainDuration; break;
    default: durationRange = [30, 60];
  }
  
  pacing.stateDuration = aiRng.range(durationRange[0], durationRange[1]);
}

// ============================================================================
// SPAWN DIRECTOR
// ============================================================================

/**
 * Create spawn director
 * @param {Object} config - Spawn config
 * @returns {Object} Spawn director
 */
export function createSpawnDirector(config = {}) {
  return {
    // Spawn pools
    spawnPools: new Map(), // intensity → [{type, weight, cost}]
    
    // Budget system
    currentBudget: 0,
    maxBudget: config.maxBudget ?? 100,
    budgetRegenRate: config.budgetRegenRate ?? 5, // Per second
    
    // Active spawns
    activeSpawns: new Map(), // id → spawn data
    maxActiveSpawns: config.maxActiveSpawns ?? 50,
    
    // Spawn points
    spawnPoints: [],
    
    // Cooldowns
    lastSpawnTime: 0,
    minSpawnInterval: config.minSpawnInterval ?? 1, // Seconds
    
    // Configuration
    spawnDistanceMin: config.spawnDistanceMin ?? 20,
    spawnDistanceMax: config.spawnDistanceMax ?? 50,
    
    // Statistics
    totalSpawned: 0,
    totalKilled: 0,
  };
}

/**
 * Register spawn type
 * @param {Object} director - Spawn director
 * @param {number} intensity - Intensity level
 * @param {Object} spawnType - {type, weight, cost, count}
 */
export function registerSpawnType(director, intensity, spawnType) {
  if (!director.spawnPools.has(intensity)) {
    director.spawnPools.set(intensity, []);
  }
  director.spawnPools.get(intensity).push(spawnType);
}

/**
 * Add spawn point
 * @param {Object} director - Spawn director
 * @param {Object} point - {position, types, active}
 */
export function addSpawnPoint(director, point) {
  director.spawnPoints.push({
    position: point.position,
    types: point.types || ["all"],
    active: point.active ?? true,
    cooldown: 0,
  });
}

/**
 * Update spawn director
 * @param {Object} director - Spawn director
 * @param {Object} pacing - Pacing controller
 * @param {number[]} playerPosition - Player position
 * @param {number} deltaTime - Seconds elapsed
 * @returns {Array} Spawns to create
 */
export function updateSpawnDirector(director, pacing, playerPosition, deltaTime) {
  const spawns = [];
  
  // Regenerate budget
  director.currentBudget = Math.min(
    director.maxBudget,
    director.currentBudget + director.budgetRegenRate * deltaTime
  );
  
  // Update spawn point cooldowns
  for (const point of director.spawnPoints) {
    if (point.cooldown > 0) {
      point.cooldown -= deltaTime;
    }
  }
  
  // Check if should spawn
  const timeSinceSpawn = performance.now() / 1000 - director.lastSpawnTime;
  if (timeSinceSpawn < director.minSpawnInterval) {
    return spawns;
  }
  
  if (director.activeSpawns.size >= director.maxActiveSpawns) {
    return spawns;
  }
  
  // Get spawn pool for current intensity
  const intensity = Math.floor(pacing.currentIntensity);
  const pool = director.spawnPools.get(intensity) || director.spawnPools.get(INTENSITY_LEVEL.LOW) || [];
  
  if (pool.length === 0) return spawns;
  
  // Select spawn type based on weight
  const totalWeight = pool.reduce((sum, s) => sum + s.weight, 0);
  let roll = aiRng.float() * totalWeight;
  let selectedType = pool[0];
  
  for (const spawnType of pool) {
    roll -= spawnType.weight;
    if (roll <= 0) {
      selectedType = spawnType;
      break;
    }
  }
  
  // Check budget
  if (director.currentBudget < selectedType.cost) {
    return spawns;
  }
  
  // Find valid spawn point
  const validPoints = director.spawnPoints.filter(p => {
    if (!p.active || p.cooldown > 0) return false;
    if (p.types[0] !== "all" && !p.types.includes(selectedType.type)) return false;
    
    const dist = distance(p.position, playerPosition);
    return dist >= director.spawnDistanceMin && dist <= director.spawnDistanceMax;
  });
  
  if (validPoints.length === 0) {
    return spawns;
  }
  
  // Select random spawn point
  const point = aiRng.pick(validPoints);
  
  // Create spawn
  const spawnId = aiRng.uniqueId('spawn');
  const count = selectedType.count || 1;
  
  for (let i = 0; i < count; i++) {
    spawns.push({
      id: spawnId + `_${i}`,
      type: selectedType.type,
      position: [...point.position],
      intensity: intensity,
    });
  }
  
  // Deduct budget
  director.currentBudget -= selectedType.cost;
  director.lastSpawnTime = performance.now() / 1000;
  director.totalSpawned += count;
  point.cooldown = 5; // 5 second cooldown per point
  
  // Track active spawns
  for (const spawn of spawns) {
    director.activeSpawns.set(spawn.id, spawn);
  }
  
  return spawns;
}

/**
 * Report spawn killed
 * @param {Object} director - Spawn director
 * @param {string} spawnId - Spawn ID
 */
export function reportSpawnKilled(director, spawnId) {
  if (director.activeSpawns.has(spawnId)) {
    director.activeSpawns.delete(spawnId);
    director.totalKilled++;
  }
}

function distance(a, b) {
  const dx = b[0] - a[0];
  const dz = b[2] - a[2];
  return Math.sqrt(dx * dx + dz * dz);
}

// ============================================================================
// DIFFICULTY SCALING
// ============================================================================

/**
 * Create difficulty scaler
 * @param {Object} config - Config
 * @returns {Object} Difficulty scaler
 */
export function createDifficultyScaler(config = {}) {
  return {
    baseDifficulty: config.baseDifficulty ?? 1.0,
    currentDifficulty: config.baseDifficulty ?? 1.0,
    
    // Scaling factors
    healthMultiplier: 1.0,
    damageMultiplier: 1.0,
    speedMultiplier: 1.0,
    accuracyMultiplier: 1.0,
    spawnRateMultiplier: 1.0,
    
    // Adaptation
    adaptationRate: config.adaptationRate ?? 0.1, // How fast difficulty adjusts
    minDifficulty: config.minDifficulty ?? 0.5,
    maxDifficulty: config.maxDifficulty ?? 2.0,
  };
}

/**
 * Update difficulty based on player performance
 * @param {Object} scaler - Difficulty scaler
 * @param {Object} playerState - Player state
 * @param {number} deltaTime - Seconds elapsed
 */
export function updateDifficulty(scaler, playerState, deltaTime) {
  // Target difficulty based on player skill
  const targetDifficulty = scaler.baseDifficulty * (0.5 + playerState.estimatedSkill);
  
  // Smooth adjustment
  const diff = targetDifficulty - scaler.currentDifficulty;
  scaler.currentDifficulty += diff * scaler.adaptationRate * deltaTime;
  
  // Clamp
  scaler.currentDifficulty = Math.max(scaler.minDifficulty, 
    Math.min(scaler.maxDifficulty, scaler.currentDifficulty));
  
  // Update multipliers
  scaler.healthMultiplier = 0.8 + scaler.currentDifficulty * 0.4;
  scaler.damageMultiplier = 0.8 + scaler.currentDifficulty * 0.4;
  scaler.speedMultiplier = 0.9 + scaler.currentDifficulty * 0.2;
  scaler.accuracyMultiplier = 0.7 + scaler.currentDifficulty * 0.3;
  scaler.spawnRateMultiplier = 0.8 + scaler.currentDifficulty * 0.4;
}

// ============================================================================
// COMPLETE AI DIRECTOR
// ============================================================================

/**
 * Create complete AI Director
 * @param {Object} config - Configuration
 * @returns {Object} AI Director
 */
export function createAIDirector(config = {}) {
  return {
    playerState: createPlayerState(),
    pacing: createPacingController(config.pacing),
    spawnDirector: createSpawnDirector(config.spawns),
    difficulty: createDifficultyScaler(config.difficulty),
    
    // State
    isActive: true,
    
    // Debug
    debugMode: config.debugMode ?? false,
  };
}

/**
 * Update AI Director
 * @param {Object} director - AI Director
 * @param {Object} gameData - Current game state
 * @param {number} deltaTime - Seconds elapsed
 * @returns {{spawns: Array, stateChanged: boolean}}
 */
export function updateAIDirector(director, gameData, deltaTime) {
  if (!director.isActive) {
    return { spawns: [], stateChanged: false };
  }
  
  // Update player state
  updatePlayerState(director.playerState, gameData, deltaTime);
  
  // Update difficulty
  updateDifficulty(director.difficulty, director.playerState, deltaTime);
  
  // Update pacing
  const pacingResult = updatePacing(director.pacing, director.playerState, deltaTime);
  
  // Handle spawns
  let spawns = [];
  if (pacingResult.shouldSpawn) {
    spawns = updateSpawnDirector(
      director.spawnDirector, 
      director.pacing, 
      gameData.playerPosition || [0, 0, 0],
      deltaTime
    );
  }
  
  return {
    spawns,
    stateChanged: pacingResult.stateChanged,
    pacingState: director.pacing.currentState,
    intensity: director.pacing.currentIntensity,
    difficulty: director.difficulty.currentDifficulty,
  };
}
