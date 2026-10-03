// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * SpellEffectComposer.js — Auto-blending multi-layer VFX composition
 *
 * ==================== ARCHITECTURE (for future AI/developers) ====================
 *
 * Industry VFX standard (Niagara, Unity VFX Graph, PopcornFX, Houdini POP):
 * A spell/effect is composed of MULTIPLE visual layers, each serving a distinct role:
 *
 *   1. CORE    — Main volumetric body (SDF particles, standard blend)
 *   2. GLOW    — Larger, softer aura around core (bright color, low alpha, additive feel)
 *   3. ACCENT  — Small bright particles: embers, snowflakes, sparkles, droplets
 *   4. WISPS   — Secondary volumetric layer: smoke tendrils, mist, steam
 *   5. RING    — Expanding shockwave/halo (burst spawn, grows outward)
 *   6. TRAILS  — Ribbon trails following particles
 *   7. LIGHT   — Dynamic point light matching effect color
 *
 * This system auto-generates these layers from an element mix. Given elements like
 * [fire(0.8), ice(0.6)], it produces an array of emitter configs — one per visual layer.
 * Each config is a complete Emitter component that can be passed to editor.createEntity().
 *
 * USAGE:
 *   import { composeSpellEffect } from './SpellEffectComposer.js';
 *   const layers = composeSpellEffect(activeElements, baseEmitterConfig);
 *   // layers = [{ name, layerType, emitterConfig }, ...]
 *   // Each layer.emitterConfig is a full Emitter component for createEntity
 *
 * The "Create Spell From This" button in EmitterInspectorCard.js calls this,
 * then EditorParticles.createComposedSpellEffect() creates child emitter entities.
 */

import { elementMixToEmitterConfig, getElementCombination, ELEMENT_ALIASES } from './ParticleElementRegistry.js';

// =============================================================================
// LAYER TEMPLATES — Visual properties that define each layer's role
// =============================================================================
// Each template modifies the base emitter config to create a distinct visual layer.
// Properties are multipliers (scale) or overrides (absolute values).

const LAYER_TEMPLATES = {
  // Main volumetric body — keeps parent config mostly intact
  core: {
    label: 'Core',
    rateScale: 1.0,
    sizeScale: 1.0,
    lifetimeScale: 1.0,
    speedScale: 1.0,
    alphaScale: 1.0,
    gravityScale: 1.0,
  },

  // Soft glow/aura — larger, dimmer, surrounds the core
  glow: {
    label: 'Glow',
    rateScale: 0.25,
    sizeScale: 2.8,
    lifetimeScale: 1.3,
    speedScale: 0.4,
    alphaScale: 0.25,
    gravityScale: 0.3,
    colorBrighten: 0.3,    // Shift color toward white by this amount
    dragOverride: 0.12,    // High drag for slow, floaty movement
  },

  // Small bright accent particles (embers, snowflakes, sparkles, droplets)
  accent: {
    label: 'Accents',
    rateScale: 0.6,
    sizeScale: 0.15,
    lifetimeScale: 0.4,
    speedScale: 2.5,
    alphaScale: 1.0,
    gravityScale: 1.8,
    horizontalSpeedScale: 3.0,
    dragOverride: 0.01,
  },

  // Secondary volumetric layer (smoke wisps, mist, steam tendrils)
  wisps: {
    label: 'Wisps',
    rateScale: 0.2,
    sizeScale: 2.0,
    lifetimeScale: 2.0,
    speedScale: 0.3,
    alphaScale: 0.35,
    gravityScale: 0.15,
    colorDarken: 0.2,     // Shift color toward darker
    dragOverride: 0.08,
  },

  // Expanding ring/shockwave (burst spawn, short life, grows outward)
  ring: {
    label: 'Ring',
    rateScale: 0.08,
    sizeScale: 0.8,
    lifetimeScale: 0.6,
    speedScale: 0.1,
    alphaScale: 0.5,
    gravityScale: 0.0,
    horizontalSpeedOverride: 6.0,
    dragOverride: 0.15,
    shapeOverride: 'sphere',
  },

  // Trailing particles (slower, longer-lived, follow core path)
  trail: {
    label: 'Trail',
    rateScale: 0.15,
    sizeScale: 0.5,
    lifetimeScale: 1.8,
    speedScale: 0.2,
    alphaScale: 0.4,
    gravityScale: 0.5,
    dragOverride: 0.06,
    colorDarken: 0.15,
  },
};

