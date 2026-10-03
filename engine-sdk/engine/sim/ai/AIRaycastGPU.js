// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * AIRaycastGPU.js
 * 
 * ⚠️ MULTIPLAYER: Uses deterministic RNG from AIRandom.js
 */

import { aiRng } from './AIRandom.js';
import { positiveSafeEntityHandleReport } from '../../ecs/world/World.js';

/**
 * AIRaycastGPU.js (original) - WebGPU compute shader for batch ray casting
 * 
 * Use when processing 500+ rays per frame for 10-100x throughput vs CPU.
 * Below 500 rays, CPU is faster due to dispatch overhead.
 * 
 * Features:
 * - Parallel ray-AABB intersection (slab method)
 * - Parallel ray-sphere intersection
 * - Batched results readback
 */

// ============================================================================
// WGSL SHADERS
// ============================================================================

const RAYCAST_AABB_SHADER = /* wgsl */ `
struct Ray {
  origin: vec3f,
  _pad0: f32,
  direction: vec3f,
  _pad1: f32,
  invDir: vec3f,
  rayIndex: u32,
}

struct AABB {
  min: vec3f,
  targetIndex: u32,
  max: vec3f,
  _pad: u32,
}

struct RayResult {
  hitDistance: f32,
  hitTargetIndex: i32,
  rayIndex: u32,
  _pad: u32,
}

@group(0) @binding(0) var<storage, read> rays: array<Ray>;
@group(0) @binding(1) var<storage, read> targets: array<AABB>;
@group(0) @binding(2) var<storage, read_write> results: array<RayResult>;
@group(0) @binding(3) var<uniform> counts: vec2u; // x=rayCount, y=targetCount

fn rayAABBIntersect(ray: Ray, aabb: AABB) -> f32 {
  let t1 = (aabb.min - ray.origin) * ray.invDir;
  let t2 = (aabb.max - ray.origin) * ray.invDir;
  
  let tmin = min(t1, t2);
  let tmax = max(t1, t2);
  
  let tNear = max(max(tmin.x, tmin.y), tmin.z);
  let tFar = min(min(tmax.x, tmax.y), tmax.z);
  
  if (tFar >= max(tNear, 0.0)) {
    return select(tFar, tNear, tNear >= 0.0);
  }
  return -1.0;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let rayIdx = id.x;
  if (rayIdx >= counts.x) { return; }
  
  let ray = rays[rayIdx];
  var closest: f32 = 1e30;
  var hitId: i32 = -1;
  
  for (var i = 0u; i < counts.y; i++) {
    let t = rayAABBIntersect(ray, targets[i]);
    if (t > 0.0 && t < closest) {
      closest = t;
      hitId = i32(targets[i].targetIndex);
    }
  }
  
  results[rayIdx].hitDistance = select(closest, -1.0, closest >= 1e29);
  results[rayIdx].hitTargetIndex = hitId;
  results[rayIdx].rayIndex = ray.rayIndex;
}
`;

const RAYCAST_SPHERE_SHADER = /* wgsl */ `
struct Ray {
  origin: vec3f,
  _pad0: f32,
  direction: vec3f,
  _pad1: f32,
  invDir: vec3f,
  rayIndex: u32,
}

struct Sphere {
  center: vec3f,
  radius: f32,
  targetIndex: u32,
  _pad0: u32,
  _pad1: u32,
  _pad2: u32,
}

struct RayResult {
  hitDistance: f32,
  hitTargetIndex: i32,
  rayIndex: u32,
  _pad: u32,
}

@group(0) @binding(0) var<storage, read> rays: array<Ray>;
@group(0) @binding(1) var<storage, read> targets: array<Sphere>;
@group(0) @binding(2) var<storage, read_write> results: array<RayResult>;
@group(0) @binding(3) var<uniform> counts: vec2u;

fn raySphereIntersect(rayOrigin: vec3f, rayDir: vec3f, sphereCenter: vec3f, radius: f32) -> f32 {
  let oc = rayOrigin - sphereCenter;
  let a = dot(rayDir, rayDir);
  let b = 2.0 * dot(oc, rayDir);
  let c = dot(oc, oc) - radius * radius;
  
  let discriminant = b * b - 4.0 * a * c;
  if (discriminant < 0.0) { return -1.0; }
  
  let sqrtDisc = sqrt(discriminant);
  let t1 = (-b - sqrtDisc) / (2.0 * a);
  
  if (t1 > 0.0) { return t1; }
  
  let t2 = (-b + sqrtDisc) / (2.0 * a);
  return select(-1.0, t2, t2 > 0.0);
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let rayIdx = id.x;
  if (rayIdx >= counts.x) { return; }
  
  let ray = rays[rayIdx];
  var closest: f32 = 1e30;
  var hitId: i32 = -1;
  
  for (var i = 0u; i < counts.y; i++) {
    let sphere = targets[i];
    let t = raySphereIntersect(ray.origin, ray.direction, sphere.center, sphere.radius);
    if (t > 0.0 && t < closest) {
      closest = t;
      hitId = i32(sphere.targetIndex);
    }
  }
  
  results[rayIdx].hitDistance = select(closest, -1.0, closest >= 1e29);
  results[rayIdx].hitTargetIndex = hitId;
  results[rayIdx].rayIndex = ray.rayIndex;
}
`;

