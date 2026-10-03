// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// network/transport/MasterServerRegistry.js — shared, ref-counted
// transport/MasterServerClient.js registry (network plan §4/§7/§8/§12).
//
// Multiple independent OS consumers can each want a live session to the same
// Masterserver URL at the same time — e.g. SecureMesh's signaling tier
// (engine/collab/CollabSignal.js Tier 4) and the Particle Network control
// panel's live inspector (factory/apps/network-manager/NetworkManagerApp.js).
// Without this, each would open its own redundant WebSocket + HELLO/PROVE
// handshake to the same server. This module multiplexes N listeners onto ONE
// underlying MasterServerClient connection per URL, connecting on first
// acquire and disconnecting only once every consumer has released it.
//
// A Masterserver route/session concept is per-connection, not per-consumer —
// sharing one session is exactly what "a master server introduces peers and
// forwards signaling" (README.md's can/cannot boundary) assumes: any number
// of local app-level features can ride the same proven session and attach
// their own routes on it independently (ATTACH_ROUTE is additive; a session
// can be attached to many routes at once).

import { createMasterServerClient } from './MasterServerClient.js';
import { createReconnectBackoff, nextBackoffDelay, resetBackoff } from '../routes/ReconnectBackoff.js';

const _registry = new Map(); // url -> { client, listeners:Set<fn>, refCount:number, backoff, reconnectTimer }

/**
 * Acquire a shared, ref-counted MasterServerClient for `url`, connecting it
 * if this is the first consumer. Every event the underlying client emits is
 * fanned out to every registered listener — consumers are expected to filter
 * for events relevant to them (by routeId/message shape), same as they would
 * with their own private client.
 *
 * @param {object} c
 * @param {string} c.url
 * @param {object} [c.deviceSigner]  only used if this is the first consumer
 *   for this url — an already-open shared session keeps whatever signer
 *   completed its PROVE handshake; the wire protocol has no mid-session
 *   re-prove, so a later caller's signer is simply not needed once connected.
 * @param {(event:object) => void} [c.onEvent]  this consumer's own listener
 * @returns {{ client: object, release: () => void }}
 */
export function acquireSharedMasterServerClient({ url, deviceSigner = null, onEvent = null } = {}) {
  if (!url) throw new TypeError('acquireSharedMasterServerClient requires a url');

  let entry = _registry.get(url);
  let isNew = false;
  if (!entry) {
    isNew = true;
    const listeners = new Set();
    const client = createMasterServerClient({
      url,
      deviceSigner,
      onEvent: (event) => {
        if (event.type === 'connected') resetBackoff(entry.backoff);
        else if (event.type === 'closed' || event.type === 'error') _scheduleReconnect(url, entry);
        for (const fn of listeners) {
          try { fn(event); } catch (_) { /* one bad listener must not break the others */ }
        }
      },
    });
    entry = { client, listeners, refCount: 0, backoff: createReconnectBackoff({ maxAttempts: 0 }), reconnectTimer: null };
    _registry.set(url, entry);
  }

  if (onEvent) entry.listeners.add(onEvent);
  entry.refCount++;

  // Increment refCount BEFORE the first connect() so a synchronous connect
  // failure (e.g. malformed URL, thrown inside connect()) still sees
  // refCount > 0 and schedules a retry instead of poisoning this entry.
  if (isNew) entry.client.connect();

  let released = false;
  function release() {
    if (released) return;
    released = true;
    if (onEvent) entry.listeners.delete(onEvent);
    entry.refCount = Math.max(0, entry.refCount - 1);
    if (entry.refCount === 0 && _registry.get(url) === entry) {
      if (entry.reconnectTimer) { clearTimeout(entry.reconnectTimer); entry.reconnectTimer = null; }
      try { entry.client.disconnect(); } catch (_) { /* already closed */ }
      _registry.delete(url);
    }
  }

  return { client: entry.client, release };
}

/**
 * A shared session dropping (network blip, server restart) shouldn't just
 * die silently while consumers still hold it — nothing else in the codebase
 * was actually wiring engine/network/routes/ReconnectBackoff.js's timing
 * sequence to a live client until this registry existed. Retries forever
 * (capped at DEFAULT_BACKOFF_MAX_MS between attempts) as long as at least
 * one consumer hasn't released; stops the moment refCount hits 0.
 */
function _scheduleReconnect(url, entry) {
  if (entry.refCount <= 0 || entry.reconnectTimer || _registry.get(url) !== entry) return;
  const { delayMs } = nextBackoffDelay(entry.backoff);
  entry.reconnectTimer = setTimeout(() => {
    entry.reconnectTimer = null;
    if (entry.refCount > 0 && _registry.get(url) === entry) entry.client.connect();
  }, delayMs);
}

/** True if a shared client for this url already exists (connecting or connected). */
export function hasSharedMasterServerClient(url) {
  return _registry.has(url);
}

/** Current listener/ref count for a url's shared client, or null if none exists. Diagnostics only. */
export function sharedMasterServerClientStats(url) {
  const entry = _registry.get(url);
  return entry ? { refCount: entry.refCount, listenerCount: entry.listeners.size } : null;
}
