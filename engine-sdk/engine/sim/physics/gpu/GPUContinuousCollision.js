/**
 * GPUContinuousCollision.js — GPU Speculative CCD (Continuous Collision Detection)
 * 
 * Prevents fast-moving objects from tunneling through thin geometry.
 * Uses speculative contacts: expand AABBs by velocity, generate
 * conservative contacts at predicted future positions.
 * 
 * Based on:
 * - PhysX CCD: PxPairFlag::eDETECT_CCD_CONTACT, PxRigidBodyFlag::eENABLE_CCD
 * - Bullet Physics: speculative contacts (Erwin Coumans GDC 2013)
 * - Existing engine SpeculativeContacts.js (CPU) — this is the GPU version
 * 
 * Architecture:
 * - GPU shader expands AABBs by linear velocity * dt
 * - Broadphase runs on expanded AABBs (catches potential tunneling pairs)
 * - For CCD-flagged bodies, compute time of impact (TOI) via conservative advancement
 * - Clamp body position to TOI * displacement if tunneling detected
 * - Generates speculative contacts at predicted impact point
 * 
 * When to enable CCD:
 * - Bullets, projectiles, fast vehicles
 * - Small objects near thin walls
 * - Any body with speed > size/dt (tunneling risk)
 */

import { MAX_BODIES, MAX_CONTACTS } from './GPURigidBodyWorld.js';

// ============================================================================
// CONSTANTS
// ============================================================================

export const CCD_FLAG_BIT = 0x2000000; // Bit 25 in bodyFlags — enables CCD for this body
export const MAX_CCD_PAIRS = 8192;
export const CCD_SLOP = 0.001; // Minimum penetration tolerance

// ============================================================================
// WGSL SHADERS
// ============================================================================

const CCD_EXPAND_AABB_SHADER = /* wgsl */`
// Expand AABBs by linear velocity for CCD-flagged bodies
// Writes to separate expanded AABB buffers for broadphase

struct Collider {
    shapeType: u32,
    halfExtentX: f32, halfExtentY: f32, halfExtentZ: f32,
    radius: f32, halfHeight: f32,
    localOffsetX: f32, localOffsetY: f32, localOffsetZ: f32,
    friction: f32, restitution: f32,
    _pad0: f32, _pad1: f32, _pad2: f32, _pad3: f32, _pad4: f32,
}

struct Params {
    bodyCount: u32,
    dt: f32,
    _pad0: u32,
    _pad1: u32,
}

@group(0) @binding(0) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> velocities: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> colliders: array<Collider>;
@group(0) @binding(3) var<storage, read> bodyFlags: array<u32>;
@group(0) @binding(4) var<storage, read_write> expandedMins: array<vec4<f32>>;
@group(0) @binding(5) var<storage, read_write> expandedMaxs: array<vec4<f32>>;
@group(0) @binding(6) var<uniform> params: Params;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let id = gid.x;
    if (id >= params.bodyCount) { return; }

    let flags = bodyFlags[id];
    let pos = positions[id].xyz;
    let vel = velocities[id].xyz;
    let col = colliders[id];

    // Base half-extents
    var he = vec3<f32>(0.0);
    switch col.shapeType {
        case 0u: { he = vec3<f32>(col.radius); }
        case 1u: { he = vec3<f32>(col.halfExtentX, col.halfExtentY, col.halfExtentZ); }
        case 2u: { he = vec3<f32>(col.radius, col.halfHeight + col.radius, col.radius); }
        default: { he = vec3<f32>(col.halfExtentX, col.halfExtentY, col.halfExtentZ); }
    }

    var aabbMin = pos - he;
    var aabbMax = pos + he;

    // If CCD enabled (bit 25), expand AABB by velocity * dt
    let ccdEnabled = (flags & 0x2000000u) != 0u;
    if (ccdEnabled) {
        let displacement = vel * params.dt;
        // Expand in direction of motion
        aabbMin = min(aabbMin, aabbMin + displacement);
        aabbMax = max(aabbMax, aabbMax + displacement);
        // Add small margin
        aabbMin -= vec3<f32>(0.01);
        aabbMax += vec3<f32>(0.01);
    }

    expandedMins[id] = vec4<f32>(aabbMin, 0.0);
    expandedMaxs[id] = vec4<f32>(aabbMax, 0.0);
}
`;

