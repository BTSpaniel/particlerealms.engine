// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * G2PModel.js — Phase 3 ParticleVoice text frontend.
 *
 * Grapheme-to-phoneme fallback for words `PronunciationLexicon.js` does not
 * cover, plus `textToPhonemeSequence()` — the deterministic lowering
 * `spec/VoicePlan-v0.md` §4 describes, which turns raw text into the
 * `{ phonemeIds, stress, punctuationContext }` triple the model consumes.
 *
 * ## It is rules, not a network — deliberately
 *
 * The plan calls for a "minimal `G2PModel.js`" in Phase 3, and this is a
 * **deterministic, context-sensitive letter-to-sound rule set**, not a
 * trained model. That is the honest choice at this stage: a neural G2P needs
 * a pronunciation corpus to train against, and this project vendors no
 * external data (CMUdict included). Rules give reproducible output today, and
 * the class boundary here is what a learned model would later slot into
 * without touching callers. The name matches the plan's; the implementation
 * does not pretend to be learned.
 *
 * ## Accuracy expectations, stated plainly
 *
 * English orthography is not a function of spelling alone, so a rule set of
 * this size gets the regular cases right and a meaningful minority wrong
 * (`read` has two pronunciations; `bread` breaks the `ea → IY` rule; stress
 * placement in long words is genuinely lexical). That is exactly why
 * `PronunciationLexicon.js` exists and is consulted FIRST — every word whose
 * spelling actively lies belongs there. G2P's job is to make unseen words
 * (character names, invented words, rare vocabulary) pronounceable and
 * stable, not to be a dictionary.
 *
 * ## Rule format
 *
 * Each rule is `[leftContext, target, rightContext, phonemes]`, tried in
 * order at each position, first match winning. Rules are authored
 * longest-target-first per letter so digraphs beat single letters. The
 * context pattern language is deliberately tiny — three metacharacters, no
 * regex — so a rule's behaviour is obvious by inspection:
 *
 *   `#` word boundary (start of a left context, end of a right context)
 *   `C` exactly one consonant letter
 *   `V` exactly one vowel letter
 *   anything else, a literal letter
 *
 * Stress is assigned afterwards by syllable heuristic (see
 * `assignStressHeuristic`), because stress is a property of the whole word,
 * not of any single grapheme.
 */

import {
    STRESS, PUNCTUATION_CONTEXT, STRUCTURAL_SYMBOLS,
    phonemeIdOf, phonemeAt, isVowel,
} from './PhonemeSet.js';
import { PronunciationLexicon, parsePronunciation } from './PronunciationLexicon.js';
import { DOMAIN_PRONUNCIATIONS, reviewPronunciationCandidate } from './PronunciationOverrides.js';

const CONTEXT_DEPENDENT_WORDS = new Set(['read', 'lead', 'wind', 'bow', 'tear', 'live', 'close', 'use']);
// These endings can be lexical/singular, change their stem sound, or have an
// adjective pronunciation distinct from the verb. Without a full-word entry,
// retain the existing approximate LTS path instead of claiming an inflection.
const AMBIGUOUS_INFLECTION_WORDS = new Set([
    'news', 'series', 'species', 'means', 'headquarters',
    'aged', 'beloved', 'blessed', 'crooked', 'learned', 'naked', 'ragged', 'wicked', 'wretched',
    // The known noun house ends in S; these forms require lexical stem voicing.
    'houses', 'housed',
]);
const SIBILANT_PHONES = new Set(['S', 'Z', 'SH', 'ZH', 'CH', 'JH']);

const VOWEL_LETTERS = new Set(['a', 'e', 'i', 'o', 'u', 'y']);
const isVowelLetter = (ch) => ch !== undefined && VOWEL_LETTERS.has(ch);
const isConsonantLetter = (ch) => ch !== undefined && ch >= 'a' && ch <= 'z' && !VOWEL_LETTERS.has(ch);

/**
 * Letter-to-sound rules, grouped by first letter of `target`. Order within a
 * group IS the priority order.
 */
