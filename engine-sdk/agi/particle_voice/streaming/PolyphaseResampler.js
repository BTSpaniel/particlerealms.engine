// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * PolyphaseResampler.js — Phase 2 ParticleVoice audio bridge.
 *
 * Bridges the returned synthesis sample rate to the actual AudioContext rate.
 * ParticleVoiceModel currently defaults to 64 kHz; the Phase -1 probes used
 * 32 kHz. Neither rate should be assumed by a playback caller. A 48 kHz output
 * gives L=3, M=4 for the current model. No risk-spike precedent exists for this module (checked
 * `risk/` and `engine/` — the only "resample" hits in `engine/` are
 * unrelated texture/render resample passes), so this is a fresh CPU-side
 * (not GPU-kernel) implementation — appropriate for the audio bridge,
 * which is already CPU-side per the plan (`SharedPCMRing.js`,
 * `ParticleVoiceProcessor.js`).
 *
 * Classic Crochiere/Rabiner polyphase interpolator-decimator: for an
 * EXACT integer ratio L/M (`inputSampleRate`/`outputSampleRate` reduced by
 * their GCD — both are integers in practice, e.g. 32000 -> 48000 reduces
 * exactly to L=3, M=2), a single windowed-sinc lowpass FIR (cutoff at
 * `min(inputRate, outputRate)/2`, designed at the upsampled L*inputRate
 * rate to suppress both upsampling images and downsampling aliases) is
 * decomposed into L phase sub-filters of `tapsPerPhase` taps each. Per
 * output sample, only `tapsPerPhase` multiplies are needed regardless of
 * L — the O(tapsPerPhase*L) cost is paid once at construction (filter
 * design), not per sample.
 *
 * STREAMING correctness (critical for a chunked audio bridge, where
 * `WaveguideAcousticState` chunks arrive as small windows, not one whole
 * signal): `process()` keeps a persistent tail of not-yet-fully-consumed
 * input samples across calls (`_history`/`_historyBaseIndex`) and a
 * continuously-advancing upsampled-domain position (`_pos`), so
 * `resampler.process(wholeSignal)` and
 * `chunks.map(c => resampler.process(c))` concatenated produce IDENTICAL
 * output — verified directly in
 * `tests/particle-voice/polyphase-resampler.html`.
 *
 * Known limitation (documented, not hidden): the FIR filter's group delay
 * (~`tapsPerPhase/2` input samples) means the first `tapsPerPhase/2`-ish
 * output samples ramp up from a zero-padded history rather than being
 * bit-perfect from sample 0 — a normal, bounded FIR startup transient,
 * not a correctness bug (every streaming FIR filter has this).
 */

export function gcd(a, b) {
    a = Math.abs(Math.round(a));
    b = Math.abs(Math.round(b));
    while (b !== 0) {
        [a, b] = [b, a % b];
    }
    return a;
}

/**
 * Windowed-sinc lowpass FIR, Hann-windowed, normalized to unity DC gain
 * (`sum(h) === 1`). `cutoff` is normalized to the filter's OWN sample
 * rate (0.5 = that rate's Nyquist) — callers designing a polyphase
 * interpolator pass a cutoff normalized to the UPSAMPLED (L*inputRate)
 * rate, per this module's `buildPolyphaseFilter`.
 */
export function designWindowedSincLowpass(numTaps, cutoff) {
    if (!Number.isInteger(numTaps) || numTaps < 2) throw new RangeError('designWindowedSincLowpass: numTaps must be an integer >= 2');
    if (!(cutoff > 0) || !(cutoff < 0.5)) throw new RangeError('designWindowedSincLowpass: cutoff must be in (0, 0.5)');

    const h = new Float64Array(numTaps);
    const center = (numTaps - 1) / 2;
    for (let n = 0; n < numTaps; n++) {
        const x = n - center;
        const sincValue = x === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * x) / (Math.PI * x);
        const hann = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (numTaps - 1));
        h[n] = sincValue * hann;
    }
    let sum = 0;
    for (let n = 0; n < numTaps; n++) sum += h[n];
    for (let n = 0; n < numTaps; n++) h[n] /= sum;
    return h;
}

/**
 * Builds the L-phase decomposition of a full-length windowed-sinc lowpass
 * sized for L/M polyphase interpolation-decimation.
 * @returns {{ h: Float64Array, phases: Float64Array[] }} `h` is the full
 * `tapsPerPhase*L`-tap filter (unity DC gain); `phases[p][j] === h[j*L+p]`.
 */
