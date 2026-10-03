// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>

//

// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha



/**

 * AIPerception.js - NPC Sensory Perception System

 * 

 * Features:

 * - Vision cone (FOV, range, LOS)

 * - Hearing (noise events, distance falloff)

 * - Awareness states (unaware → suspicious → alert → combat)

 * - Last known position tracking

 * - Peripheral vision

 * - Memory decay

 * 

 * Uses AISchema.js for consistent type definitions.

 */



import {

  vec3Sub,

  vec3Dot,

  vec3Length,

  vec3Normalize,

} from "../../core/math/EngineMath.js";

import { hasLineOfSight, distance, degToRad } from "./AIAiming.js";

import {

  AWARENESS_STATES,

  SENSE_TYPES,

  PERCEPTION_SCHEMA,

  createDefaultPerception,

  validatePerception,

  getAwarenessStateId,

  getAwarenessStateName,

} from "./AISchema.js";



// ============================================================================

// CONSTANTS (re-export from schema for backwards compatibility)

// ============================================================================



/** Awareness states */

export const AWARENESS_STATE = {

  UNAWARE: AWARENESS_STATES.unaware.id,

  SUSPICIOUS: AWARENESS_STATES.suspicious.id,

  ALERT: AWARENESS_STATES.alert.id,

  COMBAT: AWARENESS_STATES.combat.id,

};



/** Sense types */

export const SENSE_TYPE = {

  SIGHT: SENSE_TYPES.sight.id,

  HEARING: SENSE_TYPES.hearing.id,

  DAMAGE: SENSE_TYPES.damage.id,

  TOUCH: SENSE_TYPES.touch.id,

  TEAM_SHARE: SENSE_TYPES.teamShare.id,

};



/** Default perception parameters - from AISchema */

export const DEFAULT_PERCEPTION_PARAMS = createDefaultPerception();



// ============================================================================

// PERCEPTION STATE

// ============================================================================



/**

 * Create perception state for an NPC

 * @param {Object} params - Perception parameters

 * @returns {Object} Perception state

 */

export function createPerceptionState(params = {}) {

  const p = { ...DEFAULT_PERCEPTION_PARAMS, ...params };

  

  return {

    // Parameters

    visionRange: p.visionRange,

    visionFOVRad: degToRad(p.visionFOVDeg),

    peripheralFOVRad: degToRad(p.peripheralFOVDeg),

    peripheralRangeMult: p.peripheralRangeMult,

    hearingRange: p.hearingRange,

    suspiciousThreshold: p.suspiciousThreshold,

    alertThreshold: p.alertThreshold,

    combatThreshold: p.combatThreshold,

    awarenessDecayRate: p.awarenessDecayRate,

    memoryDuration: p.memoryDuration,

    detectionRate: p.detectionRate,

    investigationTime: p.investigationTime,

    

    // Current state

    awarenessLevel: 0, // 0-1 continuous

    awarenessState: AWARENESS_STATE.UNAWARE,

    

    // Known entities

    knownEntities: new Map(), // id → {position, lastSeen, awarenessOf, sense}

    

    // Investigation

    investigationPoint: null,

    investigationStartTime: 0,

    investigationSense: null,

    

    // Last perceived threat

    lastThreatPosition: null,

    lastThreatTime: 0,

    lastThreatId: null,

    

    // Pre-computed cos values for FOV check

    cosHalfFOV: Math.cos(degToRad(p.visionFOVDeg) / 2),

    cosHalfPeripheral: Math.cos(degToRad(p.peripheralFOVDeg) / 2),

  };

}



// ============================================================================

// VISION

// ============================================================================



/**

 * Check if target is in vision cone

 * @param {Object} perception - Perception state

 * @param {number[]} npcPos - NPC position

 * @param {number[]} npcFacing - NPC facing direction

 * @param {number[]} targetPos - Target position

 * @param {Array} obstacles - Obstacles for LOS check

 * @returns {{visible: boolean, inFOV: boolean, peripheral: boolean, distance: number}}

 */

