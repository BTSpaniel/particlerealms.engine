/**
 * MeshSubdivision.js — Loop & Catmull-Clark Subdivision
 *
 * Subdivision surface algorithms for the Kaolin geometry toolkit.
 *
 * Loop Subdivision (Charles Loop, 1987):
 *   - Operates on triangle meshes only
 *   - Inserts edge midpoints, reconnects into 4 sub-triangles per face
 *   - Uses β-weighting for smooth limit surface (Warren weights)
 *   - Boundary edges get special 1/8, 3/4, 1/8 stencil
 *
 * Catmull-Clark Subdivision (Catmull & Clark, 1978):
 *   - Operates on quad or mixed meshes
 *   - Face points → edge points → vertex points → reconnect
 *   - Converges to C² (bi-cubic B-spline) surface away from extraordinary verts
 *   - Triangle input is first converted to all-quad via 1-to-3 split
 *
 * Both algorithms support:
 *   - Boundary handling (crease preservation)
 *   - Pinned vertices (kept fixed)
 *   - Multiple subdivision levels
 *
 * Data format matches MeshOps.js:
 *   positions: Float32Array — stride 3
 *   indices:   Uint32Array  — stride 3 (triangles) or stride 4 (quads)
 */

import { buildVertexAdjacency } from './MeshOps.js';

// ============================================================================
// CONSTANTS
// ============================================================================

const EPSILON = 1e-7;

// ============================================================================
// LOOP SUBDIVISION (TRIANGLES)
// ============================================================================

/**
 * Perform one level of Loop subdivision on a triangle mesh.
 *
 * @param {Float32Array} positions — stride 3
 * @param {Uint32Array}  indices   — stride 3 (triangles only)
 * @param {Object}       options
 * @param {Set|null}     options.pinned   — vertex indices to keep fixed
 * @param {Set|null}     options.creases  — edge keys (lo*0x100000+hi) to treat as creases
 * @returns {{ positions: Float32Array, indices: Uint32Array }}
 */
