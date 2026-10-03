// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Laboratory-only interventions on an existing authored plan. No model defaults,
 * source files, learned weights, playback settings or accepted voice are changed.
 *
 * These are falsifiable diagnostic factors, not a validated K repair. The current
 * solver has a noise injection junction, not a separately controllable burst EQ.
 * Moving that junction changes its downstream cavity response, including level.
 * The second factor carries a little already-open K geometry into voiced vowel
 * entry, after the burst and aspiration; it is not a phoneme duration override.
 *
 * Research motivates separating source and transition factors, not these numeric
 * settings: https://pmc.ncbi.nlm.nih.gov/articles/PMC3145491/ (voiced stops) and
 * https://pmc.ncbi.nlm.nih.gov/articles/PMC3628899/ (German coarticulation).
 * Values below are bounded engineering probes in the current 64 kHz/32-section
 * waveguide. In particular, one junction is not resolution-independent anatomy.
 */
import { phonemeAt } from '../frontend/PhonemeSet.js';
import { RELEASE_AREA_CM2 } from '../model/ArticulationHead.js';
import { PARTICLE_VOICE_EXPERIMENTAL_SOURCE } from '../model/ParticleVoiceModel.js';
import { voiceLabConfiguration } from './VoiceLabDiagnostics.js';

export const VOICE_EXPERIMENT_CONTROL_VERSION = 'particle-voice-k-controls-v1';
const MAX_FRAMES = 6000;
const MAX_PHONES = 2048;

export const VOICE_EXPERIMENT_CONTROLS = Object.freeze([
    Object.freeze({ id: 'kReleaseJunctionOffset', type: 'integer', unit: 'waveguide-junctions',
        min: -1, max: 1, step: 1, default: 0, label: 'K release injection location',
        description: 'Move only an unmixed K release source by one junction. Negative is toward the glottis. This changes cavity filtering, not an independent burst EQ.' }),
    Object.freeze({ id: 'kVowelEntryBlend', type: 'number', unit: 'fraction',
        min: 0, max: 0.5, step: 0.05, default: 0, label: 'K voiced-vowel entry carryover',
        description: 'Briefly blend voiced vowel entry toward its already-open release geometry, then restore the original trajectory before the latter half of the voiced vowel.' }),
]);

const variant = (id, label, release, entry) => Object.freeze({ id, label,
    controls: Object.freeze({ kReleaseJunctionOffset: release, kVowelEntryBlend: entry }) });
export const VOICE_EXPERIMENT_VARIANTS = Object.freeze([
    variant('baseline', 'Accepted baseline', 0, 0),
    variant('release', 'Release location only', -1, 0),
    variant('entry', 'Voiced entry only', 0, 0.35),
    variant('combined', 'Release location and voiced entry', -1, 0.35),
]);

function validatedControls(controls) {
    if (!controls || typeof controls !== 'object' || Array.isArray(controls)
        || ![Object.prototype, null].includes(Object.getPrototypeOf(controls))) {
        throw new TypeError('Voice experiments require a plain controls record.');
    }
    const descriptors = Object.getOwnPropertyDescriptors(controls);
    if (Reflect.ownKeys(descriptors).length !== VOICE_EXPERIMENT_CONTROLS.length
        || Reflect.ownKeys(descriptors).some(key => !VOICE_EXPERIMENT_CONTROLS.some(control => control.id === key))) {
        throw new TypeError('Unsupported or missing voice experiment control.');
    }
    const out = {};
    for (const control of VOICE_EXPERIMENT_CONTROLS) {
        const descriptor = descriptors[control.id];
        const value = descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : null;
        if (typeof value !== 'number' || !Number.isFinite(value) || value < control.min || value > control.max
            || (control.type === 'integer' && !Number.isInteger(value))) {
            throw new RangeError(`Invalid ${control.id}; expected ${control.type} in [${control.min}, ${control.max}].`);
        }
        out[control.id] = value;
    }
    return Object.freeze(out);
}

