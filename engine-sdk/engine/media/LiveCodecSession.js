// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { CodecClient, parseVideoPacket, encodeAudioPacket, decodeAudioPacket } from './codecs/index.js';

/** Explicit experimental transport; one encoder worker request is in flight. */
export class LiveCodecSender {
    constructor(player, party, { sourceRevision, mode = 'lossless', onError = null, onStats = null } = {}) {
        Object.assign(this, { player, party, sourceRevision, mode, onError, onStats });
        this._stopped = false; this._forceKey = true; this._sequence = 0;
        this.metrics = { encodedBytes: 0, encodeMs: 0, droppedFrames: 0, droppedPackets: 0, queueLength: 0, bufferBytes: 0, accountingScope: 'in-flight typed arrays', avDriftMs: null };
    }
    async start() {
        if (this._stopped) throw new Error('Live codec sender has stopped');
        if (this._started) throw new Error('Live codec sender has already started');
        this._started = true;
        const input = this.player.capabilities.custom ? this.player.canvas : this.player.video;
        const sourceWidth = input.videoWidth || input.width, sourceHeight = input.videoHeight || input.height;
        if (!sourceWidth || !sourceHeight) throw new Error('Start playback before sharing the custom codec');
        const scale = Math.min(1, 640 / sourceWidth, 360 / sourceHeight);
        const width = Math.max(16, Math.floor(sourceWidth * scale / 16) * 16), height = Math.max(16, Math.floor(sourceHeight * scale / 16) * 16);
        this._canvas = document.createElement('canvas'); this._canvas.width = width; this._canvas.height = height;
        this._context = this._canvas.getContext('2d', { willReadFrequently: true });
        this._context.drawImage(input, 0, 0, width, height); this._context.getImageData(0, 0, width, height);
        this._encoder = new CodecClient();
        await this._encoder.configureEncoder({ width, height, frameRate: 24, mode: this.mode, quantization: 12 });
        if (this._stopped) return;
        this._origin = performance.now();
        this._offKey = this.party.on('keyrequest', () => { this._forceKey = true; });
        this._offMembers = this.party.on('member', () => { this._forceKey = true; });
        this._timer = setInterval(async () => {
            if (this._stopped || (this.player.paused && !this._forceKey)) return;
            if (this._busy) { this.metrics.droppedFrames++; return; }
            this._busy = true; this.metrics.queueLength = 1;
            try {
                this._context.drawImage(input, 0, 0, width, height);
                this.player.drawCaptions?.(this._context, width, height);
                const rgba = this._context.getImageData(0, 0, width, height).data;
                this.metrics.bufferBytes = rgba.byteLength;
                const sequence = this._sequence++, keyframe = this._forceKey || sequence % 48 === 0;
                this._forceKey = false;
                const timestampUs = Math.max((this._lastTimestampUs ?? -1) + 1, Math.round((performance.now() - this._origin) * 1000));
                this._lastTimestampUs = timestampUs;
                const started = performance.now();
                const bytes = await this._encoder.encodePacket(rgba, { timestampUs, sequence, forceKeyframe: keyframe });
                if (this._stopped) return;
                this.metrics.encodeMs = performance.now() - started; this.metrics.encodedBytes += bytes.byteLength;
                const sent = this.party.publishPacket(bytes, { kind: 'video', sourceRevision: this.sourceRevision, sequence, timestamp: timestampUs / 1000000, keyframe: parseVideoPacket(bytes).keyframe });
                if (!sent && this.party.members.length > 1) { this.metrics.droppedPackets++; this._forceKey = true; }
            } catch (error) { if (!this._stopped) { this.stop(); this.onError?.(error.message); } }
            finally { this._busy = false; this.metrics.queueLength = 0; this.metrics.bufferBytes = 0; }
        }, 1000 / 24);
        this._statsTimer = setInterval(() => this.onStats?.({ ...this.metrics }), 1000);
        try {
            this._capture = await this.player.captureStream();
            if (this._stopped) { this.player.releaseCapture(this._capture); return; }
            if (this._capture.getAudioTracks().length) {
                const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
                this._audio = new Audio({ sampleRate: 48000 });
                await this._audio.audioWorklet.addModule(new URL('./LiveAudioWorklet.js', import.meta.url).href);
                if (this._stopped) { this._audio.close(); return; }
                this._audioSource = this._audio.createMediaStreamSource(this._capture);
                this._audioNode = new AudioWorkletNode(this._audio, 'particle-live-audio');
                const audioOriginUs = Math.round((performance.now() - this._origin) * 1000);
                this._audioNode.port.onmessage = event => {
                    if (this._stopped || this.player.paused) return;
                    try {
                        const audio = event.data, timestampUs = audioOriginUs + audio.timestampUs;
                        const sequence = this._audioSequence = (this._audioSequence || 0) + 1;
                        const bytes = encodeAudioPacket({ ...audio, timestampUs, sequence }); this.metrics.encodedBytes += bytes.byteLength;
                        const sent = this.party.publishPacket(bytes, { kind: 'audio', sourceRevision: this.sourceRevision, sequence, timestamp: timestampUs / 1000000, keyframe: true });
                        if (!sent && this.party.members.length > 1) this.metrics.droppedPackets++;
                    } catch (error) { this.stop(); this.onError?.(error.message); }
                };
                this._silent = this._audio.createGain(); this._silent.gain.value = 0;
                this._audioSource.connect(this._audioNode); this._audioNode.connect(this._silent); this._silent.connect(this._audio.destination);
                await this._audio.resume();
            }
        } catch (error) { this.stop(); throw new Error(`Custom codec audio/capture failed: ${error.message}`); }
    }
    stop() {
        if (this._stopped) return;
        this._stopped = true; clearInterval(this._timer); clearInterval(this._statsTimer); this._offKey?.(); this._offMembers?.();
        this._encoder?.dispose();
        if (this._audioNode) { this._audioNode.port.onmessage = null; this._audioNode.disconnect(); }
        this._audioSource?.disconnect(); this._silent?.disconnect(); this._audio?.close().catch(() => {});
        if (this._capture) this.player.releaseCapture(this._capture);
    }
}

