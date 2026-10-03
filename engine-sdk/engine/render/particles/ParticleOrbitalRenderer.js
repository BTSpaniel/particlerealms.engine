// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ParticleOrbitalRenderer.js - Electron Cloud / Orbital Renderer (GAP 40)
 * 
 * Renders electron probability clouds around atom-particles using raymarched
 * spherical harmonics. Color by element (CPK convention) from element table.
 * LOD: full orbital at close range, simple sphere at distance.
 * 
 * Usage:
 *   const orb = createOrbitalRenderer(device, format);
 *   renderOrbitals(pass, orb, { positionBuffer, elementBuffer, colorLutBuffer, camera });
 */

import { orbitalWGSL } from "../shaders/modules/core/particles_orbital.js";

// ============================================================================
// ORBITAL RENDER PIPELINE
// ============================================================================

const ORBITAL_VERTEX_WGSL = /* wgsl */`
struct FrameUniforms {
  viewProj: mat4x4<f32>,
  viewRight: vec3<f32>,
  _pad0: f32,
  viewUp: vec3<f32>,
  _pad1: f32,
  cameraPos: vec3<f32>,
  orbitalScale: f32,
};

struct VSOut {
  @builtin(position) position: vec4<f32>,
  @location(0) worldPos: vec3<f32>,
  @location(1) particleCenter: vec3<f32>,
  @location(2) localUV: vec2<f32>,
  @location(3) @interpolate(flat) particleIdx: u32,
  @location(4) @interpolate(flat) elementZ: u32,
  @location(5) atomicRadius: f32,
};

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(1) @binding(0) var<storage, read> positions: array<vec4<f32>>;
@group(1) @binding(1) var<storage, read> velocities: array<vec4<f32>>;
@group(1) @binding(2) var<storage, read> elementTypes: array<u32>;
@group(1) @binding(3) var<storage, read> elementLUT: array<f32>;

const CORNERS = array<vec2<f32>, 6>(
  vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(-1.0, 1.0),
  vec2<f32>(-1.0, 1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0),
);

@vertex
fn vs_main(@builtin(vertex_index) vid: u32, @builtin(instance_index) iid: u32) -> VSOut {
  var out: VSOut;

  let pos4 = positions[iid];
  let vel4 = velocities[iid];
  if (pos4.w >= vel4.w) {
    out.position = vec4<f32>(0.0, 0.0, -2.0, 1.0);
    return out;
  }

  let center = pos4.xyz;
  let z = elementTypes[iid];
  let atomicRadius = select(1.0, elementLUT[z * 8u + 6u], z > 0u && z < 119u);
  let billboardSize = atomicRadius * frame.orbitalScale * 6.0;

  let corner = CORNERS[vid % 6u];
  let worldPos = center + frame.viewRight * corner.x * billboardSize + frame.viewUp * corner.y * billboardSize;

  out.position = frame.viewProj * vec4<f32>(worldPos, 1.0);
  out.worldPos = worldPos;
  out.particleCenter = center;
  out.localUV = corner;
  out.particleIdx = iid;
  out.elementZ = z;
  out.atomicRadius = atomicRadius;

  return out;
}
`;

const ORBITAL_FRAGMENT_WGSL = /* wgsl */`
${orbitalWGSL}

struct FrameUniforms {
  viewProj: mat4x4<f32>,
  viewRight: vec3<f32>,
  _pad0: f32,
  viewUp: vec3<f32>,
  _pad1: f32,
  cameraPos: vec3<f32>,
  orbitalScale: f32,
};

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(2) @binding(0) var<storage, read> colorLUT: array<vec4<f32>>;

struct FSIn {
  @location(0) worldPos: vec3<f32>,
  @location(1) particleCenter: vec3<f32>,
  @location(2) localUV: vec2<f32>,
  @location(3) @interpolate(flat) particleIdx: u32,
  @location(4) @interpolate(flat) elementZ: u32,
  @location(5) atomicRadius: f32,
};

@fragment
fn fs_main(in: FSIn) -> @location(0) vec4<f32> {
  // Discard outside circle
  let dist2 = dot(in.localUV, in.localUV);
  if (dist2 > 1.0) { discard; }

  let rayOrigin = frame.cameraPos;
  let rayDir = normalize(in.worldPos - frame.cameraPos);
  let orbitalType = elementToOrbital(in.elementZ);

  // LOD: reduce steps at distance
  let camDist = length(in.particleCenter - frame.cameraPos);
  let steps = select(16u, select(32u, 48u, camDist < in.atomicRadius * 20.0), camDist < in.atomicRadius * 40.0);

  let result = raymarchOrbital(rayOrigin, rayDir, in.particleCenter, orbitalType, in.atomicRadius, steps);
  let density = result.x;

  if (density < 0.01) { discard; }

  // Element color from CPK LUT
  var color = vec3<f32>(0.5, 0.5, 0.5);
  if (in.elementZ > 0u && in.elementZ < 119u) {
    color = colorLUT[in.elementZ].rgb;
  }

  // Alpha from density
  let alpha = clamp(density * 2.0, 0.0, 0.85);

  // Subtle glow at edges
  let edgeFactor = 1.0 - sqrt(dist2);
  let finalColor = color * (0.6 + 0.4 * edgeFactor);

  return vec4<f32>(finalColor, alpha);
}
`;

