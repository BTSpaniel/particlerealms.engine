// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * CollabMeshTopology.js
 * Adaptive mesh topology for scalable P2P collaboration.
 *
 * Problem: Full mesh is O(N²) connections. At 8+ WebRTC peers, browsers
 * struggle with connection management, DTLS overhead, and bandwidth.
 * The old system had a hard limit of 4-8 peers before switching to
 * star relay (single point of failure, bottleneck on host).
 *
 * Solution: Hybrid topology combining proven P2P techniques:
 *
 *   1. PARTIAL MESH — Each peer maintains K direct WebRTC connections
 *      to its "best" neighbors (lowest latency, highest reputation).
 *      K = 3-6 instead of N-1. Scales linearly, not quadratically.
 *
 *   2. GOSSIP PROPAGATION — Ops ripple through the partial mesh.
 *      Each peer forwards received ops to its neighbors (minus sender).
 *      With K=4, messages reach all 50 peers in ~3 hops (log_K(N)).
 *      Deduplication via op fingerprint prevents infinite loops.
 *
 *   3. SUPERNODE ELECTION — High-reputation peers (score ≥ 700) with
 *      good uptime and low latency are elected as supernodes. They
 *      maintain more connections (up to 2K) and serve as relay hubs
 *      between clusters. Inspired by Skype's original P2P architecture.
 *
 *   4. FAST CHANNEL BRIDGING — Same-origin peers use BroadcastChannel
 *      (zero cost). They don't count toward K and act as free bridges.
 *
 * Topology modes (auto-selected based on peer count):
 *   - FULL_MESH:   ≤6 WebRTC peers → everyone connects to everyone
 *   - PARTIAL_MESH: 7-50 peers → K-neighbor gossip mesh
 *   - SUPERNODE:    20+ peers → supernodes bridge clusters
 *
 * Inspired by: libp2p (IPFS), Kademlia, Bitcoin gossip, Meshtastic,
 * Skype supernode architecture, and epidemic broadcast protocols.
 *
 * Current policy boundaries: topology callbacks recommend connection changes
 * but EditorCollab does not execute them; topology reports are advisory rather
 * than consensus; gossip envelopes are forwarded before application-level
 * integrity validation; and captured large-room WebRTC traces remain absent.
 */

import { runtimeMonotonicClockStep } from '../core/math/FrameMath.js';
import { clamp } from '../core/math/MathScalar.js';
import { finiteNumberReport } from '../core/math/MathValidation.js';
import {
    MESH_DEFAULT_IDEAL_DEGREE,
    MESH_FULL_MESH_CEILING,
    MESH_MAX_DEGREE,
    MESH_MIN_DEGREE,
    MESH_SUPERNODE_DEGREE,
    MESH_SUPERNODE_SCORE,
    MESH_SUPERNODE_TIER_MULTIPLIER,
    MESH_SUPERNODE_THRESHOLD,
    neighborSelectionReport,
    supernodeScoreReport,
    topologyModeReport,
} from '../core/math/MeshMath.js';

// ── Constants ────────────────────────────────────────────────────────────────

const GOSSIP_TTL_DEFAULT = 6;    // max hops for gossip propagation
const GOSSIP_DEDUP_SIZE  = 2000; // max entries in dedup cache
const GOSSIP_DEDUP_TTL   = 10000; // dedup entries expire after 10s
const REBALANCE_INTERVAL = 5000; // re-evaluate topology every 5s
const VALID_INTEGRITY_TIERS = new Set(['clean', 'warning', 'throttled', 'muted', 'kicked']);

// ── Topology Modes ───────────────────────────────────────────────────────────

const TOPOLOGY = {
    FULL_MESH:    'full_mesh',    // everyone → everyone (≤6 peers)
    PARTIAL_MESH: 'partial_mesh', // K-neighbor gossip (7-19 peers)
    SUPERNODE:    'supernode',    // supernode-bridged clusters (20+ peers)
};

function _advanceWallClock(topo) {
    const clock = runtimeMonotonicClockStep(Date.now(), topo._lastWallClockMs);
    topo._lastWallClockMs = clock.timestampMs;
    return clock.timestampMs;
}

function _boundedInteger(value, fallback, min, max) {
    if (value === undefined || value === null) return fallback;
    const report = finiteNumberReport(value, { integer: true, min, max });
    return report.valid ? report.value : fallback;
}

