// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Volumetric SDF Particle Renderer
 * 
 * Renders particles as raymarched volumetric shapes (spheres, ellipsoids, capsules, etc.)
 * Replaces flat billboards with true 3D volumes for realistic smoke, fire, and fluid effects.
 * 
 * THIS IS THE ACTIVE RENDERER — EditorParticles.js sets particles.pipeline = sdfRenderer.pipeline.
 * The billboard renderer (ParticleBillboardRenderer.js) exists but is NOT used.
 * 
 * RENDER PIPELINE:
 *   1. Particles render INTO a half-res texture via this pipeline (blend: src-alpha → pre-multiplied)
 *   2. ParticleHalfResComposite.js composites the half-res texture onto the scene (blend: one → pre-multiplied)
 *   See ParticleHalfResComposite.js header for full pipeline documentation.
 * 
 * DATA BIND GROUP (group 1):
 *   binding 0: positionBuffer  (storage, read) — xyz=pos, w=age
 *   binding 1: metaBuffer       (storage, read) — rgb=color, w=packed physics
 *   binding 2: paramsBuffer     (uniform) — defaultSize, quality, lodBias, cullThreshold
 *   binding 3: velocityBuffer   (storage, read) — xyz=vel, w=lifetime
 *   binding 4: thermalBuffer    (storage, read) — x=tempK, y=phase, z=group|mat, w=latent
 * 
 * DEPTH BIND GROUP (group 2):
 *   binding 0: depthTextureView — scene depth for soft particle fade
 *   NOTE: No alive list binding here (unlike billboard renderer). SDF uses instance_index directly.
 */

import { createStorageBuffer, createUniformBuffer, updateBuffer } from "../../core/gpu/GpuBuffer.js";
import { particlesSdfBillboardShader } from "../shaders/modules/core/particles_sdf_billboard.js";
import { 
  FRAME_UNIFORMS_SCHEMA, 
  PARTICLE_PARAMS_SCHEMA 
} from "../shaders/ShaderSchema.js";
import { initVGPU } from "../../core/gpu/VirtualGPU.js";
import { DynamicUniformBuffer } from "../../core/gpu/DynamicUniformBuffer.js";

// SDF FrameUniforms struct — single source of truth for both WGSL shader and CPU buffer.
// Add fields here and they are automatically sized + available via frameUniform.set('name', value).
export const SDF_FRAME_STRUCT = `struct FrameUniforms {
  viewProj: mat4x4<f32>,
  viewRight: vec3<f32>,
  _pad0: f32,
  viewUp: vec3<f32>,
  _pad1: f32,
  cameraPos: vec3<f32>,
  _pad2: f32,
  particleCount: u32,
  depthScaleX: f32,
  depthScaleY: f32,
  flags: u32,
  sunDir: vec3<f32>,
  sunIntensity: f32,
  sunColor: vec3<f32>,
  ambientIntensity: f32,
  ambientColor: vec3<f32>,
  time: f32,
  debugMode: f32,
  _padD0: f32,
  _padD1: f32,
  _padD2: f32,
}`;

/**
 * Create volumetric SDF particle renderer
 */
