// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ParticleBeamRenderer.js - Beam / Lightning Particle Renderer (GAP 14)
 * 
 * Renders connected line segments between sequential particles as thick beams.
 * Supports:
 *   - Chain mode: connect particles in sequence (particle 0→1→2→3...)
 *   - Source mode: connect all particles to a single source point
 *   - Lightning mode: chain + per-segment jitter for electric arcs
 * 
 * Each beam segment is a camera-facing quad strip (2 triangles per segment).
 * Width can vary per particle (from meta.w size) and taper at ends.
 * 
 * Usage:
 *   const beam = await createParticleBeamRenderer(device, { format });
 *   renderBeamParticles(pass, beam, world, { viewProj, instanceCount });
 */

import { createUniformBuffer } from "../../core/gpu/GpuBuffer.js";
import {
  LEGACY_PCG32_WGSL,
  LEGACY_STANDALONE_RUNTIME_PCG_WGSL,
} from "../../core/math/MathBits.js";

// ============================================================================
// BEAM MODES
// ============================================================================

export const BEAM_MODE_CHAIN = 0;     // Connect particles in sequence
export const BEAM_MODE_SOURCE = 1;    // Connect all to source point
export const BEAM_MODE_LIGHTNING = 2; // Chain + random jitter

// ============================================================================
// WGSL SHADER
// ============================================================================

const BEAM_SHADER = /* wgsl */`
struct FrameUniforms {
  viewProj: mat4x4<f32>,
  viewRight: vec3<f32>,
  _pad0: f32,
  viewUp: vec3<f32>,
  _pad1: f32,
};

struct BeamParams {
  width: f32,          // Base beam width in world units
  taper: f32,          // Taper at endpoints (0 = none, 1 = full taper)
  mode: u32,           // 0=chain, 1=source, 2=lightning
  jitterAmount: f32,   // Lightning jitter amplitude
  sourcePos: vec3<f32>, // Source point for BEAM_MODE_SOURCE
  time: f32,
  color: vec4<f32>,     // Override color (w > 0 = use this, w = 0 = use particle color)
};

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(0) @binding(1) var<uniform> beamParams: BeamParams;

@group(1) @binding(0) var<storage, read> positions: array<vec4<f32>>;
@group(1) @binding(1) var<storage, read> velocities: array<vec4<f32>>;
@group(1) @binding(2) var<storage, read> particleMeta: array<vec4<f32>>;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
  @location(1) localUV: vec2<f32>,
};

${LEGACY_PCG32_WGSL}
${LEGACY_STANDALONE_RUNTIME_PCG_WGSL}
fn pcg_hash(input: u32) -> u32 {
  return legacyStandaloneRuntimePcgHash32(input);
}

fn hashFloat(seed: u32) -> f32 {
  return legacyStandaloneRuntimePcgFloat01(seed);
}

@vertex
fn vs_main(@builtin(vertex_index) vi: u32, @builtin(instance_index) segIdx: u32) -> VertexOutput {
  // Each instance = one beam segment (2 triangles = 6 vertices)
  // segIdx = segment index, vi = vertex within the quad (0-5)
  
  // Get the two endpoint particle indices for this segment
  var idxA = segIdx;
  var idxB = segIdx + 1u;
  
  if (beamParams.mode == 1u) {
    // Source mode: all segments connect to source point
    idxA = segIdx;
    idxB = segIdx; // Both reference same particle, but A uses sourcePos
  }
  
  let posA4 = positions[idxA];
  let posB4 = positions[idxB];
  let metaA = particleMeta[idxA];
  let metaB = particleMeta[idxB];
  
  var pointA = posA4.xyz;
  var pointB = posB4.xyz;
  
  if (beamParams.mode == 1u) {
    pointA = beamParams.sourcePos;
    pointB = posA4.xyz;
  }
  
  // Lightning jitter: offset midpoint perpendicular to beam direction
  if (beamParams.mode == 2u) {
    let seed = segIdx * 37u + u32(beamParams.time * 60.0);
    let jitterX = (hashFloat(seed) * 2.0 - 1.0) * beamParams.jitterAmount;
    let jitterY = (hashFloat(seed + 1u) * 2.0 - 1.0) * beamParams.jitterAmount;
    let jitterZ = (hashFloat(seed + 2u) * 2.0 - 1.0) * beamParams.jitterAmount;
    let mid = (pointA + pointB) * 0.5 + vec3<f32>(jitterX, jitterY, jitterZ);
    // Subdivide: vertex 0-2 use A→mid, vertex 3-5 use mid→B
    // Simplified: just offset both endpoints slightly
    pointA = pointA + vec3<f32>(jitterX * 0.3, jitterY * 0.3, jitterZ * 0.3);
    pointB = pointB + vec3<f32>(-jitterX * 0.3, -jitterY * 0.3, -jitterZ * 0.3);
  }
  
  // Beam direction and perpendicular (camera-facing)
  let beamDir = pointB - pointA;
  let beamLen = length(beamDir);
  if (beamLen < 0.001) {
    var out: VertexOutput;
    out.position = vec4<f32>(0.0, 0.0, -2.0, 1.0);
    out.color = vec4<f32>(0.0);
    out.localUV = vec2<f32>(0.0);
    return out;
  }
  
  let beamFwd = beamDir / beamLen;
  let camDir = normalize(cross(frame.viewRight, frame.viewUp));
  var beamRight = normalize(cross(beamFwd, camDir));
  
  // Fallback if beam is parallel to camera
  if (length(beamRight) < 0.01) {
    beamRight = frame.viewRight;
  }
  
  // Quad corners: 6 vertices forming 2 triangles
  // Layout: (0,1,2), (0,2,3) where 0=A-right, 1=A+right, 2=B+right, 3=B-right
  var corners = array<vec2<f32>, 6>(
    vec2<f32>(0.0, -1.0), vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 1.0),
    vec2<f32>(0.0, -1.0), vec2<f32>(1.0, 1.0), vec2<f32>(1.0, -1.0),
  );
  let corner = corners[vi % 6u];
  
  // Interpolate position along beam
  let alongBeam = corner.x; // 0 = pointA, 1 = pointB
  let acrossBeam = corner.y; // -1 to +1
  
  let pos = mix(pointA, pointB, alongBeam);
  
  // Width with taper at endpoints
  let taper = 1.0 - beamParams.taper * (2.0 * abs(alongBeam - 0.5));
  let width = beamParams.width * taper * 0.5;
  
  let worldPos = pos + beamRight * acrossBeam * width;
  
  // Dead particle check
  let ageA = posA4.w;
  let lifetimeA = max(velocities[idxA].w, 0.1);
  let alive = select(1.0, 0.0, ageA >= lifetimeA);
  
  // Color: use override or particle color
  var beamColor = vec4<f32>(metaA.rgb, 1.0);
  if (beamParams.color.w > 0.01) {
    beamColor = beamParams.color;
  }
  // Core brightness: brighter in center
  let coreBrightness = 1.0 + (1.0 - abs(acrossBeam)) * 1.5;
  beamColor = vec4<f32>(beamColor.rgb * coreBrightness, beamColor.a * alive);
  
  var out: VertexOutput;
  out.position = frame.viewProj * vec4<f32>(worldPos, 1.0);
  out.color = beamColor;
  out.localUV = vec2<f32>(alongBeam, acrossBeam);
  return out;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
  if (input.color.a < 0.01) { discard; }
  
  // Soft edges across beam width
  let edgeFade = 1.0 - smoothstep(0.6, 1.0, abs(input.localUV.y));
  let alpha = input.color.a * edgeFade;
  
  return vec4<f32>(input.color.rgb, alpha);
}
`;

