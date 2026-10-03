// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ParticleVoiceModel.js — Phase 3 ParticleVoice model.
 *
 * Wires the whole Phase 3 path into one call: **text → PCM**.
 *
 *   TextNormalizer → G2P/lexicon → PhonemeSequence
 *     → ProsodyPlanner → LengthRegulator
 *     → ArticulationHead → NeuralPhysiologyState stream
 *     → ParticleTract (GPU acoustic solver)
 *     → SafetyLimiter → PCM
 *
 * ## Why there is no separate `SourceVocoder` in Phase 3
 *
 * The plan lists "`SourceVocoder.js` basic harmonic + noise + waveguide
 * output". In Phase 3 that IS `ParticleTract`: it already runs `glottal_lf`
 * (harmonic source), two `constriction_noise` streams (aspiration at the
 * glottis, frication at the constriction) and the Kelly-Lochbaum waveguide,
 * with lip radiation applied internally. Adding a `SourceVocoder` wrapper
 * that only forwarded to it would be a layer with no content. Phase 4's full
 * source-filter Fourier vocoder (bounded spectral residual, MPD/MRD
 * refinement, IFFT + WOLA) is where that module earns its own file — and the
 * seam for it is `renderPhysiology()`, which is already separate from the
 * text frontend.
 *
 * ## Frame rate vs chunk rate: the decimation that matters
 *
 * `ArticulationHead` emits physiology at the 100 Hz plan frame rate (10 ms),
 * but `ParticleTract.renderChunk()` accepts **one control set per chunk** —
 * one area profile, one f0, one constriction index. The current 64 kHz /
 * 256-sample default is 4 ms, so most chunks sample one 10 ms physiology
 * frame; supported custom chunk sizes can cover several, and the reduction
 * choice remains audible:
 *
 *   - **Areas are AVERAGED** when multiple frames fall in a chunk. Picking one frame
 *     (say the first) would throw away the smoothing `ArticulationHead`
 *     deliberately applied and reintroduce exactly the reflection-coefficient
 *     step it exists to prevent.
 *   - **F0 is averaged** for the same reason: a chunk-rate pitch staircase is
 *     audible as a warble.
 *   - **Constriction index is taken by MAJORITY** when needed, not averaged — it is a
 *     position index, and the mean of "junction 20" and "junction 6" is
 *     junction 13, a place no phoneme asked for.
 *   - **Voicing/amplitudes are averaged**, which naturally cross-fades a
 *     voiced→voiceless transition across the chunk rather than switching hard.
 *
 * At the current 64 kHz / 256-sample default a chunk is 4 ms, shorter than a
 * 10 ms plan frame; `_decimateChunk()` still owns the rate crossing so custom
 * chunk sizes cannot introduce a second, inconsistent reduction rule. The
 * current production path does not invoke `PhonemeEncoder`: no trained encoder
 * weights are shipped, and `ArticulationHead` consumes the authored categorical
 * phoneme/frame streams directly.
 *
 * ## Breath reservoir
 *
 * `BreathReservoirState`'s one-pole lag is applied CPU-side per chunk to turn
 * `ArticulationHead`'s target subglottal pressure into an actual pressure with
 * inertia, and that pressure scales the glottal excitation. This uses the same
 * `lagRateFromCompliance` formula the GPU `breath_reservoir` kernel expects
 * pre-computed, so the two agree; running it here rather than on GPU avoids a
 * readback for a single scalar per chunk. Documented as a deliberate
 * simplification: a per-SAMPLE reservoir would need the kernel.
 */

import { normalizeText } from '../frontend/TextNormalizer.js';
import { G2PModel, textToPhonemeSequence } from '../frontend/G2PModel.js';
import { ProsodyPlanner, PLAN_FRAME_RATE_HZ } from './ProsodyPlanner.js';
import { LengthRegulator } from './LengthRegulator.js';
import { ArticulationHead } from './ArticulationHead.js';
import {
    ParticleTract,
    DEFAULT_TRACT_CONFIG,
    BATCH_READBACK_SLOT_COUNT,
    MAX_RENDER_BATCH_CHUNKS,
} from '../articulatory/ParticleTract.js';
import { lagRateFromCompliance } from '../articulatory/BreathReservoirState.js';
import { isStructural, isVowel, phonemeIdOf, PUNCTUATION_CONTEXT, STRUCTURAL_SYMBOLS } from '../frontend/PhonemeSet.js';
import { midiToHz } from '../frontend/SongScore.js';
import { parseScriptTags } from '../frontend/ScriptTags.js';
import { resolveExpression } from './ExpressionPrompt.js';
import { UNVOICED_EE, RELEASE_AREA_CM2 } from './ArticulationHead.js';
import { SafetyLimiter } from '../streaming/SafetyLimiter.js';
import { shapedAreaProfile, reflectionCoefficients } from '../risk/KellyLochbaumWaveguide.js';
import { getVoicePreset } from './VoicePresets.js';

export const DEFAULT_VOICE_MODEL_CONFIG = Object.freeze({
    /**
     * 64 kHz, raised from 32 kHz to DOUBLE THE TRACT'S SPATIAL RESOLUTION.
     *
     * This is not about audio bandwidth — 32 kHz already covers speech. In this
     * waveguide a section is one sample of wave travel, so
     * `sectionLength = c/sampleRate` and the sample rate is what *buys spatial
     * resolution*. At 32 kHz a section is 1.06 cm, giving only 16 sections for a
     * 17 cm tract. Pink Trombone (the reference browser implementation of this
     * same Kelly-Lochbaum method) uses **44** sections and its own documentation
     * states that below 38 it "starts to sound alien".
     *
     * 16 sections is not merely coarse, it erases phonemic contrasts. Place
     * positions for postalveolar (0.55), alveolar (0.65) and dental (0.75) are
     * 0.1 apart in normalized terms = 1.7 cm = **1.6 sections**, so SH, S and TH
     * were being realised at nearly the same place and could not sound different.
     * It also caps how short a front cavity can be, which is what limited IY's F2.
     *
     * 64 kHz halves the section to 0.53 cm and gives 32 sections, tripling the
     * separation between those places. Cost is ~2x waveguide work, since the
     * kernel is sequential in samples.
     */
    sampleRate: 64000,
    /**
     * 256 samples = 4 ms at 64 kHz, so articulatory controls update at **250 Hz**.
     *
     * This is a perceptual choice, not an arbitrary buffer size. `ParticleTract`
     * holds ONE control set per chunk, so the chunk rate IS the rate at which
     * the area profile (and therefore the waveguide's reflection coefficients)
     * steps. At the previous 1024 samples that rate was **31.25 Hz** — a strong
     * amplitude/timbre modulation sitting right in the range the ear hears as a
     * low buzz, and coarse enough to discard most of the per-manner smoothing
     * `ArticulationHead` applies at 100 Hz. 8 ms chunks put the modulation above
     * that range and track the 100 Hz frame stream closely (~0.8 frames per
     * chunk), so the smoothing actually reaches the solver.
     *
     * Cost: 4x the dispatches and readbacks per second of audio. Worth it while
     * correctness matters more than throughput; batching several chunks per
     * submit is the obvious optimization if it ever becomes the bottleneck.
     */
    // 256 samples at 64 kHz = 4 ms, a 250 Hz control rate.
    //
    // This has to be read against the GESTURE time constants, not chosen for
    // buffering convenience. `GESTURE_TIME_MS[STOP]` is now 8 ms, and
    // `ParticleTract` holds ONE control set per chunk and interpolates linearly
    // between consecutive chunks — so a chunk as long as the time constant cannot
    // represent the trajectory it is meant to carry, and the result genuinely
    // depends on the chunk size. The end-to-end spectral-invariance check caught
    // exactly that at 8 ms chunks (cosine similarity 0.82).
    //
    // 4 ms keeps the control interval at half the fastest gesture. Speeding up the
    // gestures is what forced this: the two constants are coupled and cannot be
    // tuned independently.
    chunkSamples: 256,
    /** Consecutive 4 ms control chunks copied into one mapped readback batch. */
    renderBatchChunks: 8,
    numSections: DEFAULT_TRACT_CONFIG.numSections,
    nasalSections: DEFAULT_TRACT_CONFIG.nasalSections,
    /**
     * Breath-reservoir time constant in seconds (larger = more inertia).
     * Matches R6A's proven `BREATH_COMPLIANCE_SECONDS` / `BreathReservoir.js`
     * default of 0.15. An earlier 0.25 here was SLOWER than R6A's own probe,
     * which made pressure — and therefore glottal excitation — ramp with a
     * 250 ms time constant: a short utterance ended before it ever reached
     * full drive, so the whole thing came out faint.
     */
    compliance: 0.15,
    /** Reference pressure that maps to unity excitation gain. */
    referencePressure: 800,
    /**
     * Target RMS (loudness) the utterance is normalized to, ~-19 dBFS, which
     * is a normal speech level.
     *
     * Normalizing by RMS rather than by PEAK is deliberate and was arrived at
     * by measurement. Two earlier attempts were both wrong:
     *
     *   1. A fixed `outputGain: 0.35` — the wrong instrument entirely. The
     *      waveguide's absolute level falls out of its area profile,
     *      reflection coefficients and excitation strength, and sits far below
     *      full scale (measured raw peak ~0.15), so a sub-unity constant
     *      ATTENUATED an already-quiet signal into inaudibility.
     *   2. Peak normalization to 0.7 — better, but defeated by transients. The
     *      rendered crest factor is ~15:1 (≈23 dB), so a single plosive burst
     *      set the peak and held the SUSTAINED speech down at -26 dBFS rms.
     *      Normalizing to the loudest instant makes everything else quiet.
     *
     * RMS targeting fixes the level a listener actually perceives and leaves
     * the occasional transient to `SafetyLimiter`'s soft clip, which is
     * precisely what that stage is for — it approaches ±1 asymptotically and
     * never hard-clips.
     */
    targetRms: 0.11,
    /**
     * Ceiling on `gain * rawPeak`. Allowed above 1.0 on purpose: transients
     * are meant to reach the limiter's soft knee rather than dictate the whole
     * utterance's level. Too high would over-distort; 1.6 keeps the knee busy
     * only on genuine bursts.
     */
    peakCeiling: 1.6,
    /** Cap on the auto-gain, so a near-silent render cannot be amplified into pure noise. */
    maxAutoGain: 500,
    /**
     * Optional acoustic gain applied to the current simplified nasal branch.
     *
     * The final tract mixer now converts both outlet boundary pressures to
     * volume contributions using their physical outlet areas; the nasal .8 cm²
     * outlet therefore receives the correct common-scale attenuation relative
     * to a roughly 6 cm² open mouth. Unity is the neutral production value.
     * This remains an explicit seam for authored voices, not a per-phone table,
     * and it does not claim the read-only nasal tap is a full three-port model.
     */
    nasalBranchGain: 1,
    /** Fade applied at utterance start/end so PCM never begins or ends on a step. */
    fadeMs: 8,
    /**
     * Decimated visualization frames per chunk (0 = disabled, the default).
     * Forwarded to `ParticleTract`, so visualization comes from the SOLVER's
     * own state in BOTH neural and manual modes — the plan's "same
     * `VisualAirflowState`" requirement is satisfied structurally, because
     * both paths funnel through `renderPhysiology()` and there is no second
     * source to drift from. Also inherits `ParticleTract`'s guarantee that
     * PCM is byte-identical whether or not this is on.
     */
    visualFramesPerChunk: 0,
    /** Nasal branch shape (Pink Trombone diameter contour correctly squared to cm² areas). */
    nasalProfile: Object.freeze([
        { pos: 0, area: 0.50 },
        { pos: 0.25, area: 1.50 },
        { pos: 0.5, area: 2.84 },
        { pos: 0.75, area: 1.50 },
        { pos: 1, area: 0.80 },
    ]),
});

