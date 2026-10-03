// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ParticleLightEmission.js - Particles as dynamic point lights
 * 
 * Niagara/PopcornFX parity: emissive particles contribute point lights to the scene.
 * 
 * Pipeline:
 *   1. GPU compute shader finds the top-N brightest/hottest particles
 *   2. Results are read back to CPU as an array of point light descriptors
 *   3. Any lighting system can consume these as dynamic lights
 * 
 * This avoids tight coupling to a specific lighting implementation.
 * The consumer (LightingPass, voxel lighting, etc.) reads the light array each frame.
 */

import { createStorageBuffer, createUniformBuffer, updateBuffer } from "../../core/gpu/GpuBuffer.js";

// ============================================================================
// CONFIGURATION
// ============================================================================

const MAX_PARTICLE_LIGHTS = 32;
const LIGHT_STRIDE = 8; // floats per light: x, y, z, radius, r, g, b, intensity

// ============================================================================
// GPU SHADER: Find top-N emissive particles
// ============================================================================

const LIGHT_EXTRACT_SHADER = /* wgsl */`
struct Params {
  particleCount: u32,
  maxLights: u32,
  temperatureThreshold: f32,
  intensityScale: f32,
};

struct ParticleLight {
  position: vec3<f32>,
  radius: f32,
  color: vec3<f32>,
  intensity: f32,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> velocities: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> particleMeta: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read> thermalData: array<vec4<f32>>;
@group(0) @binding(5) var<storage, read_write> lightOutput: array<f32>;
@group(0) @binding(6) var<storage, read_write> lightCount: atomic<u32>;

// Blackbody color approximation (Kelvin → RGB)
fn blackbodyColor(temp: f32) -> vec3<f32> {
  let t = temp / 100.0;
  var r: f32; var g: f32; var b: f32;
  
  if (t <= 66.0) {
    r = 1.0;
    g = clamp((99.4708025861 * log(t) - 161.1195681661) / 255.0, 0.0, 1.0);
  } else {
    r = clamp(329.698727446 * pow(t - 60.0, -0.1332047592) / 255.0, 0.0, 1.0);
    g = clamp(288.1221695283 * pow(t - 60.0, -0.0755148492) / 255.0, 0.0, 1.0);
  }
  
  if (t >= 66.0) {
    b = 1.0;
  } else if (t <= 19.0) {
    b = 0.0;
  } else {
    b = clamp((138.5177312231 * log(t - 10.0) - 305.0447927307) / 255.0, 0.0, 1.0);
  }
  
  return vec3<f32>(r, g, b);
}

@compute @workgroup_size(256)
fn extractLights(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= params.particleCount) { return; }
  
  let pos = positions[i];
  let age = pos.w;
  let lifetime = max(velocities[i].w, 0.1);
  
  // Skip dead particles
  if (age >= lifetime) { return; }
  
  let thermal = thermalData[i];
  let temperature = thermal.x;
  let phase = thermal.y;
  
  // Only emit light if above threshold
  if (temperature < params.temperatureThreshold) { return; }
  
  // Compute light intensity from temperature
  let tempExcess = temperature - params.temperatureThreshold;
  let intensity = clamp(tempExcess * 0.002 * params.intensityScale, 0.0, 10.0);
  
  // Phase boost: plasma emits more light
  let phaseBoost = select(1.0, select(1.5, 2.5, phase >= 3.0), phase >= 2.0);
  let finalIntensity = intensity * phaseBoost;
  
  // Lifetime fade
  let t = clamp(age / lifetime, 0.0, 1.0);
  let lifeFade = smoothstep(0.0, 0.05, t) * (1.0 - smoothstep(0.85, 1.0, t));
  let fadedIntensity = finalIntensity * lifeFade;
  
  if (fadedIntensity < 0.05) { return; }
  
  // Atomic increment to claim a light slot
  let slot = atomicAdd(&lightCount, 1u);
  if (slot >= params.maxLights) { return; }
  
  // Compute light color from temperature (blackbody) × particle color
  let bbColor = blackbodyColor(temperature);
  let particleColor = particleMeta[i].rgb;
  let lightColor = bbColor * particleColor;
  
  // Extract particle size for light radius
  let packedMeta = particleMeta[i].w;
  let particleSize = (floor(packedMeta / 1e4) % 100.0) * 0.1;
  let lightRadius = max(particleSize * 2.0, 1.0); // Light extends beyond particle
  
  // Write light data
  let base = slot * 8u;
  lightOutput[base + 0u] = pos.x;
  lightOutput[base + 1u] = pos.y;
  lightOutput[base + 2u] = pos.z;
  lightOutput[base + 3u] = lightRadius;
  lightOutput[base + 4u] = lightColor.x;
  lightOutput[base + 5u] = lightColor.y;
  lightOutput[base + 6u] = lightColor.z;
  lightOutput[base + 7u] = fadedIntensity;
}
`;

// ============================================================================
// SYSTEM CREATION
// ============================================================================

/**
 * Create particle light emission system
 * @param {GPUDevice} device
 * @param {Object} options
 * @param {number} options.maxLights - Max particle lights per frame (default 32)
 * @param {number} options.temperatureThreshold - Min temp to emit light (default 800K)
 * @param {number} options.intensityScale - Light intensity multiplier (default 1.0)
 */
