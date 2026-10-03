// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { canonicalize } from '../../../state/util/canonical.js';
import { verifyChunkFragments, reassembleAndVerifyChunk } from '../../chunks/ChunkVerifier.js';
import { computeChunkHash } from '../../chunks/MerkleFragments.js';
import { reassembleChunks } from '../../chunks/ChunkFragmenter.js';
import { verifyBlobAgainstDescriptor, verifyRealmCapsule, toUint8Array } from './RealmCapsule.js';
import { deepFreeze, validateRealmCapsuleShape } from './RealmCapsuleSchema.js';

function describeChunks(capsule) {
  const result = new Map();
  for (const blob of capsule.blobs) {
    for (const chunk of blob.chunks) {
      const existing = result.get(chunk.chunkId);
      if (existing && canonicalize(existing) !== canonicalize(chunk)) {
        throw new Error(`Capsule describes chunk ${chunk.chunkId} inconsistently`);
      }
      result.set(chunk.chunkId, chunk);
    }
  }
  return result;
}

export class CapsuleAssembler {
  constructor({ capsule, contentStore, sessionId = null, logger = console } = {}) {
    validateRealmCapsuleShape(capsule);
    if (!contentStore || typeof contentStore.putBlob !== 'function' || typeof contentStore.getBlob !== 'function') {
      throw new TypeError('CapsuleAssembler requires a RealmContentStore-compatible contentStore');
    }
    this.capsule = capsule;
    this.store = contentStore;
    this.sessionId = sessionId ?? capsule.capsuleRoot.slice('sha256:'.length);
    this.logger = logger;
    this._chunks = describeChunks(capsule);
    this._received = new Set();
    this._revision = null;
    this._initialized = false;
  }

  async init(options = {}) {
    if (this._initialized) return this.status();
    const verification = await verifyRealmCapsule(this.capsule, options);
    if (!verification.ok) throw new Error(`Cannot assemble invalid Realm Capsule: ${verification.reason}`);
    await this.store.init?.();
    const saved = await this.store.readAssemblyState?.(this.sessionId);
    if (saved) {
      if (saved.capsuleRoot !== this.capsule.capsuleRoot) throw new Error('Assembly session belongs to a different Realm Capsule');
      this._revision = saved.revision;
      for (const chunkId of saved.receivedChunkIds ?? []) {
        if (this._chunks.has(chunkId) && await this._hasVerifiedChunk(chunkId)) this._received.add(chunkId);
      }
    }
    for (const chunkId of this._chunks.keys()) {
      if (await this._hasVerifiedChunk(chunkId)) this._received.add(chunkId);
    }
    this._initialized = true;
    await this._persist();
    return this.status();
  }

  _assertInitialized() {
    if (!this._initialized) throw new Error('CapsuleAssembler.init() must complete first');
  }

  async _hasVerifiedChunk(chunkId) {
    try {
      const bytes = await this.store.getBlob(`sha256:${chunkId}`);
      return !!bytes && await computeChunkHash(bytes) === chunkId;
    } catch (_) {
      return false;
    }
  }

  async acceptFragments(chunkId, fragments) {
    this._assertInitialized();
    const descriptor = this._chunks.get(String(chunkId));
    if (!descriptor) throw new Error(`Chunk ${chunkId} is not declared by this Realm Capsule`);
    if (!Array.isArray(fragments) || fragments.length !== descriptor.fragmentCount) {
      throw new Error(`Chunk ${chunkId} requires exactly ${descriptor.fragmentCount} fragments`);
    }
    const bytes = fragments.map(toUint8Array);
    if (!await verifyChunkFragments(bytes, descriptor.fragmentRoot)) throw new Error(`Chunk ${chunkId} fragment Merkle root mismatch`);
    const assembled = await reassembleAndVerifyChunk(bytes, descriptor.chunkId);
    if (!assembled || assembled.byteLength !== descriptor.byteLength) throw new Error(`Chunk ${chunkId} content hash or length mismatch`);
    return this.acceptChunk(chunkId, assembled);
  }

