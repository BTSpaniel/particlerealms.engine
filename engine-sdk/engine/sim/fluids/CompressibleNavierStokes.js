// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * CompressibleNavierStokes.js — Reformulated compressible Navier–Stokes (2026).
 *
 * GPU grid solver implementing the September 2026 compressible formulation
 * (arXiv:2609.06457) that retains BOTH viscosity channels and never assumes
 * Stokes' hypothesis:
 *
 *   mass:      ∂ρ/∂t + ∇·(ρv) = 0                        (genuinely compressible)
 *   momentum:  ρ(∂v/∂t + v·∇v) = X − ∇p
 *              + ∇·[ ρν(∇v + ∇vᵀ) + ρ(ν_l − 2ν)(∇·v)I ]
 *
 * where ν is the shear viscosity and ν_l = (λ + 2μ)/ρ is the longitudinal
 * viscosity. Setting ν_l = 4ν/3 recovers the Stokes-hypothesis form
 * (zero bulk viscosity), so "classic" behaviour is a material preset, not a
 * separate code path.
 *
 * The companion acoustic field integrates the paper's damped pressure wave
 *   ∂²p′/∂t² = c²∇²p′ + ν_l ∂/∂t ∇²p′ + S
 * by leapfrog, driven by −ρ0c²∇·v so density fluctuations radiate into p′.
 *
 * Per-cell materialID selects a row of a uniform material table
 * (ρ0, ν, ν_l, c, conductivity, transition temperature, flags), so one grid
 * hosts gas, melt, and immovable solids in the same solve.
 *
 * SingularityGuard: a block reduction pass publishes max|v|, max strain rate,
 * max|∇·v|, max vorticity, max|p′| and a NaN census through atomics; the CPU
 * side maps the small buffer and derives a CFL-safe timestep
 * (dt ≤ h·cfl / (|v|max + c_max)) plus instability flags. This is a numerical
 * monitor — it does not change the equations.
 *
 * Usage:
 *   const solver = createCompressibleNSSolver(device, { gridSize: [64,64,64] });
 *   setNSMaterials(solver, MATERIALS);
 *   setNSField(solver, { material });
 *   stepCompressibleNS(solver, device, dt, sources);
 *   const diag = await readNSDiagnostics(solver, device);
 */

import { createStorageBuffer, createUniformBuffer, updateBuffer } from "../../core/gpu/GpuBuffer.js";
import { labelResource } from "../../core/gpu/GpuDebug.js";

export const NS_MAX_MATERIALS = 8;
export const NS_MAX_SOURCES = 16;

export const NS_FLAG_IMMOVABLE = 1;   // velocity pinned; skipped by fluid passes
export const NS_FLAG_FLUID = 2;       // momentum + continuity apply
export const NS_FLAG_PHASE = 4;       // may transition when T crosses transTemp
export const NS_FLAG_GAS = 8;         // buoyancy + strong compressibility

// Source kinds.
export const NS_SOURCE_MELT = 0;      // deposit material + mass + heat
export const NS_SOURCE_SOLID = 1;     // moving solid region (writes mat + v)
export const NS_SOURCE_INFLOW = 2;    // blend velocity toward a target
export const NS_SOURCE_HEAT = 3;      // temperature injection only
export const NS_SOURCE_ACOUSTIC = 4;  // impulse into the acoustic field
export const NS_SOURCE_CLEAR = 5;     // revert cells to ambient fluid
export const NS_SOURCE_WALL_VELOCITY = 6; // set velocity of cells holding `material` (moving belts/walls)

const NS_COMMON = /* wgsl */`
struct NSParams {
  dims: vec4<u32>,     // gx, gy, gz, totalCells
  step: vec4<f32>,     // dt, cellSize, invCellSize, timeSec
  ambient: vec4<f32>,  // ambientRho, ambientTemp, gravityY, buoyancyAlpha
  misc: vec4<f32>,     // dissipation, maxSpeed, acousticCoupling, reserved
  counts: vec4<u32>,   // sourceCount, acousticEnabled, reserved, reserved
};

struct NSMaterial {
  a: vec4<f32>, // rho0, nu, nuL, soundSpeed
  b: vec4<f32>, // conductivity, transTemp, coolingRate, transMat
  c: vec4<f32>, // flags, viscosityActivationK (Ea/R), viscosityRefTempC, carreauLambda
  d: vec4<f32>, // carreauN, reserved, reserved, reserved
};

// Temperature- and shear-rate-dependent viscosity multiplier:
// Arrhenius shift a_T = exp(B(1/T − 1/T_ref)) times the Carreau factor
// (1 + (λ a_T γ̇)²)^((n−1)/2). Newtonian gases use B = 0, λ = 0 → 1.
fn nsViscosityFactor(m: NSMaterial, tempC: f32, shearRate: f32) -> f32 {
  var aT = 1.0;
  if (m.c.y > 0.0) {
    aT = exp(clamp(m.c.y * (1.0 / (max(tempC, -200.0) + 273.15) - 1.0 / (m.c.z + 273.15)), -30.0, 14.0));
  }
  var carreau = 1.0;
  if (m.c.w > 0.0) {
    let lg = m.c.w * aT * shearRate;
    carreau = pow(1.0 + lg * lg, 0.5 * (m.d.x - 1.0));
  }
  return aT * carreau;
}

struct NSSource {
  posRadius: vec4<f32>,  // cell-space xyz + radius
  velMat: vec4<f32>,     // vx, vy, vz, material id
  vals: vec4<f32>,       // rhoRate, temp, strength, kind
};

fn nsIdx(x: i32, y: i32, z: i32) -> u32 {
  let gx = i32(params.dims.x); let gy = i32(params.dims.y); let gz = i32(params.dims.z);
  let cx = clamp(x, 0, gx - 1);
  let cy = clamp(y, 0, gy - 1);
  let cz = clamp(z, 0, gz - 1);
  return u32(cz * gx * gy + cy * gx + cx);
}

fn nsIsFluid(m: u32) -> bool {
  return (u32(materials[u32(m)].c.x + 0.5) & ${NS_FLAG_FLUID}u) != 0u;
}

fn nsIsImmovable(m: u32) -> bool {
  return (u32(materials[u32(m)].c.x + 0.5) & ${NS_FLAG_IMMOVABLE}u) != 0u;
}

fn nsCellPos(gid: vec3<u32>) -> vec3<f32> {
  return vec3<f32>(gid) + 0.5;
}
`;

