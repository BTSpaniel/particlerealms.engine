// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// MathGrid.js - CPU-side 3D grid sampling and discrete differential operators
// Consolidates: FluidSimWorld.js inline trilinear, SDFCollision trilinear, WindSimulation grid sample
// Houdini VEX volumesample / Niagara grid sampling parity

import { clamp, lerp } from './MathScalar.js';

// ============================================================================
// BILINEAR INTERPOLATION (2D grid)
// ============================================================================

/**
 * Bilinear interpolation on a 2D scalar grid
 * @param {Float32Array|number[]} grid - Flat array [y * width + x]
 * @param {number} width - Grid width
 * @param {number} height - Grid height
 * @param {number} u - X coordinate (0 to width-1, fractional)
 * @param {number} v - Y coordinate (0 to height-1, fractional)
 * @returns {number} Interpolated value
 */
export function bilinearSample(grid, width, height, u, v) {
  const x0 = clamp(Math.floor(u), 0, width - 2);
  const y0 = clamp(Math.floor(v), 0, height - 2);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const fx = u - x0;
  const fy = v - y0;

  const v00 = grid[y0 * width + x0];
  const v10 = grid[y0 * width + x1];
  const v01 = grid[y1 * width + x0];
  const v11 = grid[y1 * width + x1];

  return lerp(lerp(v00, v10, fx), lerp(v01, v11, fx), fy);
}

/**
 * Bilinear interpolation on a 2D vector grid (3-component, interleaved)
 * @param {Float32Array|number[]} grid - Flat array [y * width * 3 + x * 3 + component]
 * @param {number} width - Grid width
 * @param {number} height - Grid height
 * @param {number} u - X coordinate (fractional)
 * @param {number} v - Y coordinate (fractional)
 * @returns {number[]} Interpolated [x, y, z]
 */
export function bilinearSampleVec3(grid, width, height, u, v) {
  const x0 = clamp(Math.floor(u), 0, width - 2);
  const y0 = clamp(Math.floor(v), 0, height - 2);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const fx = u - x0;
  const fy = v - y0;

  const stride = width * 3;
  const i00 = y0 * stride + x0 * 3;
  const i10 = y0 * stride + x1 * 3;
  const i01 = y1 * stride + x0 * 3;
  const i11 = y1 * stride + x1 * 3;

  return [
    lerp(lerp(grid[i00], grid[i10], fx), lerp(grid[i01], grid[i11], fx), fy),
    lerp(lerp(grid[i00 + 1], grid[i10 + 1], fx), lerp(grid[i01 + 1], grid[i11 + 1], fx), fy),
    lerp(lerp(grid[i00 + 2], grid[i10 + 2], fx), lerp(grid[i01 + 2], grid[i11 + 2], fx), fy),
  ];
}

// ============================================================================
// TRILINEAR INTERPOLATION (3D grid)
// ============================================================================

/**
 * Trilinear interpolation on a 3D scalar grid
 * @param {Float32Array|number[]} grid - Flat array [z * height * width + y * width + x]
 * @param {number} width - Grid X dimension
 * @param {number} height - Grid Y dimension
 * @param {number} depth - Grid Z dimension
 * @param {number} u - X coordinate (fractional)
 * @param {number} v - Y coordinate (fractional)
 * @param {number} w - Z coordinate (fractional)
 * @returns {number} Interpolated value
 */