function validatePlan(plan) {
    const physiology = plan?.physiology, frames = plan?.frames, sequence = plan?.sequence;
    const total = physiology?.totalFrames, sections = physiology?.numSections, phones = sequence?.phonemeIds?.length;
    if (!Number.isInteger(total) || total < 1 || total > MAX_FRAMES
        || !Number.isInteger(sections) || sections < 4 || sections > 128
        || !Number.isInteger(phones) || phones < 1 || phones > MAX_PHONES
        || !Number.isFinite(physiology.frameRateHz) || physiology.frameRateHz <= 0
        || !Number.isInteger(physiology.sampleRate) || physiology.sampleRate <= 0
        || frames?.totalFrames !== total || frames.frameRateHz !== physiology.frameRateHz
        || plan.prosody?.frameRateHz !== physiology.frameRateHz
        || frames.frameToPhoneme?.length !== total || frames.frameVoiced?.length !== total
        || physiology.areas?.length !== total * sections || !Array.isArray(physiology.releaseBursts)
        || physiology.releaseBursts.length > phones || !Array.isArray(sequence.words)) {
        throw new TypeError('Voice experiments require a bounded, complete authored plan.');
    }
    if (plan.voiceExperiment) throw new TypeError('Apply each experiment to the original baseline plan, not another candidate.');
    for (const key of ['ee', 'pressure', 't0Samples', 'teSamples', 'tpSamples', 'taSamples',
        'constrictionAmplitude', 'constrictionIndex', 'releaseAspiration', 'nasalCoupling', 'sampleIndex']) {
        const values = physiology[key];
        if (!ArrayBuffer.isView(values) || values.length !== total || !values.every(Number.isFinite)) {
            throw new TypeError(`Voice experiments require finite ${key} with the complete frame clock.`);
        }
    }
    if (!ArrayBuffer.isView(physiology.areas) || !physiology.areas.every(area => Number.isFinite(area) && area > 0)) {
        throw new RangeError('Voice experiment tract areas must be finite and positive.');
    }
    const starts = new Int32Array(phones).fill(-1), ends = new Int32Array(phones).fill(-1);
    let previousPhone = -1;
    for (let frame = 0; frame < total; frame++) {
        const phone = frames.frameToPhoneme[frame];
        if (!Number.isInteger(phone) || phone < previousPhone || phone >= phones
            || ![0, 1].includes(frames.frameVoiced[frame])
            || physiology.sampleIndex[frame] !== physiology.sampleIndex[0] + Math.round(frame * physiology.sampleRate / physiology.frameRateHz)) {
            throw new RangeError('Invalid or discontinuous phoneme frame ownership or sample clock.');
        }
        if (starts[phone] < 0) starts[phone] = frame;
        ends[phone] = frame + 1;
        previousPhone = phone;
    }
    for (const id of sequence.phonemeIds) phonemeAt(id);
    let wordEnd = 0;
    for (const word of sequence.words) {
        if (!Number.isInteger(word.startPhoneme) || !Number.isInteger(word.endPhoneme)
            || word.startPhoneme < wordEnd || word.endPhoneme <= word.startPhoneme || word.endPhoneme > phones) {
            throw new RangeError('Invalid or overlapping word boundaries.');
        }
        wordEnd = word.endPhoneme;
    }
    return { starts, ends };
}

function validateEvent(event, physiology, previousEnd) {
    const count = event?.amplitudes?.length;
    if (!Number.isInteger(event?.frame) || event.frame < previousEnd || !Number.isInteger(count) || count < 1
        || event.frame + count >= physiology.totalFrames || !Number.isInteger(event.section)
        || event.section < 0 || event.section >= physiology.numSections - 1
        || !['stop', 'affricate'].includes(event.originManner) || !Array.isArray(event.amplitudes)
        || !Array.isArray(event.combinedAmplitudes) || event.combinedAmplitudes.length !== count
        || !Array.isArray(event.combinedIndices) || event.combinedIndices.length !== count) {
        throw new RangeError('Invalid or truncated release event; retain its complete authored snapshots.');
    }
    for (let i = 0; i < count; i++) {
        if (!Number.isFinite(event.amplitudes[i]) || event.amplitudes[i] <= 0
            || !Number.isFinite(event.combinedAmplitudes[i]) || event.combinedAmplitudes[i] + 1e-6 < event.amplitudes[i]
            || !Number.isInteger(event.combinedIndices[i]) || event.combinedIndices[i] < -1
            || event.combinedIndices[i] >= physiology.numSections - 1) throw new RangeError('Invalid release source snapshot.');
    }
}

