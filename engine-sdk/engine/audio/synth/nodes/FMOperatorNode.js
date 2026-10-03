// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * FMOperatorNode.js — FM Synthesis Engine
 * 
 * Frequency Modulation synthesis: one oscillator (modulator) modulates
 * the frequency of another (carrier), producing complex harmonic and
 * inharmonic timbres from simple parameters.
 *
 * Supports up to 4 operators in series/parallel configurations.
 * Each operator has: frequency ratio, detune, envelope, feedback.
 *
 * Usage:
 *   import { renderFM, playFM, createFMPatch } from './FMOperatorNode.js';
 *   const buffer = renderFM(audioCtx, { carrierFreq: 440, modRatio: 2, modDepth: 200 });
 */

// ============================================================================
// FM PRESETS
// ============================================================================

export const FM_PRESETS = {
    bell: {
        carrierFreq: 440, modRatio: 3.5, modDepth: 600,
        attack: 0.001, decay: 0.1, sustain: 0.3, release: 2.0,
        modAttack: 0.001, modDecay: 0.5, modSustain: 0, modRelease: 0.5,
        duration: 3.0, volume: 0.6,
    },
    electricPiano: {
        carrierFreq: 262, modRatio: 1.0, modDepth: 150,
        attack: 0.002, decay: 0.3, sustain: 0.5, release: 0.8,
        modAttack: 0.001, modDecay: 0.5, modSustain: 0.2, modRelease: 0.3,
        duration: 2.0, volume: 0.7,
    },
    metallic: {
        carrierFreq: 180, modRatio: 7.0, modDepth: 1000,
        attack: 0.001, decay: 0.05, sustain: 0.1, release: 1.5,
        modAttack: 0.001, modDecay: 0.3, modSustain: 0.05, modRelease: 0.5,
        duration: 2.5, volume: 0.5,
    },
    bass: {
        carrierFreq: 55, modRatio: 1.0, modDepth: 80,
        attack: 0.005, decay: 0.2, sustain: 0.6, release: 0.3,
        modAttack: 0.001, modDecay: 0.15, modSustain: 0.3, modRelease: 0.2,
        duration: 1.5, volume: 0.8,
    },
    pluck: {
        carrierFreq: 330, modRatio: 2.0, modDepth: 300,
        attack: 0.001, decay: 0.08, sustain: 0, release: 0.6,
        modAttack: 0.001, modDecay: 0.1, modSustain: 0, modRelease: 0.3,
        duration: 1.0, volume: 0.7,
    },
    organ: {
        carrierFreq: 262, modRatio: 2.0, modDepth: 50,
        attack: 0.01, decay: 0.05, sustain: 0.9, release: 0.1,
        modAttack: 0.01, modDecay: 0.05, modSustain: 0.8, modRelease: 0.1,
        duration: 2.0, volume: 0.6,
    },
    laser: {
        carrierFreq: 800, modRatio: 1.5, modDepth: 2000,
        attack: 0.001, decay: 0.02, sustain: 0, release: 0.3,
        modAttack: 0.001, modDecay: 0.05, modSustain: 0, modRelease: 0.1,
        duration: 0.5, volume: 0.5,
    },
    crystal: {
        carrierFreq: 880, modRatio: 4.0, modDepth: 400,
        attack: 0.001, decay: 0.15, sustain: 0.1, release: 3.0,
        modAttack: 0.001, modDecay: 1.0, modSustain: 0, modRelease: 1.0,
        duration: 4.0, volume: 0.4,
    },
};

// ============================================================================
// RENDER (offline → AudioBuffer)
// ============================================================================

/**
 * Render 2-operator FM synthesis to an AudioBuffer.
 * @param {AudioContext} ctx
 * @param {Object} config
 * @returns {AudioBuffer}
 */
