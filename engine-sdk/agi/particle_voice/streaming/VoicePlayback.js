// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * VoicePlayback.js — Phase 3 ParticleVoice audio bridge.
 *
 * The last hop of the Phase 3 path: model PCM → resample → `SharedPCMRing`
 * → `AudioWorklet` → audible speech. Every piece it composes was built and
 * verified in Phase 2; this module only wires them, which is why it is small.
 *
 *   ParticleVoiceModel (its reported sample rate; currently 64 kHz by default)
 *     → PolyphaseResampler (reported rate → AudioContext.sampleRate)
 *     → SafetyLimiter is already applied upstream by the model
 *     → SharedPCMRing (SAB, single-producer/single-consumer)
 *     → ParticleVoiceProcessor (AudioWorkletProcessor)
 *
 * ## The resample is mandatory, not optional
 *
 * The model reports its real DSP rate with each render (64 kHz in the current
 * authored default), while an `AudioContext` picks its own rate — commonly
 * 48 kHz, sometimes 44.1 kHz. Writing samples at the wrong rate does not
 * error; it changes duration and pitch. `PolyphaseResampler` handles each
 * exact-integer L/M ratio (a 32k→48k input reduces to L=3, M=2) and is
 * streaming-correct across chunk boundaries, so feeding it per-utterance or
 * per-chunk gives identical output.
 *
 * ## Backpressure is the producer's problem
 *
 * `writeSharedPCMRing()` CLAMPS to available space and returns how much it
 * actually accepted — it never overwrites unread audio. A producer that
 * ignores the return value silently drops the tail of every utterance that
 * does not fit. `enqueue()` therefore loops, awaiting drain, until everything
 * has been accepted, and reports the total written so a caller can assert it.
 *
 * ## What this module deliberately does NOT do
 *
 * It does not own the `AudioContext`. Creating and resuming one requires a
 * user gesture in a real page, its lifetime belongs to the application, and a
 * test harness needs to build its own — so the context and worklet node are
 * passed in via `attach()`. That also keeps this module testable without
 * assuming any particular page structure.
 */

import {
    createSharedPCMRing, writeSharedPCMRing, resetSharedPCMRing, readAvailable, CONTROL_INDEX,
} from './SharedPCMRing.js';
import { PolyphaseResampler } from './PolyphaseResampler.js';
import { admissionFor, bufferedAheadMsFromRing } from './VoiceDeadlineScheduler.js';

export const DEFAULT_PLAYBACK_CONFIG = Object.freeze({
    /** Ring capacity. One second is generous for utterance-at-a-time playback and cheap (4 bytes/sample). */
    capacitySeconds: 1,
    /** How long to wait between drain polls when the ring is full. */
    drainPollMs: 5,
    /** Maximum stall without progress. Total wait also allows the clip's playback duration. */
    enqueueTimeoutMs: 10000,
    /** Web Audio render quantum. Final partial quanta are zero-padded before drain. */
    outputQuantumSamples: 128,
});

const nowMs = () => globalThis.performance?.now?.() ?? Date.now();

function abortError(reason = 'Particle Voice playback cancelled') {
    if (reason instanceof Error && reason.name === 'AbortError') return reason;
    const message = typeof reason === 'string' && reason.length > 0
        ? reason
        : 'Particle Voice playback cancelled';
    if (typeof DOMException === 'function') return new DOMException(message, 'AbortError');
    const error = new Error(message);
    error.name = 'AbortError';
    return error;
}

