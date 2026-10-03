// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { BroadcastStateChannelTransport } from './BroadcastStateChannelTransport.js';
import { InProcessStateChannelTransport } from './InProcessStateChannelTransport.js';
import { MeshStateChannelTransport } from './MeshStateChannelTransport.js';
import { SseStateChannelTransport } from './SseStateChannelTransport.js';

export const STATE_CHANNEL_AUTHORITY_LOCATION = Object.freeze({
    SERVER: 'server',
    SAME_ORIGIN: 'same-origin',
    PEER: 'peer',
    IN_PROCESS: 'in-process',
});

/**
 * Resolve transport from authority location. Server-backed channels remain
 * SSE by default; peer authority explicitly selects the WebRTC mesh.
 */
export function resolveStateChannelTransport(options = {}) {
    const location = options.authorityLocation ?? STATE_CHANNEL_AUTHORITY_LOCATION.SERVER;
    if (location === STATE_CHANNEL_AUTHORITY_LOCATION.IN_PROCESS) {
        return new InProcessStateChannelTransport(options.authority);
    }
    if (location === STATE_CHANNEL_AUTHORITY_LOCATION.SAME_ORIGIN) {
        return new BroadcastStateChannelTransport(options);
    }
    if (location === STATE_CHANNEL_AUTHORITY_LOCATION.PEER) {
        if (!options.networkDriver || !options.routeId) throw new TypeError('Peer State Channel requires networkDriver and routeId');
        const routeOptions = {
            routeSecret: options.routeSecret ?? null,
            idleMs: options.routeIdleMs ?? 3000,
        };
        const routeLeaseFactory = typeof options.networkDriver.acquireMeshSession === 'function'
            ? () => options.networkDriver.acquireMeshSession(options.routeId, routeOptions)
            : () => {
                options.networkDriver.openMeshSession(options.routeId, routeOptions);
                return {
                    routeId: options.routeId,
                    release: () => options.networkDriver.closeMeshSession?.(options.routeId) ?? false,
                };
            };
        const automaticCoordinator = Boolean(
            options.authority
            && options.enableAuthorityFailover !== false
            && typeof options.networkDriver.createStateChannelAuthorityCoordinator === 'function'
        );
        const transport = new MeshStateChannelTransport({
            ...options,
            authority: automaticCoordinator ? null : options.authority,
            routeLeaseFactory,
        });
        if (automaticCoordinator) {
            transport.attachAuthorityCoordinator(options.networkDriver.createStateChannelAuthorityCoordinator({
                authority: options.authority,
                transport,
                routeId: options.routeId,
                initialAuthorityPeerId: options.initialAuthorityPeerId ?? options.authorityPeerId,
                checkpointStore: options.checkpointStore ?? null,
                eligiblePeerIds: options.eligiblePeerIds,
                heartbeatMs: options.heartbeatMs,
                failoverMs: options.failoverMs,
                logger: options.logger,
            }));
        }
        return transport;
    }
    if (location === STATE_CHANNEL_AUTHORITY_LOCATION.SERVER) {
        const leaseProvider = options.leaseProvider ?? (
            options.networkDriver && options.serverUrl && options.routeId
                ? options.networkDriver.createStateChannelSseLeaseProvider({
                    url: options.serverUrl,
                    routeId: options.routeId,
                })
                : null
        );
        return new SseStateChannelTransport({ ...options, leaseProvider });
    }
    throw new TypeError(`Unknown State Channel authority location: ${location}`);
}
