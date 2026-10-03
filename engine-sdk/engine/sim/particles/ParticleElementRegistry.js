// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ParticleElementRegistry.js - Unified Element Registry
 * 
 * Bridges the two previously disconnected element systems:
 *   - Particle ELEMENTS (fire, water, magic, smoke) from ParticleEmitterSystem.js
 *   - Spell SPELL_ELEMENTS (fire, ice, lightning, arcane, nature, dark, holy) from SpellGenerator.js
 * 
 * Each unified element defines particle properties (color, materialIndex, temperature,
 * physics modifiers), spell properties (spellColors, effects, damageType), and
 * combination rules (from SpellElementMixer).
 * 
 * Also provides bridge functions:
 *   - elementMixToEmitterConfig(elements[]) → full emitter config derived from mix
 *   - getElementCombination(a, b) → combination result
 */

import { MATERIAL } from "./ParticleReactionTable.js";

// ============================================================================
// TRACE LOGGING — toggle to verify element→materialIndex→byproduct pipeline
// ============================================================================
let _traceEnabled = false;
let _traceThrottleMs = 500;
let _lastTraceTime = 0;

/**
 * Enable or disable element registry trace logging.
 * When enabled, logs every element mix derivation with full pipeline details.
 * @param {boolean} enabled
 * @param {number} [throttleMs=500] - Minimum ms between log messages (prevents spam)
 */
export function setRegistryTrace(enabled, throttleMs = 500) {
  _traceEnabled = enabled;
  _traceThrottleMs = throttleMs;
  console.log(`[ElementRegistry] Trace ${enabled ? 'ENABLED' : 'DISABLED'} (throttle: ${throttleMs}ms)`);
}

function _trace(...args) {
  if (!_traceEnabled) return;
  const now = performance.now();
  if (now - _lastTraceTime < _traceThrottleMs) return;
  _lastTraceTime = now;
  console.log('[ElementRegistry]', ...args);
}

// ============================================================================
// MATERIAL NAME LOOKUP (for readable logs)
// ============================================================================
const MATERIAL_NAMES = {};
for (const [k, v] of Object.entries(MATERIAL)) {
  MATERIAL_NAMES[v] = k;
}

// ============================================================================
// UNIFIED ELEMENT DEFINITIONS
// ============================================================================
// Superset of particle ELEMENTS + spell SPELL_ELEMENTS.
// Each entry has:
//   Particle props: color, colorEnd, materialIndex, temperature, gravityMod, upSpeedMod, spreadMod
//   Spell props:    spellColors {primary, secondary, tertiary}, effects[], damageType, soundHint
//   UI props:       label, icon, category

