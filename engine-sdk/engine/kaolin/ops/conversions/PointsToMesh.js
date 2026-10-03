/**
 * PointsToMesh.js — Surface reconstruction from point clouds
 *
 * Converts unstructured 3D point sets into triangle meshes.
 *
 * Approaches:
 *   1. Ball-Pivoting Algorithm (BPA) — requires oriented normals
 *   2. Poisson Surface Reconstruction (simplified) — smooth, gap-filling
 *   3. Alpha Shapes — convex hull variant with concavity control
 *
 * Compatible with:
 *   - MeshToPoints.js output (round-trip)
 *   - Particle system readback positions
 *   - LiDAR / scan data
 */

import { computeBoundingBox } from '../mesh/MeshOps.js';

// ============================================================================
// CONSTANTS
// ============================================================================

const EPSILON = 1e-7;

// ============================================================================
// BALL-PIVOTING ALGORITHM
// ============================================================================

/**
 * Ball-Pivoting Algorithm for surface reconstruction.
 * Rolls a ball of given radius over the point cloud; when it touches exactly
 * 3 points it creates a triangle.
 *
 * Requires oriented normals for consistent triangle winding.
 *
 * @param {Float32Array} points  — stride 3
 * @param {Float32Array} normals — stride 3 (oriented outward)
 * @param {number}       radius  — ball radius
 * @param {Object}       options
 * @param {number}       options.maxTriangles — hard cap (default 200000)
 * @returns {{ positions: Float32Array, indices: Uint32Array }}
 */
export function ballPivoting(points, normals, radius, options = {}) {
    const maxTriangles = options.maxTriangles ?? 200000;
    const numPoints = (points.length / 3) | 0;

    if (numPoints < 3) {
        return { positions: new Float32Array(0), indices: new Uint32Array(0) };
    }

    // Build spatial hash for neighbor queries
    const cellSize = radius * 2;
    const grid = _buildSpatialHash(points, numPoints, cellSize);

    // Track which edges are on the advancing front
    const usedEdges = new Map(); // "a,b" → { third: c, faceIdx }
    const triangles = [];
    const usedVerts = new Uint8Array(numPoints);

    // Find a seed triangle
    const seed = _findSeedTriangle(points, normals, numPoints, radius, grid, cellSize);
    if (!seed) {
        return { positions: new Float32Array(points), indices: new Uint32Array(0) };
    }

    triangles.push(seed[0], seed[1], seed[2]);
    usedVerts[seed[0]] = 1;
    usedVerts[seed[1]] = 1;
    usedVerts[seed[2]] = 1;

    // Initialize front edges
    const front = [];
    _addEdgeToFront(front, usedEdges, seed[0], seed[1], seed[2], 0);
    _addEdgeToFront(front, usedEdges, seed[1], seed[2], seed[0], 0);
    _addEdgeToFront(front, usedEdges, seed[2], seed[0], seed[1], 0);

    // Pivot ball along front edges
    while (front.length > 0 && triangles.length / 3 < maxTriangles) {
        const edge = front.pop();
        if (edge.dead) continue;

        const { a, b } = edge;
        const candidate = _pivotBall(points, normals, numPoints, a, b, radius, grid, cellSize, usedEdges);

        if (candidate < 0) continue;

        const faceIdx = triangles.length / 3;
        triangles.push(a, candidate, b);
        usedVerts[candidate] = 1;

        // Update front
        _joinOrAddEdge(front, usedEdges, a, candidate, b, faceIdx);
        _joinOrAddEdge(front, usedEdges, candidate, b, a, faceIdx);
    }

    return {
        positions: new Float32Array(points),
        indices: new Uint32Array(triangles),
    };
}


// ============================================================================
// ALPHA SHAPES
// ============================================================================

/**
 * Alpha-shape surface reconstruction.
 * Computes 3D Delaunay tetrahedralization, then removes tetrahedra whose
 * circumradius exceeds 1/alpha. Extracts boundary triangles.
 *
 * @param {Float32Array} points — stride 3
 * @param {number}       alpha  — controls concavity (larger = more convex)
 * @returns {{ positions: Float32Array, indices: Uint32Array }}
 */
