// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * CollabEntityAuthority.js
 * Per-entity ownership model for collaborative multiplayer.
 *
 * Every entity has at most one "owner" peer. The owner is the sole source
 * of truth for that entity's transform, physics, and interactive state.
 * Ownership transfers via explicit claim/release ops — no server needed.
 *
 * Priority levels (higher number wins):
 *   0 DEFAULT   — physics authority (host) owns unclaimed entities
 *   1 PROXIMITY — auto-assigned to nearest peer's camera (future)
 *   2 SELECTED  — peer clicked/selected the entity in the inspector
 *   3 GRABBED   — peer is actively dragging/manipulating the entity
 *
 * Conflict resolution:
 *   - Higher priority always wins (grab beats select beats proximity)
 *   - Equal priority: earlier timestamp wins (first-come-first-served)
 *   - Owner can always release voluntarily
 *   - Stale claims (no refresh for STALE_TIMEOUT_MS) are auto-released
 *
 * Inspired by: Photon Takeover policy, Gaffer on Games authority scheme,
 * Roblox Network Ownership, Source Engine shadow controllers.
 */

import { runtimeMonotonicClockStep } from '../core/math/FrameMath.js';
import { clamp } from '../core/math/MathScalar.js';

// ── Constants ────────────────────────────────────────────────────────────────

export const AUTHORITY_PRIORITY = {
    DEFAULT:   0,
    PROXIMITY: 1,
    SELECTED:  2,
    GRABBED:   3,
};

const STALE_TIMEOUT_MS     = 2000;  // auto-release if owner sends no refresh
const CLAIM_REFRESH_MS     = 500;   // owners re-broadcast claim at this rate
const HANDOFF_BLEND_MS     = 100;   // smooth blend duration on ownership transfer
const MAX_CLAIMS_PER_PEER  = 16;    // prevent one peer from claiming everything

function _advanceWallClock(auth) {
    const clock = runtimeMonotonicClockStep(Date.now(), auth._lastWallClockMs);
    auth._lastWallClockMs = clock.timestampMs;
    return clock;
}

function _advancePerformanceClock(auth) {
    const clock = runtimeMonotonicClockStep(performance.now(), auth._lastPerformanceClockMs);
    auth._lastPerformanceClockMs = clock.timestampMs;
    return clock;
}

// ── State ────────────────────────────────────────────────────────────────────

/**
 * Create an entity authority state object.
 * @param {string} selfId - This peer's unique ID
 * @returns {Object} authority state
 */
export function createEntityAuthority(selfId) {
    return {
        selfId,
        // entityId -> { ownerId, priority, ts, lastRefresh }
        _claims: new Map(),
        // entityId -> { prevOwner, transferTs, blendDuration }
        _handoffs: new Map(),
        // Outbound: claims we own that need periodic refresh
        _localClaims: new Map(), // entityId -> { priority, ts }
        _lastRefreshMs: 0,
        _lastWallClockMs: 0,
        _lastPerformanceClockMs: 0,
        // Callbacks
        _onOwnershipChanged: null, // (entityId, newOwnerId, oldOwnerId, priority) => void
    };
}

// ── Queries ──────────────────────────────────────────────────────────────────

/**
 * Get the current owner of an entity.
 * @returns {{ ownerId: string, priority: number }|null}
 */
export function getEntityOwner(auth, entityId) {
    const claim = auth._claims.get(entityId);
    if (!claim) return null;
    return { ownerId: claim.ownerId, priority: claim.priority };
}

/**
 * Check if the local peer owns an entity.
 */
export function isLocallyOwned(auth, entityId) {
    const claim = auth._claims.get(entityId);
    return claim != null && claim.ownerId === auth.selfId;
}

/**
 * Check if an entity is owned by anyone (not default authority).
 */
export function isEntityClaimed(auth, entityId) {
    return auth._claims.has(entityId);
}

/**
 * Get all entities owned by a specific peer.
 * @returns {number[]} array of entity IDs
 */
export function getEntitiesOwnedBy(auth, peerId) {
    const result = [];
    for (const [entityId, claim] of auth._claims) {
        if (claim.ownerId === peerId) result.push(entityId);
    }
    return result;
}

/**
 * Get all locally owned entity IDs as a Set (for fast lookup in sync loops).
 */
export function getLocallyOwnedSet(auth) {
    const set = new Set();
    for (const [entityId, claim] of auth._claims) {
        if (claim.ownerId === auth.selfId) set.add(entityId);
    }
    return set;
}

/**
 * Check if the local peer should broadcast transforms for an entity.
 * Returns true if: (a) we own it, or (b) nobody owns it and we're play authority.
 */
export function shouldBroadcastEntity(auth, entityId, isPlayAuthority) {
    const claim = auth._claims.get(entityId);
    if (!claim) return isPlayAuthority; // unclaimed → default authority broadcasts
    return claim.ownerId === auth.selfId;
}

/**
 * Check if the local peer should accept remote transforms for an entity.
 * Returns true if we do NOT own it.
 */
