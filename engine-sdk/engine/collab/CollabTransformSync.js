// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * CollabTransformSync.js
 * Broadcasts entity transform updates during play mode so grabbed/moved
 * objects are visible on all peer screens in real time.
 *
 * Authority model:
 *   - The peer who presses Play becomes the physics authority.
 *   - Authority broadcasts ALL entity transforms at ~10Hz.
 *   - Non-authority peers receive and apply transforms, skipping local physics.
 *   - Grabbed entity transforms are always sent at ~15Hz by anyone.
 */

import {
    runtimeFrameDeltaSeconds,
    runtimeMonotonicClockStep,
} from '../core/math/FrameMath.js';
import {
    adaptiveJitterBufferReport,
    adaptiveJitterEstimateUpdate,
} from '../core/math/JitterMath.js';
import { clamp } from '../core/math/MathScalar.js';

const FULL_SYNC_INTERVAL_MS = 100; // ~10Hz for full scene transforms
const GRAB_SYNC_INTERVAL_MS = 66;  // ~15Hz for grabbed entities
const PBD_SYNC_INTERVAL_MS  = 33;  // ~30Hz for PBD particle sync (ropes, cloth, etc.)
const PBD_MAX_PARTICLES_PER_OP = 200; // cap particles per op to avoid giant packets
const INTERP_MAX_FRAMES = 8;        // max keyframes per entity buffer

// Adaptive jitter buffer constants (inspired by Source Engine / Gaffer on Games)
const INTERP_MIN_DELAY_MS    = 16;   // floor: one frame at 60fps — never render ahead of data
const INTERP_MAX_DELAY_MS    = 150;  // ceiling: worst-case bad network
const INTERP_DEFAULT_DELAY   = 33;   // starting guess (~2 frames) until we have measurements
const INTERP_JITTER_SAMPLES  = 20;   // sliding window size for jitter calculation
const INTERP_RECOVER_RATE    = 0.3;  // ms per frame to slowly reduce delay when conditions are good
const INTERP_SPIKE_FACTOR    = 1.0;  // immediately jump delay up on late arrival (full spike)
const INTERP_NUKE_DIST_SQ    = 1.0;  // 1m² — entity moved >1m in one packet = "nuke" candidate
const INTERP_NUKE_RATIO      = 0.6;  // >60% of entities moved >1m = snap everything (nuke)
const INTERP_EXTRAPOLATE_MS  = 150;  // extrapolate on packet loss before freezing

/**
 * Create a transform sync state object.
 */
export function createTransformSync() {
    return {
        _lastFullBroadcastMs: 0,
        _lastGrabBroadcastMs: 0,
        _lastPbdBroadcastMs: 0,
        _trackedEntities: new Set(), // entityIds being actively manipulated locally
        _remoteGrabs: new Map(),     // key -> { peerId, entityId, ts }
        isPlayAuthority: false,      // true if this peer is the physics authority
        // Interpolation buffer: entityId -> { frames: [{ts, p, r, v}], lastApplied: {p, r} }
        _interpBuffer: new Map(),
        _interpBaseTime: 0,          // performance.now() when first frame arrived
        // Delta compression: track last sent position per entity to skip unchanged ones
        _lastSentPos: new Map(),     // entityId -> [x, y, z]
        // Adaptive jitter buffer state
        _jitter: {
            arrivalTimes: [],        // last N packet arrival timestamps (ms)
            intervals: [],           // last N inter-packet intervals (ms)
            currentDelay: INTERP_DEFAULT_DELAY,
            avgInterval: 100,        // EMA of packet interval
            jitterEstimate: 5,       // EMA of jitter (abs deviation from avg)
            lastArrival: 0,
            lastRenderTime: 0,
            stableFrames: 0,         // consecutive frames where buffer had enough data
        },
    };
}

/**
 * Mark an entity as being actively grabbed/dragged by the local user.
 */
export function trackLocalGrab(syncState, entityId) {
    syncState._trackedEntities.add(entityId);
}

/**
 * Unmark an entity when released.
 */
export function untrackLocalGrab(syncState, entityId) {
    syncState._trackedEntities.delete(entityId);
}

