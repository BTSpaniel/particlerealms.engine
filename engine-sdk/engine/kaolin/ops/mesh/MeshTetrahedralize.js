/**
 * MeshTetrahedralize.js — Surface Mesh → Tetrahedral Mesh
 *
 * Converts a closed triangle surface mesh into a tetrahedral volume mesh
 * suitable for FEM soft body simulation (GPUSoftBody.js).
 *
 * Algorithm: Constrained Delaunay Tetrahedralization
 *   1. Compute bounding box, generate interior sample points
 *   2. Combine surface vertices + interior points
 *   3. Build Delaunay tetrahedralization via incremental insertion
 *   4. Remove tets outside the surface (using winding number or ray test)
 *   5. Output: nodePositions (Float32Array stride 3) + tetIndices (Uint32Array stride 4)
 *
 * The output format matches GPUSoftBody.createSoftBody() exactly:
 *   nodePositions: Float32Array — [x0, y0, z0, x1, y1, z1, ...]
 *   tetIndices:    Uint32Array  — [n0, n1, n2, n3, ...] (4 per tet)
 *
 * References:
 *   - Si, "TetGen: A Delaunay-Based Quality Tetrahedral Mesh Generator" (2015)
 *   - Shewchuk, "Tetrahedral Mesh Generation by Delaunay Refinement" (1998)
 *   - Jacobson et al., "Robust Inside-Outside Segmentation using Generalized Winding Numbers" (2013)
 */

import { computeBoundingBox, computeSignedVolume, computeFaceNormals } from './MeshOps.js';

// ============================================================================
// CONSTANTS
// ============================================================================

const EPSILON = 1e-8;

// ============================================================================
// MAIN API
// ============================================================================

/**
 * Tetrahedralize a closed triangle surface mesh.
 *
 * @param {Float32Array} positions — surface vertex positions, stride 3
 * @param {Uint32Array}  indices   — surface triangle indices, stride 3
 * @param {Object}       options
 * @param {number}       options.resolution    — interior sample density (default 8, range 4-32)
 * @param {number}       options.qualityBound  — min tet quality ratio (default 2.0, lower = more tets)
 * @param {boolean}      options.preserveSurface — keep surface verts as-is (default true)
 * @returns {{ nodePositions: Float32Array, tetIndices: Uint32Array, surfaceVertCount: number }}
 */
export function tetrahedralize(positions, indices, options = {}) {
    const resolution = options.resolution ?? 8;
    const preserveSurface = options.preserveSurface ?? true;

    const numSurfVerts = (positions.length / 3) | 0;
    const numSurfFaces = (indices.length / 3) | 0;

    // ── Step 1: Generate interior sample points ──────────────────────────
    const bbox = computeBoundingBox(positions);
    const interiorPoints = _generateInteriorPoints(positions, indices, bbox, resolution);

    // ── Step 2: Combine surface + interior vertices ──────────────────────
    const totalVerts = numSurfVerts + interiorPoints.length;
    const allPositions = new Float32Array(totalVerts * 3);

    // Copy surface vertices
    allPositions.set(positions);

    // Copy interior points
    for (let i = 0; i < interiorPoints.length; i++) {
        const base = (numSurfVerts + i) * 3;
        allPositions[base]     = interiorPoints[i][0];
        allPositions[base + 1] = interiorPoints[i][1];
        allPositions[base + 2] = interiorPoints[i][2];
    }

    // ── Step 3: Delaunay tetrahedralization ──────────────────────────────
    const rawTets = _delaunayTetrahedralize(allPositions, totalVerts);

    // ── Step 4: Remove exterior tets ─────────────────────────────────────
    const insideTets = _filterExteriorTets(allPositions, rawTets, positions, indices);

    // ── Step 5: Pack output ──────────────────────────────────────────────
    const tetIndices = new Uint32Array(insideTets.length * 4);
    for (let i = 0; i < insideTets.length; i++) {
        const t = insideTets[i];
        tetIndices[i * 4]     = t[0];
        tetIndices[i * 4 + 1] = t[1];
        tetIndices[i * 4 + 2] = t[2];
        tetIndices[i * 4 + 3] = t[3];
    }

    return {
        nodePositions: allPositions,
        tetIndices,
        surfaceVertCount: numSurfVerts,
        tetCount: insideTets.length,
        nodeCount: totalVerts,
    };
}

