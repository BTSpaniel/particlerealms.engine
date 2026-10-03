// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Semantic replication records, idempotent inboxes, resumable outboxes, and divergence evidence. */

import { canonicalBytes, canonicalize, hashIdSecure } from '../../../state/util/canonical.js';
import { verifyWithKey } from '../../../state/authority/Identity.js';
import { byteSignature } from '../../../core/math/FormatMath.js';
import { assertRealmId, realmKeyFingerprint } from '../addressing/RealmIds.js';

export const SEMANTIC_RECORD_FORMAT = 'realm-semantic-record-v1';
export const SEMANTIC_DELTA_FORMAT = 'realm-semantic-delta-v1';
export const SEMANTIC_CHECKPOINT_FORMAT = 'realm-semantic-checkpoint-v1';
export const SEMANTIC_ACK_FORMAT = 'realm-semantic-ack-v1';

const FORMATS = new Set([SEMANTIC_RECORD_FORMAT, SEMANTIC_DELTA_FORMAT, SEMANTIC_CHECKPOINT_FORMAT]);
const MAX_PARENTS = 64;
const MAX_PAYLOAD_BYTES = 4 * 1024 * 1024;
const encoder = new TextEncoder();

function safeInteger(value, name, minimum = 0) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum) throw new TypeError(`${name} must be an integer >= ${minimum}`);
  return number;
}

function boundedText(value, name, max = 256) {
  const text = String(value ?? '').trim();
  if (!text || text.length > max) throw new TypeError(`${name} must be a non-empty bounded string`);
  return text;
}

function normalizeParents(parents = []) {
  if (!Array.isArray(parents) || parents.length > MAX_PARENTS) throw new TypeError('Semantic parents must be a bounded array');
  const values = [...new Set(parents.map(parent => boundedText(parent, 'semantic parent', 96)))].sort();
  if (values.length !== parents.length) throw new TypeError('Semantic parents must be unique');
  return Object.freeze(values);
}

function signatureHex(value) {
  if (typeof value === 'string' && /^[0-9a-f]+$/i.test(value)) return value.toLowerCase();
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    return byteSignature(value instanceof ArrayBuffer ? new Uint8Array(value) : value);
  }
  throw new TypeError('Semantic signer returned an invalid signature');
}

function unsigned(value) {
  const copy = { ...value };
  delete copy.envelopeId;
  delete copy.signatureHex;
  return copy;
}

function signingBytes(value) {
  return canonicalBytes(unsigned(value), {
    domain: 'realm-network.semantic-replication.signature',
    schemaVersion: value.format,
  });
}

async function envelopeId(value) {
  return hashIdSecure(unsigned(value), {
    domain: 'realm-network.semantic-replication',
    schemaVersion: value.format,
  });
}

function validateBase(input) {
  if (!FORMATS.has(input.format)) throw new TypeError('Unknown semantic envelope format');
  const payload = input.payload ?? null;
  if (encoder.encode(canonicalize(payload)).byteLength > MAX_PAYLOAD_BYTES) throw new RangeError('Semantic payload exceeds the size limit');
  return {
    format: input.format,
    realmId: assertRealmId(input.realmId, 'realm', 'Realm ID'),
    branchId: assertRealmId(input.branchId, 'branch', 'Branch ID'),
    actorId: assertRealmId(input.actorId, null, 'semantic actor ID'),
    resourceId: assertRealmId(input.resourceId, null, 'semantic resource ID'),
    recordType: boundedText(input.recordType, 'semantic record type'),
    sequence: safeInteger(input.sequence, 'semantic sequence'),
    parents: normalizeParents(input.parents),
    authority: Object.freeze({
      leaseId: boundedText(input.authority?.leaseId, 'authority lease ID', 96),
      fencingToken: safeInteger(input.authority?.fencingToken, 'authority fencing token', 1),
    }),
    baseEnvelopeId: input.baseEnvelopeId == null ? null : boundedText(input.baseEnvelopeId, 'baseEnvelopeId', 96),
    checkpointRoot: input.checkpointRoot == null ? null : boundedText(input.checkpointRoot, 'checkpointRoot', 96),
    occurredAt: safeInteger(input.occurredAt ?? Date.now(), 'occurredAt'),
    payload,
  };
}

async function finish(input, signer) {
  if (!signer || signer.secure === false || typeof signer.sign !== 'function') throw new Error('A secure semantic signer is required');
  const record = validateBase(input);
  const payloadHash = await hashIdSecure(record.payload, {
    domain: 'realm-network.semantic-replication.payload',
    schemaVersion: record.recordType,
  });
  const publicKeyHex = String(signer.publicKeyHex ?? '').toLowerCase();
  const fingerprint = await realmKeyFingerprint(publicKeyHex);
  if (signer.fingerprint && signer.fingerprint !== fingerprint) throw new Error('Semantic signer fingerprint does not match its key');
  const signed = { ...record, payloadHash, signer: Object.freeze({ publicKeyHex, fingerprint }) };
  const id = await envelopeId(signed);
  const signature = signatureHex(await signer.sign(signingBytes(signed)));
  return Object.freeze({ ...signed, envelopeId: id, signatureHex: signature });
}

export function createSemanticRecord(input, signer) {
  return finish({ ...input, format: SEMANTIC_RECORD_FORMAT, baseEnvelopeId: null }, signer);
}

export function createSemanticDelta(input, signer) {
  if (!input?.baseEnvelopeId) throw new TypeError('Semantic delta requires baseEnvelopeId');
  return finish({ ...input, format: SEMANTIC_DELTA_FORMAT }, signer);
}