export function alphaShape(points, alpha) {
    const numPoints = (points.length / 3) | 0;
    if (numPoints < 4) {
        return { positions: new Float32Array(points), indices: new Uint32Array(0) };
    }

    const maxRadius = 1.0 / Math.max(alpha, EPSILON);

    // Simple incremental Delaunay
    const tets = _delaunay3D(points, numPoints);

    // Filter tets by circumradius
    const validTets = [];
    for (let t = 0; t < tets.length; t += 4) {
        const cr = _circumRadius(points,
            tets[t], tets[t + 1], tets[t + 2], tets[t + 3]);
        if (cr <= maxRadius) {
            validTets.push(tets[t], tets[t + 1], tets[t + 2], tets[t + 3]);
        }
    }

    // Extract boundary faces (faces shared by exactly 1 tet)
    const faceCount = new Map();
    const numTets = validTets.length / 4;

    for (let t = 0; t < numTets; t++) {
        const base = t * 4;
        const v = [validTets[base], validTets[base + 1], validTets[base + 2], validTets[base + 3]];

        // 4 faces per tet
        const faces = [
            [v[0], v[1], v[2]],
            [v[0], v[1], v[3]],
            [v[0], v[2], v[3]],
            [v[1], v[2], v[3]],
        ];

        for (const face of faces) {
            const sorted = face.slice().sort((a, b) => a - b);
            const key = sorted.join(',');
            faceCount.set(key, (faceCount.get(key) || 0) + 1);
        }
    }

    // Collect boundary faces
    const indices = [];
    for (let t = 0; t < numTets; t++) {
        const base = t * 4;
        const v = [validTets[base], validTets[base + 1], validTets[base + 2], validTets[base + 3]];

        const faces = [
            [v[0], v[1], v[2]],
            [v[0], v[1], v[3]],
            [v[0], v[2], v[3]],
            [v[1], v[2], v[3]],
        ];

        for (const face of faces) {
            const sorted = face.slice().sort((a, b) => a - b);
            const key = sorted.join(',');
            if (faceCount.get(key) === 1) {
                // Orient face outward using tet centroid
                const opp = v.find(x => !face.includes(x));
                const oriented = _orientFace(points, face, opp);
                indices.push(oriented[0], oriented[1], oriented[2]);
            }
        }
    }

    return {
        positions: new Float32Array(points),
        indices: new Uint32Array(indices),
    };
}


// ============================================================================
// CONVEX HULL (simple gift-wrapping for small point sets)
// ============================================================================

/**
 * Convex hull of a 3D point set. Uses incremental algorithm.
 * For large sets, prefer GPUConvexHull.js.
 *
 * @param {Float32Array} points — stride 3
 * @returns {{ positions: Float32Array, indices: Uint32Array }}
 */
