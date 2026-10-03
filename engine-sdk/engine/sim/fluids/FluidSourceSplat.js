// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import {
  createUniformBuffer,
  createStorageBuffer,
  updateBuffer,
  destroyBuffers,
} from "../../core/gpu/GpuBuffer.js";
import { labelResource } from "../../core/gpu/GpuDebug.js";
import { BindGroupSignals, generateWGSLBindGroupDeclarations } from "../../core/gpu/BindingSignals.js";
import { getGPUMemoryManager } from "../../core/memory/GPUMemoryManager.js";

// Reusable buffers for hot paths (reduce/reuse/recycle)
const _splatParamsF32 = new Float32Array(12);
let _splatSourceCapacity = 16;
let _splatSourceData = new Float32Array(_splatSourceCapacity * 8);

function ensureSplatSourceCapacity(count) {
  if (count <= _splatSourceCapacity) return;
  while (_splatSourceCapacity < count) _splatSourceCapacity *= 2;
  _splatSourceData = new Float32Array(_splatSourceCapacity * 8);
}

function normalizeWorkgroupSize(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return fallback;
  }
  const i = n | 0;
  if (i <= 0) {
    return fallback;
  }
  return i;
}

function createSplatShader(workgroupSize) {
  // Use smaller workgroup size to reduce GPU load and avoid TDR
  const size = normalizeWorkgroupSize(workgroupSize, 32);
  return `
struct FluidSource {
  position_radius : vec4<f32>, // xyz = position, w = radius
  strength_pad    : vec4<f32>, // x = strength
};

struct Params {
  gridSize  : vec3<f32>,
  sourceCount : u32,
  worldMin : vec3<f32>,
  _pad0    : u32,
  worldMax : vec3<f32>,
  _pad1    : u32,
};

@group(0) @binding(0) var<storage, read_write> uDensity : array<f32>;
@group(0) @binding(1) var<storage, read> uSources : array<FluidSource>;
@group(0) @binding(2) var<uniform> uParams : Params;

@compute @workgroup_size(${size})
fn main(@builtin(global_invocation_id) global_id : vec3<u32>) {
  let idx = global_id.x;

  let gx = u32(uParams.gridSize.x);
  let gy = u32(uParams.gridSize.y);
  let gz = u32(uParams.gridSize.z);
  let cellCount = gx * gy * gz;

  if (idx >= cellCount) {
    return;
  }

  // Decode 3D cell index
  let layerSize = gx * gy;
  let z = idx / layerSize;
  let rem = idx - z * layerSize;
  let y = rem / gx;
  let x = rem - y * gx;

  let fx = f32(x) + 0.5;
  let fy = f32(y) + 0.5;
  let fz = f32(z) + 0.5;

  let gxf = max(uParams.gridSize.x, 1.0);
  let gyf = max(uParams.gridSize.y, 1.0);
  let ggf = max(uParams.gridSize.z, 1.0);

  let tx = fx / gxf;
  let ty = fy / gyf;
  let tz = fz / ggf;

  // Map normalized grid coords to world position
  let worldPos = mix(uParams.worldMin, uParams.worldMax, vec3<f32>(tx, ty, tz));

  let count = uParams.sourceCount;
  if (count == 0u) {
    return;
  }
  
  // Clamp source count to prevent out-of-bounds access
  let maxSources = 16u;
  let safeCount = min(count, maxSources);

  var accum : f32 = 0.0;

  for (var i : u32 = 0u; i < safeCount; i = i + 1u) {
    let src = uSources[i];
    let spos = src.position_radius.xyz;
    let radius = src.position_radius.w;
    let strength = src.strength_pad.x;

    if (radius <= 0.0 || strength == 0.0) {
      continue;
    }

    let r = distance(worldPos, spos);
    if (r >= radius) {
      continue;
    }

    let t = 1.0 - r / radius;
    let falloff = t * t;
    accum = accum + strength * falloff;
  }

  // Only update density - velocity update disabled to reduce buffer contention
  if (accum != 0.0) {
    uDensity[idx] = uDensity[idx] + accum;
  }
}
`;
}

