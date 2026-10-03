// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { audioAutomationSetTargetValue } from '../../../engine/core/math/AudioAutomationMath.js';

/** Shared, ephemeral input for preview and desktop; saved projects cannot start capture. */
const SILENT = Object.freeze({ bass: 0, mid: 0, treble: 0, onset: 0 });
let capture = null;
const envelopes = new WeakMap();
export function createAmbientAudioResponseState() { return { owner: null, envelope: null, now: null, levels: { ...SILENT } }; }
function resetResponseState(state) { if (state) { state.owner = null; state.envelope = null; state.now = null; state.levels = { ...SILENT }; } }

export function registerAmbientAudioInput(owner, sample) {
    if (!owner || typeof sample !== 'function') throw new TypeError('Ambient audio input needs an owner and sample function.');
    const registration = { owner, sample };
    capture = registration;
    return () => { if (capture === registration) capture = null; };
}

/** FxBus energy is an artistic activity envelope, never a measured frequency band. */
export function sampleAmbientAudioResponse(settings, frame, { now = performance.now(), wallTime = Date.now(), frozen = false, state = null } = {}) {
    if (frozen || !settings || settings.responseSource === 'off') { if (settings) envelopes.delete(settings); resetResponseState(state); return SILENT; }
    const amount = unit(settings.responseAmount ?? .5);
    if (!amount) { envelopes.delete(settings); resetResponseState(state); return SILENT; }
    if (settings.audioEnvelope) return sampleAuthoredEnvelope(settings, frame, now, wallTime, amount, state);
    if (settings.responseSource === 'os') {
        const age = wallTime - Number(frame?.ts);
        if (!frame || !Number.isFinite(age) || age < -1_000 || age > 2_000) return SILENT;
        const fade = Math.max(0, 1 - Math.max(0, age - 500) / 1_500);
        const energy = unit(frame.energy) * amount * fade;
        // Reuse the spatial force channels with a soft activity impulse. No spectral claim.
        return { bass: energy * .45, mid: energy * .35, treble: 0, onset: frame.beat ? amount * fade * .25 : 0 };
    }
    if (settings.responseSource !== 'audio' || !capture) return SILENT;
    let sample;
    try { sample = capture.sample(now); } catch { return SILENT; }
    return { bass: unit(sample?.bass) * amount, mid: unit(sample?.mids ?? sample?.mid) * amount,
        treble: unit(sample?.treble) * amount, onset: unit(sample?.beatPulse ?? sample?.onset) * amount };
}

/** Per-renderer envelopes consume shared measured input without sharing artistic state. */
function sampleAuthoredEnvelope(settings, frame, now, wallTime, amount, rendererState) {
    if (!Number.isFinite(now)) { envelopes.delete(settings); resetResponseState(rendererState); return SILENT; }
    const envelope = settings.audioEnvelope;
    let input, owner;
    if (settings.responseSource === 'os') {
        const age = (wallTime - Number(frame?.ts)) / 1000;
        const fade = frame && Number.isFinite(age) && age >= -1 ? Math.max(0, 1 - Math.max(0, age - envelope.freshSeconds) / envelope.fadeSeconds) : 0;
        input = { energy: unit(frame?.energy) * fade, beat: frame?.beat === true ? fade : 0, none: 0 }; owner = 'os';
    } else if (settings.responseSource === 'audio' && capture) {
        let sample;
        try { sample = capture.sample(now, { raw: true }); } catch { envelopes.delete(settings); resetResponseState(rendererState); return SILENT; }
        if (!sample) { envelopes.delete(settings); resetResponseState(rendererState); return SILENT; }
        input = { bass: unit(sample.bass), mid: unit(sample.mids ?? sample.mid), treble: unit(sample.treble),
            onset: unit(sample.beatPulse ?? sample.onset), energy: unit(sample.envelope ?? sample.energy), none: 0 }; owner = capture;
    } else { envelopes.delete(settings); resetResponseState(rendererState); return SILENT; }
    let state = rendererState ?? envelopes.get(settings);
    if (!state) { state = createAmbientAudioResponseState(); envelopes.set(settings, state); }
    if (state.owner !== owner || state.envelope !== envelope || now < state.now) {
        Object.assign(state, { owner, envelope, now, levels: { ...SILENT } });
    }
    const dt = (now - state.now) / 1000; state.now = now;
    const result = {};
    for (const [channel, calibration] of Object.entries(envelope.channels)) {
        const os = settings.responseSource === 'os', source = os ? calibration.osSource : calibration.audioSource;
        const measured = input[source], calibrated = Math.max(0, Math.min(1, (measured - calibration.floor) / (calibration.ceiling - calibration.floor))) ** calibration.curve;
        const target = source === 'none' ? 0 : unit(calibrated * (os ? calibration.osGain : calibration.gain));
        const previous = state.levels[channel], tau = target > previous ? calibration.attack : calibration.release;
        state.levels[channel] = tau === 0 ? target : audioAutomationSetTargetValue(previous, target, 0, tau, dt);
        result[channel] = state.levels[channel] * amount;
    }
    return result;
}

function unit(value) { return Number.isFinite(Number(value)) ? Math.max(0, Math.min(1, Number(value))) : 0; }
