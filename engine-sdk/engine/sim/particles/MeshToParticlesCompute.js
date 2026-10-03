// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { createStorageBuffer, createUniformBuffer, updateBuffer } from "../../core/gpu/GpuBuffer.js";
import { labelResource } from "../../core/gpu/GpuDebug.js";
import { BindGroupSignals } from "../../core/gpu/BindingSignals.js";
import { getGPUMemoryManager } from "../../core/memory/GPUMemoryManager.js";
import {
  LEGACY_MESH_PARTICLE_SEED_WGSL,
  LEGACY_PCG32_WGSL,
  MESH_TO_PARTICLES_RUNTIME_PCG_WGSL,
  legacyGoldenRatioChunkSeed32,
} from "../../core/math/MathBits.js";
import { packParticleMeta, getShapeId, getRenderModeId, getBehaviorId } from "./ParticleSchema.js";

// Reusable buffers for hot paths (reduce/reuse/recycle)
const _meshToParticleCounterU32 = new Uint32Array(1);

const stateByDevice = new WeakMap();
const SHADER_VERSION = 15;  // v15: Mesh particle seed and PCG wrappers come from named shared MathBits WGSL.

function createShaderCode(workgroupSize) {
  const wg = Math.max(1, Math.min(256, workgroupSize | 0));
  return /* wgsl */ `

${LEGACY_PCG32_WGSL}
${MESH_TO_PARTICLES_RUNTIME_PCG_WGSL}


${LEGACY_MESH_PARTICLE_SEED_WGSL}

struct Params {
  // === Row 0: Vertex layout ===
  vertexStride: u32,
  posOffset: u32,
  normOffset: u32,
  colOffset: u32,

  // === Row 1: Triangle/particle counts ===
  triCount: u32,
  startIndex: u32,
  maxParticles: u32,
  seed: u32,

  // === Row 2: Per-triangle limits ===
  minPerTri: u32,
  maxPerTri: u32,
  triOffset: u32,
  attachmentsEnabled: u32,

  // === Row 3: Particle properties ===
  density: f32,
  size: f32,
  lifetime: f32,
  velJitter: f32,

  // === Row 4: Base velocity ===
  baseVel: vec3<f32>,
  depthOffset: f32,  // Max depth offset into surface (was hardcoded 0.3)

  // === Row 5: Color tint (RGB) ===
  colorTint: vec3<f32>,
  packedMetaW: f32,

  // === Row 6: UV and variation ===
  uvOffset: u32,
  sizeVariation: f32,
  opacityMin: f32,
  opacityMax: f32,

  // === Row 7: Flags and step ===
  uvSeparateEnabled: u32,
  triStep: u32,
  colorMode: u32,     // 0=vertex, 1=tint only, 2=tint*vertex, 3=texture
  normalMode: u32,    // 0=vertex normals, 1=face normals, 2=invert

  // === Row 8: Material properties (PBR-ready) ===
  emission: f32,      // Emissive intensity multiplier
  roughness: f32,     // Surface roughness [0-1]
  metallic: f32,      // Metallic factor [0-1]
  subsurface: f32,    // Subsurface scattering strength

  // === Row 9: Animation/FX ===
  sizeOverLife: f32,  // Size multiplier at end of life (1.0 = no change)
  opacityOverLife: f32, // Opacity multiplier at end of life
  rotationSpeed: f32, // Rotation speed (radians/sec)
  stretchFactor: f32, // Velocity stretch multiplier

  // === Row 10: Physics (Cinema 4D inspired) ===
  mass: f32,          // Particle mass for physics
  temperature: f32,   // Temperature value (fire/ice effects)
  fuel: f32,          // Combustion fuel amount
  fluidDensity: f32,  // Density for fluid simulations

  // === Row 11: Scale/Rotation (Cinema 4D inspired) ===
  scaleXYZ: vec3<f32>, // Non-uniform scale (1,1,1 = uniform)
  spinSpeed: f32,      // Angular velocity magnitude

  // === Row 12: Spin axis and group ===
  spinAxis: vec3<f32>, // Rotation axis (normalized)
  groupId: u32,        // Particle group ID for filtering

  // === Row 13: Color variation ===
  colorVariation: f32,  // Random hue/saturation variation
  brightnessMin: f32,   // Min brightness multiplier
  brightnessMax: f32,   // Max brightness multiplier
  saturationMult: f32,  // Saturation multiplier

  // === Row 14: Reserved for future ===
  reserved0: f32,
  reserved1: f32,
  reserved2: f32,
  reserved3: f32,
}

struct Attachment {
  triIndex: u32,
  b: f32,
  c: f32,
  flags: u32,
}

@group(0) @binding(0) var<storage, read> vertexData : array<f32>;
@group(0) @binding(1) var<storage, read> indexData : array<u32>;
@group(0) @binding(2) var<storage, read_write> outPositions : array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> outVelocities : array<vec4<f32>>;
@group(0) @binding(4) var<storage, read_write> outMeta : array<vec4<f32>>;
@group(0) @binding(5) var<storage, read_write> outCounter : atomic<u32>;
@group(0) @binding(6) var<uniform> params : Params;
@group(0) @binding(7) var<storage, read_write> outAttachments : array<Attachment>;
@group(0) @binding(8) var<storage, read_write> outUVs : array<vec4<f32>>;
@group(0) @binding(9) var<storage, read> uvIn : array<f32>;

fn readVec3(vidx: u32, offset: u32) -> vec3<f32> {
  let base = vidx * params.vertexStride + offset;
  return vec3<f32>(
    vertexData[base + 0u],
    vertexData[base + 1u],
    vertexData[base + 2u],
  );
}

fn readVec4(vidx: u32, offset: u32) -> vec4<f32> {
  let base = vidx * params.vertexStride + offset;
  return vec4<f32>(
    vertexData[base + 0u],
    vertexData[base + 1u],
    vertexData[base + 2u],
    vertexData[base + 3u],
  );
}

fn readVec2(vidx: u32, offset: u32) -> vec2<f32> {
  if (params.uvSeparateEnabled != 0u) {
    let base = vidx * 2u;
    return vec2<f32>(
      uvIn[base + 0u],
      uvIn[base + 1u],
    );
  }
  let base = vidx * params.vertexStride + offset;
  return vec2<f32>(
    vertexData[base + 0u],
    vertexData[base + 1u],
  );
}

@compute @workgroup_size(${wg})
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let triId = gid.x;
  if (triId >= params.triCount) {
    return;
  }

  let triIndex = params.triOffset + triId * params.triStep;

  let base = triIndex * 3u;

  let i0 = indexData[base + 0u];
  let i1 = indexData[base + 1u];
  let i2 = indexData[base + 2u];

  let p0 = readVec3(i0, params.posOffset);
  let p1 = readVec3(i1, params.posOffset);
  let p2 = readVec3(i2, params.posOffset);

  let e1 = p1 - p0;
  let e2 = p2 - p0;
  let area = 0.5 * length(cross(e1, e2));

  var desired = u32(area * params.density);
  if (desired < params.minPerTri) { desired = params.minPerTri; }
  if (desired > params.maxPerTri) { desired = params.maxPerTri; }

  if (desired == 0u) {
    return;
  }

  let hasNormals = params.normOffset != 4294967295u;
  let hasColor = params.colOffset != 4294967295u;
  let hasUV = (params.uvOffset != 4294967295u) || (params.uvSeparateEnabled != 0u);

  // Normal mode: 0=vertex normals, 1=face normals, 2=invert
  let faceN = normalize(cross(e1, e2));
  var n0 = vec3<f32>(0.0);
  var n1 = vec3<f32>(0.0);
  var n2 = vec3<f32>(0.0);
  if (hasNormals && params.normalMode == 0u) {
    n0 = readVec3(i0, params.normOffset);
    n1 = readVec3(i1, params.normOffset);
    n2 = readVec3(i2, params.normOffset);
  } else {
    n0 = faceN;
    n1 = faceN;
    n2 = faceN;
  }
  // Invert normals if requested
  if (params.normalMode == 2u) {
    n0 = -n0;
    n1 = -n1;
    n2 = -n2;
  }

  // Color mode: 0=vertex, 1=tint only, 2=tint*vertex, 3=texture (handled elsewhere)
  var c0 = vec4<f32>(params.colorTint, 1.0);
  var c1 = vec4<f32>(params.colorTint, 1.0);
  var c2 = vec4<f32>(params.colorTint, 1.0);
  if (hasColor && params.colorMode != 1u) {
    let vc0 = readVec4(i0, params.colOffset);
    let vc1 = readVec4(i1, params.colOffset);
    let vc2 = readVec4(i2, params.colOffset);
    if (params.colorMode == 0u) {
      // Vertex color only
      c0 = vc0;
      c1 = vc1;
      c2 = vc2;
    } else if (params.colorMode == 2u) {
      // Tint * vertex
      c0 = vec4<f32>(params.colorTint * vc0.rgb, vc0.a);
      c1 = vec4<f32>(params.colorTint * vc1.rgb, vc1.a);
      c2 = vec4<f32>(params.colorTint * vc2.rgb, vc2.a);
    }
  }

  var uv0 = vec2<f32>(0.0);
  var uv1 = vec2<f32>(0.0);
  var uv2 = vec2<f32>(0.0);
  if (hasUV) {
    uv0 = readVec2(i0, params.uvOffset);
    uv1 = readVec2(i1, params.uvOffset);
    uv2 = readVec2(i2, params.uvOffset);
  }

  for (var k: u32 = 0u; k < desired; k = k + 1u) {
    var seed = legacyMeshParticleSeed32(params.seed, triIndex, k);
    let u = randomFloat(&seed);
    let v = randomFloat(&seed);
    let su = sqrt(u);
    let a = 1.0 - su;
    let b = v * su;
    let c = 1.0 - a - b;

    let surfacePos = p0 * a + p1 * b + p2 * c;
    let normal = normalize(n0 * a + n1 * b + n2 * c);
    let col = c0 * a + c1 * b + c2 * c;
    let uv = uv0 * a + uv1 * b + uv2 * c;

    // Add volumetric depth offset (inward from surface)
    let depthFactor = randomFloat(&seed); // 0 to 1
    let depthOffsetAmount = depthFactor * params.depthOffset;
    let pos = surfacePos - normal * depthOffsetAmount;

    // Per-particle size variation (Gaussian splat-like)
    let sizeRand = randomFloat(&seed);
    let sizeVar = 1.0 + (sizeRand * 2.0 - 1.0) * params.sizeVariation;

    // Per-particle opacity variation based on depth and random
    let opacityRand = randomFloat(&seed);
    let baseOpacity = mix(params.opacityMin, params.opacityMax, opacityRand);
    // Particles deeper inside are more opaque (core density)
    let depthOpacityBoost = 1.0 + depthFactor * 0.3;
    let finalOpacity = clamp(baseOpacity * depthOpacityBoost, 0.1, 1.0);

    let idx = atomicAdd(&outCounter, 1u);
    if (idx >= params.maxParticles) {
      return;
    }

    let jitterDir = vec3<f32>(
      randomFloat(&seed) * 2.0 - 1.0,
      randomFloat(&seed) * 2.0 - 1.0,
      randomFloat(&seed) * 2.0 - 1.0
    );

    let vel = params.baseVel + normalize(jitterDir) * (params.velJitter * randomFloat(&seed));

    let age0 = select(0.0, params.lifetime * 0.06, params.attachmentsEnabled != 0u);
    outPositions[idx] = vec4<f32>(pos, age0);
    outVelocities[idx] = vec4<f32>(vel, params.lifetime);
    // Pack size variation into the packed meta value.
    // Keep renderMode/shape digits stable by quantizing size to an integer.
    let baseSize = floor(params.packedMetaW / 10000.0);
    let remainder = params.packedMetaW - baseSize * 10000.0;
    let variedSize = max(1.0, floor(baseSize * sizeVar + 0.5));
    let variedPackedMeta = variedSize * 10000.0 + remainder;

    // Store original color WITHOUT premultiplication - texture sampling will use this directly
    // For texture mode (renderMode 4), we pass through vertex color as-is for texture modulation
    outMeta[idx] = vec4<f32>(col.rgb, variedPackedMeta);
    outUVs[idx] = vec4<f32>(uv, finalOpacity, 0.0);

    if (params.attachmentsEnabled != 0u) {
      outAttachments[idx].triIndex = triIndex;
      outAttachments[idx].b = b;
      outAttachments[idx].c = c;
      outAttachments[idx].flags = 1u;
    }

    _ = normal;
  }
}
`;
}