// =============================================================================
// ELEMENT RECIPES — Which layers each element contributes
// =============================================================================
// Each element maps to an array of layer configs with optional overrides.
// When multiple elements are present, their layers are merged and deduplicated.

const ELEMENT_RECIPES = {
  fire: {
    layers: [
      { template: 'core' },
      { template: 'glow', colorOverride: [1.0, 0.7, 0.2] },
      { template: 'accent', label: 'Embers', colorOverride: [1.0, 0.4, 0.05], gravityScale: 2.5 },
      { template: 'wisps', label: 'Smoke', colorOverride: [0.3, 0.28, 0.25], sizeScale: 3.0 },
    ],
  },

  water: {
    layers: [
      { template: 'core' },
      { template: 'glow', colorOverride: [0.4, 0.75, 1.0] },
      { template: 'accent', label: 'Droplets', colorOverride: [0.7, 0.85, 1.0], gravityScale: 3.0, speedScale: 1.5 },
    ],
  },

  ice: {
    layers: [
      { template: 'core' },
      { template: 'glow', colorOverride: [0.7, 0.85, 1.0], colorBrighten: 0.4 },
      { template: 'accent', label: 'Snowflakes', colorOverride: [0.9, 0.95, 1.0], gravityScale: 0.5, speedScale: 0.8, sizeScale: 0.25 },
      { template: 'ring', label: 'Frost Ring', colorOverride: [0.6, 0.8, 1.0] },
    ],
  },

  smoke: {
    layers: [
      { template: 'core' },
      { template: 'wisps', label: 'Tendrils', sizeScale: 3.5, rateScale: 0.3 },
    ],
  },

  magic: {
    layers: [
      { template: 'core' },
      { template: 'glow', colorOverride: [0.7, 0.3, 1.0], colorBrighten: 0.35 },
      { template: 'accent', label: 'Sparkles', colorOverride: [0.9, 0.7, 1.0], speedScale: 1.8, gravityScale: 0.3 },
      { template: 'ring', label: 'Arcane Ring', colorOverride: [0.5, 0.2, 0.8] },
    ],
  },
};

// =============================================================================
// COMBINATION OVERRIDES — Special recipes for element combos
// =============================================================================
// When specific element pairs are detected, these override/augment the merged layers.

