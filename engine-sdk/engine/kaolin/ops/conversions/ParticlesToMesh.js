/**
 * ParticlesToMesh.js — Convert particle positions into a triangle mesh
 *
 * Generates an isosurface from particle density fields using
 * metaball-style implicit functions + Marching Cubes extraction.
 *
 * Use cases:
 *   - Fluid surface rendering (SPH → mesh)
 *   - Particle cloud → solid mesh for physics
 *   - Point sprite → mesh conversion for LOD
 *
 * Compatible with:
 *   - Particle system readback (ParticleSimWorld positions)
 *   - FluidMPM / ParticleSPH output
 *   - SDFToMesh.js (shares MC internals)
 */

import { sdfToMesh } from './SDFToMesh.js';
import { computeBoundingBox } from '../mesh/MeshOps.js';

// ============================================================================
// PARTICLE DENSITY → MESH
// ============================================================================

/**
 * Build an isosurface mesh from particle positions using metaball density.
 *
 * Each particle contributes a smooth falloff: d(r) = 1 - (r/radius)^2
 * summed at each grid point. Isosurface at threshold extracts the mesh.
 *
 * @param {Float32Array} particlePositions — stride 3
 * @param {Object}       options
 * @param {number}       options.radius      — influence radius per particle (default auto)
 * @param {number}       options.threshold   — density isosurface value (default 1.0)
 * @param {number}       options.resolution  — grid voxels per longest axis (default 32)
 * @param {number}       options.padding     — padding voxels (default 2)
 * @param {Float32Array} options.radii       — per-particle radii (overrides uniform radius)
 * @param {string}       options.kernel      — 'poly6' | 'metaball' | 'wyvill' (default 'poly6')
 * @returns {{ positions: Float32Array, indices: Uint32Array, normals: Float32Array }}
 */
export function particlesToMesh(particlePositions, options = {}) {
    const numParticles = (particlePositions.length / 3) | 0;
    if (numParticles === 0) {
        return { positions: new Float32Array(0), indices: new Uint32Array(0), normals: new Float32Array(0) };
    }

    const resolution = options.resolution ?? 32;
    const padding = options.padding ?? 2;
    const threshold = options.threshold ?? 1.0;
    const kernel = options.kernel ?? 'poly6';
    const perParticleRadii = options.radii ?? null;

    // Compute bounds
    const bbox = computeBoundingBox(particlePositions);
    const maxDim = Math.max(bbox.size[0], bbox.size[1], bbox.size[2], 0.001);

    // Auto radius: based on average spacing
    const defaultRadius = options.radius ?? (maxDim / Math.cbrt(numParticles) * 1.5);

    const voxelSize = maxDim / (resolution - 2 * padding);
    const origin = new Float32Array([
        bbox.min[0] - padding * voxelSize,
        bbox.min[1] - padding * voxelSize,
        bbox.min[2] - padding * voxelSize,
    ]);

    const resX = Math.ceil(bbox.size[0] / voxelSize) + 2 * padding;
    const resY = Math.ceil(bbox.size[1] / voxelSize) + 2 * padding;
    const resZ = Math.ceil(bbox.size[2] / voxelSize) + 2 * padding;

    // Build density grid
    const density = new Float32Array(resX * resY * resZ);

    // Select kernel function
    const kernelFn = _getKernel(kernel);

    // Spatial hash for particles (avoid O(N*V) full scan)
    const maxRadius = perParticleRadii ? _maxVal(perParticleRadii, numParticles) : defaultRadius;
    const cellSize = maxRadius;
    const particleGrid = _buildParticleGrid(particlePositions, numParticles, cellSize);

    // For each grid cell, accumulate density from nearby particles
    for (let gz = 0; gz < resZ; gz++) {
        for (let gy = 0; gy < resY; gy++) {
            for (let gx = 0; gx < resX; gx++) {
                const wx = origin[0] + (gx + 0.5) * voxelSize;
                const wy = origin[1] + (gy + 0.5) * voxelSize;
                const wz = origin[2] + (gz + 0.5) * voxelSize;

                const sum = _accumulateDensity(
                    wx, wy, wz,
                    particlePositions, numParticles,
                    perParticleRadii, defaultRadius,
                    particleGrid, cellSize, maxRadius,
                    kernelFn
                );

                // Convert density to SDF-like value: negative inside, positive outside
                density[gx + gy * resX + gz * resX * resY] = threshold - sum;
            }
        }
    }

    // Extract isosurface at 0
    return sdfToMesh(density, resX, resY, resZ, {
        origin,
        voxelSize,
        isoValue: 0,
    });
}


