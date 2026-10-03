// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * RealmIds.js — stable, typed identifiers for Realm Network resources.
 *
 * IDs are deliberately independent of names, hosts, routes, and storage
 * locations.  The digest is SHA-256 over domain-separated canonical data, so
 * the same control material always produces the same identifier while two
 * resource types can never collide with one another.
 */

import { contentHashHex } from '../../../core/math/ChecksumMath.js';
import { byteSignature, hexToBytes } from '../../../core/math/FormatMath.js';
import { canonicalBytes } from '../../../state/util/canonical.js';

export const REALM_ID_FORMAT = 'prid:v1';

export const REALM_ID_TYPE = Object.freeze({
  USER: 'user',
  NAVI: 'navi',
  AGENT: 'agent',
  ORGANIZATION: 'organization',
  DEVICE: 'device',
  REALM: 'realm',
  BRANCH: 'branch',
  OBJECT: 'object',
  RECIPE: 'recipe',
  SKILL: 'skill',
  ASSET: 'asset',
  PUBLICATION: 'publication',
  CHECKPOINT: 'checkpoint',
  MEMBERSHIP: 'membership',
});

const TYPES = new Set(Object.values(REALM_ID_TYPE));
const ID_RE = /^prid:v1:([a-z][a-z0-9-]{0,31}):([0-9a-f]{64})$/;

function normalizeType(type) {
  const normalized = String(type ?? '').trim().toLowerCase();
  if (!TYPES.has(normalized)) throw new TypeError(`unsupported Realm ID type: ${normalized || '(empty)'}`);
  return normalized;
}

function publicKeyBytes(value) {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (typeof value === 'string' && /^[0-9a-f]{130}$/i.test(value)) return hexToBytes(value);
  throw new TypeError('public key must be a raw P-256 key or 130-character hex string');
}

/** Return the full SHA-256 fingerprint of a raw uncompressed P-256 key. */
export async function realmKeyFingerprint(publicKey) {
  const bytes = publicKeyBytes(publicKey);
  if (bytes.byteLength !== 65 || bytes[0] !== 0x04) {
    throw new TypeError('public key must be a 65-byte uncompressed P-256 point');
  }
  return contentHashHex(bytes, 'SHA-256');
}

/**
 * Derive a typed stable ID from canonical control material.
 * Callers must provide persistent material, never a location or session ID.
 */
export async function createRealmId(type, controlMaterial) {
  const normalizedType = normalizeType(type);
  if (controlMaterial === undefined || controlMaterial === null) {
    throw new TypeError('control material is required');
  }
  const digest = await contentHashHex(canonicalBytes(
    { type: normalizedType, control: controlMaterial },
    { domain: 'realm-network.identity', schemaVersion: 'prid-v1' },
  ), 'SHA-256');
  return `${REALM_ID_FORMAT}:${normalizedType}:${digest}`;
}

/** Derive an identity controlled by a specific P-256 public key. */
export async function createKeyControlledRealmId(type, publicKey) {
  const bytes = publicKeyBytes(publicKey);
  const fingerprint = await realmKeyFingerprint(bytes);
  return createRealmId(type, {
    keyAlgorithm: 'ECDSA-P256-SHA256',
    fingerprint,
    publicKeyHex: byteSignature(bytes),
  });
}

/** Derive an immutable content identity from exact bytes. */
export async function createContentRealmId(type, content) {
  const normalizedType = normalizeType(type);
  if (![REALM_ID_TYPE.ASSET, REALM_ID_TYPE.RECIPE, REALM_ID_TYPE.SKILL,
    REALM_ID_TYPE.PUBLICATION, REALM_ID_TYPE.CHECKPOINT].includes(normalizedType)) {
    throw new TypeError(`${normalizedType} is not a content-addressed Realm ID type`);
  }
  const digest = await contentHashHex(content, 'SHA-256');
  return createRealmId(normalizedType, { contentAlgorithm: 'SHA-256', digest });
}

export function parseRealmId(id) {
  if (typeof id !== 'string') return null;
  const match = ID_RE.exec(id);
  if (!match || !TYPES.has(match[1])) return null;
  return Object.freeze({ format: REALM_ID_FORMAT, type: match[1], digest: match[2], id });
}

export function isRealmId(id, expectedType = null) {
  const parsed = parseRealmId(id);
  if (!parsed) return false;
  return expectedType === null || parsed.type === String(expectedType).toLowerCase();
}

export function assertRealmId(id, expectedType = null, label = 'Realm ID') {
  if (!isRealmId(id, expectedType)) {
    const suffix = expectedType ? ` of type ${expectedType}` : '';
    throw new TypeError(`${label} must be a valid ${REALM_ID_FORMAT} identifier${suffix}`);
  }
  return id;
}

