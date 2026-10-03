---
title: Virtual Realm M2B Private-Bake Admission
description: Implemented admission-only M1C package capsule, evidence provisioning, protected publication selection, durable index, restart reconstruction, and explicit later-runtime boundaries.
audience: WebGPU OS storage and trust implementers, RealmForge developers, Engine integrators, security reviewers, and QA engineers
updated: 2026-09-03
status: M2B admission-only slice accepted; activation execution, runtime scheduling and evaluation, garbage collection and deletion, and Genesis Factory authority remain excluded
---

# Virtual Realm M2B Private-Bake Admission

M2B makes one accepted M1C city restart-verifiable without changing the M1C
package. It stores the exact private-v2 package, every resource envelope,
required external evidence, and every referenced signature envelope under one
operator-scoped durable authority. It advances a separate admission head only
after a complete readback and independent re-verification.

M2B does not materialize ECS entities, create GPU or audio resources, start a
Storylet, acquire input, or make a city visible. Its output is a deeply frozen
verified package and a durable admission identity that later M2 slices may
stage. (Sources:
`webgpu-os/apps/realmforge/virtual-realm/publication/RealmBakePackageVerifier.js`;
`webgpu-os/apps/realmforge/virtual-realm/publication/RealmBakePublisher.js`.)

## Accepted implementation boundary

The accepted M2B slice implements one closed RealmForge-to-kernel workflow:

1. RealmForge compiles and independently reverifies the exact owner-private
   M1C version-2 package.
2. A kernel-owned provisioning coordinator obtains the package-named evidence,
   signature envelopes, and single-use review authorization through an injected
   provisioning-material source. It validates the complete set before the first
   provisioning write, then uses the authorized provisioning service to store
   and read back the exact immutable bindings.
3. The protected M1 publication bridge selects the verified package under the
   Realm selection fence.
4. The admission service stores and recursively verifies the package graph,
   advances the separate durable admission head, and can reconstruct the exact
   selected package and sanitized summary after restart.

`createRealmM2PrivateBakeAdmissionComposition()` returns exactly two frozen
faces: `realmForgePrivateBakeAdmissionPort` for the authorized write workflow
and `bakeAdmissionPort` for read-only Virtual Realm admission access. Protected
storage, provisioning material, reviewer authority, signing-key resolution,
policy writers, the RealmForge compiler, and migration authority do not cross
the read face. (Sources:
`webgpu-os/kernel/realm/RealmM2PrivateBakeAdmissionComposition.js`;
`webgpu-os/kernel/realm/RealmPrivateBakeProvisioningCoordinator.js`;
`webgpu-os/apps/realmforge/virtual-realm/publication/RealmM2PrivateBakeAdmissionClient.js`.)

This acceptance does **not** instantiate the composition from `Desktop` with
invented capabilities. Desktop integration waits for genuine later runtime
authorities. M2B does not execute activation, construct a scheduler or
eligibility evaluator, run Storylets, collect or delete durable artifacts, or
grant Genesis Factory execution authority. Genesis Factory authority remains a
separate RF-GE2 gate.

## Mandatory M1C input

Full M2B accepts only:

```text
format  = particle-realms.private-realm-bake-package
version = 2
```

The package has exactly 17 top-level keys:

```text
format
version
audienceProjection
layoutPolicy
resourceLimitProfile
topologyNodes
topologyEdges
layoutReceiptId
layoutReceipt
localOperationsLookup
resources
dependencyClosure
manifest
manifestDigest
optimizationReceipt
bakeReceipt
storyletValidationReceipt
```

A version-1 package remains diagnostic. A public-shell package, an
access-refinement package, a manifest-only publication, an object with a
missing or additional top-level key, and an unknown private version are never
runtime-admissible. (Source:
`webgpu-os/apps/realmforge/virtual-realm/publication/RealmBakePackageVerifier.js`.)

## Why the M1 publication root is insufficient

`RealmBakePublisher.publish()` currently writes each resource's canonical
record text under its semantic `resourceId`, then writes the dependency closure
under `closureId`, the manifest under `bakeId`, and selects that `bakeId`. It
does not persist the complete package, resource-envelope metadata, audience
projection, layout policy, resource-limit profile, optimization receipt, bake
receipt, Storylet validation receipt, reviewed station package, authoring
evidence, Storylet policy, or referenced signature envelopes. The publication
root therefore cannot reconstruct the exact input to `verifyPrivateBake()`
after restart. (Source:
`webgpu-os/apps/realmforge/virtual-realm/publication/RealmBakePublisher.js`.)

M2B closes this gap beside M1. It does not rewrite or reinterpret the M1 root.

## Three independent transitions

| Transition | Durable | Owner | Commit meaning |
| --- | --- | --- | --- |
| M1 private publication root | Yes | RealmForge publication service | One `bakeId` was selected by authoring publication |
| M2 private admission head | Yes | Kernel-owned Realm admission service | One complete package graph was stored, read back, evidence/signature verified, and selected |
| M2 active runtime bundle | No | Virtual Realm activation barrier | One fully staged CPU/ECS/GPU presentation candidate became visible |

No transition silently advances another. A durable admission can exist while
the app is disabled. A visible runtime can keep the last accepted bundle while
a new admission attempt fails. Rolling back an admission head does not rewrite
the publication root or delete immutable artifacts.

## One durable authority

The kernel-owned Realm admission service is an `OperatorContext` participant.
It holds one kernel-private operator-service storage view for the captured
operator generation and uses an additive bounded exact-byte API on the shared
`RealmContentStore`. RealmForge and the Virtual Realm application receive
narrow ports. Neither instantiates IndexedDB, `StorageManager`,
`OperatorStorageView`, the private service view, or another
`RealmContentStore`. (Sources:
`webgpu-os/kernel/OperatorContext.js`;
`webgpu-os/kernel/OperatorStorageView.js`;
`webgpu-os/storage/RealmContentStore.js`.)

`OperatorStorageView` already maps logical `/user` storage to an account-owned
physical root and checks current generation before and after backend dispatch,
but `/user` is app-writable. A hashed Realm name inside `/user` is path-safe,
not kernel-private. M2B therefore cannot store an admission head there.

### Required storage-foundation upgrade

M2B adds one generic kernel primitive, not an app-specific bypass:

```text
OperatorPrivateServiceStorageView
  physical root:
    /os/state/operators/<account-token>/services/<service-token>/
  logical root exposed to its owning kernel service:
    /
```

`StorageManager.bindOperatorServiceRoot()` creates that view only for a
kernel-issued service descriptor. The token is derived from a registered stable
service ID; callers never supply a physical path. The view preserves the same
pre-dispatch and post-await operator-generation checks as
`OperatorStorageView`, but generic app syscalls cannot obtain it or address its
physical subtree.

The protected subtree is excluded from ordinary `/user` writes, moves, copies,
delete/trash, restore, version restore, backup export, and backup restore. Head,
pending-slot, intent, dispatch, recovery-retry, result, terminal-audit, policy,
evidence-binding, signature-binding, and durable-root control files are
non-versioned. The separate trusted activation-clock head is also non-versioned
and excluded from generic backup/export/restore because restoring storage history outside the
admission protocols would bypass monotonicity. A future service-aware backup
protocol must restore a recursively verified graph through a new admission
operation, never by copying control files.

Two same-origin cooperative fences are mandatory:

1. `RealmAdmissionSelectionCoordinator` owns one operator/private-Realm
   selection fence shared by the production M1 private-head writer, current M2
   admission-policy writer, the Realm signature trust-policy writer including
   its bounded Realm-local revocations, M2
   admission/rollback service, and final runtime-activation assertion. M2 holds
   it from final authority re-observation through M2 head readback. None of those
   cooperating authorities can change during that interval.
2. `OperatorPrivateServiceStorageView` owns one operator/service maintenance
   fence shared by admission, every trusted durable-root producer, and garbage
   collection. Admission holds it before the first immutable write until a
   verified pending slot points to the durable intent as a GC root or the
   operation abandons its unselected orphans. Root pin/release, checkpoint and
   handoff root changes, and the collector's final root snapshot/deletion all
   use this same fence.

Both fences use Web Locks with generation checks before acquisition, after
acquisition, after every await, and before release. Their receipts prove only
same-origin cooperation. Each participant joins the fence assigned above;
admission and later activation use the exact non-overlapping sequence
maintenance work, maintenance release, then selection acquisition. They never
hold maintenance while waiting for selection. Checkpoint commit is the sole
ordered dual-fence exception: it acquires its source-service selection lease
first, then maintenance, and releases maintenance before the selection lease.
No path may acquire those two fences in the reverse order. A backend or writer that
cannot join its assigned fence is not accepted for M2 publication, admission,
activation, root maintenance, or collection.

The first protected version-2 publication and every still-supported legacy
manifest writer also serialize through the same selection coordinator. The
legacy side receives only the closed
`realmPrivateLegacyPublicationWriter@1` capability; it cannot publish after a
versioned head has been selected. This closes the legacy-A-to-B race during the
first versioned compare-and-swap. A direct legacy mutation that bypasses that
cooperative writer is outside the accepted authority model and is rejected as
an unsupported publication source; the versioned service never claims to make
an uncooperative external write atomic. (Source:
`webgpu-os/kernel/realm/RealmPrivatePublicationHeadStorageAdapter.js`.)

The M2-compatible production M1 private head also moves beneath the protected
operator/service root and is reachable only through its narrow publication
port. A generic `/user` path can never be the versioned authority: existing
app-writable M1 heads are exposed only as `legacy-manifest` observations and
must migrate. This makes both path confinement and the selection fence necessary
for M1 stability; neither substitutes for the other.

`RealmContentStore` also gains additive methods that preserve existing callers:

```javascript
putExactBytes(bytes, {
    expectedBlobContentId,
    maximumBytes,
    signal,
})

getExactBytesBounded(blobContentId, {
    expectedByteLength = null,
    maximumBytes,
    signal,
})
```

These methods store raw payload bytes under an exact-byte namespace, check
input length before copying or hashing, observe physical size before reading,
reject a declared/observed size above the limit, and check cancellation before
and after I/O and hashing. `maximumBytes` is always required.
`expectedByteLength` is required when a verified parent record supplies it. It
may be absent only for the first content-addressed hop to an index, inventory
root, or frozen proposed head; those reads use the 1 MiB control-record ceiling,
verify the requested blob ID over the returned exact bytes, and record the
observed length before parsing. This removes any unbounded bootstrap read
without adding byte-length fields to the 71-field index. M2B is forbidden to
adapt legacy `getBlob()`, which reads and base64-decodes the complete wrapper
before it can enforce a returned payload limit. Existing `putBlob()`/`getBlob()`
behavior remains compatible for other subsystems.

### Exact protected storage faces

`StorageManager.bindOperatorServiceRoot({ serviceDescriptor, operatorScope,
signal })` returns the branded `OperatorPrivateServiceStorageView`; it never
returns a path. Only that view can create the branded content scope consumed by:

```javascript
RealmContentStore.createForOperatorService({
    scopedStorage,
    namespaceId: 'virtual-realm-admission-v1',
    logger,
})
```

The resulting store's logical root is
`/content/virtual-realm-admission-v1` inside the service view and its physical
root remains beneath the captured operator/service tokens. The existing public
constructor and `SAFE_ROOT` rule stay `/user`-only; they are not loosened to
accept `/os`, arbitrary roots, or a caller-asserted scope brand. A module-private
capability registry binds each scoped store to exactly one live service view and
operator generation. The trusted `RealmArtifactContentPort` is the only exported
face. GC enumerates only this exact operator/service/content namespace.

The service view also exposes only these bounded control operations:

```javascript
readControlTextBounded(logicalPath, { maximumBytes, expectedStorageSha256 = null, signal })
observeControlBounded(logicalPath, { maximumBytes, signal })
listControlNamesBounded(logicalDirectory, { maximumEntries, maximumNameBytes, signal })
writeControlAtomic(logicalPath, exactText, { expected, maximumBytes, signal })
deleteControlIfUnchanged(logicalPath, { expectedStorageSha256, maximumBytes, signal })
```

`StorageManager` implements the required scoped `readTextBounded()`,
`observeBounded()`, and `listBounded()` primitives additively. Each stats before
reading or hashing, rejects size above the requested bound, checks abort and
operator generation before/after every await, and never delegates to the current
full-read `observe()`. `deleteControlIfUnchanged()` is the protected adapter over
the existing `StorageManager.permanentDeleteIfUnchanged()` primitive. It accepts
only an exact observed storage SHA, retains the operator/generation checks, and
is followed by `observeControlBounded()`: absent means committed deletion, the
same exact bytes mean no effect and may be retried by the fixed-slot reclaimer,
and any third or malformed value is unresolved. Missing is never inferred from
an exception. The allowlist assigns one closed path-class cap before any caller
value is accepted:

| Protected control path class | Required `maximumBytes` |
| --- | --- |
| Ordinary admission, policy, trust, activation-clock, fixed-slot, journal, page, and run controls | `maximumAdmissionControlRecordBytes = 1048576` |
| Exact `/gc/root-directory-head.json` | `maximumAdmissionRootDirectoryHeadBytes = 16777216` |
| Exact `/gc/artifact-directory-head.json` | `maximumAdmissionArtifactDirectoryHeadBytes = 16777216` |
| Exact evidence-service `/directory/head.json` | `maximumAdmissionEvidenceDirectoryHeadBytes = 16777216` |

Every read stats against that registered cap before allocation; a caller cannot
select a larger class or use a directory-head allowance on any other path. Any
control-directory listing is capped at 64 canonical basenames, with 80 UTF-8 bytes per basename;
no recursive or caller-selected listing is available. Admission recovery does
not enumerate historical intent, dispatch, or result directories: it reads the
64 fixed seven-record slots directly. Each slot is exactly pending,
terminal-audit, intent, proposal, dispatch, retry, and result.

## Identifier namespaces

M2B preserves existing identifiers instead of rewriting prefixes:

| Identifier | Form | Meaning |
| --- | --- | --- |
| Realm content ID | `sha256:256:<64 lowercase hex>` | Domain-separated canonical contract content identity |
| RealmContentStore blob ID | `sha256:<64 lowercase hex>` | Exact logical blob payload-byte identity; not a physical wrapper/head-file SHA |
| RealmForge canonical payload hash | `sha256:<64 lowercase hex>` | Existing M1 payload-envelope identity |
| Stable semantic ID | Tagged opaque ID such as `resource:...` or `station-kit:...` | Authored identity, never a physical immutable address |

The index always names the field according to its identity class. A blob ID is
never accepted in a Realm contract-content field merely because both use
SHA-256.

`artifactKeyPolicyId = artifact-key-policy:virtual-realm-m2b-v1` derives
logical keys exactly as follows:

```text
virtual-realm:v1:package:<packageBlobContentId>
virtual-realm:v1:inventory:<inventoryKind>:<inventoryDigest>
virtual-realm:v1:inventory-chunk:<inventoryKind>:<chunkBlobContentId>
virtual-realm:v1:artifact:<blobContentId>
virtual-realm:v1:evidence:<blobContentId>
virtual-realm:v1:signature:<blobContentId>
virtual-realm:v1:admission:<admissionIndexDigest>
```

These are logical service keys, not filesystem paths. The operator-scoped
storage adapter owns safe physical-path derivation. `inventoryKind` is exactly
one of the three closed inventory kinds below. Fixed proposals, mutable heads,
intents, dispatch/retry markers, results, journals, and directory controls use
only the protected logical paths defined by their storage codecs; none has a
content artifact key.

Three raw SHA-256 values must remain distinct even when their lexical formats
match: a blob ID hashes logical payload bytes, an atomic storage receipt hashes
the physical bytes written at its path, and an admission-head CAS expectation
hashes the prior physical canonical head file. A field validator and role, not
the `sha256:` prefix alone, decide which value is accepted.

## Exact package and envelope bytes

The complete verified package is serialized with
`canonicalRealmBakeText()` and stored as exact UTF-8 bytes through
`RealmContentStore.putExactBytes()`. Every resource record and envelope is
stored the same way. Each of the ten listed non-resource package members,
Storylet policy, station record, authoring-evidence record, and signature envelope is
also stored as exact canonical bytes under its own blob ID. `topologyNodes`,
`topologyEdges`, and `resources` remain authoritative members of the complete
package blob; their individual typed records are reached through the resource
inventory rather than a fabricated eleventh package-member role.

On read, M2B:

1. obtains bytes under a declared maximum;
2. requires valid UTF-8 without replacement characters;
3. parses strict JSON with `RealmContractJsonParser` duplicate-key rejection;
4. reserializes through the correct canonical codec;
5. requires byte equality with the stored bytes;
6. validates the exact record schema and semantic digest;
7. verifies the blob ID against the original bytes;
8. only then exposes the frozen value to a verifier.

The generic Engine canonicalizer is not an admission parser. The M1
`RealmBakePackageCodec`, `RealmContractJsonParser`, and frozen Realm canonical
encoding own this boundary.
(Sources:
`webgpu-os/apps/realmforge/virtual-realm/publication/RealmBakePackageCodec.js`;
`webgpu-os/apps/the-virtual-realm/contracts/RealmContractJsonParser.js`;
`webgpu-os/apps/the-virtual-realm/contracts/CanonicalRealmEncoding.js`.)

### Base M2 admission hard limits

M1C authoring profiles can describe as many as 65,536 resources and 512 MiB of
total bake data, while the current Realm canonical JSON implementation accepts
at most 100,000 nodes and 16 MiB for one canonical value. The exact private-v2
package still embeds `resources`; external inventories do not remove that fact.
Base M2 therefore advertises and binds this honest initial runtime profile:

```text
runtimeCapabilityProfileId                 = runtime-capability:virtual-realm-m2-base-v1
maximumStaticEntities                       = 65536
maximumPresentationSlots                   = 65536
maximumCollisionBindings                   = 65536
maximumNavigationBindings                  = 65536
maximumAudioEmitters                       = 4096
maximumLocalOperationsZones                = 4096
maximumAdmissionPackagePayloadBytes        = 16777216
maximumAdmissionCanonicalNodes             = 100000
maximumAdmissionArrayItems                 = 100000
maximumAdmissionDepth                      = 64
maximumAdmissionStringBytes                = 1048576
maximumAdmissionResourceBindings           = 65536
maximumAdmissionAuthoringEvidenceBindings  = 4098
maximumAdmissionSignatureBindings          = 5
maximumAdmissionSignatureRoleBindings      = 5
maximumAdmissionEvidenceReviewerBindings   = 256
maximumAdmissionInventoryChunkEntries      = 256
maximumAdmissionInventoryChunks            = 257
maximumAdmissionInventoryChunkBytes        = 16777216
maximumAdmissionInventoryChunkNodes        = 100000
maximumAdmissionArtifactPayloadBytes        = 16777216
maximumAdmissionGraphPayloadBytes          = 134217728
maximumRuntimeHandoffBytes                 = 65536
maximumPendingAdmissionIntents              = 64
maximumAdmissionPendingSlotBytes            = 4096
maximumAdmissionPendingSlotAggregateBytes   = 262144
maximumAdmissionControlRecordBytes          = 1048576
maximumAdmissionFixedControlAggregateBytes  = 335544320
maximumAdmissionTerminalAuditEntries        = 64
maximumAdmissionTerminalAuditBytes          = 8192
maximumAdmissionTerminalAuditAggregateBytes = 524288
maximumRealmTrustKeyBindings                 = 1024
maximumAdmissionRootDirectoryEntries         = 1048576
maximumAdmissionRootDirectoryPageEntries     = 256
maximumAdmissionRootDirectoryPages           = 4096
maximumAdmissionRootDirectoryHeadBytes       = 16777216
maximumAdmissionArtifactDirectoryEntries     = 1048576
maximumAdmissionArtifactDirectoryPageEntries = 256
maximumAdmissionArtifactDirectoryPages       = 4096
maximumAdmissionArtifactDirectoryHeadBytes   = 16777216
maximumAdmissionArtifactRegistrationSlots    = 64
maximumAdmissionEvidenceDirectoryEntries     = 1048576
maximumAdmissionEvidenceDirectoryPageEntries = 256
maximumAdmissionEvidenceDirectoryPages       = 4096
maximumAdmissionEvidenceDirectoryHeadBytes   = 16777216
maximumAdmissionEvidenceRegistrationSlots    = 64
maximumAdmissionEvidenceRegistrationJournalAggregateBytes = 67108864
maximumAdmissionGcCandidateEntries           = 65536
maximumAdmissionGcCandidateChunkEntries      = 256
maximumAdmissionGcProgressChunkEntries       = 256
maximumAdmissionRootManagerJournalSlots      = 64
maximumAdmissionRootManagerJournalAggregateBytes = 201326592
```

