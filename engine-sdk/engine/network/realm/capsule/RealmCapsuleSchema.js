// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { canonicalize } from '../../../state/util/canonical.js';
import { MAX_CHUNK_BYTES } from '../../chunks/ChunkLimits.js';
import { REALM_ID_TYPE, isRealmId } from '../addressing/RealmIds.js';

export const REALM_CAPSULE_FORMAT = 'realm-capsule-v1';
export const REALM_CAPSULE_SCHEMA_VERSION = 1;
export const REALM_CAPSULE_EXPORT_FORMAT = 'realm-capsule-offline-v1';
export const REALM_BRANCH_REF_FORMAT = 'realm-branch-ref-v1';

export const DEPENDENCY_CLASSES = Object.freeze([
  'required',
  'optional',
  'streaming',
  'fallback',
]);

export const DEPENDENCY_KINDS = Object.freeze([
  'visual-asset',
  'audio-asset',
  'recipe',
  'storylet',
  'script',
  'navi-skill',
  'simulation-module',
  'network-module',
  'optional-enhancement',
  'trusted-native-capability',
  'realm-capsule',
  'package',
]);

export const RIGHTS_DECISIONS = Object.freeze(['allow', 'deny', 'prompt']);

export const CAPSULE_LIMITS = Object.freeze({
  blobs: 4096,
  chunksPerBlob: 16384,
  totalChunks: 32768,
  maxBlobBytes: 2 * 1024 * 1024 * 1024,
  canonicalBytes: 900 * 1024,
  dependencies: 512,
  minimumEntryItems: 4096,
  contributors: 256,
  sourceCapsules: 512,
  requiredFeatures: 256,
  dependencyGraphNodes: 4096,
  dependencyGraphEdges: 32768,
  dependencyGraphDepth: 64,
});

const CONTENT_ID = /^sha256:[0-9a-f]{64}$/;
const RAW_SHA256 = /^[0-9a-f]{64}$/;
const TOKEN = /^[a-z0-9][a-z0-9._:-]{0,255}$/;
const PACKAGE_ID = /^[a-z0-9][a-z0-9._-]{1,127}$/;
const VERSION = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,63}$/;
const MEDIA_TYPE = /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/;
const LICENSE = /^[A-Za-z0-9.+():\-\s]{1,256}$/;

export class RealmCapsuleValidationError extends TypeError {
  constructor(path, message) {
    super(`RealmCapsuleV1 ${path}: ${message}`);
    this.name = 'RealmCapsuleValidationError';
    this.path = path;
  }
}

function fail(path, message) {
  throw new RealmCapsuleValidationError(path, message);
}

function plainObject(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    fail(path, 'must be a plain object');
  }
  return value;
}

function onlyKeys(value, allowed, path) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(`${path}.${key}`, 'is not defined by this schema version');
  }
}

function string(value, path, { pattern = null, max = 512, nullable = false } = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || value.length === 0 || value.length > max) fail(path, `must be a non-empty string of at most ${max} characters`);
  if (pattern && !pattern.test(value)) fail(path, 'has an invalid format');
  return value;
}

function integer(value, path, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(path, `must be an integer between ${min} and ${max}`);
  return value;
}

function uniqueStrings(value, path, { maxItems, pattern = null, maxLength = 512 } = {}) {
  if (!Array.isArray(value)) fail(path, 'must be an array');
  if (value.length > maxItems) fail(path, `exceeds the ${maxItems} item limit`);
  const result = value.map((item, index) => string(item, `${path}[${index}]`, { pattern, max: maxLength }));
  if (new Set(result).size !== result.length) fail(path, 'must not contain duplicates');
  return result.sort();
}

function optionalString(value, path, options = {}) {
  return value == null ? null : string(value, path, options);
}

function typedRealmId(value, type, path, { nullable = false } = {}) {
  if (nullable && value == null) return null;
  if (!isRealmId(value, type)) fail(path, `must be a stable Realm ID of type ${type}`);
  return value;
}

