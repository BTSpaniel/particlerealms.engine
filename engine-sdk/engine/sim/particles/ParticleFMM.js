// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Uniform-octree Fast Multipole Method for open-boundary gravitational forces.
 *
 * The GPU path is deliberately self-contained and opt-in. It performs the full
 * FMM sequence P2M -> M2M -> M2L -> L2L -> L2P + P2P. The first implementation
 * uses monopole source expansions and first-order Cartesian local expansions;
 * the direct solver remains the accuracy oracle and small-N fallback.
 */

import { createStorageBuffer, createUniformBuffer, destroyBuffers } from '../../core/gpu/GpuBuffer.js';
import { labelResource } from '../../core/gpu/GpuDebug.js';
import {
  estimateFmmMemory,
  fmmLevelCellCount,
  fmmLevelOffset,
  fmmTotalCellCount,
  normalizeFmmConfig,
} from './ParticleLongRangeMath.js';

const WORKGROUP_SIZE = 128;
const GLOBAL_PARAMS_BYTES = 64;
const LEVEL_PARAMS_BYTES = 16;
const INVALID_LEAF = 0xffffffff;
const TARGET_DISABLED_MASK = 0x80000000;
const LEAF_INDEX_MASK = 0x7fffffff;

const COMMON_WGSL = /* wgsl */`
struct FmmParams {
  particleCount: u32,
  depth: u32,
  leafCount: u32,
  totalCells: u32,

  leafOffset: u32,
  useParticleMass: u32,
  _padU0: u32,
  _padU1: u32,

  domainHalfExtent: f32,
  softening: f32,
  coupling: f32,
  dt: f32,

  maxAcceleration: f32,
  damping: f32,
  defaultSource: f32,
  _padF0: f32,
};

struct LevelParams {
  level: u32,
  levelOffset: u32,
  cellCount: u32,
  parentOffset: u32,
};

struct CellMoment {
  centerMass: vec4<f32>,
};

struct CellLocal {
  field: vec4<f32>,
  gradientX: vec4<f32>,
  gradientY: vec4<f32>,
  gradientZ: vec4<f32>,
};

fn encodeMorton3D(coordinate: vec3<u32>, level: u32) -> u32 {
  var code = 0u;
  for (var bit = 0u; bit < level; bit += 1u) {
    code = code | (((coordinate.x >> bit) & 1u) << (3u * bit));
    code = code | (((coordinate.y >> bit) & 1u) << (3u * bit + 1u));
    code = code | (((coordinate.z >> bit) & 1u) << (3u * bit + 2u));
  }
  return code;
}

fn decodeMorton3D(code: u32, level: u32) -> vec3<u32> {
  var coordinate = vec3<u32>(0u);
  for (var bit = 0u; bit < level; bit += 1u) {
    coordinate.x = coordinate.x | (((code >> (3u * bit)) & 1u) << bit);
    coordinate.y = coordinate.y | (((code >> (3u * bit + 1u)) & 1u) << bit);
    coordinate.z = coordinate.z | (((code >> (3u * bit + 2u)) & 1u) << bit);
  }
  return coordinate;
}

fn cellCenter(code: u32, level: u32, halfExtent: f32) -> vec3<f32> {
  let coordinate = vec3<f32>(decodeMorton3D(code, level));
  let cellsPerAxis = f32(1u << level);
  let cellWidth = (2.0 * halfExtent) / cellsPerAxis;
  return vec3<f32>(-halfExtent) + (coordinate + vec3<f32>(0.5)) * cellWidth;
}

fn extractMass(metaW: f32, defaultSource: f32, useParticleMass: u32) -> f32 {
  if (useParticleMass == 0u) { return defaultSource; }
  let massEncoded = floor(metaW / 1e8) % 100.0;
  return max(0.1, massEncoded * 0.1);
}
`;

