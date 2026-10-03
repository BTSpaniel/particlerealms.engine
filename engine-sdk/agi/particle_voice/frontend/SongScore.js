// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Tiny song notation for Particle Voice singing.
 *
 *   [tempo 90] Twin(C4) kle(C4) twin(G4) kle(G4) lit(A4) tle(A4) star(G4:2) (rest:1)
 *
 * Each token is a lyric fragment (a word or syllable) with one note in
 * scientific pitch notation (C4 = middle C, sharps `#`, flats `b`) and an
 * optional beat count (default 1). `(rest:n)` is silence. The lyric is
 * pronounced by the ordinary G2P path, so syllable fragments follow its
 * letter-to-sound rules; spell fragments the way they sound ("twin", "kle").
 * As in common singing editors, a lyric of `-` holds the previous vowel onto a
 * new pitch (legato/melisma), `br` is a breath, and `+` carries the next
 * syllable of the previous word, so whole words keep their dictionary
 * pronunciation: `twinkle(C4) +(C4) little(A4) +(A4) star(G4:2) br(C4:1)`.
 */
export const SONG_LIMITS = Object.freeze({ maxNotes: 256, minMidi: 33, maxMidi: 81, minTempo: 30, maxTempo: 240, maxBeats: 16 });
const STEP = Object.freeze({ c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 });

/** Scientific pitch name → MIDI number ("A4" → 69). */
export function noteToMidi(name) {
    const match = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(String(name).trim());
    if (!match) throw new RangeError(`Unknown note "${name}"; use names such as C4, F#3 or Bb4`);
    const midi = (Number(match[3]) + 1) * 12 + STEP[match[1].toLowerCase()] + (match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0);
    if (midi < SONG_LIMITS.minMidi || midi > SONG_LIMITS.maxMidi) throw new RangeError(`Note ${name} is outside the singable range A1-A5`);
    return midi;
}
export const midiToHz = (midi) => 440 * 2 ** ((midi - 69) / 12);