export function createSemanticCheckpoint(input, signer) {
  if (!input?.checkpointRoot) throw new TypeError('Semantic checkpoint requires checkpointRoot');
  return finish({ ...input, format: SEMANTIC_CHECKPOINT_FORMAT }, signer);
}

export async function verifySemanticEnvelope(value, options = {}) {
  try {
    const normalized = validateBase(value);
    const expectedPayload = await hashIdSecure(normalized.payload, {
      domain: 'realm-network.semantic-replication.payload',
      schemaVersion: normalized.recordType,
    });
    if (value.payloadHash !== expectedPayload) return { valid: false, reason: 'payload-hash-mismatch' };
    const fingerprint = await realmKeyFingerprint(value.signer?.publicKeyHex);
    if (fingerprint !== value.signer?.fingerprint) return { valid: false, reason: 'signer-fingerprint-mismatch' };
    const expectedId = await envelopeId(value);
    if (value.envelopeId !== expectedId) return { valid: false, reason: 'envelope-id-mismatch' };
    if (!(await verifyWithKey(value.signer.publicKeyHex, signingBytes(value), value.signatureHex))) {
      return { valid: false, reason: 'signature-invalid' };
    }
    if (typeof options.authorize === 'function' && !(await options.authorize(value))) {
      return { valid: false, reason: 'authority-rejected' };
    }
    return { valid: true, envelopeId: expectedId, signerFingerprint: fingerprint };
  } catch (error) {
    return { valid: false, reason: error?.message ?? 'semantic-envelope-invalid' };
  }
}

export class SemanticInbox {
  constructor({ apply, verify = verifySemanticEnvelope, maxReceipts = 100_000, logger = () => {} } = {}) {
    if (typeof apply !== 'function' || typeof verify !== 'function' || typeof logger !== 'function') throw new TypeError('SemanticInbox hooks are invalid');
    this.apply = apply;
    this.verify = verify;
    this.maxReceipts = safeInteger(maxReceipts, 'maxReceipts', 1);
    this.logger = logger;
    this.receipts = new Map();
  }

  async receive(envelope) {
    if (this.receipts.has(envelope?.envelopeId)) return Object.freeze({ accepted: true, duplicate: true, receipt: this.receipts.get(envelope.envelopeId) });
    if (this.receipts.size >= this.maxReceipts) return Object.freeze({ accepted: false, reason: 'receipt-capacity' });
    const checked = await this.verify(envelope);
    if (!checked.valid) return Object.freeze({ accepted: false, reason: checked.reason });
    const applied = await this.apply(envelope);
    const receipt = Object.freeze({
      format: SEMANTIC_ACK_FORMAT,
      envelopeId: envelope.envelopeId,
      applied: applied !== false,
      receivedAt: Date.now(),
    });
    this.receipts.set(envelope.envelopeId, receipt);
    this.logger({ component: 'semantic-inbox', event: 'envelope.applied', envelopeId: envelope.envelopeId });
    return Object.freeze({ accepted: true, duplicate: false, receipt });
  }
}

export class SemanticOutbox {
  constructor({ retryBaseMs = 1000, maxAttempts = 12, now = () => Date.now() } = {}) {
    this.retryBaseMs = safeInteger(retryBaseMs, 'retryBaseMs', 1);
    this.maxAttempts = safeInteger(maxAttempts, 'maxAttempts', 1);
    if (typeof now !== 'function') throw new TypeError('SemanticOutbox now hook is invalid');
    this.now = now;
    this.pending = new Map();
    this.acknowledged = new Set();
  }

  enqueue(envelope) {
    if (!envelope?.envelopeId) throw new TypeError('Outbox envelope ID is required');
    if (this.acknowledged.has(envelope.envelopeId)) return false;
    if (!this.pending.has(envelope.envelopeId)) {
      this.pending.set(envelope.envelopeId, { envelope, attempts: 0, nextAttemptAt: this.now() });
    }
    return true;
  }

  due(at = this.now(), limit = 128) {
    const output = [];
    for (const entry of this.pending.values()) {
      if (output.length >= limit) break;
      if (entry.attempts < this.maxAttempts && entry.nextAttemptAt <= at) output.push(entry.envelope);
    }
    return Object.freeze(output);
  }

  markAttempt(envelopeId, at = this.now()) {
    const entry = this.pending.get(envelopeId);
    if (!entry) return false;
    entry.attempts += 1;
    entry.nextAttemptAt = at + Math.min(60_000, this.retryBaseMs * (2 ** Math.min(entry.attempts - 1, 10)));
    return true;
  }

  acknowledge(receipt) {
    if (!receipt || receipt.format !== SEMANTIC_ACK_FORMAT || !receipt.envelopeId) return false;
    this.pending.delete(receipt.envelopeId);
    this.acknowledged.add(receipt.envelopeId);
    return true;
  }

  snapshot() {
    return Object.freeze({ pending: this.pending.size, acknowledged: this.acknowledged.size });
  }
}

export function detectSemanticDivergence(local, remote) {
  const localHeads = [...new Set(local?.heads ?? [])].sort();
  const remoteHeads = [...new Set(remote?.heads ?? [])].sort();
  const sameHeads = canonicalize(localHeads) === canonicalize(remoteHeads);
  const sameCheckpoint = (local?.checkpointRoot ?? null) === (remote?.checkpointRoot ?? null);
  return Object.freeze({
    diverged: !sameHeads || !sameCheckpoint,
    sameHeads,
    sameCheckpoint,
    localOnly: Object.freeze(localHeads.filter(head => !remoteHeads.includes(head))),
    remoteOnly: Object.freeze(remoteHeads.filter(head => !localHeads.includes(head))),
  });
}