export function trilinearSample(grid, width, height, depth, u, v, w) {
  const x0 = clamp(Math.floor(u), 0, width - 2);
  const y0 = clamp(Math.floor(v), 0, height - 2);
  const z0 = clamp(Math.floor(w), 0, depth - 2);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const z1 = z0 + 1;
  const fx = u - x0;
  const fy = v - y0;
  const fz = w - z0;

  const layerSize = width * height;
  const i000 = z0 * layerSize + y0 * width + x0;
  const i100 = z0 * layerSize + y0 * width + x1;
  const i010 = z0 * layerSize + y1 * width + x0;
  const i110 = z0 * layerSize + y1 * width + x1;
  const i001 = z1 * layerSize + y0 * width + x0;
  const i101 = z1 * layerSize + y0 * width + x1;
  const i011 = z1 * layerSize + y1 * width + x0;
  const i111 = z1 * layerSize + y1 * width + x1;

  const c00 = lerp(grid[i000], grid[i100], fx);
  const c10 = lerp(grid[i010], grid[i110], fx);
  const c01 = lerp(grid[i001], grid[i101], fx);
  const c11 = lerp(grid[i011], grid[i111], fx);

  return lerp(lerp(c00, c10, fy), lerp(c01, c11, fy), fz);
}

/**
 * Trilinear interpolation on a 3D vector grid (3-component, interleaved)
 * Matches FluidSimWorld.js sampleVelocityTrilinear GPU implementation
 * @param {Float32Array|number[]} grid - Flat array [(z*H*W + y*W + x) * 3 + component]
 * @param {number} width - Grid X dimension
 * @param {number} height - Grid Y dimension
 * @param {number} depth - Grid Z dimension
 * @param {number} u - X coordinate (fractional)
 * @param {number} v - Y coordinate (fractional)
 * @param {number} w - Z coordinate (fractional)
 * @returns {number[]} Interpolated [x, y, z]
 */
export function trilinearSampleVec3(grid, width, height, depth, u, v, w) {
  const x0 = clamp(Math.floor(u), 0, width - 2);
  const y0 = clamp(Math.floor(v), 0, height - 2);
  const z0 = clamp(Math.floor(w), 0, depth - 2);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const z1 = z0 + 1;
  const fx = u - x0;
  const fy = v - y0;
  const fz = w - z0;

  const layerSize = width * height;
  const stride = layerSize * 3;
  const rowStride = width * 3;

  function idx(x, y, z) { return z * stride + y * rowStride + x * 3; }

  const out = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const i000 = idx(x0, y0, z0) + c;
    const i100 = idx(x1, y0, z0) + c;
    const i010 = idx(x0, y1, z0) + c;
    const i110 = idx(x1, y1, z0) + c;
    const i001 = idx(x0, y0, z1) + c;
    const i101 = idx(x1, y0, z1) + c;
    const i011 = idx(x0, y1, z1) + c;
    const i111 = idx(x1, y1, z1) + c;

    const c00 = lerp(grid[i000], grid[i100], fx);
    const c10 = lerp(grid[i010], grid[i110], fx);
    const c01 = lerp(grid[i001], grid[i101], fx);
    const c11 = lerp(grid[i011], grid[i111], fx);

    out[c] = lerp(lerp(c00, c10, fy), lerp(c01, c11, fy), fz);
  }
  return out;
}

/**
 * Trilinear interpolation on a 3D grid stored as vec4 (4-component, e.g. velocity + spin)
 * @param {Float32Array|number[]} grid - Flat array [(z*H*W + y*W + x) * 4 + component]
 * @param {number} width - Grid X dimension
 * @param {number} height - Grid Y dimension
 * @param {number} depth - Grid Z dimension
 * @param {number} u - X coordinate (fractional)
 * @param {number} v - Y coordinate (fractional)
 * @param {number} w - Z coordinate (fractional)
 * @returns {number[]} Interpolated [x, y, z, w]
 */
export function trilinearSampleVec4(grid, width, height, depth, u, v, w) {
  const x0 = clamp(Math.floor(u), 0, width - 2);
  const y0 = clamp(Math.floor(v), 0, height - 2);
  const z0 = clamp(Math.floor(w), 0, depth - 2);
  const fx = u - x0, fy = v - y0, fz = w - z0;
  const x1 = x0 + 1, y1 = y0 + 1, z1 = z0 + 1;

  const ls = width * height;
  function idx(x, y, z) { return (z * ls + y * width + x) * 4; }

  const out = [0, 0, 0, 0];
  for (let c = 0; c < 4; c++) {
    const c00 = lerp(grid[idx(x0, y0, z0) + c], grid[idx(x1, y0, z0) + c], fx);
    const c10 = lerp(grid[idx(x0, y1, z0) + c], grid[idx(x1, y1, z0) + c], fx);
    const c01 = lerp(grid[idx(x0, y0, z1) + c], grid[idx(x1, y0, z1) + c], fx);
    const c11 = lerp(grid[idx(x0, y1, z1) + c], grid[idx(x1, y1, z1) + c], fx);
    out[c] = lerp(lerp(c00, c10, fy), lerp(c01, c11, fy), fz);
  }
  return out;
}

