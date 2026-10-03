// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Strict immutable phase-state, family, request, and receipt contracts. */

import {
    cloneStrictJson,
    deepFreezeJson,
    isPlainJsonObject,
} from '../../core/schema/StrictJsonValue.js';

export const PHASE_FAMILY_SCHEMA = 'engine.matter.phase-family';
export const PHASE_STATE_SCHEMA = 'engine.matter.phase-state';
export const PHASE_TRANSCODE_REQUEST_SCHEMA = 'engine.matter.phase-transcode-request';
export const PHASE_TRANSCODE_RECEIPT_SCHEMA = 'engine.matter.phase-transcode-receipt';
export const PHASE_TRANSCODER_SNAPSHOT_SCHEMA = 'engine.matter.atomic-phase-transcoder';
export const PHASE_TRANSCODE_VERSION = '1.0.0';

export const PHASE_STRUCTURAL_MODES = Object.freeze(['preserve', 'weaken', 'delete']);
export const PHASE_TRANSACTION_STATES = Object.freeze([
    'prepared', 'applying', 'interrupted', 'committed', 'aborted',
]);

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,191}$/;
const FAMILY_KEYS = new Set(['schema', 'schemaVersion', 'id', 'label', 'phases', 'transitions']);
const TRANSITION_KEYS = new Set([
    'fromPhaseId', 'toPhaseId', 'minimumTemperatureK', 'maximumTemperatureK',
    'deltaBounds', 'structuralMode', 'minimumDamageDelta',
]);
const DELTA_KEYS = new Set(['materialMassKg', 'waterMassKg', 'internalEnergyJ']);
const BOUNDS_KEYS = new Set(['minimum', 'maximum']);
const STATE_KEYS = new Set([
    'schema', 'schemaVersion', 'regionId', 'familyId', 'phaseId', 'revision',
    'deviceGeneration', 'timeBinExponent', 'temperatureK', 'reservoirs',
    'structuralNodeIds',
]);
const REQUEST_KEYS = new Set([
    'schema', 'schemaVersion', 'transactionId', 'regionId', 'familyId',
    'expectedRevision', 'expectedDeviceGeneration', 'fromPhaseId', 'toPhaseId',
    'temperatureK', 'reservoirDelta', 'structuralPolicy', 'requestedTimeBinExponent',
]);
const POLICY_KEYS = new Set(['mode', 'damageDelta']);
const RECEIPT_KEYS = new Set([
    'schema', 'schemaVersion', 'transactionId', 'status', 'recovered', 'before',
    'after', 'reservoirDelta', 'deletedBondIds', 'weakenedBondIds',
]);

function fail(path, message) { throw new TypeError(`${path}: ${message}`); }

function exact(value, allowed, required, path) {
    if (!isPlainJsonObject(value)) fail(path, 'must be a plain object');
    for (const key of Object.keys(value)) if (!allowed.has(key)) fail(`${path}.${key}`, 'unknown field');
    for (const key of required) if (!Object.hasOwn(value, key)) fail(`${path}.${key}`, 'is required');
    return value;
}

function identifier(value, path) {
    if (typeof value !== 'string' || !IDENTIFIER.test(value)) fail(path, 'has invalid identifier syntax');
    return value;
}

function text(value, path) {
    if (typeof value !== 'string' || value.length === 0 || value.length > 256
        || /[\u0000-\u001f\u007f]/.test(value)) fail(path, 'must be a bounded control-free string');
    return value;
}

function finite(value, path, minimum = -Number.MAX_VALUE, maximum = Number.MAX_VALUE) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
        fail(path, `must be finite in [${minimum}, ${maximum}]`);
    }
    return value;
}

function integer(value, path, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
        fail(path, `must be a safe integer in [${minimum}, ${maximum}]`);
    }
    return value;
}

function identifierArray(value, path, allowEmpty = true) {
    if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) fail(path, 'must be an array');
    const seen = new Set();
    value.forEach((entry, index) => {
        const id = identifier(entry, `${path}[${index}]`);
        if (seen.has(id)) fail(`${path}[${index}]`, 'duplicates an earlier identifier');
        if (index > 0 && value[index - 1].localeCompare(id) >= 0) fail(path, 'must be strictly sorted');
        seen.add(id);
    });
    return value;
}

function delta(value, path, nonnegative = false) {
    exact(value, DELTA_KEYS, DELTA_KEYS, path);
    for (const key of DELTA_KEYS) finite(value[key], `${path}.${key}`, nonnegative ? 0 : -Number.MAX_VALUE);
    if (nonnegative && value.materialMassKg <= 0) fail(`${path}.materialMassKg`, 'must be greater than zero');
    return value;
}

