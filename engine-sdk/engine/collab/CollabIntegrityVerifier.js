// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * CollabIntegrityVerifier.js
 * Integrity validation and anomaly tracking for P2P collab.
 *
 * Inspired by:
 *   - Hash-chain receipts: valid ops contribute to a local rolling chain.
 *   - Server-side validation rules adapted to pairwise peer validation.
 *   - Lockstep P2P: periodic state hashing — all peers hash their zone state
 *     and exchange hashes for pairwise divergence detection.
 *   - FairPlay: operation whitelist — only registered op types are accepted.
 *     Unknown op types are rejected and penalized.
 *
 * Components:
 *   1. Op Receipt Chain — local rolling hash chain per peer
 *   2. Zone State Digest — periodic position hash for pairwise comparison
 *   3. Anomaly Detector — physics/spatial rule violations
 *   4. Operation Whitelist — only valid op types accepted
 *   5. Violation Tracker — accumulates strikes, triggers auto-kick
 *   6. Reputation Integration — violations lower peer score
 *
 * Hashes preserve the existing non-cryptographic legacy FNV-like wire format.
 */

import {
    checksumHex32,
    legacyFnv1aStringHash32,
} from '../core/math/ChecksumMath.js';
import { runtimeMonotonicClockStep } from '../core/math/FrameMath.js';
import { clamp } from '../core/math/MathScalar.js';
import { statsMean } from '../core/math/MathStatistics.js';
import { finiteArrayReport, finiteNumberReport } from '../core/math/MathValidation.js';

// ── Constants ────────────────────────────────────────────────────────────────────────

const STATE_DIGEST_INTERVAL_MS = 2000;  // exchange zone hashes at ~0.5Hz
const DIGEST_MISMATCH_GRACE   = 8;     // allow N mismatches before flagging (desync tolerance)
const VIOLATION_DECAY_MS       = 60000; // violations decay after 1 minute
const MAX_TELEPORT_DIST        = 100;   // max units an entity can move in one tick
const MAX_VELOCITY             = 500;   // max velocity magnitude (units/sec)
const CHAIN_WINDOW             = 100;   // keep last N op hashes per peer

// Trust: builds 0→1.0 over this duration of clean behavior
const TRUST_FULL_MS            = 600000; // 10 minutes to full trust
const TRUST_DECAY_ON_VIOLATION = 0.15;   // trust lost per violation event
const TRUST_MAX_MITIGATION     = 0.5;    // max severity reduction from trust (50%)

// Play mode context: violations during physics sim are weighted less
const PLAY_MODE_SEVERITY_SCALE = 0.4;   // 40% weight in play mode

// ── Graduated Response Tiers ──────────────────────────────────────────────────────
// Points accumulate from violations. Higher tiers = harsher response.
// Each tier is a *chance buffer* — peer stays in that tier until points push
// them to the next one. Points decay over time, so good behavior recovers.
const TIER_CLEAN     = 'clean';      // 0-14 pts   — no action
const TIER_WARNING   = 'warning';    // 15-34 pts  — console warning, UI yellow
const TIER_THROTTLED = 'throttled';  // 35-59 pts  — sample non-critical ops
const TIER_MUTED     = 'muted';      // 60-89 pts  — block scene edits, presence only
const TIER_KICKED    = 'kicked';     // 90+ pts    — auto-kick (host only)

const TIER_THRESHOLDS = [
    { tier: TIER_KICKED,    minPoints: 90 },
    { tier: TIER_MUTED,     minPoints: 60 },
    { tier: TIER_THROTTLED, minPoints: 35 },
    { tier: TIER_WARNING,   minPoints: 15 },
    { tier: TIER_CLEAN,     minPoints: 0 },
];

// Violation severity weights (added to violation count)
const SEVERITY = {
    INFO:     0,    // logged but not penalized
    LOW:      1,    // minor — e.g., slightly out-of-bounds
    MEDIUM:   3,    // suspicious — e.g., teleport, bad hash
    HIGH:     5,    // definite cheat — e.g., forged authority, impossible state
    CRITICAL: 10,   // instant-kick — e.g., broken chain, mass exploit
};

// Reputation penalty per violation severity (subtracted from score)
const REP_PENALTY = {
    INFO:     0,
    LOW:      5,
    MEDIUM:   25,
    HIGH:     75,
    CRITICAL: 200,
};

// ── Social Influence ──────────────────────────────────────────────────────────
// Nearby peers’ reputation scores influence each other.
// A cluster of bad actors drags everyone’s effective score down.
// A cluster of good actors boosts everyone’s effective score up.
const SOCIAL_BAD_THRESHOLD     = 400;   // avg peer score below this = negative influence
const SOCIAL_GOOD_THRESHOLD    = 700;   // avg peer score above this = positive influence
const SOCIAL_PENALTY_SCALE     = 1.5;   // bad cluster: violations hit 1.5x harder
const SOCIAL_BONUS_SCALE       = 0.7;   // good cluster: violations hit at 0.7x

// ── Registered Operation Whitelist ───────────────────────────────────────────
// Only these op types are accepted from remote peers. Anything else is rejected.

