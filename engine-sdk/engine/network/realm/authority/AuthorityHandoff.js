// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Checkpoint-backed, signed authority handoff state machine. */

import { canonicalBytes, hashIdSecure } from '../../../state/util/canonical.js';
import { verifyWithKey } from '../../../state/authority/Identity.js';
import { byteSignature } from '../../../core/math/FormatMath.js';
import { assertRealmId, realmKeyFingerprint } from '../addressing/RealmIds.js';

export const AUTHORITY_HANDOFF_FORMAT = 'realm-authority-handoff-v1';
export const AUTHORITY_HANDOFF_STAGE = Object.freeze({
  OFFER: 'offer',
  VALIDATION: 'validation',
  ACCEPTANCE: 'acceptance',
  RELEASE: 'release',
  ROLLBACK: 'rollback',
});

const STAGES = new Set(Object.values(AUTHORITY_HANDOFF_STAGE));
const NEXT_STAGE = Object.freeze({
  offer: 'validation',
  validation: 'acceptance',
  acceptance: 'release',
});

function integer(value, name, minimum = 0) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum) throw new TypeError(`${name} must be an integer >= ${minimum}`);
  return number;
}

function text(value, name, max = 1024) {
  const result = String(value ?? '').trim();
  if (!result || result.length > max) throw new TypeError(`${name} must be a non-empty bounded string`);
  return result;
}

function hexSignature(value) {
  if (typeof value === 'string' && /^[0-9a-f]+$/i.test(value)) return value.toLowerCase();
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    return byteSignature(value instanceof ArrayBuffer ? new Uint8Array(value) : value);
  }
  throw new TypeError('Handoff signer returned an invalid signature');
}

function unsigned(message) {
  const output = { ...message };
  delete output.messageId;
  delete output.signatureHex;
  return output;
}

function signingBytes(message) {
  return canonicalBytes(unsigned(message), {
    domain: 'realm-network.authority-handoff.signature',
    schemaVersion: AUTHORITY_HANDOFF_FORMAT,
  });
}

async function messageId(message) {
  return hashIdSecure(unsigned(message), {
    domain: 'realm-network.authority-handoff',
    schemaVersion: AUTHORITY_HANDOFF_FORMAT,
  });
}

function normalize(input) {
  const stage = text(input.stage, 'handoff stage', 32);
  if (!STAGES.has(stage)) throw new TypeError('Unsupported authority handoff stage');
  return {
    format: AUTHORITY_HANDOFF_FORMAT,
    handoffId: text(input.handoffId, 'handoffId', 96),
    stage,
    realmId: assertRealmId(input.realmId, 'realm', 'Realm ID'),
    branchId: assertRealmId(input.branchId, 'branch', 'Branch ID'),
    resourceId: assertRealmId(input.resourceId, null, 'authority resource ID'),
    sourceHolderId: assertRealmId(input.sourceHolderId, null, 'source holder ID'),
    targetHolderId: assertRealmId(input.targetHolderId, null, 'target holder ID'),
    currentLeaseId: text(input.currentLeaseId, 'currentLeaseId', 96),
    proposedFencingToken: integer(input.proposedFencingToken, 'proposedFencingToken', 1),
    checkpointId: assertRealmId(input.checkpointId, 'checkpoint', 'checkpoint ID'),
    checkpointRoot: text(input.checkpointRoot, 'checkpointRoot', 96),
    authorityMapRoot: text(input.authorityMapRoot, 'authorityMapRoot', 96),
    previousMessageId: input.previousMessageId == null ? null : text(input.previousMessageId, 'previousMessageId', 96),
    accepted: input.accepted == null ? null : input.accepted === true,
    reason: text(input.reason ?? stage, 'handoff reason'),
    occurredAt: integer(input.occurredAt ?? Date.now(), 'occurredAt'),
  };
}

export async function createAuthorityHandoffMessage(input, signer) {
  if (!signer || signer.secure === false || typeof signer.sign !== 'function') throw new Error('A secure handoff signer is required');
  const message = normalize(input);
  if (message.stage === AUTHORITY_HANDOFF_STAGE.OFFER && message.previousMessageId !== null) {
    throw new Error('Handoff offer cannot have a previous message');
  }
  if (message.stage !== AUTHORITY_HANDOFF_STAGE.OFFER && message.previousMessageId === null) {
    throw new Error('Non-offer handoff messages require previousMessageId');
  }
  const publicKeyHex = String(signer.publicKeyHex ?? '').toLowerCase();
  const fingerprint = await realmKeyFingerprint(publicKeyHex);
  if (signer.fingerprint && signer.fingerprint !== fingerprint) throw new Error('Handoff signer fingerprint does not match its key');
  const signed = { ...message, signer: Object.freeze({ publicKeyHex, fingerprint }) };
  const id = await messageId(signed);
  const signature = hexSignature(await signer.sign(signingBytes(signed)));
  return Object.freeze({ ...signed, messageId: id, signatureHex: signature });
}

