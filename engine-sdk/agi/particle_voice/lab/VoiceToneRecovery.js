// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { fft, ifft, hannWindow, signalRms } from '../../../engine/core/math/MathSignal.js';
import { phonemeAt } from '../frontend/PhonemeSet.js';

export const VOICE_TONE_VERSION = 'particle-voice-tone-recovery-v1';
export const VOICE_TONE_RATIOS = Object.freeze({ low: 2 ** (-3 / 12), mid: 1, high: 2 ** (3 / 12) });
const PERIOD_FIELDS = ['t0Samples', 'teSamples', 'tpSamples', 'taSamples'];
const VOWELS = new Set(['AA', 'AE', 'AH', 'AO', 'EH', 'IH', 'IY', 'UH', 'UW']);
const MAX_SECONDS = 60;
const LOG_GAIN = Math.log(10) / 20;

function abort(signal) { if (signal?.aborted) throw new DOMException('Tone comparison cancelled.', 'AbortError'); }
function finiteArray(array, length, label) {
    if (!ArrayBuffer.isView(array) || array instanceof DataView || array.length !== length) {
        throw new TypeError(`${label} must contain ${length} numeric samples.`);
    }
    for (const value of array) if (!Number.isFinite(value)) throw new RangeError(`${label} contains a nonfinite value.`);
}
function checkedPlan(plan) {
    const p = plan?.physiology, frames = plan?.frames, ids = plan?.sequence?.phonemeIds;
    if (!p || !frames || !ids?.length || !Number.isInteger(p.sampleRate) || p.sampleRate < 8000 || p.sampleRate > 96000
        || !Number.isFinite(p.frameRateHz) || p.frameRateHz <= 0 || p.frameRateHz > 1000
        || !Number.isInteger(p.totalFrames) || p.totalFrames <= 0 || p.totalFrames / p.frameRateHz > MAX_SECONDS
        || frames.totalFrames !== p.totalFrames || frames.frameRateHz !== p.frameRateHz) {
        throw new RangeError('Tone comparison requires a complete plan of at most 60 seconds at 8–96 kHz.');
    }
    finiteArray(frames.frameToPhoneme, p.totalFrames, 'Phone clock');
    finiteArray(p.sampleIndex, p.totalFrames, 'Sample clock');
    for (const field of [...PERIOD_FIELDS, 'ee', 'nasalCoupling', 'constrictionAmplitude', 'constrictionIndex', 'releaseAspiration']) {
        finiteArray(p[field], p.totalFrames, field);
    }
    if (!Number.isInteger(p.numSections) || p.numSections < 2 || p.numSections > 128) throw new RangeError('Invalid tract geometry.');
    finiteArray(p.areas, p.totalFrames * p.numSections, 'Tract areas');
    if (p.areas.some(area => area <= 0) || !Number.isSafeInteger(p.sampleIndex[0]) || p.sampleIndex[0] < 0) {
        throw new RangeError('Tract areas must be positive and the starting sample must be a nonnegative integer.');
    }
    for (let f = 0; f < p.totalFrames; f++) {
        const phone = frames.frameToPhoneme[f];
        if (!Number.isInteger(phone) || phone < 0 || phone >= ids.length
            || (f && phone < frames.frameToPhoneme[f - 1])
            || p.sampleIndex[f] !== p.sampleIndex[0] + Math.round(f * p.sampleRate / p.frameRateHz)) {
            throw new RangeError('Tone comparison requires ordered phones on the original sample clock.');
        }
        phonemeAt(ids[phone]);
        if (PERIOD_FIELDS.some(field => p[field][f] <= 0) || p.tpSamples[f] >= p.teSamples[f]
            || p.teSamples[f] >= p.t0Samples[f] || p.taSamples[f] >= p.t0Samples[f] - p.teSamples[f]) {
            throw new RangeError('LF opening, peak and return times must fit within one period.');
        }
    }
    return p;
}

/** Change pitch in source controls, never by resampling PCM or replanning words. */
export function buildVoiceTonePhysiology(plan, ratio) {
    const original = checkedPlan(plan);
    if (!Number.isFinite(ratio) || ratio < 0.75 || ratio > 1.34) throw new RangeError('Tone ratio must be between 0.75 and 1.34.');
    const copy = structuredClone(original);
    for (const field of PERIOD_FIELDS) for (let f = 0; f < copy.totalFrames; f++) copy[field][f] /= ratio;
    return copy;
}

