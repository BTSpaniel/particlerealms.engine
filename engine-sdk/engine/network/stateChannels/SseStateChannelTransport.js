// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { STATE_CHANNEL_MESSAGE, validateStateChannelMessage } from './StateChannelContract.js';

const DEFAULT_BASE_URL = '/_api/state-channels/v1';
const LEASE_REFRESH_MARGIN_MS = 5_000;
const LEASE_RECONNECT_MS = 1_500;

/** Default standard transport: SSE projections/receipts down, HTTP intents up. */
export class SseStateChannelTransport {
    constructor({
        channelId,
        authority = null,
        clientId,
        baseUrl = DEFAULT_BASE_URL,
        EventSourceImpl = globalThis.EventSource,
        fetchImpl = globalThis.fetch,
        leaseProvider = null,
        logger = console,
    } = {}) {
        if (!EventSourceImpl || !fetchImpl) throw new Error('SSE transport requires EventSource and fetch');
        this.channelId = String(channelId);
        this.authority = authority;
        this.clientId = String(clientId ?? `sse-${Math.random().toString(36).slice(2)}`);
        this.baseUrl = String(baseUrl).replace(/\/$/, '');
        this.EventSourceImpl = EventSourceImpl;
        this.fetchImpl = (...args) => fetchImpl.call(globalThis, ...args);
        this.leaseProvider = typeof leaseProvider === 'function' ? leaseProvider : null;
        this.logger = logger;
        this.listeners = new Set();
        this.source = null;
        this.lastEventId = 0;
        this.releaseAuthority = null;
        this.status = 'idle';
        this.lease = null;
        this.leaseRefreshTimer = null;
        this.reconnectTimer = null;
        this.startPromise = null;
        this.stopped = true;
    }

    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    async start() {
        if (this.source) return;
        if (this.startPromise) return this.startPromise;
        this.stopped = false;
        this.startPromise = this.#performStart();
        try { await this.startPromise; }
        finally { this.startPromise = null; }
    }

    stop() {
        this.stopped = true;
        if (this.leaseRefreshTimer) clearTimeout(this.leaseRefreshTimer);
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.leaseRefreshTimer = null;
        this.reconnectTimer = null;
        this.source?.close();
        this.source = null;
        this.releaseAuthority?.();
        this.releaseAuthority = null;
        this.lease = null;
        this.status = 'idle';
        this.logger.debug?.(`[SseStateChannelTransport][stop][exit] channel=${this.channelId} client=${this.clientId}`);
    }

    async sendIntent(intent) {
        if (this.authority) return this.authority.submit(intent);
        return this.#post('intents', intent);
    }

    async publish(message) {
        if (!this.authority) throw new Error('Only an authority SSE transport may publish projections or receipts');
        if (![STATE_CHANNEL_MESSAGE.PROJECTION, STATE_CHANNEL_MESSAGE.RECEIPT].includes(message.kind)) {
            throw new TypeError(`SSE authority cannot publish ${message.kind}`);
        }
        return this.#post('messages', message);
    }

