// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * AIInfluenceMap.js - Strategic Influence Maps
 * 
 * Features:
 * - Multi-layer influence grids
 * - Propagation and decay
 * - Threat/ally awareness
 * - Terrain analysis (choke points, high ground)
 * - Path cost modification
 */

// ============================================================================
// INFLUENCE MAP
// ============================================================================

/**
 * Create an influence map layer
 * @param {number} width - Grid width
 * @param {number} height - Grid height
 * @param {number} cellSize - World units per cell
 * @param {number[]} origin - World origin [x, z]
 * @returns {Object} Influence layer
 */
export function createInfluenceLayer(width, height, cellSize, origin = [0, 0]) {
  const size = width * height;
  return {
    width,
    height,
    cellSize,
    origin: [...origin],
    data: new Float32Array(size),
    _scratch: new Float32Array(size), // Reusable buffer for propagation (reduce/reuse/recycle)
  };
}

/**
 * Create a multi-layer influence map
 * @param {number} width - Grid width
 * @param {number} height - Grid height
 * @param {number} cellSize - World units per cell
 * @param {number[]} origin - World origin
 * @returns {Object} Influence map
 */
export function createInfluenceMap(width, height, cellSize, origin = [0, 0]) {
  return {
    width,
    height,
    cellSize,
    origin: [...origin],
    layers: new Map(),
    
    // Standard layers
    threat: createInfluenceLayer(width, height, cellSize, origin),
    ally: createInfluenceLayer(width, height, cellSize, origin),
    cover: createInfluenceLayer(width, height, cellSize, origin),
    visibility: createInfluenceLayer(width, height, cellSize, origin),
    patrol: createInfluenceLayer(width, height, cellSize, origin),
    reserved: createInfluenceLayer(width, height, cellSize, origin), // Path reservations
  };
}

/**
 * World position to grid cell
 * @param {Object} map - Influence map/layer
 * @param {number} worldX - World X
 * @param {number} worldZ - World Z
 * @returns {{x: number, y: number, valid: boolean}} Grid coords
 */
export function worldToInfluenceCell(map, worldX, worldZ) {
  const x = Math.floor((worldX - map.origin[0]) / map.cellSize);
  const y = Math.floor((worldZ - map.origin[1]) / map.cellSize);
  const valid = x >= 0 && y >= 0 && x < map.width && y < map.height;
  return { x, y, valid };
}

/**
 * Grid cell to world position (center of cell)
 * @param {Object} map - Influence map/layer
 * @param {number} cellX - Cell X
 * @param {number} cellY - Cell Y
 * @returns {{x: number, z: number}} World position
 */
export function influenceCellToWorld(map, cellX, cellY) {
  return {
    x: map.origin[0] + (cellX + 0.5) * map.cellSize,
    z: map.origin[1] + (cellY + 0.5) * map.cellSize,
  };
}

/**
 * Get influence value at world position
 * @param {Object} layer - Influence layer
 * @param {number} worldX - World X
 * @param {number} worldZ - World Z
 * @returns {number} Influence value
 */
export function getInfluenceAt(layer, worldX, worldZ) {
  const cell = worldToInfluenceCell(layer, worldX, worldZ);
  if (!cell.valid) return 0;
  return layer.data[cell.y * layer.width + cell.x];
}

/**
 * Set influence value at world position
 * @param {Object} layer - Influence layer
 * @param {number} worldX - World X
 * @param {number} worldZ - World Z
 * @param {number} value - Influence value
 */
export function setInfluenceAt(layer, worldX, worldZ, value) {
  const cell = worldToInfluenceCell(layer, worldX, worldZ);
  if (!cell.valid) return;
  layer.data[cell.y * layer.width + cell.x] = value;
}

/**
 * Add influence at world position
 * @param {Object} layer - Influence layer
 * @param {number} worldX - World X
 * @param {number} worldZ - World Z
 * @param {number} value - Value to add
 */
export function addInfluenceAt(layer, worldX, worldZ, value) {
  const cell = worldToInfluenceCell(layer, worldX, worldZ);
  if (!cell.valid) return;
  layer.data[cell.y * layer.width + cell.x] += value;
}

// ============================================================================
// INFLUENCE PROPAGATION
// ============================================================================

/**
 * Stamp circular influence at position
 * @param {Object} layer - Influence layer
 * @param {number} worldX - Center X
 * @param {number} worldZ - Center Z
 * @param {number} radius - World radius
 * @param {number} value - Peak value at center
 * @param {string} falloff - "linear", "quadratic", "constant"
 */
