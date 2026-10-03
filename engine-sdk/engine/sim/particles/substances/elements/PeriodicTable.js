// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * PeriodicTable.js — Full periodic table data for 118 elements.
 *
 * Re-export of the core element data from ParticleElementTable.js.
 * This file lives in the new substances/elements/ folder for organizational clarity.
 * The original ParticleElementTable.js remains functional and re-exports from here
 * for backward compatibility.
 *
 * Provides:
 *   - ELEMENT_DATA raw array
 *   - ELEMENTS_BY_Z / ELEMENTS_BY_SYMBOL parsed lookups
 *   - getElement, getElementBySymbol, getAllElements
 *   - ELEMENTS shorthand constants
 *   - ljMixingRule for LJ cross-interactions
 *   - GPU buffer creation (createElementTable, etc.)
 */

export {
  getElement,
  getElementBySymbol,
  getAllElements,
  ELEMENTS,
  ljMixingRule,
  createElementTable,
  setParticleElements,
  setParticleCharges,
  destroyElementTable,
  ELEMENT_LUT_WGSL,
} from '../../ParticleElementTable.js';
