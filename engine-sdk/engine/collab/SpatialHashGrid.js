// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * SpatialHashGrid.js
 * O(1) spatial lookup grid for interest management and zone queries.
 *
 * Uses a 2D grid (XZ plane) where each cell stores a Set of entity IDs.
 * Supports radius and AABB queries without iterating all entities.
 *
 * Inspired by: Photon Fusion AoI grid, SpatialOS worker partitioning.
 */

import { finiteNumberReport } from '../core/math/MathValidation.js';
import { clamp } from '../core/math/MathScalar.js';

export const SPATIAL_HASH_GRID_LIMITS = Object.freeze({
    defaultCellSize: 50,
    minCellSize: 1e-6,
    maxCellSize: 1e9,
    maxCoordinateMagnitude: 1e12,
    maxIdBytes: 256,
    maxEntities: 100000,
    maxQueryCells: 65536,
});

const _encoder = new TextEncoder();

function _positiveInteger(value, fallback, max) {
    const report = finiteNumberReport(value, { integer: true, min: 1, max });
    return report.valid ? report.value : fallback;
}

export function spatialHashGridIdReport(id) {
    if (typeof id === 'number') {
        const report = finiteNumberReport(id, { integer: true, min: Number.MIN_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER });
        return { valid: report.valid, id, reason: report.valid ? 'valid' : 'invalid-number-id' };
    }
    if (typeof id === 'string') {
        const bytes = _encoder.encode(id).byteLength;
        const valid = id.length > 0 && bytes <= SPATIAL_HASH_GRID_LIMITS.maxIdBytes;
        return { valid, id, bytes, reason: valid ? 'valid' : (id.length === 0 ? 'empty-id' : 'id-too-large') };
    }
    return { valid: false, id, reason: 'invalid-id-type' };
}

export function spatialHashGridPointReport(grid, x, z) {
    const xReport = finiteNumberReport(x, {
        min: -SPATIAL_HASH_GRID_LIMITS.maxCoordinateMagnitude,
        max: SPATIAL_HASH_GRID_LIMITS.maxCoordinateMagnitude,
    });
    const zReport = finiteNumberReport(z, {
        min: -SPATIAL_HASH_GRID_LIMITS.maxCoordinateMagnitude,
        max: SPATIAL_HASH_GRID_LIMITS.maxCoordinateMagnitude,
    });
    if (!grid || grid._destroyed || !xReport.valid || !zReport.valid) {
        return { valid: false, x, z, cx: 0, cz: 0, reason: grid?._destroyed ? 'destroyed-grid' : 'invalid-point' };
    }
    const cx = Math.floor(xReport.value * grid._invCellSize);
    const cz = Math.floor(zReport.value * grid._invCellSize);
    const valid = Number.isSafeInteger(cx) && Number.isSafeInteger(cz);
    return { valid, x: xReport.value, z: zReport.value, cx, cz, reason: valid ? 'valid' : 'unsafe-cell-coordinate' };
}

function _queryPlan(grid, minX, minZ, maxX, maxZ) {
    const min = spatialHashGridPointReport(grid, minX, minZ);
    const max = spatialHashGridPointReport(grid, maxX, maxZ);
    if (!min.valid || !max.valid || min.x > max.x || min.z > max.z) {
        return { valid: false, reason: !min.valid ? min.reason : (!max.valid ? max.reason : 'reversed-bounds') };
    }
    const width = max.cx - min.cx + 1;
    const depth = max.cz - min.cz + 1;
    const safeSpan = Number.isSafeInteger(width) && Number.isSafeInteger(depth) && width > 0 && depth > 0;
    const cellCount = safeSpan && width <= SPATIAL_HASH_GRID_LIMITS.maxQueryCells
        ? width * depth
        : Number.POSITIVE_INFINITY;
    const direct = Number.isSafeInteger(cellCount) && cellCount <= grid.maxQueryCells;
    return { valid: true, minCx: min.cx, minCz: min.cz, maxCx: max.cx, maxCz: max.cz, width, depth, cellCount, direct, reason: 'valid' };
}

// ── Create ───────────────────────────────────────────────────────────────────

/**
 * Create a spatial hash grid.
 * @param {number} cellSize - Side length of each grid cell (world units)
 * @returns {Object} grid state
 */
