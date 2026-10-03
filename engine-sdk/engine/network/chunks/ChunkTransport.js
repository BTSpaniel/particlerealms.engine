// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// network/chunks/ChunkTransport.js — binds the transport-agnostic chunk
// pipeline (ChunkFragmenter/MerkleFragments/ChunkVerifier/FlowControl/
// DedupeCache) to a real peer connection (network plan §27/§28/§31/§32,
// previously deferred: "Real WebRTC DataChannel transport wiring").
//
// Deliberately transport-agnostic at the call boundary — takes a `sendToPeer`
// function matching engine/collab/CollabCore.js's `sendToPeer(core, peerId,
// data)` signature (which already auto-chunks anything over ~60KB to dodge
// SCTP frame limits and reassembles transparently on the receive side, and
// round-trips `Uint8Array` natively via CollabCodec.js's msgpack `bin`
// format) rather than importing CollabCore itself. Callers feed every
// relevant `onOp(peerId, op)` message through `handleChunkTransportMessage`
// before their own app-level op handling — same pattern SyncTransport.js
// uses for MasterServerClient signal events.
//
// Real credit-based backpressure (FlowControl.js's whole point): a
// CollabCore-style reliable-ordered data channel does NOT drop or
// backpressure large "critical" application messages on its own (see
// CollabCore.js's `_sendBinary` — only a handful of non-critical types like
// `__ping__` get dropped under buffer pressure); blasting every fragment of
// a multi-MB object immediately would build unbounded `bufferedAmount`. This
// module gates sends on an ACK-based credit window instead: a fragment's
// credit is only released once the receiver confirms it actually arrived
// (`CHUNK_FRAGMENT_ACK`), not merely once handed to the transport.

import { splitChunkIntoFragments } from './ChunkFragmenter.js';
import { verifyChunkFragments, reassembleAndVerifyChunk } from './ChunkVerifier.js';
import {
  createFlowControl, tryReserveCredit, releaseCredit,
  createPriorityQueue, enqueue, dequeue, isQueueEmpty, PRIORITY_LANE,
} from './FlowControl.js';
import { createDedupeCache, checkAndMark } from './DedupeCache.js';
import { DEFAULT_FRAGMENT_BYTES, MAX_CHUNK_BYTES, MAX_FRAGMENT_BYTES } from './ChunkLimits.js';
import { PROTOCOL_VERSIONS } from '../protocol.js';

const MSG_FRAGMENT = 'CHUNK_FRAGMENT';
const MSG_ACK = 'CHUNK_FRAGMENT_ACK';
const MSG_REQUEST = 'CHUNK_REQUEST';
export const CHUNK_MESSAGE_TYPE = Object.freeze({ REQUEST: MSG_REQUEST, FRAGMENT: MSG_FRAGMENT, ACK: MSG_ACK });
const FRAGMENT_DEDUPE_TTL_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8_000;
const REQUEST_BURST = 16;
const REQUESTS_PER_SECOND = 4;
const MAX_REQUEST_PEERS = 2_048;
const MAX_INCOMING_CHUNKS = 256;
const MAX_FRAGMENTS_PER_CHUNK = Math.ceil(MAX_CHUNK_BYTES / 1024);
const HASH_RE = /^[0-9a-f]{64}$/;

/**
 * @param {object} c
 * @param {(peerId:string, data:object) => void} c.sendToPeer  e.g. `(peerId, data) => sendToPeer(core, peerId, data)`
 * @param {number} [c.maxInFlightBytes]
 * @param {(info:{peerId:string, chunkId:string, bytes:Uint8Array}) => void} [c.onChunkReceived]
 * @param {(info:{peerId:string, chunkId:string, reason:string}) => void} [c.onChunkFailed]
 * @returns {object} transport state — pass to enqueueChunkSend/handleChunkTransportMessage
 */
