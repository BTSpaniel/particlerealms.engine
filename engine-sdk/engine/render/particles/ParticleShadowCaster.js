// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { calcWGSLStructSize, getFloat32ArraySize } from '../../core/gpu/WGSLStructSize.js';

/**
 * ParticleShadowCaster.js - Unified Particle Shadow Depth Rendering
 *
 * Single depth pass for ALL particle shadow casters. Runs inside
 * ShadowMapPass.renderShadowDepth via the additionalCasters interface.
 *
 * Covered renderers (shadow-worthy solid geometry):
 *   1. SDF/Billboard particles  → billboard quads facing the light (circle-discard)
 *   2. Mesh particles           → delegates to ParticleMeshRenderer.flushShadowDepth
 *   3. Rope tubes               → registers via createRopeShadowCaster helper
 *
 * NOT covered (transparent / additive / utility — no shadows expected):
 *   - Beams, Trails, Bonds, Orbitals, Fields, Distortion, SPH surface, debug renderers
 *
 * No interference: shadow pass uses its own depth-only shaders and writes to
 * ShadowMapPass.shadowTexture. Main visual renderers are never modified.
 * Particle GPU buffers (positions, velocities, meta) are READ-ONLY here.
 *
 * Usage:
 *   const caster = await createParticleShadowCaster(device);
 *   bindShadowParticleData(caster, world);
 *   registerCaster(caster, 'meshParticles', (pass, lvp) => { ... });
 *   // In ShadowMapPass depth pass:
 *   flushAllParticleShadows(pass, caster, lightViewProj, sunDir, count);
 */

// ============================================================================
// BILLBOARD SHADOW DEPTH SHADERS
// ============================================================================

// Billboard uniform — just the light view-projection matrix.
// lightRight/lightUp are extracted from the matrix in the shader (standard technique).
const BILLBOARD_UNIFORMS_STRUCT = `struct ShadowUniforms {
  lightViewProj: mat4x4<f32>,
}`;
const BILLBOARD_UNIFORM_BYTES  = calcWGSLStructSize(BILLBOARD_UNIFORMS_STRUCT);
const BILLBOARD_UNIFORM_FLOATS = getFloat32ArraySize(BILLBOARD_UNIFORMS_STRUCT);

// Full shader: fragment discard for round shadow shapes (preferred)
// Light basis extracted from VP matrix rows (standard technique for ortho lights).
// Depth bias pushes billboard toward light to avoid precision issues near ground.
const BILLBOARD_SHADOW_FULL = /* wgsl */`
${BILLBOARD_UNIFORMS_STRUCT};

@group(0) @binding(0) var<uniform> uShadow: ShadowUniforms;

@group(1) @binding(0) var<storage, read> positions: array<vec4<f32>>;
@group(1) @binding(1) var<storage, read> velocities: array<vec4<f32>>;
@group(1) @binding(2) var<storage, read> particleMeta: array<vec4<f32>>;
@group(1) @binding(3) var<storage, read> owners: array<u32>;

struct VSOut {
  @builtin(position) position: vec4<f32>,
  @location(0) localPos: vec2<f32>,
};

fn getCorner(idx: u32) -> vec2<f32> {
  switch idx {
    case 0u: { return vec2<f32>(-1.0, -1.0); }
    case 1u: { return vec2<f32>( 1.0, -1.0); }
    case 2u: { return vec2<f32>( 1.0,  1.0); }
    case 3u: { return vec2<f32>(-1.0, -1.0); }
    case 4u: { return vec2<f32>( 1.0,  1.0); }
    default: { return vec2<f32>(-1.0,  1.0); }
  }
}

@vertex
fn vs_shadow(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VSOut {
  let pos4 = positions[ii];
  let vel4 = velocities[ii];
  let pmeta = particleMeta[ii];

  let center = pos4.xyz;
  let age = pos4.w;
  let lifetime = max(vel4.w, 0.1);

  var alive = 1.0;
  if (age >= lifetime) { alive = 0.0; }
  // Skip rope/chain particles — they have tube mesh shadows instead
  if (owners[ii] > 0u) { alive = 0.0; }

  var pv = pmeta.w;
  if (pv < 0.001) { pv = 0.0; }
  let sizeRaw = floor(pv / 10000.0);
  let particleSize = (sizeRaw - floor(sizeRaw / 100.0) * 100.0) * 0.1;

  let t = clamp(age / lifetime, 0.0, 1.0);
  let fadeIn = smoothstep(0.0, 0.08, t);
  let fadeOut = 1.0 - smoothstep(0.9, 1.0, t);
  let sizeFactor = fadeIn * fadeOut * 0.9 + 0.1;
  let radius = min(particleSize * sizeFactor * 0.5 * alive, 0.3);

  // Extract light-space right/up from VP matrix rows (ortho projection)
  let VP = uShadow.lightViewProj;
  let lightRight = normalize(vec3<f32>(VP[0][0], VP[1][0], VP[2][0]));
  let lightUp    = normalize(vec3<f32>(VP[0][1], VP[1][1], VP[2][1]));

  let corner = getCorner(vi % 6u);

  let worldPos = center
    + lightRight * corner.x * radius
    + lightUp * corner.y * radius;

  var out: VSOut;
  out.position = VP * vec4<f32>(worldPos, 1.0);
  out.position.z -= 0.004; // depth bias: push billboard toward light
  out.localPos = corner;
  return out;
}

@fragment
fn fs_shadow(@location(0) localPos: vec2<f32>) {
  let dist2 = dot(localPos, localPos);
  if (dist2 > 1.0) { discard; }
}
`;

