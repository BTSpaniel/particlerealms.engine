---
title: Virtual Realm M3A Observation Ingress
description: Exact implementation work package for generation-fenced WebGPU OS observation sources, deterministic ledger admission, bounded recovery, private checkpoints, and the M3A-to-M3B handoff.
audience: WebGPU OS developers, Virtual Realm developers, security reviewers, Engine integrators, and QA engineers
updated: 2026-09-03
status: executable planning blueprint; implementation requires accepted integrated M2; M2A and the admission-only M2B slice are accepted independently but do not constitute integrated M2; RF-GE0-RF-GE5 accepted as inert authoring evidence; RF-GE6 planned
---

# Virtual Realm M3A Observation Ingress

M3A is the first dependency-valid slice of the
[M3 Living City Runtime](m3-living-city-runtime.md). It turns trusted local
WebGPU OS facts into bounded, immutable, owner-private
`RealmObservationContract` records and admits them to one deterministic local
ledger. It does not yet create world deltas, mutate ECS state, render activity,
run Storylets, reveal Code Matter, or activate a new bake.

This page is the normative M3A work package. The M3 overview remains the
whole-milestone map; when the two differ on M3A details, this page controls.

## Acceptance boundary

M3A is accepted only when all of the following are true:

1. An accepted M2A-M2H runtime is active and its exact owner, operator,
   lifecycle, Realm, bake, admission, and runtime-profile binding is current.
2. One separate M3A composition root receives exactly two prebound ports. It
   does not add a sixteenth key to the frozen M2 V1 dependency object.
3. Seven trusted source authorities produce the nine existing M0 observation
   kinds assigned to M3A.
4. Raw manager objects, paths, payloads, arguments, return values, handles,
   tokens, keys, peer identities, addresses, and reflected errors never cross
   the trusted kernel boundary.
5. Snapshot and live-tail capture have one atomic handshake with explicit
   retention, gap, overflow, replacement, unavailable, and closed outcomes.
6. Source sequence, causal validation, canonical cuts, ledger append,
   checkpoint, recovery, and teardown have exact bounded contracts.
7. M3A writes only safe-normalized owner-private observations and its own
   protected ledger/checkpoint records. It performs zero DynamicStore, ECS,
   CSE active-root, renderer, Storylet, RealmForge, or network publication
   mutation.
8. Failure disables only live observation for the affected source or for M3A;
   the accepted static M2 city remains usable.

An implementation that merely pushes callbacks from existing managers is not
M3A. An implementation that stores raw events and promises to redact them later
is not M3A. An implementation that renders synthetic success while a source is
missing is not M3A.

## Explicit exclusions

M3A does not implement:

- M3B disclosure/domain projectors, `RealmDelta`, DynamicStore, ECS updates, or
  State-First presentation;
- M3C structural rebake, full reprojection, or visible-pointer activation;
- M3D Code Matter ingestion, reveal leases, exact bytes, tokens, glyphs, vault,
  or atlas;
- M3E Storylet scheduling, episodes, presentation channels, proposals, or
  authority correlation;
- M3F-M3G Genesis Foundry or ecology sources;
- M3H live Operations View overlays or zone proposals;
- M3I cross-session living-runtime handoff V2 and integrated performance
  certification;
- M4 public shells, M5 station/Traveler presence, M6 rendezvous/docking, remote
  peers, or multiplayer;
- host-filesystem scanning or any source outside explicitly authorized WebGPU
  OS authorities.

RealmForge RF-GE1A reports the exact `GenesisPartV1`, `GenesisInterfaceV1`,
`GenesisConstraintV1`, and `GenesisAssemblyV1` wires plus a digest-first closed-
graph validator in a separate inert Parts catalog. RF-GE2 has delivered the
separate four-record Product Genome, Factory Genome, revision-reference, and
constructive-Plan catalog; its deterministic compiler/verifier; and its sealed
25-registration constructive trust pack. RF-GE3 has delivered only the bounded
process-local exact verified Plan cache, reverse-dependency invalidation
evidence, and deterministic inert recursive package candidates. These are
accepted upstream authoring boundaries for later M3F planning, not M3A
dependencies, and M3A imports none of them. M3F still requires its own catalog-
version adapter, extension closure/admission verifier, safe observation mapping,
rollback, and gates. Factory execution, admission, active-head selection,
persistence, promotion, rollback authority, ECS materialization, publication,
installation, and Virtual Realm projection remain later independently gated
work beyond RF-GE5. RF-GE4 and RF-GE5 provide only inert authoring evidence and
do not advance this runtime work package.

## Why M3A is a separate composition version

[M2A](m2a-runtime-composition.md) freezes an exact 15-key dependency object and
rejects extra keys. Its checkpoint and handoff V1 records are also exact static
records with one advisory logical cursor field; they do not retain or verify a
plural M3 observation graph. M3A therefore uses neither of these invalid
shortcuts:

- it does not inject seven raw observation adapters into the M2 dependency
  object;
- it does not place an M3 checkpoint digest in the M2 logical-cursor field and
  claim that the M3 graph is protected;
- it does not widen an accepted M2 schema in place;
- it does not restore listeners, rings, ports, callbacks, abort controllers, or
  source leases through M2 handoff.

Instead, `VirtualRealmM3AObservationEntry` is a side-effect-free M3A composition
root with exactly two own, enumerable, immutable data properties:

```text
m2RuntimeContinuationPort@1
realmObservationIngressPort@1
```

The object has a null prototype, no symbols, no accessors, no inherited keys,
and no extras. Both are new M3A ports created by the trusted OS composition
root; neither is added to the frozen M2 dependency object or any M2 V1 port.
They are prebound to one read-only projection of the same active M2 runtime.
The M3A entry compares their binding receipts before it acquires an M3A
extension child or reads an observation.

`m2RuntimeContinuationPort@1` is issued by the new
`RealmM2ContinuationProjectionService`. Its exact surface is:

`m2RuntimeContinuationPort@1` exposes only:

```text
descriptor()
  -> immutable port name/version and exact binding-contract version

readCurrentBinding({ signal })
  -> active | absent | recovery-pending | retired | unavailable

assertCurrent({ expectedBindingReceiptId, expectedBindingDigest, signal })
  -> current | changed | recovery-pending | retired | unavailable

onChanged(listener, { signal })
  -> idempotent unsubscribe
```

`active` and `current` contain exactly `status`, one immutable
`RealmObservationIngressBindingV1`, `presentationState`,
`presentationGeneration`, and the conditionally present pair
`deviceRecoveryReceiptId`/`deviceRecoveryReceiptDigest`. `presentationState` is
exactly `ready`, `device-lost`, `recovering`, or `unavailable`; its
positive-safe-integer generation comes from the GPU runtime coordinator and is
observation only. An initially healthy `ready` generation omits both recovery
fields. A `ready` generation reached after device loss requires both fields and
they must resolve through the service-only recovery projection to one accepted,
current `RealmDeviceRecoveryReceiptV1` for that exact lost/replacement
generation and runtime bundle. Every other presentation state omits both
fields. One field without the other, a receipt on an initial/pending state, or a
post-loss `ready` state without verified recovery evidence fails closed. These
presentation fields are deliberately excluded from the portable binding
because device recovery cannot change operator, M2, ingress, or source
authority.

`absent` contains only `status` and `reasonCode = no-active-bundle`. `changed`
contains only `status`, `reasonCode`, `currentBindingReceiptId`, and
`currentBindingDigest`; its reason is exactly `active-binding-changed`,
`active-head-changed`, `normalization-policy-changed`, or
`pseudonym-key-rotated`.

The `changed` reason is selected at the same protected comparison fence. The
head field set is exactly `publicationHeadBinding`, `admissionHeadBinding`,
`visiblePointerGeneration`, `visibleCommitReceiptDigest`, and
`activeBakeOutputRecordDigest`. The normalization-policy field set is exactly
`safeNormalizationProfileId` and `safeNormalizationProfileDigest`; the
pseudonym-key field set is exactly `pseudonymKeyAuthorityId`,
`pseudonymKeyEpoch`, and `pseudonymKeyCommitment`. Selection order is:

1. an authenticated key-authority rotation affecting the key set is
   `pseudonym-key-rotated`;
2. otherwise, any normalization-policy-set change is
   `normalization-policy-changed`;
3. otherwise, any change to a remaining semantic binding field is
   `active-binding-changed`, whether or not a head field also changed; and
4. otherwise, one or more changed head fields with every non-head semantic
   field byte-equal is `active-head-changed`.

Thus `active-binding-changed` explicitly excludes a head-only transition and
`active-head-changed` is reachable and deterministic. A changed receipt ID or
digest with byte-equal semantic fields, or semantic bytes whose ID/digest does
not recompute, is never a change reason; it is
`recovery-pending/cse-integrity-quarantined`.

`recovery-pending`, `retired`, and `unavailable` contain only `status` and one
reason code. Recovery reasons are exactly `pointer-recovery-pending`,
`cse-integrity-quarantined`, `head-recovery-pending`,
`presentation-state-changing`, `device-recovery-evidence-pending`, or
`pseudonym-key-rotation-pending`;
retirement reasons are exactly `operator-superseded`, `lifecycle-retired`, or
`owner-released`; unavailable reasons are exactly `service-unavailable`,
`cancelled`, or `closed`. Cross-variant, extra, raw, inherited, mutable, and
accessor fields fail.

`realmDeviceRecoveryObservationPort@1` is a kernel-private read-only facet, not
an application dependency. Its exact surface is:

```text
descriptor()
  -> immutable port name/version and RealmDeviceRecoveryReceiptV1 projection version

verifyCurrent({
  receiptId,
  receiptDigest,
  expectedPresentationGeneration,
  expectedRuntimeBundleId,
  signal
})
  -> verified | changed | pending | invalid | unavailable
```

`verified` contains exactly `status`, `receiptId`, `receiptDigest`,
`runtimeBundleId`, `lostDeviceGeneration`, `replacementDeviceGeneration`,
`restoredSourceBindingDigest`, and `resumedState = ready`. The two device
generations are positive safe integers, replacement equals lost plus one,
replacement equals `expectedPresentationGeneration`, and `runtimeBundleId`
equals `expectedRuntimeBundleId`. The source-binding digest must resolve to the
same active bundle's restored State-First source and the accepted M2 receipt
must prove its resources rebuilt and frame admission resumed. The port projects
these fields only after recomputing the complete accepted
`RealmDeviceRecoveryReceiptV1`; it does not return the receipt bytes.

`changed` contains exactly `status` and a reason code equal to
`receipt-not-current`, `presentation-generation-changed`, or
`runtime-bundle-changed`. `pending` contains exactly `status` and reason
`recovery-receipt-pending` or `recovery-readback-pending`. `invalid` contains
exactly `status` and reason `receipt-id-digest-invalid`,
`receipt-schema-invalid`, `receipt-lineage-invalid`, or
`restored-source-invalid`. `unavailable` contains exactly `status` and reason
`service-unavailable`, `cancelled`, or `closed`. No variant contains a manager,
device, resource, source handle, recovery command, error object, or mutable
receipt. Two byte-identical `GpuRuntimeCoordinator.status()` snapshots are
mandatory for every branch. For the post-loss `ready`
branch, two `verifyCurrent()` calls inside that same non-preemptible assertion
bracket must both remain `verified` with byte-identical projected fields;
otherwise no `active`/`current` result is issued.

The exact post-loss bracket order is sanitized GPU status-before,
recovery-verify-before, operator/owner/lifecycle/head/profile/CSE and pseudonym-
key current assertions, recovery-verify-after, then sanitized GPU status-after.
The retained selection fence spans the sequence. Any asynchronous read is
followed by all applicable current assertions before the next step, and the two
status and two recovery projections must be byte-identical. No callback result
or earlier verification can substitute either after-read.

The service constructs `active` under the existing operator/Realm activation-
selection fence through injected service-only read facets. The M2 composition
root gives it the immutable operator projection captured by M2's sole initial
`operatorContextPort@1.snapshot()` call; M3A never calls `snapshot()` again.
During the non-preemptible read the service calls
`operatorContextPort@1.assertCurrent()` with that captured identity/generation,
then reasserts the active owner/lifecycle, visible pointer and commit receipt,
accepted publication/admission heads, runtime profile, and active-bake CSE
output record. It brackets that fenced read with two sanitized
`GpuRuntimeCoordinator.status()` snapshots and cross-checks the service-only,
read-only `realmDeviceRecoveryObservationPort@1` projection. The latter can
resolve and validate only the ID/digest of an already accepted
`RealmDeviceRecoveryReceiptV1`; it exposes no GPU manager, recovery command, or
application dependency. Only equal state/generation pairs enter `active`; a
change yields `recovery-pending` with reason
`presentation-state-changing` and no binding. A stable post-loss `ready` state
whose receipt is not yet accepted yields `device-recovery-evidence-pending`.
The service issues no receipt for `absent`, displaced, retiring, or M2
pointer/head recovery-pending state. A stable `device-lost` or `recovering`
presentation snapshot may accompany an otherwise current binding so bounded CPU
intake can continue without treating GPU state as authority.
This is a new read-only M3 projection seam, not a method added to
`runtimeActivationPort@1`, `processOwnerPort@1`, or another frozen M2 port.
`assertCurrent()` repeats the fenced comparison, the applicable twice-equal
device-recovery projection, and pseudonym-key authority/epoch/commitment
currentness before acquisition and every durable publication, closing the
loose-read TOCTOU window.

The port contains no manager, storage face, Engine instance, ECS object, GPU
object, active-bundle teardown handle, selection-fence handle, or authority
method. `onChanged()` is wake-only; the listener must reread/assert the binding
and cannot treat the callback payload as authority.

`realmObservationIngressPort@1` is the only app-facing M3A service. It is
prebound to the tuple below and exposes already safe-normalized batches. The app
cannot select a different operator, Realm, audience, policy, extension child,
or work root.

## Exact prebound tuple

The portable receipt exposed by both M3A ports binds exactly:

```text
operatorPartitionId
operatorGeneration
realmId
processOwnerId
m2LifecycleGeneration
m2RuntimeBundleId
m2RuntimeCapabilityProfileId
m2RuntimeCapabilityProfileDigest
admissionIndexDigest
publicationHeadBinding
admissionHeadBinding
visiblePointerGeneration
visibleCommitReceiptDigest
activeBakeOutputRecordDigest
audienceClass = owner-private
disclosureClass = local-private
safeNormalizationProfileId
safeNormalizationProfileDigest
pseudonymKeyAuthorityId
pseudonymKeyEpoch
pseudonymKeyCommitment
m3aObservationProfileId
m3aObservationProfileDigest
m3aContractCatalogId
m3aContractCatalogDigest
m3aSourceManifestId
m3aSourceManifestDigest
```

This is a service-issued receipt tuple, not caller-authored configuration. A
caller may repeat expected IDs/digests only for equality checking. Missing,
extra, stale, malformed, differently bound, or mutable fields fail before a
source cursor, ring, ledger writer, timer, listener, or storage child exists.

The exact producers and mappings are frozen:

| Binding field | Exact producer under the selection fence |
| --- | --- |
| `operatorPartitionId`, `operatorGeneration`, `realmId` | The immutable service-only operator projection retained from M2's one initial `operatorContextPort@1.snapshot()` supplies `operatorPartitionId`, `operatorGeneration`, and `localRealmId`; the projection is reasserted with `operatorContextPort@1.assertCurrent()` under the selection fence and M3A never invokes a second snapshot |
| `processOwnerId`, `m2LifecycleGeneration` | The active M2 runtime's prebound owner and byte-identical durable `lifecycleGeneration`; the latter remains canonical uint64 decimal text |
| `m2RuntimeBundleId`, `m2RuntimeCapabilityProfileId`, `m2RuntimeCapabilityProfileDigest`, `admissionIndexDigest` | The exact active runtime bundle and accepted M2 profile/index projection |
| `publicationHeadBinding`, `admissionHeadBinding` | The exact closed sanitized M2 head-binding objects re-read current under the same selection fence |
| `visiblePointerGeneration`, `visibleCommitReceiptDigest` | The exact active `runtimeActivationPort@1` state and retained verified visible-commit record |
| `activeBakeOutputRecordDigest` | The verified committed CSE V2 active-bake output-record digest retained by the M2 activation service |
| audience/disclosure, normalization, M3A profile/catalog/manifest | Code-shipped M3A constants/verified objects recomputed before binding issuance |
| `pseudonymKeyAuthorityId`, `pseudonymKeyEpoch`, `pseudonymKeyCommitment` | The current kernel-private operator-partition pseudonym projection acquired and reasserted under the same selection fence; no key byte enters the binding |

`operatorGeneration` and every M3A ingress/source generation are positive safe
integers. `m2LifecycleGeneration` is not: it preserves M2's durable, strictly
increasing canonical uint64 decimal-text bytes. Their issuing authorities never
reuse a value. A process restart, operator switch, M2 runtime replacement, or
owner retirement cannot make an old M3A handle current again.

M2's `localPolicyId`/`localPolicyDigest` controls its own runtime/handoff view
and is not reinterpreted as M3A observation policy. M3A's exact admission and
redaction policy is the separately code-shipped
`safeNormalizationProfileId`/`safeNormalizationProfileDigest` already bound
through the portable receipt, every batch/receipt, and the checkpoint. This
avoids an undefined cross-version policy producer or a digest-only policy alias.

## Authority and commit boundary

M3A admits evidence; it does not establish new OS truth. Source authorities
remain authoritative for their own state. The M3A ledger is authoritative only
for the claim that exact safe-normalized bytes were admitted under an exact
cursor and policy binding.

The following can never mint or imply application authority:

- a source descriptor, cursor, snapshot, wake hint, batch, ledger receipt,
  checkpoint, recovery receipt, or compaction receipt;
- canonical serialization order;
- a CSE causal-graph validation result;
- a Chronicle or historical witness;
- an M3B projection, M3C transition, Storylet, Operations View proposal,
  renderer frame, State-First decision, or device-recovery callback.

Completed-success presentation later requires both an exact verified
`RealmActionAuthorityReceiptContract` record and its matching terminal
`RealmActionResultContract` observation. A bare receipt ID or digest is not
enough; its safe retained record and verifier must be available. Missing or
mismatched evidence remains unknown or recovery-pending.

M3A never calls the M2 visible-bundle/CSE activation authority. M3B will use a
separately versioned dynamic projection transaction that builds one complete
immutable bundle and selects it through its own durable selector; it neither
widens nor becomes the M2 static-bake/CSE pointer authority. M3C must chain any
topology activation to the existing M2 activation service and exact visible/CSE
swap receipt; it may not create a second static-bake pointer authority.

## Existing contracts reused without duplication

M3A reuses the accepted M0 definitions rather than creating alternate semantic
observation envelopes:

| Existing definition | M3A use |
| --- | --- |
| `RealmObservationContract` | Exact safe-normalized observation envelope |
| `RealmObservationSnapshotContract` | Query, source generation, watermark, observation-ID, omission, freshness, and snapshot digest binding |
| `RealmMetricValueContract` | Explicit unit, evidence quality, sample window, source sequence, and optional bounds |
| `RealmFilesystemObservationContract` | Authorized opaque filesystem node and relationship state |
| `RealmStorageObservationContract` | Store lifecycle, usage, capacity, operation, pressure, and health state |
| `RealmProcessObservationContract` | Process lifecycle and quality-labelled metrics |
| `RealmIpcObservationContract` | Payload-free channel lifecycle and bounded metrics |
| `RealmSyscallObservationContract` | Argument-free entry, authority, dispatch, terminal, timing, and reason evidence |
| `RealmPermissionObservationContract` | Decision, grant, denial, expiry, revocation, and policy evidence |
| `RealmNetworkObservationContract` | M3A-restricted local boundary evidence with every remote identity field forbidden |
| `RealmBootObservationContract` | Bounded boot phase and service readiness evidence |
| `RealmActionResultContract` | Exact terminal action observation used only when an owning authority emits it |

All normal M0 schema validation, canonicalization, digest recomputation,
conditional-field rules, enum checks, and error precedence run before M3A
admission. M3A adds stricter local ingress invariants; it does not relax or
rewrite M0.

## Kernel safe normalization versus Realm disclosure

There are two different operations and exactly one owner for each:

1. **Kernel safe normalization** is mandatory and irreversible. A trusted
   source adapter converts raw authority state into one M0 observation using
   only the M3A allowlist. Raw data is discarded before the app port and before
   the Realm ledger. M3A owns this step.
2. **Realm audience disclosure** is a pure semantic projection over already
   safe observations. In base M3 it may preserve or further narrow only
   `owner-private + local-private` data. M3B owns this step. Future public or
   refinement output is independently sourced and separately compiled; it is
   never produced by filtering a private rendered scene.

Only safe-normalized M0 observations, M3A coordination contracts, and their
digests may enter the M3A ledger/checkpoint store. Raw source events, raw
snapshots, manager objects, and pre-normalization buffers are process-local,
bounded, and destroyed after conversion. A source that cannot normalize an
event emits an explicit safe unavailable/failure observation when the M0 schema
allows it or enters recovery; it never persists the raw failure object.

## Exact M3A source manifest

The base manifest has exactly seven source authorities in this order and
exactly nine existing observation kinds. This order is a serialization
tie-breaker only; it does not create causal order.

| Order | Source ID | Trusted adapter or sink | Internal source port | Allowed M0 observation kinds |
| ---: | --- | --- | --- | --- |
| 1 | `source:realm-m3a-boot` | `RealmBootObservationAdapter` | `BootObservationPort@1` | `boot` |
| 2 | `source:realm-m3a-canonical-storage` | `RealmCanonicalStorageObservationAdapter` | `CanonicalStorageObservationPort@1` | `filesystem`, `storage` |
| 3 | `source:realm-m3a-process` | `RealmProcessObservationAdapter` | `ProcessObservationPort@1` | `process` |
| 4 | `source:realm-m3a-ipc` | `RealmIpcObservationSink` | `IpcObservationPort@1` | `ipc` |
| 5 | `source:realm-m3a-syscall` | `RealmSyscallObservationSink` | `SyscallObservationPort@1` | `syscall` |
| 6 | `source:realm-m3a-authority` | `RealmAuthorityObservationSink` | `AuthorityObservationPort@1` | `action-result`, `permission` |
| 7 | `source:realm-m3a-local-network` | `RealmLocalNetworkObservationAdapter` | `LocalNetworkObservationPort@1` | `network` |

`RealmObservationSourceManifestV1` contains exactly:

```text
format
version
sourceManifestId
safeNormalizationProfileId
safeNormalizationProfileDigest
sourceRows
sourceManifestDigest
```

`format` is `particle-realms.realm-observation-source-manifest`, `version` is
`1`, and `sourceManifestId` is
`observation-source-manifest:virtual-realm-m3a-base-v1`. `sourceRows` is the
exact seven-row order above. Each row is a null-prototype, immutable, exact
closed record containing:

```text
sourceOrder
sourceId
sourceKind
adapterId
adapterVersion
portName
portVersion
sourceSchemaVersions
allowedObservationKinds
safeNormalizationProfileId
safeNormalizationProfileDigest
retentionClass
startupAvailability
```

`sourceOrder` is the displayed integer. `sourceKind` is respectively `boot`,
`canonical-storage`, `process`, `ipc`, `syscall`, `authority`, or
`local-network`. `adapterId` is respectively
`realm-boot-observation-adapter`,
`realm-canonical-storage-observation-adapter`,
`realm-process-observation-adapter`, `realm-ipc-observation-sink`,
`realm-syscall-observation-sink`, `realm-authority-observation-sink`, or
`realm-local-network-observation-adapter`. `adapterVersion` and `portVersion`
are exactly `1`, and `portName` is the displayed internal port name without
`@1`.
`allowedObservationKinds` is the displayed nonempty code-point-sorted unique
array. `sourceSchemaVersions` is the following nonempty code-point-sorted unique
array and may name only the already implemented M0 payload definitions:

| Source order | Exact `sourceSchemaVersions` |
| ---: | --- |
| 1 | `RealmBootObservationContract@1` |
| 2 | `RealmFilesystemObservationContract@1`, `RealmStorageObservationContract@1` |
| 3 | `RealmProcessObservationContract@1` |
| 4 | `RealmIpcObservationContract@1` |
| 5 | `RealmSyscallObservationContract@1` |
| 6 | `RealmActionResultContract@1`, `RealmPermissionObservationContract@1` |
| 7 | `RealmNetworkObservationContract@1` |

The manifest's `safeNormalizationProfileId` is exactly
`safe-normalization:virtual-realm-m3a-owner-private-v1`.
`safeNormalizationProfileDigest` is recomputed only from the closed canonical
object below; prose is never digest input. Every row repeats those two values
byte-for-byte. `retentionClass` is
exactly `bounded-replay-required` and `startupAvailability` is exactly
`explicit-degraded` for every base row: the row must exist and return a terminal
open result, but an explicit unavailable source may leave M3A degraded while
the accepted M2 static city remains usable.