// ============================================================================
// SYSTEM
// ============================================================================

/**
 * Create the orbital renderer.
 */
export function createOrbitalRenderer(device, format) {
  const vertModule = device.createShaderModule({ label: 'Orbital.vert', code: ORBITAL_VERTEX_WGSL });
  const fragModule = device.createShaderModule({ label: 'Orbital.frag', code: ORBITAL_FRAGMENT_WGSL });

  const frameLayout = device.createBindGroupLayout({
    label: 'Orbital.frameLayout',
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    ],
  });

  const dataLayout = device.createBindGroupLayout({
    label: 'Orbital.dataLayout',
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 3, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
    ],
  });

  const colorLayout = device.createBindGroupLayout({
    label: 'Orbital.colorLayout',
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
    ],
  });

  const pipelineLayout = device.createPipelineLayout({
    label: 'Orbital.pipelineLayout',
    bindGroupLayouts: [frameLayout, dataLayout, colorLayout],
  });

  const pipeline = device.createRenderPipeline({
    label: 'Orbital.pipeline',
    layout: pipelineLayout,
    vertex: { module: vertModule, entryPoint: 'vs_main' },
    fragment: {
      module: fragModule, entryPoint: 'fs_main',
      targets: [{ format, blend: {
        color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      }}],
    },
    primitive: { topology: 'triangle-list' },
  });

  const frameBuffer = device.createBuffer({
    label: 'Orbital.frame', size: 128,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  return {
    device, pipeline, frameBuffer,
    frameLayout, dataLayout, colorLayout,
    frameBindGroup: null, dataBindGroup: null, colorBindGroup: null,
    orbitalScale: 1.0,
  };
}

/**
 * Initialize bind groups for orbital rendering.
 */
export function initOrbitalBindGroups(renderer, device, positionBuffer, velocityBuffer, elementBuffer, lutBuffer, colorLutBuffer) {
  renderer.frameBindGroup = device.createBindGroup({
    label: 'Orbital.frame.bg', layout: renderer.frameLayout,
    entries: [{ binding: 0, resource: { buffer: renderer.frameBuffer } }],
  });

  renderer.dataBindGroup = device.createBindGroup({
    label: 'Orbital.data.bg', layout: renderer.dataLayout,
    entries: [
      { binding: 0, resource: { buffer: positionBuffer } },
      { binding: 1, resource: { buffer: velocityBuffer } },
      { binding: 2, resource: { buffer: elementBuffer } },
      { binding: 3, resource: { buffer: lutBuffer } },
    ],
  });

  renderer.colorBindGroup = device.createBindGroup({
    label: 'Orbital.color.bg', layout: renderer.colorLayout,
    entries: [{ binding: 0, resource: { buffer: colorLutBuffer } }],
  });
}

/**
 * Render orbital clouds in the given render pass.
 */
export function renderOrbitals(pass, renderer, viewProj, cameraPos, viewRight, viewUp, instanceCount) {
  if (!renderer?.pipeline || !renderer.dataBindGroup || instanceCount === 0) return;

  const frameData = new Float32Array(32);
  frameData.set(viewProj, 0);
  frameData[16] = viewRight[0]; frameData[17] = viewRight[1]; frameData[18] = viewRight[2]; frameData[19] = 0;
  frameData[20] = viewUp[0]; frameData[21] = viewUp[1]; frameData[22] = viewUp[2]; frameData[23] = 0;
  frameData[24] = cameraPos[0]; frameData[25] = cameraPos[1]; frameData[26] = cameraPos[2];
  frameData[27] = renderer.orbitalScale;

  renderer.device.queue.writeBuffer(renderer.frameBuffer, 0, frameData);

  pass.setPipeline(renderer.pipeline);
  pass.setBindGroup(0, renderer.frameBindGroup);
  pass.setBindGroup(1, renderer.dataBindGroup);
  pass.setBindGroup(2, renderer.colorBindGroup);
  pass.draw(6, instanceCount);
}

/**
 * Destroy.
 */
export function destroyOrbitalRenderer(renderer) {
  if (!renderer) return;
  if (renderer.frameBuffer) renderer.frameBuffer.destroy();
}