const ASSIGN_SHADER = /* wgsl */`
${COMMON_WGSL}

@group(0) @binding(0) var<uniform> params: FmmParams;
@group(0) @binding(1) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> velocities: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> thermalData: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read_write> leafCounts: array<atomic<u32>>;
@group(0) @binding(5) var<storage, read_write> particleLeafKeys: array<u32>;
@group(0) @binding(6) var<storage, read_write> diagnostics: array<atomic<u32>>;

@compute @workgroup_size(${WORKGROUP_SIZE})
fn assignLeaves(@builtin(global_invocation_id) gid: vec3<u32>) {
  let particle = gid.x;
  if (particle >= params.particleCount) { return; }
  let position4 = positions[particle];
  let velocity4 = velocities[particle];
  let isActive = position4.w < velocity4.w;
  if (!isActive) {
    particleLeafKeys[particle] = ${INVALID_LEAF}u;
    return;
  }
  let phase = thermalData[particle].y;
  let targetDisabled = phase > 0.5 && phase < 2.5;

  let normalized = (position4.xyz + vec3<f32>(params.domainHalfExtent))
    / (2.0 * params.domainHalfExtent);
  if (any(normalized < vec3<f32>(0.0)) || any(normalized >= vec3<f32>(1.0))) {
    atomicAdd(&diagnostics[1], 1u);
  }
  let bounded = clamp(normalized, vec3<f32>(0.0), vec3<f32>(0.99999994));
  let cellsPerAxis = 1u << params.depth;
  let coordinate = vec3<u32>(floor(bounded * f32(cellsPerAxis)));
  let leaf = encodeMorton3D(coordinate, params.depth);
  particleLeafKeys[particle] = leaf | select(0u, ${TARGET_DISABLED_MASK}u, targetDisabled);
  atomicAdd(&leafCounts[leaf], 1u);
  atomicAdd(&diagnostics[0], 1u);
}
`;

const PREFIX_SHADER = /* wgsl */`
${COMMON_WGSL}

@group(0) @binding(0) var<uniform> params: FmmParams;
@group(0) @binding(1) var<storage, read> leafCounts: array<u32>;
@group(0) @binding(2) var<storage, read_write> leafOffsets: array<u32>;

@compute @workgroup_size(1)
fn scanLeafCounts() {
  var running = 0u;
  for (var leaf = 0u; leaf < params.leafCount; leaf += 1u) {
    leafOffsets[leaf] = running;
    running += leafCounts[leaf];
  }
  leafOffsets[params.leafCount] = running;
}
`;

const SCATTER_SHADER = /* wgsl */`
${COMMON_WGSL}

@group(0) @binding(0) var<uniform> params: FmmParams;
@group(0) @binding(1) var<storage, read> leafOffsets: array<u32>;
@group(0) @binding(2) var<storage, read_write> leafCursors: array<atomic<u32>>;
@group(0) @binding(3) var<storage, read> particleLeafKeys: array<u32>;
@group(0) @binding(4) var<storage, read_write> sortedParticleIndices: array<u32>;
@group(0) @binding(5) var<storage, read_write> diagnostics: array<atomic<u32>>;

@compute @workgroup_size(${WORKGROUP_SIZE})
fn scatterParticles(@builtin(global_invocation_id) gid: vec3<u32>) {
  let particle = gid.x;
  if (particle >= params.particleCount) { return; }
  let key = particleLeafKeys[particle];
  if (key == ${INVALID_LEAF}u) { return; }
  let leaf = key & ${LEAF_INDEX_MASK}u;
  let localOffset = atomicAdd(&leafCursors[leaf], 1u);
  sortedParticleIndices[leafOffsets[leaf] + localOffset] = particle;
  atomicAdd(&diagnostics[3], 1u);
}
`;

const P2M_SHADER = /* wgsl */`
${COMMON_WGSL}

@group(0) @binding(0) var<uniform> params: FmmParams;
@group(0) @binding(1) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> particleMeta: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> leafOffsets: array<u32>;
@group(0) @binding(4) var<storage, read> leafCounts: array<u32>;
@group(0) @binding(5) var<storage, read> sortedParticleIndices: array<u32>;
@group(0) @binding(6) var<storage, read_write> moments: array<CellMoment>;
@group(0) @binding(7) var<storage, read_write> diagnostics: array<atomic<u32>>;

@compute @workgroup_size(${WORKGROUP_SIZE})
fn particlesToMultipoles(@builtin(global_invocation_id) gid: vec3<u32>) {
  let leaf = gid.x;
  if (leaf >= params.leafCount) { return; }
  let count = leafCounts[leaf];
  let start = leafOffsets[leaf];
  var mass = 0.0;
  var weightedPosition = vec3<f32>(0.0);
  for (var offset = 0u; offset < count; offset += 1u) {
    let particle = sortedParticleIndices[start + offset];
    let source = extractMass(particleMeta[particle].w, params.defaultSource, params.useParticleMass);
    mass += source;
    weightedPosition += positions[particle].xyz * source;
  }
  var center = cellCenter(leaf, params.depth, params.domainHalfExtent);
  if (mass > 0.0) { center = weightedPosition / mass; }
  moments[params.leafOffset + leaf].centerMass = vec4<f32>(center, mass);
  atomicMax(&diagnostics[2], count);
}
`;

