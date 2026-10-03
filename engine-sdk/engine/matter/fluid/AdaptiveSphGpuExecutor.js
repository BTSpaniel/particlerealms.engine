// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Bounded research executor for one variable-mass SPH step on WebGPU. */
import { logAdaptiveFluid } from './AdaptiveFluidContracts.js';
import { readAdaptiveSphGpuPlan } from './AdaptiveSphGpuPlan.js';

export const ADAPTIVE_SPH_GPU_EXECUTION_SCHEMA =
    'engine.matter.adaptive-sph-gpu-execution';
export const ADAPTIVE_SPH_GPU_EXECUTION_VERSION = '1.0.0';

const CARRIER_BYTES = 64;
const PAIR_BYTES = 16;
const METRIC_BYTES = 16;
const FORCE_BYTES = 16;
const PARAMETER_BYTES = 80;
const WORKGROUP_SIZE = 64;
const NORMAL_F32_MINIMUM = 2 ** -126;
const MAXIMUM_IMPLEMENTATION_PACKETS = 65_536;
const MAXIMUM_IMPLEMENTATION_PAIRS = 1_048_576;

/** Shared SPH kernel functions. The caller supplies PI and parameters.boundsMaxEpsilon.w. */
export const ADAPTIVE_SPH_GPU_KERNELS = /* wgsl */`
fn poly6Kernel(distanceM: f32, supportM: f32) -> f32 {
  if (distanceM >= supportM) { return 0.0; }
  let q = distanceM / supportM;
  let remaining = max(0.0, 1.0 - q * q);
  return (315.0 / (64.0 * PI)) * remaining * remaining * remaining
    / (supportM * supportM * supportM);
}

fn poly6Gradient(displacementM: vec3<f32>, distanceM: f32, supportM: f32) -> vec3<f32> {
  if (distanceM <= parameters.boundsMaxEpsilon.w || distanceM >= supportM) {
    return vec3<f32>(0.0);
  }
  let q = distanceM / supportM;
  let remaining = max(0.0, 1.0 - q * q);
  let support2 = supportM * supportM;
  let support5 = support2 * support2 * supportM;
  return displacementM * (-945.0 / (32.0 * PI)) * remaining * remaining / support5;
}

fn viscosityKernel(distanceM: f32, supportM: f32) -> f32 {
  if (distanceM >= supportM) { return 0.0; }
  let q = distanceM / supportM;
  let support2 = supportM * supportM;
  let support5 = support2 * support2 * supportM;
  return (45.0 / PI) * max(0.0, 1.0 - q) / support5;
}

`;

/**
 * Each reciprocal edge is evaluated exactly once into scratchPairForces.
 * That scratch is deliberately not the reserved physical pairImpulse ABI and
 * grants no simulation authority; the final pass gathers it with opposite signs.
 */
