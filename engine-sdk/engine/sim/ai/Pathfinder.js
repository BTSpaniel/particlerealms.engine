// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { worldToGrid, gridToWorld, isCellWalkable } from "./NavGrid.js";
import { getGridLayer } from "./NavWorld.js";

export function findPathOnGrid(grid, start, goal, options = {}) {
  if (!grid || !grid.walkable) {
    return {
      status: "invalid",
      waypoints: [],
      cost: 0,
      iterations: 0,
    };
  }

  const startX = Number(start && start.x);
  const startZ = Number(start && start.z);
  const goalX = Number(goal && goal.x);
  const goalZ = Number(goal && goal.z);

  if (!Number.isFinite(startX) || !Number.isFinite(startZ)) {
    return {
      status: "invalid",
      waypoints: [],
      cost: 0,
      iterations: 0,
    };
  }
  if (!Number.isFinite(goalX) || !Number.isFinite(goalZ)) {
    return {
      status: "invalid",
      waypoints: [],
      cost: 0,
      iterations: 0,
    };
  }

  const startCell = worldToGrid(grid, startX, startZ);
  const goalCell = worldToGrid(grid, goalX, goalZ);

  if (startCell.gx < 0 || startCell.gz < 0) {
    return {
      status: "invalid",
      waypoints: [],
      cost: 0,
      iterations: 0,
    };
  }
  if (goalCell.gx < 0 || goalCell.gz < 0) {
    return {
      status: "invalid",
      waypoints: [],
      cost: 0,
      iterations: 0,
    };
  }

  if (!isCellWalkable(grid, goalCell.gx, goalCell.gz)) {
    return {
      status: "no_path",
      waypoints: [],
      cost: 0,
      iterations: 0,
    };
  }

  const width = grid.width | 0;
  const height = grid.height | 0;
  const nodeCount = width * height;
  if (!(width > 0) || !(height > 0) || nodeCount <= 0) {
    return {
      status: "invalid",
      waypoints: [],
      cost: 0,
      iterations: 0,
    };
  }

  const startIndex = startCell.gz * width + startCell.gx;
  const goalIndex = goalCell.gz * width + goalCell.gx;

  if (startIndex === goalIndex) {
    const { x, z } = gridToWorld(grid, goalCell.gx, goalCell.gz);
    return {
      status: "ok",
      waypoints: [{ x, z }],
      cost: 0,
      iterations: 0,
    };
  }

  const gScore = new Float32Array(nodeCount);
  const fScore = new Float32Array(nodeCount);
  const cameFrom = new Int32Array(nodeCount);
  const inOpen = new Uint8Array(nodeCount);
  const inClosed = new Uint8Array(nodeCount);

  for (let i = 0; i < nodeCount; i++) {
    gScore[i] = Infinity;
    fScore[i] = Infinity;
    cameFrom[i] = -1;
  }

  gScore[startIndex] = 0;
  fScore[startIndex] = heuristic(startCell.gx, startCell.gz, goalCell.gx, goalCell.gz, options);

  const openList = [startIndex];
  inOpen[startIndex] = 1;

  const allowDiagonal = options.allowDiagonal !== false;

  const neighbors = allowDiagonal
    ? [
        { dx: 1, dz: 0, cost: 1 },
        { dx: -1, dz: 0, cost: 1 },
        { dx: 0, dz: 1, cost: 1 },
        { dx: 0, dz: -1, cost: 1 },
        { dx: 1, dz: 1, cost: Math.SQRT2 },
        { dx: -1, dz: 1, cost: Math.SQRT2 },
        { dx: 1, dz: -1, cost: Math.SQRT2 },
        { dx: -1, dz: -1, cost: Math.SQRT2 },
      ]
    : [
        { dx: 1, dz: 0, cost: 1 },
        { dx: -1, dz: 0, cost: 1 },
        { dx: 0, dz: 1, cost: 1 },
        { dx: 0, dz: -1, cost: 1 },
      ];

  const maxIterationsOption = options.maxIterations;
  const defaultMaxIterations = nodeCount * 4;
  const maxIterations =
    typeof maxIterationsOption === "number" &&
    Number.isFinite(maxIterationsOption) &&
    maxIterationsOption > 0
      ? maxIterationsOption | 0
      : defaultMaxIterations;

  let iterations = 0;

  while (openList.length > 0 && iterations < maxIterations) {
    iterations++;

    let currentIndex = openList[0];
    let currentF = fScore[currentIndex];
    let currentIdxInOpen = 0;
    for (let i = 1; i < openList.length; i++) {
      const idx = openList[i];
      const f = fScore[idx];
      if (f < currentF) {
        currentF = f;
        currentIndex = idx;
        currentIdxInOpen = i;
      }
    }

    if (currentIndex === goalIndex) {
      const waypoints = reconstructPath(grid, cameFrom, currentIndex);
      return {
        status: "ok",
        waypoints,
        cost: gScore[currentIndex],
        iterations,
      };
    }

    openList.splice(currentIdxInOpen, 1);
    inOpen[currentIndex] = 0;
    inClosed[currentIndex] = 1;

    const currentGX = currentIndex % width;
    const currentGZ = (currentIndex / width) | 0;

    for (let n = 0; n < neighbors.length; n++) {
      const step = neighbors[n];
      const nx = currentGX + step.dx;
      const nz = currentGZ + step.dz;

      if (nx < 0 || nz < 0 || nx >= width || nz >= height) {
        continue;
      }

      const neighborIndex = nz * width + nx;
      if (inClosed[neighborIndex]) {
        continue;
      }

      if (!isCellWalkable(grid, nx, nz)) {
        continue;
      }

      const tentativeG = gScore[currentIndex] + step.cost;
      if (tentativeG >= gScore[neighborIndex]) {
        continue;
      }

      cameFrom[neighborIndex] = currentIndex;
      gScore[neighborIndex] = tentativeG;
      fScore[neighborIndex] =
        tentativeG + heuristic(nx, nz, goalCell.gx, goalCell.gz, options);

      if (!inOpen[neighborIndex]) {
        openList.push(neighborIndex);
        inOpen[neighborIndex] = 1;
      }
    }
  }

  return {
    status: "no_path",
    waypoints: [],
    cost: 0,
    iterations,
  };
}

