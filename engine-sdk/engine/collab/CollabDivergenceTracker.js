// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * CollabDivergenceTracker.js
 * Records per-frame position hashes during play mode and compares
 * them across peers to detect simulation divergence.
 *
 * Hash algorithm: FNV-1a 32-bit over versioned entity-handle words and
 * quantized positions. V2 is current; V1 is available only through its named
 * compatibility function or an explicit version option.
 */

import { checksumHex32, fnv1a32 } from '../core/math/ChecksumMath.js';
import { runtimeMonotonicClockStep } from '../core/math/FrameMath.js';
import { finiteArrayReport, finiteNumberReport } from '../core/math/MathValidation.js';
import {
    positiveSafeEntityHandleReport,
    splitEntityHandle,
} from '../ecs/world/World.js';

const HASH_WINDOW_MS = 200; // tolerance when matching remote hashes to local time
const MAX_FRAME_HISTORY = 3600;
const MAX_DIVERGENCE_HISTORY = 512;
const LEGACY_MAX_ENTITY_ID = 0xFFFF;
const MIN_POSITION = -8388.608;
const MAX_POSITION = 8388.607;
const FRAME_HASH_PATTERN = /^[0-9a-f]{8}$/i;
const V2_HASH_DOMAIN = Object.freeze([0x44, 0x49, 0x56, 0x02]);

export const DIVERGENCE_FRAME_HASH_VERSION_V1 = 1;
export const DIVERGENCE_FRAME_HASH_VERSION_V2 = 2;
export const DIVERGENCE_FRAME_HASH_VERSION = DIVERGENCE_FRAME_HASH_VERSION_V2;

export function createDivergenceTracker() {
    return {
        localFrames: [],        // [{ simTime, hash, hashVersion }]
        remoteFrames: new Map(),// peerId -> [{ simTime, hash, hashVersion }]
        divergences: [],        // [{ simTime, peerId, localHash, remoteHash }]
        enabled: true,
        authorityActive: false, // suppress warnings when authority model is active
        _clockMs: 0,
        _stats: {
            localFrames: 0,
            remoteFrames: 0,
            rejectedFrames: 0,
            comparisons: 0,
            divergences: 0,
        },
    };
}

export function divergenceHeartbeatReport(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return { valid: false, reason: 'not-object', value: null };
    }
    const peerId = typeof payload.peerId === 'string' ? payload.peerId.trim() : '';
    const simTime = finiteNumberReport(payload.simTime, { min: 0 });
    const simTick = finiteNumberReport(payload.simTick, { min: 0, integer: true });
    const hashVersion = finiteNumberReport(payload.frameHashVersion, {
        min: DIVERGENCE_FRAME_HASH_VERSION_V1,
        max: DIVERGENCE_FRAME_HASH_VERSION_V2,
        integer: true,
    });
    const frameHash = typeof payload.frameHash === 'string' ? payload.frameHash.trim().toLowerCase() : '';
    if (!peerId || peerId.length > 256) return { valid: false, reason: 'invalid-peer-id', value: null };
    if (!simTime.valid) return { valid: false, reason: 'invalid-sim-time', value: null };
    if (!simTick.valid) return { valid: false, reason: 'invalid-sim-tick', value: null };
    if (!hashVersion.valid) return { valid: false, reason: 'invalid-frame-hash-version', value: null };
    if (!FRAME_HASH_PATTERN.test(frameHash)) return { valid: false, reason: 'invalid-frame-hash', value: null };
    return {
        valid: true,
        reason: 'valid',
        value: {
            peerId,
            simTime: simTime.value,
            simTick: simTick.value,
            frameHashVersion: hashVersion.value,
            frameHash,
        },
    };
}

function divergenceHashVersionReport(options) {
    const candidate = typeof options === 'number'
        ? options
        : options?.version ?? DIVERGENCE_FRAME_HASH_VERSION;
    const version = finiteNumberReport(candidate, {
        min: DIVERGENCE_FRAME_HASH_VERSION_V1,
        max: DIVERGENCE_FRAME_HASH_VERSION_V2,
        integer: true,
    });
    return version.valid
        ? { valid: true, version: version.value }
        : { valid: false, version: null };
}

