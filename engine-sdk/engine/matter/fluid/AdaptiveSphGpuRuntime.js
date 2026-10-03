// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Persistent, caller-encoded shadow runtime for the adaptive SPH GPU operator.
 *
 * This is deliberately a physical-authority foundation rather than an
 * authority grant. It reuses the research operator's WGSL and opaque plans,
 * keeps its working arena resident, and publishes only a compact validation
 * receipt after the caller submits the command buffer. A separate trusted
 * mixed-resolution execution certificate is still required before any future
 * owner may commit these carriers as canonical simulation state.
 */

import { logAdaptiveFluid } from './AdaptiveFluidContracts.js';
import {
    ADAPTIVE_SPH_GPU_MAX_PACKETS,
    ADAPTIVE_SPH_GPU_MAX_PAIRS,
    ADAPTIVE_SPH_GPU_PLAN_SCHEMA,
    ADAPTIVE_SPH_GPU_PLAN_VERSION,
    readAdaptiveSphGpuPlan,
} from './AdaptiveSphGpuPlan.js';
import { ADAPTIVE_SPH_GPU_WGSL } from './AdaptiveSphGpuExecutor.js';
import {
    MIXED_RESOLUTION_FLUID_EXECUTION_CERTIFICATE_SCHEMA,
} from './MixedResolutionFluidExecutionCertificate.js';

export const ADAPTIVE_SPH_GPU_RUNTIME_SCHEMA = 'engine.matter.adaptive-sph-gpu-runtime';
export const ADAPTIVE_SPH_GPU_RUNTIME_VERSION = '1.0.0';
export const ADAPTIVE_SPH_GPU_RUNTIME_RECEIPT_SCHEMA =
    'engine.matter.adaptive-sph-gpu-runtime-receipt';
export const ADAPTIVE_SPH_GPU_RUNTIME_RECEIPT_VERSION = '1.0.0';
export const ADAPTIVE_SPH_GPU_RUNTIME_TOKEN_SCHEMA =
    'engine.matter.adaptive-sph-gpu-runtime-token';
export const ADAPTIVE_SPH_GPU_RUNTIME_RECEIPT_BYTES = 64;

const CARRIER_BYTES = 64;
const PAIR_BYTES = 16;
const ADJACENCY_OFFSET_BYTES = 16;
const ADJACENCY_PAIR_BYTES = 8;
const METRIC_BYTES = 16;
const FORCE_BYTES = 16;
const PARAMETER_BYTES = 80;
const WORKGROUP_SIZE = 64;
const REQUIRED_PASS_MASK = 3;
const UINT32_MAXIMUM = 0xffff_ffff;
const TOKENS = new WeakMap();

const SHADOW_AUTHORITY = Object.freeze({
    mode: 'shadow-only',
    physicalAuthorityGranted: false,
    writesCanonicalParticleState: false,
    certificateRequired: true,
    certificateSchema: MIXED_RESOLUTION_FLUID_EXECUTION_CERTIFICATE_SCHEMA,
});

const RECEIPT_WGSL = /* wgsl */`
struct Carrier {
  positionMass: vec4<f32>,
  velocityVolume: vec4<f32>,
  supportRestSubgridInverseMass: vec4<f32>,
  stableIdLevelKindFlags: vec4<u32>,
};

@group(0) @binding(0) var<storage, read> sourceCarriers: array<Carrier>;
@group(0) @binding(1) var<storage, read> outputCarriers: array<Carrier>;
@group(0) @binding(2) var<storage, read> densityMetrics: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> scratchPairForces: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read_write> receipt: array<atomic<u32>>;

fn finiteLane(value: f32) -> bool {
  return (bitcast<u32>(value) & 0x7f800000u) != 0x7f800000u;
}

fn finiteVector3(value: vec3<f32>) -> bool {
  return finiteLane(value.x) && finiteLane(value.y) && finiteLane(value.z);
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn validateCarrierOutput(@builtin(global_invocation_id) invocation: vec3<u32>) {
  let index = invocation.x;
  let packetCount = atomicLoad(&receipt[4]);
  if (index >= packetCount) { return; }
  let source = sourceCarriers[index];
  let output = outputCarriers[index];
  if (!finiteVector3(output.positionMass.xyz)
      || !finiteVector3(output.velocityVolume.xyz)) {
    atomicAdd(&receipt[0], 1u);
  }
  let staticMismatch = bitcast<u32>(source.positionMass.w)
      != bitcast<u32>(output.positionMass.w)
    || bitcast<u32>(source.velocityVolume.w)
      != bitcast<u32>(output.velocityVolume.w)
    || any(bitcast<vec4<u32>>(source.supportRestSubgridInverseMass)
      != bitcast<vec4<u32>>(output.supportRestSubgridInverseMass))
    || any(source.stableIdLevelKindFlags != output.stableIdLevelKindFlags);
  if (staticMismatch) { atomicAdd(&receipt[1], 1u); }
  let metric = densityMetrics[index];
  if (!finiteLane(metric.x) || !finiteLane(metric.y)
      || !finiteLane(metric.z) || !finiteLane(metric.w)
      || metric.x <= 0.0 || metric.z < 0.0 || metric.z > 1.0
      || metric.w < 0.0 || metric.w > 1.0) {
    atomicAdd(&receipt[2], 1u);
  }
  atomicOr(&receipt[10], 1u);
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn validatePairOutput(@builtin(global_invocation_id) invocation: vec3<u32>) {
  let index = invocation.x;
  let pairCount = atomicLoad(&receipt[5]);
  if (index >= pairCount) { return; }
  let force = scratchPairForces[index];
  if (!finiteVector3(force.xyz) || force.w != 0.0) {
    atomicAdd(&receipt[3], 1u);
  }
  atomicOr(&receipt[10], 2u);
}
`;

