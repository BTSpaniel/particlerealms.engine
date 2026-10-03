// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Optional registration helper for the existing Matter backend adapter registry. */

import {
    MATTER_FIDELITY_LEVELS,
} from '../contracts/MatterContracts.js';
import {
    MATTER_BACKEND_ADAPTER_SCHEMA,
    MATTER_BACKEND_ADAPTER_VERSION,
} from '../adapters/MatterBackendAdapterRegistry.js';
import {
    cloneStrictJson,
    deepFreezeJson,
    isPlainJsonObject,
} from '../../core/schema/StrictJsonValue.js';
import {
    AdaptiveMatterPacketCodec,
    summarizeMatterPackets,
} from './AdaptiveMatterPacketCodec.js';
import {
    validateMatterPacketHandle,
    validateMatterPacketProjection,
} from './MatterPacketContracts.js';

export const MATTER_PACKET_BACKEND_ID = 'backend.adaptive-matter-packet-codec';
export const MATTER_PACKET_BACKEND_PROJECTION_SCHEMA = 'engine.matter.packet-backend-projection';
export const MATTER_PACKET_BACKEND_PROJECTION_VERSION = '2.0.0';

const REGISTRATION_OPTION_KEYS = new Set([
    'id', 'version', 'representation', 'fidelityLevels', 'solverAuthority',
]);
const PACKET_CONTEXT_KEYS = new Set([
    'lineageId', 'phase', 'componentId', 'damageState', 'positionM',
    'representedVolumeM3', 'angularMomentumKgM2PerS', 'thermalEnergyJ',
    'elasticEnergyJ', 'subgridEnergyJ',
]);
const BACKEND_PROJECTION_KEYS = new Set([
    'schema', 'schemaVersion', 'backendId', 'backendVersion', 'handle', 'packet',
]);
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,191}$/;

function fail(path, message) {
    throw new TypeError(`${path}: ${message}`);
}

function exactObject(value, keys, path) {
    if (!isPlainJsonObject(value)) fail(path, 'must be a plain object');
    for (const key of Object.keys(value)) {
        if (!keys.has(key)) fail(`${path}.${key}`, 'unknown field');
    }
    return value;
}

function identifier(value, path) {
    if (typeof value !== 'string' || !IDENTIFIER.test(value)) fail(path, 'has invalid identifier syntax');
    return value;
}

function massOf(state) {
    return Object.values(state.conserved.speciesMassKg).reduce((sum, value) => sum + value, 0);
}

function createBackendProjection({ descriptor, handle, packet }) {
    return deepFreezeJson({
        schema: MATTER_PACKET_BACKEND_PROJECTION_SCHEMA,
        schemaVersion: MATTER_PACKET_BACKEND_PROJECTION_VERSION,
        backendId: descriptor.id,
        backendVersion: descriptor.version,
        handle,
        packet,
    }, '$.matterPacketBackendProjection');
}

function validateBackendProjection(valueInput, descriptor) {
    const value = cloneStrictJson(valueInput, '$.matterPacketBackendProjection');
    exactObject(value, BACKEND_PROJECTION_KEYS, '$.matterPacketBackendProjection');
    for (const key of BACKEND_PROJECTION_KEYS) {
        if (!Object.hasOwn(value, key)) fail(`$.matterPacketBackendProjection.${key}`, 'is required');
    }
    if (value.schema !== MATTER_PACKET_BACKEND_PROJECTION_SCHEMA
        || value.schemaVersion !== MATTER_PACKET_BACKEND_PROJECTION_VERSION) {
        fail('$.matterPacketBackendProjection', 'uses an unsupported schema');
    }
    if (value.backendId !== descriptor.id || value.backendVersion !== descriptor.version) {
        fail('$.matterPacketBackendProjection', 'belongs to a different backend');
    }
    validateMatterPacketHandle(value.handle, '$.matterPacketBackendProjection.handle');
    validateMatterPacketProjection(value.packet, '$.matterPacketBackendProjection.packet');
    if (value.handle.pageId !== value.packet.handle.pageId
        || value.handle.slot !== value.packet.handle.slot
        || value.handle.generation !== value.packet.handle.generation) {
        fail('$.matterPacketBackendProjection.handle', 'does not match packet.handle');
    }
    return value;
}

/**
 * Create a descriptor/adapter pair accepted by MatterBackendAdapterRegistry.register().
 * The adapter projects canonical Matter v1 state into the v2 packet codec while
 * leaving representation transitions under MatterOperators authority.
 */
