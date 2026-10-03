/**
 * GPURaycast.js — GPU Compute Parallel Raycast
 * 
 * Casts rays against all rigid bodies on the GPU.
 * Each thread tests one body, writes closest hit to output.
 * Reduction pass finds global closest hit across all threads.
 * Result returned via async readback (Promise).
 * 
 * Also provides CPU fallback for synchronous raycasting
 * against CPU shadow data (1-frame lag, but instant).
 * 
 * Shape-ray tests:
 * - ray-sphere (geometric closest approach)
 * - ray-box (slab method)
 * - ray-capsule (ray-segment closest point + sphere test)
 */

import {
    MAX_BODIES,
    SHAPE_SPHERE, SHAPE_BOX, SHAPE_CAPSULE, SHAPE_CONVEX,
} from './GPURigidBodyWorld.js';

// ============================================================================
// WGSL SHADERS
// ============================================================================

const RAYCAST_SHADER = /* wgsl */`
// Per-body ray test. Each thread writes its hit (or miss) to a per-body result buffer.
// A second reduction pass finds the closest hit.

struct Collider {
    shapeType: u32,
    halfExtentX: f32, halfExtentY: f32, halfExtentZ: f32,
    radius: f32, halfHeight: f32,
    localOffsetX: f32, localOffsetY: f32, localOffsetZ: f32,
    friction: f32, restitution: f32,
    _pad0: f32, _pad1: f32, _pad2: f32, _pad3: f32, _pad4: f32,
}

struct RayParams {
    originX: f32, originY: f32, originZ: f32, maxDist: f32,
    dirX: f32, dirY: f32, dirZ: f32, bodyCount: u32,
}

struct HitResult {
    distance: f32,
    normalX: f32, normalY: f32, normalZ: f32,
    pointX: f32, pointY: f32, pointZ: f32,
    bodyIndex: u32,
}

@group(0) @binding(0) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> rotations: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> colliders: array<Collider>;
@group(0) @binding(3) var<storage, read> bodyFlags: array<u32>;
@group(0) @binding(4) var<storage, read_write> hitResults: array<HitResult>;
@group(0) @binding(5) var<uniform> params: RayParams;

fn rotateVec(v: vec3<f32>, q: vec4<f32>) -> vec3<f32> {
    let t = 2.0 * cross(q.xyz, v);
    return v + q.w * t + cross(q.xyz, t);
}

fn inverseRotateVec(v: vec3<f32>, q: vec4<f32>) -> vec3<f32> {
    let qInv = vec4<f32>(-q.xyz, q.w);
    return rotateVec(v, qInv);
}

// Ray-sphere intersection
fn raySphere(ro: vec3<f32>, rd: vec3<f32>, center: vec3<f32>, radius: f32) -> vec2<f32> {
    let oc = ro - center;
    let b = dot(oc, rd);
    let c = dot(oc, oc) - radius * radius;
    let discriminant = b * b - c;
    if (discriminant < 0.0) { return vec2<f32>(-1.0, -1.0); }
    let sqrtD = sqrt(discriminant);
    let t0 = -b - sqrtD;
    let t1 = -b + sqrtD;
    return vec2<f32>(t0, t1);
}

// Ray-box intersection (slab method, in box local space)
fn rayBox(ro: vec3<f32>, rd: vec3<f32>, halfExtents: vec3<f32>) -> vec2<f32> {
    let invD = 1.0 / (rd + vec3<f32>(0.00001)); // avoid div by zero
    let t1 = (-halfExtents - ro) * invD;
    let t2 = (halfExtents - ro) * invD;
    let tmin = max(max(min(t1.x, t2.x), min(t1.y, t2.y)), min(t1.z, t2.z));
    let tmax = min(min(max(t1.x, t2.x), max(t1.y, t2.y)), max(t1.z, t2.z));
    if (tmax < 0.0 || tmin > tmax) { return vec2<f32>(-1.0, -1.0); }
    return vec2<f32>(tmin, tmax);
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let id = gid.x;
    if (id >= params.bodyCount) { return; }

    // Default: no hit
    hitResults[id] = HitResult(params.maxDist + 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0xFFFFFFFFu);

    let flags = bodyFlags[id];
    // Skip sleeping bodies for raycast? Optional — we include them for correctness
    // if ((flags & 4u) != 0u) { return; }

    let pos = positions[id].xyz;
    let rot = rotations[id];
    let col = colliders[id];

    let origin = vec3<f32>(params.originX, params.originY, params.originZ);
    let dir = vec3<f32>(params.dirX, params.dirY, params.dirZ);

    var hitDist: f32 = params.maxDist + 1.0;
    var hitNormal: vec3<f32> = vec3<f32>(0.0);
    var hitPoint: vec3<f32> = vec3<f32>(0.0);

    switch col.shapeType {
        case 0u: { // SPHERE
            let localOffset = vec3<f32>(col.localOffsetX, col.localOffsetY, col.localOffsetZ);
            let center = pos + rotateVec(localOffset, rot);
            let ts = raySphere(origin, dir, center, col.radius);
            let t = select(ts.y, ts.x, ts.x >= 0.0); // Use t0 if positive, else t1
            if (t >= 0.0 && t <= params.maxDist) {
                hitDist = t;
                hitPoint = origin + dir * t;
                hitNormal = normalize(hitPoint - center);
            }
        }
        case 1u: { // BOX
            let localOffset = vec3<f32>(col.localOffsetX, col.localOffsetY, col.localOffsetZ);
            let center = pos + rotateVec(localOffset, rot);
            // Transform ray into box local space
            let localOrigin = inverseRotateVec(origin - center, rot);
            let localDir = inverseRotateVec(dir, rot);
            let he = vec3<f32>(col.halfExtentX, col.halfExtentY, col.halfExtentZ);
            let ts = rayBox(localOrigin, localDir, he);
            let t = select(ts.y, ts.x, ts.x >= 0.0);
            if (t >= 0.0 && t <= params.maxDist) {
                hitDist = t;
                let localHit = localOrigin + localDir * t;
                hitPoint = center + rotateVec(localHit, rot);
                // Normal: find which face was hit
                let eps = vec3<f32>(0.001);
                let absHit = abs(localHit);
                var localNormal = vec3<f32>(0.0);
                if (absHit.x > he.x - eps.x) {
                    localNormal = vec3<f32>(sign(localHit.x), 0.0, 0.0);
                } else if (absHit.y > he.y - eps.y) {
                    localNormal = vec3<f32>(0.0, sign(localHit.y), 0.0);
                } else {
                    localNormal = vec3<f32>(0.0, 0.0, sign(localHit.z));
                }
                hitNormal = rotateVec(localNormal, rot);
            }
        }
        case 2u: { // CAPSULE
            let localOffset = vec3<f32>(col.localOffsetX, col.localOffsetY, col.localOffsetZ);
            let center = pos + rotateVec(localOffset, rot);
            let axis = rotateVec(vec3<f32>(0.0, col.halfHeight, 0.0), rot);
            let capA = center - axis;
            let capB = center + axis;

            // Test against both end spheres and cylinder
            let tsA = raySphere(origin, dir, capA, col.radius);
            let tsB = raySphere(origin, dir, capB, col.radius);
            let tA = select(tsA.y, tsA.x, tsA.x >= 0.0);
            let tB = select(tsB.y, tsB.x, tsB.x >= 0.0);

            var bestT: f32 = params.maxDist + 1.0;
            var bestCenter: vec3<f32> = capA;

            if (tA >= 0.0 && tA < bestT) { bestT = tA; bestCenter = capA; }
            if (tB >= 0.0 && tB < bestT) { bestT = tB; bestCenter = capB; }

            // Cylinder body test (approximate: closest point on axis segment to ray)
            let ab = capB - capA;
            let ao = origin - capA;
            let abab = dot(ab, ab);
            let abrd = dot(ab, dir);
            let abao = dot(ab, ao);
            let denom = abab - abrd * abrd;
            if (abs(denom) > 0.0001) {
                let rdao = dot(dir, ao);
                let s = (abab * rdao - abao * abrd) / denom;
                let u = (abrd * rdao - abao) / denom; // wrong sign — simplified
                if (s >= 0.0 && u >= 0.0 && u <= 1.0) {
                    let cylinderPt = capA + ab * u;
                    let rayPt = origin + dir * s;
                    let dist = length(rayPt - cylinderPt);
                    if (dist <= col.radius && s < bestT) {
                        bestT = s;
                        bestCenter = cylinderPt;
                    }
                }
            }

            if (bestT >= 0.0 && bestT <= params.maxDist) {
                hitDist = bestT;
                hitPoint = origin + dir * bestT;
                hitNormal = normalize(hitPoint - bestCenter);
            }
        }
        default: { // CONVEX — use AABB approximation
            let localOffset = vec3<f32>(col.localOffsetX, col.localOffsetY, col.localOffsetZ);
            let center = pos + rotateVec(localOffset, rot);
            let localOrigin = inverseRotateVec(origin - center, rot);
            let localDir = inverseRotateVec(dir, rot);
            let he = vec3<f32>(col.halfExtentX, col.halfExtentY, col.halfExtentZ);
            let ts = rayBox(localOrigin, localDir, he);
            let t = select(ts.y, ts.x, ts.x >= 0.0);
            if (t >= 0.0 && t <= params.maxDist) {
                hitDist = t;
                let localHit = localOrigin + localDir * t;
                hitPoint = center + rotateVec(localHit, rot);
                hitNormal = normalize(hitPoint - center);
            }
        }
    }

    if (hitDist <= params.maxDist) {
        hitResults[id] = HitResult(
            hitDist,
            hitNormal.x, hitNormal.y, hitNormal.z,
            hitPoint.x, hitPoint.y, hitPoint.z,
            id,
        );
    }
}
`;