function _metric(value, fallback, min, max) {
    if (value === undefined || value === null) return fallback;
    const report = finiteNumberReport(value, { min, max });
    return report.valid ? report.value : fallback;
}

function _validPeerId(peerId) {
    return typeof peerId === 'string' && peerId.length > 0 && peerId.length <= 128;
}

function _createStats() {
    return {
        gossipSent: 0,
        gossipReceived: 0,
        gossipDeduped: 0,
        gossipRejected: 0,
        rebalances: 0,
        topologyChanges: 0,
        maxHopsObserved: 0,
    };
}

// ── State ────────────────────────────────────────────────────────────────────

/**
 * Create a topology manager.
 * @param {string} selfId
 * @param {Object} config
 * @returns {Object}
 */
export function createMeshTopology(selfId, config = {}) {
    if (!_validPeerId(selfId)) throw new TypeError('createMeshTopology requires a bounded string selfId');
    const options = config && typeof config === 'object' && !Array.isArray(config) ? config : {};
    const k = _boundedInteger(options.k, MESH_DEFAULT_IDEAL_DEGREE, MESH_MIN_DEGREE, MESH_MAX_DEGREE);
    return {
        selfId,
        _mode: TOPOLOGY.FULL_MESH,

        // All known peers (discovered via signaling) — superset of connected peers
        // peerId -> { score, latency, uptime, isSupernode, isConnected, isFastPeer, joinedAt }
        _knownPeers: new Map(),

        // Our direct WebRTC neighbors (subset of known peers we maintain connections to)
        // peerId -> { score, latency, connectedAt }
        _neighbors: new Map(),

        // Supernode state
        _isSupernode: false,
        _supernodes: new Set(),    // peerIds of known supernodes
        _supernodeScore: 0,        // our supernode candidacy score

        // Gossip deduplication: opFingerprint -> timestamp
        _gossipSeen: new Map(),

        // Config
        _k: k,
        _kSupernode: _boundedInteger(options.kSupernode, MESH_SUPERNODE_DEGREE, k, 256),
        _fullMeshCeiling: _boundedInteger(options.fullMeshCeiling, MESH_FULL_MESH_CEILING, 0, 256),
        _supernodeThreshold: _boundedInteger(options.supernodeThreshold, MESH_SUPERNODE_THRESHOLD, 1, 10000),

        // Callbacks
        _onConnectPeer: typeof options.onConnectPeer === 'function' ? options.onConnectPeer : null,
        _onDisconnectPeer: typeof options.onDisconnectPeer === 'function' ? options.onDisconnectPeer : null,
        _onTopologyChange: typeof options.onTopologyChange === 'function' ? options.onTopologyChange : null,
        _onSupernodeElected: typeof options.onSupernodeElected === 'function' ? options.onSupernodeElected : null,

        // Timers
        _rebalanceTimer: null,
        _lastWallClockMs: 0,
        _active: false,
        _destroyed: false,

        // Stats
        _stats: _createStats(),
    };
}

// ── Topology Resolution ──────────────────────────────────────────────────────

/**
 * Resolve the current topology mode based on peer count and quality.
 * Called after peer join/leave and during periodic rebalance.
 * @param {Object} topo
 * @returns {string} the new topology mode
 */
export function resolveTopology(topo) {
    const webrtcPeers = _countWebRTCPeers(topo);
    const newMode = topologyModeReport({
        peerCount: webrtcPeers,
        fullMeshCeiling: topo._fullMeshCeiling,
        supernodeThreshold: topo._supernodeThreshold,
        defaultDegree: topo._k,
        supernodeDegree: topo._kSupernode,
        isSupernode: topo._isSupernode,
    }).mode;

    if (newMode !== topo._mode) {
        const oldMode = topo._mode;
        topo._mode = newMode;
        topo._stats.topologyChanges++;
        console.log(`[MeshTopology] Mode: ${oldMode} → ${newMode} (${webrtcPeers} WebRTC peers)`);
        if (topo._onTopologyChange) {
            topo._onTopologyChange(newMode, {
                webrtcPeers,
                totalPeers: topo._knownPeers.size,
                k: _effectiveK(topo),
            });
        }
    }

    return topo._mode;
}

/**
 * Get the effective K (neighbor count) for this peer.
 */
