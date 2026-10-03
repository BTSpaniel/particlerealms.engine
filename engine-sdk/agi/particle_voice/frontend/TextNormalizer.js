// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * TextNormalizer.js — Phase 3 ParticleVoice text frontend.
 *
 * Turns raw author/LLM text into speakable words plus the per-phrase
 * punctuation-context tags `spec/PhonemeSet-v0.md` §4 defines, ready for
 * `PronunciationLexicon.js`/`G2PModel.js` to lower into phoneme ids.
 *
 * Output shape (`normalizeText`):
 *
 *   {
 *     raw: string,
 *     phrases: [{
 *       words: [{ text, wasAllCaps }],
 *       boundary: PUNCTUATION_CONTEXT id,   // §4 tag for THIS phrase's end
 *       structural: 'SP' | 'SIL' | null,    // token to insert at the boundary
 *       breathLikely: boolean,              // §4: paragraph breaks only
 *     }]
 *   }
 *
 * One tag per phrase (not per phoneme): `spec/VoicePlan-v0.md` §4's
 * per-phoneme `punctuationContext` array is produced downstream by repeating
 * a phrase's tag across the phonemes its words expand into, which is exactly
 * what that spec means by "repeats within a phrase, changes at boundaries".
 *
 * ## Ordering matters
 *
 * Abbreviation expansion and decimal-point protection run BEFORE phrase
 * splitting, because both consume `.` characters that would otherwise be
 * mistaken for sentence terminators — `Dr. Smith` is one phrase, not two, and
 * `3.14` is one number, not `3` then `14`. Getting this order wrong is the
 * classic text-frontend bug, so it is enforced by construction here rather
 * than left to a later cleanup pass.
 *
 * ## Deliberate non-guesses
 *
 * Two things this module refuses to infer, because guessing wrong is worse
 * than not trying:
 *
 *   - **Years.** `1999` could be a year ("nineteen ninety nine") or a
 *     quantity ("one thousand nine hundred ninety nine"), and `1500 dollars`
 *     proves the quantity reading is often right. Bare integers are ALWAYS
 *     read as cardinals; `expandYear()` is exported for callers that actually
 *     know the context (e.g. a date field), rather than being applied by a
 *     heuristic that would silently corrupt prices and counts.
 *   - **Acronym pronunciation.** `NASA` is said as a word, `USA` letter by
 *     letter, and nothing in the surface form distinguishes them. All-caps
 *     tokens are passed through with `wasAllCaps: true` so
 *     `PronunciationLexicon.js` gets first refusal and `G2PModel.js` can fall
 *     back to spelling out — the decision belongs where the pronunciation
 *     knowledge lives, not here.
 *
 * Dates are likewise out of scope for `v0` (format-ambiguous: `3/4` is a
 * date in one locale and a fraction in another), documented as unhandled
 * rather than half-handled.
 *
 * Clock times ARE handled, because their surface form is unambiguous enough:
 * `H:MM`/`HH:MM` with a valid hour (0–23) and exactly two minute digits, not
 * part of a longer `a:b:c` run. `10:00` → "ten o'clock", `10:30` → "ten
 * thirty", `10:05` → "ten oh five", `9:15 pm` → "nine fifteen p m". A
 * one-digit right side (`2:1`) is left alone, so ratios and scores keep their
 * existing comma-pause reading.
 */

import { PUNCTUATION_CONTEXT, STRUCTURAL_SYMBOLS } from './PhonemeSet.js';

const ONES = Object.freeze([
    'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
    'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
    'seventeen', 'eighteen', 'nineteen',
]);

const TENS = Object.freeze(['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']);

/** Descending so the largest scale is consumed first. Capped at trillion: beyond ~1e15 `Number` loses integer precision, so `expandCardinal` rejects rather than silently mis-speaking. */
const SCALES = Object.freeze([
    [1e12, 'trillion'],
    [1e9, 'billion'],
    [1e6, 'million'],
    [1e3, 'thousand'],
]);

export const MAX_CARDINAL = 1e15;

/** Irregular ordinal stems; everything else takes a plain `th`. */
const ORDINAL_IRREGULAR = Object.freeze({
    one: 'first', two: 'second', three: 'third', five: 'fifth',
    eight: 'eighth', nine: 'ninth', twelve: 'twelfth',
    twenty: 'twentieth', thirty: 'thirtieth', forty: 'fortieth', fifty: 'fiftieth',
    sixty: 'sixtieth', seventy: 'seventieth', eighty: 'eightieth', ninety: 'ninetieth',
});

