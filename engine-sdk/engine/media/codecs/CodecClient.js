// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export const WORKER_URL = new URL('./CodecWorker.js', import.meta.url);

export class CodecClient {
    constructor({ debug = false, timeoutMs = 30_000 } = {}) {
        this.debug = debug; this.timeoutMs = timeoutMs; this.pending = new Map(); this.sequence = 0; this.disposed = false;
        this.worker = new Worker(WORKER_URL, { type: 'module', name: 'particle-authored-video-codec' });
        this.worker.addEventListener('message', ({ data }) => {
            const entry = this.pending.get(data.id);
            if (!entry) return;
            clearTimeout(entry.timer); this.pending.delete(data.id);
            if (this.debug) console.debug('[media][codec]', entry.operation, data.ok ? 'complete' : 'error', { elapsedMs: data.elapsedMs, pending: this.pending.size });
            if (data.ok) entry.resolve(data.result);
            else { const error = new Error(data.error.message); error.name = data.error.name; entry.reject(error); }
        });
        this.worker.addEventListener('error', event => this._fail(new Error(event.message || 'codec worker failed')));
        this.worker.addEventListener('messageerror', () => this._fail(new Error('codec worker response could not be decoded')));
    }
    _fail(error) {
        for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
        this.pending.clear();
        this.worker.terminate(); this.disposed = true;
    }
    request(operation, value = null) {
        if (this.disposed) return Promise.reject(new Error('codec client disposed'));
        if (this.pending.size >= 8) return Promise.reject(new Error('codec worker queue is full'));
        const id = ++this.sequence;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => this._fail(new Error(`codec ${operation} timed out`)), this.timeoutMs);
            this.pending.set(id, { operation, resolve, reject, timer });
            try { this.worker.postMessage({ id, operation, value }); }
            catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
        });
    }
    encode(options) { return this.request('encode', options); }
    encodeH264Pcm(options) { return this.request('encodeH264Pcm', options); }
    encodeMpeg1Intra(options) { return this.request('encodeMpeg1Intra', options); }
    encodeMpeg2Intra(options) { return this.request('encodeMpeg2Intra', options); }
    encodeAV1Intra(options) { return this.request('encodeAV1Intra', options); }
    open(bytes) { return this.request('open', bytes); }
    frame(index) { return this.request('frame', index); }
    seek(timestampUs) { return this.request('seek', timestampUs); }
    audio() { return this.request('audio'); }
    configureEncoder(options) { return this.request('configureEncoder', options); }
    encodePacket(rgba, options = {}) { return this.request('encodePacket', { ...options, rgba }); }
    decodePacket(bytes) { return this.request('decodePacket', bytes); }
    reset() { return this.request('reset'); }
    dispose() { if (!this.disposed) this._fail(new Error('codec client disposed')); }
}
