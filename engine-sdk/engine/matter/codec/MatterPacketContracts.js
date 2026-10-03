// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Strict, versioned contracts for adaptive Matter packet projections and receipts. */

import {
    cloneStrictJson,
    deepFreezeJson,
    isPlainJsonObject,
} from '../../core/schema/StrictJsonValue.js';

export const MATTER_PACKET_PROJECTION_SCHEMA = 'engine.matter.packet-projection';
export const MATTER_PACKET_PROJECTION_VERSION = '2.0.0';
export const MATTER_PACKET_CODEC_RECEIPT_SCHEMA = 'engine.matter.packet-codec-receipt';
export const MATTER_PACKET_CODEC_RECEIPT_VERSION = '2.0.0';
export const MATTER_PACKET_STORE_SNAPSHOT_SCHEMA = 'engine.matter.packet-store-snapshot';
export const MATTER_PACKET_STORE_SNAPSHOT_VERSION = '2.0.0';
export const MATTER_PACKET_MAX_LINEAGE_LEVEL = 31;

export const MATTER_PACKET_CODEC_OPERATIONS = Object.freeze(['split-1-to-8', 'merge-8-to-1']);
export const MATTER_PACKET_VOLUME_POLICIES = Object.freeze(['preserve', 'report-only']);

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,191}$/;
const OPERATIONS = new Set(MATTER_PACKET_CODEC_OPERATIONS);
const VOLUME_POLICIES = new Set(MATTER_PACKET_VOLUME_POLICIES);
const HANDLE_KEYS = new Set(['pageId', 'slot', 'generation']);
const LINEAGE_KEYS = new Set(['id', 'rootId', 'parentId', 'level', 'childOrdinal']);
const DAMAGE_KEYS = new Set(['modelId', 'revision', 'fraction', 'topologyId']);
const PACKET_KEYS = new Set([
    'schema', 'schemaVersion', 'handle', 'regionId', 'lineage', 'definitionId', 'phase',
    'componentId', 'damageState', 'sourceRevision', 'representationRevision',
    'positionM', 'velocityMPerS', 'massKg', 'representedVolumeM3',
    'angularMomentumKgM2PerS', 'thermalEnergyJ', 'elasticEnergyJ', 'subgridEnergyJ',
]);
const ENERGY_KEYS = new Set(['kineticJ', 'thermalJ', 'elasticJ', 'subgridJ', 'totalJ']);
const SUMMARY_KEYS = new Set([
    'packetCount', 'massKg', 'firstMassMomentKgM', 'centerOfMassM',
    'linearMomentumKgMPerS', 'angularMomentumKgM2PerS', 'energyJ',
    'representedVolumeM3',
]);
const RESIDUAL_KEYS = new Set([
    'massKg', 'firstMassMomentKgM', 'centerOfMassM', 'linearMomentumKgMPerS',
    'angularMomentumKgM2PerS', 'totalEnergyJ', 'representedVolumeM3',
]);
const REVISION_KEYS = new Set(['before', 'after']);
const TOLERANCE_KEYS = new Set(['absolute', 'relative']);
const SEAM_KEYS = new Set([
    'centerOfMassDeltaM', 'representedVolumeDeltaM3', 'representedVolumePolicy',
    'sourceRevisionMatched', 'representationRevisionAdvanced',
]);
const BALANCED_KEYS = new Set([
    'mass', 'firstMassMoment', 'centerOfMass', 'linearMomentum', 'angularMomentum',
    'totalEnergy', 'representedVolume', 'all',
]);
const RECEIPT_KEYS = new Set([
    'schema', 'schemaVersion', 'receiptId', 'operation', 'regionId', 'sourceRevision',
    'representationRevision', 'inputLineageIds', 'outputLineageIds', 'before', 'after',
    'residual', 'tolerance', 'seams', 'balanced',
]);

function fail(path, message) {
    throw new TypeError(`${path}: ${message}`);
}

function record(value, path) {
    if (!isPlainJsonObject(value)) fail(path, 'must be a plain object');
    return value;
}

