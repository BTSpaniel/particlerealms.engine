// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * PhonemeSet.js — Phase 3 ParticleVoice text frontend.
 *
 * The executable form of `spec/PhonemeSet-v0.md`: the English phoneme
 * inventory, its per-entry articulatory feature vectors, the stress scale,
 * and the punctuation-context tags. This module is the SINGLE SOURCE OF
 * TRUTH every other Phase 3 component reads — `PronunciationLexicon.js`
 * validates against it, `G2PModel.js` targets it, `PhonemeEncoder.js` sizes
 * its embedding table from `PHONEME_COUNT`, and `ArticulationHead.js`
 * consumes the feature vectors to bias `NeuralPhysiologyState`.
 *
 * ## Corrections to `spec/PhonemeSet-v0.md`
 *
 * Encoding the spec surfaced four places where its §1 tables (the actual
 * data) disagree with its §1 summary line or its §2 enum declarations. The
 * tables are treated as normative and the spec has been corrected to match;
 * each is recorded here because a reader comparing the two must know which
 * way the discrepancy was resolved.
 *
 *  1. **Inventory size.** §1 claimed "24 vowel symbols + 24 consonant
 *     symbols + 3 structural tokens = 51" and `u8` IDs `0..50`. The tables
 *     actually list **10 monophthongs + 5 diphthongs = 15 vowels**, so the
 *     real total is **42** entries, IDs `0..41`. "24 vowel symbols" appears
 *     to be an accidental duplication of the consonant count. This matters
 *     concretely: it sets `PhonemeEncoder.js`'s embedding table size and the
 *     legal `phonemeIds` range in `spec/VoicePlan-v0.md` §4, both of which
 *     were also stated as 51/`0..50` and are now corrected.
 *  2. **Vowel height values.** §2 declares `height: low | mid | high`, but
 *     §1's table also uses `low-mid` (`AO`) and `high-mid` (`UH`). All five
 *     values are kept (see `HEIGHT`); the narrower §2 enum was the error.
 *  3. **`ER`'s rounded column** contains `rhotic`, which is not a
 *     rounded-ness value at all. Modeled here as `rounded: false` plus a
 *     separate `rhotic: true` flag, since rhoticity is an independent
 *     articulatory property (it shapes the area profile rather than the lip
 *     aperture).
 *  4. **`W`'s place** is `bilabial-velar` in §1's table, which is not one of
 *     §2's `place` values. Modeled as `place: 'bilabial'` with
 *     `secondaryPlace: 'velar'`, preserving the information without
 *     inventing an enum member the spec does not define.
 *
 * Structural tokens (`SIL`/`SP`/`BREATH`) carry `place: null`,
 * `manner: null`, `voiced: false` and are identified by
 * `category === 'structural'` — deliberately NOT given invented enum values,
 * since §2's `place`/`manner` enums describe articulated speech sounds only.
 */

/** §3: per-vowel-instance stress, separate from the phoneme symbol. */
export const STRESS = Object.freeze({ UNSTRESSED: 0, SECONDARY: 1, PRIMARY: 2 });

/** §4: punctuation-context tag ids, emitted per phoneme by `TextNormalizer.js`. */
export const PUNCTUATION_CONTEXT = Object.freeze({
    none: 0,
    comma: 1,
    period: 2,
    question: 3,
    exclamation: 4,
    paragraph: 5,
});

export const PLACE = Object.freeze({
    BILABIAL: 'bilabial',
    LABIODENTAL: 'labiodental',
    DENTAL: 'dental',
    ALVEOLAR: 'alveolar',
    POSTALVEOLAR: 'postalveolar',
    PALATAL: 'palatal',
    VELAR: 'velar',
    GLOTTAL: 'glottal',
});

export const MANNER = Object.freeze({
    STOP: 'stop',
    FRICATIVE: 'fricative',
    AFFRICATE: 'affricate',
    NASAL: 'nasal',
    APPROXIMANT: 'approximant',
    VOWEL: 'vowel',
});

/** Includes §1's `low-mid`/`high-mid`, which §2's three-value enum omitted (correction 2). */
export const HEIGHT = Object.freeze({
    LOW: 'low',
    LOW_MID: 'low-mid',
    MID: 'mid',
    HIGH_MID: 'high-mid',
    HIGH: 'high',
});

export const BACKNESS = Object.freeze({ FRONT: 'front', CENTRAL: 'central', BACK: 'back' });

/**
 * §2: place → normalized position (0 = glottis, 1 = lips) of the narrowest
 * point, fed to `shapedAreaProfile`'s control points. Provisional estimates
 * per the spec's own §6 — NOT measured against vocal-tract MRI data.
 */
