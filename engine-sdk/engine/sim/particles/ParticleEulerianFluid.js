// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ParticleEulerianFluid.js - Self-Contained Eulerian Fluid Solver (GAP 32)
 * 
 * GPU grid-based 3D fluid simulation using the Stable Fluids algorithm:
 *   1. Advect velocity field (semi-Lagrangian)
 *   2. Apply external forces (buoyancy, source injection)
 *   3. Compute divergence
 *   4. Pressure solve (Jacobi iteration)
 *   5. Subtract pressure gradient (make divergence-free)
 *   6. Advect density/temperature fields
 * 
 * Particles can sample this velocity field via the existing fluidVelocity
 * binding in ParticleSimWorld (attachFluidWorld).
 * 
 * Matches Niagara Fluids Grid3D Gas simulation.
 * 
 * Usage:
 *   const fluid = createEulerianFluidSolver(device, { gridSize: [32, 32, 32] });
 *   addFluidSource(fluid, { position: [0, 0, 0], density: 1, temperature: 500 });
 *   // Each frame:
 *   stepEulerianFluid(fluid, device, dt);
 *   // Connect to particles:
 *   attachFluidWorld(particleWorld, fluid, worldMin, worldMax);
 */

import { createStorageBuffer, createUniformBuffer, updateBuffer } from "../../core/gpu/GpuBuffer.js";
import { labelResource } from "../../core/gpu/GpuDebug.js";

// ============================================================================
// FLUID COMPUTE SHADERS
// ============================================================================

const FLUID_COMMON = /* wgsl */`
struct FluidSolverParams {
  gridDimX: u32,
  gridDimY: u32,
  gridDimZ: u32,
  totalCells: u32,

  dt: f32,
  dissipation: f32,
  viscosity: f32,
  buoyancyAlpha: f32,

  buoyancyBeta: f32,
  ambientTemp: f32,
  jacobiIterations: u32,
  sourceCount: u32,

  worldMinX: f32,
  worldMinY: f32,
  worldMinZ: f32,
  cellSize: f32,
};

// Sources: vec4(posX, posY, posZ, radius), vec4(density, temperature, velX, velY), vec4(velZ, 0, 0, 0)
struct FluidSource {
  posAndRadius: vec4<f32>,
  densityTempVelXY: vec4<f32>,
  velZPad: vec4<f32>,
};

fn idx3D(x: i32, y: i32, z: i32, dimX: u32, dimY: u32) -> u32 {
  let cx = clamp(x, 0, i32(dimX) - 1);
  let cy = clamp(y, 0, i32(dimY) - 1);
  let cz = clamp(z, 0, i32(dimY) - 1);
  return u32(cz) * dimX * dimY + u32(cy) * dimX + u32(cx);
}

fn worldToGrid(worldPos: vec3<f32>, worldMin: vec3<f32>, cellSize: f32) -> vec3<f32> {
  return (worldPos - worldMin) / cellSize;
}
`;

