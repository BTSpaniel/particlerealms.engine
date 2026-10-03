// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * BVHAccel.js - Bounding Volume Hierarchy for Mesh Ray Tracing
 * 
 * Based on techniques from jakubg05/Laura path tracing engine.
 * Provides BVH construction and traversal for efficient mesh raycasting.
 * 
 * Features:
 * - SAH (Surface Area Heuristic) BVH construction
 * - Stack-based iterative traversal (GPU-friendly)
 * - Möller-Trumbore ray-triangle intersection
 * - CPU builder + GPU traversal shader
 * 
 * Reference: https://jacco.ompf2.com/2022/04/13/how-to-build-a-bvh-part-1-basics/
 */

// ============================================================================
// CONSTANTS
// ============================================================================

export const INF_T = 1e30;
export const EPSILON = 1e-6;

// ============================================================================
// BVH NODE STRUCTURE
// ============================================================================

/**
 * BVH Node - 32 bytes aligned for GPU
 * If triCount == 0: internal node, leftChild_Or_FirstTri = left child index
 * If triCount > 0: leaf node, leftChild_Or_FirstTri = first triangle index
 */
export class BVHNode {
    constructor() {
        this.min = [INF_T, INF_T, INF_T];      // AABB min (12 bytes)
        this.leftChild_Or_FirstTri = 0;         // 4 bytes
        this.max = [-INF_T, -INF_T, -INF_T];   // AABB max (12 bytes)
        this.triCount = 0;                      // 4 bytes
    }
    
    isLeaf() {
        return this.triCount > 0;
    }
}

// ============================================================================
// BVH BUILDER (CPU)
// ============================================================================

/**
 * Build BVH from triangle mesh
 * Uses Surface Area Heuristic for optimal splits
 */
export class BVHBuilder {
    constructor() {
        this.nodes = [];
        this.triIndices = [];
        this.triangles = [];
        this.centroids = [];
        this.nodesUsed = 0;
    }
    
    /**
     * Build BVH from triangles
     * @param {Array} vertices - Flat array of vertex positions [x,y,z, x,y,z, ...]
     * @param {Array} indices - Triangle indices [i0,i1,i2, i0,i1,i2, ...]
     * @returns {Object} {nodes, triIndices}
     */
    build(vertices, indices) {
        const triCount = indices.length / 3;
        
        // Extract triangles and compute centroids
        this.triangles = [];
        this.centroids = [];
        this.triIndices = [];
        
        for (let i = 0; i < triCount; i++) {
            const i0 = indices[i * 3];
            const i1 = indices[i * 3 + 1];
            const i2 = indices[i * 3 + 2];
            
            const v0 = [vertices[i0 * 3], vertices[i0 * 3 + 1], vertices[i0 * 3 + 2]];
            const v1 = [vertices[i1 * 3], vertices[i1 * 3 + 1], vertices[i1 * 3 + 2]];
            const v2 = [vertices[i2 * 3], vertices[i2 * 3 + 1], vertices[i2 * 3 + 2]];
            
            this.triangles.push({ v0, v1, v2 });
            this.centroids.push([
                (v0[0] + v1[0] + v2[0]) / 3,
                (v0[1] + v1[1] + v2[1]) / 3,
                (v0[2] + v1[2] + v2[2]) / 3,
            ]);
            this.triIndices.push(i);
        }
        
        // Allocate nodes (worst case: 2N-1 nodes for N triangles)
        this.nodes = new Array(triCount * 2 - 1);
        for (let i = 0; i < this.nodes.length; i++) {
            this.nodes[i] = new BVHNode();
        }
        this.nodesUsed = 1;
        
        // Initialize root node
        const root = this.nodes[0];
        root.leftChild_Or_FirstTri = 0;
        root.triCount = triCount;
        
        this.updateNodeBounds(0);
        this.subdivide(0);
        
        // Trim unused nodes
        this.nodes.length = this.nodesUsed;
        
        return {
            nodes: this.nodes,
            triIndices: this.triIndices,
            triangles: this.triangles,
        };
    }
    
