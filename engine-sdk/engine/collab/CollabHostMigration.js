// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * CollabHostMigration.js
 * Automatic host migration for P2P collaboration sessions.
 *
 * Problem: When the host peer drops (closes tab, network outage, crash),
 * relay mode breaks — all non-host peers lose the ability to communicate
 * through the relay hub. The session effectively dies.
 *
 * Solution: Bully-style host election with reputation-weighted scoring.
 * When the host is detected as dead:
 *   1. All peers start a migration election
 *   2. The peer with the highest "candidacy score" wins
 *   3. New host assumes relay duties and notifies all peers
 *   4. If the original host returns, it can reclaim the role
 *
 * Election Algorithm (modified Bully):
 *   - Each peer computes a candidacy score based on:
 *     • Reputation score (40%) — trustworthy peers preferred
 *     • Uptime in session (30%) — stable peers preferred
 *     • Connection count (20%) — well-connected peers preferred
 *     • Deterministic tiebreaker (10%) — lexicographic selfId for consistency
 *   - All peers broadcast their candidacy
 *   - After a short election timeout, the highest-scoring peer wins
 *   - If two peers tie, the one with the lexicographically higher selfId wins
 *
 * Inspired by:
 *   - Xbox Live host migration (Halo 2/3)
 *   - Photon PUN MasterClient migration
 *   - Raft leader election (simplified — no log replication needed)
 *   - Bully algorithm (Garcia-Molina, 1982)
 *
 * Current scope: this module elects a relay host and reconfigures routing.
 * Authority-map handoff, replicated-log consensus, election terms/quorums, and
 * signature-gated dispatch are not implemented here and remain audit gaps.
 * Candidate reputation/connection metrics remain locally self-reported, and
 * captured multi-peer host-failure/rejoin traces remain absent.
 */

import { legacyStringHash32 } from '../core/math/ChecksumMath.js';
import { runtimeMonotonicClockStep } from '../core/math/FrameMath.js';
import { clampRange } from '../core/math/MathScalar.js';
import { finiteNumberReport } from '../core/math/MathValidation.js';

// ── Constants ────────────────────────────────────────────────────────────────

const HOST_DEAD_TIMEOUT_MS   = 8000;  // declare host dead after 8s of no heartbeat
const ELECTION_TIMEOUT_MS    = 3000;  // wait 3s for all candidacies before deciding
const RECLAIM_GRACE_MS       = 5000;  // original host has 5s to reclaim after returning
const MIGRATION_COOLDOWN_MS  = 10000; // minimum time between migrations (prevent flapping)
const HEARTBEAT_CHECK_MS     = 2000;  // check host liveness every 2s

const CANDIDACY_WEIGHTS = {
    reputation:  0.40,
    uptime:      0.30,
    connections: 0.20,
    tiebreaker:  0.10,
};

const MAX_REPUTATION_SCORE = 1000;
const MAX_NORMALIZED_CONNECTIONS = 10;
const MAX_UPTIME_MS = 30 * 60 * 1000;

function _isPeerId(value) {
    return typeof value === 'string' && value.length > 0;
}

function _callback(value) {
    return typeof value === 'function' ? value : null;
}

function _clockNow(hm, timestampMs = Date.now()) {
    const step = runtimeMonotonicClockStep(timestampMs, hm._clockMs);
    hm._clockMs = step.timestampMs;
    return step.timestampMs;
}

// ── Migration States ─────────────────────────────────────────────────────────

const MIGRATION_STATE = {
    STABLE:     'stable',      // host is alive, no migration needed
    DETECTING:  'detecting',   // host heartbeat missing, monitoring
    ELECTING:   'electing',    // election in progress
    MIGRATING:  'migrating',   // new host assuming duties
    RECLAIMING: 'reclaiming',  // original host returned, handing back
};

// ── State ────────────────────────────────────────────────────────────────────

/**
 * Create a host migration manager.
 * @param {string} selfId
 * @param {Object} config
 * @returns {Object}
 */
