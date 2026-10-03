// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { MAX_PACKET_BYTES, MAX_WIRE_BYTES, normalizePacketMeta, normalizeSignal } from './Protocol.js';

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder('utf-8', { fatal: true });
const CHUNK_BYTES = 24 * 1024;
const MAX_BUFFERED_BYTES = 8 * 1024 * 1024;
const MAGIC = 0x57504231; // WPB1
const HEADER_BYTES = 20;

/** Two independent DTLS connections: signed control/custom media and native A/V. */
export class PartyPeer {
    constructor({ host, admissionId, iceServers, sendSignal, onControl, onPacket, onStream, onStatus, onError }) {
        if (typeof RTCPeerConnection !== 'function') throw new Error('This browser does not support WebRTC');
        this.host = host;
        this.admissionId = admissionId;
        this.sendSignal = sendSignal;
        this.onControl = onControl;
        this.onPacket = onPacket;
        this.onStream = onStream;
        this.onStatus = onStatus;
        this.onError = onError;
        this.closed = false;
        this.control = null;
        this.media = null;
        this.packetId = 0;
        this.assembly = null;
        this.stream = new MediaStream();
        this.connections = new Map();
        for (const channel of ['control', 'content']) this._createConnection(channel, iceServers);
        if (host) {
            const pc = this.connections.get('control').pc;
            this._wireDataChannel(pc.createDataChannel('watchparty-control-v1', { ordered: true }), 'control');
            this._wireDataChannel(pc.createDataChannel('watchparty-media-v1', { ordered: true }), 'media');
            const content = this.connections.get('content');
            content.audio = content.pc.addTransceiver('audio', { direction: 'sendonly' });
            content.video = content.pc.addTransceiver('video', { direction: 'sendonly' });
        }
        this.timer = setInterval(() => {
            if (this.assembly && Date.now() - this.assembly.startedAt > 15_000) this.assembly = null;
            for (const [channel, p] of this.connections) {
                if (this.host && p.pc.connectionState === 'disconnected' && Date.now() - p.lastRestart > 10_000) {
                    p.lastRestart = Date.now();
                    p.pc.restartIce();
                    void this.negotiate(channel);
                }
            }
        }, 2000);
    }

    _createConnection(channel, iceServers) {
        const pc = new RTCPeerConnection({ iceServers });
        const p = { pc, offerId: 0, remoteOfferId: 0, pendingIce: [], negotiating: false, pending: false, started: false, lastRestart: 0, queue: Promise.resolve() };
        this.connections.set(channel, p);
        pc.onicecandidate = event => {
            if (!event.candidate || this.closed || !p.offerId) return;
            this._sendSignal(channel, p.offerId, 'ice', event.candidate.toJSON());
        };
        pc.onnegotiationneeded = () => {
            if (this.host && p.started) void this.negotiate(channel);
        };
        pc.onsignalingstatechange = () => {
            if (this.host && p.pending && pc.signalingState === 'stable') void this.negotiate(channel);
        };
        pc.onconnectionstatechange = () => {
            if (this.closed) return;
            this.onStatus?.({ channel, state: pc.connectionState });
            if (this.host && pc.connectionState === 'failed' && Date.now() - p.lastRestart > 10_000) {
                p.lastRestart = Date.now();
                pc.restartIce();
                void this.negotiate(channel);
            }
        };
        if (channel === 'control') {
            pc.ondatachannel = event => {
                const kind = event.channel.label === 'watchparty-control-v1' ? 'control'
                    : event.channel.label === 'watchparty-media-v1' ? 'media' : null;
                if (this.host || !kind || this[kind]) event.channel.close();
                else this._wireDataChannel(event.channel, kind);
            };
        } else {
            pc.ontrack = event => {
                if (this.host || this.closed) return;
                if (!this.stream.getTracks().some(track => track.id === event.track.id)) this.stream.addTrack(event.track);
                event.track.onended = () => {
                    this.stream.removeTrack(event.track);
                    this.onStream?.(this.stream.getTracks().length ? this.stream : null);
                };
                this.onStream?.(this.stream);
            };
        }
    }

    _sendSignal(channel, offerId, type, data) {
        Promise.resolve(this.sendSignal({ channel, offerId, admissionId: this.admissionId, type, data }))
            .catch(error => { if (!this.closed) this.onError?.(error); });
    }

    async start() {
        if (!this.host || this.closed) return;
        for (const [channel, p] of this.connections) {
            p.started = true;
            await this.negotiate(channel);
        }
    }

