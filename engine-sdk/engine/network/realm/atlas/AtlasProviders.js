// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Feature-gated Atlas provider contracts with bounded verified in-memory stores. */

import {
  ATLAS_VISIBILITY,
  AtlasReplayGuard,
  canAccessAtlasRecordV1,
  verifyAtlasRecordV1,
} from './AtlasRecordV1.js';

export const ATLAS_PROVIDER_KIND = Object.freeze({
  LOCAL: 'local',
  CONTACT: 'contact',
  ORGANIZATION: 'organization',
  PEER_GOSSIP: 'peer-gossip',
  BOUNDED_SERVER: 'bounded-server',
});

const KINDS = new Set(Object.values(ATLAS_PROVIDER_KIND));
const NETWORK_VISIBLE = Object.freeze([
  ATLAS_VISIBILITY.PUBLIC,
  ATLAS_VISIBILITY.UNLISTED,
  ATLAS_VISIBILITY.ORGANIZATION_ONLY,
  ATLAS_VISIBILITY.TRUSTED_CONTACT_ONLY,
  ATLAS_VISIBILITY.INVITATION_ONLY,
  ATLAS_VISIBILITY.ARCHIVED,
  ATLAS_VISIBILITY.TEMPORARILY_SEALED,
]);

export const ATLAS_PROVIDER_VISIBILITY = Object.freeze({
  [ATLAS_PROVIDER_KIND.LOCAL]: Object.freeze(Object.values(ATLAS_VISIBILITY)),
  [ATLAS_PROVIDER_KIND.CONTACT]: Object.freeze([
    ATLAS_VISIBILITY.PUBLIC,
    ATLAS_VISIBILITY.UNLISTED,
    ATLAS_VISIBILITY.TRUSTED_CONTACT_ONLY,
    ATLAS_VISIBILITY.INVITATION_ONLY,
    ATLAS_VISIBILITY.ARCHIVED,
    ATLAS_VISIBILITY.TEMPORARILY_SEALED,
  ]),
  [ATLAS_PROVIDER_KIND.ORGANIZATION]: Object.freeze([
    ATLAS_VISIBILITY.PUBLIC,
    ATLAS_VISIBILITY.UNLISTED,
    ATLAS_VISIBILITY.ORGANIZATION_ONLY,
    ATLAS_VISIBILITY.INVITATION_ONLY,
    ATLAS_VISIBILITY.ARCHIVED,
    ATLAS_VISIBILITY.TEMPORARILY_SEALED,
  ]),
  [ATLAS_PROVIDER_KIND.PEER_GOSSIP]: Object.freeze([
    ATLAS_VISIBILITY.PUBLIC,
    ATLAS_VISIBILITY.ARCHIVED,
    ATLAS_VISIBILITY.TEMPORARILY_SEALED,
  ]),
  [ATLAS_PROVIDER_KIND.BOUNDED_SERVER]: NETWORK_VISIBLE,
});

export const AtlasProviderV1 = Object.freeze({
  name: 'AtlasProviderV1',
  version: 1,
  defaultEnabled: false,
  methods: Object.freeze(['publish', 'query', 'remove', 'prune', 'setEnabled', 'snapshot']),
  kinds: Object.freeze([...KINDS]),
});

function boundedInteger(value, name, minimum, maximum) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) {
    throw new TypeError(`${name} must be a safe integer from ${minimum} through ${maximum}`);
  }
  return result;
}

export function atlasProviderAllowsVisibility(kind, visibility) {
  if (!KINDS.has(kind)) throw new TypeError(`unsupported Atlas provider kind: ${kind}`);
  return ATLAS_PROVIDER_VISIBILITY[kind].includes(visibility);
}

function frozenResult(value) {
  return Object.freeze(value);
}

/**
 * A complete bounded provider suitable for local, direct-contact,
 * organization, and peer-gossip adapters. Network code passes verified records
 * into this contract; no provider becomes active until explicitly enabled.
 */
export class AtlasRecordProvider {
  constructor({
    kind,
    enabled = false,
    capacity = 512,
    queryLimit = 128,
    authorizePublisher = null,
    now = () => Date.now(),
    diagnostic = () => {},
  } = {}) {
    if (!KINDS.has(kind) || kind === ATLAS_PROVIDER_KIND.BOUNDED_SERVER) {
      throw new TypeError('AtlasRecordProvider requires a local, contact, organization, or peer-gossip kind');
    }
    if (typeof now !== 'function' || typeof diagnostic !== 'function') throw new TypeError('invalid Atlas provider hooks');
    this.kind = kind;
    this.enabled = enabled === true;
    this.capacity = boundedInteger(capacity, 'Atlas provider capacity', 1, 100_000);
    this.queryLimit = boundedInteger(queryLimit, 'Atlas provider queryLimit', 1, 1024);
    this._now = now;
    this._diagnostic = diagnostic;
    this._authorizePublisher = authorizePublisher;
    this._records = new Map();
    this._replay = new AtlasReplayGuard({ authorizePublisher, now });
  }

  setEnabled(enabled) {
    this.enabled = enabled === true;
    this._emit('provider-state', { enabled: this.enabled });
    return this.enabled;
  }

  _emit(event, fields = {}) {
    this._diagnostic(Object.freeze({
      component: 'realm-atlas',
      provider: this.kind,
      event,
      at: this._now(),
      ...fields,
    }));
  }

