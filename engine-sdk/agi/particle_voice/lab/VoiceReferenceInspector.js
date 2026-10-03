// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Saved-sample diagnostics only. No synthesis, microphone, alignment inference,
 * normalization, or audio ownership. Audition is delegated to the host. */
import { fft, hannWindow } from '../../../engine/core/math/MathSignal.js';
import { phonemeAt } from '../frontend/PhonemeSet.js';

const FFT_SIZES = Object.freeze([512, 1024, 2048, 4096]);
const MAX_FRAMES = 128;
const MAX_SECONDS = 10;
const FLOOR_DB = -100;
const COLORS = Object.freeze({ generated: '#176f67', reference: '#a64c21' });
const DEFAULT_ANALYSIS = Object.freeze({ fftSize: 1024, hopSize: 256, window: 'hann', floorDb: FLOOR_DB });

function audioShape(audio) {
    if (!(audio?.pcm instanceof Float32Array) || audio.pcm.length < 1
        || !Number.isSafeInteger(audio.sampleRate) || audio.sampleRate < 1 || audio.sampleRate > 384000) {
        throw new TypeError('Expected nonempty mono Float32 samples and an integer sample rate.');
    }
    return audio;
}

function regionShape(audio, region = {}) {
    const startSample = region.startSample ?? 0;
    const endSample = region.endSample ?? Math.min(audio.pcm.length, startSample + MAX_SECONDS * audio.sampleRate);
    const anchorSample = region.anchorSample ?? startSample;
    if (![startSample, endSample, anchorSample].every(Number.isSafeInteger)
        || startSample < 0 || endSample <= startSample || endSample > audio.pcm.length
        || endSample - startSample > MAX_SECONDS * audio.sampleRate
        || anchorSample < startSample || anchorSample >= endSample) {
        throw new RangeError('Select a nonempty region of at most 10 seconds, with its anchor inside the region.');
    }
    return { startSample, endSample, anchorSample };
}

function settingsShape(settings = {}) {
    const out = { ...DEFAULT_ANALYSIS, ...settings };
    if (!FFT_SIZES.includes(out.fftSize) || out.hopSize !== out.fftSize / 4
        || out.window !== 'hann' || out.floorDb !== FLOOR_DB) {
        throw new RangeError('Use a 512, 1024, 2048 or 4096 sample Hann window, quarter-window hop and -100 dB floor.');
    }
    return { fftSize: out.fftSize, hopSize: out.hopSize, window: out.window, floorDb: out.floorDb };
}

/** Bounded representative windows of original samples, never a resampled signal.
 * Spectrum is RMS across retained single-sided peak-amplitude spectra, in dB
 * relative to amplitude 1. DC and Nyquist are not doubled. Short selections use
 * a Hann window at their actual length before zero padding, with its own gain.
 * Frame starts explicitly expose thinning; this is not an all-frame statistic. */
export function analyzeVoiceRegion(audio, options = {}) {
    audioShape(audio);
    const region = regionShape(audio, options);
    const settings = settingsShape({
        fftSize: options.fftSize ?? DEFAULT_ANALYSIS.fftSize,
        hopSize: options.hopSize ?? (options.fftSize ?? DEFAULT_ANALYSIS.fftSize) / 4,
        window: options.window ?? 'hann', floorDb: options.floorDb ?? FLOOR_DB,
    });
    const maxFrames = options.maxFrames ?? MAX_FRAMES;
    if (!Number.isInteger(maxFrames) || maxFrames < 2 || maxFrames > MAX_FRAMES) {
        throw new RangeError('Analysis retains between 2 and 128 windows at most.');
    }
    const { fftSize, hopSize } = settings;
    const count = region.endSample - region.startSample;
    const windowSamples = Math.min(count, fftSize);
    // Symmetric Hann of length two is all zero. Such selections use an explicit
    // rectangular two/one-sample window so they remain meaningful diagnostics.
    const window = windowSamples < 3 ? new Array(windowSamples).fill(1) : hannWindow(windowSamples);
    const windowSum = window.reduce((sum, value) => sum + value, 0);
    const availableFrames = Math.max(1, Math.floor((count - windowSamples) / hopSize) + 1);
    const frameCount = Math.min(maxFrames, availableFrames);
    const frameStarts = new Uint32Array(frameCount);
    const bins = fftSize / 2 + 1, frequencies = new Float32Array(bins);
    const spectrumPower = new Float64Array(bins), spectrogramDb = new Float32Array(frameCount * bins);
    let nonFiniteCount = 0;
    for (let frame = 0; frame < frameCount; frame++) {
        const frameIndex = frameCount === 1 ? 0 : Math.round(frame * (availableFrames - 1) / (frameCount - 1));
        const start = region.startSample + frameIndex * hopSize;
        frameStarts[frame] = start;
        const real = new Float64Array(fftSize), imag = new Float64Array(fftSize);
        for (let sample = 0; sample < windowSamples; sample++) {
            const value = audio.pcm[start + sample];
            if (!Number.isFinite(value)) nonFiniteCount++;
            else real[sample] = value * window[sample];
        }
        if (nonFiniteCount) throw new RangeError('The inspected samples contain nonfinite audio; no spectrum was produced.');
        fft(real, imag);
        for (let bin = 0; bin < bins; bin++) {
            const gain = bin === 0 || bin === bins - 1 ? 1 : 2;
            const magnitude = Math.hypot(real[bin], imag[bin]) * gain / windowSum;
            const power = magnitude * magnitude;
            spectrumPower[bin] += power;
            spectrogramDb[frame * bins + bin] = Math.max(FLOOR_DB, 20 * Math.log10(Math.max(1e-20, magnitude)));
        }
    }
    const spectrumDb = new Float32Array(bins);
    for (let bin = 0; bin < bins; bin++) {
        frequencies[bin] = bin * audio.sampleRate / fftSize;
        spectrumDb[bin] = Math.max(FLOOR_DB, 10 * Math.log10(Math.max(1e-40, spectrumPower[bin] / frameCount)));
    }
    return { ...settings, ...region, sampleRate: audio.sampleRate, windowSamples,
        effectiveWindow: windowSamples < 3 ? 'rectangular-short-region' : 'hann',
        windowSeconds: windowSamples / audio.sampleRate, hopSeconds: hopSize / audio.sampleRate,
        binWidthHz: audio.sampleRate / fftSize, frequencies, spectrumDb, spectrogramDb,
        frameStarts, frameCount, availableFrames, thinned: availableFrames > frameCount,
        amplitudeScale: 'single-sided-peak-amplitude-relative-to-1',
        aggregation: 'rms-of-retained-window-amplitudes',
    };
}

