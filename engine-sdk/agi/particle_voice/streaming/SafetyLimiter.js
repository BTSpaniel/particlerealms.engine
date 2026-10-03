// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * SafetyLimiter.js — Phase 2 ParticleVoice audio bridge.
 *
 * "SafetyLimiter.js — soft clip, DC removal, fade." No existing
 * DC-blocker/soft-clip/limiter precedent exists in this codebase to reuse
 * (checked `engine/audio/` — `PatchRunner.worklet.js`'s `distortion` node
 * is a bare `Math.tanh(x*drive)` waveshaper, not a limiter/DC-blocker), so
 * this is a fresh CPU-side implementation. Sits at the very end of the
 * audio bridge, downstream of `PolyphaseResampler.js`, as the last line of
 * defense before PCM reaches `SharedPCMRing.js`/the AudioContext — a
 * physics/neural solver misbehaving upstream (an unstable
 * `tract_waveguide.js` reflection coefficient, a runaway `glottal_lf.js`
 * Newton-Raphson solve, etc.) should never be able to produce a harsh
 * digital-clip transient, a DC offset, or a click at an utterance
 * boundary — that is this module's entire job.
 *
 * Three independent, composable stages, applied per-sample in this order:
 *
 *   1. DC removal — the standard DC-blocking filter (Julius O. Smith's
 *      well-known form): `y[n] = x[n] - x[n-1] + R*y[n-1]`. At DC this
 *      converges to exactly 0 (the `z=1` zero cancels any constant
 *      component); `R` close to 1 keeps the notch narrow so audible
 *      low frequencies are essentially untouched. `R` is derived via this
 *      codebase's own established exponential-pole convention
 *      (`risk/BreathReservoir.js`'s `lagRate = 1 - exp(-1/(tau*sampleRate))`
 *      pattern) rather than inventing a new formula style: here
 *      `R = exp(-2*pi*cornerHz/sampleRate)`.
 *   2. Fade — an explicit, persistent linear gain ramp
 *      (`beginFadeIn`/`beginFadeOut`), so an utterance start/stop or a
 *      cancellation (`SharedPCMRing.js`'s `resetSharedPCMRing()`
 *      discontinuity) can be given a clean few-millisecond ramp instead of
 *      an audible click.
 *   3. Soft clip — a `tanh`-saturating soft knee above `softClipThreshold`
 *      (default 0.8): transparent (identity) below the threshold, then a
 *      C1-continuous (matching slope at the knee, so no audible kink)
 *      saturating curve that asymptotically approaches +/-1 but never
 *      reaches or exceeds it — i.e. this NEVER hard-clips, by construction.
 *
 * All three stages carry PERSISTENT state across `process()` calls (DC
 * filter memory, fade envelope position) — `reset()` clears all of it in
 * one call, mirroring `SharedPCMRing.js`/`PolyphaseResampler.js`'s
 * reset-on-discontinuity convention, so a caller can reset the whole audio
 * bridge chain in lockstep on cancellation/interruption.
 */

export const DEFAULT_DC_BLOCK_CORNER_HZ = 20;
export const DEFAULT_SOFT_CLIP_THRESHOLD = 0.8;
export const DEFAULT_FADE_MS = 5;

/**
 * Pure, stateless: `tanh`-saturating soft knee. Identity below `threshold`
 * in magnitude; above it, asymptotically approaches `+/-1` but never
 * reaches or exceeds it. C1-continuous at the knee (`tanh'(0) === 1`
 * matches the identity segment's slope exactly).
 */
export function softClip(x, threshold = DEFAULT_SOFT_CLIP_THRESHOLD) {
    const ax = Math.abs(x);
    if (ax <= threshold) return x;
    const sign = x < 0 ? -1 : 1;
    const excess = (ax - threshold) / (1 - threshold);
    return sign * (threshold + (1 - threshold) * Math.tanh(excess));
}

