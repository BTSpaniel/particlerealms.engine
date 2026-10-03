// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Explicit runtime bridge between authoritative simulation state and the
 * State-First presentation policy.
 *
 * The bridge deliberately does not guess GPU layouts or invent renderable
 * entities from arbitrary objects. A source must publish the V1 protocol,
 * provide semantic presentation entities, and consume the resulting plan.
 * GPU sources additionally prove that their active byte range fits in the
 * authoritative GPUBuffer on every update, which makes ping-pong buffers and
 * capacity growth safe to expose without readback.
 */

export const STATE_FIRST_SOURCE = Symbol.for('particle-realms.state-first-source');
export const STATE_FIRST_SOURCE_VERSION = 'state-first-source-v1';
export const STATE_FIRST_SOURCE_KIND = Object.freeze({
  CPU_ENTITIES: 'cpu-entities',
  GPU_BUFFER: 'gpu-buffer',
  GPU_RANGES: 'gpu-ranges',
});

const DEFAULT_MAX_PRESENTATION_ENTITIES = 65_536;

function finiteInteger(value, label, minimum = 0) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum) {
    throw new RangeError(`${label} must be a safe integer >= ${minimum}`);
  }
  return number;
}

function requiredFunction(value, label) {
  if (typeof value !== 'function') throw new TypeError(`${label} must be a function`);
  return value;
}