export function createChunkTransport({
  sendToPeer,
  maxInFlightBytes,
  getChunk = async () => null,
  onChunkReceived = () => {},
  onChunkFailed = () => {},
} = {}) {
  if (typeof sendToPeer !== 'function') throw new TypeError('createChunkTransport requires a sendToPeer function');
  if (typeof getChunk !== 'function') throw new TypeError('createChunkTransport getChunk must be a function');
  return {
    sendToPeer, getChunk, onChunkReceived, onChunkFailed,
    flow: createFlowControl({ maxInFlightBytes }),
    queue: createPriorityQueue(),
    dedupe: createDedupeCache(),
    _incoming: new Map(), // `${peerId}:${chunkId}` -> { total, fragmentRoot, fragments:Map<index,Uint8Array> }
    _pendingRequests: new Map(), // `${peerId}:${chunkId}` -> {resolve,reject,timer}
    _requestPeers: new Map(),
    _pumping: false,
  };
}

/** Ask one peer for a manifest-declared chunk and await its verified bytes. */
export function requestChunkFromPeer(transport, {
  peerId, chunkId, fragmentRoot, timeoutMs = REQUEST_TIMEOUT_MS, lane = PRIORITY_LANE.NORMAL,
} = {}) {
  if (typeof peerId !== 'string' || !peerId || peerId.length > 512) throw new TypeError('chunk request peerId is invalid');
  if (!HASH_RE.test(chunkId) || !HASH_RE.test(fragmentRoot)) throw new TypeError('chunk request hashes are invalid');
  if (!Number.isFinite(timeoutMs) || timeoutMs < 250 || timeoutMs > 120_000) throw new RangeError('chunk request timeout is invalid');
  const key = `${peerId}:${chunkId}`;
  const existing = transport._pendingRequests.get(key);
  if (existing) return existing.promise;
  let resolveRequest;
  let rejectRequest;
  const promise = new Promise((resolve, reject) => {
    resolveRequest = resolve;
    rejectRequest = reject;
  });
  const timer = setTimeout(() => {
    if (transport._pendingRequests.get(key)?.promise !== promise) return;
    transport._pendingRequests.delete(key);
    rejectRequest(new Error(`chunk request timed out: ${chunkId}`));
  }, timeoutMs);
  transport._pendingRequests.set(key, { promise, resolve: resolveRequest, reject: rejectRequest, timer });
  const sent = transport.sendToPeer(peerId, {
    protocol: PROTOCOL_VERSIONS.CHUNK,
    type: MSG_REQUEST,
    chunkId,
    fragmentRoot,
    lane,
  });
  if (sent === false) {
    clearTimeout(timer);
    transport._pendingRequests.delete(key);
    rejectRequest(new Error(`chunk request could not be sent: ${chunkId}`));
  }
  return promise;
}

/**
 * Enqueue one chunk's fragments for sending to a peer. Actual sends are
 * paced by the credit window (see module doc) — this returns immediately;
 * fragments drain asynchronously as ACKs free up credit.
 * @param {object} transport
 * @param {object} c
 * @param {string} c.peerId
 * @param {string} c.chunkId        expected content hash (Manifest.js chunk entry's chunkId)
 * @param {Uint8Array} c.chunkBytes
 * @param {string} c.fragmentRoot   expected merkle root (Manifest.js chunk entry's fragmentRoot)
 * @param {number} [c.lane]         FlowControl.PRIORITY_LANE, default NORMAL
 * @param {number} [c.fragmentSize]
 */
export function enqueueChunkSend(transport, { peerId, chunkId, chunkBytes, fragmentRoot, lane = PRIORITY_LANE.NORMAL, fragmentSize = DEFAULT_FRAGMENT_BYTES }) {
  if (typeof peerId !== 'string' || !peerId || peerId.length > 512) throw new TypeError('chunk send peerId is invalid');
  if (!HASH_RE.test(chunkId) || !HASH_RE.test(fragmentRoot)) throw new TypeError('chunk send hashes are invalid');
  if (!(chunkBytes instanceof Uint8Array) || chunkBytes.byteLength > MAX_CHUNK_BYTES) throw new TypeError('chunk send bytes are invalid');
  if (!Number.isSafeInteger(fragmentSize) || fragmentSize < 1024 || fragmentSize > MAX_FRAGMENT_BYTES) {
    throw new RangeError('chunk fragmentSize is invalid');
  }
  const fragments = splitChunkIntoFragments(chunkBytes, fragmentSize);
  fragments.forEach((bytes, index) => {
    enqueue(transport.queue, lane, { peerId, chunkId, index, total: fragments.length, fragmentRoot, bytes, lane });
  });
  _pump(transport);
}

