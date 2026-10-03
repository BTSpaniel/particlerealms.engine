// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Deterministic CPU reference for mixed-resolution SPH and refinement policy. */

import {
    ADAPTIVE_FLUID_ANALYSIS_SCHEMA,
    ADAPTIVE_FLUID_ANALYSIS_VERSION,
    ADAPTIVE_FLUID_ERROR_CODES,
    AdaptiveFluidError,
    createAdaptiveFluidPacket,
    fluidFinite,
    fluidFreeze,
    fluidInteger,
    logAdaptiveFluid,
    resolveAdaptiveFluidQualityProfile,
    summarizeAdaptiveFluidConservation,
} from './AdaptiveFluidContracts.js';
import {
    FLUID_REFERENCE_EPSILON as EPSILON,
    addVector3 as add,
    clampUnit as clamp01,
    crossVector3 as cross,
    dotVector3 as dot,
    normalizeVector3 as normalized,
    scaleVector3 as scale,
    subtractVector3 as subtract,
    vector3Length as length,
} from './FluidReferenceMath.js';

export const ADAPTIVE_SPH_KERNEL_SCHEMA = 'engine.matter.adaptive-sph-kernel-profile';
export const ADAPTIVE_SPH_KERNEL_VERSION = '1.0.0';
export const ADAPTIVE_SPH_REFINEMENT_SCHEMA = 'engine.matter.adaptive-sph-refinement-plan';
export const ADAPTIVE_SPH_REFINEMENT_VERSION = '1.0.0';
export const ADAPTIVE_SPH_STEP_SCHEMA = 'engine.matter.adaptive-sph-step';
export const ADAPTIVE_SPH_STEP_VERSION = '1.0.0';

/** Retained uniform/mixed-volume SPH lane for continuous browser experiments.
 * Reuses the reference kernels, symmetric pair traversal and domain boundaries.
 * Validates immutable particle properties once instead of rebuilding diagnostic
 * graphs every substep. Nonnegative pressure avoids free-surface tensile clumps.
 * The caller may modify kinematics for two-way contact, never masses or radii.
 * Optional phaseDynamics(packet) supplies liquid/mobile flags, dragPerSecond,
 * accelerationMPerS2 and collisionRadiusM. Nonliquid or immobile parcels stay in
 * the same inventory but do not enter liquid pressure pairs. External impulses
 * include gravity, phase forces and drag; thermal/species ownership stays with
 * the caller. Membership changes require a new solver with conserved inputs.
 */