export function loopSubdivide(positions, indices, options = {}) {
    const pinned = options.pinned || null;
    const creases = options.creases || null;

    const numVerts = (positions.length / 3) | 0;
    const numFaces = (indices.length / 3) | 0;

    // ── Step 1: Build edge map ───────────────────────────────────────────
    // Each unique edge gets a new "edge vertex" index.
    // edgeMap: key → { idx: new vertex index, faces: [f0, f1], v0, v1 }
    const edgeMap = new Map();
    let nextVertIdx = numVerts;

    // Also track boundary edges (only 1 adjacent face)
    const edgeFaceCount = new Map();

    for (let f = 0; f < numFaces; f++) {
        const base = f * 3;
        for (let k = 0; k < 3; k++) {
            const v0 = indices[base + k];
            const v1 = indices[base + (k + 1) % 3];
            const lo = Math.min(v0, v1), hi = Math.max(v0, v1);
            const key = lo * 0x100000 + hi;

            if (!edgeMap.has(key)) {
                edgeMap.set(key, {
                    idx: nextVertIdx++,
                    faces: [f],
                    v0: lo,
                    v1: hi,
                });
            } else {
                edgeMap.get(key).faces.push(f);
            }
        }
    }

    const numEdgeVerts = edgeMap.size;
    const totalVerts = numVerts + numEdgeVerts;
    const newPositions = new Float32Array(totalVerts * 3);

    // ── Step 2: Compute edge vertex positions ────────────────────────────
    for (const [key, edge] of edgeMap) {
        const { idx, faces, v0, v1 } = edge;
        const isBoundary = faces.length === 1;
        const isCrease = creases && creases.has(key);

        const p0 = v0 * 3, p1 = v1 * 3;

        if (isBoundary || isCrease) {
            // Boundary/crease edge: midpoint
            newPositions[idx * 3]     = (positions[p0]     + positions[p1])     * 0.5;
            newPositions[idx * 3 + 1] = (positions[p0 + 1] + positions[p1 + 1]) * 0.5;
            newPositions[idx * 3 + 2] = (positions[p0 + 2] + positions[p1 + 2]) * 0.5;
        } else {
            // Interior edge: 3/8 * (v0 + v1) + 1/8 * (opp0 + opp1)
            // Find the two opposite vertices
            const opp = [];
            for (const fi of faces) {
                const fb = fi * 3;
                for (let k = 0; k < 3; k++) {
                    const vi = indices[fb + k];
                    if (vi !== v0 && vi !== v1) {
                        opp.push(vi);
                        break;
                    }
                }
            }

            if (opp.length === 2) {
                const o0 = opp[0] * 3, o1 = opp[1] * 3;
                newPositions[idx * 3]     = 0.375 * (positions[p0]     + positions[p1])     + 0.125 * (positions[o0]     + positions[o1]);
                newPositions[idx * 3 + 1] = 0.375 * (positions[p0 + 1] + positions[p1 + 1]) + 0.125 * (positions[o0 + 1] + positions[o1 + 1]);
                newPositions[idx * 3 + 2] = 0.375 * (positions[p0 + 2] + positions[p1 + 2]) + 0.125 * (positions[o0 + 2] + positions[o1 + 2]);
            } else {
                // Fallback: midpoint
                newPositions[idx * 3]     = (positions[p0]     + positions[p1])     * 0.5;
                newPositions[idx * 3 + 1] = (positions[p0 + 1] + positions[p1 + 1]) * 0.5;
                newPositions[idx * 3 + 2] = (positions[p0 + 2] + positions[p1 + 2]) * 0.5;
            }
        }
    }

    // ── Step 3: Compute updated positions for original vertices ──────────
    // Determine boundary vertices
    const isBoundaryVert = new Uint8Array(numVerts);
    for (const [, edge] of edgeMap) {
        if (edge.faces.length === 1) {
            isBoundaryVert[edge.v0] = 1;
            isBoundaryVert[edge.v1] = 1;
        }
    }

    const adj = buildVertexAdjacency(indices, numVerts);

    for (let v = 0; v < numVerts; v++) {
        const vi = v * 3;

        if (pinned && pinned.has(v)) {
            // Pinned: keep original
            newPositions[vi]     = positions[vi];
            newPositions[vi + 1] = positions[vi + 1];
            newPositions[vi + 2] = positions[vi + 2];
            continue;
        }

        const neighbors = adj[v];
        const n = neighbors.length;

        if (n === 0) {
            newPositions[vi]     = positions[vi];
            newPositions[vi + 1] = positions[vi + 1];
            newPositions[vi + 2] = positions[vi + 2];
            continue;
        }

        if (isBoundaryVert[v]) {
            // Boundary vertex: find the two boundary neighbors
            const boundaryNeighbors = [];
            for (const nb of neighbors) {
                const lo = Math.min(v, nb), hi = Math.max(v, nb);
                const key = lo * 0x100000 + hi;
                const edge = edgeMap.get(key);
                if (edge && edge.faces.length === 1) {
                    boundaryNeighbors.push(nb);
                }
            }

            if (boundaryNeighbors.length === 2) {
                // 1/8 * (b0 + b1) + 3/4 * v
                const b0 = boundaryNeighbors[0] * 3;
                const b1 = boundaryNeighbors[1] * 3;
                newPositions[vi]     = 0.75 * positions[vi]     + 0.125 * (positions[b0]     + positions[b1]);
                newPositions[vi + 1] = 0.75 * positions[vi + 1] + 0.125 * (positions[b0 + 1] + positions[b1 + 1]);
                newPositions[vi + 2] = 0.75 * positions[vi + 2] + 0.125 * (positions[b0 + 2] + positions[b1 + 2]);
            } else {
                newPositions[vi]     = positions[vi];
                newPositions[vi + 1] = positions[vi + 1];
                newPositions[vi + 2] = positions[vi + 2];
            }
        } else {
            // Interior vertex: Warren weights
            // β = (n > 3) ? 3/(8n) : 3/16
            const beta = n > 3 ? 3 / (8 * n) : 3 / 16;
            const selfWeight = 1 - n * beta;

            let sx = 0, sy = 0, sz = 0;
            for (const nb of neighbors) {
                const ni = nb * 3;
                sx += positions[ni];
                sy += positions[ni + 1];
                sz += positions[ni + 2];
            }

            newPositions[vi]     = selfWeight * positions[vi]     + beta * sx;
            newPositions[vi + 1] = selfWeight * positions[vi + 1] + beta * sy;
            newPositions[vi + 2] = selfWeight * positions[vi + 2] + beta * sz;
        }
    }

    // ── Step 4: Build new triangle connectivity ──────────────────────────
    // Each original triangle (v0, v1, v2) becomes 4 triangles:
    //   (v0, e01, e20)
    //   (v1, e12, e01)
    //   (v2, e20, e12)
    //   (e01, e12, e20)
    const newIndices = new Uint32Array(numFaces * 4 * 3);
    let fi = 0;

    for (let f = 0; f < numFaces; f++) {
        const base = f * 3;
        const v0 = indices[base], v1 = indices[base + 1], v2 = indices[base + 2];

        // Get edge vertex indices
        const getEdgeVert = (a, b) => {
            const lo = Math.min(a, b), hi = Math.max(a, b);
            return edgeMap.get(lo * 0x100000 + hi).idx;
        };

        const e01 = getEdgeVert(v0, v1);
        const e12 = getEdgeVert(v1, v2);
        const e20 = getEdgeVert(v2, v0);

        // Triangle 1: v0, e01, e20
        newIndices[fi++] = v0;  newIndices[fi++] = e01; newIndices[fi++] = e20;
        // Triangle 2: v1, e12, e01
        newIndices[fi++] = v1;  newIndices[fi++] = e12; newIndices[fi++] = e01;
        // Triangle 3: v2, e20, e12
        newIndices[fi++] = v2;  newIndices[fi++] = e20; newIndices[fi++] = e12;
        // Triangle 4: e01, e12, e20 (center)
        newIndices[fi++] = e01; newIndices[fi++] = e12; newIndices[fi++] = e20;
    }

    return { positions: newPositions, indices: newIndices };
}