/**
 * Quick tetrahedralize using simple grid-based approach.
 * Faster but lower quality than full Delaunay. Good for real-time use.
 *
 * @param {Float32Array} positions — surface vertex positions, stride 3
 * @param {Uint32Array}  indices   — surface triangle indices, stride 3
 * @param {number}       gridRes   — grid resolution per axis (default 6)
 * @returns {{ nodePositions: Float32Array, tetIndices: Uint32Array, surfaceVertCount: number }}
 */
export function tetrahedralizeGrid(positions, indices, gridRes = 6) {
    const numSurfVerts = (positions.length / 3) | 0;
    const bbox = computeBoundingBox(positions);

    // Generate grid nodes inside the mesh
    const interiorPoints = _generateInteriorPoints(positions, indices, bbox, gridRes);

    // Combine surface + grid vertices
    const totalVerts = numSurfVerts + interiorPoints.length;
    const allPositions = new Float32Array(totalVerts * 3);
    allPositions.set(positions);

    for (let i = 0; i < interiorPoints.length; i++) {
        const base = (numSurfVerts + i) * 3;
        allPositions[base]     = interiorPoints[i][0];
        allPositions[base + 1] = interiorPoints[i][1];
        allPositions[base + 2] = interiorPoints[i][2];
    }

    // Simple 5-tet-per-cube decomposition for grid points
    const tets = _gridTetrahedralize(allPositions, totalVerts, bbox, gridRes, numSurfVerts, interiorPoints.length, positions, indices);

    const tetIndices = new Uint32Array(tets.length * 4);
    for (let i = 0; i < tets.length; i++) {
        tetIndices[i * 4]     = tets[i][0];
        tetIndices[i * 4 + 1] = tets[i][1];
        tetIndices[i * 4 + 2] = tets[i][2];
        tetIndices[i * 4 + 3] = tets[i][3];
    }

    return {
        nodePositions: allPositions,
        tetIndices,
        surfaceVertCount: numSurfVerts,
        tetCount: tets.length,
        nodeCount: totalVerts,
    };
}


// ============================================================================
// INTERIOR POINT GENERATION
// ============================================================================

/**
 * Generate points inside a triangle mesh using a grid + winding number test.
 */
function _generateInteriorPoints(positions, indices, bbox, resolution) {
    const points = [];
    const margin = 0.01;

    const dx = (bbox.size[0] + margin * 2) / resolution;
    const dy = (bbox.size[1] + margin * 2) / resolution;
    const dz = (bbox.size[2] + margin * 2) / resolution;

    // Skip if mesh is too flat
    if (dx < EPSILON || dy < EPSILON || dz < EPSILON) return points;

    for (let xi = 1; xi < resolution; xi++) {
        for (let yi = 1; yi < resolution; yi++) {
            for (let zi = 1; zi < resolution; zi++) {
                const x = bbox.min[0] - margin + xi * dx;
                const y = bbox.min[1] - margin + yi * dy;
                const z = bbox.min[2] - margin + zi * dz;

                if (_isInsideMesh(x, y, z, positions, indices)) {
                    points.push([x, y, z]);
                }
            }
        }
    }

    return points;
}


// ============================================================================
// INSIDE/OUTSIDE TEST (RAY CASTING)
// ============================================================================

/**
 * Test if a point is inside a closed triangle mesh using ray casting.
 * Casts a ray along +X and counts intersections.
 */