const M2M_SHADER = /* wgsl */`
${COMMON_WGSL}

@group(0) @binding(0) var<uniform> params: FmmParams;
@group(0) @binding(1) var<uniform> levelParams: LevelParams;
@group(0) @binding(2) var<storage, read_write> moments: array<CellMoment>;

@compute @workgroup_size(${WORKGROUP_SIZE})
fn multipoleToMultipole(@builtin(global_invocation_id) gid: vec3<u32>) {
  let parent = gid.x;
  if (parent >= levelParams.cellCount) { return; }
  let childOffset = levelParams.levelOffset + levelParams.cellCount;
  var mass = 0.0;
  var weightedCenter = vec3<f32>(0.0);
  for (var child = 0u; child < 8u; child += 1u) {
    let childMoment = moments[childOffset + parent * 8u + child].centerMass;
    mass += childMoment.w;
    weightedCenter += childMoment.xyz * childMoment.w;
  }
  var center = cellCenter(parent, levelParams.level, params.domainHalfExtent);
  if (mass > 0.0) { center = weightedCenter / mass; }
  moments[levelParams.levelOffset + parent].centerMass = vec4<f32>(center, mass);
}
`;

const M2L_SHADER = /* wgsl */`
${COMMON_WGSL}

@group(0) @binding(0) var<uniform> params: FmmParams;
@group(0) @binding(1) var<uniform> levelParams: LevelParams;
@group(0) @binding(2) var<storage, read> moments: array<CellMoment>;
@group(0) @binding(3) var<storage, read_write> locals: array<CellLocal>;

@compute @workgroup_size(${WORKGROUP_SIZE})
fn multipoleToLocal(@builtin(global_invocation_id) gid: vec3<u32>) {
  let targetCell = gid.x;
  if (targetCell >= levelParams.cellCount || levelParams.level < 2u) { return; }
  let targetCoordinate = decodeMorton3D(targetCell, levelParams.level);
  let targetCenter = cellCenter(targetCell, levelParams.level, params.domainHalfExtent);
  let parent = vec3<i32>(
    i32(targetCoordinate.x >> 1u),
    i32(targetCoordinate.y >> 1u),
    i32(targetCoordinate.z >> 1u),
  );
  let parentSize = i32(1u << (levelParams.level - 1u));
  var field = vec3<f32>(0.0);
  var gradientX = vec3<f32>(0.0);
  var gradientY = vec3<f32>(0.0);
  var gradientZ = vec3<f32>(0.0);
  let softSquared = params.softening * params.softening;

  for (var parentZ = parent.z - 1; parentZ <= parent.z + 1; parentZ += 1) {
    for (var parentY = parent.y - 1; parentY <= parent.y + 1; parentY += 1) {
      for (var parentX = parent.x - 1; parentX <= parent.x + 1; parentX += 1) {
        if (parentX < 0 || parentY < 0 || parentZ < 0
            || parentX >= parentSize || parentY >= parentSize || parentZ >= parentSize) {
          continue;
        }
        for (var child = 0u; child < 8u; child += 1u) {
          let sourceCoordinate = vec3<u32>(
            u32(parentX * 2 + i32(child & 1u)),
            u32(parentY * 2 + i32((child >> 1u) & 1u)),
            u32(parentZ * 2 + i32((child >> 2u) & 1u)),
          );
          let separation = abs(vec3<i32>(sourceCoordinate) - vec3<i32>(targetCoordinate));
          if (separation.x <= 1 && separation.y <= 1 && separation.z <= 1) { continue; }
          let sourceCell = encodeMorton3D(sourceCoordinate, levelParams.level);
          let moment = moments[levelParams.levelOffset + sourceCell].centerMass;
          if (moment.w <= 0.0) { continue; }
          let delta = moment.xyz - targetCenter;
          let distanceSquared = dot(delta, delta) + softSquared;
          let inverseDistance = inverseSqrt(distanceSquared);
          let inverseDistance3 = inverseDistance * inverseDistance * inverseDistance;
          let inverseDistance5 = inverseDistance3 * inverseDistance * inverseDistance;
          let scale = params.coupling * moment.w;
          let crossScale = 3.0 * scale * inverseDistance5;
          field += delta * (scale * inverseDistance3);
          gradientX += vec3<f32>(
            crossScale * delta.x * delta.x - scale * inverseDistance3,
            crossScale * delta.x * delta.y,
            crossScale * delta.x * delta.z,
          );
          gradientY += vec3<f32>(
            crossScale * delta.y * delta.x,
            crossScale * delta.y * delta.y - scale * inverseDistance3,
            crossScale * delta.y * delta.z,
          );
          gradientZ += vec3<f32>(
            crossScale * delta.z * delta.x,
            crossScale * delta.z * delta.y,
            crossScale * delta.z * delta.z - scale * inverseDistance3,
          );
        }
      }
    }
  }

  let globalIndex = levelParams.levelOffset + targetCell;
  var localValue = locals[globalIndex];
  localValue.field = vec4<f32>(localValue.field.xyz + field, 0.0);
  localValue.gradientX = vec4<f32>(localValue.gradientX.xyz + gradientX, 0.0);
  localValue.gradientY = vec4<f32>(localValue.gradientY.xyz + gradientY, 0.0);
  localValue.gradientZ = vec4<f32>(localValue.gradientZ.xyz + gradientZ, 0.0);
  locals[globalIndex] = localValue;
}
`;

