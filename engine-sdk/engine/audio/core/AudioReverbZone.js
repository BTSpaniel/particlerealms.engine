// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { uniformDistribution } from '../../core/math/MathRandom.js';

/**
 * AudioReverbZone.js - Spatial Reverb Zones
 * 
 * Defines spatial volumes (box/sphere) with acoustic properties.
 * When the listener enters a zone, reverb is blended in via ConvolverNode
 * or algorithmic parameters. Multiple overlapping zones blend by distance.
 */

// ============================================================================
// PRESETS
// ============================================================================

export const REVERB_PRESETS = {
  none:       { decayTime: 0,    wetLevel: 0,    dryLevel: 1.0, highCut: 20000 },
  small_room: { decayTime: 0.4,  wetLevel: 0.15, dryLevel: 0.85, highCut: 8000 },
  medium_room:{ decayTime: 0.8,  wetLevel: 0.25, dryLevel: 0.75, highCut: 6000 },
  large_hall: { decayTime: 2.0,  wetLevel: 0.4,  dryLevel: 0.6, highCut: 5000 },
  cathedral:  { decayTime: 4.0,  wetLevel: 0.5,  dryLevel: 0.5, highCut: 4000 },
  cave:       { decayTime: 3.0,  wetLevel: 0.6,  dryLevel: 0.4, highCut: 3000 },
  tunnel:     { decayTime: 1.5,  wetLevel: 0.35, dryLevel: 0.65, highCut: 4500 },
  outdoor:    { decayTime: 0.2,  wetLevel: 0.05, dryLevel: 0.95, highCut: 12000 },
  underwater: { decayTime: 1.0,  wetLevel: 0.7,  dryLevel: 0.3, highCut: 1500 },
  metal_room: { decayTime: 1.2,  wetLevel: 0.35, dryLevel: 0.65, highCut: 7000 },
};

// ============================================================================
// CREATION
// ============================================================================

/**
 * Create a reverb zone system.
 * @param {AudioContext} context
 * @param {AudioNode} destination - Node to connect reverb output to (usually masterGain)
 * @returns {Object}
 */
export function createReverbZoneSystem(context, destination) {
  if (!context || !destination) return null;

  // Wet/dry gain nodes for global reverb mix
  const wetGain = context.createGain();
  wetGain.gain.value = 0;
  wetGain.connect(destination);

  const dryGain = context.createGain();
  dryGain.gain.value = 1;
  dryGain.connect(destination);

  // Convolver for impulse-response reverb
  const convolver = context.createConvolver();
  convolver.connect(wetGain);

  // Generate a simple synthetic impulse response
  _generateSyntheticIR(context, convolver, 2.0, 4000);

  return {
    context,
    destination,
    wetGain,
    dryGain,
    convolver,
    zones: [],           // Array of ReverbZone
    activePreset: null,  // Currently active blended preset
    _currentWet: 0,
    _currentDry: 1,
  };
}

/**
 * Add a reverb zone.
 * @param {Object} system
 * @param {Object} config
 * @param {string} config.shape - 'box' | 'sphere' (default 'box')
 * @param {number[]} config.center - [x, y, z]
 * @param {number[]} config.size - [w, h, d] for box
 * @param {number} config.radius - Radius for sphere
 * @param {string} config.preset - Key from REVERB_PRESETS
 * @param {number} config.priority - Higher takes precedence in overlaps (default 0)
 * @returns {number} Zone index
 */
export function addReverbZone(system, config = {}) {
  if (!system) return -1;

  const preset = REVERB_PRESETS[config.preset] || REVERB_PRESETS.medium_room;
  const zone = {
    shape: config.shape || 'box',
    center: config.center || [0, 0, 0],
    size: config.size || [10, 10, 10],
    radius: config.radius || 10,
    preset: { ...preset },
    presetName: config.preset || 'medium_room',
    priority: config.priority ?? 0,
    active: true,
  };

  const idx = system.zones.length;
  system.zones.push(zone);
  return idx;
}

/**
 * Remove a reverb zone.
 * @param {Object} system
 * @param {number} index
 */
export function removeReverbZone(system, index) {
  if (!system || index < 0 || index >= system.zones.length) return;
  system.zones.splice(index, 1);
}

// ============================================================================
// UPDATE
// ============================================================================

/**
 * Tick reverb zones — blend based on listener position.
 * @param {Object} system
 * @param {number[]} listenerPos - [x, y, z]
 */
