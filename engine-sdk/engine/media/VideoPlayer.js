// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { CodecClient } from './codecs/CodecClient.js';
import { MAX_CONTAINER_BYTES } from './codecs/Binary.js';
import { parseSubtitles, subtitleTextAt } from './Subtitle.js';

const MEDIA_EVENTS = ['play', 'pause', 'seeked', 'seeking', 'timeupdate', 'durationchange', 'loadedmetadata', 'loadeddata', 'emptied', 'resize', 'ended', 'waiting', 'canplay', 'progress', 'volumechange', 'ratechange'];

/** Browser media owner shared by OS apps, SecureMesh and the guest join page. */
export class VideoPlayer {
    constructor({ video = null, resolvePath = null, logger = console } = {}) {
        this.video = video || document.createElement('video');
        this.video.playsInline = true;
        this.video.preload = 'metadata';
        this.video.controls = false;
        this.canvas = document.createElement('canvas');
        this.canvas.hidden = true;
        this.element = document.createElement('div');
        this.element.className = 'pr-player-stage';
        this.captions = document.createElement('div');
        this.captions.className = 'pr-player-captions';
        this.captions.setAttribute('aria-live', 'off');
        this.element.append(this.video, this.canvas, this.captions);
        this._resolvePath = resolvePath;
        this._logger = logger;
        this._listeners = new Map();
        this._urls = new Set();
        this._epoch = 0;
        this._playGeneration = 0;
        this._seekGeneration = 0;
        this._disposed = false;
        this._custom = null;
        this._hls = null;
        this._raf = null;
        this._cues = [];
        this._audioNodes = new Set();
        this._captures = new Set();
        this._captureReleases = new Map();
        this._canvasCaptures = new Map();
        this._source = null;
        this._forward = event => { this._updateCaptions(); this._emit(event.type, this.snapshot()); };
        for (const event of MEDIA_EVENTS) this.video.addEventListener(event, this._forward);
        this._nativeError = () => this._emit('error', { message: this.video.error?.message || 'This source could not be decoded by this browser', code: this.video.error?.code });
        this.video.addEventListener('error', this._nativeError);
        this._policyObserver = new MutationObserver(() => this._emit('capabilities', this.snapshot()));
        this._policyObserver.observe(this.video, { attributes: true, attributeFilter: ['disablepictureinpicture'] });
    }

    on(type, callback) {
        if (typeof callback !== 'function') throw new TypeError('Player listener must be a function');
        if (!this._listeners.has(type)) this._listeners.set(type, new Set());
        this._listeners.get(type).add(callback);
        return () => this._listeners.get(type)?.delete(callback);
    }
    _emit(type, value) { for (const callback of this._listeners.get(type) || []) { try { callback(value); } catch (error) { this._logger.warn?.('[VideoPlayer] listener failed', error.message); } } }
    get source() { return this._source; }
    get position() { return this._custom ? this._custom.position : (this.video.currentTime || 0); }
    get duration() { return this._custom ? this._custom.duration : (Number.isFinite(this.video.duration) ? this.video.duration : 0); }
    get paused() { return this._custom ? this._custom.paused : this.video.paused; }
    get rate() { return this._custom ? this._custom.rate : this.video.playbackRate; }
    get volume() { return this._localAudioControl ? this._localVolume : this.video.volume; }
    get muted() { return this._localAudioControl ? this._localMuted : this.video.muted; }
    get outputVolume() { return this._localAudioControl && this._audioOutputLevel !== undefined ? this._audioOutputLevel : this.volume; }
    get outputMuted() { return this._localAudioControl && this._audioOutputLevel !== undefined ? this._audioOutputMuted : this.muted; }
    get capabilities() {
        const canvas = !this.canvas.hidden && this.canvas.width > 0 && this.canvas.height > 0;
        const custom = !!this._custom || canvas, stream = this.video.srcObject, live = !!stream || canvas && !this._custom;
        const hasSource = !this._disposed && (!!this._source || canvas);
        const ready = hasSource && (custom ? canvas : this.video.readyState >= this.video.HAVE_METADATA && !this.video.error);
        const video = ready && (custom || this.video.videoWidth > 0 && this.video.videoHeight > 0 &&
            (!stream || typeof stream.getVideoTracks === 'function' && stream.getVideoTracks().some(track => track.readyState === 'live')));
        return Object.freeze({ native: !custom, custom, hasSource, ready, video, play: ready && !!this._source,
            seek: ready && !live && this.duration > 0, rate: ready && !live,
            capture: video && (custom || this.video.readyState >= this.video.HAVE_CURRENT_DATA) && typeof this.canvas.captureStream === 'function' &&
                (custom || typeof (this.video.captureStream || this.video.mozCaptureStream) === 'function'),
            pip: video && !custom && !this.video.disablePictureInPicture && document.pictureInPictureEnabled === true && typeof this.video.requestPictureInPicture === 'function',
            fullscreen: video && typeof this.element.requestFullscreen === 'function' });
    }
    snapshot() { return { position: this.position, duration: this.duration, paused: this.paused, rate: this.rate, source: this.source, capabilities: this.capabilities }; }