export function createContinuousSphSolver(packetInputs, {
    kernelProfile = createSymmetricSphKernelProfile(), viscosity = .1, bounds = null,
    gravityMPerS2 = [0, -9.81, 0], restitution = .02, phaseDynamics = null,
} = {}) {
    if (phaseDynamics !== null && typeof phaseDynamics !== 'function') throw new TypeError('phaseDynamics must be a function');
    const packets = sortedPhysicalPackets(packetInputs).map(p => ({ ...p,
        positionM: [...p.positionM], velocityMPerS: [...p.velocityMPerS] }));
    const kernel = createSymmetricSphKernelProfile(kernelProfile);
    const viscousScale = fluidFinite(viscosity, '$.viscosity', { minimum: 0, maximum: 10 });
    const bounce = fluidFinite(restitution, '$.restitution', { minimum: 0, maximum: 1 });
    const gravity = gravityMPerS2.map((v, i) => fluidFinite(v, `$.gravity[${i}]`));
    if (gravity.length !== 3) throw new TypeError('Gravity requires three components');
    if (bounds && (!Array.isArray(bounds.min) || !Array.isArray(bounds.max)
        || bounds.min.length !== 3 || bounds.max.length !== 3
        || bounds.min.some((n, i) => !Number.isFinite(n) || !Number.isFinite(bounds.max[i]) || n >= bounds.max[i]))) {
        throw new TypeError('Invalid SPH domain bounds');
    }
    const density = new Float64Array(packets.length), pressure = new Float64Array(packets.length);
    const acceleration = new Float64Array(packets.length * 3);
    const liquid = new Uint8Array(packets.length), mobile = new Uint8Array(packets.length);
    const drag = new Float64Array(packets.length), collisionRadius = new Float64Array(packets.length);
    const external = new Float64Array(packets.length * 3);
    const mass = packets.reduce((sum, p) => sum + p.massKg, 0);
    const properties = packets.map(p => [p.massKg, p.representedVolumeM3, p.smoothingRadiusM, p.restDensityKgM3]);
    let steps = 0;
    function step(dtSeconds) {
        const dt = fluidFinite(dtSeconds, '$.dtSeconds', { minimum: Number.MIN_VALUE, maximum: .01 });
        if (packets.length !== properties.length) throw new Error('Continuous SPH particle membership changed');
        const before = [0, 0, 0], after = [0, 0, 0], boundaryImpulse = [0, 0, 0];
        let maximumSpeed = 0;
        for (let i = 0; i < packets.length; i++) {
            const p = packets[i];
            if ([p.massKg, p.representedVolumeM3, p.smoothingRadiusM, p.restDensityKgM3].some((n, axis) => n !== properties[i][axis])) {
                throw new Error('Continuous SPH immutable particle properties changed');
            }
            if (p.positionM.length !== 3 || p.velocityMPerS.length !== 3
                || ![...p.positionM, ...p.velocityMPerS].every(Number.isFinite)) throw new Error('Invalid continuous SPH kinematics');
            maximumSpeed = Math.max(maximumSpeed, length(p.velocityMPerS));
            const motion = phaseDynamics?.(p);
            liquid[i] = motion?.liquid === false ? 0 : 1;
            mobile[i] = motion?.mobile === false ? 0 : 1;
            drag[i] = motion?.dragPerSecond ?? 0;
            collisionRadius[i] = motion?.collisionRadiusM ?? .5 * Math.cbrt(p.representedVolumeM3);
            const applied = motion?.accelerationMPerS2 ?? gravity;
            if (!Number.isFinite(drag[i]) || drag[i] < 0 || !Number.isFinite(collisionRadius[i]) || collisionRadius[i] <= 0
                || applied.length !== 3 || !applied.every(Number.isFinite)) throw new RangeError('Invalid parcel phase dynamics');
            density[i] = p.massKg * poly6(0, p.smoothingRadiusM);
            for (let axis = 0; axis < 3; axis++) {
                external[i * 3 + axis] = mobile[i] ? applied[axis] : 0;
                acceleration[i * 3 + axis] = external[i * 3 + axis];
                before[axis] += p.massKg * p.velocityMPerS[axis];
            }
        }
        const stableDt = .4 * Math.min(...packets.map(p => p.smoothingRadiusM)) / (kernel.speedOfSoundMPerS + maximumSpeed);
        if (dt > stableDt) throw new RangeError(`SPH step exceeds acoustic/advection CFL bound ${stableDt}`);
        const pairs = [];
        const spatial = visitSpatialPairCandidates(packets, (i, j) => {
            if (!liquid[i] || !liquid[j] || !mobile[i] || !mobile[j]) return;
            const a = packets[i], b = packets[j], displacement = subtract(a.positionM, b.positionM);
            const distance = length(displacement);
            const h = symmetricSmoothingRadius(a.smoothingRadiusM, b.smoothingRadiusM, kernel.smoothingPolicy);
            if (distance >= h) return;
            const weight = poly6(distance, h);
            density[i] += b.massKg * weight; density[j] += a.massKg * weight;
            if (distance > EPSILON) pairs.push([i, j, distance, h, poly6Gradient(displacement, distance, h)]);
        });
        for (let i = 0; i < packets.length; i++) pressure[i] = Math.max(0, kernel.pressureStiffnessPa * (density[i] / packets[i].restDensityKgM3 - 1));
        for (const [i, j, distance, h, gradient] of pairs) {
            const a = packets[i], b = packets[j];
            const pressureCoefficient = -a.massKg * b.massKg * (pressure[i] / density[i] ** 2 + pressure[j] / density[j] ** 2);
            const viscousCoefficient = viscousScale * a.massKg * b.massKg * viscosityKernel(distance, h) / (density[i] * density[j]);
            for (let axis = 0; axis < 3; axis++) {
                const force = pressureCoefficient * gradient[axis] + viscousCoefficient * (b.velocityMPerS[axis] - a.velocityMPerS[axis]);
                acceleration[i * 3 + axis] += force / a.massKg;
                acceleration[j * 3 + axis] -= force / b.massKg;
            }
        }
        const externalImpulse = [0, 0, 0];
        for (let i = 0; i < packets.length; i++) {
            const p = packets[i];
            const velocity = p.velocityMPerS.map((n, axis) => {
                const accelerated = n + acceleration[i * 3 + axis] * dt;
                const value = mobile[i] ? accelerated * Math.exp(-drag[i] * dt) : n;
                externalImpulse[axis] += p.massKg * (external[i * 3 + axis] * dt + value - accelerated);
                return value;
            });
            const position = p.positionM.map((n, axis) => n + (mobile[i] ? velocity[axis] * dt : 0));
            const bounded = mobile[i] ? applyDomainBoundary(position, velocity, collisionRadius[i], bounds, bounce)
                : { position, velocity, impulse: [0, 0, 0] };
            p.positionM = bounded.position; p.velocityMPerS = bounded.velocity;
            for (let axis = 0; axis < 3; axis++) {
                after[axis] += p.massKg * p.velocityMPerS[axis];
                boundaryImpulse[axis] += p.massKg * bounded.impulse[axis];
            }
        }
        const residual = length(after.map((n, axis) => n - before[axis] - externalImpulse[axis] - boundaryImpulse[axis]));
        if (residual > 1e-8 * Math.max(1, mass, length(before))) throw new Error('Continuous SPH momentum conservation failed');
        steps++;
        return { balanced: true, steps, massKg: mass, momentumResidual: residual, pairCount: pairs.length,
            occupiedCells: spatial.occupiedCells, maximumSpeed, stableDt, externalImpulse };
    }
    return Object.freeze({ packets, step });
}

const PI = Math.PI;
const CHILD_SUFFIX = /^(.*)\.c([0-7])$/;
const TRUSTED_ANALYSES = new WeakSet();

function outerAdd(matrix, left, right, factor) {
    for (let row = 0; row < 3; row += 1) {
        for (let column = 0; column < 3; column += 1) {
            matrix[row * 3 + column] += left[row] * right[column] * factor;
        }
    }
}

function matrixNorm(matrix) {
    return Math.sqrt(matrix.reduce((sum, value) => sum + value * value, 0));
}

function sortedPhysicalPackets(inputs, maximumReferencePackets = 4096) {
    if (!Array.isArray(inputs) || inputs.length === 0) {
        throw new TypeError('$.packets: must be a non-empty array');
    }
    const maximum = fluidInteger(maximumReferencePackets, '$.maximumReferencePackets', {
        minimum: 1,
        maximum: 1_000_000,
    });
    if (inputs.length > maximum) {
        throw new AdaptiveFluidError(
            ADAPTIVE_FLUID_ERROR_CODES.CAPACITY_EXHAUSTED,
            `CPU SPH reference received ${inputs.length} packets; safety budget is ${maximum}`,
            { packetCount: inputs.length, maximumReferencePackets: maximum },
        );
    }
    const ids = new Set();
    const packets = inputs.map(createAdaptiveFluidPacket).filter(packet => packet.canonicalMassOwner);
    packets.sort((left, right) => left.id.localeCompare(right.id));
    for (const packet of packets) {
        if (ids.has(packet.id)) throw new TypeError(`$.packets: duplicate packet id '${packet.id}'`);
        ids.add(packet.id);
    }
    if (packets.length === 0) throw new TypeError('$.packets: requires at least one physical packet');
    return packets;
}

