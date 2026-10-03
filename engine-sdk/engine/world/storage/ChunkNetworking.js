// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Versioned multiplayer chunk synchronization with legacy read compatibility.
 *
 * V1 remains the write format during the expand phase. V1, V2, and the
 * original unversioned response shape can be read, allowing rolling upgrades
 * without relabelling or discarding old traffic.
 */

export const CHUNK_NETWORK_PROTOCOL = Object.freeze({
    V1: 'particle-chunk-network/1',
    V2: 'particle-chunk-network/2',
});
export const CHUNK_NETWORK_WRITE_PROTOCOL = CHUNK_NETWORK_PROTOCOL.V1;
export const CHUNK_NETWORK_READ_PROTOCOLS = Object.freeze([
    CHUNK_NETWORK_PROTOCOL.V2,
    CHUNK_NETWORK_PROTOCOL.V1,
]);

const MESSAGE_TYPE = Object.freeze({
    REQUEST: 'chunk_request',
    DATA: 'chunk_data',
    UPDATE: 'chunk_update',
});
const MAX_BATCH_SIZE = 256;
const MAX_CHUNKS_PER_MESSAGE = 256;
const DEFAULT_MAX_MESSAGE_BYTES = 16 * 1024 * 1024;
const MAX_CHUNK_KEY_BYTES = 512;
const MAX_JSON_DEPTH = 64;
const TEXT_ENCODER = new TextEncoder();
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export class ChunkNetworking {
    constructor(options = {}) {
        this.enabled = false;
        this.batchSize = 8;
        this.timeoutMs = 5000;
        this.compress = false;
        this.maxPending = 32;
        this.priorityMode = 'distance';
        this.maxMessageBytes = DEFAULT_MAX_MESSAGE_BYTES;
        this.writeProtocol = CHUNK_NETWORK_WRITE_PROTOCOL;

        this.WebSocketImpl = options.WebSocketImpl ?? globalThis.WebSocket;
        this.connected = false;
        this.socket = null;
        this.serverUrl = null;
        this.peerProtocol = null;

        this.pendingRequests = new Map();
        this.requestQueue = [];
        this.queuedKeys = new Set();
        this.nextRequestId = 0;

        this.stats = {
            requestsSent: 0,
            requestsReceived: 0,
            bytesReceived: 0,
            bytesSent: 0,
            avgLatencyMs: 0,
            timeouts: 0,
            invalidMessages: 0,
            legacyMessages: 0,
            staleResponses: 0,
        };

        this.onChunkReceived = null;
        this.onConnectionChange = null;
        this.onProtocolError = null;
    }

    async connect(url) {
        if (!this.enabled) return false;
        if (!this.WebSocketImpl) throw new Error('WebSocket is unavailable');
        if (this.socket) this.disconnect();
        this.serverUrl = String(url);

        return new Promise((resolve, reject) => {
            let settled = false;
            try {
                const socket = new this.WebSocketImpl(this.serverUrl);
                this.socket = socket;
                socket.onopen = () => {
                    if (this.socket !== socket) return;
                    this.connected = true;
                    settled = true;
                    this.onConnectionChange?.(true);
                    console.debug?.(`[ChunkNetworking][connect][exit] protocol=${this.writeProtocol}`);
                    resolve(true);
                };
                socket.onclose = () => {
                    if (this.socket !== socket) return;
                    this.connected = false;
                    this.onConnectionChange?.(false);
                };
                socket.onerror = (error) => {
                    if (!settled) reject(error);
                    else this._reportProtocolError(error, 'socket-error');
                };
                socket.onmessage = (event) => { void this._handleMessage(event.data); };
            } catch (error) {
                reject(error);
            }
        });
    }

    disconnect() {
        for (const pending of this.pendingRequests.values()) clearTimeout(pending.timeoutHandle);
        this.pendingRequests.clear();
        this.requestQueue = [];
        this.queuedKeys.clear();
        this.peerProtocol = null;
        const socket = this.socket;
        this.socket = null;
        this.connected = false;
        socket?.close?.();
    }

    requestChunks(keys, priority = 0) {
        if (!this.enabled || !this.connected || !Array.isArray(keys)) return 0;
        let queued = 0;
        for (const key of keys) {
            if (this.pendingRequests.size + this.requestQueue.length >= this.maxPending) break;
            try { validateChunkKey(key); }
            catch (error) { this._reportProtocolError(error, 'invalid-request-key'); continue; }
            if (this.pendingRequests.has(key) || this.queuedKeys.has(key)) continue;
            this.requestQueue.push({ key, priority: finiteNumber(priority, 0), queueTime: nowMs(), attempt: 0 });
            this.queuedKeys.add(key);
            queued++;
        }
        if (this.priorityMode === 'distance') {
            this.requestQueue.sort((left, right) => right.priority - left.priority);
        }
        return queued;
    }

    processQueue() {
        if (!this.connected || this.requestQueue.length === 0) return 0;
        const items = [];
        while (items.length < this.batchSize && this.requestQueue.length > 0) {
            const item = this.requestQueue.shift();
            this.queuedKeys.delete(item.key);
            if (!this.pendingRequests.has(item.key)) {
                items.push({ ...item, requestId: this._allocateRequestId() });
            }
        }
        if (!items.length) return 0;

        const sent = this._sendRequest({
            type: MESSAGE_TYPE.REQUEST,
            chunks: items.map(item => ({ id: item.requestId, key: item.key })),
        });
        if (!sent) {
            for (const item of items.reverse()) {
                this.requestQueue.unshift(item);
                this.queuedKeys.add(item.key);
            }
            return 0;
        }

        const sentTime = nowMs();
        for (const item of items) {
            this.pendingRequests.set(item.key, {
                requestId: item.requestId,
                attempt: item.attempt,
                sentTime,
                timeoutHandle: setTimeout(() => this._handleTimeout(item.key), this.timeoutMs),
            });
        }
        this.stats.requestsSent += items.length;
        return items.length;
    }

    _sendRequest(data) {
        if (!this.socket || this.socket.readyState !== this.WebSocketImpl.OPEN) return false;
        try {
            const payload = JSON.stringify({ ...data, protocol: this.writeProtocol });
            const payloadBytes = utf8Bytes(payload);
            if (payloadBytes > this.maxMessageBytes) {
                throw new RangeError(`Chunk message is ${payloadBytes} bytes; maximum is ${this.maxMessageBytes}`);
            }
            this.socket.send(payload);
            this.stats.bytesSent += payloadBytes;
            return true;
        } catch (error) {
            this._reportProtocolError(error, 'send-failed');
            return false;
        }
    }

    async _handleMessage(data) {
        try {
            const text = await toText(data);
            const byteLength = utf8Bytes(text);
            if (byteLength > this.maxMessageBytes) {
                throw new RangeError(`Chunk message is ${byteLength} bytes; maximum is ${this.maxMessageBytes}`);
            }
            const message = JSON.parse(text);
            validateJsonValue(message);
            if (!isRecord(message)) throw new TypeError('Chunk message must be an object');
            this.stats.bytesReceived += byteLength;
            const acceptedProtocol = this._acceptProtocol(message.protocol);

            if (message.type === MESSAGE_TYPE.DATA) this._handleChunkData(message, acceptedProtocol);
            else if (message.type === MESSAGE_TYPE.UPDATE) this._handleChunkUpdate(message);
            else throw new TypeError(`Unknown chunk message type: ${message.type}`);
        } catch (error) {
            this._reportProtocolError(error, 'invalid-message');
        }
    }

    _acceptProtocol(protocol) {
        if (protocol === undefined) {
            this.stats.legacyMessages++;
            return null;
        }
        if (!CHUNK_NETWORK_READ_PROTOCOLS.includes(protocol)) {
            throw new TypeError(`Unsupported chunk network protocol: ${protocol}`);
        }
        this.peerProtocol = protocol;
        return protocol;
    }

    _handleChunkData(message, protocol) {
        if (!Array.isArray(message.chunks) || message.chunks.length > MAX_CHUNKS_PER_MESSAGE) {
            throw new TypeError(`chunk_data.chunks must contain at most ${MAX_CHUNKS_PER_MESSAGE} items`);
        }
        const candidates = [];
        const messageKeys = new Set();
        for (const chunk of message.chunks) {
            if (!isRecord(chunk) || !Object.hasOwn(chunk, 'data')) {
                throw new TypeError('Each chunk_data item requires key and data');
            }
            validateChunkKey(chunk.key);
            if (messageKeys.has(chunk.key)) throw new TypeError(`Duplicate chunk_data key: ${chunk.key}`);
            messageKeys.add(chunk.key);
            const hasRequestId = Object.hasOwn(chunk, 'id');
            if (hasRequestId && (!Number.isSafeInteger(chunk.id) || chunk.id < 0)) {
                throw new TypeError('chunk_data request id must be a non-negative safe integer');
            }
            if (protocol !== null && !hasRequestId) {
                throw new TypeError('Versioned chunk_data items require a request id');
            }
            const pending = this.pendingRequests.get(chunk.key);
            if (!pending) {
                this.stats.staleResponses++;
                continue;
            }
            if (hasRequestId && chunk.id !== pending.requestId) {
                this.stats.staleResponses++;
                continue;
            }
            if (!hasRequestId && pending.attempt > 0) {
                // An id-less legacy response cannot be distinguished from the
                // timed-out attempt, so it must never satisfy a retry.
                this.stats.staleResponses++;
                continue;
            }
            candidates.push({ chunk, pending });
        }
        for (const { chunk, pending } of candidates) {
            clearTimeout(pending.timeoutHandle);
            const latency = nowMs() - pending.sentTime;
            this.stats.avgLatencyMs = (this.stats.avgLatencyMs * 0.9) + (latency * 0.1);
            this.pendingRequests.delete(chunk.key);
            this.stats.requestsReceived++;
            this.onChunkReceived?.(chunk.key, chunk.data);
        }
    }

    _handleChunkUpdate(message) {
        validateChunkKey(message.key);
        const hasData = Object.hasOwn(message, 'data');
        const hasUpdate = Object.hasOwn(message, 'update');
        if (!hasData && !hasUpdate) throw new TypeError('chunk_update requires data or update');
        this.onChunkReceived?.(message.key, hasData ? message.data : message.update, true);
    }

    _handleTimeout(key) {
        const pending = this.pendingRequests.get(key);
        if (!pending) return;
        this.pendingRequests.delete(key);
        this.stats.timeouts++;
        if (!this.enabled || !this.connected || this.queuedKeys.has(key)) return;
        if (this.pendingRequests.size + this.requestQueue.length >= this.maxPending) return;
        this.requestQueue.push({
            key,
            priority: -10,
            queueTime: nowMs(),
            attempt: pending.attempt + 1,
        });
        this.queuedKeys.add(key);
    }

    sendUpdate(key, update) {
        if (!this.connected) return false;
        try { validateChunkKey(key); validateJsonValue(update); }
        catch (error) { this._reportProtocolError(error, 'invalid-update'); return false; }
        return this._sendRequest({ type: MESSAGE_TYPE.UPDATE, key, update });
    }

    getStats() {
        return {
            ...this.stats,
            connected: this.connected,
            pendingCount: this.pendingRequests.size,
            queueLength: this.requestQueue.length,
            writeProtocol: this.writeProtocol,
            peerProtocol: this.peerProtocol ?? 'legacy-unversioned',
        };
    }

    loadConfig(cfg) {
        if (!cfg || typeof cfg !== 'object') return;
        this.enabled = cfg.enabled === true;
        this.batchSize = boundedInteger(cfg.batch_size, 1, MAX_BATCH_SIZE, 8);
        this.timeoutMs = boundedInteger(cfg.timeout_ms, 100, 120_000, 5000);
        this.compress = false;
        this.maxPending = boundedInteger(cfg.max_pending, 1, 4096, 32);
        this.maxMessageBytes = boundedInteger(
            cfg.max_message_bytes,
            1024,
            256 * 1024 * 1024,
            DEFAULT_MAX_MESSAGE_BYTES,
        );
        this.priorityMode = cfg.priority_mode === 'fifo' ? 'fifo' : 'distance';
        if (cfg.protocol !== undefined) {
            if (!CHUNK_NETWORK_READ_PROTOCOLS.includes(cfg.protocol)) {
                throw new TypeError(`Unsupported chunk network write protocol: ${cfg.protocol}`);
            }
            this.writeProtocol = cfg.protocol;
        }
    }

    destroy() {
        this.disconnect();
        this.onChunkReceived = null;
        this.onConnectionChange = null;
        this.onProtocolError = null;
    }

    _allocateRequestId() {
        const requestId = this.nextRequestId;
        this.nextRequestId = (this.nextRequestId + 1) % Number.MAX_SAFE_INTEGER;
        return requestId;
    }

    _reportProtocolError(error, code) {
        this.stats.invalidMessages++;
        console.error(`[ChunkNetworking][${code}]`, error);
        this.onProtocolError?.(Object.assign(error instanceof Error ? error : new Error(String(error)), { code }));
    }
}

