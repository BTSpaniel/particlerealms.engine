// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// state/authority/Capability.js — scoped, attenuable, revocable authority (spec §12).
//
// Observation does NOT imply permission (spec rule 29). A capability names a
// principal, an object, an allowed action, scope/constraints, expiry, and
// whether it is single-use. Following Macaroons, a capability can be ATTENUATED
// by adding caveats (narrowing who/where/when/what) — never widened. Critical
// single-use capabilities are themselves USOs (consumed on use). Authority is
// re-checked at commit, closing the time-of-check/time-of-use gap.

import { hashIdFast } from '../util/canonical.js';

/**
 * Mint a capability.
 * @param {object} c
 * @param {string} c.principal     who may use it
 * @param {string} c.object        target object/entity (or '*' pattern)
 * @param {string} c.action        allowed action (e.g. 'edit-file')
 * @param {object} [c.constraints] arbitrary caveat predicates' data
 * @param {number} [c.expiryEpoch] operational-time expiry
 * @param {boolean}[c.singleUse]   true → consumed on first use (a USO)
 * @param {boolean}[c.delegable]   may this be re-delegated/attenuated?
 * @returns {object} frozen capability with a stable `id`
 */
export function makeCapability(c = {}) {
  const core = {
    principal: String(c.principal ?? ''),
    object: String(c.object ?? '*'),
    action: String(c.action ?? '*'),
    constraints: c.constraints ?? {},
    caveats: [...(c.caveats ?? [])],
    expiryEpoch: c.expiryEpoch ?? null,
    singleUse: !!c.singleUse,
    delegable: c.delegable !== false,
  };
  // The id is derived from SERIALIZABLE fields only — caveat predicates are
  // closures, so we fold in their stable keys/labels rather than the functions
  // (which canonicalization cannot hash).
  const idCore = {
    ...core,
    caveats: core.caveats.map((cav) => ({ key: cav.key ?? 'caveat', label: cav.label ?? null })),
  };
  const id = c.id ?? `cap:${core.action}:${core.object}:${hashIdFast(idCore)}`;
  return Object.freeze({ id, ...core });
}

/**
 * Attenuate a capability by adding a caveat. The result is a NEW capability that
 * is strictly narrower; it can never grant more than its parent (spec rule 30,
 * CSE rule "a capability cannot grant rights beyond its issuer's rights").
 * @param {object} cap
 * @param {{ key:string, predicate:(ctx:object)=>boolean, label?:string }} caveat
 */
export function attenuate(cap, caveat) {
  if (!cap.delegable) throw new Error('capability is not delegable');
  if (typeof caveat?.predicate !== 'function') throw new TypeError('caveat needs a predicate');
  return makeCapability({
    ...cap,
    id: undefined, // re-derive a fresh id for the narrowed capability
    caveats: [...cap.caveats, { key: String(caveat.key ?? 'caveat'), predicate: caveat.predicate, label: caveat.label ?? null }],
  });
}

/**
 * Test whether a capability authorizes an action in a context. Checks
 * object/action match, expiry, and every caveat predicate. Does NOT check
 * revocation — that lives in the registry (online status, spec rule 31).
 * @returns {{ ok:boolean, reason:string|null }}
 */
export function authorizes(cap, { principal, object, action, epoch, context = {} } = {}) {
  if (cap.principal !== String(principal)) return { ok: false, reason: 'principal-mismatch' };
  if (cap.action !== '*' && cap.action !== String(action)) return { ok: false, reason: 'action-not-allowed' };
  if (cap.object !== '*' && cap.object !== String(object)) return { ok: false, reason: 'object-not-allowed' };
  if (cap.expiryEpoch != null && epoch != null && epoch > cap.expiryEpoch) return { ok: false, reason: 'expired' };
  for (const cav of cap.caveats) {
    let ok = false;
    try { ok = !!cav.predicate(context); } catch (_) { ok = false; }
    if (!ok) return { ok: false, reason: `caveat-failed:${cav.key}` };
  }
  return { ok: true, reason: null };
}
