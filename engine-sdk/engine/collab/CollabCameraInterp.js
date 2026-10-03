// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * CollabCameraInterp.js
 * Hermite-spline camera interpolation for smooth remote peer camera rendering.
 *
 * Based on Glenn Fiedler's "Snapshot Interpolation" (Gaffer on Games, GDC 2015):
 *   - Buffer camera snapshots and render slightly behind real-time
 *   - Use cubic Hermite splines (position + velocity at each sample) for C1 continuity
 *   - Adaptive jitter compensation adjusts the playback delay automatically
 *
 * Hermite basis:
 *   H(t) = (2t³ - 3t² + 1)·p0  +  (t³ - 2t² + t)·v0·Δt
 *        + (-2t³ + 3t²)·p1      +  (t³ - t²)·v1·Δt
 *
 * This guarantees the curve passes through p0 and p1 with matching velocities,
 * eliminating the 1st-order discontinuity artifacts that linear interpolation causes.
 */

import { runtimeFrameDeltaSeconds } from '../core/math/FrameMath.js';
import {
    adaptiveJitterBufferReport,
    adaptiveJitterEstimateUpdate,
} from '../core/math/JitterMath.js';
import { clamp } from '../core/math/MathScalar.js';

// ── Configuration ─────────────────────────────────────────────────────────────

const MIN_BUFFER_DELAY_MS   = 40;    // minimum playback delay behind real-time
const MAX_BUFFER_DELAY_MS   = 200;   // maximum playback delay
const JITTER_ALPHA          = 0.1;   // EMA smoothing for jitter estimation
const INTERVAL_ALPHA        = 0.1;   // EMA smoothing for arrival interval
const MAX_SNAPSHOTS         = 8;     // ring buffer size per peer
const STALE_PEER_MS         = 3000;  // remove peer buffer after 3s of no data
const SNAP_DIST_THRESHOLD   = 50;    // teleport (snap) if delta > 50 units

// ── Hermite interpolation ─────────────────────────────────────────────────────

function hermite(t, p0, v0, p1, v1, dt) {
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    return h00 * p0 + h10 * v0 * dt + h01 * p1 + h11 * v1 * dt;
}

// ── Per-peer interpolation state ──────────────────────────────────────────────

/**
 * Create the global camera interpolation state.
 * Attach to editor.collab or pass around explicitly.
 */
export function createCameraInterpState() {
    return {
        peers: new Map(),   // peerId → PeerCameraBuffer
        _stats: {
            activePeers: 0,
            avgDelay: 0,
            avgJitter: 0,
            snapshotsReceived: 0,
            interpolations: 0,
        },
    };
}

function _createPeerBuffer() {
    return {
        snapshots: [],       // [{ ts, pos, target, vel, targetVel }] — oldest first
        lastArrivalMs: 0,
        avgIntervalMs: 66,   // initial guess: ~15Hz
        jitterMs: 10,        // initial jitter estimate
        currentDelay: 60,    // current playback delay behind newest snapshot
        lastInterpPos: null,   // [x,y,z] — last interpolated position (for extrapolation)
        lastInterpTarget: null,
    };
}

// ── Push new snapshot ─────────────────────────────────────────────────────────

/**
 * Push a camera_sync snapshot into the interpolation buffer.
 * Call this from the camera_sync op handler instead of snapping peer.camera directly.
 *
 * @param {Object} state     - from createCameraInterpState()
 * @param {string} peerId
 * @param {number[]} pos     - [x,y,z] camera position (full precision)
 * @param {number[]} target  - [x,y,z] camera look-at target
 * @param {number[]} vel     - [vx,vy,vz] camera velocity (units/sec)
 * @param {number[]} targetVel - [vx,vy,vz] target velocity
 * @param {number}   remoteTs - performance.now() timestamp from sender
 */
