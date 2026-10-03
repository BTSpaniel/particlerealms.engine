// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * SfxGenerator.js — Parametric Sound Effect Generator
 * 
 * sfxr-inspired procedural SFX system. Every sound is defined by a compact
 * parameter object — no samples needed. Renders to AudioBuffer or plays
 * directly via Web Audio.
 *
 * Parameters cover: waveform, envelope, frequency sweep, vibrato,
 * arpeggiation, duty cycle, retrigger, flanger, LP/HP filter, gain.
 *
 * Preset categories with randomize/mutate for instant sound creation:
 *   Pickup, Laser, Explosion, Powerup, Hit, Jump, Blip, Click, Error, Coin
 *
 * Usage:
 *   import { createSfxParams, randomizePreset, mutateSfx, renderSfx, playSfx } from './SfxGenerator.js';
 *   const params = randomizePreset('laser');
 *   const buffer = renderSfx(audioCtx, params);
 *   playSfx(audioCtx, buffer);
 */

import { uniformDistribution } from '../../core/math/MathRandom.js';

// ============================================================================
// DEFAULT PARAMETERS
// ============================================================================

/**
 * Create a default SFX parameter set.
 * All values normalized to sensible ranges.
 * @returns {Object}
 */
export function createSfxParams() {
    return {
        // Waveform: 0=square, 1=sawtooth, 2=sine, 3=noise, 4=triangle, 5=breaker
        waveType: 0,

        // Volume envelope
        attackTime: 0,       // 0-1 seconds
        sustainTime: 0.3,    // 0-1 seconds
        sustainPunch: 0,     // 0-1 extra volume during sustain start
        decayTime: 0.4,      // 0-1 seconds

        // Frequency
        startFrequency: 0.3, // 0-1 mapped to 0-1500 Hz
        minFrequency: 0,     // 0-1 floor (cuts off if freq drops below)
        slide: 0,            // -1 to 1 (frequency slide per second)
        deltaSlide: 0,       // -1 to 1 (acceleration of slide)

        // Vibrato
        vibratoDepth: 0,     // 0-1
        vibratoSpeed: 0,     // 0-1

        // Arpeggiation
        arpMod: 0,           // -1 to 1 (frequency multiplier change)
        arpSpeed: 0,         // 0-1 (time before arp kicks in)

        // Duty cycle (square wave only)
        dutyCycle: 0.5,      // 0-1
        dutySweep: 0,        // -1 to 1

        // Retrigger
        repeatSpeed: 0,      // 0-1 (0 = off, higher = faster retrigger)

        // Flanger / Phaser
        flangerOffset: 0,    // -1 to 1
        flangerSweep: 0,     // -1 to 1

        // Low-pass filter
        lpFilterCutoff: 1.0, // 0-1 (1 = disabled)
        lpFilterCutoffSweep: 0, // -1 to 1
        lpFilterResonance: 0,   // 0-1

        // High-pass filter
        hpFilterCutoff: 0,      // 0-1 (0 = disabled)
        hpFilterCutoffSweep: 0, // -1 to 1

        // Output
        masterVolume: 0.5,   // 0-1
        sampleRate: 44100,
        sampleSize: 8,       // bits per sample (8 or 16)
    };
}

// ============================================================================
// PRESET RANDOMIZERS
// ============================================================================

function rnd(max = 1) { return uniformDistribution(0, max, Math.random); }
function rndI(max) { return Math.floor(uniformDistribution(0, max, Math.random)); }
function rndSign() { return uniformDistribution(0, 1, Math.random) < 0.5 ? -1 : 1; }

