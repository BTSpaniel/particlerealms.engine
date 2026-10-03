// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Plan a bounded simulation batch without allowing a slow presentation frame
 * to turn into an unbounded catch-up spiral. Fixed mode drops whole excess
 * steps; coalesced mode widens each accepted step up to maximumStepSeconds.
 * Fixed mode may explicitly retain a bounded number of whole steps for the
 * next batch. The default preserves the existing excess-step drop policy.
 */
export function planBoundedFixedStepBatch({
    accumulatorSeconds = 0,
    frameDeltaSeconds = 0,
    fixedStepSeconds = 1 / 60,
    maximumStepSeconds = fixedStepSeconds,
    maximumSubsteps = 1,
    maximumFrameDeltaSeconds = 0.1,
    maximumRetainedSteps = 0,
} = {}) {
    if (!Number.isSafeInteger(maximumRetainedSteps) || maximumRetainedSteps < 0)
        throw new RangeError('Retained fixed steps must be a nonnegative safe integer');
    const fixedStep = Math.max(Number.MIN_VALUE, Number(fixedStepSeconds) || 0);
    const maximumStep = Math.max(fixedStep, Number(maximumStepSeconds) || fixedStep);
    const stepLimit = Math.max(1, Math.floor(Number(maximumSubsteps) || 1));
    const frameLimit = Math.max(fixedStep, Number(maximumFrameDeltaSeconds) || 0.1);
    const pending = Math.max(0, Number(accumulatorSeconds) || 0)
        + Math.max(0, Math.min(frameLimit, Number(frameDeltaSeconds) || 0));
    if (maximumRetainedSteps && maximumStep > fixedStep * (1 + 1e-9))
        throw new RangeError('Retained steps require fixed, uncoalesced integration');
    if (pending + 1e-12 < fixedStep) {
        return Object.freeze({
            substeps: 0,
            stepDeltaSeconds: Object.freeze([]),
            simulatedSeconds: 0,
            droppedSeconds: 0,
            remainingSeconds: pending,
            coalesced: false,
        });
    }

    let substeps;
    let simulatedSeconds;
    let stepDeltaSeconds;
    let remainingSeconds;
    let droppedSeconds = 0;
    const coalesced = maximumStep > fixedStep * (1 + 1e-9);
    if (!coalesced) {
        const available = Math.floor((pending + 1e-12) / fixedStep);
        substeps = Math.min(stepLimit, available);
        simulatedSeconds = substeps * fixedStep;
        droppedSeconds = Math.max(0, available - substeps - maximumRetainedSteps) * fixedStep;
        remainingSeconds = Math.max(0, pending - simulatedSeconds - droppedSeconds);
        stepDeltaSeconds = Array.from({ length: substeps }, () => fixedStep);
    } else {
        const required = Math.max(1, Math.ceil((pending - 1e-12) / maximumStep));
        substeps = Math.min(stepLimit, required);
        simulatedSeconds = Math.min(pending, substeps * maximumStep);
        const delta = simulatedSeconds / substeps;
        stepDeltaSeconds = Array.from({ length: substeps }, () => delta);
        remainingSeconds = Math.max(0, pending - simulatedSeconds);
        const discardedSteps = Math.floor((remainingSeconds + 1e-12) / fixedStep);
        droppedSeconds = discardedSteps * fixedStep;
        remainingSeconds = Math.max(0, remainingSeconds - droppedSeconds);
    }
    return Object.freeze({
        substeps,
        stepDeltaSeconds: Object.freeze(stepDeltaSeconds),
        simulatedSeconds,
        droppedSeconds,
        remainingSeconds,
        coalesced,
    });
}

export default planBoundedFixedStepBatch;
