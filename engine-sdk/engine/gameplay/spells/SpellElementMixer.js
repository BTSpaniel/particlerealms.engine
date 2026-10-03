// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * SpellElementMixer.js - Element Combination System
 * 
 * Handles mixing two or more elements to create combined/hybrid elements:
 * - Fire + Ice = Steam
 * - Fire + Nature = Ash
 * - Lightning + Water = Electrified
 * - etc.
 * 
 * Combined elements have unique visual effects and status effects.
 */

import { SPELL_ELEMENTS } from './SpellGenerator.js';

// ============================================================================
// ELEMENT COMBINATION RULES
// ============================================================================

export const ELEMENT_COMBINATIONS = {
  // Fire combinations
  'fire+ice': {
    id: 'steam',
    name: 'Steam',
    icon: '♨️',
    colors: {
      primary: [0.9, 0.9, 0.95],
      secondary: [0.7, 0.8, 0.9],
      tertiary: [0.5, 0.6, 0.7],
    },
    effects: ['scald', 'obscure'],
    baseDamageType: 'steam',
    particleEffect: 'smoke',
    soundHint: 'steam_hiss',
    description: 'Scalding vapor that obscures vision',
  },
  
  'fire+nature': {
    id: 'ash',
    name: 'Ash',
    icon: '🌋',
    colors: {
      primary: [0.4, 0.3, 0.3],
      secondary: [1.0, 0.5, 0.2],
      tertiary: [0.2, 0.1, 0.1],
    },
    effects: ['burn', 'blind', 'wither'],
    baseDamageType: 'fire',
    particleEffect: 'smoke',
    soundHint: 'fire_crackle',
    description: 'Choking ash and embers',
  },
  
  'fire+lightning': {
    id: 'plasma',
    name: 'Plasma',
    icon: '⚡🔥',
    colors: {
      primary: [1.0, 0.8, 1.0],
      secondary: [1.0, 0.5, 0.8],
      tertiary: [0.8, 0.2, 0.5],
    },
    effects: ['burn', 'shock', 'disintegrate'],
    baseDamageType: 'plasma',
    particleEffect: 'lightning',
    soundHint: 'plasma_buzz',
    description: 'Superheated ionized matter',
  },
  
  'fire+arcane': {
    id: 'hellfire',
    name: 'Hellfire',
    icon: '🔥🔮',
    colors: {
      primary: [0.8, 0.2, 1.0],
      secondary: [1.0, 0.4, 0.6],
      tertiary: [0.4, 0.0, 0.3],
    },
    effects: ['burn', 'curse', 'soul_burn'],
    baseDamageType: 'hellfire',
    particleEffect: 'fireball',
    soundHint: 'hellfire_roar',
    description: 'Unnatural flames that burn the soul',
  },
  
  'fire+dark': {
    id: 'shadowflame',
    name: 'Shadowflame',
    icon: '🔥🌑',
    colors: {
      primary: [0.3, 0.0, 0.1],
      secondary: [1.0, 0.3, 0.0],
      tertiary: [0.1, 0.0, 0.05],
    },
    effects: ['burn', 'fear', 'darkness'],
    baseDamageType: 'shadowfire',
    particleEffect: 'fireball',
    soundHint: 'shadow_burn',
    description: 'Dark flames that consume light',
  },
  
  'fire+holy': {
    id: 'radiance',
    name: 'Radiance',
    icon: '🔥✨',
    colors: {
      primary: [1.0, 0.95, 0.8],
      secondary: [1.0, 0.8, 0.4],
      tertiary: [1.0, 1.0, 1.0],
    },
    effects: ['burn', 'purify', 'blind'],
    baseDamageType: 'radiant',
    particleEffect: 'heal',
    soundHint: 'radiant_burst',
    description: 'Purifying flames of divine light',
  },
  
  // Ice combinations
  'ice+nature': {
    id: 'permafrost',
    name: 'Permafrost',
    icon: '❄️🌿',
    colors: {
      primary: [0.7, 0.9, 0.8],
      secondary: [0.9, 1.0, 0.95],
      tertiary: [0.4, 0.6, 0.5],
    },
    effects: ['freeze', 'root', 'slow'],
    baseDamageType: 'cold',
    particleEffect: 'ice',
    soundHint: 'ice_grow',
    description: 'Eternal ice that entangles',
  },
  
  'ice+lightning': {
    id: 'frostshock',
    name: 'Frostshock',
    icon: '❄️⚡',
    colors: {
      primary: [0.6, 0.9, 1.0],
      secondary: [1.0, 1.0, 1.0],
      tertiary: [0.3, 0.5, 0.9],
    },
    effects: ['freeze', 'shock', 'shatter'],
    baseDamageType: 'frostlightning',
    particleEffect: 'lightning',
    soundHint: 'frost_crack',
    description: 'Freezing electrical discharge',
  },
  
  'ice+arcane': {
    id: 'voidice',
    name: 'Void Ice',
    icon: '❄️🔮',
    colors: {
      primary: [0.4, 0.5, 0.8],
      secondary: [0.7, 0.8, 1.0],
      tertiary: [0.2, 0.1, 0.4],
    },
    effects: ['freeze', 'slow_time', 'silence'],
    baseDamageType: 'voidcold',
    particleEffect: 'arcane',
    soundHint: 'void_freeze',
    description: 'Ice from beyond reality',
  },
  
  'ice+dark': {
    id: 'netherfrost',
    name: 'Netherfrost',
    icon: '❄️🌑',
    colors: {
      primary: [0.2, 0.3, 0.5],
      secondary: [0.5, 0.6, 0.8],
      tertiary: [0.05, 0.05, 0.1],
    },
    effects: ['freeze', 'drain', 'despair'],
    baseDamageType: 'nethercold',
    particleEffect: 'vortex',
    soundHint: 'nether_chill',
    description: 'Soul-numbing cold from the void',
  },
  
  'ice+holy': {
    id: 'crystalLight',
    name: 'Crystal Light',
    icon: '❄️✨',
    colors: {
      primary: [0.9, 0.95, 1.0],
      secondary: [1.0, 1.0, 1.0],
      tertiary: [0.8, 0.9, 1.0],
    },
    effects: ['freeze', 'purify', 'illuminate'],
    baseDamageType: 'holyice',
    particleEffect: 'ice',
    soundHint: 'crystal_chime',
    description: 'Brilliant frozen light',
  },
  
  // Lightning combinations
  'lightning+nature': {
    id: 'stormvine',
    name: 'Stormvine',
    icon: '⚡🌿',
    colors: {
      primary: [0.5, 0.9, 0.4],
      secondary: [0.9, 1.0, 0.5],
      tertiary: [0.3, 0.7, 0.3],
    },
    effects: ['shock', 'root', 'energize'],
    baseDamageType: 'stormnature',
    particleEffect: 'lightning',
    soundHint: 'storm_grow',
    description: 'Living lightning vines',
  },
  
  'lightning+arcane': {
    id: 'arcanestorm',
    name: 'Arcane Storm',
    icon: '⚡🔮',
    colors: {
      primary: [0.7, 0.5, 1.0],
      secondary: [1.0, 0.8, 1.0],
      tertiary: [0.4, 0.2, 0.8],
    },
    effects: ['shock', 'dispel', 'mana_burn'],
    baseDamageType: 'arcanelightning',
    particleEffect: 'arcane',
    soundHint: 'arcane_thunder',
    description: 'Magic-infused electrical storm',
  },
  
  'lightning+dark': {
    id: 'darkbolt',
    name: 'Dark Bolt',
    icon: '⚡🌑',
    colors: {
      primary: [0.3, 0.0, 0.4],
      secondary: [0.8, 0.4, 1.0],
      tertiary: [0.1, 0.0, 0.2],
    },
    effects: ['shock', 'fear', 'paralyze'],
    baseDamageType: 'darklightning',
    particleEffect: 'vortex',
    soundHint: 'dark_crackle',
    description: 'Lightning from the shadow realm',
  },
  
  'lightning+holy': {
    id: 'divineStrike',
    name: 'Divine Strike',
    icon: '⚡✨',
    colors: {
      primary: [1.0, 1.0, 0.8],
      secondary: [1.0, 1.0, 1.0],
      tertiary: [1.0, 0.9, 0.5],
    },
    effects: ['shock', 'smite', 'stun'],
    baseDamageType: 'holylightning',
    particleEffect: 'lightning',
    soundHint: 'divine_thunder',
    description: 'Righteous thunderbolt',
  },
  
  // Arcane combinations
  'arcane+nature': {
    id: 'feymagic',
    name: 'Fey Magic',
    icon: '🔮🌿',
    colors: {
      primary: [0.5, 0.9, 0.7],
      secondary: [0.8, 1.0, 0.9],
      tertiary: [0.3, 0.7, 0.5],
    },
    effects: ['charm', 'heal', 'polymorph'],
    baseDamageType: 'fey',
    particleEffect: 'heal',
    soundHint: 'fairy_bells',
    description: 'Whimsical nature magic',
  },
  
  'arcane+dark': {
    id: 'voidmagic',
    name: 'Void Magic',
    icon: '🔮🌑',
    colors: {
      primary: [0.1, 0.0, 0.2],
      secondary: [0.5, 0.2, 0.8],
      tertiary: [0.0, 0.0, 0.05],
    },
    effects: ['banish', 'drain', 'warp'],
    baseDamageType: 'void',
    particleEffect: 'vortex',
    soundHint: 'void_whisper',
    description: 'Magic from the spaces between',
  },
  
  'arcane+holy': {
    id: 'celestial',
    name: 'Celestial',
    icon: '🔮✨',
    colors: {
      primary: [0.9, 0.85, 1.0],
      secondary: [1.0, 1.0, 1.0],
      tertiary: [0.7, 0.6, 0.9],
    },
    effects: ['bless', 'dispel', 'enlighten'],
    baseDamageType: 'celestial',
    particleEffect: 'arcane',
    soundHint: 'celestial_harmony',
    description: 'Pure cosmic energy',
  },
  
  // Nature combinations
  'nature+dark': {
    id: 'blight',
    name: 'Blight',
    icon: '🌿🌑',
    colors: {
      primary: [0.3, 0.4, 0.2],
      secondary: [0.5, 0.3, 0.4],
      tertiary: [0.1, 0.15, 0.05],
    },
    effects: ['poison', 'wither', 'corrupt'],
    baseDamageType: 'blight',
    particleEffect: 'smoke',
    soundHint: 'decay_spread',
    description: 'Corrupted nature that decays',
  },
  
  'nature+holy': {
    id: 'lifebless',
    name: 'Life Blessing',
    icon: '🌿✨',
    colors: {
      primary: [0.6, 1.0, 0.6],
      secondary: [1.0, 1.0, 0.9],
      tertiary: [0.4, 0.9, 0.4],
    },
    effects: ['heal', 'regen', 'cleanse', 'revive'],
    baseDamageType: 'life',
    particleEffect: 'heal',
    soundHint: 'life_bloom',
    description: 'Sacred life energy',
  },
  
  // Dark + Holy
  'dark+holy': {
    id: 'twilight',
    name: 'Twilight',
    icon: '🌑✨',
    colors: {
      primary: [0.5, 0.4, 0.6],
      secondary: [0.8, 0.7, 0.9],
      tertiary: [0.3, 0.2, 0.4],
    },
    effects: ['balance', 'phase', 'duality'],
    baseDamageType: 'twilight',
    particleEffect: 'arcane',
    soundHint: 'twilight_hum',
    description: 'Balance of light and dark',
  },
};

