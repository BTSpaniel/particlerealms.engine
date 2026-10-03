// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ParticleChemistry.js - Chemical Reaction System (GAP 38)
 * 
 * GPU compute: valence-electron driven bond formation/breaking.
 * Bonds form when electronegativity difference permits, release/absorb energy
 * that feeds directly into the thermal system.
 * 
 * Features:
 *   - Valence electron tracking per particle (from element table)
 *   - Bond formation: electronegativity difference → ionic vs covalent
 *   - Reaction energy ΔH → feeds thermal buffer
 *   - Temperature-dependent reaction rate (Arrhenius: k = A·e^(-Ea/RT))
 *   - Bond dissociation at high temperature
 *   - Uses neighbor grid (GAP 25) for spatial queries
 *   - Outputs bond pairs to CPU for constraint creation (GAP existing)
 * 
 * Two-pass approach:
 *   Pass 1 (GPU): scan neighbors, compute bond eligibility, write bond candidates
 *   Pass 2 (CPU): read back candidates, create constraints, update valence
 * 
 * Usage:
 *   const chem = createChemistrySystem(device, maxParticles);
 *   initChemistryBindGroups(chem, device, posBuffer, velBuffer, gridBuffers, elementTable);
 *   executeChemistry(chem, device, particleCount, dt);
 */

import { createStorageBuffer, createUniformBuffer } from "../../core/gpu/GpuBuffer.js";
import { labelResource } from "../../core/gpu/GpuDebug.js";
import { LEGACY_PARTICLE_RUNTIME_PCG_WGSL, LEGACY_PCG32_WGSL } from "../../core/math/MathBits.js";

// ============================================================================
// CHEMISTRY COMPUTE SHADER
// ============================================================================

const MAX_BOND_CANDIDATES = 4096;