    /**
     * Update node AABB from its triangles
     */
    updateNodeBounds(nodeIdx) {
        const node = this.nodes[nodeIdx];
        node.min = [INF_T, INF_T, INF_T];
        node.max = [-INF_T, -INF_T, -INF_T];
        
        const first = node.leftChild_Or_FirstTri;
        for (let i = 0; i < node.triCount; i++) {
            const triIdx = this.triIndices[first + i];
            const tri = this.triangles[triIdx];
            
            for (let j = 0; j < 3; j++) {
                node.min[j] = Math.min(node.min[j], tri.v0[j], tri.v1[j], tri.v2[j]);
                node.max[j] = Math.max(node.max[j], tri.v0[j], tri.v1[j], tri.v2[j]);
            }
        }
    }
    
    /**
     * Recursively subdivide node using SAH
     */
    subdivide(nodeIdx) {
        const node = this.nodes[nodeIdx];
        
        // Stop if too few triangles
        if (node.triCount <= 2) return;
        
        // Find best split using SAH
        const { axis, splitPos, cost } = this.findBestSplit(nodeIdx);
        
        // Check if split is worth it
        const noSplitCost = node.triCount * this.nodeArea(node);
        if (cost >= noSplitCost) return;
        
        // Partition triangles
        const first = node.leftChild_Or_FirstTri;
        let i = first;
        let j = first + node.triCount - 1;
        
        while (i <= j) {
            if (this.centroids[this.triIndices[i]][axis] < splitPos) {
                i++;
            } else {
                // Swap
                const tmp = this.triIndices[i];
                this.triIndices[i] = this.triIndices[j];
                this.triIndices[j] = tmp;
                j--;
            }
        }
        
        const leftCount = i - first;
        if (leftCount === 0 || leftCount === node.triCount) return;
        
        // Create child nodes
        const leftChildIdx = this.nodesUsed++;
        const rightChildIdx = this.nodesUsed++;
        
        this.nodes[leftChildIdx].leftChild_Or_FirstTri = first;
        this.nodes[leftChildIdx].triCount = leftCount;
        this.nodes[rightChildIdx].leftChild_Or_FirstTri = i;
        this.nodes[rightChildIdx].triCount = node.triCount - leftCount;
        
        // Convert parent to internal node
        node.leftChild_Or_FirstTri = leftChildIdx;
        node.triCount = 0;
        
        // Update bounds and recurse
        this.updateNodeBounds(leftChildIdx);
        this.updateNodeBounds(rightChildIdx);
        this.subdivide(leftChildIdx);
        this.subdivide(rightChildIdx);
    }
    
    /**
     * Find best split plane using Surface Area Heuristic
     */
    findBestSplit(nodeIdx) {
        const node = this.nodes[nodeIdx];
        let bestCost = INF_T;
        let bestAxis = 0;
        let bestPos = 0;
        
        for (let axis = 0; axis < 3; axis++) {
            // Try 8 evenly spaced split positions
            const min = node.min[axis];
            const max = node.max[axis];
            
            for (let i = 1; i < 8; i++) {
                const splitPos = min + (max - min) * i / 8;
                const cost = this.evaluateSAH(nodeIdx, axis, splitPos);
                if (cost < bestCost) {
                    bestCost = cost;
                    bestAxis = axis;
                    bestPos = splitPos;
                }
            }
        }
        
        return { axis: bestAxis, splitPos: bestPos, cost: bestCost };
    }
    