function bounds(value, path) {
    exact(value, BOUNDS_KEYS, BOUNDS_KEYS, path);
    finite(value.minimum, `${path}.minimum`);
    finite(value.maximum, `${path}.maximum`);
    if (value.minimum > value.maximum) fail(path, 'minimum must not exceed maximum');
    return value;
}

function validateFamily(value, path) {
    exact(value, FAMILY_KEYS, FAMILY_KEYS, path);
    if (value.schema !== PHASE_FAMILY_SCHEMA || value.schemaVersion !== PHASE_TRANSCODE_VERSION) {
        fail(path, 'uses an unsupported schema');
    }
    identifier(value.id, `${path}.id`);
    text(value.label, `${path}.label`);
    identifierArray(value.phases, `${path}.phases`, false);
    if (!Array.isArray(value.transitions) || value.transitions.length === 0 || value.transitions.length > 256) {
        fail(`${path}.transitions`, 'must be a bounded non-empty array');
    }
    const phases = new Set(value.phases);
    const pairs = new Set();
    value.transitions.forEach((transition, index) => {
        const at = `${path}.transitions[${index}]`;
        exact(transition, TRANSITION_KEYS, TRANSITION_KEYS, at);
        const from = identifier(transition.fromPhaseId, `${at}.fromPhaseId`);
        const to = identifier(transition.toPhaseId, `${at}.toPhaseId`);
        if (!phases.has(from) || !phases.has(to) || from === to) fail(at, 'must connect distinct declared phases');
        const pair = `${from}->${to}`;
        if (pairs.has(pair)) fail(at, 'duplicates an earlier transition');
        pairs.add(pair);
        finite(transition.minimumTemperatureK, `${at}.minimumTemperatureK`, 0);
        finite(transition.maximumTemperatureK, `${at}.maximumTemperatureK`, 0);
        if (transition.minimumTemperatureK > transition.maximumTemperatureK) fail(at, 'temperature bounds are inverted');
        exact(transition.deltaBounds, DELTA_KEYS, DELTA_KEYS, `${at}.deltaBounds`);
        for (const key of DELTA_KEYS) bounds(transition.deltaBounds[key], `${at}.deltaBounds.${key}`);
        if (!PHASE_STRUCTURAL_MODES.includes(transition.structuralMode)) fail(`${at}.structuralMode`, 'is unsupported');
        finite(transition.minimumDamageDelta, `${at}.minimumDamageDelta`, 0, 1);
        if (transition.structuralMode !== 'weaken' && transition.minimumDamageDelta !== 0) {
            fail(`${at}.minimumDamageDelta`, 'must be zero unless structuralMode is weaken');
        }
    });
    return value;
}

function validateState(value, path) {
    exact(value, STATE_KEYS, STATE_KEYS, path);
    if (value.schema !== PHASE_STATE_SCHEMA || value.schemaVersion !== PHASE_TRANSCODE_VERSION) {
        fail(path, 'uses an unsupported schema');
    }
    for (const key of ['regionId', 'familyId', 'phaseId']) identifier(value[key], `${path}.${key}`);
    integer(value.revision, `${path}.revision`);
    integer(value.deviceGeneration, `${path}.deviceGeneration`);
    integer(value.timeBinExponent, `${path}.timeBinExponent`, 0, 30);
    finite(value.temperatureK, `${path}.temperatureK`, 0);
    delta(value.reservoirs, `${path}.reservoirs`, true);
    identifierArray(value.structuralNodeIds, `${path}.structuralNodeIds`);
    return value;
}

function validateRequest(value, path) {
    exact(value, REQUEST_KEYS, REQUEST_KEYS, path);
    if (value.schema !== PHASE_TRANSCODE_REQUEST_SCHEMA || value.schemaVersion !== PHASE_TRANSCODE_VERSION) {
        fail(path, 'uses an unsupported schema');
    }
    for (const key of ['transactionId', 'regionId', 'familyId', 'fromPhaseId', 'toPhaseId']) {
        identifier(value[key], `${path}.${key}`);
    }
    if (value.fromPhaseId === value.toPhaseId) fail(path, 'must change phase');
    integer(value.expectedRevision, `${path}.expectedRevision`);
    integer(value.expectedDeviceGeneration, `${path}.expectedDeviceGeneration`);
    integer(value.requestedTimeBinExponent, `${path}.requestedTimeBinExponent`, 0, 30);
    finite(value.temperatureK, `${path}.temperatureK`, 0);
    delta(value.reservoirDelta, `${path}.reservoirDelta`);
    exact(value.structuralPolicy, POLICY_KEYS, POLICY_KEYS, `${path}.structuralPolicy`);
    if (!PHASE_STRUCTURAL_MODES.includes(value.structuralPolicy.mode)) {
        fail(`${path}.structuralPolicy.mode`, 'is unsupported');
    }
    finite(value.structuralPolicy.damageDelta, `${path}.structuralPolicy.damageDelta`, 0, 1);
    if (value.structuralPolicy.mode !== 'weaken' && value.structuralPolicy.damageDelta !== 0) {
        fail(`${path}.structuralPolicy.damageDelta`, 'must be zero unless mode is weaken');
    }
    return value;
}

