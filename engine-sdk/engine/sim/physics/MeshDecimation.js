/**
 * MeshDecimation.js - Mesh Simplification for Debris
 * 
 * Reduces triangle count for debris meshes to maintain performance.
 * Two algorithms available:
 * 
 * 1. Grid-Based (Fast): O(n) - Good for realtime debris
 *    - Snap vertices to grid
 *    - Merge coincident vertices
 *    - Remove degenerate triangles
 * 
 * 2. QEM (Quality): O(n log n) - Better for LOD generation
 *    - Quadric Error Metrics
 *    - Edge collapse with priority queue
 *    - Preserves shape better
 * 
 * Performance Targets:
 * - Grid: 10k verts → 500 verts in <1ms
 * - QEM: 10k verts → 500 verts in <50ms
 */

// ============================================================================
// CONSTANTS
// ============================================================================

/** Default grid cell size for grid-based decimation */
export const DEFAULT_GRID_SIZE = 0.5;

/** Default target reduction ratio */
export const DEFAULT_TARGET_RATIO = 0.1;

/** Maximum QEM iterations per frame (for realtime) */
export const MAX_QEM_ITERATIONS = 100;

// ============================================================================
// VERTEX & TRIANGLE STRUCTURES
// ============================================================================

export class Vertex {
    constructor(x = 0, y = 0, z = 0) {
        this.x = x;
        this.y = y;
        this.z = z;
        this.index = -1;
        
        // For QEM
        this.quadric = null;
        this.edges = []; // Adjacent edge indices

        this.uvx = 0;
        this.uvy = 0;
        this.joints0 = null;
        this.weights0 = null;
        this.joints1 = null;
        this.weights1 = null;
    }
    
    distanceTo(other) {
        const dx = this.x - other.x;
        const dy = this.y - other.y;
        const dz = this.z - other.z;
        return Math.sqrt(dx*dx + dy*dy + dz*dz);
    }
    
    equals(other, epsilon = 0.0001) {
        return Math.abs(this.x - other.x) < epsilon &&
               Math.abs(this.y - other.y) < epsilon &&
               Math.abs(this.z - other.z) < epsilon;
    }
    
    toArray() {
        return [this.x, this.y, this.z];
    }
}

export class Triangle {
    constructor(v0, v1, v2) {
        this.v0 = v0; // Vertex index
        this.v1 = v1;
        this.v2 = v2;
        this.removed = false;
    }
    
    hasVertex(vIdx) {
        return this.v0 === vIdx || this.v1 === vIdx || this.v2 === vIdx;
    }
    
    replaceVertex(oldIdx, newIdx) {
        if (this.v0 === oldIdx) this.v0 = newIdx;
        if (this.v1 === oldIdx) this.v1 = newIdx;
        if (this.v2 === oldIdx) this.v2 = newIdx;
    }
    
    isDegenerate() {
        return this.v0 === this.v1 || this.v1 === this.v2 || this.v2 === this.v0;
    }
}

// ============================================================================
// QUADRIC ERROR MATRIX (4x4 symmetric)
// ============================================================================

export class Quadric {
    constructor() {
        // Symmetric 4x4 matrix stored as 10 unique values
        // [a, b, c, d]
        // [b, e, f, g]
        // [c, f, h, i]
        // [d, g, i, j]
        this.a = 0; this.b = 0; this.c = 0; this.d = 0;
        this.e = 0; this.f = 0; this.g = 0;
        this.h = 0; this.i = 0;
        this.j = 0;
    }
    
    /**
     * Create from plane equation ax + by + cz + d = 0
     */
    static fromPlane(a, b, c, d) {
        const q = new Quadric();
        q.a = a * a; q.b = a * b; q.c = a * c; q.d = a * d;
        q.e = b * b; q.f = b * c; q.g = b * d;
        q.h = c * c; q.i = c * d;
        q.j = d * d;
        return q;
    }
    
    /**
     * Create from triangle
     */
    static fromTriangle(v0, v1, v2) {
        // Compute plane normal
        const e1 = [v1.x - v0.x, v1.y - v0.y, v1.z - v0.z];
        const e2 = [v2.x - v0.x, v2.y - v0.y, v2.z - v0.z];
        
        let nx = e1[1] * e2[2] - e1[2] * e2[1];
        let ny = e1[2] * e2[0] - e1[0] * e2[2];
        let nz = e1[0] * e2[1] - e1[1] * e2[0];
        
        const len = Math.sqrt(nx*nx + ny*ny + nz*nz);
        if (len < 0.0001) {
            return new Quadric();
        }
        
        nx /= len; ny /= len; nz /= len;
        const d = -(nx * v0.x + ny * v0.y + nz * v0.z);
        
        return Quadric.fromPlane(nx, ny, nz, d);
    }
    
