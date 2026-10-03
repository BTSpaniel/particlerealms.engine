/**
 * MeshOps.js — Core Mesh Operations for Kaolin-style 3D Geometry Toolkit
 *
 * Provides half-edge data structure, adjacency queries, normals, area,
 * Laplacian smoothing, validation, and mesh analysis. All operations work
 * on flat typed arrays (GPU-friendly) with optional object wrappers.
 *
 * Data format (Kaolin convention):
 *   positions: Float32Array — stride 3 (x, y, z per vertex)
 *   indices:   Uint32Array  — stride 3 (v0, v1, v2 per triangle)
 *
 * Compatible with existing engine systems:
 *   - MeshDecimation.js (Vertex/Triangle classes)
 *   - MeshCutter.js (plain [x,y,z] arrays)
 *   - GPUSoftBody.js (SoA GPU buffers)
 *   - EntityMeshRenderer (interleaved vertex buffers)
 */

// ============================================================================
// CONSTANTS
// ============================================================================

const EPSILON = 1e-7;

/** Sentinel for "no twin" in half-edge structure */
const NO_TWIN = -1;

// ============================================================================
// HALF-EDGE DATA STRUCTURE
// ============================================================================

/**
 * Index-based half-edge mesh representation.
 *
 * Each half-edge stores:
 *   vertex   — index of the vertex it points TO
 *   face     — index of the face it belongs to (-1 for boundary)
 *   twin     — index of the opposite half-edge (-1 if boundary)
 *   next     — index of the next half-edge in the face loop
 *   prev     — index of the previous half-edge in the face loop
 *
 * Stored as parallel typed arrays for cache efficiency.
 */
export class HalfEdgeMesh {
    /**
     * @param {Float32Array} positions — flat xyz, length = numVerts * 3
     * @param {Uint32Array}  indices   — flat triangle indices, length = numFaces * 3
     */
    constructor(positions, indices) {
        this.positions = positions;
        this.indices = indices;
        this.numVertices = (positions.length / 3) | 0;
        this.numFaces = (indices.length / 3) | 0;

        // Each triangle contributes 3 half-edges
        const numHE = this.numFaces * 3;

        this.heVertex = new Int32Array(numHE);  // target vertex
        this.heFace   = new Int32Array(numHE);  // owning face
        this.heTwin   = new Int32Array(numHE);  // opposite half-edge
        this.heNext   = new Int32Array(numHE);  // next in face loop
        this.hePrev   = new Int32Array(numHE);  // prev in face loop
        this.numHalfEdges = numHE;

        // Per-vertex: one outgoing half-edge (for traversal entry)
        this.vertexHE = new Int32Array(this.numVertices).fill(-1);

        this._build();
    }

    /** Build the half-edge connectivity from triangle soup. */
    _build() {
        const { indices, numFaces, heVertex, heFace, heTwin, heNext, hePrev, vertexHE } = this;

        // Pass 1: create half-edges per face
        for (let f = 0; f < numFaces; f++) {
            const base = f * 3;
            const i0 = indices[base], i1 = indices[base + 1], i2 = indices[base + 2];

            const he0 = base, he1 = base + 1, he2 = base + 2;

            // Half-edge points TO the next vertex in the triangle
            heVertex[he0] = i1;
            heVertex[he1] = i2;
            heVertex[he2] = i0;

            heFace[he0] = f;
            heFace[he1] = f;
            heFace[he2] = f;

            heNext[he0] = he1;
            heNext[he1] = he2;
            heNext[he2] = he0;

            hePrev[he0] = he2;
            hePrev[he1] = he0;
            hePrev[he2] = he1;

            // Assign one outgoing half-edge per vertex
            if (vertexHE[i0] === -1) vertexHE[i0] = he0;
            if (vertexHE[i1] === -1) vertexHE[i1] = he1;
            if (vertexHE[i2] === -1) vertexHE[i2] = he2;
        }

        // Pass 2: find twins via edge map (from → to) → half-edge index
        heTwin.fill(NO_TWIN);
        const edgeMap = new Map();

        for (let he = 0; he < this.numHalfEdges; he++) {
            const to = heVertex[he];
            const from = heVertex[hePrev[he]];
            const key = from < to ? (from * 0x100000 + to) : (to * 0x100000 + from);
            const flip = from < to;

            if (edgeMap.has(key)) {
                const other = edgeMap.get(key);
                heTwin[he] = other;
                heTwin[other] = he;
                edgeMap.delete(key); // each edge appears exactly twice in manifold
            } else {
                edgeMap.set(key, he);
            }
        }

        // Remaining entries in edgeMap are boundary edges (no twin)
        this._boundaryEdgeCount = edgeMap.size;
    }

    /** Get the source vertex of a half-edge. */
    heFrom(he) {
        return this.heVertex[this.hePrev[he]];
    }

