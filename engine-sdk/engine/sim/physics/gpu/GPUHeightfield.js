/**
 * GPUHeightfield.js — GPU Terrain Heightfield Collider
 * 
 * Heightmap-based terrain collision for GPU physics.
 * Stores a 2D grid of heights, generates contacts against rigid bodies
 * via GPU compute shader.
 * 
 * Based on:
 * - PhysX PxHeightField: regular grid, per-sample materials, hole support
 * - Bullet btHeightfieldTerrainShape: bilinear interpolation
 * - Jolt HeightFieldShape: hierarchical BVH for large terrains
 * 
 * Features:
 * - Bilinear height interpolation for smooth normals
 * - Per-cell material index (for surface types: grass, rock, mud, etc.)
 * - Hole support (cells with height = NaN are passthrough)
 * - GPU shader: one thread per body, probes heightfield under body AABB
 * - CPU upload of heightmap data (set once or update regions)
 * - Supports terrains up to 1024×1024 (configurable)
 */

import { MAX_BODIES, MAX_CONTACTS } from './GPURigidBodyWorld.js';

// ============================================================================
// CONSTANTS
// ============================================================================

export const DEFAULT_HEIGHTFIELD_SIZE = 256;  // grid points per axis
export const MAX_HEIGHTFIELD_SIZE = 1024;

// ============================================================================
// WGSL SHADER
// ============================================================================

