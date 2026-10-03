/**
 * VoxelOps.js — Voxel grid operations
 *
 * Operations on binary/scalar 3D voxel grids:
 *   - Fill interior (flood fill)
 *   - Hollow (keep only surface shell)
 *   - CSG boolean: union, intersect, subtract
 *   - Downsample / upsample
 *   - Morphological: dilate, erode, open, close
 *   - Extract isosurface info (surface voxels, boundary)
 *   - Connected component labeling
 *
 * Grid format: Uint8Array indexed [x + y*resX + z*resX*resY]
 * 1 = solid, 0 = empty (unless scalar grid — Float32Array)
 *
 * Compatible with:
 *   - MeshToVoxel.js output
 *   - engine/voxel/ chunk system (ChunkRegistry)
 *   - ConnectivityCompute.js (structural analysis)
 *   - VoronoiFracture.js (fracture source)
 */

// ============================================================================
// CSG BOOLEAN OPERATIONS
// ============================================================================

/**
 * Union of two voxel grids (same dimensions required).
 * Result = A OR B.
 *
 * @param {Uint8Array} gridA
 * @param {Uint8Array} gridB
 * @returns {Uint8Array}
 */
export function voxelUnion(gridA, gridB) {
    const result = new Uint8Array(gridA.length);
    for (let i = 0; i < gridA.length; i++) {
        result[i] = gridA[i] | gridB[i];
    }
    return result;
}

/**
 * Intersection of two voxel grids.
 * Result = A AND B.
 */
export function voxelIntersect(gridA, gridB) {
    const result = new Uint8Array(gridA.length);
    for (let i = 0; i < gridA.length; i++) {
        result[i] = gridA[i] & gridB[i];
    }
    return result;
}

/**
 * Subtraction: A minus B.
 * Result = A AND NOT B.
 */
export function voxelSubtract(gridA, gridB) {
    const result = new Uint8Array(gridA.length);
    for (let i = 0; i < gridA.length; i++) {
        result[i] = gridA[i] & (gridB[i] ? 0 : 1);
    }
    return result;
}

/**
 * Symmetric difference (XOR).
 * Result = A XOR B.
 */
export function voxelXOR(gridA, gridB) {
    const result = new Uint8Array(gridA.length);
    for (let i = 0; i < gridA.length; i++) {
        result[i] = gridA[i] ^ gridB[i];
    }
    return result;
}

/**
 * Invert a voxel grid.
 */
export function voxelInvert(grid) {
    const result = new Uint8Array(grid.length);
    for (let i = 0; i < grid.length; i++) {
        result[i] = grid[i] ? 0 : 1;
    }
    return result;
}


// ============================================================================
// FILL / HOLLOW
// ============================================================================

/**
 * Fill the interior of a closed voxel shell.
 * Uses flood fill from boundary to mark exterior, then inverts.
 *
 * @param {Uint8Array} grid
 * @param {number} resX
 * @param {number} resY
 * @param {number} resZ
 * @returns {Uint8Array} — new grid with interior filled
 */
export function voxelFill(grid, resX, resY, resZ) {
    const result = new Uint8Array(grid);
    const visited = new Uint8Array(resX * resY * resZ);
    const queue = [];

    // Seed from all empty boundary voxels
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

    // BFS flood fill exterior
    const offsets = [1, -1, resX, -resX, resX * resY, -resX * resY];
    let head = 0;

    while (head < queue.length) {
        const idx = queue[head++];
        const x = idx % resX;
        const y = ((idx / resX) | 0) % resY;
        const z = (idx / (resX * resY)) | 0;

        for (let d = 0; d < 6; d++) {
            const nx = x + (d === 0 ? 1 : d === 1 ? -1 : 0);
            const ny = y + (d === 2 ? 1 : d === 3 ? -1 : 0);
            const nz = z + (d === 4 ? 1 : d === 5 ? -1 : 0);

            if (nx < 0 || nx >= resX || ny < 0 || ny >= resY || nz < 0 || nz >= resZ) continue;
            const ni = nx + ny * resX + nz * resX * resY;
            if (visited[ni] || grid[ni]) continue;

            visited[ni] = 1;
            queue.push(ni);
        }
    }

    // Mark unvisited empty voxels as interior (solid)
    for (let i = 0; i < result.length; i++) {
        if (!result[i] && !visited[i]) {
            result[i] = 1;
        }
    }

    return result;
}

/**
 * Hollow a voxel grid — keep only the outer shell (surface voxels).
 * A voxel is surface if it's solid and has at least one empty 6-neighbor.
 *
 * @param {Uint8Array} grid
 * @param {number} resX
 * @param {number} resY
 * @param {number} resZ
 * @param {number} thickness — shell thickness in voxels (default 1)
 * @returns {Uint8Array}
 */