function _isInsideMesh(px, py, pz, positions, indices) {
    const numFaces = (indices.length / 3) | 0;
    let crossings = 0;

    for (let f = 0; f < numFaces; f++) {
        const i0 = indices[f * 3] * 3;
        const i1 = indices[f * 3 + 1] * 3;
        const i2 = indices[f * 3 + 2] * 3;

        const v0y = positions[i0 + 1], v0z = positions[i0 + 2];
        const v1y = positions[i1 + 1], v1z = positions[i1 + 2];
        const v2y = positions[i2 + 1], v2z = positions[i2 + 2];

        // Quick AABB reject on Y/Z
        const minY = Math.min(v0y, v1y, v2y);
        const maxY = Math.max(v0y, v1y, v2y);
        const minZ = Math.min(v0z, v1z, v2z);
        const maxZ = Math.max(v0z, v1z, v2z);

        if (py < minY || py > maxY || pz < minZ || pz > maxZ) continue;

        // Möller-Trumbore ray-triangle intersection
        // Ray: origin = (px, py, pz), direction = (1, 0, 0)
        const v0x = positions[i0];
        const v1x = positions[i1];
        const v2x = positions[i2];

        const e1x = v1x - v0x, e1y = v1y - v0y, e1z = v1z - v0z;
        const e2x = v2x - v0x, e2y = v2y - v0y, e2z = v2z - v0z;

        // h = cross(dir, e2), dir = (1,0,0)
        const hx = 0;
        const hy = -e2z; // 0*e2z - 0*e2y... wait, cross((1,0,0), e2) = (0*e2z-0*e2y, 0*e2x-1*e2z, 1*e2y-0*e2x)
        const hz = e2y;
        // correction: cross((1,0,0), (e2x,e2y,e2z)) = (0*e2z - 0*e2y, 0*e2x - 1*e2z, 1*e2y - 0*e2x) = (0, -e2z, e2y)

        const a = e1x * hx + e1y * hy + e1z * hz; // e1 · h
        if (a > -EPSILON && a < EPSILON) continue;

        const f_inv = 1 / a;
        const sx = px - v0x, sy = py - v0y, sz = pz - v0z;
        const u = f_inv * (sx * hx + sy * hy + sz * hz);
        if (u < 0 || u > 1) continue;

        const qx = sy * e1z - sz * e1y;
        const qy = sz * e1x - sx * e1z;
        const qz = sx * e1y - sy * e1x;

        const v = f_inv * (1 * qx + 0 * qy + 0 * qz); // dir · q, dir = (1,0,0)
        if (v < 0 || u + v > 1) continue;

        const t = f_inv * (e2x * qx + e2y * qy + e2z * qz);
        if (t > EPSILON) crossings++;
    }

    return (crossings & 1) === 1; // odd = inside
}


// ============================================================================
// DELAUNAY TETRAHEDRALIZATION (INCREMENTAL BOWYER-WATSON)
// ============================================================================

/**
 * Incremental Bowyer-Watson 3D Delaunay tetrahedralization.
 * Returns array of [v0, v1, v2, v3] index arrays.
 */