const PRESETS = {
    pickup() {
        const p = createSfxParams();
        p.waveType = rndI(6);
        p.startFrequency = 0.4 + rnd(0.5);
        p.attackTime = 0;
        p.sustainTime = rnd(0.1);
        p.decayTime = 0.1 + rnd(0.4);
        p.sustainPunch = 0.3 + rnd(0.3);
        if (rnd() < 0.5) {
            p.arpSpeed = 0.5 + rnd(0.2);
            p.arpMod = 0.2 + rnd(0.4);
        }
        return p;
    },

    laser() {
        const p = createSfxParams();
        p.waveType = rndI(3); // square, saw, sine
        if (p.waveType === 2 && rnd() < 0.5) p.waveType = rndI(2);
        p.startFrequency = 0.5 + rnd(0.5);
        p.minFrequency = p.startFrequency - 0.2 - rnd(0.6);
        if (p.minFrequency < 0.2) p.minFrequency = 0.2;
        p.slide = -0.15 - rnd(0.2);
        if (rnd() < 0.33) { p.slide = 0; p.minFrequency = 0; }
        if (rnd() < 0.5) p.dutyCycle = rnd(0.5);
        if (rnd() < 0.5) p.dutySweep = rnd() * rndSign();
        p.attackTime = 0;
        p.sustainTime = 0.1 + rnd(0.2);
        p.decayTime = rnd(0.4);
        if (rnd() < 0.5) p.hpFilterCutoff = rnd(0.3);
        return p;
    },

    explosion() {
        const p = createSfxParams();
        p.waveType = 3; // noise
        if (rnd() < 0.5) {
            p.startFrequency = 0.1 + rnd(0.4);
            p.slide = -0.1 + rnd(0.4);
        } else {
            p.startFrequency = 0.2 + rnd(0.7);
            p.slide = -0.2 - rnd(0.2);
        }
        p.attackTime = 0;
        p.sustainTime = 0.1 + rnd(0.3);
        p.decayTime = rnd(0.5);
        if (rnd() < 0.5) {
            p.flangerOffset = -0.3 + rnd(0.9);
            p.flangerSweep = -rnd(0.3);
        }
        if (rnd() < 0.33) {
            p.repeatSpeed = 0.3 + rnd(0.5);
        }
        if (rnd() < 0.5) p.sustainPunch = 0.2 + rnd(0.6);
        if (rnd() < 0.5) {
            p.vibratoDepth = rnd(0.7);
            p.vibratoSpeed = rnd(0.6);
        }
        if (rnd() < 0.33) {
            p.arpSpeed = 0.6 + rnd(0.3);
            p.arpMod = 0.8 - rnd(1.6);
        }
        return p;
    },

    powerup() {
        const p = createSfxParams();
        if (rnd() < 0.5) {
            p.waveType = 0; // square
        } else {
            p.waveType = rndI(6);
            p.dutyCycle = rnd(0.6);
        }
        p.startFrequency = 0.2 + rnd(0.3);
        if (rnd() < 0.5) {
            p.slide = 0.1 + rnd(0.4);
            p.repeatSpeed = 0.4 + rnd(0.4);
        } else {
            p.slide = 0.05 + rnd(0.2);
            if (rnd() < 0.5) {
                p.vibratoDepth = rnd(0.7);
                p.vibratoSpeed = rnd(0.6);
            }
        }
        p.attackTime = 0;
        p.sustainTime = rnd(0.4);
        p.decayTime = 0.1 + rnd(0.4);
        return p;
    },

    hit() {
        const p = createSfxParams();
        p.waveType = rndI(3);
        if (p.waveType === 0) p.dutyCycle = rnd(0.6);
        if (p.waveType === 2) p.waveType = 3; // noise for hits
        p.startFrequency = 0.2 + rnd(0.6);
        p.slide = -0.3 - rnd(0.4);
        p.attackTime = 0;
        p.sustainTime = rnd(0.1);
        p.decayTime = rnd(0.2) + 0.1;
        if (rnd() < 0.5) p.hpFilterCutoff = rnd(0.3);
        return p;
    },

    jump() {
        const p = createSfxParams();
        p.waveType = 0; // square
        p.dutyCycle = rnd(0.6);
        p.startFrequency = 0.3 + rnd(0.3);
        p.slide = 0.1 + rnd(0.2);
        p.attackTime = 0;
        p.sustainTime = 0.1 + rnd(0.3);
        p.decayTime = 0.1 + rnd(0.2);
        if (rnd() < 0.5) p.hpFilterCutoff = rnd(0.3);
        if (rnd() < 0.5) p.lpFilterCutoff = 1.0 - rnd(0.6);
        return p;
    },

    blip() {
        const p = createSfxParams();
        p.waveType = rndI(5);
        if (p.waveType === 3) p.waveType = rndI(2);
        p.startFrequency = 0.2 + rnd(0.4);
        p.attackTime = 0;
        p.sustainTime = 0.1 + rnd(0.1);
        p.decayTime = rnd(0.2);
        p.hpFilterCutoff = 0.1;
        return p;
    },

    click() {
        const p = createSfxParams();
        p.waveType = rndI(6);
        p.startFrequency = 0.5 + rnd(0.5);
        p.attackTime = 0;
        p.sustainTime = 0.01 + rnd(0.02);
        p.decayTime = rnd(0.1);
        p.hpFilterCutoff = 0.2 + rnd(0.3);
        p.masterVolume = 0.3 + rnd(0.3);
        return p;
    },

    coin() {
        const p = createSfxParams();
        p.waveType = rndI(2); // square or saw
        p.startFrequency = 0.5 + rnd(0.4);
        p.attackTime = 0;
        p.sustainTime = 0.05 + rnd(0.1);
        p.decayTime = 0.1 + rnd(0.3);
        p.sustainPunch = 0.3 + rnd(0.3);
        p.arpSpeed = 0.5 + rnd(0.3);
        p.arpMod = 0.2 + rnd(0.5);
        return p;
    },

    error() {
        const p = createSfxParams();
        p.waveType = rndI(2); // square or saw
        p.startFrequency = 0.2 + rnd(0.2);
        p.attackTime = 0;
        p.sustainTime = 0.15 + rnd(0.15);
        p.decayTime = 0.1 + rnd(0.2);
        p.slide = rnd(0.1);
        p.vibratoDepth = 0.2 + rnd(0.3);
        p.vibratoSpeed = 0.3 + rnd(0.4);
        p.repeatSpeed = 0.4 + rnd(0.3);
        return p;
    },
};