export class VoicePlayback {
    /**
     * @param {{ modelSampleRate: number, outputSampleRate: number, capacitySeconds?: number, drainPollMs?: number, enqueueTimeoutMs?: number }} options
     */
    constructor(options) {
        const cfg = { ...DEFAULT_PLAYBACK_CONFIG, ...options };
        const { modelSampleRate, outputSampleRate } = cfg;
        if (!Number.isInteger(modelSampleRate) || modelSampleRate <= 0) throw new RangeError('VoicePlayback: modelSampleRate must be a positive integer');
        if (!Number.isInteger(outputSampleRate) || outputSampleRate <= 0) throw new RangeError('VoicePlayback: outputSampleRate must be a positive integer');
        if (!Number.isInteger(cfg.outputQuantumSamples) || cfg.outputQuantumSamples < 16 || cfg.outputQuantumSamples > 2048) {
            throw new RangeError('VoicePlayback: outputQuantumSamples must be an integer in [16, 2048]');
        }
        if (!Number.isFinite(cfg.drainPollMs) || cfg.drainPollMs < 0 || cfg.drainPollMs > 1000
            || !Number.isFinite(cfg.enqueueTimeoutMs) || cfg.enqueueTimeoutMs < 1 || cfg.enqueueTimeoutMs > 120000) {
            throw new RangeError('VoicePlayback: drainPollMs must be in [0, 1000] and enqueueTimeoutMs in [1, 120000]');
        }
        if (typeof SharedArrayBuffer === 'undefined') {
            throw new Error('VoicePlayback requires SharedArrayBuffer (crossOriginIsolated context)');
        }

        this.config = cfg;
        this.modelSampleRate = modelSampleRate;
        this.outputSampleRate = outputSampleRate;
        // Identity ratio is legal and cheap (L = M = 1); the resampler handles
        // it, so there is no special-case branch to get wrong.
        this.resampler = new PolyphaseResampler(modelSampleRate, outputSampleRate);
        this.ring = createSharedPCMRing({ sampleRate: outputSampleRate, capacitySeconds: cfg.capacitySeconds });
        if (this.ring.capacity <= cfg.outputQuantumSamples) {
            throw new RangeError('VoicePlayback: ring capacity must exceed one output render quantum');
        }
        this._node = null;
        this._destroyed = false;
        this._generation = 0;
        this._acceptedOutputSamples = 0;
        this._operationTail = Promise.resolve();
        this._pollWaiters = new Set();
    }

    /** The SAB views an `AudioWorkletNode`'s `processorOptions` needs. */
    get processorOptions() {
        return { controlBuffer: this.ring.controlBuffer, pcmBuffer: this.ring.pcmBuffer };
    }

    /** Record the worklet node driving this ring, so `metrics()` can report whether a consumer is actually running. */
    attach(node) {
        this._node = node ?? null;
        return this;
    }

    /** Samples currently queued for playback. */
    available() {
        return readAvailable(this.ring.control, this.ring.capacity);
    }

    /**
     * Milliseconds of audio queued ahead of the consumer, plus the
     * `VoiceDeadlineScheduler` tier and the scheduling admission it implies.
     * The returned object is spreadable straight into `NeuralScheduler` /
     * `GpuFrameBudgetBroker` options, which is the shape `admissionFor()` was
     * built to produce.
     */
    runway() {
        const ms = bufferedAheadMsFromRing(this.ring);
        return { bufferedAheadMs: ms, ...admissionFor(ms) };
    }

    metrics() {
        const c = this.ring.control;
        return {
            available: this.available(),
            capacity: this.ring.capacity,
            underruns: Atomics.load(c, CONTROL_INDEX.UNDERRUN_COUNT),
            processCalls: Atomics.load(c, CONTROL_INDEX.PROCESS_CALL_COUNT),
            generation: Atomics.load(c, CONTROL_INDEX.GENERATION),
            writeSequence: Atomics.load(c, CONTROL_INDEX.WRITE_SEQUENCE),
            attached: this._node !== null,
            playbackGeneration: this._generation,
            acceptedOutputSamples: this._acceptedOutputSamples,
            consumedOutputSamples: this._consumedOutputSamples(),
            modelSampleRate: this.modelSampleRate,
            outputSampleRate: this.outputSampleRate,
        };
    }

    /**
     * Resample model-rate PCM to the output rate. Exposed separately so a
     * caller can inspect the conversion (and so tests can verify the rate
     * change independently of the ring).
     *
     * @returns {Float32Array} Output-rate samples.
     */
    resample(modelPcm, { signal = null, generation = this._generation } = {}) {
        this._assertPlaybackActive(signal, generation);
        const out = this.resampler.process(modelPcm);
        this._assertPlaybackActive(signal, generation);
        // PolyphaseResampler works in f64 internally; the ring is f32.
        const f32 = new Float32Array(out.length);
        for (let i = 0; i < out.length; i++) f32[i] = out[i];
        return f32;
    }

