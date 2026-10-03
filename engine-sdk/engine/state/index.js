// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// state/index.js — public barrel for the Causal State Engine (CSE), formerly the
// Universal Resonance State Engine (URC).
//
// Order-on-demand: unordered facts encoded through a resonance codebook,
// organized spatially, compared by wave-like similarity, repaired through
// correction codes, branched when order matters, committed only when reality
// must choose one truth, and projected by observers into experienced sequence.
//
// The CSE upgrade (see plans/causal-state-engine-upgrade-59657d.md) layers a
// partially-ordered, capability-secured, transactionally-committed world-state
// system on top of the URC core. The codebook/resonance/spatial layers are kept
// as the optional indexing/perception extension (spec §16) — never in the
// trusted authority/correctness path.
//
// Build status:
//   URC core: [x] M0 [x] M1 codebook [x] M2 spatial [x] M3 resonance
//             [x] M4 facts [x] M5 commit [x] M6 observer
//   CSE:      [x] P1 formal core (USO, tx envelope, idempotency, causal,
//                 14-step commit, receipts)
//             [x] P2 single-authority (entity/version, schema, provenance,
//                 capabilities, identity, event log, state roots, checkpoints)
//             [x] P3 reliability (outbox, idempotent inbox, sagas+compensation,
//                 reconciler, reservations + bounded-counter escrow)
//             [x] P4 concurrency (CRDTs, invariant-confluence classifier,
//                 optimistic/write-skew validator, dotted version vectors, HLC)
//             [x] P5 world model (belief vs canonical, object graph, affordances,
//                 tool-effect/discrepancy, prediction sandbox, untrusted boundary)
//             [x] P6 distributed (shard router, replicated log, Raft adapter,
//                 cross-shard 2PC + recovery, quorum checkpoints)
//             [x] P7 sim/resonance (independent sim clocks, deterministic world
//                 dynamics, approximate-retrieve→exact-verify perception index)
//             [x] P8 completeness (proposal pool, serializable queue, policy
//                 engine+risk gates, encryption/retention crypto-erase, GC,
//                 causal dynamics, TLA+ core stub)
//             [x] P9 hardening (WebCrypto AES-GCM retention, Byzantine adapter,
//                 executable bounded model checker + TLC config)
//   CSE COMPLETE: all 12 planes implemented + verified in verify.html.

export * from './version.js';

// Codebook layer (M1)
export {
  PATTERN_W, PATTERN_H, PATTERN_BITS, PATTERN_COUNT,
  packPattern, unpackPattern, hammingDistance,
  symmetries, canonicalId, PatternCodebook, patternHashId,
} from './codebook/PatternCodebook.js';
export { PRIME_TABLE, primeAt, symbolicSig, sigEquals, sigContains } from './codebook/SymbolicSig.js';
export { makeCodeEntry } from './codebook/CodeEntry.js';

// Spatial layer (M2)
export {
  spatialId2D, fromSpatialId2D, spatialId3D, fromSpatialId3D,
  hilbertId2D, fromHilbertId2D, chunkCoords2D, chunkId2D,
  chunkCoords3D, chunkId3D, neighbors2D,
} from './spatial/SpatialCode.js';

// Resonance layer (M3)
export { walshHadamard, pattern3x3ToVector, dct1D, idct1D, dct2D, idct2D, quantize } from './resonance/Transforms.js';
export { resonanceWHT, resonanceDCT, cosineSimilarity, l2Distance, nearestAttractor } from './resonance/ResonanceVector.js';

// Fact engine (M4)
export { fact, revoke, isTombstone, tombstoneTarget } from './facts/Fact.js';
export { FactStore } from './facts/FactStore.js';
export {
  SCOPE_RUNTIME, SCOPE_COMMIT, constraint, validateFacts, atMostOne, mutuallyExclusive,
} from './facts/Constraints.js';
export { applySequence, commutes, branchOrders, mergeEquivalent, prune } from './facts/Branch.js';
export { link, toposort, dependsOn } from './facts/Causality.js';
export { makeWitness } from './witness/Witness.js';
export { TIME_MODES, createTimeSource } from './time/TimeModel.js';

// Commit + correction gates (M5)
export { createCommitGate } from './commit/CommitGate.js';
export { CORRECTION_TIERS, CORRECTION_ACTIONS, correct } from './commit/CorrectionGate.js';

// Observer projection (M6)
export { projectSequence, chooseBranch } from './observer/Projection.js';

// Hashing utility (identity-only)
export { canonicalSetHash, hashFactString, hashU32Sequence, hexId } from './util/hashing.js';

// ── Causal State Engine (CSE) ────────────────────────────────────────────────

// Canonical serialization + self-describing hash ids (Integrity plane, §13)
export {
  DOMAIN_SEPARATOR, canonicalize, canonicalBytes,
  hashIdFast, hashIdSecure, parseHashId, hashIdEquals,
} from './util/canonical.js';

// Transaction plane (P1, §5–§7)
export { TX_SCHEMA_VERSION, makeTransaction, transactionBody, sealTransactionFast, sealTransaction } from './transaction/Transaction.js';
export { IdempotencyRegistry } from './transaction/Idempotency.js';
export { createCommitCoordinator } from './transaction/CommitCoordinator.js';