function nonemptyString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} must be a nonempty string`);
  return value.trim();
}

function providerValue(owner, value) {
  return typeof value === 'function' ? value.call(owner) : value;
}

function descriptorFrom(candidate) {
  if (!candidate || typeof candidate !== 'object') {
    throw new TypeError('State-First source candidates must be objects');
  }
  let descriptor = candidate;
  if (STATE_FIRST_SOURCE in candidate) descriptor = providerValue(candidate, candidate[STATE_FIRST_SOURCE]);
  else if (typeof candidate.getStateFirstSourceDescriptor === 'function') {
    descriptor = candidate.getStateFirstSourceDescriptor();
  }
  if (!descriptor || typeof descriptor !== 'object') {
    throw new TypeError('State-First source discovery must return a descriptor object');
  }
  return { owner: candidate, descriptor };
}

function entitiesProvider(owner, descriptor) {
  if (typeof descriptor.getEntities === 'function') return () => descriptor.getEntities.call(owner);
  if (descriptor.entities != null) return () => providerValue(owner, descriptor.entities);
  throw new TypeError('State-First sources must expose getEntities() or entities');
}

function countProvider(owner, descriptor, required) {
  if (typeof descriptor.getCount === 'function') return () => descriptor.getCount.call(owner);
  if (descriptor.count != null) return () => providerValue(owner, descriptor.count);
  if (required) throw new TypeError('GPU State-First sources must expose getCount() or count');
  return null;
}

function bufferProvider(owner, descriptor) {
  if (typeof descriptor.getBuffer === 'function') return () => descriptor.getBuffer.call(owner);
  if (descriptor.buffer != null) return () => providerValue(owner, descriptor.buffer);
  throw new TypeError('GPU State-First sources must expose getBuffer() or buffer');
}

function rangesProvider(owner, descriptor) {
  if (typeof descriptor.getRanges === 'function') return () => descriptor.getRanges.call(owner);
  if (descriptor.ranges != null) return () => providerValue(owner, descriptor.ranges);
  throw new TypeError('Paged GPU State-First sources must expose getRanges() or ranges');
}

function normalizeDescriptor(candidate, maximumPresentationEntities) {
  const { owner, descriptor } = descriptorFrom(candidate);
  if (descriptor.version !== STATE_FIRST_SOURCE_VERSION) {
    throw new RangeError(`State-First source version must be '${STATE_FIRST_SOURCE_VERSION}'`);
  }
  const id = nonemptyString(descriptor.id, 'State-First source id');
  const kind = nonemptyString(descriptor.kind, `State-First source '${id}' kind`);
  if (!Object.values(STATE_FIRST_SOURCE_KIND).includes(kind)) {
    throw new RangeError(`State-First source '${id}' has unsupported kind '${kind}'`);
  }
  const getEntities = entitiesProvider(owner, descriptor);
  const apply = requiredFunction(descriptor.apply, `State-First source '${id}' apply`);
  const getCount = countProvider(owner, descriptor, kind === STATE_FIRST_SOURCE_KIND.GPU_BUFFER);
  const normalized = {
    id,
    kind,
    owner,
    getEntities,
    getCount,
    apply: decision => apply.call(owner, decision),
    maximumPresentationEntities,
    format: descriptor.format == null ? null : nonemptyString(descriptor.format, `State-First source '${id}' format`),
  };
  if (kind === STATE_FIRST_SOURCE_KIND.GPU_BUFFER) {
    normalized.getBuffer = bufferProvider(owner, descriptor);
    normalized.strideBytes = finiteInteger(descriptor.strideBytes, `State-First source '${id}' strideBytes`, 4);
    normalized.offsetBytes = finiteInteger(descriptor.offsetBytes ?? 0, `State-First source '${id}' offsetBytes`);
    if ((normalized.strideBytes & 3) !== 0 || (normalized.offsetBytes & 3) !== 0) {
      throw new RangeError(`State-First source '${id}' GPU ranges must be four-byte aligned`);
    }
  } else if (kind === STATE_FIRST_SOURCE_KIND.GPU_RANGES) {
    normalized.getRanges = rangesProvider(owner, descriptor);
    normalized.strideBytes = descriptor.strideBytes == null
      ? null
      : finiteInteger(descriptor.strideBytes, `State-First source '${id}' strideBytes`, 4);
    normalized.offsetBytes = finiteInteger(descriptor.offsetBytes ?? 0, `State-First source '${id}' offsetBytes`);
    if ((normalized.strideBytes != null && (normalized.strideBytes & 3) !== 0)
      || (normalized.offsetBytes & 3) !== 0) {
      throw new RangeError(`State-First source '${id}' GPU ranges must be four-byte aligned`);
    }
  }
  return normalized;
}

function snapshotEntities(source) {
  const value = source.getEntities();
  if (value == null || typeof value === 'string' || typeof value[Symbol.iterator] !== 'function') {
    throw new TypeError(`State-First source '${source.id}' entities must be iterable`);
  }
  const records = [];
  const ids = new Set();
  for (const entity of value) {
    if (!entity || typeof entity !== 'object') {
      throw new TypeError(`State-First source '${source.id}' contains a non-object presentation entity`);
    }
    const id = entity.id ?? entity.entityId ?? entity.key;
    if (id == null || (typeof id !== 'string' && typeof id !== 'number')
      || (typeof id === 'number' && !Number.isFinite(id))) {
      throw new TypeError(`State-First source '${source.id}' presentation entities require stable ids`);
    }
    const identity = `${typeof id}:${String(id)}`;
    if (ids.has(identity)) throw new RangeError(`State-First source '${source.id}' contains duplicate entity id '${identity}'`);
    ids.add(identity);
    records.push({
      id,
      entity: {
        ...entity,
        // StateFirstRasterizer retains temporal visibility by id. Namespace the
        // internal identity so two independent sources may both use id 0.
        id: JSON.stringify([source.id, typeof id, id]),
      },
    });
    if (records.length > source.maximumPresentationEntities) {
      throw new RangeError(`State-First source '${source.id}' exceeds its ${source.maximumPresentationEntities} presentation-entity limit`);
    }
  }
  return records;
}

function liveGpuRange(source, rawRange, index) {
  if (!rawRange || typeof rawRange !== 'object') {
    throw new TypeError(`State-First source '${source.id}' GPU range ${index} must be an object`);
  }
  const buffer = providerValue(source.owner, rawRange.buffer);
  const bufferSize = Number(buffer?.size);
  if (!buffer || !Number.isSafeInteger(bufferSize) || bufferSize < 0) {
    throw new TypeError(`State-First source '${source.id}' GPU range ${index} has no live GPUBuffer-like resource`);
  }
  const count = finiteInteger(
    providerValue(source.owner, rawRange.count ?? rawRange.activeCount),
    `State-First source '${source.id}' GPU range ${index} count`,
  );
  const strideBytes = finiteInteger(
    providerValue(source.owner, rawRange.strideBytes ?? rawRange.stride) ?? source.strideBytes,
    `State-First source '${source.id}' GPU range ${index} strideBytes`,
    4,
  );
  const offsetBytes = finiteInteger(
    providerValue(source.owner, rawRange.offsetBytes ?? rawRange.byteOffset) ?? source.offsetBytes,
    `State-First source '${source.id}' GPU range ${index} offsetBytes`,
  );
  if ((strideBytes & 3) !== 0 || (offsetBytes & 3) !== 0) {
    throw new RangeError(`State-First source '${source.id}' GPU range ${index} must be four-byte aligned`);
  }
  const byteLength = count * strideBytes;
  if (!Number.isSafeInteger(byteLength) || offsetBytes + byteLength > bufferSize) {
    throw new RangeError(`State-First source '${source.id}' GPU range ${index} exceeds its authoritative GPU buffer`);
  }
  const capacityValue = providerValue(source.owner, rawRange.capacity);
  const capacity = capacityValue == null
    ? Math.floor((bufferSize - offsetBytes) / strideBytes)
    : finiteInteger(capacityValue, `State-First source '${source.id}' GPU range ${index} capacity`);
  if (capacity < count || offsetBytes + capacity * strideBytes > bufferSize) {
    throw new RangeError(`State-First source '${source.id}' GPU range ${index} capacity is inconsistent with its buffer`);
  }
  return Object.freeze({
    id: rawRange.id == null ? index : String(rawRange.id),
    index,
    count,
    capacity,
    byteLength,
    bufferSize,
    offsetBytes,
    strideBytes,
    role: rawRange.role == null ? null : String(rawRange.role),
    tier: rawRange.tier == null ? null : String(rawRange.tier),
    format: rawRange.format == null ? source.format : String(rawRange.format),
  });
}

function authoritativeEvidence(source, presentationCount) {
  if (source.kind === STATE_FIRST_SOURCE_KIND.CPU_ENTITIES) {
    const count = source.getCount == null
      ? presentationCount
      : finiteInteger(source.getCount(), `State-First source '${source.id}' count`);
    return Object.freeze({ kind: source.kind, count, byteLength: null, strideBytes: null, format: source.format });
  }
  if (source.kind === STATE_FIRST_SOURCE_KIND.GPU_RANGES) {
    const value = source.getRanges();
    if (value == null || typeof value === 'string' || typeof value[Symbol.iterator] !== 'function') {
      throw new TypeError(`State-First source '${source.id}' GPU ranges must be iterable`);
    }
    const ranges = [];
    let count = 0;
    let byteLength = 0;
    let bufferSize = 0;
    for (const rawRange of value) {
      const range = liveGpuRange(source, rawRange, ranges.length);
      ranges.push(range);
      count += range.count;
      byteLength += range.byteLength;
      bufferSize += range.bufferSize;
      if (!Number.isSafeInteger(count) || !Number.isSafeInteger(byteLength) || !Number.isSafeInteger(bufferSize)) {
        throw new RangeError(`State-First source '${source.id}' GPU range totals exceed safe integer precision`);
      }
    }
    if (source.getCount != null) {
      const declaredCount = finiteInteger(source.getCount(), `State-First source '${source.id}' count`);
      if (declaredCount !== count) {
        throw new RangeError(`State-First source '${source.id}' count does not match its authoritative GPU ranges`);
      }
    }
    return Object.freeze({
      kind: source.kind,
      count,
      byteLength,
      bufferSize,
      rangeCount: ranges.length,
      ranges: Object.freeze(ranges),
      format: source.format,
    });
  }
  const buffer = source.getBuffer();
  const bufferSize = Number(buffer?.size);
  if (!buffer || !Number.isSafeInteger(bufferSize) || bufferSize < 0) {
    throw new TypeError(`State-First source '${source.id}' did not provide a live GPUBuffer-like resource with a finite size`);
  }
  const count = finiteInteger(source.getCount(), `State-First source '${source.id}' count`);
  const byteLength = count * source.strideBytes;
  if (!Number.isSafeInteger(byteLength) || source.offsetBytes + byteLength > bufferSize) {
    throw new RangeError(`State-First source '${source.id}' active range exceeds its authoritative GPU buffer`);
  }
  return Object.freeze({
    kind: source.kind,
    count,
    byteLength,
    bufferSize,
    offsetBytes: source.offsetBytes,
    strideBytes: source.strideBytes,
    format: source.format,
  });
}

function freezeDecision(decision) {
  return Object.freeze({
    ...decision,
    evidence: Object.freeze({
      ...decision.evidence,
      ranges: decision.evidence.ranges == null ? undefined : Object.freeze([...decision.evidence.ranges]),
    }),
    entries: Object.freeze(decision.entries.map(entry => Object.freeze({ ...entry }))),
    counts: Object.freeze({ ...decision.counts }),
    names: Object.freeze({ ...decision.names }),
    policy: decision.policy == null ? null : Object.freeze({ ...decision.policy }),
  });
}

export function discoverStateFirstSource(candidate) {
  try {
    const { descriptor } = descriptorFrom(candidate);
    return descriptor.version === STATE_FIRST_SOURCE_VERSION ? descriptor : null;
  } catch {
    return null;
  }
}

export class StateFirstSourceBridge {
  constructor(rasterizer, options = {}) {
    if (!rasterizer || typeof rasterizer !== 'object'
      || typeof rasterizer.isStateFirstEnabled !== 'function'
      || typeof rasterizer.planRenderBuckets !== 'function') {
      throw new TypeError('StateFirstSourceBridge requires a compatible StateFirstRasterizer');
    }
    this.rasterizer = rasterizer;
    this.maximumPresentationEntities = finiteInteger(
      options.maximumPresentationEntities ?? DEFAULT_MAX_PRESENTATION_ENTITIES,
      'State-First maximum presentation entities',
      1,
    );
    this.sources = new Map();
    this.lastStats = Object.freeze({ sourceCount: 0, authoritativeCount: 0, presentationCount: 0, enabled: false });
    this.onChange = typeof options.onChange === 'function' ? options.onChange : null;
  }

  register(candidate) {
    const source = normalizeDescriptor(candidate, this.maximumPresentationEntities);
    if (this.sources.has(source.id)) throw new RangeError(`State-First source '${source.id}' is already registered`);
    this.sources.set(source.id, source);
    this._invalidateMeasurements();
    this.onChange?.(this.getStats());
    let attached = true;
    return () => {
      if (!attached) return false;
      attached = false;
      return this.unregister(source.id);
    };
  }

  unregister(id) {
    const removed = this.sources.delete(String(id));
    if (removed) {
      this._invalidateMeasurements();
      this.onChange?.(this.getStats());
    }
    return removed;
  }

  _invalidateMeasurements() {
    this.lastStats = Object.freeze({
      sourceCount: this.sources.size,
      authoritativeCount: null,
      presentationCount: null,
      enabled: this.rasterizer?.isStateFirstEnabled?.() === true,
      profile: 'pending',
    });
  }

  clear() {
    const count = this.sources.size;
    this.sources.clear();
    this.lastStats = Object.freeze({ sourceCount: 0, authoritativeCount: 0, presentationCount: 0, enabled: false });
    if (count) this.onChange?.(this.getStats());
    return count;
  }

  hasSources() {
    return this.sources.size > 0;
  }

  update(options = {}) {
    const snapshots = [];
    const allEntities = [];
    let authoritativeCount = 0;
    for (const source of this.sources.values()) {
      const records = snapshotEntities(source);
      const evidence = authoritativeEvidence(source, records.length);
      if (evidence.count > 0 && records.length === 0) {
        throw new RangeError(`State-First source '${source.id}' has authoritative state but no semantic presentation entities`);
      }
      authoritativeCount += evidence.count;
      if (!Number.isSafeInteger(authoritativeCount)) {
        throw new RangeError('State-First authoritative source total exceeds safe integer precision');
      }
      snapshots.push({ source, evidence, records });
      for (const record of records) allEntities.push(record.entity);
    }

    const enabled = this.rasterizer.isStateFirstEnabled();
    if (enabled && options.metrics && typeof this.rasterizer.updateFrameMetrics === 'function') {
      this.rasterizer.updateFrameMetrics({ ...options.metrics, entityCount: authoritativeCount });
    }
    const plan = enabled
      ? this.rasterizer.planRenderBuckets(allEntities, {
        ...options,
        // A source applies one decision per semantic entity. Cluster expansion,
        // proxy substitution, and retained-clean omission would replace or
        // remove those identities and make the callback ambiguous.
        metrics: undefined,
        expandClusters: false,
        skipCleanEntities: false,
        spatialProxy: false,
      })
      : null;
    const representations = new Map();
    if (plan) {
      for (const [representation, bucket] of Object.entries(plan.buckets || {})) {
        for (const entity of bucket) representations.set(entity, Number(representation));
      }
    }

    const decisions = [];
    for (const snapshot of snapshots) {
      const counts = {};
      let renderQuota = 0;
      let stateOnlyQuota = 0;
      let culledQuota = 0;
      const entries = snapshot.records.map(({ id, entity }) => {
        const representation = enabled
          ? (representations.get(entity) ?? 0)
          : (entity.currentRepresentation ?? entity.proxyRepresentation ?? null);
        if (representation != null) counts[representation] = (counts[representation] || 0) + 1;
        if (!enabled || representation == null || representation > 1) renderQuota += 1;
        else if (representation === 1) stateOnlyQuota += 1;
        else culledQuota += 1;
        return {
          id,
          role: entity.role ?? null,
          representation,
          representationName: representation == null ? 'native' : (options.names?.[representation] || String(representation)),
          culled: enabled && representation === 0,
        };
      });
      const decision = freezeDecision({
        sourceId: snapshot.source.id,
        enabled,
        evidence: snapshot.evidence,
        entries,
        counts,
        names: options.names || {},
        policy: plan?.policy || null,
        profile: plan?.policy?.profile || (enabled ? 'unknown' : 'native'),
        renderQuota,
        renderFraction: entries.length ? renderQuota / entries.length : 1,
        stateOnlyQuota,
        culledQuota,
      });
      snapshot.source.apply(decision);
      decisions.push(decision);
    }
    this.lastStats = Object.freeze({
      sourceCount: this.sources.size,
      authoritativeCount,
      presentationCount: allEntities.length,
      enabled,
      profile: plan?.policy?.profile || (enabled ? 'unknown' : 'native'),
    });
    return Object.freeze({
      enabled,
      decisions: Object.freeze(decisions),
      plan,
      stats: this.lastStats,
    });
  }

  getStats() {
    return Object.freeze({ ...this.lastStats, sourceCount: this.sources.size });
  }

  destroy() {
    this.clear();
    this.rasterizer = null;
    this.onChange = null;
  }
}

export function createStateFirstSourceBridge(rasterizer, options) {
  return new StateFirstSourceBridge(rasterizer, options);
}

export default createStateFirstSourceBridge;