// ============================================================================
// ELEMENT MIXER CLASS
// ============================================================================

export class SpellElementMixer {
  constructor() {
    this._combinationCache = new Map();
    this._buildCache();
  }

  /**
   * Build combination lookup cache
   */
  _buildCache() {
    for (const [key, combo] of Object.entries(ELEMENT_COMBINATIONS)) {
      this._combinationCache.set(key, combo);
      
      // Also add reverse order
      const [a, b] = key.split('+');
      const reverseKey = `${b}+${a}`;
      this._combinationCache.set(reverseKey, combo);
    }
  }

  /**
   * Mix two elements
   * @returns Combined element data or null if no combination exists
   */
  mix(element1, element2) {
    if (element1 === element2) {
      // Same element - return enhanced version
      return this._enhanceElement(element1);
    }

    const key = `${element1}+${element2}`;
    const combo = this._combinationCache.get(key);
    
    if (combo) {
      return { ...combo, sourceElements: [element1, element2] };
    }

    // No predefined combination - create a blend
    return this._createBlend(element1, element2);
  }

  /**
   * Enhance a single element (double casting)
   */
  _enhanceElement(elementId) {
    const element = SPELL_ELEMENTS[elementId];
    if (!element) return null;

    return {
      id: `enhanced_${elementId}`,
      name: `Enhanced ${element.name}`,
      icon: `${element.icon}${element.icon}`,
      colors: {
        primary: element.colors.primary.map(c => Math.min(1, c * 1.2)),
        secondary: element.colors.secondary,
        tertiary: element.colors.tertiary.map(c => Math.min(1, c * 1.3)),
      },
      effects: [...element.effects, 'empowered'],
      baseDamageType: element.baseDamageType,
      particleEffect: element.particleEffect,
      soundHint: element.soundHint,
      description: `Intensified ${element.name.toLowerCase()} magic`,
      sourceElements: [elementId],
      enhanced: true,
    };
  }