// 1 — Semi-Lagrangian advection of velocity/density/temperature; materialID is
// nearest-sampled so interfaces never blend material classes. Immovable cells
// copy through (their velocity is the moving-wall boundary condition).
const NS_ADVECT = NS_COMMON + /* wgsl */`
@group(0) @binding(0) var<uniform> params: NSParams;
@group(0) @binding(1) var<uniform> materials: array<NSMaterial, ${NS_MAX_MATERIALS}>;
@group(0) @binding(2) var<storage, read> velIn: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> velOut: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read> rhoIn: array<f32>;
@group(0) @binding(5) var<storage, read_write> rhoOut: array<f32>;
@group(0) @binding(6) var<storage, read> tempIn: array<f32>;
@group(0) @binding(7) var<storage, read_write> tempOut: array<f32>;
@group(0) @binding(8) var<storage, read> matIn: array<u32>;
@group(0) @binding(9) var<storage, read_write> matOut: array<u32>;

fn sampleScalar(field: ptr<storage, array<f32>, read>, pos: vec3<f32>) -> f32 {
  let p = pos - 0.5;
  let i = vec3<i32>(floor(p));
  let f = fract(p);
  let v000 = (*field)[nsIdx(i.x, i.y, i.z)];
  let v100 = (*field)[nsIdx(i.x + 1, i.y, i.z)];
  let v010 = (*field)[nsIdx(i.x, i.y + 1, i.z)];
  let v110 = (*field)[nsIdx(i.x + 1, i.y + 1, i.z)];
  let v001 = (*field)[nsIdx(i.x, i.y, i.z + 1)];
  let v101 = (*field)[nsIdx(i.x + 1, i.y, i.z + 1)];
  let v011 = (*field)[nsIdx(i.x, i.y + 1, i.z + 1)];
  let v111 = (*field)[nsIdx(i.x + 1, i.y + 1, i.z + 1)];
  let v0 = mix(mix(v000, v100, f.x), mix(v010, v110, f.x), f.y);
  let v1 = mix(mix(v001, v101, f.x), mix(v011, v111, f.x), f.y);
  return mix(v0, v1, f.z);
}

fn sampleVec(field: ptr<storage, array<vec4<f32>>, read>, pos: vec3<f32>) -> vec3<f32> {
  let p = pos - 0.5;
  let i = vec3<i32>(floor(p));
  let f = fract(p);
  let v000 = (*field)[nsIdx(i.x, i.y, i.z)].xyz;
  let v100 = (*field)[nsIdx(i.x + 1, i.y, i.z)].xyz;
  let v010 = (*field)[nsIdx(i.x, i.y + 1, i.z)].xyz;
  let v110 = (*field)[nsIdx(i.x + 1, i.y + 1, i.z)].xyz;
  let v001 = (*field)[nsIdx(i.x, i.y, i.z + 1)].xyz;
  let v101 = (*field)[nsIdx(i.x + 1, i.y, i.z + 1)].xyz;
  let v011 = (*field)[nsIdx(i.x, i.y + 1, i.z + 1)].xyz;
  let v111 = (*field)[nsIdx(i.x + 1, i.y + 1, i.z + 1)].xyz;
  let v0 = mix(mix(v000, v100, f.x), mix(v010, v110, f.x), f.y);
  let v1 = mix(mix(v001, v101, f.x), mix(v011, v111, f.x), f.y);
  return mix(v0, v1, f.z);
}

@compute @workgroup_size(4, 4, 4)
fn advect(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= params.dims.x || gid.y >= params.dims.y || gid.z >= params.dims.z) { return; }
  let ci = gid.z * params.dims.x * params.dims.y + gid.y * params.dims.x + gid.x;
  let mat = matIn[ci];

  if (nsIsImmovable(mat)) {
    velOut[ci] = velIn[ci];
    rhoOut[ci] = rhoIn[ci];
    tempOut[ci] = tempIn[ci];
    matOut[ci] = mat;
    return;
  }

  let pos = nsCellPos(gid);
  let vel = velIn[ci].xyz;
  let back = pos - vel * params.step.x * params.step.z;
  velOut[ci] = vec4<f32>(sampleVec(&velIn, back) * params.misc.x, 0.0);
  rhoOut[ci] = rhoIn[ci];
  tempOut[ci] = sampleScalar(&tempIn, back);
  matOut[ci] = mat;
}
`;

// 2 — Source splats: melt deposition, moving solids (nozzle), inflow vents,
// heat sources, acoustic impulses, and clear-back-to-air regions. Runs
// in-place on the advected fields.
const NS_SOURCES = NS_COMMON + /* wgsl */`
@group(0) @binding(0) var<uniform> params: NSParams;
@group(0) @binding(1) var<uniform> materials: array<NSMaterial, ${NS_MAX_MATERIALS}>;
@group(0) @binding(2) var<storage, read_write> velocity: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> density: array<f32>;
@group(0) @binding(4) var<storage, read_write> temperature: array<f32>;
@group(0) @binding(5) var<storage, read_write> materialId: array<u32>;
@group(0) @binding(6) var<storage, read> sources: array<NSSource>;
@group(0) @binding(7) var<storage, read_write> acoustic: array<f32>;

@compute @workgroup_size(4, 4, 4)
fn applySources(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= params.dims.x || gid.y >= params.dims.y || gid.z >= params.dims.z) { return; }
  let ci = gid.z * params.dims.x * params.dims.y + gid.y * params.dims.x + gid.x;
  let pos = nsCellPos(gid);

  var vel = velocity[ci].xyz;
  var rho = density[ci];
  var temp = temperature[ci];
  var mat = materialId[ci];

  for (var s = 0u; s < min(params.counts.x, ${NS_MAX_SOURCES}u); s++) {
    let src = sources[s];
    let diff = pos - src.posRadius.xyz;
    let dist = length(diff);
    if (dist >= src.posRadius.w) { continue; }
    let fall = 1.0 - dist / max(src.posRadius.w, 1e-4);
    let kind = u32(src.vals.w + 0.5);
    let strength = src.vals.z;

    if (kind == ${NS_SOURCE_MELT}u) {
      let m = u32(src.velMat.w + 0.5);
      mat = m;
      rho = min(rho + src.vals.x * fall * strength * params.step.x,
        materials[m].a.x * 1.5);
      temp = max(temp, src.vals.y);
      vel = mix(vel, src.velMat.xyz, clamp(strength * fall, 0.0, 1.0));
    } else if (kind == ${NS_SOURCE_SOLID}u) {
      mat = u32(src.velMat.w + 0.5);
      vel = src.velMat.xyz;
      rho = materials[u32(src.velMat.w + 0.5)].a.x;
      temp = max(temp, src.vals.y);
    } else if (kind == ${NS_SOURCE_INFLOW}u) {
      if (nsIsFluid(mat)) {
        vel = mix(vel, src.velMat.xyz, clamp(strength * fall * params.step.x, 0.0, 1.0));
      }
    } else if (kind == ${NS_SOURCE_HEAT}u) {
      temp = mix(temp, src.vals.y, clamp(strength * fall * params.step.x, 0.0, 1.0));
    } else if (kind == ${NS_SOURCE_ACOUSTIC}u) {
      acoustic[ci] += src.vals.x * fall * strength;
    } else if (kind == ${NS_SOURCE_WALL_VELOCITY}u) {
      if (mat == u32(src.velMat.w + 0.5)) { vel = src.velMat.xyz; }
    } else if (kind == ${NS_SOURCE_CLEAR}u) {
      // Only revert cells still holding the cleared material, so a nozzle's
      // wake never deletes freshly deposited melt.
      if (mat == u32(src.velMat.w + 0.5)) {
        mat = 0u;
        rho = params.ambient.x;
        temp = params.ambient.y;
        vel = vec3<f32>(0.0);
      }
    }
  }

  velocity[ci] = vec4<f32>(vel, 0.0);
  density[ci] = rho;
  temperature[ci] = temp;
  materialId[ci] = mat;
}
`;