export const ADAPTIVE_SPH_GPU_WGSL = /* wgsl */`
const PI: f32 = 3.14159265358979323846;

struct Carrier {
  positionMass: vec4<f32>,
  velocityVolume: vec4<f32>,
  supportRestSubgridInverseMass: vec4<f32>,
  stableIdLevelKindFlags: vec4<u32>,
};

struct PairEdge {
  leftIndex: u32,
  rightIndex: u32,
  pairSupportRadiusM: f32,
  flags: u32,
};

struct Parameters {
  counts: vec4<u32>,
  physics: vec4<f32>,
  gravityRestitution: vec4<f32>,
  boundsMinStiffness: vec4<f32>,
  boundsMaxEpsilon: vec4<f32>,
};

@group(0) @binding(0) var<storage, read> carriers: array<Carrier>;
@group(0) @binding(1) var<storage, read> pairEdges: array<PairEdge>;
@group(0) @binding(2) var<storage, read> adjacencyOffsets: array<vec4<u32>>;
@group(0) @binding(3) var<storage, read> adjacencyPairs: array<u32>;
@group(0) @binding(4) var<uniform> parameters: Parameters;
@group(0) @binding(5) var<storage, read_write> densityMetrics: array<vec4<f32>>;
@group(0) @binding(6) var<storage, read_write> scratchPairForces: array<vec4<f32>>;
@group(0) @binding(7) var<storage, read_write> outputCarriers: array<Carrier>;

${ADAPTIVE_SPH_GPU_KERNELS}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn adaptiveSphDensity(@builtin(global_invocation_id) invocation: vec3<u32>) {
  let carrierIndex = invocation.x;
  if (carrierIndex >= parameters.counts.x) { return; }
  let carrier = carriers[carrierIndex];
  let supportM = carrier.supportRestSubgridInverseMass.x;
  var density = carrier.positionMass.w * poly6Kernel(0.0, supportM);
  var densityGradient = vec3<f32>(0.0);
  var neighborCount = 0u;
  let adjacency = adjacencyOffsets[carrierIndex];
  for (var offset = 0u; offset < adjacency.y; offset = offset + 1u) {
    let edgeIndex = adjacencyPairs[adjacency.x + offset];
    if (edgeIndex >= parameters.counts.y) { continue; }
    let edge = pairEdges[edgeIndex];
    var neighborIndex = edge.leftIndex;
    if (edge.leftIndex == carrierIndex) {
      neighborIndex = edge.rightIndex;
    } else if (edge.rightIndex != carrierIndex) {
      continue;
    }
    let neighbor = carriers[neighborIndex];
    let displacement = carrier.positionMass.xyz - neighbor.positionMass.xyz;
    let distanceM = length(displacement);
    if (distanceM >= edge.pairSupportRadiusM) { continue; }
    neighborCount = neighborCount + 1u;
    density = density + neighbor.positionMass.w
      * poly6Kernel(distanceM, edge.pairSupportRadiusM);
    densityGradient = densityGradient + neighbor.positionMass.w
      * poly6Gradient(displacement, distanceM, edge.pairSupportRadiusM);
  }
  let safeDensity = max(parameters.boundsMaxEpsilon.w, density);
  let surfaceIndicator = clamp(
    length(densityGradient) * supportM / safeDensity,
    0.0,
    1.0
  );
  let targetMinimum = max(1u, adjacency.z);
  let neighborDeficiency = clamp(
    f32(targetMinimum - min(targetMinimum, neighborCount)) / f32(targetMinimum),
    0.0,
    1.0
  );
  let pressurePa = parameters.boundsMinStiffness.w
    * (density / carrier.supportRestSubgridInverseMass.y - 1.0);
  densityMetrics[carrierIndex] = vec4<f32>(
    density,
    pressurePa,
    surfaceIndicator,
    neighborDeficiency
  );
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn adaptiveSphPairForce(@builtin(global_invocation_id) invocation: vec3<u32>) {
  let edgeIndex = invocation.x;
  if (edgeIndex >= parameters.counts.y) { return; }
  let edge = pairEdges[edgeIndex];
  let left = carriers[edge.leftIndex];
  let right = carriers[edge.rightIndex];
  let displacement = left.positionMass.xyz - right.positionMass.xyz;
  let distanceM = length(displacement);
  if (distanceM <= parameters.boundsMaxEpsilon.w
      || distanceM >= edge.pairSupportRadiusM) {
    scratchPairForces[edgeIndex] = vec4<f32>(0.0);
    return;
  }
  let leftMetric = densityMetrics[edge.leftIndex];
  let rightMetric = densityMetrics[edge.rightIndex];
  let epsilon = parameters.boundsMaxEpsilon.w;
  let pressureCoefficient = -left.positionMass.w * right.positionMass.w
    * parameters.physics.z
    * (leftMetric.y / max(epsilon, leftMetric.x * leftMetric.x)
      + rightMetric.y / max(epsilon, rightMetric.x * rightMetric.x));
  let pressureForce = poly6Gradient(displacement, distanceM, edge.pairSupportRadiusM)
    * pressureCoefficient;
  let viscousCoefficient = parameters.physics.y * left.positionMass.w
    * right.positionMass.w * viscosityKernel(distanceM, edge.pairSupportRadiusM)
    / max(epsilon, leftMetric.x * rightMetric.x);
  let viscousForce = (right.velocityVolume.xyz - left.velocityVolume.xyz)
    * viscousCoefficient;
  let interfaceWeight = max(
    max(leftMetric.z, rightMetric.z),
    max(leftMetric.w, rightMetric.w)
  );
  let pairAreaM2 = 0.5 * (
    pow(left.velocityVolume.w, 2.0 / 3.0)
    + pow(right.velocityVolume.w, 2.0 / 3.0)
  );
  let normalizedDistance = distanceM / edge.pairSupportRadiusM;
  let capillaryMagnitude = parameters.physics.w * pairAreaM2
    / edge.pairSupportRadiusM
    * (1.0 - normalizedDistance) * (1.0 - normalizedDistance)
    * interfaceWeight;
  let capillaryForce = displacement * (-capillaryMagnitude / distanceM);
  scratchPairForces[edgeIndex] = vec4<f32>(
    pressureForce + viscousForce + capillaryForce,
    0.0
  );
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn adaptiveSphGatherIntegrate(@builtin(global_invocation_id) invocation: vec3<u32>) {
  let carrierIndex = invocation.x;
  if (carrierIndex >= parameters.counts.x) { return; }
  let carrier = carriers[carrierIndex];
  var acceleration = parameters.gravityRestitution.xyz;
  let adjacency = adjacencyOffsets[carrierIndex];
  for (var offset = 0u; offset < adjacency.y; offset = offset + 1u) {
    let edgeIndex = adjacencyPairs[adjacency.x + offset];
    if (edgeIndex >= parameters.counts.y) { continue; }
    let edge = pairEdges[edgeIndex];
    let signedForce = select(
      -scratchPairForces[edgeIndex].xyz,
      scratchPairForces[edgeIndex].xyz,
      edge.leftIndex == carrierIndex
    );
    acceleration = acceleration
      + signedForce * carrier.supportRestSubgridInverseMass.w;
  }
  var velocity = carrier.velocityVolume.xyz + acceleration * parameters.physics.x;
  var position = carrier.positionMass.xyz + velocity * parameters.physics.x;
  if (parameters.counts.z != 0u) {
    let radiusM = 0.5 * pow(carrier.velocityVolume.w, 1.0 / 3.0);
    let minimum = parameters.boundsMinStiffness.xyz + vec3<f32>(radiusM);
    let maximum = parameters.boundsMaxEpsilon.xyz - vec3<f32>(radiusM);
    for (var axis = 0u; axis < 3u; axis = axis + 1u) {
      if (position[axis] < minimum[axis]) {
        position[axis] = minimum[axis];
        velocity[axis] = abs(velocity[axis]) * parameters.gravityRestitution.w;
      } else if (position[axis] > maximum[axis]) {
        position[axis] = maximum[axis];
        velocity[axis] = -abs(velocity[axis]) * parameters.gravityRestitution.w;
      }
    }
  }
  var output = carrier;
  output.positionMass = vec4<f32>(position, carrier.positionMass.w);
  output.velocityVolume = vec4<f32>(velocity, carrier.velocityVolume.w);
  outputCarriers[carrierIndex] = output;
}
`;

