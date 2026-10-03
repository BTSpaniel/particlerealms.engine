/**
 * GPUSceneQuery.js — GPU Scene Queries (Overlap, Sweep, Shape Cast)
 * 
 * PhysX-style scene query system for spatial queries against the physics world.
 * Supports overlap tests, sweep/shape casts, and multi-hit collection.
 * 
 * Features:
 * - Sphere/Box/Capsule overlap tests (find all bodies overlapping a shape)
 * - Sphere/Box sweep (shape cast along a direction, find first/all hits)
 * - Closest-hit and multi-hit modes
 * - Layer/mask filtering
 * - CPU-side for low-latency (synchronous results), uses CPU shadow data
 * 
 * Based on:
 * - PhysX PxScene::overlap(), sweep(), raycast()
 * - PhysX PxOverlapBuffer, PxSweepBuffer
 * - Jolt NarrowPhaseQuery: CastShape, CollideShape
 * 
 * CPU-only implementation (not GPU compute) because:
 * - Scene queries are typically 1-10 per frame (not thousands)
 * - Need synchronous results (gameplay logic depends on them immediately)
 * - GPU readback latency would negate the benefit
 */

import {
    SHAPE_SPHERE, SHAPE_BOX, SHAPE_CAPSULE,
    SIM_STATIC,
} from './GPURigidBodyWorld.js';

// ============================================================================
// CONSTANTS
// ============================================================================

export const QUERY_CLOSEST = 0;
export const QUERY_ALL     = 1;
export const QUERY_ANY     = 2; // Boolean: does anything overlap?

const MAX_QUERY_RESULTS = 256;

// ============================================================================
// SCENE QUERY CLASS
// ============================================================================

export class GPUSceneQuery {
    /**
     * @param {GPURigidBodyWorld} world
     */
    constructor(world) {
        this.world = world;
    }

    // ========================================================================
    // OVERLAP TESTS
    // ========================================================================

    /**
     * Find all bodies overlapping a sphere.
     * @param {number[]} center - [x, y, z]
     * @param {number} radius
     * @param {Object} [filter] - { layerMask, excludeBody, includeSleeping, includeStatic, includeTriggers }
     * @returns {Array<{ bodyIndex: number, entityId: any }>}
     */
    overlapSphere(center, radius, filter = {}) {
        const results = [];
        const w = this.world;
        const pos = w._cpuPositions;
        const colliders = w._cpuColliders;
        const flags = w._cpuFlags;
        const colliderU32 = new Uint32Array(colliders.buffer);

        for (let i = 0; i < w.bodyCount; i++) {
            if (!this._passFilter(i, filter)) continue;

            const bx = pos[i * 4], by = pos[i * 4 + 1], bz = pos[i * 4 + 2];
            const ci = i * 16;
            const shape = colliderU32[ci];

            let overlap = false;

            if (shape === SHAPE_SPHERE) {
                const br = colliders[ci + 4];
                const dx = bx - center[0], dy = by - center[1], dz = bz - center[2];
                const dist2 = dx * dx + dy * dy + dz * dz;
                const totalR = radius + br;
                overlap = dist2 <= totalR * totalR;
            } else if (shape === SHAPE_BOX) {
                const heX = colliders[ci + 1], heY = colliders[ci + 2], heZ = colliders[ci + 3];
                // Sphere-AABB overlap (ignoring box rotation for CPU fallback)
                const cx = Math.max(bx - heX, Math.min(center[0], bx + heX));
                const cy = Math.max(by - heY, Math.min(center[1], by + heY));
                const cz = Math.max(bz - heZ, Math.min(center[2], bz + heZ));
                const dx = center[0] - cx, dy = center[1] - cy, dz = center[2] - cz;
                overlap = (dx * dx + dy * dy + dz * dz) <= radius * radius;
            } else if (shape === SHAPE_CAPSULE) {
                const br = colliders[ci + 4];
                const hh = colliders[ci + 5];
                // Simplified: capsule as sphere of radius (hh + br)
                const totalR = radius + br + hh;
                const dx = bx - center[0], dy = by - center[1], dz = bz - center[2];
                overlap = (dx * dx + dy * dy + dz * dz) <= totalR * totalR;
            }

            if (overlap) {
                const desc = w.bodyDescriptions[i];
                results.push({ bodyIndex: i, entityId: desc?.entityId ?? null });
                if (results.length >= MAX_QUERY_RESULTS) break;
            }
        }

        return results;
    }