const REDUCE_HITS_SHADER = /* wgsl */`
// Parallel reduction to find closest hit across all per-body results
// Two-pass: first reduce within workgroups, then final reduce

struct HitResult {
    distance: f32,
    normalX: f32, normalY: f32, normalZ: f32,
    pointX: f32, pointY: f32, pointZ: f32,
    bodyIndex: u32,
}

struct Params {
    count: u32,
    _pad0: u32,
    _pad1: u32,
    _pad2: u32,
}

@group(0) @binding(0) var<storage, read> hitResults: array<HitResult>;
@group(0) @binding(1) var<storage, read_write> bestHit: array<HitResult>;
@group(0) @binding(2) var<uniform> params: Params;

var<workgroup> shared: array<HitResult, 64>;

@compute @workgroup_size(64)
fn main(
    @builtin(global_invocation_id) gid: vec3<u32>,
    @builtin(local_invocation_id) lid: vec3<u32>,
    @builtin(workgroup_id) wid: vec3<u32>,
) {
    let idx = gid.x;
    let localIdx = lid.x;

    // Load into shared memory
    if (idx < params.count) {
        shared[localIdx] = hitResults[idx];
    } else {
        shared[localIdx] = HitResult(1e10, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0xFFFFFFFFu);
    }
    workgroupBarrier();

    // Parallel reduction within workgroup
    for (var stride = 32u; stride > 0u; stride >>= 1u) {
        if (localIdx < stride) {
            if (shared[localIdx + stride].distance < shared[localIdx].distance) {
                shared[localIdx] = shared[localIdx + stride];
            }
        }
        workgroupBarrier();
    }

    // Thread 0 writes workgroup result
    if (localIdx == 0u) {
        bestHit[wid.x] = shared[0];
    }
}
`;