const HEIGHTFIELD_CONTACT_SHADER = /* wgsl */`
// Per-body: sample heightfield under body AABB, generate ground contacts
// Each thread handles one body

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

struct Collider {
    shapeType: u32,
    halfExtentX: f32, halfExtentY: f32, halfExtentZ: f32,
    radius: f32, halfHeight: f32,
    localOffsetX: f32, localOffsetY: f32, localOffsetZ: f32,
    friction: f32, restitution: f32,
    _pad0: f32, _pad1: f32, _pad2: f32, _pad3: f32, _pad4: f32,
}

struct HeightfieldParams {
    gridSizeX: u32,
    gridSizeZ: u32,
    cellSizeX: f32,
    cellSizeZ: f32,
    originX: f32,
    originY: f32,
    originZ: f32,
    contactOffset: f32,
    bodyCount: u32,
    maxContacts: u32,
    _pad0: u32,
    _pad1: u32,
}

@group(0) @binding(0) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> rotations: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> colliders: array<Collider>;
@group(0) @binding(3) var<storage, read> bodyFlags: array<u32>;
@group(0) @binding(4) var<storage, read> heightData: array<f32>;
@group(0) @binding(5) var<storage, read_write> contacts: array<Contact>;
@group(0) @binding(6) var<storage, read_write> contactCount: atomic<u32>;
@group(0) @binding(7) var<uniform> params: HeightfieldParams;

fn rotateVec(v: vec3<f32>, q: vec4<f32>) -> vec3<f32> {
    let t = 2.0 * cross(q.xyz, v);
    return v + q.w * t + cross(q.xyz, t);
}

fn inverseRotateVec(v: vec3<f32>, q: vec4<f32>) -> vec3<f32> {
    return rotateVec(v, vec4<f32>(-q.xyz, q.w));
}

fn sampleHeight(gx: u32, gz: u32) -> f32 {
    let idx = gz * params.gridSizeX + gx;
    return heightData[idx];
}

fn bilinearHeight(wx: f32, wz: f32) -> f32 {
    // Convert world pos to grid coords
    let lx = (wx - params.originX) / params.cellSizeX;
    let lz = (wz - params.originZ) / params.cellSizeZ;

    let gx0 = u32(max(floor(lx), 0.0));
    let gz0 = u32(max(floor(lz), 0.0));
    let gx1 = min(gx0 + 1u, params.gridSizeX - 1u);
    let gz1 = min(gz0 + 1u, params.gridSizeZ - 1u);

    let fx = lx - floor(lx);
    let fz = lz - floor(lz);

    let h00 = sampleHeight(gx0, gz0);
    let h10 = sampleHeight(gx1, gz0);
    let h01 = sampleHeight(gx0, gz1);
    let h11 = sampleHeight(gx1, gz1);

    // Check for holes (NaN encoded as -1e10)
    if (h00 < -1e9 || h10 < -1e9 || h01 < -1e9 || h11 < -1e9) {
        return -1e10; // Hole
    }

    let h0 = mix(h00, h10, fx);
    let h1 = mix(h01, h11, fx);
    return mix(h0, h1, fz);
}

fn heightfieldNormal(wx: f32, wz: f32) -> vec3<f32> {
    let eps = params.cellSizeX * 0.5;
    let hL = bilinearHeight(wx - eps, wz);
    let hR = bilinearHeight(wx + eps, wz);
    let hD = bilinearHeight(wx, wz - eps);
    let hU = bilinearHeight(wx, wz + eps);

    if (hL < -1e9 || hR < -1e9 || hD < -1e9 || hU < -1e9) {
        return vec3<f32>(0.0, 1.0, 0.0);
    }

    let nx = hL - hR;
    let nz = hD - hU;
    return normalize(vec3<f32>(nx, 2.0 * eps, nz));
}

fn isInBounds(wx: f32, wz: f32) -> bool {
    let maxX = params.originX + f32(params.gridSizeX - 1u) * params.cellSizeX;
    let maxZ = params.originZ + f32(params.gridSizeZ - 1u) * params.cellSizeZ;
    return wx >= params.originX && wx <= maxX && wz >= params.originZ && wz <= maxZ;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let id = gid.x;
    if (id >= params.bodyCount) { return; }

    let flags = bodyFlags[id];
    let simMode = flags & 3u;
    if (simMode == 2u) { return; } // Static
    if ((flags & 4u) != 0u) { return; } // Sleeping

    let pos = positions[id].xyz;
    let rot = rotations[id];
    let col = colliders[id];

    // Determine body footprint on heightfield
    var footprintR: f32 = 0.0;
    var lowestLocalY: f32 = 0.0;

    switch col.shapeType {
        case 0u: { // Sphere
            footprintR = col.radius;
            lowestLocalY = -col.radius;
        }
        case 1u: { // Box
            footprintR = max(col.halfExtentX, col.halfExtentZ) * 1.42; // diagonal
            lowestLocalY = -col.halfExtentY;
        }
        case 2u: { // Capsule
            footprintR = col.radius;
            lowestLocalY = -col.halfHeight - col.radius;
        }
        default: {
            footprintR = max(col.halfExtentX, col.halfExtentZ) * 1.42;
            lowestLocalY = -col.halfExtentY;
        }
    }

    // Sample heightfield at body center
    if (!isInBounds(pos.x, pos.z)) { return; }

    let terrainH = bilinearHeight(pos.x, pos.z);
    if (terrainH < -1e9) { return; } // Hole

    let bodyBottom = pos.y + lowestLocalY;
    let penetration = (terrainH + params.originY) - bodyBottom + params.contactOffset;

    if (penetration < -params.contactOffset) { return; } // No contact

    let normal = heightfieldNormal(pos.x, pos.z);
    let contactPoint = vec3<f32>(pos.x, terrainH + params.originY, pos.z);

    // Local anchors
    let localA = inverseRotateVec(contactPoint - pos, rot);

    let idx = atomicAdd(&contactCount, 1u);
    if (idx >= params.maxContacts) { return; }

    contacts[idx] = Contact(
        id, 0xFFFFFFFEu, // 0xFFFFFFFE = heightfield sentinel
        normal.x, normal.y, normal.z,
        penetration,
        contactPoint.x, contactPoint.y, contactPoint.z,
        0.0,
        localA.x, localA.y, localA.z,
        contactPoint.x, terrainH + params.originY, contactPoint.z,
        200u, // featureId for heightfield
        0u,
    );

    // Also sample at footprint corners for better contact stability
    let offsets = array<vec2<f32>, 4>(
        vec2<f32>(footprintR, 0.0),
        vec2<f32>(-footprintR, 0.0),
        vec2<f32>(0.0, footprintR),
        vec2<f32>(0.0, -footprintR),
    );

    for (var c = 0u; c < 4u; c++) {
        let sx = pos.x + offsets[c].x;
        let sz = pos.z + offsets[c].y;
        if (!isInBounds(sx, sz)) { continue; }

        let sh = bilinearHeight(sx, sz);
        if (sh < -1e9) { continue; }

        let sPen = (sh + params.originY) - bodyBottom + params.contactOffset;
        if (sPen < -params.contactOffset) { continue; }

        let sNormal = heightfieldNormal(sx, sz);
        let sPoint = vec3<f32>(sx, sh + params.originY, sz);
        let sLocalA = inverseRotateVec(sPoint - pos, rot);

        let sIdx = atomicAdd(&contactCount, 1u);
        if (sIdx >= params.maxContacts) { return; }

        contacts[sIdx] = Contact(
            id, 0xFFFFFFFEu,
            sNormal.x, sNormal.y, sNormal.z,
            sPen,
            sPoint.x, sPoint.y, sPoint.z,
            0.0,
            sLocalA.x, sLocalA.y, sLocalA.z,
            sPoint.x, sh + params.originY, sPoint.z,
            201u + c,
            0u,
        );
    }
}
`;

