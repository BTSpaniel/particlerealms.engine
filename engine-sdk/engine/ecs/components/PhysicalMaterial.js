// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { defineComponentType } from "./ComponentRegistry.js";

const defaults = {
  _presetKey: "stone",
  density: 2500,
  elasticity: 0.08,
  hardness: 0.80,
  tensileStrength: 0.50,
  brittleness: 0.75,
  friction: 0.65,
  restitution: 0.10,
  deformable: false,
  breakable: true,
  fracturePattern: "RADIAL",
  maxFragments: 10,
  damageThreshold: 0.50,
  currentDamage: 0,
};

function normalize(input) {
  const src = input && typeof input === "object" ? input : {};
  return {
    _presetKey: typeof src._presetKey === "string" ? src._presetKey : defaults._presetKey,
    density: typeof src.density === "number" && Number.isFinite(src.density) ? src.density : defaults.density,
    elasticity: typeof src.elasticity === "number" && Number.isFinite(src.elasticity) ? src.elasticity : defaults.elasticity,
    hardness: typeof src.hardness === "number" && Number.isFinite(src.hardness) ? src.hardness : defaults.hardness,
    tensileStrength: typeof src.tensileStrength === "number" && Number.isFinite(src.tensileStrength) ? src.tensileStrength : defaults.tensileStrength,
    brittleness: typeof src.brittleness === "number" && Number.isFinite(src.brittleness) ? src.brittleness : defaults.brittleness,
    friction: typeof src.friction === "number" && Number.isFinite(src.friction) ? src.friction : defaults.friction,
    restitution: typeof src.restitution === "number" && Number.isFinite(src.restitution) ? src.restitution : defaults.restitution,
    deformable: typeof src.deformable === "boolean" ? src.deformable : defaults.deformable,
    breakable: typeof src.breakable === "boolean" ? src.breakable : defaults.breakable,
    fracturePattern: typeof src.fracturePattern === "string" ? src.fracturePattern : defaults.fracturePattern,
    maxFragments: typeof src.maxFragments === "number" && Number.isFinite(src.maxFragments) ? src.maxFragments : defaults.maxFragments,
    damageThreshold: typeof src.damageThreshold === "number" && Number.isFinite(src.damageThreshold) ? src.damageThreshold : defaults.damageThreshold,
    currentDamage: typeof src.currentDamage === "number" && Number.isFinite(src.currentDamage) ? src.currentDamage : defaults.currentDamage,
  };
}

function validate(value) {
  return normalize(value);
}

export const PhysicalMaterialDefinition = defineComponentType({
  name: "PhysicalMaterial",
  version: 1,
  defaults,
  normalize,
  validate,
});

export function createPhysicalMaterialComponent(initial) {
  return PhysicalMaterialDefinition.create(initial);
}
