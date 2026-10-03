// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * SpellGeneratorIntegration.js - Connect SpellGenerator to existing SpellConfig
 * 
 * Bridges the procedural spell generator with the existing spell system:
 * - Converts generated spells to SpellConfig format
 * - Integrates with SpellEffectFactory for particle emitters
 * - Provides save/load for generated spells
 */

import { SpellGenerator, SPELL_ELEMENTS, SPELL_TYPES, SPELL_MODIFIERS } from './SpellGenerator.js';
import { SpellElementMixer } from './SpellElementMixer.js';
import { getParticleEffectRegistry } from '../../render/particles/ParticleEffectRegistry.js';
import { createBrowserRecordContract } from '../../core/schema/BrowserRecordContract.js';

// ============================================================================
// SPELL CONFIG CONVERTER
// ============================================================================

/**
 * Convert a generated spell to the existing SpellConfig format
 * Compatible with SpellConfig.js SPELL_PRESETS structure
 */
export function generatedSpellToConfig(generatedSpell) {
  const { element, type, stats, colors, emitterConfig } = generatedSpell;
  const elementData = SPELL_ELEMENTS[element];
  const typeData = SPELL_TYPES[type];
  
  // Map generator type to existing spell type
  const spellTypeMap = {
    'projectile': 'projectile',
    'aoe': 'ground-fire',
    'beam': 'projectile',
    'shield': 'shield',
    'buff': 'aura',
    'summon': 'aura',
  };
  
  // Map element to category
  const categoryMap = {
    'fire': 'combat',
    'ice': 'combat',
    'lightning': 'combat',
    'arcane': 'combat',
    'nature': 'buff',
    'dark': 'combat',
    'holy': 'buff',
  };
  
  return {
    id: generatedSpell.id,
    name: generatedSpell.name,
    category: categoryMap[element] || 'combat',
    type: spellTypeMap[type] || 'projectile',
    icon: generatedSpell.icon,
    description: `${elementData?.name || element} ${typeData?.name || type} spell`,
    
    // Stats
    damage: stats.damage || 0,
    manaCost: stats.manaCost || 20,
    cooldown: stats.cooldown || 1.0,
    duration: stats.duration || 0,
    
    // Visual
    color: colors.primary,
    colorSecondary: colors.secondary,
    
    // Particle emitter config (for SpellEffectFactory)
    particleConfig: {
      maxParticles: emitterConfig.maxParticles,
      rate: emitterConfig.emitRate,
      lifetime: Array.isArray(emitterConfig.lifetime) ? emitterConfig.lifetime[1] : emitterConfig.lifetime,
      sizeStart: Array.isArray(emitterConfig.startSize) ? emitterConfig.startSize[1] : emitterConfig.startSize,
      sizeEnd: Array.isArray(emitterConfig.endSize) ? emitterConfig.endSize[1] : emitterConfig.endSize,
      colorStart: emitterConfig.startColor,
      colorEnd: emitterConfig.endColor,
      gravity: [0, emitterConfig.gravity || 0, 0],
      speed: Array.isArray(emitterConfig.velocity?.magnitude) ? emitterConfig.velocity.magnitude[1] : 1,
      spreadAngle: emitterConfig.velocity?.spread || 0.3,
      // Custom effect
      useCustomEffect: true,
      effectId: generatedSpell.particleEffect?.id || 'sphere',
      effectParams: [0, 0, 0, 0],
    },
    
    // Behavior
    hasTrajectory: typeData?.hasTrajectory || false,
    hasImpact: typeData?.hasImpact || false,
    groundBased: typeData?.groundBased || false,
    defensive: typeData?.defensive || false,
    
    // Status effects
    statusEffects: stats.statusEffects || [],
    damageType: stats.damageType || 'physical',
    
    // Modifiers applied
    modifiers: generatedSpell.modifiers || [],
    
    // Generator metadata
    _generated: true,
    _generatedAt: generatedSpell.generatedAt,
    _powerLevel: generatedSpell.powerLevel,
    _seed: generatedSpell.seed,
  };
}

/**
 * Convert existing SpellConfig preset to generator format
 * Allows editing existing spells in the generator
 */
