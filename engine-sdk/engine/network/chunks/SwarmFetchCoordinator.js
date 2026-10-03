// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { computeChunkHash } from './MerkleFragments.js';
import { requestChunkFromPeer } from './ChunkTransport.js';
import { verifyManifest, manifestTotalSize } from './Manifest.js';

const MAX_PROVIDER_CANDIDATES = 256;
const MAX_PEER_PENALTIES = 2048;

export class SwarmFetchError extends Error {
  constructor(message, report) {
    super(message);
    this.name = 'SwarmFetchError';
    this.report = report;
  }
}

function providerIds(value) {
  const peers = Array.isArray(value) ? value : Array.isArray(value?.peers) ? value.peers : [];
  return [...new Set(peers.filter((peerId) => typeof peerId === 'string' && peerId && peerId.length <= 512))]
    .slice(0, MAX_PROVIDER_CANDIDATES);
}

async function validLocalChunk(value, descriptor) {
  const bytes = value?.bytes instanceof Uint8Array ? value.bytes : value instanceof Uint8Array ? value : null;
  if (!bytes || bytes.byteLength !== descriptor.size) return null;
  return await computeChunkHash(bytes) === descriptor.chunkId ? bytes : null;
}

/**
 * Resolve a signed manifest from many DHT providers, retrying failed peers,
 * verifying every content hash, and preserving manifest chunk order.
 */