// 3 — Velocity gradient tensor → divergence + symmetric viscous stress
//   σ = ρν(∇v + ∇vᵀ) + ρ(ν_l − 2ν)(∇·v)I
// plus |∇×v| for diagnostics. Immovable neighbours contribute their boundary
// velocity, which is what drags air along a moving nozzle.
const NS_STRESS = NS_COMMON + /* wgsl */`
@group(0) @binding(0) var<uniform> params: NSParams;
@group(0) @binding(1) var<uniform> materials: array<NSMaterial, ${NS_MAX_MATERIALS}>;
@group(0) @binding(2) var<storage, read> velocity: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> density: array<f32>;
@group(0) @binding(4) var<storage, read> materialId: array<u32>;
@group(0) @binding(5) var<storage, read_write> sigmaA: array<vec4<f32>>; // xx yy zz xy
@group(0) @binding(6) var<storage, read_write> sigmaB: array<vec4<f32>>; // xz yz curl div
@group(0) @binding(7) var<storage, read_write> divergence: array<f32>;
@group(0) @binding(8) var<storage, read> temperature: array<f32>;

@compute @workgroup_size(4, 4, 4)
fn computeStress(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= params.dims.x || gid.y >= params.dims.y || gid.z >= params.dims.z) { return; }
  let ci = gid.z * params.dims.x * params.dims.y + gid.y * params.dims.x + gid.x;
  let ix = i32(gid.x); let iy = i32(gid.y); let iz = i32(gid.z);
  let h2 = 0.5 * params.step.z;

  let vR = velocity[nsIdx(ix + 1, iy, iz)].xyz;
  let vL = velocity[nsIdx(ix - 1, iy, iz)].xyz;
  let vU = velocity[nsIdx(ix, iy + 1, iz)].xyz;
  let vD = velocity[nsIdx(ix, iy - 1, iz)].xyz;
  let vF = velocity[nsIdx(ix, iy, iz + 1)].xyz;
  let vB = velocity[nsIdx(ix, iy, iz - 1)].xyz;

  let dudx = (vR.x - vL.x) * h2; let dudy = (vU.x - vD.x) * h2; let dudz = (vF.x - vB.x) * h2;
  let dvdx = (vR.y - vL.y) * h2; let dvdy = (vU.y - vD.y) * h2; let dvdz = (vF.y - vB.y) * h2;
  let dwdx = (vR.z - vL.z) * h2; let dwdy = (vU.z - vD.z) * h2; let dwdz = (vF.z - vB.z) * h2;

  let div = dudx + dvdy + dwdz;
  divergence[ci] = div;

  let mat = materialId[ci];
  let props = materials[u32(mat)];
  let rho = density[ci];
  let exx = dudx; let eyy = dvdy; let ezz = dwdz;
  let exy = 0.5 * (dudy + dvdx); let exz = 0.5 * (dudz + dwdx); let eyz = 0.5 * (dvdz + dwdy);
  let shearRate = sqrt(2.0 * (exx * exx + eyy * eyy + ezz * ezz) + 4.0 * (exy * exy + exz * exz + eyz * eyz));
  let factor = nsViscosityFactor(props, temperature[ci], shearRate);
  var nu = props.a.y * factor;
  var nuL = props.a.z * factor;
  // Explicit viscous stability: ν·dt/h² ≤ 1/6. Very stiff melt (near Tg) is
  // clamped at the limit with ν_l/ν preserved — it then behaves as a rigid,
  // no-slip body riding its neighbours, which is the physical outcome.
  let nuStable = params.step.y * params.step.y / (6.5 * max(params.step.x, 1e-6));
  let stiff = max(nu, nuL);
  if (stiff > nuStable) { let s = nuStable / stiff; nu *= s; nuL *= s; }

  // σ = ρν(∇v + ∇vᵀ) + ρ(ν_l − 2ν)(∇·v)I   — the reformulated term.
  let shear = rho * nu;
  let bulk = rho * (nuL - 2.0 * nu) * div;
  sigmaA[ci] = vec4<f32>(
    shear * 2.0 * dudx + bulk,
    shear * 2.0 * dvdy + bulk,
    shear * 2.0 * dwdz + bulk,
    shear * (dudy + dvdx),
  );
  let curl = vec3<f32>(dwdy - dvdz, dudz - dwdx, dvdx - dudy);
  sigmaB[ci] = vec4<f32>(
    shear * (dudz + dwdx),
    shear * (dvdz + dwdy),
    length(curl),
    sqrt(dudx * dudx + dudy * dudy + dudz * dudz
      + dvdx * dvdx + dvdy * dvdy + dvdz * dvdz
      + dwdx * dwdx + dwdy * dwdy + dwdz * dwdz),
  );
}
`;