// ============================================================================
// SYSTEM
// ============================================================================

/**
 * Create a particle beam renderer.
 * @param {GPUDevice} device
 * @param {Object} options - { format, mode, width, taper, jitterAmount }
 */
export async function createParticleBeamRenderer(device, options = {}) {
  const { format } = options;
  if (!device || !format) throw new Error('createParticleBeamRenderer: device and format required');

  const shaderModule = device.createShaderModule({
    label: 'ParticleBeamRenderer.shader',
    code: BEAM_SHADER,
  });

  const frameLayout = device.createBindGroupLayout({
    label: 'ParticleBeamRenderer.frameLayout',
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
    ],
  });

  const dataLayout = device.createBindGroupLayout({
    label: 'ParticleBeamRenderer.dataLayout',
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
    ],
  });

  const pipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [frameLayout, dataLayout],
  });

  const pipeline = device.createRenderPipeline({
    label: 'ParticleBeamRenderer.pipeline',
    layout: pipelineLayout,
    vertex: { module: shaderModule, entryPoint: 'vs_main' },
    fragment: {
      module: shaderModule,
      entryPoint: 'fs_main',
      targets: [{
        format,
        blend: {
          color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
          alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
        },
      }],
    },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less-equal' },
  });

  // Frame uniforms (matches FrameUniforms struct: viewProj + viewRight + viewUp = 96 bytes)
  const frameBuffer = device.createBuffer({
    label: 'ParticleBeamRenderer.frameUniforms',
    size: 96,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  // Beam params: 64 bytes
  const beamParamsBuffer = device.createBuffer({
    label: 'ParticleBeamRenderer.beamParams',
    size: 64,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  // Initialize defaults
  const initData = new Float32Array(16);
  initData[0] = options.width ?? 0.2;
  initData[1] = options.taper ?? 0.3;
  // mode is u32 at offset 2
  new Uint32Array(initData.buffer)[2] = options.mode ?? BEAM_MODE_CHAIN;
  initData[3] = options.jitterAmount ?? 0.5;
  // sourcePos
  initData[4] = 0; initData[5] = 0; initData[6] = 0;
  initData[7] = 0; // time
  // color override (w=0 means use particle color)
  initData[8] = 1; initData[9] = 1; initData[10] = 1; initData[11] = 0;
  device.queue.writeBuffer(beamParamsBuffer, 0, initData);

  return {
    device,
    pipeline,
    frameLayout,
    dataLayout,
    frameBuffer,
    beamParamsBuffer,
    frameBindGroup: null,
    dataBindGroup: null,
    _frameData: new Float32Array(24),
    _paramsData: initData,
  };
}

/**
 * Bind particle data from a particle world.
 */
export function bindBeamParticleData(renderer, world) {
  if (!renderer || !world) return;

  renderer.frameBindGroup = renderer.device.createBindGroup({
    label: 'ParticleBeamRenderer.frameBindGroup',
    layout: renderer.frameLayout,
    entries: [
      { binding: 0, resource: { buffer: renderer.frameBuffer } },
      { binding: 1, resource: { buffer: renderer.beamParamsBuffer } },
    ],
  });

  renderer.dataBindGroup = renderer.device.createBindGroup({
    label: 'ParticleBeamRenderer.dataBindGroup',
    layout: renderer.dataLayout,
    entries: [
      { binding: 0, resource: { buffer: world.positionBuffer } },
      { binding: 1, resource: { buffer: world.velocityBuffer } },
      { binding: 2, resource: { buffer: world.metaBuffer } },
    ],
  });
}

/**
 * Render beam particles.
 * @param {GPURenderPassEncoder} pass
 * @param {Object} renderer
 * @param {Object} options - { viewProj, viewRight, viewUp, time, segmentCount }
 */
export function renderBeamParticles(pass, renderer, options = {}) {
  if (!renderer?.pipeline || !renderer?.frameBindGroup || !renderer?.dataBindGroup) return;

  const { viewProj, viewRight = [1,0,0], viewUp = [0,1,0], time = 0, segmentCount = 0 } = options;
  if (!viewProj || segmentCount <= 0) return;

  // Update frame uniforms
  const fd = renderer._frameData;
  fd.set(viewProj, 0);
  fd[16] = viewRight[0]; fd[17] = viewRight[1]; fd[18] = viewRight[2]; fd[19] = 0;
  fd[20] = viewUp[0]; fd[21] = viewUp[1]; fd[22] = viewUp[2]; fd[23] = 0;
  renderer.device.queue.writeBuffer(renderer.frameBuffer, 0, fd);

  // Update time in beam params
  renderer._paramsData[7] = time;
  renderer.device.queue.writeBuffer(renderer.beamParamsBuffer, 0, renderer._paramsData);

  pass.setPipeline(renderer.pipeline);
  pass.setBindGroup(0, renderer.frameBindGroup);
  pass.setBindGroup(1, renderer.dataBindGroup);
  pass.draw(6, segmentCount); // 6 vertices per segment quad
}

/**
 * Update beam parameters.
 */
export function setBeamParams(renderer, params = {}) {
  if (!renderer?.device) return;
  const d = renderer._paramsData;
  const u = new Uint32Array(d.buffer);

  if (params.width !== undefined) d[0] = params.width;
  if (params.taper !== undefined) d[1] = params.taper;
  if (params.mode !== undefined) u[2] = params.mode;
  if (params.jitterAmount !== undefined) d[3] = params.jitterAmount;
  if (params.sourcePos) { d[4] = params.sourcePos[0]; d[5] = params.sourcePos[1]; d[6] = params.sourcePos[2]; }
  if (params.color) { d[8] = params.color[0]; d[9] = params.color[1]; d[10] = params.color[2]; d[11] = params.color[3] ?? 1; }

  renderer.device.queue.writeBuffer(renderer.beamParamsBuffer, 0, d);
}

/**
 * Destroy the beam renderer.
 */
export function destroyParticleBeamRenderer(renderer) {
  if (!renderer) return;
  if (renderer.frameBuffer) renderer.frameBuffer.destroy();
  if (renderer.beamParamsBuffer) renderer.beamParamsBuffer.destroy();
  renderer.frameBindGroup = null;
  renderer.dataBindGroup = null;
}