async function getOrCreateState(device, options = {}) {
  let entry = stateByDevice.get(device);
  if (entry && entry.version === SHADER_VERSION) {
    return entry;
  }

  const trace = options && typeof options.trace === "function" ? options.trace : null;
  const tPipeline0 = trace ? performance.now() : 0;

  const workgroupSize = typeof options.workgroupSize === "number" && options.workgroupSize > 0 ? options.workgroupSize | 0 : 64;
  const shaderCode = createShaderCode(workgroupSize);

  const shaderModule = device.createShaderModule({
    label: "MeshToParticlesCompute.shader",
    code: shaderCode,
  });

  const pipelineDescriptor = {
    label: "MeshToParticlesCompute.pipeline",
    layout: "auto",
    compute: { module: shaderModule, entryPoint: "main" },
  };

  let pipeline;
  const gpuDevice = options.gpuDevice;
  if (gpuDevice && typeof gpuDevice.getPipelineCache === 'function') {
    const cache = gpuDevice.getPipelineCache();
    if (cache) {
      pipeline = await cache.getOrCreateComputePipeline(pipelineDescriptor, "MeshToParticlesCompute");
    } else {
      pipeline = await device.createComputePipelineAsync(pipelineDescriptor);
    }
  } else {
    pipeline = await device.createComputePipelineAsync(pipelineDescriptor);
  }

  if (trace) {
    trace("mesh2p:pipeline", performance.now() - tPipeline0, workgroupSize | 0);
  }

  const paramsBuffer = createUniformBuffer(device, 240, { label: "MeshToParticlesCompute.params" });
  const counterBuffer = createStorageBuffer(device, 4, { label: "MeshToParticlesCompute.counter" });
  const dummyAttachmentBuffer = createStorageBuffer(device, 16, { label: "MeshToParticlesCompute.dummyAttachment" });
  const dummyUvBuffer = createStorageBuffer(device, 16, { label: "MeshToParticlesCompute.dummyUvs" });
  const dummyUvInBuffer = createStorageBuffer(device, 16, { label: "MeshToParticlesCompute.dummyUvIn" });

  labelResource(paramsBuffer, "MeshToParticlesCompute.params");
  labelResource(counterBuffer, "MeshToParticlesCompute.counter");
  labelResource(dummyAttachmentBuffer, "MeshToParticlesCompute.dummyAttachment");
  labelResource(dummyUvBuffer, "MeshToParticlesCompute.dummyUvs");
  labelResource(dummyUvInBuffer, "MeshToParticlesCompute.dummyUvIn");

  const gpu = getGPUMemoryManager(device);
  const externalGetBindGroup = gpu && gpu.bindGroupCache && typeof gpu.getBindGroup === "function" ? gpu.getBindGroup.bind(gpu) : null;

  entry = {
    version: SHADER_VERSION,
    pipeline,
    paramsBuffer,
    counterBuffer,
    dummyAttachmentBuffer,
    dummyUvBuffer,
    dummyUvInBuffer,
    bindGroups: new BindGroupSignals(
      device,
      pipeline.getBindGroupLayout(0),
      [
        { name: "vertexData", binding: 0 },
        { name: "indexData", binding: 1 },
        { name: "outPositions", binding: 2 },
        { name: "outVelocities", binding: 3 },
        { name: "outMeta", binding: 4 },
        { name: "outCounter", binding: 5 },
        { name: "params", binding: 6 },
        { name: "outAttachments", binding: 7 },
        { name: "outUVs", binding: 8 },
        { name: "uvIn", binding: 9 },
      ],
      { label: "MeshToParticlesCompute.bindGroup", maxEntries: 256, getBindGroup: externalGetBindGroup }
    ),
    workgroupSize,
  };

  stateByDevice.set(device, entry);
  return entry;
}

