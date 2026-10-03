// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// engine/assets/weapon/WeaponRig.js — canonical weapon socket/part schema (spec
// §13). A weapon is a model + sockets (muzzle/chamber/grips/sight/…) + moving
// parts (slide/bolt/hammer/…) + a fire/reload timeline + a state machine. This is
// a GAME ABSTRACTION: sockets/timings are gameplay anchors, not real-firearm data.
// Every detection is a hint with confidence; ambiguous nodes go to the editor.

export const WEAPON_SOCKET = Object.freeze([
  'muzzle', 'chamber', 'barrel', 'ejectionPort', 'magazine',
  'gripPrimary', 'gripSecondary', 'trigger', 'sight', 'rail', 'stock',
]);

// Parts that animate. `axis` is the local motion axis; `motion` the kind.
export const MOVING_PART = Object.freeze({
  SLIDE: 'slide', BOLT: 'bolt', CHARGING_HANDLE: 'chargingHandle',
  HAMMER: 'hammer', TRIGGER: 'trigger', MAGAZINE: 'magazine',
  CYLINDER: 'cylinder', SAFETY: 'safety',
});

export const WEAPON_TYPE = Object.freeze({
  PISTOL: 'pistol', REVOLVER: 'revolver', RIFLE: 'rifle',
  SMG: 'smg', SHOTGUN: 'shotgun', UNKNOWN: 'unknown',
});

// Sockets a credible firearm rig should expose (drives confidence/correction).
export const REQUIRED_SOCKETS = Object.freeze(['muzzle', 'gripPrimary', 'trigger']);

/**
 * Create a weapon rig descriptor.
 * @param {object} init
 * @returns {object}
 */
export function createWeaponRig(init = {}) {
  init = init || {};
  return {
    type: init.type ?? WEAPON_TYPE.UNKNOWN,
    sockets: init.sockets ?? {},          // socket name → { nodeId, localPosition }
    movingParts: init.movingParts ?? [],  // { nodeId, motion, axis, travel }
    forwardAxis: init.forwardAxis ?? [0, 0, 1], // barrel/aim direction (local)
    muzzleNode: init.muzzleNode ?? null,
    barrelLength: init.barrelLength ?? 0,

    timeline: init.timeline ?? null,      // WeaponTimeline (fire/reload)
    fireMode: init.fireMode ?? 'semi',    // 'semi' | 'auto' | 'burst' | 'bolt' | 'pump'
    magazineCapacity: init.magazineCapacity ?? 0,

    source: init.source ?? 'name',
    confidence: init.confidence ?? 0,
    needsCorrection: init.needsCorrection ?? true,
    unmapped: init.unmapped ?? [],
    missing: init.missing ?? [],
    metadata: { ...(init.metadata || {}) },
  };
}