export function voxelHollow(grid, resX, resY, resZ, thickness = 1) {
    let result = new Uint8Array(grid);

    for (let t = 0; t < thickness; t++) {
        const surface = _extractSurfaceVoxels(result, resX, resY, resZ);
        // Keep only surface; erode interior
        const hollowed = new Uint8Array(result.length);
        for (let i = 0; i < result.length; i++) {
            hollowed[i] = surface[i] ? 1 : 0;
        }
        // If this is multi-layer, erode from the surface inward
        if (t < thickness - 1) {
            result = hollowed;
        } else {
            // Final pass: keep all surface voxels from original up to thickness
            // Union all surface layers
            for (let i = 0; i < result.length; i++) {
                if (hollowed[i]) result[i] = 1;
            }
        }
    }

    // Multi-thickness: dilate surface inward
    if (thickness > 1) {
        const surface = _extractSurfaceVoxels(grid, resX, resY, resZ);
        const shell = _dilate(surface, resX, resY, resZ, thickness - 1);
        // Intersect with original (only keep voxels that were solid)
        const result2 = new Uint8Array(grid.length);
        for (let i = 0; i < grid.length; i++) {
            result2[i] = (grid[i] && shell[i]) ? 1 : 0;
        }
        return result2;
    }

    return _extractSurfaceVoxels(grid, resX, resY, resZ);
}


// ============================================================================
// MORPHOLOGICAL OPERATIONS
// ============================================================================

/**
 * Dilate: expand solid voxels by `radius` voxels (6-connected).
 */
export function voxelDilate(grid, resX, resY, resZ, radius = 1) {
    return _dilate(grid, resX, resY, resZ, radius);
}

/**
 * Erode: shrink solid voxels by `radius` voxels (6-connected).
 */
export function voxelErode(grid, resX, resY, resZ, radius = 1) {
    // Erode = invert → dilate → invert
    let inverted = voxelInvert(grid);
    inverted = _dilate(inverted, resX, resY, resZ, radius);
    return voxelInvert(inverted);
}

/**
 * Morphological open: erode then dilate (removes small protrusions).
 */
export function voxelOpen(grid, resX, resY, resZ, radius = 1) {
    const eroded = voxelErode(grid, resX, resY, resZ, radius);
    return voxelDilate(eroded, resX, resY, resZ, radius);
}

/**
 * Morphological close: dilate then erode (fills small holes).
 */
export function voxelClose(grid, resX, resY, resZ, radius = 1) {
    const dilated = voxelDilate(grid, resX, resY, resZ, radius);
    return voxelErode(dilated, resX, resY, resZ, radius);
}


// ============================================================================
// DOWNSAMPLE / UPSAMPLE
// ============================================================================

/**
 * Downsample a voxel grid by factor (majority vote per super-voxel).
 *
 * @param {Uint8Array} grid
 * @param {number} resX
 * @param {number} resY
 * @param {number} resZ
 * @param {number} factor — downsample factor (default 2)
 * @returns {{ grid: Uint8Array, resX: number, resY: number, resZ: number }}
 */
export function voxelDownsample(grid, resX, resY, resZ, factor = 2) {
    const nX = Math.ceil(resX / factor);
    const nY = Math.ceil(resY / factor);
    const nZ = Math.ceil(resZ / factor);
    const result = new Uint8Array(nX * nY * nZ);
    const threshold = (factor * factor * factor) / 2;

    for (let nz = 0; nz < nZ; nz++) {
        for (let ny = 0; ny < nY; ny++) {
            for (let nx = 0; nx < nX; nx++) {
                let count = 0;
                for (let dz = 0; dz < factor; dz++) {
                    for (let dy = 0; dy < factor; dy++) {
                        for (let dx = 0; dx < factor; dx++) {
                            const sx = nx * factor + dx;
                            const sy = ny * factor + dy;
                            const sz = nz * factor + dz;
                            if (sx < resX && sy < resY && sz < resZ) {
                                if (grid[sx + sy * resX + sz * resX * resY]) count++;
                            }
                        }
                    }
                }
                if (count >= threshold) {
                    result[nx + ny * nX + nz * nX * nY] = 1;
                }
            }
        }
    }

    return { grid: result, resX: nX, resY: nY, resZ: nZ };
}

/**
 * Upsample a voxel grid by factor (nearest-neighbor replication).
 *
 * @param {Uint8Array} grid
 * @param {number} resX
 * @param {number} resY
 * @param {number} resZ
 * @param {number} factor — upsample factor (default 2)
 * @returns {{ grid: Uint8Array, resX: number, resY: number, resZ: number }}
 */