`sourceManifestDigest` uses the manifest format/domain and major version `1`
over every other field with only itself excluded. Unknown fields, aliases,
missing/reordered rows, duplicate source or observation ownership, a different
adapter/port/schema version, wider kind set, mismatched normalization pair, or a
caller-authored availability class fails before source resolution.

### Exact safe-normalization profile object

`RealmObservationSafeNormalizationProfileV1` is an immutable code-shipped
policy descriptor verified by `RealmObservationProfileRegistry`. It is not a
twelfth runtime-contract definition and carries no port or authority. Its exact
top-level field order is:

```text
format
version
profileId
canonicalEncodingProfileId
digestAlgorithm
wrapperSchemaVersion
wrapperOutputFieldNames
audienceClass
disclosureClass
identityProjectionAlgorithm
unknownOutputFieldDisposition
invalidInputDisposition
rawInputRetention
normalizationRuleRows
profileDigest
```

The exact scalar values are
`format = particle-realms.realm-observation-safe-normalization-profile`,
`version = 1`,
`profileId = safe-normalization:virtual-realm-m3a-owner-private-v1`,
`canonicalEncodingProfileId = canonicalization:realm-bake-json-v1`,
`digestAlgorithm = SHA-256`,
`wrapperSchemaVersion = RealmObservationContract@1`,
`audienceClass = owner-private`, `disclosureClass = local-private`,
`identityProjectionAlgorithm = hmac-sha256-owner-partition-v1`,
`unknownOutputFieldDisposition = reject`,
`invalidInputDisposition = reject-with-bounded-code`, and
`rawInputRetention = forbidden`.
`wrapperOutputFieldNames` is the exact JSON array `format`, `version`, then the
implemented `RealmObservationContract@1.canonicalPayloadFields` export in its
exported order, then `observationDigest`.

`normalizationRuleRows` contains exactly nine rows in the observation-kind
order below. Every row is a null-prototype exact closed record with fields in
this order:

```text
ruleOrder
sourceOrder
sourceId
observationKind
sourceSchemaVersion
normalizationRuleId
identityProjectionDomain
allowedEventKinds
canonicalOutputFieldNames
terminalDigestFieldName
forbiddenInputClassIds
forbiddenOutputFieldNames
metricEvidenceRule
failureDisposition
ruleDigest
```

| Rule | Source order | Observation/schema | Rule ID | Identity domain | Allowed event kinds |
| ---: | ---: | --- | --- | --- | --- |
| 1 | 1 | `boot` / `RealmBootObservationContract@1` | `normalize:realm-m3a-boot-v1` | `particle-realms.realm-observation-identity/boot` | `boot-failed`, `phase-completed`, `phase-entered`, `service-degraded`, `service-ready` |
| 2 | 2 | `filesystem` / `RealmFilesystemObservationContract@1` | `normalize:realm-m3a-filesystem-v1` | `particle-realms.realm-observation-identity/filesystem` | `coverage-changed`, `mount-added`, `mount-removed`, `object-created`, `object-moved`, `object-removed`, `object-updated`, `snapshot` |
| 3 | 2 | `storage` / `RealmStorageObservationContract@1` | `normalize:realm-m3a-storage-v1` | `particle-realms.realm-observation-identity/storage` | `operation-sampled`, `pressure-changed`, `store-mounted`, `store-state`, `store-unmounted`, `usage-sampled` |
| 4 | 3 | `process` / `RealmProcessObservationContract@1` | `normalize:realm-m3a-process-v1` | `particle-realms.realm-observation-identity/process` | `exited`, `metrics-sampled`, `started`, `state-changed` |
| 5 | 4 | `ipc` / `RealmIpcObservationContract@1` | `normalize:realm-m3a-ipc-v1` | `particle-realms.realm-observation-identity/ipc` | `channel-closed`, `channel-opened`, `channel-state`, `traffic-sampled` |
| 6 | 5 | `syscall` / `RealmSyscallObservationContract@1` | `normalize:realm-m3a-syscall-v1` | `particle-realms.realm-observation-identity/syscall` | `authority-decided`, `cancelled`, `completed`, `denied`, `dispatched`, `entered`, `failed` |
| 7 | 6 | `action-result` / `RealmActionResultContract@1` | `normalize:realm-m3a-action-result-v1` | `particle-realms.realm-observation-identity/action-result` | empty array |
| 8 | 6 | `permission` / `RealmPermissionObservationContract@1` | `normalize:realm-m3a-permission-v1` | `particle-realms.realm-observation-identity/permission` | `decision`, `denied`, `expired`, `granted`, `policy-changed`, `revoked` |
| 9 | 7 | `network` / `RealmNetworkObservationContract@1` | `normalize:realm-m3a-local-network-v1` | `particle-realms.realm-observation-identity/network` | `degraded`, `discovered`, `route-closed`, `route-opened`, `route-state`, `traffic-sampled` |

Every `allowedEventKinds` and `forbidden*` array is code-point sorted and unique.
For rules 1-6 and 8, `canonicalOutputFieldNames` is exactly `format`, `version`,
the named implemented source contract's `canonicalPayloadFields` export in its
exported order, then `payloadDigest`; `terminalDigestFieldName` is
`payloadDigest` and `forbiddenOutputFieldNames` is empty. Rule 7 uses the same
construction with `RealmActionResultContract@1` and `resultDigest`. Rule 9 uses
the network construction after removing exactly `peerIdentityRef`; its
`forbiddenOutputFieldNames` array is exactly `peerIdentityRef`, so the excluded
`authenticated` event is unrepresentable. `metricEvidenceRule` is
`explicit-quality-required` for rules 1-6 and 9 and `not-applicable` for rules
7-8. `failureDisposition` is `reject-with-bounded-code` for every rule.

The exact `forbiddenInputClassIds` arrays are:

| Rules | Code-point-sorted forbidden input class IDs |
| --- | --- |
| 1 | `command-line`, `credential`, `device-fingerprint`, `environment`, `exception`, `raw-log`, `raw-path`, `stack-trace` |
| 2 | `content`, `content-hash`, `denied-subtree-name`, `filename`, `host-disk-scope`, `mount-secret`, `native-handle`, `raw-path` |
| 3 | `content-hash`, `encryption-material`, `filename`, `journal-bytes`, `logical-key`, `physical-key`, `plaintext`, `protected-service-namespace`, `raw-error`, `raw-path`, `transaction-payload`, `value` |
| 4 | `command-line`, `credential`, `environment`, `native-handle`, `private-window-content`, `raw-manifest`, `raw-path`, `stack-trace` |
| 5 | `callback`, `capability-token`, `credential`, `message-payload`, `native-handle`, `private-channel-label`, `raw-endpoint-name`, `raw-error`, `serialized-object`, `transfer` |
| 6 | `argument`, `credential`, `dispatch-capability`, `function`, `native-handle`, `raw-error`, `raw-path`, `return-value`, `source-byte`, `stack-trace`, `storage-key` |
| 7-8 | `approval-token`, `authority-method`, `capability-token`, `manifest-body`, `private-predicate`, `raw-audit-log`, `signing-key`, `unrestricted-rule-graph`, `unverified-receipt-bytes` |
| 9 | `address`, `cityform`, `contact-scope`, `ice-sdp-candidate`, `membership-proof`, `packet-frame-message-bytes`, `peer-count`, `peer-identity`, `reconnect-ticket`, `remote-operations`, `remote-presence`, `remote-route-id`, `route-capability`, `station-occupant`, `traveler`, `url` |

Each `ruleDigest` uses domain
`particle-realms.realm-observation-safe-normalization-rule`, major version `1`,
and every preceding row field with only `ruleDigest` excluded. `profileDigest`
is the SHA-256 Realm content ID using the top-level `format` as domain, major
version `1`, and all preceding top-level fields with only `profileDigest`
excluded. Exact field order above, UTF-8 NFC strings, JSON arrays, safe integers,
and the existing Realm canonical JSON rules are mandatory. Missing, extra,
reordered, inherited, accessor, symbol, mutable, non-NFC, noncanonical, or
mismatched rule/profile bytes fail before a source is resolved. No prose,
runtime callback, adapter source code, wall time, locale, or host value enters a
digest.

### Kernel-private pseudonym key authority

`identityProjectionAlgorithm = hmac-sha256-owner-partition-v1` is backed by one
kernel-private `realmObservationPseudonymKeyPort@1`. The OS composition root
owns this port. Its projection facet is injected only into
`RealmM2ContinuationProjectionService` and
`RealmObservationIdentityProjector`; its reference-lifecycle facet is callable
only by the protected ledger, checkpoint, and recovery-journal authorities, plus
the trusted service root for terminal binding retirement. Its projection-
acquisition sealing facet is callable only by the kernel-private extension owner
through that same trusted service root. It
is not a third M3A application dependency, catalog definition, source, or
serializable authority. Its exact surface is:

```text
descriptor()
  -> immutable port name/version, authority ID, and supported algorithm

acquireProjection({
  operatorPartitionId,
  realmId,
  projectionOwnerKind,
  projectionOwnerGeneration,
  expectedAlgorithm,
  workSignal,
  teardownSignal
})
  -> acquired | rotating | unavailable | invalid

sealProjectionNonissuance({
  bindingReceiptId,
  bindingDigest,
  projectionOwnerKind,
  projectionOwnerGeneration,
  signal
})
  -> sealed | already-sealed | issued | invalid | unavailable

retainEpochReference({
  bindingReceiptId,
  bindingDigest,
  referenceKind,
  referenceId,
  referenceDigest,
  signal
})
  -> retained | already-retained | invalid | unavailable

releaseEpochReference({
  epochReferenceRecordId,
  epochReferenceRecordDigest,
  retirementEvidenceKind,
  retirementEvidenceId,
  retirementEvidenceDigest,
  signal
})
  -> released | already-released | retention-blocked | invalid | unavailable

verifyEpochBinding({
  bindingReceiptId,
  bindingDigest,
  keyAuthorityId,
  keyEpoch,
  keyCommitment,
  signal
})
  -> current | retained | retired | invalid | unavailable

finalizeBindingRetirement({
  bindingReceiptId,
  bindingDigest,
  signal
})
  -> finalized | already-finalized | retention-blocked | invalid | unavailable
```

`descriptor()` returns exactly `portName = realmObservationPseudonymKey`,
`version = 1`, `keyAuthorityId = webgpu-os-operator-pseudonym-key@1`, and
`supportedAlgorithm = hmac-sha256-owner-partition-v1`. `acquired` contains
exactly `status`, `keyAuthorityId`, `keyEpoch`, `keyCommitment`,
`projectionOwnerKind`, `projectionOwnerGeneration`, and one branded
nonserializable `identityProjection` handle. `projectionOwnerKind` is exactly
`continuation-service` or `ingress-extension`; its generation is a positive safe
integer, is assigned monotonically by that owner, and is never reused.
`keyEpoch` is a positive strictly increasing canonical uint64 decimal-text
value. `rotating` contains exactly
`status` and `reasonCode = key-rotation-in-progress`. `unavailable` contains
exactly `status` and reason `key-store-unavailable`, `cancelled`, or `closed`.
`invalid` contains exactly `status` and reason `algorithm-mismatch`,
`operator-partition-invalid`, `owner-generation-invalid`, `owner-kind-invalid`,
`realm-invalid`, or `scope-mismatch`. Failure
variants contain no key metadata or partial handle. `workSignal` and
`teardownSignal` must be the object-identical distinct branded pair owned by the
calling continuation or ingress lifecycle; equality, reversal, staleness, or an
unbranded signal is `invalid/scope-mismatch`. The continuation service's handle
is service-private, operation-scoped, and never enters the M3A resource ledger.
It uses `projectionOwnerKind = continuation-service` and the continuation
service's current nonreused generation.
It aborts and settles its work, then closes and reads back that handle before an
`active`, `current`, or terminal-reason-latch result becomes observable. After
the M3A extension claim, the trusted service root opens one protected acquisition
transaction between the extension owner, key authority, and
`RealmObservationIdentityProjector`. The extension owner first reserves its one
`identity-projection` row; the key authority then acquires the ingress handle
with that extension's exact work/teardown pair,
`projectionOwnerKind = ingress-extension`, and
`projectionOwnerGeneration` byte-equal to the returned `ingressGeneration`.
Successful issuance and conversion of the reserved row to `owned` commit
atomically before the projector can observe or invoke the handle. A crash cannot
leave an issued handle without its registered row. Its returned authority/epoch/
commitment triple must equal the already accepted portable binding byte-for-
byte; a rotation race leaves the now-registered row to the ordinary close path
and restarts binding acquisition before any other resource opens. If acquisition
returns no handle, the transaction commits no row, records that exact terminal
outcome, and enters the ordinary aggregate stop path. The transition to
`closing` occurs before acquisition is sealed and nonissuance evidence is
issued.

The projection handle is branded to the exact operator partition, Realm,
projection-owner kind/generation, authority, epoch, commitment, algorithm, work
signal, and teardown signal. It
exposes only:

```text
project({ sourceKind, normalizationRuleId, rawIdentityBytes, signal })
  -> projected | stale | invalid | unavailable

assertCurrent({
  expectedKeyAuthorityId,
  expectedKeyEpoch,
  expectedKeyCommitment,
  signal
})
  -> current | rotated | unavailable | invalid

close({ reason, signal })
  -> closed | already-closed | stale | invalid
```

`projected` contains exactly `status`, `projectedIdentityId`,
`keyAuthorityId`, `keyEpoch`, and `keyCommitment`. `stale` contains exactly
`status` and reason `key-rotated`, `operator-changed`, `realm-changed`, or
`signal-stale`. `invalid` contains exactly `status` and reason
`source-kind-invalid`, `normalization-rule-invalid`, `raw-identity-invalid`,
or `binding-mismatch`. `unavailable` contains exactly `status` and reason
`key-store-unavailable`, `cancelled`, or `closed`. `current` contains exactly
`status` plus the same authority/epoch/commitment triple; `rotated` contains
exactly `status`, `reasonCode = key-rotated`, `currentKeyAuthorityId`,
`currentKeyEpoch`, and `currentKeyCommitment`. No result contains key bytes,
raw identity bytes, a preimage, a storage reference, or an unrestricted HMAC
method. `project()` and `assertCurrent()` accept only the exact branded live work
signal. `close()` accepts only the exact branded live teardown signal and
`reason` exactly `normal`, `binding-changed`, `key-rotated`,
`operator-retired`, or `failure`. `closed` and `already-closed` contain exactly
`status`, `keyAuthorityId`, `keyEpoch`, `keyCommitment`,
`projectionOwnerKind`, `projectionOwnerGeneration`, and
`projectionCloseDigest`; the latter is returned only for the same already
closed handle and performs no second release. `projectionCloseDigest` uses
domain `particle-realms.realm-observation-identity-projection-close`, major
version `1`, over the closed canonical record `operatorPartitionId`, `realmId`,
`projectionOwnerKind`, `projectionOwnerGeneration`, the authority/epoch/
commitment triple, `reason`, and literal `closed = true` in that order. `stale`
contains exactly `status` and reason
`teardown-signal-stale` or `scope-stale`; `invalid` contains exactly `status` and
reason `reason-invalid`, `signal-invalid`, or `already-closed-mismatch`. Neither
failure variant returns projection authority. Once closed, every later
`project()` or `assertCurrent()` call returns `unavailable/closed`.

`close()` cannot return `closed` until the branded work signal is aborted and
every in-flight `project()` or `assertCurrent()` call under that signal has
settled. It does not reassert key currentness: rotation may select
`reason = key-rotated` but cannot prevent destruction of the old handle.
`already-closed` is valid only for the object-identical handle, exact teardown
signal, and byte-identical original reason; a different reason is
`invalid/already-closed-mismatch`.

The extension owner may change the registered `identity-projection` resource
row from `owned` to `released` only after `closed` or `already-closed` is
returned by the object-identical registered handle, the returned authority/
epoch/commitment triple equals that handle's immutable brand, and
`projectionCloseDigest` recomputes exactly. A digest presented without that
object identity is not close authority. `stale`, `invalid`, an exception, abort
alone, garbage collection, or loss of the handle leaves the row owned and makes
aggregate-close evidence invalid.

That rule is absolute while the projection-owner generation is live. A process
crash cannot counterfeit object-identical close. Instead, after the owner
generation is durably retired, the key authority may install one protected
internal `RealmObservationProjectionGenerationFenceV1`. It is not a runtime-
catalog definition or application contract and contains exactly:

```text
format
version
projectionGenerationFenceId
issuerId
operatorPartitionId
realmId
bindingReceiptId
bindingDigest
projectionOwnerKind
retiredProjectionOwnerGeneration
currentProjectionOwnerGeneration
verifiedLiveProjectionHandleCount
verifiedInflightProjectionCallCount
projectionGenerationFenceDigest
```

`format` is `particle-realms.realm-observation-projection-generation-fence`,
`version` is `1`, and `issuerId` is
`webgpu-os-operator-pseudonym-key@1`. Both generations are positive safe
integers, current is strictly greater than retired, the retired generation is an
inclusive high-watermark covering every generation at or below it, both counts
are literal `0`, and the binding pair resolves exactly. Under one protected fence, the
projection owner first retires every work/teardown brand through that high-watermark;
the key authority then proves that its live-handle registry and in-flight call
registry contain no row for that owner kind at or below that generation. Every
call on an old handle thereafter returns `unavailable/closed` without HMAC authority.
The fence ID is the Realm content ID over every semantic field except itself and
the final digest; the final digest uses the displayed format as domain, major
version `1`, and every other field.

This fence never changes an old process-local resource row to `released`, never
makes aggregate-close evidence valid, and is forbidden for a current owner
generation. It proves only retired-generation absence: either as the sole
projection proof for protected `absent-after-restart` evidence or as the
required cumulative prior-lineage proof beside a later generation's protected
`released` evidence. It can never substitute for the object-identical handle,
signal, and close readback required by a still-running generation.

An ingress extension that received no projection handle can close truthfully
without inventing a close digest. The extension owner first closes that
generation's projection-acquisition gate, then calls
`sealProjectionNonissuance()` with the exact binding, owner kind
`ingress-extension`, owner generation, and branded teardown signal. `sealed`
and `already-sealed` contain exactly `status`,
`projectionNonissuanceEvidenceId`, and
`projectionNonissuanceEvidenceDigest`; `issued` contains exactly `status` and
`verifiedProjectionHandleIssuedCount = 1` and authorizes no release. `invalid`
contains exactly `status` and reason `binding-invalid`,
`owner-generation-invalid`, `owner-kind-invalid`, `scope-mismatch`, or
`schema-invalid`; `unavailable` contains exactly `status` and reason
`key-store-unavailable`, `cancelled`, or `closed`. A failure result contains no
evidence pair. Once sealed, every later acquisition for that exact owner
generation returns `unavailable/closed`.

The success pair resolves to one protected internal
`RealmObservationProjectionNonissuanceEvidenceV1`, which is not a runtime-
catalog definition or application contract and contains exactly:

```text
format
version
projectionNonissuanceEvidenceId
issuerId
operatorPartitionId
realmId
bindingReceiptId
bindingDigest
projectionOwnerKind
projectionOwnerGeneration
projectionAcquisitionSealed
verifiedProjectionHandleIssuedCount
verifiedInflightProjectionCallCount
projectionNonissuanceEvidenceDigest
```

`format` is
`particle-realms.realm-observation-projection-nonissuance-evidence`, `version`
is `1`, `issuerId` is `webgpu-os-operator-pseudonym-key@1`, owner kind is
`ingress-extension`, owner generation is a positive safe integer, acquisition
sealed is literal `true`, and both counts are literal `0`. The authority issues
it only while the exact generation is closing, after its acquisition gate is
durably sealed and registry readback proves no handle was ever issued and no
projection call exists. The ID is the Realm content ID over every semantic
field except itself and the final digest; the final digest uses the displayed
format as domain, major version `1`, and every other field. This evidence is
invalid if a handle was ever issued, even if that handle later closed.

For each operator partition the authority creates one 256-bit secret with the
host cryptographic random source and stores it only in the protected kernel key
store. Restart reloads the same current key and epoch; process-local lifecycle
or ingress generation never changes them. The exact commitment message is the
Realm-canonical JSON encoding of this closed record in displayed order:

```text
format = particle-realms.realm-observation-pseudonym-key-commitment
version = 1
keyAuthorityId
operatorPartitionId
keyEpoch
algorithm = hmac-sha256-owner-partition-v1
```

`keyCommitment` is `opkc1:` followed by unpadded base64url of
HMAC-SHA-256(key, UTF-8(commitment message)). The key is never an input field,
digest field, log field, or app-visible value. For `project()`,
`rawIdentityBytes` must be a copied `Uint8Array` of 1 through 4,096 bytes. The
port resolves the exact normalization row and constructs this closed record in
displayed order:

```text
format = particle-realms.realm-observation-identity-preimage
version = 1
operatorPartitionId
realmId
keyAuthorityId
keyEpoch
keyCommitment
sourceKind
normalizationRuleId
identityProjectionDomain
rawIdentityBase64Url
```

Every string is NFC, `rawIdentityBase64Url` is the unique unpadded base64url
encoding, and the record uses the existing Realm canonical JSON rules.
`projectedIdentityId` is `opi1:` followed by unpadded base64url of
HMAC-SHA-256(key, UTF-8(canonical preimage record)). The port zeroes temporary
raw-byte/preimage buffers after the call and retains neither. A different Realm,
source, rule, identity domain, key authority, key epoch, commitment, or raw byte
sequence therefore cannot alias the same projection namespace.

`referenceKind` is exactly `ledger-segment`, `checkpoint`, or
`recovery-journal`. A successful retain or release returns exactly `status`,
`epochReferenceRecordId`, and `epochReferenceRecordDigest`. Repeating the exact
same transition returns `already-retained` or `already-released` with the same
record pair; changing any bound field is not idempotent. `retention-blocked`
contains exactly `status` and `blockingProtectedEdgeDigests`, a nonempty code-
point-sorted unique array bounded by `maximumRetainedGraphEdges`; it reveals no
logical key. Retain `invalid` contains exactly `status` and reason
`binding-invalid`, `key-binding-mismatch`, `reference-kind-invalid`,
`reference-invalid`, `reference-conflict`, `reference-retired`,
`scope-mismatch`, or `schema-invalid`. Release `invalid` contains exactly
`status` and reason
`reference-record-invalid`, `reference-not-retained`,
`retirement-evidence-invalid`, `retirement-evidence-mismatch`,
`binding-mismatch`, `scope-mismatch`, or `schema-invalid`. Their `unavailable`
contains exactly
`status` and reason
`key-store-unavailable`, `cancelled`, or `closed`. A failed result contains no
record pair or key metadata.

`verifyEpochBinding()` first resolves the immutable binding pair and compares
the supplied authority/epoch/commitment byte-for-byte. `current`, `retained`,
and `retired` contain exactly `status`, `keyAuthorityId`, `keyEpoch`, and
`keyCommitment`. `current` means this is the operator partition's active epoch;
`retained` means an old epoch still has at least one live reference; `retired`
means only its immutable metadata tombstone remains. `invalid` contains exactly
`status` and reason `binding-invalid`, `authority-mismatch`, `epoch-mismatch`,
`commitment-mismatch`, or `scope-mismatch`. `unavailable` contains exactly
`status` and reason `key-store-unavailable`, `cancelled`, or `closed`. This
method returns no key, HMAC operation, projection handle, reference identifier,
or reactivation authority. Historical `retained` verifies binding metadata
only; `retired` is never accepted for projection or append.

`finalizeBindingRetirement()` is kernel-only terminal cleanup, not projection
or append authority. It accepts no caller-selected reason. The
`retirementReason` stored by the authority is exactly `pseudonym-key-rotated`,
`normalization-policy-changed`, `operator-retired`, or `m2-binding-changed` and
is derived through this exact precedence and mapping:

| Precedence | Continuation result | Exact continuation reason | `retirementReason` |
| ---: | --- | --- | --- |
| 1 | `retired` | `operator-superseded` | `operator-retired` |
| 2 | `retired` | `lifecycle-retired` | `operator-retired` |
| 3 | `retired` | `owner-released` | `operator-retired` |
| 4 | `changed` | `pseudonym-key-rotated` | `pseudonym-key-rotated` |
| 5 | `changed` | `normalization-policy-changed` | `normalization-policy-changed` |
| 6 | `changed` | `active-binding-changed` | `m2-binding-changed` |
| 7 | `changed` | `active-head-changed` | `m2-binding-changed` |

The pseudonym-key authority invokes the read-only continuation projection at one
protected read fence, selects the first applicable row using the exact reachable
`changed` classifier above, and appends one protected internal
`RealmObservationBindingTerminalReasonLatchV1`. The continuation service remains
read-only. The latch is not a runtime-catalog definition or application contract
and contains exactly:

```text
format
version
terminalReasonLatchId
issuerId
operatorPartitionId
realmId
bindingReceiptId
bindingDigest
continuationStatus
continuationReason
retirementReason
precedenceRank
observedCurrentBindingReceiptId?
observedCurrentBindingDigest?
continuationProjectionCloseDigest
continuationProjectionGenerationFenceDigest?
terminalReasonLatchDigest
```