export function tickReverbZones(system, listenerPos) {
  if (!system || !listenerPos || system.zones.length === 0) return;

  let totalWeight = 0;
  let blendedWet = 0;
  let blendedDry = 0;
  let blendedDecay = 0;
  let blendedHighCut = 20000;

  for (const zone of system.zones) {
    if (!zone.active) continue;

    const influence = _getZoneInfluence(zone, listenerPos);
    if (influence <= 0) continue;

    const weight = influence * (1 + zone.priority * 0.1);
    totalWeight += weight;
    blendedWet += zone.preset.wetLevel * weight;
    blendedDry += zone.preset.dryLevel * weight;
    blendedDecay += zone.preset.decayTime * weight;
    blendedHighCut = Math.min(blendedHighCut, zone.preset.highCut);
  }

  const now = system.context.currentTime;

  if (totalWeight > 0) {
    blendedWet /= totalWeight;
    blendedDry /= totalWeight;
    blendedDecay /= totalWeight;

    // Regenerate IR if decay time changed significantly
    if (Math.abs(blendedDecay - (system._lastDecay || 0)) > 0.3) {
      _generateSyntheticIR(system.context, system.convolver, blendedDecay, blendedHighCut);
      system._lastDecay = blendedDecay;
    }

    system.wetGain.gain.setTargetAtTime(blendedWet, now, 0.1);
    system.dryGain.gain.setTargetAtTime(blendedDry, now, 0.1);
  } else {
    // No zones active — dry only
    system.wetGain.gain.setTargetAtTime(0, now, 0.1);
    system.dryGain.gain.setTargetAtTime(1, now, 0.1);
  }
}

/**
 * Connect a source to the reverb system's convolver (send).
 * @param {Object} system
 * @param {Object} source - AudioSource
 * @param {number} sendLevel - How much signal goes to reverb (0-1)
 */
export function connectSourceToReverb(system, source, sendLevel = 0.3) {
  if (!system || !source || !source.gainNode) return;
  try {
    // Create a send gain node
    const sendGain = system.context.createGain();
    sendGain.gain.value = sendLevel;
    source.gainNode.connect(sendGain);
    sendGain.connect(system.convolver);
    source._reverbSend = sendGain;
  } catch (_) { /* ignore */ }
}

// ============================================================================
// DESTROY
// ============================================================================

/**
 * Destroy reverb zone system.
 * @param {Object} system
 */
export function destroyReverbZoneSystem(system) {
  if (!system) return;
  try { system.wetGain.disconnect(); } catch (_) {}
  try { system.dryGain.disconnect(); } catch (_) {}
  try { system.convolver.disconnect(); } catch (_) {}
  system.zones.length = 0;
  system.context = null;
}

// ============================================================================
// INTERNAL
// ============================================================================

function _getZoneInfluence(zone, pos) {
  if (zone.shape === 'sphere') {
    const dx = pos[0] - zone.center[0];
    const dy = pos[1] - zone.center[1];
    const dz = pos[2] - zone.center[2];
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist >= zone.radius) return 0;
    return 1.0 - (dist / zone.radius); // Linear falloff
  }

  // Box shape — check if inside, with edge falloff
  const hx = zone.size[0] * 0.5;
  const hy = zone.size[1] * 0.5;
  const hz = zone.size[2] * 0.5;

  const dx = Math.abs(pos[0] - zone.center[0]);
  const dy = Math.abs(pos[1] - zone.center[1]);
  const dz = Math.abs(pos[2] - zone.center[2]);

  if (dx > hx || dy > hy || dz > hz) return 0;

  // Influence based on how deep inside the box (edge falloff)
  const fx = 1.0 - dx / hx;
  const fy = 1.0 - dy / hy;
  const fz = 1.0 - dz / hz;
  return Math.min(fx, fy, fz);
}

function _generateSyntheticIR(context, convolver, decayTime, highCut) {
  const sampleRate = context.sampleRate;
  const length = Math.max(1, Math.floor(sampleRate * decayTime));
  const clamped = Math.min(length, sampleRate * 5); // Cap at 5 seconds

  const buffer = context.createBuffer(2, clamped, sampleRate);
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);

  // Exponential decay with early reflections
  const decayFactor = -6.9 / clamped; // -60dB at end
  for (let i = 0; i < clamped; i++) {
    const t = i / sampleRate;
    const envelope = Math.exp(decayFactor * i);

    // Add some early reflections (sparse impulses in first 50ms)
    let early = 0;
    if (t < 0.05 && Math.random() < 0.02) {
      early = uniformDistribution(-1, 1, Math.random) * 0.5;
    }

    left[i] = (uniformDistribution(-1, 1, Math.random) * envelope + early) * 0.3;
    right[i] = (uniformDistribution(-1, 1, Math.random) * envelope + early) * 0.3;
  }

  try {
    convolver.buffer = buffer;
  } catch (_) { /* ignore if convolver is processing */ }
}