function validateChunkKey(key) {
    if (typeof key !== 'string' || !key || utf8Bytes(key) > MAX_CHUNK_KEY_BYTES || /[\u0000-\u001f]/.test(key)) {
        throw new TypeError('Chunk key must be bounded non-control UTF-8 text');
    }
    return key;
}

function validateJsonValue(root) {
    const stack = [{ value: root, depth: 0 }];
    const seen = new WeakSet();
    let nodes = 0;
    while (stack.length) {
        const { value, depth } = stack.pop();
        if (++nodes > 100_000) throw new TypeError('Chunk message exceeds the JSON node limit');
        if (depth > MAX_JSON_DEPTH) throw new TypeError('Chunk message exceeds the JSON depth limit');
        if (value === null || typeof value === 'string' || typeof value === 'boolean') continue;
        if (typeof value === 'number') {
            if (!Number.isFinite(value)) throw new TypeError('Chunk message contains a non-finite number');
            continue;
        }
        if (!value || typeof value !== 'object') throw new TypeError(`Chunk message contains unsupported ${typeof value}`);
        if (seen.has(value)) continue;
        seen.add(value);
        if (!Array.isArray(value) && !isRecord(value)) throw new TypeError('Chunk message must contain plain objects and arrays');
        for (const [key, child] of Object.entries(value)) {
            if (FORBIDDEN_KEYS.has(key)) throw new TypeError(`Unsafe chunk message key: ${key}`);
            stack.push({ value: child, depth: depth + 1 });
        }
    }
}

function isRecord(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

async function toText(data) {
    if (typeof data === 'string') return data;
    if (data instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(data));
    if (ArrayBuffer.isView(data)) return new TextDecoder().decode(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    if (typeof data?.text === 'function') return data.text();
    throw new TypeError('Chunk WebSocket messages must contain UTF-8 JSON text');
}

function boundedInteger(value, minimum, maximum, fallback) {
    if (value === undefined || value === null || value === '') return fallback;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

function finiteNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function utf8Bytes(value) {
    return TEXT_ENCODER.encode(value).byteLength;
}

function nowMs() {
    return globalThis.performance?.now?.() ?? Date.now();
}

export default ChunkNetworking;