// ============================================================================
// ANISOTROPIC KERNEL (for elongated fluid splashes)
// ============================================================================

/**
 * Build mesh from particles with anisotropic kernels.
 * Each particle's influence is stretched along its velocity direction.
 *
 * @param {Float32Array} positions  — stride 3
 * @param {Float32Array} velocities — stride 3 (same count as positions)
 * @param {Object}       options
 * @param {number}       options.radius       — base radius (default auto)
 * @param {number}       options.anisotropy   — stretch factor along velocity (default 2.0)
 * @param {number}       options.resolution   — grid res (default 32)
 * @param {number}       options.threshold    — density threshold (default 1.0)
 * @returns {{ positions: Float32Array, indices: Uint32Array, normals: Float32Array }}
 */
export function particlesToMeshAnisotropic(positions, velocities, options = {}) {
    const numParticles = (positions.length / 3) | 0;
    if (numParticles === 0) {
        return { positions: new Float32Array(0), indices: new Uint32Array(0), normals: new Float32Array(0) };
    }

    const resolution = options.resolution ?? 32;
    const padding = options.padding ?? 2;
    const threshold = options.threshold ?? 1.0;
    const anisotropy = options.anisotropy ?? 2.0;

    const bbox = computeBoundingBox(positions);
    const maxDim = Math.max(bbox.size[0], bbox.size[1], bbox.size[2], 0.001);
    const baseRadius = options.radius ?? (maxDim / Math.cbrt(numParticles) * 1.5);

    const voxelSize = maxDim / (resolution - 2 * padding);
    const origin = new Float32Array([
        bbox.min[0] - padding * voxelSize,
        bbox.min[1] - padding * voxelSize,
        bbox.min[2] - padding * voxelSize,
    ]);

    const resX = Math.ceil(bbox.size[0] / voxelSize) + 2 * padding;
    const resY = Math.ceil(bbox.size[1] / voxelSize) + 2 * padding;
    const resZ = Math.ceil(bbox.size[2] / voxelSize) + 2 * padding;

    const maxR = baseRadius * anisotropy;
    const cellSize = maxR;
    const particleGrid = _buildParticleGrid(positions, numParticles, cellSize);

    const density = new Float32Array(resX * resY * resZ);

    for (let gz = 0; gz < resZ; gz++) {
        for (let gy = 0; gy < resY; gy++) {
            for (let gx = 0; gx < resX; gx++) {
                const wx = origin[0] + (gx + 0.5) * voxelSize;
                const wy = origin[1] + (gy + 0.5) * voxelSize;
                const wz = origin[2] + (gz + 0.5) * voxelSize;

                let sum = 0;
                const nearParticles = _queryGrid(particleGrid, wx, wy, wz, cellSize, maxR);

                for (const pi of nearParticles) {
                    const px = positions[pi * 3];
                    const py = positions[pi * 3 + 1];
                    const pz = positions[pi * 3 + 2];

                    // Velocity direction
                    let vx = velocities[pi * 3];
                    let vy = velocities[pi * 3 + 1];
                    let vz = velocities[pi * 3 + 2];
                    const vLen = Math.sqrt(vx * vx + vy * vy + vz * vz);

                    let dx = wx - px, dy = wy - py, dz = wz - pz;

                    if (vLen > 1e-6) {
                        // Project displacement onto velocity axis and scale
                        vx /= vLen; vy /= vLen; vz /= vLen;
                        const proj = dx * vx + dy * vy + dz * vz;
                        // Shrink along velocity direction
                        dx -= proj * vx * (1 - 1 / anisotropy);
                        dy -= proj * vy * (1 - 1 / anisotropy);
                        dz -= proj * vz * (1 - 1 / anisotropy);
                    }

                    const r2 = dx * dx + dy * dy + dz * dz;
                    const R2 = baseRadius * baseRadius;
                    if (r2 < R2) {
                        const s = 1 - r2 / R2;
                        sum += s * s * s; // poly6-like
                    }
                }

                density[gx + gy * resX + gz * resX * resY] = threshold - sum;
            }
        }
    }

    return sdfToMesh(density, resX, resY, resZ, { origin, voxelSize, isoValue: 0 });
}


