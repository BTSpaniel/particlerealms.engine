// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// engine/assets/weapon/WeaponStateMachine.js — a small, deterministic weapon state
// machine: idle ⇄ firing ⇄ empty, with reloading. It models a magazine + a
// chambered round (total = ammo + chambered) and auto-cycles a fresh round after
// each shot, so dry-fire, last-round, and reload-from-empty all behave correctly.
// GAME ABSTRACTION ONLY — no real-firearm mechanism is modelled.

export const WEAPON_STATE = Object.freeze({ IDLE: 'idle', FIRING: 'firing', RELOADING: 'reloading', EMPTY: 'empty' });
export const WEAPON_INPUT = Object.freeze({ PULL_TRIGGER: 'pullTrigger', RELEASE_TRIGGER: 'releaseTrigger', RELOAD_START: 'reloadStart', ACTION_DONE: 'actionDone' });

/**
 * @param {object} init { capacity, ammo, chambered, fireMode }
 */
export function createWeaponStateMachine(init = {}) {
  const capacity = init.capacity ?? 12;
  const fireMode = init.fireMode ?? 'semi';
  let state = WEAPON_STATE.IDLE;
  let ammo = init.ammo ?? capacity;            // rounds in the magazine
  let chambered = init.chambered ?? (ammo > 0); // a round in the chamber

  // Discharge the chambered round, then auto-cycle the next from the magazine.
  function discharge() {
    if (!chambered) return false;
    chambered = false;
    if (ammo > 0) { ammo--; chambered = true; }
    return true;
  }

  function send(input) {
    switch (state) {
      case WEAPON_STATE.IDLE:
        if (input === WEAPON_INPUT.PULL_TRIGGER) {
          if (discharge()) { state = WEAPON_STATE.FIRING; return { state, fired: true }; }
          state = WEAPON_STATE.EMPTY; return { state, fired: false, dry: true };
        }
        if (input === WEAPON_INPUT.RELOAD_START) { state = WEAPON_STATE.RELOADING; return { state }; }
        break;
      case WEAPON_STATE.FIRING:
        if (input === WEAPON_INPUT.ACTION_DONE) { state = chambered ? WEAPON_STATE.IDLE : WEAPON_STATE.EMPTY; return { state }; }
        if (input === WEAPON_INPUT.RELOAD_START) { state = WEAPON_STATE.RELOADING; return { state }; }
        break;
      case WEAPON_STATE.EMPTY:
        if (input === WEAPON_INPUT.PULL_TRIGGER) return { state, fired: false, dry: true };
        if (input === WEAPON_INPUT.RELOAD_START) { state = WEAPON_STATE.RELOADING; return { state }; }
        break;
      case WEAPON_STATE.RELOADING:
        if (input === WEAPON_INPUT.ACTION_DONE) {
          ammo = capacity;
          if (!chambered && ammo > 0) { ammo--; chambered = true; } // bolt release chambers one
          state = chambered ? WEAPON_STATE.IDLE : WEAPON_STATE.EMPTY;
          return { state };
        }
        break;
      default:
        break;
    }
    return { state };
  }

  return {
    get state() { return state; },
    get ammo() { return ammo; },
    get chambered() { return chambered; },
    get total() { return ammo + (chambered ? 1 : 0); },
    get capacity() { return capacity; },
    get fireMode() { return fireMode; },
    send,
  };
}
