// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import {
  WAVEFRONT_MAX_TRACE_STEPS,
  WAVEFRONT_RECORD_BYTES,
  WAVEFRONT_SHADER_SOURCES,
  createWavefrontPathTracer,
  packMaterialExtensions,
  queueByteSize,
} from "./index.js";
import { acquireGpuDeviceForConsumer } from "../../../../core/gpu/GpuDeviceOwnership.js";

const GRAZING_INVERSE_VIEW_PROJECTION = Object.freeze([
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, -6, 0,
  0, 0.999, 3, 1,
]);

function assert(condition, message) {
  if (!condition) throw new Error(`MorphField wavefront self-test failed: ${message}`);
}

class MockBuffer {
  constructor(descriptor) {
    this.label = descriptor.label;
    this.size = descriptor.size;
    this.usage = descriptor.usage;
    this.data = new ArrayBuffer(descriptor.size);
    this.destroyCount = 0;
    this.mapped = false;
  }

  destroy() {
    this.destroyCount += 1;
  }

  async mapAsync() {
    this.mapped = true;
  }

  getMappedRange(offset = 0, size = this.size - offset) {
    if (!this.mapped) throw new Error("Mock buffer is not mapped");
    return this.data.slice(offset, offset + size);
  }

  unmap() {
    this.mapped = false;
  }
}

class MockComputePass {
  constructor(owner, descriptor) {
    this.owner = owner;
    this.label = descriptor?.label || "";
  }

  setPipeline(pipeline) {
    assert(Boolean(pipeline), "compute pass receives a pipeline");
  }

  setBindGroup(index, group, offsets = []) {
    assert(index === 0 || index === 1, "only the declared bind groups are used");
    assert(Boolean(group), "compute pass receives a bind group");
    assert(Array.isArray(offsets), "dynamic offsets are supplied as an array");
  }

  dispatchWorkgroups(x, y, z) {
    assert(x >= 1 && y >= 1 && z === 1, "dispatch dimensions stay bounded and non-zero");
    this.owner.dispatches.push({ x, y, z, label: this.label });
  }

  end() {
    this.owner.endedPasses += 1;
  }
}

class MockEncoder {
  constructor() {
    this.passes = [];
    this.dispatches = [];
    this.endedPasses = 0;
    this.finishCount = 0;
    this.copies = 0;
  }

  beginComputePass(descriptor) {
    const pass = new MockComputePass(this, descriptor);
    this.passes.push(pass);
    return pass;
  }

  clearBuffer(buffer, offset = 0, size = buffer.size - offset) {
    new Uint8Array(buffer.data, offset, size).fill(0);
  }

  copyBufferToBuffer(source, sourceOffset, destination, destinationOffset, size) {
    new Uint8Array(destination.data, destinationOffset, size).set(
      new Uint8Array(source.data, sourceOffset, size),
    );
    this.copies += 1;
  }

  finish() {
    this.finishCount += 1;
    return {};
  }
}

class MockDevice {
  constructor() {
    this.createdBuffers = [];
    this.destroyCount = 0;
    this.errorScopes = 0;
    this.limits = {
      maxStorageBufferBindingSize: 128 * 1024 * 1024,
      maxBufferSize: 256 * 1024 * 1024,
      maxComputeWorkgroupsPerDimension: 65535,
      minUniformBufferOffsetAlignment: 256,
    };
    this.queue = {
      submitCount: 0,
      writeBuffer: (buffer, offset, source) => {
        const bytes = source instanceof ArrayBuffer
          ? new Uint8Array(source)
          : new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
        new Uint8Array(buffer.data, offset, bytes.byteLength).set(bytes);
      },
      submit: () => { this.queue.submitCount += 1; },
    };
  }

  createBuffer(descriptor) {
    const buffer = new MockBuffer(descriptor);
    this.createdBuffers.push(buffer);
    return buffer;
  }

  createShaderModule(descriptor) {
    assert(typeof descriptor.code === "string" && descriptor.code.length > 100, "shader module contains WGSL");
    return { descriptor, getCompilationInfo: async () => ({ messages: [] }) };
  }