export const LTS_RULES = Object.freeze({
    a: [
        ['', 'augh', '', 'AO'],
        ['', 'ai', '', 'EY'],
        ['', 'ay', '', 'EY'],
        ['', 'au', '', 'AO'],
        ['', 'aw', '', 'AO'],
        ['', 'all', '', 'AO L'],
        ['', 'are', '#', 'EH R'],
        ['', 'ar', 'y#', 'EH R'],
        ['', 'ar', '', 'AA R'],
        // "Magic e": a + one consonant + final e reads long (make, late, cake),
        // also before the -d/-s endings (saved, makes).
        ['', 'a', 'Ce#', 'EY'],
        ['', 'a', 'Ced#', 'EY'],
        ['', 'a', 'Ces#', 'EY'],
        ['', 'a', 'CCe#', 'EY'],
        ['', 'a', '#', 'AH'],
        ['', 'a', '', 'AE'],
    ],
    e: [
        ['', 'eigh', '', 'EY'],
        ['', 'ee', '', 'IY'],
        ['', 'ea', '', 'IY'],
        ['', 'ei', '', 'IY'],
        ['', 'ey', '', 'IY'],
        ['', 'eu', '', 'Y UW'],
        ['', 'ew', '', 'UW'],
        ['', 'er', '', 'ER'],
        // Silent final e, but only when a vowel+consonant precedes it, so
        // "make" loses its e while "be"/"he" (no preceding vowel) do not.
        ['VC', 'e', '#', ''],
        // The e of -ed/-es is silent after magic e (saved, makes) but voiced after
        // t/d (hated, faded) and after sibilants (bases, pages).
        ['Vt', 'e', 'd#', 'IH'], ['Vd', 'e', 'd#', 'IH'],
        ['Vs', 'e', 's#', 'IH'], ['Vz', 'e', 's#', 'IH'], ['Vc', 'e', 's#', 'IH'], ['Vg', 'e', 's#', 'IH'],
        ['VC', 'e', 'd#', ''],
        ['VC', 'e', 's#', ''],
        ['', 'e', '', 'EH'],
    ],
    i: [
        ['', 'igh', '', 'AY'],
        ['', 'ing', '#', 'IH NG'],
        // One-syllable -ie words are long i (die, lie, pie, tie); elsewhere ie is "ee".
        ['#C', 'ie', '#', 'AY'],
        ['', 'ie', '', 'IY'],
        ['', 'ir', '', 'ER'],
        ['', 'i', 'nd#', 'AY'],
        ['', 'i', 'Ce#', 'AY'],
        ['', 'i', 'Ced#', 'AY'],
        ['', 'i', 'Ces#', 'AY'],
        ['', 'i', '', 'IH'],
    ],
    o: [
        ['', 'ough', '', 'AO'],
        ['', 'oo', '', 'UW'],
        ['', 'ou', '', 'AW'],
        ['', 'ow', '', 'OW'],
        ['', 'oi', '', 'OY'],
        ['', 'oy', '', 'OY'],
        ['', 'oa', '', 'OW'],
        ['', 'or', '', 'AO R'],
        ['', 'o', 'ld#', 'OW'],
        ['', 'o', 'Ce#', 'OW'],
        ['', 'o', 'Ced#', 'OW'],
        ['', 'o', 'Ces#', 'OW'],
        ['', 'o', '#', 'OW'],
        ['', 'o', '', 'AA'],
    ],
    u: [
        ['', 'ur', '', 'ER'],
        ['', 'ui', '', 'UW'],
        ['', 'u', 'Ce#', 'UW'],
        ['', 'u', 'Ced#', 'UW'],
        ['', 'u', 'Ces#', 'UW'],
        ['', 'u', '', 'AH'],
    ],
    y: [
        // Word-initial y is the glide; elsewhere it is a vowel.
        ['#', 'y', '', 'Y'],
        // A final y that is the word's only vowel is long i (my, sky, fly, spry).
        ['#C', 'y', '#', 'AY'],
        ['#CC', 'y', '#', 'AY'],
        ['#CCC', 'y', '#', 'AY'],
        ['', 'y', '#', 'IY'],
        ['', 'y', '', 'IH'],
    ],
    b: [['', 'bb', '', 'B'], ['m', 'b', '#', ''], ['', 'b', '', 'B']],
    c: [
        ['', 'ch', '', 'CH'],
        ['', 'ck', '', 'K'],
        // c softens before a front vowel (city, cent, cycle).
        ['', 'c', 'e', 'S'], ['', 'c', 'i', 'S'], ['', 'c', 'y', 'S'],
        ['', 'c', '', 'K'],
    ],
    d: [['', 'dge', '', 'JH'], ['', 'dd', '', 'D'], ['', 'd', '', 'D']],
    f: [['', 'ff', '', 'F'], ['', 'f', '', 'F']],
    g: [
        ['', 'gh', '', 'G'],
        ['', 'gg', '', 'G'],
        // g softens before a front vowel (gem, giant, gym).
        ['', 'g', 'e', 'JH'], ['', 'g', 'i', 'JH'], ['', 'g', 'y', 'JH'],
        ['', 'g', '', 'G'],
    ],
    h: [['', 'h', '', 'HH']],
    j: [['', 'j', '', 'JH']],
    k: [['#', 'kn', '', 'N'], ['', 'k', '', 'K']],
    // Consonant + final -le is a syllabic l with a schwa (little, twinkle, table), never "lee".
    l: [['C', 'le', '#', 'AH L'], ['C', 'les', '#', 'AH L Z'], ['', 'll', '', 'L'], ['', 'l', '', 'L']],
    m: [['', 'mm', '', 'M'], ['', 'm', '', 'M']],
    n: [['', 'ng', '', 'NG'], ['', 'nn', '', 'N'], ['', 'n', 'k', 'NG'], ['', 'n', '', 'N']],
    p: [['', 'ph', '', 'F'], ['', 'pp', '', 'P'], ['', 'p', '', 'P']],
    q: [['', 'qu', '', 'K W'], ['', 'q', '', 'K']],
    r: [['', 'rr', '', 'R'], ['', 'r', '', 'R']],
    s: [
        ['', 'sion', '', 'ZH AH N'],
        ['', 'sh', '', 'SH'],
        ['', 'ss', '', 'S'],
        ['', 's', '', 'S'],
    ],
    t: [
        ['', 'tion', '', 'SH AH N'],
        ['', 'tch', '', 'CH'],
        ['', 'th', '', 'TH'],
        ['', 'tt', '', 'T'],
        ['', 't', '', 'T'],
    ],
    v: [['', 'v', '', 'V']],
    w: [['', 'wh', '', 'W'], ['#', 'wr', '', 'R'], ['', 'w', '', 'W']],
    x: [['', 'x', '', 'K S']],
    z: [['', 'zz', '', 'Z'], ['', 'z', '', 'Z']],
});

