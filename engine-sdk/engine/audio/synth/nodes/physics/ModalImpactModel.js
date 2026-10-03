// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ModalImpactModel.js - Material-Aware Impact Synthesis
 * 
 * Excites a bank of resonators on collision. Material properties
 * determine mode frequencies, Q factors, and decay times.
 * Uses MATERIAL enum from SubstanceSchema for lookup.
 * 
 * Based on Cook/Smith modal synthesis (Stanford CCRMA).
 */

// ============================================================================
// MATERIAL MODAL PRESETS
// ============================================================================

// Each preset: array of { freq, gain, Q } — up to 6 modes
const MODAL_PRESETS = {
  metal: {
    modes: [
      { freq: 800, gain: 1.0, Q: 200 },
      { freq: 1600, gain: 0.7, Q: 180 },
      { freq: 3200, gain: 0.4, Q: 150 },
      { freq: 5000, gain: 0.2, Q: 120 },
      { freq: 7500, gain: 0.1, Q: 100 },
    ],
    decay: 1.5,
    brightness: 0.8,
  },
  glass: {
    modes: [
      { freq: 2000, gain: 1.0, Q: 300 },
      { freq: 4500, gain: 0.6, Q: 250 },
      { freq: 7000, gain: 0.3, Q: 200 },
      { freq: 10000, gain: 0.15, Q: 150 },
    ],
    decay: 0.8,
    brightness: 1.0,
  },
  wood: {
    modes: [
      { freq: 200, gain: 1.0, Q: 30 },
      { freq: 500, gain: 0.6, Q: 25 },
      { freq: 1200, gain: 0.3, Q: 20 },
      { freq: 2500, gain: 0.15, Q: 15 },
    ],
    decay: 0.3,
    brightness: 0.4,
  },
  stone: {
    modes: [
      { freq: 150, gain: 1.0, Q: 15 },
      { freq: 400, gain: 0.5, Q: 12 },
      { freq: 800, gain: 0.3, Q: 10 },
      { freq: 1500, gain: 0.1, Q: 8 },
    ],
    decay: 0.2,
    brightness: 0.3,
  },
  ice: {
    modes: [
      { freq: 1000, gain: 1.0, Q: 100 },
      { freq: 2500, gain: 0.5, Q: 80 },
      { freq: 5000, gain: 0.25, Q: 60 },
      { freq: 8000, gain: 0.1, Q: 40 },
    ],
    decay: 0.5,
    brightness: 0.9,
  },
  ceramic: {
    modes: [
      { freq: 600, gain: 1.0, Q: 60 },
      { freq: 1500, gain: 0.5, Q: 50 },
      { freq: 3000, gain: 0.3, Q: 40 },
      { freq: 5500, gain: 0.1, Q: 30 },
    ],
    decay: 0.4,
    brightness: 0.6,
  },
};

/**
 * Get modal preset for a material.
 * @param {string} material
 * @returns {Object}
 */
export function getModalPreset(material) {
  return MODAL_PRESETS[material] || MODAL_PRESETS.stone;
}

/**
 * Get all available material names.
 * @returns {string[]}
 */
export function getModalMaterials() {
  return Object.keys(MODAL_PRESETS);
}

/**
 * Generate a ModalImpact patch descriptor for a given material.
 * @param {Object} config
 * @param {string} config.material - 'metal'|'glass'|'wood'|'stone'|'ice'|'ceramic'
 * @param {number} config.pitchScale - Scale all mode frequencies (default 1.0)
 * @param {number} config.volume - Output volume (default 0.8)
 * @returns {Object} Patch JSON
 */
export function createModalImpactPatch(config = {}) {
  const material = config.material || 'metal';
  const preset = MODAL_PRESETS[material] || MODAL_PRESETS.stone;
  const pitchScale = config.pitchScale ?? 1.0;
  const volume = config.volume ?? 0.8;

  // Build a patch with parallel resonators excited by a single impulse
  const nodes = [
    { id: 'imp', type: 'Impulse', params: { rate: 0.1, jitter: 0, shape: 1.0 } },
    { id: 'env', type: 'Envelope', params: { attack: 0.0005, decay: preset.decay, sustain: 0, release: 0.01 } },
  ];

  const wires = [
    { from: 'imp:out', to: 'env:gate' },
  ];

  // Add a bandpass resonator for each mode
  for (let i = 0; i < preset.modes.length; i++) {
    const mode = preset.modes[i];
    const modeId = `mode${i}`;
    const modeGainId = `mg${i}`;

    nodes.push({
      id: modeId,
      type: 'Filter',
      params: { type: 'bandpass', frequency: mode.freq * pitchScale, Q: mode.Q },
    });
    nodes.push({
      id: modeGainId,
      type: 'Gain',
      params: { volume: mode.gain },
    });

    // Impulse → resonator → mode gain
    wires.push({ from: 'imp:out', to: `${modeId}:in` });
    wires.push({ from: `${modeId}:out`, to: `${modeGainId}:in` });
  }

  // Sum all modes via a chain of MathOp adds
  let lastSumId = `mg0`;
  for (let i = 1; i < preset.modes.length; i++) {
    const sumId = `sum${i}`;
    nodes.push({
      id: sumId,
      type: 'MathOp',
      params: { operation: 'add' },
    });
    wires.push({ from: `${lastSumId}:out`, to: `${sumId}:a` });
    wires.push({ from: `mg${i}:out`, to: `${sumId}:b` });
    lastSumId = sumId;
  }

  // Apply envelope and output gain
  const mulId = 'envMul';
  nodes.push({ id: mulId, type: 'MathOp', params: { operation: 'mul' } });
  wires.push({ from: `${lastSumId}:out`, to: `${mulId}:a` });
  wires.push({ from: 'env:out', to: `${mulId}:b` });

  nodes.push({ id: 'outGain', type: 'Gain', params: { volume } });
  wires.push({ from: `${mulId}:out`, to: 'outGain:in' });

  nodes.push({ id: 'out', type: 'Output' });
  wires.push({ from: 'outGain:out', to: 'out:in' });

  return {
    id: `modal_impact_${material}`,
    name: `Modal Impact (${material})`,
    nodes,
    wires,
    exposed: [
      { param: 'imp.rate', name: 'impact.triggerRate', range: [0, 20] },
      { param: 'outGain.volume', name: 'impact.volume', range: [0, 2] },
    ],
  };
}