/**
 * Generate a randomized SFX from a preset category.
 * @param {string} preset - One of: pickup, laser, explosion, powerup, hit, jump, blip, click, coin, error
 * @returns {Object} SFX params
 */
export function randomizePreset(preset) {
    const fn = PRESETS[preset];
    if (!fn) throw new Error(`Unknown SFX preset: ${preset}. Available: ${Object.keys(PRESETS).join(', ')}`);
    return fn();
}

/**
 * Fully random SFX (no preset bias).
 * @returns {Object}
 */
export function randomizeFull() {
    const p = createSfxParams();
    p.waveType = rndI(6);
    p.attackTime = rnd(0.5) ** 3;
    p.sustainTime = rnd(0.5);
    p.sustainPunch = rnd(0.8);
    p.decayTime = rnd(0.5);
    p.startFrequency = rnd();
    p.minFrequency = rnd() * 0.5;
    p.slide = rnd() * 2 - 1;
    p.deltaSlide = (rnd() * 2 - 1) ** 3;
    p.vibratoDepth = (rnd() * 2 - 1) ** 3;
    p.vibratoSpeed = rnd();
    p.arpMod = rnd() * 2 - 1;
    p.arpSpeed = rnd();
    p.dutyCycle = rnd();
    p.dutySweep = rnd() * 2 - 1;
    p.repeatSpeed = rnd();
    p.flangerOffset = (rnd() * 2 - 1) ** 3;
    p.flangerSweep = rnd() * 2 - 1;
    p.lpFilterCutoff = rnd() ** 0.5;
    p.lpFilterCutoffSweep = rnd() * 2 - 1;
    p.lpFilterResonance = rnd();
    p.hpFilterCutoff = rnd();
    p.hpFilterCutoffSweep = rnd() * 2 - 1;
    p.masterVolume = 0.3 + rnd(0.4);
    return p;
}

/**
 * Mutate an existing SFX params slightly (small random nudge to each param).
 * @param {Object} params - Source params
 * @param {number} amount - Mutation strength 0-1 (default 0.05)
 * @returns {Object} New mutated params
 */
