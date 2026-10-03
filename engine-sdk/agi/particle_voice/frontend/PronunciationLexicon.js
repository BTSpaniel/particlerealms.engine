// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * PronunciationLexicon.js — Phase 3 ParticleVoice text frontend.
 *
 * Word → phoneme-sequence dictionary, checked entry-by-entry against
 * `PhonemeSet.js` at construction time. Sits between `TextNormalizer.js` and
 * `G2PModel.js`: a lexicon hit is authoritative, and only words with no entry
 * fall through to G2P's letter-to-sound rules.
 *
 * ## ⚠ Stress digits are the INVERSE of CMUdict
 *
 * Pronunciation strings use CMUdict's familiar `SYMBOL+digit` shape
 * (`HH AH L OW2`), but the digit follows `spec/PhonemeSet-v0.md` §3:
 *
 *   **0 = unstressed, 1 = SECONDARY, 2 = PRIMARY**
 *
 * CMUdict is the other way round (`1` = primary, `2` = secondary). Copying
 * CMUdict strings verbatim would therefore silently swap primary and
 * secondary stress on every polysyllabic word — audible as wrong prosody, not
 * as an error. This module cannot detect that mistake for you, so the
 * convention is stated here, in `spec/PhonemeSet-v0.md` §3, and enforced by
 * `MAX_STRESS`-range validation only.
 *
 * ## Authoring rules (validated, not merely documented)
 *
 *   - Every symbol must exist in `PhonemeSet.js`. A typo throws at
 *     construction, naming the word — never at synthesis time.
 *   - A stress digit is legal ONLY on a vowel. Spec §3 defines stress as a
 *     per-vowel-instance property, so `S2` is rejected outright rather than
 *     quietly ignored.
 *   - Omitting the digit on a vowel means unstressed (0). This keeps reduced
 *     function words (`the` = `DH AH`) readable.
 *   - **At most one** primary stress per word. Not *exactly* one: genuinely
 *     reduced function words (`the`, `a`, `of`) carry no stress at all, and
 *     forcing a primary onto them would produce robotically over-stressed
 *     speech.
 *
 * ## Scope
 *
 * `CORE_LEXICON` is a deliberately curated core, NOT a full dictionary. It
 * covers high-frequency function/content words plus — the reason a lexicon
 * exists at all — words whose spelling actively lies about their
 * pronunciation (`one`, `through`, `women`, `said`, `colonel`, `choir`,
 * `island`), which any letter-to-sound rule set gets wrong. CMUdict is not
 * vendored: this project takes no external data dependencies, and the long
 * tail is `G2PModel.js`'s job. Callers add domain vocabulary (character
 * names, place names) via `add()`/`addAll()`.
 */

import {
    STRESS, phonemeIdOf, phonemeBySymbol, isVowel, phonemeAt,
} from './PhonemeSet.js';

export const MAX_STRESS = STRESS.PRIMARY;

/**
 * Spoken letter names, for spelling out initialisms. `TextNormalizer.js`
 * flags all-caps tokens with `wasAllCaps` but deliberately does not decide
 * whether they are words or initialisms; `spellOut()` here is the mechanism
 * for the latter.
 */
export const LETTER_NAMES = Object.freeze({
    a: 'EY2', b: 'B IY2', c: 'S IY2', d: 'D IY2', e: 'IY2', f: 'EH2 F',
    g: 'JH IY2', h: 'EY2 CH', i: 'AY2', j: 'JH EY2', k: 'K EY2', l: 'EH2 L',
    m: 'EH2 M', n: 'EH2 N', o: 'OW2', p: 'P IY2', q: 'K Y UW2', r: 'AA2 R',
    s: 'EH2 S', t: 'T IY2', u: 'Y UW2', v: 'V IY2',
    w: 'D AH2 B AH L Y UW', x: 'EH2 K S', y: 'W AY2', z: 'Z IY2',
});

/**
 * Curated core lexicon. Stress digits: 2 = PRIMARY (see the warning above).
 * Grouped by why each entry is here.
 */
