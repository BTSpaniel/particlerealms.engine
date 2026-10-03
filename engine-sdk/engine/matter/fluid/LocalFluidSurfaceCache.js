// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Revision-bound local narrow-band surfaces and analytic boundary adapters. */

import {
    ADAPTIVE_FLUID_ERROR_CODES,
    AdaptiveFluidError,
    createAdaptiveFluidPacket,
    fluidClone,
    fluidFinite,
    fluidFreeze,
    fluidIdentifier,
    fluidInteger,
    fluidVector3,
    logAdaptiveFluid,
} from './AdaptiveFluidContracts.js';
import {
    dotVector3 as dot,
    normalizeVector3 as normalize,
    subtractVector3 as subtract,
    vector3Length as vectorLength,
} from './FluidReferenceMath.js';

export const LOCAL_FLUID_SURFACE_SNAPSHOT_SCHEMA = 'engine.matter.local-fluid-surface-cache-snapshot';
export const LOCAL_FLUID_SURFACE_SNAPSHOT_VERSION = '1.0.0';
export const LOCAL_FLUID_SURFACE_TILE_SCHEMA = 'engine.matter.local-fluid-surface-tile';
export const LOCAL_FLUID_SURFACE_TILE_VERSION = '1.0.0';


function boundaryDescriptor(input) {
    const source = fluidClone(input, '$.boundary');
    const type = source.type;
    if (!['sphere', 'box', 'plane'].includes(type)) {
        throw new RangeError(`$.boundary.type: unsupported analytic boundary '${type}'`);
    }
    const id = fluidIdentifier(source.id, '$.boundary.id');
    const revision = fluidInteger(source.revision ?? 0, '$.boundary.revision');
    if (type === 'sphere') {
        return fluidFreeze({
            id,
            type,
            revision,
            centerM: fluidVector3(source.centerM, '$.boundary.centerM'),
            radiusM: fluidFinite(source.radiusM, '$.boundary.radiusM', { minimum: Number.MIN_VALUE }),
        }, '$.boundary');
    }
    if (type === 'box') {
        const halfExtentsM = fluidVector3(source.halfExtentsM, '$.boundary.halfExtentsM');
        if (halfExtentsM.some(value => value <= 0)) {
            throw new RangeError('$.boundary.halfExtentsM: entries must be positive');
        }
        return fluidFreeze({
            id,
            type,
            revision,
            centerM: fluidVector3(source.centerM, '$.boundary.centerM'),
            halfExtentsM,
        }, '$.boundary');
    }
    return fluidFreeze({
        id,
        type,
        revision,
        normal: normalize(fluidVector3(source.normal, '$.boundary.normal')),
        offsetM: fluidFinite(source.offsetM ?? 0, '$.boundary.offsetM'),
    }, '$.boundary');
}

function boxDistance(descriptor, positionM) {
    const local = subtract(positionM, descriptor.centerM);
    const q = local.map((value, axis) => Math.abs(value) - descriptor.halfExtentsM[axis]);
    const outside = q.map(value => Math.max(value, 0));
    return vectorLength(outside) + Math.min(Math.max(q[0], q[1], q[2]), 0);
}

function boxNormal(descriptor, positionM) {
    const local = subtract(positionM, descriptor.centerM);
    const q = local.map((value, axis) => Math.abs(value) - descriptor.halfExtentsM[axis]);
    if (q.some(value => value > 0)) {
        const closest = local.map((value, axis) => (
            Math.max(-descriptor.halfExtentsM[axis], Math.min(descriptor.halfExtentsM[axis], value))
        ));
        return normalize(subtract(local, closest));
    }
    let axis = 0;
    if (q[1] > q[axis]) axis = 1;
    if (q[2] > q[axis]) axis = 2;
    const normal = [0, 0, 0];
    normal[axis] = local[axis] < 0 ? -1 : 1;
    return normal;
}

