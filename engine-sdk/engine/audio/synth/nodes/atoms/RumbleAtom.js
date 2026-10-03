// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * RumbleAtom.js - Rumble Sound Atom (Verron 2012)
 * 
 * Pre-wired patch: BrownNoise → LowPass → Gain
 * Driven by: size → cutoff, velocity → volume
 * Use case: thunder, ground shake, lava, explosions
 */

/**
 * Generate a Rumble atom patch descriptor.
 * @param {Object} config
 * @param {number} config.cutoff - Lowpass cutoff frequency (default 80)
 * @param {number} config.volume - Output volume (default 0.6)
 * @returns {Object} Patch JSON
 */
let _rumblePatchSequence = 0;

function _newRumblePatchId() {
  return `rumble_${Date.now()}_${++_rumblePatchSequence}`;
}

export function createRumbleAtomPatch(config = {}) {
  const cutoff = config.cutoff ?? 80;
  const volume = config.volume ?? 0.6;

  return {
    id: _newRumblePatchId(),
    name: 'Rumble Atom',
    nodes: [
      { id: 'noise', type: 'NoiseGenerator', params: { color: 'brown' } },
      { id: 'lp', type: 'Filter', params: { type: 'lowpass', frequency: cutoff, Q: 1.0 } },
      { id: 'gain', type: 'Gain', params: { volume } },
      { id: 'out', type: 'Output' },
    ],
    wires: [
      { from: 'noise:out', to: 'lp:in' },
      { from: 'lp:out', to: 'gain:in' },
      { from: 'gain:out', to: 'out:in' },
    ],
    exposed: [
      { param: 'lp.frequency', name: 'rumble.cutoff', range: [20, 300] },
      { param: 'gain.volume', name: 'rumble.volume', range: [0, 2] },
    ],
  };
}
