// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * RealmChronicle.js — signed SHA-256 causal history for a Realm branch.
 *
 * Chronicle events contain semantic records and state-root transitions, not
 * simulation ticks.  The implementation is storage-agnostic so the same
 * verification code is used for local persistence, Capsule import, and peers.
 */

import { canonicalBytes, canonicalize, hashIdSecure } from '../../../state/util/canonical.js';
import { verifyWithKey } from '../../../state/authority/Identity.js';
import { byteSignature } from '../../../core/math/FormatMath.js';
import {
  REALM_ID_TYPE,
  assertRealmId,
  isRealmId,
  realmKeyFingerprint,
} from '../addressing/RealmIds.js';

export const CHRONICLE_EVENT_FORMAT = 'realm-chronicle-event-v1';
export const CHRONICLE_FORMAT = 'realm-chronicle-v1';

const MAX_PARENTS = 32;
const MAX_OPERATION_BYTES = 256;
const MAX_PAYLOAD_BYTES = 1024 * 1024;
const encoder = new TextEncoder();

const ACTOR_TYPES = new Set([
  REALM_ID_TYPE.USER,
  REALM_ID_TYPE.NAVI,
  REALM_ID_TYPE.AGENT,
  REALM_ID_TYPE.ORGANIZATION,
  REALM_ID_TYPE.DEVICE,
  REALM_ID_TYPE.MEMBERSHIP,
]);

function cleanOperation(value) {
  const operation = String(value ?? '').trim();
  if (!operation || encoder.encode(operation).byteLength > MAX_OPERATION_BYTES || !/^[a-z][a-z0-9._:-]*$/.test(operation)) {
    throw new TypeError('Chronicle operation is invalid');
  }
  return operation;
}

function assertActorId(actorId) {
  const valid = [...ACTOR_TYPES].some((type) => isRealmId(actorId, type));
  if (!valid) throw new TypeError('Chronicle actor ID has an unsupported type');
  return actorId;
}

function assertSecureRoot(value, label, allowNull = true) {
  if (value === null && allowNull) return null;
  if (typeof value !== 'string' || !/^sha256:256:[0-9a-f]{64}$/.test(value)) {
    throw new TypeError(`${label} must be a tagged SHA-256 root`);
  }
  return value;
}

function normalizeParents(parents) {
  if (!Array.isArray(parents) || parents.length > MAX_PARENTS) throw new TypeError('Chronicle parents must be a bounded list');
  const normalized = [...new Set(parents.map((parent) => {
    const value = String(parent ?? '');
    if (!/^sha256:256:[0-9a-f]{64}$/.test(value)) throw new TypeError('Chronicle parent ID is invalid');
    return value;
  }))].sort();
  if (normalized.length !== parents.length) throw new TypeError('Chronicle parents must be unique');
  return Object.freeze(normalized);
}

function signatureHex(value) {
  if (typeof value === 'string' && /^[0-9a-f]+$/i.test(value)) return value.toLowerCase();
  if (value instanceof Uint8Array || ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    return byteSignature(value instanceof ArrayBuffer ? new Uint8Array(value) : value);
  }
  throw new Error('Chronicle signer returned an invalid signature');
}

function unsignedEvent(event) {
  const copy = { ...event };
  delete copy.eventId;
  delete copy.signatureHex;
  return copy;
}

function eventPayload(event) {
  return canonicalBytes(unsignedEvent(event), {
    domain: 'realm-network.chronicle.signature',
    schemaVersion: CHRONICLE_EVENT_FORMAT,
  });
}

async function computeEventId(event) {
  return hashIdSecure(unsignedEvent(event), {
    domain: 'realm-network.chronicle',
    schemaVersion: CHRONICLE_EVENT_FORMAT,
  });
}