/**
 * Expanded before phrase splitting, so their trailing `.` never reads as a
 * sentence end. Keys are matched case-insensitively without the period.
 */
export const ABBREVIATIONS = Object.freeze({
    mr: 'mister', mrs: 'missus', ms: 'miss', dr: 'doctor', prof: 'professor',
    st: 'saint', mt: 'mount', ft: 'fort', jr: 'junior', sr: 'senior',
    vs: 'versus', etc: 'et cetera', approx: 'approximately',
    dept: 'department', est: 'established', min: 'minutes', max: 'maximum',
    no: 'number', vol: 'volume', ave: 'avenue', blvd: 'boulevard', rd: 'road',
});
const NUMERIC_ONLY_ABBREVIATIONS = new Set(['no', 'vol', 'min', 'max', 'est']);

/** Standalone symbol → word. Applied per token, so `&` between words works but `AT&T` is left to the lexicon. */
export const SYMBOL_WORDS = Object.freeze({
    '&': 'and', '%': 'percent', '+': 'plus', '=': 'equals', '@': 'at',
    '#': 'number', '/': 'slash', '<': 'less than', '>': 'greater than',
    '\u00b0': 'degrees', '\u00a9': 'copyright', '\u00ae': 'registered',
    '\u2122': 'trademark', '\u20ac': 'euros', '\u00a3': 'pounds', '\u00a5': 'yen',
});

const CURRENCY_UNITS = Object.freeze({
    '$': { major: 'dollars', minor: 'cents', majorOne: 'dollar', minorOne: 'cent' },
    '\u00a3': { major: 'pounds', minor: 'pence', majorOne: 'pound', minorOne: 'penny' },
    '\u20ac': { major: 'euros', minor: 'cents', majorOne: 'euro', minorOne: 'cent' },
});

/**
 * Sentinels standing in for a decimal point and a digit-grouping comma while
 * phrase splitting runs. Private-use codepoints, so they cannot collide with
 * real text. BOTH are needed: `.` and `,` are each simultaneously a phrase
 * terminator and a number-internal character, so protecting only one leaves
 * the other splitting numbers in half (`1,234` → `one` + `two hundred thirty
 * four`).
 */
const DECIMAL_SENTINEL = '\uE000';
const COMMA_SENTINEL = '\uE001';

function restoreSentinels(text) {
    return text.split(DECIMAL_SENTINEL).join('.').split(COMMA_SENTINEL).join(',');
}

function belowThousandWords(n) {
    const out = [];
    let rest = n;
    if (rest >= 100) {
        out.push(ONES[Math.floor(rest / 100)], 'hundred');
        rest %= 100;
    }
    if (rest >= 20) {
        out.push(TENS[Math.floor(rest / 10)]);
        rest %= 10;
        if (rest > 0) out.push(ONES[rest]);
    } else if (rest > 0) {
        out.push(ONES[rest]);
    }
    return out;
}

/** @returns {string[]} `n` as cardinal words. Negative values are prefixed `minus`. */
export function expandCardinal(n) {
    if (!Number.isInteger(n)) throw new TypeError(`expandCardinal requires an integer, got ${n}`);
    if (Math.abs(n) >= MAX_CARDINAL) throw new RangeError(`expandCardinal: |${n}| exceeds ${MAX_CARDINAL}, beyond safe integer word expansion`);
    if (n < 0) return ['minus', ...expandCardinal(-n)];
    if (n === 0) return ['zero'];

    const out = [];
    let rest = n;
    for (const [value, name] of SCALES) {
        if (rest >= value) {
            out.push(...belowThousandWords(Math.floor(rest / value)), name);
            rest %= value;
        }
    }
    if (rest > 0) out.push(...belowThousandWords(rest));
    return out;
}

/** @returns {string[]} `n` as ordinal words (`21` → `['twenty', 'first']`). */
export function expandOrdinal(n) {
    if (!Number.isInteger(n) || n < 0) throw new RangeError(`expandOrdinal requires a non-negative integer, got ${n}`);
    const words = expandCardinal(n);
    const last = words[words.length - 1];
    const irregular = ORDINAL_IRREGULAR[last];
    if (irregular) {
        words[words.length - 1] = irregular;
    } else if (last.endsWith('y')) {
        // Defensive: TENS are all in ORDINAL_IRREGULAR, so this only fires if
        // that table and TENS ever drift apart.
        words[words.length - 1] = `${last.slice(0, -1)}ieth`;
    } else {
        words[words.length - 1] = `${last}th`;
    }
    return words;
}

