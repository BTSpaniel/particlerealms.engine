// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Deterministic power-of-two scheduling for structural and transcode work. */

import { cloneAndFreezeStrictJson, cloneStrictJson, isPlainJsonObject } from '../../core/schema/StrictJsonValue.js';

export const MAX_STRUCTURAL_TIME_BIN_EXPONENT = 30;

function fail(path, message) {
    throw new TypeError(`${path}: ${message}`);
}

function integer(value, path, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
        fail(path, `must be a safe integer in [${minimum}, ${maximum}]`);
    }
    return value;
}

function finite(value, path, minimum = 0) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) {
        fail(path, `must be finite and at least ${minimum}`);
    }
    return value;
}

function exact(value, allowed, required, path) {
    if (!isPlainJsonObject(value)) fail(path, 'must be a plain object');
    for (const key of Object.keys(value)) if (!allowed.has(key)) fail(`${path}.${key}`, 'unknown field');
    for (const key of required) if (!Object.hasOwn(value, key)) fail(`${path}.${key}`, 'is required');
    return value;
}

export function createPowerOfTwoTimeBin(exponentInput) {
    const exponent = integer(
        exponentInput,
        '$.timeBinExponent',
        0,
        MAX_STRUCTURAL_TIME_BIN_EXPONENT,
    );
    return Object.freeze({ exponent, intervalSteps: 2 ** exponent });
}

export function shouldRunPowerOfTwoTimeBin(stepIndexInput, exponentInput) {
    const stepIndex = integer(stepIndexInput, '$.stepIndex');
    const { intervalSteps } = createPowerOfTwoTimeBin(exponentInput);
    return stepIndex % intervalSteps === 0;
}

export function selectPowerOfTwoTimeBin(input) {
    const candidate = cloneStrictJson(input, '$.timeBinSelection');
    exact(candidate, new Set([
        'currentExponent', 'maximumExponent', 'predictedTimeToImpactS',
        'baseStepSeconds', 'strainRatio', 'phaseChanging', 'interacting',
    ]), new Set([
        'currentExponent', 'maximumExponent', 'predictedTimeToImpactS',
        'baseStepSeconds', 'strainRatio', 'phaseChanging', 'interacting',
    ]), '$.timeBinSelection');
    const current = integer(candidate.currentExponent, '$.timeBinSelection.currentExponent', 0, 30);
    const maximum = integer(candidate.maximumExponent, '$.timeBinSelection.maximumExponent', 0, 30);
    if (current > maximum) fail('$.timeBinSelection.currentExponent', 'must not exceed maximumExponent');
    const impact = candidate.predictedTimeToImpactS === null
        ? null
        : finite(candidate.predictedTimeToImpactS, '$.timeBinSelection.predictedTimeToImpactS');
    const baseStep = finite(candidate.baseStepSeconds, '$.timeBinSelection.baseStepSeconds', Number.MIN_VALUE);
    const strainRatio = finite(candidate.strainRatio, '$.timeBinSelection.strainRatio');
    if (typeof candidate.phaseChanging !== 'boolean' || typeof candidate.interacting !== 'boolean') {
        fail('$.timeBinSelection', 'phaseChanging and interacting must be booleans');
    }

    let exponent = current;
    const imminent = impact !== null && impact <= baseStep * (2 ** current);
    if (candidate.phaseChanging || candidate.interacting || imminent || strainRatio >= 1) {
        exponent = 0;
    } else if (strainRatio < 0.25 && (impact === null || impact > baseStep * (2 ** (current + 1)))) {
        exponent = Math.min(maximum, current + 1);
    }
    return cloneAndFreezeStrictJson({
        exponent,
        intervalSteps: 2 ** exponent,
        promoted: exponent < current,
        demoted: exponent > current,
        reason: candidate.phaseChanging
            ? 'phase-change'
            : candidate.interacting
                ? 'interaction'
                : imminent
                    ? 'predicted-impact'
                    : strainRatio >= 1
                        ? 'yield-risk'
                        : exponent > current
                            ? 'quiescent'
                            : 'unchanged',
    });
}
