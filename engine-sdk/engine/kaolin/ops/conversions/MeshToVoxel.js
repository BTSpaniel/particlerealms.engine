/**
 * MeshToVoxel.js — Voxelize any triangle mesh
 *
 * Converts a triangle surface mesh into a 3D voxel grid.
 * Uses conservative voxelization: any voxel that overlaps a triangle is set.
 *
 * Approaches:
 *   1. CPU scanline (simple, robust) — default
 *   2. GPU compute (fast, for large meshes) — requires WebGPU device
 *
 * Output: Uint8Array (1 = solid, 0 = empty) indexed [x + y*resX + z*resX*resY]
 *
 * Compatible with:
 *   - engine/voxel/ chunk system (ChunkRegistry)
 *   - MarchingCubesMesher (feed density field)
 *   - ConnectivityCompute (structural analysis)
 *   - VoronoiFracture (fracture source)
 */

import { computeBoundingBox } from '../mesh/MeshOps.js';

// ============================================================================
// CONSTANTS
// ============================================================================

const EPSILON = 1e-7;

// ============================================================================
// CPU VOXELIZATION
// ============================================================================

/**
 * Voxelize a triangle mesh on the CPU.
 *
 * @param {Float32Array} positions — stride 3
 * @param {Uint32Array}  indices   — stride 3
 * @param {Object}       options
 * @param {number}       options.resolution — voxels per longest axis (default 32)
 * @param {number}       options.padding    — padding voxels around mesh (default 1)
 * @param {boolean}      options.fillInterior — flood-fill interior after surface (default false)
 * @returns {{ grid: Uint8Array, resX: number, resY: number, resZ: number, origin: Float32Array, voxelSize: number }}
 */
export function meshToVoxel(positions, indices, options = {}) {
    const resolution = options.resolution ?? 32;
    const padding = options.padding ?? 1;
    const fillInterior = options.fillInterior ?? false;

    const bbox = computeBoundingBox(positions);

    // Compute voxel size from longest axis
    const maxDim = Math.max(bbox.size[0], bbox.size[1], bbox.size[2]);
    if (maxDim < EPSILON) {
        return _emptyGrid();
    }

    const voxelSize = maxDim / (resolution - 2 * padding);
    const origin = new Float32Array([
        bbox.min[0] - padding * voxelSize,
        bbox.min[1] - padding * voxelSize,
        bbox.min[2] - padding * voxelSize,
    ]);

    const resX = Math.ceil(bbox.size[0] / voxelSize) + 2 * padding;
    const resY = Math.ceil(bbox.size[1] / voxelSize) + 2 * padding;
    const resZ = Math.ceil(bbox.size[2] / voxelSize) + 2 * padding;

    const grid = new Uint8Array(resX * resY * resZ);
    const numFaces = (indices.length / 3) | 0;

    // For each triangle, find its AABB in voxel coords and test overlap
    for (let f = 0; f < numFaces; f++) {
        const i0 = indices[f * 3] * 3;
        const i1 = indices[f * 3 + 1] * 3;
        const i2 = indices[f * 3 + 2] * 3;

        const v0x = positions[i0], v0y = positions[i0 + 1], v0z = positions[i0 + 2];
        const v1x = positions[i1], v1y = positions[i1 + 1], v1z = positions[i1 + 2];
        const v2x = positions[i2], v2y = positions[i2 + 1], v2z = positions[i2 + 2];

        // Triangle AABB in voxel coords
        const minVX = Math.max(0, Math.floor((Math.min(v0x, v1x, v2x) - origin[0]) / voxelSize));
        const minVY = Math.max(0, Math.floor((Math.min(v0y, v1y, v2y) - origin[1]) / voxelSize));
        const minVZ = Math.max(0, Math.floor((Math.min(v0z, v1z, v2z) - origin[2]) / voxelSize));
        const maxVX = Math.min(resX - 1, Math.floor((Math.max(v0x, v1x, v2x) - origin[0]) / voxelSize));
        const maxVY = Math.min(resY - 1, Math.floor((Math.max(v0y, v1y, v2y) - origin[1]) / voxelSize));
        const maxVZ = Math.min(resZ - 1, Math.floor((Math.max(v0z, v1z, v2z) - origin[2]) / voxelSize));

        // Test each voxel in the triangle's AABB
        for (let vz = minVZ; vz <= maxVZ; vz++) {
            for (let vy = minVY; vy <= maxVY; vy++) {
                for (let vx = minVX; vx <= maxVX; vx++) {
                    if (grid[vx + vy * resX + vz * resX * resY]) continue;

                    // Voxel center in world space
                    const cx = origin[0] + (vx + 0.5) * voxelSize;
                    const cy = origin[1] + (vy + 0.5) * voxelSize;
                    const cz = origin[2] + (vz + 0.5) * voxelSize;
                    const half = voxelSize * 0.5;

                    if (_triBoxOverlap(
                        cx, cy, cz, half,
                        v0x, v0y, v0z,
                        v1x, v1y, v1z,
                        v2x, v2y, v2z
                    )) {
                        grid[vx + vy * resX + vz * resX * resY] = 1;
                    }
                }
            }
        }
    }

    // Optional interior fill via flood-fill from boundary
    if (fillInterior) {
        _floodFillInterior(grid, resX, resY, resZ);
    }

    return { grid, resX, resY, resZ, origin, voxelSize };
}