const CHEMISTRY_SHADER = /* wgsl */`
struct ChemParams {
  particleCount: u32,
  maxNeighborsPerCell: u32,
  gridDimX: u32,
  gridDimY: u32,

  gridDimZ: u32,
  maxCandidates: u32,
  numBuckets: u32,
  _pad1: u32,

  worldMin: vec3<f32>,
  cellSize: f32,

  bondRadius: f32,        // max distance for bond formation
  activationEnergy: f32,  // Ea: minimum energy to form bond (Kelvin)
  bondEnergy: f32,        // ΔH: energy released per bond (Kelvin added to both particles)
  dissociationTemp: f32,  // temperature above which bonds break

  dt: f32,
  arrheniusA: f32,        // pre-exponential factor for reaction rate
  enDiffThreshold: f32,   // min electronegativity difference for ionic bonds
  _pad2: f32,
};

@group(0) @binding(0) var<uniform> params: ChemParams;
@group(0) @binding(1) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> velocities: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> cellCounts: array<u32>;
@group(0) @binding(4) var<storage, read> cellEntries: array<u32>;
@group(0) @binding(5) var<storage, read> elementTypes: array<u32>;
@group(0) @binding(6) var<storage, read> elementLUT: array<f32>;
@group(0) @binding(7) var<storage, read_write> thermalData: array<vec4<f32>>;
@group(0) @binding(8) var<storage, read_write> valenceBuffer: array<u32>; // remaining valence electrons
@group(0) @binding(9) var<storage, read_write> bondCandidates: array<vec4<u32>>; // [particleA, particleB, bondType, _]
@group(0) @binding(10) var<storage, read_write> candidateCounter: array<atomic<u32>>;

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

fn getElementProp(z: u32, offset: u32) -> f32 {
  return elementLUT[z * 8u + offset];
}

${LEGACY_PCG32_WGSL}
${LEGACY_PARTICLE_RUNTIME_PCG_WGSL}

@compute @workgroup_size(64)
fn chemistryStep(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx >= params.particleCount) { return; }

  let pos4 = positions[idx];
  let vel4 = velocities[idx];
  if (pos4.w >= vel4.w) { return; } // skip dead

  let myPos = pos4.xyz;
  let myZ = elementTypes[idx];
  if (myZ == 0u || myZ > 118u) { return; } // no element assigned

  let myValence = valenceBuffer[idx];
  if (myValence == 0u) { return; } // no free electrons

  let myEN = getElementProp(myZ, 7u); // electronegativity
  let myTemp = thermalData[idx].x;

  // Arrhenius rate: probability of reaction this frame
  // k = A · exp(-Ea / T)  (simplified, T in Kelvin)
  let rate = params.arrheniusA * exp(-params.activationEnergy / max(myTemp, 1.0)) * params.dt;

  // Stochastic check: use hash to determine if this particle attempts bonding
  let rng = f32(pcg_hash(idx + u32(pos4.w * 1000.0))) / 4294967295.0;
  if (rng > rate) { return; }

  let cell = worldToCell(myPos);
  let bondRadSq = params.bondRadius * params.bondRadius;

  // Find best candidate neighbor for bonding
  var bestJ = 0xFFFFFFFFu;
  var bestScore = 0.0;
  var bestBondType = 0u; // 0=covalent, 1=ionic, 2=metallic

  for (var dz = -1; dz <= 1; dz++) {
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        let ci = cellIdx(cell.x + dx, cell.y + dy, cell.z + dz);
        if (ci == 0xFFFFFFFFu) { continue; }

        let count = min(cellCounts[ci], params.maxNeighborsPerCell);
        let base = ci * params.maxNeighborsPerCell;

        for (var k = 0u; k < count; k++) {
          let j = cellEntries[base + k];
          if (j == 0xFFFFFFFFu || j == idx || j < idx) { continue; } // j < idx avoids duplicates

          let otherZ = elementTypes[j];
          if (otherZ == 0u || otherZ > 118u) { continue; }

          let otherValence = valenceBuffer[j];
          if (otherValence == 0u) { continue; }

          let diff = myPos - positions[j].xyz;
          let distSq = dot(diff, diff);
          if (distSq > bondRadSq || distSq < 0.0001) { continue; }

          // Check temperature: both particles must be below dissociation temp
          let otherTemp = thermalData[j].x;
          if (otherTemp > params.dissociationTemp || myTemp > params.dissociationTemp) { continue; }

          let otherEN = getElementProp(otherZ, 7u);
          let enDiff = abs(myEN - otherEN);

          // Score: prefer closer neighbors with compatible electronegativity
          let dist = sqrt(distSq);
          let score = (1.0 / (dist + 0.1)) * (1.0 + enDiff);

          if (score > bestScore) {
            bestScore = score;
            bestJ = j;
            // Bond type: ionic if ΔEN > threshold, else covalent
            bestBondType = select(0u, 1u, enDiff > params.enDiffThreshold);
          }
        }
      }
    }
  }

  // Submit bond candidate
  if (bestJ != 0xFFFFFFFFu) {
    let slot = atomicAdd(&candidateCounter[0], 1u);
    if (slot < params.maxCandidates) {
      bondCandidates[slot] = vec4<u32>(idx, bestJ, bestBondType, 0u);

      // Release bond energy to both particles (exothermic)
      let energyPerParticle = params.bondEnergy * 0.5;
      thermalData[idx].x += energyPerParticle;
      thermalData[bestJ].x += energyPerParticle;
    }
  }
}
`;

// ============================================================================
// DISSOCIATION SHADER — break bonds at high temperature
// ============================================================================

const DISSOCIATION_SHADER = /* wgsl */`
struct DissocParams {
  particleCount: u32,
  dissociationTemp: f32,
  maxBonds: u32,
  _pad0: u32,
};

@group(0) @binding(0) var<uniform> params: DissocParams;
@group(0) @binding(1) var<storage, read> thermalData: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> valenceBuffer: array<u32>;
@group(0) @binding(3) var<storage, read> elementTypes: array<u32>;
@group(0) @binding(4) var<storage, read> elementLUT: array<f32>;

fn getMaxValence(z: u32) -> u32 {
  // Get valence electrons from LUT (stored at offset 3 as defaultCharge approximation)
  // Actually stored separately — use a heuristic based on group
  let v = elementLUT[z * 8u + 7u]; // electronegativity as proxy
  // Simplified: elements have typical max bonds
  if (z == 1u) { return 1u; }  // H: 1 bond
  if (z == 6u) { return 4u; }  // C: 4 bonds
  if (z == 7u) { return 3u; }  // N: 3 bonds
  if (z == 8u) { return 2u; }  // O: 2 bonds
  if (z == 9u) { return 1u; }  // F: 1 bond
  if (z == 17u) { return 1u; } // Cl: 1 bond
  if (z <= 2u) { return 0u; }  // Noble gases
  return 4u; // default
}

@compute @workgroup_size(64)
fn dissociationStep(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx >= params.particleCount) { return; }

  let temp = thermalData[idx].x;
  let z = elementTypes[idx];
  if (z == 0u) { return; }

  // If temperature exceeds dissociation threshold, restore valence electrons
  // (bonds will be broken on CPU side)
  if (temp > params.dissociationTemp) {
    valenceBuffer[idx] = getMaxValence(z);
  }
}
`;

