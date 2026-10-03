// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Strict immutable contracts for structural profiles, bonds, fracture, and topology. */

import {
    cloneStrictJson,
    deepFreezeJson,
    isPlainJsonObject,
} from '../../core/schema/StrictJsonValue.js';

export const STRUCTURAL_PROFILE_SCHEMA = 'engine.matter.structural-profile';
export const STRUCTURAL_BOND_SCHEMA = 'engine.matter.structural-bond';
export const STRUCTURAL_TOPOLOGY_SCHEMA = 'engine.matter.structural-topology';
export const STRUCTURAL_CRACK_SCHEMA = 'engine.matter.structural-crack-residual';
export const STRUCTURAL_AGGREGATE_SCHEMA = 'engine.matter.rigid-aggregate';
export const STRUCTURAL_REFINEMENT_SCHEMA = 'engine.matter.structural-refinement-request';
export const STRUCTURAL_SCHEMA_VERSION = '1.0.0';

export const STRUCTURAL_CONSTRAINT_MODES = Object.freeze([
    'tension', 'compression', 'shear', 'bend',
]);
export const STRUCTURAL_BOND_STAGES = Object.freeze([
    'elastic', 'yield', 'plastic', 'fatigue', 'damage', 'fracture',
]);
export const STRUCTURAL_REFINEMENT_REASONS = Object.freeze([
    'impact', 'stress', 'crack', 'phase', 'contact',
]);

const MODES = new Set(STRUCTURAL_CONSTRAINT_MODES);
const STAGES = new Set(STRUCTURAL_BOND_STAGES);
const REASONS = new Set(STRUCTURAL_REFINEMENT_REASONS);
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,191}$/;
const PROFILE_KEYS = new Set([
    'schema', 'schemaVersion', 'id', 'label', 'complianceMPerN', 'yieldStrain',
    'plasticRatePerSecond', 'fatigueRatePerSecond', 'damageRatePerSecond',
    'fractureStrain', 'thermalSofteningStartK', 'thermalFailureK',
    'recoveryRatePerSecond', 'anisotropy',
]);
const MODE_KEYS = new Set(STRUCTURAL_CONSTRAINT_MODES);
const ANISOTROPY_KEYS = new Set(['axis', 'alongScale', 'crossScale']);
const BOND_KEYS = new Set([
    'schema', 'schemaVersion', 'id', 'nodeAId', 'nodeBId', 'profileId',
    'restLengthM', 'plasticRestLengthM', 'restDirection', 'bendRestRadians',
    'lambda', 'lifecycle', 'fatigue', 'damage', 'revision', 'timeBinExponent',
]);
const NODE_KEYS = new Set([
    'id', 'positionM', 'previousPositionM', 'velocityMPerS', 'massKg',
    'inverseMassPerKg',
]);
const CRACK_KEYS = new Set([
    'schema', 'schemaVersion', 'id', 'bondId', 'nodeAId', 'nodeBId',
    'profileId', 'fractureEventId', 'revision', 'damage', 'separationNormal',
    'createdStep',
]);
const AGGREGATE_KEYS = new Set([
    'schema', 'schemaVersion', 'id', 'topologyId', 'revision', 'nodeIds',
    'sourceBondIds', 'crackResidualIds', 'centerOfMassM', 'linearVelocityMPerS',
    'angularVelocityRadPerS', 'massKg', 'representation', 'sourceDeviceGeneration',
]);
const REFINEMENT_KEYS = new Set([
    'schema', 'schemaVersion', 'id', 'topologyId', 'regionId', 'reason',
    'priority', 'nodeIds', 'predictedTimeToImpactS', 'requestedTimeBinExponent',
    'maximumError', 'revision',
]);
const SNAPSHOT_KEYS = new Set([
    'schema', 'schemaVersion', 'topologyId', 'revision', 'deviceGeneration',
    'stepIndex', 'nodes', 'bonds', 'crackResiduals', 'aggregates',
]);

function fail(path, message) {
    throw new TypeError(`${path}: ${message}`);
}

function record(value, path) {
    if (!isPlainJsonObject(value)) fail(path, 'must be a plain object');
    return value;
}

function exact(value, allowed, required, path) {
    record(value, path);
    for (const key of Object.keys(value)) {
        if (!allowed.has(key)) fail(`${path}.${key}`, 'unknown field');
    }
    for (const key of required) {
        if (!Object.hasOwn(value, key)) fail(`${path}.${key}`, 'is required');
    }
    return value;
}