export function checkVision(perception, npcPos, npcFacing, targetPos, obstacles) {

  const toTarget = vec3Sub(targetPos, npcPos);

  const dist = vec3Length(toTarget);

  

  // Range check

  if (dist > perception.visionRange) {

    return { visible: false, inFOV: false, peripheral: false, distance: dist };

  }

  

  // Angle check

  const toTargetNorm = vec3Normalize(toTarget);

  const facingNorm = vec3Normalize(npcFacing);

  const dot = vec3Dot(facingNorm, toTargetNorm);

  

  const inFOV = dot >= perception.cosHalfFOV;

  const inPeripheral = dot >= perception.cosHalfPeripheral;

  

  // Peripheral vision has reduced range

  const peripheralRange = perception.visionRange * perception.peripheralRangeMult;

  const peripheral = !inFOV && inPeripheral && dist <= peripheralRange;

  

  if (!inFOV && !peripheral) {

    return { visible: false, inFOV: false, peripheral: false, distance: dist };

  }

  

  // Line of sight check

  const hasLOS = hasLineOfSight(npcPos, targetPos, obstacles);

  

  return {

    visible: hasLOS,

    inFOV: inFOV && hasLOS,

    peripheral: peripheral && hasLOS,

    distance: dist,

  };

}



/**

 * Calculate detection rate based on visibility conditions

 * @param {Object} visionResult - Result from checkVision

 * @param {Object} perception - Perception state

 * @param {Object} options - Additional factors

 * @returns {number} Detection rate multiplier

 */

export function calculateDetectionRate(visionResult, perception, options = {}) {

  if (!visionResult.visible) return 0;

  

  let rate = perception.detectionRate;

  

  // Distance falloff

  const distFactor = 1 - (visionResult.distance / perception.visionRange);

  rate *= distFactor;

  

  // Peripheral penalty

  if (visionResult.peripheral) {

    rate *= 0.3;

  }

  

  // Target crouching/prone

  if (options.targetCrouching) rate *= 0.5;

  if (options.targetProne) rate *= 0.25;

  

  // Target moving

  if (options.targetMoving) rate *= 1.5;

  

  // Darkness

  if (options.darkness) rate *= options.darkness;

  

  return rate;

}



// ============================================================================

// HEARING

// ============================================================================



/**

 * Create a noise event

 * @param {number[]} position - Noise position

 * @param {number} loudness - Noise loudness (0-1)

 * @param {string} type - Noise type (footstep, gunshot, explosion, voice)

 * @param {number} sourceId - Source entity ID

 * @param {Object} [options]

 * @param {number} [options.now] millisecond timestamp for the event.

 *   Defaults to `performance.now()`. `checkHearing` does not read `time`, so

 *   the default is harmless for a one-shot audibility test — but the field is

 *   carried into `processNoiseEvent`, into `perception.knownEntities` and into

 *   anything that snapshots them, so an authoritative host, a replay or a save

 *   should inject a simulation clock. Otherwise two peers handed identical

 *   events derive states that differ in a field neither of them chose.

 * @returns {Object} Noise event

 */

export function createNoiseEvent(position, loudness, type, sourceId = null, options = {}) {

  return {

    position: [...position],

    loudness,

    type,

    sourceId,

    time: options.now !== undefined ? options.now : performance.now(),

    radius: getNoiseRadius(loudness, type),

  };

}



/**

 * Get noise radius based on loudness and type

 * @param {number} loudness - 0-1

 * @param {string} type - Noise type

 * @returns {number} Noise radius

 */

function getNoiseRadius(loudness, type) {

  const baseRadius = {

    footstep: 5,

    voice: 15,

    gunshot: 50,

    explosion: 100,

    melee: 10,

    reload: 8,

    door: 12,

  };

  

  return (baseRadius[type] || 10) * loudness;

}



/**

 * Check if NPC can hear a noise event

 * @param {Object} perception - Perception state

 * @param {number[]} npcPos - NPC position

 * @param {Object} noise - Noise event

 * @returns {{heard: boolean, direction: number[], loudness: number}}

 */

export function checkHearing(perception, npcPos, noise) {

  const dist = distance(npcPos, noise.position);

  

  if (dist > noise.radius || dist > perception.hearingRange) {

    return { heard: false, direction: null, loudness: 0 };

  }

  

  // Calculate perceived loudness with distance falloff

  const falloff = 1 - (dist / Math.min(noise.radius, perception.hearingRange));

  const perceivedLoudness = noise.loudness * falloff;

  

  // Direction to sound

  const direction = vec3Normalize(vec3Sub(noise.position, npcPos));

  

  return {

    heard: true,

    direction,

    loudness: perceivedLoudness,

    position: noise.position,

    type: noise.type,

    sourceId: noise.sourceId,

  };

}



