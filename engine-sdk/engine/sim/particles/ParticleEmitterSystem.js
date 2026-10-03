// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ParticleEmitterSystem - Manages particle emitters and emission over time
 * 
 * ⚠️ MULTIPLAYER: Uses deterministic RNG from AIRandom.js
 */

import { updateBuffer } from "../../core/gpu/GpuBuffer.js";
import { aiRng } from "../ai/AIRandom.js";
import { degreesToRadians } from "../../core/math/UnitMath.js";
import {
  PARTICLE_SHAPES,
  RENDER_MODES,
  PARTICLE_BEHAVIORS,
  getShapeId,
  getRenderModeId,
  getBehaviorId,
  packParticleMeta,
  validateEmitterConfig,
  createDefaultEmitterConfig,
} from "./ParticleSchema.js";
import { spawnFromShape, velocityFromNormal } from "./ParticleSpawnShapes.js";
import { getElement, getElementBySymbol, MOLECULE_PRESETS } from "./ParticleElementTable.js";
import { getMaterialForSubstance } from "./ParticleReactionTable.js";
import { getSubstance as getRegisteredSubstance } from "./substances/SubstanceRegistry.js";
import "./substances/materials/index.js"; // Side-effect: auto-registers all 21 substances

// ============================================================================
// REUSABLE BUFFERS (reduce/reuse/recycle - avoid allocations in hot paths)
// ============================================================================
const _singlePos = new Float32Array(4);
const _singleVel = new Float32Array(4);
const _singleMeta = new Float32Array(4);
const _singleThermal = new Float32Array(4);
const _updateCountsResult = { liveCount: 0, deadCount: 0, freeSlots: 0 };
const _singleElement = new Uint32Array(1);
const _singleCharge = new Float32Array(1);

// =============================================================================
// SUBSTANCE REGISTRY BRIDGE — Pull per-substance folder data into emitter fields
// =============================================================================

/**
 * Resolve substance registry data into emitter-compatible default fields.
 * Returns null if the substance isn't registered. Values here are the lowest
 * priority — overridden by EMITTER_TYPES, EMITTER_PRESETS, then explicit options.
 *
 * @param {string|null} substanceKey - Substance id (e.g. 'water', 'honey', 'blood')
 * @returns {Object|null} Flat object with emitter-compatible field names
 */
function resolveSubstanceDefaults(substanceKey) {
  if (!substanceKey) return null;
  const sub = getRegisteredSubstance(substanceKey);
  if (!sub) return null;

  const out = {};

  // Emitter timing/physics from substance emitter.js
  const e = sub.emitter;
  if (e) {
    if (e.emitRate != null)        out.emitRate = e.emitRate;
    if (e.maxParticles != null)    out.maxParticles = e.maxParticles;
    if (e.pointSize != null)       out.pointSize = e.pointSize;
    if (e.lifetime != null)        out.lifetime = e.lifetime;
    if (e.upSpeed != null)         out.upSpeed = e.upSpeed;
    if (e.horizontalSpeed != null) out.horizontalSpeed = e.horizontalSpeed;
    if (e.gravity != null)         out.gravity = e.gravity;
    if (e.mass != null)            out.mass = e.mass;
    if (e.drag != null)            out.drag = e.drag;
    if (e.sizeOverLife)            out.sizeOverLife = e.sizeOverLife;
    if (e.alphaOverLife)           out.alphaOverLife = e.alphaOverLife;
    if (e.velocityOverLife)        out.velocityOverLife = e.velocityOverLife;
  }

  // Visual from substance visual.js
  const v = sub.visual;
  if (v) {
    if (v.color)         out.color = v.color;
    if (v.colorEnd)      out.colorEnd = v.colorEnd;
    if (v.opacity != null) out.opacity = v.opacity;
    if (v.particleShape) out.shape = v.particleShape;
  }

  // SPH from substance sph.js
  const s = sub.sph;
  if (s) {
    if (s.restDensity != null) out.sphRestDensity = s.restDensity;
    if (s.viscosity != null)   out.sphViscosity = s.viscosity;
    if (s.restDensity > 0)     out.restDensity = s.restDensity;
  }

  // Thermal from substance thermal.js
  const t = sub.thermal;
  if (t) {
    if (t.defaultTemperature != null) out.temperature = t.defaultTemperature;
  }

  // Material ID
  if (sub.materialId != null) out.materialIndex = sub.materialId;

  return out;
}

// =============================================================================
// SUBSTANCE PRESETS — Map visual presets + element symbols to real chemistry
// =============================================================================
// Each entry: { atomicNumber, temperature, charge, compound? }
// compound entries use the primary element's atomicNumber for physics
export const SUBSTANCE_PRESETS = {
  // Legacy visual presets → real elements
  fire:    { atomicNumber: 6,  temperature: 1200, charge: 0,  label: "Fire (Carbon Combustion)" },
  water:   { atomicNumber: 8,  temperature: 293,  charge: 0,  label: "Water (H₂O)", compound: "H2O", meltPoint: 273, boilPoint: 373 },
  smoke:   { atomicNumber: 6,  temperature: 400,  charge: 0,  label: "Smoke (Carbon Soot)" },
  magic:   { atomicNumber: 10, temperature: 8000, charge: 2,  label: "Magic (Ionized Neon)" },

  // Common elements (direct periodic table)
  H:       { atomicNumber: 1,  temperature: 20,   charge: 0,  label: "Hydrogen" },
  He:      { atomicNumber: 2,  temperature: 4,    charge: 0,  label: "Helium" },
  C:       { atomicNumber: 6,  temperature: 293,  charge: 0,  label: "Carbon" },
  N:       { atomicNumber: 7,  temperature: 77,   charge: 0,  label: "Nitrogen" },
  O:       { atomicNumber: 8,  temperature: 90,   charge: 0,  label: "Oxygen" },
  Na:      { atomicNumber: 11, temperature: 371,  charge: 1,  label: "Sodium" },
  Fe:      { atomicNumber: 26, temperature: 293,  charge: 0,  label: "Iron" },
  Cu:      { atomicNumber: 29, temperature: 293,  charge: 0,  label: "Copper" },
  Au:      { atomicNumber: 79, temperature: 293,  charge: 0,  label: "Gold" },
  Ne:      { atomicNumber: 10, temperature: 27,   charge: 0,  label: "Neon" },
  Ar:      { atomicNumber: 18, temperature: 87,   charge: 0,  label: "Argon" },
  Si:      { atomicNumber: 14, temperature: 293,  charge: 0,  label: "Silicon" },

  // Compound presets
  H2O:     { atomicNumber: 8,  temperature: 293,  charge: 0,  label: "Water (H₂O)", compound: "H2O", meltPoint: 273, boilPoint: 373 },
  CO2:     { atomicNumber: 6,  temperature: 293,  charge: 0,  label: "Carbon Dioxide", compound: "CO2", meltPoint: 195, boilPoint: 195 },
  NaCl:    { atomicNumber: 11, temperature: 293,  charge: 0,  label: "Salt (NaCl)", compound: "NaCl", meltPoint: 1074, boilPoint: 1686 },
  CH4:     { atomicNumber: 6,  temperature: 111,  charge: 0,  label: "Methane", compound: "CH4", meltPoint: 91, boilPoint: 112 },
  SiO2:    { atomicNumber: 14, temperature: 293,  charge: 0,  label: "Silica (SiO₂)", compound: "SiO2", meltPoint: 1986, boilPoint: 2503 },
};

/**
 * Resolve a substance string to { atomicNumber, temperature, charge, element }.
 * Accepts element symbols ("Fe"), compound keys ("H2O"), preset names ("fire"), or null.
 * @param {string|null} substance
 * @returns {{ atomicNumber: number, temperature: number, charge: number, element: Object|null, label: string }|null}
 */
export function resolveSubstance(substance) {
  if (!substance) return null;

  // Check presets first (includes legacy names + symbols + compounds)
  const preset = SUBSTANCE_PRESETS[substance];
  if (preset) {
    const element = getElement(preset.atomicNumber);
    const result = {
      atomicNumber: preset.atomicNumber,
      temperature: preset.temperature,
      charge: preset.charge,
      element,
      label: preset.label || substance,
    };
    // Compound presets override element melt/boil points
    if (preset.meltPoint != null) result.meltPoint = preset.meltPoint;
    if (preset.boilPoint != null) result.boilPoint = preset.boilPoint;
    return result;
  }

  // Try direct element symbol lookup
  const el = getElementBySymbol(substance);
  if (el) {
    return {
      atomicNumber: el.atomicNumber,
      temperature: 293,
      charge: el.defaultCharge,
      element: el,
      label: el.name,
    };
  }

  return null;
}

/**
 * Derive the state of matter from temperature and element melt/boil points.
 * @param {number} temperature - Kelvin
 * @param {Object|null} element - Element data from getElement()
 * @returns {{ state: string, phaseId: number }}
 */
export function deriveState(temperature, element) {
  if (!element) {
    // Fallback: use generic thresholds
    if (temperature >= 5000) return { state: "plasma", phaseId: 3 };
    if (temperature >= 373)  return { state: "gas",    phaseId: 2 };
    if (temperature >= 273)  return { state: "liquid",  phaseId: 1 };
    return { state: "solid", phaseId: 0 };
  }

  const melt = element.meltPoint || 273;
  const boil = element.boilPoint || 373;

  if (temperature >= boil * 8) return { state: "plasma", phaseId: 3 };
  if (temperature >= boil)     return { state: "gas",    phaseId: 2 };
  if (temperature >= melt)     return { state: "liquid",  phaseId: 1 };
  return { state: "solid", phaseId: 0 };
}

/**
 * Derive which physics systems an emitter needs based on substance + temperature.
 * Returns a physics profile object.
 * 
 * @param {string|null} substance - Substance key or null for legacy
 * @param {number} [temperatureOverride] - Override the preset temperature
 * @returns {Object} Physics profile
 */