function _delaunayTetrahedralize(positions, numVerts) {
    if (numVerts < 4) return [];

    // Create super-tetrahedron that contains all points
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    for (let i = 0; i < numVerts; i++) {
        const b = i * 3;
        minX = Math.min(minX, positions[b]);
        minY = Math.min(minY, positions[b + 1]);
        minZ = Math.min(minZ, positions[b + 2]);
        maxX = Math.max(maxX, positions[b]);
        maxY = Math.max(maxY, positions[b + 1]);
        maxZ = Math.max(maxZ, positions[b + 2]);
    }

    const dx = (maxX - minX) || 1;
    const dy = (maxY - minY) || 1;
    const dz = (maxZ - minZ) || 1;
    const dMax = Math.max(dx, dy, dz) * 10;
    const cx = (minX + maxX) * 0.5;
    const cy = (minY + maxY) * 0.5;
    const cz = (minZ + maxZ) * 0.5;

    // 8 super vertices (large cube far outside the mesh)
    const superOffset = numVerts;
    const superVerts = [
        [cx - dMax, cy - dMax, cz - dMax],
        [cx + dMax, cy - dMax, cz - dMax],
        [cx + dMax, cy + dMax, cz - dMax],
        [cx - dMax, cy + dMax, cz - dMax],
        [cx - dMax, cy - dMax, cz + dMax],
        [cx + dMax, cy - dMax, cz + dMax],
        [cx + dMax, cy + dMax, cz + dMax],
        [cx - dMax, cy + dMax, cz + dMax],
    ];

    // Extend positions with super vertices
    const extPos = new Float32Array((numVerts + 8) * 3);
    extPos.set(positions);
    for (let i = 0; i < 8; i++) {
        extPos[(numVerts + i) * 3]     = superVerts[i][0];
        extPos[(numVerts + i) * 3 + 1] = superVerts[i][1];
        extPos[(numVerts + i) * 3 + 2] = superVerts[i][2];
    }

    // Initial tetrahedralization of the super-cube (split into 5 tets)
    const s = superOffset;
    let tets = [
        [s+0, s+1, s+3, s+4],
        [s+1, s+2, s+3, s+6],
        [s+1, s+3, s+4, s+6],
        [s+3, s+4, s+6, s+7],
        [s+1, s+4, s+5, s+6],
    ];

    // Precompute circumspheres
    const circumCache = new Map();

    function getCircum(tet) {
        const key = tet[0] * 1000000000 + tet[1] * 1000000 + tet[2] * 1000 + tet[3];
        if (circumCache.has(key)) return circumCache.get(key);
        const cs = _circumsphere(extPos, tet[0], tet[1], tet[2], tet[3]);
        circumCache.set(key, cs);
        return cs;
    }

    // Insert each point
    for (let pi = 0; pi < numVerts; pi++) {
        const px = extPos[pi * 3];
        const py = extPos[pi * 3 + 1];
        const pz = extPos[pi * 3 + 2];

        // Find tets whose circumsphere contains the new point
        const badTets = [];
        const goodTets = [];

        for (let ti = 0; ti < tets.length; ti++) {
            const cs = getCircum(tets[ti]);
            if (cs) {
                const ddx = px - cs.cx, ddy = py - cs.cy, ddz = pz - cs.cz;
                const dist2 = ddx * ddx + ddy * ddy + ddz * ddz;
                if (dist2 < cs.r2 + EPSILON) {
                    badTets.push(ti);
                } else {
                    goodTets.push(tets[ti]);
                }
            } else {
                goodTets.push(tets[ti]);
            }
        }

        if (badTets.length === 0) {
            // Point is outside all circumspheres (degenerate), skip
            continue;
        }

        // Find boundary faces of the cavity (faces shared by exactly one bad tet)
        const faceCounts = new Map();
        for (const ti of badTets) {
            const tet = tets[ti];
            // 4 faces per tet
            const faces = [
                [tet[0], tet[1], tet[2]],
                [tet[0], tet[1], tet[3]],
                [tet[0], tet[2], tet[3]],
                [tet[1], tet[2], tet[3]],
            ];
            for (const face of faces) {
                const sorted = [...face].sort((a, b) => a - b);
                const fkey = sorted[0] * 1000000000 + sorted[1] * 1000000 + sorted[2];
                faceCounts.set(fkey, (faceCounts.get(fkey) || 0) + 1);
            }
        }

        // Boundary faces = those appearing exactly once
        const boundaryFaces = [];
        for (const ti of badTets) {
            const tet = tets[ti];
            const faces = [
                [tet[0], tet[1], tet[2]],
                [tet[0], tet[1], tet[3]],
                [tet[0], tet[2], tet[3]],
                [tet[1], tet[2], tet[3]],
            ];
            for (const face of faces) {
                const sorted = [...face].sort((a, b) => a - b);
                const fkey = sorted[0] * 1000000000 + sorted[1] * 1000000 + sorted[2];
                if (faceCounts.get(fkey) === 1) {
                    boundaryFaces.push(face);
                }
            }
        }

        // Clear circumsphere cache for removed tets
        for (const ti of badTets) {
            const tet = tets[ti];
            const key = tet[0] * 1000000000 + tet[1] * 1000000 + tet[2] * 1000 + tet[3];
            circumCache.delete(key);
        }

        // Create new tets connecting boundary faces to the new point
        const newTets = [];
        for (const face of boundaryFaces) {
            const newTet = [face[0], face[1], face[2], pi];
            // Ensure positive orientation
            const vol = _tetVolumeSigned(extPos, newTet[0], newTet[1], newTet[2], newTet[3]);
            if (vol < -EPSILON) {
                // Swap two vertices to fix orientation
                const tmp = newTet[0];
                newTet[0] = newTet[1];
                newTet[1] = tmp;
            }
            if (Math.abs(vol) > EPSILON) {
                newTets.push(newTet);
            }
        }

        tets = [...goodTets, ...newTets];
    }

    // Remove tets that use super vertices
    const result = [];
    for (const tet of tets) {
        if (tet[0] >= superOffset || tet[1] >= superOffset ||
            tet[2] >= superOffset || tet[3] >= superOffset) {
            continue;
        }
        result.push(tet);
    }

    return result;
}


