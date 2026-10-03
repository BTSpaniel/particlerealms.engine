// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { canonicalBytes, canonicalize } from '../../../state/util/canonical.js';
import { verifyWithKey } from '../../../state/authority/Identity.js';
import { contentHashHex } from '../../../core/math/ChecksumMath.js';
import { splitIntoChunks, splitChunkIntoFragments, reassembleChunks } from '../../chunks/ChunkFragmenter.js';
import { computeChunkHash, computeFragmentHashes, computeMerkleRoot } from '../../chunks/MerkleFragments.js';
import { DEFAULT_CHUNK_BYTES, DEFAULT_FRAGMENT_BYTES } from '../../chunks/ChunkLimits.js';
import { realmKeyFingerprint } from '../addressing/RealmIds.js';
import {
  REALM_CAPSULE_EXPORT_FORMAT,
  REALM_CAPSULE_FORMAT,
  REALM_CAPSULE_SCHEMA_VERSION,
  deepFreeze,
  isContentId,
  normalizeCapsuleBody,
  validateRealmCapsuleShape,
} from './RealmCapsuleSchema.js';

const SIGNING_DOMAIN = 'realm-capsule-signature';
const ROOT_DOMAIN = 'realm-capsule-root';

export function toUint8Array(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (typeof value === 'string') return new TextEncoder().encode(value);
  throw new TypeError('RealmCapsule blob content must be a string, ArrayBuffer, or typed-array view');
}

export function taggedSha256(hex) {
  const text = String(hex ?? '').toLowerCase();
  const tagged = text.startsWith('sha256:') ? text : `sha256:${text}`;
  if (!isContentId(tagged)) throw new TypeError('Expected a SHA-256 digest');
  return tagged;
}

/**
 * Convert the output of PackageVerifier.parseAny()/verify() into the package
 * input accepted by buildRealmCapsule. Package verification stays owned by the
 * existing package stack; this adapter only binds its verified artifact bytes
 * and roots into the Capsule.
 */
export async function adaptVerifiedPackageArtifact({ artifactBytes, parsedPackage, verification } = {}) {
  if (!parsedPackage || typeof parsedPackage !== 'object') throw new TypeError('A parsed package is required');
  if (!verification || verification.valid !== true) throw new Error('PackageVerifier must accept the package before Capsule adaptation');
  const format = parsedPackage.format;
  if (!['prpkg-v2', 'prpkg-v3'].includes(format) || verification.format !== format) {
    throw new Error('Package verification format does not match the parsed artifact');
  }
  const manifestHash = parsedPackage.blockmap?.manifestHash;
  if (!/^[0-9a-f]{64}$/.test(String(manifestHash ?? ''))) throw new Error('Verified package is missing its blockmap manifest hash');
  const rootHash = verification.rootHash ?? parsedPackage.rootHash ?? parsedPackage.blockmap?.merkleRoot ?? null;
  if (rootHash != null && !/^(?:sha256:)?[0-9a-f]{64}$/.test(String(rootHash))) throw new Error('Verified package root hash is invalid');
  const bytes = toUint8Array(artifactBytes);
  return Object.freeze({
    format,
    packageId: parsedPackage.manifest?.id,
    version: parsedPackage.manifest?.version,
    manifestHash,
    rootHash,
    entry: parsedPackage.manifest?.entry ?? null,
    contentId: `sha256:${await contentHashHex(bytes, 'SHA-256')}`,
    bytes,
  });
}

export async function computeCapsuleRoot(body) {
  const normalized = normalizeCapsuleBody(body);
  const hex = await contentHashHex(canonicalBytes(normalized, {
    domain: ROOT_DOMAIN,
    schemaVersion: String(REALM_CAPSULE_SCHEMA_VERSION),
  }), 'SHA-256');
  return `sha256:${hex}`;
}