export function derivePhysicsProfile(substance, temperatureOverride) {
  const resolved = resolveSubstance(substance);
  if (!resolved) {
    // Legacy mode — no substance-driven physics
    return {
      atomicNumber: 0,
      charge: 0,
      state: null,
      phaseId: -1,
      enableLJ: false,
      enableEM: false,
      enableSPH: false,
      enableNBody: false,
      enableChemistry: false,
      enableBlackbody: false,
      label: null,
    };
  }

  const temperature = temperatureOverride ?? resolved.temperature;
  // For compounds, use compound melt/boil points instead of the raw element's
  const elementForState = (resolved.meltPoint != null || resolved.boilPoint != null)
    ? { ...resolved.element, meltPoint: resolved.meltPoint ?? resolved.element?.meltPoint, boilPoint: resolved.boilPoint ?? resolved.element?.boilPoint }
    : resolved.element;
  const { state, phaseId } = deriveState(temperature, elementForState);
  const charge = resolved.charge;

  // Auto-enable physics based on state of matter
  let enableLJ = false;
  let enableEM = false;
  let enableSPH = false;
  let enableNBody = false;
  let enableChemistry = false;
  let enableBlackbody = false;

  switch (state) {
    case "solid":
      enableLJ = true;       // Strong inter-particle forces
      enableNBody = true;    // Gravitational clustering
      break;
    case "liquid":
      enableLJ = true;       // Cohesion
      enableSPH = true;      // Fluid dynamics
      enableChemistry = true; // Reactions in solution
      break;
    case "gas":
      enableLJ = true;       // Weak van der Waals
      break;
    case "plasma":
      enableEM = true;       // Electromagnetic forces
      enableBlackbody = true; // Temperature-based glow
      enableNBody = true;    // Gravitational confinement
      break;
  }

  // Charged particles always get EM
  if (Math.abs(charge) > 0.01) {
    enableEM = true;
  }

  // Very hot substances always get blackbody
  if (temperature >= 800) {
    enableBlackbody = true;
  }

  // Chemistry for compounds
  if (resolved.element && temperature > resolved.element.meltPoint * 0.8) {
    enableChemistry = true;
  }

  return {
    atomicNumber: resolved.atomicNumber,
    charge,
    state,
    phaseId,
    enableLJ,
    enableEM,
    enableSPH,
    enableNBody,
    enableChemistry,
    enableBlackbody,
    label: resolved.label,
  };
}

/**
 * ============================================================================
 * EMITTER TYPE PRESETS
 * ============================================================================
 * 
 * Each emitter type defines the visual and physical behavior of particles.
 * The emitter controls EVERYTHING about its particles:
 * 
 * VISUAL PROPERTIES:
 *   - shape: How the particle is rendered ("sphere", "point", "soft", "spark")
 *   - color: Starting RGB color [r, g, b] where each value is 0.0-1.0
 *   - colorEnd: Ending color for gradient over lifetime
 *   - pointSize: Size of the particle in world units
 *   - sizeOverLife: [start, middle, end] size multipliers over particle lifetime
 * 
 * TIMING PROPERTIES:
 *   - emitRate: Particles emitted per second
 *   - maxParticles: Maximum particles this emitter can have alive
 *   - lifetime: [min, max] seconds each particle lives
 *   - fadeOut: Whether particles fade out at end of life
 * 
 * PHYSICS PROPERTIES:
 *   - upSpeed: [min, max] initial vertical velocity (positive = up)
 *   - horizontalSpeed: Random horizontal spread velocity
 *   - gravity: Acceleration applied each frame (positive = down, negative = up)
 * 
 * SHAPE TYPES:
 *   - "sphere": 3D shaded ball with diffuse lighting
 *   - "point": Tiny bright dot, good for sparks/stars
 *   - "soft": Soft gaussian glow, good for smoke/fog
 *   - "spark": Star/cross shape, good for magic effects
 */
// =============================================================================
// ELEMENT DEFINITIONS - Base colors and behavior modifiers
// =============================================================================
export const ELEMENTS = {
  fire: {
    label: "Fire",
    color: [1.0, 0.6, 0.1],
    colorEnd: [0.8, 0.2, 0.0],
    // Behavior modifiers (applied additively)
    gravityMod: -2.0,      // Rises
    upSpeedMod: 1.5,       // Faster rise
    spreadMod: 0.5,        // Flickering
    materialIndex: 11,     // MATERIAL.FIRE (heat source, no phase transitions)
  },
  water: {
    label: "Water",
    color: [0.4, 0.7, 1.0],
    colorEnd: [0.2, 0.5, 0.9],
    gravityMod: 5.0,       // Falls
    upSpeedMod: -0.5,      // Less rise
    spreadMod: 0.3,        // Cohesive
    materialIndex: 1,      // MATERIAL.WATER (boil 373K, correct thermal LUT)
  },
  magic: {
    label: "Magic",
    color: [0.7, 0.2, 1.0],
    colorEnd: [0.3, 0.8, 1.0],
    gravityMod: -1.0,      // Floats
    upSpeedMod: 0.0,
    spreadMod: 1.0,        // Swirling
    materialIndex: 10,     // MATERIAL.PLASMA (no phase transitions)
  },
  smoke: {
    label: "Smoke",
    color: [0.5, 0.5, 0.55],
    colorEnd: [0.3, 0.3, 0.35],
    gravityMod: -0.5,      // Rises slowly
    upSpeedMod: 0.5,
    spreadMod: 0.8,        // Billowing
    materialIndex: 12,     // MATERIAL.SMOKE (low conductivity, no phase transitions)
  },
};

// =============================================================================
// STATE DEFINITIONS - 4 States of Matter (determines rendering)
// =============================================================================
// density: 0.0-1.0 - Controls overdraw handling for clustered particles
//   0.0 = sparse particles, full alpha each
//   1.0 = dense clusters, reduced alpha per particle but boosted intensity
export const STATES = {
  gas: {
    label: "Gas",
    renderMode: "gas",
    shape: "soft",
    phase: 2,      // 0=solid, 1=liquid, 2=gas, 3=plasma
    density: 0.7,  // Gas particles overlap a lot, reduce individual alpha
    // Base physics for gas
    emitRate: 30,
    maxParticles: 400,
    pointSize: 4.0,
    lifetime: [2.0, 5.0],
    upSpeed: [1.0, 3.0],
    horizontalSpeed: 0.5,
    gravity: -1.0,
    mass: 0.1,              // Very light - floats up
    drag: 0.05,             // High air resistance
    fadeOut: true,
    sizeOverLife: [0.5, 1.0, 1.5],
    alphaOverLife: [0.0, 0.8, 0.0],
    velocityOverLife: [1.0, 0.8, 0.3],
  },
  liquid: {
    label: "Liquid",
    renderMode: "liquid",
    shape: "sphere",
    phase: 1,      // 0=solid, 1=liquid, 2=gas, 3=plasma
    density: 0.5,  // Moderate density for liquid droplets
    emitRate: 80,
    maxParticles: 500,
    pointSize: 2.5,
    lifetime: [3.0, 6.0],
    upSpeed: [5.0, 10.0],
    horizontalSpeed: 0.8,
    gravity: -9.81,
    mass: 1.0,              // Normal mass - falls naturally
    drag: 0.01,             // Low air resistance
    fadeOut: true,
    sizeOverLife: [0.8, 1.0, 0.6],
    alphaOverLife: [0.2, 1.0, 0.8],
    velocityOverLife: [1.0, 1.0, 0.8],
  },
  solid: {
    label: "Solid",
    renderMode: "solid",
    shape: "sphere",
    phase: 0,      // 0=solid, 1=liquid, 2=gas, 3=plasma
    density: 0.2,  // Sparse, individual particles visible
    emitRate: 20,
    maxParticles: 200,
    pointSize: 1.5,
    lifetime: [5.0, 10.0],
    upSpeed: [2.0, 5.0],
    horizontalSpeed: 2.0,
    gravity: -15.0,
    mass: 2.0,              // Heavy - falls fast
    drag: 0.005,            // Very low air resistance
    fadeOut: false,
    sizeOverLife: [1.0, 1.0, 1.0],
    alphaOverLife: [1.0, 1.0, 1.0],
    velocityOverLife: [1.0, 0.9, 0.7],
  },
  plasma: {
    label: "Plasma",
    renderMode: "plasma",
    shape: "orb",
    phase: 3,      // 0=solid, 1=liquid, 2=gas, 3=plasma
    density: 0.6,  // Glowing plasma, moderate overlap
    emitRate: 40,
    maxParticles: 300,
    pointSize: 3.5,
    lifetime: [2.0, 4.0],
    upSpeed: [0.5, 2.0],
    horizontalSpeed: 1.5,
    gravity: -2.0,
    mass: 0.05,             // Very light - floats/hovers
    drag: 0.08,             // High drag for floaty feel
    fadeOut: true,
    sizeOverLife: [0.4, 1.0, 0.6],
    alphaOverLife: [0.0, 1.0, 0.0],
    velocityOverLife: [1.0, 0.6, 0.2],
  },
};

// =============================================================================
// EMITTER_TYPES - Backward compatible presets (map to state + elements)
// =============================================================================
export const EMITTER_TYPES = {
  // === GAS STATE ===
  gas: { ...STATES.gas, label: "Gas", elements: [{ id: "smoke", power: 1.0 }] },
  fire: { ...STATES.gas, label: "Fire", shape: "sphere", pointSize: 2.0, maxParticles: 150, emitRate: 20, density: 0.3, lifetime: [1.0, 3.0], elements: [{ id: "fire", power: 0.8 }, { id: "smoke", power: 0.3 }] },
  smoke: { ...STATES.gas, label: "Smoke", shape: "sphere", elements: [{ id: "smoke", power: 1.0 }], pointSize: 6.0, lifetime: [60.0, 180.0], density: 0.85 },
  
  // === LIQUID STATE ===
  liquid: { ...STATES.liquid, label: "Liquid", elements: [{ id: "water", power: 1.0 }] },
  fountain: { ...STATES.liquid, label: "Fountain", elements: [{ id: "water", power: 1.0 }], upSpeed: [10.0, 14.0] },
  water_blob: { ...STATES.liquid, label: "Water Blob", elements: [{ id: "water", power: 1.0 }], pointSize: 3.0 },
  
  // === SOLID STATE ===
  solid: { ...STATES.solid, label: "Solid", elements: [{ id: "water", power: 0.8 }] },
  snow: { ...STATES.solid, label: "Snow", elements: [{ id: "water", power: 0.6 }, { id: "magic", power: 0.2 }], 
    gravity: 1.5, pointSize: 1.5, lifetime: [60.0, 180.0], color: [0.98, 0.98, 1.0] },
  sparks: { ...STATES.solid, label: "Sparks", elements: [{ id: "fire", power: 1.0 }],
    shape: "spark", gravity: 12.0, emitRate: 80, pointSize: 1.2, fadeOut: false },
  
  // === PLASMA STATE ===
  plasma: { ...STATES.plasma, label: "Plasma", elements: [{ id: "magic", power: 0.6 }, { id: "fire", power: 0.4 }] },
  magic: { ...STATES.plasma, label: "Magic", elements: [{ id: "magic", power: 1.0 }], shape: "soft" },
  magic_orb: { ...STATES.plasma, label: "Magic Orb", elements: [{ id: "magic", power: 0.7 }, { id: "fire", power: 0.3 }] },
  explosion: { ...STATES.plasma, label: "Explosion", elements: [{ id: "fire", power: 0.9 }, { id: "smoke", power: 0.3 }],
    emitRate: 500, horizontalSpeed: 8.0, gravity: 6.0 },
};

