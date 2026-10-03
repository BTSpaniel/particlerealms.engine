// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Region-scoped atomic coordination for phase, packet, fluid, and bond state. */

import {
    cloneAndFreezeStrictJson,
    cloneStrictJson,
    deepFreezeJson,
    isPlainJsonObject,
} from '../../core/schema/StrictJsonValue.js';
import {
    MATTER_PACKET_PHASE_REBIND_RECEIPT_SCHEMA,
    MATTER_PACKET_PHASE_REBIND_RECEIPT_VERSION,
    restoreAdaptiveMatterPacketCodec,
} from '../codec/AdaptiveMatterPacketCodec.js';
import { AdaptiveMatterFluidSystem } from '../fluid/AdaptiveMatterFluidSystem.js';
import { StructuralTopology } from '../structural/StructuralTopology.js';
import {
    AtomicPhaseTranscoder,
    TranscodeInterruptedError,
} from './AtomicPhaseTranscoder.js';
import { PHASE_FAMILY_PROFILES } from './PhaseFamilyProfiles.js';
import {
    createPhaseState,
    createPhaseTranscodeRequest,
    validatePhaseFamilyProfile,
    validatePhaseTranscodeReceipt,
} from './TranscodeContracts.js';

export const MATTER_PHASE_RUNTIME_SNAPSHOT_SCHEMA = 'engine.matter.phase-runtime-coordinator';
export const MATTER_PHASE_RUNTIME_RECEIPT_SCHEMA = 'engine.matter.phase-runtime-receipt';
export const MATTER_PHASE_RUNTIME_VERSION = '1.0.0';

export const DEFAULT_FLUID_PHASE_IDS = Object.freeze([
    'phase.metal.melt',
    'phase.soil.mud',
    'phase.water.steam',
    'phase.water.water',
]);

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,191}$/;
const OPTIONS = new Set([
    'regionId', 'codec', 'topology', 'profiles', 'fluidPhaseIds', 'fluidMetadata',
    'fluidOptions', 'maximumJournalEntries', 'destroyCodecOnDestroy',
    'destroyTopologyOnDestroy', 'logger',
]);
const FLUID_OPTIONS = new Set([
    'mode', 'qualityProfile', 'kernelProfile', 'grid', 'surface',
]);
const COMMIT_OPTIONS = new Set(['interruptAt', 'recovered']);
const SNAPSHOT_KEYS = new Set([
    'schema', 'schemaVersion', 'regionId', 'fluidPhaseIds', 'fluidMetadata',
    'phaseProfiles', 'maximumJournalEntries', 'journal', 'codec', 'fluid', 'transcoder',
]);
const JOURNAL_KEYS = new Set([
    'transactionId', 'status', 'attempts', 'request', 'expectedSourceRevision',
    'expectedPackets', 'preparedParticipants', 'receipt', 'error',
]);
const EXPECTED_PACKET_KEYS = new Set(['handle', 'lineageId', 'representationRevision']);
const PARTICIPANT_KEYS = new Set(['codec', 'fluid', 'transcoder']);
const RUNTIME_RECEIPT_KEYS = new Set([
    'schema', 'schemaVersion', 'transactionId', 'status', 'recovered', 'phase',
    'packetRebind', 'fluidProjection', 'topologyRevision', 'invariants',
]);
const FLUID_RECEIPT_KEYS = new Set([
    'beforeActive', 'afterActive', 'activatedPacketIds', 'deactivatedPacketIds',
]);
const TOPOLOGY_REVISION_KEYS = new Set(['before', 'after']);
const INVARIANT_KEYS = new Set([
    'regionIdentity', 'definitionIdentity', 'lineageIdentity', 'handleIdentity',
    'damageState',
    'mass', 'firstMassMoment', 'linearMomentum', 'angularMomentum', 'energyReconciled',
    'representedVolume', 'sourceRevisionAdvanced', 'representationRevisionAdvanced',
    'fluidAuthorityMatchesPhase', 'all',
]);
const PACKET_REBIND_RECEIPT_KEYS = new Set([
    'schema', 'schemaVersion', 'regionId', 'fromPhase', 'toPhase', 'internalEnergyDeltaJ',
    'sourceRevision', 'packetRevisions', 'identities', 'revisions', 'before', 'after',
    'residual', 'tolerance', 'balanced',
]);
const PACKET_REBIND_IDENTITY_KEYS = new Set([
    'handles', 'lineage', 'definition', 'component', 'damage', 'region',
]);
const PACKET_REBIND_REVISION_KEYS = new Set(['sourceAdvanced', 'representationAdvanced']);
const PACKET_REBIND_BALANCE_KEYS = new Set([
    'mass', 'firstMassMoment', 'linearMomentum', 'angularMomentum', 'energy',
    'representedVolume', 'all',
]);
const PACKET_REBIND_PACKET_KEYS = new Set([
    'handle', 'lineageId', 'representationRevision',
]);
const SUMMARY_KEYS = new Set([
    'packetCount', 'massKg', 'firstMassMomentKgM', 'centerOfMassM',
    'linearMomentumKgMPerS', 'angularMomentumKgM2PerS', 'energyJ',
    'representedVolumeM3',
]);
const ENERGY_KEYS = new Set(['kineticJ', 'thermalJ', 'elasticJ', 'subgridJ', 'totalJ']);
const REBIND_RESIDUAL_KEYS = new Set([
    'massKg', 'firstMassMomentKgM', 'linearMomentumKgMPerS',
    'angularMomentumKgM2PerS', 'totalEnergyJ', 'representedVolumeM3',
]);
const JOURNAL_STATES = new Set(['prepared', 'applying', 'interrupted', 'committed', 'aborted']);
const INTERRUPT_POINTS = new Set([
    null, 'after-prepare', 'after-structural', 'after-phase', 'after-codec', 'after-fluid',
]);

function fail(path, message) {
    throw new TypeError(`${path}: ${message}`);
}

function exact(value, allowed, required, path) {
    if (!isPlainJsonObject(value)) fail(path, 'must be a plain object');
    for (const key of Object.keys(value)) if (!allowed.has(key)) fail(`${path}.${key}`, 'unknown field');
    for (const key of required) if (!Object.hasOwn(value, key)) fail(`${path}.${key}`, 'is required');
    return value;
}

function safeOptions(input, allowed, path) {
    if (!isPlainJsonObject(input)) fail(path, 'must be a plain object');
    const output = {};
    for (const key of Reflect.ownKeys(input)) {
        if (typeof key !== 'string') fail(path, 'symbol keys are not supported');
        if (!allowed.has(key)) fail(`${path}.${key}`, 'unknown field');
        const descriptor = Object.getOwnPropertyDescriptor(input, key);
        if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
            fail(`${path}.${key}`, 'must be an enumerable data property');
        }
        output[key] = descriptor.value;
    }
    return output;
}

function identifier(value, path) {
    if (typeof value !== 'string' || !IDENTIFIER.test(value)) fail(path, 'has invalid identifier syntax');
    return value;
}

function integer(value, path, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
        fail(path, `must be a safe integer in [${minimum}, ${maximum}]`);
    }
    return value;
}

function finite(value, path) {
    if (typeof value !== 'number' || !Number.isFinite(value)) fail(path, 'must be finite');
    return value;
}

function nonNegativeFinite(value, path) {
    finite(value, path);
    if (value < 0) fail(path, 'must be non-negative');
    return value;
}

function vector(value, path) {
    if (!Array.isArray(value) || value.length !== 3) fail(path, 'must be a 3-vector');
    value.forEach((entry, index) => finite(entry, `${path}[${index}]`));
    return value;
}

function sameJson(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
}

function compensatedSum(values) {
    let sum = 0;
    let correction = 0;
    for (const value of values) {
        const adjusted = value - correction;
        const next = sum + adjusted;
        correction = (next - sum) - adjusted;
        sum = next;
    }
    return sum;
}

function nearlyEqual(left, right, absolute = 1e-9, relative = 1e-9) {
    return Math.abs(left - right) <= absolute + relative * Math.max(1, Math.abs(left), Math.abs(right));
}