`format` is
`particle-realms.realm-observation-binding-terminal-reason-latch`, `version` is
`1`, and `issuerId` is `webgpu-os-operator-pseudonym-key@1`.
`continuationStatus` is exactly `changed` or `retired`; its reason, mapped
retirement reason, and positive safe-integer `precedenceRank` must equal one row
of the table. The observed-current pair is required only for `changed` and is
the exact pair returned at that fence; `retired` omits both fields.
`continuationProjectionCloseDigest` is the exact object-identical close readback
for the operation-scoped handle used by this protected read. The optional
generation-fence digest is required when an earlier continuation-service owner
generation could have lost a handle before close; it resolves to the latest
cumulative `continuation-service` fence covering every such retired generation
and this binding pair. Otherwise it is absent. The latch CAS verifies the
terminal read, current handle close, and any required cumulative generation
fence together before the latch becomes observable. The latch ID
is the Realm content ID over every semantic field except itself and the final
digest. The final digest uses the displayed format as domain, major version
`1`, and every other field.

The first terminal result observed by the pseudonym authority for one exact old
binding pair while no latch exists installs this latch by protected compare-and-
swap. A matching existing latch wins exact readback; no
later operator, lifecycle, owner, head, policy, binding, or key transition can
replace or reclassify it. A more specific rotation or policy transition cannot
be collapsed into a generic binding/head change, and a retired state cannot be
reclassified as changed. `absent`, `recovery-pending`, `unavailable`, a
nonterminal `active`/`current` result, or a reason/result pairing outside the
table installs no latch and cannot authorize retirement.
The authority's service-private read neither exposes the continuation port to
the app nor adds a third M3A application dependency.

`finalizeBindingRetirement()` first resolves a completed retirement record for
the exact binding pair. A valid record and its terminal-reason latch return
`already-finalized` without consulting or reclassifying later live continuation
state. Otherwise the method resolves the immutable latch before constructing a
proposal. A missing, malformed, cross-binding, or record-disagreeing latch is
`invalid/terminal-reason-latch-invalid` or `invalid/reason-mismatch`; it never
falls back to a newly observed reason. This record-first rule makes blocked,
cancelled, restarted, and completed retries stable.

`finalized` and
`already-finalized` contain exactly `status`, `bindingRetirementRecordId`, and
`bindingRetirementRecordDigest`; the latter returns the same pair after the
same completed drain. `retention-blocked` contains exactly `status`,
`blockingEpochReferenceRecordIds`, `blockingEpochReferenceRecordDigests`, and
`blockingProtectedEdgeDigests`, `blockingConditionKinds`,
`blockingConditionCounts`, and `blockingConditionDigests`. The first two arrays
are same-length aligned pairs ordered by record ID in code-point order, with
unique IDs and digests. `blockingProtectedEdgeDigests` is code-point-sorted and
unique. Each of those three arrays is bounded by
`maximumRetainedGraphEdges`. The three condition arrays are equal-length
aligned rows, contain at most seven entries, and are ordered by unique
`blockingConditionKind` in code-point order. Every count is a positive safe
integer. At least one reference pair, protected-edge digest, or condition row
is present.

The closed `blockingConditionKind` set is exactly
`extension-aggregate-not-released`, `live-projection-handle`,
`mutable-durable-head`, `pending-durable-operation`, `reference-set-mismatch`,
`secret-required-protected-edge`, or `unresolved-protected-edge`. For row `i`,
`blockingConditionDigests[i]` is the Realm content ID over exactly
`format = particle-realms.realm-observation-binding-retirement-blocker`,
`version = 1`, the supplied `bindingReceiptId`/`bindingDigest`,
`blockingConditionKinds[i]`, and `blockingConditionCounts[i]` under the Realm
canonical JSON rules. This is a bounded safe blocker projection: it contains no
projection-handle identity, operation identity, storage key, logical graph key,
secret, or raw edge. The reference arrays name only exact retained epoch-
reference records that cannot yet join a terminal set; the protected-edge array
contains only resolvable safe edge digests. Every aggregate not yet released or
proven absent, live handle, pending durable operation, mutable head,
incomplete/mismatched reference snapshot, unresolved edge, or secret-dependent
edge therefore has a truthful closed result even when both ID/digest arrays are
empty. `invalid`
contains exactly `status` and reason `binding-invalid`, `binding-still-current`,
`reason-mismatch`, `terminal-reason-latch-invalid`, `terminal-set-invalid`,
`scope-mismatch`, or `schema-invalid`.
`unavailable` contains exactly `status` and reason `continuation-unavailable`,
`extension-owner-unavailable`, `key-store-unavailable`, `cancelled`, or
`closed`. Failure variants expose no key metadata, terminal
reference IDs, or partial retirement record; condition rows never substitute
for the exact terminal reference set needed by a successful drain.

Every retain/release transition appends one protected internal
`RealmObservationPseudonymEpochReferenceRecordV1`. It is not part of the M3A
runtime catalog or application contract and contains exactly:

```text
format
version
epochReferenceRecordId
issuerId
operatorPartitionId
bindingReceiptId
bindingDigest
keyAuthorityId
keyEpoch
keyCommitment
referenceKind
referenceId
referenceDigest
referenceState
predecessorStateRecordId
predecessorStateDigest
transitionEvidenceKind
transitionEvidenceId
transitionEvidenceDigest
epochReferenceRecordDigest
```

`format` is
`particle-realms.realm-observation-pseudonym-epoch-reference`, `version` is `1`,
and `issuerId` is `webgpu-os-operator-pseudonym-key@1`. `referenceState` is
exactly `retained` or `released`. For `retained`, both predecessor and all
evidence fields are absent. For `released`, both predecessor fields are required
and resolve to the exact current `retained` record, while the three evidence
fields are required. `transitionEvidenceKind` is `ledger-compaction` for a
nonterminal `ledger-segment`, `checkpoint-successor` for a nonterminal
`checkpoint`, or `recovery-journal-checkpointed` for a nonterminal
`recovery-journal`. `binding-retirement` is permitted for any of the three
kinds only when the referenced retained record appears in the exact terminal
set of the resolved binding-retirement record below; every other pairing fails.
`epochReferenceRecordId` is the Realm content ID over all semantic fields
except itself and the final digest. `epochReferenceRecordDigest` uses the
displayed format as domain, major version `1`, and every other present field.

The retain transition commits atomically with the protected authority-root CAS
before the referenced segment, checkpoint, or recovery-journal head becomes
current or visible. A release verifies exact retirement evidence, current
predecessor state, and absence of every protected edge that still requires that
ordinary reference before committing its append-only terminal record. The
separate terminal binding CAS applies its stricter complete-set graph rule below.
Ledger compaction releases each
retired segment reference only after its committed compaction receipt resolves.
A verified checkpoint successor separately releases a superseded checkpoint
reference. A verified checkpoint that retains the recovery receipt and cursor
lineage separately releases the replaced recovery-journal reference. No one
ordinary operation may release another reference kind; the complete terminal
binding-retirement CAS below is the sole multi-kind exception. An uncertain or
conflicting operation retains the reference.

If atomic root/reference grouping cannot be established, retain/release returns
`unavailable` before either dispatch. After dispatch, cancellation or transport
loss cannot produce `unavailable`: the authority completes exact protected
readback and returns the terminal success/idempotent result or
`retention-blocked`. These lifecycle methods therefore have no externally
uncertain mutation variant.

Normal successor/compaction evidence cannot retire the last durable roots of a
binding: its final segment has no retained successor and its final checkpoint
has no same-binding successor. `finalizeBindingRetirement()` closes that exact
terminal case. It runs only after the continuation fence proves the portable
binding is no longer current for the exact derived reason-map row above and the
protected terminal-reason latch resolves. That latch requires object-identical
close readback for its current operation-scoped service projection plus any
needed cumulative retired continuation-generation fence. A live ingress
generation requires object-identical close readback if a handle was acquired,
or exact sealed nonissuance evidence if no handle was ever issued. Any earlier
crashed generation under the same binding also requires the exact cumulative
retired-generation zero-handle/zero-in-flight fence; protected `released`
extension-owner terminal evidence binds both that prior fence and the current
generation's terminal proof. If no later aggregate was released, protected
`absent-after-restart` evidence instead binds the fence as its sole projection
proof. The extension aggregate must be released or proven absent by that
complete-lineage evidence, every durable proposal is terminally reconciled, and
the final active ledger segment is closed.

Before proposal construction, the authority snapshots every current `retained`
epoch-reference record whose binding pair equals the retired binding. That
complete binding set, across all three reference kinds, is terminal for secret-
key use even when the separately retained immutable segment/checkpoint/journal
data remains available through metadata and content digests. The drain never
deletes or releases those data-retention roots. An omitted or extra reference,
a reference from another binding/epoch, an uncertain proposal, an aggregate
without terminal evidence, a live projection handle, a mutable durable head, an
unresolved graph edge, or an edge whose policy still requires secret-key
material produces `retention-blocked`; it cannot be smuggled into the terminal
set.

The authority then constructs one protected internal
`RealmObservationPseudonymBindingRetirementRecordV1`. It is not a runtime-
catalog definition or application contract and contains exactly:

```text
format
version
bindingRetirementRecordId
issuerId
operatorPartitionId
realmId
bindingReceiptId
bindingDigest
keyAuthorityId
keyEpoch
keyCommitment
terminalReasonLatchId
terminalReasonLatchDigest
retirementReason
extensionAggregateTerminalEvidenceKind
extensionAggregateTerminalEvidenceDigest
projectionTerminalEvidenceKind
projectionTerminalEvidenceDigest
priorIngressProjectionGenerationFenceDigest?
expectedReferenceRootDigest
terminalReferenceKinds
terminalReferenceIds
terminalReferenceDigests
terminalEpochReferenceRecordIds
terminalEpochReferenceRecordDigests
verifiedProtectedGraphDigest
verifiedNoLiveProjection
verifiedNoPendingDurableOperation
expectedRemainingEpochReferenceCountAfterDrain
keyDispositionAfterDrain
bindingRetirementRecordDigest
```

`format` is
`particle-realms.realm-observation-pseudonym-binding-retirement`, `version` is
`1`, and `issuerId` is `webgpu-os-operator-pseudonym-key@1`. The five terminal
arrays have equal length, are ordered by `(referenceKind, referenceId)` using
code-point order, contain unique tuples, may be empty, and contain at most
`maximumRetainedGraphEdges` entries. Every epoch-reference pair resolves to the
current `retained` record for its matching kind/reference pair and exact
binding/key triple.
`terminalReasonLatchId` and `terminalReasonLatchDigest` resolve byte-for-byte to
the exact immutable latch for this binding; `retirementReason` equals that
latch. `extensionAggregateTerminalEvidenceKind` is exactly `released` or
`absent-after-restart`, and its digest resolves to the protected extension-owner
terminal evidence defined in the lifecycle section for this exact binding and
kind. `projectionTerminalEvidenceKind` and
`projectionTerminalEvidenceDigest` equal the corresponding fields inside that
resolved evidence byte-for-byte: object-identical close or sealed nonissuance
for the released generation, or the exact retired-generation fence for absence
after restart. `priorIngressProjectionGenerationFenceDigest` equals the
optional field in that evidence byte-for-byte. It is present only for
`released` evidence whose exact binding lineage contains an earlier retired
ingress generation without object-identical close; it is absent for
`absent-after-restart` because that branch's primary projection evidence is
already the cumulative fence. The record resolves and verifies every present
nonissuance or fence object rather than trusting a nested digest.
`expectedReferenceRootDigest` is the exact protected reference root compared by
the drain CAS. `verifiedProtectedGraphDigest` is the resolved final checkpoint
graph digest when a checkpoint exists; otherwise it is the canonical empty-
graph digest only after protected-graph-head readback proves that no edge
exists. Both verification booleans are literal `true`.

`expectedRemainingEpochReferenceCountAfterDrain` is a nonnegative safe integer
recomputed from the compared reference root after removing exactly the terminal
set. `keyDispositionAfterDrain` is `retired` only for a noncurrent historical
epoch whose recomputed count is zero, `historical-retained` for a noncurrent
epoch with a positive count, and `current-retained` for the current epoch at any
count. A current epoch remains `current-retained` at count zero. The record ID
is the Realm content ID over every semantic field except itself and the final digest;
the final digest uses the displayed format as domain, major version `1`, and
every other field.

One protected CAS compares the exact terminal-reason latch, extension-aggregate
terminal evidence, its current object-close/nonissuance or absent-after-restart
fence, every required prior ingress-generation fence, the reference root,
binding-retirement state, terminal ledger/checkpoint/journal heads, exact
current-generation and retired-generation projection-handle/in-flight-call
counts for the old binding, and pending-operation count.
It then installs the retirement record, appends the released-
state transition for every terminal reference with
`transitionEvidenceKind = binding-retirement` and this record's ID/digest,
updates the reference root, and conditionally erases the old secret plus
installs its metadata tombstone. All changes commit together or none do. Exact
readback after cancellation, transport loss, or restart returns `finalized` or
`already-finalized`; there is no uncertain partial drain. Thus the final old-
binding segment, checkpoint, and source-journal heads can reach zero references
without inventing a successor, while live/current or nonterminal evidence
cannot use this path.

Rotation is an explicit kernel-authority operation, never a consumer restart or
timer side effect. It installs a fresh 256-bit key, increments `keyEpoch`, and
changes `keyCommitment` atomically. The continuation fence then returns
`changed/pseudonym-key-rotated` or
`recovery-pending/pseudonym-key-rotation-pending`; M3A closes its current
extension, advances all seven source generations, rejects every old cursor and
checkpoint binding, and begins fresh bounded snapshots under a newly issued
portable binding. Old keys remain protected and non-app-visible only while a
retained binding/checkpoint/ledger lineage requires that epoch for verification;
the append-only reference records above are the sole retirement accounting
authority. The current epoch remains retained even when its reference count is
zero. After the old extension closes, the exact terminal binding-retirement CAS
drains final roots that cannot lawfully acquire successors. An old epoch's key
material is retired only after all three reference classes have zero current
`retained` records; its authority/epoch/commitment
metadata tombstone remains permanently verifiable as `retired`. The authority
never reuses an epoch, deletes that tombstone, restores an old key as current,
or permits cross-epoch append.

Code Matter joins through an independent M3D manifest. Genesis joins through
an independent optional M3F manifest. Station and remote-presence observations
join no earlier than M5. None changes the seven-source M3A base count.

`RealmHistoricalWitnessProjector` is an M3B pure projector, not an eighth raw
source. It can derive an audience-valid historical view only from an admitted
observation whose assertion, temporal, retention, and authority evidence permit
that view. It cannot select truth or reactivate a rejected branch.

### One storage authority, two domain views

Filesystem and storage are two projection concerns over one canonical source,
not two independently counted mutations.

`RealmCanonicalStorageEventSink` is inserted at the `StorageManager` event
authority before listener fan-out and cross-context coordination. It assigns
one adapter-private canonical raw-mutation ID and raw-event ordinal before
fan-out; it does not assign an M3A source generation or source sequence.
`VirtualFS` may consume that event for cache coherence, but M3A does not
separately subscribe to `VirtualFS._emit()` and recount it.

`RealmCanonicalStorageObservationAdapter` emits exactly one primary M0
observation for one canonical raw mutation:

- `filesystem` when the mutation changes authorized opaque containment, entry
  class, relationship, or coverage;
- `storage` when the event changes only admitted store lifecycle or health;
- neither when only excluded protected-service or raw compatibility state
  changes.

Usage, capacity, pressure, and operation-rate `storage` observations are
separate deterministic sample-window records. They cite the admitted primary
mutation observations they summarize through `causalPredecessorIds`; they are
not a second copy of one raw operation. The internal canonical mutation ID is
consumed when the primary observation ID is derived and never becomes an
untyped payload field.

The canonical-storage adapter alone assigns the source generation and one
canonical-source sequence to the primary observation. The coordinator validates
and admits that already assigned tuple exactly once; it never assigns or
renumbers it. The later filesystem and storage domain projectors may both read
that admitted observation where their declared mappings require it, but metrics
and world traffic cannot count it as two underlying operations.

M3A excludes its own protected ledger, checkpoint, operation, compaction, and
Chronicle storage namespaces from storage observation. This prevents recursive
self-observation. The exclusion is enforced inside the trusted storage adapter,
not by sending protected logical keys to the app.

## Actual source upgrades

The work package reuses existing authorities and adds narrow instrumentation:

| Existing surface | Current usable behavior | Required additive M3A behavior |
| --- | --- | --- |
| `KernelBootstrap._boot({ onProgress })` | Emits presentation-oriented phase/outcome callbacks during one boot | Route the same bounded milestones into an early boot adapter; retain a safe current-phase snapshot and source generation without raw logs |
| `ProcessTable.list()` and `onChange()` | Sanitized list plus register/unregister callbacks; metrics include browser estimates | Add one adapter-owned sequence, opaque subject mapping, explicit metric quality/sampling policy, state snapshots, and lifecycle fencing |
| `StorageManager.on()` and `_emit()` | Ordered local sequence and cross-context delivery, but raw path-bearing payloads | Assign canonical mutation identity before fan-out, retain origin continuity across coordination, expose a protected snapshot/tail seam, and normalize before app delivery |
| `VirtualFS` canonical-storage observer | Keeps synchronous cache coherent and also emits VFS events | Preserve canonical event identity for cache updates; prohibit a second M3A subscription to VFS emissions |
| Kernel IPC bus | Delivers application events but has no uniform safe lifecycle stream | Add a payload-free sink at create/enqueue/deliver/drop/fail boundaries with opaque endpoints and bounded metrics |
| `guardSyscalls()` | Enforces permission and lifecycle at call time | Add a sink around entry, authority decision, dispatch, and terminal result without observing arguments or return values |
| `Permissions` | Checks, grants, revokes, persists, and audits decisions | Add one ordered decision/policy stream including epoch, expiry/revocation, safe reason, and retained authority reference without token material |
| `NetworkDriver.endpointStatus()` and `onEndpointStatus()` | Expose secret-free endpoint/route summaries internally, including state that can describe peers | Add an M3-local projection that structurally removes peer identity, remote presence, address, route secret, packet, and remote count fields |

No source adapter imports renderer, ECS, Storylet, RealmForge, or Playground
modules. No Realm app module imports these concrete managers.

### Repository patterns reused through new Realm-owned code

M3A does not need a second queue, lifecycle, handoff, or State-First philosophy.
It does need Realm-specific implementations because the existing helpers have
different authority and failure contracts.

| Existing implementation | Reused invariant | M3A hardening or boundary |
| --- | --- | --- |
| `webgpu-os/platform/network-host/StableNetworkHost.js` and `StableNetworkClient.js` | Count/byte queue bounds, retained floor, cursor export/import, ordered replay, ACK | Oversized/expired critical records fail visibly closed; a warning or silent drop is insufficient |
| `webgpu-os/platform/media-host/StableMediaHost.js` and `StableMediaClient.js` | Overflow poisons a transition and blocks promotion | Apply the same fail-closed principle per source, with an exact lost interval and mandatory resnapshot |
| `webgpu-os/platform/runtime-host/KernelRuntimeHandoff.js` | Serialize cursors/state only; keep handles and secrets with owners; order freeze/commit/rollback | M3A uses a separate protected sidecar and does not pretend M2 handoff V1 verifies its graph |
| `webgpu-os/kernel/OperatorContext.js` | Advance generation before teardown; capture/assert current; freeze, drain, bind, resume | Bind every M3A live view to both OperatorContext and the exact M2 lifecycle/process owner |
| `webgpu-os/kernel/GpuRuntimeCoordinator.js` and `GpuDeviceBroker.js` | Invalidate stale generation before staged recovery and fence owned resources | GPU generation is never substituted for operator, M2 lifecycle, ingress, or source generation |
| `engine/render/state/StateFirstEcsSourceAdapter.js` and `StateFirstSourceBridge.js` | Read-only authoritative entity snapshots, explicit source descriptors, detach-before-destroy, presentation cannot invent state | M3B consumes M3A output later; M3A imports neither adapter nor ECS and never treats State-First evidence as source authority |
| `engine/state/integrity/EventLog.js` | Hash-linked append evidence | Existing log is unbounded and lacks M3A redaction/cursor/retention; reuse the invariant, not the implementation |
| `engine/state/FactStore.js`, `EntityRegistry.js`, and `World.js` | Monotonic versions, generation-safe identity, bounded diagnostic projection | These are projections/state stores, not ordered observation feeds or durable M3A checkpoint authority |

This keeps the implementation original, modular, and aligned with real engine
behavior while avoiding copied Playground expression or incompatible helper
semantics.

## Separate M3A runtime catalog

M3A adds exactly eleven runtime coordination definitions through the existing
side-effect-free `VirtualRealmContractRegistry`. It neither mutates nor reorders
the frozen M0-M1C catalog and it does not duplicate the M0 observation schemas.

The catalog order is exactly:

1. `RealmObservationIngressProfileV1`
2. `RealmObservationSourceManifestV1`
3. `RealmObservationSourceDescriptorV1`
4. `RealmObservationIngressBindingV1`
5. `RealmObservationSourceCursorV1`
6. `RealmObservationBatchV1`
7. `RealmObservationIngressCheckpointV1`
8. `RealmObservationIngressRecoveryReceiptV1`
9. `RealmObservationLedgerAppendReceiptV1`
10. `RealmObservationCheckpointCommitReceiptV1`
11. `RealmObservationLedgerCompactionReceiptV1`

The planned files are:

```text
webgpu-os/apps/the-virtual-realm/observation-contracts/
  RealmObservationRuntimeContractPrimitives.js
  RealmObservationIngressProfileContract.js
  RealmObservationSourceManifestContract.js
  RealmObservationSourceDescriptorContract.js
  RealmObservationIngressBindingContract.js
  RealmObservationSourceCursorContract.js
  RealmObservationBatchContract.js
  RealmObservationIngressCheckpointContract.js
  RealmObservationIngressRecoveryReceiptContract.js
  RealmObservationLedgerAppendReceiptContract.js
  RealmObservationCheckpointCommitReceiptContract.js
  RealmObservationLedgerCompactionReceiptContract.js
  VirtualRealmM3AObservationContractCatalog.js
```

Every module is import-inert. The catalog initializes only when the M3A
composition root explicitly calls its initializer. No definition contains a
live port, callback, handle, manager, abort controller, Promise, storage key,
GPU object, executable expression, raw source event, or plaintext payload.

## Exact base ingress profile

`RealmObservationIngressProfileV1` has exactly 34 own top-level fields. Unknown,
missing, inherited, symbol, accessor, mutable, non-canonical, or out-of-range
fields fail before acquisition.

| Field | Exact base value |
| --- | ---: |
| `format` | `particle-realms.realm-observation-ingress-profile` |
| `version` | `1` |
| `profileId` | `observation-ingress:virtual-realm-m3a-base-v1` |
| `canonicalEncodingProfileId` | `canonicalization:realm-bake-json-v1` |
| `digestAlgorithm` | `SHA-256` |
| `sourceManifestId` | `observation-source-manifest:virtual-realm-m3a-base-v1` |
| `sourceManifestDigest` | Recomputed manifest digest |
| `maximumSourceCount` | `7` |
| `maximumOpenCursorsPerSource` | `1` |
| `maximumSnapshotRecordsPerSource` | `65536` |
| `maximumSnapshotBytesPerSource` | `67108864` |
| `maximumSnapshotRecordsTotal` | `131072` |
| `maximumSnapshotBytesTotal` | `134217728` |
| `maximumRecordBytes` | `65536` |
| `maximumBatchRecords` | `1024` |
| `maximumBatchBytes` | `4194304` |
| `maximumBufferedRecordsPerSource` | `16384` |
| `maximumBufferedBytesPerSource` | `16777216` |
| `maximumBufferedRecordsTotal` | `65536` |
| `maximumBufferedBytesTotal` | `67108864` |
| `maximumPendingCausalRecords` | `8192` |
| `maximumPendingCausalBytes` | `8388608` |
| `maximumCausalParentsPerRecord` | `16` |
| `maximumCausalDepth` | `64` |
| `maximumDuplicateWindowPerSource` | `32768` |
| `maximumLedgerSegmentRecords` | `2048` |
| `maximumLedgerSegmentBytes` | `8388608` |
| `maximumRetainedLedgerSegments` | `16` |
| `maximumCheckpointBytes` | `1048576` |
| `maximumRetainedGraphEdges` | `4096` |
| `maximumRecoveryAttemptsPerSource` | `3` |
| `maximumDiagnosticEntries` | `256` |
| `maximumDiagnosticBytes` | `262144` |
| `profileDigest` | SHA-256 Realm content ID over the other 33 fields |

