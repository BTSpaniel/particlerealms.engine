// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * AudioSource.js - 3D Sound Emitter
 * 
 * Wraps a BufferSourceNode + PannerNode (HRTF) + GainNode chain.
 * Represents a single playing sound in 3D space.
 */

import { getBusOutput } from './AudioBus.js';

// ============================================================================
// CREATION
// ============================================================================

/**
 * Create and start an audio source.
 * @param {AudioContext} context
 * @param {Object} config
 * @param {number} config.id - Unique source ID
 * @param {AudioBuffer} config.buffer - Decoded audio buffer
 * @param {Object} config.bus - AudioBus to connect to
 * @param {number[]} config.position - [x,y,z] or null for 2D
 * @param {number[]} config.velocity - [x,y,z] source velocity
 * @param {number} config.volume - Volume 0-2 (default 1.0)
 * @param {number} config.pitch - Playback rate (default 1.0)
 * @param {boolean} config.loop - Loop playback (default false)
 * @param {number} config.priority - Priority for voice stealing (default 0)
 * @param {boolean} config.spatialAudio - Use 3D panner (default false)
 * @param {number} config.refDistance - PannerNode refDistance (default 1)
 * @param {number} config.maxDistance - PannerNode maxDistance (default 100)
 * @param {number} config.rolloff - PannerNode rolloffFactor (default 1)
 * @param {number} config.time - Engine time at creation
 * @returns {Object|null} Source instance
 */
export function createAudioSource(context, config = {}) {
  if (!context || !config.buffer || !config.bus) return null;

  const busOutput = getBusOutput(config.bus);
  if (!busOutput) return null;

  // Buffer source
  const bufferSource = context.createBufferSource();
  bufferSource.buffer = config.buffer;
  bufferSource.loop = config.loop ?? false;
  bufferSource.playbackRate.value = config.pitch ?? 1.0;

  // Gain node
  const gainNode = context.createGain();
  gainNode.gain.value = config.volume ?? 1.0;

  // Panner node (optional 3D)
  let pannerNode = null;
  if (config.spatialAudio && config.position) {
    pannerNode = context.createPanner();
    pannerNode.panningModel = 'HRTF';
    pannerNode.distanceModel = 'inverse';
    pannerNode.refDistance = config.refDistance ?? 1;
    pannerNode.maxDistance = config.maxDistance ?? 100;
    pannerNode.rolloffFactor = config.rolloff ?? 1;
    pannerNode.coneInnerAngle = 360;
    pannerNode.coneOuterAngle = 360;
    pannerNode.coneOuterGain = 1;

    if (pannerNode.positionX) {
      pannerNode.positionX.value = config.position[0];
      pannerNode.positionY.value = config.position[1];
      pannerNode.positionZ.value = config.position[2];
    } else {
      pannerNode.setPosition(config.position[0], config.position[1], config.position[2]);
    }

    // Chain: bufferSource → gainNode → pannerNode → bus
    bufferSource.connect(gainNode);
    gainNode.connect(pannerNode);
    pannerNode.connect(busOutput);
  } else {
    // Chain: bufferSource → gainNode → bus
    bufferSource.connect(gainNode);
    gainNode.connect(busOutput);
  }

  const source = {
    id: config.id ?? 0,
    bufferSource,
    gainNode,
    pannerNode,
    context,
    bus: config.bus,
    position: config.position ? [...config.position] : null,
    velocity: config.velocity ? [...config.velocity] : [0, 0, 0],
    volume: config.volume ?? 1.0,
    pitch: config.pitch ?? 1.0,
    loop: config.loop ?? false,
    priority: config.priority ?? 0,
    spatialAudio: !!pannerNode,
    startTime: config.time ?? 0,
    duration: config.buffer.duration,
    stopping: false,
    done: false,
    // Occlusion/filter (set externally)
    occlusionFilter: null,
    occlusionAmount: 0,
  };

  // Mark done when buffer ends
  bufferSource.onended = () => {
    source.done = true;
  };

  // Start playback
  bufferSource.start(0);

  return source;
}

