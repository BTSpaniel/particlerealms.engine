// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ManualArticulator.js — Phase 3 ParticleVoice lab.
 *
 * Turns direct articulator controls (the Voice Box demo's sliders) into the
 * SAME physiology-stream shape `ArticulationHead.predict()` produces, so
 * `ParticleVoiceModel.renderPhysiology()` accepts it unchanged.
 *
 * ## Why this is a module and not inline demo code
 *
 * The plan requires the live demo to have "manual articulator mode + neural
 * mode; same `VisualAirflowState`". If manual mode built its own control path
 * — or worse, called `ParticleTract` directly — the two modes would diverge:
 * different smoothing, different validation, a different visualization source.
 * By emitting the identical stream shape, manual mode goes through exactly the
 * same `renderPhysiology()` → `ParticleTract` → `SafetyLimiter` path, and the
 * visualization comes from the same solver snapshots. That makes "same
 * VisualAirflowState" structural rather than a promise, and it means this
 * logic is testable headlessly instead of only by clicking.
 *
 * ## Controls
 *
 * Deliberately the physical knobs, not phonemes — the point of manual mode is
 * to drive the tract directly:
 *
 *   - `f0Hz`, `voiced` — glottal source
 *   - `constrictionPosition` (0 = glottis, 1 = lips) and `constrictionArea`
 *     — one moving constriction, the single most expressive articulator
 *   - `pharynxArea`, `lipArea` — the tube's two ends
 *   - `nasalCoupling` — velum
 *   - `fricationAmplitude` — turbulence at the constriction
 *   - `pressure` — subglottal drive
 *
 * A held pose is rendered as a constant stream; `interpolatePoses()` produces
 * a glide between two poses, which is how the demo can sweep a diphthong or a
 * closure/release gesture without hand-authoring every frame.
 */

import { shapedAreaProfile } from '../risk/KellyLochbaumWaveguide.js';
import { DEFAULT_TRACT_CONFIG } from '../articulatory/ParticleTract.js';
import { UNVOICED_EE, DEFAULT_ARTICULATION_CONFIG } from '../model/ArticulationHead.js';
import { PLAN_FRAME_RATE_HZ } from '../model/ProsodyPlanner.js';

export const DEFAULT_POSE = Object.freeze({
    f0Hz: 120,
    voiced: true,
    constrictionPosition: 0.5,
    constrictionArea: 1.5,
    pharynxArea: 3.0,
    lipArea: 2.5,
    nasalCoupling: 0,
    fricationAmplitude: 0,
    pressure: 800,
});

/** Slider metadata for the demo UI, kept beside the pose it describes so the two cannot drift apart. */
export const POSE_CONTROLS = Object.freeze([
    { key: 'f0Hz', label: 'Pitch (F0)', min: 60, max: 350, step: 1, unit: 'Hz' },
    { key: 'constrictionPosition', label: 'Constriction place', min: 0, max: 1, step: 0.01, unit: '0=glottis 1=lips' },
    { key: 'constrictionArea', label: 'Constriction area', min: 0.02, max: 4, step: 0.01, unit: 'cm²' },
    { key: 'pharynxArea', label: 'Pharynx area', min: 0.2, max: 6, step: 0.05, unit: 'cm²' },
    { key: 'lipArea', label: 'Lip area', min: 0.2, max: 6, step: 0.05, unit: 'cm²' },
    { key: 'nasalCoupling', label: 'Velum (nasal coupling)', min: 0, max: 1, step: 0.01, unit: '' },
    { key: 'fricationAmplitude', label: 'Frication', min: 0, max: 1, step: 0.01, unit: '' },
    { key: 'pressure', label: 'Subglottal pressure', min: 0, max: 1600, step: 10, unit: '' },
]);

/** Validate and clamp a partial pose into a complete one. */
export function normalizePose(pose = {}) {
    const merged = { ...DEFAULT_POSE, ...pose };
    if (!Number.isFinite(merged.f0Hz) || merged.f0Hz <= 0) throw new RangeError('ManualArticulator: f0Hz must be positive');
    if (!Number.isFinite(merged.pressure) || merged.pressure < 0) throw new RangeError('ManualArticulator: pressure must be non-negative');
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    return {
        f0Hz: clamp(merged.f0Hz, 40, 600),
        voiced: Boolean(merged.voiced),
        constrictionPosition: clamp(merged.constrictionPosition, 0, 1),
        // Areas are clamped strictly ABOVE zero: `reflectionCoefficients`
        // divides by (A_i + A_{i+1}), and a zero area would also be rejected by
        // NeuralPhysiologyState's validator.
        constrictionArea: clamp(merged.constrictionArea, 0.01, 20),
        pharynxArea: clamp(merged.pharynxArea, 0.01, 20),
        lipArea: clamp(merged.lipArea, 0.01, 20),
        nasalCoupling: clamp(merged.nasalCoupling, 0, 1),
        fricationAmplitude: clamp(merged.fricationAmplitude, 0, 1),
        pressure: clamp(merged.pressure, 0, 5000),
    };
}

/** Linear blend between two poses; `voiced` switches at the midpoint since it is boolean. */
export function interpolatePoses(a, b, t) {
    const from = normalizePose(a);
    const to = normalizePose(b);
    const k = Math.min(1, Math.max(0, t));
    const lerp = (x, y) => x + (y - x) * k;
    return normalizePose({
        f0Hz: lerp(from.f0Hz, to.f0Hz),
        voiced: k < 0.5 ? from.voiced : to.voiced,
        constrictionPosition: lerp(from.constrictionPosition, to.constrictionPosition),
        constrictionArea: lerp(from.constrictionArea, to.constrictionArea),
        pharynxArea: lerp(from.pharynxArea, to.pharynxArea),
        lipArea: lerp(from.lipArea, to.lipArea),
        nasalCoupling: lerp(from.nasalCoupling, to.nasalCoupling),
        fricationAmplitude: lerp(from.fricationAmplitude, to.fricationAmplitude),
        pressure: lerp(from.pressure, to.pressure),
    });
}

/** Area profile for one pose, using the same 3-control-point `shapedAreaProfile` shape `ArticulationHead` uses for vowels. */
export function poseAreaProfile(pose, numSections) {
    const p = normalizePose(pose);
    const points = [
        { pos: 0, area: p.pharynxArea },
        { pos: p.constrictionPosition, area: p.constrictionArea },
        { pos: 1, area: p.lipArea },
    ].sort((x, y) => x.pos - y.pos);
    return shapedAreaProfile(numSections, points);
}

export class ManualArticulator {
    constructor({ sampleRate, numSections = DEFAULT_TRACT_CONFIG.numSections, frameRateHz = PLAN_FRAME_RATE_HZ, lfShape = {} } = {}) {
        if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new RangeError('ManualArticulator: sampleRate must be positive');
        if (!Number.isInteger(numSections) || numSections < 4) throw new RangeError('ManualArticulator: numSections must be an integer >= 4');
        if (!Number.isFinite(frameRateHz) || frameRateHz <= 0) throw new RangeError('ManualArticulator: frameRateHz must be positive');
        this.sampleRate = sampleRate;
        this.numSections = numSections;
        this.frameRateHz = frameRateHz;
        this.lfShape = {
            openQuotient: DEFAULT_ARTICULATION_CONFIG.openQuotient,
            peakQuotient: DEFAULT_ARTICULATION_CONFIG.peakQuotient,
            returnQuotient: DEFAULT_ARTICULATION_CONFIG.returnQuotient,
            voicedEe: DEFAULT_ARTICULATION_CONFIG.voicedEe,
            ...lfShape,
        };
    }

    /**
     * Build a physiology stream from a per-frame pose function — the identical
     * shape `ArticulationHead.predict()` returns, so
     * `ParticleVoiceModel.renderPhysiology()` consumes it unchanged.
     *
     * @param {number} totalFrames
     * @param {(frame: number, totalFrames: number) => object} poseAt
     * @param {{ startSample?: number }} [options]
     */
    build(totalFrames, poseAt, { startSample = 0 } = {}) {
        if (!Number.isInteger(totalFrames) || totalFrames <= 0) throw new RangeError('ManualArticulator: totalFrames must be a positive integer');
        if (typeof poseAt !== 'function') throw new TypeError('ManualArticulator: poseAt must be a function');
        if (!Number.isInteger(startSample) || startSample < 0) throw new RangeError('ManualArticulator: startSample must be a non-negative integer');

        const S = this.numSections;
        const shape = this.lfShape;
        const result = {
            totalFrames,
            numSections: S,
            sampleRate: this.sampleRate,
            frameRateHz: this.frameRateHz,
            areas: new Float32Array(totalFrames * S),
            t0Samples: new Float32Array(totalFrames),
            teSamples: new Float32Array(totalFrames),
            tpSamples: new Float32Array(totalFrames),
            taSamples: new Float32Array(totalFrames),
            ee: new Float32Array(totalFrames),
            pressure: new Float32Array(totalFrames),
            constrictionIndex: new Int32Array(totalFrames),
            constrictionAmplitude: new Float32Array(totalFrames),
            nasalCoupling: new Float32Array(totalFrames),
            confidence: new Float32Array(totalFrames).fill(1),
            sampleIndex: new Float64Array(totalFrames),
        };

        for (let f = 0; f < totalFrames; f++) {
            const pose = normalizePose(poseAt(f, totalFrames));
            result.areas.set(poseAreaProfile(pose, S), f * S);

            const t0 = this.sampleRate / pose.f0Hz;
            result.t0Samples[f] = t0;
            result.teSamples[f] = shape.openQuotient * t0;
            result.tpSamples[f] = shape.peakQuotient * shape.openQuotient * t0;
            result.taSamples[f] = shape.returnQuotient * t0;
            // Same non-negotiable invariant as ArticulationHead: `ee` must be
            // strictly positive or glottal_lf's Newton solve yields NaN and
            // poisons every later chunk through the persisted waveguide state.
            result.ee[f] = pose.voiced ? shape.voicedEe : UNVOICED_EE;
            result.pressure[f] = pose.pressure;

            // Junction i couples sections i and i+1, so the highest legal index
            // is numSections - 2 (ParticleTract enforces the same bound).
            result.constrictionIndex[f] = Math.min(
                S - 2,
                Math.max(0, Math.round(pose.constrictionPosition * (S - 1))),
            );
            result.constrictionAmplitude[f] = pose.fricationAmplitude;
            result.nasalCoupling[f] = pose.nasalCoupling;
            result.sampleIndex[f] = startSample + Math.round((f * this.sampleRate) / this.frameRateHz);
        }
        return result;
    }

    /** A single held pose for `seconds` — the "move a slider and listen" case. */
    hold(pose, seconds, options) {
        const totalFrames = Math.max(1, Math.round(seconds * this.frameRateHz));
        const fixed = normalizePose(pose);
        return this.build(totalFrames, () => fixed, options);
    }

    /**
     * Glide through a list of poses over `seconds`, spending equal time on each
     * leg. Two poses give a simple transition; three or more let the demo trace
     * a closure/release or a diphthong.
     */
    glide(poses, seconds, options) {
        if (!Array.isArray(poses) || poses.length < 2) throw new RangeError('ManualArticulator.glide requires at least 2 poses');
        const totalFrames = Math.max(2, Math.round(seconds * this.frameRateHz));
        const legs = poses.length - 1;
        return this.build(totalFrames, (f, total) => {
            const progress = total > 1 ? f / (total - 1) : 0;
            const scaled = Math.min(legs - 1e-9, progress * legs);
            const leg = Math.floor(scaled);
            return interpolatePoses(poses[leg], poses[leg + 1], scaled - leg);
        }, options);
    }
}

export function createManualArticulator(options) {
    return new ManualArticulator(options);
}

export default ManualArticulator;