/**
 * Build a play_transforms op for grabbed entities only.
 * Returns null if nothing to broadcast or if throttled.
 */
export function buildPlayTransformOp(syncState, ecsWorld, getEntityComponent) {
    if (syncState._trackedEntities.size === 0) return null;

    const clock = runtimeMonotonicClockStep(performance.now(), syncState._lastGrabBroadcastMs);
    if (clock.elapsedMs < GRAB_SYNC_INTERVAL_MS) return null;
    syncState._lastGrabBroadcastMs = clock.timestampMs;

    const transforms = [];
    for (const entityId of syncState._trackedEntities) {
        const t = getEntityComponent(ecsWorld, entityId, 'Transform');
        if (!t) continue;
        const pb = getEntityComponent(ecsWorld, entityId, 'PhysicsBody');
        transforms.push(_packTransform(entityId, t, pb, ecsWorld));
    }

    if (transforms.length === 0) return null;
    return { type: 'play_transforms', payload: { transforms, grab: true } };
}

/**
 * Build a play_transforms op for ALL scene entities.
 * Only called by the physics authority at ~10Hz.
 * @param {Object} syncState
 * @param {Object} ecsWorld
 * @param {Function} getEntityComponent
 * @param {Map} sceneEntities - editor.scene.entities map
 * @param {Object} [entityAuthority] - CollabEntityAuthority state for per-entity ownership
 * @param {Set} [spatialAuthoritySet] - If provided, only broadcast entities in this set (spatial zone filter)
 * @returns {{ type: string, payload: Object }|null}
 */
export function buildFullPlayTransformOp(syncState, ecsWorld, getEntityComponent, sceneEntities, entityAuthority, spatialAuthoritySet) {
    if (!syncState.isPlayAuthority) return null;
    if (!sceneEntities || sceneEntities.size === 0) return null;

    // Adaptive sync rate: faster when fewer entities, since delta compression
    // means only changed entities are sent anyway. Keeps sync tight for small scenes.
    // ≤5 entities → ~30Hz (33ms), ≤20 → ~20Hz (50ms), ≤50 → ~10Hz (100ms),
    // ≤100 → ~5Hz (200ms), >100 → ~2.5Hz (400ms)
    const entityCount = sceneEntities.size;
    const adaptiveInterval = entityCount > 100 ? 400 :
                              entityCount > 50 ? 100 :
                              entityCount > 20 ? 50 :
                              entityCount > 5 ? 33 : 33;

    const clock = runtimeMonotonicClockStep(performance.now(), syncState._lastFullBroadcastMs);
    if (clock.elapsedMs < adaptiveInterval) return null;
    syncState._lastFullBroadcastMs = clock.timestampMs;

    // Build set of entities owned by remote peers (via formal authority system).
    // Owned entities are authoritative on the owning peer — we must not broadcast
    // our transforms for them, or it creates a tug-of-war overwrite loop.
    // Falls back to legacy _remoteGrabs if no authority state provided.
    let remoteOwnedIds = null;
    if (entityAuthority) {
        remoteOwnedIds = new Set();
        const selfId = entityAuthority.selfId;
        for (const [eid, claim] of entityAuthority._claims) {
            if (claim.ownerId !== selfId) remoteOwnedIds.add(eid);
        }
    } else {
        // Legacy fallback: ad-hoc _remoteGrabs with stale pruning
        remoteOwnedIds = new Set();
        const GRAB_STALE_MS = 2000;
        const nowGrab = Date.now();
        for (const [key, entry] of syncState._remoteGrabs) {
            const staleMs = runtimeFrameDeltaSeconds(nowGrab, entry.ts, Infinity) * 1000;
            if (staleMs > GRAB_STALE_MS) {
                syncState._remoteGrabs.delete(key);
            } else {
                remoteOwnedIds.add(entry.entityId);
            }
        }
    }

    const transforms = [];
    for (const [entityId] of sceneEntities) {
        // Spatial zone filter: skip entities outside our authority zone
        if (spatialAuthoritySet && !spatialAuthoritySet.has(entityId)) continue;
        // Per-entity ownership: skip entities owned by a remote peer
        if (remoteOwnedIds.has(entityId)) continue;

        const t = getEntityComponent(ecsWorld, entityId, 'Transform');
        if (!t || !t.position) continue;

        // Delta compression: skip entities that haven't moved (>0.5mm threshold)
        const lastPos = syncState._lastSentPos.get(entityId);
        if (lastPos) {
            const dx = t.position[0] - lastPos[0];
            const dy = t.position[1] - lastPos[1];
            const dz = t.position[2] - lastPos[2];
            if (dx * dx + dy * dy + dz * dz < 0.0000005) continue; // < 0.5mm
        }

        const pb = getEntityComponent(ecsWorld, entityId, 'PhysicsBody');
        const packed = _packTransform(entityId, t, pb, ecsWorld);
        transforms.push(packed);
        // Update last-sent cache
        syncState._lastSentPos.set(entityId, [t.position[0], t.position[1], t.position[2]]);
    }

    if (transforms.length === 0) return null;
    return { type: 'play_transforms', payload: { transforms, full: true } };
}