/**
 * Production-facing identity for this source.  The label is intentionally
 * explicit about maturity: the acoustic path is implemented and measured,
 * while
 * pronunciation/prosody are still authored deterministic models rather than
 * a trained speaker model.
 */
export const PARTICLE_VOICE_EXPERIMENTAL_SOURCE = Object.freeze({
    id: 'particle-voice-experimental',
    label: 'Particle Voice (Experimental)',
    kind: 'local-webgpu-articulatory',
    experimental: true,
    learnedModel: false,
    // Authored acoustic revision, not a deployed-source/build attestation.
    synthesisRevision: 'particle-voice-articulation-r14',
    synthesisRevisionKind: 'authored-acoustic-revision-not-build-attestation',
    modelSampleRate: DEFAULT_VOICE_MODEL_CONFIG.sampleRate,
    supportsSentenceStreaming: true,
    supportsExplicitPhonemes: true,
    amplitudeAvailable: true,
});

export const DEFAULT_SENTENCE_STREAM_CONFIG = Object.freeze({
    maxInputCharacters: 32768,
    maxSentenceCharacters: 480,
    maxSentenceWords: 32,
    maxSentencePhonemes: 128,
    maxSentenceFrames: 3000,
    maxSentences: 128,
});

const nowMs = () => globalThis.performance?.now?.() ?? Date.now();

function abortError(reason = 'Particle Voice synthesis cancelled') {
    if (reason instanceof Error && reason.name === 'AbortError') return reason;
    const message = typeof reason === 'string' && reason.length > 0
        ? reason
        : 'Particle Voice synthesis cancelled';
    if (typeof DOMException === 'function') return new DOMException(message, 'AbortError');
    const error = new Error(message);
    error.name = 'AbortError';
    return error;
}

function boundedInteger(value, fallback, { name, min, max }) {
    const resolved = value === undefined ? fallback : value;
    if (!Number.isInteger(resolved) || resolved < min || resolved > max) {
        throw new RangeError(`ParticleVoiceModel: ${name} must be an integer in [${min}, ${max}]`);
    }
    return resolved;
}

function assertSequenceShape(sequence) {
    const { phonemeIds, stress, punctuationContext } = sequence ?? {};
    if (!phonemeIds || !stress || !punctuationContext) {
        throw new TypeError('ParticleVoiceModel.planSequence requires {phonemeIds, stress, punctuationContext}');
    }
    const count = phonemeIds.length;
    if (stress.length !== count || punctuationContext.length !== count) {
        throw new RangeError(`ParticleVoiceModel: sequence array lengths must match (${count}/${stress.length}/${punctuationContext.length})`);
    }
    let speechPhonemes = 0;
    for (const id of phonemeIds) {
        if (!isStructural(id)) speechPhonemes += 1;
    }
    if (speechPhonemes === 0) {
        throw new RangeError(`ParticleVoiceModel: sequence contains no speakable phonemes (got ${count} structural tokens only)`);
    }
    return speechPhonemes;
}

/**
 * Validate the optional text-planner pressure preparation descriptor and
 * derive its utterance-relative source gate. Manual physiology has no such
 * descriptor and retains its authored pressure/source behavior unchanged.
 */
function resolvePressurePreparation(physiology, config) {
    const raw = physiology?.pressurePreparation;
    if (raw === null || raw === undefined) return null;
    if (raw?.kind !== 'leading-silence') {
        throw new TypeError('ParticleVoiceModel: pressurePreparation.kind must be leading-silence');
    }
    const { leadingFrames, targetPressure, absoluteSpeechStartSample } = raw;
    if (!Number.isInteger(leadingFrames)
        || leadingFrames <= 0
        || leadingFrames >= physiology.totalFrames) {
        throw new RangeError('ParticleVoiceModel: pressurePreparation.leadingFrames must identify a non-empty leading prefix');
    }
    if (!Number.isFinite(targetPressure) || targetPressure <= 0) {
        throw new RangeError('ParticleVoiceModel: pressurePreparation.targetPressure must be positive and finite');
    }
    if (!Number.isInteger(absoluteSpeechStartSample) || absoluteSpeechStartSample < 0) {
        throw new RangeError('ParticleVoiceModel: pressurePreparation.absoluteSpeechStartSample must be a non-negative integer');
    }
    if (!physiology.pressure || physiology.pressure.length < physiology.totalFrames
        || !physiology.sampleIndex || physiology.sampleIndex.length < physiology.totalFrames
        || !physiology.constrictionAmplitude
        || physiology.constrictionAmplitude.length < physiology.totalFrames
        || !physiology.nasalCoupling
        || physiology.nasalCoupling.length < physiology.totalFrames) {
        throw new TypeError('ParticleVoiceModel: pressurePreparation requires complete pressure, source, and sampleIndex streams');
    }
    if (!Number.isInteger(physiology.sampleIndex[0]) || physiology.sampleIndex[0] < 0) {
        throw new RangeError('ParticleVoiceModel: pressurePreparation requires a non-negative integer timeline origin');
    }
    for (let frame = 0; frame < leadingFrames; frame++) {
        if (physiology.pressure[frame] !== 0) {
            throw new RangeError(`ParticleVoiceModel: pressurePreparation frame ${frame} is not zero-drive silence`);
        }
        if (physiology.constrictionAmplitude[frame] !== 0
            || (physiology.releaseAspiration?.[frame] ?? 0) !== 0
            || physiology.nasalCoupling[frame] !== 0) {
            throw new RangeError(`ParticleVoiceModel: pressurePreparation frame ${frame} contains an acoustic event`);
        }
    }
    if (physiology.pressure[leadingFrames] !== targetPressure) {
        throw new RangeError('ParticleVoiceModel: pressurePreparation target does not match the first speech frame');
    }
    if (physiology.sampleIndex[leadingFrames] !== absoluteSpeechStartSample) {
        throw new RangeError('ParticleVoiceModel: pressurePreparation speech sample does not match the physiology timeline');
    }
    const relativeSpeechStartSample = absoluteSpeechStartSample - physiology.sampleIndex[0];
    const expectedRelativeSample = Math.round(
        (leadingFrames * config.sampleRate) / physiology.frameRateHz,
    );
    if (!Number.isInteger(relativeSpeechStartSample)
        || relativeSpeechStartSample <= 0
        || relativeSpeechStartSample !== expectedRelativeSample) {
        throw new RangeError('ParticleVoiceModel: pressurePreparation is inconsistent with the frame timeline');
    }
    const sourceHeldUntilRelativeSample = Math.ceil(
        relativeSpeechStartSample / config.chunkSamples,
    ) * config.chunkSamples;
    return Object.freeze({
        kind: 'leading-silence',
        leadingFrames,
        targetPressure,
        absoluteSpeechStartSample,
        relativeSpeechStartSample,
        sourceHeldUntilRelativeSample,
    });
}

/**
 * Derive exact plan-time word spans from the G2P sequence's additive word
 * metadata.  Frame/sample ranges are half-open and sample positions use the
 * model's actual configured rate, never a hard-coded playback assumption.
 */
/**
 * Which of `noteCount` notes each phoneme of a word belongs to, splitting at
 * syllable nuclei: one consonant between vowels starts the next syllable
 * (ti-ger), a cluster splits after its first consonant (twin-kle). Vowels
 * beyond the last note stay on it.
 * @returns {number[]} note offset per phoneme
 */
export function syllableOwners(phonemeIds, noteCount) {
    const vowels = []; phonemeIds.forEach((id, k) => { if (isVowel(id)) vowels.push(k); });
    const owners = new Array(phonemeIds.length).fill(0), splits = Math.min(noteCount, vowels.length) - 1;
    for (let s = 0; s < splits; s++) {
        const gap = vowels[s + 1] - vowels[s] - 1, cut = vowels[s] + 1 + (gap >= 2 ? 1 : 0);
        for (let k = cut; k < owners.length; k++) owners[k] = s + 1;
    }
    return owners;
}