export const REGISTRY_ELEMENTS = {
  // === FIRE — both particle and spell ===
  fire: {
    id: "fire",
    label: "Fire",
    icon: "🔥",
    category: "elemental",
    // Particle properties (from ELEMENTS.fire)
    color: [1.0, 0.6, 0.1],
    colorEnd: [0.8, 0.2, 0.0],
    materialIndex: MATERIAL.FIRE,    // 11
    temperature: 1200,
    gravityMod: -2.0,
    upSpeedMod: 1.5,
    spreadMod: 0.5,
    // Spell properties (from SPELL_ELEMENTS.fire)
    spellColors: {
      primary: [1.0, 0.4, 0.0],
      secondary: [1.0, 0.9, 0.2],
      tertiary: [1.0, 0.1, 0.0],
    },
    effects: ["burn", "ignite"],
    damageType: "fire",
    particleEffect: "fireball",
    soundHint: "fire_whoosh",
  },

  // === WATER / ICE — particle "water" + spell "ice" ===
  water: {
    id: "water",
    label: "Water",
    icon: "💧",
    category: "elemental",
    color: [0.4, 0.7, 1.0],
    colorEnd: [0.2, 0.5, 0.9],
    materialIndex: MATERIAL.WATER,   // 1
    temperature: 293,
    gravityMod: 5.0,
    upSpeedMod: -0.5,
    spreadMod: 0.3,
    spellColors: {
      primary: [0.4, 0.7, 1.0],
      secondary: [0.7, 0.9, 1.0],
      tertiary: [0.2, 0.4, 0.8],
    },
    effects: ["splash", "drench"],
    damageType: "water",
    particleEffect: "ice",
    soundHint: "water_splash",
  },

  ice: {
    id: "ice",
    label: "Ice",
    icon: "❄️",
    category: "elemental",
    color: [0.6, 0.85, 1.0],
    colorEnd: [0.9, 0.95, 1.0],
    materialIndex: MATERIAL.ICE,     // 2
    temperature: 200,
    gravityMod: 3.0,
    upSpeedMod: -0.3,
    spreadMod: 0.2,
    spellColors: {
      primary: [0.6, 0.85, 1.0],
      secondary: [1.0, 1.0, 1.0],
      tertiary: [0.3, 0.5, 0.9],
    },
    effects: ["slow", "freeze"],
    damageType: "cold",
    particleEffect: "ice",
    soundHint: "ice_crack",
  },

  // === LIGHTNING — spell only, now also particle ===
  lightning: {
    id: "lightning",
    label: "Lightning",
    icon: "⚡",
    category: "elemental",
    color: [1.0, 1.0, 0.3],
    colorEnd: [0.3, 0.8, 1.0],
    materialIndex: MATERIAL.PLASMA,  // 10 — ionized gas
    temperature: 8000,
    gravityMod: -1.5,
    upSpeedMod: 2.0,
    spreadMod: 1.5,
    spellColors: {
      primary: [1.0, 1.0, 0.3],
      secondary: [1.0, 1.0, 1.0],
      tertiary: [0.3, 0.8, 1.0],
    },
    effects: ["shock", "stun"],
    damageType: "lightning",
    particleEffect: "lightning",
    soundHint: "thunder_crack",
  },

  // === ARCANE / MAGIC — particle "magic" + spell "arcane" ===
  arcane: {
    id: "arcane",
    label: "Arcane",
    icon: "🔮",
    category: "magical",
    color: [0.7, 0.2, 1.0],
    colorEnd: [0.3, 0.8, 1.0],
    materialIndex: MATERIAL.PLASMA,  // 10 — magical energy
    temperature: 500,
    gravityMod: -1.0,
    upSpeedMod: 0.0,
    spreadMod: 1.0,
    spellColors: {
      primary: [0.6, 0.2, 1.0],
      secondary: [0.9, 0.6, 1.0],
      tertiary: [0.2, 0.8, 1.0],
    },
    effects: ["dispel", "silence"],
    damageType: "arcane",
    particleEffect: "arcane",
    soundHint: "magic_pulse",
  },

  // === NATURE — spell only, now also particle ===
  nature: {
    id: "nature",
    label: "Nature",
    icon: "🌿",
    category: "magical",
    color: [0.2, 0.9, 0.3],
    colorEnd: [0.1, 0.6, 0.2],
    materialIndex: MATERIAL.WOOD,    // 4 — organic matter
    temperature: 293,
    gravityMod: 0.5,
    upSpeedMod: 0.3,
    spreadMod: 0.6,
    spellColors: {
      primary: [0.2, 0.9, 0.3],
      secondary: [0.8, 1.0, 0.4],
      tertiary: [0.1, 0.6, 0.2],
    },
    effects: ["heal", "regen", "poison"],
    damageType: "nature",
    particleEffect: "heal",
    soundHint: "nature_grow",
  },

  // === DARK — spell only, now also particle ===
  dark: {
    id: "dark",
    label: "Dark",
    icon: "🌑",
    category: "magical",
    color: [0.3, 0.0, 0.4],
    colorEnd: [0.1, 0.0, 0.1],
    materialIndex: MATERIAL.NONE,    // 0 — no thermal behavior
    temperature: 293,
    gravityMod: 0.0,
    upSpeedMod: -0.2,
    spreadMod: 0.8,
    spellColors: {
      primary: [0.3, 0.0, 0.4],
      secondary: [0.6, 0.0, 0.8],
      tertiary: [0.1, 0.0, 0.1],
    },
    effects: ["drain", "fear", "corrupt"],
    damageType: "shadow",
    particleEffect: "vortex",
    soundHint: "dark_whisper",
  },

  // === HOLY — spell only, now also particle ===
  holy: {
    id: "holy",
    label: "Holy",
    icon: "✨",
    category: "magical",
    color: [1.0, 0.95, 0.7],
    colorEnd: [1.0, 0.85, 0.4],
    materialIndex: MATERIAL.NONE,    // 0 — no thermal behavior
    temperature: 293,
    gravityMod: -0.5,
    upSpeedMod: 0.8,
    spreadMod: 0.4,
    spellColors: {
      primary: [1.0, 0.95, 0.7],
      secondary: [1.0, 1.0, 1.0],
      tertiary: [1.0, 0.85, 0.4],
    },
    effects: ["purify", "bless", "smite"],
    damageType: "holy",
    particleEffect: "heal",
    soundHint: "holy_choir",
  },

};