  /**
   * Create a generic blend for undefined combinations
   */
  _createBlend(element1Id, element2Id) {
    const e1 = SPELL_ELEMENTS[element1Id];
    const e2 = SPELL_ELEMENTS[element2Id];
    
    if (!e1 || !e2) return null;

    // Blend colors
    const blendColor = (c1, c2, ratio = 0.5) => [
      c1[0] * ratio + c2[0] * (1 - ratio),
      c1[1] * ratio + c2[1] * (1 - ratio),
      c1[2] * ratio + c2[2] * (1 - ratio),
    ];

    return {
      id: `blend_${element1Id}_${element2Id}`,
      name: `${e1.name}-${e2.name}`,
      icon: `${e1.icon}${e2.icon}`,
      colors: {
        primary: blendColor(e1.colors.primary, e2.colors.primary),
        secondary: blendColor(e1.colors.secondary, e2.colors.secondary),
        tertiary: blendColor(e1.colors.tertiary, e2.colors.tertiary),
      },
      effects: [...new Set([...e1.effects, ...e2.effects])],
      baseDamageType: 'mixed',
      particleEffect: e1.particleEffect,
      soundHint: e1.soundHint,
      description: `A blend of ${e1.name.toLowerCase()} and ${e2.name.toLowerCase()}`,
      sourceElements: [element1Id, element2Id],
      isBlend: true,
    };
  }