// ============================================================================
// HEIGHTFIELD CLASS
// ============================================================================

export class GPUHeightfield {
    /**
     * @param {GPUDevice} device
     * @param {Object} options
     * @param {number} [options.gridSizeX=256] - Grid points along X
     * @param {number} [options.gridSizeZ=256] - Grid points along Z
     * @param {number} [options.cellSizeX=1.0] - World units per cell X
     * @param {number} [options.cellSizeZ=1.0] - World units per cell Z
     * @param {number[]} [options.origin=[0,0,0]] - World origin of heightfield corner (0,0)
     * @param {number} [options.contactOffset=0.02]
     */
    constructor(device, options = {}) {
        this.device = device;
        this.gridSizeX = Math.min(options.gridSizeX ?? DEFAULT_HEIGHTFIELD_SIZE, MAX_HEIGHTFIELD_SIZE);
        this.gridSizeZ = Math.min(options.gridSizeZ ?? DEFAULT_HEIGHTFIELD_SIZE, MAX_HEIGHTFIELD_SIZE);
        this.cellSizeX = options.cellSizeX ?? 1.0;
        this.cellSizeZ = options.cellSizeZ ?? 1.0;
        this.origin = options.origin || [0, 0, 0];
        this.contactOffset = options.contactOffset ?? 0.02;

        this._totalSamples = this.gridSizeX * this.gridSizeZ;
        this._cpuHeights = new Float32Array(this._totalSamples);
        this._cpuMaterials = new Uint8Array(this._totalSamples); // per-cell material index
        this._heightsDirty = false;

        this._buffers = {};
        this._pipelines = {};
        this._bindGroups = {};
        this._paramsF32 = new Float32Array(12);
        this._paramsU32 = new Uint32Array(this._paramsF32.buffer);
    }

    async init(worldBuffers, narrowphaseBuffers) {
        this._createBuffers();
        await this._createPipelines(worldBuffers, narrowphaseBuffers);
        console.log(`[GPUHeightfield] Initialized — ${this.gridSizeX}×${this.gridSizeZ}, cellSize=${this.cellSizeX}×${this.cellSizeZ}`);
    }

