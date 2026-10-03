// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * SharedParamBuffer.js - Game → AudioWorklet Parameter Streaming
 * 
 * Allocates a SharedArrayBuffer for zero-copy, zero-latency parameter
 * updates from the main game thread to the AudioWorklet synthesis thread.
 * 
 * Layout: Float32Array where each slot maps to an exposed synth parameter.
 * The main thread writes emitter aggregate stats each frame; the worklet reads them.
 */

// ============================================================================
// STANDARD PARAM LAYOUT
// ============================================================================

/**
 * Standard parameter indices for emitter → synth streaming.
 * Each active emitter gets one set of these slots.
 */
export const PARAM_LAYOUT = {
  ACTIVE_COUNT:   0,  // Number of alive particles
  EMIT_RATE:      1,  // Current emission rate
  AVG_VELOCITY:   2,  // Average particle speed
  AVG_TEMPERATURE:3,  // Average particle temperature (K)
  AVG_SIZE:       4,  // Average particle size
  TOTAL_MASS:     5,  // Sum of particle masses
  MAX_VELOCITY:   6,  // Peak velocity this frame
  DENSITY:        7,  // Particle density (count / volume)
  // Reserved for future use
  _RESERVED_8:    8,
  _RESERVED_9:    9,
  _RESERVED_10:   10,
  _RESERVED_11:   11,
};

export const PARAMS_PER_EMITTER = 12;
export const MAX_EMITTERS = 8;
export const TOTAL_FLOAT_COUNT = PARAMS_PER_EMITTER * MAX_EMITTERS;

// ============================================================================
// CREATION
// ============================================================================

/**
 * Create a shared parameter buffer.
 * @returns {Object} { sharedBuffer, mainView, workletBuffer }
 *   sharedBuffer: SharedArrayBuffer (pass to worklet via postMessage)
 *   mainView: Float32Array for main thread writes
 *   workletBuffer: same SharedArrayBuffer reference (for postMessage)
 */
export function createSharedParamBuffer() {
  if (typeof SharedArrayBuffer === 'undefined') {
    console.warn('[SharedParamBuffer] SharedArrayBuffer not available, using fallback');
    // Fallback: regular ArrayBuffer (no sharing, updates via MessagePort)
    const buffer = new ArrayBuffer(TOTAL_FLOAT_COUNT * 4);
    const view = new Float32Array(buffer);
    return { sharedBuffer: null, mainView: view, workletBuffer: null };
  }

  const sharedBuffer = new SharedArrayBuffer(TOTAL_FLOAT_COUNT * 4);
  const mainView = new Float32Array(sharedBuffer);

  return {
    sharedBuffer,
    mainView,
    workletBuffer: sharedBuffer,
  };
}

// ============================================================================
// WRITE (Main Thread — call each frame)
// ============================================================================

/**
 * Write emitter aggregate stats to the shared buffer.
 * @param {Float32Array} view - mainView from createSharedParamBuffer
 * @param {number} emitterIndex - 0 to MAX_EMITTERS-1
 * @param {Object} stats
 * @param {number} stats.activeCount
 * @param {number} stats.emitRate
 * @param {number} stats.avgVelocity
 * @param {number} stats.avgTemperature
 * @param {number} stats.avgSize
 * @param {number} stats.totalMass
 * @param {number} stats.maxVelocity
 * @param {number} stats.density
 */
export function writeEmitterStats(view, emitterIndex, stats) {
  if (!view || emitterIndex < 0 || emitterIndex >= MAX_EMITTERS) return;

  const base = emitterIndex * PARAMS_PER_EMITTER;
  view[base + PARAM_LAYOUT.ACTIVE_COUNT]    = stats.activeCount ?? 0;
  view[base + PARAM_LAYOUT.EMIT_RATE]       = stats.emitRate ?? 0;
  view[base + PARAM_LAYOUT.AVG_VELOCITY]    = stats.avgVelocity ?? 0;
  view[base + PARAM_LAYOUT.AVG_TEMPERATURE] = stats.avgTemperature ?? 0;
  view[base + PARAM_LAYOUT.AVG_SIZE]        = stats.avgSize ?? 0;
  view[base + PARAM_LAYOUT.TOTAL_MASS]      = stats.totalMass ?? 0;
  view[base + PARAM_LAYOUT.MAX_VELOCITY]    = stats.maxVelocity ?? 0;
  view[base + PARAM_LAYOUT.DENSITY]         = stats.density ?? 0;
}

/**
 * Clear all emitter stats (e.g. when emitters stop).
 * @param {Float32Array} view
 */
export function clearAllEmitterStats(view) {
  if (!view) return;
  view.fill(0);
}

/**
 * Clear stats for a specific emitter.
 * @param {Float32Array} view
 * @param {number} emitterIndex
 */
export function clearEmitterStats(view, emitterIndex) {
  if (!view || emitterIndex < 0 || emitterIndex >= MAX_EMITTERS) return;
  const base = emitterIndex * PARAMS_PER_EMITTER;
  for (let i = 0; i < PARAMS_PER_EMITTER; i++) {
    view[base + i] = 0;
  }
}

// ============================================================================
// READ (AudioWorklet side — called in PatchRunner.worklet.js process())
// ============================================================================

/**
 * Read a single param value from the shared buffer.
 * @param {Float32Array} view - Float32Array wrapping SharedArrayBuffer
 * @param {number} emitterIndex
 * @param {number} paramIndex - PARAM_LAYOUT value
 * @returns {number}
 */
export function readEmitterParam(view, emitterIndex, paramIndex) {
  if (!view) return 0;
  return view[emitterIndex * PARAMS_PER_EMITTER + paramIndex] || 0;
}
