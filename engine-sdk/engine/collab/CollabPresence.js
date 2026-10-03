// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * CollabPresence.js
 * Tracks all peers' camera positions, usernames, selections, and colors.
 * Presence packet: { v:1, u:username, c:[x,y,z], t:[tx,ty,tz], s:[entityIds] }
 *
 * Current scope: lossy latest-state presence. Authenticated presence identity,
 * sequence/freshness fields, cross-system stale-peer cleanup, interpolation
 * ownership, and captured churn traces remain audit gaps.
 */

import { runtimeMonotonicClockStep } from '../core/math/FrameMath.js';
import { cssColorParseReport } from '../core/math/MathColor.js';
import { roundTo } from '../core/math/MathScalar.js';
import { finiteArrayReport, finiteNumberReport } from '../core/math/MathValidation.js';

const PEER_COLORS = [
    '#6b8afd', '#f97316', '#22c55e', '#ec4899',
    '#a78bfa', '#14b8a6', '#f59e0b', '#ef4444'
];

const PRESENCE_VECTOR_STEP = 0.00001;
const STALE_DISPLAY_MS = 5000;
const STALE_PRUNE_MS = 30000;
const MAX_SELECTION_IDS = 32;
const MAX_USERNAME_LENGTH = 64;
const VALID_MODES = new Set(['edit', 'play', 'pause']);

function _validPeerId(value) {
    return typeof value === 'string' && value.length > 0;
}

function _clockNow(state, timestampMs = Date.now()) {
    const step = runtimeMonotonicClockStep(timestampMs, state._clockMs);
    state._clockMs = step.timestampMs;
    return step.timestampMs;
}

function _vectorReport(value, fallback = [0, 0, 0]) {
    const source = value ?? fallback;
    const report = finiteArrayReport(source, { expectedLength: 3 });
    return {
        valid: report.valid,
        value: report.valid ? [source[0], source[1], source[2]] : [...fallback],
        report,
    };
}

function _validSelectionId(value) {
    return (typeof value === 'string' && value.length > 0) ||
        (Number.isSafeInteger(value) && value >= 0);
}

export function presencePacketReport(packet) {
    const camera = _vectorReport(packet?.c);
    const target = _vectorReport(packet?.t);
    const selectionSource = packet?.s ?? [];
    const selectionValid = Array.isArray(selectionSource) &&
        selectionSource.length <= MAX_SELECTION_IDS && selectionSource.every(_validSelectionId);
    const simTime = finiteNumberReport(packet?.st ?? 0, { min: 0 });
    const usernameValid = packet?.u == null ||
        (typeof packet.u === 'string' && packet.u.length <= MAX_USERNAME_LENGTH);
    const mode = packet?.m || 'edit';
    const modeValid = VALID_MODES.has(mode);
    const colorSource = packet?.clr || null;
    const colorReport = colorSource === null ? null : cssColorParseReport(colorSource);
    const colorValid = colorSource === null ||
        (typeof colorSource === 'string' && colorSource.length <= 64 && colorReport.valid);
    const valid = packet?.v === 1 && camera.valid && target.valid && selectionValid &&
        simTime.valid && usernameValid && modeValid && colorValid;
    return {
        valid,
        value: valid ? {
            username: packet.u || 'Anonymous',
            camera: camera.value,
            target: target.value,
            selection: [...selectionSource],
            simTime: simTime.value,
            mode,
            color: colorSource === null ? null : colorReport.source,
        } : null,
        camera,
        target,
        selectionValid,
        simTime,
        usernameValid,
        modeValid,
        colorValid,
    };
}

export function createPresenceState() {
    const now = runtimeMonotonicClockStep(Date.now(), 0).timestampMs;
    return {
        peers: new Map(),       // peerId -> { username, color, camera, selection, lastSeen }
        colorPool: [...PEER_COLORS],
        usedColors: new Map(),  // peerId -> color
        _clockMs: now,
        _stats: { applied: 0, rejected: 0, pruned: 0 },
    };
}

/**
 * Build a presence packet from local state to broadcast.
 */