// ============================================================================
// DISCRETE DIFFERENTIAL OPERATORS (3D grid, central differences)
// Matches FluidSimWorld.js GPU discrete operators
// ============================================================================

/** Helper: clamped 3D flat index for scalar grid */
function gridIdx(x, y, z, w, h) {
  return clamp(z, 0, arguments[5] - 1) * h * w + clamp(y, 0, h - 1) * w + clamp(x, 0, w - 1);
}

/**
 * Discrete gradient of a scalar field (central differences)
 * @param {Float32Array|number[]} grid - Scalar grid [z*H*W + y*W + x]
 * @param {number} width
 * @param {number} height
 * @param {number} depth
 * @param {number} x - Integer grid coordinate
 * @param {number} y - Integer grid coordinate
 * @param {number} z - Integer grid coordinate
 * @param {number} cellSize - Grid cell spacing (default 1)
 * @returns {number[]} [dF/dx, dF/dy, dF/dz]
 */
export function gridGradient(grid, width, height, depth, x, y, z, cellSize = 1) {
  const ls = width * height;
  const idx = (cx, cy, cz) =>
    clamp(cz, 0, depth - 1) * ls + clamp(cy, 0, height - 1) * width + clamp(cx, 0, width - 1);
  const inv2h = 0.5 / cellSize;
  return [
    (grid[idx(x + 1, y, z)] - grid[idx(x - 1, y, z)]) * inv2h,
    (grid[idx(x, y + 1, z)] - grid[idx(x, y - 1, z)]) * inv2h,
    (grid[idx(x, y, z + 1)] - grid[idx(x, y, z - 1)]) * inv2h,
  ];
}

/**
 * Discrete divergence of a vector field (central differences)
 * @param {Float32Array|number[]} grid - Vector grid [(z*H*W + y*W + x) * 3 + component]
 * @param {number} width
 * @param {number} height
 * @param {number} depth
 * @param {number} x - Integer grid coordinate
 * @param {number} y - Integer grid coordinate
 * @param {number} z - Integer grid coordinate
 * @param {number} cellSize
 * @returns {number} div(F) = dFx/dx + dFy/dy + dFz/dz
 */
export function gridDivergence(grid, width, height, depth, x, y, z, cellSize = 1) {
  const ls = width * height;
  const idx = (cx, cy, cz) =>
    (clamp(cz, 0, depth - 1) * ls + clamp(cy, 0, height - 1) * width + clamp(cx, 0, width - 1)) * 3;
  const inv2h = 0.5 / cellSize;
  return (
    (grid[idx(x + 1, y, z)] - grid[idx(x - 1, y, z)]) * inv2h +
    (grid[idx(x, y + 1, z) + 1] - grid[idx(x, y - 1, z) + 1]) * inv2h +
    (grid[idx(x, y, z + 1) + 2] - grid[idx(x, y, z - 1) + 2]) * inv2h
  );
}

/**
 * Discrete curl of a vector field (central differences)
 * @param {Float32Array|number[]} grid - Vector grid [(z*H*W + y*W + x) * 3 + component]
 * @param {number} width
 * @param {number} height
 * @param {number} depth
 * @param {number} x - Integer grid coordinate
 * @param {number} y - Integer grid coordinate
 * @param {number} z - Integer grid coordinate
 * @param {number} cellSize
 * @returns {number[]} curl(F) = [dFz/dy - dFy/dz, dFx/dz - dFz/dx, dFy/dx - dFx/dy]
 */