// 4 — Momentum: v += dt(−∇p + ∇·σ)/ρ + X. Pressure is barotropic per material
// (p = c²(ρ − ρ0) → ∇p = c²∇ρ); gas cells additionally feel thermal buoyancy.
const NS_MOMENTUM = NS_COMMON + /* wgsl */`
@group(0) @binding(0) var<uniform> params: NSParams;
@group(0) @binding(1) var<uniform> materials: array<NSMaterial, ${NS_MAX_MATERIALS}>;
@group(0) @binding(2) var<storage, read_write> velocity: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> density: array<f32>;
@group(0) @binding(4) var<storage, read> temperature: array<f32>;
@group(0) @binding(5) var<storage, read> materialId: array<u32>;
@group(0) @binding(6) var<storage, read> sigmaA: array<vec4<f32>>;
@group(0) @binding(7) var<storage, read> sigmaB: array<vec4<f32>>;

fn nsPressure(cell: u32, boundaryPressure: f32) -> f32 {
  let material = materialId[cell];
  if (!nsIsFluid(material)) { return boundaryPressure; }
  let props = materials[material].a;
  return props.w * props.w * (density[cell] - props.x);
}

@compute @workgroup_size(4, 4, 4)
fn applyMomentum(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= params.dims.x || gid.y >= params.dims.y || gid.z >= params.dims.z) { return; }
  let ci = gid.z * params.dims.x * params.dims.y + gid.y * params.dims.x + gid.x;
  let ix = i32(gid.x); let iy = i32(gid.y); let iz = i32(gid.z);

  let mat = materialId[ci];
  if (!nsIsFluid(mat)) { return; }
  let props = materials[u32(mat)];
  let rho = max(density[ci], 0.02 * props.a.x);
  let c2 = props.a.w * props.a.w;
  let h2 = 0.5 * params.step.z;

  // ∇p from the per-material barotropic equation of state; solid faces reflect pressure.
  let p = c2 * (density[ci] - props.a.x);
  let gradP = vec3<f32>(
    (nsPressure(nsIdx(ix + 1, iy, iz), p) - nsPressure(nsIdx(ix - 1, iy, iz), p)) * h2,
    (nsPressure(nsIdx(ix, iy + 1, iz), p) - nsPressure(nsIdx(ix, iy - 1, iz), p)) * h2,
    (nsPressure(nsIdx(ix, iy, iz + 1), p) - nsPressure(nsIdx(ix, iy, iz - 1), p)) * h2,
  );

  // ∇·σ from neighbour stress tensors
  let sR = sigmaA[nsIdx(ix + 1, iy, iz)]; let sL = sigmaA[nsIdx(ix - 1, iy, iz)];
  let sU = sigmaA[nsIdx(ix, iy + 1, iz)]; let sD = sigmaA[nsIdx(ix, iy - 1, iz)];
  let sF = sigmaA[nsIdx(ix, iy, iz + 1)]; let sB = sigmaA[nsIdx(ix, iy, iz - 1)];
  let sRb = sigmaB[nsIdx(ix + 1, iy, iz)]; let sLb = sigmaB[nsIdx(ix - 1, iy, iz)];
  let sUb = sigmaB[nsIdx(ix, iy + 1, iz)]; let sDb = sigmaB[nsIdx(ix, iy - 1, iz)];
  let sFb = sigmaB[nsIdx(ix, iy, iz + 1)]; let sBb = sigmaB[nsIdx(ix, iy, iz - 1)];

  let divSigma = vec3<f32>(
    (sR.x - sL.x) * h2 + (sU.w - sD.w) * h2 + (sFb.x - sBb.x) * h2,
    (sR.w - sL.w) * h2 + (sU.y - sD.y) * h2 + (sFb.y - sBb.y) * h2,
    (sRb.x - sLb.x) * h2 + (sUb.y - sDb.y) * h2 + (sF.z - sB.z) * h2,
  );

  var accel = (divSigma - gradP) / rho;

  // Gravity + thermal buoyancy for gas cells.
  if ((u32(props.c.x + 0.5) & ${NS_FLAG_GAS}u) != 0u) {
    accel.y += params.ambient.z + params.ambient.w * (temperature[ci] - params.ambient.y);
  } else {
    accel.y += params.ambient.z;
  }

  var vel = velocity[ci].xyz + accel * params.step.x;
  let speed = length(vel);
  if (speed > params.misc.y) { vel *= params.misc.y / speed; }
  velocity[ci] = vec4<f32>(vel, 0.0);
}
`;

// 5 — Continuity: ∂ρ/∂t = −∇·(ρv). This is where the reformulation diverges
// from the incompressible solver — density is transported and compressed, never
// projected back to divergence-free.
const NS_CONTINUITY = NS_COMMON + /* wgsl */`
@group(0) @binding(0) var<uniform> params: NSParams;
@group(0) @binding(1) var<uniform> materials: array<NSMaterial, ${NS_MAX_MATERIALS}>;
@group(0) @binding(2) var<storage, read> velocity: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> density: array<f32>;
@group(0) @binding(4) var<storage, read_write> densityNext: array<f32>;
@group(0) @binding(5) var<storage, read> materialId: array<u32>;

fn massFlux(ci: u32, ni: u32, axis: u32) -> f32 {
  if (!nsIsFluid(materialId[ci]) || !nsIsFluid(materialId[ni])) { return 0.0; }
  let faceVelocity = 0.5 * (velocity[ci][axis] + velocity[ni][axis]);
  return faceVelocity * select(density[ni], density[ci], faceVelocity >= 0.0);
}

@compute @workgroup_size(4, 4, 4)
fn applyContinuity(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= params.dims.x || gid.y >= params.dims.y || gid.z >= params.dims.z) { return; }
  let ci = gid.z * params.dims.x * params.dims.y + gid.y * params.dims.x + gid.x;
  let ix = i32(gid.x); let iy = i32(gid.y); let iz = i32(gid.z);
  if (!nsIsFluid(materialId[ci])) { densityNext[ci] = density[ci]; return; }
  var flux = 0.0;
  if (gid.x + 1u < params.dims.x) { flux += massFlux(ci, nsIdx(ix + 1, iy, iz), 0u); }
  if (gid.x > 0u) { flux -= massFlux(nsIdx(ix - 1, iy, iz), ci, 0u); }
  if (gid.y + 1u < params.dims.y) { flux += massFlux(ci, nsIdx(ix, iy + 1, iz), 1u); }
  if (gid.y > 0u) { flux -= massFlux(nsIdx(ix, iy - 1, iz), ci, 1u); }
  if (gid.z + 1u < params.dims.z) { flux += massFlux(ci, nsIdx(ix, iy, iz + 1), 2u); }
  if (gid.z > 0u) { flux -= massFlux(nsIdx(ix, iy, iz - 1), ci, 2u); }
  densityNext[ci] = max(density[ci] - flux * params.step.x * params.step.z, 0.0);
}
`;

// 6 — Acoustic field (optional): leapfrog integration of the paper's damped
// pressure wave ∂²p′/∂t² = c²∇²p′ + ν_l ∂/∂t∇²p′ + S, with S = −ρ0c²∇·v so
// compression events radiate. Three buffers rotate prev → curr → next.
const NS_ACOUSTIC = NS_COMMON + /* wgsl */`
@group(0) @binding(0) var<uniform> params: NSParams;
@group(0) @binding(1) var<uniform> materials: array<NSMaterial, ${NS_MAX_MATERIALS}>;
@group(0) @binding(2) var<storage, read> pPrev: array<f32>;
@group(0) @binding(3) var<storage, read> pCurr: array<f32>;
@group(0) @binding(4) var<storage, read_write> pNext: array<f32>;
@group(0) @binding(5) var<storage, read> divergence: array<f32>;
@group(0) @binding(6) var<storage, read> materialId: array<u32>;

fn lapField(field: ptr<storage, array<f32>, read>, ix: i32, iy: i32, iz: i32) -> f32 {
  let h2 = params.step.y * params.step.y;
  let c = (*field)[nsIdx(ix, iy, iz)];
  return (
    (*field)[nsIdx(ix + 1, iy, iz)] + (*field)[nsIdx(ix - 1, iy, iz)]
    + (*field)[nsIdx(ix, iy + 1, iz)] + (*field)[nsIdx(ix, iy - 1, iz)]
    + (*field)[nsIdx(ix, iy, iz + 1)] + (*field)[nsIdx(ix, iy, iz - 1)]
    - 6.0 * c
  ) / h2;
}

@compute @workgroup_size(4, 4, 4)
fn stepAcoustic(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= params.dims.x || gid.y >= params.dims.y || gid.z >= params.dims.z) { return; }
  let ci = gid.z * params.dims.x * params.dims.y + gid.y * params.dims.x + gid.x;
  let ix = i32(gid.x); let iy = i32(gid.y); let iz = i32(gid.z);

  let mat = materialId[ci];
  if (!nsIsFluid(mat)) { pNext[ci] = 0.0; return; }
  let props = materials[u32(mat)];
  let dt = params.step.x;

  let lapC = lapField(&pCurr, ix, iy, iz);
  let lapP = lapField(&pPrev, ix, iy, iz);
  let c2 = props.a.w * props.a.w;
  let nuL = props.a.z;
  // Linearized continuity couples the bulk solve into the acoustic field.
  let drive = -props.a.x * c2 * divergence[ci] * params.misc.z;

  let acc = c2 * lapC + nuL * (lapC - lapP) / max(dt, 1e-6) + drive;
  pNext[ci] = 2.0 * pCurr[ci] - pPrev[ci] + dt * dt * acc;
}
`;