const ADVECT_SHADER = FLUID_COMMON + /* wgsl */`
@group(0) @binding(0) var<uniform> params: FluidSolverParams;
@group(0) @binding(1) var<storage, read> velIn: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> velOut: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> densityIn: array<f32>;
@group(0) @binding(4) var<storage, read_write> densityOut: array<f32>;
@group(0) @binding(5) var<storage, read> tempIn: array<f32>;
@group(0) @binding(6) var<storage, read_write> tempOut: array<f32>;

fn trilinearSampleVec(field: ptr<storage, array<vec4<f32>>, read>, pos: vec3<f32>) -> vec3<f32> {
  let gx = params.gridDimX; let gy = params.gridDimY;
  let p = pos - 0.5;
  let i = vec3<i32>(floor(p));
  let f = fract(p);

  let v000 = (*field)[idx3D(i.x, i.y, i.z, gx, gy)].xyz;
  let v100 = (*field)[idx3D(i.x+1, i.y, i.z, gx, gy)].xyz;
  let v010 = (*field)[idx3D(i.x, i.y+1, i.z, gx, gy)].xyz;
  let v110 = (*field)[idx3D(i.x+1, i.y+1, i.z, gx, gy)].xyz;
  let v001 = (*field)[idx3D(i.x, i.y, i.z+1, gx, gy)].xyz;
  let v101 = (*field)[idx3D(i.x+1, i.y, i.z+1, gx, gy)].xyz;
  let v011 = (*field)[idx3D(i.x, i.y+1, i.z+1, gx, gy)].xyz;
  let v111 = (*field)[idx3D(i.x+1, i.y+1, i.z+1, gx, gy)].xyz;

  let v00 = mix(v000, v100, f.x);
  let v10 = mix(v010, v110, f.x);
  let v01 = mix(v001, v101, f.x);
  let v11 = mix(v011, v111, f.x);
  let v0 = mix(v00, v10, f.y);
  let v1 = mix(v01, v11, f.y);
  return mix(v0, v1, f.z);
}

fn trilinearSampleScalar(field: ptr<storage, array<f32>, read>, pos: vec3<f32>) -> f32 {
  let gx = params.gridDimX; let gy = params.gridDimY;
  let p = pos - 0.5;
  let i = vec3<i32>(floor(p));
  let f = fract(p);

  let v000 = (*field)[idx3D(i.x, i.y, i.z, gx, gy)];
  let v100 = (*field)[idx3D(i.x+1, i.y, i.z, gx, gy)];
  let v010 = (*field)[idx3D(i.x, i.y+1, i.z, gx, gy)];
  let v110 = (*field)[idx3D(i.x+1, i.y+1, i.z, gx, gy)];
  let v001 = (*field)[idx3D(i.x, i.y, i.z+1, gx, gy)];
  let v101 = (*field)[idx3D(i.x+1, i.y, i.z+1, gx, gy)];
  let v011 = (*field)[idx3D(i.x, i.y+1, i.z+1, gx, gy)];
  let v111 = (*field)[idx3D(i.x+1, i.y+1, i.z+1, gx, gy)];

  let v00 = mix(v000, v100, f.x);
  let v10 = mix(v010, v110, f.x);
  let v01 = mix(v001, v101, f.x);
  let v11 = mix(v011, v111, f.x);
  let v0 = mix(v00, v10, f.y);
  let v1 = mix(v01, v11, f.y);
  return mix(v0, v1, f.z);
}

@compute @workgroup_size(4, 4, 4)
fn advect(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= params.gridDimX || gid.y >= params.gridDimY || gid.z >= params.gridDimZ) { return; }
  let ci = gid.z * params.gridDimX * params.gridDimY + gid.y * params.gridDimX + gid.x;

  // Semi-Lagrangian advection: trace back in time
  let pos = vec3<f32>(gid) + 0.5;
  let vel = velIn[ci].xyz;
  let backPos = pos - vel * params.dt / params.cellSize;

  // Advect velocity
  let advectedVel = trilinearSampleVec(&velIn, backPos);
  velOut[ci] = vec4<f32>(advectedVel * params.dissipation, 0.0);

  // Advect density
  densityOut[ci] = trilinearSampleScalar(&densityIn, backPos) * params.dissipation;

  // Advect temperature (decay toward ambient)
  let advectedTemp = trilinearSampleScalar(&tempIn, backPos);
  tempOut[ci] = mix(advectedTemp, params.ambientTemp, (1.0 - params.dissipation) * 0.1);
}
`;

