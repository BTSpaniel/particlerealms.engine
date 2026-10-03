/**
 * SDFToMesh.js — Extract triangle mesh from a Signed Distance Field
 *
 * Converts a 3D SDF volume (Float32Array grid) into a triangle mesh
 * using Marching Cubes. This is the CPU path for Kaolin conversions;
 * for GPU-accelerated MC see engine/voxel/MarchingCubesMesher.js.
 *
 * Also supports evaluating analytical SDF functions directly.
 *
 * Compatible with:
 *   - MeshToVoxel.js voxelGridToSDF() output
 *   - MeshSDFGenerator.js baked SDF textures
 *   - SDFCollision.js primitives
 *   - FlexiCubes (future Phase 3+)
 */

// ============================================================================
// CONSTANTS
// ============================================================================

const EPSILON = 1e-7;

// ============================================================================
// SDF GRID TO MESH
// ============================================================================

/**
 * Extract an isosurface from a 3D SDF grid using Marching Cubes.
 *
 * @param {Float32Array} sdf     — signed distance values, indexed [x + y*resX + z*resX*resY]
 * @param {number}       resX    — grid resolution X
 * @param {number}       resY    — grid resolution Y
 * @param {number}       resZ    — grid resolution Z
 * @param {Object}       options
 * @param {Float32Array} options.origin   — world position of grid corner (default [0,0,0])
 * @param {number}       options.voxelSize — size of each voxel (default 1)
 * @param {number}       options.isoValue  — isosurface threshold (default 0)
 * @returns {{ positions: Float32Array, indices: Uint32Array, normals: Float32Array }}
 */
export function sdfToMesh(sdf, resX, resY, resZ, options = {}) {
    const origin = options.origin ?? new Float32Array(3);
    const voxelSize = options.voxelSize ?? 1;
    const isoValue = options.isoValue ?? 0;

    const vertices = [];
    const triangles = [];

    // Edge-vertex cache to avoid duplicates (key: edge index → vertex index)
    const edgeCache = new Map();

    for (let z = 0; z < resZ - 1; z++) {
        for (let y = 0; y < resY - 1; y++) {
            for (let x = 0; x < resX - 1; x++) {
                // 8 corner values
                const vals = [
                    sdf[x     + y       * resX + z       * resX * resY] - isoValue,
                    sdf[(x+1) + y       * resX + z       * resX * resY] - isoValue,
                    sdf[(x+1) + (y+1)   * resX + z       * resX * resY] - isoValue,
                    sdf[x     + (y+1)   * resX + z       * resX * resY] - isoValue,
                    sdf[x     + y       * resX + (z+1)   * resX * resY] - isoValue,
                    sdf[(x+1) + y       * resX + (z+1)   * resX * resY] - isoValue,
                    sdf[(x+1) + (y+1)   * resX + (z+1)   * resX * resY] - isoValue,
                    sdf[x     + (y+1)   * resX + (z+1)   * resX * resY] - isoValue,
                ];

                // Cube index
                let cubeIdx = 0;
                for (let i = 0; i < 8; i++) {
                    if (vals[i] < 0) cubeIdx |= (1 << i);
                }

                if (cubeIdx === 0 || cubeIdx === 255) continue;

                const edgeFlags = EDGE_TABLE[cubeIdx];
                if (edgeFlags === 0) continue;

                // Corner positions
                const corners = [
                    [x,     y,     z    ],
                    [x + 1, y,     z    ],
                    [x + 1, y + 1, z    ],
                    [x,     y + 1, z    ],
                    [x,     y,     z + 1],
                    [x + 1, y,     z + 1],
                    [x + 1, y + 1, z + 1],
                    [x,     y + 1, z + 1],
                ];

                // Interpolate vertices along active edges
                const edgeVerts = new Array(12);

                for (let e = 0; e < 12; e++) {
                    if (!(edgeFlags & (1 << e))) continue;

                    const [c0, c1] = EDGE_CORNERS[e];
                    const v0 = vals[c0], v1 = vals[c1];

                    // Edge key for deduplication
                    const p0 = corners[c0], p1 = corners[c1];
                    const key = _edgeKey(
                        x + p0[0], y + p0[1], z + p0[2],
                        x + p1[0], y + p1[1], z + p1[2],
                        resX, resY
                    );

                    if (edgeCache.has(key)) {
                        edgeVerts[e] = edgeCache.get(key);
                    } else {
                        // Linear interpolation
                        let t = 0.5;
                        const dv = v1 - v0;
                        if (Math.abs(dv) > EPSILON) {
                            t = -v0 / dv;
                            t = Math.max(0, Math.min(1, t));
                        }

                        const vx = origin[0] + (p0[0] + t * (p1[0] - p0[0])) * voxelSize;
                        const vy = origin[1] + (p0[1] + t * (p1[1] - p0[1])) * voxelSize;
                        const vz = origin[2] + (p0[2] + t * (p1[2] - p0[2])) * voxelSize;

                        const vi = vertices.length / 3;
                        vertices.push(vx, vy, vz);
                        edgeVerts[e] = vi;
                        edgeCache.set(key, vi);
                    }
                }

                // Generate triangles
                const triRow = TRI_TABLE[cubeIdx];
                for (let t = 0; t < triRow.length; t += 3) {
                    triangles.push(
                        edgeVerts[triRow[t]],
                        edgeVerts[triRow[t + 1]],
                        edgeVerts[triRow[t + 2]]
                    );
                }
            }
        }
    }

    const positions = new Float32Array(vertices);
    const indices = new Uint32Array(triangles);

    // Compute normals from gradient of SDF
    const normals = _computeSDFNormals(positions, sdf, resX, resY, resZ, origin, voxelSize);

    return { positions, indices, normals };
}


