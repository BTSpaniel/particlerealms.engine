// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * CollabPlaySync.js
 * Synchronizes play/pause/stop across all connected peers.
 * Broadcasts a shared determinism seed so all simulations run identically.
 * Sends heartbeat hashes every 1s for divergence detection.
 */

import {
    DIVERGENCE_FRAME_HASH_VERSION,
    computeFrameHash,
    divergenceHeartbeatReport,
    recordLocalFrame,
    receiveRemoteHash,
} from './CollabDivergenceTracker.js';
import { legacyDeterministicRngTickSeed32 } from '../core/math/MathBits.js';
import { uniformDistribution } from '../core/math/MathRandom.js';
import { clamp } from '../core/math/MathScalar.js';
import { finiteNumberReport } from '../core/math/MathValidation.js';

const HEARTBEAT_INTERVAL_MS = 1000;
const SIM_TICKS_PER_SECOND = 60;
const DRIFT_DEADBAND_SECONDS = 0.002;
const FAST_DRIFT_SECONDS = 0.05;
const GENTLE_CORRECTION_RATE = 0.08;
const FAST_CORRECTION_RATE = 0.3;
const CORRECTION_LIMIT_SECONDS = 0.003;
const CORRECTION_CONVERGED_SECONDS = 0.001;
const UINT32_MAX = 0xFFFFFFFF;

export function createPlaySync(config = {}) {
    // config: { editor, onBroadcastOp, onRequestTimelineExport, divergenceTracker }
    return {
        editor: config.editor,
        onBroadcastOp: typeof config.onBroadcastOp === 'function' ? config.onBroadcastOp : (() => {}),
        onRequestTimelineExport: typeof config.onRequestTimelineExport === 'function' ? config.onRequestTimelineExport : (() => {}),
        divergenceTracker: config.divergenceTracker || null,
        _heartbeatTimer: null,
        _isRemotePlay: false,   // true when play was triggered by a remote peer
        _currentSeed: null,
        _remoteCommandSequence: 0,
        _remoteTransition: Promise.resolve(),
        _destroyed: false,
    };
}

export function playSyncCommandReport(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return { valid: false, reason: 'not-object', value: null };
    }
    const action = payload.action;
    if (action !== 'play' && action !== 'pause' && action !== 'stop') {
        return { valid: false, reason: 'invalid-action', value: null };
    }
    const hostTime = payload.hostSimTime == null
        ? { valid: true, value: null }
        : finiteNumberReport(payload.hostSimTime, { min: 0 });
    if (!hostTime.valid) return { valid: false, reason: 'invalid-host-sim-time', value: null };
    let seed = null;
    if (action === 'play') {
        const seedReport = finiteNumberReport(payload.seed, { min: 0, max: UINT32_MAX, integer: true });
        if (!seedReport.valid) return { valid: false, reason: 'invalid-seed', value: null };
        seed = seedReport.value >>> 0;
    }
    return {
        valid: true,
        reason: 'valid',
        value: { action, seed, hostSimTime: hostTime.value },
    };
}

export function playSyncTickReport(simTime) {
    const time = finiteNumberReport(simTime, { min: 0, max: Number.MAX_SAFE_INTEGER / SIM_TICKS_PER_SECOND });
    if (!time.valid) return { valid: false, reason: 'invalid-sim-time', simTime: 0, simTick: 0 };
    return {
        valid: true,
        reason: 'valid',
        simTime: time.value,
        simTick: Math.floor(time.value * SIM_TICKS_PER_SECOND),
    };
}

