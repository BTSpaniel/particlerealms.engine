// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Bounded PCM16 capture for the explicit experimental authored-codec mode. */
class ParticleLiveAudio extends AudioWorkletProcessor {
    constructor() {
        super(); this.frames = 0; this.offset = 0; this.channels = 0; this.buffer = null;
    }
    process(inputs) {
        const input = inputs[0];
        if (!input?.length || !input[0]?.length) return true;
        const channels = Math.min(2, input.length);
        if (channels !== this.channels) { this.channels = channels; this.buffer = new Int16Array(1024 * channels); this.offset = 0; }
        for (let index = 0; index < input[0].length; index++) {
            for (let channel = 0; channel < channels; channel++) this.buffer[this.offset * channels + channel] = Math.max(-32768, Math.min(32767, Math.round((input[channel]?.[index] || 0) * 32767)));
            this.offset++; this.frames++;
            if (this.offset === 1024) {
                const samples = this.buffer;
                this.port.postMessage({ samples, channels, sampleRate, timestampUs: Math.round((this.frames - 1024) / sampleRate * 1000000) }, [samples.buffer]);
                this.buffer = new Int16Array(1024 * channels); this.offset = 0;
            }
        }
        return true;
    }
}
registerProcessor('particle-live-audio', ParticleLiveAudio);
