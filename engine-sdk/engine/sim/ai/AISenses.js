// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>

//

// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha



/**

 * AISenses.js

 * 

 * ⚠️ MULTIPLAYER: Uses deterministic RNG from AIRandom.js

 */



import { aiRng } from './AIRandom.js';
import { statsMean } from '../../core/math/MathStatistics.js';


/**

 * AISenses.js (original) - Advanced Sensory System (Scent, Touch, Taste, Sixth Sense)

 * 

 * Beyond vision and hearing:

 * - Scent trails and tracking

 * - Touch/vibration detection

 * - Taste (poison detection, etc.)

 * - Psychic/sixth sense

 * - Environmental sensing (temperature, humidity)

 */



import {

  vec3Sub,

  vec3Add,

  vec3Scale,

  vec3Length,

  vec3Normalize,

} from "../../core/math/EngineMath.js";



// ============================================================================

// SCENT SYSTEM

// ============================================================================



/** Scent types */

export const SCENT_TYPE = {

  BLOOD: "blood",

  SWEAT: "sweat",

  FOOD: "food",

  SMOKE: "smoke",

  FEAR: "fear",        // Pheromone-like

  TERRITORY: "territory",

  DECAY: "decay",

  PERFUME: "perfume",

  CHEMICAL: "chemical",

};



/**

 * Create scent particle

 * @param {Object} config - Scent config

 * @param {number} [config.now] millisecond timestamp for this particle.

 *   Defaults to `performance.now()`. Inject a simulation clock when the scent

 *   field is part of authoritative state: `timestamp` is written into the

 *   particle and therefore into any snapshot of it, so with the default two

 *   peers replaying the same events produce particles that differ, and a save

 *   written on one machine does not compare equal to the same save on another.

 * @returns {Object} Scent particle

 */

export function createScentParticle(config) {

  return {

    id: aiRng.uniqueId('scent'),

    type: config.type || SCENT_TYPE.SWEAT,

    position: [...config.position],

    intensity: config.intensity || 1.0,

    sourceId: config.sourceId || null,

    

    // Dispersal

    spreadRate: config.spreadRate || 0.5,  // Units per second

    decayRate: config.decayRate || 0.1,    // Intensity loss per second

    

    // Wind affected

    windAffected: config.windAffected ?? true,

    

    timestamp: config.now !== undefined ? config.now : performance.now(),

  };

}



/**

 * Create scent trail (series of particles)

 * @param {string} sourceId - Source entity ID

 * @param {string} type - Scent type

 * @returns {Object} Scent trail

 */

export function createScentTrail(sourceId, type) {

  return {

    sourceId,

    type,

    particles: [],

    maxParticles: 100,

    lastDropTime: 0,

    dropInterval: 500, // ms between drops

  };

}



/**

 * Add particle to trail

 *

 * The drop is *rate limited by the clock*, so `options.now` does not merely

 * label the particle — it decides whether the particle exists. Under the

 * default wall clock, how fast frames arrive changes how many particles a

 * walking entity leaves behind, which makes the resulting scent field a

 * function of frame rate. For ambient tracking that is harmless; for anything

 * the simulation reads back (an authoritative host, a replay, a save) inject a

 * simulation clock so the trail is a function of the entity's movement instead.

 *

 * @param {Object} trail - Scent trail

 * @param {number[]} position - Position

 * @param {number} intensity - Intensity

 * @param {Object} [options]

 * @param {number} [options.now] millisecond clock; defaults to `performance.now()`

 */

export function addTrailParticle(trail, position, intensity = 1.0, options = {}) {

  const now = options.now !== undefined ? options.now : performance.now();

  

  if (now - trail.lastDropTime < trail.dropInterval) return;

  

  const particle = createScentParticle({

    type: trail.type,

    position,

    intensity,

    sourceId: trail.sourceId,

    now,

  });

  

  trail.particles.push(particle);

  trail.lastDropTime = now;

  

  // Limit particles

  if (trail.particles.length > trail.maxParticles) {

    trail.particles.shift();

  }

}



/**

 * Create scent system

 * @returns {Object} Scent system

 */

export function createScentSystem() {

  return {

    trails: new Map(),     // sourceId → trail

    particles: [],         // All loose particles

    

    // Wind

    windDirection: [1, 0, 0],

    windSpeed: 2,

    

    // Grid for fast queries

    gridSize: 5,

    grid: new Map(),

  };

}



/**

 * Update scent system

 * @param {Object} system - Scent system

 * @param {number} deltaTime - Seconds

 */