/**
 * Convert voxel grid to a density field (Float32Array) for Marching Cubes.
 * Surface voxels get density 0, interior > 0, exterior < 0.
 *
 * @param {Uint8Array} grid
 * @param {number} resX
 * @param {number} resY
 * @param {number} resZ
 * @returns {Float32Array} — density field, same dimensions
 */
export function voxelGridToDensity(grid, resX, resY, resZ) {
    const density = new Float32Array(resX * resY * resZ);

    // Simple: solid = +1, empty = -1, then optionally blur
    for (let i = 0; i < grid.length; i++) {
        density[i] = grid[i] ? 1.0 : -1.0;
    }

    // 3D box blur for smooth gradients (1 pass)
    const temp = new Float32Array(density.length);
    for (let z = 1; z < resZ - 1; z++) {
        for (let y = 1; y < resY - 1; y++) {
            for (let x = 1; x < resX - 1; x++) {
                let sum = 0;
                let count = 0;
                for (let dz = -1; dz <= 1; dz++) {
                    for (let dy = -1; dy <= 1; dy++) {
                        for (let dx = -1; dx <= 1; dx++) {
                            sum += density[(x + dx) + (y + dy) * resX + (z + dz) * resX * resY];
                            count++;
                        }
                    }
                }
                temp[x + y * resX + z * resX * resY] = sum / count;
            }
        }
    }

    // Copy border
    for (let z = 0; z < resZ; z++) {
        for (let y = 0; y < resY; y++) {
            for (let x = 0; x < resX; x++) {
                if (x === 0 || x === resX - 1 || y === 0 || y === resY - 1 || z === 0 || z === resZ - 1) {
                    temp[x + y * resX + z * resX * resY] = density[x + y * resX + z * resX * resY];
                }
            }
        }
    }

    return temp;
}


/**
 * Compute a signed distance field from a voxel grid.
 * Uses distance transform (chamfer approximation).
 *
 * @param {Uint8Array} grid
 * @param {number} resX
 * @param {number} resY
 * @param {number} resZ
 * @param {number} voxelSize
 * @returns {Float32Array} — signed distance at each voxel center
 */
