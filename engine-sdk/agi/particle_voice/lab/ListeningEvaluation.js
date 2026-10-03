// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Original evaluation material, not a training set or evidence of intelligibility.
 * Keep held-out sentences out of pronunciation overrides and acoustic calibration.
 * Blinding hides target text in the UI, not from a developer inspecting this source.
 */
import { LETTER_NAMES } from '../frontend/PronunciationLexicon.js';
import { expandCardinal, MAX_CARDINAL } from '../frontend/TextNormalizer.js';
import { PRACTICE_CORPUS_VERSION, PRACTICE_WORDS, PRACTICE_CONTRASTS, PRACTICE_SENTENCES } from './ListeningPracticeCorpus.js';
import { GENERATED_LISTENING_VERSION, GENERATED_LISTENING_VERSIONS, GENERATED_MODES, GENERATED_FAMILIES, generateListeningLesson } from './GeneratedListeningCorpus.js';
import { ListeningFeedbackHistory, validateListeningFeedbackPatch } from './ListeningFeedback.js';

export const LISTENING_CORPUS_VERSION = 'particle-voice-listening-v1';
export const ALPHABET_LESSON_VERSION = 'particle-voice-alphabet-lesson-v1';
export const LEGACY_LISTENING_SCORING_VERSION = 'particle-voice-word-scoring-v1';
export const LISTENING_SCORING_VERSION = 'particle-voice-word-scoring-v2';
// This describes the existing order generator; changing it requires a new ID.
export const LISTENING_RANDOMIZATION_VERSION = 'lcg1664525-1013904223-u32-fisher-yates-v1';
export const UNCLEAR_LETTER_ANSWER = '__unclear__';
const LETTER_CONFUSION_GROUPS = Object.freeze([
    'BCDEGPTVZ', 'AHJK', 'FLMNSX', 'IORY', 'QUW',
]);
export const MINIMAL_PAIRS = Object.freeze([
    ['ship', 'SH IH2 P', 'sheep', 'SH IY2 P'],
    ['bit', 'B IH2 T', 'beat', 'B IY2 T'],
    ['bed', 'B EH2 D', 'bad', 'B AE2 D'],
    ['full', 'F UH2 L', 'fool', 'F UW2 L'],
    ['cot', 'K AA2 T', 'cut', 'K AH2 T'],
    ['cap', 'K AE2 P', 'cab', 'K AE2 B'],
    ['back', 'B AE2 K', 'bag', 'B AE2 G'],
    ['coat', 'K OW2 T', 'goat', 'G OW2 T'],
    ['fan', 'F AE2 N', 'van', 'V AE2 N'],
    ['sip', 'S IH2 P', 'zip', 'Z IH2 P'],
    ['thin', 'TH IH2 N', 'sin', 'S IH2 N'],
    ['then', 'DH EH2 N', 'den', 'D EH2 N'],
    ['chin', 'CH IH2 N', 'shin', 'SH IH2 N'],
    ['rice', 'R AY2 S', 'lice', 'L AY2 S'],
    ['light', 'L AY2 T', 'night', 'N AY2 T'],
    ['sum', 'S AH2 M', 'sun', 'S AH2 N'],
    ['sing', 'S IH2 NG', 'sin', 'S IH2 N'],
    ['west', 'W EH2 S T', 'vest', 'V EH2 S T'],
    ['buy', 'B AY2', 'boy', 'B OY2'],
    ['bow', 'B OW2', 'bough', 'B AW2'],
].map((row, index) => Object.freeze({
    id: `pair-${String(index + 1).padStart(2, '0')}`,
    choices: Object.freeze([row[0], row[2]]), phonemes: Object.freeze([row[1], row[3]]),
})));

export const HELD_OUT_SENTENCES = Object.freeze([
    'A small bird rests beside the window.',
    'Please move the blue chair near the desk.',
    'The glass cup fell onto a soft rug.',
    'We found seven shells along the shore.',
    'Her green coat hangs behind the door.',
    'The train leaves after the morning rain.',
    'Put the clean spoon beside my plate.',
    'A quiet dog waits under the table.',
    'Three bright stars appear above the hill.',
    'He packed fresh bread for the journey.',
    'The black cat sleeps on a warm blanket.',
    'Turn the small handle toward the wall.',
    'My sister drew a boat with red sails.',
    'The old clock rings twice before noon.',
    'They carried a heavy box across the yard.',
    'A sharp wind shook the empty branches.',
    'Keep your shoes away from the wet paint.',
    'Our garden has yellow flowers and mint.',
    'The silver key fits the wooden gate.',
    'She left a short note beside the lamp.',
    'Bring four cups and a clean towel.',
    'The shop sells warm soup every evening.',
    'A tiny mouse hid beneath the stairs.',
    'We watched the river flow past the bridge.',
    'His new bicycle has a bright bell.',
    'The farmer closed the barn before sunset.',
    'Please keep the last slice for tomorrow.',
    'Clouds drift slowly over the distant mountains.',
    'The child counted five stones in her hand.',
    'A fresh apple rolled behind the basket.',
    'Their friends arrived early for the concert.',
    'Open the lower drawer and find a pencil.',
    'The brown horse crossed a narrow stream.',
    'We need more light above the kitchen sink.',
    'Two ducks followed the path to the pond.',
    'The soft pillow slipped off the couch.',
    'Leave the white envelope on the shelf.',
    'A distant horn sounded through the fog.',
    'The little boat turned toward the harbor.',
    'My brother washed the dishes after dinner.',
    'The round mirror reflects the front porch.',
    'She tied a ribbon around the gift.',
    'We heard gentle music from the next room.',
    'The warm sand felt smooth beneath our feet.',
    'Place the empty bottle beside the green bin.',
    'A sudden noise startled the sleeping rabbit.',
    'The baker set a fresh pie on the counter.',
    'They planted a young tree beside the fence.',
    'Please pass the bowl without spilling the rice.',
    'The last bus stopped near the stone fountain.',
].map((text, index) => Object.freeze({ id: `heldout-${String(index + 1).padStart(2, '0')}`, text })));

