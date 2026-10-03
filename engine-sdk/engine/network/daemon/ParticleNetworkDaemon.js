// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { generateHpkeKeyPair, hpkeOpen, hpkeSeal } from '../crypto/Hpke.js';
import { deriveOpaqueRoute } from '../crypto/OpaqueRoute.js';
import { canonicalJson, sha256Hex, verifyRawSignature, verifySignedManifest, verifySignedV3Manifest } from '../crypto/Trust.js';
import { createReconnectBackoff, nextBackoffDelay, resetBackoff } from '../routes/ReconnectBackoff.js';
import { createBrowserRecordContract } from '../../core/schema/BrowserRecordContract.js';

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder('utf-8', { fatal: true });
const SESSION_PROTOCOL = 'particle-session/2';
const ROUTE_PROTOCOL = 'particle-route/2';
const SIGNAL_PROTOCOL = 'particle-signal/2';
const HEARTBEAT_MS = 20_000;
const ROUTE_RENEW_MS = 30_000;
const HTTP_TIMEOUT_MS = 10_000;
const CONNECT_TIMEOUT_MS = 10_000;
const PROOF_TIMEOUT_MS = 10_000;
const STABLE_CONNECTION_MS = 30_000;
const MAX_HTTP_RESPONSE_BYTES = 65_536;
const MAX_WS_MESSAGE_BYTES = 65_536;
const MAX_INBOUND_QUEUE_FRAMES = 16;
const MAX_OUTBOUND_BUFFERED_BYTES = 262_144;
const MAX_ROUTES = 32;
const MAX_PENDING_DIRECTED = 128;
const MAX_PEER_SESSIONS = 2_048;
const SIGNAL_RATE_PER_SECOND = 20;
const SIGNAL_BURST = 40;
const TRUST_MEMORY = new Map();
const MAX_ICE_SERVERS = 16;
const MAX_ICE_URLS_PER_SERVER = 16;
const MAX_ICE_FIELD_BYTES = 1024;
const STATE_CHANNEL_LEASE_FORMAT = 'particle-state-channel-lease-request/1';
const MAX_STATE_CHANNEL_TOKEN_BYTES = 8192;
const DIRECT_STUN_URLS = new Set([
    'stun:stun.cloudflare.com:3478',
    'stun:stun.l.google.com:19302',
]);

export const PARTICLE_TRUST_FLOOR_SCHEMA = 'particle.network-trust-floor';
export const PARTICLE_TRUST_FLOOR_SCHEMA_VERSION = 2;

function trustFloorKey(networkRootId, nodeId, version) {
    return `particle.network.trust.v${version}:${networkRootId}:${nodeId}`;
}

function particleTrustFloorContract(networkRootId, nodeId) {
    return createBrowserRecordContract({
        schema: PARTICLE_TRUST_FLOOR_SCHEMA,
        legacyKey: trustFloorKey(networkRootId, nodeId, 1),
        currentKey: trustFloorKey(networkRootId, nodeId, 2),
        payloadKey: 'floor',
        maxBytes: 4096,
        validate: value => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
            && Number.isSafeInteger(value.rootVersion) && value.rootVersion >= 0
            && Number.isSafeInteger(value.rollbackVersion) && value.rollbackVersion >= 0
            && Number.isSafeInteger(value.issuedAt) && value.issuedAt >= 0,
    });
}

export function readParticleTrustFloor(networkRootId, nodeId, storage = globalThis.localStorage) {
    return particleTrustFloorContract(networkRootId, nodeId).read(storage);
}

export function writeParticleTrustFloor(networkRootId, nodeId, floor, storage = globalThis.localStorage) {
    return particleTrustFloorContract(networkRootId, nodeId).write(floor, storage);
}

function boundedIceText(value) {
    return typeof value === 'string' && value.length > 0
        && ENCODER.encode(value).byteLength <= MAX_ICE_FIELD_BYTES;
}

/**
 * Validate and normalize a V2 ICE response. Explicit direct mode is strict so
 * a malformed or compromised response cannot smuggle relay credentials into a
 * no-TURN client. Legacy relay responses remain accepted when they contain a
 * real authenticated TURN URL.
 */
export function particleIceConfigurationReport(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || !Number.isSafeInteger(value.expiresAt)
        || !Array.isArray(value.iceServers)
        || value.iceServers.length < 1 || value.iceServers.length > MAX_ICE_SERVERS) {
        return { valid: false, value: null, relayAvailable: false };
    }
    const declaresDirect = value.mode === 'direct' || value.relayAvailable === false;
    if (declaresDirect && (value.mode !== 'direct' || value.relayAvailable !== false
        || Object.keys(value).sort().join('\0') !== ['expiresAt', 'iceServers', 'mode', 'relayAvailable'].join('\0'))) {
        return { valid: false, value: null, relayAvailable: false };
    }
    const iceServers = [];
    let hasRelay = false;
    for (const server of value.iceServers) {
        if (!server || typeof server !== 'object' || Array.isArray(server)) {
            return { valid: false, value: null, relayAvailable: false };
        }
        if (declaresDirect && Object.keys(server).join('\0') !== 'urls') {
            return { valid: false, value: null, relayAvailable: false };
        }
        const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
        if (urls.length < 1 || urls.length > MAX_ICE_URLS_PER_SERVER
            || !urls.every(boundedIceText)) {
            return { valid: false, value: null, relayAvailable: false };
        }
        const schemes = urls.map((url) => url.slice(0, url.indexOf(':') + 1));
        if (declaresDirect && !urls.every((url) => DIRECT_STUN_URLS.has(url))) {
            return { valid: false, value: null, relayAvailable: false };
        }
        if (!schemes.every((scheme) => ['stun:', 'turn:', 'turns:'].includes(scheme))) {
            return { valid: false, value: null, relayAvailable: false };
        }
        const serverHasRelay = schemes.some((scheme) => scheme === 'turn:' || scheme === 'turns:');
        if (serverHasRelay && (!boundedIceText(server.username) || !boundedIceText(server.credential))) {
            return { valid: false, value: null, relayAvailable: false };
        }
        if (server.username !== undefined && !boundedIceText(server.username)) {
            return { valid: false, value: null, relayAvailable: false };
        }
        if (server.credential !== undefined && !boundedIceText(server.credential)) {
            return { valid: false, value: null, relayAvailable: false };
        }
        hasRelay ||= serverHasRelay;
        iceServers.push({
            ...server,
            urls: Array.isArray(server.urls) ? [...urls] : urls[0],
        });
    }
    if (!declaresDirect && !hasRelay) {
        return { valid: false, value: null, relayAvailable: false };
    }
    const normalized = {
        iceServers,
        expiresAt: value.expiresAt,
        relayAvailable: !declaresDirect,
        mode: declaresDirect ? 'direct' : 'relay',
    };
    return { valid: true, value: normalized, relayAvailable: normalized.relayAvailable };
}

