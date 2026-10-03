// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import {
  createStorageBuffer,
  createUniformBuffer,
  updateBuffer,
  destroyBuffers,
} from "../../core/gpu/GpuBuffer.js";
import { labelResource, withErrorScope } from "../../core/gpu/GpuDebug.js";
import { normalizeFluidGridSize, DEFAULT_FLUID_GRID_SIZE } from "./FluidConfig.js";

function normalizeWorkgroupSize(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return fallback;
  }
  const i = n | 0;
  if (i <= 0) {
    return fallback;
  }
  return i;
}

const CELL_STRIDE_FLOATS = 4;
const CELL_STRIDE_BYTES = CELL_STRIDE_FLOATS * 4;
const DEFAULT_PRESSURE_ITERATIONS = 20;

// Reusable buffers for hot paths (reduce/reuse/recycle)
const _fluidParamsF32 = new Float32Array(12);
const _gridDataF32 = new Float32Array(4);

function createFluidComputeShader(workgroupSize) {
  const size = normalizeWorkgroupSize(workgroupSize, 256);
  return `
struct GridParams {
  dt : f32,
  gridSizeX : f32,
  gridSizeY : f32,
  gridSizeZ : f32,
  invGridSizeX : f32,
  invGridSizeY : f32,
  invGridSizeZ : f32,
  stage : f32,
  iteration : f32,
  totalIterations : f32,
  pad0 : f32,
  pad1 : f32,
};

@group(0) @binding(0) var<storage, read_write> uVelocity : array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> uVelocityScratch : array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> uDensity : array<f32>;
@group(0) @binding(3) var<storage, read_write> uDensityScratch : array<f32>;
@group(0) @binding(4) var<storage, read_write> uDivergence : array<f32>;
@group(0) @binding(5) var<storage, read_write> uPressure : array<f32>;
@group(0) @binding(6) var<storage, read_write> uPressureScratch : array<f32>;
@group(0) @binding(7) var<uniform> uParams : GridParams;

fn decodeIndex(idx : i32, gx : i32, gy : i32) -> vec3<i32> {
  let layerSize = gx * gy;
  let z = idx / layerSize;
  let rem = idx - z * layerSize;
  let y = rem / gx;
  let x = rem - y * gx;
  return vec3<i32>(x, y, z);
}

fn clampIndex(v : i32, maxExclusive : i32) -> i32 {
  return clamp(v, 0, maxExclusive - 1);
}

// Trilinear interpolation for smoother velocity sampling
fn sampleVelocityTrilinear(pos : vec3<f32>, gx : i32, gy : i32, gz : i32) -> vec3<f32> {
  let layerSize = gx * gy;
  
  // Clamp position to valid range
  let xf = clamp(pos.x, 0.5, f32(gx) - 1.5);
  let yf = clamp(pos.y, 0.5, f32(gy) - 1.5);
  let zf = clamp(pos.z, 0.5, f32(gz) - 1.5);
  
  // Integer cell coordinates
  let x0 = i32(floor(xf));
  let y0 = i32(floor(yf));
  let z0 = i32(floor(zf));
  let x1 = min(x0 + 1, gx - 1);
  let y1 = min(y0 + 1, gy - 1);
  let z1 = min(z0 + 1, gz - 1);
  
  // Fractional part for interpolation
  let fx = xf - f32(x0);
  let fy = yf - f32(y0);
  let fz = zf - f32(z0);
  
  // Sample 8 corners
  let z0Layer = z0 * layerSize;
  let z1Layer = z1 * layerSize;
  let y0Row = y0 * gx;
  let y1Row = y1 * gx;
  
  let v000 = uVelocity[u32(z0Layer + y0Row + x0)].xyz;
  let v100 = uVelocity[u32(z0Layer + y0Row + x1)].xyz;
  let v010 = uVelocity[u32(z0Layer + y1Row + x0)].xyz;
  let v110 = uVelocity[u32(z0Layer + y1Row + x1)].xyz;
  let v001 = uVelocity[u32(z1Layer + y0Row + x0)].xyz;
  let v101 = uVelocity[u32(z1Layer + y0Row + x1)].xyz;
  let v011 = uVelocity[u32(z1Layer + y1Row + x0)].xyz;
  let v111 = uVelocity[u32(z1Layer + y1Row + x1)].xyz;
  
  // Trilinear interpolation
  let v00 = mix(v000, v100, fx);
  let v10 = mix(v010, v110, fx);
  let v01 = mix(v001, v101, fx);
  let v11 = mix(v011, v111, fx);
  let v0 = mix(v00, v10, fy);
  let v1 = mix(v01, v11, fy);
  return mix(v0, v1, fz);
}

// Legacy nearest-neighbor sampling (kept for compatibility)
fn sampleVelocityNearest(pos : vec3<f32>, gx : i32, gy : i32, gz : i32) -> vec3<f32> {
  let layerSize = gx * gy;
  let xf = clamp(pos.x, 0.0, f32(gx - 1));
  let yf = clamp(pos.y, 0.0, f32(gy - 1));
  let zf = clamp(pos.z, 0.0, f32(gz - 1));
  let xi = clamp(i32(xf + 0.5), 0, gx - 1);
  let yi = clamp(i32(yf + 0.5), 0, gy - 1);
  let zi = clamp(i32(zf + 0.5), 0, gz - 1);
  let idx = zi * layerSize + yi * gx + xi;
  let uidx = u32(idx);
  let v4 = uVelocity[uidx];
  return v4.xyz;
}

// Trilinear interpolation for density (smoother advection)
fn sampleDensityTrilinear(pos : vec3<f32>, gx : i32, gy : i32, gz : i32) -> f32 {
  let layerSize = gx * gy;
  
  let xf = clamp(pos.x, 0.5, f32(gx) - 1.5);
  let yf = clamp(pos.y, 0.5, f32(gy) - 1.5);
  let zf = clamp(pos.z, 0.5, f32(gz) - 1.5);
  
  let x0 = i32(floor(xf));
  let y0 = i32(floor(yf));
  let z0 = i32(floor(zf));
  let x1 = min(x0 + 1, gx - 1);
  let y1 = min(y0 + 1, gy - 1);
  let z1 = min(z0 + 1, gz - 1);
  
  let fx = xf - f32(x0);
  let fy = yf - f32(y0);
  let fz = zf - f32(z0);
  
  let z0Layer = z0 * layerSize;
  let z1Layer = z1 * layerSize;
  let y0Row = y0 * gx;
  let y1Row = y1 * gx;
  
  let d000 = uDensity[u32(z0Layer + y0Row + x0)];
  let d100 = uDensity[u32(z0Layer + y0Row + x1)];
  let d010 = uDensity[u32(z0Layer + y1Row + x0)];
  let d110 = uDensity[u32(z0Layer + y1Row + x1)];
  let d001 = uDensity[u32(z1Layer + y0Row + x0)];
  let d101 = uDensity[u32(z1Layer + y0Row + x1)];
  let d011 = uDensity[u32(z1Layer + y1Row + x0)];
  let d111 = uDensity[u32(z1Layer + y1Row + x1)];
  
  let d00 = mix(d000, d100, fx);
  let d10 = mix(d010, d110, fx);
  let d01 = mix(d001, d101, fx);
  let d11 = mix(d011, d111, fx);
  let d0 = mix(d00, d10, fy);
  let d1 = mix(d01, d11, fy);
  return mix(d0, d1, fz);
}

fn sampleDensityNearest(pos : vec3<f32>, gx : i32, gy : i32, gz : i32) -> f32 {
  let layerSize = gx * gy;
  let xf = clamp(pos.x, 0.0, f32(gx - 1));
  let yf = clamp(pos.y, 0.0, f32(gy - 1));
  let zf = clamp(pos.z, 0.0, f32(gz - 1));
  let xi = clamp(i32(xf + 0.5), 0, gx - 1);
  let yi = clamp(i32(yf + 0.5), 0, gy - 1);
  let zi = clamp(i32(zf + 0.5), 0, gz - 1);
  let idx = zi * layerSize + yi * gx + xi;
  let uidx = u32(idx);
  return uDensity[uidx];
}

// ============================================================================
// NOISE FUNCTIONS FOR TURBULENCE INJECTION
// Inspired by Shadertoy pattern: add FBM noise to velocity for organic motion
// ============================================================================

// Fast hash for noise
fn hash31(p : vec3<f32>) -> f32 {
  var p3 = fract(p * 0.1031);
  p3 = p3 + dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// 3D value noise
fn noise3(p : vec3<f32>) -> f32 {
  let ip = floor(p);
  let fp = fract(p);
  // Smooth interpolation
  let u = fp * fp * (3.0 - 2.0 * fp);
  
  // Hash the 8 corners
  let n000 = hash31(ip + vec3<f32>(0.0, 0.0, 0.0));
  let n100 = hash31(ip + vec3<f32>(1.0, 0.0, 0.0));
  let n010 = hash31(ip + vec3<f32>(0.0, 1.0, 0.0));
  let n110 = hash31(ip + vec3<f32>(1.0, 1.0, 0.0));
  let n001 = hash31(ip + vec3<f32>(0.0, 0.0, 1.0));
  let n101 = hash31(ip + vec3<f32>(1.0, 0.0, 1.0));
  let n011 = hash31(ip + vec3<f32>(0.0, 1.0, 1.0));
  let n111 = hash31(ip + vec3<f32>(1.0, 1.0, 1.0));
  
  // Trilinear interpolation
  let n00 = mix(n000, n100, u.x);
  let n10 = mix(n010, n110, u.x);
  let n01 = mix(n001, n101, u.x);
  let n11 = mix(n011, n111, u.x);
  let n0 = mix(n00, n10, u.y);
  let n1 = mix(n01, n11, u.y);
  return mix(n0, n1, u.z);
}

// FBM (Fractal Brownian Motion) - multi-octave noise
fn fbm3(p : vec3<f32>, octaves : i32) -> f32 {
  var value = 0.0;
  var amplitude = 0.5;
  var pp = p;
  let shift = vec3<f32>(100.0, 100.0, 100.0);
  
  for (var i = 0; i < octaves; i = i + 1) {
    value = value + amplitude * noise3(pp);
    pp = pp * 2.0 + shift;
    amplitude = amplitude * 0.5;
  }
  return value;
}

// 3D FBM returning vec3 for velocity perturbation
fn fbm3Vec(p : vec3<f32>, octaves : i32) -> vec3<f32> {
  return vec3<f32>(
    fbm3(p, octaves),
    fbm3(p + vec3<f32>(43.12, 17.34, 91.27), octaves),
    fbm3(p + vec3<f32>(71.56, 23.89, 47.63), octaves)
  ) - 0.5;  // Center around 0
}

@compute @workgroup_size(${size})
fn main(@builtin(global_invocation_id) global_id : vec3<u32>) {
  let idxU = global_id.x;

  let gx = i32(uParams.gridSizeX + 0.5);
  let gy = i32(uParams.gridSizeY + 0.5);
  let gz = i32(uParams.gridSizeZ + 0.5);
  let cellCount = gx * gy * gz;

  if (i32(idxU) >= cellCount) {
    return;
  }

  let idx = i32(idxU);
  let coords = decodeIndex(idx, gx, gy);
  let x = coords.x;
  let y = coords.y;
  let z = coords.z;
  let layerSize = gx * gy;

  let zLayer = z * layerSize;
  let stageI = i32(uParams.stage + 0.5);

  switch (stageI) {
    case 0: { // Advect velocity + viscosity + compute spin (curl magnitude)
      let center = vec3<f32>(f32(x) + 0.5, f32(y) + 0.5, f32(z) + 0.5);
      let v4 = uVelocity[idxU];
      let vel = v4.xyz;
      let oldSpin = v4.w;
      
      // =========================================================
      // IMPROVED ADVECTION: "Sample where things were, not where they are"
      // Inspired by Shadertoy pattern: half-step backward twice
      // This is similar to MacCormack advection for better accuracy
      // =========================================================
      // First half-step: trace back using current velocity
      let halfDt = uParams.dt * 0.5;
      let midPos = center - vel * halfDt;
      let midVel = sampleVelocityTrilinear(midPos, gx, gy, gz);
      
      // Second half-step: trace back using velocity at midpoint
      let backPos = midPos - midVel * halfDt;
      let advected = sampleVelocityTrilinear(backPos, gx, gy, gz);
      
      // Get neighbors (reused for viscosity and curl calculation)
      let xm1 = clampIndex(x - 1, gx);
      let xp1 = clampIndex(x + 1, gx);
      let ym1 = clampIndex(y - 1, gy);
      let yp1 = clampIndex(y + 1, gy);
      let zm1 = clampIndex(z - 1, gz);
      let zp1 = clampIndex(z + 1, gz);
      
      let row = y * gx;
      let zLayerCur = z * layerSize;
      
      // Sample all 6 neighbors (vec4 for spin in .w)
      let n4L = uVelocity[u32(zLayerCur + row + xm1)];
      let n4R = uVelocity[u32(zLayerCur + row + xp1)];
      let n4D = uVelocity[u32(zLayerCur + ym1 * gx + x)];
      let n4U = uVelocity[u32(zLayerCur + yp1 * gx + x)];
      let n4B = uVelocity[u32(zm1 * layerSize + row + x)];
      let n4F = uVelocity[u32(zp1 * layerSize + row + x)];
      
      let vL = n4L.xyz; let vR = n4R.xyz;
      let vD = n4D.xyz; let vU = n4U.xyz;
      let vB = n4B.xyz; let vF = n4F.xyz;
      
      // =========================================================
      // VISCOSITY: Laplacian diffusion
      // =========================================================
      let viscosity = 0.15;
      let laplacian = (vL + vR + vD + vU + vB + vF) / 6.0 - vel;
      var viscVel = advected + laplacian * viscosity;
      
      // =========================================================
      // TURBULENCE INJECTION: FBM noise adds organic motion
      // Inspired by Shadertoy pattern: velocity += detailNoise * strength
      // =========================================================
      let TURBULENCE_SCALE = 0.08;      // How much to perturb velocity
      let TURBULENCE_FREQUENCY = 0.15;  // Spatial frequency of noise
      let TIME_SCALE = 0.3;             // How fast noise evolves
      
      // Create animated noise position
      let noisePos = center * TURBULENCE_FREQUENCY + vec3<f32>(
        uParams.dt * TIME_SCALE * 100.0,  // Animate over time
        uParams.dt * TIME_SCALE * 73.0,
        uParams.dt * TIME_SCALE * 127.0
      );
      
      // Get 3D noise perturbation (already centered around 0)
      let turbulence = fbm3Vec(noisePos, 3) * TURBULENCE_SCALE;
      viscVel = viscVel + turbulence;
      
      // =========================================================
      // SPIN (CURL) CALCULATION - 3D curl = nabla × velocity
      // curl.x = dVz/dy - dVy/dz
      // curl.y = dVx/dz - dVz/dx  
      // curl.z = dVy/dx - dVx/dy
      // =========================================================
      let curlX = 0.5 * ((vU.z - vD.z) - (vF.y - vB.y));
      let curlY = 0.5 * ((vF.x - vB.x) - (vR.z - vL.z));
      let curlZ = 0.5 * ((vR.y - vL.y) - (vU.x - vD.x));
      let curl = vec3<f32>(curlX, curlY, curlZ);
      let curlMagnitude = length(curl);
      
      // =========================================================
      // SPIN EXCHANGE: neighbors trade spin (like heat diffusion)
      // Inspired by Shadertoy pattern: mix(mu.w, C.w, SPIN_PERMITIVITY)
      // =========================================================
      let SPIN_PERMITIVITY = 0.1;
      let neighborSpinAvg = (n4L.w + n4R.w + n4D.w + n4U.w + n4B.w + n4F.w) / 6.0;
      
      // New spin = blend of neighbor average and current, plus curl injection
      let newSpin = mix(neighborSpinAvg, oldSpin, SPIN_PERMITIVITY)
                  + SPIN_PERMITIVITY * (curlMagnitude - oldSpin);
      
      // Light damping
      let rawStep = uParams.dt * 0.05;
      let damping = 1.0 - clamp(rawStep, 0.0, 0.5);
      let newVel = viscVel * damping;
      
      // Store velocity with spin in .w
      uVelocityScratch[idxU] = vec4<f32>(newVel, newSpin);
    }
    case 1: { // Compute divergence + warm-start pressure (Tompson et al. §3)
      let xm1 = clampIndex(x - 1, gx);
      let xp1 = clampIndex(x + 1, gx);
      let ym1 = clampIndex(y - 1, gy);
      let yp1 = clampIndex(y + 1, gy);
      let zm1 = clampIndex(z - 1, gz);
      let zp1 = clampIndex(z + 1, gz);

      let row = y * gx;
      let rowDown = ym1 * gx;
      let rowUp = yp1 * gx;
      let zLayerBack = zm1 * layerSize;
      let zLayerFront = zp1 * layerSize;

      let idxL = zLayer + row + xm1;
      let idxR = zLayer + row + xp1;
      let idxD = zLayer + rowDown + x;
      let idxU_ = zLayer + rowUp + x;
      let idxB = zLayerBack + row + x;
      let idxF = zLayerFront + row + x;

      let vL = uVelocity[u32(idxL)].xyz;
      let vR = uVelocity[u32(idxR)].xyz;
      let vD = uVelocity[u32(idxD)].xyz;
      let vU = uVelocity[u32(idxU_)].xyz;
      let vB = uVelocity[u32(idxB)].xyz;
      let vF = uVelocity[u32(idxF)].xyz;

      let div = 0.5 * ((vR.x - vL.x) + (vU.y - vD.y) + (vF.z - vB.z));

      uDivergence[idxU] = div;
      // Warm-start: keep previous frame pressure as initial Jacobi guess (damped).
      // Tompson et al. key insight: pressure changes slowly between frames,
      // so the previous solution is a far better starting point than zero.
      let prevP = uPressure[idxU] * 0.9;
      uPressure[idxU] = prevP;
      uPressureScratch[idxU] = prevP;
    }
    case 2: { // Jacobi pressure solve with SOR (Successive Over-Relaxation)
      // =========================================================
      // SOR improves convergence speed significantly
      // Inspired by Shadertoy's weighted multi-iteration stencil
      // omega > 1 = over-relaxation (faster but can oscillate)
      // omega = 1 = standard Jacobi
      // omega < 1 = under-relaxation (slower but more stable)
      // =========================================================
      let SOR_OMEGA = 1.2;  // Over-relaxation factor (1.0-1.9 typical)
      
      let xm1 = clampIndex(x - 1, gx);
      let xp1 = clampIndex(x + 1, gx);
      let ym1 = clampIndex(y - 1, gy);
      let yp1 = clampIndex(y + 1, gy);
      let zm1 = clampIndex(z - 1, gz);
      let zp1 = clampIndex(z + 1, gz);

      let row = y * gx;
      let rowDown = ym1 * gx;
      let rowUp = yp1 * gx;
      let zLayerBack = zm1 * layerSize;
      let zLayerFront = zp1 * layerSize;

      let idxL = zLayer + row + xm1;
      let idxR = zLayer + row + xp1;
      let idxD = zLayer + rowDown + x;
      let idxU_ = zLayer + rowUp + x;
      let idxB = zLayerBack + row + x;
      let idxF = zLayerFront + row + x;

      // Sample pressure from neighbors
      let pL = uPressure[u32(idxL)];
      let pR = uPressure[u32(idxR)];
      let pD = uPressure[u32(idxD)];
      let pU = uPressure[u32(idxU_)];
      let pB = uPressure[u32(idxB)];
      let pF = uPressure[u32(idxF)];
      let pC = uPressure[idxU];  // Current pressure
      let div = uDivergence[idxU];

      // Standard Jacobi update
      let pJacobi = (pL + pR + pD + pU + pB + pF - div) / 6.0;
      
      // SOR: blend between old value and Jacobi update with over-relaxation
      let pNew = pC + SOR_OMEGA * (pJacobi - pC);
      
      uPressureScratch[idxU] = pNew;
    }
    case 3: { // Project velocity + buoyancy + standard vorticity confinement (Steinhoff & Underhill 1994)
      let xm1 = clampIndex(x - 1, gx);
      let xp1 = clampIndex(x + 1, gx);
      let ym1 = clampIndex(y - 1, gy);
      let yp1 = clampIndex(y + 1, gy);
      let zm1 = clampIndex(z - 1, gz);
      let zp1 = clampIndex(z + 1, gz);

      let row = y * gx;
      let rowDown = ym1 * gx;
      let rowUp = yp1 * gx;
      let zLayerBack = zm1 * layerSize;
      let zLayerFront = zp1 * layerSize;

      let idxL = zLayer + row + xm1;
      let idxR = zLayer + row + xp1;
      let idxD = zLayer + rowDown + x;
      let idxU_ = zLayer + rowUp + x;
      let idxB = zLayerBack + row + x;
      let idxF = zLayerFront + row + x;

      // Read pressure for projection
      let pL = uPressure[u32(idxL)];
      let pR = uPressure[u32(idxR)];
      let pD = uPressure[u32(idxD)];
      let pU = uPressure[u32(idxU_)];
      let pB = uPressure[u32(idxB)];
      let pF = uPressure[u32(idxF)];
      
      // Read velocity neighbors (includes spin in .w)
      let v4L = uVelocity[u32(idxL)];
      let v4R = uVelocity[u32(idxR)];
      let v4D = uVelocity[u32(idxD)];
      let v4U = uVelocity[u32(idxU_)];
      let v4B = uVelocity[u32(idxB)];
      let v4F = uVelocity[u32(idxF)];

      var v4 = uVelocity[idxU];
      var v = v4.xyz;
      let spin = v4.w;

      // =========================================================
      // PRESSURE PROJECTION: subtract pressure gradient
      // =========================================================
      let gradX = 0.5 * (pR - pL);
      let gradY = 0.5 * (pU - pD);
      let gradZ = 0.5 * (pF - pB);
      v = v - vec3<f32>(gradX, gradY, gradZ);

      // =========================================================
      // BUOYANCY FORCE (Tompson et al. §3, fbody)
      // Hot/dense fluid rises. Density field drives upward velocity.
      // Strength tuned for editor grid scale (grid cell ≈ world unit).
      // =========================================================
      let BUOYANCY_STRENGTH = 3.0;
      let density = uDensity[idxU];
      v.y += density * BUOYANCY_STRENGTH * uParams.dt;

      // =========================================================
      // VORTICITY CONFINEMENT: standard Steinhoff & Underhill (1994)
      // fvc = λ (N × ω)  where N = ∇|ω| / |∇|ω||, ω = curl(u)
      // Tompson et al. §3 uses this exact formulation.
      // Replaces the previous spin-exchange approximation.
      // =========================================================
      let VORTICITY_STRENGTH = 0.18;

      // Compute curl ω = ∇ × u at each neighbor to get |ω| for gradient
      let vL = v4L.xyz; let vR = v4R.xyz;
      let vD = v4D.xyz; let vU = v4U.xyz;
      let vB = v4B.xyz; let vF = v4F.xyz;

      // Curl at center cell
      let curlX = 0.5 * ((vU.z - vD.z) - (vF.y - vB.y));
      let curlY = 0.5 * ((vF.x - vB.x) - (vR.z - vL.z));
      let curlZ = 0.5 * ((vR.y - vL.y) - (vU.x - vD.x));
      let omega = vec3<f32>(curlX, curlY, curlZ);
      let omegaLen = length(omega);

      // |ω| at face-neighbors (approximate via spin stored in .w from stage 0)
      // spin.w = curl magnitude computed in stage 0 — reuse it here
      let omegaL = v4L.w; let omegaR = v4R.w;
      let omegaD = v4D.w; let omegaU = v4U.w;
      let omegaB = v4B.w; let omegaF = v4F.w;

      // N = ∇|ω| / |∇|ω||  (normalized gradient of vorticity magnitude)
      let gradOmegaX = 0.5 * (omegaR - omegaL);
      let gradOmegaY = 0.5 * (omegaU - omegaD);
      let gradOmegaZ = 0.5 * (omegaF - omegaB);
      let gradOmega = vec3<f32>(gradOmegaX, gradOmegaY, gradOmegaZ);
      let gradOmegaLen = length(gradOmega);
      let N = select(gradOmega / gradOmegaLen, vec3<f32>(0.0), gradOmegaLen < 0.0001);

      // fvc = λ (N × ω)  — force perpendicular to both gradient and vorticity
      let vorticityForce = cross(N, omega) * VORTICITY_STRENGTH;
      v = v + vorticityForce * uParams.dt;

      // Light damping
      let rawStep = uParams.dt * 0.05;
      let damping = 1.0 - clamp(rawStep, 0.0, 0.5);
      v = v * damping;

      // Smooth boundary forces - push fluid away from walls
      // This creates more natural behavior than hard zero at boundaries
      let maxX = gx - 1;
      let maxY = gy - 1;
      let maxZ = gz - 1;
      
      // Distance to each boundary (normalized 0-1)
      let boundaryWidth = 3.0;  // How many cells the boundary force affects
      let dxMin = f32(x) / boundaryWidth;
      let dxMax = f32(maxX - x) / boundaryWidth;
      let dyMin = f32(y) / boundaryWidth;
      let dyMax = f32(maxY - y) / boundaryWidth;
      let dzMin = f32(z) / boundaryWidth;
      let dzMax = f32(maxZ - z) / boundaryWidth;
      
      // Smooth repulsion force from walls (exponential falloff)
      let boundaryForce = 2.0;
      var boundaryPush = vec3<f32>(0.0);
      if (dxMin < 1.0) { boundaryPush.x += boundaryForce * exp(-3.0 * dxMin); }
      if (dxMax < 1.0) { boundaryPush.x -= boundaryForce * exp(-3.0 * dxMax); }
      if (dyMin < 1.0) { boundaryPush.y += boundaryForce * exp(-3.0 * dyMin); }
      if (dyMax < 1.0) { boundaryPush.y -= boundaryForce * exp(-3.0 * dyMax); }
      if (dzMin < 1.0) { boundaryPush.z += boundaryForce * exp(-3.0 * dzMin); }
      if (dzMax < 1.0) { boundaryPush.z -= boundaryForce * exp(-3.0 * dzMax); }
      
      v = v + boundaryPush * uParams.dt;
      
      // Hard boundary: zero velocity at actual boundary cells
      if (x == 0 || y == 0 || z == 0 || x == maxX || y == maxY || z == maxZ) {
        v = vec3<f32>(0.0, 0.0, 0.0);
      }

      let maxSpeed = 50.0;
      let speed = length(v);
      if (speed > maxSpeed) {
        v = v * (maxSpeed / speed);
      }

      v4 = vec4<f32>(v, v4.w);
      uVelocityScratch[idxU] = v4;
    }
    case 4: { // Advect density with two-step backward tracing
      let center = vec3<f32>(f32(x) + 0.5, f32(y) + 0.5, f32(z) + 0.5);
      let v4 = uVelocity[idxU];
      let vel = v4.xyz;
      
      // Two-step backward advection (matches velocity advection)
      let halfDt = uParams.dt * 0.5;
      let midPos = center - vel * halfDt;
      let midVel = sampleVelocityTrilinear(midPos, gx, gy, gz);
      let backPos = midPos - midVel * halfDt;
      
      // Trilinear interpolation for smoother density transport
      let d = sampleDensityTrilinear(backPos, gx, gy, gz);
      
      // Very slow decay - density persists for a long time  
      let rawStep = uParams.dt * 0.002;
      let damping = 1.0 - clamp(rawStep, 0.0, 0.01);
      uDensityScratch[idxU] = d * damping;
    }
    default: {
    }
  }
}
`;
}

