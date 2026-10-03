// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * SharedPCMRing.js — Phase 2 ParticleVoice audio bridge.
 *
 * Production generalization of `risk/ReadbackAudioProbe.js` (R4)'s proven
 * `createSharedRing`/`prefillRing`/`startProducer` SharedArrayBuffer PCM
 * ring (single-producer/single-consumer, `[writeIndex, readIndex,
 * underrunCount, processCallCount]` control layout consumed by
 * `R4ReadbackAudioWorklet.worklet.js`'s allocation-free `process()`).
 *
 * Adds the plan's explicit "generation/sequence IDs" requirement, which R4's
 * risk spike did not need (a disposable probe never gets reset mid-run):
 *
 *   - `generation` (control[4]): bumped after the producer publishes a
 *     cancellation boundary in `resetReadIndex` (control[6]). The write
 *     cursor keeps its circular position. Replacement PCM starts at that
 *     boundary, so it survives even when written before the next worklet
 *     tick. Until `readGeneration` (control[7]) acknowledges the generation,
 *     producer accounting uses the reset boundary, not an old consumer
 *     cursor. The consumer publishes its cursor before its generation tag;
 *     a late old-generation commit therefore cannot consume new audio.
 *   - `writeSequence` (control[5]): incremented once per producer
 *     `writeSharedPCMRing()` call (a monotonic chunk counter, not a sample
 *     counter) — correlates a ring write with the
 *     `WaveguideAcousticState.sampleIndex` that produced it for
 *     diagnostics/telemetry; the consumer does not need to read it for
 *     correctness (unlike `generation`).
 *
 * The reader-side helper function here (`readAvailable`) is pure
 * arithmetic over caller-supplied typed arrays — no allocation, no
 * closures over per-call state — usable from a non-worklet consumer (e.g.
 * a test harness) without violating an allocation-free constraint.
 * `worklet/ParticleVoiceProcessor.js` (the AudioWorkletProcessor that
 * actually drains this ring in real-time) does NOT import this module —
 * both existing worklet files in this project
 * (`engine/audio/synth/PatchRunner.worklet.js`,
 * `risk/R4ReadbackAudioWorklet.worklet.js`) are self-contained with no ES
 * imports, so `ParticleVoiceProcessor.js` duplicates `CONTROL_INDEX` and
 * the read-position arithmetic inline rather than relying on an unverified
 * assumption that `AudioWorkletGlobalScope` module imports behave
 * identically to this project's other worklet loading paths. Both files'
 * docstrings flag this duplication explicitly so the two `CONTROL_INDEX`
 * definitions cannot silently drift apart unnoticed.
 */

export const CONTROL_INDEX = Object.freeze({
    WRITE_INDEX: 0,
    READ_INDEX: 1,
    UNDERRUN_COUNT: 2,
    PROCESS_CALL_COUNT: 3,
    GENERATION: 4,
    WRITE_SEQUENCE: 5,
    RESET_READ_INDEX: 6,
    READ_GENERATION: 7,
});
export const CONTROL_SLOT_COUNT = 8;

export const DEFAULT_RING_CAPACITY_SECONDS = 1;

/** @returns {object} A fresh SharedArrayBuffer-backed PCM ring, empty, generation 0. */
export function createSharedPCMRing({ sampleRate, capacitySeconds = DEFAULT_RING_CAPACITY_SECONDS }) {
    if (typeof SharedArrayBuffer === 'undefined') {
        throw new Error('SharedPCMRing requires SharedArrayBuffer (crossOriginIsolated context)');
    }
    if (typeof sampleRate !== 'number' || sampleRate <= 0) throw new RangeError('SharedPCMRing: sampleRate must be a positive number');
    if (typeof capacitySeconds !== 'number' || capacitySeconds <= 0) throw new RangeError('SharedPCMRing: capacitySeconds must be a positive number');

    const capacity = Math.round(sampleRate * capacitySeconds);
    const controlBuffer = new SharedArrayBuffer(CONTROL_SLOT_COUNT * 4);
    const pcmBuffer = new SharedArrayBuffer(capacity * 4);
    return Object.freeze({
        sampleRate,
        capacity,
        controlBuffer,
        pcmBuffer,
        control: new Int32Array(controlBuffer),
        pcm: new Float32Array(pcmBuffer),
    });
}

/**
 * Producer-side write: copies `samples` into the ring starting at the
 * current `writeIndex`, advancing it and incrementing `writeSequence`.
 * Clamps to available free space (`capacity - 1 - available`, the usual
 * ring-buffer one-slot gap to distinguish full from empty) rather than
 * overflowing past the reader's current position and corrupting
 * not-yet-read samples — R4's own `startProducer` avoided this by pacing
 * writes to wall-clock time so it could never get ahead of the ring's
 * capacity, but a production writer driven by GPU chunk completion
 * (irregular timing) cannot assume that pacing, so this function must be
 * defensive.
 *
 * @returns {number} The number of samples actually written (may be less
 * than `samples.length` if the ring was nearly full — the caller must
 * check this and back-pressure/retry rather than assume all samples were
 * accepted).
 */
export function writeSharedPCMRing(ring, samples) {
    const { control, pcm, capacity } = ring;
    const writeIndex = Atomics.load(control, CONTROL_INDEX.WRITE_INDEX);
    const readIndex = readSharedPCMReadIndex(control);
    const available = (writeIndex - readIndex + capacity) % capacity;
    const freeSpace = capacity - 1 - available;
    const toWrite = Math.min(samples.length, freeSpace);

    let idx = writeIndex;
    for (let i = 0; i < toWrite; i++) {
        pcm[idx] = samples[i];
        idx += 1;
        if (idx >= capacity) idx = 0;
    }
    if (toWrite > 0) {
        Atomics.store(control, CONTROL_INDEX.WRITE_INDEX, idx);
    }
    Atomics.add(control, CONTROL_INDEX.WRITE_SEQUENCE, 1);
    return toWrite;
}

/**
 * Discard only PCM preceding this producer-owned boundary. Do not reset either
 * cursor: the worklet may still be committing an old quantum concurrently.
 * Publishing the anchor before generation lets replacement writes proceed
 * immediately without waiting for the audio thread or dropping their prefix.
 */
export function resetSharedPCMRing(ring) {
    const { control } = ring;
    Atomics.store(control, CONTROL_INDEX.RESET_READ_INDEX, Atomics.load(control, CONTROL_INDEX.WRITE_INDEX));
    Atomics.add(control, CONTROL_INDEX.GENERATION, 1);
}

/** Producer-side logical cursor. A cursor is usable only in its acknowledged generation. */
export function readSharedPCMReadIndex(control) {
    const generation = Atomics.load(control, CONTROL_INDEX.GENERATION);
    return Atomics.load(control, CONTROL_INDEX.READ_GENERATION) === generation
        ? Atomics.load(control, CONTROL_INDEX.READ_INDEX)
        : Atomics.load(control, CONTROL_INDEX.RESET_READ_INDEX);
}

/** Pure, allocation-free: samples currently available to read (does not mutate anything). Safe to call from `process()`. */
export function readAvailable(control, capacity) {
    const writeIndex = Atomics.load(control, CONTROL_INDEX.WRITE_INDEX);
    const readIndex = readSharedPCMReadIndex(control);
    return (writeIndex - readIndex + capacity) % capacity;
}

export default createSharedPCMRing;
