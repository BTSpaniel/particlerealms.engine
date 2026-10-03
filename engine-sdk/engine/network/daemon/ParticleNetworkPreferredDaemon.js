// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { deriveOpaqueRoute } from '../crypto/OpaqueRoute.js';
import { verifySignedManifest } from '../crypto/Trust.js';
import { createReconnectBackoff, nextBackoffDelay, resetBackoff } from '../routes/ReconnectBackoff.js';
import { ParticleNetworkDaemon } from './ParticleNetworkDaemon.js';

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder('utf-8', { fatal: true });
const HTTP_TIMEOUT_MS = 10_000;
const MAX_HTTP_RESPONSE_BYTES = 65_536;
const MAX_ROUTES = 32;

function v2ManifestUrl(serverUrl) {
    const configured = new URL(serverUrl, globalThis.location?.href);
    const secure = configured.protocol === 'wss:' || configured.protocol === 'https:';
    configured.protocol = secure ? 'https:' : 'http:';
    configured.pathname = '/v2/manifest';
    configured.search = '';
    configured.hash = '';
    return configured.href;
}

function advertisesV3(manifest) {
    const protocols = Array.isArray(manifest?.payload?.protocols) ? manifest.payload.protocols : [];
    const endpoints = manifest?.payload?.endpoints;
    return (
        protocols.includes('particle-session/3')
        || protocols.includes('particle-rendezvous/3')
        || (endpoints && typeof endpoints === 'object' && (
            typeof endpoints.manifestV3 === 'string'
            || typeof endpoints.websocketV3 === 'string'
            || typeof endpoints.admissionV3 === 'string'
        ))
    );
}

function v3EndpointSet(serverUrl) {
    const configured = new URL(serverUrl, globalThis.location?.href);
    const secure = configured.protocol === 'wss:' || configured.protocol === 'https:';
    const http = new URL(configured.href);
    http.protocol = secure ? 'https:' : 'http:';
    http.pathname = '';
    http.search = '';
    http.hash = '';
    const websocket = new URL(configured.href);
    websocket.protocol = secure ? 'wss:' : 'ws:';
    websocket.pathname = '/v3/ws';
    websocket.search = '';
    websocket.hash = '';
    return {
        manifestV3: new URL('/v3/manifest', http).href,
        admissionV3: new URL('/v3/admission', http).href,
        websocketV3: websocket.href,
    };
}

function hasValidV3Advertisement(manifest, serverUrl) {
    const protocols = manifest?.payload?.protocols;
    const endpoints = manifest?.payload?.endpoints;
    if (!Array.isArray(protocols) || !protocols.includes('particle-session/3')
        || !protocols.includes('particle-rendezvous/3') || !endpoints || typeof endpoints !== 'object') return false;
    const expected = v3EndpointSet(serverUrl);
    try {
        return (
            new URL(endpoints.manifestV3).href === expected.manifestV3
            && new URL(endpoints.admissionV3).href === expected.admissionV3
            && new URL(endpoints.websocketV3).href === expected.websocketV3
        );
    } catch (_) {
        return false;
    }
}

function integrityError(message) {
    const error = new Error(message);
    error.name = 'IntegrityError';
    return error;
}