function safeInteger(value, path, minimum, maximum) {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
        throw new RangeError(`${path}: expected an integer in [${minimum}, ${maximum}]`);
    }
    return value;
}

function requiredMethod(owner, method, path) {
    if (typeof owner?.[method] !== 'function') {
        throw new TypeError(`${path}.${method}: required WebGPU method is missing`);
    }
}

function webGpuConstants() {
    const usage = globalThis.GPUBufferUsage;
    const mapMode = globalThis.GPUMapMode;
    if (!usage || !mapMode || !Number.isInteger(mapMode.READ)) {
        throw new Error('Adaptive SPH GPU runtime requires browser WebGPU constants');
    }
    return { usage, mapRead: mapMode.READ };
}

function finiteLimit(limits, key) {
    const value = Number(limits?.[key]);
    if (!Number.isFinite(value) || value < 0) {
        throw new RangeError(`$.device.limits.${key}: finite WebGPU limit is required`);
    }
    return Math.floor(value);
}

/** Derive the real implementation envelope from both caller and device limits. */
export function admitAdaptiveSphGpuRuntimeCapacity({
    device,
    maximumPackets = ADAPTIVE_SPH_GPU_MAX_PACKETS,
    maximumPairs = ADAPTIVE_SPH_GPU_MAX_PAIRS,
    initialPacketCapacity = 1,
    initialPairCapacity = 0,
} = {}) {
    requiredMethod(device, 'createBuffer', '$.device');
    const requestedPackets = safeInteger(
        maximumPackets,
        '$.maximumPackets',
        1,
        ADAPTIVE_SPH_GPU_MAX_PACKETS,
    );
    const requestedPairs = safeInteger(
        maximumPairs,
        '$.maximumPairs',
        0,
        ADAPTIVE_SPH_GPU_MAX_PAIRS,
    );
    const limits = device.limits;
    const maximumBufferSize = finiteLimit(limits, 'maxBufferSize');
    const maximumStorageBinding = finiteLimit(limits, 'maxStorageBufferBindingSize');
    const maximumUniformBinding = finiteLimit(limits, 'maxUniformBufferBindingSize');
    const maximumWorkgroups = finiteLimit(limits, 'maxComputeWorkgroupsPerDimension');
    const maximumStorageBuffers = finiteLimit(limits, 'maxStorageBuffersPerShaderStage');
    const maximumBindings = finiteLimit(limits, 'maxBindingsPerBindGroup');
    const maximumWorkgroupInvocations = finiteLimit(limits, 'maxComputeInvocationsPerWorkgroup');
    if (maximumUniformBinding < PARAMETER_BYTES
        || maximumStorageBuffers < 6
        || maximumBindings < 8
        || maximumWorkgroupInvocations < WORKGROUP_SIZE
        || maximumBufferSize < ADAPTIVE_SPH_GPU_RUNTIME_RECEIPT_BYTES
        || maximumStorageBinding < ADAPTIVE_SPH_GPU_RUNTIME_RECEIPT_BYTES) {
        throw new RangeError('Adaptive SPH GPU runtime is unsupported by this device');
    }
    const storageCeiling = Math.min(maximumBufferSize, maximumStorageBinding);
    const packetLimit = Math.min(
        requestedPackets,
        Math.floor(storageCeiling / CARRIER_BYTES),
        Math.floor(storageCeiling / ADJACENCY_OFFSET_BYTES),
        maximumWorkgroups * WORKGROUP_SIZE,
    );
    const pairLimit = Math.min(
        requestedPairs,
        Math.floor(storageCeiling / PAIR_BYTES),
        Math.floor(storageCeiling / ADJACENCY_PAIR_BYTES),
        maximumWorkgroups * WORKGROUP_SIZE,
    );
    if (packetLimit < 1) {
        throw new RangeError('Adaptive SPH GPU runtime has no admissible packet capacity');
    }
    const initialPackets = safeInteger(
        initialPacketCapacity,
        '$.initialPacketCapacity',
        1,
        packetLimit,
    );
    const initialPairs = safeInteger(
        initialPairCapacity,
        '$.initialPairCapacity',
        0,
        pairLimit,
    );
    return Object.freeze({
        schema: 'engine.matter.adaptive-sph-gpu-runtime-capacity',
        schemaVersion: '1.0.0',
        maximumPackets: packetLimit,
        maximumPairs: pairLimit,
        initialPacketCapacity: initialPackets,
        initialPairCapacity: initialPairs,
        workgroupSize: WORKGROUP_SIZE,
        maximumWorkgroupsPerDimension: maximumWorkgroups,
        storageBindingBytes: storageCeiling,
        authority: SHADOW_AUTHORITY,
    });
}

function validateDevice(device) {
    for (const method of [
        'createShaderModule', 'createBindGroup', 'createCommandEncoder', 'createBuffer',
    ]) requiredMethod(device, method, '$.device');
    for (const method of ['writeBuffer']) requiredMethod(device.queue, method, '$.device.queue');
    if (!device.limits) throw new TypeError('$.device.limits: required WebGPU limits are missing');
    return device;
}

function compilationFailure(info, label) {
    const errors = [...(info?.messages ?? [])].filter(message => message.type === 'error');
    return errors.length === 0 ? null : new Error(
        `${label} WGSL failed: ${errors.map(message => (
            `${message.lineNum ?? '?'}:${message.linePos ?? '?'} ${message.message}`
        )).join(' | ')}`,
    );
}