    async negotiate(channel) {
        const p = this.connections.get(channel);
        if (!p || !this.host || this.closed) return;
        if (p.negotiating || p.pc.signalingState !== 'stable') { p.pending = true; return; }
        p.negotiating = true;
        p.pending = false;
        try {
            if (p.offerId >= 0xffffffff) throw new Error('RTC offer counter exhausted');
            ++p.offerId;
            await p.pc.setLocalDescription(await p.pc.createOffer());
            if (!this.closed) await this.sendSignal({
                channel, offerId: p.offerId, admissionId: this.admissionId, type: 'offer',
                data: { type: 'offer', sdp: p.pc.localDescription.sdp },
            });
        } catch (error) { if (!this.closed) this.onError?.(error); }
        finally {
            p.negotiating = false;
            if (!this.closed && p.pending && p.pc.signalingState === 'stable') {
                queueMicrotask(() => { if (!this.closed) void this.negotiate(channel); });
            }
        }
    }

    acceptSignal(raw) {
        const body = normalizeSignal(raw);
        if (body.admissionId !== this.admissionId || this.closed) return Promise.resolve(false);
        const p = this.connections.get(body.channel);
        p.queue = p.queue.then(() => this._acceptSignal(p, body)).catch(error => {
            if (!this.closed) this.onError?.(error);
            return false;
        });
        return p.queue;
    }

    async _acceptSignal(p, body) {
        if (this.closed) return false;
        const pc = p.pc;
        if (body.type === 'ice') {
            if (body.offerId < p.remoteOfferId || p.pendingIce.length >= 128) return false;
            if (pc.remoteDescription && body.offerId === p.remoteOfferId) await pc.addIceCandidate(body.data);
            else p.pendingIce.push({ offerId: body.offerId, data: body.data });
            return true;
        }
        if (body.type === 'offer') {
            if (this.host || body.offerId <= p.remoteOfferId) return false;
            if (pc.signalingState !== 'stable') await pc.setLocalDescription({ type: 'rollback' });
            p.offerId = body.offerId;
            p.remoteOfferId = body.offerId;
            await pc.setRemoteDescription(body.data);
            await this._flushIce(p);
            await pc.setLocalDescription(await pc.createAnswer());
            await this.sendSignal({ channel: body.channel, offerId: body.offerId, admissionId: this.admissionId,
                type: 'answer', data: { type: 'answer', sdp: pc.localDescription.sdp } });
            return true;
        }
        if (!this.host || body.offerId !== p.offerId || pc.signalingState !== 'have-local-offer') return false;
        p.remoteOfferId = body.offerId;
        await pc.setRemoteDescription(body.data);
        await this._flushIce(p);
        return true;
    }

    async _flushIce(p) {
        const pending = p.pendingIce.splice(0);
        for (const candidate of pending) {
            if (candidate.offerId === p.remoteOfferId) await p.pc.addIceCandidate(candidate.data);
            else if (candidate.offerId > p.remoteOfferId) p.pendingIce.push(candidate);
        }
    }

    _wireDataChannel(dc, kind) {
        this[kind] = dc;
        dc.binaryType = 'arraybuffer';
        dc.bufferedAmountLowThreshold = 128 * 1024;
        dc.onopen = () => this.onStatus?.({ channel: kind, state: 'open' });
        dc.onclose = () => {
            if (this[kind] === dc) this[kind] = null;
            if (!this.closed) this.onStatus?.({ channel: kind, state: 'closed' });
        };
        dc.onerror = () => { if (!this.closed) this.onError?.(new Error(`Watch Party ${kind} channel failed`)); };
        dc.onmessage = event => {
            if (this.closed) return;
            try {
                if (kind === 'control') {
                    if (typeof event.data !== 'string' || ENCODER.encode(event.data).length > MAX_WIRE_BYTES + 1024) return;
                    this.onControl?.(JSON.parse(event.data));
                } else if (!this.host && event.data instanceof ArrayBuffer) this._receivePacket(event.data);
            } catch (error) { this.onError?.(error); }
        };
    }

    sendControl(envelope) {
        if (this.closed || this.control?.readyState !== 'open' || this.control.bufferedAmount > 256 * 1024) return false;
        const wire = JSON.stringify(envelope);
        if (ENCODER.encode(wire).length > MAX_WIRE_BYTES + 1024) return false;
        try { this.control.send(wire); return true; } catch (_) { return false; }
    }