    /**
     * Add another quadric
     */
    add(other) {
        this.a += other.a; this.b += other.b; this.c += other.c; this.d += other.d;
        this.e += other.e; this.f += other.f; this.g += other.g;
        this.h += other.h; this.i += other.i;
        this.j += other.j;
        return this;
    }
    
    /**
     * Evaluate error at point
     */
    evaluate(x, y, z) {
        return this.a*x*x + 2*this.b*x*y + 2*this.c*x*z + 2*this.d*x +
               this.e*y*y + 2*this.f*y*z + 2*this.g*y +
               this.h*z*z + 2*this.i*z +
               this.j;
    }
    
    /**
     * Find optimal point that minimizes error
     * Returns null if matrix is singular
     */
    findOptimalPoint() {
        // Solve the linear system:
        // [a b c] [x]   [-d]
        // [b e f] [y] = [-g]
        // [c f h] [z]   [-i]
        
        const det = this.a * (this.e * this.h - this.f * this.f) -
                    this.b * (this.b * this.h - this.f * this.c) +
                    this.c * (this.b * this.f - this.e * this.c);
        
        if (Math.abs(det) < 1e-10) {
            return null;
        }
        
        const invDet = 1 / det;
        
        const x = invDet * (
            -this.d * (this.e * this.h - this.f * this.f) +
            -this.g * (this.c * this.f - this.b * this.h) +
            -this.i * (this.b * this.f - this.c * this.e)
        );
        
        const y = invDet * (
            -this.d * (this.c * this.f - this.b * this.h) +
            -this.g * (this.a * this.h - this.c * this.c) +
            -this.i * (this.b * this.c - this.a * this.f)
        );
        
        const z = invDet * (
            -this.d * (this.b * this.f - this.c * this.e) +
            -this.g * (this.b * this.c - this.a * this.f) +
            -this.i * (this.a * this.e - this.b * this.b)
        );
        
        return new Vertex(x, y, z);
    }
    
    clone() {
        const q = new Quadric();
        q.a = this.a; q.b = this.b; q.c = this.c; q.d = this.d;
        q.e = this.e; q.f = this.f; q.g = this.g;
        q.h = this.h; q.i = this.i;
        q.j = this.j;
        return q;
    }
}

// ============================================================================
// EDGE FOR QEM
// ============================================================================

export class Edge {
    constructor(v0, v1) {
        // Always store with smaller index first
        this.v0 = Math.min(v0, v1);
        this.v1 = Math.max(v0, v1);
        this.error = 0;
        this.optimalPoint = null;
        this.removed = false;
        this.heapIndex = -1;
    }
    
    getKey() {
        return `${this.v0}_${this.v1}`;
    }
}

// ============================================================================
// MIN HEAP FOR EDGE PRIORITY QUEUE
// ============================================================================

class EdgeHeap {
    constructor() {
        this.heap = [];
    }
    
    push(edge) {
        edge.heapIndex = this.heap.length;
        this.heap.push(edge);
        this._bubbleUp(this.heap.length - 1);
    }
    
    pop() {
        if (this.heap.length === 0) return null;
        
        const min = this.heap[0];
        const last = this.heap.pop();
        
        if (this.heap.length > 0) {
            this.heap[0] = last;
            last.heapIndex = 0;
            this._bubbleDown(0);
        }
        
        min.heapIndex = -1;
        return min;
    }
    
    update(edge) {
        if (edge.heapIndex < 0) return;
        this._bubbleUp(edge.heapIndex);
        this._bubbleDown(edge.heapIndex);
    }
    
    remove(edge) {
        if (edge.heapIndex < 0) return;
        
        const idx = edge.heapIndex;
        const last = this.heap.pop();
        
        if (idx < this.heap.length) {
            this.heap[idx] = last;
            last.heapIndex = idx;
            this._bubbleUp(idx);
            this._bubbleDown(idx);
        }
        
        edge.heapIndex = -1;
    }
    
    get size() {
        return this.heap.length;
    }
    
