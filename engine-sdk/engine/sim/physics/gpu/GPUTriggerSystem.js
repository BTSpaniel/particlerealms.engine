/**
 * GPUTriggerSystem.js — Trigger Volumes & Contact Event System
 * 
 * GPU-accelerated trigger overlap detection and contact event generation.
 * Mirrors PhysX's onContact/onTrigger callback system.
 * 
 * Features:
 * - Trigger volumes: AABB overlap tests on GPU, event dispatch on CPU
 * - Contact events: begin/persist/end contact tracking with entity IDs
 * - Event buffering: GPU writes events, CPU reads back and dispatches
 * - Pair tracking: persistent pair state across frames for begin/end detection
 * 
 * Based on:
 * - PhysX PxSimulationEventCallback: onContact, onTrigger, onConstraintBreak
 * - PhysX PxPairFlag: eNOTIFY_TOUCH_FOUND, eNOTIFY_TOUCH_PERSISTS, eNOTIFY_TOUCH_LOST
 * - PhysX PxShapeFlagEnum: eTRIGGER_SHAPE (no contact response, only overlap events)
 */

import { MAX_BODIES } from './GPURigidBodyWorld.js';

// ============================================================================
// CONSTANTS
// ============================================================================

export const MAX_TRIGGER_EVENTS  = 4096;
export const MAX_CONTACT_EVENTS  = 4096;

export const TRIGGER_ENTER = 0;
export const TRIGGER_STAY  = 1;
export const TRIGGER_EXIT  = 2;

export const CONTACT_BEGIN   = 0;
export const CONTACT_PERSIST = 1;
export const CONTACT_END     = 2;

// ============================================================================
// WGSL SHADERS
// ============================================================================

const TRIGGER_OVERLAP_SHADER = /* wgsl */`
// Test each trigger volume against all non-trigger bodies
// A trigger body has FLAG_TRIGGER (bit 24) set
// Output: trigger events (triggerBody, otherBody, overlap flag)

struct TriggerEvent {
    triggerBody: u32,
    otherBody: u32,
    eventType: u32,  // 0=enter, 1=stay (filled on CPU), 2=exit (filled on CPU)
    _pad: u32,
}

struct Params {
    bodyCount: u32,
    maxEvents: u32,
    _pad0: u32,
    _pad1: u32,
}

@group(0) @binding(0) var<storage, read> aabbMins: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> aabbMaxs: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> bodyFlags: array<u32>;
@group(0) @binding(3) var<storage, read_write> triggerEvents: array<TriggerEvent>;
@group(0) @binding(4) var<storage, read_write> triggerEventCount: atomic<u32>;
@group(0) @binding(5) var<uniform> params: Params;

fn aabbOverlap(minA: vec3<f32>, maxA: vec3<f32>, minB: vec3<f32>, maxB: vec3<f32>) -> bool {
    return minA.x <= maxB.x && maxA.x >= minB.x
        && minA.y <= maxB.y && maxA.y >= minB.y
        && minA.z <= maxB.z && maxA.z >= minB.z;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let id = gid.x;
    if (id >= params.bodyCount) { return; }

    let flags = bodyFlags[id];
    // Only process trigger bodies (bit 24)
    if ((flags & 0x1000000u) == 0u) { return; }
    // Skip sleeping
    if ((flags & 4u) != 0u) { return; }

    let triggerLayer = (flags >> 8u) & 0xFFu;
    let triggerMask = (flags >> 16u) & 0xFFu;

    let minA = aabbMins[id].xyz;
    let maxA = aabbMaxs[id].xyz;

    // Test against all non-trigger bodies
    for (var other = 0u; other < params.bodyCount; other++) {
        if (other == id) { continue; }

        let otherFlags = bodyFlags[other];
        // Skip other triggers
        if ((otherFlags & 0x1000000u) != 0u) { continue; }
        // Skip sleeping
        if ((otherFlags & 4u) != 0u) { continue; }

        // Layer/mask filtering
        let otherLayer = (otherFlags >> 8u) & 0xFFu;
        let otherMask = (otherFlags >> 16u) & 0xFFu;
        if ((triggerMask & otherLayer) == 0u || (otherMask & triggerLayer) == 0u) { continue; }

        let minB = aabbMins[other].xyz;
        let maxB = aabbMaxs[other].xyz;

        if (aabbOverlap(minA, maxA, minB, maxB)) {
            let idx = atomicAdd(&triggerEventCount, 1u);
            if (idx < params.maxEvents) {
                triggerEvents[idx] = TriggerEvent(id, other, 1u, 0u); // 1 = overlap detected (CPU resolves enter/stay/exit)
            }
        }
    }
}
`;