export function deriveWordBoundaries(sequence, prosody, { sampleRate } = {}) {
    if (!Number.isInteger(sampleRate) || sampleRate <= 0) {
        throw new RangeError('deriveWordBoundaries: sampleRate must be a positive integer');
    }
    const words = Array.isArray(sequence?.words) ? sequence.words : [];
    const durations = prosody?.durationFrames;
    const frameRateHz = prosody?.frameRateHz;
    if (!durations || !Number.isFinite(frameRateHz) || frameRateHz <= 0) {
        throw new TypeError('deriveWordBoundaries requires ProsodyPlanner output');
    }
    const starts = new Uint32Array(durations.length + 1);
    for (let i = 0; i < durations.length; i++) starts[i + 1] = starts[i] + durations[i];

    let previousEnd = 0;
    return words.map((word, index) => {
        const startPhoneme = Number(word?.startPhoneme);
        const endPhoneme = Number(word?.endPhoneme);
        if (!Number.isInteger(startPhoneme) || !Number.isInteger(endPhoneme)
            || startPhoneme < previousEnd || endPhoneme < startPhoneme
            || endPhoneme > durations.length) {
            throw new RangeError(`deriveWordBoundaries: words[${index}] has an invalid half-open phoneme range`);
        }
        previousEnd = endPhoneme;
        const startFrame = starts[startPhoneme];
        const endFrame = starts[endPhoneme];
        const startSeconds = startFrame / frameRateHz;
        const endSeconds = endFrame / frameRateHz;
        return Object.freeze({
            index,
            text: String(word?.text ?? ''),
            phraseIndex: Number.isInteger(word?.phraseIndex) ? word.phraseIndex : null,
            source: String(word?.source ?? 'unknown'),
            warnings: Object.freeze(Array.isArray(word?.warnings) ? word.warnings.map(String) : []),
            startPhoneme,
            endPhoneme,
            startFrame,
            endFrame,
            startSample: Math.round(startSeconds * sampleRate),
            endSample: Math.round(endSeconds * sampleRate),
            startMs: startSeconds * 1000,
            endMs: endSeconds * 1000,
            spoken: endPhoneme > startPhoneme,
        });
    });
}

function punctuationSuffix(boundary) {
    switch (boundary) {
        case PUNCTUATION_CONTEXT.comma: return ',';
        case PUNCTUATION_CONTEXT.period: return '.';
        case PUNCTUATION_CONTEXT.question: return '?';
        case PUNCTUATION_CONTEXT.exclamation: return '!';
        default: return '';
    }
}

function isTerminalBoundary(boundary) {
    return boundary === PUNCTUATION_CONTEXT.period
        || boundary === PUNCTUATION_CONTEXT.question
        || boundary === PUNCTUATION_CONTEXT.exclamation
        || boundary === PUNCTUATION_CONTEXT.paragraph;
}

/** Build bounded normalized units without re-parsing reconstructed text. */
function sentenceUnits(normalized, g2p, options) {
    const maxCharacters = boundedInteger(options.maxSentenceCharacters,
        DEFAULT_SENTENCE_STREAM_CONFIG.maxSentenceCharacters,
        { name: 'maxSentenceCharacters', min: 32, max: 2048 });
    const maxWords = boundedInteger(options.maxSentenceWords,
        DEFAULT_SENTENCE_STREAM_CONFIG.maxSentenceWords,
        { name: 'maxSentenceWords', min: 1, max: 128 });
    const maxPhonemes = boundedInteger(options.maxSentencePhonemes,
        DEFAULT_SENTENCE_STREAM_CONFIG.maxSentencePhonemes,
        { name: 'maxSentencePhonemes', min: 8, max: 512 });
    const maxSentences = boundedInteger(options.maxSentences,
        DEFAULT_SENTENCE_STREAM_CONFIG.maxSentences,
        { name: 'maxSentences', min: 1, max: 256 });

    const units = [];
    let phrases = [];
    let wordCount = 0;
    let phonemeCount = 0;
    let characterCount = 0;

    const flush = (reason) => {
        if (wordCount === 0) return;
        if (units.length >= maxSentences) {
            throw new RangeError(`ParticleVoiceModel: sentence stream exceeds maxSentences ${maxSentences}`);
        }
        const last = phrases[phrases.length - 1];
        const text = phrases
            .map((phrase) => phrase.words.map((word) => word.text).join(' ') + punctuationSuffix(phrase.boundary))
            .join(' ')
            .trim();
        units.push(Object.freeze({
            text,
            splitReason: reason,
            normalized: Object.freeze({ raw: text, phrases: Object.freeze(phrases.map((phrase) => Object.freeze({
                ...phrase,
                words: Object.freeze(phrase.words.slice()),
            }))) }),
            terminalBoundary: last?.boundary ?? PUNCTUATION_CONTEXT.none,
        }));
        phrases = [];
        wordCount = 0;
        phonemeCount = 0;
        characterCount = 0;
    };

    for (let phraseIndex = 0; phraseIndex < normalized.phrases.length; phraseIndex++) {
        const phrase = normalized.phrases[phraseIndex];
        let fragment = null;
        for (const word of phrase.words) {
            const pronounced = g2p.pronounce(word.text, { wasAllCaps: word.wasAllCaps });
            const wordPhonemes = pronounced?.phonemeIds?.length ?? 0;
            const wordCharacters = String(word.text).length + (wordCount > 0 ? 1 : 0);
            if (wordPhonemes > maxPhonemes || wordCharacters > maxCharacters) {
                throw new RangeError(`ParticleVoiceModel: word '${String(word.text).slice(0, 48)}' exceeds sentence stream bounds`);
            }
            const wouldOverflow = wordCount > 0 && (
                wordCount + 1 > maxWords
                || phonemeCount + wordPhonemes > maxPhonemes
                || characterCount + wordCharacters > maxCharacters
            );
            if (wouldOverflow) {
                flush('limit');
                fragment = null;
            }
            if (!fragment) {
                fragment = {
                    words: [],
                    boundary: PUNCTUATION_CONTEXT.none,
                    structural: null,
                    breathLikely: false,
                    sourcePhraseIndex: phraseIndex,
                };
                phrases.push(fragment);
            }
            fragment.words.push(word);
            wordCount += 1;
            phonemeCount += wordPhonemes;
            characterCount += wordCharacters;
        }
        if (fragment) {
            fragment.boundary = phrase.boundary;
            fragment.structural = phrase.structural;
            fragment.breathLikely = phrase.breathLikely;
        }
        if (isTerminalBoundary(phrase.boundary)) flush('sentence');
    }
    flush('input-end');
    return units;
}

export class ParticleVoiceModel {
    /**
     * @param {GPUDevice} device
     * @param {object} [config] See `DEFAULT_VOICE_MODEL_CONFIG`.
     */
    constructor(device, config = {}) {
        if (!device?.createBuffer) throw new TypeError('ParticleVoiceModel requires a GPUDevice');
        this.voicePreset = getVoicePreset(config.voicePreset);
        this.config = { ...DEFAULT_VOICE_MODEL_CONFIG, ...this.voicePreset.model, ...config,
            voicePreset: this.voicePreset.id };
        const cfg = this.config;
        if (!Number.isFinite(cfg.sampleRate) || cfg.sampleRate <= 0) throw new RangeError('ParticleVoiceModel: sampleRate must be positive');
        if (!Number.isInteger(cfg.chunkSamples) || cfg.chunkSamples <= 0) throw new RangeError('ParticleVoiceModel: chunkSamples must be a positive integer');
        if (!Number.isInteger(cfg.renderBatchChunks)
            || cfg.renderBatchChunks < 1
            || cfg.renderBatchChunks > MAX_RENDER_BATCH_CHUNKS) {
            throw new RangeError(`ParticleVoiceModel: renderBatchChunks must be an integer in [1, ${MAX_RENDER_BATCH_CHUNKS}]`);
        }
        if (!Number.isFinite(cfg.nasalBranchGain)
            || !(cfg.nasalBranchGain >= 0)
            || cfg.nasalBranchGain > 1) {
            throw new RangeError('ParticleVoiceModel: nasalBranchGain must be in [0, 1]');
        }

        this._device = device;
        this.g2p = config.g2p ?? new G2PModel();
        this.prosody = config.prosodyPlanner ?? new ProsodyPlanner({ ...this.voicePreset.prosody, ...config.prosodyConfig });
        this.regulator = new LengthRegulator();
        this.articulation = config.articulationHead ?? new ArticulationHead({
            ...this.voicePreset.articulation, ...config.articulationConfig, numSections: cfg.numSections,
        });
        this._nasalAreas = shapedAreaProfile(cfg.nasalSections, cfg.nasalProfile);
        this._tract = null;
        this._destroyed = false;
        this._synthesisGeneration = 0;
        // ParticleTract owns one staging buffer and persistent traveling-wave
        // state.  Serializing every render is therefore a correctness rule,
        // not merely a throughput choice: two concurrent mapAsync/readbacks
        // would race the same buffer and interleave acoustic state.
        this._renderTail = Promise.resolve();
        this._renderActive = false;
        this._pendingDestroyTract = null;
    }

    /**
     * Replace the authored prosody/articulation controls between renders (for
     * expression styles and inline script tags). The GPU tract and G2P are
     * untouched; the next planned sentence uses the new controls.
     */
    applyVoiceControls({ prosodyConfig = {}, articulationConfig = {}, targetRms } = {}) {
        this._assertNotDestroyed();
        this.prosody = new ProsodyPlanner({ ...this.voicePreset.prosody, ...prosodyConfig });
        this.articulation = new ArticulationHead({ ...this.voicePreset.articulation, ...articulationConfig, numSections: this.config.numSections });
        if (targetRms !== undefined) {
            if (!Number.isFinite(targetRms) || targetRms <= 0 || targetRms > 0.3) throw new RangeError('ParticleVoiceModel: targetRms must be in (0, 0.3]');
            this.config.targetRms = targetRms;
        }
    }

    _tractInstance() {
        if (!this._tract) {
            const cfg = this.config;
            this._tract = new ParticleTract(this._device, {
                sampleRate: cfg.sampleRate,
                chunkSamples: cfg.chunkSamples,
                numInstances: 1,
                numSections: cfg.numSections,
                nasalSections: cfg.nasalSections,
                visualFramesPerChunk: cfg.visualFramesPerChunk,
                renderBatchChunks: cfg.renderBatchChunks,
            });
        }
        return this._tract;
    }

    get visualizationEnabled() {
        return this.config.visualFramesPerChunk > 0;
    }

    /** Resolved tract controls after lazy GPU tract creation, otherwise null. */
    get tractConfiguration() {
        return this._tract?.configuration ?? null;
    }