export function buildLocalPresencePacket(username, cameraPos, cameraTarget, selectionIds, simTime, mode, userColor) {
    const camera = _vectorReport(cameraPos);
    const target = _vectorReport(cameraTarget);
    const selection = Array.isArray(selectionIds)
        ? selectionIds.filter(_validSelectionId).slice(0, MAX_SELECTION_IDS)
        : [];
    const simTimeReport = finiteNumberReport(simTime ?? 0, { min: 0 });
    const localMode = VALID_MODES.has(mode) ? mode : 'edit';
    const localUsername = typeof username === 'string' && username.length > 0
        ? username.slice(0, MAX_USERNAME_LENGTH)
        : 'Anonymous';
    const colorReport = typeof userColor === 'string' && userColor.length <= 64
        ? cssColorParseReport(userColor)
        : null;
    return {
        v: 1,
        u: localUsername,
        c: camera.value.map((value) => roundTo(value, PRESENCE_VECTOR_STEP)),
        t: target.value.map((value) => roundTo(value, PRESENCE_VECTOR_STEP)),
        s: selection,
        st: simTimeReport.valid ? simTimeReport.value : 0,
        m: localMode,
        clr: colorReport?.valid ? colorReport.source : null,
    };
}

/**
 * Apply a remote presence packet for a peer.
 */
export function applyRemotePresence(state, peerId, packet) {
    const report = presencePacketReport(packet);
    if (!_validPeerId(peerId) || !report.valid) {
        state._stats.rejected++;
        return false;
    }
    const admitted = report.value;

    let peer = state.peers.get(peerId);
    if (!peer) {
        const color = _assignColor(state, peerId);
        peer = { username: 'Anonymous', color, camera: { pos: [0,0,0], target: [0,0,0] }, selection: [], lastSeen: 0 };
        state.peers.set(peerId, peer);
    }

    peer.username = admitted.username;
    peer.camera = { pos: admitted.camera, target: admitted.target };
    peer.selection = admitted.selection;
    peer.simTime = admitted.simTime;
    peer.mode = admitted.mode;
    if (admitted.color) peer.color = admitted.color;
    peer.lastSeen = _clockNow(state);
    state._stats.applied++;
    return true;
}

/**
 * Register a peer joining (before first presence packet).
 */
export function addPeer(state, peerId, username) {
    if (!_validPeerId(peerId) || state.peers.has(peerId)) return false;
    const color = _assignColor(state, peerId);
    state.peers.set(peerId, {
        username: typeof username === 'string' && username.length > 0
            ? username.slice(0, MAX_USERNAME_LENGTH)
            : 'Anonymous',
        color,
        camera: { pos: [0,0,0], target: [0,0,0] },
        selection: [],
        lastSeen: _clockNow(state),
    });
    return true;
}

/**
 * Remove a peer (on disconnect).
 */
export function removePresence(state, peerId) {
    if (!_validPeerId(peerId)) return false;
    const removed = state.peers.delete(peerId);
    const color = state.usedColors.get(peerId);
    if (color) {
        state.colorPool.push(color);
        state.usedColors.delete(peerId);
    }
    return removed;
}

/**
 * Get list of all known peers with their presence data.
 */
export function getPresenceList(state) {
    const list = [];
    const now = _clockNow(state);
    for (const [peerId, peer] of state.peers) {
        list.push({
            peerId,
            username: peer.username,
            color: peer.color,
            camera: { pos: [...peer.camera.pos], target: [...peer.camera.target] },
            selection: [...peer.selection],
            lastSeen: peer.lastSeen,
            stale: runtimeMonotonicClockStep(now, peer.lastSeen).elapsedMs > STALE_DISPLAY_MS,
        });
    }
    return list;
}

/**
 * Get color for a specific peer.
 */
export function getPeerColor(state, peerId) {
    return state.peers.get(peerId)?.color || state.usedColors.get(peerId) || '#888888';
}

/**
 * Prune peers not seen for > 30s.
 */
export function pruneStalePresence(state) {
    const now = _clockNow(state);
    const removed = [];
    for (const [peerId, peer] of state.peers) {
        if (runtimeMonotonicClockStep(now, peer.lastSeen).elapsedMs > STALE_PRUNE_MS) {
            removePresence(state, peerId);
            removed.push(peerId);
        }
    }
    state._stats.pruned += removed.length;
    return removed;
}

export function clearPresenceState(state) {
    state.peers.clear();
    state.usedColors.clear();
    state.colorPool = [...PEER_COLORS];
    state._clockMs = 0;
    state._stats = { applied: 0, rejected: 0, pruned: 0 };
}

function _assignColor(state, peerId) {
    if (state.usedColors.has(peerId)) return state.usedColors.get(peerId);
    const color = state.colorPool.length > 0
        ? state.colorPool.shift()
        : PEER_COLORS[state.usedColors.size % PEER_COLORS.length];
    state.usedColors.set(peerId, color);
    return color;
}
