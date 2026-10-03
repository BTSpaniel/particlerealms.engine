// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Finite sparse particle-grid projection with conservative CPU reference transfers. */

import {
    ADAPTIVE_FLUID_ERROR_CODES,
    AdaptiveFluidError,
    createAdaptiveFluidPacket,
    fluidClone,
    fluidFinite,
    fluidFreeze,
    fluidInteger,
    logAdaptiveFluid,
    summarizeAdaptiveFluidConservation,
} from './AdaptiveFluidContracts.js';
import {
    FLUID_REFERENCE_EPSILON as EPSILON,
    addVector3 as vectorAdd,
    scaleVector3 as vectorScale,
    subtractVector3 as vectorSubtract,
    vector3Length as vectorLength,
} from './FluidReferenceMath.js';

export const SPARSE_FLUID_GRID_SNAPSHOT_SCHEMA = 'engine.matter.sparse-fluid-grid-snapshot';
export const SPARSE_FLUID_GRID_SNAPSHOT_VERSION = '1.0.0';
export const SPARSE_FLUID_TRANSFER_SCHEMA = 'engine.matter.sparse-fluid-transfer-receipt';
export const SPARSE_FLUID_TRANSFER_VERSION = '1.0.0';

const CHANNEL_NAMES = Object.freeze([
    'massKg', 'momentumX', 'momentumY', 'momentumZ',
    'velocityX', 'velocityY', 'velocityZ',
    'correctedX', 'correctedY', 'correctedZ',
    'pressurePa', 'divergencePerS',
]);

function brickKey(x, y, z) {
    return `${x},${y},${z}`;
}

function floorDivide(value, divisor) {
    return Math.floor(value / divisor);
}

function createBrick(x, y, z, cellCount, sourceRevision) {
    const brick = {
        coordinates: [x, y, z],
        sourceRevision,
        occupancy: new Uint8Array(cellCount),
        surfaceMask: new Uint8Array(cellCount),
    };
    for (const channel of CHANNEL_NAMES) brick[channel] = new Float64Array(cellCount);
    return brick;
}

function resetBrick(brick, sourceRevision) {
    brick.sourceRevision = sourceRevision;
    brick.occupancy.fill(0);
    brick.surfaceMask.fill(0);
    for (const channel of CHANNEL_NAMES) brick[channel].fill(0);
}

function physicalPackets(inputs) {
    if (!Array.isArray(inputs)) throw new TypeError('$.packets: must be an array');
    return inputs.map(createAdaptiveFluidPacket).filter(packet => packet.canonicalMassOwner);
}

export class SparseFluidBrickGrid {
    #cellSizeM;
    #brickSize;
    #maxBricks;
    #bricks = new Map();
    #projectionRevision = 0;
    #sourceRevision = null;
    #representationRevisionSignature = null;
    #deviceGeneration = 0;
    #logger;
    #destroyed = false;
    #allocationFailures = 0;
    #scatterCount = 0;
    #solveCount = 0;
    #gatherCount = 0;
    #lastSolve = null;