async function compileRuntimePipelines(device) {
    const scoped = typeof device.pushErrorScope === 'function'
        && typeof device.popErrorScope === 'function';
    if (scoped) {
        device.pushErrorScope('validation');
        device.pushErrorScope('internal');
    }
    let result = null;
    let failure = null;
    try {
        const operatorModule = device.createShaderModule({
            label: 'AdaptiveSphGPU.Runtime.OperatorShader',
            code: ADAPTIVE_SPH_GPU_WGSL,
        });
        const receiptModule = device.createShaderModule({
            label: 'AdaptiveSphGPU.Runtime.ReceiptShader',
            code: RECEIPT_WGSL,
        });
        if (typeof operatorModule.getCompilationInfo === 'function') {
            const info = await operatorModule.getCompilationInfo();
            failure = compilationFailure(info, 'Adaptive SPH operator');
            if (failure) throw failure;
        }
        if (typeof receiptModule.getCompilationInfo === 'function') {
            const info = await receiptModule.getCompilationInfo();
            failure = compilationFailure(info, 'Adaptive SPH receipt');
            if (failure) throw failure;
        }
        const create = descriptor => typeof device.createComputePipelineAsync === 'function'
            ? device.createComputePipelineAsync(descriptor)
            : Promise.resolve(device.createComputePipeline(descriptor));
        const make = (label, module, entryPoint) => create({
            label,
            layout: 'auto',
            compute: { module, entryPoint },
        });
        const [density, pairForce, gather, validateCarriers, validatePairs] = await Promise.all([
            make('AdaptiveSphGPU.Runtime.Density', operatorModule, 'adaptiveSphDensity'),
            make('AdaptiveSphGPU.Runtime.PairForce', operatorModule, 'adaptiveSphPairForce'),
            make('AdaptiveSphGPU.Runtime.Gather', operatorModule, 'adaptiveSphGatherIntegrate'),
            make('AdaptiveSphGPU.Runtime.ValidateCarriers', receiptModule, 'validateCarrierOutput'),
            make('AdaptiveSphGPU.Runtime.ValidatePairs', receiptModule, 'validatePairOutput'),
        ]);
        result = Object.freeze({ density, pairForce, gather, validateCarriers, validatePairs });
    } catch (error) {
        failure = error;
    }
    if (scoped) {
        for (let index = 0; index < 2; index += 1) {
            try {
                const error = await device.popErrorScope();
                if (!failure && error) failure = new Error(
                    `Adaptive SPH runtime compile scope failed: ${error.message}`,
                );
            } catch (error) {
                if (!failure) failure = error;
            }
        }
    }
    if (failure) throw failure;
    return result;
}

function createOwnedBuffer(device, owned, label, size, usage) {
    const buffer = device.createBuffer({ label, size, usage });
    owned.push(buffer);
    return buffer;
}

function destroyBuffer(buffer) {
    if (!buffer) return;
    try { if (buffer.mapState === 'mapped') buffer.unmap(); } catch (_error) { /* continue */ }
    try { buffer.destroy(); } catch (_error) { /* best-effort lifecycle cleanup */ }
}

function destroyBundle(bundle) {
    if (!bundle || bundle.destroyed) return;
    bundle.destroyed = true;
    for (const buffer of bundle.owned.splice(0)) destroyBuffer(buffer);
}

