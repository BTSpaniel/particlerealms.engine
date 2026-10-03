// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { STATE_CHANNEL_MESSAGE, validateStateChannelMessage } from './StateChannelContract.js';
import { PROTOCOL_VERSIONS } from '../protocol.js';

export const MESH_STATE_CHANNEL_ENVELOPE_TYPE = 'particle-state-channel-mesh-v1';

/** State Channel transport over browser-to-browser WebRTC mesh messages. */
export class MeshStateChannelTransport {
    constructor({
        networkDriver,
        routeId,
        channelId,
        authority = null,
        clientId,
        authorityPeerId = null,
        routeLeaseFactory = null,
        lifecycleDocument = globalThis.document,
        lifecycleWindow = globalThis.window,
    } = {}) {
        if (!networkDriver?.sendMeshMessage || !networkDriver?.onMeshMessage) {
            throw new TypeError('Mesh state channel transport requires NetworkDriver mesh APIs');
        }
        if (!routeId || !channelId) throw new TypeError('Mesh state channel transport requires routeId and channelId');
        this.driver = networkDriver;
        this.routeId = String(routeId);
        this.channelId = String(channelId);
        this.authority = authority;
        this.clientId = String(clientId ?? `mesh-${Math.random().toString(36).slice(2)}`);
        this.authorityPeerId = authorityPeerId == null ? null : String(authorityPeerId);
        this.routeLeaseFactory = typeof routeLeaseFactory === 'function' ? routeLeaseFactory : null;
        this.routeLease = null;
        this.lifecycleDocument = lifecycleDocument ?? null;
        this.lifecycleWindow = lifecycleWindow ?? null;
        this.listeners = new Set();
        this.clientPeers = new Map();
        this.started = false;
        this.destroyed = false;
        this.suspended = false;
        this._onVisibilityChange = () => {
            if (this.lifecycleDocument?.visibilityState === 'hidden') this.#suspendForLifecycle('hidden');
            else this.#resumeFromLifecycle('visible');
        };
        this._onFreeze = () => this.#suspendForLifecycle('frozen');
        this._onResume = () => this.#resumeFromLifecycle('resumed');
        this._onPageHide = () => this.#suspendForLifecycle('pagehide');
        this._onPageShow = () => this.#resumeFromLifecycle('pageshow');
        this.releaseMesh = null;
        this.releaseAuthority = null;
        this.authorityCoordinator = null;
        this.setAuthority(authority);
    }

    subscribe(listener) {
        this.listeners.add(listener);
        if (this.authority) listener(this.authority.snapshot());
        return () => this.listeners.delete(listener);
    }

    setAuthorityPeerId(peerId) {
        this.authorityPeerId = peerId == null ? null : String(peerId);
    }

    setAuthority(authority) {
        this.releaseAuthority?.();
        this.releaseAuthority = null;
        this.authority = authority ?? null;
        if (this.authority) {
            this.releaseAuthority = this.authority.subscribe(
                message => this.#publishAuthorityMessage(message),
                { replay: false },
            );
            this.authorityPeerId = null;
        }
    }

    attachAuthorityCoordinator(coordinator) {
        if (!coordinator?.start || !coordinator?.stop) throw new TypeError('Invalid State Channel authority coordinator');
        if (this.started) throw new Error('Attach authority coordinator before starting mesh transport');
        this.authorityCoordinator = coordinator;
        return this;
    }

    async sendIntent(intent) {
        if (this.authority) return this.authority.submit(intent);
        if (!this.authorityPeerId) throw new Error('Mesh state channel has no elected authority peer');
        if (!this.#send(this.authorityPeerId, { message: intent })) throw new Error('Mesh authority peer is not connected');
        return { accepted: true };
    }

    requestSnapshot() {
        if (this.authority) {
            const snapshot = this.authority.snapshot();
            this.#emit(snapshot);
            return snapshot;
        }
        if (!this.authorityPeerId) return null;
        this.#send(this.authorityPeerId, { request: 'snapshot' });
        return null;
    }

    async start() {
        if (this.destroyed) throw new Error('Mesh state channel transport is destroyed');
        if (!this.started) {
            this.started = true;
            this.#bindLifecycle();
        }
        if (this.lifecycleDocument?.visibilityState !== 'hidden') this.#ensureRouteLease();
        if (this.authorityCoordinator && !this.authorityCoordinator.running) {
            await this.authorityCoordinator.start({ startTransport: false });
        }
        return this;
    }

    stop() {
        if (!this.started && !this.routeLease) return false;
        this.started = false;
        this.suspended = false;
        this.authorityCoordinator?.stop();
        this.#unbindLifecycle();
        this.#releaseRouteLease(false);
        return true;
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.stop();
        this.releaseMesh?.();
        this.releaseAuthority?.();
        this.authorityCoordinator?.destroy();
        this.authorityCoordinator = null;
        this.listeners.clear();
        this.clientPeers.clear();
    }

    #bindLifecycle() {
        this.lifecycleDocument?.addEventListener?.('visibilitychange', this._onVisibilityChange);
        this.lifecycleDocument?.addEventListener?.('freeze', this._onFreeze);
        this.lifecycleDocument?.addEventListener?.('resume', this._onResume);
        this.lifecycleWindow?.addEventListener?.('pagehide', this._onPageHide);
        this.lifecycleWindow?.addEventListener?.('pageshow', this._onPageShow);
    }