// ============================================================================
// ANALYTICAL SDF TO MESH
// ============================================================================

/**
 * Mesh an analytical SDF function by evaluating it on a grid.
 *
 * @param {Function}     sdfFn    — (x, y, z) => signed distance
 * @param {Float32Array} boundsMin — [x, y, z] minimum corner
 * @param {Float32Array} boundsMax — [x, y, z] maximum corner
 * @param {number}       resolution — voxels per longest axis (default 64)
 * @param {Object}       options
 * @param {number}       options.isoValue — threshold (default 0)
 * @returns {{ positions: Float32Array, indices: Uint32Array, normals: Float32Array }}
 */
export function sdfFunctionToMesh(sdfFn, boundsMin, boundsMax, resolution = 64, options = {}) {
    const dx = boundsMax[0] - boundsMin[0];
    const dy = boundsMax[1] - boundsMin[1];
    const dz = boundsMax[2] - boundsMin[2];
    const maxDim = Math.max(dx, dy, dz);

    if (maxDim < EPSILON) {
        return { positions: new Float32Array(0), indices: new Uint32Array(0), normals: new Float32Array(0) };
    }

    const voxelSize = maxDim / resolution;
    const resX = Math.ceil(dx / voxelSize) + 1;
    const resY = Math.ceil(dy / voxelSize) + 1;
    const resZ = Math.ceil(dz / voxelSize) + 1;

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

    return sdfToMesh(sdf, resX, resY, resZ, {
        origin: new Float32Array([boundsMin[0], boundsMin[1], boundsMin[2]]),
        voxelSize,
        isoValue: options.isoValue ?? 0,
    });
}


/**
 * Mesh a CSG combination of SDF primitives.
 * Accepts an array of { sdf: fn(x,y,z), op: 'union'|'subtract'|'intersect' }.
 *
 * @param {Array}        ops        — [{ sdf: Function, op: string }]
 * @param {Float32Array} boundsMin
 * @param {Float32Array} boundsMax
 * @param {number}       resolution
 * @returns {{ positions: Float32Array, indices: Uint32Array, normals: Float32Array }}
 */
export function sdfCSGToMesh(ops, boundsMin, boundsMax, resolution = 64) {
    if (!ops || ops.length === 0) {
        return { positions: new Float32Array(0), indices: new Uint32Array(0), normals: new Float32Array(0) };
    }

    const combined = (x, y, z) => {
        let d = ops[0].sdf(x, y, z);
        for (let i = 1; i < ops.length; i++) {
            const d2 = ops[i].sdf(x, y, z);
            switch (ops[i].op) {
                case 'subtract':   d = Math.max(d, -d2); break;
                case 'intersect':  d = Math.max(d, d2);  break;
                case 'union':
                default:           d = Math.min(d, d2);  break;
            }
        }
        return d;
    };

    return sdfFunctionToMesh(combined, boundsMin, boundsMax, resolution);
}


