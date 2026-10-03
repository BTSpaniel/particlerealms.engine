// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// network/capability/RouteCapability.js — capability-based route access for
// the Particle Global OS Network Layer (network plan §10).
//
// Reuses the Causal State Engine's UCAN-style capability primitive
// (engine/state/authority/Capability.js: makeCapability/attenuate/authorizes)
// unmodified. A route capability names a principal (device/profile/membership
// signer fingerprint), the route as its object, and an allow-list of
// route/* verbs enforced via a caveat predicate — narrowing-only delegation
// comes for free from `attenuate()`. `CapabilityRegistry` (also reused
// as-is) tracks issuance, revocation, and single-use consumption.

import { makeCapability, attenuate, authorizes } from '../../state/authority/Capability.js';
import { CapabilityRegistry } from '../../state/authority/CapabilityRegistry.js';

/** Default allow-list for a freshly-minted route capability (network plan §10). */
export const DEFAULT_ROUTE_ALLOW = Object.freeze(['route/attach', 'route/subscribe']);

/** All route verbs the network layer currently understands. */
export const ROUTE_ACTIONS = Object.freeze({
  ATTACH: 'route/attach',
  SUBSCRIBE: 'route/subscribe',
  PUBLISH: 'route/publish',
  FORWARD: 'route/forward',
  INVITE: 'route/invite',
});

/**
 * Mint a route capability. The capability's own `action` is always `'*'`;
 * the actual allow-list is enforced by a `route-allow` caveat so it composes
 * correctly with further `attenuateRouteCapability()` narrowing.
 * @param {object} c
 * @param {string} c.principal        holder's signer fingerprint (device/profile/membership)
 * @param {string} c.routeId          opaque route id (the capability's object)
 * @param {string[]} [c.allow]        allowed route/* verbs (default: attach+subscribe)
 * @param {object} [c.constraints]    extra descriptive constraints (message kinds, byte caps, ...)
 * @param {number} [c.expiresAt]      operational-time expiry epoch
 * @param {boolean} [c.singleUse]     consumed on first use (e.g. invite capabilities)
 * @param {boolean} [c.delegable]     may be further attenuated/re-delegated
 * @returns {object} frozen capability
 */
export function makeRouteCapability({
  principal,
  routeId,
  allow = DEFAULT_ROUTE_ALLOW,
  constraints = {},
  expiresAt = null,
  singleUse = false,
  delegable = true,
} = {}) {
  if (!principal) throw new TypeError('makeRouteCapability requires a principal');
  if (!routeId) throw new TypeError('makeRouteCapability requires a routeId');
  const allowList = Object.freeze([...allow]);
  return makeCapability({
    principal,
    object: String(routeId),
    action: '*',
    constraints: { ...constraints, allow: allowList },
    caveats: [{
      key: 'route-allow',
      label: `allow:${allowList.join(',')}`,
      predicate: (ctx) => allowList.includes(String(ctx && ctx.action)),
    }],
    expiryEpoch: expiresAt,
    singleUse,
    delegable,
  });
}

/**
 * Narrow an existing route capability's allow-list and/or add an arbitrary
 * extra predicate (e.g. "only from this device fingerprint"). Cannot widen
 * beyond the parent's allow-list — throws if it would.
 * @param {object} cap        parent capability (from makeRouteCapability)
 * @param {object} narrowing
 * @param {string[]} [narrowing.allow]  a subset of the parent's allow-list
 * @param {(ctx:object)=>boolean} [narrowing.predicate]  extra caveat predicate
 * @param {string} [narrowing.key]
 * @param {string} [narrowing.label]
 * @returns {object} new, strictly narrower capability
 */
export function attenuateRouteCapability(cap, { allow, predicate, key, label } = {}) {
  const baseAllow = (cap.constraints && cap.constraints.allow) || [];
  if (allow) {
    const invalid = allow.filter((a) => !baseAllow.includes(a));
    if (invalid.length) {
      throw new Error(`attenuateRouteCapability: cannot widen allow-list beyond parent (invalid: ${invalid.join(', ')})`);
    }
  }
  const narrowedAllow = allow || baseAllow;
  return attenuate(cap, {
    key: key || 'route-allow-narrow',
    label: label || `allow:${narrowedAllow.join(',')}`,
    predicate: (ctx) => {
      if (!narrowedAllow.includes(String(ctx && ctx.action))) return false;
      return predicate ? !!predicate(ctx) : true;
    },
  });
}

/**
 * Check whether a capability authorizes a specific route action right now.
 * @param {object} cap
 * @param {object} req
 * @param {string} req.principal  requester's signer fingerprint
 * @param {string} req.routeId
 * @param {string} req.action     one of ROUTE_ACTIONS
 * @param {number} [req.epoch]
 * @param {object} [req.context]  extra caveat context
 * @returns {{ ok:boolean, reason:string|null }}
 */
export function authorizesRoute(cap, { principal, routeId, action, epoch, context = {} } = {}) {
  return authorizes(cap, {
    principal,
    object: routeId,
    action,
    epoch,
    context: { ...context, action },
  });
}

/** Create a fresh registry to issue/revoke/consume route capabilities in. */
export function createRouteCapabilityRegistry() {
  return new CapabilityRegistry();
}