    /** Get the target vertex of a half-edge. */
    heTo(he) {
        return this.heVertex[he];
    }

    /** Is this half-edge on the boundary (no twin)? */
    isBoundary(he) {
        return this.heTwin[he] === NO_TWIN;
    }

    /** Is this mesh closed (no boundary edges)? */
    isClosed() {
        return this._boundaryEdgeCount === 0;
    }

    /**
     * Iterate all half-edges leaving a vertex (one-ring traversal).
     * @param {number} v — vertex index
     * @returns {number[]} — array of half-edge indices
     */
    vertexOutgoing(v) {
        const start = this.vertexHE[v];
        if (start === -1) return [];

        const result = [start];
        let he = this.heTwin[this.hePrev[start]];

        // Walk around the vertex fan via twin-of-prev
        while (he !== -1 && he !== start) {
            result.push(he);
            he = this.heTwin[this.hePrev[he]];
        }

        // If we didn't complete the loop, also walk the other direction (boundary vertex)
        if (he === -1) {
            he = this.heNext[start];
            if (this.heTwin[he] !== -1) {
                he = this.heTwin[he];
                while (he !== -1 && he !== start) {
                    result.push(he);
                    const next = this.heNext[he];
                    he = this.heTwin[next];
                }
            }
        }

        return result;
    }

    /**
     * Get all vertex indices adjacent to vertex v (one-ring neighbors).
     * @param {number} v — vertex index
     * @returns {number[]} — neighbor vertex indices
     */
    vertexNeighbors(v) {
        const outgoing = this.vertexOutgoing(v);
        return outgoing.map(he => this.heVertex[he]);
    }

    /**
     * Get all face indices adjacent to vertex v.
     * @param {number} v — vertex index
     * @returns {number[]} — face indices
     */
    vertexFaces(v) {
        const outgoing = this.vertexOutgoing(v);
        const faces = [];
        for (const he of outgoing) {
            const f = this.heFace[he];
            if (f !== -1) faces.push(f);
        }
        return faces;
    }

    /**
     * Get face indices sharing an edge with face f.
     * @param {number} f — face index
     * @returns {number[]} — adjacent face indices
     */
    faceNeighbors(f) {
        const base = f * 3;
        const neighbors = [];
        for (let i = 0; i < 3; i++) {
            const twin = this.heTwin[base + i];
            if (twin !== NO_TWIN) {
                neighbors.push(this.heFace[twin]);
            }
        }
        return neighbors;
    }

    /**
     * Get all boundary half-edge indices (those with no twin).
     * @returns {number[]}
     */
    boundaryHalfEdges() {
        const result = [];
        for (let he = 0; he < this.numHalfEdges; he++) {
            if (this.heTwin[he] === NO_TWIN) result.push(he);
        }
        return result;
    }

    /**
     * Get ordered boundary loops (arrays of vertex indices).
     * @returns {number[][]} — array of vertex loops
     */
    boundaryLoops() {
        const boundary = this.boundaryHalfEdges();
        if (boundary.length === 0) return [];

        const visited = new Set();
        const loops = [];

        for (const startHE of boundary) {
            if (visited.has(startHE)) continue;

            const loop = [];
            let he = startHE;

            // Walk along boundary: next half-edge with no twin
            do {
                visited.add(he);
                loop.push(this.heFrom(he));

                // Find next boundary edge from the same vertex
                let next = this.heNext[he];
                while (this.heTwin[next] !== NO_TWIN) {
                    next = this.heNext[this.heTwin[next]];
                }
                he = next;
            } while (he !== startHE && !visited.has(he));

            if (loop.length > 0) loops.push(loop);
        }

        return loops;
    }

    /**
     * Euler characteristic: V - E + F
     * For a closed genus-0 mesh, this should be 2.
     * @returns {number}
     */
    eulerCharacteristic() {
        // Count unique edges (each non-boundary edge has 2 half-edges)
        let edgeCount = 0;
        for (let he = 0; he < this.numHalfEdges; he++) {
            const twin = this.heTwin[he];
            if (twin === NO_TWIN || he < twin) edgeCount++;
        }
        return this.numVertices - edgeCount + this.numFaces;
    }

    /**
     * Get the valence (degree) of each vertex.
     * @returns {Int32Array} — valence per vertex
     */
    vertexValences() {
        const valences = new Int32Array(this.numVertices);
        for (let he = 0; he < this.numHalfEdges; he++) {
            valences[this.heFrom(he)]++;
        }
        return valences;
    }
}


// ============================================================================
// FACE NORMALS
// ============================================================================

/**
 * Compute per-face normals (unnormalized = area-weighted, or normalized).
 * @param {Float32Array} positions — stride 3
 * @param {Uint32Array}  indices   — stride 3
 * @param {boolean}      normalize — if true, unit-length normals
 * @returns {Float32Array} — stride 3, length = numFaces * 3
 */
