// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ParticleElectromagnetic.js - Electromagnetic Forces (GAP 35)
 * 
 * GPU compute: Coulomb electrostatic + Lorentz magnetic force.
 *   F_coulomb = k · q₁·q₂ / r²  (along r)
 *   F_lorentz = q · (v × B)       (perpendicular to v and B)
 * 
 * Per-particle charge from element table (GAP 33) charge buffer.
 * Optional: sample E/H fields from FDTDSolver.js if attached.
 * Uses neighbor grid (GAP 25) for O(N) spatial queries.
 * Debye shielding at high density to prevent runaway forces.
 * 
 * Usage:
 *   const em = createElectromagneticSystem(device, maxParticles);
 *   initEMBindGroups(em, device, positionBuffer, velocityBuffer, gridBuffers, chargeBuffer);
 *   setExternalField(em, { Ex, Ey, Ez, Bx, By, Bz });
 *   executeElectromagnetic(em, device, particleCount, dt);
 */

import { createStorageBuffer, createUniformBuffer } from "../../core/gpu/GpuBuffer.js";
import { labelResource } from "../../core/gpu/GpuDebug.js";

// ============================================================================
// ELECTROMAGNETIC COMPUTE SHADER
// ============================================================================

const EM_SHADER = /* wgsl */`
struct EMParams {
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

  // Coulomb constant k (default 8.9875e9 N·m²/C² but scaled for sim)
  coulombK: f32,
  dt: f32,
  maxForce: f32,
  debyeLength: f32, // screening length (0 = no screening)

  // External uniform fields
  externalE: vec3<f32>,
  _pad3: f32,
  externalB: vec3<f32>,
  _pad4: f32,

  // Softening to prevent singularities
  softening: f32,
  chargeScale: f32,  // global multiplier on all charges
  _pad5: f32,
  _pad6: f32,
};

@group(0) @binding(0) var<uniform> params: EMParams;
@group(0) @binding(1) var<storage, read_write> positions: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> velocities: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> cellCounts: array<u32>;
@group(0) @binding(4) var<storage, read> cellEntries: array<u32>;
@group(0) @binding(5) var<storage, read> charges: array<f32>;
@group(0) @binding(6) var<storage, read> thermalData: array<vec4<f32>>; // x=temp, y=phase, z=group|mat, w=latent

fn worldToCell(pos: vec3<f32>) -> vec3<i32> {
  return vec3<i32>(floor((pos - params.worldMin) / params.cellSize));
}

fn cellIdx(cx: i32, cy: i32, cz: i32) -> u32 {
  if (cx < 0 || cy < 0 || cz < 0) { return 0xFFFFFFFFu; }
  let ux = u32(cx); let uy = u32(cy); let uz = u32(cz);
  if (ux >= params.gridDimX || uy >= params.gridDimY || uz >= params.gridDimZ) { return 0xFFFFFFFFu; }
  let flat = uz * params.gridDimX * params.gridDimY + uy * params.gridDimX + ux;
  return flat % params.numBuckets;
}

@compute @workgroup_size(64)
fn emStep(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx >= params.particleCount) { return; }

  let pos4 = positions[idx];
  let vel4 = velocities[idx];
  if (pos4.w >= vel4.w) { return; } // skip dead

  let myPos = pos4.xyz;
  let myVel = vel4.xyz;
  let myCharge = charges[idx] * params.chargeScale;

  if (abs(myCharge) < 0.0001) { return; } // neutral particle

  // Phase mask: EM primarily affects plasma (phase 3) and charged particles.
  // Skip solid/liquid/gas particles unless they carry charge (e.g., ions in solution).
  let phase = thermalData[idx].y;
  let isPlasma = phase > 2.5; // phase 3
  if (!isPlasma && abs(myCharge) < 0.01) { return; }

  let cell = worldToCell(myPos);
  let softSq = params.softening * params.softening;
  let hasScreening = params.debyeLength > 0.0;
  let invDebye = select(0.0, 1.0 / params.debyeLength, hasScreening);

  var coulombForce = vec3<f32>(0.0);

  // Search radius: limited by Debye length if screening, otherwise 3 cells
  let searchRange = 1;

  for (var dz = -searchRange; dz <= searchRange; dz++) {
    for (var dy = -searchRange; dy <= searchRange; dy++) {
      for (var dx = -searchRange; dx <= searchRange; dx++) {
        let ci = cellIdx(cell.x + dx, cell.y + dy, cell.z + dz);
        if (ci == 0xFFFFFFFFu) { continue; }

        let count = min(cellCounts[ci], params.maxNeighborsPerCell);
        let base = ci * params.maxNeighborsPerCell;

        for (var k = 0u; k < count; k++) {
          let j = cellEntries[base + k];
          if (j == 0xFFFFFFFFu || j == idx) { continue; }

          let otherCharge = charges[j] * params.chargeScale;
          if (abs(otherCharge) < 0.0001) { continue; }

          let diff = myPos - positions[j].xyz;
          let distSq = dot(diff, diff) + softSq;
          let dist = sqrt(distSq);
          let invDist = 1.0 / dist;

          // Coulomb: F = k·q₁·q₂/r² · r̂
          var fMag = params.coulombK * myCharge * otherCharge * invDist * invDist;

          // Debye screening: multiply by exp(-r/λ_D)
          if (hasScreening) {
            fMag *= exp(-dist * invDebye);
          }

          coulombForce += diff * invDist * fMag;
        }
      }
    }
  }

  // External electric field force: F = q·E
  var externalForce = myCharge * params.externalE;

  // Lorentz force from external magnetic field: F = q·(v × B)
  let lorentzForce = myCharge * cross(myVel, params.externalB);

  var totalForce = coulombForce + externalForce + lorentzForce;

  // Clamp force magnitude
  let mag = length(totalForce);
  if (mag > params.maxForce) {
    totalForce = totalForce * (params.maxForce / mag);
  }

  velocities[idx] = vec4<f32>(myVel + totalForce * params.dt, vel4.w);
}
`;

