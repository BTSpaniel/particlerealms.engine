// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// state/codebook/PatternCodebook.js — Phase 1 of the URC pipeline:
//   raw 3x3 block -> 9-bit exact id -> canonical (rotations/flips) -> dense id
//   + hash id + nearest legal attractor (Hamming distance).
//
// This is the smallest stable codebook. Bigger blocks (8x8 DCT, 32x32 wavelets)
// plug into the resonance layer later; the contract here is: a raw pattern maps
// deterministically to a stable codebook entry.

import { hexId } from '../util/hashing.js';

export const PATTERN_W = 3;
export const PATTERN_H = 3;
export const PATTERN_BITS = PATTERN_W * PATTERN_H; // 9
export const PATTERN_COUNT = 1 << PATTERN_BITS;    // 512

// ── Pack / unpack ────────────────────────────────────────────────────────────

/** Pack a length-9 array of truthy/0 cells (row-major) into a 9-bit id (0..511). */
export function packPattern(cells) {
  let id = 0;
  for (let i = 0; i < PATTERN_BITS; i++) if (cells[i]) id |= (1 << i);
  return id & (PATTERN_COUNT - 1);
}

/** Unpack a 9-bit id back into a length-9 Uint8Array (row-major). */
export function unpackPattern(id) {
  const out = new Uint8Array(PATTERN_BITS);
  for (let i = 0; i < PATTERN_BITS; i++) out[i] = (id >> i) & 1;
  return out;
}

// ── Hamming distance (bit difference) ────────────────────────────────────────

function popcount(v) {
  v = v - ((v >> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >> 2) & 0x33333333);
  return (((v + (v >> 4)) & 0x0f0f0f0f) * 0x01010101) >> 24;
}

/** Number of differing cells between two packed 3x3 patterns. */
export function hammingDistance(a, b) {
  return popcount((a ^ b) & (PATTERN_COUNT - 1));
}

// ── Canonical transforms (dihedral group D4: 4 rotations x 2 flips) ──────────

function transformIndex(id, fn) {
  let out = 0;
  for (let i = 0; i < PATTERN_BITS; i++) {
    if (!((id >> i) & 1)) continue;
    const x = i % PATTERN_W;
    const y = (i / PATTERN_W) | 0;
    const [nx, ny] = fn(x, y);
    out |= (1 << (ny * PATTERN_W + nx));
  }
  return out;
}

const rot90 = (x, y) => [PATTERN_H - 1 - y, x];
const flipH = (x, y) => [PATTERN_W - 1 - x, y];

/** All 8 dihedral symmetries of a packed pattern. */
export function symmetries(id) {
  const out = [];
  let cur = id & (PATTERN_COUNT - 1);
  for (let r = 0; r < 4; r++) {
    out.push(cur);
    out.push(transformIndex(cur, flipH));
    cur = transformIndex(cur, rot90);
  }
  return out;
}

/** Canonical id = smallest packed id over all dihedral symmetries (rotation/flip invariant). */
export function canonicalId(id) {
  let min = PATTERN_COUNT;
  for (const s of symmetries(id)) if (s < min) min = s;
  return min;
}

// ── Codebook (dense id allocator + legal-attractor snap) ─────────────────────

export class PatternCodebook {
  constructor() {
    this._denseByCanonical = new Map(); // canonicalId -> dense runtime id
    this._canonicalByDense = [];        // dense id -> canonicalId
    this._legal = new Set();            // canonical ids accepted as "legal" attractors
  }

  /** Allocate (or fetch) a dense runtime id for a raw pattern's canonical form. */
  denseId(rawId) {
    const c = canonicalId(rawId);
    let dense = this._denseByCanonical.get(c);
    if (dense === undefined) {
      dense = this._canonicalByDense.length;
      this._denseByCanonical.set(c, dense);
      this._canonicalByDense.push(c);
    }
    return dense;
  }

  canonicalForDense(dense) { return this._canonicalByDense[dense]; }
  get size() { return this._canonicalByDense.length; }

  /** Mark a canonical pattern as legal (an attractor that corrupted input may snap to). */
  registerLegal(rawId) {
    const c = canonicalId(rawId);
    this._legal.add(c);
    this.denseId(rawId);
    return c;
  }

  /**
   * Snap a (possibly corrupted) raw pattern to the nearest LEGAL canonical
   * attractor by Hamming distance. Resonance *suggests*; this never asserts
   * truth — callers decide whether to accept (visual) or verify (semantic).
   * @returns {{ canonicalId:number, distance:number, dense:number }|null}
   */
  nearestLegal(rawId) {
    const c = canonicalId(rawId);
    if (this._legal.has(c)) return { canonicalId: c, distance: 0, dense: this.denseId(c) };
    let best = null;
    let bestD = Infinity;
    for (const legal of this._legal) {
      const d = hammingDistance(c, legal);
      if (d < bestD) { bestD = d; best = legal; }
    }
    if (best === null) return null;
    return { canonicalId: best, distance: bestD, dense: this.denseId(best) };
  }
}

/** Stable content fingerprint for a pattern (hash = identity). */
export function patternHashId(rawId) {
  return hexId(canonicalId(rawId));
}