// ============================================================================
// GPU RAYCAST SYSTEM
// ============================================================================

/**
 * Create a GPU raycast system
 * @param {GPUDevice} device - WebGPU device
 * @param {Object} options - Options
 * @returns {Promise<Object>} GPU raycast system
 */
export async function createGPURaycastSystem(device, options = {}) {
  const maxRays = options.maxRays || 4096;
  const maxTargets = options.maxTargets || 1024;

  // Create pipelines
  const aabbPipeline = await createComputePipeline(device, RAYCAST_AABB_SHADER);
  const spherePipeline = await createComputePipeline(device, RAYCAST_SPHERE_SHADER);

  // Create buffers
  const rayBuffer = device.createBuffer({
    size: maxRays * 48, // 12 floats per ray (padded)
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    label: "rayBuffer",
  });

  const aabbTargetBuffer = device.createBuffer({
    size: maxTargets * 32, // 8 floats per AABB
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    label: "aabbTargetBuffer",
  });

  const sphereTargetBuffer = device.createBuffer({
    size: maxTargets * 32, // 8 floats per sphere
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    label: "sphereTargetBuffer",
  });

  const resultBuffer = device.createBuffer({
    size: maxRays * 16, // 4 values per result
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    label: "resultBuffer",
  });

  const readbackBuffer = device.createBuffer({
    size: maxRays * 16,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    label: "readbackBuffer",
  });

  const countsBuffer = device.createBuffer({
    size: 8, // 2 u32
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    label: "countsBuffer",
  });

  // Create bind group layouts
  const bindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
    ],
    label: "raycastBindGroupLayout",
  });

  // Create bind groups
  const aabbBindGroup = device.createBindGroup({
    layout: bindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: rayBuffer } },
      { binding: 1, resource: { buffer: aabbTargetBuffer } },
      { binding: 2, resource: { buffer: resultBuffer } },
      { binding: 3, resource: { buffer: countsBuffer } },
    ],
    label: "aabbBindGroup",
  });

  const sphereBindGroup = device.createBindGroup({
    layout: bindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: rayBuffer } },
      { binding: 1, resource: { buffer: sphereTargetBuffer } },
      { binding: 2, resource: { buffer: resultBuffer } },
      { binding: 3, resource: { buffer: countsBuffer } },
    ],
    label: "sphereBindGroup",
  });

  return {
    device,
    maxRays,
    maxTargets,
    aabbPipeline,
    spherePipeline,
    rayBuffer,
    aabbTargetBuffer,
    sphereTargetBuffer,
    resultBuffer,
    readbackBuffer,
    countsBuffer,
    aabbBindGroup,
    sphereBindGroup,
    bindGroupLayout,

    // Staging arrays
    rayData: new Float32Array(maxRays * 12),
    aabbData: new Float32Array(maxTargets * 8),
    sphereData: new Float32Array(maxTargets * 8),
    countsData: new Uint32Array(2),

    // Full ECS identities never enter u32 GPU storage. Each dispatch snapshots
    // these maps while WGSL operates only on their dense bounded indexes.
    rayEntityHandles: new Array(maxRays).fill(null),
    aabbTargetEntityHandles: new Array(maxTargets).fill(null),
    sphereTargetEntityHandles: new Array(maxTargets).fill(null),
    resultIdentityMap: null,

    // State
    pendingReadback: false,
  };
}

