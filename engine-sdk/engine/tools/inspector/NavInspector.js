// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { getRegisteredSystems } from "../../ecs/systems/SystemRegistry.js";

export function createNavInspectorModel(world) {
  if (!world) {
    throw new Error("createNavInspectorModel: world is required");
  }

  const navWorld = world.navWorld || null;

  const navSummary = {
    name: navWorld && typeof navWorld.name === "string" ? navWorld.name : null,
    hasWorldSim: !!(navWorld && navWorld.worldSim),
    layers: [],
  };

  if (navWorld && navWorld.gridLayers && typeof navWorld.gridLayers.forEach === "function") {
    navWorld.gridLayers.forEach((grid, layerName) => {
      if (!grid) {
        return;
      }
      const width = grid.width | 0;
      const height = grid.height | 0;
      const cellSize =
        typeof grid.cellSize === "number" && Number.isFinite(grid.cellSize)
          ? grid.cellSize
          : 0;
      const originX =
        typeof grid.originX === "number" && Number.isFinite(grid.originX)
          ? grid.originX
          : 0;
      const originZ =
        typeof grid.originZ === "number" && Number.isFinite(grid.originZ)
          ? grid.originZ
          : 0;

      let walkableCount = 0;
      let blockedCount = 0;
      if (grid.walkable && grid.walkable.length === width * height) {
        for (let i = 0; i < grid.walkable.length; i++) {
          if (grid.walkable[i] === 1) {
            walkableCount++;
          } else {
            blockedCount++;
          }
        }
      }

      navSummary.layers.push({
        name: typeof layerName === "string" ? layerName : "",
        width,
        height,
        cellSize,
        originX,
        originZ,
        walkableCount,
        blockedCount,
      });
    });
  }

  const systems = getRegisteredSystems(world) || [];
  let navAgentSystem = null;
  for (let i = 0; i < systems.length; i++) {
    const s = systems[i];
    if (!s) continue;
    if (s.name === "NavAgentSystem" || s.id === "NavAgentSystem") {
      navAgentSystem = s;
      break;
    }
  }

  const pathsSummary = [];

  if (navAgentSystem && navAgentSystem.state && navAgentSystem.state.paths) {
    const paths = navAgentSystem.state.paths;
    if (typeof paths.forEach === "function") {
      paths.forEach((pathState, entityId) => {
        if (!pathState || !Array.isArray(pathState.waypoints)) {
          return;
        }
        const count = pathState.waypoints.length;
        const first = count > 0 ? pathState.waypoints[0] : null;
        const last = count > 0 ? pathState.waypoints[count - 1] : null;
        pathsSummary.push({
          entityId,
          waypointCount: count,
          currentIndex: pathState.index | 0,
          firstWaypoint: first,
          lastWaypoint: last,
        });
      });
    }
  }

  return {
    navWorld: navSummary,
    paths: pathsSummary,
  };
}
