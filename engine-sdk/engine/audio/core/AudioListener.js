// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * AudioListener.js - 3D Audio Listener
 * 
 * Wraps the Web Audio API AudioListener, syncing camera position,
 * orientation, and velocity for accurate 3D spatialization.
 */

// ============================================================================
// CREATION
// ============================================================================

/**
 * Create an audio listener wrapper.
 * @param {AudioContext} context
 * @returns {Object} Listener instance
 */
export function createAudioListener(context) {
  if (!context) return null;
  const raw = context.listener;
  return {
    raw,
    position: [0, 0, 0],
    forward: [0, 0, -1],
    up: [0, 1, 0],
    velocity: [0, 0, 0],
    _prevPosition: [0, 0, 0],
  };
}

// ============================================================================
// UPDATE
// ============================================================================

/**
 * Update listener position, orientation, and velocity.
 * Call once per frame with camera data.
 * @param {Object} listener
 * @param {number[]} position - [x, y, z]
 * @param {number[]} forward - [x, y, z] normalized forward direction
 * @param {number[]} up - [x, y, z] normalized up direction
 * @param {number} dt - Delta time for velocity calculation
 */
export function updateAudioListener(listener, position, forward, up, dt) {
  if (!listener || !listener.raw) return;

  // Compute velocity from position delta
  if (dt > 0) {
    listener.velocity[0] = (position[0] - listener._prevPosition[0]) / dt;
    listener.velocity[1] = (position[1] - listener._prevPosition[1]) / dt;
    listener.velocity[2] = (position[2] - listener._prevPosition[2]) / dt;
  }

  listener.position[0] = position[0];
  listener.position[1] = position[1];
  listener.position[2] = position[2];
  listener.forward[0] = forward[0];
  listener.forward[1] = forward[1];
  listener.forward[2] = forward[2];
  listener.up[0] = up[0];
  listener.up[1] = up[1];
  listener.up[2] = up[2];

  listener._prevPosition[0] = position[0];
  listener._prevPosition[1] = position[1];
  listener._prevPosition[2] = position[2];

  const raw = listener.raw;

  // Modern API (AudioParam-based)
  if (raw.positionX) {
    raw.positionX.value = position[0];
    raw.positionY.value = position[1];
    raw.positionZ.value = position[2];
    raw.forwardX.value = forward[0];
    raw.forwardY.value = forward[1];
    raw.forwardZ.value = forward[2];
    raw.upX.value = up[0];
    raw.upY.value = up[1];
    raw.upZ.value = up[2];
  } else {
    // Legacy API fallback
    raw.setPosition(position[0], position[1], position[2]);
    raw.setOrientation(forward[0], forward[1], forward[2], up[0], up[1], up[2]);
  }
}

/**
 * Get the listener's current position.
 * @param {Object} listener
 * @returns {number[]} [x, y, z]
 */
export function getListenerPosition(listener) {
  if (!listener) return [0, 0, 0];
  return listener.position;
}

/**
 * Get the listener's current velocity.
 * @param {Object} listener
 * @returns {number[]} [x, y, z]
 */
export function getListenerVelocity(listener) {
  if (!listener) return [0, 0, 0];
  return listener.velocity;
}

// ============================================================================
// DESTROY
// ============================================================================

/**
 * Destroy the listener wrapper.
 * @param {Object} listener
 */
export function destroyAudioListener(listener) {
  if (!listener) return;
  listener.raw = null;
}
