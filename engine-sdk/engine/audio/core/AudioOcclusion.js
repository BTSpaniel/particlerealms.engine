// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * AudioOcclusion.js - Sound Occlusion via Raycasting
 * 
 * Casts a ray from each active source to the listener. If the ray
 * intersects occluders (walls, objects), applies lowpass filter + volume
 * attenuation to simulate sound being blocked/muffled.
 * 
 * Uses simple AABB intersection for performance. Can be upgraded to
 * use the engine's physics raycasts (PhysX/PBD) for higher fidelity.
 */

// ============================================================================
// CREATION
// ============================================================================

/**
 * Create an occlusion system.
 * @param {Object} config
 * @param {number} config.maxOccluders - Max tracked occluders (default 64)
 * @param {number} config.updateInterval - Seconds between occlusion updates (default 0.1)
 * @param {number} config.filterFreqMin - Lowpass frequency when fully occluded (default 300 Hz)
 * @param {number} config.filterFreqMax - Lowpass frequency when not occluded (default 20000 Hz)
 * @param {number} config.volumeReduction - Volume multiplier when fully occluded (default 0.3)
 * @returns {Object}
 */
export function createAudioOcclusion(config = {}) {
  return {
    occluders: [],                         // Array of { min: [x,y,z], max: [x,y,z], transmission: 0-1 }
    maxOccluders: config.maxOccluders ?? 64,
    updateInterval: config.updateInterval ?? 0.1,
    filterFreqMin: config.filterFreqMin ?? 300,
    filterFreqMax: config.filterFreqMax ?? 20000,
    volumeReduction: config.volumeReduction ?? 0.3,
    _timeSinceUpdate: 0,
  };
}

// ============================================================================
// OCCLUDER MANAGEMENT
// ============================================================================

/**
 * Add an AABB occluder.
 * @param {Object} occlusion
 * @param {number[]} min - [x, y, z] box min corner
 * @param {number[]} max - [x, y, z] box max corner
 * @param {number} transmission - 0 (fully blocks) to 1 (transparent). Default 0.2
 * @returns {number} Occluder index
 */
export function addOccluder(occlusion, min, max, transmission = 0.2) {
  if (!occlusion || occlusion.occluders.length >= occlusion.maxOccluders) return -1;
  const idx = occlusion.occluders.length;
  occlusion.occluders.push({ min: [...min], max: [...max], transmission });
  return idx;
}

/**
 * Remove an occluder by index.
 * @param {Object} occlusion
 * @param {number} index
 */
export function removeOccluder(occlusion, index) {
  if (!occlusion || index < 0 || index >= occlusion.occluders.length) return;
  occlusion.occluders.splice(index, 1);
}

/**
 * Clear all occluders.
 * @param {Object} occlusion
 */
export function clearOccluders(occlusion) {
  if (!occlusion) return;
  occlusion.occluders.length = 0;
}

// ============================================================================
// UPDATE
// ============================================================================

/**
 * Tick occlusion: check sources against occluders and apply filters.
 * @param {Object} occlusion
 * @param {Map} activeSources - Map of id → AudioSource
 * @param {number[]} listenerPos - [x, y, z]
 * @param {AudioContext} context - For creating filter nodes
 * @param {number} dt - Delta time
 */
