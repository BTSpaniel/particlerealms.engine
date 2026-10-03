// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * TLASBuilder — Two-Level Acceleration Structure for Proxy Geometry
 *
 * Implements the TLAS (Top-Level Acceleration Structure) over proxy instances,
 * each referencing a BLAS (Bottom-Level Acceleration Structure = the per-asset BVH
 * built by BVHAccel.js / BVHBuilder).
 *
 * Key insight (from Jacco Bikker / Interplay of Light research):
 *   "Given a mesh with a BVH in object space and a 4x4 matrix, we intersect
 *    its BVH in world space by applying the inverse transform to the ray."
 *
 * This means:
 *   - BLAS is built ONCE per unique asset, stored in object space
 *   - TLAS stores instance bounding boxes (world space) + inverse world matrices
 *   - Per-ray: traverse TLAS → at leaf, transform ray into object space → traverse BLAS
 *   - Adding 1000 instances of the same mesh = 1 BLAS + 1000 TLAS entries (not 1000 BVHes)
 *
 * GPU buffer layout designed for direct use in ray_portal.js WGSL traversal.
 */

import { initVGPU } from '../../core/gpu/VirtualGPU.js';

// ============================================================================
// CONSTANTS
// ============================================================================

const TLAS_NODE_BYTES  = 48;   // aabbMin(12) + rightChild(4) + aabbMax(12) + leftOrInstance(4) + isLeaf(4) + _pad(12)
const INSTANCE_BYTES   = 96;   // aabbMin(12) + blasOffset(4) + aabbMax(12) + instanceId(4) + invWorldMat(64) = 96
const MAX_TLAS_NODES   = 65536;
const MAX_INSTANCES    = 32768;

// ============================================================================
// CPU-SIDE AABB HELPERS
// ============================================================================

