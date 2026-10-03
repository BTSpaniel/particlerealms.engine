// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ProsodyPlanner.js — Phase 3 ParticleVoice model.
 *
 * Predicts per-phoneme **duration**, **F0** and a **voiced flag** from a
 * `PhonemeSequence` (`spec/VoicePlan-v0.md` §4), at the plan frame rate of
 * 100 Hz / 10 ms per frame that spec fixes.
 *
 * ## Rule-based, and the plan says "minimal"
 *
 * This is a deterministic rule model, not a trained one: durations come from
 * per-manner base values scaled by stress and boundary position, and F0 from a
 * declination line with stress excursions and a terminal contour selected by
 * punctuation context. Phase 3's goal is "a tiny deterministic single-speaker
 * model", and a learned duration/F0 predictor needs aligned speech data this
 * project does not have. The numbers below are therefore **plausible
 * phonetics, not measured values** — they are ordered correctly relative to
 * each other (stops shorter than fricatives, diphthongs longer than
 * monophthongs, stressed longer than unstressed), which is what makes speech
 * intelligible, but they are not fitted to any corpus. `plan()` takes an
 * optional `overrides` bag so a caller can retune without editing this file,
 * and the class boundary is where a learned predictor slots in.
 *
 * ## What it deliberately does not do
 *
 *   - **No per-phoneme F0 contour inside a phoneme.** One target per phoneme;
 *     smoothing into a continuous per-frame curve is `LengthRegulator.js`'s
 *     job, because that is where frame counts exist. Emitting a flat value per
 *     phoneme here and interpolating there avoids the audible pitch STEP that
 *     a naive per-phoneme hold would produce.
 *   - **No accent/emotion conditioning.** `spec/VoicePlan-v0.md` §3's
 *     factorized conditioning channels exist, but wiring them is Phase 4+;
 *     pretending to condition on them now would be fake.
 */

import {
    STRESS, PUNCTUATION_CONTEXT, MANNER,
    phonemeAt, isVowel, isStructural, isDiphthong,
} from '../frontend/PhonemeSet.js';

/** `spec/VoicePlan-v0.md` §5: the plan frame rate is 100 Hz (10 ms/frame). */
export const PLAN_FRAME_RATE_HZ = 100;
export const PLAN_FRAME_MS = 1000 / PLAN_FRAME_RATE_HZ;

/**
 * Base durations in MILLISECONDS by articulatory manner. Relative ordering is
 * the part that matters (see header); absolute values are plausible defaults.
 */
export const BASE_DURATION_MS = Object.freeze({
    [MANNER.STOP]: 70,
    [MANNER.FRICATIVE]: 110,
    [MANNER.AFFRICATE]: 115,
    [MANNER.NASAL]: 75,
    [MANNER.APPROXIMANT]: 65,
    monophthong: 95,
    diphthong: 140,
});

/** Structural-token durations, keyed by the punctuation context they sit at (spec §4's Effect column: comma-level is a short pause, terminals are full silences, a paragraph is longer still). */
// Lengthened after measurement: a streamed audit rendered only ~100 ms of silence at
// commas and ~390 ms between sentences (terminal SIL plus the next sentence's
// leading pad), which listeners reported as "not waiting". Read-aloud speech
// typically pauses a few hundred ms at commas and roughly half a second or more
// at sentence ends; these remain authored values, not a fitted speaker model.
export const STRUCTURAL_DURATION_MS = Object.freeze({
    SP: 220,
    SIL: {
        [PUNCTUATION_CONTEXT.none]: 60,
        [PUNCTUATION_CONTEXT.comma]: 200,
        [PUNCTUATION_CONTEXT.period]: 460,
        [PUNCTUATION_CONTEXT.question]: 460,
        [PUNCTUATION_CONTEXT.exclamation]: 420,
        [PUNCTUATION_CONTEXT.paragraph]: 720,
    },
    BREATH: 280,
});

