// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * DropAtom.js - Drop Sound Atom (Verron 2012)
 * 
 * Pre-wired patch: Impulse → Resonator (single mode) → Envelope (AD)
 * Driven by: mass → pitch, velocity → amplitude
 * Use case: rain drops, drips, liquid impacts
 */

/**
 * Generate a Drop atom patch descriptor.
 * @param {Object} config
 * @param {number} config.pitch - Resonant frequency (default 400)
 * @param {number} config.amplitude - Drop loudness (default 0.8)
 * @param {number} config.rate - Drops per second (default 5)
 * @param {number} config.decay - Decay time in seconds (default 0.08)
 * @returns {Object} Patch JSON
 */
let _dropPatchSequence = 0;

function _newDropPatchId() {
  return `drop_${Date.now()}_${++_dropPatchSequence}`;
}

export function createDropAtomPatch(config = {}) {
  const pitch = config.pitch ?? 400;
  const amplitude = config.amplitude ?? 0.8;
  const rate = config.rate ?? 5;
  const decay = config.decay ?? 0.08;

  return {
    id: _newDropPatchId(),
    name: 'Drop Atom',
    nodes: [
      { id: 'imp', type: 'Impulse', params: { rate, jitter: 0.6, shape: 0.5 } },
      { id: 'osc', type: 'Oscillator', params: { frequency: pitch, shape: 'sine' } },
      { id: 'env', type: 'Envelope', params: { attack: 0.001, decay, sustain: 0, release: 0.01 } },
      { id: 'mul', type: 'MathOp', params: { operation: 'mul' } },
      { id: 'gain', type: 'Gain', params: { volume: amplitude } },
      { id: 'out', type: 'Output' },
    ],
    wires: [
      { from: 'imp:out', to: 'env:gate' },
      { from: 'osc:out', to: 'mul:a' },
      { from: 'env:out', to: 'mul:b' },
      { from: 'mul:out', to: 'gain:in' },
      { from: 'gain:out', to: 'out:in' },
    ],
    exposed: [
      { param: 'osc.frequency', name: 'drop.pitch', range: [100, 2000] },
      { param: 'imp.rate', name: 'drop.rate', range: [0.5, 100] },
      { param: 'gain.volume', name: 'drop.amplitude', range: [0, 2] },
      { param: 'env.decay', name: 'drop.decay', range: [0.01, 0.5] },
    ],
  };
}
