/**
 * GPUTriangleMesh.js — GPU Triangle Mesh Static Collider
 * 
 * Collision detection against static triangle meshes on GPU.
 * Used for environment geometry (terrain, buildings, props) that
 * doesn't move but needs accurate concave collision.
 * 
 * Based on:
 * - PhysX PxTriangleMeshGeometry: cooked triangle mesh with BVH
 * - PhysX GPU: buildGPUData flag for GPU-accelerated triangle mesh contacts
 * - Embree-style BVH: AABB tree for triangle culling
 * 
 * Architecture:
 * - CPU: Cook mesh → build BVH → upload to GPU buffers
 * - GPU: Per-body shader traverses BVH, tests triangles in leaf nodes
 * - Generates contacts into the shared narrowphase contact buffer
 * 
 * Limitations (matching PhysX):
 * - Triangle meshes are STATIC only (no deformation at runtime)
 * - For deformable meshes, use GPUSoftBody.js instead
 * - Max 65536 triangles per mesh (GPU buffer limit, configurable)
 * - Max 16 meshes registered simultaneously
 */

import { MAX_BODIES, MAX_CONTACTS } from './GPURigidBodyWorld.js';

// ============================================================================
// CONSTANTS
// ============================================================================

export const MAX_TRIMESH_TRIANGLES = 65536;
export const MAX_TRIMESH_VERTICES  = 65536;
export const MAX_TRIMESH_INSTANCES = 16;
export const MAX_BVH_NODES = MAX_TRIMESH_TRIANGLES * 2;

// ============================================================================
// WGSL SHADER
// ============================================================================