// Exclusive State plane — Unspent State Outputs (P1, §5)
export { USO_KIND, makeUSO, objectVersionOutput, isUSO } from './uso/USO.js';
export { USORegistry } from './uso/USORegistry.js';

// Causal plane (P1, §2,§9)
export { CausalGraph } from './causal/CausalParents.js';

// CSE witness receipts (P1, §7)
export { makeReceipt } from './witness/Witness.js';

// Semantic State plane — entities, schemas, provenance (P2, §1,§4,§14)
export { EntityRegistry } from './entity/EntityRegistry.js';
export { SchemaRegistry } from './entity/SchemaRegistry.js';
export { CERTAINTY, makeProvenance, isUntrusted, ProvenanceStore } from './entity/ProvenanceStore.js';

// Authority plane — capabilities + identity signer (P2, §6,§12)
export { makeCapability, attenuate, authorizes } from './authority/Capability.js';
export { CapabilityRegistry } from './authority/CapabilityRegistry.js';
export { createSigner, verifyWithKey } from './authority/Identity.js';

// Integrity & Storage plane — event log, state roots, checkpoints (P2, §13)
export { EventLog, EVENTLOG_GENESIS } from './integrity/EventLog.js';
export { computeStateRoot, rootFromStores } from './integrity/StateRoot.js';
export { makeCheckpoint, verifyCheckpoint } from './integrity/Checkpoint.js';

// Time plane — fencing tokens (P1/P3, §9)
export { FencingDomain } from './time/Fencing.js';

// Workflow plane — reliable external effects (P3, §11)
export { EFFECT_STATUS, makeEffectIntent, Outbox } from './workflow/Outbox.js';
export { Inbox } from './workflow/Inbox.js';
export { SAGA_STATUS, sagaStep, Saga } from './workflow/Saga.js';
export { RECONCILE_RESULT, Reconciler } from './workflow/Reconciler.js';

// Consistency plane — reservations + bounded-counter escrow (P3/P4, §5,§10)
export { ReservationManager, BoundedCounterEscrow } from './consistency/Reservation.js';

// Consistency plane — CRDTs + coordination-avoidance (P4, §4,§8)
export { GCounter, PNCounter, GSet, ORSet, LWWRegister } from './consistency/CRDT.js';
export { classifyConfluence } from './consistency/InvariantConfluence.js';
export { OptimisticValidator, detectWriteSkew } from './consistency/OptimisticValidator.js';

// Causal plane — precise causality + hybrid logical clock (P4, §9)
export { ORDER, VersionVector, DVVSet } from './causal/DottedVersionVector.js';
export { HLC, compareHLC } from './causal/HLC.js';

// AI World Model plane — belief vs canonical, affordances, prediction (P5, §15)
export { WORLD, BeliefStore } from './worldmodel/BeliefStore.js';
export { RELATION, ObjectGraph } from './worldmodel/ObjectGraph.js';
export { RISK, makeAffordance, AffordanceRegistry } from './worldmodel/AffordanceRegistry.js';
export { ToolEffectModel } from './worldmodel/ToolEffectModel.js';
export { PredictionSandbox } from './worldmodel/PredictionSandbox.js';
export { ingestUntrusted, canAuthorize, UntrustedBoundary } from './worldmodel/UntrustedBoundary.js';

// Replication plane — sharding, replicated log, Raft, cross-shard, quorum (P6, §8,§10)
export { ShardRouter } from './replication/ShardRouter.js';
export { ReplicatedLog } from './replication/ReplicatedLog.js';
export { RaftAdapter } from './replication/RaftAdapter.js';
export { CrossShardCoordinator } from './replication/CrossShardCoordinator.js';
export { CheckpointQuorum } from './replication/CheckpointQuorum.js';

// Simulation & resonance plane — sim clocks, deterministic dynamics, approximate
// retrieval reattached as the optional perception extension (P7, §9,§16,§17)
export { SimulationClock, SimulationClockSet } from './time/SimulationClock.js';
export { WorldDynamics } from './sim/WorldDynamics.js';
export { ResonanceIndex } from './perception/ResonanceIndex.js';

// Completeness pass — remaining plane-inventory components (P8, §3,§6,§13,§15,§19)
export { PROPOSAL_STATUS, ProposalPool } from './transaction/ProposalPool.js';
export { SerializableQueue } from './consistency/SerializableQueue.js';
export { RISK_LEVEL, DECISION, policyRule, PolicyEngine } from './authority/PolicyEngine.js';
export { RetentionManager } from './integrity/Retention.js';
export { GarbageCollector } from './integrity/GarbageCollector.js';
export { CausalDynamics } from './worldmodel/CausalDynamics.js';

// Hardening pass — production crypto, Byzantine profile, executable model check (P9)
export {
  secureCryptoAvailable, generateAesKey, exportKeyRaw, importAesKey, aeadSeal, aeadOpen,
} from './integrity/SecureCrypto.js';
export { SecureRetentionManager } from './integrity/SecureRetention.js';
export { ByzantineAdapter } from './replication/ByzantineAdapter.js';
export { exploreCommitMachine } from './verify/ModelCheck.js';