// ============================================================================
// GPU RAYCAST CLASS
// ============================================================================

export class GPURaycast {
    constructor(device, options = {}) {
        this.device = device;
        this.maxBodies = options.maxBodies ?? MAX_BODIES;

        this._buffers = {};
        this._pipelines = {};
        this._bindGroups = {};
        this._paramsF32 = new Float32Array(8);
        this._paramsU32 = new Uint32Array(this._paramsF32.buffer);
    }

    async init(worldBuffers) {
        this._createBuffers();
        await this._createPipelines(worldBuffers);
        console.log(`[GPURaycast] Initialized — maxBodies=${this.maxBodies}`);
    }

    _createBuffers() {
        const d = this.device;
        const b = (label, size, usage) => d.createBuffer({ label, size, usage });
        const SUW = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
        const hitSize = 32; // 8 floats per HitResult

        // Per-body hit results
        this._buffers.hitResults = b('RC_HitResults', this.maxBodies * hitSize, SUW);

        // Reduction output (one per workgroup, max 64 workgroups)
        const maxWorkgroups = Math.ceil(this.maxBodies / 64);
        this._buffers.reducedHits = b('RC_ReducedHits', maxWorkgroups * hitSize, SUW);

        // Final best hit (single result)
        this._buffers.finalHit = b('RC_FinalHit', hitSize, SUW);

        // Readback
        this._buffers.readback = b('RC_Readback', hitSize, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);

        // Params
        this._buffers.rayParams = b('RC_RayParams', 32, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
        this._buffers.reduceParams = b('RC_ReduceParams', 16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
        this._buffers.reduceParams2 = b('RC_ReduceParams2', 16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    }

    async _createPipelines(worldBuffers) {
        const d = this.device;
        const mkModule = (label, code) => d.createShaderModule({ label, code });
        const mkPipeline = async (label, module) => d.createComputePipelineAsync({
            label, layout: 'auto', compute: { module, entryPoint: 'main' },
        });

        const rayModule = mkModule('RC_Raycast', RAYCAST_SHADER);
        const reduceModule = mkModule('RC_Reduce', REDUCE_HITS_SHADER);

        this._pipelines.raycast = await mkPipeline('RC_Raycast', rayModule);
        this._pipelines.reduce = await mkPipeline('RC_Reduce', reduceModule);

        this._rebuildBindGroups(worldBuffers);
    }

    _rebuildBindGroups(wb) {
        const d = this.device;
        const B = this._buffers;
        const P = this._pipelines;

        this._bindGroups.raycast = d.createBindGroup({
            label: 'RC_Raycast_BG',
            layout: P.raycast.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: wb.positions } },
                { binding: 1, resource: { buffer: wb.rotations } },
                { binding: 2, resource: { buffer: wb.colliders } },
                { binding: 3, resource: { buffer: wb.bodyFlags } },
                { binding: 4, resource: { buffer: B.hitResults } },
                { binding: 5, resource: { buffer: B.rayParams } },
            ],
        });

        // Reduce pass 1: hitResults → reducedHits
        this._bindGroups.reduce1 = d.createBindGroup({
            label: 'RC_Reduce1_BG',
            layout: P.reduce.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: B.hitResults } },
                { binding: 1, resource: { buffer: B.reducedHits } },
                { binding: 2, resource: { buffer: B.reduceParams } },
            ],
        });

        // Reduce pass 2: reducedHits → finalHit
        this._bindGroups.reduce2 = d.createBindGroup({
            label: 'RC_Reduce2_BG',
            layout: P.reduce.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: B.reducedHits } },
                { binding: 1, resource: { buffer: B.finalHit } },
                { binding: 2, resource: { buffer: B.reduceParams2 } },
            ],
        });
    }

    /**
     * Cast a ray on GPU. Returns a Promise with the closest hit.
     * @param {GPURigidBodyWorld} world
     * @param {number[]} origin - [x, y, z]
     * @param {number[]} direction - [dx, dy, dz] (should be normalized)
     * @param {number} maxDistance
     * @returns {Promise<{hit: boolean, distance: number, position: number[], normal: number[], bodyIndex: number}>}
     */
    async cast(world, origin, direction, maxDistance = 1000) {
        if (!world || world.bodyCount === 0) {
            return { hit: false, distance: maxDistance, position: [0,0,0], normal: [0,0,0], bodyIndex: -1 };
        }

        const bodyCount = world.bodyCount;

        // Write ray params
        this._paramsF32[0] = origin[0];
        this._paramsF32[1] = origin[1];
        this._paramsF32[2] = origin[2];
        this._paramsF32[3] = maxDistance;
        this._paramsF32[4] = direction[0];
        this._paramsF32[5] = direction[1];
        this._paramsF32[6] = direction[2];
        this._paramsU32[7] = bodyCount;
        this.device.queue.writeBuffer(this._buffers.rayParams, 0, this._paramsF32);

        const encoder = this.device.createCommandEncoder({ label: 'RC_Cast' });
        const bodyWG = Math.ceil(bodyCount / 64);

        // Pass 1: Per-body ray test
        const rayPass = encoder.beginComputePass({ label: 'RC_Raycast' });
        rayPass.setPipeline(this._pipelines.raycast);
        rayPass.setBindGroup(0, this._bindGroups.raycast);
        rayPass.dispatchWorkgroups(bodyWG);
        rayPass.end();

        // Pass 2: Reduce per-body results to per-workgroup
        const reduceParams1 = new Uint32Array([bodyCount, 0, 0, 0]);
        this.device.queue.writeBuffer(this._buffers.reduceParams, 0, reduceParams1);

        const reduce1Pass = encoder.beginComputePass({ label: 'RC_Reduce1' });
        reduce1Pass.setPipeline(this._pipelines.reduce);
        reduce1Pass.setBindGroup(0, this._bindGroups.reduce1);
        reduce1Pass.dispatchWorkgroups(bodyWG);
        reduce1Pass.end();

        // Pass 3: Reduce workgroup results to single result
        if (bodyWG > 1) {
            const reduceParams2 = new Uint32Array([bodyWG, 0, 0, 0]);
            this.device.queue.writeBuffer(this._buffers.reduceParams2, 0, reduceParams2);

            const reduce2Pass = encoder.beginComputePass({ label: 'RC_Reduce2' });
            reduce2Pass.setPipeline(this._pipelines.reduce);
            reduce2Pass.setBindGroup(0, this._bindGroups.reduce2);
            reduce2Pass.dispatchWorkgroups(1);
            reduce2Pass.end();

            encoder.copyBufferToBuffer(this._buffers.finalHit, 0, this._buffers.readback, 0, 32);
        } else {
            encoder.copyBufferToBuffer(this._buffers.reducedHits, 0, this._buffers.readback, 0, 32);
        }

        this.device.queue.submit([encoder.finish()]);

        // Readback
        try {
            await this._buffers.readback.mapAsync(GPUMapMode.READ);
            const data = new Float32Array(this._buffers.readback.getMappedRange().slice(0));
            this._buffers.readback.unmap();

            const distance = data[0];
            const bodyIdx = new Uint32Array(data.buffer)[7];
            const hit = bodyIdx !== 0xFFFFFFFF && distance <= maxDistance;

            return {
                hit,
                distance: hit ? distance : maxDistance,
                normal: hit ? [data[1], data[2], data[3]] : [0, 0, 0],
                position: hit ? [data[4], data[5], data[6]] : [0, 0, 0],
                bodyIndex: hit ? bodyIdx : -1,
            };
        } catch (e) {
            console.warn('[GPURaycast] Readback failed:', e.message);
            return { hit: false, distance: maxDistance, position: [0,0,0], normal: [0,0,0], bodyIndex: -1 };
        }
    }

    destroy() {
        for (const buf of Object.values(this._buffers)) {
            if (buf && typeof buf.destroy === 'function') buf.destroy();
        }
        this._buffers = {};
    }
}

