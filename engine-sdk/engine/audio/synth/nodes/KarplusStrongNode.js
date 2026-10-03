// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { uniformDistribution } from '../../../core/math/MathRandom.js';

/**
 * KarplusStrongNode.js — Karplus-Strong Plucked String Synthesis
 * 
 * Physical modeling of vibrating strings using a delay line with
 * lowpass-filtered feedback. Produces realistic plucked string,
 * metallic ping, and resonant percussion sounds.
 *
 * Parameters: frequency, decay, brightness, excitation type,
 *             damping, stretch factor.
 *
 * Usage:
 *   import { renderKarplusStrong, createKarplusStrongPatch } from './KarplusStrongNode.js';
 *   const buffer = renderKarplusStrong(audioCtx, { frequency: 440, decay: 2.0 });
 */

// ============================================================================
// RENDER (offline → AudioBuffer)
// ============================================================================

/**
 * Render a Karplus-Strong plucked string to an AudioBuffer.
 * @param {AudioContext} ctx
 * @param {Object} config
 * @param {number} config.frequency - Pitch in Hz (default 220)
 * @param {number} config.decay - Decay time in seconds (default 2.0)
 * @param {number} config.brightness - LP filter amount 0-1 (1=bright, 0=dark) (default 0.5)
 * @param {string} config.excitation - 'noise'|'impulse'|'sine' (default 'noise')
 * @param {number} config.stretch - Allpass stretch factor 0-1 (default 0)
 * @param {number} config.volume - Output volume 0-1 (default 0.8)
 * @param {number} config.duration - Max render duration in seconds (default decay*1.5)
 * @returns {AudioBuffer}
 */
export function renderKarplusStrong(ctx, config = {}) {
    const sampleRate = ctx.sampleRate;
    const freq = config.frequency ?? 220;
    const decay = config.decay ?? 2.0;
    const brightness = config.brightness ?? 0.5;
    const excitation = config.excitation ?? 'noise';
    const stretch = config.stretch ?? 0;
    const volume = config.volume ?? 0.8;
    const duration = config.duration ?? Math.max(0.5, decay * 1.5);

    const totalSamples = Math.ceil(duration * sampleRate);
    const delayLength = Math.max(2, Math.round(sampleRate / freq));

    // Delay line (circular buffer)
    const delayLine = new Float32Array(delayLength);

    // Fill delay line with excitation
    switch (excitation) {
        case 'impulse':
            delayLine[0] = 1.0;
            break;
        case 'sine':
            for (let i = 0; i < delayLength; i++) {
                delayLine[i] = Math.sin(2 * Math.PI * i / delayLength);
            }
            break;
        case 'noise':
        default:
            for (let i = 0; i < delayLength; i++) {
                delayLine[i] = uniformDistribution(-1, 1, Math.random);
            }
            break;
    }

    // LP filter coefficient from brightness
    // brightness=1 → coeff=0 (no filtering, bright)
    // brightness=0 → coeff=0.5 (heavy filtering, dark)
    const lpCoeff = (1.0 - brightness) * 0.5;

    // Decay factor per sample
    // We want amplitude to drop to ~0.001 in `decay` seconds
    const decayFactor = Math.pow(0.001, 1.0 / (decay * sampleRate));

    // Allpass coefficient for fractional delay / stretch
    const allpassCoeff = stretch * 0.5;

    const output = new Float32Array(totalSamples);
    let readPos = 0;
    let prevSample = 0;
    let allpassPrev = 0;

    for (let i = 0; i < totalSamples; i++) {
        // Read from delay line
        const current = delayLine[readPos];

        // Average filter (basic Karplus-Strong)
        // Blend between current and previous for lowpass
        let filtered = current * (1.0 - lpCoeff) + prevSample * lpCoeff;

        // Allpass for stretch tuning
        if (allpassCoeff > 0) {
            const allpassOut = allpassCoeff * filtered + allpassPrev - allpassCoeff * filtered;
            allpassPrev = filtered;
            filtered = allpassOut;
        }

        // Apply decay
        filtered *= decayFactor;

        // Write back to delay line
        delayLine[readPos] = filtered;
        prevSample = current;

        // Advance read position
        readPos = (readPos + 1) % delayLength;

        output[i] = filtered * volume;
    }

    const audioBuffer = ctx.createBuffer(1, totalSamples, sampleRate);
    audioBuffer.getChannelData(0).set(output);
    return audioBuffer;
}

/**
 * Play a Karplus-Strong sound directly.
 * @param {AudioContext} ctx
 * @param {Object} config
 * @param {AudioNode} destination
 * @returns {AudioBufferSourceNode}
 */
export function playKarplusStrong(ctx, config = {}, destination = null) {
    const buffer = renderKarplusStrong(ctx, config);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(destination || ctx.destination);
    source.start(0);
    return source;
}

// ============================================================================
// PATCH DESCRIPTOR (for node graph integration)
// ============================================================================

/**
 * Karplus-Strong patch descriptor for the node graph system.
 * @param {Object} config
 * @returns {Object} Patch JSON
 */
let _karplusPatchSequence = 0;
function _newKarplusPatchId() { return `karplus_${Date.now()}_${++_karplusPatchSequence}`; }
export function createKarplusStrongPatch(config = {}) {
    return {
        id: _newKarplusPatchId(),
        name: config.name || 'Plucked String',
        category: 'physical',
        nodes: [
            { id: 'excite', type: 'Impulse', params: { rate: 0, shape: 1.0, jitter: 0 } },
            { id: 'wg', type: 'Waveguide', params: {
                length: 1.0 / (config.frequency ?? 220),
                damping: 1.0 - (config.brightness ?? 0.5),
                feedback: config.feedback ?? 0.998,
            }},
            { id: 'vol', type: 'Gain', params: { volume: config.volume ?? 0.8 } },
            { id: 'out', type: 'Output' },
        ],
        wires: [
            { from: 'excite', fromPort: 'out', to: 'wg', toPort: 'excitation' },
            { from: 'wg', fromPort: 'out', to: 'vol', toPort: 'in' },
            { from: 'vol', fromPort: 'out', to: 'out', toPort: 'in' },
        ],
        exposed: {
            frequency: { node: 'wg', param: 'length', min: 0.0005, max: 0.05, default: 1 / 220, transform: 'reciprocal' },
            brightness: { node: 'wg', param: 'damping', min: 0, max: 1, default: 0.5, transform: 'invert' },
            feedback: { node: 'wg', param: 'feedback', min: 0.9, max: 0.9999, default: 0.998 },
            volume: { node: 'vol', param: 'volume', min: 0, max: 1, default: 0.8 },
        },
    };
}