  /**
   * Mix multiple elements (3+)
   */
  mixMultiple(elements) {
    if (elements.length === 0) return null;
    if (elements.length === 1) return this._enhanceElement(elements[0]);
    if (elements.length === 2) return this.mix(elements[0], elements[1]);

    // Mix first two, then mix with remaining
    let result = this.mix(elements[0], elements[1]);
    
    for (let i = 2; i < elements.length; i++) {
      const nextElement = elements[i];
      const nextData = SPELL_ELEMENTS[nextElement];
      
      if (!result || !nextData) continue;

      // Blend colors further
      result.colors.primary = result.colors.primary.map((c, j) => 
        (c + nextData.colors.primary[j]) / 2
      );
      result.colors.secondary = result.colors.secondary.map((c, j) => 
        (c + nextData.colors.secondary[j]) / 2
      );
      
      // Combine effects
      result.effects = [...new Set([...result.effects, ...nextData.effects])];
      
      // Update name and icon
      result.name = `${result.name}-${nextData.name}`;
      result.icon = `${result.icon}${nextData.icon}`;
      result.sourceElements.push(nextElement);
    }

    return result;
  }

  /**
   * Get all possible combinations for an element
   */
  getCombinationsFor(elementId) {
    const results = [];
    
    for (const [key, combo] of Object.entries(ELEMENT_COMBINATIONS)) {
      if (key.includes(elementId)) {
        results.push(combo);
      }
    }
    
    return results;
  }

  /**
   * Get all available combinations
   */
  getAllCombinations() {
    return Object.values(ELEMENT_COMBINATIONS);
  }

  /**
   * Check if two elements can combine
   */
  canCombine(element1, element2) {
    const key = `${element1}+${element2}`;
    return this._combinationCache.has(key) || element1 === element2;
  }

  /**
   * Get combination info without creating
   */
  getCombinationInfo(element1, element2) {
    if (element1 === element2) {
      return {
        type: 'enhanced',
        name: `Enhanced ${SPELL_ELEMENTS[element1]?.name || element1}`,
      };
    }

    const key = `${element1}+${element2}`;
    const combo = this._combinationCache.get(key);
    
    if (combo) {
      return {
        type: 'combination',
        name: combo.name,
        description: combo.description,
      };
    }

    return {
      type: 'blend',
      name: `${SPELL_ELEMENTS[element1]?.name || element1}-${SPELL_ELEMENTS[element2]?.name || element2}`,
    };
  }
}

// ============================================================================
// SINGLETON & EXPORTS
// ============================================================================

let _instance = null;

export function getSpellElementMixer() {
  if (!_instance) {
    _instance = new SpellElementMixer();
  }
  return _instance;
}

export function mixElements(element1, element2) {
  return getSpellElementMixer().mix(element1, element2);
}

export function mixMultipleElements(elements) {
  return getSpellElementMixer().mixMultiple(elements);
}

export default {
  SpellElementMixer,
  ELEMENT_COMBINATIONS,
  getSpellElementMixer,
  mixElements,
  mixMultipleElements,
};
