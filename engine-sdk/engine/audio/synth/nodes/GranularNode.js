// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { uniformDistribution } from '../../../core/math/MathRandom.js';

/**
 * GranularNode.js — Granular Synthesis Engine
 * 
 * Splits an audio source into tiny "grains" and scatters them with
 * controllable density, size, pitch spread, and position randomization.
 * Creates rich textures, atmospheres, time-stretch effects, and
 * particle-like audio from any sample.
 *
 * Works with both the node graph system (as a patch descriptor)
 * and standalone via Web Audio API.
 *
 * Usage:
 *   import { createGranularEngine, startGranular, setGranularParam, stopGranular } from './GranularNode.js';
 *   const engine = createGranularEngine(audioCtx, sampleBuffer);
 *   startGranular(engine);
 *   setGranularParam(engine, 'density', 40);
 *   stopGranular(engine);
 */

// ============================================================================
// GRANULAR ENGINE
// ============================================================================

/**
 * Create a granular synthesis engine.
 * @param {AudioContext} ctx
 * @param {AudioBuffer} buffer - Source sample to granulate
 * @param {Object} config
 * @returns {Object} Granular engine instance
 */
export function createGranularEngine(ctx, buffer, config = {}) {
    const output = ctx.createGain();
    output.gain.value = config.volume ?? 0.8;

    return {
        ctx,
        buffer,
        output,
        params: {
            position: config.position ?? 0.5,          // 0-1 normalized playback position in buffer
            positionRandom: config.positionRandom ?? 0.1, // random scatter around position
            grainSize: config.grainSize ?? 0.08,        // grain duration in seconds (0.01-0.5)
            density: config.density ?? 20,              // grains per second
            pitchBase: config.pitchBase ?? 1.0,         // base playback rate
            pitchRandom: config.pitchRandom ?? 0.05,    // random pitch variation ±
            panSpread: config.panSpread ?? 0.5,         // stereo spread 0-1
            volume: config.volume ?? 0.8,
            envelope: config.envelope ?? 'hann',        // grain envelope: 'hann', 'triangle', 'trapezoid'
            reverse: config.reverse ?? 0,               // 0-1 probability of reversed grains
        },
        _running: false,
        _intervalId: null,
        _activeGrains: [],
    };
}

/**
 * Start the granular engine — begins spawning grains.
 * @param {Object} engine
 */
export function startGranular(engine) {
    if (engine._running) return;
    engine._running = true;
    _scheduleGrains(engine);
}

/**
 * Stop the granular engine.
 * @param {Object} engine
 * @param {number} fadeTime - Fade out in seconds
 */
export function stopGranular(engine, fadeTime = 0.1) {
    engine._running = false;
    if (engine._intervalId) {
        clearTimeout(engine._intervalId);
        engine._intervalId = null;
    }
    // Fade out
    const t = engine.ctx.currentTime;
    engine.output.gain.setValueAtTime(engine.output.gain.value, t);
    engine.output.gain.linearRampToValueAtTime(0, t + fadeTime);
}

/**
 * Set a granular parameter.
 * @param {Object} engine
 * @param {string} key
 * @param {*} value
 */
export function setGranularParam(engine, key, value) {
    if (key in engine.params) {
        engine.params[key] = value;
    }
    if (key === 'volume') {
        engine.output.gain.value = value;
    }
}

/**
 * Replace the source buffer.
 * @param {Object} engine
 * @param {AudioBuffer} buffer
 */
export function setGranularBuffer(engine, buffer) {
    engine.buffer = buffer;
}

/**
 * Connect granular output to a destination.
 * @param {Object} engine
 * @param {AudioNode} destination
 */
export function connectGranular(engine, destination) {
    engine.output.connect(destination);
}

/**
 * Destroy and clean up.
 * @param {Object} engine
 */
export function destroyGranular(engine) {
    stopGranular(engine, 0);
    try { engine.output.disconnect(); } catch { /* */ }
    engine.buffer = null;
    engine._activeGrains = [];
}

// ============================================================================
// GRAIN SCHEDULING
// ============================================================================

function _scheduleGrains(engine) {
    if (!engine._running || !engine.buffer) return;

    const { ctx, buffer, params, output } = engine;
    const now = ctx.currentTime;

    // Spawn one grain
    _spawnGrain(engine, now);

    // Schedule next grain
    const interval = 1.0 / Math.max(1, params.density);
    // Add slight jitter to avoid machine-gun effect
    const jitter = interval * 0.2 * uniformDistribution(-0.5, 0.5, Math.random);
    const nextMs = Math.max(5, (interval + jitter) * 1000);

    engine._intervalId = setTimeout(() => _scheduleGrains(engine), nextMs);
}