const VALID_OP_TYPES = new Set([
    // Core
    'snapshot', '__ping__', '__pong__', '__kick__', '__rep_ping__', '__rep_pong__',
    // Backward-compatible variants (single-underscore prefix from older versions)
    '_rep_ping__', '_rep_pong__', '_ping__', '_pong__',
    // Play sync
    'play_sync', 'sim_heartbeat',
    // Transforms
    'play_transforms', 'play_grab_force',
    // PBD
    'play_pbd_state',
    // Camera
    'camera_sync',
    // Authority
    'entity_authority', 'zone_handoff',
    // Scene ops
    'create', 'delete', 'transform', 'property', 'parent', 'component',
    'rename', 'duplicate', 'batch',
    // Integrity
    'integrity_digest', 'integrity_challenge',
    // Mesh topology
    'supernode_announce', 'topology_info',
    // Host migration
    'host_election', 'peer_goodbye',
    // Message chunking (large payloads split by CollabCore)
    '__chunk__',
    // Cryptographic identity & signed reputation receipts
    '__score_report__',
    // Anonymous relay garlic-encrypted messages
    '__garlic__',
    // Anonymous credential protocol (KVAC-inspired session keys)
    '__anon_session_seed__', '__anon_credential__', '__anon_keylist__', '__anon_score_report__',
    // Capability exchange (version negotiation)
    '__capabilities__',
]);

// Deliberate gaps in the current protocol: receipt heads are not exchanged or
// authenticated, digests are pairwise position-only comparisons rather than a
// majority/full-state consensus, and integrity_challenge has no handler yet.

/**
 * Preserve the existing integrity-chain FNV-like string hash.
 * This intentionally keeps the old JavaScript-number multiply path instead of
 * switching to canonical Math.imul FNV-1a, which would change peer digests.
 * @param {string} str
 * @returns {string} 8-character hex hash
 */
export function collabIntegrityLegacyHash(str) {
    return checksumHex32(legacyFnv1aStringHash32(str));
}

function _advanceWallClock(verifier) {
    const clock = runtimeMonotonicClockStep(Date.now(), verifier._lastWallClockMs);
    verifier._lastWallClockMs = clock.timestampMs;
    return clock.timestampMs;
}

function _nonnegativeConfig(value, fallback) {
    if (value === undefined || value === null) return fallback;
    const report = finiteNumberReport(value, { min: 0 });
    return report.valid ? report.value : fallback;
}

function _createStats() {
    return {
        opsValidated: 0,
        opsRejected: 0,
        digestsExchanged: 0,
        digestMismatches: 0,
        violationsTotal: 0,
        autoKicks: 0,
    };
}

// ── State ────────────────────────────────────────────────────────────────────

/**
 * Create an integrity verifier.
 * @param {string} selfId
 * @param {Object} [config]
 * @returns {Object} verifier state
 */
export function createIntegrityVerifier(selfId, config = {}) {
    return {
        selfId,
        _config: {
            maxTeleportDist: _nonnegativeConfig(config.maxTeleportDist, MAX_TELEPORT_DIST),
            maxVelocity: _nonnegativeConfig(config.maxVelocity, MAX_VELOCITY),
            digestInterval: _nonnegativeConfig(config.digestInterval, STATE_DIGEST_INTERVAL_MS),
        },

        // Per-peer op hash chains: peerId -> { prevHash, chain: string[], seqNum }
        _chains: new Map(),

        // Per-peer violation tracking: peerId -> { count, violations[], lastDecay }
        _violations: new Map(),

        // Per-peer last known entity positions: peerId -> Map<entityId, {x,z,ts}>
        _lastPositions: new Map(),

        // Zone state digests: peerId -> { hash, timestamp, entityCount }
        _peerDigests: new Map(),

        // Our own last digest
        _selfDigest: null,
        _lastDigestMs: 0,
        _lastWallClockMs: 0,

        // Context flag: set to true when editor is in play mode
        _isPlayMode: false,

        // Callbacks
        _onViolation: config.onViolation || null,    // (peerId, violation) => void
        _onAutoKick: config.onAutoKick || null,       // (peerId, reason) => void
        _onRepPenalty: config.onRepPenalty || null,    // (peerId, penalty) => void
        _onTierChange: config.onTierChange || null,   // (peerId, tier, peerViol) => void

        // Per-peer capabilities: peerId -> { opTypes: Set, version: string, ts: number }
        _peerCapabilities: new Map(),
        _selfVersion: '',

        // Stats
        _stats: _createStats(),
    };
}

// ── Op Receipt Chain ─────────────────────────────────────────────────────────

/**
 * Validate an incoming op from a peer. Checks:
 *   1. Op type is in the whitelist
 *   2. Op has valid structure
 *   3. Entity position changes are within physics limits
 * @returns {{ valid: boolean, violation?: Object }}
 */