const FORCES_SHADER = FLUID_COMMON + /* wgsl */`
@group(0) @binding(0) var<uniform> params: FluidSolverParams;
@group(0) @binding(1) var<storage, read_write> velocity: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> density: array<f32>;
@group(0) @binding(3) var<storage, read_write> temperature: array<f32>;
@group(0) @binding(4) var<storage, read> sources: array<FluidSource>;

@compute @workgroup_size(4, 4, 4)
fn applyForces(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= params.gridDimX || gid.y >= params.gridDimY || gid.z >= params.gridDimZ) { return; }
  let ci = gid.z * params.gridDimX * params.gridDimY + gid.y * params.gridDimX + gid.x;

  var vel = velocity[ci].xyz;
  var dens = density[ci];
  var temp = temperature[ci];

  // Buoyancy: hot gas rises
  let buoyancy = vec3<f32>(0.0, params.buoyancyAlpha * dens - params.buoyancyBeta * (temp - params.ambientTemp), 0.0);
  vel += buoyancy * params.dt;

  // Inject sources
  let worldPos = vec3<f32>(
    params.worldMinX + (f32(gid.x) + 0.5) * params.cellSize,
    params.worldMinY + (f32(gid.y) + 0.5) * params.cellSize,
    params.worldMinZ + (f32(gid.z) + 0.5) * params.cellSize,
  );

  for (var s = 0u; s < min(params.sourceCount, 8u); s++) {
    let src = sources[s];
    let diff = worldPos - src.posAndRadius.xyz;
    let dist = length(diff);
    let radius = src.posAndRadius.w;
    if (dist < radius) {
      let falloff = 1.0 - dist / radius;
      let ff = falloff * falloff;
      dens += src.densityTempVelXY.x * ff * params.dt;
      temp += src.densityTempVelXY.y * ff * params.dt;
      vel += vec3<f32>(src.densityTempVelXY.z, src.densityTempVelXY.w, src.velZPad.x) * ff * params.dt;
    }
  }

  velocity[ci] = vec4<f32>(vel, 0.0);
  density[ci] = max(dens, 0.0);
  temperature[ci] = max(temp, 0.0);
}
`;

const DIVERGENCE_SHADER = FLUID_COMMON + /* wgsl */`
@group(0) @binding(0) var<uniform> params: FluidSolverParams;
@group(0) @binding(1) var<storage, read> velocity: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> divergence: array<f32>;

@compute @workgroup_size(4, 4, 4)
fn computeDivergence(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= params.gridDimX || gid.y >= params.gridDimY || gid.z >= params.gridDimZ) { return; }
  let ci = gid.z * params.gridDimX * params.gridDimY + gid.y * params.gridDimX + gid.x;
  let ix = i32(gid.x); let iy = i32(gid.y); let iz = i32(gid.z);
  let gx = params.gridDimX; let gy = params.gridDimY;

  let vR = velocity[idx3D(ix+1, iy, iz, gx, gy)].x;
  let vL = velocity[idx3D(ix-1, iy, iz, gx, gy)].x;
  let vU = velocity[idx3D(ix, iy+1, iz, gx, gy)].y;
  let vD = velocity[idx3D(ix, iy-1, iz, gx, gy)].y;
  let vF = velocity[idx3D(ix, iy, iz+1, gx, gy)].z;
  let vB = velocity[idx3D(ix, iy, iz-1, gx, gy)].z;

  divergence[ci] = -0.5 * (vR - vL + vU - vD + vF - vB);
}
`;

const JACOBI_SHADER = FLUID_COMMON + /* wgsl */`
@group(0) @binding(0) var<uniform> params: FluidSolverParams;
@group(0) @binding(1) var<storage, read> divergence: array<f32>;
@group(0) @binding(2) var<storage, read> pressureIn: array<f32>;
@group(0) @binding(3) var<storage, read_write> pressureOut: array<f32>;

@compute @workgroup_size(4, 4, 4)
fn jacobiIteration(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= params.gridDimX || gid.y >= params.gridDimY || gid.z >= params.gridDimZ) { return; }
  let ci = gid.z * params.gridDimX * params.gridDimY + gid.y * params.gridDimX + gid.x;
  let ix = i32(gid.x); let iy = i32(gid.y); let iz = i32(gid.z);
  let gx = params.gridDimX; let gy = params.gridDimY;

  let pR = pressureIn[idx3D(ix+1, iy, iz, gx, gy)];
  let pL = pressureIn[idx3D(ix-1, iy, iz, gx, gy)];
  let pU = pressureIn[idx3D(ix, iy+1, iz, gx, gy)];
  let pD = pressureIn[idx3D(ix, iy-1, iz, gx, gy)];
  let pF = pressureIn[idx3D(ix, iy, iz+1, gx, gy)];
  let pB = pressureIn[idx3D(ix, iy, iz-1, gx, gy)];

  pressureOut[ci] = (pR + pL + pU + pD + pF + pB + divergence[ci]) / 6.0;
}
`;