export function pushCameraSnapshot(state, peerId, pos, target, vel, targetVel, remoteTs) {
    let buf = state.peers.get(peerId);
    if (!buf) {
        buf = _createPeerBuffer();
        state.peers.set(peerId, buf);
    }

    const now = performance.now();
    const arrivalDeltaMs = runtimeFrameDeltaSeconds(now, buf.lastArrivalMs, Infinity) * 1000;
    const acceptedArrivalMs = buf.lastArrivalMs > 0
        ? buf.lastArrivalMs + arrivalDeltaMs
        : (Number.isFinite(now) && now >= 0 ? now : 0);

    // Jitter tracking: measure interval between arrivals
    if (buf.lastArrivalMs > 0 && arrivalDeltaMs > 0) {
        const estimate = adaptiveJitterEstimateUpdate({
            avgIntervalMs: buf.avgIntervalMs,
            jitterMs: buf.jitterMs,
        }, arrivalDeltaMs, { alpha: INTERVAL_ALPHA, jitterAlpha: JITTER_ALPHA });
        buf.avgIntervalMs = estimate.avgIntervalMs;
        buf.jitterMs = estimate.jitterMs;
    }
    buf.lastArrivalMs = acceptedArrivalMs;

    // Adaptive delay: enough to usually have 2 snapshots buffered
    const delay = adaptiveJitterBufferReport({
        avgIntervalMs: buf.avgIntervalMs,
        jitterMs: buf.jitterMs,
        jitterMultiplier: 2,
        minDelayMs: MIN_BUFFER_DELAY_MS,
        maxDelayMs: MAX_BUFFER_DELAY_MS,
    });
    buf.currentDelay = delay.targetDelayMs;

    // Push snapshot (use local arrival time as authoritative timeline)
    buf.snapshots.push({
        ts: acceptedArrivalMs,
        pos: [pos[0], pos[1], pos[2]],
        target: [target[0], target[1], target[2]],
        vel: vel ? [vel[0], vel[1], vel[2]] : [0, 0, 0],
        targetVel: targetVel ? [targetVel[0], targetVel[1], targetVel[2]] : [0, 0, 0],
    });

    // Trim ring buffer
    while (buf.snapshots.length > MAX_SNAPSHOTS) buf.snapshots.shift();

    state._stats.snapshotsReceived++;
}

// ── Interpolate ───────────────────────────────────────────────────────────────

/**
 * Get the smoothly interpolated camera position for a remote peer.
 * Call this every render frame from CollabOverlayRenderer.
 *
 * @param {Object} state  - from createCameraInterpState()
 * @param {string} peerId
 * @returns {{ pos: number[], target: number[] } | null}
 */