function identifier(value, path) {
    if (typeof value !== 'string' || !IDENTIFIER.test(value)) fail(path, 'has invalid identifier syntax');
    return value;
}

function boundedString(value, path, maximum = 256) {
    if (typeof value !== 'string' || value.length === 0 || value.length > maximum
        || /[\u0000-\u001f\u007f]/.test(value)) {
        fail(path, 'must be a bounded non-empty control-free string');
    }
    return value;
}

function finite(value, path, { minimum = -Number.MAX_VALUE, maximum = Number.MAX_VALUE } = {}) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
        fail(path, `must be finite in [${minimum}, ${maximum}]`);
    }
    return value;
}

function integer(value, path, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
        fail(path, `must be a safe integer in [${minimum}, ${maximum}]`);
    }
    return value;
}

function vector(value, path, { normalized = false } = {}) {
    if (!Array.isArray(value) || value.length !== 3) fail(path, 'must be a 3-vector');
    value.forEach((entry, index) => finite(entry, `${path}[${index}]`));
    if (normalized) {
        const magnitude = Math.hypot(...value);
        if (Math.abs(magnitude - 1) > 1e-9) fail(path, 'must be normalized');
    }
    return value;
}

function identifierArray(value, path, { allowEmpty = true } = {}) {
    if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
        fail(path, allowEmpty ? 'must be an array' : 'must be a non-empty array');
    }
    const seen = new Set();
    value.forEach((entry, index) => {
        const id = identifier(entry, `${path}[${index}]`);
        if (seen.has(id)) fail(`${path}[${index}]`, 'duplicates an earlier identifier');
        seen.add(id);
        if (index > 0 && value[index - 1].localeCompare(id) >= 0) {
            fail(path, 'must be strictly sorted');
        }
    });
    return value;
}

function modeRecord(value, path, options = {}) {
    exact(value, MODE_KEYS, MODE_KEYS, path);
    for (const mode of MODES) finite(value[mode], `${path}.${mode}`, options);
    return value;
}

function stamp(input, schema, path) {
    const candidate = cloneStrictJson(input, path);
    record(candidate, path);
    if (candidate.schema != null && candidate.schema !== schema) fail(`${path}.schema`, 'is unsupported');
    if (candidate.schemaVersion != null && candidate.schemaVersion !== STRUCTURAL_SCHEMA_VERSION) {
        fail(`${path}.schemaVersion`, 'is unsupported');
    }
    return { ...candidate, schema, schemaVersion: STRUCTURAL_SCHEMA_VERSION };
}

function validateProfile(value, path) {
    exact(value, PROFILE_KEYS, PROFILE_KEYS, path);
    if (value.schema !== STRUCTURAL_PROFILE_SCHEMA || value.schemaVersion !== STRUCTURAL_SCHEMA_VERSION) {
        fail(path, 'uses an unsupported schema');
    }
    identifier(value.id, `${path}.id`);
    boundedString(value.label, `${path}.label`);
    modeRecord(value.complianceMPerN, `${path}.complianceMPerN`, { minimum: 0 });
    modeRecord(value.yieldStrain, `${path}.yieldStrain`, { minimum: Number.MIN_VALUE, maximum: 10 });
    finite(value.plasticRatePerSecond, `${path}.plasticRatePerSecond`, { minimum: 0, maximum: 1000 });
    finite(value.fatigueRatePerSecond, `${path}.fatigueRatePerSecond`, { minimum: 0, maximum: 1000 });
    finite(value.damageRatePerSecond, `${path}.damageRatePerSecond`, { minimum: 0, maximum: 1000 });
    finite(value.fractureStrain, `${path}.fractureStrain`, { minimum: Number.MIN_VALUE, maximum: 100 });
    for (const mode of MODES) {
        if (value.yieldStrain[mode] >= value.fractureStrain) {
            fail(`${path}.yieldStrain.${mode}`, 'must be less than fractureStrain');
        }
    }
    finite(value.thermalSofteningStartK, `${path}.thermalSofteningStartK`, { minimum: 0 });
    finite(value.thermalFailureK, `${path}.thermalFailureK`, { minimum: 0 });
    if (value.thermalFailureK <= value.thermalSofteningStartK) {
        fail(`${path}.thermalFailureK`, 'must exceed thermalSofteningStartK');
    }
    finite(value.recoveryRatePerSecond, `${path}.recoveryRatePerSecond`, { minimum: 0, maximum: 1000 });
    exact(value.anisotropy, ANISOTROPY_KEYS, ANISOTROPY_KEYS, `${path}.anisotropy`);
    vector(value.anisotropy.axis, `${path}.anisotropy.axis`, { normalized: true });
    finite(value.anisotropy.alongScale, `${path}.anisotropy.alongScale`, { minimum: Number.MIN_VALUE, maximum: 1000 });
    finite(value.anisotropy.crossScale, `${path}.anisotropy.crossScale`, { minimum: Number.MIN_VALUE, maximum: 1000 });
    return value;
}