export function voxelUpsample(grid, resX, resY, resZ, factor = 2) {
    const nX = resX * factor;
    const nY = resY * factor;
    const nZ = resZ * factor;
    const result = new Uint8Array(nX * nY * nZ);

    for (let z = 0; z < nZ; z++) {
        for (let y = 0; y < nY; y++) {
            for (let x = 0; x < nX; x++) {
                const sx = (x / factor) | 0;
                const sy = (y / factor) | 0;
                const sz = (z / factor) | 0;
                result[x + y * nX + z * nX * nY] = grid[sx + sy * resX + sz * resX * resY];
            }
        }
    }

    return { grid: result, resX: nX, resY: nY, resZ: nZ };
}


// ============================================================================
// CONNECTED COMPONENTS
// ============================================================================

/**
 * Label connected components in a voxel grid (6-connected).
 *
 * @param {Uint8Array} grid
 * @param {number} resX
 * @param {number} resY
 * @param {number} resZ
 * @returns {{ labels: Int32Array, numComponents: number, componentSizes: Map<number, number> }}
 */
export function connectedComponents(grid, resX, resY, resZ) {
    const labels = new Int32Array(grid.length).fill(-1);
    let nextLabel = 0;
    const componentSizes = new Map();

    const offsets = [1, -1, resX, -resX, resX * resY, -resX * resY];

    for (let i = 0; i < grid.length; i++) {
        if (!grid[i] || labels[i] >= 0) continue;

        // BFS from this voxel
        const label = nextLabel++;
        const queue = [i];
        labels[i] = label;
        let size = 0;
        let head = 0;

        while (head < queue.length) {
            const idx = queue[head++];
            size++;
            const x = idx % resX;
            const y = ((idx / resX) | 0) % resY;
            const z = (idx / (resX * resY)) | 0;

            for (let d = 0; d < 6; d++) {
                const nx = x + (d === 0 ? 1 : d === 1 ? -1 : 0);
                const ny = y + (d === 2 ? 1 : d === 3 ? -1 : 0);
                const nz = z + (d === 4 ? 1 : d === 5 ? -1 : 0);

                if (nx < 0 || nx >= resX || ny < 0 || ny >= resY || nz < 0 || nz >= resZ) continue;
                const ni = nx + ny * resX + nz * resX * resY;
                if (!grid[ni] || labels[ni] >= 0) continue;

                labels[ni] = label;
                queue.push(ni);
            }
        }

        componentSizes.set(label, size);
    }

    return { labels, numComponents: nextLabel, componentSizes };
}

/**
 * Remove small connected components below a size threshold.
 *
 * @param {Uint8Array} grid
 * @param {number} resX
 * @param {number} resY
 * @param {number} resZ
 * @param {number} minSize — minimum voxel count to keep
 * @returns {Uint8Array}
 */
export function removeSmallComponents(grid, resX, resY, resZ, minSize) {
    const { labels, componentSizes } = connectedComponents(grid, resX, resY, resZ);
    const result = new Uint8Array(grid.length);

    for (let i = 0; i < grid.length; i++) {
        if (labels[i] >= 0 && componentSizes.get(labels[i]) >= minSize) {
            result[i] = 1;
        }
    }

    return result;
}


// ============================================================================
// SURFACE EXTRACTION
// ============================================================================

/**
 * Extract surface voxels (solid voxels with at least one empty 6-neighbor).
 */
export function extractSurfaceVoxels(grid, resX, resY, resZ) {
    return _extractSurfaceVoxels(grid, resX, resY, resZ);
}

/**
 * Count solid voxels.
 */
export function countSolid(grid) {
    let count = 0;
    for (let i = 0; i < grid.length; i++) {
        if (grid[i]) count++;
    }
    return count;
}

/**
 * Compute volume in world units.
 */
export function computeVolume(grid, voxelSize) {
    return countSolid(grid) * voxelSize * voxelSize * voxelSize;
}

/**
 * Compute approximate surface area (count exposed faces × voxelSize²).
 */
