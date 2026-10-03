// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * CollabMessageRouter.js
 * Priority-based message orchestration for collab sync.
 *
 * Sits between EditorCollab and CollabCore, providing:
 *   - 4 priority lanes (critical → ephemeral)
 *   - Bandwidth monitoring via channel.bufferedAmount
 *   - Transform coalescing (latest position wins per entity)
 *   - Adaptive rate control under backpressure
 *
 * Priority lanes:
 *   0 — Critical:  play_sync, __kick__, snapshot         → immediate, never throttled
 *   1 — Realtime:  play transforms/PBD/grab force        → coalesced or rate-budgeted
 *   2 — Scene:     create, delete, transform, property…  → ordered, rate-budgeted
 *   3 — Ephemeral: sim_heartbeat                          → latest-only, droppable
 */

import { runtimeMonotonicClockStep } from '../core/math/FrameMath.js';
import { clamp } from '../core/math/MathScalar.js';
import { finiteArrayReport, finiteNumberReport } from '../core/math/MathValidation.js';
import { queueDepthReport, rateRampReport } from '../core/math/QueueMath.js';
import { encode as msgpackEncode } from './CollabCodec.js';

const PRIORITY_CRITICAL  = 0;
const PRIORITY_REALTIME  = 1;
const PRIORITY_SCENE     = 2;
const PRIORITY_EPHEMERAL = 3;

const BACKPRESSURE_THRESHOLD = 65536;  // 64KB — defer priority ≥ 2 when above
const BACKPRESSURE_HIGH      = 131072; // 128KB — defer priority ≥ 1
const FLUSH_INTERVAL_MS      = 16;     // ~60Hz flush cadence
const RATE_RECOVER_FRAMES    = 180;    // frames of low pressure before restoring rate
const BACKOFF_AFTER_MS        = FLUSH_INTERVAL_MS * 4;
const RATE_RECOVER_AFTER_MS   = FLUSH_INTERVAL_MS * RATE_RECOVER_FRAMES;
const MAX_REALTIME_QUEUE      = 256;
const MAX_SCENE_QUEUE         = 2048;
const MAX_COALESCED_TRANSFORMS = 2048;
const MAX_OP_TYPE_LENGTH      = 128;

// Priority map follows Unreal Engine's actor replication model:
//   CRITICAL  (0) = Gameplay-affecting state changes — never dropped, never delayed
//   REALTIME  (1) = Movement / transforms — coalesced under backpressure
//   SCENE     (2) = Edit-mode ops — deferred when bandwidth is tight
//   EPHEMERAL (3) = Corrections & heartbeats — droppable under backpressure
const OP_PRIORITY = new Map(Object.entries({
    // Critical: game state (must arrive, ordered)
    play_sync:        PRIORITY_CRITICAL,
    __kick__:         PRIORITY_CRITICAL,
    snapshot:         PRIORITY_CRITICAL,
    entity_authority: PRIORITY_CRITICAL,
    zone_handoff:     PRIORITY_CRITICAL,
    camera_sync:      PRIORITY_CRITICAL,
    // Realtime: entity motion (coalesced per-entity, high frequency)
    play_transforms:  PRIORITY_REALTIME,
    play_grab_force:  PRIORITY_REALTIME,
    // Ephemeral: correction data (safe to drop — clients self-correct)
    sim_heartbeat:    PRIORITY_EPHEMERAL,
    play_pbd_state:   PRIORITY_REALTIME,
}));

// Scene ops default to PRIORITY_SCENE

/**
 * Create a message router instance.
 * @param {Function} sendFn - (op) => void — raw send to CollabCore.broadcastOp
 * @param {Function} getBufferedAmount - () => number — returns max bufferedAmount across peers
 */
export function createMessageRouter(sendFn, getBufferedAmount) {
    return {
        _sendFn: typeof sendFn === 'function' ? sendFn : (() => {}),
        _getBufferedAmount: typeof getBufferedAmount === 'function' ? getBufferedAmount : (() => 0),
        _queues: [[], [], [], []], // one queue per priority
        _coalesceMap: new Map(),   // entityId → latest normalized transform entry
        _transformMeta: { full: false },
        _flushTimer: null,
        _destroyed: false,
        _clockMs: 0,
        _pressureElapsedMs: 0,
        _recoveryElapsedMs: 0,
        _lastBufferedAmount: 0,
        _stats: {
            sent: 0,
            dropped: 0,
            rejected: 0,
            coalesced: 0,
            bytesSent: 0,
            backpressureFrames: 0,
            pressureFlushes: 0,
            sendErrors: 0,
        },
        _rateMultiplier: 1.0,     // 1.0 = full rate, 0.5 = half, etc.
        _lowPressureFrames: 0,
    };
}

