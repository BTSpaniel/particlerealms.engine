// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Composes adaptive SPH, sparse-grid projection, surfaces, and codec refinement. */

import {
    ADAPTIVE_FLUID_ERROR_CODES,
    AdaptiveFluidError,
    createAdaptiveFluidPacket,
    createAdaptiveFluidSecondary,
    fluidClone,
    fluidFinite,
    fluidFreeze,
    fluidInteger,
    logAdaptiveFluid,
    resolveAdaptiveFluidQualityProfile,
    summarizeAdaptiveFluidConservation,
    validateAdaptiveFluidMode,
} from './AdaptiveFluidContracts.js';
import {
    createSymmetricSphKernelProfile,
    stepAdaptiveSphReference,
} from './AdaptiveSphReference.js';
import {
    AdaptiveSphRefinementController,
} from './AdaptiveSphRefinementController.js';
import {
    SparseFluidBrickGrid,
} from './SparseFluidBrickGrid.js';
import {
    LocalFluidSurfaceCache,
} from './LocalFluidSurfaceCache.js';
import {
    AdaptiveFluidQualityGovernor,
} from './AdaptiveFluidQualityGovernor.js';

export const ADAPTIVE_MATTER_FLUID_SNAPSHOT_SCHEMA = 'engine.matter.adaptive-fluid-system-snapshot';
export const ADAPTIVE_MATTER_FLUID_SNAPSHOT_VERSION = '1.0.0';

const PHYSICAL_REJOIN_METADATA_KEYS = new Set([
    'smoothingRadiusM', 'targetNeighborRange', 'restDensityKgM3', 'temperatureK',
    'composition', 'gasFraction', 'boundaryDistanceM', 'predictedImpactSeconds',
    'inspectionWeight',
]);

function packetHandleKey(handle) {
    return `${handle?.pageId}:${handle?.slot}:${handle?.generation}`;
}

function packetMembershipKey(packet) {
    const packetId = packet?.lineage?.id ?? packet?.id;
    return JSON.stringify([
        packetId,
        packetHandleKey(packet?.handle),
        packet?.sourceRevision,
        packet?.representationRevision,
    ]);
}

function classificationCounts(metrics) {
    const counts = {
        bulk: 0,
        'near-surface': 0,
        surface: 0,
        spray: 0,
        droplet: 0,
        bubble: 0,
        'boundary-contact': 0,
    };
    for (const metric of metrics) counts[metric.classification] += 1;
    return counts;
}

function createScenarioPackets(countPerAxis, {
    idPrefix,
    resolutionLevel,
    sourceRevision,
    restDensityKgM3,
}) {
    const packets = [];
    const spacing = 1 / countPerAxis;
    const volume = spacing ** 3;
    for (let z = 0; z < countPerAxis; z += 1) {
        for (let y = 0; y < countPerAxis; y += 1) {
            for (let x = 0; x < countPerAxis; x += 1) {
                packets.push(createAdaptiveFluidPacket({
                    id: `${idPrefix}.${x}.${y}.${z}`,
                    regionId: 'region.dam-break-reference',
                    definitionId: 'matter.definition.water',
                    phase: 'liquid',
                    componentId: 'component.dam-water',
                    sourceRevision,
                    representationRevision: 0,
                    positionM: [
                        -1.25 + (x + 0.5) * spacing,
                        0.55 + (y + 0.5) * spacing,
                        -0.5 + (z + 0.5) * spacing,
                    ],
                    velocityMPerS: [0.65, 0, 0],
                    massKg: restDensityKgM3 * volume,
                    representedVolumeM3: volume,
                    smoothingRadiusM: spacing * 2.15,
                    resolutionLevel,
                    targetNeighborRange: [4, 48],
                    restDensityKgM3,
                    boundaryDistanceM: 2,
                }));
            }
        }
    }
    return packets;
}

