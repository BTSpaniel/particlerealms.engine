// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Immutable one-step inputs for the bounded reciprocal-pair GPU operator. */
import {
    createAdaptiveFluidPacket,
    fluidExactObject,
    fluidFinite,
    fluidFreeze,
    fluidInteger,
    fluidVector3,
    resolveAdaptiveFluidQualityProfile,
} from './AdaptiveFluidContracts.js';
import {
    buildAdaptiveSphNeighborhood,
    createSymmetricSphKernelProfile,
} from './AdaptiveSphReference.js';
import { admitAdaptiveSphGpuNumericBounds } from './AdaptiveSphGpuNumericBounds.js';
import { MIXED_RESOLUTION_FLUID_GPU_ABI } from './MixedResolutionFluidContracts.js';

export const ADAPTIVE_SPH_GPU_PLAN_SCHEMA = 'engine.matter.adaptive-sph-gpu-step-plan';
export const ADAPTIVE_SPH_GPU_PLAN_VERSION = '1.1.0';
export const ADAPTIVE_SPH_GPU_MAX_PACKETS = 65536;
export const ADAPTIVE_SPH_GPU_MAX_PAIRS = 1048576;
const NORMAL_F32_MINIMUM = 2 ** -126;
// Covers rounding of support, three displacement lanes, dot/length, and divide.
// Only candidate reach is padded; the GPU tests the original packed support.
const GPU_SUPPORT_PADDING_RATIO = 32 * 2 ** -23;
const PLANS = new WeakMap();
const OPTION_KEYS = new Set([
    'dtSeconds', 'gravityMPerS2', 'viscosity', 'pressureScale',
    'surfaceTensionNPerM', 'restitution', 'bounds', 'qualityProfile',
    'kernelProfile', 'maximumPackets', 'maximumPairs',
]);

function f32(value, path, positive = false) {
    fluidFinite(value, path);
    const rounded = Math.fround(value);
    if (!Number.isFinite(rounded)
        || (value !== 0 && Math.abs(rounded) < NORMAL_F32_MINIMUM)
        || (positive && rounded <= 0)) {
        throw new RangeError(`${path}: must fit a normal finite GPU f32 lane`);
    }
    return rounded;
}

function roundedPacket(packet) {
    const h = f32(fluidFinite(packet.smoothingRadiusM, '$.smoothingRadiusM', {
        minimum: 1e-3, maximum: 1e3,
    }), '$.smoothingRadiusM', true);
    const positionM = packet.positionM.map((value, axis) => {
        const rounded = f32(value, `$.positionM[${axis}]`);
        const spacing = rounded === 0 ? 2 ** -149
            : 2 ** (Math.floor(Math.log2(Math.abs(rounded))) - 23);
        if (Math.abs(rounded - value) > h * 1e-4 || spacing > h * 1e-4) {
            throw new RangeError('$.positionM: rebase the region before GPU support loses precision');
        }
        return rounded;
    });
    return createAdaptiveFluidPacket({
        ...packet,
        positionM,
        velocityMPerS: packet.velocityMPerS.map((value, axis) => f32(value,
            `$.velocityMPerS[${axis}]`)),
        massKg: f32(packet.massKg, '$.massKg', packet.canonicalMassOwner),
        representedVolumeM3: f32(packet.representedVolumeM3, '$.representedVolumeM3', true),
        restDensityKgM3: f32(packet.restDensityKgM3, '$.restDensityKgM3', true),
        smoothingRadiusM: h,
    });
}

function boundedF32(value, path, minimum, maximum) {
    const rounded = f32(fluidFinite(value, path, { minimum, maximum }), path, minimum > 0);
    if (rounded <= maximum) return rounded;
    // Positive bounded parameters round inward at non-f32 ceilings such as 0.1 s.
    const bits = new DataView(new ArrayBuffer(4));
    bits.setFloat32(0, rounded, true);
    bits.setUint32(0, bits.getUint32(0, true) - 1, true);
    return bits.getFloat32(0, true);
}

