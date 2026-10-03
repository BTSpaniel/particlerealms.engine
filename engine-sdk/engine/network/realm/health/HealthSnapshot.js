// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export const HEALTH_SCHEMA = 'HealthSnapshotV1';
export const HEALTH_STATUS = Object.freeze({
  HEALTHY: 'healthy',
  DEGRADED: 'degraded',
  UNAVAILABLE: 'unavailable',
  UNKNOWN: 'unknown',
});

const VALID_STATUS = new Set(Object.values(HEALTH_STATUS));
const SEVERITY = Object.freeze({ healthy: 1, unknown: 2, degraded: 3, unavailable: 4 });
const MAX_COMPONENTS = 128;
const MAX_METRICS = 64;

function boundedString(value, name, max = 512) {
  const result = String(value ?? '').trim();
  if (!result || result.length > max) throw new TypeError(`${name} must be a non-empty bounded string`);
  return result;
}

function normalizeMetrics(metrics) {
  if (metrics == null) return Object.freeze({});
  if (!metrics || typeof metrics !== 'object' || Array.isArray(metrics)) throw new TypeError('health metrics must be an object');
  const entries = Object.entries(metrics);
  if (entries.length > MAX_METRICS) throw new RangeError('too many health metrics');
  const result = {};
  for (const [key, value] of entries) {
    boundedString(key, 'metric name', 128);
    if (typeof value !== 'number' && typeof value !== 'boolean' && typeof value !== 'string' && value != null) {
      throw new TypeError(`health metric ${key} has an unsupported value`);
    }
    if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError(`health metric ${key} must be finite`);
    if (typeof value === 'string' && value.length > 256) throw new RangeError(`health metric ${key} is too long`);
    result[key] = value;
  }
  return Object.freeze(result);
}

export function createHealthMonitor({
  realmId = null,
  branchId = null,
  now = () => Date.now(),
  logger = () => {},
} = {}) {
  if (typeof now !== 'function' || typeof logger !== 'function') throw new TypeError('invalid health monitor hooks');
  return {
    realmId,
    branchId,
    now,
    logger,
    components: new Map(),
    subscribers: new Set(),
    sequence: 0,
  };
}

export function recordHealthComponent(monitor, componentId, {
  status,
  reason = null,
  metrics = {},
  ttlMs = 60_000,
} = {}) {
  const id = boundedString(componentId, 'componentId');
  if (!VALID_STATUS.has(status)) throw new TypeError(`invalid health status: ${status}`);
  if (!Number.isFinite(ttlMs) || ttlMs <= 0 || ttlMs > 24 * 60 * 60 * 1000) throw new RangeError('invalid health ttlMs');
  if (!monitor.components.has(id) && monitor.components.size >= MAX_COMPONENTS) throw new RangeError('health component limit reached');
  const observedAt = monitor.now();
  const record = Object.freeze({
    componentId: id,
    status,
    reason: reason == null ? null : boundedString(reason, 'health reason', 512),
    metrics: normalizeMetrics(metrics),
    observedAt,
    expiresAt: observedAt + ttlMs,
  });
  monitor.components.set(id, record);
  monitor.logger({
    component: 'realm-health',
    event: 'component.updated',
    level: status === HEALTH_STATUS.UNAVAILABLE ? 'error' : status === HEALTH_STATUS.DEGRADED ? 'warn' : 'debug',
    at: observedAt,
    realmId: monitor.realmId,
    branchId: monitor.branchId,
    componentId: id,
    status,
    reason: record.reason,
  });
  for (const subscriber of monitor.subscribers) subscriber(record);
  return record;
}

export function removeHealthComponent(monitor, componentId) {
  return monitor.components.delete(componentId);
}

export function subscribeHealth(monitor, subscriber) {
  if (typeof subscriber !== 'function') throw new TypeError('health subscriber must be a function');
  monitor.subscribers.add(subscriber);
  return () => monitor.subscribers.delete(subscriber);
}