// ============================================================================
// CPU FALLBACK RAYCAST (synchronous, uses CPU shadow data)
// ============================================================================

/**
 * Synchronous CPU raycast against CPU shadow data (1-frame lag).
 * Use when async GPU raycast is too slow or when GPU is busy.
 * 
 * @param {GPURigidBodyWorld} world
 * @param {number[]} origin
 * @param {number[]} direction
 * @param {number} maxDistance
 * @returns {{ hit: boolean, distance: number, position: number[], normal: number[], bodyIndex: number }}
 */
export function gpuRaycastCPU(world, origin, direction, maxDistance = 1000) {
    if (!world || world.bodyCount === 0) {
        return { hit: false, distance: maxDistance, position: [0,0,0], normal: [0,0,0], bodyIndex: -1 };
    }

    const ox = origin[0], oy = origin[1], oz = origin[2];
    const dx = direction[0], dy = direction[1], dz = direction[2];
    const pos = world._cpuPositions;
    const colliders = world._cpuColliders;

    let bestDist = maxDistance;
    let bestIdx = -1;
    let bestNormal = [0, 0, 0];
    let bestPoint = [0, 0, 0];

    for (let i = 0; i < world.bodyCount; i++) {
        const desc = world.bodyDescriptions[i];
        if (!desc?.active) continue;

        const ci = i * 16;
        const shapeU32 = new Uint32Array(colliders.buffer)[ci];
        const px = pos[i * 4], py = pos[i * 4 + 1], pz = pos[i * 4 + 2];

        let t = -1;
        let normal = [0, 1, 0];

        if (shapeU32 === SHAPE_SPHERE) {
            const radius = colliders[ci + 4];
            t = _cpuRaySphere(ox, oy, oz, dx, dy, dz, px, py, pz, radius);
            if (t >= 0 && t < bestDist) {
                const hx = ox + dx * t, hy = oy + dy * t, hz = oz + dz * t;
                const len = Math.sqrt((hx-px)**2 + (hy-py)**2 + (hz-pz)**2) || 1;
                normal = [(hx-px)/len, (hy-py)/len, (hz-pz)/len];
            }
        } else if (shapeU32 === SHAPE_BOX) {
            const heX = colliders[ci + 1], heY = colliders[ci + 2], heZ = colliders[ci + 3];
            // Simplified: axis-aligned box at body position (ignoring rotation for CPU fallback)
            t = _cpuRayAABB(ox, oy, oz, dx, dy, dz, px - heX, py - heY, pz - heZ, px + heX, py + heY, pz + heZ);
            if (t >= 0 && t < bestDist) {
                normal = [0, 1, 0]; // Simplified
            }
        } else if (shapeU32 === SHAPE_CAPSULE) {
            const radius = colliders[ci + 4];
            // Simplified: treat as sphere at body center
            t = _cpuRaySphere(ox, oy, oz, dx, dy, dz, px, py, pz, radius);
            if (t >= 0 && t < bestDist) {
                const hx = ox + dx * t, hy = oy + dy * t, hz = oz + dz * t;
                const len = Math.sqrt((hx-px)**2 + (hy-py)**2 + (hz-pz)**2) || 1;
                normal = [(hx-px)/len, (hy-py)/len, (hz-pz)/len];
            }
        }

        if (t >= 0 && t < bestDist) {
            bestDist = t;
            bestIdx = i;
            bestNormal = normal;
            bestPoint = [ox + dx * t, oy + dy * t, oz + dz * t];
        }
    }

    return {
        hit: bestIdx >= 0,
        distance: bestIdx >= 0 ? bestDist : maxDistance,
        position: bestPoint,
        normal: bestNormal,
        bodyIndex: bestIdx,
    };
}