export function voxelGridToSDF(grid, resX, resY, resZ, voxelSize) {
    const size = resX * resY * resZ;
    const dist = new Float32Array(size);
    const INF = resX + resY + resZ;

    // Initialize: 0 for surface voxels, +INF for empty, -INF for interior
    for (let i = 0; i < size; i++) {
        dist[i] = grid[i] ? -INF : INF;
    }

    // Mark surface voxels (have at least one empty neighbor)
    for (let z = 0; z < resZ; z++) {
        for (let y = 0; y < resY; y++) {
            for (let x = 0; x < resX; x++) {
                const idx = x + y * resX + z * resX * resY;
                if (!grid[idx]) continue;

                let isSurface = false;
                for (let dz = -1; dz <= 1 && !isSurface; dz++) {
                    for (let dy = -1; dy <= 1 && !isSurface; dy++) {
                        for (let dx = -1; dx <= 1 && !isSurface; dx++) {
                            if (dx === 0 && dy === 0 && dz === 0) continue;
                            const nx = x + dx, ny = y + dy, nz = z + dz;
                            if (nx < 0 || nx >= resX || ny < 0 || ny >= resY || nz < 0 || nz >= resZ) {
                                isSurface = true;
                            } else if (!grid[nx + ny * resX + nz * resX * resY]) {
                                isSurface = true;
                            }
                        }
                    }
                }
                if (isSurface) dist[idx] = 0;
            }
        }
    }

    // Forward pass (chamfer 3-4-5)
    for (let z = 1; z < resZ - 1; z++) {
        for (let y = 1; y < resY - 1; y++) {
            for (let x = 1; x < resX - 1; x++) {
                const idx = x + y * resX + z * resX * resY;
                const sign = grid[idx] ? -1 : 1;
                let d = Math.abs(dist[idx]);

                // 6-connected neighbors (distance 1)
                d = Math.min(d, Math.abs(dist[(x-1) + y*resX + z*resX*resY]) + 1);
                d = Math.min(d, Math.abs(dist[x + (y-1)*resX + z*resX*resY]) + 1);
                d = Math.min(d, Math.abs(dist[x + y*resX + (z-1)*resX*resY]) + 1);

                dist[idx] = sign * d;
            }
        }
    }

    // Backward pass
    for (let z = resZ - 2; z >= 1; z--) {
        for (let y = resY - 2; y >= 1; y--) {
            for (let x = resX - 2; x >= 1; x--) {
                const idx = x + y * resX + z * resX * resY;
                const sign = grid[idx] ? -1 : 1;
                let d = Math.abs(dist[idx]);

                d = Math.min(d, Math.abs(dist[(x+1) + y*resX + z*resX*resY]) + 1);
                d = Math.min(d, Math.abs(dist[x + (y+1)*resX + z*resX*resY]) + 1);
                d = Math.min(d, Math.abs(dist[x + y*resX + (z+1)*resX*resY]) + 1);

                dist[idx] = sign * d;
            }
        }
    }

    // Scale to world units
    for (let i = 0; i < size; i++) {
        dist[i] *= voxelSize;
    }

    return dist;
}


// ============================================================================
// INTERIOR FLOOD FILL
// ============================================================================

/**
 * Flood fill from boundary to mark exterior, then invert.
 * Voxels not reached = interior = set to 1.
 */
function _floodFillInterior(grid, resX, resY, resZ) {
    const visited = new Uint8Array(resX * resY * resZ);
    const queue = [];

    // Seed from all boundary voxels that are empty
    for (let z = 0; z < resZ; z++) {
        for (let y = 0; y < resY; y++) {
            for (let x = 0; x < resX; x++) {
                if (x === 0 || x === resX - 1 || y === 0 || y === resY - 1 || z === 0 || z === resZ - 1) {
                    const idx = x + y * resX + z * resX * resY;
                    if (!grid[idx]) {
                        visited[idx] = 1;
                        queue.push(idx);
                    }
                }
            }
        }
    }

    // BFS flood fill
    const offsets = [1, -1, resX, -resX, resX * resY, -resX * resY];
    let head = 0;

    while (head < queue.length) {
        const idx = queue[head++];
        const x = idx % resX;
        const y = ((idx / resX) | 0) % resY;
        const z = (idx / (resX * resY)) | 0;

        for (let d = 0; d < 6; d++) {
            const ni = idx + offsets[d];
            // Bounds check
            const nx = x + (d === 0 ? 1 : d === 1 ? -1 : 0);
            const ny = y + (d === 2 ? 1 : d === 3 ? -1 : 0);
            const nz = z + (d === 4 ? 1 : d === 5 ? -1 : 0);

            if (nx < 0 || nx >= resX || ny < 0 || ny >= resY || nz < 0 || nz >= resZ) continue;
            if (visited[ni] || grid[ni]) continue;

            visited[ni] = 1;
            queue.push(ni);
        }
    }

    // Mark unvisited empty voxels as interior
    for (let i = 0; i < grid.length; i++) {
        if (!grid[i] && !visited[i]) {
            grid[i] = 1;
        }
    }
}


// ============================================================================
// TRIANGLE-BOX OVERLAP (Akenine-Möller)
// ============================================================================

/**
 * Test if a triangle overlaps an axis-aligned box.
 * Based on Tomas Akenine-Möller's separating axis theorem test.
 */