function collectEntityHandles(records, count, field, label) {
  const handles = new Array(count);
  for (let index = 0; index < count; index++) {
    const handle = records[index]?.[field];
    const report = positiveSafeEntityHandleReport(handle);
    if (!report.valid) {
      throw new RangeError(`${label}[${index}].${field} must be a positive safe entity handle`);
    }
    handles[index] = report.value;
  }
  return handles;
}

function writeIdentityHandles(destination, handles) {
  for (let index = 0; index < handles.length; index++) {
    destination[index] = handles[index];
  }
}

function snapshotIdentityHandles(source, count, capacity, label) {
  if (!Array.isArray(source) || count > capacity || count > source.length) {
    throw new RangeError(`AIRaycastGPU: ${label} count exceeds its dispatch capacity`);
  }
  const snapshot = source.slice(0, count);
  for (let index = 0; index < snapshot.length; index++) {
    if (!positiveSafeEntityHandleReport(snapshot[index]).valid) {
      throw new RangeError(`AIRaycastGPU: ${label}[${index}] is not a positive safe entity handle`);
    }
  }
  return Object.freeze(snapshot);
}

function createDispatchIdentityMap(system, targetType) {
  if (system.pendingReadback || system.resultIdentityMap !== null) {
    throw new Error("AIRaycastGPU: A prior dispatch is awaiting readback");
  }
  const rayCount = system.countsData[0];
  const targetCount = system.countsData[1];
  const targets = targetType === "aabb"
    ? system.aabbTargetEntityHandles
    : system.sphereTargetEntityHandles;
  return Object.freeze({
    targetType,
    rayEntityHandles: snapshotIdentityHandles(
      system.rayEntityHandles,
      rayCount,
      system.maxRays,
      "ray identity map",
    ),
    targetEntityHandles: snapshotIdentityHandles(
      targets,
      targetCount,
      system.maxTargets,
      `${targetType} target identity map`,
    ),
  });
}

/**
 * Resolve dense GPU result indexes through one immutable dispatch identity map.
 * Misses retain -1; every successful hit and ray identity remains Number-safe.
 */
export function resolveRaycastResultIdentity(identityMap, hitTargetIndex, rayIndex) {
  if (
    !identityMap ||
    !Array.isArray(identityMap.rayEntityHandles) ||
    !Array.isArray(identityMap.targetEntityHandles)
  ) {
    throw new TypeError("AIRaycastGPU: Dispatch identity map is required");
  }
  if (
    !Number.isInteger(rayIndex) ||
    rayIndex < 0 ||
    rayIndex >= identityMap.rayEntityHandles.length
  ) {
    throw new RangeError("AIRaycastGPU: GPU ray index is outside the dispatch map");
  }
  if (hitTargetIndex !== -1 && (
    !Number.isInteger(hitTargetIndex) ||
    hitTargetIndex < 0 ||
    hitTargetIndex >= identityMap.targetEntityHandles.length
  )) {
    throw new RangeError("AIRaycastGPU: GPU target index is outside the dispatch map");
  }
  const npcId = identityMap.rayEntityHandles[rayIndex];
  const hitEntityId = hitTargetIndex === -1
    ? -1
    : identityMap.targetEntityHandles[hitTargetIndex];
  if (!positiveSafeEntityHandleReport(npcId).valid) {
    throw new RangeError("AIRaycastGPU: Dispatch ray identity is not a positive safe entity handle");
  }
  if (hitEntityId !== -1 && !positiveSafeEntityHandleReport(hitEntityId).valid) {
    throw new RangeError("AIRaycastGPU: Dispatch target identity is not a positive safe entity handle");
  }
  return Object.freeze({
    hitEntityId,
    npcId,
  });
}

/**
 * Create a compute pipeline from WGSL source
 * @param {GPUDevice} device - WebGPU device
 * @param {string} source - WGSL shader source
 * @returns {Promise<GPUComputePipeline>} Compute pipeline
 */
