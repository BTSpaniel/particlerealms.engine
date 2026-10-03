// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// network/routes/RouteTable.js — dynamic, capability-gated routes for the
// Particle Global OS Network Layer (network plan §9 "dynamic routes instead
// of rooms" + §10 capability checks).
//
// A route is NOT server-owned: it exists in this local table only while a
// capability-holding principal has attached to it and kept its lease alive
// via heartbeats. There is no createRoute() — attachRoute() both creates the
// local entry (if absent) and joins it. Leases expire on their own; nothing
// here talks to a network — this is pure local bookkeeping that the
// Masterserver signaling tier (Phase 2b) and per-route session manager below
// will drive.

import { authorizesRoute, ROUTE_ACTIONS } from '../capability/RouteCapability.js';

/** Default route lease TTL (network plan §9/§35: ~90s). */
export const DEFAULT_ROUTE_TTL_MS = 90_000;
/** Default heartbeat interval to keep a lease alive (network plan §8: 25-30s). */
export const DEFAULT_HEARTBEAT_MS = 27_000;

/**
 * Create an empty route table.
 * @param {object} [cfg]
 * @param {string} [cfg.selfPeerId]  this device/session's peer id (for convenience defaults)
 * @returns {object} route table state
 */
export function createRouteTable(cfg = {}) {
  return {
    selfPeerId: cfg.selfPeerId ?? null,
    _routes: new Map(), // routeId -> RouteEntry
  };
}

function _now() { return Date.now(); }

/**
 * Attach to a route. Validates the capability authorizes `route/attach` for
 * (principal, routeId) right now; if the route doesn't exist locally yet it
 * is created (this is what "routes appear when clients attach" means —
 * there is no separate creation step). Re-attaching refreshes the lease.
 * @param {object} table
 * @param {object} req
 * @param {string} req.routeId
 * @param {string} req.principal    the attaching signer's fingerprint
 * @param {object} req.capability   from makeRouteCapability()/attenuateRouteCapability()
 * @param {number} [req.ttlMs]      lease duration (default DEFAULT_ROUTE_TTL_MS)
 * @param {object} [req.meta]       opaque local metadata (routeType, maxFanout, maxHops, ...)
 * @returns {{ ok:boolean, reason:string|null, route:object|null }}
 */
export function attachRoute(table, { routeId, principal, capability, ttlMs = DEFAULT_ROUTE_TTL_MS, meta = {} } = {}) {
  if (!routeId) return { ok: false, reason: 'missing-routeId', route: null };
  if (!principal) return { ok: false, reason: 'missing-principal', route: null };
  if (!capability) return { ok: false, reason: 'missing-capability', route: null };

  const verdict = authorizesRoute(capability, { principal, routeId, action: ROUTE_ACTIONS.ATTACH, epoch: _now() });
  if (!verdict.ok) return { ok: false, reason: verdict.reason, route: null };

  const now = _now();
  let route = table._routes.get(routeId);
  if (!route) {
    route = {
      routeId,
      createdAt: now,
      meta: { ...meta },
      subscribers: new Map(), // principal -> { capability, attachedAt, lastHeartbeat, expiresAt }
    };
    table._routes.set(routeId, route);
  }
  route.subscribers.set(principal, {
    capability,
    attachedAt: route.subscribers.get(principal)?.attachedAt ?? now,
    lastHeartbeat: now,
    expiresAt: now + ttlMs,
  });
  return { ok: true, reason: null, route };
}

/**
 * Refresh a principal's lease on a route (heartbeat). Re-checks the
 * capability so a revoked capability cannot keep renewing its lease.
 * @returns {{ ok:boolean, reason:string|null }}
 */
export function heartbeatRoute(table, { routeId, principal, ttlMs = DEFAULT_ROUTE_TTL_MS } = {}) {
  const route = table._routes.get(routeId);
  if (!route) return { ok: false, reason: 'no-such-route' };
  const sub = route.subscribers.get(principal);
  if (!sub) return { ok: false, reason: 'not-attached' };
  const verdict = authorizesRoute(sub.capability, { principal, routeId, action: ROUTE_ACTIONS.ATTACH, epoch: _now() });
  if (!verdict.ok) return { ok: false, reason: verdict.reason };
  const now = _now();
  sub.lastHeartbeat = now;
  sub.expiresAt = now + ttlMs;
  return { ok: true, reason: null };
}

/** Detach a principal from a route. Removes the route entirely once empty. */
export function detachRoute(table, { routeId, principal } = {}) {
  const route = table._routes.get(routeId);
  if (!route) return false;
  const had = route.subscribers.delete(principal);
  if (route.subscribers.size === 0) table._routes.delete(routeId);
  return had;
}

/**
 * Remove all expired subscriber leases (and any routes left with zero
 * subscribers). Call this periodically (e.g. alongside heartbeat ticks).
 * @returns {Array<{ routeId:string, principal:string }>} removed leases
 */
export function pruneExpiredRoutes(table, now = _now()) {
  const removed = [];
  for (const [routeId, route] of table._routes) {
    for (const [principal, sub] of route.subscribers) {
      if (sub.expiresAt <= now) {
        route.subscribers.delete(principal);
        removed.push({ routeId, principal });
      }
    }
    if (route.subscribers.size === 0) table._routes.delete(routeId);
  }
  return removed;
}

/** True if `routeId` currently has at least one live subscriber. */
export function isRouteAttached(table, routeId) {
  return table._routes.has(routeId) && table._routes.get(routeId).subscribers.size > 0;
}

/** Snapshot of a route's subscribers, or null. */
export function getRoute(table, routeId) {
  const route = table._routes.get(routeId);
  if (!route) return null;
  return {
    routeId: route.routeId,
    createdAt: route.createdAt,
    meta: { ...route.meta },
    subscriberCount: route.subscribers.size,
    subscribers: [...route.subscribers.keys()],
  };
}

/** List all currently-live routes (opaque summaries only — no capability objects). */
export function listRoutes(table) {
  return [...table._routes.keys()].map((id) => getRoute(table, id));
}
