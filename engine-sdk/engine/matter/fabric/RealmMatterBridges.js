// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Identity-preserving contracts at the packet-codec and Realm Forge boundaries. */

import { cloneStrictJson } from '../../core/schema/StrictJsonValue.js';
import { validateMatterPacketProjection } from '../codec/MatterPacketContracts.js';
import {
    FabricDiagnostics,
    compareOrdinal,
    contentHash,
    fail,
    freeze,
    requireExactKeys,
    requireFinite,
    requireHash,
    requireIdentifier,
    requireIdentifierArray,
    requireInteger,
    requireRecord,
} from './FabricSupport.js';
import { validateRealmMatterState } from './RealmMatterContracts.js';

export const REALM_PACKET_BRIDGE_SCHEMA = 'engine.matter.fabric.packet-bridge';
export const REALM_PACKET_BRIDGE_VERSION = '1.0.0';
export const REALM_FORGE_BRIDGE_SCHEMA = 'engine.matter.fabric.forge-bridge';
export const REALM_FORGE_BRIDGE_VERSION = '1.0.0';
export const REALM_PACKET_RUNTIME_PROJECTION_SCHEMA = 'engine.matter.fabric.packet-runtime-projection';
export const REALM_PACKET_RUNTIME_PROJECTION_VERSION = '1.1.0';
export const REALM_PACKET_RUNTIME_SNAPSHOT_SCHEMA = 'engine.matter.fabric.packet-runtime-snapshot';
export const REALM_PACKET_RUNTIME_SNAPSHOT_VERSION = '1.1.0';

const PACKET_INPUT_KEYS = new Set(['state', 'ledgerId', 'packetRegionId', 'packetLineageRootId']);
const PACKET_KEYS = new Set([
    'schema', 'schemaVersion', 'instanceId', 'soulSeedId', 'definitionId', 'stateRevision',
    'stateHash', 'ledgerId', 'compositionProfileId', 'phaseProfileId', 'microstructureProfileId',
    'packetRegionId', 'packetLineageRootId',
]);
const FORGE_INPUT_KEYS = new Set([
    'state', 'forgeObjectId', 'ledgerId', 'stockFormId', 'allowedTransformationIds',
]);
const FORGE_KEYS = new Set([
    'schema', 'schemaVersion', 'forgeObjectId', 'instanceId', 'soulSeedId', 'definitionId',
    'stateRevision', 'stateHash', 'ledgerId', 'stockFormId', 'compositionProfileId',
    'phaseProfileId', 'microstructureProfileId', 'historyProfileId', 'geometryProfileId',
    'allowedTransformationIds',
]);
const RUNTIME_BIND_KEYS = new Set([
    'state', 'ledgerId', 'packetRegionId', 'packetLineageRootId', 'reactionProgress',
]);
const RUNTIME_SNAPSHOT_KEYS = new Set(['schema', 'schemaVersion', 'bindings', 'snapshotHash']);
const RUNTIME_SNAPSHOT_BINDING_KEYS = new Set(['input', 'projectionHash']);
const RUNTIME_OPTION_KEYS = new Set([
    'absoluteTolerance', 'relativeTolerance', 'maximumBindings',
    'maximumCodecPackets', 'maximumPacketsPerBinding', 'maximumHistoryEvents', 'logger',
]);

const DEFAULT_MAXIMUM_BINDINGS = 4096;
const DEFAULT_MAXIMUM_CODEC_PACKETS = 1048576;
const DEFAULT_MAXIMUM_PACKETS_PER_BINDING = 65536;
const DEFAULT_MAXIMUM_HISTORY_EVENTS = 4096;
const HARD_MAXIMUM_BINDINGS = 65536;
const HARD_MAXIMUM_CODEC_PACKETS = 16777216;
const HARD_MAXIMUM_PACKETS_PER_BINDING = 1048576;
const HARD_MAXIMUM_HISTORY_EVENTS = 1048576;

function within(left, right, absoluteTolerance, relativeTolerance) {
    return Math.abs(left - right) <= absoluteTolerance
        + relativeTolerance * Math.max(1, Math.abs(left), Math.abs(right));
}

function validateReactionProgress(value, path) {
    requireRecord(value, path);
    const output = {};
    const entries = Object.entries(value);
    if (entries.length > 256) fail(path, 'must contain at most 256 transformations');
    entries.sort(([left], [right]) => compareOrdinal(left, right)).forEach(([id, fraction]) => {
        requireIdentifier(id, `${path} key`);
        requireFinite(fraction, `${path}.${id}`, { minimum: 0, maximum: 1 });
        output[id] = fraction;
    });
    return output;
}