function _effectiveK(topo) {
    if (topo._mode === TOPOLOGY.FULL_MESH) return topo._knownPeers.size; // connect to all
    if (topo._isSupernode) return Math.min(topo._kSupernode, topo._knownPeers.size);
    return Math.min(topo._k, topo._knownPeers.size);
}

// ── Peer Management ──────────────────────────────────────────────────────────

/**
 * Register a discovered peer (from signaling).
 */
export function topologyAddPeer(topo, peerId, info = {}) {
    if (topo._destroyed || !_validPeerId(peerId) || peerId === topo.selfId ||
        !info || typeof info !== 'object' || Array.isArray(info)) {
        return false;
    }
    const existing = topo._knownPeers.get(peerId);
    if (existing) {
        // Update info
        if (info.score != null) existing.score = _metric(info.score, existing.score, 0, 1000);
        if (info.latency != null) existing.latency = _metric(info.latency, existing.latency, 0, Number.MAX_SAFE_INTEGER);
        if (typeof info.isFastPeer === 'boolean') existing.isFastPeer = info.isFastPeer;
        if (typeof info.isSupernode === 'boolean') existing.isSupernode = info.isSupernode;
        return true;
    }
    const now = _advanceWallClock(topo);
    topo._knownPeers.set(peerId, {
        score: _metric(info.score, 500, 0, 1000),
        latency: _metric(info.latency, 999, 0, Number.MAX_SAFE_INTEGER),
        uptime: 0,
        isSupernode: info.isSupernode === true,
        isConnected: false,
        isFastPeer: info.isFastPeer === true,
        joinedAt: now,
        // Integrity-aware fields (updated by topologyUpdatePeerIntegrity)
        integrityTier: 'clean',
        integrityTrust: 0,
        socialModifier: 0,
    });
    return true;
}

/**
 * Remove a peer (disconnected / left).
 */
export function topologyRemovePeer(topo, peerId) {
    if (topo._destroyed || !_validPeerId(peerId)) return false;
    const removed = topo._knownPeers.delete(peerId);
    topo._neighbors.delete(peerId);
    topo._supernodes.delete(peerId);
    return removed;
}

/**
 * Mark a peer as connected (WebRTC DataChannel open).
 */
export function topologyPeerConnected(topo, peerId) {
    if (topo._destroyed || !_validPeerId(peerId) || peerId === topo.selfId) return false;
    const peer = topo._knownPeers.get(peerId);
    if (peer) peer.isConnected = true;
    if (!topo._neighbors.has(peerId)) {
        topo._neighbors.set(peerId, {
            score: peer?.score ?? 500,
            latency: peer?.latency ?? 999,
            connectedAt: _advanceWallClock(topo),
        });
    }
    return true;
}

/**
 * Mark a peer as disconnected.
 */
export function topologyPeerDisconnected(topo, peerId) {
    if (topo._destroyed || !_validPeerId(peerId)) return false;
    const peer = topo._knownPeers.get(peerId);
    if (peer) peer.isConnected = false;
    return topo._neighbors.delete(peerId);
}

/**
 * Update a peer's metrics (called from reputation system).
 */
export function topologyUpdatePeerMetrics(topo, peerId, metrics) {
    const peer = topo._knownPeers.get(peerId);
    if (topo._destroyed || !peer || !metrics || typeof metrics !== 'object' || Array.isArray(metrics)) return false;
    if (metrics.score != null) peer.score = _metric(metrics.score, peer.score, 0, 1000);
    if (metrics.latency != null) peer.latency = _metric(metrics.latency, peer.latency, 0, Number.MAX_SAFE_INTEGER);
    if (typeof metrics.isFastPeer === 'boolean') peer.isFastPeer = metrics.isFastPeer;
    // Update uptime
    const now = _advanceWallClock(topo);
    peer.uptime = runtimeMonotonicClockStep(now, peer.joinedAt).elapsedMs;
    // Update neighbor entry too
    const nb = topo._neighbors.get(peerId);
    if (nb) {
        nb.score = peer.score;
        nb.latency = peer.latency;
    }
    return true;
}

// ── Neighbor Selection ───────────────────────────────────────────────────────

/**
 * Compute the ideal neighbor set based on current metrics.
 * Returns { connect: string[], disconnect: string[] } — peers to add/remove.
 * @param {Object} topo
 * @returns {{ connect: string[], disconnect: string[] }}
 */