    _bubbleUp(idx) {
        while (idx > 0) {
            const parent = Math.floor((idx - 1) / 2);
            if (this.heap[parent].error <= this.heap[idx].error) break;
            
            this._swap(parent, idx);
            idx = parent;
        }
    }
    
    _bubbleDown(idx) {
        while (true) {
            const left = 2 * idx + 1;
            const right = 2 * idx + 2;
            let smallest = idx;
            
            if (left < this.heap.length && this.heap[left].error < this.heap[smallest].error) {
                smallest = left;
            }
            if (right < this.heap.length && this.heap[right].error < this.heap[smallest].error) {
                smallest = right;
            }
            
            if (smallest === idx) break;
            
            this._swap(idx, smallest);
            idx = smallest;
        }
    }
    
    _swap(i, j) {
        const tmp = this.heap[i];
        this.heap[i] = this.heap[j];
        this.heap[j] = tmp;
        this.heap[i].heapIndex = i;
        this.heap[j].heapIndex = j;
    }
}

// ============================================================================
// GRID-BASED DECIMATION (FAST)
// ============================================================================

/**
 * Fast grid-based mesh decimation
 * @param {number[]} vertices - Flat array [x,y,z, x,y,z, ...]
 * @param {number[]} indices - Triangle indices
 * @param {number} gridSize - Cell size for vertex snapping
 * @returns {{ vertices: number[], indices: number[] }}
 */
export function decimateGrid(vertices, indices, gridSize = DEFAULT_GRID_SIZE) {
    const vertexCount = vertices.length / 3;
    const triangleCount = indices.length / 3;
    
    // Map: grid cell key → new vertex index
    const cellToVertex = new Map();
    // Map: old vertex index → new vertex index
    const vertexRemap = new Int32Array(vertexCount);
    
    const newVertices = [];
    const cellAccum = new Map(); // Accumulate positions for averaging
    
    // Pass 1: Assign vertices to grid cells
    for (let i = 0; i < vertexCount; i++) {
        const x = vertices[i * 3 + 0];
        const y = vertices[i * 3 + 1];
        const z = vertices[i * 3 + 2];
        
        // Grid cell coordinates
        const gx = Math.floor(x / gridSize);
        const gy = Math.floor(y / gridSize);
        const gz = Math.floor(z / gridSize);
        const key = `${gx},${gy},${gz}`;
        
        if (cellToVertex.has(key)) {
            // Existing cell - accumulate position
            vertexRemap[i] = cellToVertex.get(key);
            const accum = cellAccum.get(key);
            accum.x += x;
            accum.y += y;
            accum.z += z;
            accum.count++;
        } else {
            // New cell
            const newIdx = newVertices.length / 3;
            cellToVertex.set(key, newIdx);
            cellAccum.set(key, { x, y, z, count: 1 });
            vertexRemap[i] = newIdx;
            newVertices.push(x, y, z); // Placeholder
        }
    }
    
    // Pass 2: Compute averaged vertex positions
    for (const [key, accum] of cellAccum) {
        const newIdx = cellToVertex.get(key);
        newVertices[newIdx * 3 + 0] = accum.x / accum.count;
        newVertices[newIdx * 3 + 1] = accum.y / accum.count;
        newVertices[newIdx * 3 + 2] = accum.z / accum.count;
    }
    
    // Pass 3: Remap indices and remove degenerate triangles
    const newIndices = [];
    for (let i = 0; i < triangleCount; i++) {
        const i0 = vertexRemap[indices[i * 3 + 0]];
        const i1 = vertexRemap[indices[i * 3 + 1]];
        const i2 = vertexRemap[indices[i * 3 + 2]];
        
        // Skip degenerate triangles
        if (i0 !== i1 && i1 !== i2 && i2 !== i0) {
            newIndices.push(i0, i1, i2);
        }
    }
    
    return {
        vertices: newVertices,
        indices: newIndices,
        reduction: 1 - (newVertices.length / 3) / vertexCount,
    };
}

// ============================================================================
// QEM DECIMATION (QUALITY)
// ============================================================================

/**
 * QEM-based mesh decimation
 * @param {number[]} vertices - Flat array [x,y,z, ...]
 * @param {number[]} indices - Triangle indices
 * @param {number} targetRatio - Target vertex count ratio (0.1 = 10% of original)
 * @param {number} maxIterations - Max edge collapses (for realtime)
 * @returns {{ vertices: number[], indices: number[] }}
 */