export function buildHealthSnapshotV1(monitor) {
  const now = monitor.now();
  const components = [];
  for (const record of monitor.components.values()) {
    components.push(record.expiresAt <= now
      ? Object.freeze({ ...record, status: HEALTH_STATUS.UNKNOWN, reason: 'observation-expired' })
      : record);
  }
  components.sort((a, b) => a.componentId.localeCompare(b.componentId));
  let aggregate = components.length ? HEALTH_STATUS.HEALTHY : HEALTH_STATUS.UNKNOWN;
  for (const component of components) {
    if (SEVERITY[component.status] > SEVERITY[aggregate]) aggregate = component.status;
  }
  monitor.sequence += 1;
  const reasons = components
    .filter((component) => component.status !== HEALTH_STATUS.HEALTHY && component.reason)
    .map((component) => Object.freeze({ componentId: component.componentId, reason: component.reason }));
  return Object.freeze({
    schema: HEALTH_SCHEMA,
    version: 1,
    realmId: monitor.realmId,
    branchId: monitor.branchId,
    sequence: monitor.sequence,
    status: aggregate,
    observedAt: now,
    components: Object.freeze(components),
    reasons: Object.freeze(reasons),
  });
}

/** Record a RealmLink snapshot without exposing identities, keys, or payloads. */
export function observeRealmLinkHealth(monitor, linkSnapshot, { ttlMs = 30_000 } = {}) {
  const state = linkSnapshot?.state ?? 'unknown';
  const status = state === 'connected'
    ? HEALTH_STATUS.HEALTHY
    : ['handshaking', 'migrating', 'reconnecting'].includes(state)
      ? HEALTH_STATUS.DEGRADED
      : state === 'closed'
        ? HEALTH_STATUS.UNAVAILABLE
        : HEALTH_STATUS.UNKNOWN;
  return recordHealthComponent(monitor, 'realm-link', {
    status,
    reason: status === HEALTH_STATUS.HEALTHY ? null : `link-${state}`,
    ttlMs,
    metrics: {
      sessionEpoch: linkSnapshot?.sessionEpoch ?? 0,
      sentSequence: linkSnapshot?.lastSentSequence ?? 0,
      remoteSequence: linkSnapshot?.replay?.maxSequence ?? 0,
      transportKind: linkSnapshot?.activeTransport?.kind ?? null,
    },
  });
}

export function observeDiscoveryHealth(monitor, providerStatuses, { ttlMs = 60_000 } = {}) {
  const statuses = Array.isArray(providerStatuses) ? providerStatuses : [];
  const healthy = statuses.filter((item) => item.ok === true).length;
  const failed = statuses.filter((item) => item.ok === false).length;
  const status = healthy > 0
    ? (failed > 0 ? HEALTH_STATUS.DEGRADED : HEALTH_STATUS.HEALTHY)
    : (failed > 0 ? HEALTH_STATUS.UNAVAILABLE : HEALTH_STATUS.UNKNOWN);
  return recordHealthComponent(monitor, 'discovery', {
    status,
    reason: failed > 0 ? (healthy > 0 ? 'some-providers-failed' : 'all-providers-failed') : null,
    ttlMs,
    metrics: { providerCount: statuses.length, healthyProviders: healthy, failedProviders: failed },
  });
}

export function observePresenceHealth(monitor, { activeActors = 0, rejected = 0, sequenceGaps = 0 } = {}, { ttlMs = 60_000 } = {}) {
  const status = rejected > 0 || sequenceGaps > 0 ? HEALTH_STATUS.DEGRADED : HEALTH_STATUS.HEALTHY;
  return recordHealthComponent(monitor, 'presence', {
    status,
    reason: rejected > 0 ? 'presence-rejections' : sequenceGaps > 0 ? 'presence-sequence-gaps' : null,
    ttlMs,
    metrics: { activeActors, rejected, sequenceGaps },
  });
}