export const CORE_LEXICON = Object.freeze({
    // ── Function words (mostly reduced, so mostly unstressed) ────────────
    // AH0 selects schwa in articulation. Retain full lexical STRUT in up,
    // what/what's and just, and in one/plus below. CMU primary 1 maps to 2:
    // https://github.com/cmusphinx/cmudict/blob/master/cmudict.dict
    the: 'DH AH', a: 'AH', an: 'AE N', of: 'AH V', to: 'T UW', in: 'IH N',
    and: 'AE N D', or: 'AO R', but: 'B AH T', if: 'IH F', so: 'S OW2',
    as: 'AE Z', at: 'AE T', by: 'B AY2', for: 'F AO R', from: 'F R AH M',
    on: 'AA N', out: 'AW T', up: 'AH2 P', with: 'W IH DH', into: 'IH N T UW',
    that: 'DH AE T', this: 'DH IH S', these: 'DH IY2 Z', those: 'DH OW2 Z',
    it: 'IH T', its: 'IH T S', is: 'IH Z', was: 'W AA Z', are: 'AA R',
    were: 'W ER', be: 'B IY2', been: 'B IH N', am: 'AE M',
    have: 'HH AE V', has: 'HH AE Z', had: 'HH AE D', do: 'D UW', does: 'D AH Z',
    did: 'D IH D', will: 'W IH L', would: 'W UH D', could: 'K UH D',
    should: 'SH UH D', can: 'K AE N', not: 'N AA T', no: 'N OW2', yes: 'Y EH S',
    i: 'AY2', you: 'Y UW2', he: 'HH IY2', she: 'SH IY2', we: 'W IY2',
    they: 'DH EY2', me: 'M IY2', him: 'HH IH M', her: 'HH ER', us: 'AH S',
    them: 'DH EH M', my: 'M AY2', your: 'Y AO R', his: 'HH IH Z',
    their: 'DH EH R', there: 'DH EH R', our: 'AW ER',
    what: 'W AH2 T', which: 'W IH CH', who: 'HH UW2', why: 'W AY2',
    when: 'W EH N', where: 'W EH R', how: 'HH AW2', all: 'AO L',
    any: 'EH2 N IY', some: 'S AH M', more: 'M AO R', most: 'M OW2 S T',
    than: 'DH AE N', then: 'DH EH N', now: 'N AW2', just: 'JH AH2 S T',
    only: 'OW2 N L IY', also: 'AO2 L S OW', very: 'V EH2 R IY',
    over: 'OW2 V ER', after: 'AE2 F T ER', about: 'AH B AW2 T',
    other: 'AH2 DH ER', even: 'IY2 V AH N', because: 'B IH K AH2 Z',

    // ── Common content words ─────────────────────────────────────────────
    // Full lexical words retain their primary nucleus even when monosyllabic.
    // A missing digit would shorten these vowels like the reduced function
    // words above. Primary locations reviewed against Carnegie Mellon's
    // dictionary (CMU 1 -> this inventory's 2); existing phone choices retained.
    // https://github.com/cmusphinx/cmudict/blob/master/cmudict.dict
    hello: 'HH AH L OW2', world: 'W ER2 L D', please: 'P L IY2 Z',
    thank: 'TH AE2 NG K', thanks: 'TH AE2 NG K S', sorry: 'S AA2 R IY',
    name: 'N EY2 M', time: 'T AY2 M', day: 'D EY2', year: 'Y IH2 R',
    people: 'P IY2 P AH L', man: 'M AE2 N', woman: 'W UH2 M AH N',
    thing: 'TH IH2 NG', way: 'W EY2', life: 'L AY2 F', hand: 'HH AE2 N D',
    eye: 'AY2', head: 'HH EH2 D', face: 'F EY2 S', voice: 'V OY2 S',
    sound: 'S AW2 N D', word: 'W ER2 D', speak: 'S P IY2 K',
    good: 'G UH2 D', new: 'N UW2', old: 'OW2 L D', great: 'G R EY2 T',
    right: 'R AY2 T', left: 'L EH2 F T', long: 'L AO2 NG', little: 'L IH2 T AH L',
    see: 'S IY2', look: 'L UH2 K', come: 'K AH2 M', go: 'G OW2',
    get: 'G EH2 T', give: 'G IH2 V', take: 'T EY2 K', make: 'M EY2 K',
    know: 'N OW2', think: 'TH IH2 NG K', want: 'W AA2 N T', need: 'N IY2 D',
    say: 'S EY2', tell: 'T EH2 L', ask: 'AE2 S K', work: 'W ER2 K',
    use: 'Y UW2 Z', find: 'F AY2 N D', help: 'HH EH2 L P', like: 'L AY2 K',
    here: 'HH IH2 R', first: 'F ER2 S T', last: 'L AE2 S T', well: 'W EH2 L',
    back: 'B AE2 K', still: 'S T IH2 L', again: 'AH G EH2 N',
    never: 'N EH2 V ER', always: 'AO2 L W EY Z', something: 'S AH2 M TH IH NG',
    nothing: 'N AH2 TH IH NG', everything: 'EH2 V R IY TH IH NG',
    open: 'OW2 P AH N', close: 'K L OW2 Z', start: 'S T AA2 R T',
    stop: 'S T AA2 P', light: 'L AY2 T', dark: 'D AA2 R K',
    house: 'HH AW2 S', door: 'D AO2 R', book: 'B UH2 K', water: 'W AO2 T ER',
    night: 'N AY2 T', morning: 'M AO2 R N IH NG', today: 'T AH D EY2',
    tomorrow: 'T AH M AA2 R OW', yesterday: 'Y EH2 S T ER D EY',

    // ── Song and irregular words ─────────────────────────────────────────
    // Found by auditing the singing presets: the letter rules misread these
    // (above → "ae-bove", diamond → "di-am-ond", sky → "ski"). Phones and primary
    // stress follow CMU (CMU 1 -> this inventory's 2).
    above: 'AH B AH2 V', diamond: 'D AY2 M AH N D', amazing: 'AH M EY2 Z IH NG',
    wonder: 'W AH2 N D ER', won: 'W AH2 N', mary: 'M EH2 R IY', merrily: 'M EH2 R AH L IY',
    adore: 'AH D AO2 R', thee: 'DH IY2', thy: 'DH AY2', thou: 'DH AW2', glory: 'G L AO2 R IY',
    star: 'S T AA2 R', sky: 'S K AY2', high: 'HH AY2', twinkle: 'T W IH2 NG K AH L',
    happy: 'HH AE2 P IY', birthday: 'B ER2 TH D EY', dear: 'D IH2 R', grace: 'G R EY2 S',
    sweet: 'S W IY2 T', stream: 'S T R IY2 M', dream: 'D R IY2 M', gently: 'JH EH2 N T L IY',
    boat: 'B OW2 T', joyful: 'JH OY2 F AH L', lord: 'L AO2 R D', lamb: 'L AE2 M',
    fleece: 'F L IY2 S', snow: 'S N OW2', white: 'W AY2 T', saved: 'S EY2 V D',
    wretch: 'R EH2 CH', sing: 'S IH2 NG', song: 'S AO2 NG', row: 'R OW2',
    // "ow" is ambiguous (snow/down); the letter rules choose OW, so the AW words are listed.
    down: 'D AW2 N', town: 'T AW2 N', brown: 'B R AW2 N', crown: 'K R AW2 N', clown: 'K L AW2 N',
    frown: 'F R AW2 N', gown: 'G AW2 N', cow: 'K AW2', owl: 'AW2 L', wow: 'W AW2',
    flower: 'F L AW2 ER', power: 'P AW2 ER', tower: 'T AW2 ER', shower: 'SH AW2 ER',

    // ── Number words (TextNormalizer emits these, so they must resolve) ───
    zero: 'Z IH2 R OW', one: 'W AH2 N', two: 'T UW2', three: 'TH R IY2',
    four: 'F AO R', five: 'F AY2 V', six: 'S IH2 K S', seven: 'S EH2 V AH N',
    eight: 'EY2 T', nine: 'N AY2 N', ten: 'T EH N', eleven: 'IH L EH2 V AH N',
    twelve: 'T W EH L V', thirteen: 'TH ER T IY2 N', fourteen: 'F AO R T IY2 N',
    fifteen: 'F IH F T IY2 N', sixteen: 'S IH K S T IY2 N',
    // CMU marks two primary nuclei in seventeen; use Merriam-Webster's
    // initial-secondary/final-primary citation pattern for our one-primary format.
    // https://www.merriam-webster.com/dictionary/seventeen
    seventeen: 'S EH1 V AH N T IY2 N', eighteen: 'EY2 T IY N',
    nineteen: 'N AY2 N T IY N', twenty: 'T W EH2 N T IY',
    thirty: 'TH ER2 T IY', forty: 'F AO2 R T IY', fifty: 'F IH2 F T IY',
    sixty: 'S IH2 K S T IY', seventy: 'S EH2 V AH N T IY',
    eighty: 'EY2 T IY', ninety: 'N AY2 N T IY',
    hundred: 'HH AH2 N D R AH D', thousand: 'TH AW2 Z AH N D',
    million: 'M IH2 L Y AH N', billion: 'B IH2 L Y AH N',
    trillion: 'T R IH2 L Y AH N', point: 'P OY2 N T', minus: 'M AY2 N AH S',
    // (`first` is already defined among the common content words above.)
    second: 'S EH2 K AH N D', third: 'TH ER D',
    fourth: 'F AO R TH', fifth: 'F IH F TH', percent: 'P ER S EH2 N T',
    dollar: 'D AA2 L ER', dollars: 'D AA2 L ER Z', cent: 'S EH N T',
    cents: 'S EH N T S', oh: 'OW2',
    // Clock-time words `expandClockTime` emits; letter names spell "a m"/"p m".
    oclock: 'AH K L AA2 K', ay: 'EY2', em: 'EH2 M', pee: 'P IY2',

    // ── Abbreviation expansions TextNormalizer produces ──────────────────
    mister: 'M IH2 S T ER', missus: 'M IH2 S AH Z', miss: 'M IH S',
    doctor: 'D AA2 K T ER', professor: 'P R AH F EH2 S ER',
    saint: 'S EY2 N T', mount: 'M AW2 N T', versus: 'V ER2 S AH S',
    et: 'EH T', cetera: 'S EH2 T ER AH', number: 'N AH2 M B ER',
    junior: 'JH UW2 N Y ER', senior: 'S IY2 N Y ER',
    avenue: 'AE2 V AH N UW', road: 'R OW2 D', street: 'S T R IY2 T',
    plus: 'P L AH2 S', equals: 'IY2 K W AH L Z', slash: 'S L AE SH',
    degrees: 'D IH G R IY2 Z',

    // ── Ordinal forms `expandOrdinal` can produce as the FINAL word ──────
    // `expandOrdinal` only ordinalizes the last word ("21st" → twenty + first,
    // "100th" → one + hundredth), so this list must cover every possible tail.
    sixth: 'S IH K S TH', seventh: 'S EH2 V AH N TH', eighth: 'EY2 T TH',
    ninth: 'N AY2 N TH', tenth: 'T EH N TH', eleventh: 'IH L EH2 V AH N TH',
    twelfth: 'T W EH L F TH', thirteenth: 'TH ER T IY2 N TH',
    fourteenth: 'F AO R T IY2 N TH', fifteenth: 'F IH F T IY2 N TH',
    sixteenth: 'S IH K S T IY2 N TH', seventeenth: 'S EH1 V AH N T IY2 N TH',
    eighteenth: 'EY2 T IY N TH', nineteenth: 'N AY2 N T IY N TH',
    twentieth: 'T W EH2 N T IY IH TH', thirtieth: 'TH ER2 T IY IH TH',
    fortieth: 'F AO2 R T IY IH TH', fiftieth: 'F IH2 F T IY IH TH',
    sixtieth: 'S IH2 K S T IY IH TH', seventieth: 'S EH2 V AH N T IY IH TH',
    eightieth: 'EY2 T IY IH TH', ninetieth: 'N AY2 N T IY IH TH',
    hundredth: 'HH AH2 N D R AH D TH', thousandth: 'TH AW2 Z AH N D TH',
    millionth: 'M IH2 L Y AH N TH', billionth: 'B IH2 L Y AH N TH',
    trillionth: 'T R IH2 L Y AH N TH',

    // ── Remaining abbreviation expansions and symbol words ───────────────
    // Every one of these is reachable from TextNormalizer's own ABBREVIATIONS
    // / SYMBOL_WORDS / currency tables, so the deterministic frontend must
    // never have to hand its own output to G2P.
    fort: 'F AO R T', approximately: 'AH P R AA2 K S AH M AH T L IY',
    department: 'D IH P AA2 R T M AH N T', established: 'IH S T AE2 B L IH SH T',
    minutes: 'M IH2 N AH T S', maximum: 'M AE2 K S AH M AH M',
    volume: 'V AA2 L Y UW M', boulevard: 'B UH2 L AH V AA R D',
    less: 'L EH S', greater: 'G R EY2 T ER', copyright: 'K AA2 P IY R AY T',
    registered: 'R EH2 JH IH S T ER D', trademark: 'T R EY2 D M AA R K',
    euro: 'Y UH2 R OW', euros: 'Y UH2 R OW Z', pound: 'P AW2 N D',
    pounds: 'P AW2 N D Z', penny: 'P EH2 N IY', pence: 'P EH N S',
    yen: 'Y EH N',

    // ── Spelling actively lies: the reason a lexicon exists ──────────────
    // Retain primary lexical nuclei here too, using the same CMU review and
    // stress conversion as the common content words above, without phone edits.
    through: 'TH R UW2', though: 'DH OW2', thought: 'TH AO2 T',
    although: 'AO L DH OW2', enough: 'IH N AH2 F', tough: 'T AH2 F',
    rough: 'R AH2 F', laugh: 'L AE2 F', cough: 'K AO2 F',
    women: 'W IH2 M AH N', said: 'S EH2 D', says: 'S EH2 Z',
    island: 'AY2 L AH N D', knee: 'N IY2', knife: 'N AY2 F',
    knight: 'N AY2 T', write: 'R AY2 T', wrong: 'R AO2 NG',
    answer: 'AE2 N S ER', listen: 'L IH2 S AH N', often: 'AO2 F AH N',
    half: 'HH AE2 F', talk: 'T AO2 K', walk: 'W AO2 K', calm: 'K AA2 M',
    friend: 'F R EH2 N D', break: 'B R EY2 K', heart: 'HH AA2 R T',
    learn: 'L ER2 N', earth: 'ER2 TH', early: 'ER2 L IY',
    money: 'M AH2 N IY', love: 'L AH2 V', move: 'M UW2 V',
    done: 'D AH2 N', gone: 'G AO2 N', son: 'S AH2 N', front: 'F R AH2 N T',
    month: 'M AH2 N TH', young: 'Y AH2 NG', touch: 'T AH2 CH',
    double: 'D AH2 B AH L', trouble: 'T R AH2 B AH L',
    country: 'K AH2 N T R IY', company: 'K AH2 M P AH N IY',
    business: 'B IH2 Z N AH S', minute: 'M IH2 N AH T',
    picture: 'P IH2 K CH ER', nature: 'N EY2 CH ER', future: 'F Y UW2 CH ER',
    sure: 'SH UH2 R', sugar: 'SH UH2 G ER', ocean: 'OW2 SH AH N',
    special: 'S P EH2 SH AH L', machine: 'M AH SH IY2 N',
    science: 'S AY2 AH N S', ancient: 'EY2 N SH AH N T',
    choir: 'K W AY2 ER', colonel: 'K ER2 N AH L', once: 'W AH2 N S',
    eyes: 'AY2 Z', busy: 'B IH2 Z IY', pretty: 'P R IH2 T IY',
    beautiful: 'B Y UW2 T AH F AH L',

    // Dictionary-reviewed failures from the Navi word diagnostic. Cambridge
    // sources are recorded in MD/webgpu-os/navi-speech-milestone.md; schwa
    // and rhotic schwa retain the existing AH/ER inventory convention.
    baby: 'B EY2 B IY', father: 'F AA2 DH ER', ahead: 'AH HH EH2 D',
    full: 'F UH2 L', cow: 'K AW2', rose: 'R OW2 Z',
    measure: 'M EH2 ZH ER', blue: 'B L UW2', away: 'AH W EY2',
    exam: 'IH G Z AE2 M',

    // Irregular vowels, reduced final syllables and voiced TH must survive
    // normal text, not just an explicit-phone diagnostic. Keep reviewed base
    // forms available to the known-stem inflection rules too. CMU's primary
    // stress 1 maps to this inventory's 2; unstressed AH represents schwa.
    // https://github.com/cmusphinx/cmudict/blob/master/cmudict.dict
    quiet: 'K W AY2 AH T', soup: 'S UW2 P', table: 'T EY2 B AH L',
    pebble: 'P EH2 B AH L', smooth: 'S M UW2 DH', rook: 'R UH2 K',
    put: 'P UH2 T', pick: 'P IH2 K', hum: 'HH AH2 M',
    ribbon: 'R IH2 B AH N', roll: 'R OW2 L', shine: 'SH AY2 N', bird: 'B ER2 D',

    // General American diagnostic errors: ready's short EH, getting's hard G,
    // and better's first-syllable stress are lexical exceptions to the fallback.
    // CMU primary 1 becomes local 2; final IY/IH/ER remain unstressed.
    // https://github.com/cmusphinx/cmudict/blob/master/cmudict.dict
    ready: 'R EH2 D IY', getting: 'G EH2 T IH NG', better: 'B EH2 T ER',
    // Preserve the voiced coda contrast with face, including derived phases/phased.
    phase: 'F EY2 Z',
    // Preserve NG before K, medial Z and the reduced IH prefix in normal text.
    sink: 'S IH2 NG K', easy: 'IY2 Z IY', beside: 'B IH S AY2 D',

    // Exact shoe-family exceptions: the fallback emitted AA EH for "oe"
    // and S for the plural in the listening sentence containing "shoes".
    // Keep these lexical; "does" and other oe spellings have different vowels.
    // https://dictionary.cambridge.org/us/pronunciation/english/shoe
    // https://dictionary.cambridge.org/dictionary/english/shoelace
    // https://www.merriam-webster.com/dictionary/shoe
    // https://www.dictionary.com/browse/shoebox
    shoe: 'SH UW2', shoes: 'SH UW2 Z', shoed: 'SH UW2 D', shoeing: 'SH UW2 IH NG',
    shoebox: 'SH UW2 B AA1 K S', shoeboxes: 'SH UW2 B AA1 K S AH Z',
    shoelace: 'SH UW2 L EY1 S', shoelaces: 'SH UW2 L EY1 S AH Z',

    // ── Contractions (apostrophes survive TextNormalizer intentionally) ──
    "it's": 'IH T S', "that's": 'DH AE T S', "what's": 'W AH2 T S',
    "let's": 'L EH T S', "don't": 'D OW2 N T', "can't": 'K AE N T',
    "won't": 'W OW2 N T', "isn't": 'IH2 Z AH N T', "didn't": 'D IH2 D AH N T',
    "doesn't": 'D AH2 Z AH N T', "wasn't": 'W AA2 Z AH N T',
    "i'm": 'AY2 M', "i'll": 'AY2 L', "i've": 'AY2 V',
    "you're": 'Y UH R', "we're": 'W IH R', "they're": 'DH EH R',
    "he's": 'HH IY2 Z', "she's": 'SH IY2 Z', "there's": 'DH EH R Z',
});