export function gridCurl(grid, width, height, depth, x, y, z, cellSize = 1) {
  const ls = width * height;
  const idx = (cx, cy, cz) =>
    (clamp(cz, 0, depth - 1) * ls + clamp(cy, 0, height - 1) * width + clamp(cx, 0, width - 1)) * 3;
  const inv2h = 0.5 / cellSize;

  const dFz_dy = (grid[idx(x, y + 1, z) + 2] - grid[idx(x, y - 1, z) + 2]) * inv2h;
  const dFy_dz = (grid[idx(x, y, z + 1) + 1] - grid[idx(x, y, z - 1) + 1]) * inv2h;
  const dFx_dz = (grid[idx(x, y, z + 1)]     - grid[idx(x, y, z - 1)])     * inv2h;
  const dFz_dx = (grid[idx(x + 1, y, z) + 2] - grid[idx(x - 1, y, z) + 2]) * inv2h;
  const dFy_dx = (grid[idx(x + 1, y, z) + 1] - grid[idx(x - 1, y, z) + 1]) * inv2h;
  const dFx_dy = (grid[idx(x, y + 1, z)]     - grid[idx(x, y - 1, z)])     * inv2h;

  return [
    dFz_dy - dFy_dz,
    dFx_dz - dFz_dx,
    dFy_dx - dFx_dy,
  ];
}

/**
 * Discrete Laplacian of a scalar field (6-point stencil)
 * @param {Float32Array|number[]} grid - Scalar grid [z*H*W + y*W + x]
 * @param {number} width
 * @param {number} height
 * @param {number} depth
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {number} cellSize
 * @returns {number} ∇²F
 */
export function gridLaplacian(grid, width, height, depth, x, y, z, cellSize = 1) {
  const ls = width * height;
  const idx = (cx, cy, cz) =>
    clamp(cz, 0, depth - 1) * ls + clamp(cy, 0, height - 1) * width + clamp(cx, 0, width - 1);
  const invH2 = 1 / (cellSize * cellSize);
  const center = grid[idx(x, y, z)];
  return (
    grid[idx(x + 1, y, z)] + grid[idx(x - 1, y, z)] +
    grid[idx(x, y + 1, z)] + grid[idx(x, y - 1, z)] +
    grid[idx(x, y, z + 1)] + grid[idx(x, y, z - 1)] -
    6 * center
  ) * invH2;
}

/**
 * Discrete Laplacian of a vector field (per-component, 6-point stencil)
 * @param {Float32Array|number[]} grid - Vector grid [(z*H*W + y*W + x) * 3 + c]
 * @param {number} width
 * @param {number} height
 * @param {number} depth
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {number} cellSize
 * @returns {number[]} [∇²Fx, ∇²Fy, ∇²Fz]
 */
export function gridLaplacianVec3(grid, width, height, depth, x, y, z, cellSize = 1) {
  const ls = width * height;
  const idx = (cx, cy, cz) =>
    (clamp(cz, 0, depth - 1) * ls + clamp(cy, 0, height - 1) * width + clamp(cx, 0, width - 1)) * 3;
  const invH2 = 1 / (cellSize * cellSize);
  const ci = idx(x, y, z);
  const out = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    out[c] = (
      grid[idx(x + 1, y, z) + c] + grid[idx(x - 1, y, z) + c] +
      grid[idx(x, y + 1, z) + c] + grid[idx(x, y - 1, z) + c] +
      grid[idx(x, y, z + 1) + c] + grid[idx(x, y, z - 1) + c] -
      6 * grid[ci + c]
    ) * invH2;
  }
  return out;
}

// ============================================================================
// ADVECTION (Semi-Lagrangian, CPU-side)
// Matches FluidSimWorld.js two-step backward advection
// ============================================================================

