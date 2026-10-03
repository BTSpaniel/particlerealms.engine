// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// =============================================================================
// FLUID BOUNDARY - Solid boundary handling for fluid simulation
// =============================================================================
// Provides compute shaders and utilities for enforcing solid boundaries
// in the fluid grid using a 3D solid mask texture.

/**
 * Generate WGSL shader for applying solid boundaries to velocity
 * This should run after the pressure projection step
 */
export function createBoundaryShader(workgroupSize = 256) {
  return /* wgsl */`
// =============================================================================
// Solid Boundary Enforcement
// =============================================================================
// Samples the solid mask and zeroes velocity in solid cells,
// and applies no-penetration conditions at solid-fluid interfaces.

struct BoundaryParams {
  gridSizeX : f32,
  gridSizeY : f32,
  gridSizeZ : f32,
  _pad0 : f32,
};

@group(0) @binding(0) var<storage, read_write> velocity : array<vec4<f32>>;
@group(0) @binding(1) var solidMask : texture_3d<u32>;
@group(0) @binding(2) var<uniform> params : BoundaryParams;

fn isSolid(x : i32, y : i32, z : i32) -> bool {
  let gx = i32(params.gridSizeX);
  let gy = i32(params.gridSizeY);
  let gz = i32(params.gridSizeZ);
  
  if (x < 0 || x >= gx || y < 0 || y >= gy || z < 0 || z >= gz) {
    return true; // Out of bounds = solid
  }
  
  let val = textureLoad(solidMask, vec3<i32>(x, y, z), 0).r;
  return val > 0u;
}

@compute @workgroup_size(${workgroupSize})
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let gx = i32(params.gridSizeX);
  let gy = i32(params.gridSizeY);
  let gz = i32(params.gridSizeZ);
  let cellCount = gx * gy * gz;
  
  let idx = i32(gid.x);
  if (idx >= cellCount) { return; }
  
  // Decode cell coordinates
  let layerSize = gx * gy;
  let z = idx / layerSize;
  let rem = idx - z * layerSize;
  let y = rem / gx;
  let x = rem - y * gx;
  
  // If this cell is solid, zero velocity
  if (isSolid(x, y, z)) {
    velocity[u32(idx)] = vec4<f32>(0.0, 0.0, 0.0, 0.0);
    return;
  }
  
  // Apply no-penetration at solid-fluid interfaces
  var vel = velocity[u32(idx)].xyz;
  
  // Check neighbors and block velocity component pointing into solid
  if (isSolid(x - 1, y, z) && vel.x < 0.0) { vel.x = 0.0; }
  if (isSolid(x + 1, y, z) && vel.x > 0.0) { vel.x = 0.0; }
  if (isSolid(x, y - 1, z) && vel.y < 0.0) { vel.y = 0.0; }
  if (isSolid(x, y + 1, z) && vel.y > 0.0) { vel.y = 0.0; }
  if (isSolid(x, y, z - 1) && vel.z < 0.0) { vel.z = 0.0; }
  if (isSolid(x, y, z + 1) && vel.z > 0.0) { vel.z = 0.0; }
  
  velocity[u32(idx)] = vec4<f32>(vel, 0.0);
}
`;
}

/**
 * Generate WGSL shader for pressure solve with solid boundaries
 * Modifies the Jacobi iteration to handle solid cells
 */
export function createPressureSolveWithBoundaryShader(workgroupSize = 256) {
  return /* wgsl */`
// =============================================================================
// Pressure Solve with Solid Boundaries
// =============================================================================

struct PressureParams {
  gridSizeX : f32,
  gridSizeY : f32,
  gridSizeZ : f32,
  _pad0 : f32,
};

@group(0) @binding(0) var<storage, read> pressure : array<f32>;
@group(0) @binding(1) var<storage, read_write> pressureOut : array<f32>;
@group(0) @binding(2) var<storage, read> divergence : array<f32>;
@group(0) @binding(3) var solidMask : texture_3d<u32>;
@group(0) @binding(4) var<uniform> params : PressureParams;

fn isSolid(x : i32, y : i32, z : i32) -> bool {
  let gx = i32(params.gridSizeX);
  let gy = i32(params.gridSizeY);
  let gz = i32(params.gridSizeZ);
  
  if (x < 0 || x >= gx || y < 0 || y >= gy || z < 0 || z >= gz) {
    return true;
  }
  
  let val = textureLoad(solidMask, vec3<i32>(x, y, z), 0).r;
  return val > 0u;
}

fn getPressure(x : i32, y : i32, z : i32, centerPressure : f32) -> f32 {
  let gx = i32(params.gridSizeX);
  let gy = i32(params.gridSizeY);
  
  // If neighbor is solid, use center pressure (Neumann boundary)
  if (isSolid(x, y, z)) {
    return centerPressure;
  }
  
  let idx = z * gx * gy + y * gx + x;
  return pressure[u32(idx)];
}

@compute @workgroup_size(${workgroupSize})
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let gx = i32(params.gridSizeX);
  let gy = i32(params.gridSizeY);
  let gz = i32(params.gridSizeZ);
  let cellCount = gx * gy * gz;
  
  let idx = i32(gid.x);
  if (idx >= cellCount) { return; }
  
  let layerSize = gx * gy;
  let z = idx / layerSize;
  let rem = idx - z * layerSize;
  let y = rem / gx;
  let x = rem - y * gx;
  
  // Solid cells have zero pressure
  if (isSolid(x, y, z)) {
    pressureOut[u32(idx)] = 0.0;
    return;
  }
  
  let centerP = pressure[u32(idx)];
  
  // Get neighbor pressures (with solid boundary handling)
  let pL = getPressure(x - 1, y, z, centerP);
  let pR = getPressure(x + 1, y, z, centerP);
  let pD = getPressure(x, y - 1, z, centerP);
  let pU = getPressure(x, y + 1, z, centerP);
  let pB = getPressure(x, y, z - 1, centerP);
  let pF = getPressure(x, y, z + 1, centerP);
  
  let div = divergence[u32(idx)];
  
  // Jacobi iteration
  let pNew = (pL + pR + pD + pU + pB + pF - div) / 6.0;
  pressureOut[u32(idx)] = pNew;
}
`;
}

/**
 * Create boundary enforcement pipeline
 */
export function createBoundaryPipeline(device, options = {}) {
  const workgroupSize = options.workgroupSize || 256;
  
  const module = device.createShaderModule({
    label: "FluidBoundary.shader",
    code: createBoundaryShader(workgroupSize),
  });
  
  const pipeline = device.createComputePipeline({
    label: "FluidBoundary.pipeline",
    layout: "auto",
    compute: {
      module,
      entryPoint: "main",
    },
  });
  
  return { pipeline, workgroupSize };
}

/**
 * Apply solid boundaries to velocity field
 */
export function applyBoundaries(encoder, config) {
  const { pipeline, bindGroup, cellCount, workgroupSize } = config;
  
  const pass = encoder.beginComputePass({ label: "FluidBoundary.apply" });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(Math.ceil(cellCount / workgroupSize));
  pass.end();
}

export default {
  createBoundaryShader,
  createPressureSolveWithBoundaryShader,
  createBoundaryPipeline,
  applyBoundaries,
};
