// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { ParticleNetworkDaemon } from './ParticleNetworkDaemon.js';
import { ParticleNetworkPreferredDaemon } from './ParticleNetworkPreferredDaemon.js';

const REGISTRY = new Map();

export function acquireParticleNetworkDaemon({ server, deviceSigner, onEvent = null, preferV3 = false } = {}) {
    const pins = server?.serverKeyPins?.length ? server.serverKeyPins : server?.serverKeyPin;
    if (!server?.url || !pins) throw new TypeError('acquireParticleNetworkDaemon requires a pinned server');
    if (typeof deviceSigner?.publicKeyHex !== 'string') {
        throw new TypeError('acquireParticleNetworkDaemon requires a device signer identity');
    }
    const trustContract = {
        url: server.url,
        pins,
        networkRootId: server.networkRootId ?? null,
        networkRootVersion: server.networkRootVersion ?? null,
        networkRootRollbackVersion: server.networkRootRollbackVersion ?? null,
    };
    const key = `${JSON.stringify(trustContract)}\0${deviceSigner.publicKeyHex.toLowerCase()}\0${preferV3 ? 'v3-preferred' : 'v2'}`;
    let entry = REGISTRY.get(key);
    if (!entry) {
        const listeners = new Set();
        const DaemonImpl = preferV3 ? ParticleNetworkPreferredDaemon : ParticleNetworkDaemon;
        const daemon = new DaemonImpl({
            server,
            deviceSigner,
            onEvent: (event) => {
                for (const listener of listeners) {
                    try { listener(event); } catch (_) {}
                }
            },
        });
        entry = { daemon, listeners, refs: 0 };
        REGISTRY.set(key, entry);
        void daemon.connect();
    }
    if (onEvent) entry.listeners.add(onEvent);
    entry.refs += 1;
    let released = false;
    return {
        daemon: entry.daemon,
        release() {
            if (released) return;
            released = true;
            if (onEvent) entry.listeners.delete(onEvent);
            entry.refs = Math.max(0, entry.refs - 1);
            if (entry.refs === 0 && REGISTRY.get(key) === entry) {
                entry.daemon.destroy();
                REGISTRY.delete(key);
            }
        },
    };
}

export function particleNetworkDaemonStats() {
    return [...REGISTRY.values()].map((entry) => ({ refs: entry.refs, state: entry.daemon.getState() }));
}