export function createSymmetricSphKernelProfile({
    smoothingPolicy = 'arithmetic-mean',
    pressureStiffnessPa = 1800,
    speedOfSoundMPerS = 4,
    predictionHorizonSeconds = 0.12,
} = {}) {
    if (!['arithmetic-mean', 'root-mean-square', 'maximum'].includes(smoothingPolicy)) {
        throw new RangeError('$.smoothingPolicy: unsupported symmetric smoothing policy');
    }
    return fluidFreeze({
        schema: ADAPTIVE_SPH_KERNEL_SCHEMA,
        schemaVersion: ADAPTIVE_SPH_KERNEL_VERSION,
        smoothingPolicy,
        pressureStiffnessPa: fluidFinite(pressureStiffnessPa, '$.pressureStiffnessPa', { minimum: 0 }),
        speedOfSoundMPerS: fluidFinite(speedOfSoundMPerS, '$.speedOfSoundMPerS', {
            minimum: Number.MIN_VALUE,
        }),
        predictionHorizonSeconds: fluidFinite(
            predictionHorizonSeconds,
            '$.predictionHorizonSeconds',
            { minimum: 0 },
        ),
    }, '$.adaptiveSphKernelProfile');
}

export function symmetricSmoothingRadius(leftRadiusM, rightRadiusM, policy = 'arithmetic-mean') {
    const left = fluidFinite(leftRadiusM, '$.leftRadiusM', { minimum: Number.MIN_VALUE });
    const right = fluidFinite(rightRadiusM, '$.rightRadiusM', { minimum: Number.MIN_VALUE });
    if (policy === 'arithmetic-mean') return 0.5 * (left + right);
    if (policy === 'root-mean-square') return Math.sqrt(0.5 * (left * left + right * right));
    if (policy === 'maximum') return Math.max(left, right);
    throw new RangeError(`$.policy: unsupported symmetric smoothing policy '${policy}'`);
}

function poly6(distanceM, smoothingRadiusM) {
    if (distanceM >= smoothingRadiusM) return 0;
    const remaining = smoothingRadiusM * smoothingRadiusM - distanceM * distanceM;
    return 315 * remaining ** 3 / (64 * PI * smoothingRadiusM ** 9);
}

function poly6Gradient(displacement, distanceM, smoothingRadiusM) {
    if (distanceM <= EPSILON || distanceM >= smoothingRadiusM) return [0, 0, 0];
    const remaining = smoothingRadiusM * smoothingRadiusM - distanceM * distanceM;
    const factor = -945 * remaining ** 2 / (32 * PI * smoothingRadiusM ** 9);
    return scale(displacement, factor);
}

function visitSpatialPairCandidates(packets, visit, cellSizeScale = 1) {
    let cellSizeM = 0;
    for (const packet of packets) cellSizeM = Math.max(cellSizeM, packet.smoothingRadiusM);
    cellSizeM *= cellSizeScale;
    const coordinates = packets.map(packet => packet.positionM.map(
        value => Math.floor(value / cellSizeM),
    ));
    const cells = new Map();
    for (let index = 0; index < packets.length; index += 1) {
        const key = coordinates[index].join(',');
        const cell = cells.get(key);
        if (cell) cell.push(index);
        else cells.set(key, [index]);
    }
    let candidatePairCount = 0;
    for (let leftIndex = 0; leftIndex < packets.length; leftIndex += 1) {
        const [cellX, cellY, cellZ] = coordinates[leftIndex];
        const candidates = [];
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
            for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
                for (let offsetZ = -1; offsetZ <= 1; offsetZ += 1) {
                    const cell = cells.get(
                        `${cellX + offsetX},${cellY + offsetY},${cellZ + offsetZ}`,
                    );
                    if (!cell) continue;
                    for (const rightIndex of cell) {
                        if (rightIndex > leftIndex) candidates.push(rightIndex);
                    }
                }
            }
        }
        candidates.sort((left, right) => left - right);
        for (const rightIndex of candidates) {
            candidatePairCount += 1;
            visit(leftIndex, rightIndex);
        }
    }
    return {
        candidatePairCount,
        cellSizeM,
        occupiedCells: cells.size,
    };
}

function viscosityKernel(distanceM, smoothingRadiusM) {
    if (distanceM >= smoothingRadiusM) return 0;
    return 45 * (smoothingRadiusM - distanceM) / (PI * smoothingRadiusM ** 6);
}

/** Shared sparse topology builder; no density, force, or integration work. */
export function buildAdaptiveSphNeighborhood(packetInputs, {
    kernelProfile = createSymmetricSphKernelProfile(),
    maximumReferencePackets = 4096,
    maximumPairs = Number.MAX_SAFE_INTEGER,
    supportPaddingRatio = 0,
} = {}) {
    const packets = sortedPhysicalPackets(packetInputs, maximumReferencePackets);
    const kernel = createSymmetricSphKernelProfile(kernelProfile);
    const pairLimit = fluidInteger(maximumPairs, '$.maximumPairs');
    const padding = fluidFinite(supportPaddingRatio, '$.supportPaddingRatio', {
        minimum: 0, maximum: 0.001,
    });
    const interactions = [];
    const spatial = visitSpatialPairCandidates(packets, (leftIndex, rightIndex) => {
        const left = packets[leftIndex];
        const right = packets[rightIndex];
        const distanceM = length(subtract(left.positionM, right.positionM));
        const smoothingRadiusM = symmetricSmoothingRadius(
            left.smoothingRadiusM, right.smoothingRadiusM, kernel.smoothingPolicy,
        );
        if (distanceM >= smoothingRadiusM * (1 + padding)) return;
        if (interactions.length >= pairLimit) {
            throw new AdaptiveFluidError(
                ADAPTIVE_FLUID_ERROR_CODES.CAPACITY_EXHAUSTED,
                'Adaptive SPH neighborhood exceeds its complete-pair budget',
                { maximumPairs: pairLimit, packetCount: packets.length },
            );
        }
        interactions.push({ leftIndex, rightIndex, distanceM, smoothingRadiusM });
    }, 1 + padding);
    return fluidFreeze({ packets, kernelProfile: kernel, interactions, summary: spatial },
        '$.adaptiveSphNeighborhood');
}

