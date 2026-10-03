// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { createQuery, forEachEntity } from "../query/Query.js";
import { registerSystem } from "./SystemRegistry.js";
import {
  createNavWorld,
  destroyNavWorld,
  addGridLayer,
  getGridLayer,
} from "../../sim/ai/NavWorld.js";
import {
  createNavGrid,
  bakeNavGridFromWorldSim,
} from "../../sim/ai/NavGrid.js";
import { findPathInNavWorld } from "../../sim/ai/Pathfinder.js";
import { sampleTerrainHeight } from "../../sim/world/WorldSim.js";

function createNavAgentQuery() {
  return createQuery({
    name: "NavAgentQuery",
    all: ["NavAgent", "Transform"],
  });
}

function positionsEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) {
    return false;
  }
  return (
    a.length >= 3 &&
    b.length >= 3 &&
    a[0] === b[0] &&
    a[1] === b[1] &&
    a[2] === b[2]
  );
}

export function registerNavAgentSystem(world, options = {}) {
  const phase = options.phase || "postPhysics";
  const updateKind = options.updateKind || "tick";
  const name = options.name || "NavAgentSystem";

  const gridLayerNameOption = options.gridLayerName;
  const gridLayerName =
    typeof gridLayerNameOption === "string" && gridLayerNameOption.length
      ? gridLayerNameOption
      : "ground";

  const gridWidthRaw = options.gridWidth;
  const gridHeightRaw = options.gridHeight;
  const gridCellSizeRaw = options.gridCellSize;
  const gridOriginXRaw = options.gridOriginX;
  const gridOriginZRaw = options.gridOriginZ;

  const gridWidth =
    typeof gridWidthRaw === "number" &&
    Number.isFinite(gridWidthRaw) &&
    gridWidthRaw >= 1
      ? gridWidthRaw | 0
      : 64;
  const gridHeight =
    typeof gridHeightRaw === "number" &&
    Number.isFinite(gridHeightRaw) &&
    gridHeightRaw >= 1
      ? gridHeightRaw | 0
      : 64;
  const gridCellSize =
    typeof gridCellSizeRaw === "number" &&
    Number.isFinite(gridCellSizeRaw) &&
    gridCellSizeRaw > 0.01
      ? gridCellSizeRaw
      : 1;
  const gridOriginX =
    typeof gridOriginXRaw === "number" && Number.isFinite(gridOriginXRaw)
      ? gridOriginXRaw
      : 0;
  const gridOriginZ =
    typeof gridOriginZRaw === "number" && Number.isFinite(gridOriginZRaw)
      ? gridOriginZRaw
      : 0;

  const maxSlopeDegreesRaw = options.maxSlopeDegrees;
  const maxSlopeDegrees =
    typeof maxSlopeDegreesRaw === "number" &&
    Number.isFinite(maxSlopeDegreesRaw) &&
    maxSlopeDegreesRaw > 0
      ? maxSlopeDegreesRaw
      : 45;

  const minHeightRaw = options.minHeight;
  const maxHeightRaw = options.maxHeight;

  const bakeIntervalRaw = options.bakeIntervalSeconds;
  const bakeIntervalSeconds =
    typeof bakeIntervalRaw === "number" &&
    Number.isFinite(bakeIntervalRaw) &&
    bakeIntervalRaw > 0
      ? bakeIntervalRaw
      : 0;

  const allowDiagonal = options.allowDiagonal !== false;

  return registerSystem(world, {
    name,
    phase,
    updateKind,
    group: options.group || "AI",
    createState() {
      return {
        query: createNavAgentQuery(),
        navWorld: createNavWorld({ worldSim: null }),
        gridLayerName,
        grid: null,
        gridConfig: {
          width: gridWidth,
          height: gridHeight,
          cellSize: gridCellSize,
          originX: gridOriginX,
          originZ: gridOriginZ,
        },
        bakeOptions: {
          maxSlopeDegrees,
          minHeight: minHeightRaw,
          maxHeight: maxHeightRaw,
        },
        bakeIntervalSeconds,
        timeSinceLastBake: 0,
        paths: new Map(),
        metrics: {
          entityCount: 0,
          totalAgents: 0,
          movedAgents: 0,
          totalMoveSq: 0,
        },
      };
    },
    teardown(worldRef, system) {
      const state = system && system.state;
      if (!state) {
        return;
      }
      if (state.navWorld) {
        destroyNavWorld(state.navWorld);
        state.navWorld = null;
      }
      if (state.paths) {
        state.paths.clear();
      }
    },
    update(worldRef, deltaSeconds, system) {
      const state = system.state;
      const query = state.query;
      const navWorld = state.navWorld;
      const metrics = state.metrics;

      if (!query || !navWorld) {
        return;
      }

      const worldSim = worldRef && worldRef.worldSim ? worldRef.worldSim : null;
      if (worldSim && navWorld.worldSim !== worldSim) {
        navWorld.worldSim = worldSim;
      }

      if (worldRef && !worldRef.navWorld && navWorld) {
        worldRef.navWorld = navWorld;
      }

      if (!state.grid && worldSim) {
        const grid = createNavGrid({
          name: `${name}.${state.gridLayerName}`,
          width: state.gridConfig.width,
          height: state.gridConfig.height,
          cellSize: state.gridConfig.cellSize,
          originX: state.gridConfig.originX,
          originZ: state.gridConfig.originZ,
        });
        addGridLayer(navWorld, state.gridLayerName, grid);
        state.grid = grid;
      }

      const dt =
        typeof deltaSeconds === "number" && deltaSeconds > 0
          ? deltaSeconds
          : worldRef &&
            worldRef.time &&
            typeof worldRef.time.fixedDelta === "number" &&
            worldRef.time.fixedDelta > 0
          ? worldRef.time.fixedDelta
          : 1 / 60;

      const grid = state.grid;
      if (grid && navWorld.worldSim) {
        if (state.bakeIntervalSeconds > 0) {
          state.timeSinceLastBake += dt;
          if (state.timeSinceLastBake >= state.bakeIntervalSeconds) {
            bakeNavGridFromWorldSim(grid, navWorld.worldSim, state.bakeOptions);
            state.timeSinceLastBake = 0;
          }
        } else {
          bakeNavGridFromWorldSim(grid, navWorld.worldSim, state.bakeOptions);
        }
      }

      const paths = state.paths;

      if (metrics) {
        metrics.entityCount = 0;
        metrics.totalAgents = 0;
        metrics.movedAgents = 0;
        metrics.totalMoveSq = 0;
      }

      forEachEntity(worldRef, query, (entityId, get) => {
        const agent = get("NavAgent");
        const transform = get("Transform");
        if (!agent || !transform) {
          return;
        }

        if (metrics) {
          metrics.entityCount++;
        }

        if (!agent.hasDestination) {
          paths.delete(entityId);
          return;
        }

        const pathState = paths.get(entityId) || null;
        const dest = Array.isArray(agent.destination)
          ? agent.destination
          : [0, 0, 0];

        const needNewPath =
          !pathState || !positionsEqual(pathState.destination, dest);

        let activePath = pathState;

        if (needNewPath) {
          if (!grid || !navWorld.worldSim) {
            paths.delete(entityId);
            return;
          }

          const pos = transform.position || [0, 0, 0];
          const startX = Number(pos[0]);
          const startZ = Number(pos[2]);
          const goalX = Number(dest[0]);
          const goalZ = Number(dest[2]);

          if (
            !Number.isFinite(startX) ||
            !Number.isFinite(startZ) ||
            !Number.isFinite(goalX) ||
            !Number.isFinite(goalZ)
          ) {
            paths.delete(entityId);
            return;
          }

          const result = findPathInNavWorld(
            navWorld,
            agent.layer || state.gridLayerName,
            { x: startX, z: startZ },
            { x: goalX, z: goalZ },
            { allowDiagonal }
          );

          if (result.status !== "ok" || !result.waypoints.length) {
            paths.delete(entityId);
            return;
          }

          activePath = {
            waypoints: result.waypoints,
            index: 0,
            destination: dest.slice(0, 3),
          };
          paths.set(entityId, activePath);
        }

        if (!activePath || !activePath.waypoints.length) {
          paths.delete(entityId);
          return;
        }

        followPath(worldRef, worldSim, agent, transform, activePath, dt, metrics);

        if (!agent.hasDestination) {
          paths.delete(entityId);
        }
      });

      if (worldRef && worldRef.metrics && metrics) {
        worldRef.metrics.navAgents = {
          entityCount: metrics.entityCount | 0,
          pathCount: paths.size | 0,
          movedAgents: metrics.movedAgents | 0,
          totalAgents: metrics.totalAgents | 0,
          totalMoveSq: metrics.totalMoveSq,
        };
      }
    },
  });
}

