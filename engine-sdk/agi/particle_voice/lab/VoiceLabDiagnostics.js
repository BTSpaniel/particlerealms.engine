// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { explicitPhonemesToSequence, textToPhonemeSequence, G2PModel } from '../frontend/G2PModel.js';
import { normalizeText } from '../frontend/TextNormalizer.js';
import { phonemeAt } from '../frontend/PhonemeSet.js';
import { reviewPronunciationCandidate } from '../frontend/PronunciationOverrides.js';
import { ListeningEvaluation, UNCLEAR_LETTER_ANSWER, LISTENING_SCORING_VERSION, listeningScoringVersion } from './ListeningEvaluation.js';
import { PRACTICE_WORDS, PRACTICE_CONTRASTS, PRACTICE_SENTENCES } from './ListeningPracticeCorpus.js';
import { GENERATED_MODES } from './GeneratedListeningCorpus.js';
import { PARTICLE_VOICE_EXPERIMENTAL_SOURCE } from '../model/ParticleVoiceModel.js';
import { sha256HexOfBytes } from '../risk/ReceiptCrypto.js';
import { mountListeningFeedbackPanel, showListeningFeedbackSummary } from './ListeningFeedbackPanel.js';

const LESSON_MODES = Object.freeze({
    ...GENERATED_MODES,
    alphabet: { heading: 'Which letter do you hear?', count: 26, unit: 'letters', question: 'Which letter did you hear?',
        description: 'One sound at a time. Listen, choose your answer, then discover the letter. There’s no rush, and replays are always welcome.' },
    words: { heading: 'Which word do you hear?', count: PRACTICE_WORDS.length, unit: 'words', question: 'Which word did you hear?',
        description: 'Familiar words with sounds at the beginning, middle, and end. Listen, then choose the word you understood. Feedback shows which sound the word explores.' },
    contrasts: { heading: 'Can you hear the difference?', count: PRACTICE_CONTRASTS.length, unit: 'pairs', question: 'Which word did you hear?',
        description: 'Two words with one sound difference. Listen to one word, then choose between the pair. This helps reveal sounds that are easy to confuse.' },
    sentences: { heading: 'What sentence do you hear?', count: PRACTICE_SENTENCES.length, unit: 'sentences', question: 'Type the words you heard.',
        description: 'Short everyday sentences, one at a time. Type the words you understood before seeing the answer. Missing or extra words count; case and punctuation do not. New lessons accept number digits such as 2 for two. Exact retests keep their original scoring.' },
});

function scoringDescription(report) {
    return listeningScoringVersion(report) === LISTENING_SCORING_VERSION
        ? 'Whole-number digits match number words (v2)' : 'Original word scoring (v1)';
}

/** Identity of generated mono PCM, not a recording of hardware playback or a build attestation.
 * Digest input: UTF-8 "particle-voice-pcm-f32le-v1\\0", uint32LE sample rate,
 * uint32LE sample count, then exact IEEE-754 float32 little-endian sample bytes.
 * Nothing is persisted, uploaded, or included as raw audio in the report.
 */
export async function voiceLabAudioIdentity(result, { signal } = {}) {
    const pcm = result && Object.getOwnPropertyDescriptor(result, 'pcm')?.value;
    const sampleRate = result && Object.getOwnPropertyDescriptor(result, 'sampleRate')?.value;
    const validPcm = pcm instanceof Float32Array && pcm.length <= 0xffffffff;
    const validRate = Number.isInteger(sampleRate) && sampleRate > 0 && sampleRate <= 0xffffffff;
    const metadata = { schemaVersion: 1, scope: 'model-output-before-resampling',
        encoding: 'particle-voice-pcm-f32le-v1', algorithm: 'SHA-256', format: 'f32le', channels: 1,
        sampleRate: validRate ? sampleRate : null, sampleCount: validPcm ? pcm.length : null,
        byteLength: validPcm ? pcm.byteLength : null };
    const unavailable = (reason) => Object.freeze({ ...metadata, status: 'unavailable', digest: null, reason });
    const cancelled = () => new DOMException('Listening identity cancelled.', 'AbortError');
    if (signal?.aborted) throw cancelled();
    if (!validPcm || !validRate) return unavailable('invalid-pcm-or-sample-rate');
    if (!globalThis.crypto?.subtle) return unavailable('webcrypto-unavailable');
    const prefix = new TextEncoder().encode('particle-voice-pcm-f32le-v1\0');
    const bytes = new Uint8Array(prefix.length + 8 + pcm.byteLength);
    bytes.set(prefix);
    const view = new DataView(bytes.buffer);
    view.setUint32(prefix.length, sampleRate, true);
    view.setUint32(prefix.length + 4, pcm.length, true);
    for (let index = 0; index < pcm.length; index++) {
        if (!Number.isFinite(pcm[index])) return unavailable('non-finite-pcm');
        view.setFloat32(prefix.length + 8 + index * 4, pcm[index], true);
    }
    // Snapshot before yielding so reused synthesis buffers cannot change identity.
    // Observe failures immediately, while hashing runs alongside actual playback.
    const identity = sha256HexOfBytes(bytes).then((hex) => hex
        ? Object.freeze({ ...metadata, status: 'available', digest: `sha256:${hex}`, reason: null })
        : unavailable('webcrypto-unavailable'), () => unavailable('hash-failed'));
    if (!signal) return identity;
    let onAbort;
    const aborted = new Promise((_, reject) => {
        onAbort = () => reject(cancelled());
        signal.addEventListener('abort', onAbort, { once: true });
        if (signal.aborted) onAbort();
    });
    try { return await Promise.race([identity, aborted]); }
    finally { signal.removeEventListener('abort', onAbort); }
}

export function pronunciationTrace(sequence, wordBoundaries = []) {
    return (sequence.words ?? []).map((word, index) => ({
        ...word,
        phonemes: Array.from(sequence.phonemeIds.slice(word.startPhoneme, word.endPhoneme), (id, offset) => {
            const stress = sequence.stress[word.startPhoneme + offset];
            return `${phonemeAt(id).symbol}${stress || ''}`;
        }).join(' '),
        timing: wordBoundaries[index] ?? null,
    }));
}

// Deliberately project named numeric fields, not caller-injected objects,
// accessor properties, plans, transcripts, GPU handles, or model internals.
function numericFields(source, keys) {
    return Object.fromEntries(keys.map((key) => {
        const value = source && Object.getOwnPropertyDescriptor(source, key)?.value;
        return [key, typeof value === 'number' && Number.isFinite(value) ? value : null];
    }));
}

function pressurePreparationDiagnostics(diagnostics) {
    const preparation = diagnostics && Object.getOwnPropertyDescriptor(diagnostics, 'pressurePreparation')?.value;
    if (!preparation || Object.getOwnPropertyDescriptor(preparation, 'kind')?.value !== 'leading-silence') return null;
    return {
        kind: 'leading-silence',
        ...numericFields(preparation, ['leadingFrames', 'targetPressure', 'absoluteSpeechStartSample', 'sourceHeldUntilRelativeSample']),
    };
}