export async function createFluidSimWorld(gpuDevice, options = {}) {
  if (!gpuDevice || typeof gpuDevice.getDevice !== "function") {
    throw new Error("createFluidSimWorld: gpuDevice (GpuDevice) is required");
  }

  const device = gpuDevice.getDevice();
  if (!device) {
    throw new Error("createFluidSimWorld: gpuDevice.getDevice() returned null");
  }

  const gridSize = normalizeFluidGridSize(options.gridSize || DEFAULT_FLUID_GRID_SIZE);
  const gridSizeX = gridSize[0];
  const gridSizeY = gridSize[1];
  const gridSizeZ = gridSize[2];

  const cellCount = gridSizeX * gridSizeY * gridSizeZ;
  if (!Number.isFinite(cellCount) || cellCount <= 0) {
    throw new Error("createFluidSimWorld: invalid grid size");
  }

  const workgroupSize = normalizeWorkgroupSize(options.workgroupSize, 256);
  const velocityByteSize = cellCount * CELL_STRIDE_BYTES;
  const scalarByteSize = cellCount * 4;

  console.log("[FluidSimWorld] Creating buffers...", { cellCount, velocityByteSize, scalarByteSize });

  const candidate = { gpuDevice, device };
  let committed = false;
  try {
  const velocityBuffer = candidate.velocityBuffer = createStorageBuffer(device, velocityByteSize, {
    label: "FluidSimWorld.velocity",
  });
  const velocityScratchBuffer = candidate.velocityScratchBuffer = createStorageBuffer(device, velocityByteSize, {
    label: "FluidSimWorld.velocityScratch",
  });
  const densityBuffer = candidate.densityBuffer = createStorageBuffer(device, scalarByteSize, {
    label: "FluidSimWorld.density",
  });
  const densityScratchBuffer = candidate.densityScratchBuffer = createStorageBuffer(device, scalarByteSize, {
    label: "FluidSimWorld.densityScratch",
  });
  // Color buffer - stores particle color per cell (vec4: rgb + unused)
  const colorByteSize = cellCount * 16; // vec4<f32> per cell
  const colorBuffer = candidate.colorBuffer = createStorageBuffer(device, colorByteSize, {
    label: "FluidSimWorld.color",
  });
  const divergenceBuffer = candidate.divergenceBuffer = createStorageBuffer(device, scalarByteSize, {
    label: "FluidSimWorld.divergence",
  });
  const pressureBuffer = candidate.pressureBuffer = createStorageBuffer(device, scalarByteSize, {
    label: "FluidSimWorld.pressure",
  });
  const pressureScratchBuffer = candidate.pressureScratchBuffer = createStorageBuffer(device, scalarByteSize, {
    label: "FluidSimWorld.pressureScratch",
  });
  const paramsBuffer = candidate.paramsBuffer = createUniformBuffer(device, 48, {
    label: "FluidSimWorld.params",
  });

  labelResource(velocityBuffer, "FluidSimWorld.velocity");
  labelResource(velocityScratchBuffer, "FluidSimWorld.velocityScratch");
  labelResource(densityBuffer, "FluidSimWorld.density");
  labelResource(densityScratchBuffer, "FluidSimWorld.densityScratch");
  labelResource(colorBuffer, "FluidSimWorld.color");
  labelResource(divergenceBuffer, "FluidSimWorld.divergence");
  labelResource(pressureBuffer, "FluidSimWorld.pressure");
  labelResource(pressureScratchBuffer, "FluidSimWorld.pressureScratch");
  labelResource(paramsBuffer, "FluidSimWorld.params");

  console.log("[FluidSimWorld] Buffers created, creating shader...");
  const shaderCode = createFluidComputeShader(workgroupSize);

  console.log("[FluidSimWorld] Creating shader module...");
  const shaderModule = device.createShaderModule({
    label: "FluidSimWorld.computeShader",
    code: shaderCode,
  });

  console.log("[FluidSimWorld] Shader module created, creating pipeline...");
  // Use async pipeline creation to avoid blocking the main thread during shader compilation
  const pipeline = await device.createComputePipelineAsync({
    label: "FluidSimWorld.pipeline",
    layout: "auto",
    compute: {
      module: shaderModule,
      entryPoint: "main",
    },
  });

  console.log("[FluidSimWorld] Pipeline created, creating bind group...");
  const bindGroupLayout = pipeline.getBindGroupLayout(0);
  const bindGroup = device.createBindGroup({
    label: "FluidSimWorld.bindGroup",
    layout: bindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: velocityBuffer } },
      { binding: 1, resource: { buffer: velocityScratchBuffer } },
      { binding: 2, resource: { buffer: densityBuffer } },
      { binding: 3, resource: { buffer: densityScratchBuffer } },
      { binding: 4, resource: { buffer: divergenceBuffer } },
      { binding: 5, resource: { buffer: pressureBuffer } },
      { binding: 6, resource: { buffer: pressureScratchBuffer } },
      { binding: 7, resource: { buffer: paramsBuffer } },
    ],
  });

  console.log("[FluidSimWorld] Bind group created, returning world object...");
  const world = Object.assign(candidate, {
    gpuDevice,
    device,
    gridSizeX,
    gridSizeY,
    gridSizeZ,
    cellCount,
    workgroupSize,
    pipeline,
    bindGroup,
    velocityBuffer,
    velocityScratchBuffer,
    densityBuffer,
    densityScratchBuffer,
    colorBuffer,      // Particle color per grid cell
    colorByteSize,
    divergenceBuffer,
    pressureBuffer,
    pressureScratchBuffer,
    paramsBuffer,
    velocityByteSize,
    scalarByteSize,
    pressureIterations:
      typeof options.pressureIterations === "number" &&
      options.pressureIterations > 0
        ? options.pressureIterations | 0
        : DEFAULT_PRESSURE_ITERATIONS,
  });

  committed = true;
  return world;
  } finally {
    if (!committed) {
      destroyFluidSimWorld(candidate);
    }
  }
}