export function classifyAdaptiveSphPacket(packetInput, metricInput) {
    const packet = createAdaptiveFluidPacket(packetInput);
    const metric = metricInput;
    if (!packet || !metric || !Number.isFinite(metric.neighborCount)
        || !Number.isFinite(metric.neighborDeficiency) || !Number.isFinite(metric.surfaceIndicator)) {
        throw new TypeError('Adaptive SPH classification requires a packet and finite surface metrics');
    }
    if (packet.boundaryDistanceM <= packet.smoothingRadiusM * 0.55) return 'boundary-contact';
    if (packet.secondaryKind === 'bubble' || packet.secondaryKind === 'foam'
        || packet.gasFraction >= 0.35) return 'bubble';
    if (packet.secondaryKind === 'spray') return 'spray';
    if (packet.secondaryKind === 'droplet' || metric.neighborCount <= 2) return 'droplet';
    if (metric.neighborDeficiency >= 0.45 || metric.surfaceIndicator >= 0.58) return 'surface';
    if (metric.neighborDeficiency >= 0.18 || metric.surfaceIndicator >= 0.28) return 'near-surface';
    return 'bulk';
}

function errorScore(packet, metric, profile, kernelProfile) {
    const densityError = clamp01(Math.abs(metric.densityKgM3 / packet.restDensityKgM3 - 1));
    const timeScale = kernelProfile.predictionHorizonSeconds;
    const divergenceError = clamp01(Math.abs(metric.divergencePerS) * timeScale);
    const vorticityError = clamp01(metric.vorticityMagnitudePerS * timeScale * 0.5);
    const velocityGradientError = clamp01(metric.velocityGradientNormPerS * timeScale * 0.5);
    const surfaceCurvatureError = clamp01(metric.curvaturePerM * packet.smoothingRadiusM);
    const neighborDeficiency = metric.neighborDeficiency;
    const boundaryProximity = clamp01(1 - packet.boundaryDistanceM / Math.max(EPSILON, packet.smoothingRadiusM));
    const predictedCollision = packet.predictedImpactSeconds < Number.MAX_VALUE
        ? clamp01(1 - packet.predictedImpactSeconds / Math.max(EPSILON, timeScale))
        : 0;
    const weights = [
        densityError * 0.24,
        divergenceError * 0.13,
        vorticityError * 0.1,
        velocityGradientError * 0.12,
        surfaceCurvatureError * 0.13,
        neighborDeficiency * 0.16,
        boundaryProximity * 0.16,
        predictedCollision * 0.2,
        packet.inspectionWeight * 0.3,
    ];
    const maximum = Math.max(...weights);
    const sum = weights.reduce((total, value) => total + value, 0);
    const resolutionPressure = packet.resolutionLevel >= profile.maxResolutionLevel ? 0 : 0.04;
    return {
        densityError,
        divergenceError,
        vorticityError,
        velocityGradientError,
        surfaceCurvatureError,
        neighborDeficiency,
        boundaryProximity,
        predictedCollision,
        inspection: packet.inspectionWeight,
        total: clamp01(maximum + sum * 0.48 + resolutionPressure),
    };
}

