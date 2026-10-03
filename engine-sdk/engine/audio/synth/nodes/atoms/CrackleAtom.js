// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * CrackleAtom.js - Crackle Sound Atom (Verron 2012)
 * 
 * Pre-wired patch: Impulse → ModalBank (2-3 modes) → Envelope (AD) → Gain
 * Driven by: emitRate → density, temperature → brightness
 * Use case: fire crackle, ice crack, sparks
 */

/**
 * Generate a Crackle atom patch descriptor.
 * @param {Object} config
 * @param {number} config.density - Impulse rate (events/sec, default 30)
 * @param {number} config.brightness - High-frequency content 0-1 (default 0.5)
 * @param {number} config.volume - Output volume (default 0.6)
 * @returns {Object} Patch JSON
 */
let _cracklePatchSequence = 0;

function _newCracklePatchId() {
  return `crackle_${Date.now()}_${++_cracklePatchSequence}`;
}

export function createCrackleAtomPatch(config = {}) {
  const density = config.density ?? 30;
  const brightness = config.brightness ?? 0.5;
  const volume = config.volume ?? 0.6;

  // Map brightness to filter frequency (300 Hz - 6000 Hz)
  const filterFreq = 300 + brightness * 5700;

  return {
    id: _newCracklePatchId(),
    name: 'Crackle Atom',
    nodes: [
      { id: 'imp', type: 'Impulse', params: { rate: density, jitter: 0.8, shape: 0.3 } },
      { id: 'flt', type: 'Filter', params: { type: 'bandpass', frequency: filterFreq, Q: 2.0 } },
      { id: 'env', type: 'Envelope', params: { attack: 0.001, decay: 0.02, sustain: 0, release: 0.01 } },
      { id: 'gain', type: 'Gain', params: { volume } },
      { id: 'out', type: 'Output' },
    ],
    wires: [
      { from: 'imp:out', to: 'flt:in' },
      { from: 'imp:out', to: 'env:gate' },
      { from: 'flt:out', to: 'gain:in' },
      { from: 'gain:out', to: 'out:in' },
    ],
    exposed: [
      { param: 'imp.rate', name: 'crackle.density', range: [1, 200] },
      { param: 'flt.frequency', name: 'crackle.brightness', range: [300, 6000] },
      { param: 'gain.volume', name: 'crackle.volume', range: [0, 2] },
    ],
  };
}
