// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * UnifiedVolumeRenderer.js - Multi-mode Volumetric Renderer
 * 
 * Renders density grids from HybridVolumeSystem with multiple modes:
 * - SMOKE: Volumetric absorption/scattering with physically-based lighting
 * - WATER: Isosurface extraction with refraction and reflection
 * - HYBRID: Distance-based LOD between particles and volume
 * 
 * Uses the same density/color grids but different fragment shaders per mode.
 */

import { initVGPU } from '../../core/gpu/VirtualGPU.js';
import { VolumeRenderMode } from './HybridVolumeSystem.js';
import { mat4Inverse } from '../../core/math/EngineMath.js';

// Unified volume shader with mode switching
const unifiedVolumeWGSL = /* wgsl */`
// Disable uniformity analysis for textureSample in non-uniform control flow
diagnostic(off, derivative_uniformity);

const PI: f32 = 3.14159265359;

struct FrameData {
  viewProj: mat4x4<f32>,
  invViewProj: mat4x4<f32>,
  cameraPos: vec3<f32>,
  time: f32,
  volumeMin: vec3<f32>,
  densityScale: f32,
  volumeMax: vec3<f32>,
  extinction: f32,
  resolution: vec3<f32>,
  renderMode: f32,
  // Water params
  isoThreshold: f32,
  refractionIndex: f32,
  reflectivity: f32,
  waterTint: f32,
  // Additional
  sunDir: vec3<f32>,
  _pad0: f32,
  sunColor: vec3<f32>,
  _pad1: f32,
};

struct VSOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@group(0) @binding(0) var<uniform> frame: FrameData;
@group(1) @binding(0) var<storage, read> densityField: array<f32>;
@group(1) @binding(1) var<storage, read> colorField: array<vec4<f32>>;
@group(2) @binding(0) var sceneColor: texture_2d<f32>;
@group(2) @binding(1) var sceneDepth: texture_depth_2d;
@group(2) @binding(2) var sceneSampler: sampler;

const MAX_STEPS: u32 = 96u;
const SHADOW_STEPS: u32 = 8u;

// =============================================================================
// VERTEX SHADER
// =============================================================================

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VSOut {
  var pos = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(3.0, -1.0),
    vec2<f32>(-1.0, 3.0),
  );
  var out: VSOut;
  out.position = vec4<f32>(pos[vertexIndex], 0.0, 1.0);
  out.uv = pos[vertexIndex] * 0.5 + 0.5;
  return out;
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

fn hash3d(p: vec3<f32>) -> f32 {
  var p3 = fract(p * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

fn intersectBox(ro: vec3<f32>, rd: vec3<f32>, boxMin: vec3<f32>, boxMax: vec3<f32>) -> vec2<f32> {
  let eps = 0.0001;
  let invRd = vec3<f32>(
    select(1.0 / rd.x, 1e10 * sign(rd.x + eps), abs(rd.x) < eps),
    select(1.0 / rd.y, 1e10 * sign(rd.y + eps), abs(rd.y) < eps),
    select(1.0 / rd.z, 1e10 * sign(rd.z + eps), abs(rd.z) < eps)
  );
  let t0 = (boxMin - ro) * invRd;
  let t1 = (boxMax - ro) * invRd;
  let tmin = min(t0, t1);
  let tmax = max(t0, t1);
  let tNear = max(max(tmin.x, tmin.y), tmin.z);
  let tFar = min(min(tmax.x, tmax.y), tmax.z);
  return vec2<f32>(max(tNear, 0.0), tFar);
}

// =============================================================================
// DENSITY SAMPLING
// =============================================================================

fn sampleDensityRaw(cellCoord: vec3<i32>) -> f32 {
  let res = vec3<i32>(frame.resolution);
  let c = clamp(cellCoord, vec3<i32>(0), res - 1);
  let idx = c.x + c.y * res.x + c.z * res.x * res.y;
  if (u32(idx) >= arrayLength(&densityField)) {
    return 0.0;
  }
  return densityField[idx];
}

fn sampleDensity(worldPos: vec3<f32>) -> f32 {
  let volumeSize = frame.volumeMax - frame.volumeMin;
  let normalized = (worldPos - frame.volumeMin) / volumeSize;
  
  if (any(normalized < vec3<f32>(0.0)) || any(normalized > vec3<f32>(1.0))) {
    return 0.0;
  }
  
  let gridPos = normalized * frame.resolution - 0.5;
  let cellMin = vec3<i32>(floor(gridPos));
  let f = fract(gridPos);
  
  // Trilinear interpolation
  let d000 = sampleDensityRaw(cellMin + vec3<i32>(0, 0, 0));
  let d100 = sampleDensityRaw(cellMin + vec3<i32>(1, 0, 0));
  let d010 = sampleDensityRaw(cellMin + vec3<i32>(0, 1, 0));
  let d110 = sampleDensityRaw(cellMin + vec3<i32>(1, 1, 0));
  let d001 = sampleDensityRaw(cellMin + vec3<i32>(0, 0, 1));
  let d101 = sampleDensityRaw(cellMin + vec3<i32>(1, 0, 1));
  let d011 = sampleDensityRaw(cellMin + vec3<i32>(0, 1, 1));
  let d111 = sampleDensityRaw(cellMin + vec3<i32>(1, 1, 1));
  
  let d00 = mix(d000, d100, f.x);
  let d10 = mix(d010, d110, f.x);
  let d01 = mix(d001, d101, f.x);
  let d11 = mix(d011, d111, f.x);
  
  let d0 = mix(d00, d10, f.y);
  let d1 = mix(d01, d11, f.y);
  
  return mix(d0, d1, f.z);
}

fn sampleColorRaw(cellCoord: vec3<i32>) -> vec4<f32> {
  let res = vec3<i32>(frame.resolution);
  let c = clamp(cellCoord, vec3<i32>(0), res - 1);
  let idx = c.x + c.y * res.x + c.z * res.x * res.y;
  if (u32(idx) >= arrayLength(&colorField)) {
    return vec4<f32>(1.0, 1.0, 1.0, 0.0);
  }
  return colorField[idx];
}

fn sampleColor(worldPos: vec3<f32>) -> vec3<f32> {
  let volumeSize = frame.volumeMax - frame.volumeMin;
  let normalized = (worldPos - frame.volumeMin) / volumeSize;
  
  if (any(normalized < vec3<f32>(0.0)) || any(normalized > vec3<f32>(1.0))) {
    return vec3<f32>(1.0);
  }
  
  let gridPos = normalized * frame.resolution - 0.5;
  let cellMin = vec3<i32>(floor(gridPos));
  let f = fract(gridPos);
  
  // Trilinear interpolation for color
  let c000 = sampleColorRaw(cellMin + vec3<i32>(0, 0, 0));
  let c100 = sampleColorRaw(cellMin + vec3<i32>(1, 0, 0));
  let c010 = sampleColorRaw(cellMin + vec3<i32>(0, 1, 0));
  let c110 = sampleColorRaw(cellMin + vec3<i32>(1, 1, 0));
  let c001 = sampleColorRaw(cellMin + vec3<i32>(0, 0, 1));
  let c101 = sampleColorRaw(cellMin + vec3<i32>(1, 0, 1));
  let c011 = sampleColorRaw(cellMin + vec3<i32>(0, 1, 1));
  let c111 = sampleColorRaw(cellMin + vec3<i32>(1, 1, 1));
  
  let c00 = mix(c000, c100, f.x);
  let c10 = mix(c010, c110, f.x);
  let c01 = mix(c001, c101, f.x);
  let c11 = mix(c011, c111, f.x);
  
  let c0 = mix(c00, c10, f.y);
  let c1 = mix(c01, c11, f.y);
  
  let c = mix(c0, c1, f.z);
  let weight = c.a;
  
  if (weight < 0.001) {
    return vec3<f32>(1.0);
  }
  return c.rgb / weight;
}

fn estimateNormal(worldPos: vec3<f32>) -> vec3<f32> {
  let cellSize = (frame.volumeMax - frame.volumeMin) / frame.resolution;
  let eps = max(0.25 * min(min(cellSize.x, cellSize.y), cellSize.z), 0.001);
  let dx = sampleDensity(worldPos + vec3<f32>(eps, 0.0, 0.0)) - sampleDensity(worldPos - vec3<f32>(eps, 0.0, 0.0));
  let dy = sampleDensity(worldPos + vec3<f32>(0.0, eps, 0.0)) - sampleDensity(worldPos - vec3<f32>(0.0, eps, 0.0));
  let dz = sampleDensity(worldPos + vec3<f32>(0.0, 0.0, eps)) - sampleDensity(worldPos - vec3<f32>(0.0, 0.0, eps));
  return normalize(vec3<f32>(dx, dy, dz));
}

// =============================================================================
// LIGHTING
// =============================================================================

fn phaseHG(cosTheta: f32, g: f32) -> f32 {
  let g2 = g * g;
  let denom = 1.0 + g2 - 2.0 * g * cosTheta;
  return (1.0 - g2) / (4.0 * PI * pow(max(denom, 0.0001), 1.5));
}

fn lightMarchSmoke(pos: vec3<f32>, lightDir: vec3<f32>) -> f32 {
  let stepSize = length(frame.volumeMax - frame.volumeMin) / f32(SHADOW_STEPS) * 0.5;
  var shadowDensity = 0.0;
  var p = pos;
  
  for (var i = 0u; i < SHADOW_STEPS; i++) {
    p = p + lightDir * stepSize;
    shadowDensity += sampleDensity(p) * stepSize;
  }
  
  return exp(-shadowDensity * 2.0);
}

// =============================================================================
// SMOKE RENDERING
// =============================================================================

fn renderSmoke(ro: vec3<f32>, rd: vec3<f32>, tMin: f32, tMax: f32) -> vec4<f32> {
  let rayLength = tMax - tMin;
  let stepSize = rayLength / f32(MAX_STEPS);
  
  // Jitter to reduce banding
  let jitter = hash3d(vec3<f32>(ro.xy * 100.0, frame.time)) * stepSize;
  
  var transmittance = 1.0;
  var scatteredLight = vec3<f32>(0.0);
  var t = tMin + jitter;
  
  let sunDir = normalize(frame.sunDir);
  let sunColor = frame.sunColor;
  let ambientColor = vec3<f32>(0.4, 0.5, 0.6) * 0.5;
  
  for (var i = 0u; i < MAX_STEPS; i++) {
    if (t >= tMax || transmittance < 0.01) {
      break;
    }
    
    let pos = ro + rd * t;
    let density = sampleDensity(pos) * frame.densityScale;
    
    if (density > 0.001) {
      let smokeColor = sampleColor(pos);
      
      // Extinction
      let sampleExtinction = density * frame.extinction * stepSize;
      let sampleTransmittance = exp(-sampleExtinction);
      
      // Lighting
      let lightTransmit = lightMarchSmoke(pos, sunDir);
      let cosTheta = dot(rd, sunDir);
      let phase = phaseHG(cosTheta, 0.4);
      
      let directLight = sunColor * lightTransmit * phase;
      let ambient = ambientColor;
      let luminance = (directLight + ambient) * density * smokeColor;
      
      // Integrate
      let integScatter = luminance * (1.0 - sampleTransmittance) / max(sampleExtinction, 0.0001);
      scatteredLight += transmittance * integScatter * stepSize;
      transmittance *= sampleTransmittance;
    }
    
    t += stepSize;
  }
  
  let alpha = 1.0 - transmittance;
  let finalColor = scatteredLight / (scatteredLight + 1.0);  // Tone mapping
  
  return vec4<f32>(finalColor, alpha);
}

// =============================================================================
// WATER RENDERING (ISOSURFACE)
// =============================================================================

fn renderWater(ro: vec3<f32>, rd: vec3<f32>, tMin: f32, tMax: f32, screenUV: vec2<f32>) -> vec4<f32> {
  let threshold = frame.isoThreshold;
  let dt = (tMax - tMin) / f32(MAX_STEPS);
  
  var t = tMin;
  var prevD = sampleDensity(ro + rd * t);
  var found = false;
  var tHit = t;
  
  // Find isosurface crossing
  for (var i = 0u; i < MAX_STEPS; i++) {
    if (t >= tMax) { break; }
    t += dt;
    let d = sampleDensity(ro + rd * t);
    if (prevD < threshold && d >= threshold) {
      found = true;
      tHit = t;
      break;
    }
    prevD = d;
  }
  
  if (!found) {
    return vec4<f32>(0.0);
  }
  
  // Binary search for exact crossing
  var tLo = max(tMin, tHit - dt);
  var tHi = tHit;
  for (var j = 0u; j < 5u; j++) {
    let tm = 0.5 * (tLo + tHi);
    let dm = sampleDensity(ro + tm * rd);
    if (dm >= threshold) {
      tHi = tm;
    } else {
      tLo = tm;
    }
  }
  
  let hitPos = ro + rd * tHi;
  let normal = estimateNormal(hitPos);
  
  // Fresnel
  let viewDir = -rd;
  let NdotV = max(dot(normal, viewDir), 0.0);
  let fresnel = pow(1.0 - NdotV, 5.0) * 0.9 + 0.1;
  
  // Reflection
  let reflectDir = reflect(rd, normal);
  let skyColor = mix(vec3<f32>(0.4, 0.6, 0.9), vec3<f32>(0.8, 0.9, 1.0), reflectDir.y * 0.5 + 0.5);
  let reflectColor = skyColor * frame.reflectivity;
  
  // Refraction (sample scene behind)
  // Use textureSampleLevel to avoid non-uniform control flow issues
  let refractDir = refract(rd, normal, 1.0 / frame.refractionIndex);
  let refractOffset = normal.xy * 0.05;
  let refractUV = clamp(screenUV + refractOffset, vec2<f32>(0.0), vec2<f32>(1.0));
  let sceneSample = textureSampleLevel(sceneColor, sceneSampler, refractUV, 0.0).rgb;
  
  // Water tint
  let waterTint = mix(vec3<f32>(1.0), vec3<f32>(0.2, 0.5, 0.8), frame.waterTint);
  let refractColor = sceneSample * waterTint;
  
  // Blend reflection and refraction
  let finalColor = mix(refractColor, reflectColor, fresnel);
  
  // Specular highlight
  let sunDir = normalize(frame.sunDir);
  let halfVec = normalize(sunDir + viewDir);
  let spec = pow(max(dot(normal, halfVec), 0.0), 64.0);
  let specColor = frame.sunColor * spec * 0.5;
  
  return vec4<f32>(finalColor + specColor, 1.0);
}

// =============================================================================
// DEBUG DENSITY
// =============================================================================

fn renderDebugDensity(ro: vec3<f32>, rd: vec3<f32>, tMin: f32, tMax: f32) -> vec4<f32> {
  var maxDensity = 0.0;
  let steps = 32u;
  let dt = (tMax - tMin) / f32(steps);
  var t = tMin;
  
  for (var i = 0u; i < steps; i++) {
    let pos = ro + rd * t;
    let d = sampleDensity(pos);
    maxDensity = max(maxDensity, d);
    t += dt;
  }
  
  // Color map density
  let normalized = clamp(maxDensity * frame.densityScale, 0.0, 1.0);
  let color = mix(vec3<f32>(0.0, 0.0, 0.5), vec3<f32>(1.0, 0.0, 0.0), normalized);
  
  return vec4<f32>(color, normalized);
}

// =============================================================================
// FRAGMENT SHADER
// =============================================================================

@fragment
fn fs_main(input: VSOut) -> @location(0) vec4<f32> {
  // Ray setup
  let ndcX = input.uv.x * 2.0 - 1.0;
  let ndcY = input.uv.y * 2.0 - 1.0;
  
  let clipFar = vec4<f32>(ndcX, ndcY, 1.0, 1.0);
  var worldFar = frame.invViewProj * clipFar;
  worldFar = worldFar / worldFar.w;
  
  let ro = frame.cameraPos;
  let rd = normalize(worldFar.xyz - ro);
  
  // Intersect volume
  let hit = intersectBox(ro, rd, frame.volumeMin, frame.volumeMax);
  var tMin = hit.x;
  var tMax = hit.y;
  
  if (tMax <= tMin) {
    return vec4<f32>(0.0);
  }
  
  // Depth test
  let pixelCoord = vec2<i32>(i32(input.position.x), i32(input.position.y));
  let depth = textureLoad(sceneDepth, pixelCoord, 0);
  if (depth > 0.0 && depth < 1.0) {
    let clipZ = depth;
    let clipDepth = vec4<f32>(ndcX, ndcY, clipZ, 1.0);
    var worldDepth = frame.invViewProj * clipDepth;
    worldDepth = worldDepth / worldDepth.w;
    let tDepth = dot(worldDepth.xyz - ro, rd);
    tMax = min(tMax, tDepth);
  }
  
  if (tMax <= tMin) {
    return vec4<f32>(0.0);
  }
  
  // Render based on mode
  let mode = u32(frame.renderMode);
  
  switch (mode) {
    case 0u: {  // SMOKE
      return renderSmoke(ro, rd, tMin, tMax);
    }
    case 1u: {  // WATER
      return renderWater(ro, rd, tMin, tMax, input.uv);
    }
    case 5u: {  // DEBUG_DENSITY
      return renderDebugDensity(ro, rd, tMin, tMax);
    }
    default: {
      return renderSmoke(ro, rd, tMin, tMax);
    }
  }
}
`;