function _packTransform(entityId, t, physBody, ecsWorld) {
    const packed = {
        id: entityId,
        p: [
            Math.round(t.position[0] * 1000) / 1000,
            Math.round(t.position[1] * 1000) / 1000,
            Math.round(t.position[2] * 1000) / 1000,
        ],
        r: t.rotation ? [
            Math.round(t.rotation[0] * 10000) / 10000,
            Math.round(t.rotation[1] * 10000) / 10000,
            Math.round(t.rotation[2] * 10000) / 10000,
            Math.round(t.rotation[3] * 10000) / 10000,
        ] : [0, 0, 0, 1],
    };
    // Include velocity for hermite interpolation prediction
    if (physBody && ecsWorld?.physicsWorld) {
        const body = ecsWorld.physicsWorld.bodies?.get(physBody.bodyHandle);
        if (body && body.linearVelocity) {
            packed.v = [
                Math.round(body.linearVelocity[0] * 100) / 100,
                Math.round(body.linearVelocity[1] * 100) / 100,
                Math.round(body.linearVelocity[2] * 100) / 100,
            ];
        }
    }
    return packed;
}

// ─── PBD Simulation State Sync ────────────────────────────────────────────────

/**
 * Build a play_pbd_state op that snapshots PBD particle positions.
 * Any peer running physics simulations broadcasts at ~30Hz for real-time rope sync.
 * Only includes sims with >0 particles. Full float precision for smooth visual sync.
 *
 * @param {Object} syncState
 * @param {Map} physicsSimulations - editor.physicsSimulations
 * @param {Set} [spatialAuthoritySet] - If provided, only broadcast sims for entities in this set (spatial zone filter)
 * @returns {{ type: string, payload: Object }|null}
 */
export function buildPbdStateOp(syncState, physicsSimulations, spatialAuthoritySet) {
    if (!physicsSimulations || physicsSimulations.size === 0) return null;

    const clock = runtimeMonotonicClockStep(performance.now(), syncState._lastPbdBroadcastMs);
    if (clock.elapsedMs < PBD_SYNC_INTERVAL_MS) return null;
    syncState._lastPbdBroadcastMs = clock.timestampMs;

    const sims = [];
    for (const [entityId, sim] of physicsSimulations) {
        // Spatial zone filter: skip sims for entities outside our authority zone
        if (spatialAuthoritySet && !spatialAuthoritySet.has(entityId)) continue;
        const particles = sim.particles || sim.solver?.particles;
        if (!particles || particles.length === 0) continue;

        // Cap per-entity to avoid giant packets
        const count = Math.min(particles.length, PBD_MAX_PARTICLES_PER_OP);
        const positions = new Array(count * 3);
        for (let i = 0; i < count; i++) {
            const p = particles[i];
            positions[i * 3]     = p.x;
            positions[i * 3 + 1] = p.y;
            positions[i * 3 + 2] = p.z;
        }
        sims.push({ id: entityId, type: sim.type, n: count, p: positions });
    }

    if (sims.length === 0) return null;
    return { type: 'play_pbd_state', payload: { sims } };
}