export function updateScentSystem(system, deltaTime) {

  // Dispersal and decay are integrated from `deltaTime` alone; nothing here

  // reads a wall clock. A `performance.now()` call used to sit on this line

  // and its result was never referenced, which made the function look

  // frame-rate dependent to anyone auditing it for determinism when it never

  // was. Removed rather than threaded through, because there is nothing to

  // thread.

  const windOffset = vec3Scale(system.windDirection, system.windSpeed * deltaTime);

  

  // Update trails

  for (const [, trail] of system.trails) {

    for (let i = trail.particles.length - 1; i >= 0; i--) {

      const p = trail.particles[i];

      

      // Spread

      p.intensity -= p.decayRate * deltaTime;

      

      // Wind drift

      if (p.windAffected) {

        p.position = vec3Add(p.position, vec3Scale(windOffset, 0.5));

      }

      

      // Remove if faded

      if (p.intensity <= 0) {

        trail.particles.splice(i, 1);

      }

    }

  }

  

  // Update loose particles

  for (let i = system.particles.length - 1; i >= 0; i--) {

    const p = system.particles[i];

    p.intensity -= p.decayRate * deltaTime;

    

    if (p.windAffected) {

      p.position = vec3Add(p.position, windOffset);

    }

    

    if (p.intensity <= 0) {

      system.particles.splice(i, 1);

    }

  }

  

  // Rebuild grid

  rebuildScentGrid(system);

}



function rebuildScentGrid(system) {

  system.grid.clear();

  

  const addToGrid = (p) => {

    const key = `${Math.floor(p.position[0] / system.gridSize)},${Math.floor(p.position[2] / system.gridSize)}`;

    if (!system.grid.has(key)) system.grid.set(key, []);

    system.grid.get(key).push(p);

  };

  

  for (const [, trail] of system.trails) {

    for (const p of trail.particles) {

      addToGrid(p);

    }

  }

  

  for (const p of system.particles) {

    addToGrid(p);

  }

}



/**

 * Smell at position

 * @param {Object} system - Scent system

 * @param {number[]} position - Sniffer position

 * @param {number} range - Smell range

 * @param {number} sensitivity - Smell sensitivity 0-1

 * @returns {Array<{type, intensity, direction, sourceId}>}

 */

export function smellAt(system, position, range, sensitivity = 1.0) {

  const detected = [];

  const cellRadius = Math.ceil(range / system.gridSize);

  const cx = Math.floor(position[0] / system.gridSize);

  const cz = Math.floor(position[2] / system.gridSize);

  

  const nearbyParticles = [];

  

  for (let dx = -cellRadius; dx <= cellRadius; dx++) {

    for (let dz = -cellRadius; dz <= cellRadius; dz++) {

      const key = `${cx + dx},${cz + dz}`;

      const cell = system.grid.get(key);

      if (cell) nearbyParticles.push(...cell);

    }

  }

  

  // Group by type and source

  const grouped = new Map();

  

  for (const p of nearbyParticles) {

    const dist = vec3Length(vec3Sub(p.position, position));

    if (dist > range) continue;

    

    const effectiveIntensity = p.intensity * (1 - dist / range) * sensitivity;

    if (effectiveIntensity < 0.1) continue;

    

    const key = `${p.type}_${p.sourceId || "none"}`;

    if (!grouped.has(key)) {

      grouped.set(key, {

        type: p.type,

        sourceId: p.sourceId,

        totalIntensity: 0,

        weightedPos: [0, 0, 0],

      });

    }

    

    const g = grouped.get(key);

    g.totalIntensity += effectiveIntensity;

    g.weightedPos = vec3Add(g.weightedPos, vec3Scale(p.position, effectiveIntensity));

  }

  

  // Calculate directions

  for (const [, g] of grouped) {

    const centroid = vec3Scale(g.weightedPos, 1 / g.totalIntensity);

    const direction = vec3Normalize(vec3Sub(centroid, position));

    

    detected.push({

      type: g.type,

      intensity: g.totalIntensity,

      direction,

      sourceId: g.sourceId,

      estimatedPosition: centroid,

    });

  }

  

  return detected.sort((a, b) => b.intensity - a.intensity);

}



/**

 * Follow scent trail

 * @param {Object} system - Scent system

 * @param {number[]} position - Current position

 * @param {string} targetSourceId - Source ID to track

 * @param {number} range - Search range

 * @returns {{found: boolean, direction: number[], intensity: number}}

 */

export function followScentTrail(system, position, targetSourceId, range) {

  const trail = system.trails.get(targetSourceId);

  if (!trail || trail.particles.length === 0) {

    return { found: false, direction: null, intensity: 0 };

  }

  

  // Find strongest nearby particle from this trail

  let strongest = null;

  let strongestIntensity = 0;

  

  for (const p of trail.particles) {

    const dist = vec3Length(vec3Sub(p.position, position));

    if (dist > range) continue;

    

    const effective = p.intensity * (1 - dist / range);

    if (effective > strongestIntensity) {

      strongestIntensity = effective;

      strongest = p;

    }

  }

  

  if (!strongest) {

    return { found: false, direction: null, intensity: 0 };

  }

  

  // Direction to strongest

  const direction = vec3Normalize(vec3Sub(strongest.position, position));

  

  return {

    found: true,

    direction,

    intensity: strongestIntensity,

    estimatedPosition: strongest.position,

  };

}



