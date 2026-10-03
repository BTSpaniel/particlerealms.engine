// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ParticleSPH.js - Smoothed Particle Hydrodynamics (GAP 36)
 * 
 * True Lagrangian particle-based fluid simulation where particles ARE the fluid.
 * Complements Eulerian grid solver (GAP 32) for free-surface liquids.
 * 
 * Two-pass GPU compute:
 *   Pass 1 (density): estimate density at each particle via Poly6 kernel
 *   Pass 2 (forces):  pressure (Spiky), viscosity, surface tension, XSPH correction
 * 
 * Navier-Stokes in SPH form:
 *   ρᵢ = Σⱼ mⱼ W(rᵢ-rⱼ, h)           (density)
 *   aᵢ = -Σⱼ mⱼ(Pᵢ/ρᵢ² + Pⱼ/ρⱼ²)∇W  (pressure)
 *   aᵢ += μ Σⱼ mⱼ(vⱼ-vᵢ)/ρⱼ ∇²W      (viscosity)
 * 
 * Per-element rest density and viscosity from element table (GAP 33).
 * Uses neighbor grid (GAP 25) for O(N) spatial queries.
 * 
 * Usage:
 *   const sph = createSPHSystem(device, maxParticles);
 *   initSPHBindGroups(sph, device, posBuffer, velBuffer, gridBuffers);
 *   executeSPH(sph, device, particleCount, dt);
 */

import { createStorageBuffer, createUniformBuffer } from "../../core/gpu/GpuBuffer.js";
import { labelResource } from "../../core/gpu/GpuDebug.js";

// ============================================================================
// SPH DENSITY PASS SHADER
// ============================================================================

const SPH_DENSITY_SHADER = /* wgsl */`
struct SPHParams {
  particleCount: u32,
  maxNeighborsPerCell: u32,
  gridDimX: u32,
  gridDimY: u32,

  gridDimZ: u32,
  numBuckets: u32,
  groundBoundaryDisabled: u32,
  _pad2: u32,

  worldMin: vec3<f32>,
  cellSize: f32,

  smoothingRadius: f32,  // h: SPH kernel radius
  restDensity: f32,      // ρ₀: target density
  particleMass: f32,     // m: mass per particle
  gasConstant: f32,      // k: pressure stiffness (P = k(ρ - ρ₀))

  viscosity: f32,        // μ: dynamic viscosity
  surfaceTension: f32,   // σ: surface tension coefficient
  xsphFactor: f32,       // ε: XSPH velocity smoothing (0-1)
  dt: f32,

  gravity: vec3<f32>,
  maxAccel: f32,
};

@group(0) @binding(0) var<uniform> params: SPHParams;
@group(0) @binding(1) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> velocities: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> cellCounts: array<u32>;
@group(0) @binding(4) var<storage, read> cellEntries: array<u32>;
@group(0) @binding(5) var<storage, read_write> densityPressure: array<vec2<f32>>; // [density, pressure]
@group(0) @binding(6) var<storage, read> thermalData: array<vec4<f32>>; // x=temp, y=phase, z=group|mat, w=latent

const PI: f32 = 3.14159265359;

// Poly6 kernel: W(r,h) = 315/(64πh⁹) · (h²-r²)³
fn poly6(distSq: f32, hSq: f32, h9: f32) -> f32 {
  if (distSq >= hSq) { return 0.0; }
  let diff = hSq - distSq;
  return 315.0 / (64.0 * PI * h9) * diff * diff * diff;
}

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
fn densityPass(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx >= params.particleCount) { return; }

  let pos4 = positions[idx];
  let vel4 = velocities[idx];
  if (pos4.w >= vel4.w) {
    densityPressure[idx] = vec2<f32>(0.0, 0.0);
    return;
  }

  // Phase mask: SPH only affects liquid particles (phase ~1.0)
  let phase = thermalData[idx].y;
  if (phase < 0.5 || phase > 1.5) {
    densityPressure[idx] = vec2<f32>(0.0, 0.0);
    return;
  }

  let myPos = pos4.xyz;
  let cell = worldToCell(myPos);
  let h = params.smoothingRadius;
  let hSq = h * h;
  let h9 = h * h * h * h * h * h * h * h * h;
  let m = params.particleMass;

  var density = 0.0;

  // Self-contribution
  density += m * poly6(0.0, hSq, h9);

  let searchRange = i32(ceil(h / params.cellSize));

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

          // Skip non-liquid neighbors for SPH density
          let jPhase = thermalData[j].y;
          if (jPhase < 0.5 || jPhase > 1.5) { continue; }

          let diff = myPos - positions[j].xyz;
          let distSq = dot(diff, diff);

          density += m * poly6(distSq, hSq, h9);
        }
      }
    }
  }

  // Ground boundary density correction (ghost particle method)
  // Particles near ground (y < h) have incomplete kernels — half the neighbors are "underground".
  // Mirror the particle below ground as a ghost to restore density symmetry.
  if (params.groundBoundaryDisabled == 0u && myPos.y < h) {
    let ghostPos = vec3<f32>(myPos.x, -myPos.y, myPos.z); // reflected below y=0
    let ghostDiff = myPos - ghostPos;
    let ghostDistSq = dot(ghostDiff, ghostDiff);
    density += m * poly6(ghostDistSq, hSq, h9);
    // Also add a few virtual neighbors in a small ring around the ghost
    // to approximate the missing hemisphere of support
    let missingFraction = 1.0 - myPos.y / h; // 1.0 at ground, 0.0 at y=h
    density += m * poly6(0.0, hSq, h9) * missingFraction * 0.5;
  }

  // Tait equation of state: P = k(ρ - ρ₀)
  // Clamp pressure to >= 0: negative pressure causes unphysical attraction
  let pressure = max(params.gasConstant * (density - params.restDensity), 0.0);

  densityPressure[idx] = vec2<f32>(density, pressure);
}
`;