// ============================================================================
// SDF PRIMITIVE HELPERS
// ============================================================================

/** Sphere SDF centered at origin */
export function sdfSphere(radius) {
    return (x, y, z) => Math.sqrt(x * x + y * y + z * z) - radius;
}

/** Box SDF centered at origin */
export function sdfBox(halfX, halfY, halfZ) {
    return (x, y, z) => {
        const dx = Math.abs(x) - halfX;
        const dy = Math.abs(y) - halfY;
        const dz = Math.abs(z) - halfZ;
        const outside = Math.sqrt(
            Math.max(dx, 0) ** 2 + Math.max(dy, 0) ** 2 + Math.max(dz, 0) ** 2
        );
        const inside = Math.min(Math.max(dx, dy, dz), 0);
        return outside + inside;
    };
}

/** Torus SDF centered at origin, in XZ plane */
export function sdfTorus(majorR, minorR) {
    return (x, y, z) => {
        const q = Math.sqrt(x * x + z * z) - majorR;
        return Math.sqrt(q * q + y * y) - minorR;
    };
}

/** Cylinder SDF centered at origin, along Y axis */
export function sdfCylinder(radius, halfHeight) {
    return (x, y, z) => {
        const d = Math.sqrt(x * x + z * z) - radius;
        const h = Math.abs(y) - halfHeight;
        return Math.min(Math.max(d, h), 0) + Math.sqrt(Math.max(d, 0) ** 2 + Math.max(h, 0) ** 2);
    };
}

/** Translate an SDF function */
export function sdfTranslate(sdfFn, tx, ty, tz) {
    return (x, y, z) => sdfFn(x - tx, y - ty, z - tz);
}

/** Smooth union of two SDF functions */
export function sdfSmoothUnion(sdfA, sdfB, k) {
    return (x, y, z) => {
        const a = sdfA(x, y, z);
        const b = sdfB(x, y, z);
        const h = Math.max(k - Math.abs(a - b), 0) / k;
        return Math.min(a, b) - h * h * k * 0.25;
    };
}


// ============================================================================
// NORMALS FROM SDF GRADIENT
// ============================================================================

function _computeSDFNormals(positions, sdf, resX, resY, resZ, origin, voxelSize) {
    const numVerts = (positions.length / 3) | 0;
    const normals = new Float32Array(numVerts * 3);
    const invVoxel = 1 / voxelSize;

    for (let i = 0; i < numVerts; i++) {
        const wx = positions[i * 3];
        const wy = positions[i * 3 + 1];
        const wz = positions[i * 3 + 2];

        // Grid-space coordinates
        const gx = (wx - origin[0]) * invVoxel;
        const gy = (wy - origin[1]) * invVoxel;
        const gz = (wz - origin[2]) * invVoxel;

        // Central difference gradient
        const h = 0.5;
        const nx = _sampleSDF(sdf, resX, resY, resZ, gx + h, gy, gz) -
                   _sampleSDF(sdf, resX, resY, resZ, gx - h, gy, gz);
        const ny = _sampleSDF(sdf, resX, resY, resZ, gx, gy + h, gz) -
                   _sampleSDF(sdf, resX, resY, resZ, gx, gy - h, gz);
        const nz = _sampleSDF(sdf, resX, resY, resZ, gx, gy, gz + h) -
                   _sampleSDF(sdf, resX, resY, resZ, gx, gy, gz - h);

        const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
        if (len > EPSILON) {
            normals[i * 3]     = nx / len;
            normals[i * 3 + 1] = ny / len;
            normals[i * 3 + 2] = nz / len;
        } else {
            normals[i * 3 + 1] = 1; // fallback up
        }
    }

    return normals;
}

