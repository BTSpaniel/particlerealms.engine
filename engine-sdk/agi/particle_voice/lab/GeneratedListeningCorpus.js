// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Original, finite listening materials. These are diagnostic practice blocks,
 * not clinical instruments or alternate forms established to have equal difficulty.
 * Seeds select reviewed words and grammar, never provider-authored executable code.
 * Phoneme Y means /j/ (you); the letter name Y starts with phoneme W (why).
 */
import { mulberry32, shuffle, randomElement } from '../../../engine/core/math/MathRandom.js';
import { deepFreezeJson } from '../../../engine/core/schema/StrictJsonValue.js';
import { StoryGraph, createStorylet } from '../../../engine/gameplay/narrative/StoryGraph.js';
import { CORE_LEXICON } from '../frontend/PronunciationLexicon.js';

export const LEGACY_GENERATED_LISTENING_VERSION = 'particle-voice-generated-listening-v1';
export const GENERATED_LISTENING_VERSION = 'particle-voice-generated-listening-v2';
export const GENERATED_LISTENING_VERSIONS = Object.freeze([LEGACY_GENERATED_LISTENING_VERSION, GENERATED_LISTENING_VERSION]);
export const GENERATED_MODES = deepFreezeJson({
    balanced: { heading: 'Compare a balanced sound block', count: 24, unit: 'sound trials',
        question: 'Which word did you hear?', description: 'Six sound families, two word and vowel contexts, and both alternatives. Different family blocks have different coverage.' },
    blending: { heading: 'Follow a sound into a sentence', count: 12, unit: 'blending trials',
        question: 'Type the words you heard.', description: 'Four target words appear alone, in a carrier, and in a complete sentence. Score their context separately.' },
    generated: { heading: 'Listen to fresh short sentences', count: 12, unit: 'sentences',
        question: 'Type the words you heard.', description: 'A seed combines reviewed words into new three-to-six-word sentences. The exact lesson can be repeated.' },
    storylets: { heading: 'Listen to a small scene', count: 6, unit: 'scenes',
        question: 'Type the words you heard.', description: 'Each scene has two brief sentences. Record the words first, then answer a separate question about their meaning.' },
});

export const GENERATED_FAMILIES = deepFreezeJson([
    { id: 'k-t', sounds: ['K', 'T'], position: 'initial', label: 'K / T', legacyTargets: ['K', 'T', 'Q', 'key', 'tea'] },
    { id: 'jh-k', sounds: ['JH', 'K'], position: 'initial', label: 'J sound / K', legacyTargets: ['J', 'K', 'joke', 'coke'] },
    { id: 'jh-t', sounds: ['JH', 'T'], position: 'initial', label: 'G letter sound / T', legacyTargets: ['G', 'T', 'gee', 'tea'] },
    { id: 'n-l', sounds: ['N', 'L'], position: 'initial', label: 'N / L', legacyTargets: ['N', 'L', 'no', 'low'] },
    { id: 'w-zero', sounds: ['W'], position: 'initial', label: 'W onset / vowel onset (letter Y)', legacyTargets: ['Y', 'why', 'eye'] },
    { id: 's-f', sounds: ['S', 'F'], position: 'initial', label: 'S / F', legacyTargets: ['S', 'F', 'sun', 'fun', 'sin', 'fin'] },
    { id: 'sh-s', sounds: ['SH', 'S'], position: 'initial', label: 'SH / S', legacyTargets: ['shock', 'sock', 'shell', 'sell'] },
    { id: 'ch-sh', sounds: ['CH', 'SH'], position: 'initial', label: 'CH / SH', legacyTargets: ['chop', 'shop'] },
    { id: 'eh-ih', sounds: ['EH', 'IH'], position: 'medial', label: 'EH / IH', legacyTargets: ['peck', 'pick'] },
    { id: 'final-t-d', sounds: ['T', 'D'], position: 'final', label: 'Final T / D', legacyTargets: ['T', 'D', 'feet', 'feed'] },
    { id: 'r-l', sounds: ['R', 'L'], position: 'initial', label: 'R / L', legacyTargets: ['R', 'L', 'rain', 'lane', 'rock', 'lock'] },
    { id: 'p-f', sounds: ['P', 'F'], position: 'initial', label: 'P / F', legacyTargets: ['P', 'F', 'pin', 'fin', 'pan', 'fan'] },
    { id: 'm-n', sounds: ['M', 'N'], position: 'final', label: 'Final M / N', legacyTargets: ['M', 'N', 'ram', 'ran'] },
]);
export const GENERATED_FOCUS_IDS = Object.freeze(GENERATED_FAMILIES.map(family => family.id));
const DEFAULT_FAMILIES = Object.freeze(['k-t', 'jh-k', 'n-l', 'w-zero', 'sh-s', 'eh-ih']);
const FAMILY_BY_ID = new Map(GENERATED_FAMILIES.map(family => [family.id, family]));