export function computeFaceNormals(positions, indices, normalize = true) {
    const numFaces = (indices.length / 3) | 0;
    const normals = new Float32Array(numFaces * 3);

    for (let f = 0; f < numFaces; f++) {
        const i0 = indices[f * 3] * 3;
        const i1 = indices[f * 3 + 1] * 3;
        const i2 = indices[f * 3 + 2] * 3;

        // Edge vectors
        const e1x = positions[i1]     - positions[i0];
        const e1y = positions[i1 + 1] - positions[i0 + 1];
        const e1z = positions[i1 + 2] - positions[i0 + 2];
        const e2x = positions[i2]     - positions[i0];
        const e2y = positions[i2 + 1] - positions[i0 + 1];
        const e2z = positions[i2 + 2] - positions[i0 + 2];

        // Cross product
        let nx = e1y * e2z - e1z * e2y;
        let ny = e1z * e2x - e1x * e2z;
        let nz = e1x * e2y - e1y * e2x;

        if (normalize) {
            const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
            if (len > EPSILON) {
                const invLen = 1 / len;
                nx *= invLen;
                ny *= invLen;
                nz *= invLen;
            }
        }

        normals[f * 3]     = nx;
        normals[f * 3 + 1] = ny;
        normals[f * 3 + 2] = nz;
    }

    return normals;
}


// ============================================================================
// VERTEX NORMALS
// ============================================================================

/**
 * Compute per-vertex normals via area-weighted average of adjacent face normals.
 * @param {Float32Array} positions — stride 3
 * @param {Uint32Array}  indices   — stride 3
 * @returns {Float32Array} — stride 3, length = numVerts * 3
 */
export function computeVertexNormals(positions, indices) {
    const numVerts = (positions.length / 3) | 0;
    const normals = new Float32Array(numVerts * 3);

    // Accumulate unnormalized (area-weighted) face normals per vertex
    const faceNormals = computeFaceNormals(positions, indices, false);
    const numFaces = (indices.length / 3) | 0;

    for (let f = 0; f < numFaces; f++) {
        const nx = faceNormals[f * 3];
        const ny = faceNormals[f * 3 + 1];
        const nz = faceNormals[f * 3 + 2];

        for (let k = 0; k < 3; k++) {
            const vi = indices[f * 3 + k] * 3;
            normals[vi]     += nx;
            normals[vi + 1] += ny;
            normals[vi + 2] += nz;
        }
    }

    // Normalize each vertex normal
    for (let v = 0; v < numVerts; v++) {
        const vi = v * 3;
        const nx = normals[vi], ny = normals[vi + 1], nz = normals[vi + 2];
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
        if (len > EPSILON) {
            const invLen = 1 / len;
            normals[vi]     *= invLen;
            normals[vi + 1] *= invLen;
            normals[vi + 2] *= invLen;
        }
    }

    return normals;
}


// ============================================================================
// ANGLE-WEIGHTED VERTEX NORMALS
// ============================================================================

/**
 * Compute per-vertex normals weighted by the angle at each vertex in each face.
 * More accurate than area-weighted for meshes with very different triangle sizes.
 * @param {Float32Array} positions — stride 3
 * @param {Uint32Array}  indices   — stride 3
 * @returns {Float32Array} — stride 3, length = numVerts * 3
 */
export function computeVertexNormalsAngleWeighted(positions, indices) {
    const numVerts = (positions.length / 3) | 0;
    const numFaces = (indices.length / 3) | 0;
    const normals = new Float32Array(numVerts * 3);
    const faceNormals = computeFaceNormals(positions, indices, true);

    for (let f = 0; f < numFaces; f++) {
        const i0 = indices[f * 3], i1 = indices[f * 3 + 1], i2 = indices[f * 3 + 2];
        const verts = [i0, i1, i2];
        const fnx = faceNormals[f * 3], fny = faceNormals[f * 3 + 1], fnz = faceNormals[f * 3 + 2];

        for (let k = 0; k < 3; k++) {
            const curr = verts[k] * 3;
            const prev = verts[(k + 2) % 3] * 3;
            const next = verts[(k + 1) % 3] * 3;

            // Edges from current vertex
            const e1x = positions[prev] - positions[curr];
            const e1y = positions[prev + 1] - positions[curr + 1];
            const e1z = positions[prev + 2] - positions[curr + 2];
            const e2x = positions[next] - positions[curr];
            const e2y = positions[next + 1] - positions[curr + 1];
            const e2z = positions[next + 2] - positions[curr + 2];

            const len1 = Math.sqrt(e1x * e1x + e1y * e1y + e1z * e1z);
            const len2 = Math.sqrt(e2x * e2x + e2y * e2y + e2z * e2z);

            if (len1 > EPSILON && len2 > EPSILON) {
                const cosAngle = (e1x * e2x + e1y * e2y + e1z * e2z) / (len1 * len2);
                const angle = Math.acos(Math.max(-1, Math.min(1, cosAngle)));

                normals[curr]     += fnx * angle;
                normals[curr + 1] += fny * angle;
                normals[curr + 2] += fnz * angle;
            }
        }
    }

    // Normalize
    for (let v = 0; v < numVerts; v++) {
        const vi = v * 3;
        const nx = normals[vi], ny = normals[vi + 1], nz = normals[vi + 2];
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
        if (len > EPSILON) {
            const invLen = 1 / len;
            normals[vi] *= invLen;
            normals[vi + 1] *= invLen;
            normals[vi + 2] *= invLen;
        }
    }

    return normals;
}