/**
 * Derive color from element layers (weighted blend)
 */
export function deriveColorFromElements(elements) {
  if (!elements || elements.length === 0) {
    return { color: [1, 1, 1], colorEnd: [0.8, 0.8, 0.8] };
  }
  
  let totalPower = 0;
  const color = [0, 0, 0];
  const colorEnd = [0, 0, 0];
  
  for (const layer of elements) {
    const elem = ELEMENTS[layer.id];
    if (!elem || !layer.power) continue;
    
    const p = layer.power;
    totalPower += p;
    color[0] += elem.color[0] * p;
    color[1] += elem.color[1] * p;
    color[2] += elem.color[2] * p;
    colorEnd[0] += elem.colorEnd[0] * p;
    colorEnd[1] += elem.colorEnd[1] * p;
    colorEnd[2] += elem.colorEnd[2] * p;
  }
  
  if (totalPower > 0) {
    color[0] /= totalPower;
    color[1] /= totalPower;
    color[2] /= totalPower;
    colorEnd[0] /= totalPower;
    colorEnd[1] /= totalPower;
    colorEnd[2] /= totalPower;
  }
  
  return { color, colorEnd };
}

/**
 * Derive temperature from element layers (power-weighted average)
 * Used to sync thermal glow with element composition.
 */
const ELEMENT_TEMPS = { fire: 1200, water: 293, magic: 500, smoke: 400 };
export function deriveTemperatureFromElements(elements) {
  if (!elements || elements.length === 0) return 293;
  let totalWeight = 0;
  let totalTemp = 0;
  for (const e of elements) {
    if (!e.power) continue;
    const temp = ELEMENT_TEMPS[e.id] ?? 293;
    totalTemp += temp * e.power;
    totalWeight += e.power;
  }
  return totalWeight > 0 ? Math.round(totalTemp / totalWeight) : 293;
}

/**
 * Derive materialIndex from element layers (picks highest-power element's material)
 */
export function deriveMaterialIndexFromElements(elements) {
  if (!elements || elements.length === 0) return 0;
  let bestIdx = 0;
  let bestPower = -1;
  for (const layer of elements) {
    const elem = ELEMENTS[layer.id];
    if (!elem || !layer.power) continue;
    if (layer.power > bestPower && elem.materialIndex != null) {
      bestPower = layer.power;
      bestIdx = elem.materialIndex;
    }
  }
  return bestIdx;
}

/**
 * Get available states of matter
 */
export function getStates() {
  return Object.keys(STATES);
}

/**
 * Get available elements
 */
export function getElements() {
  return Object.keys(ELEMENTS);
}

// =============================================================================
// EMITTER_PRESETS — Unified presets combining visual type + substance chemistry
// =============================================================================
// Each preset: { substance, temperature, charge, emitterType, icon, label, category, overrides? }
// emitterType references a key in EMITTER_TYPES
// substance references a key in SUBSTANCE_PRESETS (or element symbol)
export const EMITTER_PRESETS = {
  // --- Fire & Heat ---
  fire:         { substance: "fire",  temperature: 1200, charge: 0,   emitterType: "fire",      icon: "🔥", label: "Fire",         category: "Fire & Heat" },
  lava:         { substance: "Si",    temperature: 1700, charge: 0,   emitterType: "liquid",    icon: "🌋", label: "Lava",         category: "Fire & Heat",
                  overrides: { gravity: 3.0, drag: 0.02, emitRate: 40, pointSize: 3.5, color: [1.0, 0.3, 0.0], colorEnd: [0.6, 0.1, 0.0] } },
  explosion:    { substance: "fire",  temperature: 2000, charge: 0,   emitterType: "explosion", icon: "💥", label: "Explosion",    category: "Fire & Heat" },
  sparks:       { substance: "Fe",    temperature: 1800, charge: 0,   emitterType: "sparks",    icon: "✨", label: "Sparks",       category: "Fire & Heat" },
  candle:       { substance: "fire",  temperature: 900,  charge: 0,   emitterType: "fire",      icon: "🕯️", label: "Candle",       category: "Fire & Heat",
                  overrides: { emitRate: 12, pointSize: 2.0, upSpeed: [0.5, 1.5], horizontalSpeed: 0.2 } },

  // --- Water & Ice ---
  water:        { substance: "H2O",   temperature: 293,  charge: 0,   emitterType: "fountain",  icon: "💧", label: "Water",        category: "Water & Ice" },
  fountain:     { substance: "H2O",   temperature: 293,  charge: 0,   emitterType: "fountain",  icon: "⛲", label: "Fountain",     category: "Water & Ice",
                  overrides: { upSpeed: [12.0, 16.0], emitRate: 120 } },
  snow:         { substance: "H2O",   temperature: 250,  charge: 0,   emitterType: "snow",      icon: "❄️", label: "Snow",         category: "Water & Ice" },
  steam:        { substance: "H2O",   temperature: 400,  charge: 0,   emitterType: "gas",       icon: "☁️", label: "Steam",        category: "Water & Ice",
                  overrides: { color: [0.9, 0.9, 0.95], colorEnd: [0.7, 0.7, 0.8], pointSize: 5.0 } },

  // --- Gas & Smoke ---
  smoke:        { substance: "smoke", temperature: 400,  charge: 0,   emitterType: "smoke",     icon: "💨", label: "Smoke",        category: "Gas & Smoke" },
  bubbles:      { substance: "O",     temperature: 293,  charge: 0,   emitterType: "gas",       icon: "🫧", label: "Bubbles",      category: "Gas & Smoke",
                  overrides: { gravity: -0.3, emitRate: 15, pointSize: 2.0, color: [0.7, 0.9, 1.0], colorEnd: [0.5, 0.8, 1.0] } },
  toxic_gas:    { substance: "N",     temperature: 293,  charge: 0,   emitterType: "gas",       icon: "☣️", label: "Toxic Gas",    category: "Gas & Smoke",
                  overrides: { color: [0.2, 0.8, 0.1], colorEnd: [0.1, 0.5, 0.0], pointSize: 5.0 } },

  // --- Plasma & Energy ---
  plasma:       { substance: "magic", temperature: 8000, charge: 2,   emitterType: "plasma",    icon: "⚡", label: "Plasma",       category: "Plasma & Energy" },
  magic:        { substance: "magic", temperature: 8000, charge: 2,   emitterType: "magic",     icon: "🔮", label: "Magic",        category: "Plasma & Energy" },
  starfire:     { substance: "He",    temperature: 15000,charge: 0,   emitterType: "plasma",    icon: "⭐", label: "Starfire",     category: "Plasma & Energy",
                  overrides: { color: [1.0, 0.95, 0.8], colorEnd: [0.4, 0.6, 1.0], emitRate: 60, pointSize: 4.0 } },

  // --- Metal & Earth ---
  debris:       { substance: "Si",    temperature: 293,  charge: 0,   emitterType: "solid",     icon: "🪨", label: "Debris",       category: "Metal & Earth" },
  molten_gold:  { substance: "Au",    temperature: 1337, charge: 0,   emitterType: "liquid",    icon: "🥇", label: "Molten Gold",  category: "Metal & Earth",
                  overrides: { color: [1.0, 0.84, 0.0], colorEnd: [0.85, 0.65, 0.0], pointSize: 2.5, drag: 0.01 } },
  metal_sparks: { substance: "Fe",    temperature: 1000, charge: 0,   emitterType: "sparks",    icon: "⚙️", label: "Metal Sparks", category: "Metal & Earth",
                  overrides: { color: [1.0, 0.7, 0.3], colorEnd: [0.6, 0.3, 0.1] } },
  salt:         { substance: "NaCl",  temperature: 293,  charge: 0,   emitterType: "solid",     icon: "🧂", label: "Salt",         category: "Metal & Earth",
                  overrides: { color: [0.95, 0.95, 0.92], colorEnd: [0.85, 0.85, 0.82], pointSize: 1.2 } },

  // --- Custom (no substance, legacy mode) ---
  custom:       { substance: null,    temperature: 293,  charge: 0,   emitterType: "smoke",     icon: "🎛️", label: "Custom",       category: "Custom" },
};

/**
 * Get all presets grouped by category for UI consumption.
 * @returns {Array<{ category: string, presets: Array<{ key: string, icon: string, label: string }> }>}
 */
export function getPresetList() {
  const groups = {};
  for (const [key, preset] of Object.entries(EMITTER_PRESETS)) {
    const cat = preset.category || "Other";
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push({ key, icon: preset.icon, label: preset.label });
  }
  return Object.entries(groups).map(([category, presets]) => ({ category, presets }));
}

/**
 * Apply a preset to an emitter config object, mutating it in place.
 * Sets substance, temperature, charge, emitter type, elements, and physics.
 * 
 * @param {Object} emitterCfg - Emitter config to mutate
 * @param {string} presetKey - Key from EMITTER_PRESETS
 * @returns {boolean} True if preset was applied
 */