function requireDerivedScalar(actual, expected, path) {
    if (!nearlyEqual(actual, expected, 0, 1e-12)) {
        fail(path, `must equal the derived value ${expected}`);
    }
}

function requireDerivedVector(actual, expected, path) {
    actual.forEach((value, axis) => requireDerivedScalar(value, expected[axis], `${path}[${axis}]`));
}

function scalarWithinTolerance(before, after, residual, tolerance) {
    return Math.abs(residual) <= tolerance.absolute
        + tolerance.relative * Math.max(1, Math.abs(before), Math.abs(after));
}

function vectorWithinTolerance(before, after, residual, tolerance) {
    return residual.every((value, axis) => scalarWithinTolerance(
        before[axis],
        after[axis],
        value,
        tolerance,
    ));
}

function boundedErrorMessage(error) {
    const message = String(error?.message ?? error).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 512);
    return message || 'transaction failed';
}

function sortedIdentifiers(input, path) {
    const values = cloneStrictJson(input, path);
    if (!Array.isArray(values) || values.length === 0 || values.length > 256) {
        fail(path, 'must be a bounded non-empty array');
    }
    const seen = new Set();
    values.forEach((value, index) => {
        identifier(value, `${path}[${index}]`);
        if (seen.has(value)) fail(`${path}[${index}]`, 'duplicates an earlier identifier');
        seen.add(value);
    });
    return [...values].sort((left, right) => left.localeCompare(right));
}

function normalizeProfiles(input) {
    const profiles = cloneStrictJson(input, '$.profiles');
    if (!Array.isArray(profiles) || profiles.length === 0 || profiles.length > 1024) {
        fail('$.profiles', 'must be a bounded non-empty array');
    }
    profiles.forEach((profile, index) => validatePhaseFamilyProfile(profile, `$.profiles[${index}]`));
    const sorted = [...profiles].sort((left, right) => left.id.localeCompare(right.id));
    for (let index = 1; index < sorted.length; index++) {
        if (sorted[index - 1].id === sorted[index].id) fail('$.profiles', 'contains duplicate ids');
    }
    return cloneAndFreezeStrictJson(sorted, '$.phaseProfiles');
}

function normalizeExpectedPackets(input, path) {
    const values = cloneStrictJson(input, path);
    if (!Array.isArray(values) || values.length === 0 || values.length > 4_000_000) {
        fail(path, 'must be a bounded non-empty array');
    }
    const handles = new Set();
    values.forEach((binding, index) => {
        const at = `${path}[${index}]`;
        exact(binding, EXPECTED_PACKET_KEYS, EXPECTED_PACKET_KEYS, at);
        identifier(binding.lineageId, `${at}.lineageId`);
        integer(binding.representationRevision, `${at}.representationRevision`);
        exact(binding.handle, new Set(['pageId', 'slot', 'generation']), new Set(['pageId', 'slot', 'generation']), `${at}.handle`);
        integer(binding.handle.pageId, `${at}.handle.pageId`);
        integer(binding.handle.slot, `${at}.handle.slot`);
        integer(binding.handle.generation, `${at}.handle.generation`, 1, 0xffffffff);
        const handleKey = `${binding.handle.pageId}:${binding.handle.slot}:${binding.handle.generation}`;
        if (handles.has(handleKey)) fail(`${at}.handle`, 'duplicates an earlier handle');
        handles.add(handleKey);
        if (index > 0 && values[index - 1].lineageId.localeCompare(binding.lineageId) >= 0) {
            fail(path, 'must be strictly sorted by lineageId');
        }
    });
    return values;
}

function validateIdentifierList(value, path) {
    if (!Array.isArray(value)) fail(path, 'must be an array');
    value.forEach((entry, index) => {
        identifier(entry, `${path}[${index}]`);
        if (index > 0 && value[index - 1].localeCompare(entry) >= 0) {
            fail(path, 'must be strictly sorted');
        }
    });
}