// 7 — Heat diffusion + ambient cooling + phase transitions. Melt below its
// transition temperature becomes the material named by transMat; immovable
// cells only conduct toward their own temperature.
const NS_PHASE = NS_COMMON + /* wgsl */`
@group(0) @binding(0) var<uniform> params: NSParams;
@group(0) @binding(1) var<uniform> materials: array<NSMaterial, ${NS_MAX_MATERIALS}>;
@group(0) @binding(2) var<storage, read> temperature: array<f32>;
@group(0) @binding(3) var<storage, read> materialId: array<u32>;
@group(0) @binding(4) var<storage, read_write> temperatureNext: array<f32>;
@group(0) @binding(5) var<storage, read_write> materialNext: array<u32>;

@compute @workgroup_size(4, 4, 4)
fn applyPhase(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= params.dims.x || gid.y >= params.dims.y || gid.z >= params.dims.z) { return; }
  let ci = gid.z * params.dims.x * params.dims.y + gid.y * params.dims.x + gid.x;
  let ix = i32(gid.x); let iy = i32(gid.y); let iz = i32(gid.z);

  let mat = materialId[ci];
  let props = materials[u32(mat)];
  let t = temperature[ci];
  let h2 = params.step.y * params.step.y;
  let lap = (
    temperature[nsIdx(ix + 1, iy, iz)] + temperature[nsIdx(ix - 1, iy, iz)]
    + temperature[nsIdx(ix, iy + 1, iz)] + temperature[nsIdx(ix, iy - 1, iz)]
    + temperature[nsIdx(ix, iy, iz + 1)] + temperature[nsIdx(ix, iy, iz - 1)]
    - 6.0 * t
  ) / h2;

  // Explicit diffusion stability: κ·dt/h² ≤ 1/6.
  let kappa = min(props.b.x, h2 / (6.5 * max(params.step.x, 1e-6)));
  var next = t + params.step.x * (kappa * lap - props.b.z * (t - params.ambient.y));
  next = clamp(next, 0.0, 4096.0);
  temperatureNext[ci] = next;

  // Melt → solid transition. One-way: solids never re-melt in the solver.
  materialNext[ci] = mat;
  if ((u32(props.c.x + 0.5) & ${NS_FLAG_PHASE}u) != 0u && next < props.b.y) {
    materialNext[ci] = u32(props.b.w + 0.5);
  }
}
`;

// 8 — SingularityGuard diagnostics: non-negative floats are order-preserved
// under bitcast<u32>, so atomicMax publishes exact maxima without a tree
// reduction. Slot layout is documented on readNSDiagnostics().
const NS_DIAGNOSTICS = NS_COMMON + /* wgsl */`
@group(0) @binding(0) var<uniform> params: NSParams;
@group(0) @binding(1) var<uniform> materials: array<NSMaterial, ${NS_MAX_MATERIALS}>;
@group(0) @binding(2) var<storage, read> velocity: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> density: array<f32>;
@group(0) @binding(4) var<storage, read> divergence: array<f32>;
@group(0) @binding(5) var<storage, read> sigmaB: array<vec4<f32>>;
@group(0) @binding(6) var<storage, read> acoustic: array<f32>;
@group(0) @binding(7) var<storage, read> materialId: array<u32>;
@group(0) @binding(8) var<storage, read_write> diag: array<atomic<u32>>;

@compute @workgroup_size(4, 4, 4)
fn reduceDiagnostics(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= params.dims.x || gid.y >= params.dims.y || gid.z >= params.dims.z) { return; }
  let ci = gid.z * params.dims.x * params.dims.y + gid.y * params.dims.x + gid.x;

  let vel = velocity[ci].xyz;
  let rho = density[ci];
  let p = acoustic[ci];
  // WGSL has no isnan builtin; NaN is the only value unequal to itself.
  let grad = sigmaB[ci].w;
  if (vel.x != vel.x || vel.y != vel.y || vel.z != vel.z || rho != rho || p != p
      || grad != grad || divergence[ci] != divergence[ci]) {
    atomicAdd(&diag[4], 1u);
    return;
  }
  if (!nsIsFluid(materialId[ci])) { return; }

  atomicMax(&diag[0], bitcast<u32>(length(vel)));
  atomicMax(&diag[1], bitcast<u32>(abs(divergence[ci])));
  atomicMax(&diag[2], bitcast<u32>(rho));
  atomicMax(&diag[3], bitcast<u32>(sigmaB[ci].z));
  atomicMax(&diag[5], bitcast<u32>(abs(p)));
  atomicAdd(&diag[6], 1u);
  atomicMax(&diag[7], bitcast<u32>(grad));
}
`;

// ============================================================================
// SOLVER
// ============================================================================

/**
 * @param {GPUDevice} device
 * @param {Object} config
 * @param {number[]} config.gridSize - [x,y,z] cells (default [64,64,64])
 * @param {number} config.cellSize - world units per cell (default 1)
 * @param {number} config.ambientRho - rest density for material 0 (default 1)
 * @param {number} config.ambientTemp - ambient temperature (default 0)
 * @param {number} config.gravityY - gravity accel in cells/s² (default -9.8)
 * @param {number} config.buoyancyAlpha - thermal buoyancy gain for gas (default 0.002)
 * @param {number} config.dissipation - advection retention (default 0.998)
 * @param {number} config.maxSpeed - hard velocity clamp in cells/s (default 64)
 * @param {number} config.acousticCoupling - div→p′ drive gain (default 1)
 * @param {boolean} config.acousticEnabled - run the p′ pass (default true)
 * @param {number} config.cfl - CFL safety factor for suggested dt (default 0.4)
 */