  async acceptChunk(chunkId, bytesLike) {
    this._assertInitialized();
    const descriptor = this._chunks.get(String(chunkId));
    if (!descriptor) throw new Error(`Chunk ${chunkId} is not declared by this Realm Capsule`);
    const bytes = toUint8Array(bytesLike);
    if (bytes.byteLength !== descriptor.byteLength || await computeChunkHash(bytes) !== descriptor.chunkId) {
      throw new Error(`Chunk ${chunkId} failed SHA-256 verification`);
    }
    const result = await this.store.putBlob(bytes, { expectedId: `sha256:${descriptor.chunkId}`, kind: 'chunk' });
    this._received.add(descriptor.chunkId);
    await this._persist();
    this.logger.debug?.('[CapsuleAssembler] chunk accepted', {
      capsuleRoot: this.capsule.capsuleRoot,
      chunkId: descriptor.chunkId,
      byteLength: descriptor.byteLength,
      deduplicated: result.deduplicated,
    });
    return Object.freeze({ accepted: true, deduplicated: result.deduplicated, status: this.status() });
  }

  async _persist() {
    if (typeof this.store.writeAssemblyState !== 'function') return;
    const nextRevision = this._revision == null ? 0 : this._revision + 1;
    const state = {
      format: 'realm-capsule-assembly-v1',
      sessionId: this.sessionId,
      capsuleRoot: this.capsule.capsuleRoot,
      revision: nextRevision,
      receivedChunkIds: [...this._received].sort(),
      updatedAt: Date.now(),
    };
    await this.store.writeAssemblyState(this.sessionId, state, { expectedRevision: this._revision });
    this._revision = nextRevision;
  }

  status() {
    const receivedChunkIds = [...this._received].filter(chunkId => this._chunks.has(chunkId)).sort();
    const missingChunkIds = [...this._chunks.keys()].filter(chunkId => !this._received.has(chunkId)).sort();
    const receivedBytes = receivedChunkIds.reduce((total, chunkId) => total + this._chunks.get(chunkId).byteLength, 0);
    const totalBytes = [...this._chunks.values()].reduce((total, chunk) => total + chunk.byteLength, 0);
    return deepFreeze({
      capsuleRoot: this.capsule.capsuleRoot,
      sessionId: this.sessionId,
      revision: this._revision,
      complete: missingChunkIds.length === 0,
      minimumEntryReady: this.isMinimumEntryReady(),
      receivedChunkIds,
      missingChunkIds,
      receivedBytes,
      totalBytes,
    });
  }

  isMinimumEntryReady() {
    for (const contentId of this.capsule.minimumEntry.blobIds) {
      const blob = this.capsule.blobs.find(candidate => candidate.contentId === contentId);
      if (!blob || blob.chunks.some(chunk => !this._received.has(chunk.chunkId))) return false;
    }
    return true;
  }

  async materializeBlob(contentId) {
    this._assertInitialized();
    const descriptor = this.capsule.blobs.find(blob => blob.contentId === contentId);
    if (!descriptor) throw new Error(`Blob ${contentId} is not declared by this Realm Capsule`);
    const chunks = [];
    for (const chunk of descriptor.chunks) {
      if (!this._received.has(chunk.chunkId)) throw new Error(`Blob ${contentId} is missing chunk ${chunk.chunkId}`);
      const bytes = await this.store.getBlob(`sha256:${chunk.chunkId}`);
      if (!bytes || await computeChunkHash(bytes) !== chunk.chunkId) throw new Error(`Stored chunk ${chunk.chunkId} is missing or corrupt`);
      chunks.push(bytes);
    }
    const blobBytes = reassembleChunks(chunks);
    if (!await verifyBlobAgainstDescriptor(blobBytes, descriptor)) throw new Error(`Materialized blob ${contentId} failed verification`);
    await this.store.putBlob(blobBytes, { expectedId: contentId, kind: 'blob' });
    return blobBytes;
  }

  async materialize({ minimumOnly = false } = {}) {
    this._assertInitialized();
    const selected = minimumOnly
      ? this.capsule.minimumEntry.blobIds
      : this.capsule.blobs.map(blob => blob.contentId);
    const blobs = new Map();
    for (const contentId of selected) blobs.set(contentId, await this.materializeBlob(contentId));
    return blobs;
  }
}