// ============================================================================
// FACE AREAS
// ============================================================================

/**
 * Compute area of each triangle face.
 * @param {Float32Array} positions — stride 3
 * @param {Uint32Array}  indices   — stride 3
 * @returns {Float32Array} — length = numFaces
 */
export function computeFaceAreas(positions, indices) {
    const numFaces = (indices.length / 3) | 0;
    const areas = new Float32Array(numFaces);

    for (let f = 0; f < numFaces; f++) {
        const i0 = indices[f * 3] * 3;
        const i1 = indices[f * 3 + 1] * 3;
        const i2 = indices[f * 3 + 2] * 3;

        const e1x = positions[i1]     - positions[i0];
        const e1y = positions[i1 + 1] - positions[i0 + 1];
        const e1z = positions[i1 + 2] - positions[i0 + 2];
        const e2x = positions[i2]     - positions[i0];
        const e2y = positions[i2 + 1] - positions[i0 + 1];
        const e2z = positions[i2 + 2] - positions[i0 + 2];

        // Area = 0.5 * |cross(e1, e2)|
        const cx = e1y * e2z - e1z * e2y;
        const cy = e1z * e2x - e1x * e2z;
        const cz = e1x * e2y - e1y * e2x;

        areas[f] = 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz);
    }

    return areas;
}


// ============================================================================
// SURFACE AREA & VOLUME
// ============================================================================

/**
 * Total surface area of the mesh.
 * @param {Float32Array} positions
 * @param {Uint32Array}  indices
 * @returns {number}
 */
export function computeSurfaceArea(positions, indices) {
    const areas = computeFaceAreas(positions, indices);
    let total = 0;
    for (let i = 0; i < areas.length; i++) total += areas[i];
    return total;
}

/**
 * Signed volume of a closed triangle mesh (divergence theorem).
 * Positive if normals point outward with consistent winding.
 * @param {Float32Array} positions
 * @param {Uint32Array}  indices
 * @returns {number}
 */
export function computeSignedVolume(positions, indices) {
    const numFaces = (indices.length / 3) | 0;
    let volume = 0;

    for (let f = 0; f < numFaces; f++) {
        const i0 = indices[f * 3] * 3;
        const i1 = indices[f * 3 + 1] * 3;
        const i2 = indices[f * 3 + 2] * 3;

        // V = (1/6) * Σ det([v0, v1, v2])
        const v0x = positions[i0], v0y = positions[i0 + 1], v0z = positions[i0 + 2];
        const v1x = positions[i1], v1y = positions[i1 + 1], v1z = positions[i1 + 2];
        const v2x = positions[i2], v2y = positions[i2 + 1], v2z = positions[i2 + 2];

        volume += v0x * (v1y * v2z - v1z * v2y)
                + v0y * (v1z * v2x - v1x * v2z)
                + v0z * (v1x * v2y - v1y * v2x);
    }

    return volume / 6;
}


// ============================================================================
// EDGE LENGTHS
// ============================================================================

/**
 * Compute lengths of all unique edges.
 * @param {Float32Array} positions — stride 3
 * @param {Uint32Array}  indices   — stride 3
 * @returns {{ edges: Uint32Array, lengths: Float32Array }}
 *   edges: flat pairs [v0, v1, v0, v1, ...], lengths: per-edge length
 */
