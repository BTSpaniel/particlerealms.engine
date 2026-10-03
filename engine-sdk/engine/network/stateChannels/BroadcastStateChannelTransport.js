// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { STATE_CHANNEL_MESSAGE, validateStateChannelMessage } from './StateChannelContract.js';

export class BroadcastStateChannelTransport {
    constructor({ channelId, authority = null, clientId, BroadcastChannelImpl = globalThis.BroadcastChannel } = {}) {
        if (!BroadcastChannelImpl) throw new Error('BroadcastChannel is unavailable');
        this.channelId = String(channelId);
        this.clientId = String(clientId ?? `broadcast-${Math.random().toString(36).slice(2)}`);
        this.authority = authority;
        this.listeners = new Set();
        this.channel = new BroadcastChannelImpl(`particle-state:${this.channelId}`);
        this.channel.addEventListener('message', (event) => this.#receive(event.data));
        this.releaseAuthority = authority?.subscribe((message) => {
            this.#emit(message);
            this.channel.postMessage({ sender: this.clientId, message });
        }, { replay: false });
    }

    subscribe(listener) {
        this.listeners.add(listener);
        if (this.authority) listener(this.authority.snapshot());
        return () => this.listeners.delete(listener);
    }

    async sendIntent(intent) {
        if (this.authority) return this.authority.submit(intent);
        this.channel.postMessage({ sender: this.clientId, message: intent });
        return { accepted: true };
    }

    requestSnapshot() {
        this.channel.postMessage({ sender: this.clientId, request: 'snapshot', channelId: this.channelId });
    }

    stop() {}

    destroy() {
        this.releaseAuthority?.();
        this.channel.close();
        this.listeners.clear();
    }

    async #receive(envelope) {
        if (!envelope || envelope.sender === this.clientId) return;
        if (envelope.request === 'snapshot' && this.authority) {
            this.channel.postMessage({ sender: this.clientId, message: this.authority.snapshot() });
            return;
        }
        const message = envelope.message;
        if (!validateStateChannelMessage(message, this.channelId)) return;
        if (message.kind === STATE_CHANNEL_MESSAGE.INTENT && this.authority) await this.authority.submit(message);
        else this.#emit(message);
    }

    #emit(message) {
        for (const listener of [...this.listeners]) {
            try { listener(message); } catch (_) { /* observer isolation */ }
        }
    }
}