/** Video and PCM use one bounded timestamp-to-local-clock presentation map. */
export class LiveCodecReceiver {
    constructor(player, { onKeyframe = null, onError = null, onStats = null } = {}) {
        Object.assign(this, { player, onKeyframe, onError, onStats });
        this._decoder = new CodecClient(); this._nodes = new Set(); this._slices = []; this._revision = null;
        this._decodeQueue = []; this._presentation = []; this._generation = 0; this._disposed = false;
        this.metrics = { decodedBytes: 0, decodeMs: 0, droppedFrames: 0, droppedPackets: 0, queueLength: 0, bufferBytes: 0, accountingScope: 'queued packet, RGBA typed arrays and scheduled PCM audio buffers', avDriftMs: null };
        this._offVolume = player.on('volumechange', () => this._volume()); this._offOutput = player.on('audiooutput', () => this._volume());
        this._timer = setInterval(() => this._present(), 10); this._statsTimer = setInterval(() => this.onStats?.({ ...this.metrics }), 1000);
    }
    _volume() { if (this._gain) this._gain.gain.value = this.player.outputMuted ? 0 : this.player.outputVolume; }
    get audioEnabled() { return this._audio?.state === 'running'; }
    async enableAudio() {
        if (this._disposed) throw new Error('Live codec receiver has been disposed');
        const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!Audio) throw new Error('Web Audio is unavailable');
        if (!this._audio) { this._audio = new Audio(); this._gain = this._audio.createGain(); this._gain.connect(this._audio.destination); this._volume(); }
        await this._audio.resume();
        if (this._disposed) throw new Error('Live codec receiver has been disposed');
    }
    _target(timestampUs) {
        const now = performance.now();
        if (!this._clock || Math.abs(timestampUs - this._clock.timestampUs - (now - this._clock.time) * 1000) > 500000) {
            this._flushPresentation(); this._clock = { timestampUs, time: now + 120 };
        }
        return this._clock.time + (timestampUs - this._clock.timestampUs) / 1000;
    }
    packet({ bytes, meta }) {
        if (this._disposed) return;
        if (this._revision !== meta.sourceRevision) { this.reset(); this._revision = meta.sourceRevision; }
        this.metrics.decodedBytes += bytes.byteLength;
        if (meta.kind === 'video') {
            if (this._decodeQueue.length >= 4) {
                this.metrics.droppedPackets++;
                if (!meta.keyframe) { this.onKeyframe?.(); return; }
                this._decodeQueue = []; this._decoder.dispose(); this._decoder = new CodecClient(); this._generation++;
            }
            this._decodeQueue.push({ bytes, meta }); this._measure(); this._decode();
        } else if (meta.kind === 'audio' && this._audio?.state === 'running') {
            try { this._scheduleAudio(decodeAudioPacket(bytes)); } catch (error) { this.metrics.droppedPackets++; this.onError?.(error.message); }
        }
    }
    async _decode() {
        if (this._decoding || this._disposed) return;
        this._decoding = true;
        try {
            while (this._decodeQueue.length && !this._disposed) {
                const packet = this._decodeQueue.shift(), generation = this._generation, started = performance.now();
                this._decodingBytes = packet.bytes.byteLength; this._measure();
                try {
                    const frame = await this._decoder.decodePacket(packet.bytes);
                    if (generation !== this._generation || this._disposed) continue;
                    this.metrics.decodeMs = performance.now() - started;
                    const target = this._target(frame.timestampUs);
                    if (target < performance.now() - 250) { this.metrics.droppedFrames++; continue; }
                    if (this._presentation.length >= 4) { this._presentation.shift(); this.metrics.droppedFrames++; }
                    this._presentation.push({ frame, target }); this._measure();
                } catch (error) { if (generation === this._generation && !this._disposed) { this.metrics.droppedPackets++; this.onKeyframe?.(); this.onError?.(error.message); } }
                finally { this._decodingBytes = 0; this._measure(); }
            }
        } finally { this._decoding = false; this._measure(); }
    }
    _scheduleAudio(audio) {
        if (this._nodes.size >= 24) { this.metrics.droppedPackets++; return; }
        const target = this._target(audio.timestampUs), now = performance.now();
        if (target < now - 100) { this.metrics.droppedPackets++; return; }
        const length = audio.samples.length / audio.channels;
        const buffer = this._audio.createBuffer(audio.channels, length, audio.sampleRate);
        for (let channel = 0; channel < audio.channels; channel++) {
            const output = buffer.getChannelData(channel);
            for (let index = 0; index < length; index++) output[index] = audio.samples[index * audio.channels + channel] / 32768;
        }
        const source = this._audio.createBufferSource(), start = this._audio.currentTime + Math.max(0, (target - now) / 1000);
        source.buffer = buffer; source.connect(this._gain); source.start(start);
        const slice = { start, end: start + buffer.duration, timestampUs: audio.timestampUs, bytes: length * audio.channels * Float32Array.BYTES_PER_ELEMENT };
        this._nodes.add(source); this._slices.push(slice);
        source.onended = () => { this._nodes.delete(source); this._slices = this._slices.filter(item => item !== slice); source.disconnect(); this._measure(); };
        this._measure();
    }
    _present() {
        const now = performance.now();
        while (this._presentation.length && this._presentation[0].target <= now) {
            const { frame } = this._presentation.shift();
            this.player.video.hidden = true; this.player.canvas.hidden = false;
            this.player.canvas.width = frame.width; this.player.canvas.height = frame.height;
            this.player.canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(frame.rgba), frame.width, frame.height), 0, 0);
            const audioTime = this._audio?.currentTime;
            const slice = this._slices.find(item => item.start <= audioTime && audioTime <= item.end);
            this.metrics.avDriftMs = slice ? (frame.timestampUs - slice.timestampUs) / 1000 - (audioTime - slice.start) * 1000 : null;
        }
        this._measure();
    }
    _measure() {
        this.metrics.queueLength = this._decodeQueue.length + this._presentation.length;
        this.metrics.bufferBytes = (this._decodingBytes || 0) + this._decodeQueue.reduce((sum, item) => sum + item.bytes.byteLength, 0) + this._presentation.reduce((sum, item) => sum + item.frame.rgba.byteLength, 0) + this._slices.reduce((sum, item) => sum + item.bytes, 0);
    }
    _flushPresentation() {
        for (const node of this._nodes) { try { node.stop(); node.disconnect(); } catch {} }
        this._nodes.clear(); this._slices = []; this._presentation = []; this._clock = null;
    }
    reset() { this._generation++; this._decodeQueue = []; this._flushPresentation(); this._decoder.dispose(); this._decoder = new CodecClient(); this._measure(); }
    dispose() {
        if (this._disposed) return;
        this._disposed = true; this._generation++; this._decodeQueue = []; this._flushPresentation(); this._decoder.dispose();
        clearInterval(this._timer); clearInterval(this._statsTimer); this._offVolume?.(); this._offOutput?.(); this._audio?.close().catch(() => {});
    }
}