/** Prefixes that are normally unstressed, so stress falls on the next syllable. */
const UNSTRESSED_PREFIXES = Object.freeze(['a', 'be', 'de', 're', 'in', 'un', 'con', 'com', 'ex', 'pre', 'pro']);

function matchLeft(word, pos, pattern) {
    if (pattern === '') return true;
    let p = pattern;
    let requireStart = false;
    if (p[0] === '#') {
        requireStart = true;
        p = p.slice(1);
    }
    const start = pos - p.length;
    if (start < 0) return false;
    if (requireStart && start !== 0) return false;
    for (let k = 0; k < p.length; k++) {
        const pc = p[k];
        const ch = word[start + k];
        if (pc === 'C') {
            if (!isConsonantLetter(ch)) return false;
        } else if (pc === 'V') {
            if (!isVowelLetter(ch)) return false;
        } else if (pc !== ch) {
            return false;
        }
    }
    return true;
}

function matchRight(word, pos, pattern) {
    let i = pos;
    for (const pc of pattern) {
        // '#' is only meaningful as the final element of a right context.
        if (pc === '#') return i === word.length;
        const ch = word[i];
        if (ch === undefined) return false;
        if (pc === 'C') {
            if (!isConsonantLetter(ch)) return false;
        } else if (pc === 'V') {
            if (!isVowelLetter(ch)) return false;
        } else if (pc !== ch) {
            return false;
        }
        i += 1;
    }
    return true;
}

/**
 * Apply the rule set to a spelling.
 * @returns {string[]} Phoneme SYMBOLS (stress is assigned separately).
 */
