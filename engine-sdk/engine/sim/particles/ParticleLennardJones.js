// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ParticleLennardJones.js - Lennard-Jones Intermolecular Potential (GAP 34)
 * 
 * GPU compute shader implementing the Lennard-Jones 12-6 potential:
 *   V(r) = 4ε[(σ/r)¹² - (σ/r)⁶]
 *   F(r) = 24ε/r [2(σ/r)¹² - (σ/r)⁶]
 * 
 * This single equation creates realistic solid/liquid/gas behavior:
 *   - r < σ: strong repulsion (Pauli exclusion)
 *   - r = σ·2^(1/6): equilibrium (minimum energy)
 *   - r > σ·2^(1/6): weak attraction (van der Waals)
 *   - r > 2.5σ: effectively zero (cutoff)
 * 
 * Per-element ε and σ from element table (GAP 33).
 * Cross-element interactions use Lorentz-Berthelot mixing rules.
 * Uses neighbor grid (GAP 25) for O(N) spatial queries.
 * 
 * Usage:
 *   const lj = createLennardJonesSystem(device, maxParticles);
 *   initLJBindGroups(lj, device, positionBuffer, velocityBuffer, gridBuffers, elementTable);
 *   executeLennardJones(lj, device, particleCount, dt);
 */

import { createStorageBuffer, createUniformBuffer } from "../../core/gpu/GpuBuffer.js";
import { labelResource } from "../../core/gpu/GpuDebug.js";

// ============================================================================
// LENNARD-JONES COMPUTE SHADER
// ============================================================================