function _requeueFront(pq, item) {
  const arr = pq._lanes.get(item.lane);
  if (arr) arr.unshift(item);
  else enqueue(pq, item.lane, item);
}

function _pump(transport) {
  if (transport._pumping) return;
  transport._pumping = true;
  try {
    while (!isQueueEmpty(transport.queue)) {
      const item = dequeue(transport.queue);
      if (!tryReserveCredit(transport.flow, item.bytes.length)) {
        _requeueFront(transport.queue, item);
        break; // wait for an ACK to free credit (see handleChunkTransportMessage)
      }
      transport.sendToPeer(item.peerId, {
        protocol: PROTOCOL_VERSIONS.CHUNK,
        type: MSG_FRAGMENT, chunkId: item.chunkId, index: item.index, total: item.total,
        fragmentRoot: item.fragmentRoot, bytes: item.bytes,
      });
    }
  } finally {
    transport._pumping = false;
  }
}

/**
 * Feed every `onOp(peerId, op)` message through this (e.g. from
 * `createCollabCore({ onOp })`). Handles fragment sends and their acks;
 * returns false for anything that isn't a chunk-transport message so callers
 * can safely chain their own app-level op handling after it.
 * @returns {boolean} true if this message was a chunk-transport message (handled)
 */
export function handleChunkTransportMessage(transport, peerId, op) {
  if (!op || (op.protocol != null && op.protocol !== PROTOCOL_VERSIONS.CHUNK)
    || !Object.values(CHUNK_MESSAGE_TYPE).includes(op.type)) return false;

  if (op.type === MSG_REQUEST) {
    if (!HASH_RE.test(op.chunkId) || !HASH_RE.test(op.fragmentRoot) || !_allowRequest(transport, peerId)) return true;
    void _serveChunkRequest(transport, peerId, op);
    return true;
  }

  if (op.type === MSG_ACK) {
    releaseCredit(transport.flow, op.byteLength || 0);
    _pump(transport);
    return true;
  }

  // MSG_FRAGMENT
  const bytes = op.bytes instanceof Uint8Array ? op.bytes : new Uint8Array(op.bytes || []);
  if (!HASH_RE.test(op.chunkId) || !HASH_RE.test(op.fragmentRoot)
    || !Number.isSafeInteger(op.total) || op.total < 1 || op.total > MAX_FRAGMENTS_PER_CHUNK
    || !Number.isSafeInteger(op.index) || op.index < 0 || op.index >= op.total
    || bytes.byteLength > MAX_FRAGMENT_BYTES) return true;
  const dedupeKey = `${peerId}:${op.chunkId}:${op.index}`;
  if (!checkAndMark(transport.dedupe, dedupeKey, FRAGMENT_DEDUPE_TTL_MS)) {
    // Already-processed duplicate/retransmit — still ack so the sender's credit frees up.
    transport.sendToPeer(peerId, { protocol: PROTOCOL_VERSIONS.CHUNK, type: MSG_ACK, chunkId: op.chunkId, index: op.index, byteLength: bytes.length });
    return true;
  }

  const key = `${peerId}:${op.chunkId}`;
  let entry = transport._incoming.get(key);
  if (!entry) {
    if (transport._incoming.size >= MAX_INCOMING_CHUNKS) {
      transport._incoming.delete(transport._incoming.keys().next().value);
    }
    entry = { total: op.total, fragmentRoot: op.fragmentRoot, fragments: new Map(), bytesTotal: 0 };
    transport._incoming.set(key, entry);
  }
  if (entry.total !== op.total || entry.fragmentRoot !== op.fragmentRoot) return true;
  if (!entry.fragments.has(op.index)) {
    entry.bytesTotal += bytes.byteLength;
    if (entry.bytesTotal > MAX_CHUNK_BYTES) {
      transport._incoming.delete(key);
      transport.sendToPeer(peerId, { protocol: PROTOCOL_VERSIONS.CHUNK, type: MSG_ACK, chunkId: op.chunkId, index: op.index, byteLength: bytes.length });
      _rejectPending(transport, peerId, op.chunkId, 'chunk-size-limit');
      transport.onChunkFailed({ peerId, chunkId: op.chunkId, reason: 'chunk-size-limit' });
      return true;
    }
    entry.fragments.set(op.index, bytes);
  }

  // Ack as soon as WE have the bytes — verification failure is a whole-chunk
  // concern (reported via onChunkFailed), not a reason to stall the sender's
  // credit window for bytes that did arrive intact at the transport layer.
  transport.sendToPeer(peerId, { protocol: PROTOCOL_VERSIONS.CHUNK, type: MSG_ACK, chunkId: op.chunkId, index: op.index, byteLength: bytes.length });

  if (entry.fragments.size === entry.total) {
    transport._incoming.delete(key);
    const ordered = [];
    for (let i = 0; i < entry.total; i++) ordered.push(entry.fragments.get(i));
    _verifyAndDeliver(transport, peerId, op.chunkId, ordered, entry.fragmentRoot);
  }
  return true;
}