    /**
     * Evaluate SAH cost for a split
     */
    evaluateSAH(nodeIdx, axis, splitPos) {
        const node = this.nodes[nodeIdx];
        const first = node.leftChild_Or_FirstTri;
        
        // Compute bounds for left and right
        const leftMin = [INF_T, INF_T, INF_T];
        const leftMax = [-INF_T, -INF_T, -INF_T];
        const rightMin = [INF_T, INF_T, INF_T];
        const rightMax = [-INF_T, -INF_T, -INF_T];
        let leftCount = 0, rightCount = 0;
        
        for (let i = 0; i < node.triCount; i++) {
            const triIdx = this.triIndices[first + i];
            const centroid = this.centroids[triIdx];
            const tri = this.triangles[triIdx];
            
            if (centroid[axis] < splitPos) {
                leftCount++;
                for (let j = 0; j < 3; j++) {
                    leftMin[j] = Math.min(leftMin[j], tri.v0[j], tri.v1[j], tri.v2[j]);
                    leftMax[j] = Math.max(leftMax[j], tri.v0[j], tri.v1[j], tri.v2[j]);
                }
            } else {
                rightCount++;
                for (let j = 0; j < 3; j++) {
                    rightMin[j] = Math.min(rightMin[j], tri.v0[j], tri.v1[j], tri.v2[j]);
                    rightMax[j] = Math.max(rightMax[j], tri.v0[j], tri.v1[j], tri.v2[j]);
                }
            }
        }
        
        if (leftCount === 0 || rightCount === 0) return INF_T;
        
        const leftArea = this.boxArea(leftMin, leftMax);
        const rightArea = this.boxArea(rightMin, rightMax);
        
        return leftCount * leftArea + rightCount * rightArea;
    }
    
    /**
     * Compute surface area of AABB
     */
    boxArea(min, max) {
        const e = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
        return 2 * (e[0] * e[1] + e[1] * e[2] + e[2] * e[0]);
    }
    
    nodeArea(node) {
        return this.boxArea(node.min, node.max);
    }
}

// ============================================================================
// RAY-TRIANGLE INTERSECTION (Möller-Trumbore)
// ============================================================================

/**
 * Möller-Trumbore ray-triangle intersection
 * @param {number[]} origin - Ray origin [x, y, z]
 * @param {number[]} dir - Ray direction [x, y, z] (normalized)
 * @param {Object} tri - Triangle {v0, v1, v2}
 * @param {number} tMax - Maximum t value
 * @returns {Object|null} {t, u, v, normal} or null
 */
export function rayTriangleIntersect(origin, dir, tri, tMax = INF_T) {
    const edge1 = [
        tri.v1[0] - tri.v0[0],
        tri.v1[1] - tri.v0[1],
        tri.v1[2] - tri.v0[2],
    ];
    const edge2 = [
        tri.v2[0] - tri.v0[0],
        tri.v2[1] - tri.v0[1],
        tri.v2[2] - tri.v0[2],
    ];
    
    // Cross product: h = dir × edge2
    const h = [
        dir[1] * edge2[2] - dir[2] * edge2[1],
        dir[2] * edge2[0] - dir[0] * edge2[2],
        dir[0] * edge2[1] - dir[1] * edge2[0],
    ];
    
    const a = edge1[0] * h[0] + edge1[1] * h[1] + edge1[2] * h[2];
    
    // Parallel or backfacing
    if (a > -EPSILON && a < EPSILON) return null;
    
    const f = 1 / a;
    const s = [
        origin[0] - tri.v0[0],
        origin[1] - tri.v0[1],
        origin[2] - tri.v0[2],
    ];
    
    const u = f * (s[0] * h[0] + s[1] * h[1] + s[2] * h[2]);
    if (u < 0 || u > 1) return null;
    
    // Cross product: q = s × edge1
    const q = [
        s[1] * edge1[2] - s[2] * edge1[1],
        s[2] * edge1[0] - s[0] * edge1[2],
        s[0] * edge1[1] - s[1] * edge1[0],
    ];
    
    const v = f * (dir[0] * q[0] + dir[1] * q[1] + dir[2] * q[2]);
    if (v < 0 || u + v > 1) return null;
    
    const t = f * (edge2[0] * q[0] + edge2[1] * q[1] + edge2[2] * q[2]);
    if (t < EPSILON || t > tMax) return null;
    
    // Compute normal: edge1 × edge2
    const normal = [
        edge1[1] * edge2[2] - edge1[2] * edge2[1],
        edge1[2] * edge2[0] - edge1[0] * edge2[2],
        edge1[0] * edge2[1] - edge1[1] * edge2[0],
    ];
    const len = Math.sqrt(normal[0] * normal[0] + normal[1] * normal[1] + normal[2] * normal[2]);
    normal[0] /= len;
    normal[1] /= len;
    normal[2] /= len;
    
    return { t, u, v, normal };
}