export function createCompressibleNSSolver(device, config = {}) {
  const gridSize = config.gridSize || [64, 64, 64];
  const [gx, gy, gz] = gridSize;
  const totalCells = gx * gy * gz;
  const cellSize = config.cellSize ?? 1;

  const modules = {
    advect: device.createShaderModule({ label: 'NS.advect', code: NS_ADVECT }),
    sources: device.createShaderModule({ label: 'NS.sources', code: NS_SOURCES }),
    stress: device.createShaderModule({ label: 'NS.stress', code: NS_STRESS }),
    momentum: device.createShaderModule({ label: 'NS.momentum', code: NS_MOMENTUM }),
    continuity: device.createShaderModule({ label: 'NS.continuity', code: NS_CONTINUITY }),
    acoustic: device.createShaderModule({ label: 'NS.acoustic', code: NS_ACOUSTIC }),
    phase: device.createShaderModule({ label: 'NS.phase', code: NS_PHASE }),
    diagnostics: device.createShaderModule({ label: 'NS.diagnostics', code: NS_DIAGNOSTICS }),
  };
  const pipelines = {};
  for (const [name, module] of Object.entries(modules)) {
    const entry = {
      advect: 'advect', sources: 'applySources', stress: 'computeStress',
      momentum: 'applyMomentum', continuity: 'applyContinuity',
      acoustic: 'stepAcoustic', phase: 'applyPhase', diagnostics: 'reduceDiagnostics',
    }[name];
    pipelines[name] = device.createComputePipeline({
      label: `NS.${name}Pipe`, layout: 'auto',
      compute: { module, entryPoint: entry },
    });
  }

  const paramsBuffer = createUniformBuffer(device, 80, { label: 'NS.params' });
  const materialsBuffer = createUniformBuffer(device, NS_MAX_MATERIALS * 64, { label: 'NS.materials' });
  const sourceBuffer = createStorageBuffer(device, NS_MAX_SOURCES * 48, { label: 'NS.sources' });
  const diagBuffer = createStorageBuffer(device, 16 * 4, { label: 'NS.diag' });
  const diagStaging = device.createBuffer({
    label: 'NS.diagStaging', size: 64,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });

  const vBytes = totalCells * 16;
  const sBytes = totalCells * 4;
  const mk = (label, bytes) => createStorageBuffer(device, bytes, { label: `NS.${label}` });
  const solver = {
    device, gridSize, gx, gy, gz, totalCells, cellSize,
    paramsBuffer, materialsBuffer, sourceBuffer, diagBuffer, diagStaging,
    velA: mk('velA', vBytes), velB: mk('velB', vBytes),
    rhoA: mk('rhoA', sBytes), rhoB: mk('rhoB', sBytes), rhoNext: mk('rhoNext', sBytes),
    tempA: mk('tempA', sBytes), tempB: mk('tempB', sBytes), tempNext: mk('tempNext', sBytes),
    matA: mk('matA', sBytes), matB: mk('matB', sBytes), matNext: mk('matNext', sBytes),
    sigmaA: mk('sigmaA', vBytes), sigmaB: mk('sigmaB', vBytes),
    divBuffer: mk('div', sBytes),
    pPrev: mk('pPrev', sBytes), pCurr: mk('pCurr', sBytes), pNext: mk('pNext', sBytes),
    pipelines,
    ambientRho: config.ambientRho ?? 1.0,
    ambientTemp: config.ambientTemp ?? 0.0,
    gravityY: config.gravityY ?? -9.8,
    buoyancyAlpha: config.buoyancyAlpha ?? 0.002,
    dissipation: config.dissipation ?? 0.998,
    maxSpeed: config.maxSpeed ?? 64,
    acousticCoupling: config.acousticCoupling ?? 1.0,
    acousticEnabled: config.acousticEnabled !== false,
    cfl: config.cfl ?? 0.4,
    timeSec: 0,
    _parity: 0,
    _bg: null,
    _diagInFlight: false,
    _materials: new Array(NS_MAX_MATERIALS).fill(null).map(() => ({
      rho0: 1, nu: 0.001, nuL: 0.0013, c: 8, conductivity: 0.01,
      transTemp: -1e9, coolingRate: 0, transMat: 0, flags: NS_FLAG_FLUID | NS_FLAG_GAS,
    })),
  };

  _initFields(solver);
  setNSMaterials(solver, solver._materials);
  _buildBindGroups(solver);
  return solver;
}

function _initFields(solver) {
  const n = solver.totalCells;
  const rho = new Float32Array(n).fill(solver.ambientRho);
  const temp = new Float32Array(n).fill(solver.ambientTemp);
  const mat = new Uint32Array(n); // all material 0 (fluid)
  solver.device.queue.writeBuffer(solver.rhoA, 0, rho);
  solver.device.queue.writeBuffer(solver.rhoB, 0, rho);
  solver.device.queue.writeBuffer(solver.tempA, 0, temp);
  solver.device.queue.writeBuffer(solver.tempB, 0, temp);
  solver.device.queue.writeBuffer(solver.matA, 0, mat);
  solver.device.queue.writeBuffer(solver.matB, 0, mat);
}

/**
 * Upload the material table. Each entry: {
 *   rho0, nu, nuL, c, conductivity, transTemp, coolingRate, transMat, flags,
 *   viscosityActivationK, viscosityRefTemp, carreauLambda, carreauN }
 * nu/nuL are the reference values at viscosityRefTemp and zero shear rate.
 * Missing entries keep the ambient-fluid default.
 */
export function setNSMaterials(solver, materials) {
  const data = new Float32Array(NS_MAX_MATERIALS * 16);
  for (let i = 0; i < NS_MAX_MATERIALS; i++) {
    const m = { ...solver._materials[i], ...(materials[i] || {}) };
    solver._materials[i] = m;
    const o = i * 16;
    data[o + 0] = m.rho0; data[o + 1] = m.nu; data[o + 2] = m.nuL; data[o + 3] = m.c;
    data[o + 4] = m.conductivity; data[o + 5] = m.transTemp; data[o + 6] = m.coolingRate;
    data[o + 7] = m.transMat ?? 0;
    data[o + 8] = m.flags ?? 0;
    data[o + 9] = m.viscosityActivationK ?? 0;
    data[o + 10] = m.viscosityRefTemp ?? 0;
    data[o + 11] = m.carreauLambda ?? 0;
    data[o + 12] = m.carreauN ?? 1;
  }
  updateBuffer(solver.device, solver.materialsBuffer, data);
}

/**
 * Bulk-upload an initial field. All arrays are optional and indexed by cell.
 *   { material: Uint32Array, density: Float32Array, temperature: Float32Array,
 *     velocity: Float32Array (xyz×n) }
 */
export function setNSField(solver, fields = {}) {
  const n = solver.totalCells;
  const d = solver.device;
  for (const buf of ['matA', 'matB']) {
    if (fields.material) d.queue.writeBuffer(solver[buf], 0, fields.material.subarray(0, n));
  }
  for (const buf of ['rhoA', 'rhoB']) {
    if (fields.density) d.queue.writeBuffer(solver[buf], 0, fields.density.subarray(0, n));
  }
  for (const buf of ['tempA', 'tempB']) {
    if (fields.temperature) d.queue.writeBuffer(solver[buf], 0, fields.temperature.subarray(0, n));
  }
  if (fields.acoustic) {
    for (const buf of [solver.pPrev, solver.pCurr, solver.pNext]) {
      d.queue.writeBuffer(buf, 0, fields.acoustic.subarray(0, n));
    }
  }
  if (fields.velocity) {
    const packed = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      packed[i * 4 + 0] = fields.velocity[i * 3 + 0];
      packed[i * 4 + 1] = fields.velocity[i * 3 + 1];
      packed[i * 4 + 2] = fields.velocity[i * 3 + 2];
    }
    d.queue.writeBuffer(solver.velA, 0, packed);
    d.queue.writeBuffer(solver.velB, 0, packed);
  }
}

