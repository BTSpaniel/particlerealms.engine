// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Atomic adapter between SPH refinement policy and the canonical packet codec. */

import {
    ADAPTIVE_FLUID_ERROR_CODES,
    AdaptiveFluidError,
    createAdaptiveFluidPacket,
    fluidClone,
    fluidFreeze,
    fluidIdentifier,
    logAdaptiveFluid,
    resolveAdaptiveFluidQualityProfile,
} from './AdaptiveFluidContracts.js';
import {
    ADAPTIVE_SPH_REFINEMENT_SCHEMA,
    analyzeAdaptiveSphPackets,
    createAdaptiveSphRefinementPlan,
    createAdaptiveSphTransitionShells,
} from './AdaptiveSphReference.js';

export const ADAPTIVE_SPH_CONTROLLER_SNAPSHOT_SCHEMA = 'engine.matter.adaptive-sph-controller-snapshot';
export const ADAPTIVE_SPH_CONTROLLER_SNAPSHOT_VERSION = '1.0.0';

function assertCodec(codec) {
    for (const method of ['getPacket', 'listPackets', 'splitPacket', 'mergePackets', 'snapshot', 'restore']) {
        if (typeof codec?.[method] !== 'function') {
            throw new TypeError(`$.codec.${method}: required packet codec method is missing`);
        }
    }
    return codec;
}

function packetMetadata(input = {}) {
    return {
        smoothingRadiusM: input.smoothingRadiusM ?? null,
        targetNeighborRange: input.targetNeighborRange ?? [16, 34],
        restDensityKgM3: input.restDensityKgM3 ?? null,
        temperatureK: input.temperatureK ?? 293.15,
        composition: input.composition ?? null,
        gasFraction: input.gasFraction ?? 0,
        secondaryKind: input.secondaryKind ?? null,
        secondaryMode: input.secondaryMode ?? 'canonical-physical',
        boundaryDistanceM: input.boundaryDistanceM ?? Number.MAX_VALUE,
        predictedImpactSeconds: input.predictedImpactSeconds ?? Number.MAX_VALUE,
        inspectionWeight: input.inspectionWeight ?? 0,
    };
}

function packetFromCodec(codecPacket, metadata) {
    return createAdaptiveFluidPacket({
        id: codecPacket.lineage.id,
        handle: codecPacket.handle,
        regionId: codecPacket.regionId,
        definitionId: codecPacket.definitionId,
        phase: codecPacket.phase,
        componentId: codecPacket.componentId,
        sourceRevision: codecPacket.sourceRevision,
        representationRevision: codecPacket.representationRevision,
        positionM: codecPacket.positionM,
        velocityMPerS: codecPacket.velocityMPerS,
        massKg: codecPacket.massKg,
        representedVolumeM3: codecPacket.representedVolumeM3,
        resolutionLevel: codecPacket.lineage.level,
        canonicalMassOwner: true,
        ...metadata,
        smoothingRadiusM: metadata.smoothingRadiusM
            ?? Math.cbrt(codecPacket.representedVolumeM3) * 2,
        restDensityKgM3: metadata.restDensityKgM3
            ?? codecPacket.massKg / codecPacket.representedVolumeM3,
        composition: metadata.composition ?? { [codecPacket.definitionId]: 1 },
    });
}

