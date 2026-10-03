// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * RopeMaterial.js — Thermal & interaction properties for rope/chain fiber materials.
 *
 * Extends the visual-only FIBER_MATERIALS from RopeSchema with physics properties
 * needed for particle↔rope interaction: flammability, moisture absorption,
 * thermal conductivity, burn/break temperatures, mass modifiers.
 *
 * EVERY material (including steel and chain) participates in interactions —
 * metal softens and breaks at high enough temperatures, organic materials burn,
 * all materials conduct heat along the chain. Thresholds differ per material.
 *
 * Interaction types by substance:
 *  - Fire/lava/plasma → heat transfer → softening → burning/melting → chain split
 *  - Water/blood/honey → moisture absorption → heavier → sag → wet stiffness change
 *  - Ice/snow → cooling → stiffening → freeze-brittle
 *  - Acid → corrosion → integrity loss → chain split
 *  - Sparks/debris → minor heat transfer
 */

// =============================================================================
// ROPE INTERACTION MATERIALS — Per-fiber thermal & environmental properties
// =============================================================================

export const ROPE_INTERACTION_MATERIALS = {
  cotton: {
    flammability:           0.85,
    burnTemperature:        500,     // K — cotton ignites ~230°C
    breakTemperature:       600,     // K — structural failure
    meltTemperature:        0,       // N/A — organic
    thermalConductivity:    0.25,
    thermalMass:            1.2,
    moistureCapacity:       0.7,
    moistureRate:           0.4,
    dryRate:                0.05,
    wetMassMultiplier:      2.2,
    wetStiffnessMultiplier: 0.7,
    dryMass:                0.8,
    corrosionRate:          0.3,
    freezeStiffening:       0.3,
    charRate:               0.4,
    emberSpawnRate:         5,
    smokeSpawnRate:         12,
  },

  wool: {
    flammability:           0.4,     // Naturally flame-resistant
    burnTemperature:        870,     // K — wool is hard to ignite
    breakTemperature:       950,
    meltTemperature:        0,
    thermalConductivity:    0.15,    // Good insulator
    thermalMass:            1.8,
    moistureCapacity:       0.5,
    moistureRate:           0.25,
    dryRate:                0.03,
    wetMassMultiplier:      1.8,
    wetStiffnessMultiplier: 0.6,
    dryMass:                0.9,
    corrosionRate:          0.2,
    freezeStiffening:       0.4,
    charRate:               0.15,
    emberSpawnRate:         2,
    smokeSpawnRate:         8,
  },

  silk: {
    flammability:           0.9,
    burnTemperature:        450,     // K — silk burns easily
    breakTemperature:       500,
    meltTemperature:        0,
    thermalConductivity:    0.2,
    thermalMass:            0.8,
    moistureCapacity:       0.3,
    moistureRate:           0.15,
    dryRate:                0.08,
    wetMassMultiplier:      1.5,
    wetStiffnessMultiplier: 0.5,     // Silk weakens significantly when wet
    dryMass:                0.3,
    corrosionRate:          0.5,     // Delicate
    freezeStiffening:       0.2,
    charRate:               0.8,     // Burns fast
    emberSpawnRate:         3,
    smokeSpawnRate:         6,
  },

  nylon: {
    flammability:           0.6,
    burnTemperature:        680,     // K — nylon melts then burns
    breakTemperature:       750,
    meltTemperature:        530,     // K — nylon melts at ~260°C
    thermalConductivity:    0.3,
    thermalMass:            1.0,
    moistureCapacity:       0.1,     // Barely absorbs water
    moistureRate:           0.05,
    dryRate:                0.1,
    wetMassMultiplier:      1.05,
    wetStiffnessMultiplier: 0.95,
    dryMass:                0.7,
    corrosionRate:          0.1,
    freezeStiffening:       0.15,
    charRate:               0.3,
    emberSpawnRate:         1,
    smokeSpawnRate:         15,      // Nylon produces thick smoke
  },

  hemp: {
    flammability:           0.7,
    burnTemperature:        570,     // K — hemp ignites ~300°C
    breakTemperature:       650,
    meltTemperature:        0,
    thermalConductivity:    0.2,
    thermalMass:            1.5,
    moistureCapacity:       0.6,
    moistureRate:           0.35,
    dryRate:                0.04,
    wetMassMultiplier:      2.0,
    wetStiffnessMultiplier: 0.75,
    dryMass:                1.0,
    corrosionRate:          0.25,
    freezeStiffening:       0.35,
    charRate:               0.3,
    emberSpawnRate:         4,
    smokeSpawnRate:         10,
  },

  steel: {
    flammability:           0.0,     // Steel doesn't combust
    burnTemperature:        Infinity,
    breakTemperature:       1800,    // K — structural failure under load
    meltTemperature:        1700,    // K — steel softens/melts
    thermalConductivity:    0.92,    // Excellent conductor — heat races along chain
    thermalMass:            3.5,     // Heavy, slow to heat up
    moistureCapacity:       0.0,     // Waterproof
    moistureRate:           0.0,
    dryRate:                0.0,
    wetMassMultiplier:      1.0,
    wetStiffnessMultiplier: 1.0,
    dryMass:                5.0,
    corrosionRate:          0.08,    // Rusts slowly in acid
    freezeStiffening:       0.02,    // Already stiff
    charRate:               0.0,
    emberSpawnRate:         0,
    smokeSpawnRate:         0,
  },

  chain: {
    flammability:           0.0,
    burnTemperature:        Infinity,
    breakTemperature:       1900,    // K — thicker links, slightly stronger
    meltTemperature:        1750,    // K
    thermalConductivity:    0.95,    // Metal links conduct heat fast
    thermalMass:            4.0,     // Heavier than cable
    moistureCapacity:       0.0,
    moistureRate:           0.0,
    dryRate:                0.0,
    wetMassMultiplier:      1.0,
    wetStiffnessMultiplier: 1.0,
    dryMass:                6.0,
    corrosionRate:          0.06,
    freezeStiffening:       0.01,
    charRate:               0.0,
    emberSpawnRate:         0,
    smokeSpawnRate:         0,
  },

  vine: {
    flammability:           0.6,
    burnTemperature:        520,
    breakTemperature:       580,
    meltTemperature:        0,
    thermalConductivity:    0.18,
    thermalMass:            1.3,
    moistureCapacity:       0.85,    // Vines absorb a lot of water
    moistureRate:           0.5,
    dryRate:                0.02,
    wetMassMultiplier:      2.5,
    wetStiffnessMultiplier: 0.8,
    dryMass:                0.7,
    corrosionRate:          0.35,
    freezeStiffening:       0.4,
    charRate:               0.35,
    emberSpawnRate:         3,
    smokeSpawnRate:         8,
  },

  wire: {
    flammability:           0.0,
    burnTemperature:        Infinity,
    breakTemperature:       1600,    // K — thinner than chain, weaker
    meltTemperature:        1500,
    thermalConductivity:    0.88,
    thermalMass:            2.5,
    moistureCapacity:       0.0,
    moistureRate:           0.0,
    dryRate:                0.0,
    wetMassMultiplier:      1.0,
    wetStiffnessMultiplier: 1.0,
    dryMass:                3.0,
    corrosionRate:          0.1,
    freezeStiffening:       0.02,
    charRate:               0.0,
    emberSpawnRate:         0,
    smokeSpawnRate:         0,
  },
};