async function createComputePipeline(device, source) {
  const module = device.createShaderModule({
    code: source,
    label: "raycastShaderModule",
  });

  return device.createComputePipelineAsync({
    layout: "auto",
    compute: {
      module,
      entryPoint: "main",
    },
    label: "raycastPipeline",
  });
}

/**
 * Upload ray data to GPU
 * @param {Object} system - GPU raycast system
 * @param {Array<{origin: number[], direction: number[], npcId: number}>} rays - Ray data
 */
export function uploadRays(system, rays) {
  const count = Math.min(rays.length, system.maxRays);
  const handles = collectEntityHandles(rays, count, "npcId", "rays");
  const view = new DataView(system.rayData.buffer);

  for (let i = 0; i < count; i++) {
    const ray = rays[i];
    const offset = i * 12;

    // Origin
    system.rayData[offset + 0] = ray.origin[0];
    system.rayData[offset + 1] = ray.origin[1];
    system.rayData[offset + 2] = ray.origin[2];
    system.rayData[offset + 3] = 0; // padding

    // Direction
    system.rayData[offset + 4] = ray.direction[0];
    system.rayData[offset + 5] = ray.direction[1];
    system.rayData[offset + 6] = ray.direction[2];
    system.rayData[offset + 7] = 0; // padding

    // Inverse direction (pre-computed for slab method)
    const EPSILON = 1e-10;
    system.rayData[offset + 8] = 1.0 / (Math.abs(ray.direction[0]) < EPSILON ? EPSILON : ray.direction[0]);
    system.rayData[offset + 9] = 1.0 / (Math.abs(ray.direction[1]) < EPSILON ? EPSILON : ray.direction[1]);
    system.rayData[offset + 10] = 1.0 / (Math.abs(ray.direction[2]) < EPSILON ? EPSILON : ray.direction[2]);

    // Dense dispatch index; the full safe handle remains in JavaScript.
    view.setUint32((offset + 11) * 4, i, true);
  }

  writeIdentityHandles(system.rayEntityHandles, handles);
  system.device.queue.writeBuffer(system.rayBuffer, 0, system.rayData, 0, count * 12);
  system.countsData[0] = count;
}

/**
 * Upload AABB targets to GPU
 * @param {Object} system - GPU raycast system
 * @param {Array<{min: number[], max: number[], entityId: number}>} targets - AABB targets
 */
export function uploadAABBTargets(system, targets) {
  const count = Math.min(targets.length, system.maxTargets);
  const handles = collectEntityHandles(targets, count, "entityId", "targets");
  const view = new DataView(system.aabbData.buffer);

  for (let i = 0; i < count; i++) {
    const target = targets[i];
    const offset = i * 8;

    system.aabbData[offset + 0] = target.min[0];
    system.aabbData[offset + 1] = target.min[1];
    system.aabbData[offset + 2] = target.min[2];

    view.setUint32((offset + 3) * 4, i, true);

    system.aabbData[offset + 4] = target.max[0];
    system.aabbData[offset + 5] = target.max[1];
    system.aabbData[offset + 6] = target.max[2];
    system.aabbData[offset + 7] = 0; // padding
  }

  writeIdentityHandles(system.aabbTargetEntityHandles, handles);
  system.device.queue.writeBuffer(system.aabbTargetBuffer, 0, system.aabbData, 0, count * 8);
  system.countsData[1] = count;
}

/**
 * Upload sphere targets to GPU
 * @param {Object} system - GPU raycast system
 * @param {Array<{center: number[], radius: number, entityId: number}>} targets - Sphere targets
 */
export function uploadSphereTargets(system, targets) {
  const count = Math.min(targets.length, system.maxTargets);
  const handles = collectEntityHandles(targets, count, "entityId", "targets");
  const view = new DataView(system.sphereData.buffer);

  for (let i = 0; i < count; i++) {
    const target = targets[i];
    const offset = i * 8;

    system.sphereData[offset + 0] = target.center[0];
    system.sphereData[offset + 1] = target.center[1];
    system.sphereData[offset + 2] = target.center[2];
    system.sphereData[offset + 3] = target.radius;

    view.setUint32((offset + 4) * 4, i, true);

    system.sphereData[offset + 5] = 0; // padding
    system.sphereData[offset + 6] = 0;
    system.sphereData[offset + 7] = 0;
  }

  writeIdentityHandles(system.sphereTargetEntityHandles, handles);
  system.device.queue.writeBuffer(system.sphereTargetBuffer, 0, system.sphereData, 0, count * 8);
  system.countsData[1] = count;
}