export function listeningWords(text) {
    return String(text).normalize('NFKC').toLowerCase().replace(/[’‘]/g, "'").match(/[a-z]+(?:'[a-z]+)*/g) ?? [];
}

function requireScoringVersion(version) {
    if (![LEGACY_LISTENING_SCORING_VERSION, LISTENING_SCORING_VERSION].includes(version)) {
        throw new TypeError('The listening scoring version is unsupported.');
    }
    return version;
}

/** Reports predating scoring metadata retain their original digit-dropping arithmetic. */
export function listeningScoringVersion(report) {
    if (!report || typeof report !== 'object' || Array.isArray(report)) throw new TypeError('Use a listening report.');
    const version = requireScoringVersion(report.scoringVersion === undefined ? LEGACY_LISTENING_SCORING_VERSION : report.scoringVersion);
    const repeat = report.practiceRepeat;
    if (repeat && (repeat.baselineScoringVersion !== undefined || repeat.scoringPolicy !== undefined)
        && (repeat.baselineScoringVersion !== version || repeat.scoringPolicy !== 'inherit-baseline')) {
        throw new TypeError('A fixed retest must preserve its baseline scoring version.');
    }
    return version;
}

function transcriptionWords(text, scoringVersion) {
    if (scoringVersion === LEGACY_LISTENING_SCORING_VERSION) return listeningWords(text);
    const chunks = String(text).normalize('NFKC').toLowerCase().replace(/[’‘]/g, "'").split(/\s+/);
    return chunks.flatMap((chunk, index) => {
        if (!/\p{N}/u.test(chunk)) return listeningWords(chunk);
        // Only standalone unsigned cardinals are equivalent to their spoken words.
        // Keep dates, signs, decimals, ordinals, identifiers and out-of-range values
        // as literal error tokens; never drop their digits or guess their meaning.
        const digits = chunk.replace(/^["'([{]+/, '').replace(/["')\]},.!?;]+$/, '');
        const operator = /^[+\-−/%$£€=<>#@*^°:]+$/;
        if (/^(?:0|[1-9]\d{0,14})$/.test(digits) && Number(digits) < MAX_CARDINAL
            && !operator.test(chunks[index - 1] ?? '') && !operator.test(chunks[index + 1] ?? '')) {
            return expandCardinal(Number(digits));
        }
        return [chunk];
    });
}

/** Word edit distance. Insertions count as errors, so verbosity cannot inflate recognition. */
export function scoreTranscription(expected, heard, { targetIndex = null, scoringVersion = LISTENING_SCORING_VERSION } = {}) {
    requireScoringVersion(scoringVersion);
    const reference = transcriptionWords(expected, scoringVersion);
    const response = transcriptionWords(heard, scoringVersion);
    if (!reference.length) throw new TypeError('A listening target must contain words.');
    if (targetIndex !== null && (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= reference.length)) {
        throw new RangeError('A target index must identify a reference word.');
    }
    let previous = Array.from({ length: response.length + 1 }, (_, i) => i);
    const rows = targetIndex === null ? null : [previous];
    for (let i = 1; i <= reference.length; i++) {
        const current = [i];
        for (let j = 1; j <= response.length; j++) {
            current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + Number(reference[i - 1] !== response[j - 1]));
        }
        previous = current;
        if (rows) rows.push(current);
    }
    let targetRecognition = null;
    if (rows) {
        let i = reference.length, j = response.length;
        while (i > 0 || j > 0) {
            // Prefer a diagonal on equal-cost alignments, then deletion, then
            // insertion. This matches words at their reference position; merely
            // mentioning the target elsewhere cannot bypass transcription errors.
            const diagonal = i > 0 && j > 0
                && rows[i][j] === rows[i - 1][j - 1] + Number(reference[i - 1] !== response[j - 1]);
            if (diagonal) {
                if (i - 1 === targetIndex) targetRecognition = Object.freeze({ targetIndex,
                    referenceWord: reference[i - 1], heardWord: response[j - 1], correct: reference[i - 1] === response[j - 1] });
                i--; j--;
            } else if (i > 0 && rows[i][j] === rows[i - 1][j] + 1) {
                if (i - 1 === targetIndex) targetRecognition = Object.freeze({ targetIndex,
                    referenceWord: reference[i - 1], heardWord: null, correct: false });
                i--;
            } else j--;
        }
    }
    return Object.freeze({ referenceWords: reference.length, errors: previous[response.length],
        recognition: Math.max(0, 1 - previous[response.length] / reference.length),
        ...(rows ? { targetRecognition } : {}) });
}

function seededRandom(seed) {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

function shuffled(items, random) {
    const result = items.slice();
    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
}

/** In-memory only. An explicit export contains listener responses; nothing uploads or persists. */
export class ListeningEvaluation {
    #trials;
    #results = [];
    #played = false;
    #playbacks = [];
    #repeat = null;
    #baseline = new Map();
    #generated = null;
    #sessionType = 'practice';
    #scoringVersion;
    #initial = null;
    #feedback = new ListeningFeedbackHistory();
    constructor({ seed, listener, pairMode = 'text', mode = 'blind', sessionType = 'practice', focusIds = [],
        scoringVersion = LISTENING_SCORING_VERSION, generatedVersion = GENERATED_LISTENING_VERSION } = {}) {
        this.#scoringVersion = requireScoringVersion(scoringVersion);
        if (!GENERATED_LISTENING_VERSIONS.includes(generatedVersion)) throw new TypeError('The generated listening version is unsupported.');
        if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new TypeError('A uint32 seed is required.');
        if (typeof listener !== 'string' || !listener.trim() || listener.length > 80) throw new TypeError('Enter a listener label (maximum 80 characters).');
        if (!['text', 'explicit'].includes(pairMode)) throw new TypeError('Pair mode must be text or explicit.');
        const generated = Object.hasOwn(GENERATED_MODES, mode);
        if (!generated && !['blind', 'alphabet', 'words', 'contrasts', 'sentences'].includes(mode)) throw new TypeError('Choose a supported listening mode.');
        if (!['practice', 'evaluation'].includes(sessionType)) throw new TypeError('Choose practice or evaluation.');
        if (generated && mode !== 'balanced' && pairMode !== 'text') throw new TypeError('Connected generated lessons use the text renderer.');
        if (!generated && (sessionType !== 'practice' || !Array.isArray(focusIds) || focusIds.length)) {
            throw new TypeError('Session partitions and adaptive focuses require a generated lesson.');
        }
        this.seed = seed;
        this.listener = listener.trim();
        this.pairMode = pairMode;
        this.mode = mode;
        this.#sessionType = sessionType;
        if (generated) {
            this.#generated = generateListeningLesson({ mode, seed, sessionType, focusIds, version: generatedVersion });
            this.#trials = this.#generated.trials.slice();
            for (const key of ['seed', 'listener', 'pairMode', 'mode']) Object.defineProperty(this, key, { writable: false, configurable: false });
            return;
        }
        const random = seededRandom(seed);
        const letters = Object.keys(LETTER_NAMES).map((letter) => letter.toUpperCase());
        this.#trials = mode === 'alphabet' ? shuffled(letters.map((letter) => {
            const family = LETTER_CONFUSION_GROUPS.find((group) => group.includes(letter));
            const candidates = [...shuffled([...family].filter((item) => item !== letter), random),
                ...shuffled(letters.filter((item) => !family.includes(item)), random)];
            return { id: `letter-${letter}`, kind: 'letter', text: letter, phonemes: LETTER_NAMES[letter.toLowerCase()],
                choices: shuffled([letter, ...candidates.slice(0, 3)], random) };
        }), random) : mode === 'blind' ? shuffled([
            ...MINIMAL_PAIRS.map((pair) => {
                const target = Math.floor(random() * 2);
                return { id: pair.id, kind: 'pair', text: pair.choices[target], phonemes: pair.phonemes[target], choices: shuffled(pair.choices, random) };
            }),
            ...HELD_OUT_SENTENCES.map((sentence) => ({ ...sentence, kind: 'sentence' })),
        ], random) : shuffled(mode === 'words'
            ? PRACTICE_WORDS.map((word) => ({ ...word, kind: 'word', choices: shuffled(word.choices, random) }))
            : mode === 'contrasts' ? PRACTICE_CONTRASTS.map((pair) => {
                const target = Math.floor(random() * 2);
                return { id: pair.id, kind: 'contrast', text: pair.choices[target], phonemes: pair.phonemes[target],
                    focus: pair.focus, choices: shuffled(pair.choices, random) };
            }) : PRACTICE_SENTENCES.map((sentence) => ({ ...sentence, kind: 'sentence' })), random);
    }

    get sessionType() { return this.#sessionType; }
    get scoringVersion() { return this.#scoringVersion; }
    get hasInitialAnswer() { return this.#initial !== null; }

    /** Rendering/provenance access only; never copy the target manifest into an active listening UI. */
    get generatedLesson() {
        if (!this.#generated) return null;
        const { version, mode, seed, sessionType, focusIds, manifest } = this.#generated;
        return Object.freeze({ version, mode, seed, sessionType, focusIds, manifest });
    }

    /** Reuse authored targets, never imported audio/phones or held-out material.
     * Repeated exposure can change recognition: https://pmc.ncbi.nlm.nih.gov/articles/PMC4987026/
     * Imported responses are a comparison baseline, not verified listening evidence.
     */
    static repeatPractice(report, { listener, selection = 'answered' } = {}) {
        const mode = typeof report?.mode === 'string' ? report.mode.replace(/^classroom-/, '') : '';
        if (Object.hasOwn(GENERATED_MODES, mode)) return ListeningEvaluation.#repeatGenerated(report, { listener, selection });
        if (!['alphabet', 'words', 'contrasts', 'sentences'].includes(mode)
            || report.mode !== `classroom-${mode}` || report.ended !== true
            || report.randomizationVersion !== LISTENING_RANDOMIZATION_VERSION
            || !Array.isArray(report.results) || report.results.length !== report.total
            || !['answered', 'missed'].includes(selection)) throw new TypeError('Use an ended classroom practice report with the current corpus and shuffle version.');
        const expectedPath = mode === 'alphabet' ? ['authored-letter-names'] : mode === 'sentences'
            ? ['text-plan'] : ['text-plan', 'explicit-phonemes'];
        if (!expectedPath.includes(report.renderPath)) throw new TypeError('The practice report has an unsupported render path.');
        const lesson = new ListeningEvaluation({ mode, seed: report.seed, listener,
            scoringVersion: listeningScoringVersion(report),
            pairMode: report.renderPath === 'explicit-phonemes' ? 'explicit' : 'text' });
        if (report.corpusVersion !== (mode === 'alphabet' ? ALPHABET_LESSON_VERSION : PRACTICE_CORPUS_VERSION)
            || report.results.length > lesson.#trials.length) throw new TypeError('The practice report does not match the current corpus.');
        const authored = new Map(lesson.#trials.map((trial) => [trial.id, trial]));
        const selected = [];
        const seen = new Set();
        for (const result of report.results) {
            const trial = authored.get(result?.id);
            if (!trial || seen.has(result.id) || result.target !== trial.text || result.kind !== trial.kind
                || JSON.stringify(result.choices) !== JSON.stringify(trial.choices ?? null)
                || typeof result.skipped !== 'boolean') throw new TypeError('A report target or its choices differ from the authored seeded exercise.');
            seen.add(result.id);
            if (result.skipped) continue;
            if (typeof result.unclear !== 'boolean' || (result.unclear ? result.answer !== null
                : typeof result.answer !== 'string' || result.answer.length > 2000
                    || (trial.choices && !trial.choices.includes(result.answer)))) throw new TypeError('A report answer is invalid.');
            const score = scoreTranscription(trial.text, result.unclear ? '' : result.answer, { scoringVersion: lesson.scoringVersion });
            if (result.correct !== (score.errors === 0) || result.heard !== true) throw new TypeError('A report answer does not match its recorded outcome.');
            for (const key of ['referenceWords', 'errors', 'recognition']) {
                if (key in result && result[key] !== score[key]) throw new TypeError('A report score differs from its original scoring version.');
            }
            if (selection === 'missed' && result.correct) continue;
            selected.push(trial);
            lesson.#baseline.set(trial.id, Object.freeze({ answer: result.answer, correct: result.correct,
                digest: ListeningEvaluation.#singleAudioDigest(result) }));
        }
        if (!selected.length) throw new TypeError(selection === 'missed' ? 'This report has no missed answers to practice.' : 'This report has no answered targets to repeat.');
        lesson.#trials = selected;
        lesson.#repeat = Object.freeze({ schemaVersion: 1, selection, targetPolicy: 'same-target-order-choices-and-render-path',
            baselineScoringVersion: lesson.scoringVersion, scoringPolicy: 'inherit-baseline',
            baselineSeed: report.seed, baselineAnswered: selected.length,
            baselineCorrect: selected.filter((trial) => lesson.#baseline.get(trial.id).correct).length,
            baselineSourceRevision: typeof report.source?.synthesisRevision === 'string' ? report.source.synthesisRevision.slice(0, 160) : null,
            baselineConfigurationAtEnd: ListeningEvaluation.#numericSnapshot(report.configurationAtEnd),
            baselineTuningAtEnd: ListeningEvaluation.#numericSnapshot(report.tuningAtEnd),
            baselineEvidence: 'imported-responses-not-independently-verified' });
        return lesson;
    }

    static #boundedJson(value) {
        let nodes = 0;
        const visit = (item, depth) => {
            if (++nodes > 40000 || depth > 12) throw new TypeError('The generated manifest exceeds supported bounds.');
            if (item === null || typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item)) return;
            if (typeof item === 'string' && item.length <= 4000) return;
            if (Array.isArray(item)) {
                if (item.length > 256) throw new TypeError('The generated manifest exceeds supported bounds.');
                for (const child of item) visit(child, depth + 1);
                return;
            }
            if (item && typeof item === 'object' && Object.getPrototypeOf(item) === Object.prototype) {
                const entries = Object.entries(item);
                if (entries.length > 40) throw new TypeError('The generated manifest exceeds supported bounds.');
                for (const [key, child] of entries) {
                    if (key.length > 80) throw new TypeError('The generated manifest has an unsupported field.');
                    visit(child, depth + 1);
                }
                return;
            }
            throw new TypeError('The generated manifest contains unsupported values.');
        };
        visit(value, 0);
        return JSON.stringify(value);
    }

    static #responseScore(trial, answer, clarity = null, scoringVersion = LISTENING_SCORING_VERSION) {
        if (typeof answer !== 'string' || answer.length > 2000) throw new TypeError('Answers must be text of at most 2000 characters.');
        if (clarity !== null && (!Number.isInteger(clarity) || clarity < 1 || clarity > 5)) throw new RangeError('Clarity must be 1 to 5, or left unrated.');
        if (trial.choices && answer !== UNCLEAR_LETTER_ANSWER && !trial.choices.includes(answer)) {
            throw new TypeError('Choose one of the displayed answers or I couldn’t tell.');
        }
        const unclear = answer === UNCLEAR_LETTER_ANSWER;
        const score = scoreTranscription(trial.text, unclear ? '' : answer,
            { targetIndex: Number.isInteger(trial.targetIndex) ? trial.targetIndex : null, scoringVersion });
        return Object.freeze({ answer: unclear ? null : answer, unclear, clarity, ...score, correct: score.errors === 0 });
    }

    static #validatedGeneratedReport(report, listener = 'Imported practice') {
        const meta = report?.generatedLesson;
        if (!meta || report.ended !== true || !GENERATED_LISTENING_VERSIONS.includes(report.corpusVersion)
            || report.corpusVersion !== meta.version
            || report.randomizationVersion !== meta.manifest?.generator
            || !(['text-plan', ...(meta.mode === 'balanced' ? ['explicit-phonemes'] : [])].includes(report.renderPath))
            || !['practice', 'evaluation'].includes(report.sessionType) || !Array.isArray(report.results)
            || report.results.length > 256 || report.results.length !== report.total || report.remaining !== 0
            || meta.seed !== report.seed
            || report.mode !== `classroom-${meta.mode}`) throw new TypeError('Use an ended generated report with the current generator.');
        const lesson = new ListeningEvaluation({ mode: meta.mode, seed: meta.seed, listener,
            scoringVersion: listeningScoringVersion(report),
            generatedVersion: meta.version,
            pairMode: report.renderPath === 'explicit-phonemes' ? 'explicit' : 'text',
            sessionType: meta.sessionType, focusIds: meta.focusIds });
        if (!lesson.#generated || ListeningEvaluation.#boundedJson(meta) !== ListeningEvaluation.#boundedJson(lesson.generatedLesson)) {
            throw new TypeError('The generated manifest differs from its canonical seed and partition.');
        }
        const repeat = report.practiceRepeat;
        if (repeat ? repeat.kind !== 'fixed-retest' || report.sessionType !== 'practice'
                || repeat.baselineSeed !== meta.seed || repeat.schemaVersion !== 2
            : report.sessionType !== meta.sessionType || report.total !== lesson.#trials.length) {
            throw new TypeError('The report session partition or fixed retest is inconsistent.');
        }
        const trials = new Map(lesson.#trials.map((trial, index) => [trial.id, { trial, index }]));
        let previousIndex = -1;
        for (const result of report.results) {
            const entry = trials.get(result?.id), trial = entry?.trial;
            if (!trial || entry.index <= previousIndex || result.target !== trial.text || result.kind !== trial.kind
                || ListeningEvaluation.#boundedJson(result.choices) !== ListeningEvaluation.#boundedJson(trial.choices ?? null)
                || result.context !== trial.context || ListeningEvaluation.#boundedJson(result.focusIds) !== ListeningEvaluation.#boundedJson(trial.focusIds)
                || ListeningEvaluation.#boundedJson(result.focus ?? null) !== ListeningEvaluation.#boundedJson(trial.focus ?? null)
                || typeof result.heard !== 'boolean' || typeof result.skipped !== 'boolean' || !Array.isArray(result.playbacks) || result.playbacks.length > 20) {
                throw new TypeError('A generated target, order, context or choices differ from the authored exercise.');
            }
            previousIndex = entry.index;
            const plays = result.playbacks;
            if (plays.some((play, i) => !play || play.attempt !== i + 1 || !['drained', 'cancelled', 'failed'].includes(play.status))
                || result.playbackAttempts !== plays.length || result.completedPlaybacks !== plays.filter(play => play.status === 'drained').length
                || result.replayCount !== Math.max(0, plays.length - 1)) throw new TypeError('Playback counts are inconsistent.');
            if (report.sessionType === 'evaluation' && result.completedPlaybacks > 1
                || result.completedPlaybacks > 1 && !result.firstResponse) throw new TypeError('Playback violates the locked first-response policy.');
            const validateResponse = (response) => {
                if (!response || typeof response.unclear !== 'boolean' || response.unclear && response.answer !== null) throw new TypeError('A response is invalid.');
                const score = ListeningEvaluation.#responseScore(trial, response.unclear ? UNCLEAR_LETTER_ANSWER : response.answer,
                    response.clarity, lesson.scoringVersion);
                for (const key of ['correct', 'referenceWords', 'errors', 'recognition']) {
                    if (response[key] !== score[key]) throw new TypeError('A response score is inconsistent with its answer.');
                }
                if (ListeningEvaluation.#boundedJson(response.targetRecognition ?? null)
                    !== ListeningEvaluation.#boundedJson(score.targetRecognition ?? null)) throw new TypeError('Target alignment is inconsistent.');
            };
            const first = result.firstResponse;
            if (first !== null) {
                validateResponse(first);
                if (!Number.isInteger(first.playbackAttempts) || first.playbackAttempts < 1 || first.playbackAttempts > plays.length
                    || first.completedPlaybacks !== 1 || plays[first.playbackAttempts - 1].status !== 'drained'
                    || plays.slice(0, first.playbackAttempts).filter(play => play.status === 'drained').length !== 1
                    || first.eligible !== (first.playbackAttempts === 1)
                    || plays.slice(0, first.playbackAttempts - 1).some(play => play.status === 'drained')) throw new TypeError('First-response playback history is inconsistent.');
            }
            if (result.skipped) {
                if (result.answer !== null || result.correct !== null) throw new TypeError('Skipped trials cannot have final scores.');
            } else {
                validateResponse(result);
                if (!first || result.heard !== true || plays.at(-1)?.status !== 'drained') throw new TypeError('A final response needs its locked first hearing.');
                if (report.sessionType === 'evaluation' && (result.completedPlaybacks !== 1
                    || result.answer !== first.answer || result.unclear !== first.unclear || result.clarity !== first.clarity)) {
                    throw new TypeError('An evaluation cannot replay or replace its first response.');
                }
            }
            if (trial.comprehension) {
                if (result.skipped ? result.comprehension !== null : !result.comprehension) throw new TypeError('Story trials must preserve their comprehension response state.');
                const answer = result.comprehension?.answer ?? null;
                if (answer !== null && !trial.comprehension.choices.includes(answer)) throw new TypeError('A story response is not an authored choice.');
                if (answer !== null && !first) throw new TypeError('Story comprehension cannot precede the first transcript.');
                const unclear = result.comprehension?.unclear ?? false;
                if (typeof unclear !== 'boolean' || unclear && (answer !== null || !first)) throw new TypeError('An unclear story response needs a first transcript.');
                if (result.comprehension && (result.comprehension.question !== trial.comprehension.question
                    || ListeningEvaluation.#boundedJson(result.comprehension.choices) !== ListeningEvaluation.#boundedJson(trial.comprehension.choices)
                    || result.comprehension.correctAnswer !== trial.comprehension.answer
                    || result.comprehension.correct !== (unclear ? false : answer === null ? null : answer === trial.comprehension.answer))) throw new TypeError('A comprehension score is inconsistent.');
            } else if (result.comprehension != null) throw new TypeError('This exercise has no comprehension question.');
        }
        const answered = report.results.filter(result => !result.skipped);
        if (report.answered !== answered.length || report.skipped !== report.total - answered.length
            || report.correct !== answered.filter(result => result.correct).length
            || report.status !== (answered.length === report.total ? 'complete' : 'incomplete')) throw new TypeError('The report totals are inconsistent.');
        return lesson;
    }

    static #repeatGenerated(report, { listener, selection }) {
        if (!['answered', 'missed'].includes(selection)) throw new TypeError('Choose answered or missed targets.');
        const lesson = ListeningEvaluation.#validatedGeneratedReport(report, listener);
        const authored = new Map(lesson.#trials.map(trial => [trial.id, trial]));
        const selected = report.results.filter(result => !result.skipped && (selection === 'answered' || !result.correct));
        if (!selected.length) throw new TypeError('This report has no matching answered targets to repeat.');
        lesson.#trials = selected.map(result => authored.get(result.id));
        for (const result of selected) {
            const first = result.firstResponse;
            lesson.#baseline.set(result.id, Object.freeze({ answer: result.answer, correct: result.correct, errors: result.errors,
                firstResponse: Object.freeze({ answer: first.answer, unclear: first.unclear, correct: first.correct,
                    errors: first.errors, recognition: first.recognition, clarity: first.clarity, eligible: first.eligible }),
                digest: ListeningEvaluation.#singleAudioDigest(result) }));
        }
        lesson.#sessionType = 'practice';
        lesson.#repeat = Object.freeze({ schemaVersion: 2, kind: 'fixed-retest', selection,
            baselineScoringVersion: lesson.scoringVersion, scoringPolicy: 'inherit-baseline',
            targetPolicy: 'same-target-order-choices-and-render-path', baselineSeed: report.seed,
            baselineAnswered: selected.length, baselineCorrect: selected.filter(result => result.correct).length,
            originalPartition: lesson.#generated.sessionType,
            baselineSourceRevision: typeof report.source?.synthesisRevision === 'string' ? report.source.synthesisRevision.slice(0, 160) : null,
            baselineConfigurationAtEnd: ListeningEvaluation.#numericSnapshot(report.configurationAtEnd),
            baselineTuningAtEnd: ListeningEvaluation.#numericSnapshot(report.tuningAtEnd),
            baselineEvidence: 'imported-responses-not-independently-verified' });
        return lesson;
    }

    /** Suggestions only; the caller must explicitly start a new practice block. */
    static suggestedFocusIds(report) {
        if (!Array.isArray(report?.results) || report.results.length > 256) throw new TypeError('Use a bounded ended listening report.');
        const mode = typeof report.mode === 'string' ? report.mode.replace(/^classroom-/, '') : '';
        const generated = Object.hasOwn(GENERATED_MODES, mode);
        const canonical = generated ? ListeningEvaluation.#validatedGeneratedReport(report)
            : ListeningEvaluation.repeatPractice(report, { listener: 'Imported focus suggestions', selection: 'answered' });
        const authored = new Map(canonical.#trials.map(trial => [trial.id, trial]));
        const focuses = new Map();
        for (const result of report.results) {
            const finalMiss = !(result.targetRecognition ? result.targetRecognition.correct : result.correct);
            const initial = generated && result.firstResponse?.eligible ? result.firstResponse : null;
            const firstMiss = initial && !(initial.targetRecognition ? initial.targetRecognition.correct : initial.correct);
            if (result.skipped || !finalMiss && !firstMiss) continue;
            const trial = authored.get(result.id);
            if (!trial) continue;
            // Older blending manifests retain their historical labels for exact
            // replay, but neither moon nor shoe establishes an M/N or SH/S error.
            if (mode === 'blending' && ['moon', 'shoe'].includes(trial.targetWord)) continue;
            const ids = generated ? trial.focusIds
                : GENERATED_FAMILIES.filter(family => family.legacyTargets.includes(result.target)).map(family => family.id);
            for (const id of new Set(ids)) focuses.set(id, (focuses.get(id) ?? 0) + 1);
        }
        // Stable family order breaks equal-count ties; a first and final miss
        // on the same trial remains one observation, never two votes.
        return Object.freeze(GENERATED_FAMILIES.map(family => family.id).filter(id => focuses.has(id))
            .sort((a, b) => focuses.get(b) - focuses.get(a)).slice(0, 6));
    }

    // Keep bounded numeric settings, never arbitrary imported text, phones or objects.
    static #numericSnapshot(value, depth = 0) {
        if (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return value;
        if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 5) return null;
        return Object.freeze(Object.fromEntries(Object.entries(value).slice(0, 80)
            .filter(([key]) => /^[a-zA-Z0-9]{1,64}$/.test(key))
            .map(([key, item]) => [key, ListeningEvaluation.#numericSnapshot(item, depth + 1)])));
    }

    static #singleAudioDigest(result) {
        const plays = Array.isArray(result.playbacks) ? result.playbacks.filter((play) => play?.status === 'drained') : [];
        const digests = plays.map((play) => play.evidence?.audio?.digest);
        return digests.length && digests.every((digest) => typeof digest === 'string' && /^sha256:[a-f0-9]{64}$/.test(digest)
            && digest === digests[0]) ? digests[0] : null;
    }

    #repeatReport() {
        if (!this.#repeat) return {};
        const answered = this.#results.filter((result) => !result.skipped);
        const outcomes = answered.map((result) => {
            const baseline = this.#baseline.get(result.id);
            const digest = ListeningEvaluation.#singleAudioDigest(result);
            return Object.freeze({ id: result.id, target: result.target, previousAnswer: baseline.answer,
                previousCorrect: baseline.correct, answer: result.answer, correct: result.correct,
                ...(this.#generated ? { previousErrors: baseline.errors, errors: result.errors,
                    previousFirstResponse: baseline.firstResponse, firstResponse: result.firstResponse } : {}),
                samePcm: baseline.digest && digest ? baseline.digest === digest : null,
                audioIdentity: baseline.digest && digest ? baseline.digest === digest ? 'same' : 'different' : 'unavailable' });
        });
        return { practiceRepeat: this.#repeat, matchedComparison: Object.freeze({ answered: answered.length,
            baselineScoringVersion: this.#repeat.baselineScoringVersion, scoringVersion: this.scoringVersion,
            sameScoring: this.#repeat.baselineScoringVersion === this.scoringVersion,
            previousCorrect: outcomes.filter((item) => item.previousCorrect).length,
            correct: outcomes.filter((item) => item.correct).length,
            outcomes: Object.freeze(outcomes),
            caveat: 'Matched practice responses only. Repeated exposure and feedback can change recognition; this is not proof of an acoustic repair or a held-out acceptance result.' }) };
    }

    current() {
        const trial = this.#trials[this.#results.length];
        return trial ? Object.freeze({
            // Practice IDs and sound-focus metadata can reveal the target.
            id: this.mode !== 'blind' ? `lesson-trial-${this.#results.length + 1}` : trial.id,
            index: this.#results.length + 1, total: this.#trials.length, kind: trial.kind,
            choices: trial.choices && (this.mode === 'blind' || this.#played) ? Object.freeze(trial.choices.slice()) : null,
            played: this.#played, playbackAttempts: this.#playbacks.length,
            completedPlaybacks: this.#playbacks.filter((attempt) => attempt.status === 'drained').length,
            ...(this.#generated ? { initialRecorded: this.#initial !== null, sessionType: this.#sessionType,
                comprehension: this.#initial && trial.comprehension ? Object.freeze({ question: trial.comprehension.question,
                    choices: Object.freeze(trial.comprehension.choices.slice()) }) : null } : {}),
        }) : null;
    }

    /** Private-review export only: keep this schedule out of the active listening UI. */
    recordingPlan() {
        return Object.freeze(this.#trials.map((trial, index) => Object.freeze({
            index: index + 1, id: trial.id,
            playbackTrialId: this.mode === 'blind' ? trial.id : `lesson-trial-${index + 1}`,
            kind: trial.kind, target: trial.text, phonemes: trial.phonemes ?? null,
            choices: trial.choices ? Object.freeze(trial.choices.slice()) : null,
        })));
    }

    /** Local archive only. Evaluation feedback remains withheld by report(). */
    recordingProgress() {
        return structuredClone({ results: this.#results, currentTrial: this.current(),
            firstResponse: this.#initial, playback: this.#playbackReport(),
            ...(this.#feedback.size ? { feedback: this.#feedback.report() } : {}) });
    }

    /** Optional subjective evidence, separate from correctness and legacy clarity.
     * Context is derived here; a UI cannot backdate confidence or invent hearing.
     */
    recordFeedback(patch, { trialIndex = this.#results.length + 1 } = {}) {
        const validated = validateListeningFeedbackPatch(patch), activeIndex = this.#results.length + 1;
        if (!Number.isInteger(trialIndex) || trialIndex < 1 || trialIndex > this.#trials.length
            || trialIndex !== activeIndex && trialIndex !== activeIndex - 1) throw new RangeError('Feedback can address only the current or immediately previous submitted trial');
        const previous = trialIndex === activeIndex - 1, result = previous ? this.#results[trialIndex - 1] : null;
        if (previous && (!result || result.skipped)) throw new Error('Previous-trial feedback requires a submitted answer');
        const playbacks = previous ? result.playbacks : this.#playbacks, latest = playbacks.at(-1);
        if (!latest || latest.status === 'pending') throw new Error('Finish or stop a playback before adding listening feedback');
        const firstLocked = previous || this.#initial !== null;
        if (this.#generated && this.#sessionType === 'evaluation' && firstLocked) throw new Error('Evaluation feedback is locked with its first response');
        if (Object.hasOwn(validated, 'confidence') && firstLocked) throw new Error('Confidence must be recorded before the first response and answer reveal');
        if (['confidence', 'clarity', 'smoothness', 'naturalness'].some(key => Object.hasOwn(validated, key)) && latest.status !== 'drained') {
            throw new Error('Confidence and quality ratings require a completed playback; audio and question problem flags remain available');
        }
        const trial = this.#trials[trialIndex - 1], digest = latest.status === 'drained' ? latest.evidence?.audio?.digest : null;
        return this.#feedback.record(validated, { trialIndex, trialId: trial.id,
            playbackTrialId: this.mode === 'blind' ? trial.id : `lesson-trial-${trialIndex}`,
            playbackAttempts: playbacks.length, completedPlaybacks: playbacks.filter(play => play.status === 'drained').length,
            afterReplay: playbacks.length > 1, playbackStatus: latest.status,
            audioDigest: typeof digest === 'string' && /^sha256:[a-f0-9]{64}$/.test(digest) ? digest : null,
            responseStage: previous ? 'after-submit' : firstLocked ? 'first-response-locked' : 'before-response',
            feedbackRevealed: previous && !(this.#generated && this.#sessionType === 'evaluation') });
    }

    /** Rendering-only access. Never copy this target into the blinded UI or diagnostic trace. */
    stimulus() {
        const trial = this.#trials[this.#results.length];
        if (!trial) throw new Error('The listening session has ended.');
        return Object.freeze({ text: trial.text, phonemes: trial.kind === 'letter'
            || (['pair', 'word', 'contrast'].includes(trial.kind) && this.pairMode === 'explicit') ? trial.phonemes : null });
    }

    beginPlayback() {
        if (!this.current()) throw new Error('The listening session has ended.');
        if (this.#playbacks.at(-1)?.status === 'pending') throw new Error('This trial already has a pending playback.');
        if (this.#generated) {
            if (this.#playbacks.length >= 20) throw new Error('This trial has reached its playback-attempt limit.');
            if (this.#playbacks.some(play => play.status === 'drained') && (this.#sessionType === 'evaluation' || !this.#initial)) {
                throw new Error(this.#sessionType === 'evaluation' ? 'Evaluation allows one completed playback per trial.' : 'Record the first answer before replaying.');
            }
        }
        this.#played = false;
        this.#playbacks.push(Object.freeze({ attempt: this.#playbacks.length + 1, status: 'pending', evidence: null }));
    }

    markPlayed(evidence = null) {
        if (!this.current()) throw new Error('The listening session has ended.');
        if (this.#playbacks.at(-1)?.status !== 'pending') this.beginPlayback();
        const index = this.#playbacks.length - 1;
        this.#playbacks[index] = Object.freeze({ attempt: index + 1, status: 'drained', evidence });
        this.#played = true;
    }

    failPlayback({ cancelled = false } = {}) {
        const index = this.#playbacks.length - 1;
        if (index >= 0 && this.#playbacks[index].status === 'pending') {
            this.#playbacks[index] = Object.freeze({ attempt: index + 1, status: cancelled ? 'cancelled' : 'failed', evidence: null });
        }
        this.#played = false;
    }

    #playbackReport() {
        return { playbackAttempts: this.#playbacks.length, replayCount: Math.max(0, this.#playbacks.length - 1),
            completedPlaybacks: this.#playbacks.filter((attempt) => attempt.status === 'drained').length,
            playbacks: Object.freeze(this.#playbacks.slice()) };
    }

    recordInitialAnswer(answer, { clarity = null } = {}) {
        if (!this.#generated) throw new Error('First-listen recording is available in generated lessons.');
        const trial = this.#trials[this.#results.length];
        if (!trial || !this.#played || this.#initial
            || this.#playbacks.filter(play => play.status === 'drained').length !== 1) {
            throw new Error('Record one first answer after the first completed playback.');
        }
        const response = ListeningEvaluation.#responseScore(trial, answer, clarity, this.scoringVersion);
        this.#initial = Object.freeze({ ...response, eligible: this.#playbacks.length === 1,
            playbackAttempts: this.#playbacks.length, completedPlaybacks: 1 });
        return Object.freeze({ recorded: true, initialRecorded: true });
    }

    submit(answer, { clarity = null, comprehensionAnswer = null } = {}) {
        const trial = this.#trials[this.#results.length];
        if (!trial || !this.#played) throw new Error('Play the entire trial before recording an answer.');
        if (this.#generated) {
            if (!this.#initial) throw new Error('Record the first answer before submitting the final response.');
            const response = ListeningEvaluation.#responseScore(trial, answer, clarity, this.scoringVersion);
            if (this.#sessionType === 'evaluation' && (response.answer !== this.#initial.answer
                || response.unclear !== this.#initial.unclear || response.clarity !== this.#initial.clarity)) {
                throw new Error('An evaluation must keep its locked first response.');
            }
            if (comprehensionAnswer !== null && (!trial.comprehension || typeof comprehensionAnswer !== 'string'
                || comprehensionAnswer !== UNCLEAR_LETTER_ANSWER && !trial.comprehension.choices.includes(comprehensionAnswer))) throw new TypeError('Choose an authored comprehension answer or leave it unanswered.');
            const comprehensionUnclear = comprehensionAnswer === UNCLEAR_LETTER_ANSWER;
            const comprehension = trial.comprehension ? Object.freeze({ question: trial.comprehension.question,
                choices: trial.comprehension.choices, answer: comprehensionUnclear ? null : comprehensionAnswer,
                unclear: comprehensionUnclear, correctAnswer: trial.comprehension.answer,
                correct: comprehensionUnclear ? false : comprehensionAnswer === null ? null : comprehensionAnswer === trial.comprehension.answer }) : null;
            const result = Object.freeze({ id: trial.id, kind: trial.kind, target: trial.text,
                choices: trial.choices ?? null, ...(trial.focus ? { focus: trial.focus } : {}),
                focusIds: trial.focusIds, context: trial.context, firstResponse: this.#initial, comprehension,
                heard: true, skipped: false, ...response, ...this.#playbackReport() });
            this.#results.push(result);
            this.#played = false; this.#playbacks = []; this.#initial = null;
            return this.#sessionType === 'evaluation' ? Object.freeze({ recorded: true, feedbackAvailable: false,
                ended: this.#results.length === this.#trials.length }) : result;
        }
        if (typeof answer !== 'string' || answer.length > 2000) throw new TypeError('Answers must be text of at most 2000 characters.');
        if (clarity !== null && (!Number.isInteger(clarity) || clarity < 1 || clarity > 5)) throw new RangeError('Clarity must be 1 to 5, or left unrated.');
        if (this.mode !== 'blind' && trial.choices && answer !== UNCLEAR_LETTER_ANSWER && !trial.choices.includes(answer)) {
            throw new TypeError('Choose one of the displayed answers or I couldn’t tell.');
        }
        const score = scoreTranscription(trial.text, this.mode !== 'blind' && answer === UNCLEAR_LETTER_ANSWER ? '' : answer,
            { scoringVersion: this.scoringVersion });
        const result = Object.freeze({ id: trial.id, kind: trial.kind, target: trial.text,
            ...(trial.focus ? { focus: trial.focus } : {}),
            answer: answer === UNCLEAR_LETTER_ANSWER ? null : answer,
            unclear: answer === UNCLEAR_LETTER_ANSWER, choices: trial.choices ? Object.freeze(trial.choices.slice()) : null,
            heard: true, skipped: false, clarity, ...score, correct: score.errors === 0, ...this.#playbackReport() });
        this.#results.push(result);
        this.#played = false;
        this.#playbacks = [];
        return result;
    }

    skip() {
        const trial = this.#trials[this.#results.length];
        if (!trial) throw new Error('The listening session has ended.');
        if (this.#generated && this.#playbacks.at(-1)?.status === 'pending') throw new Error('Finish or cancel playback before skipping.');
        this.#results.push(Object.freeze({ id: trial.id, kind: trial.kind, target: trial.text,
            ...(trial.focus ? { focus: trial.focus } : {}),
            ...(this.#generated ? { focusIds: trial.focusIds, context: trial.context,
                firstResponse: this.#initial, comprehension: null } : {}),
            choices: trial.choices ? Object.freeze(trial.choices.slice()) : null,
            answer: null, correct: null, skipped: true, heard: this.#played, ...this.#playbackReport() }));
        this.#played = false;
        this.#playbacks = [];
        this.#initial = null;
    }

    static #kindMetrics(entries) {
        return Object.freeze(['word', 'contrast', 'sentence'].filter(kind => entries.some(entry => entry.kind === kind)).map(kind => {
            const rows = entries.filter(entry => entry.kind === kind), answers = rows.map(row => row.response);
            const referenceWords = answers.reduce((sum, answer) => sum + answer.referenceWords, 0);
            const wordErrors = answers.reduce((sum, answer) => sum + answer.errors, 0);
            const correct = answers.filter(answer => answer.correct).length;
            const choices = rows.every(row => Array.isArray(row.choices));
            return Object.freeze({ kind, answered: rows.length, correct, referenceWords, wordErrors,
                wordRecognition: referenceWords ? Math.max(0, 1 - wordErrors / referenceWords) : null,
                ...(choices ? { choiceAccuracy: rows.length ? correct / rows.length : null } : {}) });
        }));
    }

    static #targetMetrics(entries) {
        const targets = entries.flatMap(entry => entry.response.targetRecognition ? [entry.response.targetRecognition] : []);
        const correct = targets.filter(target => target.correct).length;
        return Object.freeze({ eligibleCount: targets.length, correct, accuracy: targets.length ? correct / targets.length : null });
    }

    static #ratingMetrics(entries) {
        const ratings = entries.map(entry => entry.response.clarity).filter(rating => rating !== null);
        return Object.freeze({ ratedCount: ratings.length, mean: ratings.length ? ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length : null });
    }

    #generatedReport() {
        const answered = this.#results.filter(result => !result.skipped);
        const ended = this.#results.length === this.#trials.length;
        const base = { corpusVersion: this.#generated.version, scoringVersion: this.scoringVersion, mode: `classroom-${this.mode}`,
            evidence: 'manual-generated-listening-responses', seed: this.seed,
            randomizationVersion: this.#generated.manifest.generator, listener: this.listener,
            renderPath: this.pairMode === 'explicit' ? 'explicit-phonemes' : 'text-plan',
            sessionType: this.#sessionType, status: answered.length === this.#trials.length ? 'complete' : 'incomplete',
            ended, answered: answered.length, total: this.#trials.length, skipped: this.#results.length - answered.length,
            remaining: this.#trials.length - this.#results.length, meetsProposedGate: null };
        if (this.#sessionType === 'evaluation' && !ended) {
            return Object.freeze({ ...base, resultsWithheld: true, results: Object.freeze([]),
                caveat: 'Evaluation answers, targets and scores are withheld until the block ends.' });
        }
        const first = this.#results.filter(result => result.firstResponse?.eligible).map(result => ({ ...result, response: result.firstResponse }));
        const final = answered.map(result => ({ ...result, response: result }));
        const replayed = answered.filter(result => result.completedPlaybacks > 1);
        const comprehensionResults = this.#results.flatMap(result => result.comprehension
            ? [Object.freeze({ id: result.id, ...result.comprehension })] : []);
        const comprehensionAnswered = comprehensionResults.filter(result => result.answer !== null || result.unclear);
        const comprehensionCorrect = comprehensionAnswered.filter(result => result.correct).length;
        const contexts = [...new Set(this.#trials.map(trial => trial.context))].map(context => {
            const initialRows = first.filter(result => result.context === context), finalRows = final.filter(result => result.context === context);
            return Object.freeze({ context, total: this.#trials.filter(trial => trial.context === context).length,
                answered: finalRows.length, firstListen: Object.freeze({ eligibleCount: initialRows.length,
                    byKind: ListeningEvaluation.#kindMetrics(initialRows), targetRecognition: ListeningEvaluation.#targetMetrics(initialRows) }),
                finalResponse: Object.freeze({ answeredCount: finalRows.length,
                    byKind: ListeningEvaluation.#kindMetrics(finalRows), targetRecognition: ListeningEvaluation.#targetMetrics(finalRows) }) });
        });
        return Object.freeze({ ...base, generatedLesson: this.generatedLesson, correct: answered.filter(result => result.correct).length,
            firstListen: Object.freeze({ eligibleCount: first.length,
                excludedInterruptedCount: this.#results.filter(result => result.firstResponse && !result.firstResponse.eligible).length,
                byKind: ListeningEvaluation.#kindMetrics(first), targetRecognition: ListeningEvaluation.#targetMetrics(first) }),
            finalResponse: Object.freeze({ answeredCount: final.length,
                byKind: ListeningEvaluation.#kindMetrics(final), targetRecognition: ListeningEvaluation.#targetMetrics(final) }),
            replayAssisted: Object.freeze({ eligibleCount: replayed.length,
                correctedCount: replayed.filter(result => !result.firstResponse.correct && result.correct).length }),
            smoothness: Object.freeze({ firstListen: ListeningEvaluation.#ratingMetrics(first), finalResponse: ListeningEvaluation.#ratingMetrics(final) }),
            contextResults: Object.freeze(contexts),
            comprehension: Object.freeze({ total: this.#trials.filter(trial => trial.comprehension).length,
                answered: comprehensionAnswered.length, correct: comprehensionCorrect,
                accuracy: comprehensionAnswered.length ? comprehensionCorrect / comprehensionAnswered.length : null,
                results: Object.freeze(comprehensionResults) }),
            replayCount: this.#results.reduce((sum, result) => sum + result.replayCount, 0),
            results: Object.freeze(this.#results.slice()), ...this.#repeatReport(),
            caveat: 'Authored generated material, not a standardized child assessment or acceptance gate. First-listen eligibility excludes prior interrupted attempts; repeated exposure is reported separately by the caller. Transcription alignment, smoothness ratings and story comprehension measure different outcomes and are not combined into one score.' });
    }

    report() {
        const report = this.#report();
        return this.#feedback.size && !report.resultsWithheld
            ? Object.freeze({ ...report, feedback: this.#feedback.report() }) : report;
    }

    #report() {
        const answered = this.#results.filter((result) => !result.skipped);
        if (this.#generated) return this.#generatedReport();
        if (this.mode === 'alphabet') {
            const correct = answered.filter((result) => result.correct).length;
            const confusions = answered.filter((result) => !result.correct).map((result) => Object.freeze({
                target: result.target, heard: result.answer, unclear: result.unclear, replayCount: result.replayCount,
            }));
            return Object.freeze({
                corpusVersion: ALPHABET_LESSON_VERSION, mode: 'classroom-alphabet', evidence: 'manual-multiple-choice-letter-responses',
                scoringVersion: this.scoringVersion,
                seed: this.seed, randomizationVersion: LISTENING_RANDOMIZATION_VERSION,
                listener: this.listener, renderPath: 'authored-letter-names', dialect: 'English; Z is zee',
                unclearChoice: Object.freeze({ label: 'I couldn’t tell', recordedAnswer: null, flag: 'unclear' }),
                status: answered.length === this.#trials.length ? 'complete' : 'incomplete',
                ended: this.#results.length === this.#trials.length, answered: answered.length, total: this.#trials.length,
                skipped: this.#results.filter((result) => result.skipped).length,
                remaining: this.#trials.length - this.#results.length, correct,
                letterAccuracy: answered.length ? correct / answered.length : null,
                replayCount: this.#results.reduce((count, result) => count + result.replayCount, 0),
                confusions: Object.freeze(confusions), results: Object.freeze(this.#results.slice()),
                meetsProposedGate: null,
                ...this.#repeatReport(),
                caveat: 'Classroom letter-name practice with feedback and multiple choices. Not the 85% minimal-pair or 90% sentence intelligibility gate; not production-readiness evidence.',
            });
        }
        if (this.mode !== 'blind') {
            const correct = answered.filter((result) => result.correct).length;
            const referenceWords = answered.reduce((count, result) => count + result.referenceWords, 0);
            const wordErrors = answered.reduce((count, result) => count + result.errors, 0);
            const focuses = new Map();
            for (const trial of this.#trials) {
                if (!trial.focus) continue;
                const key = JSON.stringify(trial.focus);
                if (!focuses.has(key)) focuses.set(key, { focus: trial.focus, total: 0, answered: 0, correct: 0, unclear: 0, skipped: 0 });
                focuses.get(key).total += 1;
            }
            for (const result of this.#results) {
                if (!result.focus) continue;
                const outcome = focuses.get(JSON.stringify(result.focus));
                outcome.skipped += Number(result.skipped);
                outcome.answered += Number(!result.skipped);
                outcome.correct += Number(result.correct === true);
                outcome.unclear += Number(result.unclear === true);
            }
            return Object.freeze({
                corpusVersion: PRACTICE_CORPUS_VERSION, mode: `classroom-${this.mode}`,
                scoringVersion: this.scoringVersion,
                evidence: this.mode === 'sentences' ? 'manual-sentence-transcriptions' : 'manual-multiple-choice-word-responses',
                seed: this.seed, randomizationVersion: LISTENING_RANDOMIZATION_VERSION, listener: this.listener,
                renderPath: this.mode !== 'sentences' && this.pairMode === 'explicit' ? 'explicit-phonemes' : 'text-plan',
                unclearChoice: Object.freeze({ label: 'I couldn’t tell', recordedAnswer: null, flag: 'unclear' }),
                status: answered.length === this.#trials.length ? 'complete' : 'incomplete',
                ended: this.#results.length === this.#trials.length, answered: answered.length, total: this.#trials.length,
                skipped: this.#results.filter((result) => result.skipped).length,
                remaining: this.#trials.length - this.#results.length, correct,
                ...(this.mode === 'sentences' ? { referenceWords, wordErrors,
                    wordRecognition: referenceWords ? Math.max(0, 1 - wordErrors / referenceWords) : null }
                    : { choiceAccuracy: answered.length ? correct / answered.length : null }),
                replayCount: this.#results.reduce((count, result) => count + result.replayCount, 0),
                confusions: Object.freeze(answered.filter((result) => !result.correct).map((result) => Object.freeze({
                    target: result.target, heard: result.answer, unclear: result.unclear, replayCount: result.replayCount,
                    errors: result.errors, recognition: result.recognition, ...(result.focus ? { focus: result.focus } : {}),
                }))),
                focusOutcomeScope: 'whole-word-listener-responses-not-phoneme-accuracy',
                focusOutcomes: Object.freeze([...focuses.values()].map((outcome) => Object.freeze(outcome))),
                results: Object.freeze(this.#results.slice()), meetsProposedGate: null,
                ...this.#repeatReport(),
                caveat: 'Original classroom practice with feedback. Sound focus labels describe intended exercises, not measured phoneme accuracy. Not a standardized child assessment, held-out intelligibility gate, or production-readiness claim.',
            });
        }
        const pairs = answered.filter((result) => result.kind === 'pair');
        const sentences = answered.filter((result) => result.kind === 'sentence');
        const referenceWords = sentences.reduce((n, result) => n + result.referenceWords, 0);
        const errors = sentences.reduce((n, result) => n + result.errors, 0);
        const pairAccuracy = pairs.length ? pairs.filter((result) => result.correct).length / pairs.length : null;
        const wordRecognition = referenceWords ? Math.max(0, 1 - errors / referenceWords) : null;
        const complete = pairs.length === MINIMAL_PAIRS.length && sentences.length === HELD_OUT_SENTENCES.length;
        return Object.freeze({
            corpusVersion: LISTENING_CORPUS_VERSION, evidence: 'manual-listener-responses',
            scoringVersion: this.scoringVersion,
            seed: this.seed, randomizationVersion: LISTENING_RANDOMIZATION_VERSION,
            listener: this.listener, pairMode: this.pairMode,
            status: complete ? 'complete' : 'incomplete', answered: answered.length, total: this.#trials.length,
            pairAccuracy, wordRecognition, referenceWords, wordErrors: errors,
            proposedGate: Object.freeze({ minimumPairAccuracy: 0.85, minimumWordRecognition: 0.90 }),
            meetsProposedGate: complete ? pairAccuracy >= 0.85 && wordRecognition >= 0.90 : null,
            results: Object.freeze(this.#results.slice()),
            caveat: 'One listener session is diagnostic, not proof of general intelligibility or production readiness.',
        });
    }
}