export function computeIdealNeighbors(topo) {
    if (topo._mode === TOPOLOGY.FULL_MESH) {
        // Full mesh: connect to everyone we know
        const connect = [];
        for (const [peerId, peer] of topo._knownPeers) {
            if (!peer.isConnected && !peer.isFastPeer) {
                connect.push(peerId);
            }
        }
        return { connect, disconnect: [] };
    }

    const report = neighborSelectionReport({
        peers: [...topo._knownPeers].map(([peerId, peer]) => ({ peerId, ...peer })),
        connectedPeerIds: [...topo._neighbors.keys()],
        targetDegree: _effectiveK(topo),
        requireSupernode: topo._mode === TOPOLOGY.SUPERNODE && !topo._isSupernode,
        includeFastPeers: false,
        idealLatencyMs: 10,
        badLatencyMs: 500,
        fullUptimeMinutes: 30,
    });
    return {
        connect: [...report.connectPeerIds],
        disconnect: [...report.disconnectPeerIds],
    };
}

// ── Supernode Election ───────────────────────────────────────────────────────

/**
 * Evaluate whether this peer should be a supernode.
 * Criteria: high reputation, low latency, good uptime, clean integrity, trusted.
 * Peers with violations (throttled/muted/kicked) are immediately disqualified.
 * Trust and social standing boost candidacy score.
 * @param {Object} topo
 * @param {number} selfScore - our own reputation score
 * @param {number} selfLatencyAvg - our average latency to neighbors
 * @param {Object} [integrityInfo] - { tier, trust, socialModifier } from integrity verifier
 * @returns {boolean} true if we became/remained a supernode
 */
export function evaluateSupernodeStatus(topo, selfScore, selfLatencyAvg, integrityInfo) {
    const wasSuper = topo._isSupernode;
    const tier = integrityInfo?.tier ?? 'clean';
    const report = supernodeScoreReport({
        score: _metric(selfScore, 0, 0, 1000),
        latencyMs: _metric(selfLatencyAvg, 999, 0, Number.MAX_SAFE_INTEGER),
        tier: VALID_INTEGRITY_TIERS.has(tier) ? tier : 'kicked',
        trust: _metric(integrityInfo?.trust, 0, 0, 1),
        socialModifier: _metric(integrityInfo?.socialModifier, 0, -0.3, 0.3),
        threshold: MESH_SUPERNODE_SCORE,
    });

    if (report.blockedByTier || topo._mode !== TOPOLOGY.SUPERNODE) {
        if (wasSuper) {
            console.log(`[MeshTopology] Supernode DEMOTED: integrity tier=${tier}`);
        }
        topo._isSupernode = false;
        topo._supernodeScore = 0;
        if (topo._isSupernode !== wasSuper && topo._onSupernodeElected) {
            topo._onSupernodeElected(topo.selfId, false);
        }
        return false;
    }
    topo._supernodeScore = report.supernodeScore;
    const desiredCount = clamp(Math.ceil((topo._knownPeers.size + 1) / 20), 2, 5);
    const candidates = report.eligible
        ? [{ peerId: topo.selfId, score: report.baseScore * report.tierMultiplier }]
        : [];
    for (const [peerId, peer] of topo._knownPeers) {
        const tierMultiplier = MESH_SUPERNODE_TIER_MULTIPLIER[peer.integrityTier] ?? 0;
        const locallyObservedScore = peer.score * tierMultiplier;
        if (peer.isConnected && locallyObservedScore >= MESH_SUPERNODE_SCORE) {
            candidates.push({ peerId, score: locallyObservedScore });
        }
    }
    candidates.sort((a, b) => b.score - a.score || a.peerId.localeCompare(b.peerId));
    topo._isSupernode = candidates.slice(0, desiredCount).some(candidate => candidate.peerId === topo.selfId);

    if (topo._isSupernode !== wasSuper) {
        console.log(`[MeshTopology] Supernode status: ${topo._isSupernode ? 'ELECTED' : 'STEPPED DOWN'} (score: ${topo._supernodeScore.toFixed(0)}, tier=${report.tier}, trust=${report.trust.toFixed(2)})`);
        if (topo._onSupernodeElected) {
            topo._onSupernodeElected(topo.selfId, topo._isSupernode);
        }
    }

    return topo._isSupernode;
}

/**
 * Update a peer's integrity data (called from integrity verifier tick).
 * @param {Object} topo
 * @param {string} peerId
 * @param {{ tier: string, trust: number, socialModifier: number }} info
 */