export function applyPreset(emitterCfg, presetKey) {
  const preset = EMITTER_PRESETS[presetKey];
  if (!preset) return false;

  const typePreset = EMITTER_TYPES[preset.emitterType];
  if (!typePreset) return false;

  // Resolve substance registry defaults (lowest priority base layer)
  const subDef = resolveSubstanceDefaults(preset.substance) || {};

  // Apply substance / matter fields
  emitterCfg.substance = preset.substance;
  emitterCfg.temperature = preset.temperature ?? subDef.temperature ?? 293;
  emitterCfg.charge = preset.charge;

  // Apply visual type fields from EMITTER_TYPES
  emitterCfg.type = preset.emitterType;
  emitterCfg.state = typePreset.renderMode || "gas";
  if (typePreset.shape) emitterCfg.shape = typePreset.shape;
  if (typePreset.elements) {
    emitterCfg.elements = typePreset.elements.map(e => ({ ...e, enabled: true }));
  }

  // Apply physics from EMITTER_TYPES, falling back to substance registry data
  emitterCfg.emitRate = typePreset.emitRate ?? subDef.emitRate ?? emitterCfg.emitRate;
  emitterCfg.pointSize = typePreset.pointSize ?? subDef.pointSize ?? emitterCfg.pointSize;
  if (typePreset.lifetime != null) {
    emitterCfg.lifetimeMin = typePreset.lifetime[0];
    emitterCfg.lifetimeMax = typePreset.lifetime[1];
  } else if (subDef.lifetime) {
    emitterCfg.lifetimeMin = subDef.lifetime[0];
    emitterCfg.lifetimeMax = subDef.lifetime[1];
  }
  if (typePreset.upSpeed != null) {
    emitterCfg.riseMin = typePreset.upSpeed[0];
    emitterCfg.riseMax = typePreset.upSpeed[1];
  } else if (subDef.upSpeed) {
    emitterCfg.riseMin = subDef.upSpeed[0];
    emitterCfg.riseMax = subDef.upSpeed[1];
  }
  emitterCfg.horizontalSpeed = typePreset.horizontalSpeed ?? subDef.horizontalSpeed ?? emitterCfg.horizontalSpeed;
  emitterCfg.gravity = typePreset.gravity ?? subDef.gravity ?? emitterCfg.gravity;
  emitterCfg.mass = typePreset.mass ?? subDef.mass ?? emitterCfg.mass;
  emitterCfg.drag = typePreset.drag ?? subDef.drag ?? emitterCfg.drag;

  // SPH from substance registry
  if (subDef.sphRestDensity != null) emitterCfg.sphRestDensity = subDef.sphRestDensity;
  if (subDef.sphViscosity != null)   emitterCfg.sphViscosity = subDef.sphViscosity;
  if (subDef.restDensity != null)    emitterCfg.restDensity = subDef.restDensity;

  // Apply per-preset overrides (color, speed tweaks, etc.) — highest priority
  if (preset.overrides) {
    for (const [k, v] of Object.entries(preset.overrides)) {
      if (k === "upSpeed" && Array.isArray(v)) {
        emitterCfg.riseMin = v[0];
        emitterCfg.riseMax = v[1];
      } else {
        emitterCfg[k] = v;
      }
    }
  }

  // Derive colors and materialIndex from elements, falling back to substance visual data
  if (emitterCfg.elements) {
    const activeEls = emitterCfg.elements.filter(e => e.enabled && e.power > 0);
    if (!preset.overrides?.color) {
      if (activeEls.length > 0) {
        const derived = deriveColorFromElements(activeEls);
        emitterCfg.color = derived.color;
        emitterCfg.colorEnd = derived.colorEnd;
      } else if (subDef.color) {
        emitterCfg.color = subDef.color;
        emitterCfg.colorEnd = subDef.colorEnd || subDef.color;
      }
    }
    emitterCfg.materialIndex = subDef.materialIndex ?? deriveMaterialIndexFromElements(activeEls);
  } else if (subDef.materialIndex != null) {
    emitterCfg.materialIndex = subDef.materialIndex;
  }

  // Derive physics profile from substance + temperature so badges and sim systems are correct
  const profile = derivePhysicsProfile(preset.substance, emitterCfg.temperature);
  emitterCfg.physicsProfile = profile;
  if (profile && profile.state) {
    emitterCfg.state = profile.state;
    emitterCfg.phase = profile.phaseId ?? 2;
  }

  // Store which preset is active
  emitterCfg._activePreset = presetKey;

  return true;
}

const EFFECT_PRESETS = {
  fire: [
    { type: "fire" },
  ],
  smoke: [
    { type: "smoke" },
  ],
  sparks: [
    { type: "sparks" },
  ],
  fountain: [
    { type: "fountain" },
  ],
  magic: [
    { type: "magic" },
  ],
  snow: [
    { type: "snow" },
  ],
  explosion: [
    { type: "explosion" },
  ],
  fire_spark: [
    { type: "fire" },
    {
      type: "sparks",
      shape: "spark",
      emitRateScale: 0.7,
      lifetimeScale: 0.5,
    },
  ],
  magic_water_sparks: [
    {
      type: "magic",
      shape: "orb",
    },
    {
      type: "fountain",
      emitRateScale: 0.3,
      lifetimeScale: 0.5,
    },
    {
      type: "sparks",
      shape: "lightning",
      lifetimeScale: 0.5,
    },
  ],
};

function buildAutoEffectLayers(effectId) {
  if (!effectId || typeof effectId !== "string") return null;
  const id = effectId.toLowerCase();
  const parts = id.split(/[_\-\+]+/);
  const tokens = parts.filter((t) => t && t.length > 0);
  if (tokens.length === 0) return null;

  let baseType = null;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (EMITTER_TYPES[t]) {
      baseType = t;
      break;
    }
  }

  if (!baseType) {
    if (tokens.includes("water") && EMITTER_TYPES.fountain) {
      baseType = "fountain";
    } else if (tokens.includes("magic") && EMITTER_TYPES.magic) {
      baseType = "magic";
    } else if (tokens.includes("fire") && EMITTER_TYPES.fire) {
      baseType = "fire";
    } else if (tokens.includes("snow") && EMITTER_TYPES.snow) {
      baseType = "snow";
    }
  }

  if (!baseType) return null;

  const layers = [];
  const baseLayer = { type: baseType };
  if (baseType === "magic" && tokens.includes("orb")) {
    baseLayer.shape = "orb";
  }
  layers.push(baseLayer);

  function hasToken(tag) {
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i] === tag) return true;
    }
    return false;
  }

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token || token === baseType) continue;

    if (token === "smoke") {
      layers.push({
        type: "smoke",
        shape: "soft",
        emitRateScale: 0.4,
        lifetimeScale: 1.5,
        pointSizeScale: 1.5,
      });
    } else if (token === "sparks" || token === "spark") {
      layers.push({
        type: "sparks",
        shape: hasToken("lightning") ? "lightning" : "spark",
        emitRateScale: 0.5,
        lifetimeScale: 0.6,
      });
    } else if (token === "water") {
      layers.push({
        type: "fountain",
        emitRateScale: 0.4,
        lifetimeScale: 1.0,
      });
    } else if (token === "halo") {
      layers.push({
        type: baseType === "magic" ? "magic" : baseType,
        shape: "halo",
        emitRateScale: 0.3,
        lifetimeScale: 1.2,
        pointSizeScale: 1.3,
      });
    } else if (token === "orb") {
      layers.push({
        type: baseType === "magic" ? "magic" : baseType,
        shape: "orb",
        emitRateScale: 0.2,
        lifetimeScale: 1.1,
      });
    } else if (token === "ring") {
      layers.push({
        type: "magic",
        shape: "ring",
        emitRateScale: 0.25,
        lifetimeScale: 1.0,
      });
    } else if (token === "hex") {
      layers.push({
        type: "magic",
        shape: "hex",
        emitRateScale: 0.35,
        lifetimeScale: 1.0,
      });
    } else if (token === "mist") {
      layers.push({
        type: "smoke",
        shape: "mist",
        emitRateScale: 0.2,
        lifetimeScale: 1.5,
      });
    } else if (token === "lightning") {
      if (!hasToken("sparks") && !hasToken("spark")) {
        layers.push({
          type: "sparks",
          shape: "lightning",
          emitRateScale: 0.4,
          lifetimeScale: 0.5,
        });
      }
    }
  }

  if (layers.length === 0) return null;
  return layers;
}

/**
 * Get available emitter type IDs.
 */
export function getEmitterTypes() {
  return Object.keys(EMITTER_TYPES);
}

/**
 * Get emitter type preset by ID.
 */
export function getEmitterPreset(typeId) {
  return EMITTER_TYPES[typeId] || EMITTER_TYPES.fire;
}

function getEmitterElement(typeId) {
  switch (typeId) {
    case "fire":
    case "explosion":
      return "fire";
    case "sparks":
      return "fire";
    case "smoke":
      return "smoke";
    case "fountain":
    case "snow":
      return "water";
    case "magic":
      return "magic";
    default:
      return "generic";
  }
}

function applyEffectPowerToEmitter(emitter, options) {
  if (!emitter || !options) return;

  let basePower = 1.0;
  if (typeof options.power === "number" && Number.isFinite(options.power)) {
    const raw = Math.max(0.0, options.power);
    // Map raw power (0..1000+) into a stable visual range using a logarithmic scale.
    // 0   -> 1.0 (no change)
    // 1   -> ~2.0
    // 10  -> ~4.5
    // 100 -> ~7.7
    // 1000-> ~11.0
    basePower = 1.0 + Math.log2(1.0 + raw);
  }

  let elementScale = 1.0;
  const elementPower = options.elementPower;
  if (elementPower && typeof elementPower === "object") {
    const elemId = getEmitterElement(emitter.type);
    if (elemId && Object.prototype.hasOwnProperty.call(elementPower, elemId)) {
      const v = Number(elementPower[elemId]);
      if (Number.isFinite(v)) {
        elementScale = Math.max(0.0, v);
      }
    }
  }

  let lifetimeScale = 1.0;
  if (
    typeof options.lifetimeScale === "number" &&
    Number.isFinite(options.lifetimeScale)
  ) {
    lifetimeScale = Math.max(0.1, options.lifetimeScale);
  }

  const sizeScale = 0.5 + basePower * 0.5;
  const densityScale = elementScale;

  if (Number.isFinite(emitter.pointSize)) {
    emitter.pointSize = emitter.pointSize * sizeScale;
  }
  if (Number.isFinite(emitter.emitRate)) {
    emitter.emitRate = emitter.emitRate * densityScale;
  }
  if (
    Array.isArray(emitter.lifetime) &&
    emitter.lifetime.length === 2 &&
    lifetimeScale !== 1.0
  ) {
    emitter.lifetime = [
      emitter.lifetime[0] * lifetimeScale,
      emitter.lifetime[1] * lifetimeScale,
    ];
  }
}

export function normalizeElementPower(elementPower) {
  if (!elementPower || typeof elementPower !== "object") {
    return {};
  }
  const result = {};
  let maxVal = 0;
  for (const key in elementPower) {
    if (!Object.prototype.hasOwnProperty.call(elementPower, key)) continue;
    const v = Number(elementPower[key]);
    if (!Number.isFinite(v)) continue;
    if (v <= 0) continue;
    if (v > maxVal) {
      maxVal = v;
    }
  }
  if (maxVal <= 0) {
    return {};
  }
  for (const key in elementPower) {
    if (!Object.prototype.hasOwnProperty.call(elementPower, key)) continue;
    const v = Number(elementPower[key]);
    if (!Number.isFinite(v)) continue;
    if (v <= 0) continue;
    result[key] = v / maxVal;
  }
  return result;
}

