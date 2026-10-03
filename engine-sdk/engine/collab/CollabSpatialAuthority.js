// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * CollabSpatialAuthority.js
 * Distributed spatial authority for collaborative multiplayer.
 *
 * Each peer owns a circular "zone" centered on their camera position.
 * Entities within a peer's zone are simulated locally by that peer.
 * Entities outside all zones are dormant (no physics, no sync).
 *
 * Authority resolution (Roblox + Gaffer hybrid):
 *   - Nearest peer within zone radius wins (automatic proximity)
 *   - 20% hysteresis prevents ping-pong at boundaries
 *   - Higher-priority claims (SELECTED, GRABBED) override proximity
 *   - Sequence numbers resolve conflicts (Gaffer-style)
 *
 * Interest management (Photon-style):
 *   - Interest area = zoneRadius × interestMultiplier (default 1.3×)
 *   - Only send state for entities you're authoritative over
 *   - Only receive state for entities in your interest area
 *
 * Inspired by: Star Citizen dynamic server meshing, Roblox Network Ownership,
 * Photon Fusion Shared Authority + AoI grid, Gaffer on Games authority scheme.
 */

import {
    createSpatialHashGrid,
    gridInsert,
    gridRemove,
    gridQueryRadius,
    gridClear,
    destroySpatialHashGrid,
} from './SpatialHashGrid.js';
import { runtimeMonotonicClockStep } from '../core/math/FrameMath.js';
import { clamp, finiteNumber } from '../core/math/MathScalar.js';
import { vec3Distance } from '../core/math/MathVec3.js';

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_ZONE_RADIUS        = 200;   // world units (auto-computed from scene)
const MIN_ZONE_RADIUS            = 50;    // floor
const MAX_ZONE_RADIUS            = 5000;  // ceiling
const DEFAULT_INTEREST_MULTIPLIER = 1.3;  // interest area = zone × this
const DEFAULT_BUFFER_RATIO       = 0.15;  // 15% of zone radius = buffer ring
const DEFAULT_HYSTERESIS_MS      = 500;   // entity must stay in new zone this long
const HYSTERESIS_DISTANCE_RATIO  = 0.20;  // must be 20% closer to steal authority
const RESOLVE_INTERVAL_MS        = 500;   // recalculate auto-authority at this rate

function _boundedZoneRadius(radius, fallback = DEFAULT_ZONE_RADIUS) {
    return clamp(finiteNumber(radius, fallback), MIN_ZONE_RADIUS, MAX_ZONE_RADIUS);
}

function _advanceWallClock(auth) {
    const clock = runtimeMonotonicClockStep(Date.now(), auth._lastWallClockMs);
    auth._lastWallClockMs = clock.timestampMs;
    return clock;
}

// ── Create ───────────────────────────────────────────────────────────────────

/**
 * Create a spatial authority state.
 * @param {string} selfId - This peer's unique ID
 * @param {Object} [config] - Optional overrides
 * @returns {Object} spatial authority state
 */
export function createSpatialAuthority(selfId, config) {
    const cfg = config || {};
    const zoneRadius = _boundedZoneRadius(cfg.zoneRadius);
    const cellSize = zoneRadius / 4;

    return {
        selfId,
        zoneRadius,
        interestMultiplier: cfg.interestMultiplier || DEFAULT_INTEREST_MULTIPLIER,
        bufferRatio: cfg.bufferRatio || DEFAULT_BUFFER_RATIO,
        hysteresisMs: cfg.hysteresisMs || DEFAULT_HYSTERESIS_MS,

        // Peer positions: peerId -> { x, y, z }
        _peerPositions: new Map(),

        // Entity grid (XZ plane)
        _entityGrid: createSpatialHashGrid(cellSize),

        // Entity auto-authority: entityId -> { ownerId, since (timestamp) }
        _autoAuthority: new Map(),

        // Dormant set: entities outside all peer zones
        _dormantSet: new Set(),

        // Last resolve timestamp
        _lastResolveMs: 0,
        _lastWallClockMs: 0,
    };
}

// ── Zone Radius Computation ──────────────────────────────────────────────────

/**
 * Auto-compute zone radius from scene bounds.
 * @param {Object} sceneBounds - { min: [x,y,z], max: [x,y,z] } or { diagonal: number }
 * @returns {number} zone radius in world units
 */
export function computeZoneRadius(sceneBounds) {
    let diagonal;
    if (sceneBounds?.diagonal != null) {
        diagonal = finiteNumber(sceneBounds.diagonal, DEFAULT_ZONE_RADIUS * 2);
    } else if (sceneBounds?.min && sceneBounds?.max) {
        diagonal = finiteNumber(vec3Distance(sceneBounds.min, sceneBounds.max), DEFAULT_ZONE_RADIUS * 2);
    } else {
        return DEFAULT_ZONE_RADIUS;
    }

    return _boundedZoneRadius(diagonal / 2);
}

/**
 * Update the zone radius (e.g., after scene bounds change or manual override).
 * Rebuilds the spatial grid with the new cell size.
 */
