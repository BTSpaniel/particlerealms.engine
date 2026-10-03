// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Periodic particle-mesh Ewald solver with cubic B-spline PME and an
 * experimental numerically sampled prolate-spheroidal (ESP) split and window.
 *
 * The solver uses exact integer cell counting/scatter, a separable 3D complex
 * FFT, reciprocal-space screened Poisson solve, interpolated mesh gradients,
 * and the complementary short-range Ewald force.
 */

import { createStorageBuffer, createUniformBuffer, destroyBuffers } from '../../core/gpu/GpuBuffer.js';
import { labelResource } from '../../core/gpu/GpuDebug.js';
import { createComplexFftPipelines, createComplexFftPlan } from '../../core/gpu/ComplexFft.js';
import {
  PARTICLE_LONG_RANGE_BACKENDS,
  PARTICLE_MESH_WINDOW_SAMPLES,
  estimateParticleMeshMemory,
  generateProlateSplitTable,
  generateProlateWindowTable,
  normalizeParticleMeshConfig,
  prolateSplitFourierResponse,
} from './ParticleLongRangeMath.js';

const WORKGROUP_SIZE = 128;
const GLOBAL_PARAMS_BYTES = 96;
const INVALID_CELL = 0xffffffff;
const TARGET_DISABLED_MASK = 0x80000000;
const CELL_INDEX_MASK = 0x7fffffff;

const COMMON_WGSL = /* wgsl */`
struct MeshParams {
  particleCount: u32,
  gridSize: u32,
  cellCount: u32,
  useParticleMass: u32,

  windowMode: u32,
  windowRadius: u32,
  realCellRadius: u32,
  windowSamples: u32,

  domainHalfExtent: f32,
  coupling: f32,
  dt: f32,
  maxAcceleration: f32,

  damping: f32,
  defaultSource: f32,
  cellWidth: f32,
  inverseCellVolume: f32,

  ewaldAlpha: f32,
  realCutoff: f32,
  deconvolutionLimit: f32,
  inverseCellCount: f32,

  _pad0: f32,
  _pad1: f32,
  _pad2: f32,
  _pad3: f32,
};

fn extractMass(metaW: f32, defaultSource: f32, useParticleMass: u32) -> f32 {
  if (useParticleMass == 0u) { return defaultSource; }
  let massEncoded = floor(metaW / 1e8) % 100.0;
  return max(0.1, massEncoded * 0.1);
}

fn flattenCell(coordinate: vec3<u32>, size: u32) -> u32 {
  return coordinate.x + size * (coordinate.y + size * coordinate.z);
}

fn decodeCell(index: u32, size: u32) -> vec3<u32> {
  return vec3<u32>(index % size, (index / size) % size, index / (size * size));
}

fn wrapCell(value: i32, size: i32) -> u32 {
  return u32(((value % size) + size) % size);
}

fn periodicGridDelta(value: f32, size: f32) -> f32 {
  return value - round(value / size) * size;
}
`;

const ASSIGN_SHADER = /* wgsl */`
${COMMON_WGSL}

@group(0) @binding(0) var<uniform> params: MeshParams;
@group(0) @binding(1) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> velocities: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> thermalData: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read_write> cellCounts: array<atomic<u32>>;
@group(0) @binding(5) var<storage, read_write> particleCellKeys: array<u32>;
@group(0) @binding(6) var<storage, read_write> diagnostics: array<atomic<u32>>;

@compute @workgroup_size(${WORKGROUP_SIZE})
fn assignCells(@builtin(global_invocation_id) gid: vec3<u32>) {
  let particle = gid.x;
  if (particle >= params.particleCount) { return; }
  let position4 = positions[particle];
  let velocity4 = velocities[particle];
  if (position4.w >= velocity4.w) {
    particleCellKeys[particle] = ${INVALID_CELL}u;
    return;
  }
  let extent = 2.0 * params.domainHalfExtent;
  let fractional = fract((position4.xyz + vec3<f32>(params.domainHalfExtent)) / extent);
  let coordinate = vec3<u32>(floor(fractional * f32(params.gridSize)));
  let cell = flattenCell(coordinate, params.gridSize);
  let phase = thermalData[particle].y;
  let targetDisabled = phase > 0.5 && phase < 2.5;
  particleCellKeys[particle] = cell | select(0u, ${TARGET_DISABLED_MASK}u, targetDisabled);
  atomicAdd(&cellCounts[cell], 1u);
  atomicAdd(&diagnostics[0], 1u);
  if (targetDisabled) { atomicAdd(&diagnostics[1], 1u); }
}
`;

const PREFIX_SHADER = /* wgsl */`
${COMMON_WGSL}

@group(0) @binding(0) var<uniform> params: MeshParams;
@group(0) @binding(1) var<storage, read> cellCounts: array<u32>;
@group(0) @binding(2) var<storage, read_write> cellOffsets: array<u32>;

@compute @workgroup_size(1)
fn scanCellCounts() {
  var running = 0u;
  for (var cell = 0u; cell < params.cellCount; cell += 1u) {
    cellOffsets[cell] = running;
    running += cellCounts[cell];
  }
  cellOffsets[params.cellCount] = running;
}
`;

