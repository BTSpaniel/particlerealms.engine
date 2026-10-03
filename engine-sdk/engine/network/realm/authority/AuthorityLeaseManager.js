// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { verifyAuthorityLease, verifyAuthorityRevocation } from './AuthorityLease.js';

/** In-memory authority decision engine; persistence is supplied by the caller. */
export class AuthorityLeaseManager {
  constructor({ authorizeIssuer = null, now = () => Date.now(), logger = () => {} } = {}) {
    if (authorizeIssuer !== null && typeof authorizeIssuer !== 'function') throw new TypeError('authorizeIssuer must be a function');
    if (typeof now !== 'function' || typeof logger !== 'function') throw new TypeError('AuthorityLeaseManager hooks are invalid');
    this.authorizeIssuer = authorizeIssuer;
    this.now = now;
    this.logger = logger;
    this.leases = new Map();
    this.revocations = new Map();
  }

  async accept(lease) {
    const result = await verifyAuthorityLease(lease, {
      now: this.now(),
      authorizeIssuer: this.authorizeIssuer,
    });
    if (!result.valid) return Object.freeze({ accepted: false, reason: result.reason });
    const previous = this.leases.get(lease.resourceId);
    if (previous?.leaseId === lease.leaseId) return Object.freeze({ accepted: true, duplicate: true, lease: previous });
    if (previous && lease.fencingToken <= previous.fencingToken) {
      return Object.freeze({ accepted: false, reason: 'stale-fencing-token', currentLeaseId: previous.leaseId });
    }
    this.leases.set(lease.resourceId, lease);
    this.logger({ component: 'authority', event: 'lease.accepted', resourceId: lease.resourceId, leaseId: lease.leaseId, fencingToken: lease.fencingToken });
    return Object.freeze({ accepted: true, duplicate: false, lease });
  }

  async revoke(record) {
    const verified = await verifyAuthorityRevocation(record, { authorizeIssuer: this.authorizeIssuer });
    if (!verified.valid) return Object.freeze({ revoked: false, reason: verified.reason });
    if (this.revocations.has(record.revocationId)) return Object.freeze({ revoked: true, duplicate: true });
    const current = this.leases.get(record.resourceId);
    if (!current || current.leaseId !== record.leaseId) return Object.freeze({ revoked: false, reason: 'lease-not-current' });
    if (record.fencingToken < current.fencingToken) return Object.freeze({ revoked: false, reason: 'stale-fencing-token' });
    this.revocations.set(record.revocationId, record);
    this.leases.delete(record.resourceId);
    this.logger({ component: 'authority', event: 'lease.revoked', resourceId: record.resourceId, leaseId: record.leaseId, reason: record.reason });
    return Object.freeze({ revoked: true, duplicate: false });
  }

  current(resourceId, at = this.now()) {
    const lease = this.leases.get(resourceId) ?? null;
    if (!lease) return Object.freeze({ active: false, reason: 'no-lease', fallback: null });
    if (at < lease.notBefore) return Object.freeze({ active: false, reason: 'not-yet-valid', lease, fallback: null });
    if (at >= lease.expiresAt) {
      const fallbackAt = lease.expiresAt + (lease.fallback?.delayMs ?? 0);
      return Object.freeze({
        active: false,
        reason: 'expired',
        lease,
        fallback: lease.fallback && at >= fallbackAt ? lease.fallback : null,
      });
    }
    return Object.freeze({ active: true, lease, fallback: null });
  }

  authorize({ resourceId, holderId, action, leaseId, fencingToken, at = this.now() } = {}) {
    const current = this.current(resourceId, at);
    if (!current.active) return Object.freeze({ allowed: false, reason: current.reason, fallback: current.fallback });
    const lease = current.lease;
    if (lease.leaseId !== leaseId) return Object.freeze({ allowed: false, reason: 'lease-id-mismatch' });
    if (lease.fencingToken !== fencingToken) return Object.freeze({ allowed: false, reason: 'fencing-token-mismatch' });
    if (lease.holderId !== holderId) return Object.freeze({ allowed: false, reason: 'holder-mismatch' });
    if (!lease.actions.includes(action) && !lease.actions.includes('*')) return Object.freeze({ allowed: false, reason: 'action-not-leased' });
    return Object.freeze({ allowed: true, lease });
  }

  snapshot() {
    return Object.freeze({
      leases: Object.freeze([...this.leases.values()].sort((a, b) => a.resourceId.localeCompare(b.resourceId))),
      revocations: Object.freeze([...this.revocations.values()].sort((a, b) => a.revokedAt - b.revokedAt)),
    });
  }
}

export function createAuthorityLeaseManager(options) {
  return new AuthorityLeaseManager(options);
}

