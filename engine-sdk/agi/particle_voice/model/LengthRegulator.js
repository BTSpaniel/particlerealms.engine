// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * LengthRegulator.js — Phase 3 ParticleVoice model.
 *
 * Expands per-PHONEME encoder features and prosody into per-FRAME streams,
 * and — because `spec/VoicePlan-v0.md` §5 explicitly assigns it here — handles
 * resampling between the 100 Hz plan frame rate and whatever rate the consumer
 * runs at (the Activity path is 8 ms/frame = 125 Hz, `ActivityContract-v0` §1;
 * the two "are not required to be equal; any resampling between them is
 * `LengthRegulator.js`'s job, not assumed away here").
 *
 * ## F0 is interpolated, features are held
 *
 * These two streams are expanded differently, on purpose:
 *
 *   - **F0 is linearly interpolated** between phoneme centres. Holding one
 *     value per phoneme would produce a pitch STAIRCASE, and a discontinuous
 *     F0 is audible as a click or a warble at every phoneme boundary — the
 *     exact artifact the Phase 2 exit gate spent effort eliminating from the
 *     waveguide. Interpolating between centres (not edges) means each
 *     phoneme's nominal pitch is actually reached at its midpoint.
 *   - **Feature vectors are HELD** across a phoneme's frames, not
 *     interpolated. They are a learned representation, and blending two
 *     phonemes' embeddings produces a vector that means neither. Holding is
 *     the standard FastSpeech-style length regulation and is what the
 *     downstream `ArticulationHead` expects.
 *   - **The voiced flag is held** — it is boolean; interpolating it would
 *     invent half-voiced frames that no source model can honour.
 *
 * ## Where it runs
 *
 * CPU-side. The encoder's features are produced on GPU, so using them here
 * costs a readback — but the consumer (`ArticulationHead` → `ParticleTract`)
 * needs per-chunk control values in JS anyway (`areas`, `f0Hz`), so the
 * readback is not avoided by moving this to GPU, only relocated. A GPU
 * `length_regulate` gather kernel is a straightforward follow-up IF profiling
 * later shows the feature upload dominating; the condition that would justify
 * it is stated so the decision is revisitable rather than forgotten.
 */

export const ACTIVITY_FRAME_RATE_HZ = 125; // 8 ms/frame, ActivityContract-v0 §1

/**
 * Expand per-phoneme streams to per-frame streams.
 *
 * @param {{
 *   durationFrames: ArrayLike<number>,
 *   f0Hz: ArrayLike<number>,
 *   voiced: ArrayLike<number>,
 *   features?: ArrayLike<number>,
 *   featureDim?: number,
 *   maxFrames?: number,
 * }} input
 * @returns {{
 *   totalFrames: number,
 *   frameF0Hz: Float32Array,
 *   frameVoiced: Uint8Array,
 *   frameToPhoneme: Uint32Array,
 *   frameFeatures: Float32Array|null,
 * }}
 */
export function regulateLength({ durationFrames, f0Hz, voiced, features = null, featureDim = 0, maxFrames = 1 << 20 }) {
    if (!durationFrames || !f0Hz || !voiced) {
        throw new TypeError('regulateLength requires {durationFrames, f0Hz, voiced}');
    }
    const n = durationFrames.length;
    if (f0Hz.length !== n || voiced.length !== n) {
        throw new RangeError(`regulateLength: per-phoneme arrays must match in length (${n}/${f0Hz.length}/${voiced.length})`);
    }
    if (features !== null) {
        if (!Number.isInteger(featureDim) || featureDim <= 0) {
            throw new RangeError('regulateLength: featureDim must be a positive integer when features are supplied');
        }
        if (features.length !== n * featureDim) {
            throw new RangeError(`regulateLength: features must be [${n}, ${featureDim}] = ${n * featureDim} values, got ${features.length}`);
        }
    }

    let totalFrames = 0;
    for (let i = 0; i < n; i++) {
        const d = durationFrames[i];
        if (!Number.isInteger(d) || d < 1) {
            // A zero-duration phoneme would silently vanish from the output.
            throw new RangeError(`regulateLength: durationFrames[${i}] = ${d} must be an integer >= 1`);
        }
        totalFrames += d;
    }
    if (totalFrames > maxFrames) throw new RangeError(`regulateLength: totalFrames ${totalFrames} exceeds maxFrames ${maxFrames}`);

    const frameF0Hz = new Float32Array(totalFrames);
    const frameVoiced = new Uint8Array(totalFrames);
    const frameToPhoneme = new Uint32Array(totalFrames);
    const frameFeatures = features === null ? null : new Float32Array(totalFrames * featureDim);

    if (totalFrames === 0) {
        return { totalFrames, frameF0Hz, frameVoiced, frameToPhoneme, frameFeatures };
    }

    // Phoneme centres in frame coordinates, for F0 interpolation.
    const centres = new Float64Array(n);
    {
        let acc = 0;
        for (let i = 0; i < n; i++) {
            centres[i] = acc + (durationFrames[i] - 1) / 2;
            acc += durationFrames[i];
        }
    }

    // Hold features / voicing, and record the source phoneme per frame.
    {
        let f = 0;
        for (let i = 0; i < n; i++) {
            const d = durationFrames[i];
            for (let k = 0; k < d; k++, f++) {
                frameToPhoneme[f] = i;
                frameVoiced[f] = voiced[i] ? 1 : 0;
                if (frameFeatures) {
                    frameFeatures.set(
                        // subarray on a plain Array would fail, so index-copy
                        // when features is not a typed array.
                        features.subarray
                            ? features.subarray(i * featureDim, (i + 1) * featureDim)
                            : Array.prototype.slice.call(features, i * featureDim, (i + 1) * featureDim),
                        f * featureDim,
                    );
                }
            }
        }
    }

    // Linear F0 interpolation between centres; clamped (held) outside the
    // first and last centre so the utterance neither starts nor ends on an
    // extrapolated pitch.
    let seg = 0;
    for (let f = 0; f < totalFrames; f++) {
        while (seg < n - 2 && f > centres[seg + 1]) seg += 1;
        if (n === 1 || f <= centres[0]) {
            frameF0Hz[f] = f0Hz[0];
            continue;
        }
        if (f >= centres[n - 1]) {
            frameF0Hz[f] = f0Hz[n - 1];
            continue;
        }
        const a = centres[seg];
        const b = centres[seg + 1];
        const t = b > a ? (f - a) / (b - a) : 0;
        frameF0Hz[f] = f0Hz[seg] + (f0Hz[seg + 1] - f0Hz[seg]) * t;
    }

    return { totalFrames, frameF0Hz, frameVoiced, frameToPhoneme, frameFeatures };
}

/**
 * Resample per-frame streams from one frame rate to another — the job
 * `spec/VoicePlan-v0.md` §5 assigns to this module for crossing between the
 * 100 Hz plan rate and the 125 Hz Activity rate.
 *
 * F0 is linearly interpolated (it is continuous); voicing and the phoneme
 * index use NEAREST-neighbour, because both are categorical and interpolating
 * them would invent values that do not exist (a half-voiced frame, or a
 * fractional phoneme id).
 */
export function resampleFrames(regulated, fromRateHz, toRateHz, featureDim = 0) {
    if (!Number.isFinite(fromRateHz) || fromRateHz <= 0 || !Number.isFinite(toRateHz) || toRateHz <= 0) {
        throw new RangeError('resampleFrames: frame rates must be positive');
    }
    const src = regulated.totalFrames;
    if (src === 0) return { ...regulated };
    if (fromRateHz === toRateHz) return { ...regulated };

    const ratio = toRateHz / fromRateHz;
    // Round so a whole number of source frames maps to a whole number of
    // target frames; at least one frame always survives.
    const dst = Math.max(1, Math.round(src * ratio));
    const frameF0Hz = new Float32Array(dst);
    const frameVoiced = new Uint8Array(dst);
    const frameToPhoneme = new Uint32Array(dst);
    const hasFeatures = regulated.frameFeatures !== null && featureDim > 0;
    const frameFeatures = hasFeatures ? new Float32Array(dst * featureDim) : null;

    for (let g = 0; g < dst; g++) {
        // Position in source-frame coordinates.
        const pos = dst === 1 ? 0 : (g * (src - 1)) / (dst - 1);
        const i0 = Math.floor(pos);
        const i1 = Math.min(src - 1, i0 + 1);
        const t = pos - i0;

        frameF0Hz[g] = regulated.frameF0Hz[i0] + (regulated.frameF0Hz[i1] - regulated.frameF0Hz[i0]) * t;
        const nearest = t < 0.5 ? i0 : i1;
        frameVoiced[g] = regulated.frameVoiced[nearest];
        frameToPhoneme[g] = regulated.frameToPhoneme[nearest];
        if (frameFeatures) {
            // Features are held, so nearest-neighbour keeps each frame's vector
            // a real phoneme's representation rather than a blend of two.
            for (let d = 0; d < featureDim; d++) {
                frameFeatures[g * featureDim + d] = regulated.frameFeatures[nearest * featureDim + d];
            }
        }
    }

    return { totalFrames: dst, frameF0Hz, frameVoiced, frameToPhoneme, frameFeatures };
}

export class LengthRegulator {
    constructor({ featureDim = 0, maxFrames = 1 << 20 } = {}) {
        this.featureDim = featureDim;
        this.maxFrames = maxFrames;
    }

    /**
     * @param {object} prosody `ProsodyPlanner.plan()` output.
     * @param {ArrayLike<number>|null} features `[numPhonemes, featureDim]` from `PhonemeEncoder`.
     * @param {{ targetFrameRateHz?: number }} [options]
     */
    expand(prosody, features = null, { targetFrameRateHz = null } = {}) {
        const regulated = regulateLength({
            durationFrames: prosody.durationFrames,
            f0Hz: prosody.f0Hz,
            voiced: prosody.voiced,
            features,
            featureDim: features ? this.featureDim : 0,
            maxFrames: this.maxFrames,
        });
        if (targetFrameRateHz === null || targetFrameRateHz === prosody.frameRateHz) {
            return { ...regulated, frameRateHz: prosody.frameRateHz };
        }
        const resampled = resampleFrames(regulated, prosody.frameRateHz, targetFrameRateHz, features ? this.featureDim : 0);
        return { ...resampled, frameRateHz: targetFrameRateHz };
    }
}

export function createLengthRegulator(options) {
    return new LengthRegulator(options);
}

export default LengthRegulator;
