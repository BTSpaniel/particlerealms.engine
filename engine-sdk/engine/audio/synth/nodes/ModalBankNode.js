// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ModalBankNode.js — Modal Synthesis Engine
 * 
 * Physical modeling using parallel resonant filters (modes).
 * Each mode has frequency, amplitude, and decay characteristics.
 *
 * Material presets auto-calculate modes based on:
 * - Stiff string formula (metal, piano strings)
 * - Beam formula (wood, glass bars)
 * - Circular membrane formula (drums)
 * - Rectangular plate formula (bells, gongs)
 *
 * Usage:
 *   import { createModalBank, MODAL_MATERIALS } from './ModalBankNode.js';
 *   const bank = createModalBank(audioCtx, { material: 'metal', frequency: 440 });
 *   bank.excite(impulseBuffer);
 */

// ============================================================================
// MATERIAL PRESETS
// ============================================================================

export const MODAL_MATERIALS = {
  metal: {
    name: 'Metal',
    inharmonicity: 0.001,
    damping: 0.85,
    highDamp: 0.25,
    brightness: 0.75,
    modeFormula: 'stiffString',
    description: 'Metallic bars, chimes, bells',
  },
  glass: {
    name: 'Glass',
    inharmonicity: 0.04,
    damping: 0.6,
    highDamp: 0.5,
    brightness: 0.9,
    modeFormula: 'beam',
    description: 'Glass, crystal, ceramic',
  },
  wood: {
    name: 'Wood',
    inharmonicity: 0.12,
    damping: 0.35,
    highDamp: 0.65,
    brightness: 0.45,
    modeFormula: 'beam',
    description: 'Wooden bars, marimba, xylophones',
  },
  ceramic: {
    name: 'Ceramic',
    inharmonicity: 0.06,
    damping: 0.5,
    highDamp: 0.55,
    brightness: 0.6,
    modeFormula: 'beam',
    description: 'Pottery, tiles, bricks',
  },
  plastic: {
    name: 'Plastic',
    inharmonicity: 0.15,
    damping: 0.3,
    highDamp: 0.7,
    brightness: 0.35,
    modeFormula: 'beam',
    description: 'Plastic containers, toys',
  },
  membrane: {
    name: 'Membrane',
    inharmonicity: 0.4,
    damping: 0.45,
    highDamp: 0.5,
    brightness: 0.4,
    modeFormula: 'circularMembrane',
    description: 'Drums, stretched skins',
  },
  string: {
    name: 'String',
    inharmonicity: 0.0005,
    damping: 0.9,
    highDamp: 0.2,
    brightness: 0.6,
    modeFormula: 'stiffString',
    description: 'Piano strings, guitar strings',
  },
  bell: {
    name: 'Bell',
    inharmonicity: 0.08,
    damping: 0.75,
    highDamp: 0.35,
    brightness: 0.8,
    modeFormula: 'plate',
    description: 'Church bells, gongs, cymbals',
  },
};

// Bessel function zeros for circular membrane modes (0,n)
const BESSEL_ZEROS = [
  2.4048, 5.5201, 8.6537, 11.7915, 14.9309,
  18.0711, 21.2116, 24.3525, 27.4935, 30.6346,
  33.7758, 36.9171, 40.0584, 43.1998, 46.3412,
  49.4826, 52.6241, 55.7655, 58.9070, 62.0485,
];

// ============================================================================
// MODE CALCULATION
// ============================================================================

/**
 * Calculate modal frequencies based on material formula.
 * @param {string} formula - 'stiffString', 'beam', 'circularMembrane', 'plate'
 * @param {number} f0 - Fundamental frequency
 * @param {number} modeCount - Number of modes to generate
 * @param {number} inharmonicity - Stretch factor B
 * @returns {number[]} Array of mode frequencies
 */