/** Builds topology only on the CPU; density and forces are GPU work. */
export function createAdaptiveSphGpuPlan(packetInputs, options = {}) {
    fluidExactObject(options, OPTION_KEYS, '$.options');
    const maximumPackets = fluidInteger(options.maximumPackets ?? 4096, '$.maximumPackets', {
        minimum: 1, maximum: ADAPTIVE_SPH_GPU_MAX_PACKETS,
    });
    const maximumPairs = fluidInteger(options.maximumPairs ?? 262144, '$.maximumPairs', {
        maximum: ADAPTIVE_SPH_GPU_MAX_PAIRS,
    });
    if (!Array.isArray(packetInputs) || packetInputs.length < 1) {
        throw new RangeError('$.packets: non-empty input is required');
    }
    // Visual records remain structurally checked, but cannot consume physical
    // capacity or impose GPU numeric constraints on the actual mass owners.
    const physicalPackets = packetInputs.map(createAdaptiveFluidPacket)
        .filter(packet => packet.canonicalMassOwner);
    if (physicalPackets.length < 1 || physicalPackets.length > maximumPackets) {
        throw new RangeError('$.packets: physical owners must fit the bounded packet capacity');
    }
    const dtSeconds = boundedF32(options.dtSeconds, '$.dtSeconds', Number.MIN_VALUE, 0.1);
    const gravityMPerS2 = fluidVector3(options.gravityMPerS2 ?? [0, -9.81, 0],
        '$.gravityMPerS2').map((value, axis) => f32(value, `$.gravityMPerS2[${axis}]`));
    const viscosity = boundedF32(options.viscosity ?? 0.015, '$.viscosity', 0, 10);
    const pressureScale = boundedF32(options.pressureScale ?? 1, '$.pressureScale', 0, 10);
    const surfaceTensionNPerM = boundedF32(options.surfaceTensionNPerM ?? 0,
        '$.surfaceTensionNPerM', 0, 10);
    const restitution = boundedF32(options.restitution ?? 0.05, '$.restitution', 0, 1);
    const profile = resolveAdaptiveFluidQualityProfile(options.qualityProfile ?? 'balanced');
    const kernel = createSymmetricSphKernelProfile(options.kernelProfile);
    const kernelProfile = createSymmetricSphKernelProfile({
        ...kernel,
        pressureStiffnessPa: f32(kernel.pressureStiffnessPa, '$.pressureStiffnessPa'),
    });
    const neighborhood = buildAdaptiveSphNeighborhood(physicalPackets.map(roundedPacket), {
        kernelProfile, maximumReferencePackets: maximumPackets, maximumPairs,
        supportPaddingRatio: GPU_SUPPORT_PADDING_RATIO,
    });
    const { packets, interactions } = neighborhood;
    const sourceRevision = packets[0].sourceRevision;
    if (packets.some(packet => packet.sourceRevision !== sourceRevision)) {
        throw new RangeError('$.packets: one GPU step requires a coherent source revision');
    }
    let bounds = null;
    if (options.bounds != null) {
        fluidExactObject(options.bounds, new Set(['min', 'max']), '$.bounds');
        bounds = Object.fromEntries(['min', 'max'].map(key => [key,
            fluidVector3(options.bounds[key], `$.bounds.${key}`).map((value, axis) =>
                f32(value, `$.bounds.${key}[${axis}]`)),
        ]));
        for (let axis = 0; axis < 3; axis += 1) {
            if (bounds.min[axis] >= bounds.max[axis]) {
                throw new RangeError('$.bounds: each minimum must be below its maximum');
            }
            for (const packet of packets) {
                if (Math.cbrt(packet.representedVolumeM3) > bounds.max[axis] - bounds.min[axis]) {
                    throw new RangeError('$.bounds: each complete packet must fit the domain');
                }
            }
        }
    }
    const numericBounds = admitAdaptiveSphGpuNumericBounds({
        packets, interactions, dtSeconds, gravityMPerS2, viscosity, pressureScale,
        surfaceTensionNPerM, bounds, kernelProfile,
    });
    const packetCount = packets.length;
    const pairCount = interactions.length;
    const carrierBytes = new ArrayBuffer(packetCount * MIXED_RESOLUTION_FLUID_GPU_ABI.carrier.byteLength);
    const carrier = new DataView(carrierBytes);
    let minimumLevel = 31;
    let maximumLevel = 0;
    for (const packet of packets) {
        minimumLevel = Math.min(minimumLevel, packet.resolutionLevel);
        maximumLevel = Math.max(maximumLevel, packet.resolutionLevel);
    }
    for (let index = 0; index < packetCount; index += 1) {
        const packet = packets[index];
        const values = [
            ...packet.positionM, packet.massKg,
            ...packet.velocityMPerS, packet.representedVolumeM3,
            packet.smoothingRadiusM, packet.restDensityKgM3, 0,
            f32(1 / packet.massKg, '$.inverseMass', true),
        ];
        for (let lane = 0; lane < values.length; lane += 1) {
            carrier.setFloat32(index * 64 + lane * 4, values[lane], true);
        }
        carrier.setUint32(index * 64 + 48, index, true);
        carrier.setUint32(index * 64 + 52, packet.resolutionLevel, true);
        carrier.setUint32(index * 64 + 56,
            minimumLevel < maximumLevel && packet.resolutionLevel === minimumLevel ? 1 : 0, true);
        carrier.setUint32(index * 64 + 60, 1, true);
    }
    const pairBytes = new ArrayBuffer(Math.max(16, pairCount * 16));
    const pairView = new DataView(pairBytes);
    const adjacencyOffsets = new Uint32Array(packetCount * 4);
    for (const pair of interactions) {
        adjacencyOffsets[pair.leftIndex * 4 + 1] += 1;
        adjacencyOffsets[pair.rightIndex * 4 + 1] += 1;
    }
    let start = 0;
    for (let index = 0; index < packetCount; index += 1) {
        adjacencyOffsets[index * 4] = start;
        adjacencyOffsets[index * 4 + 2] = packets[index].targetNeighborRange[0];
        start += adjacencyOffsets[index * 4 + 1];
    }
    const adjacencyPairs = new Uint32Array(Math.max(4, pairCount * 2));
    const cursors = Uint32Array.from(packets, (_, index) => adjacencyOffsets[index * 4]);
    for (let index = 0; index < pairCount; index += 1) {
        const pair = interactions[index];
        pairView.setUint32(index * 16, pair.leftIndex, true);
        pairView.setUint32(index * 16 + 4, pair.rightIndex, true);
        pairView.setFloat32(index * 16 + 8, f32(pair.smoothingRadiusM, '$.pairSupport', true), true);
        adjacencyPairs[cursors[pair.leftIndex]++] = index;
        adjacencyPairs[cursors[pair.rightIndex]++] = index;
    }
    const parameterBytes = new ArrayBuffer(80);
    const parameters = new DataView(parameterBytes);
    [packetCount, pairCount, bounds ? 1 : 0, 0].forEach((value, lane) =>
        parameters.setUint32(lane * 4, value, true));
    [dtSeconds, viscosity, pressureScale, surfaceTensionNPerM,
        ...gravityMPerS2, restitution,
        ...(bounds?.min ?? [0, 0, 0]), kernelProfile.pressureStiffnessPa,
        ...(bounds?.max ?? [0, 0, 0]), 1e-12,
    ].forEach((value, lane) => parameters.setFloat32(16 + lane * 4, value, true));
    const normalizedOptions = fluidFreeze({
        dtSeconds, gravityMPerS2, viscosity, pressureScale, surfaceTensionNPerM,
        restitution, bounds, qualityProfile: profile.name, kernelProfile,
        maximumReferencePackets: maximumPackets,
    });
    const plan = fluidFreeze({
        schema: ADAPTIVE_SPH_GPU_PLAN_SCHEMA,
        schemaVersion: ADAPTIVE_SPH_GPU_PLAN_VERSION,
        packetCount, pairCount, sourceRevision,
        solver: 'explicit-eos-sph',
        topologyLifetime: 'one-step-input-snapshot',
        idEncoding: 'step-local-sorted-index',
        supportCandidatePaddingRatio: GPU_SUPPORT_PADDING_RATIO,
        neighborSearch: 'shared-uniform-cell-linked-list',
        candidatePairCount: neighborhood.summary.candidatePairCount,
        occupiedNeighborCells: neighborhood.summary.occupiedCells,
        source: 'f32-rounded-adaptive-fluid-packets',
        numericAdmission: numericBounds,
        authority: { liveSimulationMutation: false, physicalHandoff: false },
    });
    PLANS.set(plan, { packets, options: normalizedOptions, packetCount, pairCount,
        carrierBytes, pairBytes, adjacencyOffsets, adjacencyPairs, parameterBytes,
        numericBounds });
    return plan;
}

/** Exact identity prevents callers from substituting GPU topology or bytes. */
export function readAdaptiveSphGpuPlan(plan) {
    const stored = PLANS.get(plan);
    if (!stored) throw new TypeError('A live createAdaptiveSphGpuPlan result is required');
    return {
        ...stored,
        carrierBytes: stored.carrierBytes.slice(0),
        pairBytes: stored.pairBytes.slice(0),
        adjacencyOffsets: stored.adjacencyOffsets.slice(),
        adjacencyPairs: stored.adjacencyPairs.slice(),
        parameterBytes: stored.parameterBytes.slice(0),
    };
}