export function graphemesToPhonemeSymbols(word) {
    const w = String(word).toLowerCase();
    const symbols = [];
    let pos = 0;
    while (pos < w.length) {
        const rules = LTS_RULES[w[pos]];
        let applied = null;
        if (rules) {
            for (const rule of rules) {
                const [left, target, right, phones] = rule;
                if (!w.startsWith(target, pos)) continue;
                if (!matchLeft(w, pos, left)) continue;
                if (!matchRight(w, pos + target.length, right)) continue;
                applied = rule;
                break;
            }
        }
        if (!applied) {
            // No rule for this character (apostrophe, stray punctuation).
            // Skipping is correct: "don't" should read as d-o-n-t.
            pos += 1;
            continue;
        }
        const [, target, , phones] = applied;
        if (phones.length > 0) symbols.push(...phones.split(' '));
        pos += target.length;
    }
    return symbols;
}

/**
 * Place a single primary stress by syllable heuristic. Documented as a
 * heuristic because English stress is genuinely lexical — the lexicon is the
 * place to be exact.
 *
 *   - Suffixes `-tion/-sion/-cial/-tial/-cian` pull stress onto the syllable
 *     immediately before them (na-TION-al → "NA-tion", in-for-MA-tion).
 *   - `-ity/-ety/-ify/-ogy/-omy` pull stress two syllables back.
 *   - Otherwise stress the first syllable, unless the word opens with a
 *     normally-unstressed prefix and has more than one syllable, in which
 *     case stress the second.
 */
export function assignStressHeuristic(word, symbols) {
    const stress = new Uint8Array(symbols.length);
    const vowelPositions = [];
    for (let i = 0; i < symbols.length; i++) {
        if (isVowel(phonemeIdOf(symbols[i]))) vowelPositions.push(i);
    }
    const syllables = vowelPositions.length;
    if (syllables === 0) return stress;

    const w = String(word).toLowerCase();
    let target = 0;
    if (/(tion|sion|cial|tial|cian)$/.test(w) && syllables >= 2) {
        target = syllables - 2;
    } else if (/(ity|ety|ify|ogy|omy)$/.test(w) && syllables >= 3) {
        target = syllables - 3;
    } else if (syllables >= 2 && UNSTRESSED_PREFIXES.some((p) => w.startsWith(p) && w.length > p.length + 1)) {
        target = 1;
    }
    stress[vowelPositions[Math.min(target, syllables - 1)]] = STRESS.PRIMARY;
    return stress;
}

/** @returns {{phonemeIds: Uint8Array, stress: Uint8Array}|null} `null` only if the spelling produced no phonemes at all. */
export function graphemesToPhonemes(word) {
    const symbols = graphemesToPhonemeSymbols(word);
    if (symbols.length === 0) return null;
    const stress = assignStressHeuristic(word, symbols);
    const phonemeIds = new Uint8Array(symbols.length);
    for (let i = 0; i < symbols.length; i++) phonemeIds[i] = phonemeIdOf(symbols[i]);
    return { phonemeIds, stress };
}

/** Shared direct-entry priority; deliberately never calls pronounce/rules. */
function knownPronunciation(model, word) {
    for (const [lexicon, source] of [[model.overrides, 'override'], [model.lexicon, 'lexicon'], [model.domainLexicon, 'domain']]) {
        const entry = lexicon.lookup(word);
        if (entry) return { ...entry, source };
    }
    return null;
}

function regularSpelling(stem, ending, pronunciation) {
    if (/[^aeiou]y$/.test(stem)) return stem.slice(0, -1) + (ending === 's' ? 'ies' : 'ied');
    if (ending === 's') return stem + (/(?:s|x|z|ch|sh)$/.test(stem) ? 'es' : 's');
    if (stem.endsWith('e')) return stem + 'd';
    // A final stressed CVC doubles its last consonant (stop/stopped), while
    // unstressed final syllables (open/opened) and w/x/y do not. Treat qu as
    // the initial consonant spelling in quit. This bounded rule intentionally
    // leaves dialect-dependent and other exceptional spellings to entries.
    const cvc = /(?:[^aeiou][aeiou]|qu[aeiou])[bdfgklmnprstz]$/.test(stem);
    let finalVowel = -1;
    for (let i = 0; i < pronunciation.phonemeIds.length; i++) if (isVowel(pronunciation.phonemeIds[i])) finalVowel = i;
    const doubleFinal = cvc && finalVowel >= 0 && pronunciation.stress[finalVowel] === STRESS.PRIMARY;
    return stem + (doubleFinal ? stem.at(-1) : '') + 'ed';
}