export function mutateSfx(params, amount = 0.05) {
    const p = { ...params };
    const nudge = (val, min, max) => {
        val += (rnd() * 2 - 1) * amount * (max - min);
        return Math.max(min, Math.min(max, val));
    };
    p.startFrequency = nudge(p.startFrequency, 0, 1);
    p.minFrequency = nudge(p.minFrequency, 0, 1);
    p.slide = nudge(p.slide, -1, 1);
    p.deltaSlide = nudge(p.deltaSlide, -1, 1);
    p.dutyCycle = nudge(p.dutyCycle, 0, 1);
    p.dutySweep = nudge(p.dutySweep, -1, 1);
    p.vibratoDepth = nudge(p.vibratoDepth, 0, 1);
    p.vibratoSpeed = nudge(p.vibratoSpeed, 0, 1);
    p.arpMod = nudge(p.arpMod, -1, 1);
    p.arpSpeed = nudge(p.arpSpeed, 0, 1);
    p.repeatSpeed = nudge(p.repeatSpeed, 0, 1);
    p.attackTime = nudge(p.attackTime, 0, 1);
    p.sustainTime = nudge(p.sustainTime, 0, 1);
    p.sustainPunch = nudge(p.sustainPunch, 0, 1);
    p.decayTime = nudge(p.decayTime, 0, 1);
    p.lpFilterCutoff = nudge(p.lpFilterCutoff, 0, 1);
    p.lpFilterCutoffSweep = nudge(p.lpFilterCutoffSweep, -1, 1);
    p.lpFilterResonance = nudge(p.lpFilterResonance, 0, 1);
    p.hpFilterCutoff = nudge(p.hpFilterCutoff, 0, 1);
    p.hpFilterCutoffSweep = nudge(p.hpFilterCutoffSweep, -1, 1);
    p.flangerOffset = nudge(p.flangerOffset, -1, 1);
    p.flangerSweep = nudge(p.flangerSweep, -1, 1);
    p.masterVolume = nudge(p.masterVolume, 0, 1);
    return p;
}

/**
 * Get list of available preset names.
 * @returns {string[]}
 */
export function getPresetNames() {
    return Object.keys(PRESETS);
}

// ============================================================================
// RENDER ENGINE (offline → AudioBuffer)
// ============================================================================

/**
 * Render an SFX to an AudioBuffer.
 * This is a pure software synthesizer — runs offline, produces a buffer.
 * @param {AudioContext} ctx - Web Audio context (for sample rate and buffer creation)
 * @param {Object} params - SFX params from createSfxParams/randomizePreset/mutateSfx
 * @returns {AudioBuffer}
 */
