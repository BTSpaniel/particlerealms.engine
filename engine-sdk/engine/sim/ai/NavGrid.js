// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { sampleTerrainHeight } from "../world/WorldSim.js";
import { degreesToRadians } from "../../core/math/UnitMath.js";

export function createNavGrid(options = {}) {
  const name = typeof options.name === "string" ? options.name : "NavGrid";

  const widthRaw = options.width;
  const heightRaw = options.height;
  const cellSizeRaw = options.cellSize;
  const originXRaw = options.originX;
  const originZRaw = options.originZ;

  const width =
    typeof widthRaw === "number" && Number.isFinite(widthRaw) && widthRaw >= 1
      ? widthRaw | 0
      : 64;
  const height =
    typeof heightRaw === "number" && Number.isFinite(heightRaw) && heightRaw >= 1
      ? heightRaw | 0
      : 64;

  const cellSize =
    typeof cellSizeRaw === "number" &&
    Number.isFinite(cellSizeRaw) &&
    cellSizeRaw > 0.01
      ? cellSizeRaw
      : 1;

  const originX =
    typeof originXRaw === "number" && Number.isFinite(originXRaw)
      ? originXRaw
      : 0;
  const originZ =
    typeof originZRaw === "number" && Number.isFinite(originZRaw)
      ? originZRaw
      : 0;

  const cellCount = width * height;
  const walkable = new Uint8Array(cellCount);

  const grid = {
    name,
    width,
    height,
    cellSize,
    originX,
    originZ,
    walkable,
  };

  return grid;
}

export function destroyNavGrid(grid) {
  if (!grid) {
    return;
  }
  grid.walkable = null;
}

export function worldToGrid(grid, worldX, worldZ) {
  if (!grid) {
    return { gx: -1, gz: -1 };
  }

  const x = Number(worldX);
  const z = Number(worldZ);
  if (!Number.isFinite(x) || !Number.isFinite(z)) {
    return { gx: -1, gz: -1 };
  }

  const localX = (x - grid.originX) / grid.cellSize;
  const localZ = (z - grid.originZ) / grid.cellSize;

  const gx = Math.floor(localX);
  const gz = Math.floor(localZ);

  if (gx < 0 || gz < 0 || gx >= grid.width || gz >= grid.height) {
    return { gx: -1, gz: -1 };
  }

  return { gx, gz };
}

export function gridToWorld(grid, gx, gz) {
  if (!grid) {
    return { x: 0, z: 0 };
  }
  const ix = gx | 0;
  const iz = gz | 0;

  const centerOffset = grid.cellSize * 0.5;
  const x = grid.originX + ix * grid.cellSize + centerOffset;
  const z = grid.originZ + iz * grid.cellSize + centerOffset;

  return { x, z };
}

export function isCellWalkable(grid, gx, gz) {
  if (!grid || !grid.walkable) {
    return false;
  }
  const ix = gx | 0;
  const iz = gz | 0;
  if (ix < 0 || iz < 0 || ix >= grid.width || iz >= grid.height) {
    return false;
  }
  const index = iz * grid.width + ix;
  return grid.walkable[index] === 1;
}

export function setCellWalkable(grid, gx, gz, value) {
  if (!grid || !grid.walkable) {
    return;
  }
  const ix = gx | 0;
  const iz = gz | 0;
  if (ix < 0 || iz < 0 || ix >= grid.width || iz >= grid.height) {
    return;
  }
  const index = iz * grid.width + ix;
  grid.walkable[index] = value ? 1 : 0;
}