export function playSyncHeartbeatReport(payload, currentSeed) {
    if (payload?.action !== 'heartbeat') return { valid: false, reason: 'invalid-action', value: null };
    const heartbeat = divergenceHeartbeatReport(payload);
    if (!heartbeat.valid) return heartbeat;
    const seed = finiteNumberReport(currentSeed, { min: 0, max: UINT32_MAX, integer: true });
    const frameSeed = finiteNumberReport(payload.frameSeed, { min: 0, max: UINT32_MAX, integer: true });
    const tick = playSyncTickReport(heartbeat.value.simTime);
    if (!seed.valid) return { valid: false, reason: 'invalid-current-seed', value: null };
    if (!frameSeed.valid) return { valid: false, reason: 'invalid-frame-seed', value: null };
    if (!tick.valid || tick.simTick !== heartbeat.value.simTick) {
        return { valid: false, reason: 'inconsistent-sim-tick', value: null };
    }
    const expectedFrameSeed = legacyDeterministicRngTickSeed32(seed.value, tick.simTick);
    if ((frameSeed.value >>> 0) !== expectedFrameSeed) {
        return { valid: false, reason: 'inconsistent-frame-seed', value: null };
    }
    return {
        valid: true,
        reason: 'valid',
        value: { ...heartbeat.value, frameSeed: expectedFrameSeed },
    };
}

export function playSyncCorrectionTargetReport(authoritySimTime, localSimTime) {
    const authority = finiteNumberReport(authoritySimTime, { min: 0 });
    const local = finiteNumberReport(localSimTime, { min: 0 });
    if (!authority.valid || !local.valid) {
        return { valid: false, active: false, drift: 0, target: null, rate: null };
    }
    const drift = authority.value - local.value;
    const magnitude = Math.abs(drift);
    const active = magnitude > DRIFT_DEADBAND_SECONDS;
    return {
        valid: true,
        active,
        drift,
        target: active ? authority.value : null,
        rate: active ? (magnitude > FAST_DRIFT_SECONDS ? FAST_CORRECTION_RATE : GENTLE_CORRECTION_RATE) : null,
    };
}

export function playSyncAccumulatorCorrectionReport(targetSimTime, localSimTime, correctionRate) {
    const target = finiteNumberReport(targetSimTime, { min: 0 });
    const local = finiteNumberReport(localSimTime, { min: 0 });
    const rate = finiteNumberReport(correctionRate, { min: 0, max: 1 });
    if (!target.valid || !local.valid || !rate.valid) {
        return { valid: false, correction: 0, drift: 0, converged: true };
    }
    const drift = target.value - local.value;
    return {
        valid: true,
        correction: clamp(drift * rate.value, -CORRECTION_LIMIT_SECONDS, CORRECTION_LIMIT_SECONDS),
        drift,
        converged: Math.abs(drift) < CORRECTION_CONVERGED_SECONDS,
    };
}

export function playSyncTimelineReport(editor) {
    if (!editor || !Array.isArray(editor.simHistory)) {
        return { valid: false, reason: 'invalid-history', value: null };
    }
    const simTime = finiteNumberReport(editor.simTime, { min: 0 });
    if (!simTime.valid) return { valid: false, reason: 'invalid-sim-time', value: null };
    const frames = [];
    for (const frame of editor.simHistory) {
        const time = finiteNumberReport(frame?.time, { min: 0 });
        if (!time.valid || typeof frame?.type !== 'string' || frame.type.length > 128) {
            return { valid: false, reason: 'invalid-frame', value: null };
        }
        frames.push({ time: time.value, type: frame.type });
    }
    return {
        valid: true,
        reason: 'valid',
        value: { simTime: simTime.value, frameCount: frames.length, frames },
    };
}

/**
 * Broadcast a play command to all peers. Called when local user hits Play.
 * seed: optional 32-bit int. Generated here if not provided.
 */
export function broadcastPlay(playSync, seed) {
    if (!playSync || playSync._destroyed) return null;
    const s = _normalizeLocalSeed(seed);
    playSync._currentSeed = s;
    const hostSimTime = _localSimTime(playSync.editor);

    playSync.onBroadcastOp({
        type: 'play_sync',
        payload: {
            action: 'play',
            seed: s,
            hostSimTime,
        },
    });

    _startHeartbeat(playSync);
    return s;
}

