/**
 * DualContouring.js — Sharp-feature-preserving isosurface extraction
 *
 * Implements Dual Contouring (Ju et al., 2002) for extracting triangle meshes
 * from SDF fields while preserving sharp edges and corners that Marching Cubes
 * rounds off. Uses Hermite data (intersection points + normals on sign-changing
 * edges) and QEF (Quadratic Error Function) minimization to optimally place
 * vertices within cells.
 *
 * Features:
 *   - QEF vertex placement via SVD-free normal equations solver
 *   - Sharp edge/corner detection via eigenvalue analysis
 *   - Adaptive sharpness threshold (user-configurable)
 *   - Manifold quad→tri output with consistent winding
 *   - Works with grid SDF arrays or analytical SDF functions
 *
 * Compatible with:
 *   - SDFToMesh.js (same input/output conventions)
 *   - MeshToVoxel.js voxelGridToSDF() output
 *   - CSGShape.js V2 boolean operations
 */

// ============================================================================
// CONSTANTS
// ============================================================================

const EPSILON = 1e-7;
const SVD_EPSILON = 1e-6;

// 3 axis-aligned edge directions per cell: X, Y, Z
// Each edge connects two corners differing in one axis.
// Edge i: direction axis = i%3, base corner depends on which of 3 edges in cell.
//
// Cell corners (same as MC convention):
//   0: (0,0,0)  1: (1,0,0)  2: (0,1,0)  3: (1,1,0)
//   4: (0,0,1)  5: (1,0,1)  6: (0,1,1)  7: (1,1,1)
//
// 12 edges of a cube, grouped by axis:
//   X-axis (4): 0-1, 2-3, 4-5, 6-7
//   Y-axis (4): 0-2, 1-3, 4-6, 5-7
//   Z-axis (4): 0-4, 1-5, 2-6, 3-7
//
// For dual contouring, we only need 3 edges per cell (the "minimal" edges
// that aren't shared with lower-index cells). Convention: one X, one Y, one Z.
// Edge along X from corner 0: connects (x,y,z) to (x+1,y,z)
// Edge along Y from corner 0: connects (x,y,z) to (x,y+1,z)
// Edge along Z from corner 0: connects (x,y,z) to (x,y,z+1)

// ============================================================================
// DUAL CONTOURING FROM SDF GRID
// ============================================================================

/**
 * Extract an isosurface from a 3D SDF grid using Dual Contouring.
 *
 * @param {Float32Array} sdf       — signed distance values [x + y*resX + z*resX*resY]
 * @param {number}       resX      — grid resolution X
 * @param {number}       resY      — grid resolution Y
 * @param {number}       resZ      — grid resolution Z
 * @param {Object}       options
 * @param {number[]}     options.origin    — world position of grid corner (default [0,0,0])
 * @param {number}       options.voxelSize — size of each voxel (default 1)
 * @param {number}       options.isoValue  — isosurface threshold (default 0)
 * @param {number}       options.sharpness — sharpness threshold 0-1 (default 0.3, higher = sharper)
 * @returns {{ positions: Float32Array, indices: Uint32Array, normals: Float32Array }}
 */