/** Create a complete signed Chronicle event. */
export async function createChronicleEvent(input, signer) {
  if (!signer || signer.secure === false || typeof signer.sign !== 'function') throw new Error('a secure Chronicle signer is required');
  assertRealmId(input?.realmId, REALM_ID_TYPE.REALM, 'Realm ID');
  assertRealmId(input?.branchId, REALM_ID_TYPE.BRANCH, 'Branch ID');
  assertActorId(input?.actorId);
  const sequence = Number(input.sequence);
  const occurredAt = Number(input.occurredAt ?? Date.now());
  if (!Number.isSafeInteger(sequence) || sequence < 0 || !Number.isSafeInteger(occurredAt) || occurredAt < 0) {
    throw new TypeError('Chronicle sequence or timestamp is invalid');
  }
  const payload = input.payload ?? null;
  const serializedPayload = canonicalize(payload);
  if (encoder.encode(serializedPayload).byteLength > MAX_PAYLOAD_BYTES) throw new TypeError('Chronicle payload exceeds the size limit');
  const publicKeyHex = String(signer.publicKeyHex ?? '').toLowerCase();
  const fingerprint = await realmKeyFingerprint(publicKeyHex);
  if (fingerprint !== signer.fingerprint) throw new Error('Chronicle signer fingerprint does not match its key');
  const event = {
    format: CHRONICLE_EVENT_FORMAT,
    realmId: input.realmId,
    branchId: input.branchId,
    sequence,
    parents: normalizeParents(input.parents ?? []),
    actorId: input.actorId,
    capabilityId: input.capabilityId ?? null,
    operation: cleanOperation(input.operation),
    payload,
    payloadHash: await hashIdSecure(payload, {
      domain: 'realm-network.chronicle.payload',
      schemaVersion: CHRONICLE_EVENT_FORMAT,
    }),
    stateRootBefore: assertSecureRoot(input.stateRootBefore ?? null, 'stateRootBefore'),
    stateRootAfter: assertSecureRoot(input.stateRootAfter ?? null, 'stateRootAfter'),
    checkpointId: input.checkpointId ?? null,
    occurredAt,
    signer: Object.freeze({ fingerprint, publicKeyHex }),
  };
  if (event.checkpointId !== null) assertRealmId(event.checkpointId, REALM_ID_TYPE.CHECKPOINT, 'Checkpoint ID');
  const eventId = await computeEventId(event);
  const signature = signatureHex(await signer.sign(eventPayload(event)));
  return Object.freeze({ ...event, eventId, signatureHex: signature });
}

/** Verify content hash, event hash, signer fingerprint, signature, and optional actor binding. */
export async function verifyChronicleEvent(event, options = {}) {
  try {
    if (!event || event.format !== CHRONICLE_EVENT_FORMAT) return { valid: false, reason: 'malformed-event' };
    assertRealmId(event.realmId, REALM_ID_TYPE.REALM);
    assertRealmId(event.branchId, REALM_ID_TYPE.BRANCH);
    assertActorId(event.actorId);
    if (!Number.isSafeInteger(event.sequence) || event.sequence < 0 || !Number.isSafeInteger(event.occurredAt) || event.occurredAt < 0) {
      return { valid: false, reason: 'invalid-event-clock' };
    }
    const parents = normalizeParents(event.parents);
    if (parents.some((parent, index) => parent !== event.parents[index])) return { valid: false, reason: 'noncanonical-parents' };
    cleanOperation(event.operation);
    if (encoder.encode(canonicalize(event.payload)).byteLength > MAX_PAYLOAD_BYTES) return { valid: false, reason: 'payload-too-large' };
    if (await hashIdSecure(event.payload, {
      domain: 'realm-network.chronicle.payload',
      schemaVersion: CHRONICLE_EVENT_FORMAT,
    }) !== event.payloadHash) return { valid: false, reason: 'payload-hash-mismatch' };
    assertSecureRoot(event.stateRootBefore, 'stateRootBefore');
    assertSecureRoot(event.stateRootAfter, 'stateRootAfter');
    if (event.checkpointId !== null) assertRealmId(event.checkpointId, REALM_ID_TYPE.CHECKPOINT);
    const fingerprint = await realmKeyFingerprint(event.signer.publicKeyHex);
    if (fingerprint !== event.signer.fingerprint) return { valid: false, reason: 'signer-fingerprint-mismatch' };
    if (await computeEventId(event) !== event.eventId) return { valid: false, reason: 'event-id-mismatch' };
    if (!(await verifyWithKey(event.signer.publicKeyHex, eventPayload(event), event.signatureHex))) {
      return { valid: false, reason: 'event-signature-invalid' };
    }
    if (typeof options.authorizeActor === 'function'
      && !(await options.authorizeActor(event.actorId, event.signer.fingerprint, event))) {
      return { valid: false, reason: 'event-actor-unauthorized' };
    }
    return { valid: true, eventId: event.eventId, signerFingerprint: fingerprint };
  } catch (error) {
    return { valid: false, reason: error?.message || 'event-verification-failed' };
  }
}

