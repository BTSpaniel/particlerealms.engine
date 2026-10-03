// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * NeuralPhysiologyState.js — Phase 2 Voice Box state schema (`v0`).
 *
 * The model's predicted per-frame physiology state, per `ARCHITECTURE.md`
 * §4: four control heads plus an uncertainty head, version `0x00010000`.
 * This is a `v0` working definition of each head's field set — the heads
 * themselves are named and required by the plan, but their exact field
 * composition was not otherwise specified anywhere in the frozen `spec/`
 * documents, so the fields chosen here are deliberately the smallest set
 * that maps DIRECTLY onto an already-built, already-tested GPU kernel's
 * input parameters (not invented ahead of a consumer):
 *
 *   - `RespiratoryDriveHead.targetSubglottalPressure` → drives
 *     `BreathReservoirState`/`nn/kernels/articulatory/breath_reservoir.js`.
 *   - `GlottalStateHead` (`t0Samples`/`teSamples`/`tpSamples`/`taSamples`/
 *     `ee`) → the exact parameter names
 *     `nn/kernels/articulatory/glottal_lf.js` takes per instance.
 *   - `TractGestureHead.areas` → the area profile
 *     `nn/kernels/articulatory/tract_transfer.js`/`tract_waveguide.js`
 *     consume.
 *   - `ArticulationEventHead` (`constrictionIndex`/`constrictionAmplitude`/
 *     `nasalCoupling`, optional `releaseAspiration`) → drives
 *     `constriction_noise.js`/`nasal_junction.js`; the optional aspiration
 *     uses the existing independent glottal noise input during a stop release.
 *     The other controls select
 *     injection points (the actual multi-port coupling math those two
 *     kernels' docstrings still flag as deferred — this head only carries
 *     the control values, not a coupling implementation).
 *   - `UncertaintyHead.confidence` → a single scalar per-frame confidence,
 *     the minimal representation until a real model exists to justify a
 *     richer (e.g. per-head covariance) shape.
 *
 * Like every other `v0` document in this project, this field set may still
 * change before a `v1` freeze — it is not a claim that these are the final
 * head shapes, only that they are usable today and traceable to real
 * kernel inputs rather than speculative.
 *
 * Per `ARCHITECTURE.md` §4's timestamping rule, every state object here
 * carries the absolute sample counter it was produced at (`sampleIndex`),
 * never a chunk-relative index.
 */

export const NEURAL_PHYSIOLOGY_STATE_VERSION = 0x00010000;

/** @returns {object} A validated `NeuralPhysiologyState`, throwing on any missing/invalid required field rather than silently defaulting physiologically-meaningful values. */
export function createNeuralPhysiologyState({
    sampleIndex,
    respiratoryDrive,
    glottalState,
    tractGesture,
    articulationEvent = null,
    uncertainty = { confidence: 1 },
}) {
    if (!Number.isInteger(sampleIndex) || sampleIndex < 0) throw new TypeError('NeuralPhysiologyState.sampleIndex must be a non-negative integer absolute sample counter');
    validateRespiratoryDriveHead(respiratoryDrive);
    validateGlottalStateHead(glottalState);
    validateTractGestureHead(tractGesture);
    if (articulationEvent !== null) validateArticulationEventHead(articulationEvent);
    validateUncertaintyHead(uncertainty);

    return Object.freeze({
        version: NEURAL_PHYSIOLOGY_STATE_VERSION,
        sampleIndex,
        respiratoryDrive: Object.freeze({ ...respiratoryDrive }),
        glottalState: Object.freeze({ ...glottalState }),
        tractGesture: Object.freeze({ ...tractGesture, areas: Float32Array.from(tractGesture.areas) }),
        articulationEvent: articulationEvent === null ? null : Object.freeze({ ...articulationEvent }),
        uncertainty: Object.freeze({ ...uncertainty }),
    });
}

export function validateRespiratoryDriveHead(head) {
    if (!head || typeof head.targetSubglottalPressure !== 'number' || !Number.isFinite(head.targetSubglottalPressure)) {
        throw new TypeError('RespiratoryDriveHead.targetSubglottalPressure must be a finite number');
    }
    if (head.targetSubglottalPressure < 0) throw new RangeError('RespiratoryDriveHead.targetSubglottalPressure must be non-negative');
}

export function validateGlottalStateHead(head) {
    for (const field of ['t0Samples', 'teSamples', 'tpSamples', 'taSamples', 'ee']) {
        if (!head || typeof head[field] !== 'number' || !Number.isFinite(head[field]) || head[field] <= 0) {
            throw new TypeError(`GlottalStateHead.${field} must be a finite positive number`);
        }
    }
    if (!(head.tpSamples < head.teSamples && head.teSamples < head.t0Samples)) {
        throw new RangeError('GlottalStateHead requires 0 < tpSamples < teSamples < t0Samples (per glottal_lf.js\'s precondition)');
    }
}

export function validateTractGestureHead(head) {
    if (!head || !head.areas || typeof head.areas.length !== 'number' || head.areas.length < 2) {
        throw new TypeError('TractGestureHead.areas must be an array-like of at least 2 positive cross-sectional areas');
    }
    for (const area of head.areas) {
        if (typeof area !== 'number' || !Number.isFinite(area) || area <= 0) throw new RangeError('TractGestureHead.areas must contain only finite positive numbers');
    }
    if (head.glottalReflection !== undefined && Math.abs(head.glottalReflection) >= 1) throw new RangeError('TractGestureHead.glottalReflection must have magnitude < 1 for BIBO stability');
    if (head.lipReflection !== undefined && Math.abs(head.lipReflection) >= 1) throw new RangeError('TractGestureHead.lipReflection must have magnitude < 1 for BIBO stability');
}

export function validateArticulationEventHead(head) {
    if (head.releaseAspiration !== undefined && (!Number.isFinite(head.releaseAspiration) || head.releaseAspiration < 0)) {
        throw new TypeError('ArticulationEventHead.releaseAspiration must be a finite non-negative number when present');
    }
    if (head.constrictionIndex !== undefined && (!Number.isInteger(head.constrictionIndex) || head.constrictionIndex < 0)) {
        throw new TypeError('ArticulationEventHead.constrictionIndex must be a non-negative integer when present');
    }
    if (head.constrictionAmplitude !== undefined && (typeof head.constrictionAmplitude !== 'number' || head.constrictionAmplitude < 0)) {
        throw new TypeError('ArticulationEventHead.constrictionAmplitude must be a non-negative number when present');
    }
    if (head.nasalCoupling !== undefined && (typeof head.nasalCoupling !== 'number' || head.nasalCoupling < 0 || head.nasalCoupling > 1)) {
        throw new TypeError('ArticulationEventHead.nasalCoupling must be in [0, 1] when present');
    }
}

export function validateUncertaintyHead(head) {
    if (!head || typeof head.confidence !== 'number' || head.confidence < 0 || head.confidence > 1) {
        throw new TypeError('UncertaintyHead.confidence must be a number in [0, 1]');
    }
}

export default createNeuralPhysiologyState;
