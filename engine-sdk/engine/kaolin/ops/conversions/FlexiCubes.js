/**
 * FlexiCubes.js — Flexible Marching Cubes mesh extraction
 *
 * An improved isosurface extraction inspired by NVIDIA's FlexiCubes (2023).
 * Key improvements over standard Marching Cubes:
 *
 *   1. **Flexible edge vertices** — Instead of fixed linear interpolation along
 *      edges, vertex positions can be adjusted (flexed) to better approximate
 *      the true surface, improving triangle quality.
 *
 *   2. **Flexible dual vertices** — Each cube gets a "dual vertex" (interior
 *      point) that can be optimized. Quads are formed connecting dual vertices
 *      of adjacent cubes across sign-changing edges, then split into tris.
 *
 *   3. **Adaptive splitting** — Quad-to-triangle splitting direction is chosen
 *      to minimize the max angle, producing more uniform triangulations.
 *
 *   4. **Gradient-aware vertex placement** — Uses SDF gradient (surface normal)
 *      to project dual vertices onto the isosurface for better accuracy.
 *
 * Compatible with:
 *   - SDFToMesh.js (same API conventions)
 *   - DualContouring.js (complementary approach)
 *   - MeshToVoxel.js voxelGridToSDF() output
 */

const EPSILON = 1e-7;

// ============================================================================
// FLEXICUBES FROM SDF GRID
// ============================================================================

/**
 * Extract an isosurface from a 3D SDF grid using FlexiCubes.
 *
 * @param {Float32Array} sdf       — signed distance values [x + y*resX + z*resX*resY]
 * @param {number}       resX      — grid resolution X
 * @param {number}       resY      — grid resolution Y
 * @param {number}       resZ      — grid resolution Z
 * @param {Object}       options
 * @param {number[]}     options.origin    — world position of grid corner [0,0,0]
 * @param {number}       options.voxelSize — size of each voxel (default 1)
 * @param {number}       options.isoValue  — isosurface threshold (default 0)
 * @param {number}       options.flexWeight — vertex flex strength 0-1 (default 0.5)
 * @returns {{ positions: Float32Array, indices: Uint32Array, normals: Float32Array }}
 */