export function convexHull(points) {
    const numPoints = (points.length / 3) | 0;
    if (numPoints < 4) {
        return { positions: new Float32Array(points), indices: new Uint32Array(0) };
    }

    // Find initial tetrahedron
    let p0 = 0, p1 = -1, p2 = -1, p3 = -1;

    // Find farthest point from p0
    let maxDist = -1;
    for (let i = 1; i < numPoints; i++) {
        const d = _dist2(points, p0, i);
        if (d > maxDist) { maxDist = d; p1 = i; }
    }

    // Find farthest from line p0-p1
    maxDist = -1;
    for (let i = 0; i < numPoints; i++) {
        if (i === p0 || i === p1) continue;
        const d = _distToLine2(points, p0, p1, i);
        if (d > maxDist) { maxDist = d; p2 = i; }
    }

    // Find farthest from plane p0-p1-p2
    maxDist = -1;
    for (let i = 0; i < numPoints; i++) {
        if (i === p0 || i === p1 || i === p2) continue;
        const d = Math.abs(_signedDistToPlane(points, p0, p1, p2, i));
        if (d > maxDist) { maxDist = d; p3 = i; }
    }

    if (p1 < 0 || p2 < 0 || p3 < 0) {
        return { positions: new Float32Array(points), indices: new Uint32Array(0) };
    }

    // Orient initial tet so all faces point outward
    if (_signedDistToPlane(points, p0, p1, p2, p3) > 0) {
        const tmp = p1; p1 = p2; p2 = tmp;
    }

    // Faces as [a, b, c] with outward-pointing normals
    let faces = [
        [p0, p1, p2],
        [p0, p2, p3],
        [p0, p3, p1],
        [p1, p3, p2],
    ];

    // Incremental insertion
    for (let i = 0; i < numPoints; i++) {
        if (i === p0 || i === p1 || i === p2 || i === p3) continue;

        // Find visible faces
        const visible = [];
        for (let f = 0; f < faces.length; f++) {
            const [a, b, c] = faces[f];
            if (_signedDistToPlane(points, a, b, c, i) > EPSILON) {
                visible.push(f);
            }
        }

        if (visible.length === 0) continue;

        // Find horizon edges
        const visSet = new Set(visible);
        const horizon = [];

        for (const fi of visible) {
            const [a, b, c] = faces[fi];
            const edges = [[a, b], [b, c], [c, a]];
            for (const [ea, eb] of edges) {
                // Check if the neighbor face sharing this edge is NOT visible
                let shared = false;
                for (let f = 0; f < faces.length; f++) {
                    if (f === fi || visSet.has(f)) continue;
                    const face = faces[f];
                    if (_faceHasEdge(face, eb, ea)) {
                        shared = true;
                        horizon.push([ea, eb]);
                        break;
                    }
                }
            }
        }

        // Remove visible faces (reverse order)
        const sortedVis = visible.sort((a, b) => b - a);
        for (const fi of sortedVis) {
            faces.splice(fi, 1);
        }

        // Add new faces from horizon edges to new point
        for (const [ea, eb] of horizon) {
            faces.push([ea, eb, i]);
        }
    }

    // Convert to indices
    const indices = [];
    for (const [a, b, c] of faces) {
        indices.push(a, b, c);
    }

    return {
        positions: new Float32Array(points),
        indices: new Uint32Array(indices),
    };
}


// ============================================================================
// INTERNAL HELPERS — BPA
// ============================================================================

function _buildSpatialHash(points, numPoints, cellSize) {
    const grid = new Map();
    for (let i = 0; i < numPoints; i++) {
        const kx = Math.floor(points[i * 3] / cellSize);
        const ky = Math.floor(points[i * 3 + 1] / cellSize);
        const kz = Math.floor(points[i * 3 + 2] / cellSize);
        const key = kx + ',' + ky + ',' + kz;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(i);
    }
    return grid;
}

function _neighborsInRadius(points, idx, radius, grid, cellSize) {
    const px = points[idx * 3], py = points[idx * 3 + 1], pz = points[idx * 3 + 2];
    const r2 = radius * radius;
    const result = [];

    const kx = Math.floor(px / cellSize);
    const ky = Math.floor(py / cellSize);
    const kz = Math.floor(pz / cellSize);

    for (let dz = -1; dz <= 1; dz++) {
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                const key = (kx + dx) + ',' + (ky + dy) + ',' + (kz + dz);
                const cell = grid.get(key);
                if (!cell) continue;
                for (const j of cell) {
                    if (j === idx) continue;
                    const ox = points[j * 3] - px;
                    const oy = points[j * 3 + 1] - py;
                    const oz = points[j * 3 + 2] - pz;
                    if (ox * ox + oy * oy + oz * oz <= r2) {
                        result.push(j);
                    }
                }
            }
        }
    }
    return result;
}