export function createMeshParticleBuffers(device, mesh) {
  if (!device) throw new Error("createMeshParticleBuffers: device required");
  if (!mesh || !mesh.vertexData) throw new Error("createMeshParticleBuffers: mesh.vertexData required");

  const vertexArray =
    mesh.vertexData instanceof Float32Array
      ? mesh.vertexData
      : new Float32Array(mesh.vertexData.buffer, mesh.vertexData.byteOffset, mesh.vertexData.byteLength / 4);

  const vertexBuffer = createStorageBuffer(device, vertexArray, {
    label: mesh.label ? `${mesh.label}.vertexStorage` : "MeshToParticles.vertexStorage",
  });

  const indexSrc = mesh.indexData;
  if (!indexSrc) throw new Error("createMeshParticleBuffers: mesh.indexData required");

  let indexU32 = null;
  if (indexSrc instanceof Uint32Array) {
    indexU32 = indexSrc;
  } else if (indexSrc instanceof Uint16Array) {
    indexU32 = new Uint32Array(indexSrc.length);
    for (let i = 0; i < indexSrc.length; i++) indexU32[i] = indexSrc[i];
  } else {
    throw new Error("createMeshParticleBuffers: indexData must be Uint16Array or Uint32Array");
  }

  const indexBuffer = createStorageBuffer(device, indexU32, {
    label: mesh.label ? `${mesh.label}.indexStorage` : "MeshToParticles.indexStorage",
  });

  let uvBuffer = null;
  const uvSrc = mesh.uvData;
  if (uvSrc) {
    const uvArray =
      uvSrc instanceof Float32Array
        ? uvSrc
        : new Float32Array(uvSrc.buffer, uvSrc.byteOffset, uvSrc.byteLength / 4);
    uvBuffer = createStorageBuffer(device, uvArray, {
      label: mesh.label ? `${mesh.label}.uvStorage` : "MeshToParticles.uvStorage",
    });
    labelResource(uvBuffer, "MeshToParticles.uvStorage");
  }

  labelResource(vertexBuffer, "MeshToParticles.vertexStorage");
  labelResource(indexBuffer, "MeshToParticles.indexStorage");

  const triCount = Math.floor(indexU32.length / 3);

  return {
    vertexBuffer,
    indexBuffer,
    uvBuffer,
    triCount,
    vertexStrideFloats: (mesh.vertexStride / 4) | 0,
    attributes: Array.isArray(mesh.attributes) ? mesh.attributes.slice() : [],
  };
}