export function createSpatialHashGrid(cellSize, options = {}) {
    const cell = finiteNumberReport(cellSize, {
        min: SPATIAL_HASH_GRID_LIMITS.minCellSize,
        max: SPATIAL_HASH_GRID_LIMITS.maxCellSize,
    });
    const acceptedCellSize = cell.valid ? cell.value : SPATIAL_HASH_GRID_LIMITS.defaultCellSize;
    return {
        cellSize: acceptedCellSize,
        maxEntities: _positiveInteger(options.maxEntities, SPATIAL_HASH_GRID_LIMITS.maxEntities, SPATIAL_HASH_GRID_LIMITS.maxEntities),
        maxQueryCells: _positiveInteger(options.maxQueryCells, SPATIAL_HASH_GRID_LIMITS.maxQueryCells, SPATIAL_HASH_GRID_LIMITS.maxQueryCells),
        _invCellSize: 1 / acceptedCellSize,
        _cells: new Map(),       // "cx,cz" -> Set<id>
        _entityPos: new Map(),   // id -> { x, z, cellKey }
        _destroyed: false,
        _stats: {
            inserts: 0,
            updates: 0,
            removes: 0,
            queries: 0,
            scanFallbacks: 0,
            rejected: 0,
            capacityRejected: 0,
        },
    };
}

// ── Cell key helpers ─────────────────────────────────────────────────────────

function _cellKey(cx, cz) {
    return cx + ',' + cz;
}

function _toCell(grid, x, z) {
    return spatialHashGridPointReport(grid, x, z);
}

// ── Insert / Update / Remove ─────────────────────────────────────────────────

/**
 * Insert an entity into the grid.
 * @param {Object} grid
 * @param {number|string} id - Entity ID
 * @param {number} x - World X position
 * @param {number} z - World Z position
 */
export function gridInsert(grid, id, x, z) {
    if (!grid || grid._destroyed) return false;
    const idReport = spatialHashGridIdReport(id);
    const point = _toCell(grid, x, z);
    if (!idReport.valid || !point.valid) {
        grid._stats.rejected++;
        return false;
    }

    const existing = grid._entityPos.get(id);
    if (!existing && grid._entityPos.size >= grid.maxEntities) {
        grid._stats.capacityRejected++;
        return false;
    }
    const key = _cellKey(point.cx, point.cz);
    if (existing && existing.cellKey === key) {
        grid._entityPos.set(id, { x: point.x, z: point.z, cellKey: key });
        grid._stats.updates++;
        return true;
    }

    // Admission completes before the old membership is changed.
    if (existing) {
        const oldCell = grid._cells.get(existing.cellKey);
        if (oldCell) {
            oldCell.delete(id);
            if (oldCell.size === 0) grid._cells.delete(existing.cellKey);
        }
    }

    let cell = grid._cells.get(key);
    if (!cell) {
        cell = new Set();
        grid._cells.set(key, cell);
    }
    cell.add(id);

    grid._entityPos.set(id, { x: point.x, z: point.z, cellKey: key });
    if (existing) grid._stats.updates++;
    else grid._stats.inserts++;
    return true;
}

/**
 * Update an entity's position. Alias for insert (handles cell migration).
 */
export const gridUpdate = gridInsert;

/**
 * Remove an entity from the grid.
 * @param {Object} grid
 * @param {number|string} id
 */
export function gridRemove(grid, id) {
    if (!grid || grid._destroyed || !spatialHashGridIdReport(id).valid) return false;
    const existing = grid._entityPos.get(id);
    if (!existing) return false;

    const cell = grid._cells.get(existing.cellKey);
    if (cell) {
        cell.delete(id);
        if (cell.size === 0) grid._cells.delete(existing.cellKey);
    }

    grid._entityPos.delete(id);
    grid._stats.removes++;
    return true;
}

/**
 * Clear all entities from the grid.
 */
export function gridClear(grid) {
    if (!grid || grid._destroyed) return false;
    grid._cells.clear();
    grid._entityPos.clear();
    return true;
}

// ── Queries ──────────────────────────────────────────────────────────────────

/**
 * Query all entity IDs within a radius of a point (XZ plane).
 * Returns entities whose grid position is within the radius.
 * @param {Object} grid
 * @param {number} x - Center X
 * @param {number} z - Center Z
 * @param {number} radius
 * @returns {Set<number|string>} matching entity IDs
 */
