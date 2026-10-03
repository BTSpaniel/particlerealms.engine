// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { captureWorldSnapshot, restoreWorldFromSnapshot } from "./World.js";
import {
  exportWorldSimState,
  createWorldSimFromState,
  destroyWorldSim,
} from "../../sim/world/WorldSim.js";

export function createWorldSavePayload(world, options = {}) {
  if (!world) {
    throw new Error("createWorldSavePayload: world is required");
  }

  const includeWorldSnapshot =
    options && typeof options.includeWorldSnapshot === "boolean"
      ? options.includeWorldSnapshot
      : true;
  const includeWorldSim =
    options && typeof options.includeWorldSim === "boolean"
      ? options.includeWorldSim
      : true;

  const worldSnapshotOptions = options.worldSnapshotOptions || {};
  const worldSimOptions = options.worldSimOptions || {};

  const payload = {
    version: 1,
    world: null,
    worldSim: null,
  };

  if (includeWorldSnapshot) {
    payload.world = captureWorldSnapshot(world, worldSnapshotOptions);
  }

  if (includeWorldSim && world.worldSim) {
    payload.worldSim = exportWorldSimState(world.worldSim, worldSimOptions);
  }

  return payload;
}

export function restoreWorldFromSavePayload(world, payload, options = {}) {
  if (!world || !payload || typeof payload !== "object") {
    return;
  }

  const allowWorldRestore =
    options && typeof options.allowWorldRestore === "boolean"
      ? options.allowWorldRestore
      : true;
  const allowWorldSimRestore =
    options && typeof options.allowWorldSimRestore === "boolean"
      ? options.allowWorldSimRestore
      : true;

  if (allowWorldRestore && payload.world) {
    restoreWorldFromSnapshot(world, payload.world);
  }

  if (allowWorldSimRestore && payload.worldSim) {
    if (world.worldSim) {
      destroyWorldSim(world.worldSim);
      world.worldSim = null;
    }
    const worldSim = createWorldSimFromState(payload.worldSim);
    if (worldSim) {
      world.worldSim = worldSim;
    }
  }
}