export function voiceLabConfiguration(model, { ready = false, outputSampleRate = null } = {}) {
    if (!ready || !model) return { initialized: false, voicePreset: null, model: null, tract: null, prosody: null, articulation: null, outputSampleRate: null };
    const prosody = model.prosody?.config;
    const tract = model.tractConfiguration;
    return {
        initialized: true,
        // The base identity is distinct from the effective numeric settings
        // below, which include explicit caller overrides and session tuning.
        voicePreset: model.voicePreset ? {
            id: model.voicePreset.id, label: model.voicePreset.label, locale: model.voicePreset.locale,
            kind: model.voicePreset.kind, experimental: true, learnedModel: false,
            model: numericFields(model.voicePreset.model, ['numSections', 'nasalSections']),
            prosody: numericFields(model.voicePreset.prosody, ['baseF0Hz']),
            articulation: numericFields(model.voicePreset.articulation, ['openQuotient', 'peakQuotient', 'returnQuotient', 'voicedAspiration', 'fricationAmplitude']),
        } : null,
        model: numericFields(model.config, ['sampleRate', 'chunkSamples', 'renderBatchChunks', 'numSections', 'nasalSections', 'compliance', 'referencePressure', 'targetRms', 'peakCeiling', 'maxAutoGain', 'fadeMs', 'visualFramesPerChunk', 'nasalBranchGain']),
        tract: tract ? numericFields(tract, ['sampleRate', 'chunkSamples', 'numInstances', 'numSections', 'nasalSections', 'glottalReflection', 'lipReflection', 'nostrilReflection', 'wallLoss', 'nasalTapIndex', 'fricationBandlimitHz', 'fricationBandlimitTaps', 'outletVolumeReferenceAreaCm2']) : null,
        prosody: {
            ...numericFields(prosody, ['baseF0Hz', 'declinationRatio', 'minF0Hz', 'maxF0Hz', 'minDurationFrames', 'preFortisVowelScale', 'whQuestionF0Scale']),
            stressDurationScale: numericFields(prosody?.stressDurationScale, ['0', '1', '2']),
            stressF0Scale: numericFields(prosody?.stressF0Scale, ['0', '1', '2']),
            preBoundaryLengthening: numericFields(prosody?.preBoundaryLengthening, ['0', '1', '2', '3', '4', '5']),
            terminalF0Scale: numericFields(prosody?.terminalF0Scale, ['0', '1', '2', '3', '4', '5']),
        },
        articulation: numericFields(model.articulation?.config, ['numSections', 'openQuotient', 'peakQuotient', 'returnQuotient', 'jitterAmount', 'shimmerAmount', 'voicedEe', 'voicedObstruentEeGain', 'voicedPressure', 'voicelessPressure', 'silentPressure', 'nasalCoupling', 'fricationAmplitude', 'aspirationAmplitude', 'stopAspirationMs', 'voicedAspiration', 'neutralPharynxArea', 'neutralMidArea', 'neutralLipArea', 'confidence']),
        outputSampleRate: typeof outputSampleRate === 'number' && Number.isFinite(outputSampleRate) ? outputSampleRate : null,
    };
}