export function mixElementPower(a, b, options = {}) {
  const mode = options && typeof options.mode === "string" ? options.mode : "add";
  const out = {};
  const keys = new Set();
  if (a && typeof a === "object") {
    for (const k in a) {
      if (Object.prototype.hasOwnProperty.call(a, k)) keys.add(k);
    }
  }
  if (b && typeof b === "object") {
    for (const k in b) {
      if (Object.prototype.hasOwnProperty.call(b, k)) keys.add(k);
    }
  }
  keys.forEach((k) => {
    const av = a && Number(a[k]);
    const bv = b && Number(b[k]);
    const va = Number.isFinite(av) ? Math.max(0, av) : 0;
    const vb = Number.isFinite(bv) ? Math.max(0, bv) : 0;
    let v = 0;
    if (mode === "average") {
      v = (va + vb) * 0.5;
    } else {
      v = va + vb;
    }
    if (v > 0) {
      out[k] = v;
    }
  });
  return out;
}

export function buildEffectKeyFromElements(elementPower, options = {}) {
  const normalized = normalizeElementPower(elementPower);
  const entries = [];
  for (const key in normalized) {
    if (!Object.prototype.hasOwnProperty.call(normalized, key)) continue;
    const v = normalized[key];
    if (v > 0) {
      entries.push([key, v]);
    }
  }
  const defaultBase =
    options && typeof options.defaultBase === "string" && options.defaultBase
      ? options.defaultBase
      : "fire";
  if (entries.length === 0) {
    return defaultBase;
  }
  entries.sort((a, b) => b[1] - a[1]);
  const primaryKey = entries[0][0];
  let base = defaultBase;
  if (primaryKey === "fire") {
    base = "fire";
  } else if (primaryKey === "magic") {
    base = "magic";
  } else if (primaryKey === "water") {
    base = "fountain";
  } else if (primaryKey === "smoke") {
    base = "smoke";
  }

  const fireVal = normalized.fire || 0;
  const magicVal = normalized.magic || 0;
  const waterVal = normalized.water || 0;
  const smokeVal = normalized.smoke || 0;

  const tags = [];
  if (smokeVal > 0.2 && base !== "smoke") {
    tags.push("smoke");
  }
  if (waterVal > 0.3 && base !== "fountain") {
    tags.push("water");
  }
  if (fireVal > 0.4 && magicVal > 0.3) {
    tags.push("lightning");
  } else if (fireVal > 0.4) {
    tags.push("sparks");
  }
  if (magicVal > 0.4 && base !== "magic") {
    tags.push("halo");
  }

  const parts = [base];
  for (let i = 0; i < tags.length; i++) {
    if (parts.indexOf(tags[i]) === -1) {
      parts.push(tags[i]);
    }
  }
  return parts.join("_");
}

export function computeVisualPower(elementPower, options = {}) {
  let total = 0;
  if (elementPower && typeof elementPower === "object") {
    for (const key in elementPower) {
      if (!Object.prototype.hasOwnProperty.call(elementPower, key)) continue;
      const v = Number(elementPower[key]);
      if (!Number.isFinite(v)) continue;
      if (v > 0) {
        total += v;
      }
    }
  }
  const baseMin =
    options && typeof options.minPower === "number" && Number.isFinite(options.minPower)
      ? options.minPower
      : 0.5;
  const baseMax =
    options && typeof options.maxPower === "number" && Number.isFinite(options.maxPower)
      ? options.maxPower
      : 3.0;
  const scale =
    options && typeof options.powerScale === "number" && Number.isFinite(options.powerScale)
      ? options.powerScale
      : 0.5;
  const baseOffset =
    options && typeof options.powerOffset === "number" && Number.isFinite(options.powerOffset)
      ? options.powerOffset
      : 0.5;
  let powerFromElements = baseOffset + total * scale;
  if (powerFromElements < baseMin) powerFromElements = baseMin;
  if (powerFromElements > baseMax) powerFromElements = baseMax;
  const normalized = normalizeElementPower(elementPower);
  let lfScale = 1.0;
  const fireN = normalized.fire || 0;
  const magicN = normalized.magic || 0;
  const waterN = normalized.water || 0;
  const smokeN = normalized.smoke || 0;
  lfScale = 1.0 + (waterN + smokeN) * 0.5 - (fireN + magicN) * 0.4;
  const rawPowerVal =
    options && typeof options.rawPower === "number" && Number.isFinite(options.rawPower)
      ? Math.max(0.0, options.rawPower)
      : null;
  if (rawPowerVal !== null) {
    const denom =
      options && typeof options.powerLifetimeDenom === "number" && Number.isFinite(options.powerLifetimeDenom)
        ? Math.max(1.0, options.powerLifetimeDenom)
        : 400.0;
    const powerFactor = 1.0 / (1.0 + rawPowerVal / denom);
    lfScale *= powerFactor;
  }
  if (lfScale < 0.1) lfScale = 0.1;
  if (lfScale > 3.0) lfScale = 3.0;
  const powerOut = rawPowerVal !== null ? rawPowerVal : powerFromElements;
  return { power: powerOut, elementPower: normalized, lifetimeScale: lfScale };
}

function normalizeDirectionVec(input) {
  if (!Array.isArray(input) || input.length < 3) {
    return null;
  }
  let x = Number(input[0]);
  let y = Number(input[1]);
  let z = Number(input[2]);
  if (!Number.isFinite(x)) x = 0;
  if (!Number.isFinite(y)) y = 0;
  if (!Number.isFinite(z)) z = 0;
  const lenSq = x * x + y * y + z * z;
  if (!(lenSq > 1e-8)) {
    return null;
  }
  const invLen = 1 / Math.sqrt(lenSq);
  return [x * invLen, y * invLen, z * invLen];
}

export function createEmittersForEffect(effectId, options = {}) {
  let layers = EFFECT_PRESETS[effectId];
  if ((!layers || layers.length === 0) && typeof effectId === "string") {
    const autoLayers = buildAutoEffectLayers(effectId);
    if (autoLayers && autoLayers.length > 0) {
      layers = autoLayers;
    }
  }
  const basePos = Array.isArray(options.position) && options.position.length >= 3
    ? options.position
    : [0, 0, 0];
  const markerEntityId = options.markerEntityId ?? null;
  const elementPower = options && typeof options.elementPower === "object"
    ? normalizeElementPower(options.elementPower)
    : null;
  const direction = normalizeDirectionVec(options.direction);

  if (!layers || layers.length === 0) {
    const single = createEmitter({
      type: effectId,
      position: basePos,
      markerEntityId,
      emitRate: options.emitRate,
      pointSize: options.pointSize,
      color: options.color,
      continuous: options.continuous,
      elementPower,
      direction,
    });
    applyEffectPowerToEmitter(single, options);
    return [single];
  }

  const emitters = [];
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i] || {};
    const emitter = createEmitter({
      type: layer.type,
      position: basePos,
      markerEntityId,
      emitRate: layer.emitRate ?? options.emitRate,
      pointSize: layer.pointSize ?? options.pointSize,
      color: layer.color || options.color,
      continuous: options.continuous,
      elementPower,
      direction,
    });

    if (typeof layer.shape === "string") {
      emitter.shape = layer.shape;
    }
    if (Array.isArray(layer.lifetime) && layer.lifetime.length === 2) {
      emitter.lifetime = [layer.lifetime[0], layer.lifetime[1]];
    } else if (typeof layer.lifetimeScale === "number" && emitter.lifetime) {
      const k = layer.lifetimeScale;
      const src = emitter.lifetime;
      emitter.lifetime = [src[0] * k, src[1] * k];
    }
    if (typeof layer.emitRateScale === "number" && Number.isFinite(emitter.emitRate)) {
      emitter.emitRate = emitter.emitRate * layer.emitRateScale;
    }
    if (typeof layer.pointSizeScale === "number" && Number.isFinite(emitter.pointSize)) {
      emitter.pointSize = emitter.pointSize * layer.pointSizeScale;
    }
    if (typeof layer.upSpeedScale === "number" && Array.isArray(emitter.upSpeed) && emitter.upSpeed.length === 2) {
      const s = layer.upSpeedScale;
      emitter.upSpeed = [emitter.upSpeed[0] * s, emitter.upSpeed[1] * s];
    }

    applyEffectPowerToEmitter(emitter, options);

    emitters.push(emitter);
  }

  return emitters;
}

/**
 * ============================================================================
 * CREATE PARTICLE EMITTER
 * ============================================================================
 * 
 * Creates an emitter instance from a preset type. The emitter controls all
 * aspects of its particles: visual appearance, physics, and timing.
 * 
 * @param {Object} options - Emitter configuration
 * @param {string} options.type - Preset type ID: "fire", "smoke", "sparks", 
 *                                "fountain", "magic", "snow", "explosion"
 * @param {Array<number>} options.position - [x, y, z] spawn position in world space
 * @param {Array<number>} options.color - Override preset color [r, g, b] (0-1 each)
 * @param {number} options.pointSize - Override preset particle size
 * @param {number} options.emitRate - Override preset emission rate (particles/sec)
 * @param {boolean} options.continuous - If true, emitter runs forever (default: true)
 *                                       If false, emitter dies after maxParticles
 * 
 * @returns {Object} Emitter instance with all properties needed for simulation
 * 
 * EXAMPLE USAGE:
 *   const fireEmitter = createEmitter({
 *     type: "fire",
 *     position: [0, 1, 0],
 *     continuous: true,
 *   });
 */