  createBindGroupLayout(descriptor) { return { descriptor }; }
  createPipelineLayout(descriptor) { return { descriptor }; }
  createBindGroup(descriptor) { return { descriptor }; }
  createComputePipeline(descriptor) { return { descriptor }; }
  pushErrorScope() { this.errorScopes += 1; }
  async popErrorScope() { this.errorScopes -= 1; return null; }
  destroy() { this.destroyCount += 1; }
}

function externalBuffer(byteLength, label) {
  return new MockBuffer({ size: Math.max(16, byteLength), usage: 0x80, label });
}

function identityMatrix() {
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
}

function grazingUnitSphereMarch(stepLimit) {
  const intervalEntry = 2;
  const intervalExit = 4;
  const hitEpsilon = 0.0005;
  const lateral = 0.999;
  let travel = intervalEntry;
  for (let stepIndex = 0; stepIndex < WAVEFRONT_MAX_TRACE_STEPS; stepIndex += 1) {
    if (stepIndex >= stepLimit) {
      return Object.freeze({ status: "exhausted", stepIndex, travel });
    }
    const distance = Math.hypot(lateral, 3 - travel) - 1;
    if (Math.abs(distance) <= hitEpsilon) {
      return Object.freeze({ status: "hit", stepIndex, travel, distance });
    }
    const safeStep = Math.abs(distance);
    travel += Math.min(safeStep, (intervalExit - intervalEntry) * 0.125);
  }
  return Object.freeze({ status: "exhausted", stepIndex: WAVEFRONT_MAX_TRACE_STEPS, travel });
}

async function runMockProbe() {
  const passed = [];
  const device = new MockDevice();
  const tracer = await createWavefrontPathTracer({
    device,
    queueCapacity: 128,
    memoryBudgetBytes: 8 * 1024 * 1024,
  });
  passed.push("five capability-safe f32 compute pipelines created");

  const external = {
    fieldletHeaders: externalBuffer(16, "external.headers"),
    payloads: externalBuffer(64, "external.payloads"),
    resolvedCertificates: externalBuffer(64, "external.certificates"),
    materials: externalBuffer(32, "external.materials"),
    programWords: externalBuffer(8, "external.program"),
    analyticParameters: externalBuffer(64, "external.parameters"),
    bounds: externalBuffer(32, "external.bounds"),
  };
  tracer.setSceneBuffers({ buffers: external, fieldletCount: 1, materialCount: 1, revision: 7 });
  const resized = tracer.resize(32, 16);
  assert(resized.tileCount === 4 && resized.queueCapacity === 128, "queue capacity produces deterministic tiles");
  passed.push("bounded queues tile work beyond their fixed capacity");

  const encoder = new MockEncoder();
  const encoded = tracer.encode({
    encoder,
    camera: { inverseViewProjection: identityMatrix(), position: [0, 0, 2] },
    lights: {
      directional: { directionToLight: [0.4, 0.8, 0.3], color: [1, 1, 1], intensity: 2 },
      environmentZenith: [0.3, 0.5, 0.8],
      environmentHorizon: [0.1, 0.12, 0.16],
    },
    maxBounces: 2,
    captureStats: true,
  });
  assert(encoded.submitted === false, "encode explicitly reports that it did not submit");
  assert(encoded.passCount === 32, "four tiles encode generate, two three-pass bounces, and finalize");
  assert(encoder.passes.length === encoded.passCount && encoder.endedPasses === encoded.passCount, "every compute pass is ended");
  assert(Object.isFrozen(encoded.passLabels)
      && encoded.passLabels.length === encoded.passCount
      && encoded.passLabels.every((label, index) => label === encoder.passes[index].label),
    "encoded pass telemetry is immutable and preserves exact external-encoder order");
  assert(encoder.copies === 4, "optional stats capture copies four bounded queue headers");
  assert(encoder.finishCount === 0 && device.queue.submitCount === 0, "tracer never finishes or submits the host encoder");
  const initialGpuStats = await tracer.resolveStats(encoded.statsTicket);
  assert(Object.values(initialGpuStats.gpuQueues).every((queue) => queue.capacity === 128),
    "all queue headers retain their allocated capacity after frame counter resets");
  passed.push("external encoder ownership and optional asynchronous stats contract preserved");

  const output = tracer.getOutput();
  assert(output.width === 32 && output.height === 16 && output.sampleCount === 1, "progressive accumulation output is described exactly");
  const allocatedBufferCount = device.createdBuffers.length;
  const reduced = tracer.resize(16, 8);
  const restored = tracer.resize(32, 16);
  assert(reduced.reused === true && restored.reused === true
      && device.createdBuffers.length === allocatedBufferCount,
    "wavefront resolution changes within reserved capacity do not rebuild GPU queues");
  tracer.reset("self-test");
  assert(tracer.getOutput().sampleCount === 0, "reset invalidates progressive sample count");
  const resetEncoder = new MockEncoder();
  tracer.encode({
    encoder: resetEncoder,
    camera: { inverseViewProjection: identityMatrix(), position: [0, 0, 2] },
    lights: {},
    maxBounces: 1,
  });
  const resetQueueHeaders = [
    tracer._resources.rayA,
    tracer._resources.rayB,
    tracer._resources.hit,
    tracer._resources.shadow,
  ].map((buffer) => new Uint32Array(buffer.data, 0, 4));
  assert(resetQueueHeaders.every((header) => header[2] === 128),
    "encoded reset clears queue counters without clearing queue capacity");
  assert(resetEncoder.finishCount === 0 && device.queue.submitCount === 0,
    "reset encoding preserves host encoder and queue ownership");
  passed.push("queue capacities survive encoded history resets");
  const firstDestroy = tracer.destroy();
  const secondDestroy = tracer.destroy();
  assert(firstDestroy === true && secondDestroy === false, "destroy is idempotent");
  assert(Object.values(external).every((buffer) => buffer.destroyCount === 0), "borrowed scene buffers are never destroyed");
  assert(device.destroyCount === 0, "borrowed device is never destroyed");
  assert(device.createdBuffers.every((buffer) => buffer.destroyCount === 1), "every owned buffer is released exactly once");
  passed.push("owned resources released once while host resources remain untouched");
  return passed;
}

