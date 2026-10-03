// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// state/resonance/ResonanceVector.js — build + compare resonance signatures and
// snap to the nearest attractor by SIMILARITY.
//
// Layer law: "resonance suggests". This module reports closeness; it never
// decides identity (hash) or meaning (symbolicSig) or truth (commit). Two
// patterns can be near in resonance yet mean opposites (potion vs poison) —
// callers must still check symbolicSig / hash / constraints before trusting.

import { walshHadamard, pattern3x3ToVector, dct2D } from './Transforms.js';

/** Resonance vector for a tiny 3x3 pattern (Walsh/Hadamard; integer-exact). */
export function resonanceWHT(id) {
  return Array.from(walshHadamard(pattern3x3ToVector(id)));
}

/** Resonance vector for an NxN visual block (DCT-II). */
export function resonanceDCT(block, N) {
  return Array.from(dct2D(block, N));
}

function dot(a, b) { let s = 0; const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) s += a[i] * b[i]; return s; }
function norm(a) { return Math.sqrt(dot(a, a)); }

/** Cosine similarity in [-1, 1] (1 = identical direction). 0 if either is null. */
export function cosineSimilarity(a, b) {
  const na = norm(a), nb = norm(b);
  if (na === 0 || nb === 0) return 0;
  return dot(a, b) / (na * nb);
}

/** Euclidean (L2) distance between two equal-length vectors. */
export function l2Distance(a, b) {
  let s = 0; const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) { const d = (a[i] ?? 0) - (b[i] ?? 0); s += d * d; }
  return Math.sqrt(s);
}

/**
 * Nearest attractor by similarity. metric 'cosine' (higher score = closer) or
 * 'l2' (score = negative distance so higher is always closer).
 * @returns {{ index:number, score:number }|null}
 */
export function nearestAttractor(vec, attractors, { metric = 'cosine' } = {}) {
  let best = null, bestScore = -Infinity;
  for (let i = 0; i < attractors.length; i++) {
    const score = metric === 'l2' ? -l2Distance(vec, attractors[i]) : cosineSimilarity(vec, attractors[i]);
    if (score > bestScore) { bestScore = score; best = i; }
  }
  return best === null ? null : { index: best, score: bestScore };
}
