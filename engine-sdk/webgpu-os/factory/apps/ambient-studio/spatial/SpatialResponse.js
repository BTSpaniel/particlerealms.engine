// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { cloneStrictJson } from '../../../../../engine/core/schema/StrictJsonValue.js';
import { applyCameraRigAction, spatialCameraRigFor, sampleSpatialCameraPath } from './SpatialCameraRig.js';

/** Bounded, persisted artistic response data. No source evaluation or GPU ownership. */
const MODES = ['flow', 'shatter', 'fabric', 'ripple', 'orbit', 'echo'];
const COEFFICIENTS = {
    flow: { swirl: 7, velocity: 3, pull: 2, depthPull: 3, waveFrequency: 8, waveAmplitude: .25 },
    shatter: { impulse: 12, depthImpulse: 8, scatter: .015, depthBias: .12, repulsion: 1, cohesionScale: .2 },
    fabric: { grab: 36, grabFalloff: .9, depthBias: .06, hoverDepth: .16 },
    ripple: { frequency: 12, speed: 8, pressAmplitude: 1.8, hoverAmplitude: .35 },
    orbit: { pullX: 5, pullY: 4, pullZ: 4, swirl: 6, hoverGain: .4, waveFrequency: 4, waveSpeed: 1, waveAmplitude: .22 },
    echo: { delay: .25, delaySpread: 1, cohorts: 12, velocity: 5, depthVelocity: 3, swirl: .8, pressDepth: .5 },
};
const AUDIO = {
    flow: { bass: .18, mid: .14, treble: .08 }, orbit: { bass: .18, mid: .14, treble: .08 },
    shatter: { bass: .08, onset: .4, onsetDepth: .15 },
    fabric: { bass: .25, treble: .015 }, ripple: { bass: .25, treble: .015 },
    echo: { mid: .07, treble: .05 },
};
export function createSpatialResponse(mode = 'ripple', { neutral = false } = {}) {
    return { version: 1, gestures: Object.fromEntries(['hover', 'press', 'click', 'dwell'].map(event => [event, {
        effect: neutral ? 'none' : 'mode', strength: neutral || event === 'dwell' || event === 'click' && mode !== 'shatter' ? 0 : 1,
    }])), click: { trigger: 'impulse', duration: .6, decay: 2 }, dwellSeconds: 1.5,
    falloff: .55, velocityScale: 3, pressureBase: .5, pressureAmount: 1,
    modes: structuredClone(COEFFICIENTS), audio: Object.fromEntries(Object.entries(AUDIO).map(([key, values]) => [key, Object.fromEntries(Object.entries(values).map(([band, amount]) => [band, neutral ? 0 : amount]))])) };
}
export const LEGACY_SPATIAL_RESPONSE = Object.freeze(createSpatialResponse());

/** Optional input calibration; absence preserves the legacy capture envelope. */
export function createSpatialAudioEnvelope(mode = 'ripple') {
    const [attack, release] = { flow: [.18, 1.2], shatter: [.015, .3], fabric: [.08, .65], ripple: [.04, .8], orbit: [.22, 1.6], echo: [.28, 1.4] }[mode] ?? [.04, .8];
    return { version: 1, freshSeconds: .5, fadeSeconds: 1.5, channels: Object.fromEntries(['bass', 'mid', 'treble', 'onset'].map(channel => [channel, {
        audioSource: channel, osSource: channel === 'onset' ? 'beat' : channel === 'treble' ? 'none' : 'energy',
        gain: 1, osGain: { bass: .45, mid: .35, treble: 0, onset: .25 }[channel],
        floor: 0, ceiling: 1, curve: 1, attack: channel === 'onset' ? Math.min(attack, .025) : attack, release: channel === 'onset' ? Math.min(release, .35) : release,
    }])) };
}
export function normalizeSpatialAudioEnvelope(value) {
    const envelope = cloneStrictJson(value, '$.audioEnvelope'), defaults = createSpatialAudioEnvelope();
    record(envelope, Object.keys(defaults), 'Audio envelope');
    if (envelope.version !== 1) throw new TypeError('Unsupported audio envelope version');
    bounded(envelope.freshSeconds, 0, 10, 'Audio fresh time'); bounded(envelope.fadeSeconds, .01, 30, 'Audio fade time');
    record(envelope.channels, Object.keys(defaults.channels), 'Audio channels');
    for (const [channel, value] of Object.entries(envelope.channels)) {
        record(value, Object.keys(defaults.channels[channel]), `Audio ${channel}`);
        if (!['none', 'bass', 'mid', 'treble', 'onset', 'energy'].includes(value.audioSource) || !['none', 'energy', 'beat'].includes(value.osSource)) throw new TypeError('Unsupported audio or OS channel mapping');
        for (const key of ['gain', 'osGain']) bounded(value[key], 0, 4, `Audio ${channel} ${key}`);
        bounded(value.floor, 0, 1, `Audio ${channel} floor`); bounded(value.ceiling, .001, 1, `Audio ${channel} ceiling`);
        if (value.ceiling <= value.floor) throw new TypeError('Audio ceiling must exceed its floor');
        bounded(value.curve, .1, 8, `Audio ${channel} curve`);
        bounded(value.attack, 0, 10, `Audio ${channel} attack`); bounded(value.release, 0, 20, `Audio ${channel} release`);
    }
    return envelope;
}

