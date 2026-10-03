// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ParticleDecalRenderer.js - Render projected decals from particle collisions
 * 
 * Renders decal quads at particle impact points (scorch marks, frost patches,
 * wet splats). Reads from ParticleDecalSpawner's CPU-side pool each frame.
 * 
 * Pipeline:
 *   1. ParticleDecalSpawner (sim/) creates decal descriptors from collision events
 *   2. This renderer uploads active decals to a GPU storage buffer
 *   3. Instanced draw: each decal = screen-aligned quad projected onto surface
 *   4. Blends onto scene with src-alpha / one-minus-src-alpha
 * 
 * Decal data per instance (12 floats):
 *   [posX, posY, posZ, size, normX, normY, normZ, age/lifetime, r, g, b, a]
 */

import { initVGPU } from "../../core/gpu/VirtualGPU.js";

const MAX_DECALS = 200;
const FLOATS_PER_DECAL = 12;

const DECAL_SHADER = /* wgsl */`
struct FrameUniforms {
  viewProj: mat4x4<f32>,
  viewRight: vec3<f32>,
  _pad0: f32,
  viewUp: vec3<f32>,
  _pad1: f32,
};

struct DecalData {
  // posX, posY, posZ, size, normX, normY, normZ, fadeT, r, g, b, a
  data: array<vec4<f32>>,
};

struct DecalParams {
  decalCount: u32,
  _pad: vec3<u32>,
};

@group(0) @binding(0) var<uniform> uFrame: FrameUniforms;
@group(1) @binding(0) var<storage, read> uDecals: DecalData;
@group(1) @binding(1) var<uniform> uParams: DecalParams;

struct VSOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) color: vec4<f32>,
  @location(2) fadeT: f32,
};

@vertex
fn vs_main(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VSOut {
  var out: VSOut;
  
  if (ii >= uParams.decalCount) {
    out.position = vec4<f32>(0.0, 0.0, -2.0, 1.0);
    out.uv = vec2<f32>(0.0);
    out.color = vec4<f32>(0.0);
    out.fadeT = 1.0;
    return out;
  }
  
  // Read decal data: 3 vec4s per decal
  let d0 = uDecals.data[ii * 3u + 0u]; // pos.xyz, size
  let d1 = uDecals.data[ii * 3u + 1u]; // normal.xyz, fadeT
  let d2 = uDecals.data[ii * 3u + 2u]; // color rgba
  
  let center = d0.xyz;
  let size = d0.w;
  let normal = normalize(d1.xyz);
  let fadeT = d1.w;
  let color = d2;
  
  // Build tangent frame from surface normal
  var tangent: vec3<f32>;
  if (abs(normal.y) > 0.9) {
    tangent = normalize(cross(normal, vec3<f32>(1.0, 0.0, 0.0)));
  } else {
    tangent = normalize(cross(normal, vec3<f32>(0.0, 1.0, 0.0)));
  }
  let bitangent = normalize(cross(normal, tangent));
  
  // Quad corners
  var corners = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0),
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, 1.0), vec2<f32>(-1.0, 1.0),
  );
  let corner = corners[vi % 6u];
  
  // Project quad onto surface plane
  let halfSize = size * 0.5;
  let worldOffset = tangent * corner.x * halfSize + bitangent * corner.y * halfSize;
  // Slight offset along normal to avoid z-fighting
  let worldPos = center + worldOffset + normal * 0.01;
  
  out.position = uFrame.viewProj * vec4<f32>(worldPos, 1.0);
  out.uv = corner * 0.5 + 0.5;
  out.color = color;
  out.fadeT = fadeT;
  return out;
}

@fragment
fn fs_main(input: VSOut) -> @location(0) vec4<f32> {
  // Radial falloff from center
  let dist = length(input.uv - vec2<f32>(0.5));
  if (dist > 0.5) { discard; }
  
  let radialFade = 1.0 - smoothstep(0.3, 0.5, dist);
  
  // Age fade: starts at 1.0 (fresh), approaches 0.0 near death
  let ageFade = 1.0 - smoothstep(0.6, 1.0, input.fadeT);
  
  let alpha = input.color.a * radialFade * ageFade;
  if (alpha < 0.01) { discard; }
  
  return vec4<f32>(input.color.rgb, alpha);
}
`;

/**
 * Create a decal rendering system
 * @param {GPUDevice} device
 * @param {string} format - Render target format
 */
