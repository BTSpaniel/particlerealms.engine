// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * CollabOpQueue.js
 * Op ordering, deduplication, and per-peer sequence gap handling.
 * Each op: { id, peerId, seq, type, payload, ts }
 *
 * Current scope: bounded local ordering for admitted logical peer IDs. Sequence
 * epochs/wrap, retransmission/NACK, cryptographic sender binding, and captured
 * loss/reordering transport traces remain audit gaps.
 */

import { runtimeMonotonicClockStep } from '../core/math/FrameMath.js';
import { finiteNumberReport } from '../core/math/MathValidation.js';

const MAX_QUEUE_DEPTH = 200;
const GAP_TIMEOUT_MS = 500;
const MAX_SEEN_IDS = 5000;
const SEEN_PRUNE_COUNT = 1000;
const MAX_OP_SEQUENCE = Number.MAX_SAFE_INTEGER - 1;

function _validId(value) {
    return typeof value === 'string' && value.length > 0;
}

function _clockNow(queue, timestampMs = Date.now()) {
    const step = runtimeMonotonicClockStep(timestampMs, queue._clockMs);
    queue._clockMs = step.timestampMs;
    return step.timestampMs;
}

export function collabOpAdmissionReport(op) {
    const sequence = finiteNumberReport(op?.seq, {
        min: 0,
        max: MAX_OP_SEQUENCE,
        integer: true,
    });
    const idValid = _validId(op?.id);
    const peerIdValid = _validId(op?.peerId);
    return {
        valid: !!op && idValid && peerIdValid && sequence.valid,
        idValid,
        peerIdValid,
        sequence,
    };
}

export function createOpQueue() {
    const now = runtimeMonotonicClockStep(Date.now(), 0).timestampMs;
    return {
        seen: new Set(),           // dedup by op id
        perPeer: new Map(),        // peerId -> { nextSeq, held: [] }
        ready: [],                 // ops ready to apply in order
        _clockMs: now,
        _stats: {
            admitted: 0,
            rejected: 0,
            duplicateIds: 0,
            duplicateSequences: 0,
            gapFlushes: 0,
            capDrops: 0,
        },
    };
}

/**
 * Enqueue an incoming op. Returns array of ops ready to apply.
 */
export function enqueueOp(queue, op) {
    const admission = collabOpAdmissionReport(op);
    if (!admission.valid) {
        queue._stats.rejected++;
        return [];
    }
    const now = _clockNow(queue);

    // Dedup
    if (queue.seen.has(op.id)) {
        queue._stats.duplicateIds++;
        return [];
    }
    queue.seen.add(op.id);
    queue._stats.admitted++;

    // Keep seen set bounded
    if (queue.seen.size > MAX_SEEN_IDS) {
        const iter = queue.seen.values();
        for (let i = 0; i < SEEN_PRUNE_COUNT; i++) queue.seen.delete(iter.next().value);
    }

    let peerState = queue.perPeer.get(op.peerId);
    if (!peerState) {
        peerState = { nextSeq: op.seq, held: [], lastFlush: now };
        queue.perPeer.set(op.peerId, peerState);
    }

    // If seq matches what we expect, apply immediately
    if (op.seq === peerState.nextSeq) {
        peerState.nextSeq++;
        const ready = [op];

        // Drain any held ops that are now in order
        peerState.held.sort((a, b) => a.seq - b.seq);
        while (peerState.held.length > 0 && peerState.held[0].seq === peerState.nextSeq) {
            ready.push(peerState.held.shift());
            peerState.nextSeq++;
        }

        peerState.lastFlush = now;
        return ready;
    }

    // Future op — hold it
    if (op.seq > peerState.nextSeq) {
        if (peerState.held.some((heldOp) => heldOp.seq === op.seq)) {
            queue._stats.duplicateSequences++;
            return [];
        }
        peerState.held.push(op);

        // Retain the nearest future operations so a closing gap can drain.
        if (peerState.held.length > MAX_QUEUE_DEPTH) {
            peerState.held.sort((a, b) => a.seq - b.seq);
            const dropped = peerState.held.splice(MAX_QUEUE_DEPTH);
            queue._stats.capDrops += dropped.length;
            for (const droppedOp of dropped) queue.seen.delete(droppedOp.id);
        }

        // If gap has been open too long, flush everything we have
        if (runtimeMonotonicClockStep(now, peerState.lastFlush).elapsedMs > GAP_TIMEOUT_MS) {
            return _flushHeld(queue, peerState, now, true);
        }

        return [];
    }

    // Past op (already applied) — discard
    return [];
}

/**
 * Flush all held ops for a peer (called on timeout or peer leave).
 */
export function flushPeer(queue, peerId) {
    const peerState = queue.perPeer.get(peerId);
    if (!peerState) return [];
    return _flushHeld(queue, peerState, _clockNow(queue), false);
}

/**
 * Remove all state for a peer (on disconnect).
 */
export function removePeer(queue, peerId) {
    return queue.perPeer.delete(peerId);
}

/**
 * Tick — flush any peers with stale gaps.
 */
export function tickOpQueue(queue) {
    const ready = [];
    const now = _clockNow(queue);
    for (const peerState of queue.perPeer.values()) {
        if (peerState.held.length > 0 &&
            runtimeMonotonicClockStep(now, peerState.lastFlush).elapsedMs > GAP_TIMEOUT_MS) {
            ready.push(..._flushHeld(queue, peerState, now, true));
        }
    }
    return ready;
}

export function getOpQueueStats(queue) {
    const peers = [];
    for (const [peerId, s] of queue.perPeer) {
        peers.push({ peerId, nextSeq: s.nextSeq, held: s.held.length });
    }
    return { seenCount: queue.seen.size, peers, ...queue._stats };
}

export function clearOpQueue(queue) {
    queue.seen.clear();
    queue.perPeer.clear();
    queue.ready.length = 0;
    queue._clockMs = 0;
    for (const key of Object.keys(queue._stats)) queue._stats[key] = 0;
}

function _flushHeld(queue, peerState, now, gapTimeout) {
    peerState.held.sort((a, b) => a.seq - b.seq);
    const flushed = [...peerState.held];
    peerState.held = [];
    if (flushed.length > 0) {
        peerState.nextSeq = flushed[flushed.length - 1].seq + 1;
    }
    peerState.lastFlush = now;
    if (gapTimeout && flushed.length > 0) queue._stats.gapFlushes++;
    return flushed;
}