    /**
     * Find all bodies overlapping a box (AABB).
     * @param {number[]} center - [x, y, z]
     * @param {number[]} halfExtents - [hx, hy, hz]
     * @param {Object} [filter]
     * @returns {Array<{ bodyIndex: number, entityId: any }>}
     */
    overlapBox(center, halfExtents, filter = {}) {
        const results = [];
        const w = this.world;
        const pos = w._cpuPositions;
        const colliders = w._cpuColliders;
        const colliderU32 = new Uint32Array(colliders.buffer);

        const qMinX = center[0] - halfExtents[0];
        const qMinY = center[1] - halfExtents[1];
        const qMinZ = center[2] - halfExtents[2];
        const qMaxX = center[0] + halfExtents[0];
        const qMaxY = center[1] + halfExtents[1];
        const qMaxZ = center[2] + halfExtents[2];

        for (let i = 0; i < w.bodyCount; i++) {
            if (!this._passFilter(i, filter)) continue;

            const bx = pos[i * 4], by = pos[i * 4 + 1], bz = pos[i * 4 + 2];
            const ci = i * 16;
            const shape = colliderU32[ci];

            let bMinX, bMinY, bMinZ, bMaxX, bMaxY, bMaxZ;

            if (shape === SHAPE_SPHERE) {
                const r = colliders[ci + 4];
                bMinX = bx - r; bMinY = by - r; bMinZ = bz - r;
                bMaxX = bx + r; bMaxY = by + r; bMaxZ = bz + r;
            } else if (shape === SHAPE_BOX) {
                const heX = colliders[ci + 1], heY = colliders[ci + 2], heZ = colliders[ci + 3];
                bMinX = bx - heX; bMinY = by - heY; bMinZ = bz - heZ;
                bMaxX = bx + heX; bMaxY = by + heY; bMaxZ = bz + heZ;
            } else if (shape === SHAPE_CAPSULE) {
                const r = colliders[ci + 4];
                const hh = colliders[ci + 5];
                bMinX = bx - r; bMinY = by - hh - r; bMinZ = bz - r;
                bMaxX = bx + r; bMaxY = by + hh + r; bMaxZ = bz + r;
            } else {
                const heX = colliders[ci + 1], heY = colliders[ci + 2], heZ = colliders[ci + 3];
                bMinX = bx - heX; bMinY = by - heY; bMinZ = bz - heZ;
                bMaxX = bx + heX; bMaxY = by + heY; bMaxZ = bz + heZ;
            }

            const overlap = qMinX <= bMaxX && qMaxX >= bMinX
                && qMinY <= bMaxY && qMaxY >= bMinY
                && qMinZ <= bMaxZ && qMaxZ >= bMinZ;

            if (overlap) {
                const desc = w.bodyDescriptions[i];
                results.push({ bodyIndex: i, entityId: desc?.entityId ?? null });
                if (results.length >= MAX_QUERY_RESULTS) break;
            }
        }

        return results;
    }

    /**
     * Boolean overlap test: does anything overlap the sphere?
     */
    overlapSphereAny(center, radius, filter = {}) {
        const hits = this.overlapSphere(center, radius, { ...filter, _maxResults: 1 });
        return hits.length > 0;
    }

    /**
     * Boolean overlap test: does anything overlap the box?
     */
    overlapBoxAny(center, halfExtents, filter = {}) {
        const hits = this.overlapBox(center, halfExtents, { ...filter, _maxResults: 1 });
        return hits.length > 0;
    }

    // ========================================================================
    // SWEEP / SHAPE CAST
    // ========================================================================