/** Regular morphology over authoritative known stems, never guessed stems.
 * Allomorphs follow the stem's last SOUND: s/z/ih-z and t/d/ih-d. These are
 * still approximate rules, not reviewed pronunciations or a POS/sense model.
 * Sources: Boston University, Pronunciation Priorities, pp. 1–2:
 * https://www.bu.edu/teaching-writing/files/2020/02/Pronunciation-Priorities-for-Multilingual-Learners-Script.pdf
 * https://africa.teachingenglish.org.uk/classroom/pronunciation/which-corner
 */
function regularInflection(model, word) {
    const spelling = PronunciationLexicon.normalizeKey(word);
    if (!/^[a-z]{3,64}$/.test(spelling) || AMBIGUOUS_INFLECTION_WORDS.has(spelling)) return null;
    const ending = spelling.endsWith('ed') ? 'ed' : spelling.endsWith('s') && !/(?:ss|us|is)$/.test(spelling) ? 's' : null;
    if (!ending) return null;
    const candidates = new Set();
    if (ending === 's') {
        candidates.add(spelling.slice(0, -1));
        if (spelling.endsWith('es')) candidates.add(spelling.slice(0, -2));
        if (spelling.endsWith('ies')) candidates.add(spelling.slice(0, -3) + 'y');
    } else {
        const stripped = spelling.slice(0, -2);
        candidates.add(stripped);
        candidates.add(spelling.slice(0, -1));
        if (/([bdfgklmnprstz])\1$/.test(stripped)) candidates.add(stripped.slice(0, -1));
        if (spelling.endsWith('ied')) candidates.add(spelling.slice(0, -3) + 'y');
    }
    const matches = [];
    for (const stem of candidates) {
        // Tiny lexical particles/letter names produce false stem analyses
        // (re + d -> red, a + s -> as). Their full forms still resolve above.
        if (stem.length < 3) continue;
        const entry = knownPronunciation(model, stem);
        if (!entry || (CONTEXT_DEPENDENT_WORDS.has(stem) && entry.source !== 'override')
            || entry.phonemeIds.length === 0 || entry.phonemeIds.length > 64
            || entry.phonemeIds.some(id => phonemeAt(id).category === 'structural')
            || regularSpelling(stem, ending, entry) !== spelling) continue;
        matches.push({ stem, entry });
    }
    // A spelling with two known analyses does not establish the intended stem.
    if (matches.length !== 1) return null;
    const { stem, entry } = matches[0], last = phonemeAt(entry.phonemeIds.at(-1));
    const suffix = ending === 's' ? (SIBILANT_PHONES.has(last.symbol) ? ['IH', 'Z'] : [last.voiced ? 'Z' : 'S'])
        : (['T', 'D'].includes(last.symbol) ? ['IH', 'D'] : [last.voiced ? 'D' : 'T']);
    const phonemeIds = new Uint8Array(entry.phonemeIds.length + suffix.length);
    const stress = new Uint8Array(phonemeIds.length);
    phonemeIds.set(entry.phonemeIds); stress.set(entry.stress);
    phonemeIds.set(suffix.map(phonemeIdOf), entry.phonemeIds.length);
    return { phonemeIds, stress, source: 'rules',
        derivation: Object.freeze({ kind: 'regular-inflection', stem, ending, stemSource: entry.source }) };
}

/**
 * Whether an unknown ALL-CAPS token should be spelled letter by letter.
 *
 * Headings, labels and scanned signs are routinely set in capitals ("MARKET
 * LIST", "HELLO WORLD"); spelling every unknown capitalised word made them
 * unintelligible. Short tokens (≤ 3 letters: USA, BBC, FAQ) and tokens with no
 * vowel letter (HTML, NHS) are read as initialisms; longer pronounceable ones
 * go through the lexicon/rules like any word. Known acronyms with a lexicon
 * entry are unaffected — the lexicon still gets first refusal.
 */