function safeInteger(value, path, minimum, maximum) {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
        throw new RangeError(`${path}: expected an integer in [${minimum}, ${maximum}]`);
    }
    return value;
}

function finiteNormalF32(value, path, { positive = false, allowZero = true } = {}) {
    if (!Number.isFinite(value)
        || (!allowZero && value === 0)
        || (positive && value <= 0)
        || (value !== 0 && Math.abs(value) < NORMAL_F32_MINIMUM)) {
        throw new RangeError(`${path}: expected a finite normal f32 lane`);
    }
    return value;
}

function bufferUsageConstants() {
    const usage = globalThis.GPUBufferUsage;
    const mapMode = globalThis.GPUMapMode;
    if (!usage || !mapMode || !Number.isInteger(mapMode.READ)) {
        throw new Error('Adaptive SPH GPU execution requires browser WebGPU constants');
    }
    return { usage, mapRead: mapMode.READ };
}

function validateDevice(device, maximumPackets, maximumPairs) {
    if (!device || typeof device.createShaderModule !== 'function'
        || typeof device.createBuffer !== 'function'
        || typeof device.createBindGroup !== 'function'
        || typeof device.createCommandEncoder !== 'function'
        || typeof device.queue?.writeBuffer !== 'function'
        || typeof device.queue?.submit !== 'function') {
        throw new TypeError('Adaptive SPH GPU executor requires a live WebGPU device');
    }
    const limits = device.limits;
    const maximumStorageBytes = Math.max(
        maximumPackets * CARRIER_BYTES,
        maximumPackets * METRIC_BYTES,
        Math.max(PAIR_BYTES, maximumPairs * PAIR_BYTES),
        Math.max(16, maximumPairs * 2 * 4),
    );
    if (!limits
        || Number(limits.maxBufferSize) < maximumStorageBytes
        || Number(limits.maxStorageBufferBindingSize) < maximumStorageBytes
        || Number(limits.maxUniformBufferBindingSize) < PARAMETER_BYTES
        || Number(limits.maxStorageBuffersPerShaderStage) < 6
        || Number(limits.maxBindingsPerBindGroup) < 8
        || Number(limits.maxComputeInvocationsPerWorkgroup) < WORKGROUP_SIZE) {
        throw new RangeError('Adaptive SPH GPU executor capacity exceeds this device');
    }
}

function parseCarrierBytes(bytes, packetCount) {
    if (!(bytes instanceof ArrayBuffer) || bytes.byteLength !== packetCount * CARRIER_BYTES) {
        throw new TypeError('GPU plan carrier bytes do not match the reserved 64-byte ABI');
    }
    const view = new DataView(bytes);
    const carriers = [];
    for (let index = 0; index < packetCount; index += 1) {
        const base = index * CARRIER_BYTES;
        const lane = offset => view.getFloat32(base + offset, true);
        const positionM = [lane(0), lane(4), lane(8)];
        const massKg = lane(12);
        const velocityMPerS = [lane(16), lane(20), lane(24)];
        const representedVolumeM3 = lane(28);
        const smoothingRadiusM = lane(32);
        const restDensityKgM3 = lane(36);
        const subgrid = lane(40);
        const inverseMass = lane(44);
        positionM.forEach((value, axis) => finiteNormalF32(value,
            `carrier[${index}].positionM[${axis}]`));
        velocityMPerS.forEach((value, axis) => finiteNormalF32(value,
            `carrier[${index}].velocityMPerS[${axis}]`));
        [massKg, representedVolumeM3, smoothingRadiusM, restDensityKgM3, inverseMass]
            .forEach((value, scalar) => finiteNormalF32(value,
                `carrier[${index}].positive[${scalar}]`, { positive: true }));
        if (subgrid !== 0
            || view.getUint32(base + 48, true) !== index
            || view.getUint32(base + 52, true) > 31
            || view.getUint32(base + 56, true) > 1
            || view.getUint32(base + 60, true) !== 1
            || !Object.is(inverseMass, Math.fround(1 / massKg))) {
            throw new RangeError(`carrier[${index}]: metadata or inverse mass is noncanonical`);
        }
        carriers.push({
            index,
            positionM,
            massKg,
            velocityMPerS,
            representedVolumeM3,
            smoothingRadiusM,
            restDensityKgM3,
            inverseMass,
            resolutionLevel: view.getUint32(base + 52, true),
            kind: view.getUint32(base + 56, true),
            flags: view.getUint32(base + 60, true),
        });
    }
    return carriers;
}