export function tickOcclusion(occlusion, activeSources, listenerPos, context, dt) {
  if (!occlusion || !activeSources || !context) return;

  occlusion._timeSinceUpdate += dt;
  if (occlusion._timeSinceUpdate < occlusion.updateInterval) return;
  occlusion._timeSinceUpdate = 0;

  for (const source of activeSources.values()) {
    if (source.done || !source.spatialAudio || !source.position) continue;

    // Count occluders between source and listener
    let totalTransmission = 1.0;
    for (const occ of occlusion.occluders) {
      if (_rayIntersectsAABB(source.position, listenerPos, occ.min, occ.max)) {
        totalTransmission *= occ.transmission;
      }
    }

    const occlusionAmount = 1.0 - totalTransmission;
    source.occlusionAmount = occlusionAmount;

    // Apply lowpass filter
    if (occlusionAmount > 0.01) {
      if (!source.occlusionFilter) {
        source.occlusionFilter = context.createBiquadFilter();
        source.occlusionFilter.type = 'lowpass';
        source.occlusionFilter.Q.value = 0.7;
        // Insert filter into chain: disconnect gain→bus, insert gain→filter→bus
        try {
          const dest = source.pannerNode || source.gainNode;
          const busOutput = source.bus?.gainNode;
          if (dest && busOutput) {
            dest.disconnect(busOutput);
            dest.connect(source.occlusionFilter);
            source.occlusionFilter.connect(busOutput);
          }
        } catch (_) { /* ignore connection errors */ }
      }

      const freq = occlusion.filterFreqMax -
        occlusionAmount * (occlusion.filterFreqMax - occlusion.filterFreqMin);
      source.occlusionFilter.frequency.setTargetAtTime(freq, context.currentTime, 0.05);

      // Also reduce volume
      const volumeMult = 1.0 - occlusionAmount * (1.0 - occlusion.volumeReduction);
      source.gainNode.gain.setTargetAtTime(
        source.volume * volumeMult,
        context.currentTime,
        0.05
      );
    } else if (source.occlusionFilter) {
      // Remove filter — restore direct connection
      source.occlusionFilter.frequency.setTargetAtTime(
        occlusion.filterFreqMax,
        context.currentTime,
        0.05
      );
      source.gainNode.gain.setTargetAtTime(source.volume, context.currentTime, 0.05);
    }
  }
}

// ============================================================================
// DESTROY
// ============================================================================

/**
 * Destroy occlusion system.
 * @param {Object} occlusion
 */
export function destroyAudioOcclusion(occlusion) {
  if (!occlusion) return;
  occlusion.occluders.length = 0;
}

// ============================================================================
// INTERNAL — AABB Ray Intersection (slab method)
// ============================================================================

function _rayIntersectsAABB(origin, target, boxMin, boxMax) {
  const dirX = target[0] - origin[0];
  const dirY = target[1] - origin[1];
  const dirZ = target[2] - origin[2];

  const invDirX = dirX !== 0 ? 1 / dirX : 1e30;
  const invDirY = dirY !== 0 ? 1 / dirY : 1e30;
  const invDirZ = dirZ !== 0 ? 1 / dirZ : 1e30;

  let tMin, tMax;

  if (invDirX >= 0) {
    tMin = (boxMin[0] - origin[0]) * invDirX;
    tMax = (boxMax[0] - origin[0]) * invDirX;
  } else {
    tMin = (boxMax[0] - origin[0]) * invDirX;
    tMax = (boxMin[0] - origin[0]) * invDirX;
  }

  let tyMin, tyMax;
  if (invDirY >= 0) {
    tyMin = (boxMin[1] - origin[1]) * invDirY;
    tyMax = (boxMax[1] - origin[1]) * invDirY;
  } else {
    tyMin = (boxMax[1] - origin[1]) * invDirY;
    tyMax = (boxMin[1] - origin[1]) * invDirY;
  }

  if (tMin > tyMax || tyMin > tMax) return false;
  if (tyMin > tMin) tMin = tyMin;
  if (tyMax < tMax) tMax = tyMax;

  let tzMin, tzMax;
  if (invDirZ >= 0) {
    tzMin = (boxMin[2] - origin[2]) * invDirZ;
    tzMax = (boxMax[2] - origin[2]) * invDirZ;
  } else {
    tzMin = (boxMax[2] - origin[2]) * invDirZ;
    tzMax = (boxMin[2] - origin[2]) * invDirZ;
  }

  if (tMin > tzMax || tzMin > tMax) return false;
  if (tzMin > tMin) tMin = tzMin;
  if (tzMax < tMax) tMax = tzMax;

  // Intersection must be between origin and target (t in [0, 1])
  return tMax >= 0 && tMin <= 1;
}