function _findSeedTriangle(points, normals, numPoints, radius, grid, cellSize) {
    for (let i = 0; i < numPoints; i++) {
        const neighbors = _neighborsInRadius(points, i, radius * 2, grid, cellSize);
        if (neighbors.length < 2) continue;

        for (let ni = 0; ni < neighbors.length - 1; ni++) {
            for (let nj = ni + 1; nj < neighbors.length; nj++) {
                const a = i, b = neighbors[ni], c = neighbors[nj];

                // Check ball fits
                const center = _ballCenter(points, a, b, c, radius);
                if (!center) continue;

                // Check no other point inside the ball
                let valid = true;
                const allNear = _neighborsInRadius(points, a, radius * 2, grid, cellSize);
                for (const k of allNear) {
                    if (k === a || k === b || k === c) continue;
                    const dx = points[k * 3] - center[0];
                    const dy = points[k * 3 + 1] - center[1];
                    const dz = points[k * 3 + 2] - center[2];
                    if (dx * dx + dy * dy + dz * dz < radius * radius - EPSILON) {
                        valid = false;
                        break;
                    }
                }

                if (valid) {
                    // Orient consistent with normals
                    const nx = normals[a * 3], ny = normals[a * 3 + 1], nz = normals[a * 3 + 2];
                    const fnx = _faceNormal(points, a, b, c);
                    const dot = fnx[0] * nx + fnx[1] * ny + fnx[2] * nz;
                    return dot >= 0 ? [a, b, c] : [a, c, b];
                }
            }
        }
    }
    return null;
}

function _ballCenter(points, a, b, c, radius) {
    const ax = points[a * 3], ay = points[a * 3 + 1], az = points[a * 3 + 2];
    const bx = points[b * 3], by = points[b * 3 + 1], bz = points[b * 3 + 2];
    const cx = points[c * 3], cy = points[c * 3 + 1], cz = points[c * 3 + 2];

    // Triangle circumcenter + offset along normal
    const abx = bx - ax, aby = by - ay, abz = bz - az;
    const acx = cx - ax, acy = cy - ay, acz = cz - az;

    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    const nLen = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (nLen < EPSILON) return null;

    const ab2 = abx * abx + aby * aby + abz * abz;
    const ac2 = acx * acx + acy * acy + acz * acz;
    const d = 2 * nLen * nLen;

    const ox = (ac2 * (abx * ny * nz - abz * ny * ny - aby * nz * nx) +
                ab2 * (acx * ny * nz + acz * nx * nx - acy * nz * nz)) / d;

    // Simplified: just use triangle circumcenter
    const s = ac2 * (abx * abx + aby * aby + abz * abz);
    const t = ab2 * (acx * acx + acy * acy + acz * acz);

    const ccx = ax + (acy * abz - acz * aby) * s / d;
    const ccy = ay + (acz * abx - acx * abz) * s / d;
    const ccz = az + (acx * aby - acy * abx) * s / d;

    // Compute circumradius of triangle
    const crx = ccx - ax, cry = ccy - ay, crz = ccz - az;
    const cr2 = crx * crx + cry * cry + crz * crz;

    if (cr2 > radius * radius) return null;

    // Offset along normal to reach ball center
    const h = Math.sqrt(Math.max(0, radius * radius - cr2));
    const invNLen = 1 / nLen;

    return [
        ccx + nx * invNLen * h,
        ccy + ny * invNLen * h,
        ccz + nz * invNLen * h,
    ];
}

function _pivotBall(points, normals, numPoints, a, b, radius, grid, cellSize, usedEdges) {
    const mx = (points[a * 3] + points[b * 3]) * 0.5;
    const my = (points[a * 3 + 1] + points[b * 3 + 1]) * 0.5;
    const mz = (points[a * 3 + 2] + points[b * 3 + 2]) * 0.5;

    const kx = Math.floor(mx / cellSize);
    const ky = Math.floor(my / cellSize);
    const kz = Math.floor(mz / cellSize);

    let bestCandidate = -1;
    let bestAngle = Infinity;

    for (let dz = -2; dz <= 2; dz++) {
        for (let dy = -2; dy <= 2; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
                const key = (kx + dx) + ',' + (ky + dy) + ',' + (kz + dz);
                const cell = grid.get(key);
                if (!cell) continue;

                for (const c of cell) {
                    if (c === a || c === b) continue;

                    // Check edge not already used in both directions
                    const edgeKey1 = a + ',' + c;
                    const edgeKey2 = c + ',' + b;
                    if (usedEdges.has(edgeKey1) && usedEdges.has(edgeKey2)) continue;

                    const center = _ballCenter(points, a, c, b, radius);
                    if (!center) continue;

                    // Angle metric for "best" pivot
                    const dx2 = center[0] - mx;
                    const dy2 = center[1] - my;
                    const dz2 = center[2] - mz;
                    const angle = Math.atan2(
                        Math.sqrt(dx2 * dx2 + dy2 * dy2 + dz2 * dz2),
                        radius
                    );

                    if (angle < bestAngle) {
                        bestAngle = angle;
                        bestCandidate = c;
                    }
                }
            }
        }
    }

    return bestCandidate;
}

