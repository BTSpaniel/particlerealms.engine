// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * AISound.js
 * 
 * ⚠️ MULTIPLAYER: Uses deterministic RNG from AIRandom.js
 */

import { aiRng } from './AIRandom.js';

/**
 * AISound.js (original) - Sound Propagation and Audio AI
 * 
 * Features:
 * - Sound propagation through environments
 * - Occlusion and obstruction
 * - Sound detection for AI
 * - Acoustic simulation
 * - Sound memory and investigation
 */

import {
  vec3Sub,
  vec3Add,
  vec3Scale,
  vec3Length,
  vec3Normalize,
  vec3Dot,
} from "../../core/math/EngineMath.js";

// ============================================================================
// CONSTANTS
// ============================================================================

/** Sound categories */
export const SOUND_CATEGORY = {
  FOOTSTEP: "footstep",
  VOICE: "voice",
  WEAPON: "weapon",
  EXPLOSION: "explosion",
  AMBIENT: "ambient",
  MECHANICAL: "mechanical",
  IMPACT: "impact",
  ALERT: "alert",
};

/** Surface types for acoustic properties */
export const SURFACE_TYPE = {
  CONCRETE: "concrete",
  METAL: "metal",
  WOOD: "wood",
  CARPET: "carpet",
  GRASS: "grass",
  WATER: "water",
  GLASS: "glass",
  FABRIC: "fabric",
};