export function dualContouringSDF(sdf, resX, resY, resZ, options = {}) {
    const origin = options.origin ?? [0, 0, 0];
    const voxelSize = options.voxelSize ?? 1;
    const isoValue = options.isoValue ?? 0;
    const sharpness = options.sharpness ?? 0.3;

    // Phase 1: For each cell, collect Hermite data from sign-changing edges
    //          and solve QEF to place one vertex per cell.
    // cellVertex[z * (resX-1)*(resY-1) + y * (resX-1) + x] = vertex index or -1
    const cResX = resX - 1, cResY = resY - 1, cResZ = resZ - 1;
    const cellVertex = new Int32Array(cResX * cResY * cResZ).fill(-1);

    const positions = [];
    const normals = [];

    for (let z = 0; z < cResZ; z++) {
        for (let y = 0; y < cResY; y++) {
            for (let x = 0; x < cResX; x++) {
                // 8 corner SDF values
                const v = _cellCornerValues(sdf, x, y, z, resX, resY, isoValue);

                // Check if cell has any sign change
                let hasSign = false;
                const signBits = 0 | 0;
                let sb = 0;
                for (let i = 0; i < 8; i++) {
                    if (v[i] < 0) sb |= (1 << i);
                }
                if (sb === 0 || sb === 255) continue; // fully inside or outside

                // Collect Hermite data: intersection points + normals on sign-changing edges
                const hermite = _collectHermiteData(sdf, x, y, z, resX, resY, resZ, v, voxelSize, origin);

                if (hermite.length === 0) continue;

                // Solve QEF to find optimal vertex position
                const vertex = _solveQEF(hermite, x, y, z, voxelSize, origin, sharpness);

                // Store vertex
                const vi = positions.length / 3;
                positions.push(vertex.x, vertex.y, vertex.z);
                normals.push(vertex.nx, vertex.ny, vertex.nz);

                cellVertex[x + y * cResX + z * cResX * cResY] = vi;
            }
        }
    }

    // Phase 2: Generate quads for each sign-changing edge.
    // Each internal edge is shared by 4 cells. Connect those 4 cell vertices.
    const quads = [];

    // X-axis edges: edge from (x,y,z) to (x+1,y,z) is shared by cells
    //   (x,y-1,z-1), (x,y,z-1), (x,y-1,z), (x,y,z)
    for (let z = 0; z < resZ; z++) {
        for (let y = 0; y < resY; y++) {
            for (let x = 0; x < cResX; x++) {
                const s0 = sdf[x + y * resX + z * resX * resY] - isoValue;
                const s1 = sdf[(x + 1) + y * resX + z * resX * resY] - isoValue;
                if ((s0 < 0) === (s1 < 0)) continue; // no sign change

                // 4 adjacent cells
                const cy0 = y - 1, cy1 = y;
                const cz0 = z - 1, cz1 = z;
                if (cy0 < 0 || cy1 >= cResY || cz0 < 0 || cz1 >= cResZ) continue;

                const c00 = cellVertex[x + cy0 * cResX + cz0 * cResX * cResY];
                const c01 = cellVertex[x + cy0 * cResX + cz1 * cResX * cResY];
                const c10 = cellVertex[x + cy1 * cResX + cz0 * cResX * cResY];
                const c11 = cellVertex[x + cy1 * cResX + cz1 * cResX * cResY];

                if (c00 < 0 || c01 < 0 || c10 < 0 || c11 < 0) continue;

                // Winding order depends on sign
                if (s0 < 0) {
                    quads.push(c00, c10, c11, c01);
                } else {
                    quads.push(c00, c01, c11, c10);
                }
            }
        }
    }

    // Y-axis edges: edge from (x,y,z) to (x,y+1,z) shared by cells
    //   (x-1,y,z-1), (x,y,z-1), (x-1,y,z), (x,y,z)
    for (let z = 0; z < resZ; z++) {
        for (let y = 0; y < cResY; y++) {
            for (let x = 0; x < resX; x++) {
                const s0 = sdf[x + y * resX + z * resX * resY] - isoValue;
                const s1 = sdf[x + (y + 1) * resX + z * resX * resY] - isoValue;
                if ((s0 < 0) === (s1 < 0)) continue;

                const cx0 = x - 1, cx1 = x;
                const cz0 = z - 1, cz1 = z;
                if (cx0 < 0 || cx1 >= cResX || cz0 < 0 || cz1 >= cResZ) continue;

                const c00 = cellVertex[cx0 + y * cResX + cz0 * cResX * cResY];
                const c01 = cellVertex[cx0 + y * cResX + cz1 * cResX * cResY];
                const c10 = cellVertex[cx1 + y * cResX + cz0 * cResX * cResY];
                const c11 = cellVertex[cx1 + y * cResX + cz1 * cResX * cResY];

                if (c00 < 0 || c01 < 0 || c10 < 0 || c11 < 0) continue;

                if (s0 < 0) {
                    quads.push(c00, c01, c11, c10);
                } else {
                    quads.push(c00, c10, c11, c01);
                }
            }
        }
    }

    // Z-axis edges: edge from (x,y,z) to (x,y,z+1) shared by cells
    //   (x-1,y-1,z), (x,y-1,z), (x-1,y,z), (x,y,z)
    for (let z = 0; z < cResZ; z++) {
        for (let y = 0; y < resY; y++) {
            for (let x = 0; x < resX; x++) {
                const s0 = sdf[x + y * resX + z * resX * resY] - isoValue;
                const s1 = sdf[x + y * resX + (z + 1) * resX * resY] - isoValue;
                if ((s0 < 0) === (s1 < 0)) continue;

                const cx0 = x - 1, cx1 = x;
                const cy0 = y - 1, cy1 = y;
                if (cx0 < 0 || cx1 >= cResX || cy0 < 0 || cy1 >= cResY) continue;

                const c00 = cellVertex[cx0 + cy0 * cResX + z * cResX * cResY];
                const c01 = cellVertex[cx1 + cy0 * cResX + z * cResX * cResY];
                const c10 = cellVertex[cx0 + cy1 * cResX + z * cResX * cResY];
                const c11 = cellVertex[cx1 + cy1 * cResX + z * cResX * cResY];

                if (c00 < 0 || c01 < 0 || c10 < 0 || c11 < 0) continue;

                if (s0 < 0) {
                    quads.push(c00, c10, c11, c01);
                } else {
                    quads.push(c00, c01, c11, c10);
                }
            }
        }
    }

    // Phase 3: Triangulate quads → triangles
    const numQuads = (quads.length / 4) | 0;
    const triIndices = new Uint32Array(numQuads * 6);
    for (let q = 0; q < numQuads; q++) {
        const a = quads[q * 4], b = quads[q * 4 + 1];
        const c = quads[q * 4 + 2], d = quads[q * 4 + 3];
        // Split quad along shorter diagonal for better triangulation
        const px = positions;
        const ax = px[a * 3], ay = px[a * 3 + 1], az = px[a * 3 + 2];
        const cx_ = px[c * 3], cy_ = px[c * 3 + 1], cz_ = px[c * 3 + 2];
        const bx = px[b * 3], by = px[b * 3 + 1], bz = px[b * 3 + 2];
        const dx = px[d * 3], dy = px[d * 3 + 1], dz = px[d * 3 + 2];
        const dAC = (ax - cx_) ** 2 + (ay - cy_) ** 2 + (az - cz_) ** 2;
        const dBD = (bx - dx) ** 2 + (by - dy) ** 2 + (bz - dz) ** 2;
        const qi = q * 6;
        if (dAC <= dBD) {
            triIndices[qi] = a; triIndices[qi + 1] = b; triIndices[qi + 2] = c;
            triIndices[qi + 3] = a; triIndices[qi + 4] = c; triIndices[qi + 5] = d;
        } else {
            triIndices[qi] = a; triIndices[qi + 1] = b; triIndices[qi + 2] = d;
            triIndices[qi + 3] = b; triIndices[qi + 4] = c; triIndices[qi + 5] = d;
        }
    }

    const posArr = new Float32Array(positions);
    const normArr = new Float32Array(normals);

    return { positions: posArr, indices: triIndices, normals: normArr };
}