/**
 * Apply incoming PBD particle state from the authority (host).
 * Non-authority clients do NOT run their own PBD solver for these sims —
 * they just apply the received positions directly.
 *
 * Tags each sim with `_remoteAuthority = true` so stepPhysicsSimulations
 * skips the local solver for it (prevents local physics from fighting
 * the authoritative positions).
 *
 * @param {Object} op
 * @param {Map} physicsSimulations - editor.physicsSimulations
 */
export function applyRemotePbdState(op, physicsSimulations) {
    if (!op?.payload?.sims || !physicsSimulations) return;

    for (const entry of op.payload.sims) {
        const sim = physicsSimulations.get(entry.id);
        if (!sim) continue;

        // Mark this sim as remotely controlled — local solver must skip it
        sim._remoteAuthority = true;

        const particles = sim.particles || sim.solver?.particles;
        if (!particles) continue;

        const count = Math.min(entry.n, particles.length);
        const positions = entry.p;

        for (let i = 0; i < count; i++) {
            const p = particles[i];
            const tx = positions[i * 3];
            const ty = positions[i * 3 + 1];
            const tz = positions[i * 3 + 2];

            // Direct snap — no blend needed since the local solver is disabled
            p.x = tx; p.y = ty; p.z = tz;
            // Sync previous position so Verlet doesn't generate phantom velocity
            if (p.px !== undefined) { p.px = tx; p.py = ty; p.pz = tz; }
            // Zero velocity
            if (p.vx !== undefined) { p.vx = 0; p.vy = 0; p.vz = 0; }
        }
    }
}

/**
 * Apply incoming play_transforms from a remote peer.
 * Pushes transforms into the interpolation buffer, measures jitter for adaptive delay,
 * and detects "nuke" events (massive state changes) for instant snap.
 */