/**
 * Perform multiple levels of Loop subdivision.
 * @param {Float32Array} positions
 * @param {Uint32Array}  indices
 * @param {number}       levels — subdivision levels (default 1)
 * @param {Object}       options — passed to each level
 * @returns {{ positions: Float32Array, indices: Uint32Array }}
 */
export function loopSubdivideMulti(positions, indices, levels = 1, options = {}) {
    let pos = positions;
    let idx = indices;

    for (let l = 0; l < levels; l++) {
        const result = loopSubdivide(pos, idx, options);
        pos = result.positions;
        idx = result.indices;
    }

    return { positions: pos, indices: idx };
}


// ============================================================================
// CATMULL-CLARK SUBDIVISION (QUADS / MIXED)
// ============================================================================

/**
 * Perform one level of Catmull-Clark subdivision.
 *
 * Input can be triangle or quad faces (mixed is allowed).
 *   - triangles: indices stride 3, faceVertCounts = [3, 3, ...]
 *   - quads:     indices stride 4, faceVertCounts = [4, 4, ...]
 *   - mixed:     flat indices + faceVertCounts array
 *
 * For simplicity, this implementation accepts two formats:
 *   1. (positions, quadIndices) — all-quad, quadIndices = Uint32Array stride 4
 *   2. (positions, triIndices, { triangleInput: true }) — converts tris to quads first
 *
 * @param {Float32Array} positions — stride 3
 * @param {Uint32Array}  faceIndices — flat face indices
 * @param {number[]}     faceVertCounts — verts per face (3 or 4 each)
 * @param {Object}       options
 * @param {Set|null}     options.pinned — vertices to keep fixed
 * @returns {{ positions: Float32Array, faceIndices: Uint32Array, faceVertCounts: number[] }}
 */
