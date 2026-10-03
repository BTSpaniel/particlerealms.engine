// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * CollabZoneHandoff.js
 * Smooth authority transfer protocol when entities cross spatial zone boundaries.
 *
 * Buffer zone (15% of zone radius):
 *   - Entity enters buffer → both peers simulate, current owner broadcasts state
 *   - Entity crosses buffer center → handoff op with full state snapshot
 *   - 500ms hysteresis prevents rapid back-and-forth
 *
 * Handoff op: { type: 'zone_handoff', payload: { entityId, fromPeer, toPeer, seq, state } }
 *   - state: { pos, rot, vel, angVel, pbdParticles? }
 *   - seq: authority sequence number (higher always wins, Gaffer-style)
 *
 * Assembly awareness: if entity A is constrained to entity B, both get
 * handed off together to the same peer.
 *
 * Fallback: if fromPeer disconnects mid-handoff, nearest remaining peer
 * takes ownership immediately.
 *
 * Inspired by: Roblox "buffer zone" (red outline), Star Citizen entity graph
 * authority transfers, Gaffer on Games ownership sequence numbers.
 */

import { runtimeMonotonicClockStep } from '../core/math/FrameMath.js';
import { finiteArrayReport, finiteNumberReport } from '../core/math/MathValidation.js';

// ── Constants ────────────────────────────────────────────────────────────────

const HANDOFF_BLEND_MS     = 200;  // smooth blend duration during handoff
const HANDOFF_HYSTERESIS_MS = 500; // entity must stay in new zone this long
const HANDOFF_STALE_MS     = 3000; // abandon pending handoff after this

function _advanceWallClock(handoff) {
    const clock = runtimeMonotonicClockStep(Date.now(), handoff._lastWallClockMs);
    handoff._lastWallClockMs = clock.timestampMs;
    return clock;
}

function _handoffSequenceReport(sequence) {
    return finiteNumberReport(sequence, {
        integer: true,
        min: 1,
        max: Number.MAX_SAFE_INTEGER,
    });
}

// ── State ────────────────────────────────────────────────────────────────────

/**
 * Create a zone handoff manager.
 * @returns {Object} handoff state
 */
export function createZoneHandoff() {
    return {
        // entityId -> { fromPeer, toPeer, startedAt, seq, committed }
        _pending: new Map(),
        // entityId -> { seq } — last committed handoff sequence per entity
        _seqMap: new Map(),
        // Global monotonic sequence counter
        _nextSeq: 0,
        // Accepted wall clock for hysteresis and stale windows
        _lastWallClockMs: 0,
        // Callbacks
        _onHandoffComplete: null, // (entityId, fromPeer, toPeer) => void
    };
}

// ── Initiate Handoff ─────────────────────────────────────────────────────────

/**
 * Start a pending handoff for an entity (called when spatial authority detects a zone change).
 * Does NOT commit yet — waits for hysteresis period.
 * @param {Object} handoff - handoff state
 * @param {string|number} entityId
 * @param {string} fromPeer
 * @param {string} toPeer
 * @returns {boolean} true if handoff was initiated (false if already pending for same pair)
 */
export function initiateHandoff(handoff, entityId, fromPeer, toPeer) {
    const existing = handoff._pending.get(entityId);
    if (existing && existing.fromPeer === fromPeer && existing.toPeer === toPeer) {
        return false; // already pending for this pair
    }

    const seq = handoff._nextSeq + 1;
    if (!_handoffSequenceReport(seq).valid) return false;
    handoff._nextSeq = seq;
    handoff._pending.set(entityId, {
        fromPeer,
        toPeer,
        startedAt: _advanceWallClock(handoff).timestampMs,
        seq,
        committed: false,
    });
    return true;
}

/**
 * Cancel a pending handoff (entity moved back to original zone).
 * @param {Object} handoff
 * @param {string|number} entityId
 */
export function cancelHandoff(handoff, entityId) {
    handoff._pending.delete(entityId);
}

// ── Build Handoff Op ─────────────────────────────────────────────────────────

/**
 * Build a zone_handoff op with full entity state for network transmission.
 * Called by the outgoing peer when handoff commits.
 * @param {string|number} entityId
 * @param {string} fromPeer
 * @param {string} toPeer
 * @param {number} seq
 * @param {Object} entityState - { pos:[x,y,z], rot:[x,y,z,w], vel:[x,y,z], angVel:[x,y,z], pbdParticles?:Float32Array }
 * @returns {Object} op to broadcast
 */