export function setZoneRadius(auth, radius) {
    auth.zoneRadius = _boundedZoneRadius(radius, auth.zoneRadius);
    // Rebuild grid with new cell size
    const oldGrid = auth._entityGrid;
    const newCellSize = auth.zoneRadius / 4;
    auth._entityGrid = createSpatialHashGrid(newCellSize, {
        maxEntities: oldGrid.maxEntities,
        maxQueryCells: oldGrid.maxQueryCells,
    });
    // Re-insert all entities
    for (const [id, pos] of oldGrid._entityPos) {
        gridInsert(auth._entityGrid, id, pos.x, pos.z);
    }
    destroySpatialHashGrid(oldGrid);
}

// ── Peer Position Updates ────────────────────────────────────────────────────

/**
 * Update a peer's camera position (called from presence packets).
 * @param {Object} auth
 * @param {string} peerId
 * @param {number[]} position - [x, y, z]
 */
export function updatePeerPosition(auth, peerId, position) {
    if (!position || position.length < 3) return;
    auth._peerPositions.set(peerId, {
        x: position[0],
        y: position[1],
        z: position[2],
    });
}

/**
 * Remove a peer (on disconnect).
 */
export function removePeer(auth, peerId) {
    auth._peerPositions.delete(peerId);
    // Entities owned by this peer revert to auto-authority on next resolve
    for (const [entityId, autoAuth] of auth._autoAuthority) {
        if (autoAuth.ownerId === peerId) {
            auth._autoAuthority.delete(entityId);
        }
    }
}

// ── Entity Position Updates ──────────────────────────────────────────────────

/**
 * Update an entity's position in the spatial grid.
 * Call this when entity transforms change (from physics step or remote sync).
 * @param {Object} auth
 * @param {number|string} entityId
 * @param {number} x - World X
 * @param {number} z - World Z
 */
export function updateEntityPosition(auth, entityId, x, z) {
    gridInsert(auth._entityGrid, entityId, x, z);
}

/**
 * Remove an entity from the spatial grid (on entity delete).
 */
export function removeEntity(auth, entityId) {
    gridRemove(auth._entityGrid, entityId);
    auth._autoAuthority.delete(entityId);
    auth._dormantSet.delete(entityId);
}

// ── Authority Resolution ─────────────────────────────────────────────────────

/**
 * Find the nearest peer to an XZ position within zone range.
 * @returns {{ peerId: string, distSq: number }|null}
 */
function _nearestPeer(auth, x, z) {
    let bestPeer = null;
    let bestDistSq = Infinity;
    const r2 = auth.zoneRadius * auth.zoneRadius;

    for (const [peerId, pos] of auth._peerPositions) {
        const dx = pos.x - x;
        const dz = pos.z - z;
        const d2 = dx * dx + dz * dz;
        if (d2 < bestDistSq && d2 <= r2) {
            bestDistSq = d2;
            bestPeer = peerId;
        }
    }

    return bestPeer ? { peerId: bestPeer, distSq: bestDistSq } : null;
}

/**
 * Resolve authority for a single entity based on proximity.
 * Applies hysteresis: current owner keeps it unless new peer is 20% closer.
 * @param {Object} auth
 * @param {number|string} entityId
 * @param {number} x - Entity world X
 * @param {number} z - Entity world Z
 * @returns {{ ownerId: string|null, isDormant: boolean }}
 */
export function resolveAuthority(auth, entityId, x, z) {
    const nearest = _nearestPeer(auth, x, z);

    if (!nearest) {
        // No peer is within zone range — entity is dormant
        auth._dormantSet.add(entityId);
        auth._autoAuthority.delete(entityId);
        return { ownerId: null, isDormant: true };
    }

    auth._dormantSet.delete(entityId);
    const current = auth._autoAuthority.get(entityId);

    // If no current owner, assign to nearest
    if (!current) {
        auth._autoAuthority.set(entityId, { ownerId: nearest.peerId, since: _advanceWallClock(auth).timestampMs });
        return { ownerId: nearest.peerId, isDormant: false };
    }

    // Current owner still in range?
    const currentPos = auth._peerPositions.get(current.ownerId);
    if (!currentPos) {
        // Current owner disconnected
        auth._autoAuthority.set(entityId, { ownerId: nearest.peerId, since: _advanceWallClock(auth).timestampMs });
        return { ownerId: nearest.peerId, isDormant: false };
    }

    // Same owner — keep
    if (nearest.peerId === current.ownerId) {
        return { ownerId: current.ownerId, isDormant: false };
    }

    // Hysteresis: new peer must be 20% closer than current
    const cdx = currentPos.x - x;
    const cdz = currentPos.z - z;
    const currentDistSq = cdx * cdx + cdz * cdz;
    const threshold = currentDistSq * (1 - HYSTERESIS_DISTANCE_RATIO) * (1 - HYSTERESIS_DISTANCE_RATIO);

    if (nearest.distSq < threshold) {
        // New peer is significantly closer — check hysteresis timer
        const now = _advanceWallClock(auth).timestampMs;
        // Is this a new contender or continuing?
        if (current._pendingPeer === nearest.peerId) {
            if (now - current._pendingSince >= auth.hysteresisMs) {
                // Handoff commits
                auth._autoAuthority.set(entityId, { ownerId: nearest.peerId, since: now });
                return { ownerId: nearest.peerId, isDormant: false };
            }
            // Still waiting
            return { ownerId: current.ownerId, isDormant: false };
        }
        // New contender — start hysteresis timer
        current._pendingPeer = nearest.peerId;
        current._pendingSince = now;
        return { ownerId: current.ownerId, isDormant: false };
    }

    // Not close enough — clear pending
    current._pendingPeer = null;
    current._pendingSince = 0;
    return { ownerId: current.ownerId, isDormant: false };
}