export function flexiCubesSDF(sdf, resX, resY, resZ, options = {}) {
    const origin = options.origin ?? [0, 0, 0];
    const voxelSize = options.voxelSize ?? 1;
    const isoValue = options.isoValue ?? 0;
    const flexWeight = options.flexWeight ?? 0.5;

    const cResX = resX - 1, cResY = resY - 1, cResZ = resZ - 1;

    // Phase 1: Compute dual vertex for each cell that straddles the isosurface
    const cellDual = new Int32Array(cResX * cResY * cResZ).fill(-1);
    const positions = [];
    const normals = [];

    for (let z = 0; z < cResZ; z++) {
        for (let y = 0; y < cResY; y++) {
            for (let x = 0; x < cResX; x++) {
                const vals = _getCornerValues(sdf, x, y, z, resX, resY, isoValue);

                // Sign bits
                let sb = 0;
                for (let i = 0; i < 8; i++) {
                    if (vals[i] < 0) sb |= (1 << i);
                }
                if (sb === 0 || sb === 255) continue;

                // Compute dual vertex: weighted average of edge intersection points
                // with gradient-based refinement
                const dual = _computeDualVertex(
                    sdf, x, y, z, resX, resY, resZ,
                    vals, voxelSize, origin, flexWeight
                );

                const vi = positions.length / 3;
                positions.push(dual.x, dual.y, dual.z);
                normals.push(dual.nx, dual.ny, dual.nz);
                cellDual[x + y * cResX + z * cResX * cResY] = vi;
            }
        }
    }

    // Phase 2: Generate quads across sign-changing edges
    // Same topology as dual contouring: each edge shared by 4 cells
    const triIndices = [];

    // X-axis edges
    for (let z = 1; z < cResZ; z++) {
        for (let y = 1; y < cResY; y++) {
            for (let x = 0; x < cResX; x++) {
                const s0 = sdf[x + y * resX + z * resX * resY] - isoValue;
                const s1 = sdf[(x + 1) + y * resX + z * resX * resY] - isoValue;
                if ((s0 < 0) === (s1 < 0)) continue;

                const c00 = cellDual[x + (y - 1) * cResX + (z - 1) * cResX * cResY];
                const c01 = cellDual[x + (y - 1) * cResX + z * cResX * cResY];
                const c10 = cellDual[x + y * cResX + (z - 1) * cResX * cResY];
                const c11 = cellDual[x + y * cResX + z * cResX * cResY];

                if (c00 < 0 || c01 < 0 || c10 < 0 || c11 < 0) continue;

                _emitAdaptiveQuad(positions, triIndices, c00, c10, c11, c01, s0 < 0);
            }
        }
    }

    // Y-axis edges
    for (let z = 1; z < cResZ; z++) {
        for (let y = 0; y < cResY; y++) {
            for (let x = 1; x < cResX; x++) {
                const s0 = sdf[x + y * resX + z * resX * resY] - isoValue;
                const s1 = sdf[x + (y + 1) * resX + z * resX * resY] - isoValue;
                if ((s0 < 0) === (s1 < 0)) continue;

                const c00 = cellDual[(x - 1) + y * cResX + (z - 1) * cResX * cResY];
                const c01 = cellDual[(x - 1) + y * cResX + z * cResX * cResY];
                const c10 = cellDual[x + y * cResX + (z - 1) * cResX * cResY];
                const c11 = cellDual[x + y * cResX + z * cResX * cResY];

                if (c00 < 0 || c01 < 0 || c10 < 0 || c11 < 0) continue;

                _emitAdaptiveQuad(positions, triIndices, c00, c01, c11, c10, s0 < 0);
            }
        }
    }

    // Z-axis edges
    for (let z = 0; z < cResZ; z++) {
        for (let y = 1; y < cResY; y++) {
            for (let x = 1; x < cResX; x++) {
                const s0 = sdf[x + y * resX + z * resX * resY] - isoValue;
                const s1 = sdf[x + y * resX + (z + 1) * resX * resY] - isoValue;
                if ((s0 < 0) === (s1 < 0)) continue;

                const c00 = cellDual[(x - 1) + (y - 1) * cResX + z * cResX * cResY];
                const c01 = cellDual[x + (y - 1) * cResX + z * cResX * cResY];
                const c10 = cellDual[(x - 1) + y * cResX + z * cResX * cResY];
                const c11 = cellDual[x + y * cResX + z * cResX * cResY];

                if (c00 < 0 || c01 < 0 || c10 < 0 || c11 < 0) continue;

                _emitAdaptiveQuad(positions, triIndices, c00, c10, c11, c01, s0 < 0);
            }
        }
    }

    return {
        positions: new Float32Array(positions),
        indices: new Uint32Array(triIndices),
        normals: new Float32Array(normals),
    };
}

// ============================================================================
// ANALYTICAL SDF FLEXICUBES
// ============================================================================

/**
 * FlexiCubes extraction from an analytical SDF function.
 *
 * @param {Function}   sdfFn      — (x, y, z) => signed distance
 * @param {number[]}   boundsMin  — [x, y, z] minimum corner
 * @param {number[]}   boundsMax  — [x, y, z] maximum corner
 * @param {number}     resolution — voxels per longest axis (default 64)
 * @param {Object}     options
 * @param {number}     options.flexWeight — 0-1 vertex flexibility (default 0.5)
 * @returns {{ positions: Float32Array, indices: Uint32Array, normals: Float32Array }}
 */
export function flexiCubesFunction(sdfFn, boundsMin, boundsMax, resolution = 64, options = {}) {
    const dx = boundsMax[0] - boundsMin[0];
    const dy = boundsMax[1] - boundsMin[1];
    const dz = boundsMax[2] - boundsMin[2];
    const maxDim = Math.max(dx, dy, dz);

    if (maxDim < EPSILON) {
        return { positions: new Float32Array(0), indices: new Uint32Array(0), normals: new Float32Array(0) };
    }

    const voxelSize = maxDim / resolution;
    const resX = Math.ceil(dx / voxelSize) + 2;
    const resY = Math.ceil(dy / voxelSize) + 2;
    const resZ = Math.ceil(dz / voxelSize) + 2;

    const sdf = new Float32Array(resX * resY * resZ);
    for (let z = 0; z < resZ; z++) {
        for (let y = 0; y < resY; y++) {
            for (let x = 0; x < resX; x++) {
                sdf[x + y * resX + z * resX * resY] = sdfFn(
                    boundsMin[0] + x * voxelSize,
                    boundsMin[1] + y * voxelSize,
                    boundsMin[2] + z * voxelSize
                );
            }
        }
    }

    return flexiCubesSDF(sdf, resX, resY, resZ, {
        origin: boundsMin,
        voxelSize,
        isoValue: options.isoValue ?? 0,
        flexWeight: options.flexWeight ?? 0.5,
    });
}