    _createBuffers() {
        const d = this.device;
        const b = (label, size, usage) => d.createBuffer({ label, size, usage });
        const SUW = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;

        this._buffers.heightData = b('HF_Heights', this._totalSamples * 4, SUW);
        this._buffers.params = b('HF_Params', 48, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    }

    async _createPipelines(wb, npb) {
        const d = this.device;
        const module = d.createShaderModule({ label: 'HF_Contact', code: HEIGHTFIELD_CONTACT_SHADER });
        this._pipelines.contact = await d.createComputePipelineAsync({
            label: 'HF_Contact', layout: 'auto',
            compute: { module, entryPoint: 'main' },
        });

        this._rebuildBindGroups(wb, npb);
    }

    _rebuildBindGroups(wb, npb) {
        const d = this.device;

        this._bindGroups.contact = d.createBindGroup({
            label: 'HF_Contact_BG',
            layout: this._pipelines.contact.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: wb.positions } },
                { binding: 1, resource: { buffer: wb.rotations } },
                { binding: 2, resource: { buffer: wb.colliders } },
                { binding: 3, resource: { buffer: wb.bodyFlags } },
                { binding: 4, resource: { buffer: this._buffers.heightData } },
                { binding: 5, resource: { buffer: npb.contacts } },
                { binding: 6, resource: { buffer: npb.contactCount } },
                { binding: 7, resource: { buffer: this._buffers.params } },
            ],
        });
    }

    // ========================================================================
    // HEIGHT DATA MANAGEMENT
    // ========================================================================

    /**
     * Set the entire heightmap from a Float32Array.
     * @param {Float32Array} heights - Flat array of size gridSizeX × gridSizeZ
     */
    setHeightData(heights) {
        if (heights.length !== this._totalSamples) {
            console.warn(`[GPUHeightfield] Height data size mismatch: expected ${this._totalSamples}, got ${heights.length}`);
            return;
        }
        this._cpuHeights.set(heights);
        this._heightsDirty = true;
    }

    /**
     * Set a single height sample.
     */
    setHeight(gx, gz, height) {
        if (gx < 0 || gx >= this.gridSizeX || gz < 0 || gz >= this.gridSizeZ) return;
        this._cpuHeights[gz * this.gridSizeX + gx] = height;
        this._heightsDirty = true;
    }

    /**
     * Set a rectangular region of heights.
     * @param {number} startX - Grid X start
     * @param {number} startZ - Grid Z start
     * @param {number} width - Region width in grid cells
     * @param {number} depth - Region depth in grid cells
     * @param {Float32Array} heights - Flat array of width × depth
     */
    setHeightRegion(startX, startZ, width, depth, heights) {
        for (let z = 0; z < depth; z++) {
            for (let x = 0; x < width; x++) {
                const gx = startX + x;
                const gz = startZ + z;
                if (gx >= 0 && gx < this.gridSizeX && gz >= 0 && gz < this.gridSizeZ) {
                    this._cpuHeights[gz * this.gridSizeX + gx] = heights[z * width + x];
                }
            }
        }
        this._heightsDirty = true;
    }

    /**
     * Mark a cell as a hole (bodies pass through).
     */
    setHole(gx, gz) {
        this.setHeight(gx, gz, -1e10);
    }

    /**
     * Get height at a world position (CPU-side bilinear interpolation).
     * @param {number} wx - World X
     * @param {number} wz - World Z
     * @returns {number} Height at position, or NaN if out of bounds/hole
     */
    getHeightAtWorld(wx, wz) {
        const lx = (wx - this.origin[0]) / this.cellSizeX;
        const lz = (wz - this.origin[2]) / this.cellSizeZ;

        if (lx < 0 || lz < 0 || lx >= this.gridSizeX - 1 || lz >= this.gridSizeZ - 1) return NaN;

        const gx0 = Math.floor(lx);
        const gz0 = Math.floor(lz);
        const gx1 = Math.min(gx0 + 1, this.gridSizeX - 1);
        const gz1 = Math.min(gz0 + 1, this.gridSizeZ - 1);

        const fx = lx - gx0;
        const fz = lz - gz0;

        const h00 = this._cpuHeights[gz0 * this.gridSizeX + gx0];
        const h10 = this._cpuHeights[gz0 * this.gridSizeX + gx1];
        const h01 = this._cpuHeights[gz1 * this.gridSizeX + gx0];
        const h11 = this._cpuHeights[gz1 * this.gridSizeX + gx1];

        if (h00 < -1e9 || h10 < -1e9 || h01 < -1e9 || h11 < -1e9) return NaN;

        const h0 = h00 + (h10 - h00) * fx;
        const h1 = h01 + (h11 - h01) * fx;
        return h0 + (h1 - h0) * fz + this.origin[1];
    }

    /**
     * Get surface normal at a world position (CPU-side finite difference).
     */
    getNormalAtWorld(wx, wz) {
        const eps = this.cellSizeX * 0.5;
        const hL = this.getHeightAtWorld(wx - eps, wz);
        const hR = this.getHeightAtWorld(wx + eps, wz);
        const hD = this.getHeightAtWorld(wx, wz - eps);
        const hU = this.getHeightAtWorld(wx, wz + eps);

        if (isNaN(hL) || isNaN(hR) || isNaN(hD) || isNaN(hU)) return [0, 1, 0];

        const nx = hL - hR;
        const nz = hD - hU;
        const ny = 2 * eps;
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        return [nx / len, ny / len, nz / len];
    }

    /**
     * Set per-cell material index (for surface type queries).
     */
    setMaterial(gx, gz, materialIdx) {
        if (gx < 0 || gx >= this.gridSizeX || gz < 0 || gz >= this.gridSizeZ) return;
        this._cpuMaterials[gz * this.gridSizeX + gx] = materialIdx;
    }

    /**
     * Get material index at world position.
     */
    getMaterialAtWorld(wx, wz) {
        const gx = Math.floor((wx - this.origin[0]) / this.cellSizeX);
        const gz = Math.floor((wz - this.origin[2]) / this.cellSizeZ);
        if (gx < 0 || gx >= this.gridSizeX || gz < 0 || gz >= this.gridSizeZ) return 0;
        return this._cpuMaterials[gz * this.gridSizeX + gx];
    }

    /**
     * Generate heightfield from a noise function.
     * @param {Function} noiseFn - (x, z) => height
     */
    generateFromNoise(noiseFn) {
        for (let z = 0; z < this.gridSizeZ; z++) {
            for (let x = 0; x < this.gridSizeX; x++) {
                const wx = this.origin[0] + x * this.cellSizeX;
                const wz = this.origin[2] + z * this.cellSizeZ;
                this._cpuHeights[z * this.gridSizeX + x] = noiseFn(wx, wz);
            }
        }
        this._heightsDirty = true;
    }

    // ========================================================================
    // GPU DISPATCH
    // ========================================================================

    /**
     * Dispatch heightfield contact generation.
     * Call after broadphase but adds contacts to the same narrowphase contact buffer.
     */
    dispatch(encoder, bodyCount) {
        if (bodyCount === 0) return;

        // Upload heights if dirty
        if (this._heightsDirty) {
            this.device.queue.writeBuffer(this._buffers.heightData, 0, this._cpuHeights);
            this._heightsDirty = false;
        }

        // Write params
        this._paramsU32[0] = this.gridSizeX;
        this._paramsU32[1] = this.gridSizeZ;
        this._paramsF32[2] = this.cellSizeX;
        this._paramsF32[3] = this.cellSizeZ;
        this._paramsF32[4] = this.origin[0];
        this._paramsF32[5] = this.origin[1];
        this._paramsF32[6] = this.origin[2];
        this._paramsF32[7] = this.contactOffset;
        this._paramsU32[8] = bodyCount;
        this._paramsU32[9] = MAX_CONTACTS;
        this._paramsU32[10] = 0;
        this._paramsU32[11] = 0;
        this.device.queue.writeBuffer(this._buffers.params, 0, this._paramsF32);

        const wg = Math.ceil(bodyCount / 64);
        const pass = encoder.beginComputePass({ label: 'HF_Contact' });
        pass.setPipeline(this._pipelines.contact);
        pass.setBindGroup(0, this._bindGroups.contact);
        pass.dispatchWorkgroups(wg);
        pass.end();
    }

    // ========================================================================
    // CLEANUP
    // ========================================================================

    destroy() {
        for (const buf of Object.values(this._buffers)) {
            if (buf && typeof buf.destroy === 'function') buf.destroy();
        }
        this._buffers = {};
        this._cpuHeights = null;
        this._cpuMaterials = null;
    }
}

// ============================================================================
// FACTORY
// ============================================================================

export async function createHeightfield(device, worldBuffers, narrowphaseBuffers, options = {}) {
    const hf = new GPUHeightfield(device, options);
    await hf.init(worldBuffers, narrowphaseBuffers);
    return hf;
}

export function destroyHeightfield(hf) {
    if (hf) hf.destroy();
}