/**
 * Enqueue an op for prioritized delivery.
 */
export function routerEnqueue(router, op) {
    if (!router || router._destroyed) return false;
    const report = messageRouterOpReport(op);
    if (!report.valid) {
        router._stats.rejected++;
        return false;
    }
    const admittedOp = report.value;

    const priority = OP_PRIORITY.get(admittedOp.type) ?? PRIORITY_SCENE;

    // Critical: send immediately, bypass queue
    if (priority === PRIORITY_CRITICAL) {
        return _send(router, admittedOp);
    }

    // Realtime (transforms): coalesce per entity
    if (priority === PRIORITY_REALTIME && admittedOp.type === 'play_transforms') {
        return _coalesceTransforms(router, admittedOp);
    }

    if (priority === PRIORITY_REALTIME) {
        const queue = router._queues[PRIORITY_REALTIME];
        if (queue.length >= MAX_REALTIME_QUEUE) return _rejectCapacity(router);
        queue.push(admittedOp);
        return true;
    }

    // Ephemeral: latest-only (replace previous of same type)
    if (priority === PRIORITY_EPHEMERAL) {
        const queue = router._queues[PRIORITY_EPHEMERAL];
        // Replace existing op of same type
        const idx = queue.findIndex(q => q.type === admittedOp.type);
        if (idx >= 0) {
            queue[idx] = admittedOp;
            router._stats.coalesced++;
        } else {
            queue.push(admittedOp);
        }
        return true;
    }

    // Scene: ordered queue
    const sceneQueue = router._queues[PRIORITY_SCENE];
    if (sceneQueue.length >= MAX_SCENE_QUEUE) return _rejectCapacity(router);
    sceneQueue.push(admittedOp);
    return true;
}

export function messageRouterOpReport(op) {
    if (!op || typeof op !== 'object' || Array.isArray(op)) {
        return { valid: false, reason: 'not-object', value: null };
    }
    const type = typeof op.type === 'string' ? op.type.trim() : '';
    if (!type || type.length > MAX_OP_TYPE_LENGTH) {
        return { valid: false, reason: 'invalid-type', value: null };
    }
    if (type === 'play_transforms') {
        const transforms = op.payload?.transforms;
        if (!Array.isArray(transforms) || transforms.length === 0) {
            return { valid: false, reason: 'invalid-transforms', value: null };
        }
        const normalized = [];
        const ids = new Set();
        for (const transform of transforms) {
            const id = transform?.id;
            const validId = (typeof id === 'string' && id.length > 0 && id.length <= 256)
                || (Number.isSafeInteger(id) && id >= 0);
            const position = finiteArrayReport(transform?.p, { expectedLength: 3 });
            const rotation = finiteArrayReport(transform?.r, { expectedLength: 4 });
            const velocity = transform?.v == null
                ? { valid: true }
                : finiteArrayReport(transform.v, { expectedLength: 3 });
            if (!validId || ids.has(id) || !position.valid || !rotation.valid || !velocity.valid) {
                return { valid: false, reason: 'invalid-transform', value: null };
            }
            ids.add(id);
            normalized.push({
                id,
                p: Array.from(transform.p),
                r: Array.from(transform.r),
                v: transform.v == null ? null : Array.from(transform.v),
            });
        }
        return {
            valid: true,
            reason: 'valid',
            value: {
                ...op,
                type,
                payload: { ...op.payload, transforms: normalized },
            },
        };
    }
    return { valid: true, reason: 'valid', value: type === op.type ? op : { ...op, type } };
}

export function messageRouterBufferedAmountReport(value) {
    const report = finiteNumberReport(value, { min: 0, max: Number.MAX_SAFE_INTEGER });
    return report.valid
        ? { valid: true, reason: 'valid', bufferedAmount: report.value }
        : { valid: false, reason: 'invalid-buffered-amount', bufferedAmount: BACKPRESSURE_HIGH };
}

/**
 * Flush all queued ops respecting priority and backpressure.
 * Call once per render frame from the render loop.
 */