function actorRealmId(value, path) {
  const allowed = [REALM_ID_TYPE.USER, REALM_ID_TYPE.NAVI, REALM_ID_TYPE.AGENT, REALM_ID_TYPE.ORGANIZATION];
  if (!allowed.some(type => isRealmId(value, type))) fail(path, 'must be a stable user, Navi, agent, or organization Realm ID');
  return value;
}

function uniqueActorIds(value, path, maxItems) {
  if (!Array.isArray(value) || value.length > maxItems) fail(path, `must be an array with at most ${maxItems} entries`);
  const result = value.map((item, index) => actorRealmId(item, `${path}[${index}]`));
  if (new Set(result).size !== result.length) fail(path, 'must not contain duplicates');
  return result.sort();
}

function normalizeChunk(value, path) {
  plainObject(value, path);
  onlyKeys(value, ['chunkId', 'byteLength', 'fragmentRoot', 'fragmentCount'], path);
  return {
    chunkId: string(value.chunkId, `${path}.chunkId`, { pattern: RAW_SHA256, max: 64 }),
    byteLength: integer(value.byteLength, `${path}.byteLength`, { max: MAX_CHUNK_BYTES }),
    fragmentRoot: string(value.fragmentRoot, `${path}.fragmentRoot`, { pattern: RAW_SHA256, max: 64 }),
    fragmentCount: integer(value.fragmentCount, `${path}.fragmentCount`, { min: 1, max: 65536 }),
  };
}

function normalizeBlob(value, path) {
  plainObject(value, path);
  onlyKeys(value, ['contentId', 'byteLength', 'mediaType', 'role', 'chunks'], path);
  if (!Array.isArray(value.chunks) || value.chunks.length === 0) fail(`${path}.chunks`, 'must contain at least one chunk');
  if (value.chunks.length > CAPSULE_LIMITS.chunksPerBlob) fail(`${path}.chunks`, `exceeds the ${CAPSULE_LIMITS.chunksPerBlob} chunk limit`);
  const chunks = value.chunks.map((chunk, index) => normalizeChunk(chunk, `${path}.chunks[${index}]`));
  const byteLength = integer(value.byteLength, `${path}.byteLength`, { max: CAPSULE_LIMITS.maxBlobBytes });
  const describedLength = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  if (describedLength !== byteLength) fail(`${path}.chunks`, `describe ${describedLength} bytes but blob declares ${byteLength}`);
  const chunkIds = chunks.map(chunk => chunk.chunkId);
  if (new Set(chunkIds).size !== chunkIds.length) fail(`${path}.chunks`, 'must not repeat a chunk');
  return {
    contentId: string(value.contentId, `${path}.contentId`, { pattern: CONTENT_ID, max: 71 }),
    byteLength,
    mediaType: string(value.mediaType, `${path}.mediaType`, { pattern: MEDIA_TYPE, max: 127 }),
    role: string(value.role, `${path}.role`, { pattern: TOKEN, max: 64 }),
    chunks,
  };
}

function normalizePackage(value, path) {
  plainObject(value, path);
  onlyKeys(value, ['format', 'contentId', 'packageId', 'version', 'manifestHash', 'rootHash', 'entry'], path);
  const format = string(value.format, `${path}.format`, { max: 32 });
  if (!['prpkg-v2', 'prpkg-v3', 'jhc-1.0'].includes(format)) fail(`${path}.format`, 'must reference an existing prpkg-v2, prpkg-v3, or JHC1 artifact');
  const entry = optionalString(value.entry, `${path}.entry`, { max: 512 });
  if (entry != null) {
    const segments = entry.replace(/\\/g, '/').split('/');
    if (entry.startsWith('/') || entry.includes('\\') || segments.some(segment => !segment || segment === '.' || segment === '..')) {
      fail(`${path}.entry`, 'must be a canonical relative package path');
    }
  }
  return {
    format,
    contentId: string(value.contentId, `${path}.contentId`, { pattern: CONTENT_ID, max: 71 }),
    packageId: string(value.packageId, `${path}.packageId`, { pattern: PACKAGE_ID, max: 128 }),
    version: string(value.version, `${path}.version`, { pattern: VERSION, max: 64 }),
    manifestHash: string(value.manifestHash, `${path}.manifestHash`, { pattern: CONTENT_ID, max: 71 }),
    rootHash: optionalString(value.rootHash, `${path}.rootHash`, { pattern: CONTENT_ID, max: 71 }),
    entry,
  };
}