export function createEmitter(options = {}) {
  // Get preset configuration for this emitter type
  const typeId = options.type || "fire";
  const preset = getEmitterPreset(typeId);
  
  // Resolve substance registry defaults (lowest priority base layer)
  const subDef = resolveSubstanceDefaults(options.substance) || {};
  
  // Resolve lifetime range from options or preset
  const lifetimeRange = options.lifetime ?? preset.lifetime ?? subDef.lifetime ?? [1.0, 2.0];
  
  // Continuous emitters never run out (default behavior)
  const continuous = options.continuous !== false;
  
  // Resolve elements: prefer saved options, fallback to preset type
  const emitterElements = options.elements
    ? options.elements.map(e => ({ ...e, enabled: e.enabled !== false }))
    : (preset.elements ? preset.elements.map(e => ({ ...e, enabled: e.enabled !== false })) : null);
  const activeElements = emitterElements ? emitterElements.filter(e => e.enabled && e.power > 0) : [];

  // Derive colors and temperature from active elements, falling back to substance data
  const derivedColors = activeElements.length > 0
    ? deriveColorFromElements(activeElements)
    : { color: subDef.color || [1, 1, 1], colorEnd: subDef.colorEnd || [0.8, 0.8, 0.8] };
  const derivedTemp = activeElements.length > 0
    ? deriveTemperatureFromElements(activeElements)
    : (options.temperature ?? preset.temperature ?? subDef.temperature ?? 293);
  
  return {
    // === IDENTITY ===
    type: typeId,                                    // Preset type ID
    shape: options.shape || preset.shape || "sphere",                 // Render shape (CRITICAL for visuals)
    renderMode: options.renderMode || preset.renderMode || "gas",          // State of matter: "gas", "liquid", "solid", "plasma"
    position: options.position || [0, 0, 0],         // World spawn position
    markerEntityId: options.markerEntityId ?? null,  // Optional ECS entity id for visual marker
    elements: emitterElements,
    direction: normalizeDirectionVec(options.direction),
    
    // === COLORS (derived from elements unless _colorOverride is set) ===
    color: [...(options._colorOverride ? (options.color || derivedColors.color) : derivedColors.color)],
    colorEnd: [...(options._colorOverride ? (options.colorEnd || derivedColors.colorEnd) : derivedColors.colorEnd)],
    
    // === SIZING ===
    pointSize: options.pointSize ?? preset.pointSize ?? subDef.pointSize ?? 4.0,  // Particle size in world units
    
    // === TIMING ===
    lifetime: lifetimeRange,                         // [min, max] seconds per particle
    emitRate: options.emitRate ?? preset.emitRate ?? subDef.emitRate ?? 30,   // Particles per second
    continuous,                                      // Runs forever?
    remaining: continuous ? Infinity : (options.maxParticles ?? preset.maxParticles ?? subDef.maxParticles ?? 200),
    
    // === PHYSICS ===
    upSpeed: options.upSpeed ?? preset.upSpeed ?? subDef.upSpeed ?? [1.0, 2.0],
    horizontalSpeed: options.horizontalSpeed ?? preset.horizontalSpeed ?? subDef.horizontalSpeed ?? 0.5,
    gravity: options.gravity ?? preset.gravity ?? subDef.gravity ?? 0.0,
    mass: options.mass ?? preset.mass ?? subDef.mass ?? 1.0,        // Particle mass (affects gravity, collisions)
    drag: options.drag ?? preset.drag ?? subDef.drag ?? 0.02,       // Air resistance (0 = none, 1 = max)
    bounciness: options.bounciness ?? preset.bounciness ?? 0.3,
    collisionEnabled: options.collisionEnabled ?? preset.collisionEnabled ?? true,
    inheritVelocity: options.inheritVelocity ?? preset.inheritVelocity ?? 0.0,
    
    // === INTERPOLATION CURVES (t = 0 to 1 over lifetime) ===
    // Each array is [start, middle, end] values, interpolated smoothly
    sizeOverLife: [...(options.sizeOverLife ?? preset.sizeOverLife ?? subDef.sizeOverLife ?? [1.0, 1.0, 1.0])],
    alphaOverLife: [...(options.alphaOverLife ?? preset.alphaOverLife ?? subDef.alphaOverLife ?? [0.0, 1.0, 0.0])],  // Fade in/out
    velocityOverLife: [...(options.velocityOverLife ?? preset.velocityOverLife ?? subDef.velocityOverLife ?? [1.0, 1.0, 0.5])],  // Speed decay
    
    // === THERMAL (derived from elements to match visual composition) ===
    temperature: derivedTemp,    // Kelvin (293 = room temp)
    phase: options.phase ?? preset.phase ?? 0,                       // 0=solid, 1=liquid, 2=gas, 3=plasma
    collisionGroup: options.collisionGroup ?? preset.collisionGroup ?? 0, // 0=collides with all
    materialIndex: options.materialIndex ?? preset.materialIndex ?? subDef.materialIndex ?? (getMaterialForSubstance(options.substance) || deriveMaterialIndexFromElements(preset.elements)),
    restDensity: options.restDensity ?? preset.restDensity ?? subDef.restDensity ?? 0,     // 0=not fluid
    
    // Spawn shape (Niagara parity: sphere, box, cylinder, cone, ring, torus, line, disc, grid)
    spawnShape: options.spawnShape ?? preset.spawnShape ?? null,
    
    // Rotation (per-particle billboard rotation)
    initialRotation: options.initialRotation ?? preset.initialRotation ?? [0, Math.PI * 2], // [min, max] radians
    rotationRate: options.rotationRate ?? preset.rotationRate ?? 0, // radians/sec (passed to renderer)
    
    // Effects
    fadeOut: preset.fadeOut ?? true,
    // State
    accumulator: 0,
    // Optional element power metadata (used by fluid coupling and effects)
    elementPower: options.elementPower && typeof options.elementPower === "object"
      ? normalizeElementPower(options.elementPower)
      : null,
    
    // === CONVERGENCE MODE ===
    // When true, particles are spawned with velocity aimed at the emitter origin,
    // calibrated so they arrive exactly when they die (implosion/vortex effect).
    attractToCenter: options.attractToCenter ?? preset.attractToCenter ?? false,
    
    // === SUBSTANCE (GAP 33-44 integration) ===
    substance: options.substance ?? null,
    substanceCharge: options.charge ?? 0,
    sphRestDensity: options.sphRestDensity ?? subDef.sphRestDensity ?? 1000,
    sphViscosity: options.sphViscosity ?? subDef.sphViscosity ?? 0.1,
    physicsProfile: derivePhysicsProfile(
      options.substance ?? null,
      derivedTemp
    ),
  };
}

/**
 * Step all emitters and emit particles into the particle world.
 * Returns the number of new particles emitted.
 */