/** @returns {string[]} Digits spoken individually, for decimal fractions and spelled-out sequences. */
export function expandDigits(digits) {
    return [...String(digits)].filter((c) => c >= '0' && c <= '9').map((c) => ONES[Number(c)]);
}

/**
 * Read a 4-digit year the way speech does. NOT applied automatically — see
 * this module's "deliberate non-guesses" note; callers that know a number is
 * a year opt in explicitly.
 */
export function expandYear(year) {
    if (!Number.isInteger(year) || year < 1000 || year > 9999) {
        throw new RangeError(`expandYear requires a 4-digit integer, got ${year}`);
    }
    const high = Math.floor(year / 100);
    const low = year % 100;
    const roundCentury = high % 10 === 0;

    // Order matters, and each branch is a genuinely different spoken form:
    //   2000 -> "two thousand"        (round century, no remainder)
    //   1900 -> "nineteen hundred"    (non-round century, no remainder)
    //   2005 -> "two thousand five"   (round century, single-digit remainder)
    //   1905 -> "nineteen oh five"    (non-round century, single-digit remainder)
    //   2020 -> "twenty twenty"       (two-digit remainder reads as two pairs)
    //   1999 -> "nineteen ninety nine"
    if (low === 0) {
        return roundCentury
            ? [...expandCardinal(high / 10), 'thousand']
            : [...expandCardinal(high), 'hundred'];
    }
    if (low < 10) {
        return roundCentury
            ? [...expandCardinal(high / 10), 'thousand', ...expandCardinal(low)]
            : [...expandCardinal(high), 'oh', ...expandCardinal(low)];
    }
    return [...expandCardinal(high), ...expandCardinal(low)];
}

/**
 * Spoken clock time. With a meridiem, hour 0 reads "twelve". Whole hours read
 * "o'clock" on a 12-hour clock and "hundred" for 0 and 13–23 ("thirteen hundred").
 * @param {number} hour 0–23
 * @param {number} minute 0–59
 * @param {'am'|'pm'|null} [meridiem]
 * @returns {string[]}
 */
export function expandClockTime(hour, minute, meridiem = null) {
    if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59
        || ![null, 'am', 'pm'].includes(meridiem)) {
        throw new RangeError(`expandClockTime requires hour 0-23, minute 0-59 and am/pm/null, got ${hour}:${minute} ${meridiem}`);
    }
    const spokenHour = meridiem && hour === 0 ? 12 : hour;
    const words = expandCardinal(spokenHour);
    if (minute === 0) words.push(!meridiem && (hour === 0 || hour > 12) ? 'hundred' : 'oclock');
    else words.push(...(minute < 10 ? ['oh', ...expandCardinal(minute)] : expandCardinal(minute)));
    if (meridiem) words.push(meridiem === 'am' ? 'ay' : 'pee', 'em');
    return words;
}

// Hour 0-23, exactly two minute digits, not inside a longer a:b:c run. The
// meridiem's final period is left in place so a sentence-ending "p.m." keeps its terminal.
const CLOCK_TIME = /(?<![\d:])([01]?\d|2[0-3]):([0-5]\d)(?![:\d])(?:\s?([AaPp])\.?\s?[Mm](?![A-Za-z]))?/g;

function expandClockTimes(text) {
    return text.replace(CLOCK_TIME, (_, hour, minute, meridiem) =>
        expandClockTime(Number(hour), Number(minute), meridiem ? `${meridiem.toLowerCase()}m` : null).join(' '));
}

function expandDecimal(text) {
    const negative = text.startsWith('-');
    const body = negative ? text.slice(1) : text;
    const [intPart, fracPart = ''] = body.split('.');
    const intValue = Number(intPart.replace(/,/g, '') || '0');
    const words = expandCardinal(intValue);
    if (fracPart.length > 0) words.push('point', ...expandDigits(fracPart));
    return negative ? ['minus', ...words] : words;
}

function expandCurrency(symbol, amountText) {
    const units = CURRENCY_UNITS[symbol];
    const [intPart, fracPart] = amountText.replace(/,/g, '').split('.');
    const majorValue = Number(intPart || '0');
    const words = [...expandCardinal(majorValue), majorValue === 1 ? units.majorOne : units.major];
    if (fracPart !== undefined && fracPart.length > 0) {
        // Pad so "$5.5" reads as fifty cents, not five cents.
        const minorValue = Number(fracPart.padEnd(2, '0').slice(0, 2));
        if (minorValue > 0) {
            words.push(...expandCardinal(minorValue), minorValue === 1 ? units.minorOne : units.minor);
        }
    }
    return words;
}