    /**
     * Resample and enqueue an utterance, awaiting ring space as needed.
     *
     * @returns {Promise<{written: number, resampled: number}>} `written` must
     * equal `resampled`; it is returned rather than asserted so a caller can
     * decide how to react to a timeout. A timed-out partial write reports
     * `timedOut: true` and revokes its generation, clearing the queued tail.
     */
    async enqueue(modelPcm, { signal = null, generation = this._generation } = {}) {
        this._assertNotDestroyed();
        let started = false;
        const run = () => {
            started = true;
            return this._enqueueModelPcmNow(modelPcm, { signal, generation });
        };
        const abort = () => {
            if (started && !this._destroyed && generation === this._generation) this.cancel();
        };
        signal?.addEventListener('abort', abort, { once: true });
        try {
            return await this._queueOperation(run);
        } finally {
            signal?.removeEventListener('abort', abort);
        }
    }

    async _enqueueModelPcmNow(modelPcm, { signal, generation }) {
        this._assertPlaybackActive(signal, generation);
        const resampleStartedAt = nowMs();
        const samples = this.resample(modelPcm, { signal, generation });
        const resampleMs = nowMs() - resampleStartedAt;
        return this._enqueueResampledNow(samples, { signal, generation, resampleMs });
    }

    async _enqueueResampledNow(samples, { signal, generation, resampleMs = 0 }) {
        this._assertPlaybackActive(signal, generation);
        let offset = 0;
        const startedAt = nowMs();
        // Backpressure is normal while a long clip plays in real time. A fixed
        // wall-clock deadline used to cut off ABCs even with a healthy consumer.
        // Bound both a stalled consumer and the total wait, including audio
        // already ahead of us, without allowing trickle progress to wait forever.
        const deadline = startedAt + this.config.enqueueTimeoutMs
            + ((samples.length + this.available()) / this.outputSampleRate) * 1000;
        let progressDeadline = startedAt + this.config.enqueueTimeoutMs;
        let firstWriteAt = null;
        const startOutputSample = this._acceptedOutputSamples;

        while (offset < samples.length) {
            this._assertPlaybackActive(signal, generation);
            // writeSharedPCMRing clamps to free space and reports what it took;
            // ignoring this return value is how a producer silently truncates
            // every utterance larger than the ring.
            const accepted = writeSharedPCMRing(this.ring, samples.subarray(offset));
            offset += accepted;
            this._acceptedOutputSamples += accepted;
            if (accepted > 0) {
                firstWriteAt ??= nowMs();
                progressDeadline = nowMs() + this.config.enqueueTimeoutMs;
            }
            if (offset >= samples.length) break;
            if (nowMs() >= deadline || nowMs() >= progressDeadline) break;
            // Ring is full: wait for the consumer to drain some.
            await this._waitForPoll(signal, generation);
            this._assertPlaybackActive(signal, generation);
        }
        const timedOut = offset < samples.length;
        if (timedOut) this.cancel();
        return {
            written: offset,
            resampled: samples.length,
            cancelled: false,
            timedOut,
            generation,
            startOutputSample,
            endOutputSample: startOutputSample + offset,
            sampleRate: this.outputSampleRate,
            diagnostics: Object.freeze({
                resampleMs,
                enqueueMs: nowMs() - startedAt,
                firstWriteAt,
                modelSampleRate: this.modelSampleRate,
                outputSampleRate: this.outputSampleRate,
            }),
        };
    }

    /**
     * Discard queued audio and resync the consumer — cancellation/barge-in.
     * Resets the resampler in lockstep so stale pre-reset filter history cannot
     * bleed into the next utterance, which is exactly why
     * `PolyphaseResampler.reset()` exists.
     */
    cancel() {
        this._assertNotDestroyed();
        this._generation += 1;
        resetSharedPCMRing(this.ring);
        this.resampler.reset();
        this._acceptedOutputSamples = 0;
        this._rejectPollWaiters();
        return this._generation;
    }