// Fallback shader: vertex-only, no fragment stage (square shadows)
// Used when the full pipeline with fragment discard fails to compile.
const BILLBOARD_SHADOW_FALLBACK = /* wgsl */`
${BILLBOARD_UNIFORMS_STRUCT};

@group(0) @binding(0) var<uniform> uShadow: ShadowUniforms;

@group(1) @binding(0) var<storage, read> positions: array<vec4<f32>>;
@group(1) @binding(1) var<storage, read> velocities: array<vec4<f32>>;
@group(1) @binding(2) var<storage, read> particleMeta: array<vec4<f32>>;
@group(1) @binding(3) var<storage, read> owners: array<u32>;

fn getCorner(idx: u32) -> vec2<f32> {
  switch idx {
    case 0u: { return vec2<f32>(-1.0, -1.0); }
    case 1u: { return vec2<f32>( 1.0, -1.0); }
    case 2u: { return vec2<f32>( 1.0,  1.0); }
    case 3u: { return vec2<f32>(-1.0, -1.0); }
    case 4u: { return vec2<f32>( 1.0,  1.0); }
    default: { return vec2<f32>(-1.0,  1.0); }
  }
}

@vertex
fn vs_shadow(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> @builtin(position) vec4<f32> {
  let pos4 = positions[ii];
  let vel4 = velocities[ii];
  let pmeta = particleMeta[ii];

  let center = pos4.xyz;
  let age = pos4.w;
  let lifetime = max(vel4.w, 0.1);

  var alive = 1.0;
  if (age >= lifetime) { alive = 0.0; }
  // Skip rope/chain particles — they have tube mesh shadows instead
  if (owners[ii] > 0u) { alive = 0.0; }

  var pv = pmeta.w;
  if (pv < 0.001) { pv = 0.0; }
  let sizeRaw = floor(pv / 10000.0);
  let particleSize = (sizeRaw - floor(sizeRaw / 100.0) * 100.0) * 0.1;

  let t = clamp(age / lifetime, 0.0, 1.0);
  let fadeIn = smoothstep(0.0, 0.08, t);
  let fadeOut = 1.0 - smoothstep(0.9, 1.0, t);
  let sizeFactor = fadeIn * fadeOut * 0.9 + 0.1;
  let radius = min(particleSize * sizeFactor * 0.5 * alive, 0.3);

  // Extract light-space right/up from VP matrix rows (ortho projection)
  let VP = uShadow.lightViewProj;
  let lightRight = normalize(vec3<f32>(VP[0][0], VP[1][0], VP[2][0]));
  let lightUp    = normalize(vec3<f32>(VP[0][1], VP[1][1], VP[2][1]));

  let corner = getCorner(vi % 6u);

  let worldPos = center
    + lightRight * corner.x * radius
    + lightUp * corner.y * radius;

  var clipPos = VP * vec4<f32>(worldPos, 1.0);
  clipPos.z -= 0.004; // depth bias: push billboard toward light
  return clipPos;
}
`;

// Rope uniform struct — just lightViewProj
const ROPE_UNIFORMS_STRUCT = `struct ShadowUniforms {
  lightViewProj: mat4x4<f32>,
}`;
const ROPE_UNIFORM_BYTES = calcWGSLStructSize(ROPE_UNIFORMS_STRUCT);