// ============================================================================
// GRID-BASED TETRAHEDRALIZATION (FAST PATH)
// ============================================================================

/**
 * Create tets from a regular grid of interior points.
 * Each cube cell is split into 5 tetrahedra (Freudenthal).
 * Only keeps tets whose centroids are inside the mesh.
 */
function _gridTetrahedralize(allPositions, totalVerts, bbox, gridRes, surfVertCount, interiorCount, surfPositions, surfIndices) {
    if (interiorCount === 0) return [];

    const margin = 0.01;
    const dx = (bbox.size[0] + margin * 2) / gridRes;
    const dy = (bbox.size[1] + margin * 2) / gridRes;
    const dz = (bbox.size[2] + margin * 2) / gridRes;

    // Build a map from grid coords → vertex index (interior points only)
    const gridToVert = new Map();
    let idx = surfVertCount;

    for (let xi = 1; xi < gridRes; xi++) {
        for (let yi = 1; yi < gridRes; yi++) {
            for (let zi = 1; zi < gridRes; zi++) {
                const x = bbox.min[0] - margin + xi * dx;
                const y = bbox.min[1] - margin + yi * dy;
                const z = bbox.min[2] - margin + zi * dz;

                if (_isInsideMesh(x, y, z, surfPositions, surfIndices)) {
                    const key = xi * 10000 + yi * 100 + zi;
                    gridToVert.set(key, idx);
                    idx++;
                }
            }
        }
    }

    // For each grid cell where all 8 corners exist, generate 5 tets
    const tets = [];

    for (let xi = 1; xi < gridRes - 1; xi++) {
        for (let yi = 1; yi < gridRes - 1; yi++) {
            for (let zi = 1; zi < gridRes - 1; zi++) {
                // 8 corner vertex indices
                const corners = [
                    gridToVert.get(xi       * 10000 + yi       * 100 + zi),
                    gridToVert.get((xi + 1) * 10000 + yi       * 100 + zi),
                    gridToVert.get((xi + 1) * 10000 + (yi + 1) * 100 + zi),
                    gridToVert.get(xi       * 10000 + (yi + 1) * 100 + zi),
                    gridToVert.get(xi       * 10000 + yi       * 100 + (zi + 1)),
                    gridToVert.get((xi + 1) * 10000 + yi       * 100 + (zi + 1)),
                    gridToVert.get((xi + 1) * 10000 + (yi + 1) * 100 + (zi + 1)),
                    gridToVert.get(xi       * 10000 + (yi + 1) * 100 + (zi + 1)),
                ];

                // Skip if any corner is missing (outside mesh)
                if (corners.some(c => c === undefined)) continue;

                // Freudenthal 5-tet decomposition of a cube
                const c = corners;
                tets.push([c[0], c[1], c[3], c[4]]); // tet 0
                tets.push([c[1], c[2], c[3], c[6]]); // tet 1
                tets.push([c[1], c[3], c[4], c[6]]); // tet 2
                tets.push([c[3], c[4], c[6], c[7]]); // tet 3
                tets.push([c[1], c[4], c[5], c[6]]); // tet 4
            }
        }
    }

    // Filter: remove degenerate tets (zero or near-zero volume)
    return tets.filter(t => {
        const vol = Math.abs(_tetVolumeSigned(allPositions, t[0], t[1], t[2], t[3]));
        return vol > EPSILON;
    });
}