function validateRuntimeReceipt(receipt, entry, fluidPhaseIds, path) {
    const { request, expectedSourceRevision, expectedPackets } = entry;
    exact(receipt, RUNTIME_RECEIPT_KEYS, RUNTIME_RECEIPT_KEYS, path);
    if (receipt.schema !== MATTER_PHASE_RUNTIME_RECEIPT_SCHEMA
        || receipt.schemaVersion !== MATTER_PHASE_RUNTIME_VERSION) fail(path, 'uses an unsupported schema');
    if (receipt.transactionId !== request.transactionId || receipt.status !== 'committed') {
        fail(path, 'does not match its transaction');
    }
    if (typeof receipt.recovered !== 'boolean') fail(`${path}.recovered`, 'must be boolean');
    validatePhaseTranscodeReceipt(receipt.phase, `${path}.phase`);
    if (receipt.phase.transactionId !== request.transactionId
        || receipt.phase.recovered !== receipt.recovered
        || receipt.phase.before.regionId !== request.regionId
        || receipt.phase.before.familyId !== request.familyId
        || receipt.phase.before.phaseId !== request.fromPhaseId
        || receipt.phase.before.revision !== request.expectedRevision
        || receipt.phase.before.deviceGeneration !== request.expectedDeviceGeneration
        || receipt.phase.after.phaseId !== request.toPhaseId
        || receipt.phase.after.temperatureK !== request.temperatureK
        || !sameJson(receipt.phase.reservoirDelta, request.reservoirDelta)) {
        fail(`${path}.phase`, 'does not match the request');
    }
    if (expectedSourceRevision !== request.expectedRevision) {
        fail(`${path}.packetRebind.sourceRevision.before`, 'differs from the prepared phase revision');
    }
    const packet = receipt.packetRebind;
    exact(packet, PACKET_REBIND_RECEIPT_KEYS, PACKET_REBIND_RECEIPT_KEYS, `${path}.packetRebind`);
    if (packet.schema !== MATTER_PACKET_PHASE_REBIND_RECEIPT_SCHEMA
        || packet.schemaVersion !== MATTER_PACKET_PHASE_REBIND_RECEIPT_VERSION
        || packet.regionId !== request.regionId
        || packet.fromPhase !== request.fromPhaseId
        || packet.toPhase !== request.toPhaseId
        || packet.internalEnergyDeltaJ !== request.reservoirDelta.internalEnergyJ
        || packet.balanced?.all !== true) fail(`${path}.packetRebind`, 'is inconsistent');
    exact(packet.sourceRevision, TOPOLOGY_REVISION_KEYS, TOPOLOGY_REVISION_KEYS,
        `${path}.packetRebind.sourceRevision`);
    integer(packet.sourceRevision.before, `${path}.packetRebind.sourceRevision.before`);
    integer(packet.sourceRevision.after, `${path}.packetRebind.sourceRevision.after`);
    if (packet.sourceRevision.before !== expectedSourceRevision
        || packet.sourceRevision.after !== expectedSourceRevision + 1
        || packet.sourceRevision.after !== receipt.phase.after.revision) {
        fail(`${path}.packetRebind.sourceRevision`, 'must advance exactly once');
    }
    if (!Array.isArray(packet.packetRevisions)
        || packet.packetRevisions.length !== expectedPackets.length) {
        fail(`${path}.packetRebind.packetRevisions`, 'must match the prepared packet bindings');
    }
    packet.packetRevisions.forEach((binding, index) => {
        const at = `${path}.packetRebind.packetRevisions[${index}]`;
        exact(binding, PACKET_REBIND_PACKET_KEYS, PACKET_REBIND_PACKET_KEYS, at);
        identifier(binding.lineageId, `${at}.lineageId`);
        exact(binding.handle, new Set(['pageId', 'slot', 'generation']), new Set(['pageId', 'slot', 'generation']), `${at}.handle`);
        integer(binding.handle.pageId, `${at}.handle.pageId`);
        integer(binding.handle.slot, `${at}.handle.slot`);
        integer(binding.handle.generation, `${at}.handle.generation`, 1, 0xffffffff);
        exact(binding.representationRevision, TOPOLOGY_REVISION_KEYS, TOPOLOGY_REVISION_KEYS,
            `${at}.representationRevision`);
        integer(binding.representationRevision.before, `${at}.representationRevision.before`);
        integer(binding.representationRevision.after, `${at}.representationRevision.after`);
        if (binding.representationRevision.after !== binding.representationRevision.before + 1) {
            fail(`${at}.representationRevision`, 'must advance exactly once');
        }
        const expected = expectedPackets[index];
        if (binding.lineageId !== expected.lineageId
            || !sameJson(binding.handle, expected.handle)
            || binding.representationRevision.before !== expected.representationRevision) {
            fail(at, 'differs from the prepared packet binding');
        }
        if (index > 0 && packet.packetRevisions[index - 1].lineageId.localeCompare(binding.lineageId) >= 0) {
            fail(`${path}.packetRebind.packetRevisions`, 'must be strictly sorted');
        }
    });
    exact(packet.identities, PACKET_REBIND_IDENTITY_KEYS, PACKET_REBIND_IDENTITY_KEYS,
        `${path}.packetRebind.identities`);
    exact(packet.revisions, PACKET_REBIND_REVISION_KEYS, PACKET_REBIND_REVISION_KEYS,
        `${path}.packetRebind.revisions`);
    exact(packet.balanced, PACKET_REBIND_BALANCE_KEYS, PACKET_REBIND_BALANCE_KEYS,
        `${path}.packetRebind.balanced`);
    for (const [groupName, group] of [
        ['identities', packet.identities],
        ['revisions', packet.revisions],
        ['balanced', packet.balanced],
    ]) {
        for (const [key, value] of Object.entries(group)) {
            if (value !== true) fail(`${path}.packetRebind.${groupName}.${key}`, 'must be true');
        }
    }
    for (const [name, summary] of [['before', packet.before], ['after', packet.after]]) {
        const at = `${path}.packetRebind.${name}`;
        exact(summary, SUMMARY_KEYS, SUMMARY_KEYS, at);
        integer(summary.packetCount, `${at}.packetCount`, 1);
        for (const key of ['massKg', 'representedVolumeM3']) {
            nonNegativeFinite(summary[key], `${at}.${key}`);
            if (summary[key] === 0) fail(`${at}.${key}`, 'must be greater than zero');
        }
        for (const key of ['firstMassMomentKgM', 'centerOfMassM', 'linearMomentumKgMPerS', 'angularMomentumKgM2PerS']) {
            vector(summary[key], `${at}.${key}`);
        }
        exact(summary.energyJ, ENERGY_KEYS, ENERGY_KEYS, `${at}.energyJ`);
        for (const key of ENERGY_KEYS) nonNegativeFinite(summary.energyJ[key], `${at}.energyJ.${key}`);
        requireDerivedScalar(
            summary.energyJ.totalJ,
            summary.energyJ.kineticJ + summary.energyJ.thermalJ
                + summary.energyJ.elasticJ + summary.energyJ.subgridJ,
            `${at}.energyJ.totalJ`,
        );
        requireDerivedVector(
            summary.centerOfMassM,
            summary.firstMassMomentKgM.map(value => value / summary.massKg),
            `${at}.centerOfMassM`,
        );
    }
    if (packet.before.packetCount !== packet.packetRevisions.length
        || packet.after.packetCount !== packet.packetRevisions.length) {
        fail(`${path}.packetRebind`, 'packet counts differ from revision bindings');
    }
    exact(packet.residual, REBIND_RESIDUAL_KEYS, REBIND_RESIDUAL_KEYS,
        `${path}.packetRebind.residual`);
    for (const key of ['massKg', 'totalEnergyJ', 'representedVolumeM3']) {
        finite(packet.residual[key], `${path}.packetRebind.residual.${key}`);
    }
    for (const key of ['firstMassMomentKgM', 'linearMomentumKgMPerS', 'angularMomentumKgM2PerS']) {
        vector(packet.residual[key], `${path}.packetRebind.residual.${key}`);
    }
    exact(packet.tolerance, new Set(['absolute', 'relative']), new Set(['absolute', 'relative']),
        `${path}.packetRebind.tolerance`);
    nonNegativeFinite(packet.tolerance.absolute, `${path}.packetRebind.tolerance.absolute`);
    nonNegativeFinite(packet.tolerance.relative, `${path}.packetRebind.tolerance.relative`);
    requireDerivedScalar(
        packet.residual.massKg,
        packet.after.massKg - packet.before.massKg,
        `${path}.packetRebind.residual.massKg`,
    );
    for (const key of [
        'firstMassMomentKgM', 'linearMomentumKgMPerS', 'angularMomentumKgM2PerS',
    ]) {
        requireDerivedVector(
            packet.residual[key],
            packet.after[key].map((value, axis) => value - packet.before[key][axis]),
            `${path}.packetRebind.residual.${key}`,
        );
    }
    requireDerivedScalar(
        packet.residual.totalEnergyJ,
        packet.after.energyJ.totalJ - packet.before.energyJ.totalJ,
        `${path}.packetRebind.residual.totalEnergyJ`,
    );
    requireDerivedScalar(
        packet.residual.representedVolumeM3,
        packet.after.representedVolumeM3 - packet.before.representedVolumeM3,
        `${path}.packetRebind.residual.representedVolumeM3`,
    );
    const expectedBalanced = {
        mass: scalarWithinTolerance(
            packet.before.massKg,
            packet.after.massKg,
            packet.residual.massKg,
            packet.tolerance,
        ),
        firstMassMoment: vectorWithinTolerance(
            packet.before.firstMassMomentKgM,
            packet.after.firstMassMomentKgM,
            packet.residual.firstMassMomentKgM,
            packet.tolerance,
        ),
        linearMomentum: vectorWithinTolerance(
            packet.before.linearMomentumKgMPerS,
            packet.after.linearMomentumKgMPerS,
            packet.residual.linearMomentumKgMPerS,
            packet.tolerance,
        ),
        angularMomentum: vectorWithinTolerance(
            packet.before.angularMomentumKgM2PerS,
            packet.after.angularMomentumKgM2PerS,
            packet.residual.angularMomentumKgM2PerS,
            packet.tolerance,
        ),
        energy: scalarWithinTolerance(
            packet.internalEnergyDeltaJ,
            packet.residual.totalEnergyJ,
            packet.residual.totalEnergyJ - packet.internalEnergyDeltaJ,
            packet.tolerance,
        ),
        representedVolume: scalarWithinTolerance(
            packet.before.representedVolumeM3,
            packet.after.representedVolumeM3,
            packet.residual.representedVolumeM3,
            packet.tolerance,
        ),
    };
    for (const [key, expected] of Object.entries(expectedBalanced)) {
        if (packet.balanced[key] !== expected) {
            fail(`${path}.packetRebind.balanced.${key}`, `must be ${expected}`);
        }
    }
    if (packet.balanced.all !== Object.values(expectedBalanced).every(Boolean)) {
        fail(`${path}.packetRebind.balanced.all`, 'must equal the conjunction of conservation results');
    }
    if (!nearlyEqual(
        packet.after.energyJ.thermalJ - packet.before.energyJ.thermalJ,
        packet.internalEnergyDeltaJ,
        packet.tolerance.absolute,
        packet.tolerance.relative,
    ) || !nearlyEqual(
        packet.after.energyJ.totalJ - packet.before.energyJ.totalJ,
        packet.internalEnergyDeltaJ,
        packet.tolerance.absolute,
        packet.tolerance.relative,
    )) fail(`${path}.packetRebind.internalEnergyDeltaJ`, 'does not reconcile packet energy');
    for (const key of [
        'massKg', 'firstMassMomentKgM', 'linearMomentumKgMPerS',
        'angularMomentumKgM2PerS', 'representedVolumeM3',
    ]) {
        const before = packet.before[key];
        const after = packet.after[key];
        if (Array.isArray(before)) {
            if (!vectorWithinTolerance(before, after, packet.residual[key], packet.tolerance)) {
                fail(`${path}.packetRebind.${key}`, 'is not conserved');
            }
        } else if (!scalarWithinTolerance(before, after, packet.residual[key], packet.tolerance)) {
            fail(`${path}.packetRebind.${key}`, 'is not conserved');
        }
    }
    for (const key of ['kineticJ', 'elasticJ', 'subgridJ']) {
        if (!nearlyEqual(
            packet.before.energyJ[key],
            packet.after.energyJ[key],
            packet.tolerance.absolute,
            packet.tolerance.relative,
        )) fail(`${path}.packetRebind.energyJ.${key}`, 'must remain conserved');
    }
    exact(receipt.fluidProjection, FLUID_RECEIPT_KEYS, FLUID_RECEIPT_KEYS, `${path}.fluidProjection`);
    for (const key of ['beforeActive', 'afterActive']) {
        if (typeof receipt.fluidProjection[key] !== 'boolean') fail(`${path}.fluidProjection.${key}`, 'must be boolean');
    }
    validateIdentifierList(receipt.fluidProjection.activatedPacketIds, `${path}.fluidProjection.activatedPacketIds`);
    validateIdentifierList(receipt.fluidProjection.deactivatedPacketIds, `${path}.fluidProjection.deactivatedPacketIds`);
    const beforeFluid = fluidPhaseIds.includes(request.fromPhaseId);
    const afterFluid = fluidPhaseIds.includes(request.toPhaseId);
    const expectedLineageIds = expectedPackets.map(binding => binding.lineageId);
    const expectedActivated = !beforeFluid && afterFluid ? expectedLineageIds : [];
    const expectedDeactivated = beforeFluid && !afterFluid ? expectedLineageIds : [];
    if (receipt.fluidProjection.beforeActive !== beforeFluid
        || receipt.fluidProjection.afterActive !== afterFluid
        || !sameJson(receipt.fluidProjection.activatedPacketIds, expectedActivated)
        || !sameJson(receipt.fluidProjection.deactivatedPacketIds, expectedDeactivated)) {
        fail(`${path}.fluidProjection`, 'does not match phase solver authority');
    }
    exact(receipt.topologyRevision, TOPOLOGY_REVISION_KEYS, TOPOLOGY_REVISION_KEYS, `${path}.topologyRevision`);
    integer(receipt.topologyRevision.before, `${path}.topologyRevision.before`);
    integer(receipt.topologyRevision.after, `${path}.topologyRevision.after`);
    const structuralChanges = receipt.phase.deletedBondIds.length + receipt.phase.weakenedBondIds.length;
    const expectedTopologyAdvance = request.structuralPolicy.mode === 'delete'
        ? receipt.phase.deletedBondIds.length
        : (request.structuralPolicy.mode === 'weaken' && receipt.phase.weakenedBondIds.length > 0 ? 1 : 0);
    if ((request.structuralPolicy.mode === 'preserve' && structuralChanges !== 0)
        || (request.structuralPolicy.mode === 'weaken' && receipt.phase.deletedBondIds.length !== 0)
        || (request.structuralPolicy.mode === 'delete' && receipt.phase.weakenedBondIds.length !== 0)
        || receipt.topologyRevision.after !== receipt.topologyRevision.before + expectedTopologyAdvance) {
        fail(`${path}.topologyRevision`, 'does not match structural policy effects');
    }
    exact(receipt.invariants, INVARIANT_KEYS, INVARIANT_KEYS, `${path}.invariants`);
    for (const key of INVARIANT_KEYS) {
        if (receipt.invariants[key] !== true) fail(`${path}.invariants.${key}`, 'must be true');
    }
}

