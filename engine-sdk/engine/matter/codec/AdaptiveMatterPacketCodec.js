// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Deterministic CPU reference codec for hierarchical 1-to-8 Matter packets. */

import {
    cloneAndFreezeStrictJson,
    cloneStrictJson,
    deepFreezeJson,
    isPlainJsonObject,
} from '../../core/schema/StrictJsonValue.js';
import {
    MATTER_PACKET_MAX_LINEAGE_LEVEL,
    createMatterPacketCodecReceipt,
    createMatterPacketProjection,
} from './MatterPacketContracts.js';
import { MatterPacketPageStore } from './MatterPacketPageStore.js';

export const ADAPTIVE_MATTER_PACKET_CODEC_SNAPSHOT_SCHEMA = 'engine.matter.adaptive-packet-codec-snapshot';
export const ADAPTIVE_MATTER_PACKET_CODEC_SNAPSHOT_VERSION = '2.0.0';
export const MATTER_PACKET_CODEC_STATS_SCHEMA = 'engine.matter.packet-codec-stats';
export const MATTER_PACKET_CODEC_STATS_VERSION = '2.0.0';
export const MATTER_PACKET_PHASE_REBIND_RECEIPT_SCHEMA = 'engine.matter.packet-phase-rebind-receipt';
export const MATTER_PACKET_PHASE_REBIND_RECEIPT_VERSION = '1.0.0';

export const MATTER_PACKET_CODEC_ERROR_CODES = Object.freeze({
    CAPACITY_EXHAUSTED: 'PACKET_CODEC_CAPACITY_EXHAUSTED',
    CONSERVATION_FAILURE: 'PACKET_CODEC_CONSERVATION_FAILURE',
    DESTROYED: 'PACKET_CODEC_DESTROYED',
    INCOMPATIBLE_MERGE: 'PACKET_CODEC_INCOMPATIBLE_MERGE',
    INVALID_PACKET: 'PACKET_CODEC_INVALID_PACKET',
    LINEAGE_CONFLICT: 'PACKET_CODEC_LINEAGE_CONFLICT',
    REVISION_CONFLICT: 'PACKET_CODEC_REVISION_CONFLICT',
    STALE_HANDLE: 'PACKET_CODEC_STALE_HANDLE',
});

const CODEC_SNAPSHOT_KEYS = new Set([
    'schema', 'schemaVersion', 'instanceId', 'nextLineageSequence', 'nextReceiptSequence',
    'absoluteTolerance', 'relativeTolerance', 'highWaterMark', 'allocationFailures',
    'splitCount', 'mergeCount', 'store',
]);
const CREATE_INPUT_KEYS = new Set([
    'regionId', 'lineage', 'lineageId', 'definitionId', 'phase', 'componentId',
    'damageState', 'sourceRevision', 'representationRevision', 'positionM',
    'velocityMPerS', 'massKg', 'representedVolumeM3', 'angularMomentumKgM2PerS',
    'thermalEnergyJ', 'elasticEnergyJ', 'subgridEnergyJ',
]);
const RESTORE_OPTION_KEYS = new Set([
    'pageSize', 'maxPages', 'instanceId', 'logger', 'absoluteTolerance', 'relativeTolerance',
]);
const OPERATION_OPTION_KEYS = new Set([
    'expectedSourceRevision', 'expectedRepresentationRevision', 'volumePolicy',
    'velocityGradientPerS',
]);
const KINEMATIC_UPDATE_KEYS = new Set(['handle', 'positionM', 'velocityMPerS']);
const KINEMATIC_UPDATE_OPTION_KEYS = new Set([
    'expectedSourceRevision', 'expectedRepresentationRevision',
]);
const PHASE_REBIND_KEYS = new Set([
    'regionId', 'fromPhase', 'toPhase', 'expectedSourceRevision',
    'nextSourceRevision', 'expectedPackets', 'internalEnergyDeltaJ',
]);
const PHASE_REBIND_BINDING_KEYS = new Set([
    'handle', 'lineageId', 'representationRevision',
]);
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,191}$/;
const CHILD_SUFFIX = /^(.*)\.c([0-7])$/;
const DEFAULT_DAMAGE_STATE = Object.freeze({
    modelId: 'damage.none',
    revision: 0,
    fraction: 0,
    topologyId: 'topology.intact',
});
const DUMMY_HANDLE = Object.freeze({ pageId: 0, slot: 0, generation: 1 });

function failType(path, message) {
    throw new TypeError(`${path}: ${message}`);
}

function exactObject(value, keys, path) {
    if (!isPlainJsonObject(value)) failType(path, 'must be a plain object');
    for (const key of Object.keys(value)) {
        if (!keys.has(key)) failType(`${path}.${key}`, 'unknown field');
    }
    return value;
}

function identifier(value, path, maximum = 192) {
    if (typeof value !== 'string' || value.length > maximum || !IDENTIFIER.test(value)) {
        failType(path, 'has invalid identifier syntax');
    }
    return value;
}

function nonNegativeInteger(value, path) {
    if (!Number.isSafeInteger(value) || value < 0) failType(path, 'must be a non-negative safe integer');
    return value;
}

function nonNegativeFinite(value, path) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        failType(path, 'must be a non-negative finite number');
    }
    return value;
}

function finite(value, path) {
    if (typeof value !== 'number' || !Number.isFinite(value)) failType(path, 'must be finite');
    return value;
}