// Project-reviewed ARPABET-style targets; 2 is primary stress in ParticleVoice.
// These remain stimulus metadata, never installed as voice-wide overrides.
// Word-level reference convention: https://github.com/cmusphinx/cmudict
export const GENERATED_PRONUNCIATIONS = deepFreezeJson({
    ...CORE_LEXICON,
    key: 'K IY2', tea: 'T IY2', joke: 'JH OW2 K', coke: 'K OW2 K', gee: 'JH IY2',
    low: 'L OW2', sin: 'S IH2 N', fin: 'F IH2 N', shell: 'SH EH2 L', sell: 'S EH2 L',
    chop: 'CH AA2 P', shop: 'SH AA2 P', peck: 'P EH2 K', pick: 'P IH2 K',
    feet: 'F IY2 T', feed: 'F IY2 D', rock: 'R AA2 K', lock: 'L AA2 K',
    pin: 'P IH2 N', ram: 'R AE2 M', ran: 'R AE2 N', moon: 'M UW2 N',
    red: 'R EH2 D', green: 'G R IY2 N', small: 'S M AO2 L', big: 'B IH2 G',
    ball: 'B AO2 L', cup: 'K AH2 P', bag: 'B AE2 G', hat: 'HH AE2 T',
    bus: 'B AH2 S', bed: 'B EH2 D', boat: 'B OW2 T',
    mean: 'M IY2 N', neat: 'N IY2 T', let: 'L EH2 T', too: 'T UW2',
    cool: 'K UW2 L', tool: 'T UW2 L', jeep: 'JH IY2 P', keep: 'K IY2 P',
    jest: 'JH EH2 S T', test: 'T EH2 S T', nay: 'N EY2', lay: 'L EY2',
    wail: 'W EY2 L', ale: 'EY2 L', sat: 'S AE2 T', fat: 'F AE2 T',
    chew: 'CH UW2', pen: 'P EH2 N', bet: 'B EH2 T', ray: 'R EY2',
    pat: 'P AE2 T', dim: 'D IH2 M', din: 'D IH2 N',
    ring: 'R IH2 NG', map: 'M AE2 P', sock: 'S AA2 K', cap: 'K AE2 P',
    coat: 'K OW2 T', bell: 'B EH2 L', lamp: 'L AE2 M P', desk: 'D EH2 S K',
    jump: 'JH AH2 M P', swim: 'S W IH2 M', sing: 'S IH2 NG', rest: 'R EH2 S T',
    wait: 'W EY2 T', run: 'R AH2 N', sit: 'S IH2 T', stand: 'S T AE2 N D',
    soon: 'S UW2 N',
});
const PAIRS = deepFreezeJson({
    'k-t': [['key', 'tea'], ['cool', 'tool']], 'jh-k': [['joke', 'coke'], ['jeep', 'keep']],
    'jh-t': [['gee', 'tea'], ['jest', 'test']], 'n-l': [['no', 'low'], ['nay', 'lay']],
    'w-zero': [['why', 'eye'], ['wail', 'ale']], 's-f': [['sin', 'fin'], ['sat', 'fat']],
    'sh-s': [['shell', 'sell'], ['she', 'see']], 'ch-sh': [['chop', 'shop'], ['chew', 'shoe']],
    'eh-ih': [['peck', 'pick'], ['pen', 'pin']], 'final-t-d': [['feet', 'feed'], ['bet', 'bed']],
    'r-l': [['rock', 'lock'], ['ray', 'lay']], 'p-f': [['pin', 'fin'], ['pat', 'fat']],
    'm-n': [['ram', 'ran'], ['dim', 'din']],
});
const PARTITIONS = deepFreezeJson({
    practice: { nouns: ['book', 'shoe', 'ball', 'cup', 'key', 'ring', 'pen', 'map', 'sock', 'door'],
        adjectives: ['red', 'small', 'neat', 'old', 'blue', 'good'], pronouns: ['we', 'you', 'i'],
        verbs: ['look', 'go', 'jump', 'swim', 'sing', 'rest'],
        adverbs: ['now', 'again', 'tomorrow'], carrier: 'I say {target}.' },
    evaluation: { nouns: ['bag', 'hat', 'bed', 'boat', 'bus', 'cap', 'coat', 'bell', 'lamp', 'desk'],
        adjectives: ['green', 'big', 'new', 'dark', 'full', 'light'], pronouns: ['they', 'he', 'she'],
        verbs: ['come', 'work', 'wait', 'run', 'sit', 'stand'],
        adverbs: ['here', 'today', 'there', 'soon', 'then'], carrier: 'Please say {target}.' },
});
const SENTENCE_TEMPLATES = Object.freeze([
    'I see the {noun}.', 'Please take the {noun}.', 'The {noun} is {adjective}.',
    'I need the {noun}.', '{pronoun} can {verb}.', '{pronoun} will {verb} {adverb}.',
    'Can {pronoun} {verb} {adverb}?', 'Please {verb} {adverb}.',
    'The {adjective} {noun} is here.', 'Look at the {adjective} {noun}.',
    '{pronoun} can take the {noun}.', '{pronoun} will see the {noun}.',
    'The {noun} is over there.', 'Please give me the {noun}.',
    'I can {verb} {adverb}.', 'Let me {verb} {adverb}.',
]);
const BLENDS = deepFreezeJson([
    { word: 'key', family: 'k-t', practice: 'Please take my key now.', evaluation: 'You can see the key here.' },
    { word: 'shoe', family: 'sh-s', practice: 'I see the shoe now.', evaluation: 'Please find the shoe today.' },
    { word: 'moon', family: 'm-n', practice: 'We can see the moon.', evaluation: 'They see the moon today.' },
    { word: 'you', family: 'y-glide', practice: 'I can see you now.', evaluation: 'They need you here today.' },
]);