export function validateIncomingOp(verifier, peerId, op) {
    if (!op || !op.type) {
        return _reject(verifier, peerId, 'MALFORMED_OP', 'Op has no type', SEVERITY.MEDIUM);
    }

    verifier._stats.opsValidated++;

    // 1. Whitelist check — unknown ops from version-mismatched peers are INFO, not HIGH
    if (!VALID_OP_TYPES.has(op.type)) {
        const peerCaps = verifier._peerCapabilities.get(peerId);
        // If peer declared capabilities and the op IS in their declared set,
        // this is a version mismatch (they have features we don't). Downgrade to INFO.
        // If peer has NO declared capabilities, also be lenient (old client).
        const isVersionMismatch = !peerCaps || (peerCaps.opTypes && peerCaps.opTypes.has(op.type));
        const severity = isVersionMismatch ? SEVERITY.INFO : SEVERITY.HIGH;
        if (severity === SEVERITY.INFO) {
            // Just skip silently — don't accumulate points for version differences
            verifier._stats.opsRejected++;
            return { valid: false, violation: { code: 'UNKNOWN_OP_TYPE', message: `Ignoring unknown op from version-mismatched peer: ${op.type}`, severity: 0 } };
        }
        return _reject(verifier, peerId, 'UNKNOWN_OP_TYPE', `Unregistered op type: ${op.type}`, severity);
    }

    // 2. Transform validation — check for teleportation / impossible movement
    if (op.type === 'play_transforms' && op.payload?.transforms) {
        const teleportCheck = _validateTransforms(verifier, peerId, op.payload.transforms);
        if (!teleportCheck.valid) return teleportCheck;
    }

    // 3. Authority validation — check for unauthorized claims
    if (op.type === 'entity_authority' && op.payload) {
        const authCheck = _validateAuthority(verifier, peerId, op.payload);
        if (!authCheck.valid) return authCheck;
    }

    if (op.type === 'zone_handoff') {
        const handoffCheck = _validateZoneHandoff(verifier, peerId, op.payload);
        if (!handoffCheck.valid) return handoffCheck;
    }

    if (op.type === 'integrity_digest') {
        const digestCheck = _validateDigest(verifier, peerId, op.payload);
        if (!digestCheck.valid) return digestCheck;
    }

    return { valid: true };
}

/**
 * Record an op in the peer's hash chain for tamper-evidence.
 * Call after validateIncomingOp succeeds.
 * @param {Object} verifier
 * @param {string} peerId
 * @param {Object} op
 */
export function recordOpInChain(verifier, peerId, op) {
    let chain = verifier._chains.get(peerId);
    if (!chain) {
        chain = { prevHash: '0', hashes: [], seqNum: 0 };
        verifier._chains.set(peerId, chain);
    }

    // Hash: H(prevHash + opType + seqNum)
    const input = chain.prevHash + ':' + op.type + ':' + chain.seqNum;
    const hash = collabIntegrityLegacyHash(input);
    chain.prevHash = hash;
    chain.hashes.push(hash);
    chain.seqNum++;

    // Sliding window
    if (chain.hashes.length > CHAIN_WINDOW) {
        chain.hashes.shift();
    }
}

/**
 * Get the current chain head hash for a peer (for verification exchange).
 */
export function getChainHead(verifier, peerId) {
    const chain = verifier._chains.get(peerId);
    return chain ? chain.prevHash : '0';
}

// ── Zone State Digest ────────────────────────────────────────────────────────

/**
 * Compute a hash digest of all entity positions in the caller's zone.
 * This is exchanged with peers for consensus-based state verification.
 * @param {Object} verifier
 * @param {Map} sceneEntities - editor.scene.entities
 * @param {Object} ecsWorld
 * @param {Function} getEntityComponent
 * @param {Set} [authoritySet] - only include entities in our authority zone
 * @returns {{ hash: string, entityCount: number, timestamp: number }|null}
 */
export function computeZoneDigest(verifier, sceneEntities, ecsWorld, getEntityComponent, authoritySet) {
    const now = _advanceWallClock(verifier);
    if (runtimeMonotonicClockStep(now, verifier._lastDigestMs).elapsedMs < verifier._config.digestInterval) return null;
    verifier._lastDigestMs = now;

    if (!sceneEntities || sceneEntities.size === 0) return null;

    // Build a deterministic sorted string of entity positions
    const parts = [];
    for (const [entityId] of sceneEntities) {
        if (authoritySet && !authoritySet.has(entityId)) continue;
        const t = getEntityComponent(ecsWorld, entityId, 'Transform');
        const position = finiteArrayReport(t?.position, { expectedLength: 3 });
        if (!position.valid) continue;
        // Quantize to 3 decimal places for floating-point tolerance
        const x = Math.round(t.position[0] * 1000);
        const y = Math.round(t.position[1] * 1000);
        const z = Math.round(t.position[2] * 1000);
        parts.push(`${entityId}:${x},${y},${z}`);
    }
    parts.sort(); // deterministic order

    const hash = collabIntegrityLegacyHash(parts.join('|'));
    const digest = { hash, entityCount: parts.length, timestamp: now };
    verifier._selfDigest = digest;
    return digest;
}

/**
 * Build an integrity_digest op to broadcast.
 */
export function buildDigestOp(verifier) {
    if (!verifier._selfDigest) return null;
    return {
        type: 'integrity_digest',
        payload: {
            hash: verifier._selfDigest.hash,
            entityCount: verifier._selfDigest.entityCount,
            timestamp: verifier._selfDigest.timestamp,
        },
    };
}

/**
 * Handle an incoming integrity_digest from a remote peer.
 * Compares against our own digest — mismatch indicates desync or tampering.
 * @returns {{ match: boolean, mismatch?: Object }}
 */
