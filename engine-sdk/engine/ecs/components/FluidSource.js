// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { defineComponentType } from "./ComponentRegistry.js";

const defaults = {
  enabled: true,
  radius: 1,
  strength: 1,
};

function normalizeBoolean(value, defaultValue) {
  return typeof value === "boolean" ? value : defaultValue;
}

function normalizeNumber(value, defaultValue) {
  const n = Number(value);
  return Number.isFinite(n) ? n : defaultValue;
}

function normalizeNonNegativeNumber(value, defaultValue) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    return defaultValue;
  }
  return n;
}

function normalize(input) {
  const src = input && typeof input === "object" ? input : {};
  const enabled = normalizeBoolean(src.enabled, defaults.enabled);
  const radius = normalizeNonNegativeNumber(src.radius, defaults.radius);
  const strength = normalizeNumber(src.strength, defaults.strength);
  return {
    enabled,
    radius,
    strength,
  };
}

function validate(value) {
  return normalize(value);
}

export const FluidSourceDefinition = defineComponentType({
  name: "FluidSource",
  version: 1,
  defaults,
  normalize,
  validate,
});

export function createFluidSource(initial) {
  return FluidSourceDefinition.create(initial);
}