/**
 * Broadcast a pause command to all peers.
 */
export function broadcastPause(playSync) {
    if (!playSync || playSync._destroyed) return false;
    playSync.onBroadcastOp({
        type: 'play_sync',
        payload: {
            action: 'pause',
            hostSimTime: _localSimTime(playSync.editor),
        },
    });
    _stopHeartbeat(playSync);
    return true;
}

/**
 * Broadcast a stop command to all peers.
 */
export function broadcastStop(playSync) {
    if (!playSync || playSync._destroyed) return false;
    playSync.onBroadcastOp({
        type: 'play_sync',
        payload: {
            action: 'stop',
            hostSimTime: _localSimTime(playSync.editor),
        },
    });
    _stopHeartbeat(playSync);
    playSync._currentSeed = null;
    playSync._remoteCommandSequence++;
    return true;
}

/**
 * Handle an incoming play_sync op from a remote peer.
 * Returns the action taken: 'play' | 'pause' | 'stop' | null
 */
export function onRemotePlayCommand(playSync, op) {
    if (!playSync || playSync._destroyed || !op || op.type !== 'play_sync') return null;

    const report = playSyncCommandReport(op.payload);
    if (!report.valid) return null;
    const commandSequence = ++playSync._remoteCommandSequence;
    playSync._isRemotePlay = true;
    playSync._remoteTransition = playSync._remoteTransition
        .catch(() => {})
        .then(() => _applyRemotePlayCommand(playSync, report.value))
        .catch((error) => console.error('[CollabPlaySync] Remote command failed:', error))
        .finally(() => {
            if (playSync._remoteCommandSequence === commandSequence) playSync._isRemotePlay = false;
        });
    return report.value.action;
}

/**
 * Handle an incoming sim_heartbeat op from a remote peer.
 */
export function onRemoteHeartbeat(playSync, op) {
    if (!playSync || playSync._destroyed || !op || op.type !== 'sim_heartbeat' || !op.payload) return false;

    const report = playSyncHeartbeatReport(op.payload, playSync._currentSeed);
    if (!report.valid) return false;
    const { simTime, simTick, frameHash, frameHashVersion, peerId } = report.value;
    const editor = playSync.editor;

    // Direct simTime correction: authority sends its simTime, we compare to ours.
    // No perf.now() comparison (different origin per tab, meaningless across tabs).
    if (editor?.mode === 'play') {
        const correction = playSyncCorrectionTargetReport(simTime, editor.simTime);
        editor._simTimeCorrectionTarget = correction.active ? correction.target : null;
        editor._simTimeCorrectionRate = correction.active ? correction.rate : null;
    }

    // Re-sync particle RNG only on significant tick drift (>3 ticks = 50ms at 60Hz)
    // Constant re-seeding every heartbeat causes visible particle emission glitches.
    if (editor?.mode === 'play') {
        const localTickReport = playSyncTickReport(editor.simTime);
        if (!localTickReport.valid) return false;
        const localTick = localTickReport.simTick;
        const tickDrift = Math.abs(simTick - localTick);
        if (tickDrift > 3 && typeof editor.seedParticleRng === 'function') {
            editor.seedParticleRng(playSync._currentSeed, simTick);
        }
    }

    if (playSync.divergenceTracker) {
        receiveRemoteHash(
            playSync.divergenceTracker,
            peerId,
            simTime,
            frameHash,
            frameHashVersion
        );
    }
    return true;
}

/**
 * Export local simHistory as a downloadable JSON file.
 */