export class UnifiedVolumeRenderer {
  /**
   * @param {GPUDevice} device
   * @param {Object} options
   */
  constructor(device, options = {}) {
    this.device = device;
    this.vgpu = initVGPU(device);
    
    this.format = options.format || 'bgra8unorm';
    this.width = options.width || 1920;
    this.height = options.height || 1080;
    
    // Frame uniform data
    this.frameData = new Float32Array(64);
    
    // GPU resources
    this.pipeline = null;
    this.frameBuffer = null;
    this.sampler = null;
    
    // Bind groups
    this.frameBindGroup = null;
    this.dataBindGroup = null;
    this.sceneBindGroup = null;
    
    // Configuration
    this.renderMode = VolumeRenderMode.SMOKE;
    this.densityScale = 1.0;
    this.extinction = 2.0;
    this.isoThreshold = 0.3;
    this.refractionIndex = 1.33;  // Water
    this.reflectivity = 0.5;
    this.waterTint = 0.5;
    this.sunDir = [0.3, 1.0, 0.2];
    this.sunColor = [1.0, 0.95, 0.85];
    
    // Volume bounds (updated from HybridVolumeSystem each frame)
    this.volumeMin = [-1000, -1000, -1000];
    this.volumeMax = [1000, 1000, 1000];
    this.resolution = 128;
    
    this.initialized = false;
  }
  