export function topologyUpdatePeerIntegrity(topo, peerId, info) {
    const peer = topo._knownPeers.get(peerId);
    if (topo._destroyed || !peer || !info || typeof info !== 'object' || Array.isArray(info)) return false;
    if (VALID_INTEGRITY_TIERS.has(info.tier)) peer.integrityTier = info.tier;
    if (info.trust != null) peer.integrityTrust = _metric(info.trust, peer.integrityTrust, 0, 1);
    if (info.socialModifier != null) peer.socialModifier = _metric(info.socialModifier, peer.socialModifier, -0.3, 0.3);
    return true;
}

/**
 * Evaluate all remote supernodes and demote any that have degraded.
 * Called during rebalance tick. Demoted supernodes are unregistered
 * and a topology change is triggered so the mesh re-routes around them.
 * @param {Object} topo
 * @returns {string[]} peerIds of demoted supernodes
 */
export function evaluateRemoteSupernodes(topo) {
    const demoted = [];
    for (const peerId of topo._supernodes) {
        const peer = topo._knownPeers.get(peerId);
        if (!peer || !peer.isConnected) {
            demoted.push(peerId);
            continue;
        }

        // Demote if integrity has degraded
        const tierMult = MESH_SUPERNODE_TIER_MULTIPLIER[peer.integrityTier] ?? 0;
        if (tierMult === 0) {
            demoted.push(peerId);
            continue;
        }

        // Demote if reputation dropped below threshold
        const effectiveScore = peer.score * tierMult;
        if (effectiveScore < MESH_SUPERNODE_SCORE * 0.8) { // 20% hysteresis
            demoted.push(peerId);
        }
    }

    for (const peerId of demoted) {
        topo._supernodes.delete(peerId);
        const peer = topo._knownPeers.get(peerId);
        if (peer) peer.isSupernode = false;
        console.log(`[MeshTopology] Remote supernode DEMOTED: ${peerId} (tier=${peer?.integrityTier}, score=${peer?.score})`);
    }

    return demoted;
}

/**
 * Register a remote peer as a supernode.
 */
export function topologyRegisterSupernode(topo, peerId, announcement = null) {
    if (topo._destroyed || !_validPeerId(peerId) || peerId === topo.selfId || !topo._knownPeers.has(peerId)) return false;
    const peer = topo._knownPeers.get(peerId);
    const tierMultiplier = MESH_SUPERNODE_TIER_MULTIPLIER[peer.integrityTier] ?? 0;
    if (!peer.isConnected || peer.score * tierMultiplier < MESH_SUPERNODE_SCORE) return false;
    if (announcement !== null) {
        const score = finiteNumberReport(announcement?.score, { min: 0, max: 2000 });
        const neighborCount = finiteNumberReport(announcement?.neighborCount, { integer: true, min: 0, max: 256 });
        const capacity = finiteNumberReport(announcement?.capacity, { integer: true, min: 0, max: 256 });
        if (!announcement || typeof announcement !== 'object' || Array.isArray(announcement) ||
            announcement.peerId !== peerId || !score.valid || !neighborCount.valid || !capacity.valid) {
            return false;
        }
    }
    topo._supernodes.add(peerId);
    peer.isSupernode = true;
    return true;
}

/**
 * Unregister a remote peer as a supernode.
 */
export function topologyUnregisterSupernode(topo, peerId) {
    if (topo._destroyed || !_validPeerId(peerId)) return false;
    topo._supernodes.delete(peerId);
    const peer = topo._knownPeers.get(peerId);
    if (peer) peer.isSupernode = false;
    return true;
}

/**
 * Validate and apply one advisory topology_info payload atomically.
 * The report may expand discovery knowledge but never mutates live routes.
 */