// ============================================================================
// SPH FORCE PASS SHADER
// ============================================================================

const SPH_FORCE_SHADER = /* wgsl */`
struct SPHParams {
  particleCount: u32,
  maxNeighborsPerCell: u32,
  gridDimX: u32,
  gridDimY: u32,

  gridDimZ: u32,
  numBuckets: u32,
  groundBoundaryDisabled: u32,
  _pad2: u32,

  worldMin: vec3<f32>,
  cellSize: f32,

  smoothingRadius: f32,
  restDensity: f32,
  particleMass: f32,
  gasConstant: f32,

  viscosity: f32,
  surfaceTension: f32,
  xsphFactor: f32,
  dt: f32,

  gravity: vec3<f32>,
  maxAccel: f32,
};

@group(0) @binding(0) var<uniform> params: SPHParams;
@group(0) @binding(1) var<storage, read_write> positions: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> velocities: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> cellCounts: array<u32>;
@group(0) @binding(4) var<storage, read> cellEntries: array<u32>;
@group(0) @binding(5) var<storage, read> densityPressure: array<vec2<f32>>;
@group(0) @binding(6) var<storage, read> thermalData: array<vec4<f32>>; // x=temp, y=phase, z=group|mat, w=latent

const PI: f32 = 3.14159265359;

// Spiky kernel gradient: ∇W = -45/(πh⁶) · (h-r)² · r̂
fn spikyGrad(diff: vec3<f32>, dist: f32, h: f32, h6: f32) -> vec3<f32> {
  if (dist >= h || dist < 0.0001) { return vec3<f32>(0.0); }
  let coeff = -45.0 / (PI * h6) * (h - dist) * (h - dist) / dist;
  return diff * coeff;
}

// Viscosity kernel Laplacian: ∇²W = 45/(πh⁶) · (h-r)
fn viscLaplacian(dist: f32, h: f32, h6: f32) -> f32 {
  if (dist >= h) { return 0.0; }
  return 45.0 / (PI * h6) * (h - dist);
}

// Poly6 kernel (for surface tension color field)
fn poly6(distSq: f32, hSq: f32, h9: f32) -> f32 {
  if (distSq >= hSq) { return 0.0; }
  let diff = hSq - distSq;
  return 315.0 / (64.0 * PI * h9) * diff * diff * diff;
}

// Poly6 gradient (for surface tension normal)
fn poly6Grad(diff: vec3<f32>, distSq: f32, hSq: f32, h9: f32) -> vec3<f32> {
  if (distSq >= hSq) { return vec3<f32>(0.0); }
  let d = hSq - distSq;
  let coeff = -945.0 / (32.0 * PI * h9) * d * d;
  return diff * coeff;
}

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
fn forcePass(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx >= params.particleCount) { return; }

  let pos4 = positions[idx];
  let vel4 = velocities[idx];
  if (pos4.w >= vel4.w) { return; }

  // Phase mask: SPH forces only affect liquid particles (phase ~1.0)
  let phase = thermalData[idx].y;
  if (phase < 0.5 || phase > 1.5) { return; }

  let myPos = pos4.xyz;
  let myVel = vel4.xyz;
  let myDP = densityPressure[idx];
  let myDensity = myDP.x;
  let myPressure = myDP.y;

  if (myDensity < 0.001) { return; }

  let cell = worldToCell(myPos);
  let h = params.smoothingRadius;
  let hSq = h * h;
  let h6 = h * h * h * h * h * h;
  let h9 = h6 * h * h * h;
  let m = params.particleMass;
  let searchRange = i32(ceil(h / params.cellSize));

  var pressureAccel = vec3<f32>(0.0);
  var viscosityAccel = vec3<f32>(0.0);
  var surfaceNormal = vec3<f32>(0.0);
  var colorLaplacian: f32 = 0.0;
  var xsphVel = vec3<f32>(0.0);

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

          // Skip non-liquid neighbors for SPH forces
          let jPhase = thermalData[j].y;
          if (jPhase < 0.5 || jPhase > 1.5) { continue; }

          let otherDP = densityPressure[j];
          let otherDensity = otherDP.x;
          if (otherDensity < 0.001) { continue; }
          let otherPressure = otherDP.y;

          let diff = myPos - positions[j].xyz;
          let distSq = dot(diff, diff);
          let dist = sqrt(distSq);

          // Pressure force: -Σⱼ mⱼ (Pᵢ/ρᵢ² + Pⱼ/ρⱼ²) ∇W_spiky
          let pressureTerm = myPressure / (myDensity * myDensity) + otherPressure / (otherDensity * otherDensity);
          pressureAccel -= spikyGrad(diff, dist, h, h6) * m * pressureTerm;

          // Viscosity: μ Σⱼ mⱼ (vⱼ-vᵢ)/ρⱼ ∇²W_visc
          let otherVel = velocities[j].xyz;
          viscosityAccel += (otherVel - myVel) * (m / otherDensity * viscLaplacian(dist, h, h6));

          // Surface tension: color field gradient and Laplacian
          surfaceNormal += poly6Grad(diff, distSq, hSq, h9) * (m / otherDensity);
          colorLaplacian += (m / otherDensity) * poly6(distSq, hSq, h9);

          // XSPH velocity correction
          xsphVel += (otherVel - myVel) * (m / (myDensity + otherDensity) * 2.0 * poly6(distSq, hSq, h9));
        }
      }
    }
  }

  viscosityAccel *= params.viscosity;

  // Ground boundary force (ghost particle pressure)
  // Mirror particle below ground to push it upward, preventing penetration and density gap
  var boundaryAccel = vec3<f32>(0.0);
  if (params.groundBoundaryDisabled == 0u && myPos.y < h) {
    let ghostY = -myPos.y;
    let ghostDiff = vec3<f32>(0.0, myPos.y - ghostY, 0.0);
    let ghostDist = abs(myPos.y - ghostY);
    // Ghost has same pressure as us (symmetric boundary)
    let ghostPressureTerm = 2.0 * myPressure / (myDensity * myDensity);
    boundaryAccel -= spikyGrad(ghostDiff, ghostDist, h, h6) * m * ghostPressureTerm;
    // Ghost viscosity: reflect velocity (no-slip wall: ghost vel = -myVel for tangential, +myVel for normal)
    let ghostVel = vec3<f32>(myVel.x, -myVel.y, myVel.z); // free-slip: only reflect normal component
    boundaryAccel += (ghostVel - myVel) * (m / max(myDensity, 1.0) * viscLaplacian(ghostDist, h, h6)) * params.viscosity;
  }

  // Surface tension force: -σ κ n̂  where κ = -∇²c / |∇c|
  var surfaceTensionAccel = vec3<f32>(0.0);
  let normalLen = length(surfaceNormal);
  if (normalLen > 0.1 && params.surfaceTension > 0.0) {
    let kappa = -colorLaplacian / normalLen;
    surfaceTensionAccel = surfaceNormal / normalLen * kappa * params.surfaceTension;
  }

  var totalAccel = pressureAccel + viscosityAccel + surfaceTensionAccel + boundaryAccel + params.gravity;

  // Clamp acceleration
  let accelMag = length(totalAccel);
  if (accelMag > params.maxAccel) {
    totalAccel = totalAccel * (params.maxAccel / accelMag);
  }

  // Apply XSPH correction to velocity
  let correctedVel = myVel + totalAccel * params.dt + xsphVel * params.xsphFactor;

  velocities[idx] = vec4<f32>(correctedVel, vel4.w);
}
`;