/**
 * Parse one `SYMBOL+digit` pronunciation string.
 * @returns {{ phonemeIds: Uint8Array, stress: Uint8Array }}
 */
export function parsePronunciation(pronunciation, wordLabel = '<unknown>') {
    if (typeof pronunciation !== 'string' || pronunciation.trim().length === 0) {
        throw new TypeError(`Lexicon '${wordLabel}': pronunciation must be a non-empty string`);
    }
    const tokens = pronunciation.trim().split(/\s+/);
    const phonemeIds = new Uint8Array(tokens.length);
    const stress = new Uint8Array(tokens.length);
    let primaryCount = 0;

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        const match = /^([A-Z]+)([0-9])?$/.exec(token);
        if (!match) {
            throw new SyntaxError(`Lexicon '${wordLabel}': malformed phoneme token '${token}' (expected SYMBOL or SYMBOL+digit)`);
        }
        const [, symbol, digit] = match;
        // Throws with the symbol named if it is not in PhonemeSet.
        let id;
        try {
            id = phonemeIdOf(symbol);
        } catch {
            throw new RangeError(`Lexicon '${wordLabel}': '${symbol}' is not in PhonemeSet`);
        }
        phonemeIds[i] = id;

        if (digit === undefined) {
            stress[i] = STRESS.UNSTRESSED;
            continue;
        }
        const value = Number(digit);
        if (!isVowel(id)) {
            // Spec §3 makes stress a per-VOWEL-instance property. Silently
            // dropping the digit would hide a real authoring error.
            throw new RangeError(`Lexicon '${wordLabel}': stress digit on non-vowel '${symbol}' — stress is a per-vowel property (spec §3)`);
        }
        if (value > MAX_STRESS) {
            throw new RangeError(`Lexicon '${wordLabel}': stress ${value} on '${symbol}' exceeds ${MAX_STRESS} (0=unstressed, 1=secondary, 2=PRIMARY — note this is the inverse of CMUdict)`);
        }
        stress[i] = value;
        if (value === STRESS.PRIMARY) primaryCount += 1;
    }

    if (primaryCount > 1) {
        throw new RangeError(`Lexicon '${wordLabel}': ${primaryCount} primary stresses — at most one is allowed`);
    }
    return { phonemeIds, stress };
}