export function analyzeAdaptiveSphPackets(packetInputs, {
    qualityProfile = 'balanced',
    kernelProfile = createSymmetricSphKernelProfile(),
    logger = null,
    maximumReferencePackets = 4096,
} = {}) {
    const started = typeof performance === 'object' ? performance.now() : Date.now();
    const profile = resolveAdaptiveFluidQualityProfile(qualityProfile);
    const neighborhood = buildAdaptiveSphNeighborhood(packetInputs, {
        kernelProfile, maximumReferencePackets,
    });
    const { packets, kernelProfile: kernel } = neighborhood;
    logAdaptiveFluid(logger, 'debug', 'sph-analysis-start', { packetCount: packets.length });
    const working = packets.map(packet => ({
        packet,
        densityKgM3: packet.massKg * poly6(0, packet.smoothingRadiusM),
        neighborCount: 0,
        divergencePerS: 0,
        vorticityPerS: [0, 0, 0],
        velocityGradientPerS: Array(9).fill(0),
        densityGradientKgM4: [0, 0, 0],
        neighborDistanceSumM: 0,
    }));
    const pairs = [];
    const spatialCandidates = neighborhood.summary;
    for (const interaction of neighborhood.interactions) {
        const { leftIndex, rightIndex, distanceM, smoothingRadiusM } = interaction;
        const left = packets[leftIndex];
        const right = packets[rightIndex];
        const displacement = subtract(left.positionM, right.positionM);
        const weight = poly6(distanceM, smoothingRadiusM);
        const gradient = poly6Gradient(displacement, distanceM, smoothingRadiusM);
        working[leftIndex].densityKgM3 += right.massKg * weight;
        working[rightIndex].densityKgM3 += left.massKg * weight;
        working[leftIndex].neighborCount += 1;
        working[rightIndex].neighborCount += 1;
        working[leftIndex].neighborDistanceSumM += distanceM;
        working[rightIndex].neighborDistanceSumM += distanceM;
        pairs.push({ leftIndex, rightIndex, distanceM, smoothingRadiusM, gradient });
    }
    for (const pair of pairs) {
        const left = packets[pair.leftIndex];
        const right = packets[pair.rightIndex];
        const leftWork = working[pair.leftIndex];
        const rightWork = working[pair.rightIndex];
        const velocityDelta = subtract(right.velocityMPerS, left.velocityMPerS);
        const leftFactor = right.massKg / Math.max(EPSILON, rightWork.densityKgM3);
        const rightFactor = left.massKg / Math.max(EPSILON, leftWork.densityKgM3);
        leftWork.divergencePerS += leftFactor * dot(velocityDelta, pair.gradient);
        rightWork.divergencePerS += rightFactor * dot(scale(velocityDelta, -1), scale(pair.gradient, -1));
        leftWork.vorticityPerS = add(
            leftWork.vorticityPerS,
            scale(cross(velocityDelta, pair.gradient), leftFactor),
        );
        rightWork.vorticityPerS = add(
            rightWork.vorticityPerS,
            scale(cross(scale(velocityDelta, -1), scale(pair.gradient, -1)), rightFactor),
        );
        outerAdd(leftWork.velocityGradientPerS, velocityDelta, pair.gradient, leftFactor);
        outerAdd(rightWork.velocityGradientPerS, scale(velocityDelta, -1), scale(pair.gradient, -1), rightFactor);
        leftWork.densityGradientKgM4 = add(
            leftWork.densityGradientKgM4,
            scale(pair.gradient, right.massKg),
        );
        rightWork.densityGradientKgM4 = add(
            rightWork.densityGradientKgM4,
            scale(pair.gradient, -left.massKg),
        );
    }
    const metrics = working.map(work => {
        const packet = work.packet;
        const targetMinimum = Math.max(1, packet.targetNeighborRange[0] ?? profile.targetNeighborRange[0]);
        const deficiency = clamp01((targetMinimum - work.neighborCount) / targetMinimum);
        const densityGradientMagnitude = length(work.densityGradientKgM4);
        const surfaceIndicator = clamp01(
            densityGradientMagnitude * packet.smoothingRadiusM
            / Math.max(EPSILON, work.densityKgM3),
        );
        const curvaturePerM = surfaceIndicator / Math.max(EPSILON, packet.smoothingRadiusM);
        const base = {
            id: packet.id,
            densityKgM3: work.densityKgM3,
            pressurePa: kernel.pressureStiffnessPa
                * (work.densityKgM3 / packet.restDensityKgM3 - 1),
            neighborCount: work.neighborCount,
            meanNeighborDistanceM: work.neighborCount > 0
                ? work.neighborDistanceSumM / work.neighborCount
                : 0,
            divergencePerS: work.divergencePerS,
            vorticityPerS: work.vorticityPerS,
            vorticityMagnitudePerS: length(work.vorticityPerS),
            velocityGradientPerS: work.velocityGradientPerS,
            velocityGradientNormPerS: matrixNorm(work.velocityGradientPerS),
            densityGradientKgM4: work.densityGradientKgM4,
            surfaceNormal: normalized(scale(work.densityGradientKgM4, -1)),
            surfaceIndicator,
            curvaturePerM,
            neighborDeficiency: deficiency,
        };
        const errors = errorScore(packet, base, profile, kernel);
        return {
            ...base,
            classification: classifyAdaptiveSphPacket(packet, base),
            errors,
            refinementScore: errors.total,
        };
    });
    let neighborCountTotal = 0;
    let maximumNeighbors = 0;
    let densityErrorTotal = 0;
    let maximumDensityError = 0;
    for (const metric of metrics) {
        neighborCountTotal += metric.neighborCount;
        maximumNeighbors = Math.max(maximumNeighbors, metric.neighborCount);
        densityErrorTotal += metric.errors.densityError;
        maximumDensityError = Math.max(maximumDensityError, metric.errors.densityError);
    }
    const elapsedMs = (typeof performance === 'object' ? performance.now() : Date.now()) - started;
    const result = fluidFreeze({
        schema: ADAPTIVE_FLUID_ANALYSIS_SCHEMA,
        schemaVersion: ADAPTIVE_FLUID_ANALYSIS_VERSION,
        kernelProfile: kernel,
        qualityProfile: profile.name,
        packets,
        metrics,
        interactions: pairs,
        summary: {
            physicalPackets: packets.length,
            pairCount: pairs.length,
            candidatePairCount: spatialCandidates.candidatePairCount,
            occupiedNeighborCells: spatialCandidates.occupiedCells,
            neighborCellSizeM: spatialCandidates.cellSizeM,
            neighborSearch: 'uniform-cell-linked-list',
            meanNeighbors: neighborCountTotal / packets.length,
            maximumNeighbors,
            meanDensityError: densityErrorTotal / packets.length,
            maximumDensityError,
            analysisMs: Math.max(0, elapsedMs),
        },
    }, '$.adaptiveSphAnalysis');
    TRUSTED_ANALYSES.add(result);
    logAdaptiveFluid(logger, 'debug', 'sph-analysis-complete', result.summary);
    return result;
}

function sameStrictData(left, right) {
    if (Object.is(left, right)) return true;
    if (typeof left !== typeof right || left === null || right === null) return false;
    if (Array.isArray(left) || Array.isArray(right)) {
        return Array.isArray(left) && Array.isArray(right)
            && left.length === right.length
            && left.every((value, index) => sameStrictData(value, right[index]));
    }
    if (typeof left !== 'object') return false;
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return leftKeys.length === rightKeys.length
        && leftKeys.every((key, index) => key === rightKeys[index]
            && sameStrictData(left[key], right[key]));
}