export function onRemoteDigest(verifier, peerId, digestOp) {
    if (!digestOp?.payload) return { match: true };

    const report = _digestPayloadReport(digestOp.payload);
    if (!report.valid) return { match: false, invalid: true };
    const remote = {
        hash: digestOp.payload.hash,
        entityCount: digestOp.payload.entityCount,
        timestamp: digestOp.payload.timestamp,
    };
    verifier._peerDigests.set(peerId, remote);
    verifier._stats.digestsExchanged++;

    // Compare with our own digest
    if (!verifier._selfDigest) return { match: true }; // we haven't computed yet

    // Only compare if entity counts are close (different zones = different counts)
    const countDiff = Math.abs(remote.entityCount - verifier._selfDigest.entityCount);
    if (countDiff > verifier._selfDigest.entityCount * 0.5) {
        // Different zone coverage — can't meaningfully compare
        return { match: true };
    }

    // If peer has different capabilities (version mismatch), be extra lenient with digests
    const peerCaps = verifier._peerCapabilities.get(peerId);
    const capsMismatch = peerCaps && peerCaps.version && peerCaps.version !== (verifier._selfVersion || '');
    const effectiveGrace = capsMismatch ? DIGEST_MISMATCH_GRACE * 4 : DIGEST_MISMATCH_GRACE;

    if (remote.hash !== verifier._selfDigest.hash) {
        verifier._stats.digestMismatches++;

        // Track consecutive mismatches per peer
        let peerViol = verifier._violations.get(peerId);
        if (!peerViol) {
            peerViol = _createViolationState(_advanceWallClock(verifier));
            verifier._violations.set(peerId, peerViol);
        }
        peerViol._digestMismatches = (peerViol._digestMismatches || 0) + 1;

        if (peerViol._digestMismatches > effectiveGrace) {
            _addViolation(verifier, peerId, 'DIGEST_MISMATCH',
                `Zone state hash mismatch (${peerViol._digestMismatches}x): local=${verifier._selfDigest.hash} remote=${remote.hash}`,
                SEVERITY.MEDIUM);
            return { match: false, mismatch: { local: verifier._selfDigest.hash, remote: remote.hash } };
        }
    } else {
        // Reset mismatch counter on match
        const peerViol = verifier._violations.get(peerId);
        if (peerViol) peerViol._digestMismatches = 0;
    }

    return { match: true };
}

// ── Anomaly Detection ────────────────────────────────────────────────────────

function _validateTransforms(verifier, peerId, transforms) {
    if (!Array.isArray(transforms)) {
        return _reject(verifier, peerId, 'MALFORMED_TRANSFORMS',
            'Transform payload must be an array', SEVERITY.MEDIUM);
    }
    const admitted = [];
    for (const t of transforms) {
        if (!t || t.id == null) continue;
        const pos = t.p; // [x, y, z]
        if (!finiteArrayReport(pos, { expectedLength: 3 }).valid) {
            return _reject(verifier, peerId, 'MALFORMED_TRANSFORM_POSITION',
                `Entity ${t.id} has a non-finite position`, SEVERITY.MEDIUM);
        }
        if (t.v != null && !finiteArrayReport(t.v, { expectedLength: 3 }).valid) {
            return _reject(verifier, peerId, 'MALFORMED_TRANSFORM_VELOCITY',
                `Entity ${t.id} has a non-finite velocity`, SEVERITY.MEDIUM);
        }
        admitted.push(t);
    }

    let lastPosMap = verifier._lastPositions.get(peerId);
    if (!lastPosMap) {
        lastPosMap = new Map();
        verifier._lastPositions.set(peerId, lastPosMap);
    }

    const now = _advanceWallClock(verifier);
    for (const t of admitted) {
        const pos = t.p;

        const last = lastPosMap.get(t.id);
        if (last) {
            const dx = pos[0] - last.x;
            const dz = pos[2] - last.z;
            const dist = Math.sqrt(dx * dx + dz * dz);

            // Teleport detection
            if (dist > verifier._config.maxTeleportDist) {
                _addViolation(verifier, peerId, 'TELEPORT',
                    `Entity ${t.id} moved ${dist.toFixed(1)} units in one tick (max: ${verifier._config.maxTeleportDist})`,
                    SEVERITY.MEDIUM);
                // Don't reject the whole batch — just flag it
            }
        }

        // Velocity check
        if (t.v) {
            const vMag = Math.sqrt(t.v[0] * t.v[0] + (t.v[1] || 0) * (t.v[1] || 0) + (t.v[2] || 0) * (t.v[2] || 0));
            if (vMag > verifier._config.maxVelocity) {
                _addViolation(verifier, peerId, 'EXCESSIVE_VELOCITY',
                    `Entity ${t.id} velocity ${vMag.toFixed(1)} exceeds max ${verifier._config.maxVelocity}`,
                    SEVERITY.LOW);
            }
        }

        // Update last known position
        lastPosMap.set(t.id, { x: pos[0], z: pos[2], ts: now });
    }

    return { valid: true };
}