export function createHostMigration(selfId, config = {}) {
    if (!_isPeerId(selfId)) throw new TypeError('selfId must be a non-empty string');
    const now = runtimeMonotonicClockStep(Date.now(), 0).timestampMs;
    return {
        selfId,
        _state: MIGRATION_STATE.STABLE,

        // Host tracking
        _isHost: false,
        _currentHostId: null,       // peerId of the current acting host
        _originalHostId: null,      // peerId of the original host (for reclaim)
        _isOriginalHost: false,     // true if WE are the original host

        // Liveness
        _clockMs: now,
        _lastHostHeartbeat: now,
        _hostCheckTimer: null,

        // Election
        _electionTimer: null,
        _reclaimTimer: null,
        _candidacies: new Map(),    // peerId -> { score, ts }
        _lastMigrationTs: 0,       // cooldown tracker

        // Our metrics (updated externally)
        _selfScore: 500,
        _selfUptime: 0,
        _selfConnectionCount: 0,
        _sessionStartTs: now,

        // Callbacks
        _onHostDead: _callback(config.onHostDead),         // () => void
        _onElectionStart: _callback(config.onElectionStart), // () => void
        _onNewHost: _callback(config.onNewHost),            // (newHostId, isSelf) => void
        _onHostReclaimed: _callback(config.onHostReclaimed), // (originalHostId) => void
        _onBroadcastOp: _callback(config.onBroadcastOp),   // (op) => void — send to all peers
        _onSendToPeer: _callback(config.onSendToPeer),     // (peerId, op) => void
        _onConfigureHost: _callback(config.onConfigureHost), // (isHost, hostPeerId) => void

        // Known peers for election
        _knownPeers: new Set(),

        // Stats
        _stats: {
            migrations: 0,
            elections: 0,
            reclaims: 0,
            hostDeaths: 0,
        },
    };
}

// ── Initialization ───────────────────────────────────────────────────────────

/**
 * Start host migration monitoring.
 * @param {Object} hm
 * @param {boolean} isHost - are we the initial host?
 * @param {string} hostPeerId - peerId of the initial host (null if we are host)
 */
export function startHostMigration(hm, isHost, hostPeerId) {
    const now = _clockNow(hm);
    hm._isHost = isHost;
    hm._isOriginalHost = isHost;
    hm._currentHostId = isHost ? hm.selfId : (hostPeerId || null);
    hm._originalHostId = hm._currentHostId;
    hm._lastHostHeartbeat = now;
    hm._state = MIGRATION_STATE.STABLE;
    hm._sessionStartTs = now;
    hm._lastReclaimTs = 0;

    // Non-host peers monitor the host's liveness — but ONLY if we know who
    // the host is. If hostPeerId is null (joiner hasn't connected yet),
    // defer monitoring until the first peer connects via migrationSetHost().
    if (!isHost && hostPeerId) {
        _startHostMonitor(hm);
    }
}

/**
 * Set the host peer ID (for joiners who didn't know at startup).
 * Starts the host liveness monitor if not already running.
 */
export function migrationSetHost(hm, hostPeerId) {
    if (!_isPeerId(hostPeerId) || hostPeerId === hm.selfId) return false;
    hm._currentHostId = hostPeerId;
    if (!hm._originalHostId) hm._originalHostId = hostPeerId;
    hm._lastHostHeartbeat = _clockNow(hm);
    if (!hm._isHost && !hm._hostCheckTimer) {
        _startHostMonitor(hm);
    }
    return true;
}

/**
 * Stop host migration monitoring.
 */
export function stopHostMigration(hm) {
    _stopHostMonitor(hm);
    _cancelElection(hm);
    if (hm._reclaimTimer) {
        clearTimeout(hm._reclaimTimer);
        hm._reclaimTimer = null;
    }
    hm._state = MIGRATION_STATE.STABLE;
}

// ── Host Liveness ────────────────────────────────────────────────────────────

/**
 * Record that we received a heartbeat (or any message) from the host.
 * Call this from the heartbeat handler.
 */
export function hostHeartbeatReceived(hm, fromPeerId) {
    if (fromPeerId === hm._currentHostId) {
        hm._lastHostHeartbeat = _clockNow(hm);
        // If we were detecting host death, cancel it
        if (hm._state === MIGRATION_STATE.DETECTING) {
            hm._state = MIGRATION_STATE.STABLE;
            console.log('[HostMigration] Host alive again — false alarm');
        }
    }
}

/**
 * Record that we received ANY op from a peer (used for liveness).
 * Even non-heartbeat ops prove the host is alive.
 */
export function hostActivityReceived(hm, fromPeerId) {
    if (fromPeerId === hm._currentHostId) {
        hm._lastHostHeartbeat = _clockNow(hm);
    }
}