// ============================================================================

// AWARENESS MANAGEMENT

// ============================================================================



/**

 * Process visual detection of a target

 * @param {Object} perception - Perception state

 * @param {number[]} npcPos - NPC position

 * @param {number[]} npcFacing - NPC facing

 * @param {Object} target - Target {id, position}

 * @param {Array} obstacles - Obstacles

 * @param {number} deltaTimeSec - Delta time in seconds

 * @param {Object} options - Detection options

 * @param {number} [options.now] millisecond clock for `lastSeen` and

 *   `lastThreatTime`; defaults to `performance.now()`

 * @returns {{detected: boolean, awarenessGain: number}}

 */

export function processVisualDetection(perception, npcPos, npcFacing, target, obstacles, deltaTimeSec, options = {}) {

  const vision = checkVision(perception, npcPos, npcFacing, target.position, obstacles);

  

  if (!vision.visible) {

    return { detected: false, awarenessGain: 0 };

  }

  

  const rate = calculateDetectionRate(vision, perception, options);

  const awarenessGain = rate * deltaTimeSec;

  

  // Update known entity

  const now = options.now !== undefined ? options.now : performance.now();

  updateKnownEntity(perception, target.id, target.position, SENSE_TYPE.SIGHT, awarenessGain, now);

  

  // Update overall awareness

  perception.awarenessLevel = Math.min(1, perception.awarenessLevel + awarenessGain);

  updateAwarenessState(perception);

  

  // Track as threat

  perception.lastThreatPosition = [...target.position];

  perception.lastThreatTime = now;

  perception.lastThreatId = target.id;

  

  return { detected: true, awarenessGain };

}



/**

 * Process a noise event

 * @param {Object} perception - Perception state

 * @param {number[]} npcPos - NPC position

 * @param {Object} noise - Noise event

 * @param {Object} [options]

 * @param {number} [options.now] millisecond clock; defaults to `performance.now()`.

 *   Must match the clock passed to `checkInvestigationComplete`, or the

 *   investigation either times out on its first check or never times out.

 * @param {number[]} [options.investigationPoint] where to investigate, if the

 *   caller can judge it better than "exactly where the noise was". Defaults to

 *   the noise position, which assumes the listener can localise a sound

 *   perfectly — true of a matched pair of ears and false of one, so a caller

 *   modelling the listener's actual anatomy supplies its own estimate here.

 * @returns {{heard: boolean, shouldInvestigate: boolean}}

 */

export function processNoiseEvent(perception, npcPos, noise, options = {}) {

  const hearing = checkHearing(perception, npcPos, noise);

  

  if (!hearing.heard) {

    return { heard: false, shouldInvestigate: false };

  }

  

  const now = options.now !== undefined ? options.now : performance.now();

  

  // Louder sounds increase awareness more

  const awarenessGain = hearing.loudness * 0.3;

  perception.awarenessLevel = Math.min(1, perception.awarenessLevel + awarenessGain);

  updateAwarenessState(perception);

  

  // Update known entity if source is known

  if (noise.sourceId !== null) {

    updateKnownEntity(perception, noise.sourceId, noise.position, SENSE_TYPE.HEARING, awarenessGain, now);

  }

  

  // Should investigate if suspicious or louder sounds

  const shouldInvestigate = hearing.loudness > 0.3 || 

    perception.awarenessState >= AWARENESS_STATE.SUSPICIOUS;

  

  if (shouldInvestigate && !perception.investigationPoint) {

    perception.investigationPoint = [...(options.investigationPoint || noise.position)];

    perception.investigationStartTime = now;

    perception.investigationSense = SENSE_TYPE.HEARING;

  }

  

  return { heard: true, shouldInvestigate };

}



/**

 * Process taking damage

 * @param {Object} perception - Perception state

 * @param {number[]} damageDirection - Direction damage came from (optional)

 * @param {number} attackerId - Attacker ID (optional)

 * @param {Object} [options]

 * @param {number} [options.now] millisecond clock for `lastThreatTime`;

 *   defaults to `performance.now()`

 */

