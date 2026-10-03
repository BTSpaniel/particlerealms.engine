// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { defineComponentType } from "./ComponentRegistry.js";
import {
  normalizeFluidGridSize,
  DEFAULT_FLUID_GRID_SIZE,
} from "../../sim/fluids/FluidConfig.js";

const defaults = {
  enabled: true,
  gridSize: DEFAULT_FLUID_GRID_SIZE,
  worldMin: [-10, -10, -10],
  worldMax: [10, 10, 10],
};

function normalizeBoolean(value, defaultValue) {
  return typeof value === "boolean" ? value : defaultValue;
}

function normalizeVec3(input, defaultValue) {
  const base = Array.isArray(input) ? input : defaultValue;
  const x = Number(base[0]);
  const y = Number(base[1]);
  const z = Number(base[2]);
  return [
    Number.isFinite(x) ? x : defaultValue[0],
    Number.isFinite(y) ? y : defaultValue[1],
    Number.isFinite(z) ? z : defaultValue[2],
  ];
}

function normalize(input) {
  const src = input && typeof input === "object" ? input : {};
  const enabled = normalizeBoolean(src.enabled, defaults.enabled);
  const gridSize = normalizeFluidGridSize(src.gridSize || defaults.gridSize);
  const worldMin = normalizeVec3(src.worldMin, defaults.worldMin);
  const worldMax = normalizeVec3(src.worldMax, defaults.worldMax);
  return {
    enabled,
    gridSize,
    worldMin,
    worldMax,
  };
}

function validate(value) {
  return normalize(value);
}

export const FluidVolumeDefinition = defineComponentType({
  name: "FluidVolume",
  version: 1,
  defaults,
  normalize,
  validate,
});

export function createFluidVolume(initial) {
  return FluidVolumeDefinition.create(initial);
}