// ============================================================================
// BVH TRAVERSAL (CPU)
// ============================================================================

/**
 * Traverse BVH and find closest intersection
 * @param {number[]} origin - Ray origin
 * @param {number[]} dir - Ray direction (normalized)
 * @param {Array} nodes - BVH nodes
 * @param {Array} triIndices - Triangle index array
 * @param {Array} triangles - Triangle data
 * @returns {Object|null} {t, triIdx, u, v, normal} or null
 */
export function traverseBVH(origin, dir, nodes, triIndices, triangles) {
    const invDir = [1 / dir[0], 1 / dir[1], 1 / dir[2]];
    
    let closest = null;
    let tMax = INF_T;
    
    // Stack for iterative traversal
    const stack = new Uint32Array(64);
    let stackPtr = 0;
    let nodeIdx = 0;
    
    while (true) {
        const node = nodes[nodeIdx];
        
        if (node.isLeaf()) {
            // Test triangles in leaf
            for (let i = 0; i < node.triCount; i++) {
                const triIdx = triIndices[node.leftChild_Or_FirstTri + i];
                const tri = triangles[triIdx];
                const hit = rayTriangleIntersect(origin, dir, tri, tMax);
                if (hit) {
                    tMax = hit.t;
                    closest = { ...hit, triIdx };
                }
            }
            
            if (stackPtr === 0) break;
            nodeIdx = stack[--stackPtr];
            continue;
        }
        
        // Internal node - test children
        const child1Idx = node.leftChild_Or_FirstTri;
        const child2Idx = node.leftChild_Or_FirstTri + 1;
        
        let dist1 = rayAABBIntersect(origin, invDir, nodes[child1Idx].min, nodes[child1Idx].max, tMax);
        let dist2 = rayAABBIntersect(origin, invDir, nodes[child2Idx].min, nodes[child2Idx].max, tMax);
        
        // Sort by distance (traverse closer first)
        let near = child1Idx, far = child2Idx;
        if (dist1 > dist2) {
            [dist1, dist2] = [dist2, dist1];
            [near, far] = [far, near];
        }
        
        if (dist1 >= INF_T) {
            if (stackPtr === 0) break;
            nodeIdx = stack[--stackPtr];
        } else {
            nodeIdx = near;
            if (dist2 < INF_T) {
                stack[stackPtr++] = far;
            }
        }
    }
    
    return closest;
}

/**
 * Ray-AABB intersection (slab method)
 */
function rayAABBIntersect(origin, invDir, bmin, bmax, tMax) {
    const tx1 = (bmin[0] - origin[0]) * invDir[0];
    const tx2 = (bmax[0] - origin[0]) * invDir[0];
    let tmin = Math.min(tx1, tx2);
    let tmax = Math.max(tx1, tx2);
    
    const ty1 = (bmin[1] - origin[1]) * invDir[1];
    const ty2 = (bmax[1] - origin[1]) * invDir[1];
    tmin = Math.max(tmin, Math.min(ty1, ty2));
    tmax = Math.min(tmax, Math.max(ty1, ty2));
    
    const tz1 = (bmin[2] - origin[2]) * invDir[2];
    const tz2 = (bmax[2] - origin[2]) * invDir[2];
    tmin = Math.max(tmin, Math.min(tz1, tz2));
    tmax = Math.min(tmax, Math.max(tz1, tz2));
    
    if (tmax >= tmin && tmin < tMax && tmax > 0) {
        return tmin > 0 ? tmin : 0;
    }
    return INF_T;
}

// ============================================================================
// GPU BVH TRAVERSAL SHADER (WGSL)
// ============================================================================