/** Clone the full plan and apply only the declared diagnostic factors. */
export function applyVoiceExperimentControls(plan, controls = VOICE_EXPERIMENT_VARIANTS[0].controls) {
    const selected = validatedControls(controls);
    const { starts, ends } = validatePlan(plan);
    const baseline = selected.kReleaseJunctionOffset === 0 && selected.kVowelEntryBlend === 0;
    const p = plan.physiology, S = p.numSections;
    if (!baseline && (p.sampleRate !== 64000 || S !== 32 || p.frameRateHz !== 100)) {
        throw new RangeError('K experiments currently require 64 kHz, 32 tract sections and 100 Hz authored frames.');
    }
    const copy = structuredClone(plan), out = copy.physiology, applied = [], skipped = [];
    if (!baseline) {
        let previousEnd = 0;
        for (let eventIndex = 0; eventIndex < p.releaseBursts.length; eventIndex++) {
            const event = p.releaseBursts[eventIndex];
            validateEvent(event, p, previousEnd);
            previousEnd = event.frame + event.amplitudes.length;
            const vowel = plan.frames.frameToPhoneme[event.frame], stop = vowel - 1;
            const word = plan.sequence.words.find(item => item.startPhoneme <= stop && item.endPhoneme > vowel);
            if (stop < 0 || event.originManner !== 'stop' || phonemeAt(plan.sequence.phonemeIds[stop]).symbol !== 'K'
                || phonemeAt(plan.sequence.phonemeIds[vowel]).category !== 'vowel' || !word
                || starts[stop] < 0 || ends[stop] !== starts[vowel]
                || (stop > word.startPhoneme && phonemeAt(plan.sequence.phonemeIds[stop - 1]).category === 'consonant')) continue;
            const record = { eventIndex, stopPhone: stop, vowelPhone: vowel, releaseFrame: event.frame };
            // Caller-edited source controls remain authoritative. Do not replace
            // their provenance with new snapshots to disguise a conflicting edit.
            const unchanged = event.amplitudes.every((amplitude, i) =>
                p.constrictionAmplitude[event.frame + i] === event.combinedAmplitudes[i]
                && p.constrictionIndex[event.frame + i] === event.combinedIndices[i]);
            const unmixed = event.combinedIndices.every(index => index === event.section)
                && previousEnd <= ends[vowel];
            if (!unchanged || !unmixed) {
                skipped.push(Object.freeze({ ...record, reason: !unchanged ? 'caller-edited-release-controls' : 'mixed-release-routing' }));
                continue;
            }
            if (selected.kReleaseJunctionOffset) {
                const section = event.section + selected.kReleaseJunctionOffset;
                if (section < 0 || section >= S - 1) throw new RangeError('K release offset leaves the tract.');
                for (let i = 0; i < event.amplitudes.length; i++) out.constrictionIndex[event.frame + i] = section;
                copy.physiology.releaseBursts[eventIndex] = { ...copy.physiology.releaseBursts[eventIndex], section,
                    combinedIndices: event.combinedIndices.map(() => section) };
                applied.push(Object.freeze({ ...record, controlId: 'kReleaseJunctionOffset',
                    originalSection: event.section, section, endFrame: previousEnd }));
            }
            if (selected.kVowelEntryBlend) {
                // Select the first actually voiced, unaspirated frame only after
                // the complete release tail. Never retime closure or the burst.
                let voicedStart = event.frame;
                while (voicedStart < ends[vowel] && (p.releaseAspiration[voicedStart] > 0
                    || plan.frames.frameVoiced[voicedStart] !== 1 || p.ee[voicedStart] < 0.05)) voicedStart++;
                const start = Math.max(previousEnd, voicedStart);
                const midpoint = voicedStart + Math.floor((ends[vowel] - voicedStart) / 2);
                // The last endpoint equals the baseline, so the whole latter
                // half of the voiced vowel stays exact even when it is short.
                const end = Math.min(midpoint + 1, start + Math.round(0.04 * p.frameRateHz));
                const reference = p.areas.subarray(event.frame * S, (event.frame + 1) * S);
                if (end - start < 3 || reference.some(area => area < RELEASE_AREA_CM2)) {
                    skipped.push(Object.freeze({ ...record, controlId: 'kVowelEntryBlend', reason: 'insufficient-open-entry-before-nucleus' }));
                    continue;
                }
                // Zero weight at both endpoints keeps the baseline's incoming
                // and outgoing controls exact; the supported solver interpolates
                // between these frame controls. A convex blend cannot reclose it.
                for (let f = start + 1; f < end - 1; f++) {
                    const weight = selected.kVowelEntryBlend * Math.sin(Math.PI * (f - start) / (end - start - 1)) ** 2;
                    for (let s = 0; s < S; s++) {
                        const index = f * S + s;
                        if (p.areas[index] < RELEASE_AREA_CM2) throw new RangeError('K vowel entry contains a new closure.');
                        out.areas[index] = p.areas[index] + weight * (reference[s] - p.areas[index]);
                    }
                }
                applied.push(Object.freeze({ ...record, controlId: 'kVowelEntryBlend', startFrame: start,
                    endFrameExclusive: end, referenceFrame: event.frame, voicedStartFrame: voicedStart, nucleusStartFrame: midpoint }));
            }
        }
    }
    out.releaseBursts = Object.freeze(out.releaseBursts.map(event => Object.freeze({ ...event,
        amplitudes: Object.freeze(event.amplitudes), combinedAmplitudes: Object.freeze(event.combinedAmplitudes),
        combinedIndices: Object.freeze(event.combinedIndices) })));
    copy.voiceExperiment = Object.freeze({ version: VOICE_EXPERIMENT_CONTROL_VERSION,
        experimental: true, validatedRepair: false, controls: selected, baselineBypass: baseline,
        scope: 'word-local-K-to-vowel-without-consonant-cluster', applied: Object.freeze(applied), skipped: Object.freeze(skipped) });
    return copy;
}