export function renderFM(ctx, config = {}) {
    const sampleRate = ctx.sampleRate;
    const carrierFreq = config.carrierFreq ?? 440;
    const modRatio = config.modRatio ?? 2.0;
    const modDepth = config.modDepth ?? 200;      // modulation index in Hz
    const volume = config.volume ?? 0.7;
    const duration = config.duration ?? 1.5;

    // Carrier envelope (ADSR)
    const cAttack = config.attack ?? 0.005;
    const cDecay = config.decay ?? 0.2;
    const cSustain = config.sustain ?? 0.5;
    const cRelease = config.release ?? 0.5;

    // Modulator envelope
    const mAttack = config.modAttack ?? 0.001;
    const mDecay = config.modDecay ?? 0.3;
    const mSustain = config.modSustain ?? 0.2;
    const mRelease = config.modRelease ?? 0.3;

    // Feedback (operator self-modulation)
    const feedback = config.feedback ?? 0;

    const totalSamples = Math.ceil(duration * sampleRate);
    const output = new Float32Array(totalSamples);

    const modFreq = carrierFreq * modRatio;
    let carrierPhase = 0;
    let modPhase = 0;
    let fbSample = 0;

    // Gate time = total - release
    const gateTime = Math.max(0, duration - cRelease);

    for (let i = 0; i < totalSamples; i++) {
        const t = i / sampleRate;

        // Carrier ADSR
        const cEnv = _adsr(t, cAttack, cDecay, cSustain, cRelease, gateTime);

        // Modulator ADSR
        const mEnv = _adsr(t, mAttack, mDecay, mSustain, mRelease, gateTime);

        // Modulator
        const mod = Math.sin(modPhase + feedback * fbSample) * modDepth * mEnv;
        modPhase += 2 * Math.PI * modFreq / sampleRate;

        // Carrier (frequency modulated by modulator)
        const carrierSample = Math.sin(carrierPhase) * cEnv * volume;
        carrierPhase += 2 * Math.PI * (carrierFreq + mod) / sampleRate;

        fbSample = carrierSample;
        output[i] = Math.max(-1, Math.min(1, carrierSample));
    }

    const audioBuffer = ctx.createBuffer(1, totalSamples, sampleRate);
    audioBuffer.getChannelData(0).set(output);
    return audioBuffer;
}

function _adsr(t, attack, decay, sustain, release, gateTime) {
    if (t < 0) return 0;
    if (t < attack) return t / attack;
    if (t < attack + decay) return 1.0 - (1.0 - sustain) * ((t - attack) / decay);
    if (t < gateTime) return sustain;
    const releaseTime = t - gateTime;
    if (releaseTime < release) return sustain * (1.0 - releaseTime / release);
    return 0;
}

/**
 * Render a 4-operator FM stack.
 * Operators are chained: op4 → op3 → op2 → op1 (carrier).
 * @param {AudioContext} ctx
 * @param {Object} config
 * @param {Object[]} config.operators - Array of 4 operator configs
 * @returns {AudioBuffer}
 */
export function renderFM4(ctx, config = {}) {
    const sampleRate = ctx.sampleRate;
    const baseFreq = config.baseFreq ?? 440;
    const volume = config.volume ?? 0.7;
    const duration = config.duration ?? 2.0;
    const gateTime = Math.max(0, duration - (config.release ?? 0.5));

    const ops = config.operators || [
        { ratio: 1, depth: 0, attack: 0.005, decay: 0.2, sustain: 0.5, release: 0.5, feedback: 0 },
        { ratio: 2, depth: 200, attack: 0.001, decay: 0.3, sustain: 0.2, release: 0.3, feedback: 0 },
        { ratio: 3, depth: 100, attack: 0.001, decay: 0.2, sustain: 0.1, release: 0.2, feedback: 0 },
        { ratio: 4, depth: 50, attack: 0.001, decay: 0.1, sustain: 0, release: 0.1, feedback: 0 },
    ];

    const totalSamples = Math.ceil(duration * sampleRate);
    const output = new Float32Array(totalSamples);
    const phases = [0, 0, 0, 0];
    const fbSamples = [0, 0, 0, 0];

    for (let i = 0; i < totalSamples; i++) {
        const t = i / sampleRate;

        // Process operators in reverse (modulators first)
        let modInput = 0;
        for (let o = ops.length - 1; o >= 0; o--) {
            const op = ops[o];
            const freq = baseFreq * (op.ratio ?? 1);
            const env = _adsr(t, op.attack ?? 0.001, op.decay ?? 0.2, op.sustain ?? 0.5, op.release ?? 0.5, gateTime);

            const sample = Math.sin(phases[o] + (op.feedback ?? 0) * fbSamples[o] + modInput);
            phases[o] += 2 * Math.PI * freq / sampleRate;

            fbSamples[o] = sample;

            if (o === 0) {
                // Carrier — output
                output[i] = Math.max(-1, Math.min(1, sample * env * volume));
            } else {
                // Modulator — becomes input for next operator
                modInput = sample * (op.depth ?? 200) * env * (2 * Math.PI / sampleRate);
            }
        }
    }

    const audioBuffer = ctx.createBuffer(1, totalSamples, sampleRate);
    audioBuffer.getChannelData(0).set(output);
    return audioBuffer;
}

