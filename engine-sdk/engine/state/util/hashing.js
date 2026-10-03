// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// state/util/hashing.js — canonical, order-independent identity hashing for the
// URC fact/state layers. Reuses the engine's deterministic ChecksumMath rather
// than rolling new hashes (layer law: "hash = identity", nothing more).

import {
  FNV1A32_OFFSET_BASIS,
  fnv1aStringCodeUnit32,
  fnv1aUint32Sequence32,
  legacyAvalancheMixUint32Hash32,
  checksumHex32,
  hexTailUint32,
} from '../../core/math/ChecksumMath.js';

/** Deterministic 32-bit hash of a single string fact. */
export function hashFactString(value) {
  return fnv1aStringCodeUnit32(String(value)) >>> 0;
}

/** Deterministic 32-bit hash of an ordered sequence of uint32 (e.g. a packed pattern). */
export function hashU32Sequence(values) {
  return fnv1aUint32Sequence32(values) >>> 0;
}

/**
 * Canonical, ORDER-INDEPENDENT hash of a set of facts. Facts are stringified,
 * de-duplicated and sorted so that {A,B} and {B,A} collapse to the same id —
 * this is what makes `State.id = hash(canonicalFacts)` sequence-free.
 * @param {Iterable<string>} facts
 * @returns {number} unsigned 32-bit state id
 */
export function canonicalSetHash(facts) {
  const sorted = [...new Set(Array.from(facts, String))].sort();
  let h = FNV1A32_OFFSET_BASIS >>> 0;
  for (const f of sorted) {
    h = legacyAvalancheMixUint32Hash32(h, fnv1aStringCodeUnit32(f) >>> 0) >>> 0;
  }
  return h >>> 0;
}

/** Stable hex fingerprint for an unsigned 32-bit value (cold-path display/keys). */
export function hexId(value) {
  return checksumHex32(value >>> 0);
}

/** Parse a tagged hash id's low 32-bit hex tail for deterministic bucketing/seeding. */
export function hashIdTailUint32(hashId, fallback = 0) {
  return hexTailUint32(String(hashId ?? '').split(':').pop(), fallback);
}