const GRADIENT_SUB_SHADER = FLUID_COMMON + /* wgsl */`
@group(0) @binding(0) var<uniform> params: FluidSolverParams;
@group(0) @binding(1) var<storage, read> pressure: array<f32>;
@group(0) @binding(2) var<storage, read_write> velocity: array<vec4<f32>>;

@compute @workgroup_size(4, 4, 4)
fn subtractGradient(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= params.gridDimX || gid.y >= params.gridDimY || gid.z >= params.gridDimZ) { return; }
  let ci = gid.z * params.gridDimX * params.gridDimY + gid.y * params.gridDimX + gid.x;
  let ix = i32(gid.x); let iy = i32(gid.y); let iz = i32(gid.z);
  let gx = params.gridDimX; let gy = params.gridDimY;

  let gradX = 0.5 * (pressure[idx3D(ix+1, iy, iz, gx, gy)] - pressure[idx3D(ix-1, iy, iz, gx, gy)]);
  let gradY = 0.5 * (pressure[idx3D(ix, iy+1, iz, gx, gy)] - pressure[idx3D(ix, iy-1, iz, gx, gy)]);
  let gradZ = 0.5 * (pressure[idx3D(ix, iy, iz+1, gx, gy)] - pressure[idx3D(ix, iy, iz-1, gx, gy)]);

  velocity[ci] = vec4<f32>(velocity[ci].xyz - vec3<f32>(gradX, gradY, gradZ), 0.0);
}
`;

// ============================================================================
// SYSTEM
// ============================================================================

/**
 * Create a self-contained Eulerian fluid solver.
 * @param {GPUDevice} device
 * @param {Object} config
 * @param {number[]} config.gridSize - [x, y, z] grid dimensions (default [32, 32, 32])
 * @param {number[]} config.worldMin - World-space origin (default [-5, -1, -5])
 * @param {number[]} config.worldMax - World-space extent (default [5, 9, 5])
 * @param {number} config.dissipation - Velocity/density decay (default 0.995)
 * @param {number} config.buoyancyAlpha - Density weight for buoyancy (default -0.1)
 * @param {number} config.buoyancyBeta - Temperature weight for buoyancy (default 0.3)
 * @param {number} config.jacobiIterations - Pressure solver iterations (default 20)
 */
