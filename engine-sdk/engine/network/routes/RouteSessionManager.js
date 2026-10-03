// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// network/routes/RouteSessionManager.js — orchestrates one P2P session per
// attached route/group.
//
// Phase 0 audit finding: engine/collab/CollabCore.js is built around a
// single projectId/roomPassword session. The network layer needs many
// concurrent routes/groups at once, so rather than rewriting CollabCore.js
// (which would risk existing game-collab call sites), this manager holds N
// session instances behind a pluggable factory — callers pass in
// `createSession(routeId, opts) => session` (typically a thin wrapper around
// `createCollabCore({ projectId: routeId, ... })`) and this module just
// tracks lifecycle (one session per routeId, created on demand, torn down
// explicitly or when the route's last local lease is dropped).

/**
 * @param {object} cfg
 * @param {(routeId:string, opts:object) => object} cfg.createSession
 * @param {(session:object, routeId:string) => void} [cfg.destroySession]
 */
export function createRouteSessionManager({ createSession, destroySession = null } = {}) {
  if (typeof createSession !== 'function') {
    throw new TypeError('createRouteSessionManager requires a createSession(routeId, opts) factory');
  }
  return {
    _sessions: new Map(), // routeId -> session
    _leases: new Map(),   // routeId -> { count, opts, idleMs, idleTimer }
    _createSession: createSession,
    _destroySession: destroySession,
  };
}

/** Get the session for `routeId`, creating it via the factory if it doesn't exist yet. */
export function ensureRouteSession(manager, routeId, opts = {}) {
  const normalizedRouteId = String(routeId);
  if (manager._sessions.has(normalizedRouteId)) return manager._sessions.get(normalizedRouteId);
  const session = manager._createSession(normalizedRouteId, opts);
  manager._sessions.set(normalizedRouteId, session);
  return session;
}

/**
 * Acquire one local consumer lease for a route. The first lease creates the
 * session. The final release tears it down after a bounded idle grace period.
 */
export function acquireRouteSession(manager, routeId, opts = {}) {
  if (!routeId) throw new TypeError('acquireRouteSession requires a routeId');
  const normalizedRouteId = String(routeId);
  const idleMs = finiteIdleMs(opts.idleMs ?? 3000);
  let record = manager._leases.get(normalizedRouteId);
  if (!record) {
    const sessionOpts = { ...opts };
    delete sessionOpts.idleMs;
    record = { count: 0, opts: sessionOpts, idleMs, idleTimer: null };
    manager._leases.set(normalizedRouteId, record);
  } else {
    assertCompatibleRouteSecret(record.opts.routeSecret, opts.routeSecret);
    assertCompatibleRelayPolicy(record.opts.relayOnly, opts.relayOnly);
    assertCompatibleChunkAnnouncement(record.opts.announceChunks, opts.announceChunks);
    record.idleMs = Math.min(record.idleMs, idleMs);
  }
  if (record.idleTimer != null) {
    clearTimeout(record.idleTimer);
    record.idleTimer = null;
  }
  ensureRouteSession(manager, normalizedRouteId, record.opts);
  record.count++;
  let released = false;
  return Object.freeze({
    routeId: normalizedRouteId,
    get session() { return getRouteSession(manager, normalizedRouteId); },
    release(options = {}) {
      if (released) return false;
      released = true;
      return releaseRouteSession(manager, normalizedRouteId, options);
    },
  });
}

/** Release one local route lease without affecting other consumers. */
export function releaseRouteSession(manager, routeId, options = {}) {
  const normalizedRouteId = String(routeId);
  const record = manager._leases.get(normalizedRouteId);
  if (!record || record.count <= 0) return false;
  record.count--;
  if (record.count > 0) return true;
  const immediate = options.immediate === true;
  if (immediate || record.idleMs === 0) {
    manager._leases.delete(normalizedRouteId);
    return teardownRouteSession(manager, normalizedRouteId, { preserveLeases: true });
  }
  record.idleTimer = setTimeout(() => {
    record.idleTimer = null;
    if (record.count !== 0 || manager._leases.get(normalizedRouteId) !== record) return;
    manager._leases.delete(normalizedRouteId);
    teardownRouteSession(manager, normalizedRouteId, { preserveLeases: true });
  }, record.idleMs);
  return true;
}

/** Inspect lease ownership without exposing route secrets or session internals. */
export function routeSessionLeaseStatus(manager, routeId) {
  const record = manager._leases.get(String(routeId));
  return Object.freeze({
    routeId: String(routeId),
    consumers: record?.count ?? 0,
    idlePending: record?.idleTimer != null,
    live: manager._sessions.has(String(routeId)),
  });
}

/** Get an existing session, or null. Does NOT create one. */
export function getRouteSession(manager, routeId) {
  return manager._sessions.get(String(routeId)) ?? null;
}

/** Tear down and forget a route's session (calls `destroySession` if provided). */
export function teardownRouteSession(manager, routeId, options = {}) {
  const normalizedRouteId = String(routeId);
  const record = manager._leases.get(normalizedRouteId);
  if (record?.idleTimer != null) clearTimeout(record.idleTimer);
  if (options.preserveLeases !== true) manager._leases.delete(normalizedRouteId);
  const session = manager._sessions.get(normalizedRouteId);
  if (!session) return false;
  manager._sessions.delete(normalizedRouteId);
  if (manager._destroySession) manager._destroySession(session, normalizedRouteId);
  return true;
}

/** List routeIds with a live session. */
export function listRouteSessions(manager) {
  return [...manager._sessions.keys()];
}

function finiteIdleMs(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 60_000) {
    throw new RangeError('route lease idleMs must be in [0, 60000]');
  }
  return Math.trunc(number);
}

function assertCompatibleRouteSecret(existing, candidate) {
  if (candidate === undefined || existing === candidate) return;
  throw new Error('route already has a lease with different authentication material');
}

function assertCompatibleRelayPolicy(existing, candidate) {
  if (candidate === undefined || Boolean(existing) === Boolean(candidate)) return;
  throw new Error('route already has a lease with a different WebRTC relay policy');
}

function assertCompatibleChunkAnnouncement(existing, candidate) {
  if (candidate === undefined || Boolean(existing ?? true) === Boolean(candidate)) return;
  throw new Error('route already has a lease with a different chunk-announcement policy');
}