function validateBond(value, path) {
    exact(value, BOND_KEYS, BOND_KEYS, path);
    if (value.schema !== STRUCTURAL_BOND_SCHEMA || value.schemaVersion !== STRUCTURAL_SCHEMA_VERSION) {
        fail(path, 'uses an unsupported schema');
    }
    identifier(value.id, `${path}.id`);
    const nodeAId = identifier(value.nodeAId, `${path}.nodeAId`);
    const nodeBId = identifier(value.nodeBId, `${path}.nodeBId`);
    if (nodeAId.localeCompare(nodeBId) >= 0) fail(path, 'node endpoints must be distinct and canonical');
    identifier(value.profileId, `${path}.profileId`);
    finite(value.restLengthM, `${path}.restLengthM`, { minimum: Number.MIN_VALUE });
    finite(value.plasticRestLengthM, `${path}.plasticRestLengthM`, { minimum: Number.MIN_VALUE });
    vector(value.restDirection, `${path}.restDirection`, { normalized: true });
    finite(value.bendRestRadians, `${path}.bendRestRadians`, { minimum: -Math.PI, maximum: Math.PI });
    modeRecord(value.lambda, `${path}.lambda`);
    if (!STAGES.has(value.lifecycle)) fail(`${path}.lifecycle`, 'is unsupported');
    finite(value.fatigue, `${path}.fatigue`, { minimum: 0, maximum: 1 });
    finite(value.damage, `${path}.damage`, { minimum: 0, maximum: 1 });
    integer(value.revision, `${path}.revision`);
    integer(value.timeBinExponent, `${path}.timeBinExponent`, { maximum: 30 });
    if (value.lifecycle === 'fracture' && value.damage !== 1) fail(`${path}.damage`, 'must be 1 at fracture');
    return value;
}

function validateNode(value, path) {
    exact(value, NODE_KEYS, NODE_KEYS, path);
    identifier(value.id, `${path}.id`);
    vector(value.positionM, `${path}.positionM`);
    vector(value.previousPositionM, `${path}.previousPositionM`);
    vector(value.velocityMPerS, `${path}.velocityMPerS`);
    finite(value.massKg, `${path}.massKg`, { minimum: Number.MIN_VALUE });
    finite(value.inverseMassPerKg, `${path}.inverseMassPerKg`, { minimum: 0 });
    if (value.inverseMassPerKg > 0
        && Math.abs(value.inverseMassPerKg * value.massKg - 1) > 1e-9) {
        fail(`${path}.inverseMassPerKg`, 'must be zero or the reciprocal of massKg');
    }
    return value;
}

function validateCrack(value, path) {
    exact(value, CRACK_KEYS, CRACK_KEYS, path);
    if (value.schema !== STRUCTURAL_CRACK_SCHEMA || value.schemaVersion !== STRUCTURAL_SCHEMA_VERSION) {
        fail(path, 'uses an unsupported schema');
    }
    for (const key of ['id', 'bondId', 'nodeAId', 'nodeBId', 'profileId', 'fractureEventId']) {
        identifier(value[key], `${path}.${key}`);
    }
    if (value.nodeAId.localeCompare(value.nodeBId) >= 0) fail(path, 'node endpoints must be canonical');
    integer(value.revision, `${path}.revision`, { minimum: 1 });
    finite(value.damage, `${path}.damage`, { minimum: 1, maximum: 1 });
    vector(value.separationNormal, `${path}.separationNormal`, { normalized: true });
    integer(value.createdStep, `${path}.createdStep`);
    return value;
}