export function applyRemotePlayTransforms(op, peerId, ecsWorld, getEntityComponent, setEntityComponent, syncState) {
    if (!op?.payload?.transforms) return;

    const jitter = syncState._jitter;
    const transforms = op.payload.transforms;
    const arrivalClock = runtimeMonotonicClockStep(performance.now(), jitter.lastArrival);
    const now = arrivalClock.timestampMs;
    if (syncState._interpBaseTime === 0) syncState._interpBaseTime = now;

    // ── Adaptive jitter measurement ──────────────────────────────────────────
    if (jitter.lastArrival > 0 && arrivalClock.elapsedMs > 0) {
        jitter.intervals.push(arrivalClock.elapsedMs);
        if (jitter.intervals.length > INTERP_JITTER_SAMPLES) jitter.intervals.shift();
        // EMA of interval and jitter deviation
        const alpha = 0.15;
        const estimate = adaptiveJitterEstimateUpdate({
            avgIntervalMs: jitter.avgInterval,
            jitterMs: jitter.jitterEstimate,
        }, arrivalClock.elapsedMs, { alpha, jitterAlpha: alpha });
        jitter.avgInterval = estimate.avgIntervalMs;
        jitter.jitterEstimate = estimate.jitterMs;
        const delay = adaptiveJitterBufferReport({
            avgIntervalMs: jitter.avgInterval,
            jitterMs: jitter.jitterEstimate,
            jitterMultiplier: 2,
            minDelayMs: INTERP_MIN_DELAY_MS,
            maxDelayMs: INTERP_MAX_DELAY_MS,
            currentDelayMs: jitter.currentDelay,
            spikeFactor: INTERP_SPIKE_FACTOR,
        });
        if (delay.adjustment === 'expand') {
            // Late packet — jump delay up immediately (Gaffer on Games pattern)
            jitter.currentDelay = delay.adjustedDelayMs;
            jitter.stableFrames = 0;
        }
    }
    jitter.lastArrival = now;
    jitter.arrivalTimes.push(now);
    if (jitter.arrivalTimes.length > INTERP_JITTER_SAMPLES) jitter.arrivalTimes.shift();

    // ── Nuke detection ───────────────────────────────────────────────────────
    let nukeCount = 0;
    const total = transforms.length;
    if (total > 2) {
        for (const entry of transforms) {
            const buf = syncState._interpBuffer.get(entry.id);
            if (buf && buf.lastApplied) {
                const lp = buf.lastApplied.p;
                const dx = entry.p[0] - lp[0], dy = entry.p[1] - lp[1], dz = entry.p[2] - lp[2];
                if (dx * dx + dy * dy + dz * dz > INTERP_NUKE_DIST_SQ) nukeCount++;
            }
        }
    }
    const isNuke = total > 2 && (nukeCount / total) > INTERP_NUKE_RATIO;

    // ── Buffer incoming transforms ───────────────────────────────────────────
    const isGrab = !!op.payload.grab;
    for (const entry of transforms) {
        const entityId = entry.id;

        // Authority (host) receiving grab transforms from a remote peer:
        // Apply directly to ECS + PhysX so physics reacts to client-dragged entities.
        // Non-authority peers buffer for interpolation as usual.
        // This is the bidirectional ownership flow from Gaffer on Games.
        if (isGrab && syncState.isPlayAuthority && setEntityComponent) {
            const existing = getEntityComponent(ecsWorld, entityId, 'Transform');
            if (existing) {
                existing.position[0] = entry.p[0];
                existing.position[1] = entry.p[1];
                existing.position[2] = entry.p[2];
                if (entry.r) {
                    existing.rotation[0] = entry.r[0];
                    existing.rotation[1] = entry.r[1];
                    existing.rotation[2] = entry.r[2];
                    existing.rotation[3] = entry.r[3];
                }
                // Sync to PhysX body so physics world reacts (collisions, ropes, etc.)
                const physBody = getEntityComponent(ecsWorld, entityId, 'PhysicsBody');
                if (physBody && ecsWorld.physicsWorld) {
                    const body = ecsWorld.physicsWorld.bodies?.get(physBody.bodyHandle);
                    if (body) {
                        body.position[0] = entry.p[0];
                        body.position[1] = entry.p[1];
                        body.position[2] = entry.p[2];
                        if (entry.r) {
                            body.rotation[0] = entry.r[0];
                            body.rotation[1] = entry.r[1];
                            body.rotation[2] = entry.r[2];
                            body.rotation[3] = entry.r[3];
                        }
                        body._needsSync = true;
                    }
                }
            }
            syncState._remoteGrabs.set(peerId + ':' + entityId, { peerId, entityId, ts: Date.now() });
            continue; // Don't buffer on authority — applied immediately
        }

        let buf = syncState._interpBuffer.get(entityId);
        if (!buf) {
            buf = { frames: [], lastApplied: null };
            syncState._interpBuffer.set(entityId, buf);
        }
        if (isNuke) {
            // Nuke: wipe buffer, snap to this position immediately
            buf.frames.length = 0;
            buf.frames.push({ ts: now, p: entry.p, r: entry.r || [0, 0, 0, 1], v: entry.v || null });
            buf.lastApplied = { p: entry.p, r: entry.r || [0, 0, 0, 1] };
        } else {
            buf.frames.push({ ts: now, p: entry.p, r: entry.r || [0, 0, 0, 1], v: entry.v || null });
            if (buf.frames.length > INTERP_MAX_FRAMES) buf.frames.shift();
        }
        if (isGrab) {
            syncState._remoteGrabs.set(peerId + ':' + entityId, { peerId, entityId, ts: Date.now() });
        }
    }

    if (isNuke) {
        jitter.currentDelay = INTERP_MIN_DELAY_MS;
        jitter.stableFrames = 0;
    }
}

/**
 * Interpolate buffered remote transforms and write to ECS + physics.
 * Called every render frame by non-authority peers.
 *
 * Uses adaptive render delay that auto-adjusts based on measured packet jitter.
 * On LAN/good connections: as low as ~20ms. On jittery links: up to 150ms.
 * Slowly tightens delay when stable; instantly widens on late arrivals.
 */