/** Recoverable fault injected between two cross-domain commit stages. */
export class MatterPhaseRuntimeInterruptedError extends Error {
    constructor(transactionId, point) {
        super(`Matter phase runtime transaction '${transactionId}' was interrupted at ${point}`);
        this.name = 'MatterPhaseRuntimeInterruptedError';
        this.transactionId = transactionId;
        this.point = point;
    }
}

/**
 * Owns the cross-domain transaction boundary for one canonical Matter region.
 * The supplied codec and topology remain caller-owned; the coordinator owns
 * its phase journal and fluid projection and never submits GPU work itself.
 */
export class MatterPhaseRuntimeCoordinator {
    #regionId;
    #codec;
    #topology;
    #transcoder;
    #fluid;
    #fluidPhaseIds;
    #fluidMetadata;
    #phaseProfiles;
    #maximumJournalEntries;
    #journal = new Map();
    #logger;
    #destroyCodecOnDestroy;
    #destroyTopologyOnDestroy;
    #destroyed = false;

    constructor(optionsInput) {
        const options = safeOptions(optionsInput, OPTIONS, '$.options');
        this.#regionId = identifier(options.regionId, '$.options.regionId');
        this.#codec = options.codec;
        for (const method of [
            'getPacket', 'listPackets', 'rebindRegionPhase', 'snapshot', 'restore',
        ]) {
            if (typeof this.#codec?.[method] !== 'function') fail(`$.options.codec.${method}`, 'is required');
        }
        this.#topology = options.topology;
        for (const method of ['snapshot', 'restore']) {
            if (typeof this.#topology?.[method] !== 'function') fail(`$.options.topology.${method}`, 'is required');
        }
        if (options.logger != null && (!options.logger || typeof options.logger !== 'object')) {
            fail('$.options.logger', 'must be an object or null');
        }
        this.#logger = options.logger ?? null;
        if (options.destroyCodecOnDestroy != null && typeof options.destroyCodecOnDestroy !== 'boolean') {
            fail('$.options.destroyCodecOnDestroy', 'must be boolean');
        }
        if (options.destroyTopologyOnDestroy != null && typeof options.destroyTopologyOnDestroy !== 'boolean') {
            fail('$.options.destroyTopologyOnDestroy', 'must be boolean');
        }
        this.#destroyCodecOnDestroy = options.destroyCodecOnDestroy ?? false;
        this.#destroyTopologyOnDestroy = options.destroyTopologyOnDestroy ?? false;
        this.#fluidPhaseIds = sortedIdentifiers(
            options.fluidPhaseIds ?? DEFAULT_FLUID_PHASE_IDS,
            '$.options.fluidPhaseIds',
        );
        const fluidMetadata = cloneStrictJson(options.fluidMetadata ?? {}, '$.options.fluidMetadata');
        if (!isPlainJsonObject(fluidMetadata)) fail('$.options.fluidMetadata', 'must be a plain object');
        this.#fluidMetadata = cloneAndFreezeStrictJson(fluidMetadata, '$.options.fluidMetadata');
        this.#phaseProfiles = normalizeProfiles(options.profiles ?? PHASE_FAMILY_PROFILES);
        this.#maximumJournalEntries = integer(
            options.maximumJournalEntries ?? 256,
            '$.options.maximumJournalEntries',
            1,
            100_000,
        );
        const fluidOptions = cloneStrictJson(options.fluidOptions ?? {}, '$.options.fluidOptions');
        exact(fluidOptions, FLUID_OPTIONS, new Set(), '$.options.fluidOptions');
        const eventLogger = event => this.#log('debug', event.type, event);
        this.#transcoder = new AtomicPhaseTranscoder({
            profiles: this.#phaseProfiles,
            topology: this.#topology,
            deviceGeneration: this.#topology.deviceGeneration,
            logger: eventLogger,
        });
        this.#fluid = new AdaptiveMatterFluidSystem({
            codec: this.#codec,
            ...fluidOptions,
            logger: this.#logger,
        });
        this.#log('debug', 'initialize', {
            regionId: this.#regionId,
            fluidPhaseIds: this.#fluidPhaseIds,
        });
    }

    #assertAlive() {
        if (this.#destroyed) throw new Error('MatterPhaseRuntimeCoordinator is destroyed');
    }

    #log(level, event, details = {}) {
        const method = this.#logger?.[level];
        if (typeof method !== 'function') return;
        try { method.call(this.#logger, `[MatterPhaseRuntime] ${event}`, details); } catch (_) { /* observational */ }
    }

    #regionPackets() {
        return [...this.#codec.listPackets()]
            .filter(packet => packet.regionId === this.#regionId)
            .sort((left, right) => left.lineage.id.localeCompare(right.lineage.id));
    }

    #participantSnapshot() {
        return cloneAndFreezeStrictJson({
            codec: this.#codec.snapshot(),
            fluid: this.#fluid.snapshot(),
            transcoder: this.#transcoder.snapshot(),
        }, '$.phaseRuntimeParticipants');
    }

    #restoreParticipants(snapshotInput) {
        const snapshot = cloneStrictJson(snapshotInput, '$.phaseRuntimeParticipants');
        exact(snapshot, PARTICIPANT_KEYS, PARTICIPANT_KEYS, '$.phaseRuntimeParticipants');
        if (!sameJson(snapshot.codec, snapshot.fluid?.controller?.codec)) {
            fail('$.phaseRuntimeParticipants', 'codec and fluid snapshots disagree');
        }
        this.#codec.restore(snapshot.codec);
        this.#fluid.restore(snapshot.fluid);
        this.#transcoder.restore(snapshot.transcoder);
    }

    #packetBinding() {
        const packets = this.#regionPackets();
        if (packets.length === 0) throw new RangeError(`Matter region '${this.#regionId}' has no codec packets`);
        const sourceRevision = packets[0].sourceRevision;
        if (packets.some(packet => packet.sourceRevision !== sourceRevision)) {
            throw new Error(`Matter region '${this.#regionId}' has divergent source revisions`);
        }
        return cloneAndFreezeStrictJson({
            sourceRevision,
            expectedPackets: packets.map(packet => ({
                handle: packet.handle,
                lineageId: packet.lineage.id,
                representationRevision: packet.representationRevision,
            })),
        }, '$.phaseRuntimePacketBinding');
    }

    #assertPacketState(state, { checkFluid = true } = {}) {
        const packets = this.#regionPackets();
        if (packets.length === 0) throw new RangeError(`Matter region '${this.#regionId}' has no codec packets`);
        if (packets.some(packet => packet.phase !== state.phaseId)) {
            throw new Error(`Matter region '${this.#regionId}' packet phases disagree with canonical phase state`);
        }
        const sourceRevision = packets[0].sourceRevision;
        if (packets.some(packet => packet.sourceRevision !== sourceRevision)) {
            throw new Error(`Matter region '${this.#regionId}' has divergent source revisions`);
        }
        if (sourceRevision !== state.revision) {
            throw new Error(`Matter region '${this.#regionId}' source revision disagrees with canonical phase state`);
        }
        const massKg = compensatedSum(packets.map(packet => packet.massKg));
        if (!nearlyEqual(massKg, state.reservoirs.materialMassKg)) {
            throw new Error(`Matter region '${this.#regionId}' packet mass disagrees with its material reservoir`);
        }
        const internalEnergyJ = compensatedSum(packets.map(packet => (
            packet.thermalEnergyJ + packet.elasticEnergyJ + packet.subgridEnergyJ
        )));
        if (!nearlyEqual(internalEnergyJ, state.reservoirs.internalEnergyJ)) {
            throw new Error(`Matter region '${this.#regionId}' packet energy disagrees with its internal-energy reservoir`);
        }
        const packetIds = packets.map(packet => packet.lineage.id);
        const registered = new Set(this.#fluid.registeredPacketIds());
        const expectedFluid = this.#fluidPhaseIds.includes(state.phaseId);
        if (checkFluid && packetIds.some(packetId => registered.has(packetId) !== expectedFluid)) {
            throw new Error(`Matter region '${this.#regionId}' fluid authority disagrees with phase policy`);
        }
        return cloneAndFreezeStrictJson({
            packetCount: packets.length,
            sourceRevision,
            massKg,
            internalEnergyJ,
            fluidActive: expectedFluid,
        }, '$.phaseRuntimeAlignment');
    }

    #assertAligned() {
        const state = this.#transcoder.state(this.#regionId);
        if (!state) throw new RangeError(`Matter region '${this.#regionId}' has no registered phase state`);
        return this.#assertPacketState(state);
    }

    #synchronizeFluid(phaseId) {
        const packets = this.#regionPackets();
        const ids = packets.map(packet => packet.lineage.id);
        const before = new Set(this.#fluid.registeredPacketIds());
        const beforeActive = ids.length > 0 && ids.every(id => before.has(id));
        const desired = this.#fluidPhaseIds.includes(phaseId);
        if (desired) {
            for (const packet of packets) {
                if (!before.has(packet.lineage.id)) {
                    this.#fluid.registerCodecPacket(packet.handle, this.#fluidMetadata);
                }
            }
        } else {
            for (const packet of packets) {
                if (before.has(packet.lineage.id)) this.#fluid.unregisterCodecPacket(packet.handle);
            }
        }
        const after = new Set(this.#fluid.registeredPacketIds());
        const afterActive = ids.length > 0 && ids.every(id => after.has(id));
        const activatedPacketIds = ids.filter(id => !before.has(id) && after.has(id)).sort();
        const deactivatedPacketIds = ids.filter(id => before.has(id) && !after.has(id)).sort();
        if (afterActive !== desired || (!desired && ids.some(id => after.has(id)))) {
            throw new Error(`Matter region '${this.#regionId}' fluid authority synchronization failed`);
        }
        return cloneAndFreezeStrictJson({
            beforeActive,
            afterActive,
            activatedPacketIds,
            deactivatedPacketIds,
        }, '$.phaseRuntimeFluidProjectionReceipt');
    }

    #assertPreparedParticipants(entry) {
        if (!sameJson(this.#participantSnapshot(), entry.preparedParticipants)) {
            this.#transcoder.abortPrepared(entry.transactionId, 'participant state changed after prepare');
            entry.status = 'aborted';
            entry.error = 'participant state changed after prepare';
            entry.preparedParticipants = null;
            this.#log('error', 'commit-stale', { transactionId: entry.transactionId });
            throw new Error(`Matter phase transaction '${entry.transactionId}' is stale`);
        }
    }

    #rollbackPrepared(entry, preparedParticipants, error, interrupted) {
        const message = boundedErrorMessage(error);
        try {
            this.#restoreParticipants(preparedParticipants);
        } catch (rollbackError) {
            this.#log('error', 'rollback-failed', {
                transactionId: entry.transactionId,
                error: error.message,
                rollbackError: rollbackError.message,
            });
            throw rollbackError;
        }
        if (interrupted) {
            entry.status = 'interrupted';
            entry.error = message;
        } else {
            this.#transcoder.abortPrepared(entry.transactionId, message);
            entry.status = 'aborted';
            entry.error = message;
            entry.preparedParticipants = null;
        }
    }

    get regionId() { return this.#regionId; }
    get packetCodec() { return this.#codec; }
    get structuralTopology() { return this.#topology; }
    get fluidSystem() { return this.#fluid; }

    registerState(stateInput) {
        this.#assertAlive();
        const state = createPhaseState(stateInput);
        if (state.regionId !== this.#regionId) fail('$.phaseState.regionId', 'does not match this coordinator');
        if (this.#transcoder.state(this.#regionId)) fail('$.phaseState.regionId', 'is already registered');
        this.#assertPacketState(state, { checkFluid: false });
        const rollback = this.#participantSnapshot();
        try {
            const registered = this.#transcoder.registerState(state);
            this.#synchronizeFluid(registered.phaseId);
            this.#assertAligned();
            this.#log('info', 'state-registered', { regionId: this.#regionId, phaseId: registered.phaseId });
            return registered;
        } catch (error) {
            this.#restoreParticipants(rollback);
            this.#log('error', 'state-register-error', { message: error.message });
            throw error;
        }
    }

    state() {
        this.#assertAlive();
        return this.#transcoder.state(this.#regionId);
    }

    prepare(requestInput) {
        this.#assertAlive();
        const request = createPhaseTranscodeRequest(requestInput);
        if (request.regionId !== this.#regionId) fail('$.transcodeRequest.regionId', 'does not match this coordinator');
        const existing = this.#journal.get(request.transactionId);
        if (existing) {
            if (!sameJson(existing.request, request)) fail('$.transcodeRequest.transactionId', 'was reused for different input');
            return cloneAndFreezeStrictJson(existing);
        }
        if ([...this.#journal.values()].some(entry => ['prepared', 'applying', 'interrupted'].includes(entry.status))) {
            throw new Error(`Matter region '${this.#regionId}' already has a pending phase transaction`);
        }
        if (this.#journal.size >= this.#maximumJournalEntries) {
            throw new RangeError('Matter phase runtime journal capacity exhausted');
        }
        if (request.reservoirDelta.materialMassKg !== 0) {
            fail('$.transcodeRequest.reservoirDelta.materialMassKg', 'must be zero for identity-preserving packet migration');
        }
        this.#assertAligned();
        const binding = this.#packetBinding();
        const rollback = this.#participantSnapshot();
        try {
            this.#transcoder.prepare(request);
            const entry = {
                transactionId: request.transactionId,
                status: 'prepared',
                attempts: 0,
                request: cloneStrictJson(request),
                expectedSourceRevision: binding.sourceRevision,
                expectedPackets: cloneStrictJson(binding.expectedPackets),
                preparedParticipants: cloneStrictJson(this.#participantSnapshot()),
                receipt: null,
                error: null,
            };
            this.#journal.set(entry.transactionId, entry);
            this.#log('debug', 'prepared', {
                transactionId: entry.transactionId,
                packetCount: entry.expectedPackets.length,
            });
            return cloneAndFreezeStrictJson(entry);
        } catch (error) {
            this.#restoreParticipants(rollback);
            this.#log('error', 'prepare-error', { message: error.message });
            throw error;
        }
    }

    commitPrepared(transactionIdInput, optionsInput = {}) {
        this.#assertAlive();
        const transactionId = identifier(transactionIdInput, '$.transactionId');
        const options = cloneStrictJson(optionsInput, '$.commitOptions');
        exact(options, COMMIT_OPTIONS, new Set(), '$.commitOptions');
        const interruptAt = options.interruptAt ?? null;
        if (!INTERRUPT_POINTS.has(interruptAt)) fail('$.commitOptions.interruptAt', 'is unsupported');
        if (options.recovered != null && typeof options.recovered !== 'boolean') {
            fail('$.commitOptions.recovered', 'must be boolean');
        }
        const entry = this.#journal.get(transactionId);
        if (!entry) throw new RangeError(`Unknown Matter phase runtime transaction '${transactionId}'`);
        if (entry.status === 'committed') return entry.receipt;
        if (entry.status === 'aborted') throw new Error(`Matter phase transaction '${transactionId}' is aborted: ${entry.error}`);
        this.#assertPreparedParticipants(entry);
        const preparedParticipants = entry.preparedParticipants;
        const topologyRevisionBefore = preparedParticipants.transcoder.topology.revision;
        entry.status = 'applying';
        entry.attempts += 1;
        entry.error = null;
        this.#log('debug', 'commit-enter', { transactionId, attempt: entry.attempts });
        try {
            if (interruptAt === 'after-prepare') {
                throw new MatterPhaseRuntimeInterruptedError(transactionId, interruptAt);
            }
            const phase = this.#transcoder.commitPrepared(transactionId, {
                interruptAt: interruptAt === 'after-structural' ? interruptAt : null,
                recovered: options.recovered ?? false,
            });
            if (interruptAt === 'after-phase') {
                throw new MatterPhaseRuntimeInterruptedError(transactionId, interruptAt);
            }
            const packetRebind = this.#codec.rebindRegionPhase({
                regionId: this.#regionId,
                fromPhase: entry.request.fromPhaseId,
                toPhase: entry.request.toPhaseId,
                expectedSourceRevision: entry.expectedSourceRevision,
                nextSourceRevision: entry.expectedSourceRevision + 1,
                expectedPackets: entry.expectedPackets,
                internalEnergyDeltaJ: entry.request.reservoirDelta.internalEnergyJ,
            }).receipt;
            if (interruptAt === 'after-codec') {
                throw new MatterPhaseRuntimeInterruptedError(transactionId, interruptAt);
            }
            const fluidProjection = this.#synchronizeFluid(entry.request.toPhaseId);
            if (interruptAt === 'after-fluid') {
                throw new MatterPhaseRuntimeInterruptedError(transactionId, interruptAt);
            }
            this.#assertAligned();
            const invariants = {
                regionIdentity: phase.before.regionId === this.#regionId && phase.after.regionId === this.#regionId,
                definitionIdentity: packetRebind.identities.definition,
                lineageIdentity: packetRebind.identities.lineage,
                handleIdentity: packetRebind.identities.handles,
                damageState: packetRebind.identities.damage,
                mass: packetRebind.balanced.mass,
                firstMassMoment: packetRebind.balanced.firstMassMoment,
                linearMomentum: packetRebind.balanced.linearMomentum,
                angularMomentum: packetRebind.balanced.angularMomentum,
                energyReconciled: packetRebind.balanced.energy,
                representedVolume: packetRebind.balanced.representedVolume,
                sourceRevisionAdvanced: packetRebind.revisions.sourceAdvanced,
                representationRevisionAdvanced: packetRebind.revisions.representationAdvanced,
                fluidAuthorityMatchesPhase: fluidProjection.afterActive
                    === this.#fluidPhaseIds.includes(phase.after.phaseId),
            };
            invariants.all = Object.values(invariants).every(Boolean);
            if (!invariants.all) throw new Error('Matter phase runtime conservation invariants failed');
            const receipt = deepFreezeJson({
                schema: MATTER_PHASE_RUNTIME_RECEIPT_SCHEMA,
                schemaVersion: MATTER_PHASE_RUNTIME_VERSION,
                transactionId,
                status: 'committed',
                recovered: options.recovered ?? false,
                phase,
                packetRebind,
                fluidProjection,
                topologyRevision: {
                    before: topologyRevisionBefore,
                    after: this.#topology.revision,
                },
                invariants,
            }, '$.matterPhaseRuntimeReceipt');
            entry.status = 'committed';
            entry.receipt = receipt;
            entry.preparedParticipants = null;
            this.#log('debug', 'commit-exit', {
                transactionId,
                phaseId: phase.after.phaseId,
                packetCount: packetRebind.after.packetCount,
            });
            return receipt;
        } catch (error) {
            const interrupted = error instanceof MatterPhaseRuntimeInterruptedError
                || error instanceof TranscodeInterruptedError;
            this.#rollbackPrepared(entry, preparedParticipants, error, interrupted);
            this.#log('error', 'commit-error', {
                transactionId,
                status: entry.status,
                message: error.message,
            });
            if (error instanceof TranscodeInterruptedError) {
                throw new MatterPhaseRuntimeInterruptedError(transactionId, error.point);
            }
            throw error;
        }
    }

    transcode(requestInput, optionsInput = {}) {
        const prepared = this.prepare(requestInput);
        if (prepared.status === 'committed') return prepared.receipt;
        return this.commitPrepared(prepared.transactionId, optionsInput);
    }

    abortPrepared(transactionIdInput, reasonInput = 'aborted by caller') {
        this.#assertAlive();
        const transactionId = identifier(transactionIdInput, '$.transactionId');
        if (typeof reasonInput !== 'string' || reasonInput.length === 0 || reasonInput.length > 512
            || /[\u0000-\u001f\u007f]/.test(reasonInput)) fail('$.reason', 'must be a bounded control-free string');
        const entry = this.#journal.get(transactionId);
        if (!entry) throw new RangeError(`Unknown Matter phase runtime transaction '${transactionId}'`);
        if (entry.status === 'committed') throw new Error(`Committed transaction '${transactionId}' cannot be aborted`);
        if (entry.status === 'aborted') return cloneAndFreezeStrictJson(entry);
        this.#transcoder.abortPrepared(transactionId, reasonInput);
        entry.status = 'aborted';
        entry.error = reasonInput;
        entry.preparedParticipants = null;
        return cloneAndFreezeStrictJson(entry);
    }

    recoverTransactions() {
        this.#assertAlive();
        const recovered = [];
        const aborted = [];
        for (const entry of [...this.#journal.values()].sort((left, right) => (
            left.transactionId.localeCompare(right.transactionId)
        ))) {
            if (!['prepared', 'interrupted'].includes(entry.status)) continue;
            try {
                recovered.push(this.commitPrepared(entry.transactionId, { recovered: true }));
            } catch (error) {
                if (entry.status === 'aborted') aborted.push(entry.transactionId);
                else throw error;
            }
        }
        this.#log('info', 'recovery-complete', {
            recoveredCount: recovered.length,
            abortedCount: aborted.length,
        });
        return cloneAndFreezeStrictJson({ recovered, aborted });
    }

    stepFluid(optionsInput) {
        this.#assertAlive();
        const state = this.#transcoder.state(this.#regionId);
        if (!state || !this.#fluidPhaseIds.includes(state.phaseId)) {
            throw new Error(`Matter region '${this.#regionId}' is not in a fluid phase`);
        }
        if ([...this.#journal.values()].some(entry => ['prepared', 'applying', 'interrupted'].includes(entry.status))) {
            throw new Error(`Matter region '${this.#regionId}' cannot step fluid while a phase transaction is pending`);
        }
        this.#assertAligned();
        const rollback = this.#participantSnapshot();
        try {
            const result = this.#fluid.step(optionsInput);
            this.#assertAligned();
            return result;
        } catch (error) {
            this.#restoreParticipants(rollback);
            this.#log('error', 'fluid-step-rollback', { message: error.message });
            throw error;
        }
    }

    journalEntry(transactionIdInput) {
        this.#assertAlive();
        const entry = this.#journal.get(identifier(transactionIdInput, '$.transactionId'));
        return entry ? cloneAndFreezeStrictJson(entry) : null;
    }

    diagnostics() {
        this.#assertAlive();
        const state = this.#transcoder.state(this.#regionId);
        const alignment = state ? this.#assertAligned() : null;
        return cloneAndFreezeStrictJson({
            schema: 'engine.matter.phase-runtime-diagnostics',
            schemaVersion: MATTER_PHASE_RUNTIME_VERSION,
            regionId: this.#regionId,
            state,
            alignment,
            topologyRevision: this.#topology.revision,
            fluid: this.#fluid.diagnostics(),
            pendingTransactions: [...this.#journal.values()]
                .filter(entry => ['prepared', 'applying', 'interrupted'].includes(entry.status)).length,
            committedTransactions: [...this.#journal.values()].filter(entry => entry.status === 'committed').length,
            abortedTransactions: [...this.#journal.values()].filter(entry => entry.status === 'aborted').length,
        }, '$.matterPhaseRuntimeDiagnostics');
    }

    snapshot() {
        this.#assertAlive();
        if (this.#transcoder.state(this.#regionId)) this.#assertAligned();
        const participants = this.#participantSnapshot();
        return cloneAndFreezeStrictJson({
            schema: MATTER_PHASE_RUNTIME_SNAPSHOT_SCHEMA,
            schemaVersion: MATTER_PHASE_RUNTIME_VERSION,
            regionId: this.#regionId,
            fluidPhaseIds: this.#fluidPhaseIds,
            fluidMetadata: this.#fluidMetadata,
            phaseProfiles: this.#phaseProfiles,
            maximumJournalEntries: this.#maximumJournalEntries,
            journal: [...this.#journal.values()]
                .sort((left, right) => left.transactionId.localeCompare(right.transactionId)),
            ...participants,
        }, '$.matterPhaseRuntimeSnapshot');
    }

    restore(snapshotInput) {
        this.#assertAlive();
        const snapshot = cloneStrictJson(snapshotInput, '$.matterPhaseRuntimeSnapshot');
        exact(snapshot, SNAPSHOT_KEYS, SNAPSHOT_KEYS, '$.matterPhaseRuntimeSnapshot');
        if (snapshot.schema !== MATTER_PHASE_RUNTIME_SNAPSHOT_SCHEMA
            || snapshot.schemaVersion !== MATTER_PHASE_RUNTIME_VERSION) fail('$.matterPhaseRuntimeSnapshot', 'uses an unsupported schema');
        if (snapshot.regionId !== this.#regionId) fail('$.matterPhaseRuntimeSnapshot.regionId', 'does not match this coordinator');
        const fluidPhaseIds = sortedIdentifiers(snapshot.fluidPhaseIds, '$.matterPhaseRuntimeSnapshot.fluidPhaseIds');
        if (!sameJson(fluidPhaseIds, this.#fluidPhaseIds)) fail('$.matterPhaseRuntimeSnapshot.fluidPhaseIds', 'does not match configuration');
        const profiles = normalizeProfiles(snapshot.phaseProfiles);
        if (!sameJson(profiles, this.#phaseProfiles)) fail('$.matterPhaseRuntimeSnapshot.phaseProfiles', 'does not match configuration');
        integer(snapshot.maximumJournalEntries, '$.matterPhaseRuntimeSnapshot.maximumJournalEntries', 1, 100_000);
        if (snapshot.maximumJournalEntries !== this.#maximumJournalEntries) {
            fail('$.matterPhaseRuntimeSnapshot.maximumJournalEntries', 'does not match configuration');
        }
        if (!isPlainJsonObject(snapshot.fluidMetadata)) {
            fail('$.matterPhaseRuntimeSnapshot.fluidMetadata', 'must be a plain object');
        }
        if (!Array.isArray(snapshot.journal) || snapshot.journal.length > this.#maximumJournalEntries) {
            fail('$.matterPhaseRuntimeSnapshot.journal', 'must be a bounded array');
        }
        const journal = new Map();
        let pending = 0;
        snapshot.journal.forEach((entry, index) => {
            const path = `$.matterPhaseRuntimeSnapshot.journal[${index}]`;
            exact(entry, JOURNAL_KEYS, JOURNAL_KEYS, path);
            identifier(entry.transactionId, `${path}.transactionId`);
            if (!JOURNAL_STATES.has(entry.status)) fail(`${path}.status`, 'is unsupported');
            integer(entry.attempts, `${path}.attempts`);
            entry.request = cloneStrictJson(createPhaseTranscodeRequest(entry.request));
            if (entry.transactionId !== entry.request.transactionId || entry.request.regionId !== this.#regionId) {
                fail(path, 'request identity differs');
            }
            integer(entry.expectedSourceRevision, `${path}.expectedSourceRevision`);
            if (entry.expectedSourceRevision !== entry.request.expectedRevision) {
                fail(`${path}.expectedSourceRevision`, 'differs from the prepared phase revision');
            }
            entry.expectedPackets = normalizeExpectedPackets(entry.expectedPackets, `${path}.expectedPackets`);
            const isPending = ['prepared', 'applying', 'interrupted'].includes(entry.status);
            if (isPending) {
                pending += 1;
                exact(entry.preparedParticipants, PARTICIPANT_KEYS, PARTICIPANT_KEYS, `${path}.preparedParticipants`);
                if (!sameJson(entry.preparedParticipants.codec, entry.preparedParticipants.fluid?.controller?.codec)) {
                    fail(`${path}.preparedParticipants`, 'codec and fluid snapshots disagree');
                }
            } else if (entry.preparedParticipants !== null) {
                fail(`${path}.preparedParticipants`, 'must be null after completion');
            }
            if (entry.status === 'committed') {
                validateRuntimeReceipt(entry.receipt, entry, this.#fluidPhaseIds, `${path}.receipt`);
                if (entry.error !== null) fail(`${path}.error`, 'must be null after commit');
            } else if (entry.receipt !== null) {
                fail(`${path}.receipt`, 'must be null before commit');
            }
            if (entry.error !== null && typeof entry.error !== 'string') fail(`${path}.error`, 'must be string or null');
            if (['prepared', 'applying', 'committed'].includes(entry.status) && entry.error !== null) {
                fail(`${path}.error`, `must be null while ${entry.status}`);
            }
            if (['interrupted', 'aborted'].includes(entry.status)
                && (typeof entry.error !== 'string' || entry.error.length === 0 || entry.error.length > 512)) {
                fail(`${path}.error`, `must describe why the transaction is ${entry.status}`);
            }
            if (index > 0 && snapshot.journal[index - 1].transactionId.localeCompare(entry.transactionId) >= 0) {
                fail('$.matterPhaseRuntimeSnapshot.journal', 'must be strictly sorted');
            }
            journal.set(entry.transactionId, entry);
        });
        if (pending > 1) fail('$.matterPhaseRuntimeSnapshot.journal', 'contains multiple pending transactions');
        if (!Array.isArray(snapshot.transcoder?.journal)
            || !Array.isArray(snapshot.transcoder?.receipts)
            || snapshot.transcoder.journal.length !== journal.size) {
            fail('$.matterPhaseRuntimeSnapshot', 'runtime and phase journals differ');
        }
        const phaseJournal = new Map(snapshot.transcoder.journal.map(entry => [entry.transactionId, entry]));
        const phaseReceipts = new Map(snapshot.transcoder.receipts.map(receipt => [
            receipt.transactionId,
            receipt,
        ]));
        for (const entry of journal.values()) {
            const phaseEntry = phaseJournal.get(entry.transactionId);
            const expectedStatus = entry.status === 'interrupted' ? 'prepared' : entry.status;
            if (!phaseEntry || phaseEntry.status !== expectedStatus
                || !sameJson(phaseEntry.request, entry.request)) {
                fail('$.matterPhaseRuntimeSnapshot', `runtime and phase journal differ for '${entry.transactionId}'`);
            }
            const phaseReceipt = phaseReceipts.get(entry.transactionId);
            if (entry.status === 'committed' && (!sameJson(phaseEntry.before, entry.receipt.phase.before)
                || !sameJson(phaseEntry.after, entry.receipt.phase.after)
                || !sameJson(phaseReceipt, entry.receipt.phase))) {
                fail('$.matterPhaseRuntimeSnapshot', `phase receipt differs for '${entry.transactionId}'`);
            }
        }
        const currentParticipants = {
            codec: snapshot.codec,
            fluid: snapshot.fluid,
            transcoder: snapshot.transcoder,
        };
        if (!sameJson(snapshot.codec, snapshot.fluid?.controller?.codec)) {
            fail('$.matterPhaseRuntimeSnapshot', 'codec and fluid snapshots disagree');
        }
        const pendingEntry = [...journal.values()].find(entry => (
            ['prepared', 'applying', 'interrupted'].includes(entry.status)
        ));
        if (pendingEntry && !sameJson(currentParticipants, pendingEntry.preparedParticipants)) {
            fail('$.matterPhaseRuntimeSnapshot', 'pending transaction guard differs from participant state');
        }
        const rollback = {
            participants: this.#participantSnapshot(),
            fluidMetadata: this.#fluidMetadata,
            journal: this.#journal,
        };
        try {
            this.#restoreParticipants(currentParticipants);
            this.#fluidMetadata = cloneAndFreezeStrictJson(
                snapshot.fluidMetadata,
                '$.matterPhaseRuntimeSnapshot.fluidMetadata',
            );
            this.#journal = new Map([...journal].map(([id, entry]) => [id, cloneStrictJson(entry)]));
            if (pendingEntry) {
                const binding = this.#packetBinding();
                if (binding.sourceRevision !== pendingEntry.expectedSourceRevision
                    || !sameJson(binding.expectedPackets, pendingEntry.expectedPackets)) {
                    fail('$.matterPhaseRuntimeSnapshot.journal', 'pending packet binding is stale or tampered');
                }
            }
            if (this.#transcoder.state(this.#regionId)) this.#assertAligned();
            this.#log('info', 'snapshot-restored', {
                regionId: this.#regionId,
                journalEntries: this.#journal.size,
            });
            return this;
        } catch (error) {
            this.#restoreParticipants(rollback.participants);
            this.#fluidMetadata = rollback.fluidMetadata;
            this.#journal = rollback.journal;
            this.#log('error', 'restore-error', { message: error.message });
            throw error;
        }
    }

    destroy() {
        if (this.#destroyed) return false;
        this.#fluid.destroy();
        this.#transcoder.destroy();
        this.#journal.clear();
        if (this.#destroyCodecOnDestroy) this.#codec.destroy?.();
        if (this.#destroyTopologyOnDestroy) this.#topology.destroy?.();
        this.#destroyed = true;
        this.#log('debug', 'destroyed', { regionId: this.#regionId });
        return true;
    }
}

/** Create an empty region coordinator around caller-owned canonical stores. */
export function createMatterPhaseRuntimeCoordinator(options) {
    return new MatterPhaseRuntimeCoordinator(options);
}

/** Restore a validated coordinator snapshot, constructing stores when omitted. */
export function restoreMatterPhaseRuntimeCoordinator(snapshotInput, optionsInput = {}) {
    const snapshot = cloneStrictJson(snapshotInput, '$.matterPhaseRuntimeSnapshot');
    exact(snapshot, SNAPSHOT_KEYS, SNAPSHOT_KEYS, '$.matterPhaseRuntimeSnapshot');
    const options = safeOptions(optionsInput, new Set(['codec', 'topology', 'logger']), '$.options');
    const logger = options.logger ?? null;
    const ownsCodec = options.codec == null;
    const ownsTopology = options.topology == null;
    let codec = options.codec ?? null;
    let topology = options.topology ?? null;
    let coordinator = null;
    try {
        codec ??= restoreAdaptiveMatterPacketCodec(snapshot.codec, { logger });
        const topologySnapshot = snapshot.transcoder?.topology;
        if (!isPlainJsonObject(topologySnapshot)) {
            fail('$.matterPhaseRuntimeSnapshot.transcoder.topology', 'is required');
        }
        const eventLogger = logger && typeof logger.debug === 'function'
            ? event => logger.debug('[MatterPhaseRuntime] topology', event)
            : null;
        topology ??= new StructuralTopology({
            topologyId: topologySnapshot.topologyId,
            deviceGeneration: topologySnapshot.deviceGeneration,
            maximumNodes: Math.max(1, topologySnapshot.nodes?.length ?? 0),
            maximumBonds: Math.max(1, topologySnapshot.bonds?.length ?? 0),
            logger: eventLogger,
        });
        const fluid = snapshot.fluid;
        coordinator = new MatterPhaseRuntimeCoordinator({
            regionId: snapshot.regionId,
            codec,
            topology,
            profiles: snapshot.phaseProfiles,
            fluidPhaseIds: snapshot.fluidPhaseIds,
            fluidMetadata: snapshot.fluidMetadata,
            maximumJournalEntries: snapshot.maximumJournalEntries,
            destroyCodecOnDestroy: ownsCodec,
            destroyTopologyOnDestroy: ownsTopology,
            fluidOptions: {
                mode: fluid.mode,
                qualityProfile: fluid.qualityProfile,
                kernelProfile: fluid.kernelProfile,
                grid: {
                    cellSizeM: fluid.grid.cellSizeM,
                    brickSize: fluid.grid.brickSize,
                    maxBricks: fluid.grid.maxBricks,
                },
                surface: {
                    maxTiles: fluid.surfaceCache.maxTiles,
                    maxVoxelsPerTile: fluid.surfaceCache.maxVoxelsPerTile,
                },
            },
            logger,
        });
        return coordinator.restore(snapshot);
    } catch (error) {
        if (coordinator) coordinator.destroy();
        else {
            if (ownsCodec) codec?.destroy?.();
            if (ownsTopology) topology?.destroy?.();
        }
        throw error;
    }
}