function normalizeDependency(value, path) {
  plainObject(value, path);
  onlyKeys(value, ['dependencyId', 'kind', 'class', 'realmId', 'capsuleRoot', 'packageId', 'version', 'fallbackFor'], path);
  const dependencyClass = string(value.class, `${path}.class`, { max: 16 });
  if (!DEPENDENCY_CLASSES.includes(dependencyClass)) fail(`${path}.class`, `must be one of ${DEPENDENCY_CLASSES.join(', ')}`);
  const dependencyKind = string(value.kind, `${path}.kind`, { max: 32 });
  if (!DEPENDENCY_KINDS.includes(dependencyKind)) fail(`${path}.kind`, `must be one of ${DEPENDENCY_KINDS.join(', ')}`);
  const result = {
    dependencyId: string(value.dependencyId, `${path}.dependencyId`, { pattern: TOKEN, max: 256 }),
    kind: dependencyKind,
    class: dependencyClass,
    realmId: typedRealmId(value.realmId, REALM_ID_TYPE.REALM, `${path}.realmId`, { nullable: true }),
    capsuleRoot: optionalString(value.capsuleRoot, `${path}.capsuleRoot`, { pattern: CONTENT_ID, max: 71 }),
    packageId: optionalString(value.packageId, `${path}.packageId`, { pattern: PACKAGE_ID, max: 128 }),
    version: optionalString(value.version, `${path}.version`, { pattern: VERSION, max: 64 }),
    fallbackFor: optionalString(value.fallbackFor, `${path}.fallbackFor`, { pattern: TOKEN, max: 256 }),
  };
  if (!result.realmId && !result.capsuleRoot && !result.packageId) fail(path, 'must identify a realm, capsule, or package');
  if (dependencyClass === 'fallback' && !result.fallbackFor) fail(`${path}.fallbackFor`, 'is required for fallback dependencies');
  if (dependencyClass !== 'fallback' && result.fallbackFor) fail(`${path}.fallbackFor`, 'is only valid for fallback dependencies');
  return result;
}

export function normalizeRights(value = {}) {
  plainObject(value, 'rights');
  onlyKeys(value, ['licenseExpression', 'entry', 'replication', 'export', 'modification', 'modelTraining'], 'rights');
  const decision = (name, fallback) => {
    const result = value[name] ?? fallback;
    if (!RIGHTS_DECISIONS.includes(result)) fail(`rights.${name}`, `must be one of ${RIGHTS_DECISIONS.join(', ')}`);
    return result;
  };
  return {
    licenseExpression: string(value.licenseExpression ?? 'NOASSERTION', 'rights.licenseExpression', { pattern: LICENSE, max: 256 }),
    entry: decision('entry', 'prompt'),
    replication: decision('replication', 'deny'),
    export: decision('export', 'deny'),
    modification: decision('modification', 'deny'),
    modelTraining: decision('modelTraining', 'deny'),
  };
}

export function normalizeProvenance(value = {}) {
  plainObject(value, 'provenance');
  onlyKeys(value, ['createdBy', 'contributors', 'sourceCapsuleRoots', 'attestations'], 'provenance');
  const attestations = value.attestations ?? [];
  if (!Array.isArray(attestations) || attestations.length > 512) fail('provenance.attestations', 'must be an array with at most 512 entries');
  return {
    createdBy: actorRealmId(value.createdBy, 'provenance.createdBy'),
    contributors: uniqueActorIds(value.contributors ?? [], 'provenance.contributors', CAPSULE_LIMITS.contributors),
    sourceCapsuleRoots: uniqueStrings(value.sourceCapsuleRoots ?? [], 'provenance.sourceCapsuleRoots', { maxItems: CAPSULE_LIMITS.sourceCapsules, pattern: CONTENT_ID, maxLength: 71 }),
    attestations: attestations.map((attestation, index) => {
      plainObject(attestation, `provenance.attestations[${index}]`);
      onlyKeys(attestation, ['type', 'issuer', 'digest'], `provenance.attestations[${index}]`);
      return {
        type: string(attestation.type, `provenance.attestations[${index}].type`, { pattern: TOKEN, max: 128 }),
        issuer: actorRealmId(attestation.issuer, `provenance.attestations[${index}].issuer`),
        digest: string(attestation.digest, `provenance.attestations[${index}].digest`, { pattern: CONTENT_ID, max: 71 }),
      };
    },).sort((a, b) => canonicalize(a).localeCompare(canonicalize(b))),
  };
}

