// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { compareCanonicalStrings } from '../core/serialization.js';
import { SparsePageRuntime } from '../../../core/gpu/SparsePageRuntime.js';

const EPSILON = 1e-12;

function assertFiniteVector(name, value, length) {
  if (!Array.isArray(value) && !ArrayBuffer.isView(value)) throw new TypeError(`${name} must be array-like`);
  if (value.length < length) throw new RangeError(`${name} requires ${length} values`);
  const result = Array.from(value).slice(0, length);
  if (!result.every(Number.isFinite)) throw new RangeError(`${name} must contain finite values`);
  return result;
}

function contains(bounds, point) {
  return point[0] >= bounds[0] && point[0] <= bounds[3]
    && point[1] >= bounds[1] && point[1] <= bounds[4]
    && point[2] >= bounds[2] && point[2] <= bounds[5];
}

function containsBounds(outer, inner) {
  return inner[0] >= outer[0] && inner[3] <= outer[3]
    && inner[1] >= outer[1] && inner[4] <= outer[4]
    && inner[2] >= outer[2] && inner[5] <= outer[5];
}

function brickBytes(brick) {
  return brick.values.byteLength + 128;
}

/** Certified scalar residual brick with deterministic trilinear sampling. */
export class CertifiedResidualBrick {
  constructor(descriptor) {
    if (!descriptor || typeof descriptor !== 'object') throw new TypeError('Residual brick descriptor is required');
    this.key = String(descriptor.key ?? '');
    if (!this.key) throw new Error('Residual brick key is required');
    this.level = descriptor.level >>> 0;
    this.bounds = assertFiniteVector('bounds', descriptor.bounds, 6);
    if (this.bounds[3] <= this.bounds[0] || this.bounds[4] <= this.bounds[1] || this.bounds[5] <= this.bounds[2]) {
      throw new RangeError(`Residual brick ${this.key} has invalid bounds`);
    }
    this.resolution = descriptor.resolution >>> 0;
    if (this.resolution < 2 || this.resolution > 256) throw new RangeError('Residual brick resolution must be in [2, 256]');
    const expected = this.resolution ** 3;
    this.values = descriptor.values instanceof Float32Array
      ? new Float32Array(descriptor.values)
      : Float32Array.from(descriptor.values || []);
    if (this.values.length !== expected) throw new RangeError(`Residual brick ${this.key} expected ${expected} values`);
    for (const value of this.values) if (!Number.isFinite(value)) throw new RangeError(`Residual brick ${this.key} contains non-finite values`);
    const certificate = descriptor.certificate || {};
    this.fieldValueErrorMax = Number(certificate.fieldValueErrorMax);
    this.lipschitzMax = Number(certificate.lipschitzMax);
    if (!Number.isFinite(this.fieldValueErrorMax) || this.fieldValueErrorMax < 0) throw new RangeError('fieldValueErrorMax must be finite and non-negative');
    if (!Number.isFinite(this.lipschitzMax) || this.lipschitzMax <= 0) throw new RangeError('lipschitzMax must be finite and positive');
    this.sourceRevision = descriptor.sourceRevision >>> 0;
    this.certificateRevision = descriptor.certificateRevision >>> 0;
    Object.freeze(this.bounds);
  }