export function stampInfluence(layer, worldX, worldZ, radius, value, falloff = "linear") {
  const cellRadius = Math.ceil(radius / layer.cellSize);
  const center = worldToInfluenceCell(layer, worldX, worldZ);
  if (!center.valid) return;
  
  for (let dy = -cellRadius; dy <= cellRadius; dy++) {
    for (let dx = -cellRadius; dx <= cellRadius; dx++) {
      const cx = center.x + dx;
      const cy = center.y + dy;
      
      if (cx < 0 || cy < 0 || cx >= layer.width || cy >= layer.height) continue;
      
      const dist = Math.sqrt(dx * dx + dy * dy) * layer.cellSize;
      if (dist > radius) continue;
      
      let strength;
      switch (falloff) {
        case "quadratic":
          strength = value * (1 - (dist / radius) ** 2);
          break;
        case "constant":
          strength = value;
          break;
        case "linear":
        default:
          strength = value * (1 - dist / radius);
      }
      
      layer.data[cy * layer.width + cx] += strength;
    }
  }
}

/**
 * Propagate influence to neighboring cells (blur/spread)
 * @param {Object} layer - Influence layer
 * @param {number} decayFactor - Decay per propagation step (0-1)
 */
export function propagateInfluence(layer, decayFactor = 0.9) {
  // Reuse scratch buffer instead of allocating new array each call
  const newData = layer._scratch || (layer._scratch = new Float32Array(layer.data.length));
  
  for (let y = 0; y < layer.height; y++) {
    for (let x = 0; x < layer.width; x++) {
      const idx = y * layer.width + x;
      let maxNeighbor = 0;
      
      // Check 8 neighbors
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= layer.width || ny >= layer.height) continue;
          
          const neighborVal = layer.data[ny * layer.width + nx];
          maxNeighbor = Math.max(maxNeighbor, neighborVal * decayFactor);
        }
      }
      
      // Keep current value if higher, otherwise spread
      newData[idx] = Math.max(layer.data[idx], maxNeighbor);
    }
  }
  
  layer.data.set(newData);
}

/**
 * Decay all influence values
 * @param {Object} layer - Influence layer
 * @param {number} decayRate - Amount to decay per call
 */
export function decayInfluence(layer, decayRate = 0.1) {
  for (let i = 0; i < layer.data.length; i++) {
    layer.data[i] = Math.max(0, layer.data[i] - decayRate);
  }
}

/**
 * Clear all influence
 * @param {Object} layer - Influence layer
 */
export function clearInfluence(layer) {
  layer.data.fill(0);
}

// ============================================================================
// INFLUENCE QUERIES
// ============================================================================

/**
 * Find position with lowest influence in radius
 * @param {Object} layer - Influence layer
 * @param {number} worldX - Center X
 * @param {number} worldZ - Center Z
 * @param {number} searchRadius - Search radius in world units
 * @returns {{x: number, z: number, value: number}|null} Best position
 */
export function findLowestInfluence(layer, worldX, worldZ, searchRadius) {
  const cellRadius = Math.ceil(searchRadius / layer.cellSize);
  const center = worldToInfluenceCell(layer, worldX, worldZ);
  
  let bestPos = null;
  let lowestValue = Infinity;
  
  for (let dy = -cellRadius; dy <= cellRadius; dy++) {
    for (let dx = -cellRadius; dx <= cellRadius; dx++) {
      const cx = center.x + dx;
      const cy = center.y + dy;
      
      if (cx < 0 || cy < 0 || cx >= layer.width || cy >= layer.height) continue;
      
      const dist = Math.sqrt(dx * dx + dy * dy) * layer.cellSize;
      if (dist > searchRadius) continue;
      
      const value = layer.data[cy * layer.width + cx];
      if (value < lowestValue) {
        lowestValue = value;
        const worldPos = influenceCellToWorld(layer, cx, cy);
        bestPos = { x: worldPos.x, z: worldPos.z, value };
      }
    }
  }
  
  return bestPos;
}

/**
 * Find position with highest influence in radius
 * @param {Object} layer - Influence layer
 * @param {number} worldX - Center X
 * @param {number} worldZ - Center Z
 * @param {number} searchRadius - Search radius
 * @returns {{x: number, z: number, value: number}|null} Best position
 */
export function findHighestInfluence(layer, worldX, worldZ, searchRadius) {
  const cellRadius = Math.ceil(searchRadius / layer.cellSize);
  const center = worldToInfluenceCell(layer, worldX, worldZ);
  
  let bestPos = null;
  let highestValue = -Infinity;
  
  for (let dy = -cellRadius; dy <= cellRadius; dy++) {
    for (let dx = -cellRadius; dx <= cellRadius; dx++) {
      const cx = center.x + dx;
      const cy = center.y + dy;
      
      if (cx < 0 || cy < 0 || cx >= layer.width || cy >= layer.height) continue;
      
      const dist = Math.sqrt(dx * dx + dy * dy) * layer.cellSize;
      if (dist > searchRadius) continue;
      
      const value = layer.data[cy * layer.width + cx];
      if (value > highestValue) {
        highestValue = value;
        const worldPos = influenceCellToWorld(layer, cx, cy);
        bestPos = { x: worldPos.x, z: worldPos.z, value };
      }
    }
  }
  
  return bestPos;
}