    constructor({ cellSizeM = 0.25, brickSize = 4, maxBricks = 256, logger = null, snapshot = null } = {}) {
        this.#cellSizeM = fluidFinite(cellSizeM, '$.cellSizeM', {
            minimum: Number.MIN_VALUE,
            maximum: 1_000_000,
        });
        this.#brickSize = fluidInteger(brickSize, '$.brickSize', { minimum: 2, maximum: 32 });
        this.#maxBricks = fluidInteger(maxBricks, '$.maxBricks', { minimum: 1, maximum: 1_000_000 });
        this.#logger = logger;
        logAdaptiveFluid(this.#logger, 'debug', 'sparse-grid-initialize', {
            cellSizeM: this.#cellSizeM,
            brickSize: this.#brickSize,
            maxBricks: this.#maxBricks,
        });
        if (snapshot) this.restore(snapshot);
    }

    #assertAlive() {
        if (this.#destroyed) {
            throw new AdaptiveFluidError(
                ADAPTIVE_FLUID_ERROR_CODES.DESTROYED,
                'Sparse fluid brick grid is destroyed',
            );
        }
    }

    #cellAddress(x, y, z) {
        const bx = floorDivide(x, this.#brickSize);
        const by = floorDivide(y, this.#brickSize);
        const bz = floorDivide(z, this.#brickSize);
        const lx = x - bx * this.#brickSize;
        const ly = y - by * this.#brickSize;
        const lz = z - bz * this.#brickSize;
        return {
            key: brickKey(bx, by, bz),
            coordinates: [bx, by, bz],
            index: lx + this.#brickSize * (ly + this.#brickSize * lz),
        };
    }

    #getCell(x, y, z) {
        const address = this.#cellAddress(x, y, z);
        const brick = this.#bricks.get(address.key);
        return brick ? { brick, index: address.index } : null;
    }

    #requireRevision(expectedSourceRevision) {
        if (this.#sourceRevision === null || expectedSourceRevision !== this.#sourceRevision) {
            throw new AdaptiveFluidError(
                ADAPTIVE_FLUID_ERROR_CODES.REVISION_CONFLICT,
                `Sparse grid projection revision mismatch: expected source ${expectedSourceRevision}, projected ${this.#sourceRevision}`,
                { expectedSourceRevision, projectedSourceRevision: this.#sourceRevision },
            );
        }
    }

    #weights(positionM) {
        const scaled = positionM.map(value => value / this.#cellSizeM);
        const base = scaled.map(Math.floor);
        const fraction = scaled.map((value, axis) => value - base[axis]);
        const entries = [];
        let total = 0;
        for (let ordinal = 0; ordinal < 8; ordinal += 1) {
            const ox = ordinal & 1;
            const oy = (ordinal >> 1) & 1;
            const oz = (ordinal >> 2) & 1;
            const weight = (ox ? fraction[0] : 1 - fraction[0])
                * (oy ? fraction[1] : 1 - fraction[1])
                * (oz ? fraction[2] : 1 - fraction[2]);
            if (weight <= 0) continue;
            total += weight;
            entries.push({ x: base[0] + ox, y: base[1] + oy, z: base[2] + oz, weight });
        }
        return entries.map(entry => ({ ...entry, weight: entry.weight / total }));
    }

    #ensureBrickCapacity(addresses, sourceRevision) {
        const missing = [...addresses.values()].filter(address => !this.#bricks.has(address.key));
        if (this.#bricks.size + missing.length > this.#maxBricks) {
            this.#allocationFailures += 1;
            logAdaptiveFluid(this.#logger, 'error', 'sparse-grid-capacity-exhausted', {
                allocatedBricks: this.#bricks.size,
                requiredNewBricks: missing.length,
                maxBricks: this.#maxBricks,
            });
            throw new AdaptiveFluidError(
                ADAPTIVE_FLUID_ERROR_CODES.CAPACITY_EXHAUSTED,
                `Sparse grid requires ${missing.length} new bricks but only ${this.#maxBricks - this.#bricks.size} remain`,
                {
                    allocatedBricks: this.#bricks.size,
                    requiredNewBricks: missing.length,
                    maxBricks: this.#maxBricks,
                },
            );
        }
        const cellCount = this.#brickSize ** 3;
        for (const address of missing.sort((left, right) => left.key.localeCompare(right.key))) {
            this.#bricks.set(
                address.key,
                createBrick(...address.coordinates, cellCount, sourceRevision),
            );
        }
    }

    clear({ sourceRevision = this.#sourceRevision ?? 0, releaseBricks = false } = {}) {
        this.#assertAlive();
        fluidInteger(sourceRevision, '$.sourceRevision');
        if (releaseBricks) this.#bricks.clear();
        else for (const brick of this.#bricks.values()) resetBrick(brick, sourceRevision);
        this.#sourceRevision = sourceRevision;
        this.#representationRevisionSignature = null;
        this.#projectionRevision += 1;
        this.#lastSolve = null;
        logAdaptiveFluid(this.#logger, 'debug', 'sparse-grid-clear', {
            sourceRevision,
            allocatedBricks: this.#bricks.size,
            releaseBricks,
        });
    }

    scatterPackets(packetInputs, { sourceRevision = null, replace = true } = {}) {
        this.#assertAlive();
        if (replace !== true) {
            throw new AdaptiveFluidError(
                ADAPTIVE_FLUID_ERROR_CODES.INVALID_INPUT,
                'Sparse grid scatter requires a complete replacement projection',
                { replace },
            );
        }
        const packets = physicalPackets(packetInputs);
        if (packets.length === 0) throw new TypeError('$.packets: no canonical mass owners were supplied');
        const revisions = new Set(packets.map(packet => packet.sourceRevision));
        if (revisions.size !== 1) {
            throw new AdaptiveFluidError(
                ADAPTIVE_FLUID_ERROR_CODES.REVISION_CONFLICT,
                'Sparse grid scatter requires one source revision per projection',
                { sourceRevisions: [...revisions].sort((a, b) => a - b) },
            );
        }
        const resolvedRevision = sourceRevision ?? packets[0].sourceRevision;
        fluidInteger(resolvedRevision, '$.sourceRevision');
        if (resolvedRevision !== packets[0].sourceRevision) {
            throw new AdaptiveFluidError(
                ADAPTIVE_FLUID_ERROR_CODES.REVISION_CONFLICT,
                'Sparse grid scatter source revision does not match packets',
                { requested: resolvedRevision, packet: packets[0].sourceRevision },
            );
        }
        const representationRevisionSignature = packets
            .map(packet => `${packet.id}@${packet.representationRevision}`)
            .sort().join('|');
        logAdaptiveFluid(this.#logger, 'debug', 'sparse-grid-scatter-start', {
            packets: packets.length,
            sourceRevision: resolvedRevision,
        });
        const contributions = packets.map(packet => ({ packet, weights: this.#weights(packet.positionM) }));
        const addresses = new Map();
        for (const contribution of contributions) {
            for (const entry of contribution.weights) {
                const address = this.#cellAddress(entry.x, entry.y, entry.z);
                addresses.set(address.key, address);
            }
        }
        this.#ensureBrickCapacity(addresses, resolvedRevision);
        for (const brick of this.#bricks.values()) resetBrick(brick, resolvedRevision);
        let scatteredMassKg = 0;
        const scatteredMomentum = [0, 0, 0];
        for (const { packet, weights } of contributions) {
            for (const entry of weights) {
                const cell = this.#getCell(entry.x, entry.y, entry.z);
                const massKg = packet.massKg * entry.weight;
                cell.brick.massKg[cell.index] += massKg;
                cell.brick.momentumX[cell.index] += massKg * packet.velocityMPerS[0];
                cell.brick.momentumY[cell.index] += massKg * packet.velocityMPerS[1];
                cell.brick.momentumZ[cell.index] += massKg * packet.velocityMPerS[2];
                scatteredMassKg += massKg;
                scatteredMomentum[0] += massKg * packet.velocityMPerS[0];
                scatteredMomentum[1] += massKg * packet.velocityMPerS[1];
                scatteredMomentum[2] += massKg * packet.velocityMPerS[2];
            }
        }
        this.#sourceRevision = resolvedRevision;
        this.#representationRevisionSignature = representationRevisionSignature;
        this.#projectionRevision += 1;
        this.#scatterCount += 1;
        this.computeOccupancyAndSurfaceMasks({ sourceRevision: resolvedRevision });
        const canonical = summarizeAdaptiveFluidConservation(packets);
        const massResidualKg = scatteredMassKg - canonical.massKg;
        const momentumResidual = vectorSubtract(scatteredMomentum, canonical.linearMomentumKgMPerS);
        const tolerance = 1e-9 * Math.max(1, canonical.massKg, vectorLength(canonical.linearMomentumKgMPerS));
        const balanced = Math.abs(massResidualKg) <= tolerance && vectorLength(momentumResidual) <= tolerance;
        if (!balanced) {
            throw new AdaptiveFluidError(
                ADAPTIVE_FLUID_ERROR_CODES.CONSERVATION_FAILURE,
                'Packet-to-grid scatter failed conservation',
                { massResidualKg, momentumResidual, tolerance },
            );
        }
        const receipt = fluidFreeze({
            schema: SPARSE_FLUID_TRANSFER_SCHEMA,
            schemaVersion: SPARSE_FLUID_TRANSFER_VERSION,
            operation: 'packet-to-grid-scatter',
            sourceRevision: resolvedRevision,
            representationRevisionSignature,
            projectionRevision: this.#projectionRevision,
            canonicalMassOwner: 'packets',
            gridOwnedMassKg: 0,
            canonicalMassKg: canonical.massKg,
            scatteredMassKg,
            massResidualKg,
            canonicalMomentumKgMPerS: canonical.linearMomentumKgMPerS,
            scatteredMomentumKgMPerS: scatteredMomentum,
            momentumResidualKgMPerS: momentumResidual,
            ignoredRenderOnlySamples: packetInputs.length - packets.length,
            allocatedBricks: this.#bricks.size,
            balanced,
        }, '$.sparseFluidScatterReceipt');
        logAdaptiveFluid(this.#logger, 'debug', 'sparse-grid-scatter-complete', receipt);
        return receipt;
    }

    computeOccupancyAndSurfaceMasks({ sourceRevision = this.#sourceRevision } = {}) {
        this.#assertAlive();
        this.#requireRevision(sourceRevision);
        let occupiedCells = 0;
        let surfaceCells = 0;
        for (const brick of this.#bricks.values()) {
            brick.occupancy.fill(0);
            brick.surfaceMask.fill(0);
            for (let index = 0; index < brick.massKg.length; index += 1) {
                if (brick.massKg[index] > EPSILON) {
                    brick.occupancy[index] = 1;
                    occupiedCells += 1;
                }
            }
        }
        for (const brick of this.#bricks.values()) {
            const [bx, by, bz] = brick.coordinates;
            for (let lz = 0; lz < this.#brickSize; lz += 1) {
                for (let ly = 0; ly < this.#brickSize; ly += 1) {
                    for (let lx = 0; lx < this.#brickSize; lx += 1) {
                        const index = lx + this.#brickSize * (ly + this.#brickSize * lz);
                        if (!brick.occupancy[index]) continue;
                        const gx = bx * this.#brickSize + lx;
                        const gy = by * this.#brickSize + ly;
                        const gz = bz * this.#brickSize + lz;
                        let occupiedNeighbors = 0;
                        for (const [dx, dy, dz] of [
                            [-1, 0, 0], [1, 0, 0], [0, -1, 0],
                            [0, 1, 0], [0, 0, -1], [0, 0, 1],
                        ]) {
                            const neighbor = this.#getCell(gx + dx, gy + dy, gz + dz);
                            occupiedNeighbors += neighbor?.brick.occupancy[neighbor.index] ?? 0;
                        }
                        if (occupiedNeighbors < 6) {
                            brick.surfaceMask[index] = 1;
                            surfaceCells += 1;
                        }
                    }
                }
            }
        }
        return fluidFreeze({ occupiedCells, surfaceCells }, '$.sparseFluidMasks');
    }

    #cellVelocity(x, y, z, corrected = false, fallback = [0, 0, 0]) {
        const cell = this.#getCell(x, y, z);
        if (!cell || cell.brick.massKg[cell.index] <= EPSILON) return fallback;
        const prefix = corrected ? 'corrected' : 'velocity';
        return [
            cell.brick[`${prefix}X`][cell.index],
            cell.brick[`${prefix}Y`][cell.index],
            cell.brick[`${prefix}Z`][cell.index],
        ];
    }

    solvePressureDivergence({
        sourceRevision = this.#sourceRevision,
        dtSeconds,
        restDensityKgM3 = 1000,
        iterations = 8,
        relaxation = 0.9,
    } = {}) {
        this.#assertAlive();
        this.#requireRevision(sourceRevision);
        const dt = fluidFinite(dtSeconds, '$.dtSeconds', { minimum: Number.MIN_VALUE, maximum: 0.1 });
        const restDensity = fluidFinite(restDensityKgM3, '$.restDensityKgM3', {
            minimum: Number.MIN_VALUE,
        });
        const iterationCount = fluidInteger(iterations, '$.iterations', { minimum: 1, maximum: 256 });
        const omega = fluidFinite(relaxation, '$.relaxation', { minimum: 0.01, maximum: 1 });
        logAdaptiveFluid(this.#logger, 'debug', 'sparse-grid-solve-start', {
            sourceRevision,
            iterations: iterationCount,
        });
        const occupied = [];
        for (const brick of this.#bricks.values()) {
            const [bx, by, bz] = brick.coordinates;
            for (let index = 0; index < brick.massKg.length; index += 1) {
                const mass = brick.massKg[index];
                if (mass <= EPSILON) continue;
                brick.velocityX[index] = brick.momentumX[index] / mass;
                brick.velocityY[index] = brick.momentumY[index] / mass;
                brick.velocityZ[index] = brick.momentumZ[index] / mass;
                brick.correctedX[index] = brick.velocityX[index];
                brick.correctedY[index] = brick.velocityY[index];
                brick.correctedZ[index] = brick.velocityZ[index];
                const lx = index % this.#brickSize;
                const ly = Math.floor(index / this.#brickSize) % this.#brickSize;
                const lz = Math.floor(index / (this.#brickSize * this.#brickSize));
                occupied.push({
                    brick,
                    index,
                    x: bx * this.#brickSize + lx,
                    y: by * this.#brickSize + ly,
                    z: bz * this.#brickSize + lz,
                });
            }
        }
        const divergenceOf = (entry, corrected = false) => {
            const current = this.#cellVelocity(entry.x, entry.y, entry.z, corrected);
            const xp = this.#cellVelocity(entry.x + 1, entry.y, entry.z, corrected, current);
            const xm = this.#cellVelocity(entry.x - 1, entry.y, entry.z, corrected, current);
            const yp = this.#cellVelocity(entry.x, entry.y + 1, entry.z, corrected, current);
            const ym = this.#cellVelocity(entry.x, entry.y - 1, entry.z, corrected, current);
            const zp = this.#cellVelocity(entry.x, entry.y, entry.z + 1, corrected, current);
            const zm = this.#cellVelocity(entry.x, entry.y, entry.z - 1, corrected, current);
            return ((xp[0] - xm[0]) + (yp[1] - ym[1]) + (zp[2] - zm[2]))
                / (2 * this.#cellSizeM);
        };
        let beforeDivergence = 0;
        for (const entry of occupied) {
            const divergence = divergenceOf(entry);
            entry.brick.divergencePerS[entry.index] = divergence;
            beforeDivergence += Math.abs(divergence);
        }
        for (let iteration = 0; iteration < iterationCount; iteration += 1) {
            const nextPressure = new Map();
            for (const entry of occupied) {
                let sum = 0;
                let neighbors = 0;
                for (const [dx, dy, dz] of [
                    [-1, 0, 0], [1, 0, 0], [0, -1, 0],
                    [0, 1, 0], [0, 0, -1], [0, 0, 1],
                ]) {
                    const neighbor = this.#getCell(entry.x + dx, entry.y + dy, entry.z + dz);
                    if (!neighbor || neighbor.brick.massKg[neighbor.index] <= EPSILON) continue;
                    sum += neighbor.brick.pressurePa[neighbor.index];
                    neighbors += 1;
                }
                const prior = entry.brick.pressurePa[entry.index];
                const candidate = neighbors > 0
                    ? (sum - restDensity * this.#cellSizeM ** 2
                        * entry.brick.divergencePerS[entry.index] / dt) / neighbors
                    : 0;
                nextPressure.set(entry, prior + (candidate - prior) * omega);
            }
            for (const [entry, pressure] of nextPressure) entry.brick.pressurePa[entry.index] = pressure;
        }
        let totalMass = 0;
        let correctionMomentum = [0, 0, 0];
        for (const entry of occupied) {
            const pressure = (x, y, z) => {
                const cell = this.#getCell(x, y, z);
                return cell && cell.brick.massKg[cell.index] > EPSILON
                    ? cell.brick.pressurePa[cell.index]
                    : entry.brick.pressurePa[entry.index];
            };
            const gradient = [
                pressure(entry.x + 1, entry.y, entry.z) - pressure(entry.x - 1, entry.y, entry.z),
                pressure(entry.x, entry.y + 1, entry.z) - pressure(entry.x, entry.y - 1, entry.z),
                pressure(entry.x, entry.y, entry.z + 1) - pressure(entry.x, entry.y, entry.z - 1),
            ].map(value => value / (2 * this.#cellSizeM));
            const correction = vectorScale(gradient, -dt / restDensity);
            entry.brick.correctedX[entry.index] = entry.brick.velocityX[entry.index] + correction[0];
            entry.brick.correctedY[entry.index] = entry.brick.velocityY[entry.index] + correction[1];
            entry.brick.correctedZ[entry.index] = entry.brick.velocityZ[entry.index] + correction[2];
            const mass = entry.brick.massKg[entry.index];
            totalMass += mass;
            correctionMomentum = vectorAdd(correctionMomentum, vectorScale(correction, mass));
        }
        const meanCorrection = totalMass > 0 ? vectorScale(correctionMomentum, 1 / totalMass) : [0, 0, 0];
        for (const entry of occupied) {
            entry.brick.correctedX[entry.index] -= meanCorrection[0];
            entry.brick.correctedY[entry.index] -= meanCorrection[1];
            entry.brick.correctedZ[entry.index] -= meanCorrection[2];
        }
        let afterDivergence = 0;
        for (const entry of occupied) afterDivergence += Math.abs(divergenceOf(entry, true));
        this.#solveCount += 1;
        this.#lastSolve = {
            sourceRevision,
            iterations: iterationCount,
            meanAbsoluteDivergenceBefore: occupied.length ? beforeDivergence / occupied.length : 0,
            meanAbsoluteDivergenceAfter: occupied.length ? afterDivergence / occupied.length : 0,
            removedMeanCorrectionMPerS: meanCorrection,
        };
        const result = fluidFreeze(this.#lastSolve, '$.sparseFluidSolveReceipt');
        logAdaptiveFluid(this.#logger, 'debug', 'sparse-grid-solve-complete', result);
        return result;
    }

    #sampleVelocity(positionM, corrected) {
        let result = [0, 0, 0];
        let weightTotal = 0;
        for (const entry of this.#weights(positionM)) {
            const cell = this.#getCell(entry.x, entry.y, entry.z);
            if (!cell || cell.brick.massKg[cell.index] <= EPSILON) continue;
            result = vectorAdd(result, vectorScale(this.#cellVelocity(entry.x, entry.y, entry.z, corrected), entry.weight));
            weightTotal += entry.weight;
        }
        return weightTotal > EPSILON ? vectorScale(result, 1 / weightTotal) : null;
    }

    gatherToPackets(packetInputs, {
        sourceRevision = this.#sourceRevision,
        transferMode = 'flip-pic',
        flipRatio = 0.95,
        preserveLinearMomentum = true,
    } = {}) {
        this.#assertAlive();
        this.#requireRevision(sourceRevision);
        if (!['pic', 'flip', 'flip-pic'].includes(transferMode)) {
            throw new RangeError('$.transferMode: expected pic, flip, or flip-pic');
        }
        const ratio = transferMode === 'pic' ? 0
            : transferMode === 'flip' ? 1
                : fluidFinite(flipRatio, '$.flipRatio', { minimum: 0, maximum: 1 });
        const allPackets = packetInputs.map(createAdaptiveFluidPacket);
        const packets = allPackets.filter(packet => packet.canonicalMassOwner);
        if (packets.some(packet => packet.sourceRevision !== sourceRevision)) {
            throw new AdaptiveFluidError(
                ADAPTIVE_FLUID_ERROR_CODES.REVISION_CONFLICT,
                'Grid gather packets do not match projected source revision',
                { sourceRevision, packetRevisions: [...new Set(packets.map(packet => packet.sourceRevision))] },
            );
        }
        const representationRevisionSignature = packets
            .map(packet => `${packet.id}@${packet.representationRevision}`)
            .sort().join('|');
        if (representationRevisionSignature !== this.#representationRevisionSignature) {
            throw new AdaptiveFluidError(
                ADAPTIVE_FLUID_ERROR_CODES.STALE_PROJECTION,
                'Grid gather packet representation differs from the scattered projection',
                {
                    expected: this.#representationRevisionSignature,
                    actual: representationRevisionSignature,
                },
            );
        }
        logAdaptiveFluid(this.#logger, 'debug', 'sparse-grid-gather-start', {
            packets: packets.length,
            transferMode,
        });
        const before = summarizeAdaptiveFluidConservation(packets);
        let gathered = packets.map(packet => {
            const base = this.#sampleVelocity(packet.positionM, false);
            const corrected = this.#sampleVelocity(packet.positionM, true);
            if (!base || !corrected) return packet;
            const flipVelocity = vectorAdd(packet.velocityMPerS, vectorSubtract(corrected, base));
            const velocityMPerS = vectorAdd(
                vectorScale(corrected, 1 - ratio),
                vectorScale(flipVelocity, ratio),
            );
            return createAdaptiveFluidPacket({ ...packet, velocityMPerS });
        });
        const beforeCorrection = summarizeAdaptiveFluidConservation(gathered);
        const momentumDelta = vectorSubtract(
            beforeCorrection.linearMomentumKgMPerS,
            before.linearMomentumKgMPerS,
        );
        const uniformCorrection = preserveLinearMomentum && before.massKg > 0
            ? vectorScale(momentumDelta, 1 / before.massKg)
            : [0, 0, 0];
        if (preserveLinearMomentum) {
            gathered = gathered.map(packet => createAdaptiveFluidPacket({
                ...packet,
                velocityMPerS: vectorSubtract(packet.velocityMPerS, uniformCorrection),
            }));
        }
        const after = summarizeAdaptiveFluidConservation(gathered);
        const massResidualKg = after.massKg - before.massKg;
        const momentumResidual = preserveLinearMomentum
            ? vectorSubtract(after.linearMomentumKgMPerS, before.linearMomentumKgMPerS)
            : [0, 0, 0];
        const tolerance = 1e-9 * Math.max(1, before.massKg, vectorLength(before.linearMomentumKgMPerS));
        const balanced = Math.abs(massResidualKg) <= tolerance
            && (!preserveLinearMomentum || vectorLength(momentumResidual) <= tolerance);
        if (!balanced) {
            throw new AdaptiveFluidError(
                ADAPTIVE_FLUID_ERROR_CODES.CONSERVATION_FAILURE,
                'Grid-to-packet gather failed conservation',
                { massResidualKg, momentumResidual, tolerance },
            );
        }
        this.#gatherCount += 1;
        const receipt = fluidFreeze({
            schema: SPARSE_FLUID_TRANSFER_SCHEMA,
            schemaVersion: SPARSE_FLUID_TRANSFER_VERSION,
            operation: 'grid-to-packet-gather',
            sourceRevision,
            representationRevisionSignature,
            projectionRevision: this.#projectionRevision,
            transferMode,
            flipRatio: ratio,
            canonicalMassOwner: 'packets',
            gridOwnedMassKg: 0,
            before,
            after,
            massResidualKg,
            momentumResidualKgMPerS: momentumResidual,
            removedUniformVelocityMPerS: uniformCorrection,
            ignoredRenderOnlySamples: allPackets.length - packets.length,
            balanced,
        }, '$.sparseFluidGatherReceipt');
        logAdaptiveFluid(this.#logger, 'debug', 'sparse-grid-gather-complete', {
            massResidualKg,
            momentumResidual: vectorLength(momentumResidual),
        });
        return Object.freeze({ packets: gathered, receipt });
    }

    cellSnapshot() {
        this.#assertAlive();
        const cells = [];
        for (const brick of [...this.#bricks.values()].sort((left, right) => (
            brickKey(...left.coordinates).localeCompare(brickKey(...right.coordinates))
        ))) {
            const [bx, by, bz] = brick.coordinates;
            for (let index = 0; index < brick.massKg.length; index += 1) {
                if (brick.massKg[index] <= EPSILON) continue;
                const lx = index % this.#brickSize;
                const ly = Math.floor(index / this.#brickSize) % this.#brickSize;
                const lz = Math.floor(index / (this.#brickSize * this.#brickSize));
                cells.push({
                    coordinates: [
                        bx * this.#brickSize + lx,
                        by * this.#brickSize + ly,
                        bz * this.#brickSize + lz,
                    ],
                    massKg: brick.massKg[index],
                    momentumKgMPerS: [
                        brick.momentumX[index], brick.momentumY[index], brick.momentumZ[index],
                    ],
                    velocityMPerS: [
                        brick.velocityX[index], brick.velocityY[index], brick.velocityZ[index],
                    ],
                    correctedVelocityMPerS: [
                        brick.correctedX[index], brick.correctedY[index], brick.correctedZ[index],
                    ],
                    pressurePa: brick.pressurePa[index],
                    divergencePerS: brick.divergencePerS[index],
                    occupancy: brick.occupancy[index],
                    surface: brick.surfaceMask[index],
                });
            }
        }
        return fluidFreeze(cells, '$.sparseFluidCells');
    }

    snapshot() {
        this.#assertAlive();
        return fluidFreeze({
            schema: SPARSE_FLUID_GRID_SNAPSHOT_SCHEMA,
            schemaVersion: SPARSE_FLUID_GRID_SNAPSHOT_VERSION,
            cellSizeM: this.#cellSizeM,
            brickSize: this.#brickSize,
            maxBricks: this.#maxBricks,
            projectionRevision: this.#projectionRevision,
            sourceRevision: this.#sourceRevision,
            representationRevisionSignature: this.#representationRevisionSignature,
            deviceGeneration: this.#deviceGeneration,
            allocationFailures: this.#allocationFailures,
            scatterCount: this.#scatterCount,
            solveCount: this.#solveCount,
            gatherCount: this.#gatherCount,
            lastSolve: this.#lastSolve,
            bricks: [...this.#bricks.values()].map(brick => ({
                coordinates: brick.coordinates,
                sourceRevision: brick.sourceRevision,
                occupancy: Array.from(brick.occupancy),
                surfaceMask: Array.from(brick.surfaceMask),
                channels: Object.fromEntries(CHANNEL_NAMES.map(name => [name, Array.from(brick[name])])),
            })).sort((left, right) => (
                brickKey(...left.coordinates).localeCompare(brickKey(...right.coordinates))
            )),
        }, '$.sparseFluidGridSnapshot');
    }

    restore(snapshotInput) {
        this.#assertAlive();
        const snapshot = fluidClone(snapshotInput, '$.sparseFluidGridSnapshot');
        if (snapshot.schema !== SPARSE_FLUID_GRID_SNAPSHOT_SCHEMA
            || snapshot.schemaVersion !== SPARSE_FLUID_GRID_SNAPSHOT_VERSION) {
            throw new TypeError('$.sparseFluidGridSnapshot: unsupported schema or version');
        }
        if (snapshot.cellSizeM !== this.#cellSizeM || snapshot.brickSize !== this.#brickSize
            || snapshot.maxBricks !== this.#maxBricks) {
            throw new AdaptiveFluidError(
                ADAPTIVE_FLUID_ERROR_CODES.REVISION_CONFLICT,
                'Sparse grid snapshot layout differs from this grid',
                {
                    expected: [this.#cellSizeM, this.#brickSize, this.#maxBricks],
                    actual: [snapshot.cellSizeM, snapshot.brickSize, snapshot.maxBricks],
                },
            );
        }
        if (!Array.isArray(snapshot.bricks) || snapshot.bricks.length > this.#maxBricks) {
            throw new TypeError('$.sparseFluidGridSnapshot.bricks: invalid brick collection');
        }
        const projectionRevision = fluidInteger(snapshot.projectionRevision, '$.projectionRevision');
        const sourceRevision = snapshot.sourceRevision === null
            ? null
            : fluidInteger(snapshot.sourceRevision, '$.sourceRevision');
        if (snapshot.representationRevisionSignature !== null
            && typeof snapshot.representationRevisionSignature !== 'string') {
            throw new TypeError('$.representationRevisionSignature: must be a string or null');
        }
        const representationRevisionSignature = snapshot.representationRevisionSignature;
        if ((sourceRevision === null && projectionRevision !== 0)
            || (sourceRevision !== null && projectionRevision === 0)
            || (sourceRevision === null && representationRevisionSignature !== null)) {
            throw new AdaptiveFluidError(
                ADAPTIVE_FLUID_ERROR_CODES.REVISION_CONFLICT,
                'Sparse grid snapshot has incoherent global projection revisions',
                { projectionRevision, sourceRevision, representationRevisionSignature },
            );
        }
        const cellCount = this.#brickSize ** 3;
        const restored = new Map();
        for (const stored of snapshot.bricks) {
            const coordinates = stored.coordinates;
            if (!Array.isArray(coordinates) || coordinates.length !== 3
                || coordinates.some(value => !Number.isSafeInteger(value))) {
                throw new TypeError('$.sparseFluidGridSnapshot.bricks.coordinates: invalid');
            }
            const key = brickKey(...coordinates);
            if (restored.has(key)) throw new TypeError(`Duplicate sparse brick '${key}'`);
            if (!Array.isArray(stored.occupancy) || stored.occupancy.length !== cellCount
                || stored.occupancy.some(value => value !== 0 && value !== 1)
                || !Array.isArray(stored.surfaceMask) || stored.surfaceMask.length !== cellCount
                || stored.surfaceMask.some(value => value !== 0 && value !== 1)) {
                throw new TypeError(`Sparse brick '${key}' has invalid mask lengths`);
            }
            const brickSourceRevision = fluidInteger(
                stored.sourceRevision,
                `$.bricks.${key}.sourceRevision`,
            );
            const brick = createBrick(...coordinates, cellCount, brickSourceRevision);
            brick.occupancy.set(stored.occupancy);
            brick.surfaceMask.set(stored.surfaceMask);
            for (const name of CHANNEL_NAMES) {
                const values = stored.channels?.[name];
                if (!Array.isArray(values) || values.length !== cellCount
                    || values.some(value => !Number.isFinite(value))
                    || (name === 'massKg' && values.some(value => value < 0))) {
                    throw new TypeError(`Sparse brick '${key}' channel '${name}' is invalid`);
                }
                brick[name].set(values);
            }
            for (let index = 0; index < cellCount; index += 1) {
                if (brick.surfaceMask[index] && !brick.occupancy[index]) {
                    throw new TypeError(`Sparse brick '${key}' marks an empty cell as surface`);
                }
                if ((brick.massKg[index] > EPSILON) !== Boolean(brick.occupancy[index])) {
                    throw new TypeError(`Sparse brick '${key}' mass and occupancy disagree`);
                }
            }
            const nonempty = brick.occupancy.some(value => value !== 0);
            if (nonempty && (sourceRevision === null || brickSourceRevision !== sourceRevision
                || representationRevisionSignature === null)) {
                throw new AdaptiveFluidError(
                    ADAPTIVE_FLUID_ERROR_CODES.REVISION_CONFLICT,
                    `Nonempty sparse brick '${key}' does not match the global projection revision`,
                    {
                        brickSourceRevision,
                        sourceRevision,
                        projectionRevision,
                        representationRevisionSignature,
                    },
                );
            }
            restored.set(key, brick);
        }
        const deviceGeneration = fluidInteger(snapshot.deviceGeneration, '$.deviceGeneration');
        const allocationFailures = fluidInteger(snapshot.allocationFailures, '$.allocationFailures');
        const scatterCount = fluidInteger(snapshot.scatterCount, '$.scatterCount');
        const solveCount = fluidInteger(snapshot.solveCount, '$.solveCount');
        const gatherCount = fluidInteger(snapshot.gatherCount, '$.gatherCount');
        this.#bricks = restored;
        this.#projectionRevision = projectionRevision;
        this.#sourceRevision = sourceRevision;
        this.#representationRevisionSignature = representationRevisionSignature;
        this.#deviceGeneration = deviceGeneration;
        this.#allocationFailures = allocationFailures;
        this.#scatterCount = scatterCount;
        this.#solveCount = solveCount;
        this.#gatherCount = gatherCount;
        this.#lastSolve = snapshot.lastSolve;
        logAdaptiveFluid(this.#logger, 'debug', 'sparse-grid-restore', {
            allocatedBricks: restored.size,
            sourceRevision: this.#sourceRevision,
            representationRevisionSignature: this.#representationRevisionSignature,
        });
        return this;
    }

    setDeviceGeneration(generation) {
        this.#assertAlive();
        this.#deviceGeneration = fluidInteger(generation, '$.deviceGeneration');
        return this.deviceRecreationPlan();
    }

    deviceRecreationPlan() {
        this.#assertAlive();
        const cellCapacity = this.#bricks.size * this.#brickSize ** 3;
        return fluidFreeze({
            schema: 'engine.matter.sparse-fluid-device-recreation-plan',
            schemaVersion: '1.0.0',
            deviceGeneration: this.#deviceGeneration,
            sourceRevision: this.#sourceRevision,
            representationRevisionSignature: this.#representationRevisionSignature,
            projectionRevision: this.#projectionRevision,
            cpuReferenceOnly: true,
            gpuExecutionAvailable: false,
            callerEncoderRequiredForFutureGpuProjection: true,
            allocatedBricks: this.#bricks.size,
            cellCapacity,
            uploadChannels: CHANNEL_NAMES.map(name => ({ name, byteLength: cellCapacity * 8 })),
            occupancyByteLength: cellCapacity,
            surfaceMaskByteLength: cellCapacity,
        }, '$.sparseFluidDeviceRecreationPlan');
    }

    stats() {
        this.#assertAlive();
        let occupiedCells = 0;
        let surfaceCells = 0;
        let projectedMassKg = 0;
        for (const brick of this.#bricks.values()) {
            for (let index = 0; index < brick.massKg.length; index += 1) {
                occupiedCells += brick.occupancy[index];
                surfaceCells += brick.surfaceMask[index];
                projectedMassKg += brick.massKg[index];
            }
        }
        return fluidFreeze({
            cellSizeM: this.#cellSizeM,
            brickSize: this.#brickSize,
            maxBricks: this.#maxBricks,
            allocatedBricks: this.#bricks.size,
            occupiedCells,
            surfaceCells,
            projectedMassKg,
            gridOwnedMassKg: 0,
            sourceRevision: this.#sourceRevision,
            projectionRevision: this.#projectionRevision,
            deviceGeneration: this.#deviceGeneration,
            allocationFailures: this.#allocationFailures,
            scatterCount: this.#scatterCount,
            solveCount: this.#solveCount,
            gatherCount: this.#gatherCount,
            lastSolve: this.#lastSolve,
        }, '$.sparseFluidGridStats');
    }

    destroy() {
        if (this.#destroyed) return;
        logAdaptiveFluid(this.#logger, 'debug', 'sparse-grid-destroy', {
            allocatedBricks: this.#bricks.size,
        });
        this.#bricks.clear();
        this.#destroyed = true;
    }
}

export function createSparseFluidBrickGrid(options) {
    return new SparseFluidBrickGrid(options);
}

export function restoreSparseFluidBrickGrid(snapshot, options = {}) {
    return new SparseFluidBrickGrid({
        ...options,
        cellSizeM: snapshot.cellSizeM,
        brickSize: snapshot.brickSize,
        maxBricks: snapshot.maxBricks,
        snapshot,
    });
}