export function routerFlush(router) {
    if (!router || router._destroyed) return false;
    const clock = _clockStep(router);
    let rawBuffered;
    try {
        rawBuffered = router._getBufferedAmount();
    } catch (_) {
        rawBuffered = Number.NaN;
    }
    const bufferedReport = messageRouterBufferedAmountReport(rawBuffered);
    const buffered = bufferedReport.bufferedAmount;
    router._lastBufferedAmount = buffered;
    if (!bufferedReport.valid) router._stats.rejected++;
    const depth = queueDepthReport({ queuedBytes: buffered, capacityBytes: BACKPRESSURE_HIGH });

    // Track backpressure for adaptive rate
    if (buffered > BACKPRESSURE_THRESHOLD) {
        router._stats.backpressureFrames++;
        router._stats.pressureFlushes++;
        router._lowPressureFrames = 0;
        router._pressureElapsedMs += clock.elapsedMs;
        router._recoveryElapsedMs = 0;
    } else {
        router._lowPressureFrames++;
        router._pressureElapsedMs = 0;
        router._recoveryElapsedMs += clock.elapsedMs;
        if (router._recoveryElapsedMs > RATE_RECOVER_AFTER_MS) {
            router._rateMultiplier = rateRampReport({
                currentRateBps: router._rateMultiplier,
                targetRateBps: 1,
                elapsedMs: FLUSH_INTERVAL_MS,
                rampUpRateBpsPerSecond: 6.25,
            }).nextRateBps;
        }
    }

    // Adaptive rate reduction under sustained backpressure
    if (router._pressureElapsedMs >= BACKOFF_AFTER_MS) {
        router._rateMultiplier = clamp(router._rateMultiplier * 0.8, 0.25, 1);
        router._stats.backpressureFrames = 0;
        router._pressureElapsedMs = 0;
    }

    // Priority 1 — Realtime (transforms): flush coalesced batch
    if (buffered < BACKPRESSURE_HIGH) {
        _flushRealtimeQueue(router);
    }

    // Priority 2 — Scene ops: flush if bandwidth allows
    if (buffered < BACKPRESSURE_THRESHOLD) {
        _flushSceneQueue(router);
    }

    // Priority 3 — Ephemeral: flush or drop
    if (buffered < BACKPRESSURE_THRESHOLD) {
        _flushEphemeralQueue(router);
    } else {
        // Under pressure: drop ephemeral
        const dropped = router._queues[PRIORITY_EPHEMERAL].length;
        router._stats.dropped += dropped;
        router._queues[PRIORITY_EPHEMERAL].length = 0;
    }
    return {
        bufferedAmount: buffered,
        pressureRatio: depth.byteOccupancyRatio,
        rateMultiplier: router._rateMultiplier,
    };
}

/**
 * Start automatic flush timer (call once on init).
 */
export function routerStart(router) {
    if (!router || router._destroyed) return false;
    routerStop(router);
    router._flushTimer = setInterval(() => routerFlush(router), FLUSH_INTERVAL_MS);
    return true;
}

/**
 * Stop the automatic flush timer.
 */
export function routerStop(router) {
    if (router?._flushTimer != null) {
        clearInterval(router._flushTimer);
        router._flushTimer = null;
    }
}

/**
 * Get router statistics.
 */
export function getRouterStats(router) {
    if (!router) return null;
    return {
        ...router._stats,
        rateMultiplier: router._rateMultiplier,
        lastBufferedAmount: router._lastBufferedAmount,
        realtimeQueued: router._queues[PRIORITY_REALTIME].length + router._coalesceMap.size,
        sceneQueued: router._queues[PRIORITY_SCENE].length,
        ephemeralQueued: router._queues[PRIORITY_EPHEMERAL].length,
        bytesSentMeasurement: 'msgpack-operation-bytes',
    };
}

/**
 * Reset router state (on disconnect/reconnect).
 */
export function resetRouter(router) {
    if (!router || router._destroyed) return false;
    for (const q of router._queues) q.length = 0;
    router._coalesceMap.clear();
    router._transformMeta.full = false;
    for (const key of Object.keys(router._stats)) router._stats[key] = 0;
    router._lowPressureFrames = 0;
    router._rateMultiplier = 1.0;
    router._clockMs = 0;
    router._pressureElapsedMs = 0;
    router._recoveryElapsedMs = 0;
    router._lastBufferedAmount = 0;
    return true;
}