export function computeEdgeLengths(positions, indices) {
    const numFaces = (indices.length / 3) | 0;
    const edgeSet = new Map(); // key → [v0, v1]

    for (let f = 0; f < numFaces; f++) {
        const base = f * 3;
        for (let k = 0; k < 3; k++) {
            const v0 = indices[base + k];
            const v1 = indices[base + (k + 1) % 3];
            const lo = Math.min(v0, v1), hi = Math.max(v0, v1);
            const key = lo * 0x100000 + hi;
            if (!edgeSet.has(key)) edgeSet.set(key, [lo, hi]);
        }
    }

    const numEdges = edgeSet.size;
    const edges = new Uint32Array(numEdges * 2);
    const lengths = new Float32Array(numEdges);
    let idx = 0;

    for (const [, [v0, v1]] of edgeSet) {
        const p0 = v0 * 3, p1 = v1 * 3;
        const dx = positions[p1] - positions[p0];
        const dy = positions[p1 + 1] - positions[p0 + 1];
        const dz = positions[p1 + 2] - positions[p0 + 2];

        edges[idx * 2] = v0;
        edges[idx * 2 + 1] = v1;
        lengths[idx] = Math.sqrt(dx * dx + dy * dy + dz * dz);
        idx++;
    }

    return { edges, lengths, numEdges };
}


// ============================================================================
// BOUNDING BOX
// ============================================================================

/**
 * Compute axis-aligned bounding box.
 * @param {Float32Array} positions — stride 3
 * @returns {{ min: Float32Array, max: Float32Array, center: Float32Array, size: Float32Array }}
 */
export function computeBoundingBox(positions) {
    const min = new Float32Array([Infinity, Infinity, Infinity]);
    const max = new Float32Array([-Infinity, -Infinity, -Infinity]);
    const numVerts = (positions.length / 3) | 0;

    for (let v = 0; v < numVerts; v++) {
        const vi = v * 3;
        for (let k = 0; k < 3; k++) {
            const val = positions[vi + k];
            if (val < min[k]) min[k] = val;
            if (val > max[k]) max[k] = val;
        }
    }

    const center = new Float32Array(3);
    const size = new Float32Array(3);
    for (let k = 0; k < 3; k++) {
        center[k] = (min[k] + max[k]) * 0.5;
        size[k] = max[k] - min[k];
    }

    return { min, max, center, size };
}


// ============================================================================
// ADJACENCY LISTS
// ============================================================================

/**
 * Build vertex-to-vertex adjacency (sparse neighbor lists).
 * @param {Uint32Array} indices — stride 3
 * @param {number} numVertices
 * @returns {number[][]} — adjacency[v] = [neighbor indices]
 */
export function buildVertexAdjacency(indices, numVertices) {
    const adj = new Array(numVertices);
    for (let i = 0; i < numVertices; i++) adj[i] = [];

    const numFaces = (indices.length / 3) | 0;
    const seen = new Set();

    for (let f = 0; f < numFaces; f++) {
        const base = f * 3;
        for (let k = 0; k < 3; k++) {
            const v0 = indices[base + k];
            const v1 = indices[base + (k + 1) % 3];
            const key0 = v0 * 0x100000 + v1;
            const key1 = v1 * 0x100000 + v0;

            if (!seen.has(key0)) {
                seen.add(key0);
                adj[v0].push(v1);
            }
            if (!seen.has(key1)) {
                seen.add(key1);
                adj[v1].push(v0);
            }
        }
    }

    return adj;
}

/**
 * Build vertex-to-face adjacency.
 * @param {Uint32Array} indices — stride 3
 * @param {number} numVertices
 * @returns {number[][]} — vertexFaces[v] = [face indices]
 */
export function buildVertexFaceAdjacency(indices, numVertices) {
    const vf = new Array(numVertices);
    for (let i = 0; i < numVertices; i++) vf[i] = [];

    const numFaces = (indices.length / 3) | 0;
    for (let f = 0; f < numFaces; f++) {
        const base = f * 3;
        vf[indices[base]].push(f);
        vf[indices[base + 1]].push(f);
        vf[indices[base + 2]].push(f);
    }

    return vf;
}

/**
 * Build face-to-face adjacency (faces sharing an edge).
 * @param {Uint32Array} indices — stride 3
 * @param {number} numFaces
 * @returns {number[][]} — faceAdj[f] = [adjacent face indices]
 */
export function buildFaceAdjacency(indices, numFaces) {
    const adj = new Array(numFaces);
    for (let i = 0; i < numFaces; i++) adj[i] = [];

    // Edge → face map
    const edgeFace = new Map();

    for (let f = 0; f < numFaces; f++) {
        const base = f * 3;
        for (let k = 0; k < 3; k++) {
            const v0 = indices[base + k];
            const v1 = indices[base + (k + 1) % 3];
            const lo = Math.min(v0, v1), hi = Math.max(v0, v1);
            const key = lo * 0x100000 + hi;

            if (edgeFace.has(key)) {
                const otherFace = edgeFace.get(key);
                adj[f].push(otherFace);
                adj[otherFace].push(f);
            } else {
                edgeFace.set(key, f);
            }
        }
    }

    return adj;
}


// ============================================================================
// LAPLACIAN SMOOTHING
// ============================================================================

