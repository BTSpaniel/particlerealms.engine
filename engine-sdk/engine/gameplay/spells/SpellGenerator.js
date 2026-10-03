// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * SpellGenerator.js - Procedural Spell Creation System
 * 
 * Generates complete spells from parameters:
 * - Element (Fire, Ice, Lightning, Arcane, Nature, Dark, Holy)
 * - Type (Projectile, AOE, Beam, Shield, Buff, Summon)
 * - Modifiers (Homing, Piercing, Explosive, Chain, etc.)
 * - Power level for stat scaling
 * 
 * Outputs:
 * - Visual effect (uses CustomParticleEffect SDF)
 * - Collision shape (same SDF as visual)
 * - Particle emitter config
 * - Game stats (damage, mana cost, cooldown)
 * - Sound effect hints
 * 
 * MULTIPLAYER: All generation is deterministic via seeded RNG.
 * Never use Math.random() or Date.now() for gameplay-affecting values.
 */

import {
  legacySeedCharEffectXorHash32,
  legacySeedCharXorHash32,
} from '../../core/math/MathBits.js';
import { EFFECT_PRESETS, createEffect } from '../../render/particles/CustomParticleEffect.js';

// ============================================================================
// DETERMINISTIC ID GENERATION (Multiplayer-safe)
// ============================================================================

let _globalIdCounter = 0;

export function spellDeterministicIdHash(element, seed) {
  return legacySeedCharXorHash32(seed, element.charCodeAt(0));
}

export function spellParticleEffectHash(elementId, seed) {
  return legacySeedCharEffectXorHash32(seed, elementId.charCodeAt(0));
}

/**
 * Generate a deterministic spell ID from seed
 * Safe for multiplayer - same seed produces same ID
 */
function generateDeterministicId(element, type, seed) {
  // Use seed-based hash instead of Date.now()
  const hash = spellDeterministicIdHash(element, seed);
  return `spell_${element}_${type}_${hash.toString(16)}_${_globalIdCounter++}`;
}

// ============================================================================
// SPELL ELEMENTS
// ============================================================================

export const SPELL_ELEMENTS = {
  fire: {
    id: 'fire',
    name: 'Fire',
    icon: '🔥',
    colors: {
      primary: [1.0, 0.4, 0.0],
      secondary: [1.0, 0.9, 0.2],
      tertiary: [1.0, 0.1, 0.0],
    },
    effects: ['burn', 'ignite'],
    baseDamageType: 'fire',
    particleEffect: 'fireball',
    soundHint: 'fire_whoosh',
  },
  
  ice: {
    id: 'ice',
    name: 'Ice',
    icon: '❄️',
    colors: {
      primary: [0.6, 0.85, 1.0],
      secondary: [1.0, 1.0, 1.0],
      tertiary: [0.3, 0.5, 0.9],
    },
    effects: ['slow', 'freeze'],
    baseDamageType: 'cold',
    particleEffect: 'ice',
    soundHint: 'ice_crack',
  },
  
  lightning: {
    id: 'lightning',
    name: 'Lightning',
    icon: '⚡',
    colors: {
      primary: [1.0, 1.0, 0.3],
      secondary: [1.0, 1.0, 1.0],
      tertiary: [0.3, 0.8, 1.0],
    },
    effects: ['shock', 'stun'],
    baseDamageType: 'lightning',
    particleEffect: 'lightning',
    soundHint: 'thunder_crack',
  },
  
  arcane: {
    id: 'arcane',
    name: 'Arcane',
    icon: '🔮',
    colors: {
      primary: [0.6, 0.2, 1.0],
      secondary: [0.9, 0.6, 1.0],
      tertiary: [0.2, 0.8, 1.0],
    },
    effects: ['dispel', 'silence'],
    baseDamageType: 'arcane',
    particleEffect: 'arcane',
    soundHint: 'magic_pulse',
  },
  
  nature: {
    id: 'nature',
    name: 'Nature',
    icon: '🌿',
    colors: {
      primary: [0.2, 0.9, 0.3],
      secondary: [0.8, 1.0, 0.4],
      tertiary: [0.1, 0.6, 0.2],
    },
    effects: ['heal', 'regen', 'poison'],
    baseDamageType: 'nature',
    particleEffect: 'heal',
    soundHint: 'nature_grow',
  },
  
  dark: {
    id: 'dark',
    name: 'Dark',
    icon: '🌑',
    colors: {
      primary: [0.3, 0.0, 0.4],
      secondary: [0.6, 0.0, 0.8],
      tertiary: [0.1, 0.0, 0.1],
    },
    effects: ['drain', 'fear', 'corrupt'],
    baseDamageType: 'shadow',
    particleEffect: 'vortex',
    soundHint: 'dark_whisper',
  },
  
  holy: {
    id: 'holy',
    name: 'Holy',
    icon: '✨',
    colors: {
      primary: [1.0, 0.95, 0.7],
      secondary: [1.0, 1.0, 1.0],
      tertiary: [1.0, 0.85, 0.4],
    },
    effects: ['purify', 'bless', 'smite'],
    baseDamageType: 'holy',
    particleEffect: 'heal',
    soundHint: 'holy_choir',
  },
};

