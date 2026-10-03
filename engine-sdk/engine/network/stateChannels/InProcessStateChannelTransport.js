// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export class InProcessStateChannelTransport {
    constructor(authority) {
        if (!authority?.submit || !authority?.subscribe) throw new TypeError('In-process transport requires an authority');
        this.authority = authority;
        this.listeners = new Set();
        this.releaseAuthority = authority.subscribe((message) => this.#emit(message));
    }

    subscribe(listener) {
        this.listeners.add(listener);
        listener(this.authority.snapshot());
        return () => this.listeners.delete(listener);
    }

    sendIntent(intent) {
        return this.authority.submit(intent);
    }

    requestSnapshot() {
        this.#emit(this.authority.snapshot());
    }

    stop() {}

    destroy() {
        this.releaseAuthority?.();
        this.listeners.clear();
    }

    #emit(message) {
        for (const listener of [...this.listeners]) listener(message);
    }
}