// ============================================================================
// REACTION PRODUCTS — Not primary elements. Generated as byproducts.
// ============================================================================
// These are results of element interactions, not things you "pick" from a grid.
// They exist for backward compat (old ELEMENTS.smoke) and for the auto-byproduct
// system to reference when describing what a mix produces.

export const REACTION_PRODUCTS = {
  smoke: {
    id: "smoke",
    label: "Smoke",
    icon: "💨",
    color: [0.5, 0.5, 0.55],
    colorEnd: [0.3, 0.3, 0.35],
    materialIndex: MATERIAL.SMOKE,   // 12
    temperature: 400,
    gravityMod: -0.5,
    upSpeedMod: 0.5,
    spreadMod: 0.8,
    description: "Byproduct of combustion (fire + fuel)",
  },
  steam: {
    id: "steam",
    label: "Steam",
    icon: "♨️",
    color: [0.9, 0.9, 0.95],
    colorEnd: [0.7, 0.8, 0.9],
    materialIndex: MATERIAL.STEAM,   // 13
    temperature: 400,
    gravityMod: -1.0,
    upSpeedMod: 1.0,
    spreadMod: 0.6,
    description: "Water heated past boiling (fire + water)",
  },
  ash: {
    id: "ash",
    label: "Ash",
    icon: "🌋",
    color: [0.4, 0.3, 0.3],
    colorEnd: [0.2, 0.1, 0.1],
    materialIndex: MATERIAL.DEBRIS,  // 15
    temperature: 600,
    gravityMod: 2.0,
    upSpeedMod: -0.3,
    spreadMod: 0.4,
    description: "Residue from burning organic matter (fire + nature)",
  },
  sparks: {
    id: "sparks",
    label: "Sparks",
    icon: "✨",
    color: [1.0, 0.7, 0.3],
    colorEnd: [0.6, 0.3, 0.1],
    materialIndex: MATERIAL.SPARKS,  // 14
    temperature: 1200,
    gravityMod: 8.0,
    upSpeedMod: 3.0,
    spreadMod: 2.0,
    description: "Hot fragments from collision or intense heat",
  },
};

// ============================================================================
// AUTO-BYPRODUCTS — What each element naturally produces
// ============================================================================
// When an element is active, it may auto-generate byproduct particles.
// This replaces the old pattern of manually adding smoke to fire presets.
// Each entry: { byproduct: REACTION_PRODUCTS key, power: relative to source }

export const AUTO_BYPRODUCTS = {
  // Fire always produces smoke (combustion byproduct)
  fire:      [{ byproduct: "smoke", power: 0.35, description: "Combustion smoke" }],
  // Lightning produces a faint smoke trail (ionized air)
  lightning: [{ byproduct: "smoke", power: 0.1, description: "Ionized air trail" }],
  // Nothing else auto-produces byproducts by itself
};

// ============================================================================
// COMBINATION BYPRODUCTS — What element pairs produce
// ============================================================================
// When two elements are mixed, certain combinations auto-generate specific products.
// This is separate from ELEMENT_COMBINATIONS (which define the combined element result).
// These describe the PHYSICAL byproducts of the interaction.

export const COMBINATION_BYPRODUCTS = {
  "fire+water":     [{ byproduct: "steam", power: 0.5, description: "Water evaporated by fire" }],
  "fire+ice":       [{ byproduct: "steam", power: 0.4, description: "Ice melted then evaporated" }],
  "fire+nature":    [{ byproduct: "smoke", power: 0.6, description: "Burning vegetation" }, { byproduct: "ash", power: 0.3, description: "Combustion residue" }],
  "lightning+water": [{ byproduct: "steam", power: 0.2, description: "Flash evaporation" }],
};

// ============================================================================
// BACKWARD-COMPATIBLE ALIASES
// ============================================================================
// "magic" in the old particle ELEMENTS → "arcane" in the unified registry
// "smoke" in the old particle ELEMENTS → reaction product (still resolvable)
export const ELEMENT_ALIASES = {
  magic: "arcane",
  smoke: "smoke",  // Maps to REACTION_PRODUCTS.smoke, not a primary element
};

// ============================================================================
// ELEMENT COMBINATION RULES (from SpellElementMixer, now centralized)
// ============================================================================
// Key format: "elementA+elementB" (alphabetical order for consistency)
// Each combination produces a named result with merged properties.