const LJ_SHADER = /* wgsl */`
struct LJParams {
  particleCount: u32,
  maxNeighborsPerCell: u32,
  gridDimX: u32,
  gridDimY: u32,

  gridDimZ: u32,
  numBuckets: u32,
  _pad1: u32,
  _pad2: u32,

  worldMin: vec3<f32>,
  cellSize: f32,

  globalEpsilon: f32,   // global multiplier for ε
  globalSigma: f32,     // global multiplier for σ
  cutoffMultiplier: f32, // cutoff = cutoffMultiplier * σ (default 2.5)
  dt: f32,

  maxForce: f32,        // clamp force magnitude
  useElementTable: u32, // 1 = use per-element LJ params, 0 = use global
  _pad3: f32,
  _pad4: f32,
};

// Element LUT: 128 entries × 8 floats
// Layout: [mass, ljEpsilon, ljSigma, charge, meltPoint, boilPoint, atomicRadius, electronegativity]
@group(0) @binding(0) var<uniform> params: LJParams;
@group(0) @binding(1) var<storage, read_write> positions: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> velocities: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> cellCounts: array<u32>;
@group(0) @binding(4) var<storage, read> cellEntries: array<u32>;
@group(0) @binding(5) var<storage, read> elementTypes: array<u32>;
@group(0) @binding(6) var<storage, read> elementLUT: array<f32>;
@group(0) @binding(7) var<storage, read> thermalData: array<vec4<f32>>; // x=temp, y=phase, z=group|mat, w=latent

fn worldToCell(pos: vec3<f32>) -> vec3<i32> {
  return vec3<i32>(floor((pos - params.worldMin) / params.cellSize));
}

fn cellIndex(cx: i32, cy: i32, cz: i32) -> u32 {
  if (cx < 0 || cy < 0 || cz < 0) { return 0xFFFFFFFFu; }
  let ux = u32(cx); let uy = u32(cy); let uz = u32(cz);
  if (ux >= params.gridDimX || uy >= params.gridDimY || uz >= params.gridDimZ) { return 0xFFFFFFFFu; }
  let flat = uz * params.gridDimX * params.gridDimY + uy * params.gridDimX + ux;
  return flat % params.numBuckets;
}

fn getElementLJ(z: u32) -> vec2<f32> {
  // Returns (epsilon, sigma) for element z
  let base = z * 8u;
  return vec2<f32>(elementLUT[base + 1u], elementLUT[base + 2u]);
}

@compute @workgroup_size(64)
fn ljStep(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx >= params.particleCount) { return; }

  let pos4 = positions[idx];
  let vel4 = velocities[idx];
  if (pos4.w >= vel4.w) { return; } // skip dead

  // Phase mask: LJ affects solid/liquid/gas but NOT plasma (ionized = no molecular bonds)
  let phase = thermalData[idx].y;
  if (phase > 2.5) { return; } // skip plasma

  let myPos = pos4.xyz;
  let cell = worldToCell(myPos);

  // Get my LJ parameters
  var myEps = params.globalEpsilon;
  var mySig = params.globalSigma;
  if (params.useElementTable > 0u) {
    let myZ = elementTypes[idx];
    if (myZ > 0u && myZ < 119u) {
      let myLJ = getElementLJ(myZ);
      myEps = myLJ.x * params.globalEpsilon;
      mySig = myLJ.y * params.globalSigma;
    }
  }

  let cutoff = params.cutoffMultiplier * mySig;
  let cutoffSq = cutoff * cutoff;
  let searchRange = i32(ceil(cutoff / params.cellSize));

  var totalForce = vec3<f32>(0.0);

  for (var dz = -searchRange; dz <= searchRange; dz++) {
    for (var dy = -searchRange; dy <= searchRange; dy++) {
      for (var dx = -searchRange; dx <= searchRange; dx++) {
        let ci = cellIndex(cell.x + dx, cell.y + dy, cell.z + dz);
        if (ci == 0xFFFFFFFFu) { continue; }

        let count = min(cellCounts[ci], params.maxNeighborsPerCell);
        let base = ci * params.maxNeighborsPerCell;

        for (var k = 0u; k < count; k++) {
          let j = cellEntries[base + k];
          if (j == 0xFFFFFFFFu || j == idx) { continue; }

          let otherPos = positions[j].xyz;
          let diff = myPos - otherPos;
          let distSq = dot(diff, diff);

          if (distSq >= cutoffSq || distSq < 0.0001) { continue; }

          // Get neighbor LJ params and apply mixing rules
          var eps = myEps;
          var sig = mySig;
          if (params.useElementTable > 0u) {
            let otherZ = elementTypes[j];
            if (otherZ > 0u && otherZ < 119u) {
              let otherLJ = getElementLJ(otherZ);
              let otherEps = otherLJ.x * params.globalEpsilon;
              let otherSig = otherLJ.y * params.globalSigma;
              // Lorentz-Berthelot mixing rules
              eps = sqrt(myEps * otherEps);
              sig = (mySig + otherSig) * 0.5;
            }
          }

          let dist = sqrt(distSq);
          let invR = 1.0 / dist;
          let sigOverR = sig * invR;
          let sr6 = sigOverR * sigOverR * sigOverR * sigOverR * sigOverR * sigOverR;
          let sr12 = sr6 * sr6;

          // F(r) = 24ε/r [2(σ/r)¹² - (σ/r)⁶] — directed along r
          let forceMag = 24.0 * eps * invR * (2.0 * sr12 - sr6);

          // Shifted force: subtract force at cutoff to avoid discontinuity
          let sigOverRc = sig / cutoff;
          let src6 = sigOverRc * sigOverRc * sigOverRc * sigOverRc * sigOverRc * sigOverRc;
          let src12 = src6 * src6;
          let cutoffForce = 24.0 * eps / cutoff * (2.0 * src12 - src6);
          let shiftedForce = forceMag - cutoffForce;

          let forceDir = diff * invR;
          totalForce += forceDir * shiftedForce;
        }
      }
    }
  }

  // Clamp force magnitude
  let forceMag = length(totalForce);
  if (forceMag > params.maxForce) {
    totalForce = totalForce * (params.maxForce / forceMag);
  }

  velocities[idx] = vec4<f32>(vel4.xyz + totalForce * params.dt, vel4.w);
}
`;

// ============================================================================
// SYSTEM
// ============================================================================

/**
 * Create the Lennard-Jones system.
 */
export function createLennardJonesSystem(device, maxParticles) {
  const shaderModule = device.createShaderModule({
    label: 'LJ.shader', code: LJ_SHADER,
  });
  const pipeline = device.createComputePipeline({
    label: 'LJ.pipeline', layout: 'auto',
    compute: { module: shaderModule, entryPoint: 'ljStep' },
  });

  const paramsBuffer = createUniformBuffer(device, 80, { label: 'LJ.params' });
  labelResource(paramsBuffer, 'LJ.params');

  return {
    device, pipeline, paramsBuffer,
    bindGroup: null,
    maxParticles,
    // Tuning parameters
    globalEpsilon: 1.0,    // multiplier on per-element ε
    globalSigma: 1.0,      // multiplier on per-element σ
    cutoffMultiplier: 2.5,  // cutoff = 2.5σ
    maxForce: 50.0,
    useElementTable: true,
  };
}

