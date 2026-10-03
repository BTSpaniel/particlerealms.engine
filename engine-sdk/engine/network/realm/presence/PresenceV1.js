// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { canonicalize } from '../../../state/util/canonical.js';
import { verifyWithKey } from '../../../state/authority/Identity.js';

export const PRESENCE_PROTOCOL = 'realm-presence/1';
export const PRESENCE_SCHEMA = 'PresenceV1';
export const PRESENCE_STATUS = Object.freeze({
  ONLINE: 'online',
  AWAY: 'away',
  BUSY: 'busy',
  OFFLINE: 'offline',
});

const VALID_STATUS = new Set(Object.values(PRESENCE_STATUS));
const MAX_TTL_MS = 120_000;
const DEFAULT_TTL_MS = 30_000;
const MAX_CANONICAL_CHARS = 32 * 1024;

function boundedString(value, name, max = 1024) {
  const result = String(value ?? '').trim();
  if (!result || result.length > max) throw new TypeError(`${name} must be a non-empty bounded string`);
  return result;
}

function unsignedPresence(record) {
  const { signature, signerFingerprint, signerPublicKeyHex, ...unsigned } = record ?? {};
  return unsigned;
}

export function createPresenceV1({
  realmId,
  branchId,
  actorId,
  deviceId,
  sessionId,
  sequence,
  status = PRESENCE_STATUS.ONLINE,
  activity = null,
  location = null,
  issuedAt = Date.now(),
  ttlMs = DEFAULT_TTL_MS,
} = {}) {
  if (!Number.isSafeInteger(sequence) || sequence <= 0) throw new RangeError('presence sequence must be a positive safe integer');
  if (!VALID_STATUS.has(status)) throw new TypeError(`invalid presence status: ${status}`);
  if (!Number.isFinite(issuedAt)) throw new TypeError('presence issuedAt must be finite');
  if (!Number.isFinite(ttlMs) || ttlMs <= 0 || ttlMs > MAX_TTL_MS) throw new RangeError(`presence ttlMs must be 1..${MAX_TTL_MS}`);
  const record = Object.freeze({
    protocol: PRESENCE_PROTOCOL,
    schema: PRESENCE_SCHEMA,
    version: 1,
    realmId: boundedString(realmId, 'realmId'),
    branchId: boundedString(branchId, 'branchId'),
    actorId: boundedString(actorId, 'actorId'),
    deviceId: boundedString(deviceId, 'deviceId'),
    sessionId: boundedString(sessionId, 'sessionId'),
    sequence,
    status,
    activity,
    location,
    issuedAt,
    expiresAt: issuedAt + ttlMs,
  });
  if (canonicalize(record).length > MAX_CANONICAL_CHARS) throw new RangeError('presence record exceeds size limit');
  return record;
}

export async function signPresenceV1(record, signer) {
  if (!signer || typeof signer.sign !== 'function') throw new TypeError('presence requires a signer');
  if (signer.secure === false) throw new Error('presence refuses an insecure fallback signer');
  const checked = createPresenceV1({ ...record, ttlMs: record.expiresAt - record.issuedAt });
  const signature = await signer.sign(canonicalize(checked));
  if (!signature) throw new Error('presence signer did not produce a signature');
  return Object.freeze({
    ...checked,
    signerFingerprint: boundedString(signer.fingerprint, 'signer fingerprint'),
    signerPublicKeyHex: boundedString(signer.publicKeyHex, 'signer public key', 4096),
    signature,
  });
}

/** Verify signature, expiry, and Passport/device key authorization. */
export async function verifyPresenceV1(record, {
  authorizeKey,
  now = Date.now(),
  futureSkewMs = 30_000,
} = {}) {
  if (typeof authorizeKey !== 'function') return { ok: false, reason: 'missing-key-authorizer' };
  try {
    if (!record || record.protocol !== PRESENCE_PROTOCOL || record.schema !== PRESENCE_SCHEMA || record.version !== 1) {
      return { ok: false, reason: 'bad-protocol' };
    }
    if (!Number.isSafeInteger(record.sequence) || record.sequence <= 0 || !VALID_STATUS.has(record.status)) {
      return { ok: false, reason: 'malformed' };
    }
    if (!Number.isFinite(record.issuedAt) || !Number.isFinite(record.expiresAt)
      || record.expiresAt <= record.issuedAt || record.expiresAt - record.issuedAt > MAX_TTL_MS) {
      return { ok: false, reason: 'bad-expiry' };
    }
    if (record.expiresAt <= now) return { ok: false, reason: 'expired' };
    if (record.issuedAt > now + futureSkewMs) return { ok: false, reason: 'future' };
    const unsigned = unsignedPresence(record);
    if (canonicalize(unsigned).length > MAX_CANONICAL_CHARS) return { ok: false, reason: 'oversize' };
    const signatureOk = await verifyWithKey(record.signerPublicKeyHex, canonicalize(unsigned), record.signature);
    if (!signatureOk) return { ok: false, reason: 'bad-signature' };
    const authorization = await authorizeKey({
      actorId: record.actorId,
      deviceId: record.deviceId,
      signerFingerprint: record.signerFingerprint,
      signerPublicKeyHex: record.signerPublicKeyHex,
      record,
    });
    if (authorization !== true && authorization?.ok !== true) {
      return { ok: false, reason: authorization?.reason ?? 'key-not-authorized' };
    }
    return { ok: true, reason: null };
  } catch (_) {
    return { ok: false, reason: 'malformed' };
  }
}