function _validateAuthority(verifier, peerId, payload) {
    // Authority claims must have valid structure
    if (!payload.entityId && !payload.entities) {
        return _reject(verifier, peerId, 'MALFORMED_AUTHORITY',
            'Authority op missing entityId', SEVERITY.LOW);
    }

    // Sequence numbers must be positive
    if (payload.seq != null) {
        const sequence = finiteNumberReport(payload.seq, {
            integer: true,
            min: 0,
            max: Number.MAX_SAFE_INTEGER,
        });
        if (!sequence.valid) {
            return _reject(verifier, peerId, 'INVALID_SEQ',
                `Authority op has invalid sequence: ${payload.seq}`, SEVERITY.HIGH);
        }
    }

    return { valid: true };
}

function _validateZoneHandoff(verifier, peerId, payload) {
    if (!payload || payload.entityId == null || typeof payload.fromPeer !== 'string' ||
        typeof payload.toPeer !== 'string' || !payload.fromPeer || !payload.toPeer) {
        return _reject(verifier, peerId, 'MALFORMED_HANDOFF',
            'Zone handoff is missing entity or peer ownership fields', SEVERITY.HIGH);
    }
    const sequence = finiteNumberReport(payload.seq, {
        integer: true,
        min: 1,
        max: Number.MAX_SAFE_INTEGER,
    });
    if (!sequence.valid) {
        return _reject(verifier, peerId, 'INVALID_SEQ',
            `Zone handoff has invalid sequence: ${payload.seq}`, SEVERITY.HIGH);
    }
    if (payload.state != null && (typeof payload.state !== 'object' || Array.isArray(payload.state))) {
        return _reject(verifier, peerId, 'MALFORMED_HANDOFF_STATE',
            'Zone handoff state must be an object', SEVERITY.HIGH);
    }
    return { valid: true };
}

function _digestPayloadReport(payload) {
    const hashValid = typeof payload?.hash === 'string' && /^[0-9a-f]{8}$/.test(payload.hash);
    const count = finiteNumberReport(payload?.entityCount, {
        integer: true,
        min: 0,
        max: Number.MAX_SAFE_INTEGER,
    });
    const timestamp = finiteNumberReport(payload?.timestamp, { min: 0 });
    return { valid: hashValid && count.valid && timestamp.valid, hashValid, count, timestamp };
}

function _validateDigest(verifier, peerId, payload) {
    if (!_digestPayloadReport(payload).valid) {
        return _reject(verifier, peerId, 'MALFORMED_DIGEST',
            'Integrity digest requires an 8-hex hash, safe entity count, and finite timestamp',
            SEVERITY.MEDIUM);
    }
    return { valid: true };
}

// ── Violation Tracking ───────────────────────────────────────────────────────

function _createViolationState(now) {
    return {
        count: 0,
        violations: [],
        lastDecay: now,
        _digestMismatches: 0,
        // Trust: 0.0 (new/untrusted) → 1.0 (fully trusted)
        trust: 0.0,
        trustStartMs: now,
        lastCleanMs: now,
        lastTrustUpdateMs: now,
        // Graduated response
        tier: TIER_CLEAN,
        tierChangedAt: now,
        // Social influence modifier: -0.3 (bad cluster) to +0.3 (good cluster)
        socialModifier: 0.0,
        // Chances given at each tier (for logging)
        warningsGiven: 0,
        throttleCount: 0,
        muteCount: 0,
    };
}

/**
 * Compute the current tier for a peer based on their violation points.
 */
function _computeTier(count) {
    for (const t of TIER_THRESHOLDS) {
        if (count >= t.minPoints) return t.tier;
    }
    return TIER_CLEAN;
}

