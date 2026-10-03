// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * SubstanceMixer.js — Multi-substance blending for mixed emitters.
 *
 * When an emitter uses multiple elements (e.g. fire 0.8 + smoke 0.3),
 * this module blends their substance properties into a single effective definition.
 *
 * Replaces scattered mixing logic in ParticleEmitterSystem.js
 * (deriveTemperatureFromElements, deriveMaterialIndexFromElements, elementMixToEmitterConfig).
 */

import { getSubstance, resolveSubstance } from './SubstanceRegistry.js';

/**
 * Blend multiple substance colors by weighted average.
 * @param {Array<{color: number[], weight: number}>} entries
 * @returns {number[]} [r, g, b]
 */
function blendColors(entries) {
  let totalW = 0;
  const out = [0, 0, 0];
  for (const { color, weight } of entries) {
    if (!color) continue;
    out[0] += color[0] * weight;
    out[1] += color[1] * weight;
    out[2] += color[2] * weight;
    totalW += weight;
  }
  if (totalW <= 0) return [0.5, 0.5, 0.5];
  return [out[0] / totalW, out[1] / totalW, out[2] / totalW];
}

/**
 * Blend a numeric property by weighted average.
 * @param {Array<{value: number, weight: number}>} entries
 * @param {number} fallback
 * @returns {number}
 */
function blendScalar(entries, fallback = 0) {
  let totalW = 0, sum = 0;
  for (const { value, weight } of entries) {
    if (value == null) continue;
    sum += value * weight;
    totalW += weight;
  }
  return totalW > 0 ? sum / totalW : fallback;
}

/**
 * Mix multiple substances into a blended definition.
 *
 * @param {Array<{id: string, weight: number}>} layers — substance IDs + blend weights
 * @returns {Object} — blended substance-like object with interpolated properties
 *
 * Example:
 *   mixSubstances([{ id: 'fire', weight: 0.8 }, { id: 'smoke', weight: 0.3 }])
 */