    /**
     * Sphere sweep (shape cast): move a sphere along a direction, find first hit.
     * @param {number[]} origin - Sphere center start
     * @param {number} radius - Sphere radius
     * @param {number[]} direction - Normalized direction
     * @param {number} maxDistance
     * @param {Object} [filter]
     * @returns {{ hit: boolean, distance: number, position: number[], normal: number[], bodyIndex: number, entityId: any }}
     */
    sweepSphere(origin, radius, direction, maxDistance = 100, filter = {}) {
        const w = this.world;
        const pos = w._cpuPositions;
        const colliders = w._cpuColliders;
        const colliderU32 = new Uint32Array(colliders.buffer);

        let bestDist = maxDistance;
        let bestIdx = -1;
        let bestNormal = [0, 0, 0];
        let bestPoint = [0, 0, 0];

        const ox = origin[0], oy = origin[1], oz = origin[2];
        const dx = direction[0], dy = direction[1], dz = direction[2];

        for (let i = 0; i < w.bodyCount; i++) {
            if (!this._passFilter(i, filter)) continue;

            const bx = pos[i * 4], by = pos[i * 4 + 1], bz = pos[i * 4 + 2];
            const ci = i * 16;
            const shape = colliderU32[ci];

            let t = -1;
            let normal = [0, 1, 0];

            if (shape === SHAPE_SPHERE) {
                // Sphere-sphere sweep: effectively a ray-sphere with inflated radius
                const br = colliders[ci + 4];
                t = this._raySphereInflated(ox, oy, oz, dx, dy, dz, bx, by, bz, radius + br);
                if (t >= 0 && t < bestDist) {
                    const hx = ox + dx * t, hy = oy + dy * t, hz = oz + dz * t;
                    const len = Math.sqrt((hx - bx) ** 2 + (hy - by) ** 2 + (hz - bz) ** 2) || 1;
                    normal = [(hx - bx) / len, (hy - by) / len, (hz - bz) / len];
                }
            } else if (shape === SHAPE_BOX) {
                // Sphere-box sweep: inflate box by sphere radius, raycast
                const heX = colliders[ci + 1] + radius;
                const heY = colliders[ci + 2] + radius;
                const heZ = colliders[ci + 3] + radius;
                t = this._rayAABB(ox, oy, oz, dx, dy, dz,
                    bx - heX, by - heY, bz - heZ,
                    bx + heX, by + heY, bz + heZ);
                if (t >= 0 && t < bestDist) {
                    normal = this._boxNormal(ox + dx * t, oy + dy * t, oz + dz * t, bx, by, bz, heX, heY, heZ);
                }
            } else if (shape === SHAPE_CAPSULE) {
                // Simplified: inflate capsule radius
                const br = colliders[ci + 4] + radius;
                t = this._raySphereInflated(ox, oy, oz, dx, dy, dz, bx, by, bz, br + colliders[ci + 5]);
                if (t >= 0 && t < bestDist) {
                    const hx = ox + dx * t, hy = oy + dy * t, hz = oz + dz * t;
                    const len = Math.sqrt((hx - bx) ** 2 + (hy - by) ** 2 + (hz - bz) ** 2) || 1;
                    normal = [(hx - bx) / len, (hy - by) / len, (hz - bz) / len];
                }
            }

            if (t >= 0 && t < bestDist) {
                bestDist = t;
                bestIdx = i;
                bestNormal = normal;
                bestPoint = [ox + dx * t, oy + dy * t, oz + dz * t];
            }
        }

        const desc = bestIdx >= 0 ? w.bodyDescriptions[bestIdx] : null;
        return {
            hit: bestIdx >= 0,
            distance: bestIdx >= 0 ? bestDist : maxDistance,
            position: bestPoint,
            normal: bestNormal,
            bodyIndex: bestIdx,
            entityId: desc?.entityId ?? null,
        };
    }