function requirePreparedAnalysis(preparedAnalysis, packets, qualityProfile, kernelProfile) {
    if (!TRUSTED_ANALYSES.has(preparedAnalysis)
        || preparedAnalysis.schema !== ADAPTIVE_FLUID_ANALYSIS_SCHEMA
        || preparedAnalysis.schemaVersion !== ADAPTIVE_FLUID_ANALYSIS_VERSION) {
        throw new TypeError('$.preparedAnalysis: must be a live analysis returned by analyzeAdaptiveSphPackets');
    }
    if (preparedAnalysis.qualityProfile !== qualityProfile
        || !sameStrictData(preparedAnalysis.kernelProfile, kernelProfile)
        || !sameStrictData(preparedAnalysis.packets, packets)) {
        throw new AdaptiveFluidError(
            ADAPTIVE_FLUID_ERROR_CODES.STALE_PROJECTION,
            'Prepared SPH analysis does not match the exact solver input',
        );
    }
    return preparedAnalysis;
}

function emptyResidencyState() {
    return { schema: 'engine.matter.adaptive-sph-residency', schemaVersion: '1.0.0', records: {} };
}

function mergeParentId(id) {
    return CHILD_SUFFIX.exec(id)?.[1] ?? null;
}

export function createAdaptiveSphRefinementPlan(analysis, {
    qualityProfile = analysis?.qualityProfile ?? 'balanced',
    timeSeconds = 0,
    residencyState = emptyResidencyState(),
    cooldownSeconds = 0.35,
    maximumSplits = 32,
    maximumMerges = 32,
    targetPhysicalPackets = null,
    forceTargetCoarsening = false,
} = {}) {
    if (analysis?.schema !== ADAPTIVE_FLUID_ANALYSIS_SCHEMA) {
        throw new TypeError('$.analysis: must be an adaptive SPH analysis');
    }
    const profile = resolveAdaptiveFluidQualityProfile(qualityProfile);
    const now = fluidFinite(timeSeconds, '$.timeSeconds', { minimum: 0 });
    const cooldown = fluidFinite(cooldownSeconds, '$.cooldownSeconds', { minimum: 0 });
    fluidInteger(maximumSplits, '$.maximumSplits', { maximum: 1_000_000 });
    fluidInteger(maximumMerges, '$.maximumMerges', { maximum: 1_000_000 });
    const targetCount = targetPhysicalPackets == null
        ? null
        : fluidInteger(targetPhysicalPackets, '$.targetPhysicalPackets', {
            minimum: 1,
            maximum: 1_000_000_000,
        });
    if (typeof forceTargetCoarsening !== 'boolean') {
        throw new TypeError('$.forceTargetCoarsening: must be boolean');
    }
    const hardCoarsening = forceTargetCoarsening
        && targetCount !== null
        && targetCount < analysis.packets.length;
    const priorRecords = residencyState?.records && typeof residencyState.records === 'object'
        ? residencyState.records
        : {};
    const records = {};
    const candidates = [];
    const lowGroups = new Map();
    for (let index = 0; index < analysis.packets.length; index += 1) {
        const packet = analysis.packets[index];
        const metric = analysis.metrics[index];
        const previous = priorRecords[packet.id] ?? {};
        const lastTransitionSeconds = Math.min(now, Number(previous.lastTransitionSeconds) || 0);
        const cool = now - lastTransitionSeconds >= cooldown;
        const lowSinceSeconds = metric.refinementScore <= profile.mergeThreshold
            ? Math.min(now, Number(previous.lowSinceSeconds ?? now))
            : null;
        records[packet.id] = { lowSinceSeconds, lastTransitionSeconds };
        if (cool && metric.refinementScore >= profile.refineThreshold
            && packet.resolutionLevel < profile.maxResolutionLevel) {
            candidates.push({ id: packet.id, score: metric.refinementScore, handle: packet.handle });
        }
        const parentId = mergeParentId(packet.id);
        if (parentId && (hardCoarsening || (cool && lowSinceSeconds !== null
            && now - lowSinceSeconds >= profile.mergeResidencySeconds))) {
            if (!lowGroups.has(parentId)) lowGroups.set(parentId, []);
            lowGroups.get(parentId).push({ packet, metric });
        }
    }
    candidates.sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
    let split = candidates.slice(0, maximumSplits);
    let merge = [];
    for (const [parentId, group] of [...lowGroups.entries()].sort(([left], [right]) => left.localeCompare(right))) {
        if (group.length !== 8) continue;
        const ordinals = group.map(entry => Number(CHILD_SUFFIX.exec(entry.packet.id)[2])).sort((a, b) => a - b);
        const compatible = ordinals.every((value, index) => value === index)
            && group.every(entry => entry.packet.regionId === group[0].packet.regionId)
            && group.every(entry => entry.packet.definitionId === group[0].packet.definitionId)
            && group.every(entry => entry.packet.phase === group[0].packet.phase)
            && group.every(entry => entry.packet.componentId === group[0].packet.componentId)
            && group.every(entry => entry.packet.sourceRevision === group[0].packet.sourceRevision)
            && group.every(entry => entry.packet.resolutionLevel === group[0].packet.resolutionLevel)
            && group.every(entry => Math.abs(
                entry.packet.smoothingRadiusM - group[0].packet.smoothingRadiusM,
            ) <= 1e-12 * Math.max(1, group[0].packet.smoothingRadiusM));
        if (!compatible) continue;
        merge.push({
            parentId,
            childIds: group.map(entry => entry.packet.id).sort(),
            handles: group.map(entry => entry.packet.handle),
            score: Math.max(...group.map(entry => entry.metric.refinementScore)),
        });
    }
    if (hardCoarsening) {
        merge.sort((left, right) => left.score - right.score
            || left.parentId.localeCompare(right.parentId));
    }
    merge = merge.slice(0, maximumMerges);
    if (targetCount !== null) {
        const packetDelta = targetCount - analysis.packets.length;
        if (packetDelta > 0) {
            // A canonical octree split replaces one packet with eight children.
            // Never schedule a partial seven-slot transition or a merge that
            // moves away from the caller's bounded target.
            split = split.slice(0, Math.floor(packetDelta / 7));
            merge = [];
        } else if (packetDelta < 0) {
            split = [];
            merge = merge.slice(0, Math.floor(-packetDelta / 7));
        } else {
            split = [];
            merge = [];
        }
    }
    return fluidFreeze({
        schema: ADAPTIVE_SPH_REFINEMENT_SCHEMA,
        schemaVersion: ADAPTIVE_SPH_REFINEMENT_VERSION,
        qualityProfile: profile.name,
        timeSeconds: now,
        split,
        merge,
        residencyState: { schema: 'engine.matter.adaptive-sph-residency', schemaVersion: '1.0.0', records },
    }, '$.adaptiveSphRefinementPlan');
}