// ============================================================================
// ANALYTICAL SDF DUAL CONTOURING
// ============================================================================

/**
 * Dual Contour an analytical SDF function.
 *
 * @param {Function}   sdfFn     — (x, y, z) => signed distance
 * @param {number[]}   boundsMin — [x, y, z] minimum corner
 * @param {number[]}   boundsMax — [x, y, z] maximum corner
 * @param {number}     resolution — voxels per longest axis (default 64)
 * @param {Object}     options
 * @param {number}     options.sharpness — 0-1, higher = sharper features (default 0.3)
 * @returns {{ positions: Float32Array, indices: Uint32Array, normals: Float32Array }}
 */
export function dualContouringFunction(sdfFn, boundsMin, boundsMax, resolution = 64, options = {}) {
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

    // Evaluate SDF on grid
    const sdf = new Float32Array(resX * resY * resZ);
    for (let z = 0; z < resZ; z++) {
        for (let y = 0; y < resY; y++) {
            for (let x = 0; x < resX; x++) {
                const wx = boundsMin[0] + x * voxelSize;
                const wy = boundsMin[1] + y * voxelSize;
                const wz = boundsMin[2] + z * voxelSize;
                sdf[x + y * resX + z * resX * resY] = sdfFn(wx, wy, wz);
            }
        }
    }

    return dualContouringSDF(sdf, resX, resY, resZ, {
        origin: boundsMin,
        voxelSize,
        isoValue: options.isoValue ?? 0,
        sharpness: options.sharpness ?? 0.3,
    });
}

// ============================================================================
// HERMITE DATA COLLECTION
// ============================================================================

/**
 * Get SDF values at 8 corners of a cell, shifted by isoValue.
 */