export function shouldAcceptRemoteTransform(auth, entityId) {
    const claim = auth._claims.get(entityId);
    if (!claim) return true; // unclaimed → accept from authority
    return claim.ownerId !== auth.selfId;
}

// ── Local Claims (outbound) ──────────────────────────────────────────────────

/**
 * Claim ownership of an entity at a given priority.
 * Returns the op to broadcast, or null if claim was rejected locally.
 */
export function claimEntity(auth, entityId, priority) {
    const now = _advanceWallClock(auth).timestampMs;
    const existing = auth._claims.get(entityId);

    // Check if someone else has a higher-priority claim
    if (existing && existing.ownerId !== auth.selfId) {
        if (existing.priority > priority) return null; // rejected: higher priority holds it
        if (existing.priority === priority) {
            // At GRABBED priority, allow concurrent claims — tug-of-war is resolved by
            // competing spring forces in the physics sim, not by exclusive ownership.
            // At lower priorities (SELECTED, PROXIMITY), first-timestamp wins.
            if (priority < AUTHORITY_PRIORITY.GRABBED) {
                const existingAgeMs = runtimeMonotonicClockStep(now, existing.ts).elapsedMs;
                if (existingAgeMs > 50) return null; // first-come-first-served for non-grab
            }
            // GRABBED: fall through — allow this peer to also claim (both forces apply)
        }
    }

    // Check max claims per peer
    if (!existing || existing.ownerId !== auth.selfId) {
        let localCount = 0;
        for (const claim of auth._claims.values()) {
            if (claim.ownerId === auth.selfId) localCount++;
        }
        if (localCount >= MAX_CLAIMS_PER_PEER) return null;
    }

    const oldOwner = existing?.ownerId || null;
    const claim = { ownerId: auth.selfId, priority, ts: now, lastRefresh: now };
    auth._claims.set(entityId, claim);
    auth._localClaims.set(entityId, { priority, ts: now });

    // Set up smooth handoff if previous owner was different
    if (oldOwner && oldOwner !== auth.selfId) {
        auth._handoffs.set(entityId, {
            prevOwner: oldOwner,
            transferTs: _advancePerformanceClock(auth).timestampMs,
            blendDuration: HANDOFF_BLEND_MS,
        });
    }

    // Fire callback
    if (auth._onOwnershipChanged) {
        auth._onOwnershipChanged(entityId, auth.selfId, oldOwner, priority);
    }

    return {
        type: 'entity_authority',
        payload: { action: 'claim', entityId, peerId: auth.selfId, priority, ts: now },
    };
}

/**
 * Release ownership of an entity. Reverts to default authority.
 * Returns the op to broadcast, or null if we didn't own it.
 */
export function releaseEntity(auth, entityId) {
    const existing = auth._claims.get(entityId);
    if (!existing || existing.ownerId !== auth.selfId) return null;

    auth._claims.delete(entityId);
    auth._localClaims.delete(entityId);
    auth._handoffs.delete(entityId);

    if (auth._onOwnershipChanged) {
        auth._onOwnershipChanged(entityId, null, auth.selfId, AUTHORITY_PRIORITY.DEFAULT);
    }

    return {
        type: 'entity_authority',
        payload: { action: 'release', entityId, peerId: auth.selfId },
    };
}

/**
 * Release ALL claims owned by the local peer (e.g. on disconnect or exit play mode).
 * Returns array of ops to broadcast.
 */
export function releaseAllLocal(auth) {
    const ops = [];
    for (const [entityId, claim] of auth._claims) {
        if (claim.ownerId === auth.selfId) {
            ops.push({
                type: 'entity_authority',
                payload: { action: 'release', entityId, peerId: auth.selfId },
            });
        }
    }
    auth._claims.clear();
    auth._localClaims.clear();
    auth._handoffs.clear();
    return ops;
}

// ── Remote Claims (inbound) ──────────────────────────────────────────────────

/**
 * Handle an incoming entity_authority op from a remote peer.
 * Applies the claim/release to local state after conflict resolution.
 * Returns true if the claim was accepted.
 */