export function mixSubstances(layers) {
  if (!layers?.length) return null;

  // Resolve all substances
  const resolved = [];
  for (const layer of layers) {
    const sub = resolveSubstance(layer.id);
    if (sub) resolved.push({ sub, weight: layer.weight || 1.0 });
  }
  if (!resolved.length) return null;

  // If only one substance, return it directly
  if (resolved.length === 1) return resolved[0].sub;

  // Find dominant substance (highest weight) for non-blendable properties
  const dominant = resolved.reduce((a, b) => a.weight >= b.weight ? a : b);

  // Blend thermal
  const thermal = {
    defaultTemperature: blendScalar(
      resolved.map(r => ({ value: r.sub.thermal?.defaultTemperature, weight: r.weight })), 293
    ),
    conductivity: blendScalar(
      resolved.map(r => ({ value: r.sub.thermal?.conductivity, weight: r.weight })), 0.5
    ),
    meltPoint: blendScalar(
      resolved.map(r => ({ value: r.sub.thermal?.meltPoint, weight: r.weight })), 273
    ),
    boilPoint: blendScalar(
      resolved.map(r => ({ value: r.sub.thermal?.boilPoint, weight: r.weight })), 373
    ),
    latentHeat: blendScalar(
      resolved.map(r => ({ value: r.sub.thermal?.latentHeat, weight: r.weight })), 0.5
    ),
    specificHeat: blendScalar(
      resolved.map(r => ({ value: r.sub.thermal?.specificHeat, weight: r.weight })), 1.0
    ),
    emissivity: blendScalar(
      resolved.map(r => ({ value: r.sub.thermal?.emissivity, weight: r.weight })), 0.5
    ),
    viscosityCurve: null,
  };

  // Blend visual
  const visual = {
    color: blendColors(resolved.map(r => ({ color: r.sub.visual?.color, weight: r.weight }))),
    colorEnd: blendColors(resolved.map(r => ({ color: r.sub.visual?.colorEnd, weight: r.weight }))),
    ssfrTint: blendColors(resolved.map(r => ({ color: r.sub.visual?.ssfrTint, weight: r.weight }))),
    opacity: blendScalar(
      resolved.map(r => ({ value: r.sub.visual?.opacity, weight: r.weight })), 1.0
    ),
    refraction: blendScalar(
      resolved.map(r => ({ value: r.sub.visual?.refraction, weight: r.weight })), 1.0
    ),
    roughness: blendScalar(
      resolved.map(r => ({ value: r.sub.visual?.roughness, weight: r.weight })), 0.5
    ),
    metallic: blendScalar(
      resolved.map(r => ({ value: r.sub.visual?.metallic, weight: r.weight })), 0.0
    ),
    emissive: blendScalar(
      resolved.map(r => ({ value: r.sub.visual?.emissive, weight: r.weight })), 0.0
    ),
    particleShape: dominant.sub.visual?.particleShape || 'sphere',
    gradientPreset: dominant.sub.visual?.gradientPreset || null,
  };

  // Blend emitter defaults
  const emitter = {
    emitRate: blendScalar(
      resolved.map(r => ({ value: r.sub.emitter?.emitRate, weight: r.weight })), 30
    ),
    maxParticles: blendScalar(
      resolved.map(r => ({ value: r.sub.emitter?.maxParticles, weight: r.weight })), 300
    ),
    pointSize: blendScalar(
      resolved.map(r => ({ value: r.sub.emitter?.pointSize, weight: r.weight })), 2.0
    ),
    gravity: blendScalar(
      resolved.map(r => ({ value: r.sub.emitter?.gravity, weight: r.weight })), 9.81
    ),
    mass: blendScalar(
      resolved.map(r => ({ value: r.sub.emitter?.mass, weight: r.weight })), 1.0
    ),
    drag: blendScalar(
      resolved.map(r => ({ value: r.sub.emitter?.drag, weight: r.weight })), 0.01
    ),
    // Use dominant's arrays
    lifetime: dominant.sub.emitter?.lifetime || [2.0, 5.0],
    upSpeed: dominant.sub.emitter?.upSpeed || [1.0, 3.0],
    horizontalSpeed: dominant.sub.emitter?.horizontalSpeed || 1.0,
    sizeOverLife: dominant.sub.emitter?.sizeOverLife || [1.0, 1.0, 1.0],
    alphaOverLife: dominant.sub.emitter?.alphaOverLife || [1.0, 1.0, 1.0],
    velocityOverLife: dominant.sub.emitter?.velocityOverLife || [1.0, 1.0, 1.0],
  };

  // Blend SPH
  const sph = {
    restDensity: blendScalar(
      resolved.map(r => ({ value: r.sub.sph?.restDensity, weight: r.weight })), 0
    ),
    viscosity: blendScalar(
      resolved.map(r => ({ value: r.sub.sph?.viscosity, weight: r.weight })), 0
    ),
    surfaceTension: blendScalar(
      resolved.map(r => ({ value: r.sub.sph?.surfaceTension, weight: r.weight })), 0
    ),
    gasConstant: blendScalar(
      resolved.map(r => ({ value: r.sub.sph?.gasConstant, weight: r.weight })), 0
    ),
    vorticityBoost: blendScalar(
      resolved.map(r => ({ value: r.sub.sph?.vorticityBoost, weight: r.weight })), 0
    ),
    xsphFactor: blendScalar(
      resolved.map(r => ({ value: r.sub.sph?.xsphFactor, weight: r.weight })), 0
    ),
    internalPressure: blendScalar(
      resolved.map(r => ({ value: r.sub.sph?.internalPressure, weight: r.weight })), 0
    ),
    externalPressure: blendScalar(
      resolved.map(r => ({ value: r.sub.sph?.externalPressure, weight: r.weight })), 0
    ),
    damping: blendScalar(
      resolved.map(r => ({ value: r.sub.sph?.damping, weight: r.weight })), 0
    ),
  };

  // Build mixed result using dominant for non-blendable fields
  return {
    id: `mix:${layers.map(l => l.id).join('+')}`,
    materialId: dominant.sub.materialId,
    label: `Mix (${layers.map(l => l.id).join(' + ')})`,
    icon: dominant.sub.icon,
    category: dominant.sub.category,
    tags: [...new Set(resolved.flatMap(r => r.sub.tags || []))],
    chemistry: dominant.sub.chemistry,
    thermal,
    physics: dominant.sub.physics,
    sph,
    visual,
    emitter,
    audio: dominant.sub.audio,
    decals: dominant.sub.decals,
    reactions: dominant.sub.reactions,
    spell: dominant.sub.spell,
    _isMixed: true,
    _layers: layers,
  };
}

/**
 * Derive a substance approximation from element layers (used by emitter system).
 * Maps element IDs to substance IDs and mixes them.
 *
 * @param {Array<{id: string, power: number}>} elementLayers
 * @returns {Object|null}
 */
export function deriveFromElements(elementLayers) {
  if (!elementLayers?.length) return null;
  const layers = elementLayers
    .filter(e => e.id && e.power > 0)
    .map(e => ({ id: e.id, weight: e.power }));
  return mixSubstances(layers);
}