export function interpolateRemoteEntities(syncState, ecsWorld, getEntityComponent, localDragEntityId, entityAuthority) {
    if (!syncState || syncState._interpBuffer.size === 0) return;

    const jitter = syncState._jitter;
    const renderClock = runtimeMonotonicClockStep(performance.now(), jitter.lastRenderTime);
    const now = renderClock.timestampMs;
    jitter.lastRenderTime = now;

    // ── Adaptive delay recovery (per frame) ──────────────────────────────────
    const recovery = adaptiveJitterBufferReport({
        avgIntervalMs: jitter.avgInterval,
        jitterMs: jitter.jitterEstimate,
        jitterMultiplier: 1,
        minDelayMs: INTERP_MIN_DELAY_MS,
        maxDelayMs: INTERP_MAX_DELAY_MS,
        currentDelayMs: jitter.currentDelay,
        stableFrames: jitter.stableFrames + 1,
        recoverAfterFrames: 11,
        recoverRateMs: INTERP_RECOVER_RATE,
        spikeFactor: INTERP_SPIKE_FACTOR,
    });
    if (jitter.currentDelay > recovery.targetDelayMs) {
        jitter.stableFrames++;
        jitter.currentDelay = recovery.adjustedDelayMs;
    }

    // Pre-compute locally owned entity set (if authority system is active)
    let localOwnedSet = null;
    if (entityAuthority) {
        localOwnedSet = new Set();
        for (const [eid, claim] of entityAuthority._claims) {
            if (claim.ownerId === entityAuthority.selfId) localOwnedSet.add(eid);
        }
    }

    const renderTime = now - jitter.currentDelay;

    for (const [entityId, buf] of syncState._interpBuffer) {
        const frames = buf.frames;
        if (frames.length === 0) continue;

        // Per-entity ownership: skip entities we locally own (formal authority system).
        // Our local simulation is authoritative — remote transforms must not overwrite.
        if (localOwnedSet && localOwnedSet.has(entityId)) continue;
        // Legacy fallback: skip entities in _trackedEntities (grab tracking)
        if (syncState._trackedEntities.has(entityId)) continue;
        // Direct failsafe: also skip the entity currently being elastic-dragged.
        if (localDragEntityId != null && entityId === localDragEntityId) continue;

        const existing = getEntityComponent(ecsWorld, entityId, 'Transform');
        if (!existing) continue;

        let resultP, resultR;

        if (frames.length === 1) {
            resultP = frames[0].p;
            resultR = frames[0].r;
        } else {
            // Find two bracketing frames around renderTime
            let f0 = null, f1 = null;
            for (let i = 0; i < frames.length - 1; i++) {
                if (frames[i].ts <= renderTime && frames[i + 1].ts >= renderTime) {
                    f0 = frames[i];
                    f1 = frames[i + 1];
                    break;
                }
            }

            if (f0 && f1) {
                const segmentDurationSec = runtimeFrameDeltaSeconds(f1.ts, f0.ts, Infinity);
                const elapsedSec = runtimeFrameDeltaSeconds(renderTime, f0.ts, Infinity);
                const t = segmentDurationSec > 0 ? clamp(elapsedSec / segmentDurationSec, 0, 1) : 1;
                resultP = _lerpVec3(f0.p, f1.p, t);
                resultR = _slerpQuat(f0.r, f1.r, t);
            } else if (renderTime > frames[frames.length - 1].ts) {
                // Past latest: extrapolate with velocity or hold
                const last = frames[frames.length - 1];
                const extrapolationSec = runtimeFrameDeltaSeconds(renderTime, last.ts, Infinity);
                if (extrapolationSec < INTERP_EXTRAPOLATE_MS / 1000 && last.v) {
                    resultP = [
                        last.p[0] + last.v[0] * extrapolationSec,
                        last.p[1] + last.v[1] * extrapolationSec,
                        last.p[2] + last.v[2] * extrapolationSec,
                    ];
                } else {
                    resultP = last.p;
                }
                resultR = last.r;
            } else {
                resultP = frames[0].p;
                resultR = frames[0].r;
            }

            // Prune consumed frames (keep at least 2)
            while (frames.length > 2 && frames[1].ts < renderTime) {
                frames.shift();
            }
        }

        // Write to ECS Transform
        existing.position[0] = resultP[0];
        existing.position[1] = resultP[1];
        existing.position[2] = resultP[2];
        if (resultR) {
            existing.rotation[0] = resultR[0];
            existing.rotation[1] = resultR[1];
            existing.rotation[2] = resultR[2];
            existing.rotation[3] = resultR[3];
        }

        // Sync physics body
        const physBody = getEntityComponent(ecsWorld, entityId, 'PhysicsBody');
        if (physBody && ecsWorld.physicsWorld) {
            const body = ecsWorld.physicsWorld.bodies?.get(physBody.bodyHandle);
            if (body) {
                body.position[0] = resultP[0];
                body.position[1] = resultP[1];
                body.position[2] = resultP[2];
                if (resultR) {
                    body.rotation[0] = resultR[0];
                    body.rotation[1] = resultR[1];
                    body.rotation[2] = resultR[2];
                    body.rotation[3] = resultR[3];
                }
                body._needsSync = true;
            }
        }

        buf.lastApplied = { p: resultP, r: resultR };
    }
}