export const PLACE_POSITION = Object.freeze({
    [PLACE.GLOTTAL]: 0.0,
    [PLACE.VELAR]: 0.3,
    [PLACE.POSTALVEOLAR]: 0.55,
    [PLACE.PALATAL]: 0.55,
    [PLACE.ALVEOLAR]: 0.65,
    [PLACE.DENTAL]: 0.75,
    [PLACE.LABIODENTAL]: 0.9,
    [PLACE.BILABIAL]: 1.0,
});

const V = (symbol, height, backness, rounded, extra = {}) => ({
    symbol, category: 'vowel', manner: MANNER.VOWEL, place: null, voiced: true,
    height, backness, rounded, rhotic: false, glide: null, ...extra,
});

const DIPH = (symbol, from, to) => ({
    symbol, category: 'vowel', manner: MANNER.VOWEL, place: null, voiced: true,
    // A diphthong's own height/backness/rounded are undefined: it IS the
    // timed glide between its two target monophthongs' profiles (§1).
    height: null, backness: null, rounded: null, rhotic: false, glide: Object.freeze([from, to]),
});

const C = (symbol, place, manner, voiced, extra = {}) => ({
    symbol, category: 'consonant', place, manner, voiced,
    height: null, backness: null, rounded: null, rhotic: false, glide: null, ...extra,
});

const STRUCT = (symbol) => ({
    symbol, category: 'structural', place: null, manner: null, voiced: false,
    height: null, backness: null, rounded: null, rhotic: false, glide: null,
});

/**
 * The inventory, in `spec/PhonemeSet-v0.md` §1 table order. **Array index IS
 * the `u8` phoneme id** — appending is safe, reordering is a breaking change
 * to every trained embedding table.
 */
export const PHONEMES = Object.freeze([
    // ── Vowels: monophthongs (10) ────────────────────────────────────────
    V('AA', HEIGHT.LOW, BACKNESS.BACK, false),
    V('AE', HEIGHT.LOW, BACKNESS.FRONT, false),
    V('AH', HEIGHT.MID, BACKNESS.CENTRAL, false),
    V('AO', HEIGHT.LOW_MID, BACKNESS.BACK, true),
    V('EH', HEIGHT.MID, BACKNESS.FRONT, false),
    V('ER', HEIGHT.MID, BACKNESS.CENTRAL, false, { rhotic: true }),
    V('IH', HEIGHT.HIGH, BACKNESS.FRONT, false),
    V('IY', HEIGHT.HIGH, BACKNESS.FRONT, false),
    V('UH', HEIGHT.HIGH_MID, BACKNESS.BACK, true),
    V('UW', HEIGHT.HIGH, BACKNESS.BACK, true),
    // ── Vowels: diphthongs (5) ───────────────────────────────────────────
    DIPH('AW', 'AA', 'UH'),
    DIPH('AY', 'AA', 'IH'),
    DIPH('EY', 'EH', 'IH'),
    DIPH('OW', 'AO', 'UH'),
    DIPH('OY', 'AO', 'IH'),
    // ── Consonants: stops (6) ────────────────────────────────────────────
    C('P', PLACE.BILABIAL, MANNER.STOP, false),
    C('B', PLACE.BILABIAL, MANNER.STOP, true),
    C('T', PLACE.ALVEOLAR, MANNER.STOP, false),
    C('D', PLACE.ALVEOLAR, MANNER.STOP, true),
    C('K', PLACE.VELAR, MANNER.STOP, false),
    C('G', PLACE.VELAR, MANNER.STOP, true),
    // ── Consonants: fricatives (8) ───────────────────────────────────────
    C('F', PLACE.LABIODENTAL, MANNER.FRICATIVE, false),
    C('V', PLACE.LABIODENTAL, MANNER.FRICATIVE, true),
    C('TH', PLACE.DENTAL, MANNER.FRICATIVE, false),
    C('DH', PLACE.DENTAL, MANNER.FRICATIVE, true),
    C('S', PLACE.ALVEOLAR, MANNER.FRICATIVE, false),
    C('Z', PLACE.ALVEOLAR, MANNER.FRICATIVE, true),
    C('SH', PLACE.POSTALVEOLAR, MANNER.FRICATIVE, false),
    C('ZH', PLACE.POSTALVEOLAR, MANNER.FRICATIVE, true),
    // ── Consonants: affricates (2) ───────────────────────────────────────
    C('CH', PLACE.POSTALVEOLAR, MANNER.AFFRICATE, false),
    C('JH', PLACE.POSTALVEOLAR, MANNER.AFFRICATE, true),
    // ── Consonants: glottal fricative / aspiration (1) ───────────────────
    C('HH', PLACE.GLOTTAL, MANNER.FRICATIVE, false),
    // ── Consonants: nasals (3) ───────────────────────────────────────────
    C('M', PLACE.BILABIAL, MANNER.NASAL, true),
    C('N', PLACE.ALVEOLAR, MANNER.NASAL, true),
    C('NG', PLACE.VELAR, MANNER.NASAL, true),
    // ── Consonants: approximants (4) ─────────────────────────────────────
    C('L', PLACE.ALVEOLAR, MANNER.APPROXIMANT, true, { lateral: true }),
    C('R', PLACE.ALVEOLAR, MANNER.APPROXIMANT, true, { rhotic: true }),
    C('W', PLACE.BILABIAL, MANNER.APPROXIMANT, true, { secondaryPlace: PLACE.VELAR }),
    C('Y', PLACE.PALATAL, MANNER.APPROXIMANT, true),
    // ── Structural tokens (3) ────────────────────────────────────────────
    STRUCT('SIL'),
    STRUCT('SP'),
    STRUCT('BREATH'),
].map((entry, id) => Object.freeze({ ...entry, id })));