function parsePairBytes(bytes, pairCount, packetCount) {
    if (!(bytes instanceof ArrayBuffer)
        || bytes.byteLength !== Math.max(PAIR_BYTES, pairCount * PAIR_BYTES)) {
        throw new TypeError('GPU plan pair bytes do not match the reserved 16-byte ABI');
    }
    const view = new DataView(bytes);
    const pairs = [];
    const identities = new Set();
    for (let index = 0; index < pairCount; index += 1) {
        const base = index * PAIR_BYTES;
        const leftIndex = view.getUint32(base, true);
        const rightIndex = view.getUint32(base + 4, true);
        const supportRadiusM = view.getFloat32(base + 8, true);
        const flags = view.getUint32(base + 12, true);
        finiteNormalF32(supportRadiusM, `pair[${index}].supportRadiusM`, { positive: true });
        const identity = `${leftIndex}:${rightIndex}`;
        if (leftIndex >= rightIndex || rightIndex >= packetCount || flags !== 0
            || identities.has(identity)) {
            throw new RangeError(`pair[${index}]: expected one unique ordered reciprocal edge`);
        }
        identities.add(identity);
        pairs.push({ leftIndex, rightIndex, supportRadiusM, flags });
    }
    return pairs;
}

function validateAdjacency(offsets, edgeIndices, pairs, packetCount, pairCount) {
    if (!(offsets instanceof Uint32Array) || offsets.length !== packetCount * 4
        || !(edgeIndices instanceof Uint32Array)
        || edgeIndices.length !== Math.max(4, pairCount * 2)) {
        throw new TypeError('GPU plan CSR arrays have invalid bounded storage');
    }
    const endpointMasks = new Uint8Array(pairCount);
    let cursor = 0;
    for (let carrierIndex = 0; carrierIndex < packetCount; carrierIndex += 1) {
        const base = carrierIndex * 4;
        const start = offsets[base];
        const count = offsets[base + 1];
        if (start !== cursor || offsets[base + 2] > 0xffffffff || offsets[base + 3] !== 0
            || start + count > pairCount * 2) {
            throw new RangeError(`adjacency[${carrierIndex}]: CSR range is noncanonical`);
        }
        for (let offset = 0; offset < count; offset += 1) {
            const edgeIndex = edgeIndices[start + offset];
            const pair = pairs[edgeIndex];
            if (!pair) throw new RangeError('CSR references an unknown pair edge');
            const endpointBit = pair.leftIndex === carrierIndex
                ? 1
                : pair.rightIndex === carrierIndex ? 2 : 0;
            if (endpointBit === 0 || (endpointMasks[edgeIndex] & endpointBit) !== 0) {
                throw new RangeError('CSR edge ownership is not exactly reciprocal');
            }
            endpointMasks[edgeIndex] |= endpointBit;
        }
        cursor += count;
    }
    if (cursor !== pairCount * 2 || endpointMasks.some(mask => mask !== 3)) {
        throw new RangeError('CSR does not gather each pair once at both endpoints');
    }
    for (let index = cursor; index < edgeIndices.length; index += 1) {
        if (edgeIndices[index] !== 0) throw new RangeError('CSR padding must remain zero');
    }
}

function validateParameters(bytes, packetCount, pairCount) {
    if (!(bytes instanceof ArrayBuffer) || bytes.byteLength !== PARAMETER_BYTES) {
        throw new TypeError('GPU plan parameters must use the exact 80-byte ABI');
    }
    const view = new DataView(bytes);
    const counts = [0, 4, 8, 12].map(offset => view.getUint32(offset, true));
    if (counts[0] !== packetCount || counts[1] !== pairCount
        || counts[2] > 1 || counts[3] !== 0) {
        throw new RangeError('GPU plan parameter counts or bounds flag are stale');
    }
    const value = offset => view.getFloat32(offset, true);
    const dtSeconds = value(16);
    const viscosity = value(20);
    const pressureScale = value(24);
    const surfaceTensionNPerM = value(28);
    const gravityMPerS2 = [value(32), value(36), value(40)];
    const restitution = value(44);
    const boundsMin = [value(48), value(52), value(56)];
    const pressureStiffnessPa = value(60);
    const boundsMax = [value(64), value(68), value(72)];
    const epsilon = value(76);
    [dtSeconds, viscosity, pressureScale, surfaceTensionNPerM, restitution,
        pressureStiffnessPa, epsilon].forEach((entry, index) => finiteNormalF32(
        entry,
        `parameters.scalar[${index}]`,
    ));
    [...gravityMPerS2, ...boundsMin, ...boundsMax].forEach((entry, index) =>
        finiteNormalF32(entry, `parameters.vector[${index}]`));
    if (!(dtSeconds > 0 && dtSeconds <= 0.1)
        || viscosity < 0 || viscosity > 10
        || pressureScale < 0 || pressureScale > 10
        || surfaceTensionNPerM < 0 || surfaceTensionNPerM > 10
        || restitution < 0 || restitution > 1
        || pressureStiffnessPa < 0 || !(epsilon > 0)
        || (counts[2] === 1 && boundsMin.some((entry, axis) => entry >= boundsMax[axis]))) {
        throw new RangeError('GPU plan physical parameters are outside reference bounds');
    }
    return { counts, dtSeconds, gravityMPerS2, viscosity, pressureScale,
        surfaceTensionNPerM, restitution, boundsMin, boundsMax,
        pressureStiffnessPa, epsilon };
}