export function createEulerianFluidSolver(device, config = {}) {
  const gridSize = config.gridSize || [32, 32, 32];
  const [gx, gy, gz] = gridSize;
  const totalCells = gx * gy * gz;
  const worldMin = config.worldMin || [-5, -1, -5];
  const worldMax = config.worldMax || [5, 9, 5];
  const cellSize = (worldMax[0] - worldMin[0]) / gx;

  // Compile shaders
  const advectModule = device.createShaderModule({ label: 'Fluid.advect', code: ADVECT_SHADER });
  const forcesModule = device.createShaderModule({ label: 'Fluid.forces', code: FORCES_SHADER });
  const divModule = device.createShaderModule({ label: 'Fluid.divergence', code: DIVERGENCE_SHADER });
  const jacobiModule = device.createShaderModule({ label: 'Fluid.jacobi', code: JACOBI_SHADER });
  const gradModule = device.createShaderModule({ label: 'Fluid.gradient', code: GRADIENT_SUB_SHADER });

  // Pipelines
  const advectPipeline = device.createComputePipeline({ label: 'Fluid.advectPipe', layout: 'auto', compute: { module: advectModule, entryPoint: 'advect' } });
  const forcesPipeline = device.createComputePipeline({ label: 'Fluid.forcesPipe', layout: 'auto', compute: { module: forcesModule, entryPoint: 'applyForces' } });
  const divPipeline = device.createComputePipeline({ label: 'Fluid.divPipe', layout: 'auto', compute: { module: divModule, entryPoint: 'computeDivergence' } });
  const jacobiPipeline = device.createComputePipeline({ label: 'Fluid.jacobiPipe', layout: 'auto', compute: { module: jacobiModule, entryPoint: 'jacobiIteration' } });
  const gradPipeline = device.createComputePipeline({ label: 'Fluid.gradPipe', layout: 'auto', compute: { module: gradModule, entryPoint: 'subtractGradient' } });

  // Params uniform (64 bytes)
  const paramsBuffer = createUniformBuffer(device, 64, { label: 'Fluid.params' });
  labelResource(paramsBuffer, 'Fluid.params');

  // Field buffers (double-buffered velocity, single density/temp/pressure/divergence)
  const velA = createStorageBuffer(device, totalCells * 16, { label: 'Fluid.velA' });
  const velB = createStorageBuffer(device, totalCells * 16, { label: 'Fluid.velB' });
  const densA = createStorageBuffer(device, totalCells * 4, { label: 'Fluid.densA' });
  const densB = createStorageBuffer(device, totalCells * 4, { label: 'Fluid.densB' });
  const tempA = createStorageBuffer(device, totalCells * 4, { label: 'Fluid.tempA' });
  const tempB = createStorageBuffer(device, totalCells * 4, { label: 'Fluid.tempB' });
  const pressA = createStorageBuffer(device, totalCells * 4, { label: 'Fluid.pressA' });
  const pressB = createStorageBuffer(device, totalCells * 4, { label: 'Fluid.pressB' });
  const divBuffer = createStorageBuffer(device, totalCells * 4, { label: 'Fluid.divergence' });

  // Sources (max 8, each = 3 × vec4 = 48 bytes)
  const sourceBuffer = createStorageBuffer(device, 8 * 48, { label: 'Fluid.sources' });
  labelResource(sourceBuffer, 'Fluid.sources');

  return {
    device, paramsBuffer,
    advectPipeline, forcesPipeline, divPipeline, jacobiPipeline, gradPipeline,
    velA, velB, densA, densB, tempA, tempB, pressA, pressB, divBuffer, sourceBuffer,
    gridSize, gx, gy, gz, totalCells, worldMin, worldMax, cellSize,
    // Exposed as velocityBuffer for attachFluidWorld compatibility
    velocityBuffer: velA,
    // Config
    dissipation: config.dissipation ?? 0.995,
    buoyancyAlpha: config.buoyancyAlpha ?? -0.1,
    buoyancyBeta: config.buoyancyBeta ?? 0.3,
    ambientTemp: config.ambientTemp ?? 20,
    jacobiIterations: config.jacobiIterations ?? 20,
    sources: [],
    _bindGroupsBuilt: false,
    _advectBG: null, _forcesBG: null, _divBG: null,
    _jacobiBGA: null, _jacobiBGB: null, _gradBG: null,
    _pingPong: 0,
  };
}

/**
 * Build bind groups (call once after creation).
 */