function validateAggregate(value, path) {
    exact(value, AGGREGATE_KEYS, AGGREGATE_KEYS, path);
    if (value.schema !== STRUCTURAL_AGGREGATE_SCHEMA || value.schemaVersion !== STRUCTURAL_SCHEMA_VERSION) {
        fail(path, 'uses an unsupported schema');
    }
    for (const key of ['id', 'topologyId']) identifier(value[key], `${path}.${key}`);
    integer(value.revision, `${path}.revision`);
    identifierArray(value.nodeIds, `${path}.nodeIds`, { allowEmpty: false });
    identifierArray(value.sourceBondIds, `${path}.sourceBondIds`);
    identifierArray(value.crackResidualIds, `${path}.crackResidualIds`);
    vector(value.centerOfMassM, `${path}.centerOfMassM`);
    vector(value.linearVelocityMPerS, `${path}.linearVelocityMPerS`);
    vector(value.angularVelocityRadPerS, `${path}.angularVelocityRadPerS`);
    finite(value.massKg, `${path}.massKg`, { minimum: Number.MIN_VALUE });
    if (value.representation !== 'rigid-aggregate') fail(`${path}.representation`, 'must be rigid-aggregate');
    integer(value.sourceDeviceGeneration, `${path}.sourceDeviceGeneration`);
    return value;
}

function validateRefinement(value, path) {
    exact(value, REFINEMENT_KEYS, REFINEMENT_KEYS, path);
    if (value.schema !== STRUCTURAL_REFINEMENT_SCHEMA || value.schemaVersion !== STRUCTURAL_SCHEMA_VERSION) {
        fail(path, 'uses an unsupported schema');
    }
    for (const key of ['id', 'topologyId', 'regionId']) identifier(value[key], `${path}.${key}`);
    if (!REASONS.has(value.reason)) fail(`${path}.reason`, 'is unsupported');
    finite(value.priority, `${path}.priority`, { minimum: 0, maximum: 1 });
    identifierArray(value.nodeIds, `${path}.nodeIds`, { allowEmpty: false });
    if (value.predictedTimeToImpactS !== null) {
        finite(value.predictedTimeToImpactS, `${path}.predictedTimeToImpactS`, { minimum: 0 });
    }
    integer(value.requestedTimeBinExponent, `${path}.requestedTimeBinExponent`, { maximum: 30 });
    finite(value.maximumError, `${path}.maximumError`, { minimum: 0 });
    integer(value.revision, `${path}.revision`);
    return value;
}

function validateSnapshot(value, path) {
    exact(value, SNAPSHOT_KEYS, SNAPSHOT_KEYS, path);
    if (value.schema !== STRUCTURAL_TOPOLOGY_SCHEMA || value.schemaVersion !== STRUCTURAL_SCHEMA_VERSION) {
        fail(path, 'uses an unsupported schema');
    }
    identifier(value.topologyId, `${path}.topologyId`);
    integer(value.revision, `${path}.revision`);
    integer(value.deviceGeneration, `${path}.deviceGeneration`);
    integer(value.stepIndex, `${path}.stepIndex`);
    for (const key of ['nodes', 'bonds', 'crackResiduals', 'aggregates']) {
        if (!Array.isArray(value[key])) fail(`${path}.${key}`, 'must be an array');
    }
    const nodeIds = new Set();
    value.nodes.forEach((node, index) => {
        validateNode(node, `${path}.nodes[${index}]`);
        if (nodeIds.has(node.id)) fail(`${path}.nodes[${index}].id`, 'duplicates an earlier node');
        if (index > 0 && value.nodes[index - 1].id.localeCompare(node.id) >= 0) {
            fail(`${path}.nodes`, 'must be strictly sorted by id');
        }
        nodeIds.add(node.id);
    });
    const activeBondIds = new Set();
    value.bonds.forEach((bond, index) => {
        validateBond(bond, `${path}.bonds[${index}]`);
        if (bond.lifecycle === 'fracture') fail(`${path}.bonds[${index}]`, 'fractured bonds must be deleted');
        if (activeBondIds.has(bond.id)) fail(`${path}.bonds[${index}].id`, 'duplicates an earlier bond');
        if (index > 0 && value.bonds[index - 1].id.localeCompare(bond.id) >= 0) {
            fail(`${path}.bonds`, 'must be strictly sorted by id');
        }
        activeBondIds.add(bond.id);
        if (!nodeIds.has(bond.nodeAId) || !nodeIds.has(bond.nodeBId)) {
            fail(`${path}.bonds[${index}]`, 'references an unknown node');
        }
    });
    const crackIds = new Set();
    value.crackResiduals.forEach((crack, index) => {
        validateCrack(crack, `${path}.crackResiduals[${index}]`);
        if (crackIds.has(crack.id)) fail(`${path}.crackResiduals[${index}].id`, 'duplicates an earlier crack');
        if (index > 0 && value.crackResiduals[index - 1].id.localeCompare(crack.id) >= 0) {
            fail(`${path}.crackResiduals`, 'must be strictly sorted by id');
        }
        if (activeBondIds.has(crack.bondId)) fail(`${path}.crackResiduals[${index}]`, 'bond remains active');
        if (!nodeIds.has(crack.nodeAId) || !nodeIds.has(crack.nodeBId)) {
            fail(`${path}.crackResiduals[${index}]`, 'references an unknown node');
        }
        if (crack.revision > value.revision) fail(`${path}.crackResiduals[${index}].revision`, 'exceeds topology revision');
        crackIds.add(crack.id);
    });
    const aggregateIds = new Set();
    const aggregateNodeIds = new Set();
    value.aggregates.forEach((aggregate, index) => {
        validateAggregate(aggregate, `${path}.aggregates[${index}]`);
        if (aggregateIds.has(aggregate.id)) fail(`${path}.aggregates[${index}].id`, 'duplicates an earlier aggregate');
        if (index > 0 && value.aggregates[index - 1].id.localeCompare(aggregate.id) >= 0) {
            fail(`${path}.aggregates`, 'must be strictly sorted by id');
        }
        if (aggregate.topologyId !== value.topologyId) fail(`${path}.aggregates[${index}].topologyId`, 'differs from topology');
        if (aggregate.revision > value.revision) fail(`${path}.aggregates[${index}].revision`, 'exceeds topology revision');
        if (aggregate.sourceDeviceGeneration !== value.deviceGeneration) {
            fail(`${path}.aggregates[${index}].sourceDeviceGeneration`, 'differs from topology');
        }
        aggregateIds.add(aggregate.id);
        for (const nodeId of aggregate.nodeIds) {
            if (!nodeIds.has(nodeId)) fail(`${path}.aggregates[${index}].nodeIds`, 'references an unknown node');
            if (aggregateNodeIds.has(nodeId)) fail(`${path}.aggregates[${index}].nodeIds`, 'overlaps another aggregate');
            aggregateNodeIds.add(nodeId);
        }
        for (const bondId of aggregate.sourceBondIds) {
            if (!activeBondIds.has(bondId)) fail(`${path}.aggregates[${index}].sourceBondIds`, 'references an unknown active bond');
        }
        for (const crackId of aggregate.crackResidualIds) {
            if (!crackIds.has(crackId)) fail(`${path}.aggregates[${index}].crackResidualIds`, 'references an unknown crack');
        }
    });
    return value;
}