const L2L_SHADER = /* wgsl */`
${COMMON_WGSL}

@group(0) @binding(0) var<uniform> params: FmmParams;
@group(0) @binding(1) var<uniform> levelParams: LevelParams;
@group(0) @binding(2) var<storage, read_write> locals: array<CellLocal>;

@compute @workgroup_size(${WORKGROUP_SIZE})
fn localToLocal(@builtin(global_invocation_id) gid: vec3<u32>) {
  let child = gid.x;
  if (child >= levelParams.cellCount || levelParams.level == 0u) { return; }
  let parent = child >> 3u;
  let parentLocal = locals[levelParams.parentOffset + parent];
  let childCenter = cellCenter(child, levelParams.level, params.domainHalfExtent);
  let parentCenter = cellCenter(parent, levelParams.level - 1u, params.domainHalfExtent);
  let offset = childCenter - parentCenter;
  let translatedField = parentLocal.field.xyz + vec3<f32>(
    dot(parentLocal.gradientX.xyz, offset),
    dot(parentLocal.gradientY.xyz, offset),
    dot(parentLocal.gradientZ.xyz, offset),
  );
  let globalIndex = levelParams.levelOffset + child;
  var childLocal = locals[globalIndex];
  childLocal.field = vec4<f32>(childLocal.field.xyz + translatedField, 0.0);
  childLocal.gradientX = vec4<f32>(childLocal.gradientX.xyz + parentLocal.gradientX.xyz, 0.0);
  childLocal.gradientY = vec4<f32>(childLocal.gradientY.xyz + parentLocal.gradientY.xyz, 0.0);
  childLocal.gradientZ = vec4<f32>(childLocal.gradientZ.xyz + parentLocal.gradientZ.xyz, 0.0);
  locals[globalIndex] = childLocal;
}
`;