export const ELEMENT_COMBINATIONS = {
  "fire+ice":       { id: "steam",        name: "Steam",         icon: "♨️",   color: [0.9, 0.9, 0.95],    colorEnd: [0.7, 0.8, 0.9],   temperature: 400,  materialIndex: MATERIAL.STEAM, effects: ["scald", "obscure"],          damageType: "steam" },
  "fire+lightning":  { id: "plasma",       name: "Plasma",        icon: "⚡🔥", color: [1.0, 0.8, 1.0],     colorEnd: [0.8, 0.2, 0.5],   temperature: 12000, materialIndex: MATERIAL.PLASMA, effects: ["burn", "shock", "disintegrate"], damageType: "plasma" },
  "fire+arcane":    { id: "hellfire",     name: "Hellfire",      icon: "🔥🔮", color: [0.8, 0.2, 1.0],     colorEnd: [0.4, 0.0, 0.3],   temperature: 2000, materialIndex: MATERIAL.FIRE,   effects: ["burn", "curse", "soul_burn"], damageType: "hellfire" },
  "fire+nature":    { id: "ash",          name: "Ash",           icon: "🌋",   color: [0.4, 0.3, 0.3],     colorEnd: [0.2, 0.1, 0.1],   temperature: 800,  materialIndex: MATERIAL.FIRE,   effects: ["burn", "blind", "wither"],   damageType: "fire" },
  "fire+dark":      { id: "shadowflame",  name: "Shadowflame",   icon: "🔥🌑", color: [0.3, 0.0, 0.1],     colorEnd: [0.1, 0.0, 0.05],  temperature: 1500, materialIndex: MATERIAL.FIRE,   effects: ["burn", "fear", "darkness"],   damageType: "shadowfire" },
  "fire+holy":      { id: "radiance",     name: "Radiance",      icon: "🔥✨", color: [1.0, 0.95, 0.8],    colorEnd: [1.0, 0.8, 0.4],   temperature: 1200, materialIndex: MATERIAL.FIRE,   effects: ["burn", "purify", "blind"],   damageType: "radiant" },
  "fire+water":     { id: "steam",        name: "Steam",         icon: "♨️",   color: [0.9, 0.9, 0.95],    colorEnd: [0.7, 0.8, 0.9],   temperature: 400,  materialIndex: MATERIAL.STEAM, effects: ["scald", "obscure"],          damageType: "steam" },
  // fire+smoke removed: smoke is a byproduct of fire, not a combinable element

  "ice+lightning":   { id: "frostshock",   name: "Frostshock",    icon: "❄️⚡", color: [0.6, 0.9, 1.0],     colorEnd: [0.3, 0.5, 0.9],   temperature: 150,  materialIndex: MATERIAL.ICE,    effects: ["freeze", "shock", "shatter"], damageType: "frostlightning" },
  "ice+arcane":     { id: "voidice",      name: "Void Ice",      icon: "❄️🔮", color: [0.4, 0.5, 0.8],     colorEnd: [0.2, 0.1, 0.4],   temperature: 100,  materialIndex: MATERIAL.ICE,    effects: ["freeze", "slow_time", "silence"], damageType: "voidcold" },
  "ice+nature":     { id: "permafrost",   name: "Permafrost",    icon: "❄️🌿", color: [0.7, 0.9, 0.8],     colorEnd: [0.4, 0.6, 0.5],   temperature: 200,  materialIndex: MATERIAL.ICE,    effects: ["freeze", "root", "slow"],    damageType: "cold" },
  "ice+dark":       { id: "netherfrost",  name: "Netherfrost",   icon: "❄️🌑", color: [0.2, 0.3, 0.5],     colorEnd: [0.05, 0.05, 0.1], temperature: 50,   materialIndex: MATERIAL.ICE,    effects: ["freeze", "drain", "despair"], damageType: "nethercold" },
  "ice+holy":       { id: "crystalLight", name: "Crystal Light",  icon: "❄️✨", color: [0.9, 0.95, 1.0],    colorEnd: [0.8, 0.9, 1.0],   temperature: 180,  materialIndex: MATERIAL.ICE,    effects: ["freeze", "purify", "illuminate"], damageType: "holyice" },
  "ice+water":      { id: "sleet",        name: "Sleet",          icon: "❄️💧", color: [0.5, 0.7, 0.9],     colorEnd: [0.4, 0.6, 0.85],  temperature: 270,  materialIndex: MATERIAL.ICE,    effects: ["slow", "drench"],            damageType: "cold" },

  "lightning+arcane": { id: "arcanestorm", name: "Arcane Storm",  icon: "⚡🔮", color: [0.7, 0.5, 1.0],     colorEnd: [0.4, 0.2, 0.8],   temperature: 6000, materialIndex: MATERIAL.PLASMA, effects: ["shock", "dispel", "mana_burn"], damageType: "arcanelightning" },
  "lightning+nature": { id: "stormvine",   name: "Stormvine",     icon: "⚡🌿", color: [0.5, 0.9, 0.4],     colorEnd: [0.3, 0.7, 0.3],   temperature: 2000, materialIndex: MATERIAL.PLASMA, effects: ["shock", "root", "energize"], damageType: "stormnature" },
  "lightning+dark":  { id: "darkbolt",    name: "Dark Bolt",     icon: "⚡🌑", color: [0.3, 0.0, 0.4],     colorEnd: [0.1, 0.0, 0.2],   temperature: 5000, materialIndex: MATERIAL.PLASMA, effects: ["shock", "fear", "paralyze"], damageType: "darklightning" },
  "lightning+holy":  { id: "divineStrike", name: "Divine Strike", icon: "⚡✨", color: [1.0, 1.0, 0.8],     colorEnd: [1.0, 0.9, 0.5],   temperature: 7000, materialIndex: MATERIAL.PLASMA, effects: ["shock", "smite", "stun"],    damageType: "holylightning" },
  "lightning+water": { id: "electrified",  name: "Electrified",   icon: "⚡💧", color: [0.5, 0.8, 1.0],     colorEnd: [0.8, 0.9, 1.0],   temperature: 1000, materialIndex: MATERIAL.PLASMA, effects: ["shock", "splash"],           damageType: "lightning" },

  "arcane+nature":  { id: "feymagic",    name: "Fey Magic",     icon: "🔮🌿", color: [0.5, 0.9, 0.7],     colorEnd: [0.3, 0.7, 0.5],   temperature: 400,  materialIndex: MATERIAL.PLASMA, effects: ["charm", "heal", "polymorph"], damageType: "fey" },
  "arcane+dark":    { id: "voidmagic",   name: "Void Magic",    icon: "🔮🌑", color: [0.1, 0.0, 0.2],     colorEnd: [0.0, 0.0, 0.05],  temperature: 300,  materialIndex: MATERIAL.NONE,   effects: ["banish", "drain", "warp"],   damageType: "void" },
  "arcane+holy":    { id: "celestial",   name: "Celestial",     icon: "🔮✨", color: [0.9, 0.85, 1.0],    colorEnd: [0.7, 0.6, 0.9],   temperature: 600,  materialIndex: MATERIAL.PLASMA, effects: ["bless", "dispel", "enlighten"], damageType: "celestial" },
  // arcane+smoke removed: smoke is a byproduct, not a combinable element

  "nature+dark":    { id: "blight",      name: "Blight",        icon: "🌿🌑", color: [0.3, 0.4, 0.2],     colorEnd: [0.1, 0.15, 0.05], temperature: 293,  materialIndex: MATERIAL.WOOD,   effects: ["poison", "wither", "corrupt"], damageType: "blight" },
  "nature+holy":    { id: "lifebless",   name: "Life Blessing",  icon: "🌿✨", color: [0.6, 1.0, 0.6],     colorEnd: [0.4, 0.9, 0.4],   temperature: 293,  materialIndex: MATERIAL.WOOD,   effects: ["heal", "regen", "cleanse", "revive"], damageType: "life" },

  "dark+holy":      { id: "twilight",    name: "Twilight",      icon: "🌑✨", color: [0.5, 0.4, 0.6],     colorEnd: [0.3, 0.2, 0.4],   temperature: 293,  materialIndex: MATERIAL.NONE,   effects: ["balance", "phase", "duality"], damageType: "twilight" },

  // water+smoke removed: smoke is a byproduct, not a combinable element
};