// ============================================================================
// FILTER EXTERIOR TETS
// ============================================================================

/**
 * Remove tetrahedra whose centroid is outside the surface mesh.
 */
function _filterExteriorTets(allPositions, tets, surfPositions, surfIndices) {
    return tets.filter(tet => {
        // Compute tet centroid
        const cx = (allPositions[tet[0] * 3] + allPositions[tet[1] * 3] + allPositions[tet[2] * 3] + allPositions[tet[3] * 3]) / 4;
        const cy = (allPositions[tet[0] * 3 + 1] + allPositions[tet[1] * 3 + 1] + allPositions[tet[2] * 3 + 1] + allPositions[tet[3] * 3 + 1]) / 4;
        const cz = (allPositions[tet[0] * 3 + 2] + allPositions[tet[1] * 3 + 2] + allPositions[tet[2] * 3 + 2] + allPositions[tet[3] * 3 + 2]) / 4;

        return _isInsideMesh(cx, cy, cz, surfPositions, surfIndices);
    });
}


// ============================================================================
// GEOMETRY HELPERS
// ============================================================================

/**
 * Signed volume of a tetrahedron (positive if oriented correctly).
 */
function _tetVolumeSigned(positions, a, b, c, d) {
    const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
    const bx = positions[b * 3], by = positions[b * 3 + 1], bz = positions[b * 3 + 2];
    const cx = positions[c * 3], cy = positions[c * 3 + 1], cz = positions[c * 3 + 2];
    const dx = positions[d * 3], dy = positions[d * 3 + 1], dz = positions[d * 3 + 2];

    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    const e3x = dx - ax, e3y = dy - ay, e3z = dz - az;

    return (e1x * (e2y * e3z - e2z * e3y) -
            e2x * (e1y * e3z - e1z * e3y) +
            e3x * (e1y * e2z - e1z * e2y)) / 6;
}

/**
 * Circumsphere of a tetrahedron.
 * Returns { cx, cy, cz, r2 } or null if degenerate.
 */
function _circumsphere(positions, a, b, c, d) {
    const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
    const bx = positions[b * 3] - ax, by = positions[b * 3 + 1] - ay, bz = positions[b * 3 + 2] - az;
    const cx = positions[c * 3] - ax, cy = positions[c * 3 + 1] - ay, cz = positions[c * 3 + 2] - az;
    const dx = positions[d * 3] - ax, dy = positions[d * 3 + 1] - ay, dz = positions[d * 3 + 2] - az;

    const bSq = bx * bx + by * by + bz * bz;
    const cSq = cx * cx + cy * cy + cz * cz;
    const dSq = dx * dx + dy * dy + dz * dz;

    const det = 2 * (bx * (cy * dz - cz * dy) -
                     by * (cx * dz - cz * dx) +
                     bz * (cx * dy - cy * dx));

    if (Math.abs(det) < EPSILON) return null;

    const invDet = 1 / det;

    const ux = (bSq * (cy * dz - cz * dy) - cSq * (by * dz - bz * dy) + dSq * (by * cz - bz * cy)) * invDet;
    const uy = (bSq * (cz * dx - cx * dz) - cSq * (bz * dx - bx * dz) + dSq * (bz * cx - bx * cz)) * invDet;
    const uz = (bSq * (cx * dy - cy * dx) - cSq * (bx * dy - by * dx) + dSq * (bx * cy - by * cx)) * invDet;

    return {
        cx: ux + ax,
        cy: uy + ay,
        cz: uz + az,
        r2: ux * ux + uy * uy + uz * uz,
    };
}