// ============================================================================
// SPELL TYPES
// ============================================================================

export const SPELL_TYPES = {
  projectile: {
    id: 'projectile',
    name: 'Projectile',
    icon: '➡️',
    hasTrajectory: true,
    hasImpact: true,
    baseSpeed: 30,
    baseDamage: 20,
    baseManaCost: 15,
    baseCooldown: 1.0,
    particleCount: 50,
    sdfBase: 'sphere',
  },
  
  aoe: {
    id: 'aoe',
    name: 'Area of Effect',
    icon: '⭕',
    hasTrajectory: false,
    groundBased: true,
    baseRadius: 5,
    baseDamage: 10,
    baseManaCost: 30,
    baseCooldown: 8.0,
    baseDuration: 4.0,
    particleCount: 80,
    sdfBase: 'vortex',
  },
  
  beam: {
    id: 'beam',
    name: 'Beam',
    icon: '📡',
    hasTrajectory: true,
    continuous: true,
    baseLength: 15,
    baseDamagePerSecond: 30,
    baseManaCostPerSecond: 10,
    baseCooldown: 0.5,
    particleCount: 100,
    sdfBase: 'lightning',
  },
  
  shield: {
    id: 'shield',
    name: 'Shield',
    icon: '🛡️',
    hasTrajectory: false,
    defensive: true,
    baseAbsorption: 100,
    baseManaCost: 40,
    baseCooldown: 15.0,
    baseDuration: 5.0,
    particleCount: 60,
    sdfBase: 'shield',
  },
  
  buff: {
    id: 'buff',
    name: 'Buff',
    icon: '⬆️',
    hasTrajectory: false,
    selfTarget: true,
    baseBoost: 0.25,
    baseManaCost: 25,
    baseCooldown: 20.0,
    baseDuration: 10.0,
    particleCount: 40,
    sdfBase: 'heal',
  },
  
  summon: {
    id: 'summon',
    name: 'Summon',
    icon: '👻',
    hasTrajectory: false,
    createEntity: true,
    baseDamage: 15,
    baseHealth: 50,
    baseManaCost: 50,
    baseCooldown: 30.0,
    baseDuration: 20.0,
    particleCount: 70,
    sdfBase: 'arcane',
  },
};

// ============================================================================
// SPELL MODIFIERS
// ============================================================================

