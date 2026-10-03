// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Spawner Inspector Components
 */
export { createStateSelector, STATE_ICONS } from "./StateSelector.js";
export { createElementLayers, ELEMENT_ICONS, ELEMENT_COLORS } from "./ElementLayers.js";
export { createPhysicsProps } from "./PhysicsProps.js";
export { createGyroAimControl } from "./GyroAimControl.js";
export { 
  createEmitterInspectorCard,
  STATE_ICONS as EMITTER_STATE_ICONS,
  STATE_COLORS,
  ELEMENT_ICONS as EMITTER_ELEMENT_ICONS,
  ELEMENT_COLORS as EMITTER_ELEMENT_COLORS,
} from "./EmitterInspectorCard.js";

/**
 * Default element configurations for each state of matter
 */
export const STATE_ELEMENT_DEFAULTS = {
  gas: [
    { id: "fire", enabled: true, power: 0.6 },
    { id: "smoke", enabled: true, power: 0.8 },
    { id: "water", enabled: false, power: 0.0 },
    { id: "magic", enabled: false, power: 0.0 },
  ],
  liquid: [
    { id: "water", enabled: true, power: 1.0 },
    { id: "fire", enabled: false, power: 0.0 },
    { id: "smoke", enabled: false, power: 0.0 },
    { id: "magic", enabled: false, power: 0.0 },
  ],
  solid: [
    { id: "water", enabled: true, power: 0.6 },
    { id: "fire", enabled: false, power: 0.0 },
    { id: "smoke", enabled: false, power: 0.0 },
    { id: "magic", enabled: true, power: 0.2 },
  ],
  plasma: [
    { id: "fire", enabled: true, power: 0.5 },
    { id: "magic", enabled: true, power: 0.7 },
    { id: "smoke", enabled: false, power: 0.0 },
    { id: "water", enabled: false, power: 0.0 },
  ],
};

/**
 * Deep copy element defaults for a state
 */
export function getElementsForState(stateId) {
  const defaults = STATE_ELEMENT_DEFAULTS[stateId] || STATE_ELEMENT_DEFAULTS.gas;
  return defaults.map(e => ({ ...e }));
}
