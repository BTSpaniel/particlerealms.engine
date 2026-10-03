// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// engine/assets/weapon/WeaponTimeline.js — keyframed event tracks for weapon
// actions (fire, reload). An action is an ordered list of { t, type, payload }
// events over a duration; `eventsBetween` returns events crossed in a time step
// so the host fires them exactly once (deterministic, frame-rate independent).
// GAME ABSTRACTION — timings are gameplay anchors, not real mechanisms.

export const WEAPON_EVENT = Object.freeze({
  TRIGGER: 'trigger', DISCHARGE: 'discharge', MUZZLE_FLASH: 'muzzleFlash',
  EJECT: 'eject', SLIDE_BACK: 'slideBack', SLIDE_FORWARD: 'slideForward',
  MAG_OUT: 'magOut', MAG_IN: 'magIn', BOLT_RELEASE: 'boltRelease',
  HAMMER: 'hammer', RECOIL: 'recoil', SHELL_DROP: 'shellDrop', DONE: 'done',
});

/**
 * Create a single action timeline (e.g. one shot, or a reload).
 * @param {object} init { name, duration, events:[{t,type,payload?}] }
 */
export function createWeaponAction(init = {}) {
  const events = [...(init.events || [])].sort((a, b) => a.t - b.t);
  return {
    name: init.name ?? 'action',
    duration: init.duration ?? (events.length ? events[events.length - 1].t : 0),
    events,
  };
}

/** A default semi-auto fire action (normalized 0..duration seconds). */
export function defaultFireAction(duration = 0.12) {
  return createWeaponAction({
    name: 'fire', duration,
    events: [
      { t: 0.0, type: WEAPON_EVENT.TRIGGER },
      { t: 0.005, type: WEAPON_EVENT.HAMMER },
      { t: 0.01, type: WEAPON_EVENT.DISCHARGE },
      { t: 0.01, type: WEAPON_EVENT.MUZZLE_FLASH },
      { t: 0.01, type: WEAPON_EVENT.RECOIL },
      { t: 0.03, type: WEAPON_EVENT.SLIDE_BACK },
      { t: 0.05, type: WEAPON_EVENT.EJECT },
      { t: 0.06, type: WEAPON_EVENT.SHELL_DROP },
      { t: 0.09, type: WEAPON_EVENT.SLIDE_FORWARD },
      { t: duration, type: WEAPON_EVENT.DONE },
    ],
  });
}

/** A default reload action. */
export function defaultReloadAction(duration = 2.0) {
  return createWeaponAction({
    name: 'reload', duration,
    events: [
      { t: 0.0, type: WEAPON_EVENT.MAG_OUT },
      { t: duration * 0.55, type: WEAPON_EVENT.MAG_IN },
      { t: duration * 0.85, type: WEAPON_EVENT.BOLT_RELEASE },
      { t: duration, type: WEAPON_EVENT.DONE },
    ],
  });
}

/**
 * Events whose time t lies in (t0, t1]. Use with an advancing playhead so each
 * event fires exactly once regardless of frame rate.
 * @returns {object[]}
 */
export function eventsBetween(action, t0, t1) {
  if (!action) return [];
  const out = [];
  for (const e of action.events) if (e.t > t0 && e.t <= t1) out.push(e);
  return out;
}

/** A small play-once cursor over an action. */
export function createTimelinePlayer(action) {
  let t = -Infinity; let playing = false;
  return {
    get time() { return t; },
    get playing() { return playing; },
    // Start just before 0 so the first advance still crosses t=0 events.
    start() { t = -1e-6; playing = true; return this; },
    stop() { playing = false; },
    /** Advance by dt; returns the events crossed this step (empty when idle). */
    advance(dt) {
      if (!playing) return [];
      const prev = t; t += dt;
      const evs = eventsBetween(action, prev, t);
      if (t >= action.duration) playing = false;
      return evs;
    },
  };
}