function createSplatState(device, options = {}) {
  // Match the default workgroup size in createSplatShader (32)
  const workgroupSize = normalizeWorkgroupSize(options.workgroupSize, 32);

  const shaderCode = createSplatShader(workgroupSize);
  const shaderModule = device.createShaderModule({
    label: "FluidSourceSplat.computeShader",
    code: shaderCode,
  });

  // Use async pipeline creation to avoid blocking during shader compilation
  const pipeline = device.createComputePipelineAsync({
    label: "FluidSourceSplat.pipeline",
    layout: "auto",
    compute: {
      module: shaderModule,
      entryPoint: "main",
    },
  });

  return { pipelinePromise: pipeline, workgroupSize };
}

const splatStateByDevice = new WeakMap();
const splatEpochByDevice = new WeakMap();
const SPLAT_SHADER_VERSION = 8; // Increment to force pipeline recreation

function nextSplatEpoch(device) {
  const epoch = (splatEpochByDevice.get(device) || 0) + 1;
  splatEpochByDevice.set(device, epoch);
  return epoch;
}

function isCurrentSplatRecord(device, record) {
  return Boolean(
    record &&
    !record.cancelled &&
    splatStateByDevice.get(device) === record &&
    splatEpochByDevice.get(device) === record.epoch
  );
}

function staleSplatInitializationError() {
  const error = new Error("FluidSourceSplat initialization was disposed");
  error.code = "FLUID_SOURCE_SPLAT_DISPOSED";
  return error;
}

function destroySplatRecord(record) {
  if (!record || record.cleaned) {
    return;
  }
  record.cancelled = true;
  record.cleaned = true;
  record.bindGroups?.clear?.();
  const sourcesBuffer = record.sourcesBuffer;
  const paramsBuffer = record.paramsBuffer;
  record.sourcesBuffer = null;
  record.paramsBuffer = null;
  record.bindGroups = null;
  destroyBuffers([sourcesBuffer, paramsBuffer]);
}

function retireSplatRecord(device, record) {
  if (!record) {
    return;
  }
  if (splatStateByDevice.get(device) === record) {
    splatStateByDevice.delete(device);
  }
  nextSplatEpoch(device);
  destroySplatRecord(record);
}

async function initializeSplatRecord(device, options, record) {
  let committed = false;
  try {
    if (!isCurrentSplatRecord(device, record)) {
      throw staleSplatInitializationError();
    }
    const base = createSplatState(device, options);
    record.workgroupSize = base.workgroupSize;
    const pipeline = await base.pipelinePromise;
    if (!isCurrentSplatRecord(device, record)) {
      throw staleSplatInitializationError();
    }
    record.pipeline = pipeline;
    record.bindGroupLayout = pipeline.getBindGroupLayout(0);

    record.paramsBuffer = createUniformBuffer(device, 48, {
      label: "FluidSourceSplat.params",
    });
    labelResource(record.paramsBuffer, "FluidSourceSplat.params");

    record.maxSources =
      typeof options.maxSources === "number" && options.maxSources > 0
        ? options.maxSources | 0
        : 64;

    const sourceStrideBytes = 8 * 4;
    record.sourcesBuffer = createStorageBuffer(
      device,
      record.maxSources * sourceStrideBytes,
      { label: "FluidSourceSplat.sources" }
    );
    labelResource(record.sourcesBuffer, "FluidSourceSplat.sources");

    const gpu = getGPUMemoryManager(device);
    const externalGetBindGroup = gpu && gpu.bindGroupCache && typeof gpu.getBindGroup === "function" ? gpu.getBindGroup.bind(gpu) : null;

    record.bindGroups = new BindGroupSignals(
      device,
      record.bindGroupLayout,
      [
        { name: "uDensity", binding: 0 },
        { name: "uSources", binding: 1 },
        { name: "uParams", binding: 2 },
      ],
      { label: "FluidSourceSplat.bindGroup", maxEntries: 64, getBindGroup: externalGetBindGroup }
    );

    if (!isCurrentSplatRecord(device, record)) {
      throw staleSplatInitializationError();
    }
    committed = true;
    return record;
  } finally {
    if (!committed) {
      if (splatStateByDevice.get(device) === record) {
        splatStateByDevice.delete(device);
      }
      destroySplatRecord(record);
    }
  }
}

