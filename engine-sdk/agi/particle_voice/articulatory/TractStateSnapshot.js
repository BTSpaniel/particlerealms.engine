// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * TractStateSnapshot.js — Phase 2 Voice Box state schema (`v0`).
 *
 * `ARCHITECTURE.md` §4's `TractStateSnapshot`: "low-rate timestamped state
 * for rigs/visualization, decimated from the per-sample waveguide state".
 * The JS-side timestamped container for one
 * `nn/kernels/articulatory/visual_state_decimate.js` dispatch's output —
 * a `[channel, frame]` box-averaged field (one channel per tube section,
 * per that kernel's docstring), NOT the model-feedback (mean, RMS) shape
 * `PhysiologyFeedbackState.js` wraps (`physiology_feedback_reduce.js`'s
 * output) — the two are read by different consumers (a rig/visual system
 * here, the model's control loop there) and were kept as separate kernels
 * for exactly this reason (see `visual_state_decimate.js`'s own
 * docstring).
 *
 * Per `ARCHITECTURE.md` §4's requirement that visualization "must be
 * bit-identically disable-able without changing rendered PCM", this
 * container holds ONLY derived/decimated data for display — nothing here
 * is ever read back into the acoustic path, matching
 * `visual_state_decimate.js`'s structural read-only guarantee.
 */

/** @returns {object} A validated, timestamped `TractStateSnapshot` for one decimated field dispatch. */
export function createTractStateSnapshot({ sampleIndex, numChannels, numFrames, field }) {
    if (!Number.isInteger(sampleIndex) || sampleIndex < 0) throw new TypeError('TractStateSnapshot.sampleIndex must be a non-negative integer absolute sample counter');
    if (!Number.isInteger(numChannels) || numChannels <= 0) throw new TypeError('TractStateSnapshot.numChannels must be a positive integer');
    if (!Number.isInteger(numFrames) || numFrames <= 0) throw new TypeError('TractStateSnapshot.numFrames must be a positive integer');
    const expectedLength = numChannels * numFrames;
    if (!field || typeof field.length !== 'number' || field.length !== expectedLength) {
        throw new TypeError(`TractStateSnapshot.field must be an array-like of length numChannels*numFrames (${expectedLength})`);
    }
    return Object.freeze({ sampleIndex, numChannels, numFrames, field: Float32Array.from(field) });
}

/** Reads channel `channel`'s decimated time series out of a snapshot's flat `[channel, frame]` field — matches `visual_state_decimate.js`'s `(inst*num_channels+ch)*num_frames+frame` packing (single-instance view; the caller selects `channel`/`instance` slicing upstream of this helper). */
export function channelSeries(snapshot, channel) {
    if (!Number.isInteger(channel) || channel < 0 || channel >= snapshot.numChannels) {
        throw new RangeError(`TractStateSnapshot.channelSeries: channel must be in [0, ${snapshot.numChannels})`);
    }
    const start = channel * snapshot.numFrames;
    return snapshot.field.subarray(start, start + snapshot.numFrames);
}

export default createTractStateSnapshot;