function assertReactionProgressMonotonic(previous, next, path = '$.reactionProgress') {
    for (const [transformationId, fraction] of Object.entries(previous)) {
        if (!Object.hasOwn(next, transformationId)) {
            fail(path, `cannot remove active transformation '${transformationId}'`);
        }
        if (next[transformationId] < fraction) {
            fail(`${path}.${transformationId}`, 'cannot regress');
        }
    }
}

function compensatedSum(values) {
    let sum = 0;
    let compensation = 0;
    for (const value of values) {
        const corrected = value - compensation;
        const next = sum + corrected;
        compensation = (next - sum) - corrected;
        sum = next;
    }
    return sum;
}

function validateRuntimeOptions(options) {
    requireRecord(options, '$.options');
    const result = {};
    for (const key of Reflect.ownKeys(options)) {
        if (typeof key !== 'string' || !RUNTIME_OPTION_KEYS.has(key)) {
            fail(`$.options.${String(key)}`, 'unknown field');
        }
        const descriptor = Object.getOwnPropertyDescriptor(options, key);
        if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
            fail(`$.options.${key}`, 'must be an enumerable data property');
        }
        result[key] = descriptor.value;
    }
    result.absoluteTolerance = requireFinite(
        result.absoluteTolerance ?? 1e-9,
        '$.options.absoluteTolerance',
        { minimum: 0 },
    );
    result.relativeTolerance = requireFinite(
        result.relativeTolerance ?? 1e-9,
        '$.options.relativeTolerance',
        { minimum: 0 },
    );
    result.maximumBindings = requireInteger(
        result.maximumBindings ?? DEFAULT_MAXIMUM_BINDINGS,
        '$.options.maximumBindings',
        { minimum: 1, maximum: HARD_MAXIMUM_BINDINGS },
    );
    result.maximumCodecPackets = requireInteger(
        result.maximumCodecPackets ?? DEFAULT_MAXIMUM_CODEC_PACKETS,
        '$.options.maximumCodecPackets',
        { minimum: 1, maximum: HARD_MAXIMUM_CODEC_PACKETS },
    );
    result.maximumPacketsPerBinding = requireInteger(
        result.maximumPacketsPerBinding ?? DEFAULT_MAXIMUM_PACKETS_PER_BINDING,
        '$.options.maximumPacketsPerBinding',
        { minimum: 1, maximum: HARD_MAXIMUM_PACKETS_PER_BINDING },
    );
    result.maximumHistoryEvents = requireInteger(
        result.maximumHistoryEvents ?? DEFAULT_MAXIMUM_HISTORY_EVENTS,
        '$.options.maximumHistoryEvents',
        { minimum: 1, maximum: HARD_MAXIMUM_HISTORY_EVENTS },
    );
    if (result.logger !== undefined && result.logger !== null
        && (typeof result.logger !== 'object' && typeof result.logger !== 'function')) {
        fail('$.options.logger', 'must be an object, function, or null');
    }
    result.logger ??= null;
    return result;
}

function validateRuntimeBindingInput(input, path = '$.packetRuntimeBinding') {
    const candidate = cloneStrictJson(input, path);
    candidate.reactionProgress ??= {};
    requireExactKeys(candidate, RUNTIME_BIND_KEYS, RUNTIME_BIND_KEYS, path);
    validateRealmMatterState(candidate.state, `${path}.state`);
    requireIdentifier(candidate.ledgerId, `${path}.ledgerId`);
    requireIdentifier(candidate.packetRegionId, `${path}.packetRegionId`);
    requireIdentifier(candidate.packetLineageRootId, `${path}.packetLineageRootId`);
    candidate.reactionProgress = validateReactionProgress(candidate.reactionProgress, `${path}.reactionProgress`);
    return candidate;
}

function sameJson(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
}

function runtimeBridgeError(message, receipt = null) {
    const error = new Error(message);
    error.name = 'RealmMatterRuntimeBridgeError';
    if (receipt !== null) error.receipt = receipt;
    return error;
}

function requiredProfile(id, path) {
    if (id === null) fail(path, 'is required by this bridge');
    return requireIdentifier(id, path);
}