function subjectKey(record) {
  return `${record.realmId}\u0000${record.branchId}\u0000${record.actorId}\u0000${record.deviceId}\u0000${record.sessionId}`;
}

export function createPresenceTracker({ authorizeKey, now = () => Date.now(), logger = () => {} } = {}) {
  if (typeof authorizeKey !== 'function') throw new TypeError('presence tracker requires authorizeKey');
  if (typeof now !== 'function' || typeof logger !== 'function') throw new TypeError('invalid presence tracker hooks');
  return { authorizeKey, now, logger, sessions: new Map(), actors: new Map() };
}

function emit(tracker, event, record, details = {}, level = 'debug') {
  tracker.logger({
    component: 'realm-presence',
    event,
    level,
    at: tracker.now(),
    realmId: record?.realmId ?? null,
    branchId: record?.branchId ?? null,
    actorId: record?.actorId ?? null,
    deviceId: record?.deviceId ?? null,
    sessionId: record?.sessionId ?? null,
    ...details,
  });
}

/** Accept each signed session sequence once; a gap is surfaced but does not invent missing state. */
export async function ingestPresence(tracker, record) {
  const verified = await verifyPresenceV1(record, { authorizeKey: tracker.authorizeKey, now: tracker.now() });
  if (!verified.ok) {
    emit(tracker, 'rejected', record, { reason: verified.reason }, 'warn');
    return { accepted: false, duplicate: false, gap: false, reason: verified.reason };
  }
  const key = subjectKey(record);
  const prior = tracker.sessions.get(key);
  if (prior && record.sequence <= prior.sequence) {
    emit(tracker, 'replayed', record, { reason: 'non-increasing-sequence', previousSequence: prior.sequence }, 'warn');
    return { accepted: false, duplicate: record.sequence === prior.sequence, gap: false, reason: 'non-increasing-sequence' };
  }
  const gap = !!prior && record.sequence > prior.sequence + 1;
  tracker.sessions.set(key, record);
  const actorKey = `${record.realmId}\u0000${record.branchId}\u0000${record.actorId}`;
  const actorPrior = tracker.actors.get(actorKey);
  if (!actorPrior || record.issuedAt > actorPrior.issuedAt
    || (record.issuedAt === actorPrior.issuedAt && record.sequence > actorPrior.sequence)) {
    tracker.actors.set(actorKey, record);
  }
  emit(tracker, 'accepted', record, { sequence: record.sequence, gap }, gap ? 'warn' : 'debug');
  return { accepted: true, duplicate: false, gap, reason: gap ? 'sequence-gap' : null };
}

export function pruneExpiredPresence(tracker, now = tracker.now()) {
  let removed = 0;
  for (const [key, record] of tracker.sessions) {
    if (record.expiresAt <= now) { tracker.sessions.delete(key); removed += 1; }
  }
  for (const [key, record] of tracker.actors) {
    if (record.expiresAt <= now) tracker.actors.delete(key);
  }
  if (removed) tracker.logger({ component: 'realm-presence', event: 'expired', level: 'debug', at: now, count: removed });
  return removed;
}

export function presenceSnapshot(tracker, { realmId = null, branchId = null } = {}) {
  pruneExpiredPresence(tracker);
  return Object.freeze([...tracker.actors.values()]
    .filter((record) => realmId == null || record.realmId === realmId)
    .filter((record) => branchId == null || record.branchId === branchId)
    .sort((a, b) => a.actorId.localeCompare(b.actorId))
    .map((record) => Object.freeze({ ...record })));
}