export function stepEmitters(emitters, particleWorld, dt, options = {}) {
  if (!emitters || emitters.length === 0) return 0;
  if (!particleWorld || !particleWorld.positionBuffer) return 0;

  // Clamp delta to prevent massive spawn bursts when resuming from background
  // Max 100ms worth of emission per frame (prevents lag spikes)
  const clampedDt = Math.min(dt, 0.1);

  const positions = options.positions;
  const velocities = options.velocities;
  const meta = options.meta;              // Float32Array: [r,g,b,packed] per particle (for snapshots)
  const maxParticles = options.maxParticles || 0;
  const currentCount = options.currentCount || 0;
  const logger = options.logger || null;
  const currentTime = options.currentTime || performance.now() * 0.001;
  
  // Quality-based emission throttling (0.0-1.0)
  // At quality 0.5, only emit 50% of particles
  const quality = typeof options.quality === "number" ? Math.max(0, Math.min(1, options.quality)) : 1.0;
  const lodForEmitter = typeof options.lodForEmitter === "function" ? options.lodForEmitter : null;
  let remainingEmissionBudget = Number.isFinite(options.emissionBudget)
    ? Math.max(0, Math.floor(options.emissionBudget))
    : Infinity;
  
  // Slot tracking for dead particle reuse
  const slotInfo = options.slotInfo;      // Float32Array: [spawnTime, lifetime] per slot
  const freeSlots = options.freeSlots;    // Array of dead slot indices to reuse

  if (!positions || !velocities || maxParticles <= 0) return 0;

  let emittedTotal = 0;
  let appendIndex = currentCount;  // Where to append if no free slots

  // Iterate from end so we can safely splice finished emitters
  for (let ei = emitters.length - 1; ei >= 0; ei--) {
    const emit = emitters[ei];
    if (!emit) {
      emitters.splice(ei, 1);
      continue;
    }
    
    // Only remove non-continuous emitters when exhausted
    if (!emit.continuous && emit.remaining <= 0) {
      emitters.splice(ei, 1);
      continue;
    }

    // Runtime LOD is deliberately external to the authored emitter. This lets
    // editors and hosts reduce cost without mutating recipe/ECS properties.
    const lod = lodForEmitter ? lodForEmitter(emit) : null;
    const spawnRateScale = Number.isFinite(lod?.spawnRateScale)
      ? Math.max(0, Math.min(1, lod.spawnRateScale))
      : 1.0;
    const lifetimeScale = Number.isFinite(lod?.lifetimeScale)
      ? Math.max(0.05, lod.lifetimeScale)
      : 1.0;
    const sizeScale = Number.isFinite(lod?.sizeScale)
      ? Math.max(0.05, lod.sizeScale)
      : 1.0;

    emit.accumulator += clampedDt * emit.emitRate * spawnRateScale;
    let toEmit = Math.floor(emit.accumulator);
    if (toEmit <= 0) continue;

    emit.accumulator -= toEmit;
    
    // Quality-based emission reduction: emit fewer particles when quality drops
    // This prevents the system from digging deeper into lag
    toEmit = Math.floor(toEmit * quality);
    
    // Hard limit: max 50 particles per emitter per frame to prevent GPU stalls
    toEmit = Math.min(toEmit, 50);
    
    // Limit emission for non-continuous emitters
    if (!emit.continuous && toEmit > emit.remaining) {
      toEmit = emit.remaining;
    }
    toEmit = Math.min(toEmit, remainingEmissionBudget);
    if (toEmit <= 0) continue;
    remainingEmissionBudget -= toEmit;

    // Sub-frame interpolation: distribute particles along emitter's motion path
    // Prevents clustering when emitter moves fast between frames
    const prevPos = emit._prevPosition || emit.position;
    const baseX = emit.position[0];
    const baseY = emit.position[1];
    const baseZ = emit.position[2];
    const hasMoved = (prevPos[0] !== baseX || prevPos[1] !== baseY || prevPos[2] !== baseZ);
    
    // Get emitter-specific velocity parameters
    const upSpeedRange = emit.upSpeed || [2.0, 3.5];
    const hSpeed = emit.horizontalSpeed || 0.5;
    const lifetimeRange = emit.lifetime || [1.0, 2.0];
    // Optional per-emitter debug logging removed by default to avoid spam.

    // Use module-level reusable buffers for GPU upload (reduce/reuse/recycle)
    const singlePos = _singlePos;
    const singleVel = _singleVel;
    const singleMeta = _singleMeta;

    // Get emitter color, size, shape, and render mode from schema
    const emitterColor = emit.color || [1, 1, 1];
    const emitterSize = (emit.pointSize || 4.0) * sizeScale;
    const emitterShape = getShapeId(emit.shape);
    const emitterRenderMode = getRenderModeId(emit.renderMode);
    // Behavior determines particle movement pattern in compute shader
    const emitterBehavior = getBehaviorId(emit.behavior);

    for (let n = 0; n < toEmit; n++) {
      // Prefer reusing dead slots, otherwise append
      let i;
      let reusedSlot = false;
      if (freeSlots && freeSlots.length > 0) {
        i = freeSlots.pop();
        // Also remove from Set for O(1) tracking
        const freeSlotsSet = options.freeSlotsSet;
        if (freeSlotsSet) freeSlotsSet.delete(i);
        // Validate popped slot is a valid finite integer
        if (!Number.isFinite(i) || i < 0 || i >= maxParticles) {
          i = (appendIndex + emittedTotal + n) % maxParticles;
          reusedSlot = false;
        } else {
          reusedSlot = true;
        }
      } else {
        i = (appendIndex + emittedTotal + n) % maxParticles;
      }
      // Final validation - skip this particle if index is still invalid
      if (!Number.isFinite(i) || i < 0 || i >= maxParticles) continue;
      const pi = i * 4;

      // Determine if this emitter has a directional aim
      const hasDir =
        Array.isArray(emit.direction) &&
        emit.direction.length >= 3 &&
        (emit.direction[0] !== 0 ||
          emit.direction[1] !== 0 ||
          emit.direction[2] !== 0);

      // Sub-frame interpolation: spread particles along emitter motion path
      const subT = (hasMoved && toEmit > 1) ? n / (toEmit - 1) : 1.0;
      const interpX = prevPos[0] + (baseX - prevPos[0]) * subT;
      const interpY = prevPos[1] + (baseY - prevPos[1]) * subT;
      const interpZ = prevPos[2] + (baseZ - prevPos[2]) * subT;

      let px, py, pz;
      let spawnNormal = null;

      if (emit.spawnShape) {
        // Structured spawn shape (Niagara parity)
        const shapeResult = spawnFromShape(emit.spawnShape, [interpX, interpY, interpZ], emittedTotal + n);
        px = shapeResult.position[0];
        py = shapeResult.position[1];
        pz = shapeResult.position[2];
        spawnNormal = shapeResult.normal;
      } else {
        // Legacy point-spread spawn
        const spawnRadius = hasDir ? 0.12 : 0.5;
        const angle = aiRng.float() * Math.PI * 2;
        const r = aiRng.float() * spawnRadius;
        px = interpX + Math.cos(angle) * r;
        py = interpY + aiRng.float() * 0.1;
        pz = interpZ + Math.sin(angle) * r;
      }

      positions[pi + 0] = px;
      positions[pi + 1] = py;
      positions[pi + 2] = pz;
      positions[pi + 3] = 0.0; // age starts at 0

      let vx = 0;
      let vy = 0;
      let vz = 0;

      if (spawnNormal && emit.spawnShape) {
        // Spawn shape provides outward normal → use it for initial velocity direction
        const baseSpeed = upSpeedRange[0] + aiRng.float() * (upSpeedRange[1] - upSpeedRange[0]);
        const spread = emit.spawnShape.spread ?? 0.2;
        const vel = velocityFromNormal(spawnNormal, baseSpeed, spread);
        vx = vel[0];
        vy = vel[1];
        vz = vel[2];
      } else if (hasDir) {
        let baseSpeed = Math.max(0, hSpeed);
        if (!(baseSpeed > 0)) {
          baseSpeed =
            upSpeedRange[0] +
            aiRng.float() * (upSpeedRange[1] - upSpeedRange[0]);
        }
        const dx = emit.direction[0];
        const dy = emit.direction[1];
        const dz = emit.direction[2];

        const coneDeg = 5;
        const coneRad = degreesToRadians(coneDeg);
        // Use horizontalSpeed to control how wide the beam is; smaller hSpeed means tighter beam.
        const spreadBase = Math.max(0, hSpeed) * 0.3;
        const maxJitterRadius = Math.min(
          spreadBase,
          Math.tan(coneRad) * baseSpeed,
        );
        const jitterAngle = aiRng.float() * Math.PI * 2;
        const jitterRadius = aiRng.float() * maxJitterRadius;
        const jx = Math.cos(jitterAngle) * jitterRadius;
        const jz = Math.sin(jitterAngle) * jitterRadius;
        const jy = aiRng.range(-0.5, 0.5) * 0.2 * maxJitterRadius;

        vx = dx * baseSpeed + jx;
        vy = dy * baseSpeed + jy;
        vz = dz * baseSpeed + jz;
      } else {
        const vyBase =
          upSpeedRange[0] +
          aiRng.float() * (upSpeedRange[1] - upSpeedRange[0]);
        vx = aiRng.range(-0.5, 0.5) * hSpeed;
        vz = aiRng.range(-0.5, 0.5) * hSpeed;
        vy = vyBase;
      }

      // Randomize lifetime within emitter's range (minimum 0.1 seconds)
      const minLifetime = 0.1;
      const lifetime = Math.max(
        minLifetime,
        (lifetimeRange[0] + aiRng.float() * (lifetimeRange[1] - lifetimeRange[0])) * lifetimeScale
      );
      
      // === ATTRACT-TO-CENTER: override velocity so particle converges to origin at death ===
      // velocity = -(spawnOffset) / lifetime  →  particle reaches origin exactly when it dies
      if (emit.attractToCenter) {
        const fadeRate = 1.0 / lifetime;
        vx = -(px - baseX) * fadeRate;
        vy = -(py - baseY) * fadeRate;
        vz = -(pz - baseZ) * fadeRate;
      }
      
      // Track slot spawn time and lifetime for dead detection
      if (slotInfo) {
        slotInfo[i * 2] = currentTime;
        slotInfo[i * 2 + 1] = lifetime;
      }
      
      velocities[pi + 0] = vx;
      velocities[pi + 1] = vy;
      velocities[pi + 2] = vz;
      // velocity.w stores per-particle lifetime (gravity handled globally in compute shader)
      velocities[pi + 3] = lifetime;

      // Upload this particle's initial state to the GPU buffers at the correct offset.
      // Validate index before GPU upload to prevent "unsigned long long" errors
      if (particleWorld.device && Number.isFinite(i) && i >= 0 && i < maxParticles) {
        const offsetBytes = (i | 0) * 16; // 4 floats * 4 bytes per float, ensure integer
        singlePos[0] = px;
        singlePos[1] = py;
        singlePos[2] = pz;
        singlePos[3] = 0.0;
        singleVel[0] = vx;
        singleVel[1] = vy;
        singleVel[2] = vz;
        singleVel[3] = velocities[pi + 3];
        // === PER-PARTICLE META BUFFER (color + packed physics) ===
        // meta.rgb = emitterColor — this is the ONLY place particle color is set.
        // Color comes from elementMixToEmitterConfig() in ParticleElementRegistry.js,
        // which derives it from element combinations (e.g. water+ice → [0.5,0.7,0.9]).
        // The SDF vertex shader reads uMeta[ii].xyz → input.color (NO alive list indirection).
        // The SDF fragment shader then applies volumetric lighting + thermal glow.
        // See particles_sdf_billboard.js and ParticleHalfResComposite.js for the full pipeline.
        //
        // meta.w = packed: mass*1e8 + drag*1e6 + size*1e4 + renderMode*1e3 + shape*10 + behavior
        // Unpacking in shader: particleSize = (floor(meta.w / 1e4) % 100) * 0.1
        singleMeta[0] = emitterColor[0];
        singleMeta[1] = emitterColor[1];
        singleMeta[2] = emitterColor[2];
        singleMeta[3] = packParticleMeta(
          emitterSize,
          emitterRenderMode,
          emitterShape,
          emitterBehavior,
          emit.mass ?? 1.0,
          emit.drag ?? 0.02
        );
        
        // CPU-side mirror for snapshot/rewind (particles.meta in EditorParticles.js)
        if (meta) {
          meta[pi + 0] = singleMeta[0];
          meta[pi + 1] = singleMeta[1];
          meta[pi + 2] = singleMeta[2];
          meta[pi + 3] = singleMeta[3];
        }
        
        // Upload to GPU buffers — device.queue.writeBuffer copies data synchronously
        // from the CPU ArrayBuffer into a staging buffer, so reusing singleMeta/singlePos
        // for the next particle is safe (the data is already captured).
        updateBuffer(particleWorld.device, particleWorld.positionBuffer, singlePos, offsetBytes);
        updateBuffer(particleWorld.device, particleWorld.velocityBuffer, singleVel, offsetBytes);
        if (particleWorld.metaBuffer) {
          updateBuffer(particleWorld.device, particleWorld.metaBuffer, singleMeta, offsetBytes);
        }
        // Upload UV data: [u, v, opacity, rotation]
        // uv.w stores initial rotation angle for billboard rotation (read by vertex shader)
        if (particleWorld.uvBuffer) {
          const _singleUV = _singleThermal; // Reuse temp buffer (written before thermal below)
          _singleUV[0] = 0; // u
          _singleUV[1] = 0; // v
          _singleUV[2] = emit.opacity ?? 0; // per-particle opacity (0 = use default)
          const rotMin = emit.initialRotation?.[0] ?? 0;
          const rotMax = emit.initialRotation?.[1] ?? (Math.PI * 2);
          _singleUV[3] = rotMin + aiRng.float() * (rotMax - rotMin); // initial rotation angle
          updateBuffer(particleWorld.device, particleWorld.uvBuffer, _singleUV, offsetBytes);
        }
        // Upload thermal data: [temperature, phase, packedGroupMaterial, latentEnergy]
        // thermalData.z packing: lower 8 bits = materialIdx (0-15), upper bits = collisionGroup
        if (particleWorld.thermalBuffer) {
          _singleThermal[0] = emit.temperature ?? 293;       // Kelvin
          _singleThermal[1] = emit.phase ?? 0;               // 0=solid, 1=liquid, 2=gas, 3=plasma
          const matIdx = (emit.materialIndex ?? 0) & 0xFF;
          const group = ((emit.collisionGroup ?? 0) & 0xFFFFFF) << 8;
          _singleThermal[2] = group | matIdx;                // packed: groupId<<8 | materialIdx
          _singleThermal[3] = 0;                             // latent energy accumulator (starts at 0)
          updateBuffer(particleWorld.device, particleWorld.thermalBuffer, _singleThermal, offsetBytes);
        }
        // Upload element type + charge to GAP 33 buffers (substance-driven physics)
        if (particleWorld.elementTable && emit.physicsProfile && emit.physicsProfile.atomicNumber > 0) {
          const elOffset = (i | 0) * 4; // 1 u32 per particle
          _singleElement[0] = emit.physicsProfile.atomicNumber;
          particleWorld.device.queue.writeBuffer(particleWorld.elementTable.elementBuffer, elOffset, _singleElement);
          _singleCharge[0] = emit.substanceCharge || emit.physicsProfile.charge || 0;
          particleWorld.device.queue.writeBuffer(particleWorld.elementTable.chargeBuffer, elOffset, _singleCharge);
        }
      }
    }

    // Save position for next frame's sub-frame interpolation
    emit._prevPosition = [baseX, baseY, baseZ];

    emittedTotal += toEmit;
    
    // Only decrease remaining for non-continuous emitters
    if (!emit.continuous) {
      emit.remaining -= toEmit;
      if (emit.remaining <= 0) {
        emitters.splice(ei, 1);
      }
    }
  }

  // We already uploaded per-particle data above; no need to overwrite the whole buffers.
  // Optional debug logging removed by default to avoid per-frame spam.

  return emittedTotal;
}