export function createRealmPacketBridgeContract(input) {
    const candidate = cloneStrictJson(input, '$.packetBridgeInput');
    requireExactKeys(candidate, PACKET_INPUT_KEYS, PACKET_INPUT_KEYS, '$.packetBridgeInput');
    validateRealmMatterState(candidate.state, '$.packetBridgeInput.state');
    requireIdentifier(candidate.ledgerId, '$.packetBridgeInput.ledgerId');
    requireIdentifier(candidate.packetRegionId, '$.packetBridgeInput.packetRegionId');
    requireIdentifier(candidate.packetLineageRootId, '$.packetBridgeInput.packetLineageRootId');
    return freeze({
        schema: REALM_PACKET_BRIDGE_SCHEMA,
        schemaVersion: REALM_PACKET_BRIDGE_VERSION,
        instanceId: candidate.state.instanceId,
        soulSeedId: candidate.state.soulSeedId,
        definitionId: candidate.state.definitionId,
        stateRevision: candidate.state.revision,
        stateHash: contentHash(candidate.state, '$.packetBridgeInput.state'),
        ledgerId: candidate.ledgerId,
        compositionProfileId: requiredProfile(candidate.state.profileRefs.composition,
            '$.packetBridgeInput.state.profileRefs.composition'),
        phaseProfileId: requiredProfile(candidate.state.profileRefs.phase,
            '$.packetBridgeInput.state.profileRefs.phase'),
        microstructureProfileId: candidate.state.profileRefs.microstructure,
        packetRegionId: candidate.packetRegionId,
        packetLineageRootId: candidate.packetLineageRootId,
    }, '$.packetBridge');
}

export function validateRealmPacketBridgeContract(value, path = '$.packetBridge') {
    const candidate = cloneStrictJson(value, path);
    requireExactKeys(candidate, PACKET_KEYS, PACKET_KEYS, String(path));
    if (candidate.schema !== REALM_PACKET_BRIDGE_SCHEMA) fail(`${path}.schema`, 'is unsupported');
    if (candidate.schemaVersion !== REALM_PACKET_BRIDGE_VERSION) fail(`${path}.schemaVersion`, 'is unsupported');
    for (const field of ['instanceId', 'soulSeedId', 'definitionId', 'ledgerId', 'compositionProfileId',
        'phaseProfileId', 'packetRegionId', 'packetLineageRootId']) requireIdentifier(candidate[field], `${path}.${field}`);
    if (candidate.microstructureProfileId !== null) requireIdentifier(candidate.microstructureProfileId,
        `${path}.microstructureProfileId`);
    requireInteger(candidate.stateRevision, `${path}.stateRevision`);
    requireHash(candidate.stateHash, `${path}.stateHash`);
    return true;
}

export function assertRealmPacketBridgeBinding(contract, packetProjection) {
    validateRealmPacketBridgeContract(contract);
    validateMatterPacketProjection(packetProjection);
    const checks = {
        definitionId: packetProjection.definitionId === contract.definitionId,
        regionId: packetProjection.regionId === contract.packetRegionId,
        lineageRootId: packetProjection.lineage.rootId === contract.packetLineageRootId,
        sourceRevision: packetProjection.sourceRevision === contract.stateRevision,
    };
    const receipt = freeze({ contractSchema: contract.schema, packetSchema: packetProjection.schema, checks,
        valid: Object.values(checks).every(Boolean) }, '$.packetBridgeReceipt');
    if (!receipt.valid) {
        const error = new Error('Matter packet projection does not match its Fabric bridge contract');
        error.name = 'RealmMatterBridgeError';
        error.receipt = receipt;
        throw error;
    }
    return receipt;
}

export function createRealmForgeBridgeContract(input) {
    const candidate = cloneStrictJson(input, '$.forgeBridgeInput');
    requireExactKeys(candidate, FORGE_INPUT_KEYS, FORGE_INPUT_KEYS, '$.forgeBridgeInput');
    validateRealmMatterState(candidate.state, '$.forgeBridgeInput.state');
    requireIdentifier(candidate.forgeObjectId, '$.forgeBridgeInput.forgeObjectId');
    requireIdentifier(candidate.ledgerId, '$.forgeBridgeInput.ledgerId');
    requireIdentifier(candidate.stockFormId, '$.forgeBridgeInput.stockFormId');
    requireIdentifierArray(candidate.allowedTransformationIds, '$.forgeBridgeInput.allowedTransformationIds');
    return freeze({
        schema: REALM_FORGE_BRIDGE_SCHEMA,
        schemaVersion: REALM_FORGE_BRIDGE_VERSION,
        forgeObjectId: candidate.forgeObjectId,
        instanceId: candidate.state.instanceId,
        soulSeedId: candidate.state.soulSeedId,
        definitionId: candidate.state.definitionId,
        stateRevision: candidate.state.revision,
        stateHash: contentHash(candidate.state, '$.forgeBridgeInput.state'),
        ledgerId: candidate.ledgerId,
        stockFormId: candidate.stockFormId,
        compositionProfileId: requiredProfile(candidate.state.profileRefs.composition,
            '$.forgeBridgeInput.state.profileRefs.composition'),
        phaseProfileId: candidate.state.profileRefs.phase,
        microstructureProfileId: candidate.state.profileRefs.microstructure,
        historyProfileId: candidate.state.profileRefs.history,
        geometryProfileId: requiredProfile(candidate.state.profileRefs.geometry,
            '$.forgeBridgeInput.state.profileRefs.geometry'),
        allowedTransformationIds: candidate.allowedTransformationIds,
    }, '$.forgeBridge');
}