export function decimateQEM(vertices, indices, targetRatio = DEFAULT_TARGET_RATIO, maxIterations = Infinity, options = null) {
    const initialVertexCount = vertices.length / 3;
    const targetVertexCount = Math.max(4, Math.floor(initialVertexCount * targetRatio));

    const opts = options || null;
    const uvs = opts && opts.uvs ? opts.uvs : null;
    const joints0 = opts && opts.joints0 ? opts.joints0 : null;
    const weights0 = opts && opts.weights0 ? opts.weights0 : null;
    const joints1 = opts && opts.joints1 ? opts.joints1 : null;
    const weights1 = opts && opts.weights1 ? opts.weights1 : null;

    const hasUvs = !!(uvs && uvs.length >= initialVertexCount * 2);
    const hasSkin0 = !!(joints0 && weights0 && joints0.length >= initialVertexCount * 4 && weights0.length >= initialVertexCount * 4);
    const hasSkin1 = !!(joints1 && weights1 && joints1.length >= initialVertexCount * 4 && weights1.length >= initialVertexCount * 4);
    
    // Build vertex and triangle arrays
    const verts = [];
    for (let i = 0; i < initialVertexCount; i++) {
        const v = new Vertex(
            vertices[i * 3 + 0],
            vertices[i * 3 + 1],
            vertices[i * 3 + 2]
        );
        v.index = i;
        v.quadric = new Quadric();

        if (hasUvs) {
            v.uvx = uvs[i * 2 + 0];
            v.uvy = uvs[i * 2 + 1];
        }

        if (hasSkin0) {
            const b = i * 4;
            v.joints0 = [joints0[b + 0], joints0[b + 1], joints0[b + 2], joints0[b + 3]];
            v.weights0 = [weights0[b + 0], weights0[b + 1], weights0[b + 2], weights0[b + 3]];
        }

        if (hasSkin1) {
            const b = i * 4;
            v.joints1 = [joints1[b + 0], joints1[b + 1], joints1[b + 2], joints1[b + 3]];
            v.weights1 = [weights1[b + 0], weights1[b + 1], weights1[b + 2], weights1[b + 3]];
        }
        verts.push(v);
    }

    const vertTris = new Array(verts.length);
    for (let i = 0; i < verts.length; i++) {
        vertTris[i] = new Set();
    }
    
    const tris = [];
    for (let i = 0; i < indices.length / 3; i++) {
        const tri = new Triangle(
            indices[i * 3 + 0],
            indices[i * 3 + 1],
            indices[i * 3 + 2]
        );
        tris.push(tri);

        vertTris[tri.v0].add(i);
        vertTris[tri.v1].add(i);
        vertTris[tri.v2].add(i);
        
        // Add quadric from this triangle to each vertex
        const q = Quadric.fromTriangle(
            verts[tri.v0],
            verts[tri.v1],
            verts[tri.v2]
        );
        verts[tri.v0].quadric.add(q);
        verts[tri.v1].quadric.add(q);
        verts[tri.v2].quadric.add(q);
    }
    
    // Build edge set and compute initial errors
    const edgeMap = new Map();
    const edgeHeap = new EdgeHeap();

    const rebuildEdgesForVertex = (vertexIndex) => {
        const v = verts[vertexIndex];
        if (!v || v.index < 0) return;

        const oldEdgeKeys = v.edges || [];

        const neighbors = new Set();
        const triSet = vertTris[vertexIndex];
        if (triSet) {
            for (const triIndex of triSet) {
                const tri = tris[triIndex];
                if (!tri || tri.removed) continue;
                if (tri.v0 !== vertexIndex && verts[tri.v0] && verts[tri.v0].index >= 0) neighbors.add(tri.v0);
                if (tri.v1 !== vertexIndex && verts[tri.v1] && verts[tri.v1].index >= 0) neighbors.add(tri.v1);
                if (tri.v2 !== vertexIndex && verts[tri.v2] && verts[tri.v2].index >= 0) neighbors.add(tri.v2);
            }
        }

        const newEdgeKeys = [];
        for (const n of neighbors) {
            if (n === vertexIndex) continue;

            const tmp = new Edge(vertexIndex, n);
            const key = tmp.getKey();
            let e = edgeMap.get(key);

            if (!e || e.removed) {
                e = new Edge(vertexIndex, n);
                computeEdgeError(e, verts, options);
                edgeMap.set(key, e);
                edgeHeap.push(e);
            } else {
                computeEdgeError(e, verts, options);
                edgeHeap.update(e);
            }

            newEdgeKeys.push(key);

            const other = verts[n];
            if (other && other.edges && !other.edges.includes(key)) {
                other.edges.push(key);
            }
        }

        if (oldEdgeKeys && oldEdgeKeys.length > 0) {
            const keep = new Set(newEdgeKeys);
            for (const edgeKey of oldEdgeKeys) {
                if (keep.has(edgeKey)) continue;
                const e = edgeMap.get(edgeKey);
                if (e && !e.removed) {
                    e.removed = true;
                    edgeHeap.remove(e);
                }
            }
        }

        v.edges = newEdgeKeys;
    };
    
    for (const tri of tris) {
        const pairs = [
            [tri.v0, tri.v1],
            [tri.v1, tri.v2],
            [tri.v2, tri.v0],
        ];
        
        for (const [a, b] of pairs) {
            const edge = new Edge(a, b);
            const key = edge.getKey();
            
            if (!edgeMap.has(key)) {
                computeEdgeError(edge, verts, options);
                edgeMap.set(key, edge);
                edgeHeap.push(edge);
                
                verts[a].edges.push(key);
                verts[b].edges.push(key);
            }
        }
    }
    
    // Collapse edges until target reached
    let currentVertexCount = initialVertexCount;
    let iterations = 0;
    
    while (currentVertexCount > targetVertexCount && 
           edgeHeap.size > 0 && 
           iterations < maxIterations) {
        
        const edge = edgeHeap.pop();
        if (edge.removed) continue;
        
        const v0 = verts[edge.v0];
        const v1 = verts[edge.v1];
        
        // Skip if either vertex already removed
        if (v0.index < 0 || v1.index < 0) continue;
        
        // Collapse v1 into v0
        const newPos = edge.optimalPoint || v0;
        v0.x = newPos.x;
        v0.y = newPos.y;
        v0.z = newPos.z;

        if (hasUvs) {
            v0.uvx = (v0.uvx + v1.uvx) * 0.5;
            v0.uvy = (v0.uvy + v1.uvy) * 0.5;
        }

        if (hasSkin0) {
            mergeVertexInfluences(v0, v1);
        }
        
        // Merge quadrics
        v0.quadric.add(v1.quadric);
        
        // Mark v1 as removed
        v1.index = -1;
        currentVertexCount--;
        
        const v1Tris = vertTris[edge.v1];
        if (v1Tris && v1Tris.size > 0) {
            for (const triIndex of v1Tris) {
                const tri = tris[triIndex];
                if (!tri || tri.removed) continue;
                if (!tri.hasVertex(edge.v1)) continue;

                tri.replaceVertex(edge.v1, edge.v0);
                vertTris[edge.v0].add(triIndex);

                if (tri.isDegenerate()) {
                    tri.removed = true;
                }
            }
            v1Tris.clear();
        }
        
        // Remove edges connected to v1, update edges connected to v0
        for (const edgeKey of v1.edges) {
            const e = edgeMap.get(edgeKey);
            if (e && !e.removed) {
                e.removed = true;
                edgeHeap.remove(e);
            }
        }

        rebuildEdgesForVertex(edge.v0);
        
        iterations++;
    }
    
    // Rebuild output arrays
    const vertexRemap = new Int32Array(verts.length).fill(-1);
    const newVertices = [];
    let newIdx = 0;
    
    for (let i = 0; i < verts.length; i++) {
        if (verts[i].index >= 0) {
            vertexRemap[i] = newIdx++;
            newVertices.push(verts[i].x, verts[i].y, verts[i].z);
        }
    }
    
    const newIndices = [];
    for (const tri of tris) {
        if (tri.removed) continue;
        
        const i0 = vertexRemap[tri.v0];
        const i1 = vertexRemap[tri.v1];
        const i2 = vertexRemap[tri.v2];
        
        if (i0 >= 0 && i1 >= 0 && i2 >= 0 && i0 !== i1 && i1 !== i2 && i2 !== i0) {
            newIndices.push(i0, i1, i2);
        }
    }
    
    const result = {
        vertices: newVertices,
        indices: newIndices,
        reduction: 1 - (newVertices.length / 3) / initialVertexCount,
        iterations,
    };

    if (hasUvs) {
        const outUvs = new Float32Array(newIdx * 2);
        for (let i = 0; i < verts.length; i++) {
            const m = vertexRemap[i];
            if (m < 0) continue;
            outUvs[m * 2 + 0] = verts[i].uvx;
            outUvs[m * 2 + 1] = verts[i].uvy;
        }
        result.uvs = outUvs;
    }

    if (hasSkin0) {
        const J0Ctor = joints0 && joints0.constructor ? joints0.constructor : Uint16Array;
        const J1Ctor = joints1 && joints1.constructor ? joints1.constructor : J0Ctor;
        const outJoints0 = new J0Ctor(newIdx * 4);
        const outWeights0 = new Float32Array(newIdx * 4);
        const outJoints1 = hasSkin1 ? new J1Ctor(newIdx * 4) : null;
        const outWeights1 = hasSkin1 ? new Float32Array(newIdx * 4) : null;

        for (let i = 0; i < verts.length; i++) {
            const m = vertexRemap[i];
            if (m < 0) continue;
            const v = verts[i];
            const o = m * 4;

            if (v.joints0 && v.weights0) {
                outJoints0[o + 0] = v.joints0[0] | 0;
                outJoints0[o + 1] = v.joints0[1] | 0;
                outJoints0[o + 2] = v.joints0[2] | 0;
                outJoints0[o + 3] = v.joints0[3] | 0;
                outWeights0[o + 0] = v.weights0[0] || 0;
                outWeights0[o + 1] = v.weights0[1] || 0;
                outWeights0[o + 2] = v.weights0[2] || 0;
                outWeights0[o + 3] = v.weights0[3] || 0;
            }

            if (outJoints1 && outWeights1 && v.joints1 && v.weights1) {
                outJoints1[o + 0] = v.joints1[0] | 0;
                outJoints1[o + 1] = v.joints1[1] | 0;
                outJoints1[o + 2] = v.joints1[2] | 0;
                outJoints1[o + 3] = v.joints1[3] | 0;
                outWeights1[o + 0] = v.weights1[0] || 0;
                outWeights1[o + 1] = v.weights1[1] || 0;
                outWeights1[o + 2] = v.weights1[2] || 0;
                outWeights1[o + 3] = v.weights1[3] || 0;
            }
        }

        result.joints0 = outJoints0;
        result.weights0 = outWeights0;
        if (outJoints1 && outWeights1) {
            result.joints1 = outJoints1;
            result.weights1 = outWeights1;
        }
    }

    return result;
}

