// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * CollabPeerReputation.js
 * Peer quality scoring system — rates each peer 0-1000 based on real-time
 * connection metrics. Inspired by Meshtastic SNR-based prioritization and
 * multi-layer throttling.
 *
 * Score breakdown (1000 total):
 *   250 — Latency (RTT from heartbeat pings)
 *   200 — Packet delivery (sent vs received ratio)
 *   200 — Connection stability (reconnection count)
 *   150 — Session duration (longer = more trusted)
 *   100 — Jitter (variance in latency — lower = better)
 *   100 — Throughput quality (buffered amount / backpressure)
 *
 * Each sub-score is 0.0–1.0, multiplied by its weight. The total is rounded
 * to an integer 0–1000. Scores update every 2 seconds; observed peer scores
 * are shared through signed reports, while the local self-score rides pongs.
 *
 * Inspired by: Meshtastic SNR-based node prioritization, role-based priority,
 * and automatic traffic scaling for large meshes.
 */

import { runtimeMonotonicClockStep } from '../core/math/FrameMath.js';
import { latencyJitterReport, packetLossReport, rttSampleMs } from '../core/math/NetworkMetricMath.js';
import { clamp, inverseLerp, isFiniteNumber } from '../core/math/MathScalar.js';
import { statsMean } from '../core/math/MathStatistics.js';

// ── Constants ────────────────────────────────────────────────────────────────

const SCORE_UPDATE_INTERVAL_MS = 2000;  // recompute scores at 0.5Hz
const PING_INTERVAL_MS         = 3000;  // send pings at ~0.33Hz
const PING_TIMEOUT_MS          = 5000;  // consider ping lost after this
const MAX_RTT_SAMPLES          = 30;    // rolling window for latency stats
const MAX_JITTER_SAMPLES       = 20;    // rolling window for jitter
const SESSION_FULL_TRUST_MS    = 300000; // 5 minutes for full session duration score

// Sub-score weights (must sum to 1000)
const W_LATENCY    = 250;
const W_DELIVERY   = 200;
const W_STABILITY  = 200;
const W_SESSION    = 150;
const W_JITTER     = 100;
const W_THROUGHPUT = 100;

// Thresholds for sub-score curves
const LATENCY_IDEAL_MS   = 30;   // ≤30ms = perfect score
const LATENCY_BAD_MS     = 500;  // ≥500ms = 0 score
const JITTER_IDEAL_MS    = 5;    // ≤5ms = perfect
const JITTER_BAD_MS      = 100;  // ≥100ms = 0

// ── Create ───────────────────────────────────────────────────────────────────

/**
 * Create a reputation tracker for all peers.
 * @param {string} selfId - this peer's unique ID
 * @returns {Object} reputation state
 */
export function createPeerReputation(selfId) {
    return {
        selfId,
        // peerId -> PeerMetrics
        _peers: new Map(),
        // Preserve reconnect penalties without retaining disconnected peer state.
        _reconnectCounts: new Map(),
        // Bootstrap self-score. No peer-observation consensus path exists yet.
        _selfScore: 1000,
        // Timing
        _lastScoreUpdateMs: 0,
        _lastPingMs: 0,
        _lastWallClockMs: 0,
    };
}

/**
 * Internal: create metrics state for a single peer.
 */
function _createPeerMetrics(peerId, joinedAt, reconnectCount = 0) {
    return {
        peerId,
        joinedAt,                       // when they most recently connected
        reconnectCount,                 // number of reconnections

        // Latency (RTT)
        rttSamples: [],                // last N RTT measurements (ms)
        avgRtt: 0,
        minRtt: Infinity,

        // Jitter
        jitterSamples: [],             // |rtt[i] - rtt[i-1]| values
        avgJitter: 0,

        // Packet loss
        pingsSent: 0,
        pongsReceived: 0,
        pendingPings: new Map(),       // pingId -> sentTimestamp

        // Throughput / backpressure
        bufferedAmountSamples: [],     // last N bufferedAmount readings
        avgBuffered: 0,

        // Remote score (what they tell us their score is)
        remoteScore: null,

        // Computed scores
        score: 1000,                   // 0-1000
        subScores: {
            latency: 1.0,
            delivery: 1.0,
            stability: 1.0,
            session: 0.0,
            jitter: 1.0,
            throughput: 1.0,
        },
    };
}

// ── Peer Lifecycle ───────────────────────────────────────────────────────────

/**
 * Register a new peer.
 */
export function reputationAddPeer(rep, peerId) {
    const now = _advanceWallClock(rep);
    if (rep._peers.has(peerId)) {
        // Reconnection — bump reconnect count
        const m = rep._peers.get(peerId);
        m.reconnectCount++;
        m.pendingPings.clear();
        return;
    }
    const reconnectCount = rep._reconnectCounts.get(peerId) ?? 0;
    rep._reconnectCounts.delete(peerId);
    rep._peers.set(peerId, _createPeerMetrics(peerId, now, reconnectCount));
}

/**
 * Remove a peer.
 */