export async function prepareRealmBlob(input, options = {}) {
  if (!input || typeof input !== 'object') throw new TypeError('prepareRealmBlob requires a blob input');
  const bytes = toUint8Array(input.bytes);
  const chunks = splitIntoChunks(bytes, options.chunkSize ?? DEFAULT_CHUNK_BYTES);
  const chunkDescriptors = [];
  const chunkBytes = new Map();
  for (const chunk of chunks) {
    const chunkId = await computeChunkHash(chunk);
    const fragments = splitChunkIntoFragments(chunk, options.fragmentSize ?? DEFAULT_FRAGMENT_BYTES);
    const fragmentHashes = await computeFragmentHashes(fragments);
    const fragmentRoot = await computeMerkleRoot(fragmentHashes);
    chunkDescriptors.push({
      chunkId,
      byteLength: chunk.byteLength,
      fragmentRoot,
      fragmentCount: fragments.length,
    });
    chunkBytes.set(chunkId, new Uint8Array(chunk));
  }
  const contentId = `sha256:${await contentHashHex(bytes, 'SHA-256')}`;
  return Object.freeze({
    descriptor: deepFreeze({
      contentId,
      byteLength: bytes.byteLength,
      mediaType: input.mediaType ?? 'application/octet-stream',
      role: input.role ?? 'asset',
      chunks: chunkDescriptors,
    }),
    bytes: new Uint8Array(bytes),
    chunkBytes,
  });
}

function packageDescriptor(input, preparedBlobs) {
  if (!input || typeof input !== 'object') throw new TypeError('buildRealmCapsule requires a package descriptor');
  const packageBlobs = preparedBlobs.filter(blob => blob.descriptor.role === 'package');
  const contentId = input.contentId ?? (packageBlobs.length === 1 ? packageBlobs[0].descriptor.contentId : null);
  if (!contentId) throw new TypeError('Package contentId is required when there is not exactly one package-role blob');
  return {
    format: input.format,
    contentId,
    packageId: input.packageId,
    version: input.version,
    manifestHash: taggedSha256(input.manifestHash),
    rootHash: input.rootHash == null ? null : taggedSha256(input.rootHash),
    entry: input.entry ?? null,
  };
}

export async function buildRealmCapsule(input, signer, options = {}) {
  if (!input || typeof input !== 'object') throw new TypeError('buildRealmCapsule requires an input object');
  if (!signer || typeof signer.sign !== 'function') throw new TypeError('buildRealmCapsule requires a signer');
  if (signer.secure !== true) throw new Error('Realm Capsules require a secure signer');
  if (!signer.fingerprint || !signer.publicKeyHex) throw new Error('Realm Capsule signer identity is incomplete');
  if (await realmKeyFingerprint(signer.publicKeyHex) !== signer.fingerprint) throw new Error('Realm Capsule signer fingerprint does not match its public key');
  if (!Array.isArray(input.blobs) || input.blobs.length === 0) throw new TypeError('buildRealmCapsule requires at least one blob');

  const blobInputs = [...input.blobs];
  if (input.package?.bytes !== undefined) {
    blobInputs.push({
      bytes: input.package.bytes,
      mediaType: input.package.mediaType ?? 'application/vnd.particle-realms.package',
      role: 'package',
    });
  }
  const preparedBlobs = [];
  for (const blob of blobInputs) preparedBlobs.push(await prepareRealmBlob(blob, options));
  const descriptors = preparedBlobs.map(blob => blob.descriptor);
  const packageInput = { ...input.package };
  delete packageInput.bytes;
  delete packageInput.mediaType;
  const packaged = packageDescriptor(packageInput, preparedBlobs);
  const body = normalizeCapsuleBody({
    format: REALM_CAPSULE_FORMAT,
    schemaVersion: REALM_CAPSULE_SCHEMA_VERSION,
    realmId: input.realmId,
    branchId: input.branchId,
    issuedAt: input.issuedAt ?? Date.now(),
    package: packaged,
    blobs: descriptors,
    dependencies: input.dependencies ?? [],
    minimumEntry: input.minimumEntry ?? {
      blobIds: [packaged.contentId],
      dependencyIds: (input.dependencies ?? []).filter(dependency => dependency.class === 'required').map(dependency => dependency.dependencyId),
    },
    rights: input.rights ?? {},
    provenance: input.provenance ?? { createdBy: signer.principal ?? signer.fingerprint },
    compatibility: input.compatibility ?? {},
  });
  const capsuleRoot = await computeCapsuleRoot(body);
  const signedBody = { ...body, capsuleRoot };
  const signature = await signer.sign(canonicalBytes(signedBody, {
    domain: SIGNING_DOMAIN,
    schemaVersion: String(REALM_CAPSULE_SCHEMA_VERSION),
  }));
  if (!signature) throw new Error('Realm Capsule signer did not produce a signature');
  const capsule = deepFreeze({
    ...signedBody,
    signerFingerprint: signer.fingerprint,
    signerPublicKeyHex: signer.publicKeyHex,
    signature,
  });
  validateRealmCapsuleShape(capsule);

  const blobs = new Map();
  const chunks = new Map();
  for (const prepared of preparedBlobs) {
    blobs.set(prepared.descriptor.contentId, prepared.bytes);
    for (const [chunkId, bytes] of prepared.chunkBytes) chunks.set(chunkId, bytes);
  }
  return Object.freeze({ capsule, blobs, chunks });
}

