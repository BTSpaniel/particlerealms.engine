// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { scoreActivity } from '../../../sim/ai/AIScheduler.js';
import { linearCurve } from '../../../sim/ai/AIUtility.js';
import { copyActorTaskData, freezeActorTaskData, requireActorTaskIdentifier } from './RegisteredMethods.js';

function record(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be a data record`);
    return value;
}
function finiteRange(value, minimum, maximum, label) {
    if (!Number.isFinite(value) || value < minimum || value > maximum) throw new RangeError(`${label} is outside its declared range`);
    return value;
}
function exact(value, fields, label) {
    record(value, label);
    if (Object.keys(value).length !== fields.length || fields.some(field => !Object.hasOwn(value, field))) throw new TypeError(`${label} requires exact declared fields`);
}

/**
 * Project explicit domain needs into the scheduler's satisfaction scale (0..1).
 * A25 deficits increase toward 100; engine satisfaction increases toward 1.
 * No missing need is invented, no actor is assumed human, and invalid/uncertain
 * numbers are rejected rather than clamped into an executable preference.
 */
export function normalizeActorNeeds({ values, scales } = {}) {
    const input = record(copyActorTaskData(values), 'Needs');
    const definitions = copyActorTaskData(scales);
    if (!Array.isArray(definitions) || !definitions.length || definitions.length > 32) throw new RangeError('Declare between one and 32 need scales');
    const result = {};
    for (const definition of definitions) {
        exact(definition, ['id', 'sourceKey', 'minimum', 'maximum', 'polarity'], 'Need scale');
        const { id, sourceKey, minimum, maximum, polarity } = definition;
        requireActorTaskIdentifier(id, 'need'); requireActorTaskIdentifier(sourceKey, 'source need');
        if (['constructor', 'prototype'].includes(id)) throw new TypeError('Need identity is a reserved data key');
        if (Object.hasOwn(result, id) || !Object.hasOwn(input, sourceKey)) throw new TypeError('Needs require distinct targets and present source values');
        if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum >= maximum
            || !Number.isFinite(maximum - minimum) || !['deficit', 'satisfaction'].includes(polarity)) throw new TypeError('Invalid need scale');
        const value = finiteRange(input[sourceKey], minimum, maximum, sourceKey);
        const normalized = (value - minimum) / (maximum - minimum);
        result[id] = linearCurve(polarity === 'deficit' ? -1 : 1, polarity === 'deficit' ? 1 : 0)(normalized);
    }
    return freezeActorTaskData(result);
}

/**
 * Rank a finite host-provided legal candidate set using the existing scheduler.
 * Legality requires an explicit host result, never inference from a dictionary
 * or utility score. The returned choice is only a proposal: task admission and
 * effect-revision checks still happen in ActorTaskRuntime and the world owner.
 */
export function rankActorActivities({ needs, candidates, methods, gameHour, limit = 8 } = {}) {
    const values = record(copyActorTaskData(needs), 'Normalized needs');
    if (!Object.keys(values).length || Object.keys(values).length > 32) throw new RangeError('Normalized need budget exceeded');
    for (const [name, value] of Object.entries(values)) { requireActorTaskIdentifier(name, 'need'); finiteRange(value, 0, 1, name); }
    finiteRange(gameHour, 0, 24, 'Simulation hour');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 64 || typeof methods?.expand !== 'function') throw new TypeError('A registered method catalog and bounded result count are required');
    const options = copyActorTaskData(candidates);
    if (!Array.isArray(options) || options.length > 64) throw new RangeError('At most 64 activity candidates may be scored');
    const ids = new Set(), ranked = [];
    for (const option of options) {
        exact(option, ['id', 'methodId', 'methodVersion', 'legal', 'activity'], 'Activity candidate');
        requireActorTaskIdentifier(option.id, 'candidate');
        if (ids.has(option.id) || typeof option.legal !== 'boolean') throw new TypeError('Candidates require unique identities and explicit legality');
        ids.add(option.id);
        if (!option.legal) continue;
        methods.expand(option.methodId, option.methodVersion);
        const activity = option.activity;
        exact(activity, ['needEffects', 'requirements', 'priorityBoosts', 'validHours'], 'Activity scores');
        for (const name of ['needEffects', 'requirements', 'priorityBoosts']) {
            for (const [need, amount] of Object.entries(record(activity[name], name))) {
                if (!Object.hasOwn(values, need)) throw new TypeError(`Activity references unknown need ${need}`);
                finiteRange(amount, name === 'needEffects' ? -1 : 0, name === 'priorityBoosts' ? 16 : 1, name);
            }
        }
        if (activity.validHours !== null) {
            exact(activity.validHours, ['start', 'end'], 'Activity hours');
            finiteRange(activity.validHours.start, 0, 24, 'Start hour');
            finiteRange(activity.validHours.end, 0, 24, 'End hour');
        }
        const score = scoreActivity(activity, values, gameHour);
        if (Number.isFinite(score) && score > 0) ranked.push({ candidateId: option.id, methodId: option.methodId,
            methodVersion: option.methodVersion, score, authority: 'proposal-only' });
    }
    ranked.sort((left, right) => right.score - left.score || (left.candidateId < right.candidateId ? -1 : left.candidateId > right.candidateId ? 1 : 0));
    return freezeActorTaskData(ranked.slice(0, limit));
}