export function bakeNavGridFromWorldSim(grid, worldSim, options = {}) {
  if (!grid || !grid.walkable) {
    return;
  }
  if (!worldSim) {
    for (let i = 0; i < grid.walkable.length; i++) {
      grid.walkable[i] = 0;
    }
    return;
  }

  const maxSlopeDegreesRaw = options.maxSlopeDegrees;
  const maxSlopeDegrees =
    typeof maxSlopeDegreesRaw === "number" &&
    Number.isFinite(maxSlopeDegreesRaw) &&
    maxSlopeDegreesRaw > 0
      ? maxSlopeDegreesRaw
      : 45;
  const maxSlopeRadians = degreesToRadians(maxSlopeDegrees);

  const minHeightRaw = options.minHeight;
  const maxHeightRaw = options.maxHeight;

  const hasMinHeight =
    typeof minHeightRaw === "number" && Number.isFinite(minHeightRaw);
  const hasMaxHeight =
    typeof maxHeightRaw === "number" && Number.isFinite(maxHeightRaw);

  const width = grid.width;
  const height = grid.height;
  const cellSize = grid.cellSize;

  for (let gz = 0; gz < height; gz++) {
    for (let gx = 0; gx < width; gx++) {
      const { x, z } = gridToWorld(grid, gx, gz);

      const hCenter = sampleTerrainHeight(worldSim, x, z);
      if (!Number.isFinite(hCenter)) {
        setCellWalkable(grid, gx, gz, false);
        continue;
      }

      if (hasMinHeight && hCenter < minHeightRaw) {
        setCellWalkable(grid, gx, gz, false);
        continue;
      }
      if (hasMaxHeight && hCenter > maxHeightRaw) {
        setCellWalkable(grid, gx, gz, false);
        continue;
      }

      const { x: xPlus, z: zPlus } = gridToWorld(grid, gx + 1 < width ? gx + 1 : gx, gz);
      const { x: xZ, z: zZ } = gridToWorld(grid, gx, gz + 1 < height ? gz + 1 : gz);

      const hX = sampleTerrainHeight(worldSim, xPlus, z);
      const hZ = sampleTerrainHeight(worldSim, xZ, zZ);

      const dx = Number.isFinite(hX) ? hX - hCenter : 0;
      const dz = Number.isFinite(hZ) ? hZ - hCenter : 0;

      const slope = Math.sqrt(dx * dx + dz * dz) / cellSize;
      const slopeAngle = Math.atan(slope);

      if (slopeAngle > maxSlopeRadians) {
        setCellWalkable(grid, gx, gz, false);
        continue;
      }

      setCellWalkable(grid, gx, gz, true);
    }
  }
}

// ============================================================================
// HEX GRID SUPPORT (Red Blob Games)
// https://www.redblobgames.com/grids/hexagons/
// ============================================================================

/**
 * Hex coordinate systems - cube coordinates (q, r, s where q + r + s = 0)
 */

/**
 * Convert axial (q, r) to cube (q, r, s) coordinates
 */
export function axialToCube(q, r) {
  return { q, r, s: -q - r };
}

/**
 * Convert cube to axial coordinates
 */
export function cubeToAxial(q, r, s) {
  return { q, r };
}

/**
 * Convert cube coordinates to world position (pointy-top hexes)
 * @param {number} q - Cube Q coordinate
 * @param {number} r - Cube R coordinate
 * @param {number} size - Hex size (center to corner)
 * @returns {{x: number, z: number}} World position
 */
export function hexToWorld(q, r, size = 1) {
  const x = size * (Math.sqrt(3) * q + Math.sqrt(3) / 2 * r);
  const z = size * (3 / 2 * r);
  return { x, z };
}

/**
 * Convert world position to cube hex coordinates
 * @param {number} x - World X
 * @param {number} z - World Z
 * @param {number} size - Hex size
 * @returns {{q: number, r: number, s: number}} Cube coordinates (rounded)
 */
export function worldToHex(x, z, size = 1) {
  const q = (Math.sqrt(3) / 3 * x - 1 / 3 * z) / size;
  const r = (2 / 3 * z) / size;
  return cubeRound(q, r, -q - r);
}

/**
 * Round fractional cube coordinates to nearest hex
 */
export function cubeRound(q, r, s) {
  let rq = Math.round(q);
  let rr = Math.round(r);
  let rs = Math.round(s);
  
  const qDiff = Math.abs(rq - q);
  const rDiff = Math.abs(rr - r);
  const sDiff = Math.abs(rs - s);
  
  // Reset the component with largest rounding error
  if (qDiff > rDiff && qDiff > sDiff) {
    rq = -rr - rs;
  } else if (rDiff > sDiff) {
    rr = -rq - rs;
  } else {
    rs = -rq - rr;
  }
  
  return { q: rq, r: rr, s: rs };
}

/**
 * Get 6 hex neighbors in cube coordinates
 */