    /** Wait until queued audio has been consumed (or the timeout elapses). */
    async drain({
        timeoutMs = 10000,
        signal = null,
        generation = this._generation,
        padFinalQuantum = true,
    } = {}) {
        this._assertPlaybackActive(signal, generation);
        const abort = () => {
            if (!this._destroyed && generation === this._generation) this.cancel();
        };
        signal?.addEventListener('abort', abort, { once: true });
        try {
            // ParticleVoiceProcessor consumes complete render quanta. Without
            // this final zero pad, a legitimate 1..127-sample tail would remain
            // queued forever even though all audible samples were delivered.
            if (padFinalQuantum && this.available() > 0) {
                const remainder = this.available() % this.config.outputQuantumSamples;
                if (remainder !== 0) {
                    const padding = new Float32Array(this.config.outputQuantumSamples - remainder);
                    const queued = await this._enqueueResampledNow(padding, { signal, generation });
                    if (queued.timedOut) {
                        const error = new Error('VoicePlayback: final output quantum could not be queued');
                        error.code = 'PARTICLE_VOICE_ENQUEUE_TIMEOUT';
                        throw error;
                    }
                }
            }
            const deadline = Date.now() + timeoutMs;
            while (this.available() > 0 && Date.now() < deadline) {
                await this._waitForPoll(signal, generation);
                this._assertPlaybackActive(signal, generation);
            }
            return this.available();
        } finally {
            signal?.removeEventListener('abort', abort);
        }
    }

    /**
     * Consume a model sentence stream, enqueue it with backpressure, emit word
     * starts from samples actually consumed by the worklet, and resolve only
     * after the final sample drains.  The whole operation owns one generation;
     * cancel()/AbortSignal invalidates synthesis delivery, resampling, polling,
     * callbacks and every later ring write together.
     */
    async playSentenceStream(sentences, {
        signal = null,
        onPlaybackStart = null,
        onWordBoundary = null,
        drainTimeoutMs = 30000,
    } = {}) {
        this._assertNotDestroyed();
        const generation = this._generation;
        const run = () => this._playSentenceStreamNow(sentences, {
            signal, generation, onPlaybackStart, onWordBoundary, drainTimeoutMs,
        });
        return this._queueOperation(run);
    }