const TRIMESH_CONTACT_SHADER = /* wgsl */`
// Per-body: test body shape against triangle mesh using BVH traversal
// Each thread handles one body

struct Triangle {
    v0x: f32, v0y: f32, v0z: f32, _pad0: f32,
    v1x: f32, v1y: f32, v1z: f32, _pad1: f32,
    v2x: f32, v2y: f32, v2z: f32, _pad2: f32,
    normalX: f32, normalY: f32, normalZ: f32, _pad3: f32,
}

struct BVHNode {
    minX: f32, minY: f32, minZ: f32,
    leftOrTriStart: i32,   // <0 = left child index, >=0 = triangle start index
    maxX: f32, maxY: f32, maxZ: f32,
    rightOrTriCount: i32,  // if leaf: triangle count; if internal: right child index
}

struct Collider {
    shapeType: u32,
    halfExtentX: f32, halfExtentY: f32, halfExtentZ: f32,
    radius: f32, halfHeight: f32,
    localOffsetX: f32, localOffsetY: f32, localOffsetZ: f32,
    friction: f32, restitution: f32,
    _pad0: f32, _pad1: f32, _pad2: f32, _pad3: f32, _pad4: f32,
}

struct Contact {
    bodyA: u32,
    bodyB: u32,
    normalX: f32, normalY: f32, normalZ: f32,
    penetration: f32,
    pointX: f32, pointY: f32, pointZ: f32,
    lambda: f32,
    localAnchorAx: f32, localAnchorAy: f32, localAnchorAz: f32,
    localAnchorBx: f32, localAnchorBy: f32, localAnchorBz: f32,
    featureId: u32,
    _pad: u32,
}

struct Params {
    bodyCount: u32,
    triangleCount: u32,
    bvhNodeCount: u32,
    maxContacts: u32,
    contactOffset: f32,
    meshInstanceId: u32,
    _pad0: u32,
    _pad1: u32,
}

@group(0) @binding(0) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> rotations: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> colliders: array<Collider>;
@group(0) @binding(3) var<storage, read> bodyFlags: array<u32>;
@group(0) @binding(4) var<storage, read> triangles: array<Triangle>;
@group(0) @binding(5) var<storage, read> bvhNodes: array<BVHNode>;
@group(0) @binding(6) var<storage, read_write> contacts: array<Contact>;
@group(0) @binding(7) var<storage, read_write> contactCount: atomic<u32>;
@group(0) @binding(8) var<uniform> params: Params;

fn rotateVec(v: vec3<f32>, q: vec4<f32>) -> vec3<f32> {
    let t = 2.0 * cross(q.xyz, v);
    return v + q.w * t + cross(q.xyz, t);
}

fn inverseRotateVec(v: vec3<f32>, q: vec4<f32>) -> vec3<f32> {
    return rotateVec(v, vec4<f32>(-q.xyz, q.w));
}

// AABB-AABB overlap test
fn aabbOverlap(aMin: vec3<f32>, aMax: vec3<f32>, bMin: vec3<f32>, bMax: vec3<f32>) -> bool {
    return aMin.x <= bMax.x && aMax.x >= bMin.x
        && aMin.y <= bMax.y && aMax.y >= bMin.y
        && aMin.z <= bMax.z && aMax.z >= bMin.z;
}

// Closest point on triangle to point P
fn closestPointOnTriangle(p: vec3<f32>, a: vec3<f32>, b: vec3<f32>, c: vec3<f32>) -> vec3<f32> {
    let ab = b - a;
    let ac = c - a;
    let ap = p - a;

    let d1 = dot(ab, ap);
    let d2 = dot(ac, ap);
    if (d1 <= 0.0 && d2 <= 0.0) { return a; }

    let bp = p - b;
    let d3 = dot(ab, bp);
    let d4 = dot(ac, bp);
    if (d3 >= 0.0 && d4 <= d3) { return b; }

    let vc = d1 * d4 - d3 * d2;
    if (vc <= 0.0 && d1 >= 0.0 && d3 <= 0.0) {
        let v = d1 / (d1 - d3);
        return a + ab * v;
    }

    let cp = p - c;
    let d5 = dot(ab, cp);
    let d6 = dot(ac, cp);
    if (d6 >= 0.0 && d5 <= d6) { return c; }

    let vb = d5 * d2 - d1 * d6;
    if (vb <= 0.0 && d2 >= 0.0 && d6 <= 0.0) {
        let w = d2 / (d2 - d6);
        return a + ac * w;
    }

    let va = d3 * d6 - d5 * d4;
    if (va <= 0.0 && (d4 - d3) >= 0.0 && (d5 - d6) >= 0.0) {
        let w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
        return b + (c - b) * w;
    }

    let denom = 1.0 / (va + vb + vc);
    let v = vb * denom;
    let w = vc * denom;
    return a + ab * v + ac * w;
}

// Body AABB from collider
fn bodyAABB(pos: vec3<f32>, col: Collider) -> vec4<f32> {
    // Returns (halfExtentX, halfExtentY, halfExtentZ, 0) for the body
    switch col.shapeType {
        case 0u: { return vec4<f32>(col.radius, col.radius, col.radius, 0.0); }
        case 1u: { return vec4<f32>(col.halfExtentX, col.halfExtentY, col.halfExtentZ, 0.0); }
        case 2u: { return vec4<f32>(col.radius, col.halfHeight + col.radius, col.radius, 0.0); }
        default: { return vec4<f32>(col.halfExtentX, col.halfExtentY, col.halfExtentZ, 0.0); }
    }
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let bodyId = gid.x;
    if (bodyId >= params.bodyCount) { return; }

    let flags = bodyFlags[bodyId];
    let simMode = flags & 3u;
    if (simMode == 2u) { return; } // Static bodies don't collide with static mesh
    if ((flags & 4u) != 0u) { return; } // Sleeping

    let pos = positions[bodyId].xyz;
    let rot = rotations[bodyId];
    let col = colliders[bodyId];

    let he = bodyAABB(pos, col);
    let bodyMin = pos - he.xyz - vec3<f32>(params.contactOffset);
    let bodyMax = pos + he.xyz + vec3<f32>(params.contactOffset);

    // BVH traversal stack (iterative, max depth 32)
    var stack: array<u32, 32>;
    var stackPtr: i32 = 0;
    stack[0] = 0u; // Root node
    stackPtr = 1;

    var contactsEmitted: u32 = 0u;
    let maxContactsPerBody: u32 = 8u;

    while (stackPtr > 0) {
        stackPtr--;
        let nodeIdx = stack[stackPtr];
        if (nodeIdx >= params.bvhNodeCount) { continue; }

        let node = bvhNodes[nodeIdx];
        let nodeMin = vec3<f32>(node.minX, node.minY, node.minZ);
        let nodeMax = vec3<f32>(node.maxX, node.maxY, node.maxZ);

        if (!aabbOverlap(bodyMin, bodyMax, nodeMin, nodeMax)) { continue; }

        if (node.leftOrTriStart >= 0) {
            // Leaf node: test triangles
            let triStart = u32(node.leftOrTriStart);
            let triCount = u32(node.rightOrTriCount);

            for (var t = 0u; t < triCount; t++) {
                if (contactsEmitted >= maxContactsPerBody) { break; }

                let tri = triangles[triStart + t];
                let v0 = vec3<f32>(tri.v0x, tri.v0y, tri.v0z);
                let v1 = vec3<f32>(tri.v1x, tri.v1y, tri.v1z);
                let v2 = vec3<f32>(tri.v2x, tri.v2y, tri.v2z);
                let triNormal = vec3<f32>(tri.normalX, tri.normalY, tri.normalZ);

                // Closest point on triangle to body center
                let closest = closestPointOnTriangle(pos, v0, v1, v2);
                let diff = pos - closest;
                let dist = length(diff);

                // Check against body radius/extent
                var bodyRadius: f32 = 0.0;
                switch col.shapeType {
                    case 0u: { bodyRadius = col.radius; }
                    case 1u: { bodyRadius = min(min(col.halfExtentX, col.halfExtentY), col.halfExtentZ); }
                    case 2u: { bodyRadius = col.radius; }
                    default: { bodyRadius = col.radius; }
                }

                let penetration = bodyRadius + params.contactOffset - dist;
                if (penetration <= 0.0) { continue; }

                var contactNormal = triNormal;
                if (dist > 0.001) {
                    contactNormal = diff / dist;
                    // Ensure normal points away from triangle surface
                    if (dot(contactNormal, triNormal) < 0.0) {
                        contactNormal = -contactNormal;
                    }
                }

                let contactPoint = closest;
                let localA = inverseRotateVec(contactPoint - pos, rot);

                let idx = atomicAdd(&contactCount, 1u);
                if (idx >= params.maxContacts) { return; }

                contacts[idx] = Contact(
                    bodyId, 0xFFFFFFFDu, // 0xFFFFFFFD = triangle mesh sentinel
                    contactNormal.x, contactNormal.y, contactNormal.z,
                    penetration,
                    contactPoint.x, contactPoint.y, contactPoint.z,
                    0.0,
                    localA.x, localA.y, localA.z,
                    contactPoint.x, contactPoint.y, contactPoint.z,
                    300u + triStart + t, // featureId
                    0u,
                );

                contactsEmitted++;
            }
        } else {
            // Internal node: push children
            let leftChild = u32(-node.leftOrTriStart);
            let rightChild = u32(node.rightOrTriCount);
            if (stackPtr < 30) {
                stack[stackPtr] = leftChild;
                stackPtr++;
                stack[stackPtr] = rightChild;
                stackPtr++;
            }
        }
    }
}
`;