export async function fetchManifestFromSwarm({
  signedManifest,
  transport,
  findProviders,
  fallbackPeers = () => [],
  readChunk = async () => null,
  writeChunk = async () => {},
  onVerifiedChunk = async () => {},
  announceChunk = async () => {},
  assemble = true,
  maxLanes = 4,
  maxAttemptsPerChunk = 4,
  requestTimeoutMs = 8_000,
  signal = null,
  onProgress = () => {},
  logger = () => {},
} = {}) {
  if (!transport || typeof findProviders !== 'function') throw new TypeError('swarm fetch requires chunk transport and provider discovery');
  if (typeof onVerifiedChunk !== 'function') throw new TypeError('swarm onVerifiedChunk must be a function');
  if (typeof assemble !== 'boolean') throw new TypeError('swarm assemble must be a boolean');
  if (!Number.isSafeInteger(maxLanes) || maxLanes < 1 || maxLanes > 16) throw new RangeError('swarm maxLanes is invalid');
  if (!Number.isSafeInteger(maxAttemptsPerChunk) || maxAttemptsPerChunk < 1 || maxAttemptsPerChunk > 16) {
    throw new RangeError('swarm maxAttemptsPerChunk is invalid');
  }
  const verified = await verifyManifest(signedManifest);
  if (!verified.ok) throw new SwarmFetchError(`manifest rejected: ${verified.reason}`, Object.freeze({ manifest: verified }));
  const descriptors = signedManifest.payload.chunks;
  const unique = new Map();
  descriptors.forEach((descriptor, index) => {
    let item = unique.get(descriptor.chunkId);
    if (!item) {
      item = { descriptor, indexes: [], bytes: null };
      unique.set(descriptor.chunkId, item);
    }
    item.indexes.push(index);
  });
  const work = [...unique.values()];
  const peerFailures = new Map();
  const attempts = [];
  const failures = [];
  let completed = 0;
  let cursor = 0;

  const penalize = (peerId) => {
    if (!peerFailures.has(peerId) && peerFailures.size >= MAX_PEER_PENALTIES) {
      peerFailures.delete(peerFailures.keys().next().value);
    }
    peerFailures.set(peerId, (peerFailures.get(peerId) ?? 0) + 1);
  };
  const progress = (stage, item, extra = {}) => {
    try {
      onProgress(Object.freeze({
        stage,
        objectId: signedManifest.payload.objectId,
        chunkId: item.descriptor.chunkId,
        completedChunks: completed,
        totalChunks: work.length,
        ...extra,
      }));
    } catch (_) { /* progress observers cannot affect transfer */ }
  };

  const commitVerified = async (item, bytes, { source, peerId = null } = {}) => {
    const value = Object.freeze({
      ...item.descriptor,
      bytes,
      indexes: Object.freeze([...item.indexes]),
      source,
      peerId,
    });
    await writeChunk(value);
    await onVerifiedChunk(value);
    if (assemble) item.bytes = bytes;
    completed += 1;
    progress(source === 'cache' ? 'cache-hit' : 'complete', item, {
      ...(peerId ? { peerId } : {}),
      bytes: bytes.byteLength,
    });
  };

  const fetchOne = async (item) => {
    if (signal?.aborted) throw new Error('swarm fetch aborted');
    const local = await validLocalChunk(await readChunk(item.descriptor.chunkId), item.descriptor);
    if (local) {
      await commitVerified(item, local, { source: 'cache' });
      return;
    }
    let discovered = [];
    try { discovered = providerIds(await findProviders(item.descriptor.chunkId)); }
    catch (error) { logger({ event: 'swarm.discovery-failed', chunkId: item.descriptor.chunkId, reason: error?.message ?? String(error) }); }
    const fallback = providerIds(await fallbackPeers(item.descriptor.chunkId));
    const candidates = [...new Set([...discovered, ...fallback])]
      .sort((a, b) => (peerFailures.get(a) ?? 0) - (peerFailures.get(b) ?? 0));
    if (!candidates.length) throw new Error('no providers');
    let lastError = null;
    for (const peerId of candidates.slice(0, maxAttemptsPerChunk)) {
      if (signal?.aborted) throw new Error('swarm fetch aborted');
      progress('requesting', item, { peerId });
      let bytes;
      try {
        bytes = await requestChunkFromPeer(transport, {
          peerId,
          chunkId: item.descriptor.chunkId,
          fragmentRoot: item.descriptor.fragmentRoot,
          timeoutMs: requestTimeoutMs,
        });
        if (bytes.byteLength !== item.descriptor.size || await computeChunkHash(bytes) !== item.descriptor.chunkId) {
          throw new Error('verified transfer did not match manifest size/hash');
        }
        attempts.push({ chunkId: item.descriptor.chunkId, peerId, ok: true });
      } catch (error) {
        lastError = error;
        penalize(peerId);
        attempts.push({ chunkId: item.descriptor.chunkId, peerId, ok: false, reason: error?.message ?? String(error) });
        progress('retry', item, { peerId, reason: error?.message ?? String(error) });
        continue;
      }
      // Persistence failures are local failures, not evidence against the peer
      // that supplied already-verified bytes. Fail this chunk without applying
      // a reputation penalty or needlessly downloading the same bytes again.
      await commitVerified(item, bytes, { source: 'network', peerId });
      try { await announceChunk(item.descriptor.chunkId); } catch (_) { /* persisted bytes remain usable */ }
      return;
    }
    throw lastError ?? new Error('all providers failed');
  };

  const worker = async () => {
    while (cursor < work.length) {
      const item = work[cursor++];
      try { await fetchOne(item); }
      catch (error) {
        failures.push({ chunkId: item.descriptor.chunkId, reason: error?.message ?? String(error) });
        progress('failed', item, { reason: error?.message ?? String(error) });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(maxLanes, Math.max(1, work.length)) }, () => worker()));
  const report = Object.freeze({
    objectId: signedManifest.payload.objectId,
    totalBytes: manifestTotalSize(signedManifest),
    uniqueChunks: work.length,
    completedChunks: completed,
    attempts: Object.freeze(attempts.map((item) => Object.freeze(item))),
    failures: Object.freeze(failures.map((item) => Object.freeze(item))),
    peerFailures: Object.freeze(Object.fromEntries(peerFailures)),
    assembled: assemble,
  });
  if (failures.length) throw new SwarmFetchError(`swarm fetch failed for ${failures.length} chunk(s)`, report);
  if (!assemble) return Object.freeze({ bytes: null, report });
  const totalBytes = manifestTotalSize(signedManifest);
  const objectBytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const descriptor of descriptors) {
    const bytes = unique.get(descriptor.chunkId).bytes;
    objectBytes.set(bytes, offset);
    offset += bytes.byteLength;
  }
  return Object.freeze({ bytes: objectBytes, report });
}