    /**
     * Per-sample frication envelope for one chunk, resolved from the 100 Hz
     * frame stream at each sample's absolute time.
     *
     * Chunk-independent by construction: the value at absolute sample `i` depends
     * only on `i`. See the call site for why frication specifically needs this
     * while the other controls do not.
     */
    _fricationEnvelope(physiology, chunkStartSample, pressureGain) {
        const cfg = this.config;
        const S = cfg.chunkSamples;
        if (!this._fricScratch || this._fricScratch.length !== S) this._fricScratch = new Float32Array(S);
        const out = this._fricScratch;
        const amp = physiology.constrictionAmplitude;
        const index = physiology.constrictionIndex;
        const last = physiology.totalFrames - 1;
        const samplesPerFrame = cfg.sampleRate / physiology.frameRateHz;
        for (let n = 0; n < S; n++) {
            const framePos = (chunkStartSample + n) / samplesPerFrame;
            const f0 = Math.min(last, Math.max(0, Math.floor(framePos)));
            const f1 = Math.min(last, f0 + 1);
            const frac = Math.min(1, Math.max(0, framePos - f0));
            const a0 = index[f0] >= 0 ? amp[f0] : 0;
            const a1 = index[f1] >= 0 ? amp[f1] : 0;
            // A rise may be a stop-release burst. Interpolating TOWARD a future
            // frame makes that burst exist before the tract has opened, so the
            // closed cavity filters away its speech-band release cue. Rising
            // events are causal (held until their frame); falling envelopes can
            // still interpolate smoothly after the event has occurred.
            const amplitude = a1 > a0 ? a0 : a0 + (a1 - a0) * frac;
            out[n] = amplitude * pressureGain;
        }
        return out;
    }

    _aspirationEnvelope(physiology, chunkStartSample, pressureGain) {
        const cfg = this.config;
        const S = cfg.chunkSamples;
        if (!this._aspScratch || this._aspScratch.length !== S) this._aspScratch = new Float32Array(S);
        const out = this._aspScratch;
        const amp = physiology.constrictionAmplitude;
        const index = physiology.constrictionIndex;
        const ee = physiology.ee;
        const release = physiology.releaseAspiration;
        const last = physiology.totalFrames - 1;
        const samplesPerFrame = cfg.sampleRate / physiology.frameRateHz;
        for (let n = 0; n < S; n++) {
            const framePos = (chunkStartSample + n) / samplesPerFrame;
            const f0 = Math.min(last, Math.max(0, Math.floor(framePos)));
            const f1 = Math.min(last, f0 + 1);
            const frac = Math.min(1, Math.max(0, framePos - f0));
            const a0 = index[f0] < 0 ? amp[f0] : 0;
            const a1 = index[f1] < 0 ? amp[f1] : 0;
            const amplitude = a0 + (a1 - a0) * frac;
            const ee0 = ee[f0];
            const ee1 = ee[f1];
            const eeSample = ee0 + (ee1 - ee0) * frac;
            // Breath-like aspiration (HH, BREATH) runs at full strength regardless
            // of voicing. Voiced aspiration (vowels) must track the glottal source
            // amplitude: at a voicing onset the source is tiny, and a fixed
            // aspiration level would dominate and sound like a fricative (E -> "Vee").
            const isBreathLike = amplitude > 0.5;
            const sampleBaseline = (isBreathLike ? 0.05 : 0.005) * pressureGain;
            const voicedScale = isBreathLike ? 1.0 : Math.min(1.0, eeSample);
            const r0 = release?.[f0] ?? 0, r1 = release?.[f1] ?? 0;
            const previousRelease = release?.[Math.max(0, f0 - 1)] ?? r0;
            // Open the glottal noise envelope causally over its first frame.
            // A full-strength step pumps noise behind the still-opening P
            // closure and produced a near-clipped spike before its vowel.
            const attack = r0 > previousRelease ? previousRelease + (r0 - previousRelease) * frac : r0;
            const releaseAmplitude = Math.min(attack, r1 > r0 ? r0 : r0 + (r1 - r0) * frac);
            out[n] = (sampleBaseline + amplitude * pressureGain) * voicedScale
                + releaseAmplitude * pressureGain;
        }
        return out;
    }

    /** The transient's share of the authoritative, possibly caller-edited envelope. */
    _releaseBurstContribution(physiology, event, sample) {
        const position = sample * physiology.frameRateHz / this.config.sampleRate;
        const frame = Math.floor(position);
        const next = Math.min(physiology.totalFrames - 1, frame + 1);
        if (frame < 0 || frame >= physiology.totalFrames) return 0;
        const a0 = physiology.constrictionIndex[frame] >= 0 ? physiology.constrictionAmplitude[frame] : 0;
        const a1 = physiology.constrictionIndex[next] >= 0 ? physiology.constrictionAmplitude[next] : 0;
        const fraction = a1 > a0 ? 0 : position - frame;
        const i = frame - event.frame, j = next - event.frame;
        const first = i < 0 || i >= event.amplitudes.length ? 0
            : Math.min(a0, event.amplitudes[i] * a0 / event.combinedAmplitudes[i]);
        const second = j < 0 || j >= event.amplitudes.length ? 0
            : Math.min(a1, event.amplitudes[j] * a1 / event.combinedAmplitudes[j]);
        return first + (second - first) * fraction;
    }

    /**
     * Align authored stop transients with the geometry the solver actually sees.
     * Optional metadata never changes manual streams. Steady noise and aspiration
     * keep their original clocks; an event that would steal another oral source's
     * dispatch-wide junction stays on its original path.
     */
    _releaseBurstSchedule(physiology) {
        const events = physiology.releaseBursts;
        if (events === undefined) return [];
        if (!Array.isArray(events) || events.length > physiology.totalFrames) {
            throw new TypeError('ParticleVoiceModel: releaseBursts must be a bounded event array');
        }
        if (events.length === 0) return [];
        const cfg = this.config;
        if (!Number.isInteger(physiology.totalFrames) || physiology.totalFrames <= 0
            || !Number.isFinite(physiology.frameRateHz) || physiology.frameRateHz <= 0
            || physiology.sampleRate !== cfg.sampleRate
            || physiology.numSections !== cfg.numSections
            || physiology.constrictionAmplitude?.length !== physiology.totalFrames
            || physiology.constrictionIndex?.length !== physiology.totalFrames) {
            throw new RangeError('ParticleVoiceModel: release bursts require a complete, matching physiology clock');
        }
        const samplesPerFrame = cfg.sampleRate / physiology.frameRateHz;
        const framesPerChunk = cfg.chunkSamples / samplesPerFrame;
        const totalSamples = Math.ceil(physiology.totalFrames / framesPerChunk) * cfg.chunkSamples;
        const controls = new Map();
        const controlAt = (chunk) => {
            if (!controls.has(chunk)) {
                const start = Math.min(physiology.totalFrames - 1, Math.floor(chunk * framesPerChunk));
                const end = Math.min(physiology.totalFrames, Math.max(start + 1, Math.floor((chunk + 1) * framesPerChunk)));
                controls.set(chunk, this._decimateChunk(physiology, start, end));
            }
            return controls.get(chunk);
        };
        const schedule = [];
        let previousEndFrame = 0;
        for (const originalEvent of events) {
            let event = originalEvent;
            let count = event?.amplitudes?.length;
            if (!Number.isInteger(event?.frame) || event.frame < previousEndFrame
                || !Number.isInteger(event?.section) || event.section < 0 || event.section >= physiology.numSections - 1
                || !['stop', 'affricate'].includes(event?.originManner)
                || !Array.isArray(event.amplitudes) || !count || event.frame + count > physiology.totalFrames
                || !Array.isArray(event.combinedAmplitudes) || event.combinedAmplitudes.length !== count
                || !Array.isArray(event.combinedIndices) || event.combinedIndices.length !== count
                || event.steadyIndices !== undefined && (!Array.isArray(event.steadyIndices) || event.steadyIndices.length !== count)) {
                throw new RangeError('ParticleVoiceModel: invalid release burst timeline or snapshots');
            }
            previousEndFrame = event.frame + count;
            let unchangedRouting = true, singleJunction = true;
            for (let i = 0; i < count; i++) {
                const amplitude = event.amplitudes[i], combined = event.combinedAmplitudes[i], index = event.combinedIndices[i];
                const current = physiology.constrictionAmplitude[event.frame + i];
                if (!Number.isFinite(amplitude) || amplitude <= 0 || !Number.isFinite(combined)
                    || combined <= 0 || amplitude > combined + 1e-6 || !Number.isInteger(index)
                    || index < -1 || index >= physiology.numSections - 1 || !Number.isFinite(current) || current < 0) {
                    throw new RangeError('ParticleVoiceModel: invalid release burst amplitude or junction');
                }
                const steadyIndex = event.steadyIndices?.[i];
                if (event.steadyIndices !== undefined && (!Number.isInteger(steadyIndex) || steadyIndex < -1
                    || steadyIndex >= physiology.numSections - 1)) {
                    throw new RangeError('ParticleVoiceModel: invalid steady source junction');
                }
                unchangedRouting &&= physiology.constrictionIndex[event.frame + i] === index;
                singleJunction &&= index === event.section;
            }
            // The legacy renderer holds the final physiology frame through its
            // padded chunk. With no following frame there is no finite tail to
            // move; leave that explicitly authored ending unchanged.
            if (event.originManner !== 'stop' || !unchangedRouting || previousEndFrame === physiology.totalFrames) continue;
            // A fading stop burst and a stable oral fricative are distinct
            // sources. Keep their independent positions throughout the overlap.
            // Missing provenance, changing steady locations and caller route
            // edits retain the established single-source compatibility path.
            const steadyIndex = event.steadyIndices?.[0];
            const separate = Number.isInteger(steadyIndex) && steadyIndex >= 0 && steadyIndex !== event.section
                && event.steadyIndices.every((value, i) => value === steadyIndex
                    && event.combinedAmplitudes[i] > event.amplitudes[i]);
            if (!singleJunction && !separate) {
                // In K→S, the fading burst eventually shares S's junction. Its
                // first-frame component can still follow the opening K closure;
                // leave the remaining tail and steady S on their own clocks.
                // The dispatch conflict check below also rejects this smaller
                // component if its delayed tail would steal S's source junction.
                if (event.combinedIndices[0] !== event.section) continue;
                count = 1;
                event = { ...event, amplitudes: event.amplitudes.slice(0, count),
                    combinedAmplitudes: event.combinedAmplitudes.slice(0, count),
                    combinedIndices: event.combinedIndices.slice(0, count) };
            }
            const sourceStart = Math.ceil(event.frame * samplesPerFrame);
            const sourceEnd = Math.ceil((event.frame + count) * samplesPerFrame);
            let startSample = -1;
            // ParticleTract interpolates FLOAT32 reflection coefficients, not
            // target areas. Invert those same coefficients from the interpolated
            // inlet area to find the first sample whose whole tract is open.
            for (let c = Math.floor(sourceStart / cfg.chunkSamples); c * cfg.chunkSamples < sourceEnd && startSample < 0; c++) {
                const current = controlAt(c), previous = controlAt(Math.max(0, c - 1));
                const from = reflectionCoefficients(previous.areas), to = reflectionCoefficients(current.areas);
                for (let n = Math.max(0, sourceStart - c * cfg.chunkSamples); n < cfg.chunkSamples; n++) {
                    const fraction = n / Math.max(1, cfg.chunkSamples - 1);
                    let area = previous.areas[0] + (current.areas[0] - previous.areas[0]) * fraction;
                    let minimum = area;
                    for (let j = 0; j < from.length; j++) {
                        const k = from[j] + (to[j] - from[j]) * fraction;
                        area = (area * (1 - k) - k * 1e-6) / (1 + k);
                        minimum = Math.min(minimum, area);
                    }
                    if (minimum >= RELEASE_AREA_CM2) { startSample = c * cfg.chunkSamples + n; break; }
                }
            }
            if (startSample < 0) continue;
            const shiftSamples = startSample - sourceStart;
            const endSample = sourceEnd + shiftSamples;
            if (endSample > totalSamples) continue;
            let conflict = false;
            for (let c = Math.floor((separate ? sourceStart : startSample) / cfg.chunkSamples); c * cfg.chunkSamples < endSample; c++) {
                const control = controlAt(c);
                if (!separate && (control.constrictionIndex === event.section || control.constrictionIndex < 0)) continue;
                const original = this._fricationEnvelope(physiology, c * cfg.chunkSamples, 1);
                for (let n = 0; n < original.length; n++) {
                    const sample = c * cfg.chunkSamples + n;
                    if (original[n] - this._releaseBurstContribution(physiology, event, sample) <= 1e-6) continue;
                    if (!separate) { conflict = true; continue; }
                    const frame = Math.min(physiology.totalFrames - 1, Math.floor(sample / samplesPerFrame));
                    for (const f of [frame, Math.min(physiology.totalFrames - 1, frame + 1)]) {
                        const offset = f - event.frame;
                        const localIndex = offset >= 0 && offset < count ? event.steadyIndices[offset] : physiology.constrictionIndex[f];
                        if (physiology.constrictionAmplitude[f] > 0 && localIndex >= 0 && localIndex !== steadyIndex) conflict = true;
                    }
                }
            }
            if (schedule.some((other) => (separate || other.separate || other.event.section !== event.section)
                && Math.floor((separate || other.separate ? other.sourceStart : other.startSample) / cfg.chunkSamples)
                    <= Math.floor((endSample - 1) / cfg.chunkSamples)
                && Math.floor((separate || other.separate ? sourceStart : startSample) / cfg.chunkSamples)
                    <= Math.floor((other.endSample - 1) / cfg.chunkSamples))) conflict = true;
            if (!conflict) schedule.push({ event, sourceStart, sourceEnd, startSample, endSample, shiftSamples,
                ...(separate ? { separate: true, steadyIndex } : {}) });
        }
        return schedule;
    }