  async init() {
    if (this.initialized) return;
    
    // Compile shader
    const shaderModule = this.vgpu.shader.compile('unifiedVolume', unifiedVolumeWGSL);
    
    // Define layouts
    const frameLayout = this.vgpu.bindings.defineLayout('uvFrame', [
      { binding: 0, type: 'uniform', visibility: 'vertex|fragment' },
    ]);
    
    const dataLayout = this.vgpu.bindings.defineLayout('uvData', [
      { binding: 0, type: 'read-storage', visibility: 'fragment' },  // density
      { binding: 1, type: 'read-storage', visibility: 'fragment' },  // color
    ]);
    
    const sceneLayout = this.vgpu.bindings.defineLayout('uvScene', [
      { binding: 0, type: 'texture', visibility: 'fragment', sampleType: 'float' },
      { binding: 1, type: 'texture', visibility: 'fragment', sampleType: 'depth' },
      { binding: 2, type: 'sampler', visibility: 'fragment' },
    ]);
    
    // Create pipeline - must match render pass depth format
    this.pipeline = this.vgpu.pipeline.render({
      vertex: { module: shaderModule, entryPoint: 'vs_main' },
      fragment: { module: shaderModule, entryPoint: 'fs_main' },
      layouts: [frameLayout, dataLayout, sceneLayout],
      colorFormat: this.format,
      blend: 'alpha',
      cullMode: 'none',
      depthFormat: 'depth24plus',  // Match render pass depth attachment
      depthWriteEnabled: false,    // Don't write to depth
      depthCompare: 'always',      // Always pass depth test (render on top)
      label: 'UnifiedVolumePipeline'
    });
    
    // Create frame buffer
    this.frameBuffer = this.vgpu.buffer.create({
      size: 256,
      usage: 'uniform',
      label: 'UnifiedVolumeFrame'
    }).buffer;
    
    // Create sampler
    this.sampler = this.vgpu.texture.sampler({
      filter: 'linear',
      addressMode: 'clamp-to-edge'
    });
    
    // Create frame bind group
    this.frameBindGroup = this.vgpu.bindings.createGroup(frameLayout, [
      { binding: 0, buffer: this.frameBuffer },
    ]);
    
    this.frameLayout = frameLayout;
    this.dataLayout = dataLayout;
    this.sceneLayout = sceneLayout;
    
    // Create dummy scene textures for smoke mode (doesn't need real scene)
    this.dummyColorTexture = this.device.createTexture({
      size: [4, 4],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      label: 'DummySceneColor'
    });
    this.dummyDepthTexture = this.device.createTexture({
      size: [4, 4],
      format: 'depth24plus',
      usage: GPUTextureUsage.TEXTURE_BINDING,
      label: 'DummySceneDepth'
    });
    
    // Create default scene bind group with dummy textures
    this.sceneBindGroup = this.vgpu.bindings.createGroup(sceneLayout, [
      { binding: 0, textureView: this.dummyColorTexture.createView() },
      { binding: 1, textureView: this.dummyDepthTexture.createView() },
      { binding: 2, sampler: this.sampler },
    ]);
    
    this.initialized = true;
    console.log('[UnifiedVolumeRenderer] Initialized');
  }
  