export function calculateModeFrequencies(formula, f0, modeCount, inharmonicity = 0) {
  const frequencies = [];
  const B = Math.max(0, inharmonicity);

  switch (formula) {
    case 'stiffString':
      // f_k = f0 * k * sqrt(1 + B * k^2)
      for (let k = 1; k <= modeCount; k++) {
        frequencies.push(f0 * k * Math.sqrt(1 + B * k * k));
      }
      break;

    case 'beam':
      // Euler-Bernoulli beam: f_k ∝ k^2 with stiffness correction
      // Ratios: 1, 2.76, 5.4, 8.93, 13.34, ...
      const beamRatios = [1, 2.756, 5.404, 8.933, 13.344, 18.636, 24.809, 31.864, 39.800, 48.617];
      for (let k = 0; k < modeCount; k++) {
        const ratio = k < beamRatios.length ? beamRatios[k] : beamRatios[beamRatios.length - 1] * Math.pow((k + 1) / beamRatios.length, 2);
        frequencies.push(f0 * ratio * Math.sqrt(1 + B * (k + 1) * (k + 1)));
      }
      break;

    case 'circularMembrane':
      // f_k = f0 * besselZero[k] / besselZero[0]
      for (let k = 0; k < modeCount && k < BESSEL_ZEROS.length; k++) {
        frequencies.push(f0 * BESSEL_ZEROS[k] / BESSEL_ZEROS[0]);
      }
      break;

    case 'plate':
      // Rectangular plate: f_mn ∝ sqrt(m^2 + n^2)
      // Simplified: use diagonal mode sequence
      const plateRatios = [1, 1.58, 2.0, 2.24, 2.55, 2.83, 3.0, 3.16, 3.32, 3.46, 3.61, 3.74];
      for (let k = 0; k < modeCount; k++) {
        const ratio = k < plateRatios.length ? plateRatios[k] : Math.sqrt(k + 1) * 1.1;
        frequencies.push(f0 * ratio * Math.sqrt(1 + B * (k + 1)));
      }
      break;

    default:
      // Harmonic series fallback
      for (let k = 1; k <= modeCount; k++) {
        frequencies.push(f0 * k);
      }
  }

  return frequencies;
}

/**
 * Calculate mode amplitudes based on strike position.
 * @param {number} modeCount - Number of modes
 * @param {number} strikePosition - 0-1 position along resonator
 * @param {number} brightness - Spectral tilt 0-1
 * @returns {number[]} Array of mode amplitudes
 */
export function calculateModeAmplitudes(modeCount, strikePosition, brightness = 0.5) {
  const amplitudes = [];
  const x = Math.max(0.01, Math.min(0.99, strikePosition));

  for (let k = 1; k <= modeCount; k++) {
    // Strike position affects which modes are excited
    // sin(π * k * x) - zero at nodes, max at antinodes
    const positionFactor = Math.abs(Math.sin(Math.PI * k * x));

    // Spectral tilt: brightness controls high-frequency rolloff
    // brightness=1: flat, brightness=0: -6dB/oct
    const tiltFactor = Math.pow(1 / k, 1 - brightness);

    // Blue noise compensation (higher modes radiate better)
    const radiationFactor = Math.min(1, Math.sqrt(k) * 0.5);

    amplitudes.push(positionFactor * tiltFactor * radiationFactor);
  }

  // Normalize
  const maxAmp = Math.max(...amplitudes, 0.001);
  return amplitudes.map(a => a / maxAmp);
}

/**
 * Calculate mode decay times based on frequency and damping.
 * @param {number[]} frequencies - Mode frequencies
 * @param {number} baseDamping - Base decay time (0-1, higher = longer)
 * @param {number} highDamp - High-frequency damping (0-1, higher = more damping)
 * @param {number} f0 - Reference frequency for scaling
 * @returns {number[]} Array of decay times in seconds
 */
export function calculateModeDecays(frequencies, baseDamping, highDamp, f0) {
  const decays = [];
  const baseDecay = 0.1 + baseDamping * 4.9; // 0.1 to 5 seconds

  for (const freq of frequencies) {
    // Frequency-dependent decay: R = b1 + b3 * f^2
    const freqRatio = freq / f0;
    const freqDamping = 1 + highDamp * Math.pow(freqRatio - 1, 2) * 0.5;
    const decay = baseDecay / freqDamping;
    decays.push(Math.max(0.01, decay));
  }

  return decays;
}

// ============================================================================
// MODAL BANK ENGINE
// ============================================================================