const SCATTER_SHADER = /* wgsl */`
${COMMON_WGSL}

@group(0) @binding(0) var<uniform> params: MeshParams;
@group(0) @binding(1) var<storage, read> cellOffsets: array<u32>;
@group(0) @binding(2) var<storage, read_write> cellCursors: array<atomic<u32>>;
@group(0) @binding(3) var<storage, read> particleCellKeys: array<u32>;
@group(0) @binding(4) var<storage, read_write> sortedParticleIndices: array<u32>;
@group(0) @binding(5) var<storage, read_write> diagnostics: array<atomic<u32>>;

@compute @workgroup_size(${WORKGROUP_SIZE})
fn scatterParticles(@builtin(global_invocation_id) gid: vec3<u32>) {
  let particle = gid.x;
  if (particle >= params.particleCount) { return; }
  let key = particleCellKeys[particle];
  if (key == ${INVALID_CELL}u) { return; }
  let cell = key & ${CELL_INDEX_MASK}u;
  let localOffset = atomicAdd(&cellCursors[cell], 1u);
  sortedParticleIndices[cellOffsets[cell] + localOffset] = particle;
  atomicAdd(&diagnostics[3], 1u);
}
`;

const DEPOSIT_SHADER = /* wgsl */`
${COMMON_WGSL}

@group(0) @binding(0) var<uniform> params: MeshParams;
@group(0) @binding(1) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> particleMeta: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> cellOffsets: array<u32>;
@group(0) @binding(4) var<storage, read> cellCounts: array<u32>;
@group(0) @binding(5) var<storage, read> sortedParticleIndices: array<u32>;
struct ProlateTables {
  assignment: array<vec4<f32>, 64>,
  splitDensity: array<vec4<f32>, 64>,
  splitComplement: array<vec4<f32>, 64>,
};
@group(0) @binding(6) var<uniform> windowTable: ProlateTables;
@group(0) @binding(7) var<storage, read_write> spectrum: array<vec2<f32>>;
@group(0) @binding(8) var<storage, read_write> diagnostics: array<atomic<u32>>;

fn cubicBSpline(distance: f32) -> f32 {
  let value = abs(distance);
  if (value < 1.0) { return (4.0 - 6.0 * value * value + 3.0 * value * value * value) / 6.0; }
  if (value < 2.0) { return pow(2.0 - value, 3.0) / 6.0; }
  return 0.0;
}

fn prolateWeight(distance: f32) -> f32 {
  let unit = abs(distance) / f32(params.windowRadius);
  if (unit >= 1.0) { return 0.0; }
  let tablePosition = unit * f32(params.windowSamples - 1u);
  let lower = u32(floor(tablePosition));
  let upper = min(lower + 1u, params.windowSamples - 1u);
  let lowerValue = windowTable.assignment[lower >> 2u][lower & 3u];
  let upperValue = windowTable.assignment[upper >> 2u][upper & 3u];
  return mix(lowerValue, upperValue, fract(tablePosition));
}

fn assignmentWeight(distance: f32) -> f32 {
  if (params.windowMode == 0u) { return cubicBSpline(distance); }
  return prolateWeight(distance);
}

fn axisNormalization(particleCoordinate: f32) -> f32 {
  let base = i32(floor(particleCoordinate));
  let radius = i32(params.windowRadius);
  var sum = 0.0;
  for (var offset = -radius; offset <= radius; offset += 1) {
    let delta = periodicGridDelta(f32(base + offset) - particleCoordinate, f32(params.gridSize));
    sum += assignmentWeight(delta);
  }
  return max(sum, 1e-8);
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn depositDensity(@builtin(global_invocation_id) gid: vec3<u32>) {
  let targetCell = gid.x;
  if (targetCell >= params.cellCount) { return; }
  let targetCoordinate = vec3<i32>(decodeCell(targetCell, params.gridSize));
  let radius = i32(params.windowRadius);
  let size = i32(params.gridSize);
  let extent = 2.0 * params.domainHalfExtent;
  var density = 0.0;

  for (var dz = -radius; dz <= radius; dz += 1) {
    for (var dy = -radius; dy <= radius; dy += 1) {
      for (var dx = -radius; dx <= radius; dx += 1) {
        let sourceCoordinate = vec3<u32>(
          wrapCell(targetCoordinate.x + dx, size),
          wrapCell(targetCoordinate.y + dy, size),
          wrapCell(targetCoordinate.z + dz, size),
        );
        let sourceCell = flattenCell(sourceCoordinate, params.gridSize);
        let start = cellOffsets[sourceCell];
        let count = cellCounts[sourceCell];
        for (var offset = 0u; offset < count; offset += 1u) {
          let particle = sortedParticleIndices[start + offset];
          let fractional = fract((positions[particle].xyz + vec3<f32>(params.domainHalfExtent)) / extent);
          let particleGrid = fractional * f32(params.gridSize);
          let delta = vec3<f32>(
            periodicGridDelta(f32(targetCoordinate.x) - particleGrid.x, f32(params.gridSize)),
            periodicGridDelta(f32(targetCoordinate.y) - particleGrid.y, f32(params.gridSize)),
            periodicGridDelta(f32(targetCoordinate.z) - particleGrid.z, f32(params.gridSize)),
          );
          let weight = assignmentWeight(delta.x) * assignmentWeight(delta.y) * assignmentWeight(delta.z);
          if (weight <= 0.0) { continue; }
          let normalization = axisNormalization(particleGrid.x)
            * axisNormalization(particleGrid.y)
            * axisNormalization(particleGrid.z);
          let source = extractMass(particleMeta[particle].w, params.defaultSource, params.useParticleMass);
          density += source * weight / normalization;
        }
      }
    }
  }
  spectrum[targetCell] = vec2<f32>(density * params.inverseCellVolume, 0.0);
  atomicMax(&diagnostics[2], cellCounts[targetCell]);
}
`;

