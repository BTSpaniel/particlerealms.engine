// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// network/chunks/Manifest.js — signed object manifests (network plan §31).
// A manifest describes an object as an ordered list of chunks (each with a
// content hash + fragment merkle root); the object itself is fetched
// chunk-by-chunk, possibly from many peers at once (SwarmScheduler.js).

import { makeEnvelope, signEnvelope, verifyEnvelope, PROTOCOL_VERSIONS } from '../protocol.js';
import { MAX_CHUNK_BYTES } from './ChunkLimits.js';

export const MAX_MANIFEST_CHUNKS = 1024;
export const MAX_MANIFEST_OBJECT_BYTES = 256 * 1024 * 1024;
const HASH_RE = /^[0-9a-f]{64}$/;

function validateManifestPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return 'bad-payload';
  if (typeof payload.objectId !== 'string' || !payload.objectId || payload.objectId.length > 512) return 'bad-object-id';
  if (typeof payload.scope !== 'string' || !payload.scope || payload.scope.length > 256) return 'bad-scope';
  if (!Number.isSafeInteger(payload.version) || payload.version < 1) return 'bad-version';
  if (payload.chunkSizeMax !== MAX_CHUNK_BYTES) return 'bad-chunk-ceiling';
  if (!Array.isArray(payload.chunks) || payload.chunks.length > MAX_MANIFEST_CHUNKS) return 'bad-chunks';
  if (!Array.isArray(payload.permissions) || payload.permissions.length > 256
    || payload.permissions.some((value) => typeof value !== 'string' || value.length > 256)) return 'bad-permissions';
  let total = 0;
  const descriptors = new Map();
  for (const chunk of payload.chunks) {
    if (!chunk || typeof chunk !== 'object' || Array.isArray(chunk)
      || Object.keys(chunk).sort().join('\0') !== ['chunkId', 'fragmentRoot', 'size'].join('\0')
      || !HASH_RE.test(chunk.chunkId) || !HASH_RE.test(chunk.fragmentRoot)
      || !Number.isSafeInteger(chunk.size) || chunk.size < 0 || chunk.size > MAX_CHUNK_BYTES) return 'bad-chunk';
    const known = descriptors.get(chunk.chunkId);
    if (known && (known.size !== chunk.size || known.fragmentRoot !== chunk.fragmentRoot)) return 'conflicting-chunk';
    descriptors.set(chunk.chunkId, chunk);
    total += chunk.size;
    if (!Number.isSafeInteger(total) || total > MAX_MANIFEST_OBJECT_BYTES) return 'object-too-large';
  }
  return null;
}

/**
 * Build + sign a manifest.
 * @param {object} c
 * @param {string} c.objectId
 * @param {string} [c.scope]         e.g. 'group_dev_lab', 'public'
 * @param {number} [c.version]
 * @param {Array<{chunkId:string, size:number, fragmentRoot:string}>} c.chunks
 * @param {string[]} [c.permissions]
 * @param {number} [c.encryptionEpoch]
 * @param {object} c.signer
 * @returns {Promise<object>} signed manifest envelope
 */
export async function buildManifest({
  objectId, scope = 'private', version = 1, chunks = [], permissions = [], encryptionEpoch = null, signer,
} = {}) {
  if (!objectId) throw new TypeError('buildManifest requires an objectId');
  if (!signer) throw new TypeError('buildManifest requires a signer');
  const payload = {
    objectId, scope, version, chunkSizeMax: MAX_CHUNK_BYTES,
    chunks: chunks.map((c) => ({ chunkId: c.chunkId, size: c.size, fragmentRoot: c.fragmentRoot })),
    permissions: [...permissions],
    encryptionEpoch,
  };
  const invalid = validateManifestPayload(payload);
  if (invalid) throw new TypeError(`buildManifest rejected ${invalid}`);
  const env = makeEnvelope({
    protocol: PROTOCOL_VERSIONS.MANIFEST,
    type: 'MANIFEST_PUBLISHED',
    payload,
  });
  return signEnvelope(env, signer);
}

/** Verify a manifest's protocol/type and signature. */
export async function verifyManifest(signedManifest) {
  if (!signedManifest || signedManifest.protocol !== PROTOCOL_VERSIONS.MANIFEST || signedManifest.type !== 'MANIFEST_PUBLISHED') {
    return { ok: false, reason: 'bad-protocol' };
  }
  const invalid = validateManifestPayload(signedManifest.payload);
  if (invalid) return { ok: false, reason: invalid };
  const sigOk = await verifyEnvelope(signedManifest);
  if (!sigOk) return { ok: false, reason: 'bad-signature' };
  return { ok: true, reason: null };
}

/** Total object size implied by a manifest's chunk list. */
export function manifestTotalSize(signedManifest) {
  return signedManifest.payload.chunks.reduce((n, c) => n + c.size, 0);
}

/** List of chunk ids a manifest references, in order. */
export function manifestChunkIds(signedManifest) {
  return signedManifest.payload.chunks.map((c) => c.chunkId);
}