const CONTACT_EVENT_SHADER = /* wgsl */`
// Extract contact events from the narrowphase contact buffer
// Generates contact events for bodies that requested notification
// Bodies with contact notification: check FLAG bits (we use bit 25 for notify)

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

struct ContactEvent {
    bodyA: u32,
    bodyB: u32,
    normalX: f32, normalY: f32, normalZ: f32,
    penetration: f32,
    pointX: f32, pointY: f32, pointZ: f32,
    impulse: f32,
}

struct Params {
    contactCount: u32,
    maxEvents: u32,
    _pad0: u32,
    _pad1: u32,
}

@group(0) @binding(0) var<storage, read> contacts: array<Contact>;
@group(0) @binding(1) var<storage, read_write> contactEvents: array<ContactEvent>;
@group(0) @binding(2) var<storage, read_write> contactEventCount: atomic<u32>;
@group(0) @binding(3) var<uniform> params: Params;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let id = gid.x;
    if (id >= params.contactCount) { return; }

    let c = contacts[id];
    // Only emit events for contacts with significant impulse
    if (c.lambda < 0.01) { return; }

    let idx = atomicAdd(&contactEventCount, 1u);
    if (idx >= params.maxEvents) { return; }

    contactEvents[idx] = ContactEvent(
        c.bodyA, c.bodyB,
        c.normalX, c.normalY, c.normalZ,
        c.penetration,
        c.pointX, c.pointY, c.pointZ,
        c.lambda,
    );
}
`;

// ============================================================================
// TRIGGER & CONTACT EVENT SYSTEM
// ============================================================================

export class GPUTriggerSystem {
    constructor(device, options = {}) {
        this.device = device;
        this.maxTriggerEvents = options.maxTriggerEvents ?? MAX_TRIGGER_EVENTS;
        this.maxContactEvents = options.maxContactEvents ?? MAX_CONTACT_EVENTS;

        this._buffers = {};
        this._pipelines = {};
        this._bindGroups = {};
        this._paramsU32 = new Uint32Array(4);

        // CPU-side pair tracking for enter/stay/exit
        this._activeTriggerPairs = new Map(); // "triggerIdx:otherIdx" → frameCount
        this._activeContactPairs = new Map();

        // Event queues (consumed by user callbacks)
        this.triggerEvents = [];   // { type, triggerBody, otherBody, triggerEntityId, otherEntityId }
        this.contactEvents = [];   // { type, bodyA, bodyB, normal, point, penetration, impulse, entityA, entityB }

        // User callbacks
        this.onTriggerEnter = null;  // (event) => void
        this.onTriggerStay = null;
        this.onTriggerExit = null;
        this.onContactBegin = null;
        this.onContactPersist = null;
        this.onContactEnd = null;
    }

    async init(worldBuffers, broadphaseBuffers, narrowphaseBuffers) {
        this._createBuffers();
        await this._createPipelines(worldBuffers, broadphaseBuffers, narrowphaseBuffers);
        console.log(`[GPUTriggerSystem] Initialized — maxTrigger=${this.maxTriggerEvents}, maxContact=${this.maxContactEvents}`);
    }