export function validateRealmForgeBridgeContract(value, path = '$.forgeBridge') {
    const candidate = cloneStrictJson(value, path);
    requireExactKeys(candidate, FORGE_KEYS, FORGE_KEYS, String(path));
    if (candidate.schema !== REALM_FORGE_BRIDGE_SCHEMA) fail(`${path}.schema`, 'is unsupported');
    if (candidate.schemaVersion !== REALM_FORGE_BRIDGE_VERSION) fail(`${path}.schemaVersion`, 'is unsupported');
    for (const field of ['forgeObjectId', 'instanceId', 'soulSeedId', 'definitionId', 'ledgerId', 'stockFormId',
        'compositionProfileId', 'geometryProfileId']) requireIdentifier(candidate[field], `${path}.${field}`);
    for (const field of ['phaseProfileId', 'microstructureProfileId', 'historyProfileId']) {
        if (candidate[field] !== null) requireIdentifier(candidate[field], `${path}.${field}`);
    }
    requireInteger(candidate.stateRevision, `${path}.stateRevision`);
    requireHash(candidate.stateHash, `${path}.stateHash`);
    requireIdentifierArray(candidate.allowedTransformationIds, `${path}.allowedTransformationIds`);
    return true;
}

/**
 * Live, sparse Fabric state attached to codec lineages without inflating the
 * mandatory packet record. The codec remains physical-state authority; this
 * bridge verifies that every current representation still names the same
 * region, root lineage, definition, and source revision.
 */
export class RealmPacketRuntimeBridge {
    #codec;
    #registry;
    #absoluteTolerance;
    #relativeTolerance;
    #maximumBindings;
    #maximumCodecPackets;
    #maximumPacketsPerBinding;
    #maximumHistoryEvents;
    #bindings = new Map();
    #diagnostics;
    #destroyed = false;

    constructor(codec, registry, options = {}) {
        if (!codec || typeof codec.listPackets !== 'function' || typeof codec.stats !== 'function') {
            throw new TypeError('$.codec: must expose listPackets() and stats()');
        }
        const registryMethods = [
            'getDefinition', 'getCompositionProfile', 'getPhaseProfile',
            'getMicrostructureProfile', 'getHistoryProfile', 'getGeometryProfile',
            'getTransformation', 'listDefinitions',
        ];
        if (!registry || registryMethods.some(method => typeof registry[method] !== 'function')) {
            throw new TypeError('$.registry: must be a RealmMatterRegistry-compatible object');
        }
        const runtimeOptions = validateRuntimeOptions(options);
        this.#absoluteTolerance = runtimeOptions.absoluteTolerance;
        this.#relativeTolerance = runtimeOptions.relativeTolerance;
        this.#maximumBindings = runtimeOptions.maximumBindings;
        this.#maximumCodecPackets = runtimeOptions.maximumCodecPackets;
        this.#maximumPacketsPerBinding = runtimeOptions.maximumPacketsPerBinding;
        this.#maximumHistoryEvents = runtimeOptions.maximumHistoryEvents;
        this.#codec = codec;
        this.#registry = registry;
        this.#diagnostics = new FabricDiagnostics('matter.fabric.packet-runtime', runtimeOptions.logger);
    }

    #assertAlive() {
        if (this.#destroyed) throw new Error('RealmPacketRuntimeBridge is destroyed');
    }