async function getOrCreateSplatResources(device, options = {}) {
  let entry = splatStateByDevice.get(device);
  if (entry && entry.version === SPLAT_SHADER_VERSION) {
    return entry.promise;
  }
  if (entry) {
    retireSplatRecord(device, entry);
  }

  entry = {
    epoch: nextSplatEpoch(device),
    version: SPLAT_SHADER_VERSION,
    cancelled: false,
    cleaned: false,
    pipeline: null,
    bindGroupLayout: null,
    paramsBuffer: null,
    sourcesBuffer: null,
    bindGroups: null,
    maxSources: 0,
    workgroupSize: 0,
    promise: null,
  };
  splatStateByDevice.set(device, entry);
  entry.promise = Promise.resolve().then(() => initializeSplatRecord(device, options, entry));
  return entry.promise;
}

export async function splatFluidSources(fluidWorld, gpuDevice, options = {}) {
  if (!fluidWorld || !gpuDevice) {
    console.log("[SPLAT] Missing fluidWorld or gpuDevice");
    return;
  }

  const device = fluidWorld.device;
  if (!device) {
    console.log("[SPLAT] Missing device");
    return;
  }
  

  const sources = Array.isArray(options.sources) ? options.sources : [];
  if (sources.length === 0) {
    return;
  }

  const worldMin = Array.isArray(options.worldMin) ? options.worldMin : [0, 0, 0];
  const worldMax = Array.isArray(options.worldMax) ? options.worldMax : [1, 1, 1];

  const resources = await getOrCreateSplatResources(device, options);
  if (!isCurrentSplatRecord(device, resources)) {
    return;
  }
  const pipeline = resources.pipeline;

  const maxSources = resources.maxSources;
  const count = sources.length > maxSources ? maxSources : sources.length;
  if (count <= 0) {
    return;
  }

  const sourceStrideFloats = 8;
  ensureSplatSourceCapacity(count);
  const data = _splatSourceData;

  for (let i = 0; i < count; i++) {
    const src = sources[i] || {};
    const pos = Array.isArray(src.position) ? src.position : [0, 0, 0];
    const radiusValue = Number(src.radius);
    const strengthValue = Number(src.strength);
    const radius = Number.isFinite(radiusValue) ? radiusValue : 0;
    const strength = Number.isFinite(strengthValue) ? strengthValue : 0;

    const base = i * sourceStrideFloats;
    data[base + 0] = Number(pos[0]) || 0;
    data[base + 1] = Number(pos[1]) || 0;
    data[base + 2] = Number(pos[2]) || 0;
    data[base + 3] = radius;
    data[base + 4] = strength;
    data[base + 5] = 0;
    data[base + 6] = 0;
    data[base + 7] = 0;
  }

  updateBuffer(device, resources.sourcesBuffer, data, 0, count * sourceStrideFloats);

  const params = _splatParamsF32;  // Reuse buffer
  params[0] = fluidWorld.gridSizeX;
  params[1] = fluidWorld.gridSizeY;
  params[2] = fluidWorld.gridSizeZ;
  params[3] = count;
  params[4] = Number(worldMin[0]) || 0;
  params[5] = Number(worldMin[1]) || 0;
  params[6] = Number(worldMin[2]) || 0;
  params[7] = 0;
  params[8] = Number(worldMax[0]) || 0;
  params[9] = Number(worldMax[1]) || 0;
  params[10] = Number(worldMax[2]) || 0;
  params[11] = 0;
  
  // Comprehensive splat tracing via logger snapshot
  const logger = options.logger;
  if (logger && typeof logger.addSnapshot === "function") {
    // Compute expected grid cell for first source
    const src0 = sources[0];
    const srcPos = src0?.position || [0, 0, 0];
    const volumeSize = [
      params[8] - params[4],
      params[9] - params[5],
      params[10] - params[6],
    ];
    // Normalized position in volume [0,1]
    const normX = volumeSize[0] > 0 ? (srcPos[0] - params[4]) / volumeSize[0] : 0;
    const normY = volumeSize[1] > 0 ? (srcPos[1] - params[5]) / volumeSize[1] : 0;
    const normZ = volumeSize[2] > 0 ? (srcPos[2] - params[6]) / volumeSize[2] : 0;
    // Expected grid cell
    const gridX = normX * params[0];
    const gridY = normY * params[1];
    const gridZ = normZ * params[2];
    
    logger.addSnapshot("SPLAT.GpuParams", {
      gridSize: [params[0], params[1], params[2]],
      sourceCount: count,
      worldMin: [params[4], params[5], params[6]],
      worldMax: [params[8], params[9], params[10]],
      volumeSize,
      // First source analysis
      source0: {
        worldPos: srcPos,
        radius: src0?.radius,
        strength: src0?.strength,
        normalizedPos: [normX, normY, normZ],
        expectedGridCell: [gridX, gridY, gridZ],
        inBounds: normX >= 0 && normX <= 1 && normY >= 0 && normY <= 1 && normZ >= 0 && normZ <= 1,
      },
      // Shader coordinate mapping verification
      shaderMapping: {
        // In shader: worldPos = mix(worldMin, worldMax, gridNorm)
        // So inverse: gridNorm = (worldPos - worldMin) / (worldMax - worldMin)
        formula: "worldPos = mix(worldMin, worldMax, (gridCell + 0.5) / gridSize)",
        inverseFormula: "gridCell = ((worldPos - worldMin) / volumeSize) * gridSize - 0.5",
      },
    });
  }

  updateBuffer(device, resources.paramsBuffer, params, 0);

  // Bind group matches shader - density (0), sources (1), params (2)
  const bindGroup = resources.bindGroups.get({
    uDensity: fluidWorld.densityBuffer,
    uSources: resources.sourcesBuffer,
    uParams: resources.paramsBuffer,
  }, "FluidSourceSplat.bindGroup");

  // If an external encoder is provided, use it (for batching with other operations)
  // Otherwise create our own and submit immediately
  const externalPass = options.computePass;
  const externalEncoder = options.encoder;
  const encoder = externalEncoder || (externalPass ? null : device.createCommandEncoder({
    label: "FluidSourceSplat.encoder",
  }));
  
  const pass = externalPass || encoder.beginComputePass({
    label: "FluidSourceSplat.pass",
  });

  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);

  const cellCount = fluidWorld.cellCount | 0;
  if (cellCount > 0) {
    const groups = Math.ceil(cellCount / resources.workgroupSize);
    pass.dispatchWorkgroups(groups);
  }

  if (!externalPass) {
    pass.end();

    // Only submit if we created our own encoder
    if (!externalEncoder) {
      const commandBuffer = encoder.finish();
      device.queue.submit([commandBuffer]);
    }
  }
}