const EVALUATE_SHADER = /* wgsl */`
${COMMON_WGSL}

@group(0) @binding(0) var<uniform> params: FmmParams;
@group(0) @binding(1) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> velocities: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> particleMeta: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read> leafOffsets: array<u32>;
@group(0) @binding(5) var<storage, read> leafCounts: array<u32>;
@group(0) @binding(6) var<storage, read> sortedParticleIndices: array<u32>;
@group(0) @binding(7) var<storage, read> particleLeafKeys: array<u32>;
@group(0) @binding(8) var<storage, read> locals: array<CellLocal>;

@compute @workgroup_size(${WORKGROUP_SIZE})
fn evaluateParticles(@builtin(global_invocation_id) gid: vec3<u32>) {
  let particle = gid.x;
  if (particle >= params.particleCount) { return; }
  let key = particleLeafKeys[particle];
  if (key == ${INVALID_LEAF}u || (key & ${TARGET_DISABLED_MASK}u) != 0u) { return; }
  let leaf = key & ${LEAF_INDEX_MASK}u;
  let position = positions[particle].xyz;
  let localValue = locals[params.leafOffset + leaf];
  let localOffset = position - cellCenter(leaf, params.depth, params.domainHalfExtent);
  var acceleration = localValue.field.xyz + vec3<f32>(
    dot(localValue.gradientX.xyz, localOffset),
    dot(localValue.gradientY.xyz, localOffset),
    dot(localValue.gradientZ.xyz, localOffset),
  );

  let coordinate = vec3<i32>(decodeMorton3D(leaf, params.depth));
  let cellsPerAxis = i32(1u << params.depth);
  let softSquared = params.softening * params.softening;
  for (var dz = -1; dz <= 1; dz += 1) {
    for (var dy = -1; dy <= 1; dy += 1) {
      for (var dx = -1; dx <= 1; dx += 1) {
        let neighborCoordinate = coordinate + vec3<i32>(dx, dy, dz);
        if (any(neighborCoordinate < vec3<i32>(0))
            || any(neighborCoordinate >= vec3<i32>(cellsPerAxis))) { continue; }
        let neighbor = encodeMorton3D(vec3<u32>(neighborCoordinate), params.depth);
        let start = leafOffsets[neighbor];
        let count = leafCounts[neighbor];
        for (var offset = 0u; offset < count; offset += 1u) {
          let sourceParticle = sortedParticleIndices[start + offset];
          if (sourceParticle == particle) { continue; }
          let delta = positions[sourceParticle].xyz - position;
          let distanceSquared = dot(delta, delta) + softSquared;
          let inverseDistance = inverseSqrt(distanceSquared);
          let inverseDistance3 = inverseDistance * inverseDistance * inverseDistance;
          let source = extractMass(
            particleMeta[sourceParticle].w,
            params.defaultSource,
            params.useParticleMass,
          );
          acceleration += delta * (params.coupling * source * inverseDistance3);
        }
      }
    }
  }

  let accelerationLength = length(acceleration);
  if (accelerationLength > params.maxAcceleration) {
    acceleration *= params.maxAcceleration / accelerationLength;
  }
  let velocity4 = velocities[particle];
  velocities[particle] = vec4<f32>(
    (velocity4.xyz + acceleration * params.dt) * params.damping,
    velocity4.w,
  );
}
`;

function createPipeline(device, label, code, entryPoint) {
  const module = device.createShaderModule({ label: `${label}.shader`, code });
  return device.createComputePipeline({
    label: `${label}.pipeline`,
    layout: 'auto',
    compute: { module, entryPoint },
  });
}

function createLevelParams(device, depth) {
  const buffers = [];
  for (let level = 0; level <= depth; level += 1) {
    const buffer = createUniformBuffer(device, LEVEL_PARAMS_BYTES, { label: `FMM.level.${level}` });
    const data = new Uint32Array([
      level,
      fmmLevelOffset(level),
      fmmLevelCellCount(level),
      level > 0 ? fmmLevelOffset(level - 1) : 0,
    ]);
    device.queue.writeBuffer(buffer, 0, data);
    buffers.push(buffer);
  }
  return buffers;
}

function bindGroup(device, pipeline, label, entries) {
  return device.createBindGroup({
    label,
    layout: pipeline.getBindGroupLayout(0),
    entries: entries.map((buffer, binding) => ({ binding, resource: { buffer } })),
  });
}