    /**
     * Box sweep: move an AABB along a direction, find first hit.
     * @param {number[]} origin - Box center start
     * @param {number[]} halfExtents
     * @param {number[]} direction - Normalized
     * @param {number} maxDistance
     * @param {Object} [filter]
     */
    sweepBox(origin, halfExtents, direction, maxDistance = 100, filter = {}) {
        const w = this.world;
        const pos = w._cpuPositions;
        const colliders = w._cpuColliders;
        const colliderU32 = new Uint32Array(colliders.buffer);

        let bestDist = maxDistance;
        let bestIdx = -1;
        let bestNormal = [0, 0, 0];
        let bestPoint = [0, 0, 0];

        const ox = origin[0], oy = origin[1], oz = origin[2];
        const dx = direction[0], dy = direction[1], dz = direction[2];
        const hx = halfExtents[0], hy = halfExtents[1], hz = halfExtents[2];

        for (let i = 0; i < w.bodyCount; i++) {
            if (!this._passFilter(i, filter)) continue;

            const bx = pos[i * 4], by = pos[i * 4 + 1], bz = pos[i * 4 + 2];
            const ci = i * 16;
            const shape = colliderU32[ci];

            // Minkowski sum: inflate body AABB by sweep box half extents
            let bheX, bheY, bheZ;
            if (shape === SHAPE_SPHERE) {
                const r = colliders[ci + 4];
                bheX = r + hx; bheY = r + hy; bheZ = r + hz;
            } else if (shape === SHAPE_BOX) {
                bheX = colliders[ci + 1] + hx;
                bheY = colliders[ci + 2] + hy;
                bheZ = colliders[ci + 3] + hz;
            } else if (shape === SHAPE_CAPSULE) {
                const r = colliders[ci + 4];
                const hh = colliders[ci + 5];
                bheX = r + hx; bheY = hh + r + hy; bheZ = r + hz;
            } else {
                bheX = colliders[ci + 1] + hx;
                bheY = colliders[ci + 2] + hy;
                bheZ = colliders[ci + 3] + hz;
            }

            const t = this._rayAABB(ox, oy, oz, dx, dy, dz,
                bx - bheX, by - bheY, bz - bheZ,
                bx + bheX, by + bheY, bz + bheZ);

            if (t >= 0 && t < bestDist) {
                bestDist = t;
                bestIdx = i;
                bestNormal = this._boxNormal(ox + dx * t, oy + dy * t, oz + dz * t, bx, by, bz, bheX, bheY, bheZ);
                bestPoint = [ox + dx * t, oy + dy * t, oz + dz * t];
            }
        }

        const desc = bestIdx >= 0 ? w.bodyDescriptions[bestIdx] : null;
        return {
            hit: bestIdx >= 0,
            distance: bestIdx >= 0 ? bestDist : maxDistance,
            position: bestPoint,
            normal: bestNormal,
            bodyIndex: bestIdx,
            entityId: desc?.entityId ?? null,
        };
    }

    /**
     * Multi-hit sphere sweep: find ALL hits along the path.
     */
    sweepSphereAll(origin, radius, direction, maxDistance = 100, filter = {}) {
        const w = this.world;
        const pos = w._cpuPositions;
        const colliders = w._cpuColliders;
        const colliderU32 = new Uint32Array(colliders.buffer);
        const results = [];

        const ox = origin[0], oy = origin[1], oz = origin[2];
        const dx = direction[0], dy = direction[1], dz = direction[2];

        for (let i = 0; i < w.bodyCount; i++) {
            if (!this._passFilter(i, filter)) continue;

            const bx = pos[i * 4], by = pos[i * 4 + 1], bz = pos[i * 4 + 2];
            const ci = i * 16;
            const shape = colliderU32[ci];
            let t = -1;

            if (shape === SHAPE_SPHERE) {
                t = this._raySphereInflated(ox, oy, oz, dx, dy, dz, bx, by, bz, radius + colliders[ci + 4]);
            } else if (shape === SHAPE_BOX) {
                const heX = colliders[ci + 1] + radius;
                const heY = colliders[ci + 2] + radius;
                const heZ = colliders[ci + 3] + radius;
                t = this._rayAABB(ox, oy, oz, dx, dy, dz, bx - heX, by - heY, bz - heZ, bx + heX, by + heY, bz + heZ);
            }

            if (t >= 0 && t <= maxDistance) {
                const desc = w.bodyDescriptions[i];
                results.push({
                    bodyIndex: i,
                    entityId: desc?.entityId ?? null,
                    distance: t,
                    position: [ox + dx * t, oy + dy * t, oz + dz * t],
                });
            }
            if (results.length >= MAX_QUERY_RESULTS) break;
        }

        results.sort((a, b) => a.distance - b.distance);
        return results;
    }