    async load(input) {
        const pending = this._load(input), epoch = this._epoch;
        try { return await pending; }
        catch (error) { if (epoch === this._epoch && !this._disposed) this.clear(); throw error; }
    }
    async _load(input) {
        if (this._disposed) throw new Error('Player has been disposed');
        this.clear({ silent: true });
        const epoch = this._epoch;
        let source = input instanceof Blob ? { blob: input, title: input.name || 'Local video' } : typeof input === 'string' ? { url: input } : { ...input };
        if (!source || typeof source !== 'object') throw new TypeError('Invalid media source');
        if (source.path) {
            if (typeof this._resolvePath !== 'function') throw new Error('This player cannot open OS file paths');
            source.blob = await this._resolvePath(source.path);
            if (!(source.blob instanceof Blob)) throw new Error('OS file could not be read');
        }
        if (epoch !== this._epoch || this._disposed) return false;
        if (source.stream instanceof MediaStream) {
            this._source = { kind: 'stream', title: String(source.title || 'Watch Party') };
            this.video.srcObject = source.stream;
            this.video.load();
            this._emit('source', this.snapshot());
            return true;
        }
        if (source.url) source.url = this._mediaUrl(source.url);
        const label = source.title || source.blob?.name || source.path?.split('/').pop() || source.url || 'Video';
        this._source = { kind: source.blob ? 'file' : 'url', title: String(label).slice(0, 256), ...(source.path ? { path: source.path } : {}), ...(source.url ? { url: source.url } : {}) };
        let blob = source.blob;
        const custom = /\.(prv|h264|264|m1v|m2v|ivf)(?:$|[?#])/i.test(source.path || source.url || source.blob?.name || '') || source.type === 'video/x-particle';
        if (custom) {
            if (!blob) {
                const url = this._mediaUrl(source.url);
                const response = await fetch(url);
                if (!response.ok) throw new Error(`Video request failed (${response.status})`);
                if (Number(response.headers.get('content-length')) > MAX_CONTAINER_BYTES) { await response.body?.cancel(); throw new Error('Authored video exceeds the 128 MiB decoder budget'); }
                const reader = response.body?.getReader();
                if (reader) {
                    const chunks = []; let total = 0;
                    try {
                        while (true) {
                            const { value, done } = await reader.read(); if (done) break;
                            if (epoch !== this._epoch || this._disposed) { await reader.cancel(); return false; }
                            total += value.byteLength; if (total > MAX_CONTAINER_BYTES) { await reader.cancel(); throw new Error('Authored video exceeds the 128 MiB decoder budget'); }
                            chunks.push(value);
                        }
                        blob = new Blob(chunks);
                    } finally { reader.releaseLock(); }
                } else blob = await response.blob();
            }
            if (blob.size > MAX_CONTAINER_BYTES) throw new Error('Authored video exceeds the 128 MiB decoder budget');
            const client = new CodecClient();
            try {
                const opened = await client.open(new Uint8Array(await blob.arrayBuffer()));
                const metadata = opened.metadata;
                if (epoch !== this._epoch || this._disposed) { client.dispose(); return false; }
                const duration = Number(metadata.durationUs ?? metadata.duration ?? 0) / 1000000;
                this._custom = { client, metadata, frameInfo: opened.frameInfo, duration, position: 0, paused: true, rate: 1, frame: -1, rendering: false };
                this._source.kind = 'custom';
                this.video.hidden = true; this.canvas.hidden = false;
                const audio = await client.audio();
                if (epoch !== this._epoch || this._disposed) return false;
                if (audio?.samples?.length) this._custom.audio = audio;
                await this._drawCustom(0, epoch);
                if (epoch !== this._epoch || this._disposed) return false;
                this._emit('loadedmetadata', this.snapshot());
            } catch (error) { client.dispose(); if (epoch !== this._epoch || this._disposed) return false; this.clear(); throw error; }
        } else {
            if (source.crossOrigin === 'anonymous') this.video.crossOrigin = 'anonymous';
            else this.video.removeAttribute('crossorigin');
            let url;
            if (blob instanceof Blob) { url = URL.createObjectURL(blob); this._urls.add(url); }
            else url = this._mediaUrl(source.url);
            const hls = /\.m3u8(?:$|[?#])/i.test(url) || source.type === 'application/vnd.apple.mpegurl';
            if (hls) {
                const { default: Hls } = await import('../../vendor/hls.js/hls.mjs');
                if (epoch !== this._epoch || this._disposed) return false;
                // Some browsers advertise native HLS without decoding it reliably.
                // Prefer the pinned MSE implementation, retaining native-only devices.
                if (Hls.isSupported()) {
                    this._hls = new Hls({ maxBufferLength: 30, maxMaxBufferLength: 60, backBufferLength: 30,
                        workerPath: new URL('../../vendor/hls.js/hls.worker.js', import.meta.url).href });
                    this._hls.on(Hls.Events.ERROR, (_event, data) => { if (data.fatal) this._emit('error', { message: `HLS playback failed: ${data.details}` }); });
                    this._hls.attachMedia(this.video); this._hls.loadSource(url);
                } else if (this.video.canPlayType('application/vnd.apple.mpegurl')) {
                    this.video.src = url; this.video.load();
                } else throw new Error('HLS is unavailable in this browser');
            } else { this.video.src = url; this.video.load(); }
        }
        if (epoch !== this._epoch || this._disposed) return false;
        this._logger.debug?.('[VideoPlayer] source loaded', { kind: this._source.kind, custom });
        this._emit('source', this.snapshot());
        return true;
    }
    _mediaUrl(value) {
        if (typeof value !== 'string' || value.length > 4096) throw new Error('Invalid video URL');
        const url = new URL(value, document.baseURI);
        if (!['http:', 'https:', 'blob:'].includes(url.protocol) || url.username || url.password) throw new Error('Video URL must use HTTP or HTTPS');
        return url.href;
    }

    async play() {
        if (this._disposed) throw new Error('Player has been disposed');
        if (!this._source) throw new Error('Open media before starting playback');
        if (!this._custom) return this.video.play();
        if (!this._custom.paused) return;
        const expected = this._custom, startEpoch = this._epoch;
        if (this.position >= this.duration) await this.seek(0);
        if (expected !== this._custom || startEpoch !== this._epoch || this._disposed) return;
        const custom = this._custom, epoch = this._epoch, operation = ++this._playGeneration;
        if (epoch !== this._epoch || custom !== this._custom || this._disposed) return;
        if (custom.audio && !await this._startCustomAudio(custom, epoch, operation)) return;
        if (epoch !== this._epoch || custom !== this._custom || operation !== this._playGeneration || this._disposed) return;
        custom.paused = false;
        custom.started = performance.now();
        custom.startPosition = custom.position;
        this._emit('play', this.snapshot());
        this._tickCustom(this._epoch);
    }
    pause() {
        this._playGeneration++;
        if (!this._custom) { this.video.pause(); return; }
        const wasPlaying = !this._custom.paused;
        this._custom.paused = true;
        if (this._raf !== null) cancelAnimationFrame(this._raf);
        this._raf = null; this._stopCustomAudio();
        if (wasPlaying) this._emit('pause', this.snapshot());
    }
    async seek(position) {
        if (!Number.isFinite(position) || position < 0) throw new RangeError('Invalid seek position');
        if (this.video.srcObject) throw new Error('Live streams cannot seek');
        if (!this._custom) { this.video.currentTime = this.duration ? Math.min(position, this.duration) : position; return; }
        const playing = !this.paused, custom = this._custom, epoch = this._epoch;
        this.pause();
        if (custom !== this._custom || epoch !== this._epoch) return;
        custom.position = Math.min(position, this.duration); custom.frame = -1;
        const operation = ++this._seekGeneration;
        await this._drawCustom(this.position, epoch, true);
        if (epoch !== this._epoch || custom !== this._custom || operation !== this._seekGeneration || this._disposed) return;
        this._emit('timeupdate', this.snapshot());
        this._emit('seeked', this.snapshot());
        if (playing && epoch === this._epoch && custom === this._custom && operation === this._seekGeneration) await this.play();
    }
    async setRate(rate) {
        if (!Number.isFinite(rate) || rate < 0.25 || rate > 4) throw new RangeError('Playback speed must be between 0.25 and 4');
        if (!this._custom) { this.video.playbackRate = rate; return; }
        const custom = this._custom, epoch = this._epoch, playing = !this.paused; this.pause();
        if (custom !== this._custom || epoch !== this._epoch) return;
        custom.rate = rate;
        this._emit('ratechange', this.snapshot());
        if (playing && custom === this._custom && epoch === this._epoch) await this.play();
    }
    setVolume(value) {
        if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError('Invalid volume');
        if (this._localAudioControl) { this._localVolume = value; this._localAudioControl(value, this._localMuted); this._emit('volumechange', this.snapshot()); }
        else this.video.volume = value;
        this._updateAudioGain();
    }
    setMuted(value) {
        if (this._localAudioControl) { this._localMuted = !!value; this._localAudioControl(this._localVolume, this._localMuted); this._emit('volumechange', this.snapshot()); }
        else this.video.muted = !!value;
        this._updateAudioGain();
    }
    setLocalAudioControl(callback) {
        this._localVolume = this.volume; this._localMuted = this.muted;
        this._localAudioControl = typeof callback === 'function' ? callback : null;
        if (this._localAudioControl) { this.video.volume = 1; this.video.muted = false; this._localAudioControl(this._localVolume, this._localMuted); }
        else { this.video.volume = this._localVolume; this.video.muted = this._localMuted; }
        this._updateAudioGain();
    }
    setAudioOutputLevel(effective, muted) {
        this._audioOutputLevel = Math.max(0, Math.min(1, Number(effective) || 0)); this._audioOutputMuted = !!muted;
        this._updateAudioGain(); this._emit('audiooutput', this.snapshot());
    }
    _updateAudioGain() { if (this._audioGain) this._audioGain.gain.value = this.outputMuted ? 0 : this.outputVolume; }
    async loadSubtitles(input) {
        const epoch = this._epoch;
        const text = input instanceof Blob ? await input.text() : input;
        if (epoch !== this._epoch || this._disposed) return false;
        this._cues = parseSubtitles(text); this._updateCaptions();
        this._emit('subtitles', { count: this._cues.length });
    }
    _updateCaptions() { this.captions.textContent = subtitleTextAt(this._cues, this.position); }
    drawCaptions(context, width, height) {
        const lines = this.captions.textContent.split('\n').filter(Boolean);
        if (!lines.length) return;
        const size = Math.max(14, Math.round(height / 22));
        context.save(); context.font = `600 ${size}px sans-serif`; context.textAlign = 'center'; context.textBaseline = 'bottom';
        context.lineWidth = Math.max(2, size / 8); context.strokeStyle = '#000'; context.fillStyle = '#fff';
        lines.slice(-4).forEach((line, index, array) => { const y = height * .95 - (array.length - index - 1) * (size + 4); context.strokeText(line, width / 2, y, width * .9); context.fillText(line, width / 2, y, width * .9); });
        context.restore();
    }

    async _drawCustom(position, epoch, force = false) {
        const custom = this._custom;
        if (!custom || (custom.rendering && !force)) return;
        const timestamp = Math.round(position * 1000000);
        let low = 0, high = custom.frameInfo.length - 1;
        while (low < high) { const middle = Math.ceil((low + high) / 2); if (custom.frameInfo[middle].timestampUs <= timestamp) low = middle; else high = middle - 1; }
        if (custom.frame === low) return;
        const request = custom.renderRequest = (custom.renderRequest || 0) + 1;
        custom.rendering = (custom.rendering || 0) + 1;
        try {
            const frame = await custom.client.frame(low);
            if (epoch !== this._epoch || custom !== this._custom || request !== custom.renderRequest) return;
            custom.frame = low;
            this.canvas.width = frame.width; this.canvas.height = frame.height;
            this.canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(frame.rgba), frame.width, frame.height), 0, 0);
            this._updateCaptions();
        } finally { custom.rendering--; }
    }
    _tickCustom(epoch) {
        if (epoch !== this._epoch || !this._custom || this.paused) return;
        const custom = this._custom;
        custom.position = Math.min(custom.duration, custom.startPosition + (performance.now() - custom.started) / 1000 * custom.rate);
        this._drawCustom(custom.position, epoch).catch(error => { if (epoch === this._epoch && custom === this._custom) { this.pause(); this._emit('error', { message: error.message }); } });
        this._emit('timeupdate', this.snapshot());
        if (epoch !== this._epoch || custom !== this._custom) return;
        if (custom.position >= custom.duration) { this.pause(); this._emit('ended', this.snapshot()); return; }
        this._raf = requestAnimationFrame(() => this._tickCustom(epoch));
    }
    async _ensureAudio() {
        if (!this._audioContext) {
            const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
            if (!Audio) throw new Error('Web Audio is unavailable');
            this._audioContext = new Audio();
            this._audioGain = this._audioContext.createGain();
            this._audioGain.connect(this._audioContext.destination);
            this._audioExport = this._audioContext.createMediaStreamDestination();
            this._updateAudioGain();
        }
        await this._audioContext.resume();
    }
    async _startCustomAudio(custom, epoch, operation) {
        await this._ensureAudio();
        if (epoch !== this._epoch || custom !== this._custom || operation !== this._playGeneration || this._disposed) return false;
        const audio = custom.audio;
        if (!custom.audioBuffer) {
            const frames = audio.samples.length / audio.channels;
            const buffer = this._audioContext.createBuffer(audio.channels, frames, audio.sampleRate);
            for (let channel = 0; channel < audio.channels; channel++) {
                const data = buffer.getChannelData(channel);
                for (let index = 0; index < frames; index++) data[index] = audio.samples[index * audio.channels + channel] / 32768;
            }
            custom.audioBuffer = buffer;
        }
        const node = this._audioContext.createBufferSource();
        if (custom.position >= custom.audioBuffer.duration) return true;
        node.buffer = custom.audioBuffer; node.playbackRate.value = custom.rate;
        node.connect(this._audioGain); node.connect(this._audioExport);
        this._audioNodes.add(node); node.onended = () => this._audioNodes.delete(node);
        if (custom.position < node.buffer.duration) node.start(0, custom.position);
        return true;
    }
    _stopCustomAudio() { for (const node of this._audioNodes) { try { node.stop(); node.disconnect(); } catch {} } this._audioNodes.clear(); }
    async captureStream() {
        const epoch = this._epoch;
        if (this._custom) {
            const custom = this._custom;
            if (typeof this.canvas.captureStream !== 'function') throw new Error('Canvas streaming is unavailable');
            if (custom.audio) await this._ensureAudio();
            if (epoch !== this._epoch || custom !== this._custom || this._disposed) throw new Error('The source changed during capture');
            const capture = this._captionCapture(this.canvas);
            if (custom.audio) for (const track of this._audioExport.stream.getAudioTracks()) capture.addTrack(track.clone());
            this._captures.add(capture); return capture;
        }
        const capture = this.video.captureStream || this.video.mozCaptureStream;
        if (typeof capture !== 'function') throw new Error('This browser cannot restream this source');
        const stream = capture.call(this.video);
        if (!stream.getVideoTracks().length) { for (const track of stream.getTracks()) track.stop(); throw new Error('Start playback before restreaming; this source may prohibit capture'); }
        if (this._exportAudio) {
            try {
                const exported = await this._exportAudio();
                if (epoch !== this._epoch || this._disposed) { exported.release?.(); throw new Error('The source changed during capture'); }
                for (const track of stream.getAudioTracks()) { stream.removeTrack(track); track.stop(); }
                for (const track of exported.stream.getAudioTracks()) stream.addTrack(track.clone());
                const release = () => { exported.release?.(); this._captureReleases.delete(stream); };
                this._captureReleases.set(stream, release);
            } catch (error) { for (const track of stream.getTracks()) track.stop(); throw error; }
        }
        if (typeof this.canvas.captureStream === 'function') {
            try {
                const captioned = this._captionCapture(this.video);
                for (const track of stream.getVideoTracks()) { stream.removeTrack(track); track.stop(); }
                const track = captioned.getVideoTracks()[0]; stream.addTrack(track);
                this._canvasCaptures.set(stream, this._canvasCaptures.get(captioned)); this._canvasCaptures.delete(captioned);
            } catch (error) { this.releaseCapture(stream); throw error; }
        }
        const release = this._captureReleases.get(stream);
        if (release) stream.getVideoTracks()[0]?.addEventListener('ended', release, { once: true });
        this._captures.add(stream); return stream;
    }
    _captionCapture(input) {
        const width = input.videoWidth || input.width, height = input.videoHeight || input.height;
        if (!width || !height) throw new Error('Source pixels are not ready for subtitle capture');
        const scale = Math.min(1, 1280 / width, 720 / height), canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
        const context = canvas.getContext('2d');
        const draw = () => { context.drawImage(input, 0, 0, canvas.width, canvas.height); this.drawCaptions(context, canvas.width, canvas.height); };
        draw();
        try { context.getImageData(0, 0, 1, 1); }
        catch { throw new Error('The video server blocks sharing pixels. Enable sharing for remote URLs when opening it (server CORS permission required), choose same-URL sharing, or open a local file.'); }
        const stream = canvas.captureStream(24);
        const timer = setInterval(() => { try { draw(); } catch { clearInterval(timer); for (const track of stream.getTracks()) track.stop(); } }, 1000 / 24);
        this._canvasCaptures.set(stream, timer); return stream;
    }
    setAudioExport(callback) { this._exportAudio = typeof callback === 'function' ? callback : null; }
    releaseCapture(stream) {
        this._captureReleases.get(stream)?.();
        clearInterval(this._canvasCaptures.get(stream)); this._canvasCaptures.delete(stream);
        for (const track of stream?.getTracks?.() || []) track.stop();
        this._captures.delete(stream);
    }
    async pictureInPicture() {
        const capabilities = this.capabilities;
        if (this._disposed) throw new Error('Player has been disposed');
        if (document.pictureInPictureElement === this.video) return document.exitPictureInPicture();
        if (!capabilities.hasSource) throw new Error('Open a video before using picture in picture');
        if (capabilities.custom) throw new Error('Picture in picture is unavailable for authored canvas playback');
        if (!capabilities.ready) throw new Error('Wait for video metadata before using picture in picture');
        if (!capabilities.video) throw new Error('Picture in picture requires a video track; this source contains audio only or its video has ended');
        if (this.video.disablePictureInPicture) throw new Error('Picture in picture is disabled for this video');
        if (!capabilities.pip) throw new Error('Picture in picture is unavailable in this browser or page policy');
        try { return await this.video.requestPictureInPicture(); }
        catch (error) {
            const message = error.name === 'NotAllowedError' ? 'Use the picture-in-picture button to open the video. Your browser or page policy may block it.'
                : error.name === 'NotSupportedError' ? 'Picture in picture is not supported by this browser'
                : error.name === 'InvalidStateError' ? 'The video is no longer ready for picture in picture. Wait for a video frame and try again.'
                : 'Picture in picture could not start';
            throw new Error(message, { cause: error });
        }
    }
    async fullscreen() {
        if (document.fullscreenElement === this.element) return document.exitFullscreen();
        if (!this.capabilities.fullscreen) throw new Error('Load video before using fullscreen');
        return this.element.requestFullscreen();
    }

    clear({ silent = false } = {}) {
        const hadSource = this.capabilities.hasSource;
        this._epoch++;
        this._playGeneration++;
        if (this._raf !== null) cancelAnimationFrame(this._raf);
        this._raf = null; this._stopCustomAudio();
        this._custom?.client.dispose(); this._custom = null;
        this._hls?.destroy(); this._hls = null;
        for (const stream of this._captures) this.releaseCapture(stream);
        this._captures.clear();
        this.video.pause(); this.video.srcObject = null; this.video.removeAttribute('src'); this.video.load();
        for (const url of this._urls) URL.revokeObjectURL(url);
        this._urls.clear(); this._source = null; this._cues = []; this.captions.textContent = '';
        this.video.hidden = false; this.canvas.hidden = true;
        if (hadSource && !silent) this._emit('cleared', this.snapshot());
    }
    dispose() {
        if (this._disposed) return;
        this._emit('disposed', { reason: 'player-ended' });
        this.clear(); this._disposed = true;
        for (const event of MEDIA_EVENTS) this.video.removeEventListener(event, this._forward);
        this.video.removeEventListener('error', this._nativeError);
        this._policyObserver.disconnect();
        this._audioContext?.close().catch(() => {}); this._audioContext = null;
        this._listeners.clear(); this.element.remove();
        this._logger.debug?.('[VideoPlayer] disposed');
    }
}

export default VideoPlayer;
