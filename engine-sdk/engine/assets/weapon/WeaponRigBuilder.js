// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// engine/assets/weapon/WeaponRigBuilder.js — assemble a WeaponRig from a model:
// detect sockets + moving parts + forward/muzzle, attach default fire/reload
// timelines and a state machine seed, and flag needsCorrection when required
// sockets are missing. Attaches at model.rigs.weapon. GAME ABSTRACTION ONLY.

import { createWeaponRig, WEAPON_TYPE } from './WeaponRig.js';
import { detectWeapon } from './WeaponSocketDetector.js';
import { defaultFireAction, defaultReloadAction } from './WeaponTimeline.js';

// Sensible per-type gameplay defaults (anchors, not real specs).
const TYPE_DEFAULTS = {
  [WEAPON_TYPE.PISTOL]: { fireMode: 'semi', capacity: 15, fire: 0.10, reload: 1.8 },
  [WEAPON_TYPE.REVOLVER]: { fireMode: 'semi', capacity: 6, fire: 0.12, reload: 2.6 },
  [WEAPON_TYPE.RIFLE]: { fireMode: 'auto', capacity: 30, fire: 0.09, reload: 2.2 },
  [WEAPON_TYPE.SMG]: { fireMode: 'auto', capacity: 30, fire: 0.06, reload: 2.0 },
  [WEAPON_TYPE.SHOTGUN]: { fireMode: 'pump', capacity: 8, fire: 0.6, reload: 3.2 },
  [WEAPON_TYPE.UNKNOWN]: { fireMode: 'semi', capacity: 12, fire: 0.12, reload: 2.0 },
};

/**
 * Build a weapon rig and attach it at model.rigs.weapon.
 * @param {object} model EngineModel
 * @param {object} [opts]
 * @returns {object} the WeaponRig
 */
export function buildWeaponRig(model, opts = {}) {
  const det = detectWeapon(model);
  const d = TYPE_DEFAULTS[det.type] || TYPE_DEFAULTS[WEAPON_TYPE.UNKNOWN];

  const rig = createWeaponRig({
    type: det.type,
    sockets: det.sockets,
    movingParts: det.movingParts,
    forwardAxis: det.forwardAxis,
    muzzleNode: det.muzzleNode,
    barrelLength: det.barrelLength,
    fireMode: opts.fireMode ?? d.fireMode,
    magazineCapacity: opts.capacity ?? d.capacity,
    timeline: {
      fire: defaultFireAction(opts.fireTime ?? d.fire),
      reload: defaultReloadAction(opts.reloadTime ?? d.reload),
    },
    source: 'name',
    confidence: det.confidence,
    needsCorrection: det.missing.length > 0,
    unmapped: det.unmapped,
    missing: det.missing,
    metadata: { socketCount: Object.keys(det.sockets).length, partCount: det.movingParts.length },
  });

  model.rigs.weapon = rig;
  model.metadata.weapon = {
    type: det.type, sockets: Object.keys(det.sockets).length,
    parts: det.movingParts.length, confidence: det.confidence, needsCorrection: rig.needsCorrection,
  };
  return rig;
}