function record(value, keys, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key)) || keys.some(key => !Object.hasOwn(value, key))) throw new TypeError(`${label} requires exactly ${keys.join(', ')}`);
}
function bounded(value, min, max, label, integer = false) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || integer && !Number.isInteger(value)) throw new TypeError(`${label} must be ${integer ? 'an integer' : 'a number'} in [${min}, ${max}]`);
    return value;
}
export function normalizeSpatialResponse(value) {
    const defaults = createSpatialResponse(); record(value, Object.keys(defaults), 'Spatial response');
    if (value.version !== 1) throw new TypeError('Unsupported spatial response version');
    record(value.gestures, Object.keys(defaults.gestures), 'Response gestures');
    for (const [event, gesture] of Object.entries(value.gestures)) {
        record(gesture, ['effect', 'strength'], `${event} response`);
        if (!['none', 'mode', ...MODES].includes(gesture.effect)) throw new TypeError(`Unsupported ${event} response effect`);
        bounded(gesture.strength, 0, 4, `${event} strength`);
    }
    record(value.click, ['trigger', 'duration', 'decay'], 'Click response');
    if (!['impulse', 'pulse'].includes(value.click.trigger)) throw new TypeError('Click trigger must be impulse or pulse');
    bounded(value.click.duration, .02, 10, 'Click duration'); bounded(value.click.decay, .1, 8, 'Click decay');
    bounded(value.dwellSeconds, .05, 20, 'Dwell time'); bounded(value.falloff, .02, 4, 'Brush falloff');
    bounded(value.velocityScale, 0, 20, 'Velocity gain'); bounded(value.pressureBase, 0, 2, 'Base pressure'); bounded(value.pressureAmount, 0, 2, 'Pressure gain');
    for (const group of ['modes', 'audio']) {
        record(value[group], MODES, `Response ${group}`);
        for (const mode of MODES) {
            record(value[group][mode], Object.keys(defaults[group][mode]), `${group}.${mode}`);
            for (const [key, number] of Object.entries(value[group][mode])) bounded(number, key === 'grabFalloff' ? .02 : key === 'cohorts' ? 1 : 0, group === 'audio' ? 4 : key === 'cohorts' ? 64 : key === 'cohesionScale' ? 1 : 64, `${group}.${mode}.${key}`, key === 'cohorts');
        }
    }
    return structuredClone(value);
}

/** Scalar event envelopes; geometry picking and physical state remain in SpatialPhysics. */
export function sampleSpatialGestures(response, mode, frame, fresh, frozen = false) {
    if (frozen || frame?.suppressed) return [];
    const active = frame?.pointer?.[2] > 0, pressed = active && frame.pressed === true;
    const anchor = frame?.anchor, age = frame?.clickAge ?? (fresh ? 0 : Infinity);
    const validClick = frame?.serial > 0 && Array.isArray(anchor) && anchor.length === 2 && anchor.every(value => Number.isFinite(value) && value >= 0 && value <= 1) && Number.isFinite(age) && age >= 0 && age < response.click.duration;
    const envelopes = {
        hover: active && !pressed ? 1 : 0, press: pressed ? 1 : 0,
        dwell: active ? Math.min(1, Math.max(0, (frame.dwell ?? 0) / response.dwellSeconds)) : 0,
        click: validClick ? response.click.trigger === 'impulse' ? Number(fresh) : age < response.click.duration ? Math.pow(1 - age / response.click.duration, response.click.decay) : 0 : 0,
    };
    return Object.entries(envelopes).flatMap(([event, envelope]) => {
        const gesture = response.gestures[event], strength = gesture.strength * envelope;
        return strength > 0 && gesture.effect !== 'none' ? [{ event, effect: gesture.effect === 'mode' ? mode : gesture.effect, strength, pressed: event === 'press', impulse: event === 'click' && response.click.trigger === 'impulse' }] : [];
    });
}