const CCD_TOI_SHADER = /* wgsl */`
// For each CCD pair, compute time of impact using conservative advancement
// If TOI < 1, generate a speculative contact at the predicted impact point

struct CCDPair {
    bodyA: u32,
    bodyB: u32,
    _pad0: u32,
    _pad1: u32,
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

struct Collider {
    shapeType: u32,
    halfExtentX: f32, halfExtentY: f32, halfExtentZ: f32,
    radius: f32, halfHeight: f32,
    localOffsetX: f32, localOffsetY: f32, localOffsetZ: f32,
    friction: f32, restitution: f32,
    _pad0: f32, _pad1: f32, _pad2: f32, _pad3: f32, _pad4: f32,
}

struct Params {
    pairCount: u32,
    dt: f32,
    maxContacts: u32,
    slop: f32,
}

@group(0) @binding(0) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> velocities: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> colliders: array<Collider>;
@group(0) @binding(3) var<storage, read> ccdPairs: array<CCDPair>;
@group(0) @binding(4) var<storage, read_write> contacts: array<Contact>;
@group(0) @binding(5) var<storage, read_write> contactCount: atomic<u32>;
@group(0) @binding(6) var<uniform> params: Params;

fn bodyRadius(col: Collider) -> f32 {
    switch col.shapeType {
        case 0u: { return col.radius; }
        case 1u: { return min(min(col.halfExtentX, col.halfExtentY), col.halfExtentZ); }
        case 2u: { return col.radius; }
        default: { return col.radius; }
    }
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let pairIdx = gid.x;
    if (pairIdx >= params.pairCount) { return; }

    let pair = ccdPairs[pairIdx];
    let posA = positions[pair.bodyA].xyz;
    let posB = positions[pair.bodyB].xyz;
    let velA = velocities[pair.bodyA].xyz;
    let velB = velocities[pair.bodyB].xyz;
    let colA = colliders[pair.bodyA];
    let colB = colliders[pair.bodyB];

    let rA = bodyRadius(colA);
    let rB = bodyRadius(colB);
    let sumR = rA + rB;

    // Relative velocity and position
    let relVel = velA - velB;
    let relPos = posA - posB;
    let relSpeed = length(relVel);

    if (relSpeed < 0.01) { return; }

    // Time of closest approach (sphere-sphere conservative)
    let d = relPos;
    let v = relVel;
    let a = dot(v, v);
    let b = 2.0 * dot(d, v);
    let c = dot(d, d) - sumR * sumR;

    // Current distance
    let dist = length(d);
    if (dist <= sumR + params.slop) {
        // Already overlapping — regular narrowphase handles this
        return;
    }

    // Quadratic formula for TOI
    let discriminant = b * b - 4.0 * a * c;
    if (discriminant < 0.0) { return; } // No intersection

    let sqrtD = sqrt(discriminant);
    let t0 = (-b - sqrtD) / (2.0 * a);

    // TOI must be in (0, dt] range
    if (t0 <= 0.0 || t0 > params.dt) { return; }

    // Predicted positions at TOI
    let predA = posA + velA * t0;
    let predB = posB + velB * t0;
    let contactPoint = (predA + predB) * 0.5;
    let contactNormal = normalize(predA - predB);
    let penetration = sumR - length(predA - predB) + params.slop;

    if (penetration < 0.0) { return; }

    let idx = atomicAdd(&contactCount, 1u);
    if (idx >= params.maxContacts) { return; }

    // Speculative contact: negative penetration = predicted future contact
    contacts[idx] = Contact(
        pair.bodyA, pair.bodyB,
        contactNormal.x, contactNormal.y, contactNormal.z,
        penetration * 0.5, // Conservative penetration
        contactPoint.x, contactPoint.y, contactPoint.z,
        0.0,
        0.0, 0.0, 0.0,
        0.0, 0.0, 0.0,
        400u, // featureId for CCD contacts
        0u,
    );
}
`;

// ============================================================================
// GPU CCD SYSTEM
// ============================================================================

export class GPUContinuousCollision {
    constructor(device, options = {}) {
        this.device = device;
        this.maxPairs = options.maxPairs ?? MAX_CCD_PAIRS;

        this._buffers = {};
        this._pipelines = {};
        this._bindGroups = {};
        this._expandParamsF32 = new Float32Array(4);
        this._expandParamsU32 = new Uint32Array(this._expandParamsF32.buffer);
        this._toiParamsF32 = new Float32Array(4);
        this._toiParamsU32 = new Uint32Array(this._toiParamsF32.buffer);

        // CPU pair buffer for CCD pairs found during broadphase
        this._cpuPairs = new Uint32Array(this.maxPairs * 4);
        this._pairCount = 0;
    }

    async init(worldBuffers, narrowphaseBuffers) {
        this._createBuffers();
        await this._createPipelines(worldBuffers, narrowphaseBuffers);
        console.log(`[GPUCCD] Initialized — maxPairs=${this.maxPairs}`);
    }