export function createMatterPacketBackendRegistration(codec, optionsInput = {}) {
    if (!(codec instanceof AdaptiveMatterPacketCodec)) {
        fail('$.codec', 'must be an AdaptiveMatterPacketCodec');
    }
    const options = cloneStrictJson(optionsInput, '$.options');
    exactObject(options, REGISTRATION_OPTION_KEYS, '$.options');
    const id = identifier(options.id ?? MATTER_PACKET_BACKEND_ID, '$.options.id');
    const version = options.version ?? 1;
    if (!Number.isSafeInteger(version) || version < 1) fail('$.options.version', 'must be a positive safe integer');
    const representation = options.representation ?? 'granules';
    const fidelityLevels = options.fidelityLevels ?? [...MATTER_FIDELITY_LEVELS];
    const solverAuthority = identifier(
        options.solverAuthority ?? 'solver.adaptive-matter-packet-codec',
        '$.options.solverAuthority',
    );
    const descriptor = deepFreezeJson({
        schema: MATTER_BACKEND_ADAPTER_SCHEMA,
        schemaVersion: MATTER_BACKEND_ADAPTER_VERSION,
        id,
        version,
        representation,
        fidelityLevels,
        capabilities: ['project', 'collect'],
        solverAuthority,
    }, '$.matterPacketBackendDescriptor');

    const adapter = Object.freeze({
        project({ state, context }) {
            const packetContext = cloneStrictJson(context.packet ?? {}, '$.context.packet');
            exactObject(packetContext, PACKET_CONTEXT_KEYS, '$.context.packet');
            const massKg = massOf(state);
            if (!(massKg > 0)) fail('$.state.conserved.speciesMassKg', 'must have positive total mass');
            const velocityMPerS = state.conserved.momentumKgMPerS.map(value => value / massKg);
            const partitionKeys = ['thermalEnergyJ', 'elasticEnergyJ', 'subgridEnergyJ'];
            const hasExplicitPartition = partitionKeys.some(key => Object.hasOwn(packetContext, key));
            const thermalEnergyJ = packetContext.thermalEnergyJ
                ?? (hasExplicitPartition ? 0 : state.conserved.internalEnergyJ);
            const elasticEnergyJ = packetContext.elasticEnergyJ ?? 0;
            const subgridEnergyJ = packetContext.subgridEnergyJ ?? 0;
            const partitionTotal = thermalEnergyJ + elasticEnergyJ + subgridEnergyJ;
            const tolerance = 1e-10 * Math.max(1, state.conserved.internalEnergyJ);
            if (Math.abs(partitionTotal - state.conserved.internalEnergyJ) > tolerance) {
                fail('$.context.packet', 'stored energy partition must equal Matter internalEnergyJ');
            }
            const handle = codec.createPacket({
                ...packetContext,
                regionId: state.regionId,
                definitionId: state.definitionId,
                sourceRevision: state.revision,
                representationRevision: 0,
                velocityMPerS,
                massKg,
                thermalEnergyJ,
                elasticEnergyJ,
                subgridEnergyJ,
            });
            return createBackendProjection({ descriptor, handle, packet: codec.getPacket(handle) });
        },

        collect({ projection, priorState }) {
            const safeProjection = validateBackendProjection(projection, descriptor);
            const projectedPacket = safeProjection.packet;
            if (projectedPacket.regionId !== priorState.regionId
                || projectedPacket.definitionId !== priorState.definitionId) {
                fail('$.matterPacketBackendProjection.packet', 'changed canonical region or definition identity');
            }
            const packets = codec.listPackets().filter(packet => (
                packet.regionId === projectedPacket.regionId
                && packet.definitionId === projectedPacket.definitionId
                && packet.lineage.rootId === projectedPacket.lineage.rootId
            ));
            if (packets.length === 0) {
                fail('$.matterPacketBackendProjection.packet.lineage.rootId', 'has no active codec projection');
            }
            if (packets.some(packet => packet.sourceRevision !== priorState.revision)) {
                fail('$.matterPacketBackendProjection.packet.sourceRevision', 'is stale for priorState');
            }
            const summary = summarizeMatterPackets(packets);
            const priorMass = massOf(priorState);
            const massTolerance = 1e-10 * Math.max(1, priorMass);
            if (Math.abs(summary.massKg - priorMass) > massTolerance) {
                fail('$.matterPacketBackendProjection.packet.massKg', 'cannot change v1 composition mass during collection');
            }
            const candidate = structuredClone(priorState);
            candidate.revision += 1;
            candidate.conserved.momentumKgMPerS = summary.linearMomentumKgMPerS;
            candidate.conserved.internalEnergyJ = summary.energyJ.thermalJ
                + summary.energyJ.elasticJ
                + summary.energyJ.subgridJ;
            return candidate;
        },
    });
    return Object.freeze({ descriptor, adapter });
}