export async function verifyRealmCapsule(capsule, options = {}) {
  try {
    const body = validateRealmCapsuleShape(capsule);
    if (canonicalize(body) !== canonicalize(Object.fromEntries(Object.entries(capsule).filter(([key]) => ![
      'capsuleRoot', 'signerFingerprint', 'signerPublicKeyHex', 'signature',
    ].includes(key))))) return Object.freeze({ ok: false, reason: 'non-canonical-body' });
    const actualRoot = await computeCapsuleRoot(body);
    if (actualRoot !== capsule.capsuleRoot) return Object.freeze({ ok: false, reason: 'root-mismatch', actualRoot });
    if (options.expectedRoot && options.expectedRoot !== actualRoot) return Object.freeze({ ok: false, reason: 'unexpected-root', actualRoot });
    if (options.expectedSignerFingerprint && options.expectedSignerFingerprint !== capsule.signerFingerprint) {
      return Object.freeze({ ok: false, reason: 'unexpected-signer', actualRoot });
    }
    if (await realmKeyFingerprint(capsule.signerPublicKeyHex) !== capsule.signerFingerprint) {
      return Object.freeze({ ok: false, reason: 'signer-fingerprint-mismatch', actualRoot });
    }
    const signedBody = { ...body, capsuleRoot: actualRoot };
    const signingBytes = canonicalBytes(signedBody, {
      domain: SIGNING_DOMAIN,
      schemaVersion: String(REALM_CAPSULE_SCHEMA_VERSION),
    });
    const signatureOk = options.signer
      ? await options.signer.verify(signingBytes, capsule.signature)
      : await verifyWithKey(capsule.signerPublicKeyHex, signingBytes, capsule.signature);
    return Object.freeze({ ok: !!signatureOk, reason: signatureOk ? null : 'bad-signature', actualRoot });
  } catch (error) {
    return Object.freeze({ ok: false, reason: 'invalid-schema', error });
  }
}

export async function verifyBlobAgainstDescriptor(bytesLike, descriptor) {
  const bytes = toUint8Array(bytesLike);
  if (bytes.byteLength !== descriptor.byteLength) return false;
  const contentId = `sha256:${await contentHashHex(bytes, 'SHA-256')}`;
  if (contentId !== descriptor.contentId) return false;
  let offset = 0;
  for (const chunk of descriptor.chunks) {
    const chunkBytes = bytes.subarray(offset, offset + chunk.byteLength);
    if (chunkBytes.byteLength !== chunk.byteLength || await computeChunkHash(chunkBytes) !== chunk.chunkId) return false;
    offset += chunk.byteLength;
  }
  return offset === bytes.byteLength;
}

export function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
  }
  return btoa(binary);
}