export class PronunciationLexicon {
    /**
     * @param {{ entries?: object, includeCore?: boolean }} [options]
     *   `includeCore` defaults to true; pass false for a lexicon containing
     *   only caller-supplied entries (useful for testing G2P fallback).
     */
    constructor({ entries = null, includeCore = true } = {}) {
        this._map = new Map();
        if (includeCore) this.addAll(CORE_LEXICON);
        if (entries) this.addAll(entries);
    }

    get size() {
        return this._map.size;
    }

    /** Words are matched case-insensitively; `TextNormalizer` already lowercases, but a caller adding entries by hand should not have to remember that. */
    static normalizeKey(word) {
        if (typeof word !== 'string') throw new TypeError('Lexicon key must be a string');
        return word.trim().toLowerCase();
    }

    /**
     * Add or REPLACE one entry. Replacement is intentional and silent: a
     * caller supplying a character-specific pronunciation must be able to
     * override the core lexicon without first removing the default.
     */
    add(word, pronunciation) {
        const key = PronunciationLexicon.normalizeKey(word);
        if (key.length === 0) throw new RangeError('Lexicon key must be non-empty');
        this._map.set(key, Object.freeze(parsePronunciation(pronunciation, key)));
        return this;
    }

    addAll(entries) {
        for (const [word, pronunciation] of Object.entries(entries)) {
            this.add(word, pronunciation);
        }
        return this;
    }