export function getInterpolatedCamera(state, peerId) {
    const buf = state.peers.get(peerId);
    if (!buf || buf.snapshots.length === 0) return null;

    const now = performance.now();
    const renderTime = now - buf.currentDelay;

    const snaps = buf.snapshots;

    // Find the two snapshots bracketing renderTime
    let s0 = null, s1 = null;
    for (let i = 0; i < snaps.length - 1; i++) {
        if (snaps[i].ts <= renderTime && snaps[i + 1].ts >= renderTime) {
            s0 = snaps[i];
            s1 = snaps[i + 1];
            break;
        }
    }

    // If renderTime is before all snapshots, use earliest
    if (!s0 && snaps.length > 0 && renderTime < snaps[0].ts) {
        const s = snaps[0];
        buf.lastInterpPos = s.pos;
        buf.lastInterpTarget = s.target;
        return { pos: s.pos, target: s.target };
    }

    // If renderTime is past all snapshots, extrapolate from last using velocity
    if (!s0 && snaps.length > 0) {
        const last = snaps[snaps.length - 1];
        const extrapolationSec = runtimeFrameDeltaSeconds(renderTime, last.ts, 0.2);
        const pos = [
            last.pos[0] + last.vel[0] * extrapolationSec,
            last.pos[1] + last.vel[1] * extrapolationSec,
            last.pos[2] + last.vel[2] * extrapolationSec,
        ];
        const tgt = [
            last.target[0] + last.targetVel[0] * extrapolationSec,
            last.target[1] + last.targetVel[1] * extrapolationSec,
            last.target[2] + last.targetVel[2] * extrapolationSec,
        ];
        buf.lastInterpPos = pos;
        buf.lastInterpTarget = tgt;
        return { pos, target: tgt };
    }

    if (!s0 || !s1) return buf.lastInterpPos ? { pos: buf.lastInterpPos, target: buf.lastInterpTarget } : null;

    // Check for teleport (large gap → snap instead of interpolate)
    const dx = s1.pos[0] - s0.pos[0];
    const dy = s1.pos[1] - s0.pos[1];
    const dz = s1.pos[2] - s0.pos[2];
    if (dx * dx + dy * dy + dz * dz > SNAP_DIST_THRESHOLD * SNAP_DIST_THRESHOLD) {
        buf.lastInterpPos = s1.pos;
        buf.lastInterpTarget = s1.target;
        return { pos: s1.pos, target: s1.target };
    }

    // ── Hermite interpolation ─────────────────────────────────────────────
    const segmentDurationSec = runtimeFrameDeltaSeconds(s1.ts, s0.ts, Infinity);
    if (segmentDurationSec <= 0) {
        buf.lastInterpPos = s1.pos;
        buf.lastInterpTarget = s1.target;
        return { pos: s1.pos, target: s1.target };
    }

    const elapsedSec = runtimeFrameDeltaSeconds(renderTime, s0.ts, Infinity);
    const t = clamp(elapsedSec / segmentDurationSec, 0, 1);

    const pos = [
        hermite(t, s0.pos[0], s0.vel[0], s1.pos[0], s1.vel[0], segmentDurationSec),
        hermite(t, s0.pos[1], s0.vel[1], s1.pos[1], s1.vel[1], segmentDurationSec),
        hermite(t, s0.pos[2], s0.vel[2], s1.pos[2], s1.vel[2], segmentDurationSec),
    ];
    const tgt = [
        hermite(t, s0.target[0], s0.targetVel[0], s1.target[0], s1.targetVel[0], segmentDurationSec),
        hermite(t, s0.target[1], s0.targetVel[1], s1.target[1], s1.targetVel[1], segmentDurationSec),
        hermite(t, s0.target[2], s0.targetVel[2], s1.target[2], s1.targetVel[2], segmentDurationSec),
    ];

    buf.lastInterpPos = pos;
    buf.lastInterpTarget = tgt;
    state._stats.interpolations++;

    return { pos, target: tgt };
}

// ── Maintenance ───────────────────────────────────────────────────────────────

/**
 * Remove stale peer buffers. Call periodically (~1Hz).
 */
export function pruneStaleInterpBuffers(state) {
    const now = performance.now();
    for (const [peerId, buf] of state.peers) {
        const staleMs = runtimeFrameDeltaSeconds(now, buf.lastArrivalMs, Infinity) * 1000;
        if (staleMs > STALE_PEER_MS) {
            state.peers.delete(peerId);
        }
    }
    // Update stats
    state._stats.activePeers = state.peers.size;
    let totalDelay = 0, totalJitter = 0;
    for (const buf of state.peers.values()) {
        totalDelay += buf.currentDelay;
        totalJitter += buf.jitterMs;
    }
    if (state.peers.size > 0) {
        state._stats.avgDelay = totalDelay / state.peers.size;
        state._stats.avgJitter = totalJitter / state.peers.size;
    }
}

/**
 * Remove a specific peer's buffer (on disconnect).
 */
export function removePeerInterpBuffer(state, peerId) {
    state.peers.delete(peerId);
}

/**
 * Get interpolation stats for UI display.
 */
export function getInterpStats(state) {
    return { ...state._stats };
}

/**
 * Destroy all state.
 */
export function destroyCameraInterpState(state) {
    state.peers.clear();
}