export function destroyFluidSimWorld(world) {
  if (!world) {
    return;
  }
  destroyBuffers([
    world.velocityBuffer,
    world.velocityScratchBuffer,
    world.densityBuffer,
    world.densityScratchBuffer,
    world.colorBuffer,
    world.divergenceBuffer,
    world.pressureBuffer,
    world.pressureScratchBuffer,
    world.paramsBuffer,
  ]);
  world.velocityBuffer = null;
  world.velocityScratchBuffer = null;
  world.densityBuffer = null;
  world.densityScratchBuffer = null;
  world.colorBuffer = null;
  world.divergenceBuffer = null;
  world.pressureBuffer = null;
  world.pressureScratchBuffer = null;
  world.paramsBuffer = null;
}

/**
 * Clear/reset the density and velocity buffers to zero.
 * Use this when bounds change significantly to prevent stale data from appearing
 * at wrong world-space locations.
 */
export function clearFluidSimWorld(world) {
  if (!world || !world.device) {
    return;
  }
  const device = world.device;
  const encoder = device.createCommandEncoder({ label: "FluidSimWorld.clear" });
  
  // Clear density buffers
  if (world.densityBuffer && world.scalarByteSize > 0) {
    encoder.clearBuffer(world.densityBuffer, 0, world.scalarByteSize);
  }
  if (world.densityScratchBuffer && world.scalarByteSize > 0) {
    encoder.clearBuffer(world.densityScratchBuffer, 0, world.scalarByteSize);
  }
  
  // Clear velocity buffers
  if (world.velocityBuffer && world.velocityByteSize > 0) {
    encoder.clearBuffer(world.velocityBuffer, 0, world.velocityByteSize);
  }
  if (world.velocityScratchBuffer && world.velocityByteSize > 0) {
    encoder.clearBuffer(world.velocityScratchBuffer, 0, world.velocityByteSize);
  }
  
  // Clear pressure/divergence
  if (world.pressureBuffer && world.scalarByteSize > 0) {
    encoder.clearBuffer(world.pressureBuffer, 0, world.scalarByteSize);
  }
  if (world.pressureScratchBuffer && world.scalarByteSize > 0) {
    encoder.clearBuffer(world.pressureScratchBuffer, 0, world.scalarByteSize);
  }
  if (world.divergenceBuffer && world.scalarByteSize > 0) {
    encoder.clearBuffer(world.divergenceBuffer, 0, world.scalarByteSize);
  }
  
  device.queue.submit([encoder.finish()]);
}