  _disabled() {
    if (this.enabled) return null;
    this._emit('operation-rejected', { reason: 'provider-disabled' });
    return frozenResult({ accepted: false, duplicate: false, gap: false, reason: 'provider-disabled' });
  }

  async publish(record, audienceContext = {}) {
    const disabled = this._disabled();
    if (disabled) return disabled;
    if (!atlasProviderAllowsVisibility(this.kind, record?.visibility)) {
      this._emit('record-rejected', { recordId: record?.recordId ?? null, reason: 'visibility-not-routable' });
      return frozenResult({ accepted: false, duplicate: false, gap: false, reason: 'visibility-not-routable' });
    }
    const verification = await verifyAtlasRecordV1(record, {
      now: this._now(),
      authorizePublisher: this._authorizePublisher,
    });
    if (!verification.valid) {
      this._emit('record-rejected', { recordId: record?.recordId ?? null, reason: verification.reason });
      return frozenResult({ accepted: false, duplicate: false, gap: false, reason: verification.reason });
    }
    const access = canAccessAtlasRecordV1(record, {
      ...audienceContext,
      local: this.kind === ATLAS_PROVIDER_KIND.LOCAL && audienceContext.local === true,
    });
    if (!access.allowed) {
      this._emit('record-rejected', { recordId: record?.recordId ?? null, reason: access.reason });
      return frozenResult({ accepted: false, duplicate: false, gap: false, reason: access.reason });
    }
    const prior = this._replay.current(record.realmId, record.publisherId);
    if (!prior && this._records.size >= this.capacity) {
      this._emit('record-rejected', { recordId: record.recordId, reason: 'provider-capacity' });
      return frozenResult({ accepted: false, duplicate: false, gap: false, reason: 'provider-capacity' });
    }
    const accepted = await this._replay.accept(record);
    if (!accepted.accepted) {
      this._emit('record-rejected', { recordId: record.recordId, reason: accepted.reason });
      return accepted;
    }
    if (prior) this._records.delete(prior.recordId);
    this._records.set(record.recordId, record);
    this._emit('record-accepted', {
      recordId: record.recordId,
      realmId: record.realmId,
      visibility: record.visibility,
      gap: accepted.gap,
    });
    return accepted;
  }

  async ingest(record, audienceContext = {}) {
    return this.publish(record, audienceContext);
  }

  query(filter = {}, audienceContext = {}) {
    if (!this.enabled) return Object.freeze([]);
    this.prune();
    const allowedFilterKeys = new Set(['recordId', 'realmId', 'organizationId', 'visibility', 'limit']);
    if (!filter || typeof filter !== 'object' || Array.isArray(filter)
      || Object.keys(filter).some(key => !allowedFilterKeys.has(key))) {
      throw new TypeError('Atlas query contains unsupported fields');
    }
    const limit = boundedInteger(filter.limit ?? this.queryLimit, 'Atlas query limit', 1, this.queryLimit);
    const records = [];
    for (const record of this._records.values()) {
      if (filter.recordId && record.recordId !== filter.recordId) continue;
      if (filter.realmId && record.realmId !== filter.realmId) continue;
      if (filter.organizationId !== undefined && record.organizationId !== filter.organizationId) continue;
      if (filter.visibility && record.visibility !== filter.visibility) continue;
      const access = canAccessAtlasRecordV1(record, {
        ...audienceContext,
        directLookup: audienceContext.directLookup === true || filter.recordId === record.recordId,
        local: this.kind === ATLAS_PROVIDER_KIND.LOCAL && audienceContext.local === true,
      });
      if (!access.allowed) continue;
      records.push(record);
    }
    records.sort((left, right) => right.issuedAt - left.issuedAt || left.recordId.localeCompare(right.recordId));
    this._emit('query', { returned: Math.min(records.length, limit), matched: records.length });
    return Object.freeze(records.slice(0, limit));
  }

  remove(recordId) {
    if (!this.enabled || typeof recordId !== 'string') return false;
    if (!this._records.has(recordId)) return false;
    this._records.delete(recordId);
    this._emit('record-removed', { recordId });
    return true;
  }

  prune(at = this._now()) {
    let removed = 0;
    for (const [recordId, record] of this._records) {
      if (record.expiresAt > at) continue;
      this._records.delete(recordId);
      removed += 1;
    }
    if (removed) this._emit('records-expired', { count: removed });
    return removed;
  }

  snapshot() {
    if (!this.enabled) return frozenResult({ kind: this.kind, enabled: false, count: 0, records: Object.freeze([]) });
    this.prune();
    return frozenResult({
      kind: this.kind,
      enabled: true,
      count: this._records.size,
      records: Object.freeze([...this._records.values()].sort((a, b) => a.recordId.localeCompare(b.recordId))),
    });
  }
}

export const createLocalAtlasProvider = options => new AtlasRecordProvider({ ...options, kind: ATLAS_PROVIDER_KIND.LOCAL });
export const createContactAtlasProvider = options => new AtlasRecordProvider({ ...options, kind: ATLAS_PROVIDER_KIND.CONTACT });
export const createOrganizationAtlasProvider = options => new AtlasRecordProvider({ ...options, kind: ATLAS_PROVIDER_KIND.ORGANIZATION });
export const createPeerGossipAtlasProvider = options => new AtlasRecordProvider({ ...options, kind: ATLAS_PROVIDER_KIND.PEER_GOSSIP });