export const SPELL_MODIFIERS = {
  homing: {
    id: 'homing',
    name: 'Homing',
    icon: '🎯',
    description: 'Seeks nearest target',
    manaCostMult: 1.3,
    damageMult: 0.9,
    speedMult: 0.8,
    validTypes: ['projectile'],
  },
  
  piercing: {
    id: 'piercing',
    name: 'Piercing',
    icon: '🗡️',
    description: 'Passes through enemies',
    manaCostMult: 1.4,
    damageMult: 0.7,
    maxTargets: 3,
    validTypes: ['projectile', 'beam'],
  },
  
  explosive: {
    id: 'explosive',
    name: 'Explosive',
    icon: '💥',
    description: 'Explodes on impact',
    manaCostMult: 1.5,
    damageMult: 0.8,
    aoeRadius: 3,
    validTypes: ['projectile'],
  },
  
  chain: {
    id: 'chain',
    name: 'Chain',
    icon: '⛓️',
    description: 'Jumps to nearby targets',
    manaCostMult: 1.6,
    damageMult: 0.6,
    maxChains: 3,
    chainRange: 5,
    validTypes: ['projectile', 'lightning'],
  },
  
  rapid: {
    id: 'rapid',
    name: 'Rapid',
    icon: '⚡',
    description: 'Faster cast and cooldown',
    manaCostMult: 0.7,
    damageMult: 0.6,
    cooldownMult: 0.4,
    validTypes: ['projectile', 'beam'],
  },
  
  heavy: {
    id: 'heavy',
    name: 'Heavy',
    icon: '🔨',
    description: 'Slow but powerful',
    manaCostMult: 1.8,
    damageMult: 2.0,
    speedMult: 0.5,
    cooldownMult: 1.5,
    validTypes: ['projectile', 'aoe'],
  },
  
  lingering: {
    id: 'lingering',
    name: 'Lingering',
    icon: '⏳',
    description: 'Extended duration',
    manaCostMult: 1.4,
    durationMult: 2.0,
    validTypes: ['aoe', 'buff', 'shield'],
  },
  
  vampiric: {
    id: 'vampiric',
    name: 'Vampiric',
    icon: '🧛',
    description: 'Heals on damage dealt',
    manaCostMult: 1.5,
    damageMult: 0.9,
    lifeSteal: 0.2,
    validTypes: ['projectile', 'beam', 'aoe'],
  },
};

// ============================================================================
// SPELL GENERATOR
// ============================================================================

export class SpellGenerator {
  constructor(options = {}) {
    this._seed = options.seed || Date.now();
    this._rng = this._createRNG(this._seed);
  }

  /**
   * Create seeded RNG
   */
  _createRNG(seed) {
    let s = seed;
    return () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
  }

  /**
   * Generate a complete spell from parameters
   */
  generate(params) {
    const {
      element = 'fire',
      type = 'projectile',
      modifiers = [],
      powerLevel = 1.0,
      name = null,
      seed = null,
    } = params;

    // Reset RNG if seed provided
    if (seed !== null) {
      this._rng = this._createRNG(seed);
    }

    const elementData = SPELL_ELEMENTS[element] || SPELL_ELEMENTS.fire;
    const typeData = SPELL_TYPES[type] || SPELL_TYPES.projectile;
    
    // Calculate stats with modifiers
    const stats = this._calculateStats(elementData, typeData, modifiers, powerLevel);
    
    // Generate particle effect
    const particleEffect = this._generateParticleEffect(elementData, typeData, modifiers);
    
    // Generate particle emitter config
    const emitterConfig = this._generateEmitterConfig(elementData, typeData, stats);
    
    // Generate spell name if not provided
    const spellName = name || this._generateName(elementData, typeData, modifiers);
    
    // Generate deterministic ID (multiplayer-safe)
    const id = generateDeterministicId(element, type, this._seed);

    return {
      id,
      name: spellName,
      element: elementData.id,
      type: typeData.id,
      modifiers: modifiers.map(m => typeof m === 'string' ? m : m.id),
      powerLevel,
      
      // Stats
      stats,
      
      // Visual
      particleEffect,
      emitterConfig,
      colors: elementData.colors,
      icon: `${elementData.icon}${typeData.icon}`,
      
      // Audio
      soundHint: elementData.soundHint,
      
      // Metadata (seed for deterministic regeneration)
      seed: this._seed,
    };
  }

