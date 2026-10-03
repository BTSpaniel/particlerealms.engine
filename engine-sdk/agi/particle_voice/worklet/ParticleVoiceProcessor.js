// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ParticleVoiceProcessor.js — Phase 2 ParticleVoice audio bridge.
 *
 * Production AudioWorkletProcessor consuming `SharedPCMRing.js`'s ring,
 * generalizing `risk/R4ReadbackAudioWorklet.worklet.js` (R4)'s proven
 * allocation-free `process()` (no `new`, no object/array literals, no
 * `await`, no `throw`, no `JSON` — only typed-array indexing and Atomics
 * on pre-existing SharedArrayBuffer-backed views) with the plan's
 * generation-aware resync requirement `SharedPCMRing.js`'s docstring
 * describes.
 *
 * This file is deliberately SELF-CONTAINED (no ES module imports),
 * matching this project's two existing worklet files
 * (`engine/audio/synth/PatchRunner.worklet.js`,
 * `risk/R4ReadbackAudioWorklet.worklet.js`) — `SharedPCMRing.js`'s
 * `CONTROL_INDEX` constants are duplicated here as `CONTROL_INDEX` rather
 * than imported; the two must be kept in sync by hand (flagged in both
 * files' docstrings) rather than relying on an unverified assumption that
 * `AudioWorkletGlobalScope` module imports behave identically to this
 * project's other worklet loading paths.
 *
 * Control layout (Int32Array, SharedArrayBuffer, 8 x int32) — MUST match
 * `SharedPCMRing.js`'s `CONTROL_INDEX` exactly:
 *   [0] writeIndex        — next PCM slot the producer will write
 *   [1] readIndex         — next PCM slot this processor will read
 *   [2] underrunCount     — incremented whenever fewer than one quantum of samples are available
 *   [3] processCallCount  — incremented every process() call
 *   [4] generation        — bumped after the producer publishes resetReadIndex
 *   [5] writeSequence     — producer chunk counter; read-only from here, not
 *                            required for correctness, exposed for parity
 *                            with SharedPCMRing.js's layout only.
 *   [6] resetReadIndex    — producer-owned cancellation boundary; replacement
 *                            samples begin here, not at a later writeIndex
 *   [7] readGeneration    — consumer-owned generation tag for readIndex; it is
 *                            stored after the cursor, fencing late old commits
 */

const CONTROL_INDEX = Object.freeze({
    WRITE_INDEX: 0,
    READ_INDEX: 1,
    UNDERRUN_COUNT: 2,
    PROCESS_CALL_COUNT: 3,
    GENERATION: 4,
    WRITE_SEQUENCE: 5,
    RESET_READ_INDEX: 6,
    READ_GENERATION: 7,
});

class ParticleVoiceProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();
        const opts = options.processorOptions;
        this.control = new Int32Array(opts.controlBuffer);
        if (this.control.length !== 8) throw new RangeError('Particle Voice requires the generation-tagged 8-slot PCM ring');
        this.pcm = new Float32Array(opts.pcmBuffer);
        this.capacity = this.pcm.length;
    }

    process(inputs, outputs) {
        const output = outputs[0];
        const channel = output[0];
        const n = channel.length;

        const currentGeneration = Atomics.load(this.control, CONTROL_INDEX.GENERATION);
        let readIndex = Atomics.load(this.control, CONTROL_INDEX.READ_GENERATION) === currentGeneration
            ? Atomics.load(this.control, CONTROL_INDEX.READ_INDEX)
            : Atomics.load(this.control, CONTROL_INDEX.RESET_READ_INDEX);

        const writeIndex = Atomics.load(this.control, CONTROL_INDEX.WRITE_INDEX);
        const available = (writeIndex - readIndex + this.capacity) % this.capacity;

        if (available >= n) {
            for (let i = 0; i < n; i++) {
                const sample = this.pcm[readIndex];
                for (let c = 0; c < output.length; c++) {
                    output[c][i] = sample;
                }
                readIndex += 1;
                if (readIndex >= this.capacity) readIndex = 0;
            }
        } else {
            for (let c = 0; c < output.length; c++) {
                const outChannel = output[c];
                for (let i = 0; i < n; i++) outChannel[i] = 0;
            }
        }

        // Publish a cursor tagged with the exact generation that was read.
        // Reset may race either store; an old tag then keeps producer accounting
        // on its reset anchor until the next (new-generation) worklet quantum.
        if (Atomics.load(this.control, CONTROL_INDEX.GENERATION) === currentGeneration) {
            Atomics.store(this.control, CONTROL_INDEX.READ_INDEX, readIndex);
            Atomics.store(this.control, CONTROL_INDEX.READ_GENERATION, currentGeneration);
        }
        if (Atomics.load(this.control, CONTROL_INDEX.GENERATION) !== currentGeneration) {
            // A reset during this quantum also invalidates already copied PCM.
            for (let c = 0; c < output.length; c++) {
                const outChannel = output[c];
                for (let i = 0; i < n; i++) outChannel[i] = 0;
            }
        } else if (available < n) {
            Atomics.add(this.control, CONTROL_INDEX.UNDERRUN_COUNT, 1);
        }

        Atomics.add(this.control, CONTROL_INDEX.PROCESS_CALL_COUNT, 1);
        return true;
    }
}

registerProcessor('particle-voice-processor', ParticleVoiceProcessor);
