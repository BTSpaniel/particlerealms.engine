// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// Explicit exports win over same-named subsystem descriptors and keep the
// public V1 contract surface stable while subsystem APIs remain available.
export {
  REALM_NETWORK_PUBLIC_CONTRACT_NAMES_V1,
  REALM_NETWORK_PUBLIC_CONTRACTS_V1,
  AccordResultV1,
  AccordTaskV1,
  AtlasRecordV1,
  AuthorityLeaseV1,
  CapabilityGrantV1,
  ChronicleEventV1,
  ContextCapsuleV1,
  ContinuityV1,
  GatePlanV1,
  HealthSnapshotV1,
  MergeProposalV1,
  OrganizationV1,
  PresenceV1,
  RealmAddressV1,
  RealmBranchV1,
  RealmCapsuleV1,
  RealmLinkV1,
  RealmPassportV1,
} from './contracts.js';

export * from './addressing/index.js';
export * from './identity/index.js';
export * from './chronicle/index.js';
export * from './capsule/index.js';
export * from './link/index.js';
export * from './presence/index.js';
export * from './health/index.js';
export * from './authority/index.js';
export * from './branches/index.js';
export * from './governance/index.js';
export * from './accord/index.js';
export * from './atlas/index.js';
export * from './gate/index.js';
export * from './shield/index.js';
export * from './publishing/index.js';
