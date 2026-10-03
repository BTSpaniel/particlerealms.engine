// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// network/chunks/ChunkVerifier.js — verify received fragments/chunks against
// a manifest's declared hashes (network plan §31/§32).

import { computeFragmentHashes, computeMerkleRoot, computeChunkHash } from './MerkleFragments.js';
import { reassembleFragments } from './ChunkFragmenter.js';

/**
 * Verify a fully-received set of fragments for one chunk against the
 * manifest's declared fragment merkle root — before spending time/memory
 * reassembling+hashing the whole chunk.
 * @returns {Promise<boolean>}
 */
export async function verifyChunkFragments(fragments, expectedFragmentRoot) {
  const hashes = await computeFragmentHashes(fragments);
  const root = await computeMerkleRoot(hashes);
  return root === expectedFragmentRoot;
}

/**
 * Reassemble fragments and verify the resulting chunk's content hash matches
 * the manifest's declared chunkId. Returns the reassembled bytes on success,
 * or null (fails closed) on mismatch.
 * @returns {Promise<Uint8Array|null>}
 */
export async function reassembleAndVerifyChunk(fragments, expectedChunkId) {
  const bytes = reassembleFragments(fragments);
  const hash = await computeChunkHash(bytes);
  return hash === expectedChunkId ? bytes : null;
}
