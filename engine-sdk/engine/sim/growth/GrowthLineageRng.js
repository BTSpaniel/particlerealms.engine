// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { checksumHex32, fnv1a32 } from '../../core/math/ChecksumMath.js';
import {
  compareGrowthIds,
  failGrowth,
  freezeGrowthJson,
  requireGrowthIdentifier,
  requireGrowthInteger,
  requireGrowthLineage,
} from './GrowthContracts.js';

export const GROWTH_RNG_NON_ZERO_SEED = 0x6d2b79f5;

const TEXT_ENCODER = new TextEncoder();

function hashText32(text) {
  return fnv1a32(TEXT_ENCODER.encode(text)) >>> 0;
}

function lineageDomain(parentLineage, role, ordinal) {
  const parent = parentLineage === null ? null : requireGrowthLineage(parentLineage, 'parentLineage');
  requireGrowthIdentifier(role, 'lineage role', { maximum: 48 });
  const childOrdinal = requireGrowthInteger(ordinal, 'lineage ordinal', { maximum: 0xffffffff });
  if (parent === null) {
    if (childOrdinal !== 0) failGrowth('GROWTH_ROOT_LINEAGE', 'Root lineage ordinal must be zero');
    return 'root';
  }
  return `${parent}/${childOrdinal}`;
}

/** Canonical structural path. It is independent of traversal and collection order. */
export function deriveGrowthLineage(parentLineage, role, ordinal) {
  return requireGrowthLineage(lineageDomain(parentLineage, role, ordinal));
}

/**
 * Compact stable entity ID derived from the complete lineage path. Two domain-
 * separated hashes make accidental collisions materially less likely than the
 * engine's single hot-path state hash while retaining synchronous operation.
 */
export function deriveGrowthEntityId(kind, lineage) {
  const entityKind = requireGrowthIdentifier(kind, 'entity kind', { maximum: 32 });
  const stableLineage = requireGrowthLineage(lineage);
  const first = checksumHex32(hashText32(`growth-id\u0000${entityKind}\u0000${stableLineage}`));
  const second = checksumHex32(hashText32(`growth-id-guard\u0000${stableLineage}\u0000${entityKind}`));
  return requireGrowthIdentifier(`growth.${entityKind}.${first}${second}`, 'derived entity id');
}

export function deriveGrowthStreamSeed({
  assetSeed,
  programId,
  programVersion,
  lineage,
  purpose,
} = {}) {
  const seed = requireGrowthInteger(assetSeed, 'assetSeed', { maximum: 0xffffffff });
  const program = requireGrowthIdentifier(programId, 'programId');
  const version = requireGrowthInteger(programVersion, 'programVersion', { minimum: 1 });
  const stableLineage = requireGrowthLineage(lineage);
  const channel = requireGrowthIdentifier(purpose, 'RNG purpose', { maximum: 80 });
  return hashText32(`${seed}\u0000${program}\u0000${version}\u0000${stableLineage}\u0000${channel}`)
    || GROWTH_RNG_NON_ZERO_SEED;
}

/** Snapshot-capable xorshift32 stream with explicit state and call count. */
export class GrowthDeterministicRng {
  constructor(seedOrSnapshot = GROWTH_RNG_NON_ZERO_SEED) {
    let state;
    let calls = 0;
    if (seedOrSnapshot !== null && typeof seedOrSnapshot === 'object') {
      state = requireGrowthInteger(seedOrSnapshot.state, 'rng.state', { maximum: 0xffffffff });
      calls = requireGrowthInteger(seedOrSnapshot.calls ?? 0, 'rng.calls');
    } else {
      state = requireGrowthInteger(seedOrSnapshot, 'rng.seed', { maximum: 0xffffffff });
    }
    this._state = state || GROWTH_RNG_NON_ZERO_SEED;
    this._calls = calls;
  }

  get state() { return this._state; }
  get calls() { return this._calls; }

  nextUint32() {
    let value = this._state >>> 0;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this._state = value >>> 0 || GROWTH_RNG_NON_ZERO_SEED;
    if (this._calls >= Number.MAX_SAFE_INTEGER) {
      failGrowth('GROWTH_RNG_EXHAUSTED', 'Growth RNG call count exhausted safe integer authority');
    }
    this._calls += 1;
    return this._state;
  }