export function createAnalyticFluidBoundary(input) {
    const descriptor = boundaryDescriptor(input);
    const signedDistanceM = positionInput => {
        const positionM = fluidVector3(positionInput, '$.positionM');
        if (descriptor.type === 'sphere') {
            return vectorLength(subtract(positionM, descriptor.centerM)) - descriptor.radiusM;
        }
        if (descriptor.type === 'box') return boxDistance(descriptor, positionM);
        return dot(positionM, descriptor.normal) - descriptor.offsetM;
    };
    const normalAt = positionInput => {
        const positionM = fluidVector3(positionInput, '$.positionM');
        if (descriptor.type === 'sphere') return normalize(subtract(positionM, descriptor.centerM));
        if (descriptor.type === 'box') return boxNormal(descriptor, positionM);
        return [...descriptor.normal];
    };
    return Object.freeze({ descriptor, signedDistanceM, normalAt });
}

export function createSphereFluidBoundary(options) {
    return createAnalyticFluidBoundary({ ...options, type: 'sphere' });
}

export function createBoxFluidBoundary(options) {
    return createAnalyticFluidBoundary({ ...options, type: 'box' });
}

export function createPlaneFluidBoundary(options) {
    return createAnalyticFluidBoundary({ ...options, type: 'plane' });
}

function resolution3(value) {
    const source = Number.isSafeInteger(value) ? [value, value, value] : value;
    if (!Array.isArray(source) || source.length !== 3) {
        throw new TypeError('$.resolution: expected an integer or three integers');
    }
    return source.map((entry, axis) => fluidInteger(entry, `$.resolution[${axis}]`, {
        minimum: 2,
        maximum: 256,
    }));
}

function deriveVoxelSizeM(boundsMinM, boundsMaxM, resolution) {
    return boundsMaxM.map((value, axis) => (
        (value - boundsMinM[axis]) / Math.max(1, resolution[axis] - 1)
    ));
}

function deriveSurfaceChannels(signedDistanceM, voxelSizeM) {
    const occupancy = new Uint8Array(signedDistanceM.length);
    const surfaceMask = new Uint8Array(signedDistanceM.length);
    const surfaceThreshold = 0.9 * vectorLength(voxelSizeM);
    for (let index = 0; index < signedDistanceM.length; index += 1) {
        const distanceM = signedDistanceM[index];
        occupancy[index] = distanceM <= 0 ? 1 : 0;
        surfaceMask[index] = Math.abs(distanceM) <= surfaceThreshold ? 1 : 0;
    }
    return { occupancy, surfaceMask };
}

function channelMatches(stored, derived) {
    return stored.every((value, index) => value === derived[index]);
}

function tileIndex(tile, x, y, z) {
    return x + tile.resolution[0] * (y + tile.resolution[1] * z);
}

function packetSurfaceDistance(packet, positionM) {
    const radiusM = Math.cbrt(3 * packet.representedVolumeM3 / (4 * Math.PI));
    return vectorLength(subtract(positionM, packet.positionM)) - radiusM;
}

function serializeTile(tile) {
    return {
        schema: LOCAL_FLUID_SURFACE_TILE_SCHEMA,
        schemaVersion: LOCAL_FLUID_SURFACE_TILE_VERSION,
        tileId: tile.tileId,
        regionId: tile.regionId,
        sourceRevision: tile.sourceRevision,
        boundaryRevisionSignature: tile.boundaryRevisionSignature,
        representationRevisionSignature: tile.representationRevisionSignature,
        boundsMinM: tile.boundsMinM,
        boundsMaxM: tile.boundsMaxM,
        resolution: tile.resolution,
        voxelSizeM: tile.voxelSizeM,
        narrowBandM: tile.narrowBandM,
        signedDistanceM: Array.from(tile.signedDistanceM),
        occupancy: Array.from(tile.occupancy),
        surfaceMask: Array.from(tile.surfaceMask),
    };
}