// ============================================================================
// SPH VORTICITY CONFINEMENT PASS (GAP 11)
// Restores angular momentum lost to numerical dissipation.
// Computes ω = curl(v) via SPH kernel, then applies f = ε(N × ω) where N = ∇|ω|/|∇|ω||
// ============================================================================

const SPH_VORTICITY_SHADER = /* wgsl */`
struct SPHParams {
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

  smoothingRadius: f32,
  restDensity: f32,
  particleMass: f32,
  gasConstant: f32,

  viscosity: f32,
  surfaceTension: f32,
  xsphFactor: f32,
  dt: f32,

  gravity: vec3<f32>,
  maxAccel: f32,
};

@group(0) @binding(0) var<uniform> params: SPHParams;
@group(0) @binding(1) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> velocities: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> cellCounts: array<u32>;
@group(0) @binding(4) var<storage, read> cellEntries: array<u32>;
@group(0) @binding(5) var<storage, read> densityPressure: array<vec2<f32>>;
@group(0) @binding(6) var<storage, read> thermalData: array<vec4<f32>>;

const PI: f32 = 3.14159265359;

// Spiky kernel gradient for curl computation
fn spikyGrad(diff: vec3<f32>, dist: f32, h: f32, h6: f32) -> vec3<f32> {
  if (dist >= h || dist < 0.0001) { return vec3<f32>(0.0); }
  let coeff = -45.0 / (PI * h6) * (h - dist) * (h - dist) / dist;
  return diff * coeff;
}

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
fn vorticityPass(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx >= params.particleCount) { return; }

  let pos4 = positions[idx];
  let vel4 = velocities[idx];
  if (pos4.w >= vel4.w) { return; }

  // Phase mask: only liquid
  let phase = thermalData[idx].y;
  if (phase < 0.5 || phase > 1.5) { return; }

  let myPos = pos4.xyz;
  let myVel = vel4.xyz;
  let myDensity = densityPressure[idx].x;
  if (myDensity < 0.001) { return; }

  let cell = worldToCell(myPos);
  let h = params.smoothingRadius;
  let h6 = h * h * h * h * h * h;
  let m = params.particleMass;
  let searchRange = i32(ceil(h / params.cellSize));

  // Step 1: Compute vorticity ω = curl(v) = Σⱼ (mⱼ/ρⱼ)(vⱼ - vᵢ) × ∇W
  var omega = vec3<f32>(0.0);
  // Step 2: Also accumulate gradient of |ω| for direction vector N
  // (approximated using velocity difference magnitude as proxy for neighbor vorticity)
  var omegaMagGrad = vec3<f32>(0.0);

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

          let jPhase = thermalData[j].y;
          if (jPhase < 0.5 || jPhase > 1.5) { continue; }

          let jDensity = densityPressure[j].x;
          if (jDensity < 0.001) { continue; }

          let diff = myPos - positions[j].xyz;
          let dist = length(diff);

          let gradW = spikyGrad(diff, dist, h, h6);
          let velDiff = velocities[j].xyz - myVel;
          let weight = m / jDensity;

          // curl(v) = Σ (m/ρ)(v_j - v_i) × ∇W
          omega += cross(velDiff, gradW) * weight;

          // Gradient of |ω| approximation: use velocity curl magnitude as neighbor contribution
          let jCurlMag = length(cross(velDiff, gradW) * weight);
          omegaMagGrad += gradW * jCurlMag;
        }
      }
    }
  }

  let omegaMag = length(omega);
  if (omegaMag < 0.01) { return; }

  // N = ∇|ω| / |∇|ω||
  let gradMag = length(omegaMagGrad);
  if (gradMag < 0.001) { return; }
  let N = omegaMagGrad / gradMag;

  // Vorticity confinement force: f = ε (N × ω)
  // Use xsphFactor * 5.0 as vorticity strength (reuse existing param, scale up)
  let vorticityEps = params.surfaceTension * 2.0; // Piggyback on surface tension as proxy for vorticity strength
  let vorticityForce = cross(N, omega) * vorticityEps;

  // Clamp
  let fMag = length(vorticityForce);
  let clampedForce = select(vorticityForce, vorticityForce * (params.maxAccel * 0.2 / fMag), fMag > params.maxAccel * 0.2);

  velocities[idx] = vec4<f32>(myVel + clampedForce * params.dt, vel4.w);
}
`;