/**
 * Uniform Laplacian smoothing (iterative).
 * Moves each vertex toward the centroid of its neighbors.
 *
 * @param {Float32Array} positions — stride 3 (modified in place)
 * @param {Uint32Array}  indices   — stride 3
 * @param {number}       iterations — number of smoothing passes (default 1)
 * @param {number}       lambda     — step size 0..1 (default 0.5)
 * @param {Set|null}     pinned     — set of vertex indices to keep fixed
 * @returns {Float32Array} — the modified positions array
 */
export function laplacianSmooth(positions, indices, iterations = 1, lambda = 0.5, pinned = null) {
    const numVerts = (positions.length / 3) | 0;
    const adj = buildVertexAdjacency(indices, numVerts);
    const temp = new Float32Array(positions.length);

    for (let iter = 0; iter < iterations; iter++) {
        temp.set(positions);

        for (let v = 0; v < numVerts; v++) {
            if (pinned && pinned.has(v)) continue;

            const neighbors = adj[v];
            const n = neighbors.length;
            if (n === 0) continue;

            const vi = v * 3;
            let cx = 0, cy = 0, cz = 0;

            for (let j = 0; j < n; j++) {
                const ni = neighbors[j] * 3;
                cx += temp[ni];
                cy += temp[ni + 1];
                cz += temp[ni + 2];
            }

            cx /= n;
            cy /= n;
            cz /= n;

            // Move toward centroid
            positions[vi]     = temp[vi]     + lambda * (cx - temp[vi]);
            positions[vi + 1] = temp[vi + 1] + lambda * (cy - temp[vi + 1]);
            positions[vi + 2] = temp[vi + 2] + lambda * (cz - temp[vi + 2]);
        }
    }

    return positions;
}

/**
 * Taubin smoothing (λ|μ) — Laplacian smooth that preserves volume.
 * Alternates positive (shrinking) and negative (inflating) steps.
 *
 * @param {Float32Array} positions — stride 3 (modified in place)
 * @param {Uint32Array}  indices   — stride 3
 * @param {number}       iterations — number of λ|μ pairs (default 5)
 * @param {number}       lambda     — shrink factor (default 0.5)
 * @param {number}       mu         — inflate factor (default -0.53, must be < -lambda)
 * @param {Set|null}     pinned     — set of vertex indices to keep fixed
 * @returns {Float32Array}
 */
export function taubinSmooth(positions, indices, iterations = 5, lambda = 0.5, mu = -0.53, pinned = null) {
    for (let i = 0; i < iterations; i++) {
        laplacianSmooth(positions, indices, 1, lambda, pinned);
        laplacianSmooth(positions, indices, 1, mu, pinned);
    }
    return positions;
}


// ============================================================================
// COTANGENT LAPLACIAN
// ============================================================================

/**
 * Cotangent-weighted Laplacian smoothing (1 iteration).
 * More geometrically accurate than uniform — preserves curvature better.
 *
 * @param {Float32Array} positions — stride 3 (modified in place)
 * @param {Uint32Array}  indices   — stride 3
 * @param {number}       lambda    — step size (default 0.5)
 * @param {Set|null}     pinned    — pinned vertices
 * @returns {Float32Array}
 */
export function cotangentLaplacianSmooth(positions, indices, lambda = 0.5, pinned = null) {
    const numVerts = (positions.length / 3) | 0;
    const numFaces = (indices.length / 3) | 0;

    // Accumulate cotangent weights per edge
    const weightMap = new Map(); // key → weight
    const weightSum = new Float32Array(numVerts);
    const laplacian = new Float32Array(numVerts * 3);

    for (let f = 0; f < numFaces; f++) {
        const base = f * 3;
        const vi = [indices[base], indices[base + 1], indices[base + 2]];

        for (let k = 0; k < 3; k++) {
            const i = vi[k];
            const j = vi[(k + 1) % 3];
            const opp = vi[(k + 2) % 3];

            // Cotangent of the angle at 'opp'
            const oi = opp * 3, ii = i * 3, ji = j * 3;
            const e1x = positions[ii] - positions[oi];
            const e1y = positions[ii + 1] - positions[oi + 1];
            const e1z = positions[ii + 2] - positions[oi + 2];
            const e2x = positions[ji] - positions[oi];
            const e2y = positions[ji + 1] - positions[oi + 1];
            const e2z = positions[ji + 2] - positions[oi + 2];

            const dotVal = e1x * e2x + e1y * e2y + e1z * e2z;
            const cx = e1y * e2z - e1z * e2y;
            const cy = e1z * e2x - e1x * e2z;
            const cz = e1x * e2y - e1y * e2x;
            const crossLen = Math.sqrt(cx * cx + cy * cy + cz * cz);

            const cotAngle = crossLen > EPSILON ? dotVal / crossLen : 0;
            const w = Math.max(cotAngle * 0.5, 0); // clamp negative weights

            const lo = Math.min(i, j), hi = Math.max(i, j);
            const key = lo * 0x100000 + hi;
            const existing = weightMap.get(key) || 0;
            weightMap.set(key, existing + w);
        }
    }

    // Apply weights
    for (const [key, w] of weightMap) {
        const lo = (key / 0x100000) | 0;
        const hi = key % 0x100000;

        weightSum[lo] += w;
        weightSum[hi] += w;

        const loi = lo * 3, hii = hi * 3;
        const dx = positions[hii] - positions[loi];
        const dy = positions[hii + 1] - positions[loi + 1];
        const dz = positions[hii + 2] - positions[loi + 2];

        laplacian[loi]     += w * dx;
        laplacian[loi + 1] += w * dy;
        laplacian[loi + 2] += w * dz;
        laplacian[hii]     -= w * dx;
        laplacian[hii + 1] -= w * dy;
        laplacian[hii + 2] -= w * dz;
    }

    // Apply displacement
    for (let v = 0; v < numVerts; v++) {
        if (pinned && pinned.has(v)) continue;
        if (weightSum[v] < EPSILON) continue;

        const vi = v * 3;
        const invW = 1 / weightSum[v];
        positions[vi]     += lambda * laplacian[vi]     * invW;
        positions[vi + 1] += lambda * laplacian[vi + 1] * invW;
        positions[vi + 2] += lambda * laplacian[vi + 2] * invW;
    }

    return positions;
}