export function disposeFluidSourceSplat(device) {
  const entry = splatStateByDevice.get(device);
  if (!entry) {
    return;
  }
  retireSplatRecord(device, entry);
}

// PARTICLE-BASED SPLAT (splats density at each particle position for merging)
// ============================================================================
// This allows particles to be raymarched as metaballs that merge together

function createParticleSplatShader(workgroupSize) {
  const size = normalizeWorkgroupSize(workgroupSize, 64);
  const bindingsWGSL = generateWGSLBindGroupDeclarations(0, [
    { binding: 0, name: "uDensity", addressSpace: "storage", access: "read_write", wgslType: "array<f32>" },
    { binding: 1, name: "uColor", addressSpace: "storage", access: "read_write", wgslType: "array<vec4<f32>>" },
    { binding: 2, name: "uPositions", addressSpace: "storage", access: "read", wgslType: "array<vec4<f32>>" },
    { binding: 3, name: "uVelocities", addressSpace: "storage", access: "read", wgslType: "array<vec4<f32>>" },
    { binding: 4, name: "uMeta", addressSpace: "storage", access: "read", wgslType: "array<vec4<f32>>" },
    { binding: 5, name: "uParams", addressSpace: "uniform", wgslType: "Params" },
  ]);
  return `
// =============================================================================
// PARTICLE AS SMOKE SHADER - PARTICLE-CENTRIC (FAST!)
// =============================================================================
// Each thread handles ONE PARTICLE and splats to nearby grid cells
// Complexity: O(particles * cells_per_particle) instead of O(cells * particles)
// With 2000 particles and ~27 cells per particle = 54,000 ops
// vs old: 1.5M cells * 2000 particles = 3 BILLION ops

struct Params {
  gridSize      : vec3<f32>,
  particleCount : u32,
  worldMin      : vec3<f32>,
  radiusScale   : f32,
  worldMax      : vec3<f32>,
  densityScale  : f32,
};

${bindingsWGSL}

// rgb = weighted color, a = weight

// Decode packed meta.a: size * 100 + renderMode * 10 + shape
fn decodeParticleSize(metaW : f32) -> f32 {
  return floor(metaW / 10000.0);
}

// Convert world position to grid cell
fn worldToCell(worldPos : vec3<f32>) -> vec3<i32> {
  let normalized = (worldPos - uParams.worldMin) / (uParams.worldMax - uParams.worldMin);
  return vec3<i32>(normalized * uParams.gridSize);
}

// Get cell index from 3D coordinates (returns -1 if out of bounds)
fn cellIndex(x : i32, y : i32, z : i32) -> i32 {
  let gx = i32(uParams.gridSize.x);
  let gy = i32(uParams.gridSize.y);
  let gz = i32(uParams.gridSize.z);
  if (x < 0 || x >= gx || y < 0 || y >= gy || z < 0 || z >= gz) {
    return -1;
  }
  return x + y * gx + z * gx * gy;
}

// Get cell center in world space
fn cellCenter(x : i32, y : i32, z : i32) -> vec3<f32> {
  let normalized = (vec3<f32>(f32(x), f32(y), f32(z)) + 0.5) / uParams.gridSize;
  return mix(uParams.worldMin, uParams.worldMax, normalized);
}

@compute @workgroup_size(${size})
fn main(@builtin(global_invocation_id) global_id : vec3<u32>) {
  let particleIdx = global_id.x;
  
  if (particleIdx >= uParams.particleCount) {
    return;
  }
  
  // Read particle data
  let pos4 = uPositions[particleIdx];
  let vel4 = uVelocities[particleIdx];
  let pMeta = uMeta[particleIdx];
  
  let particlePos = pos4.xyz;
  let age = pos4.w;
  let lifetime = max(vel4.w, 0.1);
  
  // Skip dead particles
  if (age >= lifetime) {
    return;
  }
  
  // Get particle properties
  let particleSize = decodeParticleSize(pMeta.w);
  let particleColor = pMeta.rgb;
  let velocity = vel4.xyz;
  let speed = length(velocity);
  
  // Convert point size (screen pixels) to world radius
  // Use radiusScale as the base world-space radius, modulated by particle size
  let baseRadius = uParams.radiusScale;  // World units
  let sizeModifier = clamp(particleSize / 4.0, 0.5, 2.0);  // Normalize around size=4
  let radius = baseRadius * sizeModifier;
  
  // Velocity-based stretch: elongate splat along velocity direction
  // This compensates for reduced radius and adds motion blur feel
  let stretchFactor = 1.0 + clamp(speed * 0.15, 0.0, 1.0);  // Up to 2x stretch
  let stretchDir = select(vec3<f32>(0.0, 1.0, 0.0), normalize(velocity), speed > 0.1);
  
  // Fade with age
  let lifeRatio = 1.0 - clamp(age / lifetime, 0.0, 1.0);
  let strength = uParams.densityScale * lifeRatio;
  
  if (strength <= 0.0) {
    return;
  }
  
  // Find grid cells this particle affects
  let cellSize = (uParams.worldMax - uParams.worldMin) / uParams.gridSize;
  let minCellSize = min(min(cellSize.x, cellSize.y), cellSize.z);
  // Cap at 3 cells = 7x7x7 = 343 cells max per particle (4x faster than 5 cells)
  // Use tighter radius with velocity stretching for motion blur instead of larger spheres
  let radiusCells = min(i32(ceil(radius / minCellSize)) + 1, 3);
  let centerCell = worldToCell(particlePos);
  
  // Splat to nearby cells - particles merge when their splats overlap
  for (var dz = -radiusCells; dz <= radiusCells; dz = dz + 1) {
    for (var dy = -radiusCells; dy <= radiusCells; dy = dy + 1) {
      for (var dx = -radiusCells; dx <= radiusCells; dx = dx + 1) {
        let cx = centerCell.x + dx;
        let cy = centerCell.y + dy;
        let cz = centerCell.z + dz;
        
        let idx = cellIndex(cx, cy, cz);
        if (idx < 0) {
          continue;
        }
        
        // Get cell center and compute ellipsoid distance
        let cellWorldPos = cellCenter(cx, cy, cz);
        let delta = cellWorldPos - particlePos;
        
        // Ellipsoid distance: compress distance along velocity direction
        // This stretches the splat along the motion direction
        let alongVel = dot(delta, stretchDir);
        let perpVel = delta - stretchDir * alongVel;
        // Scale along-velocity component by 1/stretchFactor to elongate splat
        let scaledDelta = perpVel + stretchDir * (alongVel / stretchFactor);
        let dist = length(scaledDelta);
        
        if (dist >= radius) {
          continue;
        }
        
        // Smooth metaball falloff
        let r = dist / radius;
        let falloff = exp(-4.5 * r * r);
        let contribution = strength * falloff;
        
        if (contribution > 0.0) {
          // Add to density (race conditions acceptable for visual effects)
          uDensity[idx] = uDensity[idx] + contribution;
          
          // Add weighted color
          let prevColor = uColor[idx];
          uColor[idx] = vec4<f32>(
            prevColor.rgb + particleColor * contribution,
            prevColor.a + contribution
          );
        }
      }
    }
  }
}
`;
}