/** Actual current model capabilities; planned neural/reference modules stay absent. */
export function buildVoiceExperimentCapability(model) {
    const configuration = voiceLabConfiguration(model, { ready: Boolean(model) });
    const config = configuration.model;
    const supported = config?.sampleRate === 64000 && config?.numSections === 32
        && config?.chunkSamples === 256;
    return Object.freeze({ version: VOICE_EXPERIMENT_CONTROL_VERSION,
        source: PARTICLE_VOICE_EXPERIMENTAL_SOURCE, configuration,
        runtime: 'authored-articulatory-waveguide', learnedModel: false,
        controlsSupported: supported, requiredModel: Object.freeze({ sampleRate: 64000, numSections: 32,
            chunkSamples: 256, frameRateHz: 100 }), controls: VOICE_EXPERIMENT_CONTROLS,
        available: Object.freeze(['text-plan', 'explicit-phoneme-plan', 'physiology-render',
            'release-event-snapshots', 'word-timing', 'model-output-pcm-identity']),
        unavailable: Object.freeze(['independent-burst-EQ', 'reference-forced-alignment',
            'reference-to-physiology-analysis', 'automatic-K-repair', 'trained-context-calibrator',
            'end-to-end-acoustic-gradient-training', 'automatic-production-promotion']),
        limitation: 'Diagnostic source-location and post-release entry probes; no perceptual improvement is established.' });
}
