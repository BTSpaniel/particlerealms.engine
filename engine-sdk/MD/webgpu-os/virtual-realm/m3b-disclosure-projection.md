---
title: Virtual Realm M3B Disclosure and Dynamic Projection
description: Executable implementation blueprint for owner-private disclosure, deterministic shared projection, immutable full-bundle construction, durable selector publication, protected roots, and recovery.
audience: Virtual Realm developers, WebGPU OS integrators, Engine and ECS developers, security reviewers, and QA engineers
updated: 2026-09-03
status: executable implementation blueprint; implementation requires accepted integrated M2 and accepted implemented M3A; no M3B runtime is claimed
---

# Virtual Realm M3B Disclosure and Dynamic Projection

M3B converts already admitted M3A observation batches into the living semantic
state of the owner-private local city. It performs pure disclosure, dispatches
each included observation to one declared domain owner, compiles immutable
`RealmDeltaV1` records, reduces a complete candidate DynamicStore snapshot, and
builds a self-contained root, full ECS overlay, and semantic-only State-First
source into one immutable bundle selected by one trusted durable CAS.

M3B does not scan the computer, render a frame, create geography, grant an
action, or connect another Cityform. M3A owns safe local observation admission.
M2 owns the active private bake/static baseline, accepted codecs/barriers,
State-First presentation adapter, renderer, cameras, and device recovery. The
separate M3 projection-transaction capability owns only the immutable selected
dynamic bundle and durable selector. M3C owns topology
change and full reprojection. M3D owns Code Matter. M5 and M6 own SecureMesh
presence and inter-Cityform roads.

This page is the normative M3B implementation plan. It is deliberately exact,
modular, and unnested. Directories group files; they do not create parent-child
runtime ownership. No production M3B module or acceptance test exists yet.

## Acceptance boundary

Planning may proceed now. Implementation may start only after all of these
preconditions are true:

1. Integrated M2A through M2H is implemented and accepted.
2. The M2.1B ECS structural barrier, safe handles, complete world codec, strict
   schedule, and fail-fast authoritative tick behavior are accepted.
3. The M2C stable presentation-slot mapping and exact Engine/State-First adapter
   are accepted.
4. M3A is implemented and all 22 `VR-M3A-*` gates plus exactly 48
   `M3A-OBS-*` cases pass with zero skips.
5. The active private bake, spatial-layout receipt, static-store snapshot,
   projection-binding index, runtime profile, publication/admission heads,
   visible commit, active-bake CSE output, and current device state verify under
   one selection fence.
6. The frozen M0-M1C 109-definition catalog and all accepted M1 and M2 evidence
   remain byte-identical.
7. M3B-00's separate projection-transaction profile, full-bundle codecs,
   lease-neutral target-set compiler, root-store-scoped nonexpiring artifact
   lease, durable selector/journal/readback, and fail-closed mirror are
   implemented and independently accepted without widening M2 V1.

M2 and M3A are currently blueprints rather than accepted runtime foundations.
This page therefore authorizes no M3B code, allocation, registration, or
runtime claim by itself. (Sources:
`MD/webgpu-os/virtual-realm/m2-runtime-foundation.md`;
`MD/engine/virtual-realm-m2-engine-foundation.md`;
`MD/webgpu-os/virtual-realm/m3a-observation-ingress.md`.)

## Continuity and upstream evidence provenance

The RF-GE2 through RF-GE5 result summaries carried into this blueprint were
reported from the earlier Codex task
[RealmForge integration ledger](codex://threads/01a03ae7-26f8-7ad0-a598-6b547b6fb0b9).
That task identifier is a provenance pointer, not a normative contract, gate
receipt, implementation dependency, or source of runtime authority. Task prose,
screenshots, completion state, and cached summaries cannot accept a gate. Every
carried result must remain independently reproducible from the checked-in
contracts, canonical vectors, test pages, Python oracles, bundle closure, and
immutable acceptance receipts named by the applicable RealmForge plan.

This documentation baseline, anchored by the canonical
[Genesis Ecology program continuity ledger](../../concepts/genesis-ecology.md#program-continuity-ledger),
is the continuation point for the remaining Virtual Realm and RealmForge
planning work. The tracks stay deliberately separate: RF-GE work may
advance inert authoring, compilation, verification, and reviewed-world-kit
evidence, while only the corresponding separately implemented and accepted
Virtual Realm milestones may admit, project, activate, or render it. Continuing
the RealmForge roadmap therefore cannot bypass M2, M3A, M3B-00, or any later
runtime gate.

## Explicit exclusions

M3B does not implement or receive:

- raw filesystem, storage, process, IPC, syscall, permission, action-result, or
  network manager state;
- source adapters, source subscriptions, listeners, callback payloads, rings,
  normalization preimages, pseudonym keys, ledger append authority, source ACK
  authority, or M3A checkpoint-write authority;
- M2 activation, visible-pointer, bake publication, topology, collision,
  navigation, HLOD, static-ID, or RealmForge execution authority;
- renderer, GPU device, queue, buffer, texture, command encoder, frame callback,
  camera, input, audio, or spatial-resource handles;
- Code Matter bytes, glyphs, leases, tokens, vault state, or `code` deltas;
- Storylet scheduling, action dispatch, Genesis execution, Factory execution,
  semantic promotion, public shell, refinement, remote presence, Travelers,
  stations, bridges, or multiplayer;
- the ability to treat an RF-GE2 Plan, RF-GE3 candidate, RF-GE4 artifact,
  RF-GE5 evidence program/trust-pack result, cache hit, or authored receipt as
  executed or authoritative world state;
- a second active DynamicStore, ECS world, State-First bridge, M2 continuation
  port, projection registry, or projection-root authority.

M3B can animate only already admitted anchors and shipped presentation
descriptors. A structural observation can mark an existing object stale or emit
powerless M3C review evidence. It cannot create or move world geometry.

## Locked M3B outcome

An accepted M3B slice proves all of the following together:

1. Every M3A observation is either included byte for byte or omitted with one
   closed reason. M3B never emits a redacted variant under the same identity.
2. Every included observation has exactly one primary projector outcome from
   its manifest owner.
3. The eight primary projectors exhaustively own the nine admitted M3A kinds.
4. The historical witness owns no observation kind and cannot reinterpret an
   observation or influence current state.
5. One M3A batch creates exactly one M3B projection batch, including a legal
   zero-delta batch.
6. Delta identity and ordering are independent of wall time, frame timing,
   worker completion, callback order, map insertion order, and renderer order.
7. A complete candidate DynamicStore snapshot, full ECS overlay, flat semantic
   State-First source, applied cursor, protected closure, deterministic lease-
   target set, lineage, and lease-neutral projection root freeze first. Trusted
   prepare then acquires the exact nonexpiring service lease and binds it with
   those frozen bytes into one immutable selected bundle; one durable selector
   CAS makes that whole bundle current or none of it.
8. An ambiguous post-dispatch result enters reconciliation. It is never retried
   blindly.
9. Device or process-local mirror failure hides dynamic presentation while M2
   static remains visible until exact recovery, replay, catch-up, and durable
   selector reconciliation. Bounded M3A CPU admission may continue.
10. Disabling or failing M3B leaves the complete accepted M2 static city usable.

## Truth and authority boundary

M3B is authoritative only for one narrow statement: an exact projection root
is the current owner-private derived-state root for an exact M2/M3A binding.
It is not authoritative for the underlying operating-system fact, action,
permission, topology, public appearance, or render result.

The truth planes remain separate:

| Plane | Owner | What M3B may claim |
| --- | --- | --- |
| OS source truth | Existing WebGPU OS authorities | Only that M3A admitted exact safe-normalized observation bytes |
| M3A ledger truth | M3A ledger and checkpoint owners | Only referenced batch, cursor, append, recovery, and checkpoint evidence |
| Static spatial truth | Accepted M2 bake, layout, static store, and projection-binding index | Only exact read-only binding to existing anchors and shipped descriptors |
| Dynamic projection truth | M3B projection root store | The exact current self-contained derived bundle, bounded lineage accumulator, and floor anchor |
| ECS simulation state | Separate M3 projection-transaction capability over accepted M2 codecs | Only the full committed M3B stable-ID overlay and resulting bundle generation |
| Presentation source | M2 State-First adapter | A read-only source snapshot; never a decision or authority |
| Renderer output | M2 renderer and frame coordinator | No M3B truth claim; a frame may lag or fail and be rebuilt |
| Action authority | WebGPU OS action authority | No M3B claim; success needs a verified authority record and matching terminal observation |

The Engine observer projection remains explicitly non-truth. CSE staging
patterns may protect the derived projection-root transaction, but they do not
turn a Realm projection into canonical OS truth. (Sources:
`engine/state/observer/Projection.js`; `engine/state/commit/CommitGate.js`;
`webgpu-os/kernel/execution/SemanticTransaction.js`.)

## Why M3B is a separate composition version

M2 freezes an exact 15-key application dependency object. M3A freezes an exact
two-key composition object. M3B does not widen either object and does not hand
the app M2's continuation port a second time.

`VirtualRealmM3BProjectionEntry` accepts exactly three own, enumerable,
immutable data properties:

```text
realmObservationBatchReaderPort@1
realmProjectionContextPort@1
realmProjectionCommitPort@1
```

The object has a null prototype, no symbols, no accessors, no inherited keys,
and no extras. The trusted WebGPU OS composition root creates all three ports.
Before any M3B child, read lease, candidate, timer, or diagnostic allocation,
the entry verifies each immutable descriptor byte for byte against the separate
code-shipped descriptor expected for that port. The three descriptors are not
identical because their port names and method sets differ. Only their
`RealmProjectionRuntimeBindingV1` ID/digest pairs must be mutually byte-
identical.

Every `descriptor()` result is one exact `RealmProjectionPortDescriptorV1` with
this ten-field schema:

```text
format
version
portName
portVersion
bindingContractVersion
runtimeBindingId
runtimeBindingDigest
methodRows
maximumRequestBytes
descriptorDigest
```

`format` is `particle-realms.m3b-projection-port-descriptor` and `version` is
`1`. Each method row has exactly five fields: `methodOrder`, `methodId`,
`resultKindIds`, `resultDomainId`, and `rowDigest`. Rows are in the literal
orders below. Each result list is a closed literal list, and each domain is
`particle-realms.m3b-port-result/<portName>/<methodId>@1`.

The remaining descriptor values are exact:

| Dependency key | `portName` | `portVersion` | `bindingContractVersion` | `maximumRequestBytes` |
| --- | --- | ---: | ---: | ---: |
| `realmObservationBatchReaderPort@1` | `realmObservationBatchReaderPort` | 1 | 1 | 65,536 |
| `realmProjectionContextPort@1` | `realmProjectionContextPort` | 1 | 1 | 33,554,432 |
| `realmProjectionCommitPort@1` | `realmProjectionCommitPort` | 1 | 1 | 536,870,912 |

Each `rowDigest` uses
`particle-realms.m3b-projection-port-method-row@1` over that row's first four
fields in listed order. `descriptorDigest` uses
`particle-realms.m3b-projection-port-descriptor@1` over the first nine
descriptor fields, including the complete ordered rows. These service ABI
ceilings are not additional fields in the 57-field runtime profile. Request-byte
accounting uses the exact data-only request projection defined below.

| Port | Exact method order and closed result-kind lists |
| --- | --- |
| `realmObservationBatchReaderPort@1` | `descriptor:[port-descriptor]`; `captureNext:[ready,source-state-ready,idle,gap,stale-binding,unavailable,closed,invalid]`; `reassert:[current,changed,unavailable,retired,invalid,closed]`; `close:[closed,already-closed]` |
| `realmProjectionContextPort@1` | `descriptor:[port-descriptor]`; `openSession:[opened,stale,unavailable,rejected]`; `capture:[ready,transition,stale,unavailable,rejected,closed]`; `resolveStatic:[ready,missing,stale,unavailable,invalid,closed]`; `resolveAuthorityEvidence:[ready,missing,stale,unavailable,invalid,closed]`; `reassert:[current,changed,unavailable,retired,invalid,closed]`; `waitForWake:[batch-available,source-state-changed,authority-state-changed,authority-expiry-due,expiry-due,artifact-lease-changed,presentation-changed,binding-changed,timeout,invalid,closed]`; `recordDiagnostic:[accepted,aggregated,dropped,closed]`; `beginStop:[stopping,already-stopping,stale,unavailable,invalid,closed]`; `closeSession:[closed,already-closed,blocked,unavailable,invalid]`; `close:[closed,already-closed,blocked]` |
| `realmProjectionCommitPort@1` | `descriptor:[port-descriptor]`; `readPriorState:[empty,current,stale,unavailable,invalid,closed]`; `prepare:[prepared,conflict,stale-binding,invalid,unavailable,aborted-before-dispatch,closed]`; `commit:[committed,conflict,stale-binding,invalid,unavailable,aborted-before-dispatch,recovery-pending,closed]`; `reconcile:[committed,proven-not-committed,conflict,recovery-pending,invalid,closed]`; `recover:[restored,replayed,resumed,committed,proven-not-committed,conflict,fallback,recovery-pending,rejected,unavailable,invalid,closed]`; `detachSources:[detached,already-detached,stale,recovery-pending,unavailable,invalid,closed]`; `release:[released,blocked,already-released,invalid,closed]`; `close:[closed,already-closed,blocked]` |

The context session then returns the complete canonical binding bytes, which
recompute to the common pair, before either other port may be used.

This three-port boundary prevents a multi-read selection race:

- the reader is a restricted projection of the current M3A batch service;
- the context port owns the independent extension session, one selection-fenced
  M2/M3A/static lookup, bounded static and authority evidence resolution,
  presentation fencing, wake scheduling, and redacted diagnostics;
- the commit port owns protected prior-state reads, candidate persistence,
  off-active bundle preparation, the one durable current-bundle selector CAS,
  reconciliation, retention, detach, and release;
- the app receives no raw M2 continuation, store, ECS, Engine, CSE, renderer,
  checkpoint, or activation object.

## `realmObservationBatchReaderPort@1`

The reader port is a bounded, prebound M3A child facet. It has this exact
surface:

```text
descriptor()
captureNext(request)
reassert(request)
close()
```

`captureNext()` accepts exactly:

```text
sessionReceiptId
sessionReceiptDigest
runtimeBindingId
runtimeBindingDigest
afterBatchSequence
lastAppliedSourceStateSnapshotId
lastAppliedSourceStateSnapshotDigest
maximumRecords
maximumBytes
maximumWaitLogicalTicks
workSignal
```

The last-applied source-state pair is absent together only before the first M3B
root and is required together thereafter. It lets the trusted reader distinguish
a changed state/tick snapshot from a true idle result without asking the app to
interpret an under-evidenced response.

The result is exactly one of:

| Result | Exact content and rule |
| --- | --- |
| `ready` | Status; runtime and M3A binding pairs; one canonical `RealmObservationBatchV1` byte sequence; its complete ordered safe-normalized observation byte sequences; current append/head receipt pairs plus the verified append `issuedLogicalTick`; one batch-associated 13-field source-state snapshot; one exact M3A retention-state value; one bounded candidate evidence-escrow manifest containing every canonical evidence byte required by the cut; canonical read-call receipt bytes and pair; no partial or raw record |
| `source-state-ready` | Status; prebound binding pair; next expected batch sequence; one changed 13-field source-state snapshot; one exact M3A retention-state value; one bounded candidate evidence-escrow manifest containing every checkpoint/recovery/acquisition/tick byte required by that snapshot; canonical read-call receipt bytes and pair; no batch or observation record bytes |
| `idle` | Status; prebound binding pair, exact M3A retention-state value, next expected batch sequence, and the byte-identical last-applied source-state snapshot; no escrow, read-call receipt, batch, record, or M3B artifact |
| `gap` | Status; binding pair; requested/next expected/earliest retained sequences; one current source-state snapshot and exact M3A retention-state value; exact M3A recovery receipt references; bounded safe reason; no partial records |
| `stale-binding` | Status; prebound binding pair and bounded reason only |
| `unavailable` | Status and bounded reason only |
| `closed` | Status only |
| `invalid` | Status and bounded validation reason only |

`ready` returns exactly one batch. The port never combines two batches, seeks
behind the retained floor, rewrites bytes, or exposes an ACK.
`source-state-ready` is returned only when the complete source-state snapshot
pair differs from the last-applied pair. `idle` proves byte identity and creates
no cut or escrow. `maximumWaitLogicalTicks` can only reduce the code-shipped
ceiling; the wait is wake-only and never supplies identity time.

The code-shipped V1 ceiling is the literal positive safe integer `4096` for
both reader `captureNext.maximumWaitLogicalTicks` and context
`waitForWake.maximumWaitLogicalTicks`. A request may supply only an integer in
`[1, 4096]`. The counter is a service-private wait-budget counter: it may cause
only `idle` or `timeout`, is reset for each call, is never copied into a cut,
receipt, root, retry identity, logical tick, or diagnostic count, and cannot
advance M3A time. The two owning modules export the byte-identical literal as
`REALM_PROJECTION_MAXIMUM_WAIT_LOGICAL_TICKS_V1`; a different value is a port-
descriptor vector failure even though the constant is not an added descriptor
or 57-field profile key.

Every `ready`, `source-state-ready`, or `idle` result carries one exact port-
local `RealmProjectionM3ARetentionStateV1` value with 11 fields:

```text
format
version
retentionStateId
m3aBindingReceiptId
m3aBindingDigest
ledgerHeadBinding
ledgerHeadDigest
retainedFloorVector
retainedFloorDigest
nextExpectedBatchSequence
retentionStateDigest
```

The value is selection-fenced and byte-identical to the M3A owner's current
retained head/floor projection. A gap result carries the same value only when it
can be verified; otherwise it returns `unavailable`. It grants no checkpoint,
compaction, ACK, or recovery authority.

Before `ready` or `source-state-ready` returns, the trusted reader copies the
exact current M3A binding, ingress profile, source manifest, and every required
batch, record, append/head, source-state, retention-state, checkpoint/recovery,
tick-authority, and normalization evidence byte into one
bounded service-owned candidate evidence escrow. It returns the complete
canonical escrow-manifest bytes so the app can reproduce the exact protected
closure and root it proposes. The service-internal manifest has a closed
15-field vocabulary and is named
`RealmProjectionReaderEvidenceEscrowManifestV1`:

```text
format
version
escrowManifestId
runtimeBindingId
runtimeBindingDigest
readKind
observationBatchId
observationBatchDigest
sourceStateSnapshotId
sourceStateSnapshotDigest
retentionStateId
retentionStateDigest
evidenceRows
disposition
escrowManifestDigest
```

`format` is `particle-realms.m3b-reader-evidence-escrow-manifest`, `version` is
`1`, and `readKind` is `observation-batch` or `source-state`; the batch pair is present
only for the first. `disposition` is `candidate-unadopted`. Each evidence row has
exactly eight fields: `evidenceOrder`, `evidenceKind`, `evidenceId`,
`evidenceDigest`, `sourceAuthority`, `canonicalBytes`, `canonicalByteCount`, and
`rowDigest`. Rows are complete, code-point ordered by kind/ID/digest, unique,
and capped by the protected-closure count/byte ceilings. IDs/digests recompute
from the embedded bytes under their original owner contract. `evidenceKind`,
`sourceAuthority`, resolver, producer predicate, and bytes rule must equal one
reader-escrow carrier rule in the pinned reference-domain registry; no free-form
authority string is accepted.

The service-internal `RealmProjectionReadCallReceiptV1` binds that exact
manifest. Its closed 18-field vocabulary is `format`, `version`,
`readCallReceiptId`, the runtime-binding pair, the
conditionally present batch pair, the source-state snapshot pair, the
retention-state pair, the escrow-manifest pair, `recordCount`,
`evidenceObjectCount`, `canonicalByteCount`, `disposition`, and `receiptDigest`;
`format` is `particle-realms.m3b-projection-read-call-receipt`, `version` is `1`,
and `disposition` is only `escrowed`. The observation-batch variant has all 18
keys; the source-state variant has 16 and omits only the batch pair. Reader
results carry the canonical receipt bytes plus their ID/digest, allowing the app
and trusted prepare to reproduce the same closure without privileged lookup.
Copying preserves the original M3A owner, ID, digest, and canonical bytes and
performs no M3A write, ACK, checkpoint, or retention decision. Trusted prepare
independently verifies and reads back the same service escrow, then adopts its
bytes into the selected root store on commit. Abort/close releases only
unadopted escrows; a committed root never depends on the M3A owner retaining the
original byte allocation.

The port-local `RealmProjectionSourceStateSnapshotV1` has exactly 13 fields:

```text
format
version
sourceStateSnapshotId
runtimeBindingId
runtimeBindingDigest
sourceCursorSlots
stateEvidenceKinds
stateEvidenceIds
stateEvidenceDigests
tickAuthorityEvidenceId
tickAuthorityEvidenceDigest
logicalTick
sourceStateSnapshotDigest
```

Its format is `particle-realms.m3b-projection-source-state-snapshot` and version
is `1`.

`sourceCursorSlots` is a byte-identical projection of M3A's seven exact
11-field checkpoint slots, including the `accepted` versus `absent` presence
matrix. The three evidence arrays are equal-length, nonempty, and ordered by
the closed kind order below and then by ID; duplicate kind/ID pairs and a
same-kind/same-ID digest conflict fail. Each position resolves through exactly
one row of this map, and unlisted kinds, formats, versions, owners,
dispositions, or phase combinations fail before the snapshot ID is computed:

| `stateEvidenceKinds` literal | Exact resolved schema and format | Required owner and producer state | Exact source-state carrier rule | Tick field |
| --- | --- | --- | --- | --- |
| `particle-realms.realm-observation-ingress-checkpoint@1` | `RealmObservationIngressCheckpointV1`; `particle-realms.realm-observation-ingress-checkpoint@1` | `realm-observation-checkpoint-owner@1`; exact current committed checkpoint | `bytesRule = pair-only`; carrier-specific `not-carried-but-resolver-must-prove` for that exact owner; `requiredResolverKind = m3b-source-state-evidence-escrow-resolver@1` | `committedLogicalTick` |
| `particle-realms.realm-observation-ingress-recovery-receipt@1#initial-acquisition` | `RealmObservationIngressRecoveryReceiptV1`; `particle-realms.realm-observation-ingress-recovery-receipt@1` | `realm-observation-recovery@1`; `receiptPhase = initial-acquisition`, `durableStatus = terminal-durable` | `bytesRule = pair-only`; carrier-specific `not-carried-but-resolver-must-prove` for that exact owner; `requiredResolverKind = m3b-source-state-evidence-escrow-resolver@1` | `completedLogicalTick` |
| `particle-realms.realm-observation-ledger-append-receipt@1` | `RealmObservationLedgerAppendReceiptV1`; `particle-realms.realm-observation-ledger-append-receipt@1` | `realm-observation-ledger@1`; `disposition = committed`, `durableStatus = committed-durable` | `bytesRule = pair-only`; carrier-specific `not-carried-but-resolver-must-prove` for that exact owner; `requiredResolverKind = m3b-source-state-evidence-escrow-resolver@1` | `issuedLogicalTick` |
| `particle-realms.realm-observation-ingress-recovery-receipt@1#recovery` | `RealmObservationIngressRecoveryReceiptV1`; `particle-realms.realm-observation-ingress-recovery-receipt@1` | `realm-observation-recovery@1`; `receiptPhase = recovery` and the exact durable status required by its disposition | `bytesRule = pair-only`; carrier-specific `not-carried-but-resolver-must-prove` for that exact owner; `requiredResolverKind = m3b-source-state-evidence-escrow-resolver@1` | `completedLogicalTick` |

The `#recovery` row expands only through this closed imported M3A relation; it
is never encoded as one wildcard status condition:

| Recovery disposition(s) | Exact `durableStatus` |
| --- | --- |
| `gap-detected`, `overflow-detected`, `source-changed`, `source-unavailable` | `detection-durable` |
| `snapshot-opened`, `resume-opened` | `opening-durable` |
| `recovered` | `recovered-durable` |
| `quarantined`, `abandoned` | `terminal-durable` |

The literal order displayed above is the frozen evidence-kind order. A terminal
acquisition is represented only by the `#initial-acquisition` domain; source
retirement is represented only by the `#recovery` domain whose exact `source-unavailable`
variant has `availabilityClass = retired`, or by an `initial-acquisition`
terminal receipt when the source was already retired at acquisition. No
invented terminal-acquisition or retirement schema exists. The referenced
canonical bytes must recompute their intrinsic ID/digest under the mapped M3A
contract and must be present in the matching reader escrow.

Exactly one listed position equals the tick-authority pair. For a batch-
associated snapshot its kind is the ledger-append domain and its verified
`issuedLogicalTick` equals `logicalTick`. For a changed idle snapshot it is the
listed checkpoint or recovery-phase domain record with greatest
mapped tick, ties resolved by the frozen kind order then ID; its mapped tick
must equal `logicalTick`. Context time, wake time, retry time, and authority-
local time can never be the source-state tick authority. A batch-associated
snapshot is the state sealed at that batch cut,
not state observed later when a consumer happens to read it. Reissuing the same
retained batch therefore returns the same source snapshot and tick.

`reassert()` accepts the session and binding pairs, `readKind`, the batch pair
only for `observation-batch`, the source-state, retention-state, escrow-manifest,
and read-call receipt pairs. It returns `current`, `changed`, `unavailable`,
`retired`, `invalid`, or `closed`. Expiry cuts reassert the
`source-state` read together with their separately issued due receipt. A
non-current result invalidates all uncommitted work derived from that read.
`close()` returns
`closed` or `already-closed` with the same immutable binding-bound close-receipt
ID/digest and zero in-flight/callback counts after all calls settle. The reader cannot
append, checkpoint, compact, recover, acknowledge, enumerate, or mutate M3A. It
releases only candidate escrows not adopted by a committed/quarantine/root-store
owner.

## `realmProjectionContextPort@1`

The context port owns currentness and bounded static resolution. It has this
exact surface:

```text
descriptor()
openSession(request)
capture(request)
resolveStatic(request)
resolveAuthorityEvidence(request)
reassert(request)
waitForWake(request)
recordDiagnostic(request)
beginStop(request)
closeSession(request)
close()
```

`openSession()` accepts the three descriptor digests and one caller cancellation
signal. It atomically claims one independent M3B extension child, creates
object-identical service-owned work and teardown roots, and returns `opened`,
`stale`, `unavailable`, or `rejected`. `opened` contains only the session
receipt pair, extension-child ID/generation, the complete canonical 53-field
runtime binding, the current presentation fence, `predecessorTransitionState`,
and conditionally one complete predecessor binding-transition receipt.
`predecessorTransitionState` is `none` for the first binding or a same-binding
restart and `retired` for a successor binding. `retired` requires the exact
receipt bytes; `none` forbids them. A successor cannot return `opened` while its
predecessor remains active, draining, or unproven. No work root, teardown root,
owner handle, or manager crosses the port.

`capture()` accepts the session and runtime-binding pairs plus a work signal.
Its result is `ready`, `transition`, `stale`, `unavailable`, `rejected`, or
`closed`.

`ready` contains exactly:

- one immutable `RealmProjectionRuntimeBindingV1`;
- one current ephemeral presentation fence;
- canonical bytes for a sanitized head descriptor whose state is `empty` or
  `present`;
- canonical bytes for bounded static-lookup limits and no static-store handle.

The service-internal `RealmProjectionHeadDescriptorV1` has this exact closed
16-field vocabulary:

```text
format
version
headState
projectionRootId
projectionRootDigest
projectionRootGeneration
appliedCursorId
appliedCursorDigest
dynamicStoreGeneration
ecsSourceGeneration
stateFirstSourceGeneration
selectedBundleId
selectedBundleDigest
projectionBundleGeneration
selectorGeneration
headDescriptorDigest
```

`empty` has ten own keys, omits the projection-root, applied-cursor, and
selected-bundle pairs, and requires every generation to be zero. `present` has
all 16 keys, requires every pair, and binds exact positive root/bundle/selector
generations; content generations may remain zero only under their existing
byte-identical-result rules. Its format is
`particle-realms.m3b-projection-head-descriptor` and version is `1`.
`headDescriptorDigest` uses
`particle-realms.m3b-projection-head-descriptor@1` over every present preceding
field in the displayed 16-field order. The canonical encoder preserves field
names and declared order, so the ten-key `empty` and 16-key `present` variants
cannot collide through omission.

An empty head is accompanied by one exact service-local
`RealmProjectionM2StaticBaselineDescriptorV1` with this closed 20-field
vocabulary:

```text
format
version
m2StaticBaselineDescriptorId
realmId
runtimeBindingId
runtimeBindingDigest
m2RuntimeBundleId
m2RuntimeCapabilityProfileId
m2RuntimeCapabilityProfileDigest
activeBakeId
activeBakeRevision
activeBakeOutputRecordDigest
spatialLayoutReceiptId
spatialLayoutReceiptDigest
staticStoreSnapshotId
staticStoreSnapshotDigest
projectionBindingIndexId
projectionBindingIndexDigest
disposition
m2StaticBaselineDescriptorDigest
```

Its format is `particle-realms.m3b-m2-static-baseline-descriptor`, version is
`1`, and `disposition` is only `verified-static-baseline`. Every field after the
Realm is copied from and verified against the same accepted M2/runtime-binding
selection fence used by the empty head. Its ID is the domain-separated identity
of that binding and complete M2 baseline tuple:
`m2StaticBaselineDescriptorId` uses
`particle-realms.m3b-m2-static-baseline-descriptor-id@1` over, in order,
`realmId`, the runtime-binding pair, `m2RuntimeBundleId`, the M2 runtime-
capability-profile pair, the active-bake triple, the spatial-layout pair, the
static-store pair, the projection-binding-index pair, and `disposition`.
`m2StaticBaselineDescriptorDigest` uses
`particle-realms.m3b-m2-static-baseline-descriptor@1` over the first 19 fields
in listed order, including the recomputed ID. The descriptor carries no store key, object handle,
renderer resource, mutable collection, or M2 write authority. Failure to issue
the complete canonical bytes makes the empty read `unavailable` with only
`m2-static-baseline-unavailable`; absence never authorizes a fabricated baseline.

The commit service uses one closed service-internal
`RealmProjectionPriorStateBundleV1` for a `complete-base` current-head read. It
has exactly 16 fields:

```text
format
version
priorStateBundleId
realmId
runtimeBindingId
runtimeBindingDigest
headDescriptorBytes
activeProjectionBundleBytes
projectionRootBytes
protectedClosureManifestBytes
protectedClosureObjectBytes
staticArtifactLeaseReceiptBytes
rootStoreGeneration
embeddedObjectCount
embeddedCanonicalByteCount
priorStateBundleDigest
```

Its format is `particle-realms.m3b-projection-prior-state-bundle` and version
is `1`. It exists only for a `present` head. `headDescriptorBytes` encodes the
exact 16-key present descriptor; its root, cursor, selected-bundle, content-
generation, bundle-generation, and selector-generation values equal the
embedded exact 27-field `ActiveProjectionBundleV1` and exact 37-field
projection root. `protectedClosureManifestBytes` is that root's complete
internal protected-closure manifest. `protectedClosureObjectBytes` is one flat
canonical byte sequence per manifest entry in `entryOrder`, with no omission,
alias, duplicate, or extra object. It therefore carries the applied cursor,
complete DynamicStore snapshot and entries, complete stable-ID ECS overlay
result, complete State-First semantic-source snapshot, all seven source slots,
and every bound M3A, disclosure, recorded-authority, static, outcome, and floor
object required by that root. `staticArtifactLeaseReceiptBytes` is the exact
covering nonexpiring service-only lease receipt bound by the selected bundle
and covering the root's exact lease-target set.

`rootStoreGeneration` is positive and is the one generation under which the
selector, bundle, root, closure manifest, every closure byte sequence, and
lease receipt were protected and read. `embeddedObjectCount` is exactly five
plus the length of `protectedClosureObjectBytes`: head descriptor, active
bundle, root, manifest, lease receipt, then one object per manifest entry.
`embeddedCanonicalByteCount` is the exact sum of those canonical byte
sequences. Physical content-addressed sharing never lowers either value.
`priorStateBundleId` uses
`particle-realms.m3b-projection-prior-state-bundle-id@1` over, in order,
`realmId`, the runtime-binding pair, the embedded head-descriptor digest, the
embedded active-bundle pair, the embedded projection-root pair, the embedded
closure-manifest pair, the embedded static-artifact-lease-receipt pair,
`rootStoreGeneration`, `embeddedObjectCount`, and
`embeddedCanonicalByteCount`. Every extracted pair/digest must recompute from
the corresponding byte field before the ID is derived.
`priorStateBundleDigest` uses
`particle-realms.m3b-projection-prior-state-bundle@1` over the first 15 fields
in listed order, including the recomputed ID and all embedded byte arrays. The bundle contains no
store key, iterator, map, live handle, component array, callback, function, or
mutable object.

Every successful prior-state read emits one exact service-internal
`RealmProjectionHeadReadReceiptV1` with this closed 22-field vocabulary:

```text
format
version
headReadReceiptId
realmId
runtimeBindingId
runtimeBindingDigest
canonicalRequestDigest
mode
headState
headDescriptorDigest
priorStateBundleId
priorStateBundleDigest
m2StaticBaselineDescriptorId
m2StaticBaselineDescriptorDigest
candidateLineageFloorAnchorId
candidateLineageFloorAnchorDigest
selectorGeneration
rootStoreGeneration
resolvedObjectCount
resolvedCanonicalByteCount
disposition
receiptDigest
```

Its format is `particle-realms.m3b-projection-head-read-receipt`, version is
`1`, `mode` is `descriptor` or `complete-base`, `headState` is `empty` or
`present`, `disposition` is only `read`, and `headDescriptorDigest` recomputes
from the returned or embedded descriptor bytes. The exact own-key matrix is:

| Head and mode | Exact own keys | Required conditional pairs | Forbidden conditional pairs |
| --- | ---: | --- | --- |
| `empty`, either mode | 20 | M2 static-baseline descriptor; candidate lineage-floor anchor | prior-state bundle |
| `present`, `descriptor` | 16 | none | prior-state bundle; M2 static-baseline descriptor; candidate lineage-floor anchor |
| `present`, `complete-base` | 20 | prior-state bundle; candidate lineage-floor anchor | M2 static-baseline descriptor |

An empty receipt uses selector/root-store generation zero. A present receipt
uses the exact positive selector and root-store generations read under one
protected selector/root-store fence. `canonicalRequestDigest` covers, in exact
request-key order, the session-receipt pair, runtime-binding pair, `mode`,
`maximumEntries`, and `maximumBytes`; it excludes the `workSignal`. The receipt
`headReadReceiptId` uses
`particle-realms.m3b-projection-head-read-receipt-id@1` over every present field
from `realmId` through `disposition` in the displayed order; canonical field
names and the closed own-key matrix make the preimage presence-safe.
`receiptDigest` uses
`particle-realms.m3b-projection-head-read-receipt@1` over every present
preceding field in the displayed 22-field order, including the recomputed ID.
Neither identity contains a self-reference.

For an empty result, `resolvedObjectCount` is exactly three and
`resolvedCanonicalByteCount` is the exact sum of the returned empty head
descriptor, verified M2 static-baseline descriptor, and candidate floor-anchor
bytes. For a present descriptor result they are exactly one and the canonical
length of the returned head descriptor. For a present complete-base result,
the count is `embeddedObjectCount + 2` and the byte charge is exactly
`canonicalLength(priorStateBundleBytes) + canonicalLength(candidateLineageFloorAnchorBytes)`.
`embeddedCanonicalByteCount` is an independently recomputed internal subtotal;
because every embedded sequence already occurs inside the canonical outer
bundle, it is never added to that bundle's transport length a second time. The
receipt and service result envelope are excluded from their own bounded
accounting.

Object accounting is by declared canonical wire position, not by unique content
address. When the candidate floor anchor is byte-identical to the current anchor
already present once in `protectedClosureObjectBytes`, that manifest position
and the separately returned field are deliberately counted as two object
positions. Byte accounting likewise includes its bytes once inside the outer
bundle and once as the separate field, but never adds the embedded subtotal over
the outer bundle. Physical deduplication or shared backing storage cannot reduce
the logical count or transport-byte charge.

The code-shipped commit-capability profile derives
`maximumCurrentStateReadEntries = maximumProtectedClosureEntries + 7 = 262151`
because the largest complete-base result contains five fixed embedded objects,
one object per protected-closure entry, the outer prior-state bundle, and the
separate candidate floor-anchor position. It also derives
`maximumCompleteBaseNonClosureBytes = maximumCurrentStateReadBytes - maximumProtectedClosureBytes = 201326592`. For a complete-base read,
`completeBaseNonClosureByteCount` is exactly
`resolvedCanonicalByteCount - protectedClosureManifest.canonicalByteCount` and
must be in `0..201326592`. Consequently the exact maximum protected closure of
335544320 bytes plus the exact maximum non-closure transport of 201326592 bytes
equals, but never exceeds, the unchanged 536870912-byte current-state read
ceiling. Both derived values are bound by the existing
`projectionCommitCapabilityProfileId`/digest pair and add no profile field.
`maximumEntries` must be positive and at most 262151. Every declared position is
counted exactly once, every internal subtotal must recompute, and entry 262152,
byte 536870913, any omission, extra charge, or other mismatch rejects the whole
result before exposure.

The service-internal `RealmProjectionStaticLookupLimitsV1` has exactly five
fields: `format`, `version`, `maximumRecords`, `maximumBytes`, and
`limitsDigest`. Its two values equal the current profile's static-resolution
ceilings and cannot be widened by a later request. Its format is
`particle-realms.m3b-static-lookup-limits` and version is `1`.

`transition` contains one exact binding-transition descriptor defined in the
lifecycle section. The descriptor is the only predecessor selector/root input
accepted by `detachSources()`; a reason string alone can never retire a binding.

The service-internal `RealmProjectionPresentationFenceV1` has a closed 14-field
vocabulary:

```text
format
version
presentationFenceId
runtimeBindingId
runtimeBindingDigest
presentationState
presentationGeneration
currentAuthorityStateSnapshotId
currentAuthorityStateSnapshotDigest
deviceRecoveryReceiptId
deviceRecoveryReceiptDigest
catchUpReceiptId
catchUpReceiptDigest
presentationFenceDigest
```

`presentationState` is `ready`, `device-lost`, `recovering`, `unavailable`, or
`closed`.
The current-authority snapshot pair is always present. The exact own-key matrix
is: initial `ready`, `device-lost`, and `unavailable` have ten keys and omit both
recovery pairs; `recovering` has 12 keys and requires only the accepted device-
recovery pair; post-loss `ready` has all 14 keys and requires both the device-
recovery and completed catch-up pairs; terminal `closed` has ten keys, omits
both recovery pairs, preserves the last verified current-authority snapshot
pair, and increments `presentationGeneration` exactly once under the extension-
owner stop fence. Repeated stop returns the byte-identical closed fence. No other
presence combination is legal. Every non-ready state closes dynamic
presentation, and `closed` can never return to another state for that binding.
The fence
is a commit and presentation precondition, never part of logical binding,
delta, store, cursor, root, or replay identity. Device loss therefore closes
presentation without minting a new logical binding or invalidating the last CPU
root. A current authority-head change immediately changes the fence and forces
the presentation/action adapter to meet every gate to locked or unavailable
until a newly resolved current-authority snapshot is reasserted. A stale durable
root can therefore never keep a live gate visually or interactively open.

`transition`, `stale`, `unavailable`, and `rejected` contain only status, a
closed bounded reason, and the current binding pair when safe. No result exposes
an owner manager, selection fence, runtime pin, store, index, callback, or live
resource.

`resolveStatic()` accepts exactly the current binding pair, a sorted unique list
of observation subject IDs, the declared maximum item/byte counts, and a work
signal. It returns `ready`,
`missing`, `stale`, `unavailable`, `invalid`, or `closed`.

`ready` returns only complete verified M0 `RealmProjectionBindingV1` records and
shipped descriptor/resource references resolved through the exact
`projectionBindingIndexId`/digest, static-store snapshot, layout receipt, active
bake, and current selection. It preserves catalog bytes and never synthesizes a
fallback anchor. `missing` identifies only the requested opaque IDs that lack a
binding. Missing bindings can produce zero output or powerless structural
evidence; they cannot fall back to `anchor:root` or another nearby object.

The resolver returns the complete authorized projection-binding and allowed-
anchor closure for those subjects. The projector applies the embedded recipe's
total selection rule: filesystem binds `payload.objectId`; every other kind
binds `observation.subjectId`; one candidate must satisfy every required role,
and its selected anchor must be both role-bound and present in that binding's
`sourceAnchorIds`. Zero fully matching candidates suppress the slot, exactly one
selects, and more than one rejects the batch. The caller cannot supply or probe
an anchor ID before resolution. Unknown subjects appear only in the bounded
`missingSubjectIds` result. Every `ready` or `missing`, including an exact empty `ready`, carries one
immutable static-resolution receipt as canonical bytes plus its pair, ordered
record IDs/digests, counts, and bytes. `ready` pairs only with receipt
`disposition = complete` and an empty missing set; `missing` pairs only with
`disposition = partial-missing` and a nonempty missing set. The receipt bytes are
the noncyclic proof over the request subject set, selection fence, returned
closure rows, and aggregate counts; trusted prepare recomputes them rather than
resolving a hidden object.

The result carries one `recordRows` array rather than untyped parallel record
arrays. Each row has exactly seven fields: `recordOrder`, `recordKind`,
`recordId`, `recordDigest`, `canonicalBytes`, `canonicalByteCount`, and
`rowDigest`. `recordKind` is one exact `static-resolution`-admitted domain key
from the heterogeneous-carrier registry below. Rows are dense and sorted by
`(recordKind, recordId, recordDigest)` using code-point order. The intrinsic
format/version/ID/digest in `canonicalBytes`, the current M2 selection, owner,
resolver, byte count, and row digest must all match the chosen registry row.
`complete` and `partial-missing` return only verified present rows; missing
subjects occur only in `missingSubjectIds` and never fabricate a row.

The service-internal `RealmProjectionStaticResolutionReceiptV1` has exactly 24
fields in this order:

```text
format
version
staticResolutionReceiptId
runtimeBindingId
runtimeBindingDigest
subjectResolutionRows
subjectResolutionCount
subjectResolutionByteCount
requestedSubjectIdsDigest
missingSubjectIdsDigest
activeBakeId
activeBakeRevision
activeBakeOutputRecordDigest
spatialLayoutReceiptId
spatialLayoutReceiptDigest
staticStoreSnapshotId
staticStoreSnapshotDigest
projectionBindingIndexId
projectionBindingIndexDigest
resolvedRowsDigest
recordCount
canonicalByteCount
disposition
receiptDigest
```

`format` is
`particle-realms.m3b-static-resolution-receipt`, `version` is `1`, and
`disposition` is `complete` or `partial-missing`. A complete result binds the
code-shipped empty-list digest for missing subjects; a missing result binds the
exact returned `missingSubjectIds` digest. The receipt contains no anchor probe,
store key, selection handle, or live resolver.

Each `subjectResolutionRows` member has exactly seven fields:

```text
subjectOrder
subjectId
resolutionDisposition
projectionBindingIds
projectionBindingDigests
allowedAnchorIds
rowDigest
```

Rows are dense over the complete code-point-sorted unique request IDs. Every
requested subject has exactly one row. `resolutionDisposition` is `resolved` or
`missing`. A resolved row requires nonempty equal-length, pair-indexed,
code-point-sorted unique binding arrays; every pair resolves to one returned
`recordRows` projection-binding row, and `allowedAnchorIds` is the exact code-
point-sorted unique union of those records' `sourceAnchorIds`. A missing row
requires all three arrays empty. Every returned projection-binding row is named
by at least one resolved subject row. A row digest uses
`particle-realms.m3b-static-subject-resolution-row@1` over its first six fields.

`subjectResolutionCount` equals the row length and
`subjectResolutionByteCount` is the sum of the complete seven-field row bytes.
`requestedSubjectIdsDigest` is
`particle-realms.m3b-static-resolution-requested-subject-ids@1` over the exact
projection of all row subject IDs followed by the count;
`missingSubjectIdsDigest` uses
`particle-realms.m3b-static-resolution-missing-subject-ids@1` over only the
missing-row subject IDs followed by their count. Receipt `recordCount` remains
`recordRows.length`, and receipt `canonicalByteCount` remains the sum of the
embedded canonical-object byte counts in those static record rows. The port result's `recordCount`
equals `subjectResolutionCount + recordCount`; its `canonicalByteCount` equals
`subjectResolutionByteCount + canonicalByteCount`. Those result totals must
remain within the requested maximums, and the work plan's
`staticResolutionRecordCount` equals the same summed record count. This meters
negative evidence and makes both complete and partial results independently
reconstructible without a live resolver.

`resolveAuthorityEvidence()` accepts exactly the session/binding pair,
`resolutionMode`, conditionally present verified M3A observation-batch and
batch-associated source-state pairs, one exact bounded `authorityQueryRows`
array, the expected presentation-fence and current-authority-snapshot pairs,
maximum records/bytes, and a work signal. Each query row has exactly seven
fields:

```text
queryOrder
observationOrdinal
observationId
observationDigest
authorityReceiptId
authorityReferenceFieldPath
rowDigest
```

`queryOrder` is dense zero-based order after filtering the verified batch in
its canonical observation order. There is exactly one row for every
structurally valid `permission` or `action-result` observation and none for any
other kind. `authorityReferenceFieldPath` is exactly
`payload.authorityReceiptRef` for `permission` or
`payload.authorityReceiptId` for `action-result`; `authorityReceiptId` must
byte-equal the value at that path. The observation triple, receipt ID, and field
path are copied from or selected entirely by the observation's accepted kind
and canonical bytes. The resolver alone resolves that ID to exact immutable
receipt bytes and its recomputed external digest; that digest first appears in
the eight-field input-cut authority-evidence row. A free digest, substituted
field path, missing ID, duplicate observation ordinal, reordered row, or query
for an observation outside the bound batch is invalid. One receipt ID may
legitimately be named by more than one observation, so receipt uniqueness is
not inferred.
`rowDigest` uses `particle-realms.m3b-authority-query-row@1` over the first six
fields. The hash-only `authorityQueryRowsDigest` uses
`particle-realms.m3b-authority-query-rows@1` over the complete ordered
seven-field rows followed by their exact count. It is not another request key.

`resolutionMode = recorded-batch` requires the batch/source pairs and rows.
`resolutionMode = current-only` forbids them and is legal only after an
`authority-state-changed` wake, initial session capture, or device-recovery
recapture. The snapshot pair is available from the fence, so the first call is
not dependent on the authority-head pair hidden inside unresolved bytes.
Resolution runs
before an observation input cut is frozen, so it never accepts or creates a
circular input-cut reference. Its result is `ready`, `missing`, `stale`,
`unavailable`, `invalid`, or `closed`. `ready` returns only the canonical
immutable `RealmActionAuthorityReceiptV1` bytes and ID/digest matched to recorded
rows, the recorded-time signature/trust/epoch validation state, one complete
recorded-authority evidence-escrow manifest, one exact current-authority
snapshot, counts/bytes, and one authority-resolution receipt pair. The recorded
manifest uses the same exact eight-field embedded-byte row schema as the reader
escrow and includes every authority receipt, signature envelope, trust-root
record, and correlation receipt needed by the closure. The resolution receipt
binds that manifest pair and trusted prepare adopts it exactly like reader
escrow. It returns no token, key, private rule graph, capability object,
dispatcher, or authority method.

The service-internal `RealmProjectionRecordedAuthorityEscrowManifestV1` has a
closed 15-field vocabulary:

```text
format
version
escrowManifestId
runtimeBindingId
runtimeBindingDigest
observationBatchId
observationBatchDigest
sourceStateSnapshotId
sourceStateSnapshotDigest
resolutionRowsDigest
evidenceRows
evidenceCount
canonicalByteCount
disposition
escrowManifestDigest
```

`format` is `particle-realms.m3b-recorded-authority-escrow-manifest`, `version`
is `1`, and `disposition` is `candidate-unadopted`. `resolutionRowsDigest` binds
the exact ordered eight-field authority-evidence rows later placed in the input
cut. The embedded evidence rows are the same closed eight-field canonical-byte
rows as reader escrow, but the two manifest formats and ownership domains are
distinct and cannot replay as one another.

The service-internal `RealmProjectionAuthorityResolutionReceiptV1` has this
exact closed 21-field maximum vocabulary:

```text
format
version
authorityResolutionReceiptId
runtimeBindingId
runtimeBindingDigest
resolutionMode
observationBatchId
observationBatchDigest
sourceStateSnapshotId
sourceStateSnapshotDigest
authorityQueryRowsDigest
resolutionRowsDigest
missingAuthorityReceiptIdsDigest
recordedAuthorityEscrowManifestId
recordedAuthorityEscrowManifestDigest
currentAuthorityStateSnapshotId
currentAuthorityStateSnapshotDigest
recordCount
canonicalByteCount
disposition
receiptDigest
```

`format` is `particle-realms.m3b-authority-resolution-receipt` and `version` is
`1`.
`recorded-batch` has exactly 19 own keys, requires the batch/source/escrow
pairs plus both query/missing-set digests, forbids the current-authority pair,
and uses `disposition = resolved` or `partial-missing`; only `resolved` can
enter an input cut. Its `authorityQueryRowsDigest` equals the request-derived
value. `missingAuthorityReceiptIds` in a `missing` result is the code-point-
sorted unique projection of every queried `authorityReceiptId` for which the
resolver could not return the complete verified recorded chain. Its digest uses
`particle-realms.m3b-missing-authority-receipt-ids@1` over the complete array
followed by its length. `resolved` requires the code-shipped digest of `[]` and
zero; `partial-missing` requires the exact nonempty returned array digest. No
stale, invalid, signature-failed, or mismatched-chain row is laundered into this
missing set: those conditions return their closed non-missing failure status.
The ordered resolved evidence rows are exactly the query rows whose receipt IDs
are absent from that missing set, preserving query order. Each evidence row
renames `queryOrder` to the equal `evidenceOrder`, copies the observation triple
and receipt ID, replaces the query's field-path proof with the resolver's
recomputed receipt digest, then adds `recordedValidationDisposition` and
`rowDigest`. A field path never enters the evidence row, while a resolver digest
never appears in the query row.
`current-only` has exactly 13 own keys, requires the current-authority pair,
forbids the batch/source/escrow pairs and both query/missing-set digests, uses
only `disposition = resolved`, and binds
`resolutionRowsDigest` to the snapshot's exact live-grant rows. That digest uses
the distinct `particle-realms.m3b-current-authority-resolution-rows@1` domain
over the complete ordered ten-field `liveGrantRows`, followed by
`liveGrantCount`. It never reuses the recorded-batch eight-field aggregate
domain. Current-only resolution never returns `missing`: a complete fail-closed `unavailable`
snapshot is a valid `ready` result, while failure to issue that complete value
returns `unavailable`. Thus durable recorded authority never absorbs ephemeral
current authority, while both modes return canonical receipt bytes that the
caller can independently recompute.

The port-local `RealmCurrentAuthorityStateSnapshotV1` has a closed 13-field
vocabulary:

```text
format
version
authorityStateSnapshotId
runtimeBindingId
runtimeBindingDigest
snapshotState
authorityHeadReceiptId
authorityHeadReceiptDigest
authorityGeneration
liveGrantRows
liveGrantCount
canonicalByteCount
authorityStateSnapshotDigest
```

`snapshotState` is `resolved` or `unavailable`. `resolved` has all 13 keys and
requires the verified authority-head pair. `unavailable` has 11 keys, omits that
pair, carries the service's current monotonic authority generation, and requires
an empty row array/count while closing every dependent gate. The fence always
references one of these service-issued values; no caller fabricates an empty
success.

Each live-grant row has exactly ten fields: `rowOrder`, `gateSemanticKey`,
`authorityReceiptId`, `authorityReceiptDigest`, `capabilityEpoch`, `grantState`,
`expiryTick`, `transitionReceiptId`, `transitionReceiptDigest`, and `rowDigest`.
Rows are code-point sorted by `(gateSemanticKey, authorityReceiptId)`, unique,
and capped by `maximumDynamicEntries`; the complete current snapshot including
rows is capped by `maximumCurrentStateReadBytes`. Candidate verification rejects
a root with more distinct reachable gate-authority dependencies than that same
row ceiling, so restart and device recovery can always request a complete
snapshot. The per-cut recorded evidence remains separately capped by
`maximumAuthorityEvidenceRecordsPerCut` and
`maximumAuthorityEvidenceBytesPerCut`. `grantState` is exactly `granted`, `denied`,
`expired`, `revoked`, `unknown`, or `unavailable`. The head receipt proves the
current durable authority generation and complete row set. The snapshot is a
read-only live fail-close projection: it is never a capability, never rewrites
recorded history, and never enters durable M3B root identity.

Current-only resolution must cover every authority dependency reachable from
the selected root. A missing, extra, over-limit, unavailable, mismatched-epoch,
or unresolved row closes the affected gate and cannot be treated as an empty
success. The authority owner atomically invalidates/advances the presentation
fence before it publishes a revocation, capability-epoch transition, grant-state
change, or authority-expiry wake. The trusted adapter computes only a
conjunctive mask over the immutable recorded gate: it may preserve or downgrade
to locked/disabled/unavailable, never open a gate, mint a grant, or mutate root,
DynamicStore, ECS, or State-First bytes.

The service derives the next authority-expiry tick as the least positive expiry
in the complete resolved rows. `waitForWake()` rejects a different caller value,
and the authority-fence service invalidates the old fence at that boundary even
if the app never waits or is stopped.

The service-internal `RealmProjectionBindingTransitionDescriptorV1` has this
exact closed 21-field vocabulary:

```text
format
version
transitionDescriptorId
realmId
priorRuntimeBindingId
priorRuntimeBindingDigest
successorRuntimeBindingId
successorRuntimeBindingDigest
transitionReason
priorHeadState
priorProjectionRootId
priorProjectionRootDigest
priorProjectionBundleId
priorProjectionBundleDigest
priorSelectorGeneration
priorPresentationFenceId
priorPresentationFenceDigest
selectionHeadReceiptId
selectionHeadReceiptDigest
transitionGeneration
descriptorDigest
```

Its format is `particle-realms.m3b-projection-binding-transition-descriptor` and
version is `1`.
`priorHeadState = empty` has 17 own keys, omits both root/bundle pairs, and
requires selector generation zero plus an exact empty-head receipt. `present`
has all 21 keys and requires both pairs plus a positive matching selector
generation. Context capture authors it under one selection fence; the app can
only pass the bytes back to the commit port.

A completed result is correlated against whether the receipt was valid for the
recorded decision/dispatch/result chain. Delayed projection does not rewrite
that history because a receipt later expired or was revoked. Current gate
presentation separately meets the latest permission observation, source-health
overlay, capability epoch, expiry boundary, and live-grant state; historical
completion never implies a current grant.

`reassert()` accepts the session/binding pair, presentation-fence pair,
current-authority snapshot pair, and the exact read/static/recorded-authority/
head receipt pairs used by a candidate. It returns `current`, `changed`,
`unavailable`, `retired`, `invalid`, or `closed`.

`waitForWake()` accepts only the session/binding pair, next expected batch
sequence, current source-state snapshot pair, current-authority snapshot pair,
conditionally present next dynamic expiry tick and authority-expiry tick, a
bounded logical wait, and a work
  signal. It returns `batch-available`, `source-state-changed`,
  `authority-state-changed`, `authority-expiry-due`, `expiry-due`, `presentation-changed`,
  `artifact-lease-changed`, `binding-changed`, `timeout`, `invalid`, or `closed`. An authority wake invalidates the
presentation fence before notifying the app; the trusted presentation/action
join fails closed even if the app is delayed, stopped, or out of memory. Every
wake is only a hint: the entry must recapture/reassert all evidence, and neither
wall time nor wake order enters durable identity.

Every non-timeout, non-expiry wake carries canonical bytes for one service-
internal `RealmProjectionWakeEvidenceV1` with a closed 19-field vocabulary:
`format`, `version`, `wakeEvidenceId`, the runtime-binding pair, `wakeKind`,
conditional `nextBatchSequence`, the conditional source-state-snapshot pair,
the conditional current-authority-snapshot pair, the conditional presentation-
fence pair, the conditional artifact-lease-state-receipt pair, the conditional
binding-transition-descriptor pair, conditional `logicalTick`, and
`evidenceDigest`. Its format is `particle-realms.m3b-projection-wake-evidence`
and version is `1`; `wakeKind` equals the result status.

The binding-transition-descriptor pair uses the exact field names
`bindingTransitionDescriptorId` and `bindingTransitionDescriptorDigest`; no
generic transition alias is accepted. The exact variants are: batch-available requires only its sequence; source-state-
changed requires the source pair and M3A-owned logical tick; authority-state-
changed and authority-expiry-due require the new current-authority pair, already
invalidated presentation-fence pair, and service logical tick; presentation-
changed requires the fence pair; artifact-lease-changed requires its state-
receipt pair; and binding-changed requires both the transition-descriptor and
closed-fence pairs. Every other conditional field is forbidden. Timeout has no
wake evidence. Expiry-due uses only the stronger receipt below.

`recordDiagnostic()` accepts only a fixed code, bounded integer counts, and
fixed elapsed/work buckets and returns `accepted`, `aggregated`, `dropped`, or
`closed`.

`expiry-due` additionally returns one service-internal
`RealmProjectionExpiryDueReceiptV1` with exactly 16 fields:

```text
format
version
expiryDueReceiptId
runtimeBindingId
runtimeBindingDigest
priorSourceStateSnapshotId
priorSourceStateSnapshotDigest
currentSourceStateSnapshotId
currentSourceStateSnapshotDigest
tickAuthorityEvidenceId
tickAuthorityEvidenceDigest
priorEffectiveLogicalTick
expiryBoundaryTick
currentLogicalTick
disposition
receiptDigest
```

`disposition` is only `due`. The receipt resolves the current source snapshot's
M3A-owned durable tick-authority bytes, requires `currentLogicalTick` to equal
that snapshot tick, and proves the least finite retained-entry expiry strictly
above the prior frontier is at or below that tick. A wall clock, timer callback,
wake order, retry, or frame can never issue the receipt. If source slots changed,
the `source-state` cut takes precedence and applies every newly due fail-closed
meet; an `expiry` cut is legal only when the seven slot bytes are unchanged and
the durable tick evidence alone advanced.

`beginStop()` accepts the session/binding pair, a closed `stopReason`, the
conditionally present binding-transition descriptor pair, and the still-current
caller work signal. Under the extension owner's resource-ledger fence it rejects
new work, captures and closes the current presentation fence, freezes the exact
`before-stop` resource-snapshot bytes, and returns
`stopping` or byte-identical `already-stopping` with one stop-receipt pair and
the canonical stop-receipt, stop-fence, and snapshot bytes. The service-internal
`RealmProjectionStopReceiptV1` has a closed 16-field vocabulary: `format`,
`version`, `stopReceiptId`, the runtime-binding pair, `extensionChildId`,
`extensionChildGeneration`, `stopReason`, the conditionally present binding-
transition-descriptor pair, the captured presentation-fence pair, the before-
snapshot pair, `disposition`, and `receiptDigest`. Ordinary stop has 14 own keys
and forbids the transition pair; binding retirement has all 16. `format` is
`particle-realms.m3b-projection-stop-receipt`, `version` is `1`, and
`disposition` is only `stopping`. `stale`, `unavailable`, or `invalid` is reason-
only; `closed` is empty.
Every reader/commit settlement after that point is charged against this frozen
inventory, so an app cannot omit a private service resource from disposal.

`closeSession()` accepts the session/binding pair plus the stop, reader-close,
commit-close, detach, and every conditionally issued transfer/transition receipt
pair. It settles wake/resolution calls, releases the independent extension child
and its service-owned roots, freezes the exact `after-transfer` resource
snapshot, verifies both snapshots against the shared resource ledger, and
returns `closed` or `already-closed` with byte-identical binding-bound context-
close and extension-release pairs, after-snapshot bytes, exact before-snapshot
bytes, and exact terminal disposal-receipt bytes/
pair, and zero resource/callback/in-flight
counts. If any resource is not settled or ownership is not durably transferable,
it returns nonterminal `blocked`; malformed evidence returns `invalid`, and an
unreadable owner returns `unavailable`. Those reason-only results issue no close,
release, after-snapshot, or disposal evidence. `close()` revokes only an already
closed port facet and idempotently returns that same terminal context-close pair;
called earlier it returns reason-only `blocked`. It cannot release the child or
issue a disposal receipt a second time.

There is no digest cycle: the context-close and extension-release receipts bind
the stop receipt, verified settlements, and both resource-snapshot pairs but
omit the later disposal pair. The service then computes the disposal receipt
from those already frozen bytes, and the method result envelope binds all three
receipts together.

## `realmProjectionCommitPort@1`

The commit port is the only M3B seam that may alter current derived state. It
has this exact surface:

```text
descriptor()
readPriorState(request)
prepare(request)
commit(request)
reconcile(request)
recover(request)
detachSources(request)
release(request)
close()
```

`readPriorState()` accepts the session/binding pair, `mode = descriptor` or
`complete-base`, exact count/byte ceilings, and a work signal. It returns
`empty`, `current`, `stale`, `unavailable`, `invalid`, or `closed`.
For a current head, `descriptor` returns exact canonical
`RealmProjectionHeadDescriptorV1` bytes plus canonical head-read receipt bytes
and their pair.
`complete-base` returns exact bounded immutable
`RealmProjectionPriorStateBundleV1` bytes, the separately root-store-authored
candidate lineage-floor anchor for the next transaction, and its head-read
receipt bytes plus pair. The bundle contains the complete selected bundle and root, applied
cursor, full DynamicStore snapshot/entry closure, full stable-ID ECS overlay
result, State-First semantic-source snapshot, seven source slots, protected
evidence closure, and covering M2 artifact-lease receipt. `empty`, in either
mode, proves there is no M3B head and returns exactly the canonical empty head
descriptor, verified M2 static-baseline descriptor, root-store-authored
candidate lineage-floor anchor, and canonical head-read receipt bytes plus pair needed by the
genesis reducer; no fake root or cursor is minted.

The trusted service captures selector generation, root-store generation, bundle,
root, closure, lease, and candidate floor anchor under one protected read fence,
then reasserts the selector and both generations before emitting the receipt.
Any torn read, missing byte sequence, noncovering lease, digest mismatch,
generation change, count/byte overflow, or noncanonical object returns a closed
failure result and no partial bytes. No result exposes a map, store key, ECS
handle, component array, source bridge, selection primitive, or live object.

`prepare()` accepts canonical bytes for one application intent and every
referenced candidate artifact. The trusted service replays the shared
import-inert disclosure/projector/maintenance/reducer/planner kernel over the
root-owned canonical copies of M3A/authority evidence and the resolved static
evidence; recomputes the complete protected closure and its deterministic M2
lease-target request; acquires the root-scoped service-only M2 artifact lease;
builds and validates the complete successor projection bundle off-active;
persists its operation-journal phase and content; reads it back; reasserts all
fences; and returns one of:

```text
prepared
conflict
stale-binding
invalid
unavailable
aborted-before-dispatch
closed
```

`prepared` contains only a branded data-only prepare ID/digest, intent pair,
candidate-root pair, exact binding pair, presentation-fence pair, static-artifact
lease receipt pair, candidate bundle ID/digest/generation, and logical expiry
tick. It contains no store key, capability token, CSE handle, ECS object, or
function. The root-store-scoped artifact lease is nonexpiring until its exact
release/transfer protocol completes, so `logicalExpiryTick` is exactly `0`;
prepare rejects a finite or caller-renewable lease.

Ordinary work requires an unchanged `ready` fence. During device recovery,
prepare also accepts an unchanged `recovering` fence only when it binds an
accepted device-recovery receipt and the cut is part of the contiguous same-
binding CPU catch-up. Such a prepare may advance the durable CPU selector but
cannot open presentation or issue a ready fence. `device-lost` and `unavailable`
fences are always rejected.

`commit()` accepts only that prepare pair and the original intent pair. The
trusted service reasserts current selection and presentation, enters the M3
projection-transaction selection/structural/frame fence, and performs exactly
one durable expected-selector-generation CAS from the old complete bundle ID to
the new complete bundle ID. That durable selector transaction is the sole
logical linearization point. DynamicStore, complete ECS overlay, State-First
semantic source, cursor, and root are members of the one bundle; they are never
sequentially written into active state. A process-local in-memory pointer may
mirror the durable selector only after readback and is never authoritative. It
returns:

```text
committed
conflict
stale-binding
invalid
unavailable
aborted-before-dispatch
recovery-pending
closed
```

Before durable `dispatch-started`, only `stale-binding`, `invalid`, `unavailable`,
`aborted-before-dispatch`, or facet-level `closed` can be returned and no
selector changes. After that phase, only `committed`, `conflict`, or
`recovery-pending` is legal. Only
`committed` contains a committed root and selector-CAS receipt. `conflict`
contains a verified competing root and selector receipt. Any result that cannot
be proven after dispatch is `recovery-pending`. A recognized, structurally valid
intent always receives `RealmProjectionApplicationReceiptV1` bytes even when
semantic verification returns pre-dispatch `invalid`; only failure before intent
admission uses the reason-only `invalid` port payload. `closed` is the empty
facet-level result and never fabricates an application receipt.

`reconcile()` accepts only the intent ID/digest and candidate-root ID/digest. A
completed reconciliation returns `committed`, `proven-not-committed`,
`conflict`, or `recovery-pending` after protected journal, selector, root, store,
ECS, and source readback. If the service cannot complete that readback, no new
terminal receipt is minted and the durable state remains `recovery-pending`.
Every prepared/dispatch-started/selected/terminal-readback phase and application
CAS-attempt value is durable across restart. That value is one through three and
advances only after terminal `proven-not-committed`; pending readback leaves it
unchanged and uses the separate recovery counter. A binding with an unresolved
dispatch admits no later commit. Only
`proven-not-committed` permits a bounded retry with the same intent and
idempotency bytes.

`recover()` is the only three-port path that can issue
`RealmProjectionRecoveryReceiptV1`. It accepts exactly the session/binding pair,
one closed `recoveryKind`, the kind-required root/cursor/application/head/floor/
fence/device/source/current-authority evidence pairs, exact count/byte ceilings,
and a work signal. It returns `restored`, `replayed`, `resumed`, `committed`,
`proven-not-committed`, `conflict`, `fallback`, `recovery-pending`, `rejected`,
`unavailable`, `invalid`, or `closed`. A recognized admitted request always
returns exact recovery-receipt bytes. Pre-admission `unavailable` covers only a
failed aggregate journal reservation or unavailable trusted evidence service;
pre-admission `invalid` covers structural validation failure. Both are reason-
only, append no journal row, and `closed` is empty.

For `device-resume`, the app first processes the complete retained M3A tail and
every due maintenance meet through prepare/commit calls carrying the unchanged
`recovering` fence. `recover()` then independently reads current M3A retention
state and the durable selector, resolves current authority, verifies final root/
cursor/source/expiry state, and calls the trusted fence service for one closed-
to-ready CAS. `resumed` returns the recovery, catch-up, selector-read,
presentation-gate-transition, and new ready presentation-fence bytes. Any
intervening head, floor, selector, source, authority, device, lease, binding, or
fence change returns a non-success state while presentation remains closed.
Other recovery kinds return only the exact recovery receipt required by their
closed variant.

`release()` releases a non-current candidate root only after closure,
lineage-floor, optional M3A-edge, root-store ownership, M2-artifact-lease, and
successor checks and returns `released`, `blocked`, or `already-released`. A
selected or retained root's lease is owned by the durable root store, not by the
app session; session shutdown preserves that ownership and does not
attempt to release a lease still required by a healthy retained root. A malformed
or cross-binding request returns `invalid`; a revoked facet returns `closed`.

`detachSources()` accepts the session/binding and stop-receipt pairs, expected
current selector and root/bundle generations, the transition descriptor bytes
only for binding retirement, and either the exact stop-captured presentation
fence or a later same-binding closed fence. The stop receipt is fail-close
authority only: it can detach/hide resources but can never present or reactivate
them. A later authority/device fence invalidation therefore strengthens teardown
and never produces `stale` merely because the stop-time fence changed. The
service closes the dynamic presentation gate, persists and reads back the
selector-retirement admitted phase, durably clears the M3B selector through its
own expected-generation retirement transaction and 18-field attempt-record chain,
activates the complete M2 static presentation through the existing M2 owner,
drains the old bundle, detaches its ECS overlay and State-First source, and
returns `detached`, `already-detached`, `stale`,
`recovery-pending`, `unavailable`, `invalid`, or `closed`. Terminal results issue
and store the exact 24-field detach receipt, ECS and State-First detach receipts,
and static-fallback evidence under their prebound owners; the payload returns
only their opaque ID/digest pairs for later trusted resolution. A healthy root
that remains retained also returns only the already issued root-store-current-
to-retained-owner transfer pair. A binding transition additionally issues the
exact 25-field binding-transition receipt from the supplied transition
descriptor and returns only its pair. `already-detached` returns the same byte-
identical pairs. An uncertain result transfers the operation and any still-
attached ECS/State-First resources to the commit-service quarantine owner. It
issues and stores the exact quarantine-owned 24-field detach receipt, explicit
quarantine-transferred ECS/State-First detach receipt variants, verified static-
fallback evidence, and the quarantine receipt; the payload returns only their
opaque pairs, `retainedRootState`, and the reason. The quarantine receipt's exact
ordered operation-evidence row resolves the latest selector-retirement record. The
raw retirement-record pair never crosses this result boundary. The uncertain
result cannot be represented as released. A selector generation changed by an in-
flight operation is reconciled inside this teardown route and becomes detached,
already-detached, or recovery-pending rather than an unrecoverable stale loop.
An application or recovery tail already designated for stop quarantine forces
this same `recovery-pending` all-or-nothing route even if selector retirement
reaches terminal readback; no healthy detach/retained-root/transition receipt is
issued alongside it.
`stale` is reserved for a binding/extension-generation mismatch that cannot
match the stop receipt.

The ECS and State-First detach receipts each have a closed disposition of
`detached`, `already-detached`, or `quarantine-transferred`. The last proves the
named quarantine owner atomically adopted the still-hidden resource and cleanup
obligation; it does not falsely claim physical detachment. The static-fallback
receipt always proves the dynamic gate is closed and complete M2 static
presentation is selected before any of those variants can leave the app
session.

The payload scalar `retainedRootState` is exactly `none`, `retained-owner`,
`quarantine-no-root`, or `quarantine-owned`. `none` forbids both ownership-
transfer pairs; `retained-owner` requires the healthy retained-root-transfer
pair and forbids quarantine; either quarantine state requires the quarantine-
transfer pair and forbids the healthy pair. `quarantine-no-root` means the
admitted detach request proved an empty selector and no trusted final root;
`quarantine-owned` means its present-head request bound the exact selected root,
bundle, and lease now included in the quarantine inventory. Binding-transition
evidence follows its empty/present matrix only for healthy `none` or
`retained-owner` teardown and is forbidden for both quarantine states.

`close()` settles all prepare, commit, reconcile, recover, detach, release, and
read calls, transfers any unresolved operation to the bounded kernel quarantine
owner, releases only proven-safe candidate leases, and returns `closed`,
`already-closed`, or nonterminal `blocked`. Terminal results carry the same
immutable close receipt, candidate-lease-
settlement pair, quiescence counts, and every conditionally issued retained-root,
binding-transition, or quarantine-transfer pair. It returns existing receipts;
close never reissues or changes them. `blocked` is reason-only and is required
when an unresolved resource cannot yet transfer within the quarantine ceilings.

The port has no method to request, insert, rewrite, or release an M3A checkpoint
edge. The M3A checkpoint owner may later include the already defined
`checkpoint-to-projection-root` edge during its own ordinary checkpoint commit.
M3B only registers and serves the root verifier.

## Exact data-only request projections

Every non-descriptor method has one closed request object. It has a null
prototype, exact own-key order, no inherited/accessor/symbol keys, and no
unlisted value. The following table is authoritative where earlier port prose
uses shorthand such as “the session/binding pair.” Fields appear in canonical
order. A listed `workSignal` or `cancellationSignal` is the final own key of the
live request object but is excluded from its data-only canonical projection.
Every `close()` invocation takes no argument and uses the code-shipped canonical
empty-record digest.

| Port method | Exact ordered request own keys |
| --- | --- |
| reader `captureNext` | `sessionReceiptId`, `sessionReceiptDigest`, `runtimeBindingId`, `runtimeBindingDigest`, `afterBatchSequence`, conditional `lastAppliedSourceStateSnapshotId`, conditional `lastAppliedSourceStateSnapshotDigest`, `maximumRecords`, `maximumBytes`, `maximumWaitLogicalTicks`, `workSignal` |
| reader `reassert` | `sessionReceiptId`, `sessionReceiptDigest`, `runtimeBindingId`, `runtimeBindingDigest`, `readKind`, conditional `observationBatchId`, conditional `observationBatchDigest`, `sourceStateSnapshotId`, `sourceStateSnapshotDigest`, `retentionStateId`, `retentionStateDigest`, `escrowManifestId`, `escrowManifestDigest`, `readCallReceiptId`, `readCallReceiptDigest`, conditional `expiryDueReceiptId`, conditional `expiryDueReceiptDigest`, `workSignal` |
| reader `close` | no keys and no argument |
| context `openSession` | `readerDescriptorDigest`, `contextDescriptorDigest`, `commitDescriptorDigest`, `cancellationSignal` |
| context `capture` | `sessionReceiptId`, `sessionReceiptDigest`, `runtimeBindingId`, `runtimeBindingDigest`, `workSignal` |
| context `resolveStatic` | `sessionReceiptId`, `sessionReceiptDigest`, `runtimeBindingId`, `runtimeBindingDigest`, `observationSubjectIds`, `maximumRecords`, `maximumBytes`, `workSignal` |
| context `resolveAuthorityEvidence` | `sessionReceiptId`, `sessionReceiptDigest`, `runtimeBindingId`, `runtimeBindingDigest`, `resolutionMode`, conditional `observationBatchId`, conditional `observationBatchDigest`, conditional `sourceStateSnapshotId`, conditional `sourceStateSnapshotDigest`, conditional `authorityQueryRows`, `presentationFenceId`, `presentationFenceDigest`, `currentAuthorityStateSnapshotId`, `currentAuthorityStateSnapshotDigest`, `maximumRecords`, `maximumBytes`, `workSignal` |
| context `reassert` | `sessionReceiptId`, `sessionReceiptDigest`, `runtimeBindingId`, `runtimeBindingDigest`, `presentationFenceId`, `presentationFenceDigest`, `currentAuthorityStateSnapshotId`, `currentAuthorityStateSnapshotDigest`, `readCallReceiptId`, `readCallReceiptDigest`, `staticResolutionReceiptId`, `staticResolutionReceiptDigest`, conditional `recordedAuthorityResolutionReceiptId`, conditional `recordedAuthorityResolutionReceiptDigest`, `currentAuthorityResolutionReceiptId`, `currentAuthorityResolutionReceiptDigest`, conditional `expiryDueReceiptId`, conditional `expiryDueReceiptDigest`, `headReadReceiptId`, `headReadReceiptDigest`, `workSignal` |
| context `waitForWake` | `sessionReceiptId`, `sessionReceiptDigest`, `runtimeBindingId`, `runtimeBindingDigest`, `nextExpectedBatchSequence`, `sourceStateSnapshotId`, `sourceStateSnapshotDigest`, `currentAuthorityStateSnapshotId`, `currentAuthorityStateSnapshotDigest`, conditional `nextDynamicExpiryTick`, conditional `nextAuthorityExpiryTick`, `maximumWaitLogicalTicks`, `workSignal` |
| context `recordDiagnostic` | `sessionReceiptId`, `sessionReceiptDigest`, `runtimeBindingId`, `runtimeBindingDigest`, `diagnosticCode`, `countRows`, `elapsedBucket`, `workBucket` |
| context `beginStop` | `sessionReceiptId`, `sessionReceiptDigest`, `runtimeBindingId`, `runtimeBindingDigest`, `stopReason`, conditional `bindingTransitionDescriptorBytes`, `workSignal` |
| context `closeSession` | `sessionReceiptId`, `sessionReceiptDigest`, `runtimeBindingId`, `runtimeBindingDigest`, `stopReceiptId`, `stopReceiptDigest`, `readerCloseReceiptId`, `readerCloseReceiptDigest`, `commitCloseReceiptId`, `commitCloseReceiptDigest`, `candidateLeaseSettlementReceiptId`, `candidateLeaseSettlementReceiptDigest`, `detachReceiptId`, `detachReceiptDigest`, `ecsDetachReceiptId`, `ecsDetachReceiptDigest`, `stateFirstDetachReceiptId`, `stateFirstDetachReceiptDigest`, `staticFallbackReceiptId`, `staticFallbackReceiptDigest`, conditional `retainedRootTransferReceiptId`, conditional `retainedRootTransferReceiptDigest`, conditional `bindingTransitionReceiptId`, conditional `bindingTransitionReceiptDigest`, conditional `quarantineTransferReceiptId`, conditional `quarantineTransferReceiptDigest` |
| context `close` | no keys and no argument |
| commit `readPriorState` | `sessionReceiptId`, `sessionReceiptDigest`, `runtimeBindingId`, `runtimeBindingDigest`, `mode`, `maximumEntries`, `maximumBytes`, `workSignal` |
| commit `prepare` | `sessionReceiptId`, `sessionReceiptDigest`, `runtimeBindingId`, `runtimeBindingDigest`, `applicationIntentBytes`, `candidateProjectionRootBytes`, `candidateInternalClosureManifestBytes`, `candidateClosureObjectBytes`, `staticArtifactLeaseTargetSetBytes`, `presentationFenceBytes`, `maximumEntries`, `maximumBytes`, `workSignal` |
| commit `commit` | `sessionReceiptId`, `sessionReceiptDigest`, `runtimeBindingId`, `runtimeBindingDigest`, `prepareId`, `prepareDigest`, `intentId`, `intentDigest`, `workSignal` |
| commit `reconcile` | `sessionReceiptId`, `sessionReceiptDigest`, `runtimeBindingId`, `runtimeBindingDigest`, `intentId`, `intentDigest`, `candidateProjectionRootId`, `candidateProjectionRootDigest`, `maximumBytes`, `workSignal` |
| commit `recover` | `sessionReceiptId`, `sessionReceiptDigest`, `runtimeBindingId`, `runtimeBindingDigest`, `recoveryKind`, conditional `priorProjectionRootId`, conditional `priorProjectionRootDigest`, conditional `currentProjectionRootId`, conditional `currentProjectionRootDigest`, conditional `priorAppliedCursorId`, conditional `priorAppliedCursorDigest`, conditional `currentAppliedCursorId`, conditional `currentAppliedCursorDigest`, conditional `triggerApplicationReceiptId`, conditional `triggerApplicationReceiptDigest`, conditional `retentionStateId`, conditional `retentionStateDigest`, conditional `presentationFenceId`, conditional `presentationFenceDigest`, conditional `deviceRecoveryReceiptId`, conditional `deviceRecoveryReceiptDigest`, conditional `sourceStateSnapshotId`, conditional `sourceStateSnapshotDigest`, conditional `currentAuthorityStateSnapshotId`, conditional `currentAuthorityStateSnapshotDigest`, conditional `expiryDueReceiptId`, conditional `expiryDueReceiptDigest`, `maximumEntries`, `maximumBytes`, `workSignal` |
| commit `detachSources` | `sessionReceiptId`, `sessionReceiptDigest`, `runtimeBindingId`, `runtimeBindingDigest`, `stopReceiptId`, `stopReceiptDigest`, `expectedHeadState`, `expectedSelectorGeneration`, conditional `expectedProjectionRootId`, conditional `expectedProjectionRootDigest`, conditional `expectedProjectionBundleId`, conditional `expectedProjectionBundleDigest`, `expectedProjectionBundleGeneration`, conditional `bindingTransitionDescriptorBytes`, `presentationFenceBytes` |
| commit `release` | `sessionReceiptId`, `sessionReceiptDigest`, `runtimeBindingId`, `runtimeBindingDigest`, `candidateState`, `candidateProjectionRootId`, `candidateProjectionRootDigest`, conditional `staticArtifactLeaseReceiptId`, conditional `staticArtifactLeaseReceiptDigest` |
| commit `close` | no keys and no argument |

Every named “pair” expands in place to its `Id` field immediately followed by
its `Digest` field. The exact conditional matrix is:

- reader first capture omits the last-applied source pair only for verified
  empty-head genesis; later capture requires it;
- reader reassert uses `readKind = observation-batch`, `source-state`, or
  `expiry`; only observation-batch requires its batch pair, only expiry requires
  its due pair, and all three require the source/retention/escrow/read pair set;
- recorded-batch authority requires the batch/source pairs and
  `authorityQueryRows`; current-only forbids all three; the expected fence and
  current-authority pair are always required;
- context reassert requires a recorded-authority-resolution pair only for an
  observation-batch cut and an expiry-due pair only for an expiry cut; its
  current-authority-resolution pair is always required;
- each next-expiry tick is absent when no finite dependency exists and otherwise
  is the exact least positive boundary derived by its owning service;
- both `maximumWaitLogicalTicks` occurrences are integers in `[1, 4096]` and
  obey the shared code-shipped service constant above;
- `countRows` contains exact two-field `countName`, `countValue` rows, sorted by
  code-point `countName`, with no zero, duplicate, free-text, or raw-ID value;
  it has at most 17 rows and every value is a positive safe integer;
- begin-stop and detach carry transition bytes only for a binding retirement;
  ordinary stop forbids them; detach presentation bytes must equal the stop-
  captured fence or a later same-binding closed fence, never a newly ready fence;
- close-session transfer pairs are present exactly when the matching bytes were
  durably issued; candidate settlement and all base close/detach pairs are
  always present, including explicit nonissuance receipts;
- prepare's `candidateClosureObjectBytes` array has exactly one canonical byte
  sequence for each closure entry in `entryOrder`, while the root, manifest,
  lease-target set, and presentation fence are separate and never duplicated in
  that array;
- recover request variants follow the recovery-receipt kind matrix: restore
  requires current root/cursor plus retention; replay requires prior/current
  root/cursor, retention, source, and current authority; uncertain reconciliation
  requires `triggerApplicationReceiptId` and
  `triggerApplicationReceiptDigest` for the original recovery-pending receipt
  and lets the service derive current root/
  cursor by durable readback; device resume requires prior/current root/cursor,
  retention, recovering fence, device receipt, source, and current authority,
  with the due pair iff an expiry boundary is being met; static fallback
  requires the presentation-fence pair and either both prior root/cursor pairs
  or neither;
- detach `expectedHeadState = empty` omits both root/bundle pairs and uses zero
  selector/bundle generations; `present` requires every pair and positive exact
  generations; release requires the lease pair exactly when `candidateState`
  says an unselected candidate lease was issued, and public release forbids
  `candidateState = selected`.

Every recover evidence pair is a content reference, never embedded artifact
bytes. The trusted service resolves it from the root, selector, M3A escrow,
authority-evidence, fence, or receipt owner and recomputes the referenced digest
before admission. The canonical union of resolved objects charges
`maximumCurrentStateReadBytes` once per content-addressed object; a combined
overflow or missing/mismatched object returns pre-admission `unavailable` or
`invalid` without a journal row. Therefore an independently exact-bound snapshot
does not consume the commit descriptor's request-byte budget, and no arbitrary
combination of independent maxima bypasses the aggregate read ceiling. This
unique-reference rule applies to trusted resolution of reference-only request
evidence; the complete-base response instead uses its exact canonical transport-
position accounting above.

All arrays and embedded canonical-byte values count once toward the descriptor's
`maximumRequestBytes`. A conditional field supplied when forbidden, omitted when
required, set to `null`, or moved from its declared position returns that
method's closed reason-only `invalid`, `rejected`, or `dropped` envelope before
allocation. Every caller-declared record/entry/byte/wait
maximum is a positive value no greater than the matching frozen profile/service
ceiling; it may reduce work but can never widen a descriptor or profile limit.

## Exact service ABI result unions

Every non-`descriptor()` port call returns one exact eight-key immutable
`RealmProjectionPortResultV1`: `format`, `version`, `resultId`, `status`, `runtimeBindingId`,
`runtimeBindingDigest`, `payload`, and `resultDigest`. `format` is
`particle-realms.m3b-port-result` and `version` is `1`; `status` is one literal
from that method row's closed `resultKindIds`. `payload` is always a null-
prototype immutable record, including the exact empty record; `null`, an
omitted payload, inherited/accessor/symbol keys, and unlisted keys are invalid.
All earlier statements that a result “contains” a value refer to this payload.
The prebound binding pair is always present in the envelope and cannot reveal
more than the port descriptor already binds.

Before dispatch, the service computes `canonicalRequestDigest` with
`particle-realms.m3b-port-request@1` over, in order, the exact descriptor
`portName`, exact `methodId`, and the canonical field-name/value sequence of the
ordered data-only fields declared for that method. Thus same-shaped requests on
different ports or methods cannot collide. `openSession()` binds the
caller's cancellation signal; every later required caller work signal is
separately checked for object identity with that bound signal while the service-
owned child work/teardown roots remain private. Signals are identity-free
control, are excluded from canonical request bytes, and do not count toward
`maximumRequestBytes`. `resultId` is the existing M0 content ID over the ordered
tuple `(resultDomainId, canonicalRequestDigest, format, version, status, runtimeBindingId, runtimeBindingDigest, payload)`.
`resultDigest` uses `particle-realms.m3b-port-result-envelope@1` over the exact
eight-key envelope with only `resultDigest` omitted and therefore includes
`resultId`. The caller
recomputes both in the original port/method/request context. A reason-only or
empty payload from one method can therefore never replay as another method's
result without changing its ID/digest.

The payload own-key sets are exact:

| Call and status | Exact payload own keys |
| --- | --- |
| reader `captureNext/ready` | `m3aBindingReceiptId`, `m3aBindingDigest`, `observationBatchBytes`, `observationRecordBytes`, `appendReceiptId`, `appendReceiptDigest`, `headReceiptId`, `headReceiptDigest`, `issuedLogicalTick`, `sourceStateSnapshotBytes`, `m3aRetentionStateBytes`, `evidenceEscrowManifestBytes`, `readCallReceiptBytes`, `readCallReceiptId`, `readCallReceiptDigest` |
| reader `captureNext/source-state-ready` | `m3aBindingReceiptId`, `m3aBindingDigest`, `nextExpectedBatchSequence`, `sourceStateSnapshotBytes`, `m3aRetentionStateBytes`, `evidenceEscrowManifestBytes`, `readCallReceiptBytes`, `readCallReceiptId`, `readCallReceiptDigest` |
| reader `captureNext/idle` | `m3aBindingReceiptId`, `m3aBindingDigest`, `nextExpectedBatchSequence`, `sourceStateSnapshotBytes`, `m3aRetentionStateBytes` |
| reader `captureNext/gap` | `requestedSequence`, `nextExpectedBatchSequence`, `earliestRetainedSequence`, `sourceStateSnapshotBytes`, `m3aRetentionStateBytes`, `recoveryReceiptIds`, `recoveryReceiptDigests`, `reasonCode` |
| reader `captureNext/stale-binding`, `unavailable`, or `invalid` | `reasonCode` |
| reader `captureNext/closed` | empty |
| reader `reassert/current` | `reassertReceiptId`, `reassertReceiptDigest` |
| reader `reassert/changed`, `unavailable`, or `retired` | `reassertReceiptId`, `reassertReceiptDigest`, `reasonCode` |
| reader `reassert/invalid` | `reasonCode` |
| reader `reassert/closed` | empty |
| reader `close/closed` or `already-closed` | `closeReceiptId`, `closeReceiptDigest`, `inFlightCount`, `callbackCount` |
| context `openSession/opened`, no predecessor | `sessionReceiptId`, `sessionReceiptDigest`, `extensionChildId`, `extensionChildGeneration`, `runtimeBindingBytes`, `presentationFenceBytes`, `predecessorTransitionState` |
| context `openSession/opened`, retired predecessor | the seven no-predecessor keys plus `predecessorBindingTransitionReceiptBytes` |
| context `openSession/stale`, `unavailable`, or `rejected` | `reasonCode` |
| context `capture/ready` | `runtimeBindingBytes`, `presentationFenceBytes`, `headDescriptorBytes`, `staticLookupLimitsBytes` |
| context `capture/transition` | `transitionDescriptorBytes`, `reasonCode` |
| context `capture/stale`, `unavailable`, or `rejected` | `reasonCode` |
| context `capture/closed` | empty |
| context `resolveStatic/ready` | `staticResolutionReceiptBytes`, `staticResolutionReceiptId`, `staticResolutionReceiptDigest`, `recordRows`, `recordCount`, `canonicalByteCount` |
| context `resolveStatic/missing` | the six `ready` keys plus `missingSubjectIds` |
| context `resolveStatic/stale`, `unavailable`, or `invalid` | `reasonCode` |
| context `resolveStatic/closed` | empty |
| context `resolveAuthorityEvidence/ready`, recorded-batch | `resolutionMode`, `authorityResolutionReceiptBytes`, `authorityEvidenceRows`, `recordedAuthorityEscrowManifestBytes`, `currentAuthorityStateSnapshotBytes`, `authorityResolutionReceiptId`, `authorityResolutionReceiptDigest`, `recordCount`, `canonicalByteCount` |
| context `resolveAuthorityEvidence/ready`, current-only | `resolutionMode`, `authorityResolutionReceiptBytes`, `currentAuthorityStateSnapshotBytes`, `authorityResolutionReceiptId`, `authorityResolutionReceiptDigest`, `recordCount`, `canonicalByteCount` |
| context `resolveAuthorityEvidence/missing`, recorded-batch only | the nine recorded-ready keys plus `missingAuthorityReceiptIds`, `reasonCode` |
| context `resolveAuthorityEvidence/stale`, `unavailable`, or `invalid` | `reasonCode` |
| context `resolveAuthorityEvidence/closed` | empty |
| context `reassert/current` | `reassertReceiptId`, `reassertReceiptDigest` |
| context `reassert/changed`, `unavailable`, or `retired` | `reassertReceiptId`, `reassertReceiptDigest`, `reasonCode` |
| context `reassert/invalid` | `reasonCode` |
| context `reassert/closed` | empty |
| context `waitForWake/batch-available`, `source-state-changed`, `authority-state-changed`, `authority-expiry-due`, `artifact-lease-changed`, `presentation-changed`, or `binding-changed` | `wakeReceiptId`, `wakeReceiptDigest`, `wakeEvidenceBytes` |
| context `waitForWake/expiry-due` | `wakeReceiptId`, `wakeReceiptDigest`, `expiryDueReceiptBytes` |
| context `waitForWake/timeout` | `wakeReceiptId`, `wakeReceiptDigest` |
| context `waitForWake/invalid` | `reasonCode` |
| context `waitForWake/closed` | empty |
| context `recordDiagnostic/accepted` or `aggregated` | `diagnosticReceiptId`, `diagnosticReceiptDigest`, `aggregateCount` |
| context `recordDiagnostic/dropped` | `reasonCode` |
| context `recordDiagnostic/closed` | empty |
| context `beginStop/stopping` or `already-stopping` | `stopReceiptBytes`, `stopReceiptId`, `stopReceiptDigest`, `stopPresentationFenceBytes`, `resourceSnapshotBeforeBytes` |
| context `beginStop/stale`, `unavailable`, or `invalid` | `reasonCode` |
| context `beginStop/closed` | empty |
| context `closeSession/closed` or `already-closed` | `contextCloseReceiptId`, `contextCloseReceiptDigest`, `extensionReleaseReceiptId`, `extensionReleaseReceiptDigest`, `resourceSnapshotBeforeBytes`, `resourceSnapshotAfterBytes`, `disposalReceiptBytes`, `disposalReceiptId`, `disposalReceiptDigest`, `resourceCount`, `callbackCount`, `inFlightCount` |
| context `closeSession/blocked`, `unavailable`, or `invalid` | `reasonCode` |
| context `close/closed` or `already-closed` | `contextCloseReceiptId`, `contextCloseReceiptDigest`, `resourceCount`, `callbackCount`, `inFlightCount` |
| context `close/blocked` | `reasonCode` |
| commit `readPriorState/empty` | `headDescriptorBytes`, `m2StaticBaselineDescriptorBytes`, `candidateLineageFloorAnchorBytes`, `headReadReceiptBytes`, `headReadReceiptId`, `headReadReceiptDigest` |
| commit `readPriorState/current` with descriptor mode | `headDescriptorBytes`, `headReadReceiptBytes`, `headReadReceiptId`, `headReadReceiptDigest` |
| commit `readPriorState/current` with complete-base mode | `priorStateBundleBytes`, `candidateLineageFloorAnchorBytes`, `headReadReceiptBytes`, `headReadReceiptId`, `headReadReceiptDigest` |
| commit `readPriorState/stale`, `unavailable`, or `invalid` | `reasonCode` |
| commit `readPriorState/closed` | empty |
| commit `prepare/prepared` | `prepareId`, `prepareDigest`, `intentId`, `intentDigest`, `candidateProjectionRootId`, `candidateProjectionRootDigest`, `runtimeBindingId`, `runtimeBindingDigest`, `presentationFenceId`, `presentationFenceDigest`, `staticArtifactLeaseReceiptId`, `staticArtifactLeaseReceiptDigest`, `candidateBundleId`, `candidateBundleDigest`, `candidateBundleGeneration`, `logicalExpiryTick` |
| commit `prepare/conflict` | `observedCompetingProjectionRootId`, `observedCompetingProjectionRootDigest`, `reasonCode` |
| commit `prepare/stale-binding`, `invalid`, `unavailable`, or `aborted-before-dispatch` | `reasonCode` |
| commit `prepare/closed` | empty |
| commit `commit/committed`, `conflict`, `stale-binding`, `invalid`, `unavailable`, `aborted-before-dispatch`, or `recovery-pending` for a recognized intent | `applicationReceiptBytes` |
| commit `commit/invalid` before intent admission | `reasonCode` |
| commit `commit/closed` | empty |
| commit `reconcile/committed`, `proven-not-committed`, `conflict`, or `recovery-pending` for a recognized intent | `applicationReceiptBytes` |
| commit `reconcile/invalid` | `reasonCode` |
| commit `reconcile/closed` | empty |
| commit `recover/restored`, `replayed`, `committed`, `proven-not-committed`, `conflict`, `fallback`, `recovery-pending`, or `rejected` | `recoveryReceiptBytes` |
| commit `recover/resumed` | `recoveryReceiptBytes`, `catchUpReceiptBytes`, `selectorReadReceiptBytes`, `presentationGateTransitionReceiptBytes`, `readyPresentationFenceBytes` |
| commit `recover/unavailable` or `invalid` | `reasonCode` |
| commit `recover/closed` | empty |
| commit `detachSources/detached` or `already-detached`, no retained root/transition | `detachReceiptId`, `detachReceiptDigest`, `ecsDetachReceiptId`, `ecsDetachReceiptDigest`, `stateFirstDetachReceiptId`, `stateFirstDetachReceiptDigest`, `staticFallbackReceiptId`, `staticFallbackReceiptDigest`, `retainedRootState` |
| commit `detachSources/detached` or `already-detached`, healthy retained root | the nine base detach keys plus `retainedRootTransferReceiptId`, `retainedRootTransferReceiptDigest` |
| commit `detachSources/detached` or `already-detached`, binding transition | the applicable base/retained-root keys plus `bindingTransitionReceiptId`, `bindingTransitionReceiptDigest` |
| commit `detachSources/recovery-pending` | `detachReceiptId`, `detachReceiptDigest`, `ecsDetachReceiptId`, `ecsDetachReceiptDigest`, `stateFirstDetachReceiptId`, `stateFirstDetachReceiptDigest`, `staticFallbackReceiptId`, `staticFallbackReceiptDigest`, `quarantineTransferReceiptId`, `quarantineTransferReceiptDigest`, `retainedRootState`, `reasonCode` |
| commit `detachSources/stale`, `unavailable`, or `invalid` | `reasonCode` |
| commit `detachSources/closed` | empty |
| commit `release/released` or `already-released` | `candidateLeaseSettlementReceiptId`, `candidateLeaseSettlementReceiptDigest` |
| commit `release/blocked` or `invalid` | `reasonCode` |
| commit `release/closed` | empty |
| commit `close/closed` or `already-closed`, base | `commitCloseReceiptId`, `commitCloseReceiptDigest`, `candidateLeaseSettlementReceiptId`, `candidateLeaseSettlementReceiptDigest`, `resourceCount`, `callbackCount`, `inFlightCount` |
| commit `close/closed` or `already-closed`, conditional additions | add the retained-root-transfer pair iff issued, the binding-transition pair iff issued, and the quarantine-transfer pair iff unresolved ownership transferred |
| commit `close/blocked` | `reasonCode` |

Every named pair is all-or-none. Every listed array pair has equal length and
declared order.

Despite its compatibility-preserved singular name, `observationRecordBytes` is
exactly one immutable array of canonical byte sequences. Its length equals the
verified `observationBatchBytes.observationCount`; position `i` byte-equals the
complete safe-normalized `RealmObservationV1` bytes named by the batch's
position `i` observation pair. Recomputing each intrinsic pair must reproduce
that same batch position. A scalar byte sequence, sparse array, duplicate or
reordered position, separately normalized copy, omitted record, appended
record, or byte-identical record under a different pair rejects the complete
`ready` result. The read-call receipt and reader escrow independently bind the
same ordered record set and total canonical byte count.

### Closed reason domains

Failure reasons are literal ABI, not free-form diagnostics. The following table
is the exhaustive `reasonCode` vocabulary for port result payloads. Each row is
part of the exact `@1` `resultDomainId` named by that method's descriptor row;
the method/status may carry exactly one listed value. A method/status not listed
here forbids `reasonCode`. Changing a value, membership, or mapping requires a
new result-domain version, relevant port descriptor/version, and binding-
contract version. Reusing the existing domain ID with different reason bytes is
a descriptor mismatch even if the ten descriptor field names are unchanged.

| Port method / result kind | Exact allowed `reasonCode` values |
| --- | --- |
| reader `captureNext/gap` | `sequence-gap`, `retention-floor-gap` |
| reader `captureNext/stale-binding` | `runtime-binding-stale` |
| reader `captureNext/unavailable` | `m3a-reader-unavailable`, `retention-evidence-unavailable` |
| reader `captureNext/invalid` | `request-shape-invalid`, `request-limit-exceeded`, `request-evidence-mismatch` |
| reader `reassert/changed` | `source-state-changed`, `retention-state-changed`, `escrow-state-changed`, `expiry-state-changed` |
| reader `reassert/unavailable` | `m3a-reader-unavailable`, `retention-evidence-unavailable` |
| reader `reassert/retired` | `m3a-binding-retired` |
| reader `reassert/invalid` | `request-shape-invalid`, `request-evidence-mismatch` |
| context `openSession/stale` | `runtime-binding-stale` |
| context `openSession/unavailable` | `composition-root-unavailable` |
| context `openSession/rejected` | `descriptor-mismatch`, `binding-mismatch`, `extension-child-limit`, `predecessor-not-retired` |
| context `capture/transition` | `binding-transition-required` |
| context `capture/stale` | `runtime-binding-stale` |
| context `capture/unavailable` | `context-state-unavailable` |
| context `capture/rejected` | `session-receipt-invalid`, `presentation-fence-invalid` |
| context `resolveStatic/stale` | `static-selection-stale` |
| context `resolveStatic/unavailable` | `static-resolver-unavailable` |
| context `resolveStatic/invalid` | `request-shape-invalid`, `request-limit-exceeded`, `binding-evidence-mismatch` |
| context `resolveAuthorityEvidence/missing` | `authority-evidence-missing` |
| context `resolveAuthorityEvidence/stale` | `authority-state-stale`, `presentation-fence-stale` |
| context `resolveAuthorityEvidence/unavailable` | `authority-resolver-unavailable` |
| context `resolveAuthorityEvidence/invalid` | `request-shape-invalid`, `request-limit-exceeded`, `authority-query-invalid`, `binding-evidence-mismatch` |
| context `reassert/changed` | `presentation-fence-changed`, `authority-state-changed`, `source-state-changed`, `artifact-lease-changed`, `head-state-changed` |
| context `reassert/unavailable` | `context-state-unavailable` |
| context `reassert/retired` | `runtime-binding-retired` |
| context `reassert/invalid` | `request-shape-invalid`, `request-evidence-mismatch` |
| context `waitForWake/invalid` | `request-shape-invalid`, `request-limit-exceeded`, `wake-frontier-invalid` |
| context `recordDiagnostic/dropped` | `diagnostic-limit-reached`, `diagnostic-redaction-rejected` |
| context `beginStop/stale` | `runtime-binding-stale` |
| context `beginStop/unavailable` | `teardown-root-unavailable` |
| context `beginStop/invalid` | `request-shape-invalid`, `stop-reason-invalid`, `transition-descriptor-mismatch` |
| context `closeSession/blocked` | `in-flight-work`, `unsettled-candidate`, `unsettled-journal`, `selector-retirement-pending`, `quarantine-readback-pending` |
| context `closeSession/unavailable` | `teardown-root-unavailable` |
| context `closeSession/invalid` | `request-shape-invalid`, `settlement-evidence-mismatch`, `resource-snapshot-mismatch` |
| context `close/blocked` | `session-not-closed`, `extension-child-active`, `resource-inventory-nonzero` |
| commit `readPriorState/stale` | `runtime-binding-stale`, `selector-generation-changed`, `root-store-generation-changed` |
| commit `readPriorState/unavailable` | `root-store-unavailable`, `closure-object-unavailable`, `lease-evidence-unavailable`, `m2-static-baseline-unavailable` |
| commit `readPriorState/invalid` | `request-shape-invalid`, `request-limit-exceeded`, `head-closure-invalid`, `head-read-accounting-mismatch` |
| commit `prepare/conflict` | `selector-generation-conflict`, `projection-root-conflict` |
| commit `prepare/stale-binding` | `runtime-binding-stale`, `presentation-fence-stale` |
| commit `prepare/invalid` | `request-shape-invalid`, `request-limit-exceeded`, `intent-invalid`, `candidate-closure-invalid`, `lease-target-set-invalid` |
| commit `prepare/unavailable` | `root-store-unavailable`, `artifact-lease-unavailable`, `journal-unavailable` |
| commit `prepare/aborted-before-dispatch` | `work-aborted`, `fence-changed-before-dispatch`, `prepare-readback-failed` |
| commit `commit/invalid` before intent admission | `request-shape-invalid`, `prepare-reference-invalid`, `intent-reference-invalid` |
| commit `reconcile/invalid` | `request-shape-invalid`, `intent-reference-invalid`, `journal-chain-invalid` |
| commit `recover/unavailable` before admission | `recovery-evidence-unavailable`, `root-store-unavailable`, `journal-unavailable` |
| commit `recover/invalid` before admission | `request-shape-invalid`, `request-limit-exceeded`, `recovery-request-invalid`, `recovery-kind-mismatch`, `recovery-chain-invalid` |
| commit `detachSources/recovery-pending` | `selector-outcome-uncertain`, `selector-retirement-conflict`, `quarantine-transfer-required` |
| commit `detachSources/stale` | `runtime-binding-stale`, `stop-receipt-stale` |
| commit `detachSources/unavailable` | `selector-store-unavailable`, `quarantine-service-unavailable` |
| commit `detachSources/invalid` | `request-shape-invalid`, `detach-request-invalid`, `expected-head-mismatch`, `transition-descriptor-mismatch` |
| commit `release/blocked` | `candidate-selected`, `candidate-in-flight`, `settlement-readback-pending` |
| commit `release/invalid` | `candidate-reference-invalid`, `settlement-evidence-mismatch` |
| commit `close/blocked` | `in-flight-work`, `candidate-settlement-pending`, `retained-root-transfer-pending`, `quarantine-transfer-pending` |

Recognized durable operations return receipt bytes rather than a reason-only
port result. Their reason fields use these exhaustive subsets, normatively bound
by the named service-internal schema format/version:

| Artifact / variant | Exact allowed `reasonCode` values |
| --- | --- |
| application receipt, terminal evidence, and terminal application-journal row / `conflict` | `selector-generation-conflict`, `competing-root-selected` |
| application receipt, terminal evidence, and terminal application-journal row / `proven-not-committed` | `candidate-never-selected`, `selector-predecessor-still-current` |
| application receipt / nonterminal `recovery-pending` | `selector-outcome-uncertain`, `terminal-readback-unavailable` |
| application receipt, terminal evidence, and terminal application-journal row / `stale-binding` | `runtime-binding-stale` |
| application receipt, terminal evidence, and terminal application-journal row / `invalid` | `intent-invalid`, `candidate-closure-invalid`, `selector-evidence-invalid` |
| application receipt, terminal evidence, and terminal application-journal row / `unavailable` | `root-store-unavailable`, `journal-unavailable`, `artifact-lease-unavailable` |
| application receipt, terminal evidence, and terminal application-journal row / `aborted-before-dispatch` | `work-aborted`, `fence-changed-before-dispatch`, `prepare-readback-failed` |
| recovery receipt, terminal evidence, and terminal recovery-attempt row / `conflict` | `reconciled-application-conflict`, `selector-generation-conflict`, `competing-root-selected` |
| recovery receipt, terminal evidence, and terminal recovery-attempt row / attempt-one-or-two `same-binding-restore/recovery-pending` | `restore-evidence-pending` |
| recovery receipt, terminal evidence, and terminal recovery-attempt row / attempt-one-or-two `same-binding-replay/recovery-pending` | `replay-tail-pending` |
| recovery receipt, terminal evidence, and terminal recovery-attempt row / attempt-one-or-two `uncertain-commit-reconciliation/recovery-pending` | `application-reconciliation-pending` |
| recovery receipt, terminal evidence, and terminal recovery-attempt row / attempt-one-or-two `device-resume/recovery-pending` | `catch-up-pending`, `gate-transition-pending`, constrained by the receipt presence matrix |
| recovery receipt, terminal evidence, and terminal recovery-attempt row / attempt-three `recovery-pending` for any non-fallback kind | `attempt-limit-static-fallback` |
| recovery receipt, terminal evidence, and terminal recovery-attempt row / `rejected` | `recovery-prerequisite-missing`, `recovery-evidence-mismatch`, `recovery-policy-rejected` |
| selector-retirement readback and terminal selector-retirement-attempt row / `conflict` | `selector-generation-conflict`, `competing-root-selected` |
| quarantine-transfer receipt / `quarantine-transferred` | `application-outcome-unresolved`, `recovery-outcome-unresolved`, `selector-retirement-unresolved`, `candidate-settlement-unresolved`, `resource-cleanup-unresolved`, `callback-drain-unresolved`, `in-flight-drain-unresolved`, `resource-inventory-mismatch` |
| disposal receipt / `quarantined-transferred` | exactly the `reasonCode` in its bound quarantine-transfer receipt |

The nonterminal application-journal rows forbid `reasonCode`; their later
`recovery-pending` receipt uses only its two-row subset and does not rewrite the
journal. Every terminal application or recovery reason is byte-identical across
terminal evidence, journal row, and receipt. Every selector-retirement conflict
reason is byte-identical across readback and attempt record. A quarantine
receipt chooses exactly the first applicable reason in its table's listed order
while its inventory and operation rows preserve every cause; the disposal
receipt repeats that exact reason. Successful, released, restored, committed,
fallback, retired, detached, and proven terminal variants forbid a reason unless
their exact row above explicitly requires one.

Three related request/evidence vocabularies are also closed. `transitionReason`
is exactly `operator-partition-changed`, `m2-runtime-binding-changed`,
`m3a-runtime-binding-changed`, `pseudonym-binding-changed`, or
`explicit-binding-retirement`; layout/bake divergence is M3C review evidence and
is not encoded as an M3B transition. `stopReason` is exactly
`operator-requested`, `ordinary-shutdown`, `startup-failed`,
`device-unrecoverable`, `state-unrecoverable`, or `binding-transition`; only
`binding-transition` requires the transition-
descriptor pair and every other value forbids it. `diagnosticCode` is exactly
`input-rejected`, `batch-quarantined`, `limit-rejected`, `recovery-entered`,
`static-fallback-entered`, or `teardown-blocked`. These values are part of their
existing method/schema `@1` domains and create no new catalog module, dependency,
runtime field, or authority.

The diagnostic sub-vocabularies are equally closed. `countName` is one of these
17 values in this exact enumeration order, while request rows remain sorted by
code point: `records`, `canonical-bytes`, `included`, `omitted`,
`primary-deltas`, `historical-primary-deltas`,
`historical-witness-deltas`, `structural-evidence`,
`maintenance-mutations`, `dirty-semantic-keys`, `ecs-operations`,
`state-first-entries`, `retained-roots`, `journal-entries`, `resources`,
`callbacks`, or `in-flight-calls`. `elapsedBucket` is exactly `not-measured`,
`lt-1ms`, `1-4ms`, `5-15ms`, `16-49ms`, `50-199ms`, or `ge-200ms`.
`workBucket` is exactly `zero`, `1-15`, `16-63`, `64-255`, `256-1023`, or
`ge-1024`. Wall-time measurement chooses only an elapsed bucket and never
enters a durable artifact.

The diagnostic sink is one process-local, context-service-private scope for the
exact `(runtimeBindingId, runtimeBindingDigest, extensionChildGeneration)`
triple. It stores only `RealmProjectionDiagnosticEntryV1` rows with this exact
ten-field order:

```text
entryOrder
runtimeBindingId
runtimeBindingDigest
extensionChildGeneration
diagnosticCode
countRows
elapsedBucket
workBucket
aggregateCount
entryDigest
```

`entryOrder` is assigned in dense zero-based first-admission order and never
changes. `entryDigest` uses `particle-realms.m3b-diagnostic-entry@1` over the
first nine fields. The distinct-entry aggregation key is exactly the
byte-identical `(diagnosticCode, countRows, elapsedBucket, workBucket)`
projection; the binding/generation triple selects the enclosing scope and is
also repeated in every stored row. `entryCount` is the exact stored-array
length, and `canonicalByteCount` is the sum of the complete canonical ten-field
bytes of every stored row in `entryOrder`; physical interning or equal nested
`countRows` never reduces that sum.

After request redaction validation, a missing aggregation key appends one row
with `aggregateCount = 1` and returns `accepted` only when the resulting
`entryCount <= 256` and `canonicalByteCount <= 262144`. An existing key replaces
exactly its row at the same `entryOrder` with `aggregateCount = prior + 1`, a
recomputed digest, and returns `aggregated` only when the result remains a safe
integer and its replacement byte total
`prior canonicalByteCount - old complete row bytes + new complete row bytes`
stays within 262,144. Either operation is atomic. A maximum-safe-integer count,
257th distinct entry, byte plus-one, invalid redaction, missing/multiple key
match, or arithmetic inconsistency returns `dropped` and leaves the complete
scope byte-identical. Closing the owning extension generation destroys this
process-local scope only after its in-flight diagnostic calls settle; no later
generation can observe or aggregate it.

`diagnosticReceiptId` uses
`particle-realms.m3b-diagnostic-receipt-id@1` over the runtime-binding pair,
`extensionChildGeneration`, exact request projection, and resulting aggregate count;
`diagnosticReceiptDigest` uses
`particle-realms.m3b-diagnostic-receipt@1` over that same sequence plus the
recomputed ID. The receipt is correlation-only and its bytes never cross the
port.

The two authority request modes, two prior-read modes, issued-versus-nonissued
resource receipts, and quarantine/no-quarantine variants are tested
independently. An idempotent close or release returns byte-identical prior
evidence and payload values; it never increments a generation or mints
replacement evidence. Because `status` participates in `resultId` and
`resultDigest`, an `already-closed` or `already-released` envelope is newly
derived for that status and is not falsely claimed to be byte-identical to the
original `closed` or `released` envelope.

### Exact local service-schema formats

The following registry is authoritative for every M3B-local canonical byte
sequence that crosses a port directly, is nested in another returned package,
or is resolved through a service-owned pair. These are import-inert nested/
service schemas, not additions to the separate 16-definition M3B catalog. Every
row has `version = 1`; the literal format and version are the first two fields of
the named schema. A change to any listed field vocabulary, presence matrix,
format, or semantic domain requires a new schema version and cannot reuse these
bytes.

| Exact type | Literal `format` | Canonical owner |
| --- | --- | --- |
| `RealmProjectionPortDescriptorV1` | `particle-realms.m3b-projection-port-descriptor` | trusted composition root |
| `RealmProjectionPortResultV1` | `particle-realms.m3b-port-result` | called port facet |
| `RealmProjectionContractCatalogReceiptV1` | `particle-realms.m3b-contract-catalog-receipt` | existing contract registry |
| `RealmProjectionReferenceDescriptorPackV1` | `particle-realms.m3b-reference-descriptor-pack` | existing contract registry; embedded in the reference-domain registry |
| `RealmProjectionReferenceDomainRegistryV1` | `particle-realms.m3b-reference-domain-registry` | existing contract registry plus pinned M0-M2/M3A catalogs |
| `RealmProjectionM3ARetentionStateV1` | `particle-realms.m3b-m3a-retention-state` | restricted reader projection |
| `RealmProjectionSourceStateSnapshotV1` | `particle-realms.m3b-projection-source-state-snapshot` | restricted reader projection |
| `RealmProjectionReaderEvidenceEscrowManifestV1` | `particle-realms.m3b-reader-evidence-escrow-manifest` | reader escrow service |
| `RealmProjectionReadCallReceiptV1` | `particle-realms.m3b-projection-read-call-receipt` | reader escrow service |
| `RealmProjectionHeadDescriptorV1` | `particle-realms.m3b-projection-head-descriptor` | selector/root store |
| `RealmProjectionM2StaticBaselineDescriptorV1` | `particle-realms.m3b-m2-static-baseline-descriptor` | selector/root store over accepted M2 evidence |
| `RealmProjectionPriorStateBundleV1` | `particle-realms.m3b-projection-prior-state-bundle` | selector/root store |
| `RealmProjectionHeadReadReceiptV1` | `particle-realms.m3b-projection-head-read-receipt` | selector/root store |
| `RealmProjectionStaticLookupLimitsV1` | `particle-realms.m3b-static-lookup-limits` | context/static resolver |
| `RealmProjectionPresentationFenceV1` | `particle-realms.m3b-projection-presentation-fence` | presentation-fence service |
| `RealmProjectionStaticResolutionReceiptV1` | `particle-realms.m3b-static-resolution-receipt` | context/static resolver |
| `RealmProjectionRecordedAuthorityEscrowManifestV1` | `particle-realms.m3b-recorded-authority-escrow-manifest` | recorded-authority escrow service |
| `RealmProjectionAuthorityResolutionReceiptV1` | `particle-realms.m3b-authority-resolution-receipt` | authority resolver |
| `RealmCurrentAuthorityStateSnapshotV1` | `particle-realms.m3b-current-authority-state-snapshot` | current-authority owner |
| `RealmProjectionBindingTransitionDescriptorV1` | `particle-realms.m3b-projection-binding-transition-descriptor` | context selection service |
| `RealmProjectionWakeEvidenceV1` | `particle-realms.m3b-projection-wake-evidence` | context wake service |
| `RealmProjectionExpiryDueReceiptV1` | `particle-realms.m3b-projection-expiry-due-receipt` | M3A tick/expiry join |
| `RealmProjectionStopReceiptV1` | `particle-realms.m3b-projection-stop-receipt` | extension teardown owner |
| `ActiveProjectionBundleV1` | `particle-realms.m3b-active-projection-bundle` | selector/root store |
| `RealmProjectionDurableSelectorV1` | `particle-realms.m3b-projection-durable-selector` | selector/root store |
| `RealmProjectionSemanticAxisTransitionPolicyV1` | `particle-realms.m3b-semantic-axis-transition-policy` | shared pure verifier |
| `RealmProjectionCommitCapabilityProfileV1` | `particle-realms.m3-projection-commit-capability-profile` | trusted projection-bundle adapter verifier |
| `RealmProjectionLineageFloorAnchorV1` | `particle-realms.m3b-projection-lineage-floor-anchor` | root store |
| `RealmProjectionProtectedClosureManifestV1` | `particle-realms.m3b-projection-protected-closure-manifest` | root store |
| `M2StaticArtifactLeaseTargetSetV1` | `particle-realms.m3b-m2-static-artifact-lease-target-set` | M3B pure target compiler |
| `RealmProjectionApplicationPhaseEvidenceV1` | `particle-realms.m3b-application-phase-evidence` | application-journal owner |
| `RealmProjectionApplicationOperationJournalRecordV1` | `particle-realms.m3b-application-operation-journal-record` | application-journal owner |
| `RealmProjectionApplicationTerminalEvidenceV1` | `particle-realms.m3b-application-terminal-evidence` | application-journal owner |
| `RealmProjectionRecoveryPhaseEvidenceV1` | `particle-realms.m3b-recovery-phase-evidence` | recovery-journal owner |
| `RealmProjectionRecoveryJoinedEvidenceRowsV1` | `particle-realms.m3b-recovery-joined-evidence-rows` | recovery-journal owner |
| `RealmProjectionRecoveryMutationPlanV1` | `particle-realms.m3b-recovery-mutation-plan` | recovery-journal owner |
| `RealmProjectionRecoveryAttemptRecordV1` | `particle-realms.m3b-recovery-attempt-record` | recovery-journal owner |
| `RealmProjectionRecoveryTerminalEvidenceV1` | `particle-realms.m3b-recovery-terminal-evidence` | recovery-journal owner |
| `RealmProjectionRecoveryJournalFloorV1` | `particle-realms.m3b-recovery-journal-floor` | recovery-journal owner |
| `RealmProjectionSelectorReadReceiptV1` | `particle-realms.m3b-projection-selector-read-receipt` | selector/root store |
| `RealmProjectionSelectorRetirementReadbackReceiptV1` | `particle-realms.m3b-selector-retirement-readback-receipt` | selector/root store |
| `RealmProjectionCatchUpReceiptV1` | `particle-realms.m3b-projection-catch-up-receipt` | recovery service |
| `RealmProjectionPresentationGateTransitionReceiptV1` | `particle-realms.m3b-presentation-gate-transition-receipt` | presentation-gate service |
| `RealmProjectionSelectorRetirementPhaseEvidenceV1` | `particle-realms.m3b-selector-retirement-phase-evidence` | selector-retirement journal owner |
| `RealmProjectionSelectorRetirementAttemptRecordV1` | `particle-realms.m3b-selector-retirement-attempt-record` | selector-retirement journal owner |
| `RealmProjectionDetachReceiptV1` | `particle-realms.m3b-projection-detach-receipt` | commit teardown service |
| `RealmProjectionQuarantineTransferReceiptV1` | `particle-realms.m3b-projection-quarantine-transfer-receipt` | kernel quarantine owner |
| `RealmProjectionRetainedRootTransferReceiptV1` | `particle-realms.m3b-retained-root-transfer-receipt` | retained-root owner |
| `RealmProjectionBindingTransitionReceiptV1` | `particle-realms.m3b-projection-binding-transition-receipt` | trusted binding-transition service |
| `RealmProjectionCandidateRootReleaseReceiptV1` | `particle-realms.m3b-candidate-root-release-receipt` | root store |
| `RealmProjectionArtifactLeaseReleaseReceiptV1` | `particle-realms.m3b-artifact-lease-release-receipt` | accepted M2 artifact-lease adapter |
| `RealmProjectionCandidateLeaseAndRootReleaseReceiptV1` | `particle-realms.m3b-candidate-lease-and-root-release-receipt` | commit/M2 lease-settlement join |
| `RealmProjectionCandidateLeaseSettlementReceiptV1` | `particle-realms.m3b-candidate-lease-settlement-receipt` | commit/root-store settlement join |
| `RealmProjectionResourceSnapshotV1` | `particle-realms.m3b-projection-resource-snapshot` | extension resource ledger |

Nested evidence/target/closure/dependency/payload rows do not carry their own
`format` or `version` fields. Their exact ordered fields, row digest, position,
and containing parent schema format/version jointly define their domain; a row
cannot be moved into another parent type even when its scalar shape happens to
match. The registered 16 M3B wire definitions retain their separate format
table below. This local registry creates no seventeenth definition, callable
method, live handle, resolver authority, or nested runtime owner.

### Pinned reference-domain and heterogeneous-carrier registry

The registry is constructed only from one code-shipped, data-only
`RealmProjectionReferenceDescriptorPackV1`. The pack is embedded byte-for-byte
inside the registry and has exactly 17
top-level fields:

```text
format
version
descriptorPackId
definitionDescriptorRows
definitionDescriptorCount
definitionDescriptorRowsDigest
dependencyExtractorRows
dependencyExtractorCount
dependencyExtractorRowsDigest
sourceAuthorityRuleRows
sourceAuthorityRuleCount
sourceAuthorityRuleRowsDigest
producerPredicateRows
producerPredicateCount
producerPredicateRowsDigest
disposition
descriptorPackDigest
```

The pack is never a standalone port field, caller-selectable object, or
independent closure entry. Its bytes cross a port only nested inside the
recomputed reference-domain-registry object in
`candidateClosureObjectBytes`/`protectedClosureObjectBytes`.

Its format is `particle-realms.m3b-reference-descriptor-pack`, version is `1`,
and disposition is `frozen`. It has exactly 50 definition-descriptor rows, 50
dependency-extractor rows, 78 source-authority-rule rows, and 78 producer-
predicate rows. Orders in each array are dense zero-based integers. Definition
and extractor rows are code-point-sorted by `domainKey`; authority and
predicate rows are code-point-sorted by `(domainKey, carrierKind)`. Counts equal
array lengths. Duplicate keys/orders, a sparse order, or a row not consumed
exactly once by the registry fails pack construction.

Each definition-descriptor row has this exact 15-field maximum vocabulary:

```text
descriptorOrder
domainKey
definitionSource
definitionName
wireFormat
wireVersion
intrinsicIdField
intrinsicDigestField
selectorFieldNames
selectorVariantRows
selectorRuleRows
canonicalContractDefinitionBytes
definitionCatalogRole
definitionDigest
rowDigest
```

Imported rows have all 15 keys. Registered/local/opaque-local rows have 14 and
omit only `definitionCatalogRole`. This is a reference-selector descriptor, not
a second schema language. For imported/registered/local rows,
`definitionDigest` must equal the independently recomputed authoritative
contract-definition digest over `canonicalContractDefinitionBytes`. Imported
bytes must equal the descriptor bytes read back from the named accepted catalog;
registered/local bytes are checked-in canonical contract-registry descriptor
bytes emitted by the same existing definition encoder and parsed by both the
JavaScript and Python vector gates. Those bytes, not this selector row, bind types, encodings, numeric
limits, conditional keys, defaults, byte accounting, and every other schema
rule. `selectorFieldNames` is only the exact ordered ID/digest/discriminator
field subset that a heterogeneous carrier may inspect. Every selector-
variant row has exactly seven fields: `variantOrder`, `variantId`,
`discriminatorFieldPath`, `discriminatorValues`, `requiredFieldNames`,
`omittedFieldNames`, and `rowDigest`. Orders are dense; discriminator values and
selector-field arrays preserve declared schema order and are duplicate-free. An
unconditional schema uses one `unconditional` row with
`discriminatorFieldPath = none`, an empty value array, every field required,
and no omissions. The required and omitted sets partition
`selectorFieldNames` for each legal selector variant. Its row digest domain is
`particle-realms.m3b-reference-definition-presence-variant@1` over the first
six fields.

Every selector-rule row has exactly eight fields: `ruleOrder`, `ruleId`,
`ruleKind`, `subjectFieldPaths`, `operatorId`, `canonicalOperands`,
`admittedTargetDomainKeys`, and `rowDigest`. `ruleKind` is exactly `field`,
`pair`, `ordering`, or `reference`; `operatorId` is exactly `equals`, `one-of`,
`present-together`, `absent-together`, `code-point-sorted-unique`,
`equals-field`, `resolves-domain`, or `forbidden`. Paths are canonical
dotted/bracketed paths from the descriptor's own `selectorFieldNames`.
`subjectFieldPaths` is always an array in declared selector-field order,
without duplicates. `canonicalOperands` is always a canonical JSON array, even
when the operator has zero or one operand. An operand scalar is exactly a JSON
string, Boolean, `null`, or safe integer in
`[-9007199254740991, 9007199254740991]`; floating-point values, negative zero,
objects, and nested arrays are forbidden. These are the only legal selector-
rule shapes:

| `operatorId` | required `ruleKind` | subject-path arity | `canonicalOperands` | `admittedTargetDomainKeys` |
|---|---|---:|---|---|
| `equals` | `field` | exactly 1 | exactly one scalar | empty |
| `one-of` | `field` | exactly 1 | one or more distinct scalars, sorted by their canonical JSON bytes | empty |
| `present-together` | `pair` | exactly 2 | empty | empty |
| `absent-together` | `pair` | exactly 2 | empty | empty |
| `code-point-sorted-unique` | `ordering` | exactly 1 | empty | empty |
| `equals-field` | `pair` | exactly 2 | empty | empty |
| `resolves-domain` | `reference` | exactly 2, intrinsic ID then intrinsic digest | empty | one or more code-point-sorted unique descriptor `domainKey` values |
| `forbidden` | `field` | exactly 1 | empty | empty |

For `equals-field`, the first subject is the value and the second is its exact
comparison field; swapping them produces a different rule even if equality is
mathematically symmetric. For `present-together` and `absent-together`, the two
subjects are evaluated as a pair, not as two independent one-field rules. For
`resolves-domain`, both intrinsic fields must resolve to the same admitted
definition and canonical bytes. Any other kind/operator combination, operand
shape, subject arity, domain-list presence, or ordering fails descriptor-pack
construction. A row cannot encode executable code, a regex, a callback,
implementation-language source, an open predicate, or any validation already
owned by the authoritative definition. `ruleId` uses
`particle-realms.m3b-reference-definition-semantic-rule-id@1` over fields three
through seven; its `rowDigest` uses
`particle-realms.m3b-reference-definition-semantic-rule@1` over its first seven
fields. An opaque-local row has no issuer wire bytes; its `definitionDigest`
alone uses `particle-realms.m3b-opaque-reference-definition@1` over, in order,
`domainKey`, `definitionName`, its two intrinsic selectors, complete selector
field/variant/rule rows, and literal `no-issuer-wire-bytes`; its
`canonicalContractDefinitionBytes` is the exact canonical empty byte sequence.
The outer row
digest uses
`particle-realms.m3b-reference-definition-row@1` over every preceding present
field. Thus selector, presence, reference rule, authoritative definition,
source, format, version, or catalog-role drift changes the pinned row without
pretending this pack replaces the complete schema definitions.

Selector-rule order is dense and zero-based in the displayed descriptor order;
duplicate, sparse, or reordered rule IDs fail the descriptor row.

Each dependency-extractor row has exactly eight fields:

```text
extractorOrder
dependencyExtractorId
domainKey
dependencyRoleRows
dependencyRoleCount
parentRowPathIds
parentRowPathCount
dependencyExtractorDigest
```

Each dependency-role row has exactly 12 fields: `roleOrder`, `roleName`,
`parentRowPathId`, `idFieldPath`, `digestFieldPath`,
`presenceDiscriminatorFieldPath`, `presenceDiscriminatorValues`,
`admittedTargetDomainKeys`, `admittedCatalogRoles`, `targetRole`,
`multiplicity`, and `rowDigest`.
`parentRowPathId` is `self` or one exact parent-qualified row path listed below;
field paths are exact paths inside that parent. A role without a discriminator
uses literal `none` and an empty values array. `targetRole` is `root-object`,
`m2-target`, or `pinned-import`. A `pinned-import` row has empty
`admittedTargetDomainKeys` and a nonempty duplicate-free subset of
`accepted-m0-m1c`, `accepted-m2`, and `accepted-m3a` in that fixed order. A
`root-object` or `m2-target` row has one or more code-point-sorted unique target
domain keys and an empty catalog-role array. `multiplicity` is `exactly-one`,
`zero-or-one`, `one-per-parent-row`, or `zero-or-more-ordered`. Role order is
dense and follows canonical parent traversal, admitted target keys are
code-point-sorted unique, and the row digest uses
`particle-realms.m3b-reference-dependency-role@1` over its first 11 fields.
`parentRowPathIds` is the code-point-sorted unique union used by its roles and
its count is exact. A no-dependency extractor has empty role/path arrays and
both counts zero. `dependencyExtractorId` uses
`particle-realms.m3b-reference-dependency-extractor-id@1` over `domainKey`, the
complete role rows/count, and path IDs/count. `dependencyExtractorDigest` uses
`particle-realms.m3b-reference-dependency-extractor@1` over the first seven
fields, including the recomputed ID.

Each source-authority-rule row has exactly ten fields: `ruleOrder`,
`sourceAuthorityRuleId`, `domainKey`, `carrierKind`, `ruleKind`,
`authorityFieldPath`, `exactIssuerOwner`, `requiredResolverKind`,
`conditionRows`, and `ruleDigest`. `ruleKind` is exactly `fixed-literal`,
`intrinsic-field`, `parent-field`, or
`not-carried-but-resolver-must-prove`; a rule without an authority field uses
literal path `none`. The four kinds have these exact source/destination
semantics; `carrier:sourceAuthority` below is the literal path and never an
implementation-selected alias:

| `ruleKind` | Exact `authorityFieldPath` shape | Source value | Carrier `sourceAuthority` disposition | Mandatory proof |
|---|---|---|---|---|
| `fixed-literal` | exactly `carrier:sourceAuthority` | `exactIssuerOwner` itself | required | carrier value = `exactIssuerOwner` |
| `intrinsic-field` | exactly `issuer:{authoritative path}` | required authority ID at that issuer path | required | issuer value = carrier value; the resolver proves the canonical issuer object is owned/admitted by `exactIssuerOwner` |
| `parent-field` | exactly `parent:{authoritative path}` | required authority ID at that parent path | required | parent value = carrier value; the resolver proves the canonical parent object is owned/admitted by `exactIssuerOwner` |
| `not-carried-but-resolver-must-prove` | exactly `none` | resolver-proven owner of the exact canonical issuer bytes/pair | forbidden | proven issuer owner = `exactIssuerOwner`; no carrier authority value exists |

Thus `authorityFieldPath` names the authority source for intrinsic/parent rules,
the canonical carrier destination for a fixed literal, and no field for an
intentionally pair-only carrier. A non-`not-carried` carrier whose authoritative
variant omits `sourceAuthority`, a not-carried carrier that exposes or invents
one, a source path in the wrong scope, or any unequal value fails before
producer-predicate evaluation. `exactIssuerOwner` and
`requiredResolverKind` are nonempty canonical IDs in every row; neither may be
`none`, caller supplied, or inferred from a field name. Conditions may only add
constraints after these mandatory source/destination equalities and cannot
weaken or replace them.

For `fixed-literal` and `not-carried-but-resolver-must-prove`,
`exactIssuerOwner` is also the literal authority value proved by the rule. For
`intrinsic-field` and `parent-field`, it instead names the frozen owner of the
canonical issuer/parent object whose already validated authority field is
copied; it is deliberately not required to equal that field's value. This
distinction permits a trusted M3A ledger to retain observations emitted by
different trusted source authorities without rewriting or widening their
original `sourceAuthority` values.

Each condition row has exactly six fields:
`conditionOrder`, `leftFieldPath`, `operatorId`, `rightOperandKind`,
`rightOperand`, and `rowDigest`. Its order is dense; `rightOperandKind` is
`literal`, `field-path`, `owner-id`, `domain-key`, or `none`.
Every non-`none` field path has exact grammar
`{scope}:{authoritative dotted/bracketed path}`, where `scope` is `issuer`,
`carrier`, `parent`, `binding`, `catalog`, or `current-owner`; the referenced
path must exist in that scope's authoritative definition and legal variant.
There is no unscoped lookup or property fallback. Its `operatorId`
is exactly `equals`, `not-equals`, `one-of`, `present`, `absent`,
`present-together`, `absent-together`, `equals-field`, `member-of-field`,
`resolves-domain`, `signed-by`, `current-at-cut`, `sequence-equals`,
`generation-equals`, `digest-recomputes`, or `status-allows-edge`. The
`rightOperand` field has one closed typed grammar: `none` means the literal JSON
`null`; `field-path` means one canonical scoped path string; `owner-id` means
one canonical nonempty owner ID accepted by the referenced owner contract;
`domain-key` means one exact `domainKey` in this descriptor pack; and `literal`
means a JSON string, Boolean, `null`, or safe integer in
`[-9007199254740991, 9007199254740991]`, except for the two explicitly array-
valued operators below. Floating-point values, negative zero, objects, nested
arrays, implicit string coercion, and host-language `undefined` are forbidden.
These are the only legal operator/operand combinations:

| `operatorId` | required `rightOperandKind` | exact `rightOperand` shape | semantic operand arity |
|---|---|---|---:|
| `equals` | `literal`, `owner-id`, or `domain-key` | one scalar of the selected kind | 1 |
| `not-equals` | `literal`, `owner-id`, or `domain-key` | one scalar of the selected kind | 1 |
| `one-of` | `literal` | nonempty array of distinct scalar literals, sorted by canonical JSON bytes | 1 set |
| `present` | `none` | JSON `null` | 0 |
| `absent` | `none` | JSON `null` | 0 |
| `present-together` | `field-path` | one canonical scoped field path | 1 |
| `absent-together` | `field-path` | one canonical scoped field path | 1 |
| `equals-field` | `field-path` | one canonical scoped field path | 1 |
| `member-of-field` | `field-path` | one canonical scoped path resolving to an authoritative array | 1 |
| `resolves-domain` | `domain-key` | one exact descriptor-pack domain key | 1 |
| `signed-by` | `owner-id` | one canonical owner ID | 1 |
| `current-at-cut` | `none` | JSON `null`; the closure-bound accepted cut is implicit | 0 |
| `sequence-equals` | `field-path` | one canonical scoped field path resolving to a safe integer | 1 |
| `generation-equals` | `field-path` | one canonical scoped field path resolving to a safe integer | 1 |
| `digest-recomputes` | `none` | JSON `null`; the authoritative definition selects the digest preimage | 0 |
| `status-allows-edge` | `literal` | nonempty code-point-sorted unique array of exact authoritative status strings | 1 set |

`leftFieldPath` is always one canonical scoped field path and therefore adds
exactly one left operand. A field-path right operand is dereferenced only after
its named scope and authoritative legal variant have been admitted. `one-of`
and `status-allows-edge` are the only conditions whose `rightOperand` is an
array; their arrays never contain an array or object. Any mismatched kind,
shape, arity, empty set, duplicate set member, noncanonical order, or sentinel
fails descriptor-pack construction before condition evaluation. Conditions
are evaluated only after `requiredResolverKind` has accepted the authoritative
issuer contract, canonical pair/digest, signature/trust checks, and any
owner-specific cut/selection proof. They may meet already verified fields but
never invoke, name, select, or replace a verifier. The condition-row digest domain is
`particle-realms.m3b-reference-source-authority-condition@1` over the first
five fields. `sourceAuthorityRuleId` uses
`particle-realms.m3b-reference-source-authority-rule-id@1` over fields three
through nine; `ruleDigest` uses
`particle-realms.m3b-reference-source-authority-rule@1` over the first nine
fields. The exact issuer owner and resolver are therefore cryptographic
material, not prose selected by an implementation.

All source-authority condition rows are ANDed in `conditionOrder`. An empty
array is legal only for a `fixed-literal` or
`not-carried-but-resolver-must-prove` rule whose exact issuer owner and resolver
fully determine authority. `intrinsic-field` and `parent-field` require at least
one `equals-field`, `resolves-domain`, `current-at-cut`, or
`status-allows-edge` condition over the exact scoped path.

Each producer-predicate row has exactly eight fields: `predicateOrder`,
`producerPredicateId`, `domainKey`, `carrierKind`, `variantRows`,
`variantCount`, `consumerEdgeIds`, and `predicateDigest`. Each variant row has
exactly five fields: `variantOrder`, `variantId`, `conditionRows`,
`conditionCount`, and `rowDigest`; each condition row has the same six-field
closed shape and operator vocabulary as an authority condition, but its
`rowDigest` uses the distinct
`particle-realms.m3b-reference-producer-predicate-condition@1` domain over the
first five fields. Conditions in
one variant are ANDed; variants are ORed; an unconditional admission has one
variant with zero conditions. Variant/condition orders are dense and counts
equal lengths. `consumerEdgeIds` is the code-point-sorted unique list of exact
direct carrier-admission edge IDs admitted by that predicate's normalized
carrier source row only. Across the pack those lists cover exactly the 111
expanded carrier variants and 111 direct tuples once. Cross-method aliases are
bound by the separately pinned alias graph below and never enter
`consumerEdgeIds`. Each direct edge ID uses
`particle-realms.m3b-reference-edge-id@1` over the
canonical five-string tuple `(domainKey, carrierKind,
producerMethodOrOwnerId, consumerMethodOrArtifactId, variantId)`. Multi-edge
prose is never parsed: the checked-in descriptor vector enumerates one tuple per
edge and tests project every tuple back to exactly one documented producer,
consumer, and variant. A variant row
uses `particle-realms.m3b-reference-producer-predicate-variant@1` over its first
four fields. `producerPredicateId` uses
`particle-realms.m3b-reference-producer-predicate-id@1` over fields three
through seven; `predicateDigest` uses
`particle-realms.m3b-reference-producer-predicate@1` over the first seven
fields. No free-form prose, implicit truthiness, host-language predicate, or
consumer not named by `consumerEdgeIds` is legal.

Array aggregate domains are, respectively,
`particle-realms.m3b-reference-definition-rows@1`,
`particle-realms.m3b-reference-dependency-extractor-rows@1`,
`particle-realms.m3b-reference-source-authority-rule-rows@1`, and
`particle-realms.m3b-reference-producer-predicate-rows@1`; each hashes its
complete ordered canonical rows followed by its exact count.
`descriptorPackId` uses
`particle-realms.m3b-reference-descriptor-pack-id@1` over, in order, `version`,
the four count/digest pairs, and `disposition`. `descriptorPackDigest` uses
`particle-realms.m3b-reference-descriptor-pack@1` over the first 16 top-level
fields, including the recomputed ID and complete arrays, with only itself
omitted. The implementation must check in the complete 50/50/78/78 canonical
vector and its independently recomputed JavaScript/Python digests; hand-authored
IDs or digests are invalid.

The service-local `RealmProjectionReferenceDomainRegistryV1` is the one
authoritative discriminator map used by source-state evidence, reader escrow,
recorded-authority escrow, static-resolution rows, protected closure, and M2
lease targets. A `particle-realms.m3b-ref/*` adapter enters this registry only
when one of those heterogeneous carriers uses it; pair-only cross-method
adapters remain closed by the separate table below. It has exactly 12
fields:

```text
format
version
referenceDomainRegistryId
referenceDescriptorPackBytes
importedCatalogRows
importedCatalogCount
importedCatalogDigest
domainRows
domainCount
domainRowsDigest
disposition
registryDigest
```

Its format is `particle-realms.m3b-reference-domain-registry`, version is `1`,
and disposition is `registered`. `referenceDescriptorPackBytes` is the exact
canonical 17-field pack above. Its embedded ID/digest recompute before any
catalog or domain row is admitted, and none of its nested descriptor rows is an
independent protected-closure object or reference-domain key.
`importedCatalogRows` has exactly three rows:
zero-based `catalogOrder` 0 is `accepted-m0-m1c`, 1 is `accepted-m2`, and 2 is
`accepted-m3a`. Each has exactly
seven fields: `catalogOrder`, `catalogRole`, `catalogId`, `catalogDigest`,
`definitionCount`, `disposition`, and `rowDigest`. Every pair and definition
count must equal readback from the already accepted import-inert catalog for
that role, and row `disposition` is exactly `accepted`; M3B registration fails
if one catalog is absent, partial, mutable,
unaccepted, or replaced. The M3B registered definitions and local schemas are
fed directly into the registry compiler, so the registry does not point back to
the later M3B catalog receipt and no digest cycle exists.

Each `domainRows` element has a closed 15-field maximum vocabulary:

```text
domainOrder
domainKey
definitionSource
definitionName
wireFormat
wireVersion
intrinsicIdField
intrinsicDigestField
issuerOwner
dependencyExtractorId
dependencyExtractorDigest
carrierRuleRows
definitionCatalogRole
definitionDigest
rowDigest
```

`definitionSource` is `registered-m3b`, `local-m3b`,
`opaque-local-reference`, or `imported`. An opaque-local-reference row is a
complete code-shipped data-only reference descriptor with no canonical issuer
bytes; it is legal only with `pair-only` or `m2-resolve-no-bytes` and cannot
pretend to be an imported wire record. Imported
rows have all 15 keys and bind one exact definition digest from one of the three
catalog rows. Registered/local M3B rows have 14 own keys and omit only
`definitionCatalogRole`; opaque-local-reference rows use that same 14-key shape.
Their mandatory `definitionDigest` binds the complete
code-shipped schema descriptor, ordered field/presence rules, and semantic-
predicate descriptor before the later catalog receipt exists. `wireFormat` and
`wireVersion` are copied from the resolved definition,
never inferred from a field name. `domainKey` is `wireFormat@wireVersion` when
one wire contract has one admitted role; a closed `#variant` suffix separates
different accepted variants of the same wire contract. An imported opaque
adapter uses one exact `particle-realms.m3b-ref/{kind}@1` key while binding the
underlying imported definition, wire format/version, selectors, owner, and
definition digest in its row; it neither renames nor redigests issuer bytes. An
`opaque-local-reference` key instead binds only its complete local pair/reference
descriptor, prebound owner/resolver, and producer predicate. It has no issuer
wire bytes and can never use an embedded/copied-original-bytes carrier rule.

`dependencyExtractorId` and `dependencyExtractorDigest` identify and bind the
frozen data-only descriptor that lists every ordered dependency role, admitted
target domain key, and parent-contained row path for that domain. A domain with
no external dependency uses the code-shipped empty descriptor and its fixed
digest; it never omits these fields.

Nested rows use `rowPathId = {parentDomainKey}#row:{exactFieldPath}` inside
extractor descriptors and never become carrier/domain keys. The closed V1 path
set is: reference-domain registry `importedCatalogRows[]`, `domainRows[]`, and
`domainRows[].carrierRuleRows[]`; reader and recorded-authority escrow
`evidenceRows[]` as two distinct parent-qualified paths; source-state snapshot
`sourceCursorSlots[]`; input cut `sourceStateSlots[]` and
`authorityEvidenceRows[]`; domain manifest `projectorRows[]`; disclosure policy
`ruleRows[]`; semantic-axis policy `provenanceTransitions[]`,
`evidenceTransitions[]`, `availabilityTransitions[]`,
`freshnessTransitions[]`, `temporalTransitions[]`, and
`assertionTransitions[]`; decision set
`decisions[]`; projection batch `primaryProjectionOutcomeRows[]`,
`historicalWitnessOutcomeRows[]`, `maintenanceOutcomeRows[]`,
`operationCounts[]`, and `structuralIntentEvidenceRows[]`; applied cursor
`sourceStateSlots[]`; DynamicStore `channelRows[]` and
`channelRows[].entryRows[]`; ECS change set `operationRows[]`,
`operationRows[].componentWriteRows[]`, `resultingOverlayRows[]`, and
`resultingOverlayRows[].componentRows[]`; State-First snapshot
`sourceEntryRows[]` and `sourceEntryRows[].dependencyRows[]`; context
`resolveStatic` result
`particle-realms.m3b-port-result/realmProjectionContextPort/resolveStatic@1#row:payload.recordRows[]`
for its `ready` and `missing` variants; protected closure `entryRows[]`; M2
target set `targetRows[]`;
and each imported `RealmDeltaV1.payload` and
`RealmPresentationCommandV1.parameters` qualified by its exact parent wire domain
and operation/command discriminator. Scalar arrays are not row paths. Any
unlisted path is parent-contained data only and cannot create a dependency or
independent identity.

Each `carrierRuleRows` element has exactly seven fields: `carrierOrder`,
`carrierKind`, `bytesRule`, `sourceAuthorityRuleId`,
`requiredResolverKind`, `producerPredicateId`, and `rowDigest`.
`carrierKind` is exactly `source-state`, `reader-escrow`,
`recorded-authority-escrow`, `static-resolution`,
`protected-closure-root`, or `m2-target`. `bytesRule` is exactly `pair-only`,
`embedded-original-bytes`, `copied-root-original-bytes`,
`candidate-bytes-then-root-adopted`, or `m2-resolve-no-bytes`.
`sourceAuthorityRuleId` is the domain-separated content ID of the frozen rule
that derives or checks the carrier's exact `sourceAuthority`; a carrier with no
authority field uses a carrier-specific
`not-carried-but-resolver-must-prove` rule naming the exact issuer owner and
authority predicate, never one shared wildcard `not-carried` rule. Resolver kind is
carrier-specific: original bytes, copied root-store bytes, and an M2 pair-only
target can never share a resolver merely because their domain key matches.
`producerPredicateId` is the domain-separated content ID of the frozen
data-only status/phase/generation/presence decision table named below; changing
one admitted condition changes the ID. Carrier rules are unique, code-point
sorted by `carrierKind`, and use dense zero-based `carrierOrder`. Domain
rows are unique, code-point sorted by `domainKey`, and use dense zero-based
`domainOrder`, so one domain may be pair-only in source state, embedded in
escrow, and copied after root adoption without conflating those rules. Domain
count equals the exact exhaustive merged domain-key union below; it is never a
caller-supplied count.

Every domain row joins exactly one same-`domainKey` definition-descriptor row
and one same-`domainKey` dependency-extractor row in the embedded pack. The
shared projections of source, name, format/version, intrinsic selectors,
canonical definition bytes, optional catalog role, and `definitionDigest` are byte-identical, and the
domain's extractor pair equals the extractor row's ID/digest. Every carrier-
rule row joins exactly one same-`(domainKey, carrierKind)` authority-rule row
and one same-key/carrier producer-predicate row: `sourceAuthorityRuleId`,
`requiredResolverKind`, and `producerPredicateId` equal the corresponding
projected fields. Every one of the 50/50/78/78 pack
rows is consumed exactly once. A missing, extra, multiply consumed, or merely
same-shaped descriptor fails registry compilation before any runtime binding
can reference the registry.

Every digest preimage is exact and acyclic. An imported-catalog row's
`rowDigest` uses
`particle-realms.m3b-reference-domain-imported-catalog-row@1` over its first six
fields in listed order. `importedCatalogDigest` uses
`particle-realms.m3b-reference-domain-imported-catalog-rows@1` over the three
complete canonical row byte sequences in `catalogOrder`; the count is literal
three and participates in that aggregate preimage. A carrier-rule row's
`rowDigest` uses
`particle-realms.m3b-reference-domain-carrier-rule-row@1` over its first six
fields in listed order. A domain row's `rowDigest` uses
`particle-realms.m3b-reference-domain-row@1` over every preceding present field
in listed order, including the extractor pair, complete carrier-rule rows, and
mandatory definition digest, so 14-key and 15-key rows cannot collide.
`domainRowsDigest` uses
`particle-realms.m3b-reference-domain-rows@1` over the complete canonical domain
row byte sequences in `domainOrder` plus `domainCount`.
`referenceDomainRegistryId` uses
`particle-realms.m3b-reference-domain-registry-id@1` over, in order, `version`,
the embedded descriptor-pack ID/digest, `importedCatalogCount`,
`importedCatalogDigest`, `domainCount`, `domainRowsDigest`, and `disposition`;
it excludes itself, the embedded/row byte arrays, and
`format`/`registryDigest` while their digests close their contents.
`registryDigest` uses `particle-realms.m3b-reference-domain-registry@1` over
every present preceding top-level field in the displayed 12-field order,
including the recomputed ID, embedded descriptor pack, and both arrays, with
only itself omitted.

An unknown key, duplicate key, mismatched
format/version/selector/owner/resolver/extractor/predicate/definition/catalog
digest, or carrier not
listed for that key fails before allocation. No registry row is a capability
or callable resolver.

The source-state table above is the complete `source-state` subset. The reader
escrow subset is exactly:

| `evidenceKind` / domain key | Resolved type and wire format | Required producer predicate | Owner / resolver |
| --- | --- | --- | --- |
| `particle-realms.realm-observation-ingress-binding@1` | `RealmObservationIngressBindingV1`; same literal format/version | exact current portable M3A binding receipt for the runtime binding and read call | `realm-observation-binding-owner@1` / `m3b-reader-original-contract-verifier@1` |
| `particle-realms.realm-observation-ingress-profile@1` | `RealmObservationIngressProfileV1`; same literal format/version | exact accepted profile named by the M3A binding | `realm-observation-profile-registry@1` / `m3b-reader-original-contract-verifier@1` |
| `particle-realms.realm-observation-source-manifest@1` | `RealmObservationSourceManifestV1`; same literal format/version | exact accepted seven-source manifest named by the M3A binding | `realm-observation-source-manifest-registry@1` / `m3b-reader-original-contract-verifier@1` |
| `particle-realms.realm-observation-batch@1` | `RealmObservationBatchV1`; same literal format/version | accepted retained M3A batch at the exact reader cut | `realm-observation-ledger@1` / `m3b-reader-original-contract-verifier@1` |
| `particle-realms.realm-observation@1` | `RealmObservationV1`; same literal format/version | exact safe-normalized observation named once by that batch | intrinsic `sourceAuthority`; canonical issuer object owned/admitted by `realm-observation-ledger@1` through `m3b-reader-original-contract-verifier@1` |
| `particle-realms.realm-observation-ledger-append-receipt@1` | `RealmObservationLedgerAppendReceiptV1`; same literal format/version | `disposition = committed`, `durableStatus = committed-durable` | `realm-observation-ledger@1` / `m3b-reader-original-contract-verifier@1` |
| `particle-realms.m3b-ref/m3a-ledger-head-receipt@1` | pinned accepted M3A ledger-head receipt definition and its catalog-bound wire format/version | exact current committed head for the append/cut | `realm-observation-ledger-head-owner@1` / `m3b-reader-original-contract-verifier@1` |
| `particle-realms.realm-observation-checkpoint-commit-receipt@1` | `RealmObservationCheckpointCommitReceiptV1`; same literal format/version | `disposition = committed`, `durableStatus = committed-durable` | `realm-observation-checkpoint@1` / `m3b-reader-original-contract-verifier@1` |
| `particle-realms.realm-observation-ingress-checkpoint@1` | `RealmObservationIngressCheckpointV1`; same literal format/version | exact current committed checkpoint | `realm-observation-checkpoint-owner@1` / `m3b-reader-original-contract-verifier@1` |
| `particle-realms.realm-observation-ingress-recovery-receipt@1#initial-acquisition` | `RealmObservationIngressRecoveryReceiptV1`; `particle-realms.realm-observation-ingress-recovery-receipt@1` | `receiptPhase = initial-acquisition`, `durableStatus = terminal-durable` | `realm-observation-recovery@1` / `m3b-reader-original-contract-verifier@1` |
| `particle-realms.realm-observation-ingress-recovery-receipt@1#recovery` | `RealmObservationIngressRecoveryReceiptV1`; `particle-realms.realm-observation-ingress-recovery-receipt@1` | `receiptPhase = recovery` and the exact disposition-to-durable-status rule | `realm-observation-recovery@1` / `m3b-reader-original-contract-verifier@1` |
| `particle-realms.realm-observation-safe-normalization-profile@1` | `RealmObservationSafeNormalizationProfileV1`; same literal format/version | exact profile bound by the current M3A binding and every copied observation | `realm-observation-normalization-policy-owner@1` / `m3b-reader-original-contract-verifier@1` |
| `particle-realms.m3b-projection-source-state-snapshot@1` | `RealmProjectionSourceStateSnapshotV1`; same literal format/version | exact snapshot returned by this read call | `m3b-restricted-reader-projection@1` / `m3b-reader-escrow-verifier@1` |
| `particle-realms.m3b-m3a-retention-state@1` | `RealmProjectionM3ARetentionStateV1`; same literal format/version | exact retained head/floor state returned by this read call | `m3b-restricted-reader-projection@1` / `m3b-reader-escrow-verifier@1` |

Every reader row uses `bytesRule = embedded-original-bytes`; its
`sourceAuthority` and canonical bytes must match the chosen row, and its own
ID/digest must recompute through the mapped selector and definition. The
observation authority rule uses `ruleKind = intrinsic-field`,
`authorityFieldPath = issuer:sourceAuthority`,
`exactIssuerOwner = realm-observation-ledger@1`, and exactly one condition:
`leftFieldPath = issuer:observationId`, `operatorId = current-at-cut`,
`rightOperandKind = none`, and `rightOperand = null`. Its carrier authority is
byte-identical to the already safe-normalized observation field; it is not
replaced by the ledger owner ID. The producer predicate separately proves exact
membership in the manifest-bound retained batch named by the same read-call
receipt, so a free observation, a different source adapter/kind assignment, or
an observation outside the accepted cut cannot enter the closure.
The
source-state evidence rows are an exact ordered subset of the append,
checkpoint, and two recovery-phase entries above and occur exactly once in the
same escrow. Tick authority equals exactly one such row. No invented terminal-
acquisition, retirement, tick, or normalization record family is allowed.

The recorded-authority escrow subset is disjoint and exactly:

| `evidenceKind` / domain key | Resolved type and wire format | Required producer predicate | Owner / resolver |
| --- | --- | --- | --- |
| `particle-realms.realm-action-authority-receipt@1` | `RealmActionAuthorityReceiptV1`; same literal format/version | receipt exactly named by one recorded authority-domain observation and valid at that recorded cut | `realm-action-authority-owner@1` / `m3b-recorded-authority-original-contract-verifier@1` |
| `particle-realms.signature-envelope@1#recorded-authority` | `SignatureEnvelopeV1`; `particle-realms.signature-envelope@1` | valid signature over that exact authority receipt under the recorded trust epoch | `realm-signature-envelope-issuer@1` / `m3b-recorded-authority-original-contract-verifier@1` |
| `particle-realms.m3b-ref/recorded-authority-trust-root@1` | pinned accepted trust-root definition and catalog-bound wire format/version | exact trust root/epoch used to validate the signature | `realm-authority-trust-root-owner@1` / `m3b-recorded-authority-original-contract-verifier@1` |
| `particle-realms.realm-storylet-action-correlation@1#recorded-authority` | `RealmStoryletActionCorrelationV1`; `particle-realms.realm-storylet-action-correlation@1` | exact correlation receipt required by the recorded authority/result chain | `realm-action-correlation-owner@1` / `m3b-recorded-authority-original-contract-verifier@1` |

These rows also use `embedded-original-bytes`. A reader-escrow kind cannot enter
recorded-authority escrow and an authority kind cannot enter reader escrow.
Every authority evidence row in the input cut resolves to exactly one action-
authority row in this manifest; missing or extra signature, trust, or
correlation closure makes the recorded-batch result `partial-missing` and
ineligible for a cut.

The `static-resolution` subset is exactly three domain keys:

| `recordKind` / domain key | Resolved type | Owner / resolver | Bytes rule and constraint |
| --- | --- | --- | --- |
| `particle-realms.projection-binding@1` | `RealmProjectionBindingV1` | `m2-projection-binding-index-owner@1` / `m2-projection-binding-record-resolver` | embedded original bytes; exact current subject/anchor binding |
| `particle-realms.resource-reference@1#shipped-descriptor` | `ResourceReferenceV1`; `particle-realms.resource-reference@1` | `realm-shipped-descriptor-registry@1` / `m2-shipped-descriptor-resolver` | embedded original bytes; resource kind is one descriptor kind allowed by the binding |
| `particle-realms.resource-reference@1#static-resource` | `ResourceReferenceV1`; `particle-realms.resource-reference@1` | `m2-static-resource-registry@1` / `m2-static-resource-resolver` | embedded original bytes; resource is in the allowed-anchor dependency closure |

Runtime-binding dependency extraction adds one root-copied M2 domain:

| Domain key | Resolved type and exact wire format | Intrinsic selectors | Owner / closure resolver | Producer predicate |
| --- | --- | --- | --- | --- |
| `particle-realms.realm-runtime-capability-profile@1` | `RealmRuntimeCapabilityProfileV1`; `particle-realms.realm-runtime-capability-profile@1` | `profileId` / `profileDigest` | `m2-runtime-capability-owner@1` / `m3b-root-original-contract-verifier@1` | exact accepted current profile named by `m2RuntimeCapabilityProfileId`/digest under the retained M2 selection |

The runtime binding's M3A binding/profile/source-manifest/safe-normalization
dependencies resolve
to the matching reader-escrow rows above and then become root-owned copies. Its
`observationCatalogId`/digest must equal the `accepted-m3a` imported-catalog row
and is classified only as `pinned-import`. Its active bake/layout/static-store/
projection-index dependencies resolve only through the seven M2 target rows.
No one pair may be reclassified between these three dependency roles.

The `protected-closure-root` top-level set is exactly the union of the reader
and recorded-authority escrow domain keys above plus these keys:

```text
particle-realms.m3b-projection-runtime-binding@1
particle-realms.m3b-projection-runtime-profile@1
particle-realms.m3b-contract-catalog-receipt@1
particle-realms.m3b-reference-domain-registry@1
particle-realms.m3b-projection-domain-manifest@1
particle-realms.m3b-projection-disclosure-policy@1
particle-realms.m3b-semantic-axis-transition-policy@1
particle-realms.m3-projection-commit-capability-profile@1
particle-realms.m3b-projection-input-cut@1
particle-realms.m3b-disclosure-decision-set@1
particle-realms.m3b-projection-batch@1
particle-realms.m3b-projection-applied-cursor@1
particle-realms.m3b-dynamic-store-snapshot@1
particle-realms.m3b-ecs-projection-change-set@1
particle-realms.m3b-state-first-source-snapshot@1
particle-realms.m3b-projection-lineage-floor-anchor@1
particle-realms.m3b-reader-evidence-escrow-manifest@1
particle-realms.m3b-projection-read-call-receipt@1
particle-realms.m3b-recorded-authority-escrow-manifest@1
particle-realms.m3b-authority-resolution-receipt@1
particle-realms.m3b-projection-expiry-due-receipt@1
particle-realms.m3b-static-resolution-receipt@1
particle-realms.realm-runtime-capability-profile@1
particle-realms.realm-delta@1
particle-realms.realm-presentation-command@1
particle-realms.projection-binding@1
particle-realms.resource-reference@1#shipped-descriptor
particle-realms.resource-reference@1#static-resource
```

The two imported generic root objects have these exact closure-carrier
descriptor projections; neither may fall through to a generic owner:

| Domain key | `issuerOwner` / closure `sourceAuthority` rule | `requiredResolverKind` | Exact producer predicate |
| --- | --- | --- | --- |
| `particle-realms.realm-delta@1` | `issuerOwner = m3b-declared-projector-set@1`; `ruleKind = fixed-literal`; `authorityFieldPath = carrier:sourceAuthority`; closure `sourceAuthority = m3b-declared-projector-set@1` | `m3b-realm-delta-contract-verifier-then-root-store@1` | The producer predicate has exactly two variants: `primary` requires pair/bytes membership in one primary outcome and verifies `parent:primaryProjectorId` is that observation kind's declared primary owner; `historical-witness` requires pair/bytes membership in one witness outcome and `parent:witnessProjectorId = realm-historical-witness-projector@1`. The parent is exactly the current batch or one prior protected-closure producer-context batch selected by the carry-forward rule; free Delta bytes or a batch with no still-retained citing entry cannot satisfy it. Both variants bind exact operation/domain/ordinal/input-observation closure; maintenance outputs are forbidden |
| `particle-realms.realm-presentation-command@1` | `issuerOwner = m3b-declared-projector-set@1`; `ruleKind = fixed-literal`; `authorityFieldPath = carrier:sourceAuthority`; closure `sourceAuthority = m3b-declared-projector-set@1` | `m3b-presentation-command-recipe-verifier-then-root-store@1` | Two exact producer variants exist. `current-projector-output` requires one command pair in the current batch arrays, complete bytes from the pure projector work product, at least one admitted presentation Delta whose ID-only command reference matches, and a byte-identical trusted-prepare recompilation. `retained-origin` requires the same pair/bytes in verified prior protected closure and a current detach or witness Delta that reuses it. Every listed pair/object is cited; free, unreferenced, conflicting, or multiply resolved commands are forbidden |

For each row, the source-authority and producer-predicate IDs are recomputed
from these exact values using the descriptor-pack domains above; the closure
entry copies the resulting authority and resolver values byte-for-byte. The
closure compiler can copy only already verified original bytes and cannot mint
either imported object.

Registered/local M3B candidate bytes and every recipe-verified
`RealmPresentationCommandV1` use `candidate-bytes-then-root-adopted`;
inherited evidence and `RealmDeltaV1` use `copied-root-original-bytes`. Candidate bytes
are verified by the named pure contract/closure verifier and grant no root-store
ownership. Only successful prepare, application, selector CAS, and selector
readback adopt the byte-identical manifest/object set into the selected root
store. Nested decision, outcome, operation-count, DynamicStore entry, ECS
operation/component/full-overlay, State-First source/dependency, delta-payload,
and presentation-command payload rows remain within their exact parent
canonical bytes; they are never separate closure entries or free `objectKind`
values. The full-overlay component-row contract above closes its parent bytes.
The projection-binding and two qualified resource-reference domains use
`embedded-original-bytes` in static resolution,
`copied-root-original-bytes` in protected closure, and
`m2-resolve-no-bytes` in the target set; those three carrier rules remain
distinct under one domain key and cannot cross.

The separate `m2-target` subset has exactly seven keys:

| `artifactKind` domain key | Intrinsic selectors and revision | Source authority / required resolver |
| --- | --- | --- |
| `particle-realms.m3b-ref/m2-active-bake-output-record@1` | `activeBakeId`, `activeBakeOutputRecordDigest`, `activeBakeRevision` | `m2-active-bake-owner@1` / `m2-active-bake-output-resolver` |
| `particle-realms.realm-spatial-layout-receipt@1` | `layoutReceiptId`, `layoutDigest`, literal revision `1` | `realm-spatial-layout-owner@1` / `m2-spatial-layout-receipt-resolver` |
| `particle-realms.m3b-ref/m2-static-store-snapshot@1` | `staticStoreSnapshotId`, `staticStoreSnapshotDigest`, literal revision `1` | `m2-static-store-owner@1` / `m2-static-store-snapshot-resolver` |
| `particle-realms.m3b-ref/m2-projection-binding-index@1` | `projectionBindingIndexId`, `projectionBindingIndexDigest`, literal revision `1` | `m2-projection-binding-index-owner@1` / `m2-projection-binding-index-resolver` |
| `particle-realms.projection-binding@1` | intrinsic `resourceId`, intrinsic `projectionBindingDigest`, literal revision `1` | `m2-projection-binding-index-owner@1` / `m2-projection-binding-record-resolver` |
| `particle-realms.resource-reference@1#shipped-descriptor` | intrinsic `resourceId`, intrinsic `contentId`, literal revision `1` | `realm-shipped-descriptor-registry@1` / `m2-shipped-descriptor-resolver` |
| `particle-realms.resource-reference@1#static-resource` | intrinsic `resourceId`, intrinsic `contentId`, literal revision `1` | `m2-static-resource-registry@1` / `m2-static-resource-resolver` |

These rows use `m2-resolve-no-bytes`. The pure closure walk emits their tuples
directly as canonical eight-field target rows, not to a second wire accumulator,
protected-closure `entryRows`, or either closure object-byte array. The target-
set tuple and resolver must equal one emitted row exactly; target order is the code-point order of
`(artifactKind, artifactId, artifactDigest)` followed by ascending numeric
`artifactRevision`. Revision is always a positive JavaScript-safe integer,
encoded as a canonical JSON number with no string or leading-zero form. Unknown kinds,
duplicate/conflicting tuples, an ineligible/noncurrent M2 artifact, a mismatched
source authority/resolver, or a target not emitted by the walk fail. A
presentation command is root-owned and never an M2 lease target.

After merging identical domain keys, the registry has exactly 50 `domainRows`
and exactly 78 carrier-rule rows: 4 `source-state`, 14 `reader-escrow`, 4
`recorded-authority-escrow`, 3 `static-resolution`, 46
`protected-closure-root`, and 7 `m2-target`. The protected closure's exact 46
`objectKind` values are the 14 reader keys, four authority keys, and 28 explicit
additional keys in the code block above. The source-state keys are a subset of
the reader keys; the three static keys also occur in closure and M2 target; the
remaining four M2 target keys occur nowhere else. These cardinalities and the
dense zero-based orders are canonical registry-vector inputs, not commentary.

### Exact non-protected source-matrix expansion

The following normalized tables are normative inputs to the source-matrix
writer; they are not shorthand interpreted by the runtime. In a condition list,
each displayed tuple is exactly
`[leftFieldPath, operatorId, rightOperandKind, rightOperand]`; its array index is
`conditionOrder`, and the compiler adds only the already defined domain-
separated `rowDigest`. `I/D` means two consecutive conditions with the displayed
ID path first and digest path second. Each table row creates one
producer-predicate variant per displayed variant ID and materializes one literal
five-string consumer-edge tuple per variant:

```text
(domainKey, carrierKind, exactIssuerOwner,
 consumerMethodOrArtifactId, variantId)
```

The source JSON stores normalized carrier/producer seeds and the nine exact
recovery-disposition rows; it does not store `I/D`, a range, a wildcard, or this
Markdown notation. Every displayed `I/D` becomes two explicit four-field
condition seeds. The only multirow `expansionSet` is the closed recovery set;
the compiler materializes every variant and its direct five-string tuple before
deriving an edge ID. Rule/predicate orders are then the global zero-based code-
point sort of `(domainKey, carrierKind)`, and variant/condition orders are the
displayed order. The compiler asserts the
non-protected subtotal of 32 authority rows, 32 predicate rows, 60 variants, and
60 consumer-edge tuples before joining the protected-closure rows.

For the four `source-state` rows, `carrierKind = source-state`,
`bytesRule = pair-only`, `ruleKind =
not-carried-but-resolver-must-prove`, `authorityFieldPath = none`, authority
conditions are empty, and `requiredResolverKind =
m3b-source-state-evidence-escrow-resolver@1`. The two fixed consumer artifact
IDs are `particle-realms.m3b-projection-source-state-snapshot@1` for every
`state-evidence*` variant and
`particle-realms.m3b-projection-expiry-due-receipt@1` for every
`tick-authority*` variant.

| Domain / exact issuer owner | Exact producer variants and ordered conditions |
| --- | --- |
| `particle-realms.realm-observation-ingress-checkpoint@1` / `realm-observation-checkpoint-owner@1` | `state-evidence`: issuer `checkpointId/checkpointDigest` respectively `member-of-field` parent `stateEvidenceIds/stateEvidenceDigests`, then issuer `checkpointId current-at-cut`; `tick-authority`: issuer `checkpointId/checkpointDigest` respectively `equals-field` parent `tickAuthorityEvidenceId/tickAuthorityEvidenceDigest`, issuer `committedLogicalTick equals-field parent:logicalTick`, then issuer `checkpointId current-at-cut` |
| `particle-realms.realm-observation-ingress-recovery-receipt@1#initial-acquisition` / `realm-observation-recovery@1` | `state-evidence`: issuer `receiptId/receiptDigest` membership in the two parent evidence arrays, then `issuer:receiptPhase equals initial-acquisition`, `issuer:durableStatus equals terminal-durable`, and issuer `receiptId current-at-cut`; `tick-authority`: issuer pair equals the parent tick-authority pair, `issuer:completedLogicalTick equals-field parent:logicalTick`, the same phase/status conditions, then issuer `receiptId current-at-cut` |
| `particle-realms.realm-observation-ledger-append-receipt@1` / `realm-observation-ledger@1` | `state-evidence`: issuer `receiptId/receiptDigest` membership in the two parent evidence arrays, then `issuer:disposition equals committed`, `issuer:durableStatus equals committed-durable`, and issuer `receiptId current-at-cut`; `tick-authority`: issuer pair equals the parent tick-authority pair, `issuer:issuedLogicalTick equals-field parent:logicalTick`, the same disposition/status conditions, then issuer `receiptId current-at-cut` |
| `particle-realms.realm-observation-ingress-recovery-receipt@1#recovery` / `realm-observation-recovery@1` | For each of the nine exact imported recovery rows below, one `state-evidence-{disposition}` variant uses issuer pair membership in the parent evidence arrays, `receiptPhase = recovery`, the row's exact disposition/status literals, and issuer `receiptId current-at-cut`; one `tick-authority-{disposition}` variant instead requires issuer pair equality with the parent tick pair, `completedLogicalTick equals-field parent:logicalTick`, the same phase/disposition/status literals, and issuer `receiptId current-at-cut` |

The nine recovery expansion rows are literal and ordered as follows:

| Variant suffix | Exact status |
| --- | --- |
| `gap-detected` | `detection-durable` |
| `overflow-detected` | `detection-durable` |
| `source-changed` | `detection-durable` |
| `source-unavailable` | `detection-durable` |
| `snapshot-opened` | `opening-durable` |
| `resume-opened` | `opening-durable` |
| `recovered` | `recovered-durable` |
| `quarantined` | `terminal-durable` |
| `abandoned` | `terminal-durable` |

For source-state membership, the resolver additionally proves that kind, ID,
and digest occupy one correlated array index. For changed-idle tick selection it
proves the greatest mapped tick with the frozen kind-order/ID tie break. Those
are mandatory resolver invariants because the V1 condition operator set cannot
express correlated parallel-array indexing or `arg max`; they are not omitted
or replaced by host-language logic.

For the 14 reader rows, `carrierKind = reader-escrow`, `bytesRule =
embedded-original-bytes`, the consumer is
`particle-realms.m3b-reader-evidence-escrow-manifest@1`, and every listed
variant is `admitted` except the recovery expansion. Conditions name the exact
eight-field escrow row as `carrier`, its manifest as `parent`, original bytes as
`issuer`, and the 53-field runtime binding as `binding`.

| Domain / exact issuer owner / resolver | Exact ordered producer conditions |
| --- | --- |
| `particle-realms.realm-observation-ingress-binding@1` / `realm-observation-binding-owner@1` / `m3b-reader-original-contract-verifier@1` | carrier `evidenceId/evidenceDigest` equals binding `m3aBindingReceiptId/m3aBindingDigest`; carrier ID current-at-cut |
| `particle-realms.realm-observation-ingress-profile@1` / `realm-observation-profile-registry@1` / same resolver | carrier pair equals binding `observationProfileId/observationProfileDigest` |
| `particle-realms.realm-observation-source-manifest@1` / `realm-observation-source-manifest-registry@1` / same resolver | carrier pair equals binding `sourceManifestId/sourceManifestDigest` |
| `particle-realms.realm-observation-batch@1` / `realm-observation-ledger@1` / same resolver | carrier pair equals parent `observationBatchId/observationBatchDigest`; carrier ID current-at-cut |
| `particle-realms.realm-observation@1` / `realm-observation-ledger@1` / same resolver | carrier pair equals issuer `observationId/observationDigest`; carrier ID current-at-cut; resolver proves exact retained-batch membership |
| `particle-realms.realm-observation-ledger-append-receipt@1` / `realm-observation-ledger@1` / same resolver | `issuer:disposition = committed`; `issuer:durableStatus = committed-durable`; carrier ID current-at-cut |
| `particle-realms.m3b-ref/m3a-ledger-head-receipt@1` / `realm-observation-ledger-head-owner@1` / same resolver | carrier ID current-at-cut; carrier digest recomputes; resolver proves the exact head/append/cut join |
| `particle-realms.realm-observation-checkpoint-commit-receipt@1` / `realm-observation-checkpoint@1` / same resolver | `issuer:disposition = committed`; `issuer:durableStatus = committed-durable`; carrier ID current-at-cut |
| `particle-realms.realm-observation-ingress-checkpoint@1` / `realm-observation-checkpoint-owner@1` / same resolver | carrier ID current-at-cut; carrier digest recomputes; resolver proves the source-snapshot-selected committed checkpoint |
| `particle-realms.realm-observation-ingress-recovery-receipt@1#initial-acquisition` / `realm-observation-recovery@1` / same resolver | `issuer:receiptPhase = initial-acquisition`; `issuer:durableStatus = terminal-durable`; carrier ID current-at-cut |
| `particle-realms.realm-observation-ingress-recovery-receipt@1#recovery` / `realm-observation-recovery@1` / same resolver | One `admitted-{disposition}` variant for each nine-row expansion above: `receiptPhase = recovery`, exact disposition, exact mapped durable status, carrier ID current-at-cut |
| `particle-realms.realm-observation-safe-normalization-profile@1` / `realm-observation-normalization-policy-owner@1` / same resolver | carrier pair equals binding `safeNormalizationProfileId/safeNormalizationProfileDigest`; resolver proves every copied observation uses it |
| `particle-realms.m3b-projection-source-state-snapshot@1` / `m3b-restricted-reader-projection@1` / `m3b-reader-escrow-verifier@1` | carrier pair equals parent `sourceStateSnapshotId/sourceStateSnapshotDigest`; `issuer:runtimeBindingId/runtimeBindingDigest` equals binding `bindingId/bindingDigest` |
| `particle-realms.m3b-m3a-retention-state@1` / `m3b-restricted-reader-projection@1` / same resolver | carrier pair equals parent `retentionStateId/retentionStateDigest`; `issuer:m3aBindingReceiptId/m3aBindingDigest` equals binding fields of the same names |

The first 13 non-observation reader authority rules are `fixed-literal` at
`carrier:sourceAuthority`, with the displayed owner and empty authority
conditions. The observation row alone is `intrinsic-field` at
`issuer:sourceAuthority`; its carrier value must copy that field, its canonical
issuer object is owned/admitted by `realm-observation-ledger@1`, and its sole
authority condition is
`[issuer:observationId, current-at-cut, none, null]`. These authority conditions
are separate from producer conditions and use their separate digest domain.

For the four recorded-authority rows, `carrierKind =
recorded-authority-escrow`, `bytesRule = embedded-original-bytes`, every
authority rule is `fixed-literal` at `carrier:sourceAuthority` with the exact
owner below and empty authority conditions, and every producer has the common
conditions `carrier:evidenceId current-at-cut` then
`carrier:evidenceDigest digest-recomputes`. The consumer is
`particle-realms.m3b-recorded-authority-escrow-manifest@1`.

| Domain / exact issuer owner | Exact variant ID and mandatory resolver join |
| --- | --- |
| `particle-realms.realm-action-authority-receipt@1` / `realm-action-authority-owner@1` | `observation-named-at-recorded-cut`; exactly one bound authority query/evidence row names this receipt, and a current-only live-grant receipt is forbidden |
| `particle-realms.signature-envelope@1#recorded-authority` / `realm-signature-envelope-issuer@1` | `receipt-signature-valid-at-recorded-cut`; the signature covers that exact authority receipt under the recorded epoch |
| `particle-realms.m3b-ref/recorded-authority-trust-root@1` / `realm-authority-trust-root-owner@1` | `signature-trust-root-at-recorded-cut`; this exact root/epoch validates that envelope |
| `particle-realms.realm-storylet-action-correlation@1#recorded-authority` / `realm-action-correlation-owner@1` | `recorded-action-chain-correlation`; this exact correlation belongs to the same recorded decision/dispatch/result chain |

All four use resolver
`m3b-recorded-authority-original-contract-verifier@1`. The resolver performs the
cross-object join because the escrow parent intentionally exposes only the
aggregate `resolutionRowsDigest`; an implementation may not invent nonexistent
parent pair fields.

For the three static rows, `carrierKind = static-resolution`, `bytesRule =
embedded-original-bytes`, authority is
`not-carried-but-resolver-must-prove` at `none` with empty authority conditions,
and each has one `resolved-at-cut` producer variant with carrier
`recordId current-at-cut` then `recordDigest digest-recomputes`. The consumer is
`particle-realms.m3b-static-resolution-receipt@1`.

| Domain / owner / resolver | Mandatory resolver join |
| --- | --- |
| `particle-realms.projection-binding@1` / `m2-projection-binding-index-owner@1` / `m2-projection-binding-record-resolver` | exact current subject/anchor binding |
| `particle-realms.resource-reference@1#shipped-descriptor` / `realm-shipped-descriptor-registry@1` / `m2-shipped-descriptor-resolver` | descriptor kind is allowed by that binding |
| `particle-realms.resource-reference@1#static-resource` / `m2-static-resource-registry@1` / `m2-static-resource-resolver` | resource is in the allowed-anchor dependency closure |

`complete` versus `partial-missing` is a static-resolution result state, not a
per-row producer variant; both results contain only verified present rows.

For the seven M2-target rows, `carrierKind = m2-target`, `bytesRule =
m2-resolve-no-bytes`, authority is `not-carried-but-resolver-must-prove` at
`none` with empty authority conditions, and the consumer is
`particle-realms.m3b-m2-static-artifact-lease-target-set@1`.

| Domain / owner / resolver | Exact variant and ordered conditions |
| --- | --- |
| `particle-realms.m3b-ref/m2-active-bake-output-record@1` / `m2-active-bake-owner@1` / `m2-active-bake-output-resolver` | `binding-selected`: carrier `artifactId/artifactDigest` equals binding `activeBakeId/activeBakeOutputRecordDigest`; `artifactRevision generation-equals binding:activeBakeRevision` |
| `particle-realms.m3b-ref/m2-projection-binding-index@1` / `m2-projection-binding-index-owner@1` / `m2-projection-binding-index-resolver` | `binding-selected`: carrier pair equals binding `projectionBindingIndexId/projectionBindingIndexDigest`; revision equals literal `1` |
| `particle-realms.m3b-ref/m2-static-store-snapshot@1` / `m2-static-store-owner@1` / `m2-static-store-snapshot-resolver` | `binding-selected`: carrier pair equals binding `staticStoreSnapshotId/staticStoreSnapshotDigest`; revision equals literal `1` |
| `particle-realms.realm-spatial-layout-receipt@1` / `realm-spatial-layout-owner@1` / `m2-spatial-layout-receipt-resolver` | `binding-selected`: carrier pair equals binding `spatialLayoutReceiptId/spatialLayoutReceiptDigest`; revision equals literal `1` |
| `particle-realms.projection-binding@1` / `m2-projection-binding-index-owner@1` / `m2-projection-binding-record-resolver` | `walk-emitted-at-cut`: carrier ID current-at-cut; digest recomputes; revision equals literal `1` |
| `particle-realms.resource-reference@1#shipped-descriptor` / `realm-shipped-descriptor-registry@1` / `m2-shipped-descriptor-resolver` | `walk-emitted-at-cut`: carrier ID current-at-cut; digest recomputes; revision equals literal `1` |
| `particle-realms.resource-reference@1#static-resource` / `m2-static-resource-registry@1` / `m2-static-resource-resolver` | `walk-emitted-at-cut`: carrier ID current-at-cut; digest recomputes; revision equals literal `1` |

The four `binding-selected` rows require exact binding equality. For the three
`walk-emitted-at-cut` rows, the kind-specific resolver plus frozen dependency
extractor proves current binding membership, allowed shipped kind, or allowed-
anchor dependency membership; no nonexistent generic parent field is invented.

### Exact protected-closure source-matrix expansion

The protected-closure carrier has exactly these 46 global `carrierOrder`
values; they are the code-point-sorted carrier rows, not local table indices:

```text
0,1,2,3,4,5,6,8,9,10,11,12,13,14,15,16,17,18,20,21,25,27,
29,30,31,32,34,36,38,39,41,43,45,48,50,53,56,59,61,63,65,66,
68,71,74,76
```

These 41 carrier orders have one `admitted` singleton producer seed and one
direct edge to
`particle-realms.m3b-projection-protected-closure-manifest@1`:

```text
0,1,2,3,4,5,6,8,10,11,12,13,14,16,17,18,20,21,25,27,29,30,
31,32,34,36,43,45,48,50,53,56,59,61,63,65,66,68,71,74,76
```

Their source-only producer endpoint is `exact-issuer-owner`; the compiler must
replace that sentinel with the row's literal `exactIssuerOwner` before deriving
the edge and never emits the sentinel. The other five carrier rows expand to
exactly these ten variants:

| Carrier order / domain | Variant | Resolved producer endpoint |
| --- | --- | --- |
| `9` / projection batch | `current` | exact issuer owner |
| `9` / projection batch | `historical-carry` | `m3b-selector-root-store@1` |
| `15` / projection read-call receipt | `current` | exact issuer owner |
| `15` / projection read-call receipt | `historical-carry` | `m3b-selector-root-store@1` |
| `38` / `RealmDeltaV1` | `primary` | `m3b-declared-projector-set@1` |
| `38` / `RealmDeltaV1` | `historical-witness` | `realm-historical-witness-projector@1` |
| `39` / M3A observation batch | `current` | exact issuer owner |
| `39` / M3A observation batch | `historical-carry` | `m3b-selector-root-store@1` |
| `41` / `RealmPresentationCommandV1` | `current-projector-output` | `m3b-declared-projector-set@1` |
| `41` / `RealmPresentationCommandV1` | `retained-origin` | `m3b-selector-root-store@1` |

The 14 reader-escrow objects copied into closure use `parent-field` at
`parent:sourceAuthority`, exact parent owner
`m3b-reader-escrow-service@1`, and exactly one condition
`[parent:rowDigest, digest-recomputes, none, null]`. The four recorded-authority
escrow objects use the same rule shape with exact parent owner
`m3b-recorded-authority-escrow-service@1`. Their resolvers prove exact
membership in the bound enclosing escrow; a free row or another manifest cannot
satisfy the condition. The remaining 28 protected rows use `fixed-literal`
authority with the exact per-domain issuer owner frozen in their source rows.
The three static copies preserve their original exact owner and use their
kind-specific root-copy verifier.

The static-resolution receipt's single `admitted` predicate has one closed
`status-allows-edge` condition whose operand is exactly `[ready, missing]`; its
resolver additionally enforces `ready -> complete` and
`missing -> partial-missing`. The three static record predicates admit only
verified present `recordRows` membership under either matched variant. Widening
this existing condition creates no second variant or edge: the source retains
one static-receipt seed and one seed for each static-record domain.

Registered/local candidate bytes and recipe-verified presentation commands use
`candidate-bytes-then-root-adopted`. Inherited evidence, runtime capability,
`RealmDeltaV1`, and the three static records use
`copied-root-original-bytes`. This expansion
has exactly 46 carrier rows, 51 producer seeds, 51 producer variants, and 51
direct edge tuples. Joined with the non-protected expansion, the complete source
matrix has exactly 78 carrier rows, 87 producer seeds, 111 producer variants,
and 111 direct carrier-admission edge tuples.

For every extracted dependency occurrence, the bound extractor descriptor marks
that occurrence's role as exactly `root-object`, `m2-target`, or
`pinned-import`. `root-object` must resolve exactly one matching manifest entry;
`m2-target` must resolve exactly one matching target row. One occurrence cannot
match both. The same projection-binding or resource-reference identity may be
emitted twice only when the frozen extractor declares two separately ordered
occurrences, one `root-object` copy and one `m2-target`; each occurrence resolves
only through its declared carrier rule and neither can satisfy the other.
`pinned-import` is legal only for the three registry catalog rows and resolves
through the nonretiring code-shipped catalog root that was read back before
registry issuance; those catalog receipt bytes are validation anchors, not
root-owned evidence or lease targets. Zero, multiple, wrong-role, or crossed
matches fail. Unlisted nested arrays remain parent-contained and cannot become
entries. This closes generic `dependencyIds`/`dependencyDigests` without adding
a caller-selected kind or allowing a same-shaped cross-domain pair.

### Closed cross-method reference domains

An ID/digest pair is not structurally interchangeable with another pair. The
table below closes every port/service reference pair and every renamed service-
artifact carrier issued by one M3B method/owner and consumed by another method
or terminal evidence builder, plus pair-only correlation receipts whose non-
consumability must be explicit. Registered-contract references that retain their
intrinsic field names remain closed by their exact definition/variant sections
and are not duplicated here; any renamed registered or local carrier is listed.
The six generic heterogeneous carrier field families and generic closure
`dependencyIds`/`dependencyDigests` are closed exclusively by the pinned
registry/subset tables above. Named dependency aliases that cross artifact
boundaries are also summarized below; each summary must project to the byte-
identical pack edge and does not create a second consumer edge. This table is
exhaustive for every remaining cross-method pair and renamed alias.
“Bytes cross” means canonical
issuer bytes appear directly or nested in an allowed port request or result; the
row names the direction and carrier. `no` means the
app receives only the pair and the named prebound resolver must retrieve and
recompute the issuer-owned bytes. An alias changes only the field name at the
consumer edge, never the ID, digest, reference domain, owner, or bytes.

| Canonical pair and exact aliases | Issuer / owner | Reference domain | Bytes cross | Resolver | Only legal producer -> consumer edges |
| --- | --- | --- | --- | --- | --- |
| schema `bindingId`/`bindingDigest`; universal port carrier `runtimeBindingId`/`runtimeBindingDigest`; transition aliases `priorRuntimeBindingId`/`priorRuntimeBindingDigest` and `successorRuntimeBindingId`/`successorRuntimeBindingDigest` | trusted composition root | `particle-realms.m3b-projection-runtime-binding@1` | yes as `runtimeBindingBytes` on context `openSession/opened` and `capture/ready`; later direct fields carry the pair only, while the byte-identical binding is also one `candidateClosureObjectBytes`/`protectedClosureObjectBytes` entry and later nested in `priorStateBundleBytes` | trusted composition root | `openSession/opened` or same-session `capture/ready` -> all three facets and every later request/result/artifact for that session; transition aliases are legal only in the reviewed predecessor/successor descriptor/receipt, and no cross-role or cross-session substitution is legal |
| schema `profileId`/`profileDigest`; binding alias `m3bProfileId`/`m3bProfileDigest` | contract profile compiler | `particle-realms.m3b-projection-runtime-profile@1` | yes only as its own candidate/protected-closure object bytes; runtime binding/root carry the pair only | profile verifier | exact registered profile -> runtime binding/root closure only; no request or runtime state can widen it |
| schema `manifestId`/`manifestDigest`; carrier `domainManifestId`/`domainManifestDigest` | domain-manifest compiler | `particle-realms.m3b-projection-domain-manifest@1` | yes only as its own candidate/protected-closure object bytes; profile/binding/batch/root carry the pair only | manifest verifier | exact registered manifest -> profile, binding, projection batch, root, and protected closure only |
| schema `policyId`/`policyDigest`; carrier `disclosurePolicyId`/`disclosurePolicyDigest` | disclosure-policy compiler | `particle-realms.m3b-projection-disclosure-policy@1` | yes only as its own candidate/protected-closure object bytes; profile/binding/decision/batch/root carry the pair only | disclosure-policy verifier | exact registered policy -> profile, binding, decision set, batch, root, and protected closure only |
| schema `policyId`/`policyDigest`; binding/policy carrier `semanticAxisTransitionPolicyId`/`semanticAxisTransitionPolicyDigest` | shared pure semantic verifier | `particle-realms.m3b-semantic-axis-transition-policy@1` | yes only as its own candidate/protected-closure object bytes; policy/binding carry the pair only | shared pure semantic verifier | code-shipped policy -> disclosure policy/runtime binding and both app/trusted verification paths only; never runtime-authored state |
| schema `profileId`/`profileDigest`; binding alias `projectionCommitCapabilityProfileId`/`projectionCommitCapabilityProfileDigest` | trusted composition root | `particle-realms.m3-projection-commit-capability-profile@1` | yes only as its own candidate/protected-closure object bytes; runtime binding carries the pair only | trusted commit-capability verifier | code-shipped capability profile -> runtime binding, derived ceilings, trusted prepare/commit/recovery/teardown only; no app-supplied widening |
| schema `catalogId`/`catalogDigest`; aliases `m3bCatalogId`/`m3bCatalogDigest` and `contractCatalogId`/`contractCatalogDigest` | existing contract registry | `particle-realms.m3b-contract-catalog-receipt@1` | yes only as its own candidate/protected-closure object bytes; binding/batch/root carry the pair only | existing contract registry | one exact 16-definition/18-module registered catalog -> binding, batch, root, and protected closure; no partial or cross-catalog substitution |
| schema `referenceDomainRegistryId`/`registryDigest`; catalog-receipt alias `referenceDomainRegistryId`/`referenceDomainRegistryDigest` | reference-domain registry compiler | `particle-realms.m3b-reference-domain-registry@1` | yes only as its own candidate/protected-closure bytes; catalog receipt carries the pair | reference-domain registry verifier, then selected root store | exact registered three-import/50-domain/78-carrier registry -> M3B catalog receipt and protected closure only; the pair never substitutes for a catalog or capability |
| schema `profileId`/`profileDigest`; runtime/baseline alias `m2RuntimeCapabilityProfileId`/`m2RuntimeCapabilityProfileDigest` | accepted M2 runtime-capability owner | `particle-realms.realm-runtime-capability-profile@1` | yes only as its copied root-owned closure object; runtime binding/static baseline carry the pair | M2 runtime-capability resolver before copy, then selected root store | exact accepted current profile under the retained M2 selection -> runtime binding, empty baseline, and protected closure only |
| `activeBakeId`/`activeBakeOutputRecordDigest` plus `activeBakeRevision` | accepted M2 bake owner | `particle-realms.m3b-ref/m2-active-bake-output-record@1` | no | `m2-active-bake-output-resolver` | exact current active-bake tuple -> runtime binding, static receipt/empty baseline, M2 target set, and covering lease only |
| schema `layoutReceiptId`/`layoutDigest`; runtime/static/baseline/target alias `spatialLayoutReceiptId`/`spatialLayoutReceiptDigest` | accepted layout owner | `particle-realms.realm-spatial-layout-receipt@1` | no | `m2-spatial-layout-receipt-resolver` | exact layout receipt under the active bake/selection -> runtime binding, static receipt/empty baseline, M2 target set, and covering lease only |
| `staticStoreSnapshotId`/`staticStoreSnapshotDigest` | accepted M2 static-store owner | `particle-realms.m3b-ref/m2-static-store-snapshot@1` | no | `m2-static-store-snapshot-resolver` | exact current immutable static-store snapshot -> runtime binding, static receipt/empty baseline, M2 target set, and covering lease only |
| `projectionBindingIndexId`/`projectionBindingIndexDigest` | accepted M2 projection-index owner | `particle-realms.m3b-ref/m2-projection-binding-index@1` | no | `m2-projection-binding-index-resolver` | exact current projection-binding index under the same static-store snapshot -> runtime binding, static resolution/empty baseline, M2 target set, and covering lease only |
| schema `resourceId`/`projectionBindingDigest`; projection-batch array alias `staticBindingIds`/`staticBindingDigests` | accepted M2 projection-binding index owner | `particle-realms.projection-binding@1` | yes as `recordRows[].canonicalBytes` on `resolveStatic/ready,missing`; every verified present row from either exact status/disposition variant is copied as its matching `candidateClosureObjectBytes`/`protectedClosureObjectBytes` entry; `staticResolutionReceiptBytes`, projection-batch arrays, and M2 target rows carry references only | `m2-projection-binding-record-resolver`, then selected root store | exact verified present static-resolution binding row -> observation-batch static-binding arrays/protected closure and separately qualified M2 target; arrays are equal-length, pair-indexed, code-point-sorted unique; missing subjects contribute no pair, anchor, copied object, or lease target |
| schema `bindingReceiptId`/`bindingDigest`; carriers `m3aBindingReceiptId`/`m3aBindingDigest` | M3A portable binding owner | `particle-realms.realm-observation-ingress-binding@1` | yes in reader escrow/protected closure; runtime binding, reader results, source/retention state carry the pair | M3A binding resolver before copy, then selected root store | exact current portable M3A binding -> runtime binding and reader `captureNext/ready,source-state-ready,idle`; the same pair enters source/retention evidence and reader escrow/root closure, and no stale/retired binding can substitute |
| schema `profileId`/`profileDigest`; runtime-binding alias `observationProfileId`/`observationProfileDigest` | accepted M3A profile registry | `particle-realms.realm-observation-ingress-profile@1` | yes in reader escrow/protected closure; runtime binding carries the pair | M3A profile registry before copy, then selected root store | exact profile named by the current M3A binding -> runtime binding, reader escrow, and protected closure only |
| schema `m3aContractCatalogId`/`m3aContractCatalogDigest`; runtime alias `observationCatalogId`/`observationCatalogDigest` | accepted M3A contract registry | `particle-realms.m3b-ref/m3a-observation-contract-catalog@1` | no | pinned `accepted-m3a` imported-catalog row | exact accepted M3A catalog pair -> runtime binding as `pinned-import` only; it is never copied evidence, an M3B catalog, or a capability |
| `sourceManifestId`/`sourceManifestDigest` | accepted M3A source-manifest registry | `particle-realms.realm-observation-source-manifest@1` | yes in reader escrow/protected closure; runtime binding carries the pair | M3A source-manifest registry before copy, then selected root store | exact seven-source manifest named by the current M3A binding -> runtime binding, reader escrow, and protected closure only |
| schema `profileId`/`profileDigest`; runtime-binding alias `safeNormalizationProfileId`/`safeNormalizationProfileDigest` | M3A normalization-policy owner | `particle-realms.realm-observation-safe-normalization-profile@1` | yes in reader escrow/protected closure; runtime binding carries the pair | M3A normalization-policy owner before copy, then selected root store | exact profile named by the current M3A binding -> runtime binding, copied observations, reader escrow, and protected closure only |
| schema `inputCutId`/`cutDigest`; carrier `inputCutId`/`inputCutDigest` | input-cut compiler | `particle-realms.m3b-projection-input-cut@1` | yes in candidate/protected-closure bytes | input-cut verifier plus selected root store | verified reader/static/authority evidence -> one input cut -> decision set, batch, intent, root, and selected protected closure only |
| schema `decisionSetId`/`decisionSetDigest`; carrier `disclosureDecisionSetId`/`disclosureDecisionSetDigest` | disclosure compiler | `particle-realms.m3b-disclosure-decision-set@1` | yes in candidate/protected-closure bytes | disclosure verifier plus selected root store | one accepted input cut -> decision set -> projection batch/root closure only |
| schema `projectionBatchId`/`batchDigest`; carriers `projectionBatchId`/`projectionBatchDigest` and `lastProjectionBatchId`/`lastProjectionBatchDigest` | projection-batch compiler | `particle-realms.m3b-projection-batch@1` | yes in candidate/protected-closure bytes | projection-batch verifier plus selected root store | current accepted decision/projector outputs -> batch -> applied cursor/root/intent; only the exact applied cursor may use the last-batch alias. Historical-carry variant: a verified prior selected manifest batch -> successor closure only when an exact retained-entry Delta reachability rule selects it, together with its unique matching historical observation-batch read-call receipt/escrow; it cannot become the current batch or be retained freely |
| schema `snapshotId`/`snapshotDigest`; carriers `priorDynamicStoreSnapshotId`/`priorDynamicStoreSnapshotDigest`, `dynamicStoreSnapshotId`/`dynamicStoreSnapshotDigest`, and `candidateDynamicStoreSnapshotId`/`candidateDynamicStoreSnapshotDigest` | pure DynamicStore reducer | `particle-realms.m3b-dynamic-store-snapshot@1` | yes in candidate/protected-closure bytes | DynamicStore verifier plus selected root store | verified prior snapshot + batch/maintenance cut -> candidate snapshot -> ECS/State-First/root/intent/application; prior/current/candidate roles cannot cross |
| schema `changeSetId`/`changeSetDigest`; carriers `ecsChangeSetId`/`ecsChangeSetDigest` and `candidateEcsChangeSetId`/`candidateEcsChangeSetDigest` | pure ECS overlay compiler | `particle-realms.m3b-ecs-projection-change-set@1` | yes in candidate/protected-closure bytes | ECS change-set verifier plus selected root store | verified full DynamicStore result -> candidate full ECS overlay -> root/intent/application/selected bundle only |
| schema `sourceSnapshotId`/`sourceSnapshotDigest`; carriers `stateFirstSourceSnapshotId`/`stateFirstSourceSnapshotDigest` and `candidateStateFirstSourceSnapshotId`/`candidateStateFirstSourceSnapshotDigest` | pure State-First source compiler | `particle-realms.m3b-state-first-source-snapshot@1` | yes in candidate/protected-closure bytes | State-First snapshot verifier plus selected root store | verified full DynamicStore/ECS result -> candidate semantic source -> root/intent/application/selected bundle only |
| `resultId`/`resultDigest`, additionally qualified by exact `canonicalRequestDigest` and envelope `status` | called port facet | exact descriptor `resultDomainId = particle-realms.m3b-port-result/{portName}/{methodId}@1` | yes as the complete eight-key result envelope plus its exact payload union | called port facet | one call -> caller correlation/idempotent replay only; no result pair is accepted as another port, method, request, status, receipt, capability, or later request authority |
| `sessionReceiptId`/`sessionReceiptDigest` | context session owner | `particle-realms.m3b-ref/session-receipt@1` | no | context session owner | context `openSession/opened` -> every later request row that declares the session pair |
| `prepareId`/`prepareDigest`; discriminator-qualified application-phase alias `referencedEvidenceId`/`referencedEvidenceDigest` only for `phaseKind = prepare-readback` | trusted commit prepare store | `particle-realms.m3b-ref/prepare-readback-receipt@1` | no | commit prepare store | commit `prepare/prepared` -> application-phase `prepare-readback` evidence and commit `commit` only |
| reader `reassertReceiptId`/`reassertReceiptDigest` | restricted reader | `particle-realms.m3b-ref/reader-reassert-receipt@1` | no | restricted reader | reader `reassert/current,changed,unavailable,retired` -> caller correlation only; no M3B request consumes it |
| context `reassertReceiptId`/`reassertReceiptDigest` | context evidence join | `particle-realms.m3b-ref/context-reassert-receipt@1` | no | context evidence join | context `reassert/current,changed,unavailable,retired` -> caller correlation only; no M3B request consumes it |
| reader `closeReceiptId`/`closeReceiptDigest`; alias `readerCloseReceiptId`/`readerCloseReceiptDigest` | restricted reader teardown owner | `particle-realms.m3b-ref/reader-close-receipt@1` | no | restricted reader | reader `close/closed,already-closed` -> context `closeSession` and disposal builder |
| `commitCloseReceiptId`/`commitCloseReceiptDigest` | commit teardown owner | `particle-realms.m3b-ref/commit-close-receipt@1` | no | commit service | commit `close/closed,already-closed` -> context `closeSession` and disposal builder |
| `contextCloseReceiptId`/`contextCloseReceiptDigest` | context teardown owner | `particle-realms.m3b-ref/context-close-receipt@1` | no | context service | context `closeSession/closed,already-closed` -> context `close` idempotent result and disposal builder |
| `extensionReleaseReceiptId`/`extensionReleaseReceiptDigest` | WebGPU OS extension owner | `particle-realms.m3b-ref/extension-release-receipt@1` | no | extension owner | context `closeSession/closed,already-closed` -> disposal builder only |
| `wakeReceiptId`/`wakeReceiptDigest` | context wake service | `particle-realms.m3b-ref/wake-receipt@1` | no | context wake service | context `waitForWake/batch-available,source-state-changed,authority-state-changed,authority-expiry-due,expiry-due,artifact-lease-changed,presentation-changed,binding-changed,timeout` -> caller correlation only; `invalid` and `closed` never issue the pair, and no durable identity or later request consumes it |
| schema `wakeEvidenceId`/`evidenceDigest`; result carrier `wakeEvidenceBytes` | context wake service | `particle-realms.m3b-projection-wake-evidence@1` | yes only for `batch-available,source-state-changed,authority-state-changed,authority-expiry-due,artifact-lease-changed,presentation-changed,binding-changed` | context wake service | named wake result -> caller re-read/reassert scheduling only; `expiry-due` uses its separate receipt, `timeout` has no evidence bytes, and no wake evidence is durable state authority |
| `diagnosticReceiptId`/`diagnosticReceiptDigest` | bounded diagnostic sink | `particle-realms.m3b-ref/diagnostic-receipt@1` | no | diagnostic sink | context `recordDiagnostic/accepted,aggregated` -> caller correlation only; no M3B request consumes it |
| `sourceStateSnapshotId`/`sourceStateSnapshotDigest`; carrier aliases `lastAppliedSourceStateSnapshotId`/`lastAppliedSourceStateSnapshotDigest`, `priorSourceStateSnapshotId`/`priorSourceStateSnapshotDigest`, and `currentSourceStateSnapshotId`/`currentSourceStateSnapshotDigest` | restricted reader projection | `particle-realms.m3b-projection-source-state-snapshot@1` | yes as `sourceStateSnapshotBytes` on reader `captureNext/ready,source-state-ready,idle,gap`; copied protected-closure bytes only for eligible `ready`/`source-state-ready` | restricted reader | reader `captureNext/ready,source-state-ready` -> reader `reassert`, context `waitForWake`, input cut/root closure, or recovery; `idle` -> caller byte-equality plus context wait only because no escrow/read-call receipt exists; verified `gap` -> recovery only; context `reassert` consumes the binding read/due receipt rather than this pair directly, and last/prior/current aliases are confined to their exact capture/expiry progression roles |
| indexed `stateEvidenceIds[i]`/`stateEvidenceDigests[i]`; aliases `tickAuthorityEvidenceId`/`tickAuthorityEvidenceDigest` in the source-state snapshot and expiry-due receipt | exact owner selected by the same-index frozen `stateEvidenceKinds[i]` map | exactly the matching one of the four `source-state` domain keys | pair only in the source-state snapshot and expiry-due receipt; original bytes cross only through the matching reader escrow/protected closure for eligible `ready`/`source-state-ready` | `m3b-source-state-evidence-escrow-resolver@1` before reader-escrow copy, then M3A tick/expiry join | the unique tick-authority position in the verified current source-state snapshot -> expiry-due receipt with exact mapped tick equality; a free pair, a different array position, or cross-kind/domain substitution is forbidden |
| schema `receiptId`/`receiptDigest`; reader alias `appendReceiptId`/`appendReceiptDigest`; input-cut alias `ledgerAppendReceiptId`/`ledgerAppendReceiptDigest` | accepted M3A ledger owner | `particle-realms.realm-observation-ledger-append-receipt@1` | yes nested in reader escrow/protected-closure bytes; port result carries the pair | M3A ledger owner through restricted reader | M3A `RealmObservationLedgerAppendReceiptV1` with `disposition = committed` and `durableStatus = committed-durable` -> reader `captureNext/ready` -> observation-batch input cut plus reader escrow/protected root closure/trusted prepare; any other disposition or durable status cannot enter a cut |
| schema `ledgerHeadReceiptId`/`ledgerHeadReceiptDigest`; reader alias `headReceiptId`/`headReceiptDigest` | accepted M3A ledger-head owner | `particle-realms.m3b-ref/m3a-ledger-head-receipt@1` | yes nested in `evidenceEscrowManifestBytes` and protected-closure bytes; `captureNext/ready` exposes the pair | M3A head verifier before copy, then selected root store | exact current committed head matching the append and reader cut -> reader escrow/read-call receipt -> protected closure/trusted prepare only; stale, competing, or pair-only unescrowed heads are forbidden |
| schema `batchId`/`batchDigest`; reader/input-cut/recorded-authority/escrow alias `observationBatchId`/`observationBatchDigest`; cursor alias `lastAppliedM3ABatchId`/`lastAppliedM3ABatchDigest` | accepted M3A ledger owner | `particle-realms.realm-observation-batch@1` | yes as `observationBatchBytes` and nested reader-escrow/protected-closure bytes; nonbyte consumers and cursor carry the pair only | M3A original-contract verifier before copy, then selected root store | current variant: exact accepted next batch -> reader `captureNext/ready` and reassert -> reader escrow/read-call -> recorded-authority resolve/escrow -> accepted observation-batch input cut -> matching applied cursor. Historical-carry variant: every non-current batch reached from the cursor, a retained-entry producer context, or the exact prior entry selected for one bounded cleanup/remove operation -> exactly one prior-manifest observation-batch read-call receipt with matching batch/source-state and its own matching retention/escrow -> successor closure only; the cleanup exception is one-successor evidence and cannot satisfy current reassertion or survive after its citing selected root is retired. The cursor alias sequence never advances on source-state or expiry maintenance |
| schema `observationId`/`observationDigest`; decision rows keep the intrinsic names; decision-set projections `includedObservationIds`/`includedObservationDigests` and `omittedObservationIds`/`omittedObservationDigests`; primary outcome keeps intrinsic names; witness and structural-evidence aliases `sourceObservationId`/`sourceObservationDigest`; DynamicStore ID-only alias `sourceObservationIds`; discriminator-qualified DynamicStore alias `expiryEvidenceId`/`expiryEvidenceDigest` only for `expiryEvidenceKind = observation` | accepted M3A ledger owner | `particle-realms.realm-observation@1` | yes in `observationRecordBytes`, reader escrow, and protected closure; decision/outcome/evidence rows and included/omitted projections carry pairs only, while DynamicStore carries ordered IDs/conditional expiry pair | M3A original-contract verifier before copy, then selected root store | exact batch member -> exactly one decision; included -> included arrays and one same-observation primary outcome; omitted -> omitted arrays only and no projector outcome/delta; historical witness/structural evidence may use the source alias only for that same included member; every DynamicStore or ECS cleanup-source Delta observation ID is resolved through that Delta's immutable `inputObservationIds` and the matching batch/protected closure; the cleanup variant is copied for one successor only while the remove operation cites it; the expiry alias is present together only for `observation`, while `not-applicable` omits both; an ID without exactly one matching digest/object is invalid |
| schema `deltaId`/`deltaDigest`; projection-outcome/batch arrays `deltaIds`/`deltaDigests`; DynamicStore alias `sourceDeltaId`/`sourceDeltaDigest`; State-First array aliases `sourceDeltaIds`/`sourceDeltaDigests`; transition-base `sourceDeltaId`/`sourceDeltaDigest`/`sourceDeltaCanonicalBytes` | declared M3B projector set | `particle-realms.realm-delta@1` | yes only as one exact `candidateClosureObjectBytes`/`protectedClosureObjectBytes` entry, later nested through `priorStateBundleBytes`; a transition base carries the exact prior-root or earlier pure-work-product triple; projection outcomes, projection batches, DynamicStore, ECS, and State-First records carry only the declared pair aliases | M0 RealmDelta verifier, then selected root store or neutral pure-kernel work-product verifier | exact current-eligible primary Delta -> current projection-batch/root closure -> one current DynamicStore revision and only its permitted ECS/State-First dependency edges; a retained current entry may carry the Delta only with the unique prior origin batch plus matching historical receipt/escrow into the successor closure; the exact prior entry selected for bounded cleanup may carry its source Delta and origin closure for one successor when the remove operation cites that pair, after which the exception ends; a current `retained-entry` transition base consumes that prior-root triple and a current `in-batch-candidate` transition base consumes only the immediately preceding accepted pure-work-product triple; historical-primary-audit Delta -> projection-batch/root audit closure only, never DynamicStore/ECS/State-First or an in-batch base; historical-witness presentation Delta -> projection-batch/root plus one disabled historical-presentation DynamicStore entry, whose continuation uses that same bounded origin-context rule, never ECS/State-First; maintenance cannot mint a Delta and free bytes cannot satisfy carry-forward |
| structural-evidence schema `evidenceId`/`evidenceDigest`; primary-outcome arrays `structuralIntentEvidenceIds`/`structuralIntentEvidenceDigests` | structural-intent evidence compiler | `particle-realms.m3b-projection-batch@1#row:structuralIntentEvidenceRows[]` | yes only parent-contained in the exact projection-batch bytes | projection-batch verifier | one structural evidence row -> same-observation primary-outcome arrays and top-level batch row exactly once; arrays are equal-length/pair-indexed/unique, and the nested row never becomes a standalone closure entry or authority |
| schema `authorityReceiptId`/`authorityReceiptDigest`; input-cut singular names retained; projection-outcome arrays `authorityReceiptIds`/`authorityReceiptDigests`; projection-batch arrays through their owning outcomes; authority-query ID-only alias `authorityQueryRows[].authorityReceiptId`; condition-qualified observation aliases `payload.authorityReceiptRef` only for `permission` and `payload.authorityReceiptId` only for `action-result` | accepted recorded-action-authority owner | `particle-realms.realm-action-authority-receipt@1` | yes in recorded-authority escrow/protected closure; cut/outcome/batch carry pairs; query and observation aliases carry IDs only and must resolve through the recorded-authority request | recorded-authority contract/signature verifier before copy, then selected root store and context `resolveAuthorityEvidence` | exact condition-qualified observation ID -> exactly one authority-query row -> recorded-batch resolve request -> resolver-produced authority evidence row/input cut -> same-ordinal primary outcome arrays -> projection batch; the two observation field paths cannot cross kinds, the query alias cannot bypass the request or supply bytes, arrays are equal-length, pair-indexed, sorted, and unique, and current-only grant receipts cannot enter |
| DynamicStore schema `entryId`/`entryDigest`; transition-base `sourceEntryId`/`sourceEntryDigest`/`sourceEntryCanonicalBytes`; maintenance alias arrays `cleanupEntryIds`/`cleanupEntryDigests`; ECS full-overlay arrays `sourceEntryIds`/`sourceEntryDigests`; State-First dependency alias `dynamicStoreEntryId`/`dynamicStoreEntryDigest` | pure DynamicStore candidate builder | `particle-realms.m3b-dynamic-store-snapshot@1#row:channelRows[].entryRows[]` | yes only nested in the canonical candidate/prior `RealmDynamicStoreSnapshotV1.channelRows[].entryRows[]` bytes (and thus in its protected-closure/prior-state package); a `retained-entry` transition base carries that exact nested triple; projection-batch cleanup arrays, ECS full-overlay arrays, and State-First dependency rows carry references only | DynamicStore snapshot verifier and neutral pure-kernel transition-base verifier | exact retained entry -> optional current `retained-entry` transition base, deterministic cleanup pair, ECS full-overlay source arrays, and/or one State-First dependency row; historical work may use a retained base only as read-only evidence and never as an in-batch producer; every array is equal-length/pair-indexed/unique in its declared order, every alias resolves to one entry in the bound candidate/prior snapshot, and no nested entry becomes a standalone closure object |
| schema `receiptId`/`receiptDigest`; gap-array aliases `recoveryReceiptIds`/`recoveryReceiptDigests` | accepted M3A recovery-journal owner | `particle-realms.realm-observation-ingress-recovery-receipt@1#recovery` | no | M3A recovery-receipt resolver | reader `captureNext/gap` carries equal-length, pair-indexed, pair-unique arrays sorted by `(completedLogicalTick, sourceId, receiptId)`; both may be empty, otherwise every row has `receiptPhase = recovery` and its exact disposition/durable-status relation; the gap-array occurrence itself authorizes only caller diagnosis/recovery scheduling and never an input cut or root; the same issuer receipt may later enter protected closure only through an independently satisfied source-state/reader-escrow producer predicate in `ready` or `source-state-ready` |
| `retentionStateId`/`retentionStateDigest`; nested aliases `ledgerHeadBinding`/`ledgerHeadDigest` -> `retainedM3ALedgerHeadBinding`/`retainedM3ALedgerHeadDigest` and `retainedFloorVector`/`retainedFloorDigest` -> `retainedM3AFloorVector`/`retainedM3AFloorDigest` | restricted reader projection | `particle-realms.m3b-m3a-retention-state@1` | yes as `m3aRetentionStateBytes` on reader `captureNext/ready,source-state-ready,idle,gap`; copied protected-closure bytes only for eligible `ready`/`source-state-ready` | restricted reader backed by M3A owner | reader `captureNext/ready,source-state-ready` -> reader `reassert`, protected root closure/trusted prepare, or recovery; verified retention state supplies the exact renamed head/floor fields in recovery/catch-up; `idle` -> caller byte-equality only because no escrow/read-call receipt exists and no wait request accepts retention state; verified `gap` -> recovery only |
| `escrowManifestId`/`escrowManifestDigest` in `RealmProjectionReaderEvidenceEscrowManifestV1` | reader escrow service | `particle-realms.m3b-reader-evidence-escrow-manifest@1` | yes as `evidenceEscrowManifestBytes` on `captureNext/ready,source-state-ready` and as its matching candidate/protected-closure entry, later nested in `priorStateBundleBytes` | reader escrow service | reader `captureNext/ready,source-state-ready` -> read-call receipt and reader `reassert` -> protected root closure/trusted prepare; abort or close may release only an unadopted escrow |
| schema `readCallReceiptId`/`receiptDigest`; port alias `readCallReceiptId`/`readCallReceiptDigest` | reader escrow service | `particle-realms.m3b-projection-read-call-receipt@1` | yes as `readCallReceiptBytes` on reader `captureNext/ready,source-state-ready` and copied protected-closure bytes | reader escrow service | current variant: reader `captureNext/ready,source-state-ready` -> reader/context `reassert`, current protected root closure, trusted prepare. Historical-carry variant: one verified prior selected manifest observation-batch receipt whose batch/source pair matches one non-current protected batch and whose retention pair matches its own escrow/resolved retention entry -> successor closure only while cursor/retained-entry reachability requires that batch; missing, multiple, free, cross-batch, or current-cut use is forbidden |
| schema `staticResolutionReceiptId`/`receiptDigest`; port alias `staticResolutionReceiptId`/`staticResolutionReceiptDigest` | context static resolver | `particle-realms.m3b-static-resolution-receipt@1` | yes as `staticResolutionReceiptBytes` on `resolveStatic/ready,missing`; copied protected-closure bytes for exact `ready/complete` and admissible `missing/partial-missing` variants | static resolver | `ready/complete` or structurally admissible `missing/partial-missing` -> context `reassert`, projection batch/protected root closure, intent, and trusted prepare; the latter carries complete nested subject-resolution negative evidence, permits only the exact structural matrix, and cannot authorize a missing binding, anchor, resource, or lease target |
| schema `escrowManifestId`/`escrowManifestDigest` in `RealmProjectionRecordedAuthorityEscrowManifestV1`; authority-receipt alias `recordedAuthorityEscrowManifestId`/`recordedAuthorityEscrowManifestDigest` | recorded-authority escrow service | `particle-realms.m3b-recorded-authority-escrow-manifest@1` | yes as `recordedAuthorityEscrowManifestBytes` on recorded-batch `ready,missing`; copied as its matching candidate/protected-closure entry only for `ready` with `disposition = resolved`, later nested in `priorStateBundleBytes` | recorded-authority escrow service | `resolveAuthorityEvidence/recorded-batch/ready` with `resolved` -> authority-resolution receipt -> protected root closure/trusted prepare; `recorded-batch/missing` with `partial-missing` -> its authority receipt and caller negative evidence only; this domain never aliases reader escrow |
| schema `authorityResolutionReceiptId`/`receiptDigest`; result alias `authorityResolutionReceiptId`/`authorityResolutionReceiptDigest`; consumer aliases `recordedAuthorityResolutionReceiptId`/`recordedAuthorityResolutionReceiptDigest` and `currentAuthorityResolutionReceiptId`/`currentAuthorityResolutionReceiptDigest` | context authority resolver | `particle-realms.m3b-authority-resolution-receipt@1` | yes as `authorityResolutionReceiptBytes` on `resolveAuthorityEvidence/ready,missing`; copied protected-closure bytes only for recorded-batch `ready` with `disposition = resolved` | authority resolver | `recorded-batch` `resolveAuthorityEvidence/ready` with `resolved` -> recorded alias in context `reassert`, input cut/root closure, and trusted prepare; `recorded-batch/missing` with `partial-missing` -> caller negative evidence only and never a cut; `current-only/ready` -> current alias in context `reassert`, presentation fence, recovery, and presentation/action join; aliases cannot cross modes |
| schema `authorityStateSnapshotId`/`authorityStateSnapshotDigest`; carrier alias `currentAuthorityStateSnapshotId`/`currentAuthorityStateSnapshotDigest` | current-authority owner | `particle-realms.m3b-current-authority-state-snapshot@1` | yes as `currentAuthorityStateSnapshotBytes` from `resolveAuthorityEvidence/ready` in either mode and recorded-batch `missing`; later fences carry the pair, not independent snapshot bytes | current-authority owner | `current-only/ready` with `disposition = resolved` -> context reassert, current fence, wait/recovery, and presentation/action join; `recorded-batch/ready` with `resolved` -> recorded join plus fail-close wait/recovery but cannot substitute for the required current-only receipt; `recorded-batch/missing` with `partial-missing` -> caller negative/fail-close wait evidence only, never reassert, durable cut, or ready fence; snapshot state remains exact and never enters durable root identity |
| snapshot `authorityHeadReceiptId`/`authorityHeadReceiptDigest` | current-authority owner | `particle-realms.m3b-ref/authority-head-receipt@1` | no | current-authority owner | one exact complete current-authority head at the snapshot's `authorityGeneration` -> `RealmCurrentAuthorityStateSnapshotV1/snapshotState = resolved` only; unavailable snapshots omit the pair, and no partial head is legal |
| live-grant `authorityReceiptId`/`authorityReceiptDigest` | current-authority owner over accepted `RealmActionAuthorityReceiptV1` | `particle-realms.m3b-ref/current-action-authority-receipt@1` | no | current-authority owner | exact current receipt at the row's gate semantic key, capability epoch, grant state, and expiry tick -> one live-grant row only; recorded-cut evidence uses its separate recorded-authority escrow domain |
| live-grant `transitionReceiptId`/`transitionReceiptDigest` | current-authority transition owner | `particle-realms.m3b-ref/authority-grant-transition-receipt@1` | no | current-authority owner | exact durable grant-state transition at the snapshot generation -> one matching live-grant row only; it is distinct from presentation-gate and binding-transition receipts |
| `presentationFenceId`/`presentationFenceDigest`; transition aliases `priorPresentationFenceId`/`priorPresentationFenceDigest` and `targetPresentationFenceId`/`targetPresentationFenceDigest` | presentation-fence service | `particle-realms.m3b-projection-presentation-fence@1` | yes as `presentationFenceBytes`, `stopPresentationFenceBytes`, or `readyPresentationFenceBytes` on their declared result variants | presentation-fence service | producers are open/capture, authority/device fence transitions, `recover/resumed`, and `beginStop`; `ready` -> reassert, ordinary prepare, and presentation; `recovering` -> device-catch-up prepare/recover and prior gate-transition role only; `device-lost,unavailable` -> fail-close/wait/recovery only and never prepare/present; terminal `closed` -> detach/stop/close and prior binding-transition evidence only; target alias requires newly verified `ready`; a state-role crossing is invalid |
| schema `expiryDueReceiptId`/`receiptDigest`; port alias `expiryDueReceiptId`/`expiryDueReceiptDigest` | M3A tick/expiry join | `particle-realms.m3b-projection-expiry-due-receipt@1` | yes as `expiryDueReceiptBytes`; copied protected-closure bytes only for an accepted expiry cut | M3A tick/expiry join | context `waitForWake/expiry-due` -> reader/context reassert, expiry input cut, recovery only |
| schema `headReadReceiptId`/`receiptDigest`; port alias `headReadReceiptId`/`headReadReceiptDigest` | selector/root store | `particle-realms.m3b-projection-head-read-receipt@1` | yes as `headReadReceiptBytes` on `readPriorState/empty,current` | selector/root store | `readPriorState/current` descriptor mode -> reassert/head inspection only; `empty` in either mode or `current` complete-base -> application intent and trusted prepare after reassert; no descriptor-only present read can seed a candidate |
| `m2StaticBaselineDescriptorId`/`m2StaticBaselineDescriptorDigest` | selector/root store over accepted M2 evidence | `particle-realms.m3b-m2-static-baseline-descriptor@1` | yes as `m2StaticBaselineDescriptorBytes` only for `readPriorState/empty` | selector/root store plus accepted M2 resolvers | verified empty head -> genesis candidate derivation/application intent/trusted prepare; unavailable or mismatched M2 evidence produces no descriptor and never a fabricated fallback identity |
| schema `priorStateBundleId`/`priorStateBundleDigest` | selector/root store | `particle-realms.m3b-projection-prior-state-bundle@1` | yes as `priorStateBundleBytes` only for `readPriorState/current` `complete-base` | selector/root store | protected selector/root-store read -> same-binding restart verifier and candidate derivation only; the pair is bound by the head-read receipt and no later request accepts it as standalone authority |
| schema `bundleId`/`bundleDigest`/`bundleGeneration`; exact carriers `selectedBundleId`/`selectedBundleDigest`/`selectedBundleGeneration`, `activeBundleId`/`activeBundleDigest`/`activeBundleGeneration`, `candidateBundleId`/`candidateBundleDigest`/`candidateBundleGeneration`, `proposedBundleId`/`proposedBundleDigest`, `projectionBundleId`/`projectionBundleDigest`/`projectionBundleGeneration`, `expectedProjectionBundleId`/`expectedProjectionBundleDigest`/`expectedProjectionBundleGeneration`, `observedProjectionBundleId`/`observedProjectionBundleDigest`/`observedProjectionBundleGeneration`, and `priorProjectionBundleId`/`priorProjectionBundleDigest`; successor scalar alias `targetProjectionBundleGeneration` | trusted prepare plus selector/root store | `particle-realms.m3b-active-projection-bundle@1` | yes nested in `priorStateBundleBytes`; prepare/results otherwise expose only the pair/generation | selector/root store | trusted `prepare/prepared` candidate -> application journal/receipt -> selector CAS/readback -> head/prior-state/recovery; exact selected/current evidence may then enter detach, retained-root transfer, or binding transition; expected/observed/prior roles are fixed by their variant matrices and never interchangeable |
| schema `rootId`/`rootDigest`/`rootGeneration`; exact carriers `projectionRootId`/`projectionRootDigest`/`projectionRootGeneration`, `candidateProjectionRootId`/`candidateProjectionRootDigest`, `proposedProjectionRootId`/`proposedProjectionRootDigest`, `expectedProjectionRootId`/`expectedProjectionRootDigest`/`expectedProjectionRootGeneration`, `expectedPriorProjectionRootId`/`expectedPriorProjectionRootDigest`, `observedCompetingProjectionRootId`/`observedCompetingProjectionRootDigest`, `committedProjectionRootId`/`committedProjectionRootDigest`, `activeProjectionRootId`/`activeProjectionRootDigest`, `selectedProjectionRootId`/`selectedProjectionRootDigest`, `priorProjectionRootId`/`priorProjectionRootDigest`, `currentProjectionRootId`/`currentProjectionRootDigest`, `observedProjectionRootId`/`observedProjectionRootDigest`, `predecessorRootId`/`predecessorRootDigest`, `foldedThroughRootId`/`foldedThroughRootDigest`/`foldedThroughRootGeneration`, and `finalProjectionRootId`/`finalProjectionRootDigest` | pure candidate builder then selector/root store | `particle-realms.m3b-projection-state-root@1` | yes as `candidateProjectionRootBytes` on trusted prepare and as `projectionRootBytes` nested in `priorStateBundleBytes`; every other edge carries only the pair/generation; never `candidateClosureObjectBytes` or `protectedClosureObjectBytes` | `RealmProjectionRootVerifier` for candidate bytes; selector/root store after adoption | recomputed candidate build -> intent/prepare/application journal and receipt; only durable selector adoption permits root-store resolution into current head/prior-state; verified current/prior/competing/selected forms may enter only their declared reconcile, recovery, floor, retirement, retained-transfer, transition, or disposal matrix; a role alias never changes root bytes or promotes competing/history to current |
| schema `cursorId`/`cursorDigest`; exact carriers `appliedCursorId`/`appliedCursorDigest`, `expectedAppliedCursorId`/`expectedAppliedCursorDigest`, `candidateAppliedCursorId`/`candidateAppliedCursorDigest`, `priorAppliedCursorId`/`priorAppliedCursorDigest`, and `currentAppliedCursorId`/`currentAppliedCursorDigest` | pure reducer then selector/root store | `particle-realms.m3b-projection-applied-cursor@1` | yes in candidate/prior-state protected closure | applied-cursor verifier for candidate bytes; selector/root store after adoption | recomputed reducer output -> input cut/root/intent/application; only durable selector adoption permits root-store resolution into selected bundle/head/prior-state; prior/current aliases enter only same-binding recovery and catch-up, and expected/candidate roles cannot cross |
| schema `floorAnchorId`/`floorAnchorDigest`; carrier aliases `candidateLineageFloorAnchorId`/`candidateLineageFloorAnchorDigest` and `lineageFloorAnchorId`/`lineageFloorAnchorDigest` | root store | `particle-realms.m3b-projection-lineage-floor-anchor@1` | yes as `candidateLineageFloorAnchorBytes` and nested root-owned closure bytes | root store | `readPriorState/empty,current-complete-base` -> candidate root/protected closure -> selected bundle/root and later restart; every alias preserves the one root-store-authored pair |
| schema `closureManifestId`/`closureManifestDigest`; carrier alias `candidateInternalClosureManifestId`/`candidateInternalClosureManifestDigest`; digest-only root alias `internalClosureDigest = closureManifestDigest` | pure protected-closure compiler; selected root store after verified commit | `particle-realms.m3b-projection-protected-closure-manifest@1` | yes as `candidateInternalClosureManifestBytes` and later `protectedClosureManifestBytes` | trusted closure verifier for candidate bytes; selected root store after adoption | pure closure compiler -> application intent and trusted prepare; candidate bytes grant no root-store ownership; only successful prepare/application/selector readback adopts the exact manifest/object set -> selected root/prior-state bundle; the digest-only root edge never discards the manifest ID at resolver readback |
| schema `targetSetId`/`targetSetDigest`; carrier alias `staticArtifactLeaseTargetSetId`/`staticArtifactLeaseTargetSetDigest`; digest-only manifest alias `retentionRequestDigest = targetSetDigest` | M3B pure target compiler | `particle-realms.m3b-m2-static-artifact-lease-target-set@1` | yes as the separate `staticArtifactLeaseTargetSetBytes` request and later nested inside the accepted lease receipt; never a closure object entry | M3B trusted prepare verifier plus accepted M2 artifact resolvers | pure closure walk's exact target rows -> application intent and trusted prepare -> covering M2 lease receipt/selected bundle; M2 may issue the later lease but never authors or widens the target set, and the set never acts as a lease or capability |
| `selectionHeadReceiptId`/`selectionHeadReceiptDigest` | selector/root store | `particle-realms.m3b-ref/selection-head-receipt@1` | no | selector/root store | protected context `capture/transition` selection read -> same binding-transition descriptor -> `beginStop`/`detachSources` only; empty/present head state and every root/bundle/selector generation must match |
| `transitionDescriptorId`/`descriptorDigest`; wake-evidence aliases `bindingTransitionDescriptorId`/`bindingTransitionDescriptorDigest` | context selection service | `particle-realms.m3b-projection-binding-transition-descriptor@1` | capture/`beginStop`/`detachSources` carry canonical `transitionDescriptorBytes`/`bindingTransitionDescriptorBytes`; binding-changed wake evidence carries the pair only | context selection service | selection-service descriptor -> `waitForWake/binding-changed` wake evidence for caller recapture scheduling only -> byte-identical context `capture/transition` bytes -> `beginStop`/`detachSources`; the wake pair alone never authorizes stop or detach |
| schema `stopReceiptId`/`receiptDigest`; port alias `stopReceiptId`/`stopReceiptDigest` | extension teardown owner | `particle-realms.m3b-projection-stop-receipt@1` | yes as `stopReceiptBytes` on `beginStop/stopping,already-stopping`; later consumers carry the pair only | extension teardown owner | context `beginStop/stopping,already-stopping` -> commit `detachSources`, context `closeSession`, selector-retirement/detach/disposal evidence |
| `intentId`/`intentDigest` | app pure candidate builder, verified by trusted prepare | `particle-realms.m3b-projection-application-intent@1` | yes as `applicationIntentBytes` | trusted commit prepare store | candidate build -> commit `prepare/prepared` -> commit `commit,reconcile`; application journal and receipt bind the same verified pair, while the 11-field terminal evidence binds exactly its `intentDigest` without inventing an ID field |
| schema `phaseEvidenceId`/`evidenceDigest` in `RealmProjectionApplicationPhaseEvidenceV1`; journal alias `phaseEvidenceId`/`phaseEvidenceDigest` only for `prepared,dispatch-started,selected` | application-journal owner | `particle-realms.m3b-application-phase-evidence@1` | no | application-journal owner | prepare readback -> `prepare-readback`; durable pre-dispatch record -> `dispatch-start`; selector CAS/readback -> `selector-readback`; each enters only its matching nonterminal application row |
| schema `journalRecordId`/`recordDigest`; application-receipt alias `operationJournalReceiptId`/`operationJournalReceiptDigest`; quarantine-row alias `recordId`/`recordDigest` only when `operationKind = application` | application-journal owner | `particle-realms.m3b-application-operation-journal-record@1` | no | application-journal owner | `prepared` alone issues no application receipt; `dispatch-started,selected` may issue only `recovery-pending`; `terminal-readback` issues the matching terminal application receipt; only the exact latest unresolved tail may enter the quarantine operation row |
| schema `terminalEvidenceId`/`evidenceDigest`; journal alias `phaseEvidenceId`/`phaseEvidenceDigest` only for application `phase = terminal-readback` | application-journal owner | `particle-realms.m3b-application-terminal-evidence@1` | no | application-journal owner | selector/commit terminal readback -> terminal application journal row -> one application receipt; nonterminal application phases use their separately owned evidence domains |
| application `receiptId`/`receiptDigest`; aliases `triggerApplicationReceiptId`/`triggerApplicationReceiptDigest` and `reconciledApplicationReceiptId`/`reconciledApplicationReceiptDigest` | application-journal/commit owner | `particle-realms.m3b-projection-application-receipt@1` | yes as `applicationReceiptBytes` on recognized commit/reconcile results; later aliases carry pairs only | application receipt store | commit/reconcile recognized-intent result -> caller terminal/pending evidence; only `recovery-pending` may enter uncertain-commit recovery under the trigger alias, and recovery may bind only a same-operation-chain descendant under the reconciled alias |
| schema `phaseEvidenceId`/`evidenceDigest` in `RealmProjectionRecoveryPhaseEvidenceV1`; journal alias `phaseEvidenceId`/`phaseEvidenceDigest` only for `admitted,evidence-readback,mutation-dispatched` | recovery-journal owner | `particle-realms.m3b-recovery-phase-evidence@1` | no | recovery-journal owner | exact request admission -> `request-admission`; complete joined evidence readback -> `joined-evidence-readback`; durable pre-mutation record -> `mutation-dispatch`; each enters only its matching nonterminal recovery row |
| schema `recoveryAttemptRecordId`/`recordDigest`; aliases `recoveryAttemptRecordId`/`recoveryAttemptRecordDigest`, floor `compactedThroughRecordId`/`compactedThroughRecordDigest`, and quarantine `recordId`/`recordDigest` only when `operationKind = recovery` | recovery-journal owner | `particle-realms.m3b-recovery-attempt-record@1` | no | recovery-journal owner | only `terminal-readback` issues the matching recovery receipt; `admitted,evidence-readback,mutation-dispatched` issue none; an eligible complete terminal prefix tail -> recovery-journal floor compaction; only the exact latest unresolved tail may enter the quarantine operation row |
| schema `recoveryJournalFloorId`/`floorDigest`; successor-floor digest alias `priorFloorDigest = predecessor floorDigest` for `floorGeneration > 1`, while generation one requires the exact binding-scoped prior seed; next-operation digest alias `priorRecoveryJournalLinkDigest = floorDigest` only when no materialized suffix survives | recovery-journal owner | `particle-realms.m3b-recovery-journal-floor@1` | no | recovery-journal owner | safe complete terminal-prefix compaction -> current floor -> next strictly advancing successor floor/readback; only an empty surviving suffix separately permits the next operation's first row to use the current floor digest as its prior link |
| schema `terminalEvidenceId`/`evidenceDigest`; journal alias `phaseEvidenceId`/`phaseEvidenceDigest` only for recovery `phase = terminal-readback` | recovery-journal owner | `particle-realms.m3b-recovery-terminal-evidence@1` | no | recovery-journal owner | joined recovery terminal readback -> terminal recovery-attempt row -> one recovery receipt; nonterminal recovery phases use their separately owned evidence domains |
| schema `recoveryReceiptId`/`receiptDigest`; no separately carried alias, because consumers parse and recompute the intrinsic pair from canonical bytes | recovery-journal owner | `particle-realms.m3b-projection-recovery-receipt@1` | yes as `recoveryReceiptBytes` | recovery receipt store | every admitted commit `recover` result -> caller evidence; only `resumed` enters the presentation recovery join, and no application or selector request accepts it as authority |
| `projectionSelectorCasReceiptId`/`projectionSelectorCasReceiptDigest`; discriminator-qualified application-phase alias `referencedEvidenceId`/`referencedEvidenceDigest` only for `phaseKind = selector-readback` | projection-transaction selector owner | `particle-realms.m3b-ref/projection-selector-cas-receipt@1` | no | selector/root store | selector CAS/readback -> application-phase `selector-readback` evidence, application terminal evidence/receipt, reconciliation, or recovery evidence only |
| schema `selectorReadReceiptId`/`receiptDigest`; carrier alias `selectorReadReceiptId`/`selectorReadReceiptDigest` | selector/root store | `particle-realms.m3b-projection-selector-read-receipt@1` | yes as `selectorReadReceiptBytes` | selector/root store | durable selected readback -> recovery receipt, catch-up receipt, presentation recovery join only |
| schema `selectorRetirementReadbackReceiptId`/`receiptDigest`; retirement-journal alias `phaseEvidenceId`/`phaseEvidenceDigest` only for `phase = terminal-readback` | selector/root store | `particle-realms.m3b-selector-retirement-readback-receipt@1` | no | selector/root store | protected selector retirement CAS/readback -> one terminal selector-retirement attempt row; admission/dispatch phases use distinct evidence domains and selected-selector receipts can never substitute |
| schema `phaseEvidenceId`/`evidenceDigest` in `RealmProjectionSelectorRetirementPhaseEvidenceV1`; journal alias `phaseEvidenceId`/`phaseEvidenceDigest` only for `admitted,dispatch-started` | selector-retirement journal owner | `particle-realms.m3b-selector-retirement-phase-evidence@1` | no | selector-retirement journal owner | exact detach request admission -> `request-admission`; durable pre-CAS record -> `selector-cas-dispatch`; each enters only its matching nonterminal retirement row |
| schema `selectorRetirementAttemptRecordId`/`recordDigest`; detach alias `selectorRetirementAttemptRecordId`/`selectorRetirementAttemptRecordDigest`; quarantine-row alias `recordId`/`recordDigest` only when `operationKind = selector-retirement` | selector-retirement journal owner | `particle-realms.m3b-selector-retirement-attempt-record@1` | no | selector-retirement journal owner | append-only retirement phases -> healthy detach receipt when terminal; the exact latest tail is mandatory in quarantine and no application/recovery row may substitute |
| `staticArtifactLeaseReceiptId`/`staticArtifactLeaseReceiptDigest` | accepted M2 artifact-lease owner | `particle-realms.m3b-ref/m2-static-artifact-lease-receipt@1` | nested in prior-state bundle only | M2 artifact-lease owner | trusted prepare -> selected bundle/prior-state read; release/settlement and retained/quarantine owner only |
| `artifactLeaseStateReceiptId`/`artifactLeaseStateReceiptDigest` | accepted M2 artifact-lease owner | `particle-realms.m3b-ref/m2-artifact-lease-state-receipt@1` | no | M2 artifact-lease owner | M2 lease-state change -> `waitForWake/artifact-lease-changed` wake evidence only; caller must recapture/re-resolve, and no later M3B request consumes the pair directly |
| `staticArtifactRetentionReceiptId`/`staticArtifactRetentionReceiptDigest`; settlement alias `settlementEvidenceId`/`settlementEvidenceDigest` only for `settlementKind = root-store-adoption` | root-store/M2 lease join | `particle-realms.m3b-ref/static-artifact-retention-receipt@1` | no | root store plus M2 lease owner | committed selector readback -> application receipt and selected candidate settlement only |
| `deviceRecoveryReceiptId`/`deviceRecoveryReceiptDigest` | accepted M2 device-recovery owner | `particle-realms.m3b-ref/m2-device-recovery-receipt@1` | no | M2 device-recovery owner | M2 device recovery -> recovering/ready presentation fence and `recover(device-resume)` only |
| `staticFallbackReceiptId`/`staticFallbackReceiptDigest` | accepted M2 static-fallback owner | `particle-realms.m3b-ref/m2-static-fallback-receipt@1` | no | M2 composition root | static fallback -> recovery, detach, context close, binding transition, quarantine, and disposal evidence only |
| schema `catchUpReceiptId`/`receiptDigest`; carrier alias `catchUpReceiptId`/`catchUpReceiptDigest` | recovery service | `particle-realms.m3b-projection-catch-up-receipt@1` | yes as `catchUpReceiptBytes` in `recover/resumed` | recovery service | device-resume recovery -> presentation-gate transition, recovery receipt, and post-loss ready fence only |
| schema `transitionReceiptId`/`receiptDigest`; carrier alias `presentationGateTransitionReceiptId`/`presentationGateTransitionReceiptDigest` | presentation-gate service | `particle-realms.m3b-presentation-gate-transition-receipt@1` | yes as `presentationGateTransitionReceiptBytes` in `recover/resumed` | presentation-gate service | protected recovering-to-ready CAS -> recovery receipt and ready presentation fence only |
| schema `detachReceiptId`/`receiptDigest`; port/carrier alias `detachReceiptId`/`detachReceiptDigest` | commit teardown service | `particle-realms.m3b-projection-detach-receipt@1` | no | commit teardown service | commit `detachSources/detached,already-detached` -> healthy context `closeSession`, optional binding-transition receipt, and released disposal; `recovery-pending` -> quarantine-bound close/disposal evidence only and never a healthy transition or released disposal |
| `ecsDetachReceiptId`/`ecsDetachReceiptDigest` | Engine State-First ECS adapter | `particle-realms.m3b-ref/engine-ecs-detach-receipt@1` | no | prebound Engine adapter | `detached` or `already-detached` -> healthy `detachSources/detached,already-detached`, optional binding transition, and released disposal; `quarantine-transferred` -> `detachSources/recovery-pending`, quarantine receipt, and quarantined disposal; the status families cannot cross |
| `stateFirstDetachReceiptId`/`stateFirstDetachReceiptDigest` | accepted M2 State-First source adapter | `particle-realms.m3b-ref/state-first-detach-receipt@1` | no | prebound State-First adapter | `detached` or `already-detached` -> healthy `detachSources/detached,already-detached`, optional binding transition, and released disposal; `quarantine-transferred` -> `detachSources/recovery-pending`, quarantine receipt, and quarantined disposal; the status families cannot cross |
| schema `rootReleaseReceiptId`/`receiptDigest`; composite alias `rootReleaseReceiptId`/`rootReleaseReceiptDigest`; settlement alias `settlementEvidenceId`/`settlementEvidenceDigest` only for `settlementKind = root-release` | root store | `particle-realms.m3b-candidate-root-release-receipt@1` | no | root store | verified candidate-root release -> optional lease-and-root composite and root-release candidate settlement only |
| schema `artifactLeaseReleaseReceiptId`/`receiptDigest`; composite alias `artifactLeaseReleaseReceiptId`/`artifactLeaseReleaseReceiptDigest` | accepted M2 artifact-lease adapter | `particle-realms.m3b-artifact-lease-release-receipt@1` | no | accepted M2 artifact-lease adapter | verified exact candidate-scoped lease release -> lease-and-root composite only |
| schema `leaseAndRootReleaseReceiptId`/`receiptDigest`; settlement alias `settlementEvidenceId`/`settlementEvidenceDigest` only for `settlementKind = lease-and-root-release` | commit/M2 lease-settlement join | `particle-realms.m3b-candidate-lease-and-root-release-receipt@1` | no | commit/M2 lease-settlement join | matching root-release plus artifact-lease-release readback -> lease-and-root candidate settlement only |
| `settlementEvidenceId`/`settlementEvidenceDigest`, discriminator-qualified as root-store release, composite lease-and-root release, static-retention alias, or quarantine-transfer alias | matching root-store, commit/M2 lease-settlement, root-store/M2 retention, or quarantine owner | respectively `particle-realms.m3b-candidate-root-release-receipt@1`, `particle-realms.m3b-candidate-lease-and-root-release-receipt@1`, `particle-realms.m3b-ref/static-artifact-retention-receipt@1`, or `particle-realms.m3b-projection-quarantine-transfer-receipt@1` | no | owner selected by exact `settlementKind` | only the matching `root-release`, `lease-and-root-release`, `root-store-adoption`, or `quarantine-transfer` variant -> candidate settlement receipt; `none` omits the pair and any wrong owner/kind/state/lease presence fails |
| schema `settlementReceiptId`/`receiptDigest`; port/disposal alias `candidateLeaseSettlementReceiptId`/`candidateLeaseSettlementReceiptDigest` | commit/root-store settlement join | `particle-realms.m3b-candidate-lease-settlement-receipt@1` | no | commit settlement service | commit `release/released,already-released` may produce only `root-created-no-lease/root-release/released` or `lease-issued/lease-and-root-release/released`; commit `close/closed,already-closed` returns the byte-identical stored terminal variant and is the only producer of `not-created/none/not-issued`, `selected/root-store-adoption/adopted`, or either `quarantine-transfer/quarantine-transferred` variant; every variant -> context `closeSession` and its matching disposal matrix only; candidate-state/kind/disposition/pair-presence rows cannot cross |
| schema `transferReceiptId`/`receiptDigest`; port alias `retainedRootTransferReceiptId`/`retainedRootTransferReceiptDigest`; disposal alias `rootRetentionOwnershipTransferReceiptId`/`rootRetentionOwnershipTransferReceiptDigest` | retained-root owner | `particle-realms.m3b-retained-root-transfer-receipt@1` | no | retained-root owner | `transferKind = root-store-current-to-retained-owner` or `root-store-lineage-to-retained-owner` -> healthy detach -> context `closeSession` and released-root disposal only; `transferKind = quarantine-to-retained-owner` -> later kernel-owned recovery only, never an app request/result, healthy disposal, binding transition, or rewrite of original quarantined disposal; kinds cannot cross |
| schema `transitionReceiptId`/`receiptDigest`; port/disposal alias `bindingTransitionReceiptId`/`bindingTransitionReceiptDigest` | trusted binding-transition service | `particle-realms.m3b-projection-binding-transition-receipt@1` | yes only as `predecessorBindingTransitionReceiptBytes` on successor open | binding-transition service | successful healthy detach -> context `closeSession`; then successor `openSession/opened` may return the exact bytes |
| schema `quarantineTransferReceiptId`/`receiptDigest`; port/disposal alias `quarantineTransferReceiptId`/`quarantineTransferReceiptDigest`; settlement alias `settlementEvidenceId`/`settlementEvidenceDigest` only for `settlementKind = quarantine-transfer` | kernel quarantine owner | `particle-realms.m3b-projection-quarantine-transfer-receipt@1` | no | kernel quarantine owner | unresolved all-or-nothing detach -> context `closeSession`, matching candidate settlement, quarantined disposal only |
| schema `disposalReceiptId`/`receiptDigest`; result alias `disposalReceiptId`/`disposalReceiptDigest` | extension resource-ledger/disposal join | `particle-realms.m3b-projection-disposal-receipt@1` | yes as `disposalReceiptBytes` | context teardown owner | context `closeSession/closed,already-closed` -> caller terminal evidence only; no runtime request consumes it |
| schema `resourceSnapshotId`/`snapshotDigest`; stop-receipt alias `resourceSnapshotBeforeId`/`resourceSnapshotBeforeDigest`; result carriers `resourceSnapshotBeforeBytes`/`resourceSnapshotAfterBytes`; disposal byte fields `resourceSnapshotBefore`/`resourceSnapshotAfter` | extension resource ledger | `particle-realms.m3b-projection-resource-snapshot@1` | yes as `resourceSnapshotBeforeBytes`/`resourceSnapshotAfterBytes` and nested disposal `resourceSnapshotBefore`/`resourceSnapshotAfter` | extension resource ledger | `snapshotPhase = before-stop` from context `beginStop/stopping,already-stopping` -> stop receipt/context `closeSession`; `snapshotPhase = after-transfer` is issued only after settlement/transfer; the exact ordered phase-distinct bytes enter disposal, and before/after can never substitute; snapshots are inventory evidence, not resource handles or ownership transfer |
| appended source order 107: command `commandId` plus external canonical content digest; projection-batch aliases `presentationCommandIds[]`/`presentationCommandDigests[]`; presentation-Delta ID-only `payload.presentationCommandId`; transition-base `presentationCommandId`/`presentationCommandDigest`/`presentationCommandCanonicalBytes` | declared M3B projector set or selected root store under the exact current/retained producer variant | `particle-realms.realm-presentation-command@1` | yes as one exact `candidateClosureObjectBytes`/`protectedClosureObjectBytes` entry and later inside `priorStateBundleBytes`; a transition base carries the exact prior-root or earlier current-eligible pure-work-product command triple; the batch carries the pair while the Delta carries only the ID | M0 presentation-command verifier plus shared recipe compiler, neutral pure-kernel transition-base verifier, then selected root store | same-batch pure projector work product or verified retained-origin command -> one sorted unique batch pair and exact closure object -> at least one admitted presentation Delta with the same ID; only a current-eligible earlier work product or prior-root command may additionally satisfy an exact current transition-base triple; an exact command named by a cleanup-source presentation Delta may accompany that Delta's one-successor remove-operation closure and no farther; trusted prepare recompiles or resolves the matching retained bytes, historical witness work reuses the selected primary command without creating an in-batch historical chain or duplicate pair, and free/missing/uncited/conflicting/multiply resolved bytes are forbidden |

Every local reference domain resolves to the exact schema format/version in the
service registry or registered-contract table. An imported
`particle-realms.m3b-ref/*` row is a code-shipped M3B reference adapter over an
inherited issuer-owned record: it does not rename or redigest issuer bytes, and
its resolver verifies accepted format/version, pair, scope generations, and
producer status. An `opaque-local-reference` row instead binds only the exact
local pair semantics, owner, resolver, and producer predicate from the embedded
descriptor pack; it has no issuer wire bytes to wrap, copy, or redigest.
Same-shaped pairs,
unlisted aliases, crossed producer statuses, consumer edges not in the table,
or a pair resolved through the wrong owner fail before allocation. No pair by
itself is a capability, transferable handle, proof of success, or authority.

## Exact prebound runtime binding

`RealmProjectionRuntimeBindingV1` has exactly 53 top-level fields in this order:

```text
format
version
bindingId
realmId
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
activeBakeId
activeBakeRevision
activeBakeOutputRecordDigest
spatialLayoutReceiptId
spatialLayoutReceiptDigest
staticStoreSnapshotId
staticStoreSnapshotDigest
projectionBindingIndexId
projectionBindingIndexDigest
audienceClass
disclosureClass
m3aBindingReceiptId
m3aBindingDigest
observationProfileId
observationProfileDigest
observationCatalogId
observationCatalogDigest
sourceManifestId
sourceManifestDigest
safeNormalizationProfileId
safeNormalizationProfileDigest
pseudonymKeyAuthorityId
pseudonymKeyEpoch
pseudonymKeyCommitment
m3bProfileId
m3bProfileDigest
m3bCatalogId
m3bCatalogDigest
domainManifestId
domainManifestDigest
disclosurePolicyId
disclosurePolicyDigest
projectionCommitCapabilityProfileId
projectionCommitCapabilityProfileDigest
semanticAxisTransitionPolicyId
semanticAxisTransitionPolicyDigest
bindingDigest
```

`audienceClass` is fixed to `owner-private`. `disclosureClass` is fixed to
`local-private`. Every one of the 53 fields is present. Presentation state,
presentation generation, and device-recovery evidence are deliberately absent
from this logical binding and exist only in the ephemeral port fence.

The M3A fields are copied from and resolve to the current portable M3A binding.
The M2, bake, layout, static-store, and projection-binding-index fields are
produced under the same retained selection fence. The four M3B profile/catalog/
manifest/policy pairs, separate M3 projection-transaction capability profile,
and semantic-axis transition policy are code-shipped and recomputed before
issuance. Neither new profile widens M2's frozen 15-key dependency object or
`RealmRuntimeCapabilityProfileV1`; both are separately versioned M3 service
prerequisites hidden behind the three M3B ports. A caller cannot author or
override any field.

All three ports expose the same byte-identical binding pair. Cross-operator,
cross-Realm, cross-lifecycle, cross-bundle, cross-head, cross-bake, cross-layout,
cross-static-store, cross-projection-index, cross-M3A, cross-key-epoch,
cross-policy, cross-catalog, or cross-projection-capability work fails before
candidate allocation. A changed presentation fence cancels or blocks the
attempt without changing this binding, its identity, or an already committed
CPU projection root.

## M3 projection-transaction capability

M3B does not infer atomic projection from M2's structural barrier. Before any
projection application module can register, M3B-00 must implement and accept a
separately versioned, service-only `realmProjectionBundleAdapter@1`. Its exact
immutable `RealmProjectionCommitCapabilityProfileV1` has 20 fields:

```text
format
version
profileId
worldStateCodecVersion
projectionBundleAdapterVersion
dynamicStoreCodecVersion
ecsOverlayCodecVersion
stateFirstSemanticSourceCodecVersion
activationMode
staticBaselineMode
allowedArchetypeIds
allowedComponentTypeIds
transformPolicy
renderablePolicy
sourceHealthPolicy
expiryPolicy
maximumPreparedBundles
supportsDurableOperationJournal
retentionCapabilities
profileDigest
```

The base values are:

```text
format = particle-realms.m3-projection-commit-capability-profile
version = 1
profileId = projection-commit-capability:virtual-realm-m3b-v1
worldStateCodecVersion = 2
projectionBundleAdapterVersion = 1
dynamicStoreCodecVersion = 1
ecsOverlayCodecVersion = 1
stateFirstSemanticSourceCodecVersion = 1
activationMode = single-durable-selector-generation-cas
staticBaselineMode = accepted-m2-static-read-only
allowedArchetypeIds = [realm-dynamic-presentation-v1]
allowedComponentTypeIds = [Renderable, Transform]
transformPolicy = existing-baked-anchor-byte-identical
renderablePolicy = shipped-descriptor-only
sourceHealthPolicy = seven-slot-generation-fail-closed-meet
expiryPolicy = bundle-logical-tick-fail-closed-meet
maximumPreparedBundles = 1
supportsDurableOperationJournal = true
retentionCapabilities = [root-owned-evidence-escrow, m2-artifact-lease, retained-root-transfer]
```

The adapter builds a complete successor off-active from the accepted M2 static
baseline plus a full M3B stable-ID overlay. Only `Transform` and `Renderable`
are writable. A dynamic `Transform` must be byte-identical to an existing baked
anchor transform; `Renderable` can select only a descriptor already shipped and
bound for that anchor. Static entities cannot be moved, removed, renumbered, or
reparented. Collider, navigation, input, camera, audio, authority, action,
permission, capability, physics, script, and unknown components are
unrepresentable. All allocation, validation, component loops, callbacks, and
Promise settlement finish before the durable selector CAS. A JavaScript
in-memory mirror update is not claimed to be nonthrowing under host failure or
out-of-memory conditions: if it cannot mirror the committed selector, the
service closes the dynamic presentation fence, keeps M2 static presentation
active, and reconciles from durable selector readback.

This profile is not a seventeenth M3B wire definition and is not appended to the
frozen M2 capability contract. It is a code-shipped service descriptor whose
ID/digest is bound by the M3B runtime binding and independently compared by the
three ports, shared pure verifier, and trusted commit service.

The capability owns one service-internal `ActiveProjectionBundleV1` schema with
exactly 27 fields:

```text
format
version
bundleId
runtimeBindingId
runtimeBindingDigest
bundleGeneration
projectionRootId
projectionRootDigest
appliedCursorId
appliedCursorDigest
dynamicStoreSnapshotId
dynamicStoreSnapshotDigest
dynamicStoreGeneration
ecsChangeSetId
ecsChangeSetDigest
ecsSourceGeneration
resultingEcsOverlayDigest
stateFirstSourceSnapshotId
stateFirstSourceSnapshotDigest
stateFirstSourceGeneration
sourceStateSlotsDigest
effectiveLogicalTick
lineageFloorAnchorId
lineageFloorAnchorDigest
staticArtifactLeaseReceiptId
staticArtifactLeaseReceiptDigest
bundleDigest
```

The root is persisted and independently read back beside every root-referenced
floor/state byte sequence; those referenced bytes, not the root's self-bytes,
are covered by its protected closure. The post-root artifact-lease receipt is
instead verified through its explicit selected-bundle service resolver. The ECS member is the complete resulting M3B
overlay, never only the latest operation list. The floor-anchor pair equals the
pair bound by the root. The artifact lease is acquired by trusted prepare after
the lease-neutral root and closure request are frozen; it is operational
retention evidence in the selected bundle, not an input to root identity. This
nested service schema is not a registered seventeenth definition and never
crosses the app boundary as a live object.

`bundleId` uses `particle-realms.m3b-active-projection-bundle-id@1` over every
field from the runtime-binding pair through the static-artifact-lease-receipt
pair in the displayed order. `bundleDigest` uses
`particle-realms.m3b-active-projection-bundle@1` over the first 26 fields in
listed order, including the recomputed ID. Every member pair, generation, slot
digest, overlay digest, tick, and floor/lease join is therefore part of both
candidate verification and selected readback.

The authoritative durable `RealmProjectionDurableSelectorV1` has exactly ten
fields:

```text
format
version
runtimeBindingId
runtimeBindingDigest
activeBundleId
activeBundleDigest
activeBundleGeneration
activeProjectionRootId
activeProjectionRootDigest
selectorDigest
```

An empty selector is service-owned absence proven by an empty-head receipt, not
a selector record with fabricated IDs. The CAS input binds the expected selector
pair/generation or verified absence, candidate bundle pair/generation, intent,
idempotency key, and unchanged `ready` or authorized device-catch-up
`recovering` presentation-fence pair. A recovering-fence CAS advances only the
hidden durable CPU bundle and cannot transition presentation. The candidate
bundle generation is expected plus one. The durable selector CAS is the sole
logical linearization point; an in-memory pointer is only a recoverable cache.
`selectorDigest` uses `particle-realms.m3b-projection-durable-selector@1` over
the first nine fields in listed order. Empty selector absence has no fabricated
digest and therefore cannot collide with a materialized selector record.

## Semantic-axis transition policy

The code-shipped `RealmProjectionSemanticAxisTransitionPolicyV1` with
`policyId = semantic-axis-transition:virtual-realm-m3b-v1` has an exact 16-field
service descriptor:

```text
format
version
policyId
allowedInputProvenanceClasses
allowedEvidenceQualities
allowedAvailabilityStates
allowedFreshnessStates
allowedTemporalModes
allowedAssertionStates
provenanceTransitions
evidenceTransitions
availabilityTransitions
freshnessTransitions
temporalTransitions
assertionTransitions
policyDigest
```

Its base input sets are exact:

```text
allowedInputProvenanceClasses = [observed, derived]
allowedEvidenceQualities = [exact, measured, computed, estimated, unknown, not-applicable]
allowedAvailabilityStates = [available, sealed, denied, partial, absent]
allowedFreshnessStates = [current, stale, expired, unknown]
allowedTemporalModes = [live, historical]
allowedAssertionStates = [confirmed, proposed, hypothetical]
```

The ordered transition relation is exact and permits no upgrade:

| Axis input | Only allowed outputs |
| --- | --- |
| Provenance `observed` | `observed`, `derived` |
| Provenance `derived` | `derived` |
| Evidence `exact` | `exact`, `measured`, `computed`, `estimated`, `unknown` |
| Evidence `measured` | `measured`, `computed`, `estimated`, `unknown` |
| Evidence `computed` | `computed`, `estimated`, `unknown` |
| Evidence `estimated` | `estimated`, `unknown` |
| Evidence `unknown` | `unknown` |
| Evidence `not-applicable` | `not-applicable`, `unknown` |
| Availability `available` | `available`, `sealed`, `denied`, `partial`, `absent` |
| Availability `sealed` | `sealed`, `denied`, `absent` |
| Availability `denied` | `denied`, `absent` |
| Availability `partial` | `partial`, `denied`, `absent` |
| Availability `absent` | `absent` |
| Freshness `current` | `current`, `stale`, `expired`, `unknown` |
| Freshness `stale` | `stale`, `expired`, `unknown` |
| Freshness `expired` | `expired` |
| Freshness `unknown` | `unknown`, `expired` |
| Temporal `live` | `live`, `historical` |
| Temporal `historical` | `historical` |
| Assertion `confirmed` | `confirmed`, `proposed`, `hypothetical` |
| Assertion `proposed` | `proposed`, `hypothetical` |
| Assertion `hypothetical` | `hypothetical` |

Unknown axis values are structurally invalid, not coerced. There is no minimum-
evidence ranking: evidence qualities are categorical and ordered only by the
frozen transition rows above. Source-health and expiry maintenance does not
rewrite immutable M0 observation/delta bytes. The active bundle computes only
durable base eligibility as a fail-closed meet of the retained entry, exact
source slot/generation, and bundle logical tick; any derived overlay axes must
also satisfy this same transition relation. The presentation/action adapter then
meets that base eligibility with the separate ephemeral current-authority
snapshot and may only preserve or close the gate.

## Existing contracts and Engine primitives reused

M3B reuses the accepted M0 definitions without changing them:

| Existing definition | Exact M3B use |
| --- | --- |
| `RealmObservationV1` and nine admitted payload kinds | Byte-identical M3A input; `station` and `code-matter` remain inadmissible |
| `RealmMetricValueV1` | Quality-labelled metrics; deterministic groups never rewrite individual source evidence |
| `RealmDeltaV1` | Canonical delta envelope; M3B admits only `entity`, `route`, `gate`, `traffic`, `structure`, and `presentation` |
| Six corresponding delta payload contracts | Exact operation and payload schemas; `RealmCodeDeltaPayloadV1` remains M3D-only |
| `RealmProjectionBindingV1` | Read-only authored source-anchor, bounds, dependency, compiler, numeric-policy, and descriptor binding |
| `RealmPresentationCommandV1` | Data-only reversible presentation command referenced by a presentation delta |
| Audience, provenance, evidence, availability, freshness, temporal, assertion, resource-reference, and safe-text definitions | Existing semantic axes and safe references; no parallel enums |

M3B also reuses, but never widens, these implementation patterns:

| Existing primitive | Reused invariant | Prohibited interpretation |
| --- | --- | --- |
| Canonical Realm encoding, preflight, limits, and registry | Exact schemas, deep-freeze, canonical bytes, SHA-256, staged atomic catalog registration | No second registry or weak hash |
| CSE commit gate and `SemanticTransaction` | Clone/validate/recheck/CAS discipline inside a protected critical section | Not OS truth and not an action authority |
| CSE observer projection | Causal observation and witness ordering | Not a Realm spatial projector and never `isTruth` |
| `EntityRegistry` | Stable logical version and expected-version pattern | Not the active ECS or a multi-entity transaction |
| `FramePipeline` | Apply an already prepared transaction before render | Not a transaction or quiescence receipt by itself |
| `StateFirstEcsSourceAdapter` | Read-only ECS identity/transform/renderable source split | No renderer decision in M3B |
| `StateFirstSourceBridge` | Stable source IDs, duplicate rejection, bounded source snapshots, idempotent detach | No live bridge object in a contract |
| `StateFirstRasterizer` dirty bits | Existing representation and dirty-mask vocabulary | No second M3B dirty-bit enum |
| `GpuRuntimeCoordinator` | Accepted device recovery and replay of last committed CPU source | Not the logical DynamicStore/ECS transaction |

Current `World`, `ArchetypeStorage`, `Query`, `SystemRegistry`, and persistence
behavior cannot satisfy M3B atomicity. The accepted M2.1B/M2C replacements are
hard prerequisites, not optional optimizations. (Sources:
`webgpu-os/apps/the-virtual-realm/contracts/RealmObservationContract.js`;
`webgpu-os/apps/the-virtual-realm/contracts/RealmDeltaContract.js`;
`webgpu-os/apps/the-virtual-realm/contracts/RealmProjectionBindingContract.js`;
`engine/ecs/world/World.js`; `engine/ecs/storage/ArchetypeStorage.js`;
`engine/render/state/StateFirstEcsSourceAdapter.js`;
`engine/render/state/StateFirstSourceBridge.js`.)

## Separate M3B contract catalog

M3B registers a separate import-inert catalog. It never appends to, renumbers,
or replaces the frozen M0-M1C catalog, the planned M2 catalog, or the planned
M3A catalog.

Atomic registration emits one service-local
`RealmProjectionContractCatalogReceiptV1` with this exact 14-field vocabulary:

```text
format
version
catalogId
catalogKind
definitionNames
definitionFormats
definitionDigests
definitionCount
modulePaths
moduleCount
referenceDomainRegistryId
referenceDomainRegistryDigest
disposition
catalogDigest
```

Its format is `particle-realms.m3b-contract-catalog-receipt`, version is `1`,
`catalogKind` is `virtual-realm-m3b-disclosure-projection`, `definitionCount` is
exactly 16, `moduleCount` is exactly 18, and `disposition` is `registered`.
The three definition arrays have equal length and exact catalog order; module
paths have exact graph order and are unique. The reference-domain pair resolves
to the exact accepted registry defined above and is required before this receipt
can be issued. `catalogId` uses
`particle-realms.m3b-contract-catalog-receipt-id@1` over, in order, `version`,
`catalogKind`, `definitionNames`, `definitionFormats`, `definitionDigests`,
`definitionCount`, `modulePaths`, `moduleCount`, the reference-domain-registry
pair, and `disposition`. `catalogDigest` uses
`particle-realms.m3b-contract-catalog-receipt@1` over the first 13 fields in
listed order, including the recomputed ID and complete arrays. This is registry readback evidence, not a
seventeenth definition, second executable contract registry, mutable catalog,
loader, or execution authority.

The catalog contains exactly 16 definitions in this order:

| Order | Definition | Purpose |
| ---: | --- | --- |
| 1 | `RealmProjectionRuntimeProfileV1` | Bind exact deterministic work and retention ceilings |
| 2 | `RealmProjectionDomainManifestV1` | Bind projector order, unique ownership, and allowed outputs |
| 3 | `RealmProjectionRuntimeBindingV1` | Bind M2, M3A, static, policy, catalog, transaction-capability, and semantic-policy currentness |
| 4 | `RealmProjectionDisclosurePolicyV1` | Bind the exact nine-kind preserve-or-omit policy |
| 5 | `RealmProjectionInputCutV1` | Freeze one deterministic observation-batch, source-state, or expiry input |
| 6 | `RealmDisclosureDecisionSetV1` | Prove byte-identical inclusion or closed omission for each batch record |
| 7 | `RealmProjectionBatchV1` | Bind primary outcomes, deltas, structural evidence, ordering, and work |
| 8 | `RealmProjectionAppliedCursorV1` | Bind the independently applied M3A/projection position without a root backlink |
| 9 | `RealmDynamicStoreSnapshotV1` | Bind one immutable six-channel reduced snapshot |
| 10 | `RealmEcsProjectionChangeSetV1` | Bind stable-ID ECS operations without live handles |
| 11 | `RealmStateFirstSourceSnapshotV1` | Bind the read-only State-First CPU source view |
| 12 | `RealmProjectionApplicationIntentV1` | Bind expected heads, complete candidate closure, and idempotency |
| 13 | `RealmProjectionApplicationReceiptV1` | Record commit, conflict, rejection, or uncertain application |
| 14 | `RealmProjectionRecoveryReceiptV1` | Record restore, replay, uncertain-commit reconciliation, device resume, or static fallback |
| 15 | `RealmProjectionStateRootV1` | Close the current projection artifact graph under `projection-root` |
| 16 | `RealmProjectionDisposalReceiptV1` | Prove reverse disposal, detach, quiescence, and release |

The target graph is exactly 18 modules: one M3B contract primitive module, 16
definition modules, and one catalog module. The existing
`VirtualRealmContractRegistry` remains the only registration implementation.
Each definition lands with its semantic validator, minimal fixture, canonical
vector, independent Python vector, browser cases, and catalog test. Partial
catalog registration and placeholder definitions fail atomically.

`RealmProjectionCheckpointLinkReceiptV1` is intentionally absent. M3A already
owns the protected checkpoint edge and `RealmObservationCheckpointCommitReceiptV1`.
A second receipt would duplicate evidence or imply M3B checkpoint authority.

## Common M3B record rules

Every M3B record follows all M0 canonical encoding and preflight rules plus these
stricter rules:

- exact own-key order; no extra, inherited, accessor, symbol, function, Promise,
  error, DOM, GPU, handle, callback, map, set, typed live view, or cyclic field;
- null prototype after validation and a complete deep freeze;
- conditional fields are absent when not applicable; `null` is never a presence
  substitute;
- a record's own content ID and digest are independently recomputed from its
  canonical payload bytes; semantic IDs and issuer-owned reference IDs are
  instead validated by their frozen owning contracts and matching evidence;
- arrays are ordered by a declared order, bounded, unique where declared, and
  never depend on locale or insertion order;
- all byte counts measure canonical UTF-8 bytes, not JavaScript string length;
- state/content generations are nonnegative safe integers so an empty
  zero-output genesis may retain ECS and State-First generation zero; ownership,
  session, bundle, extension-child, and root generations are positive safe
  integers unless an inherited contract explicitly preserves canonical uint64
  decimal text;
- all logical ticks use canonical uint64 decimal text and never wall time;
- every current M3B-owned reference resolves to exact bytes in the declared
  current binding closure; historical M3A and recorded-time authority bytes are
  retained as byte-identical root-owned evidence escrow under their original
  owner/ID/digest, while an M2 artifact lease or retired-lineage anchor resolves
  through its explicit service-owned variant and can never be silently rebound
  to the current binding;
- every record is data only and grants no capability by possession.

The canonical formats are below. Every listed registered definition has the
literal scalar `version = 1`; the V1 type name is not used as an inferred wire
value.

| Definition | Format literal |
| --- | --- |
| `RealmProjectionRuntimeProfileV1` | `particle-realms.m3b-projection-runtime-profile` |
| `RealmProjectionDomainManifestV1` | `particle-realms.m3b-projection-domain-manifest` |
| `RealmProjectionRuntimeBindingV1` | `particle-realms.m3b-projection-runtime-binding` |
| `RealmProjectionDisclosurePolicyV1` | `particle-realms.m3b-projection-disclosure-policy` |
| `RealmProjectionInputCutV1` | `particle-realms.m3b-projection-input-cut` |
| `RealmDisclosureDecisionSetV1` | `particle-realms.m3b-disclosure-decision-set` |
| `RealmProjectionBatchV1` | `particle-realms.m3b-projection-batch` |
| `RealmProjectionAppliedCursorV1` | `particle-realms.m3b-projection-applied-cursor` |
| `RealmDynamicStoreSnapshotV1` | `particle-realms.m3b-dynamic-store-snapshot` |
| `RealmEcsProjectionChangeSetV1` | `particle-realms.m3b-ecs-projection-change-set` |
| `RealmStateFirstSourceSnapshotV1` | `particle-realms.m3b-state-first-source-snapshot` |
| `RealmProjectionApplicationIntentV1` | `particle-realms.m3b-projection-application-intent` |
| `RealmProjectionApplicationReceiptV1` | `particle-realms.m3b-projection-application-receipt` |
| `RealmProjectionRecoveryReceiptV1` | `particle-realms.m3b-projection-recovery-receipt` |
| `RealmProjectionStateRootV1` | `particle-realms.m3b-projection-state-root` |
| `RealmProjectionDisposalReceiptV1` | `particle-realms.m3b-projection-disposal-receipt` |

### Exact record construction registry

The following construction notation is normative. `C(a..b)` is the canonical
value sequence of every displayed own field from `a` through `b`, inclusive,
in the displayed schema order. It is legal only when that whole range is
mandatory. `P(a..b)` is a fixed-length Boolean array with one position for
every field in the displayed vocabulary from `a` through `b`; `R(a..b)` is the
ordered array containing exactly one two-element
`[fieldName, canonicalValue]` row for every `true` position and no row for a
`false` position. A conditionally absent field contributes `false` and no row,
never `null`. The encoder rejects an incorrect vector length, field name,
position, row count, order, own-key set, or value before hashing.

For both `complete` and `presence-safe` rows below, the ID preimage is exactly
`version || P(a..b) || R(a..b)` and the final digest preimage is exactly
`format || version || recomputedId || P(a..b) || R(a..b)`. A `complete`
`C(a..b)` marker requires an all-`true` vector and a row for every field in the
range; it is notation for a closed mandatory shape, not a different hash
formula. The vector and field rows are hash-only derivations and are not wire
keys. A `digest-only` row has no ID and hashes the exact construction named in
its table row. These rules
do not override a narrower specialized construction already frozen below; the
table names that construction explicitly instead. No implementation may choose
between semantic and content identity at runtime.

The registered catalog and its two runtime-bound code-shipped descriptors use
this exhaustive construction table:

| Record | Shape and exact ID payload | ID domain | Final digest domain |
| --- | --- | --- | --- |
| `RealmProjectionRuntimeProfileV1` | complete `C(canonicalEncodingProfileId..maximumPreparedProjectionBundles)` | `particle-realms.m3b-projection-runtime-profile-id@1` | `particle-realms.m3b-projection-runtime-profile@1` |
| `RealmProjectionDomainManifestV1` | complete `C(manifestRevision..outputOperationOrder)` | `particle-realms.m3b-projection-domain-manifest-id@1` | `particle-realms.m3b-projection-domain-manifest@1` |
| `RealmProjectionRuntimeBindingV1` | complete `C(realmId..semanticAxisTransitionPolicyDigest)` | `particle-realms.m3b-projection-runtime-binding-id@1` | `particle-realms.m3b-projection-runtime-binding@1` |
| `RealmProjectionDisclosurePolicyV1` | complete `C(audienceClass..policyRevision)` | `particle-realms.m3b-projection-disclosure-policy-id@1` | `particle-realms.m3b-projection-disclosure-policy@1` |
| `RealmProjectionInputCutV1` | presence-safe `P(cutKind..expiryBoundaryTick)` / `R(cutKind..expiryBoundaryTick)` | `particle-realms.m3b-projection-input-cut-id@1` | `particle-realms.m3b-projection-input-cut@1` |
| `RealmDisclosureDecisionSetV1` | complete `C(runtimeBindingId..omittedCount)` | `particle-realms.m3b-disclosure-decision-set-id@1` | `particle-realms.m3b-disclosure-decision-set@1` |
| `RealmProjectionBatchV1` | presence-safe `P(realmId..workUnitCount)` / `R(realmId..workUnitCount)` | `particle-realms.m3b-projection-batch-id@1` | `particle-realms.m3b-projection-batch@1` |
| `RealmProjectionAppliedCursorV1` | specialized exact construction in its section | `particle-realms.m3b-projection-applied-cursor-id@1` | `particle-realms.m3b-projection-applied-cursor@1` |
| `RealmDynamicStoreSnapshotV1` | specialized exact construction in its section | `particle-realms.m3b-dynamic-store-snapshot-id@1` | `particle-realms.m3b-dynamic-store-snapshot@1` |
| `RealmEcsProjectionChangeSetV1` | complete `C(realmId..resultingOverlayDigest)` | `particle-realms.m3b-ecs-projection-change-set-id@1` | `particle-realms.m3b-ecs-projection-change-set@1` |
| `RealmStateFirstSourceSnapshotV1` | complete `C(realmId..semanticAxesDigest)` | `particle-realms.m3b-state-first-source-snapshot-id@1` | `particle-realms.m3b-state-first-source-snapshot@1` |
| `RealmProjectionApplicationIntentV1` | presence-safe `P(realmId..logicalTick)` / `R(realmId..logicalTick)` | `particle-realms.m3b-projection-application-intent-id@1` | `particle-realms.m3b-projection-application-intent@1` |
| `RealmProjectionApplicationReceiptV1` | specialized 33-position construction in its section | `particle-realms.m3b-projection-application-receipt-id@1` | `particle-realms.m3b-projection-application-receipt@1` |
| `RealmProjectionRecoveryReceiptV1` | specialized 33-position construction in its section | `particle-realms.m3b-projection-recovery-receipt-id@1` | `particle-realms.m3b-projection-recovery-receipt@1` |
| `RealmProjectionStateRootV1` | specialized exact construction in its section | `particle-realms.m3b-projection-state-root-id@1` | `particle-realms.m3b-projection-state-root@1` |
| `RealmProjectionDisposalReceiptV1` | presence-safe `P(realmId..reasonCode)` / `R(realmId..reasonCode)` | `particle-realms.m3b-projection-disposal-receipt-id@1` | `particle-realms.m3b-projection-disposal-receipt@1` |
| `RealmProjectionCommitCapabilityProfileV1` | fixed semantic `profileId = projection-commit-capability:virtual-realm-m3b-v1`; digest-only over every displayed preceding field | none | `particle-realms.m3-projection-commit-capability-profile@1` |
| `RealmProjectionSemanticAxisTransitionPolicyV1` | fixed semantic `policyId = semantic-axis-transition:virtual-realm-m3b-v1`; digest-only over every displayed preceding field | none | `particle-realms.m3b-semantic-axis-transition-policy@1` |

The boundary-carried and service-local values use the same frozen notation.
Every named ID/digest pair is independently recomputed before its owning port
may return or consume it:

| Record | Shape and exact ID payload | ID domain | Final digest domain |
| --- | --- | --- | --- |
| `RealmProjectionM3ARetentionStateV1` | complete `C(m3aBindingReceiptId..nextExpectedBatchSequence)` | `particle-realms.m3b-m3a-retention-state-id@1` | `particle-realms.m3b-m3a-retention-state@1` |
| `RealmProjectionSourceStateSnapshotV1` | complete `C(runtimeBindingId..logicalTick)` | `particle-realms.m3b-projection-source-state-snapshot-id@1` | `particle-realms.m3b-projection-source-state-snapshot@1` |
| `RealmProjectionReaderEvidenceEscrowManifestV1` | presence-safe `P(runtimeBindingId..disposition)` / `R(runtimeBindingId..disposition)` | `particle-realms.m3b-reader-evidence-escrow-manifest-id@1` | `particle-realms.m3b-reader-evidence-escrow-manifest@1` |
| `RealmProjectionReadCallReceiptV1` | presence-safe `P(runtimeBindingId..disposition)` / `R(runtimeBindingId..disposition)` | `particle-realms.m3b-projection-read-call-receipt-id@1` | `particle-realms.m3b-projection-read-call-receipt@1` |
| `RealmProjectionStaticLookupLimitsV1` | digest-only over `format`, `version`, all-true `P(maximumRecords..maximumBytes)`, and `R(maximumRecords..maximumBytes)` | none | `particle-realms.m3b-static-lookup-limits@1` |
| `RealmProjectionPresentationFenceV1` | presence-safe `P(runtimeBindingId..catchUpReceiptDigest)` / `R(runtimeBindingId..catchUpReceiptDigest)` | `particle-realms.m3b-projection-presentation-fence-id@1` | `particle-realms.m3b-projection-presentation-fence@1` |
| `RealmProjectionStaticResolutionReceiptV1` | complete `C(runtimeBindingId..disposition)` | `particle-realms.m3b-static-resolution-receipt-id@1` | `particle-realms.m3b-static-resolution-receipt@1` |
| `RealmProjectionRecordedAuthorityEscrowManifestV1` | complete `C(runtimeBindingId..disposition)` | `particle-realms.m3b-recorded-authority-escrow-manifest-id@1` | `particle-realms.m3b-recorded-authority-escrow-manifest@1` |
| `RealmProjectionAuthorityResolutionReceiptV1` | presence-safe `P(runtimeBindingId..disposition)` / `R(runtimeBindingId..disposition)` | `particle-realms.m3b-authority-resolution-receipt-id@1` | `particle-realms.m3b-authority-resolution-receipt@1` |
| `RealmCurrentAuthorityStateSnapshotV1` | presence-safe `P(runtimeBindingId..canonicalByteCount)` / `R(runtimeBindingId..canonicalByteCount)` | `particle-realms.m3b-current-authority-state-snapshot-id@1` | `particle-realms.m3b-current-authority-state-snapshot@1` |
| `RealmProjectionBindingTransitionDescriptorV1` | presence-safe `P(realmId..transitionGeneration)` / `R(realmId..transitionGeneration)` | `particle-realms.m3b-projection-binding-transition-descriptor-id@1` | `particle-realms.m3b-projection-binding-transition-descriptor@1` |
| `RealmProjectionWakeEvidenceV1` | presence-safe `P(runtimeBindingId..logicalTick)` / `R(runtimeBindingId..logicalTick)` | `particle-realms.m3b-projection-wake-evidence-id@1` | `particle-realms.m3b-projection-wake-evidence@1` |
| `RealmProjectionExpiryDueReceiptV1` | complete `C(runtimeBindingId..disposition)` | `particle-realms.m3b-projection-expiry-due-receipt-id@1` | `particle-realms.m3b-projection-expiry-due-receipt@1` |
| `RealmProjectionStopReceiptV1` | presence-safe `P(runtimeBindingId..disposition)` / `R(runtimeBindingId..disposition)` | `particle-realms.m3b-projection-stop-receipt-id@1` | `particle-realms.m3b-projection-stop-receipt@1` |
| `RealmProjectionSelectorReadReceiptV1` | complete `C(runtimeBindingId..disposition)` | `particle-realms.m3b-projection-selector-read-receipt-id@1` | `particle-realms.m3b-projection-selector-read-receipt@1` |
| `RealmProjectionSelectorRetirementReadbackReceiptV1` | presence-safe `P(realmId..reasonCode)` / `R(realmId..reasonCode)` | `particle-realms.m3b-selector-retirement-readback-receipt-id@1` | `particle-realms.m3b-selector-retirement-readback-receipt@1` |
| `RealmProjectionCatchUpReceiptV1` | complete `C(runtimeBindingId..disposition)` | `particle-realms.m3b-projection-catch-up-receipt-id@1` | `particle-realms.m3b-projection-catch-up-receipt@1` |
| `RealmProjectionPresentationGateTransitionReceiptV1` | complete `C(runtimeBindingId..disposition)` | `particle-realms.m3b-presentation-gate-transition-receipt-id@1` | `particle-realms.m3b-presentation-gate-transition-receipt@1` |
| `RealmProjectionRetainedRootTransferReceiptV1` | complete `C(realmId..disposition)` | `particle-realms.m3b-retained-root-transfer-receipt-id@1` | `particle-realms.m3b-retained-root-transfer-receipt@1` |
| `RealmProjectionBindingTransitionReceiptV1` | presence-safe `P(realmId..successorEligibility)` / `R(realmId..successorEligibility)` | `particle-realms.m3b-projection-binding-transition-receipt-id@1` | `particle-realms.m3b-projection-binding-transition-receipt@1` |
| `RealmProjectionCandidateLeaseSettlementReceiptV1` | presence-safe `P(runtimeBindingId..disposition)` / `R(runtimeBindingId..disposition)` | `particle-realms.m3b-candidate-lease-settlement-receipt-id@1` | `particle-realms.m3b-candidate-lease-settlement-receipt@1` |
| `RealmProjectionResourceSnapshotV1` | complete `C(runtimeBindingId..resourceInventoryDigest)` | `particle-realms.m3b-projection-resource-snapshot-id@1` | `particle-realms.m3b-projection-resource-snapshot@1` |
| `RealmProjectionRecoveryJoinedEvidenceRowsV1` | digest-only specialized exact construction in its section | none | `particle-realms.m3b-recovery-joined-evidence-rows@1` |
| `RealmProjectionRecoveryMutationPlanV1` | specialized exact construction in its section | `particle-realms.m3b-recovery-mutation-plan-id@1` | `particle-realms.m3b-recovery-mutation-plan@1` |
| `RealmProjectionTransitionBaseV1` | digest-only over the exact 13-position presence vector and ordered present rows from `baseKind` through `presentationCommandCanonicalBytes` | none | `particle-realms.m3b-transition-base@1` |

The construction registry is part of both frozen reference-descriptor-pack
vectors. A domain typo, wrong start/end field, generic “hash the payload”
fallback, semantic-ID substitution, different omission encoding, or ID/digest
preimage reuse across two rows is a vector failure before catalog admission.

### Exact nested-row and aggregate construction registry

In this section, `H(domain, values...)` means SHA-256 over the existing M0
canonical encoding of the ordered array whose first value is the literal
domain and whose remaining values are exactly those listed. It is not string
concatenation. Every nested row has no standalone ID unless one is named below,
and every row digest includes all and only the named canonical values. Counts
are safe integers; byte totals sum the complete canonical row/object byte
sequences and are never reduced by physical deduplication.

Reader and authority escrow construction is exact:

- a reader evidence row uses
  `H(particle-realms.m3b-reader-evidence-escrow-row@1,` its first seven
  displayed fields `)`; a recorded-authority evidence row uses the distinct
  `particle-realms.m3b-recorded-authority-escrow-row@1` domain over those same
  seven positions;
- an observation-batch read-call `recordCount` equals the exact observation
  count in its batch, while a source-state read uses zero;
  `evidenceObjectCount = evidenceRows.length` and `canonicalByteCount` is the
  sum of every evidence row's `canonicalByteCount`;
- a recorded-authority escrow has
  `evidenceCount = evidenceRows.length` and `canonicalByteCount` equal to that
  same row-byte sum;
- an authority-query `rowDigest` uses
  `particle-realms.m3b-authority-query-row@1` over its first six fields;
  `authorityQueryRowsDigest` uses
  `particle-realms.m3b-authority-query-rows@1` over the complete ordered
  seven-field rows followed by their count; the missing-ID aggregate uses
  `particle-realms.m3b-missing-authority-receipt-ids@1` over the complete
  code-point-sorted unique ID array followed by its count, including the exact
  `[]`/zero sentinel;
- the input-cut/recorded-resolution authority-evidence `rowDigest` uses
  `particle-realms.m3b-authority-evidence-row@1` over its first seven fields;
  `authorityEvidenceCount` equals the exact input-cut row length; and
  `resolutionRowsDigest` uses
  `particle-realms.m3b-authority-resolution-rows@1` over the complete ordered
  eight-field rows followed by their count;
- a current-authority live-grant row uses
  `particle-realms.m3b-current-authority-live-grant-row@1` over its first nine
  fields; `liveGrantCount = liveGrantRows.length` and the snapshot
  `canonicalByteCount` is the sum of the complete ten-field row bytes;
  current-only `resolutionRowsDigest` uses the distinct
  `particle-realms.m3b-current-authority-resolution-rows@1` domain over the
  complete ordered ten-field rows followed by `liveGrantCount`;
- a recorded-mode authority-resolution receipt copies the resolution-row count
  and the recorded escrow canonical-byte total; a current-only receipt copies
  `liveGrantCount` and `canonicalByteCount` from its bound current-authority
  snapshot. A caller aggregate or a count from the other mode is invalid.

Static resolution freezes each aggregate independently. A subject-resolution
row uses `particle-realms.m3b-static-subject-resolution-row@1` over its first
six fields; `subjectResolutionCount` is the complete row length and
`subjectResolutionByteCount` is the sum of complete seven-field row bytes. The
requested-subject and missing-subject digests use, respectively,
`particle-realms.m3b-static-resolution-requested-subject-ids@1` and
`particle-realms.m3b-static-resolution-missing-subject-ids@1` over the complete
code-point-sorted unique projection of all subject rows and missing subject
rows, followed by the corresponding length. The empty missing set is the second
domain over `[]` and zero. A seven-field record row uses
`particle-realms.m3b-static-resolution-record-row@1` over its first six fields.
`resolvedRowsDigest` uses
`particle-realms.m3b-static-resolution-resolved-rows@1` over the complete
ordered seven-field rows followed by their count; `recordCount` is that length
and `canonicalByteCount` is the sum of each row's embedded-object
`canonicalByteCount`, never the canonical size of the seven-field wrapper row.
The port-level maximum and work counters use the subject-row count/bytes plus
these record/object count/bytes exactly as defined in the receipt section.

The manifest and policy rows are closed as follows:

- a ten-field projector row uses
  `particle-realms.m3b-projection-domain-manifest-projector-row@1` over its
  first nine fields;
- the embedded recipe matrix uses the exact four row and four aggregate domains
  in its section; its 53 event, 130 primary slot, 16 descriptor-role, and one
  witness row counts and digests are recomputed before the enclosing manifest
  ID/digest, and its `matrixDigest` hashes its first 15 complete fields under
  `particle-realms.m3b-projection-recipe-matrix@1`;
- `primaryOwnershipDigest` uses
  `particle-realms.m3b-projection-primary-ownership@1` over exactly nine
  `[observationKind, primaryProjectorId]` rows in `observationKindOrder`, then
  literal count nine; the permission projector therefore appears twice and the
  zero-owner witness appears zero times;
- a disclosure rule uses
  `particle-realms.m3b-projection-disclosure-policy-rule@1` over its first 12
  fields;
- each of the six semantic-axis transition arrays contains exact four-field
  rows `transitionOrder`, `inputValue`, `allowedOutputValues`, and `rowDigest`.
  The order is dense and follows the displayed relation. The six row-digest
  domains are, respectively,
  `particle-realms.m3b-semantic-axis-provenance-transition-row@1`,
  `particle-realms.m3b-semantic-axis-evidence-transition-row@1`,
  `particle-realms.m3b-semantic-axis-availability-transition-row@1`,
  `particle-realms.m3b-semantic-axis-freshness-transition-row@1`,
  `particle-realms.m3b-semantic-axis-temporal-transition-row@1`, and
  `particle-realms.m3b-semantic-axis-assertion-transition-row@1`, each over its
  first three fields. These parent-qualified rows are the exact nested bytes at
  the six already registered extractor paths.

A disclosure decision's `decisionDigest` uses
`particle-realms.m3b-disclosure-decision@1` over
`P(observationOrdinal..policyRuleDigest)` followed by
`R(observationOrdinal..policyRuleDigest)`: the seven-position vector is all
true for `omitted`, while `included` has `false` at
`omissionReasonCode`. The four included/omitted ID/digest arrays and both
counts are exact stable projections of these rows, never separately authored.

Projection-batch nested hashes use these noninterchangeable domains:

- primary outcome: `particle-realms.m3b-primary-projection-outcome@1` over its
  first 15 fields;
- historical-witness outcome:
  `particle-realms.m3b-historical-witness-outcome@1` over the 11-position
  `P(witnessOrder..historicalSemanticKey)` and matching field rows;
- maintenance outcome: `particle-realms.m3b-maintenance-outcome@1` over the
  13-position `P(maintenanceOrder..mutationByteCount)` and matching field rows;
- operation-count row:
  `particle-realms.m3b-projection-operation-count-row@1` over its first seven
  fields;
- structural-intent `evidenceId`:
  `particle-realms.m3b-structural-intent-evidence-id@1` over, in order,
  `sourceObservationId`, `sourceObservationDigest`, `sourceEventKind`,
  `primaryProjectorId`, `affectedExistingSubjectIds`,
  `affectedExistingAnchorIds`, `changeKinds`, and `disposition`; its
  `evidenceDigest` uses `particle-realms.m3b-structural-intent-evidence@1` over
  `evidenceOrder`, the recomputed ID, and every remaining displayed field
  through `disposition`.

Every projection-batch array count equals its exact length, every byte count is
the corresponding canonical-byte sum, and maintenance totals are the sums of
the row `mutationCount` and `mutationByteCount` values. The complete Delta
arrays and operation-count partitions must reconcile to the same objects and
bytes; a matching total with a different partition is invalid.

ECS row hashes are acyclic through the hash-only `changeSetScopeDigest` defined
in the ECS section:

- an operation row uses `particle-realms.m3b-ecs-operation-row@1` over that
  scope followed by the 11-position
  `P(operationOrder..sourceDeltaDigests)` and matching field rows;
- an incremental component-write row uses
  `particle-realms.m3b-ecs-component-write-row@1` over the scope, parent
  `operationOrder`, parent `stableEntityId`, and its first five fields;
- a full-overlay component row uses
  `particle-realms.m3b-ecs-full-overlay-component-row@1` over the scope, parent
  `stableEntityId`, and its first five fields;
- a full-overlay parent row uses
  `particle-realms.m3b-ecs-full-overlay-row@1` over the scope and its first
  eight fields;
- `operationCount`/`operationByteCount` and
  `resultingOverlayEntityCount`/`resultingOverlayByteCount` equal the respective
  ordered row-array lengths and complete canonical-byte sums;
  `resultingOverlayDigest` uses
  `particle-realms.m3b-ecs-resulting-overlay@1` over the scope, all complete
  ordered nine-field overlay rows, their count, and their byte total.

State-First construction is likewise complete. `sourceEntryId` uses
`particle-realms.m3b-state-first-source-entry-id@1` over the runtime-binding
pair and `stableEntityId`. A dependency row uses
`particle-realms.m3b-state-first-dependency-row@1` over that parent
`sourceEntryId` and its first seven fields; the source entry's `entryDigest`
uses `particle-realms.m3b-state-first-source-entry@1` over its first 12 fields.
`sourceEntryCount` and `sourceEntryByteCount` equal the row-array length and
complete 13-field row-byte sum; `dirtySourceEntryCount` equals the length of
the code-point-sorted unique dirty-ID array. `semanticAxesDigest` uses
`particle-realms.m3b-state-first-semantic-axes@1` over, in order,
`sourceStateSlotsDigest`, `effectiveLogicalTick`, the complete ordered source
entry rows, `sourceEntryCount`, and `sourceEntryByteCount`.

Two digest-only external inventories remain resolvable rather than becoming
opaque summaries. The retained-root owner persists and reads back
`optionalM3AEdgeInventoryRows`. Each row has exactly five fields:
`edgeOrder`, `edgeKind`, `edgeReceiptId`, `edgeReceiptDigest`, and `rowDigest`.
`edgeKind` is only `projection-root-checkpoint`, order is dense, and the receipt
pair has exactly one mapping: `RealmObservationCheckpointCommitReceiptV1`,
domain `particle-realms.realm-observation-checkpoint-commit-receipt@1`, owner
`realm-observation-checkpoint@1`, resolver
`m3b-reader-original-contract-verifier@1`, and producer predicate
`disposition = committed && durableStatus = committed-durable`. The resolver
extracts the committed-checkpoint pair, resolves the exact
`RealmObservationIngressCheckpointV1` through its accepted M3A owner, and
requires exactly one recomputed retained-graph edge with
`edgeKind = checkpoint-to-projection-root`,
`targetRootKind = projection-root`, and a target pair byte-equal to the
enclosing retained-root transfer's projection-root pair. The M3A edge digest
still uses its original M3A four-field construction; it is not the inventory's
`edgeReceiptDigest` and is never renamed or redigested.

The inventory-row digest uses
`particle-realms.m3b-optional-m3a-edge-inventory-row@1` over its first four
fields. `optionalM3AEdgeInventoryDigest` uses
`particle-realms.m3b-optional-m3a-edge-inventory@1` over the complete ordered
rows followed by their derived count; the empty `[]`/zero value is legal. Rows
sort by receipt ID/digest and contain no duplicate pair. Before a nonempty
transfer can issue, the retained-root owner must retain and read back the exact
original checkpoint-commit-receipt and checkpoint bytes under their original
IDs/digests. That copy grants no checkpoint-write capability and does not add an
M3B checkpoint receipt or a heterogeneous port carrier.

The extension resource ledger similarly persists and reads back
`resourceInventoryRows`, each with exactly `resourceOrder`, `resourceKind`,
`resourceId`, `resourceDigest`, `resourceGeneration`, `currentOwnerId`, and
`rowDigest`. `resourceGeneration` is a positive, nonreused allocation generation
assigned by this extension ledger before the resource becomes reachable. It is
stable for that ownership obligation, is never JavaScript object identity, and
does not replace a root, bundle, journal-attempt, or issuer generation. A later
durable journal phase may advance an operation row's `resourceDigest`, but only
after exact owner readback and without changing its resource ID or allocation
generation.

The source map is closed and constructive:

| `resourceKind` in fixed order | Exact `resourceId` / `resourceDigest` source | Exact `currentOwnerId` | Resolver and admissible live state |
| --- | --- | --- | --- |
| `application-operation` | application `operationId` / exact latest durable `RealmProjectionApplicationOperationJournalRecordV1.recordDigest` | `m3b-application-journal-owner@1` | application-journal resolver; unresolved or terminal bytes still awaiting their one settlement/floor/transfer edge |
| `recovery-operation` | `recoveryOperationId` / exact latest durable `RealmProjectionRecoveryAttemptRecordV1.recordDigest` | `m3b-recovery-journal-owner@1` | recovery-journal resolver; unresolved or terminal bytes still awaiting their one settlement/floor/transfer edge |
| `candidate` | `RealmProjectionApplicationIntentV1.intentId` / `intentDigest` | `m3b-app-candidate-owner@1` | application-intent verifier; admitted candidate not yet prepared, released, adopted, or transferred |
| `prepared-candidate` | trusted prepare `prepareId` / `prepareDigest` | `m3b-commit-prepare-store@1` | prepare-readback resolver; prepared candidate not yet selected, released, or transferred |
| `reader-escrow` | `RealmProjectionReaderEvidenceEscrowManifestV1.escrowManifestId` / `escrowManifestDigest` | `m3b-reader-escrow-service@1` | reader-escrow resolver; `candidate-unadopted` and not yet adopted, released, or transferred |
| `recorded-authority-escrow` | `RealmProjectionRecordedAuthorityEscrowManifestV1.escrowManifestId` / `escrowManifestDigest` | `m3b-recorded-authority-escrow-service@1` | recorded-authority-escrow resolver; `candidate-unadopted` and not yet adopted, released, or transferred |
| `candidate-artifact-lease` | accepted M2 `staticArtifactLeaseReceiptId` / `staticArtifactLeaseReceiptDigest` | `m2-static-artifact-lease-owner@1` | accepted M2 original-contract resolver; live, candidate-scoped, target-covering, and not yet adopted, released, or transferred |
| `session-candidate-root` | `RealmProjectionStateRootV1.rootId` / `rootDigest` | `m3b-session-candidate-root-owner@1` | root verifier; session-owned candidate root not yet root-store-adopted, released, or transferred |
| `ecs-overlay` | `RealmEcsProjectionChangeSetV1.changeSetId` / `changeSetDigest` | `m3b-session-ecs-overlay-owner@1` | ECS change-set verifier; candidate overlay still owned by the stopped session |
| `state-first-source` | `RealmStateFirstSourceSnapshotV1.sourceSnapshotId` / `sourceSnapshotDigest` | `m3b-session-state-first-source-owner@1` | State-First snapshot verifier; candidate source still owned by the stopped session |
| `callback` | semantic callback construction below | `m3b-extension-callback-owner@1` | extension resource-ledger resolver; `registered` or `draining`, never `drained` |
| `in-flight-call` | semantic call construction below | `m3b-extension-call-owner@1` | extension resource-ledger resolver; `admitted`, `dispatched`, or `settling`, never settled |

A callback has one private, immutable semantic identity tuple in this exact
order: the runtime-binding pair, `extensionChildGeneration`, `ownerPortName`,
`ownerMethodId`, `callbackRole`, and `canonicalRegistrationRequestDigest`.
`callbackRole` is only `wake`, `settlement`, or `teardown`; one registration
request may own at most one callback of each role. `resourceId` uses
`particle-realms.m3b-callback-resource-id@1` over that tuple.
`resourceDigest` uses `particle-realms.m3b-callback-resource@1` over, in order,
the recomputed ID, the same tuple, `resourceGeneration`, `currentOwnerId`, and
the exact current `registered`/`draining` state. An in-flight call's immutable
semantic tuple is the runtime-binding pair, `extensionChildGeneration`, exact
descriptor `portName`, exact `methodId`, and `canonicalRequestDigest`.
`resourceId` uses `particle-realms.m3b-in-flight-call-resource-id@1` over that
tuple; `resourceDigest` uses
`particle-realms.m3b-in-flight-call-resource@1` over, in order, the recomputed
ID, the tuple, `resourceGeneration`, `currentOwnerId`, and its exact
`admitted`/`dispatched`/`settling` state. A duplicate live semantic tuple is
coalesced into the existing obligation or rejected before registration; it
cannot mint a second identity. The private tuples contain no function, signal,
Promise, callback object, continuation, store key, or payload bytes.

Rows sort by the fixed kind order above, then code-point ID/digest, then numeric
generation; `resourceOrder` is dense and no duplicate
`(resourceKind, resourceId, resourceGeneration)` is legal. The owner resolver
must reproduce the mapped pair, generation, owner literal, and lifecycle state
before inclusion. `rowDigest` uses
`particle-realms.m3b-resource-inventory-row@1` over its first six fields, and
`resourceInventoryDigest` uses `particle-realms.m3b-resource-inventory@1` over
the complete ordered rows followed by their derived count. The after-transfer
inventory is exactly the domain's `[]`/zero value. `candidateCount`,
`preparedCount`, `candidateLeaseCount`, `sessionCandidateRootCount`,
`callbackCount`, and `inFlightCount` equal their same-named kind projections;
`readerEscrowCount` equals the combined reader-escrow and recorded-authority-
escrow rows. Application/recovery operations, ECS overlays, and State-First
sources remain inventory-visible but do not silently increment a differently
named scalar counter. A bare digest, unresolvable pair, arbitrary owner string,
or unavailable private identity tuple cannot support a resource snapshot or
disposal receipt.

## `RealmProjectionRuntimeProfileV1`

The base profile has exactly 57 top-level fields:

```text
format
version
profileId
canonicalEncodingProfileId
digestAlgorithm
domainManifestId
domainManifestDigest
disclosurePolicyId
disclosurePolicyDigest
maximumProjectorCount
maximumObservationKindCount
maximumSourceStateSlots
maximumInputBatchesPerCut
maximumInputRecordsPerCut
maximumInputBytesPerCut
maximumDisclosureDecisionsPerCut
maximumIncludedObservationsPerCut
maximumDeltasPerObservation
maximumDeltasPerBatch
maximumDeltaBytes
maximumProjectionBatchBytes
maximumDynamicEntries
maximumDynamicSnapshotBytes
maximumDirtyEntriesPerBatch
maximumEcsOperationsPerBatch
maximumStateFirstUpdatesPerBatch
maximumRetainedProjectionRoots
maximumRecoveryAttempts
maximumDiagnosticEntries
maximumDiagnosticBytes
maximumProjectionWorkUnitsPerCut
maximumSourceStateEvidenceReferencesPerCut
maximumAuthorityEvidenceRecordsPerCut
maximumAuthorityEvidenceBytesPerCut
maximumStaticResolutionRecordsPerCut
maximumStaticResolutionBytesPerCut
maximumStructuralEvidenceRowsPerCut
maximumStructuralEvidenceBytesPerCut
maximumMaintenanceOutcomeRowsPerCut
maximumMaintenanceBytesPerCut
maximumExpiryCleanupEntriesPerCut
maximumEcsComponentWritesPerBatch
maximumEcsChangeSetBytes
maximumEcsOverlayEntities
maximumStateFirstSourceEntries
maximumStateFirstSnapshotBytes
maximumProtectedClosureEntries
maximumProtectedClosureBytes
maximumRetainedRootAggregateBytes
maximumCurrentStateReadBytes
maximumStaticArtifactLeaseReferences
maximumDurableOperationJournalEntries
maximumDurableOperationJournalBytes
maximumQuarantineEntries
maximumQuarantineBytes
maximumPreparedProjectionBundles
profileDigest
```

The exact base ceilings are:

| Field | Value |
| --- | ---: |
| `maximumProjectorCount` | 9 |
| `maximumObservationKindCount` | 9 |
| `maximumSourceStateSlots` | 7 |
| `maximumInputBatchesPerCut` | 1 |
| `maximumInputRecordsPerCut` | 1,024 |
| `maximumInputBytesPerCut` | 4,194,304 |
| `maximumDisclosureDecisionsPerCut` | 1,024 |
| `maximumIncludedObservationsPerCut` | 1,024 |
| `maximumDeltasPerObservation` | 8 |
| `maximumDeltasPerBatch` | 8,192 |
| `maximumDeltaBytes` | 65,536 |
| `maximumProjectionBatchBytes` | 16,777,216 |
| `maximumDynamicEntries` | 131,072 |
| `maximumDynamicSnapshotBytes` | 134,217,728 |
| `maximumDirtyEntriesPerBatch` | 8,192 |
| `maximumEcsOperationsPerBatch` | 16,384 |
| `maximumStateFirstUpdatesPerBatch` | 8,192 |
| `maximumRetainedProjectionRoots` | 4 |
| `maximumRecoveryAttempts` | 3 |
| `maximumDiagnosticEntries` | 256 |
| `maximumDiagnosticBytes` | 262,144 |
| `maximumProjectionWorkUnitsPerCut` | 524,288 |
| `maximumSourceStateEvidenceReferencesPerCut` | 256 |
| `maximumAuthorityEvidenceRecordsPerCut` | 1,024 |
| `maximumAuthorityEvidenceBytesPerCut` | 8,388,608 |
| `maximumStaticResolutionRecordsPerCut` | 4,096 |
| `maximumStaticResolutionBytesPerCut` | 16,777,216 |
| `maximumStructuralEvidenceRowsPerCut` | 1,024 |
| `maximumStructuralEvidenceBytesPerCut` | 4,194,304 |
| `maximumMaintenanceOutcomeRowsPerCut` | 1 |
| `maximumMaintenanceBytesPerCut` | 4,194,304 |
| `maximumExpiryCleanupEntriesPerCut` | 8,192 |
| `maximumEcsComponentWritesPerBatch` | 32,768 |
| `maximumEcsChangeSetBytes` | 67,108,864 |
| `maximumEcsOverlayEntities` | 65,536 |
| `maximumStateFirstSourceEntries` | 65,536 |
| `maximumStateFirstSnapshotBytes` | 67,108,864 |
| `maximumProtectedClosureEntries` | 262,144 |
| `maximumProtectedClosureBytes` | 335,544,320 |
| `maximumRetainedRootAggregateBytes` | 536,870,912 |
| `maximumCurrentStateReadBytes` | 536,870,912 |
| `maximumStaticArtifactLeaseReferences` | 65,536 |
| `maximumDurableOperationJournalEntries` | 64 |
| `maximumDurableOperationJournalBytes` | 16,777,216 |
| `maximumQuarantineEntries` | 1 |
| `maximumQuarantineBytes` | 536,870,912 |
| `maximumPreparedProjectionBundles` | 1 |

The profile contains no callback, implementation object, allowed-kind array, or
mutable override. The manifest and disclosure policy own their closed sets. Each
independent ceiling accepts its exact bound and rejects plus one before candidate
application. Passing every independent ceiling does not bypass the global work
ceiling or the retained-root aggregate ceiling. In particular, a 335,544,320-byte
closure is valid from an empty retained set, but a successor is rejected before
allocation when `retained aggregate bytes + proposed root-owned bytes` would
exceed 536,870,912. The four-root count ceiling never promises that four
individually maximum-size roots can coexist. The one-entry quarantine byte
ceiling equals the complete-base/retained-aggregate ceiling rather than the
smaller closure ceiling, so any admitted single prepared bundle plus its lease,
journal, and outer evidence can transfer safely after an uncertain dispatch.

Work units equal:

```text
input records
+ disclosure decisions
+ included observations
+ primary projection outcome rows
+ historical witness outcome rows
+ emitted deltas
+ structural-intent evidence rows
+ maintenance outcome rows
+ static-resolution records
+ authority-evidence records
+ dirty entries
+ ECS operations
+ ECS component writes
+ State-First updates
+ newly traversed protected-closure entries
```

The conservative sum of every contributing independent ceiling is 347,137 work
units, leaving 177,151 units below the 524,288 global ceiling. The maxima are
not claimed to be simultaneously attainable because the three cut kinds are
exclusive and every maintenance cut has exactly one outcome row. The arithmetic
is a required cross-language vector; an implementation that double-counts
shared canonical bytes fails. Current-only authority
resolution is independently plus-one guarded and byte-metered inside the
context service under `maximumDynamicEntries` and
`maximumCurrentStateReadBytes`; its live-grant rows never enter a durable cut,
batch work count, batch identity, root, or replay result.

`RealmProjectionBatchV1.workUnitCount` is frozen from an exact side-effect-free
pre-freeze count pass, not guessed before its downstream contributors exist.
The pure kernel creates one service-local `RealmProjectionWorkCountPlanV1`
value with these exact 16 fields in order and no ID, digest, authority, or
durable lifetime:

```text
inputRecordCount
disclosureDecisionCount
includedObservationCount
primaryProjectionOutcomeCount
historicalWitnessOutcomeCount
emittedDeltaCount
structuralIntentEvidenceCount
maintenanceOutcomeCount
staticResolutionRecordCount
authorityEvidenceRecordCount
dirtyEntryCount
ecsOperationCount
ecsComponentWriteCount
stateFirstUpdateCount
newlyTraversedProtectedClosureEntryCount
workUnitCount
```

The pass consumes the already verified cut, decision/outcome rows, prior
snapshot, static/authority resolution, and the same immutable reducer,
ECS-projector, State-First, dependency-extractor, and closure-order tables used
by construction. It performs, in order: exact output partition counting; a
count-only DynamicStore reduction; a count-only ECS operation/component-write
projection; a count-only State-First update projection; and an exact protected-
closure dependency walk. The closure walk uses opaque unique symbols for the
not-yet-minted batch and candidate artifact pairs, deduplicates those symbols
and inherited exact pairs by the same
`(retentionClass, objectKind, objectId, objectDigest)` rule, and counts only the
resulting new entry rows. The symbols are domain-typed and cannot equal an
inherited pair; a byte-identical replay is rejected or classified idempotent
before this pass. Therefore no count depends on the eventual batch ID/digest,
canonical byte length, storage address, or allocation order.

Every inner counter is plus-one guarded at its declared ceiling and the pass
stops before materializing a candidate when the sum exceeds 524,288. It performs
no hashing of final artifact identities, port call, persistence, selector CAS,
Engine/ECS mutation, GPU work, clock read, or diagnostic write. After the batch
identity is frozen, the real reducer/builders must reproduce every one of the
15 component counts and the same sum; any mismatch rejects the candidate before
prepare. Browser and Python vectors exercise the count pass and final-build
comparison at zero and at the actual maximum of each cut kind. A separate
independent-ceiling-sum vector produces 347,137, and a formula-only vector
accepts 524,288 and rejects 524,289; neither synthetic sum is misrepresented as
one attainable artifact.

The 47 numeric ceilings are independent and cumulative. The
`maximumDurableOperationJournalEntries` and
`maximumDurableOperationJournalBytes` ceilings are one binding-scoped aggregate
pool shared atomically by the application, recovery-attempt, and selector-
retirement journals; the current recovery-journal floor is one charged entry in
that same pool, and no family receives a second allowance. Nested
rows, referenced canonical bytes, trusted resolution results, retained rows
from all three journal families, quarantine content, and the complete protected
closure count even when they are
not embedded directly in the projection batch. Content-addressed byte sharing
may reduce physical storage, but it never reduces canonical count/byte or work
accounting. `maximumPreparedProjectionBundles` must equal the service capability
profile's `maximumPreparedBundles`. A `complete-base` read encodes each retained
canonical object once and counts the outer root/bundle/floor/head package too;
the larger current-state ceiling therefore cannot be exhausted merely because
the protected closure itself is valid at its exact 335,544,320-byte maximum.

The transaction capability reserves teardown capacity *inside* that aggregate,
never above it. Four code-shipped derived constants are bound by the
`projectionCommitCapabilityProfileId`/
`projectionCommitCapabilityProfileDigest` pair:

```text
selectorRetirementStopReserveEntries = 3
selectorRetirementStopReserveBytes = 1,048,576
ordinaryJournalEntryBudget = 61
ordinaryJournalByteBudget = 15,728,640
```

The three entries are the maximum admitted, dispatch-started, and terminal-
readback selector-retirement records. The byte reserve covers those records and
their exact admission, dispatch, conditional 21-field retirement-readback, and
request/stop evidence references at their frozen canonical maxima. An
independent cross-language vector computes that schema maximum and must prove it
is at most 1,048,576 bytes before the capability can register. Application and
recovery records, the current recovery floor, all retained tails, and every
outstanding ordinary reservation must fit the 61-entry/15,728,640-byte ordinary
budgets. Stop alone may consume the reserve, and total live journal accounting
still may not exceed 64 entries or 16,777,216 bytes. Unused reserve is never
loaned to ordinary work. Quarantine inventory/receipt bytes charge the separate
`maximumQuarantineEntries`/`maximumQuarantineBytes` ceilings, while detach,
settlement, close, and disposal receipt metadata are neither journal records nor
journal phase evidence; none consumes either journal budget or the stop reserve.

## `RealmProjectionDomainManifestV1`

The manifest has exactly ten top-level fields:

```text
format
version
manifestId
manifestRevision
observationKindOrder
projectorRows
recipeMatrix
primaryOwnershipDigest
outputOperationOrder
manifestDigest
```

`observationKindOrder` is exactly:

```text
boot
filesystem
storage
process
ipc
syscall
action-result
permission
network
```

`outputOperationOrder` is exactly:

```text
entity
route
gate
traffic
structure
presentation
```

Each `projectorRows` element has exactly ten fields:

```text
projectorOrder
projectorId
projectorVersion
projectorClass
inputObservationKinds
inputDeltaOperations
allowedOutputOperations
bindingRuleId
maximumOutputsPerInput
rowDigest
```

The exact nine rows are:

| Order | Projector ID | Version | Class | Observation kinds | Accepted input | Allowed outputs | Binding rule ID | Maximum output |
| ---: | --- | --- | --- | --- | --- | --- | --- | ---: |
| 1 | `realm-boot-projector@1` | `projector-v1` | `primary` | `boot` | one admitted observation | `entity`, `gate`, `structure`, `presentation` | `binding-rule:m3b-boot-existing-anchor-v1` | 7 |
| 2 | `realm-filesystem-projector@1` | `projector-v1` | `primary` | `filesystem` | one admitted observation | `entity`, `structure`, `presentation` | `binding-rule:m3b-filesystem-existing-anchor-v1` | 7 |
| 3 | `realm-storage-projector@1` | `projector-v1` | `primary` | `storage` | one admitted observation | `entity`, `traffic`, `structure`, `presentation` | `binding-rule:m3b-storage-existing-anchor-v1` | 7 |
| 4 | `realm-process-projector@1` | `projector-v1` | `primary` | `process` | one admitted observation | `entity`, `traffic`, `structure`, `presentation` | `binding-rule:m3b-process-existing-anchor-v1` | 7 |
| 5 | `realm-ipc-projector@1` | `projector-v1` | `primary` | `ipc` | one admitted observation | `route`, `traffic`, `presentation` | `binding-rule:m3b-ipc-existing-anchor-v1` | 7 |
| 6 | `realm-syscall-projector@1` | `projector-v1` | `primary` | `syscall` | one admitted observation | `route`, `traffic`, `presentation` | `binding-rule:m3b-syscall-existing-anchor-v1` | 7 |
| 7 | `realm-permission-projector@1` | `projector-v1` | `primary` | `action-result`, `permission` | one observation plus matched authority evidence | `gate`, `presentation` | `binding-rule:m3b-authority-existing-anchor-v1` | 7 |
| 8 | `realm-network-projector@1` | `projector-v1` | `primary` | `network` | one admitted local-only observation | `route`, `traffic`, `structure`, `presentation` | `binding-rule:m3b-network-existing-anchor-v1` | 7 |
| 9 | `realm-historical-witness-projector@1` | `projector-v1` | `secondary-witness` | none | one complete frozen historical primary outcome | `presentation` | `binding-rule:m3b-historical-noninteractive-v1` | 1 |

The peer name remains `RealmPermissionProjector` for compatibility, while its
manifest domain is `authority` and its one ownership row consumes both authority
kinds. A ninth action-result primary projector is forbidden. The shared M3A
authority source emits both kinds, and success correlation remains inside one
owner.

The eight primary rows uniquely and exhaustively own all nine observation kinds.
The witness owns zero kinds. Every primary emits at most seven deltas. A
historical observation may then emit at most one witness delta; a live
observation emits no witness delta. The manifest validator enforces
`primaryOutputCount + witnessOutputCount <= 8` rather than trusting either
module's local count.

`recipeMatrix` is the complete embedded `RealmProjectionRecipeMatrixV1`
defined below. It is a mandatory value inside the manifest, not a separately
registered catalog definition, callback table, executable object, or mutable
runtime map. Consequently the existing complete manifest construction
`C(manifestRevision..outputOperationOrder)` binds the matrix bytes without
adding a seventeenth registered definition or a nineteenth module.

### Embedded `RealmProjectionRecipeMatrixV1`

The recipe matrix closes every remaining projector choice. It has exactly 16
fields in this order:

```text
format
version
matrixRevision
eventRecipeRows
eventRecipeCount
eventRecipeRowsDigest
operationSlotRows
operationSlotCount
operationSlotRowsDigest
descriptorRoleRows
descriptorRoleCount
descriptorRoleRowsDigest
witnessRecipeRows
witnessRecipeCount
witnessRecipeRowsDigest
matrixDigest
```

`format = particle-realms.m3b-projection-recipe-matrix`, `version = 1`,
and `matrixRevision = recipe-matrix:virtual-realm-m3b-v1`. The four arrays are flat siblings. No row contains
another row, rule object, callback, function, map, or executable predicate.
The exact counts are 53 primary event recipes, 130 primary operation slots,
16 descriptor roles, and one witness recipe. The 130 primary slots partition
as 12 `entity`, 14 `route`, 15 `gate`, 11 `traffic`, 25 `structure`,
and 53 `presentation` candidates. The witness's one possible presentation
candidate is carried only by its witness row, so it is not a 131st primary
operation-slot row.

Each `eventRecipeRows` member has exactly 11 fields:

```text
eventOrder
observationKind
discriminatorField
discriminatorValue
primaryProjectorId
subjectRuleId
staticRuleId
missingDisposition
operationSlotStart
operationSlotCount
rowDigest
```

`eventOrder` is dense zero-based. `discriminatorField` is `eventKind` for
46 rows and `terminalOutcome` for the seven `action-result` rows; this is a
wire field, so action-result is not a hidden special case. `operationSlotStart`
is the zero-based offset into the one flat primary slot array and
`operationSlotCount` is positive.

Each `operationSlotRows` member has exactly 12 fields:

```text
slotOrder
eventOrder
eventSlotOrder
operation
transitionRuleId
payloadRuleId
presentationRuleId
requiredDescriptorRoleIds
sourceFieldRuleId
metricRuleId
missingInputDisposition
rowDigest
```

`slotOrder` and each event-local `eventSlotOrder` are dense zero-based.
Each `descriptorRoleRows` member has exactly eight fields:

```text
roleOrder
roleId
descriptorKind
resourceKind
useClass
requiredAudienceClass
selectionRuleId
rowDigest
```

The exact role catalog is:

| Order | Role ID | Use class |
| ---: | --- | --- |
| 0 | `m3b-entity-archetype@1` | `entity-archetype` |
| 1 | `m3b-entity-accessibility-text@1` | `entity-accessibility-text` |
| 2 | `m3b-route-style@1` | `route-style` |
| 3 | `m3b-gate-style@1` | `gate-style` |
| 4 | `m3b-traffic-style@1` | `traffic-style` |
| 5 | `m3b-traffic-route@1` | `traffic-route` |
| 6 | `m3b-structure-style@1` | `structure-style` |
| 7 | `m3b-presentation-glyph-style@1` | `presentation-glyph-style` |
| 8 | `m3b-presentation-safe-text@1` | `presentation-safe-text` |
| 9 | `m3b-presentation-actor-archetype@1` | `presentation-actor-archetype` |
| 10 | `m3b-presentation-animation@1` | `presentation-animation` |
| 11 | `m3b-presentation-route-style@1` | `presentation-route-style` |
| 12 | `m3b-presentation-semantic-text@1` | `presentation-semantic-text` |
| 13 | `m3b-presentation-caption-text@1` | `presentation-caption-text` |
| 14 | `m3b-network-route-from-endpoint@1` | `local-network-from-endpoint` |
| 15 | `m3b-network-route-to-endpoint@1` | `local-network-to-endpoint` |

For every row, `descriptorKind` and `resourceKind` byte-equal its `roleId`,
`requiredAudienceClass = owner-private`, and
`selectionRuleId = selection-rule:m3b-one-authorized-bound-resource-v1`.
Each required role must resolve to exactly one code-shipped descriptor in
exactly one qualifying returned static binding. Zero matches suppress that
candidate slot; more than one match, a cross-subject match, a wrong audience,
or conflicting bytes rejects the complete batch. Network from/to roles must
resolve to two distinct local shipped endpoint IDs. They never resolve a peer,
remote identity, address, URL, station, Traveler, or Cityform.

Each `witnessRecipeRows` member has exactly ten fields:

```text
witnessOrder
witnessProjectorId
witnessProjectorVersion
inputReductionClass
inputSelectionRuleId
operation
transitionRuleId
payloadRuleId
missingInputDisposition
rowDigest
```

The sole row has `witnessOrder = 0`,
`witnessProjectorId = realm-historical-witness-projector@1`,
`witnessProjectorVersion = projector-v1`,
`inputReductionClass = historical-audit-only`,
`inputSelectionRuleId = selection-rule:m3b-first-primary-presentation-delta-v1`,
`operation = presentation`,
`transitionRuleId = transition-rule:m3b-historical-disabled-attach-v1`,
`payloadRuleId = payload-rule:m3b-historical-reuse-primary-command-v1`, and
`missingInputDisposition = zero-output`. It selects the first primary presentation
Delta in canonical Delta order. If none exists it emits zero. Otherwise it
reuses that Delta's exact `presentationCommandId`, the already listed batch
command pair, and the byte-identical protected-closure command object; it emits
only one new historical, interaction-disabled presentation Delta under the
existing historical key. It creates no command, rewrites no command field,
resolves no descriptor, and never reads raw observation bytes. The reused
primary command remains evidentiary bytes and is never executed or rendered by
the historical path; the witness Delta and disjoint store key carry the
historical classification without reinterpreting the command's original axes.

Recipe hashing is exact:

- event `rowDigest` uses
  `particle-realms.m3b-projection-recipe-event-row@1` over its first ten
  fields; `eventRecipeRowsDigest` uses
  `particle-realms.m3b-projection-recipe-event-rows@1` over all complete
  ordered 11-field rows followed by literal count 53;
- slot `rowDigest` uses
  `particle-realms.m3b-projection-recipe-operation-slot@1` over its first
  11 fields; `operationSlotRowsDigest` uses
  `particle-realms.m3b-projection-recipe-operation-slots@1` over all
  complete ordered 12-field rows followed by literal count 130;
- role `rowDigest` uses
  `particle-realms.m3b-projection-recipe-descriptor-role@1` over its first
  seven fields; `descriptorRoleRowsDigest` uses
  `particle-realms.m3b-projection-recipe-descriptor-roles@1` over all
  complete ordered eight-field rows followed by literal count 16;
- witness `rowDigest` uses
  `particle-realms.m3b-projection-recipe-witness-row@1` over its first nine
  fields; `witnessRecipeRowsDigest` uses
  `particle-realms.m3b-projection-recipe-witness-rows@1` over the complete
  ten-field row followed by literal count one; and
- `matrixDigest` uses `particle-realms.m3b-projection-recipe-matrix@1` over
  the first 15 matrix fields in displayed order.

The event table below is the complete primary constructor surface. To keep the
table readable, the following editorial aliases expand to exact wire strings;
an alias token is never encoded:

| Alias | Exact wire value |
| --- | --- |
| `B` | `realm-boot-projector@1` |
| `F` | `realm-filesystem-projector@1` |
| `ST` | `realm-storage-projector@1` |
| `PR` | `realm-process-projector@1` |
| `I` | `realm-ipc-projector@1` |
| `SC` | `realm-syscall-projector@1` |
| `A` | `realm-permission-projector@1` |
| `N` | `realm-network-projector@1` |
| `O` | `subject-rule:m3b-observation-subject-v1` |
| `FS` | `subject-rule:m3b-filesystem-subject-union-v1` |
| `C` | `static-rule:m3b-complete-singleton-v1` |
| `FM` | `static-rule:m3b-filesystem-total-structural-matrix-v1` |
| `Z` | `zero-output-no-structural` |
| `M` | `filesystem-total-structural-matrix` |

Candidate tokens occur only in manifest operation order
`E,R,G,T,S,P` = `entity,route,gate,traffic,structure,presentation`.
The token's parenthesized value is the exact desired state/class consumed by
the slot's named rule; `P(sign)+`, `P(actor)+`, and `P(route)+` select those
presentation families, plain `P+` selects the glyph family, and `P-` selects a
detach. These tokens are editorial projections of the exact slot rows, not a
runtime parser or alternative wire grammar.

| Event | Kind | Discriminator | Projector / subject / static / missing | Slot start | Count | Exact candidates |
| ---: | --- | --- | --- | ---: | ---: | --- |
| 0 | `boot` | `eventKind=phase-entered` | `B/O/C/Z` | 0 | 2 | `S(recovering), P(sign)+` |
| 1 | `boot` | `eventKind=service-ready` | `B/O/C/Z` | 2 | 4 | `E(present), G(available), S(active), P(sign)+` |
| 2 | `boot` | `eventKind=service-degraded` | `B/O/C/Z` | 6 | 2 | `S(partial), P(sign)+` |
| 3 | `boot` | `eventKind=phase-completed` | `B/O/C/Z` | 8 | 2 | `S(recovered), P(sign)+` |
| 4 | `boot` | `eventKind=boot-failed` | `B/O/C/Z` | 10 | 3 | `G(locked), S(fractured), P(sign)+` |
| 5 | `filesystem` | `eventKind=snapshot` | `F/FS/FM/M` | 13 | 3 | `E(present), S(active), P+` |
| 6 | `filesystem` | `eventKind=object-created` | `F/FS/FM/M` | 16 | 3 | `E(present), S(active), P+` |
| 7 | `filesystem` | `eventKind=object-updated` | `F/FS/FM/M` | 19 | 3 | `E(present), S(active), P+` |
| 8 | `filesystem` | `eventKind=object-moved` | `F/FS/FM/M` | 22 | 3 | `E(stale), S(stale), P+` |
| 9 | `filesystem` | `eventKind=object-removed` | `F/FS/FM/M` | 25 | 3 | `E(inactive), S(stale), P-` |
| 10 | `filesystem` | `eventKind=mount-added` | `F/FS/FM/M` | 28 | 2 | `S(recovering), P+` |
| 11 | `filesystem` | `eventKind=mount-removed` | `F/FS/FM/M` | 30 | 2 | `S(stale), P-` |
| 12 | `filesystem` | `eventKind=coverage-changed` | `F/FS/FM/M` | 32 | 2 | `S(partial), P+` |
| 13 | `storage` | `eventKind=store-mounted` | `ST/O/C/Z` | 34 | 3 | `E(present), S(active), P+` |
| 14 | `storage` | `eventKind=store-state` | `ST/O/C/Z` | 37 | 3 | `E(present:payload.lifecycleState), S(active), P+` |
| 15 | `storage` | `eventKind=usage-sampled` | `ST/O/C/Z` | 40 | 2 | `T(freight), P+` |
| 16 | `storage` | `eventKind=operation-sampled` | `ST/O/C/Z` | 42 | 2 | `T(freight), P+` |
| 17 | `storage` | `eventKind=pressure-changed` | `ST/O/C/Z` | 44 | 3 | `T(freight), S(partial), P+` |
| 18 | `storage` | `eventKind=store-unmounted` | `ST/O/C/Z` | 47 | 3 | `E(inactive), S(inactive), P-` |
| 19 | `process` | `eventKind=started` | `PR/O/C/Z` | 50 | 3 | `E(present:payload.lifecycleState), S(active), P(actor)+` |
| 20 | `process` | `eventKind=state-changed` | `PR/O/C/Z` | 53 | 3 | `E(present:payload.lifecycleState), S(active), P(actor)+` |
| 21 | `process` | `eventKind=metrics-sampled` | `PR/O/C/Z` | 56 | 2 | `T(pulse), P(actor)+` |
| 22 | `process` | `eventKind=exited` | `PR/O/C/Z` | 58 | 3 | `E(inactive), S(inactive), P-` |
| 23 | `ipc` | `eventKind=channel-opened` | `I/O/C/Z` | 61 | 2 | `R(open), P(route)+` |
| 24 | `ipc` | `eventKind=channel-state` | `I/O/C/Z` | 63 | 2 | `R(payload.lifecycleState), P(route-lifecycle)` |
| 25 | `ipc` | `eventKind=traffic-sampled` | `I/O/C/Z` | 65 | 2 | `T(conduit), P(route)+` |
| 26 | `ipc` | `eventKind=channel-closed` | `I/O/C/Z` | 67 | 2 | `R(closed), P-` |
| 27 | `syscall` | `eventKind=entered` | `SC/O/C/Z` | 69 | 2 | `R(proposed), P(route)+` |
| 28 | `syscall` | `eventKind=authority-decided` | `SC/O/C/Z` | 71 | 2 | `R(proposed), P(route)+` |
| 29 | `syscall` | `eventKind=dispatched` | `SC/O/C/Z` | 73 | 2 | `R(open), P(route)+` |
| 30 | `syscall` | `eventKind=completed` | `SC/O/C/Z` | 75 | 3 | `R(closed), T(pulse), P-` |
| 31 | `syscall` | `eventKind=denied` | `SC/O/C/Z` | 78 | 3 | `R(closed), T(pulse), P-` |
| 32 | `syscall` | `eventKind=failed` | `SC/O/C/Z` | 81 | 3 | `R(closed), T(pulse), P-` |
| 33 | `syscall` | `eventKind=cancelled` | `SC/O/C/Z` | 84 | 3 | `R(closed), T(pulse), P-` |
| 34 | `action-result` | `terminalOutcome=succeeded` | `A/O/C/Z` | 87 | 2 | `G(granted), P(sign)+` |
| 35 | `action-result` | `terminalOutcome=denied` | `A/O/C/Z` | 89 | 2 | `G(denied), P(sign)+` |
| 36 | `action-result` | `terminalOutcome=conflict` | `A/O/C/Z` | 91 | 2 | `G(locked), P(sign)+` |
| 37 | `action-result` | `terminalOutcome=expired` | `A/O/C/Z` | 93 | 2 | `G(expired), P(sign)+` |
| 38 | `action-result` | `terminalOutcome=revoked` | `A/O/C/Z` | 95 | 2 | `G(revoked), P(sign)+` |
| 39 | `action-result` | `terminalOutcome=failed` | `A/O/C/Z` | 97 | 2 | `G(locked), P(sign)+` |
| 40 | `action-result` | `terminalOutcome=cancelled` | `A/O/C/Z` | 99 | 2 | `G(locked), P(sign)+` |
| 41 | `permission` | `eventKind=decision` | `A/O/C/Z` | 101 | 2 | `G(pending), P(sign)+` |
| 42 | `permission` | `eventKind=granted` | `A/O/C/Z` | 103 | 2 | `G(granted), P(sign)+` |
| 43 | `permission` | `eventKind=denied` | `A/O/C/Z` | 105 | 2 | `G(denied), P(sign)+` |
| 44 | `permission` | `eventKind=expired` | `A/O/C/Z` | 107 | 2 | `G(expired), P(sign)+` |
| 45 | `permission` | `eventKind=revoked` | `A/O/C/Z` | 109 | 2 | `G(revoked), P(sign)+` |
| 46 | `permission` | `eventKind=policy-changed` | `A/O/C/Z` | 111 | 2 | `G(locked), P(sign)+` |
| 47 | `network` | `eventKind=discovered` | `N/O/C/Z` | 113 | 3 | `R(proposed), S(recovering), P(route)+` |
| 48 | `network` | `eventKind=route-opened` | `N/O/C/Z` | 116 | 3 | `R(open), S(active), P(route)+` |
| 49 | `network` | `eventKind=route-state` | `N/O/C/Z` | 119 | 3 | `R(payload.lifecycleState), S(payload.lifecycleState), P(route-lifecycle)` |
| 50 | `network` | `eventKind=traffic-sampled` | `N/O/C/Z` | 122 | 2 | `T(train), P(route)+` |
| 51 | `network` | `eventKind=degraded` | `N/O/C/Z` | 124 | 3 | `T(train), S(partial), P(route)+` |
| 52 | `network` | `eventKind=route-closed` | `N/O/C/Z` | 127 | 3 | `R(closed), S(inactive), P-` |

The order is the manifest observation-kind order, with action-result before
permission. `authenticated` has no recipe because accepted M3A removes
`peerIdentityRef` and makes that network event unrepresentable. An
`authenticated` input, even if valid under the broader frozen M0 contract, is
rejected before projector dispatch.

The two lifecycle-dispatch rows are closed total functions rather than free
strings. IPC `channel-state` maps `open` to route `open` plus presentation
attach/update, `degraded` to route `degraded` plus attach/update, `closed` to
route `closed` plus detach, and `revoked` to route `revoked` plus detach. Network
`route-state` maps `discovered` or `proposed` to route `proposed`, structure
`recovering`, and attach/update; `open` to route `open`, structure `active`, and
attach/update; `degraded` to route `degraded`, structure `partial`, and
attach/update; `closed` to route `closed`, structure `inactive`, and detach; and
`revoked` to route `revoked`, structure `inactive`, and detach. Any other
`lifecycleState` suppresses every slot in that row and yields the row's exact
`zero-output` primary outcome. The syscall terminal rows use route `closed`:
denial or cancellation ends one request route and does not claim that an
existing capability was revoked.

The checked-in matrix generator expands the table to literal rows once during
build; runtime code only validates and consumes those literal bytes. For each
candidate, the slot fields are exact:

- `transitionRuleId` is
  `transition-rule:m3b-<operation>-<desired-token>-v1`; the IPC and network
  lifecycle slots instead use the literal
  `transition-rule:m3b-<operation>-lifecycle-state-v1`;
- `payloadRuleId` is
  `payload-rule:m3b-<observation-kind>-<discriminator-value>-<operation>-v1`;
- `presentationRuleId` is `not-applicable` outside presentation, otherwise
  `presentation-rule:m3b-<glyph|sign|actor|route|detach>-permanent-v1`; the two
  lifecycle presentation slots instead use the literal
  `presentation-rule:m3b-route-lifecycle-v1` and select attach/update or detach
  only through the closed mapping;
- `sourceFieldRuleId` is
  `source-field-rule:m3b-<observation-kind>-<discriminator-value>-<operation>-v1`;
- `metricRuleId` is `not-applicable` outside traffic, otherwise
  `metric-rule:m3b-<observation-kind>-<discriminator-value>-six-vector-v1`; and
- `missingInputDisposition = suppress-slot`.

Angle-bracket components are substituted with the exact table literals before
hashing; the characters `<` and `>` never occur in a wire value. Desired-token
is `present`, `present-lifecycle-state`, `stale`, or `inactive` for entity;
the displayed route/gate/traffic/structure state; and `present-glyph`,
`present-sign`, `present-actor`, `present-route`, or `absent` for
presentation. Every not-applicable field carries the literal sentinel and is
never omitted or null.

Required descriptor-role arrays are exact and role-order sorted:

| Slot | Required role IDs |
| --- | --- |
| entity | `m3b-entity-archetype@1`, `m3b-entity-accessibility-text@1` |
| route, IPC or syscall | `m3b-route-style@1` |
| route, network | `m3b-route-style@1`, `m3b-network-route-from-endpoint@1`, `m3b-network-route-to-endpoint@1` |
| gate | `m3b-gate-style@1` |
| traffic slot from storage or process | `m3b-traffic-style@1`, `m3b-traffic-route@1` |
| traffic slot from IPC, syscall, or network | `m3b-traffic-style@1` |
| structure | `m3b-structure-style@1` |
| presentation glyph | `m3b-presentation-glyph-style@1`, `m3b-presentation-semantic-text@1`, `m3b-presentation-caption-text@1` |
| presentation sign | `m3b-presentation-glyph-style@1`, `m3b-presentation-safe-text@1`, `m3b-presentation-semantic-text@1`, `m3b-presentation-caption-text@1` |
| presentation actor | `m3b-presentation-actor-archetype@1`, `m3b-presentation-animation@1`, `m3b-presentation-semantic-text@1`, `m3b-presentation-caption-text@1` |
| presentation route | `m3b-presentation-route-style@1`, `m3b-presentation-semantic-text@1`, `m3b-presentation-caption-text@1` |
| presentation detach | empty; reuse the verified current command and handle class |

The binding subject is `payload.objectId` for filesystem and
`observation.subjectId` for every other kind. A slot candidate consists of one
returned binding for that subject, one anchor in both its exact
`sourceAnchorIds` and the subject row's `allowedAnchorIds`, and exactly one
returned descriptor/resource match for every required role. The compiler
enumerates one `(bindingId, anchorId)` candidate for every such anchor after all
role matches succeed. Zero fully matching candidates suppresses that slot,
exactly one selects it, and more than one—including one otherwise valid binding
with multiple qualifying anchors—rejects the batch as authoring ambiguity.
Every descriptor byte-matches one
returned shipped `ResourceReferenceV1` on ID, kind, content ID, byte length,
and owner-private audience. Malformed, conflicting, or cross-subject rows
reject rather than suppress. The selected anchor and descriptor identities are
data, never array-first, nearest-object, map-order, or renderer choices.

Every primary Delta uses this exact common envelope:

- projector ID/version from the manifest row and operation from the slot;
- payload primary ID copied to envelope `subjectId` and the one selected anchor
  copied to envelope `anchorId`;
- `inputObservationIds` equal to the one-element array containing the exact
  source observation ID;
- `audienceClass`, evidence quality, availability, freshness, temporal mode,
  and assertion byte-copied from the observation, with provenance fixed to
  `derived`;
- `logicalTick = inputCut.logicalTick`; current-eligible traffic Deltas use
  `expiryTick = decimal(min(UINT64_MAX, BigInt(inputCut.logicalTick) + 1n))`,
  every other primary Delta uses `expiryTick = "0"`, and `bridgeEpoch` is
  absent; and
- `bakeRevision = "bake-revision:m3b:" + hex(H(
  particle-realms.m3b-delta-bake-revision@1, activeBakeId,
  activeBakeRevision, activeBakeOutputRecordDigest))`.

The three bake inputs are the exact accepted runtime-binding facts. Observed-at,
fresh-until, permission expiry, wall time, frame time, and callback time never
become logical or expiry ticks.

The payload constructors are complete:

- Entity uses the binding subject as `entityId`, the selected entity-archetype
  and accessibility-text resources, and the selected anchor. Default
  `present` writes semantic state `active`; the two
  `present-lifecycle-state` recipes copy `payload.lifecycleState`; `stale` and
  `inactive` write those exact states.
- Structure uses the binding subject as `structureId`, the displayed state,
  and copies a safe source `reasonCode` only when that field is present.
- Gate uses the binding subject as `gateId` and the displayed state. It copies
  a safe reason when present; `denied` and `revoked` require one. It always
  omits the optional payload expiry because M3B cannot reinterpret authority
  or wall-clock expiry as a Realm logical tick.
- Route uses the binding subject as `routeId`, an empty metrics array,
  `expiryTick = "0"`, and one exact source epoch. IPC normalizes producer and
  consumer by direction; bidirectional endpoints sort by code point. Syscall
  uses actor then target and suppresses the slot when `targetObjectId` is
  absent or equal. Network uses the two distinct local endpoint-role resource
  IDs. Route domains are `ipc`, `syscall`, and `network`; route classes are
  `payload.ipcKind`, `payload.syscallClass`, and `payload.routeClass`.
  IPC and syscall endpoint IDs are byte-identical M3A-authorized local opaque
  fields. They are never resolved as anchors, used to probe static state, or
  converted into geometry; the selected subject binding and its sole anchor
  locate the abstract non-traversable route visualization.
  IPC uses its M3A source generation, syscall uses `capabilityEpoch` when
  present and otherwise its source generation, and network uses
  `transportEpoch`. Traversal is always `non-traversable` for IPC, syscall, and
  network in base M3B. A later stage may admit authored navigation only after it
  defines and verifies an explicit corridor contract and descriptor role.
- Traffic uses the binding subject as `trafficId` and the displayed exact
  `freight`, `pulse`, `conduit`, or `train` kind. IPC, syscall, and network use
  the binding subject as `routeId`; storage and process use the selected
  `m3b-traffic-route@1` resource ID. The six metrics are always present in
  throughput, latency, jitter, loss, queue, and backpressure field order.
- Presentation present constructs one existing
  `RealmPresentationCommandV1` family; detach reuses the verified prior
  command. The module creates the one immutable adapter
  `presentationCommandContentContract =
  canonicalRealmContractFromDefinition(RealmPresentationCommand.definition)`
  at initialization. The pure compiler creates `commandWithoutId` with exactly
  `format`, `version`, and the 16 fields in
  `RealmPresentationCommand.canonicalPayloadFields`, with no `commandId`, then
  computes `commandContentDigest =
  computeRealmContentId(commandWithoutId,
  presentationCommandContentContract)`. The existing M0 content contract
  excludes its self identity. The compiler then sets
  `commandId = "command:m3b:" + hex(H(
  particle-realms.m3b-presentation-command-id@2, runtimeBindingDigest,
  projectorId, observationId, slotOrder, bindingSubjectId, selectedAnchorId,
  commandKind, commandContentDigest))`, validates the complete command bytes,
  recomputes the external content digest with the same adapted contract, and
  requires byte equality. Passing the raw record definition to
  `computeRealmContentId`, hashing a placeholder `commandId`, or adapting a
  second contract is invalid.
  It uses the binding subject, selected anchor, owner-private audience, the
  Delta's semantic axes, `sourceRefs = [observationId]`,
  `logicalStartTick = inputCut.logicalTick`, and
  `logicalEndTick = "18446744073709551615"`. Sign parameters use safe-text and
  glyph-style roles; glyph parameters use glyph-style with reveal fraction
  exactly one; actor parameters use actor-archetype and animation; route
  emphasis uses the binding subject and route-style. Accessibility uses the
  semantic-text and caption-text roles. Reversibility is
  `cleanupKind = dispose-handle` and
  `handleClass = m3b-projection-command`; the presentation Delta's handle
  class byte-equals it.

Traffic metric lowering never drops a mandatory dimension. Storage maps rate
to throughput, queue to queue, and pressure to backpressure. IPC maps
throughput, latency, queue, and backpressure. Syscall maps duration to latency
and queue to queue. Network maps throughput, latency, jitter, loss, and
backpressure. Process selects exactly one source metric with the target
`metricKind`; zero produces not-applicable and more than one suppresses the
slot. A mapped metric fixes the target kind and copies value, unit, evidence,
sample window, source sequence, and optional minimum/maximum. Every unmapped
dimension is a complete existing M0 metric with format
`particle-realms.realm-metric-value`, version one, the exact target kind, value
zero, unit and evidence quality `not-applicable`, sample-window ticks zero,
`sourceSequence = observation.sourceSequence`, and minimum/maximum absent.

Transition selection is prior-state total. Entity `present` applies activate
from absent/deactivated and update from active/stale; entity `stale` applies
mark-stale from active/stale; entity `inactive` applies deactivate from
active/stale; other combinations suppress. Route desired proposed/open/
degraded/closed/revoked applies the existing legal M0 transition, while absent
open/degraded starts conservatively at propose and closed/revoked may restart
only at a strictly newer source epoch, also as propose. Presentation present
attaches from absent/deactivated and updates from active/stale; absent detaches
from active/stale; other combinations suppress. Gate, traffic, and structure
are complete replacements.

Valid absence of a required binding, role, optional source value, prior entry,
or a legal no-op transition suppresses only that slot. An unlisted recipe,
malformed/conflicting record, more than one fully matching candidate,
illegal transition, wrong payload, wrong count/digest, or output beyond the
declared slots rejects the complete batch. If all slots suppress, a
non-filesystem observation records `zero-output`; filesystem follows its total
structural matrix to `zero-output` or `structural-intent-only`. Diagnostics use
only the existing bounded `input-rejected` or `batch-quarantined` top-level
code and integer counters; descriptor IDs, command bytes, peer fields, and
free-form reasons remain absent.

## `RealmProjectionDisclosurePolicyV1`

The policy has exactly 11 top-level fields:

```text
format
version
policyId
audienceClass
disclosureClass
semanticAxisTransitionPolicyId
semanticAxisTransitionPolicyDigest
observationKindOrder
ruleRows
policyRevision
policyDigest
```

It contains exactly nine rules in manifest observation-kind order. Each rule has
exactly 13 fields:

```text
ruleOrder
observationKind
requiredInputAudienceClass
requiredInputDisclosureClass
allowedProvenanceClasses
allowedEvidenceQualities
allowedAvailabilityStates
allowedFreshnessStates
allowedTemporalModes
allowedAssertionStates
disclosureDisposition
omissionReasonCodes
ruleDigest
```

`requiredInputAudienceClass` is `owner-private`.
`requiredInputDisclosureClass` is `local-private`.
`disclosureDisposition` is `include-byte-identical-or-omit`.

All nine base rows use these exact ordered sets; the kind and rule digest remain
distinct per row:

```text
allowedProvenanceClasses = [observed, derived]
allowedEvidenceQualities = [exact, measured, computed, estimated, unknown, not-applicable]
allowedAvailabilityStates = [available, sealed, denied, partial, absent]
allowedFreshnessStates = [current, stale, expired, unknown]
allowedTemporalModes = [live, historical]
allowedAssertionStates = [confirmed, proposed, hypothetical]
```

The nine rows, in order, bind `boot`, `filesystem`, `storage`, `process`, `ipc`,
`syscall`, `action-result`, `permission`, and `network` to those literal sets,
the fixed owner-private/local-private requirements, the common transition-policy
pair at policy scope, and a separately recomputed rule digest. The transition
pair is not silently implied as a fourteenth rule field; it must match the pair
in the 53-field runtime binding exactly.

The closed omission reasons are:

```text
availability-not-admitted
freshness-not-admitted
temporal-mode-not-admitted
assertion-state-not-admitted
provenance-not-admitted
evidence-quality-not-admitted
```

A malformed record, invalid digest, unknown/unowned kind, audience or disclosure
mismatch, unknown rule, extra field, policy structural/revision mismatch, or
binding mismatch rejects the complete input cut. Those conditions are not
omission reasons. Omission is a valid semantic-policy decision over a valid
byte-identical M3A observation.

## `RealmProjectionInputCutV1`

The input cut has a closed 28-field top-level vocabulary:

```text
format
version
inputCutId
cutKind
runtimeBindingId
runtimeBindingDigest
projectionSequence
expectedAppliedCursorId
expectedAppliedCursorDigest
logicalTick
sourceStateSlots
sourceStateSnapshotId
sourceStateSnapshotDigest
observationBatchId
observationBatchDigest
observationBatchSequence
vectorWatermarkBefore
vectorWatermarkAfter
ledgerAppendReceiptId
ledgerAppendReceiptDigest
authorityEvidenceRows
authorityEvidenceCount
authorityResolutionReceiptId
authorityResolutionReceiptDigest
expiryDueReceiptId
expiryDueReceiptDigest
expiryBoundaryTick
cutDigest
```

`cutKind` is exactly one of:

| Kind | Required variant fields | Prohibited variant fields |
| --- | --- | --- |
| `observation-batch` | Batch ID/digest/sequence, before/after watermarks, append receipt pair, authority rows/count and one authority-resolution receipt pair, exact batch-associated source snapshot | Expiry-due pair and `expiryBoundaryTick` |
| `source-state` | Exact changed source snapshot whose durable logical tick is the cut tick; every newly due expiry meet is applied in the same cut | Every batch, watermark, append, authority, and expiry-due/boundary field |
| `expiry` | Exact newer source snapshot with unchanged seven slot bytes, an exact expiry-due receipt pair, and `expiryBoundaryTick` equal to the least finite expiry strictly above the prior frontier and at or below the snapshot tick | Every batch, watermark, append, and authority field |

The binding pair, projection sequence, logical tick, exact seven
`sourceStateSlots`, source-state snapshot pair, and cut digest are common.
The expected cursor pair is required together when a current M3B head exists
and absent together only for the first `observation-batch` genesis cut after an
exact empty-head read. A source-state or expiry event before that first batch
changes no derived state and creates no M3B artifact.

That genesis request is exact: the reader request has `afterBatchSequence = 0`,
the returned verified M3A batch has `batchSequence = 1`, the M3A retained floor
permits sequence 1, and the append/head evidence names that same first batch. An
empty M3B head never authorizes skipping retained M3A history. Any other first
available sequence enters M3A recovery or static fallback and creates no M3B
root.

Each source slot is byte-identical to M3A's closed 11-key
`sourceCursorSlots` vocabulary: `sourceOrder`, `sourceId`,
`sourceDescriptorDigest`, `sourceState`, `cursorPresence`, `sourceCursor`,
`terminalAcquisitionReceiptId`, `terminalAcquisitionReceiptDigest`,
`latestRecoveryReceiptId`, `latestRecoveryReceiptDigest`, and `slotDigest`.
The exact own-key variants are preserved: accepted live without recovery has
seven keys; accepted with recovery or accepted stale/recovering/unavailable/
quarantined has nine; absent unavailable/quarantined has eight with the terminal
acquisition pair and without cursor/recovery fields. M3B never fills a
conditionally absent key with `null` and never invents cursor or recovery
evidence. Every cut carries exactly seven slots.

For an accepted slot, the only source-generation extractor is the nested
`sourceCursor.sourceGeneration` field of the complete verified
`RealmObservationSourceCursorV1`. No slot-level field is inferred or invented.
An absent slot has no source generation and is ineligible by definition.

Each authority-evidence row has exactly eight fields:

```text
evidenceOrder
observationOrdinal
observationId
observationDigest
authorityReceiptId
authorityReceiptDigest
recordedValidationDisposition
rowDigest
```

Under the frozen M3A schemas, every structurally valid permission or action-
result observation necessarily names an authority receipt. Rows exist for every
such observation in the frozen batch, whether the later pure disclosure
decision includes or omits it. Resolution therefore
has no dependency on the not-yet-frozen decision set. An included authority-
domain outcome may reference only its matching row; an omitted observation
produces no projector outcome. `recordedValidationDisposition` is exactly
`verified-recorded-chain`; the complete canonical receipt bytes and external
signature envelope are protected closure entries, not duplicated in the row.
The input-cut resolution receipt covers only the complete ordered recorded row
set, count, canonical byte total, trust roots, and recorded decision/dispatch
correlation. It deliberately excludes the current-authority snapshot, which is
bound only by the ephemeral presentation fence. Empty recorded authority input
still requires one verified empty resolution receipt for an observation-batch
cut.

For an observation batch, `logicalTick` equals the exact committed M3A append
receipt's `issuedLogicalTick`. For a source-state cut it equals the durable
source-state snapshot tick. For expiry it also equals the newer source-state
snapshot tick and must be greater than or equal to `expiryBoundaryTick`; the
due receipt proves both values from M3A-owned tick evidence. Context
read time, wall time, wake time, retry time, and frame time are prohibited. An
empty read with an unchanged seven-slot snapshot creates no cut, batch, cursor,
or root.

All three values occupy M3A's frozen logical-tick domain and must be
nondecreasing relative to the prior root. A regressing source-owned tick rejects
the cut and preserves current state. Retry and replay reuse the same evidence
bytes and tick; delivery delay can never rewrite it. `projectionSequence` is a
separate counter fixed to one at genesis and prior plus one thereafter.

Changing operator, M2/M3A binding, pseudonym epoch, bake, layout, static store,
or projection index is not a cut. The old entry retires behind its own prebound
ports, the complete M2 static city remains selected during the interval, and a
new binding starts a separate genesis or hands bake/layout divergence to M3C.

## `RealmDisclosureDecisionSetV1`

The decision set has exactly 17 top-level fields:

```text
format
version
decisionSetId
runtimeBindingId
runtimeBindingDigest
inputCutId
inputCutDigest
disclosurePolicyId
disclosurePolicyDigest
decisions
includedObservationIds
includedObservationDigests
omittedObservationIds
omittedObservationDigests
includedCount
omittedCount
decisionSetDigest
```

Each decision uses a closed eight-field vocabulary:

```text
observationOrdinal
observationId
observationDigest
observationKind
disposition
omissionReasonCode
policyRuleDigest
decisionDigest
```

`disposition` is `included` or `omitted`. `included` omits
`omissionReasonCode` and preserves the exact M3A ID, digest, and canonical bytes.
`omitted` requires one policy-owned reason and carries no observation payload
bytes. Every input observation has exactly one decision in batch order. The four
ID/digest arrays are complete projections of the decision rows. Non-observation
cuts use one exact empty decision set.

M3B never redacts, tokenizes, rounds, hashes, or rewrites an included record.
Any later public or refinement disclosure uses a separately gated package and
must not reuse this owner-private identity.

## `RealmProjectionBatchV1`

The projection batch has a closed 41-field top-level vocabulary:

```text
format
version
projectionBatchId
realmId
runtimeBindingId
runtimeBindingDigest
profileId
profileDigest
contractCatalogId
contractCatalogDigest
domainManifestId
domainManifestDigest
disclosurePolicyId
disclosurePolicyDigest
inputCutId
inputCutDigest
disclosureDecisionSetId
disclosureDecisionSetDigest
projectionSequence
m3aBatchSequence
staticResolutionReceiptId
staticResolutionReceiptDigest
staticBindingIds
staticBindingDigests
primaryProjectionOutcomeRows
historicalWitnessOutcomeRows
maintenanceOutcomeRows
deltaIds
deltaDigests
presentationCommandIds
presentationCommandDigests
deltaCount
deltaByteCount
operationCounts
dirtySemanticKeys
structuralIntentEvidenceRows
structuralIntentEvidenceCount
maintenanceMutationCount
maintenanceMutationByteCount
workUnitCount
batchDigest
```

`m3aBatchSequence` is present only for an `observation-batch` cut. Every included
observation has exactly one primary outcome row. The static-resolution pair is
required for that cut even when both binding arrays are empty; maintenance cuts
omit the pair and require empty binding arrays. The pair may bind only a
`complete` receipt or an admissible `partial-missing` negative-evidence receipt
under the structural matrix below. In either case, `staticBindingIds` and
`staticBindingDigests` are the equal-length, pair-indexed, code-point-sorted
unique projection of every verified present projection-binding record returned
by the receipt; a missing subject contributes no binding, descriptor, resource,
anchor, or lease target. Each primary row has a closed 16-field vocabulary:

```text
observationOrdinal
observationId
observationDigest
observationKind
primaryProjectorOrder
primaryProjectorId
primaryProjectorVersion
disposition
reductionClass
authorityReceiptIds
authorityReceiptDigests
deltaIds
deltaDigests
structuralIntentEvidenceIds
structuralIntentEvidenceDigests
outcomeDigest
```

The closed dispositions are:

```text
emitted
zero-output
emitted-with-structural-intent
structural-intent-only
```

The disposition fixes the nested output cardinality and is not descriptive
metadata: `emitted` requires one or more delta pairs and zero structural pairs;
`zero-output` requires both pair arrays empty;
`emitted-with-structural-intent` requires one or more delta pairs and exactly
one structural pair; and `structural-intent-only` requires zero delta pairs and
exactly one structural pair. Each ID/digest array pair has equal length and is
the exact stable projection of the matching canonical row(s). A structural pair
must resolve to the sole top-level structural row for the same source
observation. Changing an empty/nonempty combination without changing the
disposition rejects the complete batch.

`reductionClass` is `current-eligible` for an admitted live observation and
`historical-audit-only` for an admitted historical observation. Authority arrays
are equal-length, sorted, and empty except for the authority-domain row; every
nonempty pair must equal one input-cut `authorityReceiptId`/
`authorityReceiptDigest` pair at the same observation ordinal. The outcome does
not invent a second authority-evidence identity. A projector error
rejects the complete batch, so a successful outcome row never contains
`rejected`. Each emitted primary delta appears in exactly one outcome row.
Outcome count equals included count.

`presentationCommandIds` and `presentationCommandDigests` are equal-length,
pair-indexed arrays sorted uniquely by command ID. Each digest is the external
`computeRealmContentId(command, presentationCommandContentContract)` result,
with exact shape `sha256:256:<64hex>` and content domain
`particle-realms.content.particle-realms.realm-presentation-command.v1`;
`RealmPresentationCommandV1` itself has no digest field. Every admitted
presentation Delta resolves its ID-only `presentationCommandId` to exactly one
array pair and exactly one protected-closure command byte sequence. Every listed
pair and command object is cited by at least one admitted presentation Delta.
Same ID/different digest, a missing/extra pair, an uncited object, bytes that do
not recompute the external digest, or more than one object for a pair rejects
the complete batch. Maintenance batches require both arrays empty. There is no
separate command count or byte count: array length is the count, command bytes
charge protected-closure entry/byte accounting exactly once, and newly
traversed commands charge the existing closure work component exactly once.

Each admitted historical observation has exactly one witness outcome row with a
closed 12-field vocabulary:

```text
witnessOrder
sourceObservationOrdinal
sourceObservationId
sourceObservationDigest
primaryOutcomeDigest
witnessProjectorId
witnessProjectorVersion
disposition
deltaId
deltaDigest
historicalSemanticKey
outcomeDigest
```

`disposition` is `zero-output` or `emitted`. The delta pair and historical key
are present only for `emitted`. The witness consumes the complete frozen primary
outcome exactly once, never raw or omitted observation bytes, and cannot consume
another witness. Its optional delta is a noninteractive historical presentation
artifact in a binding-namespaced keyspace. Historical primary deltas remain
audit closure only; neither they nor the witness artifact can enter current
DynamicStore keys, ECS, State-First, picking, collision, navigation, gates, or
authority.

A source-state or expiry cut has exactly one maintenance outcome row and no
primary/witness outcome or M0 delta. Each maintenance row has a closed 14-field
vocabulary:

```text
maintenanceOrder
maintenanceKind
sourceStateSnapshotId
sourceStateSnapshotDigest
expiryBoundaryTick
priorDynamicStoreSnapshotId
priorDynamicStoreSnapshotDigest
affectedSourceOrders
cleanupEntryIds
cleanupEntryDigests
disposition
mutationCount
mutationByteCount
outcomeDigest
```

`maintenanceKind` is `source-health-overlay` or `expiry-boundary`. The first
requires the source-state pair and nonempty sorted source orders and omits the
expiry field; the second requires the expiry field and omits affected source
orders. Cleanup arrays are equal-length, sorted, and capped independently; they
may be empty because the source/generation and expiry meets make the safety
effect immediate without rewriting every retained entry. `disposition` is
`overlay-updated`, `boundary-advanced`, or `updated-with-cleanup`.

Expiry selection is progress-strict. The selected boundary is the least finite
entry expiry strictly greater than the prior snapshot's
`effectiveLogicalTick` and at or below the exact due receipt's current logical
tick; a boundary at or below the prior tick is already masked and is never
selected again. A committed expiry cut advances the effective tick to the due
receipt's current logical tick even when cleanup arrays are empty, so every
crossed boundary becomes ineligible in the same atomic bundle. Cleanup is deterministic
bounded reclamation piggybacked on that state advance or a later legitimate cut;
cleanup alone cannot mint another root at the same boundary. If no strictly
greater and durably due boundary exists, no expiry cut or artifact is created.

Each structural-intent evidence row has exactly 11 fields:

```text
evidenceOrder
evidenceId
sourceObservationId
sourceObservationDigest
sourceEventKind
primaryProjectorId
affectedExistingSubjectIds
affectedExistingAnchorIds
changeKinds
disposition
evidenceDigest
```
The closed dispositions are `stale-only`,
`partial-only`, `absent-only`, and `m3c-review-only`. There is at most one row
per source observation; it may aggregate bounded sorted affected IDs. The row is
powerless evidence. It is not `RealmTopologyChangeSetV1`, a bake request, an
activation offer, a topology intent, or authority to change static form.

`sourceEventKind` is not a new vocabulary. It byte-equals the exact
`payload.eventKind` in the bound source observation and must be one event
admitted for that observation kind by the frozen event/operation matrix below.
`affectedExistingSubjectIds` and `affectedExistingAnchorIds` are independently
code-point-sorted unique arrays of already resolved static IDs; an unknown ID
cannot be smuggled into either array.

Static resolution is sequenced after disclosure. For an included non-filesystem
observation, the exact subject projection `S(o)` is the singleton
`[observation.subjectId]`. For an included filesystem observation, `S(o)` is the
code-point-sorted unique union of:

```text
observation.subjectId
payload.objectId
payload.parentId when present
payload.previousParentId when present
every payload.relationshipChanges[].relatedObjectId
```

The `resolveStatic.observationSubjectIds` request is exactly the code-point-
sorted unique union of all included `S(o)` sets. Omitted observations contribute
nothing, and callers cannot add a probe ID. For each included observation, the
receipt's subject rows partition `S(o)` into exact resolved set `R` and
missing set `M`. A `partial-missing` receipt is admissible only when every
missing ID belongs to at least one included `S(o)` and no emitted Delta names a
missing subject or an anchor derived from one. A missing non-filesystem
singleton deterministically produces a `zero-output` primary outcome and no
structural row. Filesystem missing sets alone use the total structural matrix
below. No missing ID from either class may be probed, silently ignored,
converted to an invented anchor, or represented as a partial dynamic object.

Structural row production is the following total, ordered decision matrix:

| Condition, in precedence order | Row | `changeKinds` | Affected subjects | Affected anchors | Primary delta rule |
| --- | --- | --- | --- | --- | --- |
| `M` nonempty and `R` empty | `absent-only` | exactly `[unbound-static-subject]` | `[]` | `[]` | exactly zero |
| `M` nonempty and `R` nonempty | `partial-only` | exactly `[existing-bound-object-partial]` | exactly `R` | `[]` | exactly zero |
| `M` empty and event is `object-removed` or `mount-removed` | `stale-only` | exactly `[existing-bound-object-stale]` | exactly `R` | exact union of the `R` rows' `allowedAnchorIds` | frozen event/operation projection may emit only resolved-subject deltas |
| `M` empty and event is `object-moved`, `mount-added`, or `coverage-changed` | `m3c-review-only` | exactly `[m3c-topology-review-required]` | exactly `R` | exact union of the `R` rows' `allowedAnchorIds` | frozen event/operation projection may emit only resolved-subject deltas |
| `M` empty, event is `snapshot`, `object-created`, or `object-updated`, and `relationshipChanges` is nonempty | `m3c-review-only` | exactly `[m3c-topology-review-required]` | exactly `R` | exact union of the `R` rows' `allowedAnchorIds` | frozen event/operation projection may emit only resolved-subject deltas |
| `M` empty, event is `snapshot`, `object-created`, or `object-updated`, and `relationshipChanges` is empty | no row | none | none | none | normal frozen event/operation projection |

Removal precedence is evaluated before the relationship-change rule. Thus a
removal with relationship rows remains `stale-only`. `changeKinds` has exactly
the four values appearing in this matrix; `fractured` and `recovering` remain
valid dynamic presentation states but are not structural-evidence kinds. There
is exactly one row if and only if the matrix selects one, and `evidenceOrder` is
dense in canonical source-observation order among selected rows. A selected row
with zero deltas requires primary disposition `structural-intent-only`; one with
resolved-subject deltas requires `emitted-with-structural-intent`. Mixing rows,
inventing anchors, falling back to `anchor:root`, emitting for a missing set,
or changing any projection rejects the complete batch.

Each `operationCounts` row has exactly eight fields:

```text
operationOrder
operation
currentEligibleDeltaCount
historicalPrimaryAuditCount
historicalWitnessDeltaCount
deltaCount
deltaByteCount
rowDigest
```

There are always exactly six rows. They use dense `operationOrder = 0..5` and
the manifest's exact `outputOperationOrder` values `entity`, `route`, `gate`,
`traffic`, `structure`, and `presentation`; an operation with no delta still
has its all-zero row. For each row,
`deltaCount = currentEligibleDeltaCount + historicalPrimaryAuditCount +
historicalWitnessDeltaCount`, and `deltaByteCount` is the exact sum of complete
canonical `RealmDeltaV1` bytes assigned to those three partitions for that
operation. Each emitted delta occurs in exactly one operation row and exactly
one partition. Batch `deltaCount` and `deltaByteCount` equal the sums of the six
row values.

`deltaIds` and `deltaDigests` are equal-length complete projections of canonical
delta order, including historical audit-only deltas. Structural row count equals
`structuralIntentEvidenceCount` and never exceeds included count. Maintenance
mutation totals equal the maintenance rows and are zero for an observation-
batch cut. A source-state or expiry cut still carries all six all-zero operation
rows because maintenance never emits a Delta. Omitting zero rows, using an empty
`operationCounts` array, double-assigning a delta, or making a row/aggregate
count or byte total disagree rejects the complete batch.

The projection-batch `dirtySemanticKeys` array is code-point-sorted unique and
has at most `maximumDirtyEntriesPerBatch` values. For an observation-batch cut
it is the exact projection of the M0 semantic key derived from every
`current-eligible` primary delta and excludes every historical-primary and
historical-witness key. For a maintenance cut it is the exact projection of the
prior-store semantic keys named by the cleanup entry pairs; a source-health or
expiry overlay change with no cleanup therefore has an empty array. This array
records bounded entry writes/removals, not the number of entries whose effective
eligibility is masked by the constant-size source/expiry overlays. The pure
reducer must reproduce the identical key array before candidate construction;
an extra, omitted, reordered, historical, or no-longer-resolving key rejects the
batch.

## Deterministic projection order and identity

M3B uses this complete order:

1. Verify exact M3A batch, record, append, source-state, recovery, and binding
   bytes.
2. Preserve M3A canonical record order.
3. Apply the nine disclosure rules in record order.
4. For an observation cut, derive the exact included-observation subject union,
   resolve it once, and freeze/reassert either complete or admissible partial-
   missing static evidence; a maintenance cut skips static resolution.
5. Expand primary candidates in manifest projector and source-observation order;
   freeze each slot's `candidateSubjectId` from the payload primary-ID rule and
   `candidateAnchorId` from the unique selected static anchor; derive its stable
   entity ID and current or prospective semantic key from those pre-projector
   values; partition work by `reductionClass`; sort each partition by
   `(semanticKey, observationOrdinal, slotOrder)`; run the `current-eligible`
   partition through its exact sequential `transitionBase` chain and the
   `historical-audit-only` partition through read-only bases; then collect all
   three work-product siblings and regroup them into canonical outcome order.
6. Validate every command byte sequence, derive its external content digest,
   build the code-point-sorted unique command pair arrays, and prove every pair,
   object, and ID-only presentation-Delta reference joins exactly.
7. Freeze every primary outcome, then run the historical witness once per
   eligible historical primary outcome by reusing the selected primary command.
8. For a maintenance cut, run the one pure maintenance compiler instead of
   disclosure, static resolution, projector, command, or witness construction.
9. Sort all Deltas by this tuple:

```text
inputObservationOrdinal
projectorOrder
operationOrder
subjectId
anchorId
deltaId
```

10. Reduce every `current-eligible` same-semantic-key sequence through the exact
    in-batch transition-chain rule below and retain only its final candidate
    state. Historical-primary work never joins or advances this chain.
11. Run the exact pre-freeze work-count pass, then freeze operation counts,
    dirty keys, structural/maintenance evidence, command pairs, work count,
    batch ID, and batch digest.

M3B never defines an M3B-specific delta ID preimage. `deltaId` and
`deltaDigest` are computed only through the frozen M0 `RealmDeltaContract` over
its exact 18 canonical payload fields and existing format/domain/version rules.
Nested payload identity/digest also uses the existing operation-specific M0
contract. The envelope `subjectId`, `anchorId`, operation, semantic axes, and
payload identifiers cross-bind exactly.

Runtime binding, profile/catalog/policy, observation digests, projector order,
output ordinal, authority/static resolution, and reduction class are not silently
inserted into the M0 preimage. They are bound by the primary/witness outcome,
projection batch, protected closure manifest, and root. This preserves the
frozen M0 catalog while still making an M3B batch context-complete.

Every base-M3B primary Delta cites exactly one observation ID in
`RealmDeltaV1.inputObservationIds`. M3A metric-coalescing groups remain verified
batch evidence but never create a multi-observation M3B delta; each retained
observation gets its own decision and primary outcome. This removes ambiguous
cross-owner chunk identity and keeps the frozen M0 canonical-string-set rule.

Wall time, `Date.now()`, frame number, RAF order, worker completion, promise
settlement, callback arrival, map insertion, locale sorting, renderer order, and
GPU state never enter projection identity.

Multiple admitted `current-eligible` lifecycle observations may legally address
the same semantic key in one M3A batch. M3B therefore does not reject a current
key merely because its canonical sequence contains more than one nonidentical
Delta. For each current key,
the reducer requires one channel, payload primary ID, static target, anchor,
and primary projector across the sequence and strictly increasing observation
ordinals. It validates the first write against the verified prior state, then
validates each later write against the immediately preceding in-batch candidate
using the recipe matrix's transition rule. Every Delta and primary outcome
remains in audit closure and in the batch's operation counts; only the final
candidate is written to DynamicStore, projected to ECS/State-First, and counted
once in `dirtySemanticKeys`. A repeated ordinal, conflicting identity, channel,
anchor, static target, or projector, or any illegal intermediate transition
rejects the complete batch. Thus `started -> state-changed`,
`proposed -> open`, and similar legal sequences are deterministic without
hiding their evidence or depending on delivery timing.

## Projector protocol

Before calling a primary projector, the coordinator expands every included
observation into its literal slot work items. For each slot it freezes
`candidateSubjectId` from the slot's exact payload primary-ID rule and
`candidateAnchorId` from the unique binding/anchor candidate before projector
execution. It derives `stableEntityId` from those values, derives the current or
prospective semantic key without reading projector output, partitions by the
observation's deterministic `reductionClass` that will later be frozen in its
primary outcome, and sorts each partition by
`(semanticKey, observationOrdinal, slotOrder)` using code-point order for the
key and numeric order for the integers. It runs `current-eligible` work first
and `historical-audit-only` work second, then constructs one service-local
`transitionBase` per slot. `candidateSubjectId` and `candidateAnchorId` are
bounded coordinator work-item values, not transition-base fields or durable
schema additions. The transition base has the following closed 14-field
vocabulary:

```text
baseKind
semanticKey
channelKind
stableEntityId
sourceEntryId
sourceEntryDigest
sourceEntryCanonicalBytes
sourceDeltaId
sourceDeltaDigest
sourceDeltaCanonicalBytes
presentationCommandId
presentationCommandDigest
presentationCommandCanonicalBytes
transitionBaseDigest
```

`baseKind = empty` has five own keys: the first four common fields and the
digest. `retained-entry` has the common fields, the complete source-entry triple,
the complete source-Delta triple, and the digest; it also has the three command
fields exactly when that Delta names a presentation command. `in-batch-candidate`
omits the source-entry triple, requires the immediately preceding accepted
same-key Delta triple, conditionally carries that Delta's command triple, and
includes the digest. No field is `null`. The digest uses
`particle-realms.m3b-transition-base@1` over a 13-position presence vector and
the ordered present field rows. Every pair and byte sequence is independently
verified; the semantic key, channel, stable entity, Delta payload, entry, and
optional command must agree.

The first `current-eligible` slot for a key selects `empty` or the exact retained
current entry from the single fenced prior-state bundle. Each later accepted
current slot for that key selects `in-batch-candidate` and carries the
immediately preceding accepted current Delta; a suppressed current slot never
advances the chain. Each `historical-audit-only` slot independently selects only
`empty` or a matching `retained-entry` from that original fenced prior bundle,
using its prospective current key solely as a nondurable lookup/grouping value.
It never consumes or produces an `in-batch-candidate`, never sees a candidate
created by another slot in this batch, never advances another historical slot,
and cannot change a current chain, dirty key, store entry, ECS row, or State-
First row. No projector sees a map, callback, live store, or second read.
Trusted prepare rebuilds both sorted partitions and every transition base
independently from the same prior bundle and earlier current-only pure outputs,
then requires byte equality before accepting the batch.

Before accepting any work product, the coordinator requires the emitted Delta's
`subjectId` and `anchorId` to be byte-identical to the slot's frozen
`candidateSubjectId` and `candidateAnchorId`; its semantic key, payload primary
ID, channel, stable entity, and transition base must agree with those same
pre-projector values. A projector cannot choose or repair identity after seeing
the base.

Every primary projector is a side-effect-free value transformer with the same
conceptual surface:

```text
project({
  runtimeBinding,
  inputCut,
  disclosureDecision,
  observationBytes,
  verifiedStaticBindings,
  verifiedAuthorityEvidence,
  transitionBase,
  logicalTick,
  profile,
  manifestRow,
  recipeMatrix,
  semanticAxisTransitionPolicy
}) -> {
  primaryOutcome,
  deltaCanonicalBytes,
  presentationCommandCanonicalBytes
}
```

This is a service-local, nondurable three-part work product, or three flat
sibling return values. It is not a registered definition, object authority,
root, or persistence surface. The coordinator validates all three parts,
projects the command pairs into the 41-field batch, and supplies the exact bytes
to protected-closure construction. Trusted prepare reruns the same pure compiler
and byte-compares all three parts. Attach/update commands are newly pure-
compiled; detach commands and their pairs are copied from the verified prior-
state closure. The witness receives the accepted primary outcome, its pair-
projected Delta bytes, and the matching command pair/bytes; it reuses that
command and emits only a witness Delta, never a second historical command.

`transitionBase` is mandatory for every candidate slot and originates only in
the sequential protocol. The complete prior-state bundle remains coordinator
and trusted-prepare input; it never crosses into an individual projector. The
projector receives no store callback, map, lookup function, ambient cache, or
second state read.
It selects its one event row and ordered operation slots from the verified
embedded recipe matrix; code may implement the named pure rules, but it may not
replace them with a generic event switch or discretionary output choice.

The implementation may expose functions rather than classes, but it must retain
one separately importable module and validator per manifest peer. A generic
switch over all observation payload kinds is rejected.

Every projector:

- accepts only its exact owned observation kind or kinds;
- validates the existing M0 observation and payload contract again;
- receives no omitted record and no record from another owner;
- resolves anchors only through the current verified projection-binding index;
- emits zero to seven complete existing `RealmDeltaV1` records;
- applies only the exact semantic-axis transition table: a primary delta uses
  derived provenance and copies every other admitted input axis byte for byte;
  the historical witness and maintenance overlays may only take additional
  explicitly listed downward transitions;
- emits no topology, collision, navigation, HLOD, public, authority, code,
  Genesis, station, bridge, or remote data;
- returns no mutable object and performs no store, ECS, renderer, or OS call.

### `RealmBootProjector`

The boot projector owns only `boot`. It can update existing service/building
entities, readiness gates, structure state, and reversible presentation commands
bound to baked boot anchors. A service cannot appear ready before its exact
terminal boot observation. Missing, failed, stale, inferred, or unavailable
evidence produces a matching non-success state.

### `RealmFilesystemProjector`

The filesystem projector owns only `filesystem`. It can update an already bound
opaque node's entity or structure state and attach reversible presentation. It
never receives or reconstructs a path, name, content hash, file byte, protected
root, host-disk scope, or scan result.

For every filesystem observation, `S(o)`, resolved set `R`, and missing set `M`
are total inputs to the frozen structural matrix. Any nonempty `M` emits exactly
one structural-intent row and exactly zero primary Delta: all missing selects
`absent-only`; mixed missing/resolved selects `partial-only`, with zero affected
anchors in both cases. Only an empty `M` may run the event recipe. Resolved
removal selects one `stale-only` row; resolved move, mount, coverage, or
relationship change selects one powerless `m3c-review-only` row; an ordinary
resolved snapshot/create/update with no relationship change selects no row.
There is no discretionary parent-marking path and no `fractured` or
`recovering` structural evidence. The projector never creates, deletes, moves,
or rewrites an authored anchor, building, road, collision shape, navigation
cell, HLOD cell, static ID, or bake resource.

### `RealmStorageProjector`

The storage projector owns only `storage`. It can update existing storage
entities, traffic metrics, structure health, and reversible presentation.
Filesystem and storage observations retain the one M3A canonical-storage source
identity. One raw storage mutation cannot become two primary entities or two
traffic events through cross-projector fan-out.

### `RealmProcessProjector`

The process projector owns only `process`. It can activate, update, stale, or
deactivate a dynamic process entity bound to a shipped archetype and existing
anchor, plus bounded activity/quality metrics and reversible presentation. It
cannot expose or infer a command line, argument, environment, credential,
private UI, handle, source path, manifest, or stack.

### `RealmIpcProjector`

The IPC projector owns only `ipc`. It can update existing local conduit routes,
traffic pulses, and reversible presentation. IPC route traversal is always
`non-traversable`; the visual conduit cannot become a road, bridge, permission,
or message-delivery authority. Payload, transferred objects, ports, callbacks,
tokens, credentials, and raw endpoint labels remain absent.

### `RealmSyscallProjector`

The syscall projector owns only `syscall`. It can update an existing typed
request/completion route, traffic pulse, and reversible presentation. It emits
only `routeDomain = syscall` with `traversalClass = non-traversable`. It cannot
contain arguments, return values, paths, values, bytes, credentials, keys,
handles, commands, stacks, or dispatch authority.

### `RealmPermissionProjector`

The permission projector owns the one `authority` domain row and consumes both
`permission` and `action-result`. It can update only gate and reversible
presentation state. It cannot issue, renew, revoke, consume, or dispatch a
capability.

A recorded completed-success appearance requires all of these exact inputs:

1. one valid safe retained `RealmActionAuthorityReceiptV1` record resolved by
   its ID/digest;
2. one matching terminal `action-result` observation from the M3A authority
   source;
3. equal action/proposal, operator, Realm, policy, capability epoch, authority
   result, dispatch/idempotency, and terminal correlation fields; and
4. proof that the signed receipt was allowed and valid at its recorded decision
   and dispatch/result chain.

Projection delay cannot turn that recorded success into failure merely because
the receipt later expires. The durable gate entry records that historical
result, never a claim that authority is still current. A *currently usable or
open-looking gate* is produced only by the trusted presentation/action adapter's
conjunctive meet over the latest fence-bound permission observation, exact
source slot/generation, effective bundle tick, capability epoch, and live-grant
row. When any condition fails, the adapter may only lock, disable, stale, or hide
the gate while the historical completion remains immutable evidence.

A permission observation alone, a receipt reference alone, an unresolvable
receipt, or a nonterminal result can produce only unknown, pending, denied,
expired, revoked, stale, unavailable, or recovery-pending presentation.

### `RealmNetworkProjector`

The network projector owns only `network`. It can animate an already baked
local-network route, traffic, boundary structure, and reversible presentation.
`routeDomain` is `network`; `station` and `bridge` are forbidden in M3B.
Every base-M3B network route is `non-traversable`. Authored navigation remains
unrepresentable until a later stage adds an explicit corridor contract,
descriptor role, and admission proof.

M3B can therefore make local network roads and the future SecureMesh hub feel
alive without creating a connection, remote node, person, Traveler, Cityform,
station occupant, bridge, address, URL, ICE/SDP material, packet, ticket,
capability, membership, contact, or remote Operations state. SecureMesh presence
and the train-station exchange remain M5 work; inter-Cityform roads remain M6.

### `RealmHistoricalWitnessProjector`

The historical witness owns no observation kind and receives no raw, omitted,
or included observation bytes. Its only input is one complete frozen primary
outcome with `reductionClass = historical-audit-only`, plus the exact primary
deltas that outcome references. It processes each eligible outcome exactly once
in source-observation order.

The witness:

- requires `input.projectorClass = primary`;
- rejects another witness as input, preventing presentation recursion;
- emits at most one `presentation` delta for one eligible primary outcome;
- cites the accepted primary outcome/delta and original observation ID;
- uses only the exact semantic-axis transition table;
- writes only the historical keyspace of the `presentation` channel;
- cannot affect current entity, route, gate, traffic, structure, interaction,
  collision, navigation, picking, authority, dirty interaction keys, or live
  State-First slots.

An omitted, invalid, or structurally rejected observation has no witness path.
A valid historical zero-primary-output outcome is still consumed exactly once
and freezes one `zero-output` witness outcome. Base M3B has no
separate CSE rejected-future witness input; that would require another admitted
contract and gate.

## Exhaustive base event mapping

The embedded recipe matrix is the sole exhaustive event/terminal mapping. Its
53 primary event rows and 130 slots replace any prose upper-bound table.
Broader M0 validity is insufficient: only the M3A-admitted discriminator rows
may reach a projector, and network `authenticated` is expressly absent. The
shared semantic kernel exports separate domain rule modules and validates the
literal row bytes; the app coordinator and trusted prepare invoke those same
pure functions. Neither maintains a second switch, implied default, optional
operation, or independent semantic mapping.

## Allowed delta subset and semantic keys

M3B accepts exactly six existing `RealmDeltaV1` operations:

```text
entity
route
gate
traffic
structure
presentation
```

`code` is rejected before reduction. `station` and `bridge` route domains are
rejected. Unknown payload, operation, archetype, component, presentation
command, reversible handle class, or descriptor references fail closed.

Semantic keys are exact:

| Operation | Key |
| --- | --- |
| `entity` | `entity:` plus payload `entityId` |
| `route` | `route:` plus payload `routeId` |
| `gate` | `gate:` plus payload `gateId` |
| `traffic` | `traffic:` plus payload `trafficId` |
| `structure` | `structure:` plus payload `structureId` |
| `presentation` | Exact current or historical construction below |

A current-eligible presentation key is the literal ASCII prefix
`presentation:current:` followed by
`H(particle-realms.m3b-presentation-current-semantic-key@2,
runtimeBindingDigest, projectorId, bindingSubjectId, selectedAnchorId,
commandKind)`. A historical witness key is the
literal ASCII prefix `presentation:historical:` followed by
`H(particle-realms.m3b-presentation-historical-semantic-key@1,
runtimeBindingDigest, sourceObservationId, primaryOutcomeDigest)`. `H` returns
the canonical M0 SHA-256 digest text, so neither construction depends on host
concatenation, escaping, locale, a versioned command ID, or an implied delimiter.
The semantic key deliberately remains stable while successive command IDs bind
distinct observation/slot/content bytes, so legal same-key lifecycle chains do
not collide. A current key may be used durably only by a `current-eligible`
primary outcome. A historical-primary slot derives the same prospective current
key solely for bounded sorting and read-only lookup against the original prior
bundle; that nondurable work-item value never becomes its DynamicStore key and
never participates in an in-batch chain. The witness row's
`historicalSemanticKey` must byte-equal the second construction; historical
primary deltas remain closure-only and have no DynamicStore semantic key.

The envelope `subjectId` equals the payload's primary ID. Entity payload
`anchorId` equals envelope `anchorId`. Every other envelope anchor resolves
through the exact static projection-binding index. A semantic key belongs to
one logical runtime binding and never crosses into a successor binding.

Every emitted Delta has the exact ID-typed value
`bakeRevision = "bake-revision:m3b:" + hex(H(
particle-realms.m3b-delta-bake-revision@1, activeBakeId,
activeBakeRevision, activeBakeOutputRecordDigest))`. The three inputs are the
byte-identical accepted bake facts in the runtime binding. Copying only
`activeBakeId`, using a mutable selector revision, omitting the accepted output
record digest, or reading bake state during projection is invalid. `bridgeEpoch`
is absent for every M3B Delta.

The reducer enforces these closed transition families:

- entity: absent to `activate`; active to `update`, `mark-stale`, `deactivate`,
  or `mark-absent`; only M3B-owned dynamic entities may become absent;
- route: absent to `propose`; proposed/current to `open`, `degrade`, `close`, or
  `revoke`; a revoked epoch never reopens without a newer authoritative epoch;
- gate: exact `locked`, `available`, `pending`, `granted`, `denied`, `expired`,
  or `revoked` mirrors only; M3B never creates the grant;
- traffic: complete current metric replacement or expiry; partial metric merge
  without declared evidence is rejected;
- structure: only existing `active`, `inactive`, `stale`, `partial`, `fractured`,
  `recovering`, or `recovered` presentation state;
- presentation: `attach`, `update`, or `detach` over a complete existing
  `RealmPresentationCommandV1` and declared reversible cleanup class.

These transition families apply only to `current-eligible` live deltas.
Historical primary deltas are verified audit evidence and never touch those
keys. The one optional witness artifact uses
the exact historical construction above with interaction disabled.

Maintenance never forges a `RealmDeltaV1`. Effective current eligibility is
the conjunction below:

| Input | Required condition |
| --- | --- |
| Retained entry | `entryState = active` or `stale`; `deactivated` is ineligible |
| Source health | Slot is `cursorPresence = accepted`, `sourceState = live`, and `slot.sourceCursor.sourceGeneration` equals every contributing dependency's source generation |
| Expiry | `expiryTick = "0"` or `expiryTick > effectiveLogicalTick` |
| Temporal | Entry is `current`; historical-audit entries are never current |
| Interaction and authority | Not a durable visual-eligibility input. Base entries remain interaction-disabled; only the trusted presentation/action join may expose a gate action after meeting the fence-bound current-authority snapshot and a current nonexpired/nonrevoked matching live grant |

Any failed state, source-health, expiry, or temporal conjunct masks the entry
immediately for current ECS and State-First consumption. The separate
interaction/authority join can only keep interaction disabled or temporarily
enable an admitted gate action; it never makes an otherwise ineligible entry
visible or rewrites durable state. A seven-slot overlay change can therefore fail closed
131,072 retained entries through one atomic bundle swap without pretending to
rewrite them inside the 8,192 dirty-entry ceiling. Recovery to a newer source
generation does not reactivate older entries; a new same-generation observation
must replace them. Deterministic bounded cleanup may later remove already
masked entries and cannot change the effective result.

The global source-health overlay state is the fail-closed precedence meet
`quarantined > unavailable > recovering > stale > healthy`. `healthy` requires
all seven slots accepted/live/current at their expected generations. An absent
or unavailable slot maps to `unavailable`; no slot state is silently ignored.
The derived overlay can only retain or downgrade semantic axes:

| Overlay | Exact allowed derived effect |
| --- | --- |
| `stale` | freshness `current -> stale`; assertion `confirmed -> proposed` |
| `recovering` or `unavailable` | evidence to `unknown` except `not-applicable`; availability `available -> partial`; freshness `current\|stale -> unknown`; assertion to `hypothetical` |
| `quarantined` | non-absent availability to `denied`; non-expired freshness to `unknown`; evidence to `unknown` except `not-applicable`; assertion to `hypothetical` |

Provenance and temporal mode are unchanged by source health. This overlay masks
authority-success UI and interaction, but it never rewrites source/M0 bytes or
grants/revokes operating-system authority. Authority-currentness is deliberately
not cached in the durable DynamicStore: every presentation and interaction read
must join the selected root with the latest fence-bound authority snapshot. A
head change closes the fence synchronously, so a delayed M3B cut or stopped app
cannot preserve an open gate.

## `RealmProjectionAppliedCursorV1`

The applied cursor has exactly 19 top-level fields:

```text
format
version
cursorId
realmId
runtimeBindingId
runtimeBindingDigest
projectionSequence
lastAppliedM3ABatchSequence
lastAppliedM3ABatchId
lastAppliedM3ABatchDigest
vectorWatermark
lastProjectionBatchId
lastProjectionBatchDigest
dynamicStoreGeneration
sourceStateSlots
sourceStateSlotsDigest
cursorState
nextExpectedM3ABatchSequence
cursorDigest
```

`cursorState` is `applied`, `stale`, `recovery-required`, or `retired`. The
first committed M3B artifact is always an observation-batch genesis, so all 19
fields are present. Source-state and expiry cuts advance projection sequence,
carry the complete newest seven-slot snapshot, and retain the last applied M3A
batch and next expected batch sequence. Only an `observation-batch` cut advances
those M3A fields.

`cursorId` uses `particle-realms.m3b-projection-applied-cursor-id@1` over every
field from `realmId` through `nextExpectedM3ABatchSequence` in displayed order,
including the complete seven slots and their recomputed digest. `cursorDigest`
uses `particle-realms.m3b-projection-applied-cursor@1` over the first 18 fields
in listed order, including the recomputed ID. The batch pair/sequence and next-
expected sequence must satisfy the observation-cut versus maintenance-cut rule
before either hash is computed.

The cursor intentionally contains no projection-root backlink. The state root
binds the cursor. A cursor-to-root backlink would create a digest cycle. The
cursor never advances an M3A source ACK, ledger head, retention floor,
checkpoint, compaction decision, or recovery state.

## `RealmDynamicStoreSnapshotV1`

The snapshot has exactly 25 top-level fields:

```text
format
version
snapshotId
realmId
runtimeBindingId
runtimeBindingDigest
activeBakeId
activeBakeRevision
activeBakeOutputRecordDigest
spatialLayoutReceiptId
spatialLayoutReceiptDigest
staticStoreSnapshotId
staticStoreSnapshotDigest
dynamicStoreGeneration
projectionSequence
sourceStateSlots
sourceStateSlotsDigest
effectiveLogicalTick
channelRows
totalEntryCount
totalEntryBytes
dirtyChannels
dirtySemanticKeys
snapshotLineageAccumulatorDigest
snapshotDigest
```

There are exactly six channel rows in manifest output-operation order:

```text
entity
route
gate
traffic
structure
presentation
```

Each channel row has exactly six fields:

```text
channelOrder
channelKind
entryRows
entryCount
entryByteCount
channelDigest
```

Each entry row has a closed 21-field vocabulary:

```text
entryOrder
entryId
semanticKey
channelKind
sourceDeltaId
sourceDeltaDigest
sourceObservationIds
sourceOrder
sourceGeneration
anchorId
stableEntityId
entryState
interactionState
temporalClass
expiryTick
expiryEvidenceKind
expiryEvidenceId
expiryEvidenceDigest
lastProjectionSequence
entryVersion
entryDigest
```

Lowering from a verified Delta is exhaustive:

| Channel | Payload selector | `entryState` | Renderable descriptor selector |
| --- | --- | --- | --- |
| entity | `operation = activate` or `update` | `active` | selected `m3b-entity-archetype@1` resource |
| entity | `operation = mark-stale` | `stale` | selected `m3b-entity-archetype@1` resource |
| entity | `operation = deactivate` or `mark-absent` | `deactivated` | none |
| route | `operation = propose` or `open` | `active` | selected `m3b-route-style@1` resource |
| route | `operation = degrade` | `stale` | selected `m3b-route-style@1` resource |
| route | `operation = close` or `revoke` | `deactivated` | none |
| gate | `state = available` or `granted` | `active` | selected `m3b-gate-style@1` resource |
| gate | `state = pending` | `stale` | selected `m3b-gate-style@1` resource |
| gate | `state = locked`, `denied`, `expired`, or `revoked` | `deactivated` | none |
| traffic | every admitted traffic payload | `active` | selected `m3b-traffic-style@1` resource |
| structure | `state = active` or `recovered` | `active` | selected `m3b-structure-style@1` resource |
| structure | `state = stale`, `partial`, `fractured`, or `recovering` | `stale` | selected `m3b-structure-style@1` resource |
| structure | `state = inactive` | `deactivated` | none |
| presentation | `operation = attach` or `update` | `active` | glyph/sign command `glyphStyleId`; actor command `actorArchetypeId`; route-emphasis command `styleId` |
| presentation | `operation = detach` | `deactivated` | none |

Every accepted Delta lowering fixes all remaining entry fields without an
implementation choice. `channelKind = delta.operation`;
`sourceDeltaId`/`sourceDeltaDigest` are the exact verified Delta pair;
`sourceObservationIds = delta.inputObservationIds`; `anchorId = delta.anchorId`;
and `lastProjectionSequence = inputCut.projectionSequence`. `sourceOrder` is the
unique input-cut source slot whose `sourceId` equals the accepted M3A
observation's verified source-provenance ID, and `sourceGeneration` is that
slot's nested `sourceCursor.sourceGeneration`. Zero or multiple matching slots,
an absent source cursor, or a mismatch between any Delta input observation and
that provenance rejects the complete candidate. An inserted semantic entry has
`entryVersion = 1`; a nonidentical replacement or deactivation has the verified
prior entry version plus one, with the plus-one ceiling checked before
allocation; an exact idempotent duplicate emits no revision. Source-health and
expiry masking never rewrites or increments an entry, and bounded cleanup only
removes it. Within each channel, rows are sorted by `(semanticKey, entryId)` in
code-point order and `entryOrder` is the resulting dense zero-based index.

Every base-M3B entry has `interactionState = disabled`. The current-authority
presentation/action adapter may expose usable gate interaction only as an
ephemeral conjunctive view; it never rewrites this durable field. Primary
current entries use `temporalClass = current`. The witness's presentation entry
uses `historical-audit`, remains disabled, and is excluded from ECS and
State-First. A nontraffic primary Delta uses `expiryEvidenceKind =
not-applicable`; a traffic Delta uses `observation` and the exact source pair as
specified by the finite-expiry rule. No other state, interaction, temporal, or
descriptor lowering is valid.

`stableEntityId` is deterministic and shared across channels for the same
binding-scoped subject and anchor:

```text
"entity:m3b:" + hex(H(
  particle-realms.m3b-stable-entity-id@1,
  realmId,
  runtimeBindingId,
  runtimeBindingDigest,
  candidateSubjectId,
  candidateAnchorId))
```

Changing the Realm, binding, subject, or anchor changes the stable entity. No
array index, mutable ECS handle, command identity, source ordinal, insertion
order, projector output, or renderer choice enters this preimage. The two
candidate values are frozen before projector execution as defined by the slot
work-item protocol, and an emitted Delta is accepted only when its `subjectId`
and `anchorId` byte-equal them.

`channelOrder` and `entryOrder` are dense zero-based integers. `entryId` uses
`particle-realms.m3b-dynamic-store-entry-id@1` over, in order, the parent
`realmId`, the parent runtime-binding pair, `semanticKey`, `channelKind`,
`anchorId`, `stableEntityId`, and `temporalClass`. It deliberately excludes the
source delta, state, expiry, projection sequence, and version so one semantic
entry retains identity across valid revisions. `entryDigest` uses
`particle-realms.m3b-dynamic-store-entry@1` over every present preceding field
in the displayed 21-field order, so the 19- and 21-own-key variants cannot
collide or drift. `entryCount` equals `entryRows.length`; `entryByteCount` is the
sum of the complete canonical 21-field or 19-field entry byte sequences. A
channel's `channelDigest` uses `particle-realms.m3b-dynamic-store-channel@1`
over its first five fields in listed order, including the complete ordered
entry rows. `totalEntryCount` and `totalEntryBytes` equal the sums of the six
channel counters, with no physical-storage deduplication.

`snapshotLineageAccumulatorDigest` at empty genesis uses
`particle-realms.m3b-dynamic-store-lineage-seed@1` over, in exact order,
`runtimeBindingId` and `runtimeBindingDigest`; no Realm, zero snapshot, empty
array, generation, or caller seed is inserted.
Every successor uses `particle-realms.m3b-dynamic-store-lineage-step@1` over,
in order, the prior accumulator digest, prior snapshot pair, prior
`dynamicStoreGeneration`, and prior `projectionSequence`. `snapshotId` uses
`particle-realms.m3b-dynamic-store-snapshot-id@1` over, in order, `realmId`, the
runtime-binding pair, the active-bake triple, the layout pair, the static-store
pair, `dynamicStoreGeneration`, `projectionSequence`,
`sourceStateSlotsDigest`, `effectiveLogicalTick`, all six complete canonical
channel rows, `totalEntryCount`, `totalEntryBytes`, `dirtyChannels`,
`dirtySemanticKeys`, and `snapshotLineageAccumulatorDigest`. `snapshotDigest`
uses `particle-realms.m3b-dynamic-store-snapshot@1` over the first 24 top-level
fields in listed order, including the recomputed ID and complete arrays, with
only itself omitted. Channels occur exactly once in the displayed order;
`dirtyChannels` follows that order and `dirtySemanticKeys` is code-point-sorted
unique. Snapshot `dirtySemanticKeys` byte-equals the bound projection-batch
array. `dirtyChannels` is the manifest-order projection of the channel prefixes
present in those keys; it is empty when the key array is empty, including a
constant-size source-health/expiry overlay-only change. Any count, byte total,
order, lineage, dirty projection, ID, or digest mismatch rejects the whole
candidate before allocation.

The source delta and any referenced presentation command or shipped descriptor
resolve through the protected root closure. `entryState` is `active`, `stale`,
or `deactivated`; `interactionState` is `enabled` or `disabled`;
`temporalClass` is `current` or `historical-audit`. Historical witness entries
exist only in the disjoint presentation keyspace, are always disabled, and are
excluded from ECS and State-First. A primary historical delta creates no entry.

`expiryEvidenceKind` is exactly `not-applicable` or `observation`. A
nonexpiring row has 19 own keys, requires `expiryTick = "0"` and
`not-applicable`, and omits the evidence pair. A finite-expiry row has all 21
keys and is legal only for a current-eligible traffic Delta. Its evidence pair
resolves to that Delta's exact root-owned source observation. The verified
observation pair, its admitted traffic recipe, and the input cut's logical tick
derive `expiryTick = decimal(min(UINT64_MAX,
BigInt(inputCut.logicalTick) + 1n))`; no wall time or authority-receipt expiry is
converted. Each newly admitted current traffic Delta independently replaces the
prior traffic expiry with its exact saturating cut-plus-one value, which may be
later than the prior entry's tick. No reducer may choose a value later than that
candidate-derived tick. When several eligible contributors merge, effective
expiry is the least nonzero contributor tick. At `UINT64_MAX`, saturation makes the row immediately
ineligible at the current effective tick. The expiry maintenance compiler
selects only these verified finite ticks.

Every snapshot is self-contained. `snapshotLineageAccumulatorDigest` commits
the prior accumulator plus prior snapshot ID/digest/generation at successor
construction, but the current snapshot does not require the prior snapshot to
remain stored. The exact seven source slots and effective logical tick are part
of every snapshot, so restart after many expiry cuts can still distinguish an
unchanged idle read from a source transition.

The M2 runtime owns the one concrete active `RealmDynamicStore` inside the
selected projection bundle. M3B owns pure mutation planning and immutable
candidate snapshot bytes. The trusted commit port is the only bundle selector.
The app does not construct a second active store or receive its map.

## Pure reducer transaction

`RealmProjectionDeltaReducer` takes the prior verified snapshot plus one complete
observation projection batch and returns an ordered immutable semantic-mutation
plan or one bounded failure. `RealmProjectionMaintenanceCompiler` does the same
for one source-state or expiry batch. Neither creates a snapshot or performs a
side effect.

The reducer:

1. verifies prior snapshot/root/binding equality;
2. verifies every delta and nested payload ID/digest;
3. verifies primary outcome and delta closure;
4. rejects duplicate IDs with different bytes;
5. treats an exact duplicate as idempotent;
6. partitions current-eligible primary deltas, historical primary audit evidence,
   and historical witness presentation artifacts;
7. derives current semantic keys and reduces each nonidentical current same-key
   sequence through the exact canonical in-batch transition chain, while
   historical-primary evidence remains closure-only and rejecting any illegal,
   identity-conflicting, or cross-partition chain;
8. emits one ordered final insert/update/deactivate/remove mutation per dirty
   current key plus optional historical-presentation insertion while retaining
   every intermediate Delta and outcome in audit closure;
9. validates mutation, dirty-key, expiry, and work ceilings; and
10. returns no plan if any step fails.

`RealmDynamicStoreCandidateBuilder` is the sole snapshot materializer. It takes
the prior self-contained snapshot, one verified delta or maintenance plan, the
new seven-slot snapshot, and effective logical tick; applies immutable
copy-on-write changes; performs optional bounded cleanup; recomputes the
source-health and expiry meet; validates six channel/entry/count/byte/lineage
rules; and freezes exactly one `RealmDynamicStoreSnapshotV1`. The reducer never
freezes a store, and the builder never interprets an observation or chooses a
domain operation.

A zero-delta observation batch still creates an applied cursor, projection batch,
candidate snapshot with unchanged entries and a new projection generation, empty
ECS/State-First changes, and a new root. The ECS and State-First target
generations equal their expected generations when their full result is
byte-identical; only root, cursor, projection sequence, and DynamicStore
generation advance. This proves the M3A batch was considered without pretending
that presentation state changed.

## `RealmEcsProjectionChangeSetV1`

The change set has exactly 24 top-level fields:

```text
format
version
changeSetId
realmId
runtimeBindingId
runtimeBindingDigest
activeBakeId
activeBakeRevision
activeBakeOutputRecordDigest
staticStoreSnapshotId
staticStoreSnapshotDigest
dynamicStoreSnapshotId
dynamicStoreSnapshotDigest
expectedEcsSourceGeneration
targetEcsSourceGeneration
operationRows
operationCount
operationByteCount
dirtyStableEntityIds
resultingOverlayRows
resultingOverlayEntityCount
resultingOverlayByteCount
resultingOverlayDigest
changeSetDigest
```

Before any nested row is hashed, the compiler derives the hash-only
`changeSetScopeDigest` with
`particle-realms.m3b-ecs-projection-change-set-scope@1` over, in exact order,
`realmId`, the runtime-binding pair, the active-bake triple, the static-store-
snapshot pair, the DynamicStore-snapshot pair,
`expectedEcsSourceGeneration`, and `targetEcsSourceGeneration`. It is not a wire
field, standalone reference, or mutable scope. Every operation, incremental
component-write, full-overlay, and full-overlay-component row digest includes
this scope as its first parent value. The later content-complete `changeSetId`
can therefore include all nested rows without a cycle or a header-only identity
collision.

Each ECS operation row uses a closed 12-field vocabulary:

```text
operationOrder
operationKind
stableEntityId
expectedStableEntityVersion
targetStableEntityVersion
anchorId
archetypeId
componentWriteRows
componentRemoveTypeIds
sourceDeltaIds
sourceDeltaDigests
rowDigest
```

`operationKind` is `create-dynamic`, `update-dynamic`, `deactivate-dynamic`, or
`remove-dynamic`. Conditional version/archetype/component fields are absent when
not applicable, pair/array presence is frozen per operation kind, and `null`
never substitutes for absence. `remove-dynamic` is legal only for an entity
created by the same M3B binding. No operation can remove or renumber a static M2
entity.

The own-key presence matrix is exact:

| Kind | Own keys | Required conditional fields | Prohibited fields |
| --- | ---: | --- | --- |
| `create-dynamic` | 11 | target version, anchor, archetype, nonempty component writes, present empty-or-nonempty component-remove array, both source-delta arrays | expected version |
| `update-dynamic` | 12 | expected/target versions, anchor, archetype, component-write and component-remove arrays, both source-delta arrays | none |
| `deactivate-dynamic` | 8 | expected/target versions and both source-delta arrays | anchor, archetype, component writes, component removes |
| `remove-dynamic` | 8 | expected/target versions and both source-delta arrays | anchor, archetype, component writes, component removes |

All variants also require `operationOrder`, `operationKind`, `stableEntityId`,
and `rowDigest`. Create target version is one. Update/deactivate/remove require
target version equal expected plus one. A remove target version is retained in
the operation and selector journal as an ABA fence even though no resulting
overlay row remains. The two source-delta arrays are always present together,
equal-length, nonempty, and use the global delta comparator.

The operation projection is total and deterministic. For this projection only,
a stored-overlay-eligible contributor is a `current` entry whose `entryState` is
`active` or `stale`; source-health and expiry are separate fail-closed bundle
masks and never fabricate per-entity writes. Compare the verified prior and
candidate scope-independent overlay content (stable ID, anchor, archetype,
component values, and ordered source-entry pairs), not row digests whose parent
scope changed. Collect every stable entity whose stored overlay content or
backing-entry set changed by a Delta or bounded cleanup, sort those IDs by code
point, emit exactly one operation per collected ID, and assign dense
`operationOrder`. `create-dynamic` is selected exactly when no prior active or
tombstone overlay row exists and a stored-overlay-eligible result exists.
`update-dynamic` is selected exactly when a prior active or tombstone row exists,
a stored-overlay-eligible result exists, and its scope-independent canonical
result differs. `deactivate-dynamic` is selected exactly when a prior active or
tombstone row exists, no stored-overlay-eligible result exists, at least one
backing DynamicStore entry remains, and the scope-independent tombstone state
differs. `remove-dynamic` is selected exactly when bounded
cleanup removes the final backing entry; its expected version comes from the
prior active or tombstone row in the verified prior bundle. Every other ID emits
no operation. A source-health/expiry-overlay-only cut therefore emits no ECS
operation and preserves stable-entity versions while the selected bundle's
trusted adapter applies the global mask. `dirtyStableEntityIds` is the code-
point-sorted unique exact projection of the emitted operation IDs.
`expectedEcsSourceGeneration` is zero at verified empty genesis and otherwise
byte-equals the selected prior bundle's ECS source generation. An empty operation array requires
`targetEcsSourceGeneration = expectedEcsSourceGeneration`; a nonempty array
requires exact plus one, rejected at the ceiling before allocation. Parent-
scope and row-digest changes alone never advance this semantic source
generation.

A create writes exactly `Transform` and `Renderable` and has an empty
`componentRemoveTypeIds` array. An update writes `Renderable` exactly when its
canonical value changed, never writes `Transform`, and has an empty remove
array; a source-reference-only overlay change therefore has an empty write
array. Both component types use literal `componentSchemaVersion = 1`, the
accepted Engine V1 codec, dense code-point `componentOrder`, and a recomputed
component-value digest. Create/update source-delta arrays are the sorted unique
union of the source Delta pairs of every resulting stored-overlay-eligible
contributing entry. Deactivate arrays are the same union over every remaining
stored-overlay-ineligible backing
entry plus any current candidate Delta that caused the transition. Remove
arrays are the sorted unique union over the prior entries removed by that
cleanup. Each union is resolved against the candidate or prior protected
closure as applicable; no operation may cite an unrelated or missing Delta.

Each component write row has exactly six fields:

```text
componentOrder
componentTypeId
componentSchemaVersion
componentValue
componentValueDigest
rowDigest
```

`componentTypeId` must be exactly `Renderable` or `Transform`, in code-point
order, and the archetype must be exactly `realm-dynamic-presentation-v1`.
`Transform` is required on create and must be byte-identical to the verified
baked anchor transform; it cannot be updated to a different value. `Renderable`
is constructed from the winning exact shipped descriptor permitted by that
anchor's `RealmProjectionBindingV1`. Its `componentValue` has the accepted
Engine `Renderable` V1 own fields and these exact values:

```text
meshId = selectedDescriptor.resourceId
materialId = selectedDescriptor.contentId
layer = 0
visible = true
layerMask = 4294967295
castShadow = false
receiveShadow = false
tintColor = [1, 1, 1, 1]
```

`selectedDescriptor` is the complete verified `ResourceReferenceV1` named by
the DynamicStore lowering table, so both its logical ID and content identity
enter the component. Stored-overlay-eligible contributors reduce in exact channel
order `entity`, `route`, `gate`, `traffic`, `structure`, `presentation`; the
last active or stale contributor replaces the earlier Renderable. A deactivated
entry contributes no Renderable. Two nonidentical eligible descriptor values at
the same channel precedence reject the candidate. If no stored-overlay-eligible
contributor remains but a backing entry and prior active/tombstone overlay row
both exist, the result retains the exact tombstone row defined below. An
initially ineligible backing entry creates no ECS row, and removal of the final
backing entry removes any retained tombstone. The component
passes the accepted Engine codec and contains no runtime handle, function,
prototype, GPU object, unknown field, or presentation decision.

Each element of a full-overlay row's `componentRows` has the same exact six
field vocabulary and scalar rules, but is a distinct parent-qualified
`RealmEcsProjectionFullOverlayComponentRowV1`. Its `componentOrder` is dense in
code-point `componentTypeId` order. Its `rowDigest` uses
`particle-realms.m3b-ecs-full-overlay-component-row@1` over the parent
`changeSetScopeDigest`, parent `stableEntityId`, and every preceding displayed
component field in order. Its parent-contained row identity is only the tuple of
the parent `changeSetScopeDigest`, parent `stableEntityId`, exact extractor path,
`componentTypeId`, and `componentSchemaVersion`; it has no standalone ID field
and can never become a closure object. Incremental component-write
rows use their existing operation parent and cannot substitute for these
complete-overlay rows even when their component values are byte-identical.

The record contains stable string IDs only. Runtime ECS handles, query objects,
component arrays, storage rows, closures, and presentation slots are absent.
The accepted M2 synchronizer resolves stable IDs inside its structural barrier.

`resultingOverlayRows` is the complete self-contained stable-ID dynamic ECS
overlay after the operations, not merely the latest incremental patch. Each row
has exactly nine fields:

```text
stableEntityOrder
stableEntityId
stableEntityVersion
anchorId
archetypeId
componentRows
sourceEntryIds
sourceEntryDigests
rowDigest
```

Rows are sorted by stable entity ID, use only the one allowed archetype and two
allowed components, and resolve every source entry through the candidate
DynamicStore. An active row has `Transform` and `Renderable`. A deactivated
tombstone row retains the prior anchor/archetype, stable entity version,
anchor-equal `Transform`, and backing source-entry pairs but omits `Renderable`;
it is preserved only while at least one backing entry remains and the off-active
adapter never exposes it as renderable. This fixed nine-field row is the durable
ABA fence that makes a later update or cleanup-removal independently
reconstructible after older roots are released. Within each row, source-entry
pairs are the exact stored-overlay contributor or tombstone-backing projection
sorted by `(channel manifest order, semanticKey, entryId)`, with equal lengths
and no duplicate pair. The full result
count/bytes/digest are recomputed even when the
incremental operation list is empty. A root can therefore restore and verify
the accumulated overlay after old roots are released. The off-active bundle
adapter materializes the accepted M2 static world plus this full overlay; it
never patches the live world sequentially.

## `RealmStateFirstSourceSnapshotV1`

The source snapshot has exactly 19 top-level fields:

```text
format
version
sourceSnapshotId
realmId
runtimeBindingId
runtimeBindingDigest
dynamicStoreSnapshotId
dynamicStoreSnapshotDigest
expectedStateFirstSourceGeneration
targetStateFirstSourceGeneration
sourceStateSlotsDigest
effectiveLogicalTick
sourceEntryRows
sourceEntryCount
sourceEntryByteCount
dirtySourceEntryIds
dirtySourceEntryCount
semanticAxesDigest
sourceSnapshotDigest
```

There is exactly one flat source row per stable dynamic presentation entity.
There are no per-channel source arrays that could duplicate one entity. A
Transform-only ECS tombstone produces no State-First source row. An active
stored overlay row that is masked only by source health or effective tick stays
in this bounded source array so the snapshot's global slot/tick fields and its
dependency rows can fail it closed without a per-entity rewrite. Each source
entry row has exactly 13 fields:

```text
entryOrder
sourceEntryId
stableEntityId
position
boundsRadius
importance
dirtyMask
dependencyRows
dependencyCount
effectiveExpiryTick
sourceDeltaIds
sourceDeltaDigests
entryDigest
```

The candidate-source codec is not an ambient or new codec. It is the code-
shipped pure projection of the accepted `StateFirstEcsSourceAdapter` selected by
the `RealmProjectionCommitCapabilityProfileV1` field
`stateFirstSemanticSourceCodecVersion = 1`. Its complete input tuple is the
stable entity ID, exact anchor-equal `Transform`, winning eight-field
`Renderable`, and the unique selected `RealmProjectionBindingV1` bytes already
in protected static closure. Codec V1 derives `position` from that Transform and
derives `boundsRadius` and `importance` only through its registered authored-
bounds and numeric-policy selectors on that binding. A ResourceReference alone
never supplies bounds or importance. Missing, multiple, nonfinite, negative, or
out-of-policy binding metadata rejects the complete candidate. Values are never
read from a live ECS world or adapter callback.

`dirtyMask` is the deterministic OR of the exact numeric dirty bits exported by
the accepted State-First adapter/rasterizer V1 for changed Transform,
Renderable, or dependency inputs. Create sets every applicable V1 source bit;
a changed row sets exactly the OR for that revision; and an unchanged row byte-
copies its prior mask rather than clearing it, so a full self-contained snapshot
does not manufacture a second change merely to reset transient metadata. The
current changed subset is carried only by `dirtySourceEntryIds`; complete restore
treats every listed field as present independent of its retained last-change
mask. Source-health/expiry overlay-only cuts keep the per-row mask and dirty-ID
set unchanged because their global slot/tick fields carry that change. App and
trusted prepare invoke the same version-bound pure codec and require byte-
identical values and mask; no caller-supplied bit or descriptor callback is
accepted.

If several current DynamicStore channels address one stable entity, the planner
merges them in exact order `entity`, `route`, `gate`, `traffic`, `structure`,
`presentation`; a later channel may replace only a declared Renderable
presentation field, two nonidentical writes at the same precedence reject, and
no row can replace Transform. Every contributing retained entry is represented
by one dependency row with exactly eight fields:

```text
dependencyOrder
channelKind
dynamicStoreEntryId
dynamicStoreEntryDigest
sourceOrder
sourceGeneration
expiryTick
rowDigest
```

`sourceGeneration` is extracted only as
`sourceStateSlots[sourceOrder].sourceCursor.sourceGeneration`; an absent slot
has no generation and makes the dependency ineligible. Dependency rows are
unique and globally ordered by
`(channel manifest order, semanticKey, dynamicStoreEntryId, sourceOrder)`, not by the latest batch. Every contributing
source generation and expiry is therefore preserved even when several channels
or old batches merge into one stable entity. `effectiveExpiryTick` is zero only
when every dependency is nonexpiring; otherwise it is the least nonzero expiry.
Source-delta pairs are complete, equal-length, deduplicated, and ordered by the
frozen global M0 delta comparator
`(operatorPartitionId, eventSequence, observationOrdinal, projectorOrder, deltaOrdinal, deltaId)`. Historical-audit entries are excluded.

`sourceEntryRows` are sorted by `stableEntityId` in code-point order and use
dense zero-based `entryOrder`. `dirtySourceEntryIds` is the code-point-sorted
unique exact projection of rows created, changed, or removed by this change set;
`dirtySourceEntryCount` equals its length. `sourceEntryCount` is the full
snapshot count and cannot exceed 65,536. The per-batch dirty count cannot exceed 8,192.
`expectedStateFirstSourceGeneration` is zero at verified empty genesis and
otherwise byte-equals the selected prior bundle's State-First source generation.
An empty dirty-ID array requires
`targetStateFirstSourceGeneration = expectedStateFirstSourceGeneration`; a
nonempty array requires exact plus one, rejected at the ceiling before
allocation. A new parent snapshot identity or global slot/tick mask alone never
advances this semantic source generation.
A source-health or expiry overlay change is represented once by the snapshot's
slot digest/effective tick and is evaluated fail closed by the accepted source
adapter; it does not fabricate tens of thousands of dirty rows. An unchanged
zero-delta batch keeps target generation equal to expected generation.

This is a CPU source snapshot, not a State-First decision, render plan, GPU
upload, visibility authority, representation request, `visible`, or
`currentRepresentation` value. The M2 adapter joins its current representation
and camera/occlusion decisions only after bundle commit, outside every M3B
identity. The record contains no renderer, GPU buffer, live bridge, callback,
or `apply()` function.

## `RealmProjectionStateRootV1`

The state root has a closed 37-field top-level vocabulary:

```text
format
version
rootId
rootKind
realmId
runtimeBindingId
runtimeBindingDigest
profileId
profileDigest
contractCatalogId
contractCatalogDigest
domainManifestId
domainManifestDigest
disclosurePolicyId
disclosurePolicyDigest
projectionSequence
lastM3ABatchSequence
vectorWatermark
projectionBatchId
projectionBatchDigest
appliedCursorId
appliedCursorDigest
dynamicStoreSnapshotId
dynamicStoreSnapshotDigest
ecsChangeSetId
ecsChangeSetDigest
stateFirstSourceSnapshotId
stateFirstSourceSnapshotDigest
predecessorRootId
predecessorRootDigest
rootGeneration
lineageFloorAnchorId
lineageFloorAnchorDigest
lineageAccumulatorDigest
internalClosureDigest
projectionLogicalTick
rootDigest
```

`rootKind` is fixed to `projection-root`. Genesis root fields omit predecessor,
requires `rootGeneration = 1`, and is valid only for the first observation-batch
cut. Every later root requires the immediate predecessor pair and increments its
generation by one. All batch/watermark fields are always present because no
maintenance root can precede the first observation batch.

`projectionLogicalTick` equals the deterministic input-cut tick and is frozen
before prepare. It is not a claimed storage/commit time. The trusted application
receipt and selector-CAS receipt prove actual publication.

For genesis, `lineageAccumulatorDigest` uses
`particle-realms.m3b-projection-root-lineage-seed@1` over the runtime-binding
pair. Every successor uses
`particle-realms.m3b-projection-root-lineage-step@1` over, in order, the prior
lineage accumulator, immediate predecessor root pair, and predecessor
`rootGeneration`. Commit verifies the immediate predecessor while it is present.
`rootId` uses `particle-realms.m3b-projection-state-root-id@1` over every present
field from `rootKind` through `projectionLogicalTick` in displayed order;
canonical field names preserve the genesis omission of the predecessor pair.
`rootDigest` uses `particle-realms.m3b-projection-state-root@1` over every
present preceding field in the displayed 37-field order, including the
recomputed ID. The root
store retains at most four roots and atomically advances one service-private
lineage-floor anchor before releasing an older predecessor. A verifier resolves
the available suffix to that exact floor anchor; it never requires a released
unbounded chain.

The service-internal `RealmProjectionLineageFloorAnchorV1` has a closed 12-field
vocabulary:

```text
format
version
floorAnchorId
runtimeBindingId
runtimeBindingDigest
floorKind
foldedThroughRootGeneration
foldedThroughRootId
foldedThroughRootDigest
foldedLineageAccumulatorDigest
foldedTransitionCount
floorAnchorDigest
```

`floorKind = empty` has exactly ten own keys: it omits the folded-through root
pair, uses generation/count zero, and binds the runtime-specific fixed lineage
seed. `floorKind = compacted` has all 12 keys, a positive folded generation and
count, and the exact last released root pair. `readPriorState(complete-base)`
returns the root-store-authored candidate floor-anchor bytes for the next
transaction under the head-read receipt: either the current anchor unchanged or
the one deterministic successor that folds the oldest releasable root. The app
can verify and bind this value but cannot choose it. Prepare persists and reads
the anchor back before bundle selection; an abort leaves it unselected. Only
after selector readback proves the successor root current may the root store
release the folded root and its root-owned bytes.

`floorAnchorId` uses
`particle-realms.m3b-projection-lineage-floor-anchor-id@1` over, in displayed
order, the runtime-binding pair, `floorKind`, `foldedThroughRootGeneration`, the
conditionally present folded-through root pair,
`foldedLineageAccumulatorDigest`, and `foldedTransitionCount`. Canonical field
names preserve the omitted pair in the `empty` presence matrix.
`floorAnchorDigest` uses
`particle-realms.m3b-projection-lineage-floor-anchor@1` over every present
preceding field in the displayed 12-field order, including the recomputed ID.

### Protected root closure

`internalClosureDigest` equals the digest of one service-internal, import-inert
`RealmProjectionProtectedClosureManifestV1` with exactly ten header fields:

```text
format
version
closureManifestId
runtimeBindingId
runtimeBindingDigest
entryRows
entryCount
canonicalByteCount
retentionRequestDigest
closureManifestDigest
```

Each entry row has exactly 11 fields:

```text
entryOrder
retentionClass
objectKind
objectId
objectDigest
canonicalByteCount
dependencyIds
dependencyDigests
sourceAuthority
requiredResolverKind
entryDigest
```

`entryOrder` is dense and zero-based after sorting. `dependencyIds` and
`dependencyDigests` have equal length and pair by index in the exact role and
occurrence order emitted by the registry-bound dependency extractor. They
contain one position for every declared extractor occurrence and no undeclared,
missing, extra, or duplicate occurrence slot. Repeated pair values are legal
only at distinct frozen slots whose descriptors assign distinct qualified
roles, such as one `root-object` copy and one `m2-target`; extractor position,
not pair value alone, disambiguates them. They are both empty if and only if the
frozen extractor declares no dependency occurrence. `entryDigest` uses
`particle-realms.m3b-projection-protected-closure-entry@1` over its first ten
fields in listed order. `entryCount` equals `entryRows.length` and
`canonicalByteCount` is the sum of each entry's complete resolver-verified
canonical object bytes, never the byte length of the manifest row.

`closureManifestId` uses
`particle-realms.m3b-projection-protected-closure-manifest-id@1` over the
runtime-binding pair, the complete ordered canonical `entryRows`, `entryCount`,
`canonicalByteCount`, and `retentionRequestDigest`; it excludes format/version,
itself, and the final digest. `closureManifestDigest` uses
`particle-realms.m3b-projection-protected-closure-manifest@1` over the first
nine top-level fields in listed order, including the recomputed ID and complete
rows, with only itself omitted. The target set is computed first and does not
reference the manifest, so this direction is acyclic.

For version one, `retentionClass` is fixed to `root-owned`; any other value is
invalid. M2 lease targets live only in the separate target-set rows below,
never in these entry rows.
Traversal starts from the binding, profile, catalog, reference-domain registry,
domain manifest, disclosure policy, semantic-axis policy, commit-capability
profile, input cut, decision set, projection batch, cursor, DynamicStore
snapshot, full ECS overlay change set, State-First source snapshot, and the
root-store-authored candidate lineage-floor anchor, plus exactly one
*current-cut* canonical `RealmProjectionReadCallReceiptV1` byte sequence from
the same reasserted artifact-producing reader result. For an observation-batch
cut that receipt requires and byte-matches the cut's batch pair; for source-
state or expiry it is the source-state variant and omits the batch pair. Its
source-state/retention pairs must byte-match the cut and reasserted evidence.
The current-cut receipt's frozen extractor reaches exactly one reader-escrow
manifest, whose extractor reaches the retained head/floor and original evidence
rows. Pair-only result aliases or an escrow manifest supplied as a second
independent seed are forbidden. Without this current-cut receipt seed the
candidate is structurally incomplete and no root, intent, or prepare request
may be produced.

Carry-forward is explicit rather than inferred from a Delta backlink. For every
retained candidate `RealmDynamicStoreSnapshotV1` entry whose
`sourceDeltaId`/`sourceDeltaDigest` is not an outcome of the current projection
batch, the compiler scans only the verified prior protected-closure manifest's
declared `RealmProjectionBatchV1` entries. It selects exactly one prior batch
whose nested primary or historical-witness outcome contains that exact Delta
pair and seeds that complete producer-context batch. Zero or multiple outcome
matches, a same-ID/different-digest match, or an outcome role inconsistent with
the retained entry rejects the candidate. The same carried batch is deduplicated
when several retained entries cite its Deltas.

Every protected-root `particle-realms.realm-observation-batch@1` occurrence not
bound by the one current observation-batch read receipt, whether reached from
the applied cursor or from a carried producer-context batch, must select exactly
one prior-manifest observation-batch `RealmProjectionReadCallReceiptV1`. Its
batch and source-state-snapshot pairs byte-match that origin input cut; its
retention-state pair byte-matches its own reader-escrow manifest and resolved
historical retention-state entry. Its extractor reaches exactly one matching
historical reader escrow plus the original evidence rows. The compiler seeds that historical
receipt and follows both the batch and receipt extractors. A missing or second
receipt, cross-batch/source/retention match, second escrow, or historical receipt
used to satisfy current-cut reassertion rejects the candidate. Thus there is
exactly one current-cut receipt seed plus zero or more uniquely derived
historical carry-forward receipt seeds.

Carried batches, receipts, escrows, and their extracted context remain root-
owned, count against the ordinary closure count/byte/work ceilings, and may
leave a later successor only after no cursor or retained entry cites the batch
or any Delta it produced. The Delta producer predicate may resolve membership
only in the current batch or one such carried producer-context batch;
possession of old Delta bytes alone is insufficient. These are declared prior-
manifest row scans, never arbitrary object-property traversal, and they preserve
restart verification after the prior root itself ages out.

Registry-bound dependency extractors then include exact
root-copied current M2 runtime-capability-profile bytes; root-copied current M3A
ingress binding, ingress profile, source manifest, and safe-normalization-
profile bytes; observation batch/record bytes; M3A append, head, retention-state, source-state,
checkpoint/recovery evidence, the reader escrow
manifest, and its read-call receipt; recorded authority receipts, signature
envelopes, resolution receipt, and authority escrow manifest; the expiry-due
receipt when present; static projection-binding
records, shipped descriptors/resources, presentation commands, the static-
resolution receipt, and every standalone `RealmDeltaV1`. Delta payloads and
all structural, maintenance, store-entry, ECS operation/component/full-overlay,
and State-First source/dependency rows remain inside their exact parent bytes
and are not separate manifest entries. The same walk emits the seven allowed
M2 artifact families directly as target rows; it emits no M2 artifact bytes and
no not-yet-issued lease receipt.

Traversal never scans arbitrary object properties. It follows only the exact
`dependencyExtractorId`/digest bound by the reference-domain registry for each
`objectKind`, deduplicates by
`(retentionClass, objectKind, objectId, objectDigest)`, rejects same-kind/same-ID byte conflicts, orders by
that tuple using code-point order, recomputes every dependency pair, count, byte
total, row digest, retention request, and manifest digest, and enforces
the profile's full closure ceilings. A referenced presentation command resolves
through exactly one projection-batch command pair, one exact canonical command
byte sequence from the pure projector work product or verified retained origin,
and at least one admitted presentation Delta whose ID-only
`presentationCommandId` equals that pair's command ID. Trusted prepare
recompiles or resolves the same bytes and recomputes the external content
digest. The exact command bytes and digest are closure entries rather than an
ambiguous transitive promise. A free, missing, uncited, conflicting, or multiply
matched command rejects the candidate. `entryCount` counts only
root-owned entries and
`canonicalByteCount` is exactly the sum of their canonical bytes; therefore
both candidate/prior-state object-byte arrays have one sequence per entry.

The service-internal `M2StaticArtifactLeaseTargetSetV1` has exactly ten fields:

```text
format
version
targetSetId
runtimeBindingId
runtimeBindingDigest
targetRows
targetCount
canonicalByteCount
sourceLeaseTargetRowsDigest
targetSetDigest
```

Each target row has exactly eight fields: `targetOrder`, `artifactKind`,
`artifactId`, `artifactDigest`, `artifactRevision`, `resolverKind`,
`referenceCanonicalByteCount`, and `rowDigest`. Rows are the code-point-sorted unique
output of the pure walk and are capped by
`maximumStaticArtifactLeaseReferences`; no caller-selected target is legal.
`targetOrder` is dense and zero-based after sorting, and `targetCount` equals
`targetRows.length`.
`referenceCanonicalByteCount` is the canonical byte length of that row's first
six pair-only reference fields; it never claims the unavailable issuer-artifact
byte length. Each `rowDigest` uses `particle-realms.m3b-m2-static-artifact-lease-target-row@1`
over its first seven fields in listed order. `sourceLeaseTargetRowsDigest` uses
`particle-realms.m3b-m2-static-artifact-lease-source-rows@1` over the complete
ordered canonical eight-field target rows plus `targetCount`; no second
accumulator object exists. The target set therefore does not point back to the
closure manifest and cannot form a digest cycle.
Top-level `canonicalByteCount` is exactly the sum of all
`referenceCanonicalByteCount` values. Distinct target positions count
separately even when their resolved artifacts are physically shared. Actual
issuer-artifact bytes are metered later by the trusted M2 lease owner and do not
enter the pre-prepare target-set identity. `targetSetId` uses
`particle-realms.m3b-m2-static-artifact-lease-target-set-id@1` over, in order,
the runtime-binding pair, `targetCount`, `sourceLeaseTargetRowsDigest`, and
`canonicalByteCount`; it excludes format/version, itself, the rows, and the
final digest while the row aggregate closes them. `targetSetDigest` uses
`particle-realms.m3b-m2-static-artifact-lease-target-set@1` over the first nine
top-level fields in listed order, including the recomputed ID and complete rows,
with only itself omitted.
`retentionRequestDigest` equals `targetSetDigest`. An exact empty set
is forbidden because every M3B root binds at least the active bake, layout,
static store, and projection-binding index.

Root-owned bytes live in the projection root store. Every referenced M3A batch,
observation, append/head/source-state/checkpoint/recovery/acquisition record and
every recorded authority receipt/envelope is copied there as the byte-identical
canonical sequence whose original owner and ID/digest remain unchanged. This is
evidence escrow, not an M3A mutation, ACK, or replacement record. No committed
root depends on a future checkpoint edge or on M3A retaining the original bytes.
The candidate lineage-floor anchor is also a root-owned closure entry whose
`sourceAuthority` is the root store; it contains no candidate-root backlink and
therefore creates no digest cycle. The acquired artifact-lease receipt remains
operational selected-bundle evidence because it does not exist until after the
lease-neutral root freezes.
Target rows name the bake, layout, static store, projection index,
bindings, descriptors, and resources covered by the deterministic
`retentionRequestDigest`. Trusted prepare acquires that exact service-only
root-scoped lease after root freeze. The accepted lease receipt embeds the exact
canonical `M2StaticArtifactLeaseTargetSetV1` bytes in addition to its pair, so a
complete-base prior-state read obtains the set inside the fixed lease-receipt
position without a second closure object. The selected bundle plus application
receipt bind that lease receipt. Release requires a verified successor/floor,
resolution of any optional protecting M3A edge, and safe durable-root-store M2
lease transfer or release.

The root does not reference its application intent, application receipt,
recovery receipt, disposal receipt, or a later M3A checkpoint. Those records may
point to the root. This direction prevents digest cycles.

`RealmProjectionRootVerifier` registers only the existing closed M3A target kind
`projection-root`. It verifies format/version, root ID/digest, current or
historical binding rules, complete protected closure, bounded retained suffix or
lineage-floor anchor, root-owned evidence escrow, selected-bundle artifact lease,
and root-store presence. Registration alone is not an M3A retention edge. Only M3A's existing
checkpoint owner may include a verified current root during an ordinary
checkpoint commit.

## `RealmProjectionApplicationIntentV1`

The application intent has a closed 42-field top-level vocabulary:

```text
format
version
intentId
realmId
runtimeBindingId
runtimeBindingDigest
inputCutId
inputCutDigest
projectionBatchId
projectionBatchDigest
expectedHeadState
headReadReceiptId
headReadReceiptDigest
expectedAppliedCursorId
expectedAppliedCursorDigest
candidateAppliedCursorId
candidateAppliedCursorDigest
candidateDynamicStoreSnapshotId
candidateDynamicStoreSnapshotDigest
candidateEcsChangeSetId
candidateEcsChangeSetDigest
candidateStateFirstSourceSnapshotId
candidateStateFirstSourceSnapshotDigest
candidateProjectionRootId
candidateProjectionRootDigest
candidateInternalClosureManifestId
candidateInternalClosureManifestDigest
staticArtifactLeaseTargetSetId
staticArtifactLeaseTargetSetDigest
expectedProjectionRootId
expectedProjectionRootDigest
expectedProjectionRootGeneration
expectedDynamicStoreGeneration
expectedEcsSourceGeneration
expectedStateFirstSourceGeneration
expectedProjectionBundleGeneration
targetProjectionBundleGeneration
presentationFenceId
presentationFenceDigest
idempotencyKey
logicalTick
intentDigest
```

`expectedHeadState` is `empty` or `present`. `empty` requires a verified empty
head-read receipt, omits both expected cursor/root pairs, and sets every expected
M3B generation to zero. `present` requires both pairs and their exact positive
current generations. Target bundle generation is expected plus one. Candidate
ECS or State-First generation may equal expected only for a byte-identical full
result; otherwise it is expected plus one. The presentation-fence pair is always
present but is not referenced by the candidate root. It is `ready` for ordinary
work or `recovering` only for an accepted device-catch-up transaction; the other
fence states are invalid. A recovering intent can select hidden CPU state but
cannot issue presentation-ready evidence. The candidate closure pair
must recompute to the root's `internalClosureDigest`; the lease-target set pair
must recompute from exactly its separate M2 target rows and equal the closure's
`retentionRequestDigest`. No lease receipt exists yet and no intent field may
pretend otherwise.

Before deriving the idempotency key, the builder resolves the bound projection-
batch bytes and extracts their verified `projectionSequence`; a caller scalar
or root-only inference is forbidden. `idempotencyKey` uses
`particle-realms.m3b-projection-application-idempotency-key@1` over, in exact
order, the runtime-binding pair, presentation-fence pair, that
`projectionSequence`, the input-cut pair, candidate-root pair, candidate-
closure-manifest pair, static-artifact-lease-target-set pair,
`expectedHeadState`, the expected-root pair only when present, the head-read-
receipt pair, `expectedProjectionRootGeneration`,
`expectedDynamicStoreGeneration`, `expectedEcsSourceGeneration`,
`expectedStateFirstSourceGeneration`, `expectedProjectionBundleGeneration`, and
`targetProjectionBundleGeneration`. The expected-root pair is truly omitted for
the empty-head variant rather than encoded as `null`. The key uses no random
UUID or wall time.

The intent is a proposal to the prebound trusted commit service. It is not a
capability, CSE command, ECS journal handle, or proof of commitment.

## `RealmProjectionApplicationReceiptV1`

The application receipt has a closed 37-field top-level vocabulary:

```text
format
version
receiptId
realmId
runtimeBindingId
runtimeBindingDigest
intentId
intentDigest
disposition
dispatchState
proposedBundleId
proposedBundleDigest
proposedProjectionRootId
proposedProjectionRootDigest
expectedHeadKind
expectedPriorProjectionRootId
expectedPriorProjectionRootDigest
observedCompetingProjectionRootId
observedCompetingProjectionRootDigest
committedProjectionRootId
committedProjectionRootDigest
candidateAppliedCursorId
candidateAppliedCursorDigest
candidateDynamicStoreSnapshotId
candidateDynamicStoreSnapshotDigest
candidateEcsChangeSetId
candidateEcsChangeSetDigest
candidateStateFirstSourceSnapshotId
candidateStateFirstSourceSnapshotDigest
operationJournalReceiptId
operationJournalReceiptDigest
projectionSelectorCasReceiptId
projectionSelectorCasReceiptDigest
staticArtifactRetentionReceiptId
staticArtifactRetentionReceiptDigest
reasonCode
receiptDigest
```

The closed dispositions are:

```text
committed
proven-not-committed
conflict
stale-binding
invalid
unavailable
aborted-before-dispatch
recovery-pending
```

`dispatchState` is exactly `not-dispatched`, `dispatched`, or `uncertain`.
`expectedHeadKind` is `empty` or `present`; the expected-prior-root pair is
absent only for `empty` and required only for `present`.
For every disposition, `expectedHeadKind` must byte-match the referenced
intent's `expectedHeadState`, and the receipt's conditional expected-prior-root
pair must be absent or byte-identical to that intent under the same variant.

Conditional presence is exact:

- `committed` is `dispatched`; requires the proposed bundle/root, every
  candidate pair, terminal journal, selector-CAS, and static-artifact retention
  pairs; requires the terminal journal evidence to prove readback/adoption of
  the exact candidate evidence escrow; and requires the committed root to equal
  the proposed root;
- `conflict` is `dispatched`; requires the proposal, candidates, verified
  competing root, terminal journal, selector-CAS pairs, and one closed reason;
  and forbids
  committed-root and static-retention fields;
- `proven-not-committed` is `dispatched`; requires the proposal, candidates,
  terminal journal, selector-CAS/readback proof, and one closed reason proving
  the candidate was never selected; and forbids competitor, committed-root, and
  static-retention fields;
- `recovery-pending` is `uncertain`; requires the proposal, candidates,
  nonterminal journal, and one closed reason; a selector-CAS pair is present only
  when exact evidence was issued, and no committed/noncommitted claim or static-
  retention receipt is present;
- `stale-binding`, `invalid`, `unavailable`, and `aborted-before-dispatch` are
  `not-dispatched`; require one closed reason, the proposed projection-root pair,
  and all four candidate cursor/DynamicStore/ECS/State-First pairs byte-identical
  to the valid immutable intent; the proposed bundle and exact terminal-
  readback application-journal pairs are always required and must extend the
  accepted `prepared` row while proving that same pre-dispatch disposition;
  selector-CAS, competitor, committed-root, and static-retention fields remain
  absent;
- one field from a conditional pair without the other is invalid.

The corresponding own-key counts are closed; the two numeric columns differ
only by the expected-prior-root pair:

| Receipt variant | Empty head | Present head |
| --- | ---: | ---: |
| `committed` | 32 | 34 |
| `conflict` | 31 | 33 |
| `proven-not-committed` | 29 | 31 |
| `recovery-pending/dispatch-started` | 27 | 29 |
| `recovery-pending/selected` | 29 | 31 |
| recognized pre-dispatch failure with terminal journal evidence | 27 | 29 |

No other own-key count or preparation-phase combination is valid.

Application receipt identity is variant- and omission-safe. Construct one
hash-only `presenceVector` as a canonical JSON array of exactly 33 Booleans, one
for each displayed field from `realmId` through `reasonCode` in that exact
order. A value is `true` exactly when that own key is present. Construct
`presentFieldRows` in the same order, with one exact two-item canonical JSON
array `[fieldName, canonicalValue]` for each `true` position and no row for a
`false` position. `receiptId` uses
`particle-realms.m3b-projection-application-receipt-id@1` over, in order,
`version`, `presenceVector`, and the complete `presentFieldRows`. `receiptDigest`
uses `particle-realms.m3b-projection-application-receipt@1` over, in order,
`format`, `version`, the recomputed `receiptId`, `presenceVector`, and the same
complete rows. The vector and rows are derivations, not schema keys. A wrong
vector length, missing or extra row, non-displayed name, reordered row,
present-null substitution for omission, or conditional shape outside the table
fails before either hash is accepted. Application terminal evidence recomputes
this exact pair from its closed canonical receipt bytes.

The two no-journal application-receipt shapes are unreachable and forbidden:
`prepare()` is the only bundle builder, it persists/read-backs `prepared` before
returning its prepare pair, and `commit()` accepts only that pair. Failures before
accepted prepare are reason-only `prepare` results and never fabricate
`RealmProjectionApplicationReceiptV1` bytes.

A terminal operation-journal pair requires its terminal phase-evidence rows to
match every application-receipt conditional field, disposition, dispatch
state, and reason byte-for-byte. One terminal journal row therefore authorizes
exactly one receipt payload and cannot be reused for a different root, selector,
candidate, outcome, or reason. The nonterminal journal pair required by
`recovery-pending` instead resolves to the exact latest `dispatch-started` or
`selected` row: its binding, intent, and candidate fields must byte-match the
receipt; the receipt's expected-head fields must byte-match that immutable
intent; its operation, attempt, idempotency key, and selector generations must
satisfy the uniquely addressed journal chain and exact intent; and its
`terminalResult`, `reasonCode`, and terminal-evidence rows must be absent.
`dispatch-started` forbids the receipt's optional selector-CAS pair; `selected`
requires that pair to byte-match its selector-CAS/readback phase evidence. The
receipt's closed reason states only why durable terminal readback is still
unavailable. Neither nonterminal phase supplies or implies a terminal
disposition.

Pre-intent validation failure is a port result, not a fabricated application
receipt. `unavailable` is legal only before durable dispatch. After dispatch,
inability to prove the result is always `recovery-pending`. The selector-CAS and
artifact-retention receipts belong to the separately versioned M3 projection
transaction and do not alter the M2 active-bake CSE root or establish OS
authority. The static-retention receipt proves the selected bundle's lease is
owned by the root store after commit; it is not part of the lease-neutral root
digest.

## Atomic application protocol

One projection attempt follows this exact transaction:

1. Open one context session; verify each port against its own code-shipped
   descriptor and verify their mutually byte-identical 53-field binding pair.
2. Read and verify the complete current M3B base, or the exact M2-seeded empty
   base for the first observation-batch cut.
3. Capture exactly the next M3A batch or one `source-state-ready` result with its
   complete retention-state/evidence escrow; an expiry cut additionally requires
   the exact due receipt. Capture the matching context and presentation fence.
4. Resolve the complete subject-authorized static binding/anchor closure and,
   for an observation batch, recorded authority evidence for every authority-
   domain observation in that batch. Separately resolve the complete current-
   authority snapshot required by the presentation fence.
5. Freeze the input cut and disclosure decision set.
6. Run the neutral shared semantic kernel: all primary owners, the historical
   witness when eligible, and the maintenance compiler for a maintenance cut.
7. Assemble and independently verify the canonical projection batch.
8. Purely reduce the six-channel DynamicStore candidate, full stable-ID ECS
   overlay, and one semantic-only State-First source snapshot.
9. Freeze the applied cursor, reader/recorded-authority root-owned evidence
   escrow closure, exact M2
   lease-target set, candidate lineage-floor anchor, lineage accumulator,
   lease-neutral self-contained root, and one 42-field application intent. No
   artifact-lease receipt exists in any of those identities.
10. Reassert the M3A read/retention/escrow, source-state/due, static, recorded authority,
    current-authority fence, head-read, selection, binding, and presentation
    evidence.
11. Ask the trusted commit service to replay the same shared semantic kernel,
    recompute every candidate byte, persist/read-back and adopt the M3A evidence
    escrow, acquire the exact target-set M2 artifact lease, and build the
    complete immutable projection bundle off-active. The bundle, prepare result,
    journal, and eventual application receipt bind the acquired lease.
12. Persist and read back the bounded operation-journal `prepared` phase.
13. Reassert expected head, selection, structural, frame, and unchanged `ready`
    or authorized catch-up `recovering` fences inside the protected barrier.
14. Persist and read back `dispatch-started`; no durable selector has changed.
15. Perform exactly one durable
    expected-selector-generation CAS from the old complete bundle ID to the new
    complete bundle ID; this is the sole logical linearization point.
16. Read back the durable selector and journal, then mirror the selected bundle
    process-locally when possible; record only a proven
    terminal outcome or `recovery-pending`.
17. Issue the application receipt, then release only leases and candidates
    proven safe to release.
18. For a `ready` fence, allow the renderer to join the committed semantic
    source to presentation policy on a later frame. A `recovering` commit stays
    hidden until `recover(device-resume)` issues the closed-to-ready evidence.

The one selector-selected logical atomic bundle contains:

```text
self-contained projection root and protected closure manifest
bounded lineage accumulator and lineage-floor anchor
projection-applied cursor and seven exact source-state slots
complete six-channel DynamicStore snapshot and entry closure
complete stable-ID M3B ECS overlay and generation
complete semantic-only State-First source snapshot and generation
M2 static-artifact lease receipt and bundle generation
```

No member is sequentially mutated in active state. Candidate construction,
validation, persistence, and GPU-independent materialization finish off-active;
the logical transition is the single durable selector-generation CAS. A failed
or out-of-memory in-process mirror is a presentation/recovery failure, not a
second logical commit or rollback: dynamic presentation closes, M2 static stays
visible, and reconciliation reloads the durable selection. This is a separate
M3 projection-transaction capability and does not widen the frozen M2 commit
contract. GPU retained storage and a rendered frame are outside the atomic
bundle. If GPU work fails after logical commit, the dynamic source is hidden and
the last committed CPU bundle replays only after accepted M2 device recovery.

## Projection attempt state machine

The attempt and durable-journal state machines are exact:

```text
created
  -> cut-captured
  -> evidence-resolved
  -> disclosed
  -> projected
  -> reduced
  -> bundle-built
  -> prepared
  -> dispatch-started
  -> selected
  -> terminal-readback
```

Terminal paths are:

```text
committed -> closed
proven-not-committed -> retryable | abandoned
conflict -> abandoned
stale-binding -> abandoned
aborted-before-dispatch -> abandoned
unavailable -> abandoned
invalid -> abandoned
```

An uncertain path is:

```text
recovery-pending
  -> reconciling
  -> committed
   | proven-not-committed
   | conflict
   | recovery-pending
```

The durable journal phase is exactly `prepared`, `dispatch-started`, `selected`,
or `terminal-readback`; the journal's closed result field distinguishes
committed, conflict, proven-not-committed, and pre-dispatch abort terminal rows.
A conflict or pre-dispatch abort may terminalize without `selected`. Once
`dispatch-started` is durable, an unknown result remains `recovery-pending` until
selector readback proves the next phase; no process-local error can skip or
forge it. Only `proven-not-committed` may enter a new bounded prepare/dispatch
attempt, using the same intent and idempotency bytes. An unresolved
candidate/root remains retained and unreleasable under the commit journal/
session owner behind the closed dynamic gate. It is not released, reread from
M3A as if unapplied, or reported as noncommitted. No pre-stop quarantine
ownership is claimed. Only the ordinary stop protocol's exact 21-field
quarantine receipt may consume that application tail and candidate inventory
once. The application journal's `attempt` counts CAS attempts only and advances
only after terminal `proven-not-committed`; repeated `reconcile()` of a pending
application is idempotent and does not increment or reset it. Bounded pending
readback is instead routed through
`recover(uncertain-commit-reconciliation)`, whose separate 18-field journal owns
the restart-stable `recoveryAttempt` counter from one through three. If its third
attempt remains pending, the explicit degraded static-fallback recovery rule below
applies while the application tail stays under the commit journal/session owner
and the recovery tail stays under the recovery journal owner until ordinary
stop quarantine consumes both exactly once.

Before a nonterminal application journal row is admitted, its owner issues and
reads back one exact `RealmProjectionApplicationPhaseEvidenceV1` with this
closed 14-field vocabulary:

```text
format
version
phaseEvidenceId
runtimeBindingId
runtimeBindingDigest
operationId
attempt
intentId
intentDigest
phaseKind
referencedEvidenceId
referencedEvidenceDigest
disposition
evidenceDigest
```

Its format is `particle-realms.m3b-application-phase-evidence` and version is
`1`. `prepare-readback/verified` and `selector-readback/verified` have all 14
keys and reference respectively the exact prepare readback pair and durable
selector-CAS/readback pair. `dispatch-start/dispatch-recorded` has 12 keys and
omits the referenced-evidence pair; the journal owner atomically persists and
reads back that evidence plus its `dispatch-started` row before invoking the
selector mutation. All variants bind the same application operation, attempt,
and intent. `phaseEvidenceId` uses
`particle-realms.m3b-application-phase-evidence-id@1` over, in order, the
runtime-binding pair, operation, attempt, intent pair, phase kind, conditionally
present referenced-evidence pair, and disposition; it excludes `format`,
`version`, itself, and `evidenceDigest`. `evidenceDigest` uses
`particle-realms.m3b-application-phase-evidence@1` over every present preceding
field in listed order, including
`phaseEvidenceId`. Thus neither preimage is cyclic, and a prepare, dispatch,
selector, terminal, recovery, or retirement value cannot substitute for
another.

Each immutable durable `RealmProjectionApplicationOperationJournalRecordV1` has
a closed 24-field vocabulary:

```text
format
version
journalRecordId
runtimeBindingId
runtimeBindingDigest
extensionChildGeneration
operationId
attempt
intentId
intentDigest
idempotencyKey
expectedSelectorGeneration
targetSelectorGeneration
candidateBundleId
candidateBundleDigest
candidateProjectionRootId
candidateProjectionRootDigest
phase
phaseEvidenceId
phaseEvidenceDigest
priorJournalRecordDigest
terminalResult
reasonCode
recordDigest
```

`prepared`, `dispatch-started`, and `selected` rows have exactly 22 own keys and
omit `terminalResult`/`reasonCode`. A `terminal-readback/committed` row has 23
and omits only `reasonCode`. Other terminal rows have all 24 and require one
closed reason. The first row uses the binding/intent-specific journal seed as
`priorJournalRecordDigest`; every later row names the exact preceding row.
`phaseEvidence` is respectively the matching application-phase-evidence
`prepare-readback`, `dispatch-start`, or `selector-readback` pair, or the
separate application-terminal-evidence pair. Every pair resolves through its
named owner and exact phase before the journal row is accepted.

The application operation and chain are constructive. `operationId` uses
`particle-realms.m3b-application-operation-id@1` over, in order,
`runtimeBindingDigest`, `intentDigest`, and `idempotencyKey`. The first row's
`priorJournalRecordDigest` uses
`particle-realms.m3b-application-journal-seed@1` over the runtime-binding pair,
`operationId`, the intent pair, and `idempotencyKey`. Every later row, including
one in a later CAS attempt, uses the exact immediately preceding
`recordDigest`; no phase-specific reset or zero digest is legal. For each
24-field journal record, form the exact 20-position
`P(runtimeBindingId..reasonCode)` and corresponding field rows.
`journalRecordId` uses
`particle-realms.m3b-application-operation-journal-record-id@1` over `version`,
that vector, and those rows. `recordDigest` uses
`particle-realms.m3b-application-operation-journal-record@1` over `format`,
`version`, the recomputed ID, the same vector, and the same rows. These hash-only
derivations preserve every terminal omission and are not record keys.

The terminal pair resolves to an exact 11-field
`RealmProjectionApplicationTerminalEvidenceV1`: `format`, `version`,
`terminalEvidenceId`, the runtime-binding pair, `operationId`, `attempt`,
`intentDigest`, `terminalPayloadRows`, `terminalPayloadDigest`, and
`evidenceDigest`. `format` is
`particle-realms.m3b-application-terminal-evidence` and `version` is one. Each
payload row has exactly `fieldName`, `canonicalValueBytes`, and `rowDigest`.
Rows follow application-receipt top-level order and contain `disposition`,
`dispatchState`, every conditionally present proposed-bundle/proposed-root
field, `expectedHeadKind`, the conditionally present expected-prior-root pair,
every conditionally present competitor, committed-root, candidate, selector,
and static-retention field, and conditionally present `reasonCode`. Those
expected-head rows must also byte-match the referenced immutable intent. They exclude the
later application-receipt identity/digest and operation-journal pair. Terminal
evidence is read back before the journal row;
the row binds it and the later application receipt binds the row, never the
reverse, so no digest cycle exists.

Payload field names are unique and rows occur in the exact future-receipt field
order described above; there is no caller order. Each `rowDigest` uses
`particle-realms.m3b-application-terminal-payload-row@1` over `fieldName` then
`canonicalValueBytes`. `terminalPayloadDigest` uses
`particle-realms.m3b-application-terminal-payload-rows@1` over the complete
ordered three-field rows followed by their exact row count.
`terminalEvidenceId` uses
`particle-realms.m3b-application-terminal-evidence-id@1` over, in order, the
runtime-binding pair, `operationId`, `attempt`, `intentDigest`,
`terminalPayloadDigest`, and the payload-row count. `evidenceDigest` uses
`particle-realms.m3b-application-terminal-evidence@1` over the first ten fields
in listed order, including the recomputed ID and complete payload rows. A
duplicate, omitted, extra, reordered, or noncanonical field row rejects the
terminal evidence.

The tuple `(runtimeBindingDigest, intentDigest, idempotencyKey)` names one
operation forever. Reusing the key with different intent/candidate bytes,
decreasing or skipping `attempt`, changing either selector generation, or
reusing one target generation for a different bundle/root is an ABA violation
and quarantines the operation. Attempt one is mandatory; attempt two or three is
legal only when the prior terminal row is `proven-not-committed`. Each retry
retains the identical intent, idempotency key, candidate bundle/root, and target
generation. Selector readback must prove exactly the expected predecessor or
the candidate successor; any third value is a proven conflict, never a retry.

## Service-internal recovery-attempt journal

Recovery never fabricates an application intent, idempotency key, candidate
bundle, candidate root, or selector target merely to fit the application
journal. The recovery-journal owner first issues and reads back one exact
`RealmProjectionRecoveryPhaseEvidenceV1` for every nonterminal phase. It has
this closed 14-field vocabulary:

```text
format
version
phaseEvidenceId
runtimeBindingId
runtimeBindingDigest
recoveryOperationId
recoveryKind
recoveryAttempt
canonicalRequestDigest
phaseKind
joinedEvidenceRowsDigest
mutationPlanDigest
disposition
evidenceDigest
```

Its format is `particle-realms.m3b-recovery-phase-evidence`, version is `1`.
The code-shipped empty values are exactly
`H(particle-realms.m3b-recovery-joined-evidence-rows@1, [], 0, 0)` and
`H(particle-realms.m3b-recovery-mutation-plan@1, [], 0)`; the domains and
preimage arities differ and neither sentinel is a serialized record or store
key. Its exact variants are: `request-admission/admitted`, with both sentinels;
`joined-evidence-readback/verified`, with the nonempty complete joined-set
digest and the empty-plan sentinel; and `mutation-dispatch/dispatch-recorded`,
with that same joined-set digest plus one nonempty exact mutation-plan digest.
The journal owner atomically persists and reads back a mutation-dispatch
evidence value and its journal row before invoking any target. A no-mutation
path omits that whole phase and continues to use the empty-plan sentinel. Every
value binds one operation, kind, attempt, and canonical request; no digest is a
hidden store key or live handle. `phaseEvidenceId` uses
`particle-realms.m3b-recovery-phase-evidence-id@1` over, in order, the runtime-
binding pair, recovery operation/kind/attempt, canonical request digest, phase
kind, both phase-specific digests, and disposition; it excludes `format`,
`version`, itself, and `evidenceDigest`. `evidenceDigest` uses
`particle-realms.m3b-recovery-phase-evidence@1` over every present preceding
field in listed order, including
`phaseEvidenceId`.

The complete joined set is a service-local
`RealmProjectionRecoveryJoinedEvidenceRowsV1` with exactly 12 fields:

```text
format
version
runtimeBindingId
runtimeBindingDigest
recoveryOperationId
recoveryKind
recoveryAttempt
canonicalRequestDigest
evidenceRows
evidenceCount
canonicalByteCount
joinedEvidenceRowsDigest
```

Its format is `particle-realms.m3b-recovery-joined-evidence-rows`, version is
one, and every evidence row has exactly ten fields:
`evidenceOrder`, `evidenceKind`, `evidenceId`, `evidenceDigest`,
`evidenceRoles`, `sourceAuthority`, `requiredResolverKind`, `canonicalBytes`,
`canonicalByteCount`, and `rowDigest`. One row exists per unique
`(evidenceKind, evidenceId, evidenceDigest)` tuple. Multiple uses of the same
object merge into one `evidenceRoles` array in the frozen role order below.
Rows follow the evidence-kind order below and then code-point ID/digest order;
`evidenceOrder` is dense. The owner/resolver table is literal and closed:

| `evidenceKind` in fixed order | Required schema or reference domain | Exact `sourceAuthority` | Exact `requiredResolverKind` |
| --- | --- | --- | --- |
| `runtime-binding` | `RealmProjectionRuntimeBindingV1` / `particle-realms.m3b-projection-runtime-binding@1` | `m3b-trusted-composition-root@1` | `m3b-runtime-binding-verifier@1` |
| `head-read-receipt` | `RealmProjectionHeadReadReceiptV1` / `particle-realms.m3b-projection-head-read-receipt@1` | `m3b-selector-root-store@1` | `m3b-head-read-receipt-verifier@1` |
| `prior-state-bundle` | `RealmProjectionPriorStateBundleV1` / `particle-realms.m3b-projection-prior-state-bundle@1` | `m3b-selector-root-store@1` | `m3b-prior-state-bundle-verifier@1` |
| `m2-static-baseline-descriptor` | `RealmProjectionM2StaticBaselineDescriptorV1` / `particle-realms.m3b-m2-static-baseline-descriptor@1` | `m3b-selector-root-store@1` | `m3b-static-baseline-verifier@1` |
| `projection-root` | `RealmProjectionStateRootV1` / `particle-realms.m3b-projection-state-root@1` | `m3b-selector-root-store@1` | `m3b-projection-root-verifier@1` |
| `applied-cursor` | `RealmProjectionAppliedCursorV1` / `particle-realms.m3b-projection-applied-cursor@1` | `m3b-selector-root-store@1` | `m3b-applied-cursor-verifier@1` |
| `m3a-retention-state` | `RealmProjectionM3ARetentionStateV1` / `particle-realms.m3b-m3a-retention-state@1` | `m3b-restricted-reader-projection@1` | `m3b-retention-state-verifier@1` |
| `source-state-snapshot` | `RealmProjectionSourceStateSnapshotV1` / `particle-realms.m3b-projection-source-state-snapshot@1` | `m3b-restricted-reader-projection@1` | `m3b-source-state-snapshot-verifier@1` |
| `current-authority-state-snapshot` | `RealmCurrentAuthorityStateSnapshotV1` / `particle-realms.m3b-current-authority-state-snapshot@1` | `m3b-current-authority-owner@1` | `m3b-current-authority-state-verifier@1` |
| `presentation-fence` | `RealmProjectionPresentationFenceV1` / `particle-realms.m3b-projection-presentation-fence@1` | `m3b-presentation-fence-service@1` | `m3b-presentation-fence-verifier@1` |
| `m2-device-recovery-receipt` | `particle-realms.m3b-ref/m2-device-recovery-receipt@1` | `m2-device-recovery-owner@1` | `m3b-m2-device-recovery-verifier@1` |
| `expiry-due-receipt` | `RealmProjectionExpiryDueReceiptV1` / `particle-realms.m3b-projection-expiry-due-receipt@1` | `m3b-tick-expiry-join@1` | `m3b-expiry-due-receipt-verifier@1` |
| `application-receipt` | `RealmProjectionApplicationReceiptV1` / `particle-realms.m3b-projection-application-receipt@1` | `m3b-application-receipt-store@1` | `m3b-application-receipt-verifier@1` |
| `application-journal-record` | `RealmProjectionApplicationOperationJournalRecordV1` / `particle-realms.m3b-application-operation-journal-record@1` | `m3b-application-journal-owner@1` | `m3b-application-journal-resolver@1` |
| `selector-read-receipt` | `RealmProjectionSelectorReadReceiptV1` / `particle-realms.m3b-projection-selector-read-receipt@1` | `m3b-selector-root-store@1` | `m3b-selector-read-receipt-verifier@1` |
| `catch-up-receipt` | `RealmProjectionCatchUpReceiptV1` / `particle-realms.m3b-projection-catch-up-receipt@1` | `m3b-recovery-service@1` | `m3b-catch-up-receipt-verifier@1` |
| `presentation-gate-transition-receipt` | `RealmProjectionPresentationGateTransitionReceiptV1` / `particle-realms.m3b-presentation-gate-transition-receipt@1` | `m3b-presentation-gate-service@1` | `m3b-presentation-gate-transition-verifier@1` |

The frozen role order is `bound-runtime`, `durable-head-read`, `current-base`,
`empty-static-baseline`, `prior-root-request`, `current-root-request`,
`prior-cursor-request`, `current-cursor-request`, `retention-request`,
`source-state-request`, `current-authority-request`,
`presentation-fence-request`, `device-recovery-request`, `expiry-due-request`,
`trigger-application-request`, `application-journal-tail`,
`durable-selector-read`, `existing-catch-up-readback`,
`existing-gate-transition-readback`, and `attempt-limit-fallback-fence`.
Each row's roles are the ordered unique projection of that list; an unknown or
out-of-order role fails.

The kind matrix is exact:

- `same-binding-restore` joins the present complete-base head receipt and prior-
  state bundle, current root/cursor request pairs, and retention state;
- `same-binding-replay` joins those restore rows plus prior root/cursor,
  source-state, and current-authority rows;
- `uncertain-commit-reconciliation` joins the trigger application receipt,
  exact latest same-operation application-journal tail, and durable head read.
  A present head also joins its prior-state bundle, derived current root/cursor,
  and selector-read receipt; an empty head joins the M2 static-baseline
  descriptor and forbids those present-head rows;
- `device-resume` joins a present complete-base head receipt, prior-state bundle,
  selector-read receipt, prior/current roots and cursors, retention state,
  recovering presentation fence, device-recovery receipt, source state, current
  authority, and exactly the expiry-due row iff the recover request carries its
  pair. It additionally joins an existing same-operation catch-up or gate-
  transition receipt iff durable readback proves that phase already completed;
- `static-fallback` joins its presentation fence and either both verified prior
  root/cursor rows or neither. Readable present state additionally joins its
  complete-base head receipt/bundle; readable empty state joins its head receipt/
  static-baseline descriptor. Corrupt or unreadable M3B state may omit both head
  alternatives because this kind can only close dynamic presentation and select
  the accepted complete M2 static city; and
- attempt three of every non-fallback kind also joins exactly one current
  `attempt-limit-fallback-fence`. It may merge with the request presentation-
  fence row only when the pair is byte-identical. The recovery fence service,
  not the app, resolves it immediately before the set freezes.

The runtime-binding row is always present. Every request pair and internally
derived row must appear exactly when its matrix row requires it; no other row is
legal. Intrinsic pairs recompute from `canonicalBytes` under the mapped schema,
opaque M2 bytes verify through the mapped accepted-owner resolver, and the
source authority/resolver fields must equal the literal table row. A row digest
uses `particle-realms.m3b-recovery-joined-evidence-row@1` over its first nine
fields. `evidenceCount = evidenceRows.length`; `canonicalByteCount` is the sum
of every embedded object's exact canonical UTF-8 byte length and each row copies
that object's length. `joinedEvidenceRowsDigest` uses
`particle-realms.m3b-recovery-joined-evidence-rows@1` over, in order, `format`,
`version`, the runtime-binding pair, operation/kind/attempt, request digest,
complete rows, count, and byte total. The complete set must fit the caller's
entry/byte maxima and the derived current-state-read ceilings before admission.

The recovery-journal owner persists and reads back the complete set bytes, then
atomically issues the joined-evidence phase evidence and journal row. Original
resolvers supply bytes but never own the set. The app receives neither the set
nor a key. Resolved object bytes charge current-state-read accounting once;
set, phase-evidence, and journal bytes charge the operation's ordinary journal
reservation.

A nonempty mutation is frozen in one service-local
`RealmProjectionRecoveryMutationPlanV1` with exactly 15 fields:

```text
format
version
mutationPlanId
runtimeBindingId
runtimeBindingDigest
recoveryOperationId
recoveryKind
recoveryAttempt
canonicalRequestDigest
joinedEvidenceRowsDigest
mutationRows
mutationCount
canonicalByteCount
disposition
mutationPlanDigest
```

Its format is `particle-realms.m3b-recovery-mutation-plan`, version is one, and
`disposition` is only `dispatchable`. Every mutation row has exactly seven
fields: `mutationOrder`, `mutationKind`, `dispatchCondition`, `targetOwner`,
`canonicalMutationRequestBytes`, `canonicalMutationRequestDigest`, and
`rowDigest`. Order is dense. The request bytes first validate one exact payload
schema below; their digest then uses the payload format plus `@1` as the domain
over the one canonical byte sequence. A row digest uses
`particle-realms.m3b-recovery-mutation-row@1` over its first six fields.
`mutationCount = mutationRows.length`, `canonicalByteCount` is the complete
seven-field row-byte sum, and a materialized plan has one through three rows.

The payload schemas and target owners are exact:

| `mutationKind` / literal payload `format` | Exact fields after `format`, `version` | Exact `targetOwner` / condition |
| --- | --- | --- |
| `restore-selected-bundle` / `particle-realms.m3b-recovery-mutation-request/restore-selected-bundle` | runtime-binding pair, operation ID, attempt, canonical request digest, joined-set digest, head-read-receipt pair, prior-state-bundle pair, current-root pair, current-cursor pair; 16 fields total | `realm-projection-bundle-adapter@1` / `immediate` |
| `append-application-terminal-readback` / `particle-realms.m3b-recovery-mutation-request/append-application-terminal-readback` | runtime-binding pair, operation ID, attempt, canonical request digest, joined-set digest, trigger-application-receipt pair, application-journal-tail pair, head-read-receipt pair, and the selector-read-receipt pair iff the joined head is present; 14/16 fields total | `m3b-application-journal-owner@1` / `immediate` |
| `persist-device-catch-up-readback` / `particle-realms.m3b-recovery-mutation-request/persist-device-catch-up-readback` | runtime-binding pair, operation ID, attempt, canonical request digest, joined-set digest, prior/current cursor pairs, retention-state pair, source-state pair, current-authority pair, conditional expiry-due pair, selector-read-receipt pair, current-root pair, and complete candidate `RealmProjectionCatchUpReceiptV1` bytes; 23/25 fields total | `m3b-recovery-service@1` / `immediate` |
| `transition-presentation-gate-closed-to-ready` / `particle-realms.m3b-recovery-mutation-request/transition-presentation-gate-closed-to-ready` | runtime-binding pair, operation ID, attempt, canonical request digest, joined-set digest, recovering-fence pair, device-recovery pair, catch-up-receipt pair, and complete candidate ready-fence bytes; 15 fields total | `m3b-presentation-gate-service@1` / `after-catch-up-readback` |
| `activate-complete-m2-static-fallback` / `particle-realms.m3b-recovery-mutation-request/activate-complete-m2-static-fallback` | runtime-binding pair, operation ID, attempt, canonical request digest, joined-set digest, presentation-fence pair, and either both prior-root/prior-cursor pairs or neither; 10/14 fields total | `m2-composition-root@1` / `immediate` for primary fallback, `after-primary-pending` for attempt-limit contingency |

Every payload has `version = 1`; the listed order is its exact own-key order.
The catch-up candidate bytes must recompute completely from joined evidence
before dispatch. An existing catch-up readback removes the persist row and feeds
its exact pair to the gate row. An existing matching gate-transition readback
means device recovery requires no mutation. The candidate ready fence is
likewise completely derived before the gate call; neither candidate byte string
claims durable issuance. Target owners accept only the embedded canonical
request bytes and cannot widen them.

The mutation matrix is closed. Restore requires only its restore row. Replay has
no primary mutation. Uncertain reconciliation has zero or one append-terminal
row depending on whether durable selector readback proves a terminal result not
yet journaled. Device resume has catch-up then gate rows, only gate when catch-up
already exists, and no row when both durable receipts already exist. Independent
`static-fallback` requires its one immediate fallback row. At attempt three of a
non-fallback kind, exactly one contingency fallback row follows all still-needed
primary rows or is the sole row; it may dispatch only after durable pending proof
and never after terminal success, conflict, or proven noncommit. Every crossed
kind, reordered row, fourth row, or extra/omitted contingency fails.

`mutationPlanId` uses
`particle-realms.m3b-recovery-mutation-plan-id@1` over, in order, the runtime-
binding pair, operation/kind/attempt, canonical request digest, joined-set
digest, complete rows, count, byte total, and disposition. `mutationPlanDigest`
uses `particle-realms.m3b-recovery-mutation-plan@1` over the first 14 fields in
displayed order, including the recomputed ID. The journal owner persists and
reads back the plan, mutation-dispatch phase evidence, and journal row before
the first target call. A no-mutation path creates no plan record and uses only
the exact empty-plan sentinel.

The separate service-internal
`RealmProjectionRecoveryAttemptRecordV1` has this exact closed 18-field
vocabulary:

```text
format
version
recoveryAttemptRecordId
realmId
runtimeBindingId
runtimeBindingDigest
extensionChildGeneration
recoveryOperationId
recoveryKind
recoveryAttempt
canonicalRequestDigest
phase
phaseEvidenceId
phaseEvidenceDigest
priorRecoveryJournalLinkDigest
terminalResult
reasonCode
recordDigest
```

`format` is exactly `particle-realms.m3b-recovery-attempt-record` and `version`
is one. `phase` is exactly `admitted`, `evidence-readback`,
`mutation-dispatched`, or `terminal-readback`. The first three variants have
exactly 16 own keys and forbid `terminalResult` and `reasonCode`. A terminal row
with `restored`, `replayed`, `resumed`, `committed`,
`proven-not-committed`, or `fallback` has 17 keys and forbids `reasonCode`. A
terminal row with `conflict`, `recovery-pending`, or `rejected` has all 18 keys
and requires one closed reason. Paths that perform no mutation skip
`mutation-dispatched`; phases otherwise never regress, duplicate, or skip a
required durable readback.

`canonicalRequestDigest` is byte-identical to the exact data-only commit
`recover` request digest. The phase-evidence pair names, respectively, the exact
recovery-phase-evidence `request-admission`, `joined-evidence-readback`, or
`mutation-dispatch` value, or the separate terminal selector/gate/fallback
readback evidence. The
journal owner first derives `bindingRecoveryTailDigest` as the latest
materialized recovery `recordDigest`, otherwise the current verified
`floorDigest`, otherwise
`H(particle-realms.m3b-recovery-journal-link-seed@1, runtimeBindingId,
runtimeBindingDigest)`. `recoveryOperationId` then uses
`particle-realms.m3b-recovery-operation-id@1` over, in order,
`runtimeBindingDigest`, `recoveryKind`, the first admitted canonical request
digest, and that tail digest. A binding has at most one unresolved recovery
operation. Its first row sets `priorRecoveryJournalLinkDigest` to the exact
derived tail; every later row names the immediately preceding `recordDigest`,
including across phases, attempts, and restart. For each 18-field attempt row,
form the exact 14-position `P(realmId..reasonCode)` and matching field rows.
`recoveryAttemptRecordId` uses
`particle-realms.m3b-recovery-attempt-record-id@1` over `version`, the vector,
and rows. `recordDigest` uses
`particle-realms.m3b-recovery-attempt-record@1` over `format`, `version`, the
recomputed ID, the same vector, and rows. A floor cannot substitute while a
newer materialized row exists, and no zero/empty/caller tail is accepted.

The stable trigger evidence is exact per kind: restore binds the current-root
pair, replay binds the prior-root pair, uncertain-commit reconciliation binds
the request's original trigger-application-receipt pair, device resume binds the device-
recovery-receipt pair, and static fallback binds the presentation-fence pair
plus the all-or-none prior-root/cursor pairs. Those fields cannot change within
one recovery operation. Head, floor, source, current-authority, due, current-
root/cursor, catch-up, and gate evidence may change across attempts only where
the corresponding request variant already declares them volatile.

For `terminal-readback`, the phase-evidence pair resolves to an exact 11-field
`RealmProjectionRecoveryTerminalEvidenceV1`: `format`, `version`,
`terminalEvidenceId`, the runtime-binding pair, `recoveryOperationId`,
`recoveryKind`, `recoveryAttempt`, `canonicalRequestDigest`, `evidenceRows`, and
`evidenceDigest`. `format` is
`particle-realms.m3b-recovery-terminal-evidence` and `version` is one. Each
`evidenceRows` member has exactly `fieldName`, `canonicalValueBytes`, and
`rowDigest`; rows follow the recovery-receipt top-level field order and contain
exactly every kind/variant-required conditional field plus `disposition` and
conditionally present `reasonCode`. They exclude the later recovery-receipt
identity/digest and recovery-attempt-record pair. Thus the terminal record
closes one exact future 37-field receipt payload; it cannot authorize a second
root, cursor, head, floor, application, fence, device, catch-up, gate, static-
fallback, disposition, or reason value.

Recovery evidence field names are unique and rows occur in the exact future-
receipt field order; there is no caller order. Each row digest uses
`particle-realms.m3b-recovery-terminal-evidence-row@1` over `fieldName` then
`canonicalValueBytes`. `terminalEvidenceId` uses
`particle-realms.m3b-recovery-terminal-evidence-id@1` over, in order, the
runtime-binding pair, `recoveryOperationId`, `recoveryKind`, `recoveryAttempt`,
`canonicalRequestDigest`, the complete ordered three-field evidence rows, and
their exact row count. `evidenceDigest` uses
`particle-realms.m3b-recovery-terminal-evidence@1` over the first ten fields in
listed order, including the recomputed ID and complete rows. A duplicate,
omitted, extra, reordered, or noncanonical field row rejects the terminal
evidence.

Every row in one attempt repeats the exact canonical request digest. Attempt one is
mandatory. Only a terminal `recovery-pending` row can admit the next attempt;
the counter increases by exactly one, never exceeds three, and a retry may
change only the recovery-kind-declared volatile evidence bytes. It cannot
change the operation, binding, kind, stable trigger evidence, or prior-record
chain. After attempt three remains pending, no fourth attempt is admitted: the
dynamic gate stays closed, that same unresolved operation remains the sole
journal-owned recovery operation, and its attempt-three pending receipt binds
the complete accepted M2 static-fallback receipt. It does not transfer ownership
before stop and does not admit a second `static-fallback` operation. Only the
ordinary stop/quarantine protocol can later adopt its exact tail through the
quarantine receipt's `recovery` operation row. An independent journaled
`static-fallback` recovery kind is legal only when no unresolved recovery
operation exists. Pre-admission `invalid` or `unavailable` creates no journal
row or recovery receipt.

Application and recovery journals reserve worst-case rows/evidence only inside
the 61-entry/15,728,640-byte ordinary budgets. Selector retirement converts the
already withheld three-entry/1,048,576-byte stop reserve; it does not compete
with or borrow from ordinary occupancy. A failed ordinary reservation appends no
row and cannot advance an attempt. Because capability registration proves the
selector chain maximum fits its reserve and ordinary admission never consumes
it, a valid exact-bound `beginStop()` always has capacity for teardown. Recovery
terminal readback is journaled before its recovery receipt is computed. The
receipt binds that terminal record, while the record does not bind the later
receipt, so there is no digest cycle.

Completed recovery history is bounded by an exact service-internal
`RealmProjectionRecoveryJournalFloorV1` with 14 fields:

```text
format
version
recoveryJournalFloorId
realmId
runtimeBindingId
runtimeBindingDigest
floorGeneration
priorFloorDigest
compactedRecordCount
compactedThroughRecordId
compactedThroughRecordDigest
compactedRecordAccumulator
retainedTailCount
floorDigest
```

`format` is `particle-realms.m3b-recovery-journal-floor`, `version` is one,
and `compactedRecordCount` is the cumulative positive safe-integer count. For
the first floor, `floorGeneration = 1`; `priorFloorDigest` is the domain-
separated digest under the code-shipped
`particle-realms.m3b-recovery-journal-floor-prior-seed-v1` tag of the exact
runtime-binding pair bytes, and the prior accumulator is the analogous digest
under the code-shipped
`particle-realms.m3b-recovery-journal-accumulator-seed-v1` tag. A successor has
generation exactly prior generation plus one, requires `priorFloorDigest` to
equal the current floor digest, and starts from that floor's
`compactedRecordAccumulator`. More exactly, the first floor uses
`H(particle-realms.m3b-recovery-journal-floor-prior-seed-v1,
runtimeBindingId, runtimeBindingDigest)` for `priorFloorDigest` and starts with
`A0 = H(particle-realms.m3b-recovery-journal-accumulator-seed-v1,
runtimeBindingId, runtimeBindingDigest)`. A successor uses the prior
`floorDigest` and prior accumulator as those two starting values. For every
newly compacted record in journal order,
`Ai = H(particle-realms.m3b-recovery-journal-accumulator-step@1, A(i-1),
recordDigest_i)`; the final `An` is `compactedRecordAccumulator`, and the
compacted-through pair is the nth record pair. The two existing `-v1` seed tags
are literals and cannot be renamed without a versioned migration.

Every floor uses an all-true ten-position `P(realmId..retainedTailCount)` and
matching field rows. `recoveryJournalFloorId` uses
`particle-realms.m3b-recovery-journal-floor-id@1` over `version`, that vector,
and rows; `floorDigest` uses
`particle-realms.m3b-recovery-journal-floor@1` over `format`, `version`, the
recomputed ID, the same vector, and rows. Every floor
creation compacts a nonempty eligible prefix; a successor's cumulative
`compactedRecordCount` must therefore be strictly greater than its predecessor's.
The compacted-through pair names the last record folded by that creation and
must resolve before the protected switch. No no-op floor or other genesis/
successor seed is valid. While a floor exists,
`retainedTailCount` is zero through 60 and names the
still-materialized recovery suffix after compaction. The current floor counts as
one entry and all of its bytes count against the same 64-entry/16,777,216-byte
aggregate journal pool. Before stop, floor admission additionally requires
`1 + retainedTailCount + materializedApplicationRecordCount + outstandingOrdinaryReservationEntries <= 61`; the equivalent canonical-byte
sum, including the floor, must fit 15,728,640 bytes. `beginStop()` forbids new
floor creation; the already charged ordinary state may then add at most the
three reserved selector-retirement records, with total live validation still
capped at 64 entries and 16,777,216 bytes. No per-family range can admit an
aggregate plus-one state or borrow the stop reserve.

Compaction may consume only a complete terminal recovery-operation prefix for
which no root, recovery receipt, terminal evidence, presentation fence,
quarantine record, or other protected consumer still requires individual row
bytes. It never consumes an unresolved operation or splits an attempt. The first
surviving row may resolve its prior link through the floor's compacted-through
pair; when no suffix survives, the next operation links to `floorDigest`.
Creating the successor floor, verifying its accumulator/readback, switching the
floor generation, and releasing eligible old rows is one protected transaction.
The successor floor binds the prior floor but no earlier floor binds it, so
compaction creates no digest cycle and changes no existing receipt.

Before admitting a recovery operation, the owner compacts every eligible prefix
and reserves that operation's worst-case rows. If the floor, retained referenced
suffix, unresolved work, and reservation still cannot fit the ordinary budgets,
`recover()` returns
pre-admission `unavailable` with no new row. Thus long-lived bindings can fold
released history without erasing protected evidence, while genuinely retained
evidence causes an explicit bounded block rather than unbounded growth.

## `RealmProjectionRecoveryReceiptV1`

The recovery receipt has a closed 37-field top-level vocabulary:

```text
format
version
recoveryReceiptId
realmId
runtimeBindingId
runtimeBindingDigest
recoveryKind
recoveryAttemptRecordId
recoveryAttemptRecordDigest
priorProjectionRootId
priorProjectionRootDigest
currentProjectionRootId
currentProjectionRootDigest
priorAppliedCursorId
priorAppliedCursorDigest
currentAppliedCursorId
currentAppliedCursorDigest
retainedM3ALedgerHeadBinding
retainedM3ALedgerHeadDigest
retainedM3AFloorVector
retainedM3AFloorDigest
reconciledApplicationReceiptId
reconciledApplicationReceiptDigest
presentationFenceId
presentationFenceDigest
deviceRecoveryReceiptId
deviceRecoveryReceiptDigest
catchUpReceiptId
catchUpReceiptDigest
presentationGateTransitionReceiptId
presentationGateTransitionReceiptDigest
recoveryAttempt
disposition
reasonCode
staticFallbackReceiptId
staticFallbackReceiptDigest
receiptDigest
```

Recovery kinds are:

```text
same-binding-restore
same-binding-replay
uncertain-commit-reconciliation
device-resume
static-fallback
```

Dispositions are:

```text
restored
replayed
resumed
committed
proven-not-committed
conflict
fallback
recovery-pending
rejected
```

Every variant shares exactly 12 keys: `format`, `version`,
`recoveryReceiptId`, `realmId`, the runtime-binding pair, `recoveryKind`,
the terminal recovery-attempt-record pair, `recoveryAttempt`, `disposition`, and
`receiptDigest`. The terminal record must have the same binding, kind, attempt,
and terminal result as the receipt, and its terminal-evidence rows must match
every conditionally present receipt field byte-for-byte. The own-key matrix is
exact; “available” or “applicable” evidence is never a schema rule:

| Variant | Own keys | Required conditional fields |
| --- | ---: | --- |
| `same-binding-restore/restored` | 20 | current root/cursor and retained M3A head/floor |
| `same-binding-replay/replayed` | 24 | prior/current root/cursor and retained M3A head/floor |
| `uncertain-commit-reconciliation/committed` | 18 | reconciled committed application receipt and current root/cursor |
| `uncertain-commit-reconciliation/proven-not-committed` | 14 | reconciled proven-noncommit application receipt |
| `uncertain-commit-reconciliation/conflict` | 19 | reconciled conflict application receipt, verified current competing root/cursor, and one closed reason byte-identical across its terminal record/evidence/receipt |
| `device-resume/resumed` | 32 | prior/current root/cursor, retained M3A head/floor, recovering-to-ready presentation fence, device-recovery, catch-up, and gate-transition pairs |
| `static-fallback/fallback` with empty head | 14 | static-fallback pair only |
| `static-fallback/fallback` from verified root | 18 | prior root/cursor plus static-fallback pair |
| attempt-one-or-two `same-binding-restore/recovery-pending` | 21 | current root/cursor, retained M3A head/floor, and reason |
| attempt-one-or-two `same-binding-replay/recovery-pending` | 25 | prior/current root/cursor, retained M3A head/floor, and reason |
| attempt-one-or-two `uncertain-commit-reconciliation/recovery-pending` | 15 | reconciled pending application pair and reason |
| attempt-one-or-two `device-resume/recovery-pending` with reason `catch-up-pending` | 29 | prior/current root/cursor, retained M3A head/floor, recovering fence, device-recovery pair, and the fixed reason |
| attempt-one-or-two `device-resume/recovery-pending` with reason `gate-transition-pending` | 31 | the catch-up-pending fields plus catch-up pair and the fixed reason; gate-transition pair remains forbidden |
| attempt-three `same-binding-restore/recovery-pending` | 23 | its ordinary pending fields plus static-fallback pair; reason exactly `attempt-limit-static-fallback` |
| attempt-three `same-binding-replay/recovery-pending` | 27 | its ordinary pending fields plus static-fallback pair; reason exactly `attempt-limit-static-fallback` |
| attempt-three `uncertain-commit-reconciliation/recovery-pending` | 17 | its ordinary pending fields plus static-fallback pair; reason exactly `attempt-limit-static-fallback` |
| attempt-three `device-resume/recovery-pending`, catch-up incomplete | 31 | catch-up-pending field shape plus static-fallback pair; reason exactly `attempt-limit-static-fallback` |
| attempt-three `device-resume/recovery-pending`, gate transition incomplete | 33 | gate-transition-pending field shape plus static-fallback pair; reason exactly `attempt-limit-static-fallback` |
| any kind / `rejected` | 13 | reason only; every root/cursor/head/floor/application/presentation/device/catch-up/gate/static field is forbidden |

`static-fallback/recovery-pending` is forbidden; an uncertain selector operation
uses `uncertain-commit-reconciliation` instead. Every field not required by a
row is forbidden. One member of a pair without the other, a wrong reason, or a
missing required field is invalid. Recovery receipts contain no live object,
token, authority, or renderer state.

Recovery receipt identity uses the same closed omission construction but never
shares a domain with application receipts. Its hash-only `presenceVector` is a
canonical JSON array of exactly 33 Booleans, one for each displayed field from
`realmId` through `staticFallbackReceiptDigest` in exact order. Its
`presentFieldRows` therefore includes both fallback fields whenever their
closed variant requires them and contains
one exact `[fieldName, canonicalValue]` array per present field in that same
order. `recoveryReceiptId` uses
`particle-realms.m3b-projection-recovery-receipt-id@1` over, in order,
`version`, `presenceVector`, and the complete `presentFieldRows`.
`receiptDigest` uses `particle-realms.m3b-projection-recovery-receipt@1` over,
in order, `format`, `version`, the recomputed `recoveryReceiptId`,
`presenceVector`, and those complete rows. The vector and rows are hash-only
derivations, not schema keys. Wrong length, name, order, count,
null-for-omission, or own-key shape fails before hashing. Recovery terminal
evidence recomputes this exact pair from its closed canonical receipt bytes.

An attempt-three pending receipt is not a terminal ownership transfer and does
not convert its immutable `recoveryKind` to `static-fallback`; the added pair
proves presentation of the complete M2 fallback while the original operation
remains unresolved. Repeating `recover()` for that operation returns the same
attempt-three record/receipt evidence and admits neither attempt four nor a new
operation.

For `uncertain-commit-reconciliation`, the request's immutable
`triggerApplicationReceiptId`/`triggerApplicationReceiptDigest` pair and the
recovery receipt's conditional `reconciledApplicationReceiptId`/
`reconciledApplicationReceiptDigest` pair are different ABI roles. The trigger
must resolve to the original `recovery-pending` application receipt. The
reconciled pair resolves to the latest pending or terminal descendant reached by
the same application operation-journal chain. Every intervening record preserves
the trigger's binding, intent, idempotency key, candidate, and CAS-attempt rules;
the descendant receipt's operation-journal pair must extend the trigger
receipt's pair without branch, rewrite, or cross-operation substitution. A
terminal recovery outcome requires a terminal descendant; a recovery-pending
outcome may bind the trigger itself or a later pending descendant. The canonical
request digest never changes to the output pair.

The service-internal `RealmProjectionSelectorReadReceiptV1` has exactly 13
fields:

```text
format
version
selectorReadReceiptId
runtimeBindingId
runtimeBindingDigest
selectorGeneration
selectedBundleId
selectedBundleDigest
selectedBundleGeneration
selectedProjectionRootId
selectedProjectionRootDigest
disposition
receiptDigest
```

`disposition` is only `selected`. The receipt is issued from durable selector/
root/bundle readback and never from an in-memory mirror.

Selector retirement uses a separate absence-capable
`RealmProjectionSelectorRetirementReadbackReceiptV1` with this exact closed
21-field vocabulary:

```text
format
version
selectorRetirementReadbackReceiptId
realmId
runtimeBindingId
runtimeBindingDigest
extensionChildGeneration
selectorRetirementOperationId
stopReceiptId
stopReceiptDigest
canonicalRequestDigest
observedHeadState
observedSelectorGeneration
observedProjectionBundleId
observedProjectionBundleDigest
observedProjectionBundleGeneration
observedProjectionRootId
observedProjectionRootDigest
disposition
reasonCode
receiptDigest
```

`format` is exactly
`particle-realms.m3b-selector-retirement-readback-receipt`, `version` is one,
and `observedHeadState` is `empty` or `present`. The two absence variants have
exactly 15 own keys: `retired/empty` proves that this operation's protected CAS
matched the canonical request and durable post-CAS readback observed service-
owned absence; `already-retired/empty` proves that durable pre-dispatch or
restart readback observed the same binding already absent with no different
retirement owner. Both require `observedSelectorGeneration = 0` and forbid the
observed bundle/root pairs, bundle generation, and reason. `conflict/present`
has all 21 keys, requires positive observed selector/bundle generations, exact
observed bundle/root pairs, and one closed reason proving why those durable
bytes do not match the request. Every other state/disposition/presence
combination is invalid. This receipt is issued only from the selector store's
protected durable readback; it is never synthesized from an in-memory mirror,
the detach request, or the ordinary selected-selector read receipt.

The service-internal `RealmProjectionCatchUpReceiptV1` has exactly 22 fields:

```text
format
version
catchUpReceiptId
runtimeBindingId
runtimeBindingDigest
priorAppliedCursorId
priorAppliedCursorDigest
currentAppliedCursorId
currentAppliedCursorDigest
retainedM3ALedgerHeadBinding
retainedM3ALedgerHeadDigest
retainedM3AFloorVector
retainedM3AFloorDigest
nextExpectedM3ABatchSequence
sourceStateSlotsDigest
currentAuthorityStateSnapshotId
currentAuthorityStateSnapshotDigest
effectiveLogicalTick
selectorReadReceiptId
selectorReadReceiptDigest
disposition
receiptDigest
```

`disposition` is only `caught-up`. The receipt proves that the retained floor
permits the complete replay, the current cursor is the deterministic result of
the contiguous tail, `nextExpectedM3ABatchSequence` is exactly retained head
plus one, every source slot is current or fail-closed, every finite expiry at or
below the effective tick is masked, and current-only authority resolution covers
every authority dependency of the root/bundle/generations bound by the selector-
read receipt. The current pair may equal the
prior pair only when the verified tail is empty and all other meets are already
current.

The service-internal `RealmProjectionPresentationGateTransitionReceiptV1` has
exactly 15 fields:

```text
format
version
transitionReceiptId
runtimeBindingId
runtimeBindingDigest
priorPresentationFenceId
priorPresentationFenceDigest
targetPresentationFenceId
targetPresentationFenceDigest
deviceRecoveryReceiptId
deviceRecoveryReceiptDigest
catchUpReceiptId
catchUpReceiptDigest
disposition
receiptDigest
```

`disposition` is only
`closed-to-ready`. The target fence must bind the same current-authority snapshot
as the catch-up receipt. A transition is rejected if any head, floor, cursor,
source, authority, expiry, device, binding, or generation value changed between
catch-up readback and its one protected presentation-gate CAS.

## Service-internal selector-retirement journal

`detachSources()` never fabricates application or recovery fields around its
own selector-retirement CAS. The selector-retirement journal owner issues and
reads back one exact `RealmProjectionSelectorRetirementPhaseEvidenceV1` for
each nonterminal phase. It has this closed 14-field vocabulary:

```text
format
version
phaseEvidenceId
realmId
runtimeBindingId
runtimeBindingDigest
extensionChildGeneration
selectorRetirementOperationId
stopReceiptId
stopReceiptDigest
canonicalRequestDigest
phaseKind
disposition
evidenceDigest
```

Its format is `particle-realms.m3b-selector-retirement-phase-evidence` and
version is `1`. `request-admission/admitted` and `selector-cas-dispatch/
dispatch-recorded` both have all 14 keys. The latter evidence and its
`dispatch-started` journal row are atomically persisted and read back before the
selector CAS is invoked. Both bind the exact stop receipt and immutable data-
only detach request digest. They cannot substitute for selected-selector
readback, terminal retirement readback, application evidence, or recovery
evidence. `phaseEvidenceId` uses
`particle-realms.m3b-selector-retirement-phase-evidence-id@1` over, in order,
the Realm, runtime-binding pair, child generation, retirement operation, stop-
receipt pair, canonical request digest, phase kind, and disposition; it excludes
`format`, `version`, itself, and `evidenceDigest`. `evidenceDigest` uses
`particle-realms.m3b-selector-retirement-phase-evidence@1` over every present
preceding field in listed order, including
`phaseEvidenceId`.

The service-internal
`RealmProjectionSelectorRetirementAttemptRecordV1` has this exact closed
18-field vocabulary:

```text
format
version
selectorRetirementAttemptRecordId
realmId
runtimeBindingId
runtimeBindingDigest
extensionChildGeneration
selectorRetirementOperationId
stopReceiptId
stopReceiptDigest
canonicalRequestDigest
phase
phaseEvidenceId
phaseEvidenceDigest
priorSelectorRetirementAttemptRecordDigest
terminalResult
reasonCode
recordDigest
```

`format` is exactly
`particle-realms.m3b-selector-retirement-attempt-record`, `version` is one, and
`phase` is exactly `admitted`, `dispatch-started`, or `terminal-readback`.
`admitted` and `dispatch-started` rows have exactly 16 own keys and forbid
`terminalResult`/`reasonCode`. A terminal `retired` or `already-retired` row has
17 keys and forbids `reasonCode`. A terminal `conflict` row has all 18 keys and
requires one closed reason. Every other field, phase, result, or presence
combination is invalid.

`canonicalRequestDigest` is the exact data-only `detachSources` request digest,
so its expected head, selector generation, conditional root/bundle pairs,
bundle generation, transition bytes, and fence cannot change. The phase-
evidence pair names the exact selector-retirement phase-evidence `request-
admission` or `selector-cas-dispatch` value, or durable selector readback. A
`terminal-readback` pair resolves only to the exact
21-field retirement-readback receipt above; its Realm, binding, child generation,
operation, stop receipt, canonical request, and disposition must byte-match the
attempt row, and a conflict reason must byte-match as well. A terminal absence
therefore has positive durable evidence without fabricating a selected bundle
or root. The readback receipt does not bind the later attempt record, preserving
an acyclic digest graph. `selectorRetirementOperationId` uses
`particle-realms.m3b-selector-retirement-operation-id@1` over, in exact order,
`runtimeBindingDigest`, `extensionChildGeneration`, `stopReceiptId`, and
`stopReceiptDigest`. One stop receipt names one operation forever. The first
row's `priorSelectorRetirementAttemptRecordDigest` uses
`particle-realms.m3b-selector-retirement-journal-seed@1` over, in order,
`realmId`, the runtime-binding pair, `extensionChildGeneration`, the retirement
operation ID, the stop-receipt pair, and `canonicalRequestDigest`; every later
row uses the immediately preceding `recordDigest`. Each 18-field attempt row
uses the exact 14-position `P(realmId..reasonCode)` and matching field rows.
`selectorRetirementAttemptRecordId` uses
`particle-realms.m3b-selector-retirement-attempt-record-id@1` over `version`,
the vector, and rows. `recordDigest` uses
`particle-realms.m3b-selector-retirement-attempt-record@1` over `format`,
`version`, the recomputed ID, the same vector, and rows. A zero seed, phase
reset, or predecessor from another stop/binding is invalid.

Before admission the caller may choose either fence variant allowed by the
request matrix; once `admitted` is appended, the canonical request digest is
immutable and restart may safely resume the same expected-generation CAS.
Pre-admission `stale`,
`unavailable`, `invalid`, or facet-level `closed` creates no row. Uncertainty
after dispatch is not rewritten as a false terminal row: `recovery-pending`
returns the latest `dispatch-started` row plus quarantine evidence, and the
quarantine owner adopts that row and every still-hidden cleanup obligation.
Later kernel readback may append terminal evidence but never rewrites the
already issued disposal receipt. A terminal `conflict` also maps only to the
method result `recovery-pending`, returns the conflict row with quarantine
evidence, and never invents a public detach conflict status.

Every record points only backward. Phase evidence does not bind the record. For
a healthy terminal path, the detach receipt is the sole ownership-settlement
edge that consumes the terminal attempt record; a binding-transition receipt
binds that detach receipt only as derivative evidence. For an unresolved path,
the quarantine receipt's operation row is the sole consuming edge for the
nonterminal or conflict tail; the quarantine detach receipt binds that
quarantine receipt only as derivative evidence. Resource-specific detach and
disposal receipts may reference those settled receipts but never re-adopt a
journal tail. No earlier record binds a later receipt, so there is no digest
cycle or double ownership.

Quarantine teardown is all-or-nothing for the stopped dynamic session. If an
application or recovery tail already requires stop quarantine, `detachSources()`
routes selector retirement, requested root state, the ECS overlay, and the
State-First source through that same quarantine receipt even when selector
readback is terminal. The selector operation row, rather than a healthy detach
receipt, then consumes that terminal selector tail. A quarantine receipt never
coexists with a healthy retained-root transfer or binding-transition receipt in
the same disposal. This prevents split ownership between one quarantined
operation and a supposedly healthy dynamic bundle.

The service-internal `RealmProjectionDetachReceiptV1` has a closed 24-field
vocabulary: `format`, `version`, `detachReceiptId`, `realmId`, the runtime-
binding pair, `extensionChildGeneration`, the stop-receipt pair, the
conditionally present selector-retirement-attempt-record pair, the static-
fallback pair, the ECS-detach pair, the State-First-detach pair,
`retainedRootState`, the conditionally present retained-root-transfer pair, the
conditionally present quarantine-transfer pair, `disposition`, and
`receiptDigest`. `format` is
`particle-realms.m3b-projection-detach-receipt` and `version` is one.

The exact variants are: `none/detached` has 20 keys, requires the retirement-
record pair, and forbids both transfer pairs; `retained-owner/detached` has 22,
requires the retirement-record and retained-root pairs, and forbids quarantine;
`quarantine-no-root/quarantine-transferred` and
`quarantine-owned/quarantine-transferred` each have 20, require only the
quarantine-transfer pair, and forbid the retirement-record and retained-root
pairs. A detached variant requires a terminal selector-retirement record whose
result is `retired` or `already-retired` and detached ECS/State-First receipts. Either quarantine variant
requires its quarantine receipt's selector-retirement operation row to bind the
exact latest record and requires quarantine-transferred ECS/State-First
receipts. That record is nonterminal/conflict when selector retirement itself
forced quarantine; it may be terminal `retired` or `already-retired` whenever
any other frozen journal tail, candidate/lease/escrow, callback, in-flight call,
or resource cleanup obligation forced the all-or-nothing route.
All variants require complete static-fallback evidence. A later
`already-detached` method result returns the byte-identical original detached
receipt rather than minting a second disposition.

Detach receipt identity is omission-safe. Its hash-only `presenceVector` is a
canonical JSON array of exactly 20 Booleans, one for each displayed field from
`realmId` through `disposition` in exact order. Its `presentFieldRows` contains
one exact `[fieldName, canonicalValue]` array per present field in that same
order. `detachReceiptId` uses
`particle-realms.m3b-projection-detach-receipt-id@1` over, in order, `version`,
`presenceVector`, and the complete `presentFieldRows`. `receiptDigest` uses
`particle-realms.m3b-projection-detach-receipt@1` over, in order, `format`,
`version`, the recomputed `detachReceiptId`, `presenceVector`, and those rows.
The vector and rows are hash-only derivations, not schema keys. Their shape must
agree exactly with the four closed variants; a wrong length, pair split,
unexpected row, order change, or null-for-omission substitution fails before
hashing.

The retirement attempt's `canonicalRequestDigest` closes the root-state matrix.
Admission first proves `expectedHeadState` and every conditional expected root,
bundle, bundle generation, and selector generation against protected durable
readback. An admitted `empty` request can produce only `none/detached` or
`quarantine-no-root/quarantine-transferred`; both forbid a trusted final-root
pair, root transfer, and requested-root inventory, and disposal uses a no-root
variant. An admitted `present` request can produce only `retained-owner/detached`
or `quarantine-owned/quarantine-transferred`; the healthy transfer or canonical
quarantine inventory must contain the exact requested root, bundle, and covering
lease, and disposal uses the matching with-root variant and exact root pair. A
post-admission competing selector is retained only as hostile quarantine
evidence and never promoted into the trusted final-root field. No receipt may
change empty/present class after admission.

The service-internal `RealmProjectionQuarantineTransferReceiptV1` has exactly
21 fields: `format`, `version`, `quarantineTransferReceiptId`, `realmId`, the
runtime-binding pair, `extensionChildGeneration`, the stop-receipt pair,
`operationEvidenceRows`, the static-fallback pair, the ECS-detach pair, the
State-First-detach pair, `adoptedResourceInventoryDigest`,
`adoptedResourceCount`, `disposition`, `reasonCode`, and `receiptDigest`.
`format` is `particle-realms.m3b-projection-quarantine-transfer-receipt`,
`version` is one, and `disposition` is `quarantine-transferred`.
`adoptedResourceCount` is positive and bounded by the frozen before-stop
inventory plus the one declared stop-derived selector-retirement operation.

`operationEvidenceRows` contains one to three exact four-field rows:
`operationKind`, `recordId`, `recordDigest`, and `rowDigest`. Kind is
`application`, `recovery`, or `selector-retirement`; rows use that fixed order,
never duplicate a kind, and resolve to the latest adopted 24-, 18-, or 18-field
journal record. The selector-retirement row is always present; application and
recovery rows are present exactly when their unresolved work or journal cleanup
obligation transfers. A pre-journal candidate/lease/escrow or other frozen
resource failure has no fabricated operation row and is closed only by the
canonical adopted-resource inventory. Each operation row's `rowDigest` uses
`particle-realms.m3b-quarantine-operation-evidence-row@1` over, in order,
`operationKind`, `recordId`, and `recordDigest`. The record pair must recompute
under the schema selected by the kind; same-shaped or cross-kind substitution
fails.

The canonical adopted-resource inventory is an external immutable row array
persisted by the quarantine owner under `adoptedResourceInventoryDigest`; its
bytes are not an omitted receipt field. Each row has exactly ten fields:
`resourceOrder`, `resourceKind`, `resourceId`, `resourceDigest`,
`resourceGeneration`, `originKind`, `originSnapshotOrder`, `priorOwnerId`,
`adoptionReasonCode`, and `rowDigest`. `resourceKind` is exactly one of, in this
fixed order, `application-operation`, `recovery-operation`,
`selector-retirement-operation`, `candidate`, `prepared-candidate`,
`reader-escrow`, `recorded-authority-escrow`, `candidate-artifact-lease`,
`session-candidate-root`, `ecs-overlay`, `state-first-source`, `callback`,
`in-flight-call`, `hostile-selector-evidence`, or `hostile-root-evidence`.
`originKind` is `before-stop` or `stop-derived`. A before-stop row has the exact
dense zero-based `originSnapshotOrder` from the protected resource-ledger
inventory bound by the stop receipt; a stop-derived row uses JSON `null` and is
legal only for the one deterministic selector-retirement operation or hostile
evidence actually observed during its readback. Generation is a nonnegative
safe integer and every ID, digest, and prior-owner value is a nonempty canonical
string. `adoptionReasonCode` byte-equals the enclosing receipt `reasonCode`.
The row digest uses `particle-realms.m3b-quarantine-resource-inventory-row@1`
over its first nine fields.

Projection from the frozen source inventory is exact rather than merely
same-shaped. For every transferred source row `s` there is exactly one adopted
row `a` such that
`a.originSnapshotOrder = s.resourceOrder`,
`a.resourceKind = s.resourceKind`, `a.resourceId = s.resourceId`,
`a.resourceDigest = s.resourceDigest`,
`a.resourceGeneration = s.resourceGeneration`, and
`a.priorOwnerId = s.currentOwnerId`. The source-map resolver above must still
accept `s` at transfer time. No field may be rewritten while changing owner,
and no second adopted row may cite the same source order.

The three stop-derived mappings are also closed:

| Stop-derived kind | Exact identity and generation | Exact prior owner / resolver | Admission predicate |
| --- | --- | --- | --- |
| `selector-retirement-operation` | `selectorRetirementOperationId` / exact latest durable `RealmProjectionSelectorRetirementAttemptRecordV1.recordDigest`; generation equals the stop receipt's `extensionChildGeneration` | `m3b-selector-retirement-journal-owner@1` / `m3b-selector-retirement-journal-resolver@1` | the one operation derived from this stop receipt remains unresolved or its terminal bytes still require transfer |
| `hostile-selector-evidence` | `RealmProjectionSelectorRetirementReadbackReceiptV1.selectorRetirementReadbackReceiptId` / `receiptDigest`; generation equals its positive `observedSelectorGeneration` | `m3b-selector-root-store@1` / `m3b-selector-root-store-verifier@1` | exact durable `conflict/present` readback names a selector different from the admitted expected head |
| `hostile-root-evidence` | the conflicting readback's `observedProjectionRootId` / `observedProjectionRootDigest`; generation equals the independently resolved `RealmProjectionStateRootV1.rootGeneration` | `m3b-selector-root-store@1` / `m3b-projection-root-verifier@1` | the root pair resolves byte-for-byte, is named by that same conflict readback, and is not promoted to the admitted/final root |

A conflicting readback always creates the hostile-selector row. It also creates
exactly one hostile-root row when and only when the observed root pair resolves;
an unresolvable hostile pair is retained only inside the readback receipt and is
never fabricated as root evidence. These stop-derived rows use no source
snapshot order, no resource-ledger allocation generation, and no unlisted pair,
owner, resolver, or lifecycle state.

Inventory rows are sorted by the fixed `resourceKind` order, then code-point
`resourceId`, then numeric `resourceGeneration`; `resourceOrder` is dense and
zero-based. Duplicate `(resourceKind, resourceId, resourceGeneration)` tuples
fail. Every `operationEvidenceRows` pair projects to exactly one same-kind
operation inventory row, and every remaining transferred member of the frozen
before-stop or permitted stop-derived inventory appears exactly once. No
session-owned or already settled resource appears. `adoptedResourceCount`
equals the exact inventory-array length and is positive.
`adoptedResourceInventoryDigest` uses
`particle-realms.m3b-quarantine-resource-inventory@1` over the complete ordered
canonical inventory rows followed by `adoptedResourceCount`; the domain over an
empty array and zero is defined for independent rejection tests but is illegal
in this receipt. `operationEvidenceRows` contains every journal tail whose
unresolved work or all-or-nothing cleanup obligation transfers and no tail that
remains session-owned. The inventory digest closes the corresponding operation
resource and every other adopted callback, in-flight call, candidate root/lease,
escrow, ECS overlay, State-First source, and selector-retirement obligation
exactly once. Both detach receipts must have disposition
`quarantine-transferred`, and the static-fallback receipt must prove the dynamic
gate closed before transfer. Candidate settlement may later bind this receipt;
the quarantine receipt never binds that later settlement or disposal evidence.
The canonical inventory bytes persist under
`adoptedResourceInventoryDigest`. `quarantine-no-root` forbids the admitted
request's root/bundle/lease entries; `quarantine-owned` requires their exact
presence. An unexpected competing selector/root may be retained only in a
distinct hostile-evidence row and never changes that admitted-head matrix.

All 21 quarantine-transfer receipt fields are mandatory. Its hash-only
`presenceVector` is therefore a canonical JSON array of exactly 17 `true`
Booleans, one for each displayed field from `realmId` through `reasonCode`; its
`presentFieldRows` is the corresponding complete ordered array of exact
`[fieldName, canonicalValue]` rows. `quarantineTransferReceiptId` uses
`particle-realms.m3b-projection-quarantine-transfer-receipt-id@1` over, in
order, `version`, `presenceVector`, and `presentFieldRows`. `receiptDigest` uses
`particle-realms.m3b-projection-quarantine-transfer-receipt@1` over, in order,
`format`, `version`, the recomputed ID, the same vector, and the same rows. These
are hash-only derivations. An omission, extra key, false presence bit, reordered
row, count/digest mismatch, or noncanonical nested row fails before transfer.

### Same-binding restart

The root store verifies the newest self-contained root, closure manifest,
lineage accumulator/floor, artifact lease, and complete projection bundle. It
restores that bundle through the separate M3 projection-transaction capability,
checks the actual M3A checkpoint edge if one exists, then requests only the
contiguous M3A tail after the applied cursor. Replaying the same batch is
idempotent. A sequence gap enters M3A recovery and keeps the dynamic source
hidden while the complete M2 static city remains visible; it never guesses.

### Missing or corrupt state

A missing root, corrupt closure, invalid lineage accumulator/floor, missing,
released, invalid, or noncovering M2 artifact lease, mismatched binding,
unavailable required content, or
failed projection-bundle restore leaves the accepted M2 static city active.
M3B emits `static-fallback` evidence and starts no partial dynamic state.

### New binding or pseudonym epoch

Operator switch, M2 replacement, M3A replacement, normalization-policy change,
pseudonym-key rotation, or binding retirement never reactivates an old root and
never appears as an M3B input-cut variant. The context/commit lifecycle produces
one trusted binding-transition receipt, moves the prior binding
`active -> stale -> draining -> retired`, selects the complete M2 static city,
and detaches the old dynamic bundle. Only then may the successor session accept
its first observation-batch cut and commit a separate partial-labelled dynamic
genesis. Identities and entries from two bindings never coexist in one bundle.

### Bake or layout divergence

An active bake, layout, static-store, or projection-binding-index change stops
incremental M3B application. M3B retains the old complete root, emits only
powerless structural transition evidence, and hands control to M3C full
reprojection. It never attempts to patch coordinates between bakes.

### Device loss

Device loss closes the ephemeral M3B presentation fence without changing the
logical 53-field binding or committed CPU bundle. M3A may continue bounded CPU
admission. After accepted M2 device recovery creates a `recovering` fence, M3B
may commit the bounded contiguous CPU tail through the same application-journal/selector
transaction while reader, bundle, and retention ceilings hold; every such
selector remains hidden and cannot publish a presentation-facing successor.
The dynamic source remains hidden and the complete M2 static city remains
visible through recovery, catch-up, and reconciliation. The reader supplies the
exact retained M3A head/floor value and evidence escrow. The recovery coordinator
replays the complete contiguous tail, applies every due source/expiry meet,
resolves current authority for every selected-root dependency, and calls commit-
port `recover(device-resume)` only after durable selector readback. That method
persists and reads back the selector-read/catch-up receipts and performs the one
protected presentation-gate CAS that can issue a post-loss `ready` fence
containing the current `RealmDeviceRecoveryReceiptV1` and catch-up pairs. Any
M3A/authority/fence/selector change
during that transition leaves the gate closed and repeats bounded
reconciliation. Device recovery is presentation evidence, not logical binding
identity.

Every recovery attempt and its one-to-three counter is stored in the separate
18-field recovery-attempt journal. Application reconciliation remains in its
24-field intent/candidate operation journal. Both journals share one aggregate
binding-scoped entry/byte allowance, and restart cannot reset the counter, skip
an unresolved attempt, fabricate application fields, or turn missing evidence
into a successful recovery receipt.

## Root and entry lifecycle

The entry lifecycle is:

```text
new
  -> validating
  -> claiming
  -> recovering | initializing
  -> ready
  -> stopping
  -> closed
```

Any start fault enters `failed -> stopping -> closed`. An extension-child
generation is positive, monotonically increasing, and never reused.

The projection-bundle root lifecycle is:

```text
candidate -> prepared | abandoned
prepared -> current | quarantine-owned | abandoned
current -> lineage-retained | retained-owner | quarantine-owned
lineage-retained -> retained-owner | floor-compacted | released | quarantine-owned
retained-owner -> floor-compacted | released | quarantine-owned
floor-compacted -> released
quarantine-owned -> retained-owner | floor-compacted | released
```

Exactly one complete bundle root is current per runtime binding. Every retained
root is self-contained; predecessor pairs are commit-time transition evidence,
not an unbounded availability dependency. Before an older root is released, its
ordered transition is folded into the current root's lineage accumulator and
the verified floor anchor advances. The four-root count and retained aggregate-
byte ceilings charge every `candidate`, `prepared`, `current`, `lineage-retained`,
`retained-owner`, `floor-compacted`, and `quarantine-owned` root/evidence set
until it reaches `abandoned` or `released`. Quarantine also obeys its separate
one-entry/byte ceilings. Uncertain candidates count against every applicable
limit and cannot be evicted. Exceeding a limit blocks new cuts and enters
recovery; it does not discard evidence.

The healthy `RealmProjectionRetainedRootTransferReceiptV1` has exactly 17
fields:

```text
format
version
transferReceiptId
realmId
runtimeBindingId
runtimeBindingDigest
transferKind
projectionRootId
projectionRootDigest
projectionBundleId
projectionBundleDigest
staticArtifactLeaseReceiptId
staticArtifactLeaseReceiptDigest
optionalM3AEdgeInventoryDigest
rootStoreGeneration
disposition
receiptDigest
```

`transferKind` is `root-store-current-to-retained-owner`,
`root-store-lineage-to-retained-owner`, or `quarantine-to-retained-owner`, and
`disposition` is `accepted`. Either root-store kind can be returned to the
stopping app session and must match the root's exact current versus lineage-
retained source state. The quarantine kind can be issued only by later kernel-
owned recovery and never rewrites the original disposal receipt. The selector
CAS/readback already made the durable root store owner
of the complete self-contained root, bundle, escrow, nonexpiring M2 lease, floor
anchor, and any optional M3A-edge inventory. A root-store receipt performs only
the internal transition from current-selection or lineage ownership to the
durable retained-root owner when the selector/session detaches. The quarantine
kind performs the analogous transition only after kernel recovery proves the
root healthy. The app never owns any of those states, no app-to-root-store
transfer occurs, and no receipt transfers an unresolved operation.

The trusted `RealmProjectionBindingTransitionReceiptV1` has a closed 25-field
vocabulary:

```text
format
version
transitionReceiptId
realmId
priorRuntimeBindingId
priorRuntimeBindingDigest
successorRuntimeBindingId
successorRuntimeBindingDigest
transitionReason
priorHeadState
priorProjectionRootId
priorProjectionRootDigest
priorProjectionBundleId
priorProjectionBundleDigest
detachReceiptId
detachReceiptDigest
staticFallbackReceiptId
staticFallbackReceiptDigest
ecsDetachReceiptId
ecsDetachReceiptDigest
stateFirstDetachReceiptId
stateFirstDetachReceiptDigest
priorBindingDisposition
successorEligibility
receiptDigest
```

It is issued only after the exact successful 24-field detach receipt, complete
M2 static fallback, and both resource-specific detach receipts are read back.
`priorBindingDisposition` is `retired`;
`successorEligibility` is `separate-genesis-required`. `priorHeadState = empty`
has 21 own keys, omits both prior root/bundle pairs, and requires the selector-
retirement evidence consumed by the detach receipt to prove durable absence;
the transition receipt binds only that detach receipt as derivative evidence.
`present` has all 25 keys and requires both prior pairs to match the transition
descriptor. A missing successor,
mixed prior/successor field, one-sided pair, or transition receipt produced
before detach is invalid.

The dynamic-entry lifecycle is:

```text
absent -> active
active -> updated | stale | deactivated | absent
stale -> updated | deactivated | absent
deactivated -> active | absent
```

Only a new exact source observation may upgrade stale/deactivated state. A
source-state or expiry cut may only move downward.

Candidate release uses three exact service-local receipts rather than an
unnamed success pair. `RealmProjectionCandidateRootReleaseReceiptV1` has these
11 fields: `format`, `version`, `rootReleaseReceiptId`, the runtime-binding pair,
the candidate-projection-root pair, `releaseReason`, `disposition`,
`rootStoreGeneration`, and `receiptDigest`. Its format is
`particle-realms.m3b-candidate-root-release-receipt`, version is `1`,
`releaseReason` is `abort`, `conflict`, `proven-not-committed`, or `close`,
`disposition` is `released`, and the generation is positive.

`RealmProjectionArtifactLeaseReleaseReceiptV1` has this exact 13-field
vocabulary: `format`, `version`, `artifactLeaseReleaseReceiptId`, the runtime-
binding pair, the static-artifact-lease-receipt pair, the candidate-projection-
root pair, `releaseReason`, `disposition`, `leaseOwnerGeneration`, and
`receiptDigest`. Its format is
`particle-realms.m3b-artifact-lease-release-receipt`, version is `1`, its reason
set equals the root-release reason set, `disposition` is `released`, and the
accepted M2 artifact-lease adapter issues it only after durable release of the
exact candidate-scoped lease. It wraps no M2 handle and adds no M2 write method.

`RealmProjectionCandidateLeaseAndRootReleaseReceiptV1` has this exact 17-field
vocabulary: `format`, `version`, `leaseAndRootReleaseReceiptId`, the runtime-
binding pair, the candidate-projection-root pair, the static-artifact-lease-
receipt pair, the root-release-receipt pair, the artifact-lease-release-receipt
pair, `releaseReason`, `disposition`, `settlementGeneration`, and
`receiptDigest`. Its format is
`particle-realms.m3b-candidate-lease-and-root-release-receipt`, version is `1`,
`disposition` is `released`, and all embedded reasons, binding/root/lease pairs,
and positive owner generations must match. The settlement join issues it only
after independently reading back both releases.

`rootReleaseReceiptId` and its final digest use, respectively,
`particle-realms.m3b-candidate-root-release-receipt-id@1` over every field after
the ID through `rootStoreGeneration`, and
`particle-realms.m3b-candidate-root-release-receipt@1` over every preceding
field. `artifactLeaseReleaseReceiptId` and its final digest similarly use
`particle-realms.m3b-artifact-lease-release-receipt-id@1` and
`particle-realms.m3b-artifact-lease-release-receipt@1`.
`leaseAndRootReleaseReceiptId` and its final digest similarly use
`particle-realms.m3b-candidate-lease-and-root-release-receipt-id@1` and
`particle-realms.m3b-candidate-lease-and-root-release-receipt@1`. Each ID
preimage follows its displayed schema order and excludes format/version, itself,
and `receiptDigest`; each final digest includes every present preceding field
and the recomputed ID. The three hash domains cannot substitute, and the graph
is acyclic.

The service-internal `RealmProjectionCandidateLeaseSettlementReceiptV1` has
this exact closed 15-field vocabulary:

```text
format
version
settlementReceiptId
runtimeBindingId
runtimeBindingDigest
candidateState
candidateProjectionRootId
candidateProjectionRootDigest
staticArtifactLeaseReceiptId
staticArtifactLeaseReceiptDigest
settlementKind
settlementEvidenceId
settlementEvidenceDigest
disposition
receiptDigest
```

`format` is exactly
`particle-realms.m3b-candidate-lease-settlement-receipt` and `version` is one.
The scalar and presence matrix is exact:

| Variant | Own keys | `candidateState` | `settlementKind` | `disposition` | Pair presence |
| --- | ---: | --- | --- | --- | --- |
| No candidate | 9 | `not-created` | `none` | `not-issued` | Omit candidate-root, artifact-lease, and settlement-evidence pairs |
| Root released before lease | 13 | `root-created-no-lease` | `root-release` | `released` | Require candidate-root and settlement-evidence pairs; omit artifact-lease pair |
| Root and lease released | 15 | `lease-issued` | `lease-and-root-release` | `released` | Require all three pairs |
| Selected root and lease adopted by the root store | 15 | `selected` | `root-store-adoption` | `adopted` | Require all three pairs; settlement evidence is the exact committed application receipt's static-artifact-retention pair |
| Unleased root quarantined | 13 | `root-created-no-lease` | `quarantine-transfer` | `quarantine-transferred` | Require candidate-root and settlement-evidence pairs; omit artifact-lease pair |
| Leased root quarantined | 15 | `lease-issued` | `quarantine-transfer` | `quarantine-transferred` | Require all three pairs |

No cross-row scalar/presence combination is valid. `selected/adopted` is legal
only after selector CAS/readback and the static-artifact-retention receipt prove
the root store adopted the exact root/bundle/lease; it settles the app session's
candidate obligation without releasing or quarantining the healthy lease. One
`release()` request never accepts `selected`; commit close derives that row from
stored selector/retention evidence. One byte-identical terminal receipt is
always returned by commit close, so disposal never infers nonissuance from
garbage collection.

The generic settlement-evidence field names are discriminator-qualified and
never share an undifferentiated domain: `root-release` resolves through
`particle-realms.m3b-candidate-root-release-receipt@1` owned by the root
store; `lease-and-root-release` resolves through
`particle-realms.m3b-candidate-lease-and-root-release-receipt@1` owned by the
commit/M2 lease-settlement join and proves both exact releases; `root-store-
adoption` is an alias of the committed application receipt's
`staticArtifactRetentionReceiptId`/`staticArtifactRetentionReceiptDigest` pair;
and `quarantine-transfer` is an alias of the exact
`quarantineTransferReceiptId`/`quarantineTransferReceiptDigest` pair. `none/not-
issued` omits all three optional pairs. The resolver checks the candidate state,
root, conditional lease, settlement kind, owner, disposition, and issuer bytes
before the settlement receipt is admitted.

Each embedded `resourceSnapshotBefore` or `resourceSnapshotAfter` is the
canonical byte sequence of an exact 16-field
`RealmProjectionResourceSnapshotV1`: `format`, `version`, `resourceSnapshotId`,
the runtime-binding pair, `extensionChildGeneration`, `snapshotPhase`,
`candidateCount`, `preparedCount`, `readerEscrowCount`, `candidateLeaseCount`,
`sessionCandidateRootCount`, `callbackCount`, `inFlightCount`,
`resourceInventoryDigest`, and `snapshotDigest`. `snapshotPhase` is
`before-stop` or `after-transfer`. The after-transfer snapshot requires all
seven counts to be zero and the code-shipped empty inventory digest. These are
session-scoped service resources, never app-owned handles. The before snapshot
inventories each application/recovery operation identity that already exists;
later immutable phase rows advance that same member rather than creating a new
resource. Every frozen member and its final journal tail must map to exactly one
designated ownership-consuming receipt or verified journal floor; close,
binding-transition, and disposal references to that settled evidence are
derivative and do not consume it again.

Exactly one post-snapshot resource identity may be admitted while `stopping`:
the selector-retirement operation deterministically derived from the already
issued stop receipt. It converts only the prewithheld three-entry/1,048,576-byte
capacity, remains charged to the same aggregate journal pool and stop ledger,
cannot exist before that receipt without a digest cycle, and must map to
the healthy detach receipt or quarantine operation row as its one consuming
edge. Any second retirement identity or any other
new resource, missing settlement, count increase outside that one declared
operation, or inventory digest mismatch rejects disposal. The after-transfer
zero inventory is valid only after every frozen or stop-derived member is
settled or its quarantine adoption is durably read back.

## `RealmProjectionDisposalReceiptV1`

The disposal receipt has a closed 38-field top-level vocabulary:

```text
format
version
disposalReceiptId
realmId
runtimeBindingId
runtimeBindingDigest
extensionChildId
extensionChildGeneration
stopReason
finalProjectionRootId
finalProjectionRootDigest
readerCloseReceiptId
readerCloseReceiptDigest
contextCloseReceiptId
contextCloseReceiptDigest
extensionReleaseReceiptId
extensionReleaseReceiptDigest
commitCloseReceiptId
commitCloseReceiptDigest
candidateLeaseSettlementReceiptId
candidateLeaseSettlementReceiptDigest
ecsDetachReceiptId
ecsDetachReceiptDigest
stateFirstDetachReceiptId
stateFirstDetachReceiptDigest
rootRetentionOwnershipTransferReceiptId
rootRetentionOwnershipTransferReceiptDigest
bindingTransitionReceiptId
bindingTransitionReceiptDigest
quarantineTransferReceiptId
quarantineTransferReceiptDigest
resourceSnapshotBefore
resourceSnapshotAfter
callbackCountAtClose
inFlightCountAtClose
disposition
reasonCode
receiptDigest
```

Terminal disposition is exactly `released` or `quarantined-transferred`.
`released` means the app session and its candidate resources are released; it
does not mean a healthy selected/lineage-retained root was destroyed. Every
candidate lease is settled exactly once by the explicit candidate-settlement
receipt. A selected root/lease was already root-store-owned at commit; its root-
retention receipt only moves it internally from current selection to the
retained owner. That is a normal healthy transition and never quarantine.
`quarantined-transferred` requires a durable quarantine-transfer pair, zero
session-scoped resources in the after snapshot, and still requires the explicit
candidate-settlement receipt. Quarantine may retain unresolved operation
evidence, but it never erases terminal ownership proof. `blocked` is a
process-local nonterminal stop result and creates no disposal receipt. Pair
members are present together or absent together. No-handle/nonissuance variants
are explicit and never fabricated from garbage collection.

The terminal own-key matrix is exact:

| Variant | Own keys | Required conditional fields | Forbidden conditional fields |
| --- | ---: | --- | --- |
| `released-no-root` | 29 or 31 | all close pairs including extension release, explicit candidate-lease settlement, both detach/nonissuance pairs, resource snapshots, zero counts; add the transition pair iff stop reason is binding transition | final root, root-retention transfer, quarantine, reason |
| `released-root-transferred` | 33 or 35 | final root, all close pairs including extension release, candidate-lease settlement, both detach pairs, root-retention transfer, resource snapshots, zero counts; add the transition pair iff stop reason is binding transition | quarantine, reason |
| `quarantined-transferred-no-root` | 32 | all close/extension pairs, both quarantine-transfer detach pairs, candidate settlement, quarantine transfer, resource snapshots, zero session-scoped counts, and reason | final root, root-retention transfer, and binding transition |
| `quarantined-transferred-with-root` | 34 | final root, all close/extension pairs, both quarantine-transfer detach pairs, candidate settlement, quarantine transfer, resource snapshots, zero session-scoped counts, and reason | root-retention transfer and binding transition |

`released-no-root` requires a `none/detached` detach receipt;
`released-root-transferred` requires `retained-owner/detached` and the same exact
root pair in its ownership transfer; `quarantined-transferred-no-root` requires
`quarantine-no-root/quarantine-transferred`; and
`quarantined-transferred-with-root` requires
`quarantine-owned/quarantine-transferred` plus the exact root pair
bound by that detach request's canonical expected-present state. Any crossed
root-state/disposal combination is invalid.

The explicit candidate-settlement receipt is always present and states whether
zero or one candidate lease was not issued, released, adopted by the root store,
or transferred to quarantine. The root-
retention transfer pair is present exactly when the final root was selected or
lineage-retained and remains durably retained after selector detachment. The
final-root pair is absent together when no root ever
committed; no empty or garbage-collected root identity is fabricated. The
binding-transition pair is forbidden for ordinary stop and required for a
completed, nonquarantined operator/M2/M3A/pseudonym/binding retirement. Every
quarantine disposal forbids it and leaves successor eligibility blocked until a
later kernel-owned recovery proves the transferred state; the immutable
disposal receipt is never rewritten.

Stop order is exact:

1. transition the entry to `stopping`, call context `beginStop()`, atomically
   reject new service work, and read back the frozen `before-stop` resource
   snapshot;
2. abort the object-identical session work signal;
3. settle every read, projection, prepare, commit, reconcile, and recover call;
4. reconcile every dispatched or uncertain application and recovery operation,
   call `detachSources()`, and reconcile its selector-retirement operation; each
   application, recovery, or retirement journal tail must reach a proven
   terminal result or transfer exactly once to the kernel quarantine owner;
5. verify complete M2 static fallback and obtain the exact detach,
   State-First, ECS, and conditional quarantine receipts;
6. close the M3A reader lease and verify its binding-bound close receipt;
7. close the commit port after every candidate lease settles and every healthy
   selected root transitions internally to the durable retained-root owner, or
   after unresolved ownership transfers to quarantine;
8. call context `closeSession()` last so it can verify the stop, detach, reader,
   commit, settlement, and transfer evidence; release the independent extension
   child and service-owned roots; freeze/read back the `after-transfer` snapshot;
   and issue exactly one terminal disposal receipt;
9. verify the returned before/after bytes, extension-release evidence, disposal
   bytes, and zero callback/in-flight/session-resource counts outside explicitly
   transferred quarantine ownership;
10. revoke the final context facet and allow no post-close mutation.

Double stop returns the byte-identical terminal receipt, not a new
`already-released` record. A stale asynchronous completion is
fenced by extension generation and cannot mutate a later entry.

## Flat module and ownership map

The planned app-owned paths are flat peers. The app owns wire contracts,
session orchestration, and port consumption; it does not own the semantic
algorithms trusted prepare must replay:

```text
webgpu-os/apps/the-virtual-realm/
  projection-contracts/RealmM3BProjectionContractPrimitives.js
  projection-contracts/RealmProjectionRuntimeProfileContract.js
  projection-contracts/RealmProjectionDomainManifestContract.js
  projection-contracts/RealmProjectionRuntimeBindingContract.js
  projection-contracts/RealmProjectionDisclosurePolicyContract.js
  projection-contracts/RealmProjectionInputCutContract.js
  projection-contracts/RealmDisclosureDecisionSetContract.js
  projection-contracts/RealmProjectionBatchContract.js
  projection-contracts/RealmProjectionAppliedCursorContract.js
  projection-contracts/RealmDynamicStoreSnapshotContract.js
  projection-contracts/RealmEcsProjectionChangeSetContract.js
  projection-contracts/RealmStateFirstSourceSnapshotContract.js
  projection-contracts/RealmProjectionApplicationIntentContract.js
  projection-contracts/RealmProjectionApplicationReceiptContract.js
  projection-contracts/RealmProjectionRecoveryReceiptContract.js
  projection-contracts/RealmProjectionStateRootContract.js
  projection-contracts/RealmProjectionDisposalReceiptContract.js
  projection-contracts/VirtualRealmM3BProjectionContractCatalog.js
  projection/VirtualRealmM3BProjectionEntry.js
  projection/RealmObservationBatchConsumer.js
  projection/RealmProjectionApplicationCoordinator.js
  projection/RealmProjectionRecoveryCoordinator.js
```

Without increasing the 18-module contract graph,
`VirtualRealmM3BProjectionContractCatalog.js` owns and exports the frozen
`RealmProjectionReferenceDescriptorPackV1` and the compiled
`RealmProjectionReferenceDomainRegistryV1`. Their one semantic source and five
derived checked-in artifacts are versioned data, not additional modules:

```text
webgpu-os/apps/the-virtual-realm/contracts/m3b/reference/v1/
  realm-projection-reference-source-matrix-v1.canonical.json
  realm-projection-reference-descriptor-pack-v1.canonical.json
  realm-projection-reference-domain-registry-v1.canonical.json
  realm-projection-cross-method-alias-graph-v1.canonical.json
  realm-projection-reference-vectors-v1.pin.json
  RealmProjectionReferenceVectorsV1.js

MD/tools/
  build_m3b_reference_vectors.py
```

The source matrix is the sole hand-authored semantic source. Its
`RealmProjectionReferenceSourceMatrixV1` object has exactly 21 fields in this
order:

```text
format
version
canonicalEncodingProfileId
importedCatalogSourceRows
importedCatalogSourceCount
carrierShapeRows
carrierShapeCount
recoveryDispositionRows
recoveryDispositionCount
domainSourceRows
domainSourceCount
carrierSourceRows
carrierSourceCount
producerSeedCount
producerVariantCount
consumerEdgeTupleCount
crossMethodAliasSourceRows
crossMethodAliasSourceRowCount
crossMethodAliasLiteralDomainSourceRowCount
crossMethodAliasReferenceRowCount
disposition
```

Its literal values are:

```text
format = particle-realms.m3b-reference-source-matrix
version = 1
importedCatalogSourceCount = 3
carrierShapeCount = 6
recoveryDispositionCount = 9
domainSourceCount = 50
carrierSourceCount = 78
producerSeedCount = 87
producerVariantCount = 111
consumerEdgeTupleCount = 111
crossMethodAliasSourceRowCount = 108
crossMethodAliasLiteralDomainSourceRowCount = 105
crossMethodAliasReferenceRowCount = 137
disposition = frozen
```

Each imported-catalog source row has exactly three fields: `catalogOrder`,
`catalogRole`, and `acceptedCatalogExportName`; orders are dense and roles are
exactly `accepted-m0-m1c`, `accepted-m2`, and `accepted-m3a`. The compiler obtains
the accepted catalog pair/count by readback and never accepts them as hand-
authored source values. Each carrier-shape row has exactly four fields:
`carrierShapeOrder`, `carrierKind`, `admittedBytesRules`, and
`directConsumerRules`. A direct-consumer rule has exactly three fields:
`ruleOrder`, `variantPrefix`, and `consumerArtifactId`. The source-state row has
two rules, for `state-evidence` and `tick-authority`; each of the other five
carrier kinds has one rule to its frozen manifest/receipt/target artifact. Each
recovery-disposition row has exactly three fields: `dispositionOrder`,
`disposition`, and `durableStatus`, in the nine-row order already frozen above.

Each domain source row has exactly 13 fields: `domainOrder`, `domainKey`,
`definitionSource`, `definitionName`, `definitionCatalogRole`, `wireFormat`,
`wireVersion`, `intrinsicIdField`, `intrinsicDigestField`,
`selectorFieldNames`, `selectorPresenceSeedRows`, `selectorRuleSeedRows`, and
`dependencyRoleSeedRows`. Literal `none` represents no imported catalog role;
the compiler omits `definitionCatalogRole` only from the corresponding derived
descriptor variant. The three seed row shapes are exact:

```text
selectorPresenceSeedRow =
  variantId, discriminatorFieldPath, discriminatorValues,
  requiredFieldNames, omittedFieldNames

selectorRuleSeedRow =
  ruleKind, subjectFieldPaths, operatorId, canonicalOperands,
  admittedTargetDomainKeys

dependencyRoleSeedRow =
  roleName, parentRowPathId, idFieldPath, digestFieldPath,
  presenceDiscriminatorFieldPath, presenceDiscriminatorValues,
  admittedTargetDomainKeys, admittedCatalogRoles, targetRole, multiplicity
```

The 50 rows produce exactly 50 singleton presence variants. Forty-seven use
only the intrinsic pair; the two recovery domains additionally select
`receiptPhase`, and the active-bake adapter additionally selects
`activeBakeRevision`, for exactly 103 selector-field occurrences. The only
source semantic selector rules are the two exact recovery `receiptPhase`
equality rules. Dependency-role seeds remain explicit because parent paths,
multiplicity, and target role are semantic, not inferred from field spelling.

Each carrier source row has exactly ten fields: `carrierOrder`, `domainKey`,
`carrierKind`, `bytesRule`, `authorityRuleKind`, `authorityFieldPath`,
`exactIssuerOwner`, `requiredResolverKind`, `authorityConditionSeedRows`, and
`producerSeedRows`. A condition seed is the exact four-tuple
`leftFieldPath`, `operatorId`, `rightOperandKind`, `rightOperand`. A producer
seed has exactly five fields: `variantStem`, `expansionSet`,
`producerEndpoint`, `consumerArtifactId`, and `conditionSeedRows`.
`expansionSet` is only `singleton` or `recovery-dispositions`.
`producerEndpoint` is a literal endpoint or the source-only
`exact-issuer-owner` sentinel, which must resolve before hashing and is never
emitted. Singleton `variantId` equals `variantStem`; recovery expansion appends
the exact disposition to a stem ending in `-`, after which the compiler appends
the `receiptPhase`, disposition, and durable-status conditions in that order.
The six carrier shapes map to the direct consumer artifacts frozen in the
carrier sections above. One direct five-string edge tuple is emitted per
expanded producer variant; no prose is parsed and no cross-method alias enters
this 111-edge set.

Each of the 108 `crossMethodAliasSourceRows` corresponds in source order to one
row of the closed cross-method table and has exactly three fields:
`sourceRuleOrder`, `expansionSeedRows`, and `expectedReferenceRowCount`. Each
expansion seed has exactly ten fields: `sourceExpansionOrder`,
`referenceDomainKey`, `issuerOwnerId`, `requiredResolverKind`,
`selectorSeedRows`, `producerVariantSeedRows`, `consumerEdgeSeedRows`,
`expectedSelectorCount`, `expectedProducerVariantCount`, and
`expectedConsumerEdgeCount`. Selector seeds have exactly eight fields:
`selectorKey`, `referenceRole`, `referenceShape`, `sourceFieldPaths`,
`consumerFieldPaths`, `transferKind`, `conditionSeedRows`, and `disposition`.
Producer-variant seeds have exactly four fields: `variantId`,
`producerMethodOrOwnerId`, `conditionSeedRows`, and `selectorKeys`. Consumer-
edge seeds have exactly six fields: `edgeKey`, `producerVariantId`,
`consumerMethodOrArtifactId`, `selectorKeys`, `edgeDisposition`, and
`conditionSeedRows`. Keys are source-local references resolved by the compiler,
not derived IDs.

The authority-query and transition-base aliases declared in the cross-method
table are mandatory source-matrix seeds, not prose-only exceptions. The existing
authority-receipt source row contains selectors for
`authorityQueryRows[].authorityReceiptId`, permission-only
`payload.authorityReceiptRef`, and action-result-only
`payload.authorityReceiptId`, with the exact producer conditions and the context
`resolveAuthorityEvidence` request as consumer edge. The existing DynamicStore-
entry source row contains the prior-root-only triple selector conditioned by
`transitionBase.baseKind = retained-entry`. The Delta and appended presentation-
command rows contain prior-root selectors under that same condition plus same-
batch pure-work-product variants conditioned by
`transitionBase.baseKind = in-batch-candidate` and
`reductionClass = current-eligible`. Thus a historical retained base remains
legal, but historical pure outputs remain batch/closure evidence and cannot
satisfy either in-batch transition-base selector. All three name the neutral
primary-projector and trusted-prepare consumers. The existing observation-batch,
observation, Delta, and command rows also seed the condition-qualified one-
successor cleanup/remove consumer edges needed by nonempty ECS remove source
arrays; those edges terminate when their citing selected root retires. These
nested selectors, conditions, variants, and edges remain inside
the existing source/reference domains, so the fixed 108 source rows, 137
reference rows, and separate 87-seed/111-direct-edge carrier expansion do not
change. Their nested expected selector/producer/consumer counts do change and
must be regenerated; every affected row digest, aggregate digest, graph digest,
source SHA, JavaScript/JSON mirror, pin-manifest digest, and release constant
must be recomputed. A pin made before these edges were present is stale and must
reject even if its top-level counts match.

Source orders `0..24`, `26..37`, `39..99`, and `101..107` each expand once.
Order 25 expands in fixed port/method order to 24 exact result domains: reader
`descriptor,captureNext,reassert,close`; context
`descriptor,openSession,capture,resolveStatic,resolveAuthorityEvidence,reassert,
waitForWake,recordDiagnostic,beginStop,closeSession,close`; and commit
`descriptor,readPriorState,prepare,commit,reconcile,recover,detachSources,
release,close`. Order 38 expands in listed source-state order to checkpoint,
initial-acquisition recovery, ledger append, and recovery-phase domains. Order
100 expands to root-release, lease-and-root-release, static-retention, and
quarantine-transfer settlement domains. Appended order 107 is the one literal
presentation-command pair/ID-only-Delta/closure-bytes join. Therefore 105
literal rows plus 24 + 4 + 4 concrete expansions produce exactly 137 reference
rows. The
checksum inventory `sourceRuleOrder|expectedReferenceRowCount|comma-joined-
referenceDomainKeys`, encoded UTF-8/LF with a terminal LF, is independently
SHA-256 hashed and pinned in the checked-in M3B-01 source/vector manifest. The
former 107-row planning value
`B7306E376F3E13F0675C6D3DA5633B9FA5A456DC1F8A5C159E219B8A0C510FD6`
is explicitly invalid for this 108-row revision and must reject; the replacement
is accepted only when generated from the complete canonical source, reproduced
by the independent Python compiler, and byte-matched by the browser verifier.

The derived `RealmProjectionCrossMethodAliasGraphV1` has exactly 18 fields:

```text
format
version
graphId
canonicalEncodingProfileId
sourceMatrixSha256
sourceRuleCount
sourceRuleRowsDigest
referenceRows
referenceRowCount
selectorRowCount
producerVariantRowCount
consumerEdgeRowCount
referenceRowsDigest
selectorRowsAggregateDigest
producerVariantRowsAggregateDigest
consumerEdgeRowsAggregateDigest
disposition
graphDigest
```

`format` is `particle-realms.m3b-cross-method-alias-graph`, version is `1`,
`sourceRuleCount = 108`, `referenceRowCount = 137`, and `disposition = compiled`.
The three nested counts are compiler-derived sums over explicit arrays; their
digests flatten rows in `(referenceOrder, nestedOrder)` order.

Each reference row has exactly 16 fields: `referenceOrder`, `sourceRuleOrder`,
`sourceExpansionOrder`, `referenceRowId`, `referenceDomainKey`, `carrierKind`,
`issuerOwnerId`, `requiredResolverKind`, `selectorRows`, `selectorCount`,
`producerVariantRows`, `producerVariantCount`, `consumerEdgeRows`,
`consumerEdgeCount`, `disposition`, and `rowDigest`. Orders are dense,
`carrierKind = cross-method-reference`, `disposition = materialized`, all counts
equal lengths, `referenceRowId` uses
`particle-realms.m3b-cross-method-reference-row-id@1` over, in order,
`referenceOrder`, `sourceRuleOrder`, `sourceExpansionOrder`, then fields five
through 15, and `rowDigest` uses
`particle-realms.m3b-cross-method-reference-row@1` over the first 15 fields.

A selector row has exactly 11 fields: `selectorOrder`, `selectorId`,
`referenceRole`, `referenceShape`, `sourceFieldPaths`, `consumerFieldPaths`,
`transferKind`, `conditionRows`, `conditionCount`, `disposition`, and
`rowDigest`. `referenceRole` is `intrinsic`, `alias`, `qualifier`, or
`bytes-carrier`; `referenceShape` is `pair`, `scalar`, `id-only`, `digest-only`,
or `canonical-bytes`; `transferKind` is `reference-only` or
`resolved-canonical-bytes`. Pair/scalar/id-only/digest-only shapes require path
arities 2/1/1/1 on both sides. Canonical bytes require zero source paths and one
consumer path: the bytes are selected by the frozen domain, owner, resolver,
and conditions rather than an implicit source field. Conditions reuse the
closed six-field condition ABI. `selectorId` and `rowDigest` use, respectively,
`particle-realms.m3b-cross-method-selector-id@1` over fields three through ten
and `particle-realms.m3b-cross-method-selector@1` over the first ten fields.

A producer variant has exactly seven fields: `variantOrder`, `variantId`,
`producerMethodOrOwnerId`, `conditionRows`, `conditionCount`, `selectorIds`, and
`rowDigest`; its digest domain is
`particle-realms.m3b-cross-method-producer-variant@1` over the first six fields.
A consumer edge has exactly ten fields: `edgeOrder`, `edgeId`,
`producerVariantId`, `consumerMethodOrArtifactId`, `selectorIds`,
`selectorCount`, `edgeDisposition`, `conditionRows`, `conditionCount`, and
`rowDigest`. Edge disposition is `consumable`, `caller-only`, or
`nonconsumable`; the latter two require consumer ID `none`. `edgeId` uses
`particle-realms.m3b-cross-method-edge-id@1` over fields three through nine and
the row digest uses `particle-realms.m3b-cross-method-edge@1` over the first nine
fields. Source orders 42, 63, 67/68/72/79, and 106 use respectively `id-only`,
`scalar`, `digest-only`, and per-carrier `canonical-bytes` selectors. Order 72's
terminal `intentDigest` is an explicit digest-only selector, never prose-only.

`sourceRuleRowsDigest` uses
`particle-realms.m3b-cross-method-source-rule-rows@1` over the complete 108
ordered source rows followed by their count. `referenceRowsDigest` uses
`particle-realms.m3b-cross-method-reference-rows@1` over all 137 complete rows
followed by their count. The selector, producer-variant, and consumer-edge
aggregate digests use their corresponding
`particle-realms.m3b-cross-method-*-rows@1` domains over the complete nested rows
flattened by `(referenceOrder, nestedOrder)`, followed by their exact aggregate
count. `graphId` uses
`particle-realms.m3b-cross-method-alias-graph-id@1` over, in order, the encoding
profile ID, source SHA, source rule count/digest, all four aggregate counts, all
four aggregate digests, and disposition. `graphDigest` uses
`particle-realms.m3b-cross-method-alias-graph@1` over the first 17 displayed
graph fields, including the recomputed ID and complete reference rows.

A missing source/expansion/nested row, count mismatch, condition mismatch,
unresolved source-local key, unspecified endpoint, or extra/missing table
coverage is a source-matrix failure, not an implementation choice. Source rows
contain no hand-authored derived ID or digest; all such values are compiler
output and the physical source SHA closes the source object.

Each `.canonical.json` file is exact UTF-8 without BOM and byte-equals the frozen
M0 canonical encoder for the bound `canonicalEncodingProfileId`; pretty print,
alternate key order, host `JSON.stringify`, duplicate keys, floats, negative
zero, or trailing bytes fail. The pure-Python compiler consumes the source
matrix and accepted contract/catalog descriptor bytes, builds and consumes every
50/50/78/78 row once, expands all 87 seeds into 111 direct variants/edges,
materializes all 108 source rules into 137 cross-method rows, emits the 17-field
pack, 12-field registry, 18-field alias graph, and JavaScript byte mirror. Its
default mode is `--check`; regeneration requires an explicit output mode and
must produce byte-identical browser/Python input.

The pin manifest has exactly 14 fields in order: `format`, `version`,
`canonicalEncodingProfileId`, `sourceMatrixSha256`, `descriptorPackSha256`,
`descriptorPackId`, `descriptorPackDigest`, `referenceDomainRegistrySha256`,
`referenceDomainRegistryId`, `registryDigest`, `crossMethodAliasGraphSha256`,
`crossMethodAliasGraphId`, `crossMethodAliasGraphDigest`, and `pinDigest`. SHA fields are
uppercase 64-hex SHA-256 of the exact physical canonical bytes. `pinDigest` uses
`particle-realms.m3b-reference-vector-pin@1` over every preceding field in
order. The graph is acyclic: source matrix -> pack -> registry -> cross-method
alias graph -> external pin; none of the first four references the pin. The catalog carries literal release
constants for the accepted pin digest and pin-file SHA-256; normal tests never
generate expected constants from the file under test.

The catalog cannot initialize until all source/derived files exist, the accepted
prerequisite catalogs and local definition descriptors close every source row,
the compiler `--check` succeeds, and the release constants match. Until then the
pack/registry/alias-graph IDs and digests are deliberately unavailable rather
than replaced by a plan-time fake hash. Browser and Python gates consume these same canonical
files; the test fixtures below are import/read adapters, never second sources.
Runtime inference and hand-authored derived IDs/digests are forbidden.

A neutral import-inert package owns every pure deterministic algorithm. These
modules have no app, kernel, Engine, renderer, storage, clock, random, network,
RealmForge, or capability import. Both the app coordinator and trusted commit
service import the same byte-identical package:

```text
webgpu-os/shared/realm/projection/
  RealmProjectionSemanticKernel.js
  RealmProjectionDisclosureEvaluator.js
  RealmBootProjector.js
  RealmFilesystemProjector.js
  RealmStorageProjector.js
  RealmProcessProjector.js
  RealmIpcProjector.js
  RealmSyscallProjector.js
  RealmPermissionProjector.js
  RealmNetworkProjector.js
  RealmHistoricalWitnessProjector.js
  RealmProjectionMaintenanceCompiler.js
  RealmProjectionBatchAssembler.js
  RealmProjectionDeltaReducer.js
  RealmDynamicStoreCandidateBuilder.js
  RealmEcsProjectionPlanner.js
  RealmStateFirstSourcePlanner.js
  RealmProjectionProtectedClosureCompiler.js
  RealmProjectionCandidateVerifier.js
```

Trusted WebGPU OS peers are flat within their existing owner directory:

```text
webgpu-os/kernel/realm/RealmObservationBatchReaderProjectionService.js
webgpu-os/kernel/realm/RealmProjectionContextService.js
webgpu-os/kernel/realm/RealmProjectionExtensionOwner.js
webgpu-os/kernel/realm/RealmProjectionAuthorityEvidenceResolver.js
webgpu-os/kernel/realm/RealmProjectionAuthorityFenceService.js
webgpu-os/kernel/realm/RealmProjectionStaticBindingResolver.js
webgpu-os/kernel/realm/RealmProjectionEvidenceEscrowStore.js
webgpu-os/kernel/realm/RealmProjectionRootStore.js
webgpu-os/kernel/realm/RealmProjectionRetainedRootOwner.js
webgpu-os/kernel/realm/RealmProjectionRootVerifier.js
webgpu-os/kernel/realm/RealmProjectionProtectedClosureVerifier.js
webgpu-os/kernel/realm/RealmProjectionBundleCommitService.js
webgpu-os/kernel/realm/RealmProjectionOperationJournal.js
webgpu-os/kernel/realm/RealmProjectionRecoveryAttemptJournal.js
webgpu-os/kernel/realm/RealmProjectionRecoveryJournalFloorStore.js
webgpu-os/kernel/realm/RealmProjectionSelectorRetirementAttemptJournal.js
webgpu-os/kernel/realm/RealmProjectionArtifactLeaseService.js
webgpu-os/kernel/realm/RealmProjectionLineageFloorStore.js
webgpu-os/kernel/realm/RealmProjectionRecoveryService.js
webgpu-os/kernel/realm/RealmProjectionQuarantineOwner.js
webgpu-os/kernel/realm/RealmProjectionDiagnostics.js
```

`RealmProjectionSelectorRetirementAttemptJournal.js` owns both the exact
retirement-attempt chain and its absence-capable readback receipt codec; it
invokes the durable selector only through the injected transaction facet and
does not reinterpret `RealmProjectionSelectorReadReceiptV1` as absence proof.

The separate Engine capability is also split into flat, single-purpose peers in
their established owner areas:

```text
engine/state/projection/RealmProjectionBundleCodec.js
engine/state/projection/RealmProjectionBundleAdapter.js
engine/state/projection/RealmProjectionDurableSelector.js
engine/ecs/projection/RealmProjectionEcsOverlayCodec.js
engine/render/state/RealmProjectionStateFirstSourceCodec.js
```

M2 retains ownership of its accepted `RealmDynamicStore`, static ECS
materialization, State-First source/presentation adapter, structural/frame
barriers, and component/archetype codecs. The M3 capability consumes those
codecs through narrow injected facets, adds one separate full overlay and bundle
selector, and does not modify the frozen M2 15-key composition or CSE contract.

Only a composition root constructs concrete peers. No projector constructs or
imports another projector; the shared semantic kernel receives the ordered
projector functions as immutable values. No app peer imports a trusted kernel or
Engine peer. No trusted peer imports an app projector: app and trusted prepare
both import the neutral pure package. Dependencies are injected as immutable
values, ports, codecs, and factories. No shared/app/trusted projection peer
imports a renderer, GPU resource, RealmForge executor, scanner, raw manager,
network session, or unrelated application.

## Diagnostics and debug coverage

Diagnostics are process-local, owner-private, bounded to 256 entries and
262,144 canonical bytes, and excluded from every cut, batch, cursor, store,
ECS, State-First, root, bundle, application, recovery, and disposal
identity/digest. Only the correlation-only diagnostic receipt binds a
diagnostic projection, as defined by the port ABI; that receipt is never durable
Realm state or a dependency of another artifact. Diagnostics use fixed codes
and buckets, never raw exceptions or payload reflection.

The implementation logs these major operations through the existing bounded
runtime diagnostics seam:

| Point | Required data |
| --- | --- |
| Entry start/exit | Entry state, extension generation, binding digest prefix, elapsed bucket |
| Reader call | Result kind, record/byte counts, batch sequence, elapsed bucket |
| Disclosure | Included/omitted counts by admitted kind and fixed reason |
| Projector | Projector ID, input count, delta count, structural-evidence count, elapsed bucket |
| Maintenance | Cut kind, source-slot/expiry counts, masked/cleanup counts, elapsed bucket |
| Reducer | Prior/target generation, delta/dirty/full-overlay counts, result code, elapsed bucket |
| Closure | Retention-class counts, canonical-byte bucket, lease count, result code |
| Prepare/commit | Intent sequence, journal phase, selector generation classes, disposition, elapsed bucket |
| Recovery | Recovery kind, attempt, disposition, retained-root/aggregate-byte buckets |
| Device transition | Presentation state/generation class and gate state; no GPU object |
| Stop | Resource counts before/after, in-flight/callback counts, quarantine-transfer class, disposition |

Diagnostics cannot contain observation bytes, raw IDs when a bounded digest
prefix or count suffices, paths, names, content, commands, arguments, payloads,
tokens, keys, addresses, peers, stack traces, error objects, or store keys.

## Failure policy

M3B uses closed failures:

- invalid canonical bytes or identity: quarantine the complete cut;
- policy-valid omission: record the omission and continue;
- missing static binding: zero output or powerless structural evidence;
- authority head/epoch/revocation/expiry change: synchronously invalidate the
  presentation fence and mask dependent gates closed before wake; durable root
  bytes remain recorded-time evidence only;
- stale source: atomically update the exact seven-slot health overlay so all
  affected entries fail closed without an unbounded per-entry rewrite;
- gap or out-of-order batch: preserve root/cursor and enter M3A recovery;
- plus-one ceiling: reject before candidate allocation or commit;
- pure projector/reducer/planner exception: reject the complete candidate;
- expected-head conflict: preserve current root and report proven competitor;
- pre-dispatch abort: abandon candidate after safe release;
- uncertain dispatch or failed in-memory mirror: retain the candidate under the
  commit journal/session owner, hide dynamic presentation, reconcile the durable
  selector, and route persistent pending readback through the separate
  `uncertain-commit-reconciliation` recovery counter; transfer to quarantine
  only through the ordinary stop receipt;
- missing/corrupt root: use complete M2 static fallback;
- device loss: close dynamic presentation; after accepted M2 recovery, allow
  only bounded hidden CPU selector catch-up behind the `recovering` fence until
  exact closed-to-ready recovery evidence is durably read back;
- binding change: retire through lifecycle evidence, select M2 static, and start
  a separate first-batch genesis; bake/layout divergence hands control to M3C;
- diagnostics overflow: aggregate by fixed code or drop diagnostics, never
  projection evidence.

No failure rolls back or rewrites an M3A append. No failure partially applies a
DynamicStore, ECS, cursor, or State-First source update.

## M3B threat inventory

| Threat | Attack | Required safe result |
| --- | --- | --- |
| `M3B-T01` | Included-byte substitution or widening | Reject complete cut |
| `M3B-T02` | Omitted observation resurrection | Reject and quarantine projector/policy result |
| `M3B-T03` | Primary ownership spoof or cross-projector emission | Reject complete batch |
| `M3B-T04` | Cross-binding, operator, lifecycle, or key-epoch replay | Stale-binding rejection before allocation |
| `M3B-T05` | Filesystem topology laundering | Zero world delta; bounded structural evidence only |
| `M3B-T06` | Permission-only, forged, expired-history rewrite, stale-fence, or incomplete current-authority success | Require recorded-time chain evidence plus a complete synchronously invalidated current-authority mask; historical completion never grants current access |
| `M3B-T07` | Delta ID, digest, or semantic-key equivocation | Quarantine complete batch |
| `M3B-T08` | Duplicate, gap, or reorder cursor corruption | Idempotent exact duplicate or visible recovery block |
| `M3B-T09` | Count, byte, work, root, retained-aggregate, evidence-escrow, aggregate three-journal, quarantine, or diagnostic exhaustion | Reject/block before allocation or retain explicitly owned evidence without partial state |
| `M3B-T10` | Stale or cross-bake anchor binding | Zero output or stale-binding rejection |
| `M3B-T11` | Torn DynamicStore/ECS/State-First application or divergent in-memory mirror | Durable selector chooses one complete bundle; dynamic presentation closes until mirror reconciliation |
| `M3B-T12` | Blind retry or false noncommit after uncertain selector CAS | Recovery-pending and durable journal/selector readback |
| `M3B-T13` | Forged/corrupt root, evidence escrow, lease target/receipt, lineage floor, or checkpoint edge | Reject root; static fallback if no complete self-contained bundle verifies |
| `M3B-T14` | Device-loss application or early dynamic reveal before complete catch-up | Presentation fence closed; static visible until head/floor/cursor/source/authority/expiry catch-up and protected closed-to-ready transition |
| `M3B-T15` | Live handle, callback, function, Promise, or object smuggling | Structural rejection |
| `M3B-T16` | Diagnostic or reflected-error exfiltration | Fixed redacted code/count/bucket only |
| `M3B-T17` | Historical witness influence on current state | Reject witness output and preserve primary state |
| `M3B-T18` | Application/recovery/selector-retirement journal, floor-compaction, selector, lifecycle ABA, or post-stop completion | Exact acyclic terminal evidence including absence-capable selector-retirement readback, record/floor chains, attempt/generation/transition fences, durable healthy-root/quarantine ownership, and no mutation |
| `M3B-T19` | RF-GE Plan/candidate/artifact/cache/evidence-program output treated as execution | Reject before projection/application |
| `M3B-T20` | Renderer, geometry, topology, public, code, Genesis, station, bridge, or remote mutation | Reject complete candidate |

## Ten implementation pieces

### M3B-00: prerequisite and regression lock

- Verify accepted integrated M2 and accepted implemented M3A evidence.
- Implement and independently accept the separate M3 projection-transaction
  profile, full-bundle codecs, reader and recorded-authority evidence escrows,
  lease-neutral target compilation, root-store-scoped nonexpiring artifact-
  lease acquisition, retained-root ownership, durable selector CAS plus separate
  application/recovery/selector-retirement journals, recovery service, 14-field
  authority/device presentation fence, and fail-
  closed in-memory mirror before M3B registration.
- Freeze current catalog counts, port descriptors, active profile, and regression
  hashes.
- Fail before M3B registration if any prerequisite is missing or only planned.

### M3B-01: contracts and vectors

- Implement the exact 18-module contract graph and 16-definition catalog.
- Embed and independently vector the exact ten-field manifest's flat 16-field
  recipe matrix: 53 event rows, 130 primary operation slots, 16 descriptor
  roles, one separate witness row, all row/aggregate digests, and no executable
  callback or additional catalog definition.
- Export the embedded exact 17-field reference-descriptor pack and 12-field
  compiled registry from the catalog module; check in the complete 50/50/78/78
  JavaScript/JSON mirrors, the 87-seed/111-direct-edge expansion, and the
  108-source/137-reference-row alias graph at the frozen paths; independently
  include the condition-qualified authority-query and transition-base selectors,
  variants, and consumer edges; and independently recompute every nested count,
  row, aggregate, pack, registry, catalog, cross-edge, physical SHA, release
  constant, and external pin digest rather than preserving a prior pin.
- Implement the exact 57-field/47-ceiling profile, its inside-quota three-entry/
  1,048,576-byte stop reserve and 61-entry/15,728,640-byte ordinary budgets, plus all closed variant
  presence matrices, exact ten-field per-port descriptors and method/result
  domains, eight-key service result envelopes/payload unions, protected-
  closure/lease-target rows, the exact 16-field prior-state package and
  22-field head-read receipt, its derived 262151-entry and 201326592-byte non-
  closure complete-base ceilings, the exact local service format/version
  registry, closed cross-method reference domains and carrier aliases,
  retention/escrow/due/selector/catch-up/floor/
  transition/transfer/resource/disposal ABIs, 24/18/18-field journal records,
  11-field application/recovery terminal evidence, 14-field recovery floor,
  24-field detach and 21-field quarantine receipts, the 41-field batch command
  pair join, and cross-owner reference rules.
- Add minimal, exact-bound, plus-one, hostile-structure, and cross-language
  vectors for every definition and nested row.
- Register atomically through the existing registry.

### M3B-02: composition and binding

- Implement the exact three-key entry, the recovery-bearing commit surface, and
  every closed method-specific port result union.
- Bind one independent capped M3B extension child and object-identical work and
  teardown signals.
- Verify each descriptor against its own code-shipped bytes and prove only the
  53-field binding pair byte-identical across all three ports before allocation.

### M3B-03: input and disclosure

- Implement the bounded M3A reader consumer, exactly three 28-field input-cut
  variants, 13-field source-state snapshots with the closed M3A evidence-kind
  resolver map, 11-field retention state, seven-
  slot nested generation tracking, complete reader escrow, and 16-field expiry-
  due proof.
- Resolve subject-only static closure and every structurally valid recorded-
  authority observation before disclosure; keep the complete 13-field current-
  authority snapshot as a separate fence-only conjunctive mask.
- Prove unchanged-idle no-op, changed-source artifact issuance, gap behavior,
  record byte identity, escrow adoption/release, and no M3A mutation.

### M3B-04: pure projectors and witness

- Implement the neutral shared semantic kernel, eight separate primary modules,
  maintenance compiler, and zero-owner witness.
- Consume the byte-identical recipe matrix and verified empty/current prior-state
  view; freeze candidate subject/anchor/stable identity before projection;
  construct exact reduction-class-partitioned per-slot transition bases with
  current-only in-batch chaining and read-only historical bases; freeze exact
  slot constructors, suppression/rejection, same-key current transition chains,
  semantic-axis non-upgrade, authority correlation, local-only descriptor-
  derived network endpoints, and the filesystem total structural matrix.

### M3B-05: projection batch

- Recompute Delta/payload/command identities, enforce unambiguous
  binding/anchor/descriptor roles, canonicalize all six traffic metrics, retain
  every current same-key chain member while materializing only its final
  candidate, isolate historical work, freeze primary outcomes, and compile order.
- Reject cross-kind, same-key identity/transition conflicts, topology, code,
  station, bridge, and remote output.

### M3B-06: pure dynamic state

- Implement predecessor-verified six-channel reduction, source-health overlay,
  evidence-authorized progress-strict expiry maintenance, tombstones, immutable
  candidate building, exhaustive 21-field entry lowering and ordering/version
  rules, candidate-bounded traffic renewal, dirty sets, applied cursor, both
  root-owned escrows, lease-neutral target-set closure compiler, lineage
  accumulator/floor, and zero-delta advancement.
- Add exact replay/idempotency and plus-one failure evidence.

### M3B-07: ECS and State-First candidates

- Compile the complete stable-ID ECS overlay through the exact pre-projector
  Realm/binding/subject/anchor identity preimage, total sorted operation-kind
  mapping, active/Transform-only tombstone rows, persistent ABA/source/dirty
  projections, scope-independent comparison, exhaustive DynamicStore lowering,
  closed channel precedence, dynamic archetype, and accepted M2 `Transform`/
  `Renderable` V1 codecs.
- Compile one flat stable-ID-sorted semantic-only State-First CPU snapshot using
  the profile-bound accepted adapter codec V1 for position, binding-authored
  bounds/importance, and existing dirty bits; include the exact dirty-ID
  projection, dependency rows for every merged channel/source-generation/expiry
  contributor, global delta order, full/dirty counts, and the 65,536 source-entry
  bound.
- Expose no handles, decisions, renderer state, or GPU objects.

### M3B-08: root, commit, recovery, and disposal

- Implement the self-contained root/closure verifier, separate 24-field
  application, 18-field recovery-attempt, and 18-field selector-retirement-
  attempt journals under one aggregate quota, plus the exact 14-field recovery-
  journal floor, 11-field application/recovery terminal evidence, 21-field
  absence-capable selector-retirement readback, exact idempotency/attempt/
  selector ABA matrices, root-store-
  scoped nonexpiring
  artifact lease, protected prepare/selector-CAS/readback, uncertainty
  reconciliation, healthy retained-root ownership, quarantine, restart replay,
  static fallback, and the commit-port recovery route.
- Complete device catch-up with the 37-field recovery, terminal attempt-record
  binding, 13-field selector-read,
  22-field catch-up, and 15-field closed-to-ready receipts; complete binding
  retirement with the 21-field descriptor, 18-field attempt record, 24-field
  detach receipt, exact 21/25-field binding-transition variants, and 21-field
  quarantine receipt; and
  complete reverse disposal with 15-field candidate settlement, 16-field
  resource snapshots, and the 38-field terminal receipt.
- Preserve root evidence until verified safe release.

### M3B-09: acceptance and rollback

- Run the exact five browser families, independent Python vectors, frozen trace,
  resource/teardown probes, and all prerequisite regressions with zero skips.
- Prove feature-disable rollback leaves the complete accepted M2 static city.

Each implementation piece changes at most its declared flat owners. A failed
piece is disabled through the M3B feature gate; it does not delete or rewrite M2,
M3A, RealmForge, or immutable evidence.

## Planned test layout

```text
tests/virtual-realm/projection/
  m3b-projection-contracts.test.html
  m3b-projection-contracts.main.js
  m3b-projection-contracts.test.js
  m3b-disclosure-projectors.test.html
  m3b-disclosure-projectors.main.js
  m3b-disclosure-projectors.test.js
  m3b-projection-batch.test.html
  m3b-projection-batch.main.js
  m3b-projection-batch.test.js
  m3b-store-application.test.html
  m3b-store-application.main.js
  m3b-store-application.test.js
  m3b-recovery-security-lifecycle.test.html
  m3b-recovery-security-lifecycle.main.js
  m3b-recovery-security-lifecycle.test.js
  fixtures/
    m3b-hostile-vectors-v1.js
    m3b-frozen-trace-v1.js
    m3b-expected-receipt-v1.js
    m3b-reference-descriptor-pack-v1.js

tests/network/
  test_virtual_realm_m3b_vectors.py
  realm/virtual-realm-m3b-vectors-v1.json
  realm/virtual-realm-m3b-reference-descriptor-pack-v1.json
```

The browser pages cover the actual pure-browser modules and trusted test ports.
Python independently recomputes canonical bytes, all IDs/digests, exact field
sets, ordering, limits, roots, and receipts. Importing a Python test file is not
acceptance; it must run through the repository test runner. A skipped case is a
failure.

## Exact 48-case ledger

| Case | Required proof |
| --- | --- |
| `M3B-PROJ-01` | Register the exact separate 16-definition/18-module catalog through its 14-field receipt only after the sole 21-field canonical reference source matrix, derived 17-field descriptor pack, derived 12-field three-import/50-domain/78-carrier registry, derived 18-field/137-reference-row cross-method alias graph, external 14-field pin manifest, catalog release constants, and compiler check agree byte-for-byte; prove every frozen M0-M1C and accepted M2/M3A catalog is unchanged |
| `M3B-PROJ-02` | Verify the exact 57-field profile, 47 numeric ceilings, global work formula, exact side-effect-free 16-field pre-freeze work-count plan and final-build component parity, retained-root aggregate rule, and one aggregate quota shared by the 24/18/18-field application, recovery, and selector-retirement journals; prove the conservative 347,137 independent-ceiling sum without claiming simultaneous attainability, the actual maximum of each exclusive cut kind, formula-only 524,288 acceptance/524,289 rejection, inside-quota three-entry/1,048,576-byte stop reserve, 61-entry/15,728,640-byte ordinary budgets, exact-bound selector chain, plus-one rejection, profile ID, and digest; separately prove current-only authority live-grant count/bytes are context-service bounded and cannot alter durable batch work or identity |
| `M3B-PROJ-03` | Verify every registered and service-local schema against its exact literal format, `version = 1`, ordered field vocabulary, owner, construction preimage, and nested-row domain; require the named source matrix's exact 3/6/9/50/78/87/111/111/108/105/137 counts and 111 direct carrier-admission tuples; regenerate and independently check the 108-source-row expansion-inventory SHA; byte-compare the derived 50-definition/50-extractor/78-authority-rule/78-predicate pack, registry, 137-row cross-method graph, JavaScript mirror, and 14-field pin manifest and reject absent, former-hash, or pin drift; verify the two protected command producer variants, the single adapted presentation-command content contract, its exact ID-free 18-key content preimage, the appended command pair/ID-only-Delta/closure-bytes alias row, the three condition-qualified authority-query selectors, and all DynamicStore-entry/Delta/command transition-base triple selectors and consumer edges in addition to every selector, producer condition, edge, owner, and resolver; independently recompute every record/nested-row/aggregate/direct-edge/alias-edge/pack/registry/graph/pin ID and digest and reject missing, extra, inherited, accessor, symbol, mutable, noncanonical, plus-one, cross-parent-row, generic-carrier, and invalid conditional-presence variants |
| `M3B-PROJ-04` | Verify the exact ten-field manifest, nine ten-field projector rows, embedded 16-field recipe matrix, 53 event rows, 130 primary operation slots, 16 descriptor roles, one separate witness row, exact action-result-before-permission order, conditional traffic descriptor-role closure for storage/process versus IPC/syscall/network, 12/14/15/11/25/53 operation totals, row/count/aggregate/matrix/manifest digests, eight primary owners, maximum seven primary Deltas, and one zero-kind witness |
| `M3B-PROJ-05` | Verify nine disclosure rules and the exact semantic-axis transition policy, closed omission reasons, exact order, recorded-time authority only, and no executable or current-authority field |
| `M3B-PROJ-06` | Accept exactly three M3B dependency keys; verify each exact ten-field descriptor against its own code-shipped method/result-domain rows, verify only the three binding pairs mutually byte-identical, bind every eight-key result to port/method/request context, enforce closed payload unions including canonical receipt bytes where declared and idempotent close evidence, and leave M2's 15-key/M3A's two-key objects unchanged |
| `M3B-PROJ-07` | Verify the exact 53-field logical binding includes the M3 transaction-capability and semantic-policy pairs and excludes all ephemeral presentation/device fields |
| `M3B-PROJ-08` | Reject cross-Realm, operator, lifecycle, bake, layout, static index, policy, catalog, key, capability, or head binding while treating presentation-fence change as a separate fail-closed event |
| `M3B-PROJ-09` | Reject live handles, managers, storage keys, tokens, functions, Promises, errors, DOM, and GPU objects; validate content IDs, semantic IDs, issuer references, registered formats, historical exceptions, every renamed/scalar/one-sided/canonical-byte carrier including condition-qualified authority-query IDs and all transition-base triples, scoped descriptor path, producer mode/status variant, hash-derived direct and cross-method consumer-edge ID, bytes-cross rule, and prebound resolver against the embedded 50/50/78/78 pack, compiled 12-field registry, and separately pinned 137-row alias graph, rejecting same-shaped or unlisted substitutions before allocation |
| `M3B-PROJ-10` | Register only the `projection-root` verifier and prove no M3A definition, checkpoint, edge authority, retention decision, or write method changes |
| `M3B-PROJ-11` | Preserve every included observation ID, digest, and canonical byte sequence exactly |
| `M3B-PROJ-12` | Emit deterministic policy-valid omission rows with no payload bytes and no silent drop; reject structural, audience, rule, and binding mismatches as complete-cut failures |
| `M3B-PROJ-13` | Prove every projector applies the exact semantic-axis transition matrix and never upgrades provenance, evidence, availability, freshness, temporal state, assertion, truth, or authority |
| `M3B-PROJ-14` | Reject malformed rules, unknown reasons, illegal transitions, invalid records, static/authority resolution mismatch, false complete/partial disposition, omitted/extra/reordered subject-resolution row, wrong subject-binding/anchor association, and binding mismatch before any candidate becomes active; distinguish deterministic slot suppression from whole-batch rejection, accept a missing nonfilesystem singleton only as zero-output, and reject ambiguous or malformed binding, role, anchor, descriptor, command, recipe, or prior-state evidence |
| `M3B-PROJ-15` | Verify all 53 M3A-admitted event/terminal recipes and 130 primary slots, exact discriminator fields, event/slot ranges, closed IPC/network lifecycle dispatch, syscall terminal closure, conditional traffic descriptor roles, transition/payload/presentation/source-field/metric rules, output constructors, and zero-output rules; reject authenticated network input, an unknown lifecycle token that emits output, a generic switch, an unlisted recipe/slot, cross-kind output, or output beyond the row's slots |
| `M3B-PROJ-16` | Resolve every authority-domain observation in the batch exactly once before disclosure through the exact kind-owned `payload.authorityReceiptRef` or `payload.authorityReceiptId` query path and bounded canonical recorded evidence/escrow; reject a free digest or field substitution; bootstrap the separate complete current-authority snapshot from the fence snapshot pair, bind only recorded evidence into root closure and currentness only into the fence, enforce accumulated dependency limits, and expose no grant/dispatch capability |
| `M3B-PROJ-17` | Preserve local-only network bytes, derive both route endpoints only from the two distinct local shipped endpoint roles, require every base-M3B IPC/syscall/network route to remain `non-traversable`, prove `peerIdentityRef` cannot enter any route, command, key, closure selector, or diagnostic, and reject every remote-shaped field, authored-corridor claim, or station/bridge/inter-Cityform output |
| `M3B-PROJ-18` | Show historical completion only from a verified recorded-time decision/dispatch/result chain while the adapter's fence-bound current-authority conjunctive mask can only preserve or close a gate; revocation/epoch/expiry invalidates the fence before wake and no stale frame/input remains usable |
| `M3B-PROJ-19` | Prove the witness reads one complete accepted historical primary outcome only, never raw/omitted input or another witness; its one recipe row is outside the 130 primary slots, it consumes a valid zero-primary-output outcome exactly once, and it reuses the exact accepted primary command to emit zero or one audit-only presentation Delta |
| `M3B-PROJ-20` | Prove historical primary deltas remain protected audit closure only; only an emitted witness artifact enters the disjoint disabled-interaction historical presentation store, and neither path affects current keys, ECS, picking, authority, or live State-First slots |
| `M3B-PROJ-21` | Verify exactly three 28-field input-cut variants, exact 13-field versioned source-state snapshots, the four-entry M3A evidence-kind/format/owner/disposition map, mapped tick authority, rejection of unlisted/cross-domain pairs, unchanged idle no-op, evidence-complete `ready`/`source-state-ready` escrow, and strict genesis with empty M3B head, reader `afterBatchSequence = 0`, and verified retained M3A `batchSequence = 1` |
| `M3B-PROJ-22` | Produce exactly one M3B projection batch per M3A observation batch, including a valid zero-delta batch whose six dense operation-count rows are all present and zero |
| `M3B-PROJ-23` | Reproduce byte-identical output for an identical frozen cut, the same verified empty/current prior-state view, the same recipe matrix, and the same reduction-class-partitioned transition bases across worker timing, callback order, map insertion, delivery delay, and segmentation using only verified append, exact M3A state/tick evidence, or the exact due receipt; prove app and trusted prepare independently reconstruct every current sequential `empty`/`retained-entry`/`in-batch-candidate` base and every historical read-only `empty`/`retained-entry` base, with historical work unable to consume or produce an in-batch candidate; prove the pre-freeze work plan and final builders reproduce all 15 component counts and the same sum while current-authority rows, time, cache state, and resolution scheduling never enter durable work or identity |
| `M3B-PROJ-24` | Recompute the frozen M0 `RealmDeltaV1` identity without M3B fields, bind M3 context only in outcomes/batch/root, freeze candidate subject/anchor and stable ID before projector execution, require emitted identity byte equality, order by the canonical tuple, construct current/historical presentation keys through their exact domain-separated hashes, and require six exact operation rows with partition/count/byte equations; group only current-primary writes by semantic key in canonical order, construct and verify each service-local transition base, verify each complete retained-or-empty-to-candidate-to-candidate current chain, keep historical-primary work read-only against the original prior bundle, retain/count every Delta and outcome, reduce only the last current candidate into one store entry/dirty key, and reject duplicate ordinals/Deltas, mismatched transition-base bytes, incompatible projector/identity/anchor, historical-to-current influence, or an illegal chain |
| `M3B-PROJ-25` | Independently verify projection-batch identity and full input, source/retention-state, static, reader/authority escrow, observation, outcome, maintenance/due, floor, and external-evidence closure; require exactly one current-cut canonical read-call-receipt seed whose extractor reaches exactly one reader escrow and its retained/evidence rows, plus zero or more uniquely derived historical carry-forward receipt seeds; every non-current protected M3A batch reached from the cursor or retained-entry producer context must carry exactly one matching historical observation-batch receipt and its extractor/escrow closure; require every presentation command to join exactly one 41-field batch `(presentationCommandIds[i], presentationCommandDigests[i])` pair, one exact pure-compiled or retained-origin protected-closure byte object, and at least one admitted ID-only presentation Delta; missing, multiple, cross-batch, or current-use historical receipts, a pair-only or independently seeded manifest shortcut, conflicting origin outcomes, free Delta bytes, and free, missing, uncited, conflicting, or multiply matched command bytes reject the candidate |
| `M3B-PROJ-26` | Replay the same M3A batch idempotently without advancing state twice |
| `M3B-PROJ-27` | Quarantine the same sequence with differing ID, digest, record bytes, append evidence, authority evidence, or source-state snapshot |
| `M3B-PROJ-28` | Preserve applied cursor/root on gap, stale binding/read, unreassertable source-state evidence, out-of-order input, invalid genesis, or unresolvable retained floor; a valid stale-source transition proceeds only through case 29 |
| `M3B-PROJ-29` | Compile valid source-state and expiry maintenance deterministically; derive every current traffic Delta's expiry as saturating cut tick plus one and every other primary expiry as `"0"`; prove 0-to-1, MAX-minus-1-to-MAX, MAX-to-MAX immediate masking, fresh traffic renewal to a later exact candidate tick, and least-nonzero contributor/least-due selection; atomically update all seven health slots, advance no M3A batch cursor, require M3A-owned due evidence, select only the least finite boundary above the prior frontier and at/below the proven tick, never repeat a boundary, and allow only fail-closed masking/cleanup transitions |
| `M3B-PROJ-30` | Turn filesystem structural change into the exact total structural matrix: all-missing produces one zero-delta `absent-only` row, mixed missing/resolved produces one zero-delta `partial-only` row, resolved removal produces `stale-only`, resolved topology change produces powerless `m3c-review-only`, and ordinary resolved snapshot/create/update without relationships produces no row; reordered/duplicate relationship IDs reproduce byte-identical evidence and no case creates geometry |
| `M3B-PROJ-31` | Derive the static subject request only from included observations; verify the exact 24-field complete/partial static receipt and seven-field subject-resolution rows, count/byte bounds, present binding/anchor/descriptor associations, restart without a live resolver, and present-only protected closure/lease targets; allow a missing nonfilesystem subject only as exact zero-output, let only the filesystem matrix create a missing-subject structural row, and prove no missing subject contributes a Delta, command, resource, anchor, or lease target; reject caller probes, `anchor:root` fallback, fabricated/cross-binding anchor, false status/disposition, missing receipt/object closure, or bake/layout/static-store/projection-index mismatch before acquiring the covering nonexpiring M2 lease |
| `M3B-PROJ-32` | Reject topology, collision, navigation, HLOD, socket, public, code, Genesis, station, bridge, and remote mutation |
| `M3B-PROJ-33` | Verify the exact 16-field current-only prior-state package, exact 22-field head-read receipt with 20/16/20-key empty/current-descriptor/current-complete-base variants, single selector/root-store generation fence, exact canonical-occurrence object/transport-byte accounting including two positions for one unchanged floor anchor and no double-add of the embedded byte subtotal, the exact 262151-entry and 201326592-byte non-closure derived ceilings, and canonical request digest with no work signal; supply the verified empty/current DynamicStore view before any stateful slot is selected; accept entry 262151, byte 536870912, and an exact-maximum closure, then reject plus one, torn or mismatched closure, omitted/extra occurrence accounting, unavailable empty-head M2 baseline with any reason other than `m2-static-baseline-unavailable`, and retained/quarantine aggregate overflow before allocation with no partial result |
| `M3B-PROJ-34` | Run app and trusted prepare through the same neutral semantic kernel over the byte-identical recipe matrix, verified descriptor evidence, verified prior-state view, and independently reconstructed reduction-class-partitioned transition bases, reproduce byte-identical candidates, prove historical work never observes earlier batch work products or affects current output, and leave current state untouched on every injected pure-kernel failure |
| `M3B-PROJ-35` | Verify exactly six DynamicStore channels, current/historical key isolation, the pre-projector Realm/binding/subject/anchor-scoped stable-entity formula, exhaustive Delta-to-all-21-entry-field lowering, exact source provenance/order/generation, entry row ordering and version rules, observation-grounded finite traffic expiry including later fresh renewal and least-nonzero merge, seven-slot effective eligibility, every entry/count/byte/digest, full snapshot accumulator, and dirty key; prove maintenance masking never rewrites/version-bumps entries and cleanup only removes; for an in-batch same-key current chain store only the final source Delta while preserving all chain Deltas in batch/root closure and counting one dirty entry |
| `M3B-PROJ-36` | Materialize the full resulting ECS overlay using scope-independent stored-overlay comparison, active and Transform-only tombstone rows, the total stable-ID-sorted create/update/deactivate/remove mapping, exact persistent ABA versions, exact dirty-ID and source-pair projections, literal component schema V1, empty remove arrays, the one dynamic archetype, domain-separated stable IDs, closed channel precedence, selected shipped descriptor ID/content pair, exact eight-field Engine `Renderable` value, and baked-anchor-equal `Transform`; prove source-health/expiry-only masks emit no per-entity operation and reject ambiguous operation selection, same-precedence conflicts, static mutation, live handles, and unknown components |
| `M3B-PROJ-37` | Keep one flat unique State-First semantic-source array sorted by stable ID with dense entry order and an exact dirty-ID projection; through the profile-bound accepted State-First adapter codec V1, derive position from anchor-locked Transform, bounds/importance from the selected binding's authored metadata, and the exact existing dirty bits; preserve every merged channel/source-generation/expiry contributor in globally ordered bounded dependency rows, with exact full/dirty counts and no representation, visibility, renderer, GPU, authority, duplicate ID, caller bit, or callback field; app and trusted prepare reproduce byte-identical rows |
| `M3B-PROJ-38` | Commit a zero-delta batch as an exact root/cursor/store evidence advance while byte-identical full ECS/State-First results retain their prior generations, including valid generation zero at empty genesis |
| `M3B-PROJ-39` | Verify the exact 42-field empty/present intent variants bind the expected head, candidate closure, deterministic lease-target set, authorized ready-or-recovering fence, target bundle generations, and the exact batch-resolved idempotency-key preimage while correctly containing no not-yet-issued artifact-lease receipt |
| `M3B-PROJ-40` | Publish one complete immutable bundle only after joining its root, identical floor anchor, root-owned M3A evidence escrow, and acquired target-covering M2 lease through the sole durable selector-generation CAS; a failed/OOM in-memory mirror closes dynamic presentation and reconciles without a second outcome |
| `M3B-PROJ-41` | Crash before durable dispatch, prove noncommit from the journal, abandon safely, and change no current selector or state |
| `M3B-PROJ-42` | Crash during/after the selector CAS; enforce the exact application-operation ID, first-row seed, immediate-predecessor chain, 24-field immutable journal construction, acyclic 11-field terminal evidence, omission-safe 33-position application-receipt presence vector and ordered field rows, exact receipt ID/full-digest domains, idempotency/attempt/selector ABA matrix, and reconcile to one committed/conflict/proven-not-committed outcome with retry only after durable noncommit proof |
| `M3B-PROJ-43` | Verify a self-contained root with root-owned canonical M3A/authority escrow and floor bytes, exact lease-target closure, matching root/bundle floor anchor, acquired selected-bundle M2 lease, bounded lineage suffix, and only optional M3A-owner-created checkpoint edges whose five-field inventory rows resolve exact committed-durable M3A checkpoint receipts/checkpoints and one matching original projection-root edge under the fixed owner/resolver map |
| `M3B-PROJ-44` | Fall back to the complete accepted static M2 city on missing, corrupt, incomplete, over-limit, released/invalid/noncovering bundle lease, invalid floor/escrow, or unresolvable projection state |
| `M3B-PROJ-45` | Restore/replay through the exact recovery port and separate 18-field append-only attempt journal; prove the literal 18-kind owner/resolver evidence map, 20-role kind matrix, exact 12-field joined set/ten-field rows/sentinels/counts/bytes, exact 15-field mutation plan/seven-field rows/five closed payload schemas/one-to-three-row dispatch matrix, durable set/plan/phase readback before target calls, one aggregate journal quota, exact operation ID/tail seed/immediate-predecessor one-to-three restart-stable record chain, 14-field terminal-prefix floor/accumulator compaction without protected-evidence loss, pre-admission unavailable on uncompactable exhaustion, no synthetic application fields, and a 37-field receipt bound to its terminal record through the omission-safe 33-position recovery presence vector running through both trailing static-fallback fields plus exact receipt ID/full-digest domains; a third pending attempt remains the same sole operation, binds a service-resolved fallback fence and complete static-fallback evidence, and admits no pre-stop ownership transfer, fourth attempt, or second fallback operation; after device loss persist the deterministic contiguous CPU catch-up receipt only behind a recovering fence, then require retention-head/floor/cursor/source/authority/expiry plus durable selector read, catch-up readback, and one closed-to-ready transition while dynamic stays hidden and static stays visible |
| `M3B-PROJ-46` | Retire empty or present operator/M2/M3A/pseudonym/binding generations through the exact 21-field descriptor and 21/25-field transition-receipt variants, require successor open to prove predecessor retirement, start a separate batch-1 genesis with no mixed identity, and hand bake/layout divergence to M3C |
| `M3B-PROJ-47` | Stop/double-stop in exact reverse ownership order, including exact ordinary occupancy of 61 entries/15,728,640 bytes followed by the maximum three-entry/1,048,576-byte retirement chain and rejection of either ordinary plus-one; inject crashes before selector-retirement dispatch, after CAS before its exact 21-field absence-capable readback, after the 18-field terminal record before the 24-field detach receipt, and during the 21-field quarantine transfer; prove `beginStop` freezes the seven-field resource inventory under its closed 12-kind pair/generation/owner/resolver/lifecycle map and semantic callback/in-flight preimages, every three-family journal tail maps once, terminal retirement evidence proves durable empty or exact competing present state without selected-selector fabrication, the four-state retained-root matrix maps admitted empty/present heads exactly to no-root/with-root healthy or quarantine disposal, detach and quarantine IDs/full digests bind their exact presence vectors, quarantine operation rows bind their selected journal schemas, every before-stop adopted row byte-equals its source tuple/owner and the three stop-derived kinds obey their exact maps, and the dense ten-field adopted inventory has exact count/digest and contains every transferred obligation once; any quarantine trigger transfers the stopped dynamic session all-or-nothing with no simultaneous retained-root or transition receipt, a blocked close issues no terminal evidence, double-stop performs no second CAS, terminal close returns both snapshots plus method-bound port close, extension release, candidate settlement including selected root-store adoption, ECS/State-First detach, healthy retained-owner transition or bounded quarantine, exact empty/present binding transition, and no ABA, evidence rewrite, or post-close mutation |
| `M3B-PROJ-48` | Emit an immutable `48 planned / 48 passed / 0 failed / 0 skipped` receipt and keep every accepted prerequisite regression green |

The page split is exact: cases 01-10 contracts/binding, 11-20 disclosure/
projectors, 21-30 batch, 31-40 store/application, and 41-48 recovery/security/
lifecycle.

## M3B certification gates

These 20 rows must be mirrored byte for byte in the
[Certification Plan](certification-plan.md#m3b-disclosure-and-dynamic-projection-gates).

| Gate | Required proof |
| --- | --- |
| `VR-M3B-001` | The separate import-inert M3B catalog initializes exactly 16 complete definitions through 18 modules and changes no frozen M0-M1C, planned M2, or planned M3A definition, count, order, or registry behavior |
| `VR-M3B-002` | The exact immutable 57-field base profile recomputes its ID/digest, enforces all 47 numeric ceilings including exactly one maintenance outcome per cut plus the capability-derived 262151-entry current-state-read and 201326592-byte complete-base non-closure ceilings, the 347137 conservative independent-ceiling work sum without claiming simultaneous attainability, global work formula, retained-root aggregate rule, and one pool shared by the 24/18/18-field application, recovery, and selector-retirement journals; the transaction capability withholds an inside-quota three-entry/1,048,576-byte stop reserve and caps ordinary occupancy/reservations at 61 entries/15,728,640 bytes, accepts every independent exact bound including maximum teardown after maximum ordinary occupancy, and rejects plus-one, combined-overflow, reserve borrowing, double-charged embedded bytes, or structural variants before candidate allocation |
| `VR-M3B-003` | The exact ten-field manifest embeds one 16-field recipe matrix containing 53 ordered event rows, 130 primary slots with operation totals 12/14/15/11/25/53, 16 descriptor roles with the exact storage/process versus IPC/syscall/network traffic-role split, and one separate witness row; all row/count/aggregate/matrix/manifest digests recompute, nine ten-field projector rows preserve eight primary owners plus one zero-owner witness, no executable callback or new catalog definition is introduced, and the disclosure/semantic-axis policies retain their exact closed rules |
| `VR-M3B-004` | The separate M3B entry accepts exactly three prebound ports; each exact ten-field descriptor matches its own code-shipped port/method/result-domain bytes while only the 53-field binding pairs are mutually byte-identical; every non-descriptor call uses the exact eight-key method/request-bound result envelope and closed payload union; the 14-field catalog receipt binds one embedded 17-field 50/50/78/78 descriptor pack, compiled 12-field three-import/50-domain/78-carrier registry, 87-seed/111-variant/111-direct-edge source expansion, and 108-source/137-reference-row alias graph whose JavaScript/JSON vectors, selector/condition arities, scoped authority-query paths, two command producer variants, appended command alias, all transition-base triples, hash-derived edge IDs, bytes rules, owners, and resolvers recompute independently; unchanged top-level source/reference counts cannot preserve stale nested counts or hash pins; canonical head-descriptor/head-read bytes replace undefined selector-descriptor bytes; the separate 14-field presentation/authority/device fence vocabulary is not logical identity; M2's 15-key and M3A's two-key objects remain unchanged; and no raw continuation, store, ECS, Engine, CSE, renderer, checkpoint, or authority object crosses the app boundary |
| `VR-M3B-005` | The restricted reader supplies one exact next M3A batch or evidence-complete changed source/tick state, byte-identical safe records, exact closed 11-key variants for seven source slots, nested source-generation extraction, 13-field versioned source-state with the closed four-entry M3A evidence-kind/format/owner/disposition map and mapped tick authority, plus 11-field retained-head/floor state and complete bounded escrow-manifest bytes/read receipt; genesis requires empty M3B head plus request sequence 0 and verified retained M3A batch 1, only unchanged idle creates no artifact, reassertion fences stale work, and close releases only unadopted escrow without M3A mutation or ACK authority |
| `VR-M3B-006` | Before disclosure, bounded recorded-authority resolution consumes every structurally valid authority-domain observation in the frozen batch exactly once, selects only the exact kind-owned authority-reference field path, resolves the copied receipt ID to canonical bytes/digest, and returns complete root-owned receipt/signature escrow; disclosure then gives every valid input exactly one `included` or policy-valid `omitted` decision; inclusion preserves M3A identity/digest/bytes, omission has one closed reason/no payload, structural/audience/policy/binding mismatches reject the cut, current authority remains fence-only, and no selection cycle, silent drop, free digest, field substitution, or same-ID rewrite is possible |
| `VR-M3B-007` | Every projector applies the exact semantic-axis transition policy and preserves or downgrades provenance, evidence, availability, freshness, temporal state, and assertion; roots bind recorded-time authority only, while the fence bootstraps one exact complete 13-field current-authority snapshot variant capped for every accumulated gate dependency, synchronously invalidates before revoke/epoch/expiry wake, and lets the trusted adapter only preserve or close a gate, never create truth, capability, authority, or success |
| `VR-M3B-008` | Eight primary projectors exhaustively own the 53 admitted discriminator recipes and 130 primary slots; action-result precedes permission, authenticated network is inadmissible, IPC/network lifecycle strings pass only their closed total mappings, syscall terminal routes close without inventing revocation, traffic roles close exactly over storage/process versus IPC/syscall/network, each observation emits only its exact slots and at most seven primary Deltas, and the separate nonrecursive witness consumes one complete accepted historical primary outcome, including zero output, and emits at most one reused-command audit-only presentation Delta without creating or rewriting a command or affecting current state, ECS, picking, or live State-First |
| `VR-M3B-009` | M3B preserves the frozen M0 `RealmDeltaV1` identity and binds M3 context only in outcomes/batch/root; candidate subject/anchor and stable ID are frozen before projector execution and must match emitted identity; payload identities, the one adapted presentation-command content contract, zero expiry for nontraffic primary Deltas, saturating cut-tick-plus-one expiry for current traffic Deltas, exact M3A tick evidence, per-observation metric canonicalization, operation counts, dirty keys, structural evidence, and global ordering reproduce byte-identically for an identical frozen cut and prior-state view; same-key current output forms one canonical chain over exact `empty`, `retained-entry`, and `in-batch-candidate` transition bases independently rebuilt by app and trusted prepare, historical-primary work uses only independent read-only bases from the original prior bundle and cannot affect that chain, every Delta/outcome remains counted and protected, only the last current candidate becomes the store entry, the dirty key occurs once, and conflicting or illegal chains reject the batch |
| `VR-M3B-010` | Static resolution accepts only the included subject union and may return complete or admissible partial-missing evidence for any kind; a missing nonfilesystem singleton yields only zero-output, filesystem missing uses its exact structural matrix, and every emitted output has one unambiguous returned binding/anchor/role closure; every base-M3B IPC/syscall/network route is non-traversable; dynamic presentation commands resolve through the batch command pairs, pure/trusted compiler equality, and protected closure rather than becoming static records or M2 lease targets; the closure freezes an exact M2 lease-target set without claiming a lease, trusted prepare acquires/read-backs the covering nonexpiring service-only lease before selection, and no path creates an anchor, geometry, road, collision, navigation corridor, HLOD, static ID, or bake mutation |
| `VR-M3B-011` | Exactly three 28-field durable cut kinds exist: one observation-batch cut advances one projection batch and the independent M3A cursor once, while valid source-state/expiry maintenance advances no M3A batch cursor and only fails closed; only current traffic recipes derive finite boundaries from their exact observation pair and saturating cut-tick-plus-one rule, and each new traffic observation may renew only to its exact candidate tick while merged contributors use the least nonzero tick; expiry requires an exact service-issued due receipt grounded exclusively in M3A-owned durable tick evidence, selects the least boundary above the prior frontier and at/below the proven tick, advances the frontier, and never repeats it; zero-delta batches advance exact evidence, duplicates are idempotent, conflicts quarantine, and gaps/out-of-order/invalid-genesis input preserve the prior root/cursor |
| `VR-M3B-012` | The neutral shared semantic kernel is byte-identical in app and trusted prepare; stateful recipe selection consumes the verified empty/current prior-state view through independently reconstructed reduction-class-partitioned service-local transition bases, current same-key chains apply sequentially but materialize only their final entry, historical work never consumes/produces an in-batch base or influences current state, count-only and final reducers reproduce all 15 work components exactly, reducer and candidate-builder ownership stays separate, six channels and current/historical keys remain isolated, and every failure leaves active state unchanged |
| `VR-M3B-013` | The complete resulting ECS overlay uses scope-independent stored-overlay comparison, active and Transform-only tombstone rows, the total stable-ID-sorted create/update/deactivate/remove mapping, exact dirty/source-pair projections and persistent ABA versions, literal component schema V1, empty remove arrays, one dynamic archetype, pre-projector Realm/binding/subject/anchor-scoped stable IDs, exhaustive all-field Delta-to-entry lowering, disabled durable interaction, closed channel precedence, selected shipped descriptor ID/content pair, exact Engine `Renderable` values, baked-anchor-equal `Transform`, zero per-entity operations for source-health/expiry-only masks, and no static/live-handle mutation; the matching State-First record is one flat stable-ID-sorted semantic-source array with dense order and exact dirty-ID projection whose profile-bound accepted codec V1 derives position, binding-authored bounds/importance, and existing dirty bits, while bounded dependency rows preserve every merged channel/source-generation/expiry contributor in global order and no representation, visibility, decision, renderer, GPU, caller bit, callback, or authority field enters |
| `VR-M3B-014` | The exact 42-field intent binds empty/present expected-head variants, candidate closure, deterministic lease-target set, authorized ready-or-recovering fence, and target generations but no unissued lease receipt; trusted prepare adopts both reader/authority escrow and acquires the lease before off-active bundle build; the 24-field application journal, acyclic 11-field terminal evidence, and omission-safe 33-position application-receipt presence/field-row hash preimage enforce one exact receipt plus idempotency/attempt/selector ABA; one durable selector-generation CAS is the sole logical commit; recovering CAS stays hidden; mirror failure closes presentation; and uncertain dispatch reconciles before retry only after durable noncommit proof |
| `VR-M3B-015` | Each 37-field `projection-root` is self-contained and closes exact root-owned input/M3A-retention/recorded-authority/escrow/floor/observation/outcome/store/full-ECS/State-First bytes plus an M2 lease-target set; exactly one current-cut canonical read-call receipt seed reaches its one reader escrow, while every non-current protected M3A batch reached from the cursor or a retained-entry producer context carries exactly one uniquely matching historical observation-batch receipt and its extractor/escrow closure; every presentation command is constructively reached from its 41-field batch pair, exact closure bytes, and admitted ID-only presentation Delta rather than inferred from that Delta alone; historical seeds cannot satisfy current-cut reassertion, pair-only/second-manifest shortcuts and free Delta/command bytes are forbidden, and all carried context is bounded; the selected 27-field bundle binds the identical floor anchor and covering nonexpiring live lease, lineage retention is bounded across every lifecycle owner, M3B creates no checkpoint-link record/M3A write method, and any M3A-owner edge is optional rather than a future retention promise |
| `VR-M3B-016` | Same-binding restart consumes the exact 16-field prior-state package plus canonical 22-field head-read-receipt bytes under one positive selector/root-store generation, joins/verifies the newest root, complete selected bundle, root-owned escrow/floor, covering lease, and durable selector read, and proves exact occurrence/transport accounting before use, including two unchanged floor-anchor positions, no embedded-subtotal double charge, at most 262151 positions, and at most 201326592 non-closure bytes inside the unchanged 536870912-byte read ceiling; it replays only the contiguous M3A tail byte-identically and preserves zero generations; missing/corrupt/torn/over-limit/released-invalid-noncovering-lease/unavailable state activates complete static M2 fallback and never a partial dynamic city; exact-maximum closure bytes remain readable within the larger complete-base ceiling |
| `VR-M3B-017` | Source-state and progress-strict expiry maintenance may only mask, stale, downgrade, detach, deactivate, remove, or clean already ineligible entries and never rewrites or version-bumps an entry merely because its overlay changed; finite expiry exists only for observation-grounded current traffic entries, a fresh traffic observation may renew only to its exact candidate tick, merged contributors use the least nonzero tick, an expiry cut requires durable M3A tick/due evidence and never repeats a frontier, and MAX-tick saturation is immediately masked; current authority is a separate complete fence-only conjunctive mask; and neither path can activate, open, grant, recover, claim completion, rewrite recorded history, create topology, or advance an M3A batch cursor |
| `VR-M3B-018` | Operator/M2/M3A/pseudonym/binding changes use an exact 21-field empty/present transition descriptor and 21/25-field receipt; successor open proves predecessor retirement and requires separate batch-1 genesis; bake/layout divergence hands to M3C; device recovery uses the separate 18-field restart-stable attempt journal with 14-field safe terminal-prefix floor compaction, keeps an exhausted pending operation under the same journal owner with static-fallback evidence and no second operation, commits CPU catch-up only behind a recovering fence, and opens through a 37-field recovery receipt whose omission-safe 33-position hash preimage includes both trailing fallback fields and binds exact terminal/catch-up/selector-read/closed-to-ready evidence; teardown uses a separate 18-field selector-retirement record, exact 21-field absence-capable retirement-readback receipt, 24-field detach receipt with a four-state no-root/with-root ownership matrix, and 21-field quarantine receipt under the shared aggregate quota; their exact receipt hashes, journal-kind operation rows, and dense ten-field adopted-resource inventory/count/digest are constructive; begin-stop freezes trusted inventory and permits exactly one stop-derived retirement operation, blocked close issues no terminal receipt, and stop/double-stop prove one retirement CAS, extension release, candidate settlement including selected root-store adoption, both resource snapshots, ECS/State-First detach, either an internal healthy retained-owner transition or all-or-nothing bounded quarantine with no simultaneous transition receipt, and no ABA/evidence rewrite/post-close mutation |
| `VR-M3B-019` | Ownership stays modular and flat: app peers orchestrate, one neutral import-inert package supplies pure algorithms to app and trusted verifier, trusted/Engine/root-store peers alone resolve/fence/escrow/lease/journal/select/retain, and the three journals remain separate flat peers under one quota; recipe/selection failures collapse only to existing bounded `input-rejected` or `batch-quarantined` diagnostics with integer counts, never descriptor IDs, command bytes, peer fields, or free-form reasons; no M3B peer depends on scanners, renderers, GPU objects, RealmForge execution, remote networking, raw managers, or RF-GE output as live state |
| `VR-M3B-020` | The exact five-page 48-case browser ledger and independent Python vectors pass with zero skips while every then-accepted prerequisite Engine, Virtual Realm, signer, local-operator, and Python regression remains green |

Passing these gates certifies M3B only. It does not certify a rendered living-city
trace, M3C topology transition, M3D Code Matter, M3E Storylets, M3F Genesis,
M3H Operations View integration, M3I handoff/performance, public state,
SecureMesh presence, inter-Cityform roads, or multiplayer. The existing
`VR-LIVE-*` gates remain later integrated evidence.

## Rollback boundary

M3B is additive. Rollback disables its feature gate, stops the independent M3B
entry through the exact disposal order, detaches its dynamic ECS/State-First
source, and leaves the accepted M2 static store, static ECS materialization,
renderer, first-person controller, owner-only Operations View, minimap, camera,
device recovery, M3A ledger/checkpoint, RealmForge artifacts, and frozen
contracts intact.

Verified projection roots and unresolved application, recovery, selector-
retirement, detach, or quarantine evidence remain under bounded protected
retention by their exact journal/session, root-store, or evidenced quarantine
owner until that owner proves safe release.
Rollback does not recursively delete immutable M3A observations, M2 artifacts,
or RealmForge content.

## Approval boundary

Approval to implement M3B requires review of:

- the exact three-port boundary and 53-field binding;
- the separate 16-definition/18-module catalog and 57-field/47-ceiling profile;
- the exact 16-field prior-state package, 22-field head-read receipt, closed
  empty/descriptor/complete-base payloads, canonical receipt bytes, exact
  occurrence/transport accounting, derived current-read ceilings, and single-
  generation read fence;
- the exact registered and service-local format/version registry, closed cross-
  method reference domains, renamed carrier aliases, producer/status edges,
  selector/condition operand matrices, scoped source-authority copy/owner proof,
  bytes-cross rules, and prebound resolvers;
- eight primary owners over nine kinds and the non-owning witness;
- preserve-or-omit disclosure and byte-identity rules;
- delta identity, operation subset, semantic keys, per-observation metric handling, static-anchor
  binding, and structural-evidence-only behavior;
- cursor, six-channel reducer, ECS and State-First candidate schemas;
- candidate root, intent, atomic commit, conflict, uncertainty, and recovery;
- the separate 24/18/18-field application, recovery-attempt, and selector-
  retirement-attempt journal families, their acyclic terminal evidence, and the
  14-field recovery floor plus 21-field absence-capable retirement readback
  under one aggregate quota;
- device, binding, bake, restart, fallback, exact detach/quarantine receipts,
  application/recovery/detach/quarantine presence-safe ID/digest preimages,
  quarantine operation-evidence/resource-inventory rows and aggregates,
  lifecycle, and disposal behavior;
- exact parity of 20 gates and 48 zero-skip cases;
- unchanged accepted M0-M1C and future accepted M2/M3A evidence.

Plan approval does not mean runtime acceptance. M3B implementation must still
land all code, vectors, browser pages, trusted test ports, resource evidence,
and regressions together.

## See also

- [M3A Observation Ingress](m3a-observation-ingress.md)
- [M3 Living City Runtime](m3-living-city-runtime.md)
- [M2 Runtime Foundation](m2-runtime-foundation.md)
- [M2A Runtime Composition](m2a-runtime-composition.md)
- [Engine and ECS M2 Foundation](../../engine/virtual-realm-m2-engine-foundation.md)
- [Architecture and ownership](architecture.md)
- [Contract catalog](contracts.md)
- [Security and privacy](security-privacy.md)
- [Implementation roadmap](implementation-roadmap.md)
- [Certification plan](certification-plan.md)