function eligibleSpans(plan, length, fftSize) {
    const p = plan.physiology, owners = plan.frames.frameToPhoneme;
    const guard = fftSize / 2 + Math.ceil(p.sampleRate * 0.008), fade = Math.ceil(p.sampleRate * 0.008);
    const spans = [];
    for (let start = 0; start < p.totalFrames;) {
        const phoneIndex = owners[start];
        let end = start + 1;
        while (end < p.totalFrames && owners[end] === phoneIndex) end++;
        if (VOWELS.has(phonemeAt(plan.sequence.phonemeIds[phoneIndex]).symbol)) {
            // Split around aspiration, overlapping oral noise or nasalization. The guard
            // erodes each remaining run by more than the complete FFT half-support.
            let run = -1;
            for (let f = start; f <= end; f++) {
                const pure = f < end && p.ee[f] > 0 && p.nasalCoupling[f] === 0
                    && (p.constrictionAmplitude[f] === 0 || (p.constrictionIndex[f] < 0 && p.constrictionAmplitude[f] <= 0.05))
                    && p.releaseAspiration[f] === 0;
                if (pure && run < 0) run = f;
                if (!pure && run >= 0) {
                    const a = Math.round(run * p.sampleRate / p.frameRateHz) + guard;
                    const b = Math.min(length, Math.round(f * p.sampleRate / p.frameRateHz)) - guard;
                    if (b - a > 2 * fade) spans.push({ startSample: a, endSample: b, phoneIndex, fadeSamples: fade });
                    run = -1;
                }
            }
        }
        start = end;
    }
    return spans;
}

function maskFor(spans, length) {
    const mask = new Float32Array(length);
    for (const span of spans) for (let i = span.startSample; i < span.endSample; i++) {
        const edge = Math.min(i - span.startSample, span.endSample - 1 - i);
        mask[i] = edge >= span.fadeSamples ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * edge / span.fadeSamples);
    }
    return mask;
}

function frameSpectrum(pcm, start, window) {
    const real = new Float64Array(window.length), imag = new Float64Array(window.length);
    let energy = 0;
    for (let i = 0; i < window.length; i++) {
        real[i] = (pcm[start + i] ?? 0) * window[i];
        energy += real[i] * real[i];
    }
    fft(real, imag);
    return { real, imag, rms: Math.sqrt(energy / window.length) };
}

// Bounded iterative peak-following cepstral envelope (DAFx 2005 true-envelope
// principle). It is an estimator, not a recovered ground-truth tract response.
function trueEnvelope(spectrum, cutoff) {
    const n = spectrum.real.length, log = new Float64Array(n);
    for (let k = 0; k < n; k++) log[k] = Math.log(Math.max(1e-10,
        Math.hypot(spectrum.real[k], spectrum.imag[k]) / Math.max(1e-10, spectrum.rms)));
    let envelope = log.slice();
    for (let iteration = 0; iteration < 4; iteration++) {
        const real = new Float64Array(n), imag = new Float64Array(n);
        for (let k = 0; k < n; k++) real[k] = Math.max(log[k], envelope[k]);
        ifft(real, imag);
        for (let q = 0; q < n; q++) {
            const distance = Math.min(q, n - q);
            const weight = distance <= cutoff * 0.75 ? 1 : distance >= cutoff ? 0
                : 0.5 + 0.5 * Math.cos(Math.PI * (distance / cutoff - 0.75) / 0.25);
            real[q] *= weight; imag[q] *= weight;
        }
        fft(real, imag);
        envelope = real;
    }
    return envelope;
}

function peak(pcm) { let value = 0; for (const sample of pcm) value = Math.max(value, Math.abs(sample)); return value; }

/** Use auxiliary envelopes only; the middle waveform supplies all complex phase.
 * Final dry masking protects consonants despite imperfect STFT consistency. */