/**
 * Play FM synthesis directly.
 * @param {AudioContext} ctx
 * @param {Object} config
 * @param {AudioNode} destination
 * @returns {AudioBufferSourceNode}
 */
export function playFM(ctx, config = {}, destination = null) {
    const buffer = renderFM(ctx, config);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(destination || ctx.destination);
    source.start(0);
    return source;
}

/**
 * Get list of FM preset names.
 * @returns {string[]}
 */
export function getFMPresetNames() {
    return Object.keys(FM_PRESETS);
}

// ============================================================================
// PATCH DESCRIPTOR
// ============================================================================

/**
 * FM synthesis patch descriptor for the node graph system.
 * @param {Object} config
 * @returns {Object}
 */
let _fmPatchSequence = 0;
function _newFmPatchId() { return `fm_${Date.now()}_${++_fmPatchSequence}`; }
export function createFMPatch(config = {}) {
    return {
        id: _newFmPatchId(),
        name: config.name || 'FM Synth',
        category: 'synthesis',
        nodes: [
            { id: 'mod', type: 'Oscillator', params: {
                frequency: (config.carrierFreq ?? 440) * (config.modRatio ?? 2),
                shape: 'sine',
            }},
            { id: 'modGain', type: 'Gain', params: { volume: config.modDepth ?? 200 } },
            { id: 'modEnv', type: 'Envelope', params: {
                attack: config.modAttack ?? 0.001,
                decay: config.modDecay ?? 0.3,
                sustain: config.modSustain ?? 0.2,
                release: config.modRelease ?? 0.3,
            }},
            { id: 'carrier', type: 'Oscillator', params: {
                frequency: config.carrierFreq ?? 440,
                shape: 'sine',
            }},
            { id: 'carrierEnv', type: 'Envelope', params: {
                attack: config.attack ?? 0.005,
                decay: config.decay ?? 0.2,
                sustain: config.sustain ?? 0.5,
                release: config.release ?? 0.5,
            }},
            { id: 'vol', type: 'Gain', params: { volume: config.volume ?? 0.7 } },
            { id: 'out', type: 'Output' },
        ],
        wires: [
            { from: 'mod', fromPort: 'out', to: 'modGain', toPort: 'in' },
            { from: 'modEnv', fromPort: 'out', to: 'modGain', toPort: 'in' },
            { from: 'carrier', fromPort: 'out', to: 'vol', toPort: 'in' },
            { from: 'carrierEnv', fromPort: 'out', to: 'vol', toPort: 'in' },
            { from: 'vol', fromPort: 'out', to: 'out', toPort: 'in' },
        ],
        exposed: {
            carrierFreq: { node: 'carrier', param: 'frequency', min: 20, max: 8000, default: 440 },
            modRatio: { label: 'Mod Ratio', min: 0.1, max: 16, default: 2 },
            modDepth: { node: 'modGain', param: 'volume', min: 0, max: 5000, default: 200 },
            volume: { node: 'vol', param: 'volume', min: 0, max: 1, default: 0.7 },
        },
    };
}