export function initFluidBindGroups(solver) {
  const d = solver.device;

  solver._advectBG = d.createBindGroup({ label: 'Fluid.advectBG', layout: solver.advectPipeline.getBindGroupLayout(0), entries: [
    { binding: 0, resource: { buffer: solver.paramsBuffer } },
    { binding: 1, resource: { buffer: solver.velA } },
    { binding: 2, resource: { buffer: solver.velB } },
    { binding: 3, resource: { buffer: solver.densA } },
    { binding: 4, resource: { buffer: solver.densB } },
    { binding: 5, resource: { buffer: solver.tempA } },
    { binding: 6, resource: { buffer: solver.tempB } },
  ]});

  solver._forcesBG = d.createBindGroup({ label: 'Fluid.forcesBG', layout: solver.forcesPipeline.getBindGroupLayout(0), entries: [
    { binding: 0, resource: { buffer: solver.paramsBuffer } },
    { binding: 1, resource: { buffer: solver.velB } },
    { binding: 2, resource: { buffer: solver.densB } },
    { binding: 3, resource: { buffer: solver.tempB } },
    { binding: 4, resource: { buffer: solver.sourceBuffer } },
  ]});

  solver._divBG = d.createBindGroup({ label: 'Fluid.divBG', layout: solver.divPipeline.getBindGroupLayout(0), entries: [
    { binding: 0, resource: { buffer: solver.paramsBuffer } },
    { binding: 1, resource: { buffer: solver.velB } },
    { binding: 2, resource: { buffer: solver.divBuffer } },
  ]});

  solver._jacobiBGA = d.createBindGroup({ label: 'Fluid.jacobiBGA', layout: solver.jacobiPipeline.getBindGroupLayout(0), entries: [
    { binding: 0, resource: { buffer: solver.paramsBuffer } },
    { binding: 1, resource: { buffer: solver.divBuffer } },
    { binding: 2, resource: { buffer: solver.pressA } },
    { binding: 3, resource: { buffer: solver.pressB } },
  ]});
  solver._jacobiBGB = d.createBindGroup({ label: 'Fluid.jacobiBGB', layout: solver.jacobiPipeline.getBindGroupLayout(0), entries: [
    { binding: 0, resource: { buffer: solver.paramsBuffer } },
    { binding: 1, resource: { buffer: solver.divBuffer } },
    { binding: 2, resource: { buffer: solver.pressB } },
    { binding: 3, resource: { buffer: solver.pressA } },
  ]});

  solver._gradBG = d.createBindGroup({ label: 'Fluid.gradBG', layout: solver.gradPipeline.getBindGroupLayout(0), entries: [
    { binding: 0, resource: { buffer: solver.paramsBuffer } },
    { binding: 1, resource: { buffer: solver.pressA } },
    { binding: 2, resource: { buffer: solver.velB } },
  ]});

  solver._bindGroupsBuilt = true;
}

/**
 * Add a fluid source (emitter of density/temperature/velocity).
 * @param {Object} solver
 * @param {Object} source - { position, radius, density, temperature, velocity }
 */
export function addFluidSource(solver, source) {
  if (!solver || solver.sources.length >= 8) return;
  solver.sources.push({
    position: source.position || [0, 0, 0],
    radius: source.radius ?? 1.0,
    density: source.density ?? 1.0,
    temperature: source.temperature ?? 300,
    velocity: source.velocity || [0, 2, 0],
  });
  _uploadSources(solver);
}

function _uploadSources(solver) {
  const data = new Float32Array(8 * 12); // 8 sources × 12 floats
  for (let i = 0; i < solver.sources.length; i++) {
    const s = solver.sources[i];
    const b = i * 12;
    data[b+0] = s.position[0]; data[b+1] = s.position[1]; data[b+2] = s.position[2]; data[b+3] = s.radius;
    data[b+4] = s.density; data[b+5] = s.temperature; data[b+6] = s.velocity[0]; data[b+7] = s.velocity[1];
    data[b+8] = s.velocity[2]; data[b+9] = 0; data[b+10] = 0; data[b+11] = 0;
  }
  solver.device.queue.writeBuffer(solver.sourceBuffer, 0, data);
}

const _fluidParamsData = new ArrayBuffer(64);
const _fpU32 = new Uint32Array(_fluidParamsData);
const _fpF32 = new Float32Array(_fluidParamsData);

/**
 * Step the fluid simulation.
 */
