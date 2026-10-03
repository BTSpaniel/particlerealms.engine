// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// network/chunks/MerkleFragments.js — per-fragment hashing + a chunk's
// merkle root (network plan §32), so receivers can reject a corrupted
// fragment early instead of only detecting failure after the whole chunk is
// reassembled. Reuses the engine's existing SHA-256 content hash helper
// (already used for identity fingerprints elsewhere).

import { contentHashHex } from '../../core/math/ChecksumMath.js';

/** SHA-256 hex hash of one fragment's raw bytes. */
export async function hashFragment(fragmentBytes) {
  return contentHashHex(fragmentBytes, 'sha256');
}

/** SHA-256 hex hash of a full chunk's raw bytes (used as the chunk's content id). */
export async function computeChunkHash(chunkBytes) {
  return contentHashHex(chunkBytes, 'sha256');
}

/** Hash every fragment of a chunk, in order. */
export async function computeFragmentHashes(fragments) {
  const hashes = [];
  for (const f of fragments) hashes.push(await hashFragment(f));
  return hashes;
}

/**
 * Compute a chunk's merkle root from its (ordered) fragment hashes: pair up
 * adjacent hashes, hash their concatenation, repeat until one root remains
 * (odd node carries up unchanged, standard merkle tree construction).
 * @param {string[]} fragmentHashes
 * @returns {Promise<string>}
 */
export async function computeMerkleRoot(fragmentHashes) {
  if (fragmentHashes.length === 0) throw new RangeError('computeMerkleRoot requires at least one fragment hash');
  let level = [...fragmentHashes];
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 < level.length) {
        next.push(await contentHashHex(level[i] + level[i + 1], 'sha256'));
      } else {
        next.push(level[i]); // odd one out carries up unchanged
      }
    }
    level = next;
  }
  return level[0];
}
