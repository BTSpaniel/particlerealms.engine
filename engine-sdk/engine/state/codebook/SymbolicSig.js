// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// state/codebook/SymbolicSig.js — symbolic *meaning* via prime INDICES.
//
// Layer law: "Primes = symbolic meaning". We never multiply giant prime
// products at runtime (that would be slow and pretend to be storage). A
// symbolic signature is just a sorted set of prime indices; identity stays in
// hashes, speed stays in dense ids. Two things that look alike (resonance) can
// still mean opposite things — meaning is checked HERE, not by similarity.

import { hashU32Sequence } from '../util/hashing.js';

// First 64 primes — enough symbolic atoms for an initial vocabulary; extend as
// the meaning dictionary grows (it is versioned with the codebook).
export const PRIME_TABLE = Object.freeze([
  2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53,
  59, 61, 67, 71, 73, 79, 83, 89, 97, 101, 103, 107, 109, 113, 127, 131,
  137, 139, 149, 151, 157, 163, 167, 173, 179, 181, 191, 193, 197, 199, 211, 223,
  227, 229, 233, 239, 241, 251, 257, 263, 269, 271, 277, 281, 283, 293, 307, 311,
]);

/** Prime value for a given index (bounds-checked). */
export function primeAt(index) {
  const i = index | 0;
  if (i < 0 || i >= PRIME_TABLE.length) {
    throw new RangeError(`SymbolicSig: prime index ${index} out of range 0..${PRIME_TABLE.length - 1}`);
  }
  return PRIME_TABLE[i];
}

/**
 * Build a symbolic signature: a sorted, de-duplicated vector of prime indices.
 * @param {Iterable<number>} primeIndices
 * @returns {{ indices: number[], hash: number }}
 */
export function symbolicSig(primeIndices) {
  const indices = [...new Set(Array.from(primeIndices, (n) => n | 0))]
    .filter((n) => n >= 0 && n < PRIME_TABLE.length)
    .sort((a, b) => a - b);
  return Object.freeze({ indices: Object.freeze(indices), hash: hashU32Sequence(indices) >>> 0 });
}

/** Meaning equality — compares index sets, NEVER products. */
export function sigEquals(a, b) {
  if (!a || !b || a.indices.length !== b.indices.length) return false;
  for (let i = 0; i < a.indices.length; i++) if (a.indices[i] !== b.indices[i]) return false;
  return true;
}

/** True if `sub`'s meanings are all present in `sig` (symbolic containment). */
export function sigContains(sig, sub) {
  if (!sig || !sub) return false;
  const set = new Set(sig.indices);
  return sub.indices.every((i) => set.has(i));
}