The digest uses the existing Realm canonical JSON rules and excludes exactly
`profileDigest`. All integers are finite safe integers. Limits are independent:
passing a record-count limit does not waive its byte limit, and passing every
per-source limit does not waive the global limit. Exact-bound fixtures pass;
plus-one fixtures fail without partial admission.

These are V1 safety ceilings, not performance targets. Production profiling
may choose a stricter code-shipped profile with a new ID and digest. Runtime
configuration cannot raise a limit, alter the manifest, or change digest
semantics.

## Exact source descriptor, binding receipt, and cursor separation

`RealmObservationSourceDescriptorV1` describes portable source capability. It
contains exactly:

```text
format
version
sourceId
sourceKind
adapterId
adapterVersion
portName
portVersion
sourceSchemaVersions
allowedObservationKinds
safeNormalizationProfileId
safeNormalizationProfileDigest
retentionClass
startupAvailability
supportsSnapshot
supportsResume
sourceDescriptorDigest
```

Arrays are nonempty, code-point sorted, unique, and exact to the source manifest
row. Every repeated scalar is byte-identical to that row;
`startupAvailability` is `explicit-degraded`, while `supportsSnapshot` and
`supportsResume` are both exactly `true` for every base adapter and are covered
by the descriptor digest. A descriptor contains no current
operator, owner, lifecycle, generation, callback, or live handle.
`format` is `particle-realms.realm-observation-source-descriptor`, `version` is
`1`, and `sourceDescriptorDigest` is the Realm content ID over every other
displayed field using that format/domain and major version.

`RealmObservationIngressBindingV1` is the serialized, powerless equality
receipt for the service-issued prebound tuple. It contains exactly:

```text
format
version
bindingReceiptId
operatorPartitionId
operatorGeneration
realmId
processOwnerId
m2LifecycleGeneration
m2RuntimeBundleId
m2RuntimeCapabilityProfileId
m2RuntimeCapabilityProfileDigest
admissionIndexDigest
publicationHeadBinding
admissionHeadBinding
visiblePointerGeneration
visibleCommitReceiptDigest
activeBakeOutputRecordDigest
audienceClass
disclosureClass
safeNormalizationProfileId
safeNormalizationProfileDigest
pseudonymKeyAuthorityId
pseudonymKeyEpoch
pseudonymKeyCommitment
m3aObservationProfileId
m3aObservationProfileDigest
m3aContractCatalogId
m3aContractCatalogDigest
m3aSourceManifestId
m3aSourceManifestDigest
bindingDigest
```

`format` is `particle-realms.realm-observation-ingress-binding` and `version`
is `1`. `audienceClass` is exactly `owner-private`; `disclosureClass` is
exactly `local-private`. `bindingDigest` is the Realm content ID over every
other displayed field, including `bindingReceiptId`, with only `bindingDigest`
excluded. The trusted service derives every field
from the one fenced M2 continuation projection plus the verified M3A constants,
then exposes the byte-identical record through both accepted prebound ports. The
pseudonym authority triple is copied only from the current internal projection;
the key never enters the receipt. The app can present the receipt ID only
as an equality expectation and cannot author, attenuate, widen, or refresh the
receipt. The record contains no liveness handle, callback, abort signal,
manager, work-root ID, storage key, capability token, or executable authority.

`bindingReceiptId` is the deterministic Realm content ID over the semantic
binding fields with `bindingReceiptId` and `bindingDigest` excluded, using the
binding format/domain and major version `1`. It contains no wall time, random
nonce, or caller input. The same still-current fenced M2 projection and M3A
constants therefore reproduce the same receipt ID/digest across consumer
restart; any semantic field change produces a different pair. Consumers still
call `assertCurrent()` and cannot substitute byte equality for live authority.

`RealmObservationSourceCursorV1` is the portable verified source position. It
contains exactly:

```text
format
version
bindingReceiptId
bindingDigest
sourceId
sourceDescriptorDigest
adapterVersion
sourceSchemaVersions
sourceGeneration
snapshotWatermark
acceptedThroughSequence
nextExpectedSequence
earliestRetainedSequence
highWatermark
cursorState
gapStartSequence
gapEndSequence
safeNormalizationProfileId
safeNormalizationProfileDigest
retentionClass
cursorDigest
```

`bindingReceiptId`/`bindingDigest` resolves to the exact accepted portable
binding, including its pseudonym-key authority, epoch, and commitment.
`sourceDescriptorDigest` resolves to the exact accepted source descriptor for
that binding's manifest row. `gapStartSequence` and `gapEndSequence` exist exactly
when `cursorState = gap`.
`acceptedThroughSequence + 1 = nextExpectedSequence`. A cursor never advances
over an unseen, invalid, uncommitted, or overflow-lost record.
`cursorState` is exactly `snapshot-retained`, `accepted`, `gap`, `stale`, or
`closed`. `format` is `particle-realms.realm-observation-source-cursor`,
`version` is `1`, and `cursorDigest` is the Realm content ID over every other
displayed field using that format/domain and major version. State-specific
fields from another state, unknown fields, or a cursor not matching its exact
manifest/descriptor/normalization tuple fail.

The binding receipt and portable cursor are not live authority. A separate
process-local branded `realmObservationIngressBinding@1` handle binds the exact
receipt digest, ingress generation, source cursor, M3A extension-child ID,
opaque work/teardown roots, and abort signal. The single-use aggregate release
handle remains only in `RealmObservationIngressCoordinator` and is never passed
to a source. Neither root has a serializable ID. The live binding is never
serialized, logged, stored, handed off, or returned to M3B.

Each source port instead receives one non-callable branded
`realmObservationSourceLiveBinding@1` containing only the portable binding
digest, ingress generation, source ID/descriptor digest/generation/cursor
digest, the branded extension-child identity for equality, a source-local lease
brand, and its work abort signal. It contains no work/teardown root, aggregate
release handle, resource-ledger mutator, or sibling-source capability.

The ledger-accepted cursor and later M3B projection-applied cursor are separate.
M3A cannot claim that an admitted record changed the world.

## Atomic source-open protocol

Every internal source port implements one exact generation-fenced protocol:

```text
descriptor()
  -> RealmObservationSourceDescriptorV1

openCursor({
  expectedBindingReceipt,
  expectedDescriptorDigest,
  resumeCursor,
  limits,
  signal
})
  -> ready | changed | gap | unavailable | closed

captureCut({
  liveBinding,
  afterSequence,
  maximumRecords,
  maximumBytes,
  signal
})
  -> records | empty | gap | overflow | changed | unavailable | closed

subscribeWake({ liveBinding, signal }, listener)
  -> idempotent unsubscribe

closeCursor({ liveBinding, reason })
  -> idempotent close receipt
```

`openCursor()` registers live-tail capture before it freezes the snapshot and
watermark. A `ready` result contains the exact descriptor, source generation,
earliest retained sequence, snapshot record IDs and records, snapshot
watermark, subscribed-start sequence, cursor, and branded live binding. Any
event after the watermark is already retained for that binding before `ready`
is observable. No snapshot-to-subscription gap exists.

`resumeCursor` is a hint, never authority. Resume succeeds only when descriptor,
binding receipt/digest, pseudonym-key epoch/commitment, adapter version, source
schema versions, source generation, normalization profile, earliest retained
sequence, and exact prior cursor digest still match.
Otherwise the source returns `changed`, `gap`, or `unavailable` and the
coordinator performs a fresh bounded snapshot.

Wake callbacks carry no records, watermarks, outcomes, or authority. They only
announce that a caller may invoke `captureCut()`. A callback may be duplicated,
delayed, or omitted without changing admitted bytes. The port prevents
reentrant capture for one live binding.

Every non-ready result contains zero partial observations and one bounded safe
reason code. `closeCursor()` is teardown-only, idempotent, detaches the source
tail exactly once, and proves callback quiescence before its child can be
released from the extension aggregate's private resource ledger. A source is
never an ownership child.

## Canonical source generations and identity

Exactly one trusted adapter assigns `(sourceId, sourceGeneration,
sourceSequence)` for each source row.

- `sourceGeneration` starts at a positive safe integer and strictly increases
  when source continuity cannot be proven.
- `sourceSequence = 0` is reserved for an empty initial watermark. The first
  observation in every source generation is exactly `1`; each later observation
  is exactly its immediately preceding issued sequence plus one. No positive
  value is skipped or reused within that generation.
- A source restart, adapter replacement, retention discontinuity, or corruption
  creates a new source generation.
- A pseudonym-key rotation advances every source generation and forces a fresh
  snapshot under the new binding; no old cursor or record can cross the epoch.
- A consumer restart can resume the same source generation only while the
  source retains the exact cursor interval.
- Near safe-integer exhaustion, the adapter closes the generation and starts a
  new one before issuing another record.

`observationId` and `observationDigest` are recomputed from the existing M0
contract. Repeating the same `(sourceId, sourceGeneration, sourceSequence)` with
the same ID and digest is a duplicate. Repeating that tuple with different
bytes, ID, or digest is equivocation and quarantines the source; it is never
treated as an ordinary duplicate.

Raw identifiers become owner-private stable IDs before the M0 record is built.
`RealmObservationIdentityProjector` can call only the branded current
`identityProjection` handle described above. It supplies the source kind,
normalization rule ID, and copied bounded raw bytes; the key authority adds the
handle-bound operator partition, Realm, authority, epoch, commitment, and the
rule's exact identity domain to the frozen HMAC preimage. The operator partition
is context, never key material, and no caller can select a key or HMAC domain.
The raw input and preimage are zeroed after projection and are never retained in
the Realm ledger. Future public/refinement projections use independent
namespaces and cannot reuse this owner-private ID.

## Snapshot and live reconciliation

For each source, the coordinator performs exactly:

1. Validate the aggregate prebound tuple and current M2 liveness.
2. Validate the exact code-shipped profile, catalog, manifest, descriptor, and
   normalization policy objects plus their recomputed digests.
3. Register the source's handles, tail, and ring as resources beneath the one
   already claimed M3A extension child; no source is an M2 process child.
4. Call atomic `openCursor()` with the prior portable cursor only as a hint.
5. Validate every returned M0 observation and source tuple before admitting any
   record.
6. Append the complete snapshot cut or no snapshot records at all.
7. Set `acceptedThroughSequence` to the committed ledger watermark.
8. Capture later sealed cuts, buffer only bounded causal or reorder work, and
   append complete canonical batches.
9. On gap, overflow, replacement, or incompatibility, stop delivery for that
   source, preserve its last accepted cursor, and publish an explicit stale
   recovery state to M3B.
10. Resume only after a fresh atomic open proves snapshot, retained tail,
    cursor, policy, and ledger predecessor consistency.

A source can recover independently. The aggregate entry may remain live with a
source explicitly stale or unavailable when policy permits. Required-source
availability for a particular later route or Storylet is decided by that later
consumer; M3A never invents missing facts.

## Causal validation

M3A uses a flat `RealmObservationCausalValidator` peer. It may call accepted CSE
graph-checking functions through a narrow version-checked adapter, but it does
not import a Playground implementation, select a branch, commit an OS fact, or
write an active CSE root.

For every observation:

- `causalPredecessorIds` are code-point sorted, unique, and limited by
  `maximumCausalParentsPerRecord` even though the broader M0 schema permits
  more;
- every predecessor is already in the verified ledger or appears earlier in
  the same canonical topological cut;
- a record cannot name itself, a descendant, an unknown expired record, or an
  audience/policy-incompatible record;
- maximum transitive depth is `maximumCausalDepth`;
- pending children waiting for a delayed parent obey both causal-pending limits;
- cycles, conflicting parent bytes, and unverifiable receipt references fail
  before append.

Cross-source observations remain concurrent without explicit predecessors.
Wall time, arrival time, callback order, frame order, source-manifest order,
serialization order, visual proximity, and route shape never create a
happens-before edge.

## Deterministic vector-watermark cuts

Push timing and ring pressure cannot define batch bytes. The ingress coordinator
uses ledger-issued vector-watermark cuts:

1. At an injected logical ingress cycle, request each live source's retained
   high watermark without consuming records.
2. Freeze the seven-row vector in source-manifest order. Stale or unavailable
   sources contribute an explicit state and their last accepted cursor.
3. Drain every source only through that frozen watermark.
4. Reject a cut if any source claimed a watermark whose complete interval is
   unavailable.
5. Validate M0 schemas, digests, source sequences, duplicates, policy, and
   causal closure.
6. Topologically order explicit causal edges. Within one topological layer use
   `(sourceManifestOrder, sourceGeneration, sourceSequence, observationId)` as
   the byte-order tie-breaker.
7. Chunk only by `maximumBatchRecords` and `maximumBatchBytes`. A record is
   never split.
8. Append each chunk through exact predecessor/proposal ledger CAS.
9. Commit the source cursor vector, batch sequence, ledger head, and append
   receipt together or none of them.

The canonical order is a serialization decision, not a causal claim.

For an identical frozen input trace, policy/profile/catalog/manifest, source
generations, source watermarks, ingress-cycle schedule, durable next batch
sequence, and predecessor ledger head, duplicate, reordered,
delayed-to-consumer, and segmented delivery yields byte-identical batches. A
consumer restart within the same portable binding and retained source/ledger
lineage restores that sequence and also reproduces the same bytes; its new
process-local ingress generation has no place in the batch contract.

An actual source restart must advance `sourceGeneration`; generation-bound
batches therefore cannot be byte-identical to the prior generation. The gate is
instead deterministic semantic recovery: the same replacement snapshot, key
epoch, and prior checkpoint yield the same opening-cut digest, new-generation
batches, next cursor, and appended or empty no-record commit proof. The recovery
receipt itself intentionally also binds process-local ingress generation,
attempt ordinal, and detection/completion logical ticks, so separately executed
attempts are not claimed byte-identical. Exact replay of one already durable
receipt returns its original immutable bytes.

## Backpressure and no-loss rule

Every source has independent record and byte rings plus aggregate record and
byte accounting. Each ring exposes its earliest retained sequence, high
watermark, occupancy, and overflow state. The coordinator acknowledges a floor
only after the corresponding ledger append is durably verified.

M3A never silently drops a protected event. When a ring cannot retain the next
record:

1. delivery for that source pauses;
2. its last accepted cursor remains unchanged;
3. the source reports the exact lost interval and pre-overflow occupancy in an
   overflow-detected recovery receipt;
4. M3B is told that source is stale;
5. the live binding closes after quiescence;
6. a fresh snapshot is required;
7. recovery receives a distinct recovered receipt only after the new snapshot,
   tail, cursor, and ledger head commit.

Security, failure, authority, denial, revocation, expiry, lifecycle, gap,
overflow, and any observation named as a causal predecessor are never
coalesced.

Coalescing is permitted only after individual M0 records have passed schema,
digest, source-sequence, and safe-normalization admission, and only for these
unreferenced metric events within one frozen vector cut:

| Observation kind | Event | Key | Deterministic result |
| --- | --- | --- | --- |
| `process` | `metrics-sampled` | `(processId, metricKind, unit, evidenceQuality)` | Retain the highest source sequence; metric window and min/max cover the exact admitted interval |
| `storage` | `usage-sampled` or `operation-sampled` | `(storeId, eventKind, operationClass)` | Retain the highest source sequence and exact interval aggregates |
| `network` | `traffic-sampled` | `(routeId, protocolClass, routeClass)` after all M3 remote fields are absent | Retain the highest source sequence and exact interval aggregates |

Coalescing never changes the ledger's source acceptance history. The ledger
retains every individual admitted record and folds the deterministic summary
groups/proof into the registered `RealmObservationBatchV1`; M3B may consume that
summarized view. There is no separate unregistered coordination record and no
pressure-triggered or wall-time-triggered coalescing.

## `RealmObservationBatchV1`

An admitted batch contains exactly:

```text
format
version
batchId
realmId
bindingReceiptId
bindingDigest
operatorPartitionId
operatorGeneration
processOwnerId
m2LifecycleGeneration
m2RuntimeBundleId
admissionIndexDigest
activeBakeOutputRecordDigest
observationProfileId
observationProfileDigest
contractCatalogId
contractCatalogDigest
sourceManifestId
sourceManifestDigest
safeNormalizationProfileId
safeNormalizationProfileDigest
audienceClass
disclosureClass
batchSequence
vectorWatermarkBefore
vectorWatermarkAfter
observationIds
observationDigests
recordCount
recordByteCount
causalProofDigest
admissionOrderProfileId
metricCoalescingGroups
metricCoalescingProofDigest
ledgerPredecessorReceiptId
ledgerPredecessorReceiptDigest
batchDigest
```

The observation arrays are exact, nonempty, same-length, and ordered by the
deterministic cut. `recordCount` and `recordByteCount` are recomputed. The
binding receipt/digest resolves to the exact retained
`RealmObservationIngressBindingV1`; every duplicated scope/policy field must be
byte-identical to it. Both audience fields are fixed to `owner-private` and
`local-private`. The batch stores observation IDs/digests and the ledger owns
the canonical observation bytes; the app-facing reader resolves records only
through the same protected lease and byte limits.
`ledgerPredecessorReceiptId`/`ledgerPredecessorReceiptDigest` resolves to the
exact verified current append/head receipt. Both fields are absent exactly when
`batchSequence = 1` and exact readback proves that no ledger head exists for the
binding; the first append CAS therefore compares against absence. Both are
required for every later batch. One field without the other, a noncurrent pair,
or absence against a nonempty ledger fails before proposal construction.

`metricCoalescingGroups` folds deterministic metric-summary proof into this
registered batch contract; no unregistered coalescing receipt exists. The array
is code-point sorted by `(observationKind, eventKind, coalescingKeyDigest)`, may
be empty, and each exact closed group contains:

```text
observationKind
eventKind
coalescingKeyDigest
memberObservationIds
memberObservationDigests
firstSourceSequence
lastSourceSequence
retainedObservationId
retainedObservationDigest
memberCount
resultMetricValueDigest
groupDigest
```

Member arrays are nonempty, same-length, source-sequence ordered, and a
subset-or-equal selection from the batch observation arrays. Every member pair
must occur in the batch, and one observation may occur in at most one
coalescing group; equality is valid when the entire batch consists of one
coalescible metric group. The retained member is the exact highest source
sequence permitted by one of the three fixed rules. The result metric digest
binds the exact aggregate/window values without removing an individual ledger
member. `metricCoalescingProofDigest` hashes the complete ordered group array
and fixed coalescing-policy ID; the batch digest covers it.

Batch `format` is `particle-realms.realm-observation-batch`, `version` is `1`,
and `batchId` is the deterministic content ID over the portable binding scope,
durable batch sequence, vector cut, ordered observation IDs/digests, causal
proof, and coalescing proof. The process-local `ingressGeneration` and scheduler
cycle counter are never serialized into a batch or its identity. `batchDigest`
covers every displayed field except itself using the batch format/domain and
major version. A batch ID/digest disagreement fails before append.

Ordinary live empty cuts do not create empty batches, advance an accepted
cursor, or change the ledger; they produce only bounded diagnostics. Initial
empty acquisition and empty recovery use the explicit checkpoint/recovery CAS
paths below and are not ordinary live cuts. Batch sequence starts at one per
portable binding receipt and advances only with a durably accepted append. A
consumer restart under the same still-current binding recovers the next
sequence from the verified ledger/checkpoint lineage; it neither resets the
sequence nor injects its new process-local ingress generation into durable
bytes.

## Ledger append and receipts

`RealmObservationLedger` stores immutable safe-normalized observation bytes in
bounded hash-linked segments under a protected operator-service root. It uses
the accepted storage/CSE durability foundation and exact predecessor/proposal
CAS. The app receives no storage face or logical key.

Append has the exact result union:

```text
committed
conflict
recovery-pending
aborted-before-dispatch
invalid
unavailable
```

`conflict` is valid only when exact readback proves a different predecessor won
without this proposal. Any uncertain post-dispatch outcome is
`recovery-pending`, never rejection. Recovery compares the exact predecessor,
proposal, segment bytes, head bytes, and physical/semantic digests before it
classifies the result. It never blindly retries a dispatched append.

`RealmObservationLedgerAppendReceiptV1` proves only one append. Its exact fields
are:

```text
format
version
receiptId
issuerId
realmId
bindingReceiptId
bindingDigest
operatorGeneration
m2LifecycleGeneration
observationProfileId
observationProfileDigest
contractCatalogId
contractCatalogDigest
sourceManifestId
sourceManifestDigest
safeNormalizationProfileId
safeNormalizationProfileDigest
proposalId
proposalDigest
predecessorLedgerHeadId
predecessorLedgerHeadDigest
proposedLedgerHeadId
proposedLedgerHeadDigest
proposedSegmentId
proposedSegmentDigest
batchId
batchDigest
vectorWatermarkBefore
vectorWatermarkAfter
observationIds
observationDigests
recordCount
recordByteCount
disposition
durableStatus
issuedLogicalTick
receiptDigest
```

The predecessor ledger-head pair is absent exactly for the first append under a
binding after exact empty-head readback and required otherwise; one-sided
presence fails. The four `proposed*` fields describe the immutable candidate
bytes prepared before dispatch and never claim that they became current.
Disposition-specific result fields are exact:

| Disposition | Exact conditional result fields |
| --- | --- |
| `committed` | `committedLedgerHeadId`, `committedLedgerHeadDigest`, `committedSegmentId`, `committedSegmentDigest`; each pair equals the proposed pair and exact readback verifies current durable bytes |
| `conflict` | `observedLedgerHeadId`, `observedLedgerHeadDigest`; the observed head differs from the predecessor/proposal and exact readback proves this proposal absent |
| `recovery-pending` | No result-head or committed-segment field; dispatch may have occurred and the proposal remains the only bounded recovery key |
| `aborted-before-dispatch` | No result-head or committed-segment field; the issuer's dispatch fence proves the storage call was never entered |

Fields from another row fail. The append receipt `disposition` is exactly
`committed`, `conflict`, `recovery-pending`, or `aborted-before-dispatch`.
`durableStatus` is `committed-durable` only for a verified committed head,
`proven-no-effect` only for a proven competing conflict or a dispatch-fenced
abort, and `unknown` only for recovery-pending. Invalid/unavailable results
produce a bounded process-local failure record and no durable append receipt.

`RealmObservationCheckpointCommitReceiptV1` proves exactly one checkpoint-head
proposal and its terminal or uncertain outcome. Its common exact fields are:

```text
format
version
receiptId
issuerId
realmId
bindingReceiptId
bindingDigest
operatorGeneration
m2LifecycleGeneration
proposalId
proposalDigest
previousCheckpointId
previousCheckpointDigest
proposedCheckpointId
proposedCheckpointDigest
proposedCheckpointGeneration
proposedLedgerHeadReceiptId
proposedLedgerHeadReceiptDigest
proposedProtectedGraphEdgeDigest
disposition
durableStatus
issuedLogicalTick
receiptDigest
```

The previous-checkpoint pair is absent exactly when
`proposedCheckpointGeneration = 1`; every later generation requires both fields
and equals its verified predecessor generation plus one. The proposed ledger-
head receipt pair is absent together only when the candidate checkpoint has
`lastBatchSequence = 0` and exact readback proves no ledger head; otherwise both
are required. `proposedProtectedGraphEdgeDigest` covers M3A-owned roots only and
can never claim an M2 root, pin, bundle, checkpoint, or handoff edge.

Checkpoint-receipt outcome fields are exact:

| Disposition | Exact conditional result fields |
| --- | --- |
| `committed` | `committedCheckpointId`, `committedCheckpointDigest`, `committedCheckpointGeneration`, `committedCheckpointHeadId`, `committedCheckpointHeadDigest`; candidate fields equal the proposal and exact head readback binds that proposal |
| `conflict` | `observedCheckpointId`, `observedCheckpointDigest`, `observedCheckpointGeneration`, `observedCheckpointHeadId`, `observedCheckpointHeadDigest`; exact readback proves a different winner and this proposal absent |
| `recovery-pending` | No committed/observed checkpoint or head field; dispatch may have occurred and proposal ID/digest remain the recovery key |
| `aborted-before-dispatch` | No committed/observed checkpoint or head field; the dispatch fence proves no checkpoint-store call occurred |

Fields from another row fail. The same disposition and durable-status meanings
as append apply. Invalid/unavailable method results create no commit receipt.

`RealmObservationLedgerCompactor` exposes exactly:

```text
compact({
  expectedBindingReceiptId,
  expectedBindingDigest,
  authorizingCheckpointId,
  authorizingCheckpointDigest,
  maximumSegments,
  signal
})
  -> committed
   | conflict
   | recovery-pending
   | aborted-before-dispatch
   | retention-blocked
   | not-needed
   | invalid
   | unavailable
```

`maximumSegments` is a positive safe integer no greater than `16` and can only
reduce the 16-entry proposal ceiling; it cannot select segment identities or
raise a profile limit. The expected binding resolves to the exact retained
portable scope owned by this live or closing M3A extension. The authorizing
checkpoint resolves byte-for-byte and is the current protected checkpoint head
for that binding. Callers cannot nominate segments, batch or chain boundaries,
retained roots, or blocking edges.

