// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// state/resonance/Transforms.js — Phase 3 transforms.
//
//   Walsh/Hadamard  tiny binary patterns (3x3, 4x4)   [new]
//   DCT-II          small visual blocks (8x8, 16x16)
//
// Scale routing (per the plan): Walsh for tiny binary, DCT for small visual,
// wavelets for 32x32+/3D (added later). These produce the "resonance vector":
// a compressed signature of what a pattern RESEMBLES — never its identity.

import { unpackPattern, PATTERN_BITS } from '../codebook/PatternCodebook.js';

function isPow2(n) { return n > 0 && (n & (n - 1)) === 0; }

// ── Walsh–Hadamard transform (fast, natural order, unnormalized) ─────────────

/**
 * In-place-style fast WHT. Integer input → integer output. Length must be a
 * power of two. WHT(WHT(v)) === n * v (involutive up to the length scale).
 * @param {ArrayLike<number>} input
 * @returns {Float64Array}
 */
export function walshHadamard(input) {
  const n = input.length;
  if (!isPow2(n)) throw new RangeError(`walshHadamard: length ${n} is not a power of two`);
  const a = Float64Array.from(input);
  for (let len = 1; len < n; len <<= 1) {
    for (let i = 0; i < n; i += len << 1) {
      for (let j = i; j < i + len; j++) {
        const x = a[j], y = a[j + len];
        a[j] = x + y;
        a[j + len] = x - y;
      }
    }
  }
  return a;
}

/**
 * Map a packed 3x3 pattern to a length-16 bipolar vector ({0,1} → {-1,+1},
 * zero-padded to the next power of two) ready for the WHT.
 */
export function pattern3x3ToVector(id) {
  const cells = unpackPattern(id);
  const v = new Float64Array(16);
  for (let i = 0; i < PATTERN_BITS; i++) v[i] = cells[i] ? 1 : -1;
  return v;
}

// ── DCT-II / inverse (separable, self-contained) ─────────────────────────────

/** 1-D DCT-II (orthonormal). */
export function dct1D(input) {
  const N = input.length;
  const out = new Float64Array(N);
  for (let k = 0; k < N; k++) {
    let s = 0;
    for (let m = 0; m < N; m++) s += input[m] * Math.cos((Math.PI * (2 * m + 1) * k) / (2 * N));
    out[k] = (k === 0 ? Math.sqrt(1 / N) : Math.sqrt(2 / N)) * s;
  }
  return out;
}

/** 1-D inverse DCT-II (orthonormal). */
export function idct1D(input) {
  const N = input.length;
  const out = new Float64Array(N);
  for (let m = 0; m < N; m++) {
    let s = 0;
    for (let k = 0; k < N; k++) {
      const c = k === 0 ? Math.sqrt(1 / N) : Math.sqrt(2 / N);
      s += c * input[k] * Math.cos((Math.PI * (2 * m + 1) * k) / (2 * N));
    }
    out[m] = s;
  }
  return out;
}

function map2D(block, N, rowFn) {
  const out = new Float64Array(N * N);
  const tmp = new Float64Array(N);
  // rows
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) tmp[c] = block[r * N + c];
    const t = rowFn(tmp);
    for (let c = 0; c < N; c++) out[r * N + c] = t[c];
  }
  // columns
  for (let c = 0; c < N; c++) {
    for (let r = 0; r < N; r++) tmp[r] = out[r * N + c];
    const t = rowFn(tmp);
    for (let r = 0; r < N; r++) out[r * N + c] = t[r];
  }
  return out;
}

/** 2-D DCT-II of an NxN block (row-major Float array of length N*N). */
export function dct2D(block, N) { return map2D(block, N, dct1D); }
/** 2-D inverse DCT-II. */
export function idct2D(block, N) { return map2D(block, N, idct1D); }

/** Quantize a coefficient vector to integers by step `q` (lossy resonance). */
export function quantize(vec, q = 1) {
  const out = new Int32Array(vec.length);
  for (let i = 0; i < vec.length; i++) out[i] = Math.round(vec[i] / q);
  return out;
}