function validateReceipt(value, path) {
    exact(value, RECEIPT_KEYS, RECEIPT_KEYS, path);
    if (value.schema !== PHASE_TRANSCODE_RECEIPT_SCHEMA || value.schemaVersion !== PHASE_TRANSCODE_VERSION) {
        fail(path, 'uses an unsupported schema');
    }
    identifier(value.transactionId, `${path}.transactionId`);
    if (value.status !== 'committed') fail(`${path}.status`, 'must be committed');
    if (typeof value.recovered !== 'boolean') fail(`${path}.recovered`, 'must be boolean');
    validateState(value.before, `${path}.before`);
    validateState(value.after, `${path}.after`);
    delta(value.reservoirDelta, `${path}.reservoirDelta`);
    identifierArray(value.deletedBondIds, `${path}.deletedBondIds`);
    identifierArray(value.weakenedBondIds, `${path}.weakenedBondIds`);
    if (value.before.regionId !== value.after.regionId || value.before.familyId !== value.after.familyId) {
        fail(path, 'before and after identity must match');
    }
    if (value.after.revision !== value.before.revision + 1) fail(`${path}.after.revision`, 'must advance exactly once');
    if (value.after.deviceGeneration !== value.before.deviceGeneration) {
        fail(`${path}.after.deviceGeneration`, 'must not change during a transaction');
    }
    for (const key of DELTA_KEYS) {
        if (value.after.reservoirs[key] !== value.before.reservoirs[key] + value.reservoirDelta[key]) {
            fail(`${path}.reservoirDelta.${key}`, 'does not reconcile before and after reservoirs');
        }
    }
    const deleted = new Set(value.deletedBondIds);
    if (value.weakenedBondIds.some(id => deleted.has(id))) fail(path, 'a bond cannot be weakened and deleted');
    return value;
}

function stamp(input, schema, path) {
    const candidate = cloneStrictJson(input, path);
    if (!isPlainJsonObject(candidate)) fail(path, 'must be a plain object');
    if (candidate.schema != null && candidate.schema !== schema) fail(`${path}.schema`, 'is unsupported');
    if (candidate.schemaVersion != null && candidate.schemaVersion !== PHASE_TRANSCODE_VERSION) {
        fail(`${path}.schemaVersion`, 'is unsupported');
    }
    return { ...candidate, schema, schemaVersion: PHASE_TRANSCODE_VERSION };
}

function make(input, schema, path, validator) {
    const value = stamp(input, schema, path);
    validator(value, path);
    return deepFreezeJson(value, path);
}

function validateExisting(value, path, validator) {
    validator(cloneStrictJson(value, path), path);
    return true;
}

export function createPhaseFamilyProfile(input) {
    return make(input, PHASE_FAMILY_SCHEMA, '$.phaseFamily', validateFamily);
}

export function validatePhaseFamilyProfile(value, path = '$.phaseFamily') {
    return validateExisting(value, String(path), validateFamily);
}

export function createPhaseState(input) {
    return make(input, PHASE_STATE_SCHEMA, '$.phaseState', validateState);
}

export function validatePhaseState(value, path = '$.phaseState') {
    return validateExisting(value, String(path), validateState);
}

export function createPhaseTranscodeRequest(input) {
    return make(input, PHASE_TRANSCODE_REQUEST_SCHEMA, '$.transcodeRequest', validateRequest);
}

export function validatePhaseTranscodeRequest(value, path = '$.transcodeRequest') {
    return validateExisting(value, String(path), validateRequest);
}

export function createPhaseTranscodeReceipt(input) {
    return make(input, PHASE_TRANSCODE_RECEIPT_SCHEMA, '$.transcodeReceipt', validateReceipt);
}

export function validatePhaseTranscodeReceipt(value, path = '$.transcodeReceipt') {
    return validateExisting(value, String(path), validateReceipt);
}