function enforceMonotonicTrust(manifest) {
    const payload = manifest?.payload;
    if (
        typeof payload?.networkRootId !== 'string'
        || typeof payload?.nodeId !== 'string'
        || !Number.isSafeInteger(payload?.networkRootVersion)
        || !Number.isSafeInteger(payload?.networkRootRollbackVersion)
        || !Number.isSafeInteger(payload?.issuedAt)
    ) return false;
    const key = trustFloorKey(payload.networkRootId, payload.nodeId, 2);
    let previous = TRUST_MEMORY.get(key) ?? null;
    const storage = globalThis.localStorage ?? null;
    if (storage) {
        try {
            previous = readParticleTrustFloor(payload.networkRootId, payload.nodeId, storage) ?? previous;
        } catch (error) {
            console.warn('[ParticleNetworkDaemon] Trust-floor record rejected:', error?.code || error);
            return false;
        }
    }
    if (previous && (
        payload.networkRootVersion < previous.rootVersion
        || payload.networkRootRollbackVersion < previous.rollbackVersion
        || (payload.networkRootVersion === previous.rootVersion && payload.issuedAt < previous.issuedAt)
    )) return false;
    const next = {
        rootVersion: Math.max(previous?.rootVersion ?? 0, payload.networkRootVersion),
        rollbackVersion: Math.max(previous?.rollbackVersion ?? 0, payload.networkRootRollbackVersion),
        issuedAt: Math.max(previous?.issuedAt ?? 0, payload.issuedAt),
    };
    if (storage) {
        try {
            writeParticleTrustFloor(payload.networkRootId, payload.nodeId, next, storage);
        } catch (error) {
            console.warn('[ParticleNetworkDaemon] Trust-floor write blocked:', error?.code || error);
            return false;
        }
    }
    TRUST_MEMORY.set(key, next);
    return true;
}

