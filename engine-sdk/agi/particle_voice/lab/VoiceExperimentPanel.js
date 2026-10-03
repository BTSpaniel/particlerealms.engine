// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { decodeVoiceReference } from './VoiceExperimentStore.js';
import { mountVoiceReferenceInspector, intendedVoiceTimeline } from './VoiceReferenceInspector.js';

/** Saved, bounded experiments over the host's existing model and audio owner.
 * Targets are deliberately absent from the review DOM. Inspection is an explicit
 * exposure operation, and preference listening follows locked transcriptions.
 */
export function mountVoiceExperimentPanel({
    container, store, runner, play, isReady, isBusy, isEvaluationActive,
    setBusy, onError = () => {}, audioContext, evaluatorType = 'human', startAudio = null,
}) {
    if (!container?.ownerDocument || container.childNodes.length) {
        throw new TypeError('Voice experiments require an empty host container.');
    }
    for (const callback of [play, isReady, isBusy, isEvaluationActive, setBusy, onError]) {
        if (typeof callback !== 'function') throw new TypeError('Voice experiments require host lifecycle callbacks.');
    }
    if (!store || !runner) throw new TypeError('Voice experiments require the shared experiment store and runner.');
    if (startAudio !== null && typeof startAudio !== 'function') throw new TypeError('Audio setup must use the host callback.');
    if (!['human', 'automated-test'].includes(evaluatorType)) throw new TypeError('Unsupported experiment evaluator type.');
    const document = container.ownerDocument;
    const events = new AbortController();
    const downloads = new Set();
    const optionCache = new WeakMap();
    let disposed = false, working = false, reviewing = false, revisiting = false, playing = false, operation = null;
    let currentId = null, priorReport = null, listedId = null, listRequest = 0;
    let displayedTrial = null, displayedInspection = null, preferenceKey = null;
    let pairs = [], saved = [], persistedSelection = null, inspectableIds = [], variantIds = [];
    let inspectedAudio = null, inspectedPlan = null, inspectedTrial = null, loadedReference = null, loadedReferenceIndex = null;
    let inspectorPair = null, diagnosticPlaying = false;
    const controls = new Map();
    const root = node('section', null, 'voice-experiments');
    root.setAttribute('aria-label', 'Saved voice experiments');
    const style = node('style');
    style.textContent = `
      .voice-experiments{display:grid;gap:14px;padding:24px;border:1px solid var(--line,#dce2d9);border-radius:18px;background:var(--card,#fffefa);min-width:0;color:var(--ink,#213d3a)}
      .voice-experiments *{box-sizing:border-box}.voice-experiments [hidden]{display:none!important}
      .voice-experiments h2{font-size:1.4rem}.voice-experiments h3{font-size:1.08rem}
      .voice-experiments p{font-size:.85rem;line-height:1.5;overflow-wrap:anywhere}
      .voice-experiments .experiment-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
      .voice-experiments .experiment-row>*{min-width:0}.voice-experiments .experiment-field{display:grid;gap:5px;min-width:0;flex:1 1 200px;font-size:.82rem}
      .voice-experiments .experiment-field input,.voice-experiments select,.voice-experiments textarea{width:100%;max-width:100%;min-width:0}
      .voice-experiments input[type=number]{border:1px solid #d4ddd1;background:var(--card,#fffefa);color:var(--ink,#213d3a);border-radius:10px;min-height:44px;padding:10px 12px}
      .voice-experiments .experiment-check{display:flex;align-items:flex-start;gap:8px;font-size:.82rem}
      .voice-experiments .experiment-check input{flex:0 0 auto}.voice-experiments input[type=file]{font-size:.8rem;overflow:hidden}
      .voice-experiments .experiment-box{display:grid;gap:10px;padding:15px;border:1px solid var(--line,#dce2d9);border-radius:12px;min-width:0}
      .voice-experiments .experiment-review{background:var(--mint,#eaf2e9)}.voice-experiments details>summary{cursor:pointer;font-weight:650;font-size:.9rem}
      .voice-experiments details[open]>summary{margin-bottom:12px}.voice-experiments pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:360px;overflow:auto;font-size:.72rem;padding:12px;background:#f1f3ed;border-radius:8px;margin:0}
      .voice-experiments progress{width:100%;height:12px;accent-color:var(--teal,#176a5d)}
      .voice-experiments canvas{width:100%;height:260px;display:block;border:1px solid var(--line,#dce2d9);border-radius:9px;background:#fafcf7}
      .voice-experiments button{min-height:44px}.voice-experiments [role=alert]{color:#922e26}
      .voice-experiments .experiment-actions{display:flex;gap:8px;flex-wrap:wrap}.voice-experiments .experiment-muted{font-size:.76rem}
      .voice-experiments .experiment-steps{display:flex;flex-wrap:wrap;gap:8px;list-style:none;padding:0;margin:0;font-size:.8rem}
      .voice-experiments .experiment-steps li{border-radius:24px;padding:7px 11px;background:var(--mint,#eaf2e9);color:var(--muted,#58716a)}
      .voice-experiments .experiment-steps [aria-current=step]{background:var(--teal,#176a5d);color:#fff;font-weight:700}
      .voice-experiments .experiment-guide{display:grid;gap:10px;padding:16px;background:var(--mint,#eaf2e9);border-radius:12px}
      .voice-experiments .experiment-guide p,.voice-experiments .experiment-review p{margin:0}
      .voice-experiments .experiment-guidance{font-size:1rem;font-weight:650}
      .voice-experiments .experiment-answer-saved{padding:10px 12px;border-radius:8px;background:#fffefa}
      @media(max-width:480px){.voice-experiments{padding:16px}.voice-experiments .experiment-row>button{flex:1 1 130px}.voice-experiments .experiment-box{padding:12px}}
    `;
    container.append(style, root);
    root.append(node('h2', 'Compare voice changes'), node('p',
        'Listen to the same examples with small sound changes. Your audio and answers stay saved here. These comparisons do not change the live voice.'));
    const steps = node('ol', null, 'experiment-steps'); steps.setAttribute('aria-label', 'Comparison steps');
    const stepItems = ['1. Choose a comparison', '2. Prepare audio', '3. Listen & answer'].map(text => node('li', text));
    steps.append(...stepItems); root.append(steps);
    const guide = node('div', null, 'experiment-guide'); root.append(guide);
    const guidance = node('p', 'Choose a saved comparison or create one.', 'experiment-guidance'); guidance.dataset.experiment = 'guidance';
    const progress = node('progress'); progress.max = 1; progress.value = 0;
    progress.setAttribute('aria-label', 'Completed candidate renders');
    const status = node('p', 'Loading saved experiments.'); status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite'); status.dataset.experiment = 'status';
    const enableAudio = button(guide, 'Enable audio', 'audio-start');
    guide.prepend(guidance, status, progress);
    const error = node('p'); error.setAttribute('role', 'alert'); error.hidden = true; root.append(error);

    const chooser = details(root, 'Choose a comparison'); chooser.open = true;
    const chooserRow = row(chooser);
    const picker = select(chooserRow, 'Saved experiment', 'picker');
    const loadButton = button(chooserRow, 'Open saved', 'load', true); loadButton.hidden = true;
    const createButton = button(chooserRow, 'Create K comparison', 'create');
    const importFile = input(chooserRow, 'Import comparison ZIP', 'import-file', 'file');
    importFile.accept = '.zip,.pvexp,application/zip,application/octet-stream';
    const setup = details(root, 'Comparison settings (optional)');
    const setupRow = row(setup);
    const label = input(setupRow, 'Experiment label', 'label', 'text');
    label.value = 'K release and entry'; label.maxLength = 100;
    const seed = input(setupRow, 'Repeatable experiment number (optional)', 'seed', 'text');
    seed.inputMode = 'numeric'; seed.maxLength = 10;
    const reportFile = input(setup, 'Earlier listening report (optional JSON)', 'report-file', 'file');
    reportFile.accept = '.json,.txt,application/json,text/plain';
    const reportStatus = node('p', 'Without a file, the latest archived listening report is used when available.', 'experiment-muted');
    setup.append(reportStatus);

    const renderRow = row(root);
    const renderButton = button(renderRow, 'Prepare comparison audio', 'render');
    const pauseButton = button(renderRow, 'Pause', 'pause', true);
    const cancelButton = button(renderRow, 'Cancel', 'cancel', true);

    const review = node('section', null, 'experiment-box experiment-review');
    review.setAttribute('aria-label', 'Blind transcription review');
    review.append(node('h3', 'Listen, then write what you hear'), node('p',
        'The words stay hidden so you can judge the sound. Your first answer is saved before any replay. “I could not tell” is a useful answer.'));
    const listenerDetails = details(review, 'Listener name (optional)');
    const listener = input(listenerDetails, 'Listener name', 'listener', 'text'); listener.maxLength = 80;
    const reviewStatus = node('p', 'Prepare audio to begin.');
    reviewStatus.dataset.experiment = 'review-status'; reviewStatus.setAttribute('role', 'status');
    review.append(reviewStatus);
    const reviewProgress = node('progress'); reviewProgress.setAttribute('aria-label', 'First listening answers saved'); review.append(reviewProgress);
    const reviewRow = row(review);
    const startReview = button(reviewRow, 'Start listening review', 'review-start');
    const endReview = button(reviewRow, 'Save & leave review', 'review-end', true);
    const listenButton = button(review, 'Play sound', 'listen');
    const stopReviewAudio = button(review, 'Stop sound', 'review-stop', true);
    const answer = textarea(review, 'Words you heard', 'answer', 2); answer.maxLength = 2000;
    answer.autocomplete = 'off'; answer.spellcheck = false;
    const unclear = checkbox(review, 'I could not tell', 'unclear');
    const responseRow = row(review);
    const submit = button(responseRow, 'Save first answer', 'answer-submit');
    const next = button(responseRow, 'Next sound', 'next');
    const savedAnswer = node('p', '', 'experiment-answer-saved'); savedAnswer.dataset.experiment = 'saved-answer'; review.append(savedAnswer);
    const keyboardHelp = node('p', 'Enter saves your answer · Shift+Enter adds a line', 'experiment-muted'); review.append(keyboardHelp);
    root.append(review);

    const preference = details(root, 'Compare clarity and naturalness separately');
    preference.append(node('p', 'Pairs become available after both first transcriptions are locked. A and B remain anonymous. A tie or neither acceptable is a valid judgment.'));
    const pairPicker = select(preference, 'Sound pair', 'pair');
    const pairRow = row(preference);
    const playA = button(pairRow, 'Play A', 'play-a', true);
    const playB = button(pairRow, 'Play B', 'play-b', true);
    const dimensionRow = row(preference);
    const clarity = preferenceSelect(dimensionRow, 'Which is clearer?', 'clarity');
    const naturalness = preferenceSelect(dimensionRow, 'Which sounds more natural?', 'naturalness');
    const savePreference = button(preference, 'Save separate preferences', 'preference-submit');
    const preferenceStatus = node('p', '', 'experiment-muted'); preference.append(preferenceStatus);

    const inspection = details(root, 'Preview saved sounds & reference audio');
    inspection.append(node('p', 'Preview reveals the intended words. Finish your listening review first for answers without clues. Previewing is recorded separately from a blind first listen.'));
    const inspectionPicker = select(inspection, 'Trial to inspect', 'inspect-picker');
    const inspectionRow = row(inspection);
    const inspectButton = button(inspectionRow, 'Show sound & words', 'inspect', true);
    const playGenerated = button(inspectionRow, 'Preview sound & words', 'generated-play');
    const previewText = node('p', '', 'experiment-guidance'); previewText.dataset.experiment = 'preview-text'; inspection.append(previewText);
    const technical = details(inspection, 'Technical details');
    const capabilitiesButton = button(technical, 'Show capabilities', 'capabilities', true);
    const inspectionOutput = node('pre'); inspectionOutput.dataset.experiment = 'inspection';
    const referencePicker = select(inspection, 'Saved reference recording', 'reference-picker');
    const referenceActions = row(inspection);
    const showReference = button(referenceActions, 'Show reference waveform', 'reference-show', true);
    const playReference = button(referenceActions, 'Play reference', 'reference-play', true);
    const addReferenceHere = button(inspection, 'Add reference recording', 'reference-add', true);
    const inspectorHost = node('div'); inspectorHost.dataset.experiment = 'reference-inspector'; inspection.append(inspectorHost);
    const alignmentRow = row(inspection);
    const saveAlignment = button(alignmentRow, 'Save inspected regions', 'comparison-save');
    const restoreAlignment = button(alignmentRow, 'Restore saved regions', 'comparison-restore', true);
    const stopDiagnostic = button(alignmentRow, 'Stop region preview', 'diagnostic-stop', true);
    const alignmentStatus = node('p', '', 'experiment-muted'); alignmentStatus.dataset.experiment = 'comparison-status';
    alignmentStatus.setAttribute('role', 'status'); inspection.append(alignmentStatus);
    const referenceInspector = mountVoiceReferenceInspector({ container: inspectorHost,
        onSelection: () => { alignmentStatus.textContent = 'Region changes are ready to inspect. Save to keep the regions and current alignment with this comparison.'; refresh(); },
        onAnchor: () => { alignmentStatus.textContent = referenceInspector.getSelection().alignmentEnabled
            ? 'Manual alignment updated. Save inspected regions to keep these anchors.'
            : 'Recording starts restored. Save inspected regions to keep this view without an alignment offset.'; refresh(); },
        onSettings: () => { alignmentStatus.textContent = 'Analysis settings updated. Save inspected regions to preserve this view.'; },
        onAudition: auditionRegion, onError: fail });
    const annotations = details(inspection, 'Mark words or sounds in the reference (advanced)');
    annotations.append(node('p',
        'Enter a region in seconds from the recording start. This saves your manual annotation and its exact sample positions; the original recording stays intact.'));
    const annotationLabel = input(annotations, 'Word, phone or event label', 'annotation-label', 'text'); annotationLabel.maxLength = 120;
    const annotationRow = row(annotations);
    const annotationType = select(annotationRow, 'Boundary type', 'annotation-type');
    options(annotationType, [['word', 'Word'], ['phone', 'Phone'], ['event', 'Event']]);
    const annotationStart = input(annotationRow, 'Start (seconds)', 'annotation-start', 'number'); annotationStart.min = '0'; annotationStart.step = '0.001';
    const annotationEnd = input(annotationRow, 'End (seconds)', 'annotation-end', 'number'); annotationEnd.min = '0'; annotationEnd.step = '0.001';
    const annotationConfidence = input(annotations, 'Confidence from 0 to 1 (optional)', 'annotation-confidence', 'number');
    annotationConfidence.min = '0'; annotationConfidence.max = '1'; annotationConfidence.step = '0.05';
    const saveAnnotation = button(annotations, 'Save manual boundary', 'annotation-save');
    const annotationStatus = node('p', '', 'experiment-muted'); annotationStatus.dataset.experiment = 'annotation-status';
    annotations.append(annotationStatus); technical.append(inspectionOutput); inspection.append(annotations, technical);

    const reference = details(root, 'Add a reference recording (optional)');
    reference.append(node('p', 'Import a recording you are authorized to use, together with its corrected transcript. The original file is preserved locally. Importing does not train a voice or infer corrected alignment.'));
    const referenceFile = input(reference, 'Reference audio file', 'reference-file', 'file');
    referenceFile.accept = 'audio/*,.wav,.mp3,.flac,.ogg,.m4a';
    const transcript = textarea(reference, 'Corrected recording transcript', 'reference-transcript', 2); transcript.maxLength = 8000;
    const authorized = checkbox(reference, 'I am authorized to use this recording for this experiment.', 'reference-authorized');
    const referenceSource = input(reference, 'Recording source / authorization note', 'reference-source', 'text');
    referenceSource.maxLength = 1000;
    const saveReference = button(reference, 'Save reference locally', 'reference-save');
    const referenceStatus = node('p', '', 'experiment-muted'); reference.append(referenceStatus);

    const exchange = details(root, 'Download & back up this comparison');
    exchange.append(node('p', 'Both downloads contain the intended answers, settings and saved judgments. Reading them can affect later blind judgments. Choose WAVs for playable clips or the experiment bundle for restoring the comparison. Nothing is uploaded.'));
    const exportButton = button(exchange, 'Download experiment bundle', 'export', true);
    const exportWavButton = button(exchange, 'Download WAVs + results', 'export-wav');

    const acceptance = details(root, 'Review a candidate for this lab');
    acceptance.append(node('p', 'Acceptance records a preferred experiment configuration in this lab. It requires matched human evidence and transfer/protected checks. The live production voice is not replaced. Rollback restores the previous accepted lab selection.'));
    const candidate = select(acceptance, 'Reviewed candidate', 'candidate');
    const reason = textarea(acceptance, 'Review or rollback reason', 'reason', 2); reason.maxLength = 2000;
    const acceptRow = row(acceptance);
    const acceptButton = button(acceptRow, 'Accept for this lab', 'accept');
    const rollbackButton = button(acceptRow, 'Roll back lab selection', 'rollback', true);
    const acceptanceStatus = node('p', '', 'experiment-muted'); acceptance.append(acceptanceStatus);

    function node(tag, text, className) {
        const element = document.createElement(tag);
        if (text != null) element.textContent = text;
        if (className) element.className = className;
        return element;
    }
    function row(parent) { const element = node('div', null, 'experiment-row'); parent.append(element); return element; }
    function details(parent, title) {
        const element = node('details', null, 'experiment-box'); element.append(node('summary', title)); parent.append(element); return element;
    }
    function field(parent, title, control, key) {
        control.dataset.experiment = key;
        control.setAttribute('aria-label', title);
        const label = node('label', null, 'experiment-field'); label.append(node('span', title), control);
        parent.append(label); controls.set(key, control); return control;
    }
    function input(parent, title, key, type) { const element = node('input'); element.type = type; return field(parent, title, element, key); }
    function textarea(parent, title, key, rows) { const element = node('textarea'); element.rows = rows; return field(parent, title, element, key); }
    function select(parent, title, key) { return field(parent, title, node('select'), key); }
    function checkbox(parent, title, key) {
        const label = node('label', null, 'experiment-check'), element = node('input'); element.type = 'checkbox';
        element.dataset.experiment = key; label.append(element, node('span', title)); parent.append(label); controls.set(key, element); return element;
    }
    function button(parent, title, key, secondary = false) {
        const element = node('button', title, secondary ? 'secondary' : null); element.type = 'button';
        element.dataset.experiment = key; controls.set(key, element); parent.append(element); return element;
    }
    function preferenceSelect(parent, title, key) {
        const element = select(parent, title, key);
        options(element, [['', 'Choose after listening'], ['left', 'A'], ['right', 'B'], ['tie', 'No meaningful difference'], ['neither', 'Neither acceptable']]);
        return element;
    }
    function options(element, values) {
        const previous = element.value;
        const signature = JSON.stringify(values);
        if (optionCache.get(element) === signature) return;
        element.replaceChildren(...values.map(([value, text]) => { const option = node('option', text); option.value = value; return option; }));
        optionCache.set(element, signature);
        if (values.some(([value]) => value === previous)) element.value = previous;
    }
    function handle(element, type, callback) {
        element.addEventListener(type, event => {
            Promise.resolve().then(() => callback(event)).catch(fail);
        }, { signal: events.signal });
    }
    function fail(problem) {
        if (disposed || problem?.name === 'AbortError') return;
        const message = String(problem?.message ?? problem);
        error.textContent = message; error.hidden = false;
        error.tabIndex = -1; error.focus({ preventScroll: true }); error.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        console.error('[VoiceExperimentPanel]', message);
        onError(problem);
        refresh();
    }
    function clearError() { error.textContent = ''; error.hidden = true; }
    function blocked() { return disposed || working || isBusy() || isEvaluationActive(); }
    function snapshot() { return runner.snapshot(); }
    function currentTrial() { return snapshot()?.trials?.find(trial => trial.id === currentId) ?? null; }
    function firstResponse(trial) { return trial?.responses?.[0] ?? null; }
    function hasPlayed(trial) { return !!trial?.plays?.some(receipt => receipt.state === 'drained' || receipt.completedState === 'drained'); }
    function answerAvailable(trial) {
        return trial?.plays?.at(-1)?.state === 'drained'
            && !trial.responses.some(response => response.playIndex === trial.plays.length - 1);
    }
    function queue() { return runner.reviewQueue(); }
    async function perform(label, action, { ready = false } = {}) {
        if (blocked()) return;
        if (ready && !isReady()) throw new Error('Select Enable audio before preparing or listening.');
        clearError(); working = true; operation = new AbortController();
        setBusy(true); refresh(); status.textContent = label;
        try { return await action(operation.signal); }
        finally {
            working = false; operation = null;
            setBusy(false);
            if (!disposed) refresh();
        }
    }
    handle(enableAudio, 'click', async () => {
        if (blocked()) return;
        if (startAudio) await startAudio();
        else {
            const hostStart = document.querySelector('#start');
            hostStart?.scrollIntoView({ block: 'center', behavior: 'smooth' }); hostStart?.focus();
        }
        refresh();
    });
    function reviewChanged() {
        displayedTrial = null;
        // Host refreshes other controls even though review itself is not a render.
        setBusy(false); refresh();
    }
    async function playTrial(id, signal) {
        const audio = await runner.audio(id);
        if (signal.aborted) throw new DOMException('Experiment playback cancelled.', 'AbortError');
        let receipt;
        playing = true; refresh();
        try {
            receipt = await play(audio, { signal });
            if (signal.aborted) throw new DOMException('Experiment playback cancelled.', 'AbortError');
            if (receipt?.state !== 'drained') throw new Error('Playback did not finish; no listening answer was unlocked.');
        } catch (problem) {
            await runner.recordPlay(id, { state: signal.aborted || problem?.name === 'AbortError' ? 'stopped' : 'error',
                message: String(problem?.message ?? problem).slice(0, 500) });
            throw problem;
        } finally {
            playing = false; refresh();
        }
        await runner.recordPlay(id, receipt);
    }
    function chooseNext() {
        const ids = queue();
        const unanswered = ids.find(id => !firstResponse(snapshot().trials.find(trial => trial.id === id)));
        currentId = unanswered ?? ids[(ids.indexOf(currentId) + 1) % Math.max(1, ids.length)] ?? null;
        displayedTrial = null;
    }

    handle(createButton, 'click', () => perform('Freezing the experiment and its controls.', async () => {
        const numericSeed = seed.value.trim();
        if (numericSeed && (!/^\d{1,10}$/.test(numericSeed) || Number(numericSeed) > 0xffffffff)) {
            throw new RangeError('The experiment number must be an integer from 0 to 4294967295.');
        }
        const configuration = { label: label.value.trim() || 'K release and entry' };
        if (numericSeed) configuration.seed = Number(numericSeed);
        if (priorReport) configuration.report = priorReport;
        await runner.create(configuration);
        reviewing = false; currentId = null; displayedInspection = null; inspectionOutput.textContent = '';
        await reloadSaved();
    }, { ready: true }));
    handle(reportFile, 'change', () => perform('Validating the earlier listening report.', async () => {
        const file = reportFile.files?.[0];
        if (!file) { priorReport = null; reportStatus.textContent = 'Latest archived report will be used when available.'; return; }
        if (file.size > 8 * 1024 * 1024) throw new RangeError('Listening reports must be smaller than 8 MiB.');
        priorReport = null;
        const parsed = JSON.parse(await file.text());
        await runner.archiveReport(parsed);
        priorReport = parsed;
        reportStatus.textContent = `Validated and archived: ${file.name}.`;
    }));
    async function loadSelected() {
        const selectedId = picker.value;
        return perform('Loading the saved experiment.', async () => {
        if (!selectedId) return;
        await runner.load(selectedId); reviewing = false; currentId = null;
        displayedInspection = null; inspectionOutput.textContent = '';
        });
    }
    handle(picker, 'change', loadSelected);
    handle(loadButton, 'click', loadSelected);
    handle(renderButton, 'click', () => perform('Preparing audio. Each finished sound is saved automatically.',
        () => runner.run(), { ready: true }));
    handle(pauseButton, 'click', () => { runner.pause(); status.textContent = 'Pausing after the current render checkpoint.'; refresh(); });
    handle(cancelButton, 'click', cancel);
    handle(startReview, 'click', () => {
        if (blocked() || !isReady() || !queue().length) return;
        revisiting = queue().every(id => firstResponse(snapshot().trials.find(trial => trial.id === id)));
        reviewing = true; chooseNext(); inspectionOutput.textContent = ''; displayedInspection = null;
        inspectedAudio = null; inspectedPlan = null; inspectedTrial = null;
        loadedReference = null; loadedReferenceIndex = null; drawWaveforms();
        reviewChanged();
        listenButton.focus(); review.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
    handle(endReview, 'click', () => { if (working) return; reviewing = false; reviewChanged(); });
    handle(stopReviewAudio, 'click', () => operation?.abort());
    handle(listenButton, 'click', async () => {
        await perform('Playing the saved sound.', async signal => {
        const trial = currentTrial();
        if (!trial || !reviewing || (hasPlayed(trial) && !firstResponse(trial))) return;
        await playTrial(trial.id, signal);
        }, { ready: true });
        if (reviewing && !answer.disabled) answer.focus();
    });
    handle(submit, 'click', async () => {
        await perform('Saving your listening answer.', async () => {
        const trial = currentTrial();
        if (!reviewing || !hasPlayed(trial)) return;
        if (!unclear.checked && !answer.value.trim()) throw new Error('Type what you heard or choose unclear.');
        await runner.respond(trial.id, { transcript: unclear.checked ? '' : answer.value.trim(),
            unclear: unclear.checked, listener: listener.value.trim() || 'Local listener', evaluatorType });
        displayedTrial = null;
        });
        if (!next.disabled) next.focus();
    });
    answer.addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
            event.preventDefault(); if (!submit.disabled) submit.click();
        }
    }, { signal: events.signal });
    handle(next, 'click', () => {
        if (blocked() || !firstResponse(currentTrial())) return;
        const record = snapshot();
        if (!revisiting && queue().every(id => firstResponse(record.trials.find(trial => trial.id === id)))) {
            reviewing = false; currentId = null; reviewChanged();
            startReview.focus();
        } else { chooseNext(); refresh(); listenButton.focus(); }
    });
    handle(unclear, 'change', refresh);
    handle(pairPicker, 'change', () => { clarity.value = ''; naturalness.value = ''; preferenceKey = pairPicker.value; refresh(); });
    for (const [element, side] of [[playA, 'left'], [playB, 'right']]) {
        handle(element, 'click', () => perform(`Playing comparison ${side === 'left' ? 'A' : 'B'}.`, async signal => {
            const pair = pairs.find(item => item.id === pairPicker.value);
            if (pair) await playTrial(pair[side], signal);
        }, { ready: true }));
    }
    handle(savePreference, 'click', () => perform('Saving separate clarity and naturalness judgments.', async () => {
        const pair = pairs.find(item => item.id === pairPicker.value);
        if (!pair || !clarity.value || !naturalness.value) throw new Error('Choose both clarity and naturalness judgments.');
        for (const [dimension, element] of [['clarity', clarity], ['naturalness', naturalness]]) {
            await runner.preference({ leftTrialId: pair.left, rightTrialId: pair.right, choice: element.value,
                dimension, evaluatorType, listener: listener.value.trim() || 'Local listener' });
        }
        preferenceStatus.textContent = 'Both judgments saved independently.';
    }));
    async function inspectSelected(signal) {
        if (reviewing) throw new Error('Save and leave the listening review before inspecting intended sounds.');
        const id = inspectableIds[Number(inspectionPicker.value)];
        if (!id) return;
        const { trial: record, plan } = await runner.inspectPlan(id);
        const audio = await runner.audio(id);
        if (disposed || signal?.aborted) throw new DOMException('Inspection cancelled.', 'AbortError');
        displayedInspection = id;
        const condition = snapshot().manifest.variants.findIndex(variant => variant.id === record.variantId) + 1;
        inspectionOutput.textContent = JSON.stringify({ ...record, labCondition: `Condition ${condition}` }, null, 2);
        previewText.textContent = `${record.text} · Condition ${condition}`;
        inspectedAudio = audio; inspectedPlan = plan; inspectedTrial = record;
        drawWaveforms();
        return id;
    }
    handle(inspectionPicker, 'change', () => {
        inspectedAudio = null; inspectedPlan = null; inspectedTrial = null; displayedInspection = null;
        previewText.textContent = ''; inspectionOutput.textContent = ''; drawWaveforms(); refresh();
    });
    handle(inspectButton, 'click', () => perform('Showing the saved sound and recording that its words were revealed.', inspectSelected));
    handle(playGenerated, 'click', () => perform('Previewing the saved sound with its words revealed.', async signal => {
        const id = await inspectSelected(signal);
        if (id) await playTrial(id, signal);
    }, { ready: true }));
    handle(capabilitiesButton, 'click', () => {
        const record = snapshot();
        if (blocked() || !record) return;
        displayedInspection = 'capability';
        inspectionOutput.textContent = JSON.stringify(record.manifest.capability, null, 2);
    });
    handle(acceptButton, 'click', () => perform('Checking the candidate review gates.', async () => {
        if (!reason.value.trim()) throw new Error('Record why this candidate should be accepted for the lab.');
        const receipt = await runner.accept(variantIds[Number(candidate.value)], { reason: reason.value.trim() });
        acceptanceStatus.textContent = `Accepted lab selection saved. ${JSON.stringify(receipt)}`;
        await reloadSaved();
    }));
    handle(candidate, 'change', refresh);
    handle(saveReference, 'click', () => perform('Preserving and analyzing the authorized recording.', async () => {
        const file = referenceFile.files?.[0];
        if (!file) throw new Error('Choose the reference recording first.');
        if (!authorized.checked) throw new Error('Confirm that you are authorized to use this recording.');
        if (!transcript.value.trim()) throw new Error('Add the corrected transcript for this recording.');
        const context = typeof audioContext === 'function' ? audioContext() : audioContext;
        if (!context) throw new Error('Select Enable audio before adding a reference recording.');
        const imported = await decodeVoiceReference(file, { audioContext: context,
            transcript: transcript.value.trim(), authorization: referenceSource.value.trim() || true });
        await runner.addReference(imported);
        referenceStatus.textContent = `Saved ${file.name}: ${Number(imported.reference.durationSeconds).toFixed(2)} seconds. Original audio and transcript preserved; alignment is not inferred.`;
        referenceFile.value = ''; authorized.checked = false;
    }));
    handle(addReferenceHere, 'click', () => {
        if (blocked() || reviewing) return;
        reference.open = true;
        referenceFile.scrollIntoView({ block: 'center', behavior: 'smooth' }); referenceFile.focus({ preventScroll: true });
    });
    handle(exportButton, 'click', () => perform('Packaging the saved records and binary audio.', async () => {
        const record = snapshot();
        if (!record) return;
        const bundle = await store.exportExperiment(record.id);
        download(bundle, `${record.id}.zip`);
    }));
    handle(exportWavButton, 'click', () => perform('Packaging standard WAV clips with their answers and settings.', async () => {
        const record = snapshot();
        if (!record) return;
        download(await runner.exportAudio(), `${record.id}-audio-and-results.zip`);
    }));
    handle(importFile, 'change', () => perform('Validating and restoring the experiment bundle.', async () => {
        const file = importFile.files?.[0];
        if (!file) return;
        const id = await store.importExperiment(file);
        await runner.load(id);
        reviewing = false; currentId = null; displayedInspection = null; inspectionOutput.textContent = '';
        await reloadSaved();
        importFile.value = '';
    }));
    handle(rollbackButton, 'click', () => perform('Restoring the previous accepted lab selection.', async () => {
        if (!reason.value.trim()) throw new Error('Record the rollback reason.');
        const receipt = await runner.rollback({ reason: reason.value.trim() });
        acceptanceStatus.textContent = `Lab selection restored. ${JSON.stringify(receipt)}`;
        await reloadSaved();
    }));

    function refresh() {
        if (disposed) return;
        const record = snapshot(), occupied = working || isBusy() || isEvaluationActive();
        const trials = record?.trials ?? [], completed = trials.filter(trial => trial.state === 'completed');
        const failed = trials.filter(trial => trial.state === 'failed');
        const selectedChanged = record?.id !== listedId;
        if (selectedChanged) {
            listedId = record?.id ?? null; reviewing = false; currentId = null; displayedTrial = null;
            inspectionOutput.textContent = ''; displayedInspection = null; preferenceKey = null;
            referenceStatus.textContent = ''; acceptanceStatus.textContent = '';
            inspectedAudio = null; inspectedPlan = null; inspectedTrial = null;
            loadedReference = null; loadedReferenceIndex = null; inspectorPair = null;
            drawWaveforms(); annotationStatus.textContent = ''; previewText.textContent = ''; alignmentStatus.textContent = '';
            chooser.open = !record;
        }
        const ids = queue();
        const trial = currentTrial(), response = firstResponse(trial);
        const answered = ids.filter(id => firstResponse(trials.find(item => item.id === id))).length;
        const allAnswered = !!ids.length && answered === ids.length;
        const preparing = record?.state === 'running';
        const step = !record ? 0 : record.state !== 'completed' && !reviewing ? 1 : 2;
        stepItems.forEach((item, index) => { if (index === step) item.setAttribute('aria-current', 'step'); else item.removeAttribute('aria-current'); });
        steps.hidden = reviewing;
        guidance.textContent = !isReady() ? 'Enable audio to prepare or listen.'
            : reviewing ? 'Listen once. Save what you heard. Move to the next sound.'
                : !record ? 'Start with a comparison ZIP, or create a K comparison.'
                    : preparing ? 'Preparing your comparison audio…'
                        : record.state !== 'completed' ? 'Prepare the saved comparison, then listen.'
                            : allAnswered ? 'Listening review saved. Compare or preview the sounds below.'
                                : answered ? 'Your answers are saved. Continue where you left off.'
                                    : 'Your comparison is ready. Start listening below.';
        enableAudio.hidden = isReady(); enableAudio.disabled = occupied || reviewing;
        chooser.hidden = reviewing; setup.hidden = reviewing || !!record;
        chooser.querySelector('summary').textContent = record ? 'Switch comparison or import ZIP' : 'Choose a comparison';
        picker.closest('label').hidden = !saved.length;
        createButton.classList.toggle('secondary', !!record);
        renderRow.hidden = !record || reviewing || record.state === 'completed';
        renderButton.hidden = preparing;
        pauseButton.hidden = !preparing;
        cancelButton.hidden = !working;
        progress.hidden = !record || record.state === 'completed' || reviewing;
        review.hidden = !ids.length;
        inspection.hidden = reviewing || !completed.length;
        reference.hidden = reviewing || !record;
        exchange.hidden = reviewing || !record;
        acceptance.hidden = reviewing || !record || !allAnswered;
        preference.hidden = !allAnswered;
        options(picker, saved.length ? saved.map(item => [item.id, item.title || item.label || item.id]) : [['', 'No saved experiments yet']]);
        if (record && [...picker.options].some(option => option.value === record.id)) picker.value = record.id;
        loadButton.hidden = !picker.value || picker.value === record?.id;
        for (const key of ['picker', 'create', 'label', 'seed', 'report-file', 'import-file']) controls.get(key).disabled = occupied || reviewing;
        loadButton.disabled = occupied || reviewing || !saved.length;
        createButton.disabled ||= !isReady();
        renderButton.disabled = occupied || reviewing || !isReady() || !record || record.state === 'completed';
        renderButton.textContent = ['paused', 'failed', 'cancelled'].includes(record?.state) ? 'Resume preparing audio' : 'Prepare comparison audio';
        pauseButton.disabled = !working || record?.state !== 'running';
        cancelButton.disabled = !working && !reviewing;
        progress.max = Math.max(1, trials.length); progress.value = completed.length;
        if (!working) status.textContent = record
            ? `${completed.length} of ${trials.length} sounds prepared · ${answered} of ${ids.length} first answers saved.${failed.length ? ` ${failed.length} sounds need another attempt; resume to retry.` : ''}`
            : 'Import includes saved audio. Creating a comparison prepares four controlled K variants.';
        startReview.disabled = occupied || reviewing || !isReady() || !ids.length;
        startReview.hidden = reviewing;
        startReview.textContent = allAnswered ? 'Revisit saved answers' : answered ? 'Continue listening review' : 'Start listening review';
        endReview.hidden = !reviewing;
        listenerDetails.hidden = reviewing;
        endReview.disabled = occupied || !reviewing;
        listener.disabled = occupied;
        listenButton.disabled = occupied || !reviewing || !isReady() || !trial || (hasPlayed(trial) && !response);
        listenButton.hidden = !reviewing || (hasPlayed(trial) && !response && !working);
        listenButton.textContent = playing && reviewing ? 'Playing…' : response ? 'Replay (optional)' : 'Play sound';
        stopReviewAudio.hidden = !reviewing || !playing;
        stopReviewAudio.disabled = !playing;
        listenButton.classList.toggle('secondary', !!response);
        if (displayedTrial !== currentId) {
            displayedTrial = currentId;
            const last = trial?.responses?.at(-1);
            answer.value = last?.transcript ?? ''; unclear.checked = !!last?.unclear;
        }
        answer.disabled = occupied || !reviewing || !answerAvailable(trial) || unclear.checked;
        unclear.disabled = occupied || !reviewing || !answerAvailable(trial);
        submit.disabled = occupied || !reviewing || !answerAvailable(trial);
        submit.textContent = response ? 'Save revised answer' : 'Save first answer';
        next.disabled = occupied || !reviewing || !response;
        next.textContent = revisiting ? 'Next saved sound →' : allAnswered ? 'Finish review' : 'Next sound →';
        const writing = reviewing && answerAvailable(trial);
        answer.closest('label').hidden = !writing;
        unclear.closest('label').hidden = !writing;
        submit.hidden = !writing;
        keyboardHelp.hidden = !writing;
        next.hidden = !reviewing || !response;
        responseRow.hidden = !writing && next.hidden;
        savedAnswer.hidden = !reviewing || !response || writing;
        savedAnswer.textContent = response ? `First answer saved: ${response.unclear ? 'I could not tell' : response.transcript}` : '';
        reviewProgress.max = Math.max(1, ids.length); reviewProgress.value = answered;
        reviewStatus.textContent = reviewing && trial
            ? `Sound ${ids.indexOf(trial.id) + 1} of ${ids.length} · ${answered} answers saved. ${response ? revisiting ? 'Replay this saved sound, or move to another.' : allAnswered ? 'All first answers are saved. Finish, or replay this sound.' : 'Continue to the next sound, or replay this one.' : hasPlayed(trial) ? 'What did you hear?' : 'Ready to play.'}${trial.targetExposed ? ' You already saw the intended words for this sound; this answer is marked as previewed.' : ''}`
            : allAnswered ? `All ${answered} first answers are saved in this browser. You can compare clarity, preview sounds, or download a backup.`
                : `${ids.length} short sounds · ${answered} answers saved. Take a break whenever you need; progress is saved automatically.`;
        pairs = [];
        for (const baseline of completed.filter(item => firstResponse(item))) {
            for (const other of completed) {
                if (baseline.targetId !== other.targetId || baseline.variantId === other.variantId || !firstResponse(other)) continue;
                if (baseline.id.localeCompare(other.id) >= 0) continue;
                const [left, right] = baseline.order.localeCompare(other.order) < 0 ? [baseline, other] : [other, baseline];
                pairs.push({ id: String(pairs.length), left: left.id, right: right.id });
            }
        }
        options(pairPicker, pairs.length ? pairs.map((pair, index) => [pair.id, `Pair ${index + 1}`]) : [['', 'Lock both first answers to unlock a pair']]);
        if (preferenceKey !== pairPicker.value) { preferenceKey = pairPicker.value; clarity.value = ''; naturalness.value = ''; }
        for (const element of [pairPicker, clarity, naturalness, savePreference]) element.disabled = occupied || !pairs.length;
        for (const element of [playA, playB]) element.disabled = occupied || !pairs.length || !isReady();
        inspectableIds = completed.map(item => item.id);
        options(inspectionPicker, completed.length ? completed.map((_item, index) => [String(index), `Saved sound ${index + 1}`]) : [['', 'No saved audio yet']]);
        inspectionPicker.disabled = occupied || reviewing || !completed.length;
        inspectButton.disabled = occupied || reviewing || !completed.length;
        playGenerated.disabled = occupied || reviewing || !completed.length || !isReady();
        capabilitiesButton.disabled = occupied || reviewing || !record;
        const references = record?.references ?? [];
        referencePicker.closest('label').hidden = !references.length;
        referenceActions.hidden = !references.length;
        addReferenceHere.hidden = !!references.length;
        addReferenceHere.disabled = occupied || reviewing || !record;
        annotations.hidden = !references.length;
        options(referencePicker, references.length ? references.map((item, index) => [String(index), `Reference ${index + 1} · ${Number(item.durationSeconds ?? item.reference?.durationSeconds ?? 0).toFixed(2)} s`])
            : [['', 'No reference recording saved']]);
        referencePicker.disabled = occupied || reviewing || !references.length;
        showReference.disabled = occupied || reviewing || !references.length;
        playReference.disabled = occupied || reviewing || !references.length || !isReady();
        referenceInspector.setDisabled(occupied || reviewing || !isReady());
        const comparisonReady = inspectedAudio && inspectedTrial && loadedReference
            && loadedReferenceIndex === Number(referencePicker.value);
        alignmentRow.hidden = !inspectedAudio && !loadedReference;
        saveAlignment.disabled = occupied || reviewing || !comparisonReady;
        restoreAlignment.disabled = occupied || reviewing || !comparisonReady
            || !runner.referenceComparison(inspectedTrial?.id, loadedReferenceIndex);
        stopDiagnostic.hidden = !diagnosticPlaying;
        stopDiagnostic.disabled = !diagnosticPlaying;
        const annotationReady = loadedReference && loadedReferenceIndex === Number(referencePicker.value);
        for (const element of [annotationLabel, annotationType, annotationStart, annotationEnd, annotationConfidence, saveAnnotation]) {
            element.disabled = occupied || reviewing || !annotationReady;
        }
        for (const element of [referenceFile, transcript, authorized, referenceSource, saveReference]) element.disabled = occupied || reviewing || !record;
        exportButton.disabled = occupied || reviewing || !record;
        exportWavButton.disabled = occupied || reviewing || !record;
        variantIds = record?.manifest.variants.map(variant => variant.id) ?? [];
        options(candidate, record ? record.manifest.variants.map((_variant, index) => [String(index), `Condition ${index + 1}`]) : [['', 'No experiment selected']]);
        for (const element of [candidate, reason, acceptButton]) element.disabled = occupied || reviewing || !record;
        rollbackButton.disabled = occupied || reviewing || !record?.previousVariantId;
        if (record?.acceptedVariantId !== persistedSelection) {
            persistedSelection = record?.acceptedVariantId ?? null;
            acceptanceStatus.textContent = persistedSelection && persistedSelection !== 'baseline'
                ? 'A reviewed configuration is saved for this lab. Production voice remains unchanged.' : 'The saved lab selection is the baseline.';
        }
        if (record && !reviewing) {
            const gate = runner.acceptanceStatus(variantIds[Number(candidate.value)]);
            acceptButton.disabled ||= !gate.passed;
            if (!gate.passed) acceptanceStatus.textContent = answered === ids.length && ids.length
                ? gate.reasons.join(' ')
                : 'Complete the engineering renders and matched first-listen review before accepting a candidate.';
        }
    }

    function cancel() {
        if (disposed) return;
        runner.cancel(); operation?.abort(); reviewing = false;
        status.textContent = 'Cancelling; completed trial audio and saved answers are preserved.';
        if (!working) reviewChanged();
    }
    function dispose() {
        if (disposed) return;
        disposed = true; events.abort(); operation?.abort(); runner.cancel(); reviewing = false;
        for (const url of downloads) URL.revokeObjectURL(url);
        downloads.clear(); style.remove(); root.remove();
        referenceInspector.destroy(); inspectedAudio = null; inspectedPlan = null; inspectedTrial = null; loadedReference = null;
    }

    async function reloadSaved() {
        const request = ++listRequest;
        const result = await store.listExperiments();
        if (disposed || request !== listRequest) return;
        saved = result.filter(item => item.id.startsWith('voice-experiment-'));
        refresh();
    }
    function download(blob, filename) {
        const url = URL.createObjectURL(blob); downloads.add(url);
        const anchor = node('a'); anchor.href = url; anchor.download = filename; anchor.hidden = true;
        root.append(anchor); anchor.click(); anchor.remove();
        setTimeout(() => { URL.revokeObjectURL(url); downloads.delete(url); }, 1000);
    }

    function drawWaveforms({ restore = false } = {}) {
        if (disposed) return;
        const record = snapshot();
        const reference = loadedReference ? record?.references[loadedReferenceIndex] : null;
        const pair = `${record?.id ?? ''}:${inspectedTrial?.id ?? ''}:${reference?.pcmAssetId ?? ''}`;
        const savedComparison = inspectedTrial && reference
            ? runner.referenceComparison(inspectedTrial.id, loadedReferenceIndex) : null;
        const selected = pair === inspectorPair && !restore ? referenceInspector.getSelection() : null;
        const generatedRegion = selected?.generated ?? savedComparison?.generated.region;
        const referenceRegion = selected?.reference ?? savedComparison?.reference.region;
        const analysis = selected?.analysis ?? savedComparison?.analysis;
        inspectorPair = pair;
        referenceInspector.setSources({
            generated: inspectedAudio && inspectedTrial ? { ...inspectedAudio, id: inspectedTrial.id,
                hash: inspectedTrial.audioIdentity.digest, label: `Generated: ${inspectedTrial.text}`,
                events: intendedVoiceTimeline(inspectedPlan), ...(generatedRegion ? { region: generatedRegion } : {}) } : null,
            reference: loadedReference && reference ? { ...loadedReference, id: reference.pcmAssetId,
                hash: reference.pcmSha256, label: 'Authorized reference',
                events: (record.referenceAnnotations ?? []).filter(item => item.referenceIndex === loadedReferenceIndex),
                ...(referenceRegion ? { region: referenceRegion } : {}) } : null,
            ...(analysis ? { analysis } : {}),
            ...(selected || savedComparison ? { alignmentEnabled: selected?.alignmentEnabled ?? savedComparison.alignmentEnabled } : {}),
        });
        if (savedComparison && (restore || !selected)) alignmentStatus.textContent = 'Saved regions and manual alignment restored. Original recordings are unchanged.';
        else if (!selected && inspectedAudio && loadedReference) alignmentStatus.textContent = 'Choose regions to inspect. Align marked samples when useful, then save the view.';
    }
    async function auditionRegion(selection) {
        if (blocked() || reviewing) return;
        return perform('Playing a diagnostic region. This is not a whole-word listening trial.', async signal => {
            const audio = selection.source === 'generated' ? inspectedAudio : loadedReference;
            const identity = selection.source === 'generated' ? inspectedTrial?.id
                : snapshot()?.references[loadedReferenceIndex]?.pcmAssetId;
            const hash = selection.source === 'generated' ? inspectedTrial?.audioIdentity.digest
                : snapshot()?.references[loadedReferenceIndex]?.pcmSha256;
            const { startSample, endSample } = selection;
            if (!audio || selection.id !== identity || selection.hash !== hash || selection.sampleRate !== audio.sampleRate
                || !Number.isInteger(startSample) || !Number.isInteger(endSample) || startSample < 0
                || endSample <= startSample || endSample > audio.pcm.length
                || endSample - startSample > 10 * audio.sampleRate) throw new RangeError('Choose a region of up to 10 seconds inside the currently displayed recording.');
            diagnosticPlaying = true; refresh();
            try {
                // Preserve the selected source clock and samples. The host alone
                // owns playback resampling. Crops never unlock whole-word answers.
                const receipt = await play({ pcm: audio.pcm.slice(startSample, endSample), sampleRate: audio.sampleRate,
                    diagnosticRegion: { source: selection.source, id: identity, hash, startSample, endSample } }, { signal });
                if (signal.aborted || disposed) throw new DOMException('Region preview stopped.', 'AbortError');
                if (receipt?.state !== 'drained') throw new Error('Region preview did not finish.');
                alignmentStatus.textContent = 'Selected region played. This diagnostic preview adds no whole-word listening answer or playback receipt.';
            } finally { diagnosticPlaying = false; if (!disposed) refresh(); }
        }, { ready: true });
    }
    handle(stopDiagnostic, 'click', () => operation?.abort());
    handle(saveAlignment, 'click', () => perform('Saving the selected regions and manual anchors.', async () => {
        const selected = referenceInspector.getSelection();
        if (!inspectedTrial || !loadedReference || !selected.generated || !selected.reference) throw new Error('Show both sounds before saving inspected regions.');
        await runner.setReferenceComparison({ trialId: inspectedTrial.id, referenceIndex: loadedReferenceIndex,
            generatedRegion: selected.generated, referenceRegion: selected.reference,
            alignmentEnabled: selected.alignmentEnabled, analysis: selected.analysis });
        alignmentStatus.textContent = 'Regions, manual anchors and analysis settings saved with this comparison.';
    }));
    handle(restoreAlignment, 'click', () => { if (!blocked()) drawWaveforms({ restore: true }); });
    async function loadReference(signal) {
        if (reviewing) throw new Error('Save and leave the listening review before showing reference sounds.');
        if (referencePicker.value === '') throw new Error('Select a saved reference recording.');
        const index = Number(referencePicker.value);
        const audio = await runner.referenceAudio(index);
        if (disposed || signal?.aborted) throw new DOMException('Reference inspection cancelled.', 'AbortError');
        loadedReference = audio; loadedReferenceIndex = index;
        annotationStart.value = '0'; annotationEnd.value = (loadedReference.pcm.length / loadedReference.sampleRate).toFixed(6);
        drawWaveforms();
        return loadedReference;
    }
    handle(referencePicker, 'change', () => { loadedReference = null; loadedReferenceIndex = null; annotationStatus.textContent = ''; drawWaveforms(); refresh(); });
    handle(showReference, 'click', () => perform('Loading the saved reference waveform.', loadReference));
    handle(playReference, 'click', () => perform('Playing the saved authorized reference.', async signal => {
        const audio = await loadReference(signal);
        const receipt = await play(audio, { signal });
        if (receipt?.state !== 'drained') throw new Error('Reference playback did not finish.');
    }, { ready: true }));
    handle(saveAnnotation, 'click', () => perform('Saving the manual reference boundary.', async () => {
        if (!loadedReference || loadedReferenceIndex !== Number(referencePicker.value)) throw new Error('Show the selected reference waveform first.');
        if (!annotationLabel.value.trim() || !annotationStart.value.trim() || !annotationEnd.value.trim()) throw new Error('Provide a label and both boundary times.');
        const startSample = Math.round(Number(annotationStart.value) * loadedReference.sampleRate);
        const endSample = Math.round(Number(annotationEnd.value) * loadedReference.sampleRate);
        const confidence = annotationConfidence.value.trim() === '' ? null : Number(annotationConfidence.value);
        if (!Number.isSafeInteger(startSample) || !Number.isSafeInteger(endSample) || startSample < 0
            || endSample < startSample || (endSample === startSample && annotationType.value !== 'event')
            || endSample > loadedReference.pcm.length) throw new RangeError('Choose a region inside the recording; only an event may use a single sample position.');
        if (confidence !== null && (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)) throw new RangeError('Confidence must be between 0 and 1.');
        await runner.annotateReference(loadedReferenceIndex, { label: annotationLabel.value.trim(), type: annotationType.value,
            startSample, endSample, confidence, origin: 'manual-correction' });
        drawWaveforms();
        annotationStatus.textContent = `Saved manual ${annotationType.value} boundary: samples ${startSample}–${endSample} at ${loadedReference.sampleRate} Hz.`;
    }));

    refresh();
    reloadSaved().catch(fail);
    return Object.freeze({ refresh, dispose, cancel, get active() { return !disposed && (working || reviewing); } });
}