export function buildHandoffOp(entityId, fromPeer, toPeer, seq, entityState) {
    return {
        type: 'zone_handoff',
        payload: {
            entityId,
            fromPeer,
            toPeer,
            seq,
            state: entityState,
        },
    };
}

/**
 * Capture entity state for the handoff snapshot.
 * @param {Object} ecsWorld
 * @param {Function} getEntityComponent
 * @param {string|number} entityId
 * @param {Map} [physicsSimulations] - for PBD particle state
 * @returns {Object} entityState
 */
export function captureEntityState(ecsWorld, getEntityComponent, entityId, physicsSimulations) {
    const state = { pos: null, rot: null, vel: null, angVel: null };

    const t = getEntityComponent(ecsWorld, entityId, 'Transform');
    if (t?.position) {
        state.pos = [t.position[0], t.position[1], t.position[2]];
    }
    if (t?.rotation) {
        state.rot = [t.rotation[0], t.rotation[1], t.rotation[2], t.rotation[3]];
    }

    const pb = getEntityComponent(ecsWorld, entityId, 'PhysicsBody');
    if (pb?.linearVelocity) {
        state.vel = [pb.linearVelocity[0], pb.linearVelocity[1], pb.linearVelocity[2]];
    }
    if (pb?.angularVelocity) {
        state.angVel = [pb.angularVelocity[0], pb.angularVelocity[1], pb.angularVelocity[2]];
    }

    // PBD particle state (ropes, cloth)
    if (physicsSimulations) {
        const sim = physicsSimulations.get(entityId);
        if (sim) {
            const particles = sim.particles || sim.solver?.particles;
            if (particles && particles.length > 0) {
                const count = particles.length;
                const positions = new Array(count * 3);
                for (let i = 0; i < count; i++) {
                    const p = particles[i];
                    positions[i * 3]     = p.x;
                    positions[i * 3 + 1] = p.y;
                    positions[i * 3 + 2] = p.z;
                }
                state.pbdParticles = positions;
                state.pbdCount = count;
            }
        }
    }

    return state;
}

// ── Receive Handoff ──────────────────────────────────────────────────────────

/**
 * Handle an incoming zone_handoff op from a remote peer.
 * Applies the state snapshot if the sequence number is higher than our last.
 * @param {Object} handoff
 * @param {Object} op - { type: 'zone_handoff', payload: { entityId, fromPeer, toPeer, seq, state } }
 * @param {string} selfId - this peer's ID
 * @param {Object} ecsWorld
 * @param {Function} setEntityComponent
 * @param {Function} getEntityComponent
 * @param {Map} [physicsSimulations]
 * @returns {boolean} true if handoff was accepted
 */
export function onRemoteHandoffOp(handoff, op, selfId, ecsWorld, setEntityComponent, getEntityComponent, physicsSimulations) {
    if (!op?.payload || op.type !== 'zone_handoff') return false;

    const { entityId, fromPeer, toPeer, seq, state } = op.payload;
    const sequence = _handoffSequenceReport(seq);
    if (!sequence.valid) return false;

    // Sequence check: reject stale handoffs
    const lastSeq = handoff._seqMap.get(entityId);
    if (lastSeq != null && seq <= lastSeq) return false;

    // Accept the handoff
    handoff._seqMap.set(entityId, seq);
    handoff._nextSeq = Math.max(handoff._nextSeq, seq);
    handoff._pending.delete(entityId);

    // Apply state snapshot if we're the receiving peer
    if (toPeer === selfId && state) {
        _applyHandoffState(ecsWorld, setEntityComponent, getEntityComponent, entityId, state, physicsSimulations);
    }

    if (handoff._onHandoffComplete) {
        handoff._onHandoffComplete(entityId, fromPeer, toPeer);
    }

    return true;
}