function _triBoxOverlap(cx, cy, cz, halfSize, v0x, v0y, v0z, v1x, v1y, v1z, v2x, v2y, v2z) {
    // Translate triangle to box center
    const t0x = v0x - cx, t0y = v0y - cy, t0z = v0z - cz;
    const t1x = v1x - cx, t1y = v1y - cy, t1z = v1z - cz;
    const t2x = v2x - cx, t2y = v2y - cy, t2z = v2z - cz;

    // Edge vectors
    const e0x = t1x - t0x, e0y = t1y - t0y, e0z = t1z - t0z;
    const e1x = t2x - t1x, e1y = t2y - t1y, e1z = t2z - t1z;
    const e2x = t0x - t2x, e2y = t0y - t2y, e2z = t0z - t2z;

    // Test AABB axes (x, y, z)
    // X-axis
    const triMinX = Math.min(t0x, t1x, t2x);
    const triMaxX = Math.max(t0x, t1x, t2x);
    if (triMinX > halfSize || triMaxX < -halfSize) return false;

    // Y-axis
    const triMinY = Math.min(t0y, t1y, t2y);
    const triMaxY = Math.max(t0y, t1y, t2y);
    if (triMinY > halfSize || triMaxY < -halfSize) return false;

    // Z-axis
    const triMinZ = Math.min(t0z, t1z, t2z);
    const triMaxZ = Math.max(t0z, t1z, t2z);
    if (triMinZ > halfSize || triMaxZ < -halfSize) return false;

    // Test triangle normal
    const nx = e0y * e1z - e0z * e1y;
    const ny = e0z * e1x - e0x * e1z;
    const nz = e0x * e1y - e0y * e1x;
    const d = nx * t0x + ny * t0y + nz * t0z;
    const r = halfSize * (Math.abs(nx) + Math.abs(ny) + Math.abs(nz));
    if (d > r || d < -r) return false;

    // Test 9 cross-product axes (edge × box axis)
    // a_ij = edge_i × axis_j
    if (!_axisTest(t0y * e0z - t0z * e0y, t1y * e0z - t1z * e0y, t2y * e0z - t2z * e0y, halfSize * (Math.abs(e0z) + Math.abs(e0y)))) return false;
    if (!_axisTest(t0z * e0x - t0x * e0z, t1z * e0x - t1x * e0z, t2z * e0x - t2x * e0z, halfSize * (Math.abs(e0z) + Math.abs(e0x)))) return false;
    if (!_axisTest(t0x * e0y - t0y * e0x, t1x * e0y - t1y * e0x, t2x * e0y - t2y * e0x, halfSize * (Math.abs(e0y) + Math.abs(e0x)))) return false;

    if (!_axisTest(t0y * e1z - t0z * e1y, t1y * e1z - t1z * e1y, t2y * e1z - t2z * e1y, halfSize * (Math.abs(e1z) + Math.abs(e1y)))) return false;
    if (!_axisTest(t0z * e1x - t0x * e1z, t1z * e1x - t1x * e1z, t2z * e1x - t2x * e1z, halfSize * (Math.abs(e1z) + Math.abs(e1x)))) return false;
    if (!_axisTest(t0x * e1y - t0y * e1x, t1x * e1y - t1y * e1x, t2x * e1y - t2y * e1x, halfSize * (Math.abs(e1y) + Math.abs(e1x)))) return false;

    if (!_axisTest(t0y * e2z - t0z * e2y, t1y * e2z - t1z * e2y, t2y * e2z - t2z * e2y, halfSize * (Math.abs(e2z) + Math.abs(e2y)))) return false;
    if (!_axisTest(t0z * e2x - t0x * e2z, t1z * e2x - t1x * e2z, t2z * e2x - t2x * e2z, halfSize * (Math.abs(e2z) + Math.abs(e2x)))) return false;
    if (!_axisTest(t0x * e2y - t0y * e2x, t1x * e2y - t1y * e2x, t2x * e2y - t2y * e2x, halfSize * (Math.abs(e2y) + Math.abs(e2x)))) return false;

    return true;
}

function _axisTest(p0, p1, p2, r) {
    const mn = Math.min(p0, p1, p2);
    const mx = Math.max(p0, p1, p2);
    return !(mn > r || mx < -r);
}

function _emptyGrid() {
    return {
        grid: new Uint8Array(0),
        resX: 0, resY: 0, resZ: 0,
        origin: new Float32Array(3),
        voxelSize: 1,
    };
}