function words(text) { return text.toLowerCase().match(/[a-z]+(?:'[a-z]+)*/g) ?? []; }
function realize(template, bindings) {
    const text = template.replace(/\{([a-z]+)\}/g, (_, key) => {
        if (typeof bindings[key] !== 'string') throw new Error(`Missing authored slot ${key}`);
        return bindings[key];
    }).replace(/\bi\b/g, 'I');
    return text[0].toUpperCase() + text.slice(1);
}
function phonesFor(text) {
    return words(text).map(word => {
        const phones = GENERATED_PRONUNCIATIONS[word];
        if (!phones) throw new Error(`Unreviewed listening vocabulary: ${word}`);
        return phones;
    }).join(' | ');
}
function focusOf(id) {
    if (id === 'y-glide') return { id, sounds: ['Y', 'UW'], position: 'initial' };
    const family = FAMILY_BY_ID.get(id);
    return { id, sounds: family.sounds.slice(), position: family.position };
}
function trial(id, text, { kind = 'sentence', family = null, context = 'sentence', targetWord = null,
    templateId, bindings = {}, ...extra } = {}) {
    return { id, kind, text, phonemes: phonesFor(text), context, templateId, bindings,
        ...(family ? { focus: focusOf(family), focusIds: [family] } : { focusIds: [] }),
        ...(targetWord ? { targetWord, targetIndex: words(text).indexOf(targetWord) } : {}), ...extra };
}
function selectedFamilies(sessionType, focusIds, random) {
    if (sessionType === 'evaluation' || focusIds.length === 0) return DEFAULT_FAMILIES.slice();
    return [...focusIds, ...shuffle(GENERATED_FOCUS_IDS.filter(id => !focusIds.includes(id)), random)].slice(0, 6);
}

function balancedTrials(families, random) {
    const rows = [];
    for (const family of families) {
        const orientation = Math.floor(random() * 2);
        for (const [contextIndex, pair] of PAIRS[family].entries()) {
            const context = `lexical-${contextIndex + 1}`;
            // Each SOUND alternative occupies both answer positions across two
            // different lexical contexts; four distinct words are presented.
            const choices = (orientation ^ contextIndex) ? pair.slice().reverse() : pair.slice();
            for (let side = 0; side < 2; side++) rows.push(trial(`${family}-${context}-${side}`, pair[side], {
                kind: 'contrast', family, context, targetWord: pair[side], choices: choices.slice(),
                templateId: `balanced-${context}`, bindings: { target: pair[side], alternative: side,
                    vowelContext: GENERATED_PRONUNCIATIONS[pair[side]].split(' ').filter(phone => /[012]$/.test(phone)).join(' ') },
            }));
        }
    }
    return shuffle(rows, random);
}
function blendingTrials(sessionType, partition, focusIds, random, version) {
    const targets = shuffle(BLENDS, random).sort((a, b) => Number(focusIds.includes(b.family)) - Number(focusIds.includes(a.family)));
    return targets.flatMap(({word, family, ...sentences}) => ['isolated', 'carrier', 'sentence'].map(context => {
        const text = context === 'isolated' ? word : context === 'carrier'
            ? realize(partition.carrier, { target: word }) : sentences[sessionType];
        // Metadata only: keep v1's vocabulary, RNG consumption and requested-focus
        // ordering exactly reproducible. These words explore transitions; a missed
        // transcription cannot diagnose the former authored contrast-family label.
        const transition = version === GENERATED_LISTENING_VERSION && ['moon', 'shoe'].includes(word)
            ? { focus: { id: word === 'moon' ? 'm-uw-n' : 'sh-uw', type: 'transition',
                sounds: word === 'moon' ? ['M', 'UW', 'N'] : ['SH', 'UW'],
                position: word === 'moon' ? 'initial consonant through final consonant' : 'initial consonant to vowel' }, focusIds: [] } : {};
        return trial(`blend-${word}-${context}`, text, { kind: context === 'isolated' ? 'word' : 'sentence',
            family, context, targetWord: word, templateId: `blend-${word}-${context}-${sessionType}`, bindings: { target: word }, ...transition });
    }));
}
function slotBindings(partition, random) {
    return { noun: randomElement(partition.nouns, random), pronoun: randomElement(partition.pronouns, random),
        verb: randomElement(partition.verbs, random), adjective: randomElement(partition.adjectives, random),
        adverb: randomElement(partition.adverbs, random) };
}
function generatedTrials(partition, random) {
    return shuffle([...SENTENCE_TEMPLATES.entries()], random).slice(0, 12).map(([index, template]) => {
        const bindings = slotBindings(partition, random);
        return trial(`generated-${index}`, realize(template, bindings), { templateId: `sentence-${index}`, bindings });
    });
}

function storyletTrials(sessionType, partition, families, focusIds, random) {
    const templates = [
        ['I see a {noun}. The {noun} is {adjective}.', 'What thing did I see?', 'noun'],
        ['You have the {noun}. Please give it to me.', 'What thing do you have?', 'noun'],
        ['{pronoun} can {verb} now. {pronoun} will {verb} again.', 'What can they do?', 'verb'],
        ['The {noun} is {adjective}. I can see it here.', 'What is the thing like?', 'adjective'],
        ['Please take the {noun}. We need it today.', 'What thing do we need?', 'noun'],
        ['{pronoun} will {verb} {adverb}. I will {verb} too.', 'When or where will they do it?', 'adverb'],
    ];
    const events = [];
    let clock = 0;
    const graph = new StoryGraph({ emit: event => events.push(event.data.storyletId) }, null,
        { random, now: () => clock });
    try {
        graph.registerAll(templates.map(([template, question, answerKey], index) => createStorylet({
            id: `speech-scene-${sessionType}-${index}`, name: `Listening scene ${index + 1}`,
            cooldown: 0, priority: 1, maxFires: 1, tags: ['speech-listening-only'],
            canTrigger: state => state.sessionType === sessionType && state.kind === 'everyday',
            execute: () => {
                const bindings = slotBindings(partition, random);
                const text = realize(template, bindings).replace(/\. ([a-z])/g, (_, letter) => `. ${letter.toUpperCase()}`);
                const vocabulary = partition[{noun: 'nouns', adjective: 'adjectives', verb: 'verbs', adverb: 'adverbs'}[answerKey]];
                return { narrative: text, trial: trial(`storylet-${index}`, text, { context: 'scene',
                    templateId: `speech-scene-${sessionType}-${index}`, bindings,
                    comprehension: { question, choices: shuffle([bindings[answerKey],
                        ...shuffle(vocabulary.filter(word => word !== bindings[answerKey]), random).slice(0, 3)], random), answer: bindings[answerKey] } }) };
            },
        })));
        // Evaluation holds its three tested contrasts fixed; only their words,
        // order and lexical surroundings vary. Practice may prioritize misses.
        const sceneFamilies = sessionType === 'evaluation' ? families.slice(0, 3) : families;
        graph.registerAll(sceneFamilies.map(family => createStorylet({
            id: `speech-contrast-${sessionType}-${family}`, name: `Listening contrast ${family}`,
            cooldown: 0, priority: focusIds.includes(family) ? 2 : 1, maxFires: 1, tags: ['speech-listening-only'],
            canTrigger: state => state.sessionType === sessionType && state.kind === 'focused',
            execute: () => {
                const pair = randomElement(PAIRS[family], random), side = Math.floor(random() * 2);
                const bindings = { target: pair[side], other: pair[1 - side],
                    adverb: randomElement(partition.adverbs, random) };
                const template = sessionType === 'practice'
                    ? 'I say {target} {adverb}. You say {other} {adverb}.'
                    : 'You say {other} {adverb}. I say {target} {adverb}.';
                const text = realize(template, bindings);
                return { narrative: text, trial: trial(`storylet-contrast-${family}`, text, {
                    family, context: 'scene', targetWord: bindings.target,
                    templateId: `speech-contrast-${sessionType}-${family}`, bindings,
                    comprehension: { question: 'Which word did I say?', choices: shuffle(pair, random), answer: bindings.target },
                }) };
            },
        })));
        const rows = [];
        for (let index = 0; index < 6; index++) {
            clock = index * 1000;
            const result = graph.tick({ sessionType, kind: index < 3 ? 'focused' : 'everyday' });
            if (!result?.trial || result.error) throw new Error('Authored listening storylet failed');
            rows.push(result.trial);
        }
        if (new Set(events).size !== 6) throw new Error('Listening storylet repetition guard failed');
        return rows;
    } finally { graph.clear(); }
}

/** Generate one bounded lesson; no clock, external state, microphone or persistence. */
export function generateListeningLesson({ mode, seed, sessionType = 'practice', focusIds = [], version = GENERATED_LISTENING_VERSION } = {}) {
    if (!GENERATED_LISTENING_VERSIONS.includes(version)) throw new TypeError('The generated listening version is unsupported.');
    if (!Object.hasOwn(GENERATED_MODES, mode)) throw new TypeError('Choose a generated listening mode.');
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new TypeError('A uint32 seed is required.');
    if (!['practice', 'evaluation'].includes(sessionType)) throw new TypeError('Choose practice or evaluation.');
    if (!Array.isArray(focusIds) || focusIds.length > 6 || new Set(focusIds).size !== focusIds.length
        || Array.from(focusIds).some(id => !GENERATED_FOCUS_IDS.includes(id))) throw new TypeError('Choose at most six distinct supported sound families.');
    if (sessionType === 'evaluation' && focusIds.length) throw new TypeError('Evaluation uses fixed coverage, without adaptive focus.');
    const focus = focusIds.slice();
    const random = mulberry32(seed);
    const partition = PARTITIONS[sessionType];
    const families = selectedFamilies(sessionType, focus, random);
    const trials = mode === 'balanced' ? balancedTrials(families, random)
        : mode === 'blending' ? blendingTrials(sessionType, partition, focus, random, version)
            : mode === 'generated' ? generatedTrials(partition, random)
                : storyletTrials(sessionType, partition, families, focus, random);
    const manifest = { version, generator: 'mulberry32-fisher-yates-storygraph-v1',
        mode, seed, sessionType, focusIds: focus, selectedFamilyIds: mode === 'balanced' ? families
            : mode === 'storylets' ? trials.filter(item => item.focus).map(item => item.focus.id) : [],
        partition: `${sessionType}-slots-v1`, trials };
    return deepFreezeJson({ version, mode, seed, sessionType, focusIds: focus, manifest, trials });
}