// =============================================================================
// SUBSTANCE → INTERACTION TYPE MAPPING
// =============================================================================

export const INTERACTION_HEAT     = 0;
export const INTERACTION_MOISTURE = 1;
export const INTERACTION_COOL     = 2;
export const INTERACTION_CORRODE  = 3;

/**
 * Map particle substance to interaction type and intensity.
 * Returns null if the substance doesn't interact with rope.
 */
export function getSubstanceInteraction(substance) {
  switch (substance) {
    // Heat sources
    case 'fire':    return { type: INTERACTION_HEAT, intensity: 1.0,  temperature: 1200 };
    case 'lava':    return { type: INTERACTION_HEAT, intensity: 1.5,  temperature: 1500 };
    case 'plasma':  return { type: INTERACTION_HEAT, intensity: 2.0,  temperature: 8000 };
    case 'sparks':  return { type: INTERACTION_HEAT, intensity: 0.3,  temperature: 900 };
    case 'steam':   return { type: INTERACTION_HEAT, intensity: 0.15, temperature: 373 };
    case 'metal':   return { type: INTERACTION_HEAT, intensity: 0.5,  temperature: 1800 };

    // Moisture sources
    case 'water':   return { type: INTERACTION_MOISTURE, intensity: 1.0, moisture: 0.8 };
    case 'blood':   return { type: INTERACTION_MOISTURE, intensity: 0.7, moisture: 0.6 };
    case 'honey':   return { type: INTERACTION_MOISTURE, intensity: 0.4, moisture: 0.3 };
    case 'oil':     return { type: INTERACTION_MOISTURE, intensity: 0.5, moisture: 0.4 };

    // Cooling sources
    case 'ice':     return { type: INTERACTION_COOL, intensity: 0.8, temperature: 250 };
    case 'snow':    return { type: INTERACTION_COOL, intensity: 0.5, temperature: 265 };

    // Corrosion
    case 'acid':    return { type: INTERACTION_CORRODE, intensity: 1.0 };

    default: return null;
  }
}

// =============================================================================
// PER-NODE STATE — Allocated per rope, one entry per rope particle
// =============================================================================

/**
 * Create per-node interaction state for a rope.
 * @param {number} nodeCount - Number of particles in the rope
 * @param {number} ambientTemp - Starting temperature (K), default 293 (room temp)
 * @returns {Object} Per-node state arrays
 */
export function createRopeNodeState(nodeCount, ambientTemp = 293) {
  return {
    temperature:  new Float32Array(nodeCount).fill(ambientTemp),
    moisture:     new Float32Array(nodeCount),  // 0-1 saturation
    integrity:    new Float32Array(nodeCount).fill(1.0), // 1=intact, 0=destroyed
    burning:      new Uint8Array(nodeCount),    // 0=no, 1=ignited
    charred:      new Float32Array(nodeCount),  // 0-1 char progress
    nodeCount,
  };
}

/**
 * Get the interaction material for a fiber material name.
 * Falls back to hemp if unknown.
 * @param {string} fiberMaterial - Material name (cotton, steel, chain, etc.)
 * @returns {Object} Interaction material properties
 */
export function getRopeInteractionMaterial(fiberMaterial) {
  return ROPE_INTERACTION_MATERIALS[fiberMaterial] || ROPE_INTERACTION_MATERIALS.hemp;
}