export function stepEulerianFluid(solver, device, dt) {
  if (!solver || !solver._bindGroupsBuilt) return;

  // Upload params
  _fpU32[0] = solver.gx; _fpU32[1] = solver.gy; _fpU32[2] = solver.gz; _fpU32[3] = solver.totalCells;
  _fpF32[4] = dt; _fpF32[5] = solver.dissipation; _fpF32[6] = solver.viscosity || 0; _fpF32[7] = solver.buoyancyAlpha;
  _fpF32[8] = solver.buoyancyBeta; _fpF32[9] = solver.ambientTemp; _fpU32[10] = solver.jacobiIterations; _fpU32[11] = solver.sources.length;
  _fpF32[12] = solver.worldMin[0]; _fpF32[13] = solver.worldMin[1]; _fpF32[14] = solver.worldMin[2]; _fpF32[15] = solver.cellSize;
  device.queue.writeBuffer(solver.paramsBuffer, 0, new Uint8Array(_fluidParamsData));

  const wgX = Math.ceil(solver.gx / 4);
  const wgY = Math.ceil(solver.gy / 4);
  const wgZ = Math.ceil(solver.gz / 4);

  const encoder = device.createCommandEncoder({ label: 'Fluid.step' });

  // 1. Advect (velA→velB, densA→densB, tempA→tempB)
  const advPass = encoder.beginComputePass({ label: 'Fluid.advect' });
  advPass.setPipeline(solver.advectPipeline);
  advPass.setBindGroup(0, solver._advectBG);
  advPass.dispatchWorkgroups(wgX, wgY, wgZ);
  advPass.end();

  // 2. Apply forces + sources (in-place on B buffers)
  const forcePass = encoder.beginComputePass({ label: 'Fluid.forces' });
  forcePass.setPipeline(solver.forcesPipeline);
  forcePass.setBindGroup(0, solver._forcesBG);
  forcePass.dispatchWorkgroups(wgX, wgY, wgZ);
  forcePass.end();

  // 3. Compute divergence of velB
  const divPass = encoder.beginComputePass({ label: 'Fluid.divergence' });
  divPass.setPipeline(solver.divPipeline);
  divPass.setBindGroup(0, solver._divBG);
  divPass.dispatchWorkgroups(wgX, wgY, wgZ);
  divPass.end();

  device.queue.submit([encoder.finish()]);

  // 4. Jacobi pressure solve (ping-pong between pressA/pressB)
  for (let iter = 0; iter < solver.jacobiIterations; iter++) {
    const jEncoder = device.createCommandEncoder({ label: `Fluid.jacobi.${iter}` });
    const jPass = jEncoder.beginComputePass({ label: `Fluid.jacobi.${iter}` });
    jPass.setPipeline(solver.jacobiPipeline);
    jPass.setBindGroup(0, iter % 2 === 0 ? solver._jacobiBGA : solver._jacobiBGB);
    jPass.dispatchWorkgroups(wgX, wgY, wgZ);
    jPass.end();
    device.queue.submit([jEncoder.finish()]);
  }

  // 5. Subtract pressure gradient from velB
  const gradEncoder = device.createCommandEncoder({ label: 'Fluid.gradient' });
  const gradPass = gradEncoder.beginComputePass({ label: 'Fluid.gradient' });
  gradPass.setPipeline(solver.gradPipeline);
  gradPass.setBindGroup(0, solver._gradBG);
  gradPass.dispatchWorkgroups(wgX, wgY, wgZ);
  gradPass.end();
  device.queue.submit([gradEncoder.finish()]);

  // 6. Copy B→A for next frame
  const copyEncoder = device.createCommandEncoder({ label: 'Fluid.copy' });
  copyEncoder.copyBufferToBuffer(solver.velB, 0, solver.velA, 0, solver.totalCells * 16);
  copyEncoder.copyBufferToBuffer(solver.densB, 0, solver.densA, 0, solver.totalCells * 4);
  copyEncoder.copyBufferToBuffer(solver.tempB, 0, solver.tempA, 0, solver.totalCells * 4);
  device.queue.submit([copyEncoder.finish()]);

  // velA is the output velocity buffer (exposed as velocityBuffer for attachFluidWorld)
  solver.velocityBuffer = solver.velA;
}

/**
 * Destroy the solver.
 */
export function destroyEulerianFluidSolver(solver) {
  if (!solver) return;
  const bufs = [solver.velA, solver.velB, solver.densA, solver.densB,
    solver.tempA, solver.tempB, solver.pressA, solver.pressB,
    solver.divBuffer, solver.sourceBuffer, solver.paramsBuffer];
  for (const b of bufs) { if (b) b.destroy(); }
  solver._bindGroupsBuilt = false;
}