function validatePlanReadback(plan, read, maximumPackets, maximumPairs, device) {
    const packetCount = safeInteger(read?.packetCount, '$.packetCount', 1, maximumPackets);
    const pairCount = safeInteger(read?.pairCount, '$.pairCount', 0, maximumPairs);
    if (!Array.isArray(read?.packets) || read.packets.length !== packetCount
        || !read.options || typeof read.options !== 'object') {
        throw new TypeError('Adaptive SPH GPU plan readback is incomplete');
    }
    const carriers = parseCarrierBytes(read.carrierBytes, packetCount);
    const pairs = parsePairBytes(read.pairBytes, pairCount, packetCount);
    validateAdjacency(read.adjacencyOffsets, read.adjacencyPairs, pairs, packetCount, pairCount);
    const parameters = validateParameters(read.parameterBytes, packetCount, pairCount);
    const workgroupLimit = Number(device.limits.maxComputeWorkgroupsPerDimension);
    if (!Number.isFinite(workgroupLimit)
        || Math.ceil(packetCount / WORKGROUP_SIZE) > workgroupLimit
        || Math.ceil(pairCount / WORKGROUP_SIZE) > workgroupLimit) {
        throw new RangeError('Adaptive SPH GPU dispatch exceeds the device workgroup limit');
    }
    return { plan, ...read, packetCount, pairCount, carriers, pairs, parameters };
}

function shaderCompilationError(info) {
    const failures = [...(info?.messages ?? [])].filter(message => message.type === 'error');
    if (failures.length === 0) return null;
    return new Error(`Adaptive SPH GPU WGSL failed: ${failures.map(message =>
        `${message.lineNum ?? '?'}:${message.linePos ?? '?'} ${message.message}`).join(' | ')}`);
}

async function compilePipelines(device) {
    let failure = null;
    const scopes = [];
    if (typeof device.pushErrorScope === 'function' && typeof device.popErrorScope === 'function') {
        for (const filter of ['validation', 'internal']) {
            device.pushErrorScope(filter);
            scopes.push(filter);
        }
    }
    let module;
    let densityPipeline;
    let pairForcePipeline;
    let gatherPipeline;
    try {
        module = device.createShaderModule({
            label: 'AdaptiveSphGPU.Shader',
            code: ADAPTIVE_SPH_GPU_WGSL,
        });
        if (typeof module.getCompilationInfo === 'function') {
            failure = shaderCompilationError(await module.getCompilationInfo());
            if (failure) throw failure;
        }
        const createPipeline = descriptor => typeof device.createComputePipelineAsync === 'function'
            ? device.createComputePipelineAsync(descriptor)
            : Promise.resolve(device.createComputePipeline(descriptor));
        [densityPipeline, pairForcePipeline, gatherPipeline] = await Promise.all([
            createPipeline({
                label: 'AdaptiveSphGPU.Density.Pipeline',
                layout: 'auto',
                compute: { module, entryPoint: 'adaptiveSphDensity' },
            }),
            createPipeline({
                label: 'AdaptiveSphGPU.PairForce.Pipeline',
                layout: 'auto',
                compute: { module, entryPoint: 'adaptiveSphPairForce' },
            }),
            createPipeline({
                label: 'AdaptiveSphGPU.GatherIntegrate.Pipeline',
                layout: 'auto',
                compute: { module, entryPoint: 'adaptiveSphGatherIntegrate' },
            }),
        ]);
    } catch (error) {
        failure = error;
    }
    while (scopes.length > 0) {
        scopes.pop();
        try {
            const scopedError = await device.popErrorScope();
            if (!failure && scopedError) failure = new Error(
                `Adaptive SPH GPU compile scope failed: ${scopedError.message}`,
            );
        } catch (error) {
            if (!failure) failure = error;
        }
    }
    if (failure) throw failure;
    return { densityPipeline, pairForcePipeline, gatherPipeline };
}

function createBuffer(device, resources, label, size, usage) {
    const buffer = device.createBuffer({ label, size, usage });
    resources.push(buffer);
    return buffer;
}

function destroyResources(resources) {
    for (const resource of resources.splice(0)) {
        try {
            if (resource.mapState === 'mapped') resource.unmap();
        } catch (_error) {
            // Continue releasing the remaining execution-local resources.
        }
        try { resource.destroy(); } catch (_error) { /* Best-effort rollback. */ }
    }
}

function mappedCopy(buffer, byteLength) {
    const range = buffer.getMappedRange(0, byteLength);
    return new Uint8Array(range).slice().buffer;
}

function freezeRecords(records) {
    return Object.freeze(records.map(record => Object.freeze(record)));
}