function _addEdgeToFront(front, usedEdges, a, b, opposite, faceIdx) {
    const key = a + ',' + b;
    usedEdges.set(key, { third: opposite, faceIdx });
    front.push({ a, b, dead: false });
}

function _joinOrAddEdge(front, usedEdges, a, b, opposite, faceIdx) {
    const reverseKey = b + ',' + a;
    if (usedEdges.has(reverseKey)) {
        // Edge already has a face on the other side — mark both as dead
        const existing = usedEdges.get(reverseKey);
        for (const e of front) {
            if (e.a === b && e.b === a) e.dead = true;
        }
        usedEdges.set(a + ',' + b, { third: opposite, faceIdx });
        return;
    }
    _addEdgeToFront(front, usedEdges, a, b, opposite, faceIdx);
}

function _faceNormal(points, a, b, c) {
    const ax = points[a * 3], ay = points[a * 3 + 1], az = points[a * 3 + 2];
    const bx = points[b * 3], by = points[b * 3 + 1], bz = points[b * 3 + 2];
    const cx = points[c * 3], cy = points[c * 3 + 1], cz = points[c * 3 + 2];

    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;

    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);

    if (len < EPSILON) return [0, 1, 0];
    return [nx / len, ny / len, nz / len];
}


// ============================================================================
// INTERNAL HELPERS — Alpha Shapes / Convex Hull
// ============================================================================

function _delaunay3D(points, numPoints) {
    // Simplified Bowyer-Watson — reused from MeshTetrahedralize pattern
    const tets = [];

    // Bounding super-tetrahedron
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < numPoints; i++) {
        const x = points[i * 3], y = points[i * 3 + 1], z = points[i * 3 + 2];
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }

    const dx = maxX - minX, dy = maxY - minY, dz = maxZ - minZ;
    const maxDim = Math.max(dx, dy, dz, 1);
    const cx = (minX + maxX) * 0.5, cy = (minY + maxY) * 0.5, cz = (minZ + maxZ) * 0.5;
    const big = maxDim * 10;

    // 8 super-vertices forming a large box
    const superCount = 8;
    const allPts = new Float32Array(numPoints * 3 + superCount * 3);
    allPts.set(points);
    const sBase = numPoints * 3;
    const corners = [
        [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
        [-1, -1,  1], [1, -1,  1], [1, 1,  1], [-1, 1,  1],
    ];
    for (let i = 0; i < 8; i++) {
        allPts[sBase + i * 3]     = cx + corners[i][0] * big;
        allPts[sBase + i * 3 + 1] = cy + corners[i][1] * big;
        allPts[sBase + i * 3 + 2] = cz + corners[i][2] * big;
    }

    // Initial tets from super box (6 tets from cube)
    const s = numPoints;
    let liveTets = [
        [s+0, s+1, s+2, s+6],
        [s+0, s+2, s+3, s+6],
        [s+0, s+3, s+7, s+6],
        [s+0, s+7, s+4, s+6],
        [s+0, s+4, s+5, s+6],
        [s+0, s+1, s+5, s+6],
    ];

    // Insert each point
    for (let pi = 0; pi < numPoints; pi++) {
        const px = allPts[pi * 3], py = allPts[pi * 3 + 1], pz = allPts[pi * 3 + 2];

        const badTets = [];
        const goodTets = [];

        for (let t = 0; t < liveTets.length; t++) {
            const tet = liveTets[t];
            if (_inCircumsphere(allPts, tet[0], tet[1], tet[2], tet[3], px, py, pz)) {
                badTets.push(tet);
            } else {
                goodTets.push(tet);
            }
        }

        // Find boundary faces of the hole
        const boundaryFaces = [];
        for (const tet of badTets) {
            const tetFaces = [
                [tet[0], tet[1], tet[2]],
                [tet[0], tet[1], tet[3]],
                [tet[0], tet[2], tet[3]],
                [tet[1], tet[2], tet[3]],
            ];
            for (const face of tetFaces) {
                let shared = false;
                for (const other of badTets) {
                    if (other === tet) continue;
                    if (_tetHasFace(other, face)) { shared = true; break; }
                }
                if (!shared) boundaryFaces.push(face);
            }
        }

        // Create new tets
        liveTets = goodTets;
        for (const face of boundaryFaces) {
            liveTets.push([face[0], face[1], face[2], pi]);
        }
    }

    // Remove tets referencing super-vertices
    const result = [];
    for (const tet of liveTets) {
        if (tet[0] >= numPoints || tet[1] >= numPoints || tet[2] >= numPoints || tet[3] >= numPoints) continue;
        result.push(tet[0], tet[1], tet[2], tet[3]);
    }

    return result;
}