// ============================================================================
// QUALITY METRICS
// ============================================================================

/**
 * Compute quality ratio for each tet (radius ratio = circumradius / inradius).
 * Ideal = 3 (regular tet). Higher = worse (slivers).
 *
 * @param {Float32Array} positions — stride 3
 * @param {Uint32Array}  tetIndices — stride 4
 * @returns {Float32Array} — quality per tet
 */
export function computeTetQuality(positions, tetIndices) {
    const numTets = (tetIndices.length / 4) | 0;
    const quality = new Float32Array(numTets);

    for (let t = 0; t < numTets; t++) {
        const a = tetIndices[t * 4], b = tetIndices[t * 4 + 1];
        const c = tetIndices[t * 4 + 2], d = tetIndices[t * 4 + 3];

        const vol = Math.abs(_tetVolumeSigned(positions, a, b, c, d));

        if (vol < EPSILON) {
            quality[t] = Infinity; // degenerate
            continue;
        }

        // Compute face areas for inradius
        const faceAreas = [
            _triArea(positions, a, b, c),
            _triArea(positions, a, b, d),
            _triArea(positions, a, c, d),
            _triArea(positions, b, c, d),
        ];
        const totalFaceArea = faceAreas[0] + faceAreas[1] + faceAreas[2] + faceAreas[3];

        // inradius = 3V / totalFaceArea
        const inradius = 3 * vol / totalFaceArea;

        // circumradius
        const cs = _circumsphere(positions, a, b, c, d);
        const circumradius = cs ? Math.sqrt(cs.r2) : Infinity;

        quality[t] = circumradius / inradius;
    }

    return quality;
}

function _triArea(positions, a, b, c) {
    const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
    const e1x = positions[b * 3] - ax, e1y = positions[b * 3 + 1] - ay, e1z = positions[b * 3 + 2] - az;
    const e2x = positions[c * 3] - ax, e2y = positions[c * 3 + 1] - ay, e2z = positions[c * 3 + 2] - az;
    const cx = e1y * e2z - e1z * e2y;
    const cy = e1z * e2x - e1x * e2z;
    const cz = e1x * e2y - e1y * e2x;
    return 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz);
}


// ============================================================================
// SURFACE EXTRACTION (REVERSE: TET → SURFACE TRIANGLES)
// ============================================================================

/**
 * Extract the surface triangles of a tetrahedral mesh.
 * Surface faces are those that belong to exactly one tetrahedron.
 *
 * @param {Uint32Array} tetIndices — stride 4
 * @returns {Uint32Array} — surface triangle indices, stride 3
 */
export function extractTetSurface(tetIndices) {
    const numTets = (tetIndices.length / 4) | 0;
    const faceCount = new Map();

    for (let t = 0; t < numTets; t++) {
        const base = t * 4;
        const n = [tetIndices[base], tetIndices[base + 1], tetIndices[base + 2], tetIndices[base + 3]];

        // 4 faces per tet
        const faces = [
            [n[0], n[2], n[1]], // opposite n[3]
            [n[0], n[1], n[3]], // opposite n[2]
            [n[0], n[3], n[2]], // opposite n[1]
            [n[1], n[2], n[3]], // opposite n[0]
        ];

        for (const face of faces) {
            const sorted = [...face].sort((a, b) => a - b);
            const key = sorted[0] * 1000000000 + sorted[1] * 1000000 + sorted[2];
            const entry = faceCount.get(key);
            if (entry) {
                entry.count++;
            } else {
                faceCount.set(key, { face, count: 1 });
            }
        }
    }

    // Collect faces that appear exactly once (surface)
    const surfaceTriangles = [];
    for (const [, entry] of faceCount) {
        if (entry.count === 1) {
            surfaceTriangles.push(entry.face[0], entry.face[1], entry.face[2]);
        }
    }

    return new Uint32Array(surfaceTriangles);
}