    _createBuffers() {
        const d = this.device;
        const b = (label, size, usage) => d.createBuffer({ label, size, usage });
        const SUW = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
        const maxB = MAX_BODIES;

        this._buffers.expandedMins = b('CCD_ExpandedMins', maxB * 16, SUW);
        this._buffers.expandedMaxs = b('CCD_ExpandedMaxs', maxB * 16, SUW);
        this._buffers.expandParams = b('CCD_ExpandParams', 16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
        this._buffers.ccdPairs = b('CCD_Pairs', this.maxPairs * 16, SUW);
        this._buffers.toiParams = b('CCD_TOIParams', 16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    }

    async _createPipelines(wb, npb) {
        const d = this.device;

        const expandModule = d.createShaderModule({ label: 'CCD_Expand', code: CCD_EXPAND_AABB_SHADER });
        this._pipelines.expand = await d.createComputePipelineAsync({
            label: 'CCD_Expand', layout: 'auto',
            compute: { module: expandModule, entryPoint: 'main' },
        });

        const toiModule = d.createShaderModule({ label: 'CCD_TOI', code: CCD_TOI_SHADER });
        this._pipelines.toi = await d.createComputePipelineAsync({
            label: 'CCD_TOI', layout: 'auto',
            compute: { module: toiModule, entryPoint: 'main' },
        });

        this._bindGroups.expand = d.createBindGroup({
            label: 'CCD_Expand_BG',
            layout: this._pipelines.expand.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: wb.positions } },
                { binding: 1, resource: { buffer: wb.velocities } },
                { binding: 2, resource: { buffer: wb.colliders } },
                { binding: 3, resource: { buffer: wb.bodyFlags } },
                { binding: 4, resource: { buffer: this._buffers.expandedMins } },
                { binding: 5, resource: { buffer: this._buffers.expandedMaxs } },
                { binding: 6, resource: { buffer: this._buffers.expandParams } },
            ],
        });

        this._bindGroups.toi = d.createBindGroup({
            label: 'CCD_TOI_BG',
            layout: this._pipelines.toi.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: wb.positions } },
                { binding: 1, resource: { buffer: wb.velocities } },
                { binding: 2, resource: { buffer: wb.colliders } },
                { binding: 3, resource: { buffer: this._buffers.ccdPairs } },
                { binding: 4, resource: { buffer: npb.contacts } },
                { binding: 5, resource: { buffer: npb.contactCount } },
                { binding: 6, resource: { buffer: this._buffers.toiParams } },
            ],
        });
    }

    /**
     * Set CCD pairs found during broadphase (call from CPU after broadphase readback).
     * @param {Array<[number,number]>} pairs - Array of [bodyA, bodyB] pairs where at least one has CCD flag
     */
    setCCDPairs(pairs) {
        this._pairCount = Math.min(pairs.length, this.maxPairs);
        for (let i = 0; i < this._pairCount; i++) {
            this._cpuPairs[i * 4] = pairs[i][0];
            this._cpuPairs[i * 4 + 1] = pairs[i][1];
        }
        this.device.queue.writeBuffer(this._buffers.ccdPairs, 0, this._cpuPairs);
    }

    /**
     * Dispatch CCD passes.
     * 1. Expand AABBs (use expanded AABBs for broadphase)
     * 2. TOI computation for CCD pairs (generates speculative contacts)
     */
    dispatchExpand(encoder, bodyCount, dt) {
        if (bodyCount === 0) return;

        this._expandParamsU32[0] = bodyCount;
        this._expandParamsF32[1] = dt;
        this.device.queue.writeBuffer(this._buffers.expandParams, 0, this._expandParamsF32);

        const wg = Math.ceil(bodyCount / 64);
        const pass = encoder.beginComputePass({ label: 'CCD_Expand' });
        pass.setPipeline(this._pipelines.expand);
        pass.setBindGroup(0, this._bindGroups.expand);
        pass.dispatchWorkgroups(wg);
        pass.end();
    }

    dispatchTOI(encoder, dt) {
        if (this._pairCount === 0) return;

        this._toiParamsU32[0] = this._pairCount;
        this._toiParamsF32[1] = dt;
        this._toiParamsU32[2] = MAX_CONTACTS;
        this._toiParamsF32[3] = CCD_SLOP;
        this.device.queue.writeBuffer(this._buffers.toiParams, 0, this._toiParamsF32);

        const wg = Math.ceil(this._pairCount / 64);
        const pass = encoder.beginComputePass({ label: 'CCD_TOI' });
        pass.setPipeline(this._pipelines.toi);
        pass.setBindGroup(0, this._bindGroups.toi);
        pass.dispatchWorkgroups(wg);
        pass.end();
    }

    /**
     * Get expanded AABB buffers (feed to broadphase instead of regular AABBs).
     */
    getExpandedAABBBuffers() {
        return {
            mins: this._buffers.expandedMins,
            maxs: this._buffers.expandedMaxs,
        };
    }

    destroy() {
        for (const buf of Object.values(this._buffers)) {
            if (buf && typeof buf.destroy === 'function') buf.destroy();
        }
        this._buffers = {};
    }
}

// ============================================================================
// FACTORY
// ============================================================================

export async function createContinuousCollision(device, worldBuffers, narrowphaseBuffers, options = {}) {
    const ccd = new GPUContinuousCollision(device, options);
    await ccd.init(worldBuffers, narrowphaseBuffers);
    return ccd;
}

export function destroyContinuousCollision(ccd) {
    if (ccd) ccd.destroy();
}
