// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { defineComponentType } from "./ComponentRegistry.js";

const defaults = {
  enabled: true,
  type: "wind", // wind, attractor, repulsor
  radius: 10,
  strength: 1,
  falloff: 1,
  direction: [1, 0, 0],
};

function normalizeNonNegativeNumber(value, defaultValue) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    return defaultValue;
  }
  return n;
}

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

  const typeValue = typeof src.type === "string" ? src.type : defaults.type;
  let type = defaults.type;
  if (typeValue === "wind" || typeValue === "attractor" || typeValue === "repulsor") {
    type = typeValue;
  }

  return {
    enabled: normalizeBoolean(src.enabled, defaults.enabled),
    type,
    radius: normalizeNonNegativeNumber(src.radius, defaults.radius),
    strength: normalizeNonNegativeNumber(src.strength, defaults.strength),
    falloff: normalizeNonNegativeNumber(src.falloff, defaults.falloff),
    direction: normalizeVec3(src.direction, defaults.direction),
  };
}

function validate(value) {
  return normalize(value);
}

export const ParticleFieldDefinition = defineComponentType({
  name: "ParticleField",
  version: 1,
  defaults,
  normalize,
  validate,
});

export function createParticleField(initial) {
  return ParticleFieldDefinition.create(initial);
}