/** Unicode/typography normalization: NFKC, curly quotes and dashes to ASCII, whitespace collapsed (paragraph breaks preserved as `\n\n`). */
export function normalizeCharacters(raw) {
    return raw
        .normalize('NFKC')
        .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
        .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
        .replace(/[\u2013\u2014\u2015]/g, ' ') // en/em dash act as phrase separators, not hyphens
        .replace(/\u2026/g, '.')               // ellipsis → terminal pause
        .replace(/[\u00A0\u2007\u202F]/g, ' ')
        .replace(/\r\n?/g, '\n')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{2,}/g, '\n\n')            // collapse to a single paragraph marker
        .trim();
}

function expandAbbreviations(text) {
    // Word-boundary match on `abbrev.`; the period is consumed so it cannot
    // later be read as a sentence terminator.
    return text.replace(/\b([A-Za-z]+)\.(?=\s|$)/g, (match, word, offset, whole) => {
        const key = word.toLowerCase(), expansion = ABBREVIATIONS[key];
        if (expansion === undefined) return match;
        // Abbreviations that are also ordinary words ("Oh no.", "to the max.")
        // expand only before a number ("No. 5", "vol. 2", "min. 30").
        if (NUMERIC_ONLY_ABBREVIATIONS.has(key) && !/^\s*\d/.test(whole.slice(offset + match.length))) return match;
        return expansion;
    });
}

const BOUNDARY_SPEC = Object.freeze({
    [PUNCTUATION_CONTEXT.none]: { structural: null, breathLikely: false },
    [PUNCTUATION_CONTEXT.comma]: { structural: STRUCTURAL_SYMBOLS.SHORT_PAUSE, breathLikely: false },
    [PUNCTUATION_CONTEXT.period]: { structural: STRUCTURAL_SYMBOLS.SILENCE, breathLikely: false },
    [PUNCTUATION_CONTEXT.question]: { structural: STRUCTURAL_SYMBOLS.SILENCE, breathLikely: false },
    [PUNCTUATION_CONTEXT.exclamation]: { structural: STRUCTURAL_SYMBOLS.SILENCE, breathLikely: false },
    [PUNCTUATION_CONTEXT.paragraph]: { structural: STRUCTURAL_SYMBOLS.SILENCE, breathLikely: true },
});

/** @returns {number} The §4 tag for a boundary punctuation character. */
function boundaryTagFor(ch) {
    switch (ch) {
        case ',': case ';': case ':': return PUNCTUATION_CONTEXT.comma;
        case '.': return PUNCTUATION_CONTEXT.period;
        case '?': return PUNCTUATION_CONTEXT.question;
        case '!': return PUNCTUATION_CONTEXT.exclamation;
        default: return PUNCTUATION_CONTEXT.none;
    }
}

