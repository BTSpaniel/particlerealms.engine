// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// network/peerTickets/PeerTicketStore.js — local reconnect memory (network
// plan §38). In-memory only; callers persist via their own storage (e.g.
// webgpu-os/storage/AppSandbox) and rehydrate with addPeerTicket() on boot —
// engine/network stays storage-agnostic (see GroupLedger.js for the same
// pattern).

/** Create an empty peer ticket store. */
export function createPeerTicketStore() {
  return { _tickets: new Map() }; // peerId -> { ticket, receivedAt }
}

/** Remember a (already verified) peer ticket, keyed by its peerId. Overwrites any older ticket for the same peer. */
export function addPeerTicket(store, signedTicket) {
  const peerId = signedTicket && signedTicket.payload && signedTicket.payload.peerId;
  if (!peerId) throw new TypeError('addPeerTicket: ticket has no payload.peerId');
  store._tickets.set(peerId, { ticket: signedTicket, receivedAt: Date.now() });
  return peerId;
}

/** Look up the remembered ticket for a peer, or null. */
export function getPeerTicket(store, peerId) {
  const entry = store._tickets.get(peerId);
  return entry ? entry.ticket : null;
}

/** Forget a peer's ticket. Returns true if one existed. */
export function removePeerTicket(store, peerId) {
  return store._tickets.delete(peerId);
}

/** Remove tickets whose payload.expiresAt has passed. Returns the removed peerIds. */
export function pruneExpiredPeerTickets(store, now = Date.now()) {
  const removed = [];
  for (const [peerId, entry] of store._tickets) {
    const expiresAt = entry.ticket && entry.ticket.payload && entry.ticket.payload.expiresAt;
    if (expiresAt != null && now > expiresAt) {
      store._tickets.delete(peerId);
      removed.push(peerId);
    }
  }
  return removed;
}

/** All remembered tickets, most-recently-received first (network plan §38: try freshest known peers first). */
export function listPeerTicketsByFreshness(store) {
  return [...store._tickets.entries()]
    .sort((a, b) => b[1].receivedAt - a[1].receivedAt)
    .map(([peerId, entry]) => ({ peerId, ticket: entry.ticket, receivedAt: entry.receivedAt }));
}

/**
 * Full, JSON-serializable snapshot of a peer ticket store for OS-side
 * persistence (network plan §38 persistence gap — see this file's header
 * comment; storage itself, e.g. webgpu-os/storage/AppSandbox, is the
 * caller's job). Same shape `listPeerTicketsByFreshness` already returns —
 * exposed under its own name so the persistence contract (snapshot/hydrate
 * pair) stays explicit even if the internal shape changes later.
 */
export function snapshotPeerTicketStore(store) {
  return listPeerTicketsByFreshness(store);
}

/** Rebuild a peer ticket store from a previously-persisted snapshotPeerTicketStore() array. */
export function hydratePeerTicketStore(snapshot = []) {
  const store = createPeerTicketStore();
  for (const { peerId, ticket, receivedAt } of snapshot) {
    if (!peerId || !ticket) continue;
    store._tickets.set(peerId, { ticket, receivedAt: receivedAt ?? Date.now() });
  }
  return store;
}