// ============================================================================

// VIBRATION/TREMOR SENSE

// ============================================================================



/**

 * Create vibration event

 * @param {Object} config - Config

 * @returns {Object} Vibration

 */

export function createVibration(config) {

  return {

    id: aiRng.uniqueId('vibe'),

    position: [...config.position],

    intensity: config.intensity || 1.0,

    frequency: config.frequency || 10, // Hz

    sourceId: config.sourceId || null,

    sourceType: config.sourceType || "unknown",

    timestamp: performance.now(),

    propagationSpeed: config.propagationSpeed || 100, // m/s

    duration: config.duration || 200, // ms

  };

}



/**

 * Create tremor sense system

 * @returns {Object} Tremor sense

 */

export function createTremorSense() {

  return {

    vibrations: [],

    surfaceType: "ground", // ground, water, air

    maxVibrations: 50,

  };

}



/**

 * Emit vibration

 * @param {Object} system - Tremor system

 * @param {Object} vibration - Vibration to emit

 */

export function emitVibration(system, vibration) {

  system.vibrations.push(vibration);

  if (system.vibrations.length > system.maxVibrations) {

    system.vibrations.shift();

  }

}



/**

 * Sense vibrations at position

 * @param {Object} system - Tremor system

 * @param {number[]} position - Listener position

 * @param {number} sensitivity - Sensitivity 0-1

 * @returns {Array<{intensity, direction, sourceType, sourceId}>}

 */

export function senseVibrations(system, position, sensitivity = 1.0) {

  const now = performance.now();

  const detected = [];

  

  for (const v of system.vibrations) {

    const age = (now - v.timestamp) / 1000;

    if (age * 1000 > v.duration) continue;

    

    const dist = vec3Length(vec3Sub(v.position, position));

    const travelTime = dist / v.propagationSpeed;

    

    // Has wave reached us?

    if (age < travelTime) continue;

    

    // Intensity decreases with distance squared

    const effectiveIntensity = v.intensity * sensitivity / (1 + dist * dist * 0.01);

    if (effectiveIntensity < 0.05) continue;

    

    const direction = vec3Normalize(vec3Sub(v.position, position));

    

    detected.push({

      intensity: effectiveIntensity,

      direction,

      distance: dist,

      sourceType: v.sourceType,

      sourceId: v.sourceId,

      frequency: v.frequency,

    });

  }

  

  return detected;

}



// ============================================================================

// SIXTH SENSE / DANGER SENSE

// ============================================================================



/**

 * Create danger sense system

 * @returns {Object} Danger sense

 */

export function createDangerSense() {

  return {

    threats: new Map(), // threatId → {position, danger, type}

    baselineDanger: 0,

  };

}



/**

 * Register threat

 * @param {Object} system - Danger sense

 * @param {string} threatId - Threat ID

 * @param {number[]} position - Threat position

 * @param {number} dangerLevel - Danger 0-1

 * @param {string} type - Threat type

 */

export function registerThreat(system, threatId, position, dangerLevel, type = "unknown") {

  system.threats.set(threatId, {

    position: [...position],

    danger: dangerLevel,

    type,

    timestamp: performance.now(),

  });

}



/**

 * Remove threat

 * @param {Object} system - Danger sense

 * @param {string} threatId - Threat ID

 */

export function removeThreat(system, threatId) {

  system.threats.delete(threatId);

}



/**

 * Sense danger level at position

 * @param {Object} system - Danger sense

 * @param {number[]} position - Position to check

 * @param {number} range - Sense range

 * @param {number} sensitivity - Sensitivity 0-1

 * @returns {{totalDanger: number, threats: Array, safestDirection: number[]}}

 */

export function senseDanger(system, position, range, sensitivity = 1.0) {

  let totalDanger = system.baselineDanger;

  const activeThreats = [];

  const dangerGradient = [0, 0, 0];

  

  for (const [id, threat] of system.threats) {

    const dist = vec3Length(vec3Sub(threat.position, position));

    if (dist > range) continue;

    

    const effectiveDanger = threat.danger * (1 - dist / range) * sensitivity;

    totalDanger += effectiveDanger;

    

    // Add to gradient (direction away from threat)

    const awayDir = vec3Normalize(vec3Sub(position, threat.position));

    dangerGradient[0] += awayDir[0] * effectiveDanger;

    dangerGradient[2] += awayDir[2] * effectiveDanger;

    

    activeThreats.push({

      id,

      type: threat.type,

      danger: effectiveDanger,

      distance: dist,

      direction: vec3Normalize(vec3Sub(threat.position, position)),

    });

  }

  

  const safestDirection = vec3Length(dangerGradient) > 0.01 

    ? vec3Normalize(dangerGradient) 

    : null;

  

  return {

    totalDanger: Math.min(1, totalDanger),

    threats: activeThreats.sort((a, b) => b.danger - a.danger),

    safestDirection,

  };

}