export class RealmChronicle {
  constructor({ realmId, branchId, authorizeActor = null } = {}) {
    this.realmId = assertRealmId(realmId, REALM_ID_TYPE.REALM, 'Realm ID');
    this.branchId = assertRealmId(branchId, REALM_ID_TYPE.BRANCH, 'Branch ID');
    this._authorizeActor = authorizeActor;
    this._events = new Map();
    this._heads = new Set();
  }

  get size() { return this._events.size; }
  get heads() { return Object.freeze([...this._heads].sort()); }

  has(eventId) { return this._events.has(eventId); }
  get(eventId) { return this._events.get(eventId) ?? null; }

  async append(event) {
    const verification = await verifyChronicleEvent(event, { authorizeActor: this._authorizeActor });
    if (!verification.valid) throw new Error(`Chronicle event rejected: ${verification.reason}`);
    if (event.realmId !== this.realmId || event.branchId !== this.branchId) throw new Error('Chronicle event belongs to another Realm or Branch');
    if (this._events.has(event.eventId)) return Object.freeze({ appended: false, duplicate: true, eventId: event.eventId });
    if (this._events.size === 0) {
      if (event.sequence !== 0 || event.parents.length !== 0) throw new Error('Chronicle genesis must have sequence 0 and no parents');
    } else {
      if (event.parents.length === 0) throw new Error('non-genesis Chronicle event requires a causal parent');
      const parentEvents = event.parents.map((parentId) => this._events.get(parentId));
      if (parentEvents.some((parent) => !parent)) throw new Error('Chronicle event references an unknown parent');
      if (parentEvents.some((parent) => parent.sequence >= event.sequence)) throw new Error('Chronicle sequence must follow every parent');
      if (event.parents.length === 1 && event.stateRootBefore !== null && parentEvents[0].stateRootAfter !== null
        && event.stateRootBefore !== parentEvents[0].stateRootAfter) {
        throw new Error('Chronicle state root does not continue its parent');
      }
    }
    this._events.set(event.eventId, event);
    for (const parent of event.parents) this._heads.delete(parent);
    this._heads.add(event.eventId);
    return Object.freeze({ appended: true, duplicate: false, eventId: event.eventId, heads: this.heads });
  }

  events() {
    return [...this._events.values()].sort((left, right) => left.sequence - right.sequence || left.eventId.localeCompare(right.eventId));
  }

  snapshot() {
    return Object.freeze({
      format: CHRONICLE_FORMAT,
      realmId: this.realmId,
      branchId: this.branchId,
      heads: this.heads,
      events: Object.freeze(this.events()),
    });
  }
}

/** Verify and rebuild a complete Chronicle snapshot or event list. */
export async function verifyChronicle(value, options = {}) {
  try {
    const events = Array.isArray(value) ? value : value?.events;
    if (!Array.isArray(events) || events.length === 0) return { valid: false, reason: 'Chronicle is empty' };
    const realmId = value?.realmId ?? events[0].realmId;
    const branchId = value?.branchId ?? events[0].branchId;
    const chronicle = new RealmChronicle({ realmId, branchId, authorizeActor: options.authorizeActor });
    for (const event of [...events].sort((left, right) => left.sequence - right.sequence || left.eventId.localeCompare(right.eventId))) {
      await chronicle.append(event);
    }
    if (!Array.isArray(value) && Array.isArray(value.heads)) {
      const expected = [...value.heads].sort();
      const actual = [...chronicle.heads];
      if (expected.length !== actual.length || expected.some((head, index) => head !== actual[index])) {
        return { valid: false, reason: 'Chronicle head mismatch' };
      }
    }
    return { valid: true, chronicle, heads: chronicle.heads, events: chronicle.size };
  } catch (error) {
    return { valid: false, reason: error?.message || 'Chronicle verification failed' };
  }
}