/** Sound priority for AI attention */
export const SOUND_PRIORITY = {
  IGNORE: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

// ============================================================================
// ACOUSTIC PROPERTIES
// ============================================================================

/** Surface acoustic properties */
const SURFACE_ACOUSTICS = {
  [SURFACE_TYPE.CONCRETE]: { absorption: 0.02, reflection: 0.95, transmission: 0.05 },
  [SURFACE_TYPE.METAL]: { absorption: 0.01, reflection: 0.98, transmission: 0.02 },
  [SURFACE_TYPE.WOOD]: { absorption: 0.10, reflection: 0.85, transmission: 0.15 },
  [SURFACE_TYPE.CARPET]: { absorption: 0.40, reflection: 0.55, transmission: 0.05 },
  [SURFACE_TYPE.GRASS]: { absorption: 0.60, reflection: 0.30, transmission: 0.10 },
  [SURFACE_TYPE.WATER]: { absorption: 0.02, reflection: 0.90, transmission: 0.08 },
  [SURFACE_TYPE.GLASS]: { absorption: 0.05, reflection: 0.70, transmission: 0.25 },
  [SURFACE_TYPE.FABRIC]: { absorption: 0.50, reflection: 0.45, transmission: 0.05 },
};

/** Sound category base properties */
const SOUND_PROPERTIES = {
  [SOUND_CATEGORY.FOOTSTEP]: { baseRadius: 10, falloff: 2, priority: SOUND_PRIORITY.LOW },
  [SOUND_CATEGORY.VOICE]: { baseRadius: 20, falloff: 1.5, priority: SOUND_PRIORITY.MEDIUM },
  [SOUND_CATEGORY.WEAPON]: { baseRadius: 100, falloff: 1, priority: SOUND_PRIORITY.HIGH },
  [SOUND_CATEGORY.EXPLOSION]: { baseRadius: 200, falloff: 0.8, priority: SOUND_PRIORITY.CRITICAL },
  [SOUND_CATEGORY.AMBIENT]: { baseRadius: 15, falloff: 2, priority: SOUND_PRIORITY.IGNORE },
  [SOUND_CATEGORY.MECHANICAL]: { baseRadius: 30, falloff: 1.5, priority: SOUND_PRIORITY.MEDIUM },
  [SOUND_CATEGORY.IMPACT]: { baseRadius: 25, falloff: 1.8, priority: SOUND_PRIORITY.MEDIUM },
  [SOUND_CATEGORY.ALERT]: { baseRadius: 50, falloff: 1.2, priority: SOUND_PRIORITY.HIGH },
};

// ============================================================================
// SOUND EVENT
// ============================================================================

/**
 * Create a sound event
 * @param {Object} config - Sound config
 * @returns {Object} Sound event
 */
export function createSoundEvent(config) {
  const props = SOUND_PROPERTIES[config.category] || SOUND_PROPERTIES[SOUND_CATEGORY.AMBIENT];
  
  return {
    id: aiRng.uniqueId('sound'),
    
    // Position
    position: [...config.position],
    
    // Properties
    category: config.category || SOUND_CATEGORY.AMBIENT,
    volume: config.volume ?? 1.0,  // 0-1 multiplier
    baseRadius: (config.radius || props.baseRadius) * config.volume,
    falloff: config.falloff || props.falloff,
    priority: config.priority ?? props.priority,
    
    // Source
    sourceId: config.sourceId || null,
    sourceType: config.sourceType || null,
    
    // Timing
    timestamp: performance.now(),
    duration: config.duration || 500, // ms
    
    // Propagation state
    currentRadius: 0,
    propagationSpeed: config.propagationSpeed || 343, // m/s (speed of sound)
    
    // Surface interaction
    reflections: 0,
    maxReflections: config.maxReflections || 3,
    
    // Investigation data
    investigationPoint: [...config.position],
    accuracy: 1.0, // How accurate the perceived location is
  };
}

// ============================================================================
// SOUND PROPAGATION SYSTEM
// ============================================================================

/**
 * Create sound propagation system
 * @param {Object} config - Config
 * @returns {Object} Sound system
 */
export function createSoundSystem(config = {}) {
  return {
    // Active sounds
    activeSounds: new Map(),
    
    // Acoustic environment
    walls: [],        // Occluders/reflectors
    rooms: new Map(), // Room volumes with properties
    
    // Listeners (AI agents)
    listeners: new Map(), // entityId → {position, hearingRange, hearingThreshold}
    
    // Recent detections for each listener
    detections: new Map(), // entityId → [{sound, time, perceivedPosition}]
    
    // Configuration
    maxSounds: config.maxSounds || 100,
    propagationSteps: config.propagationSteps || 10,
    
    // Global modifiers
    globalVolumeMultiplier: config.globalVolume ?? 1.0,
    weatherAttenuation: config.weatherAttenuation ?? 1.0, // Rain/wind reduces sound
  };
}

/**
 * Register listener (AI agent that can hear)
 * @param {Object} system - Sound system
 * @param {string} entityId - Entity ID
 * @param {Object} config - Hearing config
 */
export function registerListener(system, entityId, config = {}) {
  system.listeners.set(entityId, {
    position: config.position || [0, 0, 0],
    hearingRange: config.hearingRange || 50,
    hearingThreshold: config.hearingThreshold || 0.1,
    hearingMultiplier: config.hearingMultiplier || 1.0,
    alertedSounds: new Set(), // Already processed sounds
  });
  
  system.detections.set(entityId, []);
}

/**
 * Update listener position
 * @param {Object} system - Sound system
 * @param {string} entityId - Entity ID
 * @param {number[]} position - New position
 */
export function updateListenerPosition(system, entityId, position) {
  const listener = system.listeners.get(entityId);
  if (listener) {
    listener.position = [...position];
  }
}

/**
 * Add wall/occluder
 * @param {Object} system - Sound system
 * @param {Object} wall - {start, end, height, surface}
 */
export function addSoundOccluder(system, wall) {
  const acoustics = SURFACE_ACOUSTICS[wall.surface] || SURFACE_ACOUSTICS[SURFACE_TYPE.CONCRETE];
  system.walls.push({
    start: [...wall.start],
    end: [...wall.end],
    height: wall.height || 3,
    surface: wall.surface || SURFACE_TYPE.CONCRETE,
    ...acoustics,
  });
}

/**
 * Emit sound
 * @param {Object} system - Sound system
 * @param {Object} soundConfig - Sound configuration
 * @returns {Object} Created sound event
 */
export function emitSound(system, soundConfig) {
  if (system.activeSounds.size >= system.maxSounds) {
    // Remove oldest sound
    const oldest = Array.from(system.activeSounds.values())
      .sort((a, b) => a.timestamp - b.timestamp)[0];
    if (oldest) system.activeSounds.delete(oldest.id);
  }
  
  const sound = createSoundEvent(soundConfig);
  system.activeSounds.set(sound.id, sound);
  
  return sound;
}

/**
 * Calculate sound intensity at position
 * @param {Object} sound - Sound event
 * @param {number[]} position - Listener position
 * @param {Array} walls - Wall occluders
 * @returns {{intensity: number, occluded: boolean, reflections: number}}
 */
export function calculateSoundIntensity(sound, position, walls) {
  const toListener = vec3Sub(position, sound.position);
  const distance = vec3Length(toListener);
  
  if (distance > sound.baseRadius) {
    return { intensity: 0, occluded: false, reflections: 0 };
  }
  
  // Base intensity with distance falloff
  let intensity = Math.pow(1 - distance / sound.baseRadius, sound.falloff) * sound.volume;
  
  // Check occlusion
  let occluded = false;
  let totalAttenuation = 1;
  let reflections = 0;
  
  for (const wall of walls) {
    if (lineIntersectsWall(sound.position, position, wall)) {
      occluded = true;
      totalAttenuation *= wall.transmission;
      reflections++;
    }
  }
  
  intensity *= totalAttenuation;
  
  return { intensity, occluded, reflections };
}

/**
 * Check if line intersects wall segment
 */
function lineIntersectsWall(p1, p2, wall) {
  // 2D line intersection (XZ plane)
  const x1 = p1[0], z1 = p1[2];
  const x2 = p2[0], z2 = p2[2];
  const x3 = wall.start[0], z3 = wall.start[2];
  const x4 = wall.end[0], z4 = wall.end[2];
  
  const denom = (x1 - x2) * (z3 - z4) - (z1 - z2) * (x3 - x4);
  if (Math.abs(denom) < 0.0001) return false;
  
  const t = ((x1 - x3) * (z3 - z4) - (z1 - z3) * (x3 - x4)) / denom;
  const u = -((x1 - x2) * (z1 - z3) - (z1 - z2) * (x1 - x3)) / denom;
  
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

/**
 * Update sound propagation and detection
 * @param {Object} system - Sound system
 * @param {number} deltaTime - Seconds
 * @returns {Array} New detections [{listenerId, sound, intensity}]
 */
export function updateSoundSystem(system, deltaTime) {
  const newDetections = [];
  const now = performance.now();
  
  // Update and expire sounds
  const expiredSounds = [];
  for (const [id, sound] of system.activeSounds) {
    // Propagate sound
    sound.currentRadius += sound.propagationSpeed * deltaTime;
    
    // Check expiration
    if (now - sound.timestamp > sound.duration + (sound.baseRadius / sound.propagationSpeed) * 1000) {
      expiredSounds.push(id);
      continue;
    }
    
    // Check each listener
    for (const [entityId, listener] of system.listeners) {
      // Skip if already alerted to this sound
      if (listener.alertedSounds.has(id)) continue;
      
      // Calculate intensity at listener
      const result = calculateSoundIntensity(sound, listener.position, system.walls);
      
      // Apply global and listener modifiers
      const finalIntensity = result.intensity * 
        system.globalVolumeMultiplier * 
        system.weatherAttenuation *
        listener.hearingMultiplier;
      
      // Check if heard
      if (finalIntensity >= listener.hearingThreshold && 
          vec3Length(vec3Sub(listener.position, sound.position)) <= listener.hearingRange) {
        
        listener.alertedSounds.add(id);
        
        // Calculate perceived position (less accurate if occluded/distant)
        const accuracy = result.occluded ? 0.5 : (1 - vec3Length(vec3Sub(listener.position, sound.position)) / sound.baseRadius);
        const perceivedPosition = calculatePerceivedPosition(sound.position, listener.position, accuracy);
        
        const detection = {
          soundId: id,
          sound,
          intensity: finalIntensity,
          perceivedPosition,
          accuracy,
          occluded: result.occluded,
          timestamp: now,
        };
        
        // Store detection
        const detectionList = system.detections.get(entityId);
        if (detectionList) {
          detectionList.push(detection);
          // Keep last 20 detections
          if (detectionList.length > 20) detectionList.shift();
        }
        
        newDetections.push({
          listenerId: entityId,
          ...detection,
        });
      }
    }
  }
  
  // Remove expired sounds
  for (const id of expiredSounds) {
    system.activeSounds.delete(id);
    // Clear from listener alerts
    for (const [, listener] of system.listeners) {
      listener.alertedSounds.delete(id);
    }
  }
  
  return newDetections;
}

/**
 * Calculate perceived position (with inaccuracy)
 */
function calculatePerceivedPosition(actualPos, listenerPos, accuracy) {
  if (accuracy >= 0.95) return [...actualPos];
  
  // Add error based on accuracy
  const error = (1 - accuracy) * 10; // Max 10 unit error
  return [
    actualPos[0] + aiRng.range(-0.5, 0.5) * error,
    actualPos[1],
    actualPos[2] + aiRng.range(-0.5, 0.5) * error,
  ];
}

/**
 * Get recent detections for entity
 * @param {Object} system - Sound system
 * @param {string} entityId - Entity ID
 * @param {number} maxAge - Max age in ms
 * @returns {Array} Recent detections
 */
export function getRecentDetections(system, entityId, maxAge = 5000) {
  const detections = system.detections.get(entityId);
  if (!detections) return [];
  
  const now = performance.now();
  return detections.filter(d => now - d.timestamp < maxAge);
}

/**
 * Get highest priority unhandled detection
 * @param {Object} system - Sound system
 * @param {string} entityId - Entity ID
 * @returns {Object|null} Detection or null
 */
export function getHighestPriorityDetection(system, entityId) {
  const recent = getRecentDetections(system, entityId);
  if (recent.length === 0) return null;
  
  return recent.reduce((best, current) => 
    (current.sound.priority > (best?.sound.priority || 0)) ? current : best
  , null);
}

// ============================================================================
// SOUND PRESETS
// ============================================================================

/**
 * Emit footstep sound
 * @param {Object} system - Sound system
 * @param {number[]} position - Position
 * @param {string} surface - Surface type
 * @param {boolean} running - Is running
 */
export function emitFootstep(system, position, surface = SURFACE_TYPE.CONCRETE, running = false) {
  const volumeMultiplier = running ? 1.5 : 1.0;
  const surfaceMultiplier = surface === SURFACE_TYPE.CARPET ? 0.3 : 
                            surface === SURFACE_TYPE.METAL ? 1.5 : 1.0;
  
  return emitSound(system, {
    position,
    category: SOUND_CATEGORY.FOOTSTEP,
    volume: 0.3 * volumeMultiplier * surfaceMultiplier,
    duration: 200,
  });
}

/**
 * Emit gunshot sound
 * @param {Object} system - Sound system
 * @param {number[]} position - Position
 * @param {string} weaponType - Weapon type (pistol, rifle, shotgun)
 */
export function emitGunshot(system, position, weaponType = "pistol") {
  const volumes = { pistol: 0.7, rifle: 1.0, shotgun: 0.9, silenced: 0.2 };
  
  return emitSound(system, {
    position,
    category: SOUND_CATEGORY.WEAPON,
    volume: volumes[weaponType] || 0.8,
    radius: weaponType === "silenced" ? 20 : 100,
    duration: 500,
  });
}

/**
 * Emit explosion sound
 * @param {Object} system - Sound system
 * @param {number[]} position - Position
 * @param {number} size - Explosion size 0-1
 */
export function emitExplosion(system, position, size = 1.0) {
  return emitSound(system, {
    position,
    category: SOUND_CATEGORY.EXPLOSION,
    volume: size,
    radius: 100 + size * 150,
    duration: 2000,
  });
}