const COMBINATION_RECIPES = {
  // fire + water → steam
  'fire+water': {
    replace: true,
    layers: [
      { template: 'core', colorOverride: [0.9, 0.9, 0.95], label: 'Steam Core' },
      { template: 'glow', colorOverride: [0.95, 0.95, 1.0], sizeScale: 3.5 },
      { template: 'wisps', label: 'Steam Wisps', colorOverride: [0.85, 0.88, 0.92], sizeScale: 4.0, rateScale: 0.4 },
      { template: 'accent', label: 'Condensation', colorOverride: [0.8, 0.85, 0.9], gravityScale: 1.5 },
    ],
  },

  // fire + ice → melting/evaporation
  'fire+ice': {
    replace: true,
    layers: [
      { template: 'core', label: 'Melt Core' },
      { template: 'glow', colorOverride: [0.8, 0.6, 0.4] },
      { template: 'accent', label: 'Embers', colorOverride: [1.0, 0.4, 0.05], gravityScale: 2.0 },
      { template: 'accent', label: 'Droplets', colorOverride: [0.6, 0.8, 1.0], gravityScale: 3.0, speedScale: 1.2 },
      { template: 'wisps', label: 'Steam', colorOverride: [0.9, 0.9, 0.95] },
    ],
  },

  // water + ice → sleet/frost
  'water+ice': {
    replace: true,
    layers: [
      { template: 'core', label: 'Sleet Core' },
      { template: 'glow', colorOverride: [0.5, 0.7, 0.95] },
      { template: 'accent', label: 'Snowflakes', colorOverride: [0.9, 0.95, 1.0], gravityScale: 0.8, speedScale: 0.6 },
      { template: 'accent', label: 'Droplets', colorOverride: [0.6, 0.8, 1.0], gravityScale: 2.5 },
      { template: 'ring', label: 'Frost Ring', colorOverride: [0.6, 0.85, 1.0] },
    ],
  },

  // fire + magic → arcane fire
  'fire+magic': {
    replace: true,
    layers: [
      { template: 'core', label: 'Arcane Fire' },
      { template: 'glow', colorOverride: [0.8, 0.3, 0.9], colorBrighten: 0.3 },
      { template: 'accent', label: 'Arcane Sparks', colorOverride: [1.0, 0.5, 0.9], speedScale: 2.0 },
      { template: 'ring', label: 'Arcane Ring', colorOverride: [0.6, 0.15, 0.7] },
      { template: 'wisps', label: 'Dark Smoke', colorOverride: [0.2, 0.1, 0.25] },
    ],
  },

  // water + magic → enchanted water
  'water+magic': {
    replace: true,
    layers: [
      { template: 'core', label: 'Enchanted Water' },
      { template: 'glow', colorOverride: [0.3, 0.6, 1.0], colorBrighten: 0.3 },
      { template: 'accent', label: 'Sparkles', colorOverride: [0.7, 0.8, 1.0], speedScale: 1.5, gravityScale: 0.5 },
      { template: 'accent', label: 'Droplets', colorOverride: [0.5, 0.75, 1.0], gravityScale: 2.5 },
      { template: 'ring', label: 'Mystic Ring', colorOverride: [0.4, 0.5, 0.9] },
    ],
  },

  // ice + magic → frost magic
  'ice+magic': {
    replace: true,
    layers: [
      { template: 'core', label: 'Frost Magic' },
      { template: 'glow', colorOverride: [0.5, 0.7, 1.0], colorBrighten: 0.4, sizeScale: 3.0 },
      { template: 'accent', label: 'Ice Shards', colorOverride: [0.8, 0.9, 1.0], speedScale: 2.0, gravityScale: 0.4 },
      { template: 'ring', label: 'Frost Circle', colorOverride: [0.6, 0.8, 1.0] },
      { template: 'trail', label: 'Frost Trail', colorOverride: [0.7, 0.85, 1.0] },
    ],
  },

  // smoke + magic → dark magic
  'smoke+magic': {
    replace: true,
    layers: [
      { template: 'core', label: 'Dark Magic' },
      { template: 'glow', colorOverride: [0.4, 0.1, 0.5] },
      { template: 'wisps', label: 'Shadow Wisps', colorOverride: [0.15, 0.08, 0.2], sizeScale: 3.0 },
      { template: 'accent', label: 'Dark Sparkles', colorOverride: [0.6, 0.3, 0.8], speedScale: 1.2, gravityScale: -0.5 },
    ],
  },

  // fire + smoke → smoldering
  'fire+smoke': {
    replace: true,
    layers: [
      { template: 'core', label: 'Smoldering Core' },
      { template: 'glow', colorOverride: [0.9, 0.5, 0.15] },
      { template: 'accent', label: 'Embers', colorOverride: [1.0, 0.35, 0.05], gravityScale: 2.0, speedScale: 1.5 },
      { template: 'wisps', label: 'Thick Smoke', colorOverride: [0.25, 0.22, 0.2], sizeScale: 4.0, rateScale: 0.4 },
    ],
  },
};

// =============================================================================
// COMPOSE SPELL EFFECT — Main entry point
// =============================================================================

/**
 * Compose a multi-layer spell effect from an element mix.
 *
 * @param {Array<{id: string, power: number, enabled?: boolean}>} elements - Active element layers
 * @param {Object} baseConfig - Base emitter config from the parent emitter (rate, size, lifetime, etc.)
 * @param {Object} [options] - Additional options
 * @param {string} [options.spellName] - Custom name for the spell
 * @returns {Array<{name: string, layerType: string, emitterConfig: Object}>} Array of layer configs
 */