const SPECTRAL_SOLVE_SHADER = /* wgsl */`
${COMMON_WGSL}

@group(0) @binding(0) var<uniform> params: MeshParams;
@group(0) @binding(1) var<storage, read_write> spectrum: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read> windowSpectrum: array<f32>;
@group(0) @binding(3) var<storage, read> splitSpectrum: array<f32>;

fn sinc(value: f32) -> f32 {
  if (abs(value) < 1e-6) { return 1.0; }
  return sin(value) / value;
}

fn signedMode(coordinate: u32) -> i32 {
  return select(i32(coordinate), i32(coordinate) - i32(params.gridSize), coordinate > params.gridSize / 2u);
}

fn axisWindowResponse(coordinate: u32, mode: i32) -> f32 {
  if (params.windowMode != 0u) { return windowSpectrum[coordinate]; }
  let argument = 3.141592653589793 * f32(mode) / f32(params.gridSize);
  return pow(sinc(argument), 4.0);
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn solveReciprocalPotential(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= params.cellCount) { return; }
  let coordinate = decodeCell(index, params.gridSize);
  let modes = vec3<i32>(signedMode(coordinate.x), signedMode(coordinate.y), signedMode(coordinate.z));
  if (all(modes == vec3<i32>(0))) {
    spectrum[index] = vec2<f32>(0.0);
    return;
  }
  let extent = 2.0 * params.domainHalfExtent;
  let wave = 6.283185307179586 * vec3<f32>(modes) / extent;
  let waveSquared = dot(wave, wave);
  let assignmentResponse = axisWindowResponse(coordinate.x, modes.x)
    * axisWindowResponse(coordinate.y, modes.y)
    * axisWindowResponse(coordinate.z, modes.z);
  let deconvolution = min(
    params.deconvolutionLimit,
    1.0 / max(assignmentResponse * assignmentResponse, 1.0 / params.deconvolutionLimit),
  );
  let gaussianScreening = exp(-waveSquared / (4.0 * params.ewaldAlpha * params.ewaldAlpha));
  let screening = select(gaussianScreening, splitSpectrum[index], params.windowMode != 0u);
  let green = -12.566370614359172 * params.coupling * screening * deconvolution / waveSquared;
  spectrum[index] *= green;
}
`;