Under one compaction selection fence, the issuer counts the binding's verified
closed segments. Reason precedence and selection arithmetic are exact:

```text
closedSegmentCount = 0
  -> not-needed/no-closed-segment

0 < closedSegmentCount <= maximumRetainedLedgerSegments
  -> not-needed/retention-target-satisfied

excessClosedSegmentCount =
  closedSegmentCount - maximumRetainedLedgerSegments

selectedRetirementCount =
  min(maximumSegments, excessClosedSegmentCount)
```

When the third branch applies, the candidate is exactly the oldest
`selectedRetirementCount` closed segments in verified predecessor-to-successor
chain order. It never skips an older member. The issuer derives the exact
interval, both boundary pairs, and all three retained-root proofs from that
prefix and durable checkpoint readback. A malformed or unresolved graph is
`invalid/checkpoint-invalid`; a valid resolved protected edge reaching the
candidate produces `retention-blocked`. Caller order, storage enumeration
order, wall time, and callback order cannot affect the proposal.

`committed`, `conflict`, `recovery-pending`, `aborted-before-dispatch`, and
`retention-blocked` contain exactly `status`, `receiptId`, and `receiptDigest`,
which resolve to an immutable compaction receipt with the same disposition.
`not-needed` contains exactly `status` and reasonCode `no-closed-segment` or
`retention-target-satisfied`, with no receipt and no mutation. `invalid`
contains exactly `status` and reasonCode `binding-invalid`,
`checkpoint-invalid`, `limit-invalid`, or `schema-invalid`. `unavailable`
contains exactly `status` and reasonCode `service-unavailable`, `cancelled`, or
`closed`. No result returns proposal fields, segment IDs, head fields, root
proofs, protected edges, or partial receipt bytes. A `recovery-pending` caller
reconciles the exact receipt-bound proposal through durable readback; it never
constructs or blindly dispatches a second proposal.

Cancellation before proposal finalization returns `unavailable/cancelled` with
no receipt. After an exact proposal and receipt are finalized but before the
compaction-store deletion call is entered, cancellation yields an
`aborted-before-dispatch` receipt. Cancellation, close, or transport loss after
deletion dispatch yields `recovery-pending`, never `unavailable`. Until terminal
reconciliation, every proposed segment and all of its pseudonym-epoch
references remain protected.

`RealmObservationLedgerCompactionReceiptV1` proves exactly one proposed closed-
segment retirement interval and its terminal or uncertain outcome. Its common
exact fields are:

```text
format
version
receiptId
issuerId
realmId
bindingReceiptId
bindingDigest
operatorGeneration
m2LifecycleGeneration
compactionProposalId
compactionProposalDigest
authorizingCheckpointId
authorizingCheckpointDigest
proposedPredecessorSegmentId
proposedPredecessorSegmentDigest
proposedRetiredSegmentIds
proposedRetiredSegmentDigests
proposedRetiredFirstBatchSequence
proposedRetiredLastBatchSequence
proposedSuccessorSegmentId
proposedSuccessorSegmentDigest
proposedRetainedCausalRootDigest
proposedRetainedAuthorityRootDigest
proposedRetainedRecoveryRootDigest
disposition
durableStatus
issuedLogicalTick
receiptDigest
```

The three proposed retained-root digests are derived values, not caller-authored
summaries. The issuer first resolves the exact `authorizingCheckpointId`/
`authorizingCheckpointDigest`, verifies its complete canonical
`retainedGraphEdges`, and derives one closed digest input per root class with
fields in this exact order:

```text
format = particle-realms.realm-observation-compaction-retained-root-proof
version = 1
bindingReceiptId
bindingDigest
authorizingCheckpointId
authorizingCheckpointDigest
rootClass
includedEdgeKinds
edgeDigests
targetRootKinds
targetRootIds
targetRootDigests
retainedRootDigest
```

`rootClass` is exactly `causal`, `authority`, or `recovery`. `causal` selects
only `checkpoint-to-causal-observation`; `authority` selects only
`checkpoint-to-authority-observation`; `recovery` selects exactly
`checkpoint-to-acquisition-receipt` and
`checkpoint-to-recovery-receipt`. The five parallel arrays preserve the
checkpoint's already canonical edge order, have equal length, contain no
duplicate edge digest, and may be empty. Every selected edge is copied exactly;
no unselected kind can appear. `retainedRootDigest` is the SHA-256 Realm content
ID using the displayed format as domain and major version `1` over every other
field. The three resulting values equal
`proposedRetainedCausalRootDigest`,
`proposedRetainedAuthorityRootDigest`, and
`proposedRetainedRecoveryRootDigest` respectively.

Before dispatch, every selected target is resolved and every record/receipt in
the proposed retirement interval that remains reachable from a selected target
must be present in the matching proof; an unresolved target or missing reachable
record fails. A segment named by a checkpoint-to-ledger-segment edge is not
retirable. Projection/Chronicle roots remain independently verified by the
checkpoint graph; if their resolved closure reaches an observation or recovery
receipt in the candidate interval, that target must also exist in the
appropriate causal/authority/recovery edge class or compaction is
`retention-blocked`. Thus the three digests neither ignore a protected edge nor
invent a fourth retention namespace.

Every `proposed*` field is candidate evidence and cannot claim deletion.
`proposedRetiredSegmentIds` and `proposedRetiredSegmentDigests` are nonempty,
same-length arrays of at most `min(maximumSegments, 16)` entries. IDs are unique, digests are unique,
and paired entries appear in exact verified ledger predecessor-to-successor
chain order, never code-point order. Every member resolves to a closed segment
under this binding. The first resolved segment's first batch sequence equals
`proposedRetiredFirstBatchSequence`; the last resolved segment's last batch
sequence equals `proposedRetiredLastBatchSequence`; and every adjacent segment
has both an exact predecessor/successor ID-digest link and consecutive,
nonoverlapping batch intervals. The first sequence is positive and no greater
than the last.

The proposed predecessor pair is absent together only when the first retired
segment is the binding's verified genesis segment; otherwise it is required and
equals that segment's exact predecessor. The proposed successor pair is always
required, equals the last retired segment's exact successor, and resolves to a
retained current segment. One-sided boundary pairs, an active/open retired
member, a missing/duplicate/reordered member, a chain gap, an interval gap or
overlap, or a first/last sequence that names only part of the resolved interval
fails before dispatch. `compactionProposalId` and
`compactionProposalDigest` cover both boundary pairs, the complete ordered
retirement arrays and interval, the three retained-root digests, and the
authorizing checkpoint; they cannot be reused for a different interval.

Compaction outcome fields are exact:

| Disposition | Exact conditional result fields |
| --- | --- |
| `committed` | `committedCompactionHeadId`, `committedCompactionHeadDigest`; exact readback binds the proposal digest, proves every proposed retired segment absent, and proves the proposed predecessor/successor chain current |
| `conflict` | `observedCompactionHeadId`, `observedCompactionHeadDigest`; exact readback proves another proposal won and this proposal deleted nothing |
| `recovery-pending` | No committed/observed head field; deletion status is unknown and every proposed segment remains protected until reconciliation |
| `aborted-before-dispatch` | No committed/observed head field; the dispatch fence proves no compaction-store call occurred |
| `retention-blocked` | `blockingProtectedEdgeDigests`; a nonempty code-point-sorted unique array of exact edge digests, with no result-head field and no protected logical key |

Fields from another row fail. A `committed` receipt is also the sole
`ledger-compaction` evidence permitted to release the corresponding
`ledger-segment` pseudonym-epoch references; every other disposition retains
them. Each retired segment releases its exact reference idempotently. A crash
between verified segment retirement and reference release may retain key
material longer than necessary but cannot erase it early; recovery repeats the
exact release transition from the committed receipt. `durableStatus` is
`committed-durable` only for
`committed`, `proven-no-effect` for proven `conflict`,
`aborted-before-dispatch`, or `retention-blocked`, and `unknown` only for
`recovery-pending`. Invalid/unavailable method results create no compaction
receipt. These three receipt families have separate schemas and dispositions;
an append receipt cannot later be mutated to claim checkpoint or compaction. A
gap-detected or overflow-detected recovery receipt cannot also claim recovery
success.

The exact receipt issuers are `realm-observation-ledger@1`,
`realm-observation-checkpoint@1`, and `realm-observation-compaction@1` in that
same order. Their digest domains are respectively
`particle-realms.realm-observation-ledger-append-receipt`,
`particle-realms.realm-observation-checkpoint-commit-receipt`, and
`particle-realms.realm-observation-ledger-compaction-receipt`, all major version
`1`. Each `receiptDigest` covers every displayed field except itself. Every
binding receipt ID/digest must resolve to the retained portable scope before
verification; a receipt from another issuer, binding, Realm, lifecycle,
proposal/predecessor lineage, schema, or domain fails.

Segments close at either ledger segment limit. Retention keeps at most 16
closed segments plus the active segment as the stable target. A closure that
would create a seventeenth closed segment enters the compaction-pressure fence
before another append can become current; the excess segment remains protected
while the exact operation reaches a terminal result. Compaction may remove a closed segment
only after a newer verified checkpoint retains every still-required source
cursor, causal parent, authority/result record, recovery proof, and M3B/M3I
edge. Uncertainty retains data and reports pressure; it never guesses
unreachability.

## Separate protected M3A checkpoint

`RealmObservationIngressCheckpointV1` is a protected sidecar, not a widened
M2 checkpoint. It contains exactly:

```text
format
version
checkpointId
checkpointKind
realmId
bindingReceiptId
bindingDigest
operatorPartitionId
operatorGeneration
processOwnerId
m2LifecycleGeneration
m2RuntimeBundleId
m2RuntimeCapabilityProfileId
m2RuntimeCapabilityProfileDigest
admissionIndexDigest
publicationHeadBinding
admissionHeadBinding
visiblePointerGeneration
visibleCommitReceiptDigest
activeBakeOutputRecordDigest
audienceClass
disclosureClass
observationProfileId
observationProfileDigest
contractCatalogId
contractCatalogDigest
sourceManifestId
sourceManifestDigest
safeNormalizationProfileId
safeNormalizationProfileDigest
pseudonymKeyAuthorityId
pseudonymKeyEpoch
pseudonymKeyCommitment
lastBatchSequence
ledgerHeadReceiptId
ledgerHeadReceiptDigest
sourceCursorSlots
retainedGraphEdges
protectedGraphEdgeDigest
previousCheckpointId
previousCheckpointDigest
checkpointGeneration
committedLogicalTick
checkpointDigest
```

`format` is `particle-realms.realm-observation-ingress-checkpoint`, `version` is
`1`, and `checkpointKind` is exactly `initial-empty-acquisition` or `progress`.
`checkpointId` is the deterministic content ID over the portable binding,
checkpoint kind, durable batch/checkpoint sequence, conditionally present
accepted ledger head, seven source cursor slots, retained M3 edges, and
predecessor lineage. `checkpointDigest` covers every displayed field except
itself using that format/domain and major version. The process-local ingress
generation is excluded. ID/digest disagreement fails before head proposal.

The ledger-head receipt pair is absent together exactly when
`lastBatchSequence = 0` and exact readback proves no ledger head; otherwise both
are required. The previous-checkpoint pair is absent together exactly when
`checkpointGeneration = 1`; every later checkpoint requires the exact previous
ID/digest and increments its generation by one. One-sided presence, a zero or
skipped generation, or a ledger/head contradiction fails.

`sourceCursorSlots` has exactly seven entries in source-manifest order. Every
entry is an exact closed record containing:

```text
sourceOrder
sourceId
sourceDescriptorDigest
sourceState
cursorPresence
sourceCursor
terminalAcquisitionReceiptId
terminalAcquisitionReceiptDigest
latestRecoveryReceiptId
latestRecoveryReceiptDigest
slotDigest
```

`cursorPresence` is exactly `accepted` or `absent`. `accepted` requires one
complete `RealmObservationSourceCursorV1` matching the source/descriptor and
omits both acquisition-receipt fields. Its latest-recovery pair is absent only
when no recovery-phase receipt exists in that cursor's retained lineage; it is
required for every recovered-live cursor and every accepted slot in `stale`,
`recovering`, `unavailable`, or `quarantined`, and resolves to that source's
exact current recovery-journal head. `absent` omits `sourceCursor` and both
latest-recovery fields, permits only `sourceState = unavailable` or
`quarantined`, and requires both acquisition fields to resolve to an
`initial-acquisition` phase receipt for the same source and disposition. Stable
checkpoint states are exactly `live`, `stale`, `recovering`, `unavailable`, or
`quarantined`; transitional/closed states cannot commit. One-sided, cross-phase,
or non-head receipt pairs fail. `slotDigest` uses domain
`particle-realms.realm-observation-source-cursor-slot`, major version `1`, and
all other slot fields. Missing, extra, cross-source, one-sided, or contradictory
slot fields fail.

`initial-empty-acquisition` is valid only at checkpoint generation one with no
previous checkpoint, `lastBatchSequence = 0`, no ledger-head receipt, and no
ledger-segment edge. Every accepted slot then has
`acceptedThroughSequence = 0`, `nextExpectedSequence = 1`, and an empty verified
snapshot watermark; unavailable/quarantined sources use the absent-slot receipt
branch. The checkpoint-head CAS atomically makes all seven zero/absent slots and
this checkpoint current or changes none. It is the sole authority for accepting
an all-empty initial acquisition; it emits no empty batch and no fabricated
ledger receipt. If any initial source contributes a record, ordinary append CAS
commits the complete cursor vector and the first checkpoint is `progress`.

The binding receipt/digest resolves to the retained portable binding and every
duplicated M2/policy/audience/pseudonym-key field must match it byte-for-byte.
The checkpoint
contains no listener, ring content, live binding, callback, abort controller,
raw observation, raw storage key, source lease, M2 liveness handle, work root,
or GPU object.

Every `retainedGraphEdges` member is an exact closed record containing:

```text
edgeKind
targetRootKind
targetRootId
targetRootDigest
edgeDigest
```

The allowed kind pair is closed:

| `edgeKind` | Required `targetRootKind` |
| --- | --- |
| `checkpoint-to-ledger-segment` | `ledger-segment` |
| `checkpoint-to-causal-observation` | `observation` |
| `checkpoint-to-authority-observation` | `observation` |
| `checkpoint-to-acquisition-receipt` | `recovery-receipt` |
| `checkpoint-to-recovery-receipt` | `recovery-receipt` |
| `checkpoint-to-projection-root` | `projection-root` |
| `checkpoint-to-chronicle-root` | `chronicle-root` |

The checkpoint is the implicit source of every edge. IDs/digests are bounded
canonical strings. `edgeDigest` uses domain
`particle-realms.realm-observation-retained-graph-edge`, major version `1`, and
the other four fields. The array is code-point sorted by
`(edgeKind, targetRootKind, targetRootId, targetRootDigest)`, contains no
duplicate tuple, and contains at most the profile's
`maximumRetainedGraphEdges = 4096` members while the complete checkpoint also
remains within `maximumCheckpointBytes`. `protectedGraphEdgeDigest` uses domain
`particle-realms.realm-observation-protected-graph-edge-set`, major version `1`,
and the complete ordered edge array.

The `recovery-receipt` root kind is the one registered
`RealmObservationIngressRecoveryReceiptV1` family. Its
`initial-acquisition` phase is retained only through
`checkpoint-to-acquisition-receipt`; its `recovery` phase is retained only
through `checkpoint-to-recovery-receipt`. Cross-phase edge use fails.

The pure injected `RealmObservationRetainedGraphVerifier` recomputes both digest
levels and resolves every target through the protected M3 root resolver. It
requires exactly one matching edge for every retained ledger segment, causal
parent, authority/result observation, and recovery/acquisition receipt reachable
from the seven cursor slots and current ledger head; it rejects dangling targets, missing
required targets, conflicting bytes, unknown kinds, over-limit arrays, and any
target whose binding digest differs. The schema is a checkpoint-rooted star, so
an edge cannot name another edge or introduce a cycle. Projection/Chronicle
edges are absent in an M3A-only checkpoint and become legal only after the later
M3B/M3I root verifier for the named kind is independently registered. An absent
resolver makes the checkpoint invalid rather than weakening verification. No
M2 root kind is representable.

The M3A protected-root manager retains only the exact verified edges above. It
does not create, claim, or retain an edge into M2's closed root-kind domain. The
M2 binding receipt is validation-only: M2 remains solely responsible for
retaining its active bundle, checkpoint, pin, CSE record, and visible-commit
evidence through lawful M2 roots. If M2 retires or changes any referenced state,
the M3A checkpoint becomes stale and must not keep that M2 state alive.

Checkpoint-head CAS commits the immutable checkpoint, M3A-only protected edges,
and head lineage together. A digest placed in M2 V1 `logicalCursorId` does not
satisfy this rule and is never used as restore authority.

Restore first obtains a fresh selection-fenced continuation binding and requires
exact equality for operator, Realm, owner, M2 bundle/lifecycle, active-bake
output, visible commit, both current heads, runtime profile, M3A
profile/catalog/manifest, normalization policy, pseudonym-key authority/epoch/
commitment, checkpoint lineage, M3A-only protected graph edges, and ledger head.
It does not ask M2 to retain an old
match. Only an `accepted` slot's portable source cursor is offered as a resume
hint to a fresh source validation; an `absent` slot causes a fresh acquisition.
Any mismatch closes the candidate restore and starts a fresh M3A snapshot; it
does not alter M2 or resurrect retired M2 evidence.

M3A does not implement cross-session living-runtime handoff. M2 V1 handoff may
move the static runtime, but the old M3A entry closes and the new lifecycle
opens fresh source bindings. M3I may add a separately versioned, graph-verified
M3 continuation sidecar; it must not edit M2 V1 in place.

## Recovery receipt dispositions

`RealmObservationIngressRecoveryReceiptV1` is one immutable receipt per
detection, open attempt, recovered transition, quarantine, or abandonment. Its
common exact fields are:

```text
format
version
receiptId
issuerId
realmId
bindingReceiptId
bindingDigest
operatorGeneration
m2LifecycleGeneration
ingressGeneration
sourceId
sourceDescriptorDigest
receiptPhase
disposition
reasonCode
attemptOrdinal
previousSourceGeneration
previousCursorDigest
detectedLogicalTick
completedLogicalTick
durableStatus
receiptDigest
```

`format` is `particle-realms.realm-observation-ingress-recovery-receipt` and
`version` is `1`. `issuerId` is exactly the prebound
`realm-observation-recovery@1` service; no source, app, projector, ledger reader,
or renderer can issue it. The binding fields must resolve to the same retained
portable scope as the source cursor and ledger predecessor.
`m2LifecycleGeneration` preserves canonical uint64 decimal text;
`attemptOrdinal` is a positive safe integer bounded by the profile.

`receiptPhase` is exactly `initial-acquisition` or `recovery`. Initial ready
acquisition emits no receipt. An initial terminal `source-unavailable`,
`quarantined`, or `abandoned` result emits an `initial-acquisition` receipt and
omits both previous-source fields. Every other disposition requires
`receiptPhase = recovery`, a positive `previousSourceGeneration`, and a
`previousCursorDigest` resolving to the last accepted cursor. One-sided previous
fields, an initial detection/open/recovered disposition, or recovery without a
previous accepted cursor fails.

The disposition is exactly one of:

```text
gap-detected
overflow-detected
source-changed
source-unavailable
snapshot-opened
resume-opened
recovered
quarantined
abandoned
```

Variant fields are exact and absent from every other disposition:

| Disposition | Exact additional fields and required meaning |
| --- | --- |
| `gap-detected` | `claimedHighWatermark`, `earliestRetainedSequence`, `intervalStartSequence`, `intervalEndSequence`, `occupancyRecordCount`, `occupancyByteCount`; exact retained-floor arithmetic below proves the first known missing range and no success is claimed |
| `overflow-detected` | `claimedHighWatermark`, `earliestRetainedSequence`, `intervalStartSequence`, `intervalEndSequence`, `occupancyRecordCount`, `occupancyByteCount`, `overflowLimitKind`, `overflowLimitValue`, `attemptedRecordByteCount`, `overflowCounterSnapshotDigest`; exact first-unretainable-record arithmetic below proves the one-record interval and no ACK occurs |
| `source-changed` | `observedSourceGeneration`, `observedSourceDescriptorDigest`; neither may replace the accepted cursor |
| `source-unavailable` | `availabilityClass`; exactly `temporary`, `retired`, or `unsupported`, with no raw failure object; valid in either receipt phase under the phase rules above |
| `snapshot-opened` | `nextSourceGeneration`, `snapshotId`, `snapshotDigest`, `nextCursorDigest`, `earliestRetainedSequence`, `claimedHighWatermark`, `openingCutDigest`; proves only a verified new-generation open and frozen cut, not recovery success |
| `resume-opened` | `nextSourceGeneration`, `nextCursorDigest`, `earliestRetainedSequence`, `claimedHighWatermark`, `openingCutDigest`; the generation equals the previous generation and the complete frozen interval is retained |
| `recovered` | `openingReceiptId`, `openingReceiptDigest`, `openingCutDigest`, `nextSourceGeneration`, `nextCursorDigest`, `recoveryCommitKind`, plus exactly one commit branch below; stale state clears only after exact opening equality and that branch verify |
| `quarantined` | `quarantineEvidenceDigest`; required for initial descriptor/snapshot integrity failure or recovery equivocation, digest conflict, causal cycle, corrupt durable bytes, or policy identity conflict and grants no reopen in the same ingress generation |
| `abandoned` | `failedAttemptReceiptIds`, `failedAttemptReceiptDigests`; arrays contain exactly the ordered attempts for this source/phase/generation and end at the profile cap or aggregate retirement |

Every additional sequence/count/byte field is a nonnegative safe integer except
source generations, which are positive. Every sequence interval is non-inverted
and all displayed addition/subtraction must remain within the safe-integer
domain before it is evaluated. IDs/digests are bounded canonical strings;
arrays are same-length, ordered, and unique and are nonempty except where the
opening-cut rules explicitly permit both observation arrays to be empty. Fields
from a different variant, `null` substitutes, raw errors, and partial success
evidence fail validation. `previousCursorDigest` is the last accepted cursor and
never advances in a detection/open receipt.

For `gap-detected`, the previous cursor resolves to `P` and all of these
equations are mandatory:

```text
P.sourceGeneration = previousSourceGeneration
P.nextExpectedSequence < earliestRetainedSequence
earliestRetainedSequence <= claimedHighWatermark
intervalStartSequence = P.nextExpectedSequence
intervalEndSequence = earliestRetainedSequence - 1
occupancyRecordCount = claimedHighWatermark - earliestRetainedSequence + 1
```

`occupancyByteCount` is the exact retained source-ring byte counter at the same
atomic read, and the source ring contains every dense sequence in
`[earliestRetainedSequence, claimedHighWatermark]`. `reasonCode` is exactly
`gap`. This disposition exists only for
retained-floor loss. A missing sequence at or above the claimed retained floor
is an integrity failure and quarantines the source; it cannot be relabelled as a
gap.

For `overflow-detected`, synchronous admission stops the source generation at
the first dense record that cannot be retained. No later sequence is assigned
in that generation. `claimedHighWatermark` is exactly that just-assigned
sequence, `intervalStartSequence = intervalEndSequence =
claimedHighWatermark`, and `earliestRetainedSequence <=
P.nextExpectedSequence <= claimedHighWatermark`. `reasonCode` is exactly
`overflow`; neither the cursor, occupancy counters, source ring, nor aggregate
ring includes or acknowledges the refused record. `attemptedRecordByteCount` is
the exact positive canonical-record byte count and cannot exceed
`maximumRecordBytes`; a larger record is `record-too-large`, not overflow.

`overflowLimitKind` is selected by the first exceeded rule in this exact
precedence order:

```text
per-source-records
per-source-bytes
aggregate-records
aggregate-bytes
```

`overflowLimitValue` equals respectively `maximumBufferedRecordsPerSource`,
`maximumBufferedBytesPerSource`, `maximumBufferedRecordsTotal`, or
`maximumBufferedBytesTotal`. `overflowCounterSnapshotDigest` resolves to one
protected, immutable, atomically captured
`RealmObservationOverflowCounterSnapshotV1`. It is internal receipt evidence,
not a runtime-catalog definition or application authority, and contains exactly:

```text
format
version
bindingReceiptId
bindingDigest
sourceId
sourceDescriptorDigest
sourceGeneration
refusedSequence
earliestRetainedSequence
sourceOccupancyRecordCount
sourceOccupancyByteCount
aggregateOccupancyRecordCount
aggregateOccupancyByteCount
overflowCounterSnapshotDigest
```