async function readBoundedResponseText(response) {
    const declared = Number(response.headers?.get?.('content-length'));
    if (Number.isFinite(declared) && declared > MAX_HTTP_RESPONSE_BYTES) {
        throw new Error('HTTP JSON response too large');
    }
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

/**
 * Selects V3 only from a valid, pinned V2 advertisement. A valid advertisement
 * with no V3 marker selects V2. Any V3 marker commits the connection attempt to
 * V3; V3 integrity failures are forwarded and never retried as V2.
 */
export class ParticleNetworkPreferredDaemon {
    constructor({
        server,
        deviceSigner,
        onEvent = null,
        fetchImpl = globalThis.fetch,
        WebSocketImpl = globalThis.WebSocket,
        DaemonImpl = ParticleNetworkDaemon,
    } = {}) {
        const configuredPins = server?.serverKeyPins?.length ? server.serverKeyPins : server?.serverKeyPin;
        if (!server?.url || !configuredPins) throw new TypeError('preferred daemon requires a pinned server');
        if (!deviceSigner?.publicKeyHex || typeof deviceSigner.signRaw !== 'function') {
            throw new TypeError('preferred daemon requires a device signer');
        }
        if (typeof fetchImpl !== 'function') throw new TypeError('preferred daemon requires fetch');
        this.server = Object.freeze({ ...server });
        this.serverPins = Array.isArray(configuredPins) ? Object.freeze([...configuredPins]) : configuredPins;
        this.deviceSigner = deviceSigner;
        this.onEvent = onEvent;
        this.fetchImpl = fetchImpl.bind(globalThis);
        this.WebSocketImpl = WebSocketImpl;
        this.DaemonImpl = DaemonImpl;
        this.state = 'idle';
        this.protocolVersion = null;
        this.delegate = null;
        this.destroyed = false;
        this.connectGeneration = 0;
        this.reconnectTimer = null;
        this.backoff = createReconnectBackoff({ maxAttempts: 0 });
        this.pendingRoutes = new Map();
    }

    _emit(type, extra = {}) {
        try {
            this.onEvent?.({
                type,
                state: this.state,
                protocol: this.protocolVersion ? `particle-session/${this.protocolVersion}` : null,
                server: this.server,
                ...extra,
            });
        } catch (_) {}
    }

    async connect() {
        if (this.destroyed || this.delegate || this.state === 'selecting') return;
        const generation = ++this.connectGeneration;
        this.state = 'selecting';
        this._emit('protocol-selecting');
        try {
            const manifest = await this._loadVerifiedAdvertisement();
            if (this.destroyed || generation !== this.connectGeneration) return;
            const v3Advertised = advertisesV3(manifest);
            if (v3Advertised && !hasValidV3Advertisement(manifest, this.server.url)) {
                throw integrityError('signed V3 advertisement is incomplete or conflicts with the configured endpoint');
            }
            this.protocolVersion = v3Advertised ? 3 : 2;
            resetBackoff(this.backoff);
            this._emit('protocol-selected', {
                selectedProtocol: `particle-session/${this.protocolVersion}`,
                v3Advertised: this.protocolVersion === 3,
            });
            let delegate = null;
            delegate = new this.DaemonImpl({
                server: this.server,
                deviceSigner: this.deviceSigner,
                fetchImpl: this.fetchImpl,
                WebSocketImpl: this.WebSocketImpl,
                protocolVersion: this.protocolVersion,
                onEvent: (event) => {
                    this.state = event?.state ?? delegate.getState().state;
                    try { this.onEvent?.({ ...event, selectedProtocolVersion: this.protocolVersion }); } catch (_) {}
                },
            });
            this.delegate = delegate;
            for (const pending of this.pendingRoutes.values()) {
                await delegate.attachRoute(pending.routeSecret, pending.projectId);
                if (this.destroyed || generation !== this.connectGeneration) {
                    delegate.destroy();
                    return;
                }
            }
            void delegate.connect();
        } catch (error) {
            if (this.destroyed || generation !== this.connectGeneration) return;
            if (error?.name === 'IntegrityError') {
                this.state = 'integrity_error';
                this._emit('integrity-error', { message: error.message });
                return;
            }
            this.state = 'error';
            this._emit('error', { message: error?.message ?? 'protocol selection failed' });
            this._scheduleReconnect();
        }
    }

    async _loadVerifiedAdvertisement() {
        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        const timeout = setTimeout(() => controller?.abort(), HTTP_TIMEOUT_MS);
        let rejectTimer = null;
        try {
            const response = await Promise.race([
                this.fetchImpl(v2ManifestUrl(this.server.url), {
                    cache: 'no-store',
                    ...(controller ? { signal: controller.signal } : {}),
                }),
                new Promise((_, reject) => {
                    rejectTimer = setTimeout(() => reject(new Error('V2 advertisement request timed out')), HTTP_TIMEOUT_MS);
                }),
            ]);
            if (!response.ok) throw new Error(`V2 advertisement HTTP ${response.status}`);
            let manifest;
            try { manifest = JSON.parse(await readBoundedResponseText(response)); } catch (error) {
                if (error instanceof SyntaxError) throw new Error('V2 advertisement is not valid JSON');
                throw error;
            }
            if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
                throw new Error('V2 advertisement must be a JSON object');
            }
            if (!await verifySignedManifest(
                manifest,
                this.serverPins,
                Math.floor(Date.now() / 1000),
                this.server.networkRootId ?? null,
                this.server.networkRootVersion ?? null,
                this.server.networkRootRollbackVersion ?? null,
            )) {
                throw integrityError('V2 advertisement signature or configured key pin failed');
            }
            return manifest;
        } finally {
            clearTimeout(timeout);
            if (rejectTimer) clearTimeout(rejectTimer);
        }
    }

    async attachRoute(routeSecret, projectId = 'default') {
        const route = await deriveOpaqueRoute({ routeSecret, projectId });
        if (!this.pendingRoutes.has(route.routeTag) && this.pendingRoutes.size >= MAX_ROUTES) {
            this._emit('client-limit', { resource: 'routes', limit: MAX_ROUTES });
            throw new RangeError(`a daemon may attach at most ${MAX_ROUTES} routes`);
        }
        this.pendingRoutes.set(route.routeTag, { route, routeSecret, projectId });
        if (this.delegate) return this.delegate.attachRoute(routeSecret, projectId);
        return route;
    }

    renewRoute(routeTag) {
        if (!this.pendingRoutes.has(routeTag)) return false;
        return this.delegate?.renewRoute(routeTag) ?? false;
    }

    detachRoute(routeTag) {
        if (!this.pendingRoutes.delete(routeTag)) return false;
        this.delegate?.detachRoute(routeTag);
        return true;
    }

    discover(routeTag) {
        return this.delegate?.discover(routeTag) ?? false;
    }

    signal(routeTag, message) {
        return this.delegate?.signal(routeTag, message) ?? Promise.resolve(false);
    }

    getTurnCredentials(options) {
        return this.delegate?.getTurnCredentials(options) ?? Promise.resolve(null);
    }

    getStateChannelLease(options) {
        if (!this.delegate) return Promise.reject(new Error('Particle network protocol selection is not connected'));
        return this.delegate.getStateChannelLease(options);
    }

    getState() {
        if (this.delegate) {
            return Object.freeze({
                ...this.delegate.getState(),
                selectedProtocolVersion: this.protocolVersion,
                v3Advertised: this.protocolVersion === 3,
            });
        }
        return Object.freeze({
            state: this.state,
            sessionId: null,
            protocol: this.protocolVersion ? `particle-session/${this.protocolVersion}` : null,
            selectedProtocolVersion: this.protocolVersion,
            v3Advertised: this.protocolVersion === 3,
            server: this.server,
        });
    }

    _scheduleReconnect() {
        if (this.destroyed || this.reconnectTimer || this.state === 'integrity_error') return;
        const { delayMs } = nextBackoffDelay(this.backoff);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            void this.connect();
        }, delayMs);
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        ++this.connectGeneration;
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
        this.delegate?.destroy();
        this.delegate = null;
        this.pendingRoutes.clear();
        this.state = 'closed';
    }
}

export { advertisesV3, hasValidV3Advertisement };