function _sampleSDF(sdf, resX, resY, resZ, gx, gy, gz) {
    // Trilinear interpolation
    const x0 = Math.max(0, Math.min(resX - 2, Math.floor(gx)));
    const y0 = Math.max(0, Math.min(resY - 2, Math.floor(gy)));
    const z0 = Math.max(0, Math.min(resZ - 2, Math.floor(gz)));
    const x1 = x0 + 1, y1 = y0 + 1, z1 = z0 + 1;
    const fx = gx - x0, fy = gy - y0, fz = gz - z0;

    const c000 = sdf[x0 + y0 * resX + z0 * resX * resY];
    const c100 = sdf[x1 + y0 * resX + z0 * resX * resY];
    const c010 = sdf[x0 + y1 * resX + z0 * resX * resY];
    const c110 = sdf[x1 + y1 * resX + z0 * resX * resY];
    const c001 = sdf[x0 + y0 * resX + z1 * resX * resY];
    const c101 = sdf[x1 + y0 * resX + z1 * resX * resY];
    const c011 = sdf[x0 + y1 * resX + z1 * resX * resY];
    const c111 = sdf[x1 + y1 * resX + z1 * resX * resY];

    return c000 * (1 - fx) * (1 - fy) * (1 - fz) +
           c100 * fx * (1 - fy) * (1 - fz) +
           c010 * (1 - fx) * fy * (1 - fz) +
           c110 * fx * fy * (1 - fz) +
           c001 * (1 - fx) * (1 - fy) * fz +
           c101 * fx * (1 - fy) * fz +
           c011 * (1 - fx) * fy * fz +
           c111 * fx * fy * fz;
}


// ============================================================================
// EDGE KEY HELPER
// ============================================================================

function _edgeKey(x0, y0, z0, x1, y1, z1, resX, resY) {
    // Canonical ordering
    const a = x0 + y0 * (resX + 1) + z0 * (resX + 1) * (resY + 1);
    const b = x1 + y1 * (resX + 1) + z1 * (resX + 1) * (resY + 1);
    return a < b ? a * 1000000 + b : b * 1000000 + a;
}


// ============================================================================
// MARCHING CUBES TABLES (standard 256-entry)
// ============================================================================

const EDGE_TABLE = new Uint16Array([
    0x000, 0x109, 0x203, 0x30a, 0x406, 0x50f, 0x605, 0x70c,
    0x80c, 0x905, 0xa0f, 0xb06, 0xc0a, 0xd03, 0xe09, 0xf00,
    0x190, 0x099, 0x393, 0x29a, 0x596, 0x49f, 0x795, 0x69c,
    0x99c, 0x895, 0xb9f, 0xa96, 0xd9a, 0xc93, 0xf99, 0xe90,
    0x230, 0x339, 0x033, 0x13a, 0x636, 0x73f, 0x435, 0x53c,
    0xa3c, 0xb35, 0x83f, 0x936, 0xe3a, 0xf33, 0xc39, 0xd30,
    0x3a0, 0x2a9, 0x1a3, 0x0aa, 0x7a6, 0x6af, 0x5a5, 0x4ac,
    0xbac, 0xaa5, 0x9af, 0x8a6, 0xfaa, 0xea3, 0xda9, 0xca0,
    0x460, 0x569, 0x663, 0x76a, 0x066, 0x16f, 0x265, 0x36c,
    0xc6c, 0xd65, 0xe6f, 0xf66, 0x86a, 0x963, 0xa69, 0xb60,
    0x5f0, 0x4f9, 0x7f3, 0x6fa, 0x1f6, 0x0ff, 0x3f5, 0x2fc,
    0xdfc, 0xcf5, 0xfff, 0xef6, 0x9fa, 0x8f3, 0xbf9, 0xaf0,
    0x650, 0x759, 0x453, 0x55a, 0x256, 0x35f, 0x055, 0x15c,
    0xe5c, 0xf55, 0xc5f, 0xd56, 0xa5a, 0xb53, 0x859, 0x950,
    0x7c0, 0x6c9, 0x5c3, 0x4ca, 0x3c6, 0x2cf, 0x1c5, 0x0cc,
    0xfcc, 0xec5, 0xdcf, 0xcc6, 0xbca, 0xac3, 0x9c9, 0x8c0,
    0x8c0, 0x9c9, 0xac3, 0xbca, 0xcc6, 0xdcf, 0xec5, 0xfcc,
    0x0cc, 0x1c5, 0x2cf, 0x3c6, 0x4ca, 0x5c3, 0x6c9, 0x7c0,
    0x950, 0x859, 0xb53, 0xa5a, 0xd56, 0xc5f, 0xf55, 0xe5c,
    0x15c, 0x055, 0x35f, 0x256, 0x55a, 0x453, 0x759, 0x650,
    0xaf0, 0xbf9, 0x8f3, 0x9fa, 0xef6, 0xfff, 0xcf5, 0xdfc,
    0x2fc, 0x3f5, 0x0ff, 0x1f6, 0x6fa, 0x7f3, 0x4f9, 0x5f0,
    0xb60, 0xa69, 0x963, 0x86a, 0xf66, 0xe6f, 0xd65, 0xc6c,
    0x36c, 0x265, 0x16f, 0x066, 0x76a, 0x663, 0x569, 0x460,
    0xca0, 0xda9, 0xea3, 0xfaa, 0x8a6, 0x9af, 0xaa5, 0xbac,
    0x4ac, 0x5a5, 0x6af, 0x7a6, 0x0aa, 0x1a3, 0x2a9, 0x3a0,
    0xd30, 0xc39, 0xf33, 0xe3a, 0x936, 0x83f, 0xb35, 0xa3c,
    0x53c, 0x435, 0x73f, 0x636, 0x13a, 0x033, 0x339, 0x230,
    0xe90, 0xf99, 0xc93, 0xd9a, 0xa96, 0xb9f, 0x895, 0x99c,
    0x69c, 0x795, 0x49f, 0x596, 0x29a, 0x393, 0x099, 0x190,
    0xf00, 0xe09, 0xd03, 0xc0a, 0xb06, 0xa0f, 0x905, 0x80c,
    0x70c, 0x605, 0x50f, 0x406, 0x30a, 0x203, 0x109, 0x000,
]);