    // ========================================================================
    // FILTER
    // ========================================================================

    _passFilter(bodyIdx, filter) {
        const w = this.world;
        const desc = w.bodyDescriptions[bodyIdx];
        if (!desc?.active) return false;

        const flags = w._cpuFlags[bodyIdx];
        const simMode = flags & 0x3;
        const isSleeping = (flags & 0x4) !== 0;
        const isTrigger = (flags & 0x1000000) !== 0;

        if (filter.excludeBody === bodyIdx) return false;
        if (filter.excludeBodies?.includes(bodyIdx)) return false;
        if (!filter.includeSleeping && isSleeping) return false;
        if (!filter.includeStatic && simMode === SIM_STATIC) return false;
        if (!filter.includeTriggers && isTrigger) return false;

        if (filter.layerMask !== undefined) {
            const bodyLayer = (flags >> 8) & 0xFF;
            if ((filter.layerMask & bodyLayer) === 0) return false;
        }

        if (filter.entityIds) {
            if (!filter.entityIds.includes(desc.entityId)) return false;
        }

        return true;
    }

    // ========================================================================
    // MATH HELPERS
    // ========================================================================

    _raySphereInflated(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
        const ocx = ox - cx, ocy = oy - cy, ocz = oz - cz;
        const b = ocx * dx + ocy * dy + ocz * dz;
        const c = ocx * ocx + ocy * ocy + ocz * ocz - r * r;
        const disc = b * b - c;
        if (disc < 0) return -1;
        const sqrtD = Math.sqrt(disc);
        const t0 = -b - sqrtD;
        const t1 = -b + sqrtD;
        return t0 >= 0 ? t0 : (t1 >= 0 ? t1 : -1);
    }

    _rayAABB(ox, oy, oz, dx, dy, dz, minX, minY, minZ, maxX, maxY, maxZ) {
        const invDx = dx !== 0 ? 1 / dx : (dx >= 0 ? 1e10 : -1e10);
        const invDy = dy !== 0 ? 1 / dy : (dy >= 0 ? 1e10 : -1e10);
        const invDz = dz !== 0 ? 1 / dz : (dz >= 0 ? 1e10 : -1e10);
        const t1x = (minX - ox) * invDx, t2x = (maxX - ox) * invDx;
        const t1y = (minY - oy) * invDy, t2y = (maxY - oy) * invDy;
        const t1z = (minZ - oz) * invDz, t2z = (maxZ - oz) * invDz;
        const tmin = Math.max(Math.min(t1x, t2x), Math.min(t1y, t2y), Math.min(t1z, t2z));
        const tmax = Math.min(Math.max(t1x, t2x), Math.max(t1y, t2y), Math.max(t1z, t2z));
        if (tmax < 0 || tmin > tmax) return -1;
        return tmin >= 0 ? tmin : tmax;
    }

    _boxNormal(hitX, hitY, hitZ, boxX, boxY, boxZ, heX, heY, heZ) {
        const dx = (hitX - boxX) / heX;
        const dy = (hitY - boxY) / heY;
        const dz = (hitZ - boxZ) / heZ;
        const ax = Math.abs(dx), ay = Math.abs(dy), az = Math.abs(dz);
        if (ax > ay && ax > az) return [Math.sign(dx), 0, 0];
        if (ay > az) return [0, Math.sign(dy), 0];
        return [0, 0, Math.sign(dz)];
    }
}

// ============================================================================
// FACTORY
// ============================================================================

export function createSceneQuery(world) {
    return new GPUSceneQuery(world);
}