    #project(input) {
        const contract = createRealmPacketBridgeContract({
            state: input.state,
            ledgerId: input.ledgerId,
            packetRegionId: input.packetRegionId,
            packetLineageRootId: input.packetLineageRootId,
        });
        const definition = this.#registry.getDefinition(contract.definitionId);
        if (!definition) fail('$.packetRuntimeBinding.state.definitionId', 'is absent from the registry');
        const composition = this.#registry.getCompositionProfile(contract.compositionProfileId);
        if (!composition) fail('$.packetRuntimeBinding.state.profileRefs.composition', 'is absent from the registry');
        if (definition.profileRefs.composition !== composition.id) {
            fail('$.packetRuntimeBinding.state.profileRefs.composition',
                'does not match the definition canonical composition');
        }
        const phase = this.#registry.getPhaseProfile(contract.phaseProfileId);
        if (!phase) fail('$.packetRuntimeBinding.state.profileRefs.phase', 'is absent from the registry');
        const phaseBelongsToCompositionFamily = this.#registry.listDefinitions().some(candidate => (
            candidate.profileRefs.composition === composition.id
            && candidate.profileRefs.phase === phase.id
        ));
        if (!phaseBelongsToCompositionFamily) {
            fail('$.packetRuntimeBinding.state.profileRefs.phase',
                `is not declared by the '${composition.id}' definition family`);
        }
        const { temperatureK, pressurePa } = input.state.environment;
        if (temperatureK < phase.temperatureRangeK.minimum || temperatureK > phase.temperatureRangeK.maximum) {
            fail('$.packetRuntimeBinding.state.environment.temperatureK',
                `is outside phase profile '${phase.id}'`);
        }
        if (pressurePa < phase.pressureRangePa.minimum || pressurePa > phase.pressureRangePa.maximum) {
            fail('$.packetRuntimeBinding.state.environment.pressurePa',
                `is outside phase profile '${phase.id}'`);
        }
        const profiles = {};
        for (const [field, getter] of [
            ['microstructure', 'getMicrostructureProfile'],
            ['history', 'getHistoryProfile'],
            ['geometry', 'getGeometryProfile'],
        ]) {
            const profileId = input.state.profileRefs[field];
            profiles[field] = profileId === null ? null : this.#registry[getter](profileId);
            if (profileId !== null && !profiles[field]) {
                fail(`$.packetRuntimeBinding.state.profileRefs.${field}`, 'is absent from the registry');
            }
        }
        if (profiles.microstructure !== null && !profiles.microstructure.phaseIds.includes(phase.id)) {
            fail('$.packetRuntimeBinding.state.profileRefs.microstructure',
                `is incompatible with phase profile '${phase.id}'`);
        }
        if (input.state.historyEventIds.length > this.#maximumHistoryEvents) {
            fail('$.packetRuntimeBinding.state.historyEventIds',
                `must contain at most ${this.#maximumHistoryEvents} entries`);
        }
        for (const transformationId of Object.keys(input.reactionProgress)) {
            const transformation = this.#registry.getTransformation(transformationId);
            if (!transformation) {
                fail(`$.packetRuntimeBinding.reactionProgress.${transformationId}`,
                    'references an absent transformation');
            }
            const materialFlows = [
                ...transformation.inputs,
                ...transformation.outputs,
                ...transformation.byproducts,
            ];
            const belongsToCompositionFamily = materialFlows.some(flow => (
                this.#registry.getDefinition(flow.definitionId)?.profileRefs.composition === composition.id
            ));
            if (!belongsToCompositionFamily) {
                fail(`$.packetRuntimeBinding.reactionProgress.${transformationId}`,
                    `is unrelated to the '${composition.id}' definition family`);
            }
        }
        const codecStats = cloneStrictJson(this.#codec.stats(), '$.codecStats');
        requireRecord(codecStats, '$.codecStats');
        const activeCodecPackets = requireInteger(codecStats.activePackets, '$.codecStats.activePackets');
        if (activeCodecPackets > this.#maximumCodecPackets) {
            throw runtimeBridgeError(
                `Codec exceeds the ${this.#maximumCodecPackets} packet bridge scan limit`,
            );
        }
        const listedPackets = this.#codec.listPackets();
        if (!Array.isArray(listedPackets)) {
            throw runtimeBridgeError('Codec listPackets() must return an array');
        }
        if (listedPackets.length !== activeCodecPackets) {
            throw runtimeBridgeError('Codec stats and listPackets() disagree about active packet count');
        }
        listedPackets.forEach((packet, index) => (
            validateMatterPacketProjection(packet, `$.codecPackets[${index}]`)
        ));
        const packets = listedPackets
            .filter(packet => packet.regionId === contract.packetRegionId)
            .sort((left, right) => compareOrdinal(left.lineage.id, right.lineage.id));
        if (packets.length === 0) {
            throw runtimeBridgeError(`No active codec packets exist for region '${contract.packetRegionId}'`);
        }
        if (packets.length > this.#maximumPacketsPerBinding) {
            throw runtimeBridgeError(
                `Region '${contract.packetRegionId}' exceeds the ${this.#maximumPacketsPerBinding} packet bridge limit`,
            );
        }
        const packetReceipts = packets.map(packet => assertRealmPacketBridgeBinding(contract, packet));
        const lineageIds = new Set();
        const handles = new Set();
        for (const packet of packets) {
            const handleKey = `${packet.handle.pageId}:${packet.handle.slot}:${packet.handle.generation}`;
            if (lineageIds.has(packet.lineage.id)) {
                throw runtimeBridgeError(`Codec region '${contract.packetRegionId}' contains duplicate lineage IDs`);
            }
            if (handles.has(handleKey)) {
                throw runtimeBridgeError(`Codec region '${contract.packetRegionId}' contains duplicate handles`);
            }
            lineageIds.add(packet.lineage.id);
            handles.add(handleKey);
        }
        const totals = {
            massKg: compensatedSum(packets.map(packet => packet.massKg)),
            representedVolumeM3: compensatedSum(packets.map(packet => packet.representedVolumeM3)),
        };
        const codecDamageFraction = compensatedSum(
            packets.map(packet => packet.massKg * packet.damageState.fraction),
        ) / totals.massKg;
        const checks = {
            packetBindings: packetReceipts.every(receipt => receipt.valid),
            mass: within(totals.massKg, input.state.quantity.massKg,
                this.#absoluteTolerance, this.#relativeTolerance),
            representedVolume: within(totals.representedVolumeM3, input.state.quantity.volumeM3,
                this.#absoluteTolerance, this.#relativeTolerance),
            damage: within(codecDamageFraction, input.state.environment.damageFraction,
                this.#absoluteTolerance, this.#relativeTolerance),
        };
        const projection = freeze({
            schema: REALM_PACKET_RUNTIME_PROJECTION_SCHEMA,
            schemaVersion: REALM_PACKET_RUNTIME_PROJECTION_VERSION,
            contract,
            authority: {
                physicalPacketState: 'adaptive-matter-packet-codec',
                sparseMaterialState: 'realm-matter-fabric',
                charge: 'realm-matter-fabric',
            },
            sparseChannels: {
                composition: {
                    profileId: composition.id,
                    basis: composition.basis,
                    constituents: composition.constituents,
                },
                phase: {
                    profileId: phase.id,
                    fractions: phase.phaseFractions,
                },
                environment: input.state.environment,
                microstructureProfileId: input.state.profileRefs.microstructure,
                historyProfileId: input.state.profileRefs.history,
                geometryProfileId: input.state.profileRefs.geometry,
                historyEventIds: input.state.historyEventIds,
                reactionProgress: input.reactionProgress,
                charge: {
                    coulombs: input.state.quantity.chargeC,
                    codecStored: false,
                },
                codecDamageFraction,
            },
            packets: packets.map(packet => ({
                lineageId: packet.lineage.id,
                handle: packet.handle,
                phase: packet.phase,
                damageState: packet.damageState,
                sourceRevision: packet.sourceRevision,
                representationRevision: packet.representationRevision,
                massKg: packet.massKg,
                representedVolumeM3: packet.representedVolumeM3,
            })),
            totals,
            checks,
            valid: Object.values(checks).every(Boolean),
        }, '$.packetRuntimeProjection');
        if (!projection.valid) {
            throw runtimeBridgeError('Fabric state does not match its codec-owned packet region', projection);
        }
        return projection;
    }

    bind(input) {
        this.#assertAlive();
        const token = this.#diagnostics.begin('packet-runtime.bind');
        try {
            const candidate = validateRuntimeBindingInput(input);
            if (this.#bindings.has(candidate.packetRegionId)) {
                fail('$.packetRuntimeBinding.packetRegionId', 'is already bound');
            }
            if (this.#bindings.size >= this.#maximumBindings) {
                fail('$.packetRuntimeBinding.packetRegionId',
                    `would exceed the ${this.#maximumBindings} binding limit`);
            }
            const projection = this.#project(candidate);
            this.#bindings.set(candidate.packetRegionId, { input: freeze(candidate), projection });
            this.#diagnostics.end(token, {
                regionId: candidate.packetRegionId,
                packetCount: projection.packets.length,
            }, { stateChanged: true });
            return projection;
        } catch (error) {
            this.#diagnostics.error(token, error);
            throw error;
        }
    }

    refresh(input) {
        this.#assertAlive();
        const token = this.#diagnostics.begin('packet-runtime.refresh');
        try {
            const candidate = validateRuntimeBindingInput(input);
            const current = this.#bindings.get(candidate.packetRegionId);
            if (!current) fail('$.packetRuntimeBinding.packetRegionId', 'is not bound');
            const nextContract = createRealmPacketBridgeContract({
                state: candidate.state,
                ledgerId: candidate.ledgerId,
                packetRegionId: candidate.packetRegionId,
                packetLineageRootId: candidate.packetLineageRootId,
            });
            const previous = current.projection.contract;
            for (const field of [
                'instanceId', 'soulSeedId', 'definitionId', 'ledgerId',
                'packetRegionId', 'packetLineageRootId',
            ]) {
                if (nextContract[field] !== previous[field]) {
                    fail(`$.packetRuntimeBinding.${field}`, 'cannot change a live bridge identity');
                }
            }
            if (nextContract.stateRevision !== previous.stateRevision + 1) {
                fail('$.packetRuntimeBinding.state.revision', 'must advance exactly once');
            }
            if (!sameJson(candidate.state.parentInstanceIds, current.input.state.parentInstanceIds)) {
                fail('$.packetRuntimeBinding.state.parentInstanceIds', 'cannot change a live bridge ancestry');
            }
            const priorHistory = current.input.state.historyEventIds;
            const nextHistory = candidate.state.historyEventIds;
            if (nextHistory.length < priorHistory.length
                || priorHistory.some((eventId, index) => nextHistory[index] !== eventId)) {
                fail('$.packetRuntimeBinding.state.historyEventIds', 'cannot remove or rewrite existing history');
            }
            assertReactionProgressMonotonic(current.input.reactionProgress, candidate.reactionProgress);
            const projection = this.#project(candidate);
            this.#bindings.set(candidate.packetRegionId, { input: freeze(candidate), projection });
            this.#diagnostics.end(token, {
                regionId: candidate.packetRegionId,
                stateRevision: nextContract.stateRevision,
            }, { stateChanged: true });
            return projection;
        } catch (error) {
            this.#diagnostics.error(token, error);
            throw error;
        }
    }

    reconcile(regionIdInput) {
        this.#assertAlive();
        const token = this.#diagnostics.begin('packet-runtime.reconcile');
        try {
            const regionId = requireIdentifier(regionIdInput, '$.regionId');
            const current = this.#bindings.get(regionId);
            if (!current) fail('$.regionId', 'is not bound');
            const projection = this.#project(current.input);
            this.#bindings.set(regionId, { input: current.input, projection });
            this.#diagnostics.end(token, {
                regionId,
                packetCount: projection.packets.length,
            }, { stateChanged: true });
            return projection;
        } catch (error) {
            this.#diagnostics.error(token, error);
            throw error;
        }
    }

    updateReactionProgress(regionIdInput, expectedStateRevisionInput, reactionProgressInput) {
        this.#assertAlive();
        const token = this.#diagnostics.begin('packet-runtime.reaction-progress');
        try {
            const regionId = requireIdentifier(regionIdInput, '$.regionId');
            const expectedStateRevision = requireInteger(expectedStateRevisionInput, '$.expectedStateRevision');
            const current = this.#bindings.get(regionId);
            if (!current) fail('$.regionId', 'is not bound');
            if (current.projection.contract.stateRevision !== expectedStateRevision) {
                fail('$.expectedStateRevision', 'is stale');
            }
            const reactionProgress = validateReactionProgress(
                cloneStrictJson(reactionProgressInput, '$.reactionProgress'),
                '$.reactionProgress',
            );
            assertReactionProgressMonotonic(current.input.reactionProgress, reactionProgress);
            const nextInput = validateRuntimeBindingInput({ ...current.input, reactionProgress });
            const projection = this.#project(nextInput);
            this.#bindings.set(regionId, { input: freeze(nextInput), projection });
            this.#diagnostics.end(token, { regionId, reactionCount: Object.keys(reactionProgress).length }, {
                stateChanged: true,
            });
            return projection;
        } catch (error) {
            this.#diagnostics.error(token, error);
            throw error;
        }
    }

    get(regionIdInput) {
        this.#assertAlive();
        const regionId = requireIdentifier(regionIdInput, '$.regionId');
        return this.#bindings.get(regionId)?.projection ?? null;
    }

    release(regionIdInput) {
        this.#assertAlive();
        const regionId = requireIdentifier(regionIdInput, '$.regionId');
        const removed = this.#bindings.delete(regionId);
        if (removed) {
            const token = this.#diagnostics.begin('packet-runtime.release', { regionId });
            this.#diagnostics.end(token, { regionId }, { stateChanged: true });
        }
        return removed;
    }

    snapshot() {
        this.#assertAlive();
        const synchronized = new Map();
        const bindings = [...this.#bindings.entries()]
            .sort(([left], [right]) => compareOrdinal(left, right))
            .map(([regionId, record]) => {
                const projection = this.#project(record.input);
                synchronized.set(regionId, { input: record.input, projection });
                return {
                    input: record.input,
                    projectionHash: contentHash(projection, '$.packetRuntimeProjection'),
                };
            });
        const payload = {
            schema: REALM_PACKET_RUNTIME_SNAPSHOT_SCHEMA,
            schemaVersion: REALM_PACKET_RUNTIME_SNAPSHOT_VERSION,
            bindings,
        };
        const snapshot = freeze({
            ...payload,
            snapshotHash: contentHash(payload, '$.packetRuntimeSnapshot.payload'),
        }, '$.packetRuntimeSnapshot');
        this.#bindings = synchronized;
        return snapshot;
    }

    restore(snapshotInput) {
        this.#assertAlive();
        const token = this.#diagnostics.begin('packet-runtime.restore');
        try {
            const snapshot = cloneStrictJson(snapshotInput, '$.packetRuntimeSnapshot');
            requireExactKeys(snapshot, RUNTIME_SNAPSHOT_KEYS, RUNTIME_SNAPSHOT_KEYS, '$.packetRuntimeSnapshot');
            if (snapshot.schema !== REALM_PACKET_RUNTIME_SNAPSHOT_SCHEMA) {
                fail('$.packetRuntimeSnapshot.schema', 'is unsupported');
            }
            if (snapshot.schemaVersion !== REALM_PACKET_RUNTIME_SNAPSHOT_VERSION) {
                fail('$.packetRuntimeSnapshot.schemaVersion', 'is unsupported');
            }
            if (!Array.isArray(snapshot.bindings)) fail('$.packetRuntimeSnapshot.bindings', 'must be an array');
            if (snapshot.bindings.length > this.#maximumBindings) {
                fail('$.packetRuntimeSnapshot.bindings',
                    `must contain at most ${this.#maximumBindings} entries`);
            }
            requireHash(snapshot.snapshotHash, '$.packetRuntimeSnapshot.snapshotHash');
            const expectedSnapshotHash = contentHash({
                schema: snapshot.schema,
                schemaVersion: snapshot.schemaVersion,
                bindings: snapshot.bindings,
            }, '$.packetRuntimeSnapshot.payload');
            if (snapshot.snapshotHash !== expectedSnapshotHash) {
                fail('$.packetRuntimeSnapshot.snapshotHash', 'does not match the snapshot payload');
            }
            const next = new Map();
            let previousRegionId = null;
            snapshot.bindings.forEach((entry, index) => {
                const path = `$.packetRuntimeSnapshot.bindings[${index}]`;
                requireExactKeys(entry, RUNTIME_SNAPSHOT_BINDING_KEYS, RUNTIME_SNAPSHOT_BINDING_KEYS, path);
                requireHash(entry.projectionHash, `${path}.projectionHash`);
                const input = validateRuntimeBindingInput(entry.input, `${path}.input`);
                if (next.has(input.packetRegionId)) fail(`${path}.input.packetRegionId`, 'duplicates an earlier binding');
                if (previousRegionId !== null && compareOrdinal(previousRegionId, input.packetRegionId) >= 0) {
                    fail(`${path}.input.packetRegionId`, 'must be strictly sorted');
                }
                const projection = this.#project(input);
                if (contentHash(projection, `${path}.projection`) !== entry.projectionHash) {
                    fail(`${path}.projectionHash`, 'does not match the live codec projection');
                }
                next.set(input.packetRegionId, { input: freeze(input), projection });
                previousRegionId = input.packetRegionId;
            });
            this.#bindings = next;
            this.#diagnostics.end(token, { bindings: next.size }, { stateChanged: true });
            return this.snapshot();
        } catch (error) {
            this.#diagnostics.error(token, error);
            throw error;
        }
    }

    diagnostics() {
        return this.#diagnostics.snapshot();
    }

    destroy() {
        if (this.#destroyed) return;
        this.#bindings.clear();
        this.#destroyed = true;
    }
}

export function createRealmPacketRuntimeBridge(codec, registry, options = {}) {
    return new RealmPacketRuntimeBridge(codec, registry, options);
}

export function restoreRealmPacketRuntimeBridge(snapshot, codec, registry, options = {}) {
    const bridge = new RealmPacketRuntimeBridge(codec, registry, options);
    try {
        bridge.restore(snapshot);
        return bridge;
    } catch (error) {
        bridge.destroy();
        throw error;
    }
}