function getVertexInfluenceMap(v) {
    const m = new Map();
    if (!v) return m;

    if (v.joints0 && v.weights0) {
        for (let i = 0; i < 4; i++) {
            const w = v.weights0[i] || 0;
            if (w <= 0) continue;
            const j = v.joints0[i] | 0;
            m.set(j, (m.get(j) || 0) + w);
        }
    }

    if (v.joints1 && v.weights1) {
        for (let i = 0; i < 4; i++) {
            const w = v.weights1[i] || 0;
            if (w <= 0) continue;
            const j = v.joints1[i] | 0;
            m.set(j, (m.get(j) || 0) + w);
        }
    }

    return m;
}

function setVertexInfluencesFromMap(v, m) {
    const entries = [];
    for (const [j, w] of m.entries()) {
        if (w > 0) entries.push([j, w]);
    }

    entries.sort((a, b) => b[1] - a[1]);
    if (entries.length > 8) entries.length = 8;

    let sum = 0;
    for (const e of entries) sum += e[1];
    if (sum <= 0) {
        v.joints0 = [0, 0, 0, 0];
        v.weights0 = [0, 0, 0, 0];
        v.joints1 = [0, 0, 0, 0];
        v.weights1 = [0, 0, 0, 0];
        return;
    }

    const norm = 1 / sum;
    const j0 = [0, 0, 0, 0];
    const w0 = [0, 0, 0, 0];
    const j1 = [0, 0, 0, 0];
    const w1 = [0, 0, 0, 0];

    for (let i = 0; i < entries.length; i++) {
        const j = entries[i][0] | 0;
        const w = entries[i][1] * norm;
        if (i < 4) {
            j0[i] = j;
            w0[i] = w;
        } else {
            j1[i - 4] = j;
            w1[i - 4] = w;
        }
    }

    v.joints0 = j0;
    v.weights0 = w0;
    v.joints1 = j1;
    v.weights1 = w1;
}