function vectorAdd(left, right) {
    return [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
}

function vectorSubtract(left, right) {
    return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

function vectorScale(value, scale) {
    return [value[0] * scale, value[1] * scale, value[2] * scale];
}

function cross(left, right) {
    return [
        left[1] * right[2] - left[2] * right[1],
        left[2] * right[0] - left[0] * right[2],
        left[0] * right[1] - left[1] * right[0],
    ];
}

function squaredLength(value) {
    return value[0] ** 2 + value[1] ** 2 + value[2] ** 2;
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

function compensatedVector(values) {
    return [0, 1, 2].map(axis => compensatedSum(values.map(value => value[axis])));
}

function summarizePackets(packets) {
    if (!Array.isArray(packets) || packets.length === 0) failType('$.packets', 'must not be empty');
    const massKg = compensatedSum(packets.map(packet => packet.massKg));
    const firstMassMomentKgM = compensatedVector(packets.map(packet => vectorScale(packet.positionM, packet.massKg)));
    const centerOfMassM = vectorScale(firstMassMomentKgM, 1 / massKg);
    const momenta = packets.map(packet => vectorScale(packet.velocityMPerS, packet.massKg));
    const linearMomentumKgMPerS = compensatedVector(momenta);
    const angularMomentumKgM2PerS = compensatedVector(packets.map((packet, index) => vectorAdd(
        packet.angularMomentumKgM2PerS,
        cross(vectorSubtract(packet.positionM, centerOfMassM), momenta[index]),
    )));
    const kineticJ = compensatedSum(packets.map(packet => 0.5 * packet.massKg * squaredLength(packet.velocityMPerS)));
    const thermalJ = compensatedSum(packets.map(packet => packet.thermalEnergyJ));
    const elasticJ = compensatedSum(packets.map(packet => packet.elasticEnergyJ));
    const subgridJ = compensatedSum(packets.map(packet => packet.subgridEnergyJ));
    const representedVolumeM3 = compensatedSum(packets.map(packet => packet.representedVolumeM3));
    return {
        packetCount: packets.length,
        massKg,
        firstMassMomentKgM,
        centerOfMassM,
        linearMomentumKgMPerS,
        angularMomentumKgM2PerS,
        energyJ: {
            kineticJ,
            thermalJ,
            elasticJ,
            subgridJ,
            totalJ: kineticJ + thermalJ + elasticJ + subgridJ,
        },
        representedVolumeM3,
    };
}

function scalarBalanced(before, after, residual, tolerance) {
    const scale = Math.max(1, Math.abs(before), Math.abs(after));
    return Math.abs(residual) <= tolerance.absolute + tolerance.relative * scale;
}

function vectorBalanced(before, after, residual, tolerance) {
    return residual.every((entry, axis) => scalarBalanced(before[axis], after[axis], entry, tolerance));
}

function createConservationReceipt({
    receiptId,
    operation,
    beforePackets,
    afterPackets,
    tolerance,
    volumePolicy,
}) {
    const before = summarizePackets(beforePackets);
    const after = summarizePackets(afterPackets);
    const residual = {
        massKg: after.massKg - before.massKg,
        firstMassMomentKgM: vectorSubtract(after.firstMassMomentKgM, before.firstMassMomentKgM),
        centerOfMassM: vectorSubtract(after.centerOfMassM, before.centerOfMassM),
        linearMomentumKgMPerS: vectorSubtract(after.linearMomentumKgMPerS, before.linearMomentumKgMPerS),
        angularMomentumKgM2PerS: vectorSubtract(
            after.angularMomentumKgM2PerS,
            before.angularMomentumKgM2PerS,
        ),
        totalEnergyJ: after.energyJ.totalJ - before.energyJ.totalJ,
        representedVolumeM3: after.representedVolumeM3 - before.representedVolumeM3,
    };
    const balanced = {
        mass: scalarBalanced(before.massKg, after.massKg, residual.massKg, tolerance),
        firstMassMoment: vectorBalanced(
            before.firstMassMomentKgM,
            after.firstMassMomentKgM,
            residual.firstMassMomentKgM,
            tolerance,
        ),
        centerOfMass: vectorBalanced(
            before.centerOfMassM,
            after.centerOfMassM,
            residual.centerOfMassM,
            tolerance,
        ),
        linearMomentum: vectorBalanced(
            before.linearMomentumKgMPerS,
            after.linearMomentumKgMPerS,
            residual.linearMomentumKgMPerS,
            tolerance,
        ),
        angularMomentum: vectorBalanced(
            before.angularMomentumKgM2PerS,
            after.angularMomentumKgM2PerS,
            residual.angularMomentumKgM2PerS,
            tolerance,
        ),
        totalEnergy: scalarBalanced(
            before.energyJ.totalJ,
            after.energyJ.totalJ,
            residual.totalEnergyJ,
            tolerance,
        ),
        representedVolume: volumePolicy === 'report-only' || scalarBalanced(
            before.representedVolumeM3,
            after.representedVolumeM3,
            residual.representedVolumeM3,
            tolerance,
        ),
    };
    balanced.all = Object.values(balanced).every(Boolean);
    const sourceRevision = beforePackets[0].sourceRevision;
    const beforeRepresentationRevision = Math.max(...beforePackets.map(packet => packet.representationRevision));
    const afterRepresentationRevision = afterPackets[0].representationRevision;
    return createMatterPacketCodecReceipt({
        receiptId,
        operation,
        regionId: beforePackets[0].regionId,
        sourceRevision,
        representationRevision: {
            before: beforeRepresentationRevision,
            after: afterRepresentationRevision,
        },
        inputLineageIds: beforePackets.map(packet => packet.lineage.id),
        outputLineageIds: afterPackets.map(packet => packet.lineage.id),
        before,
        after,
        residual,
        tolerance,
        seams: {
            centerOfMassDeltaM: residual.centerOfMassM,
            representedVolumeDeltaM3: residual.representedVolumeM3,
            representedVolumePolicy: volumePolicy,
            sourceRevisionMatched: [...beforePackets, ...afterPackets]
                .every(packet => packet.sourceRevision === sourceRevision),
            representationRevisionAdvanced: afterRepresentationRevision === beforeRepresentationRevision + 1
                && afterPackets.every(packet => packet.representationRevision === afterRepresentationRevision),
        },
        balanced,
    });
}

function normalizeOperationOptions(optionsInput) {
    const options = cloneStrictJson(optionsInput, '$.options');
    exactObject(options, OPERATION_OPTION_KEYS, '$.options');
    if (options.expectedSourceRevision != null) {
        nonNegativeInteger(options.expectedSourceRevision, '$.options.expectedSourceRevision');
    }
    if (options.expectedRepresentationRevision != null) {
        nonNegativeInteger(options.expectedRepresentationRevision, '$.options.expectedRepresentationRevision');
    }
    const volumePolicy = options.volumePolicy ?? 'preserve';
    if (!['preserve', 'report-only'].includes(volumePolicy)) failType('$.options.volumePolicy', 'is unsupported');
    if (options.velocityGradientPerS != null) {
        if (!Array.isArray(options.velocityGradientPerS) || options.velocityGradientPerS.length !== 9) {
            failType('$.options.velocityGradientPerS', 'must be a row-major 3-by-3 matrix');
        }
        options.velocityGradientPerS.forEach((value, index) => finite(
            value,
            `$.options.velocityGradientPerS[${index}]`,
        ));
    }
    return { ...options, volumePolicy };
}

function transformMatrix3(matrix, vector) {
    return [
        matrix[0] * vector[0] + matrix[1] * vector[1] + matrix[2] * vector[2],
        matrix[3] * vector[0] + matrix[4] * vector[1] + matrix[5] * vector[2],
        matrix[6] * vector[0] + matrix[7] * vector[1] + matrix[8] * vector[2],
    ];
}

function createRootLineage(id) {
    return { id, rootId: id, parentId: null, level: 0, childOrdinal: null };
}

function childLineage(parent, ordinal) {
    const id = `${parent.id}.c${ordinal}`;
    if (id.length > 192 || !IDENTIFIER.test(id)) {
        throw new MatterPacketCodecError(
            MATTER_PACKET_CODEC_ERROR_CODES.LINEAGE_CONFLICT,
            `Packet lineage '${parent.id}' cannot encode another deterministic child level`,
            { lineageId: parent.id, level: parent.level },
        );
    }
    return {
        id,
        rootId: parent.rootId,
        parentId: parent.id,
        level: parent.level + 1,
        childOrdinal: ordinal,
    };
}

function parentLineage(children) {
    const child = children[0].lineage;
    const id = child.parentId;
    const level = child.level - 1;
    if (level === 0) return createRootLineage(id);
    const match = CHILD_SUFFIX.exec(id);
    if (!match || match[1].length === 0) {
        throw new MatterPacketCodecError(
            MATTER_PACKET_CODEC_ERROR_CODES.LINEAGE_CONFLICT,
            `Packet lineage '${id}' is not a deterministic codec descendant`,
            { lineageId: id, level },
        );
    }
    return {
        id,
        rootId: child.rootId,
        parentId: match[1],
        level,
        childOrdinal: Number(match[2]),
    };
}

function packetData(packet) {
    const { handle: _handle, schema: _schema, schemaVersion: _schemaVersion, ...data } = packet;
    return data;
}

function compatibleJson(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
}

function sameHandle(left, right) {
    return left.pageId === right.pageId
        && left.slot === right.slot
        && left.generation === right.generation;
}

export class MatterPacketCodecError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.name = 'MatterPacketCodecError';
        this.code = code;
        this.details = cloneAndFreezeStrictJson(details, '$.matterPacketCodecError.details');
    }
}

export class AdaptiveMatterPacketCodec {
    #store;
    #instanceId;
    #logger;
    #absoluteTolerance;
    #relativeTolerance;
    #lineageIds = new Set();
    #nextLineageSequence = 1;
    #nextReceiptSequence = 1;
    #highWaterMark = 0;
    #allocationFailures = 0;
    #splitCount = 0;
    #mergeCount = 0;
    #destroyed = false;

    constructor({
        pageSize = 256,
        maxPages = 16,
        instanceId = 'matter-packet-codec',
        logger = null,
        absoluteTolerance = 1e-10,
        relativeTolerance = 1e-10,
        snapshot = null,
    } = {}) {
        this.#instanceId = identifier(instanceId, '$.instanceId', 128);
        if (logger !== null && (!logger || typeof logger !== 'object')) failType('$.logger', 'must be an object or null');
        this.#logger = logger;
        this.#absoluteTolerance = nonNegativeFinite(absoluteTolerance, '$.absoluteTolerance');
        this.#relativeTolerance = nonNegativeFinite(relativeTolerance, '$.relativeTolerance');
        this.#store = new MatterPacketPageStore({ pageSize, maxPages });
        this.#log('debug', 'initialize', { pageSize, maxPages, restoring: snapshot !== null });
        if (snapshot !== null) this.restore(snapshot);
    }

    #assertAlive() {
        if (this.#destroyed) {
            throw new MatterPacketCodecError(
                MATTER_PACKET_CODEC_ERROR_CODES.DESTROYED,
                `Matter packet codec '${this.#instanceId}' has been destroyed`,
            );
        }
    }

    #log(level, event, details = {}) {
        const method = this.#logger?.[level];
        if (typeof method !== 'function') return;
        try {
            method.call(this.#logger, `[MatterPacketCodec] ${event}`, details);
        } catch (_loggingError) {
            // Diagnostics must never become simulation authority or break atomicity.
        }
    }

    #lookup(handle) {
        const lookup = this.#store.lookup(handle);
        if (lookup.status === 'ok') return lookup.packet;
        if (lookup.status === 'invalid') {
            throw new MatterPacketCodecError(
                MATTER_PACKET_CODEC_ERROR_CODES.STALE_HANDLE,
                'Matter packet handle is invalid',
                { reason: lookup.error.message },
            );
        }
        throw new MatterPacketCodecError(
            MATTER_PACKET_CODEC_ERROR_CODES.STALE_HANDLE,
            'Matter packet handle is stale or inactive',
            { handle: lookup.handle },
        );
    }

    #verifyExpectedRevision(packets, options) {
        if (options.expectedSourceRevision != null
            && packets.some(packet => packet.sourceRevision !== options.expectedSourceRevision)) {
            throw new MatterPacketCodecError(
                MATTER_PACKET_CODEC_ERROR_CODES.REVISION_CONFLICT,
                `Expected source revision ${options.expectedSourceRevision}`,
                { actual: packets.map(packet => packet.sourceRevision) },
            );
        }
        if (options.expectedRepresentationRevision != null
            && packets.some(packet => packet.representationRevision !== options.expectedRepresentationRevision)) {
            throw new MatterPacketCodecError(
                MATTER_PACKET_CODEC_ERROR_CODES.REVISION_CONFLICT,
                `Expected representation revision ${options.expectedRepresentationRevision}`,
                { actual: packets.map(packet => packet.representationRevision) },
            );
        }
    }

    #normalizeCreatedPacket(input) {
        const source = cloneStrictJson(input, '$.packet');
        exactObject(source, CREATE_INPUT_KEYS, '$.packet');
        if (source.lineage != null && source.lineageId != null) {
            failType('$.packet', 'lineage and lineageId are mutually exclusive');
        }
        let generatedLineage = false;
        let lineage = source.lineage;
        if (lineage == null) {
            const lineageId = source.lineageId ?? `${this.#instanceId}.packet.${this.#nextLineageSequence}`;
            lineage = createRootLineage(identifier(lineageId, '$.packet.lineageId'));
            generatedLineage = source.lineageId == null;
        }
        const { lineageId: _lineageId, ...properties } = source;
        const projection = createMatterPacketProjection({
            handle: DUMMY_HANDLE,
            damageState: DEFAULT_DAMAGE_STATE,
            sourceRevision: 0,
            representationRevision: 0,
            angularMomentumKgM2PerS: [0, 0, 0],
            thermalEnergyJ: 0,
            elasticEnergyJ: 0,
            subgridEnergyJ: 0,
            ...properties,
            lineage,
        });
        if (projection.lineage.level !== 0) {
            throw new MatterPacketCodecError(
                MATTER_PACKET_CODEC_ERROR_CODES.LINEAGE_CONFLICT,
                'createPacket accepts only root lineages; descendants are created by splitPacket',
                { lineageId: projection.lineage.id, level: projection.lineage.level },
            );
        }
        return { data: packetData(projection), generatedLineage };
    }

    #allocate(data) {
        const handle = this.#store.allocate(data);
        if (!handle) {
            this.#allocationFailures += 1;
            throw new MatterPacketCodecError(
                MATTER_PACKET_CODEC_ERROR_CODES.CAPACITY_EXHAUSTED,
                `Matter packet codec capacity ${this.#store.maximumSlotCapacity} is exhausted`,
                this.stats(),
            );
        }
        this.#highWaterMark = Math.max(this.#highWaterMark, this.#store.activeCount);
        return handle;
    }

    #rollback(snapshot, originalError) {
        try {
            this.#restoreSnapshot(snapshot, { log: false });
        } catch (rollbackError) {
            this.#log('error', 'rollback-failed', { originalError: originalError.message, rollbackError: rollbackError.message });
            throw rollbackError;
        }
        throw originalError;
    }

    #restoreSnapshot(snapshotInput, { log = true } = {}) {
        const snapshot = cloneStrictJson(snapshotInput, '$.adaptiveMatterPacketCodecSnapshot');
        exactObject(snapshot, CODEC_SNAPSHOT_KEYS, '$.adaptiveMatterPacketCodecSnapshot');
        if (snapshot.schema !== ADAPTIVE_MATTER_PACKET_CODEC_SNAPSHOT_SCHEMA) {
            failType('$.adaptiveMatterPacketCodecSnapshot.schema', 'is unsupported');
        }
        if (snapshot.schemaVersion !== ADAPTIVE_MATTER_PACKET_CODEC_SNAPSHOT_VERSION) {
            failType('$.adaptiveMatterPacketCodecSnapshot.schemaVersion', 'is unsupported');
        }
        identifier(snapshot.instanceId, '$.adaptiveMatterPacketCodecSnapshot.instanceId', 128);
        for (const key of [
            'nextLineageSequence', 'nextReceiptSequence', 'highWaterMark', 'allocationFailures',
            'splitCount', 'mergeCount',
        ]) nonNegativeInteger(snapshot[key], `$.adaptiveMatterPacketCodecSnapshot.${key}`);
        nonNegativeFinite(snapshot.absoluteTolerance, '$.adaptiveMatterPacketCodecSnapshot.absoluteTolerance');
        nonNegativeFinite(snapshot.relativeTolerance, '$.adaptiveMatterPacketCodecSnapshot.relativeTolerance');
        if (snapshot.nextLineageSequence < 1 || snapshot.nextReceiptSequence < 1) {
            failType('$.adaptiveMatterPacketCodecSnapshot', 'next sequences must be positive');
        }
        const restoredStore = new MatterPacketPageStore();
        restoredStore.restore(snapshot.store);
        const lineageIds = new Set();
        const rootIds = new Set();
        for (const packet of restoredStore.list()) {
            if (lineageIds.has(packet.lineage.id)) {
                failType('$.adaptiveMatterPacketCodecSnapshot.store', `duplicates lineage '${packet.lineage.id}'`);
            }
            lineageIds.add(packet.lineage.id);
            rootIds.add(packet.lineage.rootId);
        }
        const orderedRootIds = [...rootIds].sort();
        for (let index = 1; index < orderedRootIds.length; index += 1) {
            if (orderedRootIds[index].startsWith(`${orderedRootIds[index - 1]}.c`)) {
                failType('$.adaptiveMatterPacketCodecSnapshot.store', 'contains overlapping root lineage namespaces');
            }
        }
        const orderedLineageIds = [...lineageIds].sort();
        for (let index = 1; index < orderedLineageIds.length; index += 1) {
            if (orderedLineageIds[index].startsWith(`${orderedLineageIds[index - 1]}.c`)) {
                failType('$.adaptiveMatterPacketCodecSnapshot.store', 'activates an ancestor and descendant together');
            }
        }
        if (snapshot.highWaterMark < restoredStore.activeCount
            || snapshot.highWaterMark > restoredStore.maximumSlotCapacity) {
            failType('$.adaptiveMatterPacketCodecSnapshot.highWaterMark', 'is inconsistent with store capacity');
        }
        this.#store = restoredStore;
        this.#instanceId = snapshot.instanceId;
        this.#lineageIds = lineageIds;
        this.#nextLineageSequence = snapshot.nextLineageSequence;
        this.#nextReceiptSequence = snapshot.nextReceiptSequence;
        this.#absoluteTolerance = snapshot.absoluteTolerance;
        this.#relativeTolerance = snapshot.relativeTolerance;
        this.#highWaterMark = snapshot.highWaterMark;
        this.#allocationFailures = snapshot.allocationFailures;
        this.#splitCount = snapshot.splitCount;
        this.#mergeCount = snapshot.mergeCount;
        if (log) this.#log('debug', 'restore', { activePackets: restoredStore.activeCount });
    }

    createPacket(input) {
        this.#assertAlive();
        this.#log('debug', 'create-start');
        let normalized;
        try {
            normalized = this.#normalizeCreatedPacket(input);
            if (this.#lineageIds.has(normalized.data.lineage.id)) {
                throw new MatterPacketCodecError(
                    MATTER_PACKET_CODEC_ERROR_CODES.LINEAGE_CONFLICT,
                    `Active packet lineage '${normalized.data.lineage.id}' already exists`,
                    { lineageId: normalized.data.lineage.id },
                );
            }
            const rootId = normalized.data.lineage.rootId;
            const overlapsHierarchy = this.#store.list().some(packet => (
                packet.lineage.rootId === rootId
                || packet.lineage.rootId.startsWith(`${rootId}.c`)
                || rootId.startsWith(`${packet.lineage.rootId}.c`)
            ));
            if (overlapsHierarchy) {
                throw new MatterPacketCodecError(
                    MATTER_PACKET_CODEC_ERROR_CODES.LINEAGE_CONFLICT,
                    `Root lineage namespace '${rootId}' overlaps an active packet hierarchy`,
                    { lineageId: rootId },
                );
            }
            const handle = this.#allocate(normalized.data);
            this.#lineageIds.add(normalized.data.lineage.id);
            if (normalized.generatedLineage) this.#nextLineageSequence += 1;
            this.#log('debug', 'create', { handle, lineageId: normalized.data.lineage.id });
            return handle;
        } catch (error) {
            this.#log('error', 'create-failed', { message: error.message });
            if (error instanceof MatterPacketCodecError) throw error;
            throw new MatterPacketCodecError(
                MATTER_PACKET_CODEC_ERROR_CODES.INVALID_PACKET,
                error.message,
            );
        }
    }

    getPacket(handle) {
        this.#assertAlive();
        return this.#lookup(handle);
    }

    listPackets() {
        this.#assertAlive();
        return this.#store.list();
    }

    activePackets() {
        return this.listPackets();
    }

    releasePacket(handle) {
        this.#assertAlive();
        this.#log('debug', 'release-start');
        try {
            const packet = this.#lookup(handle);
            const result = this.#store.release(handle);
            if (result.status !== 'ok') return this.#lookup(handle);
            this.#lineageIds.delete(packet.lineage.id);
            this.#log('debug', 'release', { handle, lineageId: packet.lineage.id });
            return packet;
        } catch (error) {
            this.#log('error', 'release-failed', { message: error.message });
            throw error;
        }
    }

    /**
     * Atomically commit solver-owned motion while retaining packet identity,
     * material, conserved inventory, and the canonical source binding.
     */
    updatePacketKinematics(updatesInput, optionsInput = {}) {
        this.#assertAlive();
        this.#log('debug', 'kinematic-update-start');
        let candidates;
        try {
            const options = cloneStrictJson(optionsInput, '$.options');
            exactObject(options, KINEMATIC_UPDATE_OPTION_KEYS, '$.options');
            if (options.expectedSourceRevision != null) {
                nonNegativeInteger(options.expectedSourceRevision, '$.options.expectedSourceRevision');
            }
            if (options.expectedRepresentationRevision != null) {
                nonNegativeInteger(
                    options.expectedRepresentationRevision,
                    '$.options.expectedRepresentationRevision',
                );
            }
            const updates = cloneStrictJson(updatesInput, '$.updates');
            if (!Array.isArray(updates) || updates.length > this.#store.activeCount) {
                failType('$.updates', `must be an array with at most ${this.#store.activeCount} entries`);
            }
            const seenHandles = new Set();
            candidates = updates.map((update, index) => {
                const path = `$.updates[${index}]`;
                exactObject(update, KINEMATIC_UPDATE_KEYS, path);
                for (const key of KINEMATIC_UPDATE_KEYS) {
                    if (!Object.hasOwn(update, key)) failType(`${path}.${key}`, 'is required');
                }
                const current = this.#lookup(update.handle);
                const handleKey = `${current.handle.pageId}:${current.handle.slot}:${current.handle.generation}`;
                if (seenHandles.has(handleKey)) failType(`${path}.handle`, 'duplicates an earlier handle');
                seenHandles.add(handleKey);
                this.#verifyExpectedRevision([current], options);
                const candidate = createMatterPacketProjection({
                    ...packetData(current),
                    handle: current.handle,
                    positionM: update.positionM,
                    velocityMPerS: update.velocityMPerS,
                });
                return { current, candidate };
            });
        } catch (error) {
            this.#log('error', 'kinematic-update-rejected', { message: error.message });
            if (error instanceof MatterPacketCodecError) throw error;
            throw new MatterPacketCodecError(MATTER_PACKET_CODEC_ERROR_CODES.INVALID_PACKET, error.message);
        }
        const rollback = this.snapshot();
        try {
            const committed = candidates.map(({ current, candidate }) => {
                const result = this.#store.update(current.handle, packetData(candidate));
                if (result.status !== 'ok') return this.#lookup(current.handle);
                return result.packet;
            });
            this.#log('debug', 'kinematic-update', { packetCount: committed.length });
            return cloneAndFreezeStrictJson(committed, '$.kinematicUpdateResult');
        } catch (error) {
            this.#log('error', 'kinematic-update-failed', { message: error.message });
            return this.#rollback(rollback, error);
        }
    }

    /**
     * Atomically migrate every packet in one region to another phase binding.
     * Handles, lineage, material identity, mass, momentum, and represented
     * volume remain stable. Explicit phase energy is reconciled into the
     * packet internal-energy channels and both revision domains advance once.
     */
    rebindRegionPhase(requestInput) {
        this.#assertAlive();
        this.#log('debug', 'phase-rebind-start');
        let request;
        let beforePackets;
        let candidates;
        try {
            request = cloneStrictJson(requestInput, '$.phaseRebind');
            exactObject(request, PHASE_REBIND_KEYS, '$.phaseRebind');
            for (const key of PHASE_REBIND_KEYS) {
                if (!Object.hasOwn(request, key)) failType(`$.phaseRebind.${key}`, 'is required');
            }
            identifier(request.regionId, '$.phaseRebind.regionId');
            identifier(request.fromPhase, '$.phaseRebind.fromPhase');
            identifier(request.toPhase, '$.phaseRebind.toPhase');
            if (request.fromPhase === request.toPhase) failType('$.phaseRebind', 'must change phase');
            nonNegativeInteger(request.expectedSourceRevision, '$.phaseRebind.expectedSourceRevision');
            nonNegativeInteger(request.nextSourceRevision, '$.phaseRebind.nextSourceRevision');
            if (request.nextSourceRevision !== request.expectedSourceRevision + 1) {
                failType('$.phaseRebind.nextSourceRevision', 'must advance exactly once');
            }
            finite(request.internalEnergyDeltaJ, '$.phaseRebind.internalEnergyDeltaJ');
            if (!Array.isArray(request.expectedPackets) || request.expectedPackets.length === 0
                || request.expectedPackets.length > this.#store.activeCount) {
                failType('$.phaseRebind.expectedPackets', 'must be a bounded non-empty array');
            }
            const expectedLineages = new Set();
            const expectedHandles = new Set();
            request.expectedPackets.forEach((binding, index) => {
                const path = `$.phaseRebind.expectedPackets[${index}]`;
                exactObject(binding, PHASE_REBIND_BINDING_KEYS, path);
                for (const key of PHASE_REBIND_BINDING_KEYS) {
                    if (!Object.hasOwn(binding, key)) failType(`${path}.${key}`, 'is required');
                }
                identifier(binding.lineageId, `${path}.lineageId`);
                nonNegativeInteger(binding.representationRevision, `${path}.representationRevision`);
                const packet = this.#lookup(binding.handle);
                const handleKey = `${packet.handle.pageId}:${packet.handle.slot}:${packet.handle.generation}`;
                if (expectedHandles.has(handleKey)) failType(`${path}.handle`, 'duplicates an earlier handle');
                if (expectedLineages.has(binding.lineageId)) failType(`${path}.lineageId`, 'duplicates an earlier lineage');
                if (index > 0 && request.expectedPackets[index - 1].lineageId.localeCompare(binding.lineageId) >= 0) {
                    failType('$.phaseRebind.expectedPackets', 'must be strictly sorted by lineageId');
                }
                expectedHandles.add(handleKey);
                expectedLineages.add(binding.lineageId);
            });
            beforePackets = [...this.#store.list()]
                .filter(packet => packet.regionId === request.regionId)
                .sort((left, right) => left.lineage.id.localeCompare(right.lineage.id));
            const stale = beforePackets.length !== request.expectedPackets.length
                || beforePackets.some((packet, index) => {
                    const expected = request.expectedPackets[index];
                    return packet.lineage.id !== expected.lineageId
                        || !sameHandle(packet.handle, expected.handle)
                        || packet.phase !== request.fromPhase
                        || packet.sourceRevision !== request.expectedSourceRevision
                        || packet.representationRevision !== expected.representationRevision;
                });
            if (stale) {
                throw new MatterPacketCodecError(
                    MATTER_PACKET_CODEC_ERROR_CODES.REVISION_CONFLICT,
                    `Region '${request.regionId}' changed after its phase migration was prepared`,
                    { regionId: request.regionId },
                );
            }
            if (beforePackets.some(packet => packet.representationRevision === Number.MAX_SAFE_INTEGER)
                || request.expectedSourceRevision === Number.MAX_SAFE_INTEGER) {
                throw new MatterPacketCodecError(
                    MATTER_PACKET_CODEC_ERROR_CODES.REVISION_CONFLICT,
                    'Phase migration revisions cannot advance safely',
                    { regionId: request.regionId },
                );
            }
            const internalBeforeJ = compensatedSum(beforePackets.map(packet => (
                packet.thermalEnergyJ + packet.elasticEnergyJ + packet.subgridEnergyJ
            )));
            const thermalBeforeJ = compensatedSum(beforePackets.map(packet => packet.thermalEnergyJ));
            const massBeforeKg = compensatedSum(beforePackets.map(packet => packet.massKg));
            const internalAfterJ = internalBeforeJ + request.internalEnergyDeltaJ;
            const thermalAfterJ = thermalBeforeJ + request.internalEnergyDeltaJ;
            const energyTolerance = this.#absoluteTolerance
                + this.#relativeTolerance * Math.max(1, Math.abs(internalBeforeJ), Math.abs(internalAfterJ));
            if (!Number.isFinite(internalAfterJ) || !Number.isFinite(thermalAfterJ)
                || thermalAfterJ < -energyTolerance) {
                throw new MatterPacketCodecError(
                    MATTER_PACKET_CODEC_ERROR_CODES.CONSERVATION_FAILURE,
                    'Phase migration would create negative or non-finite packet thermal energy',
                    { thermalBeforeJ, internalEnergyDeltaJ: request.internalEnergyDeltaJ },
                );
            }
            const clampedThermalAfterJ = Math.max(0, thermalAfterJ);
            let allocatedPositiveJ = 0;
            candidates = beforePackets.map((packet, index) => {
                let thermalEnergyJ = packet.thermalEnergyJ;
                const elasticEnergyJ = packet.elasticEnergyJ;
                const subgridEnergyJ = packet.subgridEnergyJ;
                if (request.internalEnergyDeltaJ >= 0) {
                    const addition = index === beforePackets.length - 1
                        ? request.internalEnergyDeltaJ - allocatedPositiveJ
                        : request.internalEnergyDeltaJ * (packet.massKg / massBeforeKg);
                    allocatedPositiveJ += addition;
                    thermalEnergyJ += addition;
                } else if (thermalBeforeJ > 0) {
                    const scale = clampedThermalAfterJ / thermalBeforeJ;
                    thermalEnergyJ *= scale;
                }
                return createMatterPacketProjection({
                    ...packetData(packet),
                    handle: packet.handle,
                    phase: request.toPhase,
                    sourceRevision: request.nextSourceRevision,
                    representationRevision: packet.representationRevision + 1,
                    thermalEnergyJ,
                    elasticEnergyJ,
                    subgridEnergyJ,
                });
            });
        } catch (error) {
            this.#log('error', 'phase-rebind-rejected', { message: error.message });
            if (error instanceof MatterPacketCodecError) throw error;
            throw new MatterPacketCodecError(MATTER_PACKET_CODEC_ERROR_CODES.INVALID_PACKET, error.message);
        }
        const rollback = this.snapshot();
        try {
            const committed = candidates.map(packet => {
                const result = this.#store.update(packet.handle, packetData(packet));
                if (result.status !== 'ok') return this.#lookup(packet.handle);
                return result.packet;
            });
            const before = summarizePackets(beforePackets);
            const after = summarizePackets(committed);
            const residual = {
                massKg: after.massKg - before.massKg,
                firstMassMomentKgM: vectorSubtract(after.firstMassMomentKgM, before.firstMassMomentKgM),
                linearMomentumKgMPerS: vectorSubtract(
                    after.linearMomentumKgMPerS,
                    before.linearMomentumKgMPerS,
                ),
                angularMomentumKgM2PerS: vectorSubtract(
                    after.angularMomentumKgM2PerS,
                    before.angularMomentumKgM2PerS,
                ),
                totalEnergyJ: after.energyJ.totalJ - before.energyJ.totalJ,
                representedVolumeM3: after.representedVolumeM3 - before.representedVolumeM3,
            };
            const tolerance = { absolute: this.#absoluteTolerance, relative: this.#relativeTolerance };
            const identities = {
                handles: committed.every((packet, index) => sameHandle(packet.handle, beforePackets[index].handle)),
                lineage: committed.every((packet, index) => compatibleJson(packet.lineage, beforePackets[index].lineage)),
                definition: committed.every((packet, index) => packet.definitionId === beforePackets[index].definitionId),
                component: committed.every((packet, index) => packet.componentId === beforePackets[index].componentId),
                damage: committed.every((packet, index) => compatibleJson(
                    packet.damageState,
                    beforePackets[index].damageState,
                )),
                region: committed.every(packet => packet.regionId === request.regionId),
            };
            const revisions = {
                sourceAdvanced: committed.every(packet => packet.sourceRevision === request.nextSourceRevision),
                representationAdvanced: committed.every((packet, index) => (
                    packet.representationRevision === beforePackets[index].representationRevision + 1
                )),
            };
            const balanced = {
                mass: scalarBalanced(before.massKg, after.massKg, residual.massKg, tolerance),
                firstMassMoment: vectorBalanced(
                    before.firstMassMomentKgM,
                    after.firstMassMomentKgM,
                    residual.firstMassMomentKgM,
                    tolerance,
                ),
                linearMomentum: vectorBalanced(
                    before.linearMomentumKgMPerS,
                    after.linearMomentumKgMPerS,
                    residual.linearMomentumKgMPerS,
                    tolerance,
                ),
                angularMomentum: vectorBalanced(
                    before.angularMomentumKgM2PerS,
                    after.angularMomentumKgM2PerS,
                    residual.angularMomentumKgM2PerS,
                    tolerance,
                ),
                energy: scalarBalanced(
                    request.internalEnergyDeltaJ,
                    residual.totalEnergyJ,
                    residual.totalEnergyJ - request.internalEnergyDeltaJ,
                    tolerance,
                ),
                representedVolume: scalarBalanced(
                    before.representedVolumeM3,
                    after.representedVolumeM3,
                    residual.representedVolumeM3,
                    tolerance,
                ),
            };
            balanced.all = Object.values(balanced).every(Boolean)
                && Object.values(identities).every(Boolean)
                && Object.values(revisions).every(Boolean);
            const receipt = deepFreezeJson({
                schema: MATTER_PACKET_PHASE_REBIND_RECEIPT_SCHEMA,
                schemaVersion: MATTER_PACKET_PHASE_REBIND_RECEIPT_VERSION,
                regionId: request.regionId,
                fromPhase: request.fromPhase,
                toPhase: request.toPhase,
                internalEnergyDeltaJ: request.internalEnergyDeltaJ,
                sourceRevision: {
                    before: request.expectedSourceRevision,
                    after: request.nextSourceRevision,
                },
                packetRevisions: committed.map((packet, index) => ({
                    handle: packet.handle,
                    lineageId: packet.lineage.id,
                    representationRevision: {
                        before: beforePackets[index].representationRevision,
                        after: packet.representationRevision,
                    },
                })),
                identities,
                revisions,
                before,
                after,
                residual,
                tolerance,
                balanced,
            }, '$.matterPacketPhaseRebindReceipt');
            if (!receipt.balanced.all) {
                throw new MatterPacketCodecError(
                    MATTER_PACKET_CODEC_ERROR_CODES.CONSERVATION_FAILURE,
                    'Phase migration failed its conservation receipt',
                    { receipt },
                );
            }
            this.#log('debug', 'phase-rebind', {
                regionId: request.regionId,
                packetCount: committed.length,
                fromPhase: request.fromPhase,
                toPhase: request.toPhase,
            });
            return deepFreezeJson({ packets: committed, receipt }, '$.matterPacketPhaseRebindResult');
        } catch (error) {
            this.#log('error', 'phase-rebind-failed', { message: error.message });
            return this.#rollback(rollback, error);
        }
    }

    splitPacket(handle, optionsInput = {}) {
        this.#assertAlive();
        this.#log('debug', 'split-start');
        const options = normalizeOperationOptions(optionsInput);
        const parent = this.#lookup(handle);
        this.#verifyExpectedRevision([parent], options);
        if (parent.lineage.level >= MATTER_PACKET_MAX_LINEAGE_LEVEL) {
            throw new MatterPacketCodecError(
                MATTER_PACKET_CODEC_ERROR_CODES.LINEAGE_CONFLICT,
                `Packet lineage level ${parent.lineage.level} cannot be refined further`,
                { lineageId: parent.lineage.id, maximumLevel: MATTER_PACKET_MAX_LINEAGE_LEVEL },
            );
        }
        const lineages = Array.from({ length: 8 }, (_unused, ordinal) => childLineage(parent.lineage, ordinal));
        for (const lineage of lineages) {
            if (this.#lineageIds.has(lineage.id)) {
                throw new MatterPacketCodecError(
                    MATTER_PACKET_CODEC_ERROR_CODES.LINEAGE_CONFLICT,
                    `Active child lineage '${lineage.id}' already exists`,
                    { lineageId: lineage.id },
                );
            }
        }
        if (this.#store.freeSlotCount + 1 < 8) {
            this.#allocationFailures += 1;
            this.#log('warn', 'split-backpressure', { handle, freeSlots: this.#store.freeSlotCount });
            throw new MatterPacketCodecError(
                MATTER_PACKET_CODEC_ERROR_CODES.CAPACITY_EXHAUSTED,
                'Split requires seven net free packet slots',
                { requiredNetSlots: 7, freeSlots: this.#store.freeSlotCount },
            );
        }
        const representationRevision = parent.representationRevision + 1;
        if (!Number.isSafeInteger(representationRevision)) {
            throw new MatterPacketCodecError(
                MATTER_PACKET_CODEC_ERROR_CODES.REVISION_CONFLICT,
                'Representation revision cannot advance safely',
                { representationRevision: parent.representationRevision },
            );
        }
        const side = Math.cbrt(parent.representedVolumeM3);
        const offset = side * 0.25;
        const offsets = lineages.map((_lineage, ordinal) => [
            (ordinal & 1) === 0 ? -offset : offset,
            (ordinal & 2) === 0 ? -offset : offset,
            (ordinal & 4) === 0 ? -offset : offset,
        ]);
        const gradient = options.velocityGradientPerS ?? [0, 0, 0, 0, 0, 0, 0, 0, 0];
        const rawVelocityOffsets = offsets.map(childOffset => transformMatrix3(gradient, childOffset));
        const meanVelocityOffset = vectorScale(compensatedVector(rawVelocityOffsets), 1 / 8);
        const centeredVelocityOffsets = rawVelocityOffsets.map(value => vectorSubtract(value, meanVelocityOffset));
        const childMassKg = parent.massKg / 8;
        const requestedResolvedKineticJ = compensatedSum(centeredVelocityOffsets.map(value => (
            0.5 * childMassKg * squaredLength(value)
        )));
        const velocityScale = requestedResolvedKineticJ > parent.subgridEnergyJ && requestedResolvedKineticJ > 0
            ? Math.sqrt(parent.subgridEnergyJ / requestedResolvedKineticJ)
            : 1;
        const velocityOffsets = centeredVelocityOffsets.map(value => vectorScale(value, velocityScale));
        const resolvedKineticJ = compensatedSum(velocityOffsets.map(value => (
            0.5 * childMassKg * squaredLength(value)
        )));
        const orbitalAngularMomentum = compensatedVector(offsets.map((childOffset, ordinal) => (
            cross(childOffset, vectorScale(velocityOffsets[ordinal], childMassKg))
        )));
        const childInternalAngularMomentum = vectorScale(vectorSubtract(
            parent.angularMomentumKgM2PerS,
            orbitalAngularMomentum,
        ), 1 / 8);
        const remainingSubgridEnergyJ = Math.max(0, parent.subgridEnergyJ - resolvedKineticJ);
        const childrenData = lineages.map((lineage, ordinal) => packetData(createMatterPacketProjection({
            ...packetData(parent),
            handle: DUMMY_HANDLE,
            lineage,
            representationRevision,
            positionM: vectorAdd(parent.positionM, offsets[ordinal]),
            velocityMPerS: vectorAdd(parent.velocityMPerS, velocityOffsets[ordinal]),
            massKg: childMassKg,
            representedVolumeM3: parent.representedVolumeM3 / 8,
            angularMomentumKgM2PerS: childInternalAngularMomentum,
            thermalEnergyJ: parent.thermalEnergyJ / 8,
            elasticEnergyJ: parent.elasticEnergyJ / 8,
            subgridEnergyJ: remainingSubgridEnergyJ / 8,
        })));
        const rollback = this.snapshot();
        try {
            this.#store.release(parent.handle);
            this.#lineageIds.delete(parent.lineage.id);
            const childHandles = childrenData.map(data => {
                const childHandle = this.#allocate(data);
                this.#lineageIds.add(data.lineage.id);
                return childHandle;
            });
            const children = childHandles.map(childHandle => this.#lookup(childHandle));
            const receipt = createConservationReceipt({
                receiptId: `${this.#instanceId}.receipt.${this.#nextReceiptSequence}`,
                operation: 'split-1-to-8',
                beforePackets: [parent],
                afterPackets: children,
                tolerance: { absolute: this.#absoluteTolerance, relative: this.#relativeTolerance },
                volumePolicy: options.volumePolicy,
            });
            if (!receipt.balanced.all) {
                throw new MatterPacketCodecError(
                    MATTER_PACKET_CODEC_ERROR_CODES.CONSERVATION_FAILURE,
                    'Split failed its conservation receipt',
                    { receipt },
                );
            }
            this.#nextReceiptSequence += 1;
            this.#splitCount += 1;
            this.#log('debug', 'split', { parent: parent.handle, children: childHandles, receiptId: receipt.receiptId });
            return cloneAndFreezeStrictJson({ children: childHandles, receipt }, '$.splitResult');
        } catch (error) {
            this.#log('error', 'split-failed', { message: error.message, handle });
            return this.#rollback(rollback, error);
        }
    }

    mergePackets(handlesInput, optionsInput = {}) {
        this.#assertAlive();
        this.#log('debug', 'merge-start');
        const options = normalizeOperationOptions(optionsInput);
        const handles = cloneStrictJson(handlesInput, '$.handles');
        if (!Array.isArray(handles) || handles.length !== 8) failType('$.handles', 'must contain exactly eight handles');
        const children = handles.map(handle => this.#lookup(handle));
        const handleKeys = new Set(children.map(packet => (
            `${packet.handle.pageId}:${packet.handle.slot}:${packet.handle.generation}`
        )));
        if (handleKeys.size !== 8) failType('$.handles', 'must contain eight distinct handles');
        this.#verifyExpectedRevision(children, options);
        const reference = children[0];
        const incompatible = [];
        const exactFields = ['regionId', 'definitionId', 'phase', 'componentId', 'sourceRevision'];
        for (const field of exactFields) {
            if (children.some(packet => packet[field] !== reference[field])) incompatible.push(field);
        }
        if (children.some(packet => !compatibleJson(packet.damageState, reference.damageState))) incompatible.push('damageState');
        if (reference.lineage.level === 0 || children.some(packet => (
            packet.lineage.level !== reference.lineage.level
            || packet.lineage.rootId !== reference.lineage.rootId
            || packet.lineage.parentId !== reference.lineage.parentId
        ))) incompatible.push('lineage');
        const ordinals = children.map(packet => packet.lineage.childOrdinal).sort((left, right) => left - right);
        if (!ordinals.every((ordinal, index) => ordinal === index)) incompatible.push('childOrdinals');
        if (incompatible.length > 0) {
            throw new MatterPacketCodecError(
                MATTER_PACKET_CODEC_ERROR_CODES.INCOMPATIBLE_MERGE,
                `Packets cannot merge because ${[...new Set(incompatible)].join(', ')} differ`,
                { incompatible: [...new Set(incompatible)] },
            );
        }
        const orderedChildren = [...children].sort((left, right) => (
            left.lineage.childOrdinal - right.lineage.childOrdinal
        ));
        const lineage = parentLineage(orderedChildren);
        if (this.#lineageIds.has(lineage.id)) {
            throw new MatterPacketCodecError(
                MATTER_PACKET_CODEC_ERROR_CODES.LINEAGE_CONFLICT,
                `Parent lineage '${lineage.id}' is already active`,
                { lineageId: lineage.id },
            );
        }
        const summary = summarizePackets(orderedChildren);
        const velocityMPerS = vectorScale(summary.linearMomentumKgMPerS, 1 / summary.massKg);
        const thermalEnergyJ = compensatedSum(orderedChildren.map(packet => packet.thermalEnergyJ));
        const elasticEnergyJ = compensatedSum(orderedChildren.map(packet => packet.elasticEnergyJ));
        const coarseKineticJ = 0.5 * summary.massKg * squaredLength(velocityMPerS);
        let subgridEnergyJ = summary.energyJ.totalJ - coarseKineticJ - thermalEnergyJ - elasticEnergyJ;
        const energyTolerance = this.#absoluteTolerance
            + this.#relativeTolerance * Math.max(1, summary.energyJ.totalJ);
        if (subgridEnergyJ < 0 && Math.abs(subgridEnergyJ) <= energyTolerance) subgridEnergyJ = 0;
        if (subgridEnergyJ < 0) {
            throw new MatterPacketCodecError(
                MATTER_PACKET_CODEC_ERROR_CODES.CONSERVATION_FAILURE,
                'Merge produced a negative subgrid energy partition',
                { subgridEnergyJ },
            );
        }
        const representationRevision = Math.max(...orderedChildren.map(packet => packet.representationRevision)) + 1;
        if (!Number.isSafeInteger(representationRevision)) {
            throw new MatterPacketCodecError(
                MATTER_PACKET_CODEC_ERROR_CODES.REVISION_CONFLICT,
                'Representation revision cannot advance safely',
                { representationRevision: Math.max(...orderedChildren.map(packet => packet.representationRevision)) },
            );
        }
        const mergedData = packetData(createMatterPacketProjection({
            ...packetData(reference),
            handle: DUMMY_HANDLE,
            lineage,
            representationRevision,
            positionM: summary.centerOfMassM,
            velocityMPerS,
            massKg: summary.massKg,
            representedVolumeM3: summary.representedVolumeM3,
            angularMomentumKgM2PerS: summary.angularMomentumKgM2PerS,
            thermalEnergyJ,
            elasticEnergyJ,
            subgridEnergyJ,
        }));
        const rollback = this.snapshot();
        try {
            for (const child of orderedChildren) {
                this.#store.release(child.handle);
                this.#lineageIds.delete(child.lineage.id);
            }
            const mergedHandle = this.#allocate(mergedData);
            this.#lineageIds.add(lineage.id);
            const mergedPacket = this.#lookup(mergedHandle);
            const receipt = createConservationReceipt({
                receiptId: `${this.#instanceId}.receipt.${this.#nextReceiptSequence}`,
                operation: 'merge-8-to-1',
                beforePackets: orderedChildren,
                afterPackets: [mergedPacket],
                tolerance: { absolute: this.#absoluteTolerance, relative: this.#relativeTolerance },
                volumePolicy: options.volumePolicy,
            });
            if (!receipt.balanced.all) {
                throw new MatterPacketCodecError(
                    MATTER_PACKET_CODEC_ERROR_CODES.CONSERVATION_FAILURE,
                    'Merge failed its conservation receipt',
                    { receipt },
                );
            }
            this.#nextReceiptSequence += 1;
            this.#mergeCount += 1;
            this.#log('debug', 'merge', { children: handles, packet: mergedHandle, receiptId: receipt.receiptId });
            return cloneAndFreezeStrictJson({ packet: mergedHandle, receipt }, '$.mergeResult');
        } catch (error) {
            this.#log('error', 'merge-failed', { message: error.message });
            return this.#rollback(rollback, error);
        }
    }

    snapshot() {
        this.#assertAlive();
        return deepFreezeJson({
            schema: ADAPTIVE_MATTER_PACKET_CODEC_SNAPSHOT_SCHEMA,
            schemaVersion: ADAPTIVE_MATTER_PACKET_CODEC_SNAPSHOT_VERSION,
            instanceId: this.#instanceId,
            nextLineageSequence: this.#nextLineageSequence,
            nextReceiptSequence: this.#nextReceiptSequence,
            absoluteTolerance: this.#absoluteTolerance,
            relativeTolerance: this.#relativeTolerance,
            highWaterMark: this.#highWaterMark,
            allocationFailures: this.#allocationFailures,
            splitCount: this.#splitCount,
            mergeCount: this.#mergeCount,
            store: this.#store.snapshot(),
        }, '$.adaptiveMatterPacketCodecSnapshot');
    }

    restore(snapshot) {
        this.#assertAlive();
        this.#log('debug', 'restore-start');
        try {
            this.#restoreSnapshot(snapshot);
            return this;
        } catch (error) {
            this.#log('error', 'restore-failed', { message: error.message });
            throw error;
        }
    }

    stats() {
        return deepFreezeJson({
            schema: MATTER_PACKET_CODEC_STATS_SCHEMA,
            schemaVersion: MATTER_PACKET_CODEC_STATS_VERSION,
            pageSize: this.#store.pageSize,
            maxPages: this.#store.maxPages,
            allocatedPages: this.#store.allocatedPages,
            allocatedSlotCapacity: this.#store.allocatedSlotCapacity,
            maximumSlotCapacity: this.#store.maximumSlotCapacity,
            activePackets: this.#store.activeCount,
            freeSlots: this.#store.freeSlotCount,
            highWaterMark: this.#highWaterMark,
            estimatedResidentBytes: this.#store.estimatedResidentBytes(),
            allocationFailures: this.#allocationFailures,
            splitCount: this.#splitCount,
            mergeCount: this.#mergeCount,
            destroyed: this.#destroyed,
        }, '$.matterPacketCodecStats');
    }

    destroy() {
        if (this.#destroyed) return;
        this.#log('debug', 'destroy-start', { activePackets: this.#store.activeCount });
        this.#store.clear();
        this.#lineageIds.clear();
        this.#destroyed = true;
        this.#log('debug', 'destroy');
    }
}

export function createAdaptiveMatterPacketCodec(options = {}) {
    return new AdaptiveMatterPacketCodec(options);
}

export function restoreAdaptiveMatterPacketCodec(snapshot, options = {}) {
    if (!isPlainJsonObject(options)) failType('$.options', 'must be a plain object');
    const safeOptions = {};
    for (const key of Reflect.ownKeys(options)) {
        if (typeof key !== 'string' || !RESTORE_OPTION_KEYS.has(key)) failType(`$.options.${String(key)}`, 'unknown field');
        const descriptor = Object.getOwnPropertyDescriptor(options, key);
        if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
            failType(`$.options.${key}`, 'must be an enumerable data property');
        }
        safeOptions[key] = descriptor.value;
    }
    return new AdaptiveMatterPacketCodec({ ...safeOptions, snapshot });
}

export function summarizeMatterPackets(packets) {
    return cloneAndFreezeStrictJson(summarizePackets(packets), '$.matterPacketSummary');
}