// Bind groups: advect runs A→B or B→A by parity; everything else is in-place
// on the destination side, so every pass needs two bind groups keyed by which
// side is "current output".
function _buildBindGroups(solver) {
  const d = solver.device;
  const P = solver.pipelines;
  const buf = (b) => ({ resource: { buffer: b } });

  const advectBG = (inp, outp) => d.createBindGroup({
    layout: P.advect.getBindGroupLayout(0), entries: [
      buf(solver.paramsBuffer), buf(solver.materialsBuffer),
      buf(inp.vel), buf(outp.vel), buf(inp.rho), buf(outp.rho),
      buf(inp.temp), buf(outp.temp), buf(inp.mat), buf(outp.mat),
    ].map((r, i) => ({ binding: i, resource: r.resource })),
  });

  const A = { vel: solver.velA, rho: solver.rhoA, temp: solver.tempA, mat: solver.matA };
  const B = { vel: solver.velB, rho: solver.rhoB, temp: solver.tempB, mat: solver.matB };

  const stressBG = (side) => d.createBindGroup({
    layout: P.stress.getBindGroupLayout(0), entries: [
      solver.paramsBuffer, solver.materialsBuffer,
      side.vel, side.rho, side.mat, solver.sigmaA, solver.sigmaB, solver.divBuffer, side.temp,
    ].map((b, i) => ({ binding: i, resource: { buffer: b } })),
  });

  const momentumBG = (side) => d.createBindGroup({
    layout: P.momentum.getBindGroupLayout(0), entries: [
      solver.paramsBuffer, solver.materialsBuffer,
      side.vel, side.rho, side.temp, side.mat, solver.sigmaA, solver.sigmaB,
    ].map((b, i) => ({ binding: i, resource: { buffer: b } })),
  });

  const continuityBG = (side) => d.createBindGroup({
    layout: P.continuity.getBindGroupLayout(0), entries: [
      solver.paramsBuffer, solver.materialsBuffer,
      side.vel, side.rho, solver.rhoNext, side.mat,
    ].map((b, i) => ({ binding: i, resource: { buffer: b } })),
  });

  // Acoustic rotation: (prev,curr,next) cycles with parity — three combos.
  const acousticBG = (prev, curr, next, side) => d.createBindGroup({
    layout: P.acoustic.getBindGroupLayout(0), entries: [
      solver.paramsBuffer, solver.materialsBuffer,
      prev, curr, next, solver.divBuffer, side.mat,
    ].map((b, i) => ({ binding: i, resource: { buffer: b } })),
  });

  const phaseBG = (side) => d.createBindGroup({
    layout: P.phase.getBindGroupLayout(0), entries: [
      solver.paramsBuffer, solver.materialsBuffer, side.temp, side.mat, solver.tempNext, solver.matNext,
    ].map((b, i) => ({ binding: i, resource: { buffer: b } })),
  });

  const diagnosticsBG = (side, acousticBuf) => d.createBindGroup({
    layout: P.diagnostics.getBindGroupLayout(0), entries: [
      solver.paramsBuffer, solver.materialsBuffer,
      side.vel, side.rho, solver.divBuffer, solver.sigmaB, acousticBuf, side.mat, solver.diagBuffer,
    ].map((b, i) => ({ binding: i, resource: { buffer: b } })),
  });

  // sourcesBG binds the acoustic buffer that is "current" this parity.
  const sourcesBG = (side, acousticBuf) => d.createBindGroup({
    layout: P.sources.getBindGroupLayout(0), entries: [
      solver.paramsBuffer, solver.materialsBuffer,
      side.vel, side.rho, side.temp, side.mat, solver.sourceBuffer, acousticBuf,
    ].map((b, i) => ({ binding: i, resource: { buffer: b } })),
  });

  // In-place passes act on the advection output side: parity 0 writes B,
  // parity 1 writes A. The acoustic triple buffer instead rotates mod 3 per
  // step — parity and rotation are independent, so sources/diagnostics keep a
  // per-rotation variant pointing at that step's "current" p′ buffer.
  const pp = [solver.pPrev, solver.pCurr, solver.pNext];
  solver._bg = [0, 1].map((p) => {
    const inp = p === 0 ? A : B;
    const out = p === 0 ? B : A;
    return {
      advect: advectBG(inp, out),
      stress: stressBG(out),
      momentum: momentumBG(out),
      continuity: continuityBG(out),
      phase: phaseBG(out),
      // rot r: prev = pp[r], curr = pp[(r+1)%3], next = pp[(r+2)%3]
      sources: [0, 1, 2].map((r) => sourcesBG(out, pp[(r + 1) % 3])),
      acoustic: [0, 1, 2].map((r) => acousticBG(pp[r], pp[(r + 1) % 3], pp[(r + 2) % 3], out)),
      diagnostics: [0, 1, 2].map((r) => diagnosticsBG(out, pp[(r + 2) % 3])),
    };
  });
  solver._acousticRotation = 0;
  solver._acousticCurrent = solver.pCurr;
}

const _nsParams = new ArrayBuffer(80);
const _nsU32 = new Uint32Array(_nsParams);
const _nsF32 = new Float32Array(_nsParams);
const _nsSources = new Float32Array(NS_MAX_SOURCES * 12);

/**
 * Advance the solver by dt seconds.
 * @param {Object[]} sources - up to 16 splats:
 *   { position:[x,y,z] cells, radius, velocity:[x,y,z], material, kind,
 *     rhoRate, temperature, strength }
 */