  /**
   * Calculate spell stats
   */
  _calculateStats(element, type, modifiers, powerLevel) {
    let stats = {
      damage: type.baseDamage || 0,
      damagePerSecond: type.baseDamagePerSecond || 0,
      manaCost: type.baseManaCost || 20,
      cooldown: type.baseCooldown || 1.0,
      duration: type.baseDuration || 0,
      speed: type.baseSpeed || 0,
      radius: type.baseRadius || 0,
      absorption: type.baseAbsorption || 0,
      boost: type.baseBoost || 0,
    };

    // Apply modifiers
    for (const modId of modifiers) {
      const mod = SPELL_MODIFIERS[modId];
      if (!mod) continue;
      
      // Check if modifier is valid for this type
      if (mod.validTypes && !mod.validTypes.includes(type.id)) continue;
      
      if (mod.damageMult) stats.damage *= mod.damageMult;
      if (mod.manaCostMult) stats.manaCost *= mod.manaCostMult;
      if (mod.cooldownMult) stats.cooldown *= mod.cooldownMult;
      if (mod.speedMult) stats.speed *= mod.speedMult;
      if (mod.durationMult) stats.duration *= mod.durationMult;
      
      // Add special properties
      if (mod.aoeRadius) stats.explosionRadius = mod.aoeRadius;
      if (mod.maxTargets) stats.maxTargets = mod.maxTargets;
      if (mod.maxChains) stats.maxChains = mod.maxChains;
      if (mod.chainRange) stats.chainRange = mod.chainRange;
      if (mod.lifeSteal) stats.lifeSteal = mod.lifeSteal;
    }

    // Apply power level scaling
    stats.damage *= powerLevel;
    stats.damagePerSecond *= powerLevel;
    stats.absorption *= powerLevel;
    stats.manaCost *= Math.sqrt(powerLevel);
    
    // Add element effects
    stats.damageType = element.baseDamageType;
    stats.statusEffects = [...element.effects];

    // Round values
    stats.damage = Math.round(stats.damage);
    stats.damagePerSecond = Math.round(stats.damagePerSecond);
    stats.manaCost = Math.round(stats.manaCost);
    stats.cooldown = Math.round(stats.cooldown * 10) / 10;
    stats.absorption = Math.round(stats.absorption);

    return stats;
  }

  /**
   * Generate particle effect configuration
   */
  _generateParticleEffect(element, type, modifiers) {
    const baseEffect = EFFECT_PRESETS[element.particleEffect] || EFFECT_PRESETS.sphere;
    
    // Create modified effect with deterministic ID (multiplayer-safe)
    const effectHash = spellParticleEffectHash(element.id, this._seed);
    const effect = createEffect({
      id: `generated_${element.id}_${type.id}_${effectHash.toString(16)}`,
      name: `${element.name} ${type.name}`,
      sdfCode: this._generateSDFCode(element, type, modifiers),
      colorCode: this._generateColorCode(element, type, modifiers),
    });

    return effect;
  }

  /**
   * Generate SDF code based on spell type
   */
  _generateSDFCode(element, type, modifiers) {
    const basePreset = EFFECT_PRESETS[element.particleEffect] || EFFECT_PRESETS.sphere;
    
    // Start with base SDF
    let sdfCode = basePreset.sdfCode;
    
    // Modify based on type
    if (type.id === 'beam') {
      sdfCode = /* wgsl */`
fn customSDF(p: vec3<f32>, time: f32, params: vec4<f32>) -> f32 {
  // Elongated capsule for beam
  let elongation = params.w + 2.0;
  let stretched = vec3(p.x, p.y, p.z / elongation);
  let noise = sin(p.z * 8.0 + time * 10.0) * 0.05;
  return sdCapsule(stretched, vec3(0.0, 0.0, -0.5), vec3(0.0, 0.0, 0.5), 0.3) - noise;
}`;
    } else if (type.id === 'shield') {
      sdfCode = /* wgsl */`
fn customSDF(p: vec3<f32>, time: f32, params: vec4<f32>) -> f32 {
  let thickness = 0.08;
  let pulse = sin(time * 2.0) * 0.02;
  let outer = sdSphere(p, 1.0 + pulse);
  let inner = sdSphere(p, 1.0 - thickness + pulse);
  return max(outer, -inner);
}`;
    } else if (type.id === 'aoe') {
      sdfCode = /* wgsl */`
fn customSDF(p: vec3<f32>, time: f32, params: vec4<f32>) -> f32 {
  // Flat disk with swirling edge
  let angle = atan2(p.z, p.x);
  let swirl = sin(angle * 6.0 - time * 3.0) * 0.1;
  let disk = sdCylinder(p, 0.1, 1.0 + swirl);
  return disk;
}`;
    }
    
    // Apply explosive modifier
    if (modifiers.includes('explosive')) {
      sdfCode = sdfCode.replace(
        'return ',
        `let explodeNoise = fbm4(p * 5.0 + time * 2.0) * 0.15;
  return `
      ).replace(/;$/, ' - explodeNoise;');
    }

    return sdfCode;
  }