export async function recoverVoiceToneSpectrum({ low, mid, high, plan, strength = 0.25, signal, onProgress = () => {} }) {
    abort(signal);
    const p = checkedPlan(plan), nSamples = mid?.pcm?.length;
    if (!Number.isFinite(strength) || strength < 0 || strength > 1) throw new RangeError('Recovery strength must be 0–1.');
    if (!nSamples || nSamples > (MAX_SECONDS + 0.01) * p.sampleRate) throw new RangeError('Invalid tone PCM length.');
    const plannedSamples = Math.round(p.totalFrames * p.sampleRate / p.frameRateHz);
    if (nSamples < plannedSamples || nSamples - plannedSamples >= p.sampleRate * 0.01) {
        throw new RangeError('Tone PCM must retain the planned duration with less than 10 ms of render padding.');
    }
    for (const item of [low, mid, high]) {
        if (!(item?.pcm instanceof Float32Array) || item.sampleRate !== p.sampleRate) throw new TypeError('All tones require same-rate Float32 PCM.');
        finiteArray(item.pcm, nSamples, 'Tone PCM');
        if (peak(item.pcm) > 1) throw new RangeError('Tone input exceeds digital full scale.');
    }
    const fftSize = 2 ** Math.round(Math.log2(p.sampleRate * 0.064)), hop = fftSize / 4;
    const spans = eligibleSpans(plan, nSamples, fftSize), mask = maskFor(spans, nSamples);
    const receipt = { schemaVersion: VOICE_TONE_VERSION, strength, ratios: { ...VOICE_TONE_RATIOS },
        fftSize, hopSamples: hop, sampleRate: p.sampleRate, sampleCount: nSamples,
        estimator: 'four-iteration-peak-following-tapered-cepstrum', fusion: 'median-level-normalized-log-envelopes',
        phaseSource: 'mid-only', correctionLimitDb: 3, upperBandHz: 6000,
        eligibleSpans: spans, processedFrames: 0, changedSamples: 0, maxCorrectionDb: 0, headroomScale: 1,
        protectedSamplesExact: true, productionPromotion: false, perceptualImprovement: 'unverified' };
    const output = mid.pcm.slice();
    let identical = true;
    for (let i = 0; identical && i < nSamples; i++) identical = low.pcm[i] === mid.pcm[i] && high.pcm[i] === mid.pcm[i];
    if (strength === 0 || !spans.length || identical) {
        receipt.bypassReason = strength === 0 ? 'zero-strength' : identical ? 'identical-inputs' : 'no-guarded-vowel-interior';
        return { pcm: output, receipt };
    }
    console.info('[ParticleVoice][tone-recovery][start]', { samples: nSamples, strength, vowelSpans: spans.length });
    const window = hannWindow(fftSize), delta = new Float64Array(nSamples), weight = new Float64Array(nSamples);
    let previous = null, frameNumber = 0;
    for (let start = -fftSize + hop; start < nSamples; start += hop, frameNumber++) {
        abort(signal);
        for (let i = Math.max(0, -start); i < Math.min(fftSize, nSamples - start); i++) weight[start + i] += window[i] ** 2;
        const center = start + fftSize / 2;
        if (center < 0 || center >= nSamples || !mask[center]) { previous = null; continue; }
        const frame = Math.min(p.totalFrames - 1, Math.floor(center * p.frameRateHz / p.sampleRate));
        const f0 = p.sampleRate / p.t0Samples[frame];
        // Need at least three periods of the lowest probe inside a real window.
        if (fftSize * f0 * VOICE_TONE_RATIOS.low / p.sampleRate < 3) { previous = null; continue; }
        const spectra = [low, mid, high].map(item => frameSpectrum(item.pcm, start, window));
        if (spectra.some(item => item.rms < 1e-6)) { previous = null; continue; }
        const cutoff = Math.max(2, Math.floor(p.sampleRate / (2 * f0 * VOICE_TONE_RATIOS.high)));
        const envelopes = spectra.map(item => trueEnvelope(item, cutoff));
        const correction = new Float64Array(fftSize / 2 + 1), middle = spectra[1];
        for (let k = 1; k < fftSize / 2; k++) {
            const hz = k * p.sampleRate / fftSize;
            const lower = Math.min(1, Math.max(0, (hz - 2 * f0) / Math.max(f0, 100)));
            const upper = Math.min(1, Math.max(0, (6000 - hz) / 1000));
            const a = envelopes[0][k], b = envelopes[1][k], c = envelopes[2][k];
            const median = a + b + c - Math.max(a, b, c) - Math.min(a, b, c);
            const raw = Math.max(-3 * LOG_GAIN, Math.min(3 * LOG_GAIN, strength * (median - b)));
            correction[k] = (previous ? 0.6 * raw + 0.4 * previous[k] : raw) * lower * upper;
            receipt.maxCorrectionDb = Math.max(receipt.maxCorrectionDb, Math.abs(correction[k] / LOG_GAIN));
            // IFFT only the changed component. Unity bins contribute exactly zero.
            const change = Math.exp(correction[k]) - 1;
            middle.real[k] *= change; middle.imag[k] *= change;
            middle.real[fftSize - k] *= change; middle.imag[fftSize - k] *= change;
        }
        middle.real[0] = middle.imag[0] = middle.real[fftSize / 2] = middle.imag[fftSize / 2] = 0;
        ifft(middle.real, middle.imag);
        for (let i = Math.max(0, -start); i < Math.min(fftSize, nSamples - start); i++) delta[start + i] += middle.real[i] * window[i];
        previous = correction;
        receipt.processedFrames++;
        if (receipt.processedFrames % 8 === 0) {
            onProgress({ stage: 'recovering', completed: Math.min(nSamples, center), total: nSamples });
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }
    abort(signal);
    // A single attenuation of the correction supplies headroom without limiting or
    // changing a protected sample. Saved raw PCM remains independently inspectable.
    for (let i = 0; i < nSamples; i++) {
        delta[i] = mask[i] ? mask[i] * delta[i] / Math.max(1e-12, weight[i]) : 0;
        if (delta[i] > 0) receipt.headroomScale = Math.min(receipt.headroomScale, (1 - mid.pcm[i]) / delta[i]);
        if (delta[i] < 0) receipt.headroomScale = Math.min(receipt.headroomScale, (-1 - mid.pcm[i]) / delta[i]);
    }
    for (let i = 0; i < nSamples; i++) if (delta[i]) {
        output[i] = mid.pcm[i] + receipt.headroomScale * delta[i];
        if (!Number.isFinite(output[i])) throw new Error('Tone recovery produced nonfinite PCM.');
        if (output[i] !== mid.pcm[i]) receipt.changedSamples++;
    }
    receipt.outputPeak = peak(output);
    console.info('[ParticleVoice][tone-recovery][complete]', { frames: receipt.processedFrames,
        changedSamples: receipt.changedSamples, maxCorrectionDb: receipt.maxCorrectionDb, headroomScale: receipt.headroomScale });
    return { pcm: output, receipt };
}

/** Render an isolated comparison with the current model; never replace its voice. */
export async function renderVoiceToneComparison({ model, plan, strength = 0.25, signal, onProgress = () => {} }) {
    abort(signal);
    checkedPlan(plan);
    if (!model?.renderPhysiology || model.config?.sampleRate !== plan.physiology.sampleRate
        || model.config?.numSections !== plan.physiology.numSections) throw new TypeError('Plan must match the active model anatomy and sample rate.');
    if (!Number.isFinite(strength) || strength < 0 || strength > 1) throw new RangeError('Recovery strength must be 0–1.');
    const frozen = structuredClone(plan), variants = {};
    const started = performance.now();
    for (const key of ['mid', 'low', 'high']) {
        abort(signal);
        onProgress({ stage: key, completed: Object.keys(variants).length, total: 3 });
        variants[key] = await model.renderPhysiology(buildVoiceTonePhysiology(frozen, VOICE_TONE_RATIOS[key]), { signal });
    }
    const recovered = await recoverVoiceToneSpectrum({ ...variants, plan: frozen, strength, signal, onProgress });
    abort(signal);
    variants.recovered = { ...variants.mid, pcm: recovered.pcm, visualSnapshots: [] };
    const levels = Object.fromEntries(Object.entries(variants).map(([key, render]) => [key, { rms: signalRms(render.pcm), peak: peak(render.pcm) }]));
    const audible = Object.values(levels).filter(item => item.rms > 0);
    const commonRms = audible.length ? Math.min(...audible.map(item => item.rms), ...audible.map(item => 0.95 * item.rms / item.peak)) : 0;
    const auditionGains = Object.fromEntries(Object.entries(levels).map(([key, level]) => [key, level.rms ? commonRms / level.rms : 1]));
    return { sampleRate: frozen.physiology.sampleRate, variants,
        receipt: { ...recovered.receipt, voicePreset: model.config.voicePreset,
            elapsedMs: performance.now() - started, levels, commonRms, auditionGains,
            auditionLevelPolicy: 'whole-clip-equal-RMS-with-common-peak-headroom; raw-WAVs-unchanged',
            frozenFactors: ['phones', 'word-timing', 'tract-areas', 'nasal-geometry', 'pressure', 'noise-controls', 'LF-shape-ratios'],
            sourceCaveat: 'Changing period also changes absolute LF source tilt; this is experimental equalization, not a measured tract repair.' } };
}