// ============================================================================
// BVH BUILDER (CPU — runs once at cook time)
// ============================================================================

/**
 * Build a BVH from triangle data for GPU traversal.
 * Uses surface area heuristic (SAH) median split.
 * 
 * @param {Float32Array} vertices - Flat xyz positions
 * @param {Uint32Array} indices - Triangle indices (length = triCount * 3)
 * @returns {{ triangles: Float32Array, bvhNodes: Float32Array, triCount: number, nodeCount: number }}
 */
export function buildTriangleMeshBVH(vertices, indices) {
    const triCount = indices.length / 3;
    if (triCount === 0) return null;
    if (triCount > MAX_TRIMESH_TRIANGLES) {
        console.warn(`[GPUTriangleMesh] Triangle count ${triCount} exceeds max ${MAX_TRIMESH_TRIANGLES}, truncating`);
    }
    const clampedTriCount = Math.min(triCount, MAX_TRIMESH_TRIANGLES);

    // Build triangle array with precomputed normals and centroids
    const tris = [];
    for (let i = 0; i < clampedTriCount; i++) {
        const i0 = indices[i * 3], i1 = indices[i * 3 + 1], i2 = indices[i * 3 + 2];
        const v0 = [vertices[i0 * 3], vertices[i0 * 3 + 1], vertices[i0 * 3 + 2]];
        const v1 = [vertices[i1 * 3], vertices[i1 * 3 + 1], vertices[i1 * 3 + 2]];
        const v2 = [vertices[i2 * 3], vertices[i2 * 3 + 1], vertices[i2 * 3 + 2]];

        // Normal
        const e1 = [v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]];
        const e2 = [v2[0] - v0[0], v2[1] - v0[1], v2[2] - v0[2]];
        const nx = e1[1] * e2[2] - e1[2] * e2[1];
        const ny = e1[2] * e2[0] - e1[0] * e2[2];
        const nz = e1[0] * e2[1] - e1[1] * e2[0];
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;

        // Centroid
        const cx = (v0[0] + v1[0] + v2[0]) / 3;
        const cy = (v0[1] + v1[1] + v2[1]) / 3;
        const cz = (v0[2] + v1[2] + v2[2]) / 3;

        tris.push({
            v0, v1, v2,
            normal: [nx / len, ny / len, nz / len],
            centroid: [cx, cy, cz],
        });
    }

    // Build BVH nodes
    const nodes = [];
    const triIndices = []; // Final ordered triangle indices

    function buildNode(triList) {
        const nodeIdx = nodes.length;
        nodes.push(null); // Placeholder

        // Compute AABB
        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        for (const ti of triList) {
            const t = tris[ti];
            for (const v of [t.v0, t.v1, t.v2]) {
                if (v[0] < minX) minX = v[0]; if (v[0] > maxX) maxX = v[0];
                if (v[1] < minY) minY = v[1]; if (v[1] > maxY) maxY = v[1];
                if (v[2] < minZ) minZ = v[2]; if (v[2] > maxZ) maxZ = v[2];
            }
        }

        if (triList.length <= 4) {
            // Leaf node
            const triStart = triIndices.length;
            for (const ti of triList) triIndices.push(ti);
            nodes[nodeIdx] = {
                minX, minY, minZ,
                maxX, maxY, maxZ,
                leftOrTriStart: triStart,
                rightOrTriCount: triList.length,
            };
            return nodeIdx;
        }

        // Split: find longest axis
        const extX = maxX - minX, extY = maxY - minY, extZ = maxZ - minZ;
        let axis = 0;
        if (extY > extX && extY > extZ) axis = 1;
        else if (extZ > extX) axis = 2;

        // Sort by centroid along axis
        triList.sort((a, b) => tris[a].centroid[axis] - tris[b].centroid[axis]);
        const mid = Math.floor(triList.length / 2);

        const leftIdx = buildNode(triList.slice(0, mid));
        const rightIdx = buildNode(triList.slice(mid));

        nodes[nodeIdx] = {
            minX, minY, minZ,
            maxX, maxY, maxZ,
            leftOrTriStart: -leftIdx,  // Negative = internal node (left child)
            rightOrTriCount: rightIdx,  // Right child index
        };

        return nodeIdx;
    }

    const allTriIndices = [];
    for (let i = 0; i < clampedTriCount; i++) allTriIndices.push(i);
    buildNode(allTriIndices);

    // Pack triangle data for GPU (16 floats per tri = 64 bytes)
    const gpuTriangles = new Float32Array(triIndices.length * 16);
    for (let i = 0; i < triIndices.length; i++) {
        const t = tris[triIndices[i]];
        const base = i * 16;
        gpuTriangles[base]     = t.v0[0]; gpuTriangles[base + 1] = t.v0[1]; gpuTriangles[base + 2] = t.v0[2];
        gpuTriangles[base + 4] = t.v1[0]; gpuTriangles[base + 5] = t.v1[1]; gpuTriangles[base + 6] = t.v1[2];
        gpuTriangles[base + 8] = t.v2[0]; gpuTriangles[base + 9] = t.v2[1]; gpuTriangles[base + 10] = t.v2[2];
        gpuTriangles[base + 12] = t.normal[0]; gpuTriangles[base + 13] = t.normal[1]; gpuTriangles[base + 14] = t.normal[2];
    }

    // Pack BVH nodes for GPU (8 floats per node = 32 bytes)
    const gpuNodes = new Float32Array(nodes.length * 8);
    const gpuNodesI32 = new Int32Array(gpuNodes.buffer);
    for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        const base = i * 8;
        gpuNodes[base]     = n.minX; gpuNodes[base + 1] = n.minY; gpuNodes[base + 2] = n.minZ;
        gpuNodesI32[base + 3] = n.leftOrTriStart;
        gpuNodes[base + 4] = n.maxX; gpuNodes[base + 5] = n.maxY; gpuNodes[base + 6] = n.maxZ;
        gpuNodesI32[base + 7] = n.rightOrTriCount;
    }

    return {
        triangles: gpuTriangles,
        bvhNodes: gpuNodes,
        triCount: triIndices.length,
        nodeCount: nodes.length,
    };
}