export function composeSpellEffect(elements, baseConfig = {}, options = {}) {
  const active = (elements || []).filter(e => e.enabled !== false && e.power > 0);
  if (active.length === 0) {
    return [{ name: 'Default', layerType: 'core', emitterConfig: { ...baseConfig } }];
  }

  // Normalize element IDs through aliases
  const normalized = active.map(e => ({
    id: ELEMENT_ALIASES[e.id] || e.id,
    power: e.power,
    enabled: true,
  }));

  // Sort by power descending
  const sorted = [...normalized].sort((a, b) => b.power - a.power);
  const elementIds = sorted.map(e => e.id);
  const uniqueIds = [...new Set(elementIds)];

  // Check for combination recipe (pair-wise, strongest pair first)
  let recipe = null;
  let comboName = null;
  if (uniqueIds.length >= 2) {
    for (let i = 0; i < uniqueIds.length - 1 && !recipe; i++) {
      for (let j = i + 1; j < uniqueIds.length && !recipe; j++) {
        const key1 = uniqueIds[i] + '+' + uniqueIds[j];
        const key2 = uniqueIds[j] + '+' + uniqueIds[i];
        recipe = COMBINATION_RECIPES[key1] || COMBINATION_RECIPES[key2];
        if (recipe) {
          comboName = key1;
        }
      }
    }
  }

  // Get element combo info from registry for base properties
  const derived = elementMixToEmitterConfig(normalized);

  let layerDefs;
  if (recipe && recipe.replace) {
    // Use combination recipe's layers directly
    layerDefs = recipe.layers;
  } else {
    // Merge layers from all active elements, deduplicate by template+label
    layerDefs = mergeElementLayers(uniqueIds, recipe);
  }

  // Build emitter configs for each layer
  const spellName = options.spellName || comboName || uniqueIds.join('+');
  const layers = [];

  for (let i = 0; i < layerDefs.length; i++) {
    const layerDef = layerDefs[i];
    const template = LAYER_TEMPLATES[layerDef.template] || LAYER_TEMPLATES.core;
    const layerConfig = buildLayerEmitterConfig(baseConfig, derived, template, layerDef, sorted);

    const layerLabel = layerDef.label || template.label;
    layers.push({
      name: `${capitalize(spellName)} — ${layerLabel}`,
      layerType: layerDef.template,
      emitterConfig: layerConfig,
    });
  }

  return layers;
}

/**
 * Get available element recipe IDs.
 */
export function getAvailableRecipes() {
  return {
    elements: Object.keys(ELEMENT_RECIPES),
    combinations: Object.keys(COMBINATION_RECIPES),
  };
}

// =============================================================================
// INTERNAL HELPERS
// =============================================================================

/**
 * Merge layers from multiple element recipes, deduplicating by template type.
 * Core layers are always present once. Other layers accumulate.
 */
function mergeElementLayers(elementIds, comboRecipe) {
  const layers = [];
  const seenKeys = new Set();

  // Always include core layer
  layers.push({ template: 'core' });
  seenKeys.add('core:Core');

  for (const elemId of elementIds) {
    const elemRecipe = ELEMENT_RECIPES[elemId];
    if (!elemRecipe) continue;

    for (const layerDef of elemRecipe.layers) {
      if (layerDef.template === 'core') continue; // Already added
      const key = layerDef.template + ':' + (layerDef.label || LAYER_TEMPLATES[layerDef.template]?.label || '');
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      layers.push({ ...layerDef });
    }
  }

  // Add combo augment layers if present (non-replace mode)
  if (comboRecipe && !comboRecipe.replace && comboRecipe.layers) {
    for (const layerDef of comboRecipe.layers) {
      const key = layerDef.template + ':' + (layerDef.label || '');
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      layers.push({ ...layerDef });
    }
  }

  return layers;
}

/**
 * Build a complete emitter config for a single visual layer.
 * Starts from the base config, applies the template multipliers,
 * then applies layer-specific overrides.
 */