export class SafetyLimiter {
    /**
     * @param {{ sampleRate: number, dcBlockCornerHz?: number, softClipThreshold?: number }} options
     */
    constructor({ sampleRate, dcBlockCornerHz = DEFAULT_DC_BLOCK_CORNER_HZ, softClipThreshold = DEFAULT_SOFT_CLIP_THRESHOLD } = {}) {
        if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new RangeError('SafetyLimiter: sampleRate must be a positive number');
        if (!Number.isFinite(dcBlockCornerHz) || dcBlockCornerHz <= 0) throw new RangeError('SafetyLimiter: dcBlockCornerHz must be a positive number');
        if (!(softClipThreshold > 0) || !(softClipThreshold < 1)) throw new RangeError('SafetyLimiter: softClipThreshold must be in (0, 1)');

        this.sampleRate = sampleRate;
        this.dcBlockCornerHz = dcBlockCornerHz;
        this.softClipThreshold = softClipThreshold;
        this._dcR = Math.exp((-2 * Math.PI * dcBlockCornerHz) / sampleRate);
        this.reset();
    }

    /** Clears DC-filter memory and any in-progress fade (jumps straight to unity gain, no fade active) — matches `SharedPCMRing.js`/`PolyphaseResampler.js`'s reset-on-discontinuity convention. */
    reset() {
        this._dcPrevInput = 0;
        this._dcPrevOutput = 0;
        this._fadeGain = 1;
        this._fadeStep = 0;
        this._fadeTarget = 1;
        this._fadeRemaining = 0;
    }

    /** Begins a linear fade-in from the CURRENT gain (not necessarily 0 — a fade-in interrupting an in-progress fade-out continues smoothly from wherever the gain currently is) up to unity, over `durationMs`. */
    beginFadeIn(durationMs = DEFAULT_FADE_MS) {
        this._beginFade(1, durationMs);
    }

    /** Begins a linear fade-out from the current gain down to 0, over `durationMs`. */
    beginFadeOut(durationMs = DEFAULT_FADE_MS) {
        this._beginFade(0, durationMs);
    }

    _beginFade(targetGain, durationMs) {
        if (!Number.isFinite(durationMs) || durationMs < 0) throw new RangeError('SafetyLimiter: fade durationMs must be a non-negative number');
        const samples = Math.max(1, Math.round((durationMs / 1000) * this.sampleRate));
        this._fadeTarget = targetGain;
        this._fadeStep = (targetGain - this._fadeGain) / samples;
        this._fadeRemaining = samples;
    }

    /** @returns {boolean} Whether a fade ramp is currently in progress. */
    isFading() {
        return this._fadeRemaining > 0;
    }

    /**
     * @param {Float32Array|number[]} inputChunk
     * @returns {Float32Array} Same length as `inputChunk`. Non-finite
     * (`NaN`/`Infinity`) input samples are sanitized to 0 before any stage
     * runs — defense-in-depth against a misbehaving upstream solver, which
     * is this module's entire reason to exist.
     */
    process(inputChunk) {
        const n = inputChunk.length;
        const output = new Float32Array(n);
        const R = this._dcR;
        let dcPrevInput = this._dcPrevInput;
        let dcPrevOutput = this._dcPrevOutput;
        let fadeGain = this._fadeGain;
        let fadeRemaining = this._fadeRemaining;
        const fadeStep = this._fadeStep;
        const fadeTarget = this._fadeTarget;

        for (let i = 0; i < n; i++) {
            let x = inputChunk[i];
            if (!Number.isFinite(x)) x = 0;

            const y = x - dcPrevInput + R * dcPrevOutput;
            dcPrevInput = x;
            dcPrevOutput = y;

            let g = fadeGain;
            if (fadeRemaining > 0) {
                fadeGain += fadeStep;
                fadeRemaining -= 1;
                if (fadeRemaining <= 0) fadeGain = fadeTarget; // snap exactly to target, avoid float drift from accumulated steps
                g = fadeGain;
            }

            output[i] = softClip(y * g, this.softClipThreshold);
        }

        this._dcPrevInput = dcPrevInput;
        this._dcPrevOutput = dcPrevOutput;
        this._fadeGain = fadeGain;
        this._fadeRemaining = fadeRemaining;

        return output;
    }
}

export default SafetyLimiter;