export function processDamage(perception, damageDirection = null, attackerId = null, options = {}) {

  // Instant full awareness when damaged

  perception.awarenessLevel = 1;

  perception.awarenessState = AWARENESS_STATE.COMBAT;

  

  if (attackerId !== null && damageDirection) {

    perception.lastThreatId = attackerId;

    perception.lastThreatTime = options.now !== undefined ? options.now : performance.now();

    // Estimate position based on damage direction

    // This is intentionally inaccurate

  }

}



/**

 * Share threat info from teammate

 * @param {Object} perception - Perception state

 * @param {number} targetId - Threat ID

 * @param {number[]} targetPos - Threat position

 */

export function shareTeamInfo(perception, targetId, targetPos) {

  updateKnownEntity(perception, targetId, targetPos, SENSE_TYPE.TEAM_SHARE, 0.5);

  

  // Raise awareness if unaware

  if (perception.awarenessState < AWARENESS_STATE.ALERT) {

    perception.awarenessLevel = Math.max(perception.awarenessLevel, perception.alertThreshold);

    updateAwarenessState(perception);

  }

}



// ============================================================================

// KNOWN ENTITIES

// ============================================================================



/**

 * Update or add a known entity

 * @param {Object} perception - Perception state

 * @param {number} entityId - Entity ID

 * @param {number[]} position - Last known position

 * @param {string} sense - How it was detected

 * @param {number} awarenessOf - Awareness of this specific entity

 * @param {number} [now] millisecond clock; defaults to `performance.now()`.

 *   Every reader of `lastSeen` takes the same override, because a memory

 *   stamped from a simulation clock and aged against a wall clock expires

 *   immediately or never.

 */

function updateKnownEntity(perception, entityId, position, sense, awarenessOf, now = performance.now()) {

  const existing = perception.knownEntities.get(entityId);

  

  if (existing) {

    existing.position = [...position];

    existing.lastSeen = now;

    existing.awarenessOf = Math.min(1, existing.awarenessOf + awarenessOf);

    existing.sense = sense;

  } else {

    perception.knownEntities.set(entityId, {

      position: [...position],

      lastSeen: now,

      awarenessOf: Math.min(1, awarenessOf),

      sense,

    });

  }

}



/**

 * Get last known position of an entity

 * @param {Object} perception - Perception state

 * @param {number} entityId - Entity ID

 * @param {Object} [options]

 * @param {number} [options.now] millisecond clock; defaults to `performance.now()`.

 *   Must match whatever clock wrote `lastSeen` via `processVisualDetection` /

 *   `processNoiseEvent`, or the age comparison is meaningless.

 * @returns {number[]|null} Last known position or null

 */

export function getLastKnownPosition(perception, entityId, options = {}) {

  const known = perception.knownEntities.get(entityId);

  if (!known) return null;

  

  const now = options.now !== undefined ? options.now : performance.now();

  const age = now - known.lastSeen;

  if (age > perception.memoryDuration) {

    perception.knownEntities.delete(entityId);

    return null;

  }

  

  return [...known.position];

}



/**

 * Get the most threatening known entity

 * @param {Object} perception - Perception state

 * @param {Object} [options]

 * @param {number} [options.now] millisecond clock; defaults to `performance.now()`.

 *   Must match whatever clock wrote `lastSeen`.

 * @returns {Object|null} {id, position, awarenessOf, lastSeen}

 */

export function getMostThreateningEntity(perception, options = {}) {

  let best = null;

  let bestScore = 0;

  const now = options.now !== undefined ? options.now : performance.now();

  

  for (const [id, data] of perception.knownEntities) {

    const age = now - data.lastSeen;

    if (age > perception.memoryDuration) continue;

    

    // Score based on awareness and recency

    const recencyFactor = 1 - (age / perception.memoryDuration);

    const score = data.awarenessOf * recencyFactor;

    

    if (score > bestScore) {

      bestScore = score;

      best = { id, ...data };

    }

  }

  

  return best;

}



// ============================================================================

// STATE UPDATES

// ============================================================================



/**

 * Update awareness state based on level

 * @param {Object} perception - Perception state

 */

