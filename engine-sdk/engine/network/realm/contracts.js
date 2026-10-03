// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Stable Realm Network V1 contract descriptors.
 *
 * Descriptors contain references to the concrete implementations. Importing
 * this module does not create stores, links, providers, timers, or network
 * connections.
 */

import {
  PASSPORT_FORMAT,
  appendPassportRecovery,
  appendPassportRevocation,
  appendPassportRotation,
  createDeviceGrant,
  createDeviceRevocation,
  createPassportLineage,
  createRealmPassport,
  createRecoveryPolicy,
  createRecoveryRecord,
  verifyDeviceGrant,
  verifyDeviceRevocation,
  verifyPassportLineage,
  verifyRealmPassport,
  verifyRecoveryPolicy,
  verifyRecoveryRecord,
} from './identity/RealmPassport.js';
import {
  REALM_ALIAS_FORMAT,
  RealmAddressResolver,
  createRealmAliasRecord,
  parseRealmAddress,
  realmAddressForId,
  verifyRealmAliasRecord,
} from './addressing/RealmAddress.js';
import {
  CHRONICLE_EVENT_FORMAT,
  RealmChronicle,
  createChronicleEvent,
  verifyChronicleEvent,
} from './chronicle/RealmChronicle.js';
import { RealmCapsuleV1 } from './capsule/RealmCapsule.js';
import {
  REALM_LINK_STATE,
  attachRealmLinkTransport,
  closeRealmLink,
  createRealmLink,
  handleRealmLinkFrame,
  markRealmLinkDisconnected,
  persistRealmLinkContinuity,
  realmLinkContinuityRecord,
  realmLinkEvidence,
  sendRealmLinkData,
  snapshotRealmLink,
  upgradeRealmLinkTransport,
} from './link/RealmLink.js';
import {
  REALM_LINK_FRAME,
  REALM_LINK_PROTOCOL,
  signRealmLinkFrame,
  verifyRealmLinkFrame,
} from './link/RealmLinkProtocol.js';
import {
  CONTINUITY_SCHEMA,
  TRANSFER_STATE,
  createContinuityRecord,
  createContinuityStore,
  createMemoryContinuityAdapter,
  loadContinuity,
  removeContinuity,
  saveContinuity,
  updateTransferProgress,
  validateContinuityRecord,
} from './link/ContinuityStore.js';
import {
  AUTHORITY_LEASE_FORMAT,
  AUTHORITY_POLICY,
  AUTHORITY_REVOCATION_FORMAT,
  createAuthorityLease,
  createAuthorityRevocation,
  renewAuthorityLease,
  verifyAuthorityLease,
  verifyAuthorityRevocation,
} from './authority/AuthorityLease.js';
import { RealmBranchV1 } from './branches/RealmBranch.js';
import { MergeProposalV1 } from './branches/MergeProposal.js';
import { OrganizationV1 } from './governance/OrganizationV1.js';
import { CapabilityGrantV1 } from './governance/CapabilityGrantV1.js';
import { AccordTaskV1 } from './accord/AccordTaskV1.js';
import { ContextCapsuleV1 } from './accord/ContextCapsuleV1.js';
import { AccordResultV1 } from './accord/AccordResultV1.js';
import {
  ATLAS_VISIBILITY,
  AtlasRecordV1 as AtlasRecordDescriptor,
  atlasVisibilitySemantics,
  canAccessAtlasRecordV1,
  createAtlasRecordV1,
  verifyAtlasRecordV1,
} from './atlas/AtlasRecordV1.js';
import { GatePlanV1 } from './gate/GatePlanV1.js';
import {
  PRESENCE_PROTOCOL,
  PRESENCE_SCHEMA,
  PRESENCE_STATUS,
  createPresenceTracker,
  createPresenceV1,
  ingestPresence,
  presenceSnapshot,
  pruneExpiredPresence,
  signPresenceV1,
  verifyPresenceV1,
} from './presence/PresenceV1.js';
import {
  HEALTH_SCHEMA,
  HEALTH_STATUS,
  buildHealthSnapshotV1,
  createHealthMonitor,
  observeDiscoveryHealth,
  observePresenceHealth,
  observeRealmLinkHealth,
  recordHealthComponent,
  removeHealthComponent,
  subscribeHealth,
} from './health/HealthSnapshot.js';

export const RealmPassportV1 = Object.freeze({
  name: 'RealmPassportV1',
  format: PASSPORT_FORMAT,
  schemaVersion: 1,
  create: createRealmPassport,
  verify: verifyRealmPassport,
  createLineage: createPassportLineage,
  verifyLineage: verifyPassportLineage,
  rotate: appendPassportRotation,
  recover: appendPassportRecovery,
  revoke: appendPassportRevocation,
  createDeviceGrant,
  verifyDeviceGrant,
  createDeviceRevocation,
  verifyDeviceRevocation,
  createRecoveryPolicy,
  verifyRecoveryPolicy,
  createRecoveryRecord,
  verifyRecoveryRecord,
});