const GATHER_SHADER = /* wgsl */`
${COMMON_WGSL}

@group(0) @binding(0) var<uniform> params: MeshParams;
@group(0) @binding(1) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> velocities: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> particleMeta: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read> cellOffsets: array<u32>;
@group(0) @binding(5) var<storage, read> cellCounts: array<u32>;
@group(0) @binding(6) var<storage, read> sortedParticleIndices: array<u32>;
@group(0) @binding(7) var<storage, read> particleCellKeys: array<u32>;
@group(0) @binding(8) var<storage, read> potential: array<vec2<f32>>;
struct ProlateTables {
  assignment: array<vec4<f32>, 64>,
  splitDensity: array<vec4<f32>, 64>,
  splitComplement: array<vec4<f32>, 64>,
};
@group(0) @binding(9) var<uniform> windowTable: ProlateTables;

fn cubicBSpline(distance: f32) -> f32 {
  let value = abs(distance);
  if (value < 1.0) { return (4.0 - 6.0 * value * value + 3.0 * value * value * value) / 6.0; }
  if (value < 2.0) { return pow(2.0 - value, 3.0) / 6.0; }
  return 0.0;
}

fn prolateWeight(distance: f32) -> f32 {
  let unit = abs(distance) / f32(params.windowRadius);
  if (unit >= 1.0) { return 0.0; }
  let tablePosition = unit * f32(params.windowSamples - 1u);
  let lower = u32(floor(tablePosition));
  let upper = min(lower + 1u, params.windowSamples - 1u);
  let lowerValue = windowTable.assignment[lower >> 2u][lower & 3u];
  let upperValue = windowTable.assignment[upper >> 2u][upper & 3u];
  return mix(lowerValue, upperValue, fract(tablePosition));
}

fn prolateSplitValues(unitDistance: f32) -> vec2<f32> {
  let tablePosition = clamp(unitDistance, 0.0, 1.0) * f32(params.windowSamples - 1u);
  let lower = u32(floor(tablePosition));
  let upper = min(lower + 1u, params.windowSamples - 1u);
  let lane0 = lower & 3u;
  let lane1 = upper & 3u;
  let density0 = windowTable.splitDensity[lower >> 2u][lane0];
  let density1 = windowTable.splitDensity[upper >> 2u][lane1];
  let complement0 = windowTable.splitComplement[lower >> 2u][lane0];
  let complement1 = windowTable.splitComplement[upper >> 2u][lane1];
  return mix(vec2<f32>(density0, complement0), vec2<f32>(density1, complement1), fract(tablePosition));
}

fn assignmentWeight(distance: f32) -> f32 {
  if (params.windowMode == 0u) { return cubicBSpline(distance); }
  return prolateWeight(distance);
}

fn erfcApproximation(value: f32) -> f32 {
  let t = 1.0 / (1.0 + 0.3275911 * value);
  let polynomial = (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t
    - 0.284496736) * t + 0.254829592) * t;
  return polynomial * exp(-value * value);
}

fn potentialValue(coordinate: vec3<i32>) -> f32 {
  let size = i32(params.gridSize);
  let wrapped = vec3<u32>(
    wrapCell(coordinate.x, size),
    wrapCell(coordinate.y, size),
    wrapCell(coordinate.z, size),
  );
  return potential[flattenCell(wrapped, params.gridSize)].x * params.inverseCellCount;
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn gatherForces(@builtin(global_invocation_id) gid: vec3<u32>) {
  let particle = gid.x;
  if (particle >= params.particleCount) { return; }
  let key = particleCellKeys[particle];
  if (key == ${INVALID_CELL}u || (key & ${TARGET_DISABLED_MASK}u) != 0u) { return; }
  let position = positions[particle].xyz;
  let extent = 2.0 * params.domainHalfExtent;
  let fractional = fract((position + vec3<f32>(params.domainHalfExtent)) / extent);
  let particleGrid = fractional * f32(params.gridSize);
  let base = vec3<i32>(floor(particleGrid));
  let windowRadius = i32(params.windowRadius);
  var reciprocalAcceleration = vec3<f32>(0.0);
  var weightSum = 0.0;

  for (var dz = -windowRadius; dz <= windowRadius; dz += 1) {
    for (var dy = -windowRadius; dy <= windowRadius; dy += 1) {
      for (var dx = -windowRadius; dx <= windowRadius; dx += 1) {
        let node = base + vec3<i32>(dx, dy, dz);
        let delta = vec3<f32>(
          periodicGridDelta(f32(node.x) - particleGrid.x, f32(params.gridSize)),
          periodicGridDelta(f32(node.y) - particleGrid.y, f32(params.gridSize)),
          periodicGridDelta(f32(node.z) - particleGrid.z, f32(params.gridSize)),
        );
        let weight = assignmentWeight(delta.x) * assignmentWeight(delta.y) * assignmentWeight(delta.z);
        if (weight <= 0.0) { continue; }
        let gradient = vec3<f32>(
          potentialValue(node + vec3<i32>(1, 0, 0)) - potentialValue(node - vec3<i32>(1, 0, 0)),
          potentialValue(node + vec3<i32>(0, 1, 0)) - potentialValue(node - vec3<i32>(0, 1, 0)),
          potentialValue(node + vec3<i32>(0, 0, 1)) - potentialValue(node - vec3<i32>(0, 0, 1)),
        ) / (2.0 * params.cellWidth);
        reciprocalAcceleration -= gradient * weight;
        weightSum += weight;
      }
    }
  }
  reciprocalAcceleration /= max(weightSum, 1e-8);

  let targetCell = vec3<i32>(decodeCell(key & ${CELL_INDEX_MASK}u, params.gridSize));
  let realRadius = i32(params.realCellRadius);
  let size = i32(params.gridSize);
  let cutoffSquared = params.realCutoff * params.realCutoff;
  var realAcceleration = vec3<f32>(0.0);
  for (var dz = -realRadius; dz <= realRadius; dz += 1) {
    for (var dy = -realRadius; dy <= realRadius; dy += 1) {
      for (var dx = -realRadius; dx <= realRadius; dx += 1) {
        let neighborCoordinate = vec3<u32>(
          wrapCell(targetCell.x + dx, size),
          wrapCell(targetCell.y + dy, size),
          wrapCell(targetCell.z + dz, size),
        );
        let neighbor = flattenCell(neighborCoordinate, params.gridSize);
        let start = cellOffsets[neighbor];
        let count = cellCounts[neighbor];
        for (var offset = 0u; offset < count; offset += 1u) {
          let sourceParticle = sortedParticleIndices[start + offset];
          if (sourceParticle == particle) { continue; }
          var delta = positions[sourceParticle].xyz - position;
          delta -= round(delta / extent) * extent;
          let distanceSquared = dot(delta, delta);
          if (distanceSquared <= 1e-12 || distanceSquared >= cutoffSquared) { continue; }
          let inverseDistance = inverseSqrt(distanceSquared);
          let distance = distanceSquared * inverseDistance;
          var radial = 0.0;
          if (params.windowMode != 0u) {
            let split = prolateSplitValues(distance / params.realCutoff);
            radial = split.y * inverseDistance * inverseDistance * inverseDistance
              + split.x / (params.realCutoff * distanceSquared);
          } else {
            let alphaDistance = params.ewaldAlpha * distance;
            radial = erfcApproximation(alphaDistance) * inverseDistance * inverseDistance * inverseDistance
              + 1.1283791670955126 * params.ewaldAlpha * exp(-alphaDistance * alphaDistance) / distanceSquared;
          }
          let source = extractMass(
            particleMeta[sourceParticle].w,
            params.defaultSource,
            params.useParticleMass,
          );
          realAcceleration += delta * (params.coupling * source * radial);
        }
      }
    }
  }

  var acceleration = reciprocalAcceleration + realAcceleration;
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

function bindGroup(device, pipeline, label, buffers) {
  return device.createBindGroup({
    label,
    layout: pipeline.getBindGroupLayout(0),
    entries: buffers.map((buffer, binding) => ({ binding, resource: { buffer } })),
  });
}

function sampleTable(table, unit) {
  const position = Math.min(1, Math.max(0, unit)) * (table.length - 1);
  const lower = Math.floor(position);
  const upper = Math.min(lower + 1, table.length - 1);
  return table[lower] + (table[upper] - table[lower]) * (position - lower);
}

function generateWindowSpectrum(config, table) {
  const response = new Float32Array(config.gridSize);
  if (config.backend === PARTICLE_LONG_RANGE_BACKENDS.PME) {
    response.fill(1);
    return response;
  }
  const integrationSteps = 1024;
  const step = (2 * config.windowRadius) / integrationSteps;
  let zeroMode = 0;
  for (let sample = 0; sample <= integrationSteps; sample += 1) {
    const x = -config.windowRadius + sample * step;
    const weight = sampleTable(table, Math.abs(x) / config.windowRadius);
    zeroMode += weight * (sample === 0 || sample === integrationSteps ? 0.5 : 1);
  }
  for (let coordinate = 0; coordinate < config.gridSize; coordinate += 1) {
    const mode = coordinate > config.gridSize / 2 ? coordinate - config.gridSize : coordinate;
    let value = 0;
    for (let sample = 0; sample <= integrationSteps; sample += 1) {
      const x = -config.windowRadius + sample * step;
      const weight = sampleTable(table, Math.abs(x) / config.windowRadius);
      const quadrature = sample === 0 || sample === integrationSteps ? 0.5 : 1;
      value += weight * Math.cos((2 * Math.PI * mode * x) / config.gridSize) * quadrature;
    }
    response[coordinate] = Math.max(1e-4, Math.abs(value / zeroMode));
  }
  return response;
}

function generateSplitSpectrum(config, splitDensity) {
  const response = new Float32Array(config.gridSize ** 3);
  if (config.backend === PARTICLE_LONG_RANGE_BACKENDS.PME) {
    response.fill(1);
    return response;
  }
  const extent = 2 * config.domainHalfExtent;
  const waveScale = (2 * Math.PI * config.realCutoff) / extent;
  const cache = new Map();
  let index = 0;
  for (let z = 0; z < config.gridSize; z += 1) {
    const mz = z > config.gridSize / 2 ? z - config.gridSize : z;
    for (let y = 0; y < config.gridSize; y += 1) {
      const my = y > config.gridSize / 2 ? y - config.gridSize : y;
      for (let x = 0; x < config.gridSize; x += 1) {
        const mx = x > config.gridSize / 2 ? x - config.gridSize : x;
        const modeSquared = mx * mx + my * my + mz * mz;
        if (!cache.has(modeSquared)) {
          const value = prolateSplitFourierResponse(splitDensity, waveScale * Math.sqrt(modeSquared));
          cache.set(modeSquared, Math.abs(value) < 1e-7 ? 0 : value);
        }
        response[index] = cache.get(modeSquared);
        index += 1;
      }
    }
  }
  return response;
}

export function createParticleMeshEwaldSystem(device, maxParticles, options = {}) {
  if (!device?.createComputePipeline) throw new TypeError('createParticleMeshEwaldSystem requires a GPUDevice.');
  const config = normalizeParticleMeshConfig({ ...options, particleCount: maxParticles });
  const memory = estimateParticleMeshMemory(config);
  const limits = device.limits || {};
  const largestBuffer = Math.max(memory.breakdown.spectralA, memory.breakdown.cellOffsets);
  if (limits.maxStorageBufferBindingSize && largestBuffer > limits.maxStorageBufferBindingSize) {
    throw new RangeError(`Particle mesh requires a ${largestBuffer}-byte storage binding; device limit is ${limits.maxStorageBufferBindingSize}.`);
  }

  const fftPipelines = createComplexFftPipelines(device, { label: 'ParticleMesh.fft' });
  const pipelines = {
    assign: createPipeline(device, 'ParticleMesh.assign', ASSIGN_SHADER, 'assignCells'),
    prefix: createPipeline(device, 'ParticleMesh.prefix', PREFIX_SHADER, 'scanCellCounts'),
    scatter: createPipeline(device, 'ParticleMesh.scatter', SCATTER_SHADER, 'scatterParticles'),
    deposit: createPipeline(device, 'ParticleMesh.deposit', DEPOSIT_SHADER, 'depositDensity'),
    bitReverse: fftPipelines.bitReverse,
    stage: fftPipelines.stage,
    solve: createPipeline(device, 'ParticleMesh.solve', SPECTRAL_SOLVE_SHADER, 'solveReciprocalPotential'),
    gather: createPipeline(device, 'ParticleMesh.gather', GATHER_SHADER, 'gatherForces'),
  };
  const buffers = {
    params: createUniformBuffer(device, GLOBAL_PARAMS_BYTES, { label: 'ParticleMesh.params' }),
    spectralA: createStorageBuffer(device, memory.breakdown.spectralA, { label: 'ParticleMesh.spectralA' }),
    spectralB: createStorageBuffer(device, memory.breakdown.spectralB, { label: 'ParticleMesh.spectralB' }),
    cellCounts: createStorageBuffer(device, memory.breakdown.cellCounts, { label: 'ParticleMesh.cellCounts' }),
    cellOffsets: createStorageBuffer(device, memory.breakdown.cellOffsets, { label: 'ParticleMesh.cellOffsets' }),
    cellCursors: createStorageBuffer(device, memory.breakdown.cellCursors, { label: 'ParticleMesh.cellCursors' }),
    particleCellKeys: createStorageBuffer(device, memory.breakdown.particleCellKeys, { label: 'ParticleMesh.particleCellKeys' }),
    sortedParticleIndices: createStorageBuffer(device, memory.breakdown.sortedParticleIndices, { label: 'ParticleMesh.sortedParticleIndices' }),
    windowTable: createUniformBuffer(device, memory.breakdown.windowTable, { label: 'ParticleMesh.windowTable' }),
    windowSpectrum: createStorageBuffer(device, memory.breakdown.windowSpectrum, { label: 'ParticleMesh.windowSpectrum' }),
    splitSpectrum: createStorageBuffer(device, memory.breakdown.splitSpectrum, { label: 'ParticleMesh.splitSpectrum' }),
    diagnostics: createStorageBuffer(device, memory.breakdown.diagnostics, { label: 'ParticleMesh.diagnostics' }),
    diagnosticReadback: device.createBuffer({
      label: 'ParticleMesh.diagnosticReadback',
      size: memory.breakdown.diagnostics,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    }),
  };
  Object.entries(buffers).forEach(([name, buffer]) => labelResource(buffer, `ParticleMesh.${name}`));

  const windowTable = generateProlateWindowTable({
    samples: PARTICLE_MESH_WINDOW_SAMPLES,
    bandwidth: config.prolateBandwidth,
  });
  const splitTable = generateProlateSplitTable(windowTable);
  const packedWindowTables = new Float32Array(PARTICLE_MESH_WINDOW_SAMPLES * 3);
  packedWindowTables.set(windowTable, 0);
  packedWindowTables.set(splitTable.density, PARTICLE_MESH_WINDOW_SAMPLES);
  packedWindowTables.set(splitTable.complement, PARTICLE_MESH_WINDOW_SAMPLES * 2);
  device.queue.writeBuffer(buffers.windowTable, 0, packedWindowTables);
  device.queue.writeBuffer(buffers.windowSpectrum, 0, generateWindowSpectrum(config, windowTable));
  device.queue.writeBuffer(buffers.splitSpectrum, 0, generateSplitSpectrum(config, splitTable.density));
  const spectralBuffers = [buffers.spectralA, buffers.spectralB];
  const forwardPlan = createComplexFftPlan(device, {
    size: config.gridSize, dimensions: 3, inverse: false, label: 'ParticleMeshFFT',
    buffers: spectralBuffers, pipelines: fftPipelines, initialBufferIndex: 0,
  });
  const inversePlan = createComplexFftPlan(device, {
    size: config.gridSize, dimensions: 3, inverse: true, label: 'ParticleMeshFFT',
    buffers: spectralBuffers, pipelines: fftPipelines, initialBufferIndex: forwardPlan.finalBufferIndex,
  });

  return {
    device,
    maxParticles,
    config,
    memory,
    pipelines,
    buffers,
    forwardPlan,
    inversePlan,
    bindGroups: null,
    _paramsBytes: new ArrayBuffer(GLOBAL_PARAMS_BYTES),
    _diagnosticReadPending: null,
    lastExecution: null,
  };
}

export function initParticleMeshEwaldBindGroups(
  system,
  device,
  positionBuffer,
  velocityBuffer,
  metaBuffer,
  thermalBuffer,
) {
  if (!system || device !== system.device) throw new TypeError('Particle-mesh system and GPUDevice do not match.');
  const { pipelines, buffers, forwardPlan, inversePlan } = system;
  const potentialBuffer = [buffers.spectralA, buffers.spectralB][inversePlan.finalBufferIndex];
  const reciprocalBuffer = [buffers.spectralA, buffers.spectralB][forwardPlan.finalBufferIndex];
  system.bindGroups = {
    assign: bindGroup(device, pipelines.assign, 'ParticleMesh.assign.bindGroup', [
      buffers.params,
      positionBuffer,
      velocityBuffer,
      thermalBuffer,
      buffers.cellCounts,
      buffers.particleCellKeys,
      buffers.diagnostics,
    ]),
    prefix: bindGroup(device, pipelines.prefix, 'ParticleMesh.prefix.bindGroup', [
      buffers.params, buffers.cellCounts, buffers.cellOffsets,
    ]),
    scatter: bindGroup(device, pipelines.scatter, 'ParticleMesh.scatter.bindGroup', [
      buffers.params,
      buffers.cellOffsets,
      buffers.cellCursors,
      buffers.particleCellKeys,
      buffers.sortedParticleIndices,
      buffers.diagnostics,
    ]),
    deposit: bindGroup(device, pipelines.deposit, 'ParticleMesh.deposit.bindGroup', [
      buffers.params,
      positionBuffer,
      metaBuffer,
      buffers.cellOffsets,
      buffers.cellCounts,
      buffers.sortedParticleIndices,
      buffers.windowTable,
      buffers.spectralA,
      buffers.diagnostics,
    ]),
    solve: bindGroup(device, pipelines.solve, 'ParticleMesh.solve.bindGroup', [
      buffers.params, reciprocalBuffer, buffers.windowSpectrum, buffers.splitSpectrum,
    ]),
    gather: bindGroup(device, pipelines.gather, 'ParticleMesh.gather.bindGroup', [
      buffers.params,
      positionBuffer,
      velocityBuffer,
      metaBuffer,
      buffers.cellOffsets,
      buffers.cellCounts,
      buffers.sortedParticleIndices,
      buffers.particleCellKeys,
      potentialBuffer,
      buffers.windowTable,
    ]),
  };
  system.resources = { positionBuffer, velocityBuffer, metaBuffer, thermalBuffer };
  return system;
}

export function setParticleMeshEwaldParams(system, config = {}) {
  if (!system) return null;
  const next = normalizeParticleMeshConfig({
    ...system.config,
    ...config,
    particleCount: system.maxParticles,
    gridSize: config.gridSize ?? system.config.gridSize,
    backend: config.backend ?? system.config.backend,
  });
  if (next.gridSize !== system.config.gridSize || next.backend !== system.config.backend
      || next.prolateBandwidth !== system.config.prolateBandwidth
      || next.windowRadius !== system.config.windowRadius
      || (next.backend === PARTICLE_LONG_RANGE_BACKENDS.ESP
        && (next.realCutoff !== system.config.realCutoff
          || next.domainHalfExtent !== system.config.domainHalfExtent))) {
    throw new RangeError('Changing particle-mesh spectral topology requires recreation.');
  }
  system.config = next;
  return next;
}

function uploadGlobalParams(system, particleCount, dt) {
  const bytes = system._paramsBytes;
  const u32 = new Uint32Array(bytes);
  const f32 = new Float32Array(bytes);
  const { config, memory } = system;
  const cellWidth = (2 * config.domainHalfExtent) / config.gridSize;
  u32[0] = particleCount;
  u32[1] = config.gridSize;
  u32[2] = memory.cells;
  u32[3] = config.useParticleMass ? 1 : 0;
  u32[4] = config.backend === PARTICLE_LONG_RANGE_BACKENDS.ESP ? 1 : 0;
  u32[5] = Math.ceil(config.windowRadius);
  u32[6] = Math.ceil(config.realCutoff / cellWidth);
  u32[7] = PARTICLE_MESH_WINDOW_SAMPLES;
  f32[8] = config.domainHalfExtent;
  f32[9] = config.coupling;
  f32[10] = dt;
  f32[11] = config.maxAcceleration;
  f32[12] = config.damping;
  f32[13] = config.defaultSource;
  f32[14] = cellWidth;
  f32[15] = 1 / (cellWidth ** 3);
  f32[16] = config.ewaldAlpha;
  f32[17] = config.realCutoff;
  f32[18] = config.deconvolutionLimit;
  f32[19] = 1 / memory.cells;
  f32[20] = 0;
  f32[21] = 0;
  f32[22] = 0;
  f32[23] = 0;
  system.device.queue.writeBuffer(system.buffers.params, 0, new Uint8Array(bytes));
}

function encodeCompute(encoder, label, pipeline, group, workgroups) {
  const pass = encoder.beginComputePass({ label });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, group);
  pass.dispatchWorkgroups(Math.max(1, workgroups));
  pass.end();
}

export function executeParticleMeshEwald(system, device, particleCount, dt, options = {}) {
  if (!system?.bindGroups || particleCount <= 0) return null;
  if (device !== system.device) throw new TypeError('Particle-mesh execution GPUDevice does not match its system.');
  const count = Math.trunc(Number(particleCount));
  if (!Number.isFinite(count) || count < 1 || count > system.maxParticles) {
    throw new RangeError(`particleCount must be in [1, ${system.maxParticles}].`);
  }
  const step = Number(dt);
  if (!Number.isFinite(step) || step < 0) throw new RangeError('Particle-mesh dt must be finite and nonnegative.');
  if (options.config) setParticleMeshEwaldParams(system, options.config);
  uploadGlobalParams(system, count, step);

  const externalEncoder = options.encoder || null;
  const encoder = externalEncoder || device.createCommandEncoder({ label: 'ParticleMesh.step.encoder' });
  const { buffers, pipelines, bindGroups, forwardPlan, inversePlan, memory } = system;
  encoder.clearBuffer(buffers.cellCounts);
  encoder.clearBuffer(buffers.cellCursors);
  encoder.clearBuffer(buffers.spectralA);
  encoder.clearBuffer(buffers.spectralB);
  encoder.clearBuffer(buffers.diagnostics);
  const particleWorkgroups = Math.ceil(count / WORKGROUP_SIZE);
  const cellWorkgroups = Math.ceil(memory.cells / WORKGROUP_SIZE);
  encodeCompute(encoder, 'ParticleMesh.assign', pipelines.assign, bindGroups.assign, particleWorkgroups);
  encodeCompute(encoder, 'ParticleMesh.prefix', pipelines.prefix, bindGroups.prefix, 1);
  encodeCompute(encoder, 'ParticleMesh.scatter', pipelines.scatter, bindGroups.scatter, particleWorkgroups);
  encodeCompute(encoder, 'ParticleMesh.deposit', pipelines.deposit, bindGroups.deposit, cellWorkgroups);
  forwardPlan.encode(encoder);
  encodeCompute(encoder, 'ParticleMesh.solve', pipelines.solve, bindGroups.solve, cellWorkgroups);
  inversePlan.encode(encoder);
  encodeCompute(encoder, 'ParticleMesh.gather', pipelines.gather, bindGroups.gather, particleWorkgroups);
  if (!externalEncoder) device.queue.submit([encoder.finish()]);
  system.lastExecution = Object.freeze({
    backend: system.config.backend,
    particleCount: count,
    gridSize: system.config.gridSize,
    cellCount: memory.cells,
    passCount: 6 + forwardPlan.passes.length + inversePlan.passes.length,
    encoded: true,
    submitted: !externalEncoder,
  });
  return system.lastExecution;
}

export async function readParticleMeshEwaldDiagnostics(system) {
  if (!system) return null;
  if (system._diagnosticReadPending) return system._diagnosticReadPending;
  system._diagnosticReadPending = (async () => {
    const { device, buffers } = system;
    const encoder = device.createCommandEncoder({ label: 'ParticleMesh.diagnostics.encoder' });
    encoder.copyBufferToBuffer(buffers.diagnostics, 0, buffers.diagnosticReadback, 0, 16);
    device.queue.submit([encoder.finish()]);
    await buffers.diagnosticReadback.mapAsync(GPUMapMode.READ, 0, 16);
    const copy = new Uint32Array(buffers.diagnosticReadback.getMappedRange(0, 16)).slice();
    buffers.diagnosticReadback.unmap();
    return Object.freeze({
      assignedParticles: copy[0],
      phaseSkippedTargets: copy[1],
      maximumCellOccupancy: copy[2],
      scatteredParticles: copy[3],
      complete: copy[0] === copy[3],
    });
  })().finally(() => {
    system._diagnosticReadPending = null;
  });
  return system._diagnosticReadPending;
}

export function destroyParticleMeshEwaldSystem(system) {
  if (!system) return;
  const errors = [];
  try { destroyBuffers(Object.values(system.buffers || {})); }
  catch (error) { errors.push(error); }
  for (const plan of [system.forwardPlan, system.inversePlan]) {
    try { plan?.dispose(); }
    catch (error) { errors.push(error); }
  }
  system.bindGroups = null;
  system.resources = null;
  system.pipelines = null;
  if (errors.length) throw new AggregateError(errors, 'Failed to destroy particle-mesh resources.');
}

export default {
  createParticleMeshEwaldSystem,
  initParticleMeshEwaldBindGroups,
  setParticleMeshEwaldParams,
  executeParticleMeshEwald,
  readParticleMeshEwaldDiagnostics,
  destroyParticleMeshEwaldSystem,
};
