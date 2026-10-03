// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { destroyNavGrid } from "./NavGrid.js";

export function createNavWorld(options = {}) {
  const name = typeof options.name === "string" ? options.name : "NavWorld";

  const navWorld = {
    name,
    worldSim: options.worldSim || null,
    gridLayers: new Map(),
  };

  return navWorld;
}

export function destroyNavWorld(navWorld) {
  if (!navWorld) {
    return;
  }

  if (navWorld.gridLayers && typeof navWorld.gridLayers.forEach === "function") {
    navWorld.gridLayers.forEach((grid) => {
      destroyNavGrid(grid);
    });
    navWorld.gridLayers.clear();
  }

  navWorld.worldSim = null;
}

export function addGridLayer(navWorld, name, grid) {
  if (!navWorld || !navWorld.gridLayers) {
    return;
  }
  if (typeof name !== "string" || !name) {
    return;
  }
  if (!grid) {
    return;
  }
  navWorld.gridLayers.set(name, grid);
}

export function getGridLayer(navWorld, name) {
  if (!navWorld || !navWorld.gridLayers) {
    return null;
  }
  if (typeof name !== "string" || !name) {
    return null;
  }
  return navWorld.gridLayers.get(name) || null;
}

export function removeGridLayer(navWorld, name) {
  if (!navWorld || !navWorld.gridLayers) {
    return;
  }
  if (typeof name !== "string" || !name) {
    return;
  }
  const grid = navWorld.gridLayers.get(name) || null;
  if (grid) {
    destroyNavGrid(grid);
  }
  navWorld.gridLayers.delete(name);
}