/**
 * Dispatch GPU raycast against AABBs
 * @param {Object} system - GPU raycast system
 * @param {GPUCommandEncoder} encoder - Command encoder
 */
export function dispatchAABBRaycast(system, encoder) {
  const identityMap = createDispatchIdentityMap(system, "aabb");
  // Upload counts
  system.device.queue.writeBuffer(system.countsBuffer, 0, system.countsData);

  const pass = encoder.beginComputePass({ label: "aabbRaycastPass" });
  pass.setPipeline(system.aabbPipeline);
  pass.setBindGroup(0, system.aabbBindGroup);

  const workgroups = Math.ceil(system.countsData[0] / 64);
  pass.dispatchWorkgroups(workgroups);
  pass.end();
  system.resultIdentityMap = identityMap;
}

/**
 * Dispatch GPU raycast against spheres
 * @param {Object} system - GPU raycast system
 * @param {GPUCommandEncoder} encoder - Command encoder
 */
export function dispatchSphereRaycast(system, encoder) {
  const identityMap = createDispatchIdentityMap(system, "sphere");
  // Upload counts
  system.device.queue.writeBuffer(system.countsBuffer, 0, system.countsData);

  const pass = encoder.beginComputePass({ label: "sphereRaycastPass" });
  pass.setPipeline(system.spherePipeline);
  pass.setBindGroup(0, system.sphereBindGroup);

  const workgroups = Math.ceil(system.countsData[0] / 64);
  pass.dispatchWorkgroups(workgroups);
  pass.end();
  system.resultIdentityMap = identityMap;
}

/**
 * Copy results to readback buffer
 * @param {Object} system - GPU raycast system
 * @param {GPUCommandEncoder} encoder - Command encoder
 */
export function copyResultsToReadback(system, encoder) {
  const byteSize = system.countsData[0] * 16;
  encoder.copyBufferToBuffer(system.resultBuffer, 0, system.readbackBuffer, 0, byteSize);
}

/**
 * Read back results from GPU (async)
 * @param {Object} system - GPU raycast system
 * @returns {Promise<Array<{hitDistance: number, hitEntityId: number, npcId: number}>>} Results
 */
export async function readbackResults(system) {
  if (system.pendingReadback) {
    console.warn("AIRaycastGPU: Readback already pending");
    return [];
  }

  system.pendingReadback = true;
  const identityMap = system.resultIdentityMap;
  let mapped = false;

  try {
    if (!identityMap) {
      throw new Error("AIRaycastGPU: No dispatch identity map is available");
    }
    await system.readbackBuffer.mapAsync(GPUMapMode.READ);
    mapped = true;

    const data = new Float32Array(system.readbackBuffer.getMappedRange().slice(0));
    const results = [];
    const rayCount = system.countsData[0];

    for (let i = 0; i < rayCount; i++) {
      const offset = i * 4;
      const view = new DataView(data.buffer);

      const identity = resolveRaycastResultIdentity(
        identityMap,
        view.getInt32((offset + 1) * 4, true),
        view.getUint32((offset + 2) * 4, true),
      );
      results.push({ hitDistance: data[offset + 0], ...identity });
    }

    system.readbackBuffer.unmap();
    mapped = false;
    system.pendingReadback = false;
    system.resultIdentityMap = null;

    return results;
  } catch (err) {
    if (mapped) {
      try {
        system.readbackBuffer.unmap();
      } catch (_) {
        // Preserve the original decoding/readback error.
      }
    }
    system.pendingReadback = false;
    system.resultIdentityMap = null;
    console.error("AIRaycastGPU readback error:", err);
    return [];
  }
}

/**
 * Full batch raycast operation
 * @param {Object} system - GPU raycast system
 * @param {Array} rays - Ray data
 * @param {Array} targets - Target data (AABB or sphere)
 * @param {string} targetType - "aabb" or "sphere"
 * @returns {Promise<Array>} Raycast results
 */