export const DEFAULT_PROSODY_CONFIG = Object.freeze({
    baseF0Hz: 120,
    /** Total F0 fall across the utterance, as a fraction of `baseF0Hz`. Real speech declines; a flat line sounds robotic. */
    declinationRatio: 0.12,
    stressDurationScale: Object.freeze({
        [STRESS.UNSTRESSED]: 1.0,
        [STRESS.SECONDARY]: 1.15,
        [STRESS.PRIMARY]: 1.35,
    }),
    stressF0Scale: Object.freeze({
        [STRESS.UNSTRESSED]: 1.0,
        [STRESS.SECONDARY]: 1.07,
        [STRESS.PRIMARY]: 1.16,
    }),
    /**
     * English pre-fortis clipping: the vowel before a word-final voiceless
     * obstruent is shorter than before its voiced counterpart. Previously
     * feed/feet both held IY for 160 ms, removing this independent voicing cue.
     * Keating (1984), Language 60:293, reviews the contrast:
     * https://linguistics.ucla.edu/people/keating/keating1984.pdf
     * 0.75 is a conservative authored factor, not a fitted universal ratio.
     * It only applies with explicit word spans, at the final vowel directly
     * before an obstruent coda; no internal syllable boundaries are inferred.
     * Set 1 for an unchanged-duration diagnostic ablation.
     */
    preFortisVowelScale: 0.75,
    /** Pre-boundary lengthening on the last vowel of a phrase — one of the strongest real cues that a phrase is ending. */
    preBoundaryLengthening: Object.freeze({
        [PUNCTUATION_CONTEXT.none]: 1.0,
        [PUNCTUATION_CONTEXT.comma]: 1.18,
        [PUNCTUATION_CONTEXT.period]: 1.28,
        [PUNCTUATION_CONTEXT.question]: 1.28,
        [PUNCTUATION_CONTEXT.exclamation]: 1.22,
        [PUNCTUATION_CONTEXT.paragraph]: 1.32,
    }),
    /** Terminal F0 multiplier for each punctuated phrase: statements fall, questions rise. */
    terminalF0Scale: Object.freeze({
        [PUNCTUATION_CONTEXT.none]: 1.0,
        [PUNCTUATION_CONTEXT.comma]: 1.02,
        [PUNCTUATION_CONTEXT.period]: 0.82,
        [PUNCTUATION_CONTEXT.question]: 1.28,
        [PUNCTUATION_CONTEXT.exclamation]: 1.12,
        [PUNCTUATION_CONTEXT.paragraph]: 0.80,
    }),
    /** Ordinary wh-initial questions usually fall in American English (Hedberg
     * et al., 2010, https://www.isca-archive.org/speechprosody_2010/hedberg10_speechprosody.html).
     * This text heuristic
     * requires a multiword question; isolated/echo words retain the question
     * contour. Set to the question multiplier to ablate it without timing edits.
     */
    whQuestionF0Scale: 0.82,
    /**
     * Global speaking-rate multiplier: every planned duration, pauses included,
     * is divided by it. 1 keeps the authored timing. Bounded to [0.5, 2] because
     * the fastest articulatory gestures are coupled to the 4 ms control chunk.
     */
    speechRate: 1,
    /** Clamp so no rule combination can produce an unspeakable pitch. */
    minF0Hz: 60,
    maxF0Hz: 400,
    minDurationFrames: 1,
});

function baseDurationMsFor(id) {
    const entry = phonemeAt(id);
    if (entry.category === 'structural') return null; // handled by context
    if (entry.category === 'vowel') {
        return isDiphthong(id) ? BASE_DURATION_MS.diphthong : BASE_DURATION_MS.monophthong;
    }
    const ms = BASE_DURATION_MS[entry.manner];
    if (ms === undefined) throw new Error(`ProsodyPlanner: no base duration for manner '${entry.manner}' (${entry.symbol})`);
    return ms;
}

function structuralDurationMs(symbol, context) {
    if (symbol === 'SP') return STRUCTURAL_DURATION_MS.SP;
    if (symbol === 'BREATH') return STRUCTURAL_DURATION_MS.BREATH;
    const table = STRUCTURAL_DURATION_MS.SIL;
    return table[context] ?? table[PUNCTUATION_CONTEXT.none];
}