function buildLayerEmitterConfig(baseConfig, derived, template, layerDef, sortedElements) {
  const cfg = {};

  // Type: inherit from base or use fire as fallback
  cfg.type = baseConfig.type || 'fire';

  // Elements: carry forward from base
  if (baseConfig.elements) {
    cfg.elements = baseConfig.elements.map(e => ({ ...e }));
  }

  // Color: use layer override, or derived color
  const baseColor = layerDef.colorOverride || derived.color || baseConfig.color || [1, 1, 1];
  cfg.color = [...baseColor];

  // Apply color brightening (shift toward white)
  const brighten = layerDef.colorBrighten ?? template.colorBrighten ?? 0;
  if (brighten > 0) {
    cfg.color[0] = Math.min(1, cfg.color[0] + brighten * (1 - cfg.color[0]));
    cfg.color[1] = Math.min(1, cfg.color[1] + brighten * (1 - cfg.color[1]));
    cfg.color[2] = Math.min(1, cfg.color[2] + brighten * (1 - cfg.color[2]));
  }

  // Apply color darkening (shift toward black)
  const darken = layerDef.colorDarken ?? template.colorDarken ?? 0;
  if (darken > 0) {
    cfg.color[0] = Math.max(0, cfg.color[0] * (1 - darken));
    cfg.color[1] = Math.max(0, cfg.color[1] * (1 - darken));
    cfg.color[2] = Math.max(0, cfg.color[2] * (1 - darken));
  }

  cfg.colorEnd = cfg.color; // Same color for now — could add gradient later

  // Rate
  const baseRate = baseConfig.rate || baseConfig.emitRate || 50;
  const rateScale = layerDef.rateScale ?? template.rateScale ?? 1.0;
  cfg.rate = Math.max(1, Math.round(baseRate * rateScale));

  // Size
  const baseSize = baseConfig.size || baseConfig.pointSize || 0.3;
  const sizeScale = layerDef.sizeScale ?? template.sizeScale ?? 1.0;
  cfg.size = Math.max(0.05, baseSize * sizeScale);

  // Lifetime
  const baseLifetime = baseConfig.lifetime || 1.5;
  const lifetimeScale = layerDef.lifetimeScale ?? template.lifetimeScale ?? 1.0;
  cfg.lifetime = baseLifetime * lifetimeScale;

  // Speed
  const baseSpeed = baseConfig.speed || 2.0;
  const speedScale = layerDef.speedScale ?? template.speedScale ?? 1.0;
  cfg.speed = baseSpeed * speedScale;

  // Horizontal speed
  if (template.horizontalSpeedOverride != null) {
    cfg.horizontalSpeed = template.horizontalSpeedOverride;
  } else if (template.horizontalSpeedScale != null) {
    cfg.horizontalSpeed = (baseConfig.horizontalSpeed || baseConfig.forward || 1.0) * template.horizontalSpeedScale;
  }

  // Gravity
  const baseGravity = baseConfig.gravity ?? -9.81;
  const gravityScale = layerDef.gravityScale ?? template.gravityScale ?? 1.0;
  cfg.gravity = baseGravity * gravityScale;

  // Drag
  if (template.dragOverride != null) {
    cfg.drag = layerDef.dragOverride ?? template.dragOverride;
  } else {
    cfg.drag = baseConfig.drag ?? 0.02;
  }

  // Mass
  cfg.mass = baseConfig.mass ?? 1.0;

  // Opacity
  const alphaScale = layerDef.alphaScale ?? template.alphaScale ?? 1.0;
  cfg.opacity = Math.min(1, (baseConfig.opacity ?? 1.0) * alphaScale);

  // Shape
  if (layerDef.shapeOverride) {
    cfg.shape = layerDef.shapeOverride;
  } else if (template.shapeOverride) {
    cfg.shape = template.shapeOverride;
  }

  // Temperature and material from derived
  cfg.temperature = derived.temperature;
  cfg.materialIndex = derived.materialIndex;

  // Substance from base if present
  if (baseConfig.substance) cfg.substance = baseConfig.substance;

  // Mark as spell layer (for grouping/cleanup)
  cfg._spellLayer = true;
  cfg._layerType = layerDef.template;

  return cfg;
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// =============================================================================
// EXPORTS
// =============================================================================

export {
  LAYER_TEMPLATES,
  ELEMENT_RECIPES,
  COMBINATION_RECIPES,
};