/**
 * Destroy router.
 */
export function destroyRouter(router) {
    if (!router || router._destroyed) return;
    routerStop(router);
    resetRouter(router);
    router._destroyed = true;
    router._sendFn = () => {};
    router._getBufferedAmount = () => BACKPRESSURE_HIGH;
}

// ─── Private ─────────────────────────────────────────────────────────────────

/**
 * Coalesce play_transforms: merge incoming transforms into a single
 * pending batch, keeping only the latest position per entity.
 */
function _coalesceTransforms(router, op) {
    const isGrab = !!op.payload.grab;
    const isFull = !!op.payload.full;

    for (const t of op.payload.transforms) {
        const key = t.id;
        if (router._coalesceMap.has(key)) {
            // Update existing entry with latest data
            const existing = router._coalesceMap.get(key);
            existing.p = t.p;
            existing.r = t.r;
            if (t.v) existing.v = t.v;
            existing.grab = existing.grab || isGrab;
            router._stats.coalesced++;
        } else {
            if (router._coalesceMap.size >= MAX_COALESCED_TRANSFORMS) {
                router._stats.dropped++;
                continue;
            }
            const entry = { id: t.id, p: t.p, r: t.r, v: t.v || null, grab: isGrab };
            router._coalesceMap.set(key, entry);
        }
    }

    router._transformMeta.full = router._transformMeta.full || isFull;
    return true;
}

function _flushRealtimeQueue(router) {
    const queue = router._queues[PRIORITY_REALTIME];
    if (router._coalesceMap.size === 0 && queue.length === 0) return;

    // Build coalesced transform array
    const transforms = [];
    let hasGrab = false;
    let hasFull = false;

    const transformBudget = Math.max(1, Math.ceil(router._coalesceMap.size * router._rateMultiplier));
    for (const [key, entry] of router._coalesceMap) {
        if (transforms.length >= transformBudget) break;
        const t = { id: entry.id, p: entry.p, r: entry.r };
        if (entry.v) t.v = entry.v;
        transforms.push(t);
        if (entry.grab) hasGrab = true;
        router._coalesceMap.delete(key);
    }

    hasFull = router._transformMeta.full;

    // Send as a single coalesced op
    if (transforms.length > 0) {
        const payload = { transforms };
        if (hasFull) payload.full = true;
        if (hasGrab) payload.grab = true;
        _send(router, { type: 'play_transforms', payload });
    }

    if (router._coalesceMap.size === 0) router._transformMeta.full = false;
    const opBudget = Math.max(1, Math.ceil(queue.length * router._rateMultiplier));
    const ready = queue.splice(0, opBudget);
    for (const op of ready) _send(router, op);
}

function _flushSceneQueue(router) {
    const queue = router._queues[PRIORITY_SCENE];
    if (queue.length === 0) return;

    // Send scene ops individually (they need ordered, reliable delivery)
    const budget = Math.max(1, Math.ceil(queue.length * router._rateMultiplier));
    const ready = queue.splice(0, budget);
    for (const op of ready) _send(router, op);
}

function _flushEphemeralQueue(router) {
    const queue = router._queues[PRIORITY_EPHEMERAL];
    if (queue.length === 0) return;

    for (const op of queue) {
        _send(router, op);
    }
    queue.length = 0;
}

function _send(router, op) {
    try {
        const encodedBytes = msgpackEncode(op).byteLength;
        router._sendFn(op);
        router._stats.sent++;
        router._stats.bytesSent += encodedBytes;
        return true;
    } catch (_) {
        router._stats.sendErrors++;
        router._stats.dropped++;
        return false;
    }
}

function _rejectCapacity(router) {
    router._stats.dropped++;
    return false;
}

function _clockStep(router) {
    const previous = router._clockMs;
    const step = runtimeMonotonicClockStep(Date.now(), previous);
    router._clockMs = step.timestampMs;
    return { timestampMs: step.timestampMs, elapsedMs: previous > 0 ? step.elapsedMs : 0 };
}

// Audit gaps: queue pressure is aggregate across peers rather than per-channel,
// reliable scene overflow has no retransmission/spill store, byte totals exclude
// transport envelopes/fan-out/encryption/SCTP overhead, and captured congestion
// traces across WebRTC plus BroadcastChannel transports remain absent.