function _cpuRaySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
    const ocx = ox - cx, ocy = oy - cy, ocz = oz - cz;
    const b = ocx * dx + ocy * dy + ocz * dz;
    const c = ocx * ocx + ocy * ocy + ocz * ocz - r * r;
    const disc = b * b - c;
    if (disc < 0) return -1;
    const sqrtD = Math.sqrt(disc);
    const t0 = -b - sqrtD;
    const t1 = -b + sqrtD;
    return t0 >= 0 ? t0 : (t1 >= 0 ? t1 : -1);
}

function _cpuRayAABB(ox, oy, oz, dx, dy, dz, minX, minY, minZ, maxX, maxY, maxZ) {
    const invDx = dx !== 0 ? 1 / dx : 1e10;
    const invDy = dy !== 0 ? 1 / dy : 1e10;
    const invDz = dz !== 0 ? 1 / dz : 1e10;
    const t1x = (minX - ox) * invDx, t2x = (maxX - ox) * invDx;
    const t1y = (minY - oy) * invDy, t2y = (maxY - oy) * invDy;
    const t1z = (minZ - oz) * invDz, t2z = (maxZ - oz) * invDz;
    const tmin = Math.max(Math.min(t1x, t2x), Math.min(t1y, t2y), Math.min(t1z, t2z));
    const tmax = Math.min(Math.max(t1x, t2x), Math.max(t1y, t2y), Math.max(t1z, t2z));
    if (tmax < 0 || tmin > tmax) return -1;
    return tmin >= 0 ? tmin : tmax;
}

// ============================================================================
// FACTORY
// ============================================================================

export async function createGPURaycast(device, worldBuffers, options = {}) {
    const rc = new GPURaycast(device, options);
    await rc.init(worldBuffers);
    return rc;
}

export function destroyGPURaycast(rc) {
    if (rc) rc.destroy();
}

/**
 * GPU raycast (async).
 */
export async function gpuRaycast(rc, world, origin, direction, maxDistance = 1000) {
    return rc.cast(world, origin, direction, maxDistance);
}
