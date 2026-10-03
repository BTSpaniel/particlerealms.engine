// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * SoundBlender.js — Multi-Layer Sound Effect Mixer
 * 
 * Blends 2-4 sound sources (AudioBuffers) with per-layer controls:
 *   - Volume, pitch shift, delay offset
 *   - Crossfade curves (linear, equal-power, cosine)
 *   - Random variation ranges per parameter
 *   - Trigger modes: simultaneous, sequential, random-pick, round-robin
 *
 * Produces infinite unique variations from a small set of source sounds.
 *
 * Usage:
 *   import { createBlendPreset, renderBlend, playBlend } from './SoundBlender.js';
 *   const preset = createBlendPreset([buffer1, buffer2], {
 *       layers: [
 *           { volume: 0.8, pitch: 1.0, delay: 0, volumeRandom: 0.1, pitchRandom: 0.05 },
 *           { volume: 0.5, pitch: 1.2, delay: 0.05, volumeRandom: 0.2, pitchRandom: 0.1 }
 *       ],
 *       mode: 'simultaneous'
 *   });
 *   playBlend(ctx, preset);
 */

import { uniformDistribution } from '../../core/math/MathRandom.js';

// ============================================================================
// BLEND PRESET
// ============================================================================

/**
 * Create a blend preset from source buffers and layer config.
 * @param {AudioBuffer[]} buffers - Source audio buffers (1-4)
 * @param {Object} config
 * @param {Object[]} config.layers - Per-layer settings
 * @param {string} config.mode - 'simultaneous'|'sequential'|'random'|'roundrobin'
 * @param {string} config.fadeCurve - 'linear'|'equalpower'|'cosine'
 * @param {number} config.masterVolume - 0-1
 * @returns {Object} Blend preset
 */
export function createBlendPreset(buffers = [], config = {}) {
    const layerCount = buffers.length;
    const defaultLayers = buffers.map(() => ({
        volume: 1.0,
        pitch: 1.0,
        delay: 0,
        pan: 0,            // -1 to 1
        volumeRandom: 0,   // random range ±
        pitchRandom: 0,    // random range ±
        delayRandom: 0,    // random range ±
        panRandom: 0,      // random range ±
        reverse: false,
        enabled: true,
    }));

    return {
        buffers,
        layers: config.layers || defaultLayers,
        mode: config.mode || 'simultaneous',
        fadeCurve: config.fadeCurve || 'linear',
        masterVolume: config.masterVolume ?? 1.0,
        _roundRobinIndex: 0,
    };
}

/**
 * Add a layer to an existing preset.
 * @param {Object} preset
 * @param {AudioBuffer} buffer
 * @param {Object} layerConfig
 */
export function addLayer(preset, buffer, layerConfig = {}) {
    preset.buffers.push(buffer);
    preset.layers.push({
        volume: 1.0,
        pitch: 1.0,
        delay: 0,
        pan: 0,
        volumeRandom: 0,
        pitchRandom: 0,
        delayRandom: 0,
        panRandom: 0,
        reverse: false,
        enabled: true,
        ...layerConfig,
    });
}

/**
 * Remove a layer by index.
 * @param {Object} preset
 * @param {number} index
 */
export function removeLayer(preset, index) {
    if (index >= 0 && index < preset.buffers.length) {
        preset.buffers.splice(index, 1);
        preset.layers.splice(index, 1);
    }
}

// ============================================================================
// RANDOMIZATION
// ============================================================================

function randRange(base, range) {
    if (range === 0) return base;
    return uniformDistribution(base - range, base + range, Math.random);
}

/**
 * Resolve a layer's randomized parameters for one playback instance.
 * @param {Object} layer
 * @returns {{ volume, pitch, delay, pan }}
 */
function resolveLayer(layer) {
    return {
        volume: Math.max(0, randRange(layer.volume, layer.volumeRandom)),
        pitch: Math.max(0.1, randRange(layer.pitch, layer.pitchRandom)),
        delay: Math.max(0, randRange(layer.delay, layer.delayRandom)),
        pan: Math.max(-1, Math.min(1, randRange(layer.pan, layer.panRandom))),
    };
}

// ============================================================================
// FADE CURVES
// ============================================================================

function fadeFactor(t, curve) {
    const clamped = Math.max(0, Math.min(1, t));
    switch (curve) {
        case 'equalpower': return Math.cos((1.0 - clamped) * Math.PI * 0.5);
        case 'cosine': return 0.5 * (1 - Math.cos(clamped * Math.PI));
        case 'linear':
        default: return clamped;
    }
}

// ============================================================================
// PLAYBACK
// ============================================================================

/**
 * Play a blend preset. Returns an object with stop() method.
 * @param {AudioContext} ctx
 * @param {Object} preset - From createBlendPreset
 * @param {Object} options - { destination, onEnded }
 * @returns {{ stop: Function, sources: AudioBufferSourceNode[] }}
 */