/** Use saved authored timing. These events describe control intent, not measured
 * releases or forced alignment to either audio recording. Word boundaries reuse
 * the planner's existing sample-clock output. */
export function intendedVoiceTimeline(plan) {
    const p = plan?.physiology, frames = plan?.frames, ids = plan?.sequence?.phonemeIds;
    if (!p || !frames || !ids || ids.length > 2048 || !Number.isSafeInteger(p.totalFrames)
        || p.totalFrames < 1 || p.totalFrames > 6000 || frames.frameToPhoneme?.length !== p.totalFrames
        || p.sampleIndex?.length !== p.totalFrames || !Number.isSafeInteger(p.sampleRate) || p.sampleRate <= 0
        || !Number.isFinite(p.frameRateHz) || p.frameRateHz <= 0) {
        throw new TypeError('Intended timing requires the complete saved authored frame and sample clocks.');
    }
    const origin = p.sampleIndex[0];
    if (!Number.isSafeInteger(origin) || origin < 0) throw new RangeError('Invalid saved timeline origin.');
    for (let frame = 0; frame < p.totalFrames; frame++) {
        if (p.sampleIndex[frame] !== origin + Math.round(frame * p.sampleRate / p.frameRateHz)) {
            throw new RangeError('Saved frame and sample clocks disagree.');
        }
    }
    const sampleAt = frame => frame === p.totalFrames ? Math.round(frame * p.sampleRate / p.frameRateHz)
        : p.sampleIndex[frame] - origin;
    const events = [];
    let first = 0, previous = -1;
    while (first < p.totalFrames) {
        const phone = frames.frameToPhoneme[first];
        if (!Number.isInteger(phone) || phone < previous || phone >= ids.length || phone < 0) {
            throw new RangeError('Saved phoneme frame ownership is invalid.');
        }
        let end = first + 1;
        while (end < p.totalFrames && frames.frameToPhoneme[end] === phone) end++;
        events.push({ type: 'phone', label: phonemeAt(ids[phone]).symbol,
            startSample: sampleAt(first), endSample: sampleAt(end), origin: 'planned', confidence: null });
        previous = phone; first = end;
    }
    for (const word of plan.wordBoundaries ?? []) {
        if (!Number.isSafeInteger(word.startSample) || !Number.isSafeInteger(word.endSample)
            || word.startSample < 0 || word.endSample < word.startSample || word.endSample > sampleAt(p.totalFrames)) {
            throw new RangeError('Invalid saved word boundary.');
        }
        events.push({ type: 'word', label: String(word.text), startSample: word.startSample,
            endSample: word.endSample, origin: 'planned', confidence: null });
    }
    if (!Array.isArray(p.releaseBursts) || p.releaseBursts.length > 2048) throw new TypeError('Missing saved release events.');
    for (const event of p.releaseBursts) {
        if (!Number.isInteger(event.frame) || event.frame < 0 || event.frame >= p.totalFrames) {
            throw new RangeError('Invalid saved release frame.');
        }
        const startSample = sampleAt(event.frame);
        events.push({ type: 'release', label: `${event.originManner ?? 'consonant'} release`,
            startSample, endSample: startSample, origin: 'planned', confidence: null });
    }
    return events.sort((a, b) => a.startSample - b.startSample || a.type.localeCompare(b.type));
}

function element(tag, text, parent, attributes = {}) {
    const node = document.createElement(tag);
    if (text !== null) node.textContent = text;
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    if (parent) parent.append(node);
    return node;
}