  /**
   * Generate color code based on element
   */
  _generateColorCode(element, type, modifiers) {
    const primary = element.colors.primary;
    const secondary = element.colors.secondary;
    const tertiary = element.colors.tertiary;
    
    return /* wgsl */`
fn customColor(p: vec3<f32>, normal: vec3<f32>, dist: f32, time: f32, baseColor: vec4<f32>, params: vec4<f32>) -> vec4<f32> {
  let viewDir = normalize(-p);
  let fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 2.5);
  
  let primary = vec3(${primary[0].toFixed(3)}, ${primary[1].toFixed(3)}, ${primary[2].toFixed(3)});
  let secondary = vec3(${secondary[0].toFixed(3)}, ${secondary[1].toFixed(3)}, ${secondary[2].toFixed(3)});
  let tertiary = vec3(${tertiary[0].toFixed(3)}, ${tertiary[1].toFixed(3)}, ${tertiary[2].toFixed(3)});
  
  let d = length(p);
  var col = mix(secondary, primary, d);
  col = mix(col, tertiary, fresnel * 0.5);
  
  // Animated pulse
  let pulse = 0.85 + 0.15 * sin(time * 4.0 + d * 5.0);
  col *= pulse * 1.3;
  
  return vec4(col * baseColor.rgb, baseColor.a);
}`;
  }

  /**
   * Generate emitter configuration
   */
  _generateEmitterConfig(element, type, stats) {
    return {
      maxParticles: type.particleCount * 3,
      emitRate: type.particleCount,
      lifetime: type.id === 'projectile' ? [0.3, 1.0] : [0.5, 2.0],
      startSize: [0.05, 0.15],
      endSize: [0.02, 0.05],
      startColor: [...element.colors.primary, 1.0],
      endColor: [...element.colors.secondary, 0.0],
      blendMode: 'additive',
      gravity: type.id === 'projectile' ? -0.5 : 0,
      
      emitterShape: type.groundBased ? 'disk' : 'sphere',
      emitterRadius: type.groundBased ? (stats.radius || 3) : 0.2,
      
      velocity: {
        type: type.hasTrajectory ? 'cone' : 'radial',
        direction: [0, type.groundBased ? 1 : 0, type.hasTrajectory ? -1 : 0],
        spread: 0.3,
        magnitude: [0.5, 1.5],
      },
      
      trail: {
        enabled: type.hasTrajectory,
        segments: 8,
        width: 0.1,
        fadeOut: true,
      },
    };
  }

  /**
   * Generate spell name
   */
  _generateName(element, type, modifiers) {
    const prefixes = {
      homing: ['Seeking', 'Hunting', 'Tracking'],
      piercing: ['Piercing', 'Penetrating', 'Impaling'],
      explosive: ['Exploding', 'Bursting', 'Detonating'],
      chain: ['Chaining', 'Bouncing', 'Arcing'],
      rapid: ['Swift', 'Quick', 'Rapid'],
      heavy: ['Heavy', 'Massive', 'Devastating'],
      lingering: ['Lasting', 'Persistent', 'Enduring'],
      vampiric: ['Draining', 'Leeching', 'Vampiric'],
    };
    
    const elementNames = {
      fire: ['Flame', 'Fire', 'Inferno', 'Blaze'],
      ice: ['Frost', 'Ice', 'Glacier', 'Chill'],
      lightning: ['Thunder', 'Lightning', 'Storm', 'Spark'],
      arcane: ['Arcane', 'Mystic', 'Void', 'Ether'],
      nature: ['Nature', 'Life', 'Growth', 'Bloom'],
      dark: ['Shadow', 'Dark', 'Void', 'Night'],
      holy: ['Holy', 'Divine', 'Radiant', 'Sacred'],
    };
    
    const typeNames = {
      projectile: ['Bolt', 'Missile', 'Orb', 'Blast'],
      aoe: ['Storm', 'Field', 'Zone', 'Ring'],
      beam: ['Ray', 'Beam', 'Lance', 'Stream'],
      shield: ['Shield', 'Barrier', 'Ward', 'Aegis'],
      buff: ['Blessing', 'Aura', 'Enchant', 'Boon'],
      summon: ['Summon', 'Call', 'Conjure', 'Invoke'],
    };

    const parts = [];
    
    // Add modifier prefix
    for (const mod of modifiers) {
      if (prefixes[mod]) {
        parts.push(this._randomChoice(prefixes[mod]));
        break;
      }
    }
    
    // Add element name
    parts.push(this._randomChoice(elementNames[element.id] || ['Magic']));
    
    // Add type name
    parts.push(this._randomChoice(typeNames[type.id] || ['Spell']));
    
    return parts.join(' ');
  }