export function base64ToBytes(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new TypeError('Offline Capsule blob has invalid base64');
  const binary = atob(value);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

export async function createOfflineCapsuleExport(capsule, resolveBlob, options = {}) {
  const verification = await verifyRealmCapsule(capsule, options);
  if (!verification.ok) throw new Error(`Cannot export invalid Realm Capsule: ${verification.reason}`);
  if (capsule.rights.export === 'deny') throw new Error('Realm Capsule rights deny export');
  if (capsule.rights.export === 'prompt' && options.authorizedExport !== true) {
    throw new Error('Realm Capsule export requires explicit authorization');
  }
  if (typeof resolveBlob !== 'function') throw new TypeError('createOfflineCapsuleExport requires a blob resolver');
  const blobs = [];
  for (const descriptor of capsule.blobs) {
    const bytes = toUint8Array(await resolveBlob(descriptor.contentId));
    if (!await verifyBlobAgainstDescriptor(bytes, descriptor)) throw new Error(`Blob ${descriptor.contentId} failed verification during export`);
    blobs.push({ contentId: descriptor.contentId, encoding: 'base64', data: bytesToBase64(bytes) });
  }
  return deepFreeze({
    format: REALM_CAPSULE_EXPORT_FORMAT,
    capsule,
    blobs,
    exportedAt: options.exportedAt ?? Date.now(),
  });
}

export async function verifyOfflineCapsuleExport(bundle, options = {}) {
  try {
    if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) throw new TypeError('Offline Capsule export must be an object');
    const keys = Object.keys(bundle).sort();
    if (canonicalize(keys) !== canonicalize(['blobs', 'capsule', 'exportedAt', 'format'].sort())) throw new TypeError('Offline Capsule export has unknown or missing fields');
    if (bundle.format !== REALM_CAPSULE_EXPORT_FORMAT) throw new TypeError(`Offline Capsule export format must be ${REALM_CAPSULE_EXPORT_FORMAT}`);
    if (!Number.isSafeInteger(bundle.exportedAt) || bundle.exportedAt < 0) throw new TypeError('Offline Capsule exportedAt is invalid');
    const capsuleVerification = await verifyRealmCapsule(bundle.capsule, options);
    if (!capsuleVerification.ok) return Object.freeze({ ok: false, reason: `capsule-${capsuleVerification.reason}` });
    if (!Array.isArray(bundle.blobs) || bundle.blobs.length !== bundle.capsule.blobs.length) return Object.freeze({ ok: false, reason: 'blob-set-mismatch' });
    const descriptors = new Map(bundle.capsule.blobs.map(descriptor => [descriptor.contentId, descriptor]));
    const decoded = new Map();
    for (const record of bundle.blobs) {
      if (!record || Object.keys(record).sort().join(',') !== 'contentId,data,encoding') return Object.freeze({ ok: false, reason: 'invalid-blob-record' });
      if (record.encoding !== 'base64' || !descriptors.has(record.contentId) || decoded.has(record.contentId)) return Object.freeze({ ok: false, reason: 'blob-set-mismatch' });
      const bytes = base64ToBytes(record.data);
      if (!await verifyBlobAgainstDescriptor(bytes, descriptors.get(record.contentId))) return Object.freeze({ ok: false, reason: 'blob-tampered', contentId: record.contentId });
      decoded.set(record.contentId, bytes);
    }
    return Object.freeze({ ok: true, reason: null, capsule: bundle.capsule, blobs: decoded });
  } catch (error) {
    return Object.freeze({ ok: false, reason: 'invalid-export', error });
  }
}

export function reassembleBlobChunks(chunks) {
  return reassembleChunks(chunks.map(toUint8Array));
}

export const RealmCapsuleV1 = Object.freeze({
  format: REALM_CAPSULE_FORMAT,
  schemaVersion: REALM_CAPSULE_SCHEMA_VERSION,
  build: buildRealmCapsule,
  verify: verifyRealmCapsule,
  computeRoot: computeCapsuleRoot,
  prepareBlob: prepareRealmBlob,
  adaptVerifiedPackage: adaptVerifiedPackageArtifact,
  createOfflineExport: createOfflineCapsuleExport,
  verifyOfflineExport: verifyOfflineCapsuleExport,
});