export function createDecalRenderer(device, format) {
  const vgpu = initVGPU(device);
  
  const shaderModule = vgpu.shader.compile('particleDecals', DECAL_SHADER);
  
  const frameLayout = vgpu.bindings.defineLayout('decalFrame', [
    { binding: 0, type: 'uniform', visibility: 'vertex' },
  ]);
  const dataLayout = vgpu.bindings.defineLayout('decalData', [
    { binding: 0, type: 'read-storage', visibility: 'vertex' },
    { binding: 1, type: 'uniform', visibility: 'vertex' },
  ]);
  
  const pipeline = vgpu.pipeline.render({
    vertex: { module: shaderModule, entryPoint: 'vs_main' },
    fragment: { module: shaderModule, entryPoint: 'fs_main' },
    layouts: [frameLayout, dataLayout],
    colorFormat: format,
    blend: 'alpha',
    cullMode: 'none',
    depthFormat: 'depth24plus',
    depthWrite: false,
    depthCompare: 'less-equal',
    topology: 'triangle-list',
    label: 'ParticleDecalPipeline',
  });
  
  // Frame uniforms buffer (viewProj + view vectors)
  const frameBuffer = vgpu.buffer.create({
    size: 96, // mat4x4 + vec3+pad + vec3+pad
    usage: 'uniform',
    label: 'DecalFrame',
  }).buffer;
  
  // Decal storage buffer: MAX_DECALS × 3 vec4s = MAX_DECALS × 48 bytes
  const decalBuffer = device.createBuffer({
    label: 'DecalData',
    size: MAX_DECALS * FLOATS_PER_DECAL * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  
  // Params uniform (decal count)
  const paramsBuffer = device.createBuffer({
    label: 'DecalParams',
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  
  const frameBindGroup = vgpu.bindings.createGroup(frameLayout, [
    { binding: 0, buffer: frameBuffer },
  ]);
  const dataBindGroup = vgpu.bindings.createGroup(dataLayout, [
    { binding: 0, buffer: decalBuffer },
    { binding: 1, buffer: paramsBuffer },
  ]);
  
  // CPU-side upload buffer (reused each frame)
  const _uploadData = new Float32Array(MAX_DECALS * FLOATS_PER_DECAL);
  const _paramsData = new Uint32Array(4);
  
  return {
    device,
    pipeline,
    frameBuffer,
    decalBuffer,
    paramsBuffer,
    frameBindGroup,
    dataBindGroup,
    _uploadData,
    _paramsData,
    maxDecals: MAX_DECALS,
    currentCount: 0,
  };
}

/**
 * Upload active decals from the CPU-side spawner pool to GPU
 * @param {Object} renderer
 * @param {Array} decals - From getActiveDecals(spawner)
 */
export function uploadDecals(renderer, decals) {
  if (!renderer?.device || !decals) return;
  
  const count = Math.min(decals.length, renderer.maxDecals);
  renderer.currentCount = count;
  if (count === 0) return;
  
  const data = renderer._uploadData;
  for (let i = 0; i < count; i++) {
    const d = decals[i];
    const base = i * FLOATS_PER_DECAL;
    // vec4: pos.xyz, size
    data[base + 0] = d.position[0];
    data[base + 1] = d.position[1];
    data[base + 2] = d.position[2];
    data[base + 3] = d.size;
    // vec4: normal.xyz, fadeT (age/lifetime)
    data[base + 4] = d.normal[0];
    data[base + 5] = d.normal[1];
    data[base + 6] = d.normal[2];
    data[base + 7] = d.lifetime > 0 ? d.age / d.lifetime : 1.0;
    // vec4: color rgba
    data[base + 8] = d.color[0];
    data[base + 9] = d.color[1];
    data[base + 10] = d.color[2];
    data[base + 11] = d.color[3] ?? 1.0;
  }
  
  renderer.device.queue.writeBuffer(renderer.decalBuffer, 0, data, 0, count * FLOATS_PER_DECAL);
  
  // Update count param
  renderer._paramsData[0] = count;
  renderer.device.queue.writeBuffer(renderer.paramsBuffer, 0, renderer._paramsData);
}

/**
 * Render decals into the current render pass
 * @param {GPURenderPassEncoder} pass
 * @param {Object} renderer
 * @param {Float32Array} frameData - Frame uniforms (viewProj + viewRight + viewUp)
 */
export function renderDecals(pass, renderer, frameData) {
  if (!renderer || renderer.currentCount === 0) return;
  
  if (frameData) {
    renderer.device.queue.writeBuffer(renderer.frameBuffer, 0, frameData);
  }
  
  pass.setPipeline(renderer.pipeline);
  pass.setBindGroup(0, renderer.frameBindGroup);
  pass.setBindGroup(1, renderer.dataBindGroup);
  pass.draw(6, renderer.currentCount);
}

/**
 * Destroy decal renderer resources
 */
export function destroyDecalRenderer(renderer) {
  if (!renderer) return;
  renderer.frameBuffer?.destroy();
  renderer.decalBuffer?.destroy();
  renderer.paramsBuffer?.destroy();
}