// ============================================================================
// GPU TRIANGLE MESH CLASS
// ============================================================================

export class GPUTriangleMesh {
    constructor(device, options = {}) {
        this.device = device;
        this.contactOffset = options.contactOffset ?? 0.02;
        this.meshes = new Map(); // meshId → { triangleBuf, bvhBuf, triCount, nodeCount }

        this._buffers = {};
        this._pipelines = {};
        this._paramsU32 = new Uint32Array(8);
        this._paramsF32 = new Float32Array(this._paramsU32.buffer);
    }

    async init(worldBuffers, narrowphaseBuffers) {
        this._worldBuffers = worldBuffers;
        this._narrowphaseBuffers = narrowphaseBuffers;
        await this._createPipeline();
        console.log(`[GPUTriangleMesh] Initialized`);
    }

    async _createPipeline() {
        const module = this.device.createShaderModule({ label: 'TM_Contact', code: TRIMESH_CONTACT_SHADER });
        this._pipelines.contact = await this.device.createComputePipelineAsync({
            label: 'TM_Contact', layout: 'auto',
            compute: { module, entryPoint: 'main' },
        });
        this._buffers.params = this.device.createBuffer({
            label: 'TM_Params', size: 32,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
    }

    /**
     * Register a triangle mesh for collision.
     * @param {string} meshId - Unique ID
     * @param {Float32Array} vertices - Flat xyz positions
     * @param {Uint32Array} indices - Triangle indices
     * @returns {boolean} Success
     */
    registerMesh(meshId, vertices, indices) {
        if (this.meshes.size >= MAX_TRIMESH_INSTANCES) {
            console.warn(`[GPUTriangleMesh] Max instances (${MAX_TRIMESH_INSTANCES}) reached`);
            return false;
        }

        const bvh = buildTriangleMeshBVH(vertices, indices);
        if (!bvh) return false;

        const d = this.device;
        const SUW = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;

        const triangleBuf = d.createBuffer({ label: `TM_Tris_${meshId}`, size: bvh.triangles.byteLength, usage: SUW });
        const bvhBuf = d.createBuffer({ label: `TM_BVH_${meshId}`, size: bvh.bvhNodes.byteLength, usage: SUW });

        d.queue.writeBuffer(triangleBuf, 0, bvh.triangles);
        d.queue.writeBuffer(bvhBuf, 0, bvh.bvhNodes);

        // Build bind group for this mesh
        const bindGroup = d.createBindGroup({
            label: `TM_Contact_BG_${meshId}`,
            layout: this._pipelines.contact.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this._worldBuffers.positions } },
                { binding: 1, resource: { buffer: this._worldBuffers.rotations } },
                { binding: 2, resource: { buffer: this._worldBuffers.colliders } },
                { binding: 3, resource: { buffer: this._worldBuffers.bodyFlags } },
                { binding: 4, resource: { buffer: triangleBuf } },
                { binding: 5, resource: { buffer: bvhBuf } },
                { binding: 6, resource: { buffer: this._narrowphaseBuffers.contacts } },
                { binding: 7, resource: { buffer: this._narrowphaseBuffers.contactCount } },
                { binding: 8, resource: { buffer: this._buffers.params } },
            ],
        });