function _addViolation(verifier, peerId, code, message, severity) {
    const now = _advanceWallClock(verifier);
    let peerViol = verifier._violations.get(peerId);
    if (!peerViol) {
        peerViol = _createViolationState(now);
        verifier._violations.set(peerId, peerViol);
    }

    // ── Trust mitigation: higher trust reduces effective severity ──
    // A fully trusted peer gets violations at (1 - 0.5) = 50% weight.
    // New/untrusted peers get full severity.
    const trustReduction = peerViol.trust * TRUST_MAX_MITIGATION;
    let effectiveSeverity = severity * (1.0 - trustReduction);

    // ── Play mode context: physics divergence is expected ──
    if (verifier._isPlayMode) {
        effectiveSeverity *= PLAY_MODE_SEVERITY_SCALE;
    }

    // ── Social influence: bad clusters amplify, good clusters dampen ──
    if (peerViol.socialModifier < 0) {
        // Negative social environment — violations hit harder
        effectiveSeverity *= SOCIAL_PENALTY_SCALE * (1 + Math.abs(peerViol.socialModifier));
    } else if (peerViol.socialModifier > 0) {
        // Positive social environment — violations are dampened
        effectiveSeverity *= SOCIAL_BONUS_SCALE * (1 - peerViol.socialModifier * 0.3);
    }

    // Floor: at least 0.1 points per non-INFO violation
    effectiveSeverity = severity > 0 ? Math.max(0.1, effectiveSeverity) : 0;

    const violation = {
        code,
        message,
        severity,
        effectiveSeverity: Math.round(effectiveSeverity * 100) / 100,
        timestamp: now,
    };

    peerViol.violations.push(violation);
    peerViol.count += effectiveSeverity;
    verifier._stats.violationsTotal++;

    // Trust decays on each violation
    peerViol.trust = clamp(peerViol.trust - TRUST_DECAY_ON_VIOLATION * (severity / SEVERITY.MEDIUM), 0, 1);
    peerViol.lastCleanMs = now; // reset clean timer
    peerViol.lastTrustUpdateMs = now;

    // Keep violations log bounded
    if (peerViol.violations.length > 50) {
        peerViol.violations = peerViol.violations.slice(-30);
    }

    // ── Compute new tier ──
    const oldTier = peerViol.tier;
    peerViol.tier = _computeTier(peerViol.count);
    if (peerViol.tier !== oldTier) {
        peerViol.tierChangedAt = now;
    }

    // Fire violation callback with tier info
    violation.tier = peerViol.tier;
    violation.trust = Math.round(peerViol.trust * 100) / 100;
    violation.totalPoints = Math.round(peerViol.count * 10) / 10;
    if (verifier._onViolation) {
        verifier._onViolation(peerId, violation);
    }

    // Reputation penalty
    const penalty = REP_PENALTY[_severityName(severity)] || 0;
    if (penalty > 0 && verifier._onRepPenalty) {
        verifier._onRepPenalty(peerId, penalty);
    }

    // ── Graduated response ──
    if (peerViol.tier === TIER_WARNING && oldTier === TIER_CLEAN) {
        peerViol.warningsGiven++;
        console.warn(`[Integrity] WARNING #${peerViol.warningsGiven} for ${peerId}: ${code} (${peerViol.count.toFixed(1)} pts, trust=${peerViol.trust.toFixed(2)})`);
        if (verifier._onTierChange) verifier._onTierChange(peerId, TIER_WARNING, peerViol);
    } else if (peerViol.tier === TIER_THROTTLED && oldTier !== TIER_THROTTLED && oldTier !== TIER_MUTED && oldTier !== TIER_KICKED) {
        peerViol.throttleCount++;
        console.warn(`[Integrity] THROTTLED ${peerId}: ${code} (${peerViol.count.toFixed(1)} pts)`);
        if (verifier._onTierChange) verifier._onTierChange(peerId, TIER_THROTTLED, peerViol);
    } else if (peerViol.tier === TIER_MUTED && oldTier !== TIER_MUTED && oldTier !== TIER_KICKED) {
        peerViol.muteCount++;
        console.warn(`[Integrity] MUTED ${peerId}: ${code} (${peerViol.count.toFixed(1)} pts)`);
        if (verifier._onTierChange) verifier._onTierChange(peerId, TIER_MUTED, peerViol);
    } else if (peerViol.tier === TIER_KICKED) {
        verifier._stats.autoKicks++;
        const reason = `Graduated to KICK tier (${peerViol.count.toFixed(1)} pts, trust=${peerViol.trust.toFixed(2)}, social=${peerViol.socialModifier.toFixed(2)}): last=${code}`;
        console.warn(`[Integrity] AUTO-KICK ${peerId}: ${reason}`);
        if (verifier._onAutoKick) {
            verifier._onAutoKick(peerId, reason);
        }
    }
}

function _reject(verifier, peerId, code, message, severity) {
    verifier._stats.opsRejected++;
    _addViolation(verifier, peerId, code, message, severity);
    return { valid: false, violation: { code, message, severity } };
}

function _severityName(sev) {
    if (sev >= SEVERITY.CRITICAL) return 'CRITICAL';
    if (sev >= SEVERITY.HIGH) return 'HIGH';
    if (sev >= SEVERITY.MEDIUM) return 'MEDIUM';
    if (sev >= SEVERITY.LOW) return 'LOW';
    return 'INFO';
}

// ── Tick ─────────────────────────────────────────────────────────────────────

/**
 * Tick the verifier: decay violations, build trust, compute social influence.
 * Call at ~1Hz.
 * @param {Object} verifier
 * @param {Object} [peerReputation] - optional CollabPeerReputation state for social influence
 */