    async requestSnapshot() {
        if (this.authority) {
            const snapshot = this.authority.snapshot();
            for (const listener of [...this.listeners]) listener(snapshot);
            return snapshot;
        }
        await this.#ensureLease();
        const response = await this.#fetchWithLease(`${this.#channelUrl()}/snapshot`, {
            headers: { Accept: 'application/json' },
        });
        if (response.status === 404 || response.status === 204) return null;
        if (!response.ok) throw new Error(`State channel snapshot failed: HTTP ${response.status}`);
        const payload = await response.json();
        if (payload?.message) this.#emit(payload.message);
        return payload?.message ?? null;
    }

    async #post(resource, message) {
        await this.#ensureLease();
        const advertisedVersions = this.lease?.messageVersions;
        if (Array.isArray(advertisedVersions) && !advertisedVersions.includes(message?.version)) {
            throw new Error(`State channel server does not accept message version ${message?.version}`);
        }
        const startedAt = globalThis.performance?.now?.() ?? Date.now();
        const response = await this.#fetchWithLease(`${this.#channelUrl()}/${resource}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                'X-Particle-State-Client': this.clientId,
            },
            body: JSON.stringify(message),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error ?? `State channel POST failed: HTTP ${response.status}`);
        const durationMs = (globalThis.performance?.now?.() ?? Date.now()) - startedAt;
        this.logger.debug?.(`[SseStateChannelTransport][post][exit] channel=${this.channelId} resource=${resource} status=${response.status} durationMs=${durationMs.toFixed(3)}`);
        return payload;
    }

    async #performStart() {
        this.logger.debug?.(`[SseStateChannelTransport][start][entry] channel=${this.channelId} client=${this.clientId}`);
        await this.#ensureLease();
        if (this.stopped) return;
        this.#openEventSource();
        if (this.authority && !this.releaseAuthority) {
            this.releaseAuthority = this.authority.subscribe((message) => {
                this.#emit(message);
                this.publish(message).catch((error) => this.logger.error?.('[SseStateChannelTransport][publish]', error));
            }, { replay: false });
            await this.publish(this.authority.snapshot());
        }
        this.logger.debug?.(`[SseStateChannelTransport][start][exit] channel=${this.channelId} role=${this.authority ? 'authority' : 'client'}`);
    }

    #openEventSource() {
        this.source?.close();
        const params = new URLSearchParams({
            clientId: this.clientId,
            after: String(this.lastEventId),
        });
        if (this.lease?.token) params.set('token', this.lease.token);
        const source = new this.EventSourceImpl(`${this.#channelUrl()}/events?${params}`);
        this.source = source;
        source.onopen = () => { if (this.source === source) this.status = 'connected'; };
        source.onerror = () => {
            if (this.source !== source || this.stopped) return;
            this.status = 'reconnecting';
            if (this.leaseProvider) this.#scheduleReconnect();
        };
        source.onmessage = (event) => this.#receiveEvent(event);
        for (const kind of Object.values(STATE_CHANNEL_MESSAGE)) {
            source.addEventListener?.(kind, (event) => this.#receiveEvent(event));
        }
    }

    #scheduleReconnect(delayMs = LEASE_RECONNECT_MS) {
        if (this.reconnectTimer || this.stopped) return;
        this.source?.close();
        this.source = null;
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            void this.#ensureLease(true).then(() => {
                if (!this.stopped) this.#openEventSource();
            }).catch((error) => {
                this.logger.error?.('[SseStateChannelTransport][lease-refresh]', error);
                this.#scheduleReconnect(Math.min(30_000, Math.max(LEASE_RECONNECT_MS, delayMs * 2)));
            });
        }, delayMs);
    }

    async #ensureLease(force = false) {
        if (!this.leaseProvider) return null;
        const now = Math.floor(Date.now() / 1000);
        if (!force && this.lease?.expiresAt > now + 5) return this.lease;
        const role = this.authority ? 'authority' : 'client';
        const lease = await this.leaseProvider({ channelId: this.channelId, clientId: this.clientId, role });
        let leaseBaseUrl;
        try { leaseBaseUrl = new URL(lease?.baseUrl, globalThis.location?.href).href.replace(/\/$/, ''); }
        catch (_) { throw new Error('State Channel lease base URL is invalid'); }
        if (
            typeof lease?.token !== 'string' || !lease.token
            || lease.channelId !== this.channelId
            || lease.role !== role
            || !Number.isSafeInteger(lease.expiresAt) || lease.expiresAt <= now
        ) throw new Error('State Channel lease is not bound to this transport');
        this.baseUrl = leaseBaseUrl;
        this.lease = Object.freeze({ ...lease, baseUrl: leaseBaseUrl });
        if (this.leaseRefreshTimer) clearTimeout(this.leaseRefreshTimer);
        const refreshDelay = Math.max(1_000, (lease.expiresAt * 1000) - Date.now() - LEASE_REFRESH_MARGIN_MS);
        this.leaseRefreshTimer = setTimeout(() => {
            this.leaseRefreshTimer = null;
            this.#scheduleReconnect(0);
        }, refreshDelay);
        return this.lease;
    }

    async #fetchWithLease(url, init, retry = true) {
        const headers = { ...init.headers };
        if (this.lease?.token) headers.Authorization = `Bearer ${this.lease.token}`;
        const response = await this.fetchImpl(url, { ...init, headers });
        if (retry && this.leaseProvider && [401, 403].includes(response.status)) {
            await this.#ensureLease(true);
            return this.#fetchWithLease(url.replace(/^.*?(\/_api\/state-channels\/v1)/, `${this.baseUrl}`), init, false);
        }
        return response;
    }

    async #receiveEvent(event) {
        if (event.lastEventId) this.lastEventId = Math.max(this.lastEventId, Number(event.lastEventId) || 0);
        let message;
        try { message = JSON.parse(event.data); }
        catch { return; }
        if (!validateStateChannelMessage(message, this.channelId)) return;
        if (message.kind === STATE_CHANNEL_MESSAGE.INTENT && this.authority) {
            try { await this.authority.submit(message); }
            catch (error) { this.logger.error?.('[SseStateChannelTransport][authority]', error); }
            return;
        }
        if (message.kind !== STATE_CHANNEL_MESSAGE.INTENT) this.#emit(message);
    }

    #emit(message) {
        for (const listener of [...this.listeners]) listener(message);
    }

    #channelUrl() {
        return `${this.baseUrl}/${encodeURIComponent(this.channelId)}`;
    }
}

export function createDefaultStateChannelTransport(options) {
    return new SseStateChannelTransport(options);
}