export function renderSfx(ctx, params) {
    const p = params;
    const sampleRate = ctx.sampleRate;

    // Map normalized params to synthesis values
    const attackSamples = Math.floor(p.attackTime * p.attackTime * 100000);
    const sustainSamples = Math.floor(p.sustainTime * p.sustainTime * 100000);
    const decaySamples = Math.floor(p.decayTime * p.decayTime * 100000);
    const totalSamples = attackSamples + sustainSamples + decaySamples;

    if (totalSamples === 0) {
        return ctx.createBuffer(1, 1, sampleRate);
    }

    // Frequency
    let freq = p.startFrequency * p.startFrequency * 1500;
    let freqMin = p.minFrequency * p.minFrequency * 1500;
    let freqSlide = 1.0 + p.slide * p.slide * (p.slide < 0 ? -1 : 1) * 0.01;
    let freqDeltaSlide = p.deltaSlide * p.deltaSlide * p.deltaSlide * 0.000001;

    // Vibrato
    let vibDepth = p.vibratoDepth * p.vibratoDepth * p.vibratoDepth;
    let vibSpeed = p.vibratoSpeed * p.vibratoSpeed * 0.01;
    let vibPhase = 0;

    // Envelope
    let envStage = 0; // 0=attack, 1=sustain, 2=decay
    let envTime = 0;
    let envLength = [attackSamples, sustainSamples, decaySamples];
    let envVol = 0;

    // Duty
    let duty = 0.5 - p.dutyCycle * 0.5;
    let dutySweep = -p.dutySweep * p.dutySweep * p.dutySweep * 0.00005;

    // Arp
    let arpTime = 0;
    let arpLimit = (p.arpSpeed === 0) ? 0 : Math.floor((1.0 - p.arpSpeed) * (1.0 - p.arpSpeed) * 20000 + 32);
    let arpMod = (p.arpMod >= 0)
        ? (1.0 - p.arpMod * p.arpMod * 0.9)
        : (1.0 + p.arpMod * p.arpMod * 10.0);

    // Repeat
    let repTime = 0;
    let repLimit = (p.repeatSpeed === 0) ? 0 : Math.floor((1.0 - p.repeatSpeed) * (1.0 - p.repeatSpeed) * 20000 + 32);

    // Flanger
    let flangerBuffer = new Float32Array(1024);
    let flangerPos = 0;
    let flangerOffset = p.flangerOffset * p.flangerOffset * (p.flangerOffset < 0 ? -1 : 1) * 1020;
    let flangerSweep = p.flangerSweep * p.flangerSweep * (p.flangerSweep < 0 ? -1 : 1);

    // LP filter
    let lpPos = 0;
    let lpPosD = 0;
    let lpCutoff = p.lpFilterCutoff * p.lpFilterCutoff * p.lpFilterCutoff * 0.1;
    let lpCutoffD = 1.0 + p.lpFilterCutoffSweep * 0.0001;
    let lpDamp = 5.0 / (1.0 + p.lpFilterResonance * p.lpFilterResonance * 20) * (0.01 + lpCutoff);
    if (lpDamp > 0.8) lpDamp = 0.8;
    let lpEnabled = p.lpFilterCutoff < 1.0;

    // HP filter
    let hpPos = 0;
    let hpCutoff = p.hpFilterCutoff * p.hpFilterCutoff * 0.1;
    let hpCutoffD = 1.0 + p.hpFilterCutoffSweep * 0.0003;
    let hpEnabled = p.hpFilterCutoff > 0.0;

    // Phase
    let phase = 0;
    let period = Math.max(8, Math.floor(sampleRate / freq));
    let maxSamples = Math.min(totalSamples + 1024, sampleRate * 4); // cap at 4 seconds

    const buffer = new Float32Array(maxSamples);
    let sampleCount = 0;

    const resetPhase = () => {
        freq = p.startFrequency * p.startFrequency * 1500;
        freqSlide = 1.0 + p.slide * p.slide * (p.slide < 0 ? -1 : 1) * 0.01;
        freqDeltaSlide = p.deltaSlide * p.deltaSlide * p.deltaSlide * 0.000001;
        duty = 0.5 - p.dutyCycle * 0.5;
        dutySweep = -p.dutySweep * p.dutySweep * p.dutySweep * 0.00005;
        period = Math.max(8, Math.floor(sampleRate / freq));
        arpTime = 0;
        arpLimit = (p.arpSpeed === 0) ? 0 : Math.floor((1.0 - p.arpSpeed) * (1.0 - p.arpSpeed) * 20000 + 32);
        arpMod = (p.arpMod >= 0)
            ? (1.0 - p.arpMod * p.arpMod * 0.9)
            : (1.0 + p.arpMod * p.arpMod * 10.0);
    };

    for (let i = 0; i < maxSamples; i++) {
        // Retrigger
        if (repLimit > 0) {
            repTime++;
            if (repTime >= repLimit) {
                repTime = 0;
                resetPhase();
            }
        }

        // Arpeggio
        if (arpLimit > 0) {
            arpTime++;
            if (arpTime >= arpLimit) {
                arpLimit = 0;
                freq *= arpMod;
            }
        }

        // Frequency slide
        freqSlide += freqDeltaSlide;
        freq *= freqSlide;
        if (freq < freqMin) {
            freq = freqMin;
            if (freqMin > 0.001) break; // below floor = done
        }

        period = Math.max(8, Math.floor(sampleRate / freq));

        // Vibrato
        vibPhase += vibSpeed;
        const vibSample = vibDepth * Math.sin(vibPhase) * (sampleRate / freq) * 0.5;

        // Duty cycle
        duty = Math.max(0, Math.min(0.5, duty + dutySweep));

        // Envelope
        envTime++;
        if (envTime >= envLength[envStage]) {
            envTime = 0;
            envStage++;
            if (envStage > 2) break; // sound done
        }
        switch (envStage) {
            case 0: // attack
                envVol = envLength[0] > 0 ? envTime / envLength[0] : 1;
                break;
            case 1: // sustain
                envVol = 1.0 + (1.0 - envTime / Math.max(1, envLength[1])) * 2.0 * p.sustainPunch;
                break;
            case 2: // decay
                envVol = 1.0 - envTime / Math.max(1, envLength[2]);
                break;
        }

        // Generate sample
        const phasePos = phase / period;
        let sample;
        switch (p.waveType) {
            case 0: // Square
                sample = phasePos < duty ? 0.5 : -0.5;
                break;
            case 1: // Sawtooth
                sample = 1.0 - phasePos * 2.0;
                break;
            case 2: // Sine
                sample = Math.sin(phasePos * Math.PI * 2);
                break;
            case 3: // Noise
                sample = uniformDistribution(-1, 1, Math.random);
                break;
            case 4: // Triangle
                sample = Math.abs(1.0 - phasePos * 2.0) * 2 - 1;
                break;
            case 5: // Breaker (distorted sine)
                sample = Math.abs(1.0 - phasePos * phasePos * 2.0) * 2 - 1;
                break;
            default:
                sample = 0;
        }

        // LP filter
        const lpPrev = lpPos;
        lpCutoff *= lpCutoffD;
        lpCutoff = Math.max(0, Math.min(0.1, lpCutoff));
        if (lpEnabled) {
            lpPosD += (sample - lpPos) * lpCutoff;
            lpPosD -= lpPosD * lpDamp;
        } else {
            lpPos = sample;
            lpPosD = 0;
        }
        lpPos += lpPosD;

        // HP filter
        hpCutoff *= hpCutoffD;
        hpCutoff = Math.max(0.00001, Math.min(0.1, hpCutoff));
        if (hpEnabled) {
            hpPos += lpPos - lpPrev;
            hpPos -= hpPos * hpCutoff;
            sample = hpPos;
        } else {
            sample = lpPos;
        }

        // Flanger
        flangerBuffer[flangerPos & 1023] = sample;
        flangerOffset += flangerSweep;
        const flangerIdx = (flangerPos - Math.floor(flangerOffset) + 1024) & 1023;
        sample = (sample + flangerBuffer[flangerIdx]) * 0.5;
        flangerPos++;

        // Advance phase
        phase++;
        const effectivePeriod = Math.max(8, Math.floor(period + vibSample));
        if (phase >= effectivePeriod) {
            phase %= effectivePeriod;
        }

        // Apply envelope and master volume
        sample *= envVol * p.masterVolume;

        // Clamp
        sample = Math.max(-1, Math.min(1, sample));

        buffer[i] = sample;
        sampleCount = i + 1;
    }

    // Create AudioBuffer from samples
    const audioBuffer = ctx.createBuffer(1, sampleCount, sampleRate);
    audioBuffer.getChannelData(0).set(buffer.subarray(0, sampleCount));
    return audioBuffer;
}