const STYLE = `
.voice-reference-inspector{color:#243c3a;font:inherit;min-width:0}
.voice-reference-inspector *{box-sizing:border-box}
.voice-reference-inspector p{margin:.45rem 0;font-size:.88rem;line-height:1.5}
.voice-reference-inspector .vri-track-controls{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.voice-reference-inspector fieldset{border:1px solid #cdd9d4;border-radius:12px;padding:12px;margin:8px 0;min-width:0}
.voice-reference-inspector legend{font-weight:700;padding:0 6px}
.voice-reference-inspector .vri-fields{display:flex;gap:8px;flex-wrap:wrap}
.voice-reference-inspector label{display:flex;flex:1 1 95px;flex-direction:column;gap:4px;font-size:.82rem}
.voice-reference-inspector input,.voice-reference-inspector select{min-width:0;width:100%;padding:8px;border:1px solid #b9ccc5;border-radius:6px;color:#243c3a;background:#fff;font:inherit}
.voice-reference-inspector button{font:inherit;border:1px solid #9bb9af;background:#fff;color:#184d46;padding:9px 12px;border-radius:7px;cursor:pointer}
.voice-reference-inspector button:disabled{cursor:default;opacity:.5}
.voice-reference-inspector button:focus-visible,.voice-reference-inspector input:focus-visible,.voice-reference-inspector select:focus-visible,.voice-reference-inspector canvas:focus-visible{outline:3px solid #206fba;outline-offset:3px}
.voice-reference-inspector .vri-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:8px 0}
.voice-reference-inspector canvas{display:block;width:100%;max-width:100%;background:#fcfdfb;border:1px solid #d3dfd8;border-radius:8px}
.voice-reference-inspector [data-inspector=waveform]{height:278px;touch-action:none;cursor:crosshair}
.voice-reference-inspector [data-inspector=spectrum]{height:215px}
.voice-reference-inspector [data-inspector=spectrogram]{height:240px}
.voice-reference-inspector details{margin-top:10px;border-top:1px solid #d9e1dc;padding-top:10px}
.voice-reference-inspector summary{cursor:pointer;font-weight:600}
.voice-reference-inspector .vri-events{display:flex;gap:6px;flex-wrap:wrap;max-height:180px;overflow:auto;padding:4px 0}
.voice-reference-inspector .vri-events button{font-size:.78rem;padding:5px 7px;text-align:left}
.voice-reference-inspector [role=status]{min-height:1.4em}
.voice-reference-inspector .vri-empty{padding:18px;background:#f4f7f3;border-radius:10px}
@media(max-width:640px){.voice-reference-inspector .vri-track-controls{grid-template-columns:1fr}}
`;

/** Host owns persistence and playback. The component retains original PCM by
 * read-only reference and creates a new exact sample slice only for audition. */