    has(word) {
        return this._map.has(PronunciationLexicon.normalizeKey(word));
    }

    /** @returns {{phonemeIds: Uint8Array, stress: Uint8Array}|null} `null` (not a throw) when absent — a miss is the normal path to `G2PModel.js`, not an error. */
    lookup(word) {
        return this._map.get(PronunciationLexicon.normalizeKey(word)) ?? null;
    }

    /**
     * Spell a token out letter by letter (`USA` → "you ess ay"). The caller
     * decides WHEN to do this — `TextNormalizer.js`'s `wasAllCaps` flag is the
     * signal, but only the caller knows whether a given initialism is
     * pronounced as a word instead.
     *
     * @returns {{phonemeIds: Uint8Array, stress: Uint8Array}|null} `null` if
     * the token contains a character with no letter name.
     */
    spellOut(token) {
        const letters = [...PronunciationLexicon.normalizeKey(token)];
        const parts = [];
        for (const letter of letters) {
            const name = LETTER_NAMES[letter];
            if (name === undefined) return null;
            parts.push(name);
        }
        if (parts.length === 0) return null;
        // Each letter name carries its own primary stress, which would break
        // parsePronunciation's at-most-one rule, so the parts are parsed
        // individually and concatenated.
        const parsed = parts.map((p, i) => parsePronunciation(p, `${token}[${letters[i]}]`));
        const total = parsed.reduce((n, p) => n + p.phonemeIds.length, 0);
        const phonemeIds = new Uint8Array(total);
        const stress = new Uint8Array(total);
        let offset = 0;
        for (const p of parsed) {
            phonemeIds.set(p.phonemeIds, offset);
            stress.set(p.stress, offset);
            offset += p.phonemeIds.length;
        }
        return { phonemeIds, stress };
    }

    /** @returns {string[]} The symbols for an entry, for debugging/inspection. */
    symbolsOf(word) {
        const entry = this.lookup(word);
        if (!entry) return null;
        return [...entry.phonemeIds].map((id) => phonemeAt(id).symbol);
    }

    /** @returns {string[]} Words in `candidates` this lexicon cannot resolve — the set `G2PModel.js` must cover. */
    missingFrom(candidates) {
        return [...new Set(candidates)].filter((w) => !this.has(w));
    }
}

export function createPronunciationLexicon(options) {
    return new PronunciationLexicon(options);
}

export default PronunciationLexicon;