export function computeSurfaceArea(grid, resX, resY, resZ, voxelSize) {
    let faces = 0;
    for (let z = 0; z < resZ; z++) {
        for (let y = 0; y < resY; y++) {
            for (let x = 0; x < resX; x++) {
                const idx = x + y * resX + z * resX * resY;
                if (!grid[idx]) continue;

                // Count exposed faces (6-connected)
                if (x === 0     || !grid[(x-1) + y*resX + z*resX*resY]) faces++;
                if (x === resX-1 || !grid[(x+1) + y*resX + z*resX*resY]) faces++;
                if (y === 0     || !grid[x + (y-1)*resX + z*resX*resY]) faces++;
                if (y === resY-1 || !grid[x + (y+1)*resX + z*resX*resY]) faces++;
                if (z === 0     || !grid[x + y*resX + (z-1)*resX*resY]) faces++;
                if (z === resZ-1 || !grid[x + y*resX + (z+1)*resX*resY]) faces++;
            }
        }
    }
    return faces * voxelSize * voxelSize;
}


// ============================================================================
// GRID CREATION HELPERS
// ============================================================================

/**
 * Create an empty voxel grid.
 */
export function createGrid(resX, resY, resZ) {
    return new Uint8Array(resX * resY * resZ);
}

/**
 * Create a solid sphere in a voxel grid.
 */
export function createSphere(resX, resY, resZ, cx, cy, cz, radius) {
    const grid = new Uint8Array(resX * resY * resZ);
    const r2 = radius * radius;

    for (let z = 0; z < resZ; z++) {
        for (let y = 0; y < resY; y++) {
            for (let x = 0; x < resX; x++) {
                const dx = x - cx, dy = y - cy, dz = z - cz;
                if (dx * dx + dy * dy + dz * dz <= r2) {
                    grid[x + y * resX + z * resX * resY] = 1;
                }
            }
        }
    }
    return grid;
}

/**
 * Create a solid box in a voxel grid.
 */
export function createBox(resX, resY, resZ, minX, minY, minZ, maxX, maxY, maxZ) {
    const grid = new Uint8Array(resX * resY * resZ);

    const x0 = Math.max(0, Math.floor(minX));
    const y0 = Math.max(0, Math.floor(minY));
    const z0 = Math.max(0, Math.floor(minZ));
    const x1 = Math.min(resX - 1, Math.floor(maxX));
    const y1 = Math.min(resY - 1, Math.floor(maxY));
    const z1 = Math.min(resZ - 1, Math.floor(maxZ));

    for (let z = z0; z <= z1; z++) {
        for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
                grid[x + y * resX + z * resX * resY] = 1;
            }
        }
    }
    return grid;
}


// ============================================================================
// INTERNAL HELPERS
// ============================================================================

function _extractSurfaceVoxels(grid, resX, resY, resZ) {
    const surface = new Uint8Array(grid.length);

    for (let z = 0; z < resZ; z++) {
        for (let y = 0; y < resY; y++) {
            for (let x = 0; x < resX; x++) {
                const idx = x + y * resX + z * resX * resY;
                if (!grid[idx]) continue;

                // Check 6-connected neighbors
                let isSurface = false;
                if (x === 0     || !grid[(x-1) + y*resX + z*resX*resY]) isSurface = true;
                if (x === resX-1 || !grid[(x+1) + y*resX + z*resX*resY]) isSurface = true;
                if (y === 0     || !grid[x + (y-1)*resX + z*resX*resY]) isSurface = true;
                if (y === resY-1 || !grid[x + (y+1)*resX + z*resX*resY]) isSurface = true;
                if (z === 0     || !grid[x + y*resX + (z-1)*resX*resY]) isSurface = true;
                if (z === resZ-1 || !grid[x + y*resX + (z+1)*resX*resY]) isSurface = true;

                if (isSurface) surface[idx] = 1;
            }
        }
    }
    return surface;
}

function _dilate(grid, resX, resY, resZ, radius) {
    let current = new Uint8Array(grid);

    for (let r = 0; r < radius; r++) {
        const next = new Uint8Array(current);

        for (let z = 0; z < resZ; z++) {
            for (let y = 0; y < resY; y++) {
                for (let x = 0; x < resX; x++) {
                    if (current[x + y * resX + z * resX * resY]) continue;

                    // Check 6-neighbors for any solid
                    let hasSolid = false;
                    if (x > 0     && current[(x-1) + y*resX + z*resX*resY]) hasSolid = true;
                    if (x < resX-1 && current[(x+1) + y*resX + z*resX*resY]) hasSolid = true;
                    if (y > 0     && current[x + (y-1)*resX + z*resX*resY]) hasSolid = true;
                    if (y < resY-1 && current[x + (y+1)*resX + z*resX*resY]) hasSolid = true;
                    if (z > 0     && current[x + y*resX + (z-1)*resX*resY]) hasSolid = true;
                    if (z < resZ-1 && current[x + y*resX + (z+1)*resX*resY]) hasSolid = true;

                    if (hasSolid) next[x + y * resX + z * resX * resY] = 1;
                }
            }
        }

        current = next;
    }

    return current;
}