// State for particle-based splatting
const particleSplatStateByDevice = new Map();
const PARTICLE_SPLAT_SHADER_VERSION = 3;

function createParticleSplatState(device, options = {}) {
  const workgroupSize = normalizeWorkgroupSize(options.workgroupSize, 64);

  const gpu = getGPUMemoryManager(device);
  const externalGetBindGroup = gpu && gpu.bindGroupCache && typeof gpu.getBindGroup === "function" ? gpu.getBindGroup.bind(gpu) : null;

  const shaderCode = createParticleSplatShader(workgroupSize);
  const shaderModule = device.createShaderModule({
    label: "ParticleSplat.computeShader",
    code: shaderCode,
  });

  const pipeline = device.createComputePipeline({
    label: "ParticleSplat.pipeline",
    layout: "auto",
    compute: {
      module: shaderModule,
      entryPoint: "main",
    },
  });

  const paramsBuffer = createUniformBuffer(device, 48, {
    label: "ParticleSplat.params",
  });
  labelResource(paramsBuffer, "ParticleSplat.params");

  const entry = {
    pipeline,
    paramsBuffer,
    bindGroupLayout: pipeline.getBindGroupLayout(0),
    workgroupSize,
    version: PARTICLE_SPLAT_SHADER_VERSION,
    bindGroups: new BindGroupSignals(
      device,
      pipeline.getBindGroupLayout(0),
      [
        { name: "uDensity", binding: 0 },
        { name: "uColor", binding: 1 },
        { name: "uPositions", binding: 2 },
        { name: "uVelocities", binding: 3 },
        { name: "uMeta", binding: 4 },
        { name: "uParams", binding: 5 },
      ],
      { label: "ParticleAsSmoke.bindGroup", maxEntries: 64, getBindGroup: externalGetBindGroup }
    ),
  };

  particleSplatStateByDevice.set(device, entry);
  return entry;
}

