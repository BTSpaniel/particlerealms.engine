// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export {
  REALM_BRANCH_FORMAT,
  REALM_BRANCH_PURPOSE,
  RealmBranchV1,
  RealmBranchDAG,
  createRealmBranch,
  verifyRealmBranch,
} from './RealmBranch.js';

export { RealmBranchStorage } from './BranchStorage.js';

export {
  OFFLINE_OPERATION_STATUS,
  OFFLINE_QUEUE_FORMAT,
  OfflineOperationQueue,
} from './OfflineOperationQueue.js';

export {
  REALM_GSET_RECORD_TYPE,
  REALM_MAP_RECORD_TYPE,
  SEMANTIC_COMPARISON_FORMAT,
  SemanticAdapterRegistry,
  applySemanticChange,
  compareSemanticSnapshots,
  createDefaultSemanticAdapterRegistry,
  hashSemanticChange,
  normalizeSemanticSnapshot,
  orderSemanticChanges,
} from './SemanticAdapters.js';

export {
  MERGE_COMMIT_PAYLOAD_FORMAT,
  MERGE_PROPOSAL_FORMAT,
  MergeProposalV1,
  applyMergeProposal,
  buildDefaultMergeDecisions,
  createMergeCommit,
  createMergeProposal,
  validateMergeDecisions,
  verifyMergeCommit,
  verifyMergeProposal,
} from './MergeProposal.js';