export function looksLikeInitialism(word) {
    const letters = String(word).replace(/[^a-z]/gi, '');
    return letters.length > 0 && (letters.length <= 3 || !/[aeiouy]/i.test(letters));
}

export class G2PModel {
    /** @param {{ lexicon?: PronunciationLexicon, includeDomain?: boolean }} [options] */
    constructor({ lexicon = new PronunciationLexicon(), includeDomain = true } = {}) {
        this.lexicon = lexicon;
        this.domainLexicon = new PronunciationLexicon({ includeCore: false, entries: includeDomain ? DOMAIN_PRONUNCIATIONS : null });
        this.overrides = new PronunciationLexicon({ includeCore: false });
        this.reviewedOverrides = new Map();
    }

    /** Local operator review, not permission to execute OS actions or to learn from arbitrary chat. */
    applyReviewedOverride(candidate, { reviewed = false } = {}) {
        if (reviewed !== true) throw new Error('Review the word and phonemes before applying an override.');
        const validated = reviewPronunciationCandidate(candidate?.word, candidate?.pronunciation);
        if (!this.reviewedOverrides.has(validated.word) && this.reviewedOverrides.size >= 256) {
            throw new RangeError('The session pronunciation override limit is 256 words.');
        }
        this.overrides.add(validated.word, validated.pronunciation);
        this.reviewedOverrides.set(validated.word, validated);
        return validated;
    }

    clearReviewedOverrides() {
        this.overrides = new PronunciationLexicon({ includeCore: false });
        this.reviewedOverrides.clear();
    }

    /**
     * Resolve one word, preferring the lexicon.
     *
     * `wasAllCaps` (from `TextNormalizer.js`) triggers spell-out ONLY when the
     * lexicon has no entry — so `NASA`, once added to a lexicon, is spoken as
     * a word, while an unknown `USA` is spelled out. That ordering is the
     * whole reason the normalizer defers the decision rather than making it.
     *
     * @returns {{phonemeIds: Uint8Array, stress: Uint8Array, source: 'override'|'lexicon'|'domain'|'spellout'|'rules'}|null}
     */
    pronounce(word, { wasAllCaps = false } = {}) {
        const known = knownPronunciation(this, word);
        if (known) return known;

        if (wasAllCaps && looksLikeInitialism(word)) {
            const spelled = this.lexicon.spellOut(word);
            if (spelled) return { ...spelled, source: 'spellout' };
        }

        const inflected = regularInflection(this, word);
        if (inflected) return inflected;

        const fromRules = graphemesToPhonemes(word);
        return fromRules ? { ...fromRules, source: 'rules' } : null;
    }
}

/**
 * Deterministic lowering of normalized text into `spec/VoicePlan-v0.md` §4's
 * `PhonemeSequence`. All three arrays are the same length, one entry per
 * phoneme instance including structural tokens, exactly as that spec requires.
 *
 * Structural insertion follows `spec/PhonemeSet-v0.md` §4's Effect column: a
 * phrase's `structural` token (`SP` for comma-level, `SIL` for terminals) is
 * appended after its words, and a paragraph boundary additionally emits
 * `BREATH` before its `SIL` (§4: "longer SIL, breath event likely").
 *
 * @param {object} normalized Output of `TextNormalizer.normalizeText`.
 * @param {{ g2p?: G2PModel, padSilence?: boolean }} [options]
 *   `padSilence` (default true) brackets the utterance with `SIL`, so the
 *   waveguide starts and ends from silence rather than clipping in mid-phone.
 * @returns {{ phonemeIds: Uint8Array, stress: Uint8Array, punctuationContext: Uint8Array, unresolved: string[] }}
 */