export function createSpatialCameraResponse({ neutral = false } = {}) {
    return { version: 1, enabled: !neutral, modifier: 'shift', button: 'primary', sensitivityX: 120, sensitivityY: 90,
        yawLimit: 180, pitchLimit: 85, lockedYawLimit: 18, lockedPitchLimit: 12 };
}
export function normalizeSpatialCameraResponse(value) {
    record(value, Object.keys(createSpatialCameraResponse()), 'Spatial camera response');
    if (value.version !== 1 || typeof value.enabled !== 'boolean') throw new TypeError('Invalid spatial camera response version or enabled flag');
    if (!['none', 'shift', 'alt', 'ctrl', 'meta'].includes(value.modifier) || !['primary', 'secondary', 'auxiliary'].includes(value.button)) throw new TypeError('Invalid camera drag binding');
    for (const key of ['sensitivityX', 'sensitivityY']) bounded(value[key], -720, 720, `Camera ${key}`);
    for (const key of ['yawLimit', 'lockedYawLimit']) bounded(value[key], 0, 180, `Camera ${key}`);
    for (const key of ['pitchLimit', 'lockedPitchLimit']) bounded(value[key], 0, 85, `Camera ${key}`);
    return structuredClone(value);
}
/** The same pure camera update is executed by Desktop and the Studio preview lane. */
export function updateSpatialCameraGesture(settings, frame, state, frozen = false) {
    if (settings.cameraRig) return updateCameraRigGesture(settings, frame, state, frozen);
    const response = settings.cameraResponse ?? createSpatialCameraResponse();
    const mask = { primary: 1, secondary: 2, auxiliary: 4 }[response.button];
    const buttons = frame.gesture?.buttons ?? (frame.pointerState[1] > 0 ? 1 : 0);
    const orbiting = !frozen && response.enabled && frame.pointerState[0] > 0 && frame.pointerState[1] > 0 && (!settings.cameraResponse || (buttons & mask) !== 0) && (response.modifier === 'none' || frame.gesture?.[`${response.modifier}Key`] === true);
    if (!orbiting) return { yaw: state.yaw, pitch: state.pitch, start: null, orbiting: false };
    const origin = frame.clickActivity;
    const start = !state.start || state.start.serial !== frame.pointerState[3] ? { serial: frame.pointerState[3], u: origin[0], v: origin[1], yaw: state.yaw, pitch: state.pitch } : state.start;
    const yawLimit = settings.lockCamera ? response.lockedYawLimit : response.yawLimit, pitchLimit = settings.lockCamera ? response.lockedPitchLimit : response.pitchLimit;
    return { yaw: Math.max(-yawLimit, Math.min(yawLimit, start.yaw + (frame.pointer[0] - start.u) * response.sensitivityX)),
        pitch: Math.max(-pitchLimit, Math.min(pitchLimit, start.pitch + (frame.pointer[1] - start.v) * response.sensitivityY)), start, orbiting: true };
}

/** Saved source envelopes bound runtime look/movement independently of distortion. */
function updateCameraRigGesture(settings, frame, state, frozen) {
    const response = settings.cameraResponse ?? createSpatialCameraResponse(), original = settings.cameraRig;
    const time = frame.resolutionTime?.[2] ?? settings.cameraTime ?? 0;
    let cameraRig = state.cameraRig ?? original;
    const mask = { primary: 1, secondary: 2, auxiliary: 4 }[response.button], pointerState = frame.pointerState ?? [0, 0, 0, 0], buttons = frame.gesture?.buttons ?? (pointerState[1] > 0 ? 1 : 0);
    const orbiting = !frozen && original.movement.enabled && response.enabled && pointerState[0] > 0 && pointerState[1] > 0 && (buttons & mask) !== 0 && (response.modifier === 'none' || frame.gesture?.[`${response.modifier}Key`] === true);
    let start = null;
    if (orbiting) {
        start = !state.start || state.start.serial !== pointerState[3] ? { serial: pointerState[3], u: frame.clickActivity[0], v: frame.clickActivity[1], cameraRig: { ...structuredClone(cameraRig), ...sampleSpatialCameraPath(cameraRig, time), path: null } } : state.start;
        const defaults = createSpatialCameraResponse();
        cameraRig = applyCameraRigAction(start.cameraRig, 'look-right', (frame.pointer[0] - start.u) * original.movement.lookSensitivity * response.sensitivityX / defaults.sensitivityX, { reference: original });
        cameraRig = applyCameraRigAction(cameraRig, 'look-down', (frame.pointer[1] - start.v) * original.movement.lookSensitivity * response.sensitivityY / defaults.sensitivityY, { reference: original });
    }
    const movement = frame.cameraInput;
    if (!frozen && original.movement.enabled && movement) {
        if (cameraRig.path) cameraRig = { ...cameraRig, ...sampleSpatialCameraPath(cameraRig, time), path: null };
        const delta = Number.isFinite(movement.deltaSeconds) ? Math.max(0, Math.min(.1, movement.deltaSeconds)) : 0;
        for (const [axis, action] of [[0, 'truck-right'], [1, 'raise'], [2, 'dolly-forward']]) {
            const value = movement.translation?.[axis];
            if (Number.isFinite(value) && delta > 0) cameraRig = applyCameraRigAction(cameraRig, action, Math.max(-1, Math.min(1, value)) * original.movement.speed * delta / original.unitScale, { reference: original });
        }
        if (Number.isFinite(movement.dolly)) cameraRig = applyCameraRigAction(cameraRig, 'dolly-forward', Math.max(-1, Math.min(1, movement.dolly)) * original.movement.dollySensitivity / original.unitScale, { reference: original });
    }
    const camera = spatialCameraRigFor({ ...settings, cameraRig, cameraTime: time }, 1, 1);
    return { cameraRig, yaw: camera.yaw * 180 / Math.PI, pitch: camera.pitch * 180 / Math.PI, start, orbiting: orbiting || Boolean(movement && !frozen && original.movement.enabled) };
}