Its format is `particle-realms.realm-observation-overflow-counter-snapshot`,
version is `1`, and its final digest is the Realm content ID over every other
field using that format/domain and major version. `refusedSequence` equals
`claimedHighWatermark`; `bindingReceiptId`, `bindingDigest`, `sourceId`,
`sourceDescriptorDigest`, and `earliestRetainedSequence` are byte-identical to
the enclosing overflow receipt fields; and `sourceGeneration` equals
`previousSourceGeneration`. A cross-binding, cross-source, cross-descriptor, or
different-floor snapshot fails even when every numeric counter happens to
match. For a nonempty source ring,
`sourceOccupancyRecordCount = claimedHighWatermark -
earliestRetainedSequence`; an empty source ring uses
`earliestRetainedSequence = claimedHighWatermark` and count zero. Source byte
count is the exact canonical byte sum of that preinsert interval. Aggregate
counts are the exact sums across all seven protected source rings at the same
fence.

`occupancyRecordCount` and `occupancyByteCount` equal the snapshot's source pair
for a per-source kind and aggregate pair for an aggregate kind. A records rule
is exceeded exactly when `occupancyRecordCount + 1 > overflowLimitValue`; a
bytes rule is exceeded exactly when `occupancyByteCount +
attemptedRecordByteCount > overflowLimitValue`. Every earlier rule in the
precedence list is recomputed from the same counter snapshot and must not be
exceeded. A different limit value, a later selected rule while an earlier rule
is exceeded, a multi-record overflow interval, postinsert occupancy, silent
drop, or ACK fails.

Every `snapshot-opened` or `resume-opened` receipt atomically stores one closed
canonical `RealmObservationRecoveryOpeningCutV1` digest input in the protected
recovery journal. This is an internal digest input, not a twelfth M3A runtime
catalog definition and not application authority. It contains exactly:

```text
format = particle-realms.realm-observation-recovery-opening-cut
version = 1
realmId
bindingReceiptId
bindingDigest
operatorGeneration
m2LifecycleGeneration
sourceId
sourceDescriptorDigest
openingDisposition
previousSourceGeneration
previousCursorDigest
nextSourceGeneration
nextCursorDigest
earliestRetainedSequence
claimedHighWatermark
snapshotId
snapshotDigest
observationIds
observationDigests
recordCount
recordByteCount
openingCutDigest
```

`openingDisposition` is exactly `snapshot-opened` or `resume-opened`. The
snapshot pair is present together only for `snapshot-opened`, where
`nextSourceGeneration` is greater than `previousSourceGeneration`; it is absent
together for `resume-opened`, where the generations are equal. The observation
arrays contain the complete safe-normalized opening cut in increasing source-
sequence order. They are same-length and unique. They are both empty exactly
when `recordCount = 0` and `recordByteCount = 0`; otherwise they are both
nonempty, `recordCount` equals their length, and `recordByteCount` is recomputed
from the resolved canonical observation bytes. Every resolved observation
matches the displayed binding, source descriptor, and `nextSourceGeneration`;
sequences are dense and end at `claimedHighWatermark`. For `snapshot-opened`,
`earliestRetainedSequence = 1`; a nonempty cut contains exactly sequences `1`
through `claimedHighWatermark`, while an empty cut has
`claimedHighWatermark = 0`. For `resume-opened`, the exact previous cursor `P`
satisfies `earliestRetainedSequence <= P.nextExpectedSequence`; a nonempty cut
contains exactly `P.nextExpectedSequence` through `claimedHighWatermark`, while
an empty cut has `claimedHighWatermark = P.acceptedThroughSequence`.
`recordCount` equals the size of the applicable closed interval.
`nextCursorDigest` resolves to the exact candidate cursor after the complete
ordered array, or the verified empty cut.

`openingCutDigest` is the Realm content ID over every other displayed field,
using the opening-cut format/domain and major version `1`. The opening receipt
and this exact digest input become durable together or neither does. A missing,
cross-binding, cross-source, differently ordered, or digest-mismatched opening
cut invalidates recovery. Process-local ingress generation, attempt ordinal,
and logical ticks are deliberately absent, so independently executed semantic
recovery of the same frozen cut can reproduce this digest even though its
receipts differ.

For `disposition = recovered`, `openingReceiptId` and
`openingReceiptDigest` resolve to the current protected recovery-journal head
for that source immediately preceding the recovered transition. That immutable receipt has
`receiptPhase = recovery` and disposition `snapshot-opened` or
`resume-opened`. The opening and recovered receipts are byte-identical for
`realmId`, both binding fields, `operatorGeneration`,
`m2LifecycleGeneration`, `ingressGeneration`, `sourceId`,
`sourceDescriptorDigest`, `attemptOrdinal`, `previousSourceGeneration`, and
`previousCursorDigest`. The recovered receipt's `openingCutDigest`,
`nextSourceGeneration`, and `nextCursorDigest` equal the corresponding opening-
receipt fields exactly. No intervening receipt, different attempt, changed
binding or descriptor, substituted next cursor, or substituted opening cut can
satisfy the reference. Receipt-local ticks, identities, dispositions, reasons,
and durable statuses need not equal the opening receipt.

`recoveryCommitKind` and its conditional fields are exact:

| `recoveryCommitKind` | Exact conditional fields and proof |
| --- | --- |
| `records-appended` | `ledgerAppendReceiptIds`, `ledgerAppendReceiptDigests`; nonempty same-length arrays ordered by ledger append order whose resolved committed receipts collectively cover exactly the nonempty observation set bound by `openingCutDigest` |
| `no-records` | `ledgerStateKind`, conditionally present `unchangedLedgerHeadReceiptId`/`unchangedLedgerHeadReceiptDigest`, `vectorWatermarkBefore`, `vectorWatermarkAfter`, `noRecordCommitDigest`; the opening cut is exactly empty and exact readback proves the ledger state unchanged while the target source advances to the opening receipt's next cursor |

The two branches are mutually exclusive and no empty `RealmObservationBatchV1`
or append receipt is fabricated.

For `records-appended`, the append-receipt arrays are nonempty, same-length,
unique, and ordered by their resolved batches' strictly increasing consecutive
`batchSequence`, not by code-point order. Every pair resolves to a
`RealmObservationLedgerAppendReceiptV1` with `disposition = committed`,
`durableStatus = committed-durable`, and the same Realm, binding, operator,
lifecycle, profile, catalog, manifest, and normalization scope. For every
receipt after the first:

```text
current.predecessorLedgerHeadId = previous.committedLedgerHeadId
current.predecessorLedgerHeadDigest = previous.committedLedgerHeadDigest
current.vectorWatermarkBefore = previous.vectorWatermarkAfter
currentBatch.batchSequence = previousBatch.batchSequence + 1
```

The first receipt's predecessor pair equals the verified ledger head immediately
before this recovery append chain, or is absent only for a verified empty head
and a first resolved batch with `batchSequence = 1`.
Concatenating the resolved append receipts' `observationIds` and
`observationDigests` in receipt order equals the resolved opening-cut arrays
byte-for-byte, with no missing, extra, reordered, or duplicated member. Every
receipt covers one nonempty source-isolated canonical batch; the chain contains
no observation outside that opening cut and its length cannot exceed the cut's
`recordCount`. The last receipt's `vectorWatermarkAfter` installs exactly
`nextCursorDigest` in the recovered source slot, every other source slot remains
byte-identical across the chain, and its committed ledger-head pair is the
verified current head when the recovered transition commits.

For `no-records`, the resolved opening cut has empty observation arrays,
`recordCount = 0`, and `recordByteCount = 0`. `ledgerStateKind` is exactly
`existing-head` or `empty`. `existing-head` requires both unchanged-head receipt
fields and exact current-head readback. `empty` omits both and requires exact
readback that no ledger head exists; one-sided fields or an empty claim against
an existing head fail. `noRecordCommitDigest` uses domain
`particle-realms.realm-observation-no-record-recovery-commit`, major version
`1`, and covers the binding digest, source ID, opening receipt ID/digest,
`openingCutDigest`, previous/next cursor digests, `ledgerStateKind`, the
conditionally present unchanged ledger-head receipt pair, both vectors, and
literal record count and record byte count zero. The after-vector contains
exactly `nextCursorDigest` in the recovered source slot and every other source
entry is byte-identical to the before-vector. This durable branch permits a valid
empty resnapshot or retained-tail recovery to advance the source cursor without
claiming a ledger append. The protected recovery-journal CAS installs the
recovered receipt and exact committed final source-cursor vector together under
the referenced opening-receipt/vector predecessor or changes neither. The
matching `recovery-journal` pseudonym-epoch reference is retained in that same
commit group before the transition becomes current; the subsequent M3A
checkpoint retains that receipt and may provide its later release evidence. A
crash or conflict before this CAS leaves the opening receipt current, preserves
stale state, and leaves recovery pending.

For `receiptPhase = recovery`, `durableStatus` is exactly `detection-durable`
for the first four dispositions, `opening-durable` for
`snapshot-opened`/`resume-opened`, `recovered-durable` for `recovered`, and
`terminal-durable` for `quarantined`/`abandoned`. For
`initial-acquisition`, it is `terminal-durable`. The receipt is appended before
the transition becomes observable.

`receiptId` is the deterministic Realm content ID over every finalized common
field and every field of the one applicable variant, excluding exactly
`receiptId` and `receiptDigest`, using domain
`particle-realms.realm-observation-ingress-recovery-receipt-id` and major
version `1`. It therefore includes `ingressGeneration`, `attemptOrdinal`,
`detectedLogicalTick`, and `completedLogicalTick`; independently executed
attempts are not claimed to share an ID. `receiptDigest` uses
`particle-realms.realm-observation-ingress-recovery-receipt` as its domain,
major version `1`, and covers every displayed common and applicable variant
field except itself, including the recomputed `receiptId`. The issuer and
verifier recompute both values before accepting durable bytes. A later receipt
references an earlier immutable receipt by its exact ID/digest pair. Exact
replay of one already durable receipt returns its original bytes; no field is
mutated to represent a later phase.

Reason precedence is exactly:

```text
operator-superseded
lifecycle-retired
binding-mismatch
policy-mismatch
catalog-mismatch
manifest-mismatch
source-version-mismatch
source-replaced
integrity-failure
causal-invalid
checkpoint-invalid
ledger-unavailable
overflow
gap
snapshot-too-large
record-too-large
source-unavailable
cancelled
closed
```

The first applicable reason wins. Diagnostics may map it to safer UI text but
cannot reorder or replace the durable reason.

## Aggregate and source lifecycle

The aggregate M3A state machine is:

```text
idle
  -> validating
  -> acquiring
  -> reconciling
  -> live
  -> closing
  -> closed
```

`validating`, `acquiring`, or `reconciling` may go to `closing`. `live` may
remain live while one source is explicitly stale or unavailable if the profile
permits degraded operation. Binding, ledger, checkpoint, or global-cap failure
closes the aggregate.

Each source state is exactly one of `unbound`, `opening`, `snapshotting`,
`resuming`, `live`, `stale`, `recovering`, `unavailable`, `quarantined`,
`closing`, or `closed`. The complete transition relation is:

| Current | Allowed next state |
| --- | --- |
| `unbound` | `opening`, `closing` |
| `opening` | `snapshotting`, `resuming`, `unavailable`, `quarantined`, `closing` |
| `snapshotting` | `live`, `stale`, `unavailable`, `quarantined`, `closing` |
| `resuming` | `live`, `stale`, `unavailable`, `quarantined`, `closing` |
| `live` | `stale`, `unavailable`, `quarantined`, `closing` |
| `stale` | `recovering`, `unavailable`, `quarantined`, `closing` |
| `recovering` | `live`, `stale`, `unavailable`, `quarantined`, `closing` |
| `unavailable` | `opening`, `recovering`, `closing` |
| `quarantined` | `closing` |
| `closing` | `closed` |
| `closed` | none |

No implicit self-transition or other edge exists. Every checkpoint slot stores
one of those exact source-state strings. `unavailable` stores either the last
accepted cursor or an explicit absent slot plus its terminal initial-acquisition
receipt. An absent slot may re-enter only through `opening`; an accepted-cursor
slot may re-enter only through `recovering`. `quarantined` stores the matching
terminal receipt, is terminal for the process-local ingress generation, and can
only close. The aggregate may remain `live` with either state only under the
manifest's `explicit-degraded` rule; neither state silently advances a cursor.

M3A never calls the frozen `processOwnerPort@1` child mutation methods and never
adds a child kind or ownership role to M2. The trusted OS composition root owns
one separate `realmObservationExtensionOwnerPort@1` for M3A. It is prebound to
the accepted M2 `processOwnerId`, byte-identical lifecycle generation, Realm,
and binding digest, but its ledger and tuple domain are independent of the M2
activation-child ledger.

The extension port admits exactly one process-local aggregate tuple,
`(realm-observation-ingress, observation-owned)`, per current binding. Its
`claimAggregate({ expectedBindingDigest, signal })` result is exactly `claimed`,
`already-claimed`, `stale`, or `unavailable`; only `claimed` returns one branded
extension-child ID, opaque work root, opaque teardown root, ingress generation,
and single-use release handle. `already-claimed`, `stale`, and `unavailable`
return one safe reason and no partial handle.

The release handle exposes exactly:

```text
releaseAggregate({
  extensionChildId,
  expectedBindingDigest,
  ingressGeneration,
  closeEvidence,
  signal
})
  -> released | already-released | stale | invalid
```

The kernel-private extension owner port, not the release handle, also exposes
exactly:

```text
verifyAggregateTerminal({
  expectedBindingReceiptId,
  expectedBindingDigest,
  signal
})
  -> released | absent-after-restart | live | invalid | unavailable
```

`closeEvidence` is the process-local immutable
`RealmObservationAggregateCloseEvidenceV1` and contains exactly:

```text
format
version
issuerId
bindingReceiptId
bindingDigest
extensionChildId
ingressGeneration
closeReason
acquiredResourceLedgerDigest
terminalResourceLedgerDigest
releasedResourceKinds
releasedResourceCount
remainingResourceCount
callbackInflightCount
pendingDurableOperationCount
workRootAborted
terminalState
closeDigest
```

`format` is `particle-realms.realm-observation-aggregate-close-evidence`,
`version` is `1`, and `issuerId` is exactly
`realm-observation-service-root@1`. `closeReason` is exactly `binding-changed`,
`cancelled`, `device-recovery-failed`, `failure`, `normal`, or
`operator-retired`. `releasedResourceKinds` is a code-point-sorted unique subset
of `app-batch-reader`, `checkpoint-writer`, `diagnostic-buffer`,
`identity-projection`, `ledger-writer`, `pending-causal-buffer`,
`source-cursor`, `source-ring`, and `source-subscription`;
`releasedResourceCount` is the exact number of released instances, not the
array length.

The two resource-ledger digests resolve to process-local immutable
`RealmObservationResourceLedgerSnapshotV1` objects owned only by the extension
owner. Each snapshot contains exactly:

```text
format
version
issuerId
bindingReceiptId
bindingDigest
extensionChildId
ingressGeneration
snapshotKind
resourceRows
resourceCount
ownedResourceCount
releasedResourceCount
snapshotDigest
```

`format` is `particle-realms.realm-observation-resource-ledger-snapshot`,
`version` is `1`, `issuerId` is `realm-observation-extension-owner@1`, and
`snapshotKind` is exactly `acquired` or `terminal`. `resourceRows` is ordered by
code point on `resourceKind`, then ascending `resourceOrdinal`; it may be empty
and otherwise has one unique row per close-cohort instance. Every exact closed row
contains, in order, `resourceKind`, `resourceOrdinal`,
`resourceBindingDigest`, `resourceState`, and `rowDigest`. Resource kind is one
of the nine allowlisted kinds above; ordinal is a positive safe integer assigned
monotonically per kind and never reused within the ingress generation; state is
exactly `owned` or `released`. The extension owner's live resource ledger
contains only currently owned rows. Normal source recovery or replacement may
close/read back and atomically remove a row before aggregate close; such a prior
terminal row is not resurrected or included in either close-cohort snapshot,
and its ordinal remains retired.

`resourceBindingDigest` uses domain
`particle-realms.realm-observation-resource-binding`, major version `1`, over
the snapshot's binding receipt ID/digest, extension-child ID, ingress
generation, resource kind, and ordinal in that order. It contains no handle or
capability bytes. `rowDigest` uses domain
`particle-realms.realm-observation-resource-ledger-row`, major version `1`, over
those same six binding fields plus `resourceState`, excluding only itself.
`snapshotDigest` uses the snapshot format as domain, major version `1`, and
every displayed snapshot field except itself. Counts are recomputed from the
array. After canonical sorting, the acquired and terminal arrays have the same
cardinality and every positional pair preserves exactly `(resourceKind,
resourceOrdinal, resourceBindingDigest)`. The acquired member has
`resourceState = owned`; its terminal partner has `resourceState = released`.
Full rows and `rowDigest` values therefore must not match across snapshots: each
digest is independently recomputed over its own state, and a byte-identical
acquired/terminal `rowDigest` is invalid.

The `acquired` snapshot is frozen under the extension-owner close fence after
new acquisition is disabled, every earlier release/remove operation is settled,
and before the first close-cohort resource release. It contains exactly the
then-current live-ledger rows; every row is `owned`,
`ownedResourceCount = resourceCount`, and
`releasedResourceCount = 0`. The `terminal` snapshot is frozen after reverse
close/readback of every row and before `releaseAggregate()`; every matching row
is `released`, `ownedResourceCount = 0`, and
`releasedResourceCount = resourceCount`. The close fence preserves only the
immutable acquired cohort keys and each exact terminal close readback while the
live ledger atomically removes released rows; the terminal snapshot is derived
from that fence evidence and does not reinsert released rows into the live
ledger. `acquiredResourceLedgerDigest` and
`terminalResourceLedgerDigest` are exactly those two snapshot digests.
`releasedResourceKinds` is exactly the sorted unique projection of terminal
rows and close-evidence `releasedResourceCount` equals the terminal snapshot
count. It counts this aggregate-close cohort, not resources already released by
normal recovery. A new,
missing, duplicated, reordered, differently bound, still-owned, or
unverifiably released terminal row makes close evidence invalid.

Valid close evidence also requires
`remainingResourceCount = 0`, `callbackInflightCount = 0`,
`pendingDurableOperationCount = 0`, `workRootAborted = true`, and
`terminalState = closed`.

`closeDigest` uses the displayed format as domain, major version `1`, and every
other field. It is not a catalog record, durable receipt, app result, loggable
identifier, or handoff object. `released` and `already-released` contain exactly
`status` and the same `closeDigest`; the latter is returned only after the exact
claim was already released. `stale` and `invalid` contain exactly `status` and
one bounded reason and perform no release. The extension owner recomputes the
evidence, checks it against its private resource ledger, consumes the release
handle once, and cannot register or mutate any M2 child.

`verifyAggregateTerminal()` is kernel-only, read-only, and never returns a
release handle. `released` and `absent-after-restart` contain exactly `status`
and `extensionAggregateTerminalEvidenceDigest`. `live` contains exactly
`status` and `ownedAggregateCount = 1`, matching the exact aggregate cap;
binding retirement converts it to the
`extension-aggregate-not-released` blocker row with count `1`. `invalid`
contains exactly `status` and reason `binding-invalid`, `scope-mismatch`, or
`schema-invalid`; `unavailable` contains exactly `status` and reason
`service-unavailable`, `cancelled`, or `closed`. Neither exposes an extension
child, ingress generation, root, resource row, or close bytes.

The success digest resolves to one protected internal
`RealmObservationExtensionAggregateTerminalEvidenceV1`, which is not a runtime-
catalog definition or application contract and contains exactly:

```text
format
version
issuerId
bindingReceiptId
bindingDigest
evidenceKind
releaseCloseDigest?
retiredExtensionOwnerGeneration?
currentExtensionOwnerGeneration?
verifiedLiveClaimCount
projectionTerminalEvidenceKind
projectionTerminalEvidenceDigest
priorIngressProjectionGenerationFenceDigest?
verifiedRetiredGenerationProjectionHandleCount?
verifiedRetiredGenerationProjectionInflightCallCount?
extensionAggregateTerminalEvidenceDigest
```

`format` is
`particle-realms.realm-observation-extension-aggregate-terminal-evidence`,
`version` is `1`, and `issuerId` is
`realm-observation-extension-owner@1`. `evidenceKind` equals the result status.
`verifiedLiveClaimCount` is literal `0`. `released` requires
`releaseCloseDigest` to equal byte-for-byte the `closeDigest` returned by
`releaseAggregate()` and omits both explicit owner-generation and both retired-
generation count fields. Its resolved close
evidence selects exactly one of two current-generation projection proofs. If
the acquired/terminal close cohort contains exactly one `identity-projection`
row, `projectionTerminalEvidenceKind = object-identical-close` and
`projectionTerminalEvidenceDigest` is that row's exact verified
`projectionCloseDigest`. If both snapshots contain no `identity-projection`
row, `projectionTerminalEvidenceKind = never-acquired` and the digest resolves
to exact `RealmObservationProjectionNonissuanceEvidenceV1` for the close
evidence's binding and ingress generation. Any other row cardinality or proof
pairing is invalid.

For `released`, `priorIngressProjectionGenerationFenceDigest` is required if
the extension-owner lineage for this exact binding contains any earlier retired
ingress generation without object-identical close. It resolves to the latest
cumulative `ingress-extension` generation fence that covers every such
generation, uses the same binding pair, and has
`currentProjectionOwnerGeneration` equal to the released close evidence's
`ingressGeneration`; otherwise the field is absent. A mismatched, noncumulative,
unnecessary, missing, or later-generation fence is invalid.

`absent-after-restart` omits `releaseCloseDigest` and
`priorIngressProjectionGenerationFenceDigest`, requires positive safe-integer
retired/current owner generations with current strictly greater than retired,
requires `projectionTerminalEvidenceKind = retired-generation-fence`, binds the
exact `ingress-extension` `RealmObservationProjectionGenerationFenceV1` digest
with the same generation pair, and requires both retired-generation projection
counts to be literal `0`. It is issued only after the retired generation is
durably fenced, the current owner ledger proves no live claim for the old
binding, and the key authority proves no old branded handle or in-flight call.
The digest uses the displayed format as domain, major version `1`, and every
other present field. A later restart returns the same binding terminal evidence
rather than reclassifying it.

The aggregate cap is exactly one. Identity projection, source cursor leases and
subscriptions, rings, ledger writer, checkpoint writer, diagnostic buffer, and
app batch-reader lease are resources in the extension child's private resource
ledger, not M2 or additional M3 children. The port is kernel-private behind
`realmObservationIngressPort@1` and is not a third application dependency.

## Start order

Start performs exactly:

1. Validate the two-key dependency object without invoking a getter.
2. Read and cross-check the two prebound descriptors and binding receipts.
3. Call `assertCurrent()` and validate current M2 selection/recovery state, the
   applicable exact device-recovery projection, pseudonym-key currentness, and
   every exact portable binding field.
4. Initialize the separate eleven-definition M3A catalog in an isolated registry
   view and recompute catalog, manifest, profile, and normalization digests.
5. Claim the one M3A extension child and obtain its process-local work/teardown
   roots and ingress generation without touching the M2 child ledger. Under one
   protected acquisition transaction, reserve the identity-projection row,
   acquire with those object-identical signals, owner kind `ingress-extension`,
   and owner generation byte-equal to ingress generation, then atomically publish
   successful issuance plus the `owned` row before exposing the handle. A no-
   handle result instead commits no row, records that terminal outcome, and
   enters stop before another resource opens; stop advances to `closing` before
   sealing projection acquisition and issuing exact nonissuance evidence.
6. Open the protected ledger/checkpoint service and recover any committing
   append or checkpoint before reading a stored head.
7. Validate a candidate checkpoint and its complete protected graph; otherwise
   choose fresh snapshot without deleting the candidate evidence.
8. Open sources in exact source-manifest order, at most two concurrently, and
   admit each complete snapshot cut.
9. Expose the app batch reader only after all required source open results and
   the initial ledger/checkpoint state are terminal and verified.
10. Enter `live` and allow wake-only subscriptions.

Any failure before step 5 allocates nothing. Any failure after step 5 runs the
same stop path in reverse acquisition order and leaves M2 active.

## Stop order

Stop performs exactly:

1. Advance aggregate lifecycle state to `closing` and abort the work root.
2. Close app batch delivery and wait for in-flight reader calls to settle.
3. Stop new cuts and reconcile any append/checkpoint already dispatched; an
   uncertain durable result remains recovery-pending.
4. Detach wake subscriptions and source live-tail bindings in reverse source
   order.
5. Prove callback quiescence and close every ring/pending-causal buffer once.
6. Flush only a complete verified checkpoint when its predecessor remains
   current; otherwise retain the last checkpoint.
7. Close ledger/checkpoint/diagnostic resources in reverse construction order.
   If the atomic acquisition transaction registered an identity-projection row,
   close and read back that object-identical handle with the still-live teardown
   signal and mark its row `released` only after the exact verified result. If it
   registered no row, seal its projection-acquisition gate and obtain the exact
   nonissuance evidence for this binding and ingress generation; no close digest
   is synthesized. This branch runs only after step 1 established `closing`.
8. Compute the exact process-local aggregate-close evidence against the terminal
   private resource ledger.