// ============================================================================
// MESH VALIDATION
// ============================================================================

/**
 * Validate mesh integrity. Returns a report object.
 * @param {Float32Array} positions — stride 3
 * @param {Uint32Array}  indices   — stride 3
 * @returns {{ valid: boolean, issues: string[], stats: object }}
 */
export function validateMesh(positions, indices) {
    const numVerts = (positions.length / 3) | 0;
    const numFaces = (indices.length / 3) | 0;
    const issues = [];

    // Check for NaN/Infinity positions
    let nanCount = 0;
    for (let i = 0; i < positions.length; i++) {
        if (!isFinite(positions[i])) nanCount++;
    }
    if (nanCount > 0) issues.push(`${nanCount} non-finite position values`);

    // Check for out-of-range indices
    let oorCount = 0;
    for (let i = 0; i < indices.length; i++) {
        if (indices[i] >= numVerts) oorCount++;
    }
    if (oorCount > 0) issues.push(`${oorCount} out-of-range vertex indices`);

    // Check for degenerate triangles (zero area)
    const areas = computeFaceAreas(positions, indices);
    let degenerateCount = 0;
    for (let f = 0; f < numFaces; f++) {
        if (areas[f] < EPSILON) degenerateCount++;
    }
    if (degenerateCount > 0) issues.push(`${degenerateCount} degenerate (zero-area) triangles`);

    // Check for duplicate faces
    const faceKeys = new Set();
    let dupFaces = 0;
    for (let f = 0; f < numFaces; f++) {
        const tri = [indices[f * 3], indices[f * 3 + 1], indices[f * 3 + 2]].sort((a, b) => a - b);
        const key = tri[0] * 0x10000000000 + tri[1] * 0x100000 + tri[2];
        if (faceKeys.has(key)) dupFaces++;
        faceKeys.add(key);
    }
    if (dupFaces > 0) issues.push(`${dupFaces} duplicate faces`);

    // Check for non-manifold edges (> 2 faces per edge)
    const edgeCount = new Map();
    for (let f = 0; f < numFaces; f++) {
        const base = f * 3;
        for (let k = 0; k < 3; k++) {
            const v0 = indices[base + k];
            const v1 = indices[base + (k + 1) % 3];
            const lo = Math.min(v0, v1), hi = Math.max(v0, v1);
            const key = lo * 0x100000 + hi;
            edgeCount.set(key, (edgeCount.get(key) || 0) + 1);
        }
    }
    let nonManifold = 0;
    for (const [, count] of edgeCount) {
        if (count > 2) nonManifold++;
    }
    if (nonManifold > 0) issues.push(`${nonManifold} non-manifold edges`);

    // Check for isolated vertices (not referenced by any face)
    const referenced = new Uint8Array(numVerts);
    for (let i = 0; i < indices.length; i++) referenced[indices[i]] = 1;
    let isolated = 0;
    for (let v = 0; v < numVerts; v++) {
        if (!referenced[v]) isolated++;
    }
    if (isolated > 0) issues.push(`${isolated} isolated vertices`);

    // Compute unique edge count
    let boundaryEdges = 0;
    for (const [, count] of edgeCount) {
        if (count === 1) boundaryEdges++;
    }

    return {
        valid: issues.length === 0,
        issues,
        stats: {
            numVertices: numVerts,
            numFaces,
            numEdges: edgeCount.size,
            boundaryEdges,
            nonManifoldEdges: nonManifold,
            degenerateFaces: degenerateCount,
            isolatedVertices: isolated,
            surfaceArea: computeSurfaceArea(positions, indices),
            isClosed: boundaryEdges === 0,
        },
    };
}