export function topologyApplyInfo(topo, fromPeerId, payload) {
    if (topo._destroyed || !_validPeerId(fromPeerId) || !payload || typeof payload !== 'object' || Array.isArray(payload) ||
        !Array.isArray(payload.neighbors) || payload.neighbors.length > 256 ||
        !Object.values(TOPOLOGY).includes(payload.mode) || typeof payload.isSupernode !== 'boolean') {
        return false;
    }
    const admitted = [];
    for (const neighbor of payload.neighbors) {
        const score = finiteNumberReport(neighbor?.s, { min: 0, max: 1000 });
        const latency = finiteNumberReport(neighbor?.l, { min: 0, max: Number.MAX_SAFE_INTEGER });
        if (!neighbor || typeof neighbor !== 'object' || Array.isArray(neighbor) ||
            !_validPeerId(neighbor.p) || neighbor.p === fromPeerId || !score.valid || !latency.valid) {
            return false;
        }
        if (neighbor.p !== topo.selfId) {
            admitted.push({ peerId: neighbor.p, score: score.value, latency: latency.value });
        }
    }
    for (const neighbor of admitted) {
        topologyAddPeer(topo, neighbor.peerId, neighbor);
    }
    if (payload.isSupernode) {
        const peer = topo._knownPeers.get(fromPeerId);
        if (peer) {
            topo._supernodes.add(fromPeerId);
            peer.isSupernode = true;
        }
    } else {
        topologyUnregisterSupernode(topo, fromPeerId);
    }
    return true;
}

// ── Gossip Protocol ──────────────────────────────────────────────────────────

/**
 * Generate a gossip fingerprint for deduplication.
 * Uses a compact hash of the op to avoid forwarding the same op twice.
 * @param {Object} op
 * @param {string} originPeerId - who created this op originally
 * @returns {string}
 */
export function gossipFingerprint(op, originPeerId) {
    // Combine origin + type + timestamp for uniqueness
    const fallbackTimestamp = runtimeMonotonicClockStep(Date.now(), 0).timestampMs;
    const ts = _metric(op?._gTs, fallbackTimestamp, 0, Number.MAX_SAFE_INTEGER);
    const seq = _boundedInteger(op?._gSeq, 0, 0, Number.MAX_SAFE_INTEGER);
    const origin = _validPeerId(originPeerId) ? originPeerId : '';
    const type = typeof op?.type === 'string' && op.type.length <= 128 ? op.type : '';
    return `${origin}:${type}:${ts}:${seq}`;
}

function _gossipEnvelopeReport(op) {
    const g = op?._gossip;
    const typeValid = typeof op?.type === 'string' && op.type.length > 0 && op.type.length <= 128;
    const originValid = _validPeerId(g?.origin);
    const ttl = finiteNumberReport(g?.ttl, { integer: true, min: 0, max: GOSSIP_TTL_DEFAULT });
    const hops = finiteNumberReport(g?.hops, { integer: true, min: 0, max: GOSSIP_TTL_DEFAULT });
    const timestamp = finiteNumberReport(g?.ts, { integer: true, min: 0, max: Number.MAX_SAFE_INTEGER });
    const sequence = finiteNumberReport(g?.seq, { integer: true, min: 0, max: Number.MAX_SAFE_INTEGER });
    const expectedFingerprint = originValid && typeValid && timestamp.valid && sequence.valid
        ? `${g.origin}:${op.type}:${timestamp.value}:${sequence.value}`
        : '';
    const fingerprintValid = typeof g?.fp === 'string' && g.fp.length > 0 && g.fp.length <= 512 &&
        g.fp === expectedFingerprint;
    const hopBudgetValid = ttl.valid && hops.valid && ttl.value + hops.value === GOSSIP_TTL_DEFAULT;
    return {
        valid: !!g && typeValid && originValid && ttl.valid && hops.valid && timestamp.valid && sequence.valid &&
            fingerprintValid && hopBudgetValid,
        expectedFingerprint,
    };
}

/**
 * Wrap an op for gossip propagation.
 * Adds gossip metadata: origin, TTL, hop count, fingerprint.
 * @param {Object} topo
 * @param {Object} op - the original op
 * @returns {Object} gossip-wrapped op
 */
export function gossipWrap(topo, op) {
    if (topo._destroyed) throw new Error('Cannot gossip through a destroyed topology');
    if (!op || typeof op !== 'object' || Array.isArray(op) ||
        typeof op.type !== 'string' || op.type.length === 0 || op.type.length > 128) {
        throw new TypeError('gossipWrap requires an op with a bounded string type');
    }
    if (op._gossip) {
        if (!_gossipEnvelopeReport(op).valid) throw new RangeError('Existing gossip envelope is malformed');
        return op;
    }
    const ts = _advanceWallClock(topo);
    const seq = topo._stats.gossipSent++;
    const wrapped = {
        ...op,
        _gossip: {
            origin: topo.selfId,
            ttl: GOSSIP_TTL_DEFAULT,
            hops: 0,
            ts,
            seq,
            fp: `${topo.selfId}:${op.type}:${ts}:${seq}`,
        },
    };
    topo._gossipSeen.set(wrapped._gossip.fp, ts);
    return wrapped;
}

