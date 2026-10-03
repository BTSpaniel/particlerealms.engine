// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * AudioDoppler.js - Doppler Effect
 * 
 * Manually computes pitch shift from radial velocity between
 * source and listener. Web Audio's built-in Doppler was removed
 * from the spec, so we implement it ourselves.
 * 
 * Doppler ratio = (speedOfSound + listenerRadialVelocity) /
 *                 (speedOfSound + sourceRadialVelocity)
 */

// ============================================================================
// CONSTANTS
// ============================================================================

const SPEED_OF_SOUND = 343; // m/s in air at 20°C

// ============================================================================
// CREATION
// ============================================================================

/**
 * Create a Doppler processor.
 * @param {Object} config
 * @param {number} config.speedOfSound - Speed of sound in world units/sec (default 343)
 * @param {number} config.maxShift - Max pitch multiplier shift (default 0.5, so range 0.5-1.5)
 * @param {number} config.smoothing - Smoothing factor 0-1 (default 0.1)
 * @returns {Object}
 */
export function createAudioDoppler(config = {}) {
  return {
    speedOfSound: config.speedOfSound ?? SPEED_OF_SOUND,
    maxShift: config.maxShift ?? 0.5,
    smoothing: config.smoothing ?? 0.1,
    enabled: true,
  };
}

// ============================================================================
// UPDATE
// ============================================================================

/**
 * Tick Doppler — adjust pitch of all spatial sources based on relative velocity.
 * @param {Object} doppler
 * @param {Map} activeSources - Map of id → AudioSource
 * @param {number[]} listenerPos - [x, y, z]
 * @param {number[]} listenerVel - [x, y, z]
 */
export function tickDoppler(doppler, activeSources, listenerPos, listenerVel) {
  if (!doppler || !doppler.enabled || !activeSources) return;

  const sos = doppler.speedOfSound;
  const maxShift = doppler.maxShift;

  for (const source of activeSources.values()) {
    if (source.done || !source.spatialAudio || !source.position) continue;

    // Direction from source to listener
    const dx = listenerPos[0] - source.position[0];
    const dy = listenerPos[1] - source.position[1];
    const dz = listenerPos[2] - source.position[2];
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (dist < 0.001) continue;

    // Normalized direction
    const nx = dx / dist;
    const ny = dy / dist;
    const nz = dz / dist;

    // Radial velocities (positive = approaching)
    const sv = source.velocity;
    const sourceRadialVel = sv[0] * nx + sv[1] * ny + sv[2] * nz;
    const listenerRadialVel = listenerVel[0] * nx + listenerVel[1] * ny + listenerVel[2] * nz;

    // Doppler ratio
    let ratio = (sos + listenerRadialVel) / (sos + sourceRadialVel);

    // Clamp
    ratio = Math.max(1 - maxShift, Math.min(1 + maxShift, ratio));

    // Apply to playback rate (smoothed)
    const targetRate = source.pitch * ratio;
    const currentRate = source.bufferSource.playbackRate.value;
    const smoothed = currentRate + (targetRate - currentRate) * doppler.smoothing;

    try {
      source.bufferSource.playbackRate.value = smoothed;
    } catch (_) { /* ignore if source is stopped */ }
  }
}

// ============================================================================
// DESTROY
// ============================================================================

/**
 * Destroy Doppler processor.
 * @param {Object} doppler
 */
export function destroyAudioDoppler(doppler) {
  // Plain object — nothing to free
}
