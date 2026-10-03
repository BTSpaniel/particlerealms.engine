// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { getWorldDebugSnapshot } from "../../ecs/world/World.js";
import {
  getWorldSimSnapshot,
  exportWorldSimState,
  createWorldSimFromState,
  destroyWorldSim,
} from "../../sim/world/WorldSim.js";

export function createWorldInspectorModel(world, options = {}) {
  if (!world) {
    throw new Error("createWorldInspectorModel: world is required");
  }

  const worldSnapshotOptions = {
    includeEntities: false,
  };
  if (options.worldSnapshotOptions) {
    if (options.worldSnapshotOptions.includeEntities === false) {
      worldSnapshotOptions.includeEntities = false;
    }
  }

  const worldSnapshot = getWorldDebugSnapshot(world, worldSnapshotOptions);

  let worldSimState = null;
  let worldSimSnapshot = null;

  if (world.worldSim) {
    const includeTerrainHeights =
      options && typeof options.includeTerrainHeights === "boolean"
        ? options.includeTerrainHeights
        : false;

    worldSimState = exportWorldSimState(world.worldSim, {
      includeTerrainHeights,
    });
    worldSimSnapshot = getWorldSimSnapshot(world.worldSim);
  }

  return {
    world: {
      name: worldSnapshot.name,
      time: worldSnapshot.time,
      config: worldSnapshot.config,
      stats: worldSnapshot.stats,
    },
    worldSim: {
      state: worldSimState,
      snapshot: worldSimSnapshot,
    },
  };
}

export function applyWorldInspectorModel(world, model) {
  if (!world || !model) {
    return;
  }

  const worldModel = model.world || {};
  const worldSimModel = model.worldSim || {};

  if (worldModel.name && typeof worldModel.name === "string") {
    world.name = worldModel.name;
  }

  if (worldModel.time && typeof worldModel.time === "object") {
    const t = worldModel.time;
    if (typeof t.tick === "number" && Number.isFinite(t.tick)) {
      world.time.tick = t.tick;
    }
    if (typeof t.time === "number" && Number.isFinite(t.time)) {
      world.time.time = t.time;
    }
    if (
      typeof t.fixedDelta === "number" &&
      Number.isFinite(t.fixedDelta) &&
      t.fixedDelta > 0
    ) {
      world.time.fixedDelta = t.fixedDelta;
    }
  }

  if (
    worldModel.config &&
    worldModel.config.phases &&
    Array.isArray(worldModel.config.phases)
  ) {
    world.config.phases = worldModel.config.phases.slice();
  }

  if (worldSimModel.state) {
    if (world.worldSim) {
      destroyWorldSim(world.worldSim);
      world.worldSim = null;
    }
    const worldSim = createWorldSimFromState(worldSimModel.state);
    if (worldSim) {
      world.worldSim = worldSim;
    }
  }
}