export class ProsodyPlanner {
    constructor(config = {}) {
        this.config = { ...DEFAULT_PROSODY_CONFIG, ...config };
        if (!Number.isFinite(this.config.whQuestionF0Scale)
            || this.config.whQuestionF0Scale < 0.5 || this.config.whQuestionF0Scale > 1.5) {
            throw new RangeError('ProsodyPlanner: whQuestionF0Scale must be in [0.5, 1.5]');
        }
        if (!Number.isFinite(this.config.preFortisVowelScale)
            || this.config.preFortisVowelScale < 0.5 || this.config.preFortisVowelScale > 1) {
            throw new RangeError('ProsodyPlanner: preFortisVowelScale must be in [0.5, 1]');
        }
        if (!Number.isFinite(this.config.speechRate)
            || this.config.speechRate < 0.5 || this.config.speechRate > 2) {
            throw new RangeError('ProsodyPlanner: speechRate must be in [0.5, 2]');
        }
    }

    /**
     * @param {{phonemeIds: ArrayLike<number>, stress: ArrayLike<number>, punctuationContext: ArrayLike<number>}} sequence
     * @returns {{durationFrames: Uint16Array, f0Hz: Float32Array, voiced: Uint8Array, totalFrames: number, frameRateHz: number}}
     */
    plan(sequence) {
        const { phonemeIds, stress, punctuationContext } = sequence ?? {};
        if (!phonemeIds || !stress || !punctuationContext) {
            throw new TypeError('ProsodyPlanner.plan requires {phonemeIds, stress, punctuationContext}');
        }
        const n = phonemeIds.length;
        if (stress.length !== n || punctuationContext.length !== n) {
            // spec §4 requires all three arrays to be the same length; a
            // mismatch means the frontend produced an inconsistent sequence.
            throw new RangeError(`ProsodyPlanner: array lengths must match (${n}/${stress.length}/${punctuationContext.length})`);
        }
        const cfg = this.config;
        const durationFrames = new Uint16Array(n);
        const f0Hz = new Float32Array(n);
        const voiced = new Uint8Array(n);
        if (n === 0) return { durationFrames, f0Hz, voiced, totalFrames: 0, frameRateHz: PLAN_FRAME_RATE_HZ };

        // Segment into phrases using STRUCTURAL TOKENS as the delimiters.
        //
        // `punctuationContext` alone cannot do this: adjacent phrases often
        // share a tag ("one, two, three" is comma, comma, period), so looking
        // for tag TRANSITIONS silently merges every run of same-tagged phrases
        // into one and drops the boundaries between them. The structural token
        // `TextNormalizer`/`textToPhonemeSequence` emit at each boundary (`SP`
        // for comma-level, `SIL` for terminals, `BREATH` before a paragraph
        // `SIL`) is the unambiguous marker, so segmentation keys off that.
        const segments = [];
        {
            let start = 0;
            for (let i = 0; i < n; i++) {
                if (!isStructural(phonemeIds[i])) continue;
                if (i > start) segments.push({ start, end: i, tag: punctuationContext[i] });
                start = i + 1;
            }
            // Trailing text with no closing structural token still forms a phrase.
            if (start < n) segments.push({ start, end: n, tag: punctuationContext[n - 1] });
        }

        // Index of the last VOWEL in each phrase, so pre-boundary lengthening
        // lands on the syllable that actually carries it rather than on a
        // trailing consonant.
        const lastVowelOfPhrase = new Int32Array(n).fill(-1);
        const wordsAtStart = new Map((sequence.words ?? []).map(word => [word.startPhoneme, word]));
        for (const segment of segments) {
            const first = wordsAtStart.get(segment.start);
            const second = first && wordsAtStart.get(first.endPhoneme);
            segment.whQuestion = segment.tag === PUNCTUATION_CONTEXT.question
                && /^(what|which|who|whom|whose|when|where|why|how)(?:['’](?:s|re|d|ll|ve))?$/i.test(first?.text ?? '')
                && !!second && second.endPhoneme <= segment.end;
            let lastVowel = -1;
            for (let j = segment.start; j < segment.end; j++) {
                if (isVowel(phonemeIds[j])) lastVowel = j;
            }
            if (lastVowel >= 0) lastVowelOfPhrase[lastVowel] = segment.tag;
        }

        // Word metadata is shared by the normal-text and reviewed-phoneme
        // frontend. Adjacent words have no structural phone between them, so
        // looking only at the next phone would incorrectly clip "see two".
        // Legacy/manual sequences without word spans keep their own timing.
        const preFortisVowel = new Uint8Array(n);
        for (const word of sequence.words ?? []) {
            const { startPhoneme: start, endPhoneme: end } = word;
            if (!Number.isInteger(start) || !Number.isInteger(end)
                || start < 0 || end > n || start >= end) continue;
            let vowel = end - 1;
            while (vowel >= start && phonemeAt(phonemeIds[vowel]).category === 'consonant') vowel -= 1;
            if (vowel < start || vowel + 1 >= end || !isVowel(phonemeIds[vowel])) continue;
            const coda = phonemeAt(phonemeIds[vowel + 1]);
            if (!coda.voiced && (coda.manner === MANNER.STOP
                || coda.manner === MANNER.FRICATIVE || coda.manner === MANNER.AFFRICATE)) {
                preFortisVowel[vowel] = 1;
            }
        }

        // ── Durations ────────────────────────────────────────────────────
        let totalFrames = 0;
        for (let i = 0; i < n; i++) {
            const id = phonemeIds[i];
            const entry = phonemeAt(id);
            let ms;
            if (entry.category === 'structural') {
                ms = structuralDurationMs(entry.symbol, punctuationContext[i]);
            } else {
                ms = baseDurationMsFor(id);
                ms *= cfg.stressDurationScale[stress[i]] ?? 1;
                const boundaryTag = lastVowelOfPhrase[i];
                if (boundaryTag >= 0) ms *= cfg.preBoundaryLengthening[boundaryTag] ?? 1;
                if (preFortisVowel[i]) ms *= cfg.preFortisVowelScale;
            }
            const frames = Math.max(cfg.minDurationFrames, Math.round(ms / cfg.speechRate / PLAN_FRAME_MS));
            durationFrames[i] = frames;
            totalFrames += frames;
        }

        // ── Voicing ──────────────────────────────────────────────────────
        for (let i = 0; i < n; i++) {
            const id = phonemeIds[i];
            // Structural tokens are silence/breath: never voiced.
            voiced[i] = (!isStructural(id) && phonemeAt(id).voiced) ? 1 : 0;
        }

        // ── F0 ───────────────────────────────────────────────────────────
        // Each punctuated phrase needs its own contour. Applying only the last
        // boundary left earlier questions/statements without their cues and
        // carried that contour into any following unpunctuated speech.
        // Follow the existing structural-token segmentation, not trailing
        // padding SIL's `none` tag. Keep the single-phrase calculation and its
        // silent tail unchanged; the next phrase owns its contour from onset.
        // Utterance declination and continuous LengthRegulator interpolation
        // remain unchanged, so this does not introduce word-boundary resets.
        let phraseIndex = 0;
        let elapsed = 0;
        for (let i = 0; i < n; i++) {
            const progress = totalFrames > 0 ? elapsed / totalFrames : 0;
            let hz = cfg.baseF0Hz * (1 - cfg.declinationRatio * progress);
            hz *= cfg.stressF0Scale[stress[i]] ?? 1;
            while (phraseIndex + 1 < segments.length && i >= segments[phraseIndex + 1].start) phraseIndex += 1;
            const phrase = segments[phraseIndex];
            if (phrase && i >= phrase.start && phrase.tag !== PUNCTUATION_CONTEXT.none) {
                const terminalScale = phrase.whQuestion ? cfg.whQuestionF0Scale
                    : cfg.terminalF0Scale[phrase.tag] ?? 1;
                const t = (i - phrase.start) / Math.max(1, phrase.end - phrase.start);
                hz *= 1 + (terminalScale - 1) * t;
            }
            f0Hz[i] = Math.min(cfg.maxF0Hz, Math.max(cfg.minF0Hz, hz));
            elapsed += durationFrames[i];
        }

        return { durationFrames, f0Hz, voiced, totalFrames, frameRateHz: PLAN_FRAME_RATE_HZ };
    }
}

export function createProsodyPlanner(config) {
    return new ProsodyPlanner(config);
}

export default ProsodyPlanner;