export function createFmmSystem(device, maxParticles, options = {}) {
  if (!device?.createComputePipeline) throw new TypeError('createFmmSystem requires a GPUDevice.');
  const config = normalizeFmmConfig({ ...options, particleCount: maxParticles });
  const memory = estimateFmmMemory(config);
  const limits = device.limits || {};
  const largestBuffer = Math.max(
    memory.breakdown.locals,
    memory.breakdown.moments,
    memory.breakdown.sortedParticleIndices,
  );
  if (limits.maxStorageBufferBindingSize && largestBuffer > limits.maxStorageBufferBindingSize) {
    throw new RangeError(`FMM requires a ${largestBuffer}-byte storage binding; device limit is ${limits.maxStorageBufferBindingSize}.`);
  }

  const pipelines = {
    assign: createPipeline(device, 'FMM.assign', ASSIGN_SHADER, 'assignLeaves'),
    prefix: createPipeline(device, 'FMM.prefix', PREFIX_SHADER, 'scanLeafCounts'),
    scatter: createPipeline(device, 'FMM.scatter', SCATTER_SHADER, 'scatterParticles'),
    p2m: createPipeline(device, 'FMM.p2m', P2M_SHADER, 'particlesToMultipoles'),
    m2m: createPipeline(device, 'FMM.m2m', M2M_SHADER, 'multipoleToMultipole'),
    m2l: createPipeline(device, 'FMM.m2l', M2L_SHADER, 'multipoleToLocal'),
    l2l: createPipeline(device, 'FMM.l2l', L2L_SHADER, 'localToLocal'),
    evaluate: createPipeline(device, 'FMM.evaluate', EVALUATE_SHADER, 'evaluateParticles'),
  };

  const buffers = {
    params: createUniformBuffer(device, GLOBAL_PARAMS_BYTES, { label: 'FMM.params' }),
    moments: createStorageBuffer(device, memory.breakdown.moments, { label: 'FMM.moments' }),
    locals: createStorageBuffer(device, memory.breakdown.locals, { label: 'FMM.locals' }),
    leafCounts: createStorageBuffer(device, memory.breakdown.leafCounts, { label: 'FMM.leafCounts' }),
    leafOffsets: createStorageBuffer(device, memory.breakdown.leafOffsets, { label: 'FMM.leafOffsets' }),
    leafCursors: createStorageBuffer(device, memory.breakdown.leafCursors, { label: 'FMM.leafCursors' }),
    particleLeafKeys: createStorageBuffer(device, memory.breakdown.particleLeafKeys, { label: 'FMM.particleLeafKeys' }),
    sortedParticleIndices: createStorageBuffer(device, memory.breakdown.sortedParticleIndices, { label: 'FMM.sortedParticleIndices' }),
    diagnostics: createStorageBuffer(device, memory.breakdown.diagnostics, { label: 'FMM.diagnostics' }),
    diagnosticReadback: device.createBuffer({
      label: 'FMM.diagnosticReadback',
      size: memory.breakdown.diagnostics,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    }),
  };
  Object.entries(buffers).forEach(([name, buffer]) => labelResource(buffer, `FMM.${name}`));
  const levelParams = createLevelParams(device, config.depth);

  return {
    device,
    maxParticles,
    config,
    memory,
    pipelines,
    buffers,
    levelParams,
    bindGroups: null,
    _paramsBytes: new ArrayBuffer(GLOBAL_PARAMS_BYTES),
    _diagnosticReadPending: null,
    lastExecution: null,
  };
}