        this.meshes.set(meshId, {
            triangleBuf, bvhBuf, bindGroup,
            triCount: bvh.triCount,
            nodeCount: bvh.nodeCount,
        });

        console.log(`[GPUTriangleMesh] Registered "${meshId}" — ${bvh.triCount} tris, ${bvh.nodeCount} BVH nodes`);
        return true;
    }

    /**
     * Unregister a triangle mesh.
     */
    unregisterMesh(meshId) {
        const mesh = this.meshes.get(meshId);
        if (!mesh) return;
        mesh.triangleBuf.destroy();
        mesh.bvhBuf.destroy();
        this.meshes.delete(meshId);
    }

    /**
     * Dispatch collision detection for all registered meshes.
     * Adds contacts to the narrowphase contact buffer.
     */
    dispatch(encoder, bodyCount) {
        if (bodyCount === 0 || this.meshes.size === 0) return;

        let instanceIdx = 0;
        for (const [meshId, mesh] of this.meshes) {
            this._paramsU32[0] = bodyCount;
            this._paramsU32[1] = mesh.triCount;
            this._paramsU32[2] = mesh.nodeCount;
            this._paramsU32[3] = MAX_CONTACTS;
            this._paramsF32[4] = this.contactOffset;
            this._paramsU32[5] = instanceIdx;
            this._paramsU32[6] = 0;
            this._paramsU32[7] = 0;
            this.device.queue.writeBuffer(this._buffers.params, 0, this._paramsF32);

            const wg = Math.ceil(bodyCount / 64);
            const pass = encoder.beginComputePass({ label: `TM_Contact_${meshId}` });
            pass.setPipeline(this._pipelines.contact);
            pass.setBindGroup(0, mesh.bindGroup);
            pass.dispatchWorkgroups(wg);
            pass.end();

            instanceIdx++;
        }
    }

    destroy() {
        for (const mesh of this.meshes.values()) {
            mesh.triangleBuf.destroy();
            mesh.bvhBuf.destroy();
        }
        this.meshes.clear();
        if (this._buffers.params) this._buffers.params.destroy();
    }
}

// ============================================================================
// FACTORY
// ============================================================================

export async function createTriangleMesh(device, worldBuffers, narrowphaseBuffers, options = {}) {
    const tm = new GPUTriangleMesh(device, options);
    await tm.init(worldBuffers, narrowphaseBuffers);
    return tm;
}

export function destroyTriangleMesh(tm) {
    if (tm) tm.destroy();
}