function _startHostMonitor(hm) {
    _stopHostMonitor(hm);
    hm._hostCheckTimer = setInterval(() => {
        if (hm._isHost) return; // we ARE the host, no need to monitor
        if (hm._state === MIGRATION_STATE.ELECTING || hm._state === MIGRATION_STATE.MIGRATING) return;

        const elapsed = runtimeMonotonicClockStep(_clockNow(hm), hm._lastHostHeartbeat).elapsedMs;
        if (elapsed >= HOST_DEAD_TIMEOUT_MS && hm._state === MIGRATION_STATE.STABLE) {
            // Host is probably dead
            hm._state = MIGRATION_STATE.DETECTING;
            hm._stats.hostDeaths++;
            console.warn(`[HostMigration] Host ${hm._currentHostId} unresponsive for ${elapsed}ms — initiating election`);
            if (hm._onHostDead) hm._onHostDead();
            _startElection(hm);
        }
    }, HEARTBEAT_CHECK_MS);
}

function _stopHostMonitor(hm) {
    if (hm._hostCheckTimer) {
        clearInterval(hm._hostCheckTimer);
        hm._hostCheckTimer = null;
    }
}

// ── Election ─────────────────────────────────────────────────────────────────

/**
 * Start a host election. All peers broadcast their candidacy.
 */
function _startElection(hm) {
    const now = _clockNow(hm);
    // Cooldown check
    if (runtimeMonotonicClockStep(now, hm._lastMigrationTs).elapsedMs < MIGRATION_COOLDOWN_MS) {
        console.log('[HostMigration] Election cooldown — skipping');
        hm._state = MIGRATION_STATE.STABLE;
        return;
    }

    // Require at least 1 connected peer — solo elections are pointless
    if (hm._knownPeers.size === 0) {
        console.log('[HostMigration] No peers connected — skipping election, assuming host');
        hm._isHost = true;
        hm._currentHostId = hm.selfId;
        hm._state = MIGRATION_STATE.STABLE;
        hm._lastHostHeartbeat = now;
        _stopHostMonitor(hm);
        if (hm._onConfigureHost) hm._onConfigureHost(true, hm.selfId);
        if (hm._onNewHost) hm._onNewHost(hm.selfId, true);
        return;
    }

    hm._state = MIGRATION_STATE.ELECTING;
    hm._stats.elections++;
    hm._candidacies.clear();

    if (hm._onElectionStart) hm._onElectionStart();
    console.log('[HostMigration] Election started');

    // Compute our candidacy score and broadcast it
    const myScore = _computeCandidacyScore(hm);
    hm._candidacies.set(hm.selfId, { score: myScore, ts: now });

    // Broadcast candidacy to all peers
    if (hm._onBroadcastOp) {
        hm._onBroadcastOp({
            type: 'host_election',
            payload: {
                phase: 'candidacy',
                peerId: hm.selfId,
                score: myScore,
                originalHostId: hm._originalHostId,
            },
        });
    }

    // Set election timeout — after this, decide the winner
    _cancelElection(hm);
    hm._electionTimer = setTimeout(() => {
        _resolveElection(hm);
    }, ELECTION_TIMEOUT_MS);
}

/**
 * Handle a received election candidacy from another peer.
 */
export function onElectionCandidacy(hm, peerId, payload) {
    const scoreReport = finiteNumberReport(payload?.score, { min: 0, max: 1000 });
    if (!_isPeerId(peerId) || !hm._knownPeers.has(peerId) || !scoreReport.valid) return false;

    if (hm._state !== MIGRATION_STATE.ELECTING) {
        // We haven't started our own election yet — start one
        if (hm._state === MIGRATION_STATE.STABLE || hm._state === MIGRATION_STATE.DETECTING) {
            _startElection(hm);
        }
    }
    if (hm._state !== MIGRATION_STATE.ELECTING) return false;

    hm._candidacies.set(peerId, {
        score: scoreReport.value,
        ts: _clockNow(hm),
    });
    return true;
}

/**
 * Resolve the election — highest score wins.
 */