    _alignedFricationEnvelope(physiology, chunkStartSample, pressureGain, schedule, index) {
        const envelope = this._fricationEnvelope(physiology, chunkStartSample, pressureGain);
        let secondaryEnvelope = null, secondaryIndex = -1;
        for (const item of schedule) {
            const overlaps = chunkStartSample < item.endSample && chunkStartSample + envelope.length > item.startSample;
            if (!overlaps && (chunkStartSample >= item.sourceEnd || chunkStartSample + envelope.length <= item.sourceStart)) continue;
            if (item.separate) {
                index = item.steadyIndex;
                if (!this._secondaryFricScratch || this._secondaryFricScratch.length !== envelope.length) {
                    this._secondaryFricScratch = new Float32Array(envelope.length);
                }
                secondaryEnvelope = this._secondaryFricScratch;
                secondaryEnvelope.fill(0);
                secondaryIndex = item.event.section;
            } else if (overlaps) index = item.event.section;
            for (let n = 0; n < envelope.length; n++) {
                const sample = chunkStartSample + n;
                const original = this._releaseBurstContribution(physiology, item.event, sample);
                const aligned = sample >= item.startSample && sample < item.endSample
                    ? this._releaseBurstContribution(physiology, item.event, sample - item.shiftSamples) : 0;
                if (item.separate) {
                    envelope[n] = Math.max(0, envelope[n] - original * pressureGain);
                    secondaryEnvelope[n] = aligned * pressureGain;
                } else envelope[n] = Math.max(0, envelope[n] + (aligned - original) * pressureGain);
            }
        }
        return { envelope, index, secondaryEnvelope, secondaryIndex };
    }

    /**
     * Reduce the physiology frames covering one chunk to a single control set.
     * See the header: averaging vs majority is chosen per field because the
     * wrong reduction is audible.
     */
    _decimateChunk(physiology, startFrame, endFrame) {
        const S = physiology.numSections;
        const count = Math.max(1, endFrame - startFrame);
        const areas = new Float32Array(S);
        let t0 = 0, te = 0, tp = 0, ta = 0, ee = 0, pressure = 0, amplitude = 0, nasal = 0;
        // Constriction index is categorical, so vote rather than average.
        const votes = new Map();

        for (let f = startFrame; f < endFrame; f++) {
            const base = f * S;
            for (let s = 0; s < S; s++) areas[s] += physiology.areas[base + s];
            t0 += physiology.t0Samples[f];
            te += physiology.teSamples[f];
            tp += physiology.tpSamples[f];
            ta += physiology.taSamples[f];
            ee += physiology.ee[f];
            pressure += physiology.pressure[f];
            amplitude += physiology.constrictionAmplitude[f];
            nasal += physiology.nasalCoupling[f];
            const idx = physiology.constrictionIndex[f];
            votes.set(idx, (votes.get(idx) ?? 0) + 1);
        }
        for (let s = 0; s < S; s++) areas[s] /= count;

        let bestIndex = -1;
        let bestVotes = -1;
        for (const [idx, n] of votes) {
            // Ties favour an actual constriction over "none", so a brief stop
            // inside a chunk is not silently dropped.
            if (n > bestVotes || (n === bestVotes && idx > bestIndex)) { bestIndex = idx; bestVotes = n; }
        }

        return {
            areas,
            t0Samples: t0 / count,
            teSamples: te / count,
            tpSamples: tp / count,
            taSamples: ta / count,
            ee: ee / count,
            pressure: pressure / count,
            constrictionAmplitude: amplitude / count,
            nasalCoupling: nasal / count,
            constrictionIndex: bestIndex,
        };
    }

    /**
     * Render a physiology stream (from `ArticulationHead.predict`) to PCM.
     * Separate from `speak()` so a manual-articulator caller — the Voice Box
     * demo's manual mode — can drive the solver without going through text.
     *
     * @returns {Promise<{pcm: Float32Array, sampleRate: number, chunks: number}>}
     */
    async renderPhysiology(physiology, { signal = null, generation = this._synthesisGeneration } = {}) {
        this._assertNotDestroyed();
        const run = async () => {
            this._renderActive = true;
            try {
                return await this._renderPhysiologyNow(physiology, { signal, generation });
            } finally {
                this._renderActive = false;
                if (this._pendingDestroyTract) {
                    const pending = this._pendingDestroyTract;
                    this._pendingDestroyTract = null;
                    pending.destroy();
                }
            }
        };
        const operation = this._renderTail.then(run, run);
        // Keep the serialization chain usable after a rejected/aborted render.
        this._renderTail = operation.catch(() => {});
        return operation;
    }