/**
 * Initialize bind groups. Requires neighbor grid + element table buffers.
 */
export function initLJBindGroups(system, device, positionBuffer, velocityBuffer, gridBuffers, elementTable, thermalBuffer) {
  const dummyElementBuf = elementTable?.elementBuffer || device.createBuffer({
    label: 'LJ.dummyElements', size: 4, usage: GPUBufferUsage.STORAGE,
  });
  const dummyLutBuf = elementTable?.lutBuffer || device.createBuffer({
    label: 'LJ.dummyLUT', size: 128 * 8 * 4, usage: GPUBufferUsage.STORAGE,
  });

  system.bindGroup = device.createBindGroup({
    label: 'LJ.bindGroup',
    layout: system.pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: system.paramsBuffer } },
      { binding: 1, resource: { buffer: positionBuffer } },
      { binding: 2, resource: { buffer: velocityBuffer } },
      { binding: 3, resource: { buffer: gridBuffers.cellCountsBuffer } },
      { binding: 4, resource: { buffer: gridBuffers.cellEntriesBuffer } },
      { binding: 5, resource: { buffer: dummyElementBuf } },
      { binding: 6, resource: { buffer: dummyLutBuf } },
      { binding: 7, resource: { buffer: thermalBuffer } },
    ],
  });

  system._gridDimX = gridBuffers.gridDimX;
  system._gridDimY = gridBuffers.gridDimY;
  system._gridDimZ = gridBuffers.gridDimZ;
  system._cellSize = gridBuffers.cellSize;
  system._maxNeighbors = gridBuffers.maxNeighbors;
  system._numBuckets = gridBuffers.numBuckets;
  system._worldMin = gridBuffers.worldMin || [-50, -50, -50];
}

const _ljParamsData = new ArrayBuffer(80);
const _ljU32 = new Uint32Array(_ljParamsData);
const _ljF32 = new Float32Array(_ljParamsData);

/**
 * Execute the Lennard-Jones compute pass.
 */
export function executeLennardJones(system, device, particleCount, dt) {
  if (!system?.bindGroup || particleCount === 0) return;

  _ljU32[0] = particleCount;
  _ljU32[1] = system._maxNeighbors || 16;
  _ljU32[2] = system._gridDimX || 50;
  _ljU32[3] = system._gridDimY || 50;
  _ljU32[4] = system._gridDimZ || 50;
  _ljU32[5] = system._numBuckets || 100000; _ljU32[6] = 0; _ljU32[7] = 0;

  const wm = system._worldMin || [-50, -50, -50];
  _ljF32[8]  = wm[0]; _ljF32[9]  = wm[1]; _ljF32[10] = wm[2];
  _ljF32[11] = system._cellSize || 2.0;

  _ljF32[12] = system.globalEpsilon;
  _ljF32[13] = system.globalSigma;
  _ljF32[14] = system.cutoffMultiplier;
  _ljF32[15] = dt;

  _ljF32[16] = system.maxForce;
  _ljU32[17] = system.useElementTable ? 1 : 0;
  _ljF32[18] = 0; _ljF32[19] = 0;

  device.queue.writeBuffer(system.paramsBuffer, 0, new Uint8Array(_ljParamsData));

  const encoder = device.createCommandEncoder({ label: 'LJ.step' });
  const pass = encoder.beginComputePass({ label: 'LJ.step' });
  pass.setPipeline(system.pipeline);
  pass.setBindGroup(0, system.bindGroup);
  pass.dispatchWorkgroups(Math.ceil(particleCount / 64));
  pass.end();
  device.queue.submit([encoder.finish()]);
}

/**
 * Destroy the system.
 */
export function destroyLennardJonesSystem(system) {
  if (!system) return;
  if (system.paramsBuffer) system.paramsBuffer.destroy();
  system.bindGroup = null;
}
