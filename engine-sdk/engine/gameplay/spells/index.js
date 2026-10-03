// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Spell System Exports
 * 
 * Barrel file for easy importing of all spell-related modules.
 */

// Spell Generator
export {
  SpellGenerator,
  SPELL_ELEMENTS,
  SPELL_TYPES,
  SPELL_MODIFIERS,
  getSpellGenerator,
  generateSpell,
  generateRandomSpell,
  serializeSpellForNetwork,
  deserializeSpellFromNetwork,
  validateSpellIntegrity,
} from './SpellGenerator.js';

// Element Mixer
export {
  SpellElementMixer,
  ELEMENT_COMBINATIONS,
  getSpellElementMixer,
  mixElements,
  mixMultipleElements,
} from './SpellElementMixer.js';

// Integration with existing spell system
export {
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
} from './SpellGeneratorIntegration.js';