export function stepFluidSimWorld(world, deltaSeconds, options = {}) {
  if (!world || !world.device || !world.pipeline || !world.bindGroup) {
    return;
  }

  const device = world.device;
  let dt = Number(deltaSeconds);
  if (!Number.isFinite(dt) || dt <= 0) {
    return;
  }

  const maxDt = 1 / 30;
  if (dt > maxDt) {
    dt = maxDt;
  }

  const cellCount = world.cellCount | 0;
  if (cellCount <= 0) {
    return;
  }
  const iterationsRaw = world.pressureIterations | 0;
  const iterations = iterationsRaw > 0 ? iterationsRaw : DEFAULT_PRESSURE_ITERATIONS;

  const workgroupSize = world.workgroupSize | 0;
  const groups = Math.ceil(cellCount / workgroupSize);

  const paramsData = _fluidParamsF32; // Reuse module-level buffer

  function dispatchStage(stage, iteration, totalIterations, encoder) {
    paramsData[0] = dt;
    paramsData[1] = world.gridSizeX;
    paramsData[2] = world.gridSizeY;
    paramsData[3] = world.gridSizeZ;
    paramsData[4] = world.gridSizeX > 0 ? 1 / world.gridSizeX : 0;
    paramsData[5] = world.gridSizeY > 0 ? 1 / world.gridSizeY : 0;
    paramsData[6] = world.gridSizeZ > 0 ? 1 / world.gridSizeZ : 0;
    paramsData[7] = stage;
    paramsData[8] = iteration;
    paramsData[9] = totalIterations;
    paramsData[10] = 0;
    paramsData[11] = 0;

    updateBuffer(device, world.paramsBuffer, paramsData, 0);

    const pass = encoder.beginComputePass({
      label: "FluidSimWorld.step.stage" + stage,
    });

    pass.setPipeline(world.pipeline);
    pass.setBindGroup(0, world.bindGroup);
    pass.dispatchWorkgroups(groups);
    pass.end();
  }

  // FIX: Use a SINGLE command encoder for all stages
  // WebGPU automatically inserts barriers between dispatches in the same encoder
  // This prevents race conditions between stages and with external operations (like splat)
  const externalEncoder = options && options.encoder ? options.encoder : null;
  const encoder = externalEncoder || device.createCommandEncoder({ label: "FluidSimWorld.step" });

  // Stage 0: Advect velocity
  dispatchStage(0, 0, iterations, encoder);
  encoder.copyBufferToBuffer(world.velocityScratchBuffer, 0, world.velocityBuffer, 0, world.velocityByteSize);

  // Stage 1: Compute divergence
  dispatchStage(1, 0, iterations, encoder);

  // Stage 2: Pressure solve iterations
  for (let i = 0; i < iterations; i++) {
    dispatchStage(2, i, iterations, encoder);
    encoder.copyBufferToBuffer(world.pressureScratchBuffer, 0, world.pressureBuffer, 0, world.scalarByteSize);
  }

  // Stage 3: Project velocity
  dispatchStage(3, 0, iterations, encoder);
  encoder.copyBufferToBuffer(world.velocityScratchBuffer, 0, world.velocityBuffer, 0, world.velocityByteSize);

  // Stage 4: Advect density
  dispatchStage(4, 0, iterations, encoder);
  encoder.copyBufferToBuffer(world.densityScratchBuffer, 0, world.densityBuffer, 0, world.scalarByteSize);

  // Submit all work in a single command buffer
  if (!externalEncoder) {
    device.queue.submit([encoder.finish()]);
  }
}