function _resolveElection(hm) {
    hm._electionTimer = null;

    if (hm._candidacies.size === 0) {
        console.warn('[HostMigration] No candidacies received — aborting');
        hm._state = MIGRATION_STATE.STABLE;
        return;
    }

    // Find the winner: highest score, then lexicographic tiebreak
    let winnerId = null;
    let winnerScore = -1;

    for (const [peerId, c] of hm._candidacies) {
        if (c.score > winnerScore || (c.score === winnerScore && peerId > winnerId)) {
            winnerId = peerId;
            winnerScore = c.score;
        }
    }

    console.log(`[HostMigration] Election result: ${winnerId} wins with score ${winnerScore.toFixed(1)} (${hm._candidacies.size} candidates)`);

    // Apply the result
    _applyNewHost(hm, winnerId);

    // Broadcast the result so all peers converge
    if (hm._onBroadcastOp) {
        hm._onBroadcastOp({
            type: 'host_election',
            payload: {
                phase: 'result',
                newHostId: winnerId,
                score: winnerScore,
                originalHostId: hm._originalHostId,
            },
        });
    }
}

/**
 * Handle a received election result from another peer.
 */
export function onElectionResult(hm, payload) {
    const newHostId = payload.newHostId;
    if (!_isPeerId(newHostId) || (newHostId !== hm.selfId && !hm._knownPeers.has(newHostId))) return false;
    if (payload.score !== undefined && !finiteNumberReport(payload.score, { min: 0, max: 1000 }).valid) return false;

    // Cancel our own election if still running
    _cancelElection(hm);

    // If we already resolved to the same host, skip
    if (hm._currentHostId === newHostId && hm._state === MIGRATION_STATE.STABLE) return true;

    console.log(`[HostMigration] Accepting election result: new host = ${newHostId}`);
    _applyNewHost(hm, newHostId);
    return true;
}

function _applyNewHost(hm, newHostId) {
    const wasHost = hm._isHost;
    const isSelf = newHostId === hm.selfId;

    hm._currentHostId = newHostId;
    hm._isHost = isSelf;
    hm._state = MIGRATION_STATE.STABLE;
    const now = _clockNow(hm);
    hm._lastMigrationTs = now;
    hm._lastHostHeartbeat = now;
    hm._stats.migrations++;

    // Configure core relay
    if (hm._onConfigureHost) {
        hm._onConfigureHost(isSelf, newHostId);
    }

    // Notify
    if (hm._onNewHost) {
        hm._onNewHost(newHostId, isSelf);
    }

    // If we became the new host, stop monitoring (we ARE the host now)
    if (isSelf) {
        _stopHostMonitor(hm);
        console.log('[HostMigration] We are the NEW HOST — assuming relay duties');
    } else {
        // Restart monitoring for the new host
        _startHostMonitor(hm);
        console.log(`[HostMigration] New host: ${newHostId} — monitoring liveness`);
    }
}

function _cancelElection(hm) {
    if (hm._electionTimer) {
        clearTimeout(hm._electionTimer);
        hm._electionTimer = null;
    }
}

// ── Original Host Reclaim ────────────────────────────────────────────────────

/**
 * Handle the original host returning to the session.
 * The original host broadcasts a reclaim request. The current acting host
 * defers after a grace period, handing duties back.
 */
export function onHostReclaimRequest(hm, originalHostId) {
    if (originalHostId !== hm._originalHostId) return false; // not the real original host

    console.log(`[HostMigration] Original host ${originalHostId} is reclaiming — grace period ${RECLAIM_GRACE_MS}ms`);
    hm._state = MIGRATION_STATE.RECLAIMING;

    // After grace period, hand back to original host
    if (hm._reclaimTimer) clearTimeout(hm._reclaimTimer);
    hm._reclaimTimer = setTimeout(() => {
        hm._reclaimTimer = null;
        if (hm._state !== MIGRATION_STATE.RECLAIMING) return; // state changed during grace

        _applyNewHost(hm, originalHostId);
        hm._stats.reclaims++;

        if (hm._onHostReclaimed) {
            hm._onHostReclaimed(originalHostId);
        }

        // Broadcast confirmation
        if (hm._onBroadcastOp) {
            hm._onBroadcastOp({
                type: 'host_election',
                payload: {
                    phase: 'reclaim_ack',
                    newHostId: originalHostId,
                    originalHostId: hm._originalHostId,
                },
            });
        }
    }, RECLAIM_GRACE_MS);
    return true;
}

/**
 * Called by the original host when it returns to reclaim.
 * Only call if we ARE the original host and someone else took over.
 */