export class AdaptiveMatterFluidSystem {
    #codec;
    #controller;
    #grid;
    #surfaceCache;
    #mode;
    #qualityProfile;
    #qualityGovernor;
    #kernelProfile;
    #renderOnlySecondary = new Map();
    #logger;
    #destroyed = false;
    #stepCount = 0;
    #deviceGeneration = 0;
    #lastFrame = null;

    constructor({
        codec,
        mode = 'adaptive-sph',
        qualityProfile = 'balanced',
        kernelProfile = {},
        grid = {},
        surface = {},
        logger = null,
        snapshot = null,
    } = {}) {
        if (typeof codec?.updatePacketKinematics !== 'function') {
            throw new TypeError('$.codec.updatePacketKinematics: required packet codec method is missing');
        }
        this.#codec = codec;
        this.#mode = validateAdaptiveFluidMode(mode);
        this.#qualityProfile = resolveAdaptiveFluidQualityProfile(qualityProfile).name;
        this.#kernelProfile = kernelProfile?.schema
            ? kernelProfile
            : createSymmetricSphKernelProfile(kernelProfile);
        this.#logger = logger;
        this.#qualityGovernor = new AdaptiveFluidQualityGovernor({
            qualityProfile: this.#qualityProfile,
            logger,
        });
        this.#controller = new AdaptiveSphRefinementController({
            codec,
            qualityProfile: this.#qualityGovernor.effectiveProfile,
            logger,
        });
        this.#grid = new SparseFluidBrickGrid({ ...grid, logger });
        this.#surfaceCache = new LocalFluidSurfaceCache({ ...surface, logger });
        logAdaptiveFluid(this.#logger, 'debug', 'fluid-system-initialize', {
            mode: this.#mode,
            qualityProfile: this.#qualityProfile,
            effectiveQualityProfile: this.#qualityGovernor.effectiveProfile,
        });
        if (snapshot) this.restore(snapshot);
    }

    #assertAlive() {
        if (this.#destroyed) {
            throw new AdaptiveFluidError(
                ADAPTIVE_FLUID_ERROR_CODES.DESTROYED,
                'Adaptive Matter Fluid system is destroyed',
            );
        }
    }

    registerCodecPacket(handle, metadata) {
        this.#assertAlive();
        return this.#controller.registerPacket(handle, metadata);
    }

    unregisterCodecPacket(handle) {
        this.#assertAlive();
        const packet = this.#codec.getPacket(handle);
        return this.#controller.unregisterPacket(packet.lineage.id);
    }

    registeredPacketIds() {
        this.#assertAlive();
        return this.#controller.registeredPacketIds();
    }

    updatePacketMetadata(packetId, changes) {
        this.#assertAlive();
        return this.#controller.updatePacketMetadata(packetId, changes);
    }

    updatePacketMetadataBatch(updates) {
        this.#assertAlive();
        return this.#controller.updatePacketMetadataBatch(updates);
    }

    /**
     * Test an observed packet set against both canonical codec residency and
     * this adapter's registered metadata. Handles and both revision domains
     * are included so a retired slot generation or a same-id phase/rebuild
     * cannot be mistaken for the packet generation this solver owns.
     */
    hasCurrentPacketMembership(packetInputs = null) {
        this.#assertAlive();
        const activePackets = [...this.#codec.listPackets()]
            .sort((left, right) => left.lineage.id.localeCompare(right.lineage.id));
        const registeredPacketIds = this.#controller.registeredPacketIds();
        if (activePackets.length !== registeredPacketIds.length
            || activePackets.some((packet, index) => (
                packet.lineage.id !== registeredPacketIds[index]
            ))) {
            return false;
        }
        if (packetInputs == null) return true;
        if (!Array.isArray(packetInputs) || packetInputs.length !== activePackets.length) {
            return false;
        }
        const observedKeys = packetInputs.map(packetMembershipKey).sort();
        const activeKeys = activePackets.map(packetMembershipKey).sort();
        return activeKeys.every((key, index) => key === observedKeys[index]);
    }

    /**
     * Atomically assimilate externally observed motion and invalidate each
     * affected packet-derived surface region once after the codec commits.
     */
    assimilatePacketKinematics(updates, options = {}) {
        this.#assertAlive();
        const beforeByHandle = new Map(this.#controller.packets().map(packet => [
            packetHandleKey(packet.handle),
            packet,
        ]));
        const committed = this.#codec.updatePacketKinematics(updates, options);
        const movedRegions = new Set();
        for (const packet of committed) {
            const before = beforeByHandle.get(
                packetHandleKey(packet.handle),
            );
            if (!before || before.positionM.some((value, axis) => value !== packet.positionM[axis])) {
                movedRegions.add(packet.regionId);
            }
        }
        for (const regionId of movedRegions) this.#surfaceCache.invalidateRegionProjection(regionId);
        logAdaptiveFluid(this.#logger, 'debug', 'fluid-kinematic-batch-assimilated', {
            packetCount: committed.length,
            invalidatedRegions: movedRegions.size,
        });
        return committed;
    }

    addSecondary(input, { codecHandle = null, fluidMetadata = null } = {}) {
        this.#assertAlive();
        const secondary = createAdaptiveFluidSecondary(input);
        if (secondary.mode === 'canonical-physical') {
            if (!codecHandle) {
                throw new TypeError('Canonical physical secondary matter requires a codec handle');
            }
            const codecPacket = this.#codec.getPacket(codecHandle);
            if (Math.abs(codecPacket.massKg - secondary.massKg) > 1e-10 * Math.max(1, secondary.massKg)) {
                throw new AdaptiveFluidError(
                    ADAPTIVE_FLUID_ERROR_CODES.CONSERVATION_FAILURE,
                    'Physical secondary record mass differs from its canonical codec packet',
                    { secondaryMassKg: secondary.massKg, packetMassKg: codecPacket.massKg },
                );
            }
            const packet = this.#controller.registerPacket(codecHandle, {
                ...fluidMetadata,
                secondaryKind: secondary.kind,
                secondaryMode: secondary.mode,
            });
            return packet;
        }
        if (this.#renderOnlySecondary.has(secondary.id)) {
            throw new RangeError(`Render-only secondary '${secondary.id}' already exists`);
        }
        this.#renderOnlySecondary.set(secondary.id, secondary);
        logAdaptiveFluid(this.#logger, 'debug', 'secondary-render-sample-add', {
            id: secondary.id,
            kind: secondary.kind,
        });
        return secondary;
    }

    removeRenderOnlySecondary(id) {
        this.#assertAlive();
        return this.#renderOnlySecondary.delete(id);
    }

    rejoinPhysicalSecondary(handle, metadataInput = {}) {
        this.#assertAlive();
        const started = globalThis.performance?.now?.() ?? Date.now();
        try {
            const metadata = fluidClone(metadataInput, '$.physicalSecondaryRejoin.metadata');
            if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) {
                throw new TypeError('$.physicalSecondaryRejoin.metadata: must be a plain object');
            }
            for (const key of Object.keys(metadata)) {
                if (!PHYSICAL_REJOIN_METADATA_KEYS.has(key)) {
                    throw new TypeError(`$.physicalSecondaryRejoin.metadata.${key}: unknown field`);
                }
            }
            const codecPacket = this.#codec.getPacket(handle);
            const current = this.#controller.packets().find(packet => packet.id === codecPacket.lineage.id);
            if (!current) {
                throw new RangeError(`Physical secondary '${codecPacket.lineage.id}' is not registered`);
            }
            if (current.secondaryMode !== 'canonical-physical' || current.secondaryKind === null) {
                throw new RangeError(`Packet '${codecPacket.lineage.id}' is not active physical secondary matter`);
            }
            const rejoined = this.#controller.updatePacketMetadata(codecPacket.lineage.id, {
                ...metadata,
                secondaryKind: null,
                secondaryMode: 'canonical-physical',
            });
            if (rejoined.handle.pageId !== codecPacket.handle.pageId
                || rejoined.handle.slot !== codecPacket.handle.slot
                || rejoined.handle.generation !== codecPacket.handle.generation
                || rejoined.massKg !== codecPacket.massKg
                || rejoined.representedVolumeM3 !== codecPacket.representedVolumeM3
                || rejoined.sourceRevision !== codecPacket.sourceRevision
                || rejoined.representationRevision !== codecPacket.representationRevision) {
                throw new AdaptiveFluidError(
                    ADAPTIVE_FLUID_ERROR_CODES.CONSERVATION_FAILURE,
                    'Physical secondary rejoin changed canonical packet ownership',
                    { packetId: codecPacket.lineage.id },
                );
            }
            logAdaptiveFluid(this.#logger, 'debug', 'secondary-physical-rejoined', {
                packetId: rejoined.id,
                previousKind: current.secondaryKind,
                durationMs: (globalThis.performance?.now?.() ?? Date.now()) - started,
            });
            return rejoined;
        } catch (error) {
            logAdaptiveFluid(this.#logger, 'error', 'secondary-physical-rejoin-error', {
                message: error.message,
                durationMs: (globalThis.performance?.now?.() ?? Date.now()) - started,
            });
            throw error;
        }
    }

    analyze({ timeSeconds = 0, ...options } = {}) {
        this.#assertAlive();
        return this.#controller.analyze({
            timeSeconds,
            kernelProfile: this.#kernelProfile,
            ...options,
        });
    }

    step({
        timeSeconds,
        dtSeconds,
        applyRefinement = true,
        pressureScale = 1,
        pressureIterations = null,
        viscosity = 0.015,
        surfaceTensionNPerM = 0,
        gravityMPerS2 = [0, -9.81, 0],
        bounds = null,
        transferMode = 'flip-pic',
        flipRatio = 0.95,
        targetPhysicalPackets = null,
        forceTargetCoarsening = false,
    } = {}) {
        this.#assertAlive();
        const time = fluidFinite(timeSeconds, '$.timeSeconds', { minimum: 0 });
        const dt = fluidFinite(dtSeconds, '$.dtSeconds', { minimum: Number.MIN_VALUE, maximum: 0.1 });
        const requestedPressureIterations = pressureIterations == null
            ? null
            : fluidInteger(pressureIterations, '$.pressureIterations', { minimum: 1, maximum: 256 });
        logAdaptiveFluid(this.#logger, 'debug', 'fluid-system-step-start', {
            mode: this.#mode,
            timeSeconds: time,
            dtSeconds: dt,
        });
        const refinementCapacity = () => {
            const freeSlots = this.#codec.stats?.().freeSlots;
            return Number.isInteger(freeSlots) && freeSlots >= 0
                ? Math.min(32, Math.floor(freeSlots / 7))
                : 32;
        };
        let adaptive = this.#controller.analyze({
            timeSeconds: time,
            kernelProfile: this.#kernelProfile,
            targetPhysicalPackets,
            forceTargetCoarsening,
            maximumSplits: refinementCapacity(),
        });
        let refinement = null;
        if (applyRefinement && this.#mode !== 'uniform-reference'
            && (adaptive.plan.split.length || adaptive.plan.merge.length)) {
            refinement = this.#controller.applyPlan(adaptive.plan, { timeSeconds: time });
            adaptive = this.#controller.analyze({
                timeSeconds: time,
                kernelProfile: this.#kernelProfile,
                targetPhysicalPackets,
                forceTargetCoarsening,
                maximumSplits: refinementCapacity(),
            });
        }
        const sphStep = stepAdaptiveSphReference(adaptive.packets, {
            dtSeconds: dt,
            gravityMPerS2,
            viscosity,
            pressureScale,
            surfaceTensionNPerM,
            bounds,
            qualityProfile: this.#qualityGovernor.effectiveProfile,
            kernelProfile: this.#kernelProfile,
            preparedAnalysis: adaptive.analysis,
            logger: this.#logger,
        });
        let grid = null;
        let projectedPackets = sphStep.packets;
        if (this.#mode === 'particle-grid') {
            // Hybrid is a sequential composition: local SPH advances once,
            // then the sparse grid consumes that result. Feeding the original
            // packets here discarded the SPH work while still paying for it.
            const sourceRevision = sphStep.packets[0].sourceRevision;
            const scatter = this.#grid.scatterPackets(sphStep.packets, { sourceRevision });
            const profile = resolveAdaptiveFluidQualityProfile(this.#qualityGovernor.effectiveProfile);
            const iterationCount = requestedPressureIterations == null
                ? profile.pressureIterations
                : requestedPressureIterations;
            const solve = this.#grid.solvePressureDivergence({
                sourceRevision,
                dtSeconds: dt,
                restDensityKgM3: adaptive.packets[0].restDensityKgM3,
                iterations: iterationCount,
            });
            const gather = this.#grid.gatherToPackets(sphStep.packets, {
                sourceRevision,
                transferMode,
                flipRatio,
            });
            projectedPackets = gather.packets;
            grid = { scatter, solve, gather: gather.receipt };
        }
        this.assimilatePacketKinematics(projectedPackets.map(packet => ({
            handle: packet.handle,
            positionM: packet.positionM,
            velocityMPerS: packet.velocityMPerS,
        })));
        projectedPackets = this.#controller.packets();
        this.#stepCount += 1;
        const classifications = classificationCounts(adaptive.analysis.metrics);
        this.#lastFrame = fluidFreeze({
            step: this.#stepCount,
            timeSeconds: time,
            dtSeconds: dt,
            mode: this.#mode,
            qualityProfile: this.#qualityProfile,
            effectiveQualityProfile: this.#qualityGovernor.effectiveProfile,
            physicalPackets: adaptive.packets.length,
            renderOnlySecondary: this.#renderOnlySecondary.size,
            classifications,
            splitCandidates: adaptive.plan.split.length,
            mergeCandidates: adaptive.plan.merge.length,
            transitionProjections: adaptive.shells.projections.length,
            meanDensityError: adaptive.analysis.summary.meanDensityError,
            maximumDensityError: adaptive.analysis.summary.maximumDensityError,
            meanNeighbors: adaptive.analysis.summary.meanNeighbors,
            maximumNeighbors: adaptive.analysis.summary.maximumNeighbors,
            neighborSearch: adaptive.analysis.summary.neighborSearch,
            neighborPairs: adaptive.analysis.summary.pairCount,
            neighborCandidatePairs: adaptive.analysis.summary.candidatePairCount,
            occupiedNeighborCells: adaptive.analysis.summary.occupiedNeighborCells,
            pressureIterations: grid?.solve?.iterations ?? 0,
            gridBricks: this.#grid.stats().allocatedBricks,
            localDistanceTiles: this.#surfaceCache.stats().activeTiles,
            neighborAnalysisReused: sphStep.analysisReused,
        }, '$.adaptiveMatterFluidFrameDiagnostics');
        logAdaptiveFluid(this.#logger, 'debug', 'fluid-system-step-complete', this.#lastFrame);
        return Object.freeze({
            projectedPackets,
            analysis: adaptive.analysis,
            plan: adaptive.plan,
            shells: adaptive.shells,
            refinement,
            sphReceipt: sphStep.receipt,
            grid,
            diagnostics: this.#lastFrame,
        });
    }

    buildLocalSurfaceTile(options) {
        this.#assertAlive();
        return this.#surfaceCache.buildTile({
            ...options,
            packets: options.packets ?? this.#controller.packets(),
            resolution: options.resolution
                ?? resolveAdaptiveFluidQualityProfile(
                    this.#qualityGovernor.effectiveProfile,
                ).surfaceTileResolution,
        });
    }

    sampleLocalSurface(tileId, positionM, revision) {
        this.#assertAlive();
        return this.#surfaceCache.sample(tileId, positionM, revision);
    }

    invalidateLocalSurfaces(regionId, sourceRevision) {
        this.#assertAlive();
        return this.#surfaceCache.invalidateRegion(regionId, sourceRevision);
    }

    setMode(mode) {
        this.#assertAlive();
        const previous = this.#mode;
        this.#mode = validateAdaptiveFluidMode(mode);
        logAdaptiveFluid(this.#logger, 'info', 'fluid-mode-change', { previous, current: this.#mode });
        return this.#mode;
    }

    setQualityProfile(profile) {
        this.#assertAlive();
        const previous = this.#qualityProfile;
        this.#qualityProfile = resolveAdaptiveFluidQualityProfile(profile).name;
        const state = this.#qualityGovernor.setProfile(this.#qualityProfile);
        this.#controller.setQualityProfile(state.effectiveProfile);
        logAdaptiveFluid(this.#logger, 'info', 'fluid-quality-change', {
            previous,
            current: this.#qualityProfile,
        });
        return this.#qualityProfile;
    }

    updateQualityBudget(metrics) {
        this.#assertAlive();
        const previous = this.#qualityGovernor.effectiveProfile;
        const state = this.#qualityGovernor.update(metrics);
        if (state.effectiveProfile !== previous) {
            this.#controller.setQualityProfile(state.effectiveProfile);
        }
        return state;
    }

    snapshot() {
        this.#assertAlive();
        return fluidFreeze({
            schema: ADAPTIVE_MATTER_FLUID_SNAPSHOT_SCHEMA,
            schemaVersion: ADAPTIVE_MATTER_FLUID_SNAPSHOT_VERSION,
            mode: this.#mode,
            qualityProfile: this.#qualityProfile,
            qualityGovernor: this.#qualityGovernor.snapshot(),
            kernelProfile: this.#kernelProfile,
            stepCount: this.#stepCount,
            deviceGeneration: this.#deviceGeneration,
            lastFrame: this.#lastFrame,
            controller: this.#controller.snapshot(),
            grid: this.#grid.snapshot(),
            surfaceCache: this.#surfaceCache.snapshot(),
            renderOnlySecondary: [...this.#renderOnlySecondary.values()]
                .sort((left, right) => left.id.localeCompare(right.id)),
        }, '$.adaptiveMatterFluidSystemSnapshot');
    }

    restore(snapshotInput) {
        this.#assertAlive();
        const snapshot = fluidClone(snapshotInput, '$.adaptiveMatterFluidSystemSnapshot');
        if (snapshot.schema !== ADAPTIVE_MATTER_FLUID_SNAPSHOT_SCHEMA
            || snapshot.schemaVersion !== ADAPTIVE_MATTER_FLUID_SNAPSHOT_VERSION) {
            throw new TypeError('$.adaptiveMatterFluidSystemSnapshot: unsupported schema or version');
        }
        const rollback = this.snapshot();
        try {
            this.#mode = validateAdaptiveFluidMode(snapshot.mode);
            this.#qualityProfile = resolveAdaptiveFluidQualityProfile(snapshot.qualityProfile).name;
            this.#kernelProfile = createSymmetricSphKernelProfile(snapshot.kernelProfile);
            this.#qualityGovernor.restore(snapshot.qualityGovernor);
            this.#controller.restore(snapshot.controller);
            this.#grid.restore(snapshot.grid);
            this.#surfaceCache.restore(snapshot.surfaceCache);
            const restoredSecondary = new Map();
            for (const value of snapshot.renderOnlySecondary) {
                const secondary = createAdaptiveFluidSecondary(value);
                if (restoredSecondary.has(secondary.id)) {
                    throw new TypeError(`Duplicate render-only secondary '${secondary.id}'`);
                }
                restoredSecondary.set(secondary.id, secondary);
            }
            this.#renderOnlySecondary = restoredSecondary;
            this.#stepCount = fluidInteger(snapshot.stepCount, '$.stepCount');
            this.#deviceGeneration = fluidInteger(snapshot.deviceGeneration, '$.deviceGeneration');
            this.#lastFrame = snapshot.lastFrame;
            logAdaptiveFluid(this.#logger, 'debug', 'fluid-system-restore', {
                mode: this.#mode,
                packets: this.#controller.stats().trackedPackets,
            });
            return this;
        } catch (error) {
            if (rollback.controller) {
                this.#mode = rollback.mode;
                this.#qualityProfile = rollback.qualityProfile;
                this.#kernelProfile = rollback.kernelProfile;
                this.#qualityGovernor.restore(rollback.qualityGovernor);
                this.#controller.restore(rollback.controller);
                this.#grid.restore(rollback.grid);
                this.#surfaceCache.restore(rollback.surfaceCache);
                this.#renderOnlySecondary = new Map(rollback.renderOnlySecondary.map(value => [value.id, value]));
                this.#stepCount = rollback.stepCount;
                this.#deviceGeneration = rollback.deviceGeneration;
                this.#lastFrame = rollback.lastFrame;
            }
            throw error;
        }
    }

    recreateDeviceData(deviceGeneration) {
        this.#assertAlive();
        this.#deviceGeneration = fluidInteger(deviceGeneration, '$.deviceGeneration');
        const grid = this.#grid.setDeviceGeneration(deviceGeneration);
        const surfaces = this.#surfaceCache.setDeviceGeneration(deviceGeneration);
        const plan = fluidFreeze({
            schema: 'engine.matter.adaptive-fluid-device-recreation-plan',
            schemaVersion: '1.0.0',
            deviceGeneration,
            deterministicCpuSnapshotRequired: true,
            packetCodecSnapshot: this.#codec.snapshot(),
            grid,
            surfaces,
        }, '$.adaptiveMatterFluidDeviceRecreationPlan');
        logAdaptiveFluid(this.#logger, 'info', 'fluid-device-recreation-plan', {
            deviceGeneration,
            gridBricks: grid.allocatedBricks,
            surfaceTiles: surfaces.tiles,
        });
        return plan;
    }

    diagnostics() {
        this.#assertAlive();
        const packets = this.#controller.packets();
        const conservation = summarizeAdaptiveFluidConservation(packets);
        const grid = this.#grid.stats();
        const surfaces = this.#surfaceCache.stats();
        return fluidFreeze({
            schema: 'engine.matter.adaptive-fluid-diagnostics',
            schemaVersion: '1.0.0',
            mode: this.#mode,
            qualityProfile: this.#qualityProfile,
            effectiveQualityProfile: this.#qualityGovernor.effectiveProfile,
            qualityGovernor: this.#qualityGovernor.state(false),
            physicalPackets: packets.length,
            renderedSecondarySamples: this.#renderOnlySecondary.size,
            canonicalMassKg: conservation.massKg,
            representedVolumeM3: conservation.representedVolumeM3,
            gridOwnedMassKg: 0,
            grid,
            surfaces,
            refinement: this.#controller.stats(),
            stepCount: this.#stepCount,
            deviceGeneration: this.#deviceGeneration,
            lastFrame: this.#lastFrame,
        }, '$.adaptiveMatterFluidDiagnostics');
    }

    destroy() {
        if (this.#destroyed) return;
        // Teardown must remain total when another canonical owner has already
        // replaced packet membership. `diagnostics()` intentionally fails
        // closed for that stale state, so log only lifecycle-safe counters here.
        logAdaptiveFluid(this.#logger, 'debug', 'fluid-system-destroy', {
            mode: this.#mode,
            stepCount: this.#stepCount,
            trackedPackets: this.#controller.stats().trackedPackets,
            activeCodecPackets: this.#codec.stats?.().activePackets
                ?? this.#codec.listPackets().length,
        });
        this.#controller.destroy();
        this.#grid.destroy();
        this.#surfaceCache.destroy();
        this.#qualityGovernor.destroy();
        this.#renderOnlySecondary.clear();
        this.#destroyed = true;
    }
}