/** @returns {{tempo: number, notes: Array<{text: string|null, midi: number|null, beats: number}>}} */
export function parseSong(source, { tempo: defaultTempo = 90 } = {}) {
    if (typeof source !== 'string' || !source.trim() || source.length > 8192) throw new TypeError('A song needs 1 to 8192 characters of notation');
    let tempo = defaultTempo;
    const body = source.replace(/\[tempo\s+(\d{2,3})\]/i, (_, value) => { tempo = Number(value); return ' '; });
    if (!Number.isInteger(tempo) || tempo < SONG_LIMITS.minTempo || tempo > SONG_LIMITS.maxTempo) throw new RangeError(`Tempo must be ${SONG_LIMITS.minTempo}-${SONG_LIMITS.maxTempo} beats per minute`);
    const notes = [], token = /([^\s()]*)\(([^)]*)\)|(\S+)/g;
    let match;
    while ((match = token.exec(body))) {
        if (match[3]) throw new SyntaxError(`"${match[3]}" has no note; write it as word(C4) or word(C4:2)`);
        const lyric = match[1], [pitch, beatText = '1'] = match[2].split(':').map((part) => part.trim()), beats = Number(beatText);
        if (!Number.isFinite(beats) || beats <= 0 || beats > SONG_LIMITS.maxBeats) throw new RangeError(`Beats must be in (0, ${SONG_LIMITS.maxBeats}]`);
        if (pitch.toLowerCase() === 'rest') { if (lyric) throw new SyntaxError('A rest cannot carry lyrics'); notes.push(Object.freeze({ kind: 'rest', text: null, midi: null, beats })); }
        else if (lyric.toLowerCase() === 'br') notes.push(Object.freeze({ kind: 'breath', text: null, midi: null, beats }));
        else if (lyric === '-' || lyric === '+') {
            if (!notes.some((note) => note.kind === 'sing')) throw new SyntaxError(`A "${lyric}" note needs a sung word before it`);
            notes.push(Object.freeze({ kind: lyric === '-' ? 'legato' : 'syllable', text: lyric, midi: noteToMidi(pitch), beats }));
        } else {
            if (!/[a-z]/i.test(lyric)) throw new SyntaxError(`Note ${pitch} needs a lyric`);
            notes.push(Object.freeze({ kind: 'sing', text: lyric.toLowerCase().replace(/[^a-z']/g, ''), midi: noteToMidi(pitch), beats }));
        }
        if (notes.length > SONG_LIMITS.maxNotes) throw new RangeError(`A song has at most ${SONG_LIMITS.maxNotes} notes`);
    }
    if (!notes.some((note) => note.kind === 'sing')) throw new SyntaxError('The song has no sung notes');
    return Object.freeze({ tempo, notes: Object.freeze(notes) });
}

/** Vowel-group syllable estimate for timing (a silent final "e" does not count, "-le" does). */
export function countSyllables(word) {
    const w = String(word).toLowerCase().replace(/[^a-z]/g, '');
    if (!w) return 0;
    const groups = w.match(/[aeiouy]+/g)?.length ?? 0;
    const silentE = /[^aeiouy]e$/.test(w) && !/[^aeiouy]le$/.test(w) && groups > 1 ? 1 : 0;
    return Math.max(1, groups - silentE);
}

const MAJOR = Object.freeze([0, 2, 4, 5, 7, 9, 11, 12]);
/** Scale-degree walk for a phrase: rise, turn and settle. */
const CONTOUR = Object.freeze([0, 2, 4, 4, 5, 4, 2, 1, 2, 4, 5, 7, 5, 4, 2, 1]);

/**
 * Turn ordinary text into song notation: one note per syllable, with whole
 * words kept together through "+" so the lexicon pronounces them, pitch walks
 * a major-scale contour, phrases end on the tonic (a question ends up high),
 * commas hold and sentence ends breathe. A deterministic starting melody for
 * the user to reshape in the piano roll, not a composition model.
 */
export function melodyFromText(text, { tonicMidi = 60, tempo = 96, maxNotes = SONG_LIMITS.maxNotes } = {}) {
    if (typeof text !== 'string') throw new TypeError('melodyFromText requires text');
    const tonic = Math.min(SONG_LIMITS.maxMidi - 12, Math.max(SONG_LIMITS.minMidi, Math.round(tonicMidi)));
    const clean = text.replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
    const tokens = clean.match(/[A-Za-z']+|[.!?;:,]/g) ?? [];
    const parts = [`[tempo ${tempo}]`];
    // Each sentence enters the contour at a different point so short lines don't all start on the tonic.
    let step = 0, notes = 0, pending = null, sentence = 0;
    // Each syllable gets its own note on the contour; extra syllables use "+".
    const flush = (ending) => {
        if (!pending) return;
        for (let k = 0; k < pending.syllables; k++) {
            let midi = tonic + MAJOR[CONTOUR[step % CONTOUR.length]], beats = 1;
            if (k === pending.syllables - 1) {
                if (ending === '?') { midi = tonic + 7; beats += 1; } else if (ending === '.' || ending === '!') { midi = tonic; beats += 1; }
                else if (ending) beats += 0.5;
            }
            parts.push(`${k ? '+' : pending.word}(${midiToNoteName(midi)}:${beats})`);
            step++; notes++;
        }
        if (ending && ending !== ',') parts.push('br(C4:0.5)');
        pending = null;
    };
    for (const token of tokens) {
        if (notes >= maxNotes - 6) break;
        if (/^[.!?;:,]$/.test(token)) { flush(token === ';' || token === ':' ? '.' : token); if (token !== ',') step = (++sentence * 5) % CONTOUR.length; continue; }
        const word = token.toLowerCase().replace(/^'+|'+$/g, '');
        if (!/[a-z]/.test(word)) continue;
        flush(null);
        pending = { word, syllables: Math.min(4, countSyllables(word)) };
    }
    flush('.');
    if (notes === 0) throw new SyntaxError('There are no words to sing');
    if (parts.at(-1).startsWith('br(')) parts.pop();
    return parts.join(' ');
}

/** Scientific pitch name for a MIDI number (69 → "A4"). */
export function midiToNoteName(midi) {
    return `${['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][midi % 12]}${Math.floor(midi / 12) - 1}`;
}

/** Serialize timed notes (piano-roll form) back to notation; gaps become rests. */
export function formatSong({ tempo, notes }) {
    const sorted = [...notes].sort((a, b) => a.start - b.start), parts = [`[tempo ${tempo}]`];
    let cursor = 0;
    const beats = (value) => Number(value.toFixed(3)).toString();
    for (const note of sorted) {
        if (note.start > cursor + 1e-6) parts.push(`(rest:${beats(note.start - cursor)})`);
        const length = Math.max(0.125, note.beats);
        parts.push(`${note.lyric || 'la'}(${note.lyric === 'br' ? 'C4' : midiToNoteName(note.midi)}:${beats(length)})`);
        cursor = Math.max(cursor, note.start + length);
    }
    return parts.join(' ');
}