export function findPathInNavWorld(navWorld, layerName, start, goal, options = {}) {
  if (!navWorld) {
    return {
      status: "invalid",
      waypoints: [],
      cost: 0,
      iterations: 0,
    };
  }

  const name = typeof layerName === "string" && layerName.length ? layerName : "ground";
  const grid = getGridLayer(navWorld, name);
  if (!grid) {
    return {
      status: "invalid",
      waypoints: [],
      cost: 0,
      iterations: 0,
    };
  }

  return findPathOnGrid(grid, start, goal, options);
}

function heuristic(gx, gz, goalGX, goalGZ, options) {
  const dx = goalGX - gx;
  const dz = goalGZ - gz;
  const adx = Math.abs(dx);
  const adz = Math.abs(dz);

  const allowDiagonal = options.allowDiagonal !== false;

  if (allowDiagonal) {
    // Octile distance
    const minD = Math.min(adx, adz);
    const maxD = Math.max(adx, adz);
    return minD * Math.SQRT2 + (maxD - minD);
  }

  // Manhattan distance
  return adx + adz;
}

function reconstructPath(grid, cameFrom, currentIndex) {
  const width = grid.width | 0;
  const pathIndices = [];

  let index = currentIndex;
  while (index !== -1) {
    pathIndices.push(index);
    index = cameFrom[index];
  }

  pathIndices.reverse();

  const waypoints = new Array(pathIndices.length);
  for (let i = 0; i < pathIndices.length; i++) {
    const idx = pathIndices[i];
    const gx = idx % width;
    const gz = (idx / width) | 0;
    const { x, z } = gridToWorld(grid, gx, gz);
    waypoints[i] = { x, z };
  }

  return waypoints;
}