export function gridQueryRadius(grid, x, z, radius) {
    const result = new Set();
    if (!grid || grid._destroyed) return result;
    const center = spatialHashGridPointReport(grid, x, z);
    const radiusReport = finiteNumberReport(radius, {
        min: 0,
        max: SPATIAL_HASH_GRID_LIMITS.maxCoordinateMagnitude,
    });
    if (!center.valid || !radiusReport.valid) {
        grid._stats.rejected++;
        return result;
    }
    const acceptedRadius = radiusReport.value;
    const r2 = acceptedRadius * acceptedRadius;
    const coordinateLimit = SPATIAL_HASH_GRID_LIMITS.maxCoordinateMagnitude;
    const plan = _queryPlan(
        grid,
        clamp(center.x - acceptedRadius, -coordinateLimit, coordinateLimit),
        clamp(center.z - acceptedRadius, -coordinateLimit, coordinateLimit),
        clamp(center.x + acceptedRadius, -coordinateLimit, coordinateLimit),
        clamp(center.z + acceptedRadius, -coordinateLimit, coordinateLimit)
    );
    grid._stats.queries++;
    if (!plan.valid) {
        grid._stats.rejected++;
        return result;
    }

    if (!plan.direct) {
        grid._stats.scanFallbacks++;
        for (const [id, pos] of grid._entityPos) {
            const dx = pos.x - center.x;
            const dz = pos.z - center.z;
            if (dx * dx + dz * dz <= r2) result.add(id);
        }
        return result;
    }
    for (let cx = plan.minCx; cx <= plan.maxCx; cx++) {
        for (let cz = plan.minCz; cz <= plan.maxCz; cz++) {
            const cell = grid._cells.get(_cellKey(cx, cz));
            if (!cell) continue;
            for (const id of cell) {
                const pos = grid._entityPos.get(id);
                if (!pos) continue;
                const dx = pos.x - center.x;
                const dz = pos.z - center.z;
                if (dx * dx + dz * dz <= r2) {
                    result.add(id);
                }
            }
        }
    }

    return result;
}

/**
 * Query all entity IDs within an axis-aligned bounding box (XZ plane).
 * @param {Object} grid
 * @param {number} minX
 * @param {number} minZ
 * @param {number} maxX
 * @param {number} maxZ
 * @returns {Set<number|string>}
 */
export function gridQueryRect(grid, minX, minZ, maxX, maxZ) {
    const result = new Set();
    if (!grid || grid._destroyed) return result;
    const plan = _queryPlan(grid, minX, minZ, maxX, maxZ);
    grid._stats.queries++;
    if (!plan.valid) {
        grid._stats.rejected++;
        return result;
    }
    if (!plan.direct) {
        grid._stats.scanFallbacks++;
        for (const [id, pos] of grid._entityPos) {
            if (pos.x >= minX && pos.x <= maxX && pos.z >= minZ && pos.z <= maxZ) result.add(id);
        }
        return result;
    }
    for (let cx = plan.minCx; cx <= plan.maxCx; cx++) {
        for (let cz = plan.minCz; cz <= plan.maxCz; cz++) {
            const cell = grid._cells.get(_cellKey(cx, cz));
            if (!cell) continue;
            for (const id of cell) {
                const pos = grid._entityPos.get(id);
                if (!pos) continue;
                if (pos.x >= minX && pos.x <= maxX && pos.z >= minZ && pos.z <= maxZ) {
                    result.add(id);
                }
            }
        }
    }

    return result;
}

/**
 * Get the stored position for an entity.
 * @returns {{ x: number, z: number }|null}
 */
export function gridGetPosition(grid, id) {
    if (!grid || grid._destroyed || !spatialHashGridIdReport(id).valid) return null;
    const pos = grid._entityPos.get(id);
    return pos ? { x: pos.x, z: pos.z } : null;
}

/**
 * Get the total number of entities in the grid.
 */
export function gridSize(grid) {
    return grid && !grid._destroyed ? grid._entityPos.size : 0;
}

export function gridGetStats(grid) {
    if (!grid) return null;
    return {
        cellSize: grid.cellSize,
        entities: grid._entityPos.size,
        cells: grid._cells.size,
        maxEntities: grid.maxEntities,
        maxQueryCells: grid.maxQueryCells,
        destroyed: grid._destroyed,
        stats: { ...grid._stats },
    };
}

export function destroySpatialHashGrid(grid) {
    if (!grid || grid._destroyed) return false;
    grid._cells.clear();
    grid._entityPos.clear();
    grid._destroyed = true;
    return true;
}

// Explicit gaps: this remains an in-memory XZ point index without persistence,
// multi-cell extents, nearest-neighbor ordering, or concurrent worker ownership.
