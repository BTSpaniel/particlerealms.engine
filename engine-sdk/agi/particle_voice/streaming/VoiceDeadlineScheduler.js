// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * VoiceDeadlineScheduler.js — Phase 2 ParticleVoice audio bridge.
 *
 * "VoiceDeadlineScheduler.js — target >=300 ms, warning 200 ms, emergency
 * 100 ms; GPU budget admission." These three thresholds classify how much
 * PLAYBACK RUNWAY remains — how far ahead of the AudioContext's current
 * playback position the produced-but-not-yet-played PCM currently extends
 * (`bufferedAheadMs`, typically derived from `SharedPCMRing.js`'s
 * `readAvailable()` via `bufferedAheadMsFromRing()` below) — into an
 * urgency tier, and maps that tier onto EXISTING scheduling primitives
 * rather than inventing new ones:
 *
 *   - `NeuralScheduler.js`'s `'high'|'normal'|'low'` priority buckets
 *     (queue ordering among pending `ParticleProgram` runs).
 *   - `engine/core/gpu/GpuFrameBudgetBroker.js`'s `workClass ===
 *     'render-critical'` bypass (`beforeSubmit()`'s own docstring: "Render-
 *     critical work bypasses the budget") — this IS the "GPU budget
 *     admission" the plan names: in the `emergency` tier, this module
 *     recommends `workClass: 'render-critical'` so the broker admits the
 *     work immediately regardless of the current frame's compute budget,
 *     rather than letting a nearly-starved voice ring wait behind
 *     unrelated background GPU work.
 *
 * Tier boundaries (this module's own `v0` interpretation of the plan's
 * three named thresholds — documented explicitly since the plan states
 * three thresholds but only two transitions are unambiguous from the
 * wording alone):
 *
 *   bufferedAheadMs >= 300         -> 'target'      (healthy, target met)
 *   200 <= bufferedAheadMs < 300   -> 'belowTarget'  (below target, not yet urgent)
 *   100 <= bufferedAheadMs < 200   -> 'warning'
 *   bufferedAheadMs < 100          -> 'emergency'
 */

import { readAvailable } from './SharedPCMRing.js';

export const TARGET_BUFFERED_MS = 300;
export const WARNING_BUFFERED_MS = 200;
export const EMERGENCY_BUFFERED_MS = 100;

const TIER_ADMISSION = Object.freeze({
    target: Object.freeze({ priority: 'low', workClass: 'background' }),
    belowTarget: Object.freeze({ priority: 'normal', workClass: 'background' }),
    warning: Object.freeze({ priority: 'high', workClass: 'background' }),
    emergency: Object.freeze({ priority: 'high', workClass: 'render-critical' }),
});

/** @returns {'target'|'belowTarget'|'warning'|'emergency'} */
export function classifyDeadlineTier(bufferedAheadMs) {
    if (!Number.isFinite(bufferedAheadMs)) throw new TypeError('classifyDeadlineTier: bufferedAheadMs must be a finite number');
    if (bufferedAheadMs < EMERGENCY_BUFFERED_MS) return 'emergency';
    if (bufferedAheadMs < WARNING_BUFFERED_MS) return 'warning';
    if (bufferedAheadMs < TARGET_BUFFERED_MS) return 'belowTarget';
    return 'target';
}

/**
 * @returns {{ tier: string, priority: 'high'|'normal'|'low', workClass: 'background'|'render-critical' }}
 * `priority` is meant for `NeuralScheduler.enqueue()`'s `priority` option;
 * `workClass` is meant for `GpuFrameBudgetBroker.submit()`/`beforeSubmit()`'s
 * `workClass` option (also accepted by `NeuralExecutor.run()`'s
 * `dispatchOptions` and forwarded straight through to the broker) — the
 * returned object's shape is deliberately spreadable directly into either
 * call's options.
 */
export function admissionFor(bufferedAheadMs) {
    const tier = classifyDeadlineTier(bufferedAheadMs);
    return { tier, ...TIER_ADMISSION[tier] };
}

/** Composes with `SharedPCMRing.js`'s `readAvailable()` — the natural real-world source of `bufferedAheadMs` for a live audio bridge — rather than re-deriving ring-position arithmetic here. */
export function bufferedAheadMsFromRing(ring) {
    const availableSamples = readAvailable(ring.control, ring.capacity);
    return (availableSamples / ring.sampleRate) * 1000;
}

export class VoiceDeadlineScheduler {
    constructor() {
        this._lastBufferedAheadMs = Infinity;
        this._lastTier = 'target';
    }

    /** @returns {ReturnType<typeof admissionFor> & { bufferedAheadMs: number }} */
    update(bufferedAheadMs) {
        const result = admissionFor(bufferedAheadMs);
        this._lastBufferedAheadMs = bufferedAheadMs;
        this._lastTier = result.tier;
        return { bufferedAheadMs, ...result };
    }

    /** Returns the most recently computed admission decision without recomputing it (e.g. for a caller that only wants to inspect current state between `update()` calls). */
    current() {
        return { bufferedAheadMs: this._lastBufferedAheadMs, ...admissionFor(this._lastBufferedAheadMs) };
    }

    isEmergency() {
        return this._lastTier === 'emergency';
    }
}

export default VoiceDeadlineScheduler;