export function onRemoteAuthorityOp(auth, op) {
    if (!op || op.type !== 'entity_authority' || !op.payload) return false;

    const { action, entityId, peerId, priority, ts } = op.payload;

    if (action === 'release') {
        const existing = auth._claims.get(entityId);
        if (existing && existing.ownerId === peerId) {
            auth._claims.delete(entityId);
            auth._handoffs.delete(entityId);
            if (auth._onOwnershipChanged) {
                auth._onOwnershipChanged(entityId, null, peerId, AUTHORITY_PRIORITY.DEFAULT);
            }
        }
        return true;
    }

    if (action === 'claim') {
        const now = _advanceWallClock(auth).timestampMs;
        const numericTimestamp = Number(ts);
        const claimTimestamp = Number.isFinite(numericTimestamp) && numericTimestamp > 0
            ? numericTimestamp
            : now;
        const existing = auth._claims.get(entityId);

        if (existing) {
            // Conflict resolution
            if (existing.ownerId === auth.selfId) {
                // We own it — do they have higher priority?
                if (priority > existing.priority) {
                    // They win — yield ownership
                    auth._localClaims.delete(entityId);
                } else if (priority === existing.priority && claimTimestamp < existing.ts) {
                    // Equal priority, they were first — yield
                    auth._localClaims.delete(entityId);
                } else {
                    // We keep it — reject their claim
                    return false;
                }
            } else if (existing.ownerId !== peerId) {
                // Third party owns it — higher priority wins
                if (priority < existing.priority) return false;
                if (priority === existing.priority && claimTimestamp >= existing.ts) return false;
            }
        }

        const oldOwner = existing?.ownerId || null;
        auth._claims.set(entityId, {
            ownerId: peerId,
            priority,
            ts: claimTimestamp,
            lastRefresh: now,
        });

        // Smooth handoff
        if (oldOwner && oldOwner !== peerId) {
            auth._handoffs.set(entityId, {
                prevOwner: oldOwner,
                transferTs: _advancePerformanceClock(auth).timestampMs,
                blendDuration: HANDOFF_BLEND_MS,
            });
        }

        if (auth._onOwnershipChanged) {
            auth._onOwnershipChanged(entityId, peerId, oldOwner, priority);
        }
        return true;
    }

    return false;
}

// ── Maintenance ──────────────────────────────────────────────────────────────

/**
 * Build refresh ops for all local claims (call at ~2Hz from the collab loop).
 * Also prunes stale remote claims.
 * @returns {Object[]} array of ops to broadcast
 */
export function tickAuthority(auth) {
    const now = _advanceWallClock(auth).timestampMs;
    const ops = [];

    // Prune stale remote claims
    for (const [entityId, claim] of auth._claims) {
        if (claim.ownerId === auth.selfId) continue; // our own claims never stale
        const staleMs = runtimeMonotonicClockStep(now, claim.lastRefresh).elapsedMs;
        if (staleMs > STALE_TIMEOUT_MS) {
            auth._claims.delete(entityId);
            auth._handoffs.delete(entityId);
            if (auth._onOwnershipChanged) {
                auth._onOwnershipChanged(entityId, null, claim.ownerId, AUTHORITY_PRIORITY.DEFAULT);
            }
        }
    }

    // Prune expired handoffs
    const perfNow = _advancePerformanceClock(auth).timestampMs;
    for (const [entityId, handoff] of auth._handoffs) {
        const handoffAgeMs = runtimeMonotonicClockStep(perfNow, handoff.transferTs).elapsedMs;
        if (handoffAgeMs > handoff.blendDuration) {
            auth._handoffs.delete(entityId);
        }
    }

    // Refresh local claims
    const refreshClock = runtimeMonotonicClockStep(now, auth._lastRefreshMs);
    if (refreshClock.elapsedMs >= CLAIM_REFRESH_MS) {
        auth._lastRefreshMs = refreshClock.timestampMs;
        for (const [entityId, local] of auth._localClaims) {
            ops.push({
                type: 'entity_authority',
                payload: {
                    action: 'claim',
                    entityId,
                    peerId: auth.selfId,
                    priority: local.priority,
                    ts: local.ts,
                },
            });
            // Update lastRefresh on our own claim
            const claim = auth._claims.get(entityId);
            if (claim) claim.lastRefresh = now;
        }
    }

    return ops;
}

/**
 * Handle a peer disconnecting — release all their claims.
 */
export function onPeerDisconnected(auth, peerId) {
    for (const [entityId, claim] of auth._claims) {
        if (claim.ownerId === peerId) {
            auth._claims.delete(entityId);
            auth._handoffs.delete(entityId);
            if (auth._onOwnershipChanged) {
                auth._onOwnershipChanged(entityId, null, peerId, AUTHORITY_PRIORITY.DEFAULT);
            }
        }
    }
}

/**
 * Get handoff blend factor for an entity (0 = fully old owner, 1 = fully new owner).
 * Used by interpolation to smoothly blend during ownership transfer.
 */
export function getHandoffBlend(auth, entityId) {
    const handoff = auth._handoffs.get(entityId);
    if (!handoff) return 1.0; // no handoff in progress → fully new owner
    const now = _advancePerformanceClock(auth).timestampMs;
    const elapsedMs = runtimeMonotonicClockStep(now, handoff.transferTs).elapsedMs;
    const blendDurationMs = Number(handoff.blendDuration);
    if (!Number.isFinite(blendDurationMs) || blendDurationMs <= 0) return 1.0;
    return clamp(elapsedMs / blendDurationMs, 0, 1);
}

/**
 * Set callback for ownership changes.
 */
export function onOwnershipChanged(auth, callback) {
    auth._onOwnershipChanged = callback;
}

/**
 * Destroy / reset authority state.
 */
export function destroyEntityAuthority(auth) {
    auth._claims.clear();
    auth._localClaims.clear();
    auth._handoffs.clear();
    auth._lastRefreshMs = 0;
    auth._lastWallClockMs = 0;
    auth._lastPerformanceClockMs = 0;
    auth._onOwnershipChanged = null;
}