    sendPacket(bytes, inputMeta) {
        if (!this.host || this.closed || this.media?.readyState !== 'open') return false;
        const meta = normalizePacketMeta(inputMeta);
        if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > MAX_PACKET_BYTES) throw new RangeError('Invalid custom media packet length');
        if (this.media.bufferedAmount + bytes.length + 64 * 1024 > MAX_BUFFERED_BYTES) {
            this.onStatus?.({ channel: 'media', state: 'backpressure' });
            return false;
        }
        const metadata = ENCODER.encode(JSON.stringify(meta));
        const rtcLimit = this.connections.get('control').pc.sctp?.maxMessageSize || 65536;
        const chunkBytes = Math.min(CHUNK_BYTES, rtcLimit - HEADER_BYTES - metadata.length);
        if (chunkBytes < 512) return false;
        this.packetId = (this.packetId + 1) >>> 0 || 1;
        try {
            for (let offset = 0; offset < bytes.length; offset += chunkBytes) {
                const metaBytes = offset === 0 ? metadata : new Uint8Array(0);
                const size = Math.min(chunkBytes, bytes.length - offset);
                const frame = new Uint8Array(HEADER_BYTES + metaBytes.length + size);
                const view = new DataView(frame.buffer);
                view.setUint32(0, MAGIC);
                view.setUint32(4, this.packetId);
                view.setUint32(8, bytes.length);
                view.setUint32(12, offset);
                view.setUint16(16, metaBytes.length);
                frame.set(metaBytes, HEADER_BYTES);
                frame.set(bytes.subarray(offset, offset + size), HEADER_BYTES + metaBytes.length);
                this.media.send(frame);
            }
            return true;
        } catch (_) { return false; }
    }

    _receivePacket(buffer) {
        if (buffer.byteLength < HEADER_BYTES || buffer.byteLength > CHUNK_BYTES + HEADER_BYTES + 512) return;
        const view = new DataView(buffer);
        const id = view.getUint32(4), total = view.getUint32(8), offset = view.getUint32(12), metaLength = view.getUint16(16);
        if (view.getUint32(0) !== MAGIC || !id || !total || total > MAX_PACKET_BYTES || metaLength > 512 || view.getUint16(18) !== 0
            || HEADER_BYTES + metaLength >= buffer.byteLength) return;
        const bytes = new Uint8Array(buffer, HEADER_BYTES + metaLength);
        if (offset + bytes.length > total) return;
        if (offset === 0) {
            if (!metaLength) return;
            const meta = normalizePacketMeta(JSON.parse(DECODER.decode(new Uint8Array(buffer, HEADER_BYTES, metaLength))));
            this.assembly = { id, total, meta, bytes: new Uint8Array(total), received: 0, startedAt: Date.now() };
        }
        const assembly = this.assembly;
        if (!assembly || assembly.id !== id || assembly.total !== total || offset !== assembly.received || (offset > 0 && metaLength)) return;
        assembly.bytes.set(bytes, offset);
        assembly.received += bytes.length;
        if (assembly.received === total) {
            this.assembly = null;
            this.onPacket?.(assembly.bytes, assembly.meta);
        }
    }

    async attachStream(stream) {
        if (!this.host || this.closed) return;
        const p = this.connections.get('content');
        await Promise.all(['audio', 'video'].map(kind => p[kind].sender.replaceTrack(stream?.getTracks().find(track => track.kind === kind && track.readyState === 'live') || null)));
        if (p.started) await this.negotiate('content');
    }

    async updateIce(iceServers, restart = true) {
        if (this.closed) return;
        for (const [channel, p] of this.connections) {
            p.pc.setConfiguration({ ...p.pc.getConfiguration(), iceServers });
            if (restart && this.host && p.started) {
                p.pc.restartIce();
                await this.negotiate(channel);
            }
        }
    }

    close() {
        if (this.closed) return;
        this.closed = true;
        clearInterval(this.timer);
        this.assembly = null;
        for (const dc of [this.control, this.media]) {
            if (!dc) continue;
            dc.onopen = dc.onclose = dc.onerror = dc.onmessage = null;
            try { dc.close(); } catch (_) {}
        }
        for (const p of this.connections.values()) {
            p.pc.onicecandidate = p.pc.onnegotiationneeded = p.pc.onsignalingstatechange = p.pc.onconnectionstatechange = p.pc.ontrack = p.pc.ondatachannel = null;
            try { p.pc.close(); } catch (_) {}
            p.pendingIce.length = 0;
        }
        for (const track of this.stream.getTracks()) { track.onended = null; track.stop(); }
        this.connections.clear();
        this.control = this.media = null;
    }
}