export function configToGeneratorFormat(spellConfig) {
  // Try to detect element from colors or name
  let detectedElement = 'fire';
  const nameLower = (spellConfig.name || '').toLowerCase();
  
  for (const [elemId, elem] of Object.entries(SPELL_ELEMENTS)) {
    if (nameLower.includes(elemId) || nameLower.includes(elem.name.toLowerCase())) {
      detectedElement = elemId;
      break;
    }
  }
  
  // Detect type
  let detectedType = 'projectile';
  const typeMap = {
    'projectile': 'projectile',
    'shield': 'shield',
    'aura': 'buff',
    'heal': 'buff',
    'ground-fire': 'aoe',
    'ground-heal': 'aoe',
  };
  detectedType = typeMap[spellConfig.type] || 'projectile';
  
  return {
    element: detectedElement,
    type: detectedType,
    modifiers: spellConfig.modifiers || [],
    powerLevel: spellConfig._powerLevel || 1.0,
    name: spellConfig.name,
  };
}

// ============================================================================
// SPELL LIBRARY INTEGRATION
// ============================================================================

const SPELL_LIBRARY_KEY = 'generated_spells';
export const GENERATED_SPELL_LIBRARY_SCHEMA = 'engine.generated-spell-library';
export const GENERATED_SPELL_LIBRARY_SCHEMA_VERSION = 2;

const generatedSpellLibraryStorage = createBrowserRecordContract({
  schema: GENERATED_SPELL_LIBRARY_SCHEMA,
  legacyKey: SPELL_LIBRARY_KEY,
  currentKey: `${SPELL_LIBRARY_KEY}.v2`,
  payloadKey: 'spells',
  maxBytes: 16 * 1024 * 1024,
  validate: value => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length <= 10000,
});

export function readGeneratedSpellLibraryRecord(storage = globalThis.localStorage) {
  return generatedSpellLibraryStorage.read(storage);
}

export function writeGeneratedSpellLibraryRecord(library, storage = globalThis.localStorage) {
  return generatedSpellLibraryStorage.write(library, storage);
}

/**
 * Save generated spell to library (IndexedDB via registry pattern)
 */
export async function saveGeneratedSpell(generatedSpell, storage = globalThis.localStorage) {
  // Preflight the durable library before the particle registry is mutated.
  const library = readGeneratedSpellLibraryRecord(storage) || {};

  // Save the particle effect
  const registry = getParticleEffectRegistry();
  if (generatedSpell.particleEffect) {
    await registry.save(generatedSpell.particleEffect);
  }
  
  // Save spell config to localStorage (or could use IndexedDB)
  library[generatedSpell.id] = generatedSpellToConfig(generatedSpell);
  writeGeneratedSpellLibraryRecord(library, storage);
  
  return generatedSpell;
}

/**
 * Load spell library from storage
 */
export function getSpellLibrary(storage = globalThis.localStorage) {
  try {
    return readGeneratedSpellLibraryRecord(storage) || {};
  } catch (e) {
    console.error('[SpellLibrary] Failed to load:', e?.code || e);
    return {};
  }
}

/**
 * Get a generated spell by ID
 */
export function getGeneratedSpell(id) {
  const library = getSpellLibrary();
  return library[id] || null;
}

/**
 * Delete a generated spell
 */
export function deleteGeneratedSpell(id, storage = globalThis.localStorage) {
  const library = getSpellLibrary(storage);
  delete library[id];
  writeGeneratedSpellLibraryRecord(library, storage);
}

/**
 * Get all generated spells as array
 */
export function getAllGeneratedSpells(storage = globalThis.localStorage) {
  const library = getSpellLibrary(storage);
  return Object.values(library);
}

// ============================================================================
// SPELL EFFECT FACTORY HELPERS
// ============================================================================

/**
 * Create particle emitter config from generated spell
 * For use with SpellEffectFactory
 * 
 * IMPORTANT: Physics parameters (mass, drag, bounciness, collisionEnabled)
 * are included to ensure collision behavior matches visual expectations.
 * The effectId links to the SAME SDF used for both rendering AND collision.
 */