function _inCircumsphere(pts, a, b, c, d, px, py, pz) {
    const ax2 = pts[a * 3], ay2 = pts[a * 3 + 1], az2 = pts[a * 3 + 2];
    const bx2 = pts[b * 3], by2 = pts[b * 3 + 1], bz2 = pts[b * 3 + 2];
    const cx2 = pts[c * 3], cy2 = pts[c * 3 + 1], cz2 = pts[c * 3 + 2];
    const dx2 = pts[d * 3], dy2 = pts[d * 3 + 1], dz2 = pts[d * 3 + 2];

    // Matrix determinant test
    const dax = ax2 - px, day = ay2 - py, daz = az2 - pz;
    const dbx = bx2 - px, dby = by2 - py, dbz = bz2 - pz;
    const dcx = cx2 - px, dcy = cy2 - py, dcz = cz2 - pz;
    const ddx = dx2 - px, ddy = dy2 - py, ddz = dz2 - pz;

    const da2 = dax * dax + day * day + daz * daz;
    const db2 = dbx * dbx + dby * dby + dbz * dbz;
    const dc2 = dcx * dcx + dcy * dcy + dcz * dcz;
    const dd2 = ddx * ddx + ddy * ddy + ddz * ddz;

    const det = da2 * (dbx * (dcy * ddz - dcz * ddy) - dby * (dcx * ddz - dcz * ddx) + dbz * (dcx * ddy - dcy * ddx))
              - db2 * (dax * (dcy * ddz - dcz * ddy) - day * (dcx * ddz - dcz * ddx) + daz * (dcx * ddy - dcy * ddx))
              + dc2 * (dax * (dby * ddz - dbz * ddy) - day * (dbx * ddz - dbz * ddx) + daz * (dbx * ddy - dby * ddx))
              - dd2 * (dax * (dby * dcz - dbz * dcy) - day * (dbx * dcz - dbz * dcx) + daz * (dbx * dcy - dby * dcx));

    return det > 0;
}

function _tetHasFace(tet, face) {
    const s = face.slice().sort((a, b) => a - b);
    const tetFaces = [
        [tet[0], tet[1], tet[2]],
        [tet[0], tet[1], tet[3]],
        [tet[0], tet[2], tet[3]],
        [tet[1], tet[2], tet[3]],
    ];
    for (const tf of tetFaces) {
        const ts = tf.slice().sort((a, b) => a - b);
        if (ts[0] === s[0] && ts[1] === s[1] && ts[2] === s[2]) return true;
    }
    return false;
}