export async function createParticleSdfRenderer(options) {
  const { device, format = 'bgra8unorm', blendMode = 'alpha' } = options || {};
  if (!device) throw new Error("createParticleSdfRenderer: device required");

  const vgpu = initVGPU(device);
  
  console.log('[ParticleSdfRenderer] Compiling volumetric SDF shader...');
  const shaderModule = vgpu.shader.compile('particleSdf', particlesSdfBillboardShader);
  
  if (!shaderModule || shaderModule.constructor.name === 'GPUValidationError') {
    console.error('[ParticleSdfRenderer] Shader compilation FAILED');
    throw new Error('SDF particle shader compilation failed');
  }
  console.log('[ParticleSdfRenderer] Shader compiled successfully');

  // Define bind group layouts
  const frameLayout = vgpu.bindings.defineLayout('particleSdfFrame', [
    { binding: 0, type: 'uniform', visibility: 'vertex|fragment' },
  ]);
  const dataLayout = vgpu.bindings.defineLayout('particleSdfData', [
    { binding: 0, type: 'read-storage', visibility: 'vertex|fragment' }, // positions - fragment needs for multi-particle merging
    { binding: 1, type: 'read-storage', visibility: 'vertex|fragment' }, // meta - fragment needs for multi-particle merging
    { binding: 2, type: 'uniform', visibility: 'vertex|fragment' },
    { binding: 3, type: 'read-storage', visibility: 'vertex|fragment' }, // velocities - fragment needs for multi-particle merging
    { binding: 4, type: 'read-storage', visibility: 'vertex' },          // thermalData - vertex reads temperature for glow
    { binding: 5, type: 'read-storage', visibility: 'vertex' },          // sphDensity - vec2 per particle (density, pressure) for density-based sizing
    { binding: 6, type: 'read-storage', visibility: 'vertex|fragment' }, // classBuffer - u32 per particle: 0=none,1=bulk,2=surface,3=spray,4=foam,5=bubble
  ]);
  const depthLayout = vgpu.bindings.defineLayout('particleSdfDepth', [
    { binding: 0, type: 'texture', visibility: 'fragment', sampleType: 'depth', viewDimension: '2d' }, // scene depth for soft particles
  ]);
  // Combined LUT + six-way lighting layout (merged into group 3 to stay within maxBindGroups=4)
  const lutSixWayLayout = vgpu.bindings.defineLayout('particleSdfLutSixWay', [
    { binding: 0, type: 'texture', visibility: 'fragment', sampleType: 'float', viewDimension: '2d' }, // color gradient LUT
    { binding: 1, type: 'sampler', visibility: 'fragment' },
    { binding: 2, type: 'texture', visibility: 'fragment', sampleType: 'unfilterable-float', viewDimension: '2d' }, // lifetime curves LUT (rgba32float)
    { binding: 3, type: 'sampler', visibility: 'fragment', samplerType: 'non-filtering' },
    { binding: 4, type: 'texture', visibility: 'fragment', sampleType: 'float', viewDimension: '2d' }, // six-way right
    { binding: 5, type: 'texture', visibility: 'fragment', sampleType: 'float', viewDimension: '2d' }, // six-way left
    { binding: 6, type: 'texture', visibility: 'fragment', sampleType: 'float', viewDimension: '2d' }, // six-way top
    { binding: 7, type: 'texture', visibility: 'fragment', sampleType: 'float', viewDimension: '2d' }, // six-way bottom
    { binding: 8, type: 'texture', visibility: 'fragment', sampleType: 'float', viewDimension: '2d' }, // six-way front
    { binding: 9, type: 'texture', visibility: 'fragment', sampleType: 'float', viewDimension: '2d' }, // six-way back
    { binding: 10, type: 'sampler', visibility: 'fragment' }, // six-way sampler
    { binding: 11, type: 'uniform', visibility: 'fragment' }, // lightDirection + intensity
  ]);

  const mode = blendMode === "additive" ? "additive" : "alpha";
  const pipeline = vgpu.pipeline.render({
    vertex: { module: shaderModule, entryPoint: 'vs_main' },
    fragment: { module: shaderModule, entryPoint: 'fs_main' },
    layouts: [frameLayout, dataLayout, depthLayout, lutSixWayLayout],
    colorFormat: format,
    blend: mode === 'additive' ? 'additive' : 'alpha',
    cullMode: 'none',
    depthFormat: 'depth24plus',
    depthWrite: false,
    depthCompare: 'less-equal',
    topology: 'triangle-list',
    label: 'ParticleSdfPipeline'
  });

  // Auto-sized frame uniform buffer from WGSL struct (no hardcoded sizes)
  const frameUniform = new DynamicUniformBuffer(device, SDF_FRAME_STRUCT, 'ParticleSdfFrame');
  
  const paramsBuffer = vgpu.buffer.create({ 
    size: PARTICLE_PARAMS_SCHEMA.size, 
    usage: 'uniform', 
    label: 'ParticleSdfParams' 
  }).buffer;

  const frameBindGroup = vgpu.bindings.createGroup(frameLayout, [
    { binding: 0, buffer: frameUniform.buffer },
  ]);

  return {
    device,
    pipeline,
    frameUniform,               // DynamicUniformBuffer: use .set('field', value) + .upload()
    frameBuffer: frameUniform.buffer, // backward compat: raw GPUBuffer
    paramsBuffer,
    frameBindGroup,
    dataLayout,
    depthLayout,
    lutSixWayLayout,
  };
}

/**
 * Create data bind group for SDF particle world.
 * Binds the shared particle buffers (position, meta, velocity, thermal) to group 1.
 * The metaBuffer contains per-particle color at .rgb — written by ParticleEmitterSystem.js.
 * If thermalBuffer is missing, a fallback with room-temp defaults (293K) is created.
 */