function validateGpuOutputs(validated, carrierBytes, metricBytes, forceBytes) {
    const inputWords = new Uint32Array(validated.carrierBytes);
    const outputWords = new Uint32Array(carrierBytes);
    const carrierView = new DataView(carrierBytes);
    const preservedWords = [3, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    const carriers = [];
    const packets = [];
    for (let index = 0; index < validated.packetCount; index += 1) {
        const wordBase = index * 16;
        if (preservedWords.some(word => inputWords[wordBase + word] !== outputWords[wordBase + word])) {
            throw new Error(`GPU carrier ${index} changed reserved mass, volume, support, or metadata`);
        }
        const base = index * CARRIER_BYTES;
        const value = offset => carrierView.getFloat32(base + offset, true);
        const positionM = [value(0), value(4), value(8)];
        const velocityMPerS = [value(16), value(20), value(24)];
        [...positionM, ...velocityMPerS].forEach((entry, lane) => {
            if (!Number.isFinite(entry)) throw new Error(
                `GPU carrier ${index} produced non-finite dynamic lane ${lane}`,
            );
        });
        const source = validated.carriers[index];
        carriers.push({ ...source, positionM: Object.freeze(positionM),
            velocityMPerS: Object.freeze(velocityMPerS) });
        packets.push({ ...validated.packets[index], positionM: Object.freeze(positionM),
            velocityMPerS: Object.freeze(velocityMPerS) });
    }
    const metricView = new DataView(metricBytes);
    const metrics = [];
    for (let index = 0; index < validated.packetCount; index += 1) {
        const base = index * METRIC_BYTES;
        const values = [0, 4, 8, 12].map(offset => metricView.getFloat32(base + offset, true));
        if (!values.every(Number.isFinite) || !(values[0] > 0)
            || values[2] < 0 || values[2] > 1 || values[3] < 0 || values[3] > 1) {
            throw new Error(`GPU metric ${index} is outside the bounded reference domain`);
        }
        metrics.push({ packetIndex: index, densityKgM3: values[0], pressurePa: values[1],
            surfaceIndicator: values[2], neighborDeficiency: values[3] });
    }
    const forceView = new DataView(forceBytes);
    const forceRecords = [];
    for (let index = 0; index < validated.pairCount; index += 1) {
        const base = index * FORCE_BYTES;
        const forceN = [0, 4, 8].map(offset => forceView.getFloat32(base + offset, true));
        const padding = forceView.getFloat32(base + 12, true);
        if (!forceN.every(Number.isFinite) || padding !== 0) {
            throw new Error(`GPU scratch pair force ${index} is non-finite or malformed`);
        }
        forceRecords.push({ edgeIndex: index,
            leftIndex: validated.pairs[index].leftIndex,
            rightIndex: validated.pairs[index].rightIndex,
            forceN: Object.freeze(forceN),
            role: 'scratch-one-edge-left-force-right-gathers-negative' });
    }
    return {
        carriers: freezeRecords(carriers),
        packets: freezeRecords(packets),
        metrics: freezeRecords(metrics),
        forceRecords: freezeRecords(forceRecords),
    };
}

/** Create a compile-validated, single-flight research executor. */
export async function createAdaptiveSphGpuExecutor({
    device,
    maximumPackets = 4096,
    maximumPairs = 262_144,
    logger = null,
} = {}) {
    const packetCapacity = safeInteger(maximumPackets, '$.maximumPackets', 1,
        MAXIMUM_IMPLEMENTATION_PACKETS);
    const pairCapacity = safeInteger(maximumPairs, '$.maximumPairs', 0,
        MAXIMUM_IMPLEMENTATION_PAIRS);
    const gpuConstants = bufferUsageConstants();
    validateDevice(device, packetCapacity, pairCapacity);
    logAdaptiveFluid(logger, 'debug', 'adaptive-sph-gpu-compile-start', {
        maximumPackets: packetCapacity,
        maximumPairs: pairCapacity,
        physicalAuthorityGranted: false,
    });
    let pipelines;
    try {
        pipelines = await compilePipelines(device);
    } catch (error) {
        logAdaptiveFluid(logger, 'error', 'adaptive-sph-gpu-compile-failed', {
            message: error?.message ?? String(error),
            physicalAuthorityGranted: false,
        });
        throw error;
    }

    let destroyed = false;
    let busy = false;
    let lifecycleGeneration = 0;
    let executions = 0;
    let failures = 0;
    let lastDiagnostics = null;
    let activeResources = null;

    function state() {
        return Object.freeze({
            schema: 'engine.matter.adaptive-sph-gpu-executor-state',
            schemaVersion: '1.0.0',
            destroyed,
            busy,
            executions,
            failures,
            maximumPackets: packetCapacity,
            maximumPairs: pairCapacity,
            physicalAuthorityGranted: false,
            lastDiagnostics,
        });
    }

    function destroy() {
        if (!destroyed) {
            destroyed = true;
            lifecycleGeneration += 1;
            lastDiagnostics = null;
            if (activeResources) destroyResources(activeResources);
            logAdaptiveFluid(logger, 'debug', 'adaptive-sph-gpu-destroyed', {
                inFlight: busy,
                physicalAuthorityGranted: false,
            });
        }
        return state();
    }

    async function execute(plan) {
        if (destroyed) throw new Error('Adaptive SPH GPU executor is destroyed');
        if (busy) throw new Error('Adaptive SPH GPU executor is busy');
        busy = true;
        const executionGeneration = lifecycleGeneration;
        const resources = [];
        activeResources = resources;
        let submitted = false;
        try {
            const read = readAdaptiveSphGpuPlan(plan);
            const validated = validatePlanReadback(
                plan,
                read,
                packetCapacity,
                pairCapacity,
                device,
            );
            logAdaptiveFluid(logger, 'debug', 'adaptive-sph-gpu-execution-start', {
                packetCount: validated.packetCount,
                pairCount: validated.pairCount,
                physicalAuthorityGranted: false,
            });
            const { usage, mapRead } = gpuConstants;
            const carrierSize = validated.packetCount * CARRIER_BYTES;
            const pairSize = Math.max(PAIR_BYTES, validated.pairCount * PAIR_BYTES);
            const adjacencySize = validated.adjacencyPairs.byteLength;
            const metricSize = validated.packetCount * METRIC_BYTES;
            const forceSize = Math.max(FORCE_BYTES, validated.pairCount * FORCE_BYTES);
            const carrierInput = createBuffer(device, resources, 'AdaptiveSphGPU.Carriers.Input',
                carrierSize, usage.STORAGE | usage.COPY_DST);
            const pairInput = createBuffer(device, resources, 'AdaptiveSphGPU.Pairs.Input',
                pairSize, usage.STORAGE | usage.COPY_DST);
            const offsetInput = createBuffer(device, resources, 'AdaptiveSphGPU.CSR.Offsets',
                validated.adjacencyOffsets.byteLength, usage.STORAGE | usage.COPY_DST);
            const adjacencyInput = createBuffer(device, resources, 'AdaptiveSphGPU.CSR.Edges',
                adjacencySize, usage.STORAGE | usage.COPY_DST);
            const parameterInput = createBuffer(device, resources, 'AdaptiveSphGPU.Parameters',
                PARAMETER_BYTES, usage.UNIFORM | usage.COPY_DST);
            const metricsBuffer = createBuffer(device, resources, 'AdaptiveSphGPU.Metrics',
                metricSize, usage.STORAGE | usage.COPY_SRC);
            const scratchForceBuffer = createBuffer(device, resources,
                'AdaptiveSphGPU.ScratchPairForces', forceSize, usage.STORAGE | usage.COPY_SRC);
            const carrierOutput = createBuffer(device, resources, 'AdaptiveSphGPU.Carriers.Output',
                carrierSize, usage.STORAGE | usage.COPY_SRC);
            const carrierReadback = createBuffer(device, resources,
                'AdaptiveSphGPU.Carriers.Readback', carrierSize,
                usage.MAP_READ | usage.COPY_DST);
            const metricReadback = createBuffer(device, resources,
                'AdaptiveSphGPU.Metrics.Readback', metricSize,
                usage.MAP_READ | usage.COPY_DST);
            const forceReadback = createBuffer(device, resources,
                'AdaptiveSphGPU.ScratchPairForces.Readback', forceSize,
                usage.MAP_READ | usage.COPY_DST);
            device.queue.writeBuffer(carrierInput, 0, validated.carrierBytes);
            device.queue.writeBuffer(pairInput, 0, validated.pairBytes);
            device.queue.writeBuffer(offsetInput, 0, validated.adjacencyOffsets);
            device.queue.writeBuffer(adjacencyInput, 0, validated.adjacencyPairs);
            device.queue.writeBuffer(parameterInput, 0, validated.parameterBytes);

            const densityGroup = device.createBindGroup({
                label: 'AdaptiveSphGPU.Density.BindGroup',
                layout: pipelines.densityPipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: carrierInput } },
                    { binding: 1, resource: { buffer: pairInput } },
                    { binding: 2, resource: { buffer: offsetInput } },
                    { binding: 3, resource: { buffer: adjacencyInput } },
                    { binding: 4, resource: { buffer: parameterInput } },
                    { binding: 5, resource: { buffer: metricsBuffer } },
                ],
            });
            const forceGroup = device.createBindGroup({
                label: 'AdaptiveSphGPU.PairForce.BindGroup',
                layout: pipelines.pairForcePipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: carrierInput } },
                    { binding: 1, resource: { buffer: pairInput } },
                    { binding: 4, resource: { buffer: parameterInput } },
                    { binding: 5, resource: { buffer: metricsBuffer } },
                    { binding: 6, resource: { buffer: scratchForceBuffer } },
                ],
            });
            const gatherGroup = device.createBindGroup({
                label: 'AdaptiveSphGPU.GatherIntegrate.BindGroup',
                layout: pipelines.gatherPipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: carrierInput } },
                    { binding: 1, resource: { buffer: pairInput } },
                    { binding: 2, resource: { buffer: offsetInput } },
                    { binding: 3, resource: { buffer: adjacencyInput } },
                    { binding: 4, resource: { buffer: parameterInput } },
                    { binding: 6, resource: { buffer: scratchForceBuffer } },
                    { binding: 7, resource: { buffer: carrierOutput } },
                ],
            });
            const encoder = device.createCommandEncoder({ label: 'AdaptiveSphGPU.Execute' });
            {
                const pass = encoder.beginComputePass({ label: 'AdaptiveSphGPU.Density' });
                pass.setPipeline(pipelines.densityPipeline);
                pass.setBindGroup(0, densityGroup);
                pass.dispatchWorkgroups(Math.ceil(validated.packetCount / WORKGROUP_SIZE));
                pass.end();
            }
            {
                const pass = encoder.beginComputePass({ label: 'AdaptiveSphGPU.PairForce' });
                pass.setPipeline(pipelines.pairForcePipeline);
                pass.setBindGroup(0, forceGroup);
                pass.dispatchWorkgroups(Math.ceil(validated.pairCount / WORKGROUP_SIZE));
                pass.end();
            }
            {
                const pass = encoder.beginComputePass({ label: 'AdaptiveSphGPU.GatherIntegrate' });
                pass.setPipeline(pipelines.gatherPipeline);
                pass.setBindGroup(0, gatherGroup);
                pass.dispatchWorkgroups(Math.ceil(validated.packetCount / WORKGROUP_SIZE));
                pass.end();
            }
            encoder.copyBufferToBuffer(carrierOutput, 0, carrierReadback, 0, carrierSize);
            encoder.copyBufferToBuffer(metricsBuffer, 0, metricReadback, 0, metricSize);
            encoder.copyBufferToBuffer(scratchForceBuffer, 0, forceReadback, 0, forceSize);
            device.queue.submit([encoder.finish()]);
            submitted = true;
            const mapping = await Promise.allSettled([
                carrierReadback.mapAsync(mapRead, 0, carrierSize),
                metricReadback.mapAsync(mapRead, 0, metricSize),
                forceReadback.mapAsync(mapRead, 0, forceSize),
            ]);
            const rejected = mapping.find(entry => entry.status === 'rejected');
            if (rejected) throw rejected.reason;
            if (destroyed || executionGeneration !== lifecycleGeneration) {
                throw new Error('Adaptive SPH GPU execution retired before readback publication');
            }
            const outputCarrierBytes = mappedCopy(carrierReadback, carrierSize);
            const outputMetricBytes = mappedCopy(metricReadback, metricSize);
            const outputForceBytes = mappedCopy(forceReadback, forceSize);
            const output = validateGpuOutputs(
                validated,
                outputCarrierBytes,
                outputMetricBytes,
                outputForceBytes,
            );
            const diagnostics = Object.freeze({
                schema: 'engine.matter.adaptive-sph-gpu-execution-diagnostics',
                schemaVersion: '1.0.0',
                executionIndex: executions + 1,
                packetCount: validated.packetCount,
                pairCount: validated.pairCount,
                passOrder: Object.freeze([
                    'density-metrics',
                    'scratch-pair-force-once',
                    'csr-opposite-sign-gather-and-semiimplicit-integrate',
                ]),
                densityWorkgroups: Math.ceil(validated.packetCount / WORKGROUP_SIZE),
                pairWorkgroups: Math.ceil(validated.pairCount / WORKGROUP_SIZE),
                gatherWorkgroups: Math.ceil(validated.packetCount / WORKGROUP_SIZE),
                gpuDispatchEncoded: true,
                gpuSubmissionCompleted: true,
                executionState: 'research-output-readback',
                scratchForceRole: 'not-the-reserved-physical-pair-impulse-abi',
                fullMixedResolutionStageCompliance: false,
                physicalAuthorityGranted: false,
            });
            executions += 1;
            lastDiagnostics = diagnostics;
            logAdaptiveFluid(logger, 'debug', 'adaptive-sph-gpu-execution-complete', diagnostics);
            const forceRecords = output.forceRecords;
            return Object.freeze({
                schema: ADAPTIVE_SPH_GPU_EXECUTION_SCHEMA,
                schemaVersion: ADAPTIVE_SPH_GPU_EXECUTION_VERSION,
                sourceRevision: plan.sourceRevision,
                carrierBytes: outputCarrierBytes,
                carriers: output.carriers,
                packets: output.packets,
                metrics: output.metrics,
                forceRecords,
                pairForces: forceRecords,
                diagnostics,
                authority: Object.freeze({
                    physicalAuthorityGranted: false,
                    writesCanonicalParticleState: false,
                    canDriveNeighborPhysics: false,
                    role: 'research-candidate-readback',
                }),
            });
        } catch (error) {
            if (!destroyed && executionGeneration === lifecycleGeneration) {
                failures += 1;
                lastDiagnostics = Object.freeze({
                    executionState: submitted ? 'submitted-readback-rejected' : 'pre-submit-rejected',
                    message: error?.message ?? String(error),
                    physicalAuthorityGranted: false,
                });
                logAdaptiveFluid(logger, 'error', 'adaptive-sph-gpu-execution-failed',
                    lastDiagnostics);
            }
            throw error;
        } finally {
            destroyResources(resources);
            if (activeResources === resources) activeResources = null;
            busy = false;
        }
    }

    logAdaptiveFluid(logger, 'debug', 'adaptive-sph-gpu-compile-complete', {
        workgroupSize: WORKGROUP_SIZE,
        physicalAuthorityGranted: false,
    });
    return Object.freeze({ execute, destroy, state });
}

export default createAdaptiveSphGpuExecutor;