// Edge → corner pairs
const EDGE_CORNERS = [
    [0, 1], [1, 2], [2, 3], [3, 0],  // bottom ring
    [4, 5], [5, 6], [6, 7], [7, 4],  // top ring
    [0, 4], [1, 5], [2, 6], [3, 7],  // verticals
];

// Triangulation table (256 entries, each an array of edge triples)
// Standard Marching Cubes lookup — generated from Lorensen & Cline
const TRI_TABLE = _buildTriTable();

function _buildTriTable() {
    // Compact encoding: each row is a sequence of edge indices, -1 terminated
    const raw = [
        [],
        [0,8,3],
        [0,1,9],
        [1,8,3,9,8,1],
        [1,2,10],
        [0,8,3,1,2,10],
        [9,2,10,0,2,9],
        [2,8,3,2,10,8,10,9,8],
        [3,11,2],
        [0,11,2,8,11,0],
        [1,9,0,2,3,11],
        [1,11,2,1,9,11,9,8,11],
        [3,10,1,11,10,3],
        [0,10,1,0,8,10,8,11,10],
        [3,9,0,3,11,9,11,10,9],
        [9,8,10,10,8,11],
        [4,7,8],
        [4,3,0,7,3,4],
        [0,1,9,8,4,7],
        [4,1,9,4,7,1,7,3,1],
        [1,2,10,8,4,7],
        [3,4,7,3,0,4,1,2,10],
        [9,2,10,9,0,2,8,4,7],
        [2,10,9,2,9,7,2,7,3,7,9,4],
        [8,4,7,3,11,2],
        [11,4,7,11,2,4,2,0,4],
        [9,0,1,8,4,7,2,3,11],
        [4,7,11,9,4,11,9,11,2,9,2,1],
        [3,10,1,3,11,10,7,8,4],
        [1,11,10,1,4,11,1,0,4,7,11,4],
        [4,7,8,9,0,11,9,11,10,11,0,3],
        [4,7,11,4,11,9,9,11,10],
        [9,5,4],
        [9,5,4,0,8,3],
        [0,5,4,1,5,0],
        [8,5,4,8,3,5,3,1,5],
        [1,2,10,9,5,4],
        [3,0,8,1,2,10,4,9,5],
        [5,2,10,5,4,2,4,0,2],
        [2,10,5,3,2,5,3,5,4,3,4,8],
        [9,5,4,2,3,11],
        [0,11,2,0,8,11,4,9,5],
        [0,5,4,0,1,5,2,3,11],
        [2,1,5,2,5,8,2,8,11,4,8,5],
        [10,3,11,10,1,3,9,5,4],
        [4,9,5,0,8,1,8,10,1,8,11,10],
        [5,4,0,5,0,11,5,11,10,11,0,3],
        [5,4,8,5,8,10,10,8,11],
        [9,7,8,5,7,9],
        [9,3,0,9,5,3,5,7,3],
        [0,7,8,0,1,7,1,5,7],
        [1,5,3,3,5,7],
        [9,7,8,9,5,7,10,1,2],
        [10,1,2,9,5,0,5,3,0,5,7,3],
        [8,0,2,8,2,5,8,5,7,10,5,2],
        [2,10,5,2,5,3,3,5,7],
        [7,9,5,7,8,9,3,11,2],
        [9,5,7,9,7,2,9,2,0,2,7,11],
        [2,3,11,0,1,8,1,7,8,1,5,7],
        [11,2,1,11,1,7,7,1,5],
        [9,5,8,8,5,7,10,1,3,10,3,11],
        [5,7,0,5,0,9,7,11,0,1,0,10,11,10,0],
        [11,10,0,11,0,3,10,5,0,8,0,7,5,7,0],
        [11,10,5,7,11,5],
        [10,6,5],
        [0,8,3,5,10,6],
        [9,0,1,5,10,6],
        [1,8,3,1,9,8,5,10,6],
        [1,6,5,2,6,1],
        [1,6,5,1,2,6,3,0,8],
        [9,6,5,9,0,6,0,2,6],
        [5,9,8,5,8,2,5,2,6,3,2,8],
        [2,3,11,10,6,5],
        [11,0,8,11,2,0,10,6,5],
        [0,1,9,2,3,11,5,10,6],
        [5,10,6,1,9,2,9,11,2,9,8,11],
        [6,3,11,6,5,3,5,1,3],
        [0,8,11,0,11,5,0,5,1,5,11,6],
        [3,11,6,0,3,6,0,6,5,0,5,9],
        [6,5,9,6,9,11,11,9,8],
        [5,10,6,4,7,8],
        [4,3,0,4,7,3,6,5,10],
        [1,9,0,5,10,6,8,4,7],
        [10,6,5,1,9,7,1,7,3,7,9,4],
        [6,1,2,6,5,1,4,7,8],
        [1,2,5,5,2,6,3,0,4,3,4,7],
        [8,4,7,9,0,5,0,6,5,0,2,6],
        [7,3,9,7,9,4,3,2,9,5,9,6,2,6,9],
        [3,11,2,7,8,4,10,6,5],
        [5,10,6,4,7,2,4,2,0,2,7,11],
        [0,1,9,4,7,8,2,3,11,5,10,6],
        [9,2,1,9,11,2,9,4,11,7,11,4,5,10,6],
        [8,4,7,3,11,5,3,5,1,5,11,6],
        [5,1,11,5,11,6,1,0,11,7,11,4,0,4,11],
        [0,5,9,0,6,5,0,3,6,11,6,3,8,4,7],
        [6,5,9,6,9,11,4,7,9,7,11,9],
        [10,4,9,6,4,10],
        [4,10,6,4,9,10,0,8,3],
        [10,0,1,10,6,0,6,4,0],
        [8,3,1,8,1,6,8,6,4,6,1,10],
        [1,4,9,1,2,4,2,6,4],
        [3,0,8,1,2,9,2,4,9,2,6,4],
        [0,2,4,4,2,6],
        [8,3,2,8,2,4,4,2,6],
        [10,4,9,10,6,4,11,2,3],
        [0,8,2,2,8,11,4,9,10,4,10,6],
        [3,11,2,0,1,6,0,6,4,6,1,10],
        [6,4,1,6,1,10,4,8,1,2,1,11,8,11,1],
        [9,6,4,9,3,6,9,1,3,11,6,3],
        [8,11,1,8,1,0,11,6,1,9,1,4,6,4,1],
        [3,11,6,3,6,0,0,6,4],
        [6,4,8,11,6,8],
        [7,10,6,7,8,10,8,9,10],
        [0,7,3,0,10,7,0,9,10,6,7,10],
        [10,6,7,1,10,7,1,7,8,1,8,0],
        [10,6,7,10,7,1,1,7,3],
        [1,2,6,1,6,8,1,8,9,8,6,7],
        [2,6,9,2,9,1,6,7,9,0,9,3,7,3,9],
        [7,8,0,7,0,6,6,0,2],
        [7,3,2,6,7,2],
        [2,3,11,10,6,8,10,8,9,8,6,7],
        [2,0,7,2,7,11,0,9,7,6,7,10,9,10,7],
        [1,8,0,1,7,8,1,10,7,6,7,10,2,3,11],
        [11,2,1,11,1,7,10,6,1,6,7,1],
        [8,9,6,8,6,7,9,1,6,11,6,3,1,3,6],
        [0,9,1,11,6,7],
        [7,8,0,7,0,6,3,11,0,11,6,0],
        [7,11,6],
        [7,6,11],
        [3,0,8,11,7,6],
        [0,1,9,11,7,6],
        [8,1,9,8,3,1,11,7,6],
        [10,1,2,6,11,7],
        [1,2,10,3,0,8,6,11,7],
        [2,9,0,2,10,9,6,11,7],
        [6,11,7,2,10,3,10,8,3,10,9,8],
        [7,2,3,6,2,7],
        [7,0,8,7,6,0,6,2,0],
        [2,7,6,2,3,7,0,1,9],
        [1,6,2,1,8,6,1,9,8,8,7,6],
        [10,7,6,10,1,7,1,3,7],
        [10,7,6,1,7,10,1,8,7,1,0,8],
        [0,3,7,0,7,10,0,10,9,6,10,7],
        [7,6,10,7,10,8,8,10,9],
        [6,8,4,11,8,6],
        [3,6,11,3,0,6,0,4,6],
        [8,6,11,8,4,6,9,0,1],
        [9,4,6,9,6,3,9,3,1,11,3,6],
        [6,8,4,6,11,8,2,10,1],
        [1,2,10,3,0,11,0,6,11,0,4,6],
        [4,11,8,4,6,11,0,2,9,2,10,9],
        [10,9,3,10,3,2,9,4,3,11,3,6,4,6,3],
        [8,2,3,8,4,2,4,6,2],
        [0,4,2,4,6,2],
        [1,9,0,2,3,4,2,4,6,4,3,8],
        [1,9,4,1,4,2,2,4,6],
        [8,1,3,8,6,1,8,4,6,6,10,1],
        [10,1,0,10,0,6,6,0,4],
        [4,6,3,4,3,8,6,10,3,0,3,9,10,9,3],
        [10,9,4,6,10,4],
        [4,9,5,7,6,11],
        [0,8,3,4,9,5,11,7,6],
        [5,0,1,5,4,0,7,6,11],
        [11,7,6,8,3,4,3,5,4,3,1,5],
        [9,5,4,10,1,2,7,6,11],
        [6,11,7,1,2,10,0,8,3,4,9,5],
        [7,6,11,5,4,10,4,2,10,4,0,2],
        [3,4,8,3,5,4,3,2,5,10,5,2,11,7,6],
        [7,2,3,7,6,2,5,4,9],
        [9,5,4,0,8,6,0,6,2,6,8,7],
        [3,6,2,3,7,6,1,5,0,5,4,0],
        [6,2,8,6,8,7,2,1,8,4,8,5,1,5,8],
        [9,5,4,10,1,6,1,7,6,1,3,7],
        [1,6,10,1,7,6,1,0,7,8,7,0,9,5,4],
        [4,0,10,4,10,5,0,3,10,6,10,7,3,7,10],
        [7,6,10,7,10,8,5,4,10,4,8,10],
        [6,9,5,6,11,9,11,8,9],
        [3,6,11,0,6,3,0,5,6,0,9,5],
        [0,11,8,0,5,11,0,1,5,5,6,11],
        [6,11,3,6,3,5,5,3,1],
        [1,2,10,9,5,11,9,11,8,11,5,6],
        [0,11,3,0,6,11,0,9,6,5,6,9,1,2,10],
        [11,8,5,11,5,6,8,0,5,10,5,2,0,2,5],
        [6,11,3,6,3,5,2,10,3,10,5,3],
        [5,8,9,5,2,8,5,6,2,3,8,2],
        [9,5,6,9,6,0,0,6,2],
        [1,5,8,1,8,0,5,6,8,3,8,2,6,2,8],
        [1,5,6,2,1,6],
        [1,3,6,1,6,10,3,8,6,5,6,9,8,9,6],
        [10,1,0,10,0,6,9,5,0,5,6,0],
        [0,3,8,5,6,10],
        [10,5,6],
        [11,5,10,7,5,11],
        [11,5,10,11,7,5,8,3,0],
        [5,11,7,5,10,11,1,9,0],
        [10,7,5,10,11,7,9,8,1,8,3,1],
        [11,1,2,11,7,1,7,5,1],
        [0,8,3,1,2,7,1,7,5,7,2,11],
        [9,7,5,9,2,7,9,0,2,2,11,7],
        [7,5,2,7,2,11,5,9,2,3,2,8,9,8,2],
        [2,5,10,2,3,5,3,7,5],
        [8,2,0,8,5,2,8,7,5,10,2,5],
        [9,0,1,5,10,3,5,3,7,3,10,2],
        [9,8,2,9,2,1,8,7,2,10,2,5,7,5,2],
        [1,3,5,3,7,5],
        [0,8,7,0,7,1,1,7,5],
        [9,0,3,9,3,5,5,3,7],
        [9,8,7,5,9,7],
        [5,8,4,5,10,8,10,11,8],
        [5,0,4,5,11,0,5,10,11,11,3,0],
        [0,1,9,8,4,10,8,10,11,10,4,5],
        [10,11,4,10,4,5,11,3,4,9,4,1,3,1,4],
        [2,5,1,2,8,5,2,11,8,4,5,8],
        [0,4,11,0,11,3,4,5,11,2,11,1,5,1,11],
        [0,2,5,0,5,9,2,11,5,4,5,8,11,8,5],
        [9,4,5,2,11,3],
        [2,5,10,3,5,2,3,4,5,3,8,4],
        [5,10,2,5,2,4,4,2,0],
        [3,10,2,3,5,10,3,8,5,4,5,8,0,1,9],
        [5,10,2,5,2,4,1,9,2,9,4,2],
        [8,4,5,8,5,3,3,5,1],
        [0,4,5,1,0,5],
        [8,4,5,8,5,3,9,0,5,0,3,5],
        [9,4,5],
        [4,11,7,4,9,11,9,10,11],
        [0,8,3,4,9,7,9,11,7,9,10,11],
        [1,10,11,1,11,4,1,4,0,7,4,11],
        [3,1,4,3,4,8,1,10,4,7,4,11,10,11,4],
        [4,11,7,9,11,4,9,2,11,9,1,2],
        [9,7,4,9,11,7,9,1,11,2,11,1,0,8,3],
        [11,7,4,11,4,2,2,4,0],
        [11,7,4,11,4,2,8,3,4,3,2,4],
        [2,9,10,2,7,9,2,3,7,7,4,9],
        [9,10,7,9,7,4,10,2,7,8,7,0,2,0,7],
        [3,7,10,3,10,2,7,4,10,1,10,0,4,0,10],
        [1,10,2,8,7,4],
        [4,9,1,4,1,7,7,1,3],
        [4,9,1,4,1,7,0,8,1,8,7,1],
        [4,0,3,7,4,3],
        [4,8,7],
        [9,10,8,10,11,8],
        [3,0,9,3,9,11,11,9,10],
        [0,1,10,0,10,8,8,10,11],
        [3,1,10,11,3,10],
        [1,2,11,1,11,9,9,11,8],
        [3,0,9,3,9,11,1,2,9,2,11,9],
        [0,2,11,8,0,11],
        [3,2,11],
        [2,3,8,2,8,10,10,8,9],
        [9,10,2,0,9,2],
        [2,3,8,2,8,10,0,1,8,1,10,8],
        [1,10,2],
        [1,3,8,9,1,8],
        [0,9,1],
        [0,3,8],
        [],
    ];

    return raw;
}