function aabbFromOBB(center, halfExtents, invWorldMat) {
    // Transform 8 OBB corners to world space, take min/max
    const corners = [
        [-1,-1,-1],[1,-1,-1],[-1,1,-1],[1,1,-1],
        [-1,-1, 1],[1,-1, 1],[-1,1, 1],[1,1, 1],
    ];
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    // invWorldMat maps world→object; we need object→world = its inverse
    // We store the forward worldMat column-major in the instance
    // For AABB in world space, transform unit corners by worldMat
    for (const [cx, cy, cz] of corners) {
        const wx = cx * halfExtents[0] + center[0];
        const wy = cy * halfExtents[1] + center[1];
        const wz = cz * halfExtents[2] + center[2];
        minX = Math.min(minX, wx); minY = Math.min(minY, wy); minZ = Math.min(minZ, wz);
        maxX = Math.max(maxX, wx); maxY = Math.max(maxY, wy); maxZ = Math.max(maxZ, wz);
    }
    return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

function mat4Invert(m) {
    // 4x4 matrix inversion (column-major Float32Array, returns Float32Array)
    const out = new Float32Array(16);
    const [
        m00, m10, m20, m30,
        m01, m11, m21, m31,
        m02, m12, m22, m32,
        m03, m13, m23, m33
    ] = m;

    const b00 = m00 * m11 - m10 * m01;
    const b01 = m00 * m21 - m20 * m01;
    const b02 = m00 * m31 - m30 * m01;
    const b03 = m10 * m21 - m20 * m11;
    const b04 = m10 * m31 - m30 * m11;
    const b05 = m20 * m31 - m30 * m21;
    const b06 = m02 * m13 - m12 * m03;
    const b07 = m02 * m23 - m22 * m03;
    const b08 = m02 * m33 - m32 * m03;
    const b09 = m12 * m23 - m22 * m13;
    const b10 = m12 * m33 - m32 * m13;
    const b11 = m22 * m33 - m32 * m23;

    const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (Math.abs(det) < 1e-10) {
        out.set(m); // degenerate — return original
        return out;
    }
    const invDet = 1.0 / det;

    out[0]  = (m11 * b11 - m21 * b10 + m31 * b09) * invDet;
    out[1]  = (m20 * b10 - m10 * b11 - m30 * b09) * invDet;
    out[2]  = (m01 * b05 - m21 * b04 + m31 * b03) * invDet;  // corrected sign
    out[3]  = (m20 * b04 - m11 * b05 - m30 * b03) * invDet;  // corrected sign
    out[4]  = (m21 * b08 - m11 * b08 + m31 * b07) * invDet;
    out[5]  = (m10 * b08 - m20 * b07 + m30 * b06) * invDet;
    out[6]  = (m21 * b02 - m01 * b05 - m31 * b01) * invDet;
    out[7]  = (m01 * b04 - m11 * b02 + m31 * b00) * invDet;  // corrected sign
    out[8]  = (m13 * b05 - m23 * b04 + m33 * b03) * invDet;
    out[9]  = (m22 * b04 - m12 * b05 - m32 * b03) * invDet;  // corrected sign
    out[10] = (m03 * b11 - m13 * b10 + m23 * b09) * invDet;
    out[11] = (m12 * b08 - m02 * b11 - m32 * b07) * invDet;  // corrected sign
    out[12] = (m23 * b02 - m13 * b05 + m33 * b04) * invDet;  // corrected sign
    out[13] = (m02 * b04 - m12 * b02 + m32 * b00) * invDet;  // corrected sign
    out[14] = (m13 * b01 - m03 * b05 + m33 * b03) * invDet;
    out[15] = (m02 * b03 - m12 * b01 + m22 * b00) * invDet;  // corrected sign
    return out;
}

// ============================================================================
// BVH NODE (for CPU-side TLAS build)
// ============================================================================

class TLASNode {
    constructor() {
        this.aabbMin    = [Infinity, Infinity, Infinity];
        this.aabbMax    = [-Infinity, -Infinity, -Infinity];
        this.left       = 0;   // child index or instance index (if leaf)
        this.right      = 0;
        this.isLeaf     = false;
        this.instanceId = 0;
    }
}

// ============================================================================
// TLASBuilder
// ============================================================================

export class TLASBuilder {
    /**
     * @param {GPUDevice} device
     */
    constructor(device) {
        this.vgpu = initVGPU(device);
        this.device = device;

        /** @type {Array<{blasOffset:number, worldMat:Float32Array, invWorldMat:Float32Array, aabb:{min,max}, instanceId:number}>} */
        this.instances = [];

        /** @type {TLASNode[]} */
        this.nodes = [];

        this.tlasBuffer     = null;
        this.instanceBuffer = null;
        this._dirty         = false;
        this._nextId        = 0;

        this._initBuffers();
    }

    _initBuffers() {
        this.tlasBuffer = this.vgpu.buffer.create({
            size : MAX_TLAS_NODES * TLAS_NODE_BYTES,
            usage: 'storage',
            label: 'TLASNodes',
        }).buffer;

        this.instanceBuffer = this.vgpu.buffer.create({
            size : MAX_INSTANCES * INSTANCE_BYTES,
            usage: 'storage',
            label: 'TLASInstances',
        }).buffer;
    }

    // -------------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------------

    /**
     * Register a proxy instance.
     * @param {number}       blasOffset  Byte offset into the shared BLAS buffer for this asset's BVH.
     * @param {Float32Array} worldMat    Column-major 4×4 world transform of the proxy instance.
     * @param {number[]}     aabbMin     World-space AABB min [x,y,z] (computed from asset bounds + transform).
     * @param {number[]}     aabbMax     World-space AABB max [x,y,z].
     * @returns {number} instanceId (use to call removeInstance / updateTransform)
     */
    addInstance(blasOffset, worldMat, aabbMin, aabbMax) {
        const id         = this._nextId++;
        const invWorldMat = mat4Invert(worldMat);
        this.instances.push({ blasOffset, worldMat: new Float32Array(worldMat), invWorldMat, aabbMin, aabbMax, instanceId: id });
        this._dirty = true;
        return id;
    }

    /**
     * Update the world transform of an existing instance (no full rebuild needed).
     * @param {number}       instanceId
     * @param {Float32Array} worldMat
     * @param {number[]}     aabbMin
     * @param {number[]}     aabbMax
     */
    updateTransform(instanceId, worldMat, aabbMin, aabbMax) {
        const inst = this.instances.find(i => i.instanceId === instanceId);
        if (!inst) return;
        inst.worldMat    = new Float32Array(worldMat);
        inst.invWorldMat = mat4Invert(worldMat);
        inst.aabbMin     = aabbMin;
        inst.aabbMax     = aabbMax;
        this._dirty = true;
    }

    /** Remove a proxy instance. Triggers TLAS rebuild. */
    removeInstance(instanceId) {
        const idx = this.instances.findIndex(i => i.instanceId === instanceId);
        if (idx !== -1) {
            this.instances.splice(idx, 1);
            this._dirty = true;
        }
    }

    /**
     * Build (or refit) the TLAS if dirty, then upload to GPU.
     * Call once per frame before render.
     */
    commit() {
        if (!this._dirty || this.instances.length === 0) return;

        this._buildTLAS();
        this._uploadToGPU();
        this._dirty = false;
    }

    /** Force rebuild on next commit (e.g., after many removals). */
    markDirty() { this._dirty = true; }

    getInstanceCount() { return this.instances.length; }

    getTLASBuffer()     { return this.tlasBuffer; }
    getInstanceBuffer() { return this.instanceBuffer; }

    destroy() {
        if (this.tlasBuffer)     this.tlasBuffer.destroy();
        if (this.instanceBuffer) this.instanceBuffer.destroy();
    }

    // -------------------------------------------------------------------------
    // GPU-Only Mode Support
    // -------------------------------------------------------------------------

    /**
     * Set GPU buffers directly for compute shader-driven BVH.
     * Bypasses CPU-side BVH building.
     *
     * @param {GPUBuffer} tlasBuffer - BVH node buffer
     * @param {GPUBuffer} tlasInstanceBuffer - Instance index buffer
     */
    setGPUBuffers(tlasBuffer, tlasInstanceBuffer) {
        this.tlasBuffer = tlasBuffer;
        this.instanceBuffer = tlasInstanceBuffer;
        this._gpuOnlyMode = true;
    }

    // -------------------------------------------------------------------------
    // Internal BVH Construction (SAH-lite — Surface Area Heuristic, simplified)
    // -------------------------------------------------------------------------

    _buildTLAS() {
        this.nodes = [];
        if (this.instances.length === 0) return;

        const indices = this.instances.map((_, i) => i);
        this._buildNode(indices);
    }

    _buildNode(indices) {
        const nodeIdx = this.nodes.length;
        const node = new TLASNode();
        this.nodes.push(node);

        // Compute combined AABB for all instances in this node
        for (const i of indices) {
            const inst = this.instances[i];
            node.aabbMin[0] = Math.min(node.aabbMin[0], inst.aabbMin[0]);
            node.aabbMin[1] = Math.min(node.aabbMin[1], inst.aabbMin[1]);
            node.aabbMin[2] = Math.min(node.aabbMin[2], inst.aabbMin[2]);
            node.aabbMax[0] = Math.max(node.aabbMax[0], inst.aabbMax[0]);
            node.aabbMax[1] = Math.max(node.aabbMax[1], inst.aabbMax[1]);
            node.aabbMax[2] = Math.max(node.aabbMax[2], inst.aabbMax[2]);
        }

        if (indices.length === 1) {
            // Leaf
            node.isLeaf     = true;
            node.instanceId = indices[0];
            return nodeIdx;
        }

        // Split on longest axis (simplified SAH)
        const dx = node.aabbMax[0] - node.aabbMin[0];
        const dy = node.aabbMax[1] - node.aabbMin[1];
        const dz = node.aabbMax[2] - node.aabbMin[2];
        const axis = (dx > dy && dx > dz) ? 0 : (dy > dz ? 1 : 2);
        const mid  = (node.aabbMin[axis] + node.aabbMax[axis]) * 0.5;

        let left  = indices.filter(i => this.instances[i].aabbMin[axis] < mid);
        let right = indices.filter(i => this.instances[i].aabbMin[axis] >= mid);

        // Guard against degenerate split (all on one side)
        if (left.length === 0 || right.length === 0) {
            const half = Math.floor(indices.length / 2);
            left  = indices.slice(0, half);
            right = indices.slice(half);
        }

        node.isLeaf = false;
        node.left   = this._buildNode(left);
        node.right  = this._buildNode(right);
        return nodeIdx;
    }

    // -------------------------------------------------------------------------
    // GPU Upload
    // -------------------------------------------------------------------------

    _uploadToGPU() {
        // Upload TLAS nodes (48 bytes each)
        // Layout: aabbMin(12), right(4), aabbMax(12), left(4), isLeaf(4), instanceId(4), _pad(8)
        const nodeData = new Float32Array(this.nodes.length * 12);
        const nodeDataU32 = new Uint32Array(nodeData.buffer);

        for (let i = 0; i < this.nodes.length; i++) {
            const n  = this.nodes[i];
            const o  = i * 12;
            nodeData[o + 0] = n.aabbMin[0];
            nodeData[o + 1] = n.aabbMin[1];
            nodeData[o + 2] = n.aabbMin[2];
            nodeDataU32[o + 3] = n.right;
            nodeData[o + 4] = n.aabbMax[0];
            nodeData[o + 5] = n.aabbMax[1];
            nodeData[o + 6] = n.aabbMax[2];
            nodeDataU32[o + 7] = n.left;
            nodeDataU32[o + 8] = n.isLeaf ? 1 : 0;
            nodeDataU32[o + 9] = n.isLeaf ? n.instanceId : 0;
            // _pad: o+10, o+11 left 0
        }
        this.device.queue.writeBuffer(this.tlasBuffer, 0, nodeData);

        // Upload instance data (96 bytes each)
        // Layout: aabbMin(12), blasOffset(4), aabbMax(12), instanceId(4), invWorldMat(64)
        const instData    = new Float32Array(this.instances.length * 24);
        const instDataU32 = new Uint32Array(instData.buffer);

        for (let i = 0; i < this.instances.length; i++) {
            const inst = this.instances[i];
            const o    = i * 24;
            instData[o + 0] = inst.aabbMin[0];
            instData[o + 1] = inst.aabbMin[1];
            instData[o + 2] = inst.aabbMin[2];
            instDataU32[o + 3] = inst.blasOffset;
            instData[o + 4] = inst.aabbMax[0];
            instData[o + 5] = inst.aabbMax[1];
            instData[o + 6] = inst.aabbMax[2];
            instDataU32[o + 7] = inst.instanceId;
            // invWorldMat: 16 floats at o+8..o+23
            instData.set(inst.invWorldMat, o + 8);
        }
        this.device.queue.writeBuffer(this.instanceBuffer, 0, instData);
    }
}