function createBundle(device, pipelines, usage, packetCapacity, pairCapacity, serial) {
    const owned = [];
    try {
        const pairStorageCapacity = Math.max(1, pairCapacity);
        const carrierInput = createOwnedBuffer(device, owned,
            `AdaptiveSphGPU.Runtime.${serial}.Carriers.Input`,
            packetCapacity * CARRIER_BYTES, usage.STORAGE | usage.COPY_DST);
        const pairInput = createOwnedBuffer(device, owned,
            `AdaptiveSphGPU.Runtime.${serial}.Pairs.Input`,
            pairStorageCapacity * PAIR_BYTES, usage.STORAGE | usage.COPY_DST);
        const offsetsInput = createOwnedBuffer(device, owned,
            `AdaptiveSphGPU.Runtime.${serial}.CSR.Offsets`,
            packetCapacity * ADJACENCY_OFFSET_BYTES, usage.STORAGE | usage.COPY_DST);
        const adjacencyInput = createOwnedBuffer(device, owned,
            `AdaptiveSphGPU.Runtime.${serial}.CSR.Edges`,
            Math.max(16, pairCapacity * ADJACENCY_PAIR_BYTES),
            usage.STORAGE | usage.COPY_DST);
        const parameterInput = createOwnedBuffer(device, owned,
            `AdaptiveSphGPU.Runtime.${serial}.Parameters`,
            PARAMETER_BYTES, usage.UNIFORM | usage.COPY_DST);
        const metrics = createOwnedBuffer(device, owned,
            `AdaptiveSphGPU.Runtime.${serial}.Metrics`,
            packetCapacity * METRIC_BYTES, usage.STORAGE);
        const pairForces = createOwnedBuffer(device, owned,
            `AdaptiveSphGPU.Runtime.${serial}.PairForces`,
            pairStorageCapacity * FORCE_BYTES, usage.STORAGE);
        const carrierOutput = createOwnedBuffer(device, owned,
            `AdaptiveSphGPU.Runtime.${serial}.Carriers.Output`,
            packetCapacity * CARRIER_BYTES, usage.STORAGE | usage.COPY_SRC);
        const receipt = createOwnedBuffer(device, owned,
            `AdaptiveSphGPU.Runtime.${serial}.Receipt`,
            ADAPTIVE_SPH_GPU_RUNTIME_RECEIPT_BYTES,
            usage.STORAGE | usage.COPY_SRC | usage.COPY_DST);
        const densityGroup = device.createBindGroup({
            label: `AdaptiveSphGPU.Runtime.${serial}.Density.Group`,
            layout: pipelines.density.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: carrierInput } },
                { binding: 1, resource: { buffer: pairInput } },
                { binding: 2, resource: { buffer: offsetsInput } },
                { binding: 3, resource: { buffer: adjacencyInput } },
                { binding: 4, resource: { buffer: parameterInput } },
                { binding: 5, resource: { buffer: metrics } },
            ],
        });
        const forceGroup = device.createBindGroup({
            label: `AdaptiveSphGPU.Runtime.${serial}.PairForce.Group`,
            layout: pipelines.pairForce.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: carrierInput } },
                { binding: 1, resource: { buffer: pairInput } },
                { binding: 4, resource: { buffer: parameterInput } },
                { binding: 5, resource: { buffer: metrics } },
                { binding: 6, resource: { buffer: pairForces } },
            ],
        });
        const gatherGroup = device.createBindGroup({
            label: `AdaptiveSphGPU.Runtime.${serial}.Gather.Group`,
            layout: pipelines.gather.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: carrierInput } },
                { binding: 1, resource: { buffer: pairInput } },
                { binding: 2, resource: { buffer: offsetsInput } },
                { binding: 3, resource: { buffer: adjacencyInput } },
                { binding: 4, resource: { buffer: parameterInput } },
                { binding: 6, resource: { buffer: pairForces } },
                { binding: 7, resource: { buffer: carrierOutput } },
            ],
        });
        const validateCarrierGroup = device.createBindGroup({
            label: `AdaptiveSphGPU.Runtime.${serial}.ValidateCarrier.Group`,
            layout: pipelines.validateCarriers.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: carrierInput } },
                { binding: 1, resource: { buffer: carrierOutput } },
                { binding: 2, resource: { buffer: metrics } },
                { binding: 4, resource: { buffer: receipt } },
            ],
        });
        const validatePairGroup = device.createBindGroup({
            label: `AdaptiveSphGPU.Runtime.${serial}.ValidatePair.Group`,
            layout: pipelines.validatePairs.getBindGroupLayout(0),
            entries: [
                { binding: 3, resource: { buffer: pairForces } },
                { binding: 4, resource: { buffer: receipt } },
            ],
        });
        return {
            serial,
            packetCapacity,
            pairCapacity,
            owned,
            carrierInput,
            pairInput,
            offsetsInput,
            adjacencyInput,
            parameterInput,
            metrics,
            pairForces,
            carrierOutput,
            receipt,
            densityGroup,
            forceGroup,
            gatherGroup,
            validateCarrierGroup,
            validatePairGroup,
            references: 0,
            retired: false,
            destroyed: false,
        };
    } catch (error) {
        for (const buffer of owned) destroyBuffer(buffer);
        throw error;
    }
}

function createReadbackSlots(device, usage, count) {
    return Array.from({ length: count }, (_, index) => ({
        index,
        state: 'free',
        token: null,
        buffer: device.createBuffer({
            label: `AdaptiveSphGPU.Runtime.ReceiptReadback.${index}`,
            size: ADAPTIVE_SPH_GPU_RUNTIME_RECEIPT_BYTES,
            usage: usage.MAP_READ | usage.COPY_DST,
        }),
    }));
}

function nextCapacity(current, required, maximum) {
    let result = Math.max(1, current);
    while (result < required && result < maximum) {
        result = Math.min(maximum, result * 2);
    }
    return result;
}

function validatePlan(plan, capacity) {
    if (plan?.schema !== ADAPTIVE_SPH_GPU_PLAN_SCHEMA
        || plan?.schemaVersion !== ADAPTIVE_SPH_GPU_PLAN_VERSION
        || plan?.numericAdmission?.admitted !== true
        || plan?.authority?.liveSimulationMutation !== false
        || plan?.authority?.physicalHandoff !== false) {
        throw new TypeError('$.plan: an admitted non-authoritative Adaptive SPH GPU plan is required');
    }
    const read = readAdaptiveSphGpuPlan(plan);
    const packetCount = safeInteger(read.packetCount, '$.plan.packetCount', 1,
        capacity.maximumPackets);
    const pairCount = safeInteger(read.pairCount, '$.plan.pairCount', 0,
        capacity.maximumPairs);
    const sourceRevision = safeInteger(plan.sourceRevision, '$.plan.sourceRevision', 0,
        UINT32_MAXIMUM);
    if (!(read.carrierBytes instanceof ArrayBuffer)
        || read.carrierBytes.byteLength !== packetCount * CARRIER_BYTES
        || !(read.pairBytes instanceof ArrayBuffer)
        || read.pairBytes.byteLength !== Math.max(PAIR_BYTES, pairCount * PAIR_BYTES)
        || !(read.adjacencyOffsets instanceof Uint32Array)
        || read.adjacencyOffsets.byteLength !== packetCount * ADJACENCY_OFFSET_BYTES
        || !(read.adjacencyPairs instanceof Uint32Array)
        || read.adjacencyPairs.byteLength !== Math.max(16, pairCount * ADJACENCY_PAIR_BYTES)
        || !(read.parameterBytes instanceof ArrayBuffer)
        || read.parameterBytes.byteLength !== PARAMETER_BYTES) {
        throw new TypeError('$.plan: packed GPU ABI bytes are incomplete');
    }
    return { ...read, plan, packetCount, pairCount, sourceRevision };
}