function mergeVertexInfluences(dst, src) {
    if (!dst || !src) return;
    const a = getVertexInfluenceMap(dst);
    const b = getVertexInfluenceMap(src);
    for (const [j, w] of b.entries()) {
        a.set(j, (a.get(j) || 0) + w);
    }
    setVertexInfluencesFromMap(dst, a);
}

function boneWeightDifference(a, b) {
    const am = getVertexInfluenceMap(a);
    const bm = getVertexInfluenceMap(b);
    if (am.size === 0 && bm.size === 0) return 0;

    let diff = 0;
    for (const [j, w] of am.entries()) {
        diff += Math.abs(w - (bm.get(j) || 0));
    }
    for (const [j, w] of bm.entries()) {
        if (am.has(j)) continue;
        diff += Math.abs(w);
    }
    return diff;
}

/**
 * Compute error for collapsing an edge
 */
function computeEdgeError(edge, verts, options = null) {
    const v0 = verts[edge.v0];
    const v1 = verts[edge.v1];

    if (!v0 || !v1 || v0.index < 0 || v1.index < 0) {
        edge.error = Infinity;
        edge.optimalPoint = null;
        return;
    }

    if (options && options.preventUVSeamCollapse) {
        const thr = Number.isFinite(options.uvSeamThreshold) ? options.uvSeamThreshold : 1e-5;
        const du = Math.abs((v0.uvx || 0) - (v1.uvx || 0));
        const dv = Math.abs((v0.uvy || 0) - (v1.uvy || 0));
        if (du > thr || dv > thr) {
            edge.error = Infinity;
            edge.optimalPoint = null;
            return;
        }
    }
    
    // Combined quadric
    const q = v0.quadric.clone().add(v1.quadric);
    
    // Try to find optimal point
    const optimal = q.findOptimalPoint();
    
    if (optimal) {
        edge.optimalPoint = optimal;
        edge.error = q.evaluate(optimal.x, optimal.y, optimal.z);
    } else {
        // Fallback: use midpoint
        edge.optimalPoint = new Vertex(
            (v0.x + v1.x) / 2,
            (v0.y + v1.y) / 2,
            (v0.z + v1.z) / 2
        );
        edge.error = q.evaluate(edge.optimalPoint.x, edge.optimalPoint.y, edge.optimalPoint.z);
    }
    
    // Penalize long edges to preserve shape
    const length = v0.distanceTo(v1);
    edge.error += length * 0.001;

    if (options && Number.isFinite(options.boneWeightPenalty) && options.boneWeightPenalty > 0) {
        const bd = boneWeightDifference(v0, v1);
        edge.error *= (1 + bd * options.boneWeightPenalty);
    }
}