// Rope shadow depth shader: reads compute-generated tube positions from storage
const ROPE_SHADOW_SHADER = /* wgsl */`
${ROPE_UNIFORMS_STRUCT};

@group(0) @binding(0) var<uniform> uShadow: ShadowUniforms;
@group(0) @binding(1) var<storage, read> vertexPositions: array<vec4<f32>>;

@vertex
fn vs_shadow(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
  let pos = vertexPositions[vi].xyz;
  return uShadow.lightViewProj * vec4<f32>(pos, 1.0);
}
`;

// ============================================================================
// SHADER COMPILATION HELPER
// ============================================================================

async function compileAndCheck(device, label, code) {
  const module = device.createShaderModule({ label, code });
  if (module.getCompilationInfo) {
    const info = await module.getCompilationInfo();
    for (const msg of info.messages) {
      const prefix = `[${label} ${msg.type}]`;
      const loc = msg.lineNum ? ` line ${msg.lineNum}:${msg.linePos}` : '';
      if (msg.type === 'error') console.error(prefix, msg.message, loc);
      else if (msg.type === 'warning') console.warn(prefix, msg.message, loc);
    }
    if (info.messages.some(m => m.type === 'error')) return null;
  }
  return module;
}

// ============================================================================
// CREATION
// ============================================================================