export function normalizeCompatibility(value = {}) {
  plainObject(value, 'compatibility');
  onlyKeys(value, ['realmSchema', 'minimumNetworkVersion', 'maximumNetworkVersion', 'requiredFeatures', 'migrationIds'], 'compatibility');
  const minimumNetworkVersion = string(value.minimumNetworkVersion ?? '1', 'compatibility.minimumNetworkVersion', { pattern: VERSION, max: 64 });
  const maximumNetworkVersion = optionalString(value.maximumNetworkVersion, 'compatibility.maximumNetworkVersion', { pattern: VERSION, max: 64 });
  return {
    realmSchema: string(value.realmSchema ?? '1.0.0', 'compatibility.realmSchema', { pattern: VERSION, max: 64 }),
    minimumNetworkVersion,
    maximumNetworkVersion,
    requiredFeatures: uniqueStrings(value.requiredFeatures ?? [], 'compatibility.requiredFeatures', { maxItems: CAPSULE_LIMITS.requiredFeatures, pattern: TOKEN, maxLength: 256 }),
    migrationIds: uniqueStrings(value.migrationIds ?? [], 'compatibility.migrationIds', { maxItems: 256, pattern: TOKEN, maxLength: 256 }),
  };
}

export function normalizeCapsuleBody(value) {
  plainObject(value, 'capsule');
  onlyKeys(value, ['format', 'schemaVersion', 'realmId', 'branchId', 'issuedAt', 'package', 'blobs', 'dependencies', 'minimumEntry', 'rights', 'provenance', 'compatibility'], 'capsule');
  if (value.format !== REALM_CAPSULE_FORMAT) fail('capsule.format', `must be ${REALM_CAPSULE_FORMAT}`);
  if (value.schemaVersion !== REALM_CAPSULE_SCHEMA_VERSION) fail('capsule.schemaVersion', `must be ${REALM_CAPSULE_SCHEMA_VERSION}`);
  if (!Array.isArray(value.blobs) || value.blobs.length === 0) fail('capsule.blobs', 'must contain at least one blob');
  if (value.blobs.length > CAPSULE_LIMITS.blobs) fail('capsule.blobs', `exceeds the ${CAPSULE_LIMITS.blobs} blob limit`);
  if (!Array.isArray(value.dependencies)) fail('capsule.dependencies', 'must be an array');
  if (value.dependencies.length > CAPSULE_LIMITS.dependencies) fail('capsule.dependencies', `exceeds the ${CAPSULE_LIMITS.dependencies} dependency limit`);

  const blobs = value.blobs.map((blob, index) => normalizeBlob(blob, `capsule.blobs[${index}]`)).sort((a, b) => a.contentId.localeCompare(b.contentId));
  const blobIds = blobs.map(blob => blob.contentId);
  if (new Set(blobIds).size !== blobIds.length) fail('capsule.blobs', 'must not repeat a contentId');
  const packageDescriptor = normalizePackage(value.package, 'capsule.package');
  if (!blobIds.includes(packageDescriptor.contentId)) fail('capsule.package.contentId', 'must reference a declared blob');
  const packageBlobs = blobs.filter(blob => blob.role === 'package');
  if (packageBlobs.length !== 1 || packageBlobs[0].contentId !== packageDescriptor.contentId) {
    fail('capsule.blobs', 'must contain exactly one package-role blob matching capsule.package.contentId');
  }

  const dependencies = value.dependencies.map((dependency, index) => normalizeDependency(dependency, `capsule.dependencies[${index}]`))
    .sort((a, b) => a.dependencyId.localeCompare(b.dependencyId));
  const dependencyIds = dependencies.map(dependency => dependency.dependencyId);
  if (new Set(dependencyIds).size !== dependencyIds.length) fail('capsule.dependencies', 'must not repeat a dependencyId');
  for (const dependency of dependencies) {
    if (dependency.fallbackFor && (!dependencyIds.includes(dependency.fallbackFor) || dependency.fallbackFor === dependency.dependencyId)) {
      fail(`capsule.dependencies.${dependency.dependencyId}.fallbackFor`, 'must reference a different declared dependency');
    }
    if (dependency.fallbackFor && dependencies.find(candidate => candidate.dependencyId === dependency.fallbackFor)?.class === 'fallback') {
      fail(`capsule.dependencies.${dependency.dependencyId}.fallbackFor`, 'must reference a non-fallback dependency');
    }
  }

  plainObject(value.minimumEntry, 'capsule.minimumEntry');
  onlyKeys(value.minimumEntry, ['blobIds', 'dependencyIds'], 'capsule.minimumEntry');
  const minimumBlobIds = uniqueStrings(value.minimumEntry.blobIds, 'capsule.minimumEntry.blobIds', { maxItems: CAPSULE_LIMITS.minimumEntryItems, pattern: CONTENT_ID, maxLength: 71 });
  const minimumDependencyIds = uniqueStrings(value.minimumEntry.dependencyIds, 'capsule.minimumEntry.dependencyIds', { maxItems: CAPSULE_LIMITS.dependencies, pattern: TOKEN, maxLength: 256 });
  if (!minimumBlobIds.includes(packageDescriptor.contentId)) fail('capsule.minimumEntry.blobIds', 'must include the package artifact');
  for (const contentId of minimumBlobIds) if (!blobIds.includes(contentId)) fail('capsule.minimumEntry.blobIds', `references undeclared blob ${contentId}`);
  for (const dependencyId of minimumDependencyIds) if (!dependencyIds.includes(dependencyId)) fail('capsule.minimumEntry.dependencyIds', `references undeclared dependency ${dependencyId}`);
  for (const dependency of dependencies) {
    if (dependency.class === 'required' && !minimumDependencyIds.includes(dependency.dependencyId)) {
      fail('capsule.minimumEntry.dependencyIds', `omits required dependency ${dependency.dependencyId}`);
    }
  }

  const normalized = {
    format: REALM_CAPSULE_FORMAT,
    schemaVersion: REALM_CAPSULE_SCHEMA_VERSION,
    realmId: typedRealmId(value.realmId, REALM_ID_TYPE.REALM, 'capsule.realmId'),
    branchId: typedRealmId(value.branchId, REALM_ID_TYPE.BRANCH, 'capsule.branchId'),
    issuedAt: integer(value.issuedAt, 'capsule.issuedAt'),
    package: packageDescriptor,
    blobs,
    dependencies,
    minimumEntry: { blobIds: minimumBlobIds, dependencyIds: minimumDependencyIds },
    rights: normalizeRights(value.rights),
    provenance: normalizeProvenance(value.provenance),
    compatibility: normalizeCompatibility(value.compatibility),
  };
  const totalChunks = blobs.reduce((total, blob) => total + blob.chunks.length, 0);
  if (totalChunks > CAPSULE_LIMITS.totalChunks) fail('capsule.blobs', `exceeds the ${CAPSULE_LIMITS.totalChunks} total chunk limit`);
  const canonicalLength = new TextEncoder().encode(canonicalize(normalized)).byteLength;
  if (canonicalLength > CAPSULE_LIMITS.canonicalBytes) fail('capsule', `canonical manifest exceeds ${CAPSULE_LIMITS.canonicalBytes} bytes`);
  return normalized;
}