export function createAdaptiveSphTransitionShells(packetInputs, analysis, {
    shellWidth = 1.5,
    maximumReferencePackets = 4096,
} = {}) {
    const packets = sortedPhysicalPackets(packetInputs, maximumReferencePackets);
    if (analysis?.schema !== ADAPTIVE_FLUID_ANALYSIS_SCHEMA) {
        throw new TypeError('$.analysis: must be an adaptive SPH analysis');
    }
    const width = fluidFinite(shellWidth, '$.shellWidth', { minimum: Number.MIN_VALUE, maximum: 8 });
    const metricsById = new Map(analysis.metrics.map(metric => [metric.id, metric]));
    const projections = [];
    const totals = new Map();
    const spatialCandidates = visitSpatialPairCandidates(packets, (leftIndex, rightIndex) => {
        const left = packets[leftIndex];
        const right = packets[rightIndex];
        if (left.resolutionLevel === right.resolutionLevel) return;
        const distanceM = length(subtract(left.positionM, right.positionM));
        const reach = width * Math.max(left.smoothingRadiusM, right.smoothingRadiusM);
        if (distanceM >= reach) return;
        const rawWeight = Math.max(0, 1 - distanceM / reach);
        for (const [source, target] of [[left, right], [right, left]]) {
            const key = target.id;
            totals.set(key, (totals.get(key) ?? 0) + rawWeight);
            projections.push({ source, target, rawWeight });
        }
    }, width);
    const normalized = projections.map(({ source, target, rawWeight }, index) => {
        const normalizedKernelWeight = rawWeight / Math.max(EPSILON, totals.get(target.id));
        const projectedMassKg = source.massKg * normalizedKernelWeight;
        return {
            id: `shell.${target.id}.${source.id}.${index}`,
            sourcePacketId: source.id,
            targetPacketId: target.id,
            sourceRevision: source.sourceRevision,
            representationRevision: source.representationRevision,
            positionM: source.positionM,
            velocityMPerS: source.velocityMPerS,
            smoothingRadiusM: symmetricSmoothingRadius(source.smoothingRadiusM, target.smoothingRadiusM),
            projectedMassKg,
            projectedMomentumKgMPerS: scale(source.velocityMPerS, projectedMassKg),
            normalizedKernelWeight,
            sourcePressurePa: metricsById.get(source.id)?.pressurePa ?? 0,
            targetPressurePa: metricsById.get(target.id)?.pressurePa ?? 0,
            canonicalMassOwner: false,
            role: 'transition-support',
        };
    });
    return fluidFreeze({
        schema: 'engine.matter.adaptive-sph-transition-shells',
        schemaVersion: '1.0.0',
        projections: normalized,
        neighborSearch: 'uniform-cell-linked-list',
        candidatePairCount: spatialCandidates.candidatePairCount,
        occupiedNeighborCells: spatialCandidates.occupiedCells,
        canonicalMassKg: summarizeAdaptiveFluidConservation(packets).massKg,
        projectedOwnedMassKg: 0,
    }, '$.adaptiveSphTransitionShells');
}

function applyDomainBoundary(position, velocity, radiusM, bounds, restitution) {
    if (!bounds) return { position, velocity, impulse: [0, 0, 0] };
    const nextPosition = [...position];
    const nextVelocity = [...velocity];
    const impulse = [0, 0, 0];
    for (let axis = 0; axis < 3; axis += 1) {
        const minimum = bounds.min[axis] + radiusM;
        const maximum = bounds.max[axis] - radiusM;
        if (nextPosition[axis] < minimum) {
            nextPosition[axis] = minimum;
            const prior = nextVelocity[axis];
            nextVelocity[axis] = Math.abs(prior) * restitution;
            impulse[axis] = nextVelocity[axis] - prior;
        } else if (nextPosition[axis] > maximum) {
            nextPosition[axis] = maximum;
            const prior = nextVelocity[axis];
            nextVelocity[axis] = -Math.abs(prior) * restitution;
            impulse[axis] = nextVelocity[axis] - prior;
        }
    }
    return { position: nextPosition, velocity: nextVelocity, impulse };
}

