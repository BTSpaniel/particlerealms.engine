// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * CollabSignalWorker.js — SharedWorker
 * In-memory SDP relay for all editor tabs on the same machine.
 * Runs once per origin, shared across all tabs.
 *
 * Message types (client → worker):
 *   HELLO    { peerId, username }
 *   OFFER    { from, to, offerId, payload }
 *   ANSWER   { from, to, offerId, payload }
 *   CANDIDATE { from, to, offerId, payload }
 *   LEAVE    { peerId }
 *   LIST     (request peer list)
 *
 * Message types (worker → client):
 *   HELLO_ACK   { peerId, peers: [{peerId, username}] }
 *   PEER_JOINED { peerId, username }
 *   PEER_LEFT   { peerId }
 *   OFFER       { from, to, offerId, payload }
 *   ANSWER      { from, to, offerId, payload }
 *   CANDIDATE   { from, to, offerId, payload }
 *   LIST        { peers: [{peerId, username}] }
 */

const peers = new Map(); // peerId -> { port, username }

self.onconnect = function (e) {
    const port = e.ports[0];

    port.onmessage = function (evt) {
        const msg = evt.data;
        if (!msg || !msg.type) return;

        switch (msg.type) {
            case 'HELLO': {
                const { peerId, username } = msg;
                if (!peerId) return;

                // Register this peer
                peers.set(peerId, { port, username: username || 'Anonymous' });

                // Notify all existing peers that someone joined
                const peerList = _getPeerList(peerId);
                _broadcast(peerId, { type: 'PEER_JOINED', peerId, username: username || 'Anonymous' });

                // Send ack with current peer list
                port.postMessage({ type: 'HELLO_ACK', peerId, peers: peerList });
                break;
            }

            case 'OFFER':
            case 'ANSWER':
            case 'CANDIDATE': {
                const { from, to, offerId, payload } = msg;
                if (!from || !to || !offerId || !payload) return;
                const target = peers.get(to);
                if (target) {
                    target.port.postMessage({ type: msg.type, from, to, offerId, payload });
                }
                break;
            }

            case 'LEAVE': {
                const { peerId } = msg;
                if (peerId) _removePeer(peerId);
                break;
            }

            case 'LIST': {
                const requesterId = msg.peerId;
                port.postMessage({ type: 'LIST', peers: _getPeerList(requesterId) });
                break;
            }
        }
    };

    port.onmessageerror = function () {};

    // Detect port close (tab closed) — not directly supported in SharedWorker,
    // but we handle it via LEAVE messages and stale peer pruning.
    port.start();
};

function _getPeerList(excludePeerId) {
    const list = [];
    for (const [id, peer] of peers) {
        if (id !== excludePeerId) {
            list.push({ peerId: id, username: peer.username });
        }
    }
    return list;
}

function _broadcast(excludePeerId, message) {
    for (const [id, peer] of peers) {
        if (id !== excludePeerId) {
            try { peer.port.postMessage(message); } catch (_) {}
        }
    }
}

function _removePeer(peerId) {
    if (!peers.has(peerId)) return;
    peers.delete(peerId);
    _broadcast(peerId, { type: 'PEER_LEFT', peerId });
}