// ============================================================================
// SYSTEM
// ============================================================================

/**
 * Create the chemistry system.
 */
export function createChemistrySystem(device, maxParticles) {
  // Bond formation pass
  const chemModule = device.createShaderModule({ label: 'Chem.shader', code: CHEMISTRY_SHADER });
  const chemPipeline = device.createComputePipeline({
    label: 'Chem.pipeline', layout: 'auto',
    compute: { module: chemModule, entryPoint: 'chemistryStep' },
  });

  // Dissociation pass
  const dissocModule = device.createShaderModule({ label: 'Chem.dissoc.shader', code: DISSOCIATION_SHADER });
  const dissocPipeline = device.createComputePipeline({
    label: 'Chem.dissoc.pipeline', layout: 'auto',
    compute: { module: dissocModule, entryPoint: 'dissociationStep' },
  });

  const paramsBuffer = createUniformBuffer(device, 80, { label: 'Chem.params' });
  const dissocParamsBuffer = createUniformBuffer(device, 16, { label: 'Chem.dissoc.params' });
  labelResource(paramsBuffer, 'Chem.params');
  labelResource(dissocParamsBuffer, 'Chem.dissoc.params');

  // Per-particle valence electron count (u32)
  const valenceBuffer = device.createBuffer({
    label: 'Chem.valence', size: maxParticles * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  labelResource(valenceBuffer, 'Chem.valence');

  // Bond candidate output buffer
  const candidateBuffer = device.createBuffer({
    label: 'Chem.bondCandidates', size: MAX_BOND_CANDIDATES * 16,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  });
  labelResource(candidateBuffer, 'Chem.bondCandidates');

  // Atomic counter
  const counterBuffer = device.createBuffer({
    label: 'Chem.counter', size: 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  });
  labelResource(counterBuffer, 'Chem.counter');

  // Staging buffer for readback
  const stagingBuffer = device.createBuffer({
    label: 'Chem.staging', size: 4,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });

  return {
    device,
    chemPipeline, dissocPipeline,
    paramsBuffer, dissocParamsBuffer,
    valenceBuffer, candidateBuffer, counterBuffer, stagingBuffer,
    chemBindGroup: null, dissocBindGroup: null,
    maxParticles,
    // Tuning
    bondRadius: 1.5,
    activationEnergy: 500.0,   // Kelvin — energy barrier for reaction
    bondEnergy: 50.0,          // Kelvin — released per bond formation
    dissociationTemp: 3000.0,  // Kelvin — bonds break above this
    arrheniusA: 1.0,           // pre-exponential factor
    enDiffThreshold: 1.7,      // EN difference for ionic bond classification
    // Callbacks
    onBondFormed: null,        // (particleA, particleB, bondType) => {}
  };
}

/**
 * Initialize bind groups.
 */
export function initChemistryBindGroups(system, device, positionBuffer, velocityBuffer, gridBuffers, elementTable, thermalBuffer) {
  system.chemBindGroup = device.createBindGroup({
    label: 'Chem.bindGroup',
    layout: system.chemPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: system.paramsBuffer } },
      { binding: 1, resource: { buffer: positionBuffer } },
      { binding: 2, resource: { buffer: velocityBuffer } },
      { binding: 3, resource: { buffer: gridBuffers.cellCountsBuffer } },
      { binding: 4, resource: { buffer: gridBuffers.cellEntriesBuffer } },
      { binding: 5, resource: { buffer: elementTable.elementBuffer } },
      { binding: 6, resource: { buffer: elementTable.lutBuffer } },
      { binding: 7, resource: { buffer: thermalBuffer } },
      { binding: 8, resource: { buffer: system.valenceBuffer } },
      { binding: 9, resource: { buffer: system.candidateBuffer } },
      { binding: 10, resource: { buffer: system.counterBuffer } },
    ],
  });

  system.dissocBindGroup = device.createBindGroup({
    label: 'Chem.dissoc.bindGroup',
    layout: system.dissocPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: system.dissocParamsBuffer } },
      { binding: 1, resource: { buffer: thermalBuffer } },
      { binding: 2, resource: { buffer: system.valenceBuffer } },
      { binding: 3, resource: { buffer: elementTable.elementBuffer } },
      { binding: 4, resource: { buffer: elementTable.lutBuffer } },
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
 * Initialize valence electrons for a range of particles based on their element.
 */