function exactKeys(value, allowed, required, path) {
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

function nullableIdentifier(value, path) {
    return value === null ? null : identifier(value, path);
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

function vector(value, path, { minimum = -Number.MAX_VALUE } = {}) {
    if (!Array.isArray(value) || value.length !== 3) fail(path, 'must be a 3-vector');
    value.forEach((entry, index) => finite(entry, `${path}[${index}]`, { minimum }));
    return value;
}

function boolean(value, path) {
    if (typeof value !== 'boolean') fail(path, 'must be boolean');
    return value;
}

function nearlyEqual(left, right, relative = 1e-12) {
    return Math.abs(left - right) <= relative * Math.max(1, Math.abs(left), Math.abs(right));
}

function requireScalarMatch(actual, expected, path) {
    if (!nearlyEqual(actual, expected)) fail(path, `must equal the derived value ${expected}`);
}

function requireVectorMatch(actual, expected, path) {
    actual.forEach((value, axis) => requireScalarMatch(value, expected[axis], `${path}[${axis}]`));
}

function scalarWithinTolerance(before, after, residual, tolerance) {
    return Math.abs(residual) <= tolerance.absolute
        + tolerance.relative * Math.max(1, Math.abs(before), Math.abs(after));
}

function vectorWithinTolerance(before, after, residual, tolerance) {
    return residual.every((value, axis) => scalarWithinTolerance(before[axis], after[axis], value, tolerance));
}

function identifierList(value, path, expectedLength = null) {
    if (!Array.isArray(value)) fail(path, 'must be an array');
    if (expectedLength !== null && value.length !== expectedLength) fail(path, `must contain ${expectedLength} entries`);
    const seen = new Set();
    value.forEach((entry, index) => {
        const id = identifier(entry, `${path}[${index}]`);
        if (seen.has(id)) fail(`${path}[${index}]`, 'duplicates an earlier identifier');
        seen.add(id);
    });
    return value;
}

function validateHandleValue(value, path) {
    exactKeys(value, HANDLE_KEYS, HANDLE_KEYS, path);
    integer(value.pageId, `${path}.pageId`);
    integer(value.slot, `${path}.slot`);
    integer(value.generation, `${path}.generation`, { minimum: 1, maximum: 0xffffffff });
    return value;
}

function validateLineageValue(value, path) {
    exactKeys(value, LINEAGE_KEYS, LINEAGE_KEYS, path);
    const id = identifier(value.id, `${path}.id`);
    const rootId = identifier(value.rootId, `${path}.rootId`);
    const parentId = nullableIdentifier(value.parentId, `${path}.parentId`);
    integer(value.level, `${path}.level`, { maximum: MATTER_PACKET_MAX_LINEAGE_LEVEL });
    if (value.childOrdinal !== null) integer(value.childOrdinal, `${path}.childOrdinal`, { maximum: 7 });
    if (value.level === 0) {
        if (parentId !== null) fail(`${path}.parentId`, 'must be null at lineage level zero');
        if (value.childOrdinal !== null) fail(`${path}.childOrdinal`, 'must be null at lineage level zero');
        if (rootId !== id) fail(`${path}.rootId`, 'must equal id at lineage level zero');
    } else {
        if (parentId === null) fail(`${path}.parentId`, 'is required after lineage level zero');
        if (value.childOrdinal === null) fail(`${path}.childOrdinal`, 'is required after lineage level zero');
        if (id !== `${parentId}.c${value.childOrdinal}`) {
            fail(`${path}.id`, 'must be the deterministic parentId and childOrdinal path');
        }
        const descendantPath = id.slice(rootId.length);
        const segments = descendantPath.match(/\.c[0-7]/g) ?? [];
        if (!id.startsWith(`${rootId}.c`) || segments.join('') !== descendantPath || segments.length !== value.level) {
            fail(`${path}.rootId`, 'does not match the deterministic lineage path and level');
        }
    }
    return value;
}

function validateDamageValue(value, path) {
    exactKeys(value, DAMAGE_KEYS, DAMAGE_KEYS, path);
    identifier(value.modelId, `${path}.modelId`);
    integer(value.revision, `${path}.revision`);
    finite(value.fraction, `${path}.fraction`, { minimum: 0, maximum: 1 });
    identifier(value.topologyId, `${path}.topologyId`);
    return value;
}

function validatePacketValue(value, path) {
    exactKeys(value, PACKET_KEYS, PACKET_KEYS, path);
    if (value.schema !== MATTER_PACKET_PROJECTION_SCHEMA) fail(`${path}.schema`, 'is unsupported');
    if (value.schemaVersion !== MATTER_PACKET_PROJECTION_VERSION) fail(`${path}.schemaVersion`, 'is unsupported');
    validateHandleValue(value.handle, `${path}.handle`);
    identifier(value.regionId, `${path}.regionId`);
    validateLineageValue(value.lineage, `${path}.lineage`);
    identifier(value.definitionId, `${path}.definitionId`);
    identifier(value.phase, `${path}.phase`);
    identifier(value.componentId, `${path}.componentId`);
    validateDamageValue(value.damageState, `${path}.damageState`);
    integer(value.sourceRevision, `${path}.sourceRevision`);
    integer(value.representationRevision, `${path}.representationRevision`);
    vector(value.positionM, `${path}.positionM`);
    vector(value.velocityMPerS, `${path}.velocityMPerS`);
    finite(value.massKg, `${path}.massKg`, { minimum: Number.MIN_VALUE });
    finite(value.representedVolumeM3, `${path}.representedVolumeM3`, { minimum: Number.MIN_VALUE });
    vector(value.angularMomentumKgM2PerS, `${path}.angularMomentumKgM2PerS`);
    finite(value.thermalEnergyJ, `${path}.thermalEnergyJ`, { minimum: 0 });
    finite(value.elasticEnergyJ, `${path}.elasticEnergyJ`, { minimum: 0 });
    finite(value.subgridEnergyJ, `${path}.subgridEnergyJ`, { minimum: 0 });
    return value;
}

function validateEnergyValue(value, path) {
    exactKeys(value, ENERGY_KEYS, ENERGY_KEYS, path);
    for (const key of ENERGY_KEYS) finite(value[key], `${path}.${key}`, { minimum: 0 });
    requireScalarMatch(
        value.totalJ,
        value.kineticJ + value.thermalJ + value.elasticJ + value.subgridJ,
        `${path}.totalJ`,
    );
}

function validateSummaryValue(value, path) {
    exactKeys(value, SUMMARY_KEYS, SUMMARY_KEYS, path);
    integer(value.packetCount, `${path}.packetCount`, { minimum: 1 });
    finite(value.massKg, `${path}.massKg`, { minimum: Number.MIN_VALUE });
    vector(value.firstMassMomentKgM, `${path}.firstMassMomentKgM`);
    vector(value.centerOfMassM, `${path}.centerOfMassM`);
    vector(value.linearMomentumKgMPerS, `${path}.linearMomentumKgMPerS`);
    vector(value.angularMomentumKgM2PerS, `${path}.angularMomentumKgM2PerS`);
    validateEnergyValue(value.energyJ, `${path}.energyJ`);
    finite(value.representedVolumeM3, `${path}.representedVolumeM3`, { minimum: Number.MIN_VALUE });
    requireVectorMatch(
        value.centerOfMassM,
        value.firstMassMomentKgM.map(entry => entry / value.massKg),
        `${path}.centerOfMassM`,
    );
}

function validateReceiptValue(value, path) {
    exactKeys(value, RECEIPT_KEYS, RECEIPT_KEYS, path);
    if (value.schema !== MATTER_PACKET_CODEC_RECEIPT_SCHEMA) fail(`${path}.schema`, 'is unsupported');
    if (value.schemaVersion !== MATTER_PACKET_CODEC_RECEIPT_VERSION) fail(`${path}.schemaVersion`, 'is unsupported');
    identifier(value.receiptId, `${path}.receiptId`);
    if (!OPERATIONS.has(value.operation)) fail(`${path}.operation`, 'is unsupported');
    identifier(value.regionId, `${path}.regionId`);
    integer(value.sourceRevision, `${path}.sourceRevision`);
    exactKeys(value.representationRevision, REVISION_KEYS, REVISION_KEYS, `${path}.representationRevision`);
    integer(value.representationRevision.before, `${path}.representationRevision.before`);
    integer(value.representationRevision.after, `${path}.representationRevision.after`, { minimum: 1 });
    if (value.representationRevision.after !== value.representationRevision.before + 1) {
        fail(`${path}.representationRevision`, 'must advance exactly once');
    }
    const inputCount = value.operation === 'split-1-to-8' ? 1 : 8;
    const outputCount = value.operation === 'split-1-to-8' ? 8 : 1;
    identifierList(value.inputLineageIds, `${path}.inputLineageIds`, inputCount);
    identifierList(value.outputLineageIds, `${path}.outputLineageIds`, outputCount);
    const parentLineageId = value.operation === 'split-1-to-8'
        ? value.inputLineageIds[0]
        : value.outputLineageIds[0];
    const expectedChildren = Array.from({ length: 8 }, (_unused, ordinal) => `${parentLineageId}.c${ordinal}`);
    const actualChildren = value.operation === 'split-1-to-8'
        ? value.outputLineageIds
        : value.inputLineageIds;
    if (actualChildren.some((lineageId, index) => lineageId !== expectedChildren[index])) {
        fail(path, 'lineage topology must contain the deterministic parent children c0 through c7 in order');
    }
    validateSummaryValue(value.before, `${path}.before`);
    validateSummaryValue(value.after, `${path}.after`);
    if (value.before.packetCount !== inputCount) fail(`${path}.before.packetCount`, `must equal ${inputCount}`);
    if (value.after.packetCount !== outputCount) fail(`${path}.after.packetCount`, `must equal ${outputCount}`);
    exactKeys(value.residual, RESIDUAL_KEYS, RESIDUAL_KEYS, `${path}.residual`);
    finite(value.residual.massKg, `${path}.residual.massKg`);
    vector(value.residual.firstMassMomentKgM, `${path}.residual.firstMassMomentKgM`);
    vector(value.residual.centerOfMassM, `${path}.residual.centerOfMassM`);
    vector(value.residual.linearMomentumKgMPerS, `${path}.residual.linearMomentumKgMPerS`);
    vector(value.residual.angularMomentumKgM2PerS, `${path}.residual.angularMomentumKgM2PerS`);
    finite(value.residual.totalEnergyJ, `${path}.residual.totalEnergyJ`);
    finite(value.residual.representedVolumeM3, `${path}.residual.representedVolumeM3`);
    exactKeys(value.tolerance, TOLERANCE_KEYS, TOLERANCE_KEYS, `${path}.tolerance`);
    finite(value.tolerance.absolute, `${path}.tolerance.absolute`, { minimum: 0 });
    finite(value.tolerance.relative, `${path}.tolerance.relative`, { minimum: 0 });
    exactKeys(value.seams, SEAM_KEYS, SEAM_KEYS, `${path}.seams`);
    vector(value.seams.centerOfMassDeltaM, `${path}.seams.centerOfMassDeltaM`);
    finite(value.seams.representedVolumeDeltaM3, `${path}.seams.representedVolumeDeltaM3`);
    if (!VOLUME_POLICIES.has(value.seams.representedVolumePolicy)) {
        fail(`${path}.seams.representedVolumePolicy`, 'is unsupported');
    }
    boolean(value.seams.sourceRevisionMatched, `${path}.seams.sourceRevisionMatched`);
    boolean(value.seams.representationRevisionAdvanced, `${path}.seams.representationRevisionAdvanced`);
    exactKeys(value.balanced, BALANCED_KEYS, BALANCED_KEYS, `${path}.balanced`);
    for (const key of BALANCED_KEYS) boolean(value.balanced[key], `${path}.balanced.${key}`);
    requireScalarMatch(value.residual.massKg, value.after.massKg - value.before.massKg, `${path}.residual.massKg`);
    requireVectorMatch(
        value.residual.firstMassMomentKgM,
        value.after.firstMassMomentKgM.map((entry, axis) => entry - value.before.firstMassMomentKgM[axis]),
        `${path}.residual.firstMassMomentKgM`,
    );
    requireVectorMatch(
        value.residual.centerOfMassM,
        value.after.centerOfMassM.map((entry, axis) => entry - value.before.centerOfMassM[axis]),
        `${path}.residual.centerOfMassM`,
    );
    requireVectorMatch(
        value.residual.linearMomentumKgMPerS,
        value.after.linearMomentumKgMPerS.map((entry, axis) => entry - value.before.linearMomentumKgMPerS[axis]),
        `${path}.residual.linearMomentumKgMPerS`,
    );
    requireVectorMatch(
        value.residual.angularMomentumKgM2PerS,
        value.after.angularMomentumKgM2PerS.map((entry, axis) => (
            entry - value.before.angularMomentumKgM2PerS[axis]
        )),
        `${path}.residual.angularMomentumKgM2PerS`,
    );
    requireScalarMatch(
        value.residual.totalEnergyJ,
        value.after.energyJ.totalJ - value.before.energyJ.totalJ,
        `${path}.residual.totalEnergyJ`,
    );
    requireScalarMatch(
        value.residual.representedVolumeM3,
        value.after.representedVolumeM3 - value.before.representedVolumeM3,
        `${path}.residual.representedVolumeM3`,
    );
    requireVectorMatch(value.seams.centerOfMassDeltaM, value.residual.centerOfMassM, `${path}.seams.centerOfMassDeltaM`);
    requireScalarMatch(
        value.seams.representedVolumeDeltaM3,
        value.residual.representedVolumeM3,
        `${path}.seams.representedVolumeDeltaM3`,
    );
    if (!value.seams.sourceRevisionMatched) fail(`${path}.seams.sourceRevisionMatched`, 'must be true');
    if (!value.seams.representationRevisionAdvanced) fail(`${path}.seams.representationRevisionAdvanced`, 'must be true');
    const expectedBalanced = {
        mass: scalarWithinTolerance(value.before.massKg, value.after.massKg, value.residual.massKg, value.tolerance),
        firstMassMoment: vectorWithinTolerance(
            value.before.firstMassMomentKgM,
            value.after.firstMassMomentKgM,
            value.residual.firstMassMomentKgM,
            value.tolerance,
        ),
        centerOfMass: vectorWithinTolerance(
            value.before.centerOfMassM,
            value.after.centerOfMassM,
            value.residual.centerOfMassM,
            value.tolerance,
        ),
        linearMomentum: vectorWithinTolerance(
            value.before.linearMomentumKgMPerS,
            value.after.linearMomentumKgMPerS,
            value.residual.linearMomentumKgMPerS,
            value.tolerance,
        ),
        angularMomentum: vectorWithinTolerance(
            value.before.angularMomentumKgM2PerS,
            value.after.angularMomentumKgM2PerS,
            value.residual.angularMomentumKgM2PerS,
            value.tolerance,
        ),
        totalEnergy: scalarWithinTolerance(
            value.before.energyJ.totalJ,
            value.after.energyJ.totalJ,
            value.residual.totalEnergyJ,
            value.tolerance,
        ),
        representedVolume: value.seams.representedVolumePolicy === 'report-only' || scalarWithinTolerance(
            value.before.representedVolumeM3,
            value.after.representedVolumeM3,
            value.residual.representedVolumeM3,
            value.tolerance,
        ),
    };
    for (const [key, expected] of Object.entries(expectedBalanced)) {
        if (value.balanced[key] !== expected) fail(`${path}.balanced.${key}`, `must be ${expected}`);
    }
    const requiredBalance = [...BALANCED_KEYS].filter(key => key !== 'all');
    if (value.balanced.all !== requiredBalance.every(key => value.balanced[key])) {
        fail(`${path}.balanced.all`, 'must equal the conjunction of invariant results');
    }
    return value;
}

function stampedInput(input, schema, schemaVersion, path) {
    const candidate = cloneStrictJson(input, path);
    record(candidate, path);
    if (candidate.schema != null && candidate.schema !== schema) fail(`${path}.schema`, 'is unsupported');
    if (candidate.schemaVersion != null && candidate.schemaVersion !== schemaVersion) {
        fail(`${path}.schemaVersion`, 'is unsupported');
    }
    return { ...candidate, schema, schemaVersion };
}

export function createMatterPacketHandle(input) {
    const candidate = cloneStrictJson(input, '$.matterPacketHandle');
    validateHandleValue(candidate, '$.matterPacketHandle');
    return deepFreezeJson(candidate, '$.matterPacketHandle');
}

export function validateMatterPacketHandle(value, path = '$.matterPacketHandle') {
    validateHandleValue(cloneStrictJson(value, path), String(path));
    return true;
}

export function createMatterPacketProjection(input) {
    const candidate = stampedInput(
        input,
        MATTER_PACKET_PROJECTION_SCHEMA,
        MATTER_PACKET_PROJECTION_VERSION,
        '$.matterPacketProjection',
    );
    validatePacketValue(candidate, '$.matterPacketProjection');
    return deepFreezeJson(candidate, '$.matterPacketProjection');
}

export function validateMatterPacketProjection(value, path = '$.matterPacketProjection') {
    validatePacketValue(cloneStrictJson(value, path), String(path));
    return true;
}

export function createMatterPacketCodecReceipt(input) {
    const candidate = stampedInput(
        input,
        MATTER_PACKET_CODEC_RECEIPT_SCHEMA,
        MATTER_PACKET_CODEC_RECEIPT_VERSION,
        '$.matterPacketCodecReceipt',
    );
    validateReceiptValue(candidate, '$.matterPacketCodecReceipt');
    return deepFreezeJson(candidate, '$.matterPacketCodecReceipt');
}

export function validateMatterPacketCodecReceipt(value, path = '$.matterPacketCodecReceipt') {
    validateReceiptValue(cloneStrictJson(value, path), String(path));
    return true;
}