  sample(point) {
    const p = assertFiniteVector('point', point, 3);
    if (!contains(this.bounds, p)) return null;
    const n = this.resolution;
    const sx = ((p[0] - this.bounds[0]) / (this.bounds[3] - this.bounds[0])) * (n - 1);
    const sy = ((p[1] - this.bounds[1]) / (this.bounds[4] - this.bounds[1])) * (n - 1);
    const sz = ((p[2] - this.bounds[2]) / (this.bounds[5] - this.bounds[2])) * (n - 1);
    const x0 = Math.min(n - 2, Math.max(0, Math.floor(sx)));
    const y0 = Math.min(n - 2, Math.max(0, Math.floor(sy)));
    const z0 = Math.min(n - 2, Math.max(0, Math.floor(sz)));
    const tx = Math.min(1, Math.max(0, sx - x0));
    const ty = Math.min(1, Math.max(0, sy - y0));
    const tz = Math.min(1, Math.max(0, sz - z0));
    const at = (x, y, z) => this.values[x + n * (y + n * z)];
    const mix = (a, b, t) => a + (b - a) * t;
    const v00 = mix(at(x0, y0, z0), at(x0 + 1, y0, z0), tx);
    const v10 = mix(at(x0, y0 + 1, z0), at(x0 + 1, y0 + 1, z0), tx);
    const v01 = mix(at(x0, y0, z0 + 1), at(x0 + 1, y0, z0 + 1), tx);
    const v11 = mix(at(x0, y0 + 1, z0 + 1), at(x0 + 1, y0 + 1, z0 + 1), tx);
    return {
      value: mix(mix(v00, v10, ty), mix(v01, v11, ty), tz),
      fieldValueErrorMax: this.fieldValueErrorMax,
      lipschitzMax: this.lipschitzMax,
      level: this.level,
      key: this.key,
    };
  }
}

/**
 * Revisioned, fixed-budget residual residency manager. The coarsest level is
 * pinned, so every accepted source always has a certified fallback.
 */
export class ResidualHierarchy {
  constructor(options = {}) {
    this.byteBudget = Math.max(1024, options.byteBudget ?? (64 * 1024 * 1024));
    this.pageRuntime = new SparsePageRuntime({
      capacity: Math.max(1, Math.floor(Number(options.pageCapacity ?? 65536)) || 65536),
      byteBudget: this.byteBudget,
      requireFallback: true,
      logger: options.logger,
    });
    this.revision = 0;
    this._resident = new Map();
    this._staged = null;
    this._clock = 0;
    this._bytes = 0;
    this._metrics = { hits: 0, misses: 0, coarseFallbacks: 0, evictions: 0, commits: 0 };
  }

  beginRevision(revision) {
    const next = revision >>> 0;
    if (next !== this.revision + 1) throw new Error(`Residual revision ${next} does not follow ${this.revision}`);
    if (this._staged) throw new Error('A residual revision is already staged');
    this._staged = { revision: next, add: new Map(), remove: new Set() };
    this.pageRuntime.beginRevision(next);
  }

  stageBrick(descriptor) {
    if (!this._staged) throw new Error('beginRevision() must precede stageBrick()');
    const brick = descriptor instanceof CertifiedResidualBrick ? descriptor : new CertifiedResidualBrick(descriptor);
    this._staged.add.set(brick.key, brick);
    this._staged.remove.delete(brick.key);
    return brick;
  }

  stageRemove(key) {
    if (!this._staged) throw new Error('beginRevision() must precede stageRemove()');
    const id = String(key);
    this._staged.add.delete(id);
    this._staged.remove.add(id);
  }

  commitRevision() {
    if (!this._staged) throw new Error('No residual revision is staged');
    const next = new Map(this._resident);
    for (const key of this._staged.remove) next.delete(key);
    for (const [key, brick] of this._staged.add) next.set(key, { brick, used: ++this._clock, pinned: false });
    const levels = Array.from(next.values(), (entry) => entry.brick.level);
    if (!levels.length) throw new Error('Residual hierarchy cannot commit without a certified coarse level');
    const coarsest = Math.min(...levels);
    for (const entry of next.values()) entry.pinned = entry.brick.level === coarsest;
    for (const key of this._resident.keys()) {
      if (!next.has(key)) this.pageRuntime.stageRemove(key);
    }
    const currentPages = new Map(this.pageRuntime.snapshot().pages.map(page => [page.key, page]));
    for (const entry of next.values()) {
      const currentPage = currentPages.get(entry.brick.key);
      const fallback = entry.pinned
        ? null
        : Array.from(next.values())
          .filter(candidate => candidate.brick.level < entry.brick.level
            && containsBounds(candidate.brick.bounds, entry.brick.bounds))
          .sort((a, b) => b.brick.level - a.brick.level
            || compareCanonicalStrings(a.brick.key, b.brick.key))[0];
      if (!entry.pinned && !fallback) {
        throw new Error(`Residual brick ${entry.brick.key} has no containing certified fallback`);
      }
      const fallbackKey = fallback?.brick.key ?? null;
      if (currentPage
          && !this._staged.add.has(entry.brick.key)
          && currentPage.pinned === entry.pinned
          && currentPage.fallbackKey === fallbackKey) continue;
      this.pageRuntime.stagePage({
        key: entry.brick.key,
        level: entry.brick.level,
        bytes: brickBytes(entry.brick),
        sourceRevision: entry.brick.sourceRevision,
        certificateRevision: entry.brick.certificateRevision,
        fallbackKey,
        pinned: entry.pinned,
        payload: entry.brick,
      });
    }
    let publication;
    try {
      publication = this.pageRuntime.commitRevision();
    } catch (error) {
      this.pageRuntime.rollbackRevision();
      throw error;
    }
    const publishedByKey = new Map(publication.pages.map(page => [page.key, page]));
    for (const key of Array.from(next.keys())) if (!publishedByKey.has(key)) next.delete(key);
    for (const [key, entry] of next) entry.slot = publishedByKey.get(key).slot;
    this._metrics.evictions = this.pageRuntime.getStats().evictions;
    this._resident = next;
    this._bytes = publication.bytes;
    this.revision = this._staged.revision;
    this._staged = null;
    this._metrics.commits++;
    return this.snapshotPageTable();
  }