// ============================================================================
// PLAYBACK
// ============================================================================

/**
 * Play a rendered SFX buffer.
 * @param {AudioContext} ctx
 * @param {AudioBuffer} buffer
 * @param {Object} options - { volume, playbackRate, destination }
 * @returns {AudioBufferSourceNode}
 */
export function playSfx(ctx, buffer, options = {}) {
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = options.playbackRate || 1.0;

    const gain = ctx.createGain();
    gain.gain.value = options.volume ?? 1.0;

    source.connect(gain);
    gain.connect(options.destination || ctx.destination);
    source.start(0);
    return source;
}

/**
 * Render and immediately play an SFX.
 * @param {AudioContext} ctx
 * @param {Object} params
 * @param {Object} options
 * @returns {{ buffer: AudioBuffer, source: AudioBufferSourceNode }}
 */
export function renderAndPlay(ctx, params, options = {}) {
    const buffer = renderSfx(ctx, params);
    const source = playSfx(ctx, buffer, options);
    return { buffer, source };
}

// ============================================================================
// SERIALIZATION
// ============================================================================

/**
 * Encode SFX params to a compact JSON string.
 * @param {Object} params
 * @returns {string}
 */
export function encodeSfxParams(params) {
    return JSON.stringify(params);
}

/**
 * Decode SFX params from a JSON string.
 * @param {string} str
 * @returns {Object}
 */
export function decodeSfxParams(str) {
    const decoded = JSON.parse(str);
    const defaults = createSfxParams();
    return { ...defaults, ...decoded };
}