// ============================================================================
// MESH DECIMATOR CLASS
// ============================================================================

export class MeshDecimator {
    constructor(options = {}) {
        this.gridSize = options.gridSize ?? DEFAULT_GRID_SIZE;
        this.targetRatio = options.targetRatio ?? DEFAULT_TARGET_RATIO;
        this.maxIterations = options.maxIterations ?? MAX_QEM_ITERATIONS;
        this.method = options.method ?? 'grid'; // 'grid' or 'qem'
    }
    
    /**
     * Decimate a mesh
     * @param {number[]} vertices 
     * @param {number[]} indices 
     * @returns {{ vertices: number[], indices: number[], reduction: number }}
     */
    decimate(vertices, indices, options = null) {
        if (this.method === 'qem') {
            return decimateQEM(vertices, indices, this.targetRatio, this.maxIterations, options);
        } else {
            return decimateGrid(vertices, indices, this.gridSize);
        }
    }
    
    /**
     * Decimate with automatic method selection based on size
     */
    decimateAuto(vertices, indices, options = null) {
        const vertexCount = vertices.length / 3;
        
        // Use grid for large meshes (faster), QEM for smaller (better quality)
        if (vertexCount > 5000) {
            return decimateGrid(vertices, indices, this.gridSize);
        } else {
            return decimateQEM(vertices, indices, this.targetRatio, this.maxIterations, options);
        }
    }
}

export default {
    decimateGrid,
    decimateQEM,
    MeshDecimator,
    Quadric,
    DEFAULT_GRID_SIZE,
    DEFAULT_TARGET_RATIO,
};