export function createAdaptiveMatterFluidSystem(options) {
    return new AdaptiveMatterFluidSystem(options);
}

export function restoreAdaptiveMatterFluidSystem(snapshot, { codec, logger = null } = {}) {
    return new AdaptiveMatterFluidSystem({
        codec,
        mode: snapshot.mode,
        qualityProfile: snapshot.qualityProfile,
        kernelProfile: snapshot.kernelProfile,
        grid: {
            cellSizeM: snapshot.grid.cellSizeM,
            brickSize: snapshot.grid.brickSize,
            maxBricks: snapshot.grid.maxBricks,
        },
        surface: {
            maxTiles: snapshot.surfaceCache.maxTiles,
            maxVoxelsPerTile: snapshot.surfaceCache.maxVoxelsPerTile,
        },
        logger,
        snapshot,
    });
}

/**
 * Early dam-break macro oracle. Internal SPH forces may differ by resolution,
 * but mass, volume, center-of-mass motion, and net momentum must remain close.
 */
export function runAdaptiveDamBreakMacroComparison({
    steps = 8,
    dtSeconds = 1 / 120,
    restDensityKgM3 = 1000,
} = {}) {
    const stepCount = fluidInteger(steps, '$.steps', { minimum: 1, maximum: 120 });
    const dt = fluidFinite(dtSeconds, '$.dtSeconds', { minimum: 1 / 10_000, maximum: 0.05 });
    const density = fluidFinite(restDensityKgM3, '$.restDensityKgM3', { minimum: 1 });
    let uniform = createScenarioPackets(4, {
        idPrefix: 'uniform', resolutionLevel: 2, sourceRevision: 1, restDensityKgM3: density,
    });
    let adaptive = createScenarioPackets(2, {
        idPrefix: 'adaptive', resolutionLevel: 1, sourceRevision: 1, restDensityKgM3: density,
    });
    const bounds = { min: [-2, 0, -1], max: [2, 3, 1] };
    for (let step = 0; step < stepCount; step += 1) {
        uniform = stepAdaptiveSphReference(uniform, {
            dtSeconds: dt,
            pressureScale: 0.2,
            viscosity: 0.01,
            bounds,
            qualityProfile: 'scientific',
        }).packets;
        adaptive = stepAdaptiveSphReference(adaptive, {
            dtSeconds: dt,
            pressureScale: 0.2,
            viscosity: 0.01,
            bounds,
            qualityProfile: 'balanced',
        }).packets;
    }
    const uniformSummary = summarizeAdaptiveFluidConservation(uniform);
    const adaptiveSummary = summarizeAdaptiveFluidConservation(adaptive);
    const centerOfMassDeltaM = uniformSummary.centerOfMassM.map((value, axis) => (
        adaptiveSummary.centerOfMassM[axis] - value
    ));
    const momentumDeltaKgMPerS = uniformSummary.linearMomentumKgMPerS.map((value, axis) => (
        adaptiveSummary.linearMomentumKgMPerS[axis] - value
    ));
    return fluidFreeze({
        schema: 'engine.matter.adaptive-dam-break-comparison',
        schemaVersion: '1.0.0',
        steps: stepCount,
        dtSeconds: dt,
        uniform: uniformSummary,
        adaptive: adaptiveSummary,
        centerOfMassDeltaM,
        momentumDeltaKgMPerS,
        representedVolumeDeltaM3: adaptiveSummary.representedVolumeM3
            - uniformSummary.representedVolumeM3,
        activePacketReduction: 1 - adaptive.length / uniform.length,
    }, '$.adaptiveDamBreakComparison');
}