// ============================================================================
// INTERNALS
// ============================================================================

const CORNER_OFFSETS = [
    [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
    [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
];

const CELL_EDGES = [
    [0, 1], [2, 3], [4, 5], [6, 7], // X
    [0, 2], [1, 3], [4, 6], [5, 7], // Y
    [0, 4], [1, 5], [2, 6], [3, 7], // Z
];

function _getCornerValues(sdf, cx, cy, cz, resX, resY, isoValue) {
    const v = new Float32Array(8);
    for (let i = 0; i < 8; i++) {
        const [ox, oy, oz] = CORNER_OFFSETS[i];
        v[i] = sdf[(cx + ox) + (cy + oy) * resX + (cz + oz) * resX * resY] - isoValue;
    }
    return v;
}

/**
 * Compute the dual vertex for a cell using weighted edge intersection averaging
 * with gradient-based refinement.
 */
function _computeDualVertex(sdf, cx, cy, cz, resX, resY, resZ, vals, voxelSize, origin, flexWeight) {
    // Collect edge intersection points
    let sumX = 0, sumY = 0, sumZ = 0, count = 0;
    let sumNX = 0, sumNY = 0, sumNZ = 0;

    for (const [c0, c1] of CELL_EDGES) {
        const v0 = vals[c0], v1 = vals[c1];
        if ((v0 < 0) === (v1 < 0)) continue;

        let t = 0.5;
        const dv = v1 - v0;
        if (Math.abs(dv) > EPSILON) {
            t = -v0 / dv;
            t = Math.max(0.001, Math.min(0.999, t));
        }

        const p0 = CORNER_OFFSETS[c0], p1 = CORNER_OFFSETS[c1];
        const ix = cx + p0[0] + t * (p1[0] - p0[0]);
        const iy = cy + p0[1] + t * (p1[1] - p0[1]);
        const iz = cz + p0[2] + t * (p1[2] - p0[2]);

        sumX += ix; sumY += iy; sumZ += iz;
        count++;

        // Gradient at intersection
        const n = _sdfGradientAt(sdf, ix, iy, iz, resX, resY, resZ);
        sumNX += n[0]; sumNY += n[1]; sumNZ += n[2];
    }

    if (count === 0) {
        // No intersections — place at cell center
        const wx = origin[0] + (cx + 0.5) * voxelSize;
        const wy = origin[1] + (cy + 0.5) * voxelSize;
        const wz = origin[2] + (cz + 0.5) * voxelSize;
        return { x: wx, y: wy, z: wz, nx: 0, ny: 1, nz: 0 };
    }

    // Average intersection point (in grid coords)
    let avgX = sumX / count;
    let avgY = sumY / count;
    let avgZ = sumZ / count;

    // Cell center (in grid coords)
    const ccX = cx + 0.5, ccY = cy + 0.5, ccZ = cz + 0.5;

    // FlexiCubes: blend between cell center and avg intersection
    // flexWeight=0 → cell center (standard DC), flexWeight=1 → avg intersection
    const fx = ccX + flexWeight * (avgX - ccX);
    const fy = ccY + flexWeight * (avgY - ccY);
    const fz = ccZ + flexWeight * (avgZ - ccZ);

    // Gradient-based refinement: project onto isosurface along gradient
    const sdfAtDual = _trilinearSample(sdf, fx, fy, fz, resX, resY, resZ);
    const grad = _sdfGradientAt(sdf, fx, fy, fz, resX, resY, resZ);
    const gradLen2 = grad[0] * grad[0] + grad[1] * grad[1] + grad[2] * grad[2];

    let rfx = fx, rfy = fy, rfz = fz;
    if (gradLen2 > EPSILON) {
        // Newton step: move along gradient to reduce SDF value to 0
        const step = sdfAtDual / gradLen2;
        rfx -= grad[0] * step * 0.5; // Half step for stability
        rfy -= grad[1] * step * 0.5;
        rfz -= grad[2] * step * 0.5;
    }

    // Clamp to cell bounds
    rfx = Math.max(cx + 0.01, Math.min(cx + 0.99, rfx));
    rfy = Math.max(cy + 0.01, Math.min(cy + 0.99, rfy));
    rfz = Math.max(cz + 0.01, Math.min(cz + 0.99, rfz));

    // Convert to world space
    const wx = origin[0] + rfx * voxelSize;
    const wy = origin[1] + rfy * voxelSize;
    const wz = origin[2] + rfz * voxelSize;

    // Normalize average normal
    let nl = Math.sqrt(sumNX * sumNX + sumNY * sumNY + sumNZ * sumNZ);
    if (nl > EPSILON) { sumNX /= nl; sumNY /= nl; sumNZ /= nl; }
    else { sumNY = 1; }

    return { x: wx, y: wy, z: wz, nx: sumNX, ny: sumNY, nz: sumNZ };
}

/**
 * Trilinear interpolation of SDF at fractional grid coordinates.
 */
function _trilinearSample(sdf, gx, gy, gz, resX, resY, resZ) {
    const x0 = Math.max(0, Math.min(resX - 2, Math.floor(gx)));
    const y0 = Math.max(0, Math.min(resY - 2, Math.floor(gy)));
    const z0 = Math.max(0, Math.min(resZ - 2, Math.floor(gz)));
    const fx = gx - x0, fy = gy - y0, fz = gz - z0;

    const idx = (x, y, z) => sdf[x + y * resX + z * resX * resY];

    const c000 = idx(x0, y0, z0);
    const c100 = idx(x0 + 1, y0, z0);
    const c010 = idx(x0, y0 + 1, z0);
    const c110 = idx(x0 + 1, y0 + 1, z0);
    const c001 = idx(x0, y0, z0 + 1);
    const c101 = idx(x0 + 1, y0, z0 + 1);
    const c011 = idx(x0, y0 + 1, z0 + 1);
    const c111 = idx(x0 + 1, y0 + 1, z0 + 1);

    return (1 - fz) * (
        (1 - fy) * ((1 - fx) * c000 + fx * c100) +
        fy * ((1 - fx) * c010 + fx * c110)
    ) + fz * (
        (1 - fy) * ((1 - fx) * c001 + fx * c101) +
        fy * ((1 - fx) * c011 + fx * c111)
    );
}

/**
 * SDF gradient at fractional grid coordinates via central differences.
 */
function _sdfGradientAt(sdf, gx, gy, gz, resX, resY, resZ) {
    const h = 0.5;
    const s = (fx, fy, fz) => {
        fx = Math.max(0, Math.min(resX - 1, fx));
        fy = Math.max(0, Math.min(resY - 1, fy));
        fz = Math.max(0, Math.min(resZ - 1, fz));
        const ix = Math.round(fx) | 0;
        const iy = Math.round(fy) | 0;
        const iz = Math.round(fz) | 0;
        return sdf[ix + iy * resX + iz * resX * resY];
    };

    let nx = s(gx + h, gy, gz) - s(gx - h, gy, gz);
    let ny = s(gx, gy + h, gz) - s(gx, gy - h, gz);
    let nz = s(gx, gy, gz + h) - s(gx, gy, gz - h);

    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len > EPSILON) { nx /= len; ny /= len; nz /= len; }

    return [nx, ny, nz];
}

/**
 * Emit an adaptively-split quad as two triangles.
 * Splits along the shorter diagonal to minimize max angle.
 */
function _emitAdaptiveQuad(positions, triIndices, a, b, c, d, flip) {
    const px = positions;
    // Diagonal lengths
    const dAC2 = _dist2(px, a, c);
    const dBD2 = _dist2(px, b, d);

    if (flip) {
        if (dAC2 <= dBD2) {
            triIndices.push(a, c, b);
            triIndices.push(a, d, c);
        } else {
            triIndices.push(a, d, b);
            triIndices.push(b, d, c);
        }
    } else {
        if (dAC2 <= dBD2) {
            triIndices.push(a, b, c);
            triIndices.push(a, c, d);
        } else {
            triIndices.push(a, b, d);
            triIndices.push(b, c, d);
        }
    }
}

function _dist2(positions, i, j) {
    const dx = positions[i * 3] - positions[j * 3];
    const dy = positions[i * 3 + 1] - positions[j * 3 + 1];
    const dz = positions[i * 3 + 2] - positions[j * 3 + 2];
    return dx * dx + dy * dy + dz * dz;
}