export async function batchRaycast(system, rays, targets, targetType = "sphere") {
  if (system.pendingReadback || system.resultIdentityMap !== null) {
    throw new Error("AIRaycastGPU: A prior dispatch is awaiting readback");
  }
  if (rays.length === 0 || targets.length === 0) {
    return [];
  }

  // Upload data
  uploadRays(system, rays);

  if (targetType === "aabb") {
    uploadAABBTargets(system, targets);
  } else {
    uploadSphereTargets(system, targets);
  }

  // Create command encoder and dispatch
  const encoder = system.device.createCommandEncoder({ label: "raycastEncoder" });

  try {
    if (targetType === "aabb") {
      dispatchAABBRaycast(system, encoder);
    } else {
      dispatchSphereRaycast(system, encoder);
    }

    copyResultsToReadback(system, encoder);

    // Submit and readback
    system.device.queue.submit([encoder.finish()]);
  } catch (error) {
    system.resultIdentityMap = null;
    throw error;
  }

  return readbackResults(system);
}

/**
 * Destroy GPU raycast system and free resources
 * @param {Object} system - GPU raycast system
 */
export function destroyGPURaycastSystem(system) {
  system.resultIdentityMap = null;
  system.rayBuffer.destroy();
  system.aabbTargetBuffer.destroy();
  system.sphereTargetBuffer.destroy();
  system.resultBuffer.destroy();
  system.readbackBuffer.destroy();
  system.countsBuffer.destroy();
}

// ============================================================================
// PERFORMANCE HELPERS
// ============================================================================

/**
 * Determine if GPU raycast should be used based on ray count
 * @param {number} rayCount - Number of rays to cast
 * @param {number} threshold - Threshold for GPU usage (default 500)
 * @returns {boolean} True if GPU should be used
 */
export function shouldUseGPURaycast(rayCount, threshold = 500) {
  return rayCount >= threshold;
}

/**
 * Benchmark CPU vs GPU raycast for calibration
 * @param {Object} system - GPU raycast system
 * @param {number} rayCount - Number of rays to test
 * @param {number} targetCount - Number of targets
 * @returns {Promise<{cpuMs: number, gpuMs: number, recommendation: string}>}
 */
export async function benchmarkRaycast(system, rayCount = 1000, targetCount = 100) {
  // Generate test data
  const rays = [];
  const targets = [];

  for (let i = 0; i < rayCount; i++) {
    rays.push({
      origin: [aiRng.float() * 100, aiRng.float() * 100, aiRng.float() * 100],
      direction: [aiRng.range(-0.5, 0.5), aiRng.range(-0.5, 0.5), aiRng.range(-0.5, 0.5)],
      npcId: i + 1,
    });
  }

  for (let i = 0; i < targetCount; i++) {
    targets.push({
      center: [aiRng.float() * 100, aiRng.float() * 100, aiRng.float() * 100],
      radius: aiRng.range(1, 3),
      entityId: i + 1,
    });
  }

  // Benchmark CPU
  const cpuStart = performance.now();
  for (const ray of rays) {
    for (const target of targets) {
      raySphereIntersectCPU(ray.origin, ray.direction, target.center, target.radius);
    }
  }
  const cpuMs = performance.now() - cpuStart;

  // Benchmark GPU
  const gpuStart = performance.now();
  await batchRaycast(system, rays, targets, "sphere");
  const gpuMs = performance.now() - gpuStart;

  const recommendation = gpuMs < cpuMs ? "gpu" : "cpu";

  return { cpuMs, gpuMs, recommendation };
}

/**
 * CPU ray-sphere for benchmark comparison
 */
function raySphereIntersectCPU(origin, dir, center, radius) {
  const oc = [origin[0] - center[0], origin[1] - center[1], origin[2] - center[2]];
  const a = dir[0] * dir[0] + dir[1] * dir[1] + dir[2] * dir[2];
  const b = 2 * (oc[0] * dir[0] + oc[1] * dir[1] + oc[2] * dir[2]);
  const c = oc[0] * oc[0] + oc[1] * oc[1] + oc[2] * oc[2] - radius * radius;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  return (-b - Math.sqrt(disc)) / (2 * a);
}
