// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Grid Splat Compute Shader
 * Splats particles/vertices to a 3D density grid for volumetric rendering
 * 
 * Input: Particle positions, colors, velocities
 * Output: Density grid + Color grid (for raymarching)
 */

export const gridSplatComputeWGSL = /* wgsl */`
struct SplatParams {
  volumeMin: vec3<f32>,
  gridResolution: f32,
  volumeMax: vec3<f32>,
  particleCount: u32,
  cellSize: vec3<f32>,
  splatRadius: f32,
  time: f32,
  densityScale: f32,
  colorBlend: f32,
  _pad: f32,
};

struct Particle {
  position: vec3<f32>,
  _pad0: f32,
};

struct ParticleMeta {
  color: vec3<f32>,
  size: f32,
};

@group(0) @binding(0) var<uniform> params: SplatParams;
@group(0) @binding(1) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> particleMeta: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> velocities: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read_write> densityGrid: array<atomic<u32>>;
@group(0) @binding(5) var<storage, read_write> colorGridR: array<atomic<u32>>;
@group(0) @binding(6) var<storage, read_write> colorGridG: array<atomic<u32>>;
@group(0) @binding(7) var<storage, read_write> colorGridB: array<atomic<u32>>;
@group(0) @binding(8) var<storage, read_write> colorGridW: array<atomic<u32>>;

fn worldToGrid(worldPos: vec3<f32>) -> vec3<f32> {
  let normalized = (worldPos - params.volumeMin) / (params.volumeMax - params.volumeMin);
  return normalized * params.gridResolution;
}

fn gridToIndex(cell: vec3<i32>) -> u32 {
  let res = i32(params.gridResolution);
  let c = clamp(cell, vec3<i32>(0), vec3<i32>(res - 1));
  return u32(c.x + c.y * res + c.z * res * res);
}

fn isValidCell(cell: vec3<i32>) -> bool {
  let res = i32(params.gridResolution);
  return all(cell >= vec3<i32>(0)) && all(cell < vec3<i32>(res));
}

// Smooth kernel for splatting (cubic spline)
fn splatKernel(dist: f32, radius: f32) -> f32 {
  let q = dist / radius;
  if (q >= 1.0) { return 0.0; }
  if (q <= 0.5) {
    return 1.0 - 6.0 * q * q + 6.0 * q * q * q;
  }
  let t = 1.0 - q;
  return 2.0 * t * t * t;
}

// Trilinear weight for smoother splatting
fn trilinearWeight(offset: vec3<f32>) -> f32 {
  let w = max(vec3<f32>(0.0), vec3<f32>(1.0) - abs(offset));
  return w.x * w.y * w.z;
}

// Extract color from packed meta
fn unpackColor(metaVal: vec4<f32>) -> vec3<f32> {
  // Color is stored in xyz, size info in w
  let packed = metaVal.xyz;
  // If using packed format, unpack; otherwise use directly
  if (packed.x > 1.0 || packed.y > 1.0 || packed.z > 1.0) {
    // Packed as integers, normalize
    return packed / 255.0;
  }
  return packed;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let particleIdx = gid.x;
  if (particleIdx >= params.particleCount) {
    return;
  }
  
  // Get particle data
  let pos = positions[particleIdx].xyz;
  let metaVal = particleMeta[particleIdx];
  let vel = velocities[particleIdx].xyz;
  
  // Extract color (stored in meta.xyz)
  var color = unpackColor(metaVal);
  
  // If color is black/zero, use velocity-based coloring
  if (dot(color, color) < 0.01) {
    let speed = length(vel);
    // Cool colors for slow, warm for fast
    color = mix(vec3<f32>(0.4, 0.6, 0.9), vec3<f32>(1.0, 0.5, 0.2), clamp(speed * 0.1, 0.0, 1.0));
  }
  
  // Extract particle size from packed meta.w
  // Pack format: mass * 1e8 + drag * 1e6 + size * 1e4 + renderMode * 1e3 + shape * 10 + behavior
  let packedValue = metaVal.w;
  let particleSize = max((floor(packedValue / 1e4) % 100.0) * 0.1, 0.1); // Size 0-99 decoded to 0.0-9.9, min 0.1
  let splatRadius = params.splatRadius * particleSize * 0.5;
  
  // Convert to grid coordinates
  let gridPos = worldToGrid(pos);
  let cellCenter = vec3<i32>(floor(gridPos));
  
  // Splat radius in cells - CLAMP to prevent GPU hang from too many iterations
  let radiusCells = min(i32(ceil(splatRadius / params.cellSize.x)) + 1, 2);
  
  // Splat to nearby cells (max 5³ = 125 iterations per particle)
  for (var dz = -radiusCells; dz <= radiusCells; dz++) {
    for (var dy = -radiusCells; dy <= radiusCells; dy++) {
      for (var dx = -radiusCells; dx <= radiusCells; dx++) {
        let cell = cellCenter + vec3<i32>(dx, dy, dz);
        
        if (!isValidCell(cell)) {
          continue;
        }
        
        // Distance from particle center to cell center
        let cellWorldPos = params.volumeMin + (vec3<f32>(cell) + 0.5) * params.cellSize;
        let dist = length(cellWorldPos - pos);
        
        // Compute weight
        let weight = splatKernel(dist, splatRadius) * params.densityScale;
        
        if (weight > 0.001) {
          let idx = gridToIndex(cell);
          
          // Atomic add density (scaled to fixed point)
          let densityFixed = u32(weight * 65536.0);
          atomicAdd(&densityGrid[idx], densityFixed);
          
          // Atomic add color (weighted, scaled to fixed point)
          let colorWeight = weight * params.colorBlend;
          atomicAdd(&colorGridR[idx], u32(color.r * colorWeight * 65536.0));
          atomicAdd(&colorGridG[idx], u32(color.g * colorWeight * 65536.0));
          atomicAdd(&colorGridB[idx], u32(color.b * colorWeight * 65536.0));
          atomicAdd(&colorGridW[idx], u32(colorWeight * 65536.0));
        }
      }
    }
  }
}
`;