// ============================================================================
// SCREEN-SPACE FLUID MESH (simplified — CPU fallback)
// ============================================================================

/**
 * Quick mesh from particles using a simple point-to-voxel splat.
 * Faster than full metaball but lower quality. Good for preview/LOD.
 *
 * @param {Float32Array} positions — stride 3
 * @param {number}       radius    — splat radius
 * @param {number}       resolution — grid res (default 24)
 * @returns {{ positions: Float32Array, indices: Uint32Array, normals: Float32Array }}
 */
export function particlesToMeshFast(positions, radius, resolution = 24) {
    return particlesToMesh(positions, {
        radius,
        resolution,
        threshold: 0.5,
        kernel: 'metaball',
        padding: 1,
    });
}


// ============================================================================
// KERNEL FUNCTIONS
// ============================================================================

function _getKernel(name) {
    switch (name) {
        case 'metaball':
            // Classic 1/r² metaball
            return (r2, R2) => {
                if (r2 >= R2) return 0;
                const s = r2 / R2;
                return 1 / (1 + s * 4) - 0.2; // shifted to zero at boundary
            };

        case 'wyvill':
            // Wyvill (1986) — smooth cubic falloff
            return (r2, R2) => {
                if (r2 >= R2) return 0;
                const s = 1 - r2 / R2;
                return s * s * s;
            };

        case 'poly6':
        default:
            // SPH Poly6 kernel (Müller 2003)
            return (r2, R2) => {
                if (r2 >= R2) return 0;
                const s = R2 - r2;
                return s * s * s / (R2 * R2 * R2); // normalized
            };
    }
}


// ============================================================================
// SPATIAL HASH FOR PARTICLES
// ============================================================================

function _buildParticleGrid(positions, numParticles, cellSize) {
    const grid = new Map();
    for (let i = 0; i < numParticles; i++) {
        const kx = Math.floor(positions[i * 3] / cellSize);
        const ky = Math.floor(positions[i * 3 + 1] / cellSize);
        const kz = Math.floor(positions[i * 3 + 2] / cellSize);
        const key = kx + ',' + ky + ',' + kz;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(i);
    }
    return grid;
}

function _queryGrid(grid, wx, wy, wz, cellSize, radius) {
    const result = [];
    const kx = Math.floor(wx / cellSize);
    const ky = Math.floor(wy / cellSize);
    const kz = Math.floor(wz / cellSize);
    const range = Math.ceil(radius / cellSize);

    for (let dz = -range; dz <= range; dz++) {
        for (let dy = -range; dy <= range; dy++) {
            for (let dx = -range; dx <= range; dx++) {
                const key = (kx + dx) + ',' + (ky + dy) + ',' + (kz + dz);
                const cell = grid.get(key);
                if (cell) {
                    for (const idx of cell) result.push(idx);
                }
            }
        }
    }
    return result;
}

function _accumulateDensity(wx, wy, wz, positions, numParticles, perRadii, defaultR, grid, cellSize, maxR, kernelFn) {
    const nearParticles = _queryGrid(grid, wx, wy, wz, cellSize, maxR);
    let sum = 0;

    for (const pi of nearParticles) {
        const dx = wx - positions[pi * 3];
        const dy = wy - positions[pi * 3 + 1];
        const dz = wz - positions[pi * 3 + 2];
        const r2 = dx * dx + dy * dy + dz * dz;
        const R = perRadii ? perRadii[pi] : defaultR;
        const R2 = R * R;
        sum += kernelFn(r2, R2);
    }

    return sum;
}

function _maxVal(arr, count) {
    let mx = 0;
    for (let i = 0; i < count; i++) {
        if (arr[i] > mx) mx = arr[i];
    }
    return mx;
}