  nextFloat() {
    return this.nextUint32() / 0x1_0000_0000;
  }

  nextSignedFloat() {
    return this.nextFloat() * 2 - 1;
  }

  nextInteger(minimum, maximum) {
    const min = requireGrowthInteger(minimum, 'rng minimum', { minimum: -0x7fffffff });
    const max = requireGrowthInteger(maximum, 'rng maximum', { minimum: min });
    const span = max - min + 1;
    if (!Number.isSafeInteger(span) || span > 0x1_0000_0000) {
      failGrowth('GROWTH_RNG_RANGE', 'Growth RNG integer range must fit in 32 bits', { minimum: min, maximum: max });
    }
    return min + Math.floor(this.nextFloat() * span);
  }

  snapshot() {
    return freezeGrowthJson({ state: this._state, calls: this._calls }, '$.rng');
  }

  clone() {
    return new GrowthDeterministicRng(this.snapshot());
  }
}

function streamKey(lineage, purpose) {
  return `${requireGrowthLineage(lineage)}\u0000${requireGrowthIdentifier(purpose, 'RNG purpose', { maximum: 80 })}`;
}

export class GrowthRngStreams {
  constructor({ assetSeed, programId, programVersion, snapshots = [] } = {}) {
    this.assetSeed = requireGrowthInteger(assetSeed, 'assetSeed', { maximum: 0xffffffff });
    this.programId = requireGrowthIdentifier(programId, 'programId');
    this.programVersion = requireGrowthInteger(programVersion, 'programVersion', { minimum: 1 });
    if (!Array.isArray(snapshots)) failGrowth('GROWTH_RNG_SNAPSHOTS', 'RNG snapshots must be an array');
    this._streams = new Map();
    for (let index = 0; index < snapshots.length; index++) {
      const snapshot = snapshots[index];
      if (!snapshot || typeof snapshot !== 'object') {
        failGrowth('GROWTH_RNG_SNAPSHOT', `RNG snapshot ${index} must be an object`);
      }
      const lineage = requireGrowthLineage(snapshot.lineage, `rngSnapshots[${index}].lineage`);
      const purpose = requireGrowthIdentifier(snapshot.purpose, `rngSnapshots[${index}].purpose`, { maximum: 80 });
      const key = streamKey(lineage, purpose);
      if (this._streams.has(key)) {
        failGrowth('GROWTH_RNG_DUPLICATE_STREAM', `Duplicate RNG stream ${lineage}/${purpose}`);
      }
      this._streams.set(key, {
        lineage,
        purpose,
        rng: new GrowthDeterministicRng({ state: snapshot.state, calls: snapshot.calls }),
      });
    }
  }

  stream(lineage, purpose) {
    const key = streamKey(lineage, purpose);
    let entry = this._streams.get(key);
    if (!entry) {
      entry = {
        lineage: requireGrowthLineage(lineage),
        purpose: requireGrowthIdentifier(purpose, 'RNG purpose', { maximum: 80 }),
        rng: new GrowthDeterministicRng(deriveGrowthStreamSeed({
          assetSeed: this.assetSeed,
          programId: this.programId,
          programVersion: this.programVersion,
          lineage,
          purpose,
        })),
      };
      this._streams.set(key, entry);
    }
    return entry.rng;
  }

  nextFloat(lineage, purpose) {
    return this.stream(lineage, purpose).nextFloat();
  }

  snapshot() {
    const snapshots = [...this._streams.values()]
      .map(entry => ({ lineage: entry.lineage, purpose: entry.purpose, ...entry.rng.snapshot() }))
      .sort((left, right) => compareGrowthIds(streamKey(left.lineage, left.purpose), streamKey(right.lineage, right.purpose)));
    return freezeGrowthJson(snapshots, '$.rngStreams');
  }

  clone() {
    return new GrowthRngStreams({
      assetSeed: this.assetSeed,
      programId: this.programId,
      programVersion: this.programVersion,
      snapshots: this.snapshot(),
    });
  }
}

export function restoreGrowthRngStreams(state) {
  return new GrowthRngStreams({
    assetSeed: state.seed,
    programId: state.program.id,
    programVersion: state.program.version,
    snapshots: state.rngStreams ?? [],
  });
}