export function catmullClarkSubdivide(positions, faceIndices, faceVertCounts, options = {}) {
    const pinned = options.pinned || null;
    const numVerts = (positions.length / 3) | 0;
    const numFaces = faceVertCounts.length;

    // ── Parse faces into arrays of vertex index arrays ───────────────────
    const faces = [];
    let offset = 0;
    for (let f = 0; f < numFaces; f++) {
        const n = faceVertCounts[f];
        const face = [];
        for (let k = 0; k < n; k++) {
            face.push(faceIndices[offset++]);
        }
        faces.push(face);
    }

    // ── Step 1: Face points ──────────────────────────────────────────────
    // Face point = centroid of face vertices
    let nextIdx = numVerts;
    const facePointIdx = new Int32Array(numFaces);
    const facePoints = []; // [x, y, z] per face

    for (let f = 0; f < numFaces; f++) {
        const face = faces[f];
        let cx = 0, cy = 0, cz = 0;
        for (const vi of face) {
            cx += positions[vi * 3];
            cy += positions[vi * 3 + 1];
            cz += positions[vi * 3 + 2];
        }
        const n = face.length;
        facePoints.push([cx / n, cy / n, cz / n]);
        facePointIdx[f] = nextIdx++;
    }

    // ── Step 2: Edge points ──────────────────────────────────────────────
    // For each unique edge, edge point = avg(edge endpoints, adjacent face points)
    const edgeMap = new Map(); // key → { idx, v0, v1, faces: [] }

    for (let f = 0; f < numFaces; f++) {
        const face = faces[f];
        const n = face.length;
        for (let k = 0; k < n; k++) {
            const v0 = face[k];
            const v1 = face[(k + 1) % n];
            const lo = Math.min(v0, v1), hi = Math.max(v0, v1);
            const key = lo * 0x100000 + hi;

            if (!edgeMap.has(key)) {
                edgeMap.set(key, { idx: nextIdx++, v0: lo, v1: hi, faces: [f] });
            } else {
                edgeMap.get(key).faces.push(f);
            }
        }
    }

    const edgePoints = [];
    for (const [, edge] of edgeMap) {
        const { v0, v1, faces: eFaces } = edge;
        const p0 = v0 * 3, p1 = v1 * 3;

        if (eFaces.length === 1) {
            // Boundary edge: midpoint
            edgePoints.push([
                (positions[p0] + positions[p1]) * 0.5,
                (positions[p0 + 1] + positions[p1 + 1]) * 0.5,
                (positions[p0 + 2] + positions[p1 + 2]) * 0.5,
            ]);
        } else {
            // Interior: avg of endpoints + face points
            let sx = positions[p0] + positions[p1];
            let sy = positions[p0 + 1] + positions[p1 + 1];
            let sz = positions[p0 + 2] + positions[p1 + 2];
            for (const fi of eFaces) {
                sx += facePoints[fi][0];
                sy += facePoints[fi][1];
                sz += facePoints[fi][2];
            }
            const total = 2 + eFaces.length;
            edgePoints.push([sx / total, sy / total, sz / total]);
        }
    }

    // ── Step 3: Updated original vertex positions ────────────────────────
    // For interior vertex v with valence n:
    //   v' = (F + 2R + (n-3)v) / n
    //   where F = avg of adjacent face points, R = avg of adjacent edge midpoints

    // Build vertex→face and vertex→edge adjacency
    const vertFaces = new Array(numVerts);
    for (let i = 0; i < numVerts; i++) vertFaces[i] = [];
    for (let f = 0; f < numFaces; f++) {
        for (const vi of faces[f]) {
            vertFaces[vi].push(f);
        }
    }

    const vertEdges = new Array(numVerts);
    for (let i = 0; i < numVerts; i++) vertEdges[i] = [];
    for (const [key, edge] of edgeMap) {
        vertEdges[edge.v0].push(edge);
        vertEdges[edge.v1].push(edge);
    }

    // Detect boundary vertices
    const isBoundaryVert = new Uint8Array(numVerts);
    for (const [, edge] of edgeMap) {
        if (edge.faces.length === 1) {
            isBoundaryVert[edge.v0] = 1;
            isBoundaryVert[edge.v1] = 1;
        }
    }

    const totalVerts = nextIdx;
    const newPositions = new Float32Array(totalVerts * 3);

    // Write face points
    for (let f = 0; f < numFaces; f++) {
        const idx = facePointIdx[f] * 3;
        newPositions[idx]     = facePoints[f][0];
        newPositions[idx + 1] = facePoints[f][1];
        newPositions[idx + 2] = facePoints[f][2];
    }

    // Write edge points
    let epIdx = 0;
    for (const [, edge] of edgeMap) {
        const idx = edge.idx * 3;
        newPositions[idx]     = edgePoints[epIdx][0];
        newPositions[idx + 1] = edgePoints[epIdx][1];
        newPositions[idx + 2] = edgePoints[epIdx][2];
        epIdx++;
    }

    // Write updated original vertex positions
    for (let v = 0; v < numVerts; v++) {
        const vi = v * 3;

        if (pinned && pinned.has(v)) {
            newPositions[vi]     = positions[vi];
            newPositions[vi + 1] = positions[vi + 1];
            newPositions[vi + 2] = positions[vi + 2];
            continue;
        }

        if (isBoundaryVert[v]) {
            // Boundary vertex: average of boundary edge midpoints + self
            const boundaryEdges = vertEdges[v].filter(e => e.faces.length === 1);
            if (boundaryEdges.length === 2) {
                let mx = 0, my = 0, mz = 0;
                for (const be of boundaryEdges) {
                    const other = be.v0 === v ? be.v1 : be.v0;
                    mx += positions[other * 3];
                    my += positions[other * 3 + 1];
                    mz += positions[other * 3 + 2];
                }
                newPositions[vi]     = 0.75 * positions[vi]     + 0.125 * mx;
                newPositions[vi + 1] = 0.75 * positions[vi + 1] + 0.125 * my;
                newPositions[vi + 2] = 0.75 * positions[vi + 2] + 0.125 * mz;
            } else {
                newPositions[vi]     = positions[vi];
                newPositions[vi + 1] = positions[vi + 1];
                newPositions[vi + 2] = positions[vi + 2];
            }
            continue;
        }

        // Interior vertex
        const adjFaces = vertFaces[v];
        const adjEdges = vertEdges[v];
        const n = adjFaces.length; // valence

        if (n === 0) {
            newPositions[vi]     = positions[vi];
            newPositions[vi + 1] = positions[vi + 1];
            newPositions[vi + 2] = positions[vi + 2];
            continue;
        }

        // F = average of adjacent face points
        let fx = 0, fy = 0, fz = 0;
        for (const fi of adjFaces) {
            fx += facePoints[fi][0];
            fy += facePoints[fi][1];
            fz += facePoints[fi][2];
        }
        fx /= n; fy /= n; fz /= n;

        // R = average of adjacent edge midpoints
        let rx = 0, ry = 0, rz = 0;
        for (const edge of adjEdges) {
            const p0 = edge.v0 * 3, p1 = edge.v1 * 3;
            rx += (positions[p0] + positions[p1]) * 0.5;
            ry += (positions[p0 + 1] + positions[p1 + 1]) * 0.5;
            rz += (positions[p0 + 2] + positions[p1 + 2]) * 0.5;
        }
        const eCount = adjEdges.length;
        rx /= eCount; ry /= eCount; rz /= eCount;

        // v' = (F + 2R + (n-3)v) / n
        newPositions[vi]     = (fx + 2 * rx + (n - 3) * positions[vi])     / n;
        newPositions[vi + 1] = (fy + 2 * ry + (n - 3) * positions[vi + 1]) / n;
        newPositions[vi + 2] = (fz + 2 * rz + (n - 3) * positions[vi + 2]) / n;
    }

    // ── Step 4: Build new quad faces ─────────────────────────────────────
    // Each N-gon face produces N quads:
    //   For each edge (vi, vi+1) of the original face:
    //   quad = [vi_updated, edgePoint(vi,vi+1), facePoint, edgePoint(vi-1,vi)]
    const newFaceIndices = [];
    const newFaceVertCounts = [];

    for (let f = 0; f < numFaces; f++) {
        const face = faces[f];
        const n = face.length;
        const fp = facePointIdx[f];

        for (let k = 0; k < n; k++) {
            const vi = face[k];
            const vPrev = face[(k + n - 1) % n];
            const vNext = face[(k + 1) % n];

            // Edge point between vi and vNext
            const loNext = Math.min(vi, vNext), hiNext = Math.max(vi, vNext);
            const epNext = edgeMap.get(loNext * 0x100000 + hiNext).idx;

            // Edge point between vPrev and vi
            const loPrev = Math.min(vPrev, vi), hiPrev = Math.max(vPrev, vi);
            const epPrev = edgeMap.get(loPrev * 0x100000 + hiPrev).idx;

            // Quad: vi → epNext → facePoint → epPrev
            newFaceIndices.push(vi, epNext, fp, epPrev);
            newFaceVertCounts.push(4);
        }
    }

    return {
        positions: newPositions,
        faceIndices: new Uint32Array(newFaceIndices),
        faceVertCounts: newFaceVertCounts,
    };
}

