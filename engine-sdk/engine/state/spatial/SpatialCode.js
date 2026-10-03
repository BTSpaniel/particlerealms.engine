// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// state/spatial/SpatialCode.js — Phase 2: a pattern knows WHERE it belongs.
//
// Layer law: "Morton = hot runtime, Hilbert = cold storage / large chunk
// packing". We reuse the engine's deterministic MathBits curves rather than
// re-deriving them; this module only adds chunk addressing + neighbor lookup
// and the URC contract that spatialID is "where", never "what" or "truth".

import {
  morton2DEncode, morton2DDecode,
  morton3DEncode, morton3DDecode,
  hilbert2DEncode, hilbert2DDecode,
} from '../../core/math/MathBits.js';

// ── Morton (hot path) ────────────────────────────────────────────────────────

/** 2D Morton/Z-order spatial id (16 bits per axis). */
export function spatialId2D(x, y) { return morton2DEncode(x >>> 0, y >>> 0) >>> 0; }
/** Inverse of spatialId2D → [x, y]. */
export function fromSpatialId2D(code) { return morton2DDecode(code >>> 0); }

/** 3D Morton spatial id (10 bits per axis). */
export function spatialId3D(x, y, z) { return morton3DEncode(x >>> 0, y >>> 0, z >>> 0) >>> 0; }
/** Inverse of spatialId3D → [x, y, z]. */
export function fromSpatialId3D(code) { return morton3DDecode(code >>> 0); }

// ── Hilbert (cold path: better locality for storage/streaming) ───────────────

/** Hilbert distance for (x,y) on a 2^k grid of side `n`. */
export function hilbertId2D(n, x, y) { return hilbert2DEncode(n, x >>> 0, y >>> 0); }
/** Inverse of hilbertId2D → [x, y]. */
export function fromHilbertId2D(n, d) { return hilbert2DDecode(n, d); }

// ── Chunk addressing ─────────────────────────────────────────────────────────

/** World coords → chunk coords for a square chunk grid. */
export function chunkCoords2D(x, y, chunkSize) {
  const s = Math.max(1, chunkSize | 0);
  return [Math.floor(x / s), Math.floor(y / s)];
}

/** Stable chunk id (Morton of chunk coords) for GPU-buffer packing + cache locality. */
export function chunkId2D(x, y, chunkSize) {
  const [cx, cy] = chunkCoords2D(x, y, chunkSize);
  return spatialId2D(cx, cy);
}

export function chunkCoords3D(x, y, z, chunkSize) {
  const s = Math.max(1, chunkSize | 0);
  return [Math.floor(x / s), Math.floor(y / s), Math.floor(z / s)];
}
export function chunkId3D(x, y, z, chunkSize) {
  const [cx, cy, cz] = chunkCoords3D(x, y, z, chunkSize);
  return spatialId3D(cx, cy, cz);
}

// ── Neighbor lookup ──────────────────────────────────────────────────────────

const ORTHO_2D = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIAG_2D = [[1, 1], [-1, 1], [1, -1], [-1, -1]];

/**
 * Spatial ids of a cell's neighbors (non-negative coords only).
 * @returns {Array<{ dx:number, dy:number, x:number, y:number, id:number }>}
 */
export function neighbors2D(x, y, { diagonal = false } = {}) {
  const offsets = diagonal ? ORTHO_2D.concat(DIAG_2D) : ORTHO_2D;
  const out = [];
  for (const [dx, dy] of offsets) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0) continue;
    out.push({ dx, dy, x: nx, y: ny, id: spatialId2D(nx, ny) });
  }
  return out;
}