  /**
   * Set volume data from HybridVolumeSystem
   */
  setVolumeData(hybridSystem) {
    if (!this.initialized) return;
    
    const bounds = hybridSystem.getVolumeBounds();
    this.volumeMin = bounds.min;
    this.volumeMax = bounds.max;
    this.resolution = bounds.resolution;
    
    // Create data bind group
    this.dataBindGroup = this.vgpu.bindings.createGroup(this.dataLayout, [
      { binding: 0, buffer: hybridSystem.getDensityBuffer() },
      { binding: 1, buffer: hybridSystem.getColorBuffer() },
    ]);
  }
  
  /**
   * Set scene textures for compositing
   */
  setSceneTextures(colorTexture, depthTexture) {
    if (!this.initialized) return;
    
    this.sceneBindGroup = this.vgpu.bindings.createGroup(this.sceneLayout, [
      { binding: 0, textureView: colorTexture.createView() },
      { binding: 1, textureView: depthTexture.createView() },
      { binding: 2, sampler: this.sampler },
    ]);
  }
  
  /**
   * Update frame uniforms
   */
  updateUniforms(camera) {
    const data = this.frameData;
    
    // viewProj (mat4x4) - 16 floats
    if (camera.viewProj) {
      for (let i = 0; i < 16; i++) {
        data[i] = camera.viewProj[i];
      }
    }
    
    // invViewProj (mat4x4) - 16 floats
    if (camera.invViewProj) {
      for (let i = 0; i < 16; i++) {
        data[16 + i] = camera.invViewProj[i];
      }
    } else if (camera.viewProj) {
      const inv = mat4Inverse(camera.viewProj);
      for (let i = 0; i < 16; i++) {
        data[16 + i] = inv[i];
      }
    }
    
    // cameraPos + time
    data[32] = camera.position?.[0] || 0;
    data[33] = camera.position?.[1] || 0;
    data[34] = camera.position?.[2] || 0;
    data[35] = performance.now() * 0.001;
    
    // volumeMin + densityScale
    data[36] = this.volumeMin[0];
    data[37] = this.volumeMin[1];
    data[38] = this.volumeMin[2];
    data[39] = this.densityScale;
    
    // volumeMax + extinction
    data[40] = this.volumeMax[0];
    data[41] = this.volumeMax[1];
    data[42] = this.volumeMax[2];
    data[43] = this.extinction;
    
    // resolution + renderMode
    data[44] = this.resolution;
    data[45] = this.resolution;
    data[46] = this.resolution;
    data[47] = this.renderMode;
    
    // Water params
    data[48] = this.isoThreshold;
    data[49] = this.refractionIndex;
    data[50] = this.reflectivity;
    data[51] = this.waterTint;
    
    // Sun direction + pad
    data[52] = this.sunDir[0];
    data[53] = this.sunDir[1];
    data[54] = this.sunDir[2];
    data[55] = 0;
    
    // Sun color + pad
    data[56] = this.sunColor[0];
    data[57] = this.sunColor[1];
    data[58] = this.sunColor[2];
    data[59] = 0;
    
    this.device.queue.writeBuffer(this.frameBuffer, 0, data);
  }
  