/** 42 — sizes `PhonemeEncoder.js`'s embedding table. See correction 1. */
export const PHONEME_COUNT = PHONEMES.length;

/** Highest legal `u8` phoneme id (41). */
export const MAX_PHONEME_ID = PHONEME_COUNT - 1;

const SYMBOL_TO_ID = new Map(PHONEMES.map((p) => [p.symbol, p.id]));

export const STRUCTURAL_SYMBOLS = Object.freeze({ SILENCE: 'SIL', SHORT_PAUSE: 'SP', BREATH: 'BREATH' });

/** @returns {number} The id for `symbol`. Throws on an unknown symbol rather than returning a sentinel, so a G2P/lexicon typo fails loudly instead of silently synthesizing the wrong phone. */
export function phonemeIdOf(symbol) {
    const id = SYMBOL_TO_ID.get(symbol);
    if (id === undefined) throw new RangeError(`PhonemeSet: unknown phoneme symbol '${symbol}'`);
    return id;
}

export function hasPhoneme(symbol) {
    return SYMBOL_TO_ID.has(symbol);
}

/** @returns {object} The frozen entry for `id`. */
export function phonemeAt(id) {
    if (!Number.isInteger(id) || id < 0 || id > MAX_PHONEME_ID) {
        throw new RangeError(`PhonemeSet: phoneme id must be an integer in [0, ${MAX_PHONEME_ID}], got ${id}`);
    }
    return PHONEMES[id];
}

export function phonemeBySymbol(symbol) {
    return PHONEMES[phonemeIdOf(symbol)];
}

export const isVowel = (id) => phonemeAt(id).category === 'vowel';
export const isConsonant = (id) => phonemeAt(id).category === 'consonant';
export const isStructural = (id) => phonemeAt(id).category === 'structural';
export const isVoiced = (id) => phonemeAt(id).voiced;
export const isDiphthong = (id) => phonemeAt(id).glide !== null;

/**
 * @returns {{ fromId: number, toId: number }|null} The two monophthong
 * targets a diphthong glides between (§1), as ids ready for area-profile
 * interpolation; `null` for every non-diphthong.
 */
export function diphthongTargetIds(id) {
    const { glide } = phonemeAt(id);
    if (!glide) return null;
    return { fromId: phonemeIdOf(glide[0]), toId: phonemeIdOf(glide[1]) };
}

/**
 * @returns {number|null} The normalized 0..1 constriction position for
 * `id`'s place of articulation, or `null` for vowels and structural tokens
 * (which have no single narrowest point — a vowel's whole area profile is
 * its target).
 */
export function constrictionPositionOf(id) {
    const { place } = phonemeAt(id);
    if (place === null) return null;
    const pos = PLACE_POSITION[place];
    if (pos === undefined) throw new Error(`PhonemeSet: no position mapping for place '${place}'`);
    return pos;
}

/** @returns {boolean} True if `stress` is one of §3's three legal values. */
export function isValidStress(stress) {
    return stress === STRESS.UNSTRESSED || stress === STRESS.SECONDARY || stress === STRESS.PRIMARY;
}

/** @returns {boolean} True if `tag` is one of §4's six legal punctuation-context ids. */
export function isValidPunctuationContext(tag) {
    return Number.isInteger(tag) && tag >= 0 && tag <= PUNCTUATION_CONTEXT.paragraph;
}

export default PHONEMES;
