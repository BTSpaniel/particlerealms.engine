// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { canonicalize } from '../../../state/util/canonical.js';
import { verifyWithKey } from '../../../state/authority/Identity.js';

export const REALM_LINK_PROTOCOL = 'realm-link/1';
export const REALM_LINK_FRAME = Object.freeze({
  HELLO: 'REALM_LINK_HELLO',
  HELLO_ACK: 'REALM_LINK_HELLO_ACK',
  HELLO_CONFIRM: 'REALM_LINK_HELLO_CONFIRM',
  DATA: 'REALM_LINK_DATA',
  MIGRATE: 'REALM_LINK_MIGRATE',
  MIGRATE_ACK: 'REALM_LINK_MIGRATE_ACK',
  GOODBYE: 'REALM_LINK_GOODBYE',
});

const FRAME_TYPES = new Set(Object.values(REALM_LINK_FRAME));
const MAX_FRAME_CANONICAL_CHARS = 256 * 1024;
const DEFAULT_MAX_AGE_MS = 5 * 60 * 1000;
const DEFAULT_FUTURE_SKEW_MS = 30 * 1000;

function boundedString(value, name, max = 1024) {
  const result = String(value ?? '').trim();
  if (!result || result.length > max) throw new TypeError(`${name} must be a non-empty bounded string`);
  return result;
}

export function unsignedRealmLinkFrame(frame) {
  const { signature, signerFingerprint, signerPublicKeyHex, ...unsigned } = frame ?? {};
  return unsigned;
}

/** Build and sign one control/data frame using the existing authority signer. */
export async function signRealmLinkFrame({
  linkId,
  realmId,
  branchId,
  senderPeerId,
  sessionEpoch,
  sequence,
  messageId,
  issuedAt,
  type,
  payload = null,
  signer,
} = {}) {
  if (!FRAME_TYPES.has(type)) throw new TypeError(`unsupported Realm Link frame type: ${type}`);
  if (!signer || typeof signer.sign !== 'function') throw new TypeError('Realm Link frame requires a signer');
  if (signer.secure === false) throw new Error('Realm Link refuses an insecure fallback signer');
  if (!Number.isSafeInteger(sessionEpoch) || sessionEpoch <= 0) throw new RangeError('sessionEpoch must be a positive safe integer');
  if (!Number.isSafeInteger(sequence) || sequence <= 0) throw new RangeError('sequence must be a positive safe integer');
  const unsigned = Object.freeze({
    protocol: REALM_LINK_PROTOCOL,
    version: 1,
    type,
    linkId: boundedString(linkId, 'linkId'),
    realmId: boundedString(realmId, 'realmId'),
    branchId: boundedString(branchId, 'branchId'),
    senderPeerId: boundedString(senderPeerId, 'senderPeerId'),
    sessionEpoch,
    sequence,
    messageId: boundedString(messageId, 'messageId'),
    issuedAt: Number(issuedAt),
    payload,
  });
  const body = canonicalize(unsigned);
  if (body.length > MAX_FRAME_CANONICAL_CHARS) throw new RangeError('Realm Link frame exceeds control/data size limit');
  const signature = await signer.sign(body);
  if (!signature) throw new Error('Realm Link signer did not produce a signature');
  return Object.freeze({
    ...unsigned,
    signerFingerprint: boundedString(signer.fingerprint, 'signer fingerprint'),
    signerPublicKeyHex: boundedString(signer.publicKeyHex, 'signer public key', 4096),
    signature,
  });
}

/** Cryptographically validate a frame. Passport/device authorization is a separate required hook. */
export async function verifyRealmLinkFrame(frame, {
  linkId,
  realmId,
  branchId,
  now = Date.now(),
  maxAgeMs = DEFAULT_MAX_AGE_MS,
  futureSkewMs = DEFAULT_FUTURE_SKEW_MS,
} = {}) {
  try {
    if (!frame || typeof frame !== 'object' || Array.isArray(frame)) return { ok: false, reason: 'not-object' };
    if (frame.protocol !== REALM_LINK_PROTOCOL || frame.version !== 1 || !FRAME_TYPES.has(frame.type)) {
      return { ok: false, reason: 'bad-protocol' };
    }
    if (frame.linkId !== linkId || frame.realmId !== realmId || frame.branchId !== branchId) {
      return { ok: false, reason: 'wrong-link-scope' };
    }
    boundedString(frame.senderPeerId, 'senderPeerId');
    boundedString(frame.messageId, 'messageId');
    if (!Number.isSafeInteger(frame.sessionEpoch) || frame.sessionEpoch <= 0
      || !Number.isSafeInteger(frame.sequence) || frame.sequence <= 0) {
      return { ok: false, reason: 'bad-ordering' };
    }
    if (!Number.isFinite(frame.issuedAt) || frame.issuedAt < now - maxAgeMs || frame.issuedAt > now + futureSkewMs) {
      return { ok: false, reason: 'stale-or-future' };
    }
    if (!frame.signature || !frame.signerPublicKeyHex || frame.signerFingerprint !== frame.senderPeerId) {
      return { ok: false, reason: 'identity-binding' };
    }
    const unsigned = unsignedRealmLinkFrame(frame);
    const body = canonicalize(unsigned);
    if (body.length > MAX_FRAME_CANONICAL_CHARS) return { ok: false, reason: 'oversize' };
    const signatureOk = await verifyWithKey(frame.signerPublicKeyHex, body, frame.signature);
    return signatureOk ? { ok: true, reason: null } : { ok: false, reason: 'bad-signature' };
  } catch (_) {
    return { ok: false, reason: 'malformed' };
  }
}

/** Sliding sequence window supports limited cross-transport reordering while rejecting replay. */
export function createRealmLinkReplayWindow({ width = 256, maxSequence = 0, seen = [] } = {}) {
  if (!Number.isSafeInteger(width) || width < 8 || width > 4096) throw new RangeError('replay window width must be 8..4096');
  if (!Number.isSafeInteger(maxSequence) || maxSequence < 0) throw new RangeError('invalid replay maxSequence');
  const accepted = new Set(seen.filter((value) => Number.isSafeInteger(value) && value > Math.max(0, maxSequence - width)));
  return { width, maxSequence, seen: accepted, messageIds: new Map() };
}

export function acceptRealmLinkReplay(window, frame, { now = Date.now(), messageTtlMs = 10 * 60 * 1000 } = {}) {
  for (const [messageId, expiresAt] of window.messageIds) {
    if (expiresAt <= now) window.messageIds.delete(messageId);
  }
  if (window.messageIds.has(frame.messageId)) return { ok: false, reason: 'duplicate-message' };
  const floor = Math.max(0, window.maxSequence - window.width);
  if (frame.sequence <= floor) return { ok: false, reason: 'sequence-too-old' };
  if (window.seen.has(frame.sequence)) return { ok: false, reason: 'duplicate-sequence' };
  window.seen.add(frame.sequence);
  window.maxSequence = Math.max(window.maxSequence, frame.sequence);
  const nextFloor = Math.max(0, window.maxSequence - window.width);
  for (const sequence of window.seen) if (sequence <= nextFloor) window.seen.delete(sequence);
  window.messageIds.set(frame.messageId, now + messageTtlMs);
  return { ok: true, reason: null };
}

export function snapshotRealmLinkReplayWindow(window) {
  return Object.freeze({
    width: window.width,
    maxSequence: window.maxSequence,
    seen: Object.freeze([...window.seen].sort((a, b) => a - b)),
  });
}