export function textToPhonemeSequence(normalized, { g2p = new G2PModel(), padSilence = true } = {}) {
    if (!normalized || !Array.isArray(normalized.phrases)) {
        throw new TypeError('textToPhonemeSequence requires TextNormalizer.normalizeText output');
    }
    const ids = [];
    const stress = [];
    const context = [];
    const unresolved = [];
    const words = [];
    const warnings = [];

    const silId = phonemeIdOf(STRUCTURAL_SYMBOLS.SILENCE);
    const breathId = phonemeIdOf(STRUCTURAL_SYMBOLS.BREATH);

    const push = (id, stressValue, tag) => {
        ids.push(id);
        stress.push(stressValue);
        context.push(tag);
    };

    if (padSilence) push(silId, STRESS.UNSTRESSED, PUNCTUATION_CONTEXT.none);

    for (const [phraseIndex, phrase] of normalized.phrases.entries()) {
        for (const word of phrase.words) {
            const result = g2p.pronounce(word.text, { wasAllCaps: word.wasAllCaps });
            const wordWarnings = [];
            if (!result) wordWarnings.push('unresolved');
            if (result?.source === 'rules') wordWarnings.push('approximate-rule-pronunciation');
            if (CONTEXT_DEPENDENT_WORDS.has(word.text) && result?.source !== 'override') wordWarnings.push('context-dependent-pronunciation');
            const startPhoneme = ids.length;
            words.push(Object.freeze({
                text: word.text, phraseIndex, startPhoneme,
                endPhoneme: startPhoneme + (result?.phonemeIds.length ?? 0),
                source: result?.source ?? 'unresolved', warnings: Object.freeze(wordWarnings),
                ...(result?.derivation ? { derivation: result.derivation } : {}),
            }));
            for (const code of wordWarnings) warnings.push(Object.freeze({ wordIndex: words.length - 1, word: word.text, code }));
            if (!result) {
                // A word that produces no phonemes at all is dropped, but
                // reported — silently losing words would be worse than a
                // caller being able to see and fix it.
                unresolved.push(word.text);
                continue;
            }
            for (let i = 0; i < result.phonemeIds.length; i++) {
                push(result.phonemeIds[i], result.stress[i], phrase.boundary);
            }
        }
        if (phrase.breathLikely) push(breathId, STRESS.UNSTRESSED, phrase.boundary);
        if (phrase.structural !== null) {
            push(phonemeIdOf(phrase.structural), STRESS.UNSTRESSED, phrase.boundary);
        }
    }

    if (padSilence) push(silId, STRESS.UNSTRESSED, PUNCTUATION_CONTEXT.none);

    return {
        phonemeIds: Uint8Array.from(ids),
        stress: Uint8Array.from(stress),
        punctuationContext: Uint8Array.from(context),
        unresolved,
        words: Object.freeze(words),
        warnings: Object.freeze(warnings),
    };
}

/** Diagnostic bypass of spelling only; the same prosody/articulation/tract still renders it.
 * Separate words with `|`; stress uses this project's 2=primary, 1=secondary convention.
 * Word boundaries are metadata, never inserted pauses. Limits bound diagnostic allocation.
 */
export function explicitPhonemesToSequence(input, { padSilence = true } = {}) {
    if (typeof input !== 'string' || input.length === 0 || input.length > 16384) {
        throw new TypeError('Explicit phonemes require a nonempty string of at most 16384 characters.');
    }
    const groups = input.split('|');
    if (groups.length > 256) throw new RangeError('At most 256 explicit words are supported.');
    const ids = [];
    const stresses = [];
    const words = [];
    if (padSilence) { ids.push(phonemeIdOf(STRUCTURAL_SYMBOLS.SILENCE)); stresses.push(STRESS.UNSTRESSED); }
    for (const [index, group] of groups.entries()) {
        const parsed = parsePronunciation(group.trim(), `explicit word ${index + 1}`);
        const startPhoneme = ids.length;
        ids.push(...parsed.phonemeIds);
        stresses.push(...parsed.stress);
        if (ids.length > 4096) throw new RangeError('At most 4096 explicit phonemes are supported.');
        words.push(Object.freeze({ text: group.trim(), phraseIndex: 0, startPhoneme, endPhoneme: ids.length, source: 'explicit', warnings: Object.freeze([]) }));
    }
    if (padSilence) { ids.push(phonemeIdOf(STRUCTURAL_SYMBOLS.SILENCE)); stresses.push(STRESS.UNSTRESSED); }
    return {
        phonemeIds: Uint8Array.from(ids), stress: Uint8Array.from(stresses),
        punctuationContext: new Uint8Array(ids.length), unresolved: [],
        words: Object.freeze(words), warnings: Object.freeze([]),
    };
}

export function createG2PModel(options) {
    return new G2PModel(options);
}

export default G2PModel;