    #unbindLifecycle() {
        this.lifecycleDocument?.removeEventListener?.('visibilitychange', this._onVisibilityChange);
        this.lifecycleDocument?.removeEventListener?.('freeze', this._onFreeze);
        this.lifecycleDocument?.removeEventListener?.('resume', this._onResume);
        this.lifecycleWindow?.removeEventListener?.('pagehide', this._onPageHide);
        this.lifecycleWindow?.removeEventListener?.('pageshow', this._onPageShow);
    }

    #ensureRouteLease() {
        if (!this.started || this.destroyed) return false;
        let changed = false;
        if (!this.routeLease && this.routeLeaseFactory) {
            this.routeLease = this.routeLeaseFactory();
            changed = true;
        }
        if (!this.releaseMesh) {
            this.releaseMesh = this.driver.onMeshMessage(
                this.routeId,
                (peerId, message) => this.#receive(peerId, message),
            );
            changed = true;
        }
        this.suspended = false;
        return changed;
    }

    #releaseRouteLease(immediate) {
        this.releaseMesh?.();
        this.releaseMesh = null;
        const lease = this.routeLease;
        this.routeLease = null;
        return lease?.release?.({ immediate }) ?? false;
    }

    #suspendForLifecycle(reason) {
        if (!this.started || this.suspended) return;
        this.suspended = true;
        this.authorityCoordinator?.suspendRoute(reason);
        this.#releaseRouteLease(true);
        console.debug?.(`[MeshStateChannelTransport][lifecycle][suspend] channel=${this.channelId} reason=${reason}`);
    }

    #resumeFromLifecycle(reason) {
        if (!this.started || this.destroyed) return;
        const resumed = this.#ensureRouteLease();
        if (resumed) this.authorityCoordinator?.resumeRoute(reason);
        if (resumed) console.debug?.(`[MeshStateChannelTransport][lifecycle][resume] channel=${this.channelId} reason=${reason}`);
    }

    #send(peerId, payload) {
        return this.driver.sendMeshMessage(this.routeId, peerId, {
            protocol: PROTOCOL_VERSIONS.STATE_CHANNEL,
            type: MESH_STATE_CHANNEL_ENVELOPE_TYPE,
            channelId: this.channelId,
            sender: this.clientId,
            ...payload,
        });
    }

    #publishAuthorityMessage(message) {
        if (message.kind === STATE_CHANNEL_MESSAGE.RECEIPT) {
            const peerId = this.clientPeers.get(message.clientId);
            if (peerId) this.#send(peerId, { message });
            this.#emit(message);
            return;
        }
        if (message.kind === STATE_CHANNEL_MESSAGE.PROJECTION) {
            this.driver.broadcastMeshMessage(this.routeId, {
                protocol: PROTOCOL_VERSIONS.STATE_CHANNEL,
                type: MESH_STATE_CHANNEL_ENVELOPE_TYPE,
                channelId: this.channelId,
                sender: this.clientId,
                message,
            });
            this.#emit(message);
        }
    }

    async #receive(peerId, envelope) {
        if (envelope?.type !== MESH_STATE_CHANNEL_ENVELOPE_TYPE || envelope.channelId !== this.channelId) return false;
        if (envelope.request === 'snapshot' && this.authority) {
            this.#send(peerId, { message: this.authority.snapshot() });
            return true;
        }
        const message = envelope.message;
        if (!validateStateChannelMessage(message, this.channelId)) return true;
        if (message.kind === STATE_CHANNEL_MESSAGE.INTENT && this.authority) {
            this.clientPeers.set(String(message.clientId), peerId);
            await this.authority.submit(message, { fencingToken: this.authority.fencingToken });
            return true;
        }
        if (message.kind !== STATE_CHANNEL_MESSAGE.INTENT) this.#emit(message);
        return true;
    }

    #emit(message) {
        for (const listener of [...this.listeners]) {
            try { listener(message); } catch (_) { /* observer isolation */ }
        }
    }
}