export function tickIntegrity(verifier, peerReputation) {
    const now = _advanceWallClock(verifier);

    // Compute social influence from peer reputation scores
    if (peerReputation) {
        _updateSocialInfluence(verifier, peerReputation);
    }

    for (const [peerId, peerViol] of verifier._violations) {
        // ── Trust building: grows during clean behavior ──
        const cleanDuration = runtimeMonotonicClockStep(now, peerViol.lastCleanMs).elapsedMs;
        const previousCleanDuration = runtimeMonotonicClockStep(peerViol.lastTrustUpdateMs, peerViol.lastCleanMs).elapsedMs;
        const trustEligibleMs = Math.max(0, cleanDuration - 10000);
        const previousEligibleMs = Math.max(0, previousCleanDuration - 10000);
        const trustElapsedMs = Math.max(0, trustEligibleMs - previousEligibleMs);
        peerViol.lastTrustUpdateMs = now;
        if (trustElapsedMs > 0) {
            // Trust grows faster in a good social environment
            const socialBoost = Math.max(0, peerViol.socialModifier) * 0.5 + 1.0;
            const trustGain = (trustElapsedMs / TRUST_FULL_MS) * socialBoost;
            peerViol.trust = clamp(peerViol.trust + trustGain, 0, 1);
        }

        // ── Violation decay ──
        if (runtimeMonotonicClockStep(now, peerViol.lastDecay).elapsedMs >= VIOLATION_DECAY_MS) {
            // Decay rate scales with trust and social standing
            // High trust + good social = faster decay (more forgiveness)
            // Low trust + bad social = slower decay (less forgiveness)
            const trustDecayBonus = 1.0 + peerViol.trust * 0.5;  // 1.0-1.5x
            const socialDecayBonus = peerViol.socialModifier > 0
                ? 1.0 + peerViol.socialModifier * 0.5  // good social: 1.0-1.15x faster
                : 1.0 / (1.0 + Math.abs(peerViol.socialModifier) * 0.5); // bad social: slower
            const decayAmount = 2.0 * trustDecayBonus * socialDecayBonus;
            peerViol.count = Math.max(0, peerViol.count - decayAmount);
            peerViol.lastDecay = now;

            // Update tier after decay
            const oldTier = peerViol.tier;
            peerViol.tier = _computeTier(peerViol.count);
            if (peerViol.tier !== oldTier) {
                peerViol.tierChangedAt = now;
                if (verifier._onTierChange) verifier._onTierChange(peerId, peerViol.tier, peerViol);
            }

            // Prune old violations
            peerViol.violations = peerViol.violations.filter(
                v => runtimeMonotonicClockStep(now, v.timestamp).elapsedMs < VIOLATION_DECAY_MS * 5
            );
        }

        // Remove peer entry if fully decayed and trusted
        if (peerViol.count === 0 && peerViol.violations.length === 0 && peerViol.trust >= 0.5) {
            verifier._violations.delete(peerId);
        }
    }
}

/**
 * Update social influence modifiers based on peer reputation scores.
 * Bad clusters: if the average reputation of all peers is low, each peer's
 * socialModifier goes negative → violations hit harder, decay is slower.
 * Good clusters: if average is high, socialModifier goes positive → more forgiveness.
 */
function _updateSocialInfluence(verifier, peerReputation) {
    if (!peerReputation?._peers || peerReputation._peers.size === 0) return;

    // Compute the room-wide average reputation score
    const scores = [];
    for (const [, m] of peerReputation._peers) {
        const score = finiteNumberReport(m.score, { min: 0, max: 1000 });
        if (score.valid) scores.push(score.value);
    }
    if (scores.length === 0) return;
    const avgScore = statsMean(scores);

    // Compute a global social modifier: -0.3 to +0.3
    let globalMod = 0;
    if (avgScore < SOCIAL_BAD_THRESHOLD) {
        // Bad cluster: linear scale from 0 at threshold to -0.3 at 0
        globalMod = -0.3 * (1 - avgScore / SOCIAL_BAD_THRESHOLD);
    } else if (avgScore > SOCIAL_GOOD_THRESHOLD) {
        // Good cluster: linear scale from 0 at threshold to +0.3 at 1000
        globalMod = 0.3 * ((avgScore - SOCIAL_GOOD_THRESHOLD) / (1000 - SOCIAL_GOOD_THRESHOLD));
    }

    // Apply to each tracked peer, blending their individual score with the global
    for (const [peerId, peerViol] of verifier._violations) {
        const peerMetrics = peerReputation._peers.get(peerId);
        if (!peerMetrics) {
            peerViol.socialModifier = clamp(globalMod, -0.3, 0.3);
            continue;
        }

        // Individual influence: their own score relative to thresholds
        let individualMod = 0;
        const peerScore = finiteNumberReport(peerMetrics.score, { min: 0, max: 1000 });
        const score = peerScore.valid ? peerScore.value : avgScore;
        if (score < SOCIAL_BAD_THRESHOLD) {
            individualMod = -0.2 * (1 - score / SOCIAL_BAD_THRESHOLD);
        } else if (score > SOCIAL_GOOD_THRESHOLD) {
            individualMod = 0.2 * ((score - SOCIAL_GOOD_THRESHOLD) / (1000 - SOCIAL_GOOD_THRESHOLD));
        }

        // Blend: 60% global (cluster effect) + 40% individual
        peerViol.socialModifier = globalMod * 0.6 + individualMod * 0.4;
        // Clamp
        peerViol.socialModifier = clamp(peerViol.socialModifier, -0.3, 0.3);
    }
}

// ── Query ────────────────────────────────────────────────────────────────────

/**
 * Get the violation count for a peer.
 */
export function getPeerViolationCount(verifier, peerId) {
    const peerViol = verifier._violations.get(peerId);
    return peerViol ? peerViol.count : 0;
}

/**
 * Get recent violations for a peer.
 */
export function getPeerViolations(verifier, peerId) {
    const peerViol = verifier._violations.get(peerId);
    return peerViol ? peerViol.violations.slice() : [];
}

/**
 * Get all peer violation summaries.
 */
