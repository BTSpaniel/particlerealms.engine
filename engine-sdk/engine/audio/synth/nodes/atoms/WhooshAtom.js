// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * WhooshAtom.js - Whoosh Sound Atom (Verron 2012)
 * 
 * Pre-wired patch: Noise → BandPass → Envelope → Gain
 * Driven by: velocity → centerFreq, size → bandwidth
 * Use case: wind, projectile flyby, movement
 */

/**
 * Generate a Whoosh atom patch descriptor.
 * @param {Object} config
 * @param {number} config.centerFreq - Band-pass center frequency (default 500)
 * @param {number} config.bandwidth - Filter Q inversely (default 200)
 * @param {number} config.volume - Output volume (default 0.5)
 * @returns {Object} Patch JSON
 */
let _whooshPatchSequence = 0;

function _newWhooshPatchId() {
  return `whoosh_${Date.now()}_${++_whooshPatchSequence}`;
}

export function createWhooshAtomPatch(config = {}) {
  const centerFreq = config.centerFreq ?? 500;
  const volume = config.volume ?? 0.5;
  const Q = config.bandwidth ? centerFreq / config.bandwidth : 2.5;

  return {
    id: _newWhooshPatchId(),
    name: 'Whoosh Atom',
    nodes: [
      { id: 'noise', type: 'NoiseGenerator', params: { color: 'white' } },
      { id: 'bp', type: 'Filter', params: { type: 'bandpass', frequency: centerFreq, Q } },
      { id: 'env', type: 'Envelope', params: { attack: 0.05, decay: 0.3, sustain: 0.4, release: 0.2 } },
      { id: 'mul', type: 'MathOp', params: { operation: 'mul' } },
      { id: 'gain', type: 'Gain', params: { volume } },
      { id: 'out', type: 'Output' },
    ],
    wires: [
      { from: 'noise:out', to: 'bp:in' },
      { from: 'bp:out', to: 'mul:a' },
      { from: 'env:out', to: 'mul:b' },
      { from: 'mul:out', to: 'gain:in' },
      { from: 'gain:out', to: 'out:in' },
    ],
    exposed: [
      { param: 'bp.frequency', name: 'whoosh.centerFreq', range: [100, 8000] },
      { param: 'bp.Q', name: 'whoosh.Q', range: [0.5, 10] },
      { param: 'gain.volume', name: 'whoosh.volume', range: [0, 2] },
    ],
  };
}