/**
 * Get the current adaptive interpolation delay (ms) for diagnostics.
 */
export function getInterpDelay(syncState) {
    return syncState?._jitter?.currentDelay ?? INTERP_DEFAULT_DELAY;
}

// ─── Math helpers ─────────────────────────────────────────────────────────────

function _lerpVec3(a, b, t) {
    return [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
    ];
}

function _slerpQuat(a, b, t) {
    let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
    // Ensure shortest path
    const bSign = dot < 0 ? -1 : 1;
    if (dot < 0) dot = -dot;
    // If very close, use linear interpolation to avoid division by zero
    if (dot > 0.9995) {
        return _normalizeQuat([
            a[0] + (b[0] * bSign - a[0]) * t,
            a[1] + (b[1] * bSign - a[1]) * t,
            a[2] + (b[2] * bSign - a[2]) * t,
            a[3] + (b[3] * bSign - a[3]) * t,
        ]);
    }
    const theta = Math.acos(dot);
    const sinTheta = Math.sin(theta);
    const w0 = Math.sin((1 - t) * theta) / sinTheta;
    const w1 = Math.sin(t * theta) / sinTheta * bSign;
    return _normalizeQuat([
        a[0] * w0 + b[0] * w1,
        a[1] * w0 + b[1] * w1,
        a[2] * w0 + b[2] * w1,
        a[3] * w0 + b[3] * w1,
    ]);
}

function _normalizeQuat(q) {
    const len = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]);
    if (len < 1e-10) return [0, 0, 0, 1];
    return [q[0] / len, q[1] / len, q[2] / len, q[3] / len];
}

/**
 * Get set of entity IDs currently being grabbed by remote peers.
 * Returns Map<entityId, peerColor> for glow rendering.
 * @param {Object} syncState
 * @param {Object} presenceState - CollabPresence state for peer colors
 * @returns {Map<number, string>}
 */
export function getRemoteGrabGlows(syncState, presenceState) {
    const glows = new Map(); // entityId -> color hex
    const now = Date.now();
    const staleMs = 500; // fade after 500ms of no updates

    for (const [key, grab] of syncState._remoteGrabs) {
        const grabAgeMs = runtimeFrameDeltaSeconds(now, grab.ts, Infinity) * 1000;
        if (grabAgeMs > staleMs) {
            syncState._remoteGrabs.delete(key);
            continue;
        }
        const peer = presenceState.peers.get(grab.peerId);
        if (peer) {
            glows.set(grab.entityId, peer.color || '#6b8afd');
        }
    }
    return glows;
}

/**
 * Destroy / reset transform sync state.
 */
export function destroyTransformSync(syncState) {
    syncState._trackedEntities.clear();
    syncState._remoteGrabs.clear();
    syncState._interpBuffer.clear();
    syncState._interpBaseTime = 0;
    syncState._lastSentPos.clear();
    syncState._lastFullBroadcastMs = 0;
    syncState._lastGrabBroadcastMs = 0;
    syncState._lastPbdBroadcastMs = 0;
    syncState.isPlayAuthority = false;
    // Reset adaptive jitter buffer
    const j = syncState._jitter;
    j.arrivalTimes.length = 0;
    j.intervals.length = 0;
    j.currentDelay = INTERP_DEFAULT_DELAY;
    j.avgInterval = 100;
    j.jitterEstimate = 5;
    j.lastArrival = 0;
    j.lastRenderTime = 0;
    j.stableFrames = 0;
}