export function createParticleLightSystem(device, options = {}) {
  const maxLights = options.maxLights || MAX_PARTICLE_LIGHTS;

  const shaderModule = device.createShaderModule({
    label: "ParticleLightEmission.shader",
    code: LIGHT_EXTRACT_SHADER,
  });

  const pipeline = device.createComputePipeline({
    label: "ParticleLightEmission.pipeline",
    layout: 'auto',
    compute: { module: shaderModule, entryPoint: 'extractLights' },
  });

  // Params uniform
  const paramsBuffer = device.createBuffer({
    label: "ParticleLightEmission.params",
    size: 16, // 4 floats
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  // Light output buffer (GPU writable, CPU readable via staging)
  const lightOutputBuffer = device.createBuffer({
    label: "ParticleLightEmission.lightOutput",
    size: maxLights * LIGHT_STRIDE * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });

  // Atomic counter buffer
  const lightCountBuffer = device.createBuffer({
    label: "ParticleLightEmission.lightCount",
    size: 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  });

  // Staging buffers for readback
  const stagingLights = device.createBuffer({
    label: "ParticleLightEmission.staging.lights",
    size: maxLights * LIGHT_STRIDE * 4,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });
  const stagingCount = device.createBuffer({
    label: "ParticleLightEmission.staging.count",
    size: 4,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });

  return {
    device,
    pipeline,
    paramsBuffer,
    lightOutputBuffer,
    lightCountBuffer,
    stagingLights,
    stagingCount,
    maxLights,
    temperatureThreshold: options.temperatureThreshold ?? 800,
    intensityScale: options.intensityScale ?? 1.0,
    bindGroup: null,
    // CPU-side light array (updated after readback)
    lights: [],
    _readbackPending: false,
  };
}

/**
 * Initialize bind group (call once when particle buffers are ready)
 */
export function initParticleLightBindGroup(system, particleWorld) {
  if (!system || !particleWorld) return;
  const device = system.device;

  system.bindGroup = device.createBindGroup({
    label: "ParticleLightEmission.bindGroup",
    layout: system.pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: system.paramsBuffer } },
      { binding: 1, resource: { buffer: particleWorld.positionBuffer } },
      { binding: 2, resource: { buffer: particleWorld.velocityBuffer } },
      { binding: 3, resource: { buffer: particleWorld.metaBuffer } },
      { binding: 4, resource: { buffer: particleWorld.thermalBuffer } },
      { binding: 5, resource: { buffer: system.lightOutputBuffer } },
      { binding: 6, resource: { buffer: system.lightCountBuffer } },
    ],
  });
}

/**
 * Execute the light extraction compute pass
 * @param {GPUCommandEncoder} encoder
 * @param {Object} system
 * @param {number} particleCount - Active particle count
 */
export function extractParticleLights(encoder, system, particleCount) {
  if (!system?.bindGroup || particleCount <= 0) return;
  if (system._readbackPending) return;
  const device = system.device;

  // Update params
  const paramsData = new Float32Array([
    particleCount,
    system.maxLights,
    system.temperatureThreshold,
    system.intensityScale,
  ]);
  // Reinterpret first two as u32
  const paramsView = new DataView(paramsData.buffer);
  paramsView.setUint32(0, particleCount, true);
  paramsView.setUint32(4, system.maxLights, true);
  device.queue.writeBuffer(system.paramsBuffer, 0, paramsData);

  // Reset light count to 0
  device.queue.writeBuffer(system.lightCountBuffer, 0, new Uint32Array([0]));

  // Dispatch compute
  const pass = encoder.beginComputePass({ label: "ParticleLightEmission.computePass" });
  pass.setPipeline(system.pipeline);
  pass.setBindGroup(0, system.bindGroup);
  pass.dispatchWorkgroups(Math.ceil(particleCount / 256));
  pass.end();

  // Copy results to staging for readback
  encoder.copyBufferToBuffer(
    system.lightCountBuffer, 0, system.stagingCount, 0, 4,
  );
  encoder.copyBufferToBuffer(
    system.lightOutputBuffer, 0, system.stagingLights, 0,
    system.maxLights * LIGHT_STRIDE * 4,
  );
}

/**
 * Read back extracted lights from GPU (async, call after command buffer submit)
 * Returns array of { position: [x,y,z], radius, color: [r,g,b], intensity }
 */
export async function readbackParticleLights(system) {
  if (!system || system._readbackPending) return system.lights;
  system._readbackPending = true;

  try {
    // Map staging buffers
    await Promise.all([
      system.stagingCount.mapAsync(GPUMapMode.READ),
      system.stagingLights.mapAsync(GPUMapMode.READ),
    ]);

    const countData = new Uint32Array(system.stagingCount.getMappedRange());
    const count = Math.min(countData[0], system.maxLights);

    const lightData = new Float32Array(system.stagingLights.getMappedRange());
    const lights = [];

    for (let i = 0; i < count; i++) {
      const base = i * LIGHT_STRIDE;
      lights.push({
        position: [lightData[base], lightData[base + 1], lightData[base + 2]],
        radius: lightData[base + 3],
        color: [lightData[base + 4], lightData[base + 5], lightData[base + 6]],
        intensity: lightData[base + 7],
      });
    }

    system.stagingCount.unmap();
    system.stagingLights.unmap();
    system.lights = lights;
  } catch (e) {
    // Readback failed (GPU busy, buffer destroyed, etc.) — keep last known lights
  }

  system._readbackPending = false;
  return system.lights;
}

/**
 * Get the current particle lights (non-async, returns last readback result)
 */
export function getParticleLights(system) {
  return system?.lights || [];
}

/**
 * Destroy particle light system
 */
export function destroyParticleLightSystem(system) {
  if (!system) return;
  system.paramsBuffer?.destroy();
  system.lightOutputBuffer?.destroy();
  system.lightCountBuffer?.destroy();
  system.stagingLights?.destroy();
  system.stagingCount?.destroy();
  system.bindGroup = null;
  system.lights = [];
}