// Build reverse lookup cache (b+a → same as a+b)
const _comboCache = new Map();
for (const [key, combo] of Object.entries(ELEMENT_COMBINATIONS)) {
  _comboCache.set(key, combo);
  const [a, b] = key.split("+");
  _comboCache.set(`${b}+${a}`, combo);
}

// Build combination byproduct cache (same reverse lookup)
const _comboBPCache = new Map();
for (const [key, bps] of Object.entries(COMBINATION_BYPRODUCTS)) {
  _comboBPCache.set(key, bps);
  const [a, b] = key.split("+");
  _comboBPCache.set(`${b}+${a}`, bps);
}

// ============================================================================
// LOOKUP FUNCTIONS
// ============================================================================

/**
 * Get a registry element by ID.
 * Handles backward-compat aliases (e.g., "magic" → "arcane").
 * Falls back to REACTION_PRODUCTS for byproduct IDs (e.g., "smoke").
 * @param {string} id
 * @returns {Object|null}
 */
export function getRegistryElement(id) {
  if (!id) return null;
  const resolved = ELEMENT_ALIASES[id] || id;
  return REGISTRY_ELEMENTS[resolved] || REACTION_PRODUCTS[resolved] || null;
}

/**
 * Check if an element ID is a primary element (user-selectable) vs reaction product.
 * @param {string} id
 * @returns {boolean}
 */