export function exportTimeline(editor, filename) {
    const report = playSyncTimelineReport(editor);
    if (!report.valid) return false;

    const data = {
        v: 1,
        exportedAt: new Date().toISOString(),
        ...report.value,
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || `timeline-${Date.now()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return true;
}

/**
 * Check if the current play command was triggered remotely.
 */
export function isRemotePlay(playSync) {
    return playSync?._isRemotePlay === true;
}

/**
 * Get the current determinism seed.
 */
export function getCurrentSeed(playSync) {
    return playSync?._currentSeed ?? null;
}

export function destroyPlaySync(playSync) {
    if (!playSync || playSync._destroyed) return;
    _stopHeartbeat(playSync);
    if (playSync.editor) {
        playSync.editor._simTimeCorrectionTarget = null;
        playSync.editor._simTimeCorrectionRate = null;
    }
    playSync._destroyed = true;
    playSync._remoteCommandSequence++;
    playSync._remoteTransition = Promise.resolve();
    playSync._isRemotePlay = false;
    playSync._currentSeed = null;
    playSync.editor = null;
    playSync.divergenceTracker = null;
    playSync.onBroadcastOp = () => {};
    playSync.onRequestTimelineExport = () => {};
}

// ─── Private ─────────────────────────────────────────────────────────────────

function _generateSeed() {
    return Math.floor(uniformDistribution(0, 0x100000000, Math.random)) >>> 0;
}

function _normalizeLocalSeed(seed) {
    if (typeof seed !== 'number' || !Number.isFinite(seed)) return _generateSeed();
    return Math.trunc(seed) >>> 0;
}

function _localSimTime(editor) {
    const report = finiteNumberReport(editor?.simTime, { min: 0 });
    return report.valid ? report.value : 0;
}

async function _applyRemotePlayCommand(playSync, command) {
    if (playSync._destroyed || !playSync.editor) return;
    const editor = playSync.editor;
    playSync._isRemotePlay = true;
    if (command.action === 'play') {
        playSync._currentSeed = command.seed;
        if (editor.mode !== 'play') await editor.enterPlayMode(command.seed);
        if (playSync._destroyed && editor.mode !== 'edit' && typeof editor.exitPlayMode === 'function') {
            editor.exitPlayMode();
        }
        return;
    }
    if (command.action === 'pause') {
        if (editor.mode === 'play') editor.togglePause();
        _stopHeartbeat(playSync);
        return;
    }
    if (editor.mode !== 'edit') editor.exitPlayMode();
    _stopHeartbeat(playSync);
    playSync._currentSeed = null;
}

function _startHeartbeat(playSync) {
    _stopHeartbeat(playSync);
    playSync._heartbeatTimer = setInterval(() => {
        if (playSync._destroyed) return;
        const editor = playSync.editor;
        if (!editor || editor.mode !== 'play') {
            _stopHeartbeat(playSync);
            return;
        }

        const tick = playSyncTickReport(editor.simTime);
        const seed = finiteNumberReport(playSync._currentSeed, { min: 0, max: UINT32_MAX, integer: true });
        if (!tick.valid || !seed.valid) return;
        const { simTime, simTick } = tick;
        const frameHash = computeFrameHash(editor);

        // Record locally for divergence comparison
        if (playSync.divergenceTracker) {
            recordLocalFrame(playSync.divergenceTracker, simTime, editor);
        }

        // Compute frameSeed for GPU particle determinism
        const frameSeed = legacyDeterministicRngTickSeed32(seed.value, simTick);

        // Broadcast heartbeat to peers (authority simTime is the source of truth)
        playSync.onBroadcastOp({
            type: 'sim_heartbeat',
            payload: {
                action: 'heartbeat',
                simTime,
                simTick,
                frameHashVersion: DIVERGENCE_FRAME_HASH_VERSION,
                frameHash,
                frameSeed,
            },
        });
    }, HEARTBEAT_INTERVAL_MS);
}

// Audit gaps: play authority is transport-selected rather than term/quorum
// elected, commands are not cryptographically sender-bound here, heartbeat loss
// has no adaptive cadence, and captured multi-peer pause/resume traces are absent.

function _stopHeartbeat(playSync) {
    if (playSync._heartbeatTimer) {
        clearInterval(playSync._heartbeatTimer);
        playSync._heartbeatTimer = null;
    }
}