function randomId(prefix) {
    if (typeof crypto?.randomUUID === 'function') return `${prefix}-${crypto.randomUUID()}`;
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return `${prefix}-${[...bytes].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

function endpointSet(server, protocolVersion = 2) {
    const configured = new URL(server.url, globalThis.location?.href);
    const secure = configured.protocol === 'wss:' || configured.protocol === 'https:';
    const http = new URL(configured.href);
    http.protocol = secure ? 'https:' : 'http:';
    http.pathname = '';
    http.search = '';
    http.hash = '';
    const websocket = new URL(configured.href);
    websocket.protocol = secure ? 'wss:' : 'ws:';
    websocket.pathname = protocolVersion === 3 ? '/v3/ws' : '/v2/ws';
    websocket.search = '';
    websocket.hash = '';
    return {
        manifest: new URL(protocolVersion === 3 ? '/v3/manifest' : '/v2/manifest', http).href,
        admission: new URL(protocolVersion === 3 ? '/v3/admission' : '/v2/admission', http).href,
        turn: protocolVersion === 3 ? null : new URL('/v2/turn', http).href,
        websocket: websocket.href,
    };
}

export class ParticleNetworkDaemon {
    constructor({
        server,
        deviceSigner,
        onEvent = null,
        fetchImpl = globalThis.fetch,
        WebSocketImpl = globalThis.WebSocket,
        protocolVersion = 2,
    } = {}) {
        const configuredPins = server?.serverKeyPins?.length ? server.serverKeyPins : server?.serverKeyPin;
        if (![2, 3].includes(protocolVersion)) throw new TypeError('daemon protocolVersion must be 2 or 3');
        if (!server?.url || !configuredPins) throw new TypeError('network daemon requires a server URL and pinned signing key');
        if (!deviceSigner?.publicKeyHex || typeof deviceSigner.signRaw !== 'function') throw new TypeError('network daemon requires a device signer');
        this.protocolVersion = protocolVersion;
        this.sessionProtocol = protocolVersion === 3 ? 'particle-session/3' : SESSION_PROTOCOL;
        this.routeProtocol = protocolVersion === 3 ? 'particle-rendezvous/3' : ROUTE_PROTOCOL;
        this.signalProtocol = protocolVersion === 3 ? 'particle-rendezvous/3' : SIGNAL_PROTOCOL;
        this.signalMessageType = protocolVersion === 3 ? 'RENDEZVOUS' : 'SIGNAL';
        this.signalAckType = protocolVersion === 3 ? 'RENDEZVOUS_ACK' : 'SIGNAL_ACK';
        this.hpkeInfo = ENCODER.encode(protocolVersion === 3 ? 'particle-rendezvous/3' : 'particle-signal/2');
        this.server = Object.freeze({ ...server });
        this.serverPins = Array.isArray(configuredPins) ? Object.freeze([...configuredPins]) : configuredPins;
        this.deviceSigner = deviceSigner;
        this.onEvent = onEvent;
        // Native Window.fetch requires its Window receiver in some browsers.
        this.fetchImpl = fetchImpl.bind(globalThis);
        this.WebSocketImpl = WebSocketImpl;
        this.endpoints = endpointSet(server, protocolVersion);
        this.state = 'idle';
        this.sessionId = null;
        this.manifest = null;
        this.manifestHash = null;
        this.grant = null;
        this.grantExpiresAt = 0;
        this.hpke = null;
        this.ws = null;
        this.routes = new Map();
        this.routePeers = new Map();
        this.peerSessions = new Map();
        this.pendingBroadcasts = new Map();
        this.pendingDirected = new Map();
        this.receivedSignals = new Map();
        this.receivedSequences = new Map();
        this.sequence = 0;
        this.connectionGeneration = 0;
        this.inboundQueue = [];
        this.processingInbound = false;
        this.signalTokens = SIGNAL_BURST;
        this.signalLastRefill = globalThis.performance?.now?.() ?? Date.now();
        this.destroyed = false;
        this.backoff = createReconnectBackoff({ maxAttempts: 0 });
        this.reconnectTimer = null;
        this.heartbeatTimer = null;
        this.routeRenewTimer = null;
        this.turnTimer = null;
        this.stableConnectionTimer = null;
        this.connectTimer = null;
        this.proofTimer = null;
        this.turnCredentials = null;
        this.turnRefreshPromise = null;
        this.admissionRefreshPromise = null;
    }

    _emit(type, extra = {}) {
        try { this.onEvent?.({ type, state: this.state, sessionId: this.sessionId, protocol: this.sessionProtocol, server: this.server, ...extra }); } catch (_) {}
    }

    async connect() {
        if (this.destroyed || this.ws || ['connecting', 'admitting', 'proving'].includes(this.state)) return;
        this.state = 'connecting';
        this._emit('connecting');
        try {
            const { response: manifestResponse, value: manifest } = await this._fetchJson(
                this.endpoints.manifest, { cache: 'no-store' }, HTTP_TIMEOUT_MS,
            );
            if (this.destroyed) return;
            if (!manifestResponse.ok) throw new Error(`manifest HTTP ${manifestResponse.status}`);
            const verifyManifest = this.protocolVersion === 3 ? verifySignedV3Manifest : verifySignedManifest;
            if (!await verifyManifest(
                manifest, this.serverPins, Math.floor(Date.now() / 1000),
                this.server.networkRootId ?? null, this.server.networkRootVersion ?? null,
                this.server.networkRootRollbackVersion ?? null,
            )) {
                this.state = 'integrity_error';
                this._emit('integrity-error', { message: 'manifest signature or configured key pin failed' });
                return;
            }
            if (this.destroyed) return;
            let advertisedWebsocket = null;
            const endpointName = this.protocolVersion === 3 ? 'websocketV3' : 'websocketV2';
            try { advertisedWebsocket = new URL(manifest.payload?.endpoints?.[endpointName]).href; } catch (_) {}
            if (advertisedWebsocket !== this.endpoints.websocket) {
                this.state = 'integrity_error';
                this._emit('integrity-error', { message: 'manifest websocket endpoint does not match configured endpoint' });
                return;
            }
            if (!enforceMonotonicTrust(manifest)) {
                this.state = 'integrity_error';
                this._emit('integrity-error', { message: 'manifest trust version or issuance time moved backwards' });
                return;
            }
            this.manifest = manifest;
            this.manifestHash = await sha256Hex(ENCODER.encode(canonicalJson(manifest)));
            this.hpke = await generateHpkeKeyPair();
            if (this.destroyed) return;
            this.state = 'admitting';
            await this._refreshAdmission();
            if (this.destroyed) return;
            this._openWebSocket();
        } catch (error) {
            this.state = 'error';
            this._emit('error', { message: error?.message ?? `v${this.protocolVersion} connection failed` });
            this._scheduleReconnect();
        }
    }

    _openWebSocket() {
        // Particle namespaces contain '/', which isn't valid in an RFC 6455
        // subprotocol token. Namespace enforcement happens in every envelope.
        const ws = new this.WebSocketImpl(this.endpoints.websocket);
        const generation = ++this.connectionGeneration;
        this.ws = ws;
        this._armDeadline('connectTimer', CONNECT_TIMEOUT_MS, ws, 'WebSocket connect timeout');
        ws.onopen = () => {
            this._clearDeadline('connectTimer');
            this._armDeadline('proofTimer', PROOF_TIMEOUT_MS, ws, 'WebSocket proof timeout');
            this._send(this.sessionProtocol, 'HELLO', {
                grant: this.grant,
                identityKeyHex: this.deviceSigner.publicKeyHex,
                encryptionKeyHex: this.hpke.publicKeyHex,
            });
        };
        ws.onmessage = (event) => this._enqueueInbound(ws, generation, event.data);
        ws.onerror = () => this._emit('error', { message: `v${this.protocolVersion} WebSocket error` });
        ws.onclose = () => {
            if (this.ws !== ws) return;
            this._clearDeadline('connectTimer');
            this._clearDeadline('proofTimer');
            this._stopTimers();
            ++this.connectionGeneration;
            this.inboundQueue.length = 0;
            this.ws = null;
            this.sessionId = null;
            this.routePeers.clear();
            this.peerSessions.clear();
            if (!this.destroyed && this.state !== 'integrity_error') {
                this.state = 'closed';
                this._emit('closed');
                this._scheduleReconnect();
            }
        };
    }

    _enqueueInbound(ws, generation, raw) {
        if (this.ws !== ws || generation !== this.connectionGeneration) return;
        if (typeof raw !== 'string') {
            this._failServerProtocol(ws, 'binary server frame', 1003);
            return;
        }
        if (ENCODER.encode(raw).length > MAX_WS_MESSAGE_BYTES) {
            this._failServerProtocol(ws, 'server frame too large', 1009);
            return;
        }
        if (this.inboundQueue.length >= MAX_INBOUND_QUEUE_FRAMES) {
            this._failServerProtocol(ws, 'inbound queue overloaded', 1013);
            return;
        }
        this.inboundQueue.push({ ws, generation, raw });
        if (!this.processingInbound) void this._drainInbound();
    }

    async _drainInbound() {
        if (this.processingInbound) return;
        this.processingInbound = true;
        try {
            while (this.inboundQueue.length) {
                const item = this.inboundQueue.shift();
                if (this.ws !== item.ws || this.connectionGeneration !== item.generation) continue;
                try {
                    await this._handleMessage(item.raw, item.generation);
                } catch (_) {
                    this._failServerProtocol(item.ws, 'invalid server message');
                }
            }
        } finally {
            this.processingInbound = false;
            if (this.inboundQueue.length && !this.destroyed) void this._drainInbound();
        }
    }

    _failServerProtocol(ws, message, code = 1008) {
        if (this.ws !== ws) return;
        this.state = 'integrity_error';
        this.inboundQueue.length = 0;
        this._emit('integrity-error', { message });
        try { ws.close(code, message.slice(0, 123)); } catch (_) {}
    }

    _isCurrentGeneration(generation) {
        return !this.destroyed && generation === this.connectionGeneration && this.ws !== null;
    }

    async _handleMessage(raw, generation = this.connectionGeneration) {
        let message;
        try {
            message = JSON.parse(raw);
        } catch (_) {
            this._failServerProtocol(this.ws, 'malformed server JSON');
            return;
        }
        if (!message || typeof message !== 'object' || Array.isArray(message)) {
            this._failServerProtocol(this.ws, 'invalid server envelope');
            return;
        }
        if (message.type === 'CHALLENGE' && message.protocol === this.sessionProtocol) {
            if (message.payload?.manifestHash !== this.manifestHash || message.payload?.nodeId !== this.manifest?.payload?.nodeId) {
                this.state = 'integrity_error';
                this._emit('integrity-error', { message: 'session challenge manifest binding failed' });
                this.ws?.close(1008, 'integrity failure');
                return;
            }
            this.sessionId = message.payload.sessionId;
            this.state = 'proving';
            const signatureHex = await this.deviceSigner.signRaw(hexToBytes(message.payload.challengeHex, 32));
            if (!this._isCurrentGeneration(generation)) return;
            this._send(this.sessionProtocol, 'PROVE', { signatureHex });
        } else if (message.type === 'SESSION_READY' && message.protocol === this.sessionProtocol) {
            this._clearDeadline('proofTimer');
            this.state = 'connected';
            this._startTimers();
            this.stableConnectionTimer = setTimeout(() => {
                if (this._isCurrentGeneration(generation) && this.state === 'connected') resetBackoff(this.backoff);
            }, STABLE_CONNECTION_MS);
            for (const routeTag of this.routes.keys()) this._send(this.routeProtocol, 'ATTACH_ROUTE', { routeTag });
            this._emit('connected');
            if (this.protocolVersion === 2) void this.getTurnCredentials();
        } else if (message.type === 'PEERS' && message.protocol === this.routeProtocol) {
            await this._handlePeers(message.payload, generation);
        } else if (message.type === 'ATTACH_ROUTE' && message.protocol === this.routeProtocol) {
            this._emit('route-attached', { routeTag: message.payload?.routeTag, ok: message.payload?.ok === true });
        } else if (message.type === this.signalMessageType && message.protocol === this.signalProtocol) {
            await this._handleEncryptedSignal(message.payload, generation);
        } else if (message.type === this.signalAckType && message.protocol === this.signalProtocol) {
            this._emit('signal-ack', { ...message.payload });
        } else if (message.type === 'PONG') {
            this._emit('pong');
        } else if (message.type === 'ERROR') {
            this._emit('protocol-error', { code: message.code, message: message.message });
        }
    }

    async attachRoute(routeSecret, projectId = 'default') {
        const route = await deriveOpaqueRoute({ routeSecret, projectId });
        if (!this.routes.has(route.routeTag) && this.routes.size >= MAX_ROUTES) {
            this._emit('client-limit', { resource: 'routes', limit: MAX_ROUTES });
            throw new RangeError(`a daemon may attach at most ${MAX_ROUTES} routes`);
        }
        this.routes.set(route.routeTag, route);
        if (!this.routePeers.has(route.routeTag)) this.routePeers.set(route.routeTag, new Map());
        if (this.state === 'connected') this._send(this.routeProtocol, 'ATTACH_ROUTE', { routeTag: route.routeTag });
        return route;
    }

    renewRoute(routeTag) {
        if (this.routes.has(routeTag) && this.state === 'connected') {
            this._send(this.routeProtocol, 'ATTACH_ROUTE', { routeTag });
            return true;
        }
        return false;
    }

    detachRoute(routeTag) {
        if (!this.routes.has(routeTag)) return false;
        if (this.state === 'connected') this._send(this.routeProtocol, 'DETACH_ROUTE', { routeTag });
        this.routes.delete(routeTag);
        this.routePeers.delete(routeTag);
        for (const [peerId, mapping] of this.peerSessions) if (mapping.routeTag === routeTag) this.peerSessions.delete(peerId);
        return true;
    }

    discover(routeTag) {
        if (this.state !== 'connected' || !this.routes.has(routeTag)) return false;
        this._send(this.routeProtocol, 'DISCOVER', { routeTag });
        return true;
    }

    async signal(routeTag, message) {
        if (!this.routes.has(routeTag) || !message || typeof message !== 'object') return false;
        if (message.to) {
            const mapping = this.peerSessions.get(message.to);
            if (!mapping || mapping.routeTag !== routeTag) {
                this.discover(routeTag);
                return false;
            }
            if (!mapping.descriptor?.encryptionKeyHex || !mapping.descriptor?.keyId) {
                if (!this.pendingDirected.has(message.to) && this.pendingDirected.size >= MAX_PENDING_DIRECTED) {
                    this._emit('client-limit', { resource: 'pending-directed', limit: MAX_PENDING_DIRECTED });
                    return false;
                }
                this.pendingDirected.set(message.to, { routeTag, message });
                this.discover(routeTag);
                return true;
            }
            return this._sendEncrypted(routeTag, mapping.descriptor, message);
        }
        const peers = [...(this.routePeers.get(routeTag)?.values() ?? [])];
        if (!peers.length) {
            this.pendingBroadcasts.set(routeTag, message);
            this.discover(routeTag);
            return true;
        }
        const results = await Promise.all(peers.map((peer) => this._sendEncrypted(routeTag, peer, message)));
        return results.some(Boolean);
    }

    /** Address an authenticated rendezvous session, without trusting message.from. */
    async signalToSession(routeTag, sessionId, message) {
        if (!this.routes.has(routeTag) || !message || typeof message !== 'object') return false;
        const descriptor = this.routePeers.get(routeTag)?.get(sessionId);
        if (!descriptor?.encryptionKeyHex || !descriptor?.keyId) {
            this.discover(routeTag);
            return false;
        }
        return this._sendEncrypted(routeTag, descriptor, message);
    }

    async _handlePeers(payload, generation = this.connectionGeneration) {
        if (!this._isCurrentGeneration(generation)) return;
        const routeTag = payload?.routeTag;
        if (!this.routes.has(routeTag) || !Array.isArray(payload?.peers)) return;
        const admitted = new Map();
        for (const peer of payload.peers.slice(0, 64)) {
            if (!peer || typeof peer.sessionId !== 'string' || typeof peer.encryptionKeyHex !== 'string' || typeof peer.keyId !== 'string') continue;
            try {
                if (hexToBytes(peer.encryptionKeyHex, 65)[0] !== 4) continue;
            } catch (_) { continue; }
            admitted.set(peer.sessionId, Object.freeze({ ...peer }));
        }
        this.routePeers.set(routeTag, admitted);
        this._emit('peers', { routeTag, peers: [...admitted.values()] });
        const pending = this.pendingBroadcasts.get(routeTag);
        if (pending) {
            this.pendingBroadcasts.delete(routeTag);
            await Promise.all([...admitted.values()].map((peer) => this._sendEncrypted(routeTag, peer, pending)));
        }
        if (!this._isCurrentGeneration(generation)) return;
        for (const [peerId, queued] of [...this.pendingDirected]) {
            if (queued.routeTag !== routeTag) continue;
            const mapping = this.peerSessions.get(peerId);
            const descriptor = mapping && admitted.get(mapping.descriptor.sessionId);
            if (!descriptor) continue;
            this.peerSessions.set(peerId, { routeTag, descriptor });
            this.pendingDirected.delete(peerId);
            await this._sendEncrypted(routeTag, descriptor, queued.message);
        }
    }

    async _sendEncrypted(routeTag, descriptor, message) {
        if (this.state !== 'connected' || this.sequence >= 0xffffffff || !this._takeSignalToken()) return false;
        const generation = this.connectionGeneration;
        let plaintext;
        try { plaintext = ENCODER.encode(JSON.stringify(message)); } catch (_) { return false; }
        if (plaintext.length > 48 * 1024) return false;
        const messageId = randomId('signal');
        const sequence = this.sequence++;
        const authenticatedMetadata = {
            routeTag,
            fromSessionId: this.sessionId,
            toSessionId: descriptor.sessionId,
            messageId,
            sequence,
            expiresAt: Math.floor(Date.now() / 1000) + 60,
            keyId: descriptor.keyId,
            senderKeyId: await sha256Hex(hexToBytes(this.deviceSigner.publicKeyHex, 65)),
            senderIdentityKeyHex: this.deviceSigner.publicKeyHex,
        };
        if (!this._isCurrentGeneration(generation) || this.state !== 'connected') return false;
        const sealed = await hpkeSeal(descriptor.encryptionKeyHex, plaintext, {
            info: this.hpkeInfo,
            aad: ENCODER.encode(canonicalJson(authenticatedMetadata)),
        });
        const signedFields = {
            ...authenticatedMetadata,
            ...sealed,
        };
        const signatureHex = await this.deviceSigner.signRaw(ENCODER.encode(canonicalJson(signedFields)));
        if (!this._isCurrentGeneration(generation) || this.state !== 'connected') return false;
        return this._send(this.signalProtocol, this.signalMessageType, { ...signedFields, signatureHex }, messageId);
    }

    _takeSignalToken() {
        const now = globalThis.performance?.now?.() ?? Date.now();
        const elapsedSeconds = Math.max(0, now - this.signalLastRefill) / 1_000;
        this.signalTokens = Math.min(SIGNAL_BURST, this.signalTokens + elapsedSeconds * SIGNAL_RATE_PER_SECOND);
        this.signalLastRefill = now;
        if (this.signalTokens < 1) {
            this._emit('client-rate-limited', { operation: 'signal' });
            return false;
        }
        --this.signalTokens;
        return true;
    }

    async _handleEncryptedSignal(payload, generation = this.connectionGeneration) {
        if (!this._isCurrentGeneration(generation)) return;
        const now = Math.floor(Date.now() / 1000);
        if (
            !payload
            || !this.routes.has(payload.routeTag)
            || payload.toSessionId !== this.sessionId
            || typeof payload.fromSessionId !== 'string'
            || typeof payload.senderIdentityKeyHex !== 'string'
            || typeof payload.senderKeyId !== 'string'
            || !Number.isSafeInteger(payload.sequence)
            || payload.sequence < 0
            || payload.sequence > 0xffffffff
            || !Number.isSafeInteger(payload.expiresAt)
            || payload.expiresAt < now - 5
            || payload.expiresAt > now + 300
            || payload.keyId !== await sha256Hex(this.hpke.publicKeyRaw)
        ) return;
        if (!this._isCurrentGeneration(generation)) return;
        let senderIdentityRaw;
        try { senderIdentityRaw = hexToBytes(payload.senderIdentityKeyHex, 65); } catch (_) { return; }
        if (payload.senderKeyId !== await sha256Hex(senderIdentityRaw)) return;
        if (!this._isCurrentGeneration(generation)) return;
        const signedFields = { ...payload };
        delete signedFields.signatureHex;
        if (!await verifyRawSignature(
            payload.senderIdentityKeyHex,
            ENCODER.encode(canonicalJson(signedFields)),
            payload.signatureHex,
        )) return;
        if (!this._isCurrentGeneration(generation)) return;
        const replayKey = `${payload.fromSessionId}\0${payload.messageId}\0${payload.sequence}`;
        for (const [key, expiresAt] of this.receivedSignals) if (expiresAt < now) this.receivedSignals.delete(key);
        const lastSequence = this.receivedSequences.get(payload.fromSessionId);
        if (this.receivedSignals.has(replayKey) || (lastSequence !== undefined && payload.sequence <= lastSequence)) return;
        this.receivedSignals.set(replayKey, payload.expiresAt);
        if (this.receivedSignals.size > 4096) this.receivedSignals.delete(this.receivedSignals.keys().next().value);
        this.receivedSequences.delete(payload.fromSessionId);
        this.receivedSequences.set(payload.fromSessionId, payload.sequence);
        if (this.receivedSequences.size > 4096) this.receivedSequences.delete(this.receivedSequences.keys().next().value);
        try {
            const authenticatedMetadata = {
                routeTag: payload.routeTag,
                fromSessionId: payload.fromSessionId,
                toSessionId: payload.toSessionId,
                messageId: payload.messageId,
                sequence: payload.sequence,
                expiresAt: payload.expiresAt,
                keyId: payload.keyId,
                senderKeyId: payload.senderKeyId,
                senderIdentityKeyHex: payload.senderIdentityKeyHex,
            };
            const plaintext = await hpkeOpen(this.hpke.privateKey, payload.encHex, payload.ciphertextHex, {
                recipientPublicKey: this.hpke.publicKey,
                info: this.hpkeInfo,
                aad: ENCODER.encode(canonicalJson(authenticatedMetadata)),
            });
            if (!this._isCurrentGeneration(generation)) return;
            if (plaintext.length > 48 * 1024) return;
            const message = JSON.parse(DECODER.decode(plaintext));
            if (!message || typeof message !== 'object' || typeof message.from !== 'string') return;
            this.peerSessions.set(message.from, {
                routeTag: payload.routeTag,
                descriptor: this.routePeers.get(payload.routeTag)?.get(payload.fromSessionId) ?? {
                    sessionId: payload.fromSessionId,
                    encryptionKeyHex: null,
                    keyId: null,
                },
            });
            if (this.peerSessions.size > MAX_PEER_SESSIONS) {
                this.peerSessions.delete(this.peerSessions.keys().next().value);
            }
            this._emit('signal', {
                routeTag: payload.routeTag, fromSessionId: payload.fromSessionId,
                senderIdentityKeyHex: payload.senderIdentityKeyHex,
                senderKeyId: payload.senderKeyId, message,
            });
        } catch (_) {
            this._emit('decrypt-error');
        }
    }

    async getTurnCredentials({ force = false } = {}) {
        if (this.protocolVersion !== 2) return null;
        const now = Math.floor(Date.now() / 1000);
        if (!force && this.turnCredentials?.expiresAt > now + 60) return this.turnCredentials;
        if (this.turnRefreshPromise) return this.turnRefreshPromise;
        const refresh = this._performTurnRefresh();
        this.turnRefreshPromise = refresh;
        try {
            return await refresh;
        } finally {
            if (this.turnRefreshPromise === refresh) this.turnRefreshPromise = null;
        }
    }

    async _performTurnRefresh() {
        const now = Math.floor(Date.now() / 1000);
        try {
            if (!this.grant || this.grantExpiresAt <= now + 10) await this._refreshAdmission();
            const { response, value: result } = await this._fetchJson(this.endpoints.turn, {
                method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ grant: this.grant, publicKeyHex: this.deviceSigner.publicKeyHex }),
            }, HTTP_TIMEOUT_MS);
            if (this.destroyed) return null;
            if (!response.ok) return null;
            const report = particleIceConfigurationReport(result);
            if (!report.valid) return null;
            this.turnCredentials = report.value;
            if (report.relayAvailable) {
                this._scheduleTurnRefresh();
                this._emit('turn-credentials', report.value);
            } else {
                if (this.turnTimer) clearTimeout(this.turnTimer);
                this.turnTimer = null;
                this._emit('ice-configuration', report.value);
            }
            return report.value;
        } catch (_) { return null; }
    }

    async _refreshAdmission() {
        if (this.admissionRefreshPromise) return this.admissionRefreshPromise;
        const refresh = this._performAdmissionRefresh();
        this.admissionRefreshPromise = refresh;
        try {
            return await refresh;
        } finally {
            if (this.admissionRefreshPromise === refresh) this.admissionRefreshPromise = null;
        }
    }

    async _performAdmissionRefresh() {
        const nonce = randomId('admission');
        const capabilities = ['opaque-rendezvous'];
        if (this.manifest?.payload?.capabilities?.stateChannelsSse === true) capabilities.push('state-channel-sse');
        const body = this.protocolVersion === 3
            ? {
                publicKeyHex: this.deviceSigner.publicKeyHex,
                nonce,
                protocol: this.sessionProtocol,
                capabilities,
                manifestHash: this.manifestHash,
            }
            : { publicKeyHex: this.deviceSigner.publicKeyHex, nonce, protocol: this.sessionProtocol };
        const { response, value: admission } = await this._fetchJson(this.endpoints.admission, {
            method: 'POST',
            cache: 'no-store',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
        }, HTTP_TIMEOUT_MS);
        if (!response.ok) throw new Error(`admission HTTP ${response.status}`);
        if (
            admission.manifestHash !== this.manifestHash
            || admission.nodeId !== this.manifest?.payload?.nodeId
            || !Number.isSafeInteger(admission.expiresAt)
            || admission.expiresAt <= Math.floor(Date.now() / 1000)
        ) throw new Error('admission response is not bound to verified manifest');
        if (!await this._verifyAdmissionGrant(admission, nonce)) {
            throw new Error('admission grant signature, identity binding, or capabilities are invalid');
        }
        if (this.destroyed) throw new Error('daemon released during admission');
        this.grant = admission.grant;
        this.grantExpiresAt = admission.expiresAt;
        return admission;
    }

    async _verifyAdmissionGrant(admission, nonce) {
        const grant = admission?.grant;
        const claims = grant?.payload;
        const now = Math.floor(Date.now() / 1000);
        const expectedKeys = this.protocolVersion === 3
            ? ['capabilities', 'expiresAt', 'format', 'issuedAt', 'issuer', 'keyHash', 'nonceHash', 'protocol']
            : ['expiresAt', 'format', 'issuedAt', 'issuer', 'keyHash', 'nonceHash', 'protocol'];
        if (
            !grant || typeof grant !== 'object' || Array.isArray(grant)
            || Object.keys(grant).sort().join('\0') !== ['keyId', 'payload', 'signatureHex'].join('\0')
            || !claims || typeof claims !== 'object' || Array.isArray(claims)
            || Object.keys(claims).sort().join('\0') !== expectedKeys.join('\0')
            || grant.keyId !== this.manifest?.payload?.signingKeyId
            || claims.issuer !== this.manifest?.payload?.nodeId
            || claims.format !== `particle-admission/${this.protocolVersion}`
            || claims.protocol !== this.sessionProtocol
            || claims.expiresAt !== admission.expiresAt
            || !Number.isSafeInteger(claims.issuedAt)
            || !Number.isSafeInteger(claims.expiresAt)
            || claims.issuedAt > now
            || claims.expiresAt <= now
        ) return false;
        if (this.protocolVersion === 3 && (
            !Array.isArray(claims.capabilities)
            || !claims.capabilities.includes('opaque-rendezvous')
            || !Array.isArray(admission.capabilities)
            || admission.capabilities.join('\0') !== claims.capabilities.join('\0')
        )) return false;
        const identityKeyHash = await sha256Hex(hexToBytes(this.deviceSigner.publicKeyHex, 65));
        const nonceHash = await sha256Hex(nonce);
        if (claims.keyHash !== identityKeyHash || claims.nonceHash !== nonceHash) return false;
        return verifyRawSignature(
            this.manifest.payload.signingPublicKeyHex,
            ENCODER.encode(canonicalJson(claims)),
            grant.signatureHex,
        );
    }

    /** Issue a short-lived, route-bound SSE State Channel lease from verified V3 trust. */
    async getStateChannelLease({ routeTag, channelId, role = 'client' } = {}) {
        if (this.protocolVersion !== 3) throw new Error('State Channel SSE leases require Particle V3');
        if (!this.routes.has(routeTag)) throw new Error('State Channel SSE requires an attached V3 route');
        if (typeof channelId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(channelId)) {
            throw new TypeError('State Channel id is invalid');
        }
        if (!['authority', 'client'].includes(role)) throw new TypeError('State Channel lease role is invalid');
        const advertised = this.manifest?.payload?.endpoints;
        const advertisedLeaseUrl = advertised?.stateChannelLeaseV3;
        const advertisedBaseUrl = advertised?.stateChannelSseV1;
        if (this.manifest?.payload?.capabilities?.stateChannelsSse !== true
            || typeof advertisedLeaseUrl !== 'string' || typeof advertisedBaseUrl !== 'string') {
            throw new Error('The verified V3 server does not advertise State Channel SSE');
        }
        const now = Math.floor(Date.now() / 1000);
        if (!this.grant || this.grantExpiresAt <= now + 10
            || !this.grant?.payload?.capabilities?.includes('state-channel-sse')) {
            await this._refreshAdmission();
        }
        if (!this.grant?.payload?.capabilities?.includes('state-channel-sse')) {
            throw new Error('The verified V3 admission did not grant State Channel SSE');
        }
        const request = {
            format: STATE_CHANNEL_LEASE_FORMAT,
            publicKeyHex: this.deviceSigner.publicKeyHex,
            routeTag,
            channelId,
            role,
            nonce: randomId('state-channel-lease'),
            issuedAt: Math.floor(Date.now() / 1000),
        };
        const signatureHex = await this.deviceSigner.signRaw(ENCODER.encode(canonicalJson(request)));
        const { response, value } = await this._fetchJson(advertisedLeaseUrl, {
            method: 'POST',
            cache: 'no-store',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ grant: this.grant, request, signatureHex }),
        }, HTTP_TIMEOUT_MS);
        if (!response.ok) throw new Error(`State Channel lease HTTP ${response.status}`);
        let responseBaseUrl;
        let expectedBaseUrl;
        try {
            responseBaseUrl = new URL(value.baseUrl).href.replace(/\/$/, '');
            expectedBaseUrl = new URL(advertisedBaseUrl).href.replace(/\/$/, '');
        } catch (_) {
            throw new Error('State Channel lease response endpoint is invalid');
        }
        if (
            typeof value.token !== 'string'
            || ENCODER.encode(value.token).byteLength < 1
            || ENCODER.encode(value.token).byteLength > MAX_STATE_CHANNEL_TOKEN_BYTES
            || value.channelId !== channelId
            || value.role !== role
            || responseBaseUrl !== expectedBaseUrl
            || !Number.isSafeInteger(value.expiresAt)
            || value.expiresAt <= Math.floor(Date.now() / 1000)
        ) throw new Error('State Channel lease response is not bound to the verified request');
        this._emit('state-channel-lease', { routeTag, channelId, role, expiresAt: value.expiresAt });
        return Object.freeze({
            token: value.token,
            baseUrl: responseBaseUrl,
            channelId,
            role,
            expiresAt: value.expiresAt,
        });
    }

    _scheduleTurnRefresh() {
        if (this.turnTimer) clearTimeout(this.turnTimer);
        const delay = Math.max(1_000, (this.turnCredentials.expiresAt * 1000) - Date.now() - 60_000);
        this.turnTimer = setTimeout(() => {
            this.turnTimer = null;
            void this.getTurnCredentials({ force: true }).then((value) => {
                if (value) this._emit('ice-restart-needed', { reason: 'turn-credentials-refreshed' });
            });
        }, delay);
    }

    async _fetchJson(url, init, timeoutMs) {
        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        const timeout = setTimeout(() => controller?.abort(), timeoutMs);
        let rejectTimer = null;
        try {
            const response = await Promise.race([
                this.fetchImpl(url, { ...init, ...(controller ? { signal: controller.signal } : {}) }),
                new Promise((_, reject) => {
                    rejectTimer = setTimeout(
                        () => reject(new Error(`HTTP timeout for ${new URL(url).pathname}`)), timeoutMs,
                    );
                }),
            ]);
            const declared = Number(response.headers?.get?.('content-length'));
            if (Number.isFinite(declared) && declared > MAX_HTTP_RESPONSE_BYTES) throw new Error('HTTP JSON response too large');
            const text = await this._readBoundedResponseText(response);
            const value = JSON.parse(text);
            if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('HTTP response must be a JSON object');
            return { response, value };
        } finally {
            clearTimeout(timeout);
            if (rejectTimer) clearTimeout(rejectTimer);
        }
    }

    async _readBoundedResponseText(response) {
        const reader = response.body?.getReader?.();
        if (!reader) {
            const text = await response.text();
            if (ENCODER.encode(text).length > MAX_HTTP_RESPONSE_BYTES) throw new Error('HTTP JSON response too large');
            return text;
        }
        const chunks = [];
        let total = 0;
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                if (!(value instanceof Uint8Array)) throw new Error('HTTP response body is invalid');
                total += value.byteLength;
                if (total > MAX_HTTP_RESPONSE_BYTES) {
                    try { await reader.cancel('response too large'); } catch (_) {}
                    throw new Error('HTTP JSON response too large');
                }
                chunks.push(value);
            }
        } finally {
            try { reader.releaseLock?.(); } catch (_) {}
        }
        const bytes = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.byteLength;
        }
        return DECODER.decode(bytes);
    }

    _armDeadline(field, delayMs, ws, message) {
        this._clearDeadline(field);
        this[field] = setTimeout(() => {
            if (this.ws !== ws) return;
            this._emit('error', { message });
            try { ws.close(1013, message); } catch (_) {}
        }, delayMs);
    }

    _clearDeadline(field) {
        if (this[field]) clearTimeout(this[field]);
        this[field] = null;
    }

    _send(protocol, type, payload = undefined, id = randomId(type.toLowerCase())) {
        if (!this.ws || this.ws.readyState !== this.WebSocketImpl.OPEN) return false;
        const message = { protocol, type, id };
        if (payload !== undefined) message.payload = payload;
        let wire;
        try { wire = JSON.stringify(message); } catch (_) { return false; }
        const wireBytes = ENCODER.encode(wire).length;
        if (wireBytes > MAX_WS_MESSAGE_BYTES) return false;
        if ((this.ws.bufferedAmount ?? 0) + wireBytes > MAX_OUTBOUND_BUFFERED_BYTES) {
            const ws = this.ws;
            this._emit('backpressure', { bufferedBytes: ws.bufferedAmount ?? 0 });
            try { ws.close(1013, 'outbound queue overloaded'); } catch (_) {}
            return false;
        }
        try {
            this.ws.send(wire);
            return true;
        } catch (_) {
            return false;
        }
    }

    _startTimers() {
        this._stopTimers();
        this.heartbeatTimer = setInterval(() => this._send(this.sessionProtocol, 'PING'), HEARTBEAT_MS);
        this.routeRenewTimer = setInterval(() => {
            for (const routeTag of this.routes.keys()) this.renewRoute(routeTag);
        }, ROUTE_RENEW_MS);
    }

    _stopTimers() {
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        if (this.routeRenewTimer) clearInterval(this.routeRenewTimer);
        if (this.turnTimer) clearTimeout(this.turnTimer);
        if (this.stableConnectionTimer) clearTimeout(this.stableConnectionTimer);
        this._clearDeadline('connectTimer');
        this._clearDeadline('proofTimer');
        this.heartbeatTimer = null;
        this.routeRenewTimer = null;
        this.turnTimer = null;
        this.stableConnectionTimer = null;
    }

    _scheduleReconnect() {
        if (this.destroyed || this.reconnectTimer || this.state === 'integrity_error') return;
        const { delayMs } = nextBackoffDelay(this.backoff);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            void this.connect();
        }, delayMs);
    }

    getState() {
        return Object.freeze({ state: this.state, sessionId: this.sessionId, protocol: this.sessionProtocol, server: this.server });
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        ++this.connectionGeneration;
        this.inboundQueue.length = 0;
        this._stopTimers();
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
        try { this.ws?.close(1000, 'daemon released'); } catch (_) {}
        this.ws = null;
        this.state = 'closed';
        this.routes.clear();
        this.routePeers.clear();
        this.peerSessions.clear();
        this.pendingDirected.clear();
        this.pendingBroadcasts.clear();
        this.receivedSignals.clear();
        this.receivedSequences.clear();
        this.grant = null;
        this.grantExpiresAt = 0;
        this.turnCredentials = null;
        this.turnRefreshPromise = null;
        this.admissionRefreshPromise = null;
        this.hpke = null;
        this.manifest = null;
        this.manifestHash = null;
    }
}

function hexToBytes(value, expectedLength) {
    if (typeof value !== 'string' || value.length !== expectedLength * 2 || !/^[0-9a-f]+$/i.test(value)) {
        throw new TypeError(`expected ${expectedLength}-byte hex value`);
    }
    const output = new Uint8Array(expectedLength);
    for (let index = 0; index < output.length; index++) output[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
    return output;
}