export function isPrimaryElement(id) {
  if (!id) return false;
  const resolved = ELEMENT_ALIASES[id] || id;
  return resolved in REGISTRY_ELEMENTS;
}

/**
 * Get all registry elements as an array.
 * @returns {Array<Object>}
 */
export function getAllRegistryElements() {
  return Object.values(REGISTRY_ELEMENTS);
}

/**
 * Get element IDs grouped by category.
 * @returns {Array<{ category: string, elements: Array<Object> }>}
 */
export function getRegistryElementsByCategory() {
  const groups = {};
  for (const elem of Object.values(REGISTRY_ELEMENTS)) {
    const cat = elem.category || "other";
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(elem);
  }
  return Object.entries(groups).map(([category, elements]) => ({ category, elements }));
}

/**
 * Look up the combination result for two elements.
 * @param {string} elementA
 * @param {string} elementB
 * @returns {Object|null} Combination data or null if no predefined combo
 */
export function getElementCombination(elementA, elementB) {
  if (!elementA || !elementB) return null;
  const a = ELEMENT_ALIASES[elementA] || elementA;
  const b = ELEMENT_ALIASES[elementB] || elementB;
  if (a === b) return null; // Same element = enhanced, not a combination
  return _comboCache.get(`${a}+${b}`) || null;
}

/**
 * Get all combinations involving a specific element.
 * @param {string} elementId
 * @returns {Array<{ partner: string, result: Object }>}
 */
export function getCombinationsFor(elementId) {
  const id = ELEMENT_ALIASES[elementId] || elementId;
  const results = [];
  for (const [key, combo] of Object.entries(ELEMENT_COMBINATIONS)) {
    const [a, b] = key.split("+");
    if (a === id) results.push({ partner: b, result: combo });
    else if (b === id) results.push({ partner: a, result: combo });
  }
  return results;
}

// ============================================================================
// BRIDGE FUNCTIONS: Element Mix → Emitter Config
// ============================================================================

/**
 * Given an array of active element layers [{id, power, enabled}],
 * derive a complete emitter property set: color, colorEnd, temperature,
 * materialIndex, gravityMod, and combination info.
 * 
 * This replaces the separate deriveColorFromElements + deriveTemperatureFromElements
 * + deriveMaterialIndexFromElements calls with one unified function.
 * 
 * @param {Array<{id: string, power: number, enabled?: boolean}>} elements
 * @returns {Object} Derived emitter properties
 */