  rollbackRevision() {
    this._staged = null;
    this.pageRuntime.rollbackRevision();
  }

  sample(point) {
    const p = assertFiniteVector('point', point, 3);
    const candidates = Array.from(this._resident.values())
      .filter((entry) => contains(entry.brick.bounds, p))
      .sort((a, b) => b.brick.level - a.brick.level
        || compareCanonicalStrings(a.brick.key, b.brick.key));
    if (!candidates.length) {
      this._metrics.misses++;
      return null;
    }
    const entry = candidates[0];
    entry.used = ++this._clock;
    this._metrics.hits++;
    if (entry.pinned && candidates.length === 1) this._metrics.coarseFallbacks++;
    return entry.brick.sample(p);
  }

  setByteBudget(bytes) {
    if (!Number.isSafeInteger(bytes) || bytes < 1024) throw new RangeError('Residual byte budget must be an integer >= 1024');
    this.byteBudget = bytes;
    this.pageRuntime.setBudget({ byteBudget: bytes });
    if (this._resident.size) {
      this.beginRevision(this.revision + 1);
      this.commitRevision();
    }
  }

  snapshotPageTable() {
    return Object.freeze({
      revision: this.revision,
      byteBudget: this.byteBudget,
      bytes: this._bytes,
      pages: Object.freeze(Array.from(this._resident.values())
        .sort((a, b) => a.brick.level - b.brick.level
          || compareCanonicalStrings(a.brick.key, b.brick.key))
        .map((entry) => Object.freeze({
          key: entry.brick.key,
          level: entry.brick.level,
          bounds: entry.brick.bounds.slice(),
          pinned: entry.pinned,
          sourceRevision: entry.brick.sourceRevision,
          certificateRevision: entry.brick.certificateRevision,
          bytes: brickBytes(entry.brick),
          slot: entry.slot,
        }))),
    });
  }

  getStats() {
    return {
      ...this._metrics,
      pages: this._resident.size,
      bytes: this._bytes,
      budget: this.byteBudget,
      revision: this.revision,
      pageRuntime: this.pageRuntime.getStats(),
    };
  }
}

/** Compose analytic and residual surface certificates conservatively. */
export function composeResidualCertificate(analytic, residual) {
  const ae = Number(analytic?.fieldValueErrorMax ?? 0);
  const re = Number(residual?.fieldValueErrorMax ?? 0);
  const al = Number(analytic?.lipschitzMax);
  const rl = Number(residual?.lipschitzMax);
  if (![ae, re, al, rl].every(Number.isFinite) || ae < 0 || re < 0 || al <= EPSILON || rl <= EPSILON) {
    throw new RangeError('Cannot compose invalid analytic/residual certificates');
  }
  return Object.freeze({ fieldValueErrorMax: ae + re, lipschitzMax: al + rl });
}