export async function verifyAuthorityHandoffMessage(message, options = {}) {
  try {
    const normalized = normalize(message);
    if (normalized.stage === 'offer' ? normalized.previousMessageId !== null : normalized.previousMessageId === null) {
      return { valid: false, reason: 'invalid-stage-parent' };
    }
    const fingerprint = await realmKeyFingerprint(message.signer?.publicKeyHex);
    if (fingerprint !== message.signer?.fingerprint) return { valid: false, reason: 'signer-fingerprint-mismatch' };
    const expected = await messageId(message);
    if (expected !== message.messageId) return { valid: false, reason: 'message-id-mismatch' };
    if (!(await verifyWithKey(message.signer.publicKeyHex, signingBytes(message), message.signatureHex))) {
      return { valid: false, reason: 'signature-invalid' };
    }
    if (typeof options.authorizeSigner === 'function'
      && !(await options.authorizeSigner(message.stage, message.signer.fingerprint, message))) {
      return { valid: false, reason: 'signer-unauthorized' };
    }
    return { valid: true, messageId: expected, fingerprint };
  } catch (error) {
    return { valid: false, reason: error?.message ?? 'handoff-message-invalid' };
  }
}

export class AuthorityHandoffCoordinator {
  constructor({ authorizeSigner, validateCheckpoint, logger = () => {} } = {}) {
    if (typeof authorizeSigner !== 'function' || typeof validateCheckpoint !== 'function' || typeof logger !== 'function') {
      throw new TypeError('AuthorityHandoffCoordinator hooks are invalid');
    }
    this.authorizeSigner = authorizeSigner;
    this.validateCheckpoint = validateCheckpoint;
    this.logger = logger;
    this.handoffs = new Map();
  }

  async accept(message) {
    const verified = await verifyAuthorityHandoffMessage(message, { authorizeSigner: this.authorizeSigner });
    if (!verified.valid) return Object.freeze({ accepted: false, reason: verified.reason });
    const current = this.handoffs.get(message.handoffId);
    if (current?.messages.some(item => item.messageId === message.messageId)) {
      return Object.freeze({ accepted: true, duplicate: true, state: current.status });
    }
    if (message.stage === 'offer') {
      if (current) return Object.freeze({ accepted: false, reason: 'handoff-already-exists' });
      if (!(await this.validateCheckpoint(message))) return Object.freeze({ accepted: false, reason: 'checkpoint-invalid' });
      this.handoffs.set(message.handoffId, { status: 'offered', messages: [message], template: message });
      return Object.freeze({ accepted: true, duplicate: false, state: 'offered' });
    }
    if (!current) return Object.freeze({ accepted: false, reason: 'handoff-not-found' });
    const previous = current.messages[current.messages.length - 1];
    if (message.previousMessageId !== previous.messageId) return Object.freeze({ accepted: false, reason: 'handoff-parent-mismatch' });
    for (const field of ['realmId', 'branchId', 'resourceId', 'sourceHolderId', 'targetHolderId', 'currentLeaseId', 'proposedFencingToken', 'checkpointId', 'checkpointRoot', 'authorityMapRoot']) {
      if (message[field] !== current.template[field]) return Object.freeze({ accepted: false, reason: `handoff-${field}-changed` });
    }
    if (message.stage === 'rollback') {
      current.messages.push(message);
      current.status = 'rolled-back';
      this.logger({ component: 'authority-handoff', event: 'handoff.rolled-back', handoffId: message.handoffId, reason: message.reason });
      return Object.freeze({ accepted: true, duplicate: false, state: current.status });
    }
    if (current.status === 'rolled-back' || current.status === 'complete') return Object.freeze({ accepted: false, reason: 'handoff-terminal' });
    const expected = NEXT_STAGE[previous.stage];
    if (message.stage !== expected) return Object.freeze({ accepted: false, reason: 'handoff-stage-out-of-order' });
    if ((message.stage === 'validation' || message.stage === 'acceptance') && message.accepted !== true) {
      return Object.freeze({ accepted: false, reason: `${message.stage}-not-accepted` });
    }
    if (message.stage === 'validation' && !(await this.validateCheckpoint(message))) {
      return Object.freeze({ accepted: false, reason: 'checkpoint-invalid' });
    }
    current.messages.push(message);
    current.status = message.stage === 'release' ? 'complete' : `${message.stage}d`;
    this.logger({ component: 'authority-handoff', event: `handoff.${message.stage}`, handoffId: message.handoffId });
    return Object.freeze({ accepted: true, duplicate: false, state: current.status });
  }

  status(handoffId) {
    const current = this.handoffs.get(handoffId);
    return current ? Object.freeze({ status: current.status, messages: Object.freeze([...current.messages]) }) : null;
  }
}