/**
 * Process an incoming gossip-wrapped op.
 * Returns { forward: boolean, op: Object, targets: string[] }
 *   - forward: true if this op should be forwarded to neighbors
 *   - op: the op with decremented TTL
 *   - targets: peerIds to forward to (excludes sender and origin)
 * @param {Object} topo
 * @param {string} fromPeerId - who sent us this op
 * @param {Object} op - the gossip-wrapped op
 */
export function gossipReceive(topo, fromPeerId, op) {
    if (topo._destroyed) return { forward: false, op: null, targets: [], invalid: true };
    if (!op || typeof op !== 'object' || Array.isArray(op)) {
        topo._stats.gossipRejected++;
        return { forward: false, op: null, targets: [], invalid: true };
    }
    if (!op._gossip) {
        // Not a gossip op — process normally, don't forward
        return { forward: false, op, targets: [] };
    }

    if (!_validPeerId(fromPeerId) || !_gossipEnvelopeReport(op).valid) {
        topo._stats.gossipRejected++;
        return { forward: false, op: null, targets: [], invalid: true };
    }

    topo._stats.gossipReceived++;
    const g = op._gossip;

    // Dedup check
    if (topo._gossipSeen.has(g.fp)) {
        topo._stats.gossipDeduped++;
        return { forward: false, op: null, targets: [] };
    }
    if (g.origin === topo.selfId) {
        topo._stats.gossipRejected++;
        return { forward: false, op: null, targets: [], invalid: true };
    }

    // Record in dedup cache
    topo._gossipSeen.set(g.fp, _advanceWallClock(topo));

    // Track max hops
    if (g.hops > topo._stats.maxHopsObserved) {
        topo._stats.maxHopsObserved = g.hops;
    }

    // Check TTL
    if (g.ttl <= 0) {
        return { forward: false, op, targets: [] };
    }

    // Determine forward targets: all neighbors except sender and origin
    const targets = [];
    if (topo._mode !== TOPOLOGY.FULL_MESH) {
        for (const [peerId] of topo._neighbors) {
            if (peerId !== fromPeerId && peerId !== g.origin) {
                targets.push(peerId);
            }
        }
    }

    // Decrement TTL, increment hops
    const forwardOp = {
        ...op,
        _gossip: {
            ...g,
            ttl: g.ttl - 1,
            hops: g.hops + 1,
        },
    };

    return {
        forward: targets.length > 0,
        op,         // original op for local processing
        targets,    // who to forward to
        forwardOp,  // op with updated gossip metadata
    };
}

// ── Tick / Rebalance ─────────────────────────────────────────────────────────

/**
 * Start the periodic rebalance timer.
 */
export function startTopology(topo) {
    if (topo._destroyed) return false;
    stopTopology(topo);
    topo._active = true;
    topo._rebalanceTimer = setInterval(() => _rebalanceTick(topo), REBALANCE_INTERVAL);
    return true;
}

/**
 * Stop the rebalance timer.
 */
export function stopTopology(topo) {
    if (topo._rebalanceTimer) {
        clearInterval(topo._rebalanceTimer);
        topo._rebalanceTimer = null;
    }
    topo._active = false;
}

/**
 * Periodic rebalance: re-evaluate topology, prune stale gossip cache,
 * adjust neighbor set if metrics changed.
 */