export function createEmitterFromGeneratedSpell(generatedSpell, options = {}) {
  const config = generatedSpellToConfig(generatedSpell);
  const pc = config.particleConfig;
  const typeData = SPELL_TYPES[generatedSpell.type] || {};
  
  // Physics parameters based on spell type
  const physicsDefaults = {
    projectile: { mass: 0.5, drag: 0.02, bounciness: 0.3, collisionEnabled: true },
    aoe: { mass: 0.1, drag: 0.1, bounciness: 0.1, collisionEnabled: true },
    beam: { mass: 0.2, drag: 0.0, bounciness: 0.0, collisionEnabled: false },
    shield: { mass: 1.0, drag: 0.5, bounciness: 0.8, collisionEnabled: true },
    buff: { mass: 0.05, drag: 0.2, bounciness: 0.0, collisionEnabled: false },
    summon: { mass: 0.3, drag: 0.05, bounciness: 0.4, collisionEnabled: true },
  };
  
  const physics = physicsDefaults[generatedSpell.type] || physicsDefaults.projectile;
  
  return {
    enabled: true,
    maxParticles: pc.maxParticles,
    rate: pc.rate,
    lifetime: pc.lifetime,
    lifetimeRandomness: 0.2,
    shape: options.shape || 'sphere',
    shapeRadius: options.radius || 0.5,
    direction: options.direction || [0, 1, 0],
    spreadAngle: pc.spreadAngle,
    speed: pc.speed,
    speedRandomness: 0.3,
    gravity: pc.gravity,
    colorStart: pc.colorStart,
    colorEnd: pc.colorEnd,
    sizeStart: pc.sizeStart,
    sizeEnd: pc.sizeEnd,
    looping: options.looping ?? true,
    
    // Physics properties (match collision behavior to visual)
    mass: options.mass ?? physics.mass,
    drag: options.drag ?? physics.drag,
    bounciness: options.bounciness ?? physics.bounciness,
    collisionEnabled: options.collisionEnabled ?? physics.collisionEnabled,
    inheritVelocity: options.inheritVelocity ?? 0.0,
    
    // Custom effect integration (SAME SDF for visual AND collision)
    useCustomEffect: pc.useCustomEffect,
    effectId: pc.effectId,
    effectParams: pc.effectParams,
  };
}

// ============================================================================
// QUICK GENERATION HELPERS
// ============================================================================

const _generator = new SpellGenerator();
const _mixer = new SpellElementMixer();

/**
 * Quick generate a spell with minimal parameters
 */
export function quickGenerateSpell(element, type, powerLevel = 1.0) {
  return _generator.generate({ element, type, powerLevel });
}

/**
 * Generate a combined element spell
 */
export function generateCombinedSpell(element1, element2, type, powerLevel = 1.0) {
  const combined = _mixer.mix(element1, element2);
  
  const spell = _generator.generate({
    element: element1, // Use primary for base stats
    type,
    powerLevel,
  });
  
  // Apply combination
  if (combined) {
    spell.name = spell.name.replace(SPELL_ELEMENTS[element1].name, combined.name);
    spell.colors = combined.colors;
    spell.stats.statusEffects = combined.effects;
    spell.stats.damageType = combined.baseDamageType;
    spell.combinedElement = combined;
    spell.sourceElements = [element1, element2];
  }
  
  return spell;
}

/**
 * Generate loot-style random spell
 */
export function generateLootSpell(rarity = 'common') {
  const rarityMultipliers = {
    common: 1.0,
    uncommon: 1.3,
    rare: 1.6,
    epic: 2.0,
    legendary: 2.5,
  };
  
  const modifierCounts = {
    common: 0,
    uncommon: 1,
    rare: 1,
    epic: 2,
    legendary: 3,
  };
  
  const spell = _generator.generateRandom({
    powerLevel: rarityMultipliers[rarity] || 1.0,
  });
  
  // Add rarity metadata
  spell.rarity = rarity;
  
  return spell;
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  generatedSpellToConfig,
  configToGeneratorFormat,
  saveGeneratedSpell,
  getSpellLibrary,
  getGeneratedSpell,
  deleteGeneratedSpell,
  getAllGeneratedSpells,
  createEmitterFromGeneratedSpell,
  quickGenerateSpell,
  generateCombinedSpell,
  generateLootSpell,
};
