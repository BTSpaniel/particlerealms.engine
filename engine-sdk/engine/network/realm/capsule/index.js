// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export {
  CAPSULE_LIMITS,
  DEPENDENCY_CLASSES,
  DEPENDENCY_KINDS,
  REALM_BRANCH_REF_FORMAT,
  REALM_CAPSULE_EXPORT_FORMAT,
  REALM_CAPSULE_FORMAT,
  REALM_CAPSULE_SCHEMA_VERSION,
  RIGHTS_DECISIONS,
  RealmCapsuleValidationError,
  contentIdHex,
  deepFreeze,
  isContentId,
  normalizeCapsuleBody,
  normalizeCompatibility,
  normalizeProvenance,
  normalizeRights,
  validateDependencyGraph,
  validateRealmCapsuleShape,
} from './RealmCapsuleSchema.js';

export {
  base64ToBytes,
  adaptVerifiedPackageArtifact,
  buildRealmCapsule,
  bytesToBase64,
  computeCapsuleRoot,
  createOfflineCapsuleExport,
  prepareRealmBlob,
  RealmCapsuleV1,
  reassembleBlobChunks,
  taggedSha256,
  toUint8Array,
  verifyBlobAgainstDescriptor,
  verifyOfflineCapsuleExport,
  verifyRealmCapsule,
} from './RealmCapsule.js';

export {
  createRealmBranchRef,
  hashRealmBranchRef,
  verifyRealmBranchRef,
} from './RealmBranchRef.js';

export { CapsuleAssembler } from './CapsuleAssembler.js';
export { CapsuleMigrationRegistry } from './CapsuleMigration.js';