// ── Batch Queries ────────────────────────────────────────────────────────────

/**
 * Get all entity IDs that the local peer is authoritative over.
 * Uses the auto-authority map (resolved at RESOLVE_INTERVAL_MS).
 * @param {Object} auth
 * @returns {Set<number|string>}
 */
export function getMyAuthoritySet(auth) {
    const result = new Set();
    for (const [entityId, autoAuth] of auth._autoAuthority) {
        if (autoAuth.ownerId === auth.selfId) {
            result.add(entityId);
        }
    }
    return result;
}

/**
 * Get all entity IDs within the local peer's interest area (zone × interestMultiplier).
 * @param {Object} auth
 * @returns {Set<number|string>}
 */
export function getMyInterestSet(auth) {
    const myPos = auth._peerPositions.get(auth.selfId);
    if (!myPos) return new Set();
    const interestRadius = auth.zoneRadius * auth.interestMultiplier;
    return gridQueryRadius(auth._entityGrid, myPos.x, myPos.z, interestRadius);
}

/**
 * Get the interest set for a specific peer (used by relay host for filtering).
 * @param {Object} auth
 * @param {string} peerId
 * @returns {Set<number|string>}
 */
export function getPeerInterestSet(auth, peerId) {
    const pos = auth._peerPositions.get(peerId);
    if (!pos) return new Set();
    const interestRadius = auth.zoneRadius * auth.interestMultiplier;
    return gridQueryRadius(auth._entityGrid, pos.x, pos.z, interestRadius);
}

/**
 * Check if an entity position is within the local peer's authority zone.
 * @param {Object} auth
 * @param {number} x
 * @param {number} z
 * @returns {boolean}
 */
export function isInMyZone(auth, x, z) {
    const myPos = auth._peerPositions.get(auth.selfId);
    if (!myPos) return false;
    const dx = myPos.x - x;
    const dz = myPos.z - z;
    return (dx * dx + dz * dz) <= (auth.zoneRadius * auth.zoneRadius);
}

/**
 * Check if an entity position is within the buffer zone (boundary ring).
 * @param {Object} auth
 * @param {number} x
 * @param {number} z
 * @returns {boolean}
 */
export function isInBufferZone(auth, x, z) {
    const myPos = auth._peerPositions.get(auth.selfId);
    if (!myPos) return false;
    const dx = myPos.x - x;
    const dz = myPos.z - z;
    const d2 = dx * dx + dz * dz;
    const innerRadius = auth.zoneRadius * (1 - auth.bufferRatio);
    return d2 > innerRadius * innerRadius && d2 <= auth.zoneRadius * auth.zoneRadius;
}

/**
 * Check if an entity is dormant (outside all peer zones).
 * @param {Object} auth
 * @param {number|string} entityId
 * @returns {boolean}
 */
export function isDormant(auth, entityId) {
    return auth._dormantSet.has(entityId);
}

// ── Tick / Resolve ───────────────────────────────────────────────────────────

/**
 * Periodic tick: re-resolve auto-authority for all tracked entities.
 * Call this at ~2Hz from the collab loop (or faster if needed).
 * @param {Object} auth
 * @returns {{ handoffs: Array<{ entityId, fromPeer, toPeer }> }} detected authority changes
 */
export function tickSpatialAuthority(auth) {
    const now = _advanceWallClock(auth).timestampMs;
    const resolveElapsedMs = runtimeMonotonicClockStep(now, auth._lastResolveMs).elapsedMs;
    if (resolveElapsedMs < RESOLVE_INTERVAL_MS) {
        return { handoffs: [] };
    }
    auth._lastResolveMs = now;

    const handoffs = [];

    for (const [entityId, pos] of auth._entityGrid._entityPos) {
        const oldAuth = auth._autoAuthority.get(entityId);
        const oldOwner = oldAuth?.ownerId || null;

        const result = resolveAuthority(auth, entityId, pos.x, pos.z);

        if (result.ownerId !== oldOwner && result.ownerId !== null) {
            handoffs.push({
                entityId,
                fromPeer: oldOwner,
                toPeer: result.ownerId,
            });
        }
    }

    return { handoffs };
}

// ── Cleanup ──────────────────────────────────────────────────────────────────

/**
 * Clear all state (on leave room / exit play mode).
 */
export function destroySpatialAuthority(auth) {
    auth._peerPositions.clear();
    gridClear(auth._entityGrid);
    auth._autoAuthority.clear();
    auth._dormantSet.clear();
    auth._lastResolveMs = 0;
    auth._lastWallClockMs = 0;
}
