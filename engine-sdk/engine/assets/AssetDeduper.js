// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// engine/assets/AssetDeduper.js — content-hash dedup (spec §3).
//
// Assets are deduplicated by source content hash. We separate source / mesh /
// material hashes so that the dedup rules can distinguish exact duplicates from
// variants and conflicts:
//   same source hash               = same source asset (exact duplicate)
//   same name + different hash      = version/conflict
//   same mesh hash + diff material  = variant
//   same texture hash               = shared texture
// Hashing prefers Web Crypto SHA-256; in a non-secure context it falls back to a
// deterministic FNV-1a stamp (clearly tagged so callers know it isn't crypto).

import {
  checksumHex32,
  contentHashHex,
  fnv1a32,
} from '../core/math/ChecksumMath.js';

function contentBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (typeof data === 'string') return new TextEncoder().encode(data);
  return new TextEncoder().encode(JSON.stringify(data));
}

export function assetDeduperFallbackHash(data) {
  return `fnv1a:${checksumHex32(fnv1a32(contentBytes(data)))}`;
}

/**
 * Content hash of arbitrary data. Returns 'sha256:<hex>' (secure) or
 * 'fnv1a:<hex>' (fallback). Async because Web Crypto digest is async.
 * @returns {Promise<string>}
 */
export async function hashContent(data) {
  const bytes = contentBytes(data);
  try {
    return `sha256:${await contentHashHex(bytes, 'SHA-256')}`;
  } catch (_) {
    return assetDeduperFallbackHash(bytes);
  }
}

export const DEDUP = Object.freeze({
  NEW: 'new',
  EXACT_DUPLICATE: 'exact-duplicate',
  CONFLICT: 'conflict',
  VARIANT: 'variant',
});

/**
 * Classify a candidate against the existing records.
 * @param {{sourceHash:string, name:string, meshHash?:string}} candidate
 * @param {Array} records existing AssetRecords
 * @returns {{ kind:string, against:object|null }}
 */
export function classify(candidate, records) {
  const byHash = records.find((r) => r.sourceHash && r.sourceHash === candidate.sourceHash);
  if (byHash) return { kind: DEDUP.EXACT_DUPLICATE, against: byHash };

  const sameMesh = candidate.meshHash
    ? records.find((r) => r.metadata?.meshHash && r.metadata.meshHash === candidate.meshHash)
    : null;
  if (sameMesh) return { kind: DEDUP.VARIANT, against: sameMesh };

  const sameName = records.find((r) => r.name && candidate.name && r.name === candidate.name);
  if (sameName) return { kind: DEDUP.CONFLICT, against: sameName };

  return { kind: DEDUP.NEW, against: null };
}