export function validateRealmCapsuleShape(value, { requireSignature = true } = {}) {
  plainObject(value, 'capsule');
  const signatureKeys = ['capsuleRoot', 'signerFingerprint', 'signerPublicKeyHex', 'signature'];
  onlyKeys(value, [
    'format', 'schemaVersion', 'realmId', 'branchId', 'issuedAt', 'package', 'blobs', 'dependencies', 'minimumEntry',
    'rights', 'provenance', 'compatibility', ...signatureKeys,
  ], 'capsule');
  const body = normalizeCapsuleBody(Object.fromEntries(Object.entries(value).filter(([key]) => !signatureKeys.includes(key))));
  if (requireSignature) {
    string(value.capsuleRoot, 'capsule.capsuleRoot', { pattern: CONTENT_ID, max: 71 });
    string(value.signerFingerprint, 'capsule.signerFingerprint', { pattern: /^[0-9a-f]{64}$/, max: 64 });
    string(value.signerPublicKeyHex, 'capsule.signerPublicKeyHex', { pattern: /^04[0-9a-f]{128}$/, max: 130 });
    string(value.signature, 'capsule.signature', { pattern: /^[0-9a-f]+$/, max: 160 });
    if (value.signature.length < 128 || value.signature.length % 2 !== 0) fail('capsule.signature', 'must encode a valid P-256 signature');
  }
  return body;
}