export function divergenceFrameHashReport(samples, options = {}) {
    const hashVersion = divergenceHashVersionReport(options);
    if (!hashVersion.valid) {
        return { valid: false, reason: 'invalid-version', version: null, hash: '00000000', sampleCount: 0 };
    }
    if (!Array.isArray(samples)) {
        return {
            valid: false,
            reason: 'not-array',
            version: hashVersion.version,
            hash: '00000000',
            sampleCount: 0,
        };
    }
    const ordered = [];
    const entityIds = new Set();
    for (const sample of samples) {
        const entity = hashVersion.version === DIVERGENCE_FRAME_HASH_VERSION_V1
            ? finiteNumberReport(sample?.entityId, { min: 0, max: LEGACY_MAX_ENTITY_ID, integer: true })
            : positiveSafeEntityHandleReport(sample?.entityId);
        const position = finiteArrayReport(sample?.position, {
            expectedLength: 3,
            min: MIN_POSITION,
            max: MAX_POSITION,
        });
        if (!entity.valid || !position.valid || entityIds.has(entity.value)) {
            return {
                valid: false,
                reason: 'invalid-sample',
                version: hashVersion.version,
                hash: '00000000',
                sampleCount: ordered.length,
            };
        }
        entityIds.add(entity.value);
        ordered.push({ entityId: entity.value, position: Array.from(sample.position) });
    }
    ordered.sort((a, b) => a.entityId - b.entityId);
    const bytes = hashVersion.version === DIVERGENCE_FRAME_HASH_VERSION_V2
        ? [...V2_HASH_DOMAIN]
        : [];
    for (const sample of ordered) {
        if (hashVersion.version === DIVERGENCE_FRAME_HASH_VERSION_V1) {
            _pushUint16(bytes, sample.entityId);
        } else {
            _pushSafeEntityHandle(bytes, sample.entityId);
        }
        _pushInt24(bytes, Math.round(sample.position[0] * 1000));
        _pushInt24(bytes, Math.round(sample.position[1] * 1000));
        _pushInt24(bytes, Math.round(sample.position[2] * 1000));
    }
    return {
        valid: true,
        reason: 'valid',
        version: hashVersion.version,
        hash: checksumHex32(fnv1a32(bytes)),
        sampleCount: ordered.length,
    };
}

export function divergenceFrameHashV1Report(samples) {
    return divergenceFrameHashReport(samples, { version: DIVERGENCE_FRAME_HASH_VERSION_V1 });
}

/**
 * Record a local frame hash. Call every simHistoryInterval during play.
 */
export function recordLocalFrame(tracker, simTime, editor, options = {}) {
    if (!tracker?.enabled) return false;
    const timeReport = finiteNumberReport(simTime, { min: 0 });
    const hashReport = _computeEditorFrameHashReport(editor, options);
    if (!timeReport.valid || !hashReport.valid) {
        tracker._stats.rejectedFrames++;
        return false;
    }
    const ts = _clockStep(tracker);
    tracker.localFrames.push({
        simTime: timeReport.value,
        hash: hashReport.hash,
        hashVersion: hashReport.version,
        ts,
    });
    tracker._stats.localFrames++;

    // Keep bounded
    if (tracker.localFrames.length > MAX_FRAME_HISTORY) {
        tracker.localFrames = tracker.localFrames.slice(-MAX_FRAME_HISTORY);
    }
    return true;
}

/**
 * Receive a remote heartbeat hash from a peer.
 */
export function receiveRemoteHash(
    tracker,
    peerId,
    simTime,
    frameHash,
    frameHashVersion = DIVERGENCE_FRAME_HASH_VERSION
) {
    if (!tracker?.enabled) return false;
    const report = divergenceHeartbeatReport({
        peerId,
        simTime,
        simTick: 0,
        frameHashVersion,
        frameHash,
    });
    if (!report.valid) {
        tracker._stats.rejectedFrames++;
        return false;
    }
    const packet = report.value;
    const ts = _clockStep(tracker);
    if (!tracker.remoteFrames.has(packet.peerId)) {
        tracker.remoteFrames.set(packet.peerId, []);
    }
    const frames = tracker.remoteFrames.get(packet.peerId);
    frames.push({
        simTime: packet.simTime,
        hash: packet.frameHash,
        hashVersion: packet.frameHashVersion,
        ts,
    });
    tracker._stats.remoteFrames++;

    // Keep bounded
    if (frames.length > MAX_FRAME_HISTORY) {
        tracker.remoteFrames.set(packet.peerId, frames.slice(-MAX_FRAME_HISTORY));
    }

    // Check for divergence at this time
    _checkDivergence(
        tracker,
        packet.peerId,
        packet.simTime,
        packet.frameHash,
        packet.frameHashVersion,
        ts
    );
    return true;
}

/**
 * Remove a peer's data on disconnect.
 */
export function removePeerDivergence(tracker, peerId) {
    return tracker?.remoteFrames?.delete(peerId) ?? false;
}

/**
 * Get all recorded divergence events.
 */
export function getDivergenceLog(tracker) {
    return tracker?.divergences?.map((event) => ({ ...event })) ?? [];
}

/**
 * Clear all tracking data (call on exitPlayMode).
 */
export function resetDivergenceTracker(tracker) {
    if (!tracker) return;
    tracker.localFrames = [];
    tracker.remoteFrames.clear();
    tracker.divergences = [];
    tracker._clockMs = 0;
    for (const key of Object.keys(tracker._stats)) tracker._stats[key] = 0;
}

/**
 * Export a JSON report of all divergences + local timeline.
 */