/**
 * Clear the density and color buffers to zero.
 * Used in particle-as-smoke mode to reset before splatting particle positions/colors.
 * @param {Object} world - Fluid sim world
 */
export function clearFluidDensity(world, options = {}) {
  if (!world || !world.device || !world.densityBuffer) {
    return;
  }
  const device = world.device;
  const externalEncoder = options && options.encoder ? options.encoder : null;
  const encoder = externalEncoder || device.createCommandEncoder({ label: "FluidSimWorld.clearDensity" });
  encoder.clearBuffer(world.densityBuffer);
  if (world.colorBuffer) {
    encoder.clearBuffer(world.colorBuffer);
  }
  if (!externalEncoder) {
    device.queue.submit([encoder.finish()]);
  }
}

/**
 * Initialize fluid sim world lazily with bind group creation for smoke rendering.
 * This is a convenience function that handles the full setup sequence.
 * @param {Object} options - Initialization options
 * @param {Object} options.gpuDevice - GPU device wrapper
 * @param {Object} options.smoke - Smoke state object to populate
 * @param {Object} options.particles - Particle state (for attaching fluid)
 * @param {Array} options.gridSize - Grid dimensions [x, y, z] (default: [128, 96, 128])
 * @param {number} options.workgroupSize - Compute workgroup size (default: 64)
 * @param {number} options.pressureIterations - Pressure solve iterations (default: 8)
 * @param {Function} options.attachFluidWorld - Function to attach fluid to particles
 * @param {Function} options.logger - Optional logger
 * @returns {Promise<Object>} Created fluid world
 */