export function requestHostReclaim(hm) {
    if (!hm._isOriginalHost) return;
    if (hm._isHost) return; // we're already host, nothing to reclaim
    if (hm._state === MIGRATION_STATE.ELECTING || hm._state === MIGRATION_STATE.MIGRATING) return;

    // Rate-limit: max once per RECLAIM_GRACE_MS
    const now = _clockNow(hm);
    if (runtimeMonotonicClockStep(now, hm._lastReclaimTs || 0).elapsedMs < RECLAIM_GRACE_MS) return;
    hm._lastReclaimTs = now;

    console.log('[HostMigration] Requesting host reclaim (we are original host)');
    if (hm._onBroadcastOp) {
        hm._onBroadcastOp({
            type: 'host_election',
            payload: {
                phase: 'reclaim',
                peerId: hm.selfId,
                originalHostId: hm._originalHostId,
            },
        });
    }
}

// ── Candidacy Scoring ────────────────────────────────────────────────────────

export function hostMigrationTiebreakerNorm(selfId) {
    const hash = legacyStringHash32(selfId);
    return (Math.abs(hash) % 10000) / 10000;
}

export function hostMigrationCandidacyScoreReport(metrics = {}, timestampMs = Date.now()) {
    const reputation = finiteNumberReport(metrics.reputation, { min: 0, max: MAX_REPUTATION_SCORE });
    const connections = finiteNumberReport(metrics.connectionCount, {
        min: 0,
        max: Number.MAX_SAFE_INTEGER,
        integer: true,
    });
    const sessionStart = finiteNumberReport(metrics.sessionStartTs, { min: 0 });
    const timestamp = finiteNumberReport(timestampMs, { min: 0 });
    const identityValid = _isPeerId(metrics.selfId);
    const valid = identityValid && reputation.valid && connections.valid && sessionStart.valid && timestamp.valid;
    if (!valid) {
        return { valid: false, score: 0, identityValid, reputation, connections, sessionStart, timestamp };
    }

    const uptimeMs = runtimeMonotonicClockStep(timestamp.value, sessionStart.value).elapsedMs;
    const reputationNorm = clampRange(reputation.value / MAX_REPUTATION_SCORE, 0, 1);
    const uptimeNorm = clampRange(uptimeMs / MAX_UPTIME_MS, 0, 1);
    const connectionNorm = clampRange(connections.value / MAX_NORMALIZED_CONNECTIONS, 0, 1);
    const tiebreakerNorm = hostMigrationTiebreakerNorm(metrics.selfId);
    const score = 1000 * (
        CANDIDACY_WEIGHTS.reputation * reputationNorm +
        CANDIDACY_WEIGHTS.uptime * uptimeNorm +
        CANDIDACY_WEIGHTS.connections * connectionNorm +
        CANDIDACY_WEIGHTS.tiebreaker * tiebreakerNorm
    );
    return { valid: true, score, reputationNorm, uptimeNorm, connectionNorm, tiebreakerNorm, uptimeMs };
}

/**
 * Compute this peer's candidacy score for host election.
 * Higher = more likely to become host.
 */
function _computeCandidacyScore(hm) {
    return hostMigrationCandidacyScoreReport({
        selfId: hm.selfId,
        reputation: hm._selfScore,
        connectionCount: hm._selfConnectionCount,
        sessionStartTs: hm._sessionStartTs,
    }, _clockNow(hm)).score;
}

// ── Peer Management ──────────────────────────────────────────────────────────

/**
 * Register a known peer.
 */
export function migrationAddPeer(hm, peerId) {
    if (!_isPeerId(peerId) || peerId === hm.selfId) return false;
    hm._knownPeers.add(peerId);
    hm._selfConnectionCount = hm._knownPeers.size;
    return true;
}

/**
 * Remove a known peer.
 */
export function migrationRemovePeer(hm, peerId) {
    if (!_isPeerId(peerId) || peerId === hm.selfId) return false;
    hm._knownPeers.delete(peerId);
    hm._selfConnectionCount = hm._knownPeers.size;

    // If the host left, trigger detection immediately
    if (peerId === hm._currentHostId && !hm._isHost) {
        console.warn(`[HostMigration] Host ${peerId} left — starting immediate election`);
        hm._stats.hostDeaths++;
        if (hm._onHostDead) hm._onHostDead();
        _startElection(hm);
    }
}

/**
 * Update our own metrics (call from collab loop).
 */
