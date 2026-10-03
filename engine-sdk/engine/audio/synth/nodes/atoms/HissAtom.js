// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * HissAtom.js - Hiss Sound Atom (Verron 2012)
 * 
 * Pre-wired patch: Noise(white) → HighPass → Gain
 * Driven by: temperature → cutoff, emitRate → volume
 * Use case: steam, gas escape, sizzle, continuous background
 */

/**
 * Generate a Hiss atom patch descriptor.
 * @param {Object} config
 * @param {number} config.cutoff - Highpass cutoff frequency (default 2000)
 * @param {number} config.volume - Output volume (default 0.5)
 * @returns {Object} Patch JSON
 */
let _hissPatchSequence = 0;

function _newHissPatchId() {
  return `hiss_${Date.now()}_${++_hissPatchSequence}`;
}

export function createHissAtomPatch(config = {}) {
  const cutoff = config.cutoff ?? 2000;
  const volume = config.volume ?? 0.5;

  return {
    id: _newHissPatchId(),
    name: 'Hiss Atom',
    nodes: [
      { id: 'noise', type: 'NoiseGenerator', params: { color: 'white' } },
      { id: 'hp', type: 'Filter', params: { type: 'highpass', frequency: cutoff, Q: 0.7 } },
      { id: 'gain', type: 'Gain', params: { volume } },
      { id: 'out', type: 'Output' },
    ],
    wires: [
      { from: 'noise:out', to: 'hp:in' },
      { from: 'hp:out', to: 'gain:in' },
      { from: 'gain:out', to: 'out:in' },
    ],
    exposed: [
      { param: 'hp.frequency', name: 'hiss.cutoff', range: [200, 12000] },
      { param: 'gain.volume', name: 'hiss.volume', range: [0, 2] },
    ],
  };
}