function getParticleSplatState(device, options) {
  let entry = particleSplatStateByDevice.get(device);
  if (!entry || entry.version !== PARTICLE_SPLAT_SHADER_VERSION) {
    entry = createParticleSplatState(device, options);
  }
  return entry;
}

/**
 * PARTICLES AS SMOKE - splat density at each particle position.
 * Each particle IS the smoke - not a separate effect.
 * 
 * Inherits from particle:
 *   - Position → where density is splatted
 *   - Size (from meta.a) → splat radius
 *   - Color (from meta.rgb) → smoke color (sampled by smoke shader)
 *   - Age/Lifetime → fade behavior
 * 
 * When raymarched, overlapping particles merge into smooth fluid blobs.
 * 
 * @param {Object} fluidWorld - Fluid simulation world with densityBuffer
 * @param {Object} particleWorld - Particle simulation world with position/velocity/meta buffers
 * @param {Object} options - { radiusScale, densityScale, worldMin, worldMax, encoder, logger }
 */
export function splatParticleDensity(fluidWorld, particleWorld, options = {}) {
  if (!fluidWorld || !fluidWorld.densityBuffer || !fluidWorld.colorBuffer || !fluidWorld.device) {
    return;
  }
  // Requires position, velocity AND meta buffers (meta has color and size)
  if (!particleWorld || !particleWorld.positionBuffer || 
      !particleWorld.velocityBuffer || !particleWorld.metaBuffer) {
    return;
  }

  const device = fluidWorld.device;
  const resources = getParticleSplatState(device, options);

  // Get particle count from options (passed from SimulationUpdate) or particleWorld
  const particleCount = options.particleCount || particleWorld.particleCount || particleWorld.maxParticles || 0;
  if (particleCount <= 0) {
    return;
  }

  const gridX = fluidWorld.gridSizeX || 64;
  const gridY = fluidWorld.gridSizeY || 64;
  const gridZ = fluidWorld.gridSizeZ || 64;
  const cellCount = gridX * gridY * gridZ;

  // Get world bounds from options or fluidWorld
  const worldMin = options.worldMin || fluidWorld.worldMin || [-25, -25, -25];
  const worldMax = options.worldMax || fluidWorld.worldMax || [25, 25, 25];
  
  // Particle-as-smoke parameters
  // radiusScale: multiplier for particle size → splat radius (larger = softer blobs)
  // densityScale: base density contribution per particle (higher = more opaque)
  const radiusScale = typeof options.radiusScale === "number" ? options.radiusScale : 1.5;
  const densityScale = typeof options.densityScale === "number" ? options.densityScale : 1.0;

  // Update params buffer
  const paramsData = new Float32Array(12);
  paramsData[0] = gridX;
  paramsData[1] = gridY;
  paramsData[2] = gridZ;
  paramsData[3] = particleCount; // as u32 bit pattern
  paramsData[4] = worldMin[0];
  paramsData[5] = worldMin[1];
  paramsData[6] = worldMin[2];
  paramsData[7] = radiusScale;
  paramsData[8] = worldMax[0];
  paramsData[9] = worldMax[1];
  paramsData[10] = worldMax[2];
  paramsData[11] = densityScale;

  // Write particleCount as u32
  const paramsView = new DataView(paramsData.buffer);
  paramsView.setUint32(12, particleCount, true); // offset 12 bytes = index 3

  updateBuffer(device, resources.paramsBuffer, paramsData, 0);

  const bindGroup = resources.bindGroups.get({
    uDensity: fluidWorld.densityBuffer,
    uColor: fluidWorld.colorBuffer,
    uPositions: particleWorld.positionBuffer,
    uVelocities: particleWorld.velocityBuffer,
    uMeta: particleWorld.metaBuffer,
    uParams: resources.paramsBuffer,
  });

  const externalPass = options.computePass;
  const externalEncoder = options.encoder;
  const encoder = externalEncoder || (externalPass ? null : device.createCommandEncoder({
    label: "ParticleAsSmoke.encoder",
  }));

  const pass = externalPass || encoder.beginComputePass({
    label: "ParticleAsSmoke.pass",
  });

  pass.setPipeline(resources.pipeline);
  pass.setBindGroup(0, bindGroup);

  // Dispatch 1 thread per PARTICLE (not per cell!)
  // This is O(particles * ~27) instead of O(cells * particles)
  if (particleCount > 0) {
    const groups = Math.ceil(particleCount / resources.workgroupSize);
    pass.dispatchWorkgroups(groups);
  }

  if (!externalPass) {
    pass.end();

    if (!externalEncoder) {
      const commandBuffer = encoder.finish();
      device.queue.submit([commandBuffer]);
    }
  }

  if (options.logger && typeof options.logger.addSnapshot === "function") {
    options.logger.addSnapshot("PARTICLE_AS_SMOKE", {
      particleCount,
      gridSize: [gridX, gridY, gridZ],
      worldMin,
      worldMax,
      radiusScale,
      densityScale,
    });
  }
}

export function disposeParticleSplat(device) {
  const entry = particleSplatStateByDevice.get(device);
  if (!entry) {
    return;
  }
  destroyBuffers([entry.paramsBuffer]);
  particleSplatStateByDevice.delete(device);
}