export function getAllViolationSummaries(verifier) {
    const result = [];
    for (const [peerId, peerViol] of verifier._violations) {
        if (peerViol.count > 0 || peerViol.violations.length > 0) {
            result.push({
                peerId,
                count: Math.round(peerViol.count * 10) / 10,
                tier: peerViol.tier,
                trust: Math.round(peerViol.trust * 100) / 100,
                socialModifier: Math.round(peerViol.socialModifier * 100) / 100,
                warningsGiven: peerViol.warningsGiven,
                throttleCount: peerViol.throttleCount,
                muteCount: peerViol.muteCount,
                recentCount: peerViol.violations.length,
                lastViolation: peerViol.violations.length > 0
                    ? peerViol.violations[peerViol.violations.length - 1]
                    : null,
            });
        }
    }
    return result;
}

/**
 * Get the current tier for a peer.
 * @returns {string} 'clean'|'warning'|'throttled'|'muted'|'kicked'
 */
export function getPeerTier(verifier, peerId) {
    const peerViol = verifier._violations.get(peerId);
    return peerViol ? peerViol.tier : TIER_CLEAN;
}

/**
 * Get trust level for a peer (0.0-1.0).
 */
export function getPeerTrust(verifier, peerId) {
    const peerViol = verifier._violations.get(peerId);
    return peerViol ? clamp(peerViol.trust, 0, 1) : 0;
}

/**
 * Set play mode flag — violations during play mode are weighted less.
 */
export function setPlayMode(verifier, isPlayMode) {
    verifier._isPlayMode = !!isPlayMode;
}

/**
 * Check if a peer's ops should be throttled (tier >= THROTTLED).
 */
export function isPeerThrottled(verifier, peerId) {
    const tier = getPeerTier(verifier, peerId);
    return tier === TIER_THROTTLED || tier === TIER_MUTED || tier === TIER_KICKED;
}

/**
 * Check if a peer's scene-edit ops should be blocked (tier >= MUTED).
 */
export function isPeerMuted(verifier, peerId) {
    const tier = getPeerTier(verifier, peerId);
    return tier === TIER_MUTED || tier === TIER_KICKED;
}

/**
 * Get verifier stats.
 */
export function getIntegrityStats(verifier) {
    return { ...verifier._stats };
}

// ── Capability Exchange ──────────────────────────────────────────────────────

/**
 * Build a __capabilities__ op to send to a peer on connect.
 * Contains our supported op types and version string so the remote peer
 * can be lenient about ops we don't recognize (version mismatch, not cheating).
 */
export function buildCapabilitiesOp(verifier) {
    return {
        type: '__capabilities__',
        payload: {
            opTypes: [...VALID_OP_TYPES],
            version: verifier._selfVersion || '',
            ts: _advanceWallClock(verifier),
        },
    };
}

/**
 * Register a remote peer's declared capabilities.
 * Called when we receive a __capabilities__ op from them.
 * Unknown ops from peers with declared capabilities that include the op
 * are treated as version mismatches (INFO), not cheating (HIGH).
 */
export function registerPeerCapabilities(verifier, peerId, capabilitiesPayload) {
    const opTypes = capabilitiesPayload?.opTypes;
    const validOps = Array.isArray(opTypes) && opTypes.length <= 256 &&
        opTypes.every((type) => typeof type === 'string' && type.length > 0 && type.length <= 128);
    const validVersion = capabilitiesPayload &&
        (capabilitiesPayload.version === undefined ||
            (typeof capabilitiesPayload.version === 'string' && capabilitiesPayload.version.length <= 128));
    if (!validOps || !validVersion) {
        _reject(verifier, peerId, 'MALFORMED_CAPABILITIES',
            'Capabilities require a bounded string opTypes array and version', SEVERITY.MEDIUM);
        return false;
    }
    const now = _advanceWallClock(verifier);
    const timestamp = finiteNumberReport(capabilitiesPayload.ts, { min: 0 });
    verifier._peerCapabilities.set(peerId, {
        opTypes: new Set(opTypes),
        version: capabilitiesPayload.version || '',
        ts: timestamp.valid ? timestamp.value : now,
    });
    return true;
}

/**
 * Set the local version string for capability comparison.
 */
export function setLocalVersion(verifier, version) {
    verifier._selfVersion = typeof version === 'string' ? version.slice(0, 128) : '';
}

// ── Peer Lifecycle ───────────────────────────────────────────────────────────

/**
 * Remove a peer's tracking state.
 */
export function integrityRemovePeer(verifier, peerId) {
    verifier._chains.delete(peerId);
    verifier._violations.delete(peerId);
    verifier._lastPositions.delete(peerId);
    verifier._peerDigests.delete(peerId);
    verifier._peerCapabilities.delete(peerId);
}

// ── Cleanup ──────────────────────────────────────────────────────────────────

/**
 * Destroy verifier state.
 */
export function destroyIntegrityVerifier(verifier) {
    verifier._chains.clear();
    verifier._violations.clear();
    verifier._lastPositions.clear();
    verifier._peerDigests.clear();
    verifier._peerCapabilities.clear();
    verifier._selfDigest = null;
    verifier._lastDigestMs = 0;
    verifier._lastWallClockMs = 0;
    verifier._isPlayMode = false;
    verifier._selfVersion = '';
    Object.assign(verifier._stats, _createStats());
    verifier._onViolation = null;
    verifier._onAutoKick = null;
    verifier._onRepPenalty = null;
    verifier._onTierChange = null;
}