function _spawnGrain(engine, startTime) {
    const { ctx, buffer, params, output } = engine;
    const dur = buffer.duration;
    if (dur === 0) return;

    // Resolve randomized parameters
    const grainSize = Math.max(0.005, params.grainSize);
    const position = Math.max(0, Math.min(1, params.position + uniformDistribution(-params.positionRandom, params.positionRandom, Math.random)));
    const pitch = Math.max(0.1, params.pitchBase + uniformDistribution(-params.pitchRandom, params.pitchRandom, Math.random));
    const shouldReverse = Math.random() < params.reverse;

    // Calculate buffer offset
    const grainDuration = grainSize;
    const maxOffset = Math.max(0, dur - grainDuration);
    let offset = position * maxOffset;
    offset = Math.max(0, Math.min(maxOffset, offset));

    // Create source
    let playBuffer = buffer;
    if (shouldReverse) {
        playBuffer = _reverseBuffer(ctx, buffer);
        offset = maxOffset - offset; // flip position for reversed
    }

    const source = ctx.createBufferSource();
    source.buffer = playBuffer;
    source.playbackRate.value = pitch;

    // Grain envelope (amplitude window)
    const envGain = ctx.createGain();
    const envShape = _grainEnvelope(envGain.gain, startTime, grainDuration, params.envelope);

    // Stereo pan
    let lastNode = envGain;
    if (params.panSpread > 0 && ctx.createStereoPanner) {
        const panner = ctx.createStereoPanner();
        panner.pan.value = uniformDistribution(-1, 1, Math.random) * params.panSpread;
        envGain.connect(panner);
        lastNode = panner;
    }

    source.connect(envGain);
    lastNode.connect(output);

    source.start(startTime, offset, grainDuration / pitch + 0.01);

    // Cleanup after grain finishes
    const cleanupTime = (grainDuration / pitch + 0.05) * 1000;
    setTimeout(() => {
        try { source.disconnect(); } catch { /* */ }
        try { envGain.disconnect(); } catch { /* */ }
    }, cleanupTime);
}

function _grainEnvelope(gainParam, startTime, duration, shape) {
    const t = startTime;
    const halfDur = duration * 0.5;

    switch (shape) {
        case 'triangle':
            gainParam.setValueAtTime(0, t);
            gainParam.linearRampToValueAtTime(1, t + halfDur);
            gainParam.linearRampToValueAtTime(0, t + duration);
            break;
        case 'trapezoid': {
            const ramp = duration * 0.15;
            gainParam.setValueAtTime(0, t);
            gainParam.linearRampToValueAtTime(1, t + ramp);
            gainParam.setValueAtTime(1, t + duration - ramp);
            gainParam.linearRampToValueAtTime(0, t + duration);
            break;
        }
        case 'gaussian': {
            // Approximate Gaussian with 5-point curve
            gainParam.setValueAtTime(0.05, t);
            gainParam.linearRampToValueAtTime(0.6, t + duration * 0.2);
            gainParam.linearRampToValueAtTime(1.0, t + halfDur);
            gainParam.linearRampToValueAtTime(0.6, t + duration * 0.8);
            gainParam.linearRampToValueAtTime(0.05, t + duration);
            break;
        }
        case 'expDecay': {
            // Fast attack, exponential decay
            gainParam.setValueAtTime(0, t);
            gainParam.linearRampToValueAtTime(1, t + duration * 0.05);
            gainParam.exponentialRampToValueAtTime(0.01, t + duration);
            break;
        }
        case 'tukey': {
            // Tukey window (tapered cosine) - flat middle with cosine edges
            const taperRatio = 0.3;
            const taperLen = duration * taperRatio * 0.5;
            gainParam.setValueAtTime(0, t);
            gainParam.linearRampToValueAtTime(1, t + taperLen);
            gainParam.setValueAtTime(1, t + duration - taperLen);
            gainParam.linearRampToValueAtTime(0, t + duration);
            break;
        }
        case 'hann':
        default:
            // Approximate Hann window with 4-point cosine curve
            gainParam.setValueAtTime(0, t);
            gainParam.linearRampToValueAtTime(0.75, t + duration * 0.25);
            gainParam.linearRampToValueAtTime(1.0, t + halfDur);
            gainParam.linearRampToValueAtTime(0.75, t + duration * 0.75);
            gainParam.linearRampToValueAtTime(0, t + duration);
            break;
    }
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

// ============================================================================
// PATCH DESCRIPTOR (for node graph integration)
// ============================================================================

/**
 * Granular synthesis patch descriptor for the node graph system.
 * @param {Object} config
 * @returns {Object} Patch JSON
 */
let _granularPatchSequence = 0;
function _newGranularPatchId() { return `granular_${Date.now()}_${++_granularPatchSequence}`; }
export function createGranularPatch(config = {}) {
    return {
        id: _newGranularPatchId(),
        name: config.name || 'Granular Texture',
        category: 'granular',
        nodes: [
            { id: 'grain', type: 'GrainCloud', params: {
                grainSize: config.grainSize ?? 0.08,
                density: config.density ?? 20,
                pitchSpread: config.pitchRandom ?? 0.1,
                scatter: config.positionRandom ?? 0.5,
            }},
            { id: 'vol', type: 'Gain', params: { volume: config.volume ?? 0.8 }},
            { id: 'out', type: 'Output' },
        ],
        wires: [
            { from: 'grain', fromPort: 'out', to: 'vol', toPort: 'in' },
            { from: 'vol', fromPort: 'out', to: 'out', toPort: 'in' },
        ],
        exposed: {
            grainSize: { node: 'grain', param: 'grainSize', min: 0.005, max: 0.5, default: 0.08 },
            density: { node: 'grain', param: 'density', min: 1, max: 100, default: 20 },
            pitchSpread: { node: 'grain', param: 'pitchSpread', min: 0, max: 1, default: 0.1 },
            scatter: { node: 'grain', param: 'scatter', min: 0, max: 1, default: 0.5 },
            volume: { node: 'vol', param: 'volume', min: 0, max: 1, default: 0.8 },
        },
    };
}