/**
 * Sample combined influence from multiple layers
 * @param {Object} map - Influence map
 * @param {number} worldX - World X
 * @param {number} worldZ - World Z
 * @param {Object} weights - Layer weights {threat: 1, ally: -1, cover: 0.5}
 * @returns {number} Combined influence
 */
export function sampleCombinedInfluence(map, worldX, worldZ, weights) {
  let total = 0;
  
  for (const [layerName, weight] of Object.entries(weights)) {
    const layer = map[layerName] || map.layers.get(layerName);
    if (!layer) continue;
    
    total += getInfluenceAt(layer, worldX, worldZ) * weight;
  }
  
  return total;
}

// ============================================================================
// TACTICAL ANALYSIS
// ============================================================================

/**
 * Analyze terrain for choke points
 * @param {Object} walkabilityGrid - Grid with walkable cells marked
 * @param {Object} influenceMap - Influence map to store results
 * @returns {Array<{x: number, z: number, score: number}>} Choke points
 */
export function findChokePoints(walkabilityGrid, influenceMap) {
  const chokePoints = [];
  
  for (let y = 1; y < walkabilityGrid.height - 1; y++) {
    for (let x = 1; x < walkabilityGrid.width - 1; x++) {
      const idx = y * walkabilityGrid.width + x;
      if (!walkabilityGrid.data[idx]) continue; // Not walkable
      
      // Count walkable neighbors in cardinal directions
      const cardinalWalkable =
        (walkabilityGrid.data[(y - 1) * walkabilityGrid.width + x] ? 1 : 0) +
        (walkabilityGrid.data[(y + 1) * walkabilityGrid.width + x] ? 1 : 0) +
        (walkabilityGrid.data[y * walkabilityGrid.width + (x - 1)] ? 1 : 0) +
        (walkabilityGrid.data[y * walkabilityGrid.width + (x + 1)] ? 1 : 0);
      
      // Choke points have exactly 2 walkable neighbors in opposing directions
      if (cardinalWalkable === 2) {
        const north = walkabilityGrid.data[(y - 1) * walkabilityGrid.width + x];
        const south = walkabilityGrid.data[(y + 1) * walkabilityGrid.width + x];
        const east = walkabilityGrid.data[y * walkabilityGrid.width + (x + 1)];
        const west = walkabilityGrid.data[y * walkabilityGrid.width + (x - 1)];
        
        const isVerticalCorridor = north && south && !east && !west;
        const isHorizontalCorridor = !north && !south && east && west;
        
        if (isVerticalCorridor || isHorizontalCorridor) {
          const worldPos = influenceCellToWorld(influenceMap, x, y);
          chokePoints.push({
            x: worldPos.x,
            z: worldPos.z,
            score: 1.0,
            direction: isVerticalCorridor ? "vertical" : "horizontal",
          });
        }
      }
    }
  }
  
  return chokePoints;
}

/**
 * Update threat layer from enemy positions
 * @param {Object} map - Influence map
 * @param {Array<{position: number[], dangerRadius: number}>} enemies - Enemy data
 */
export function updateThreatInfluence(map, enemies) {
  clearInfluence(map.threat);
  
  for (const enemy of enemies) {
    const radius = enemy.dangerRadius || 15;
    stampInfluence(map.threat, enemy.position[0], enemy.position[2], radius, 1.0, "linear");
  }
  
  propagateInfluence(map.threat, 0.8);
}

/**
 * Update ally layer from friendly positions
 * @param {Object} map - Influence map
 * @param {Array<{position: number[]}>} allies - Ally data
 */
export function updateAllyInfluence(map, allies) {
  clearInfluence(map.ally);
  
  for (const ally of allies) {
    stampInfluence(map.ally, ally.position[0], ally.position[2], 10, 1.0, "linear");
  }
}

/**
 * Reserve a path on the influence map
 * @param {Object} map - Influence map
 * @param {Array<{x: number, z: number}>} path - Path waypoints
 * @param {number} reserveValue - Reservation strength
 */
export function reservePath(map, path, reserveValue = 1.0) {
  for (const point of path) {
    stampInfluence(map.reserved, point.x, point.z, map.cellSize * 2, reserveValue, "constant");
  }
}

/**
 * Clear path reservation
 * @param {Object} map - Influence map
 */
export function clearPathReservations(map) {
  clearInfluence(map.reserved);
}