function _rebalanceTick(topo) {
    if (topo._destroyed || !topo._active) return;
    topo._stats.rebalances++;

    // 1. Re-evaluate topology mode
    resolveTopology(topo);

    // 2. Evaluate remote supernodes — demote any that have degraded
    if (topo._mode === TOPOLOGY.SUPERNODE) {
        evaluateRemoteSupernodes(topo);
    }

    // 3. Prune stale gossip dedup entries
    const now = _advanceWallClock(topo);
    for (const [fp, ts] of topo._gossipSeen) {
        if (runtimeMonotonicClockStep(now, ts).elapsedMs > GOSSIP_DEDUP_TTL) {
            topo._gossipSeen.delete(fp);
        }
    }
    // Hard cap on dedup cache size
    if (topo._gossipSeen.size > GOSSIP_DEDUP_SIZE) {
        const entries = [...topo._gossipSeen.entries()].sort((a, b) => a[1] - b[1]);
        const toRemove = entries.slice(0, entries.length - GOSSIP_DEDUP_SIZE);
        for (const [fp] of toRemove) topo._gossipSeen.delete(fp);
    }

    // 4. Compute ideal neighbors and request connection changes
    //    The neighbor scoring now factors in integrity, so bad peers
    //    are naturally deprioritized without explicit disconnection.
    if (topo._mode !== TOPOLOGY.FULL_MESH) {
        const { connect, disconnect } = computeIdealNeighbors(topo);
        for (const peerId of connect) {
            if (topo._onConnectPeer) topo._onConnectPeer(peerId);
        }
        for (const peerId of disconnect) {
            if (topo._onDisconnectPeer) topo._onDisconnectPeer(peerId);
        }
    }
}

// ── Query ────────────────────────────────────────────────────────────────────

/**
 * Get current topology mode.
 */
export function getTopologyMode(topo) {
    return topo._mode;
}

/**
 * Check if we should use gossip forwarding (partial/supernode mode).
 */
export function shouldGossip(topo) {
    return topo._mode !== TOPOLOGY.FULL_MESH;
}

/**
 * Check if we're a supernode.
 */
export function isSupernode(topo) {
    return topo._isSupernode;
}

/**
 * Get the list of our current neighbor peerIds.
 */
export function getNeighborIds(topo) {
    return [...topo._neighbors.keys()];
}

/**
 * Get topology stats for UI display.
 */
export function getTopologyStats(topo) {
    const webrtcPeers = _countWebRTCPeers(topo);
    return {
        mode: topo._mode,
        totalPeers: topo._knownPeers.size,
        webrtcPeers,
        fastPeers: topo._knownPeers.size - webrtcPeers,
        neighborCount: topo._neighbors.size,
        k: _effectiveK(topo),
        isSupernode: topo._isSupernode,
        supernodeCount: topo._supernodes.size,
        supernodeScore: topo._supernodeScore,
        ...topo._stats,
    };
}

/**
 * Build a supernode announcement op to broadcast.
 * Peers use this to discover supernodes.
 */
export function buildSupernodeAnnounce(topo) {
    if (!topo._isSupernode) return null;
    return {
        type: 'supernode_announce',
        payload: {
            peerId: topo.selfId,
            score: topo._supernodeScore,
            neighborCount: topo._neighbors.size,
            capacity: clamp(topo._kSupernode - topo._neighbors.size, 0, topo._kSupernode),
        },
    };
}

/**
 * Build a topology_info op for neighbor exchange.
 * Peers periodically share their neighbor lists so the mesh
 * can discover better paths (inspired by BGP route sharing).
 */
export function buildTopologyInfoOp(topo) {
    const neighbors = [];
    for (const [peerId, nb] of topo._neighbors) {
        neighbors.push({ p: peerId, s: nb.score, l: nb.latency });
    }
    return {
        type: 'topology_info',
        payload: {
            mode: topo._mode,
            isSupernode: topo._isSupernode,
            neighbors,
        },
    };
}

// ── Cleanup ──────────────────────────────────────────────────────────────────

/**
 * Destroy the topology manager.
 */
export function destroyMeshTopology(topo) {
    stopTopology(topo);
    topo._knownPeers.clear();
    topo._neighbors.clear();
    topo._supernodes.clear();
    topo._gossipSeen.clear();
    topo._mode = TOPOLOGY.FULL_MESH;
    topo._isSupernode = false;
    topo._supernodeScore = 0;
    topo._lastWallClockMs = 0;
    topo._destroyed = true;
    Object.assign(topo._stats, _createStats());
    topo._onConnectPeer = null;
    topo._onDisconnectPeer = null;
    topo._onTopologyChange = null;
    topo._onSupernodeElected = null;
}

/** Run one topology rebalance immediately (useful after discovery/metrics changes). */
export function rebalanceTopologyNow(topo) {
    if (topo?._destroyed) return false;
    const wasActive = topo._active;
    topo._active = true;
    _rebalanceTick(topo);
    topo._active = wasActive;
    return true;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function _countWebRTCPeers(topo) {
    let count = 0;
    for (const [, peer] of topo._knownPeers) {
        if (!peer.isFastPeer) count++;
    }
    return count;
}