// ============================================================================
// SYSTEM
// ============================================================================

/**
 * Create the SPH fluid system.
 */
export function createSPHSystem(device, maxParticles) {
  // Density pass
  const densityModule = device.createShaderModule({ label: 'SPH.density.shader', code: SPH_DENSITY_SHADER });
  const densityPipeline = device.createComputePipeline({
    label: 'SPH.density.pipeline', layout: 'auto',
    compute: { module: densityModule, entryPoint: 'densityPass' },
  });

  // Force pass
  const forceModule = device.createShaderModule({ label: 'SPH.force.shader', code: SPH_FORCE_SHADER });
  const forcePipeline = device.createComputePipeline({
    label: 'SPH.force.pipeline', layout: 'auto',
    compute: { module: forceModule, entryPoint: 'forcePass' },
  });

  // Vorticity confinement pass (GAP 11)
  const vorticityModule = device.createShaderModule({ label: 'SPH.vorticity.shader', code: SPH_VORTICITY_SHADER });
  const vorticityPipeline = device.createComputePipeline({
    label: 'SPH.vorticity.pipeline', layout: 'auto',
    compute: { module: vorticityModule, entryPoint: 'vorticityPass' },
  });

  const paramsSize = 96; // 6 × vec4 = 96 bytes
  const densityParamsBuffer = createUniformBuffer(device, paramsSize, { label: 'SPH.density.params' });
  const forceParamsBuffer = createUniformBuffer(device, paramsSize, { label: 'SPH.force.params' });
  const vorticityParamsBuffer = createUniformBuffer(device, paramsSize, { label: 'SPH.vorticity.params' });
  labelResource(densityParamsBuffer, 'SPH.density.params');
  labelResource(forceParamsBuffer, 'SPH.force.params');
  labelResource(vorticityParamsBuffer, 'SPH.vorticity.params');

  // Per-particle density + pressure buffer (vec2<f32> per particle)
  const dpBuffer = device.createBuffer({
    label: 'SPH.densityPressure',
    size: maxParticles * 8,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  labelResource(dpBuffer, 'SPH.densityPressure');

  return {
    device,
    densityPipeline, forcePipeline, vorticityPipeline,
    densityParamsBuffer, forceParamsBuffer, vorticityParamsBuffer,
    dpBuffer,
    densityBindGroup: null,
    forceBindGroup: null,
    vorticityBindGroup: null,
    maxParticles,
    // Tuning — MUST match neighbor grid cellSize (set to 0.6 in EditorParticles.js)
    // h = 0.6 = 4× particle radius (0.15), standard SPH overlap ratio
    // restDensity: water ~1000 kg/m³ but scaled to editor units (1 unit ≈ 1m)
    // gasConstant: stiffness — higher = more incompressible, lower = more squishy
    // viscosity: water ~3.5, honey ~50, lava ~200
    smoothingRadius: 0.6,
    restDensity: 1000.0,
    particleMass: 4.0,    // heavier mass → denser kernel sum → reaches restDensity with fewer neighbors
    gasConstant: 20.0,    // softer stiffness avoids explosive pressure at low particle counts
    viscosity: 5.0,       // slightly higher than pure water for stable pooling
    surfaceTension: 1.5,
    xsphFactor: 0.3,
    gravity: [0, 0, 0],
    maxAccel: 80.0,
    // Existing editor consumers retain the y=0 ghost boundary by default.
    groundBoundaryEnabled: true,
  };
}

/**
 * Initialize bind groups. Requires neighbor grid buffers.
 */
export function initSPHBindGroups(system, device, positionBuffer, velocityBuffer, gridBuffers, thermalBuffer) {
  system.densityBindGroup = device.createBindGroup({
    label: 'SPH.density.bindGroup',
    layout: system.densityPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: system.densityParamsBuffer } },
      { binding: 1, resource: { buffer: positionBuffer } },
      { binding: 2, resource: { buffer: velocityBuffer } },
      { binding: 3, resource: { buffer: gridBuffers.cellCountsBuffer } },
      { binding: 4, resource: { buffer: gridBuffers.cellEntriesBuffer } },
      { binding: 5, resource: { buffer: system.dpBuffer } },
      { binding: 6, resource: { buffer: thermalBuffer } },
    ],
  });

  system.forceBindGroup = device.createBindGroup({
    label: 'SPH.force.bindGroup',
    layout: system.forcePipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: system.forceParamsBuffer } },
      { binding: 1, resource: { buffer: positionBuffer } },
      { binding: 2, resource: { buffer: velocityBuffer } },
      { binding: 3, resource: { buffer: gridBuffers.cellCountsBuffer } },
      { binding: 4, resource: { buffer: gridBuffers.cellEntriesBuffer } },
      { binding: 5, resource: { buffer: system.dpBuffer } },
      { binding: 6, resource: { buffer: thermalBuffer } },
    ],
  });

  // GAP 11: Vorticity confinement bind group (same layout as force pass)
  system.vorticityBindGroup = device.createBindGroup({
    label: 'SPH.vorticity.bindGroup',
    layout: system.vorticityPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: system.vorticityParamsBuffer } },
      { binding: 1, resource: { buffer: positionBuffer } },
      { binding: 2, resource: { buffer: velocityBuffer } },
      { binding: 3, resource: { buffer: gridBuffers.cellCountsBuffer } },
      { binding: 4, resource: { buffer: gridBuffers.cellEntriesBuffer } },
      { binding: 5, resource: { buffer: system.dpBuffer } },
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
 * Set SPH parameters at runtime.
 */