export function exportDivergenceReport(tracker, localUsername) {
    return {
        v: 2,
        frameHashVersion: DIVERGENCE_FRAME_HASH_VERSION,
        exportedAt: new Date().toISOString(),
        peer: localUsername || 'local',
        divergences: getDivergenceLog(tracker),
        localFrameCount: tracker?.localFrames?.length ?? 0,
        localFrames: tracker?.localFrames?.map((frame) => ({ ...frame })) ?? [],
    };
}

/**
 * Compute a fast FNV-1a hash of all entity positions in the scene.
 * Quantizes positions to 3 decimal places for float stability.
 */
export function computeFrameHash(editor, options = {}) {
    return _computeEditorFrameHashReport(editor, options).hash;
}

function _computeEditorFrameHashReport(editor, options = {}) {
    if (!editor || !editor.ecsWorld || !editor.scene?.entities?.keys) {
        return { valid: false, reason: 'invalid-editor', hash: '00000000', sampleCount: 0 };
    }

    // Sort entity IDs for deterministic order
    const ids = [...editor.scene.entities.keys()].sort((a, b) => a - b);
    const samples = [];

    for (const entityId of ids) {
        try {
            const { getEntityComponent } = _getStorage();
            const transform = getEntityComponent(editor.ecsWorld, entityId, 'Transform');
            if (!transform || !transform.position) continue;

            samples.push({ entityId, position: transform.position });
        } catch (_) {}
    }

    return divergenceFrameHashReport(samples, options);
}

export function collabDivergenceFrameHash(samples, options = {}) {
    return divergenceFrameHashReport(samples, options).hash;
}

export function collabDivergenceFrameHashV1(samples) {
    return divergenceFrameHashV1Report(samples).hash;
}

// ─── Private ─────────────────────────────────────────────────────────────────

function _pushUint16(bytes, value) {
    bytes.push(value & 0xFF, (value >> 8) & 0xFF);
}

function _pushUint32(bytes, value) {
    const word = value >>> 0;
    bytes.push(
        word & 0xFF,
        (word >>> 8) & 0xFF,
        (word >>> 16) & 0xFF,
        (word >>> 24) & 0xFF
    );
}

function _pushSafeEntityHandle(bytes, value) {
    const words = splitEntityHandle(value);
    _pushUint32(bytes, words.low);
    _pushUint32(bytes, words.high);
}

function _pushInt24(bytes, value) {
    bytes.push(value & 0xFF, (value >> 8) & 0xFF, (value >> 16) & 0xFF);
}

function _checkDivergence(
    tracker,
    peerId,
    remoteSimTime,
    remoteHash,
    remoteHashVersion,
    detectedAt
) {
    // Find local frame closest to remoteSimTime within tolerance
    let best = null;
    let bestDiff = Infinity;

    for (const frame of tracker.localFrames) {
        if (frame.hashVersion !== remoteHashVersion) continue;
        const diff = Math.abs(frame.simTime - remoteSimTime);
        if (diff < bestDiff && diff <= HASH_WINDOW_MS / 1000) {
            bestDiff = diff;
            best = frame;
        }
    }

    if (!best) return; // No local frame near this time yet
    tracker._stats.comparisons++;

    if (best.hash !== remoteHash) {
        const event = {
            simTime: remoteSimTime,
            peerId,
            localHash: best.hash,
            remoteHash,
            frameHashVersion: remoteHashVersion,
            localSimTime: best.simTime,
            detectedAt,
        };
        tracker.divergences.push(event);
        if (tracker.divergences.length > MAX_DIVERGENCE_HISTORY) {
            tracker.divergences = tracker.divergences.slice(-MAX_DIVERGENCE_HISTORY);
        }
        tracker._stats.divergences++;
        // Suppress console warnings when authority model is active — hash mismatches
        // are expected because non-authority peers apply transforms with interpolation delay
        if (!tracker.authorityActive) {
            console.warn(`[CollabDivergence] Divergence at t=${remoteSimTime.toFixed(3)}s peer=${peerId} local=${best.hash} remote=${remoteHash}`);
        }
    }
}

function _clockStep(tracker) {
    const step = runtimeMonotonicClockStep(Date.now(), tracker._clockMs);
    tracker._clockMs = step.timestampMs;
    return tracker._clockMs;
}

let _storageRef = null;
function _getStorage() {
    if (_storageRef) return _storageRef;
    // Will be injected via injectDivergenceDeps
    return { getEntityComponent: () => null };
}

export function injectDivergenceDeps(deps) {
    if (typeof deps?.getEntityComponent === 'function') {
        _storageRef = { getEntityComponent: deps.getEntityComponent };
    }
}

// Audit gaps: this position-only FNV diagnostic is not an authenticated state
// receipt, a complete component/physics hash, tick-epoch consensus, per-entity
// divergence localization, or evidence from captured multi-peer fault traces.
