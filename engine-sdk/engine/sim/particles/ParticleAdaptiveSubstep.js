// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ParticleAdaptiveSubstep.js - Adaptive Substeps with CFL Condition (GAP 20)
 * 
 * Automatically determines the number of simulation substeps per frame based on
 * the maximum particle velocity (CFL condition), preventing tunneling for fast
 * particles without wasting substeps on slow ones.
 * 
 * CFL: dt_sub = cellSize * cflFactor / maxSpeed
 * Substeps = ceil(dt_frame / dt_sub), clamped to [minSubsteps, maxSubsteps]
 * 
 * Uses GPU readback of max velocity (from indirect dispatch counters or a separate
 * reduction pass) when available, falls back to CPU-side estimate.
 * 
 * Ref: Houdini POP Solver CFL, PhysX particle substeps
 */

// ============================================================================
// SYSTEM
// ============================================================================

/**
 * Create an adaptive substep controller.
 * @param {Object} config
 * @param {number} config.cflFactor - CFL safety factor (0.5 = particle travels at most 50% of cell per substep)
 * @param {number} config.cellSize - Spatial cell size (collision grid resolution)
 * @param {number} config.minSubsteps - Minimum substeps per frame (default 1)
 * @param {number} config.maxSubsteps - Maximum substeps per frame (default 8)
 * @param {number} config.smoothing - Exponential smoothing for substep count changes (0-1, default 0.3)
 */
export function createAdaptiveSubstepController(config = {}) {
  return {
    cflFactor: config.cflFactor ?? 0.5,
    cellSize: config.cellSize ?? 1.0,
    minSubsteps: config.minSubsteps ?? 1,
    maxSubsteps: config.maxSubsteps ?? 8,
    smoothing: config.smoothing ?? 0.3,
    _smoothedSubsteps: 1,
    _lastMaxSpeed: 0,
    _history: new Float32Array(8), // Rolling history of max speeds
    _historyIdx: 0,
  };
}

/**
 * Compute the number of substeps needed for this frame.
 * 
 * @param {Object} controller - Adaptive substep controller
 * @param {number} frameDt - Frame delta time in seconds
 * @param {number} maxSpeed - Maximum particle speed this frame (from GPU readback or estimate)
 * @returns {{ substeps: number, substepDt: number, maxSpeed: number }}
 */
export function computeAdaptiveSubsteps(controller, frameDt, maxSpeed) {
  // Update rolling history for robustness
  controller._history[controller._historyIdx % 8] = maxSpeed;
  controller._historyIdx++;
  
  // Use peak of recent history to avoid sudden drops causing tunneling
  let peakSpeed = 0;
  for (let i = 0; i < 8; i++) {
    if (controller._history[i] > peakSpeed) peakSpeed = controller._history[i];
  }
  
  controller._lastMaxSpeed = peakSpeed;

  if (peakSpeed < 0.01) {
    // Negligible velocity — single substep
    return { substeps: controller.minSubsteps, substepDt: frameDt / controller.minSubsteps, maxSpeed: peakSpeed };
  }

  // CFL condition: max distance per substep = cellSize * cflFactor
  const maxDistPerSubstep = controller.cellSize * controller.cflFactor;
  const idealDtSub = maxDistPerSubstep / peakSpeed;
  
  // Required substeps
  let rawSubsteps = Math.ceil(frameDt / idealDtSub);
  rawSubsteps = Math.max(controller.minSubsteps, Math.min(controller.maxSubsteps, rawSubsteps));

  // Smooth transitions to avoid jitter
  controller._smoothedSubsteps = controller._smoothedSubsteps * (1 - controller.smoothing) + rawSubsteps * controller.smoothing;
  const substeps = Math.max(controller.minSubsteps, Math.round(controller._smoothedSubsteps));
  const substepDt = frameDt / substeps;

  return { substeps, substepDt, maxSpeed: peakSpeed };
}

/**
 * Estimate max particle speed from CPU-side velocity data.
 * Use this as fallback when GPU readback is not available.
 * @param {Float32Array} velocityData - Particle velocity buffer (vec4 per particle)
 * @param {number} particleCount - Number of active particles
 * @param {number} sampleCount - How many particles to sample (default 256 for performance)
 * @returns {number} Estimated max speed
 */
export function estimateMaxSpeedCPU(velocityData, particleCount, sampleCount = 256) {
  if (!velocityData || particleCount <= 0) return 0;
  
  let maxSpeedSq = 0;
  const step = Math.max(1, Math.floor(particleCount / sampleCount));
  
  for (let i = 0; i < particleCount; i += step) {
    const offset = i * 4;
    const vx = velocityData[offset];
    const vy = velocityData[offset + 1];
    const vz = velocityData[offset + 2];
    const speedSq = vx * vx + vy * vy + vz * vz;
    if (speedSq > maxSpeedSq) maxSpeedSq = speedSq;
  }
  
  return Math.sqrt(maxSpeedSq);
}

/**
 * Reset the controller state.
 */
export function resetAdaptiveSubsteps(controller) {
  controller._smoothedSubsteps = 1;
  controller._lastMaxSpeed = 0;
  controller._history.fill(0);
  controller._historyIdx = 0;
}