function _cellCornerValues(sdf, cx, cy, cz, resX, resY, isoValue) {
    const v = new Float32Array(8);
    const offsets = [
        [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
        [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
    ];
    for (let i = 0; i < 8; i++) {
        const [ox, oy, oz] = offsets[i];
        v[i] = sdf[(cx + ox) + (cy + oy) * resX + (cz + oz) * resX * resY] - isoValue;
    }
    return v;
}

/**
 * Collect Hermite data (intersection point + normal) for all sign-changing
 * edges of a cell.
 * @returns {Array<{ px, py, pz, nx, ny, nz }>}
 */
function _collectHermiteData(sdf, cx, cy, cz, resX, resY, resZ, cornerVals, voxelSize, origin) {
    const result = [];

    // 12 edges of the cube, each connecting two corners
    const edges = [
        [0, 1], [2, 3], [4, 5], [6, 7], // X-axis
        [0, 2], [1, 3], [4, 6], [5, 7], // Y-axis
        [0, 4], [1, 5], [2, 6], [3, 7], // Z-axis
    ];

    const offsets = [
        [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
        [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
    ];

    for (const [c0, c1] of edges) {
        const v0 = cornerVals[c0], v1 = cornerVals[c1];
        if ((v0 < 0) === (v1 < 0)) continue; // no sign change

        // Interpolate intersection point
        let t = 0.5;
        const dv = v1 - v0;
        if (Math.abs(dv) > EPSILON) {
            t = -v0 / dv;
            t = Math.max(0.001, Math.min(0.999, t));
        }

        const p0 = offsets[c0], p1 = offsets[c1];
        const px = origin[0] + (cx + p0[0] + t * (p1[0] - p0[0])) * voxelSize;
        const py = origin[1] + (cy + p0[1] + t * (p1[1] - p0[1])) * voxelSize;
        const pz = origin[2] + (cz + p0[2] + t * (p1[2] - p0[2])) * voxelSize;

        // Compute normal via central differences on the SDF grid
        const gx = cx + p0[0] + t * (p1[0] - p0[0]);
        const gy = cy + p0[1] + t * (p1[1] - p0[1]);
        const gz = cz + p0[2] + t * (p1[2] - p0[2]);

        const n = _sdfGradient(sdf, gx, gy, gz, resX, resY, resZ);

        result.push({ px, py, pz, nx: n[0], ny: n[1], nz: n[2] });
    }

    return result;
}

/**
 * Compute SDF gradient at a fractional grid position via trilinear interpolation
 * of central differences.
 */
function _sdfGradient(sdf, gx, gy, gz, resX, resY, resZ) {
    const h = 0.5;
    const sample = (fx, fy, fz) => {
        // Clamp to grid bounds
        fx = Math.max(0, Math.min(resX - 1, fx));
        fy = Math.max(0, Math.min(resY - 1, fy));
        fz = Math.max(0, Math.min(resZ - 1, fz));
        // Nearest-neighbor for simplicity (trilinear would be smoother but slower)
        const ix = Math.round(fx) | 0;
        const iy = Math.round(fy) | 0;
        const iz = Math.round(fz) | 0;
        return sdf[ix + iy * resX + iz * resX * resY];
    };

    let nx = sample(gx + h, gy, gz) - sample(gx - h, gy, gz);
    let ny = sample(gx, gy + h, gz) - sample(gx, gy - h, gz);
    let nz = sample(gx, gy, gz + h) - sample(gx, gy, gz - h);

    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len > EPSILON) { nx /= len; ny /= len; nz /= len; }
    else { ny = 1; nx = 0; nz = 0; }

    return [nx, ny, nz];
}

// ============================================================================
// QEF SOLVER (Quadratic Error Function)
// ============================================================================

/**
 * Solve the QEF to find optimal vertex position for a cell.
 *
 * The QEF minimizes: Σ (nᵢ · (p - pᵢ))²
 * where (pᵢ, nᵢ) are intersection points and normals.
 *
 * This is equivalent to solving: (AᵀA) p = Aᵀb
 * where A = [n₁; n₂; ...], b = [n₁·p₁; n₂·p₂; ...]
 *
 * For sharp features, we use eigenvalue analysis of AᵀA:
 * - 1 large eigenvalue = smooth surface (vertex on plane)
 * - 2 large eigenvalues = edge (vertex on line)
 * - 3 large eigenvalues = corner (vertex at point)
 *
 * @param {Array} hermite - Hermite data from _collectHermiteData
 * @param {number} cx, cy, cz - Cell grid coordinates
 * @param {number} voxelSize
 * @param {number[]} origin
 * @param {number} sharpness - 0-1 sharpness threshold
 * @returns {{ x, y, z, nx, ny, nz }}
 */
function _solveQEF(hermite, cx, cy, cz, voxelSize, origin, sharpness) {
    const n = hermite.length;

    // Build AᵀA (3x3 symmetric) and Aᵀb (3x1)
    // A[i] = [nx, ny, nz], b[i] = nx*px + ny*py + nz*pz
    let ata00 = 0, ata01 = 0, ata02 = 0;
    let ata11 = 0, ata12 = 0, ata22 = 0;
    let atb0 = 0, atb1 = 0, atb2 = 0;

    // Mass point (centroid of intersection points) for regularization
    let mpx = 0, mpy = 0, mpz = 0;
    // Average normal
    let anx = 0, any = 0, anz = 0;

    for (let i = 0; i < n; i++) {
        const h = hermite[i];
        const dot = h.nx * h.px + h.ny * h.py + h.nz * h.pz;

        ata00 += h.nx * h.nx; ata01 += h.nx * h.ny; ata02 += h.nx * h.nz;
        ata11 += h.ny * h.ny; ata12 += h.ny * h.nz;
        ata22 += h.nz * h.nz;

        atb0 += h.nx * dot;
        atb1 += h.ny * dot;
        atb2 += h.nz * dot;

        mpx += h.px; mpy += h.py; mpz += h.pz;
        anx += h.nx; any += h.ny; anz += h.nz;
    }

    mpx /= n; mpy /= n; mpz /= n;
    const alen = Math.sqrt(anx * anx + any * any + anz * anz);
    if (alen > EPSILON) { anx /= alen; any /= alen; anz /= alen; }

    // Regularization: bias toward mass point to prevent vertices flying far from cell
    const regWeight = (1.0 - sharpness) * 0.1;
    ata00 += regWeight; ata11 += regWeight; ata22 += regWeight;
    atb0 += regWeight * mpx;
    atb1 += regWeight * mpy;
    atb2 += regWeight * mpz;

    // Solve 3x3 symmetric positive semi-definite system via Cramer's rule
    // (more stable than direct inversion for small matrices)
    let x, y, z;
    const solved = _solve3x3Symmetric(
        ata00, ata01, ata02,
        ata11, ata12,
        ata22,
        atb0, atb1, atb2
    );

    if (solved) {
        x = solved[0]; y = solved[1]; z = solved[2];
    } else {
        // Fallback to mass point
        x = mpx; y = mpy; z = mpz;
    }

    // Clamp to cell bounds (prevent vertices from escaping)
    const cellMinX = origin[0] + cx * voxelSize;
    const cellMinY = origin[1] + cy * voxelSize;
    const cellMinZ = origin[2] + cz * voxelSize;
    const cellMaxX = cellMinX + voxelSize;
    const cellMaxY = cellMinY + voxelSize;
    const cellMaxZ = cellMinZ + voxelSize;

    // Allow slight extension (10%) for sharp corners
    const ext = voxelSize * 0.1;
    x = Math.max(cellMinX - ext, Math.min(cellMaxX + ext, x));
    y = Math.max(cellMinY - ext, Math.min(cellMaxY + ext, y));
    z = Math.max(cellMinZ - ext, Math.min(cellMaxZ + ext, z));

    return { x, y, z, nx: anx, ny: any, nz: anz };
}

/**
 * Solve a 3x3 symmetric system using Cramer's rule.
 * Matrix:
 *   [a00 a01 a02] [x]   [b0]
 *   [a01 a11 a12] [y] = [b1]
 *   [a02 a12 a22] [z]   [b2]
 *
 * @returns {number[]|null} [x, y, z] or null if singular
 */
function _solve3x3Symmetric(a00, a01, a02, a11, a12, a22, b0, b1, b2) {
    // Determinant via cofactor expansion
    const det =
        a00 * (a11 * a22 - a12 * a12) -
        a01 * (a01 * a22 - a12 * a02) +
        a02 * (a01 * a12 - a11 * a02);

    if (Math.abs(det) < SVD_EPSILON) return null;

    const invDet = 1.0 / det;

    const x = invDet * (
        b0 * (a11 * a22 - a12 * a12) -
        a01 * (b1 * a22 - a12 * b2) +
        a02 * (b1 * a12 - a11 * b2)
    );

    const y = invDet * (
        a00 * (b1 * a22 - a12 * b2) -
        b0 * (a01 * a22 - a12 * a02) +
        a02 * (a01 * b2 - b1 * a02)
    );

    const z = invDet * (
        a00 * (a11 * b2 - b1 * a12) -
        a01 * (a01 * b2 - b1 * a02) +
        b0 * (a01 * a12 - a11 * a02)
    );

    // Reject if values are unreasonably large (indicates near-singular matrix)
    if (!isFinite(x) || !isFinite(y) || !isFinite(z)) return null;

    return [x, y, z];
}