9. Release the exact M3A extension child once with that close evidence.
10. If the continuation/key fences prove this portable binding terminal,
    resolve its immutable terminal-reason latch and exact extension-aggregate
    terminal evidence, including current object-identical close or sealed
    nonissuance, plus every required prior ingress-generation fence, or the exact
    sole absent-after-restart fence. Then invoke the binding-retirement drain
    without a caller-supplied reason. Validate the record-first complete result,
    including the closed blocker projection when blocked, while the key
    authority and teardown signal remain live; then release the opaque work/
    teardown roots and the M2 continuation observation subscription.

Double stop returns the same terminal disposition and performs no second
unsubscribe, write, resource-ledger removal, or aggregate release. No callback,
Promise completion, append result, recovery result, or timer may mutate M3A
after aggregate release or owner retirement.

A normal/cancelled app stop while the portable binding remains current does not
finalize binding retirement or release durable epoch references; a later same-
binding consumer may resume them. `retention-blocked` terminal drain evidence
keeps the key and every reference protected for kernel reconciliation and does
not resurrect the released extension child. The pseudonym-key authority
outlives all binding extensions and cannot close while a terminal drain is
dispatched or while any historical epoch still lacks a safe terminal result.

An M3A consumer restart claims a new extension child and process-local ingress
generation under a freshly asserted portable M2 binding; it does not allocate,
transfer, or alter an M2 process owner or lifecycle. That local generation is
used only for live handles, callback quiescence, quarantine, and teardown and is
excluded from batches, append/checkpoint/compaction receipts, and checkpoints.
Under the same current binding, restart must recover the durable ledger head,
last batch sequence, and checkpoint lineage before producing another batch; it
cannot reset or guess them. If the durable M2 lifecycle changed, the old
binding/checkpoint is stale and fresh acquisition is required. Restart offers
only serializable checkpoint/cursor hints after exact current validation and
never restores rings or listeners.

## Device loss

GPU device loss does not itself change an M3A source generation or M2 lifecycle
generation. M3B closes its presentation/ECS gate. M3A may continue CPU-side
ledger intake only within all normal limits while the exact M2 device-recovery
state remains current.

When buffers approach a limit, M3A stops cuts for the affected source; it does
not make GPU recovery an excuse for silent loss. Overflow forces snapshot
recovery. Presentation resumes only after an exact accepted M2
`RealmDeviceRecoveryReceiptV1` creates the `recovering` fence. M3B may then
commit only the bounded contiguous CPU tail behind that unchanged hidden fence.
Its commit-port `recover(device-resume)` must independently read the durable
selector and current retained M3A head/floor, prove that the applied cursor, all
seven source slots, every due expiry boundary, and current authority are caught
up, bind the exact selector-read/catch-up receipts, and perform the one protected
closed-to-ready presentation-gate transition. Escalated M2 stop runs the normal
M3A stop order.

## Source-specific safe-normalization policy

All M3A observations are `owner-private + local-private`. The following rules
are stricter than the general M0 schemas and are mandatory before app delivery.

### Boot

Allowed: registered boot phase class, safe service ID, dependency IDs already
safe for this audience, lifecycle state, bounded safe reason code, explicit
metrics, source sequence, and freshness.

Forbidden: raw logs, exception objects, stack traces, environment, command
line, credentials, account identity, storage keys, source paths, device
fingerprints, and invented completion. `service-ready` appears only after the
owning service reports terminal readiness.

### Filesystem

Allowed: source-local opaque object/parent/previous-parent IDs, registered
object kind, source revision, mount generation, metadata-view class, safe-text
reference when separately admitted, bounded metric, content availability,
relationship changes, and coverage receipt.

Forbidden: raw path, private name, content, content hash, browser handle,
native file handle, mount secret, denied subtree name, unscoped source count,
and data inferred outside authorized VFS coverage. The adapter operates only on
the WebGPU OS VFS/StorageManager authority; it is not a host-disk scanner.

### Storage

Allowed: opaque store ID, backend class, generation, lifecycle, explicit
usage/capacity/rate/queue/pressure metrics, operation class, and safe health
classification.

Forbidden: logical or physical key, path, filename, value, plaintext, content
hash, journal bytes, protected-service namespace, encryption material,
transaction payload, stack trace, and reflected error text.

### Process

Allowed: opaque process and parent IDs, admitted application/service class,
lifecycle state, start source sequence, metrics with explicit unit/window/
quality, safe exit class, and observation generation.

Forbidden: command line, arguments, environment, credentials, private window
content, DOM/panel handle, stack trace, source path, raw manifest, and browser
object. Existing CPU/memory/network/disk estimates are labelled `estimated`;
they never become exact merely because they are rendered.

### IPC

Allowed: opaque channel, producer, and consumer IDs; IPC and message classes;
direction; lifecycle; bounded queue/throughput/latency/backpressure metrics; and
safe causal source references.

Forbidden: message payload, serialized object, transfer, port/handle, callback,
capability token, credential, raw endpoint name, private channel label, and
reflected error.

### Syscall

Allowed: opaque invocation/actor/target identities, registered syscall class
and action, lifecycle state, exact retained authority/result references,
capability epoch when required, entry/terminal source sequences, explicit
metrics, and safe reason code.

Forbidden: argument, return value, path, value, source byte, credential, token,
key, manager, function, raw handle, command line, stack trace, dispatch
capability, and reflected error. The sink observes the guarded wrapper boundary,
not arbitrary application functions.

### Permission and action result

Allowed: opaque binding/subject/object IDs, action class, decision class,
policy revision, capability epoch under the existing event matrix, bounded
issue/expiry, safe reason code, exact retained authority reference, and the
existing terminal action-result fields.

Forbidden: capability token, signing key, approval token, manifest body,
private predicate, raw policy rule graph, unrestricted audit log, authority
method, and receipt bytes not separately retained and verified.

### Local network

Allowed in M3A: only local endpoint/runtime lifecycle, local protocol/route
class, locally observed transport epoch, explicit quality-labelled metrics, and
safe causal receipt references. `routeId` and `linkId` are operator-private
source-local pseudonyms that cannot encode a URL, address, peer, or secret.

Forbidden in every M3A network observation: `peerIdentityRef`, peer ID, peer
count, remote presence, Traveler, Cityform, station occupant, remote route ID,
URL, IP address, hostname, ICE/SDP/candidate data, packet/frame/message bytes,
route capability, reconnect ticket, membership proof, organization/contact
scope, remote Operations data, and any signal that reveals whether a particular
remote user exists. Those concerns begin at M5 behind separate contracts.

## Flat module and ownership map

Filesystem folders organize concerns; they do not create nested runtime
ownership. Every row below is a flat peer constructed by one composition root.

### Trusted WebGPU OS peers

| Planned module | Sole responsibility |
| --- | --- |
| `webgpu-os/kernel/realm/RealmObservationServiceRoot.js` | Construct flat trusted peers, issue the exact two prebound app ports, and own aggregate start/stop ordering |
| `webgpu-os/kernel/realm/RealmM2ContinuationProjectionService.js` | Produce/assert one read-only selection-fenced portable M2 binding without widening a frozen M2 port |
| `webgpu-os/kernel/realm/RealmDeviceRecoveryObservationPort.js` | Project and reassert only accepted current M2 device-recovery receipt identity, lost/replacement generations, runtime bundle, restored-source binding, and resumed state |
| `webgpu-os/kernel/realm/RealmObservationPseudonymKeyPort.js` | Kernel-only durable operator-partition HMAC key authority, epoch/commitment currentness, generation-branded restricted identity projection/close, sealed nonissuance, retired-generation fences, append-only epoch-reference transitions, historical metadata verification, immutable terminal-reason latching, record-first binding-retirement drain, and protected rotation/retirement |
| `webgpu-os/kernel/realm/RealmObservationExtensionOwner.js` | Own the independent one-child M3A claim, work/teardown roots, atomic projection issuance/resource-row registration, resource ledger, release, owner-generation retirement, and protected complete-lineage released/absent-after-restart terminal evidence; never mutate M2 child tuples |
| `webgpu-os/kernel/realm/RealmObservationSourceRegistry.js` | Validate the exact seven-row manifest and resolve one adapter per row |
| `webgpu-os/kernel/realm/RealmObservationIngressCoordinator.js` | Atomic opens, vector cuts, bounded fairness, recovery state, and app batch-reader lease |
| `webgpu-os/kernel/realm/RealmObservationLedger.js` | Immutable observation bytes, segment/head CAS, append receipts, epoch-reference retain coupling, and read leases |
| `webgpu-os/kernel/realm/RealmObservationLedgerCompactor.js` | Deterministic oldest-excess-prefix selection, exact compaction union/readback, retained-root proofs, and committed segment-reference release |
| `webgpu-os/kernel/realm/RealmObservationRecoveryJournal.js` | Source-scoped immutable detection/open/recovered receipt heads, opening-cut/counter evidence, cursor-vector CAS, and recovery-journal epoch-reference lifecycle |
| `webgpu-os/kernel/realm/RealmObservationCheckpointStore.js` | Separate M3A checkpoint/head/M3-only graph-edge commit and recovery; M2 references are validation-only |
| `webgpu-os/kernel/realm/RealmObservationRetainedGraphVerifier.js` | Pure closed-kind edge validation, ordering, cardinality, target resolution, completeness, and protected-graph digest |
| `webgpu-os/kernel/realm/RealmObservationCausalValidator.js` | Pure parent existence, acyclicity, depth, and audience/policy compatibility checks |
| `webgpu-os/kernel/realm/RealmObservationIdentityProjector.js` | Convert raw source identities to owner-private stable IDs before M0 record construction |
| `webgpu-os/kernel/realm/RealmObservationSafeNormalizationProfile.js` | Export the exact immutable 15-field profile and nine closed rule rows without callback, source, or key authority |
| `webgpu-os/kernel/realm/RealmObservationProfileRegistry.js` | Resolve immutable code-shipped profile ID/digest/object triples |
| `webgpu-os/kernel/realm/RealmObservationDiagnostics.js` | Bounded safe counters, states, reason codes, and timings; no raw payloads |
| `webgpu-os/kernel/realm/RealmBootObservationAdapter.js` | Boot snapshot/tail normalization |
| `webgpu-os/kernel/realm/RealmCanonicalStorageEventSink.js` | Assign one canonical storage event identity before fan-out and exclude service recursion |
| `webgpu-os/kernel/realm/RealmCanonicalStorageObservationAdapter.js` | Atomic authorized inventory plus canonical filesystem/storage observations |
| `webgpu-os/kernel/realm/RealmProcessObservationAdapter.js` | Process lifecycle/metric snapshot and tail normalization |
| `webgpu-os/kernel/realm/RealmIpcObservationSink.js` | Payload-free IPC lifecycle and metrics |
| `webgpu-os/kernel/realm/RealmSyscallObservationSink.js` | Argument-free guarded syscall lifecycle and correlation |
| `webgpu-os/kernel/realm/RealmAuthorityObservationSink.js` | Permission and terminal action-result normalization |
| `webgpu-os/kernel/realm/RealmLocalNetworkObservationAdapter.js` | Structurally local-only network boundary normalization |

### Virtual Realm app peers

| Planned module | Sole responsibility |
| --- | --- |
| `webgpu-os/apps/the-virtual-realm/observation/VirtualRealmM3AObservationEntry.js` | Validate the exact two-key composition, cross-check bindings, start/stop one M3A session |
| `webgpu-os/apps/the-virtual-realm/observation/RealmObservationBatchReader.js` | Resolve bounded admitted batches/records through the prebound read lease for M3B |
| `webgpu-os/apps/the-virtual-realm/observation/RealmObservationSessionState.js` | Immutable aggregate/source state transitions and bounded receipt projection |

Concrete peers do not import each other. The trusted root and app root receive
factories and ports, construct peers, and connect their narrow methods. There is
no `RealmManager`, nested service locator, ambient kernel lookup, global Engine
lookup, or renderer-to-driver import.

## M3A app-facing port

The prebound `realmObservationIngressPort@1` exposes exactly:

```text
descriptor()
  -> immutable port version, binding receipt, profile/catalog/manifest IDs and digests

open({ expectedBindingReceiptId, expectedBindingDigest, signal })
  -> opened | unavailable | retired | rejected

read({ sessionHandle, afterBatchSequence, maximumBatches, maximumBytes, signal })
  -> batches | empty | stale | recovery-pending | retired | closed

onAvailable({ sessionHandle, signal }, listener)
  -> idempotent unsubscribe

checkpoint({ sessionHandle, expectedBatchSequence, signal })
  -> committed | conflict | recovery-pending | aborted-before-dispatch | invalid | unavailable

close({ sessionHandle, reason })
  -> closed | already-closed
```

`opened` contains exactly `status`, the branded process-local session handle,
extension-child ID, ingress generation, and binding receipt ID/digest. The work
and teardown roots stay inside the service. `unavailable`, `retired`, and
`rejected` contain only `status` plus one safe reason code and no partial handle.
The session handle is non-constructible by the app and bound to the exact port
receipt and independent M3A extension-child claim. `maximumBatches` and
`maximumBytes` can only reduce profile ceilings. `read()` never returns raw
source handles or direct storage access. `onAvailable()` is wake-only and obeys
the same lifecycle fence as internal wake subscriptions. `checkpoint()` returns
`invalid` only for a closed-schema/profile/binding/graph validation failure and
`unavailable` only before durable dispatch; both contain one bounded reason and
no `RealmObservationCheckpointCommitReceiptV1`.

## Diagnostics

Diagnostics contain only:

- source kind and safe source ID;
- aggregate/source state and safe reason code;
- source generation and accepted/high/retained sequence counters;
- record/byte occupancy and high-water marks;
- duplicate, reorder, gap, overflow, recovery, append, checkpoint, and
  compaction counters;
- explicit quality-labelled duration/work metrics;
- profile/catalog/manifest/normalization IDs and digests;
- bounded receipt IDs and digests.

They contain no account ID, raw operator ID, path, filename, app ID, IPC name,
syscall arguments/results, capability token, source bytes, message/packet,
address, peer identity, stack trace, reflected error, storage key, live handle,
or hidden source count. The ring retains at most 256 entries and 262,144 bytes.
When full it drops the oldest diagnostic only; diagnostic loss never advances
an observation cursor or changes authority.

## Clean-room and Engine boundary

M3A adopts only these independently specified invariants from the audited
Playground research:

- CSE: explicit causal parents, idempotent acceptance, authority-separated
  evidence, concurrent facts without fabricated total order, and bounded-proof
  honesty;
- URC: selecting or retaining a projection does not commit truth; a rejected
  witness remains non-current and non-authoritative;
- State-First: presentation decisions consume later authoritative state and
  cannot change source semantics;
- Root Algebra: optional optimization follows proof, counterexample, exact
  bounds, and mandatory baseline parity; it is prohibited from M3A authority,
  redaction, and ledger paths.

No Playground source, module graph, wrapper, shader, UI, camera, geometry,
scene, color grammar, loader, probe, fallback, or demo global enters production
or release fixtures. M3A uses the existing Engine/CSE public surface only
through injected version-checked function references. State-First is an M3B/M2
presentation concern and is not imported here.

## Ten implementation pieces

1. **[NEW] Contracts and vectors:** implement the exact eleven-definition M3A
   catalog, profile/manifest objects, canonical examples, and hostile Python
   vectors without changing M0-M1C.
2. **[NEW] Separate composition:** implement the two-key M3A app entry, the
   selection-fenced portable binding projection, internal device-recovery and
   pseudonym-key facets, prebound aggregate port, independent extension-child
   accounting with nonreused owner generations and released/absent-after-restart
   terminal evidence, and import inertness without an M2 tuple change.
3. **[MODIFY] Canonical sources:** add boot, storage/VFS identity, process, IPC,
   syscall, permission/action-result, and local-network instrumentation at the
   owning authorities.
4. **[NEW] Safe normalization:** implement exact per-family allowlists, the
   restricted durable HMAC projection/close/epoch/rotation protocol, generation-
   branded handles and cumulative retired-generation fences, historical epoch-
   reference lifecycle, immutable terminal-reason latch, record-first terminal
   binding drain, M0 validation, secret sentinels, and protected-root recursion
   exclusion.
5. **[NEW] Source protocol:** implement atomic open, snapshot/tail retention,
   wake-only subscription, cursor ACK/floor, exact unions, and idempotent close.
6. **[NEW] Deterministic ingress:** implement vector-watermark cuts, bounded
   reorder/causal work, duplicate/equivocation rules, topological serialization,
   and deterministic chunking.
7. **[NEW] Durable ledger:** implement immutable segments, predecessor/proposal
   CAS, append/read leases, recovery-pending resolution, retention, and the exact
   deterministic compaction operation/receipt union over contiguous intervals.
8. **[NEW] Checkpoint/recovery:** implement the separate protected M3A sidecar,
   complete graph edges, source-scoped recovery journal, counter/opening-cut
   evidence, recovered-to-opening/multi-append equality, restart validation, and
   no M2 V1 widening.
9. **[NEW] Lifecycle/backpressure:** implement caps, no-loss overflow recovery,
   identity-projection call settlement and exact close readback, reverse cleanup
   with state-transition-paired private resource-ledger snapshots, device-loss
   currentness, diagnostics, and static-M2 fallback.
10. **[NEW] Acceptance:** implement the exact 48-case browser ledger, Python
    vectors, zero-skip receipt, import/exclusion scans, regression run, and docs
    evidence.

Each piece is independently reviewable. Pieces 1-2 precede source acquisition;
3-5 precede ledger work; 6 precedes 7; 7 precedes 8; 1-9 precede acceptance.
Rollback removes or disables the M3A composition and source instrumentation
without touching accepted M2 artifacts or RealmForge implementation files.

## Planned test layout

```text
tests/virtual-realm/observation/
  m3a-observation-contracts.test.html
  m3a-observation-contracts.main.js
  m3a-observation-contracts.test.js
  m3a-source-handshake.test.html
  m3a-source-handshake.main.js
  m3a-source-handshake.test.js
  m3a-ledger-recovery.test.html
  m3a-ledger-recovery.main.js
  m3a-ledger-recovery.test.js
  m3a-source-privacy.test.html
  m3a-source-privacy.main.js
  m3a-source-privacy.test.js
  m3a-lifecycle-backpressure.test.html
  m3a-lifecycle-backpressure.main.js
  m3a-lifecycle-backpressure.test.js
  support/
    VirtualRealmM3AContractFixtures.js
    VirtualRealmM3AFrozenTraceSource.js
    VirtualRealmM3AHostileSources.js
    VirtualRealmM3ATestReceipt.js

tests/network/
  test_virtual_realm_m3a_vectors.py
  realm/
    virtual-realm-m3a-vectors-v1.json
```

Browser pages use the repository runner contract, emit an immutable receipt
with exact planned/passed/failed/skipped counts, and treat any skip as failure.
Python independently recomputes canonical bytes, digests, ordering, bounds,
cursor transitions, and frozen trace outputs; it does not invoke browser code.

## Exact 48-case ledger

The five browser pages together own exactly 48 cases:

| Case | Required assertion |
| --- | --- |
| `M3A-OBS-01` | Initialize exactly eleven M3A runtime definitions through the existing registry without changing the frozen M0-M1C definition count or order |
| `M3A-OBS-02` | Validate the exact 34-field base profile, recompute its digest, accept every exact ceiling including 4,096 retained graph edges, and reject every plus-one, missing, extra, inherited, accessor, symbol, mutable, and malformed variant before acquisition |
| `M3A-OBS-03` | Validate the exact seven-row source manifest, row schema/order, nine M0 observation-kind assignments, adapter/port/source-schema versions, per-row normalization pair, availability/retention classes, and digest |
| `M3A-OBS-04` | Reject every malformed two-key M3A dependency object and prove the accepted M2 15-key V1 object remains byte-for-byte unchanged |
| `M3A-OBS-05` | Produce and cross-check one selection-fenced portable binding from the retained initial operator projection plus exact current assertions, the restricted kernel pseudonym-key authority/epoch/commitment, and the closed device-recovery observation union; reject stale/displaced/presentation-transition/recovery-evidence/key-rotation-pending state and replay across Realm, operator, owner, lifecycle, active bundle/CSE output, heads, profile, policy, pseudonym epoch, catalog, or manifest |
| `M3A-OBS-06` | Claim exactly one capped independent M3A extension child and bind its opaque work/teardown roots after portable validation; under one protected acquisition transaction either co-commit identity-projection issuance plus its `owned` row before exposing the handle, with object-identical signals, exact `ingress-extension` owner kind, and owner generation equal to the nonreused ingress generation, or commit no row and record the terminal no-handle outcome; for the latter, enter stop, establish `closing`, then seal acquisition and issue exact zero-issued nonissuance evidence; account every identity-projection/source-cursor/subscription/ring/ledger/checkpoint/diagnostic/reader resource beneath it, and prove zero M2 child registration or tuple mutation |
| `M3A-OBS-07` | Prove atomic open retains every event after the snapshot watermark before `ready` becomes observable |
| `M3A-OBS-08` | Prove `ready`, `changed`, `gap`, `unavailable`, and `closed` results are exact, mutually exclusive, bounded, and contain no partial records on failure |
| `M3A-OBS-09` | Prove wake callbacks carry no data or authority, tolerate duplicate/delayed/omitted wakeups, and cannot reenter capture |
| `M3A-OBS-10` | Resume only an exact retained cursor and otherwise require a fresh bounded snapshot without advancing the accepted cursor |
| `M3A-OBS-11` | Accept one source tuple once and discard a byte-identical duplicate without changing ledger bytes or batch sequence |
| `M3A-OBS-12` | Quarantine same-tuple different-ID/digest/bytes equivocation before append |
| `M3A-OBS-13` | Buffer bounded out-of-order records and admit them only as one contiguous source interval |
| `M3A-OBS-14` | Detect retained-floor loss with `intervalStartSequence = previous.nextExpectedSequence` and `intervalEndSequence = earliestRetainedSequence - 1`, preserve the last accepted cursor, mark the source stale, quarantine any internal hole in the claimed retained range, and recover only through a verified snapshot/tail handshake |
| `M3A-OBS-15` | Detect the first dense record refused by each per-source/global record/byte ceiling in fixed precedence, bind the exact atomic preinsert counter snapshot byte-for-byte to the receipt's binding/source/descriptor/generation/floor and one-sequence overflow interval, preserve the cursor, issue no later generation sequence, perform no silent drop or ACK, and require snapshot recovery |
| `M3A-OBS-16` | Advance source generation on actual source replacement and every pseudonym-key rotation; reject every stale-generation, old-binding, and old-key-epoch callback, capture, cursor, record, and checkpoint; derive terminal binding retirement through the exact reachable seven-row continuation-reason precedence map, including the distinct normalization-policy-change reason, and durably latch its first terminal row for record-first retries; retain and release historical ledger-segment/checkpoint/recovery-journal epoch references only through their exact ordinary evidence or the atomic terminal binding-retirement drain for final no-successor roots; require exact complete-lineage extension-aggregate terminal evidence that binds current close/nonissuance plus any required prior fence or one sole absent-after-restart fence, and return the exact seven-kind bounded safe blocker projection whenever a drain cannot proceed even if no reference or protected-edge ID is available; retire old key material only at verified zero references; and preserve an immutable non-reactivating metadata tombstone |
| `M3A-OBS-17` | Reproduce byte-identical batches after consumer restart within the same retained source/ledger/checkpoint and pseudonym-key epoch lineage by restoring durable batch sequence and excluding the new process-local ingress generation from every batch identity |
| `M3A-OBS-18` | Produce a reproducible semantic opening-cut digest and attempt-specific receipts after actual source restart; require recovered-to-opening receipt equality, prove one or more consecutive committed append receipts cover the exact nonempty cut and final cursor, prove the exact empty-cut no-record branch, and never claim prior-generation or cross-attempt receipt byte identity |
| `M3A-OBS-19` | Preserve cross-source concurrency in the absence of explicit parents regardless of arrival, callback, frame, timestamp, or manifest order |
| `M3A-OBS-20` | Topologically admit explicit same-source and cross-source parents, with canonical tie-breaking that makes no new causal claim |
| `M3A-OBS-21` | Bound delayed-parent work and reject unknown, expired, self, descendant, audience-incompatible, and policy-incompatible parents |
| `M3A-OBS-22` | Reject causal fan-out/depth exact plus-one and every cycle before ledger append |
| `M3A-OBS-23` | Freeze a seven-row vector watermark and reproduce identical batches under duplicate, reordered, delayed-to-consumer, and segmented delivery of the same sealed trace |
| `M3A-OBS-24` | Chunk only by exact record/byte ceilings; reject an oversized single record and prove ring pressure, wall time, and frame cadence cannot change batch boundaries |
| `M3A-OBS-25` | Commit batch, cursor vector, batch sequence, ledger head, and append receipt together under exact predecessor/proposal CAS or change none |
| `M3A-OBS-26` | Classify proven competing CAS as conflict and uncertain post-dispatch state as recovery-pending; keep proposed, observed-conflict, and committed ledger heads disposition-conditional and reconcile exact bytes without blind retry |
| `M3A-OBS-27` | Give one underlying StorageManager mutation one canonical identity before VFS/storage fan-out and prevent duplicate source-operation accounting |
| `M3A-OBS-28` | Exclude M3A ledger/checkpoint/operation/compaction/Chronicle writes from storage observation and prove no recursive event loop |
| `M3A-OBS-29` | Admit only safe boot fields and refuse raw logs, errors, stacks, environment, credentials, paths, and inferred readiness |
| `M3A-OBS-30` | Admit only opaque authorized filesystem fields and refuse raw paths, names, contents, hashes, handles, mounts, denied subtrees, and host-disk scope |
| `M3A-OBS-31` | Admit only safe storage fields and refuse keys, paths, names, values, plaintext, hashes, journals, protected roots, encryption material, and reflected errors |
| `M3A-OBS-32` | Admit only opaque process lifecycle/quality-labelled metrics; label browser estimates and refuse command, args, env, credentials, private UI, handles, paths, manifests, and stacks |
| `M3A-OBS-33` | Admit only payload-free IPC fields and refuse messages, transfers, ports, callbacks, tokens, credentials, names, labels, and reflected errors |
| `M3A-OBS-34` | Admit only guarded syscall lifecycle/correlation and refuse arguments, returns, paths, values, bytes, credentials, keys, handles, command lines, stacks, and dispatch authority |
| `M3A-OBS-35` | Admit only permission/action-result allowlists and require exact authority plus matching terminal observation before any later success claim |
| `M3A-OBS-36` | Structurally exclude every peer identity/count, remote presence, address, URL, ICE/SDP, packet, ticket, capability, membership, contact, Traveler, Cityform, and remote Operations field from M3A network records |
| `M3A-OBS-37` | Persist only validated safe-normalized observations and coordination records; prove raw manager events and pre-normalization buffers never enter ledger/checkpoint bytes |
| `M3A-OBS-38` | Commit a separate protected M3A checkpoint with exact current M2 equality, safe-normalization and pseudonym-key binding, seven exact cursor slots, ledger head, lineage, and the closed ordered/capped/self-digested complete M3-owned edge schema without widening or retaining through M2 V1 |
| `M3A-OBS-39` | Reject forged, stale, torn, corrupt, cross-operator, cross-Realm, cross-lifecycle, cross-bake, cross-policy, or incompletely edged checkpoints and choose fresh snapshot safely |
| `M3A-OBS-40` | Recover crashes before dispatch, after dispatch, after segment write, after head write, and after checkpoint write through exact predecessor/proposal readback |
| `M3A-OBS-41` | Close segments at exact limits; exercise the complete compaction result union and no-op reasons; deterministically select only the oldest exact excess closed-segment prefix; derive the three retained-root proofs byte-for-byte from the authorizing checkpoint's canonical edge classes; retain on blocked, conflicting, aborted, or uncertain reachability; during a current binding release segment epoch references only from a committed receipt while reserving the complete-set terminal binding drain for a proven retired binding; and invalidate rather than pin a retired M2 binding |
| `M3A-OBS-42` | Keep append, detection, opening, recovered, checkpoint, and compaction receipt dispositions separate, immutable, issuer/scope bound, and exact across conditional head, multi-append, and no-record variants; independently recompute recovery receipt IDs over attempt-local fields and receipt digests over the complete applicable schema |
| `M3A-OBS-43` | Stop during every start/append/checkpoint/recovery phase, abort work and settle projection calls before teardown, close/read back a generation-branded registered identity-projection handle exactly once or bind exact sealed nonissuance when no handle was ever issued, reject a bare digest, garbage collection, or handle loss as close authority while that generation remains live, close remaining resources in exact reverse order, settle prior normal releases, freeze only the current live-resource close cohort, pair acquired and terminal rows by exact `(resourceKind, resourceOrdinal, resourceBindingDigest)` while proving `owned` to `released` state changes and independently recomputed unequal state-bound row digests, prove callback quiescence and zero resources through aggregate-close evidence, release once, and allow no post-release mutation |
| `M3A-OBS-44` | Handle a no-handle acquisition result, a crash after projection acquisition, double stop, same-binding restart, operator switch, M2 replacement, lifecycle retirement, terminal-reason drift, and stale async completion without generation reuse or live-handle restoration; require zero-issued sealed nonissuance for the clean no-handle release, require a cumulative retired-generation fence after crash, and prove that a later normally closed same-binding generation's released evidence, retirement record, and CAS bind both its current object-identical close and the prior cumulative fence, while the no-later-release branch binds that fence as sole absent-after-restart proof; return the same retirement record through record-first `already-finalized` lookup without reclassifying the latched reason |
| `M3A-OBS-45` | During device loss retain bounded CPU intake only; through the exact kernel-private recovery-observation union require byte-identical bracketed lost/replacement generation, active runtime-bundle, restored-source, resumed-state, and accepted M2 receipt evidence before projection resume; reject changing/missing evidence and force snapshot recovery on overflow |
| `M3A-OBS-46` | Apply only the three fixed metric coalescing rules after admission; allow subset-or-equal groups with each observation in at most one group, preserve individual ledger digests, and never coalesce protected or causally referenced events |
| `M3A-OBS-47` | Prove flat peer/import boundaries, zero Playground production import/probe/copy, zero ambient manager/Engine access, bounded redacted diagnostics, and static-M2 fallback when every adapter is disabled |
| `M3A-OBS-48` | Emit one immutable `48 planned / 48 passed / 0 failed / 0 skipped` receipt and keep all accepted M0-M2, M1A-M1C, Engine, local-operator, and Python suites green |