export function reputationRemovePeer(rep, peerId) {
    const m = rep._peers.get(peerId);
    if (!m) return;
    rep._reconnectCounts.set(peerId, m.reconnectCount + 1);
    rep._peers.delete(peerId);
}

// ── Ping / Pong ──────────────────────────────────────────────────────────────

/**
 * Build ping ops to send to all peers. Call at PING_INTERVAL_MS.
 * @returns {Array<{ peerId: string, op: Object }>} per-peer ping ops
 */
export function buildPingOps(rep) {
    const now = _advanceWallClock(rep);
    if (runtimeMonotonicClockStep(now, rep._lastPingMs).elapsedMs < PING_INTERVAL_MS) return [];
    rep._lastPingMs = now;

    const ops = [];
    const pingId = now; // use timestamp as unique ping ID

    for (const [peerId, m] of rep._peers) {
        m.pingsSent++;
        m.pendingPings.set(pingId, now);

        // Prune old pending pings (timed out)
        for (const [id, ts] of m.pendingPings) {
            if (runtimeMonotonicClockStep(now, ts).elapsedMs > PING_TIMEOUT_MS) {
                m.pendingPings.delete(id);
            }
        }

        ops.push({
            peerId,
            op: { type: '__rep_ping__', payload: { id: pingId, ts: now } },
        });
    }

    return ops;
}

/**
 * Build a pong response to an incoming ping.
 * @returns {Object} op to send back
 */
export function buildPongOp(pingOp, selfScore) {
    return {
        type: '__rep_pong__',
        payload: {
            id: pingOp.payload.id,
            ts: pingOp.payload.ts,
            score: clamp(Math.round(isFiniteNumber(selfScore) ? selfScore : 0), 0, 1000),
        },
    };
}

/**
 * Handle an incoming pong from a peer. Records RTT and jitter.
 * @param {Object} rep
 * @param {string} peerId
 * @param {Object} pongOp
 */
export function onPongReceived(rep, peerId, pongOp) {
    const m = rep._peers.get(peerId);
    if (!m) return;

    const now = _advanceWallClock(rep);
    const pingId = pongOp.payload?.id;
    const sentTs = m.pendingPings.get(pingId);

    if (sentTs != null) {
        const rtt = rttSampleMs({ sentAtMs: sentTs, ackReceivedAtMs: now });
        m.pendingPings.delete(pingId);
        m.pongsReceived++;

        // RTT
        m.rttSamples.push(rtt);
        if (m.rttSamples.length > MAX_RTT_SAMPLES) m.rttSamples.shift();
        const latency = latencyJitterReport(m.rttSamples);
        m.avgRtt = latency.meanMs;
        m.minRtt = Math.min(m.minRtt, rtt);

        // Jitter (absolute difference between consecutive RTTs)
        if (latency.deltasMs.length > 0) {
            const jitter = latency.deltasMs[latency.deltasMs.length - 1];
            m.jitterSamples.push(jitter);
            if (m.jitterSamples.length > MAX_JITTER_SAMPLES) m.jitterSamples.shift();
            m.avgJitter = _avg(m.jitterSamples);
        }
    }

    // Store their self-reported score
    if (isFiniteNumber(pongOp.payload?.score)) {
        m.remoteScore = clamp(Math.round(pongOp.payload.score), 0, 1000);
    }
}

// ── Buffered Amount Tracking ─────────────────────────────────────────────────

/**
 * Record the current bufferedAmount for a peer's data channel.
 * Call this periodically (e.g., every presence tick).
 */
export function recordBufferedAmount(rep, peerId, bufferedAmount) {
    const m = rep._peers.get(peerId);
    if (!m || !isFiniteNumber(bufferedAmount) || bufferedAmount < 0) return;
    m.bufferedAmountSamples.push(bufferedAmount);
    if (m.bufferedAmountSamples.length > 10) m.bufferedAmountSamples.shift();
    m.avgBuffered = _avg(m.bufferedAmountSamples);
}

// ── Score Computation ────────────────────────────────────────────────────────

/**
 * Recompute scores for all peers. Call at ~0.5Hz.
 * @returns {boolean} true if scores were updated this tick
 */
export function tickReputation(rep) {
    const now = _advanceWallClock(rep);
    if (runtimeMonotonicClockStep(now, rep._lastScoreUpdateMs).elapsedMs < SCORE_UPDATE_INTERVAL_MS) return false;
    rep._lastScoreUpdateMs = now;

    for (const [, m] of rep._peers) {
        _computeScore(m, now);
    }

    return true;
}