async function _verifyAndDeliver(transport, peerId, chunkId, fragments, fragmentRoot) {
  try {
    const fragmentsOk = await verifyChunkFragments(fragments, fragmentRoot);
    if (!fragmentsOk) { _rejectPending(transport, peerId, chunkId, 'fragment-root-mismatch'); transport.onChunkFailed({ peerId, chunkId, reason: 'fragment-root-mismatch' }); return; }
    const bytes = await reassembleAndVerifyChunk(fragments, chunkId);
    if (!bytes) { _rejectPending(transport, peerId, chunkId, 'chunk-hash-mismatch'); transport.onChunkFailed({ peerId, chunkId, reason: 'chunk-hash-mismatch' }); return; }
    _resolvePending(transport, peerId, chunkId, bytes);
    transport.onChunkReceived({ peerId, chunkId, fragmentRoot, bytes });
  } catch (err) {
    _rejectPending(transport, peerId, chunkId, err?.message || 'verify-error');
    transport.onChunkFailed({ peerId, chunkId, reason: err?.message || 'verify-error' });
  }
}

async function _serveChunkRequest(transport, peerId, request) {
  try {
    const value = await transport.getChunk(request.chunkId, { peerId, request });
    const bytes = value?.bytes instanceof Uint8Array ? value.bytes : value instanceof Uint8Array ? value : null;
    const fragmentRoot = value?.fragmentRoot ?? request.fragmentRoot;
    if (!bytes || fragmentRoot !== request.fragmentRoot) return;
    enqueueChunkSend(transport, {
      peerId,
      chunkId: request.chunkId,
      chunkBytes: bytes,
      fragmentRoot,
      lane: Number.isInteger(request.lane) ? request.lane : PRIORITY_LANE.NORMAL,
    });
  } catch (_) { /* an unavailable local chunk is a silent miss; requester retries another provider */ }
}

function _allowRequest(transport, peerId, now = Date.now()) {
  let bucket = transport._requestPeers.get(peerId);
  if (!bucket) {
    if (transport._requestPeers.size >= MAX_REQUEST_PEERS) {
      const oldest = transport._requestPeers.keys().next().value;
      transport._requestPeers.delete(oldest);
    }
    bucket = { tokens: REQUEST_BURST, at: now };
    transport._requestPeers.set(peerId, bucket);
  }
  const elapsed = Math.max(0, now - bucket.at) / 1000;
  bucket.tokens = Math.min(REQUEST_BURST, bucket.tokens + elapsed * REQUESTS_PER_SECOND);
  bucket.at = now;
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

function _resolvePending(transport, peerId, chunkId, bytes) {
  const key = `${peerId}:${chunkId}`;
  const pending = transport._pendingRequests.get(key);
  if (!pending) return;
  clearTimeout(pending.timer);
  transport._pendingRequests.delete(key);
  pending.resolve(bytes);
}

function _rejectPending(transport, peerId, chunkId, reason) {
  const key = `${peerId}:${chunkId}`;
  const pending = transport._pendingRequests.get(key);
  if (!pending) return;
  clearTimeout(pending.timer);
  transport._pendingRequests.delete(key);
  pending.reject(new Error(`chunk verification failed: ${reason}`));
}