/**
 * Create a modal bank synthesis engine.
 * @param {AudioContext} ctx
 * @param {Object} config
 * @returns {Object} Modal bank instance
 */
export function createModalBank(ctx, config = {}) {
  const material = config.material ?? 'metal';
  const frequency = config.frequency ?? 440;
  const modeCount = Math.max(2, Math.min(64, config.modeCount ?? 12));
  const customInharmonicity = config.inharmonicity;
  const customDamping = config.damping;
  const customHighDamp = config.highDamp;
  const customBrightness = config.brightness;
  const strikePosition = config.strikePosition ?? 0.5;
  const size = config.size ?? 1.0;
  const customModes = config.modes;

  // Get material preset or use defaults
  const preset = MODAL_MATERIALS[material] || MODAL_MATERIALS.metal;

  // Use custom values or preset defaults
  const inharmonicity = customInharmonicity ?? preset.inharmonicity;
  const damping = customDamping ?? preset.damping;
  const highDamp = customHighDamp ?? preset.highDamp;
  const brightness = customBrightness ?? preset.brightness;

  // Scale frequency by size (larger = lower pitch)
  const scaledFreq = frequency / size;

  // Calculate or use custom modes
  let modes;
  if (Array.isArray(customModes) && customModes.length > 0) {
    modes = customModes;
  } else {
    const frequencies = calculateModeFrequencies(preset.modeFormula, scaledFreq, modeCount, inharmonicity);
    const amplitudes = calculateModeAmplitudes(modeCount, strikePosition, brightness);
    const decays = calculateModeDecays(frequencies, damping, highDamp, scaledFreq);

    modes = frequencies.map((freq, i) => ({
      frequency: freq,
      amplitude: amplitudes[i],
      decay: decays[i],
    }));
  }

  // Create resonator filters
  const output = ctx.createGain();
  output.gain.value = 1.0;

  const filters = [];
  const gains = [];

  for (const mode of modes) {
    // Bandpass filter as resonator
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = Math.min(mode.frequency, ctx.sampleRate / 2 - 100);
    // Q determines resonance/decay relationship
    // Higher Q = longer ring, narrower bandwidth
    filter.Q.value = Math.max(1, mode.frequency * mode.decay * 0.5);

    const gain = ctx.createGain();
    gain.gain.value = mode.amplitude;

    filter.connect(gain);
    gain.connect(output);

    filters.push(filter);
    gains.push(gain);
  }

  return {
    ctx,
    output,
    modes,
    filters,
    gains,
    config: { material, frequency, modeCount, inharmonicity, damping, highDamp, brightness, strikePosition, size },

    /**
     * Connect excitation input to all resonators.
     * @param {AudioNode} source - Excitation source
     */
    connectExcitation(source) {
      for (const filter of filters) {
        source.connect(filter);
      }
    },

    /**
     * Excite the modal bank with an impulse buffer.
     * @param {AudioBuffer} buffer - Impulse/excitation buffer
     * @param {number} when - Start time
     */
    excite(buffer, when = 0) {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      for (const filter of filters) {
        source.connect(filter);
      }
      source.start(when);
    },

    /**
     * Update strike position (affects mode amplitudes).
     * @param {number} position - 0-1
     */
    setStrikePosition(position) {
      const amplitudes = calculateModeAmplitudes(modes.length, position, brightness);
      for (let i = 0; i < gains.length; i++) {
        gains[i].gain.value = amplitudes[i];
      }
    },

    /**
     * Transpose all modes.
     * @param {number} ratio - Frequency multiplier
     */
    transpose(ratio) {
      for (let i = 0; i < filters.length; i++) {
        filters[i].frequency.value = Math.min(modes[i].frequency * ratio, ctx.sampleRate / 2 - 100);
      }
    },

    /**
     * Disconnect and cleanup.
     */
    destroy() {
      for (const filter of filters) {
        filter.disconnect();
      }
      for (const gain of gains) {
        gain.disconnect();
      }
      output.disconnect();
    },
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

export const MATERIAL_OPTIONS = Object.keys(MODAL_MATERIALS);

export function isValidMaterial(material) {
  return material in MODAL_MATERIALS;
}