/** Attach diagnostics to the existing lab graph, never create another audio/model owner. */
export function installVoiceLabDiagnostics({ document, getModel, getOutputSampleRate = () => null,
    getTuningSnapshot = () => null, renderLetter = null, inspectText = null, inspectLetter = null,
    play, isReady, isBusy, setBusy, onError, onReport = null, audioCapture = null }) {
    const el = (id) => document.getElementById(id);
    const localG2p = new G2PModel();
    let evaluation = null;
    let evaluationFeedbackTrial = null;
    let evaluationFinished = false;
    let lesson = null;
    let lessonFinished = false;
    let lessonFeedback = null;
    let lessonFeedbackTrial = null;
    let lessonReportSnapshot = null;
    let lessonStartedAt = null;
    let repeatReport = null;
    let lessonInitialAnswer = null;
    let lessonInitialClarity = null;
    const exposures = new Map();
    let lessonExposures = [];
    let practiceFocusIds = [];
    let operation = null;
    let telemetryGeneration = 0;
    let synthesisStartedAt = null;
    let telemetry = { state: 'not-started', synthesis: null, playback: null, error: null, events: [] };
    const status = (text) => { el('diagnostic-status').textContent = text; };
    const lessonStatus = (text) => { status(text); if (el('lesson-action-status')) el('lesson-action-status').textContent = text; };
    const blindActive = () => evaluation !== null && evaluation.current() !== null;
    const lessonActive = () => lesson !== null && !lessonFinished;
    const active = () => blindActive() || lessonActive();
    const g2p = () => getModel()?.g2p ?? localG2p;
    const trace = (sequence, timing) => { el('pronunciation-trace').textContent = JSON.stringify(pronunciationTrace(sequence, timing), null, 2); };

    function startAudioArchive(session, kind) {
        audioCapture?.start(session, { kind, metadata: {
            source: PARTICLE_VOICE_EXPERIMENTAL_SOURCE, initialReport: session.report(),
            plannedTrials: session.recordingPlan?.() ?? null,
            configuration: voiceLabConfiguration(getModel(), { ready: isReady(), outputSampleRate: getOutputSampleRate() }),
            tuning: getTuningSnapshot(),
        } });
        saveAudioProgress(session);
    }
    function saveAudioProgress(session, { report = null, ended = false, incomplete = false } = {}) {
        if (!audioCapture || !session) return Promise.resolve(null);
        const snapshot = report ?? session.report();
        const current = session.current();
        return audioCapture.checkpoint(session, snapshot, {
            status: ended ? snapshot.status === 'incomplete' || snapshot.skipped || incomplete ? 'incomplete' : 'completed' : 'active',
            privateProgress: snapshot.resultsWithheld ? session.recordingProgress() : null,
            metadata: { currentTrial: current,
                pendingFirstResponse: session === lesson && current?.initialRecorded
                    ? { trialIndex: current.index, answer: lessonInitialAnswer, smoothness: lessonInitialClarity } : null },
        });
    }
    function audioTrialContext(session, stimulus, renderPath) {
        const trial = session.current();
        return { session, trialId: trial.id, playId: `trial-${trial.index}-play-${trial.playbackAttempts}`,
            metadata: { trialIndex: trial.index, attempt: trial.playbackAttempts, kind: trial.kind,
                stimulus: { ...stimulus }, renderPath, heldOut: session.mode === 'blind' } };
    }

    function listenerFeedbackState(session, { afterAnswer = false, previousTrial = null, ended = false } = {}) {
        const trial = afterAnswer ? previousTrial : session?.current();
        const locked = !!session?.generatedLesson && session.sessionType === 'evaluation' && (trial?.initialRecorded || afterAnswer);
        const visible = !!trial?.playbackAttempts && !ended;
        const available = visible && !isBusy() && !locked;
        return { session, trialIndex: trial?.index ?? null, afterAnswer, visible, hasCompleted: !!trial?.completedPlaybacks,
            canRate: available && (!!trial?.played || afterAnswer),
            canFlag: available,
            canConfidence: available && !!trial?.played && !afterAnswer && !trial?.initialRecorded,
            timing: locked ? 'First-answer feedback is locked for this evaluation.'
                : afterAnswer ? 'The answer is visible. New ratings are marked after feedback.'
                    : trial?.playbackAttempts > 1 ? 'New feedback is marked after replay or retry, before the answer is shown.'
                        : trial?.initialRecorded ? 'First answer saved. New ratings stay separate from your first-answer feedback.'
                            : trial?.played ? 'Saved before the answer is shown. Confidence is optional; tap a selected choice to clear it.'
                                : 'You can flag a playback problem. Replay the sound before answering or rating it.',
        };
    }
    const lessonFeedbackPanel = mountListeningFeedbackPanel({ document, prefix: 'lesson',
        getState: () => listenerFeedbackState(lesson, { afterAnswer: !!lessonFeedback, previousTrial: lessonFeedbackTrial, ended: lessonFinished }),
        onChange: (patch, trialIndex) => { lesson.recordFeedback(patch, { trialIndex }); void saveAudioProgress(lesson); },
        onError: error => lessonStatus(error.message),
    });
    const evaluationFeedbackPanel = mountListeningFeedbackPanel({ document, prefix: 'evaluation',
        getState: () => listenerFeedbackState(evaluation, { afterAnswer: !!evaluationFeedbackTrial,
            previousTrial: evaluationFeedbackTrial, ended: evaluationFinished }),
        onChange: (patch, trialIndex) => { evaluation.recordFeedback(patch, { trialIndex }); void saveAudioProgress(evaluation); },
        onError: error => status(error.message),
    });

    function refreshRuntime() {
        const configuration = voiceLabConfiguration(getModel(), { ready: isReady(), outputSampleRate: getOutputSampleRate() });
        if (configuration.initialized && ['not-started', 'initializing'].includes(telemetry.state)) telemetry.state = 'ready';
        const configView = el('voice-runtime-config');
        const stateView = el('voice-runtime-diagnostics');
        const stateSummary = el('voice-runtime-state');
        if (configView) configView.textContent = JSON.stringify(configuration, null, 2);
        if (stateView) stateView.textContent = JSON.stringify(telemetry, null, 2);
        if (stateSummary) stateSummary.textContent = telemetry.state;
    }

    function playbackState(state, details = {}, generation = telemetryGeneration) {
        if (generation !== telemetryGeneration) return;
        if (!['initializing', 'rendering', 'queueing', 'queued', 'playing', 'drained', 'stopped', 'error'].includes(state)) throw new TypeError('Unknown Voice Lab diagnostic state');
        telemetry.state = state;
        telemetry.events = [...telemetry.events, { state, elapsedMs: synthesisStartedAt === null ? null : performance.now() - synthesisStartedAt }].slice(-8);
        if (state === 'queueing' || state === 'queued' || state === 'playing' || state === 'drained') {
            const counts = numericFields(details, ['writtenSamples', 'resampledSamples', 'remainingSamples', 'sentenceCount', 'firstQueuedMs', 'firstConsumedMs', 'synthesisMs', 'durationMs']);
            telemetry.playback = { ...telemetry.playback, ...Object.fromEntries(Object.entries(counts).filter(([, value]) => value !== null)) };
        }
        refreshRuntime();
    }

    function beginSynthesis() {
        telemetryGeneration += 1;
        synthesisStartedAt = performance.now();
        telemetry = { state: 'rendering', synthesis: null, playback: null, error: null, events: [] };
        if (!active()) el('pronunciation-trace').textContent = 'No pronunciation trace for this render yet.';
        playbackState('rendering');
        return telemetryGeneration;
    }

    function recordSynthesis(result, generation) {
        if (generation !== telemetryGeneration) return;
        const sampleRate = numericFields(result, ['sampleRate']).sampleRate;
        const samples = result?.pcm instanceof Float32Array ? result.pcm.length : null;
        telemetry.synthesis = {
            ...numericFields(result, ['sampleRate', 'chunks', 'index', 'sentenceCount', 'rawRms', 'rawPeak', 'appliedGain']),
            samples, durationMs: samples !== null && sampleRate > 0 ? samples / sampleRate * 1000 : null,
            elapsedMs: synthesisStartedAt === null ? null : performance.now() - synthesisStartedAt,
            ...numericFields(result?.diagnostics, ['totalRenderMs', 'renderReadbackMs', 'visualReadbackMs', 'normalizeAndLimitMs', 'renderBatchChunks', 'readbackBatches', 'alignedReleaseCount', 'maxReleaseDelaySamples', 'aspiratedReleaseFrames']),
            pressurePreparation: pressurePreparationDiagnostics(result?.diagnostics),
        };
        refreshRuntime();
    }

    // Use the returned plan, not a reconstruction with the current G2P or
    // whole-paragraph timing. Never expose a hidden trial or retired render.
    function recordPronunciation(result, generation, renderPath) {
        if (generation !== telemetryGeneration || active() || !result?.plan?.sequence) return;
        trace(result.plan.sequence, result.wordBoundaries ?? result.plan.wordBoundaries);
        const unit = Number.isInteger(result.index) && Number.isInteger(result.sentenceCount)
            ? ` unit ${result.index + 1}/${result.sentenceCount}` : '';
        status(`Rendered ${renderPath}${unit}. Timing is local to this rendered unit; it does not confirm completed playback.`);
    }

    function failed(error, generation = telemetryGeneration) {
        if (generation !== telemetryGeneration) return;
        telemetry.error = error?.name === 'AbortError' ? null : active()
            ? 'Synthesis or playback failed; this blind trial was not completed.'
            : String(error?.message ?? 'Synthesis or playback failed.').slice(0, 240);
        playbackState(error?.name === 'AbortError' ? 'stopped' : 'error', {}, generation);
    }

    async function finishPlayback(playback, signal, generation) {
        try {
            const remaining = await playback.drain({ signal });
            if (signal?.aborted || generation !== telemetryGeneration) throw new DOMException('Playback was stopped.', 'AbortError');
            playbackState(remaining === 0 ? 'drained' : 'queued', { remainingSamples: remaining }, generation);
            if (remaining !== 0) {
                playback.cancel();
                throw new Error('Audio did not finish draining; this playback cannot count as a heard trial.');
            }
        } catch (error) {
            failed(error, generation);
            throw error;
        }
    }

    function refresh() {
        refreshRuntime();
        const unavailable = isBusy() || !isReady();
        for (const id of ['explicit-speak', 'evaluation-start']) el(id).disabled = unavailable || active();
        for (const id of ['inspect-text', 'override-preview', 'override-apply', 'override-clear']) el(id).disabled = isBusy() || active();
        if (el('inspect-letter')) el('inspect-letter').disabled = isBusy() || active() || typeof inspectLetter !== 'function';
        for (const id of ['override-word', 'override-phones', 'override-reviewed', 'evaluation-listener', 'evaluation-mode']) el(id).disabled = isBusy() || active();
        el('evaluation-play').disabled = unavailable || !blindActive();
        el('evaluation-answer').disabled = isBusy() || !evaluation?.current()?.played;
        el('evaluation-submit').disabled = isBusy() || !evaluation?.current()?.played;
        el('evaluation-skip').disabled = isBusy() || !blindActive();
        el('evaluation-end').disabled = isBusy() || !evaluation || evaluationFinished;
        el('evaluation-end').textContent = evaluation && !evaluation.current() ? 'Finish evaluation' : 'End incomplete';
        el('evaluation-export').disabled = !evaluation || isBusy();
        const trial = evaluation?.current();
        el('evaluation-progress').textContent = trial
            ? `Trial ${trial.index}/${trial.total}: ${trial.kind === 'pair' ? 'Choose the word you hear.' : 'Type the sentence you hear. Use an empty answer if nothing was understood.'}`
            : evaluation ? evaluationFinished ? 'Session ended. Export the recorded results; skipped trials remain incomplete.'
                : 'All answers recorded. Add optional feedback, then Finish evaluation.' : 'No listening evidence has been recorded.';
        refreshLesson();
        lessonFeedbackPanel.refresh();
        evaluationFeedbackPanel.refresh();
        audioCapture?.refresh();
    }

    function refreshLesson() {
        if (!el('lesson-start')) return;
        const occupied = isBusy();
        const trial = lesson?.current();
        const mode = lessonActive() ? lesson.mode : el('lesson-mode')?.value ?? 'alphabet';
        const info = LESSON_MODES[mode] ?? LESSON_MODES.alphabet;
        const generated = Object.hasOwn(GENERATED_MODES, mode);
        const evaluating = lessonActive() && lesson.sessionType === 'evaluation';
        const initialRecorded = !!trial?.initialRecorded;
        const responseReady = !occupied && !!trial?.played && !lessonFeedback && !lessonFinished;
        const choicesReady = responseReady && !(evaluating && initialRecorded);
        const transcription = !!trial && !Array.isArray(trial.choices);
        if (el('lesson-mode')) el('lesson-mode').disabled = occupied || active();
        if (el('lesson-generated-settings')) el('lesson-generated-settings').hidden = !generated || lessonActive();
        if (el('lesson-stage')) el('lesson-stage').hidden = !lessonActive();
        if (el('lesson-mode')) el('lesson-mode').closest('.lesson-picker')?.toggleAttribute('hidden', lessonActive());
        if (el('lesson-listener')) el('lesson-listener').closest('.lesson-setup')?.toggleAttribute('hidden', lessonActive());
        for (const id of ['lesson-session-type', 'lesson-seed', 'lesson-warmup']) if (el(id)) {
            el(id).disabled = occupied || active() || !generated || (id === 'lesson-warmup' && !isReady());
        }
        if (el('lesson-adaptive')) el('lesson-adaptive').disabled = occupied || active() || !isReady()
            || !practiceFocusIds.length || (generated && el('lesson-session-type')?.value === 'evaluation');
        if (el('lesson-heading')) el('lesson-heading').textContent = info.heading;
        if (el('lesson-description')) el('lesson-description').textContent = info.description;
        const count = lessonActive() ? trial?.total ?? lesson.report().total : info.count;
        if (el('lesson-count-value')) el('lesson-count-value').textContent = count;
        if (el('lesson-count-unit')) el('lesson-count-unit').textContent = info.unit;
        el('lesson-count')?.setAttribute('aria-label', `${count} ${info.unit}`);
        if (el('lesson-repeat-settings')) el('lesson-repeat-settings').hidden = active();
        for (const id of ['lesson-baseline-json', 'lesson-load-baseline']) if (el(id)) el(id).disabled = occupied || active();
        for (const id of ['lesson-repeat', 'lesson-missed']) if (el(id)) {
            el(id).disabled = occupied || active() || !isReady() || !repeatReport
                || (repeatReport.mode === 'classroom-alphabet' && typeof renderLetter !== 'function')
                || (id === 'lesson-missed' && !repeatReport.results.some((result) => !result.skipped && !result.correct));
        }
        if (el('lesson-render-settings')) el('lesson-render-settings').hidden = lessonActive() || !['words', 'contrasts', 'balanced'].includes(mode);
        if (el('lesson-render-mode')) el('lesson-render-mode').disabled = occupied || active() || !['words', 'contrasts', 'balanced'].includes(mode);
        if (el('lesson-answer-hint')) el('lesson-answer-hint').textContent = generated
            ? initialRecorded ? (evaluating ? 'First answer locked. Confirm it below; results appear at the end.' : 'First answer saved. You may replay and revise, or keep your answer.')
                : 'Listen once, then record your first answer. Optional replays come afterward.'
            : mode === 'sentences'
            ? 'Listen first. Write what you heard after the sound finishes.' : 'Listen first. Your choices appear after the sound.';
        el('lesson-start').disabled = occupied || !isReady() || active() || (mode === 'alphabet' && typeof renderLetter !== 'function');
        el('lesson-listener').disabled = occupied || active();
        el('lesson-play').disabled = occupied || !isReady() || !lessonActive() || !!lessonFeedback
            || (generated && trial?.completedPlaybacks > 0 && (!initialRecorded || evaluating));
        el('lesson-play').textContent = trial?.playbackAttempts ? 'Replay sound' : 'Play sound';
        el('lesson-skip').disabled = occupied || !lessonActive() || !!lessonFeedback;
        el('lesson-end').disabled = occupied || !lessonActive();
        el('lesson-next').disabled = occupied || !lessonFeedback;
        el('lesson-next').hidden = !lessonFeedback;
        el('lesson-next').textContent = trial ? 'Next sound' : 'Show results';
        el('lesson-options').hidden = !choicesReady || transcription;
        el('lesson-options').setAttribute('aria-label', info.question);
        el('lesson-options').dataset.kind = trial?.kind ?? '';
        for (const button of el('lesson-options').querySelectorAll('button')) button.disabled = !choicesReady;
        if (el('lesson-answer-form')) el('lesson-answer-form').hidden = !choicesReady || !transcription;
        for (const id of ['lesson-answer', 'lesson-submit', 'lesson-unclear']) {
            if (el(id)) el(id).disabled = !choicesReady || !transcription;
        }
        if (el('lesson-submit')) el('lesson-submit').textContent = generated && !initialRecorded ? 'Save first answer' : 'Record my answer';
        if (el('lesson-response-review')) el('lesson-response-review').hidden = !generated || !responseReady || !initialRecorded;
        if (el('lesson-initial-status')) el('lesson-initial-status').textContent = initialRecorded
            ? `First response saved: ${lessonInitialAnswer === UNCLEAR_LETTER_ANSWER ? 'I couldn’t tell' : `“${lessonInitialAnswer}”`}.` : '';
        const comprehension = trial?.comprehension;
        if (el('lesson-comprehension-field')) el('lesson-comprehension-field').hidden = !responseReady || !comprehension;
        if (comprehension && el('lesson-comprehension')) {
            const select = el('lesson-comprehension');
            const signature = JSON.stringify(comprehension);
            if (select.dataset.question !== signature) {
                select.replaceChildren();
                for (const [value, text] of [['', 'Choose an answer'], ...comprehension.choices.map(value => [value, value]), [UNCLEAR_LETTER_ANSWER, 'I couldn’t tell']]) {
                    const option = document.createElement('option'); option.value = value; option.textContent = text; select.append(option);
                }
                select.dataset.question = signature;
                el('lesson-comprehension-question').textContent = comprehension.question;
            }
            select.disabled = !responseReady;
        }
        if (el('lesson-keep-answer')) {
            el('lesson-keep-answer').hidden = !generated || !initialRecorded || !responseReady;
            el('lesson-keep-answer').disabled = !responseReady || !initialRecorded || (!!comprehension && !el('lesson-comprehension').value);
        }
        el('lesson-copy').disabled = occupied || !lessonFinished;
        el('lesson-download').disabled = occupied || !lessonFinished;
        el('lesson-progress').textContent = lessonFinished
            ? 'Lesson complete. Review your results below, or start another test.'
            : lessonFeedback ? (evaluating ? 'Answer recorded. Continue; feedback appears when the block ends.' : 'Answer recorded. Read the feedback, then continue.')
                : trial ? `Sound ${trial.index} of ${trial.total} · ${trial.completedPlaybacks} completed play(s). ${trial.played ? info.question : 'Listen first. Answer after the sound finishes.'}`
                    : isReady() ? 'Choose a test, then start your lesson.' : 'Enable audio to begin your first test.';
    }

    function prepareLessonTrial() {
        lessonFeedback = null;
        lessonFeedbackTrial = null;
        if (el('lesson-action-status')) el('lesson-action-status').textContent = '';
        lessonInitialAnswer = null;
        lessonInitialClarity = null;
        el('lesson-feedback').textContent = '';
        el('lesson-options').replaceChildren();
        if (el('lesson-answer')) el('lesson-answer').value = '';
        if (el('lesson-smoothness')) el('lesson-smoothness').value = '';
        if (el('lesson-comprehension')) { el('lesson-comprehension').value = ''; delete el('lesson-comprehension').dataset.question; }
        refresh();
        el('lesson-play').focus();
    }

    function finishLesson() {
        lessonFeedbackPanel.flush();
        while (lesson.current()) lesson.skip();
        lessonFinished = true;
        lessonFeedback = null;
        el('lesson-options').replaceChildren();
        el('lesson-feedback').textContent = '';
        const report = Object.freeze({ ...lesson.report(), startedAt: lessonStartedAt, endedAt: new Date().toISOString(),
            source: PARTICLE_VOICE_EXPERIMENTAL_SOURCE,
            configurationAtEnd: voiceLabConfiguration(getModel(), { ready: isReady(), outputSampleRate: getOutputSampleRate() }),
            tuningAtEnd: getTuningSnapshot(),
            ...(lesson.generatedLesson ? { exposure: { scope: 'current-page-only', priorHistoryAvailable: false,
                trials: lessonExposures.slice(), repeatedTargets: lessonExposures.filter(item => item.previousPresentations > 0).length } } : {}),
        });
        lessonReportSnapshot = report;
        void saveAudioProgress(lesson, { report, ended: true });
        if (report.answered && onReport) {
            Promise.resolve().then(() => onReport(report)).catch(error => {
                if (el('lesson-action-status')) el('lesson-action-status').textContent = 'Local saving failed. Download these results to preserve them.';
                onError(error);
            });
        }
        if (report.answered) setRepeatReport(report);
        const confusions = report.confusions ?? report.results.filter(item => !item.skipped && !item.correct).map(item => ({ ...item, heard: item.answer }));
        const misses = confusions.map((item) => `${item.target} → ${item.unclear ? 'couldn’t tell' : item.heard}`);
        const sentenceMetrics = report.finalResponse?.byKind.find(item => item.kind === 'sentence') ?? report;
        const comparison = report.matchedComparison
            ? ` Matched targets: ${report.matchedComparison.previousCorrect}/${report.matchedComparison.answered} previously correct, ${report.matchedComparison.correct}/${report.matchedComparison.answered} now correct. ${report.matchedComparison.sameScoring ? 'Same scoring rules.' : 'Scoring rules differ; scores are not directly comparable.'}` : '';
        const score = ['sentences', 'blending', 'generated', 'storylets'].includes(lesson.mode)
            ? `${sentenceMetrics.wordRecognition == null ? 'No' : `${Math.round(sentenceMetrics.wordRecognition * 100)}%`} ${lesson.mode === 'blending' ? 'sentence ' : ''}word recognition; ${sentenceMetrics.wordErrors ?? 0} word edit error(s). ${report.correct}/${report.answered} trials exact; ${report.skipped} skipped. `
            : `${report.correct}/${report.answered} answered correctly; ${report.skipped} skipped. `;
        el('lesson-summary').textContent = `${LESSON_MODES[lesson.mode].unit}: ${score}`
            + (misses.length ? `Review: ${misses.join(', ')}.` : report.answered ? 'No recorded confusions.' : 'No answers recorded.')
            + comparison + ` ${scoringDescription(report)}. Repeated listening and feedback can affect recognition.`
            + ' This practice score does not pass the separate speech intelligibility gates.';
        if (report.generatedLesson) {
            el('lesson-summary').textContent = `${lesson.sessionType === 'evaluation' ? 'Evaluation' : report.practiceRepeat ? 'Fixed retest' : 'Practice'} · ${score}`
                + (misses.length ? ` Review: ${misses.join(', ')}.` : '')
                + comparison
                + ' Compare scores within the same mode and material. Repeated exposure can affect recognition.';
            showLessonMeasures(report);
        }
        el('lesson-json').value = JSON.stringify(report, null, 2);
        showListeningFeedbackSummary(document, report);
        el('lesson-results').hidden = false;
        setBusy(false);
        el('lesson-copy').focus();
    }

    function submitLessonAnswer(answer) {
        if (isBusy() || !lessonActive() || lessonFeedback || !lesson.current()?.played) return;
        try {
            lessonFeedbackPanel.flush();
            const generated = !!lesson.generatedLesson;
            const clarity = generated && el('lesson-smoothness')?.value ? Number(el('lesson-smoothness').value) : null;
            if (generated && !lesson.current().initialRecorded) {
                lesson.recordInitialAnswer(answer, { clarity });
                lessonInitialAnswer = answer;
                lessonInitialClarity = clarity;
                void saveAudioProgress(lesson);
                refresh();
                (lesson.current().comprehension ? el('lesson-comprehension') : el('lesson-keep-answer')).focus();
                return;
            }
            const comprehension = lesson.current().comprehension;
            const comprehensionValue = comprehension ? el('lesson-comprehension').value : null;
            if (comprehension && !comprehensionValue) throw new TypeError('Choose a story answer, or I couldn’t tell.');
            const comprehensionAnswer = comprehensionValue;
            const answeredTrial = lesson.current();
            const result = lesson.submit(lesson.sessionType === 'evaluation' ? lessonInitialAnswer : answer,
                { clarity: lesson.sessionType === 'evaluation' ? lessonInitialClarity : clarity, comprehensionAnswer });
            void saveAudioProgress(lesson);
            lessonFeedback = result;
            lessonFeedbackTrial = answeredTrial;
            el('lesson-feedback').textContent = lesson.sessionType === 'evaluation' ? 'Answer saved. Results will appear when the block ends.'
                : result.correct ? `Correct! That was ${result.target}.`
                : result.unclear ? `Thanks for being honest. That was ${result.target}. We’ll include it in the review list.`
                    : result.kind === 'sentence' ? `You wrote “${result.answer}”. The sentence was “${result.target}” — ${result.errors} word edit error(s).`
                        : `You chose ${result.answer}. That was ${result.target}. We’ll record this confusion.`;
            if (result.focus) {
                const transition = result.focus.type === 'transition';
                const sounds = result.focus.sound ?? result.focus.sounds?.join(transition ? ' → ' : ' / ');
                if (sounds) el('lesson-feedback').textContent += ` Sound ${transition ? 'transition' : 'focus'}: ${sounds}, ${result.focus.position}.`;
            }
            refresh();
            el('lesson-next').focus();
        } catch (error) { lessonStatus(error.message); }
    }

    function showLessonMeasures(report) {
        const container = el('lesson-measures');
        if (!container) return;
        container.replaceChildren();
        const rows = [];
        rows.push(['Word scoring', scoringDescription(report)]);
        for (const [label, metric] of [['First listen', report.firstListen], ['Final response', report.finalResponse]]) {
            for (const group of metric?.byKind ?? []) {
                rows.push([`${label} · ${'choiceAccuracy' in group ? 'choices' : group.kind === 'word' ? 'isolated words' : 'sentence words'}`,
                    !('choiceAccuracy' in group) ? `${group.wordRecognition === null ? '—' : Math.round(group.wordRecognition * 100) + '%'} · ${group.wordErrors} word errors / ${group.referenceWords} words`
                        : `${group.correct}/${group.answered} correct`]);
            }
            if (metric?.targetRecognition?.eligibleCount) rows.push([`${label} · target words`, `${metric.targetRecognition.correct}/${metric.targetRecognition.eligibleCount} correct`]);
        }
        if (report.replayAssisted) rows.push(['After replay', `${report.replayAssisted.correctedCount} corrected / ${report.replayAssisted.eligibleCount} replayed trials`]);
        if (report.smoothness?.finalResponse?.ratedCount) rows.push(['Smoothness (separate rating)', `${report.smoothness.finalResponse.mean.toFixed(1)}/5 · ${report.smoothness.finalResponse.ratedCount} ratings`]);
        if (report.comprehension?.total) rows.push(['Story understanding (separate score)', `${report.comprehension.correct}/${report.comprehension.answered} answered correctly`]);
        for (const context of report.contextResults ?? []) {
            if (context.finalResponse.targetRecognition.eligibleCount) rows.push([`Target in ${context.context}`,
                `${context.firstListen.targetRecognition.correct}/${context.firstListen.targetRecognition.eligibleCount} first listen; ${context.finalResponse.targetRecognition.correct}/${context.finalResponse.targetRecognition.eligibleCount} final`]);
        }
        rows.push(['Earlier exposure on this page', `${report.exposure.repeatedTargets} trial(s); history before this page is unknown`]);
        const table = document.createElement('table');
        const caption = document.createElement('caption'); caption.textContent = 'Separate listening outcomes'; table.append(caption);
        for (const [name, value] of rows) {
            const row = document.createElement('tr'); const heading = document.createElement('th'); const cell = document.createElement('td');
            heading.scope = 'row'; heading.textContent = name; cell.textContent = value; row.append(heading, cell); table.append(row);
        }
        container.append(table);
    }

    function showLessonChoices() {
        const trial = lesson.current();
        el('lesson-options').replaceChildren();
        if (!Array.isArray(trial.choices)) return;
        for (const answer of [...trial.choices, UNCLEAR_LETTER_ANSWER]) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'secondary';
            button.textContent = answer === UNCLEAR_LETTER_ANSWER ? 'I couldn’t tell' : answer;
            button.addEventListener('click', () => submitLessonAnswer(answer));
            el('lesson-options').append(button);
        }
    }

    function downloadReport(report, prefix) {
        const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `${prefix}-${report.seed}.json`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function prepareTrial() {
        el('evaluation-answer').value = '';
        el('evaluation-feedback').textContent = '';
        el('evaluation-options').replaceChildren();
        for (const choice of evaluation?.current()?.choices ?? []) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'secondary';
            button.textContent = choice;
            button.addEventListener('click', () => {
                if (!isBusy() && evaluation?.current()?.played) el('evaluation-answer').value = choice;
            });
            el('evaluation-options').append(button);
        }
        refresh();
    }

    async function render(run, label, onHeard, onFailed = null, onSettled = null, captureEvidence = false, archiveContext = null) {
        if (isBusy() || !isReady()) return;
        const controller = new AbortController();
        operation = controller;
        const generation = beginSynthesis();
        let completed = false;
        let savedCapture = null;
        let captureDrainRecorded = false;
        let archiveAttempted = false;
        setBusy(true);
        try {
            const evidenceModel = captureEvidence ? getModel() : null;
            const evidenceOutputRate = captureEvidence ? getOutputSampleRate() : null;
            const evidenceConfiguration = captureEvidence ? {
                source: PARTICLE_VOICE_EXPERIMENTAL_SOURCE,
                tuning: getTuningSnapshot(),
            } : null;
            const result = await run(controller.signal);
            if (controller.signal.aborted || generation !== telemetryGeneration) throw new DOMException('Listening playback cancelled.', 'AbortError');
            // The tract is constructed lazily by the first render. Project its
            // resolved config now, from the original model, never a replacement.
            if (evidenceConfiguration) evidenceConfiguration.configuration = voiceLabConfiguration(evidenceModel,
                { ready: true, outputSampleRate: evidenceOutputRate });
            recordSynthesis(result, generation);
            const audioIdentity = captureEvidence ? voiceLabAudioIdentity(result, { signal: controller.signal }) : null;
            // Stop can reject identity before playback unwinds; never leave that
            // rejection unobserved. Admission below still awaits its real result.
            audioIdentity?.catch(() => {});
            let audio = null;
            if (audioCapture && archiveContext) {
                audio = await audioIdentity;
                archiveAttempted = true;
                savedCapture = await audioCapture.capture(archiveContext.session, {
                    trialId: archiveContext.trialId, playId: archiveContext.playId,
                    pcm: result.pcm, sampleRate: result.sampleRate,
                    metadata: { ...archiveContext.metadata, ...evidenceConfiguration, audioIdentity: audio,
                        synthesis: structuredClone(telemetry.synthesis),
                        pronunciation: result.plan?.sequence ? pronunciationTrace(result.plan.sequence, result.wordBoundaries ?? result.plan.wordBoundaries) : null },
                });
            }
            if (controller.signal.aborted || generation !== telemetryGeneration) throw new DOMException('Listening playback cancelled.', 'AbortError');
            await play(result, label, controller.signal, generation);
            if (controller.signal.aborted || generation !== telemetryGeneration) throw new DOMException('Listening playback cancelled.', 'AbortError');
            // Hosts without an audio archive retain playback concurrent with hashing.
            if (audio === null) audio = await audioIdentity;
            if (controller.signal.aborted || generation !== telemetryGeneration) throw new DOMException('Listening playback cancelled.', 'AbortError');
            const evidence = captureEvidence ? Object.freeze({ ...evidenceConfiguration, audio,
                synthesis: telemetry.synthesis, playback: telemetry.playback, completedState: telemetry.state }) : null;
            if (savedCapture) {
                await audioCapture.settle(archiveContext.session, savedCapture.captureId, {
                    status: 'drained', metadata: { playback: structuredClone(telemetry.playback),
                        modelAudioFullyQueuedAndDrained: true, deviceOutputRecorded: false },
                });
                captureDrainRecorded = true;
            }
            if (controller.signal.aborted || generation !== telemetryGeneration) throw new DOMException('Listening playback cancelled.', 'AbortError');
            onHeard?.(result, evidence);
            completed = true;
            if (archiveContext) await saveAudioProgress(archiveContext.session, { ended: !!archiveContext.completeAfterPlayback });
        } catch (error) {
            failed(error, generation);
            onFailed?.(error);
            if (audioCapture && archiveContext) {
                if (!archiveAttempted) savedCapture = await audioCapture.capture(archiveContext.session, {
                    trialId: archiveContext.trialId, playId: archiveContext.playId, pcm: null, sampleRate: null,
                    metadata: { ...archiveContext.metadata,
                        unavailableReason: error?.name === 'AbortError' ? 'stopped-before-audio-capture' : 'synthesis-failed-before-audio-capture' },
                });
                if (savedCapture && !captureDrainRecorded) await audioCapture.settle(archiveContext.session, savedCapture.captureId, {
                    status: error?.name === 'AbortError' ? 'stopped' : 'error',
                    metadata: { playback: structuredClone(telemetry.playback), modelAudioFullyQueuedAndDrained: false,
                        playedPrefixSamples: null, deviceOutputRecorded: false },
                });
                await saveAudioProgress(archiveContext.session, { ended: !!archiveContext.completeAfterPlayback, incomplete: true });
            }
            // A frontend error can contain its input word. Evidence-producing
            // trials remain blinded even if cancellation changes active state.
            const reportedError = captureEvidence ? new Error('Synthesis or playback failed for this listening trial.') : error;
            status(error?.name === 'AbortError' ? 'Stopped. This trial was not counted as heard; replay it to answer.'
                : captureEvidence ? 'Playback failed. This trial was not counted as heard; replay it to answer.'
                    : `Diagnostic failed: ${error?.message ?? error}`);
            if (error?.name !== 'AbortError') onError(reportedError);
        } finally {
            if (operation === controller) operation = null;
            setBusy(false);
            refresh();
            if (completed && !controller.signal.aborted && generation === telemetryGeneration) onSettled?.();
        }
    }

    el('inspect-text').addEventListener('click', () => {
        if (isBusy() || active()) return;
        try {
            const preview = inspectText?.(el('text').value, g2p());
            const sequence = preview?.sequence ?? textToPhonemeSequence(normalizeText(el('text').value), { g2p: g2p() });
            trace(sequence);
            status(`Preview: ${preview?.renderPath ?? 'text'}. Timing appears after rendering each speech unit. Rule and context warnings are not confidence scores.`);
        } catch (error) { status(error.message); }
    });

    el('inspect-letter')?.addEventListener('click', () => {
        if (isBusy() || active() || typeof inspectLetter !== 'function') return;
        try {
            trace(inspectLetter());
            status('Preview: selected letter name, using the Say letter pronunciation. Timing appears after rendering.');
        } catch (error) { status(error.message); }
    });

    el('explicit-speak').addEventListener('click', () => {
        void render((signal) => getModel().speakSequence(explicitPhonemesToSequence(el('explicit-phones').value), { signal }), 'Explicit phoneme diagnostic', (result) => {
            trace(result.plan.sequence, result.wordBoundaries ?? result.plan.wordBoundaries);
            status('Spelling was bypassed; the existing prosody, articulation and tract still produced this audio.');
        });
    });

    el('override-preview').addEventListener('click', () => {
        try {
            const candidate = reviewPronunciationCandidate(el('override-word').value, el('override-phones').value);
            el('override-reviewed').checked = false;
            status(`Review only, not applied: ${candidate.word} → ${candidate.pronunciation}. Use explicit playback to listen before applying.`);
        } catch (error) { status(error.message); }
    });
    for (const id of ['override-word', 'override-phones']) el(id).addEventListener('input', () => { el('override-reviewed').checked = false; });
    el('override-apply').addEventListener('click', () => {
        try {
            const candidate = reviewPronunciationCandidate(el('override-word').value, el('override-phones').value);
            g2p().applyReviewedOverride(candidate, { reviewed: el('override-reviewed').checked });
            localG2p.applyReviewedOverride(candidate, { reviewed: true });
            el('override-reviewed').checked = false;
            status(`Applied ${candidate.word} in this lab session only. No model weights, acoustics, or held-out corpus were changed.`);
        } catch (error) { status(error.message); }
    });
    el('override-clear').addEventListener('click', () => {
        g2p().clearReviewedOverrides();
        localG2p.clearReviewedOverrides();
        status('Reviewed overrides cleared; authored defaults restored.');
    });

    el('evaluation-start').addEventListener('click', () => {
        if (isBusy() || active() || !isReady()) return;
        try {
            if (evaluation && !evaluationFinished) {
                evaluationFeedbackPanel.flush();
                void saveAudioProgress(evaluation, { ended: true });
            }
            evaluationFeedbackTrial = null; evaluationFinished = false;
            evaluation = new ListeningEvaluation({
                seed: crypto.getRandomValues(new Uint32Array(1))[0], listener: el('evaluation-listener').value,
                pairMode: el('evaluation-mode').value,
            });
            startAudioArchive(evaluation, 'evaluation');
            el('pronunciation-trace').textContent = 'Trace hidden during blind listening.';
            el('evaluation-report').textContent = '';
            prepareTrial();
            setBusy(false);
            status('Blind listening started: 20 minimal pairs and 50 held-out sentences. Nothing is uploaded; export is optional. Do not tune against this corpus.');
        } catch (error) { status(error.message); }
    });
    el('evaluation-play').addEventListener('click', () => {
        if (isBusy() || !blindActive() || !isReady()) return;
        evaluationFeedbackPanel.flush();
        evaluationFeedbackTrial = null;
        evaluationFeedbackPanel.refresh();
        const stimulus = evaluation?.stimulus();
        if (!stimulus) return;
        evaluation.beginPlayback();
        void render((signal) => stimulus.phonemes
            ? getModel().speakSequence(explicitPhonemesToSequence(stimulus.phonemes), { signal })
            : getModel().speak(stimulus.text, { signal }), 'Blind listening trial', (_result, evidence) => {
                evaluation.markPlayed(Object.freeze({ ...evidence, renderPath: stimulus.phonemes ? 'explicit-phonemes' : 'text-plan' }));
                status('Playback completed. Record what you heard; the target appears only after submission.');
            }, (error) => evaluation.failPlayback({ cancelled: error?.name === 'AbortError' }), null, true,
            audioTrialContext(evaluation, stimulus, stimulus.phonemes ? 'explicit-phonemes' : 'text-plan'));
    });
    el('evaluation-submit').addEventListener('click', () => {
        try {
            evaluationFeedbackPanel.flush();
            const answeredTrial = evaluation.current();
            const result = evaluation.submit(el('evaluation-answer').value);
            evaluationFeedbackTrial = answeredTrial;
            void saveAudioProgress(evaluation);
            prepareTrial();
            el('evaluation-feedback').textContent = `Recorded: “${result.answer}”. Target was “${result.target}”. ${result.errors} word edit error(s).`;
            el('evaluation-report').textContent = JSON.stringify({ ...evaluation.report(), results: undefined, feedback: undefined }, null, 2);
            setBusy(false);
        } catch (error) { status(error.message); }
    });
    el('evaluation-skip').addEventListener('click', () => {
        evaluationFeedbackPanel.flush();
        evaluationFeedbackTrial = null;
        if (evaluation.current()?.index === evaluation.current()?.total) evaluationFinished = true;
        evaluation.skip(); void saveAudioProgress(evaluation, { ended: !evaluation.current() }); prepareTrial(); setBusy(false);
    });
    el('evaluation-end').addEventListener('click', () => {
        evaluationFeedbackPanel.flush();
        while (evaluation.current()) evaluation.skip();
        evaluationFeedbackTrial = null; evaluationFinished = true;
        void saveAudioProgress(evaluation, { ended: true });
        prepareTrial();
        setBusy(false);
        el('evaluation-report').textContent = JSON.stringify({ ...evaluation.report(), results: undefined }, null, 2);
    });
    el('evaluation-export').addEventListener('click', () => {
        downloadReport(evaluation.report(), 'particle-voice-listening');
    });
    function setRepeatReport(report) {
        repeatReport = report;
        try { practiceFocusIds = ListeningEvaluation.suggestedFocusIds(report); }
        catch { practiceFocusIds = []; }
        const answered = report.results.filter((result) => !result.skipped);
        const missed = answered.filter((result) => !result.correct).length;
        if (el('lesson-baseline-status')) el('lesson-baseline-status').textContent = `${report.mode.replace('classroom-', '')}: ${answered.length} answered targets, ${missed} missed. ${scoringDescription(report)}. Repeat keeps the same targets, order, choices, pronunciation path, and scoring rules. Current voice settings are used.`;
    }

    function startLesson(nextLesson) {
        lesson = nextLesson;
        if (el('lesson-action-status')) el('lesson-action-status').textContent = '';
        lessonExposures = [];
        if (el('lesson-mode')) el('lesson-mode').value = lesson.mode;
        if (el('lesson-render-mode')) el('lesson-render-mode').value = lesson.pairMode;
        if (el('lesson-session-type')) el('lesson-session-type').value = lesson.sessionType ?? 'practice';
        lessonFinished = false;
        lessonReportSnapshot = null;
        lessonStartedAt = new Date().toISOString();
        startAudioArchive(lesson, 'classroom');
        el('lesson-results').hidden = true;
        el('lesson-json').value = '';
        el('lesson-measures')?.replaceChildren();
        if (el('lesson-warmup-status')) el('lesson-warmup-status').textContent = '';
        if (el('lesson-baseline-json')) el('lesson-baseline-json').value = '';
        el('lesson-copy-status').textContent = '';
        el('pronunciation-trace').textContent = lesson.mode === 'alphabet' ? 'Trace hidden during the alphabet lesson.' : 'Trace hidden during the listening lesson.';
        prepareLessonTrial();
        setBusy(false);
        status(onReport
            ? 'Listening lesson started. Completed results are saved locally for experiments. Other voice controls stay locked until the lesson ends.'
            : 'Listening lesson started. Nothing is saved or uploaded. Other voice and tuning controls are locked until the lesson ends.');
    }

    function newLesson(mode, { focusIds = [], sessionType = 'practice', seedText = '' } = {}) {
        const generated = Object.hasOwn(GENERATED_MODES, mode);
        if (seedText && (!/^\d{1,10}$/.test(seedText) || Number(seedText) > 0xffffffff)) throw new TypeError('Use a whole test number from 0 to 4294967295, or leave it blank.');
        // Freeze the complete block before playing it. Novel sentence evaluation
        // avoids text already played on this page; exact retests stay explicit.
        for (let attempt = 0; attempt < 100; attempt++) {
            const candidate = new ListeningEvaluation({ mode,
                pairMode: ['words', 'contrasts', 'balanced'].includes(mode) ? el('lesson-render-mode')?.value ?? 'text' : 'text',
                seed: seedText ? Number(seedText) : crypto.getRandomValues(new Uint32Array(1))[0],
                listener: el('lesson-listener').value.trim() || 'Local listener',
                ...(generated ? { sessionType, focusIds } : {}),
            });
            const fresh = !generated || sessionType !== 'evaluation' || !['generated', 'storylets'].includes(mode)
                || candidate.generatedLesson.manifest.trials.every(trial => !exposures.has(trial.text));
            if (fresh) return candidate;
            if (seedText) throw new TypeError('This evaluation includes wording already played on this page. Leave the test number blank for fresh wording, or use Repeat answered targets.');
        }
        throw new Error('Fresh material for this mode is exhausted on this page. Use an explicit retest or another mode.');
    }

    el('lesson-load-baseline')?.addEventListener('click', () => {
        if (isBusy() || active()) return;
        try {
            const text = el('lesson-baseline-json').value;
            if (text.length > 2_000_000) throw new TypeError('Use a practice report smaller than 2 MB.');
            let report;
            try { report = JSON.parse(text); } catch { throw new TypeError('Paste a complete practice report in JSON format.'); }
            ListeningEvaluation.repeatPractice(report, { listener: 'Local validation' });
            setRepeatReport(report);
            el('lesson-baseline-json').value = '';
            refresh();
        } catch (error) {
            repeatReport = null;
            practiceFocusIds = [];
            if (el('lesson-baseline-status')) el('lesson-baseline-status').textContent = error.message;
            refresh();
        }
    });
    for (const [id, selection] of [['lesson-repeat', 'answered'], ['lesson-missed', 'missed']]) {
        el(id)?.addEventListener('click', () => {
            if (isBusy() || active() || !isReady() || !repeatReport
                || (repeatReport.mode === 'classroom-alphabet' && typeof renderLetter !== 'function')) return;
            try { startLesson(ListeningEvaluation.repeatPractice(repeatReport, { selection,
                listener: el('lesson-listener').value.trim() || 'Local listener' })); }
            catch (error) { lessonStatus(error.message); }
        });
    }
    el('lesson-start')?.addEventListener('click', () => {
        const mode = el('lesson-mode')?.value ?? 'alphabet';
        if (isBusy() || active() || !isReady() || (mode === 'alphabet' && typeof renderLetter !== 'function')) return;
        try {
            // Only explicit new/repeat lesson actions replace classroom results.
            startLesson(newLesson(mode, { sessionType: el('lesson-session-type')?.value ?? 'practice',
                seedText: Object.hasOwn(GENERATED_MODES, mode) ? el('lesson-seed')?.value.trim() ?? '' : '' }));
        } catch (error) { lessonStatus(error.message); }
    });
    el('lesson-play')?.addEventListener('click', () => {
        if (isBusy() || !isReady() || !lessonActive() || lessonFeedback) return;
        lessonFeedbackPanel.flush();
        const session = lesson;
        const stimulus = session.stimulus();
        try { session.beginPlayback(); }
        catch (error) { lessonStatus(error.message); return; }
        el('lesson-options').replaceChildren();
        const renderPath = session.mode === 'alphabet' ? 'authored-letter-lexicon-text-plan'
            : stimulus.phonemes ? 'explicit-phonemes' : 'text-plan';
        void render((signal) => session.mode === 'alphabet' ? renderLetter(stimulus.text, signal)
            : stimulus.phonemes ? getModel().speakSequence(explicitPhonemesToSequence(stimulus.phonemes), { signal })
                : getModel().speak(stimulus.text, { signal }), 'Classroom sound', (_result, evidence) => {
            session.markPlayed(Object.freeze({
                ...evidence,
                renderPath,
                ...(session.generatedLesson ? { exposure: { scope: 'current-page-only', previousCompletedPresentations: exposures.get(stimulus.text) ?? 0 } } : {}),
                // Keep the actual frontend result in the completed report, not
                // in the visible runtime panel while its answer is hidden.
                ...(session.mode !== 'alphabet' && _result.plan?.sequence ? {
                    pronunciation: Object.freeze(pronunciationTrace(_result.plan.sequence).map((word) => Object.freeze({
                        text: word.text, source: word.source, phonemes: word.phonemes,
                        warnings: Object.freeze([...(word.warnings ?? [])]),
                    }))),
                } : {}),
            }));
            const trialIndex = session.current().index;
            if (session.generatedLesson && !lessonExposures.some(item => item.trialIndex === trialIndex)) {
                lessonExposures.push({ trialIndex, previousPresentations: exposures.get(stimulus.text) ?? 0 });
            }
            exposures.set(stimulus.text, (exposures.get(stimulus.text) ?? 0) + 1);
            showLessonChoices();
            status(!Array.isArray(session.current()?.choices) ? 'Sound finished. Write the words you heard, or choose I couldn’t tell.'
                : 'Sound finished. Choose what you heard, or I couldn’t tell.');
        }, (error) => {
            session.failPlayback({ cancelled: error?.name === 'AbortError' });
            el('lesson-feedback').textContent = 'That playback did not finish. Play the sound again before choosing.';
        }, () => {
            // Disabling Play during rendering drops keyboard focus to the body.
            // Wait until choices are visible/enabled, and never steal focus if
            // the listener deliberately moved to another control while waiting.
            const focused = document.activeElement;
            const answerTarget = !Array.isArray(session.current()?.choices) ? el('lesson-answer')
                : el('lesson-options').querySelector('button:not(:disabled)');
            if (session !== lesson || !lessonActive() || isBusy() || !isReady()
                || !answerTarget || answerTarget.disabled || lessonFeedback) return;
            if (!focused || focused === document.body || focused === el('lesson-play')) {
                answerTarget.focus();
            }
        }, true, audioTrialContext(session, stimulus, renderPath));
    });
    el('lesson-next')?.addEventListener('click', () => {
        if (isBusy() || !lessonFeedback) return;
        lessonFeedbackPanel.flush();
        if (!lesson.current()) finishLesson();
        else prepareLessonTrial();
    });
    el('lesson-mode')?.addEventListener('change', () => refresh());
    el('lesson-answer-form')?.addEventListener('submit', (event) => {
        event.preventDefault();
        if (lesson?.current() && !Array.isArray(lesson.current().choices)) submitLessonAnswer(el('lesson-answer').value.trim() || UNCLEAR_LETTER_ANSWER);
    });
    el('lesson-unclear')?.addEventListener('click', () => {
        if (lesson?.current() && !Array.isArray(lesson.current().choices)) submitLessonAnswer(UNCLEAR_LETTER_ANSWER);
    });
    el('lesson-keep-answer')?.addEventListener('click', () => {
        if (lesson?.current()?.initialRecorded) submitLessonAnswer(lessonInitialAnswer);
    });
    el('lesson-comprehension')?.addEventListener('change', refresh);
    el('lesson-session-type')?.addEventListener('change', refresh);
    el('lesson-adaptive')?.addEventListener('click', () => {
        const selectedMode = el('lesson-mode')?.value;
        if (isBusy() || active() || !isReady() || !practiceFocusIds.length
            || (Object.hasOwn(GENERATED_MODES, selectedMode) && el('lesson-session-type')?.value === 'evaluation')) return;
        const mode = selectedMode === 'storylets' ? 'storylets' : 'balanced';
        try { startLesson(newLesson(mode, { focusIds: practiceFocusIds })); }
        catch (error) { lessonStatus(error.message); }
    });
    el('lesson-warmup')?.addEventListener('click', () => {
        if (isBusy() || active() || !isReady()) return;
        const example = 'The cup is red.';
        const warmupSession = { mode: 'warmup', current: () => null,
            report: () => ({ schemaVersion: 'particle-voice-unscored-audio/v1', mode: 'warmup', text: example, unscored: true }) };
        startAudioArchive(warmupSession, 'warmup');
        el('lesson-warmup-status').textContent = `Unscored example: “${example}” Listen, then record what you hear in the real block. Smoothness is an optional separate rating.`;
        void render(signal => getModel().speak(example, { signal }), 'Unscored listening example', () => {
            exposures.set(example, (exposures.get(example) ?? 0) + 1);
            status('Unscored example complete. Start a block when ready.');
        }, null, null, true, { session: warmupSession, trialId: 'warmup-1', playId: 'warmup-play-1', completeAfterPlayback: true,
            metadata: { trialIndex: 1, attempt: 1, stimulus: { text: example }, unscored: true, renderPath: 'text-plan' } });
    });
    el('lesson-skip')?.addEventListener('click', () => {
        if (isBusy() || !lessonActive() || lessonFeedback) return;
        lessonFeedbackPanel.flush();
        lesson.skip();
        if (!lesson.current()) finishLesson();
        else { void saveAudioProgress(lesson); prepareLessonTrial(); }
    });
    el('lesson-end')?.addEventListener('click', () => {
        if (!isBusy() && lessonActive()) finishLesson();
    });
    el('lesson-copy')?.addEventListener('click', async () => {
        if (isBusy() || !lessonFinished) return;
        const report = lessonReportSnapshot;
        const text = el('lesson-json').value;
        try {
            const clipboard = document.defaultView?.navigator?.clipboard;
            if (!clipboard?.writeText) throw new Error('Clipboard unavailable');
            await clipboard.writeText(text);
            if (report !== lessonReportSnapshot || !lessonFinished) return;
            el('lesson-copy-status').textContent = 'Complete results JSON copied. Paste it into your conversation when you’re ready.';
        } catch {
            if (report !== lessonReportSnapshot || !lessonFinished) return;
            const reportDetails = el('lesson-json').closest('details');
            if (reportDetails) reportDetails.open = true;
            el('lesson-json').focus();
            el('lesson-json').select();
            el('lesson-copy-status').textContent = 'Automatic copy is unavailable. The complete JSON is selected below: press Ctrl+C (or Command+C).';
        }
    });
    el('lesson-download')?.addEventListener('click', () => {
        if (!isBusy() && lessonFinished) downloadReport(lessonReportSnapshot,
            lesson.mode === 'alphabet' ? 'particle-voice-alphabet-lesson' : `particle-voice-${lesson.mode}-practice`);
    });
    refresh();
    return Object.freeze({
        refresh, get evaluationActive() { return active(); },
        get classroomActive() { return lessonActive(); },
        beginSynthesis, recordSynthesis, recordPronunciation, playbackState, finishPlayback, failed,
        cancel() {
            telemetryGeneration += 1;
            operation?.abort();
            playbackState('stopped');
        },
        syncOverrides() {
            const model = getModel();
            if (model) for (const candidate of localG2p.reviewedOverrides.values()) model.g2p.applyReviewedOverride(candidate, { reviewed: true });
            refreshRuntime();
        },
    });
}
