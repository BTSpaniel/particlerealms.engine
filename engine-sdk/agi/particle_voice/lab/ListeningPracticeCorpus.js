// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Original Navi listening practice, separate from the held-out evaluation corpus.
 * Format references: ASHA describes sound contrasts, single words across sound
 * positions, and connected speech; vocabulary and response mode affect the task.
 * https://www.asha.org/practice-portal/clinical-topics/articulation-and-phonology/
 * https://www.asha.org/practice-portal/clinical-topics/hearing-loss-in-children/
 *
 * This is not a clinical test, child assessment, or age-normed instrument.
 * Focus metadata describes the authored stimulus, not measured phoneme accuracy.
 * Explicit pronunciations provide a practice control; text rendering still uses
 * the current frontend and must retain its pronunciation-source warnings.
 * Stress follows ParticleVoice: 2 = primary, 1 = secondary, 0 = unstressed.
 */
export const PRACTICE_CORPUS_VERSION = 'particle-voice-listening-practice-v1';

export const PRACTICE_WORDS = Object.freeze([
    ['moon', 'M UW2 N', 'M', 'initial', ['moon', 'mop', 'noon', 'spoon']],
    ['fish', 'F IH2 SH', 'F', 'initial', ['fish', 'dish', 'wish', 'ship']],
    ['sun', 'S AH2 N', 'S', 'initial', ['sun', 'run', 'fun', 'soup']],
    ['key', 'K IY2', 'K', 'initial', ['key', 'tea', 'bee', 'see']],
    ['baby', 'B EY2 B IY', 'B', 'medial', ['baby', 'lady', 'bunny', 'berry']],
    ['money', 'M AH2 N IY', 'N', 'medial', ['money', 'honey', 'bunny', 'muddy']],
    ['ocean', 'OW2 SH AH N', 'SH', 'medial', ['ocean', 'open', 'over', 'oval']],
    ['seven', 'S EH2 V AH N', 'V', 'medial', ['seven', 'lemon', 'heaven', 'eleven']],
    ['book', 'B UH2 K', 'K', 'final', ['book', 'look', 'cook', 'boot']],
    ['leaf', 'L IY2 F', 'F', 'final', ['leaf', 'leak', 'lean', 'leap']],
    ['rose', 'R OW2 Z', 'Z', 'final', ['rose', 'road', 'rope', 'robe']],
    ['hat', 'HH AE2 T', 'T', 'final', ['hat', 'ham', 'hand', 'hair']],
].map(([text, phonemes, sound, position, choices], index) => Object.freeze({
    id: `practice-word-${String(index + 1).padStart(2, '0')}`, text, phonemes,
    focus: Object.freeze({ sound, position }), choices: Object.freeze(choices),
})));

export const PRACTICE_CONTRASTS = Object.freeze([
    ['pat', 'P AE2 T', 'bat', 'B AE2 T', 'P', 'B', 'initial'],
    ['tea', 'T IY2', 'key', 'K IY2', 'T', 'K', 'initial'],
    ['fan', 'F AE2 N', 'pan', 'P AE2 N', 'F', 'P', 'initial'],
    ['sock', 'S AA2 K', 'shock', 'SH AA2 K', 'S', 'SH', 'initial'],
    ['chop', 'CH AA2 P', 'shop', 'SH AA2 P', 'CH', 'SH', 'initial'],
    ['rain', 'R EY2 N', 'lane', 'L EY2 N', 'R', 'L', 'initial'],
    ['feet', 'F IY2 T', 'feed', 'F IY2 D', 'T', 'D', 'final'],
    ['map', 'M AE2 P', 'mat', 'M AE2 T', 'P', 'T', 'final'],
    ['ram', 'R AE2 M', 'ran', 'R AE2 N', 'M', 'N', 'final'],
    ['hat', 'HH AE2 T', 'hot', 'HH AA2 T', 'AE', 'AA', 'medial'],
    ['peck', 'P EH2 K', 'pick', 'P IH2 K', 'EH', 'IH', 'medial'],
    ['mail', 'M EY2 L', 'mile', 'M AY2 L', 'EY', 'AY', 'medial'],
].map(([first, firstPhonemes, second, secondPhonemes, firstSound, secondSound, position], index) => Object.freeze({
    id: `practice-contrast-${String(index + 1).padStart(2, '0')}`,
    choices: Object.freeze([first, second]), phonemes: Object.freeze([firstPhonemes, secondPhonemes]),
    focus: Object.freeze({ sounds: Object.freeze([firstSound, secondSound]), position }),
})));

export const PRACTICE_SENTENCES = Object.freeze([
    'I see a red bus.',
    'We can jump up.',
    'The baby has a ball.',
    'Please take my book.',
    'Set the cup on top.',
    'The fish can swim.',
    'My sock is wet.',
    'Please help me.',
    'The moon is up.',
    'I can see two green cups.',
].map((text, index) => Object.freeze({
    id: `practice-sentence-${String(index + 1).padStart(2, '0')}`, text,
})));