  /**
   * Render volume
   */
  render(pass) {
    if (!this.initialized || !this.dataBindGroup || !this.sceneBindGroup) {
      return;
    }
    
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.frameBindGroup);
    pass.setBindGroup(1, this.dataBindGroup);
    pass.setBindGroup(2, this.sceneBindGroup);
    pass.draw(3);
  }
  
  /**
   * Set render mode
   */
  setRenderMode(mode) {
    this.renderMode = mode;
  }
  
  /**
   * Configure smoke rendering
   */
  configureSmokeMode(options = {}) {
    this.renderMode = VolumeRenderMode.SMOKE;
    this.densityScale = options.densityScale ?? 1.0;
    this.extinction = options.extinction ?? 2.0;
    if (options.sunDir) this.sunDir = options.sunDir;
    if (options.sunColor) this.sunColor = options.sunColor;
  }
  
  /**
   * Configure water rendering
   */
  configureWaterMode(options = {}) {
    this.renderMode = VolumeRenderMode.WATER;
    this.isoThreshold = options.isoThreshold ?? 0.3;
    this.refractionIndex = options.refractionIndex ?? 1.33;
    this.reflectivity = options.reflectivity ?? 0.5;
    this.waterTint = options.waterTint ?? 0.5;
  }
  
  /**
   * Resize
   */
  resize(width, height) {
    this.width = width;
    this.height = height;
  }
  
  /**
   * Cleanup
   */
  destroy() {
    this.frameBuffer?.destroy();
    this.initialized = false;
  }
}

export default UnifiedVolumeRenderer;