export function mountVoiceReferenceInspector({ container, onSelection = () => {}, onAudition = () => {},
    onAnchor = () => {}, onSettings = () => {}, onError = () => {} } = {}) {
    if (!(container instanceof Element)) throw new TypeError('A reference inspector container is required.');
    const root = element('section', null, container, { class: 'voice-reference-inspector', 'aria-label': 'Saved sound comparison' });
    element('style', STYLE, root);
    const intro = element('p', 'Choose a short part of either recording. Listen to the selection, then compare its timing and sound energy.', root);
    element('p', 'Selections can click at their cut edges; check the complete recording before judging a click.', root);
    const empty = element('p', 'Inspect a saved generated sound or load a reference to begin.', root, { class: 'vri-empty' });
    const content = element('div', null, root);
    const waveform = element('canvas', 'Waveforms share a seconds axis. Use the sample controls below to select a region.', content,
        { 'data-inspector': 'waveform', 'data-experiment': 'waveform', role: 'img', 'aria-label': 'Generated and reference waveforms on a shared seconds axis' });
    const axisDescription = element('p', '', content, { 'data-inspector': 'axis-description' });
    const zoomActions = element('div', null, content, { class: 'vri-actions' });
    const fit = element('button', 'Fit selections', zoomActions, { type: 'button', 'data-inspector': 'fit-selections' });
    const whole = element('button', 'Whole recordings', zoomActions, { type: 'button', 'data-inspector': 'whole-recordings' });
    const controls = element('div', null, content, { class: 'vri-track-controls' });
    const tracks = {};
    for (const key of ['generated', 'reference']) {
        const fieldset = element('fieldset', null, controls);
        element('legend', key === 'generated' ? 'Generated sound' : 'Reference recording', fieldset);
        const metadata = element('p', '', fieldset, { 'data-inspector': `${key}-metadata` });
        const row = element('div', null, fieldset, { class: 'vri-fields' });
        const secondInputs = {};
        for (const [field, label] of [['startSample', 'Start (s)'], ['endSample', 'End (s)'], ['anchorSample', 'Match point (s)']]) {
            const wrapped = element('label', label, row);
            secondInputs[field] = element('input', null, wrapped, { type: 'number', step: 'any', min: '0',
                'data-inspector': `${key}-${field.replace('Sample', 'Seconds')}`, 'aria-label': `${key} ${label.replace(' (s)', '')} in seconds` });
        }
        const sampleDetails = element('details', null, fieldset);
        element('summary', 'Exact sample boundaries', sampleDetails);
        const sampleRow = element('div', null, sampleDetails, { class: 'vri-fields' });
        const inputs = {};
        for (const [field, label] of [['startSample', 'Start sample'], ['endSample', 'End sample'], ['anchorSample', 'Alignment sample']]) {
            const wrapped = element('label', label, sampleRow);
            inputs[field] = element('input', null, wrapped, { type: 'number', step: '1', min: '0',
                'data-inspector': `${key}-${field}`, 'aria-label': `${key} ${label.toLowerCase()}` });
        }
        const rangeText = element('p', '', fieldset, { 'data-inspector': `${key}-range` });
        const actions = element('div', null, fieldset, { class: 'vri-actions' });
        const play = element('button', 'Play selection', actions, { type: 'button', 'data-inspector': `${key}-play` });
        const reset = element('button', 'First 10 seconds', actions, { type: 'button', 'data-inspector': `${key}-reset` });
        tracks[key] = { fieldset, metadata, inputs, secondInputs, rangeText, play, reset };
    }
    const actions = element('div', null, content, { class: 'vri-actions' });
    const align = element('button', 'Align marked samples', actions, { type: 'button', 'data-inspector': 'align' });
    const clearAlign = element('button', 'Use recording starts', actions, { type: 'button', 'data-inspector': 'clear-alignment' });
    const alignment = element('p', '', content, { 'data-inspector': 'alignment' });
    const soundDetails = element('details', null, content);
    element('summary', 'Compare sound energy', soundDetails);
    const fftLabel = element('label', 'Detail level', soundDetails);
    const fftSelect = element('select', null, fftLabel, { 'data-inspector': 'fft-size' });
    for (const size of FFT_SIZES) element('option', `${size} samples${size === 1024 ? ' · balanced' : ''}`, fftSelect, { value: String(size) });
    const spectrum = element('canvas', 'Average spectra of the selected regions. Both traces use the same frequency and amplitude scales.', soundDetails,
        { 'data-inspector': 'spectrum', role: 'img', 'aria-label': 'Selected-region spectra with a common amplitude scale' });
    const spectrogram = element('canvas', 'Selected-region spectrograms. Brightness uses a shared amplitude scale.', soundDetails,
        { 'data-inspector': 'spectrogram', role: 'img', 'aria-label': 'Selected-region spectrograms with a common seconds and frequency scale' });
    const analysisText = element('p', '', soundDetails, { 'data-inspector': 'analysis-metadata' });
    const timingDetails = element('details', null, content);
    element('summary', 'Timing markers', timingDetails);
    element('p', 'Generated markers are planned word, phone and release times. Reference markers are manual annotations. They do not establish measured or automatic alignment.', timingDetails);
    const eventLists = {};
    for (const key of ['generated', 'reference']) {
        element('p', key === 'generated' ? 'Planned generated timing' : 'Manual reference timing', timingDetails);
        eventLists[key] = element('div', null, timingDetails, { class: 'vri-events', 'data-inspector': `${key}-events` });
    }
    const status = element('p', '', root, { role: 'status', 'aria-live': 'polite', 'data-inspector': 'status' });
    let sources = { generated: null, reference: null }, regions = { generated: null, reference: null };
    let analysis = { ...DEFAULT_ANALYSIS }, results = {}, offset = 0, aligned = false;
    let disabled = false, playing = false, destroyed = false, drawing = 0, drag = null;
    let axis = { start: 0, end: 1 }, activeTrack = 'generated', waveCache = null, view = 'selections';

    const emit = (callback, value) => {
        try { Promise.resolve(callback(value)).catch(reportError); } catch (error) { reportError(error); }
    };
    function reportError(error) {
        if (destroyed) return;
        status.textContent = error?.message ?? String(error);
        try { onError(error); } catch { /* Preserve the original visible error. */ }
    }
    const payload = key => ({ source: key, id: sources[key].id ?? null, hash: sources[key].hash ?? null,
        ...regions[key], sampleRate: sources[key].sampleRate });
    const getSelection = () => ({ generated: regions.generated ? { ...regions.generated } : null,
        reference: regions.reference ? { ...regions.reference } : null, alignmentOffsetSeconds: offset, alignmentEnabled: aligned,
        analysis: { ...analysis } });
    function updateAlignment() {
        offset = aligned && sources.generated && sources.reference
            ? regions.generated.anchorSample / sources.generated.sampleRate - regions.reference.anchorSample / sources.reference.sampleRate : 0;
    }
    function applyRegion(key, proposed, notify = true) {
        const next = regionShape(sources[key], proposed);
        if (regions[key]?.anchorSample !== next.anchorSample && aligned) {
            aligned = false;
            status.textContent = 'The alignment sample changed. Align the marked samples again to apply the new manual offset.';
        }
        regions[key] = next; results[key] = null; updateAlignment(); refresh();
        if (notify) emit(onSelection, payload(key));
    }
    function canvasSize(canvas, height) {
        const width = Math.max(320, Math.min(1600, Math.round(canvas.getBoundingClientRect().width || 800)));
        if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
        return { ctx: canvas.getContext('2d'), width, height };
    }
    const xAt = (seconds, width) => 48 + (seconds - axis.start) / (axis.end - axis.start) * (width - 64);
    function grid(ctx, width, height, top, bottom, frequency = false, maximum = 1) {
        ctx.strokeStyle = '#dae4de'; ctx.fillStyle = '#526962'; ctx.font = '11px system-ui';
        for (let i = 0; i <= 4; i++) {
            const x = 48 + i / 4 * (width - 64);
            ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
            const value = frequency ? i / 4 * maximum : axis.start + i / 4 * (axis.end - axis.start);
            ctx.fillText(frequency ? `${(value / 1000).toFixed(1)}k` : `${value.toFixed(2)}s`, Math.min(width - 45, x - 12), height - 8);
        }
    }
    function drawWaveform() {
        const { ctx, width, height } = canvasSize(waveform, 278);
        ctx.clearRect(0, 0, width, height); grid(ctx, width, height, 12, 250);
        const cacheKey = `${width}:${axis.start}:${axis.end}:${offset}`;
        let waveformPeak = waveCache?.key === cacheKey ? waveCache.peak : 1;
        // Exact min/max buckets preserve a one-sample release even on long PCM.
        // Work is one bounded linear scan per redraw, no audio-sized allocation.
        const envelopes = waveCache?.key === cacheKey ? waveCache.envelopes : {};
        const columns = width - 64;
        for (const key of ['generated', 'reference']) {
            const source = sources[key]; if (!source || envelopes[key]) continue;
            const min = new Float32Array(columns).fill(Infinity), max = new Float32Array(columns).fill(-Infinity);
            const timeOffset = key === 'reference' ? offset : 0;
            const firstSample = Math.max(0, Math.ceil((axis.start - timeOffset) * source.sampleRate));
            const lastSample = Math.min(source.pcm.length, Math.ceil((axis.end - timeOffset) * source.sampleRate));
            for (let index = firstSample; index < lastSample; index++) {
                const value = source.pcm[index];
                if (!Number.isFinite(value)) continue;
                const column = Math.min(columns - 1, Math.max(0, Math.floor(xAt(index / source.sampleRate + timeOffset, width) - 48)));
                if (value < min[column]) min[column] = value;
                if (value > max[column]) max[column] = value;
                waveformPeak = Math.max(waveformPeak, Math.abs(value));
            }
            envelopes[key] = { min, max };
        }
        waveCache = { key: cacheKey, peak: waveformPeak, envelopes };
        for (const [track, key] of ['generated', 'reference'].entries()) {
            const y = 64 + track * 124, source = sources[key];
            ctx.fillStyle = COLORS[key]; ctx.font = 'bold 12px system-ui';
            ctx.fillText(key === 'generated' ? 'Generated' : 'Reference', 8, y - 45);
            if (!source) { ctx.fillText('No recording loaded', 80, y); continue; }
            const timeOffset = key === 'reference' ? offset : 0, region = regions[key];
            ctx.save(); ctx.beginPath(); ctx.rect(48, y - 39, width - 64, 91); ctx.clip();
            const startX = xAt(region.startSample / source.sampleRate + timeOffset, width);
            const endX = xAt(region.endSample / source.sampleRate + timeOffset, width);
            ctx.fillStyle = key === 'generated' ? '#176f6720' : '#a64c2120'; ctx.fillRect(startX, y - 38, Math.max(1, endX - startX), 76);
            ctx.strokeStyle = COLORS[key]; ctx.beginPath();
            const envelope = envelopes[key];
            for (let column = 0; column < columns; column++) {
                if (!Number.isFinite(envelope.min[column])) continue;
                ctx.moveTo(column + 48, y - envelope.min[column] / waveformPeak * 32);
                ctx.lineTo(column + 48, y - envelope.max[column] / waveformPeak * 32);
            }
            ctx.stroke();
            const anchorX = xAt(region.anchorSample / source.sampleRate + timeOffset, width);
            ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(anchorX, y - 38); ctx.lineTo(anchorX, y + 38); ctx.stroke(); ctx.setLineDash([]);
            for (const event of source.events) {
                const eventX = xAt(event.startSample / source.sampleRate + timeOffset, width);
                if (event.type === 'release' || event.type === 'event') {
                    ctx.beginPath(); ctx.moveTo(eventX, y + 33); ctx.lineTo(eventX, y + 47); ctx.stroke();
                } else {
                    const end = xAt(event.endSample / source.sampleRate + timeOffset, width);
                    ctx.globalAlpha = event.type === 'word' ? 0.8 : 0.4;
                    ctx.fillStyle = COLORS[key]; ctx.fillRect(eventX, y + (event.type === 'word' ? 39 : 44), Math.max(1, end - eventX - 1), 3); ctx.globalAlpha = 1;
                }
            }
            ctx.restore();
        }
        axisDescription.textContent = `Shared seconds axis ${axis.start.toFixed(3)} to ${axis.end.toFixed(3)} s and amplitude range ±${waveformPeak.toFixed(2)}. Drag a recording to select up to 10 seconds, or enter its start and end times below. Dashed lines mark match points.`;
    }
    function analyze() {
        for (const key of ['generated', 'reference']) {
            if (sources[key] && !results[key]) results[key] = analyzeVoiceRegion(sources[key], { ...regions[key], ...analysis });
        }
    }
    function drawSpectra() {
        if (!soundDetails.open) return;
        try { analyze(); } catch (error) { reportError(error); return; }
        const available = Object.values(results).filter(Boolean);
        if (!available.length) return;
        const maxHz = Math.min(...available.map(result => result.sampleRate / 2));
        const { ctx, width, height } = canvasSize(spectrum, 215);
        ctx.clearRect(0, 0, width, height); grid(ctx, width, height, 15, 184, true, maxHz);
        ctx.font = '11px system-ui';
        for (let db = FLOOR_DB; db <= 0; db += 25) {
            const y = 15 + -db / -FLOOR_DB * 168; ctx.fillStyle = '#526962'; ctx.fillText(`${db}`, 6, y + 3);
            ctx.strokeStyle = '#e3e9e4'; ctx.beginPath(); ctx.moveTo(48, y); ctx.lineTo(width - 16, y); ctx.stroke();
        }
        for (const key of ['generated', 'reference']) {
            const result = results[key]; if (!result) continue;
            ctx.strokeStyle = COLORS[key]; ctx.lineWidth = 1.6; ctx.beginPath();
            for (let bin = 0; bin < result.frequencies.length && result.frequencies[bin] <= maxHz; bin++) {
                const x = 48 + result.frequencies[bin] / maxHz * (width - 64);
                const y = 15 + -Math.min(0, result.spectrumDb[bin]) / -FLOOR_DB * 168;
                if (bin === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.stroke();
        }
        const heat = canvasSize(spectrogram, 240), hctx = heat.ctx;
        hctx.clearRect(0, 0, heat.width, heat.height); grid(hctx, heat.width, heat.height, 12, 211);
        for (const [track, key] of ['generated', 'reference'].entries()) {
            const result = results[key]; if (!result) continue;
            const top = 18 + track * 103, sourceOffset = key === 'reference' ? offset : 0;
            hctx.fillStyle = COLORS[key]; hctx.font = '11px system-ui'; hctx.fillText(key === 'generated' ? 'Gen.' : 'Ref.', 5, top + 13);
            hctx.fillText(`${(maxHz / 1000).toFixed(0)}k`, 9, top + 28); hctx.fillText('0', 15, top + 85);
            hctx.save(); hctx.beginPath(); hctx.rect(48, top + 16, heat.width - 64, 72); hctx.clip();
            const bins = result.frequencies.length;
            for (let frame = 0; frame < result.frameCount; frame++) {
                const frameStart = result.frameStarts[frame];
                const next = frame + 1 < result.frameCount ? result.frameStarts[frame + 1] : result.endSample;
                const x = xAt(frameStart / result.sampleRate + sourceOffset, heat.width);
                const right = xAt(next / result.sampleRate + sourceOffset, heat.width);
                for (let row = 0; row < 72; row++) {
                    const lowBin = Math.max(0, Math.floor((1 - (row + 1) / 72) * maxHz / result.binWidthHz));
                    const highBin = Math.min(bins - 1, Math.ceil((1 - row / 72) * maxHz / result.binWidthHz));
                    // Display-bin maxima retain narrow tones and release bands
                    // that nearest-bin sampling could omit entirely.
                    let bandDb = FLOOR_DB;
                    for (let bin = lowBin; bin <= highBin; bin++) bandDb = Math.max(bandDb, result.spectrogramDb[frame * bins + bin]);
                    const level = Math.max(0, Math.min(1, (bandDb - FLOOR_DB) / -FLOOR_DB));
                    hctx.fillStyle = `rgb(${Math.round(14 + level * 239)},${Math.round(33 + level * 199)},${Math.round(45 + level * 123)})`;
                    hctx.fillRect(x, top + 16 + row, Math.max(1, right - x + 0.25), 1);
                }
            }
            hctx.restore();
        }
        analysisText.textContent = available.map(result => {
            const key = results.generated === result ? 'Generated' : 'Reference';
            return `${key}: ${result.windowSamples} sample ${result.effectiveWindow === 'hann' ? 'Hann' : 'rectangular short-region'} window (${(result.windowSeconds * 1000).toFixed(2)} ms), ${result.fftSize} point FFT, ${result.hopSize} sample hop (${(result.hopSeconds * 1000).toFixed(2)} ms), ${result.binWidthHz.toFixed(2)} Hz bins; ${result.frameCount} of ${result.availableFrames} windows${result.thinned ? ' retained evenly across the selection' : ''}.`;
        }).join(' ') + ` Both use −100 to 0 dB relative to amplitude 1, with no per-recording normalization. The line is RMS across retained window amplitudes; brightness shows the strongest FFT bin in each displayed frequency band across its represented time interval. Frequencies extend to the lower Nyquist limit (${maxHz} Hz). Values above 0 dB are visually capped.`;
    }
    function scheduleDraw() {
        if (drawing || destroyed) return;
        drawing = requestAnimationFrame(() => { drawing = 0; if (!destroyed) { drawWaveform(); drawSpectra(); } });
    }
    function refresh() {
        if (destroyed) return;
        const any = Boolean(sources.generated || sources.reference);
        empty.hidden = any; content.hidden = !any; intro.hidden = !any;
        updateAlignment();
        const spans = ['generated', 'reference'].filter(key => sources[key]).map(key => {
            const source = sources[key], region = regions[key], shift = key === 'reference' ? offset : 0;
            return view === 'selections' ? [region.startSample / source.sampleRate + shift, region.endSample / source.sampleRate + shift]
                : [shift, source.pcm.length / source.sampleRate + shift];
        });
        axis.start = spans.length ? Math.min(...spans.map(span => span[0])) : 0;
        axis.end = Math.max(spans.length ? Math.max(...spans.map(span => span[1])) : 1, axis.start + .000001);
        fit.disabled = disabled || playing || !any; whole.disabled = disabled || playing || !any;
        fit.setAttribute('aria-pressed', String(view === 'selections')); whole.setAttribute('aria-pressed', String(view === 'whole'));
        for (const key of ['generated', 'reference']) {
            const track = tracks[key], source = sources[key], region = regions[key];
            track.fieldset.disabled = disabled || playing || !source;
            track.metadata.textContent = source ? `${source.label || (key === 'generated' ? 'Saved generated PCM' : 'Saved reference PCM')} · ${source.sampleRate} Hz · ${(source.pcm.length / source.sampleRate).toFixed(3)} s` : 'No recording loaded';
            for (const [field, input] of Object.entries(track.inputs)) {
                input.value = region ? String(region[field]) : '';
                input.max = String(source ? source.pcm.length - (field === 'endSample' ? 0 : 1) : 0);
                const seconds = track.secondInputs[field];
                seconds.value = region ? (region[field] / source.sampleRate).toFixed(6) : '';
                seconds.dataset.displayedValue = seconds.value;
                seconds.max = source ? String((source.pcm.length - (field === 'endSample' ? 0 : 1)) / source.sampleRate) : '0';
            }
            track.rangeText.textContent = region ? `${(region.startSample / source.sampleRate).toFixed(6)}–${(region.endSample / source.sampleRate).toFixed(6)} s · ${region.endSample - region.startSample} original samples. End sample is excluded.` : '';
            track.play.disabled = disabled || playing || !source;
            track.reset.textContent = source && source.pcm.length <= MAX_SECONDS * source.sampleRate ? 'Whole recording' : 'First 10 seconds';
        }
        fftSelect.value = String(analysis.fftSize); fftSelect.disabled = disabled || playing;
        align.disabled = disabled || playing || !sources.generated || !sources.reference;
        clearAlign.disabled = disabled || playing || !aligned;
        alignment.textContent = aligned ? `Manual alignment: reference display offset ${offset >= 0 ? '+' : ''}${offset.toFixed(6)} seconds. Original samples and recording clocks are unchanged.`
            : 'Both recordings start at zero. Set a match point in each recording, then align those moments to compare them. Times in the controls always use each original recording’s clock.';
        for (const list of Object.values(eventLists)) for (const button of list.querySelectorAll('button')) button.disabled = disabled || playing;
        scheduleDraw();
    }
    function renderEvents() {
        for (const key of ['generated', 'reference']) {
            const list = eventLists[key]; list.replaceChildren();
            if (!sources[key]?.events.length) { list.textContent = key === 'generated' ? 'No saved planned markers available.' : 'No manual reference markers saved.'; continue; }
            for (const event of sources[key].events) {
                const source = sources[key];
                const certainty = event.confidence == null ? '' : ` · confidence ${event.confidence}`;
                const label = `${key === 'generated' ? 'Planned' : 'Manual'} ${event.type}: ${event.label} · ${(event.startSample / source.sampleRate).toFixed(3)}–${(event.endSample / source.sampleRate).toFixed(3)} s${certainty}`;
                const button = element('button', label, list, { type: 'button', 'aria-label': `Select ${label}` });
                button.addEventListener('click', () => {
                    const margin = Math.round(source.sampleRate * .04);
                    const startSample = Math.min(source.pcm.length - 1, Math.max(0, event.startSample - (event.endSample === event.startSample ? margin : 0)));
                    const endSample = Math.min(source.pcm.length, startSample + MAX_SECONDS * source.sampleRate,
                        Math.max(startSample + 1, event.endSample + (event.endSample === event.startSample ? margin : 0)));
                    applyRegion(key, { startSample, endSample, anchorSample: Math.min(endSample - 1, event.startSample) });
                    tracks[key].play.focus();
                });
            }
        }
    }
    function setSources({ generated = null, reference = null, analysis: incomingAnalysis = DEFAULT_ANALYSIS,
        alignmentOffsetSeconds = null, alignmentEnabled } = {}) {
        const next = { generated, reference }, nextRegions = {};
        const checkedSettings = settingsShape(incomingAnalysis);
        for (const key of ['generated', 'reference']) {
            if (!next[key]) { nextRegions[key] = null; continue; }
            audioShape(next[key]);
            const source = next[key];
            if (source.pcm.byteLength > 32 * 1024 * 1024) throw new RangeError('Inspector recordings are limited to 32 MiB of original PCM each.');
            if (!Array.isArray(source.events ?? []) || (source.events?.length ?? 0) > 8192) throw new RangeError('Too many timing markers.');
            const events = (source.events ?? []).map(event => {
                if (!['word', 'phone', 'release', 'event'].includes(event.type)
                    || !Number.isSafeInteger(event.startSample) || !Number.isSafeInteger(event.endSample)
                    || event.startSample < 0 || event.endSample < event.startSample || event.endSample > source.pcm.length
                    || event.startSample > source.pcm.length || typeof event.label !== 'string' || event.label.length > 1000
                    || (event.confidence != null && (!Number.isFinite(event.confidence) || event.confidence < 0 || event.confidence > 1))) {
                    throw new RangeError('Invalid sample-clock timing marker.');
                }
                return { ...event };
            });
            next[key] = { ...source, events };
            nextRegions[key] = regionShape(source, source.region);
        }
        const hasAnchors = generated?.region?.anchorSample !== undefined && reference?.region?.anchorSample !== undefined;
        if (alignmentEnabled !== undefined && (typeof alignmentEnabled !== 'boolean' || (alignmentEnabled && !hasAnchors))) {
            throw new RangeError('Enabled alignment requires exact saved alignment samples for both recordings.');
        }
        const nextAligned = alignmentEnabled ?? hasAnchors;
        if (alignmentOffsetSeconds !== null && (!Number.isFinite(alignmentOffsetSeconds) || !hasAnchors)) {
            throw new RangeError('A display offset requires exact saved alignment samples for both recordings.');
        }
        const derivedOffset = nextAligned ? nextRegions.generated.anchorSample / generated.sampleRate - nextRegions.reference.anchorSample / reference.sampleRate : 0;
        if (alignmentOffsetSeconds !== null && Math.abs(alignmentOffsetSeconds - derivedOffset) > 1e-9) {
            throw new RangeError('Display offset disagrees with saved sample anchors.');
        }
        sources = next; regions = nextRegions; analysis = checkedSettings; aligned = nextAligned;
        results = {}; waveCache = null; status.textContent = ''; renderEvents(); refresh();
    }
    for (const key of ['generated', 'reference']) {
        const track = tracks[key];
        for (const [field, input] of Object.entries(track.secondInputs)) input.addEventListener('change', () => {
            if (disabled || playing || !sources[key] || input.value === input.dataset.displayedValue) return;
            try {
                if (!input.value.trim() || !Number.isFinite(Number(input.value))) throw new RangeError('Enter a finite time in seconds.');
                const source = sources[key], region = regions[key];
                const low = field === 'anchorSample' ? region.startSample : 0;
                const high = field === 'anchorSample' ? region.endSample - 1 : source.pcm.length - (field === 'endSample' ? 0 : 1);
                const value = Math.max(low, Math.min(high, Math.round(Number(input.value) * source.sampleRate)));
                const next = { ...region, [field]: value };
                if (field !== 'anchorSample' && (next.anchorSample < next.startSample || next.anchorSample >= next.endSample)) next.anchorSample = next.startSample;
                applyRegion(key, next);
            } catch (error) { reportError(error); refresh(); }
        });
        for (const [field, input] of Object.entries(track.inputs)) input.addEventListener('change', () => {
            if (disabled || playing || !sources[key]) return;
            try {
                const next = { ...regions[key], [field]: Number(input.value) };
                if (field !== 'anchorSample' && (next.anchorSample < next.startSample || next.anchorSample >= next.endSample)) next.anchorSample = next.startSample;
                applyRegion(key, next);
            } catch (error) { reportError(error); refresh(); }
        });
        track.reset.addEventListener('click', () => applyRegion(key, {}));
        track.play.addEventListener('click', async () => {
            if (disabled || playing || !sources[key]) return;
            const source = sources[key], region = regions[key];
            playing = true; refresh();
            status.textContent = `Playing the selected ${key} samples…`;
            try {
                await onAudition({ ...payload(key), audio: { pcm: source.pcm.slice(region.startSample, region.endSample), sampleRate: source.sampleRate } });
                if (!destroyed) status.textContent = 'Selection playback finished. This preview does not count as a full listening-test play.';
            } catch (error) { reportError(error); }
            finally { playing = false; refresh(); }
        });
    }
    align.addEventListener('click', () => {
        aligned = true; updateAlignment(); refresh();
        emit(onAnchor, { generatedSample: regions.generated.anchorSample, referenceSample: regions.reference.anchorSample });
    });
    clearAlign.addEventListener('click', () => {
        aligned = false; offset = 0; refresh(); emit(onAnchor, { generatedSample: null, referenceSample: null });
    });
    fftSelect.addEventListener('change', () => {
        analysis = settingsShape({ fftSize: Number(fftSelect.value), hopSize: Number(fftSelect.value) / 4 });
        results = {}; refresh(); emit(onSettings, { ...analysis });
    });
    fit.addEventListener('click', () => { view = 'selections'; refresh(); });
    whole.addEventListener('click', () => { view = 'whole'; refresh(); });
    waveform.addEventListener('pointerdown', event => {
        if (disabled || playing || event.button !== 0) return;
        const rect = waveform.getBoundingClientRect();
        const y = (event.clientY - rect.top) * 278 / rect.height;
        activeTrack = y < 130 ? 'generated' : 'reference';
        if (!sources[activeTrack]) return;
        const sample = pointerSample(event, activeTrack);
        drag = { key: activeTrack, start: sample, pointerId: event.pointerId };
        waveform.setPointerCapture(event.pointerId);
    });
    function pointerSample(event, key) {
        const rect = waveform.getBoundingClientRect();
        const width = waveform.width, x = (event.clientX - rect.left) / rect.width * width;
        const seconds = axis.start + Math.max(0, Math.min(1, (x - 48) / (width - 64))) * (axis.end - axis.start);
        const source = sources[key];
        return Math.max(0, Math.min(source.pcm.length - 1, Math.round((seconds - (key === 'reference' ? offset : 0)) * source.sampleRate)));
    }
    waveform.addEventListener('pointerup', event => {
        if (!drag || drag.pointerId !== event.pointerId) return;
        const selected = drag; drag = null;
        if (disabled || playing) return;
        const last = pointerSample(event, selected.key), source = sources[selected.key];
        const startSample = Math.min(selected.start, last);
        const endSample = Math.min(source.pcm.length, startSample + MAX_SECONDS * source.sampleRate, Math.max(selected.start, last) + 1);
        applyRegion(selected.key, { startSample, endSample, anchorSample: startSample });
    });
    waveform.addEventListener('pointercancel', () => { drag = null; });
    soundDetails.addEventListener('toggle', scheduleDraw);
    const observer = new ResizeObserver(scheduleDraw); observer.observe(root);
    refresh();
    return { setSources, getSelection, setDisabled(value) { disabled = Boolean(value); refresh(); },
        destroy() { destroyed = true; observer.disconnect(); if (drawing) cancelAnimationFrame(drawing); root.remove(); sources = {}; results = {}; } };
}