// ============================================================================

// ENVIRONMENTAL SENSING

// ============================================================================



/**

 * Create environmental sensor

 * @returns {Object} Environment sensor

 */

export function createEnvironmentSensor() {

  return {

    // Current readings

    temperature: 20,      // Celsius

    humidity: 0.5,        // 0-1

    airQuality: 1.0,      // 0-1 (1 = good)

    lightLevel: 1.0,      // 0-1

    radiation: 0,         // 0-1

    

    // Discomfort thresholds

    comfortTempMin: 15,

    comfortTempMax: 25,

    

    // History for trend detection

    history: {

      temperature: [],

      humidity: [],

    },

    historyMaxLength: 60,

  };

}



/**

 * Update environment readings

 * @param {Object} sensor - Environment sensor

 * @param {Object} readings - {temperature, humidity, etc.}

 */

export function updateEnvironmentReadings(sensor, readings) {

  if (readings.temperature !== undefined) {

    sensor.history.temperature.push(sensor.temperature);

    if (sensor.history.temperature.length > sensor.historyMaxLength) {

      sensor.history.temperature.shift();

    }

    sensor.temperature = readings.temperature;

  }

  

  if (readings.humidity !== undefined) {

    sensor.history.humidity.push(sensor.humidity);

    if (sensor.history.humidity.length > sensor.historyMaxLength) {

      sensor.history.humidity.shift();

    }

    sensor.humidity = readings.humidity;

  }

  

  if (readings.airQuality !== undefined) sensor.airQuality = readings.airQuality;

  if (readings.lightLevel !== undefined) sensor.lightLevel = readings.lightLevel;

  if (readings.radiation !== undefined) sensor.radiation = readings.radiation;

}



/**

 * Get environmental comfort level

 * @param {Object} sensor - Environment sensor

 * @returns {{comfort: number, warnings: Array}}

 */

export function getEnvironmentalComfort(sensor) {

  let comfort = 1.0;

  const warnings = [];

  

  // Temperature

  if (sensor.temperature < sensor.comfortTempMin) {

    const cold = (sensor.comfortTempMin - sensor.temperature) / 20;

    comfort -= cold * 0.3;

    if (cold > 0.3) warnings.push("cold");

    if (sensor.temperature < 0) warnings.push("freezing");

  } else if (sensor.temperature > sensor.comfortTempMax) {

    const hot = (sensor.temperature - sensor.comfortTempMax) / 20;

    comfort -= hot * 0.3;

    if (hot > 0.3) warnings.push("hot");

    if (sensor.temperature > 40) warnings.push("overheating");

  }

  

  // Air quality

  comfort -= (1 - sensor.airQuality) * 0.3;

  if (sensor.airQuality < 0.5) warnings.push("bad_air");

  if (sensor.airQuality < 0.2) warnings.push("toxic_air");

  

  // Radiation

  comfort -= sensor.radiation * 0.5;

  if (sensor.radiation > 0.3) warnings.push("radiation");

  if (sensor.radiation > 0.7) warnings.push("high_radiation");

  

  // Humidity extremes

  if (sensor.humidity < 0.2 || sensor.humidity > 0.8) {

    comfort -= 0.1;

  }

  

  return {

    comfort: Math.max(0, comfort),

    warnings,

    temperature: sensor.temperature,

    humidity: sensor.humidity,

    airQuality: sensor.airQuality,

    lightLevel: sensor.lightLevel,

    radiation: sensor.radiation,

  };

}



/**

 * Detect environmental trend

 * @param {Object} sensor - Environment sensor

 * @param {string} property - Property to check

 * @returns {{trend: string, rate: number}} rising, falling, stable

 */

export function detectEnvironmentTrend(sensor, property) {

  const history = sensor.history[property];

  if (!history || history.length < 5) {

    return { trend: "stable", rate: 0 };

  }

  

  const recent = history.slice(-5);

  const older = history.slice(-10, -5);

  

  if (older.length === 0) {

    return { trend: "stable", rate: 0 };

  }

  

  const recentAvg = statsMean(recent);
  const olderAvg = statsMean(older);
  const rate = recentAvg - olderAvg;

  

  if (Math.abs(rate) < 0.1) return { trend: "stable", rate };

  return { trend: rate > 0 ? "rising" : "falling", rate };

}