export function migrationUpdateSelfMetrics(hm, score, connectionCount) {
    const scoreReport = finiteNumberReport(score, { min: 0, max: MAX_REPUTATION_SCORE });
    const connectionReport = finiteNumberReport(connectionCount, {
        min: 0,
        max: Number.MAX_SAFE_INTEGER,
        integer: true,
    });
    if (!scoreReport.valid || !connectionReport.valid) return false;
    hm._selfScore = scoreReport.value;
    hm._selfConnectionCount = connectionReport.value;
    return true;
}

// ── Op Handling ──────────────────────────────────────────────────────────────

/**
 * Handle an incoming host_election op.
 * Routes to the appropriate handler based on phase.
 */
export function onHostElectionOp(hm, peerId, op) {
    const p = op?.payload;
    if (!p || !_isPeerId(peerId)) return false;

    switch (p.phase) {
        case 'candidacy':
            if (p.peerId !== undefined && p.peerId !== peerId) return false;
            return onElectionCandidacy(hm, peerId, p);
        case 'result':
            return onElectionResult(hm, p);
        case 'reclaim':
            if (p.peerId !== undefined && p.peerId !== peerId) return false;
            return onHostReclaimRequest(hm, peerId);
        case 'reclaim_ack':
            // Another peer confirmed reclaim — apply if we haven't already
            if (p.newHostId !== hm._originalHostId) return false;
            if (p.newHostId !== hm._currentHostId) {
                _applyNewHost(hm, p.newHostId);
                hm._stats.reclaims++;
            }
            return true;
        default:
            return false;
    }
}

// ── Graceful Disconnect ──────────────────────────────────────────────────────

/**
 * Build a goodbye op to broadcast before leaving.
 * Other peers use this to immediately detect departure instead of waiting
 * for heartbeat timeout.
 */
export function buildGoodbyeOp(hm) {
    return {
        type: 'peer_goodbye',
        payload: {
            peerId: hm.selfId,
            wasHost: hm._isHost,
            originalHostId: hm._originalHostId,
        },
    };
}

/**
 * Handle a received goodbye from a departing peer.
 * If the host sent the goodbye, immediately start election (no timeout wait).
 */
export function onPeerGoodbye(hm, payload, fromPeerId = payload?.peerId) {
    const { peerId, wasHost } = payload || {};
    if (!_isPeerId(peerId) || peerId !== fromPeerId || typeof wasHost !== 'boolean') return false;
    hm._knownPeers.delete(peerId);
    hm._selfConnectionCount = hm._knownPeers.size;

    if (wasHost && peerId === hm._currentHostId && !hm._isHost) {
        console.warn(`[HostMigration] Host ${peerId} sent goodbye — immediate election`);
        hm._stats.hostDeaths++;
        if (hm._onHostDead) hm._onHostDead();
        _startElection(hm);
    }
    return true;
    return true;
}

// ── Query ────────────────────────────────────────────────────────────────────

export function getMigrationState(hm) {
    return hm._state;
}

export function getMigrationStats(hm) {
    return {
        state: hm._state,
        isHost: hm._isHost,
        currentHostId: hm._currentHostId,
        originalHostId: hm._originalHostId,
        isOriginalHost: hm._isOriginalHost,
        selfScore: _computeCandidacyScore(hm),
        ...hm._stats,
    };
}

export function isCurrentHost(hm) {
    return hm._isHost;
}

export function getCurrentHostId(hm) {
    return hm._currentHostId;
}

// ── Cleanup ──────────────────────────────────────────────────────────────────

export function destroyHostMigration(hm) {
    stopHostMigration(hm);
    hm._knownPeers.clear();
    hm._candidacies.clear();
    hm._currentHostId = null;
    hm._originalHostId = null;
    hm._isHost = false;
    hm._isOriginalHost = false;
    hm._lastHostHeartbeat = 0;
    hm._lastMigrationTs = 0;
    hm._lastReclaimTs = 0;
    hm._sessionStartTs = 0;
    hm._clockMs = 0;
    hm._selfScore = 0;
    hm._selfUptime = 0;
    hm._selfConnectionCount = 0;
    hm._stats = { migrations: 0, elections: 0, reclaims: 0, hostDeaths: 0 };
    hm._onHostDead = null;
    hm._onElectionStart = null;
    hm._onNewHost = null;
    hm._onHostReclaimed = null;
    hm._onBroadcastOp = null;
    hm._onSendToPeer = null;
    hm._onConfigureHost = null;
}