/** Expand one whitespace-delimited token into zero or more spoken words. */
function expandToken(token) {
    const stripped = token.replace(/^[("'\[]+|[)"'\]]+$/g, '');
    if (stripped.length === 0) return [];

    // Currency: symbol immediately before a number.
    const currency = /^([$\u00a3\u20ac])([\d,]+(?:\.\d+)?)$/.exec(stripped);
    if (currency) return expandCurrency(currency[1], currency[2]).map((w) => ({ text: w, wasAllCaps: false }));

    // Percent suffix.
    const percent = /^([\d,]+(?:\.\d+)?)%$/.exec(stripped);
    if (percent) return [...expandDecimal(percent[1]), 'percent'].map((w) => ({ text: w, wasAllCaps: false }));

    // Ordinal digits: 1st, 22nd, 3rd, 14th.
    const ordinal = /^(\d+)(?:st|nd|rd|th)$/i.exec(stripped);
    if (ordinal) return expandOrdinal(Number(ordinal[1])).map((w) => ({ text: w, wasAllCaps: false }));

    // Plain number, optionally negative / comma-grouped / decimal.
    if (/^-?[\d,]+(?:\.\d+)?$/.test(stripped)) {
        return expandDecimal(stripped.replace(/,/g, '')).map((w) => ({ text: w, wasAllCaps: false }));
    }

    // A bare symbol token.
    if (SYMBOL_WORDS[stripped]) {
        return SYMBOL_WORDS[stripped].split(' ').map((w) => ({ text: w, wasAllCaps: false }));
    }

    // Hyphenated / slashed compounds split into their parts, each re-expanded
    // so "twenty-2" and "and/or" behave.
    if (/[-/]/.test(stripped) && /[A-Za-z\d]/.test(stripped)) {
        const parts = stripped.split(/[-/]+/).filter(Boolean);
        if (parts.length > 1) return parts.flatMap(expandToken);
    }

    // Alphabetic (or mixed) word. Strip any remaining punctuation, keep the
    // all-caps signal for the lexicon/G2P to act on.
    const cleaned = stripped.replace(/[^A-Za-z0-9']/g, '');
    if (cleaned.length === 0) return [];
    const wasAllCaps = cleaned.length > 1 && cleaned === cleaned.toUpperCase() && /[A-Z]/.test(cleaned);

    // A token that still mixes letters and digits ("a4", "3d") is split so the
    // digits get spoken rather than reaching the lexicon as an unknown word.
    if (/\d/.test(cleaned) && /[A-Za-z]/.test(cleaned)) {
        return cleaned
            .split(/(\d+)/)
            .filter(Boolean)
            .flatMap((part) => (/^\d+$/.test(part)
                ? expandCardinal(Number(part)).map((w) => ({ text: w, wasAllCaps: false }))
                : [{ text: part.toLowerCase(), wasAllCaps: part.length > 1 && part === part.toUpperCase() }]));
    }

    return [{ text: cleaned.toLowerCase(), wasAllCaps }];
}

/**
 * @param {string} raw
 * @returns {{ raw: string, phrases: Array<{ words: Array<{text: string, wasAllCaps: boolean}>, boundary: number, structural: string|null, breathLikely: boolean }> }}
 */
export function normalizeText(raw) {
    if (typeof raw !== 'string') throw new TypeError('normalizeText requires a string');

    let text = normalizeCharacters(raw);
    // Before abbreviations and phrase splitting: ':' would otherwise become a pause.
    text = expandClockTimes(text);
    text = expandAbbreviations(text);
    // Protect number-internal punctuation so phrase splitting cannot cut a
    // number in half. Digit-grouping commas are only protected when exactly
    // three digits follow, so an ordinary "x,y" list separator still splits.
    text = text.replace(/(\d),(?=\d{3}(?!\d))/g, `$1${COMMA_SENTINEL}`);
    text = text.replace(/(\d)\.(\d)/g, `$1${DECIMAL_SENTINEL}$2`);

    const phrases = [];
    let buffer = '';

    const flush = (tag) => {
        const words = restoreSentinels(buffer).split(' ').filter(Boolean).flatMap(expandToken);
        buffer = '';
        // A boundary with no words before it (e.g. "!!") must not create an
        // empty phrase; instead it upgrades the previous phrase's boundary,
        // so "Wait!!" ends up exclamation rather than exclamation + empty.
        if (words.length === 0) {
            if (phrases.length > 0 && tag !== PUNCTUATION_CONTEXT.none) {
                const prev = phrases[phrases.length - 1];
                if (tag > prev.boundary) {
                    prev.boundary = tag;
                    Object.assign(prev, BOUNDARY_SPEC[tag]);
                }
            }
            return;
        }
        phrases.push({ words, boundary: tag, ...BOUNDARY_SPEC[tag] });
    };

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '\n') {
            // A blank line (already collapsed to exactly "\n\n") is a paragraph
            // break; a single newline is just whitespace.
            if (text[i + 1] === '\n') {
                flush(PUNCTUATION_CONTEXT.paragraph);
                i += 1;
            } else if (/[A-Z0-9]/.test(text[i + 1] ?? '') && buffer.trim()) {
                // A line that ends without punctuation and is followed by a line
                // starting with a capital or digit is a list item, label or
                // heading ("MARKET LIST" / "APPLES 4"): give it a comma-level
                // pause. A lowercase continuation is a soft wrap and stays whitespace.
                flush(PUNCTUATION_CONTEXT.comma);
            } else {
                buffer += ' ';
            }
            continue;
        }
        const tag = boundaryTagFor(ch);
        if (tag === PUNCTUATION_CONTEXT.none) {
            buffer += ch;
        } else {
            flush(tag);
        }
    }
    // Trailing text with no terminator still forms a phrase; `none` means the
    // caller decides (mid-utterance continuation vs. end of input).
    if (buffer.trim().length > 0) flush(PUNCTUATION_CONTEXT.none);

    return { raw, phrases };
}

/** @returns {string[]} Every spoken word across all phrases, for lexicon coverage checks and tests. */
export function flattenWords(normalized) {
    return normalized.phrases.flatMap((p) => p.words.map((w) => w.text));
}

export default normalizeText;