export function buildPolyphaseFilter(L, M, tapsPerPhase) {
    if (!Number.isInteger(L) || L < 1) throw new RangeError('buildPolyphaseFilter: L must be a positive integer');
    if (!Number.isInteger(M) || M < 1) throw new RangeError('buildPolyphaseFilter: M must be a positive integer');
    if (!Number.isInteger(tapsPerPhase) || tapsPerPhase < 2) throw new RangeError('buildPolyphaseFilter: tapsPerPhase must be an integer >= 2');

    const numTaps = tapsPerPhase * L;
    // Normalized to the upsampled (L*inputRate) rate: min(inputRate, outputRate)/2 in those units, scaled by a
    // 0.9 relaxation factor so the transition band has headroom below Nyquist (a brick-wall cutoff AT Nyquist,
    // which the identity ratio L=M=1 would otherwise produce exactly, is not realizable by any finite-length FIR).
    const cutoff = (0.9 * 0.5) / Math.max(L, M);
    const h = designWindowedSincLowpass(numTaps, cutoff);
    const phases = Array.from({ length: L }, () => new Float64Array(tapsPerPhase));
    for (let j = 0; j < tapsPerPhase; j++) {
        for (let p = 0; p < L; p++) {
            phases[p][j] = h[j * L + p];
        }
    }
    return { h, phases };
}

export const DEFAULT_TAPS_PER_PHASE = 32;

export class PolyphaseResampler {
    /**
     * @param {number} inputSampleRate Returned synthesis rate, e.g. 64000.
     * @param {number} outputSampleRate e.g. `AudioContext.sampleRate` (commonly 44100/48000).
     * @param {{ tapsPerPhase?: number }} [options]
     */
    constructor(inputSampleRate, outputSampleRate, { tapsPerPhase = DEFAULT_TAPS_PER_PHASE } = {}) {
        if (!Number.isInteger(inputSampleRate) || inputSampleRate <= 0) throw new RangeError('PolyphaseResampler: inputSampleRate must be a positive integer');
        if (!Number.isInteger(outputSampleRate) || outputSampleRate <= 0) throw new RangeError('PolyphaseResampler: outputSampleRate must be a positive integer');
        if (!Number.isInteger(tapsPerPhase) || tapsPerPhase < 2) throw new RangeError('PolyphaseResampler: tapsPerPhase must be an integer >= 2');

        const g = gcd(inputSampleRate, outputSampleRate);
        this.inputSampleRate = inputSampleRate;
        this.outputSampleRate = outputSampleRate;
        this.L = outputSampleRate / g;
        this.M = inputSampleRate / g;
        this.tapsPerPhase = tapsPerPhase;
        this._phases = buildPolyphaseFilter(this.L, this.M, tapsPerPhase).phases;
        this.reset();
    }

    /** Clears all persistent filter state — matches `SharedPCMRing.js`'s reset-on-discontinuity convention (cancellation/interruption), so an audio-bridge caller can reset the resampler in lockstep with a ring reset rather than letting stale pre-reset history bleed into post-reset output. */
    reset() {
        this._history = new Float64Array(0);
        this._historyBaseIndex = 0;
        this._pos = 0;
    }

    /** Approximate output latency introduced by this filter's group delay, in output samples. */
    latencyOutputSamples() {
        return Math.round(((this.tapsPerPhase - 1) / 2) * (this.L / this.M));
    }

    /**
     * @param {Float32Array|number[]} inputChunk Samples at `inputSampleRate`.
     * @returns {Float32Array} Samples at `outputSampleRate`. May be empty if
     * `inputChunk` was too short to produce a new output sample yet (the
     * remainder is retained in persistent history for the next call).
     */
    process(inputChunk) {
        const oldLen = this._history.length;
        const merged = new Float64Array(oldLen + inputChunk.length);
        merged.set(this._history, 0);
        for (let i = 0; i < inputChunk.length; i++) merged[oldLen + i] = inputChunk[i];
        const historyBase = this._historyBaseIndex;

        const outputs = [];
        const { L, M, tapsPerPhase } = this;
        for (;;) {
            const inputIndex = Math.floor(this._pos / L);
            if (inputIndex - historyBase >= merged.length) break; // not enough input yet
            const phase = this._pos % L;
            const coeffs = this._phases[phase];
            let y = 0;
            for (let j = 0; j < tapsPerPhase; j++) {
                const idx = inputIndex - j - historyBase;
                const xVal = idx >= 0 && idx < merged.length ? merged[idx] : 0;
                y += coeffs[j] * xVal;
            }
            outputs.push(y * L);
            this._pos += M;
        }

        const nextOldestNeeded = Math.floor(this._pos / L) - (tapsPerPhase - 1);
        const trimStart = Math.max(0, nextOldestNeeded - historyBase);
        this._history = merged.slice(trimStart);
        this._historyBaseIndex = historyBase + trimStart;

        return Float32Array.from(outputs);
    }
}

export default PolyphaseResampler;