export const BVH_TRAVERSAL_WGSL = /* wgsl */ `
// ============================================================================
// BVH STRUCTURES
// ============================================================================

struct BVHNode {
    min: vec3<f32>,
    leftChild_Or_FirstTri: u32,
    max: vec3<f32>,
    triCount: u32,
}

struct Triangle {
    v0: vec4<f32>,
    v1: vec4<f32>,
    v2: vec4<f32>,
}

struct RayHit {
    t: f32,
    triIdx: u32,
    u: f32,
    v: f32,
    normal: vec3<f32>,
    hit: u32,
}

const INF_T: f32 = 1e30;
const EPSILON: f32 = 1e-6;

// ============================================================================
// RAY-AABB INTERSECTION (Slab Method)
// ============================================================================

fn rayAABBIntersect(origin: vec3<f32>, invDir: vec3<f32>, bmin: vec3<f32>, bmax: vec3<f32>, tMax: f32) -> f32 {
    let t1 = (bmin - origin) * invDir;
    let t2 = (bmax - origin) * invDir;
    let tMin = min(t1, t2);
    let tMax2 = max(t1, t2);
    let tNear = max(max(tMin.x, tMin.y), tMin.z);
    let tFar = min(min(tMax2.x, tMax2.y), tMax2.z);
    
    if (tFar >= tNear && tNear < tMax && tFar > 0.0) {
        return select(0.0, tNear, tNear > 0.0);
    }
    return INF_T;
}

// ============================================================================
// MÖLLER-TRUMBORE RAY-TRIANGLE INTERSECTION
// ============================================================================

fn rayTriIntersect(origin: vec3<f32>, dir: vec3<f32>, tri: Triangle, tMax: f32) -> RayHit {
    var hit: RayHit;
    hit.hit = 0u;
    hit.t = INF_T;
    
    let edge1 = tri.v1.xyz - tri.v0.xyz;
    let edge2 = tri.v2.xyz - tri.v0.xyz;
    let h = cross(dir, edge2);
    let a = dot(edge1, h);
    
    if (abs(a) < EPSILON) {
        return hit;
    }
    
    let f = 1.0 / a;
    let s = origin - tri.v0.xyz;
    let u = f * dot(s, h);
    
    if (u < 0.0 || u > 1.0) {
        return hit;
    }
    
    let q = cross(s, edge1);
    let v = f * dot(dir, q);
    
    if (v < 0.0 || u + v > 1.0) {
        return hit;
    }
    
    let t = f * dot(edge2, q);
    
    if (t < EPSILON || t > tMax) {
        return hit;
    }
    
    hit.t = t;
    hit.u = u;
    hit.v = v;
    hit.normal = normalize(cross(edge1, edge2));
    hit.hit = 1u;
    
    return hit;
}

// ============================================================================
// BVH TRAVERSAL (Stack-based iterative)
// ============================================================================

fn traverseBVH(
    origin: vec3<f32>,
    dir: vec3<f32>,
    nodes: ptr<storage, array<BVHNode>>,
    triIndices: ptr<storage, array<u32>>,
    triangles: ptr<storage, array<Triangle>>,
    nodeCount: u32
) -> RayHit {
    let invDir = 1.0 / dir;
    
    var closest: RayHit;
    closest.hit = 0u;
    closest.t = INF_T;
    
    var stack: array<u32, 64>;
    var stackPtr: u32 = 0u;
    var nodeIdx: u32 = 0u;
    
    loop {
        let node = (*nodes)[nodeIdx];
        
        if (node.triCount > 0u) {
            // Leaf node - test triangles
            for (var i: u32 = 0u; i < node.triCount; i++) {
                let triIdx = (*triIndices)[node.leftChild_Or_FirstTri + i];
                let tri = (*triangles)[triIdx];
                let hit = rayTriIntersect(origin, dir, tri, closest.t);
                
                if (hit.hit == 1u) {
                    closest = hit;
                    closest.triIdx = triIdx;
                }
            }
            
            if (stackPtr == 0u) {
                break;
            }
            stackPtr--;
            nodeIdx = stack[stackPtr];
            continue;
        }
        
        // Internal node - test children
        let child1Idx = node.leftChild_Or_FirstTri;
        let child2Idx = node.leftChild_Or_FirstTri + 1u;
        
        var dist1 = rayAABBIntersect(origin, invDir, (*nodes)[child1Idx].min, (*nodes)[child1Idx].max, closest.t);
        var dist2 = rayAABBIntersect(origin, invDir, (*nodes)[child2Idx].min, (*nodes)[child2Idx].max, closest.t);
        
        // Sort by distance
        var near = child1Idx;
        var far = child2Idx;
        if (dist1 > dist2) {
            let tmp = dist1;
            dist1 = dist2;
            dist2 = tmp;
            near = child2Idx;
            far = child1Idx;
        }
        
        if (dist1 >= INF_T) {
            if (stackPtr == 0u) {
                break;
            }
            stackPtr--;
            nodeIdx = stack[stackPtr];
        } else {
            nodeIdx = near;
            if (dist2 < INF_T) {
                stack[stackPtr] = far;
                stackPtr++;
            }
        }
    }
    
    return closest;
}
`;