/**
 * Perform multiple levels of Catmull-Clark subdivision.
 * @param {Float32Array} positions
 * @param {Uint32Array}  faceIndices
 * @param {number[]}     faceVertCounts
 * @param {number}       levels
 * @param {Object}       options
 * @returns {{ positions: Float32Array, faceIndices: Uint32Array, faceVertCounts: number[] }}
 */
export function catmullClarkSubdivideMulti(positions, faceIndices, faceVertCounts, levels = 1, options = {}) {
    let pos = positions;
    let fi = faceIndices;
    let fvc = faceVertCounts;

    for (let l = 0; l < levels; l++) {
        const result = catmullClarkSubdivide(pos, fi, fvc, options);
        pos = result.positions;
        fi = result.faceIndices;
        fvc = result.faceVertCounts;
    }

    return { positions: pos, faceIndices: fi, faceVertCounts: fvc };
}


// ============================================================================
// HELPER: TRIANGLES → CATMULL-CLARK INPUT
// ============================================================================

/**
 * Convert a triangle mesh to the faceIndices + faceVertCounts format
 * expected by catmullClarkSubdivide.
 *
 * @param {Uint32Array} triIndices — stride 3
 * @returns {{ faceIndices: Uint32Array, faceVertCounts: number[] }}
 */