// ============================================================================
// UPDATE
// ============================================================================

/**
 * Tick a source (per-frame update).
 * @param {Object} source
 * @param {number} dt
 */
export function tickAudioSource(source, dt) {
  if (!source || source.done) return;

  // Update position if moving
  if (source.spatialAudio && source.velocity && source.position) {
    source.position[0] += source.velocity[0] * dt;
    source.position[1] += source.velocity[1] * dt;
    source.position[2] += source.velocity[2] * dt;
    _updatePannerPosition(source);
  }
}

/**
 * Update source 3D position explicitly.
 * @param {Object} source
 * @param {number[]} position - [x, y, z]
 */
export function setSourcePosition(source, position) {
  if (!source || !source.pannerNode || !position) return;
  source.position[0] = position[0];
  source.position[1] = position[1];
  source.position[2] = position[2];
  _updatePannerPosition(source);
}

/**
 * Set source volume.
 * @param {Object} source
 * @param {number} volume
 */
export function setSourceVolume(source, volume) {
  if (!source || source.done) return;
  source.volume = Math.max(0, Math.min(2, volume));
  source.gainNode.gain.setTargetAtTime(source.volume, source.context.currentTime, 0.02);
}

/**
 * Set source pitch/playback rate.
 * @param {Object} source
 * @param {number} pitch
 */
export function setSourcePitch(source, pitch) {
  if (!source || source.done) return;
  source.pitch = Math.max(0.1, Math.min(4, pitch));
  source.bufferSource.playbackRate.setTargetAtTime(source.pitch, source.context.currentTime, 0.02);
}

/**
 * Stop a source with optional fade-out.
 * @param {Object} source
 * @param {number} fadeOut - Seconds to fade (default 0.05)
 */
export function stopAudioSource(source, fadeOut = 0.05) {
  if (!source || source.done || source.stopping) return;
  source.stopping = true;

  const now = source.context.currentTime;
  source.gainNode.gain.setTargetAtTime(0, now, fadeOut * 0.3);

  // Schedule actual stop
  try {
    source.bufferSource.stop(now + fadeOut);
  } catch (_) {
    source.done = true;
  }
}

/**
 * Check if source is finished playing.
 * @param {Object} source
 * @returns {boolean}
 */
export function isSourceDone(source) {
  return !source || source.done;
}

/**
 * Get effective volume (volume × occlusion).
 * @param {Object} source
 * @returns {number}
 */
export function getSourceEffectiveVolume(source) {
  if (!source) return 0;
  return source.volume * (1 - source.occlusionAmount);
}

// ============================================================================
// DESTROY
// ============================================================================

/**
 * Destroy a source and disconnect all nodes.
 * @param {Object} source
 */
export function destroyAudioSource(source) {
  if (!source) return;
  source.done = true;
  try { source.bufferSource.stop(); } catch (_) { /* already stopped */ }
  try { source.bufferSource.disconnect(); } catch (_) { /* ignore */ }
  try { source.gainNode.disconnect(); } catch (_) { /* ignore */ }
  if (source.pannerNode) {
    try { source.pannerNode.disconnect(); } catch (_) { /* ignore */ }
  }
  if (source.occlusionFilter) {
    try { source.occlusionFilter.disconnect(); } catch (_) { /* ignore */ }
  }
  source.bufferSource = null;
  source.gainNode = null;
  source.pannerNode = null;
  source.occlusionFilter = null;
  source.context = null;
}

// ============================================================================
// INTERNAL
// ============================================================================

function _updatePannerPosition(source) {
  const p = source.pannerNode;
  if (!p) return;
  if (p.positionX) {
    p.positionX.value = source.position[0];
    p.positionY.value = source.position[1];
    p.positionZ.value = source.position[2];
  } else {
    p.setPosition(source.position[0], source.position[1], source.position[2]);
  }
}