// ============================================================================
// BVH SERIALIZATION FOR GPU
// ============================================================================

/**
 * Serialize BVH for GPU buffer upload
 * @param {Object} bvh - BVH from builder {nodes, triIndices, triangles}
 * @returns {Object} {nodeBuffer, triIndexBuffer, triangleBuffer}
 */
export function serializeBVHForGPU(bvh) {
    const { nodes, triIndices, triangles } = bvh;
    
    // Node buffer: 8 floats per node (32 bytes, aligned)
    const nodeData = new Float32Array(nodes.length * 8);
    for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        const offset = i * 8;
        nodeData[offset + 0] = n.min[0];
        nodeData[offset + 1] = n.min[1];
        nodeData[offset + 2] = n.min[2];
        // Store u32 as float bits
        const view = new DataView(nodeData.buffer);
        view.setUint32((offset + 3) * 4, n.leftChild_Or_FirstTri, true);
        nodeData[offset + 4] = n.max[0];
        nodeData[offset + 5] = n.max[1];
        nodeData[offset + 6] = n.max[2];
        view.setUint32((offset + 7) * 4, n.triCount, true);
    }
    
    // Triangle index buffer
    const triIndexData = new Uint32Array(triIndices);
    
    // Triangle buffer: 12 floats per triangle (v0, v1, v2 as vec4 with padding)
    const triangleData = new Float32Array(triangles.length * 12);
    for (let i = 0; i < triangles.length; i++) {
        const t = triangles[i];
        const offset = i * 12;
        triangleData[offset + 0] = t.v0[0];
        triangleData[offset + 1] = t.v0[1];
        triangleData[offset + 2] = t.v0[2];
        triangleData[offset + 3] = 0; // padding
        triangleData[offset + 4] = t.v1[0];
        triangleData[offset + 5] = t.v1[1];
        triangleData[offset + 6] = t.v1[2];
        triangleData[offset + 7] = 0;
        triangleData[offset + 8] = t.v2[0];
        triangleData[offset + 9] = t.v2[1];
        triangleData[offset + 10] = t.v2[2];
        triangleData[offset + 11] = 0;
    }
    
    return {
        nodeBuffer: nodeData,
        triIndexBuffer: triIndexData,
        triangleBuffer: triangleData,
    };
}

// ============================================================================
// HIGH-LEVEL API
// ============================================================================

/**
 * Create raycastable mesh from vertices and indices
 * @param {Float32Array|Array} vertices - Vertex positions [x,y,z, x,y,z, ...]
 * @param {Uint32Array|Array} indices - Triangle indices [i0,i1,i2, ...]
 * @returns {Object} Raycastable mesh object
 */
export function createRaycastMesh(vertices, indices) {
    const builder = new BVHBuilder();
    const bvh = builder.build(Array.from(vertices), Array.from(indices));
    
    return {
        bvh,
        vertices: Array.from(vertices),
        indices: Array.from(indices),
        
        /**
         * Raycast against this mesh
         * @param {number[]} origin - Ray origin
         * @param {number[]} direction - Ray direction (normalized)
         * @returns {Object|null} Hit result or null
         */
        raycast(origin, direction) {
            return traverseBVH(origin, direction, bvh.nodes, bvh.triIndices, bvh.triangles);
        },
        
        /**
         * Get GPU buffers for this mesh
         * @returns {Object} GPU buffer data
         */
        getGPUBuffers() {
            return serializeBVHForGPU(bvh);
        },
    };
}

export default BVHBuilder;