export function trianglesToFaceList(triIndices) {
    const numFaces = (triIndices.length / 3) | 0;
    const faceVertCounts = new Array(numFaces).fill(3);
    return { faceIndices: triIndices, faceVertCounts };
}

/**
 * Convert Catmull-Clark output (all quads) to triangles for rendering.
 * Each quad is split into 2 triangles along the shorter diagonal.
 *
 * @param {Float32Array} positions
 * @param {Uint32Array}  faceIndices
 * @param {number[]}     faceVertCounts
 * @returns {{ positions: Float32Array, indices: Uint32Array }}
 */
export function quadFacesToTriangles(positions, faceIndices, faceVertCounts) {
    const triList = [];
    let offset = 0;

    for (let f = 0; f < faceVertCounts.length; f++) {
        const n = faceVertCounts[f];

        if (n === 3) {
            triList.push(faceIndices[offset], faceIndices[offset + 1], faceIndices[offset + 2]);
        } else if (n === 4) {
            const v0 = faceIndices[offset];
            const v1 = faceIndices[offset + 1];
            const v2 = faceIndices[offset + 2];
            const v3 = faceIndices[offset + 3];

            // Choose shorter diagonal for better triangle quality
            const p0 = v0 * 3, p2 = v2 * 3, p1 = v1 * 3, p3 = v3 * 3;
            const d02x = positions[p2] - positions[p0];
            const d02y = positions[p2 + 1] - positions[p0 + 1];
            const d02z = positions[p2 + 2] - positions[p0 + 2];
            const d13x = positions[p3] - positions[p1];
            const d13y = positions[p3 + 1] - positions[p1 + 1];
            const d13z = positions[p3 + 2] - positions[p1 + 2];
            const len02 = d02x * d02x + d02y * d02y + d02z * d02z;
            const len13 = d13x * d13x + d13y * d13y + d13z * d13z;

            if (len02 <= len13) {
                triList.push(v0, v1, v2);
                triList.push(v0, v2, v3);
            } else {
                triList.push(v0, v1, v3);
                triList.push(v1, v2, v3);
            }
        } else {
            // N-gon fan triangulation (fallback)
            const center = faceIndices[offset];
            for (let k = 1; k < n - 1; k++) {
                triList.push(center, faceIndices[offset + k], faceIndices[offset + k + 1]);
            }
        }

        offset += n;
    }

    return { positions, indices: new Uint32Array(triList) };
}