function encodePass(encoder, label, pipeline, group, workgroups) {
    const pass = encoder.beginComputePass({ label });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, group);
    pass.dispatchWorkgroups(workgroups);
    pass.end();
}

function parseReceipt(bytes, record) {
    if (!(bytes instanceof ArrayBuffer)
        || bytes.byteLength !== ADAPTIVE_SPH_GPU_RUNTIME_RECEIPT_BYTES) {
        throw new TypeError('Adaptive SPH GPU runtime receipt has an invalid byte length');
    }
    const words = new Uint32Array(bytes);
    const [dynamicNonFinite, staticMismatch, metricInvalid, forceInvalid,
        packetCount, pairCount, frameIndex, deviceGeneration,
        sourceRevision, targetRevision, passMask, reserved] = words;
    if (packetCount !== record.packetCount
        || pairCount !== record.pairCount
        || frameIndex !== record.frameIndex
        || deviceGeneration !== record.deviceGeneration
        || sourceRevision !== record.sourceRevision
        || targetRevision !== record.targetRevision
        || reserved !== 0
        || words.slice(12).some(value => value !== 0)) {
        throw new Error('Adaptive SPH GPU runtime receipt identity is stale or malformed');
    }
    const validationPassed = dynamicNonFinite === 0
        && staticMismatch === 0
        && metricInvalid === 0
        && forceInvalid === 0
        && passMask === REQUIRED_PASS_MASK;
    return Object.freeze({
        schema: ADAPTIVE_SPH_GPU_RUNTIME_RECEIPT_SCHEMA,
        schemaVersion: ADAPTIVE_SPH_GPU_RUNTIME_RECEIPT_VERSION,
        frameIndex,
        sourceRevision,
        targetRevision,
        deviceGeneration,
        packetCount,
        pairCount,
        receiptByteLength: ADAPTIVE_SPH_GPU_RUNTIME_RECEIPT_BYTES,
        validation: Object.freeze({
            dynamicNonFinite,
            staticMismatch,
            metricInvalid,
            forceInvalid,
            completedPassMask: passMask,
            requiredPassMask: REQUIRED_PASS_MASK,
            passed: validationPassed,
        }),
        completionEvidence: Object.freeze({
            completed: true,
            queueSubmissionObserved: true,
            gpuCopyMapped: true,
            validationPassed,
            frameIndex,
            sourceRevision,
            targetRevision,
            deviceGeneration,
        }),
        authority: SHADOW_AUTHORITY,
    });
}