// Clear grid compute shader
export const gridClearComputeWGSL = /* wgsl */`
struct ClearParams {
  gridSize: u32,
  _pad0: u32,
  _pad1: u32,
  _pad2: u32,
};

@group(0) @binding(0) var<uniform> params: ClearParams;
@group(0) @binding(1) var<storage, read_write> densityGrid: array<atomic<u32>>;
@group(0) @binding(2) var<storage, read_write> colorGridR: array<atomic<u32>>;
@group(0) @binding(3) var<storage, read_write> colorGridG: array<atomic<u32>>;
@group(0) @binding(4) var<storage, read_write> colorGridB: array<atomic<u32>>;
@group(0) @binding(5) var<storage, read_write> colorGridW: array<atomic<u32>>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  let totalCells = params.gridSize * params.gridSize * params.gridSize;
  
  if (idx >= totalCells) {
    return;
  }
  
  atomicStore(&densityGrid[idx], 0u);
  atomicStore(&colorGridR[idx], 0u);
  atomicStore(&colorGridG[idx], 0u);
  atomicStore(&colorGridB[idx], 0u);
  atomicStore(&colorGridW[idx], 0u);
}
`;

// Convert atomic grid to float arrays for rendering
export const gridFinalizeComputeWGSL = /* wgsl */`
struct FinalizeParams {
  gridSize: u32,
  densityNormalize: f32,
  colorNormalize: f32,
  _pad: f32,
};

@group(0) @binding(0) var<uniform> params: FinalizeParams;
@group(0) @binding(1) var<storage, read> densityGridAtomic: array<u32>;
@group(0) @binding(2) var<storage, read> colorGridR: array<u32>;
@group(0) @binding(3) var<storage, read> colorGridG: array<u32>;
@group(0) @binding(4) var<storage, read> colorGridB: array<u32>;
@group(0) @binding(5) var<storage, read> colorGridW: array<u32>;
@group(0) @binding(6) var<storage, read_write> densityOut: array<f32>;
@group(0) @binding(7) var<storage, read_write> colorOut: array<vec4<f32>>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  let totalCells = params.gridSize * params.gridSize * params.gridSize;
  
  if (idx >= totalCells) {
    return;
  }
  
  // Convert fixed-point back to float
  let densityRaw = f32(densityGridAtomic[idx]) / 65536.0;
  densityOut[idx] = densityRaw * params.densityNormalize;
  
  // Convert color (weighted average)
  let weightRaw = f32(colorGridW[idx]) / 65536.0;
  if (weightRaw > 0.001) {
    let r = f32(colorGridR[idx]) / 65536.0 / weightRaw;
    let g = f32(colorGridG[idx]) / 65536.0 / weightRaw;
    let b = f32(colorGridB[idx]) / 65536.0 / weightRaw;
    colorOut[idx] = vec4<f32>(r, g, b, weightRaw * params.colorNormalize);
  } else {
    colorOut[idx] = vec4<f32>(0.0);
  }
}
`;
