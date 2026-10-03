// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * SpatialHash.js - O(1) spatial queries for target/entity lookups
 * 
 * Features:
 * - Fast radius queries
 * - Efficient insert/update/remove
 * - 3D cell-based hashing
 * - Supports dynamic entities
 */

// ============================================================================
// SPATIAL HASH GRID
// ============================================================================

/**
 * Create a 3D spatial hash grid
 * @param {number} cellSize - Size of each cell (should match typical query radius)
 * @returns {Object} Spatial hash instance
 */
export function createSpatialHash(cellSize = 10) {
  return {
    cellSize,
    invCellSize: 1 / cellSize,
    cells: new Map(),
    entityCells: new Map(), // Track which cell(s) each entity is in
  };
}

/**
 * Generate hash key for a cell coordinate
 * @param {number} cx - Cell X
 * @param {number} cy - Cell Y
 * @param {number} cz - Cell Z
 * @returns {string} Hash key
 */
function hashKey(cx, cy, cz) {
  return `${cx},${cy},${cz}`;
}

/**
 * Get cell coordinates for a world position
 * @param {Object} hash - Spatial hash
 * @param {number} x - World X
 * @param {number} y - World Y
 * @param {number} z - World Z
 * @returns {{cx: number, cy: number, cz: number}} Cell coordinates
 */
function worldToCell(hash, x, y, z) {
  return {
    cx: Math.floor(x * hash.invCellSize),
    cy: Math.floor(y * hash.invCellSize),
    cz: Math.floor(z * hash.invCellSize),
  };
}

/**
 * Insert an entity into the spatial hash
 * @param {Object} hash - Spatial hash
 * @param {Object} entity - Entity with {id, position: [x, y, z], ...}
 */
export function spatialHashInsert(hash, entity) {
  const pos = entity.position;
  const { cx, cy, cz } = worldToCell(hash, pos[0], pos[1], pos[2]);
  const key = hashKey(cx, cy, cz);

  if (!hash.cells.has(key)) {
    hash.cells.set(key, []);
  }
  hash.cells.get(key).push(entity);
  hash.entityCells.set(entity.id, key);
}

/**
 * Remove an entity from the spatial hash
 * @param {Object} hash - Spatial hash
 * @param {number|string} entityId - Entity ID
 */
export function spatialHashRemove(hash, entityId) {
  const key = hash.entityCells.get(entityId);
  if (!key) return;

  const cell = hash.cells.get(key);
  if (cell) {
    const idx = cell.findIndex((e) => e.id === entityId);
    if (idx !== -1) {
      cell.splice(idx, 1);
      if (cell.length === 0) {
        hash.cells.delete(key);
      }
    }
  }
  hash.entityCells.delete(entityId);
}

/**
 * Update an entity's position in the spatial hash
 * @param {Object} hash - Spatial hash
 * @param {Object} entity - Entity with updated position
 */
export function spatialHashUpdate(hash, entity) {
  const oldKey = hash.entityCells.get(entity.id);
  const pos = entity.position;
  const { cx, cy, cz } = worldToCell(hash, pos[0], pos[1], pos[2]);
  const newKey = hashKey(cx, cy, cz);

  // Only update if cell changed
  if (oldKey === newKey) return;

  // Remove from old cell
  if (oldKey) {
    const oldCell = hash.cells.get(oldKey);
    if (oldCell) {
      const idx = oldCell.findIndex((e) => e.id === entity.id);
      if (idx !== -1) {
        oldCell.splice(idx, 1);
        if (oldCell.length === 0) {
          hash.cells.delete(oldKey);
        }
      }
    }
  }

  // Add to new cell
  if (!hash.cells.has(newKey)) {
    hash.cells.set(newKey, []);
  }
  hash.cells.get(newKey).push(entity);
  hash.entityCells.set(entity.id, newKey);
}

/**
 * Query all entities within radius of a point
 * @param {Object} hash - Spatial hash
 * @param {number} x - Query X
 * @param {number} y - Query Y
 * @param {number} z - Query Z
 * @param {number} radius - Query radius
 * @returns {Array<Object>} Entities within radius
 */
export function spatialHashQueryRadius(hash, x, y, z, radius) {
  const results = [];
  const radiusSq = radius * radius;

  // Calculate cell range to search
  const cellRadius = Math.ceil(radius * hash.invCellSize);
  const { cx, cy, cz } = worldToCell(hash, x, y, z);

  for (let dx = -cellRadius; dx <= cellRadius; dx++) {
    for (let dy = -cellRadius; dy <= cellRadius; dy++) {
      for (let dz = -cellRadius; dz <= cellRadius; dz++) {
        const key = hashKey(cx + dx, cy + dy, cz + dz);
        const cell = hash.cells.get(key);
        if (!cell) continue;

        for (const entity of cell) {
          const pos = entity.position;
          const distSq =
            (pos[0] - x) ** 2 +
            (pos[1] - y) ** 2 +
            (pos[2] - z) ** 2;

          if (distSq <= radiusSq) {
            results.push(entity);
          }
        }
      }
    }
  }

  return results;
}

/**
 * Query all entities within radius (2D, ignores Y)
 * @param {Object} hash - Spatial hash
 * @param {number} x - Query X
 * @param {number} z - Query Z
 * @param {number} radius - Query radius
 * @returns {Array<Object>} Entities within radius
 */