export function elementMixToEmitterConfig(elements) {
  const active = (elements || []).filter(e => e.enabled !== false && e.power > 0);

  if (active.length === 0) {
    return {
      color: [1, 1, 1],
      colorEnd: [0.8, 0.8, 0.8],
      temperature: 293,
      materialIndex: 0,
      gravityMod: 0,
      upSpeedMod: 0,
      spreadMod: 0,
      combination: null,
      combinationName: null,
      byproducts: [],
    };
  }

  _trace('MIX INPUT:', active.map(e => `${e.id}(${e.power.toFixed(2)})`).join(' + '));

  // ---- Collect auto-byproducts ----
  const byproducts = [];
  const byproductSeen = new Set();

  // Per-element auto-byproducts (e.g., fire → smoke)
  for (const layer of active) {
    const resolvedId = ELEMENT_ALIASES[layer.id] || layer.id;
    const autoBP = AUTO_BYPRODUCTS[resolvedId];
    if (autoBP) {
      for (const bp of autoBP) {
        const product = REACTION_PRODUCTS[bp.byproduct];
        if (product && !byproductSeen.has(bp.byproduct)) {
          byproductSeen.add(bp.byproduct);
          const derivedPower = bp.power * layer.power;
          byproducts.push({
            ...product,
            power: derivedPower,
            description: bp.description,
            source: resolvedId,
          });
          _trace(`  AUTO-BYPRODUCT: ${resolvedId} → ${bp.byproduct}(${derivedPower.toFixed(2)}) [${bp.description}]`);
        }
      }
    }
  }

  // Combination byproducts (e.g., fire+water → steam)
  if (active.length >= 2) {
    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const a = ELEMENT_ALIASES[active[i].id] || active[i].id;
        const b = ELEMENT_ALIASES[active[j].id] || active[j].id;
        const comboBP = _comboBPCache.get(`${a}+${b}`) || _comboBPCache.get(`${b}+${a}`);
        if (comboBP) {
          for (const bp of comboBP) {
            const product = REACTION_PRODUCTS[bp.byproduct];
            if (product && !byproductSeen.has(bp.byproduct)) {
              byproductSeen.add(bp.byproduct);
              const derivedPower = bp.power * Math.min(active[i].power, active[j].power);
              byproducts.push({
                ...product,
                power: derivedPower,
                description: bp.description,
                source: `${a}+${b}`,
              });
              _trace(`  COMBO-BYPRODUCT: ${a}+${b} → ${bp.byproduct}(${derivedPower.toFixed(2)}) [${bp.description}]`);
            }
          }
        }
      }
    }
  }

  // ---- Check for 2-element combination ----
  let combination = null;
  if (active.length === 2) {
    combination = getElementCombination(active[0].id, active[1].id);
  }

  // If we have a known combination, use its properties
  if (combination) {
    const totalPower = active.reduce((s, e) => s + e.power, 0);
    let gravityMod = 0, upSpeedMod = 0, spreadMod = 0;
    for (const layer of active) {
      const elem = getRegistryElement(layer.id);
      if (!elem) continue;
      const w = layer.power / totalPower;
      gravityMod += (elem.gravityMod || 0) * w;
      upSpeedMod += (elem.upSpeedMod || 0) * w;
      spreadMod += (elem.spreadMod || 0) * w;
    }
    _trace(`  COMBINATION: ${active.map(e=>e.id).join('+')} → ${combination.name} | matIdx=${combination.materialIndex}(${MATERIAL_NAMES[combination.materialIndex]||'?'}) | temp=${combination.temperature}K | byproducts=[${byproducts.map(b=>b.id).join(',')}]`);
    return {
      color: [...combination.color],
      colorEnd: [...combination.colorEnd],
      temperature: combination.temperature,
      materialIndex: combination.materialIndex,
      gravityMod,
      upSpeedMod,
      spreadMod,
      combination,
      combinationName: combination.name,
      byproducts,
    };
  }

  // No known combination — power-weighted blend
  let totalPower = 0;
  const color = [0, 0, 0];
  const colorEnd = [0, 0, 0];
  let temperature = 0;
  let gravityMod = 0;
  let upSpeedMod = 0;
  let spreadMod = 0;
  let bestMaterialPower = -1;
  let bestMaterialIndex = 0;

  for (const layer of active) {
    const elem = getRegistryElement(layer.id);
    if (!elem) continue;
    const p = layer.power;
    totalPower += p;

    color[0] += elem.color[0] * p;
    color[1] += elem.color[1] * p;
    color[2] += elem.color[2] * p;
    colorEnd[0] += elem.colorEnd[0] * p;
    colorEnd[1] += elem.colorEnd[1] * p;
    colorEnd[2] += elem.colorEnd[2] * p;

    temperature += (elem.temperature || 293) * p;
    gravityMod += (elem.gravityMod || 0) * p;
    upSpeedMod += (elem.upSpeedMod || 0) * p;
    spreadMod += (elem.spreadMod || 0) * p;

    if (p > bestMaterialPower && elem.materialIndex != null) {
      bestMaterialPower = p;
      bestMaterialIndex = elem.materialIndex;
    }
  }

  if (totalPower > 0) {
    color[0] /= totalPower;
    color[1] /= totalPower;
    color[2] /= totalPower;
    colorEnd[0] /= totalPower;
    colorEnd[1] /= totalPower;
    colorEnd[2] /= totalPower;
    temperature /= totalPower;
    gravityMod /= totalPower;
    upSpeedMod /= totalPower;
    spreadMod /= totalPower;
  }

  const result = {
    color,
    colorEnd,
    temperature: Math.round(temperature),
    materialIndex: bestMaterialIndex,
    gravityMod,
    upSpeedMod,
    spreadMod,
    combination: null,
    combinationName: null,
    byproducts,
  };
  _trace(`  BLEND: matIdx=${bestMaterialIndex}(${MATERIAL_NAMES[bestMaterialIndex]||'?'}) | temp=${result.temperature}K | byproducts=[${byproducts.map(b=>b.id).join(',')}]`);
  return result;
}

/**
 * Convert meta-slider values (Intensity 0-1, Spread 0-1, Lifetime 0-1)
 * into concrete emitter physics parameters.
 * Used by Simple Mode to provide easy controls.
 * 
 * @param {{ intensity: number, spread: number, lifetime: number }} meta
 * @returns {Object} Physics overrides
 */