function _computeScore(m, now) {
    const ss = m.subScores;

    // 1. Latency (0-1): inversely proportional to avgRtt
    if (m.rttSamples.length > 0) {
        ss.latency = clamp(inverseLerp(LATENCY_BAD_MS, LATENCY_IDEAL_MS, m.avgRtt), 0, 1);
    } else {
        ss.latency = 0.5; // no data yet — neutral
    }

    // 2. Delivery (0-1): pongsReceived / pingsSent
    if (m.pingsSent > 0) {
        ss.delivery = packetLossReport({
            sentPackets: m.pingsSent,
            receivedPackets: Math.min(m.pongsReceived, m.pingsSent),
        }).deliveryRatio;
    } else {
        ss.delivery = 1.0; // no pings yet — benefit of doubt
    }

    // 3. Stability (0-1): penalized by reconnection count, capped
    // 0 reconnects = 1.0, 1 = 0.8, 2 = 0.6, 3 = 0.4, 4 = 0.2, 5+ = 0.0
    ss.stability = clamp(1.0 - m.reconnectCount * 0.2, 0, 1);

    // 4. Session duration (0-1): ramps up over SESSION_FULL_TRUST_MS
    const elapsed = runtimeMonotonicClockStep(now, m.joinedAt).elapsedMs;
    ss.session = clamp(elapsed / SESSION_FULL_TRUST_MS, 0, 1);

    // 5. Jitter (0-1): inversely proportional to avgJitter
    if (m.jitterSamples.length > 0) {
        ss.jitter = clamp(inverseLerp(JITTER_BAD_MS, JITTER_IDEAL_MS, m.avgJitter), 0, 1);
    } else {
        ss.jitter = 0.5;
    }

    // 6. Throughput (0-1): low bufferedAmount = good
    // 0 bytes = 1.0, 64KB = 0.75, 256KB+ = 0.0
    if (m.bufferedAmountSamples.length > 0) {
        ss.throughput = clamp(inverseLerp(256 * 1024, 0, m.avgBuffered), 0, 1);
    } else {
        ss.throughput = 1.0;
    }

    // Total score
    m.score = Math.round(
        ss.latency    * W_LATENCY +
        ss.delivery   * W_DELIVERY +
        ss.stability  * W_STABILITY +
        ss.session    * W_SESSION +
        ss.jitter     * W_JITTER +
        ss.throughput * W_THROUGHPUT
    );

    // Clamp
    m.score = clamp(m.score, 0, 1000);
}

// ── Query ────────────────────────────────────────────────────────────────────

/**
 * Get the reputation score for a specific peer (0-1000).
 */
export function getPeerScore(rep, peerId) {
    const m = rep._peers.get(peerId);
    return m ? m.score : null;
}

/**
 * Get full metrics for a specific peer (for debug / stats display).
 */
export function getPeerMetrics(rep, peerId) {
    return rep._peers.get(peerId) || null;
}

/**
 * Get the local peer's self-score.
 * This remains the bootstrap score until a self-observation consensus path exists.
 */
export function getSelfScore(rep) {
    return clamp(Math.round(isFiniteNumber(rep._selfScore) ? rep._selfScore : 0), 0, 1000);
}

/**
 * Get all peer scores as an array of { peerId, score, subScores, avgRtt, avgJitter }.
 */
export function getAllPeerScores(rep) {
    const result = [];
    const now = _advanceWallClock(rep);
    for (const [peerId, m] of rep._peers) {
        const delivery = packetLossReport({
            sentPackets: m.pingsSent,
            receivedPackets: Math.min(m.pongsReceived, m.pingsSent),
        });
        result.push({
            peerId,
            score: m.score,
            subScores: { ...m.subScores },
            avgRtt: Math.round(m.avgRtt),
            avgJitter: Math.round(m.avgJitter),
            deliveryRate: delivery.deliveryRatio,
            sessionMinutes: Math.round(runtimeMonotonicClockStep(now, m.joinedAt).elapsedMs / 60000),
            reconnects: m.reconnectCount,
        });
    }
    return result;
}

/**
 * Get the score color for rendering (green → yellow → red gradient).
 * @param {number} score - 0-1000
 * @returns {string} CSS color string
 */
export function getScoreColor(score) {
    if (score >= 800) return '#22c55e'; // green — excellent
    if (score >= 600) return '#84cc16'; // lime — good
    if (score >= 400) return '#f59e0b'; // amber — fair
    if (score >= 200) return '#f97316'; // orange — poor
    return '#ef4444';                   // red — bad
}

/**
 * Get a human-readable label for a score range.
 * @param {number} score
 * @returns {string}
 */
export function getScoreLabel(score) {
    if (score >= 900) return 'Excellent';
    if (score >= 700) return 'Good';
    if (score >= 500) return 'Fair';
    if (score >= 300) return 'Poor';
    return 'Bad';
}

// ── Cleanup ──────────────────────────────────────────────────────────────────

/**
 * Destroy reputation state.
 */
export function destroyPeerReputation(rep) {
    rep._peers.clear();
    rep._reconnectCounts.clear();
    rep._selfScore = 1000;
    rep._lastScoreUpdateMs = 0;
    rep._lastPingMs = 0;
    rep._lastWallClockMs = 0;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function _avg(arr) {
    return statsMean(arr);
}

function _advanceWallClock(rep) {
    const clock = runtimeMonotonicClockStep(Date.now(), rep._lastWallClockMs);
    rep._lastWallClockMs = clock.timestampMs;
    return clock.timestampMs;
}