    async _renderPhysiologyNow(physiology, { signal, generation }) {
        this._assertSynthesisActive(signal, generation);
        const cfg = this.config;
        // Validate before lazy GPU allocation so malformed caller metadata
        // cannot acquire solver resources and then fail partway through setup.
        const renderStartedAt = nowMs();
        const pressurePreparation = resolvePressurePreparation(physiology, cfg);
        const releaseBursts = this._releaseBurstSchedule(physiology);
        let aspiratedReleaseFrames = 0;
        if (physiology.releaseAspiration !== undefined) {
            if (physiology.releaseAspiration?.length !== physiology.totalFrames) {
                throw new RangeError('ParticleVoiceModel: releaseAspiration must contain one value per frame');
            }
            for (let frame = 0; frame < physiology.totalFrames; frame++) {
                const value = physiology.releaseAspiration[frame];
                if (!Number.isFinite(value) || value < 0) {
                    throw new RangeError('ParticleVoiceModel: releaseAspiration values must be finite and non-negative');
                }
                if (value > 0) aspiratedReleaseFrames++;
            }
        }
        const tract = this._tractInstance();
        const framesPerChunk = (cfg.chunkSamples / cfg.sampleRate) * physiology.frameRateHz;
        const totalChunks = Math.max(1, Math.ceil(physiology.totalFrames / framesPerChunk));
        let renderReadbackMs = 0;
        let visualReadbackMs = 0;

        const limiter = new SafetyLimiter({ sampleRate: cfg.sampleRate });
        const pcm = new Float32Array(totalChunks * cfg.chunkSamples);
        const lagRate = lagRateFromCompliance(cfg.compliance, cfg.sampleRate);
        // Text plans can prepare the private reservoir behind their existing
        // leading SIL, while the public physiology pressure remains honestly
        // zero. Manual physiology has no descriptor and therefore starts at
        // its authored first pressure exactly as before.
        let reservoirPressure = pressurePreparation
            ? pressurePreparation.targetPressure
            : (physiology.totalFrames > 0 ? physiology.pressure[0] : 0);

        const visualSnapshots = [];
        tract.reset();
        // NOTE: no fade-IN here, deliberately. `SafetyLimiter.reset()` leaves
        // the gain at unity by design, so `beginFadeIn()` on a fresh limiter
        // computes a step of (1 - 1)/n = 0 and does nothing at all. A fade-in
        // is also unnecessary: `textToPhonemeSequence`'s `padSilence` opens the
        // utterance with a `SIL`, and the waveguide starts from zeroed state,
        // so the PCM already begins at silence. Only the tail needs protecting.

        const controlsForChunk = (c, copyEnvelopes) => {
            const startFrame = Math.min(physiology.totalFrames - 1, Math.floor(c * framesPerChunk));
            const endFrame = Math.min(physiology.totalFrames, Math.max(startFrame + 1, Math.floor((c + 1) * framesPerChunk)));
            const control = this._decimateChunk(physiology, startFrame, endFrame);
            const chunkStartSample = c * cfg.chunkSamples;
            // A chunk that straddles speech onset stays silent in full. This
            // can hold the source for less than one chunk after the nominal
            // onset, but it can never expose aspiration or LF energy early.
            const sourceHeld = pressurePreparation !== null
                && chunkStartSample < pressurePreparation.sourceHeldUntilRelativeSample;

            // Breath reservoir: one-pole lag toward the target, advanced by a
            // whole chunk's worth of samples at once.
            const chunkLag = 1 - (1 - lagRate) ** cfg.chunkSamples;
            const reservoirTarget = sourceHeld
                ? pressurePreparation.targetPressure
                : control.pressure;
            reservoirPressure += (reservoirTarget - reservoirPressure) * chunkLag;
            const pressureGain = sourceHeld
                ? 0
                : Math.max(0, reservoirPressure) / cfg.referencePressure;

            // Derive the LF quotients FROM the head's emitted instants rather
            // than from a second copy of the config. If the two configs ever
            // drifted apart, the synthesized source would silently stop
            // matching the predicted physiology; deriving them makes that
            // impossible by construction.
            const t0 = Math.max(1e-3, control.t0Samples);
            const openQuotient = Math.min(0.95, Math.max(0.05, control.teSamples / t0));
            const peakQuotient = Math.min(0.95, Math.max(0.05, control.tpSamples / Math.max(1e-3, control.teSamples)));
            const returnQuotient = Math.min(0.95, Math.max(1e-4, control.taSamples / t0));

            // The excitation floor is LOAD-BEARING, not cosmetic. `ee` must be
            // strictly positive or `glottal_lf.js`'s Newton solve for alpha
            // divides by a zero derivative and yields NaN — and because the
            // waveguide's traveling-wave state persists across chunks, a single
            // NaN chunk poisons the entire rest of the utterance. Scaling by
            // `pressureGain` can reach exactly 0 (the utterance opens with a
            // `SIL` whose target pressure is 0), so `ArticulationHead`'s
            // UNVOICED_EE invariant has to be re-imposed HERE, at the point of
            // use, not merely where the value was produced.
            const excitation = Math.max(UNVOICED_EE, control.ee * pressureGain);
            const aspirationEnvelope = this._aspirationEnvelope(
                physiology,
                chunkStartSample,
                pressureGain,
            );
            const frication = this._alignedFricationEnvelope(
                physiology,
                chunkStartSample,
                pressureGain,
                releaseBursts,
                control.constrictionIndex,
            );
            const fricationEnvelope = frication.envelope;
            return {
                instances: [{
                    areas: control.areas,
                    nasalAreas: this._nasalAreas,
                    f0Hz: cfg.sampleRate / t0,
                    ee: excitation,
                    openQuotient,
                    peakQuotient,
                    returnQuotient,
                    // Post-LF gate: ee must remain positive for its Newton
                    // solve, but a prepared SIL prefix must emit no glottal
                    // source. Noise envelopes are independently zeroed by the
                    // held prefix's pressureGain above.
                    sourceGain: sourceHeld ? 0 : 1,
                    // The model's envelope helpers reuse one scratch array.
                    // A batch retains several control records until submission,
                    // so copy only in that path; the batch=1 reference keeps the
                    // original allocation behavior.
                    aspirationEnvelope: copyEnvelopes
                        ? Float32Array.from(aspirationEnvelope)
                        : aspirationEnvelope,
                    // PER-SAMPLE frication, sampled from the frame stream at
                    // absolute time rather than reduced to one value per chunk.
                    //
                    // Frication needs this separate treatment because stop
                    // release bursts put a one-frame spike in it, and
                    // `_decimateChunk` BOX-AVERAGING made that spike's height
                    // depend on chunk width (measured as 0.87 cosine similarity).
                    // Authored stop events are separately aligned to the first
                    // open sample of ParticleTract's interpolated geometry.
                    // Steady frication and manual streams retain their own
                    // per-sample event times and amplitudes.
                    fricationEnvelope: copyEnvelopes
                        ? Float32Array.from(fricationEnvelope)
                        : fricationEnvelope,
                    ...(frication.secondaryEnvelope ? { secondaryFricationEnvelope: copyEnvelopes
                        ? Float32Array.from(frication.secondaryEnvelope) : frication.secondaryEnvelope } : {}),
                }],
                constrictionIndex: frication.index,
                ...(frication.secondaryEnvelope ? { secondaryConstrictionIndex: frication.secondaryIndex } : {}),
                // The head's value is the physiological velum gesture. The
                // renderer applies one global acoustic compensation for the
                // current read-only-tap nasal approximation; see the config.
                nasalCoupling: control.nasalCoupling * cfg.nasalBranchGain,
            };
        };

        const batchingAvailable = cfg.renderBatchChunks > 1
            && typeof tract.beginChunkBatch === 'function'
            && typeof tract.readChunkBatch === 'function'
            && typeof tract.discardChunkBatch === 'function';
        const actualBatchChunks = batchingAvailable ? cfg.renderBatchChunks : 1;
        let readbackBatches = 0;

        if (!batchingAvailable) {
            for (let c = 0; c < totalChunks; c++) {
                this._assertSynthesisActive(signal, generation);
                const readbackStartedAt = nowMs();
                const rendered = await tract.renderChunk(controlsForChunk(c, false));
                renderReadbackMs += nowMs() - readbackStartedAt;
                readbackBatches += 1;
                // GPU work cannot be preempted once submitted. The post-readback
                // generation check prevents stale PCM delivery after barge-in.
                this._assertSynthesisActive(signal, generation);
                pcm.set(rendered.subarray(0, cfg.chunkSamples), c * cfg.chunkSamples);

                if (cfg.visualFramesPerChunk > 0) {
                    const visualStartedAt = nowMs();
                    const [snapshot] = await tract.readVisualSnapshots();
                    visualReadbackMs += nowMs() - visualStartedAt;
                    this._assertSynthesisActive(signal, generation);
                    if (snapshot) visualSnapshots.push(snapshot);
                }
            }
        } else {
            const pending = [];
            const drainOldest = async () => {
                const record = pending.shift();
                const batch = await tract.readChunkBatch(record.handle);
                this._assertSynthesisActive(signal, generation);
                pcm.set(batch.pcm, record.firstChunk * cfg.chunkSamples);
                visualSnapshots.push(...batch.visualSnapshots);
            };
            const batchedStartedAt = nowMs();
            try {
                for (let firstChunk = 0; firstChunk < totalChunks; firstChunk += actualBatchChunks) {
                    this._assertSynthesisActive(signal, generation);
                    const chunkCount = Math.min(actualBatchChunks, totalChunks - firstChunk);
                    const controls = [];
                    for (let offset = 0; offset < chunkCount; offset++) {
                        this._assertSynthesisActive(signal, generation);
                        controls.push(controlsForChunk(firstChunk + offset, true));
                    }
                    const handle = await tract.beginChunkBatch(controls, {
                        beforeEncode: () => this._assertSynthesisActive(signal, generation),
                    });
                    pending.push({ firstChunk, handle });
                    readbackBatches += 1;
                    if (pending.length >= BATCH_READBACK_SLOT_COUNT) await drainOldest();
                }
                while (pending.length > 0) await drainOldest();
            } catch (error) {
                // Stop/device-loss may arrive with one other slot still mapping.
                // Settle and unmap every handle before the serialized render tail
                // permits reset/reuse or deferred destroy of this tract.
                await Promise.allSettled(pending.map(({ handle }) => tract.discardChunkBatch(handle)));
                throw error;
            }
            renderReadbackMs += nowMs() - batchedStartedAt;
            // PCM and visualization share the same batch map; there is no
            // additional visualization-only readback latency in this path.
            visualReadbackMs = 0;
        }

        // ── Normalize, then limit ────────────────────────────────────────
        // Target LOUDNESS (rms), not peak — see `targetRms`'s note. The peak is
        // still measured, but only to bound the gain so transients reach the
        // limiter's soft knee instead of setting the whole utterance's level.
        this._assertSynthesisActive(signal, generation);
        const postProcessStartedAt = nowMs();
        let rawPeak = 0;
        let sumSquares = 0;
        for (let i = 0; i < pcm.length; i++) {
            const v = pcm[i];
            const a = Math.abs(v);
            if (a > rawPeak) rawPeak = a;
            sumSquares += v * v;
        }
        const rawRms = Math.sqrt(sumSquares / Math.max(1, pcm.length));
        let gain = 0;
        if (rawRms > 1e-9) {
            gain = Math.min(cfg.maxAutoGain, cfg.targetRms / rawRms);
            // Bound by the peak ceiling so a spiky render is not amplified into
            // continuous soft-clipping.
            if (rawPeak > 1e-9) gain = Math.min(gain, cfg.peakCeiling / rawPeak);
        }

        // The limiter carries persistent DC-filter and fade state, so it must
        // see the chunks in order, exactly once each.
        const scaled = new Float32Array(cfg.chunkSamples);
        for (let c = 0; c < totalChunks; c++) {
            this._assertSynthesisActive(signal, generation);
            const base = c * cfg.chunkSamples;
            for (let i = 0; i < cfg.chunkSamples; i++) scaled[i] = pcm[base + i] * gain;
            if (c === totalChunks - 1) limiter.beginFadeOut(cfg.fadeMs);
            pcm.set(limiter.process(scaled), base);
        }

        return {
            pcm,
            sampleRate: cfg.sampleRate,
            chunks: totalChunks,
            visualSnapshots,
            // Reported so a caller (and the Voice Lab) can see the solver's true
            // output level and the gain applied — the diagnostic that would have
            // made the original "everything is inaudible" bug obvious.
            rawPeak,
            rawRms,
            appliedGain: gain,
            diagnostics: Object.freeze({
                sourceId: PARTICLE_VOICE_EXPERIMENTAL_SOURCE.id,
                sampleRate: cfg.sampleRate,
                chunkSamples: cfg.chunkSamples,
                totalChunks,
                alignedReleaseCount: releaseBursts.length,
                separatedReleaseCount: releaseBursts.filter(event => event.separate).length,
                maxReleaseDelaySamples: releaseBursts.reduce((maximum, event) => Math.max(maximum, event.shiftSamples), 0),
                aspiratedReleaseFrames,
                pressurePreparation: pressurePreparation === null
                    ? null
                    : Object.freeze({
                        kind: pressurePreparation.kind,
                        leadingFrames: pressurePreparation.leadingFrames,
                        targetPressure: pressurePreparation.targetPressure,
                        absoluteSpeechStartSample: pressurePreparation.absoluteSpeechStartSample,
                        sourceHeldUntilRelativeSample: pressurePreparation.sourceHeldUntilRelativeSample,
                    }),
                renderReadbackMs,
                visualReadbackMs,
                renderBatchChunks: actualBatchChunks,
                readbackBatches,
                normalizeAndLimitMs: nowMs() - postProcessStartedAt,
                totalRenderMs: nowMs() - renderStartedAt,
            }),
        };
    }

