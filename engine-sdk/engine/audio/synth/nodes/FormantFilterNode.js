// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * FormantFilterNode.js — Formant Filter for Vocal/Creature Sounds
 * 
 * Parallel bank of bandpass filters tuned to vocal formant frequencies.
 * Shapes any input signal into vowel-like resonances. Useful for:
 *   - Creature vocalizations
 *   - Vocal pads and textures
 *   - Talking/singing synthesis
 *   - Resonant environmental effects
 *
 * Includes presets for standard vowels (A, E, I, O, U) and creature sounds.
 *
 * Usage:
 *   import { createFormantFilter, setFormantVowel, destroyFormantFilter } from './FormantFilterNode.js';
 *   const filter = createFormantFilter(audioCtx);
 *   sourceNode.connect(filter.input);
 *   filter.output.connect(audioCtx.destination);
 *   setFormantVowel(filter, 'A');
 */

// ============================================================================
// VOWEL FORMANT DATA
// ============================================================================

// Formant frequencies (F1-F5) and bandwidths for standard vowels
// Source: Klatt (1980) and Peterson & Barney (1952)
export const FORMANT_PRESETS = {
    // Human vowels
    A:     { formants: [800, 1150, 2900, 3900, 4950], bandwidths: [80, 90, 120, 130, 140], gains: [1.0, 0.63, 0.1, 0.01, 0.001] },
    E:     { formants: [400, 1600, 2700, 3300, 4950], bandwidths: [60, 80, 120, 150, 200], gains: [1.0, 0.2, 0.1, 0.02, 0.001] },
    I:     { formants: [350, 2000, 2800, 3600, 4950], bandwidths: [50, 100, 120, 150, 200], gains: [1.0, 0.1, 0.05, 0.02, 0.001] },
    O:     { formants: [450, 800, 2830, 3800, 4950],  bandwidths: [70, 80, 100, 130, 135], gains: [1.0, 0.35, 0.15, 0.02, 0.001] },
    U:     { formants: [325, 700, 2530, 3500, 4950],  bandwidths: [50, 60, 100, 130, 135], gains: [1.0, 0.25, 0.06, 0.02, 0.001] },

    // Creature/special
    growl: { formants: [200, 600, 1500, 2500, 3500],  bandwidths: [120, 150, 200, 200, 250], gains: [1.0, 0.7, 0.3, 0.1, 0.05] },
    hiss:  { formants: [2500, 4000, 6000, 8000, 10000], bandwidths: [300, 400, 500, 600, 800], gains: [0.5, 0.8, 1.0, 0.6, 0.3] },
    roar:  { formants: [300, 800, 1200, 2000, 3000],  bandwidths: [100, 120, 180, 200, 250], gains: [1.0, 0.8, 0.5, 0.3, 0.1] },
    alien: { formants: [150, 1200, 3500, 5000, 7000], bandwidths: [40, 60, 100, 150, 200], gains: [1.0, 0.5, 0.3, 0.2, 0.1] },
    ghost: { formants: [500, 1500, 3000, 4500, 6500], bandwidths: [200, 250, 300, 350, 400], gains: [0.8, 0.5, 0.3, 0.15, 0.05] },
};

// ============================================================================
// FORMANT FILTER ENGINE
// ============================================================================

/**
 * Create a formant filter bank.
 * @param {AudioContext} ctx
 * @param {Object} config
 * @param {string} config.vowel - Initial vowel preset name (default 'A')
 * @param {number} config.formantCount - Number of formants to use 1-5 (default 5)
 * @param {number} config.morphTime - Time to morph between vowels in seconds (default 0.1)
 * @returns {Object} Formant filter instance
 */
export function createFormantFilter(ctx, config = {}) {
    const formantCount = Math.min(5, Math.max(1, config.formantCount ?? 5));
    const morphTime = config.morphTime ?? 0.1;

    // Input and output gain nodes
    const input = ctx.createGain();
    input.gain.value = 1.0;
    const output = ctx.createGain();
    output.gain.value = config.volume ?? 1.0;

    // Create parallel bandpass filters
    const filters = [];
    const filterGains = [];
    for (let i = 0; i < formantCount; i++) {
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 440;
        bp.Q.value = 5;

        const g = ctx.createGain();
        g.gain.value = 0;

        input.connect(bp);
        bp.connect(g);
        g.connect(output);

        filters.push(bp);
        filterGains.push(g);
    }

    const instance = {
        ctx,
        input,
        output,
        filters,
        filterGains,
        formantCount,
        morphTime,
        currentVowel: null,
    };

    // Set initial vowel
    setFormantVowel(instance, config.vowel || 'A');

    return instance;
}

/**
 * Set the formant filter to a vowel preset.
 * @param {Object} instance
 * @param {string} vowelName - Key from FORMANT_PRESETS
 */
export function setFormantVowel(instance, vowelName) {
    const preset = FORMANT_PRESETS[vowelName];
    if (!preset) return;

    const t = instance.ctx.currentTime;
    const morph = instance.morphTime;

    for (let i = 0; i < instance.formantCount; i++) {
        const freq = preset.formants[i] || 440;
        const bw = preset.bandwidths[i] || 100;
        const gain = preset.gains[i] || 0;

        // Q = frequency / bandwidth
        const Q = freq / Math.max(1, bw);

        instance.filters[i].frequency.setTargetAtTime(freq, t, morph * 0.3);
        instance.filters[i].Q.setTargetAtTime(Q, t, morph * 0.3);
        instance.filterGains[i].gain.setTargetAtTime(gain, t, morph * 0.3);
    }

    instance.currentVowel = vowelName;
}

