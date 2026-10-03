// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * AITerrain.js - Terrain Analysis and Navigation Costs
 * 
 * Features:
 * - Terrain type classification
 * - Movement cost calculation
 * - Stealth/visibility modifiers
 * - Tactical terrain evaluation
 * - Height advantage calculation
 * - Chokepoint and ambush detection
 */

// ============================================================================
// CONSTANTS
// ============================================================================

/** Terrain types */
export const TERRAIN_TYPE = {
  ROAD: "road",
  GRASS: "grass",
  DIRT: "dirt",
  SAND: "sand",
  SNOW: "snow",
  WATER_SHALLOW: "water_shallow",
  WATER_DEEP: "water_deep",
  MUD: "mud",
  ROCK: "rock",
  FOREST: "forest",
  SWAMP: "swamp",
  LAVA: "lava",
  ICE: "ice",
  VOID: "void",
};

/** Terrain properties */
const TERRAIN_PROPERTIES = {
  [TERRAIN_TYPE.ROAD]: { 
    moveCost: 0.8, sprintMod: 1.2, stealthMod: 0.7, noiseMod: 1.0, 
    coverValue: 0, concealment: 0, hazard: 0 
  },
  [TERRAIN_TYPE.GRASS]: { 
    moveCost: 1.0, sprintMod: 1.0, stealthMod: 1.0, noiseMod: 0.8, 
    coverValue: 0, concealment: 0.2, hazard: 0 
  },
  [TERRAIN_TYPE.DIRT]: { 
    moveCost: 1.0, sprintMod: 1.0, stealthMod: 0.9, noiseMod: 0.9, 
    coverValue: 0, concealment: 0, hazard: 0 
  },
  [TERRAIN_TYPE.SAND]: { 
    moveCost: 1.4, sprintMod: 0.7, stealthMod: 0.8, noiseMod: 0.6, 
    coverValue: 0, concealment: 0, hazard: 0 
  },
  [TERRAIN_TYPE.SNOW]: { 
    moveCost: 1.3, sprintMod: 0.8, stealthMod: 0.6, noiseMod: 0.7, 
    coverValue: 0, concealment: 0.1, hazard: 0.1 
  },
  [TERRAIN_TYPE.WATER_SHALLOW]: { 
    moveCost: 1.5, sprintMod: 0.5, stealthMod: 0.5, noiseMod: 1.5, 
    coverValue: 0, concealment: 0, hazard: 0.1 
  },
  [TERRAIN_TYPE.WATER_DEEP]: { 
    moveCost: 3.0, sprintMod: 0.2, stealthMod: 0.3, noiseMod: 1.2, 
    coverValue: 0.5, concealment: 0.8, hazard: 0.5 
  },
  [TERRAIN_TYPE.MUD]: { 
    moveCost: 2.0, sprintMod: 0.4, stealthMod: 0.6, noiseMod: 1.3, 
    coverValue: 0, concealment: 0, hazard: 0.2 
  },
  [TERRAIN_TYPE.ROCK]: { 
    moveCost: 1.2, sprintMod: 0.9, stealthMod: 0.8, noiseMod: 1.2, 
    coverValue: 0.3, concealment: 0.1, hazard: 0.1 
  },
  [TERRAIN_TYPE.FOREST]: { 
    moveCost: 1.3, sprintMod: 0.7, stealthMod: 1.4, noiseMod: 0.9, 
    coverValue: 0.4, concealment: 0.6, hazard: 0 
  },
  [TERRAIN_TYPE.SWAMP]: { 
    moveCost: 2.5, sprintMod: 0.3, stealthMod: 0.7, noiseMod: 1.4, 
    coverValue: 0.2, concealment: 0.5, hazard: 0.3 
  },
  [TERRAIN_TYPE.LAVA]: { 
    moveCost: Infinity, sprintMod: 0, stealthMod: 0, noiseMod: 0, 
    coverValue: 0, concealment: 0, hazard: 1.0 
  },
  [TERRAIN_TYPE.ICE]: { 
    moveCost: 1.1, sprintMod: 1.3, stealthMod: 0.5, noiseMod: 0.5, 
    coverValue: 0, concealment: 0, hazard: 0.3 
  },
  [TERRAIN_TYPE.VOID]: { 
    moveCost: Infinity, sprintMod: 0, stealthMod: 0, noiseMod: 0, 
    coverValue: 0, concealment: 0, hazard: 1.0 
  },
};

// ============================================================================
// TERRAIN GRID
// ============================================================================

/**
 * Create terrain grid
 * @param {number} width - Grid width
 * @param {number} height - Grid height
 * @param {number} cellSize - World units per cell
 * @returns {Object} Terrain grid
 */
