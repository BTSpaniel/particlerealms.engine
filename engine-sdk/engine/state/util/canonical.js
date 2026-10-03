// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// state/util/canonical.js — deterministic serialization + self-describing,
// algorithm-tagged hash IDs (CSE Integrity plane, spec §13).
//
// Equivalent data MUST produce byte-identical bytes before hashing or signing
// (spec rule 58). We implement an RFC 8785-style canonical JSON: object keys
// are sorted by UTF-16 code unit, arrays keep order, no insignificant
// whitespace, and non-finite numbers are rejected. Hash IDs are multihash-style
// (`alg:bits:hex`) so the algorithm can migrate later (spec rule 59).
//
// Two tiers, matching the engine's hybrid integrity policy:
//   • hot-path id   — synchronous 32-bit FNV (runtime identity / state roots).
//   • authority id  — async Web Crypto SHA-256 (capabilities, receipts,
//                     checkpoints) where security matters.

import {
  checksumHex32,
  contentHashHex,
  fnv1aStringCodeUnit32,
} from '../../core/math/ChecksumMath.js';

/** Domain separator prefix so hashes of different structures never collide. */
export const DOMAIN_SEPARATOR = 'cse';

function canonicalNumber(value) {
  if (!Number.isFinite(value)) throw new TypeError(`canonical: non-finite number ${value}`);
  // Integers serialize without a decimal point; JSON.stringify gives the
  // shortest round-trippable form, which is deterministic for finite numbers.
  return JSON.stringify(value);
}

/**
 * Produce a deterministic canonical JSON string for any JSON-compatible value.
 * Object keys are sorted; Maps and Sets are normalized; arrays preserve order.
 * @param {*} value
 * @returns {string}
 */
export function canonicalize(value) {
  if (value === null || value === undefined) return 'null';
  const t = typeof value;
  if (t === 'number') return canonicalNumber(value);
  if (t === 'boolean') return value ? 'true' : 'false';
  if (t === 'string') return JSON.stringify(value);
  if (t === 'bigint') return JSON.stringify(value.toString());
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value instanceof Set) {
    // Sets are unordered → sort their canonical members for stable bytes.
    const members = [...value].map(canonicalize).sort();
    return `[${members.join(',')}]`;
  }
  if (value instanceof Map) {
    return canonicalize(Object.fromEntries(value));
  }
  if (t === 'object') {
    const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
    const body = keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(',');
    return `{${body}}`;
  }
  throw new TypeError(`canonical: unsupported type ${t}`);
}

/** Domain-separated canonical bytes string used as hash/sign input (spec §13). */
export function canonicalBytes(value, { domain = DOMAIN_SEPARATOR, schemaVersion = '' } = {}) {
  return `${domain}\u0000${schemaVersion}\u0000${canonicalize(value)}`;
}

/**
 * Synchronous hot-path id: 32-bit FNV over canonical bytes. Tagged so it is
 * self-describing and migratable. Fast, NOT collision-resistant — identity for
 * runtime state, never a security claim (spec rule 52).
 * @returns {string} `fnv1a32:32:<hex8>`
 */
export function hashIdFast(value, opts = {}) {
  return `fnv1a32:32:${checksumHex32(fnv1aStringCodeUnit32(canonicalBytes(value, opts)))}`;
}

/**
 * Async authority id: Web Crypto SHA-256 over canonical bytes. Use for
 * capabilities, witness receipts, checkpoints, and signed transactions.
 * Throws if SubtleCrypto is unavailable (callers degrade explicitly).
 * @returns {Promise<string>} `sha256:256:<hex64>`
 */
export async function hashIdSecure(value, opts = {}) {
  const hex = await contentHashHex(canonicalBytes(value, opts), 'SHA-256');
  return `sha256:256:${hex}`;
}

/** Parse a tagged hash id into `{ alg, bits, hex }` or null. */
export function parseHashId(id) {
  if (typeof id !== 'string') return null;
  const m = /^([a-z0-9-]+):(\d+):([0-9a-f]+)$/.exec(id);
  if (!m) return null;
  return { alg: m[1], bits: Number(m[2]), hex: m[3] };
}

/** True when two tagged hash ids are byte-equal (same algorithm + digest). */
export function hashIdEquals(a, b) {
  return typeof a === 'string' && a === b;
}