    /**
     * Full text → physiology plan, without touching the GPU. Exposed so a
     * caller can inspect or override the plan (and so tests can check the
     * frontend/prosody path without a device).
     */
    planSequence(sequence, { normalized = null, startSample = 0 } = {}) {
        this._assertNotDestroyed();
        if (!Number.isInteger(startSample) || startSample < 0) {
            throw new RangeError('ParticleVoiceModel: startSample must be a non-negative integer');
        }
        assertSequenceShape(sequence);
        const cfg = this.config;
        const prosody = this.prosody.plan(sequence);
        const frames = this.regulator.expand(prosody, null);
        const physiology = this.articulation.predict(frames, sequence, {
            sampleRate: cfg.sampleRate,
            startSample,
            prepareLeadingSilence: true,
        });
        const wordBoundaries = deriveWordBoundaries(sequence, prosody, { sampleRate: cfg.sampleRate });
        return { normalized, sequence, prosody, frames, physiology, wordBoundaries };
    }

    /**
     * Song → physiology plan. Notes set each lyric's pitch and length; the
     * ordinary G2P, articulation and tract paths are unchanged. Consonants keep
     * their planned durations (capped at 60% of the note) and the vowels hold
     * the rest, as singers do. Pitch is flat per note with a short glide into
     * it and a delayed vibrato.
     * @param {{tempo: number, notes: Array<{text: string|null, midi: number|null, beats: number}>}} score `parseSong()` output
     */
    planSong(score, { vibratoHz = 5.5, vibratoSemitones = 0.3, vibratoDelayMs = 180, glideMs = 40, startSample = 0 } = {}) {
        this._assertNotDestroyed();
        if (!score || !Array.isArray(score.notes) || !score.notes.length || !Number.isFinite(score.tempo)) throw new TypeError('ParticleVoiceModel.planSong requires a parsed song score');
        if (![vibratoHz, vibratoSemitones, vibratoDelayMs, glideMs].every(Number.isFinite) || vibratoHz < 0 || vibratoHz > 9 || vibratoSemitones < 0 || vibratoSemitones > 1.5 || glideMs < 0 || glideMs > 200) {
            throw new RangeError('ParticleVoiceModel: vibrato 0-9 Hz, depth 0-1.5 semitones, glide 0-200 ms');
        }
        const cfg = this.config, silence = phonemeIdOf(STRUCTURAL_SYMBOLS.SILENCE);
        const ids = [silence], stress = [0], noteOf = [-1], words = [];
        let lastVowel = null;
        score.notes.forEach((note, index) => {
            if (note.kind === 'breath') { ids.push(phonemeIdOf(STRUCTURAL_SYMBOLS.BREATH)); stress.push(0); noteOf.push(index); return; }
            if (note.midi === null) { ids.push(silence); stress.push(0); noteOf.push(index); return; }
            // Legato: the previous vowel continues onto this note's pitch.
            if (note.kind === 'legato') {
                if (lastVowel === null) throw new RangeError('ParticleVoiceModel: a legato note needs a sung vowel before it');
                ids.push(lastVowel); stress.push(2); noteOf.push(index); return;
            }
            // "+" notes are placed with the word that owns them (below).
            if (note.kind === 'syllable') return;
            const pronounced = this.g2p.pronounce(note.text);
            if (!pronounced?.phonemeIds?.length) throw new RangeError(`ParticleVoiceModel: lyric "${note.text}" has no pronunciation`);
            const owners = [index];
            for (let next = index + 1; score.notes[next]?.kind === 'syllable'; next++) owners.push(next);
            const phonemeNote = syllableOwners(pronounced.phonemeIds, owners.length);
            const startPhoneme = ids.length;
            pronounced.phonemeIds.forEach((id, k) => { ids.push(id); stress.push(pronounced.stress[k] ?? 0); noteOf.push(owners[phonemeNote[k]]); if (isVowel(id)) lastVowel = id; });
            // A word with fewer syllables than notes holds its last vowel onto the extras.
            for (let extra = Math.max(...phonemeNote) + 1; extra < owners.length; extra++) { ids.push(lastVowel); stress.push(2); noteOf.push(owners[extra]); }
            words.push(Object.freeze({ text: note.text, phraseIndex: 0, startPhoneme, endPhoneme: ids.length, source: pronounced.source ?? 'rules', warnings: Object.freeze([]) }));
        });
        ids.push(silence); stress.push(0); noteOf.push(-1);
        const sequence = { phonemeIds: Uint8Array.from(ids), stress: Uint8Array.from(stress), punctuationContext: new Uint8Array(ids.length), words: Object.freeze(words), unresolved: [], warnings: Object.freeze([]) };
        assertSequenceShape(sequence);
        const planned = this.prosody.plan(sequence), durationFrames = Uint16Array.from(planned.durationFrames), f0Hz = Float32Array.from(planned.f0Hz);
        const framesPerBeat = (60 / score.tempo) * planned.frameRateHz;
        score.notes.forEach((note, index) => {
            const members = []; noteOf.forEach((owner, phoneme) => { if (owner === index) members.push(phoneme); });
            const total = Math.max(1, Math.round(note.beats * framesPerBeat));
            const vowels = members.filter((phoneme) => isVowel(ids[phoneme]));
            if (!vowels.length) { members.forEach((phoneme) => { durationFrames[phoneme] = Math.max(1, Math.round(total / members.length)); }); }
            else {
                const consonants = members.filter((phoneme) => !isVowel(ids[phoneme]));
                const consonantFrames = consonants.reduce((sum, phoneme) => sum + durationFrames[phoneme], 0), cap = Math.floor(total * .6);
                const shrink = consonantFrames > cap ? cap / consonantFrames : 1;
                let used = 0; for (const phoneme of consonants) { durationFrames[phoneme] = Math.max(1, Math.round(durationFrames[phoneme] * shrink)); used += durationFrames[phoneme]; }
                const each = Math.max(2, Math.floor((total - used) / vowels.length));
                vowels.forEach((phoneme) => { durationFrames[phoneme] = each; });
            }
            if (note.midi !== null) members.forEach((phoneme) => { f0Hz[phoneme] = midiToHz(note.midi); });
        });
        const prosody = { ...planned, durationFrames, f0Hz, totalFrames: durationFrames.reduce((a, b) => a + b, 0) };
        const frames = this.regulator.expand(prosody, null);
        // Flat pitch per note, a short glide in, and vibrato that starts after the attack.
        const noteStart = new Map(), hz = new Float32Array(frames.totalFrames), frameMs = 1000 / frames.frameRateHz;
        let previousHz = null;
        for (let f = 0; f < frames.totalFrames; f++) {
            const owner = noteOf[frames.frameToPhoneme[f]], note = score.notes[owner];
            if (!note || note.midi === null) { hz[f] = frames.frameF0Hz[f]; continue; }
            if (!noteStart.has(owner)) noteStart.set(owner, { frame: f, from: previousHz });
            const { frame: start, from } = noteStart.get(owner), t = (f - start) * frameMs, target = midiToHz(note.midi);
            let value = from !== null && t < glideMs ? from + (target - from) * (t / Math.max(1, glideMs)) : target;
            if (t > vibratoDelayMs) value *= 2 ** ((vibratoSemitones * Math.min(1, (t - vibratoDelayMs) / 150) * Math.sin(2 * Math.PI * vibratoHz * (t - vibratoDelayMs) / 1000)) / 12);
            hz[f] = value; previousHz = target;
        }
        frames.frameF0Hz = hz;
        const physiology = this.articulation.predict(frames, sequence, { sampleRate: cfg.sampleRate, startSample, prepareLeadingSilence: true });
        const wordBoundaries = deriveWordBoundaries(sequence, prosody, { sampleRate: cfg.sampleRate });
        return { normalized: null, sequence, prosody, frames, physiology, wordBoundaries, song: score };
    }

    /** Song → PCM. See `planSong` and `parseSong` (frontend/SongScore.js). */
    async sing(score, { expression = null, ...options } = {}) {
        this._assertNotDestroyed();
        // Expression shapes the singer's source (breath, tension, loudness); the score owns pitch and timing.
        const base = { prosody: this.prosody, articulation: this.articulation, targetRms: this.config.targetRms };
        try {
            if (expression && (expression.positive || expression.negative)) {
                const { modelOptions } = resolveExpression({ positive: expression.positive, negative: expression.negative, voicePreset: this.voicePreset.id, targetRms: base.targetRms });
                this.applyVoiceControls({ articulationConfig: modelOptions.articulationConfig, targetRms: modelOptions.targetRms });
                this.prosody = base.prosody;
            }
            const planned = this.planSong(score, options);
            const rendered = await this.renderPhysiology(planned.physiology, { signal: options.signal ?? null, generation: options.generation ?? this._synthesisGeneration });
            return { ...rendered, plan: planned };
        } finally { this.prosody = base.prosody; this.articulation = base.articulation; this.config.targetRms = base.targetRms; }
    }