export function stepAdaptiveSphReference(packetInputs, {
    dtSeconds,
    gravityMPerS2 = [0, -9.81, 0],
    viscosity = 0.015,
    pressureScale = 1,
    surfaceTensionNPerM = 0,
    restitution = 0.05,
    bounds = null,
    qualityProfile = 'balanced',
    kernelProfile = createSymmetricSphKernelProfile(),
    logger = null,
    maximumReferencePackets = 4096,
    preparedAnalysis = null,
} = {}) {
    const packets = sortedPhysicalPackets(packetInputs, maximumReferencePackets);
    const dt = fluidFinite(dtSeconds, '$.dtSeconds', { minimum: Number.MIN_VALUE, maximum: 0.1 });
    const gravity = gravityMPerS2.map((value, axis) => fluidFinite(value, `$.gravityMPerS2[${axis}]`));
    const viscousScale = fluidFinite(viscosity, '$.viscosity', { minimum: 0, maximum: 10 });
    const pressureMultiplier = fluidFinite(pressureScale, '$.pressureScale', { minimum: 0, maximum: 10 });
    const surfaceTension = fluidFinite(surfaceTensionNPerM, '$.surfaceTensionNPerM', {
        minimum: 0,
        maximum: 10,
    });
    const bounce = fluidFinite(restitution, '$.restitution', { minimum: 0, maximum: 1 });
    const profile = resolveAdaptiveFluidQualityProfile(qualityProfile);
    const kernel = kernelProfile?.schema === ADAPTIVE_SPH_KERNEL_SCHEMA
        ? kernelProfile
        : createSymmetricSphKernelProfile(kernelProfile);
    const analysis = preparedAnalysis === null
        ? analyzeAdaptiveSphPackets(packets, {
            qualityProfile: profile.name,
            kernelProfile: kernel,
            logger,
            maximumReferencePackets,
        })
        : requirePreparedAnalysis(preparedAnalysis, packets, profile.name, kernel);
    const analysisReused = preparedAnalysis !== null;
    const accelerations = packets.map(() => [...gravity]);
    for (const interaction of analysis.interactions) {
        const { leftIndex, rightIndex, distanceM, smoothingRadiusM } = interaction;
        const left = packets[leftIndex];
        const right = packets[rightIndex];
        const displacement = subtract(left.positionM, right.positionM);
        if (distanceM <= EPSILON) continue;
        const gradient = interaction.gradient;
        const leftMetric = analysis.metrics[leftIndex];
        const rightMetric = analysis.metrics[rightIndex];
        const pressureCoefficient = -left.massKg * right.massKg * pressureMultiplier * (
            leftMetric.pressurePa / Math.max(EPSILON, leftMetric.densityKgM3 ** 2)
            + rightMetric.pressurePa / Math.max(EPSILON, rightMetric.densityKgM3 ** 2)
        );
        const pressureForce = scale(gradient, pressureCoefficient);
        const viscousForce = scale(
            subtract(right.velocityMPerS, left.velocityMPerS),
            viscousScale * left.massKg * right.massKg
                * viscosityKernel(distanceM, smoothingRadiusM)
                / Math.max(EPSILON, leftMetric.densityKgM3 * rightMetric.densityKgM3),
        );
        const interfaceWeight = Math.max(
            leftMetric.surfaceIndicator,
            rightMetric.surfaceIndicator,
            leftMetric.neighborDeficiency,
            rightMetric.neighborDeficiency,
        );
        const pairAreaM2 = 0.5 * (
            left.representedVolumeM3 ** (2 / 3)
            + right.representedVolumeM3 ** (2 / 3)
        );
        const normalizedDistance = distanceM / smoothingRadiusM;
        const capillaryForceMagnitude = surfaceTension * pairAreaM2
            / smoothingRadiusM
            * (1 - normalizedDistance) ** 2
            * interfaceWeight;
        const capillaryForce = scale(
            displacement,
            -capillaryForceMagnitude / distanceM,
        );
        const force = add(add(pressureForce, viscousForce), capillaryForce);
        accelerations[leftIndex] = add(accelerations[leftIndex], scale(force, 1 / left.massKg));
        accelerations[rightIndex] = add(accelerations[rightIndex], scale(force, -1 / right.massKg));
    }
    const before = summarizeAdaptiveFluidConservation(packets);
    let boundaryImpulseKgMPerS = [0, 0, 0];
    const nextPackets = packets.map((packet, index) => {
        let velocity = add(packet.velocityMPerS, scale(accelerations[index], dt));
        let position = add(packet.positionM, scale(velocity, dt));
        const radiusM = 0.5 * Math.cbrt(packet.representedVolumeM3);
        const bounded = applyDomainBoundary(position, velocity, radiusM, bounds, bounce);
        position = bounded.position;
        velocity = bounded.velocity;
        boundaryImpulseKgMPerS = add(boundaryImpulseKgMPerS, scale(bounded.impulse, packet.massKg));
        return createAdaptiveFluidPacket({ ...packet, positionM: position, velocityMPerS: velocity });
    });
    const after = summarizeAdaptiveFluidConservation(nextPackets);
    const expectedExternalImpulse = add(scale(gravity, before.massKg * dt), boundaryImpulseKgMPerS);
    const momentumDelta = subtract(after.linearMomentumKgMPerS, before.linearMomentumKgMPerS);
    const internalMomentumResidual = subtract(momentumDelta, expectedExternalImpulse);
    const tolerance = 1e-8 * Math.max(1, before.massKg, length(before.linearMomentumKgMPerS));
    const balanced = Math.abs(after.massKg - before.massKg) <= tolerance
        && Math.abs(after.representedVolumeM3 - before.representedVolumeM3) <= tolerance
        && length(internalMomentumResidual) <= tolerance;
    if (!balanced) {
        throw new AdaptiveFluidError(
            ADAPTIVE_FLUID_ERROR_CODES.CONSERVATION_FAILURE,
            'Adaptive SPH reference step failed its conservation receipt',
            { before, after, expectedExternalImpulse, internalMomentumResidual, tolerance },
        );
    }
    const receipt = fluidFreeze({
        schema: ADAPTIVE_SPH_STEP_SCHEMA,
        schemaVersion: ADAPTIVE_SPH_STEP_VERSION,
        dtSeconds: dt,
        surfaceTensionNPerM: surfaceTension,
        before,
        after,
        expectedExternalImpulseKgMPerS: expectedExternalImpulse,
        boundaryImpulseKgMPerS,
        internalMomentumResidualKgMPerS: internalMomentumResidual,
        massResidualKg: after.massKg - before.massKg,
        representedVolumeResidualM3: after.representedVolumeM3 - before.representedVolumeM3,
        neighborAnalysisReused: analysisReused,
        balanced,
    }, '$.adaptiveSphStepReceipt');
    logAdaptiveFluid(logger, 'debug', 'sph-step-complete', {
        packets: packets.length,
        dtSeconds: dt,
        momentumResidual: length(internalMomentumResidual),
    });
    return Object.freeze({ packets: nextPackets, analysis, analysisReused, receipt });
}