function shaderContractProbe() {
  const combined = Object.values(WAVEFRONT_SHADER_SOURCES).join("\n");
  const grazingMatrixDeterminant = GRAZING_INVERSE_VIEW_PROJECTION[0]
    * GRAZING_INVERSE_VIEW_PROJECTION[5]
    * GRAZING_INVERSE_VIEW_PROJECTION[10]
    * GRAZING_INVERSE_VIEW_PROJECTION[15];
  assert(GRAZING_INVERSE_VIEW_PROJECTION.every(Number.isFinite)
      && grazingMatrixDeterminant === -6,
    "the real-GPU grazing fixture uses a finite invertible inverse-view-projection matrix");
  assert(!combined.includes("enable f16"), "portable baseline does not enable shader-f16");
  assert(!combined.includes("dispatchWorkgroupsIndirect"), "portable baseline uses indirect-free dispatches");
  assert(!combined.includes("queue.submit"), "WGSL/source contains no submission path");
  assert(combined.includes("sampleGGXVNDF"), "GGX VNDF sampling is compiled into shading");
  assert(combined.includes("programDistance"), "checked postfix CSG evaluation is compiled into intersection");
  const certifiedAdmissionChecks = combined.match(/if \(!isCertifiedAnalyticSurface\(header, certificate\)\)/gu)?.length || 0;
  assert(combined.includes("fn isCertifiedAnalyticSurface(header: FieldletHeader, certificate: vec4<f32>) -> bool")
      && combined.includes("subtype == FIELDLET_SUBTYPE_ANALYTIC_PROGRAM")
      && combined.includes("family == FIELDLET_FAMILY_ANALYTIC")
      && combined.includes("(queryMask & FIELDLET_QUERY_SURFACE) != 0u")
      && combined.includes("(flags & FIELDLET_FLAG_CERTIFIED_SURFACE) != 0u")
      && combined.includes("header.certificateRef != INVALID_REF")
      && certifiedAdmissionChecks >= 2,
    "wavefront distance and interval traversal reject marker, medium, non-surface, and uncertified Fieldlets");
  assert(combined.includes("!finiteScalar(certificate.w)")
      && combined.includes("certificate.w < 0.0")
      && !combined.includes("if (family != 0u || (queryMask & 2u) == 0u)"),
    "wavefront surface certificates validate their complete record before traversal");
  assert(combined.includes("atomicAdd(&outputRays.overflow"), "bounded ray overflow is counted");
  assert(combined.includes("atomicAdd(&shadowQueue.overflow"), "bounded shadow overflow is counted");
  assert(combined.includes("refineBracket"), "uncertain certified intersections have bounded bisection");
  assert(combined.includes("max(abs(sample.distance) - sample.errorMaximum, 0.0)"),
    "wavefront traversal uses the strict certified safe-step formula");
  assert(!combined.includes("safeStep = max(safeStep, frame.trace.z)"),
    "wavefront traversal never forces an uncertified epsilon step");
  assert(!combined.includes("containingBoundExit"),
    "wavefront traversal cannot stall on a Fieldlet AABB boundary");
  assert(combined.indexOf("signTransition(previousDistance, sample.distance)")
      < combined.indexOf("let threshold = frame.trace.y + sample.errorMaximum"),
    "wavefront traversal refines sign transitions before threshold acceptance");
  assert(combined.includes("isolateUncertainCrossing") && combined.includes("fallbackMaximum")
      && !combined.includes("max(threshold, sample.fallbackMaximum)"),
    "wavefront uncertainty band triggers sign-bracket isolation instead of unconditional geometry");
  assert(combined.includes("certifiedCandidateFloor")
      && combined.includes("distanceToFieldletBound(point, header) - certificate.x"),
    "wavefront exact field programs are skipped only behind a certificate-adjusted AABB lower bound");
  assert(combined.includes("let primarySample = vec2<f32>(0.5)")
      && combined.includes("vec4<f32>(nearPoint, PRIMARY_RAY_MINIMUM_SENTINEL)")
      && combined.includes("world.xyz / max(abs(world.w), 1e-8) * sign(world.w)")
      && combined.includes("safeNormalize(farPoint - nearPoint"),
    "wavefront primary coverage matches center-sampled guides and supports orthographic cameras");
  assert(combined.includes("const TRACE_STATUS_CLEAR: u32 = 0u")
      && combined.includes("const TRACE_STATUS_HIT: u32 = 1u")
      && combined.includes("const TRACE_STATUS_EXHAUSTED: u32 = 2u")
      && combined.includes("const TRACE_STATUS_INVALID: u32 = 3u")
      && combined.includes("status: u32"),
    "wavefront traversal preserves clear, hit, exhausted, and invalid outcomes");
  assert(combined.includes(`select(frame.counts.w, ${WAVEFRONT_MAX_TRACE_STEPS}u, primaryRay)`),
    "certified primary visibility uses the full traversal ceiling at every quality tier");
  assert(combined.includes("if (occluder.status == TRACE_STATUS_CLEAR)")
      && combined.includes("if (traceStatus == TRACE_STATUS_CLEAR")
      && combined.includes("f32(result.status)")
      && combined.includes("u32(hit.offsetSource.z)")
      && !combined.includes("bitcast<f32>(result.status)")
      && !combined.includes("occluder.hit"),
    "exhausted or invalid primary and shadow traversals fail closed");
  assert(combined.includes("let chooseSun = sunAvailable;")
      && !combined.includes("randomFloat(state) < 0.5")
      && combined.includes("let skySampledByContinuation = frame.sunDirectionIntensity.w > 0.0")
      && combined.includes("path.throughputEta.w < 0.0 || skySampledByContinuation"),
    "delta-sun NEE remains present after every history reset while sky energy uses path continuation");
  assert(combined.includes("frame.trace.y + max(certificate.x * 2.0, certificate.z)")
      && combined.includes("offsetNormal * hit.offsetSource.x, 0.0")
      && !combined.includes("frame.trace.z * 8.0"),
    "secondary rays use certificate-aware offsets without a second minimum-distance advance");
  const emergencyGrazing = grazingUnitSphereMarch(40);
  const performanceGrazing = grazingUnitSphereMarch(64);
  const certifiedGrazing = grazingUnitSphereMarch(WAVEFRONT_MAX_TRACE_STEPS);
  assert(emergencyGrazing.status === "exhausted"
      && performanceGrazing.status === "hit"
      && performanceGrazing.stepIndex === 47
      && certifiedGrazing.status === "hit"
      && certifiedGrazing.stepIndex === 47,
    "the 47-step grazing fixture exhausts the 40-step emergency shadow budget and hits within the 64-step performance budget");
  assert(queueByteSize(4, 32) === 144, "queue ABI includes a sixteen-byte header");
  assert(WAVEFRONT_RECORD_BYTES.shadow === 48
      && queueByteSize(1, WAVEFRONT_RECORD_BYTES.shadow) === 64,
    "shadow queue ABI reserves its sixteen-byte header plus all three vec4 record fields");
  const extensions = packMaterialExtensions([{
    transmissionFactor: 0.75,
    ior: 1.45,
    clearcoatFactor: 0.5,
    clearcoatRoughness: 0.08,
  }]);
  assert(extensions.length === 4 && Math.abs(extensions[1] - 1.45) < 1e-5, "material extensions use four finite f32 values");
  return [
    "portable shader contract validated",
    "certified analytic surface admission fails closed",
    "analytic postfix/CSG and certified fallback present",
    "GGX VNDF and extended material lobes present",
  ];
}