export function validateDependencyGraph(records, options = {}) {
  if (!Array.isArray(records)) fail('dependencyGraph', 'must be an array');
  const maxNodes = options.maxNodes ?? CAPSULE_LIMITS.dependencyGraphNodes;
  const maxEdges = options.maxEdges ?? CAPSULE_LIMITS.dependencyGraphEdges;
  const maxDepth = options.maxDepth ?? CAPSULE_LIMITS.dependencyGraphDepth;
  if (records.length > maxNodes) fail('dependencyGraph', `exceeds the ${maxNodes} node limit`);
  const graph = new Map();
  let edgeCount = 0;
  for (let index = 0; index < records.length; index += 1) {
    const record = plainObject(records[index], `dependencyGraph[${index}]`);
    const root = string(record.capsuleRoot, `dependencyGraph[${index}].capsuleRoot`, { pattern: CONTENT_ID, max: 71 });
    if (graph.has(root)) fail(`dependencyGraph[${index}].capsuleRoot`, 'is duplicated');
    if (!Array.isArray(record.dependencies)) fail(`dependencyGraph[${index}].dependencies`, 'must be an array');
    const edges = record.dependencies.map((dependency, dependencyIndex) => {
      plainObject(dependency, `dependencyGraph[${index}].dependencies[${dependencyIndex}]`);
      const target = dependency.capsuleRoot;
      return target == null ? null : string(target, `dependencyGraph[${index}].dependencies[${dependencyIndex}].capsuleRoot`, { pattern: CONTENT_ID, max: 71 });
    }).filter(Boolean);
    edgeCount += edges.length;
    if (edgeCount > maxEdges) fail('dependencyGraph', `exceeds the ${maxEdges} edge limit`);
    graph.set(root, edges);
  }
  if (options.requireResolved) {
    for (const [source, edges] of graph) {
      for (const target of edges) if (!graph.has(target)) fail('dependencyGraph', `${source} references unresolved capsule ${target}`);
    }
  }
  const visiting = new Set();
  const visited = new Set();
  const visit = (node, depth) => {
    if (depth > maxDepth) fail('dependencyGraph', `exceeds the ${maxDepth} level depth limit`);
    if (visiting.has(node)) fail('dependencyGraph', `contains a cycle at ${node}`);
    if (visited.has(node) || !graph.has(node)) return;
    visiting.add(node);
    for (const target of graph.get(node)) visit(target, depth + 1);
    visiting.delete(node);
    visited.add(node);
  };
  for (const node of graph.keys()) visit(node, 1);
  return Object.freeze({ ok: true, nodes: graph.size, edges: edgeCount });
}

export function isContentId(value) {
  return typeof value === 'string' && CONTENT_ID.test(value);
}

export function contentIdHex(value) {
  if (!isContentId(value)) fail('contentId', 'must be a tagged SHA-256 identifier');
  return value.slice('sha256:'.length);
}

export function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