export function createParticleSdfDataBindGroup(
  renderer,
  positionBuffer,
  metaBuffer,
  velocityBuffer,
  thermalBuffer,
  sphDensityBuffer,
  classBuffer
) {
  const vgpu = initVGPU(renderer.device);
  // Fallback: if no thermalBuffer provided, create a tiny one with room-temp defaults
  // Layout expects 6 bindings; missing bindings cause WebGPU validation error
  let thermal = thermalBuffer;
  if (!thermal) {
    if (!renderer._fallbackThermalBuffer) {
      renderer._fallbackThermalBuffer = createStorageBuffer(renderer.device, 16, {
        label: 'ParticleSdf.fallbackThermal',
      });
      updateBuffer(renderer.device, renderer._fallbackThermalBuffer,
        new Float32Array([293, 0, 0, 0]), 0); // 293K, solid, group 0, no fluid
    }
    thermal = renderer._fallbackThermalBuffer;
  }
  // Fallback: if no SPH density buffer, create a tiny one with zero density
  let density = sphDensityBuffer;
  if (!density) {
    if (!renderer._fallbackDensityBuffer) {
      renderer._fallbackDensityBuffer = createStorageBuffer(renderer.device, 8, {
        label: 'ParticleSdf.fallbackDensity',
      });
      updateBuffer(renderer.device, renderer._fallbackDensityBuffer,
        new Float32Array([0, 0]), 0); // zero density, zero pressure
    }
    density = renderer._fallbackDensityBuffer;
  }
  // Fallback: if no class buffer, create a tiny one with CLASS_NONE (0)
  let cls = classBuffer;
  if (!cls) {
    if (!renderer._fallbackClassBuffer) {
      renderer._fallbackClassBuffer = renderer.device.createBuffer({
        label: 'ParticleSdf.fallbackClass',
        size: 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      renderer.device.queue.writeBuffer(renderer._fallbackClassBuffer, 0, new Uint32Array([0]));
    }
    cls = renderer._fallbackClassBuffer;
  }
  const entries = [
    { binding: 0, buffer: positionBuffer },
    { binding: 1, buffer: metaBuffer },
    { binding: 2, buffer: renderer.paramsBuffer },
    { binding: 3, buffer: velocityBuffer },
    { binding: 4, buffer: thermal },
    { binding: 5, buffer: density },
    { binding: 6, buffer: cls },
  ];
  return vgpu.bindings.createGroup(renderer.dataLayout, entries);
}

/**
 * Create depth bind group for soft particles (scene depth texture).
 * Must be recreated when the depth texture changes (e.g. on resize).
 * Only binds depth texture (binding 0). Does NOT include alive list buffer —
 * the SDF vertex shader uses instance_index directly, unlike the billboard shader
 * which uses uAliveList for indirection.
 */
export function createParticleSdfDepthBindGroup(renderer, depthTextureView) {
  const vgpu = initVGPU(renderer.device);
  return vgpu.bindings.createGroup(renderer.depthLayout, [
    { binding: 0, textureView: depthTextureView },
  ]);
}

/**
 * Create combined LUT + six-way lighting bind group (group 3).
 * Bindings 0-3: color gradient + lifetime curves LUT textures.
 * Bindings 4-11: six directional lightmap textures + sampler + params.
 * Merged into one group to stay within WebGPU maxBindGroups=4.
 * @param {Object} renderer - SDF renderer
 * @param {GPUTextureView} colorGradientView - Color gradient RGBA8 texture view
 * @param {GPUSampler} colorGradientSampler - Linear sampler for gradient
 * @param {GPUTextureView} lifetimeCurvesView - Lifetime curves RGBA32float texture view
 * @param {GPUSampler} lifetimeCurvesSampler - Sampler for curves (non-filtering for rgba32float)
 * @param {Object} sixWaySystem - Six-way lighting system from ParticleSixWayLighting.js
 */
export function createParticleSdfLutSixWayBindGroup(
  renderer,
  colorGradientView,
  colorGradientSampler,
  lifetimeCurvesView,
  lifetimeCurvesSampler,
  sixWaySystem
) {
  const vgpu = initVGPU(renderer.device);
  return vgpu.bindings.createGroup(renderer.lutSixWayLayout, [
    { binding: 0, textureView: colorGradientView },
    { binding: 1, sampler: colorGradientSampler },
    { binding: 2, textureView: lifetimeCurvesView },
    { binding: 3, sampler: lifetimeCurvesSampler },
    { binding: 4, textureView: sixWaySystem.views.right },
    { binding: 5, textureView: sixWaySystem.views.left },
    { binding: 6, textureView: sixWaySystem.views.top },
    { binding: 7, textureView: sixWaySystem.views.bottom },
    { binding: 8, textureView: sixWaySystem.views.front },
    { binding: 9, textureView: sixWaySystem.views.back },
    { binding: 10, sampler: sixWaySystem.sampler },
    { binding: 11, buffer: sixWaySystem.paramsBuffer },
  ]);
}

/**
 * Update SDF particle rendering parameters
 */
export function setParticleSdfParams(renderer, { 
  size = 1, 
  quality = 1.0, 
  lodBias = 1.0, 
  cullThreshold = 0 
}) {
  const params = new Float32Array(4);
  params[0] = size;
  params[1] = Math.max(0, Math.min(1, quality));
  params[2] = Math.max(0.5, Math.min(3, lodBias));
  params[3] = cullThreshold;
  updateBuffer(renderer.device, renderer.paramsBuffer, params, 0);
}