export function getAttrOffsetFloats(attributes, key) {
  if (!Array.isArray(attributes)) return null;

  if (typeof key === "string") {
    const byName = attributes.find((a) => a && typeof a.name === "string" && a.name === key);
    if (byName && Number.isFinite(byName.offset)) return (byName.offset / 4) | 0;
  }

  if (typeof key === "number") {
    const byLoc = attributes.find((a) => a && a.location === key);
    if (byLoc && Number.isFinite(byLoc.offset)) return (byLoc.offset / 4) | 0;
  }

  return null;
}

export async function generateMeshParticlesIntoWorld(gpuDevice, meshBuffers, particleWorld, options = {}) {
  if (!gpuDevice || typeof gpuDevice.getDevice !== "function") {
    throw new Error("generateMeshParticlesIntoWorld: gpuDevice required");
  }
  const device = gpuDevice.getDevice();
  if (!device) throw new Error("generateMeshParticlesIntoWorld: gpuDevice.getDevice() returned null");

  const trace = options && typeof options.trace === "function" ? options.trace : null;

  if (!meshBuffers || !meshBuffers.vertexBuffer || !meshBuffers.indexBuffer) {
    throw new Error("generateMeshParticlesIntoWorld: meshBuffers with vertexBuffer/indexBuffer required");
  }
  if (!particleWorld || !particleWorld.positionBuffer || !particleWorld.velocityBuffer || !particleWorld.metaBuffer) {
    throw new Error("generateMeshParticlesIntoWorld: particleWorld buffers required");
  }

  const tState0 = trace ? performance.now() : 0;
  const state = await getOrCreateState(device, { ...options, gpuDevice });
  if (trace) trace("mesh2p:state", performance.now() - tState0, 0);

  const triCountRaw = typeof meshBuffers.triCount === "number" ? meshBuffers.triCount | 0 : 0;
  const triCount = triCountRaw;
  if (triCount <= 0) {
    return { emitted: 0 };
  }

  const attrs = meshBuffers.attributes || [];
  const stride = typeof meshBuffers.vertexStrideFloats === "number" ? meshBuffers.vertexStrideFloats | 0 : 0;
  if (stride <= 0) throw new Error("generateMeshParticlesIntoWorld: invalid vertex stride");

  const posOff = getAttrOffsetFloats(attrs, "position") ?? getAttrOffsetFloats(attrs, 0);
  const normOff = getAttrOffsetFloats(attrs, "normal") ?? getAttrOffsetFloats(attrs, 1);
  const colOff = getAttrOffsetFloats(attrs, "color") ?? getAttrOffsetFloats(attrs, 2);
  const uvInBuffer = meshBuffers.uvBuffer || null;
  const uvSeparateEnabled = uvInBuffer ? 1 : 0;
  const uvOff = uvSeparateEnabled
    ? null
    : (
      getAttrOffsetFloats(attrs, "uv") ??
      getAttrOffsetFloats(attrs, "uv0") ??
      getAttrOffsetFloats(attrs, "texcoord") ??
      getAttrOffsetFloats(attrs, "TEXCOORD_0") ??
      null
    );

  if (posOff === null) throw new Error("generateMeshParticlesIntoWorld: position attribute offset not found");

  const maxParticles = typeof options.maxParticles === "number" && options.maxParticles > 0
    ? options.maxParticles | 0
    : (particleWorld.maxParticles || 0);

  const triOffset = typeof options.triOffset === "number" && options.triOffset >= 0
    ? options.triOffset | 0
    : 0;

  const triStep = typeof options.triStep === "number" && options.triStep > 0
    ? options.triStep | 0
    : 1;

  const maxTriCount = Math.max(0, triCountRaw - triOffset);
  const triCountStrided = triStep <= 1 ? maxTriCount : Math.ceil(maxTriCount / triStep);
  const triCountClamped = Math.min(triCount, triCountStrided);
  if (triCountClamped <= 0) {
    return { emitted: 0 };
  }

  const startIndex = typeof options.startIndex === "number" && options.startIndex >= 0
    ? options.startIndex | 0
    : 0;

  const minPerTri = typeof options.minPerTri === "number" && options.minPerTri >= 0 ? options.minPerTri | 0 : 1;
  const maxPerTri = typeof options.maxPerTri === "number" && options.maxPerTri > 0 ? options.maxPerTri | 0 : 4;

  const density = typeof options.density === "number" && Number.isFinite(options.density) ? options.density : 10.0;
  const size = typeof options.size === "number" && Number.isFinite(options.size) ? options.size : 4.0;
  const lifetime = typeof options.lifetime === "number" && Number.isFinite(options.lifetime) ? options.lifetime : 5.0;
  const velJitter = typeof options.velJitter === "number" && Number.isFinite(options.velJitter) ? options.velJitter : 0.5;
  const baseVel = Array.isArray(options.baseVel) && options.baseVel.length >= 3 ? options.baseVel : [0, 2, 0];
  const color = Array.isArray(options.color) && options.color.length >= 3 ? options.color : [1, 1, 1];

  // Use schema functions for consistent shape/renderMode/behavior encoding
  const renderMode = typeof options.renderMode === "number" && Number.isFinite(options.renderMode)
    ? (options.renderMode | 0)
    : (typeof options.renderMode === "string" ? getRenderModeId(options.renderMode) : 0);
  const shape = typeof options.shape === "number" && Number.isFinite(options.shape)
    ? (options.shape | 0)
    : (typeof options.shape === "string" ? getShapeId(options.shape) : 0);
  const behavior = typeof options.behavior === "number" && Number.isFinite(options.behavior)
    ? (options.behavior | 0)
    : (typeof options.behavior === "string" ? getBehaviorId(options.behavior) : 0);
  const packMass = typeof options.mass === "number" && Number.isFinite(options.mass) ? options.mass : 1.0;
  const packDrag = typeof options.drag === "number" && Number.isFinite(options.drag) ? options.drag : 0.02;

  const packedMetaW = typeof options.packedMetaW === "number" && Number.isFinite(options.packedMetaW)
    ? options.packedMetaW
    : packParticleMeta(size, renderMode, shape, behavior, packMass, packDrag);

  const seed = typeof options.seed === "number" && Number.isFinite(options.seed) ? options.seed >>> 0 : 12345;

  // Extended params buffer: 15 rows × 4 floats = 60 floats = 240 bytes
  const paramsData = new Uint32Array(60);
  const paramsF32 = new Float32Array(paramsData.buffer);

  // === Row 0: Vertex layout ===
  paramsData[0] = stride >>> 0;
  paramsData[1] = posOff >>> 0;
  paramsData[2] = normOff === null ? 0xFFFFFFFF : (normOff >>> 0);
  paramsData[3] = colOff === null ? 0xFFFFFFFF : (colOff >>> 0);

  // === Row 1: Triangle/particle counts ===
  paramsData[4] = triCountClamped >>> 0;
  paramsData[5] = startIndex >>> 0;
  paramsData[6] = maxParticles >>> 0;
  paramsData[7] = seed >>> 0;

  // === Row 2: Per-triangle limits ===
  paramsData[8] = minPerTri >>> 0;
  paramsData[9] = maxPerTri >>> 0;
  paramsData[10] = triOffset >>> 0;
  paramsData[11] = options && options.attachmentBuffer ? 1 : 0;

  // === Row 3: Particle properties ===
  paramsF32[12] = density;
  paramsF32[13] = size;
  paramsF32[14] = lifetime;
  paramsF32[15] = velJitter;

  // === Row 4: Base velocity + depth offset ===
  paramsF32[16] = Number(baseVel[0]) || 0;
  paramsF32[17] = Number(baseVel[1]) || 0;
  paramsF32[18] = Number(baseVel[2]) || 0;
  const depthOffset = typeof options.depthOffset === "number" && Number.isFinite(options.depthOffset)
    ? options.depthOffset : 0.3;
  paramsF32[19] = depthOffset;

  // === Row 5: Color tint (RGB) ===
  const colorTint = Array.isArray(options.colorTint) && options.colorTint.length >= 3
    ? options.colorTint : color;  // Fall back to legacy color param
  paramsF32[20] = Number(colorTint[0]) || 1;
  paramsF32[21] = Number(colorTint[1]) || 1;
  paramsF32[22] = Number(colorTint[2]) || 1;
  paramsF32[23] = packedMetaW;

  // === Row 6: UV and variation ===
  paramsData[24] = uvOff === null ? 0xFFFFFFFF : (uvOff >>> 0);
  const sizeVariation = typeof options.sizeVariation === "number" && Number.isFinite(options.sizeVariation)
    ? options.sizeVariation : 0.3;
  const opacityMin = typeof options.opacityMin === "number" && Number.isFinite(options.opacityMin)
    ? options.opacityMin : 0.4;
  const opacityMax = typeof options.opacityMax === "number" && Number.isFinite(options.opacityMax)
    ? options.opacityMax : 0.95;
  paramsF32[25] = sizeVariation;
  paramsF32[26] = opacityMin;
  paramsF32[27] = opacityMax;

  // === Row 7: Flags and modes ===
  paramsData[28] = uvSeparateEnabled >>> 0;
  paramsData[29] = (triStep >>> 0);
  const colorMode = typeof options.colorMode === "number" ? (options.colorMode >>> 0) : 0;
  const normalMode = typeof options.normalMode === "number" ? (options.normalMode >>> 0) : 0;
  paramsData[30] = colorMode;  // 0=vertex, 1=tint only, 2=tint*vertex, 3=texture
  paramsData[31] = normalMode; // 0=vertex normals, 1=face normals, 2=invert

  // === Row 8: Material properties (PBR-ready) ===
  const emission = typeof options.emission === "number" && Number.isFinite(options.emission)
    ? options.emission : 0.0;
  const roughness = typeof options.roughness === "number" && Number.isFinite(options.roughness)
    ? options.roughness : 0.5;
  const metallic = typeof options.metallic === "number" && Number.isFinite(options.metallic)
    ? options.metallic : 0.0;
  const subsurface = typeof options.subsurface === "number" && Number.isFinite(options.subsurface)
    ? options.subsurface : 0.0;
  paramsF32[32] = emission;
  paramsF32[33] = roughness;
  paramsF32[34] = metallic;
  paramsF32[35] = subsurface;

  // === Row 9: Animation/FX ===
  const sizeOverLife = typeof options.sizeOverLife === "number" && Number.isFinite(options.sizeOverLife)
    ? options.sizeOverLife : 1.0;
  const opacityOverLife = typeof options.opacityOverLife === "number" && Number.isFinite(options.opacityOverLife)
    ? options.opacityOverLife : 1.0;
  const rotationSpeed = typeof options.rotationSpeed === "number" && Number.isFinite(options.rotationSpeed)
    ? options.rotationSpeed : 0.0;
  const stretchFactor = typeof options.stretchFactor === "number" && Number.isFinite(options.stretchFactor)
    ? options.stretchFactor : 0.0;
  paramsF32[36] = sizeOverLife;
  paramsF32[37] = opacityOverLife;
  paramsF32[38] = rotationSpeed;
  paramsF32[39] = stretchFactor;

  // === Row 10: Physics (Cinema 4D inspired) ===
  const mass = typeof options.mass === "number" && Number.isFinite(options.mass)
    ? options.mass : 1.0;
  const temperature = typeof options.temperature === "number" && Number.isFinite(options.temperature)
    ? options.temperature : 0.0;
  const fuel = typeof options.fuel === "number" && Number.isFinite(options.fuel)
    ? options.fuel : 0.0;
  const fluidDensity = typeof options.fluidDensity === "number" && Number.isFinite(options.fluidDensity)
    ? options.fluidDensity : 1.0;
  paramsF32[40] = mass;
  paramsF32[41] = temperature;
  paramsF32[42] = fuel;
  paramsF32[43] = fluidDensity;

  // === Row 11: Scale/Rotation (Cinema 4D inspired) ===
  const scaleXYZ = Array.isArray(options.scaleXYZ) && options.scaleXYZ.length >= 3
    ? options.scaleXYZ : [1, 1, 1];
  const spinSpeed = typeof options.spinSpeed === "number" && Number.isFinite(options.spinSpeed)
    ? options.spinSpeed : 0.0;
  paramsF32[44] = Number(scaleXYZ[0]) || 1;
  paramsF32[45] = Number(scaleXYZ[1]) || 1;
  paramsF32[46] = Number(scaleXYZ[2]) || 1;
  paramsF32[47] = spinSpeed;

  // === Row 12: Spin axis and group ===
  const spinAxis = Array.isArray(options.spinAxis) && options.spinAxis.length >= 3
    ? options.spinAxis : [0, 1, 0];  // Default: Y-up
  const groupId = typeof options.groupId === "number" ? (options.groupId >>> 0) : 0;
  paramsF32[48] = Number(spinAxis[0]) || 0;
  paramsF32[49] = Number(spinAxis[1]) || 1;
  paramsF32[50] = Number(spinAxis[2]) || 0;
  paramsData[51] = groupId;

  // === Row 13: Color variation ===
  const colorVariation = typeof options.colorVariation === "number" && Number.isFinite(options.colorVariation)
    ? options.colorVariation : 0.0;
  const brightnessMin = typeof options.brightnessMin === "number" && Number.isFinite(options.brightnessMin)
    ? options.brightnessMin : 1.0;
  const brightnessMax = typeof options.brightnessMax === "number" && Number.isFinite(options.brightnessMax)
    ? options.brightnessMax : 1.0;
  const saturationMult = typeof options.saturationMult === "number" && Number.isFinite(options.saturationMult)
    ? options.saturationMult : 1.0;
  paramsF32[52] = colorVariation;
  paramsF32[53] = brightnessMin;
  paramsF32[54] = brightnessMax;
  paramsF32[55] = saturationMult;

  // === Row 14: Reserved for future ===
  paramsF32[56] = 0;
  paramsF32[57] = 0;
  paramsF32[58] = 0;
  paramsF32[59] = 0;

  updateBuffer(device, state.paramsBuffer, paramsData, 0);
  _meshToParticleCounterU32[0] = startIndex >>> 0;
  updateBuffer(device, state.counterBuffer, _meshToParticleCounterU32, 0);

  const attachmentBuffer = options && options.attachmentBuffer ? options.attachmentBuffer : state.dummyAttachmentBuffer;
  const uvBuffer = particleWorld && particleWorld.uvBuffer ? particleWorld.uvBuffer : state.dummyUvBuffer;
  const uvInResolved = uvInBuffer ? uvInBuffer : state.dummyUvInBuffer;

  const bindGroup = state.bindGroups.get({
    vertexData: meshBuffers.vertexBuffer,
    indexData: meshBuffers.indexBuffer,
    outPositions: particleWorld.positionBuffer,
    outVelocities: particleWorld.velocityBuffer,
    outMeta: particleWorld.metaBuffer,
    outCounter: state.counterBuffer,
    params: state.paramsBuffer,
    outAttachments: attachmentBuffer,
    outUVs: uvBuffer,
    uvIn: uvInResolved,
  }, "MeshToParticlesCompute.bindGroup");

  const encoder = device.createCommandEncoder({
    label: "MeshToParticlesCompute.encode",
  });

  const pass = encoder.beginComputePass({
    label: "MeshToParticlesCompute.pass",
  });
  pass.setPipeline(state.pipeline);
  pass.setBindGroup(0, bindGroup);

  const workgroups = Math.ceil(triCountClamped / state.workgroupSize);
  pass.dispatchWorkgroups(workgroups);
  pass.end();

  const wantsReadback = options.readback === true;
  let readBuffer = null;
  if (wantsReadback) {
    readBuffer = device.createBuffer({
      label: "MeshToParticlesCompute.counterReadback",
      size: 4,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    encoder.copyBufferToBuffer(state.counterBuffer, 0, readBuffer, 0, 4);
  }

  const tSubmit0 = trace ? performance.now() : 0;
  device.queue.submit([encoder.finish()]);
  if (trace) trace("mesh2p:submit", performance.now() - tSubmit0, workgroups);

  if (!wantsReadback) {
    return { emitted: null };
  }

  const deferReadback = options && options.deferReadback === true;

  if (deferReadback) {
    const readbackPromise = (async () => {
      const tMap0 = trace ? performance.now() : 0;
      await readBuffer.mapAsync(GPUMapMode.READ);
      if (trace) trace("mesh2p:mapAsync", performance.now() - tMap0, 0);
      const outCountRaw = new Uint32Array(readBuffer.getMappedRange())[0] >>> 0;
      readBuffer.unmap();
      readBuffer.destroy();
      const outCount = Math.min(outCountRaw, maxParticles >>> 0) >>> 0;
      const emitted = outCount >= (startIndex >>> 0) ? (outCount - (startIndex >>> 0)) : 0;
      return { emitted, outCount };
    })();

    return { emitted: null, outCount: null, readbackPromise };
  }

  const tMap0 = trace ? performance.now() : 0;
  await readBuffer.mapAsync(GPUMapMode.READ);
  if (trace) trace("mesh2p:mapAsync", performance.now() - tMap0, 0);
  const outCountRaw = new Uint32Array(readBuffer.getMappedRange())[0] >>> 0;
  readBuffer.unmap();
  readBuffer.destroy();

  const outCount = Math.min(outCountRaw, maxParticles >>> 0) >>> 0;
  const emitted = outCount >= (startIndex >>> 0) ? (outCount - (startIndex >>> 0)) : 0;
  return { emitted, outCount };
}

export async function generateMeshParticlesIntoParticlesState(particles, meshBuffers, options = {}) {
  const chunks = particles && Array.isArray(particles.chunks) ? particles.chunks : null;
  const deferReadback = options && options.deferReadback === true;

  if (chunks && chunks.length > 0) {
    const seedBase = typeof options.seed === "number" && Number.isFinite(options.seed)
      ? (options.seed >>> 0)
      : 12345;
    const startIndexRaw = typeof options.startIndex === "number" && options.startIndex >= 0
      ? options.startIndex | 0
      : (particles.instanceCount | 0);
    let remainingStart = Math.max(0, startIndexRaw | 0);

    if (deferReadback) {
      const chunkPromises = [];

      for (let ci = 0; ci < chunks.length; ci++) {
        const chunk = chunks[ci];
        const world = chunk && chunk.world;
        if (!world || !world.gpuDevice) {
          chunkPromises.push(null);
          continue;
        }

        const cap = world.maxParticles | 0;
        const chunkStartIndex = remainingStart >= cap ? cap : remainingStart;
        remainingStart = remainingStart >= cap ? (remainingStart - cap) : 0;

        const attachmentBuffer = (chunk && chunk.attachmentBuffer) || (options && options.attachmentBuffer) || (particles.attachmentBuffer || null);
        const chunkSeed = legacyGoldenRatioChunkSeed32(seedBase, ci);

        const resultPromise = generateMeshParticlesIntoWorld(world.gpuDevice, meshBuffers, world, {
          ...options,
          seed: chunkSeed,
          startIndex: chunkStartIndex,
          maxParticles: cap,
          readback: true,
          deferReadback: true,
          attachmentBuffer,
        });

        chunkPromises.push({ chunk, resultPromise, cap });
      }

      const readbackPromise = (async () => {
        let totalOutCount = 0;
        let totalEmitted = 0;

        for (const item of chunkPromises) {
          if (!item) continue;
          const r = await item.resultPromise;

          if (r && r.readbackPromise) {
            const readback = await r.readbackPromise;
            if (readback && typeof readback.outCount === "number") {
              item.chunk.instanceCount = Math.min(readback.outCount | 0, item.cap);
              totalOutCount += item.chunk.instanceCount;
            }
            if (readback && typeof readback.emitted === "number") {
              totalEmitted += readback.emitted | 0;
            }
          }
        }

        particles.instanceCount = totalOutCount | 0;
        return { emitted: totalEmitted | 0, outCount: totalOutCount | 0 };
      })();

      return { emitted: null, outCount: null, readbackPromise };
    }

    let totalOutCount = 0;
    let totalEmitted = 0;
    const chunkResults = [];

    for (let ci = 0; ci < chunks.length; ci++) {
      const chunk = chunks[ci];
      const world = chunk && chunk.world;
      if (!world || !world.gpuDevice) {
        chunkResults.push(null);
        continue;
      }

      const cap = world.maxParticles | 0;
      const chunkStartIndex = remainingStart >= cap ? cap : remainingStart;
      remainingStart = remainingStart >= cap ? (remainingStart - cap) : 0;

      const attachmentBuffer = (chunk && chunk.attachmentBuffer) || (options && options.attachmentBuffer) || (particles.attachmentBuffer || null);

      const chunkSeed = legacyGoldenRatioChunkSeed32(seedBase, ci);

      const r = await generateMeshParticlesIntoWorld(world.gpuDevice, meshBuffers, world, {
        ...options,
        seed: chunkSeed,
        startIndex: chunkStartIndex,
        maxParticles: cap,
        readback: true,
        attachmentBuffer,
      });

      if (r && typeof r.outCount === "number") {
        chunk.instanceCount = Math.min(r.outCount | 0, cap);
      } else {
        chunk.instanceCount = Math.max(0, Math.min(chunk.instanceCount | 0, cap));
      }

      totalOutCount += chunk.instanceCount | 0;
      if (r && typeof r.emitted === "number") {
        totalEmitted += r.emitted | 0;
      }

      chunkResults.push(r);
    }

    particles.instanceCount = totalOutCount | 0;
    return { emitted: totalEmitted | 0, outCount: totalOutCount | 0, chunkResults };
  }

  if (!particles || !particles.world) {
    throw new Error("generateMeshParticlesIntoParticlesState: particles.world is required");
  }

  const particleWorld = particles.world;
  const gpuDevice = particleWorld.gpuDevice;
  if (!gpuDevice) {
    throw new Error("generateMeshParticlesIntoParticlesState: particles.world.gpuDevice is required");
  }

  const startIndex = typeof options.startIndex === "number" && options.startIndex >= 0
    ? options.startIndex | 0
    : (particles.instanceCount | 0);

  const lifetime = typeof options.lifetime === "number" && Number.isFinite(options.lifetime)
    ? options.lifetime
    : 5.0;

  const result = await generateMeshParticlesIntoWorld(gpuDevice, meshBuffers, particleWorld, {
    ...options,
    startIndex,
    maxParticles: particleWorld.maxParticles,
    readback: true,
    attachmentBuffer: options && options.attachmentBuffer ? options.attachmentBuffer : (particles.attachmentBuffer || null),
  });

  if (result && typeof result.outCount === "number") {
    const maxCount = typeof particles.maxCount === "number" && particles.maxCount > 0
      ? particles.maxCount | 0
      : particleWorld.maxParticles | 0;
    particles.instanceCount = Math.min(result.outCount | 0, maxCount);
  }

  const updateSlotInfo = options.updateSlotInfo !== false;
  if (updateSlotInfo && particles.slotInfo && result && typeof result.emitted === "number" && result.emitted > 0) {
    const slotInfo = particles.slotInfo;
    const now = typeof options.currentTime === "number" && Number.isFinite(options.currentTime)
      ? options.currentTime
      : performance.now() * 0.001;

    const begin = Math.max(0, startIndex | 0);
    const end = Math.min((begin + (result.emitted | 0)) | 0, (slotInfo.length / 2) | 0);
    for (let i = begin; i < end; i++) {
      slotInfo[i * 2] = now;
      slotInfo[i * 2 + 1] = lifetime;
    }
  }

  return result;
}

export default {
  createMeshParticleBuffers,
  generateMeshParticlesIntoWorld,
  generateMeshParticlesIntoParticlesState,
};