export function setSPHParams(system, config) {
  if (!system) return;
  if (config.smoothingRadius !== undefined) system.smoothingRadius = config.smoothingRadius;
  if (config.restDensity !== undefined) system.restDensity = config.restDensity;
  if (config.particleMass !== undefined) system.particleMass = config.particleMass;
  if (config.gasConstant !== undefined) system.gasConstant = config.gasConstant;
  if (config.viscosity !== undefined) system.viscosity = config.viscosity;
  if (config.surfaceTension !== undefined) system.surfaceTension = config.surfaceTension;
  if (config.xsphFactor !== undefined) system.xsphFactor = config.xsphFactor;
  if (config.gravity !== undefined) system.gravity = config.gravity;
  if (config.maxAccel !== undefined) system.maxAccel = config.maxAccel;
  if (config.groundBoundaryEnabled !== undefined) system.groundBoundaryEnabled = config.groundBoundaryEnabled !== false;
}

const _sphBuf = new ArrayBuffer(96);
const _sphU32 = new Uint32Array(_sphBuf);
const _sphF32 = new Float32Array(_sphBuf);

function uploadSPHParams(system, device, buffer, particleCount, dt) {
  _sphU32[0] = particleCount;
  _sphU32[1] = system._maxNeighbors || 16;
  _sphU32[2] = system._gridDimX || 50;
  _sphU32[3] = system._gridDimY || 50;
  _sphU32[4] = system._gridDimZ || 50;
  _sphU32[5] = system._numBuckets || 100000;
  // The former padding word stays zero for every existing/default caller.
  _sphU32[6] = system.groundBoundaryEnabled === false ? 1 : 0; _sphU32[7] = 0;

  const wm = system._worldMin || [-50, -50, -50];
  _sphF32[8]  = wm[0]; _sphF32[9]  = wm[1]; _sphF32[10] = wm[2];
  _sphF32[11] = system._cellSize || 2.0;

  _sphF32[12] = system.smoothingRadius;
  _sphF32[13] = system.restDensity;
  _sphF32[14] = system.particleMass;
  _sphF32[15] = system.gasConstant;

  _sphF32[16] = system.viscosity;
  _sphF32[17] = system.surfaceTension;
  _sphF32[18] = system.xsphFactor;
  _sphF32[19] = dt;

  _sphF32[20] = system.gravity[0]; _sphF32[21] = system.gravity[1]; _sphF32[22] = system.gravity[2];
  _sphF32[23] = system.maxAccel;

  device.queue.writeBuffer(buffer, 0, new Uint8Array(_sphBuf));
}