This exact 52-field ordered object is the byte-identical `limits` object in the complete
[`RealmRuntimeCapabilityProfileV1`](m2a-runtime-composition.md#exact-realmruntimecapabilityprofilev1)
schema. M2B cannot add a service-only limit, omit an Engine limit, or reinterpret
an integer under the same profile ID/digest.

The package must satisfy both its authored M1C resource-limit profile and these
stricter runtime limits. Rejection is `runtime-profile-too-large`, not package
corruption. Raising package payloads toward the authored 512 MiB ceiling is a
separate scale gate requiring a strict streaming JSON parser, streaming
canonical writer, incremental SHA-256, bounded chunk reassembly, memory/abort
tests, and a new capability-profile version. Base M2 cannot claim that scale.

`maximumAdmissionGraphPayloadBytes` has one exact accounting rule. Let `G` be
the set of unique `blobContentId` values for the package, ten package-member
payloads, every resource record and envelope, all three inventory roots and all
their chunks, every authoring-evidence payload, every signature-envelope
payload, and the admission index itself. The graph total is
`sum(exactPayloadByteLength(blob) for blob in G)`. A blob referenced in several
roles counts once; the package blob and separately stored child blobs each count
because they are distinct stored payloads. Mutable M1/M2 heads and fixed
pending-slot/intent/proposal/dispatch/retry/result/terminal-audit records,
durable-root controls, the current admission/trust-policy records,
evidence/signature lookup bindings, logical keys, and physical storage wrappers
do not enter `G`; their sizes use the separate control-record ceiling. Admission
computes this sum from canonical bytes before the first write. Restart
accumulates it from bounded stat/observed lengths before each unique read and
rejects before reading the blob that would cross the bound.

## `RealmPrivateBakeAdmissionIndexV1`

The index is one record in the separate target 11-definition
`VirtualRealmM2RuntimeContractCatalog`. It is not appended to the frozen
109-definition catalog. M2A lands all 11 complete schema/validator/fixture/vector
definitions before M2B service implementation begins. M2B consumes that frozen
runtime catalog and cannot add, reorder, or weaken a definition.

```text
format  = particle-realms.realm-private-bake-admission-index
version = 1
```

Unknown keys and unknown major versions fail. Every listed field is required.
The V1 shape contains exactly 71 top-level fields. Admission-operation identity,
selection sequence, and previous-head identity are deliberately excluded from
this immutable content index; they belong to the mutable admission-head codec.
Identical admitted content under the same bound publication/runtime policy
therefore produces identical index bytes regardless of selection history.

### Exact top-level fields

| Field | Type and limit | Binding |
| --- | --- | --- |
| `format` | Exact string | Contract discriminator |
| `version` | Exact integer `1` | Contract version |
| `operatorPartitionId` | Opaque ID, at most 256 bytes | Captured operator-owned storage partition; never a path or public identity |
| `realmId` | Opaque ID | Must equal package projection, manifest, lookup, publication head, and load request Realm |
| `variantKind` | Exact string `private` | Rejects public-shell and access-refinement roots structurally |
| `audienceClass` | Exact string `owner-private` | Admission audience |
| `disclosureClass` | Exact string `local-private` | Admission disclosure ceiling |
| `publicationScopeKey` | Exact string `private:${realmId}` | Trusted M1 private publication scope for this Realm |
| `publicationRootId` | Opaque ID | Exact observed M1 private publication root; must equal `bakeId` |
| `publicationHeadGeneration` | Positive uint64 decimal text | Captured M1 publication-head generation used by admission |
| `publicationHeadStorageSha256` | Physical storage SHA-256 | Exact observed canonical M1 head-file bytes; closes root-value ABA |
| `packageFormat` | Exact string | `particle-realms.private-realm-bake-package` |
| `packageVersion` | Exact integer | `2` |
| `packageByteCanonicalizationProfileId` | Exact string `canonicalization:realm-bake-json-v1` | Binds `canonicalRealmBakeText()` and strict UTF-8/JSON behavior for the stored package bytes |
| `packageRealmForgeHashProfileId` | Exact string `hashing:realmforge-json-sha256-v1` | Binds the existing `hashRealmForgeJson()` normalization and hash semantics independently from stored-byte canonicalization |
| `artifactKeyPolicyId` | Exact profile ID | Binds deterministic logical artifact-key derivation without exposing physical paths |
| `packageBlobContentId` | Exact blob ID | Exact canonical 17-key package bytes |
| `packageRealmForgeDigest` | Existing RealmForge SHA-256 hash | Recomputed with `hashRealmForgeJson()` over the accepted package; no equality with the blob ID is assumed |
| `packageByteLength` | Positive safe integer, at most `16777216` in the base profile | Exact package UTF-8 byte length |
| `packageArtifactKey` | Canonical logical key | Exactly `virtual-realm:v1:package:<packageBlobContentId>` |
| `packageTopLevelKeys` | Exactly 17 sorted strings | Exact M1C package inventory, not a permissive projection |
| `bakeId` | Opaque ID | Exact `manifest.bakeId` |
| `manifestDigest` | Realm content ID | Exact package `manifestDigest` and recomputed manifest digest |
| `dependencyClosureId` | Opaque ID | Exact package closure ID |
| `dependencyClosureDigest` | Realm content ID | Recomputed closure digest |
| `resourceLimitProfileId` | Opaque ID | Exact package profile ID |
| `resourceLimitProfileDigest` | Realm content ID | Recomputed profile digest |
| `layoutPolicyId` | Opaque ID | Exact package layout policy ID |
| `layoutPolicyDigest` | Realm content ID | Recomputed policy digest |
| `layoutReceiptId` | Opaque ID | Exact package layout receipt ID |
| `layoutReceiptDigest` | Realm content ID | Recomputed layout receipt digest |
| `localOperationsLookupId` | Opaque ID | Exact package local lookup ID |
| `localOperationsLookupDigest` | Realm content ID | Recomputed lookup digest |
| `optimizationReceiptId` | Opaque ID | Exact package optimization receipt ID |
| `optimizationReceiptDigest` | Realm content ID | Recomputed optimization receipt digest |
| `bakeReceiptId` | Opaque ID | Exact package bake receipt ID |
| `bakeReceiptDigest` | Realm content ID | Recomputed bake receipt digest |
| `storyletCatalogId` | Opaque ID | Exact single M1C catalog resource ID |
| `storyletCatalogDigest` | Realm content ID | Recomputed catalog digest |
| `storyletCandidateIndexDigest` | Existing RealmForge SHA-256 hash | Exact candidate-index digest bound by the catalog and validation receipt |
| `storyletDependencyClosureId` | Opaque ID | Exact Storylet subclosure ID |
| `storyletDependencyClosureDigest` | Realm content ID | Recomputed Storylet subclosure digest |
| `storyletValidationReceiptId` | Opaque ID | Exact M1C validation receipt ID |
| `storyletValidationReceiptDigest` | Realm content ID | Recomputed validation receipt digest |
| `stationKitId` | Opaque ID | Exact reviewed private SecureMesh station kit ID |
| `stationKitContentId` | Existing RealmForge hash | Exact application-shipped kit content identity |
| `reviewedStationEvidenceId` | Opaque ID | Exact reviewed station authoring-evidence ID |
| `reviewedStationEvidenceDigest` | Existing RealmForge SHA-256 hash | Recomputed reviewed evidence digest |
| `storyletPolicyProfileId` | Opaque ID | Exact resolved M1C Storylet policy profile |
| `storyletPolicyDigest` | Realm content ID | Recomputed Storylet policy digest |
| `resourceEnvelopeInventoryDigest` | Realm content ID | Digest of the complete externalized resource-envelope inventory projection |
| `resourceEnvelopeInventoryRootBlobContentId` | Exact blob ID | Exact canonical inventory-root manifest bytes |
| `resourceEnvelopeCount` | Positive safe integer | Exact package resource count and closure count |
| `resourceRecordTotalBytes` | Non-negative safe integer | Exact sum of canonical resource record bytes and closure `totalBytes` |
| `resourceEnvelopeTotalBytes` | Non-negative safe integer | Exact sum of canonical envelope bytes |
| `packageMemberBindings` | Exactly ten entries | Exact non-resource package-member artifacts listed below |
| `authoringEvidenceInventoryDigest` | Realm content ID | Digest of the complete externalized station/policy/Storylet evidence inventory |
| `authoringEvidenceInventoryRootBlobContentId` | Exact blob ID | Exact canonical evidence-inventory root manifest bytes |
| `authoringEvidenceCount` | Safe integer `3..4098` | Exact distinct mandatory evidence closure cardinality |
| `authoringEvidenceTotalBytes` | Non-negative safe integer | Exact sum of evidence payload bytes |
| `signatureEnvelopeInventoryDigest` | Realm content ID | Digest of the complete externalized signature-envelope inventory |
| `signatureEnvelopeInventoryRootBlobContentId` | Exact blob ID | Exact canonical signature-inventory root manifest bytes |
| `signatureEnvelopeCount` | Safe integer `4..5` | Exact referenced signature-envelope set cardinality after deduplication |
| `signatureEnvelopeTotalBytes` | Non-negative safe integer | Exact sum of signature-envelope payload bytes |
| `verifierIdentity` | Exact string `verifier:realm-private-m1c-admission-v1` | Exact M1C package plus shared signature-closure verifier profile |
| `verifierVersion` | Exact integer `1` | Rejects future verifier semantics |
| `runtimeCapabilityProfileId` | Exact profile ID | Exact `RealmRuntimeCapabilityProfileV1` used before selection |
| `runtimeCapabilityProfileDigest` | Realm content ID | Recomputed digest of that exact capability/limit profile |
| `admissionPolicyRevision` | Opaque ID | Exact operator-local admission policy revision |
| `admissionPolicyDigest` | Realm content ID | Recomputed immutable projection of the admission policy used for selection |
| `admissionIndexDigest` | Realm content ID | Domain-separated digest over every canonical field except itself |

The index is immutable. `admissionIndexDigest` is recomputed with the frozen
Realm canonical encoder. The admission head stores both this semantic digest
and the `RealmContentStore` blob ID of the exact serialized index; those IDs
use different domains and are never conflated.

### Chunked external inventories

The index does not embed resource, evidence, or signature rows. Any of those
sets can make the index exceed the generic contract preflight limit. M2B uses
one internal chunked codec for three inventory kinds:

```text
resource-envelope
authoring-evidence
signature-envelope
```

`RealmPrivateBakeBindingInventoryRootV1` has exactly:

```text
format = particle-realms.realm-private-bake-binding-inventory-root
version = 1
inventoryKind
packageBlobContentId
packageRealmForgeDigest
artifactKeyPolicyId
entryCount
totalPayloadBytes
chunkEntryLimit
chunks
inventoryDigest
```

Each `chunks[]` descriptor has exactly:

```text
chunkIndex
firstSortKey
lastSortKey
entryCount
chunkBlobContentId
chunkDigest
canonicalByteLength
```

`RealmPrivateBakeBindingInventoryChunkV1` has exactly:

```text
format = particle-realms.realm-private-bake-binding-inventory-chunk
version = 1
inventoryKind
chunkIndex
entries
chunkDigest
```

Unknown or missing root, descriptor, chunk, or row keys fail. `chunkEntryLimit`
must exactly equal the bound runtime profile's
`maximumAdmissionInventoryChunkEntries`; it is not caller-selectable and is 256
in the base M2 profile. A chunk contains no more than that value, 16 MiB of
complete canonical chunk bytes, and 100,000 canonical nodes. Roots contain at
most 257 strictly ordered descriptors. Root and chunk formats are private
storage codecs, not additional runtime-contract definitions or public wire
formats.

An inventory root is also capped at `maximumAdmissionControlRecordBytes` and
100,000 canonical nodes. `firstSortKey` and `lastSortKey` are recomputed from the
first and last rows in that chunk, never supplied by a caller. The exact sort-key
codec is:

```text
resource-envelope -> [resourceId]
authoring-evidence -> [evidenceKind, evidenceId]
signature-envelope -> [envelopeId]
```

Each sort key is an exact deeply frozen one- or two-string canonical array.
Arrays of any other arity fail. Rows and descriptor keys use the same
lexicographic frozen Realm code-point comparator over the array elements, so
JSON escaping cannot change order. The root's `inventoryKind` separates the
three namespaces. Descriptor keys are bounded by the underlying accepted ID
lengths. This makes the content-addressed first-hop root read fit the declared
1 MiB bootstrap ceiling.

Resource rows have exactly:

```text
resourceId
resourceKind
definitionName
contentId
recordBlobContentId
envelopeBlobContentId
canonicalByteLength
envelopeByteLength
disclosureClass
dependencyIds
recordArtifactKey
envelopeArtifactKey
```

Resource rows sort strictly by `resourceId` using the frozen Realm code-point
comparator. IDs are unique and exactly match `package.resources`.
`resourceKind`, `definitionName`, `contentId`, `canonicalByteLength`,
`disclosureClass`, and `dependencyIds` match the M1C envelope. Record and
envelope blob IDs address their distinct payload bytes. Every disclosure is
`local-private`; every dependency resolves inside the inventory; graph counts,
bytes, depth, and reachability equal the verified closure. Semantic resource
IDs never become blob addresses.

The internal chunk-digest contract uses domain and format
`particle-realms.realm-private-bake-binding-inventory-chunk`, major version `1`,
and excludes only `chunkDigest` from its canonical payload. The internal
root-digest contract uses domain and format
`particle-realms.realm-private-bake-binding-inventory-root`, major version `1`,
and excludes only `inventoryDigest`. Both call the existing
`computeRealmContentId()` preimage algorithm and therefore produce a Realm
content ID, `sha256:256:<64 lowercase hex>`. The chunk projection includes
`format`, `version`, `inventoryKind`, `chunkIndex`, and the complete ordered
`entries`. The root projection includes every root field other than
`inventoryDigest`, including the complete ordered chunk descriptors and each
descriptor's `chunkDigest`.

The chunk and root `blobContentId` values independently hash their complete
canonical UTF-8 payload bytes, including their digest field, through the exact
byte store and therefore use `sha256:<64 lowercase hex>`. The semantic digest
and exact-byte blob ID are never substituted for one another.

`totalPayloadBytes` is a row-total, not the unique-blob graph total:

```text
resource-envelope = sum(canonicalByteLength + envelopeByteLength)
authoring-evidence = sum(canonicalByteLength)
signature-envelope = sum(canonicalByteLength)
```

The root value must equal, respectively,
`resourceRecordTotalBytes + resourceEnvelopeTotalBytes`,
`authoringEvidenceTotalBytes`, or `signatureEnvelopeTotalBytes` in the index.
Duplicate resource IDs, evidence tuples, or envelope IDs are forbidden, so the
row-total cannot silently double-count one row. Exact duplicate payload bytes
across different accepted rows deduplicate only in the computed unique-blob
graph total, not in these inventory projections.

After sorting, the builder takes the longest nonempty prefix whose completed
chunk record—including its recomputed digest—fits all three entry,
canonical-byte, and canonical-node ceilings. The next row begins the next
chunk. If one row cannot fit a completed single-row chunk, admission returns
`runtime-profile-too-large` before writes. Chunk boundaries therefore depend
only on canonical input and the bound profile, never I/O timing. The index
validates root digest, blob ID, count, row-total, and exact profile-derived
`chunkEntryLimit` before resolving chunks, then validates every descriptor and
chunk sequentially under the abort signal. No global canonical preflight limit
is raised.

### `packageMemberBindings[]`

The array contains exactly one entry for each role:

```text
audience-projection
spatial-layout-policy
resource-limit-profile
spatial-layout-receipt
local-operations-lookup
dependency-closure
visual-manifest
optimization-receipt
bake-receipt
storylet-validation-receipt
```

The role mapping is closed and normative:

| `memberRole` | Package value | `definitionName` | `semanticId` source | `contentDigest` source |
| --- | --- | --- | --- | --- |
| `audience-projection` | `audienceProjection` | `RealmAudienceSourceProjectionContract` | `projectionId` | recomputed `projectionDigest` |
| `spatial-layout-policy` | `layoutPolicy` | `RealmSpatialLayoutPolicyContract` | `layoutPolicyId` | recomputed `policyDigest` |
| `resource-limit-profile` | `resourceLimitProfile` | `RealmBakeResourceLimitProfileContract` | `resourceLimitProfileId` | recomputed `profileDigest` |
| `spatial-layout-receipt` | `layoutReceipt` | `RealmSpatialLayoutReceiptContract` | package `layoutReceiptId` | recomputed `layoutDigest` |
| `local-operations-lookup` | `localOperationsLookup` | `LocalOperationsLookupResourceContract` | `localOperationsLookupId` | recomputed `localOperationsLookupDigest` |
| `dependency-closure` | `dependencyClosure` | `RealmDependencyClosureContract` | `closureId` | recomputed `closureDigest` |
| `visual-manifest` | `manifest` | `RealmVisualBakeManifestContract` | `bakeId` | recomputed digest equal to package `manifestDigest` |
| `optimization-receipt` | `optimizationReceipt` | `RealmProofGatedOptimizationReceiptContract` | `optimizationReceiptId` | recomputed `optimizationReceiptDigest` |
| `bake-receipt` | `bakeReceipt` | `RealmBakeReceiptContract` | `receiptId` | recomputed `receiptDigest` |
| `storylet-validation-receipt` | `storyletValidationReceipt` | `RealmStoryletCatalogValidationReceiptContract` | `receiptId` | recomputed `receiptDigest` |

For every row, the named validator accepts the exact package value first, the
digest is recomputed through that definition, and any embedded/sibling digest
must equal it. The layout-receipt ID is additionally required to equal the
single matching resource-envelope ID. No reflection, guessed `*Id`/`*Digest`
field, or future definition fallback is permitted.

Each entry has exactly:

```text
memberRole
definitionName
semanticId
contentDigest
blobContentId
canonicalByteLength
artifactKey
```

Entries sort by `memberRole`. The package artifact remains the authority for
the 17-key object; these bindings make pre-allocation size checks, independent
readback, and cross-record verification possible.

### Authoring-evidence inventory rows

Each entry has exactly:

```text
evidenceKind
evidenceId
evidenceFormat
evidenceVersion
evidenceDigest
blobContentId
canonicalByteLength
artifactKey
validatorIdentity
audienceClass
disclosureClass
```

The required evidence set contains:

- the exact reviewed private station kit;
- its exact reviewed station authoring evidence;
- the exact M1C Storylet policy;
- one validated evidence record for every ID in
  `storyletValidationReceipt.authoringEvidenceIds`.

M1C receipts carry bare authoring-evidence IDs, so M2B freezes the only accepted
role-to-tuple derivation instead of asking a caller or store to guess a kind:

```text
reviewed station kit
  -> (reviewed-station-kit, stationKitId)
resolved M1C Storylet policy
  -> (storylet-policy, storyletPolicyProfileId)
receipt ID equal to reviewedStationEvidenceId
  -> (reviewed-station-authoring, reviewedStationEvidenceId)
every other receipt authoringEvidenceId
  -> (storylet-authoring, authoringEvidenceId)
```

Those four literals are the complete V1 `evidenceKind` set. The derived tuple is
passed unchanged to `resolveEvidence()` where applicable and must match the
resolved record's validated role, format, self-identity, and digest. Station-kit
and Storylet-policy results enter the same inventory under their fixed tuples.
An ID that validates under a different role is a substitution failure, not a
second lookup candidate.

The accepted M1C invariant requires `reviewedStationEvidenceId` to be a member
of `storyletValidationReceipt.authoringEvidenceIds`. The reviewed-station bullet
and receipt-derived bullet therefore name the same
`(evidenceKind, evidenceId)` row. The complete inventory has at least three and
at most 4,098 rows after deduplication by that exact tuple; IDs shared by
different evidence kinds do not collapse. Entries sort strictly by
`(evidenceKind, evidenceId)`. A bare evidence ID is never sufficient. Every
binding resolves to exact canonical bytes, an accepted format/version
validator, the expected semantic digest, `owner-private` audience, and
`local-private` disclosure. An authoring evidence ID with no resolvable record
makes migration and admission fail closed.

`RealmAdmissionEvidenceKindTableV1` freezes the validator dispatch:

| `evidenceKind` | Exact format/version | Self identity | Digest algorithm | Validator identity |
| --- | --- | --- | --- | --- |
| `reviewed-station-kit` | `particle-realms.reviewed-private-securemesh-station-kit` / `2` | `kitId` | `kitContentId = sha256RealmJson(unsigned)` using normalized `hashRealmForgeJson()` | `validateReviewedPrivateSecureMeshStationKit@2` |
| `reviewed-station-authoring` | `particle-realms.reviewed-station-authoring-evidence` / `1` | `evidenceId` | `evidenceDigest = sha256RealmJson(unsigned)` using normalized `hashRealmForgeJson()` | `validateReviewedStationAuthoringEvidence@1` |
| `storylet-policy` | `particle-realms.realm-storylet-policy` / `1` | `policyProfileId` | Contract self digest `policyDigest` through `computeRealmContentId()` | `RealmStoryletPolicyContract@1` |
| `storylet-authoring` | `particle-realms.realm-storylet-authoring-evidence-storage` / `1` | `evidenceId` | Contract self digest `evidenceDigest` through `computeRealmContentId()` | `validateRealmStoryletAuthoringEvidenceV1@1` |

The internal `storylet-authoring` record has exactly:

```text
format = particle-realms.realm-storylet-authoring-evidence-storage
version = 1
evidenceId
evidenceScope = storylet-authoring-review
sourceRevision
catalogId
catalogDigest
policyProfileId
policyDigest
reviewerIdentity
checkedInvariantIds
result = passed
audienceClass = owner-private
disclosureClass = local-private
evidenceDigest
```

`checkedInvariantIds` is a nonempty, code-point-sorted, duplicate-free array of
at most 4,096 canonical IDs. The catalog and policy fields must equal the exact
M1C catalog and resolved Storylet policy selected by the receipt. The digest
uses domain and format
`particle-realms.realm-storylet-authoring-evidence-storage`, major version `1`,
and excludes only `evidenceDigest`. This is a stored review receipt, not source
text, executable Storylet state, or permission to run a Storylet.

`evidencePolicyId` is not a decorative admission-policy label. It resolves with
its digest through the immutable code-shipped
`RealmAdmissionEvidencePolicyRegistry@1` to one exact
`RealmAdmissionEvidencePolicyV1`:

```text
format = particle-realms.realm-admission-evidence-policy
version = 1
evidencePolicyId
allowedProvisionerRoles
evidenceKindRules
authorizedStoryletReviewerIdentities
requiredStoryletAuthoringInvariantIds
evidencePolicyDigest
```

`allowedProvisionerRoles` is exactly the sorted set
`realmforge-migration`, `realmforge-publication`. `evidenceKindRules` contains
exactly the four rows in `RealmAdmissionEvidenceKindTableV1`; each row has
exactly `evidenceKind`, `validatorIdentity`, and
`requiresAuthenticatedReviewer`, which is true only for
`storylet-authoring`. Authorized reviewer identities are nonempty, sorted,
unique, control-free IDs capped by
`maximumAdmissionEvidenceReviewerBindings`. Required invariant IDs are
nonempty, sorted, unique, and capped at 4,096. A Storylet-authoring record's
`reviewerIdentity` must equal the authenticated reviewer and its
`checkedInvariantIds` must exactly equal the policy list; a self-asserted
`result = passed` without that authority is invalid.

`evidencePolicyDigest` uses `computeRealmContentId()` with the record format as
domain, major version `1`, and only `evidencePolicyDigest` excluded. The
registry requires byte-identical object, ID, and digest matching and has no
writer or dynamic registration face. Changing reviewer or invariant semantics
therefore requires a new evidence-policy ID/digest and an admission-policy
generation. Admission, restart, and final activation resolve the same immutable
policy object; no ambient reviewer list is accepted.

### Authorized evidence provisioning

M1C `authoringEvidenceIds` are opaque references, and the current publication
does not persist their records. M2B therefore defines a separate trusted
`RealmAdmissionEvidenceProvisioningPort@1`; it is held only by the authorized
RealmForge publication/migration workflow and never by the runtime app or the
`admitPrivateBake()` caller surface:

```javascript
provisionEvidence({
    realmId,
    evidenceKind,
    record,
    reviewAuthorization = null,
    maximumBytes,
    signal,
})
// -> { evidenceKind, evidenceId, evidenceDigest, blobContentId, bindingDigest }

provisionSignatureEnvelope({ realmId, envelopeRecord, maximumBytes, signal })
// -> { envelopeId, contentDigest, blobContentId, bindingDigest }
```

The evidence binding codec has exactly `format`, `version`,
`operatorPartitionId`, `realmId`, `evidenceKind`, `evidenceId`,
`evidenceFormat`, `evidenceVersion`, `evidenceDigest`, `blobContentId`,
`canonicalByteLength`, `audienceClass`, `disclosureClass`,
`validatorIdentity`, `evidencePolicyId`, `evidencePolicyDigest`,
`provisionerRole`, `provisionerIdentity`, `reviewAuthorizationId?`,
`authenticatedReviewerIdentity?`, `provisionedAt`, and `bindingDigest`. The two
review fields are required only for `storylet-authoring` and forbidden for the
other three kinds. Its format is
`particle-realms.realm-admission-evidence-binding-storage`, version `1`.
The signature binding codec has exactly `format`, `version`,
`operatorPartitionId`, `realmId`, `envelopeId`, `contentFormat`,
`contentVersion`, `contentDigest`, `publisherIdentity`, `keyId`, `algorithm`,
`blobContentId`, `canonicalByteLength`, and `bindingDigest`; its format is
`particle-realms.realm-admission-signature-binding-storage`, version `1`.
Each binding digest uses `computeRealmContentId()` with its own format/domain
and excludes only `bindingDigest`.

Provisioning captures operator/Realm scope plus the authenticated manager-scoped
provisioner identity/role, resolves the current admission policy's exact
registered evidence policy, enforces the per-artifact and remaining service
quota bounds before allocation, and invokes the exact table validator. For
`storylet-authoring`, it also consumes a single-use non-serializable review
authorization through `RealmAuthoringReviewAuthorityPort@1`, requires its
reviewer/policy/catalog/invariant bindings to equal the record, and persists
only its opaque authorization ID and authenticated reviewer identity. That
capability is forbidden for the other evidence kinds. The service stores and
reads back canonical payload bytes, then writes and reads back the deterministic
binding at the hashed allowlisted path while holding one shared admission
maintenance fence. Internally it passes that already-held branded handle to the
directory-aware content adapter and evidence-directory writer; neither
reacquires the Web Lock. An identical existing binding is idempotent; a different
binding at the same tuple/envelope path is a substitution conflict. There is no
overwrite, caller-selected path, caller-supplied partition, or unvalidated
import. Admission resolves only these bindings and independently revalidates
their payloads. Evidence-registry collection remains disabled until its own
bounded authority index and root proof are certified; quota exhaustion rejects
new provisioning without weakening admission.

### Signature-envelope inventory rows

Each entry has exactly these required fields:

```text
envelopeId
signatureRoleId
blobContentId
canonicalByteLength
artifactKey
signedRecordId
contentFormat
contentVersion
contentDigest
publisherIdentity
keyId
algorithm
audienceClass
issuedAt
expiresAt
```

It may contain `policyRevision` and `operationNonce` only when those exact
fields are present in the signature envelope. Entries sort strictly by
`envelopeId`. V1 requires `algorithm` to equal `ed25519`.

The required envelope set is derived through known contract definitions, not a
recursive field-name search. `RealmSignatureBindingRoleTableV1` is this exact
closed table:

| Definition | Signature role | Private-v2 disposition | `signedRecordId` source | Content digest source | Publisher source | Audience source |
| --- | --- | --- | --- | --- | --- | --- |
| `RealmSpatialLayoutReceiptContract` | `spatial-layout-receipt` | Required `signatureEnvelopeId` | Package `layoutReceiptId` | Recomputed record `layoutDigest` | Trust-policy role publisher | Constant `owner-private` |
| `RealmVisualBakeManifestContract` | None | `signatureEnvelopeId` forbidden for `private` | Package `manifest.bakeId` for unsigned identity only | External recomputed `manifestDigest` | Record `publisherIdentity` only for transported variants | Record `audienceClass` only for transported variants |
| `RealmBakeReceiptContract` | `realm-bake-receipt` | Required `signatureEnvelopeId` | Record `receiptId` | Recomputed record `receiptDigest` | Record `publisherIdentity`, equal to trust-policy role publisher | Constant `owner-private` |
| `RealmStoryletCatalogValidationReceiptContract` | `storylet-catalog-validation-receipt` | Required `signatureEnvelopeId` | Record `receiptId` | Recomputed record `receiptDigest` | Record `publisherIdentity`, equal to trust-policy role publisher | Record `validatedAudienceClass` |
| `RealmStoryletCatalogContract` | `storylet-catalog` | Optional `signatureEnvelopeId`; exactly one private catalog exists | Record `catalogId` | Recomputed record `catalogDigest` | Record `publisherIdentity`, equal to trust-policy role publisher | Record `audienceClass` |
| `RealmStoryletPolicyContract` | `storylet-policy` | Required `signatureEnvelopeId` | Package/index `storyletPolicyProfileId`, equal to record `policyProfileId` | Recomputed record `policyDigest` | Trust-policy role publisher | Constant `owner-private` |

Every row uses the definition's exact format and major version `1`. The layout
receipt is the explicit no-self-ID exception, and its duplicate appearance as a
package member and resource envelope deduplicates to one envelope. The private
manifest contributes none. The accepted private-v2 semantic closure is
therefore exactly four or five unique envelopes: layout, bake receipt,
validation receipt, and policy are mandatory; the private catalog is optional.

For each included row, the named `signatureEnvelopeId`, format/version,
recomputed digest, publisher, and audience must equal the corresponding fields
in the resolved `SignatureEnvelopeV1`. The derived `signedRecordId` is
independently cross-bound to the named source/package identity and retained in
the M2 inventory; V1 does not pretend that `SignatureEnvelopeV1` contains or
cryptographically signs a record-ID field. Adding that claim would require a
new M1C signature profile. The derived `signatureRoleId` selects one exact
current trust-policy role publisher, including record-sourced publishers.
Envelope `issuedAt`/`expiresAt` must contain admission time, fit the admission
policy's fixed lifetime and clock-skew ceilings, and not predate the selected
key's activation. The selected key's current state must be `active`; a
historical issuance time before `revokedAt` never restores current admission or
activation authority. If a source definition contains either lifetime
field, exact equality is additionally required. An envelope
`policyRevision`, when present, equals the Storylet record's `policyRevision`
for the policy row and the current trust revision for every other row.
`operationNonce` is forbidden for this immutable M1C closure.

`SignatureEnvelopeContract.signatureBytes` is terminal opaque signature
material, not a recursive envelope reference. Any signed source definition not
in this table, any table row with an undeclared envelope field, or any required
row missing its field fails closed. Each resolved envelope must then pass exact
preimage, key-policy, and Ed25519 verification.

The current private verifier validates signature references structurally but
does not resolve or cryptographically verify them. M2B must extract the mature
signature-closure algorithm from the public-package verifier into one shared
module and reuse it for private admission. It must not duplicate the algorithm.
(Sources:
`webgpu-os/apps/the-virtual-realm/contracts/SignatureEnvelopeContract.js`;
`webgpu-os/apps/realmforge/virtual-realm/publication/RealmSignatureAdapter.js`;
`webgpu-os/apps/realmforge/virtual-realm/publication/RealmPublicBakePackageVerifier.js`.)

## Internal admission-head storage codec

The mutable head is a private storage codec, not a public wire contract and not
one of the 11 M2 runtime records. It is stored as exact canonical JSON at an
operator-private path derived from a SHA-256 hash of `realmId`; a raw Realm ID
never enters the physical path.

Within `OperatorPrivateServiceStorageView`, the exact logical control layout is:

```text
/heads/<sha256-hex(UTF8(realmId))>.json
/pending/00.json ... /pending/63.json
/terminal/00.json ... /terminal/63.json
/intents/00.json ... /intents/63.json
/proposals/00.json ... /proposals/63.json
/dispatch/00.json ... /dispatch/63.json
/retries/00.json ... /retries/63.json
/results/00.json ... /results/63.json
/roots/pins/<sha256-hex(UTF8(canonicalRealmBakeText([realmId,'runtime-pin',rootReferenceId])))>.json
/roots/checkpoints/<sha256-hex(UTF8(canonicalRealmBakeText([realmId,'checkpoint',rootReferenceId])))>.json
/roots/handoffs/<sha256-hex(UTF8(canonicalRealmBakeText([realmId,'handoff',rootReferenceId])))>.json
/root-manager/runtime-pin/00.json ... /root-manager/runtime-pin/63.json
/root-manager/checkpoint/00.json ... /root-manager/checkpoint/63.json
/root-manager/handoff/00.json ... /root-manager/handoff/63.json
/runtime-manager/pin/00.json ... /runtime-manager/pin/63.json
/runtime-manager/checkpoint/<sha256-hex(UTF8(realmId))>.json
/runtime-manager/handoff/<sha256-hex(UTF8(realmId))>.json
/runtime-manager/checkpoint-handoff/<sha256-hex(UTF8(realmId))>-0.json
/runtime-manager/checkpoint-handoff/<sha256-hex(UTF8(realmId))>-1.json
/gc/root-directory-head.json
/gc/artifact-directory-head.json
/gc/artifact-registration/00.json ... /gc/artifact-registration/63.json
/gc/artifact-pages/0000-a.json ... /gc/artifact-pages/4095-b.json
/gc/candidates/000-a.json ... /gc/candidates/255-b.json
/gc/progress/000-a.json ... /gc/progress/255-b.json
/gc/run.json
```

The view rejects any other control-record path, separator, traversal segment,
case variant, or caller-provided physical path. Logical paths are mapped beneath
the current operator/service root and never exposed to the application. Pending,
intent, proposal, dispatch, recovery-retry, result, and terminal-audit records all use the
same fixed two-digit slot index. The service-owned operation ID is a required
cross-record value, never a path component. Startup reads only these fixed
bundles and never discovers work with an unbounded historical scan. Root-control
paths are usable only through the trusted root lease port defined below.

Other authorities use separate branded protected service views with their own
exact allowlists:

```text
virtual-realm-private-publication-v2
  /heads/<sha256-hex(UTF8(realmId))>.json

virtual-realm-admission-policy-v1
  /policies/<sha256-hex(UTF8(realmId))>.json

virtual-realm-signature-trust-v1
  /policies/<sha256-hex(UTF8(realmId))>.json

virtual-realm-admission-evidence-v1
  /evidence/<sha256-hex(UTF8(canonicalRealmBakeText([realmId,evidenceKind,evidenceId])))>.json
  /signatures/<sha256-hex(UTF8(canonicalRealmBakeText([realmId,envelopeId])))>.json
  /directory/head.json
  /directory/registration/00.json ... /directory/registration/63.json
  /directory/pages/0000-a.json ... /directory/pages/4095-b.json

virtual-realm-activation-clock-v1
  /heads/<sha256-hex(UTF8(realmId))>.json
```

Trust revocation is embedded in the one bounded current Realm policy; no
separate per-key mutable path exists. Evidence/signature binding paths are
absent-only and exact-byte immutable. A capability for one view cannot address
another. Their adapters coordinate with the shared selection-fence key where
they mutate a current authority rather than sharing a caller-visible path root.

`RealmPrivateBakeAdmissionHeadStorageV1` has exactly:

```text
format = particle-realms.realm-private-bake-admission-head-storage
version = 1
operatorPartitionId
realmId
generation
admissionOperationId
admissionIndexDigest
admissionIndexBlobContentId
packageBlobContentId
previousAdmissionIndexDigest?
previousHeadStorageSha256?
updatedAt
```

Unknown keys fail. `operatorPartitionId`, `realmId`, and
`admissionOperationId` are control-free opaque IDs of at most 256 UTF-8 bytes.
`generation` is positive uint64 decimal text. `updatedAt` is canonical UTC
RFC 3339 with exactly millisecond precision; it is chosen before intent write
and reused byte for byte on every retry. Both previous fields are absent only at
generation `1`; both are required later.

Head validation requires:

```text
head.generation = previousHead.generation + 1
head.previousAdmissionIndexDigest = previousHead.admissionIndexDigest
head.previousHeadStorageSha256 = SHA256(exact previous head-file bytes)
head.operatorPartitionId = selectedIndex.operatorPartitionId = captured partition
head.realmId = selectedIndex.realmId = requested Realm
head.admissionIndexDigest = recomputed selected-index semantic digest
head.admissionIndexBlobContentId = exact selected-index payload blob ID
head.packageBlobContentId = selectedIndex.packageBlobContentId
```

Selection chronology exists only in this head. Every normal admission or
rollback writes a new head generation whose `previousAdmissionIndexDigest`
names the currently selected index and whose `admissionIndexDigest` names the
intended next selection. Whether an older immutable index remains currently
eligible for direct reselection is governed by the rollback rules below; head
chronology never mutates that index or falsifies an embedded sequence.

The head file advances through
`OperatorPrivateServiceStorageView.writeControlAtomic()`, which delegates to
`StorageManager.writeAtomic()` while retaining the protected-path and operator
generation fences. It uses the exact SHA-256 of the previous head-file bytes;
`{ exists: false }` is used only for the first head. The service validates the
atomic receipt and reads back the exact new head bytes. Reachable-graph
eligibility is classified separately from that durable storage outcome.
(Source: `webgpu-os/storage/StorageManager.js`.)

This is cooperative same-origin serialization, not a cross-process database
transaction. The accepted service receipt must prove `backend: 'opfs'`,
`coordination: 'web-locks'`, `consistency: 'optimistic-cooperative'`,
`sameOriginSerialized: true`, `externalProcessCAS: false`,
`outcome: 'committed-observed'`, and the captured operator-service scope. A native or
external writer therefore cannot share this mutable head unless a future
backend supplies an independently certified exclusion protocol. M2B rejects a
receipt with different coordination semantics instead of overstating CAS.

### Durable operation intent and result

Before head CAS, the service first writes and reads back the exact frozen
`RealmPrivateBakeAdmissionHeadStorageV1` bytes at the chosen fixed slot's
absent-only `/proposals/NN.json` path. The proposal is a control record, not a
content-store blob, and uses `maximumAdmissionControlRecordBytes`. It then
writes and reads back an absent-only
`RealmPrivateBakeAdmissionIntentStorageV1` at the same slot's protected intent
path. It has exactly:

```text
format = particle-realms.realm-private-bake-admission-intent-storage
version = 1
operatorPartitionId
slotIndex
realmId
admissionOperationId
expectedPublicationRootId
expectedPublicationHeadGeneration
expectedPublicationHeadStorageSha256
expectedHeadGeneration
expectedHeadStorageSha256?
proposedHeadStorageSha256
proposedHeadCanonicalByteLength
admissionIndexDigest
admissionIndexBlobContentId
packageBlobContentId
admissionPolicyGeneration
admissionPolicyStorageSha256
signatureTrustPolicyId
signatureTrustPolicyRevision
signatureTrustPolicyDigest
signatureTrustPolicyGeneration
signatureTrustPolicyStorageSha256
createdAt
```

The three publication fields equal the caller's exact expected versioned M1
head and the initial captured M1 observation. `expectedHeadGeneration` is
non-negative uint64 decimal text; zero and absent expected SHA mean no prior M2
head. Those two fields equal the caller's exact expected admission head and the
initial captured M2 observation. The frozen proposed head is written and read
back at the same slot's fixed `/proposals/NN.json` control path before the
intent. `proposedHeadStorageSha256` is the SHA used for complete observed-head
equality, and `proposedHeadCanonicalByteLength` is a positive safe integer no
larger than `maximumAdmissionControlRecordBytes`.
The proposed head, including `updatedAt`, is frozen before the intent is written.
The two admission-policy fields copy the exact current policy generation and
storage SHA whose revision/digest are already bound by the immutable index.
The five trust fields are copied from one exact current
`RealmSignatureTrustPolicyStorageV1` observation. They make crash recovery
reproduce the original prerequisite instead of consulting an unnamed ambient
key or revocation source.

After intent readback and while still holding the maintenance fence, the service
CASes one of the 64 fixed `RealmPrivateBakeAdmissionPendingSlotStorageV1`
records. It has exactly one of these four closed shapes:

```text
pending:
  format = particle-realms.realm-private-bake-admission-pending-slot-storage
  version = 1
  operatorPartitionId
  slotIndex
  state = pending
  realmId
  admissionOperationId
  intentStorageSha256
  proposedHeadStorageSha256
  previousTerminalAuditGeneration
  previousTerminalAuditStorageSha256?
  createdAt

vacant:
  format = particle-realms.realm-private-bake-admission-pending-slot-storage
  version = 1
  operatorPartitionId
  slotIndex
  state = vacant
  previousAdmissionOperationId
  terminalAuditGeneration
  terminalAuditStorageSha256
  vacatedAt

reclaiming:
  format = particle-realms.realm-private-bake-admission-pending-slot-storage
  version = 1
  operatorPartitionId
  slotIndex
  state = reclaiming
  previousAdmissionOperationId
  intentStorageSha256
  proposalStorageSha256
  dispatchStorageSha256?
  recoveryRetryStorageSha256?
  resultStorageSha256
  terminalAuditGeneration
  terminalAuditStorageSha256
  reclaimStartedAt

clean-vacant:
  format = particle-realms.realm-private-bake-admission-pending-slot-storage
  version = 1
  operatorPartitionId
  slotIndex
  state = clean-vacant
  previousAdmissionOperationId
  terminalAuditGeneration
  terminalAuditStorageSha256
  reclaimedAt
```

`slotIndex` is an integer from 0 through 63 and maps to its exact two-digit
path. A missing slot is the initial clean state. A pending claim created from a
missing slot carries prior terminal generation `0` and no prior terminal SHA;
one created from `clean-vacant` copies that slot's exact terminal generation and
SHA. Only missing or exact `clean-vacant` may CAS to `pending`; `pending` may CAS
to `vacant` only after its current operation's exact terminal-audit record is
read back; `vacant` may CAS to `reclaiming`; and
`reclaiming` may CAS to `clean-vacant` only after its directly addressed control
bundle is authoritatively absent. No other transition is legal.

Pending-slot readback turns the intent into a discoverable GC root. If the slot
CAS receipt or readback fails, the service stays bound to the original operator
and observes that exact slot: exact proposed pending bytes resume the operation;
the exact missing/clean-vacant predecessor proves no slot root, after which the
fixed intent and proposal are conditionally removed under maintenance and immutable payloads
remain collectible orphans; any third, malformed, or unreadable value is
unresolved. If cleanup itself is interrupted, startup finds that residue at the
fixed slot and collection aborts until it is reconciled. It never assumes that a
failed readback means the CAS did not commit. Restart stats exactly 64 known
bundles, requires each pending record to fit
`maximumAdmissionPendingSlotBytes`, their pending sum to fit
`maximumAdmissionPendingSlotAggregateBytes`, and all fixed intent/proposal/
dispatch/retry/result bytes to fit `maximumAdmissionFixedControlAggregateBytes` before
sequential parsing.

Before choosing a new slot, maintenance completes every verifiable
`vacant`/`reclaiming` cleanup. A missing/clean-vacant slot with an exact matching
proposal and intent but authoritative absent dispatch/retry/result is a
pre-dispatch residue and both files are conditionally removed; an intent or
proposal without its exact peer, or any dispatch/retry/result without the matching
pending/terminal lineage is unresolved and blocks the slot. The service then
selects among clean bundles by the lowest terminal `auditGeneration`, treating
missing as zero, with `slotIndex` as the tie-breaker. An unreadable or
contradictory slot blocks that slot; a pending slot for the same Realm is
reconciled before any new operation.
This deterministic rotation retains the latest approximately 64 terminal
audits while keeping all detailed operation files bounded by the 64 slots.

Immediately before an authorized head CAS, after final selection-fence rechecks,
the service writes and reads back an absent-only
`RealmPrivateBakeAdmissionDispatchStorageV1` with exactly:

```text
format = particle-realms.realm-private-bake-admission-dispatch-storage
version = 1
operatorPartitionId
slotIndex
realmId
admissionOperationId
intentStorageSha256
proposedHeadStorageSha256
authorizedAt
```

The dispatch marker is permission for the initial frozen CAS attempt; it is not
evidence that the backend call occurred. A pending intent with no valid dispatch
marker is terminally `no-effect` and is never dispatched by recovery. The
service performs no unrelated await between dispatch-marker readback/generation
assertion and the head CAS.

Before the only permitted recovery retry, the service writes and reads back an
absent-only `RealmPrivateBakeAdmissionRecoveryRetryStorageV1` with exactly:

```text
format = particle-realms.realm-private-bake-admission-recovery-retry-storage
version = 1
operatorPartitionId
slotIndex
realmId
admissionOperationId
dispatchStorageSha256
authorizedAt
```

If this marker already exists and the head still equals the predecessor,
recovery records `no-effect`; it never authorizes another retry. A crash after
retry-marker readback but before the retry call is therefore conservatively
classified as no effect on the next recovery. If the retry did commit, exact
proposal-byte observation classifies it as committed. This bounds the operation
to one initial dispatch opportunity and one durable recovery-retry opportunity.

After storage classification and eligibility evaluation, the service writes an
absent-only
`RealmPrivateBakeAdmissionIntentResultStorageV1` with exactly:

```text
format = particle-realms.realm-private-bake-admission-intent-result-storage
version = 1
operatorPartitionId
slotIndex
realmId
admissionOperationId
intentStorageSha256
dispatchStorageSha256?
recoveryRetryStorageSha256?
storageOutcome
storageReasonCode?
eligibilityOutcome
eligibilityReasonCode?
observedHeadGeneration
observedHeadStorageSha256
observedAdmissionIndexDigest
resolvedAt
```

`storageOutcome` is exactly `committed`, `no-effect`, or `conflict`.
`storageReasonCode` is absent for `committed`, required for `no-effect` or
`conflict`, and is exactly `pre-dispatch-aborted`, `stale-publication`,
`stale-admission`, `current-policy-rejected`, `current-trust-rejected`,
`runtime-profile-incompatible`, `dispatch-no-effect`, or `head-conflict`.
`head-conflict` is required for `conflict`; every other value requires
`no-effect`.
`eligibilityOutcome` is `eligible` or `ineligible` only when storage outcome is
`committed`; it is `not-selected` for `no-effect` and `conflict`.
`eligibilityReasonCode` is required only for `ineligible` and is exactly one of
`corrupt-head`, `missing-artifact`, `stale-publication`,
`current-policy-rejected`, `current-trust-rejected`,
`runtime-profile-incompatible`, `runtime-profile-too-large`, or
`service-unavailable`. `dispatchStorageSha256` is required when a dispatch
marker exists and is absent only for a pre-dispatch `no-effect` result.
`recoveryRetryStorageSha256` is present if and only if the recovery-retry marker
exists.
`observedHeadGeneration` is non-negative uint64 decimal text. The observed SHA
and index digest are nullable only when `no-effect` observes the initial absent
head at generation zero. Timestamps use the same canonical UTC millisecond
form. Unknown or contradictory slot/intent/proposal/dispatch/retry/result combinations fail
closed. On operator-service startup, pending slots are read under the fixed
count and aggregate byte ceilings and reconciled before a new admission for the
same Realm may start. A verified pending slot makes its directly addressed
intent/proposal a durable GC root; a bare historical intent is not discoverable
authority. Dispatch, retry, and terminal-result records are audit/recovery
records, not selection or activation authority. Current load always recomputes
eligibility.

When several failures are simultaneously true, every implementation chooses the
first applicable token from these frozen orders; it never selects whichever
exception happened to arrive first:

```text
live pre-dispatch no-effect:
  stale-admission
  stale-publication
  current-policy-rejected
  current-trust-rejected
  runtime-profile-incompatible
  pre-dispatch-aborted

recovery no-effect with an exact predecessor:
  stale-admission
  stale-publication
  current-policy-rejected
  current-trust-rejected
  runtime-profile-incompatible
  dispatch-no-effect

committed but ineligible:
  corrupt-head
  missing-artifact
  stale-publication
  current-policy-rejected
  current-trust-rejected
  runtime-profile-incompatible
  runtime-profile-too-large
  service-unavailable
```

An authoritatively absent dispatch in recovery has only
`dispatch-no-effect`; `head-conflict` remains the sole conflict reason. These
orders make the absent-only terminal result byte-identical across browser,
restart, and Python-oracle implementations.

### Fixed terminal audit and bounded cleanup

Each pending slot has one fixed
`RealmPrivateBakeAdmissionTerminalAuditStorageV1` at the same two-digit
`/terminal` index. It has exactly:

```text
format = particle-realms.realm-private-bake-admission-terminal-audit-storage
version = 1
operatorPartitionId
slotIndex
auditGeneration
admissionOperationId
resultRecord
resultStorageSha256
previousAuditStorageSha256?
```

`resultRecord` is the complete exact
`RealmPrivateBakeAdmissionIntentResultStorageV1`, not a lossy summary.
`auditGeneration` is positive uint64 decimal text. The previous-audit SHA is
absent only at generation 1 and otherwise equals the SHA-256 of the exact prior
terminal file. Each audit is at most
`maximumAdmissionTerminalAuditBytes`, all 64 together are at most
`maximumAdmissionTerminalAuditAggregateBytes`, and no 65th audit path exists.

After terminal-result readback, the service acquires maintenance and requires
the terminal file to equal the prior generation/SHA frozen in the pending slot
(or to be authoritatively missing for prior generation zero). It CASes that
exact predecessor to the current operation's next audit generation, reads it
back, and only then changes `pending` to `vacant` with the new generation and
SHA. A crash at any boundary is recovered from the pending slot, exact result,
and exact terminal audit; an audit proves a terminal result even if the detailed
result file was already deleted. The previous operation's terminal audit may
legitimately coexist with a newly pending operation until this CAS and is
lineage, not a cross-operation equality violation.

Before reusing a vacant slot, maintenance first reads the exact terminal audit
named by the vacant generation/SHA. The audit's nested result supplies the exact
result and intent SHAs. The service reads that exact intent, derives the proposal
SHA from `intent.proposedHeadStorageSha256`, reads the exact proposal, and takes
the optional dispatch/retry SHAs only from the nested result. It then changes
`vacant` to `reclaiming` with those five independently verified SHAs. No recovery
step depends on the overwritten pending bytes or an in-memory copy of the old
pending claim. It conditionally deletes the five directly addressed files in
intent, proposal, dispatch, retry, result order through
`deleteControlIfUnchanged()`, accepting only authoritatively absent or the exact
old bytes at each reconciliation. It then CASes `reclaiming` to `clean-vacant`
and reads it back. A third value, malformed record, generation switch, or
unresolved delete leaves the slot in `reclaiming`, blocks its reuse, and blocks
collection; no new unique operation path is allocated from that slot. The fixed
64 slot/audit pairs therefore bound retained detailed controls without an
unbounded history scan.

### Exact cross-record equality matrix

The codec enforces all of these equalities before any recovery decision:

- `operatorPartitionId`, `realmId`, and `admissionOperationId` are identical
  across the current pending, intent, proposed head, dispatch, retry, result,
  and current terminal audit where those fields exist; `slotIndex` is identical
  across pending, intent, dispatch, retry, result, and terminal records and
  selects every fixed control path. A terminal file for the preceding operation
  is accepted only when its generation and exact SHA equal the pending claim's
  `previousTerminalAuditGeneration` and
  `previousTerminalAuditStorageSha256`; its operation ID must differ from the
  current operation ID.
- `pending.intentStorageSha256` equals SHA-256 of the exact intent bytes;
  `pending.proposedHeadStorageSha256` equals the intent field and SHA-256 of the
  exact fixed proposal bytes; the intent's proposed length equals those bytes.
- The intent's expected generation/SHA, proposed head SHA/byte length, index
  digest/blob ID, package blob ID, two admission-policy fields, and five
  trust-policy fields equal the corresponding proposal, selected index,
  predecessor, captured admission policy, and captured trust observation. The
  intent's three expected-publication fields equal both the caller expectation
  and index-bound initial M1 observation; the index policy revision/digest equal
  that same captured admission-policy record.
- `dispatch.intentStorageSha256` equals the exact intent SHA and
  `dispatch.proposedHeadStorageSha256` equals the exact proposal SHA.
- `retry.dispatchStorageSha256` equals SHA-256 of the exact dispatch bytes.
- Every present result control SHA equals the exact corresponding bytes; its
  observed generation/SHA/index digest equal the complete observed head bytes,
  including the exact zero/null representation for an absent initial head.
- The terminal audit operation ID, nested result, and result SHA equal the exact
  result bytes. `vacant.previousAdmissionOperationId` and
  `vacant.terminalAuditGeneration`/`terminalAuditStorageSha256` equal that
  audit; every `reclaiming` generation/SHA equals the same audit, nested result,
  and directly addressed file, including the fixed proposal.

Missing bytes are accepted as absent only after an authoritative bounded
observation. Unknown, contradictory, malformed, duplicate-key, hash-mismatched,
or partially readable control bytes are unresolved and are never interpreted as
an empty predecessor, a no-effect dispatch, or permission to reclaim.

## Trusted service ports

These ports are composed inside the kernel-owned admission service. The app
does not receive them directly.

### `RealmAdmissionPolicyPort@1`

The port returns one exact immutable
`RealmPrivateBakeAdmissionPolicyStorageV1`:

```text
format = particle-realms.realm-private-bake-admission-policy-storage
version = 1
operatorPartitionId
realmId
generation
policyRevision
packageFormat
packageVersion
requiredAudienceClass
requiredDisclosureClass
requiredSignatureAlgorithm
verifierIdentity
verifierVersion
acceptedRuntimeCapabilityProfileIds
evidencePolicyId
evidencePolicyDigest
signatureTrustPolicyId
maximumSignatureLifetimeMilliseconds
maximumSignatureClockSkewMilliseconds
policyDigest
previousPolicyStorageSha256?
updatedAt
```

`packageFormat`, `packageVersion`, audience, disclosure, signature algorithm,
and verifier fields equal the exact V1 values frozen by this work package.
`evidencePolicyId`/`evidencePolicyDigest` must resolve to one byte-identical
`RealmAdmissionEvidencePolicyV1` in the immutable registry above.
`acceptedRuntimeCapabilityProfileIds` is a nonempty, strictly code-point-sorted,
duplicate-free array of at most 32 profile IDs. `policyDigest` is the
Realm content ID produced by the existing `computeRealmContentId()` preimage
algorithm with domain and format
`particle-realms.realm-private-bake-admission-policy-storage`, major version `1`,
and `policyDigest`, `generation`, `previousPolicyStorageSha256`, and `updatedAt`
excluded from the semantic payload. Signature lifetime is a positive safe
integer no greater than 31,536,000,000 milliseconds; clock skew is a
non-negative safe integer no greater than 300,000 milliseconds. `generation`
is positive uint64 decimal text; previous SHA is absent only at generation 1
and required later. Unknown keys and versions fail closed.

```javascript
readCurrent({ operatorPartitionId, realmId, signal })
// -> {
//      policyRecord,
//      policyRevision,
//      policyDigest,
//      policyGeneration,
//      exactStorageSha256
//    }

assertCurrent({
    operatorPartitionId,
    realmId,
    expectedPolicyRevision,
    expectedPolicyDigest,
    expectedPolicyGeneration,
    expectedStorageSha256,
    signal,
})
// -> same exact frozen result
```

The service reads this policy before verification and asserts it again inside
the selection fence immediately before head CAS and before any
outcome-unknown retry. Policy history is evidence, never authority; only the
current exact record can authorize a new selection.

`RealmAdmissionPolicyStorageAdapter` also owns the separate authorized policy
write face. That face captures operator scope itself, validates and
canonicalizes the complete replacement record, acquires
`RealmAdmissionSelectionCoordinator`, performs an exact previous-storage-SHA
CAS, and reads the result back before release. It is not exported through
`RealmAdmissionPolicyPort` or to any app. There is no second policy writer.

This is the M2 operator-local admission policy, not the M1C Storylet policy.
The Storylet policy remains a package-bound authoring-evidence record; neither
record may substitute for the other.

The registry read face is exactly:

```javascript
resolveRegistered({ evidencePolicyId, evidencePolicyDigest })
// -> exact frozen RealmAdmissionEvidencePolicyV1

assertRegisteredObject({ evidencePolicy, evidencePolicyDigest })
// -> same exact frozen registered value
```

It is composed inside provisioning, admission, restart, and the activation
guard. It is never exported to the app and has no mutable writer.

### `RealmRuntimeCapabilityProfileRegistry@1`

```javascript
resolveRegistered({ runtimeCapabilityProfileId, runtimeCapabilityProfileDigest })
// -> exact frozen RealmRuntimeCapabilityProfileV1

assertRegisteredObject({ runtimeCapabilityProfile, runtimeCapabilityProfileDigest })
// -> same exact frozen registered value
```

The M2 base profile is an immutable code-shipped contract definition, not a
mutable operator setting. The registry recomputes its Realm content digest and
requires canonical byte equality with the supplied object. It has no write or
dynamic registration face. A changed limit set requires a new profile ID,
digest, contract/catalog version, and deployment. Consequently policy writers
select among immutable registered IDs, while no runtime-profile writer needs to
join the selection fence. Every transaction/restart/final commit reuses the same
registered object and ID/digest; “current profile” never means mutable ambient
state.

### `RealmArtifactContentPort@1`

```javascript
putCanonicalBytes(bytes, {
    expectedBlobContentId,
    expectedByteLength,
    artifactKind,
    maximumBytes,
    maintenanceFence,
    signal,
})
// -> { blobContentId, byteLength, written, deduplicated }

getVerifiedBytes(blobContentId, {
    expectedByteLength = null,
    maximumBytes,
    signal,
})
// -> Uint8Array | null
```

This port adapts the additive `RealmContentStore.putExactBytes()` and
`getExactBytesBounded()` methods. Absent-only races are accepted only when
bounded exact payload bytes verify under the same blob ID. It never exposes a
physical path or file SHA. A null expected length is legal only for the bounded
content-addressed first-hop records defined above.

Every put requires the exact live branded fence from the shared
`RealmAdmissionMaintenanceCoordinator`. The directory-aware adapter asserts the
borrowed handle and performs blob registration without reacquiring its Web Lock;
it rejects an absent, foreign, stale, or nested fence. Reads require no mutation
fence. This lets admission keep immutable staging and pending-root publication
inside one maintenance interval without a non-reentrant lock acquisition.

### `RealmPrivatePublicationHeadPort@1`

The M2-compatible production authority is
`RealmPrivatePublicationHeadStorageV2`, an internal exact codec with these
fields:

```text
format = particle-realms.realm-private-publication-head-storage
version = 2
operatorPartitionId
realmId
scopeKey
generation
publicationOperationId
rootId
previousRootId?
previousHeadStorageSha256?
updatedAt
```

It is stored in the separate protected service namespace
`virtual-realm-private-publication-v2` at
`/heads/<sha256-hex(UTF8(realmId))>.json`. `scopeKey` must equal
`private:${realmId}`. Generation is positive uint64 decimal text. Both previous
fields are absent only at generation 1 and required thereafter; they must equal
the predecessor's root ID and SHA-256 of its exact canonical file bytes.
`updatedAt` uses canonical UTC milliseconds. The publisher captures operator
scope and creates `publicationOperationId`; callers cannot nominate either.
Unknown keys, versions, discontinuous generations, and ABA lineage fail closed.

The production writer acquires `RealmAdmissionSelectionCoordinator`, re-reads
its exact predecessor, and calls that protected view's `writeControlAtomic()`
with `{exists:false}` only for generation 1 or the exact predecessor storage SHA
thereafter. It validates the cooperative receipt and reads the complete new head
back before release. `exactStorageSha256` below is the hash of those observed
canonical file bytes, not `rootId` and not an immutable blob ID.

```javascript
observePrivateHead({ realmId, signal })
// -> exactly one of:
//    { status: 'missing' }
//    {
//      status: 'legacy-manifest',
//      scopeKey: `private:${realmId}`,
//      rootId
//    }
//    {
//      status: 'versioned',
//      scopeKey: `private:${realmId}`,
//      rootId,
//      generation,
//      exactStorageSha256
//    }

acquireAdmissionFence({ realmId, expectedVersionedHead, signal })
// -> {
//      fenceId,
//      observedHead,
//      assertCurrent({ signal }),
//      release()
//    }
```

All three observations are exact closed variants. `missing` maps to M2A
`missing`; `legacy-manifest` maps to `migration-required` with only the root ID
and never fabricates a generation or storage SHA; only `versioned` can enter an
index or `acquireAdmissionFence()`. The current M1 publisher port exposes a root
ID but no generation or exact head observation. Its production storage adapter
must become versioned and ABA-resistant while preserving the accepted
RealmForge call surface. The same production adapter must route the M1
private-head CAS through `RealmAdmissionSelectionCoordinator`; otherwise the
fence cannot prove a stable M1 observation and M2 admission fails closed. The
returned fence is an internal single-use disposable capability. It cannot cross
into RealmForge or the Virtual Realm app.

### `RealmAdmissionEvidenceResolver@1`

```javascript
resolveSignatureEnvelope({ realmId, envelopeId }, { maximumBytes, signal })
resolveSigningKey({
    realmId,
    keyId,
    publisherIdentity,
    signatureRoleId,
    usage: 'verify',
    expectedKeyFingerprint,
    expectedTrustPolicyBinding,
    signal,
})
resolveStoryletPolicy({ realmId, policyProfileId }, { maximumBytes, signal })
resolveStationKit({ realmId, stationKitId }, { maximumBytes, signal })
resolveEvidence({ realmId, evidenceKind, evidenceId }, { maximumBytes, signal })
```

Each of the four byte-record resolver families returns canonical bytes,
semantic identity/digest, format, version, audience/disclosure classification,
and validator identity. Key material never enters an index, diagnostic,
receipt, application value, or runtime bundle.

Every byte-returning resolver call requires a positive bound no larger than the
minimum of `maximumAdmissionArtifactPayloadBytes` and the remaining
`maximumAdmissionGraphPayloadBytes` budget. Resolution is sequential. The
service first resolves the bounded immutable binding, which supplies payload ID
and byte length without loading payload bytes. It seeds one
`seenGraphBlobContentIds` set with all already known package/member/resource
payload IDs. A new resolver payload is charged once before read; a repeated ID
must declare the same length and reuses already verified bytes without another
charge. The resolver observes size and rejects before reading or allocating
bytes above the call bound. This is the same unique-blob rule used by `G`, not a
conservative per-reference double count. The resolver lookup key is always the exact
`(realmId, evidenceKind, evidenceId)` tuple; inventory identity/deduplication is
the `(evidenceKind, evidenceId)` suffix inside that already bound Realm. A bare
ID cannot resolve or alias a different Realm or kind. `resolveSigningKey()`
returns exactly `{ algorithm: 'ed25519', keyFingerprint, verifyKey }`, where
`verifyKey` is a non-serializable verify-only `CryptoKey`; that result is outside
the artifact byte graph and may be consumed only by the signature verifier.

V1 accepts only the Realm signature profile's verify-only Ed25519 `CryptoKey`
and exact `algorithm: 'ed25519'`. The package installation TrustStore's
ECDSA/TOFU authority is a different trust domain and cannot silently satisfy a
Realm signature lookup. Publisher identity, key ID, usage, algorithm, policy
revision, and current revocation state all bind before verification.

### Realm-scoped signature trust and revocation

`RealmSignatureTrustPolicyStorageV1` is the sole mutable key and revocation
authority for one operator/Realm. It has exactly:

```text
format = particle-realms.realm-signature-trust-policy-storage
version = 1
operatorPartitionId
realmId
generation
trustPolicyId
trustRevision
algorithm = ed25519
rolePublisherBindings
keyBindings
policyDigest
previousPolicyStorageSha256?
updatedAt
```

`rolePublisherBindings` has exactly five sorted unique records,
`{ roleId, publisherIdentity }`, one for each signed private-v2 role:
`spatial-layout-receipt`, `realm-bake-receipt`,
`storylet-catalog-validation-receipt`, `storylet-catalog`, and
`storylet-policy`. A key binding authorizes only signatures whose derived role
maps to that exact publisher; mere presence of a publisher/key tuple does not
grant every role. Each `keyBindings` entry has exactly:

```text
publisherIdentity
keyId
usage = verify
algorithm = ed25519
publicKeySpkiBase64Url
publicKeySpkiSha256
state
activatedAt
revokedAt?
revocationReasonCode?
```

Bindings are strictly sorted and unique by `(publisherIdentity, keyId)` and are
capped by `maximumRealmTrustKeyBindings`. SPKI is canonical DER encoded as
unpadded base64url; `publicKeySpkiSha256` is SHA-256 of those exact DER bytes.
`state` is exactly `active` or `revoked`. Both revocation fields are absent for
active and required for revoked; `revokedAt >= activatedAt`, and the closed
reason set is `compromised`, `rotated`, `publisher-withdrawn`,
`operator-revoked`, or `policy-retired`.

`trustPolicyId` must equal the current admission policy's
`signatureTrustPolicyId`; all five role publishers must have at least one
matching key binding, and duplicate SPKI fingerprints under different
publisher/key tuples are rejected. `rolePublisherBindings` cannot exceed the
profile's exact `maximumAdmissionSignatureRoleBindings = 5`.
`trustRevision` is a nonempty control-free opaque ID of at most 256 UTF-8 bytes.

`policyDigest` uses `computeRealmContentId()` with domain and format
`particle-realms.realm-signature-trust-policy-storage`, major version `1`, and
excludes `policyDigest`, `generation`, `previousPolicyStorageSha256`, and
`updatedAt`. Generation is positive uint64 decimal text. Previous SHA is absent
only at generation 1 and otherwise equals SHA-256 of the exact prior policy
file. The complete record must fit `maximumAdmissionControlRecordBytes`.

```javascript
readCurrent({ operatorPartitionId, realmId, signal })
// -> {
//      trustPolicyRecord,
//      trustPolicyId,
//      trustRevision,
//      policyDigest,
//      generation,
//      exactStorageSha256
//    }

assertCurrent({
    operatorPartitionId,
    realmId,
    expectedTrustPolicyId,
    expectedTrustRevision,
    expectedPolicyDigest,
    expectedGeneration,
    expectedStorageSha256,
    signal,
})
// -> same exact frozen result
```

`RealmSignatureTrustPolicyStorageAdapter` captures operator scope, stores the
record only at the exact Realm-hashed policy path, acquires
`RealmAdmissionSelectionCoordinator`, enforces generation plus predecessor SHA,
performs CAS, and reads back exact bytes before release. Revocation is a full
bounded replacement of this Realm record under that same fence; there is no
operator-global per-key revocation writer and no second mutable key store. A
trusted administrator requesting a global revocation must fan out one separately
authorized update through every affected Realm's selection fence.

`resolveSigningKey()` imports the verify-only `CryptoKey` from the already
captured exact SPKI binding and proves its SHA, publisher, key ID, usage,
algorithm, exact derived signature role, current `state = active`, activation
time, role publisher, and full expected trust-policy binding before returning
it. A revoked binding remains historical evidence but is never returned, even
when the envelope predates `revokedAt`. The existing `RealmSignatureAdapter`
remains only the WebCrypto sign/verify primitive behind this boundary. No app
receives the writer, policy store, SPKI bytes, or key resolver.

### `RealmPrivateBakeVerifierPort@1`

```javascript
verifyV2({
    packageRecord,
    resolvedEvidence,
    signatureVerifier,
    admissionPolicy,
    runtimeCapabilityProfile,
    now,
    signal,
})
// -> {
//      verifiedPackage,
//      sanitizedVerificationSummary
//    }
```

Both returned values are exact-key, deeply frozen plain records.

This adapter composes the existing `RealmBakePackageVerifier` with external
evidence and the shared signature-closure verifier. The existing M1C verifier
still owns package, policy, station, Storylet, closure, limit, and receipt
semantics. The M2 runtime verifier separately owns current Engine compatibility,
local-only closure, and materialization ceilings.

### Trusted write face

```javascript
admitPrivateBake({
    realmId,
    candidatePackage,
    expectedPublicationHead,
    expectedAdmissionHead,
    runtimeCapabilityProfile,
    signal,
})
// -> exactly one of:
//    { status: 'accepted', activationReceipt: RealmArtifactStoreActivationReceiptV1 }
//    { status: 'rejected', reasonCode }
//    { status: 'not-selected', storageOutcome, reasonCode }
//    {
//      status: 'committed-ineligible',
//      reasonCode,
//      admissionHeadBinding: {
//        admissionIndexDigest,
//        admissionHeadGeneration,
//        admissionHeadStorageSha256
//      }
//    }
//    { status: 'unresolved', reasonCode, recoverable: true }
```

All five variants are exact closed objects. `rejected.reasonCode` is exactly one
of `invalid-request`, `migration-required`, `invalid-package`, `limit-rejected`,
`missing-evidence`, `invalid-evidence`, `invalid-signature`,
`stale-publication`, `current-policy-rejected`, `current-trust-rejected`,
`runtime-profile-incompatible`, `runtime-profile-too-large`,
`pending-capacity-exhausted`, or `storage-unavailable`.
`not-selected.storageOutcome` is `no-effect` or
`conflict`; its reason is exactly `stale-publication`, `stale-admission`,
`current-policy-rejected`, `current-trust-rejected`,
`runtime-profile-incompatible`, `pre-dispatch-aborted`, `dispatch-no-effect`, or
`conflict`. The committed-ineligible reason
uses the exact eligibility reason set declared by the terminal-result codec.
`unresolved.reasonCode` is exactly `outcome-unknown`,
`operator-generation-changed`, `corrupt-control-record`, or
`service-unavailable`. A committed storage transition never returns `rejected`
or `not-selected`. Public `not-selected.reasonCode: 'conflict'` is the exact
sanitized projection of terminal `storageReasonCode: 'head-conflict'`; every
other not-selected reason token is copied unchanged.

Only the RealmForge publication/migration workflow receives this capability.
The Virtual Realm application receives the read-only `bakeAdmissionPort@1`
defined by [M2A runtime composition](m2a-runtime-composition.md).
The service captures the operator context itself and resolves evidence, keys,
signatures, station material, and policy through its own trusted ports. A caller
cannot nominate an operator partition, operation ID, timestamp, control path, or
pre-resolved trust data. After validating the request shape, the service creates
`admissionOperationId` from at least 128 bits of kernel cryptographic randomness,
freezes it for the transaction and every recovery attempt, then selects a fixed
slot and proves that slot's intent/proposal/dispatch/retry/result controls absent under
maintenance. Random identity never selects a path.

## Admission transaction

Admission is one generation-fenced, crash-recoverable transaction:

1. Capture current operator scope, private service partition, local Realm,
   runtime capability profile, admission policy including generation/storage
   SHA, Realm trust policy including generation/storage SHA, admission head, and
   admission generation. Require the caller's complete expected publication and
   admission bindings to equal those initial authoritative observations before
   any immutable or control write; an absent first M2 head is represented only
   by generation zero plus absent SHA. Generate and freeze the service-owned
   admission operation ID. Its fixed control paths are selected and proven
   clean only under maintenance in step 8.
2. Validate the exact admission-policy codec, resolve its exact immutable
   evidence-policy ID/digest/object, and observe the versioned M1
   private publication head, binding its scope, root, generation, and exact
   storage SHA; require it again to equal `expectedPublicationHead` and require
   the captured admission head to equal `expectedAdmissionHead`.
3. Strictly validate and canonicalize the complete 17-key v2 package, package
   members, resource records, and resource envelopes; reject base-M2 per-value,
   count, node, depth, and known-byte limit violations in memory.
4. Resolve station-kit, Storylet-policy, evidence-tuple, and signature-envelope
   bindings sequentially. Seed a `seenGraphBlobContentIds` set and charged-byte
   total from the already known package, package-member, resource-record, and
   resource-envelope blob IDs. A binding whose payload ID is new receives the
   lesser of the per-value ceiling and remaining graph budget, is charged once
   before reading, and is then verified; a repeated payload ID must declare the
   same byte length and reuses the already verified immutable bytes without a
   second charge. Resolve verify-only keys separately from the byte graph.
5. Run exact M1C package verification, evidence-policy reviewer/provisioner
   validation, signature-closure verification, local-only closure, and runtime
   compatibility before writes.
6. Build deterministic resource, evidence, and signature inventory chunks and
   roots under the hard limits.
7. Build, validate, digest, and canonicalize the complete candidate
   `RealmPrivateBakeAdmissionIndexV1` from deterministic expected blob IDs;
   compute the exact unique-blob graph total including that index and reject any
   limit violation before the first write.
8. Acquire the operator/service maintenance fence; stat/read all 64 fixed
   pending/intent/proposal/dispatch/retry/result/terminal bundles under their aggregate
   bounds; fail closed on malformed or contradictory pairs; and complete every safely reconcilable
   vacant/reclaiming cleanup. If a verified pending slot names the requested
   Realm, release maintenance, reconcile that operation, and restart admission
   from a fresh authority capture; never begin a second same-Realm operation.
   Otherwise choose the fully clean missing/clean-vacant bundle with lowest
   terminal audit generation and then lowest index; require its five operation
   controls absent. Refuse when no clean slot exists.
9. Store all immutable payload bytes, inventory chunks, inventory roots, and
   the candidate index with absent-only semantics through the bounded content
   port, passing the exact already-held maintenance fence so artifact
   registration never reacquires its non-reentrant Web Lock.
10. Read back every new or deduplicated blob and require exact bytes, hash,
    schema, semantic ID, digest, audience, disclosure, and graph-byte total.
11. Reconstruct the exact package from the stored package blob and compare it
    byte for byte with the pre-write verified package.
12. Resolve every index edge from storage and repeat M1C, evidence-policy,
    authenticated-reviewer, signature, closure, admission policy, station, and runtime-compatibility verification; rebuild
    the index from the exact readback observations and require byte equality
    with the pre-write candidate.
13. Freeze the complete proposed head and `updatedAt`, write/read its exact
    bytes at the chosen fixed proposal path, then write/read the absent-only
    durable intent at that slot. The intent copies both caller head expectations,
    the proposal SHA/length, current admission-policy generation/SHA, and all
    five current trust-policy fields.
14. CAS the chosen fixed slot from its exact missing/clean-vacant expectation to
    the pending variant, carrying the exact prior terminal generation/SHA, and
    read it back. On receipt/readback uncertainty,
    observe that same slot under the original operator: exact pending resumes;
    exact predecessor proves no slot root and triggers exact-SHA intent/proposal
    cleanup; any third/malformed value stays unresolved. Only verified pending
    bytes make the intent and proposed graph a discoverable durable GC root.
15. Release the maintenance fence, then acquire the
    `RealmAdmissionSelectionCoordinator` fence. Never hold maintenance while
    waiting for selection.
16. Under the selection fence, first re-read and require the exact pending slot,
    exact intent, exact proposal, absent terminal result, and absent dispatch
    path. Then re-read the exact M1/M2 heads, admission policy including generation/SHA, the same
    immutable registered runtime profile, and the exact Realm trust-policy
    generation/digest/SHA. If the slot changed or a result/dispatch appeared,
    this writer performs no dispatch and follows that durable state. If an
    authority changed, write/read the precedence-selected
    `no-effect`/`not-selected` result with no dispatch SHA while still holding
    selection, then release it and archive/vacate under maintenance.
17. If every authority and the pending claim remain current, write and read back
    the absent-only dispatch marker while retaining selection, perform the
    generation assertion, and immediately call `writeControlAtomic()` for the
    M2 head with the frozen previous-byte SHA expectation.
18. Validate the atomic receipt and re-read the complete M2 head while still
    holding selection. An incomplete, wrong-scope, or semantically overstated
    receipt is outcome-unknown, not rejection, because dispatch may already have
    committed. Exact proposal bytes are `committed`; exact predecessor bytes
    require an exact no-effect witness to be `no-effect`; any third valid head is
    `conflict`; malformed or non-authoritative reads remain unresolved.
19. For `committed`, recursively verify the selected graph while it is protected
    by both the current head and pending root. A verification or current-policy,
    trust, M1, or runtime-profile failure does not rewrite storage outcome; it
    records `eligibilityOutcome: ineligible`. Only a complete successful
    verification records `eligible`. Noncommitted outcomes are `not-selected`.
20. Write and read back the exact terminal result while still holding selection,
    then release selection. Acquire maintenance, require the same pending,
    intent, proposal, result, and prior terminal-audit bindings; write/read the
    next fixed terminal audit. For a committed result, register and read back the
    Realm's admission-head row in the root directory before the pending claim
    may vacate; the still-pending proposal is the crash-safe root until that
    registration completes. CAS pending to vacant with the new audit generation
    and SHA, then read it back. Release maintenance in `finally`. Detailed
    controls are reclaimed through the fixed
    vacant/reclaiming/clean-vacant protocol before slot reuse.
21. Return an activation receipt only for `committed` plus `eligible`. A durable
    committed-but-ineligible selection returns its exact unavailable reason and
    is never relabeled no-effect or silently rolled back.

A failure before dispatch-marker readback leaves the prior head. If no pending
slot exists, already written immutable objects are collectible unselected
orphans. If a pending slot exists, recovery either records pre-dispatch no effect
or follows its direct records. Any exception after head mutation dispatch uses
the outcome-unknown protocol below and never blindly repeats a CAS. This includes
a post-await operator-generation assertion failure even when the thrown error
does not carry an `outcomeUnknown` flag. After dispatch, the head may be exactly
the predecessor or the proposal; tests and receipts must not promise the prior
head until reconciliation proves it.

Every fence handle releases in `finally`. The pending slot, not a bare intent,
is the durable discovery root. A terminal result and its fixed audit are written
and read back before the slot is vacated. If auditing, vacating, or reclaiming is
outcome-unknown, a later fixed-slot scan observes exact bytes and completes the
same transition without changing the classified head.

## Outcome-unknown recovery

When the storage backend reports `StorageAtomicOutcomeUnknownError`, aborts
after dispatch, returns an outcome-unknown receipt, or any dispatched head
mutation fails without an exact `noEffectProven: true` witness:

1. read exactly the fixed pending and terminal slots; for each pending slot,
   retain its same `admissionOperationId` and verify the directly addressed
   intent and proposed-head bytes plus the complete cross-record matrix;
2. if an exactly valid terminal result or matching terminal audit exists,
   verify/archive it, then vacate the slot under maintenance without performing
   any head mutation; if present bytes are malformed or hash-mismatched, remain
   unresolved;
3. never inspect an old partition through a new operator generation; rebind the
   same operator only if that operator becomes current again;
4. to classify an authoritatively absent dispatch, first acquire the selection
   fence and re-read the exact pending slot plus absent result and dispatch under
   that fence. If the original writer won first, recovery follows its marker or
   result. If recovery won, it writes/reads the sole
   `dispatch-no-effect`/`not-selected` result while holding selection; the live
   writer later sees that result/slot state and cannot dispatch. Malformed or
   hash-mismatched bytes remain `corrupt-control-record` and never authorize CAS;
5. if the dispatch marker exists, retain/acquire the selection fence, then
   re-read and require the exact pending slot, intent, proposal, and dispatch
   plus an absent terminal result; observe the retry path as either exact or
   authoritatively absent and enforce the full equality matrix before any
   authority observation or retry. Then re-read the M2 head, M1
   scope/root/generation/storage SHA, admission policy generation/digest/SHA,
   the same immutable registered runtime profile, and exact Realm trust-policy
   generation/digest/SHA while holding it;
6. if the M2 head bytes equal the complete frozen proposal, classify storage as
   `committed` before recursively evaluating eligibility; graph/current-authority
   failure yields committed plus ineligible, never no-effect or unresolved;
7. if the M2 head equals the exact predecessor and any frozen prerequisite has
   changed, classify `no-effect`/`not-selected` without a retry;
8. if the exact predecessor and every prerequisite remain current and the retry
   path is authoritatively absent, write/read the retry marker under selection and immediately
   perform the single frozen CAS retry using identical proposal bytes,
   `updatedAt`, immutable IDs, operation ID, and expectation; re-read and
   classify the head under the same fence;
9. if an exactly valid retry marker already exists while the authoritative head
   remains the predecessor, classify `no-effect`; if retry bytes exist but are
   malformed or hash-mismatched, remain unresolved; never create another retry
   opportunity;
10. if the head is any third complete valid value, classify `conflict` and
    `not-selected`; if it is malformed or non-authoritative, keep the slot and
    intent unresolved and expose no success claim;
11. write/read the precedence-selected terminal result while holding selection,
    release selection, then acquire maintenance to write/read the fixed terminal
    audit and vacate the exact slot. A later reclaiming cleanup failure never
    changes the recorded storage or eligibility outcome.

The service never guesses whether a write committed, never scans unbounded
history, never advances a compensating head, and never conflates committed
storage with activation eligibility.

## Restart load

The app-side load request enters the trusted service with operator, Realm, both
complete expected publication/admission head bindings, the immutable registered
runtime profile, byte ceiling, and abort signal. The
service:

1. reads and validates the current admission head;
2. requires its complete sanitized publication/admission bindings to equal the
   caller's `expectedPublicationHeadBinding` and
   `expectedAdmissionHeadBinding`; digest-only matching is forbidden;
3. reads the exact index blob and recomputes `admissionIndexDigest`;
4. re-observes the current versioned M1 private head and requires its scope,
   root, generation, and exact storage SHA to equal the index; a changed M1 head
   returns `stale-publication` and the runtime does not fall back to the older
   admitted graph;
5. reads the current exact admission policy and requires its revision and
   digest to equal the index, retaining its generation/storage SHA for the final
   fence assertion;
6. applies admission hard ceilings before resolving any inventory root;
7. resolves inventory roots and chunks sequentially, then the package and every
   member/resource/evidence/signature blob under exact count and byte ceilings;
8. requires canonical byte equality and exact index projection;
9. reconstructs the 17-key package;
10. reads the exact current Realm trust policy and repeats M1C, evidence,
    signature, local-only, and runtime compatibility verification using that
    policy's generation/digest/storage SHA and active role/key bindings;
11. acquires the selection fence, rechecks both complete head bindings, current
    admission policy generation/digest/storage SHA, the same immutable
    registered runtime profile, and Realm trust-policy
    generation/digest/storage SHA, then returns
    only the exact verified package, index, sanitized summary, and head bindings.
    The bindings are the exact safe projections declared by M2A, never either
    raw storage-head codec.

The load result is a verified staging snapshot, not permanent activation
authority. It can become stale when admission policy or Realm trust changes
without either M1/M2 head changing. M2C therefore cannot treat head/profile
equality alone as final authority.

### Reserved M2C final activation guard

This section is the normative continuation for M2C. None of the activation,
candidate materialization, pointer swap, runtime-pin, checkpoint, handoff, ECS,
GPU, audio, input, or visible-runtime behavior below is part of the accepted
M2B admission-only slice.

The flat trusted `RealmRuntimeActivationService`, never the app, receives
`RealmPrivateBakeActivationGuardPort@1`:

```javascript
prepareActivationEligibility({
    operatorPartitionId,
    realmId,
    processOwnerId,
    lifecycleGeneration,
    activationPreparationId,
    expectedPublicationHeadBinding,
    expectedAdmissionHeadBinding,
    runtimeCapabilityProfile,
    candidateAdmissionIndexDigest,
    signal,
})
// -> opaque internal RealmPreparedActivationEligibilityV1

assertActivationEligible({
    selectionFence,
    preparedEligibility,
    cseAssertionProjection,
    signal,
})
// -> {
//      admissionIndexDigest,
//      publicationHeadBinding,
//      admissionHeadBinding,
//      runtimeCapabilityProfileId,
//      runtimeCapabilityProfileDigest,
//      activeBakeCsePredecessorDigest,
//      preparedCseCommitDigest,
//      expectedPreparedCseSwapReceiptDigest,
//      activeBakeOutputRecordDigest,
//      activationObservedAt,
//      minimumEnvelopeExpiresAt,
//      trustedClockObservationDigest,
//      assertionDigest
//    }

assertImmediateVisibilityEligible({
    selectionFence,
    preparedEligibility,
    visibleCommittedManagerRecordStorageSha256,
    assertionSlot,
})
// -> eligible | denied
```

`cseAssertionProjection` is one exact internal frozen
`RealmActivationCseAssertionProjectionV1` built only by the activation service
after offer transfer and while it holds the selection fence. It has exactly
`format`, `version`, `operatorPartitionId`, `realmId`, `processOwnerId`,
`lifecycleGeneration`, `activationPreparationId`,
`candidateAdmissionIndexDigest`, `candidateRuntimeBundleId`,
`predecessorKind = genesis | active`,
`observedPredecessorVisiblePointerGeneration`, optional
`observedPredecessorRuntimeBundleId`, optional
`observedPredecessorLiveVisibilityReceiptDigest`,
`activeBakeCsePredecessorDigest`, `preparedCseCommitDigest`,
`expectedPreparedCseSwapReceiptDigest`, `activeBakeOutputRecordDigest`, and
`projectionDigest`. Its format/domain is
`particle-realms.realm-activation-cse-assertion-projection`, version `1`, and
only `projectionDigest` is excluded.

The service derives the four CSE digests from its transferred offered-candidate
slot, the full safe prepared-commit receipt retained in that slot, and the exact
service-owned visible-pointer/live-visibility record read under selection. It
recomputes the prepared-commit receipt self-digest, constructs and recomputes the
expected swap-receipt preimage from the frozen receipt/pointer fields, requires
the output-record digest to equal the prepared receipt, and requires the
predecessor digest to equal both that receipt and the current pointer/genesis
binding. After accepted offer, the activation service has exclusive custody of
the opaque prepared handle; the shared CSE runtime and that handle continue to
own the hidden staged output record until exact step-8 consumption or terminal
discard. The guard does not claim to rehash that hidden record before step 8. The
genesis variant requires pointer generation `0` and forbids both optional
predecessor fields; the active variant requires both fields and exact agreement
with the current pointer, live receipt, candidate receipt predecessor, and shared
CSE chain. The guard exact-validates the trusted service projection, recomputes
only its `projectionDigest`, requires all identity/head/profile/preparation
bindings to equal `preparedEligibility`, and then binds the four carried CSE
digests into its assertion. Later exact step-8 swap-receipt validation proves the
opaque handle's hidden staged record. The app cannot construct,
replace, retain, or receive this projection, and the projection contains no live
prepared handle or CSE mutation capability.

The third guard method is synchronous and delegates only to its private
`RealmTrustedActivationClockPort@1` face. The activation service never receives
that clock capability directly. It passes the same retained selection fence,
the exact single-use prepared proof, the just-read-back physical manager SHA,
and the preallocated slot; a wrong fence, proof, SHA, or slot denies without a
clock observation.

The service also owns one private synchronous operation over its already bound
process-local state:

```javascript
assertImmediateActivationLive({
    activationPreparationId,
    visibleCommittedManagerRecordStorageSha256,
    decisionSlot,
})
// -> eligible | denied
```

`decisionSlot` is preallocated at offer time. The operation performs no I/O,
allocation, callback, promise, event dispatch, or task/microtask yield. It reads
the retained work-root signal through `activationWorkStatusPort@1`, exact
activation entry, current operator generation through
`operatorGenerationObservationPort@1`, lifecycle retirement through
`lifecycleRetirementObservationPort@1`, and ownership through
`processOwnerChildPort@1` rather than accepting any of them from the app. Each
observation face has only `readBoundStatus()` over service-retained identity and
returns a frozen closed observation; none can allocate, retire, switch, or
release. `activationWorkStatusPort@1`,
`operatorGenerationObservationPort@1` return only their frozen enum.
`processOwnerChildPort@1.readBoundStatus()` is prebound by the service to the
candidate teardown child and the selected optional predecessor teardown child;
it returns exactly `{ ownerState, candidateChildTuple,
predecessorChildTuple }`. `ownerState` is `owned | released`,
`candidateChildTuple` is `staged-candidate-owned | mismatched | unavailable`,
and `predecessorChildTuple` is `genesis-absent | current-active-owned |
mismatched | unavailable`. The `current-active-owned` read may cross a process
owner only through the exact live cross-session displacement claim while the
activation-selection fence is held; it is not a foreign-child query or listing
surface. `lifecycleRetirementObservationPort@1.readBoundStatus()`
returns exactly `{ status: 'current' }`, `{ status: 'retired',
lifecycleRetirementReceiptDigest }`, or `{ status: 'unavailable' }`. The digest
is the exact receipt produced by the bound lifecycle authority and is available
only for that retired generation; it grants no mutation or lookup authority.
The liveness decision projects only its enum state, while active-bundle
`close()` binds the retired variant's authoritative digest. The filled
`RealmImmediateActivationLivenessDecisionV1` has exactly `format`, `version`,
`operatorPartitionId`, `realmId`, `processOwnerId`, `lifecycleGeneration`,
`operatorGeneration`, `activationPreparationId`,
`visibleCommittedManagerRecordStorageSha256`, `activationState`,
`workRootState`, `operatorState`, `lifecycleState`, `processOwnerState`,
`candidateTeardownChildId`, `candidateChildTuple`, `predecessorKind = genesis |
active`, optional `predecessorProcessOwnerId`, optional
`predecessorLifecycleGeneration`, optional `predecessorTeardownChildId`,
`predecessorChildTuple`, `disposition`, optional `denialReason`, and
`decisionDigest`. Its format/domain
is `particle-realms.realm-immediate-activation-liveness-decision`, version `1`,
and only `decisionDigest` is excluded. Eligible requires exactly `committing`,
`live`, `current`, `current`, and `owned` in the first five displayed state
fields, requires `staged-candidate-owned`, and requires `genesis-absent` for a
genesis predecessor or `current-active-owned` plus all three predecessor fields
for an active predecessor. Genesis forbids those optional predecessor fields.
Eligible forbids `denialReason`. Denied requires at least one noneligible state and one
reason chosen by exact precedence: `work-aborted`, `activation-state-changed`,
`operator-generation-changed`, `lifecycle-observation-unavailable`,
`lifecycle-retired`, then
`process-owner-released`, `candidate-child-state-changed`, then
`predecessor-child-state-changed`. No signal, authority handle, or callable is
serialized.

`processOwnerState` is the exact `ownerState` returned by the bound child port;
it is not a second observation. Candidate and predecessor IDs/tuples are derived
from service-retained activation slots and the optional live displacement claim,
never from app arguments. The port's tuple observation and every later
activation-child transfer/unregister share the same selection fence defined by
`processOwnerPort@1`.

The guard alone receives `RealmTrustedActivationClockPort@1`:

```javascript
observeActivationTime({
    realmId,
    activationPreparationId,
    phase,
    minimumObservationSequence = null,
    signal,
})
// -> RealmTrustedActivationTimeObservationV1

assertImmediateVisibilityTime({
    realmId,
    activationPreparationId,
    basisObservationDigest,
    visibleCommittedManagerRecordStorageSha256,
    minimumEnvelopeExpiresAt,
    assertionSlot,
})
// -> eligible | denied
```

`phase` is exactly `prepare` or `commit`.
`RealmTrustedActivationTimeObservationV1` has exactly `format`, `version`,
`operatorPartitionId`, `realmId`, `activationPreparationId`, `phase`,
`observationSequence`, `effectiveUtcTimestamp`,
`previousObservationDigest?`, and `observationDigest`. Its format/domain is
`particle-realms.realm-trusted-activation-time-observation`, version `1`, and
only `observationDigest` is excluded from `computeRealmContentId()`.
`observationSequence` is positive uint64 decimal text. The service persists one
operator/service high-water record before returning: sequence strictly
increases and `effectiveUtcTimestamp` is the later of the trusted OS UTC sample
and prior effective time, so it never decreases across process or browser
restart. `previousObservationDigest` is absent only at sequence one and
otherwise binds the exact prior high-water observation. Commit requires a
sequence greater than preparation and an effective time not earlier than the
prepared observation. Clock read/persistence uncertainty, rollback, malformed
lineage, or exhaustion fails closed; the app's monotonic frame clock is never a
substitute.

`assertImmediateVisibilityTime()` is a synchronous, nonthrowing, allocation-free
kernel operation. `assertionSlot` is an opaque fixed-shape process-local slot
preallocated by the activation service at offer time; it is never accepted from
or returned to the app. The operation performs no storage access, promise,
callback, event dispatch, task yield, or microtask scheduling. It requires the
named preparation and basis digest to equal the last persisted commit-phase
observation, requires the manager SHA to equal the exact just-read-back
`visible-committed` proposal, samples trusted OS UTC once, denies any sample
earlier than the persisted effective high-water time, and requires the sample to
be strictly before `minimumEnvelopeExpiresAt`. Because the persisted commit
observation was already inside every `[issuedAt, expiresAt)` interval and the
final sample cannot move backward, the minimum expiry is the complete remaining
lifetime boundary.

The filled `RealmImmediateVisibilityTimeDecisionV1` has exactly `format`,
`version`, `operatorPartitionId`, `realmId`, `activationPreparationId`,
`basisObservationDigest`, `visibleCommittedManagerRecordStorageSha256`,
`minimumEnvelopeExpiresAt`, optional `observedUtcTimestamp`, `disposition`, optional
`denialReason`, and `decisionDigest`. Its format/domain is
`particle-realms.realm-immediate-visibility-time-decision`, version `1`, and
only `decisionDigest` is excluded from `computeRealmContentId()`. `disposition`
is exactly `eligible` or `denied`; `eligible` forbids `denialReason`, while
`denied` requires exactly `clock-rollback`, `clock-unavailable`,
`envelope-expired`, or `binding-mismatch`. The decision is process-local live
safety evidence, not a durable clock head, high-water advance, or authority
record. The persisted commit-phase observation remains the normative durable
authorization instant and lineage point; the final sample only proves that the
already authorized transition is still inside its expiry boundary immediately
before synchronous visibility mutation.
`observedUtcTimestamp` is required for `eligible`, `clock-rollback`, and
`envelope-expired`. It is forbidden for `binding-mismatch`, which is decided
before sampling, and `clock-unavailable`, for which no truthful sample exists.

The clock port is backed only by `RealmTrustedActivationClockStorageAdapter` in
the separately branded `virtual-realm-activation-clock-v1` view. Its one
Realm-addressed head is `RealmTrustedActivationClockHeadStorageV1` with exactly:

```text
format = particle-realms.realm-trusted-activation-clock-head-storage
version = 1
operatorPartitionId
realmId
clockGeneration
effectiveUtcTimestamp
lastObservationDigest
previousHeadStorageSha256?
headDigest
```

`clockGeneration` is positive uint64 decimal text and equals the last committed
observation sequence. `previousHeadStorageSha256` is absent only at generation
one and otherwise equals SHA-256 of the exact predecessor head-file bytes.
`headDigest` uses `computeRealmContentId()` with the displayed format/domain,
major version `1`, and only `headDigest` excluded. Unknown keys, noncanonical
time, a decreasing effective time, sequence discontinuity, wrong partition or
Realm, malformed digest, and any other lineage fail closed. The head uses the
registered `maximumAdmissionControlRecordBytes = 1048576` path-class cap; it is
fixed control metadata, never a content artifact, GC candidate, version,
ordinary backup member, or app-visible record.

For each observation, the adapter reads and exact-SHA binds the current head,
samples the trusted OS UTC source, computes the next observation with sequence
`current.clockGeneration + 1`, and builds one proposed head whose
`lastObservationDigest` is that observation's digest. It then performs one
exact-predecessor `writeControlAtomic()` and exact readback. Outcome uncertainty
may resolve only to the exact predecessor or exact proposal: proposal returns
the already computed observation; predecessor permits a fresh read/sample/new
proposal; a missing head after generation one, a third value, a malformed value,
or an exhausted uint64 leaves clock authority unresolved and denies activation.
The adapter never returns an observation until the corresponding proposed head
is durably read back. This physical SHA lineage, not the semantic previous
observation digest alone, closes overwrite ABA and restart recovery.

The app-facing `runtimeActivationPort@1` bridges to that internal guard without
exporting it. Its preparation call is exactly:

```javascript
prepareCandidateEligibility({
    expectedPublicationHeadBinding,
    expectedAdmissionHeadBinding,
    candidateAdmissionIndexDigest,
    signal,
})
// -> { status: 'prepared', activationPreparationId }
//  | { status: 'denied', reason }
```

This app face is the exact M2A shape. The activation port was already bound to
the lifecycle generation and complete inspected profile ID/digest/object, so the
service supplies those values to its internal guard call; accepting caller
replacements would reopen authority substitution. Denial uses the closed M2A
reason vocabulary and returns no candidate digest or guard field.

The service generates `activationPreparationId` as one primitive ASCII string
matching `^activation-preparation:v1:[0-9a-f]{64}$` and capped at 96 UTF-8 bytes;
the suffix is issued only by internal
`secureRandomPort@1.issueHex256({ purpose: 'activation-preparation' })`. That
flat kernel adapter wraps the injected host CSPRNG, fails closed when secure
randomness is unavailable, and has no ambient-global fallback. It resolves the full
registered profile internally and retains exactly one process-local candidate
proof per process owner/lifecycle generation. The identifier is only a lookup
correlation accepted by `offerCandidate()`, `commitCandidate()`, and
`abortCandidate()` on that same bound port; it is not a capability or content
ID, is never reused, is not serializable into handoff, and reveals no policy,
evidence, key, clock, fence, or proof field.

The service has exactly two selectable/mutable roles per bound process owner/
lifecycle: zero or one current-active entry and at most one candidate entry.
Handoff-displaced-retained and superseded entries are bounded terminal cleanup
ownership, not additional selectable roles. The candidate edges are
exactly `prepared -> offered -> committing -> committed`, `prepared -> aborted`,
`offered -> aborted`, service-reconciled `committing -> aborted`, and hostile
`committing -> integrity-quarantined`. A committed
candidate atomically becomes the new current-active entry. The active edges are
public-retirement `committed -> closed` or internal replacement
`committed -> superseded -> disposed` for one owner/lifecycle, plus verified
cross-session `committed -> handoff-displaced-retained -> closed -> disposed`.
Superseded entries live only in that same owner's bounded disposal ledger. A
handoff-displaced entry remains under its predecessor owner until that owner's
lifecycle retirement and can never enter the replacement owner's ledger. Neither
can become current or candidate again. An owner's candidate, current-active,
handoff-displaced, and not-yet-disposed superseded entries total
at most `maximumAdmissionRootManagerJournalSlots = 64`, each bound to one exact
pin-manager slot. An offer that would require entry 65 returns `pin-unavailable`
before root allocation and leaves the current active entry unchanged.
An
interrupted `committing` state is reconciled rather than caller-aborted. Offer
binds one non-serializable candidate handle, the Engine's exact opaque
`CausalStatePreparedCommitV2` handle plus the app-supplied exact frozen safe
prepared-commit receipt/digest and separate expected swap-receipt digest,
and exact owner, lifecycle generation, and admission-index digest, preallocates the immediate-liveness,
immediate-time, live-visibility, and exactly one applicable old-bundle
same-owner-supersession or cross-session-displacement slot, then preallocates
and registers the candidate's single-bundle teardown handle as a staged
process-owner child. Only `offered` may begin
commit, and every terminal or wrong-state replay fails closed. New preparation
is legal while one current-active entry exists: abort leaves that entry
byte-identical, and successful no-await commit atomically moves the old active
entry either `committed -> superseded` for exact same-owner/lifecycle
replacement or `committed -> handoff-displaced-retained` under an exact
cross-session handoff claim, while moving the candidate `committing ->
committed`. A second preparation aborts a prior `prepared`
candidate but is rejected while the candidate is `offered` or `committing`; it
never replaces live candidate ownership. Restart,
operator switch, lifecycle retirement, preparation failure, or
`abortCandidate()` destroys any noncommitting proof and leaves no resumable
token. An interrupted `committing` entry is reconciled by the activation
manager's runtime-pin manager CAS chain plus the process-local pointer/barrier
observation before another preparation; no separate visible-pointer journal
exists.

The offer's `preparedCseCommitReceipt` is the exact Engine
`CausalStatePreparedCommitReceiptV2` returned beside the handle. Before taking
ownership, the service recomputes its self digest and requires equality with
`preparedCseCommitDigest`, the handle's synchronous identity projection, the
separately supplied `preparedCseSwapReceiptDigest`, and
`activeBakeOutputRecordDigest`. It also requires the canonical empty-outbox
digest and complete staged-root/signature fields. The app-facing adapter names
are projections only: `preparedCseCommitDigest` equals Engine
`preparedCommitDigest`, and `preparedCseSwapReceiptDigest` equals Engine
`preparedSwapReceiptDigest` byte for byte.

Preparation repeats bounded index/package/evidence-policy/reviewer/signature
closure and runtime-profile verification and freezes the exact M1/M2 head,
admission-policy revision/digest/generation/storage SHA, immutable evidence
policy ID/digest, five-role trust-policy revision/digest/generation/storage SHA,
verified graph projection, every verified envelope `issuedAt`/`expiresAt`, the
minimum envelope expiry, and the trusted service-clock observation used for
preparation. The proof is process-local, deeply frozen, single-use, bound to the
preparation, candidate admission index, and operator generation, and never
returned through an app port or handoff record. It intentionally contains no
later CSE materialization field; those fields enter the guard only through the
service-owned `RealmActivationCseAssertionProjectionV1` at commit.

Before `runtimeActivationPort.commitCandidate()`, the activation service
one-time binds the staged teardown handle to the exact active runtime-pin manager
operation/root; an absent, repeated, or different binding fails closed.
`commitCandidate()` then closes one generation-bound
frame barrier while the candidate State-First source, controller, and input face
remain off-active. It then acquires `RealmAdmissionSelectionCoordinator`, reads
the exact service-owned visible predecessor, builds the closed
`RealmActivationCseAssertionProjectionV1` from that observation plus the
transferred offered slot, and passes the branded fence, prepared eligibility,
and projection to `assertActivationEligible()`. While retaining the same fence,
the guard re-reads and requires every frozen
head/policy/trust/profile/graph binding. Every writer of the CSE V2 active-bake
entity must acquire this same selection coordinator; while holding it the
activation service requires the exact active-bake predecessor projection
to match the old active bundle/pointer and the prepared CSE receipt, and captures
its canonical record digest. It revalidates that steps 1 through 7 completed,
the staged post-root/receipt/signatures are frozen, and only allocation-free
nonthrowing step 8 remains. It also requires zero external-effect intents and
the exact canonical empty-outbox digest, making CSE step 9 a proven no-op. A
stale predecessor, wrong prepared digest, or
nonready handle aborts before durable pin authorization. A writer that
cannot join this fence fails the M2 gate. The trusted service clock's exact
`activationObservedAt` must remain within every frozen envelope's
`[issuedAt, expiresAt)` interval and strictly before
`minimumEnvelopeExpiresAt`.

After assertion, the service classifies the visible predecessor. First
activation needs no old-owner receipt; same-owner/lifecycle replacement selects
the preallocated supersession slot; a different owner/lifecycle must first
obtain the exact service-only cross-session displacement claim described below.
Only then does the service precompute the exact visible-commit receipt and
manager proposal and initialize the already preallocated immediate-liveness,
immediate-time, live-visibility, candidate-abort, and candidate-child-transfer
slots. A replacement additionally initializes exactly one old-child-transfer
slot plus exactly one old-bundle supersession or displacement slot while the old
pointer remains current and every candidate gate remains closed. Genesis
forbids an old-child-transfer, supersession, or displacement slot. The
independently supplied
`expectedPreparedCseSwapReceiptDigest` names the exact preallocated CSE
swap receipt without entering `preparedCseCommitDigest`; this one-way binding
has no digest cycle. It CAS/readbacks the runtime-pin
manager from `candidate-published` to `visible-committed` as the sole durable
authorization for the named no-await commit block. Exact predecessor performs no
CSE or pointer mutation, cancels an applicable cross-session claim through its
exact settlement handle, and retires the candidate. Exact proposal enters one
synchronous, allocation-free, nonthrowing block whose first phase calls
`assertImmediateActivationLive()` and then
`activationGuardPort.assertImmediateVisibilityEligible()` against that exact
proposal's physical SHA before any mutation. The liveness call exact-validates
the candidate `(activation-staged, candidate-owned)` tuple and either genesis
absence or the selected predecessor `(activation-current, active-owned)` tuple.
Every activation-child ledger mutation requires the still-held
activation-selection fence, so no tuple mutation can intervene before the
corresponding compare-and-transfer later in this same non-preemptible block.
Either denial
performs zero CSE, pointer, ownership, source, controller, input, or frame
mutation, keeps every candidate gate closed, and schedules retirement of the
authorized candidate pin plus cancellation of any applicable cross-session
claim after the block.

An eligible immediate-time decision is the final synchronous expiry/rollback
safety predicate; the persisted commit observation remains the normative durable
authorization instant. In the same non-preemptible JavaScript task, with no
await, callback, event dispatch, promise continuation, or microtask boundary,
the block closes and reads back the old bundle's input/interaction/State-First/
controller/frame gates when a bundle is being replaced, performs the CSE active-bake
transition against the already reasserted predecessor by invoking only
`activeBakeCsePort.commitPreparedSwap(preparedCommitHandle)` for its step-8
bundle swap, and requires the returned preallocated
`CausalStatePreparedSwapReceiptV2` reference to reproduce the authorized
prepared-commit, predecessor, previous/visible pointer-generation, staged-root,
commit-receipt, active-bake output-record, and
`expectedPreparedCseSwapReceiptDigest` fields. It then fills
the live receipt's actual `preparedCseSwapReceiptDigest` with that exact returned
digest and fills the
preallocated live-visibility and optional supersession receipts before it swaps
the internal pointer,
transfers staged-resource ownership, and opens the candidate source/controller/
input plus frame barrier. That same ownership transfer moves the already
registered new teardown handle from `(activation-staged, candidate-owned)` to
`(activation-current, active-owned)` through its prebound transfer-receipt slot.
The immediately preceding tuple proof plus exclusive fence makes a no-effect
expected-tuple result impossible for a conforming process-owner port. Same-owner
replacement atomically moves the old handle from `(activation-current,
active-owned)` to `(activation-superseded, disposal-owned)` through its own
prebound slot and transfers its child/resources/pin to that owner's disposal
ledger. Claimed cross-session displacement instead atomically moves the old
handle to `(activation-handoff-displaced, predecessor-retained-owned)` through
its predecessor-owner-bound slot, fills and
readbacks the exact displacement receipt, marks the old slot
`handoff-displaced-retained`, and leaves its child/resources/pin exclusively
under the predecessor owner. A
post-step-8 receipt mismatch is a certified CSE-integrity recovery state: old
and candidate gates remain closed, the runtime pointer and ownership stay
unchanged, no live/supersession receipt is published, and no success is
returned. The prevalidated trusted port makes this branch hostile-fault
evidence, not a normal conflict or rollback path. The service fills exact
internal `RealmRuntimeCseIntegrityQuarantineReceiptV1` with `format`, `version`,
`operatorPartitionId`, `realmId`, `processOwnerId`, `lifecycleGeneration`,
`activationPreparationId`, optional `currentRuntimeBundleId`,
`candidateRuntimeBundleId`, `preparedCseCommitDigest`,
`expectedPreparedCseSwapReceiptDigest`, `observedSwapReceiptDisposition =
digest-mismatch | shape-mismatch`, optional
`observedPreparedCseSwapReceiptDigest`, `activeBakeOutputRecordDigest`,
`previousBundleGateDisposition = absent | closed`,
`candidateGatesClosed = true`,
`runtimePointerMutationPerformed = false`, `ownershipMutationPerformed = false`,
`quarantineSequence`, and `receiptDigest`. Its format/domain is
`particle-realms.realm-runtime-cse-integrity-quarantine-receipt`, version `1`,
and only `receiptDigest` is excluded. It contains no returned raw receipt,
handle, path, root, or manager capability.
`digest-mismatch` requires the bounded observed digest; `shape-mismatch` forbids
it. `currentRuntimeBundleId` is absent if and only if
`previousBundleGateDisposition = absent`; replacement requires the ID and
`closed`. The positive
uint64 decimal-text `quarantineSequence` comes from the activation service's
process-local monotonic receipt counter and is not time.

The entry becomes `integrity-quarantined`; the service disables this Realm's
process-local presentation and returns only `recovery-pending` with reason
`cse-integrity-quarantined` from both `commitCandidate()` and
`readActiveBundle()`. It never reopens the old gates or calls the
transition an abort. Restart recovery re-verifies the authoritative CSE
active-bake record, durable pin authorization, and admitted graph before it can
construct any new pointer; inability to reconcile leaves the Realm disabled for
operator recovery. A
third value, malformed
readback, or uncertain observation performs none of those actions, keeps every
external gate closed, and enters manager recovery; it never reports success or
exposes the candidate. Only after exact proposal readback and the no-await block
may the service release selection and return. A changed policy, revoked
key, changed role publisher, changed reviewer policy, expired or not-yet-valid
envelope, stale head, or profile mismatch aborts before the pointer swap. A crash
after durable `visible-committed` readback but before the no-await block leaves no
live process visibility; recovery retires the dead owner's active pin. The state
records durable commit authorization, not proof that a frame reached a display.
No separate
durable visible-pointer journal exists.

Every abort, exact predecessor, recovered unresolved terminalization, or
candidate-disposal path closes and unregisters the staged teardown handle before
returning and idempotently discards any unspent prepared-CSE handle/staging owner.
No allocation or child registration occurs after durable
authorization readback or after the visible transition.

The staged child closes through exact internal
`RealmRuntimeStagedCandidateCloseReceiptV1` with `format`, `version`,
`operatorPartitionId`, `realmId`, `processOwnerId`, `lifecycleGeneration`,
`activationPreparationId`, `runtimeBundleId`, `stagedTeardownChildId`,
`stagedOwnershipState = staged`, `activePointerMutationPerformed = false`,
`allCandidateGatesClosed = true`, `closed = true`, `closeSequence`, and
`receiptDigest`. Its format/domain is
`particle-realms.realm-runtime-staged-candidate-close-receipt`, version `1`, and
only `receiptDigest` is excluded. `closeSequence` comes from the same bounded
process-local monotonic receipt counter as other activation teardown receipts.
The matching process-owner unregistration receipt must name this digest as its
terminal evidence; neither receipt contains a handle, callback, root, path, or
manager authority.

Every app-facing `abortReceiptDigest` is the self digest of one exact frozen
`RealmRuntimeCandidateAbortReceiptV1`. It has exactly `format`, `version`,
`operatorPartitionId`, `realmId`, `processOwnerId`, `lifecycleGeneration`,
`activationPreparationId`, `activationStateAtAbort`, `abortOrigin`,
`ownershipDisposition`, optional `runtimeBundleId`,
optional `preparedCseCommitDigest`, optional
`preparedCseDiscardReceiptDigest`, optional `stagedTeardownChildId`, optional
`stagedTeardownCloseReceiptDigest`, optional
`stagedTeardownUnregistrationReceiptDigest`, optional
`candidatePinRetirementReceiptDigest`, `terminalState = aborted`,
`abortReason`, `abortSequence`, and `receiptDigest`. Its format/domain is
`particle-realms.realm-runtime-candidate-abort-receipt`, version `1`, and only
`receiptDigest` is excluded from `computeRealmContentId()`.

`activationStateAtAbort` is exactly `prepared`, `offered`, or `committing`;
`abortOrigin` is exactly `offer-denied`, `abort-candidate`, or
`manager-recovery`; and `ownershipDisposition` is exactly
`no-service-candidate` or `service-disposed`.
`no-service-candidate` forbids every optional field and requires that no staged
child was registered. `service-disposed` requires the
runtime-bundle, prepared-commit, prepared-discard, child, child-close, and child-
unregistration fields; it requires `candidatePinRetirementReceiptDigest` if and
only if a candidate pin was published. The disposition is selected from the
furthest ownership edge the service completed, not from caller input. A
pre-transfer offer denial returns no abort digest because the service owns no
candidate; the app must run its already registered reverse-disposal entry. The
prepared-discard digest must name the exact Engine
`CausalStatePreparedDiscardReceiptV2`; child close and unregister digests must
prove the same staged child reached terminal ownership; and a receipt that
contains pin-retirement evidence is returned only after exact candidate-pin
retirement, root release, manager-slot cleanup, and child unregistration are all
read back. `abortOrigin = offer-denied` requires `abortReason = pin-unavailable`;
`abortOrigin = abort-candidate` requires one exact M2A `abortCandidate()` reason.
`abortOrigin = manager-recovery` requires `activationStateAtAbort = committing`,
`ownershipDisposition = service-disposed`, `abortReason = activation-recovery`,
a published candidate-pin retirement
receipt, and proof that reconciliation observed no successful CSE step 8 or live
pointer. It is the only truthful `committing -> aborted` receipt. A
`cse-integrity-quarantined` entry cannot use this receipt, because CSE step 8 did
occur; it remains recovery-pending until the authoritative active-bake record is
reconciled and is never relabeled as an ordinary abort.
`abortSequence` is a positive uint64 decimal-text
value from the activation service's process-local monotonic receipt counter; it
is not wall time or durable authority. The receipt contains no
root reference, manager operation, storage SHA, live handle, path, or private
payload. Repeating an abort returns the original digest through the
`already-terminal` result and performs no second discard, close, unregister, or
pin retirement.

Every asynchronous candidate-abort cleanup receives only the activation port's
prebound live teardown signal. It reasserts the exact owner/operator/lifecycle
identity around each await but deliberately accepts the bound generation as
retiring or retired. Work-root abort therefore cannot strand cleanup, and the
teardown path cannot create, authorize, commit, or expose a candidate.

The candidate terminal cell is bounded to one entry and is retained only until
the next preparation is accepted after cleanup. Superseded/closed/disposed
evidence remains only in its current-active or bounded disposal slot. Once a
terminal cell is evicted, the old preparation ID returns `not-found` with no
allocation or receipt; arbitrary IDs never create terminal state.

`RealmRuntimeVisibleCommitReceiptV1` has exactly `format`, `version`,
`operatorPartitionId`, `realmId`, `managerOperationId`, `rootReferenceId`,
`processOwnerId`, `lifecycleGeneration`, `activationPreparationId`,
`activationAssertionDigest`, `activeBakeCsePredecessorDigest`,
`preparedCseCommitDigest`, `expectedPreparedCseSwapReceiptDigest`,
`activeBakeOutputRecordDigest`,
`commitDisposition = authorized`, `predecessorOwnershipDisposition = none |
same-owner-replacement | cross-session-retained`, optional
`crossSessionActivationClaimReceiptDigest`, optional `previousRuntimeBundleId`,
`runtimeBundleId`, `previousPointerGeneration`, `visiblePointerGeneration`,
`frameBarrierGeneration`, `stateFirstSourceId`, `firstPersonControllerId`,
`commitObservedAt`, and `receiptDigest`. Its format/domain is
`particle-realms.realm-runtime-visible-commit-receipt`, version `1`, and only
`receiptDigest` is excluded from `computeRealmContentId()`.
`previousPointerGeneration` is non-negative uint64 decimal text and
`visiblePointerGeneration` is positive uint64 decimal text equal to it plus one;
`frameBarrierGeneration` is positive and bound to that one closed barrier;
`commitObservedAt` equals the persisted commit-phase activation assertion's
trusted time; it is durable authorization time, not a claim that visibility
opened at that instant. IDs are
nonempty control-free UTF-8 of at most 256 bytes except the already frozen
96-byte activation-preparation ID; the timestamp is canonical UTC RFC 3339 with
exactly millisecond precision. Unknown keys fail. No handle or callable value is
serializable. The complete receipt is nested in the `visible-committed` pin
manager record and its `receiptDigest` must equal that record's
`visibleCommitReceiptDigest`; a digest without the exact nested receipt is
invalid. The assertion and receipt expose no policy object, key, evidence bytes,
storage path, clock capability, or fence to the app.

For first activation, `previousRuntimeBundleId` is absent if and only if the
captured active-bake predecessor is the exact Engine
`CausalStateActiveBakeGenesisV2` with entity version/pointer generation `0` and
`state = inactive`. For replacement it is required and must name the exact active
predecessor bundle. There is no missing-predecessor or synthetic version-1 path.
`crossSessionActivationClaimReceiptDigest` is required if and only if
`predecessorOwnershipDisposition = cross-session-retained`; it is forbidden for
the other two dispositions. First activation uses `none`; an exact same-owner/
same-lifecycle replacement uses `same-owner-replacement`.
These two ownership fields belong only to the later service-owned visible-commit
receipt. They are selected after the guard assertion has frozen and, for the
cross-session branch, after the trusted handoff service has issued the claim;
they are neither guard inputs nor fields of
`RealmPrivateBakeActivationAssertionV1`.

Every active predecessor after genesis is exact Engine
`CausalStateActiveBakeRecordV2`: its operator/Realm/entity identity is stable;
entity and pointer generations advance by one; `state = active`; bundle and
admission equal the visible predecessor; `previousActiveBakeRecordDigest`
forms the canonical chain; and its self digest is the current
`activeBakeCsePredecessorDigest`. The candidate's separately frozen
`activeBakeOutputRecordDigest` names the next record and is bound by the
prepared-commit receipt, CSE staged post-root, expected swap receipt, durable
authorization, and live receipt.

All simultaneously live session views for one operator/Realm bind the same
OS-owned active-bake CSE runtime ID/generation. Owner/lifecycle stays in each
session-view binding receipt and prepared handle, but does not create a second
genesis or reset the shared active record. Therefore a verified cross-session
candidate prepares against the exact old active CSE predecessor without
transferring a handle between runtimes. A service-process restart has no live
pointer or prepared handle; the newly created shared runtime starts from genesis
and checkpoint/handoff restoration produces a new live chain.

`activeBakeCsePredecessorDigest` is the canonical digest of the exact current CSE
V2 active-bake record reasserted under selection. Because every active-bake
writer is serialized by that same retained fence, the no-await CSE transition
can invoke only `activeBakeCsePort.commitPreparedSwap(preparedCommitHandle)` with
the exact `CausalStatePreparedCommitV2` direct argument whose safe receipt digest
equals `preparedCseCommitDigest`. That prepared receipt's
separately returned `preparedSwapReceiptDigest` is retained as
`expectedPreparedCseSwapReceiptDigest`; the operation cannot race,
allocate, validate, sign, or return conflict. A hostile or legacy writer that bypasses the
fence invalidates certification; the runtime never attempts to repair a closed
old bundle after an unexpected CSE conflict.

Successful live visibility is bound by exact process-local
`RealmRuntimeLiveVisibilityReceiptV1`. It has exactly `format`, `version`,
`operatorPartitionId`, `realmId`, `processOwnerId`, `lifecycleGeneration`,
`activationPreparationId`, `managerOperationId`, `rootReferenceId`,
`visibleCommittedManagerRecordStorageSha256`, `runtimeBundleId`,
`visiblePointerGeneration`, `preparedCseCommitDigest`,
`preparedCseSwapReceiptDigest`,
`activeBakeOutputRecordDigest`,
`immediateActivationLivenessDecisionDigest`,
`immediateVisibilityTimeDecisionDigest`,
`visibilityDisposition = visible`, and `receiptDigest`. Its format/domain is
`particle-realms.realm-runtime-live-visibility-receipt`, version `1`, and only
`receiptDigest` is excluded. The activation service fills its preallocated slot
only after an eligible immediate-time decision and successful exact CSE swap
receipt readback, but before pointer/ownership/gate-open mutation, and retains
the frozen receipt in
the exact active pointer plus teardown child. It is never persisted, serialized,
handed off, or exposed through the app port. Durable `visible-committed` state is
authorization, not proof of a displayed frame; after process death no live
pointer survives, so recovery retires that authorization without fabricating a
live-visibility receipt.

Successful commit returns the exact M2A closed commit result including one
`realmActiveBundleTeardown@1` handle. The handle's single `close()` method is the
only public `committed -> closed` edge. It is bound internally to the exact
operator partition, process owner, lifecycle generation, bundle/pointer
generation, runtime-pin operation/root,
input/interaction/source/controller/frame gates, and
teardown root, and it retains the matching live-visibility receipt digest. It
first requires the lifecycle authority to observe that bound
generation as retired while the process owner and teardown root still exist; it
never uses `assertGenerationCurrent()` and cannot be called through the aborted
work root.

`close()` synchronously closes the matching input, interaction, State-First,
controller, and frame gates. For a still-current slot it removes and reads back only that exact
active pointer. For `handoff-displaced-retained` it instead proves the pointer
no longer names the old slot and preserves the successor. It reads back the
applicable six conditions before returning
`RealmRuntimeActiveBundleCloseReceiptV1`. The
receipt has exactly `format`, `version`, `operatorPartitionId`, `realmId`,
`processOwnerId`, `lifecycleGeneration`, `managerOperationId`, `rootReferenceId`,
`runtimeBundleId`, `visiblePointerGeneration`, `stateFirstSourceId`,
`firstPersonControllerId`, `frameBarrierGeneration`,
`liveVisibilityReceiptDigest`, `requestedCloseReason`,
`lifecycleRetirementReceiptDigest`, `closeDisposition =
current-pointer-removed | handoff-displaced-pointer-preserved`, optional
`crossSessionDisplacementReceiptDigest`, `inputClosed = true`,
`interactionClosed = true`, `stateFirstClosed = true`,
`controllerClosed = true`, `frameClosed = true`, `closeSequence`, and
`receiptDigest`.
Its format/domain is
`particle-realms.realm-runtime-active-bundle-close-receipt`, version `1`, and
only `receiptDigest` is excluded. `requestedCloseReason` is exactly `application-close`,
`operator-switch`, `device-loss`, `handoff-complete`, or
`activation-recovery`; `closeSequence` is the next positive uint64 decimal-text
value from the activation service's process-local monotonic receipt counter and
is never treated as wall time or durable chronology. Unknown keys and live
values fail. Repeat close returns the same
frozen receipt without another mutation. The receipt authorizes later
runtime-pin retirement only after the post-frame GPU fence and exact child
disposal are separately proven; closing visibility never releases the graph
root itself.

`crossSessionDisplacementReceiptDigest` is required exactly for
`handoff-displaced-pointer-preserved` and forbidden for
`current-pointer-removed`. The former requires exact readback that the old five
gate families are closed and the current pointer names a different owner/bundle;
it cannot remove, close, resolve, or disclose that successor. The old teardown
child, resources, and runtime pin remain in the predecessor owner's ledger until
this close receipt, its own post-frame fence, disposal, and pin retirement are
complete.

`requestedCloseReason` is untrusted caller intent. The separately verified
`lifecycleRetirementReceiptDigest` comes from the lifecycle authority and proves
only that this exact generation is retired; the receipt never claims the
requested reason caused retirement. No ambient clock or caller label becomes
authority.

Before lifecycle retirement, `close()` returns only M2A's frozen
`lifecycle-active` no-effect result. An unavailable or contradictory lifecycle
retirement observation returns only M2A's frozen `recovery-pending` no-effect
result with reason `lifecycle-retirement-unresolved` and mutates no pointer,
gate, handle, child, resource, or pin. After retirement is proven, unavailable,
malformed, or mismatched displacement-receipt/gate/successor-pointer evidence
returns the same no-effect result with reason
`displacement-integrity-unresolved`. A handle terminalized by replacement returns
only `status = superseded` or `status = disposed` plus its own retained
supersession-receipt digest. That stale handle cannot resolve or close the
replacement, and it needs no unbounded service-side terminal lookup.

Ordinary same-generation replacement never calls public `close()` and never
pretends the lifecycle retired. The no-await commit block instead executes the
service-only `bundle-replaced` supersession edge described above. Its preallocated
`RealmRuntimeBundleSupersessionReceiptV1` has exactly `format`, `version`,
`operatorPartitionId`, `realmId`, `processOwnerId`, `lifecycleGeneration`,
`previousRuntimeBundleId`, `previousVisiblePointerGeneration`,
`previousLiveVisibilityReceiptDigest`, `replacementRuntimeBundleId`,
`replacementVisiblePointerGeneration`, `replacementLiveVisibilityReceiptDigest`,
`replacementPreparedCseSwapReceiptDigest`,
`inputClosed = true`,
`interactionClosed = true`, `stateFirstClosed = true`,
`controllerClosed = true`, `frameClosed = true`,
`supersessionReason = bundle-replaced`, and `receiptDigest`. Its format/domain is
`particle-realms.realm-runtime-bundle-supersession-receipt`, version `1`, and
only `receiptDigest` is excluded. The terminal old teardown child and receipt
move to disposal ownership with the old resources and distinct disposal pin.
Only after the post-frame GPU fence and exact old-resource disposal may the
service mark it `disposed`, unregister that child, retire/release the old pin,
and clean its manager slot. It cannot close or mutate the replacement bundle.

`assertionDigest` is the self digest of exact internal
`RealmPrivateBakeActivationAssertionV1` fields: `format`, `version`,
`operatorPartitionId`, `realmId`, `lifecycleGeneration`,
`processOwnerId`, `activationPreparationId`, `candidateAdmissionIndexDigest`,
`publicationHeadBindingDigest`, `admissionHeadBindingDigest`,
`admissionPolicyDigest`, `evidencePolicyDigest`, `signatureTrustPolicyDigest`,
`runtimeCapabilityProfileId`, `runtimeCapabilityProfileDigest`,
`verifiedGraphProjectionDigest`, `activeBakeCsePredecessorDigest`,
`preparedCseCommitDigest`, `expectedPreparedCseSwapReceiptDigest`,
`activeBakeOutputRecordDigest`, `activationObservedAt`,
`minimumEnvelopeExpiresAt`, `trustedClockObservationDigest`, and
`assertionDigest`. The format/domain is
`particle-realms.realm-private-bake-activation-assertion`, version `1`, and only
`assertionDigest` is excluded. Each projected binding digest is recomputed from
the exact frozen value asserted under selection; no caller supplies it.

The three component digests are themselves frozen, independently vectorable
closed projections:

```text
RealmPublicationHeadBindingProjectionV1
  format = particle-realms.realm-publication-head-binding-projection
  version = 1
  publicationRootId
  publicationHeadGeneration
  publicationHeadStorageSha256
  bindingDigest

RealmAdmissionHeadBindingProjectionV1
  format = particle-realms.realm-admission-head-binding-projection
  version = 1
  admissionIndexDigest
  admissionHeadGeneration
  admissionHeadStorageSha256
  bindingDigest

RealmVerifiedAdmissionGraphProjectionV1
  format = particle-realms.realm-verified-admission-graph-projection
  version = 1
  admissionIndexDigest
  admissionIndexBlobContentId
  packageBlobContentId
  packageRealmForgeDigest
  resourceEnvelopeInventoryDigest
  resourceEnvelopeCount
  authoringEvidenceInventoryDigest
  authoringEvidenceCount
  signatureEnvelopeInventoryDigest
  signatureEnvelopeCount
  runtimeCapabilityProfileId
  runtimeCapabilityProfileDigest
  projectionDigest
```

Each uses `computeRealmContentId()` with its displayed format/domain and major
version `1`; only its named terminal `bindingDigest` or `projectionDigest` is
excluded. The publication and admission fields are copied from the exact closed
sanitized head bindings. The graph fields are copied from the independently
rehydrated index plus its exact selected-index blob identity. Counts are
non-negative safe integers and all other field validators retain their owning
contract's exact namespace. Unknown keys, caller-supplied digests, alternate
major versions, or any projection that does not reproduce the selected verified
graph fail before assertion construction. The assertion fields
`publicationHeadBindingDigest`, `admissionHeadBindingDigest`, and
`verifiedGraphProjectionDigest` equal these three recomputed terminal digests,
respectively.

Expired or revoked signing authority preserves historical immutable evidence
but denies activation. `prepareActivationEligibility()` performs the required
bounded dependency/evidence/signature walk before candidate materialization. No
ECS, GPU, audio, input, controller, or Storylet construction may begin until
that preparation succeeds. M2C may then stage the candidate and its durable
runtime pin; the retained-fence assertion and pointer swap are the final step.
Failure or expiry at that step disposes the candidate and retires/releases its
pin without ever making the bundle visible.

## Explicit manifest-only migration

Runtime startup never auto-migrates. Migration is an explicit RealmForge/trusted
service command with current operator authority:

1. read the selected legacy M1 manifest root;
2. reopen the corresponding authorized RealmForge source through RealmForge,
   not through the Virtual Realm application;
3. compile a fresh private bake with the reviewed M1C station and Storylets;
4. require the new verified package's `bakeId` and manifest digest to match the
   selected publication intent or require a new M1 publication first;
5. provision and read back every authoring-evidence and signature-envelope
   binding through the authorized evidence provisioning port; passing raw
   pre-resolved trust material to admission remains forbidden;
6. run the complete M2B admission transaction;
7. advance only the M2 admission head;
8. leave the legacy M1 publication artifacts immutable.

If source, evidence, signatures, station identity, policy, or exact package
cannot be reconstructed, migration returns `migration-unavailable`. It does not
create a partial index.

## Storylet quarantine

M2B verifies and retains these M1C resources exactly:

- Storylet definitions;
- proposal templates;
- safe-text records;
- cues;
- candidate index;
- Storylet dependency subclosure;
- Storylet catalog;
- Storylet validation receipt and external policy/station evidence.

They enter an immutable inert store only in later M2 loading. M2B exposes no
scheduler, eligibility evaluator, instance head, episode head, proposal
dispatcher, presentation channel, Chronicle writer, or action-result observer.
M3 must activate this exact catalog by admission, bake, catalog, and policy
digests. It cannot recompile the M1C authoring input.

## Failure matrix

| Failure | Required result |
| --- | --- |
| Unknown package/index/evidence/signature version | Reject before writes |
| Noncanonical JSON, duplicate key, invalid UTF-8, unknown key | Reject before writes or before exposing read data |
| Package not exact private v2 | Reject; diagnostics may report v1 separately |
| Package exceeds the bound base M2 runtime profile but is valid M1C | Return `runtime-profile-too-large`; perform zero admission writes |
| Requested Engine/runtime capability profile ID or digest differs from the selected index | Return `runtime-profile-incompatible`; do not reinterpret the existing admission under a new profile |
| Blob ID, semantic content ID, digest, byte length, or canonical text mismatch | Integrity failure; never overwrite or activate |
| Package blob hash and RealmForge semantic hash are substituted or conflated | Reject; independently recompute each with its bound canonicalization profile |
| Duplicate resource/evidence/signature ID | Reject |
| Inventory root/chunk order, boundary, count, digest, or byte total mismatch | Reject before resolving dependent payloads |
| Dangling dependency, unreachable resource, cycle, or excessive depth | Reject before materialization |
| Missing Storylet authoring evidence record | Reject migration/admission |
| Evidence/signature lookup binding is absent, cross-Realm, replaced, or differs from its exact payload | Reject provisioning/admission as missing evidence or substitution; never search by bare ID |
| Missing, substituted, expired, revoked, or invalid signature | Reject admission or current activation |
| Trust policy is cross-Realm, malformed, over limit, discontinuous, wrong-SPKI, or changed from the captured generation/digest/SHA | Reject or return current-trust-rejected; never consult a global revocation fallback |
| Station kit, station evidence, policy, catalog, receipt, or manifest cross-binding mismatch | Reject |
| Public/refinement/remote/Traveler/presence/bridge field enters base package | Reject local-only closure |
| Storage quota during immutable writes | Preserve prior head; leave safe orphans |
| Bounded exact-byte API or protected operator-service root is unavailable | Service startup fails closed; legacy unbounded blob APIs and `/user` fallback are forbidden |
| Generic app mutation, backup restore, or version restore targets protected service storage | Deny before dispatch and disclose no protected-path metadata |
| Immutable collision with different bytes | Integrity incident; never overwrite |
| M1 publication head lacks versioned generation/storage-SHA observation or exhibits ABA | Return migration-required or stale-publication conflict; never admit |
| M1 private head changes after the final observation | `RealmAdmissionSelectionCoordinator` prevents a cooperating authority writer; reject any writer/backend that cannot produce that fence evidence |
| Restart head no longer equals the index-bound M1 scope/root/generation/storage SHA | Return `stale-publication`; keep historical admission bytes but perform no runtime allocation |
| Admission policy codec is malformed, unavailable, or differs from the index/current operation | Return `current-policy-rejected`; never infer defaults or reuse historical policy authority |
| Admission-head CAS conflict | Return public `conflict` and terminal `head-conflict`; no merge |
| Operator generation changes before a mutation dispatch | Abort immediately; old operator bytes remain isolated |
| Operator generation changes after a mutation dispatch | Treat the result as outcome-unknown even if the scope error lacks an outcome flag; never retry or inspect through the new operator |
| Outcome unknown | Start from a verified fixed pending slot, then reconcile its directly addressed intent, proposal, dispatch/retry markers, and complete expected/observed head bytes; operation ID alone is insufficient |
| Pending-slot CAS/readback is uncertain | Observe the exact chosen slot under the original operator: proposed pending resumes, exact predecessor proves no root, and every third/malformed value remains unresolved |
| Post-dispatch storage receipt is incomplete, wrong-scope, does not prove same-origin serialization, or reports external-process CAS | Classify outcome unknown and reconcile exact head bytes; proposal is committed, predecessor requires exact no-effect proof, and any other/malformed observation remains conflict or unresolved. Never relabel a possibly committed proposal as rejected |
| Old-operator write may have committed after a switch | Do not inspect through the new operator; reconcile only after safely rebinding the original operator partition |
| Head points to missing/corrupt index, inventory, or package | Mark admission unavailable; never fall back to M1 manifest |
| Unresolved intent exists for the same Realm | Reconcile it before admitting another operation |
| Collector overlaps immutable staging | Shared maintenance fence serializes staging and the final GC root snapshot/deletion until verified pending-slot readback makes its addressed intent/proposal graph a durable root |
| Terminal audit/reclaiming cleanup is interrupted | Keep the fixed slot non-reusable; recover exact result/audit/control SHAs and conditionally delete only unchanged bytes |
| Root/artifact/evidence directory or page, current head, prepared/active/terminal root, manager/registration journal, pending control, candidate/progress state, or quarantine observation is unverified | Abort the entire collection pass before further mutation; never skip an authority or substitute a directory listing |
| Runtime capability or current trust changes after admission | Preserve admission, deny activation until compatible and currently trusted |

## Reserved garbage collection and rollback design

This section records the full-program safety design. The accepted admission-only
slice does not run collection, quarantine, deletion, checkpoint/handoff
retirement, or an artifact-reclamation sweep. Its presence here does not grant
a collector, deletion port, or rollback authority.

M2B never deletes an artifact during admission or rollback. A future collector
may remove unreachable immutable blobs only after a bounded reachability walk
from:

- every current admission head;
- explicitly pinned prior admissions;
- every verified pending slot, then its directly addressed intent and exact
  fixed proposed-head control plus the proposal's selected immutable graph;
- every verified `prepared` or `active` runtime pin, checkpoint, and handoff
  durable root;
- both fixed checkpoint-handoff authorization cells, including every
  `consumed-edge-active` checkpoint edge;
- every active runtime bundle admission pin;
- exact cleanup of every `abandoned`/`released` terminal root and manager
  journal before candidate discovery; an unresolved terminal state aborts the
  pass.

Reachability validates each root's full `RealmAdmissionDurableRootPayloadV1`.
A checkpoint payload retains its exact source-projection digest while the
matching nonterminal fixed manager journal retains the complete nested
checkpoint manager record, including source projection and authorization.
A handoff payload retains its complete checkpoint graph edge;
the collector follows that edge to the named still-active checkpoint root and
requires matching active-root SHA, record/head digest, and binding digest before
continuing. A missing, digest-only, kind-mismatched, or untraversable payload
aborts the pass rather than treating the checkpoint graph as unreachable.

Before collection can ship, `RealmAdmissionRootLeasePort@1` must be the only
mutation face for `/roots/pins`, `/roots/checkpoints`, and `/roots/handoffs`.
Every trusted root producer also owns a bounded fixed-slot manager-operation
journal, capped by `maximumAdmissionRootManagerJournalSlots`; an app cannot
mint an owner binding or bypass that journal. The internal root face is exactly:

```javascript
prepareRoot({
    rootKind,
    rootReferenceId,
    realmId,
    admissionIndexDigest,
    admissionIndexBlobContentId,
    rootPayload,
    ownerBindingId,
    managerOperationId,
    signal,
})
// -> { rootKind, realmId, rootReferenceId, rootPayloadDigest,
//      preparedRootStorageSha256 }

activateRoot({
    rootKind,
    realmId,
    rootReferenceId,
    expectedOwnerBindingId,
    managerOperationId,
    managerRecordId,
    managerRecordStorageSha256,
    expectedPreparedRootStorageSha256,
    expectedRootPayloadDigest,
    signal,
})
// -> { rootKind, realmId, rootReferenceId, rootStorageSha256 }

abandonPreparedRoot({
    rootKind,
    realmId,
    rootReferenceId,
    expectedOwnerBindingId,
    managerOperationId,
    expectedPreparedRootStorageSha256,
    expectedRootPayloadDigest,
    managerNonPublicationReceiptDigest,
    signal,
})
// -> { rootKind, realmId, rootReferenceId, abandonedRootStorageSha256 }

releaseRoot({
    rootKind,
    realmId,
    rootReferenceId,
    expectedOwnerBindingId,
    expectedRootStorageSha256,
    expectedManagerRecordStorageSha256,
    managerRetirementReceiptDigest,
    retirementAuthority,
    signal,
})
// -> { rootKind, realmId, rootReferenceId, releasedRootStorageSha256 }

observeRoot({
    rootKind,
    realmId,
    rootReferenceId,
    expectedOwnerBindingId,
    signal,
})
// -> exactly one of:
//    { status: 'missing' }
//    {
//      status: 'prepared' | 'active' | 'abandoned' | 'released',
//      rootKind,
//      realmId,
//      rootReferenceId,
//      ownerBindingId,
//      rootPayload,
//      rootPayloadDigest,
//      rootStorageSha256
//    }
```

`rootPayload` is exact `RealmAdmissionDurableRootPayloadV1`, a closed
kind-discriminated record retained byte-identically through every root state:

```text
runtime-pin:
  format = particle-realms.realm-admission-durable-root-payload
  version = 1
  rootKind = runtime-pin
  payloadDigest

checkpoint:
  format = particle-realms.realm-admission-durable-root-payload
  version = 1
  rootKind = checkpoint
  checkpointSourceProjectionDigest
  payloadDigest

handoff:
  format = particle-realms.realm-admission-durable-root-payload
  version = 1
  rootKind = handoff
  handoffRecordDigest
  checkpointBindingDigest
  checkpointGraphEdge
  payloadDigest
```

`payloadDigest` uses the displayed format/domain at version `1`, excluding only
itself. `checkpointGraphEdge` is the complete exact internal
`RealmRuntimeCheckpointGraphEdgeV1`; its nested digest must recompute. A payload
kind must equal the enclosing root kind. The handoff record digest is
precomputed after trusted identities and binding values are frozen
but before `prepareRoot()` dispatch. A checkpoint root retains the preparation-
time source projection only; its later source authorization and record digest
are bound by the checkpoint manager record used to activate that root. Runtime
pins retain no second kind payload.
Unknown/optional fields, caller-authored edge records, and digest-only handoff
edges fail closed.

`retirementAuthority` is an exact closed internal record with
`kind = retired-record | tombstone | successor-record`,
`retirementAuthorityStorageSha256`, and, only for `successor-record`,
`successorRootReferenceId`, `successorManagerOperationId`,
`successorManagerRecordStorageSha256`, and
`successorActiveRootStorageSha256`. The separate
`managerRetirementReceiptDigest` cryptographically binds that whole authority.

Each manager journal uses `RealmAdmissionRootManagerOperationStorageV1` at its
kind-specific fixed two-digit slot. Every variant contains exactly this header:

```text
format = particle-realms.realm-admission-root-manager-operation-storage
version = 1
operatorPartitionId
slotIndex
rootKind
operationGeneration
state
```

Every non-vacant operation variant additionally contains exactly this operation
identity block:

```text
realmId
rootReferenceId
ownerBindingId
managerOperationId
admissionIndexDigest
admissionIndexBlobContentId
rootPayloadDigest
managerRecordPredecessorKind
managerRecordPredecessorGeneration
managerRecordPredecessorStorageSha256?
createdAt
updatedAt
```

Those three predecessor fields are captured before the
`missing|clean-vacant -> planned` journal CAS and remain byte-identical through
the operation. `managerRecordPredecessorKind` is exactly `missing`, `record`, or
`tombstone`. `missing` requires decimal generation `0` and forbids the SHA;
`record` or `tombstone` requires a positive generation and the exact observed
manager-head storage SHA. For a runtime-pin slot the kind is always `missing`:
terminal cleanup must have authoritatively removed the prior fixed-slot manager
record before the root-manager slot became reusable. Checkpoint and handoff
operations bind their current monotonic head record/tombstone instead.

The closed required-field matrix beyond the header and, where applicable, that
operation identity block is:

```text
planned:           no additional fields
prepared:          preparedRootStorageSha256
manager-published: preparedRootStorageSha256, managerRecordId,
                   managerRecord, managerRecordStorageSha256
active:            preparedRootStorageSha256, managerRecordId,
                   managerRecord, managerRecordStorageSha256,
                   activeRootStorageSha256
manager-retired:   preparedRootStorageSha256, managerRecordId,
                    managerRecord, managerRecordStorageSha256,
                    activeRootStorageSha256,
                    managerRetirementReceiptDigest, retirementAuthorityKind,
                    retirementAuthorityStorageSha256,
                    successorRootReferenceId?, successorManagerOperationId?,
                    successorManagerRecordStorageSha256?,
                    successorActiveRootStorageSha256?
released:          preparedRootStorageSha256, managerRecordId,
                    managerRecord, managerRecordStorageSha256,
                    activeRootStorageSha256,
                    managerRetirementReceiptDigest,
                    retirementAuthorityKind,
                    retirementAuthorityStorageSha256,
                    successorRootReferenceId?, successorManagerOperationId?,
                    successorManagerRecordStorageSha256?,
                    successorActiveRootStorageSha256?,
                    releasedRootStorageSha256
abandoning:        preparedRootStorageSha256,
                   managerNonPublicationReceiptDigest
abandoned:         preparedRootStorageSha256,
                   managerNonPublicationReceiptDigest,
                   abandonedRootStorageSha256
clean-vacant:      previousManagerOperationId, terminalState,
                   terminalJournalDigest, cleanedAt
```

`clean-vacant` contains the header plus only its four displayed fields; it
forbids the operation identity block and every root/manager SHA. `terminalState`
is exactly `released` or `abandoned`. Every other state forbids every additional
field not named by its row. No row inherits a header, identity field, timestamp,
or prior `state` twice.

`managerRecord` is the complete exact kind-specific frozen runtime-pin,
checkpoint, or handoff manager record, not a digest-only projection. Its
canonical bytes must reproduce `managerRecordStorageSha256`; its semantic
self-digest and ID must reproduce the adjacent manager fields; and every root,
owner, operation, and admission binding must match. Once published, the nested
record remains in the fixed journal through `released` cleanup. Consequently an
edge-retained predecessor checkpoint remains fully verifiable after its single
mutable head advances to a successor; no historical head listing or unbounded
record store is required.

For `manager-retired` and `released`, `retirementAuthorityKind` is exactly
`retired-record`, `tombstone`, or `successor-record`. The four successor fields
are all required only for `successor-record` and forbidden otherwise.
`retired-record` is legal only for a runtime pin; `tombstone` is legal only for
checkpoint/handoff clear; `successor-record` is legal only for checkpoint or
handoff replacement after the successor manager record and root are both active.

`terminalJournalDigest` is the self digest of one exact internal
`RealmAdmissionRootManagerTerminalV1` projection:

```text
format = particle-realms.realm-admission-root-manager-terminal
version = 1
operatorPartitionId
slotIndex
rootKind
operationGeneration
realmId
rootReferenceId
ownerBindingId
managerOperationId
admissionIndexDigest
admissionIndexBlobContentId
rootPayloadDigest
managerRecordPredecessorKind
managerRecordPredecessorGeneration
managerRecordPredecessorStorageSha256?
terminalState
terminalRootStorageSha256
terminalAuthorityReceiptDigest
retirementAuthorityKind?
retirementAuthorityStorageSha256?
successorRootReferenceId?
successorManagerOperationId?
successorManagerRecordStorageSha256?
successorActiveRootStorageSha256?
terminalJournalDigest
```

For `released`, `terminalRootStorageSha256` is the exact released-root file SHA
and `terminalAuthorityReceiptDigest` is `managerRetirementReceiptDigest`; all
retirement-authority fields are required according to the same closed variant
rules as the released journal. For
`abandoned`, they are the exact abandoned-root file SHA and
`managerNonPublicationReceiptDigest` and every retirement-authority field is
forbidden. The digest uses
`computeRealmContentId()` with the displayed format/domain and major version
`1`, excluding only `terminalJournalDigest`.

Every journal transition is one exact previous-storage-SHA CAS plus readback.
`operationGeneration` is positive uint64 decimal text. A missing slot may create
only generation one; every state transition for that operation preserves it;
`clean-vacant` preserves the completed generation; and the next
`clean-vacant -> planned` transition uses exactly the previous generation plus
one and a new service-generated `managerOperationId`. Exhaustion fails closed.
The complete legal transition graph is:

```text
missing | clean-vacant -> planned
planned                -> prepared
prepared               -> manager-published | abandoning
manager-published      -> active
active                 -> manager-retired
manager-retired        -> released
abandoning             -> abandoned
released | abandoned   -> clean-vacant
```

No other edge is legal. `planned -> prepared` requires exact prepared-root
readback; `prepared -> manager-published` requires exact committed manager-record
readback; `prepared -> abandoning` requires exact durable manager-nonpublication
receipt readback; `manager-published -> active` requires exact active-root
readback; `active -> manager-retired` requires exact manager-retirement receipt
readback; `manager-retired -> released` requires exact released-root readback;
and `abandoning -> abandoned` requires exact abandoned-root readback. The two
terminal cleanup edges require the deletion and absence proofs below.

Missing is the initial clean slot; only missing/`clean-vacant` may become
`planned`. Before allocating, the manager holds maintenance, reads all 64 slots
for that `rootKind`, completes every deterministically recoverable operation and
terminal cleanup, and rejects malformed slots. It rejects a second live journal
for the same `(realmId, rootKind, rootReferenceId)` tuple, then chooses the
lowest-index missing/`clean-vacant` slot. No timestamp, random value, directory
order, or I/O completion order participates in slot choice.

A `released` or `abandoned` operation becomes `clean-vacant` only after the
exact terminal root file is deleted and observed missing and the exact
root-directory row is removed and observed absent. The clean record copies the
terminal operation ID/state and recomputed terminal digest before the terminal
journal bytes are overwritten. If either cleanup mutation is outcome-unknown,
the terminal journal remains authoritative and restart resumes from exact
root/directory observations; it never fabricates `clean-vacant`. Startup reads
exactly 64 slots for each of the three manager kinds, applies the control-record
byte ceiling, and enforces
`maximumAdmissionRootManagerJournalAggregateBytes`; no manager-history listing
is permitted.

All five methods require one manager-scoped branded capability whose role
matches `rootKind`; knowing a reference ID and SHA is not release authority.
The allowlisted path hashes the complete canonical tuple
`[realmId, rootKind, rootReferenceId]`, and that tuple is the uniqueness key
inside one operator partition. Root kinds are exactly `runtime-pin`,
`checkpoint`, and `handoff`; reference, owner-binding, manager-operation, and
manager-record IDs are issued by their trusted managers. App-supplied paths,
owner bindings, and generic storage handles are forbidden.

`RealmAdmissionDurableRootStorageV1` has exactly four closed variants. Every
field is written below exactly once; a variant accepts no inherited or unlisted
key:

```text
prepared:
  format = particle-realms.realm-admission-durable-root-storage
  version = 1
  rootKind
  rootReferenceId
  operatorPartitionId
  realmId
  admissionIndexDigest
  admissionIndexBlobContentId
  rootPayload
  rootPayloadDigest
  ownerBindingId
  managerOperationId
  state = prepared
  createdAt

active:
  format = particle-realms.realm-admission-durable-root-storage
  version = 1
  rootKind
  rootReferenceId
  operatorPartitionId
  realmId
  admissionIndexDigest
  admissionIndexBlobContentId
  rootPayload
  rootPayloadDigest
  ownerBindingId
  managerOperationId
  state = active
  managerRecordId
  managerRecordStorageSha256
  preparedRootStorageSha256
  createdAt
  activatedAt

abandoned:
  format = particle-realms.realm-admission-durable-root-storage
  version = 1
  rootKind
  rootReferenceId
  operatorPartitionId
  realmId
  admissionIndexDigest
  admissionIndexBlobContentId
  rootPayload
  rootPayloadDigest
  ownerBindingId
  managerOperationId
  state = abandoned
  preparedRootStorageSha256
  managerNonPublicationReceiptDigest
  createdAt
  abandonedAt

released:
  format = particle-realms.realm-admission-durable-root-storage
  version = 1
  rootKind
  rootReferenceId
  operatorPartitionId
  realmId
  admissionIndexDigest
  admissionIndexBlobContentId
  rootPayload
  rootPayloadDigest
  ownerBindingId
  managerOperationId
  state = released
  managerRecordId
  managerRecordStorageSha256
  preparedRootStorageSha256
  managerRetirementReceiptDigest
  retirementAuthorityKind
  retirementAuthorityStorageSha256
  successorRootReferenceId?
  successorManagerOperationId?
  successorManagerRecordStorageSha256?
  successorActiveRootStorageSha256?
  activeRootStorageSha256
  createdAt
  activatedAt
  releasedAt
```

Unknown keys, duplicate keys, or a field from another variant fail closed.
`active.managerRecordStorageSha256` is the exact manager record used by
`activateRoot()`; for a runtime pin this is always its `candidate-published`
record SHA. `released.managerRecordStorageSha256` remains that original active
manager-record SHA. `retirementAuthorityStorageSha256` is separately the exact
kind-specific retired record, tombstone, or successor record SHA. Its
`managerRetirementReceiptDigest` cross-binds the retirement authority, the
active root's original manager SHA, `activeRootStorageSha256`, and every
successor field when present; a terminal record cannot erase the activation
predecessor.

Checkpoint/handoff replacement uses exact
`RealmAdmissionRootSuccessorRetirementReceiptV1` with `format`, `version`,
`operatorPartitionId`, `realmId`, `rootKind`, `retiredRootReferenceId`,
`retiredManagerOperationId`, `retiredManagerRecordStorageSha256`,
`retiredActiveRootStorageSha256`, `successorRootReferenceId`,
`successorManagerOperationId`, `successorManagerRecordStorageSha256`,
`successorActiveRootStorageSha256`, `retirementDisposition = successor-active`,
and `receiptDigest`. Its format/domain is
`particle-realms.realm-admission-root-successor-retirement-receipt`, version
`1`, and only `receiptDigest` is excluded. It can be issued only after the
successor head, manager record, root payload, and active-root SHA all read back
and the successor record names the retired record as its exact predecessor.

Before `prepareRoot()` can dispatch, the service reconstructs the exact index
digest/blob pair under the runtime bounds, requires its operator/Realm binding,
verifies the reachable graph, validates the exact kind payload, and writes its
digest into the manager journal. It writes/reads the manager's pending journal
and root-directory tuple under maintenance, then writes/reads the prepared root.
A registered-but-missing target is a recovery state that blocks collection; it
is never silently skipped. `activateRoot()` validates the exact manager record
through the kind-specific manager verifier, including owner and prepared-root
binding, and requires the byte-identical root payload/digest before its CAS.
`abandonPreparedRoot()` is legal only from exact
`prepared` root and journal states. The kind-specific manager verifier must first
close that manager operation against future publication and return one durable,
scope-bound `managerNonPublicationReceiptDigest`; observing a manager record as
temporarily missing is insufficient. The service writes/reads `abandoning`,
CASes and reads the prepared root to the exact `abandoned` variant, then
writes/reads `abandoned`. `releaseRoot()` requires the same owner, exact current
active-root SHA, byte-identical root payload, and proof that the manager record
has ceased to be authoritative through the exact retirement-authority variant.
It copies that authority into the manager journal and released root.

Every post-dispatch error is reconciled through `observeRoot()` under the
original operator and complete Realm-scoped tuple. Exact proposal is committed,
exact predecessor or authoritative missing proves no effect, and any third,
malformed, or unreadable value remains unresolved; there is no blind retry.
Manager startup scans only its fixed journal slots. A prepared root with a
committed manager record is adopted through `activateRoot()`; a prepared root
whose manager operation has been durably closed against publication advances
through `abandoning` to `abandoned`; an active root is retained only when its
kind verifier proves either the exact root-bound manager record or the exact
allowed descendant chain from that record; and one whose exact retirement is
proven is released. A
`planned` journal with an absent root resumes the same frozen `prepareRoot()`;
`planned` plus the exact prepared-root bytes advances the journal to `prepared`
without a second root write; any third root value is unresolved.
`manager-published`, `manager-retired`, `abandoning`, `released`, and
`abandoned` journals likewise resume only their named next transition from exact
root and manager observations. No heuristic age, temporary missing record, or
missing in-memory owner can abandon or release a root.

After a released or abandoned root is read back, maintenance derives and
validates the exact terminal projection, conditionally deletes that exact
terminal control file, and authoritatively observes it missing before removing
the root-directory tuple. It then CASes the matching terminal journal to the
exact `clean-vacant` record containing that terminal digest. On root deletion,
directory removal, or journal-CAS uncertainty, the registration or terminal
journal remains recoverable and collection aborts. This prevents hash-named
terminal files from becoming undiscoverable retained garbage.

### Reserved runtime-pin, checkpoint, and handoff managers

Three flat trusted peers are the only root producers:
`RealmRuntimePinManager`, `RealmRuntimeCheckpointManager`, and
`RealmRuntimeHandoffManager`. Each receives its kind-scoped root capability and
one specific manager-record port; none receives another manager, and the app
receives no root lease. Given only the safe admission-head/index digest, the
manager resolves and verifies `admissionIndexBlobContentId` through the protected
admission service. The app cannot mint that blob ID, owner binding, manager
operation, root reference, or manager record.

Every producer uses this exact publication order. A one-call runtime-pin or
handoff producer retains maintenance across all six steps:

1. issue its manager operation/root reference and write/read `planned`;
2. call `prepareRoot()` and write/read the exact `prepared` journal;
3. publish and read back the kind-specific manager record under its own exact
   predecessor CAS;
4. write/read `manager-published` with that record ID/storage SHA;
5. call `activateRoot()` and write/read `active`;
6. only then release maintenance and allow the record to become usable.

The two-call checkpoint port is the sole fence-splitting exception. Its
`prepareCheckpoint()` holds maintenance through steps 1-2, including root-
directory registration and exact prepared-root/journal readback, then releases
maintenance before returning the opaque correlation. `commitCheckpoint()`
first acquires the checkpoint-source selection lease, then reacquires
maintenance, runs fixed-slot recovery, revalidates that the
correlation is process-local, single-use, and bound to the same live owner,
lifecycle, prepared journal/root, expected checkpoint-head predecessor, and
admission graph, then performs steps 3-5, releases maintenance, and finally
releases the source lease as step 6. Cancellation, process loss, lifecycle
retirement, or a missing correlation closes manager publication and drives the
prepared root through exact abandonment recovery. No Web Lock is held across an
app call boundary, and the registered prepared root remains a collector root
between calls.

The kind-specific read face always runs journal recovery first. It may expose a
checkpoint or handoff `record` only when the record's root reference, manager
operation, record digest/storage SHA, and active root observation all match the
recovered owner-manager journal. A record that won its head CAS but whose root
activation has not been proven returns only `root-recovery-pending`; a third,
malformed, or contradictory authority returns only
`manager-authority-unresolved`. Neither result exposes record fields. Checkpoint
and handoff tombstones remain readable as cleared authority while their
idempotent root retirement continues, because they can restore no runtime state.

Exact manager proposal commits adoption; exact predecessor proves no manager
publication and permits the durable nonpublication/abandonment path; every third
manager/root value is unresolved. Retirement first writes/reads the
kind-specific manager tombstone or terminal record, then writes/reads
`manager-retired`, calls `releaseRoot()`, writes/reads `released`, and completes
terminal root/directory/journal cleanup. A root is never released because an
in-memory owner merely disappeared.

`RealmRuntimePinManager` keeps one fixed-slot `RealmRuntimePinManagerRecordV1`
at the matching `/runtime-manager/pin/NN.json`. Every variant shares exactly
`format`, `version`, `operatorPartitionId`, `realmId`, `slotIndex`,
`recordGeneration`, `managerOperationId`, `rootReferenceId`, `state`,
`admissionIndexDigest`, `runtimeBundleId`, `processOwnerId`,
`lifecycleGeneration`, and `recordDigest`. `candidate-published` requires no
additional fields and forbids `previousManagerRecordStorageSha256`.
`visible-committed` additionally requires `rootBoundManagerRecordStorageSha256`,
`previousManagerRecordStorageSha256`, `activationAssertionDigest`,
`visibleCommitReceipt`, and `visibleCommitReceiptDigest`. `retired` additionally requires `retiredAt` and
`rootBoundManagerRecordStorageSha256`, `previousManagerRecordStorageSha256`, and
optionally carries the three visibility fields together or omits all three;
partial visibility evidence is invalid. Unknown
fields fail. The format/domain is
`particle-realms.realm-runtime-pin-manager-record`, version `1`, and only
`recordDigest` is excluded.

The candidate proposal omits `previousManagerRecordStorageSha256` only when the
current prepared root-manager operation retains its exact pre-planned
`managerRecordPredecessorKind = missing`, generation `0`, and absent SHA and the
manager re-observes the fixed manager-record path authoritatively missing under
maintenance immediately before publication. The slot predecessor captured by
that operation may have been initially missing or `clean-vacant`; the current
journal is correctly `prepared`, never required to remain vacant. The candidate
`recordGeneration` equals that journal's new positive `operationGeneration`.
After exact candidate readback, the active root
stores that candidate proposal SHA. A `visible-committed` proposal increments
`recordGeneration` by exactly one, sets
`rootBoundManagerRecordStorageSha256` to that candidate
SHA, and binds the same exact candidate storage SHA as its previous SHA. A normal
`retired` proposal retains the root-bound candidate SHA and binds the exact
visible record SHA as its previous SHA; a failure before visible commit may
transition directly from candidate to retired. Every retired proposal increments
its exact predecessor generation by one and binds that predecessor SHA. The root-manager journal
retains each exact expected/proposal SHA until release. The kind verifier accepts
only the current candidate record or this exact candidate-to-visible-to-retired
descendant chain rooted at the SHA stored in the active root; semantic state
names without that physical CAS lineage prove nothing.

After root release, the manager conditionally deletes the exact retired record,
observes the path missing, and only then returns the root-manager journal to
`clean-vacant`. A missing manager record while any non-vacant journal or active
root remains is unresolved, not a reusable slot.

The manager activates the new pin before `commitCandidate()`. A crash or failure
before a proven visible commit retires that already active manager record/root;
it does not use prepared-root abandonment. A successful same-owner/lifecycle
replacement keeps the
prior bundle's root reference, manager operation, root-bound candidate SHA, and
current manager-record SHA as a distinct disposal pin until the post-frame GPU
fence and all old resources are disposed; only then may it publish `retired`,
release that old root, and clean its fixed slot. Shutdown and post-swap recovery
distinguish the new current pin from every old disposal pin by those exact
bindings. Cross-session displacement instead leaves the predecessor root as the
old owner's `handoff-displaced-retained` pin until that old owner completes its own
retirement/close/fence/disposal path.

Shutdown first resolves prepared/offered candidates by preparation identity and
cleans any candidate pin. It then discovers current, handoff-displaced-retained,
and superseded disposal pins only from the bound process-owner child ledger,
never by listing protected storage. It closes current or displaced visibility
through the applicable pointer branch after lifecycle retirement, proves every owned bundle's GPU-fence or
device-loss completion, disposes resources, unregisters each terminal teardown
child, and then retires/releases/cleans every exact pin journal/root before owner
release. A missing or unresolved owned entry blocks completion and collection.

`RealmRuntimeCheckpointSourceService` is the flat trusted source of checkpoint
meaning. It receives only read-only current-active, safe-anchor/cursor,
accepted-head/profile, and local-policy observation faces and exposes only
`runtimeCheckpointSourcePort@1` to the checkpoint manager. Its exact methods are:

```javascript
readCurrent({ localRealmId, signal })
// -> { status: 'current', checkpointSourceProjection }
//  | { status: 'unavailable', reason: 'checkpoint-source-unavailable' }

acquireCommitLease({
    localRealmId,
    checkpointPreparationId,
    expectedCheckpointSourceProjectionDigest,
    expectedHeadBinding,
    signal,
})
// -> { status: 'leased', checkpointSourceProjection,
//      checkpointSourceAuthorization,
//      checkpointSourceLeaseHandle }
//  | { status: 'changed', reason: 'checkpoint-source-changed' }
//  | { status: 'unavailable', reason: 'checkpoint-source-unavailable' }
```

Neither app nor handoff manager receives this port, and the source service
receives no checkpoint storage or manager capability. Internally it acquires
only the shared activation-selection coordinator through a narrow lease face;
the checkpoint manager never receives that coordinator.

Its exact frozen `RealmRuntimeCheckpointSourceProjectionV1` has `format`,
`version`, `operatorPartitionId`, `realmId`, `processOwnerId`,
`lifecycleGeneration`, `admissionIndexDigest`, `publicationHeadBinding`,
`admissionHeadBinding`, `runtimeCapabilityProfileId`,
`runtimeCapabilityProfileDigest`, `runtimeBundleId`,
`visiblePointerGeneration`, `liveVisibilityReceiptDigest`, `safeAnchorId`,
optional `logicalCursorId`, `localPolicyId`, `localPolicyDigest`,
`sourceSequence`, and `projectionDigest`. Its format/domain is
`particle-realms.realm-runtime-checkpoint-source-projection`, version `1`, and
only `projectionDigest` is excluded. `sourceSequence` is positive uint64
decimal text from the source service's process-local monotonic observation
counter, not wall time. The projection is available only while that exact
bundle is current and all source/policy observations agree; closed,
superseded, disposal, operator/lifecycle mismatch, or uncertain observation
returns unavailable with no fields.

`checkpointSourceAuthorization` is exact frozen
`RealmRuntimeCheckpointSourceAuthorizationV1` with `format`, `version`,
`operatorPartitionId`, `realmId`, `processOwnerId`, `lifecycleGeneration`,
`checkpointPreparationId`, `checkpointSourceProjectionDigest`,
`expectedHeadBinding`, `leaseSequence`, and `authorizationDigest`. Its
format/domain is
`particle-realms.realm-runtime-checkpoint-source-authorization`, version `1`,
and only `authorizationDigest` is excluded. `leaseSequence` is positive
process-local uint64 decimal text, not wall time. The authorization binds no
checkpoint record digest, avoiding a digest cycle; the eventual checkpoint
record binds `authorizationDigest`.

`checkpointSourceLeaseHandle` is branded `realmCheckpointSourceLease@1`,
nonserializable, single-use, and has exactly `release({ outcome, signal })`.
`outcome` is `committed`, `not-committed`, or `recovery-pending`; release returns
one frozen idempotent `RealmRuntimeCheckpointSourceLeaseReleaseReceiptV1` with
`format`, `version`, `operatorPartitionId`, `realmId`, `processOwnerId`,
`lifecycleGeneration`, `checkpointPreparationId`,
`checkpointSourceAuthorizationDigest`, `outcome`, `leaseSequence`,
`releaseSequence`, `released = true`, and `receiptDigest`. Its format/domain is
`particle-realms.realm-runtime-checkpoint-source-lease-release-receipt`, version
`1`, and only `receiptDigest` is excluded; it grants no authority. While held, the exact
operator/Realm current-active pointer, live-visibility receipt, anchor/cursor,
heads/profile, and local policy cannot be changed by activation or policy
writers. Lock order is activation-selection lease, maintenance fence,
checkpoint-head CAS, checkpoint root activation/readiness,
maintenance release, then lease release. Preparation performs no selection
lease. Commit acquires it before maintenance and its final source read and keeps
it through exact proposal readback plus active-root readiness. Exact predecessor completes
abandonment while held. A third/uncertain CAS stores the frozen source
authorization with the proposal, enters manager recovery, and releases only
after the operation is durably marked recovery-pending; no checkpoint is exposed
until exact proposal/predecessor reconciliation. This closes the source TOCTOU
without giving the checkpoint manager active-pointer mutation authority.

`RealmRuntimeCheckpointManager` backs `runtimeCheckpointPort@1`. Its current
app-facing surface is exact:

```javascript
readLatest({ localRealmId, maximumBytes, signal })
prepareCheckpoint({ localRealmId, checkpointDraft, expectedHeadBinding, signal })
commitCheckpoint({ checkpointPreparationId, signal })
abortCheckpoint({ checkpointPreparationId, reason, signal })
retireCheckpoint({ localRealmId, expectedHeadBinding, signal })
```

`maximumBytes` is exactly the registered
`maximumAdmissionControlRecordBytes`. `expectedHeadBinding` is exactly
`checkpointGeneration` plus nullable `exactStorageSha256`; zero/null is legal
only for a never-initialized head. `checkpointDraft` has exactly
`admissionIndexDigest`, `publicationHeadBinding`, `admissionHeadBinding`,
`runtimeCapabilityProfileId`, `runtimeCapabilityProfileDigest`,
`runtimeBundleId`, `safeAnchorId`, optional `logicalCursorId`, `localPolicyId`,
and `localPolicyDigest`. The prepared variant carries only one ASCII
`checkpointPreparationId` matching
`^checkpoint-preparation:v1:[0-9a-f]{64}$`; it is process-local, single-use,
owner/lifecycle-bound, at most 96 UTF-8 bytes, and never serialized into a
handoff. Its suffix is issued only by
`secureRandomPort@1.issueHex256({ purpose: 'checkpoint-preparation' })`; secure
random failure returns unavailable before root allocation. The same pre-root
phase also preissues and retains, but does not expose, one
`checkpoint-handoff-authorization` ID. If either issuance fails, neither ID is
retained and no root/journal is allocated; if preparation is abandoned, the
hidden authorization is invalidated. This guarantees a committed checkpoint is
never stranded because authorization randomness was requested after its head
CAS. The exact prepare
result is `{ status: 'prepared', checkpointPreparationId }`, `{ status: 'busy',
reason }`, or `{ status: 'unavailable', reason }`. Busy reason is exactly
`checkpoint-preparation-busy` or `checkpoint-edge-capacity`; unavailable
reason is exactly `secure-random-unavailable` or
`manager-authority-unresolved`. No variant exposes a root or journal. The
service supplies every other storage-record field.

Preparation calls `readCurrent()` first and requires every draft field to equal
the returned service projection; the draft is a request, never authority. The
manager freezes `checkpointSourceProjectionDigest` into the prepared record and
the checkpoint root's exact kind payload. Commit binds the later
`checkpointSourceAuthorizationDigest` and final checkpoint-record digest in the
checkpoint manager record that must be read back before that unchanged root can
be activated.
Commit calls `acquireCommitLease()` and requires byte-identical
bundle/pointer/live-visibility/head/profile/anchor/cursor/policy projection, then
binds its `checkpointSourceAuthorizationDigest` before checkpoint-head CAS. A
changed source performs no manager publication, abandons the prepared root, and
returns `not-committed` with reason `checkpoint-source-changed` plus the same
exact abandonment receipt shape. Source unavailability performs no mutation,
retains the one bounded prepared correlation/root for retry, and returns
`unavailable` with reason `checkpoint-source-unavailable`. Thus a hostile app cannot commit a
fictional bundle, pose anchor, logical cursor, or policy and then launder it
through handoff.

The checkpoint service retains exactly one live preparation per bound process
owner/lifecycle generation with edges `preparing -> prepared -> committing ->
committed`, `preparing -> aborted`, and `prepared -> abandoning -> abandoned`.
A second `prepareCheckpoint()` while the existing entry is `prepared` first
drives that exact nonpublished manager/root through abandonment, terminal
abandoned-root deletion/absence proof, directory-row removal, and
`abandoned -> clean-vacant` journal readback, then allocates the replacement;
it never holds two prepared roots for the same owner/generation. A second call
while `preparing`, `committing`, or unresolved returns only
`checkpoint-preparation-busy` and creates no root. Cancellation, application
stop, operator switch, lifecycle retirement, or process-owner loss closes any
noncommitting entry through the same exact abandonment recovery. A `committing`
entry is manager-reconciled and cannot be caller-aborted. Thus repeated live
preparation cannot consume all 64 root-manager slots.

`abortCheckpoint()` is the teardown-only lifecycle exception. Its `signal` must
be the exact still-live teardown signal prebound to the port; the work signal is
rejected. `reason` is exactly `application-close`, `operator-switch`,
`device-loss`, `handoff-cancel`, or `checkpoint-recovery`. A `prepared` entry
invalidates its reserved handoff authorization, drives its prepared root and
manager journal through exact abandonment and clean-vacant readback, and returns
`{ status: 'aborted', checkpointPreparationId,
checkpointAbortReceiptDigest }`. A `committing` entry returns only
`{ status: 'recovery-pending', checkpointPreparationId, reason:
'checkpoint-commit-authority-unresolved' }`; it cannot masquerade as abort.
Exact retained replay returns `already-terminal` with terminal status
`abandoned`, `committed`, or `retired`; only a prior teardown abort carries the
same abort-receipt digest. An evicted or arbitrary ID returns `not-found` with
`checkpoint-preparation-missing` and allocates nothing.

`checkpointAbortReceiptDigest` names exact frozen
`RealmRuntimeCheckpointAbortReceiptV1` fields `format`, `version`,
`operatorPartitionId`, `realmId`, `processOwnerId`, `lifecycleGeneration`,
`checkpointPreparationId`, `reason`, `terminalState = abandoned`,
`handoffAuthorizationInvalidated = true`,
`abandonedRootStorageSha256`, `cleanVacantReadbackDigest`, and `receiptDigest`.
Its format/domain is
`particle-realms.realm-runtime-checkpoint-abort-receipt`, version `1`, and only
`receiptDigest` is excluded. It grants no root, storage, or handoff authority.

The one checkpoint terminal cell retains only the latest committed or abandoned
result needed for idempotent correlation replay. A later preparation may evict
it only after root/journal cleanup is complete and any unclaimed handoff
authorization is invalidated. Evicted or arbitrary preparation IDs return the
closed `invalid` reason `checkpoint-preparation-missing` and allocate nothing;
there is no unbounded correlation or receipt history.

`readLatest()` returns one closed sanitized observation. `missing` carries
generation `0` and null SHA. `record` carries `checkpoint`, the exact frozen
safe projection containing observed generation, exact storage SHA, checkpoint
ID, admission index, accepted head/profile/bundle/safe-anchor/policy fields,
optional logical cursor, creation time, record digest, and exact
`RealmRuntimeCheckpointBindingV1`. `cleared` carries generation, SHA, and
tombstone digest. `unavailable` carries exactly `root-recovery-pending` or
`manager-authority-unresolved`; `invalid` carries only the frozen bounded-codec
reason.

`commitCheckpoint()` has a different closed result because it must prove the
outcome of its own preparation correlation:

```text
committed:
  status = committed
  checkpoint
  checkpointHandoffAuthorizationId

not committed:
  status = not-committed
  checkpointPreparationId
  reason = checkpoint-head-predecessor-retained | checkpoint-source-changed
  checkpointAbandonmentReceiptDigest

unavailable:
  status = unavailable
  checkpointPreparationId
  reason = checkpoint-source-unavailable | root-recovery-pending |
           manager-authority-unresolved

invalid:
  status = invalid
  reasonCode
```

Only exact checkpoint-head proposal plus manager/root active readback and the
reasserted exact checkpoint-source projection yields
`committed`. Exact predecessor proves no checkpoint publication, drives the
prepared root through abandonment, exact terminal-file deletion/absence,
directory-row removal, and `abandoned -> clean-vacant` readback, then yields
`not-committed`; it can never return the old `record` or `missing` observation as
if this proposal committed. Every third or uncertain value yields unavailable
and retains the committing correlation for manager recovery. Source
unavailability before dispatch retains the prepared correlation instead; it is
not mislabeled as predecessor or source change.

`checkpointAbandonmentReceiptDigest` names exact frozen
`RealmRuntimeCheckpointAbandonmentReceiptV1` with `format`, `version`,
`checkpointPreparationId`, `expectedHeadBinding`,
`reason`, `abandoned = true`,
`cleanVacantReadbackDigest`, and `receiptDigest`. Its format/domain is
`particle-realms.realm-runtime-checkpoint-abandonment-receipt`, version `1`, and
only `receiptDigest` is excluded. It contains no root, manager, path, or storage
capability. `reason` is exactly `checkpoint-head-predecessor-retained` or
`checkpoint-source-changed` and must equal the enclosing result.

The committed result's `checkpoint` projection binds the exact M2A
`RealmRuntimeCheckpointBindingV1`; its binding generation/SHA/record digest and
owner/lifecycle/head/profile/bundle/anchor/cursor/policy/source-projection/source-
authorization fields are copied from the proven active record.
`checkpointHandoffAuthorizationId` matches
`^checkpoint-handoff-authorization:v1:[0-9a-f]{64}$`, is issued only through
`secureRandomPort@1.issueHex256({ purpose:
'checkpoint-handoff-authorization' })`, and is process-owner/lifecycle/binding
bound. It is a single-success correlation, never record data or a capability to
read a checkpoint. At most one unconsumed authorization exists for the current
checkpoint cell, plus at most one predecessor `consumed-edge-active` retention
cell during exact replacement. The next preparation first invalidates an
unclaimed current authorization; it may use the free current cell while one old
edge remains, but a third required cell returns `checkpoint-edge-capacity`.
A root named by either active edge cannot retire before exact edge-release readback.
Operator partition, root reference, manager operation,
protected path, root record, journal, and authorization internals never cross
the app ports. `retireCheckpoint()` returns `{ status: 'busy', reason:
'checkpoint-handoff-edge-active' }` without mutation while that edge is active;
otherwise it returns the same `cleared` projection after tombstone readback and
begins exact root retirement.

The two protected checkpoint-handoff paths are exact durable
`RealmRuntimeCheckpointHandoffAuthorizationCellV1` records. Both are initialized
once by absent-only CAS as `vacant` generation `0`; missing after initialization,
an uncertain initialization result, or any malformed cell makes checkpoint and
handoff authority unresolved. Every variant has exactly `format`, `version`,
`operatorPartitionId`, `realmId`, `cellIndex = 0 | 1`, decimal-text
`cellGeneration`, `state`, decimal-text `transitionSequence`, and `cellDigest`.
The remaining exact field matrix is:

```text
vacant:
  vacancyReason = initialization | reserved-abandoned |
                  issued-invalidated | edge-cleaned
  previousCellDigest?

reserved:
  processOwnerId
  lifecycleGeneration
  checkpointPreparationId
  checkpointHandoffAuthorizationId
  expectedCheckpointHeadBinding
  checkpointSourceProjectionDigest
  reservationReceipt

issued:
  all reserved identity/binding fields
  checkpointBinding
  checkpointBindingDigest
  authorizationIssueReceipt
  lastRestoredClaimReceipt?
  lastRestorationSettlementReceipt?

claimed:
  all issued required fields except the optional restoration pair
  handoffManagerOperationId
  handoffRootReferenceId
  handoffExpectedHeadBindingDigest
  checkpointGraphEdge
  claimReceipt

recovering:
  all claimed fields
  recoverySettlementReceipt

consumed-edge-active:
  all claimed fields
  proposalSettlementReceipt

edge-released:
  all consumed-edge-active fields
  edgeReleaseReceipt
```

Every nested receipt is the complete exact frozen receipt, not only its digest;
every nested digest, cell identity/generation, transition sequence, manager
journal, binding, and graph edge must recompute. The optional restoration pair
is both-present or both-absent. `cellDigest` uses format/domain
`particle-realms.realm-runtime-checkpoint-handoff-authorization-cell`, version
`1`, excluding only itself. `cellGeneration` increases exactly once when a
vacant slot is reserved; `transitionSequence` then increases exactly once per
successful CAS within that generation. Neither is wall time or global order.

For initial generation `0`, `vacancyReason = initialization`,
`transitionSequence = 0`, and `previousCellDigest` is absent. Every later vacant
record requires `previousCellDigest` equal to the exact terminal cell digest it
replaced and uses the corresponding non-initial reason; initialization is then
forbidden.

`reservationReceipt` is exact
`RealmRuntimeCheckpointHandoffReservationReceiptV1` fields `format`, `version`,
`operatorPartitionId`, `realmId`, `cellIndex`, `cellGeneration`,
`transitionSequence`, `processOwnerId`, `lifecycleGeneration`,
`checkpointPreparationId`, `checkpointHandoffAuthorizationId`,
`expectedCheckpointHeadBindingDigest`, `checkpointSourceProjectionDigest`,
`cellState = reserved`, and `receiptDigest`. `authorizationIssueReceipt` is exact
`RealmRuntimeCheckpointHandoffAuthorizationIssueReceiptV1` with those same
cell/owner/preparation/authorization fields, `checkpointBindingDigest`,
`cellState = issued`, its issuing `transitionSequence`, and `receiptDigest`.
Their format/domains are respectively
`particle-realms.realm-runtime-checkpoint-handoff-reservation-receipt` and
`particle-realms.realm-runtime-checkpoint-handoff-authorization-issue-receipt`,
version `1`, excluding only each `receiptDigest`. The expected checkpoint-head
binding digest is recomputed from the full adjacent binding; a digest without
that binding is invalid.

The exact durable edges are `vacant -> reserved -> issued -> claimed`,
`claimed -> issued` on proven predecessor or terminal nonpublication,
`claimed -> recovering` on uncertainty, `recovering -> issued` on later proven
predecessor or terminal nonpublication,
`claimed|recovering -> consumed-edge-active` on proven proposal,
`consumed-edge-active -> edge-released`, and `reserved|issued|edge-released ->
vacant` only after their respective abandonment, invalidation, or safe terminal
cleanup receipts are read back. A restored `issued` cell retains the immediately
prior claim/settlement pair until the next claim. An `edge-released` cell retains
the complete release receipt for bounded idempotent replay until safe cleanup;
once moved to vacant, its evicted correlation returns the closed missing/
predecessor result and allocates nothing. Vacant retains only one prior cell
digest for CAS lineage, not a polymorphic or externally replayable receipt.

Reservation occurs under maintenance after both secure-random IDs are issued
but before root allocation. Checkpoint commit fills the exact binding and moves
`reserved -> issued` only after checkpoint-head proposal and active-root
readback; abandonment returns it to vacant. Claim requires the matching planned
handoff manager journal and copies that journal's exact expected-head binding
digest into the cell. Settlement uses the internal read-only
`runtimeHandoffOutcomeObservationPort@1` to recover that same fixed journal and
observe its protected head; caller outcome/SHA fields are agreement checks, not
authority. Failure after claim but before head dispatch must first complete any
deterministic planned root, obtain exact manager-nonpublication plus abandoned-
root readback, and then restore the issued cell through `settleAuthorization()`;
mere absence or a not-yet-dispatched journal cannot restore it. Restart reads
both cells before any checkpoint, handoff, retirement,
or GC action and resumes only these transitions. A
`consumed-edge-active` cell is itself a GC root and blocks release of its named
checkpoint root. After `releaseEdge()` and any deferred predecessor-root
retirement/cleanup, the cell may enter vacant; no scan or third cell exists.

Initialization is independently recoverable per fixed slot under maintenance,
not an atomic two-file promise. For slot `0` then slot `1`, authoritative absent
with no root/journal reference to a prior generation permits only the canonical
generation-zero vacant proposal; exact proposal readback completes that slot,
and exact absent resumes the same CAS after a crash. A third value, or absence
while any verified root/journal references that slot, is
`manager-authority-unresolved`. Thus a crash after slot `0` readback and before
slot `1` dispatch resumes slot `1`; it never strands a half-initialized pair or
reinitializes a previously used cell.

Its current
static checkpoint record is `RealmRuntimeStaticCheckpointRecordV1` with exactly
`format`, `version`, `operatorPartitionId`, `realmId`, `checkpointId`,
`checkpointRootReferenceId`, `checkpointManagerOperationId`, `checkpointGeneration`,
`previousCheckpointHeadStorageSha256?`, `admissionIndexDigest`,
`publicationHeadBinding`, `admissionHeadBinding`,
`runtimeCapabilityProfileId`, `runtimeCapabilityProfileDigest`,
`processOwnerId`, `lifecycleGeneration`, `runtimeBundleId`,
`visiblePointerGeneration`, `liveVisibilityReceiptDigest`,
`checkpointSourceProjection`, `checkpointSourceProjectionDigest`,
`checkpointSourceAuthorization`, `checkpointSourceAuthorizationDigest`,
`safeAnchorId`, `logicalCursorId?`, `localPolicyId`,
`localPolicyDigest`, `createdAt`, and `recordDigest`. Its format/domain is
`particle-realms.realm-runtime-static-checkpoint-record`, version `1`, and only
`recordDigest` is excluded. The service generates every checkpoint ID,
generation, root reference, and digest; prepare returns only a bounded opaque
correlation after completing steps 1-2 of the six-step sequence: exact `planned`
journal plus exact prepared-root and `prepared` readback. Commit is the only
caller of steps 3-6: checkpoint-head CAS/readback, `manager-published`, root
activation, and `active` readback.

The nested source projection and authorization are mandatory safe records, not
capabilities. Their digests must recompute, the authorization must name the
nested projection digest and preparation correlation, and every duplicated
operator/Realm/owner/lifecycle/head/profile/bundle/pointer/live-receipt/anchor/
cursor/policy field must equal the enclosing checkpoint record. Restart and
handoff verification use these nested bytes; a digest without its exact record
is invalid.

Retirement
writes `RealmRuntimeStaticCheckpointTombstoneV1` with exactly `format`,
`version`, `operatorPartitionId`, `realmId`, `checkpointGeneration`,
`previousCheckpointHeadStorageSha256`, `clearedRecordDigest`,
`clearedRootReferenceId`, `clearedManagerOperationId`, `clearedAt`, and
`tombstoneDigest` before releasing its root. Its format/domain is
`particle-realms.realm-runtime-static-checkpoint-tombstone`, version `1`, and
only `tombstoneDigest` is excluded. Initial,
replacement, clear, and restart use the same exact predecessor/next-generation
CAS rules as the handoff head; malformed authority blocks mutation. Its
`readLatest()` result is exactly `missing`, `record`, `cleared`, `unavailable`,
or `invalid`, uses the common manager-read readiness rule above, and returns no
root capability or partition path.

Checkpoint replacement keeps the predecessor root active until the successor
checkpoint record and unchanged-payload root are both active. It then issues
the exact `RealmAdmissionRootSuccessorRetirementReceiptV1`. If no protected
handoff edge names the predecessor, it releases that old root immediately under
`retirementAuthorityKind = successor-record`. If a
`consumed-edge-active` cell still names it, the manager retains the receipt and
defers release until `releaseEdge()` proves the old handoff root released; that
readback is the sole deferred-retirement trigger. It never writes a tombstone
over the successor head.

`RealmRuntimeHandoffManager` owns the record/tombstone codec and monotonic head
defined by M2A's `runtimeHandoffPort@1`. Its service-generated
`handoffRootReferenceId` equals the root-manager reference,
`handoffManagerOperationId` equals the owner-manager journal operation, and the
handoff record binds the selected admission digest; the manager resolves the
blob ID internally. It never receives `RealmRuntimeCheckpointManager`. The OS
service root injects only `runtimeCheckpointHandoffBindingPort@1`, whose exact
M2A `claimAuthorization()`, `verifyBinding()`, `settleAuthorization()`, and
`releaseEdge()`
signatures, closed results, claim/settlement receipts, bounded state machine,
and graph-edge schema can neither read nor mutate checkpoint heads. Every write
requires M2A's separate `checkpointHandoffAuthorizationId` and a record draft
containing only `operationsViewRequested`; the claim returns the exact active checkpoint binding
and protected graph edge, requires every duplicated handoff field to match,
and makes the handoff record digest, binding digest, and complete edge the exact
kind payload of the prepared handoff root before head CAS.
Exact handoff proposal consumes the claim. An exact dispatched predecessor
restores the issued claim only with matching manager-nonpublication and
abandoned-root proof; exact pre-dispatch nonpublication requires the same pair.
Uncertainty leaves the claim manager-recoverable. Missing
authorization or any caller-authored
restoration field, including `checkpointBinding`, is forbidden.
For replacement, it prepares the new root while the old root remains active,
writes/reads the new handoff record, activates the new root, and only then
issues the exact successor-retirement receipt and retires/releases the
superseded manager record/root under `successor-record` authority. Clear writes/reads the durable
tombstone first and cannot erase its generation. After either old handoff root
is exactly released, the manager calls the exact binding port's `releaseEdge()`;
retirement of the checkpoint root named by that edge remains blocked while the
edge cell is active. One successor checkpoint may still use the free current
cell; a third required cell remains blocked by `checkpoint-edge-capacity`.

`runtimeHandoffPort.read()` reaches only this manager. It cannot return
`status: 'record'` from the head file alone: it applies the common readiness rule
and requires the active handoff root to retain the exact checkpoint graph edge
and the narrow verifier to reproduce the
complete binding. Invalid binding returns `checkpoint-binding-invalid`; binding
authority uncertainty returns `manager-authority-unresolved`. It otherwise
returns the exact M2A `unavailable` variant. Thus a crash between
handoff-head CAS and root activation cannot be mistaken for a resumable session.

Stable cross-session handoff is ordered: the old session commits and activates
its checkpoint root, then commits and activates its handoff root; the new session
validates both, prepares its candidate, activates its runtime pin, and performs
the retained-fence visible commit. Only after that commit may it clear/retire the
handoff record and release its root. Checkpoint retention is separately
policy-bound. The old session then follows its own lifecycle-retirement/
`handoff-displaced-pointer-preserved` close/fence/disposal path and releases its
own displaced-retained pin; that pin never enters the new process owner's same-
generation supersession ledger. Runtime-pin
release can never strand the only graph root before
checkpoint or handoff activation. Every manager startup scans its fixed journal
slots and deterministically completes interrupted prepare, adoption, visibility,
retirement, abandonment, release, or terminal cleanup.

When the visible predecessor belongs to a different process owner/lifecycle,
ordinary `bundle-replaced` is structurally illegal. Under the already-held
selection fence, the activation service must claim M2A's exact service-only
cross-session handoff lease and bind its claim-receipt digest into the
service-owned visible-commit receipt after the already-frozen guard assertion.
The no-await commit then closes
and reads back the old gates, installs the new pointer/gates, stores the exact
cross-session displacement receipt in both owner slots, and marks the old slot
`handoff-displaced-retained`. The old child/resources/pin never transfer. A
precommit failure cancels the claim. A post-CSE swap/displacement receipt shape
or digest mismatch enters CSE integrity quarantine and reports
`cse-integrity-quarantined`. A claim-settlement authority uncertainty instead
reports `manager-authority-unresolved`, retains the claim for bounded recovery,
and keeps the handoff record uncleared. Only exact consumed settlement permits
later handoff clear. After its own durable
lifecycle retirement, the old handle uses
`handoff-displaced-pointer-preserved`, never removes the new pointer, and lets
only the old owner's disposal pipeline release the old pin.

### Reserved bounded root discovery required before collection

No collector may list hash-named heads or roots. The one discovery authority is
`RealmAdmissionRootDirectoryHeadStorageV1` at the fixed
`/gc/root-directory-head.json` path. It has exactly:

```text
format = particle-realms.realm-admission-root-directory-head-storage
version = 1
operatorPartitionId
generation
pageEntryLimit
entryCount
pages
rootSetDigest
previousHeadStorageSha256?
updatedAt
```

Each page descriptor has exactly `pageIndex`, `firstSortKey`, `lastSortKey`,
`entryCount`, `pageBlobContentId`, `pageDigest`, and `canonicalByteLength`.
`RealmAdmissionRootDirectoryPageV1` is an immutable exact-byte content blob with
`format`, `version`, `pageIndex`, `entries`, and `pageDigest`. An entry is one
closed variant:

```text
admission-head registration:
  rootEntryKind = admission-head
  realmId

durable-root registration:
  rootEntryKind = durable-root
  rootKind
  rootReferenceId
  realmId
```

Sort keys are respectively `['admission-head', realmId]` and
`['durable-root', realmId, rootKind, rootReferenceId]`. Pages contain at most
`maximumAdmissionRootDirectoryPageEntries`; the head contains at most
`maximumAdmissionRootDirectoryPages` descriptors and the full set at most
`maximumAdmissionRootDirectoryEntries`. All descriptors, boundaries, counts,
digests, and exact page bytes are independently rechecked. The directory uses
copy-on-write immutable pages and one exact-SHA head CAS under maintenance, so
no paginated mutable partial update becomes authority.

The root-directory head is one of the three exact directory-head exceptions to
the generic 1 MiB control-record ceiling. It is stat/read/written under
`maximumAdmissionRootDirectoryHeadBytes = 16777216`, and its canonical node
count remains capped at 100,000. Every sort-key component is limited to 256
UTF-8 bytes and every descriptor has the exact fields above; the worst-case
4,096-descriptor escaped canonical form must fit that 16 MiB cap. A construction
or vector that crosses either bound is invalid rather than partially paginated.

Directory page/head digests use `computeRealmContentId()` with formats
`particle-realms.realm-admission-root-directory-page` and
`particle-realms.realm-admission-root-directory-head-storage`, version `1`,
excluding only the named self-digest plus head chronology fields. Unknown keys,
overlapping page boundaries, gaps, duplicate tuples, and a page count/entry
count mismatch fail closed.

Before a committed first M2 admission can change `pending` to `vacant`, recovery
registers and reads back its Realm under maintenance. The pending proposal roots
that new head graph until registration succeeds, so a failed pre-dispatch first
attempt leaves no directory tombstone. Before a durable root can be prepared,
its manager journal and exact Realm-scoped tuple are registered under the same
fence. Registration may remain while its target path is missing; that state
blocks collection until journal recovery proves no effect. Removal is permitted
only under maintenance after an admission Realm has no head and no pending
operation, or after a released/abandoned durable-root file has been conditionally
deleted, observed absent, and its manager retirement/non-publication authority
is exact. This makes every possible
current head/root path discoverable without directory listing.

Root discovery is not candidate discovery. Before collection can ship, every
operator-service `putExactBytes()` producer must route through the
directory-aware content adapter and the fixed
`/gc/artifact-registration/00.json` through `63.json` journal. The authoritative
enumeration head is `RealmAdmissionArtifactDirectoryHeadStorageV1` at
`/gc/artifact-directory-head.json`, with exactly `format`, `version`,
`operatorPartitionId`, `generation`, `pageEntryLimit`, `entryCount`, `pages`,
`artifactSetDigest`, `previousHeadStorageSha256?`, and `updatedAt`. Its fixed
`RealmAdmissionArtifactDirectoryPageStorageV1` pages contain strictly blob-ID-sorted
entries with exactly:

```text
blobContentId
canonicalByteLength
producerClasses
```

`producerClasses` is a sorted nonempty subset of `admission`,
`evidence-registry`, and `root-directory`.
A deduplicated payload gains every applicable producer class through a
copy-on-write directory generation; a class is never lost merely because one
reference disappears. Artifact-directory pages cannot be content blobs listed
by themselves. Each logical page index therefore has exactly two fixed control
slots, `a` and `b`; a head descriptor names `pageIndex`, `pageSlot`,
`firstBlobContentId`, `lastBlobContentId`, `entryCount`, `pageStorageSha256`,
`pageDigest`, and `canonicalByteLength`. An update writes/reads the unreferenced
slot, then CASes/reads the head. A slot referenced by the current head is never
overwritten, and abandoned inactive bytes are bounded by the fixed two-bank
layout. Page self-digests and head digests use their exact
`artifact-directory` format domains. Entry/page/head counts use the profile's
artifact-directory limits; each page uses the 1 MiB control cap, and the head
uses its dedicated 16 MiB byte cap plus 100,000-node cap.

Each fixed artifact-registration slot contains one closed
`RealmAdmissionArtifactRegistrationOperationStorageV1`. Every variant contains
exactly this header: `format`, `version`, `operatorPartitionId`, `slotIndex`,
`operationGeneration`, and `state`. The format is
`particle-realms.realm-admission-artifact-registration-operation-storage` and
the version is `1`. The four live-operation variants additionally contain
exactly `registrationOperationId`, `blobContentId`, `canonicalByteLength`,
`producerClass`, `expectedDirectoryGeneration`,
`expectedDirectoryHeadStorageSha256?`, `previousSlotStorageSha256?`, `createdAt`,
and `updatedAt`. Their exact additional-field matrix is:

```text
planned:             no additional fields
blob-published:      plannedStorageSha256, verifiedBlobContentId,
                     verifiedBlobByteLength
directory-published: verifiedBlobContentId, verifiedBlobByteLength,
                     resultingDirectoryGeneration,
                     resultingDirectoryHeadStorageSha256,
                     blobPublishedStorageSha256
reclaiming:          verifiedBlobContentId, verifiedBlobByteLength,
                     resultingDirectoryGeneration,
                     resultingDirectoryHeadStorageSha256,
                     blobPublishedStorageSha256,
                     directoryPublishedStorageSha256,
                     terminalOperationDigest
```

`clean-vacant` contains the six-field header plus exactly
`previousRegistrationOperationId`, `terminalOutcome`,
`terminalOperationDigest`, `terminalPredecessorStorageSha256`, and `reclaimedAt`;
it forbids the live-operation block. `terminalOutcome` is exactly `no-effect`
or `registered`. No variant accepts an unlisted or inherited field.

The terminal digest is computed over one exact internal
`RealmAdmissionArtifactRegistrationTerminalV1` projection containing `format`,
`version`, `operatorPartitionId`, `slotIndex`, `operationGeneration`,
`registrationOperationId`, `blobContentId`, `canonicalByteLength`,
`producerClass`, `expectedDirectoryGeneration`,
`expectedDirectoryHeadStorageSha256?`, `previousSlotStorageSha256?`,
`terminalOutcome`, `terminalAuthorityStorageSha256`, optional
`verifiedBlobContentId`, optional `verifiedBlobByteLength`, optional
`resultingDirectoryGeneration`, optional
`resultingDirectoryHeadStorageSha256`, and `terminalOperationDigest`. Its format
is `particle-realms.realm-admission-artifact-registration-terminal`, its version
is `1`, and `computeRealmContentId()` excludes only
`terminalOperationDigest`. The four optional result fields are all absent for
`no-effect` and all required for `registered`. `verifiedBlobContentId` and
`verifiedBlobByteLength` equal the immutable operation's `blobContentId` and
`canonicalByteLength`; they bind the exact content-port readback without
inventing a physical storage SHA.

For an absent initial artifact-directory head, the expected generation is zero
and the expected head SHA is absent; the proposed first head has generation one
and no previous-head SHA. Every mutating update requires an exact nonzero
expected generation/head SHA, sets the proposed generation to exactly expected
plus one, and copies that expected SHA into the proposed head's
`previousHeadStorageSha256`. An already exact row is a nonmutating registered
result whose resulting generation/SHA equal that expected head. The journal
freezes blob ID, length, producer class, exact directory predecessor, and
service-generated operation ID before content write. Every state or
directory-head change is an exact-SHA CAS plus readback.

`operationGeneration` is positive uint64 decimal text, is one for an initially
missing slot, and is exactly the prior clean-vacant generation plus one on reuse.
`previousSlotStorageSha256` is absent only for generation one and otherwise
equals the exact clean-vacant predecessor SHA. Every named state SHA equals the
exact immediately preceding state bytes. The legal journal graph is
`missing|clean-vacant -> planned -> blob-published -> directory-published ->
reclaiming -> clean-vacant`, plus `planned -> clean-vacant` only for proven
`no-effect`; no other edge exists.

Recovery accepts only these observations: `planned` plus absent blob and the
exact directory predecessor produces `no-effect`; exact blob bytes advance to
`blob-published`; `blob-published` plus the exact predecessor and absent row
re-dispatches only the deterministic directory update for this operation; and
an exact current directory row for that blob/length/class advances to
`directory-published`. The exact resulting directory head plus row then permits
`reclaiming` and `clean-vacant`. For `no-effect`,
`terminalAuthorityStorageSha256` and the clean record's
`terminalPredecessorStorageSha256` both equal the exact `planned` bytes. For
`registered`, terminal authority is the exact `directory-published` bytes and
the clean predecessor is the exact `reclaiming` bytes. A different blob, length,
class, generation, head SHA, row, or malformed record is unresolved. Reclaiming
never removes the artifact row or blob. Every service instance reads and
reconciles all 64 slots under the shared maintenance fence before any later
artifact-directory generation may advance. It applies
`maximumAdmissionControlRecordBytes = 1048576` per record and the exact product
of `maximumAdmissionArtifactRegistrationSlots = 64` and that cap, `67108864`,
as its aggregate ceiling, then chooses a missing/`clean-vacant`
slot by lowest `operationGeneration` (missing is zero), then lowest index. No
65th slot or operation-ID path exists.
A producer does not return success until exact blob and directory-row readback
both succeed. Existing pre-directory content requires one complete bounded
backfill and byte verification before collection is enabled; a physical listing
is migration input only and never runtime GC authority.

Provisioned evidence is a separate authority class. The evidence service adds
the fixed `/directory/head.json`, 64 fixed registration journals, and 4,096
two-bank page pairs to its allowlist.
`RealmAdmissionEvidenceBindingDirectoryHeadStorageV1` has exactly `format`,
`version`, `operatorPartitionId`, `generation`, `pageEntryLimit`, `entryCount`,
`pages`, `evidenceBindingSetDigest`, `previousHeadStorageSha256?`, and
`updatedAt`. Each page descriptor has exactly `pageIndex`, `pageSlot`,
`firstSortKey`, `lastSortKey`, `entryCount`, `pageStorageSha256`, `pageDigest`,
and `canonicalByteLength`. `pageSlot` is exactly `a` or `b`.

`RealmAdmissionEvidenceBindingDirectoryPageStorageV1` is a protected control
record with exactly `format`, `version`, `pageIndex`, `entries`, and
`pageDigest`. Each logical index alternates its two fixed slots: an update
writes/reads the unreferenced page, then exact-SHA CASes and reads the head; a
slot named by the current head is never overwritten. Pages fit the ordinary
1 MiB control cap, while the exact head alone uses
`maximumAdmissionEvidenceDirectoryHeadBytes = 16777216`; both retain the
100,000-node canonical preflight. Page/head counts use the profile's evidence
directory limits. Digests use
`particle-realms.realm-admission-evidence-binding-directory-page-storage` and
`particle-realms.realm-admission-evidence-binding-directory-head-storage`,
version `1`, excluding only the named self digest plus head chronology. This
fixed-page scheme prevents evidence-directory metadata from recursively
registering itself as an artifact candidate.

The pages have exactly two entry variants:

```text
evidence binding:
  entryKind = evidence
  realmId
  evidenceKind
  evidenceId
  bindingStorageSha256

signature binding:
  entryKind = signature
  realmId
  envelopeId
  bindingStorageSha256
```

Their sort keys include every displayed identity field. Descriptor boundaries,
counts, page/head digests, exact bytes, strict order, gaps, overlap, and duplicate
tuples are all revalidated before the head is authority. Provisioning registers
and reads back the row before returning. During collection, every registered
binding is read under its exact SHA and roots its payload blob. A missing,
malformed, unreadable, unindexed, or contradictory binding aborts the entire
pass. Evidence/signature payloads are categorically ineligible until this
directory, its historical backfill, and its mutation recovery are certified.
Deduplication never weakens the rule: one blob ID reachable from any admission,
evidence, signature, root, or current metadata authority is retained.

Each evidence registration journal is one closed
`RealmAdmissionEvidenceBindingRegistrationOperationStorageV1`. Every variant
contains exactly `format`, `version`, `operatorPartitionId`, `slotIndex`,
`operationGeneration`, and `state`. Its format is
`particle-realms.realm-admission-evidence-binding-registration-operation-storage`
and its version is `1`. The live-operation variants additionally contain
exactly `registrationOperationId`, `entryKind`, `realmId`, `bindingIdentity`,
`bindingStorageSha256`, `expectedDirectoryGeneration`,
`expectedDirectoryHeadStorageSha256?`, `previousSlotStorageSha256?`, `createdAt`,
and `updatedAt`. `bindingIdentity` is exactly `[evidenceKind, evidenceId]` for
`evidence` and `[envelopeId]` for `signature`. Their exact additions are:

```text
planned:             no additional fields
binding-published:   plannedStorageSha256, observedBindingStorageSha256
directory-published: observedBindingStorageSha256,
                     resultingDirectoryGeneration,
                     resultingDirectoryHeadStorageSha256,
                     bindingPublishedStorageSha256
reclaiming:          observedBindingStorageSha256,
                     resultingDirectoryGeneration,
                     resultingDirectoryHeadStorageSha256,
                     bindingPublishedStorageSha256,
                     directoryPublishedStorageSha256,
                     terminalOperationDigest
```

`clean-vacant` contains only the six-field header plus
`previousRegistrationOperationId`, `terminalOutcome`,
`terminalOperationDigest`, `terminalPredecessorStorageSha256`, and `reclaimedAt`.
`terminalOutcome` is exactly `no-effect` or `registered`; live-operation fields
are forbidden. The exact `RealmAdmissionEvidenceBindingRegistrationTerminalV1`
digest projection contains exactly:

```text
format = particle-realms.realm-admission-evidence-binding-registration-terminal
version = 1
operatorPartitionId
slotIndex
operationGeneration
registrationOperationId
entryKind
realmId
bindingIdentity
bindingStorageSha256
expectedDirectoryGeneration
expectedDirectoryHeadStorageSha256?
previousSlotStorageSha256?
terminalOutcome
terminalAuthorityStorageSha256
observedBindingStorageSha256?
resultingDirectoryGeneration?
resultingDirectoryHeadStorageSha256?
terminalOperationDigest
```

The self digest excludes only `terminalOperationDigest`.
The three optional result fields are all absent for `no-effect` and all required
for `registered`.

Initial, mutating, and already-exact evidence-directory results use the same
zero/absent, generation-plus-one/previous-head-SHA, and nonmutating-current-head
rules as artifact registration. The only legal graph is
`missing|clean-vacant -> planned -> binding-published -> directory-published ->
reclaiming -> clean-vacant`, plus `planned -> clean-vacant` for proven
`no-effect`. For no effect, terminal authority and the clean predecessor are
the exact planned bytes; for registered, terminal authority is the exact
directory-published bytes and the clean predecessor is the exact reclaiming
bytes. Journal `operationGeneration`, prior-slot SHA, immediate-state SHAs,
deterministic slot choice, and the exact
`maximumAdmissionControlRecordBytes = 1048576`,
`maximumAdmissionEvidenceRegistrationSlots = 64`, and
`maximumAdmissionEvidenceRegistrationJournalAggregateBytes = 67108864`
ceilings otherwise use the same exact rules with the evidence terminal format
domain. Provisioning freezes
and reads `planned` before the absent-only binding write, reads the binding under
`bindingStorageSha256`, publishes and reads the exact sorted directory row, and
only then records `directory-published`. Recovery advances only across these
observations: `planned` plus an absent binding and exact predecessor produces
`no-effect`; an exact binding advances to `binding-published`;
`binding-published` plus the exact predecessor and absent row re-dispatches only
this operation's deterministic directory update; and the exact row/head advances
to `directory-published`, `reclaiming`, then `clean-vacant`. A wrong binding,
row, generation, SHA, identity, or third head is unresolved. Reclaiming never removes the immutable binding or directory
row. Every evidence-service instance reconciles all 64 slots under the shared
admission maintenance fence before a later evidence-directory generation or new
provisioning operation may advance. No listing, blind retry, unbounded journal,
or operation-ID path is permitted.

One internal `RealmArtifactDirectoryMutationArbiter` runs at the start of every
shared-maintenance interval that may mutate the artifact directory. It reads the
exact `/gc/run.json` and all 64 artifact-registration slots before admitting a
new registration, GC run, or row removal. Every live registration is reconciled
first. A `candidate` or `mutating` GC run is resumed to exact `complete` before
any producer may advance the directory; a new collector likewise reconciles all
registrations before it creates a run. The arbiter accepts the already-held
branded maintenance fence and never reacquires it. All service entry points use
this one ordering, including admission staging and evidence provisioning. A
crash cannot therefore let a registration and GC recovery independently advance
the same predecessor head.

Candidates are deterministic bounded batches over one exact artifact-directory
snapshot, never an inferred capped list. Each sweep has positive uint64
`sweepGeneration`. If the prior complete run used the same artifact-directory
generation and `scanReachedEnd = false`, the next run preserves that sweep
generation and scans strictly after `nextArtifactCursorExclusive`. If the
directory generation changed, no predecessor exists, or the prior deletion set
has `scanReachedEnd = true`, the next run increments the prior sweep generation
(or starts at one) and restarts at the first blob ID with no start-after cursor.
Thus a completed unchanged-directory sweep always rolls over; later root/pin/
admission liveness changes can make an earlier blob collectible even when no
artifact row changed. The collector records every scanned entry through the last
selected or last examined ID and selects at most
`maximumAdmissionGcCandidateEntries`. A later run continues from the recorded
cursor only inside the same unfinished sweep, so more than 65,536 unreachable
blobs are processed across independently revalidated batches. No batch claims a
complete sweep unless it reaches the directory's final entry.

Candidate and progress data use fixed two-bank control chunks rather than
self-referential content blobs. `RealmAdmissionGcDeletionSetChunkStorageV1`
contains exactly `format`, `version`, `gcRunId`, `chunkIndex`, `entries`, and
`chunkDigest`; entries are strictly sorted unique
`{ candidateIndex, blobContentId, expectedByteLength }` rows. Each run's
`RealmAdmissionGcDeletionSetRootV1` is embedded in `/gc/run.json` and contains
exactly `format`, `version`, `gcRunId`, `sweepGeneration`, `entryCount`, `chunks`,
`scanStartAfterBlobContentId?`, `scanEndBlobContentId?`, `scanReachedEnd`, and
`deletionSetDigest`. Each chunk descriptor has exactly `chunkIndex`,
`chunkSlot`, `entryCount`, `firstCandidateIndex`, `lastCandidateIndex`,
`storageSha256`, `chunkDigest`, and `canonicalByteLength`.

`RealmAdmissionGcProgressChunkStorageV1` has the same fixed index/two-bank
shape and at most `maximumAdmissionGcProgressChunkEntries` rows. Each row is one
closed state variant over the immutable candidate tuple:

```text
candidate
quarantine-dispatched + quarantineOperationId
quarantined + quarantineOperationId + quarantineReceiptDigest
delete-dispatched + quarantineOperationId + quarantineReceiptDigest + deleteOperationId
blob-deleted + quarantineOperationId + quarantineReceiptDigest + deleteOperationId + deletionReceiptDigest
directory-removal-dispatched + all blob-deleted fields
  + directoryRemovalOperationId + expectedArtifactDirectoryGeneration
  + expectedArtifactDirectoryHeadStorageSha256
  + proposedArtifactDirectoryGeneration
  + proposedArtifactDirectoryHeadStorageSha256
retired + all directory-removal-dispatched fields
  + resultingArtifactDirectoryGeneration
  + resultingArtifactDirectoryHeadStorageSha256
```

The proposed removal generation is exactly expected generation plus one, its
exact head SHA is frozen before dispatch, and the removal proposal names the
expected head SHA as its previous-head SHA. It
removes only the exact row for the already authoritatively missing blob. The
blob is not a completed candidate while its artifact-directory row remains.
Candidates mutate in ascending `candidateIndex` order. After `blob-deleted`,
maintenance writes/reads `directory-removal-dispatched`, CASes and reads the
next artifact-directory head without that row, then records `retired` before
starting the next candidate. A crash with a missing blob and still-present exact
row resumes that same removal operation; while its dispatch is unresolved, only
the exact recorded predecessor or exact recorded proposal head is legal. Later
directory mutation is forbidden by the shared arbiter below. Once a row is
`retired`, later same-run removals form a durable contiguous chain in which each
next progress row's expected generation/SHA equals the preceding retired row's
resulting generation/SHA. Any unrelated mutation, broken chain, or missing
dispatch remains unresolved and aborts the run.

The embedded `RealmAdmissionGcProgressRootV1` contains exactly `format`,
`version`, `gcRunId`, `entryCount`, `chunks`, `completedEntryCount`, and
`progressDigest`. A progress transition writes/reads the inactive chunk slot,
then exact-SHA CASes and reads `/gc/run.json`; a currently referenced chunk slot
is never overwritten.

`RealmAdmissionGcRunStorageV1` at `/gc/run.json` has exactly `format`,
`version`, `operatorPartitionId`, `generation`, `gcRunId`, `state`,
`sweepGeneration`,
`rootDirectoryGeneration`, `rootDirectoryHeadStorageSha256`,
`artifactDirectoryGeneration`, `artifactDirectoryHeadStorageSha256`,
`evidenceDirectoryGeneration`, `evidenceDirectoryHeadStorageSha256`,
`rootSnapshotDigest`, `deletionSet`, `progressRoot`,
`nextArtifactCursorExclusive?`, `previousRunStorageSha256?`, and `updatedAt`.
State is exactly `candidate`, `mutating`, or `complete`. All digests use their
exact format domains and exclude only their named self-digest fields plus run
chronology where declared.

Run generations are positive uint64 decimal text. Missing may CAS only to the
first `candidate` at generation one with no `previousRunStorageSha256`.
Thereafter only an exact read-back `complete` run may CAS to a new service-issued
`gcRunId` in `candidate` at prior generation plus one, with
`previousRunStorageSha256` equal to the exact complete predecessor. The complete
legal graph is `missing|complete -> candidate -> mutating -> complete`; a
candidate or mutating run must be recovered and cannot be replaced.
The run's `sweepGeneration` must equal its deletion set's value. A continuation
requires the exact predecessor's unfinished sweep, directory generation, end
cursor, and SHA; a rollover requires absent `scanStartAfterBlobContentId`, the
next sweep generation, and either changed directory generation or predecessor
`scanReachedEnd = true`. No completed cursor can be reused as an endless
same-generation start-after position.

Before the new-run CAS, every required deletion-set and progress chunk is
written/read in the bank opposite the exact predecessor run's descriptor for
that chunk index; an index absent from the predecessor starts in bank `a`.
Those inactive writes have no authority until `/gc/run.json` names them. CAS
no-effect leaves the prior complete run authoritative and the inactive banks may
be overwritten by the next exact attempt. CAS success makes the new descriptors
authoritative and permits the banks no longer referenced by the new run to be
reused on the following generation. No chunk listing or third bank exists.

The run-state requirements and storage-observation transitions are closed:

| Durable progress state | Exact observation | Only permitted action |
| --- | --- | --- |
| `candidate` | Original exact blob and exact artifact row | Persist `quarantine-dispatched`, then dispatch once |
| `candidate` | Quarantined, missing, wrong bytes, or wrong/missing row | Abort unresolved; no inferred prior dispatch |
| `quarantine-dispatched` | Original exact blob | Re-dispatch `quarantineIfExact()` only with the same operation ID |
| `quarantine-dispatched` | Exact scoped quarantine | Record `quarantined` with its receipt digest |
| `quarantine-dispatched` | Missing or third state | Abort unresolved |
| `quarantined` | Exact scoped quarantine | Persist `delete-dispatched`, then dispatch once |
| `quarantined` | Original, missing, or third state | Abort unresolved |
| `delete-dispatched` | Exact scoped quarantine | Re-dispatch `deleteQuarantinedIfExact()` only with the same operation ID |
| `delete-dispatched` | Authoritatively missing after that exact dispatch | Record `blob-deleted` with the reconciled deletion receipt |
| `delete-dispatched` | Original or third state | Abort unresolved |
| `blob-deleted` | Blob missing and exact artifact row present | Persist `directory-removal-dispatched`; dispatch its exact head CAS |
| `directory-removal-dispatched` | Exact predecessor head and row present | Re-dispatch only the proposal with the recorded generation and exact head SHA |
| `directory-removal-dispatched` | Exact recorded proposal head and row absent | Record `retired` with that proposal generation/SHA |
| `directory-removal-dispatched` | Any other head, lineage, row, or blob state | Abort unresolved |
| `retired` | Blob missing, row absent, and its result joins the exact same-run expected→result chain | Count the candidate complete |

`candidate` run state requires a fully verified frozen root/evidence/artifact
snapshot, a complete deletion set, progress rows all at `candidate`, and zero
mutation-dispatched row. The run CASes to `mutating` and is read back before the
first `quarantine-dispatched` transition. `mutating` requires the frozen
snapshot/deletion-set digests to remain unchanged and every progress row to be
one of the exact states above. `complete` requires every row to be `retired`,
`progressRoot.completedEntryCount = deletionSet.entryCount`, every blob authoritatively
missing, every corresponding artifact row absent through verified directory
lineage recorded by the ascending retired progress rows, and
`nextArtifactCursorExclusive` equal the recorded scan end. An empty
deletion set may move directly from `candidate` to `complete` only after the
same directory/current-authority recheck. No other state transition, operation
ID replacement, receipt substitution, or re-dispatch is legal.

Future collection also requires one narrow, non-app
`RealmArtifactGarbageCollectionPort@1` over the service-scoped content store:

```javascript
quarantineIfExact({
    blobContentId,
    expectedByteLength,
    gcRunId,
    candidateIndex,
    quarantineOperationId,
    signal,
})
observeQuarantine({
    blobContentId,
    expectedByteLength,
    gcRunId,
    candidateIndex,
    quarantineOperationId,
    expectedQuarantineReceiptDigest = null,
    deleteOperationId = null,
    signal,
})
deleteQuarantinedIfExact({
    blobContentId,
    gcRunId,
    candidateIndex,
    expectedQuarantineReceiptDigest,
    deleteOperationId,
    signal,
})
```

Each method stat-checks before read/allocation and returns a closed exact
observation of original, quarantined, or authoritatively missing bytes plus a
scope-bound receipt digest. When `deleteOperationId` is supplied, both it and
`expectedQuarantineReceiptDigest` are required and must equal the durable
`delete-dispatched` row. Authoritatively missing then returns one deterministic
`deletionReceiptDigest` over exactly `format`, `version`,
`operatorPartitionId`, `blobContentId`, `expectedByteLength`, `gcRunId`,
`candidateIndex`, `quarantineOperationId`, `quarantineReceiptDigest`,
`deleteOperationId`, `outcome = authoritatively-missing`, and
`deletionReceiptDigest`. The format/domain is
`particle-realms.realm-artifact-gc-deletion-observation`, version `1`, and only
the digest field is excluded. This receipt proves exact post-dispatch absence in
the protected namespace; it does not claim that a particular backend call ran.
Before each backend mutation, the corresponding
dispatched progress row is durable. Recovery accepts only exact original bytes,
the exact quarantine receipt/location, or missing quarantine after an exact
delete-dispatched row; any third state aborts the run. There is no generic
content delete, caller path, trash, version history, or blind retry.

The collector holds maintenance, reads the complete root, artifact, and
evidence-binding directory snapshots, all 64 fixed
pending/intent/proposal/dispatch/retry/result/terminal bundles, every pending
proposal, every registered current head, every prepared/active durable root,
and every provisioned evidence/signature binding. Before snapshot acceptance it
completes every exact released/abandoned terminal cleanup; an unresolved
terminal root or manager journal aborts the pass. It also roots the current
root-directory page blobs; artifact-directory pages, evidence-directory pages,
and GC journal pages are fixed protected control files and never enter the
candidate namespace. It aborts the entire pass on any
missing, malformed, unreadable, oversized, hash-mismatched, incomplete page,
contradictory control record, unregistered producer blob, `reclaiming` slot, or
unresolved manager journal.

The maintenance timing proof is exact: the snapshot marks the current M2 head
and every pending proposal. A concurrent selection CAS may replace that head
after observation, but the old observed head is already marked and the proposal
is also marked; pending cannot vacate until maintenance releases. If the
proposal was already current, its predecessor is not retained unless another
pin names it. Before the first quarantine dispatch, the collector writes/reads
the candidate/progress/run controls and rechecks every directory head, current
authority, pending bundle, and metadata root byte for byte. Protected artifacts
enter only service-private quarantine and require the exact progress/receipt
state machine above.

Collection is not part of the first M2B acceptance slice. It cannot ship until
the root/artifact/evidence directories and their historical backfills, every
registration and manager journal, deterministic batch cursor, fixed
candidate/progress controls, narrow quarantine/delete port, exact receipts,
every root producer, and all fail-closed recovery vectors above are implemented
and certified. A direct app root, unfenced pin, incomplete directory, unbounded
walk, unregistered producer blob, or skipped corrupt root fails certification.

Rollback always uses a fresh service-owned operation, pending slot, intent,
dispatch/retry markers, result, and admission-head generation. Directly
reselecting an older immutable index is permitted only when all of these still
match exactly: its index-bound M1 scope/root/generation/storage SHA equals the
current protected M1 head; its admission-policy revision/digest remains current
and its runtime profile ID/digest equals the same immutable registered profile;
its complete signature/evidence trust closure
is currently authorized; and bounded recursive rehydration reproduces the same
index/package bytes. The normal transaction then protects that old graph through
the pending root before its new head CAS.

If any M1 binding differs, rollback cannot point the head at the old index. An
authorized workflow must first perform a new protected M1 publication/reselection
that produces a new M1 head generation and exact storage SHA, then perform a new
complete M2 admission whose newly built index binds that current M1 head, policy,
profile, and trust state. Existing immutable payloads may deduplicate by exact
blob ID, but the old index is never rewritten. Historical policy or signatures
never regain authority merely because their bytes still exist.

## Implementation and reserved module map

Only the evidence-provisioning, protected-publication, durable-admission,
index/load/read, and boundary modules exercised by the accepted suites below
belong to the accepted M2B slice. Rows that describe activation, runtime pins,
checkpoints, handoff, collection directories, quarantine, or deletion are
reserved continuations. Their schemas or source files do not make those later
authorities active or accepted.

| Module | Responsibility |
| --- | --- |
| `webgpu-os/apps/the-virtual-realm/runtime-contracts/RealmPrivateBakeAdmissionIndexContract.js` | Exact M2 index schema and semantic invariants |
| `webgpu-os/apps/the-virtual-realm/runtime-contracts/VirtualRealmM2RuntimeContractCatalog.js` | Separate 11-definition ordered catalog over the existing registry |
| `webgpu-os/kernel/OperatorPrivateServiceStorageView.js` | Kernel-only account/service roots, exact control allowlists, bounded reads/observations/conditional deletes, generation checks, protected receipts, and the maintenance fence |
| `webgpu-os/storage/StorageManager.js` | Add branded service-root binding plus bounded stat-first read/observe/list adapters, reuse exact-SHA permanent deletion, and enforce non-versioned protected paths across every mutation/restore route |
| `webgpu-os/storage/RealmContentStore.js` | Add the private service-scoped factory and bounded cancellable raw exact-byte put/get without changing `/user` legacy blob APIs; future GC adds only the narrow exact quarantine/observe/delete adapter after directory certification |
| `webgpu-os/kernel/realm/RealmAdmissionPackageIndexCodec.js` | Strict package, admission-index, binding-inventory root/chunk, canonical-byte, semantic-digest, exact-key, and graph-limit validation only |
| `webgpu-os/kernel/realm/RealmAdmissionOperationControlCodec.js` | Exact M1/M2 head, pending, terminal-audit, intent, proposal, dispatch, retry, result, slot-vacancy, equality-matrix, and operation-recovery bytes only |
| `webgpu-os/kernel/realm/RealmAdmissionPolicyCodec.js` | Exact admission-policy storage record, generation/digest/SHA lineage, and closed semantic validation only |
| `webgpu-os/kernel/realm/RealmSignatureTrustPolicyCodec.js` | Exact Realm-scoped trust-policy/key/role/revocation storage bytes and lineage only |
| `webgpu-os/kernel/realm/RealmAdmissionEvidenceBindingCodec.js` | Four-kind evidence, immutable evidence-policy, authenticated binding, signature-binding, and terminal receipt projections only |
| `webgpu-os/kernel/realm/RealmAdmissionRootControlCodec.js` | Kind-bound durable-root payloads, prepared/active/abandoned/released variants, owner-manager journals, runtime-pin manager descendants, and successor-retirement receipts only |
| `webgpu-os/kernel/realm/RealmRuntimeContinuityCodec.js` | Checkpoint source projection/authorization/lease-release and teardown-abort receipts, static checkpoint record/binding/head/tombstone, two fixed durable handoff-authorization cells, checkpoint graph edge, handoff claim/settlement/edge-release receipts, handoff record/head/tombstone, and canonical vectors only |
| `webgpu-os/kernel/realm/RealmAdmissionRootDirectoryCodec.js` | Root-directory head/page records, exact entry ordering, CAS projection, and directory limits only |
| `webgpu-os/kernel/realm/RealmAdmissionArtifactDirectoryCodec.js` | Artifact-directory head/page and registration-journal records, terminal projections, ordering, and limits only |
| `webgpu-os/kernel/realm/RealmAdmissionEvidenceDirectoryCodec.js` | Evidence-directory head/page and registration-journal records, terminal projections, ordering, and limits only |
| `webgpu-os/kernel/realm/RealmAdmissionGarbageCollectionCodec.js` | GC run, candidate, progress, quarantine, deletion-observation, removal-proposal, and retirement records only |
| `webgpu-os/kernel/realm/RealmPrivateBakeActivationCodec.js` | Active-bake-CSE binding receipt and service-owned CSE assertion projection, trusted-clock observation/head, immediate-liveness/time decisions, publication/admission/verified-graph projections, activation assertion, durable visible-commit receipt, live-visibility receipt, cross-session activation-claim/settlement/displacement receipts, staged-candidate close, candidate-abort, CSE-integrity quarantine, active-close, bundle-supersession receipts, domains, and canonical vectors only |
| `webgpu-os/kernel/realm/RealmAdmissionSelectionCoordinator.js` | Shared operator/private-Realm same-origin selection fence used by every M1-head, M2-policy, signature-trust, M2-head, rollback, and activation-authority writer/assertion |
| `webgpu-os/kernel/realm/RealmAdmissionPolicyStorageAdapter.js` | Read/reassert current policy and own its separate authorized fenced CAS writer without exposing policy authority to an app |
| `webgpu-os/kernel/realm/RealmAdmissionEvidencePolicyRegistry.js` | Resolve immutable evidence-policy ID/digest/object triples, reviewer identities, invariant sets, provisioner roles, and four-kind validator rules |
| `webgpu-os/kernel/realm/RealmSignatureTrustPolicyStorageAdapter.js` | Own the one bounded Realm-scoped Ed25519 key/role/revocation policy, verify SPKI fingerprints, and perform every authorized generation/SHA-fenced replacement |
| `webgpu-os/kernel/realm/RealmRuntimeCapabilityProfileRegistry.js` | Resolve only immutable code-shipped profile ID/digest/object triples; no dynamic writer or ambient profile substitution |
| `webgpu-os/kernel/realm/RealmPrivatePublicationHeadStorageAdapter.js` | Exact protected V2 path/codec, generation lineage, storage-SHA observation, selection-fenced CAS, and legacy-manifest observation |
| `webgpu-os/kernel/realm/RealmPrivateBakeAdmissionService.js` | Trusted ports, transaction, readback, head CAS, restart, intent recovery, rollback, and read-only app face |
| `webgpu-os/kernel/realm/RealmPrivateBakeActivationGuard.js` | Prepare exact eligibility proofs, exact-validate and self-digest only the service-owned offered-candidate CSE assertion projection without claiming access to hidden CSE preimages, reassert head/admission/evidence/trust/profile closure under the activation service's retained selection fence, and expose the sole narrow synchronous immediate-time method over its private clock port |
| `webgpu-os/kernel/realm/RealmRuntimeActivationService.js` | Own one operator/Realm visible pointer plus bounded per-process-owner candidate/current/disposal slots, monotonic process-local receipt sequences, and prebound `runtimeActivationPort@1` views; coordinate only narrow guard, runtime-pin, process-owner-child, active-bake-CSE, pointer/gate, work-status, operator-generation-observation, lifecycle-retirement-observation, secure-random, and cross-session handoff-binding ports; build the closed offered-candidate CSE assertion projection from its transferred slot and current pointer under selection, preallocate/fill activation slots, distinguish same-owner disposal transfer from cross-session retained ownership, and never construct a concrete peer |
| `webgpu-os/kernel/realm/RealmSecureRandomPortAdapter.js` | Kernel-only `secureRandomPort@1.issueHex256({ purpose })` over host CSPRNG with exact purpose allowlist `activation-preparation`, `checkpoint-preparation`, and `checkpoint-handoff-authorization`; no ambient fallback, raw-byte escape, app exposure, clock, key, or storage authority |
| `webgpu-os/kernel/realm/RealmTrustedActivationClockStorageAdapter.js` | Kernel-only nondecreasing activation-time observation, exact protected high-water-head CAS/readback, restart recovery, and sanitized internal receipts |
| `webgpu-os/kernel/realm/RealmAdmissionEvidenceResolver.js` | Bounded role-derived evidence-tuple, station-kit, Storylet-policy, signature-envelope, and verify-key resolution inside the operator partition |
| `webgpu-os/kernel/realm/RealmAdmissionEvidenceProvisioningService.js` | Authenticated manager/reviewer, policy-bound, absent-only validation/import of exact evidence and signature bytes plus deterministic Realm-scoped lookup bindings |
| `webgpu-os/kernel/realm/RealmPrivateBakeProvisioningCoordinator.js` | Package-derived, fail-closed material preflight and authorized provisioning before publication; the injected material source and review capability never cross either returned composition face |
| `webgpu-os/kernel/realm/RealmAuthoringReviewAuthorityAdapter.js` | Consume single-use review authority and return only exact reviewer/policy/catalog/invariant bindings to provisioning |
| `webgpu-os/kernel/realm/RealmAdmissionArtifactDirectoryService.js` | Future fixed-page, journaled, snapshot-stable enumeration of every service content blob and producer class |
| `webgpu-os/kernel/realm/RealmAdmissionArtifactDirectoryMutationArbiter.js` | Reconcile the active GC run and every artifact-registration slot before serializing any artifact-directory head mutation |
| `webgpu-os/kernel/realm/RealmAdmissionEvidenceBindingDirectoryService.js` | Future bounded directory over every immutable evidence/signature binding and payload root |
| `webgpu-os/kernel/realm/RealmAdmissionRootLeaseService.js` | Realm-scoped prepared/active/abandoned/released runtime-pin, checkpoint, and handoff roots with owner-manager journals, target verification, exact observation, and root-directory registration |
| `webgpu-os/kernel/realm/RealmRuntimePinManager.js` | Fixed-slot candidate/visible/retired manager lineage, durable runtime pins, guarded activation receipts, disposal pins, and exact GPU-fence retirement |
| `webgpu-os/kernel/realm/RealmRuntimeCheckpointSourceService.js` | Read-only exact current-active/head/profile/safe-anchor/cursor/local-policy projection plus the narrow activation-selection commit lease and source authorization; no checkpoint store, manager, writer, or app face |
| `webgpu-os/kernel/realm/RealmRuntimeCheckpointManager.js` | Monotonic static-checkpoint head/tombstone authority plus secure-random correlated checkpoint-root preparation, source-lease commit, activation, successor-authorized replacement, the two durable checkpoint-handoff authorization cells and exact binding port, readiness, and retirement |
| `webgpu-os/kernel/realm/RealmRuntimeHandoffOutcomeObserver.js` | Read-only exact fixed handoff-manager/root journals plus protected-head proposal/predecessor/nonpublication reconciliation for a claimed checkpoint edge; no head, root, journal, cell, or app mutation face |
| `webgpu-os/kernel/realm/RealmRuntimeHandoffManager.js` | Monotonic M2A checkpoint-bound handoff head/tombstone authority consuming the exact checkpoint binding port, retaining the protected-edge root payload, activation, successor-authorized replacement, readiness, clear, retirement, pre-dispatch nonpublication recovery, and the service-only cross-session activation-claim/settlement lease |
| `webgpu-os/kernel/realm/RealmAdmissionGarbageCollector.js` | Future gated directory snapshots, deterministic batched candidate/progress controls, fail-closed quarantine observation, and exact deletion receipts; absent from initial M2B runtime |
| `webgpu-os/kernel/realm/RealmM1PackageAdmissionAdapter.js` | Existing M1C verifier plus trusted evidence/signature composition |
| `webgpu-os/kernel/realm/RealmM2PrivateBakeAdmissionComposition.js` | Production M2B composition root returning exactly the closed RealmForge write face and read-only Virtual Realm admission face |
| `webgpu-os/apps/realmforge/virtual-realm/publication/RealmSignatureClosureVerifier.js` | One extracted private/public exact-set and cryptographic verification algorithm |
| `webgpu-os/apps/realmforge/virtual-realm/publication/RealmM2PrivateBakeAdmissionClient.js` | Explicit authorized compile/reverify/admit and legacy manifest-only migration client |

These are flat peers wired at their declared composition root. Directory
placement does not create ownership. The app loader does not import the store,
resolver, signature adapter, publication adapter, RealmForge provider, or
migration command. The app-side `RealmRuntimePackageVerifier` and
`RealmStaticBakeLoader` begin in M2C, after this service returns the frozen M2B
handoff; they are not M2B implementation modules.

## Test layout

```text
tests/virtual-realm/
  m2-entry-contract.test.html
  m2-entry-contract.main.js
  m2-entry-contract.test.js
  m2-runtime-composition.test.html
  m2-runtime-composition.main.js
  m2-runtime-composition.test.js
  m2-private-service-storage.test.html
  m2-private-service-storage.main.js
  m2-private-service-storage.test.js
  m2b-admission-codecs.test.html
  m2b-admission-codecs.main.js
  m2b-admission-codecs.test.js
  m2-evidence-provisioning.test.html
  m2-evidence-provisioning.main.js
  m2-evidence-provisioning.test.js
  m2-private-publication-bridge.test.html
  m2-private-publication-bridge.main.js
  m2-private-publication-bridge.test.js
  m2-m1c-admission-handoff.test.html
  m2-m1c-admission-handoff.main.js
  m2-m1c-admission-handoff.test.js
  support/VirtualRealmM2AContractFixtures.js
  support/VirtualRealmM2AdmissionFixtures.js
  fixtures/m2-admission-index-v1-vectors.json
  test_m2_runtime_contract_vectors.py
  test_m2b_app_import_confinement.py
```

`m2-entry-contract` proves the separate 11-definition catalog, exact index
shape and semantics, canonical vectors, and import side effects. It does not
claim durable CAS, migration, cryptographic evidence, or restart rehydration.
The focused storage, codec, provisioning, protected-publication, durable
handoff, and Python import-confinement suites own those claims. Suite names are
the authoritative evidence map; this document does not turn a prose row into a
passing test or freeze a transient aggregate count.

### Full requirement ledger and current acceptance split

The 32 rows below remain the decision-complete full-program requirement ledger.
The accepted admission-only slice implements the evidence-provisioning,
protected-publication, durable admission/index, restart load/read, isolation,
and inert-Storylet assertions exercised by the focused suites above. Any clause
about runtime activation, scheduler or evaluator execution, runtime pins,
checkpoint or handoff activation, garbage collection, quarantine deletion, or
Genesis Factory authority remains a later gate even when it shares a row with
an implemented admission assertion.

| Case | Required assertion |
| --- | --- |
| `M2B-01` | Admit one real verified M1C private-v2 package with its exact 17 top-level keys |
| `M2B-02` | Freeze the accepted package, index, summaries, heads, and returned nested values |
| `M2B-03` | Preserve byte-identical canonical package bytes before write, after readback, and after restart |
| `M2B-04` | Report private-v1 as diagnostic-only and perform zero admission writes |
| `M2B-05` | Reject public-shell and access-refinement packages before content-store or Engine work |
| `M2B-06` | Reject missing, extra, duplicate, malformed, and future package/index fields deterministically |
| `M2B-07` | Produce the same index bytes and semantic digest from identical verified inputs |
| `M2B-08` | Independently recompute `packageBlobContentId` from exact `canonicalRealmBakeText()` bytes and `packageRealmForgeDigest` through `hashRealmForgeJson()`, including `U+E000`/`U+10000` key-order vectors; never assume equality |
| `M2B-09` | Keep Realm semantic content IDs, blob IDs, RealmForge hashes, stable IDs, and logical artifact keys in their own namespaces |
| `M2B-10` | Deterministically longest-prefix chunk, store, and verify resource, authoring-evidence, and signature inventories under exact row/byte/node ceilings plus every exact payload-byte address; private-v2 signature cardinality is exactly four or five |
| `M2B-11` | Resolve every package-member binding and reproduce its semantic ID, digest, byte length, and artifact key |
| `M2B-12` | Resolve the exact reviewed station kit and reviewed-station evidence inside the operator partition under their fixed evidence-kind tuples |
| `M2B-13` | Provision/read back the exact four-kind evidence codec map under the immutable evidence policy, authenticate provisioner/reviewer authority, require the complete Storylet-authoring invariant set, derive every receipt tuple, and reject missing provisioning, self-asserted review, role substitution, ambiguity, overwrite, or cross-Realm lookup |
| `M2B-14` | Apply the closed six-row signature role table and five-role trust map, require the exact four-or-five envelope set, independently bind source record IDs without pretending they are envelope fields, treat signature bytes as terminal, and cryptographically verify preimage, publisher, active key/SPKI fingerprint, algorithm, audience, lifetime, and policy |
| `M2B-15` | Reject missing, substituted, expired, revoked, cross-audience, or invalid evidence/signature material |
| `M2B-16` | Enforce local-only closure and reject remote, Traveler, presence, rendezvous, docking, bridge, public, or refinement injection |
| `M2B-17` | Generate the operation ID inside the trusted service, require both complete caller head expectations before writes, stage/read back the immutable graph plus fixed proposal/intent under maintenance, carry prior terminal generation/SHA, reconcile uncertain slot CAS, verify one fixed pending root, release maintenance, then reacquire selection and recheck that slot/proposal plus absent result/dispatch before head CAS |
| `M2B-18` | Read back and recursively reverify every new or deduplicated immutable blob before head selection; first-hop index/root/proposal reads remain bounded when no parent byte length exists |
| `M2B-19` | Reconstruct the exact package solely from the selected admission graph after process restart, re-observe the exact index-bound M1 head and current policy, and invoke the trusted M1C/evidence/signature verifier exactly once per completed load |
| `M2B-20` | Return `migration-required` for a manifest-only M1 root and perform zero runtime allocation |
| `M2B-21` | Permit migration only through explicit authorized RealmForge recompile, fresh M1C verification, and a complete admission transaction |
| `M2B-22` | Refuse runtime selection when an M1 `bakeId` has no selected, current, complete M2 admission index |
| `M2B-23` | Prove cross-operator reads disclose no protected existence, while generic storage/syscall/content-store reads from any app—including another app under the same operator—disclose no protected head, intent, index, package, evidence, signature, or path; only the authorized narrow `bakeAdmissionPort` may return the exact frozen index/package plus sanitized verification summary and head bindings |
| `M2B-24` | Block partition aliases, raw-Realm paths, generic write/move/copy/delete/trash/restore/version/backup mutation, stale views, and both post-await operator-switch windows |
| `M2B-25` | Mark a selected admission unavailable for missing/corrupt graph bytes; separately keep recovery unresolved for any malformed pending/terminal/intent/proposal/dispatch/retry/result equality, complete fixed-slot cleanup after restart, never require historical intent for a settled selected head, and never fall back to M1 |
| `M2B-26` | Validate generation, semantic digest, exact storage SHA, lifetime limits, immutable evidence-policy object, authenticated reviewer set, five-role publisher map, and lineage for admission/trust; reject incompatible verifier/profile/policy/trust or any currently revoked SPKI without deleting historical bytes, and prove no global revocation path exists |
| `M2B-27` | Under fault injection at pending, terminal-audit, intent, proposal, dispatch, retry, result, head CAS, prior/current audit rotation, vacate, reclaim, and Realm-scoped prepared/active/abandoned/released root boundaries, accept only exact predecessor/proposal observations, preserve pending/root discovery, reconcile owner-manager journals, archive a byte-identical result, and bound controls to 64 fixed slots containing exactly those seven records |
| `M2B-28` | Race a live writer against restart recovery: both claim selection before absent-dispatch terminalization, recheck the exact pending slot/result/dispatch, apply frozen reason precedence, persist at most one retry marker/result, and never dispatch after recovery wins |
| `M2B-29` | Enforce the complete control equality matrix, unique-blob graph accounting, invalid-post-dispatch outcome-unknown rules, and exact cleanup; require admission and activation to use cooperative fences without nesting, and prove checkpoint commit is the sole dual-fence exception with selection-before-maintenance acquisition and reverse release; prove secure-random opaque preparation IDs expose no guard proof and precede every ECS/GPU/audio/input/controller allocation; prove the trusted activation-clock head's exact predecessor/proposal CAS, physical-SHA and semantic-digest lineage, nondecreasing restart recovery, and all activation projection/decision/receipt vectors; maintain exactly zero/one current-active plus at most one candidate and one bounded terminal cell while disposal entries stay terminal/bounded; keep candidate faces off-active; bind first activation to canonical inactive CSE generation zero and replacement to exact `CausalStateActiveBakeRecordV2`; pass and recompute the exact safe prepared-commit receipt, separate acyclic expected swap-receipt digest, next active-record digest, and empty activation outbox, then retain and verify the actual fenced step-8 swap receipt before pointer/gate visibility; race work abort, operator switch, lifecycle retirement, owner release, clock uncertainty/rollback/expiry, and revocation through retained-fence reassertion plus synchronous liveness/time decisions bound to exact `visible-committed` readback; require either denial to perform zero visibility mutation and retire the authorized candidate pin; vector exact staged-close/unregistration, prepared/offered/committing recovery abort, teardown-signal, bounded not-found, lifecycle-retirement-evidence, displacement-integrity, supersession, and CSE-integrity-quarantine receipts; prove public teardown is retirement-only while stale superseded/disposed handles are no-effect; prove same-owner replacement atomically supersedes old gates/child into that owner's disposal ledger and unregisters it only after GPU-fence/resource-disposal proof, while claimed cross-session replacement closes/readbacks the exact predecessor gates, installs the successor, retains the old child/resources/pin under the predecessor owner, and later uses only pointer-preserving retirement cleanup |
| `M2B-30` | Reject M1 head ABA; certify kind-bound durable-root payloads, bounded root/artifact/evidence directories, fixed registration/manager/candidate/progress journals, deterministic continuation plus completed-sweep rollover under an unchanged artifact directory, exact quarantine/delete recovery, and whole-pass abort on any unverified authority; prove an earlier blob is reconsidered when reachability changes after a complete sweep and a handoff payload's protected edge keeps its checkpoint root reachable; keep publication/admission/activation generations independent; bind one live checkpoint preparation to an exact trusted current-active/anchor/policy source projection, hold the narrow activation-selection lease through checkpoint CAS and normal root readiness, distinguish committed from predecessor/source-change abandonment, preissue the single-use handoff authorization, and release replaced checkpoint/handoff roots only through exact successor-active receipts; require the exact claim/verify/settle/release-edge binding-port state machine, including terminal manager-nonpublication plus abandoned-root proof for both post-dispatch predecessor and post-claim/pre-dispatch restoration, block retirement of an edge-retained checkpoint while permitting only one bounded successor cell, accept only a one-field caller draft with service-injected restoration fields, and retain the complete protected edge; preparing/committing/unresolved states reject without slot allocation; and permit direct old-index rollback only under exact current M1/policy/trust/profile equality |
| `M2B-31` | Keep all M1C Storylet records byte-identical and inert with no scheduler, proposal, action, episode, channel, or presentation import |
| `M2B-32` | Audit the production import graph: app receives only `bakeAdmissionPort`; trusted store, resolver, verifier, migration, RealmForge, keys, and raw storage never enter the app bundle |

The browser harness reuses the accepted RealmForge `TestHarness` and the M0
startup-error catcher. The Python command is:

```bash
python -m pytest tests/virtual-realm/test_m2_runtime_contract_vectors.py -q
```

### M2B acceptance gates

This table retains the full end-state gate language. The current acceptance is
limited to evidence provisioning, protected publication selection, durable
admission/index, restart load/read, confinement, and Storylet inertness.
`VR-ADMIT-007` activation behavior and the checkpoint, handoff, directory,
quarantine, deletion, and collection clauses in `VR-ADMIT-012` remain later
work. They are not implied by the accepted admission service.

| Gate | Required proof |
| --- | --- |
| `VR-ADMIT-001` | The M2B admission slice admits exactly the 17-key owner-private M1C package format at version 2; legacy v1 may be diagnostic only, while public, refinement, mixed, unknown, missing, and future shapes fail before allocation |
| `VR-ADMIT-002` | The exact 71-field `RealmPrivateBakeAdmissionIndexV1` binds the operator partition, versioned publication head, complete package artifact, chunked resource/evidence/signature inventory roots, policies, limits, receipts, Storylet/station evidence, verifier/runtime/admission profiles, and its own recomputed digest |
| `VR-ADMIT-003` | A process restart first matches the index-bound M1 scope/root/generation/storage SHA and current admission policy, then reconstructs byte-identical canonical package bytes, independently reproduces its payload blob ID and RealmForge semantic hash, and verifies the same manifest, closure, Storylet catalog, station-kit, and evidence digests without importing RealmForge or reading authoring source |
| `VR-ADMIT-004` | A manifest-only private root produces an explicit migration-required result and zero writes, allocations, ECS entities, GPU objects, audio sources, listeners, pointer locks, or Operations state |
| `VR-ADMIT-005` | Immutable payload bytes are addressed by strong blob ID; semantic resource IDs, Realm content IDs, RealmForge hashes, physical file SHAs, and logical keys retain distinct roles and cannot alias replacement bytes |
| `VR-ADMIT-006` | The four-kind evidence table and immutable evidence policy authenticate provisioner/reviewer authority for every Realm-scoped station/Storylet tuple; the six-row signature table plus five-role trust map yields exactly four or five envelopes and verifies preimage, publisher, audience, lifetime, active Ed25519 SPKI fingerprint, and current Realm trust before admission |
| `VR-ADMIT-007` | M1 publication-root CAS, M2 durable-admission-head CAS, trusted activation-clock high-water CAS, and in-memory runtime-bundle activation have separate generations and receipts; final activation reasserts current admission/evidence/trust/signature/profile closure plus the exact canonical inactive-or-active CSE predecessor, safe prepared empty-outbox commit receipt/digest, separate acyclic expected swap-receipt digest, and next active-record digest under the one required writer fence, readbacks exact durable pin authorization, then makes synchronous bound liveness and immediate-time decisions the first no-await phase before invoking only CSE step 8 and binding its actual swap receipt into live visibility; either denial performs zero visibility mutation and retires the candidate pin, while exact teardown-signal abort/staged-close/terminal/stale-handle receipts stay bounded, committing recovery cannot masquerade as a prepared abort, hostile post-step-8 mismatch quarantines both gate sets without reporting success, and verified success either supersedes an old same-owner bundle through exact gate readback and that owner's disposal ledger or claim-displaces an exact cross-session predecessor while retaining its child/resources/pin under the predecessor owner, so success, failure, conflict, expiry, rollback, operator/lifecycle change, replacement, effect injection, quarantine, or replay in one cannot perform or imply another |
| `VR-ADMIT-008` | Storylet definitions, proposal templates, cues, candidate index, dependency subclosure, and catalog remain byte-identical and inert throughout M2; no scheduler, instance, episode, channel, proposal, action, or presentation is created |
| `VR-ADMIT-009` | The runtime receives the frozen verified package through a narrow port; it receives no RealmForge compiler/provider, evidence-store handle, signing key, generic storage manager, or raw kernel service |
| `VR-ADMIT-010` | Before an authority's dispatch marker, failure preserves that authority; after M1/M2/root dispatch, only exact predecessor/proposal bytes classify outcome. Fixed proposal controls prevent unbounded per-operation blobs; invalid post-dispatch receipts are outcome-unknown, never rejection; no storage outcome alone changes the visible runtime bundle |
| `VR-ADMIT-011` | The trusted service generates operation identity; maintenance protects immutable staging through exact readback of the pending, terminal-audit, intent, proposal, dispatch, retry, and result records in one fixed slot; live writer and recovery recheck controls while holding selection; frozen reason precedence yields one terminal result; prior/current terminal lineage, reclaiming slots, and owner-manager journals bound recovery without blind retry or unbounded history |
| `VR-ADMIT-012` | Kernel-private service roots cannot alias or disclose existence to apps; generic mutation/version/backup restore cannot reach them; kind-bound root payloads, complete checkpoint graph edges, source-lease authorizations, successor-active retirement receipts, Realm-scoped policy/trust generations, and exact SHAs close every continuity and replacement authority interval; bounded root/artifact/evidence directories plus registration/candidate/progress journals and completed-sweep rollover make future collection reconsider changed reachability and abort on every unverified authority; receipts never overstate same-origin coordination |
| `VR-ADMIT-013` | The authoritative M0, Engine-foundation, local-operator, signer, M1A, M1B, M1C, M1C-freeze, M2 contract/vector, and M2B focused suites remain passing with zero skips; their suite reports, not this prose row, own the aggregate counts |

Skipped cases do not satisfy M2B. Browser tests run over HTTP. Python owns the
independent canonical-vector oracle. No Node.js or npm step is introduced.

## M2C handoff

M2B returns exactly:

```text
admissionIndex
verifiedPackage
sanitizedVerificationSummary
publicationHeadBinding
admissionHeadBinding
```

The next loader may build an off-active immutable static store. It receives no
evidence bytes, signature bytes, verification keys, storage writer, migration
capability, RealmForge compiler/provider, or authority token.

The application-side Desktop factory is not given synthetic dependencies to
reach this handoff. Production instantiation waits for the genuine M2C runtime
ports and their own acceptance gates. The M2B composition remains kernel-owned
and exposes only the two faces named in the accepted implementation boundary.

## See also

- [M1C Storylet and reviewed station bake](m1c-storylet-station-bake.md)
- [M2A runtime composition](m2a-runtime-composition.md)
- [M2 runtime foundation](m2-runtime-foundation.md)
- [M2 Engine and ECS foundation](../../engine/virtual-realm-m2-engine-foundation.md)
- [Contract catalog](contracts.md)
- [Security and privacy](security-privacy.md)
- [Certification plan](certification-plan.md)