export function initFmmBindGroups(
  system,
  device,
  positionBuffer,
  velocityBuffer,
  metaBuffer,
  thermalBuffer,
) {
  if (!system || device !== system.device) throw new TypeError('FMM system and GPUDevice do not match.');
  const { pipelines, buffers, levelParams } = system;
  const common = {
    positionBuffer,
    velocityBuffer,
    metaBuffer,
    thermalBuffer,
  };
  const m2m = [];
  const m2l = [];
  const l2l = [];
  for (let level = 0; level <= system.config.depth; level += 1) {
    m2m[level] = bindGroup(device, pipelines.m2m, `FMM.m2m.bindGroup.${level}`, [
      buffers.params, levelParams[level], buffers.moments,
    ]);
    m2l[level] = bindGroup(device, pipelines.m2l, `FMM.m2l.bindGroup.${level}`, [
      buffers.params, levelParams[level], buffers.moments, buffers.locals,
    ]);
    l2l[level] = bindGroup(device, pipelines.l2l, `FMM.l2l.bindGroup.${level}`, [
      buffers.params, levelParams[level], buffers.locals,
    ]);
  }
  system.bindGroups = {
    assign: bindGroup(device, pipelines.assign, 'FMM.assign.bindGroup', [
      buffers.params,
      positionBuffer,
      velocityBuffer,
      thermalBuffer,
      buffers.leafCounts,
      buffers.particleLeafKeys,
      buffers.diagnostics,
    ]),
    prefix: bindGroup(device, pipelines.prefix, 'FMM.prefix.bindGroup', [
      buffers.params, buffers.leafCounts, buffers.leafOffsets,
    ]),
    scatter: bindGroup(device, pipelines.scatter, 'FMM.scatter.bindGroup', [
      buffers.params,
      buffers.leafOffsets,
      buffers.leafCursors,
      buffers.particleLeafKeys,
      buffers.sortedParticleIndices,
      buffers.diagnostics,
    ]),
    p2m: bindGroup(device, pipelines.p2m, 'FMM.p2m.bindGroup', [
      buffers.params,
      positionBuffer,
      metaBuffer,
      buffers.leafOffsets,
      buffers.leafCounts,
      buffers.sortedParticleIndices,
      buffers.moments,
      buffers.diagnostics,
    ]),
    m2m,
    m2l,
    l2l,
    evaluate: bindGroup(device, pipelines.evaluate, 'FMM.evaluate.bindGroup', [
      buffers.params,
      positionBuffer,
      velocityBuffer,
      metaBuffer,
      buffers.leafOffsets,
      buffers.leafCounts,
      buffers.sortedParticleIndices,
      buffers.particleLeafKeys,
      buffers.locals,
    ]),
  };
  system.resources = common;
  return system;
}

export function setFmmParams(system, config = {}) {
  if (!system) return null;
  const next = normalizeFmmConfig({
    ...system.config,
    ...config,
    particleCount: system.maxParticles,
    depth: config.depth ?? system.config.depth,
  });
  if (next.depth !== system.config.depth) {
    throw new RangeError('Changing FMM depth requires recreating the FMM system.');
  }
  system.config = next;
  return next;
}

function uploadGlobalParams(system, particleCount, dt) {
  const bytes = system._paramsBytes;
  const u32 = new Uint32Array(bytes);
  const f32 = new Float32Array(bytes);
  const { config, memory } = system;
  u32[0] = particleCount;
  u32[1] = config.depth;
  u32[2] = memory.leaves;
  u32[3] = memory.cells;
  u32[4] = fmmLevelOffset(config.depth);
  u32[5] = config.useParticleMass ? 1 : 0;
  u32[6] = 0;
  u32[7] = 0;
  f32[8] = config.domainHalfExtent;
  f32[9] = config.softening;
  f32[10] = config.coupling;
  f32[11] = dt;
  f32[12] = config.maxAcceleration;
  f32[13] = config.damping;
  f32[14] = config.defaultSource;
  f32[15] = 0;
  system.device.queue.writeBuffer(system.buffers.params, 0, new Uint8Array(bytes));
}

function encodeCompute(encoder, label, pipeline, group, workgroups) {
  const pass = encoder.beginComputePass({ label });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, group);
  pass.dispatchWorkgroups(Math.max(1, workgroups));
  pass.end();
}