export const RealmAddressV1 = Object.freeze({
  name: 'RealmAddressV1',
  scheme: 'realm:',
  version: 1,
  aliasFormat: REALM_ALIAS_FORMAT,
  parse: parseRealmAddress,
  forRealmId: realmAddressForId,
  createAlias: createRealmAliasRecord,
  verifyAlias: verifyRealmAliasRecord,
  Resolver: RealmAddressResolver,
});

export const ChronicleEventV1 = Object.freeze({
  name: 'ChronicleEventV1',
  format: CHRONICLE_EVENT_FORMAT,
  schemaVersion: 1,
  create: createChronicleEvent,
  verify: verifyChronicleEvent,
  Chronicle: RealmChronicle,
});

export const RealmLinkV1 = Object.freeze({
  name: 'RealmLinkV1',
  protocol: REALM_LINK_PROTOCOL,
  version: 1,
  frames: REALM_LINK_FRAME,
  states: REALM_LINK_STATE,
  create: createRealmLink,
  attachTransport: attachRealmLinkTransport,
  handleFrame: handleRealmLinkFrame,
  send: sendRealmLinkData,
  upgradeTransport: upgradeRealmLinkTransport,
  snapshot: snapshotRealmLink,
  continuityRecord: realmLinkContinuityRecord,
  persistContinuity: persistRealmLinkContinuity,
  markDisconnected: markRealmLinkDisconnected,
  close: closeRealmLink,
  evidence: realmLinkEvidence,
  signFrame: signRealmLinkFrame,
  verifyFrame: verifyRealmLinkFrame,
});

export const AuthorityLeaseV1 = Object.freeze({
  name: 'AuthorityLeaseV1',
  format: AUTHORITY_LEASE_FORMAT,
  schemaVersion: 1,
  policies: AUTHORITY_POLICY,
  create: createAuthorityLease,
  renew: renewAuthorityLease,
  verify: verifyAuthorityLease,
  revocationFormat: AUTHORITY_REVOCATION_FORMAT,
  createRevocation: createAuthorityRevocation,
  verifyRevocation: verifyAuthorityRevocation,
});

export const AtlasRecordV1 = Object.freeze({
  ...AtlasRecordDescriptor,
  create: createAtlasRecordV1,
  verify: verifyAtlasRecordV1,
  visibility: ATLAS_VISIBILITY,
  visibilitySemantics: atlasVisibilitySemantics,
  canAccess: canAccessAtlasRecordV1,
});

export const PresenceV1 = Object.freeze({
  name: 'PresenceV1',
  protocol: PRESENCE_PROTOCOL,
  schema: PRESENCE_SCHEMA,
  version: 1,
  statuses: PRESENCE_STATUS,
  create: createPresenceV1,
  sign: signPresenceV1,
  verify: verifyPresenceV1,
  createTracker: createPresenceTracker,
  ingest: ingestPresence,
  pruneExpired: pruneExpiredPresence,
  snapshot: presenceSnapshot,
});

export const ContinuityV1 = Object.freeze({
  name: 'ContinuityV1',
  schema: CONTINUITY_SCHEMA,
  version: 1,
  transferStates: TRANSFER_STATE,
  create: createContinuityRecord,
  validate: validateContinuityRecord,
  createStore: createContinuityStore,
  createMemoryAdapter: createMemoryContinuityAdapter,
  save: saveContinuity,
  load: loadContinuity,
  remove: removeContinuity,
  updateTransferProgress,
});

export const HealthSnapshotV1 = Object.freeze({
  name: 'HealthSnapshotV1',
  schema: HEALTH_SCHEMA,
  version: 1,
  statuses: HEALTH_STATUS,
  createMonitor: createHealthMonitor,
  record: recordHealthComponent,
  remove: removeHealthComponent,
  subscribe: subscribeHealth,
  build: buildHealthSnapshotV1,
  observeRealmLink: observeRealmLinkHealth,
  observeDiscovery: observeDiscoveryHealth,
  observePresence: observePresenceHealth,
});

export {
  RealmCapsuleV1,
  RealmBranchV1,
  MergeProposalV1,
  OrganizationV1,
  CapabilityGrantV1,
  AccordTaskV1,
  ContextCapsuleV1,
  AccordResultV1,
  GatePlanV1,
};

export const REALM_NETWORK_PUBLIC_CONTRACTS_V1 = Object.freeze({
  RealmPassportV1,
  RealmAddressV1,
  ChronicleEventV1,
  RealmCapsuleV1,
  RealmLinkV1,
  AuthorityLeaseV1,
  RealmBranchV1,
  MergeProposalV1,
  OrganizationV1,
  CapabilityGrantV1,
  AccordTaskV1,
  ContextCapsuleV1,
  AccordResultV1,
  AtlasRecordV1,
  GatePlanV1,
  PresenceV1,
  ContinuityV1,
  HealthSnapshotV1,
});

export const REALM_NETWORK_PUBLIC_CONTRACT_NAMES_V1 = Object.freeze(
  Object.keys(REALM_NETWORK_PUBLIC_CONTRACTS_V1),
);