/**
 * Execute the two-pass SPH compute.
 */
export function executeSPH(system, device, particleCount, dt) {
  if (!system?.densityBindGroup || !system?.forceBindGroup || particleCount === 0) return;

  const wg = Math.ceil(particleCount / 64);

  // Pass 1: density estimation
  uploadSPHParams(system, device, system.densityParamsBuffer, particleCount, dt);
  const enc1 = device.createCommandEncoder({ label: 'SPH.density' });
  const p1 = enc1.beginComputePass({ label: 'SPH.density' });
  p1.setPipeline(system.densityPipeline);
  p1.setBindGroup(0, system.densityBindGroup);
  p1.dispatchWorkgroups(wg);
  p1.end();
  device.queue.submit([enc1.finish()]);

  // Pass 2: forces
  uploadSPHParams(system, device, system.forceParamsBuffer, particleCount, dt);
  const enc2 = device.createCommandEncoder({ label: 'SPH.force' });
  const p2 = enc2.beginComputePass({ label: 'SPH.force' });
  p2.setPipeline(system.forcePipeline);
  p2.setBindGroup(0, system.forceBindGroup);
  p2.dispatchWorkgroups(wg);
  p2.end();
  device.queue.submit([enc2.finish()]);

  // Pass 3: vorticity confinement (GAP 11)
  if (system.vorticityBindGroup) {
    uploadSPHParams(system, device, system.vorticityParamsBuffer, particleCount, dt);
    const enc3 = device.createCommandEncoder({ label: 'SPH.vorticity' });
    const p3 = enc3.beginComputePass({ label: 'SPH.vorticity' });
    p3.setPipeline(system.vorticityPipeline);
    p3.setBindGroup(0, system.vorticityBindGroup);
    p3.dispatchWorkgroups(wg);
    p3.end();
    device.queue.submit([enc3.finish()]);
  }
}

/**
 * Get the density/pressure buffer for use by surface renderers.
 */
export function getSPHDensityBuffer(system) {
  return system?.dpBuffer || null;
}

/**
 * Destroy.
 */
export function destroySPHSystem(system) {
  if (!system) return;
  if (system.densityParamsBuffer) system.densityParamsBuffer.destroy();
  if (system.forceParamsBuffer) system.forceParamsBuffer.destroy();
  if (system.vorticityParamsBuffer) system.vorticityParamsBuffer.destroy();
  if (system.dpBuffer) system.dpBuffer.destroy();
  system.densityBindGroup = null;
  system.forceBindGroup = null;
  system.vorticityBindGroup = null;
}