export function createTerrainGrid(width, height, cellSize) {
  return {
    width,
    height,
    cellSize,
    
    // Terrain type per cell
    types: new Uint8Array(width * height),
    
    // Height per cell (for elevation)
    heights: new Float32Array(width * height),
    
    // Cached tactical data
    tacticalCache: null,
    cacheValid: false,
  };
}

/**
 * Set terrain type at cell
 * @param {Object} grid - Terrain grid
 * @param {number} x - Cell X
 * @param {number} y - Cell Y
 * @param {string} type - Terrain type
 */
export function setTerrainType(grid, x, y, type) {
  if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return;
  
  const typeIndex = Object.values(TERRAIN_TYPE).indexOf(type);
  grid.types[y * grid.width + x] = typeIndex >= 0 ? typeIndex : 0;
  grid.cacheValid = false;
}

/**
 * Get terrain type at cell
 * @param {Object} grid - Terrain grid
 * @param {number} x - Cell X
 * @param {number} y - Cell Y
 * @returns {string} Terrain type
 */
export function getTerrainType(grid, x, y) {
  if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return TERRAIN_TYPE.VOID;
  
  const typeIndex = grid.types[y * grid.width + x];
  return Object.values(TERRAIN_TYPE)[typeIndex] || TERRAIN_TYPE.GRASS;
}

/**
 * Set height at cell
 * @param {Object} grid - Terrain grid
 * @param {number} x - Cell X
 * @param {number} y - Cell Y
 * @param {number} height - Height value
 */
export function setTerrainHeight(grid, x, y, height) {
  if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return;
  grid.heights[y * grid.width + x] = height;
  grid.cacheValid = false;
}

/**
 * Get height at cell
 * @param {Object} grid - Terrain grid
 * @param {number} x - Cell X
 * @param {number} y - Cell Y
 * @returns {number} Height
 */
export function getTerrainHeight(grid, x, y) {
  if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return 0;
  return grid.heights[y * grid.width + x];
}

/**
 * World to grid coordinates
 * @param {Object} grid - Terrain grid
 * @param {number} worldX - World X
 * @param {number} worldZ - World Z
 * @returns {{x: number, y: number}}
 */
export function worldToTerrainCell(grid, worldX, worldZ) {
  return {
    x: Math.floor(worldX / grid.cellSize),
    y: Math.floor(worldZ / grid.cellSize),
  };
}

/**
 * Grid to world coordinates (cell center)
 * @param {Object} grid - Terrain grid
 * @param {number} cellX - Cell X
 * @param {number} cellY - Cell Y
 * @returns {{x: number, z: number}}
 */
export function terrainCellToWorld(grid, cellX, cellY) {
  return {
    x: (cellX + 0.5) * grid.cellSize,
    z: (cellY + 0.5) * grid.cellSize,
  };
}

// ============================================================================
// TERRAIN QUERIES
// ============================================================================

/**
 * Get terrain properties at world position
 * @param {Object} grid - Terrain grid
 * @param {number} worldX - World X
 * @param {number} worldZ - World Z
 * @returns {Object} Terrain properties
 */
export function getTerrainPropertiesAt(grid, worldX, worldZ) {
  const cell = worldToTerrainCell(grid, worldX, worldZ);
  const type = getTerrainType(grid, cell.x, cell.y);
  const height = getTerrainHeight(grid, cell.x, cell.y);
  const props = TERRAIN_PROPERTIES[type] || TERRAIN_PROPERTIES[TERRAIN_TYPE.GRASS];
  
  return {
    type,
    height,
    ...props,
  };
}

/**
 * Calculate movement cost between two points
 * @param {Object} grid - Terrain grid
 * @param {number} fromX - Start world X
 * @param {number} fromZ - Start world Z
 * @param {number} toX - End world X
 * @param {number} toZ - End world Z
 * @returns {number} Movement cost
 */
export function calculateMovementCost(grid, fromX, fromZ, toX, toZ) {
  const fromCell = worldToTerrainCell(grid, fromX, fromZ);
  const toCell = worldToTerrainCell(grid, toX, toZ);
  
  const fromType = getTerrainType(grid, fromCell.x, fromCell.y);
  const toType = getTerrainType(grid, toCell.x, toCell.y);
  
  const fromProps = TERRAIN_PROPERTIES[fromType];
  const toProps = TERRAIN_PROPERTIES[toType];
  
  // Average movement cost
  let cost = (fromProps.moveCost + toProps.moveCost) / 2;
  
  // Add slope cost
  const fromHeight = getTerrainHeight(grid, fromCell.x, fromCell.y);
  const toHeight = getTerrainHeight(grid, toCell.x, toCell.y);
  const slopeCost = Math.abs(toHeight - fromHeight) * 0.5;
  cost += slopeCost;
  
  // Distance
  const dx = toX - fromX;
  const dz = toZ - fromZ;
  const dist = Math.sqrt(dx * dx + dz * dz);
  
  return cost * dist;
}