    async _playSentenceStreamNow(sentences, {
        signal, generation, onPlaybackStart, onWordBoundary, drainTimeoutMs,
    }) {
        this._assertPlaybackActive(signal, generation);
        if (!sentences || (typeof sentences[Symbol.asyncIterator] !== 'function'
            && typeof sentences[Symbol.iterator] !== 'function')) {
            throw new TypeError('VoicePlayback.playSentenceStream requires an iterable sentence stream');
        }
        if (!Number.isInteger(drainTimeoutMs) || drainTimeoutMs < 1 || drainTimeoutMs > 120000) {
            throw new RangeError('VoicePlayback: drainTimeoutMs must be an integer in [1, 120000]');
        }

        const operationStartedAt = nowMs();
        const pendingBoundaries = [];
        const streamStartOutputSample = this._acceptedOutputSamples;
        let producerDone = false;
        let playbackStarted = false;
        let sentenceCount = 0;
        let modelSamples = 0;
        let outputSamples = 0;
        let emittedBoundaries = 0;
        let callbackErrors = 0;
        let totalResampleMs = 0;
        let totalEnqueueMs = 0;
        let totalNormalizationMs = 0;
        let totalPlanningMs = 0;
        let totalSynthesisMs = 0;
        let totalRenderReadbackMs = 0;
        let totalVisualReadbackMs = 0;
        let firstQueuedMs = null;
        let firstConsumedMs = null;

        const safeCallback = (callback, value) => {
            if (typeof callback !== 'function') return;
            try { callback(value); } catch { callbackErrors += 1; }
        };

        const boundaryPump = (async () => {
            while (!producerDone || pendingBoundaries.length > 0 || !playbackStarted) {
                this._assertPlaybackActive(signal, generation);
                const consumed = this._consumedOutputSamples();
                if (!playbackStarted && consumed > streamStartOutputSample) {
                    playbackStarted = true;
                    firstConsumedMs = nowMs() - operationStartedAt;
                    safeCallback(onPlaybackStart, Object.freeze({
                        generation,
                        outputSampleRate: this.outputSampleRate,
                        consumedOutputSample: consumed,
                        elapsedMs: firstConsumedMs,
                    }));
                    this._assertPlaybackActive(signal, generation);
                }
                while (pendingBoundaries.length > 0 && pendingBoundaries[0].targetOutputSample <= consumed) {
                    const next = pendingBoundaries.shift();
                    emittedBoundaries += 1;
                    safeCallback(onWordBoundary, Object.freeze({
                        ...next.boundary,
                        sentenceIndex: next.sentenceIndex,
                        outputStartSample: next.targetOutputSample,
                        outputEndSample: next.endOutputSample,
                        streamOffsetMs: ((next.targetOutputSample - streamStartOutputSample) / this.outputSampleRate) * 1000,
                        emittedAtConsumedSample: consumed,
                        lateByMs: ((consumed - next.targetOutputSample) / this.outputSampleRate) * 1000,
                        outputSampleRate: this.outputSampleRate,
                    }));
                    this._assertPlaybackActive(signal, generation);
                }
                if (producerDone && pendingBoundaries.length === 0 && playbackStarted) break;
                if (producerDone && this.available() === 0 && !playbackStarted) break;
                await this._waitForPoll(signal, generation);
            }
        })();
        // Cancellation may reject the pump while GPU production is still
        // unwinding. Observe it now; the awaited result below still propagates.
        void boundaryPump.catch(() => {});

        const abort = () => {
            if (!this._destroyed && generation === this._generation) this.cancel();
        };
        signal?.addEventListener('abort', abort, { once: true });

        try {
            for await (const sentence of sentences) {
                this._assertPlaybackActive(signal, generation);
                if (!(sentence?.pcm instanceof Float32Array)) {
                    throw new TypeError('VoicePlayback: sentence pcm must be a Float32Array');
                }
                if (sentence.sampleRate !== this.modelSampleRate) {
                    throw new RangeError(`VoicePlayback: sentence sampleRate ${sentence.sampleRate} does not match modelSampleRate ${this.modelSampleRate}`);
                }

                const resampleStartedAt = nowMs();
                const resampled = this.resample(sentence.pcm, { signal, generation });
                const resampleMs = nowMs() - resampleStartedAt;
                totalResampleMs += resampleMs;
                const sentenceStart = this._acceptedOutputSamples;
                const ratio = this.outputSampleRate / this.modelSampleRate;
                const lastOutput = sentenceStart + Math.max(0, resampled.length - 1);
                const boundaries = Array.isArray(sentence.wordBoundaries) ? sentence.wordBoundaries : [];
                for (const boundary of boundaries) {
                    if (boundary?.spoken !== true || boundary.endSample <= boundary.startSample) continue;
                    const targetOutputSample = Math.min(lastOutput,
                        sentenceStart + Math.max(0, Math.round(boundary.startSample * ratio)));
                    const endOutputSample = Math.min(sentenceStart + resampled.length,
                        sentenceStart + Math.max(0, Math.round(boundary.endSample * ratio)));
                    pendingBoundaries.push({
                        sentenceIndex: Number.isInteger(sentence.index) ? sentence.index : sentenceCount,
                        boundary,
                        targetOutputSample,
                        endOutputSample,
                    });
                }

                const queued = await this._enqueueResampledNow(resampled, {
                    signal, generation, resampleMs,
                });
                if (firstQueuedMs === null && queued.diagnostics.firstWriteAt !== null) {
                    firstQueuedMs = queued.diagnostics.firstWriteAt - operationStartedAt;
                }
                if (queued.written !== queued.resampled) {
                    const error = new Error(`VoicePlayback: enqueue timed out after ${queued.written}/${queued.resampled} samples`);
                    error.code = 'PARTICLE_VOICE_ENQUEUE_TIMEOUT';
                    throw error;
                }
                sentenceCount += 1;
                modelSamples += sentence.pcm.length;
                outputSamples += queued.written;
                totalEnqueueMs += queued.diagnostics.enqueueMs;
                const sentenceDiagnostics = sentence.diagnostics ?? {};
                totalNormalizationMs += Number(sentenceDiagnostics.normalizationMs) || 0;
                totalPlanningMs += Number(sentenceDiagnostics.planningMs) || 0;
                totalSynthesisMs += Number(sentenceDiagnostics.synthesisMs) || 0;
                totalRenderReadbackMs += Number(sentenceDiagnostics.renderReadbackMs) || 0;
                totalVisualReadbackMs += Number(sentenceDiagnostics.visualReadbackMs) || 0;
            }

            if (sentenceCount === 0) throw new RangeError('VoicePlayback: sentence stream produced no audio');
            const remaining = await this.drain({ timeoutMs: drainTimeoutMs, signal, generation });
            if (remaining !== 0) {
                const error = new Error(`VoicePlayback: drain timed out with ${remaining} samples queued`);
                error.code = 'PARTICLE_VOICE_DRAIN_TIMEOUT';
                throw error;
            }
            producerDone = true;
            await boundaryPump;
            this._assertPlaybackActive(signal, generation);
            return Object.freeze({
                generation,
                sentenceCount,
                modelSamples,
                outputSamples,
                wordBoundaries: emittedBoundaries,
                modelSampleRate: this.modelSampleRate,
                outputSampleRate: this.outputSampleRate,
                diagnostics: Object.freeze({
                    resampleMs: totalResampleMs,
                    enqueueMs: totalEnqueueMs,
                    normalizationMs: totalNormalizationMs,
                    planningMs: totalPlanningMs,
                    synthesisMs: totalSynthesisMs,
                    renderReadbackMs: totalRenderReadbackMs,
                    visualReadbackMs: totalVisualReadbackMs,
                    totalPlaybackMs: nowMs() - operationStartedAt,
                    firstQueuedMs,
                    firstConsumedMs,
                    callbackErrors,
                }),
            });
        } catch (error) {
            producerDone = true;
            if (!this._destroyed && generation === this._generation) this.cancel();
            await boundaryPump.catch(() => {});
            throw error;
        } finally {
            producerDone = true;
            signal?.removeEventListener('abort', abort);
        }
    }