/**
 * Semi-Lagrangian advection of a scalar field through a velocity field
 * @param {Float32Array} scalarField - Source scalar grid
 * @param {Float32Array} velocityField - Velocity grid (vec3 interleaved)
 * @param {Float32Array} out - Output scalar grid (can be same as scalarField for in-place)
 * @param {number} width
 * @param {number} height
 * @param {number} depth
 * @param {number} dt - Time step
 * @param {number} cellSize - Grid cell spacing
 */
export function advectScalar(scalarField, velocityField, out, width, height, depth, dt, cellSize = 1) {
  const ls = width * height;
  for (let z = 0; z < depth; z++) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const center = [x + 0.5, y + 0.5, z + 0.5];
        const vel = trilinearSampleVec3(velocityField, width, height, depth,
          center[0], center[1], center[2]);
        // Trace back
        const backX = center[0] - vel[0] * dt / cellSize;
        const backY = center[1] - vel[1] * dt / cellSize;
        const backZ = center[2] - vel[2] * dt / cellSize;
        out[z * ls + y * width + x] = trilinearSample(scalarField, width, height, depth, backX, backY, backZ);
      }
    }
  }
  return out;
}

/**
 * Semi-Lagrangian advection of a vector field through itself (self-advection)
 * @param {Float32Array} velocityField - Velocity grid (vec3 interleaved)
 * @param {Float32Array} out - Output velocity grid
 * @param {number} width
 * @param {number} height
 * @param {number} depth
 * @param {number} dt
 * @param {number} cellSize
 */
export function advectVelocity(velocityField, out, width, height, depth, dt, cellSize = 1) {
  const ls = width * height;
  for (let z = 0; z < depth; z++) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const center = [x + 0.5, y + 0.5, z + 0.5];
        const vel = trilinearSampleVec3(velocityField, width, height, depth,
          center[0], center[1], center[2]);
        const backX = center[0] - vel[0] * dt / cellSize;
        const backY = center[1] - vel[1] * dt / cellSize;
        const backZ = center[2] - vel[2] * dt / cellSize;
        const advected = trilinearSampleVec3(velocityField, width, height, depth, backX, backY, backZ);
        const oi = (z * ls + y * width + x) * 3;
        out[oi] = advected[0];
        out[oi + 1] = advected[1];
        out[oi + 2] = advected[2];
      }
    }
  }
  return out;
}

// ============================================================================
// GRID UTILITIES
// ============================================================================

/** Create a zero-filled scalar grid */
export function gridCreateScalar(width, height, depth) {
  return new Float32Array(width * height * depth);
}

/** Create a zero-filled vec3 grid */
export function gridCreateVec3(width, height, depth) {
  return new Float32Array(width * height * depth * 3);
}

/** Create a zero-filled vec4 grid */
export function gridCreateVec4(width, height, depth) {
  return new Float32Array(width * height * depth * 4);
}

/** World position to grid coordinate */
export function worldToGrid(worldPos, gridOrigin, cellSize) {
  return [
    (worldPos[0] - gridOrigin[0]) / cellSize,
    (worldPos[1] - gridOrigin[1]) / cellSize,
    (worldPos[2] - gridOrigin[2]) / cellSize,
  ];
}

/** Grid coordinate to world position */
export function gridToWorld(gridPos, gridOrigin, cellSize) {
  return [
    gridPos[0] * cellSize + gridOrigin[0],
    gridPos[1] * cellSize + gridOrigin[1],
    gridPos[2] * cellSize + gridOrigin[2],
  ];
}

/** Sample scalar field at world position */
export function gridSampleScalarWorld(grid, width, height, depth, worldPos, gridOrigin, cellSize) {
  const gp = worldToGrid(worldPos, gridOrigin, cellSize);
  return trilinearSample(grid, width, height, depth, gp[0], gp[1], gp[2]);
}

/** Sample vector field at world position */
export function gridSampleVec3World(grid, width, height, depth, worldPos, gridOrigin, cellSize) {
  const gp = worldToGrid(worldPos, gridOrigin, cellSize);
  return trilinearSampleVec3(grid, width, height, depth, gp[0], gp[1], gp[2]);
}