  /**
   * Random choice helper
   */
  _randomChoice(arr) {
    return arr[Math.floor(this._rng() * arr.length)];
  }

  /**
   * Generate a random spell
   */
  generateRandom(constraints = {}) {
    const elements = Object.keys(SPELL_ELEMENTS);
    const types = Object.keys(SPELL_TYPES);
    const modifierIds = Object.keys(SPELL_MODIFIERS);
    
    const element = constraints.element || this._randomChoice(elements);
    const type = constraints.type || this._randomChoice(types);
    
    // Pick 0-2 random modifiers
    const numMods = constraints.modifiers?.length ?? Math.floor(this._rng() * 3);
    const validMods = modifierIds.filter(m => 
      !SPELL_MODIFIERS[m].validTypes || 
      SPELL_MODIFIERS[m].validTypes.includes(type)
    );
    
    const modifiers = constraints.modifiers || [];
    while (modifiers.length < numMods && validMods.length > 0) {
      const idx = Math.floor(this._rng() * validMods.length);
      const mod = validMods.splice(idx, 1)[0];
      if (!modifiers.includes(mod)) {
        modifiers.push(mod);
      }
    }
    
    const powerLevel = constraints.powerLevel ?? (0.5 + this._rng() * 1.5);
    
    return this.generate({
      element,
      type,
      modifiers,
      powerLevel,
    });
  }

  /**
   * Generate a set of spells (e.g., for loot)
   */
  generateSet(count, constraints = {}) {
    const spells = [];
    for (let i = 0; i < count; i++) {
      spells.push(this.generateRandom(constraints));
    }
    return spells;
  }
}

// ============================================================================
// MULTIPLAYER SERIALIZATION
// ============================================================================

/**
 * Serialize spell to minimal format for network transmission
 * Only includes data needed to regenerate the spell deterministically
 */
export function serializeSpellForNetwork(spell) {
  return {
    e: spell.element,           // element (1 char key)
    t: spell.type,              // type
    m: spell.modifiers,         // modifiers array
    p: Math.round(spell.powerLevel * 100) / 100, // power (2 decimal)
    s: spell.seed,              // seed for deterministic regeneration
  };
}

/**
 * Deserialize spell from network format
 * Regenerates full spell from minimal data
 */
export function deserializeSpellFromNetwork(data) {
  const generator = new SpellGenerator({ seed: data.s });
  return generator.generate({
    element: data.e,
    type: data.t,
    modifiers: data.m,
    powerLevel: data.p,
    seed: data.s,
  });
}

/**
 * Validate spell data matches seed (anti-cheat)
 * Returns true if spell stats match what seed would generate
 */
export function validateSpellIntegrity(spell) {
  const regenerated = deserializeSpellFromNetwork(serializeSpellForNetwork(spell));
  return (
    regenerated.stats.damage === spell.stats.damage &&
    regenerated.stats.manaCost === spell.stats.manaCost &&
    regenerated.element === spell.element &&
    regenerated.type === spell.type
  );
}

// ============================================================================
// SINGLETON & FACTORY
// ============================================================================

let _instance = null;

export function getSpellGenerator() {
  if (!_instance) {
    _instance = new SpellGenerator();
  }
  return _instance;
}

export function generateSpell(params) {
  return getSpellGenerator().generate(params);
}

export function generateRandomSpell(constraints) {
  return getSpellGenerator().generateRandom(constraints);
}

export default {
  SpellGenerator,
  SPELL_ELEMENTS,
  SPELL_TYPES,
  SPELL_MODIFIERS,
  spellDeterministicIdHash,
  spellParticleEffectHash,
  getSpellGenerator,
  generateSpell,
  generateRandomSpell,
  serializeSpellForNetwork,
  deserializeSpellFromNetwork,
  validateSpellIntegrity,
};