    plan(text, { startSample = 0 } = {}) {
        this._assertNotDestroyed();
        const normalized = normalizeText(text);
        const sequence = textToPhonemeSequence(normalized, { g2p: this.g2p });
        return this.planSequence(sequence, { normalized, startSample });
    }

    /**
     * Text → PCM, the whole Phase 3 path.
     * @returns {Promise<{pcm: Float32Array, sampleRate: number, chunks: number, plan: object}>}
     */
    async speak(text, options = {}) {
        this._assertNotDestroyed();
        const planned = this.plan(text, options);
        const generation = options.generation ?? this._synthesisGeneration;
        const rendered = await this.renderPhysiology(planned.physiology, {
            signal: options.signal ?? null,
            generation,
        });
        return { ...rendered, plan: planned };
    }

    /** Explicit `PhonemeSequence` → PCM path for reviewed pronunciation/lab use. */
    async speakSequence(sequence, options = {}) {
        this._assertNotDestroyed();
        const planned = this.planSequence(sequence, options);
        const generation = options.generation ?? this._synthesisGeneration;
        const rendered = await this.renderPhysiology(planned.physiology, {
            signal: options.signal ?? null,
            generation,
        });
        return { ...rendered, plan: planned };
    }

    /**
     * Bounded sentence-at-a-time synthesis.  Each sentence keeps the existing
     * whole-utterance RMS normalization and authored acoustic constants;
     * streaming changes memory/latency boundaries, not the sound model.
     */
    async *streamSentences(text, options = {}) {
        this._assertNotDestroyed();
        const maxInputCharacters = boundedInteger(options.maxInputCharacters,
            DEFAULT_SENTENCE_STREAM_CONFIG.maxInputCharacters,
            { name: 'maxInputCharacters', min: 1, max: 65536 });
        const maxSentenceFrames = boundedInteger(options.maxSentenceFrames,
            DEFAULT_SENTENCE_STREAM_CONFIG.maxSentenceFrames,
            { name: 'maxSentenceFrames', min: 100, max: 6000 });
        if (typeof text !== 'string') throw new TypeError('ParticleVoiceModel.streamSentences requires text');
        if (text.length > maxInputCharacters) {
            throw new RangeError(`ParticleVoiceModel: input exceeds maxInputCharacters ${maxInputCharacters}`);
        }

        const signal = options.signal ?? null;
        const generation = options.generation ?? this._synthesisGeneration;
        this._assertSynthesisActive(signal, generation);
        const normalizeStartedAt = nowMs();
        const normalized = normalizeText(text);
        const units = sentenceUnits(normalized, this.g2p, options);
        const normalizationMs = nowMs() - normalizeStartedAt;
        if (units.length === 0) {
            throw new RangeError('ParticleVoiceModel: text contains no speakable sentence');
        }

        for (let index = 0; index < units.length; index++) {
            this._assertSynthesisActive(signal, generation);
            const unit = units[index];
            const planningStartedAt = nowMs();
            const sequence = textToPhonemeSequence(unit.normalized, { g2p: this.g2p });
            const planned = this.planSequence(sequence, { normalized: unit.normalized });
            if (planned.prosody.totalFrames > maxSentenceFrames) {
                throw new RangeError(`ParticleVoiceModel: sentence ${index} requires ${planned.prosody.totalFrames} frames, exceeding ${maxSentenceFrames}`);
            }
            const planningMs = nowMs() - planningStartedAt;
            const synthesisStartedAt = nowMs();
            const rendered = await this.renderPhysiology(planned.physiology, { signal, generation });
            this._assertSynthesisActive(signal, generation);
            yield Object.freeze({
                schema: 'particle-voice-sentence/v1',
                sourceId: PARTICLE_VOICE_EXPERIMENTAL_SOURCE.id,
                experimental: true,
                index,
                sentenceCount: units.length,
                text: unit.text,
                splitReason: unit.splitReason,
                pcm: rendered.pcm,
                sampleRate: rendered.sampleRate,
                chunks: rendered.chunks,
                visualSnapshots: rendered.visualSnapshots,
                rawPeak: rendered.rawPeak,
                rawRms: rendered.rawRms,
                appliedGain: rendered.appliedGain,
                wordBoundaries: Object.freeze(planned.wordBoundaries.slice()),
                plan: planned,
                diagnostics: Object.freeze({
                    normalizationMs: index === 0 ? normalizationMs : 0,
                    planningMs,
                    synthesisMs: nowMs() - synthesisStartedAt,
                    ...rendered.diagnostics,
                }),
            });
        }
    }

    /**
     * A script with inline tags ([calm] … [pause:1s] … [whispers] …) as a
     * sentence stream. Each speech segment is rendered with the call's overall
     * expression plus its tag's style; pauses are exact silence and breaths use
     * the BREATH token. The model's own controls are restored afterwards.
     * @param {string} script
     * @param {{positive?: string, negative?: string, pitchScale?: number, rateScale?: number, signal?: AbortSignal}} [options]
     */
    async *streamScript(script, { positive = '', negative = '', pitchScale = 1, rateScale = 1, ...options } = {}) {
        this._assertNotDestroyed();
        const { segments, unsupported } = parseScriptTags(script);
        if (!segments.some((segment) => segment.kind === 'speech')) throw new RangeError('ParticleVoiceModel: script contains no speakable text');
        const signal = options.signal ?? null, generation = options.generation ?? this._synthesisGeneration;
        const base = { prosody: this.prosody, articulation: this.articulation, targetRms: this.config.targetRms };
        const sampleRate = this.config.sampleRate, silence = (ms, index) => Object.freeze({
            schema: 'particle-voice-sentence/v1', sourceId: PARTICLE_VOICE_EXPERIMENTAL_SOURCE.id, experimental: true, index, text: '', splitReason: 'pause',
            pcm: new Float32Array(Math.round(ms * sampleRate / 1000)), sampleRate, chunks: 0, wordBoundaries: Object.freeze([]), plan: null, diagnostics: Object.freeze({}) });
        let index = 0;
        try {
            for (const segment of segments) {
                this._assertSynthesisActive(signal, generation);
                if (segment.kind === 'pause') { yield silence(segment.ms, index++); continue; }
                if (segment.kind === 'breath') {
                    const planned = this._planBreath(), rendered = await this.renderPhysiology(planned.physiology, { signal, generation });
                    yield Object.freeze({ schema: 'particle-voice-sentence/v1', sourceId: PARTICLE_VOICE_EXPERIMENTAL_SOURCE.id, experimental: true, index: index++, text: '', splitReason: 'breath',
                        pcm: rendered.pcm, sampleRate: rendered.sampleRate, chunks: rendered.chunks, wordBoundaries: Object.freeze([]), plan: planned, diagnostics: Object.freeze({ ...rendered.diagnostics }) });
                    continue;
                }
                // Neutral segments keep the model's own (possibly caller-tuned) controls.
                let receipt = null;
                if (positive || negative || segment.style.length || pitchScale !== 1 || rateScale !== 1) {
                    const resolved = resolveExpression({ positive: [positive, ...segment.style].filter(Boolean).join(' '), negative,
                        voicePreset: this.voicePreset.id, targetRms: base.targetRms, pitchScale, rateScale });
                    this.applyVoiceControls(resolved.modelOptions); receipt = resolved.receipt;
                } else { this.prosody = base.prosody; this.articulation = base.articulation; this.config.targetRms = base.targetRms; }
                for await (const unit of this.streamSentences(segment.text, { ...options, signal, generation })) {
                    yield Object.freeze({ ...unit, index: index++, style: segment.style, expression: receipt, unsupportedTags: unsupported });
                }
            }
        } finally {
            this.prosody = base.prosody; this.articulation = base.articulation; this.config.targetRms = base.targetRms;
        }
    }

    /** One breath (the structural BREATH token between silences), planned directly: it has no speech phoneme. */
    _planBreath() {
        const silence = phonemeIdOf(STRUCTURAL_SYMBOLS.SILENCE), breath = phonemeIdOf(STRUCTURAL_SYMBOLS.BREATH);
        const sequence = { phonemeIds: Uint8Array.of(silence, breath, silence), stress: new Uint8Array(3), punctuationContext: new Uint8Array(3), words: Object.freeze([]), unresolved: [], warnings: Object.freeze([]) };
        const prosody = this.prosody.plan(sequence), frames = this.regulator.expand(prosody, null);
        const physiology = this.articulation.predict(frames, sequence, { sampleRate: this.config.sampleRate, startSample: 0, prepareLeadingSilence: false });
        return { normalized: null, sequence, prosody, frames, physiology, wordBoundaries: [] };
    }

    /** Invalidate every queued/in-flight render. Submitted GPU work may finish, but its result is discarded. */
    cancel() {
        this._assertNotDestroyed();
        this._synthesisGeneration += 1;
        return this._synthesisGeneration;
    }

    destroy() {
        if (this._destroyed) return;
        this._synthesisGeneration += 1;
        const tract = this._tract;
        this._tract = null;
        this._destroyed = true;
        // Do not destroy a mapped staging buffer out from under an in-flight
        // readback. The generation check prevents delivery; this tail releases
        // GPU resources as soon as that operation unwinds.
        if (tract) {
            if (this._renderActive) this._pendingDestroyTract = tract;
            else tract.destroy();
        }
    }

    _assertSynthesisActive(signal, generation) {
        if (this._destroyed) throw new Error('ParticleVoiceModel: used after destroy()');
        if (signal?.aborted) throw abortError(signal.reason);
        if (generation !== this._synthesisGeneration) throw abortError();
    }

    _assertNotDestroyed() {
        if (this._destroyed) throw new Error('ParticleVoiceModel: used after destroy()');
    }
}

export default ParticleVoiceModel;