function createValidated(input, schema, path, validator) {
    const candidate = stamp(input, schema, path);
    validator(candidate, path);
    return deepFreezeJson(candidate, path);
}

function validateExisting(value, path, validator) {
    validator(cloneStrictJson(value, path), String(path));
    return true;
}

export function createStructuralMaterialProfile(input) {
    return createValidated(input, STRUCTURAL_PROFILE_SCHEMA, '$.structuralProfile', validateProfile);
}

export function validateStructuralMaterialProfile(value, path = '$.structuralProfile') {
    return validateExisting(value, path, validateProfile);
}

export function createStructuralBond(input) {
    return createValidated(input, STRUCTURAL_BOND_SCHEMA, '$.structuralBond', validateBond);
}

export function validateStructuralBond(value, path = '$.structuralBond') {
    return validateExisting(value, path, validateBond);
}

export function createStructuralCrackResidual(input) {
    return createValidated(input, STRUCTURAL_CRACK_SCHEMA, '$.crackResidual', validateCrack);
}

export function validateStructuralCrackResidual(value, path = '$.crackResidual') {
    return validateExisting(value, path, validateCrack);
}

export function createRigidAggregate(input) {
    return createValidated(input, STRUCTURAL_AGGREGATE_SCHEMA, '$.rigidAggregate', validateAggregate);
}

export function validateRigidAggregate(value, path = '$.rigidAggregate') {
    return validateExisting(value, path, validateAggregate);
}

export function createStructuralRefinementRequest(input) {
    return createValidated(input, STRUCTURAL_REFINEMENT_SCHEMA, '$.refinementRequest', validateRefinement);
}

export function validateStructuralRefinementRequest(value, path = '$.refinementRequest') {
    return validateExisting(value, path, validateRefinement);
}

export function createStructuralTopologySnapshot(input) {
    return createValidated(input, STRUCTURAL_TOPOLOGY_SCHEMA, '$.structuralTopology', validateSnapshot);
}

export function validateStructuralTopologySnapshot(value, path = '$.structuralTopology') {
    return validateExisting(value, path, validateSnapshot);
}

export function createStructuralNode(input) {
    const candidate = cloneStrictJson(input, '$.structuralNode');
    validateNode(candidate, '$.structuralNode');
    return deepFreezeJson(candidate, '$.structuralNode');
}