/**
 * Update particle counts by scanning for dead particles.
 * Adds dead slots to freeSlots array and updates live/dead counts.
 * Call this periodically (e.g., every 0.5s) to refresh counts.
 * 
 * @param {Object} particles - Particle state with slotInfo, freeSlots, etc.
 * @param {number} currentTime - Current time in seconds
 * @returns {Object} { liveCount, deadCount, freeSlots }
 */
export function updateParticleCounts(particles, currentTime) {
  if (!particles || !particles.slotInfo) {
    return { liveCount: 0, deadCount: 0, freeSlots: 0 };
  }

  const slotInfo = particles.slotInfo;
  const maxSlots = particles.instanceCount || 0;
  const freeSlots = particles.freeSlots || [];
  
  let liveCount = 0;
  let deadCount = 0;
  let highestAliveSlot = -1;
  
  // Scan all used slots
  for (let i = 0; i < maxSlots; i++) {
    const spawnTime = slotInfo[i * 2];
    const lifetime = slotInfo[i * 2 + 1];
    
    if (lifetime <= 0) continue; // Unused slot
    
    const age = currentTime - spawnTime;
    if (age >= lifetime) {
      // Dead particle - add to free list if not already there
      deadCount++;
      const freeSlotsSet = particles.freeSlotsSet;
      if (!freeSlotsSet || !freeSlotsSet.has(i)) {
        freeSlots.push(i);
        if (freeSlotsSet) freeSlotsSet.add(i);
      }
    } else {
      liveCount++;
      highestAliveSlot = i;
    }
  }
  
  particles.liveCount = liveCount;
  particles.deadCount = deadCount;
  // Shrink instanceCount to just cover the highest alive slot (+ 1 for 0-indexed)
  // This reduces wasted vertex shader invocations on dead tail particles
  if (highestAliveSlot >= 0) {
    particles.instanceCount = highestAliveSlot + 1;
    particles.activeInstanceCount = highestAliveSlot + 1;
  } else if (liveCount === 0) {
    particles.instanceCount = 0;
    particles.activeInstanceCount = 0;
  }
  
  // Reuse cached result object (eliminates 1 object alloc/frame)
  _updateCountsResult.liveCount = liveCount;
  _updateCountsResult.deadCount = deadCount;
  _updateCountsResult.freeSlots = freeSlots.length;
  return _updateCountsResult;
}

/**
 * Age all particles by a given duration and cull those that died.
 * Call this when resuming from hidden/minimized to skip dead particles.
 * 
 * @param {Object} particles - Particle state with positions, slotInfo, etc.
 * @param {number} hiddenDuration - How long the tab was hidden (seconds)
 * @param {Object} options - { logger }
 * @returns {number} Number of particles culled
 */
export function ageAndCullParticles(particles, hiddenDuration, options = {}) {
  if (!particles || !particles.positions || hiddenDuration <= 0) {
    return 0;
  }

  const positions = particles.positions;
  const slotInfo = particles.slotInfo;
  const freeSlots = particles.freeSlots || [];
  const maxSlots = particles.instanceCount || 0;
  const logger = options.logger;
  
  let culledCount = 0;
  
  // Age all particles by adding hiddenDuration to their age (stored in positions[i*4+3])
  for (let i = 0; i < maxSlots; i++) {
    const pi = i * 4;
    const currentAge = positions[pi + 3];
    
    // Skip empty slots (age = 0 and no lifetime)
    if (currentAge <= 0 && (!slotInfo || slotInfo[i * 2 + 1] <= 0)) {
      continue;
    }
    
    // Get lifetime from slotInfo if available
    const lifetime = slotInfo ? slotInfo[i * 2 + 1] : 2.0;
    if (lifetime <= 0) continue;
    
    // Age the particle
    const newAge = currentAge + hiddenDuration;
    positions[pi + 3] = newAge;
    
    // If particle is now dead, mark it for reuse
    if (newAge >= lifetime) {
      culledCount++;
      const freeSlotsSet = particles.freeSlotsSet;
      if (!freeSlotsSet || !freeSlotsSet.has(i)) {
        freeSlots.push(i);
        if (freeSlotsSet) freeSlotsSet.add(i);
      }
    }
  }
  
  if (culledCount > 0 && logger) {
    logger.info(`[PARTICLES] Culled ${culledCount} dead particles after ${hiddenDuration.toFixed(1)}s hidden`);
  }
  
  return culledCount;
}

/**
 * Initialize slot tracking for a particle system.
 * Call once after creating particles state.
 */
export function initSlotTracking(particles, maxCount) {
  if (!particles) return;
  particles.slotInfo = new Float32Array(maxCount * 2); // [spawnTime, lifetime] per slot
  particles.freeSlots = [];       // Array for ordered pop() access
  particles.freeSlotsSet = new Set(); // Set for O(1) has() checks
  particles.liveCount = 0;
  particles.deadCount = 0;
  particles.totalSpawned = 0;
}

/**
 * Build AABB collider buffer from ECS entities for particle collisions.
 * Returns the number of colliders written.
 */
export function buildColliderBuffer(particleWorld, entities, options = {}) {
  if (!particleWorld || !particleWorld.colliderBuffer) return 0;
  if (!entities || entities.length === 0) return 0;

  const getTransform = options.getTransform;
  if (!getTransform) return 0;

  const maxColliders = particleWorld.maxColliders || 64;
  const maxFloats = maxColliders * 8;

  // Reuse or create buffer
  let data = options.colliderData;
  if (!data || data.length < maxFloats) {
    data = new Float32Array(maxFloats);
  }

  let writeIndex = 0;
  for (let i = 0; i < entities.length && writeIndex < maxColliders; i++) {
    const entry = entities[i];
    // Skip emitter markers so particles don't collide with their own emitters
    if (entry.type === "emitter_marker") continue;
    const t = getTransform(entry.entityId);
    if (!t || !Array.isArray(t.position) || t.position.length < 3) continue;

    const p = t.position;
    let sx = 1, sy = 1, sz = 1;
    if (Array.isArray(t.scale) && t.scale.length >= 3) {
      const sxRaw = Number(t.scale[0]);
      const syRaw = Number(t.scale[1]);
      const szRaw = Number(t.scale[2]);
      if (Number.isFinite(sxRaw)) sx = sxRaw;
      if (Number.isFinite(syRaw)) sy = syRaw;
      if (Number.isFinite(szRaw)) sz = szRaw;
    }

    const hx = sx * 0.5;
    const hy = sy * 0.5;
    const hz = sz * 0.5;

    const base = writeIndex * 8;
    data[base + 0] = p[0] - hx;
    data[base + 1] = p[1] - hy;
    data[base + 2] = p[2] - hz;
    data[base + 3] = 0.0;
    data[base + 4] = p[0] + hx;
    data[base + 5] = p[1] + hy;
    data[base + 6] = p[2] + hz;
    data[base + 7] = 0.0;

    writeIndex++;
  }

  if (writeIndex > 0 && particleWorld.device) {
    updateBuffer(particleWorld.device, particleWorld.colliderBuffer, data, 0);
  }

  return writeIndex;
}

/**
 * Build fluid sources from emitters for density splatting.
 */
export function buildFluidSources(emitters, options = {}) {
  const sources = [];
  if (!Array.isArray(emitters) || emitters.length === 0) {
    return sources;
  }

  for (let i = 0; i < emitters.length; i++) {
    const emit = emitters[i];
    if (!emit) continue;

    const pos = emit.position;
    if (!Array.isArray(pos) || pos.length < 3) continue;

    const emitRateRaw = Number(emit.emitRate);
    if (!Number.isFinite(emitRateRaw) || emitRateRaw <= 0) continue;

    const typeId = typeof emit.type === "string" ? emit.type : "";
    // Skip sparks (purely visual) and water/metaball particles (rendered via screen-space pass)
    if (typeId === "sparks") {
      continue;
    }
    // States of matter filter: gas (0) uses volumetric, liquid/plasma use screen-space
    const renderMode = emit.renderMode || "gas";
    if (renderMode === "liquid" || renderMode === "water" || 
        renderMode === "plasma" || renderMode === "metaball") {
      continue;  // Liquid/plasma particles use screen-space rendering, not volumetric gas
    }

    const elemId = getEmitterElement(typeId);
    let elementWeight = 1.0;
    const elemPower = emit.elementPower;
    if (elemPower && typeof elemPower === "object") {
      const v = Number(elemPower[elemId]);
      if (Number.isFinite(v) && v > 0) {
        elementWeight = v;
      }
    } else {
      if (elemId === "water") {
        elementWeight = 1.2;
      } else if (elemId === "smoke") {
        elementWeight = 1.0;
      } else if (elemId === "fire") {
        elementWeight = 0.4;
      } else if (elemId === "magic") {
        elementWeight = 0.6;
      } else {
        elementWeight = 0.3;
      }
    }

    const sizeVal = Number(emit.pointSize);
    let radius = Number.isFinite(sizeVal) ? sizeVal * 0.75 : 2.0;
    if (!Number.isFinite(radius) || radius <= 0) {
      radius = 2.0;
    }
    const minRadius = 1.0;
    const maxRadius = 30.0;
    if (radius < minRadius) radius = minRadius;
    if (radius > maxRadius) radius = maxRadius;

    const strengthBase = emitRateRaw;
    const strength = strengthBase * elementWeight * 0.5;
    if (!(strength > 0)) continue;

    sources.push({
      position: [pos[0], pos[1], pos[2]],
      radius,
      strength,
      element: elemId,
    });
  }

  return sources;
}