function followPath(worldRef, worldSim, agent, transform, pathState, dt, metrics) {
  const waypoints = pathState.waypoints;
  let index = pathState.index | 0;

  const metricsRef = metrics || null;

  if (!waypoints || !waypoints.length) {
    agent.hasDestination = false;
    return;
  }

  const speedRaw = Number(agent.speed);
  const speed =
    Number.isFinite(speedRaw) && speedRaw > 0 ? speedRaw : 0;
  if (!(speed > 0)) {
    return;
  }

  const stoppingRaw = Number(agent.stoppingDistance);
  const stoppingDistance =
    Number.isFinite(stoppingRaw) && stoppingRaw >= 0 ? stoppingRaw : 0.1;

  const pos = transform.position || [0, 0, 0];
  let px = Number(pos[0]);
  let py = Number(pos[1]);
  let pz = Number(pos[2]);

  const startPx = Number.isFinite(px) ? px : 0;
  const startPz = Number.isFinite(pz) ? pz : 0;

  if (!Number.isFinite(px)) px = 0;
  if (!Number.isFinite(py)) py = 0;
  if (!Number.isFinite(pz)) pz = 0;

  const maxStep = speed * dt;

  let remaining = maxStep;
  let done = false;

  if (metricsRef) {
    metricsRef.totalAgents = (metricsRef.totalAgents | 0) + 1;
  }

  while (remaining > 0 && !done) {
    const wp = waypoints[index];
    if (!wp) {
      break;
    }
    const tx = Number(wp.x);
    const tz = Number(wp.z);
    if (!Number.isFinite(tx) || !Number.isFinite(tz)) {
      break;
    }

    const dx = tx - px;
    const dz = tz - pz;
    const distSq = dx * dx + dz * dz;

    if (distSq <= stoppingDistance * stoppingDistance) {
      if (index >= waypoints.length - 1) {
        px = tx;
        pz = tz;
        done = true;
        break;
      }
      index++;
      continue;
    }

    const dist = Math.sqrt(distSq);
    if (!(dist > 0)) {
      break;
    }

    const step = remaining < dist ? remaining : dist;
    const invDist = 1 / dist;
    const stepX = dx * invDist * step;
    const stepZ = dz * invDist * step;

    px += stepX;
    pz += stepZ;

    remaining -= step;

    if (step === dist && index >= waypoints.length - 1) {
      done = true;
      break;
    }
  }

  if (worldSim) {
    const terrainY = sampleTerrainHeight(worldSim, px, pz);
    if (Number.isFinite(terrainY)) {
      py = terrainY;
    }
  }

  transform.position[0] = px;
  transform.position[1] = py;
  transform.position[2] = pz;

  if (metricsRef) {
    const dxMoved = px - startPx;
    const dzMoved = pz - startPz;
    const moveSq = dxMoved * dxMoved + dzMoved * dzMoved;
    metricsRef.totalMoveSq += moveSq;
    if (moveSq > 0) {
      metricsRef.movedAgents = (metricsRef.movedAgents | 0) + 1;
    }
  }

  if (done) {
    agent.hasDestination = false;
  }

  pathState.index = index;
}