/**
 * Get stealth modifier at position
 * @param {Object} grid - Terrain grid
 * @param {number} worldX - World X
 * @param {number} worldZ - World Z
 * @returns {number} Stealth multiplier (higher = better stealth)
 */
export function getStealthModifier(grid, worldX, worldZ) {
  const props = getTerrainPropertiesAt(grid, worldX, worldZ);
  return props.stealthMod * (1 + props.concealment);
}

/**
 * Get noise modifier at position
 * @param {Object} grid - Terrain grid
 * @param {number} worldX - World X
 * @param {number} worldZ - World Z
 * @returns {number} Noise multiplier (higher = louder)
 */
export function getNoiseModifier(grid, worldX, worldZ) {
  const props = getTerrainPropertiesAt(grid, worldX, worldZ);
  return props.noiseMod;
}

// ============================================================================
// TACTICAL ANALYSIS
// ============================================================================

/**
 * Calculate height advantage
 * @param {Object} grid - Terrain grid
 * @param {number} attackerX - Attacker world X
 * @param {number} attackerZ - Attacker world Z
 * @param {number} defenderX - Defender world X
 * @param {number} defenderZ - Defender world Z
 * @returns {number} Height advantage (-1 to 1, positive = attacker has advantage)
 */
export function calculateHeightAdvantage(grid, attackerX, attackerZ, defenderX, defenderZ) {
  const attackerCell = worldToTerrainCell(grid, attackerX, attackerZ);
  const defenderCell = worldToTerrainCell(grid, defenderX, defenderZ);
  
  const attackerHeight = getTerrainHeight(grid, attackerCell.x, attackerCell.y);
  const defenderHeight = getTerrainHeight(grid, defenderCell.x, defenderCell.y);
  
  const diff = attackerHeight - defenderHeight;
  
  // Normalize to -1 to 1 range (10 unit difference = full advantage)
  return Math.max(-1, Math.min(1, diff / 10));
}

/**
 * Find high ground positions in area
 * @param {Object} grid - Terrain grid
 * @param {number} centerX - Center world X
 * @param {number} centerZ - Center world Z
 * @param {number} radius - Search radius
 * @param {number} count - Max positions to return
 * @returns {Array<{x: number, z: number, height: number}>} High ground positions
 */
export function findHighGround(grid, centerX, centerZ, radius, count = 5) {
  const center = worldToTerrainCell(grid, centerX, centerZ);
  const cellRadius = Math.ceil(radius / grid.cellSize);
  
  const candidates = [];
  
  for (let dy = -cellRadius; dy <= cellRadius; dy++) {
    for (let dx = -cellRadius; dx <= cellRadius; dx++) {
      const cx = center.x + dx;
      const cy = center.y + dy;
      
      if (cx < 0 || cy < 0 || cx >= grid.width || cy >= grid.height) continue;
      
      const worldPos = terrainCellToWorld(grid, cx, cy);
      const distSq = (worldPos.x - centerX) ** 2 + (worldPos.z - centerZ) ** 2;
      
      if (distSq > radius * radius) continue;
      
      const height = getTerrainHeight(grid, cx, cy);
      const type = getTerrainType(grid, cx, cy);
      const props = TERRAIN_PROPERTIES[type];
      
      // Skip impassable
      if (props.moveCost >= 10) continue;
      
      candidates.push({
        x: worldPos.x,
        z: worldPos.z,
        height,
        score: height - Math.sqrt(distSq) * 0.1, // Prefer nearby high ground
      });
    }
  }
  
  // Sort by height, return top N
  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, count).map(c => ({ x: c.x, z: c.z, height: c.height }));
}

/**
 * Find concealment positions
 * @param {Object} grid - Terrain grid
 * @param {number} centerX - Center world X
 * @param {number} centerZ - Center world Z
 * @param {number} radius - Search radius
 * @param {number} count - Max positions
 * @returns {Array<{x: number, z: number, concealment: number}>}
 */