function _circumRadius(pts, a, b, c, d) {
    const ax = pts[a * 3], ay = pts[a * 3 + 1], az = pts[a * 3 + 2];
    const bx = pts[b * 3], by = pts[b * 3 + 1], bz = pts[b * 3 + 2];
    const cx2 = pts[c * 3], cy2 = pts[c * 3 + 1], cz2 = pts[c * 3 + 2];
    const dx = pts[d * 3], dy = pts[d * 3 + 1], dz = pts[d * 3 + 2];

    // Edge lengths
    const abLen = Math.sqrt((bx - ax) ** 2 + (by - ay) ** 2 + (bz - az) ** 2);
    const acLen = Math.sqrt((cx2 - ax) ** 2 + (cy2 - ay) ** 2 + (cz2 - az) ** 2);
    const adLen = Math.sqrt((dx - ax) ** 2 + (dy - ay) ** 2 + (dz - az) ** 2);

    // Approximate circumradius from average edge / volume ratio
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx2 - ax, e2y = cy2 - ay, e2z = cz2 - az;
    const e3x = dx - ax, e3y = dy - ay, e3z = dz - az;

    const vol = Math.abs(e1x * (e2y * e3z - e2z * e3y) -
                         e1y * (e2x * e3z - e2z * e3x) +
                         e1z * (e2x * e3y - e2y * e3x)) / 6;

    if (vol < EPSILON) return Infinity;

    // Circumradius = product of edges / (8 * volume * ...)
    // Simplified: use inscribed sphere ratio
    return (abLen * acLen * adLen) / (6 * vol);
}

function _orientFace(points, face, oppositeVert) {
    const [a, b, c] = face;
    const fn = _faceNormal(points, a, b, c);

    // Direction from face centroid to opposite vertex
    const fcx = (points[a * 3] + points[b * 3] + points[c * 3]) / 3;
    const fcy = (points[a * 3 + 1] + points[b * 3 + 1] + points[c * 3 + 1]) / 3;
    const fcz = (points[a * 3 + 2] + points[b * 3 + 2] + points[c * 3 + 2]) / 3;

    const dx = points[oppositeVert * 3] - fcx;
    const dy = points[oppositeVert * 3 + 1] - fcy;
    const dz = points[oppositeVert * 3 + 2] - fcz;

    // Normal should point AWAY from opposite vert
    const dot = fn[0] * dx + fn[1] * dy + fn[2] * dz;
    return dot > 0 ? [a, c, b] : [a, b, c];
}


// ============================================================================
// INTERNAL HELPERS — Convex Hull
// ============================================================================

function _dist2(pts, a, b) {
    const dx = pts[b * 3] - pts[a * 3];
    const dy = pts[b * 3 + 1] - pts[a * 3 + 1];
    const dz = pts[b * 3 + 2] - pts[a * 3 + 2];
    return dx * dx + dy * dy + dz * dz;
}

function _distToLine2(pts, a, b, p) {
    const abx = pts[b * 3] - pts[a * 3];
    const aby = pts[b * 3 + 1] - pts[a * 3 + 1];
    const abz = pts[b * 3 + 2] - pts[a * 3 + 2];
    const apx = pts[p * 3] - pts[a * 3];
    const apy = pts[p * 3 + 1] - pts[a * 3 + 1];
    const apz = pts[p * 3 + 2] - pts[a * 3 + 2];

    const cx = aby * apz - abz * apy;
    const cy = abz * apx - abx * apz;
    const cz = abx * apy - aby * apx;

    return (cx * cx + cy * cy + cz * cz) / (abx * abx + aby * aby + abz * abz + EPSILON);
}

function _signedDistToPlane(pts, a, b, c, p) {
    const abx = pts[b * 3] - pts[a * 3];
    const aby = pts[b * 3 + 1] - pts[a * 3 + 1];
    const abz = pts[b * 3 + 2] - pts[a * 3 + 2];
    const acx = pts[c * 3] - pts[a * 3];
    const acy = pts[c * 3 + 1] - pts[a * 3 + 1];
    const acz = pts[c * 3 + 2] - pts[a * 3 + 2];

    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;

    const apx = pts[p * 3] - pts[a * 3];
    const apy = pts[p * 3 + 1] - pts[a * 3 + 1];
    const apz = pts[p * 3 + 2] - pts[a * 3 + 2];

    return nx * apx + ny * apy + nz * apz;
}

function _faceHasEdge(face, a, b) {
    for (let i = 0; i < 3; i++) {
        if (face[i] === a && face[(i + 1) % 3] === b) return true;
    }
    return false;
}