export function hexNeighbors(q, r, s) {
  const directions = [
    { q: 1, r: 0, s: -1 }, { q: 1, r: -1, s: 0 }, { q: 0, r: -1, s: 1 },
    { q: -1, r: 0, s: 1 }, { q: -1, r: 1, s: 0 }, { q: 0, r: 1, s: -1 },
  ];
  
  return directions.map(d => ({
    q: q + d.q,
    r: r + d.r,
    s: s + d.s,
  }));
}

/**
 * Calculate hex distance in cube coordinates
 */
export function hexDistance(q1, r1, s1, q2, r2, s2) {
  return Math.max(
    Math.abs(q1 - q2),
    Math.abs(r1 - r2),
    Math.abs(s1 - s2)
  );
}

/**
 * Get all hexes within range of center
 * @param {number} q - Center Q
 * @param {number} r - Center R
 * @param {number} range - Range in hex steps
 * @returns {Array} Array of {q, r, s} coordinates
 */
export function hexRange(q, r, range) {
  const results = [];
  for (let dq = -range; dq <= range; dq++) {
    for (let dr = Math.max(-range, -dq - range); dr <= Math.min(range, -dq + range); dr++) {
      const ds = -dq - dr;
      results.push({ q: q + dq, r: r + dr, s: ds });
    }
  }
  return results;
}

/**
 * Get hex ring at exact distance from center
 * @param {number} q - Center Q
 * @param {number} r - Center R
 * @param {number} radius - Ring radius
 * @returns {Array} Array of {q, r, s} coordinates
 */
export function hexRing(q, r, radius) {
  if (radius === 0) return [{ q, r, s: -q - r }];
  
  const results = [];
  const directions = [
    { q: 1, r: 0, s: -1 }, { q: 0, r: 1, s: -1 }, { q: -1, r: 1, s: 0 },
    { q: -1, r: 0, s: 1 }, { q: 0, r: -1, s: 1 }, { q: 1, r: -1, s: 0 },
  ];
  
  // Start at q + radius, r - radius
  let hex = { q: q + radius, r: r - radius, s: -q - radius - r + radius };
  
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < radius; j++) {
      results.push({ ...hex });
      hex = {
        q: hex.q + directions[i].q,
        r: hex.r + directions[i].r,
        s: hex.s + directions[i].s,
      };
    }
  }
  
  return results;
}

/**
 * Linear interpolation between two hexes (for line drawing)
 * @param {number} q1 - Start Q
 * @param {number} r1 - Start R
 * @param {number} q2 - End Q
 * @param {number} r2 - End R
 * @returns {Array} Array of {q, r, s} coordinates along line
 */
export function hexLine(q1, r1, q2, r2) {
  const s1 = -q1 - r1;
  const s2 = -q2 - r2;
  const n = hexDistance(q1, r1, s1, q2, r2, s2);
  
  const results = [];
  for (let i = 0; i <= n; i++) {
    const t = n === 0 ? 0 : i / n;
    const q = q1 + (q2 - q1) * t;
    const r = r1 + (r2 - r1) * t;
    const s = s1 + (s2 - s1) * t;
    results.push(cubeRound(q, r, s));
  }
  
  return results;
}

/**
 * Create hex grid for strategy layer
 * @param {number} radius - Grid radius in hexes
 * @param {number} hexSize - Hex size in world units
 * @returns {Object} Hex grid data structure
 */
export function createHexGrid(radius, hexSize = 1) {
  const hexes = new Map();
  
  for (const hex of hexRange(0, 0, radius)) {
    const key = `${hex.q},${hex.r}`;
    const world = hexToWorld(hex.q, hex.r, hexSize);
    hexes.set(key, {
      q: hex.q,
      r: hex.r,
      s: hex.s,
      x: world.x,
      z: world.z,
      walkable: true,
      cost: 1,
      data: null,
    });
  }
  
  return {
    radius,
    hexSize,
    hexes,
    getHex: (q, r) => hexes.get(`${q},${r}`),
    setHex: (q, r, data) => {
      const key = `${q},${r}`;
      if (hexes.has(key)) {
        Object.assign(hexes.get(key), data);
      }
    },
  };
}