export function stepCompressibleNS(solver, device, dt, sources = []) {
  if (!solver || !solver._bg || !(dt > 0)) return;
  sources = sources.filter(s => [...(s.position || []), ...(s.velocity || []), s.radius ?? 1,
    s.rhoRate ?? 0, s.temperature ?? 0, s.strength ?? 1].every(Number.isFinite));

  _nsU32[0] = solver.gx; _nsU32[1] = solver.gy; _nsU32[2] = solver.gz; _nsU32[3] = solver.totalCells;
  _nsF32[4] = dt; _nsF32[5] = solver.cellSize; _nsF32[6] = 1 / solver.cellSize; _nsF32[7] = solver.timeSec;
  _nsF32[8] = solver.ambientRho; _nsF32[9] = solver.ambientTemp;
  _nsF32[10] = solver.gravityY; _nsF32[11] = solver.buoyancyAlpha;
  _nsF32[12] = solver.dissipation; _nsF32[13] = solver.maxSpeed; _nsF32[14] = solver.acousticCoupling;
  _nsU32[16] = Math.min(sources.length, NS_MAX_SOURCES);
  _nsU32[17] = solver.acousticEnabled ? 1 : 0;
  device.queue.writeBuffer(solver.paramsBuffer, 0, new Uint8Array(_nsParams));

  _nsSources.fill(0);
  for (let i = 0; i < Math.min(sources.length, NS_MAX_SOURCES); i++) {
    const s = sources[i];
    const o = i * 12;
    _nsSources[o + 0] = s.position?.[0] ?? 0; _nsSources[o + 1] = s.position?.[1] ?? 0;
    _nsSources[o + 2] = s.position?.[2] ?? 0; _nsSources[o + 3] = s.radius ?? 1;
    _nsSources[o + 4] = s.velocity?.[0] ?? 0; _nsSources[o + 5] = s.velocity?.[1] ?? 0;
    _nsSources[o + 6] = s.velocity?.[2] ?? 0; _nsSources[o + 7] = s.material ?? 0;
    _nsSources[o + 8] = s.rhoRate ?? 0; _nsSources[o + 9] = s.temperature ?? 0;
    _nsSources[o + 10] = s.strength ?? 1; _nsSources[o + 11] = s.kind ?? 0;
  }
  device.queue.writeBuffer(solver.sourceBuffer, 0, _nsSources);

  const p = solver._parity;
  const bg = solver._bg[p];
  const rot = solver._acousticRotation;
  const wgX = Math.ceil(solver.gx / 4), wgY = Math.ceil(solver.gy / 4), wgZ = Math.ceil(solver.gz / 4);

  const encoder = device.createCommandEncoder({ label: 'NS.step' });
  const run = (label, pipeline, bindGroup) => {
    const pass = encoder.beginComputePass({ label: `NS.${label}` });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(wgX, wgY, wgZ);
    pass.end();
  };

  run('advect', solver.pipelines.advect, bg.advect);
  run('sources', solver.pipelines.sources, bg.sources[rot]);
  run('stress', solver.pipelines.stress, bg.stress);
  run('momentum', solver.pipelines.momentum, bg.momentum);
  run('continuity', solver.pipelines.continuity, bg.continuity);
  const out = p === 0 ? 'B' : 'A';
  encoder.copyBufferToBuffer(solver.rhoNext, 0, solver[`rho${out}`], 0, solver.totalCells * 4);
  if (solver.acousticEnabled) run('acoustic', solver.pipelines.acoustic, bg.acoustic[rot]);
  run('phase', solver.pipelines.phase, bg.phase);
  encoder.copyBufferToBuffer(solver.tempNext, 0, solver[`temp${out}`], 0, solver.totalCells * 4);
  encoder.copyBufferToBuffer(solver.matNext, 0, solver[`mat${out}`], 0, solver.totalCells * 4);
  // Reset diagnostics slots then reduce.
  encoder.clearBuffer(solver.diagBuffer);
  run('diagnostics', solver.pipelines.diagnostics, bg.diagnostics[rot]);

  device.queue.submit([encoder.finish()]);

  solver._parity = 1 - p;
  solver.timeSec += dt;
  // Advance rotation; the buffer written this step becomes next step's "curr".
  solver._acousticCurrent = [solver.pPrev, solver.pCurr, solver.pNext][(rot + 2) % 3];
  solver._acousticRotation = (rot + 1) % 3;
}

/**
 * Current output-side buffers for rendering / external consumers.
 * @returns {{velocity: GPUBuffer, density: GPUBuffer, temperature: GPUBuffer,
 *   material: GPUBuffer, divergence: GPUBuffer, acoustic: GPUBuffer,
 *   sigmaB: GPUBuffer}}
 */
export function nsFieldBuffers(solver) {
  // Newest data lives on the side the next step reads: parity 0 reads A.
  const out = solver._parity === 0 ? 'A' : 'B';
  return {
    velocity: solver[`vel${out}`], density: solver[`rho${out}`],
    temperature: solver[`temp${out}`], material: solver[`mat${out}`],
    divergence: solver.divBuffer,
    acoustic: solver._acousticCurrent ?? solver.pCurr,
    sigmaB: solver.sigmaB,
  };
}

/**
 * Map and decode the diagnostics buffer. Slot order:
 *   0 maxSpeed, 1 max|∇·v|, 2 maxDensity, 3 max|ω|,
 *   4 nanCellCount, 5 max|p′|, 6 fluidCellCount
 * @returns {Promise<Object|null>} metrics + suggestedDt (null while a read is in flight)
 */
export async function readNSDiagnostics(solver, device) {
  if (solver._diagInFlight) return null;
  solver._diagInFlight = true;
  try {
    const enc = device.createCommandEncoder({ label: 'NS.diagCopy' });
    enc.copyBufferToBuffer(solver.diagBuffer, 0, solver.diagStaging, 0, 64);
    device.queue.submit([enc.finish()]);
    await solver.diagStaging.mapAsync(GPUMapMode.READ);
    const u32 = new Uint32Array(solver.diagStaging.getMappedRange().slice(0));
    solver.diagStaging.unmap();
    const f = (i) => new Float32Array(u32.buffer)[i];
    const maxSpeed = f(0), maxDiv = f(1), maxRho = f(2), maxCurl = f(3);
    const nanCells = u32[4], maxAcoustic = f(5), fluidCells = u32[6], maxGradient = f(7);
    const fluidMaterials = solver._materials.filter(m => (m.flags & NS_FLAG_FLUID) !== 0);
    const cMax = Math.max(...fluidMaterials.map(m => m.c || 0));
    // Viscous and thermal diffusion are clamped to their explicit limits in
    // the shaders, so only advection/acoustics (CFL) and strain rate bound dt.
    const cflDt = solver.cellSize * solver.cfl / Math.max(1e-4, maxSpeed + cMax);
    const gradientDt = 0.5 / Math.max(1e-4, maxGradient);
    return Object.freeze({
      maxSpeed, maxDivergence: maxDiv, maxDensity: maxRho, maxCurl, maxGradient,
      nanCells, maxAcoustic, fluidCells,
      suggestedDt: Math.min(cflDt, gradientDt),
      unstable: nanCells > 0 || !Number.isFinite(maxSpeed + maxRho + maxGradient),
    });
  } finally {
    solver._diagInFlight = false;
  }
}

export function destroyCompressibleNSSolver(solver) {
  if (!solver) return;
  for (const b of [
    solver.velA, solver.velB, solver.rhoA, solver.rhoB, solver.rhoNext,
    solver.tempA, solver.tempB, solver.tempNext,
    solver.matA, solver.matB, solver.matNext, solver.sigmaA, solver.sigmaB, solver.divBuffer,
    solver.pPrev, solver.pCurr, solver.pNext,
    solver.paramsBuffer, solver.materialsBuffer, solver.sourceBuffer,
    solver.diagBuffer, solver.diagStaging,
  ]) b?.destroy?.();
  solver._bg = null;
}