export function findConcealment(grid, centerX, centerZ, radius, count = 5) {
  const center = worldToTerrainCell(grid, centerX, centerZ);
  const cellRadius = Math.ceil(radius / grid.cellSize);
  
  const candidates = [];
  
  for (let dy = -cellRadius; dy <= cellRadius; dy++) {
    for (let dx = -cellRadius; dx <= cellRadius; dx++) {
      const cx = center.x + dx;
      const cy = center.y + dy;
      
      if (cx < 0 || cy < 0 || cx >= grid.width || cy >= grid.height) continue;
      
      const worldPos = terrainCellToWorld(grid, cx, cy);
      const distSq = (worldPos.x - centerX) ** 2 + (worldPos.z - centerZ) ** 2;
      
      if (distSq > radius * radius) continue;
      
      const type = getTerrainType(grid, cx, cy);
      const props = TERRAIN_PROPERTIES[type];
      
      if (props.concealment > 0.2) {
        candidates.push({
          x: worldPos.x,
          z: worldPos.z,
          concealment: props.concealment,
        });
      }
    }
  }
  
  candidates.sort((a, b) => b.concealment - a.concealment);
  return candidates.slice(0, count);
}

/**
 * Detect chokepoints in area
 * @param {Object} grid - Terrain grid
 * @param {number} minX - Min world X
 * @param {number} minZ - Min world Z
 * @param {number} maxX - Max world X
 * @param {number} maxZ - Max world Z
 * @returns {Array<{x: number, z: number, width: number, direction: string}>}
 */
export function detectChokepoints(grid, minX, minZ, maxX, maxZ) {
  const chokepoints = [];
  const minCell = worldToTerrainCell(grid, minX, minZ);
  const maxCell = worldToTerrainCell(grid, maxX, maxZ);
  
  for (let y = minCell.y; y <= maxCell.y; y++) {
    for (let x = minCell.x; x <= maxCell.x; x++) {
      const type = getTerrainType(grid, x, y);
      const props = TERRAIN_PROPERTIES[type];
      
      // Must be passable
      if (props.moveCost >= 10) continue;
      
      // Count passable neighbors in each direction
      const northSouth = countPassableInDirection(grid, x, y, 0, 1) + countPassableInDirection(grid, x, y, 0, -1);
      const eastWest = countPassableInDirection(grid, x, y, 1, 0) + countPassableInDirection(grid, x, y, -1, 0);
      
      // Chokepoint if narrow in one direction
      if ((northSouth <= 2 && eastWest > 4) || (eastWest <= 2 && northSouth > 4)) {
        const worldPos = terrainCellToWorld(grid, x, y);
        chokepoints.push({
          x: worldPos.x,
          z: worldPos.z,
          width: Math.min(northSouth, eastWest) + 1,
          direction: northSouth < eastWest ? "north-south" : "east-west",
        });
      }
    }
  }
  
  return chokepoints;
}

function countPassableInDirection(grid, startX, startY, dx, dy) {
  let count = 0;
  let x = startX + dx;
  let y = startY + dy;
  
  while (x >= 0 && y >= 0 && x < grid.width && y < grid.height && count < 10) {
    const type = getTerrainType(grid, x, y);
    const props = TERRAIN_PROPERTIES[type];
    
    if (props.moveCost >= 10) break;
    
    count++;
    x += dx;
    y += dy;
  }
  
  return count;
}

/**
 * Evaluate tactical position value
 * @param {Object} grid - Terrain grid
 * @param {number} worldX - World X
 * @param {number} worldZ - World Z
 * @param {number[]} threatDirection - Direction threat is coming from
 * @returns {Object} Tactical evaluation
 */
export function evaluateTacticalPosition(grid, worldX, worldZ, threatDirection = null) {
  const props = getTerrainPropertiesAt(grid, worldX, worldZ);
  const cell = worldToTerrainCell(grid, worldX, worldZ);
  const height = getTerrainHeight(grid, cell.x, cell.y);
  
  // Calculate relative height (compared to surroundings)
  let avgSurroundingHeight = 0;
  let count = 0;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      if (dx === 0 && dy === 0) continue;
      avgSurroundingHeight += getTerrainHeight(grid, cell.x + dx, cell.y + dy);
      count++;
    }
  }
  avgSurroundingHeight /= count;
  const relativeHeight = height - avgSurroundingHeight;
  
  // Score position
  let defensiveScore = 0;
  defensiveScore += props.coverValue * 30;
  defensiveScore += props.concealment * 20;
  defensiveScore += Math.max(0, relativeHeight) * 5; // Height advantage
  defensiveScore -= props.hazard * 50;
  
  let mobilityScore = 0;
  mobilityScore += (2 - props.moveCost) * 20; // Lower cost = better
  mobilityScore += props.sprintMod * 10;
  
  return {
    terrain: props.type,
    height,
    relativeHeight,
    cover: props.coverValue,
    concealment: props.concealment,
    hazard: props.hazard,
    defensiveScore,
    mobilityScore,
    overallScore: defensiveScore * 0.6 + mobilityScore * 0.4,
  };
}