export function spatialHashQueryRadius2D(hash, x, z, radius) {
  const results = [];
  const radiusSq = radius * radius;

  // Search all Y levels
  const cellRadius = Math.ceil(radius * hash.invCellSize);
  const { cx, cz } = worldToCell(hash, x, 0, z);

  // Get all unique cells at this XZ
  const searchedKeys = new Set();

  for (const key of hash.cells.keys()) {
    const [cellX, , cellZ] = key.split(",").map(Number);
    const dx = cellX - cx;
    const dz = cellZ - cz;

    if (Math.abs(dx) <= cellRadius && Math.abs(dz) <= cellRadius) {
      const cell = hash.cells.get(key);
      if (!cell) continue;

      for (const entity of cell) {
        const pos = entity.position;
        const distSq = (pos[0] - x) ** 2 + (pos[2] - z) ** 2;

        if (distSq <= radiusSq) {
          results.push(entity);
        }
      }
    }
  }

  return results;
}

/**
 * Query entities in an AABB
 * @param {Object} hash - Spatial hash
 * @param {number[]} min - [x, y, z] minimum corner
 * @param {number[]} max - [x, y, z] maximum corner
 * @returns {Array<Object>} Entities in AABB
 */
export function spatialHashQueryAABB(hash, min, max) {
  const results = [];

  const minCell = worldToCell(hash, min[0], min[1], min[2]);
  const maxCell = worldToCell(hash, max[0], max[1], max[2]);

  for (let cx = minCell.cx; cx <= maxCell.cx; cx++) {
    for (let cy = minCell.cy; cy <= maxCell.cy; cy++) {
      for (let cz = minCell.cz; cz <= maxCell.cz; cz++) {
        const key = hashKey(cx, cy, cz);
        const cell = hash.cells.get(key);
        if (!cell) continue;

        for (const entity of cell) {
          const pos = entity.position;
          if (
            pos[0] >= min[0] && pos[0] <= max[0] &&
            pos[1] >= min[1] && pos[1] <= max[1] &&
            pos[2] >= min[2] && pos[2] <= max[2]
          ) {
            results.push(entity);
          }
        }
      }
    }
  }

  return results;
}

/**
 * Get K nearest neighbors to a point
 * @param {Object} hash - Spatial hash
 * @param {number} x - Query X
 * @param {number} y - Query Y
 * @param {number} z - Query Z
 * @param {number} k - Number of neighbors
 * @param {number} maxRadius - Maximum search radius
 * @returns {Array<{entity: Object, distance: number}>} K nearest entities with distances
 */
export function spatialHashKNearest(hash, x, y, z, k, maxRadius = 100) {
  // Start with small radius, expand until we have k results
  let radius = hash.cellSize;
  let results = [];

  while (radius <= maxRadius && results.length < k) {
    results = spatialHashQueryRadius(hash, x, y, z, radius);
    radius *= 2;
  }

  // Sort by distance and take k
  const withDist = results.map((entity) => {
    const pos = entity.position;
    const dist = Math.sqrt(
      (pos[0] - x) ** 2 +
      (pos[1] - y) ** 2 +
      (pos[2] - z) ** 2
    );
    return { entity, distance: dist };
  });

  withDist.sort((a, b) => a.distance - b.distance);
  return withDist.slice(0, k);
}

/**
 * Clear all entities from the spatial hash
 * @param {Object} hash - Spatial hash
 */
export function spatialHashClear(hash) {
  hash.cells.clear();
  hash.entityCells.clear();
}

/**
 * Get total entity count
 * @param {Object} hash - Spatial hash
 * @returns {number} Total entities
 */
export function spatialHashCount(hash) {
  return hash.entityCells.size;
}

/**
 * Rebuild the spatial hash from an entity array
 * @param {Object} hash - Spatial hash
 * @param {Array<Object>} entities - Array of entities with {id, position}
 */
export function spatialHashRebuild(hash, entities) {
  spatialHashClear(hash);
  for (const entity of entities) {
    spatialHashInsert(hash, entity);
  }
}

// ============================================================================
// OBJECT POOLING
// ============================================================================

/**
 * Create an object pool for reducing GC pressure
 * @param {Function} factory - Factory function to create new objects
 * @param {Function} reset - Function to reset an object before reuse
 * @param {number} initialSize - Initial pool size
 * @returns {Object} Object pool
 */
export function createObjectPool(factory, reset = null, initialSize = 100) {
  const pool = [];
  const active = new Set();

  // Pre-populate pool
  for (let i = 0; i < initialSize; i++) {
    pool.push(factory());
  }

  return {
    pool,
    active,
    factory,
    reset,
  };
}

/**
 * Acquire an object from the pool
 * @param {Object} pool - Object pool
 * @returns {Object} Object from pool (or newly created)
 */
export function poolAcquire(pool) {
  let obj = pool.pool.pop();
  if (!obj) {
    obj = pool.factory();
  }
  pool.active.add(obj);
  return obj;
}

/**
 * Release an object back to the pool
 * @param {Object} pool - Object pool
 * @param {Object} obj - Object to release
 */
export function poolRelease(pool, obj) {
  if (!pool.active.delete(obj)) return;

  if (pool.reset) {
    pool.reset(obj);
  }
  pool.pool.push(obj);
}

/**
 * Release all active objects back to pool
 * @param {Object} pool - Object pool
 */
export function poolReleaseAll(pool) {
  for (const obj of pool.active) {
    if (pool.reset) {
      pool.reset(obj);
    }
    pool.pool.push(obj);
  }
  pool.active.clear();
}

/**
 * Get pool statistics
 * @param {Object} pool - Object pool
 * @returns {{available: number, active: number, total: number}}
 */
export function poolStats(pool) {
  return {
    available: pool.pool.length,
    active: pool.active.size,
    total: pool.pool.length + pool.active.size,
  };
}