/**
 * Set formant frequencies directly (bypass presets).
 * @param {Object} instance
 * @param {number[]} frequencies - Array of formant frequencies
 * @param {number[]} bandwidths - Array of bandwidths
 * @param {number[]} gains - Array of gain values
 */
export function setFormantFrequencies(instance, frequencies, bandwidths, gains) {
    const t = instance.ctx.currentTime;
    const morph = instance.morphTime;

    for (let i = 0; i < instance.formantCount; i++) {
        const freq = frequencies[i] || 440;
        const bw = bandwidths[i] || 100;
        const g = gains[i] || 0;
        const Q = freq / Math.max(1, bw);

        instance.filters[i].frequency.setTargetAtTime(freq, t, morph * 0.3);
        instance.filters[i].Q.setTargetAtTime(Q, t, morph * 0.3);
        instance.filterGains[i].gain.setTargetAtTime(g, t, morph * 0.3);
    }
    instance.currentVowel = null;
}

/**
 * Morph between two vowel presets.
 * @param {Object} instance
 * @param {string} vowelA
 * @param {string} vowelB
 * @param {number} blend - 0 = fully A, 1 = fully B
 */
export function morphFormants(instance, vowelA, vowelB, blend) {
    const a = FORMANT_PRESETS[vowelA];
    const b = FORMANT_PRESETS[vowelB];
    if (!a || !b) return;

    const t = Math.max(0, Math.min(1, blend));
    const freqs = [], bws = [], gains = [];

    for (let i = 0; i < instance.formantCount; i++) {
        freqs.push(a.formants[i] * (1 - t) + b.formants[i] * t);
        bws.push(a.bandwidths[i] * (1 - t) + b.bandwidths[i] * t);
        gains.push(a.gains[i] * (1 - t) + b.gains[i] * t);
    }

    setFormantFrequencies(instance, freqs, bws, gains);
}

/**
 * Set morph time (transition speed).
 * @param {Object} instance
 * @param {number} seconds
 */
export function setFormantMorphTime(instance, seconds) {
    instance.morphTime = Math.max(0, seconds);
}

/**
 * Destroy the formant filter and release resources.
 * @param {Object} instance
 */
export function destroyFormantFilter(instance) {
    try { instance.input.disconnect(); } catch { /* */ }
    for (const f of instance.filters) {
        try { f.disconnect(); } catch { /* */ }
    }
    for (const g of instance.filterGains) {
        try { g.disconnect(); } catch { /* */ }
    }
    try { instance.output.disconnect(); } catch { /* */ }
    instance.filters = [];
    instance.filterGains = [];
}

/**
 * Get list of available formant preset names.
 * @returns {string[]}
 */
export function getFormantPresetNames() {
    return Object.keys(FORMANT_PRESETS);
}

// ============================================================================
// PATCH DESCRIPTOR
// ============================================================================

/**
 * Formant filter patch descriptor for the node graph system.
 * @param {Object} config
 * @returns {Object}
 */
let _formantPatchSequence = 0;
function _newFormantPatchId() { return `formant_${Date.now()}_${++_formantPatchSequence}`; }
export function createFormantPatch(config = {}) {
    return {
        id: _newFormantPatchId(),
        name: config.name || 'Formant Voice',
        category: 'vocal',
        nodes: [
            { id: 'noise', type: 'NoiseGenerator', params: { color: 'pink', density: 1.0 } },
            { id: 'f1', type: 'Filter', params: { type: 'bandpass', frequency: 800, Q: 10, gain: 0 } },
            { id: 'f2', type: 'Filter', params: { type: 'bandpass', frequency: 1150, Q: 12, gain: 0 } },
            { id: 'f3', type: 'Filter', params: { type: 'bandpass', frequency: 2900, Q: 24, gain: 0 } },
            { id: 'g1', type: 'Gain', params: { volume: 1.0 } },
            { id: 'g2', type: 'Gain', params: { volume: 0.63 } },
            { id: 'g3', type: 'Gain', params: { volume: 0.1 } },
            { id: 'mix', type: 'Gain', params: { volume: config.volume ?? 0.7 } },
            { id: 'out', type: 'Output' },
        ],
        wires: [
            { from: 'noise', fromPort: 'out', to: 'f1', toPort: 'in' },
            { from: 'noise', fromPort: 'out', to: 'f2', toPort: 'in' },
            { from: 'noise', fromPort: 'out', to: 'f3', toPort: 'in' },
            { from: 'f1', fromPort: 'out', to: 'g1', toPort: 'in' },
            { from: 'f2', fromPort: 'out', to: 'g2', toPort: 'in' },
            { from: 'f3', fromPort: 'out', to: 'g3', toPort: 'in' },
            { from: 'g1', fromPort: 'out', to: 'mix', toPort: 'in' },
            { from: 'g2', fromPort: 'out', to: 'mix', toPort: 'in' },
            { from: 'g3', fromPort: 'out', to: 'mix', toPort: 'in' },
            { from: 'mix', fromPort: 'out', to: 'out', toPort: 'in' },
        ],
        exposed: {
            formant1: { node: 'f1', param: 'frequency', min: 100, max: 3000, default: 800 },
            formant2: { node: 'f2', param: 'frequency', min: 200, max: 5000, default: 1150 },
            formant3: { node: 'f3', param: 'frequency', min: 500, max: 8000, default: 2900 },
            volume: { node: 'mix', param: 'volume', min: 0, max: 1, default: 0.7 },
        },
    };
}