    destroy() {
        if (this._destroyed) return;
        this._generation += 1;
        resetSharedPCMRing(this.ring);
        this.resampler.reset();
        this._acceptedOutputSamples = 0;
        this._rejectPollWaiters();
        this._destroyed = true;
        this._node = null;
    }

    _queueOperation(run) {
        const operation = this._operationTail.then(run, run);
        this._operationTail = operation.catch(() => {});
        return operation;
    }

    _consumedOutputSamples() {
        return Math.max(0, this._acceptedOutputSamples - this.available());
    }

    _waitForPoll(signal, generation) {
        this._assertPlaybackActive(signal, generation);
        return new Promise((resolve, reject) => {
            let settled = false;
            let timer = null;
            const waiter = {
                reject: (error) => finish(reject, error),
            };
            const onAbort = () => finish(reject, abortError(signal?.reason));
            const finish = (callback, value) => {
                if (settled) return;
                settled = true;
                if (timer !== null) clearTimeout(timer);
                signal?.removeEventListener('abort', onAbort);
                this._pollWaiters.delete(waiter);
                callback(value);
            };
            this._pollWaiters.add(waiter);
            signal?.addEventListener('abort', onAbort, { once: true });
            timer = setTimeout(() => finish(resolve), this.config.drainPollMs);
        });
    }

    _rejectPollWaiters() {
        const error = abortError();
        for (const waiter of [...this._pollWaiters]) waiter.reject(error);
    }

    _assertPlaybackActive(signal, generation) {
        this._assertNotDestroyed();
        if (signal?.aborted) throw abortError(signal.reason);
        if (generation !== this._generation) throw abortError();
    }

    _assertNotDestroyed() {
        if (this._destroyed) throw new Error('VoicePlayback: used after destroy()');
    }
}

export function createVoicePlayback(options) {
    return new VoicePlayback(options);
}

export default VoicePlayback;