export function initParticleValence(system, device, elementData, startIndex, count) {
  if (!system) return;
  const VALENCE_MAP = {
    1: 1, 2: 0, 3: 1, 4: 2, 5: 3, 6: 4, 7: 3, 8: 2, 9: 1, 10: 0,
    11: 1, 12: 2, 13: 3, 14: 4, 15: 3, 16: 2, 17: 1, 18: 0,
  };
  const data = new Uint32Array(count);
  for (let i = 0; i < count; i++) {
    const z = elementData[i] || 0;
    data[i] = VALENCE_MAP[z] !== undefined ? VALENCE_MAP[z] : 4;
  }
  device.queue.writeBuffer(system.valenceBuffer, startIndex * 4, data);
}

const _chemBuf = new ArrayBuffer(80);
const _chemU32 = new Uint32Array(_chemBuf);
const _chemF32 = new Float32Array(_chemBuf);

/**
 * Execute chemistry compute (bond formation + dissociation).
 */
export function executeChemistry(system, device, particleCount, dt) {
  if (!system?.chemBindGroup || particleCount === 0) return;

  // Reset counter
  device.queue.writeBuffer(system.counterBuffer, 0, new Uint32Array([0]));

  // Upload params
  _chemU32[0] = particleCount;
  _chemU32[1] = system._maxNeighbors || 16;
  _chemU32[2] = system._gridDimX || 50;
  _chemU32[3] = system._gridDimY || 50;
  _chemU32[4] = system._gridDimZ || 50;
  _chemU32[5] = MAX_BOND_CANDIDATES;
  _chemU32[6] = system._numBuckets || 100000; _chemU32[7] = 0;
  const wm = system._worldMin || [-50, -50, -50];
  _chemF32[8] = wm[0]; _chemF32[9] = wm[1]; _chemF32[10] = wm[2];
  _chemF32[11] = system._cellSize || 2.0;
  _chemF32[12] = system.bondRadius;
  _chemF32[13] = system.activationEnergy;
  _chemF32[14] = system.bondEnergy;
  _chemF32[15] = system.dissociationTemp;
  _chemF32[16] = dt;
  _chemF32[17] = system.arrheniusA;
  _chemF32[18] = system.enDiffThreshold;
  _chemF32[19] = 0;

  device.queue.writeBuffer(system.paramsBuffer, 0, new Uint8Array(_chemBuf));

  const wg = Math.ceil(particleCount / 64);

  // Pass 1: bond formation
  const enc1 = device.createCommandEncoder({ label: 'Chem.bondFormation' });
  const p1 = enc1.beginComputePass();
  p1.setPipeline(system.chemPipeline);
  p1.setBindGroup(0, system.chemBindGroup);
  p1.dispatchWorkgroups(wg);
  p1.end();
  device.queue.submit([enc1.finish()]);

  // Pass 2: dissociation
  if (system.dissocBindGroup) {
    const dissocData = new ArrayBuffer(16);
    const du = new Uint32Array(dissocData);
    const df = new Float32Array(dissocData);
    du[0] = particleCount;
    df[1] = system.dissociationTemp;
    du[2] = 0; du[3] = 0;
    device.queue.writeBuffer(system.dissocParamsBuffer, 0, new Uint8Array(dissocData));

    const enc2 = device.createCommandEncoder({ label: 'Chem.dissociation' });
    const p2 = enc2.beginComputePass();
    p2.setPipeline(system.dissocPipeline);
    p2.setBindGroup(0, system.dissocBindGroup);
    p2.dispatchWorkgroups(wg);
    p2.end();
    device.queue.submit([enc2.finish()]);
  }
}

/**
 * Get the valence buffer for external use.
 */
export function getValenceBuffer(system) {
  return system?.valenceBuffer || null;
}

/**
 * Destroy.
 */
export function destroyChemistrySystem(system) {
  if (!system) return;
  if (system.paramsBuffer) system.paramsBuffer.destroy();
  if (system.dissocParamsBuffer) system.dissocParamsBuffer.destroy();
  if (system.valenceBuffer) system.valenceBuffer.destroy();
  if (system.candidateBuffer) system.candidateBuffer.destroy();
  if (system.counterBuffer) system.counterBuffer.destroy();
  if (system.stagingBuffer) system.stagingBuffer.destroy();
  system.chemBindGroup = null;
  system.dissocBindGroup = null;
}
