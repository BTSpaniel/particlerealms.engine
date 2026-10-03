// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { renderVoiceToneComparison } from './VoiceToneRecovery.js';
import { encodeVoiceLessonWav } from './VoiceLessonAudioArchive.js';
import { sha256HexOf, sha256HexOfBytes } from '../risk/ReceiptCrypto.js';
import { Zip } from '../../../webgpu-os/packages/Zip.js';

export const VOICE_TONE_COMPARISON_SCHEMA = 'particle-voice-tone-comparison/v1';
const KEYS = ['mid', 'low', 'high', 'recovered'];
const LABELS = {mid: 'Mid (original)', low: 'Low', high: 'High', recovered: 'Recovered'};
const jsonBytes = value => new TextEncoder().encode(JSON.stringify(value, (_key, item) =>
    ArrayBuffer.isView(item) ? {arrayType: item.constructor.name, values: Array.from(item)} : item)).buffer;

/** Optional same-voice comparison; the host remains the sole model/playback owner. */
export function mountVoiceTonePanel({container, store, getModel, getText, planText, getConfiguration,
    isReady, isBlocked, isEvaluationActive = () => false, startAudio, acquireBusy, play,
    evaluatorType = 'human', onError = () => {}}) {
    if (!container?.ownerDocument || container.childNodes.length) throw new TypeError('Tone comparison requires an empty container.');
    for (const callback of [getModel, getText, planText, getConfiguration, isReady, isBlocked,
        isEvaluationActive, startAudio, acquireBusy, play, onError]) {
        if (typeof callback !== 'function') throw new TypeError('Tone comparison requires host lifecycle callbacks.');
    }
    if (!store?.saveExperiment || !store?.loadExperiment || !store?.listExperiments) throw new TypeError('Tone comparison requires the shared experiment store.');
    if (!['human', 'automated-test'].includes(evaluatorType)) throw new TypeError('Invalid tone evaluator type.');
    const document = container.ownerDocument, events = new AbortController(), downloads = new Set();
    let disposed = false, operation = null, current = null, saved = [], listing = 0;
    const root = node('details'); root.className = 'voice-tone-panel';
    const style = node('style');
    style.textContent = '.voice-tone-panel{margin-top:18px;padding:16px;border:1px solid var(--line,#dce2d9);border-radius:14px;background:var(--card,#fffefa);min-width:0}.voice-tone-panel summary{cursor:pointer;font-weight:650}.voice-tone-panel p{font-size:.82rem;line-height:1.5;overflow-wrap:anywhere}.voice-tone-panel .tone-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:10px}.voice-tone-panel button,.voice-tone-panel select{min-height:44px;max-width:100%}.voice-tone-panel [hidden]{display:none!important}.voice-tone-panel [role=alert]{color:#922e26}';
    root.append(node('summary', 'Three-tone comparison (experimental)'), node('p',
        'Compare the preview text in three tones of the applied voice, plus an experimental recovered version. Use up to 15 seconds of speech. This has no proven quality improvement.'));
    const voice = node('p'); voice.dataset.tone = 'voice'; root.append(voice);
    const actions = node('div'); actions.className = 'tone-row'; root.append(actions);
    const generate = button(actions, 'Generate comparison', 'generate');
    const stop = button(actions, 'Stop', 'stop', true);
    const status = node('p', 'Uses the text above. Nothing changes the applied voice.'); status.dataset.tone = 'status';
    status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); root.append(status);
    const error = node('p'); error.setAttribute('role', 'alert'); error.hidden = true; root.append(error);
    const preview = node('div'); preview.className = 'tone-row'; preview.setAttribute('aria-label', 'Tone previews'); root.append(preview);
    const previews = Object.fromEntries(KEYS.map(key => [key, button(preview, LABELS[key], key, true)]));
    const note = node('p', 'Preview loudness is matched with one recorded gain per clip. Downloads retain the original samples.'); root.append(note);
    const feedback = node('div'); feedback.className = 'tone-row'; root.append(feedback);
    feedback.append(node('span', 'Which is clearer?'));
    const preferences = Object.fromEntries([['mid', 'Mid'], ['recovered', 'Recovered'], ['same', 'About the same'], ['unclear', 'Couldn’t judge']]
        .map(([key, text]) => [key, button(feedback, text, `prefer-${key}`, true)]));
    const feedbackNote = node('p', 'Optional: play Mid and Recovered fully, then choose which is clearer. Your rating is saved for review.'); root.append(feedbackNote);
    const exchange = node('div'); exchange.className = 'tone-row'; root.append(exchange);
    const exportAudio = button(exchange, 'Download WAVs & results', 'export', true);
    const restore = node('div'); restore.className = 'tone-row'; root.append(restore);
    const label = node('label', 'Saved comparisons '), picker = node('select'); picker.dataset.tone = 'saved';
    picker.setAttribute('aria-label', 'Saved tone comparison'); label.append(picker); restore.append(label);
    const open = button(restore, 'Open saved', 'open', true);
    container.append(style, root);

    function node(tag, text = null) {
        const element = document.createElement(tag); if (text !== null) element.textContent = text; return element;
    }
    function button(parent, text, id, secondary = false) {
        const element = node('button', text); element.type = 'button'; element.dataset.tone = id;
        if (secondary) element.className = 'secondary'; parent.append(element); return element;
    }
    function listen(element, action) { element.addEventListener('click', action, {signal: events.signal}); }
    function fail(reason) {
        if (disposed) return;
        error.textContent = reason?.message ?? String(reason); error.hidden = false; onError(reason);
    }
    function assertCurrent(token) {
        if (disposed || operation !== token || token.controller.signal.aborted || isEvaluationActive()
            || (token.model && getModel() !== token.model)) throw new DOMException('Tone comparison stopped or superseded.', 'AbortError');
    }
    async function operate(work, {audio = false, modelBound = false} = {}) {
        if (disposed || operation || isBlocked()) return;
        const token = {controller: new AbortController(), release: null, model: null}; operation = token;
        error.hidden = true; refresh();
        try {
            if (audio && !isReady() && !await startAudio()) throw new Error('Enable audio to generate or preview tones.');
            assertCurrent(token);
            if (isBlocked()) throw new DOMException('Another listening activity started.', 'AbortError');
            token.release = acquireBusy();
            if (typeof token.release !== 'function') throw new Error('The lab is busy. Finish or stop the current activity.');
            if (modelBound) { token.model = getModel(); if (!token.model) throw new Error('The applied voice is unavailable.'); }
            assertCurrent(token); await work(token); assertCurrent(token);
        } catch (reason) {
            if (!disposed && operation === token) {
                if (reason?.name === 'AbortError') status.textContent = 'Stopped. The previous saved comparison is retained.';
                else fail(reason);
            }
        } finally {
            if (operation === token) operation = null;
            token.release?.(); refresh();
        }
    }
    async function asset(bytes, kind, metadata = {}) {
        const hash = await sha256HexOfBytes(bytes);
        if (!hash) throw new Error('SHA-256 is unavailable.');
        return {id: `sha256:${hash}`, bytes, sha256: hash, mimeType: kind === 'plan' ? 'application/json' : 'application/octet-stream', kind, ...metadata};
    }
    async function generateComparison(token) {
        const text = String(getText()).trim();
        if (!text || text.length > 2000) throw new Error('Enter a short preview, up to 15 seconds of speech.');
        const configuration = structuredClone(getConfiguration());
        const planned = planText(token.model, text), plan = structuredClone(planned.plan ?? planned);
        const seconds = plan.physiology?.totalFrames / plan.physiology?.frameRateHz;
        if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 15) throw new Error('This preview is longer than 15 seconds. Use a shorter sentence.');
        const planAsset = await asset(jsonBytes(plan), 'plan'); assertCurrent(token);
        status.textContent = 'Generating the same voice at three tones…';
        const comparison = await renderVoiceToneComparison({model: token.model, plan, signal: token.controller.signal,
            onProgress: progress => {
                if (operation === token && !disposed && !token.controller.signal.aborted) {
                    status.textContent = `Generating comparison${progress?.stage ? `: ${progress.stage}` : '…'}`;
                }
            }});
        assertCurrent(token);
        const receipt = structuredClone(comparison.receipt), receiptHash = await sha256HexOf(receipt);
        if (!receiptHash) throw new Error('SHA-256 is unavailable.');
        const assets = [planAsset], variants = {}, renders = {};
        for (const key of KEYS) {
            const render = comparison.variants[key], pcm = render?.pcm?.slice();
            const sampleRate = render?.sampleRate ?? comparison.sampleRate;
            if (!(pcm instanceof Float32Array) || !pcm.length || pcm.length / sampleRate > 15.1) throw new Error('Tone renderer returned invalid or oversized audio.');
            const wav = encodeVoiceLessonWav(pcm, sampleRate);
            const raw = wav.slice(wav.byteLength - pcm.byteLength);
            const item = await asset(raw, 'rendered-pcm', {encoding: 'float32-le', sampleRate, sampleCount: pcm.length});
            const auditionGain = receipt.auditionGains?.[key];
            if (!Number.isFinite(auditionGain) || auditionGain < 0) throw new Error('Tone renderer did not provide valid audition gains.');
            assets.push(item);
            variants[key] = {pcmAssetId: item.id, pcmSha256: item.sha256, sampleRate, sampleCount: pcm.length,
                wavSha256: await sha256HexOfBytes(wav), auditionGain};
            renders[key] = {pcm: pcm.slice(), sampleRate};
        }
        assertCurrent(token);
        const {tract: beforeTract, ...beforeSettings} = configuration;
        const {tract: afterTract, ...afterSettings} = getConfiguration();
        if (JSON.stringify(beforeSettings) !== JSON.stringify(afterSettings)) throw new DOMException('Applied voice settings changed.', 'AbortError');
        const identity = configuration.voicePreset;
        if (!identity?.id || !identity?.label) throw new Error('The applied voice must have a recorded identity.');
        const record = {schemaVersion: VOICE_TONE_COMPARISON_SCHEMA, id: `voice-tone-${crypto.randomUUID()}`,
            title: `${identity.label}: ${text.slice(0, 60)}`, createdAt: new Date().toISOString(),
            text, renderPath: planned.renderPath ?? 'text', configuration, resolvedTractConfiguration: structuredClone(afterTract ?? null),
            planAssetId: planAsset.id, planSha256: planAsset.sha256, receipt, receiptHash, variants,
            auditions: [], preferences: [],
            qualityClaim: 'Experimental comparison; no proven improvement or perceptual score.',
            audition: 'One scalar per complete variant; raw saved/downloaded PCM is unchanged.'};
        status.textContent = 'Saving complete audio and its settings…';
        const storageReceipt = await store.saveExperiment(record, assets);
        // Persistence can finish after cancellation. Completed bytes may remain
        // saved, but a revoked operation cannot replace the displayed comparison.
        assertCurrent(token);
        current = {record, storageReceipt, renders, assets};
        saved = [{id: record.id, title: record.title}, ...saved.filter(item => item.id !== record.id)]; updatePicker(record.id);
        status.textContent = `Saved ${(variants.mid.sampleCount / variants.mid.sampleRate).toFixed(2)} seconds. ${receipt.changedSamples === 0
            ? 'No eligible vowel detail changed; Recovered matches Mid.' : 'Compare Mid, Low, High and Recovered.'}`;
    }
    async function loadComparison(token, id) {
        const loaded = await store.loadExperiment(id); assertCurrent(token);
        const record = loaded?.record;
        if (record?.schemaVersion !== VOICE_TONE_COMPARISON_SCHEMA || !record.configuration?.voicePreset?.label
            || await sha256HexOf(record.receipt) !== record.receiptHash) throw new Error('Saved tone comparison has invalid provenance.');
        const assets = new Map(loaded.assets.map(item => [item.id, item])), renders = {};
        if (assets.get(record.planAssetId)?.sha256 !== record.planSha256) throw new Error('Saved tone plan is missing or mismatched.');
        for (const key of KEYS) {
            const entry = record.variants?.[key], pcmAsset = assets.get(entry?.pcmAssetId);
            if (!entry || !pcmAsset || pcmAsset.sha256 !== entry.pcmSha256 || pcmAsset.bytes.byteLength !== entry.sampleCount * 4
                || !Number.isInteger(entry.sampleCount) || entry.sampleCount < 1 || entry.sampleCount / entry.sampleRate > 15.1
                || entry.auditionGain !== record.receipt.auditionGains?.[key] || !Number.isFinite(entry.auditionGain) || entry.auditionGain < 0) {
                throw new Error(`Saved ${key} audio is invalid.`);
            }
            const pcm = new Float32Array(entry.sampleCount), view = new DataView(pcmAsset.bytes);
            for (let i = 0; i < pcm.length; i++) pcm[i] = view.getFloat32(i * 4, true);
            const wav = encodeVoiceLessonWav(pcm, entry.sampleRate);
            if (await sha256HexOfBytes(wav) !== entry.wavSha256) throw new Error(`Saved ${key} WAV identity changed.`);
            renders[key] = {pcm, sampleRate: entry.sampleRate};
        }
        assertCurrent(token); current = {record, storageReceipt: loaded.receipt, assets: loaded.assets, renders};
        status.textContent = 'Saved comparison opened. Its voice and samples are preserved.';
    }
    async function audition(token, key) {
        const selected = current, source = selected.renders[key], gain = selected.record.variants[key].auditionGain;
        const pcm = Float32Array.from(source.pcm, value => value * gain);
        if (!pcm.every(value => Number.isFinite(value) && Math.abs(value) <= 0.951)) throw new Error('Saved audition gain exceeds its peak bound.');
        const startedAt = new Date().toISOString();
        status.textContent = `Playing ${LABELS[key]} · ${selected.record.configuration.voicePreset.label}`;
        const playback = await play({pcm, sampleRate: source.sampleRate}, {signal: token.controller.signal});
        assertCurrent(token);
        if (playback?.state !== 'drained') throw new Error('Playback did not finish; this play cannot unlock a rating.');
        const record = structuredClone(selected.record);
        record.auditions ??= [];
        record.auditions.push({id: crypto.randomUUID(), variant: key, state: 'drained', startedAt,
            completedAt: new Date().toISOString(), wavSha256: record.variants[key].wavSha256,
            auditionGain: gain, sampleRate: source.sampleRate, sampleCount: source.pcm.length, evaluatorType});
        await saveRevision(token, selected, record);
        status.textContent = `${LABELS[key]} finished. Choose another tone to compare.`;
    }
    async function saveRevision(token, selected, record) {
        assertCurrent(token);
        if (current !== selected) throw new DOMException('Comparison changed.', 'AbortError');
        const storageReceipt = await store.saveExperiment(record, []);
        assertCurrent(token);
        if (current !== selected) throw new DOMException('Comparison changed.', 'AbortError');
        current = {...selected, record, storageReceipt};
    }
    async function savePreference(token, choice) {
        const selected = current, record = structuredClone(selected.record);
        const heard = ['mid', 'recovered'].map(key => ({variant: key, wavSha256: record.variants[key].wavSha256,
            auditionGain: record.variants[key].auditionGain,
            completedPlays: (record.auditions ?? []).filter(item => item.variant === key && item.state === 'drained'
                && item.wavSha256 === record.variants[key].wavSha256 && item.auditionGain === record.variants[key].auditionGain)}));
        if (heard.some(item => !item.completedPlays.length)) throw new Error('Listen to Mid and Recovered fully before rating.');
        record.preferences ??= [];
        record.preferences.push({id: crypto.randomUUID(), dimension: 'clarity', choice, createdAt: new Date().toISOString(),
            evaluatorType, protocol: 'sighted-practice', automaticTraining: false,
            variants: heard.map(item => ({...item, completedPlayCount: item.completedPlays.length}))});
        await saveRevision(token, selected, record);
        status.textContent = 'Clarity preference saved with the exact audio and completed plays.';
    }
    async function exportComparison(token) {
        const selected = current, files = {'report.json': JSON.stringify({record: selected.record, storageReceipt: selected.storageReceipt}, null, 2)}, manifest = [];
        for (const key of KEYS) {
            const source = selected.renders[key], wav = new Uint8Array(encodeVoiceLessonWav(source.pcm, source.sampleRate));
            const sha256 = await sha256HexOfBytes(wav);
            if (sha256 !== selected.record.variants[key].wavSha256) throw new Error('Comparison samples changed before export.');
            files[`audio/${key}.wav`] = wav; manifest.push({key, path: `audio/${key}.wav`, sha256, ...selected.record.variants[key]});
        }
        for (const item of selected.assets) files[`assets/${item.sha256}.bin`] = new Uint8Array(item.bytes);
        files['plan.json'] = new Uint8Array(selected.assets.find(item => item.id === selected.record.planAssetId).bytes);
        files['manifest.json'] = JSON.stringify({schemaVersion: VOICE_TONE_COMPARISON_SCHEMA, clips: manifest,
            receiptHash: selected.record.receiptHash, storageReceiptHash: selected.storageReceipt.receiptHash}, null, 2);
        const bytes = await Zip.create(files, {compress: false}); assertCurrent(token);
        const url = URL.createObjectURL(new Blob([bytes], {type: 'application/zip'})); downloads.add(url);
        const anchor = node('a'); anchor.href = url; anchor.download = `${selected.record.id}-audio-and-results.zip`; anchor.hidden = true;
        root.append(anchor); anchor.click(); anchor.remove();
        setTimeout(() => { URL.revokeObjectURL(url); downloads.delete(url); }, 1000);
        status.textContent = 'Downloaded raw WAVs, plan, settings and hash receipts.';
    }
    function updatePicker(selected = picker.value) {
        picker.replaceChildren(...(saved.length ? saved.map(item => { const option = node('option', item.title); option.value = item.id; return option; })
            : [node('option', 'No saved comparisons')]));
        if (saved.some(item => item.id === selected)) picker.value = selected;
    }
    function refresh() {
        if (disposed) return;
        const occupied = !!operation || isBlocked();
        generate.disabled = occupied; stop.disabled = !operation || operation.controller.signal.aborted;
        for (const element of [...Object.values(previews), exportAudio]) element.disabled = occupied || !current;
        const canRate = current && ['mid', 'recovered'].every(key => current.record.auditions?.some(item => item.variant === key
            && item.state === 'drained' && item.wavSha256 === current.record.variants[key].wavSha256
            && item.auditionGain === current.record.variants[key].auditionGain));
        for (const element of Object.values(preferences)) element.disabled = occupied || !canRate;
        feedback.hidden = !current; feedbackNote.hidden = !current;
        picker.disabled = occupied || !saved.length; open.disabled = occupied || !saved.length;
        preview.hidden = !current; note.hidden = !current; exchange.hidden = !current; restore.hidden = !saved.length;
        const applied = getModel()?.voicePreset;
        voice.textContent = current ? `Saved voice: ${current.record.configuration.voicePreset.label} · ${current.record.text}`
            : applied ? `Applied voice: ${applied.label}` : 'Enable audio to use the selected voice.';
    }
    function cancel() { if (operation) { operation.controller.abort(); status.textContent = 'Stopping…'; refresh(); } }
    function dispose() {
        if (disposed) return; disposed = true; operation?.controller.abort(); events.abort(); listing++;
        for (const url of downloads) URL.revokeObjectURL(url); downloads.clear(); current = null; root.remove(); style.remove();
    }
    listen(generate, () => operate(generateComparison, {audio: true, modelBound: true}));
    listen(stop, cancel); listen(open, () => operate(token => loadComparison(token, picker.value)));
    for (const key of KEYS) listen(previews[key], () => operate(token => audition(token, key), {audio: true}));
    for (const key of Object.keys(preferences)) listen(preferences[key], () => operate(token => savePreference(token, key)));
    listen(exportAudio, () => operate(exportComparison));
    const request = ++listing;
    const ready = store.listExperiments().then(items => {
        if (disposed || request !== listing) return;
        saved = items.filter(item => item.schemaVersion === VOICE_TONE_COMPARISON_SCHEMA); updatePicker(); refresh();
    }).catch(fail);
    refresh();
    return Object.freeze({refresh, cancel, dispose, ready, get active() { return !!operation; },
        snapshot: () => current ? structuredClone({record: current.record, storageReceipt: current.storageReceipt}) : null});
}