// ============================================================================
// SYSTEM
// ============================================================================

/**
 * Create the electromagnetic system.
 */
export function createElectromagneticSystem(device, maxParticles) {
  const shaderModule = device.createShaderModule({
    label: 'EM.shader', code: EM_SHADER,
  });
  const pipeline = device.createComputePipeline({
    label: 'EM.pipeline', layout: 'auto',
    compute: { module: shaderModule, entryPoint: 'emStep' },
  });

  const paramsBuffer = createUniformBuffer(device, 112, { label: 'EM.params' });
  labelResource(paramsBuffer, 'EM.params');

  return {
    device, pipeline, paramsBuffer,
    bindGroup: null,
    maxParticles,
    // Tuning
    coulombK: 10.0,       // scaled Coulomb constant (not SI, game-scale)
    maxForce: 100.0,
    debyeLength: 0.0,     // 0 = no screening
    softening: 0.1,
    chargeScale: 1.0,
    externalE: [0, 0, 0],
    externalB: [0, 0, 0],
  };
}

/**
 * Initialize bind groups.
 */
export function initEMBindGroups(system, device, positionBuffer, velocityBuffer, gridBuffers, chargeBuffer, thermalBuffer) {
  const dummyCharge = chargeBuffer || device.createBuffer({
    label: 'EM.dummyCharge', size: 4, usage: GPUBufferUsage.STORAGE,
  });

  system.bindGroup = device.createBindGroup({
    label: 'EM.bindGroup',
    layout: system.pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: system.paramsBuffer } },
      { binding: 1, resource: { buffer: positionBuffer } },
      { binding: 2, resource: { buffer: velocityBuffer } },
      { binding: 3, resource: { buffer: gridBuffers.cellCountsBuffer } },
      { binding: 4, resource: { buffer: gridBuffers.cellEntriesBuffer } },
      { binding: 5, resource: { buffer: dummyCharge } },
      { binding: 6, resource: { buffer: thermalBuffer } },
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

/**
 * Set external E and B fields.
 */
export function setExternalField(system, fields) {
  if (!system) return;
  if (fields.Ex !== undefined) system.externalE[0] = fields.Ex;
  if (fields.Ey !== undefined) system.externalE[1] = fields.Ey;
  if (fields.Ez !== undefined) system.externalE[2] = fields.Ez;
  if (fields.Bx !== undefined) system.externalB[0] = fields.Bx;
  if (fields.By !== undefined) system.externalB[1] = fields.By;
  if (fields.Bz !== undefined) system.externalB[2] = fields.Bz;
}

const _emBuf = new ArrayBuffer(112);
const _emU32 = new Uint32Array(_emBuf);
const _emF32 = new Float32Array(_emBuf);

/**
 * Execute the electromagnetic compute pass.
 */
export function executeElectromagnetic(system, device, particleCount, dt) {
  if (!system?.bindGroup || particleCount === 0) return;

  _emU32[0] = particleCount;
  _emU32[1] = system._maxNeighbors || 16;
  _emU32[2] = system._gridDimX || 50;
  _emU32[3] = system._gridDimY || 50;
  _emU32[4] = system._gridDimZ || 50;
  _emU32[5] = system._numBuckets || 100000; _emU32[6] = 0; _emU32[7] = 0;

  const wm = system._worldMin || [-50, -50, -50];
  _emF32[8]  = wm[0]; _emF32[9]  = wm[1]; _emF32[10] = wm[2];
  _emF32[11] = system._cellSize || 2.0;
  _emF32[12] = system.coulombK;
  _emF32[13] = dt;
  _emF32[14] = system.maxForce;
  _emF32[15] = system.debyeLength;

  _emF32[16] = system.externalE[0]; _emF32[17] = system.externalE[1]; _emF32[18] = system.externalE[2];
  _emF32[19] = 0;
  _emF32[20] = system.externalB[0]; _emF32[21] = system.externalB[1]; _emF32[22] = system.externalB[2];
  _emF32[23] = 0;

  _emF32[24] = system.softening;
  _emF32[25] = system.chargeScale;
  _emF32[26] = 0; _emF32[27] = 0;

  device.queue.writeBuffer(system.paramsBuffer, 0, new Uint8Array(_emBuf));

  const encoder = device.createCommandEncoder({ label: 'EM.step' });
  const pass = encoder.beginComputePass({ label: 'EM.step' });
  pass.setPipeline(system.pipeline);
  pass.setBindGroup(0, system.bindGroup);
  pass.dispatchWorkgroups(Math.ceil(particleCount / 64));
  pass.end();
  device.queue.submit([encoder.finish()]);
}

/**
 * Destroy.
 */
export function destroyElectromagneticSystem(system) {
  if (!system) return;
  if (system.paramsBuffer) system.paramsBuffer.destroy();
  system.bindGroup = null;
}