    _createBuffers() {
        const d = this.device;
        const b = (label, size, usage) => d.createBuffer({ label, size, usage });
        const SUW = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;

        // Trigger events: 4 u32 per event
        this._buffers.triggerEvents = b('TS_TriggerEvents', this.maxTriggerEvents * 16, SUW);
        this._buffers.triggerEventCount = b('TS_TriggerCount', 4, SUW);
        this._buffers.triggerParams = b('TS_TriggerParams', 16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);

        // Contact events: 12 floats per event = 48 bytes
        this._buffers.contactEvents = b('TS_ContactEvents', this.maxContactEvents * 48, SUW);
        this._buffers.contactEventCount = b('TS_ContactCount', 4, SUW);
        this._buffers.contactParams = b('TS_ContactParams', 16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);

        // Readback
        this._buffers.triggerCountReadback = b('TS_TriggerCountRead', 4, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
        this._buffers.contactCountReadback = b('TS_ContactCountRead', 4, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
        this._buffers.triggerEventsReadback = b('TS_TriggerEventsRead', this.maxTriggerEvents * 16, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
        this._buffers.contactEventsReadback = b('TS_ContactEventsRead', this.maxContactEvents * 48, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
    }

    async _createPipelines(wb, bpb, npb) {
        const d = this.device;
        const mkModule = (label, code) => d.createShaderModule({ label, code });
        const mkPipeline = async (label, module) => d.createComputePipelineAsync({
            label, layout: 'auto', compute: { module, entryPoint: 'main' },
        });

        const triggerModule = mkModule('TS_TriggerOverlap', TRIGGER_OVERLAP_SHADER);
        const contactModule = mkModule('TS_ContactEvent', CONTACT_EVENT_SHADER);

        this._pipelines.triggerOverlap = await mkPipeline('TS_TriggerOverlap', triggerModule);
        this._pipelines.contactEvent = await mkPipeline('TS_ContactEvent', contactModule);

        this._rebuildBindGroups(wb, bpb, npb);
    }

    _rebuildBindGroups(wb, bpb, npb) {
        const d = this.device;
        const B = this._buffers;

        this._bindGroups.triggerOverlap = d.createBindGroup({
            label: 'TS_TriggerOverlap_BG',
            layout: this._pipelines.triggerOverlap.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: bpb.aabbMins } },
                { binding: 1, resource: { buffer: bpb.aabbMaxs } },
                { binding: 2, resource: { buffer: wb.bodyFlags } },
                { binding: 3, resource: { buffer: B.triggerEvents } },
                { binding: 4, resource: { buffer: B.triggerEventCount } },
                { binding: 5, resource: { buffer: B.triggerParams } },
            ],
        });

        this._bindGroups.contactEvent = d.createBindGroup({
            label: 'TS_ContactEvent_BG',
            layout: this._pipelines.contactEvent.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: npb.contacts } },
                { binding: 1, resource: { buffer: B.contactEvents } },
                { binding: 2, resource: { buffer: B.contactEventCount } },
                { binding: 3, resource: { buffer: B.contactParams } },
            ],
        });
    }

    /**
     * Dispatch trigger and contact event generation.
     * Call after broadphase (needs AABBs) and after narrowphase (needs contacts).
     */
    dispatch(encoder, bodyCount, contactCount) {
        const d = this.device;

        // Zero event counts
        const zero = new Uint32Array([0]);
        d.queue.writeBuffer(this._buffers.triggerEventCount, 0, zero);
        d.queue.writeBuffer(this._buffers.contactEventCount, 0, zero);

        // Trigger overlap test
        if (bodyCount > 0) {
            this._paramsU32[0] = bodyCount;
            this._paramsU32[1] = this.maxTriggerEvents;
            this._paramsU32[2] = 0;
            this._paramsU32[3] = 0;
            d.queue.writeBuffer(this._buffers.triggerParams, 0, this._paramsU32);

            const bodyWG = Math.ceil(bodyCount / 64);
            const trigPass = encoder.beginComputePass({ label: 'TS_TriggerOverlap' });
            trigPass.setPipeline(this._pipelines.triggerOverlap);
            trigPass.setBindGroup(0, this._bindGroups.triggerOverlap);
            trigPass.dispatchWorkgroups(bodyWG);
            trigPass.end();
        }

        // Contact event extraction
        if (contactCount > 0) {
            this._paramsU32[0] = contactCount;
            this._paramsU32[1] = this.maxContactEvents;
            this._paramsU32[2] = 0;
            this._paramsU32[3] = 0;
            d.queue.writeBuffer(this._buffers.contactParams, 0, this._paramsU32);

            const contactWG = Math.ceil(contactCount / 64);
            const conPass = encoder.beginComputePass({ label: 'TS_ContactEvent' });
            conPass.setPipeline(this._pipelines.contactEvent);
            conPass.setBindGroup(0, this._bindGroups.contactEvent);
            conPass.dispatchWorkgroups(contactWG);
            conPass.end();
        }

        // Copy counts + events for readback
        encoder.copyBufferToBuffer(this._buffers.triggerEventCount, 0, this._buffers.triggerCountReadback, 0, 4);
        encoder.copyBufferToBuffer(this._buffers.contactEventCount, 0, this._buffers.contactCountReadback, 0, 4);

        // Copy event data for readback (sized to maxEvents, actual count read separately)
        encoder.copyBufferToBuffer(this._buffers.triggerEvents, 0, this._buffers.triggerEventsReadback, 0, this.maxTriggerEvents * 16);
        encoder.copyBufferToBuffer(this._buffers.contactEvents, 0, this._buffers.contactEventsReadback, 0, this.maxContactEvents * 48);
    }

    /**
     * Async readback + event processing.
     * Resolves enter/stay/exit for triggers and begin/persist/end for contacts.
     * @param {GPURigidBodyWorld} world - For entity ID lookup
     */
    async processEvents(world) {
        this.triggerEvents = [];
        this.contactEvents = [];

        // ── Read trigger events ───────────────────────────────────────────

        let triggerCount = 0;
        try {
            await this._buffers.triggerCountReadback.mapAsync(GPUMapMode.READ);
            triggerCount = new Uint32Array(this._buffers.triggerCountReadback.getMappedRange().slice(0))[0];
            this._buffers.triggerCountReadback.unmap();
            triggerCount = Math.min(triggerCount, this.maxTriggerEvents);
        } catch (e) {
            console.warn('[GPUTriggerSystem] Trigger count readback failed:', e.message);
        }

        const currentTriggerPairs = new Set();

        if (triggerCount > 0) {
            try {
                await this._buffers.triggerEventsReadback.mapAsync(GPUMapMode.READ);
                const data = new Uint32Array(this._buffers.triggerEventsReadback.getMappedRange().slice(0));
                this._buffers.triggerEventsReadback.unmap();

                for (let i = 0; i < triggerCount; i++) {
                    const triggerBody = data[i * 4];
                    const otherBody = data[i * 4 + 1];
                    const key = `${triggerBody}:${otherBody}`;
                    currentTriggerPairs.add(key);

                    const triggerDesc = world?.bodyDescriptions[triggerBody];
                    const otherDesc = world?.bodyDescriptions[otherBody];

                    if (!this._activeTriggerPairs.has(key)) {
                        // ENTER
                        const event = {
                            type: TRIGGER_ENTER,
                            triggerBody, otherBody,
                            triggerEntityId: triggerDesc?.entityId ?? null,
                            otherEntityId: otherDesc?.entityId ?? null,
                        };
                        this.triggerEvents.push(event);
                        if (this.onTriggerEnter) this.onTriggerEnter(event);
                    } else {
                        // STAY
                        const event = {
                            type: TRIGGER_STAY,
                            triggerBody, otherBody,
                            triggerEntityId: triggerDesc?.entityId ?? null,
                            otherEntityId: otherDesc?.entityId ?? null,
                        };
                        this.triggerEvents.push(event);
                        if (this.onTriggerStay) this.onTriggerStay(event);
                    }
                }
            } catch (e) {
                console.warn('[GPUTriggerSystem] Trigger events readback failed:', e.message);
            }
        }

        // EXIT: pairs from last frame not in current frame
        for (const [key] of this._activeTriggerPairs) {
            if (!currentTriggerPairs.has(key)) {
                const [tb, ob] = key.split(':').map(Number);
                const triggerDesc = world?.bodyDescriptions[tb];
                const otherDesc = world?.bodyDescriptions[ob];
                const event = {
                    type: TRIGGER_EXIT,
                    triggerBody: tb, otherBody: ob,
                    triggerEntityId: triggerDesc?.entityId ?? null,
                    otherEntityId: otherDesc?.entityId ?? null,
                };
                this.triggerEvents.push(event);
                if (this.onTriggerExit) this.onTriggerExit(event);
            }
        }

        // Update tracking
        this._activeTriggerPairs.clear();
        for (const key of currentTriggerPairs) {
            this._activeTriggerPairs.set(key, 1);
        }

        // ── Read contact events ───────────────────────────────────────────

        let contactCount = 0;
        try {
            await this._buffers.contactCountReadback.mapAsync(GPUMapMode.READ);
            contactCount = new Uint32Array(this._buffers.contactCountReadback.getMappedRange().slice(0))[0];
            this._buffers.contactCountReadback.unmap();
            contactCount = Math.min(contactCount, this.maxContactEvents);
        } catch (e) {
            console.warn('[GPUTriggerSystem] Contact count readback failed:', e.message);
        }

        const currentContactPairs = new Set();

        if (contactCount > 0) {
            try {
                await this._buffers.contactEventsReadback.mapAsync(GPUMapMode.READ);
                const data = new Float32Array(this._buffers.contactEventsReadback.getMappedRange().slice(0));
                this._buffers.contactEventsReadback.unmap();
                const u32 = new Uint32Array(data.buffer);

                for (let i = 0; i < contactCount; i++) {
                    const base = i * 12;
                    const bodyA = u32[base];
                    const bodyB = u32[base + 1];
                    const key = `${Math.min(bodyA, bodyB)}:${Math.max(bodyA, bodyB)}`;
                    currentContactPairs.add(key);

                    const descA = world?.bodyDescriptions[bodyA];
                    const descB = world?.bodyDescriptions[bodyB];
                    const isNew = !this._activeContactPairs.has(key);

                    const event = {
                        type: isNew ? CONTACT_BEGIN : CONTACT_PERSIST,
                        bodyA, bodyB,
                        normal: [data[base + 2], data[base + 3], data[base + 4]],
                        penetration: data[base + 5],
                        point: [data[base + 6], data[base + 7], data[base + 8]],
                        impulse: data[base + 9],
                        entityA: descA?.entityId ?? null,
                        entityB: descB?.entityId ?? null,
                    };
                    this.contactEvents.push(event);

                    if (isNew) {
                        if (this.onContactBegin) this.onContactBegin(event);
                    } else {
                        if (this.onContactPersist) this.onContactPersist(event);
                    }
                }
            } catch (e) {
                console.warn('[GPUTriggerSystem] Contact events readback failed:', e.message);
            }
        }

        // END: contact pairs from last frame not in current frame
        for (const [key] of this._activeContactPairs) {
            if (!currentContactPairs.has(key)) {
                const [a, b] = key.split(':').map(Number);
                const descA = world?.bodyDescriptions[a];
                const descB = world?.bodyDescriptions[b];
                const event = {
                    type: CONTACT_END,
                    bodyA: a, bodyB: b,
                    normal: [0, 0, 0], penetration: 0,
                    point: [0, 0, 0], impulse: 0,
                    entityA: descA?.entityId ?? null,
                    entityB: descB?.entityId ?? null,
                };
                this.contactEvents.push(event);
                if (this.onContactEnd) this.onContactEnd(event);
            }
        }

        this._activeContactPairs.clear();
        for (const key of currentContactPairs) {
            this._activeContactPairs.set(key, 1);
        }
    }

    destroy() {
        for (const buf of Object.values(this._buffers)) {
            if (buf && typeof buf.destroy === 'function') buf.destroy();
        }
        this._buffers = {};
        this._activeTriggerPairs.clear();
        this._activeContactPairs.clear();
        this.triggerEvents = [];
        this.contactEvents = [];
    }
}

// ============================================================================
// FACTORY
// ============================================================================

export async function createTriggerSystem(device, worldBuffers, broadphaseBuffers, narrowphaseBuffers, options = {}) {
    const sys = new GPUTriggerSystem(device, options);
    await sys.init(worldBuffers, broadphaseBuffers, narrowphaseBuffers);
    return sys;
}

export function destroyTriggerSystem(sys) {
    if (sys) sys.destroy();
}