export class LocalFluidSurfaceCache {
    #maxTiles;
    #maxVoxelsPerTile;
    #tiles = new Map();
    #deviceGeneration = 0;
    #logger;
    #destroyed = false;
    #buildCount = 0;
    #invalidations = 0;
    #allocationFailures = 0;

    constructor({ maxTiles = 32, maxVoxelsPerTile = 262144, logger = null, snapshot = null } = {}) {
        this.#maxTiles = fluidInteger(maxTiles, '$.maxTiles', { minimum: 1, maximum: 4096 });
        this.#maxVoxelsPerTile = fluidInteger(maxVoxelsPerTile, '$.maxVoxelsPerTile', {
            minimum: 8,
            maximum: 16_777_216,
        });
        this.#logger = logger;
        logAdaptiveFluid(this.#logger, 'debug', 'surface-cache-initialize', {
            maxTiles: this.#maxTiles,
            maxVoxelsPerTile: this.#maxVoxelsPerTile,
        });
        if (snapshot) this.restore(snapshot);
    }

    #assertAlive() {
        if (this.#destroyed) {
            throw new AdaptiveFluidError(
                ADAPTIVE_FLUID_ERROR_CODES.DESTROYED,
                'Local fluid surface cache is destroyed',
            );
        }
    }

    buildTile({
        tileId,
        regionId,
        sourceRevision,
        boundsMinM,
        boundsMaxM,
        resolution = 12,
        narrowBandM,
        packets = [],
        boundaries = [],
    }) {
        this.#assertAlive();
        const id = fluidIdentifier(tileId, '$.tileId');
        const region = fluidIdentifier(regionId, '$.regionId');
        const revision = fluidInteger(sourceRevision, '$.sourceRevision');
        const minimum = fluidVector3(boundsMinM, '$.boundsMinM');
        const maximum = fluidVector3(boundsMaxM, '$.boundsMaxM');
        if (maximum.some((value, axis) => value <= minimum[axis])) {
            throw new RangeError('$.boundsMaxM: each axis must exceed boundsMinM');
        }
        const dimensions = resolution3(resolution);
        const voxelCount = dimensions[0] * dimensions[1] * dimensions[2];
        if (!Number.isSafeInteger(voxelCount) || voxelCount > this.#maxVoxelsPerTile) {
            this.#allocationFailures += 1;
            logAdaptiveFluid(this.#logger, 'error', 'surface-tile-voxel-capacity-exhausted', {
                tileId: id,
                voxelCount,
                maxVoxelsPerTile: this.#maxVoxelsPerTile,
            });
            throw new AdaptiveFluidError(
                ADAPTIVE_FLUID_ERROR_CODES.CAPACITY_EXHAUSTED,
                `Local surface tile requires ${voxelCount} voxels; limit is ${this.#maxVoxelsPerTile}`,
                { tileId: id, voxelCount, maxVoxelsPerTile: this.#maxVoxelsPerTile },
            );
        }
        if (!this.#tiles.has(id) && this.#tiles.size >= this.#maxTiles) {
            this.#allocationFailures += 1;
            logAdaptiveFluid(this.#logger, 'error', 'surface-tile-capacity-exhausted', {
                tileId: id,
                activeTiles: this.#tiles.size,
                maxTiles: this.#maxTiles,
            });
            throw new AdaptiveFluidError(
                ADAPTIVE_FLUID_ERROR_CODES.CAPACITY_EXHAUSTED,
                `Local surface cache tile limit ${this.#maxTiles} is exhausted`,
                { tileId: id, maxTiles: this.#maxTiles },
            );
        }
        const physicalPackets = packets.map(createAdaptiveFluidPacket)
            .filter(packet => packet.canonicalMassOwner && packet.regionId === region);
        const analyticBoundaries = boundaries.map(boundary => (
            boundary?.descriptor ? createAnalyticFluidBoundary(boundary.descriptor) : createAnalyticFluidBoundary(boundary)
        ));
        if (physicalPackets.length === 0 && analyticBoundaries.length === 0) {
            throw new TypeError('Local surface tile requires packets or analytic boundaries');
        }
        if (physicalPackets.some(packet => packet.sourceRevision !== revision)) {
            throw new AdaptiveFluidError(
                ADAPTIVE_FLUID_ERROR_CODES.REVISION_CONFLICT,
                'Local surface packets do not match the requested source revision',
                { sourceRevision: revision },
            );
        }
        const voxelSizeM = deriveVoxelSizeM(minimum, maximum, dimensions);
        const band = fluidFinite(
            narrowBandM ?? Math.max(...voxelSizeM) * 3,
            '$.narrowBandM',
            { minimum: Math.min(...voxelSizeM), maximum: 1_000_000 },
        );
        logAdaptiveFluid(this.#logger, 'debug', 'surface-tile-build-start', {
            tileId: id,
            voxelCount,
            sourceRevision: revision,
        });
        const signedDistanceM = new Float32Array(voxelCount);
        for (let z = 0; z < dimensions[2]; z += 1) {
            for (let y = 0; y < dimensions[1]; y += 1) {
                for (let x = 0; x < dimensions[0]; x += 1) {
                    const positionM = [
                        minimum[0] + x * voxelSizeM[0],
                        minimum[1] + y * voxelSizeM[1],
                        minimum[2] + z * voxelSizeM[2],
                    ];
                    let distanceM = Infinity;
                    for (const packet of physicalPackets) {
                        distanceM = Math.min(distanceM, packetSurfaceDistance(packet, positionM));
                    }
                    for (const boundary of analyticBoundaries) {
                        distanceM = Math.min(distanceM, boundary.signedDistanceM(positionM));
                    }
                    distanceM = Math.max(-band, Math.min(band, distanceM));
                    const index = x + dimensions[0] * (y + dimensions[1] * z);
                    signedDistanceM[index] = distanceM;
                }
            }
        }
        const { occupancy, surfaceMask } = deriveSurfaceChannels(signedDistanceM, voxelSizeM);
        const tile = {
            tileId: id,
            regionId: region,
            sourceRevision: revision,
            boundaryRevisionSignature: analyticBoundaries
                .map(boundary => `${boundary.descriptor.id}@${boundary.descriptor.revision}`)
                .sort().join('|'),
            representationRevisionSignature: physicalPackets
                .map(packet => `${packet.id}@${packet.representationRevision}`)
                .sort().join('|'),
            boundsMinM: minimum,
            boundsMaxM: maximum,
            resolution: dimensions,
            voxelSizeM,
            narrowBandM: band,
            signedDistanceM,
            occupancy,
            surfaceMask,
        };
        this.#tiles.set(id, tile);
        this.#buildCount += 1;
        const descriptor = this.getTile(id, { regionId: region, sourceRevision: revision });
        logAdaptiveFluid(this.#logger, 'debug', 'surface-tile-build-complete', {
            tileId: id,
            surfaceVoxels: descriptor.surfaceVoxels,
            occupiedVoxels: descriptor.occupiedVoxels,
        });
        return descriptor;
    }

    #validatedTile(tileId, {
        regionId = null,
        sourceRevision = null,
        representationRevisionSignature = null,
        boundaryRevisionSignature = null,
    } = {}) {
        const tile = this.#tiles.get(tileId);
        if (!tile) throw new RangeError(`Unknown local surface tile '${tileId}'`);
        if ((regionId !== null && tile.regionId !== regionId)
            || (sourceRevision !== null && tile.sourceRevision !== sourceRevision)
            || (representationRevisionSignature !== null
                && tile.representationRevisionSignature !== representationRevisionSignature)
            || (boundaryRevisionSignature !== null
                && tile.boundaryRevisionSignature !== boundaryRevisionSignature)) {
            logAdaptiveFluid(this.#logger, 'error', 'surface-tile-stale', {
                tileId,
                requestedRegionId: regionId,
                requestedSourceRevision: sourceRevision,
                requestedRepresentationRevisionSignature: representationRevisionSignature,
                requestedBoundaryRevisionSignature: boundaryRevisionSignature,
            });
            throw new AdaptiveFluidError(
                ADAPTIVE_FLUID_ERROR_CODES.STALE_PROJECTION,
                `Local surface tile '${tileId}' is stale for the requested region revision`,
                {
                    tileRegionId: tile.regionId,
                    tileSourceRevision: tile.sourceRevision,
                    requestedRegionId: regionId,
                    requestedSourceRevision: sourceRevision,
                    tileRepresentationRevisionSignature: tile.representationRevisionSignature,
                    requestedRepresentationRevisionSignature: representationRevisionSignature,
                    tileBoundaryRevisionSignature: tile.boundaryRevisionSignature,
                    requestedBoundaryRevisionSignature: boundaryRevisionSignature,
                },
            );
        }
        return tile;
    }

    getTile(tileId, revision = {}) {
        this.#assertAlive();
        const tile = this.#validatedTile(tileId, revision);
        return fluidFreeze({
            schema: LOCAL_FLUID_SURFACE_TILE_SCHEMA,
            schemaVersion: LOCAL_FLUID_SURFACE_TILE_VERSION,
            tileId: tile.tileId,
            regionId: tile.regionId,
            sourceRevision: tile.sourceRevision,
            boundaryRevisionSignature: tile.boundaryRevisionSignature,
            representationRevisionSignature: tile.representationRevisionSignature,
            boundsMinM: tile.boundsMinM,
            boundsMaxM: tile.boundsMaxM,
            resolution: tile.resolution,
            voxelSizeM: tile.voxelSizeM,
            narrowBandM: tile.narrowBandM,
            voxelCount: tile.signedDistanceM.length,
            occupiedVoxels: tile.occupancy.reduce((sum, value) => sum + value, 0),
            surfaceVoxels: tile.surfaceMask.reduce((sum, value) => sum + value, 0),
        }, '$.localFluidSurfaceTile');
    }

    sample(tileId, positionInput, revision = {}) {
        this.#assertAlive();
        const tile = this.#validatedTile(tileId, revision);
        const positionM = fluidVector3(positionInput, '$.positionM');
        const coordinates = positionM.map((value, axis) => (
            (value - tile.boundsMinM[axis]) / tile.voxelSizeM[axis]
        ));
        if (coordinates.some((value, axis) => value < 0 || value > tile.resolution[axis] - 1)) {
            return fluidFreeze({
                insideTile: false,
                signedDistanceM: tile.narrowBandM,
                normal: [0, 0, 0],
                occupancy: false,
                surface: false,
            }, '$.localFluidSurfaceSample');
        }
        const base = coordinates.map((value, axis) => Math.min(
            tile.resolution[axis] - 2,
            Math.max(0, Math.floor(value)),
        ));
        const fraction = coordinates.map((value, axis) => value - base[axis]);
        let signedDistanceM = 0;
        let occupancyWeight = 0;
        let surfaceWeight = 0;
        for (let ordinal = 0; ordinal < 8; ordinal += 1) {
            const ox = ordinal & 1;
            const oy = (ordinal >> 1) & 1;
            const oz = (ordinal >> 2) & 1;
            const weight = (ox ? fraction[0] : 1 - fraction[0])
                * (oy ? fraction[1] : 1 - fraction[1])
                * (oz ? fraction[2] : 1 - fraction[2]);
            const index = tileIndex(tile, base[0] + ox, base[1] + oy, base[2] + oz);
            signedDistanceM += tile.signedDistanceM[index] * weight;
            occupancyWeight += tile.occupancy[index] * weight;
            surfaceWeight += tile.surfaceMask[index] * weight;
        }
        const nearest = coordinates.map((value, axis) => Math.max(
            1,
            Math.min(tile.resolution[axis] - 2, Math.round(value)),
        ));
        const gradient = [0, 1, 2].map(axis => {
            const low = [...nearest];
            const high = [...nearest];
            low[axis] -= 1;
            high[axis] += 1;
            return (tile.signedDistanceM[tileIndex(tile, ...high)]
                - tile.signedDistanceM[tileIndex(tile, ...low)])
                / (2 * tile.voxelSizeM[axis]);
        });
        return fluidFreeze({
            insideTile: true,
            signedDistanceM,
            normal: normalize(gradient, [0, 0, 0]),
            occupancy: occupancyWeight >= 0.5,
            surface: surfaceWeight > 0.1,
        }, '$.localFluidSurfaceSample');
    }

    releaseTile(tileId) {
        this.#assertAlive();
        const released = this.#tiles.delete(tileId);
        if (released) logAdaptiveFluid(this.#logger, 'debug', 'surface-tile-release', { tileId });
        return released;
    }

    invalidateRegion(regionId, sourceRevision) {
        this.#assertAlive();
        const region = fluidIdentifier(regionId, '$.regionId');
        const revision = fluidInteger(sourceRevision, '$.sourceRevision');
        const released = [];
        for (const [tileId, tile] of this.#tiles) {
            if (tile.regionId === region && tile.sourceRevision !== revision) {
                this.#tiles.delete(tileId);
                released.push(tileId);
            }
        }
        this.#invalidations += released.length;
        if (released.length) {
            logAdaptiveFluid(this.#logger, 'info', 'surface-region-invalidated', {
                regionId: region,
                sourceRevision: revision,
                released,
            });
        }
        return fluidFreeze(released.sort(), '$.invalidatedSurfaceTiles');
    }

    /** Drop packet-derived tiles after same-revision solver motion changes their geometry. */
    invalidateRegionProjection(regionId) {
        this.#assertAlive();
        const region = fluidIdentifier(regionId, '$.regionId');
        const released = [];
        for (const [tileId, tile] of this.#tiles) {
            if (tile.regionId !== region) continue;
            this.#tiles.delete(tileId);
            released.push(tileId);
        }
        this.#invalidations += released.length;
        if (released.length) {
            logAdaptiveFluid(this.#logger, 'info', 'surface-region-projection-invalidated', {
                regionId: region,
                released,
            });
        }
        return fluidFreeze(released.sort(), '$.invalidatedSurfaceProjectionTiles');
    }

    snapshot() {
        this.#assertAlive();
        return fluidFreeze({
            schema: LOCAL_FLUID_SURFACE_SNAPSHOT_SCHEMA,
            schemaVersion: LOCAL_FLUID_SURFACE_SNAPSHOT_VERSION,
            maxTiles: this.#maxTiles,
            maxVoxelsPerTile: this.#maxVoxelsPerTile,
            deviceGeneration: this.#deviceGeneration,
            buildCount: this.#buildCount,
            invalidations: this.#invalidations,
            allocationFailures: this.#allocationFailures,
            tiles: [...this.#tiles.values()].map(serializeTile)
                .sort((left, right) => left.tileId.localeCompare(right.tileId)),
        }, '$.localFluidSurfaceCacheSnapshot');
    }

    restore(snapshotInput) {
        this.#assertAlive();
        const snapshot = fluidClone(snapshotInput, '$.localFluidSurfaceCacheSnapshot');
        if (snapshot.schema !== LOCAL_FLUID_SURFACE_SNAPSHOT_SCHEMA
            || snapshot.schemaVersion !== LOCAL_FLUID_SURFACE_SNAPSHOT_VERSION) {
            throw new TypeError('$.localFluidSurfaceCacheSnapshot: unsupported schema or version');
        }
        if (snapshot.maxTiles !== this.#maxTiles || snapshot.maxVoxelsPerTile !== this.#maxVoxelsPerTile) {
            throw new AdaptiveFluidError(
                ADAPTIVE_FLUID_ERROR_CODES.REVISION_CONFLICT,
                'Local surface snapshot capacity differs from this cache',
                {
                    expected: [this.#maxTiles, this.#maxVoxelsPerTile],
                    actual: [snapshot.maxTiles, snapshot.maxVoxelsPerTile],
                },
            );
        }
        if (!Array.isArray(snapshot.tiles) || snapshot.tiles.length > this.#maxTiles) {
            throw new TypeError('$.localFluidSurfaceCacheSnapshot.tiles: invalid collection');
        }
        const restored = new Map();
        for (const stored of snapshot.tiles) {
            const resolution = resolution3(stored.resolution);
            const voxelCount = resolution[0] * resolution[1] * resolution[2];
            if (voxelCount > this.#maxVoxelsPerTile
                || !Array.isArray(stored.signedDistanceM)
                || stored.signedDistanceM.length !== voxelCount
                || !Array.isArray(stored.occupancy)
                || stored.occupancy.length !== voxelCount
                || !Array.isArray(stored.surfaceMask)
                || stored.surfaceMask.length !== voxelCount) {
                throw new TypeError(`Local surface tile '${stored.tileId}' has invalid channel lengths`);
            }
            const id = fluidIdentifier(stored.tileId, '$.tile.tileId');
            if (restored.has(id)) throw new TypeError(`Duplicate local surface tile '${id}'`);
            const boundsMinM = fluidVector3(stored.boundsMinM, '$.tile.boundsMinM');
            const boundsMaxM = fluidVector3(stored.boundsMaxM, '$.tile.boundsMaxM');
            if (boundsMaxM.some((value, axis) => value <= boundsMinM[axis])) {
                throw new TypeError(`Local surface tile '${id}' has invalid bounds`);
            }
            const voxelSizeM = deriveVoxelSizeM(boundsMinM, boundsMaxM, resolution);
            const storedVoxelSizeM = fluidVector3(stored.voxelSizeM, '$.tile.voxelSizeM');
            if (!channelMatches(storedVoxelSizeM, voxelSizeM)) {
                throw new TypeError(`Local surface tile '${id}' voxel size disagrees with its bounds and resolution`);
            }
            const narrowBandM = fluidFinite(stored.narrowBandM, '$.tile.narrowBandM', {
                minimum: Math.min(...voxelSizeM),
                maximum: 1_000_000,
            });
            if (stored.signedDistanceM.some(value => (
                !Number.isFinite(value)
                || Math.fround(value) !== value
                || Math.abs(value) > narrowBandM * (1 + 1e-6)
            ))) {
                throw new TypeError(`Local surface tile '${id}' contains distance outside its narrow band`);
            }
            const signedDistanceM = Float32Array.from(stored.signedDistanceM);
            const { occupancy, surfaceMask } = deriveSurfaceChannels(signedDistanceM, voxelSizeM);
            if (stored.occupancy.some(value => value !== 0 && value !== 1)
                || !channelMatches(stored.occupancy, occupancy)) {
                throw new TypeError(`Local surface tile '${id}' occupancy disagrees with its signed-distance field`);
            }
            if (stored.surfaceMask.some(value => value !== 0 && value !== 1)
                || !channelMatches(stored.surfaceMask, surfaceMask)) {
                throw new TypeError(`Local surface tile '${id}' surface mask disagrees with its signed-distance field`);
            }
            if (typeof stored.boundaryRevisionSignature !== 'string'
                || typeof stored.representationRevisionSignature !== 'string') {
                throw new TypeError(`Local surface tile '${id}' has invalid revision signatures`);
            }
            restored.set(id, {
                tileId: id,
                regionId: fluidIdentifier(stored.regionId, '$.tile.regionId'),
                sourceRevision: fluidInteger(stored.sourceRevision, '$.tile.sourceRevision'),
                boundaryRevisionSignature: stored.boundaryRevisionSignature,
                representationRevisionSignature: stored.representationRevisionSignature,
                boundsMinM,
                boundsMaxM,
                resolution,
                voxelSizeM,
                narrowBandM,
                signedDistanceM,
                occupancy,
                surfaceMask,
            });
        }
        const deviceGeneration = fluidInteger(snapshot.deviceGeneration, '$.deviceGeneration');
        const buildCount = fluidInteger(snapshot.buildCount, '$.buildCount');
        const invalidations = fluidInteger(snapshot.invalidations, '$.invalidations');
        const allocationFailures = fluidInteger(snapshot.allocationFailures, '$.allocationFailures');
        this.#tiles = restored;
        this.#deviceGeneration = deviceGeneration;
        this.#buildCount = buildCount;
        this.#invalidations = invalidations;
        this.#allocationFailures = allocationFailures;
        logAdaptiveFluid(this.#logger, 'debug', 'surface-cache-restore', { tiles: restored.size });
        return this;
    }

    setDeviceGeneration(generation) {
        this.#assertAlive();
        this.#deviceGeneration = fluidInteger(generation, '$.deviceGeneration');
        return this.deviceRecreationPlan();
    }

    deviceRecreationPlan() {
        this.#assertAlive();
        const voxelCount = [...this.#tiles.values()]
            .reduce((sum, tile) => sum + tile.signedDistanceM.length, 0);
        return fluidFreeze({
            schema: 'engine.matter.local-fluid-surface-device-recreation-plan',
            schemaVersion: '1.0.0',
            deviceGeneration: this.#deviceGeneration,
            cpuReferenceOnly: true,
            gpuExecutionAvailable: false,
            callerEncoderRequiredForFutureGpuProjection: true,
            tiles: this.#tiles.size,
            voxelCount,
            signedDistanceByteLength: voxelCount * 4,
            occupancyByteLength: voxelCount,
            surfaceMaskByteLength: voxelCount,
        }, '$.localFluidSurfaceDeviceRecreationPlan');
    }

    stats() {
        this.#assertAlive();
        const tiles = [...this.#tiles.values()];
        return fluidFreeze({
            maxTiles: this.#maxTiles,
            maxVoxelsPerTile: this.#maxVoxelsPerTile,
            activeTiles: tiles.length,
            voxels: tiles.reduce((sum, tile) => sum + tile.signedDistanceM.length, 0),
            occupiedVoxels: tiles.reduce((sum, tile) => (
                sum + tile.occupancy.reduce((subtotal, value) => subtotal + value, 0)
            ), 0),
            surfaceVoxels: tiles.reduce((sum, tile) => (
                sum + tile.surfaceMask.reduce((subtotal, value) => subtotal + value, 0)
            ), 0),
            deviceGeneration: this.#deviceGeneration,
            buildCount: this.#buildCount,
            invalidations: this.#invalidations,
            allocationFailures: this.#allocationFailures,
        }, '$.localFluidSurfaceStats');
    }

    destroy() {
        if (this.#destroyed) return;
        logAdaptiveFluid(this.#logger, 'debug', 'surface-cache-destroy', { tiles: this.#tiles.size });
        this.#tiles.clear();
        this.#destroyed = true;
    }
}

export function createLocalFluidSurfaceCache(options) {
    return new LocalFluidSurfaceCache(options);
}

export function restoreLocalFluidSurfaceCache(snapshot, options = {}) {
    return new LocalFluidSurfaceCache({
        ...options,
        maxTiles: snapshot.maxTiles,
        maxVoxelsPerTile: snapshot.maxVoxelsPerTile,
        snapshot,
    });
}