export function metaSlidersToPhysics(meta) {
  const intensity = Math.max(0, Math.min(1, meta.intensity ?? 0.5));
  const spread = Math.max(0, Math.min(1, meta.spread ?? 0.5));
  const lifetime = Math.max(0, Math.min(1, meta.lifetime ?? 0.5));

  return {
    // Intensity maps to emitRate (5–500) and pointSize (1–8)
    emitRate: Math.round(5 + intensity * 495),
    pointSize: 1.0 + intensity * 7.0,

    // Spread maps to horizontalSpeed (0–5) and upSpeed range
    horizontalSpeed: spread * 5.0,
    upSpeedMin: spread * 2.0,
    upSpeedMax: 1.0 + spread * 8.0,

    // Lifetime maps to [0.3, 0.5] → [10, 30] seconds
    lifetimeMin: 0.3 + lifetime * 9.7,
    lifetimeMax: 0.5 + lifetime * 29.5,
  };
}

/**
 * Convert an active element mix into spell generator parameters.
 * Used by the "Create Spell From This" button.
 * 
 * @param {Array<{id: string, power: number}>} elements - Active element layers
 * @returns {{ element: string, type: string, powerLevel: number, combinedElement: string|null }}
 */
export function elementMixToSpellParams(elements) {
  const active = (elements || []).filter(e => e.enabled !== false && e.power > 0);
  if (active.length === 0) {
    return { element: "fire", type: "projectile", powerLevel: 1.0, combinedElement: null };
  }

  // Sort by power descending — primary element is the strongest
  const sorted = [...active].sort((a, b) => b.power - a.power);
  const primary = ELEMENT_ALIASES[sorted[0].id] || sorted[0].id;
  const totalPower = sorted.reduce((s, e) => s + e.power, 0);

  // Map registry element to spell element ID
  // The spell system uses the same IDs as registry except water→ice for spell matching
  const spellElement = primary === "water" ? "ice" : primary;

  // If two elements, check for combination
  let combinedElement = null;
  if (sorted.length >= 2) {
    const secondary = ELEMENT_ALIASES[sorted[1].id] || sorted[1].id;
    const combo = getElementCombination(primary, secondary);
    if (combo) {
      combinedElement = combo.id;
    }
  }

  // Determine spell type from element characteristics
  const elem = getRegistryElement(primary);
  let type = "projectile";
  if (elem) {
    if (elem.damageType === "nature" || elem.damageType === "holy") type = "buff";
    else if (elem.temperature >= 5000) type = "beam";
  }

  return {
    element: spellElement,
    type,
    powerLevel: Math.min(3.0, totalPower),
    combinedElement,
  };
}

// ============================================================================
// GLOBAL DEBUG ACCESS
// ============================================================================
// Expose trace toggle on globalThis so it can be toggled from the browser console:
//   window._elementRegistry.trace(true)   — enable
//   window._elementRegistry.trace(false)  — disable
//   window._elementRegistry.elements      — list all primary elements
//   window._elementRegistry.products      — list all reaction products
//   window._elementRegistry.testMix(['fire','water']) — test a mix
if (typeof globalThis !== 'undefined') {
  globalThis._elementRegistry = {
    trace: setRegistryTrace,
    elements: REGISTRY_ELEMENTS,
    products: REACTION_PRODUCTS,
    aliases: ELEMENT_ALIASES,
    combinations: ELEMENT_COMBINATIONS,
    autoByproducts: AUTO_BYPRODUCTS,
    comboByproducts: COMBINATION_BYPRODUCTS,
    testMix: (ids, powers) => {
      const elements = ids.map((id, i) => ({ id, power: powers?.[i] ?? 0.5, enabled: true }));
      const result = elementMixToEmitterConfig(elements);
      console.log(`[ElementRegistry] testMix(${ids.join('+')}):`);
      console.log(`  materialIndex: ${result.materialIndex} (${MATERIAL_NAMES[result.materialIndex] || '?'})`);
      console.log(`  temperature: ${result.temperature}K`);
      console.log(`  color: [${result.color.map(c=>c.toFixed(3)).join(', ')}]`);
      console.log(`  combination: ${result.combinationName || 'none (power-weighted blend)'}`);
      console.log(`  byproducts: ${result.byproducts.length === 0 ? 'none' : result.byproducts.map(b => `${b.icon} ${b.id}(${b.power.toFixed(2)}) from ${b.source} — "${b.description}"`).join(', ')}`);
      return result;
    },
  };
}