export function executeFmm(system, device, particleCount, dt, options = {}) {
  if (!system?.bindGroups || particleCount <= 0) return null;
  if (device !== system.device) throw new TypeError('FMM execution GPUDevice does not match its system.');
  const count = Math.trunc(Number(particleCount));
  if (!Number.isFinite(count) || count < 1 || count > system.maxParticles) {
    throw new RangeError(`particleCount must be in [1, ${system.maxParticles}].`);
  }
  const step = Number(dt);
  if (!Number.isFinite(step) || step < 0) throw new RangeError('FMM dt must be finite and nonnegative.');
  if (options.config) setFmmParams(system, options.config);
  uploadGlobalParams(system, count, step);

  const externalEncoder = options.encoder || null;
  const encoder = externalEncoder || device.createCommandEncoder({ label: 'FMM.step.encoder' });
  const { buffers, pipelines, bindGroups, config, memory } = system;
  encoder.clearBuffer(buffers.leafCounts);
  encoder.clearBuffer(buffers.leafCursors);
  encoder.clearBuffer(buffers.moments);
  encoder.clearBuffer(buffers.locals);
  encoder.clearBuffer(buffers.diagnostics);

  const particleWorkgroups = Math.ceil(count / WORKGROUP_SIZE);
  const leafWorkgroups = Math.ceil(memory.leaves / WORKGROUP_SIZE);
  encodeCompute(encoder, 'FMM.assign', pipelines.assign, bindGroups.assign, particleWorkgroups);
  encodeCompute(encoder, 'FMM.prefix', pipelines.prefix, bindGroups.prefix, 1);
  encodeCompute(encoder, 'FMM.scatter', pipelines.scatter, bindGroups.scatter, particleWorkgroups);
  encodeCompute(encoder, 'FMM.p2m', pipelines.p2m, bindGroups.p2m, leafWorkgroups);

  let passCount = 4;
  for (let level = config.depth - 1; level >= 0; level -= 1) {
    encodeCompute(
      encoder,
      `FMM.m2m.level${level}`,
      pipelines.m2m,
      bindGroups.m2m[level],
      Math.ceil(fmmLevelCellCount(level) / WORKGROUP_SIZE),
    );
    passCount += 1;
  }
  for (let level = 2; level <= config.depth; level += 1) {
    encodeCompute(
      encoder,
      `FMM.m2l.level${level}`,
      pipelines.m2l,
      bindGroups.m2l[level],
      Math.ceil(fmmLevelCellCount(level) / WORKGROUP_SIZE),
    );
    passCount += 1;
    if (level < config.depth) {
      encodeCompute(
        encoder,
        `FMM.l2l.level${level + 1}`,
        pipelines.l2l,
        bindGroups.l2l[level + 1],
        Math.ceil(fmmLevelCellCount(level + 1) / WORKGROUP_SIZE),
      );
      passCount += 1;
    }
  }
  encodeCompute(encoder, 'FMM.evaluate', pipelines.evaluate, bindGroups.evaluate, particleWorkgroups);
  passCount += 1;

  if (!externalEncoder) device.queue.submit([encoder.finish()]);
  system.lastExecution = Object.freeze({
    particleCount: count,
    depth: config.depth,
    leafCount: memory.leaves,
    cellCount: memory.cells,
    passCount,
    encoded: true,
    submitted: !externalEncoder,
  });
  return system.lastExecution;
}

export async function readFmmDiagnostics(system) {
  if (!system) return null;
  if (system._diagnosticReadPending) return system._diagnosticReadPending;
  system._diagnosticReadPending = (async () => {
    const { device, buffers } = system;
    const encoder = device.createCommandEncoder({ label: 'FMM.diagnostics.encoder' });
    encoder.copyBufferToBuffer(buffers.diagnostics, 0, buffers.diagnosticReadback, 0, 16);
    device.queue.submit([encoder.finish()]);
    await buffers.diagnosticReadback.mapAsync(GPUMapMode.READ, 0, 16);
    const copy = new Uint32Array(buffers.diagnosticReadback.getMappedRange(0, 16)).slice();
    buffers.diagnosticReadback.unmap();
    return Object.freeze({
      assignedParticles: copy[0],
      clampedParticles: copy[1],
      maximumLeafOccupancy: copy[2],
      scatteredParticles: copy[3],
      complete: copy[0] === copy[3],
    });
  })().finally(() => {
    system._diagnosticReadPending = null;
  });
  return system._diagnosticReadPending;
}

export function destroyFmmSystem(system) {
  if (!system) return;
  destroyBuffers([...Object.values(system.buffers || {}), ...(system.levelParams || [])]);
  system.bindGroups = null;
  system.resources = null;
  system.pipelines = null;
}

export default {
  createFmmSystem,
  initFmmBindGroups,
  setFmmParams,
  executeFmm,
  readFmmDiagnostics,
  destroyFmmSystem,
};