export async function createParticleShadowCaster(device) {
  if (!device) throw new Error('createParticleShadowCaster: device required');

  // Layouts shared by both full and fallback pipelines
  const uniformLayout = device.createBindGroupLayout({
    label: 'ParticleShadowCaster.uniformLayout',
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    ],
  });

  const dataLayout = device.createBindGroupLayout({
    label: 'ParticleShadowCaster.dataLayout',
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 3, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
    ],
  });

  const pipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [uniformLayout, dataLayout],
  });

  const depthStencil = { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less' };
  const primitive = { topology: 'triangle-list', cullMode: 'none' };

  // Try full shader (round shadows with fragment discard)
  let billboardPipeline = null;
  let roundShadows = false;
  const fullModule = await compileAndCheck(device, 'ParticleShadowCaster.full', BILLBOARD_SHADOW_FULL);
  if (fullModule) {
    try {
      billboardPipeline = await device.createRenderPipelineAsync({
        label: 'ParticleShadowCaster.billboardPipeline.round',
        layout: pipelineLayout,
        vertex:   { module: fullModule, entryPoint: 'vs_shadow' },
        fragment: { module: fullModule, entryPoint: 'fs_shadow', targets: [] },
        primitive, depthStencil,
      });
      roundShadows = true;
      console.log('[ParticleShadowCaster] Round shadow pipeline created');
    } catch (e) {
      console.warn('[ParticleShadowCaster] Round shadow pipeline failed:', e.message);
    }
  }

  // Fallback: vertex-only pipeline (square shadows, no fragment stage)
  if (!billboardPipeline) {
    console.log('[ParticleShadowCaster] Trying fallback (square shadows)...');
    const fbModule = await compileAndCheck(device, 'ParticleShadowCaster.fallback', BILLBOARD_SHADOW_FALLBACK);
    if (!fbModule) throw new Error('ParticleShadowCaster: both shaders failed to compile');
    billboardPipeline = await device.createRenderPipelineAsync({
      label: 'ParticleShadowCaster.billboardPipeline.square',
      layout: pipelineLayout,
      vertex: { module: fbModule, entryPoint: 'vs_shadow' },
      primitive, depthStencil,
    });
    console.log('[ParticleShadowCaster] Square shadow pipeline created (fallback)');
  }

  const uniformBuffer = device.createBuffer({
    label: 'ParticleShadowCaster.uniforms',
    size: BILLBOARD_UNIFORM_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const uniformBindGroup = device.createBindGroup({
    label: 'ParticleShadowCaster.uniformBindGroup',
    layout: uniformLayout,
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
  });

  return {
    device,
    billboardPipeline,
    roundShadows,
    uniformLayout,
    dataLayout,
    uniformBuffer,
    uniformBindGroup,
    _uniformData: new Float32Array(BILLBOARD_UNIFORM_FLOATS),
    dataBindGroup: null,
    // Formal caster registry: Map<string, { flush(pass, lightViewProj) }>
    _casters: new Map(),
    // Legacy compat (Viewport.js sets this directly)
    meshCasters: [],
  };
}

// ============================================================================
// CASTER REGISTRY
// ============================================================================

export function registerCaster(caster, id, flushFn) {
  if (!caster || !id || typeof flushFn !== 'function') return;
  caster._casters.set(id, { flush: flushFn });
}

export function unregisterCaster(caster, id) {
  if (!caster || !id) return;
  caster._casters.delete(id);
}

// ============================================================================
// DATA BINDING
// ============================================================================

export function bindShadowParticleData(caster, world) {
  if (!caster || !world) return;
  if (!world.positionBuffer || !world.velocityBuffer || !world.metaBuffer || !world.ownerBuffer) return;

  caster.dataBindGroup = caster.device.createBindGroup({
    label: 'ParticleShadowCaster.dataBindGroup',
    layout: caster.dataLayout,
    entries: [
      { binding: 0, resource: { buffer: world.positionBuffer } },
      { binding: 1, resource: { buffer: world.velocityBuffer } },
      { binding: 2, resource: { buffer: world.metaBuffer } },
      { binding: 3, resource: { buffer: world.ownerBuffer } },
    ],
  });
}


// ============================================================================
// RENDERING
// ============================================================================

export function flushBillboardShadowDepth(pass, caster, lightViewProj, sunDir, instanceCount) {
  if (!caster?.billboardPipeline || !caster.dataBindGroup || !lightViewProj) return;
  if (instanceCount <= 0) return;

  // Upload just the lightViewProj — shader extracts right/up from matrix rows
  caster.device.queue.writeBuffer(caster.uniformBuffer, 0, lightViewProj);

  pass.setPipeline(caster.billboardPipeline);
  pass.setBindGroup(0, caster.uniformBindGroup);
  pass.setBindGroup(1, caster.dataBindGroup);
  pass.draw(6, instanceCount);
}

export function flushAllParticleShadows(pass, caster, lightViewProj, sunDir, billboardInstanceCount) {
  // 1. Billboard (SDF / custom effect) particles
  flushBillboardShadowDepth(pass, caster, lightViewProj, sunDir, billboardInstanceCount);

  // 2. Legacy meshCasters array (backward compat with Viewport.js)
  if (caster.meshCasters) {
    for (let i = 0; i < caster.meshCasters.length; i++) {
      const mc = caster.meshCasters[i];
      if (mc && typeof mc.flush === 'function' && mc.instanceCount > 0) {
        mc.flush(pass, lightViewProj, mc.instanceCount);
      }
    }
  }

  // 3. Registered casters (rope, future types)
  for (const entry of caster._casters.values()) {
    entry.flush(pass, lightViewProj);
  }
}

// ============================================================================
// ROPE SHADOW CASTER
// ============================================================================

export async function createRopeShadowCaster(device, ropeRenderer) {
  if (!device || !ropeRenderer?.buffers) return null;

  const module = await compileAndCheck(device, 'RopeShadowCaster', ROPE_SHADOW_SHADER);
  if (!module) return null;

  const layout = device.createBindGroupLayout({
    label: 'RopeShadowCaster.layout',
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
    ],
  });

  const pipeline = await device.createRenderPipelineAsync({
    label: 'RopeShadowCaster.pipeline',
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    vertex: { module, entryPoint: 'vs_shadow' },
    primitive: { topology: 'triangle-list', cullMode: 'back' },
    depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less' },
  });

  const uniformBuffer = device.createBuffer({
    label: 'RopeShadowCaster.uniforms', size: ROPE_UNIFORM_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const bindGroup = device.createBindGroup({
    label: 'RopeShadowCaster.bindGroup',
    layout,
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: ropeRenderer.buffers.vertexPositions } },
    ],
  });

  return {
    pipeline, uniformBuffer, bindGroup, device,
    indirectBuffer: ropeRenderer.buffers.drawIndirect,
    flush(pass, lightViewProj) {
      if (!lightViewProj) return;
      device.queue.writeBuffer(uniformBuffer, 0, lightViewProj);
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.drawIndirect(this.indirectBuffer, 0);
    },
  };
}

// ============================================================================
// CLEANUP
// ============================================================================

export function destroyParticleShadowCaster(caster) {
  if (!caster) return;
  if (caster.uniformBuffer) caster.uniformBuffer.destroy();
  caster.dataBindGroup = null;
  caster.uniformBindGroup = null;
  caster.billboardPipeline = null;
  caster.meshCasters = null;
  caster._casters?.clear();
  caster._casters = null;
}