// ============================================================================
// CENTROID
// ============================================================================

/**
 * Compute mesh centroid (average of vertex positions).
 * @param {Float32Array} positions — stride 3
 * @returns {Float32Array} — [x, y, z]
 */
export function computeCentroid(positions) {
    const numVerts = (positions.length / 3) | 0;
    const c = new Float32Array(3);
    for (let v = 0; v < numVerts; v++) {
        const vi = v * 3;
        c[0] += positions[vi];
        c[1] += positions[vi + 1];
        c[2] += positions[vi + 2];
    }
    if (numVerts > 0) {
        c[0] /= numVerts;
        c[1] /= numVerts;
        c[2] /= numVerts;
    }
    return c;
}


// ============================================================================
// CONVERSION HELPERS
// ============================================================================

/**
 * Convert from MeshDecimation.js Vertex/Triangle classes to flat arrays.
 * @param {Vertex[]} vertices — array of Vertex instances
 * @param {Triangle[]} triangles — array of Triangle instances
 * @returns {{ positions: Float32Array, indices: Uint32Array }}
 */
export function fromVertexTriangleClasses(vertices, triangles) {
    const positions = new Float32Array(vertices.length * 3);
    for (let i = 0; i < vertices.length; i++) {
        const v = vertices[i];
        positions[i * 3] = v.x;
        positions[i * 3 + 1] = v.y;
        positions[i * 3 + 2] = v.z;
    }

    const indices = new Uint32Array(triangles.length * 3);
    for (let i = 0; i < triangles.length; i++) {
        const t = triangles[i];
        indices[i * 3] = t.v0;
        indices[i * 3 + 1] = t.v1;
        indices[i * 3 + 2] = t.v2;
    }

    return { positions, indices };
}

/**
 * Convert from plain [x,y,z] arrays (MeshCutter style) to flat Float32Array.
 * @param {number[][]} verts — array of [x, y, z]
 * @param {number[][]} faces — array of [i0, i1, i2]
 * @returns {{ positions: Float32Array, indices: Uint32Array }}
 */
export function fromArrays(verts, faces) {
    const positions = new Float32Array(verts.length * 3);
    for (let i = 0; i < verts.length; i++) {
        positions[i * 3] = verts[i][0];
        positions[i * 3 + 1] = verts[i][1];
        positions[i * 3 + 2] = verts[i][2];
    }

    const indices = new Uint32Array(faces.length * 3);
    for (let i = 0; i < faces.length; i++) {
        indices[i * 3] = faces[i][0];
        indices[i * 3 + 1] = faces[i][1];
        indices[i * 3 + 2] = faces[i][2];
    }

    return { positions, indices };
}

/**
 * Convert flat arrays to plain [x,y,z] arrays.
 * @param {Float32Array} positions — stride 3
 * @param {Uint32Array}  indices   — stride 3
 * @returns {{ verts: number[][], faces: number[][] }}
 */
export function toArrays(positions, indices) {
    const numVerts = (positions.length / 3) | 0;
    const numFaces = (indices.length / 3) | 0;
    const verts = new Array(numVerts);
    const faces = new Array(numFaces);

    for (let i = 0; i < numVerts; i++) {
        verts[i] = [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
    }
    for (let i = 0; i < numFaces; i++) {
        faces[i] = [indices[i * 3], indices[i * 3 + 1], indices[i * 3 + 2]];
    }

    return { verts, faces };
}

/**
 * Extract positions/indices from an interleaved GPU vertex buffer + index buffer.
 * @param {Float32Array} interleavedBuffer — interleaved vertex data
 * @param {number}       stride            — floats per vertex (e.g. 8 for pos+normal+uv)
 * @param {number}       posOffset         — float offset of position in stride (usually 0)
 * @param {Uint32Array|Uint16Array} indexBuffer — triangle indices
 * @returns {{ positions: Float32Array, indices: Uint32Array }}
 */
export function fromInterleavedBuffer(interleavedBuffer, stride, posOffset, indexBuffer) {
    const numVerts = (interleavedBuffer.length / stride) | 0;
    const positions = new Float32Array(numVerts * 3);

    for (let v = 0; v < numVerts; v++) {
        const src = v * stride + posOffset;
        positions[v * 3]     = interleavedBuffer[src];
        positions[v * 3 + 1] = interleavedBuffer[src + 1];
        positions[v * 3 + 2] = interleavedBuffer[src + 2];
    }

    const indices = indexBuffer instanceof Uint32Array
        ? indexBuffer
        : new Uint32Array(indexBuffer);

    return { positions, indices };
}