function upload(device, label, typedArray) {
  const buffer = device.createBuffer({
    label,
    size: Math.max(16, (typedArray.byteLength + 3) & ~3),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });
  device.queue.writeBuffer(buffer, 0, typedArray);
  return buffer;
}

async function runRealWebGpuProbe(deviceInput = null) {
  let device = deviceInput;
  let deviceLease = null;
  if (!device) {
    if (!globalThis.navigator?.gpu) {
      const error = new Error("The real WebGPU wavefront gate requires navigator.gpu");
      error.code = "WEBGPU_DEVICE_UNAVAILABLE";
      throw error;
    }
    deviceLease = await acquireGpuDeviceForConsumer({
      ownerId: "morphfield-wavefront-self-test",
      ownership: "diagnostic-temporary",
      profile: "morphfield-wavefront",
      label: "MorphFieldWavefront.selfTest",
    });
    device = deviceLease.device;
  }
  let tracer;
  let readback;
  let sceneBuffers = {};
  let grazingPixel;
  let grazingHit;
  try {
    tracer = await createWavefrontPathTracer({ device, queueCapacity: 64, memoryBudgetBytes: 4 * 1024 * 1024 });
    const surfaceQueryMask = 1 << 1;
    const opaqueAndCertifiedSurfaceFlags = (1 << 2) | (1 << 4);
    const metadata = ((surfaceQueryMask << 16) | (opaqueAndCertifiedSurfaceFlags << 22)) >>> 0;
    sceneBuffers = {
      fieldletHeaders: upload(device, "test.headers", new Uint32Array([0, 0, metadata, 0])),
      payloads: upload(device, "test.payloads", new Float32Array([
        0, 0, 0, 1,
        1, 1, 1, 0,
        0, 0, 0, 1,
        0, 1, 0, surfaceQueryMask,
      ])),
      resolvedCertificates: upload(device, "test.certificates", new Float32Array([
        0, 1, 1e-6, 0,
        0, 0, 0, 0,
        0, 0, 0, 0,
        0, 1, 0, 0,
      ])),
      materials: upload(device, "test.materials", new Float32Array([
        0.8, 0.2, 0.1, 1,
        0.4, 0, 3, 1.5,
        4, 0, 0, 0,
      ])),
      programWords: upload(device, "test.program", new Uint32Array([1, 0])),
      analyticParameters: upload(device, "test.parameters", new Float32Array([
        0, 0, 0, 1,
        0, 0, 0, 1,
        1, 0, 0, 0,
        0, 0, 0, 0,
      ])),
      bounds: upload(device, "test.bounds", new Float32Array([-1, -1, -1, 0, 1, 1, 1, 0])),
    };
    tracer.setSceneBuffers({ buffers: sceneBuffers, fieldletCount: 1, materialCount: 1, revision: 1 });
    tracer.resize(1, 1);
    readback = device.createBuffer({
      label: "MorphField.Wavefront.GrazingTraversalReadback",
      size: 80,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    if (typeof device.pushErrorScope !== "function" || typeof device.popErrorScope !== "function") {
      throw new Error("The real WebGPU wavefront gate requires GPU device error scopes");
    }
    const scopeFilters = ["validation", "internal"];
    for (const filter of scopeFilters) device.pushErrorScope(filter);
    let encoder;
    let operationError = null;
    try {
      encoder = device.createCommandEncoder({ label: "MorphField.Wavefront.SelfTest" });
      tracer.encode({
        encoder,
        camera: {
          inverseViewProjection: GRAZING_INVERSE_VIEW_PROJECTION,
          position: [0, 0.999, 3],
        },
        lights: {
          directional: { directionToLight: [0, 1, 0], color: [0, 0, 0], intensity: 0 },
          environmentZenith: [0, 0, 0],
          environmentHorizon: [0, 0, 0],
          environmentIntensity: 0,
        },
        maxBounces: 1,
        maxTraceSteps: 40,
      });
      encoder.copyBufferToBuffer(tracer.getOutput().buffer, 0, readback, 0, 16);
      encoder.copyBufferToBuffer(tracer._resources.hit, 0, readback, 16, 64);
      device.queue.submit([encoder.finish()]);
      await device.queue.onSubmittedWorkDone();
    } catch (error) {
      operationError = error;
    }
    const scopedErrors = [];
    for (let index = scopeFilters.length - 1; index >= 0; index -= 1) {
      const filter = scopeFilters[index];
      try {
        const error = await device.popErrorScope();
        if (error) scopedErrors.push(`${filter}: ${error.message || String(error)}`);
      } catch (error) {
        scopedErrors.push(`${filter}-scope: ${error.message || String(error)}`);
      }
    }
    if (operationError || scopedErrors.length > 0) {
      const details = [
        operationError && `operation: ${operationError.message || String(operationError)}`,
        ...scopedErrors,
      ].filter(Boolean).join(" | ");
      throw new Error(`MorphField wavefront real GPU encode failed: ${details}`);
    }
    await readback.mapAsync(GPUMapMode.READ, 0, 80);
    const resultBytes = readback.getMappedRange(0, 80).slice(0);
    grazingPixel = new Float32Array(resultBytes.slice(0, 16));
    const hitFloats = new Float32Array(resultBytes, 16, 16);
    const hitWords = new Uint32Array(resultBytes, 16, 16);
    grazingHit = Object.freeze({
      count: hitWords[0],
      overflow: hitWords[1],
      capacity: hitWords[2],
      materialBits: hitWords[7],
      sourceBits: hitWords[13],
      status: Math.round(hitFloats[14]),
    });
    readback.unmap();
  } finally {
    try { readback?.unmap?.(); } catch { /* already unmapped */ }
    tracer?.destroy();
    Object.values(sceneBuffers).forEach((buffer) => buffer.destroy());
    readback?.destroy();
    deviceLease?.release();
  }
  const evidence = JSON.stringify({
    hit: grazingHit,
    pixel: Array.from(grazingPixel || []),
  });
  assert(grazingHit?.count === 1
      && grazingHit.overflow === 0
      && grazingHit.capacity === 1
      && grazingHit.status === 1
      && grazingHit.materialBits === 0
      && grazingHit.sourceBits === 0,
    `real GPU primary traversal did not report HIT for the 47-step grazing sphere: ${evidence}`);
  assert(grazingPixel.every(Number.isFinite)
      && grazingPixel[0] > 3.5
      && grazingPixel[1] === 0
      && grazingPixel[2] === 0
      && grazingPixel[3] === 1,
    `real GPU grazing HIT did not survive emissive shading and finalization: ${evidence}`);
  return [
    "real WebGPU HIT status and emissive accumulation preserve the 47-step grazing primary",
  ];
}

export async function runWavefrontSelfTest({ realWebGpu = false, device = null } = {}) {
  const passed = [
    ...shaderContractProbe(),
    ...await runMockProbe(),
  ];
  if (realWebGpu) {
    try {
      passed.push(...await runRealWebGpuProbe(device));
    } catch (error) {
      error.portablePassed = Object.freeze(passed.slice());
      throw error;
    }
  }
  return Object.freeze({ passed: Object.freeze(passed), count: passed.length });
}
