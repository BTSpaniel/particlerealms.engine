// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { STATE_CHANNEL_MESSAGE, validateStateChannelMessage } from './StateChannelContract.js';

export class ParticleSignalStateChannelTransport {
    constructor({ networkDriver, url, routeId, channelId, authority = null, clientId } = {}) {
        if (!networkDriver?.signal || !networkDriver?.onEvent) throw new TypeError('Particle signal transport requires NetworkDriver');
        this.driver = networkDriver;
        this.url = url;
        this.routeId = routeId;
        this.channelId = channelId;
        this.authority = authority;
        this.clientId = String(clientId ?? `particle-${Math.random().toString(36).slice(2)}`);
        this.listeners = new Set();
        this.releaseEvent = this.driver.onEvent(url, (event) => this.#receive(event));
        this.releaseAuthority = authority?.subscribe((message) => this.#send(message), { replay: false });
    }

    subscribe(listener) {
        this.listeners.add(listener);
        if (this.authority) listener(this.authority.snapshot());
        return () => this.listeners.delete(listener);
    }

    async sendIntent(intent) {
        if (this.authority) return this.authority.submit(intent);
        this.#send(intent);
        return { accepted: true };
    }

    requestSnapshot() {
        this.driver.signal(this.url, this.routeId, {
            type: 'particle-state-channel', channelId: this.channelId, sender: this.clientId, request: 'snapshot',
        });
    }

    stop() {}

    destroy() {
        this.releaseEvent?.();
        this.releaseAuthority?.();
        this.listeners.clear();
    }

    #send(message) {
        this.driver.signal(this.url, this.routeId, {
            type: 'particle-state-channel', channelId: this.channelId, sender: this.clientId, message,
        });
    }

    async #receive(event) {
        const envelope = event?.message;
        if (event?.type !== 'signal' || envelope?.type !== 'particle-state-channel' || envelope.channelId !== this.channelId) return;
        if (envelope.sender === this.clientId) return;
        if (envelope.request === 'snapshot' && this.authority) return this.#send(this.authority.snapshot());
        if (!validateStateChannelMessage(envelope.message, this.channelId)) return;
        if (envelope.message.kind === STATE_CHANNEL_MESSAGE.INTENT && this.authority) await this.authority.submit(envelope.message);
        else for (const listener of [...this.listeners]) listener(envelope.message);
    }
}