export class AdaptiveSphRefinementController {
    #codec;
    #metadata = new Map();
    #residencyState = {
        schema: 'engine.matter.adaptive-sph-residency',
        schemaVersion: '1.0.0',
        records: {},
    };
    #qualityProfile;
    #logger;
    #destroyed = false;
    #transactions = 0;
    #rollbacks = 0;
    #lastPlan = null;

    constructor({ codec, qualityProfile = 'balanced', logger = null, snapshot = null } = {}) {
        this.#codec = assertCodec(codec);
        this.#qualityProfile = resolveAdaptiveFluidQualityProfile(qualityProfile).name;
        this.#logger = logger;
        logAdaptiveFluid(this.#logger, 'debug', 'refinement-controller-initialize', {
            qualityProfile: this.#qualityProfile,
        });
        if (snapshot) this.restore(snapshot);
    }

    #assertAlive() {
        if (this.#destroyed) {
            throw new AdaptiveFluidError(
                ADAPTIVE_FLUID_ERROR_CODES.DESTROYED,
                'Adaptive SPH refinement controller is destroyed',
            );
        }
    }

    registerPacket(handle, metadataInput = {}) {
        this.#assertAlive();
        const codecPacket = this.#codec.getPacket(handle);
        const metadata = packetMetadata(metadataInput);
        const packet = packetFromCodec(codecPacket, metadata);
        this.#metadata.set(packet.id, fluidClone(metadata, '$.fluidMetadata'));
        logAdaptiveFluid(this.#logger, 'debug', 'refinement-register', {
            packetId: packet.id,
            resolutionLevel: packet.resolutionLevel,
        });
        return packet;
    }

    unregisterPacket(packetIdInput) {
        this.#assertAlive();
        const packetId = fluidIdentifier(packetIdInput, '$.packetId');
        if (!this.#metadata.has(packetId)) return false;
        this.#metadata.delete(packetId);
        delete this.#residencyState.records[packetId];
        logAdaptiveFluid(this.#logger, 'debug', 'refinement-unregister', { packetId });
        return true;
    }

    registeredPacketIds() {
        this.#assertAlive();
        return Object.freeze([...this.#metadata.keys()].sort((left, right) => left.localeCompare(right)));
    }

    updatePacketMetadata(packetId, changes = {}) {
        return this.updatePacketMetadataBatch([{ packetId, changes }])[0];
    }

    /** Validate a complete metadata batch against one codec snapshot, then commit it atomically. */
    updatePacketMetadataBatch(updatesInput = []) {
        this.#assertAlive();
        if (!Array.isArray(updatesInput) || updatesInput.length > this.#metadata.size) {
            throw new RangeError(`$.updates: must contain at most ${this.#metadata.size} packet updates`);
        }
        const activeById = new Map(
            this.#codec.listPackets().map(packet => [packet.lineage.id, packet]),
        );
        const seen = new Set();
        const candidates = updatesInput.map((update, index) => {
            if (!update || typeof update !== 'object' || Array.isArray(update)) {
                throw new TypeError(`$.updates[${index}]: must be an object`);
            }
            const packetId = fluidIdentifier(update.packetId, `$.updates[${index}].packetId`);
            if (seen.has(packetId)) throw new RangeError(`Duplicate packet metadata update '${packetId}'`);
            seen.add(packetId);
            const current = this.#metadata.get(packetId);
            if (!current) throw new RangeError(`Unknown adaptive SPH packet '${packetId}'`);
            const codecPacket = activeById.get(packetId);
            if (!codecPacket) throw new RangeError(`Codec packet '${packetId}' is no longer active`);
            const changes = fluidClone(update.changes ?? {}, `$.updates[${index}].changes`);
            const next = packetMetadata({ ...current, ...changes });
            return { packetId, next, validated: packetFromCodec(codecPacket, next) };
        });
        for (const candidate of candidates) {
            this.#metadata.set(
                candidate.packetId,
                fluidClone(candidate.next, '$.fluidMetadata'),
            );
        }
        logAdaptiveFluid(this.#logger, 'debug', 'refinement-metadata-batch', {
            packetCount: candidates.length,
        });
        return Object.freeze(candidates.map(candidate => candidate.validated));
    }

    packets() {
        this.#assertAlive();
        const activeById = new Map(this.#codec.listPackets().map(packet => [packet.lineage.id, packet]));
        return this.registeredPacketIds().map(packetId => {
            const codecPacket = activeById.get(packetId);
            if (!codecPacket) {
                throw new AdaptiveFluidError(
                    ADAPTIVE_FLUID_ERROR_CODES.STALE_PROJECTION,
                    `Registered adaptive SPH packet '${packetId}' is no longer active`,
                    { packetId },
                );
            }
            const metadata = this.#metadata.get(packetId);
            return packetFromCodec(codecPacket, metadata);
        }).sort((left, right) => left.id.localeCompare(right.id));
    }

    analyze({ timeSeconds = 0, ...options } = {}) {
        this.#assertAlive();
        const packets = this.packets();
        const analysis = analyzeAdaptiveSphPackets(packets, {
            qualityProfile: this.#qualityProfile,
            logger: this.#logger,
            ...options,
        });
        const plan = createAdaptiveSphRefinementPlan(analysis, {
            qualityProfile: this.#qualityProfile,
            timeSeconds,
            residencyState: this.#residencyState,
            ...options,
        });
        this.#residencyState = fluidClone(plan.residencyState, '$.residencyState');
        this.#lastPlan = plan;
        const shells = createAdaptiveSphTransitionShells(packets, analysis, {
            shellWidth: resolveAdaptiveFluidQualityProfile(this.#qualityProfile).transitionShellWidth,
        });
        return Object.freeze({ packets, analysis, plan, shells });
    }

    applyPlan(plan, { timeSeconds = plan?.timeSeconds ?? 0 } = {}) {
        this.#assertAlive();
        if (plan?.schema !== ADAPTIVE_SPH_REFINEMENT_SCHEMA) {
            throw new TypeError('$.plan: must be an adaptive SPH refinement plan');
        }
        const codecSnapshot = this.#codec.snapshot();
        const metadataSnapshot = [...this.#metadata.entries()].map(([id, value]) => [id, fluidClone(value)]);
        const residencySnapshot = fluidClone(this.#residencyState);
        const receipts = [];
        const splitIds = new Set(plan.split.map(entry => entry.id));
        logAdaptiveFluid(this.#logger, 'debug', 'refinement-transaction-start', {
            splits: plan.split.length,
            merges: plan.merge.length,
        });
        try {
            for (const merge of plan.merge) {
                if (merge.childIds.some(id => splitIds.has(id))) continue;
                const activeById = new Map(this.#codec.listPackets().map(packet => [packet.lineage.id, packet]));
                const children = merge.childIds.map(id => activeById.get(id));
                if (children.some(packet => !packet)) continue;
                const childMetadata = merge.childIds.map(id => this.#metadata.get(id));
                if (childMetadata.some(value => !value)) continue;
                const result = this.#codec.mergePackets(children.map(packet => packet.handle), {
                    volumePolicy: 'preserve',
                });
                if (!result.receipt?.balanced?.all) {
                    throw new AdaptiveFluidError(
                        ADAPTIVE_FLUID_ERROR_CODES.CONSERVATION_FAILURE,
                        `Codec merge '${merge.parentId}' returned an unbalanced receipt`,
                        { receipt: result.receipt },
                    );
                }
                const minimumRadius = Math.min(...childMetadata.map(value => value.smoothingRadiusM));
                const parentMetadata = packetMetadata({
                    ...childMetadata[0],
                    smoothingRadiusM: minimumRadius * 2,
                });
                for (const id of merge.childIds) {
                    this.#metadata.delete(id);
                    delete this.#residencyState.records[id];
                }
                const parentPacket = this.#codec.getPacket(result.packet);
                this.#metadata.set(parentPacket.lineage.id, parentMetadata);
                this.#residencyState.records[parentPacket.lineage.id] = {
                    lowSinceSeconds: null,
                    lastTransitionSeconds: timeSeconds,
                };
                receipts.push(result.receipt);
            }
            for (const split of plan.split) {
                const activePacket = this.#codec.listPackets().find(packet => packet.lineage.id === split.id);
                const parentMetadata = this.#metadata.get(split.id);
                if (!activePacket || !parentMetadata) continue;
                const result = this.#codec.splitPacket(activePacket.handle, { volumePolicy: 'preserve' });
                if (!result.receipt?.balanced?.all) {
                    throw new AdaptiveFluidError(
                        ADAPTIVE_FLUID_ERROR_CODES.CONSERVATION_FAILURE,
                        `Codec split '${split.id}' returned an unbalanced receipt`,
                        { receipt: result.receipt },
                    );
                }
                this.#metadata.delete(split.id);
                delete this.#residencyState.records[split.id];
                for (const handle of result.children) {
                    const child = this.#codec.getPacket(handle);
                    this.#metadata.set(child.lineage.id, packetMetadata({
                        ...parentMetadata,
                        smoothingRadiusM: parentMetadata.smoothingRadiusM * 0.5,
                    }));
                    this.#residencyState.records[child.lineage.id] = {
                        lowSinceSeconds: null,
                        lastTransitionSeconds: timeSeconds,
                    };
                }
                receipts.push(result.receipt);
            }
            this.#transactions += 1;
            logAdaptiveFluid(this.#logger, 'debug', 'refinement-transaction-complete', {
                receipts: receipts.length,
                activePackets: this.#codec.stats?.().activePackets ?? this.#codec.listPackets().length,
            });
            return fluidFreeze({
                applied: receipts.length,
                receipts,
                activePacketIds: this.#codec.listPackets().map(packet => packet.lineage.id).sort(),
            }, '$.adaptiveSphAppliedPlan');
        } catch (error) {
            this.#codec.restore(codecSnapshot);
            this.#metadata = new Map(metadataSnapshot);
            this.#residencyState = residencySnapshot;
            this.#rollbacks += 1;
            logAdaptiveFluid(this.#logger, 'error', 'refinement-transaction-rollback', {
                message: error.message,
            });
            if (error instanceof AdaptiveFluidError) throw error;
            throw new AdaptiveFluidError(
                ADAPTIVE_FLUID_ERROR_CODES.TRANSACTION_FAILED,
                `Adaptive SPH refinement transaction rolled back: ${error.message}`,
                { causeCode: error.code ?? null },
            );
        }
    }

    setQualityProfile(profile) {
        this.#assertAlive();
        const previous = this.#qualityProfile;
        this.#qualityProfile = resolveAdaptiveFluidQualityProfile(profile).name;
        logAdaptiveFluid(this.#logger, 'info', 'refinement-quality-change', {
            previous,
            current: this.#qualityProfile,
        });
        return this.#qualityProfile;
    }

    snapshot() {
        this.#assertAlive();
        return fluidFreeze({
            schema: ADAPTIVE_SPH_CONTROLLER_SNAPSHOT_SCHEMA,
            schemaVersion: ADAPTIVE_SPH_CONTROLLER_SNAPSHOT_VERSION,
            qualityProfile: this.#qualityProfile,
            codec: this.#codec.snapshot(),
            metadata: [...this.#metadata.entries()]
                .map(([id, value]) => ({ id, value }))
                .sort((left, right) => left.id.localeCompare(right.id)),
            residencyState: this.#residencyState,
            transactions: this.#transactions,
            rollbacks: this.#rollbacks,
        }, '$.adaptiveSphControllerSnapshot');
    }

    restore(snapshotInput) {
        this.#assertAlive();
        const snapshot = fluidClone(snapshotInput, '$.adaptiveSphControllerSnapshot');
        if (snapshot.schema !== ADAPTIVE_SPH_CONTROLLER_SNAPSHOT_SCHEMA
            || snapshot.schemaVersion !== ADAPTIVE_SPH_CONTROLLER_SNAPSHOT_VERSION) {
            throw new TypeError('$.adaptiveSphControllerSnapshot: unsupported schema or version');
        }
        const rollback = {
            codec: this.#codec.snapshot(),
            qualityProfile: this.#qualityProfile,
            metadata: [...this.#metadata.entries()].map(([id, value]) => [id, fluidClone(value)]),
            residencyState: fluidClone(this.#residencyState),
            transactions: this.#transactions,
            rollbacks: this.#rollbacks,
        };
        try {
            this.#codec.restore(snapshot.codec);
            this.#qualityProfile = resolveAdaptiveFluidQualityProfile(snapshot.qualityProfile).name;
            const metadata = new Map();
            for (const entry of snapshot.metadata) {
                if (metadata.has(entry.id)) throw new TypeError(`Duplicate metadata '${entry.id}'`);
                metadata.set(entry.id, packetMetadata(entry.value));
            }
            this.#metadata = metadata;
            this.#residencyState = fluidClone(snapshot.residencyState);
            this.#transactions = Number(snapshot.transactions) || 0;
            this.#rollbacks = Number(snapshot.rollbacks) || 0;
            const restoredPackets = this.packets();
            if (restoredPackets.length !== this.#metadata.size) {
                throw new TypeError('Controller snapshot contains metadata for inactive codec packets');
            }
            logAdaptiveFluid(this.#logger, 'debug', 'refinement-controller-restore', {
                activePackets: this.#metadata.size,
            });
            return this;
        } catch (error) {
            this.#codec.restore(rollback.codec);
            this.#qualityProfile = rollback.qualityProfile;
            this.#metadata = new Map(rollback.metadata);
            this.#residencyState = rollback.residencyState;
            this.#transactions = rollback.transactions;
            this.#rollbacks = rollback.rollbacks;
            throw error;
        }
    }

    stats() {
        this.#assertAlive();
        return fluidFreeze({
            qualityProfile: this.#qualityProfile,
            trackedPackets: this.#metadata.size,
            transactions: this.#transactions,
            rollbacks: this.#rollbacks,
            lastPlanSplits: this.#lastPlan?.split.length ?? 0,
            lastPlanMerges: this.#lastPlan?.merge.length ?? 0,
        }, '$.adaptiveSphControllerStats');
    }

    destroy() {
        if (this.#destroyed) return;
        logAdaptiveFluid(this.#logger, 'debug', 'refinement-controller-destroy', {
            trackedPackets: this.#metadata.size,
        });
        this.#metadata.clear();
        this.#destroyed = true;
    }
}

export function createAdaptiveSphRefinementController(options) {
    return new AdaptiveSphRefinementController(options);
}