## M3A certification gates

The exact `VR-M3A-001` through `VR-M3A-022` rows are mirrored byte-for-byte in
the [Certification Plan](certification-plan.md#m3a-observation-ingress-gates).
That table is the release index; this page owns the detailed implementation
meaning and 48-case evidence. Any wording or count drift is a documentation
failure.

| Gate | Required proof |
| --- | --- |
| `VR-M3A-001` | The separate import-inert M3A runtime catalog initializes exactly eleven complete definitions through the existing registry and changes no frozen M0-M1C definition, count, or order |
| `VR-M3A-002` | The exact immutable 34-field base profile and exact-schema seven-row source manifest recompute their IDs/digests, enforce every per-source/global record/byte/causal/retention/graph-edge/recovery ceiling, accept exact bounds, and reject plus-one or structural variants before acquisition |
| `VR-M3A-003` | The separate M3A entry accepts exactly two prebound ports without widening M2's 15-key V1; both expose one selection-fenced portable operator/Realm/owner/lifecycle/active-bundle/head/profile/policy/pseudonym-key-authority-and-epoch/catalog/manifest binding built from M2's retained initial operator projection plus current assertions, while kernel-only key and device-recovery observation facets remain internal and one independent M3A extension claim binds process-local work roots without adding an M2 child tuple |
| `VR-M3A-004` | Seven trusted sources own exactly nine existing M0 observation kinds through exact adapter/port/source-schema-version and normalization bindings; raw managers remain kernel-private, safe normalization is irreversible before app/ledger delivery, and later Realm disclosure can only preserve or narrow those bytes |
| `VR-M3A-005` | Atomic source open registers tail capture before freezing snapshot/watermark, exposes exact ready/changed/gap/unavailable/closed unions and retention floor, and closes the snapshot-to-subscription race without partial failure records |
| `VR-M3A-006` | One authority assigns dense nonreused source sequences; the restricted durable operator-partition HMAC authority binds exact derivation bytes, epoch, commitment, restart stability, rotation, kernel-only ledger-segment/checkpoint/recovery-journal reference transitions, historical verification, generation-branded projection handles, atomic handle-issuance/resource-row registration or sealed zero-issued nonissuance, cumulative retired-generation zero-handle/zero-in-flight fences, a reachable seven-row continuation-reason precedence map with a distinct normalization-policy-change retirement reason and immutable record-first terminal-reason latch, an atomic final binding-retirement drain for terminal no-successor roots, exact complete-lineage released/absent-after-restart extension-aggregate evidence, an exact seven-kind bounded safe blocker projection that remains truthful without reference or edge IDs, zero-reference key retirement, permanent non-reactivating tombstones, object-identical work/teardown signal separation, and idempotent non-authorizing projection-close readback; byte-identical duplicates are idempotent, same-tuple byte conflicts quarantine, stale generations or key epochs cannot mutate state, and portable binding-bound cursors remain distinct from live binding and projection-applied cursors |
| `VR-M3A-007` | Gap, overflow, incompatible replacement, and unavailable state preserve the last accepted cursor, issue exact detection evidence, and mark only the affected source stale; dense retained-floor gap arithmetic and first-refused-record overflow arithmetic are exact, and overflow counter evidence is byte-bound to its enclosing binding/source/descriptor/generation/floor; recovery requires byte-identical opening-receipt scope and a reproducible opening-cut digest, then either a consecutive committed append-receipt chain covering exactly that nonempty cut or an exact empty no-record commit before resume |
| `VR-M3A-008` | Explicit causal parents are bounded, known, acyclic, depth-limited, audience/policy compatible, and topologically earlier; observations without parents remain concurrent regardless of arrival, clock, frame, serialization, manifest, or visual order |
| `VR-M3A-009` | Ledger-issued vector-watermark cuts, canonical non-causal tie-breaking, exact count/byte chunking, and durable binding-scoped batch sequence reproduce byte-identical batches for the same sealed generations under duplicate/reordered/delayed-to-consumer/segmented delivery and same-generation, same-pseudonym-key-epoch consumer restart; process-local ingress generation is excluded, while actual source restart advances generation and key rotation advances every generation under a new binding, each reproducing the semantic opening cut and committed output but intentionally producing distinct attempt-local recovery receipt identities |
| `VR-M3A-010` | Batch, cursor vector, batch sequence, segment/head, and append receipt commit together through exact predecessor/proposal CAS; proposed, observed-conflict, and committed head fields are disposition-conditional, proven competitors conflict, uncertain dispatch is recovery-pending, and M3A claims no DynamicStore, ECS, CSE-root, renderer, Storylet, or bake activation |
| `VR-M3A-011` | The boot adapter admits only registered phase/service/lifecycle/reason/metric evidence, never raw logs/errors/stacks/environment/credentials/paths, and never presents readiness before the owning service's terminal observation |
| `VR-M3A-012` | One canonical storage authority assigns identity before fan-out; filesystem/storage observations share that source without duplicate operation accounting, exclude M3A protected namespaces, and expose no raw path/name/content/hash/handle/key/value/plaintext/journal/secret/error or host-disk scope |
| `VR-M3A-013` | Process observations expose only opaque lifecycle and explicit quality-labelled metrics, preserve estimate labels, and contain no command line, arguments, environment, credentials, private UI, handles, source paths, raw manifests, or stacks |
| `VR-M3A-014` | IPC observations expose only opaque endpoints, registered classes/lifecycle, bounded metrics, and safe causal references; no message, transfer, port, callback, token, credential, raw name/label, or reflected error crosses the boundary |
| `VR-M3A-015` | Syscall observations originate at the guarded wrapper and expose only typed lifecycle/correlation, retained authority/result references, epochs, sequences, metrics, and safe reasons; arguments, returns, paths, values, bytes, credentials, keys, handles, commands, stacks, and dispatch authority are absent |
| `VR-M3A-016` | Permission/action-result observations expose only their strict M0 allowlists; tokens, keys, approval material, manifests, predicates, rule graphs, raw audit logs, authority methods, and unverified receipt bytes are absent, and later success requires exact authority plus matching terminal result |
| `VR-M3A-017` | M3A network observations are structurally local-only: peer identity/count, remote presence, addresses/URLs, ICE/SDP, packets/messages, tickets/capabilities/membership, contacts, Travelers, Cityforms, station occupants, and remote Operations data are unrepresentable |
| `VR-M3A-018` | Immutable safe observations live in bounded hash-linked segments; append, detection, opening, recovered, checkpoint, and compaction receipts use separate exact conditional schemas; the exact compaction operation owns deterministic oldest-excess-prefix selection, all terminal/uncertain/no-op/invalid/unavailable results, and cancellation boundaries; each proposal proves one nonempty unique chain-ordered contiguous segment/batch interval with exact predecessor/successor boundaries, derives three retained-root digests from the authorizing checkpoint's canonical causal/authority/recovery edge classes, retains data and epoch references on every unresolved, blocked, conflicting, aborted, or uncertain outcome, and during a current binding releases segment epoch references only from a committed receipt while the separate complete-set drain is restricted to a proven retired binding |
| `VR-M3A-019` | A separate protected M3A checkpoint binds exact current M2 equality, pseudonym-key authority/epoch/commitment, seven exact cursor slots, ledger head, lineage, and a closed ordered/capped/self-digested complete M3-owned edge set verified through exact target resolution; it creates no M2 retention edge, never widens or treats M2 checkpoint/handoff V1 or `logicalCursorId` as M3 restore authority, and restores no live object |
| `VR-M3A-020` | Start/stop/failure/restart/operator-switch/M2-replacement/device-loss paths use one capped independent M3A extension child, object-identical work/teardown signals, atomic projection issuance plus resource-row registration or exact sealed nonissuance, work abort and projection-call settlement before exact idempotent identity-projection close readback for a live acquired generation, a cumulative zero-handle/zero-in-flight projection fence only after owner-generation retirement and required beside a later same-binding release when an earlier generation crashed, reverse disposal, callback quiescence, paired exact snapshots over the live close cohort after prior normal releases settle that preserve each row's `(resourceKind, resourceOrdinal, resourceBindingDigest)` while changing `owned` to `released` and independently recomputing unequal state-bound row digests, exact process-local aggregate-close evidence and single release, protected released-or-absent-after-restart aggregate terminal evidence that binds current close/nonissuance plus every required prior fence or the sole absent-after-restart fence before binding retirement, record-first retry after terminal-reason drift, no M2 child mutation, no generation ABA, bounded CPU intake, the closed recovery-observation union and accepted recovery-receipt evidence before presentation resume, and no post-release mutation |
| `VR-M3A-021` | Per-source/global rings expose ACK/floor/occupancy, never silently lose protected events, use only the three fixed post-admission metric coalescing rules with subset-or-equal groups and one-group-per-observation membership, keep diagnostics bounded/redacted, preserve flat import/clean-room boundaries, and leave the static M2 city usable when M3A is disabled |
| `VR-M3A-022` | The exact 48-case browser ledger and independent hostile vectors pass with zero skips while every accepted M0-M2, M1A-M1C, Engine, signer, local-operator, and Python regression remains green |

## M3A-to-M3B handoff

M3B receives only:

- a bounded `RealmObservationBatchV1` reader-port facet;
- safe-normalized M0 observation bytes resolved by batch ID/digest;
- exactly seven byte-identical closed 11-key source-cursor slot variants and
  durable 13-field versioned stale/recovering/unavailable/quarantined source-
  state snapshots
  containing one exact M3A-owned tick-authority evidence pair;
- a port-local exact 11-field retention-state projection of the current M3A
  ledger head, retained floor, and next expected batch sequence, always on
  `ready`, `source-state-ready`, and byte-identical `idle`; `gap` carries the
  same value only when it verifies, otherwise the reader returns `unavailable`;
- complete canonical 15-field reader evidence-escrow manifest bytes and the
  binding 18-field read-call receipt bytes plus its pair for every artifact-
  producing `ready` or `source-state-ready` result;
- exact append/recovery receipt references and the append receipt's immutable
  `issuedLogicalTick`;
- the current selection-fenced presentation state/generation and conditional
  accepted `RealmDeviceRecoveryReceiptV1` ID/digest from the continuation port;
- the current M2/M3A binding IDs/digests needed to reject stale work.

M3B receives no raw manager, source adapter, storage face, listener, ring,
callback, source lease, normalization preimage, M3A checkpoint write authority,
or ledger append authority. M3A hands off observation evidence only. An authority
observation may contain its already safe opaque receipt reference, but M3A does
not deliver receipt bytes, current-grant state, a token, dispatcher, or authority
method. M3B independently resolves bounded canonical authority evidence through
separate recorded-cut and current-fence modes of
`realmProjectionContextPort@1`; only recorded evidence enters a root, while the
complete current snapshot can only fail-close the ephemeral presentation/action
adapter. Both modes return canonical `authorityResolutionReceiptBytes` plus
their pair under one closed 21-field maximum internal receipt vocabulary;
recorded mode has 19 own keys and also returns the complete 15-field recorded-
authority escrow-manifest bytes, while current-only mode has 13 own keys.
Static subject resolution separately returns canonical
`staticResolutionReceiptBytes` plus their pair under its exact 24-field internal
receipt. Recorded resolution consumes every structurally valid authority-domain
observation in the frozen M3A batch exactly once before M3B freezes its input cut
or disclosure decision set; omitted observations therefore cannot bypass
recorded-evidence validation. App and trusted prepare reuse one neutral pure
semantic kernel. M3B owns
its separate projection-applied cursor. A projection failure cannot roll back or
rewrite an M3A ledger append.

The exact consumer boundary is frozen in
[M3B Disclosure and Dynamic Projection](m3b-disclosure-projection.md). M3B wraps
this handoff behind a restricted `realmObservationBatchReaderPort@1`; the reader
can obtain only the next bounded batch or evidence-complete changed source/tick
state, exact safe record bytes, seven source-state slots, durable batch/source
ticks with exact tick-authority evidence, the current retained head/floor
projection, and closed receipt references. Before an artifact-producing return,
its trusted service copies the complete required M3A evidence set byte-
identically into a bounded candidate escrow and returns the canonical manifest
and `readCallReceiptBytes` plus their pairs; M3B prepare adopts the escrow into
the root store or close releases it. An unchanged `idle` returns the byte-
identical last-applied source snapshot and
retention state but creates no escrow or M3B artifact. This is not an M3A write,
ACK, or retention decision. The reader has no ACK, seek-behind-floor, append,
checkpoint, compaction, source, or recovery mutation method. M3B's independent
applied cursor never advances an M3A source cursor, ledger head, retained floor,
checkpoint, or compaction decision.

M3B's exact 14-field catalog receipt embeds its own 17-field 50-definition/50-
extractor/78-authority-rule/78-predicate reference-descriptor pack and compiled
12-field three-import/50-domain/78-carrier registry. Its sole 21-field source
matrix has exact import/shape/recovery/domain/carrier/producer-seed/producer-
variant/direct-edge/alias-source/literal-alias/reference counts of
3/6/9/50/78/87/111/111/108/105/137. The M3A catalog is one
of exactly three pinned imports: it supplies accepted definition bytes and
issuer-owned resolution only. M3A does not author M3B descriptor rows, producer
edges, root objects, lease targets, aliases, or carrier authority, and M3B cannot
replace an M3A digest with a locally inferred schema.

The downstream projector recipe contains exactly 53 event rows, 130 primary
operation slots, 16 descriptor roles, and one witness recipe. M3A contributes
six local-network variants. The broader M0 `authenticated` variant is excluded
because this handoff cannot carry `peerIdentityRef`; peer authentication remains
M5 work, and every base-M3B IPC, syscall, and network route is non-traversable.
The exact 41-field downstream batch carries dynamic presentation-command ID/
digest arrays. Each command must join one batch pair, one pure-compiled or
retained-origin protected-closure byte object, and at least one admitted ID-only
presentation Delta. Command bytes count through protected closure, never
`deltaByteCount`; the witness reuses the primary command and emits only its
witness Delta. Stateful same-key work uses the exact sequential `transitionBase`
and exhaustive lowering. The 16-field pre-freeze work-count plan covers all 15
components and has conservative independent-ceiling sum 347137 without a
simultaneous-attainability claim.

The exact reader/context/commit descriptor ceilings are 65,536/33,554,432/
536,870,912 request bytes. Live requests are closed null-prototype objects with
exact own-key order/conditional presence; a work/cancellation signal is the
final live key when present and is excluded from canonical bytes, while no-
argument close uses the canonical empty-record digest. Every non-descriptor
result has format
`particle-realms.m3b-port-result`, version `1`, and an eight-key envelope whose
`resultId` is the existing M0 content ID over `(resultDomainId,
canonicalRequestDigest, format, version, status, runtimeBindingId,
runtimeBindingDigest, payload)`; `canonicalRequestDigest` uses
`particle-realms.m3b-port-request@1` over the exact descriptor `portName`, exact
`methodId`, and the method's ordered data-only field-name/value rows, and the envelope digest omits only
`resultDigest`. Object-identical work/cancellation signals are identity-free
control excluded from canonical request bytes and those ceilings.

The downstream input cut has exactly three 28-field variants. Observation cuts
bind the batch append evidence; changed source-state cuts bind their M3A-owned
tick authority; expiry cuts additionally require the exact 16-field due receipt
proving the least finite boundary above the prior frontier is at or below a newer
durable M3A tick. Neither maintenance variant advances the M3A batch cursor.
Current traffic alone derives finite expiry as saturating cut tick plus one;
every other primary Delta uses expiry `"0"`.
M3B resolves static data from subject IDs only, acquires its covering M2 artifact
lease only after the lease-neutral root and target set freeze, and requires that
root-store-scoped lease to remain nonexpiring until exact release or ownership
transition. During device recovery, bounded CPU-tail commits remain hidden behind
an accepted `recovering` fence; only commit-port `recover()` may join retained
head/floor, the terminal 18-field recovery-attempt evidence, and durable selector-
read/catch-up proof into the 37-field recovery receipt and closed-to-ready
transition through the trusted `RealmProjectionRecoveryService`. Its 18-field
recovery journal remains separate in the exact 24/18/18-field application,
recovery, and selector-retirement split under one shared quota.

Binding replacement is likewise downstream M3B ownership: the exact 21-field
empty/present descriptor and 21/25-field transition receipt require the separate
18-field selector-retirement record, exact 24-field detach receipt, conditional
21-field quarantine receipt, and successor open to prove predecessor retirement.
Stop/double-stop first uses
`beginStop()` and its exact 16-field receipt to capture/close the presentation
fence and freeze the trusted before inventory. Terminal context `closeSession()`
runs last and returns the exact
38-field M3B disposal receipt with candidate-lease settlement, extension release,
and paired 16-field resource snapshots whose `candidateLeaseCount`,
`sessionCandidateRootCount`, candidate, prepared, reader-escrow, callback, and
in-flight counts all reach zero after internal retained-owner or quarantine
transfer. Nonterminal `blocked` returns no terminal receipt or after snapshot;
none of those M3B receipts retires, compacts, acknowledges, or rewrites the M3A
ledger.

M3B registers the existing `projection-root` target resolver. Every committed
M3B root is self-contained because all required M3A bytes are retained as exact
root-owned canonical copies under their original M3A IDs/digests; M3A compaction
therefore cannot strand it. Registration or target resolution does not insert a
retention edge. Only the M3A checkpoint owner may optionally include the
already defined `checkpoint-to-projection-root` edge during an ordinary
checkpoint commit after resolving an actual M3B root. M3B cannot request,
author, rewrite, or release that edge and defines no duplicate checkpoint-link
receipt.

## Rollback boundary

M3A is additive. Rollback disables the M3A composition feature, closes its one
independent extension child through the normal stop order, and leaves the
accepted M2 static city, process-owner ledger, bake, ECS scene, cameras,
Operations View, and recovery contracts intact.

Verified ledger/checkpoint evidence is retained under normal bounded policy; it
is not recursively deleted during rollback. RealmForge implementation and
publication artifacts are untouched. Source instrumentation may remain dormant
behind its feature gate, but no app-facing port is issued while disabled.

## Approval boundary

Approval to implement M3A requires review of:

- the exact two-port composition and complete prebound tuple;
- the eleven-definition catalog, 34-field profile, seven-source/nine-kind
  manifest, and M0 reuse;
- the kernel-normalization/M3B-disclosure split;
- atomic source-open unions, sequence/generation rules, vector cuts, causal
  validation, no-loss overflow recovery, and canonical batch semantics;
- ledger/checkpoint/compaction authority and the no-M2-V1-widening rule;
- every source-specific hostile-data exclusion;
- lifecycle, device loss, cleanup, static fallback, and M3B handoff;
- exact parity of 22 gates and 48 zero-skip cases.

Passing this plan review authorizes M3A implementation only. It does not
authorize M3B projection/application, M3C topology activation, Code Matter, Storylets,
Genesis, public/remote state, or multiplayer.

## See also

- [M3 Living City Runtime](m3-living-city-runtime.md)
- [M3B Disclosure and Dynamic Projection](m3b-disclosure-projection.md)
- [M2 Runtime Foundation](m2-runtime-foundation.md)
- [M2A Runtime Composition](m2a-runtime-composition.md)
- [Architecture and ownership](architecture.md)
- [Contract catalog](contracts.md)
- [Playground clean-room foundations](playground-clean-room-foundations.md)
- [Security and privacy](security-privacy.md)
- [Implementation roadmap](implementation-roadmap.md)
- [Certification plan](certification-plan.md)