function updateAwarenessState(perception) {

  if (perception.awarenessLevel >= perception.combatThreshold) {

    perception.awarenessState = AWARENESS_STATE.COMBAT;

  } else if (perception.awarenessLevel >= perception.alertThreshold) {

    perception.awarenessState = AWARENESS_STATE.ALERT;

  } else if (perception.awarenessLevel >= perception.suspiciousThreshold) {

    perception.awarenessState = AWARENESS_STATE.SUSPICIOUS;

  } else {

    perception.awarenessState = AWARENESS_STATE.UNAWARE;

  }

}



/**

 * Decay awareness over time

 * @param {Object} perception - Perception state

 * @param {number} deltaTimeSec - Delta time in seconds

 * @param {boolean} canSeeThreats - Whether any threats are visible

 * @param {Object} [options]

 * @param {number} [options.now] millisecond clock used to expire stale memories;

 *   defaults to `performance.now()`. The awareness *level* decays from

 *   `deltaTimeSec` alone and is already frame-rate independent — it is only the

 *   `knownEntities` cleanup that reads a clock, so a caller stamping `lastSeen`

 *   from a simulation clock must pass the same one here.

 */

export function decayAwareness(perception, deltaTimeSec, canSeeThreats, options = {}) {

  if (canSeeThreats) return; // Don't decay while seeing threats

  

  const decay = perception.awarenessDecayRate * deltaTimeSec;

  perception.awarenessLevel = Math.max(0, perception.awarenessLevel - decay);

  updateAwarenessState(perception);

  

  // Clean up old memories

  const now = options.now !== undefined ? options.now : performance.now();

  for (const [id, data] of perception.knownEntities) {

    if (now - data.lastSeen > perception.memoryDuration) {

      perception.knownEntities.delete(id);

    }

  }

}



/**

 * Check if investigation is complete

 * @param {Object} perception - Perception state

 * @param {number[]} npcPos - NPC position

 * @param {number} arrivalRadius - Radius to consider "arrived"

 * @param {Object} [options]

 * @param {number} [options.now] millisecond clock; defaults to `performance.now()`.

 *   Must match the clock `processNoiseEvent` used to set

 *   `investigationStartTime`.

 * @returns {boolean} True if investigation complete

 */

export function checkInvestigationComplete(perception, npcPos, arrivalRadius = 2, options = {}) {

  if (!perception.investigationPoint) return true;

  

  const now = options.now !== undefined ? options.now : performance.now();

  const elapsed = now - perception.investigationStartTime;

  

  // Timeout

  if (elapsed > perception.investigationTime) {

    perception.investigationPoint = null;

    return true;

  }

  

  // Arrived at point

  if (distance(npcPos, perception.investigationPoint) < arrivalRadius) {

    perception.investigationPoint = null;

    return true;

  }

  

  return false;

}



/**

 * Full perception update tick

 * @param {Object} perception - Perception state

 * @param {number[]} npcPos - NPC position

 * @param {number[]} npcFacing - NPC facing

 * @param {Array<Object>} targets - Potential targets

 * @param {Array<Object>} noiseEvents - Recent noise events

 * @param {Array} obstacles - Obstacles

 * @param {number} deltaTimeSec - Delta time in seconds

 * @param {Object} [options]

 * @param {number} [options.now] millisecond clock, forwarded to every call

 *   below; defaults to `performance.now()`. Forwarded rather than left to each

 *   callee's own default, because a partially overridden clock is worse than

 *   none: `lastSeen` would be stamped from one source and expired against

 *   another.

 * @returns {{visibleTargets: Array, heardNoises: Array}}

 */

export function updatePerception(perception, npcPos, npcFacing, targets, noiseEvents, obstacles, deltaTimeSec, options = {}) {

  const visibleTargets = [];

  const heardNoises = [];

  

  // Process all potential targets

  for (const target of targets) {

    const result = processVisualDetection(perception, npcPos, npcFacing, target, obstacles, deltaTimeSec, options);

    if (result.detected) {

      visibleTargets.push({ ...target, awarenessGain: result.awarenessGain });

    }

  }

  

  // Process noise events

  for (const noise of noiseEvents) {

    const result = processNoiseEvent(perception, npcPos, noise, options);

    if (result.heard) {

      heardNoises.push(noise);

    }

  }

  

  // Decay awareness if nothing detected

  decayAwareness(perception, deltaTimeSec, visibleTargets.length > 0, options);

  

  return { visibleTargets, heardNoises };

}