/** Create a persistent shadow runtime; the caller remains the sole queue submitter. */
export async function createAdaptiveSphGpuRuntime({
    device: initialDevice,
    deviceGeneration = 0,
    maximumPackets = ADAPTIVE_SPH_GPU_MAX_PACKETS,
    maximumPairs = ADAPTIVE_SPH_GPU_MAX_PAIRS,
    initialPacketCapacity = 1,
    initialPairCapacity = 0,
    readbackSlots = 3,
    logger = null,
} = {}) {
    let device = validateDevice(initialDevice);
    let generation = safeInteger(deviceGeneration, '$.deviceGeneration', 0, UINT32_MAXIMUM);
    const slotCount = safeInteger(readbackSlots, '$.readbackSlots', 2, 16);
    const requestedCapacity = {
        maximumPackets,
        maximumPairs,
        initialPacketCapacity,
        initialPairCapacity,
    };
    let capacity = admitAdaptiveSphGpuRuntimeCapacity({ device, ...requestedCapacity });
    const constants = webGpuConstants();
    logAdaptiveFluid(logger, 'debug', 'adaptive-sph-gpu-runtime-compile-start', {
        deviceGeneration: generation,
        physicalAuthorityGranted: false,
    });
    let pipelines = await compileRuntimePipelines(device);
    let bundleSerial = 1;
    let activeBundle = createBundle(
        device,
        pipelines,
        constants.usage,
        capacity.initialPacketCapacity,
        capacity.initialPairCapacity,
        bundleSerial,
    );
    let readbacks = createReadbackSlots(device, constants.usage, slotCount);
    let retiredBundles = [];
    let lifecycleEpoch = 0;
    let destroyed = false;
    let lost = false;
    let lossInfo = null;
    let awaitingSubmission = null;
    let lastEncodedFrame = -1;
    let lastCompletedFrame = -1;
    let encodedFrames = 0;
    let completedFrames = 0;
    let failedFrames = 0;
    let canceledFrames = 0;
    let allocationCount = 1;
    let growthCount = 0;
    let lastReceipt = null;
    const activeRecords = new Set();

    function assertAlive() {
        if (destroyed) throw new Error('Adaptive SPH GPU runtime is destroyed');
        if (lost) throw new Error('Adaptive SPH GPU runtime device is lost');
    }

    function releaseRetiredBundles() {
        const retained = [];
        for (const bundle of retiredBundles) {
            if (bundle.references === 0) destroyBundle(bundle);
            else retained.push(bundle);
        }
        retiredBundles = retained;
    }

    function releaseRecord(record) {
        if (record.released) return;
        record.released = true;
        record.bundle.references = Math.max(0, record.bundle.references - 1);
        record.slot.state = 'free';
        record.slot.token = null;
        activeRecords.delete(record);
        releaseRetiredBundles();
    }

    function invalidateEncodedRecord(reason) {
        const record = awaitingSubmission;
        if (!record) return;
        awaitingSubmission = null;
        record.status = 'invalidated';
        record.invalidatedReason = reason;
        canceledFrames += 1;
        releaseRecord(record);
    }

    function watchDeviceLoss(watchedDevice, watchedGeneration, watchedEpoch) {
        const lostPromise = watchedDevice?.lost;
        if (!lostPromise || typeof lostPromise.then !== 'function') return;
        void lostPromise.then(info => {
            if (destroyed || watchedDevice !== device
                || watchedGeneration !== generation || watchedEpoch !== lifecycleEpoch) return;
            lost = true;
            lossInfo = Object.freeze({
                reason: String(info?.reason ?? 'unknown'),
                message: String(info?.message ?? ''),
                deviceGeneration: generation,
            });
            lifecycleEpoch += 1;
            invalidateEncodedRecord('device-lost-before-submission');
            for (const record of activeRecords) record.invalidatedReason = 'device-lost';
            logAdaptiveFluid(logger, 'error', 'adaptive-sph-gpu-runtime-device-lost', lossInfo);
        }).catch(error => {
            if (destroyed || watchedDevice !== device || watchedGeneration !== generation) return;
            lost = true;
            lossInfo = Object.freeze({
                reason: 'loss-promise-rejected',
                message: String(error?.message ?? error),
                deviceGeneration: generation,
            });
            lifecycleEpoch += 1;
            invalidateEncodedRecord('device-loss-observer-failed');
        });
    }

    watchDeviceLoss(device, generation, lifecycleEpoch);

    function state() {
        const pendingReadbacks = readbacks.filter(slot => slot.state !== 'free').length;
        return Object.freeze({
            schema: ADAPTIVE_SPH_GPU_RUNTIME_SCHEMA,
            schemaVersion: ADAPTIVE_SPH_GPU_RUNTIME_VERSION,
            destroyed,
            lost,
            lossInfo,
            deviceGeneration: generation,
            lifecycleEpoch,
            packetCapacity: activeBundle?.packetCapacity ?? 0,
            pairCapacity: activeBundle?.pairCapacity ?? 0,
            maximumPackets: capacity.maximumPackets,
            maximumPairs: capacity.maximumPairs,
            allocationCount,
            growthCount,
            retiredBundles: retiredBundles.length,
            encodedFrames,
            completedFrames,
            failedFrames,
            canceledFrames,
            lastEncodedFrame,
            lastCompletedFrame,
            awaitingSubmission: awaitingSubmission !== null,
            pendingReadbacks,
            readbackSlots: slotCount,
            readbackBytes: slotCount * ADAPTIVE_SPH_GPU_RUNTIME_RECEIPT_BYTES,
            lastReceipt,
            authority: SHADOW_AUTHORITY,
        });
    }

    function ensureCapacity(packetCount, pairCount) {
        if (packetCount <= activeBundle.packetCapacity && pairCount <= activeBundle.pairCapacity) {
            return false;
        }
        if (awaitingSubmission) {
            throw new Error('Adaptive SPH GPU runtime cannot grow before the encoded frame is submitted');
        }
        const packetCapacity = nextCapacity(
            activeBundle.packetCapacity,
            packetCount,
            capacity.maximumPackets,
        );
        const pairCapacity = pairCount === 0 ? activeBundle.pairCapacity : nextCapacity(
            activeBundle.pairCapacity,
            pairCount,
            capacity.maximumPairs,
        );
        if (packetCapacity < packetCount || pairCapacity < pairCount) {
            throw new RangeError('Adaptive SPH GPU runtime plan exceeds admitted device capacity');
        }
        const next = createBundle(
            device,
            pipelines,
            constants.usage,
            packetCapacity,
            pairCapacity,
            ++bundleSerial,
        );
        const previous = activeBundle;
        previous.retired = true;
        activeBundle = next;
        retiredBundles.push(previous);
        allocationCount += 1;
        growthCount += 1;
        releaseRetiredBundles();
        logAdaptiveFluid(logger, 'debug', 'adaptive-sph-gpu-runtime-grown', {
            packetCapacity,
            pairCapacity,
            physicalAuthorityGranted: false,
        });
        return true;
    }

    function prepare(plan) {
        assertAlive();
        const validated = validatePlan(plan, capacity);
        const grown = ensureCapacity(validated.packetCount, validated.pairCount);
        return Object.freeze({
            packetCount: validated.packetCount,
            pairCount: validated.pairCount,
            packetCapacity: activeBundle.packetCapacity,
            pairCapacity: activeBundle.pairCapacity,
            grown,
            deviceGeneration: generation,
            authority: SHADOW_AUTHORITY,
        });
    }

    function encode(encoder, plan, {
        frameIndex,
        sourceRevision = plan?.sourceRevision,
        targetRevision = sourceRevision,
    } = {}) {
        assertAlive();
        if (!encoder || typeof encoder.beginComputePass !== 'function'
            || typeof encoder.clearBuffer !== 'function'
            || typeof encoder.copyBufferToBuffer !== 'function') {
            throw new TypeError('$.encoder: caller-owned GPUCommandEncoder is required');
        }
        if (awaitingSubmission) {
            throw new Error('Adaptive SPH GPU runtime already has an encoded frame awaiting submission');
        }
        const frame = safeInteger(frameIndex, '$.frameIndex', 0, UINT32_MAXIMUM);
        if (frame <= lastEncodedFrame) {
            throw new RangeError('$.frameIndex: runtime frames must be strictly monotonic');
        }
        const validated = validatePlan(plan, capacity);
        const source = safeInteger(sourceRevision, '$.sourceRevision', 0, UINT32_MAXIMUM);
        const target = safeInteger(targetRevision, '$.targetRevision', source,
            Math.min(UINT32_MAXIMUM, source + 1));
        if (source !== validated.sourceRevision) {
            throw new RangeError('$.sourceRevision: differs from the opaque GPU plan');
        }
        ensureCapacity(validated.packetCount, validated.pairCount);
        const slot = readbacks.find(candidate => candidate.state === 'free');
        if (!slot) throw new Error('Adaptive SPH GPU runtime receipt ring is full');
        const bundle = activeBundle;
        const epoch = lifecycleEpoch;
        device.queue.writeBuffer(bundle.carrierInput, 0, validated.carrierBytes);
        device.queue.writeBuffer(bundle.pairInput, 0, validated.pairBytes);
        device.queue.writeBuffer(bundle.offsetsInput, 0, validated.adjacencyOffsets);
        device.queue.writeBuffer(bundle.adjacencyInput, 0, validated.adjacencyPairs);
        device.queue.writeBuffer(bundle.parameterInput, 0, validated.parameterBytes);
        const header = new Uint32Array([
            validated.packetCount,
            validated.pairCount,
            frame,
            generation,
            source,
            target,
            validated.pairCount === 0 ? 2 : 0,
            0,
        ]);
        device.queue.writeBuffer(bundle.receipt, 16, header);
        encoder.clearBuffer(bundle.receipt, 0, 16);
        const packetWorkgroups = Math.ceil(validated.packetCount / WORKGROUP_SIZE);
        const pairWorkgroups = Math.ceil(validated.pairCount / WORKGROUP_SIZE);
        encodePass(encoder, 'AdaptiveSphGPU.Runtime.Density',
            pipelines.density, bundle.densityGroup, packetWorkgroups);
        if (pairWorkgroups > 0) {
            encodePass(encoder, 'AdaptiveSphGPU.Runtime.PairForce',
                pipelines.pairForce, bundle.forceGroup, pairWorkgroups);
        }
        encodePass(encoder, 'AdaptiveSphGPU.Runtime.Gather',
            pipelines.gather, bundle.gatherGroup, packetWorkgroups);
        encodePass(encoder, 'AdaptiveSphGPU.Runtime.ValidateCarriers',
            pipelines.validateCarriers, bundle.validateCarrierGroup, packetWorkgroups);
        if (pairWorkgroups > 0) {
            encodePass(encoder, 'AdaptiveSphGPU.Runtime.ValidatePairs',
                pipelines.validatePairs, bundle.validatePairGroup, pairWorkgroups);
        }
        encoder.copyBufferToBuffer(
            bundle.receipt,
            0,
            slot.buffer,
            0,
            ADAPTIVE_SPH_GPU_RUNTIME_RECEIPT_BYTES,
        );
        const token = Object.freeze({
            schema: ADAPTIVE_SPH_GPU_RUNTIME_TOKEN_SCHEMA,
            schemaVersion: '1.0.0',
            frameIndex: frame,
            sourceRevision: source,
            targetRevision: target,
            deviceGeneration: generation,
            packetCount: validated.packetCount,
            pairCount: validated.pairCount,
            receiptByteLength: ADAPTIVE_SPH_GPU_RUNTIME_RECEIPT_BYTES,
            authority: SHADOW_AUTHORITY,
        });
        const record = {
            token,
            status: 'encoded',
            epoch,
            bundle,
            slot,
            frameIndex: frame,
            sourceRevision: source,
            targetRevision: target,
            deviceGeneration: generation,
            packetCount: validated.packetCount,
            pairCount: validated.pairCount,
            released: false,
            invalidatedReason: null,
        };
        TOKENS.set(token, record);
        activeRecords.add(record);
        bundle.references += 1;
        slot.state = 'encoded';
        slot.token = token;
        awaitingSubmission = record;
        lastEncodedFrame = frame;
        encodedFrames += 1;
        return token;
    }

    function cancel(token) {
        const record = TOKENS.get(token);
        if (!record || !activeRecords.has(record) || record.status !== 'encoded') {
            throw new TypeError('$.token: live encoded Adaptive SPH runtime token is required');
        }
        if (awaitingSubmission === record) awaitingSubmission = null;
        record.status = 'canceled';
        record.invalidatedReason = 'caller-canceled-before-submission';
        canceledFrames += 1;
        releaseRecord(record);
        return state();
    }

    async function afterSubmit(token) {
        const record = TOKENS.get(token);
        if (!record || !activeRecords.has(record) || record.status !== 'encoded') {
            throw new TypeError('$.token: live unsubmitted Adaptive SPH runtime token is required');
        }
        if (destroyed || lost || record.epoch !== lifecycleEpoch
            || record.deviceGeneration !== generation) {
            if (awaitingSubmission === record) awaitingSubmission = null;
            record.status = 'invalidated';
            releaseRecord(record);
            throw new Error('Adaptive SPH GPU runtime token belongs to a stale device generation');
        }
        if (awaitingSubmission === record) awaitingSubmission = null;
        record.status = 'submitted';
        record.slot.state = 'mapping';
        try {
            await record.slot.buffer.mapAsync(
                constants.mapRead,
                0,
                ADAPTIVE_SPH_GPU_RUNTIME_RECEIPT_BYTES,
            );
            if (destroyed || lost || record.epoch !== lifecycleEpoch
                || record.invalidatedReason) {
                throw new Error('Adaptive SPH GPU runtime completion became stale');
            }
            const bytes = new Uint8Array(record.slot.buffer.getMappedRange(
                0,
                ADAPTIVE_SPH_GPU_RUNTIME_RECEIPT_BYTES,
            )).slice().buffer;
            record.slot.buffer.unmap();
            const receipt = parseReceipt(bytes, record);
            if (!receipt.validation.passed) {
                throw new Error('Adaptive SPH GPU runtime validation receipt rejected the output');
            }
            record.status = 'complete';
            completedFrames += 1;
            lastCompletedFrame = record.frameIndex;
            lastReceipt = receipt;
            logAdaptiveFluid(logger, 'debug', 'adaptive-sph-gpu-runtime-frame-complete', {
                frameIndex: receipt.frameIndex,
                packetCount: receipt.packetCount,
                pairCount: receipt.pairCount,
                receiptByteLength: receipt.receiptByteLength,
                physicalAuthorityGranted: false,
            });
            return receipt;
        } catch (error) {
            record.status = 'failed';
            failedFrames += 1;
            try {
                if (record.slot.buffer.mapState === 'mapped') record.slot.buffer.unmap();
            } catch (_unmapError) { /* preserve original failure */ }
            logAdaptiveFluid(logger, 'error', 'adaptive-sph-gpu-runtime-frame-failed', {
                frameIndex: record.frameIndex,
                message: String(error?.message ?? error),
                physicalAuthorityGranted: false,
            });
            throw error;
        } finally {
            releaseRecord(record);
        }
    }

    function getShadowStateRange() {
        assertAlive();
        return Object.freeze({
            format: 'mixed-fluid-physical-v1/carrier-shadow',
            buffer: activeBundle.carrierOutput,
            count: lastReceipt?.packetCount ?? 0,
            capacity: activeBundle.packetCapacity,
            strideBytes: CARRIER_BYTES,
            deviceGeneration: generation,
            frameIndex: lastCompletedFrame,
            authority: SHADOW_AUTHORITY,
        });
    }

    async function recreateDevice(nextDeviceInput, nextGeneration) {
        if (destroyed) throw new Error('Adaptive SPH GPU runtime is destroyed');
        if (awaitingSubmission || readbacks.some(slot => slot.state === 'mapping')) {
            throw new Error('Adaptive SPH GPU runtime cannot recreate with in-flight work');
        }
        const nextGenerationValue = safeInteger(
            nextGeneration,
            '$.nextDeviceGeneration',
            generation + 1,
            UINT32_MAXIMUM,
        );
        const nextDevice = validateDevice(nextDeviceInput);
        const nextBaseCapacity = admitAdaptiveSphGpuRuntimeCapacity({
            device: nextDevice,
            ...requestedCapacity,
            initialPacketCapacity: 1,
            initialPairCapacity: 0,
        });
        const nextCapacityAdmission = admitAdaptiveSphGpuRuntimeCapacity({
            device: nextDevice,
            ...requestedCapacity,
            initialPacketCapacity: Math.min(activeBundle.packetCapacity,
                nextBaseCapacity.maximumPackets),
            initialPairCapacity: Math.min(activeBundle.pairCapacity,
                nextBaseCapacity.maximumPairs),
        });
        const nextPipelines = await compileRuntimePipelines(nextDevice);
        const nextBundle = createBundle(
            nextDevice,
            nextPipelines,
            constants.usage,
            nextCapacityAdmission.initialPacketCapacity,
            nextCapacityAdmission.initialPairCapacity,
            ++bundleSerial,
        );
        let nextReadbacks;
        try {
            nextReadbacks = createReadbackSlots(nextDevice, constants.usage, slotCount);
        } catch (error) {
            destroyBundle(nextBundle);
            throw error;
        }
        lifecycleEpoch += 1;
        for (const record of activeRecords) record.invalidatedReason = 'device-recreated';
        destroyBundle(activeBundle);
        for (const bundle of retiredBundles) destroyBundle(bundle);
        for (const slot of readbacks) destroyBuffer(slot.buffer);
        retiredBundles = [];
        device = nextDevice;
        generation = nextGenerationValue;
        capacity = nextCapacityAdmission;
        pipelines = nextPipelines;
        activeBundle = nextBundle;
        readbacks = nextReadbacks;
        lost = false;
        lossInfo = null;
        lastReceipt = null;
        lastEncodedFrame = -1;
        lastCompletedFrame = -1;
        allocationCount += 1;
        watchDeviceLoss(device, generation, lifecycleEpoch);
        logAdaptiveFluid(logger, 'info', 'adaptive-sph-gpu-runtime-device-recreated', {
            deviceGeneration: generation,
            physicalAuthorityGranted: false,
        });
        return state();
    }

    function destroy() {
        if (destroyed) return state();
        destroyed = true;
        lifecycleEpoch += 1;
        invalidateEncodedRecord('runtime-destroyed');
        for (const record of activeRecords) record.invalidatedReason = 'runtime-destroyed';
        destroyBundle(activeBundle);
        for (const bundle of retiredBundles) destroyBundle(bundle);
        retiredBundles = [];
        for (const slot of readbacks) destroyBuffer(slot.buffer);
        logAdaptiveFluid(logger, 'debug', 'adaptive-sph-gpu-runtime-destroyed', {
            encodedFrames,
            completedFrames,
            failedFrames,
            physicalAuthorityGranted: false,
        });
        return state();
    }

    logAdaptiveFluid(logger, 'debug', 'adaptive-sph-gpu-runtime-ready', {
        deviceGeneration: generation,
        packetCapacity: activeBundle.packetCapacity,
        pairCapacity: activeBundle.pairCapacity,
        receiptBytes: slotCount * ADAPTIVE_SPH_GPU_RUNTIME_RECEIPT_BYTES,
        physicalAuthorityGranted: false,
    });

    return Object.freeze({
        prepare,
        encode,
        afterSubmit,
        cancel,
        getShadowStateRange,
        recreateDevice,
        state,
        destroy,
    });
}

export default createAdaptiveSphGpuRuntime;