export function playBlend(ctx, preset, options = {}) {
    const dest = options.destination || ctx.destination;
    const sources = [];
    const gains = [];
    const t = ctx.currentTime;

    // Master gain
    const masterGain = ctx.createGain();
    masterGain.gain.value = preset.masterVolume;
    masterGain.connect(dest);

    // Pick which layers to play based on mode
    let layerIndices;
    switch (preset.mode) {
        case 'random':
            layerIndices = [Math.floor(uniformDistribution(0, preset.buffers.length, Math.random))];
            break;
        case 'roundrobin':
            layerIndices = [preset._roundRobinIndex % preset.buffers.length];
            preset._roundRobinIndex++;
            break;
        case 'sequential': {
            // Play layers one after another with accumulated delay
            layerIndices = preset.buffers.map((_, i) => i);
            let accDelay = 0;
            for (const idx of layerIndices) {
                if (!preset.layers[idx].enabled) continue;
                const layer = preset.layers[idx];
                const resolved = resolveLayer(layer);
                accDelay += resolved.delay;
                const src = _playLayer(ctx, preset.buffers[idx], resolved, t + accDelay, masterGain, layer.reverse);
                sources.push(src.source);
                gains.push(src.gain);
                // Add buffer duration for sequential ordering
                accDelay += preset.buffers[idx].duration / resolved.pitch;
            }
            return _makeResult(sources, gains, masterGain);
        }
        case 'simultaneous':
        default:
            layerIndices = preset.buffers.map((_, i) => i);
            break;
    }

    // Play selected layers
    for (const idx of layerIndices) {
        if (idx >= preset.buffers.length || !preset.layers[idx].enabled) continue;
        const layer = preset.layers[idx];
        const resolved = resolveLayer(layer);
        const src = _playLayer(ctx, preset.buffers[idx], resolved, t + resolved.delay, masterGain, layer.reverse);
        sources.push(src.source);
        gains.push(src.gain);
    }

    return _makeResult(sources, gains, masterGain);
}

function _playLayer(ctx, buffer, resolved, startTime, dest, reverse) {
    let playBuffer = buffer;
    if (reverse) {
        playBuffer = _reverseBuffer(ctx, buffer);
    }

    const source = ctx.createBufferSource();
    source.buffer = playBuffer;
    source.playbackRate.value = resolved.pitch;

    const gain = ctx.createGain();
    gain.gain.value = resolved.volume;

    // Stereo panner
    if (resolved.pan !== 0 && ctx.createStereoPanner) {
        const panner = ctx.createStereoPanner();
        panner.pan.value = resolved.pan;
        source.connect(gain).connect(panner).connect(dest);
    } else {
        source.connect(gain).connect(dest);
    }

    source.start(startTime);
    return { source, gain };
}

function _reverseBuffer(ctx, buffer) {
    const reversed = ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
        const src = buffer.getChannelData(ch);
        const dst = reversed.getChannelData(ch);
        for (let i = 0; i < src.length; i++) {
            dst[i] = src[src.length - 1 - i];
        }
    }
    return reversed;
}

function _makeResult(sources, gains, masterGain) {
    return {
        sources,
        gains,
        masterGain,
        stop(fadeTime = 0.05) {
            const t = masterGain.context.currentTime;
            masterGain.gain.setValueAtTime(masterGain.gain.value, t);
            masterGain.gain.linearRampToValueAtTime(0, t + fadeTime);
            setTimeout(() => {
                for (const s of sources) {
                    try { s.stop(); } catch { /* already stopped */ }
                }
                try { masterGain.disconnect(); } catch { /* */ }
            }, (fadeTime + 0.05) * 1000);
        },
    };
}

// ============================================================================
// OFFLINE RENDER (merge layers to single AudioBuffer)
// ============================================================================

/**
 * Render a blend preset to a single AudioBuffer (offline).
 * @param {AudioContext} ctx
 * @param {Object} preset
 * @returns {Promise<AudioBuffer>}
 */
export async function renderBlend(ctx, preset) {
    // Calculate total duration
    let maxDuration = 0;
    for (let i = 0; i < preset.buffers.length; i++) {
        if (!preset.layers[i].enabled) continue;
        const layer = preset.layers[i];
        const dur = preset.buffers[i].duration / Math.max(0.1, layer.pitch) + layer.delay;
        maxDuration = Math.max(maxDuration, dur);
    }

    const offlineCtx = new OfflineAudioContext(1, Math.ceil(maxDuration * ctx.sampleRate) + 1024, ctx.sampleRate);

    const masterGain = offlineCtx.createGain();
    masterGain.gain.value = preset.masterVolume;
    masterGain.connect(offlineCtx.destination);

    for (let i = 0; i < preset.buffers.length; i++) {
        if (!preset.layers[i].enabled) continue;
        const layer = preset.layers[i];
        const resolved = resolveLayer(layer);
        _playLayer(offlineCtx, preset.buffers[i], resolved, resolved.delay, masterGain, layer.reverse);
    }

    return offlineCtx.startRendering();
}

// ============================================================================
// VARIATION BATCH
// ============================================================================

/**
 * Generate N unique variations of a blend preset.
 * Each variation resolves random ranges differently.
 * @param {AudioContext} ctx
 * @param {Object} preset
 * @param {number} count
 * @returns {Promise<AudioBuffer[]>}
 */
export async function generateVariations(ctx, preset, count = 10) {
    const results = [];
    for (let i = 0; i < count; i++) {
        results.push(await renderBlend(ctx, preset));
    }
    return results;
}