export async function initFluidSimWorldLazy(options) {
  const {
    gpuDevice,
    smoke,
    particles,
    gridSize = [128, 96, 128],
    workgroupSize = 64,
    pressureIterations = 8,
    attachFluidWorld,
    logger,
  } = options;

  if (smoke.fluidWorld) return smoke.fluidWorld; // Already initialized
  if (smoke.initializing) return null; // Already initializing
  if (!gpuDevice || typeof gpuDevice.getDevice !== "function") return null;

  smoke.initializing = true;

  try {
    if (logger) logger.info("[SMOKE] Starting fluid sim world creation...");
    
    smoke.fluidWorld = await createFluidSimWorld(gpuDevice, {
      gridSize,
      workgroupSize,
      pressureIterations,
    });
    
    if (logger) logger.info("[SMOKE] Fluid sim world created, waiting for GPU...");

    // Wait for GPU to finish any pending work
    const device = gpuDevice.getDevice();
    await device.queue.onSubmittedWorkDone();
    
    // Create data bind group for smoke rendering (density + color + grid)
    if (smoke.pipeline && smoke.fluidWorld?.densityBuffer && 
        smoke.fluidWorld?.colorBuffer && smoke.gridBuffer) {
      smoke.dataBindGroup = device.createBindGroup({
        label: "VolumeSmoke.dataBindGroup",
        layout: smoke.pipeline.getBindGroupLayout(1),
        entries: [
          { binding: 0, resource: { buffer: smoke.fluidWorld.densityBuffer } },
          { binding: 1, resource: { buffer: smoke.fluidWorld.colorBuffer } },  // Particle colors
          { binding: 2, resource: { buffer: smoke.gridBuffer } },
        ],
      });

      // Update grid buffer with actual grid size - reuse buffer
      _gridDataF32[0] = smoke.fluidWorld.gridSizeX;
      _gridDataF32[1] = smoke.fluidWorld.gridSizeY;
      _gridDataF32[2] = smoke.fluidWorld.gridSizeZ;
      _gridDataF32[3] = 0;
      updateBuffer(device, smoke.gridBuffer, _gridDataF32, 0);
    }

    // Attach fluid world to particle sim
    if (particles?.world && smoke.fluidWorld && attachFluidWorld) {
      attachFluidWorld(particles.world, smoke.fluidWorld, smoke.worldMin, smoke.worldMax);
      if (logger) logger.info("[SMOKE] Attached fluid velocity to particle simulation");
    }

    // Reset delay timer
    smoke.simStartTime = performance.now();
    
    if (logger) {
      logger.info("[SMOKE] Fluid sim world initialized lazily", {
        gridSizeX: smoke.fluidWorld.gridSizeX,
        gridSizeY: smoke.fluidWorld.gridSizeY,
        gridSizeZ: smoke.fluidWorld.gridSizeZ,
      });
    }
    
    smoke.initializing = false;
    return smoke.fluidWorld;
  } catch (err) {
    if (logger) logger.error("[SMOKE] Lazy fluid sim init failed", { error: err.message });
    smoke.initializing = false;
    return null;
  }
}