function _applyHandoffState(ecsWorld, setEntityComponent, getEntityComponent, entityId, state, physicsSimulations) {
    // Apply transform
    const position = finiteArrayReport(state.pos, { expectedLength: 3 });
    if (position.valid) {
        const t = getEntityComponent(ecsWorld, entityId, 'Transform');
        if (t) {
            t.position[0] = state.pos[0];
            t.position[1] = state.pos[1];
            t.position[2] = state.pos[2];
            const rotation = finiteArrayReport(state.rot, { expectedLength: 4 });
            if (rotation.valid && t.rotation) {
                t.rotation[0] = state.rot[0];
                t.rotation[1] = state.rot[1];
                t.rotation[2] = state.rot[2];
                t.rotation[3] = state.rot[3];
            }
        }
    }

    // Apply rigid-body velocity so the receiving simulation resumes continuously.
    const pb = getEntityComponent(ecsWorld, entityId, 'PhysicsBody');
    const velocity = finiteArrayReport(state.vel, { expectedLength: 3 });
    if (pb?.linearVelocity && velocity.valid) {
        pb.linearVelocity[0] = state.vel[0];
        pb.linearVelocity[1] = state.vel[1];
        pb.linearVelocity[2] = state.vel[2];
    }
    const angularVelocity = finiteArrayReport(state.angVel, { expectedLength: 3 });
    if (pb?.angularVelocity && angularVelocity.valid) {
        pb.angularVelocity[0] = state.angVel[0];
        pb.angularVelocity[1] = state.angVel[1];
        pb.angularVelocity[2] = state.angVel[2];
    }

    // Apply PBD particle state
    if (state.pbdParticles && physicsSimulations) {
        const sim = physicsSimulations.get(entityId);
        if (sim) {
            const particles = sim.particles || sim.solver?.particles;
            if (particles) {
                const countReport = finiteNumberReport(state.pbdCount, {
                    integer: true,
                    min: 0,
                    max: particles.length,
                });
                const count = countReport.valid ? state.pbdCount : 0;
                const positions = finiteArrayReport(state.pbdParticles, { expectedLength: count * 3 });
                if (!positions.valid) return;
                for (let i = 0; i < count; i++) {
                    const p = particles[i];
                    const tx = state.pbdParticles[i * 3];
                    const ty = state.pbdParticles[i * 3 + 1];
                    const tz = state.pbdParticles[i * 3 + 2];
                    p.x = tx; p.y = ty; p.z = tz;
                    if (p.px !== undefined) { p.px = tx; p.py = ty; p.pz = tz; }
                    if (p.vx !== undefined) { p.vx = 0; p.vy = 0; p.vz = 0; }
                }
                // Clear remote authority so new owner's solver takes over
                sim._remoteAuthority = false;
            }
        }
    }
}

// ── Tick / Commit ────────────────────────────────────────────────────────────

/**
 * Tick pending handoffs. Commits any that have passed the hysteresis period.
 * Prunes stale pending handoffs.
 * @param {Object} handoff
 * @param {string} selfId - this peer's ID
 * @returns {Array<{ entityId, fromPeer, toPeer, seq }>} handoffs ready to commit
 */
export function tickZoneHandoff(handoff, selfId) {
    const now = _advanceWallClock(handoff).timestampMs;
    const readyToCommit = [];

    for (const [entityId, pending] of handoff._pending) {
        const ageMs = runtimeMonotonicClockStep(now, pending.startedAt).elapsedMs;
        // Prune stale
        if (ageMs > HANDOFF_STALE_MS) {
            handoff._pending.delete(entityId);
            continue;
        }

        // Check hysteresis
        if (!pending.committed && ageMs >= HANDOFF_HYSTERESIS_MS) {
            // Only the outgoing peer (fromPeer) broadcasts the handoff op
            if (pending.fromPeer === selfId) {
                readyToCommit.push({
                    entityId,
                    fromPeer: pending.fromPeer,
                    toPeer: pending.toPeer,
                    seq: pending.seq,
                });
            }
            pending.committed = true;
            handoff._seqMap.set(entityId, pending.seq);
        }
    }

    // Clean up committed handoffs
    for (const [entityId, pending] of handoff._pending) {
        if (pending.committed) handoff._pending.delete(entityId);
    }

    return readyToCommit;
}

// ── Peer Disconnect ──────────────────────────────────────────────────────────

/**
 * Handle peer disconnect: cancel pending handoffs involving this peer
 * and reassign any entities that were mid-handoff.
 * @param {Object} handoff
 * @param {string} peerId - disconnected peer
 * @returns {Array<string|number>} entity IDs that need re-assignment
 */
export function onHandoffPeerDisconnect(handoff, peerId) {
    const needReassign = [];
    for (const [entityId, pending] of handoff._pending) {
        if (pending.fromPeer === peerId || pending.toPeer === peerId) {
            handoff._pending.delete(entityId);
            needReassign.push(entityId);
        }
    }
    return needReassign;
}

// ── Callbacks ────────────────────────────────────────────────────────────────

/**
 * Set callback for handoff completion.
 */
export function onHandoffComplete(handoff, callback) {
    handoff._onHandoffComplete = callback;
}

// ── Cleanup ──────────────────────────────────────────────────────────────────

/**
 * Destroy handoff state.
 */
export function destroyZoneHandoff(handoff) {
    handoff._pending.clear();
    handoff._seqMap.clear();
    handoff._nextSeq = 0;
    handoff._lastWallClockMs = 0;
    handoff._onHandoffComplete = null;
}
