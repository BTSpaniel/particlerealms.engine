---
title: Virtual Realm M2A Runtime Composition
description: Exact application-entry, dependency-port, lifecycle, ownership, handoff, and fail-closed acceptance blueprint for the first Virtual Realm runtime slice.
audience: WebGPU OS implementers, Engine integrators, security reviewers, and QA engineers
updated: 2026-10-01
status: M2A accepted; its exact dependency boundary has advanced additively to version 2 with the provider-free M2D-B4F local-operator-policy wire and M2D-B4G terminal compatibility accepted; B4H now has an explicit versioned host-attempt binding prerequisite but remains unaccepted, while the 109-definition M0-M1C catalog remains frozen and integrated M2 remains unaccepted
---

# Virtual Realm M2A Runtime Composition

M2A creates the side-effect-free application and lifecycle boundary that every
later Virtual Realm system must use. It does not load a bake, create an ECS
world, allocate GPU resources, register a State-First source, acquire pointer
lock, or render a city. Its accepted output is one validated composition object
that can safely request the M2B private-bake admission service.

M1C remains the mandatory producer floor. The accepted M0-M1C contract catalog
stays exactly 109 definitions in its current order. M2A adds a separate opt-in
runtime catalog and never appends to
`VIRTUAL_REALM_CONTRACT_DEFINITIONS`. (Sources:
`webgpu-os/apps/the-virtual-realm/contracts/VirtualRealmContractCatalog.js`;
`webgpu-os/apps/realmforge/virtual-realm/RealmForgeBakeEntry.js`.)

## Acceptance boundary

M2A is complete only when all of these are true:

1. WebGPU OS can discover the app through its ordinary manifest and factory
   path.
2. Importing the public module graph performs no boot or external registration.
3. One explicit construction call validates every dependency before acquiring
   a process, lifecycle participant, surface, frame producer, listener, storage
   view, GPU object, audio object, or input resource.
4. One construction abort signal fences the two asynchronous preflight calls.
   Before either call, the optional synchronous host-attempt hook binds that
   construction root plus the distinct live work and teardown roots without
   allocating a lifecycle generation or runtime resource. After operator capture,
   one durable lifecycle generation and the work root fence every subsequent
   session result, while the teardown root remains live only for retirement and
   disposal.
5. The app receives no raw kernel manager, StorageManager, IndexedDB database,
   generic network sender, RealmForge compiler/provider, signing key, or
   evidence store.
6. Stop, failed start, operator switch, device loss, handoff, and double stop
   converge on the same idempotent disposal protocol.
7. The resulting composition may call only the read-only runtime face of the
   M2B admission service. Admission writes and migration remain trusted OS and
   RealmForge operations.

M2A cannot claim that a world is loadable or visible. Those claims begin with
the M2B and later gates.

## Flat ownership rule

`VirtualRealmEntry` is the sole application composition root. Every runtime
module is a peer owned by the entry. A directory name is only a source
namespace; it never grants construction authority. No peer imports, constructs,
starts, stops, or replaces another concrete peer.

```text
VirtualRealmEntry
  -> validates dependency capabilities
  -> creates one lifecycle owner
  -> creates peers through injected factories
  -> passes only immutable values and narrow ports
  -> starts peers in declared order
  -> stops peers in reverse order
```

The prohibited shape is:

```text
renderer -> creates ECS -> opens storage -> constructs verifier -> imports RealmForge
```

The required shape is:

```text
VirtualRealmEntry
  -> engine adapter
  -> lifecycle guard
  -> admission read port
  -> runtime activation port
  -> runtime checkpoint port
  -> runtime handoff port
  -> terminal legacy surface/frame compatibility port
  -> owner-coupled GPU presentation port
  -> telemetry port
```

## Implemented source modules

The first implementation slice adds these source modules. They remain flat
peers even when grouped into source namespaces.

| Module | Sole responsibility |
| --- | --- |
| `manifest.json` | App metadata, least-privilege permissions, one singleton surface, and no network capability |
| `factory.js` | WebGPU OS factory registration and mount/unmount adaptation only |
| `index.js` | Side-effect-free public exports only |
| `VirtualRealmEntry.js` | Exact dependency validation and peer composition |
| `runtime/RealmRuntimeDependencyContract.js` | Exact dependency keys, versions, methods, and forbidden capabilities |
| `runtime/RealmLegacySurfaceFramePort.js` | Accepted B4G terminal implementation of the existing legacy surface/frame slot; no surface, producer, or resource authority |
| `runtime/RealmRuntimeLifecycle.js` | Lifecycle state machine, durable generation/retirement handle, separate work/teardown abort ownership, and start/stop ordering |
| `runtime/RealmOsLifecycleAdapter.js` | Narrow OS lifecycle participant adapter |
| `runtime/RealmProcessOwner.js` | One process/resource owner and generation-bound child ownership |
| `runtime/RealmRuntimeHandoffAdapter.js` | Serializable handoff read/write with no live handles |
| `runtime/RealmRuntimeCheckpointAdapter.js` | Bounded checkpoint read/prepare/commit/retire adaptation with no storage or root capability |
| `security/RealmLifecycleGenerationGuard.js` | Current-generation assertion at every asynchronous boundary |
| `runtime-contracts/VirtualRealmM2RuntimeContractCatalog.js` | Separate opt-in M2 definitions; never mutates the 109-definition catalog |

The `runtime-contracts/` namespace contains exactly 11 completed definitions
at the M2A gate: capability/admission-limit profile, runtime session, private admission index,
static-load receipt, static-store snapshot, ECS materialization receipt, view
transition receipt, device-recovery receipt, disposal receipt, artifact-store
activation receipt, and runtime handoff. It reuses
`VirtualRealmContractRegistry`; there is no duplicate registry class and no
combined 120-definition export. During implementation, a definition enters the
catalog only when its complete schema, semantic validator, minimal fixture,
canonical vector, and owning slice tests land together. Placeholder definitions
are forbidden.

The complete target module graph is exactly 13 modules: one shared primitive
module, 11 independently owned definition modules, and one catalog module.
Catalog order is normative:

```text
webgpu-os/apps/the-virtual-realm/runtime-contracts/
  RealmM2RuntimeContractPrimitives.js
  RealmRuntimeCapabilityProfileContract.js
  RealmRuntimeSessionContract.js
  RealmPrivateBakeAdmissionIndexContract.js
  RealmStaticBakeLoadReceiptContract.js
  RealmStaticStoreSnapshotContract.js
  RealmEcsMaterializationReceiptContract.js
  RealmViewTransitionReceiptContract.js
  RealmDeviceRecoveryReceiptContract.js
  RealmRuntimeDisposalReceiptContract.js
  RealmArtifactStoreActivationReceiptContract.js
  RealmRuntimeHandoffRecordContract.js
  VirtualRealmM2RuntimeContractCatalog.js
```

`VirtualRealmM2RuntimeContractCatalog.js` imports the existing
`VirtualRealmContractRegistry` implementation from the frozen contract package.
It registers definitions in the order above, excluding the primitive and
catalog modules themselves. It cannot modify, re-export, merge with, or
implicitly initialize the 109-definition M0-M1C catalog.

The app-factory and coordinated-frame conventions must reuse the existing OS
registration paths rather than adding an app-specific loader. (Sources:
`webgpu-os/apps/factory.index.js`;
`webgpu-os/kernel/AppRegistrationScope.js`;
`webgpu-os/kernel/Syscalls.js`.)

## Two composition roots

M2 has two trust domains and therefore two composition roots.

| Root | Runs where | Owns | Exposes to the app |
| --- | --- | --- | --- |
| Trusted Realm service root | WebGPU OS kernel/service layer | Operator-scoped artifact storage, publication-root reader, admission writer/head CAS, evidence/signature/M1C verification, guard-private activation clock, secure opaque-ID issuance, runtime-pin lineage, flat `RealmRuntimeActivationService` guarded CSE/pointer/gate/teardown transition, trusted checkpoint-source projection, and checkpoint-to-handoff graph binding | Read-only `bakeAdmissionPort` plus narrow activation/checkpoint/handoff ports |
| Virtual Realm app root | `VirtualRealmEntry` | Runtime lifecycle, Engine adapter, off-active candidate/CSE staging, and view/controller/presentation peers; orchestrates but does not own activation by consuming `runtimeActivationPort@1` | No storage writer, evidence resolver, signing authority, clock authority, pin manager, or active-pointer mutation capability |

This split refines the earlier port list. `publishedBakePort`,
`realmContentPort`, and `packageVerifierPort` are dependencies of the trusted
Realm admission service. They are not handed independently to the application.
They are legacy planning aliases for exactly
`RealmPrivatePublicationHeadPort@1`, `RealmArtifactContentPort@1`, and
`RealmPrivateBakeVerifierPort@1`, respectively; implementation uses only the
exact M2B names and does not register duplicate ports.
The application receives the already-composed `bakeAdmissionPort`, which can
return an exact verified M1C package without exposing the external trust store.

## Exact application dependency object

`VirtualRealmEntry.create()` now accepts exactly the 16-key dependency-version-2
record below and rejects every additional key. This is the additive current
shape; the original M2A acceptance used the narrower version-1 predecessor.

```javascript
VirtualRealmEntry.create({
    dependencyVersion: 2,
    engineAdapterFactory,
    surfaceFramePort,
    gpuPresentationPort,
    resourceTelemetryPort,
    lifecyclePort,
    processOwnerPort,
    runtimeHandoffPort,
    runtimeCheckpointPort,
    bakeAdmissionPort,
    runtimeActivationPort,
    operatorContextPort,
    actionAuthorityPort,
    localOperatorPolicyPort,
    clock,
    logger,
});
```

`runtimeCheckpointPort`, `actionAuthorityPort`, and `localOperatorPolicyPort`
are validated at the application boundary but are not invoked by ordinary
startup. The accepted B4F work hardens the already reserved local-policy slot.
B4G requires the reviewed terminal singleton in the existing `surfaceFramePort`
slot. Neither gate adds a seventeenth key or acquires authority from a global.

### Versioned host-attempt binding

The host-composition lease is outside the application dependency record.
`AppRuntimeCompositionRegistry` preserves the legacy exact frozen two-field
lease and its existing dependency snapshot semantics:

```javascript
{
    dependencies,
    close,
}
```

An explicit version-2 lease is instead the exact frozen four-field record:

```javascript
{
    leaseVersion: 2,
    dependencies,
    attemptBinding,
    close,
}
```

Version 2 neither changes nor appends to the 16-key dependency-v2 object. Its
`attemptBinding` identity is the exact frozen three-field capability
`{ portName: 'realmRuntimeAttemptBinding', version: 1, bindAttempt }`.
`Desktop` forwards that capability separately as
`virtualRealmRuntimeAttemptBinding` for an explicit version-2 or version-3 lease. The application
factory validates that mount-context member and passes it as the optional second
argument to `VirtualRealmEntry`; it never inserts the capability into
`dependencies`. Legacy leases and the legacy one-argument Entry path remain
unchanged. (Sources: `webgpu-os/kernel/AppRuntimeCompositionRegistry.js`;
`webgpu-os/shell/Desktop.js`;
`webgpu-os/apps/the-virtual-realm/factory.js`.)

The trusted host creates one frozen controller with exactly
`{ binding, captureAttempt, close }`; only `binding` crosses into the
application. Entry invokes `bindAttempt()` synchronously once for each fresh
construction attempt, using an exact frozen three-field record containing the
distinct live native `constructionSignal`, `workSignal`, and `teardownSignal`.
The only accepted receipt is the frozen exact record `{ bound: true }`. Binding
happens before `engineAdapterFactory.inspect()`, followed by the operator
snapshot and the existing lifecycle-generation allocation. It does not move or
perform that allocation.

The host-private `captureAttempt()` accepts only an exact request containing the
currently bound construction root and succeeds only while all three roots remain
live. A later attempt must wait until the previous teardown root has actually
aborted and must use three never-before-bound roots. Controller `close()` is a
rendezvous close: it refuses a still-live teardown root and does not abort a
signal, retire a lifecycle generation, release a process owner or resource, or
manufacture teardown. The binding therefore supplies an identity-bound host
attempt rendezvous, not the genuine `lifecyclePort@1`, full lifecycle provider,
process-owner authority, activation authority, or an isolation boundary.
(Sources: `webgpu-os/kernel/realm/RealmRuntimeAttemptBinding.js`;
`webgpu-os/apps/the-virtual-realm/VirtualRealmEntry.js`;
`webgpu-os/apps/the-virtual-realm/runtime/RealmRuntimeValidationPrimitives.js`.)

The separately approved version-3 lease adds a host-only notification channel:

```javascript
{
    leaseVersion: 3,
    dependencies,
    attemptBinding,
    hostLifecycle,
    close,
}
```

This is an exact frozen five-field lease, not dependency version 3. The existing
16 dependencies and `realmRuntimeAttemptBinding@1` are unchanged. The registry
validates and wraps the exact frozen `realmRuntimeHostLifecycle@1` source with
`setSuspended`, `requestClose`, and `notifyDeviceLost`. Desktop retains the
wrapped channel in a module-private WeakMap keyed by the exact process entry;
the channel, retirement controller, and raw source never become mount-context
members, Entry options, dependencies, or `cleanup.app` hooks.

Each source callback must synchronously return exactly frozen
`{ accepted: true }`, acknowledging enqueueing only. The host wrapper returns
an owned Promise and invokes the captured source callback after the calling
stack, with at most 64 pending notifications. It never awaits a provider-returned
Promise or assimilates an arbitrary thenable. Retirement fences dispatch
immediately and settles owned invocation work before retryable raw lease
cleanup. Neither notification acceptance nor transport retirement proves Entry
shutdown, participant delivery, resource cleanup, or a rendered-world pause.
The full protocol, Desktop routes, and remaining participant boundary are in the
[B4H runtime specification](m2-runtime-foundation.md#m2d-b4h-genuine-authority-provider-composition).
(Sources: `webgpu-os/kernel/realm/RealmRuntimeHostLifecycleChannel.js`;
`webgpu-os/kernel/AppRuntimeCompositionRegistry.js`; `webgpu-os/shell/Desktop.js`.)

The genuine participant continuation leaves these lease and app-context shapes
unchanged. `RealmLifecycleParticipantAuthority` privately consumes the genuine
identity source, its stable retained-owner binding, and the original issuer's
payload-free operator invalidation subscription. It accepts the adapter's
existing mutable registration8 and returns exactly frozen
`{ participantId, dispose }`. Its v3-compatible host source queues bounded,
coalesced notifications; ordinary work needs current authority, while terminal
delivery retains the original authenticated owner through work/operator
invalidation. Disposal fences immediately and settles only its own invocation
work, not Entry teardown. This is a participant source, not the full lifecycle
port, full process-owner port, operator-switch drain, or installed provider.
See the [source protocol and ownership boundaries](m2-runtime-foundation.md#m2d-b4h-genuine-authority-provider-composition).
(Sources: `webgpu-os/kernel/realm/RealmLifecycleParticipantAuthority.js`;
`webgpu-os/kernel/realm/RealmProcessOwnerIdentityAuthority.js`;
`webgpu-os/kernel/realm/RealmLifecycleAllocationAuthority.js`.)

`RealmLifecyclePortComposition` now joins these genuine sources behind the
unchanged four-method `realmLifecycle@1` port. Its host-private result is exactly
`{ lifecyclePort, attemptBinding, hostLifecycle, ownerIdentity,
observeRetirement, close }`, not an additional app dependency or runtime lease
version. The guarded `attemptBinding@1` forwarder preserves its existing shape;
the raw v3 host source remains separate. `ownerIdentity` is only a guarded
acquire/authenticate facade, not a full process-owner port or a transferable
genuine identity source.

Composition close fences new app/owner/attempt work, then closes participant,
identity and allocation sources with retryable completed phases. Retirement,
observation, and existing authentic disposal/release handles remain available
for outstanding cleanup. Pending allocation promises are not adopted or hidden.
Synchronous operation guards reject reentrant close before any source closure,
and no source close aborts roots or initiates Entry teardown. Host notifications
remain available until the participant source closes. This accepts source
composition only; it installs no provider and supplies no operator-switch drain,
activation-child ledger, resource cleanup, renderer pause, or visible city.
(Source: `webgpu-os/kernel/realm/RealmLifecyclePortComposition.js`.)

Desktop now adds a separate shell-private operator-transition cleanup owner.
It retains each exact terminal Virtual Realm factory attempt before the
before-mount, composition-open, and factory awaits. The record survives
provisional or forced window removal and is not attached to the app object.
The existing boot-owned `desktop-shell` participant awaits these records in
`Desktop.drainOperator()` before the coordinator activates a replacement
profile. It requests original mount cancellation, waits the mount continuation,
then awaits actual attached factory cleanup and original-request registry
retirement. Host notification acceptance is still not cleanup completion.

`AppRuntimeCompositionRegistry.retireOpen(originalRequest)` privately fences
that exact attempted open, waits pending work, and closes its remaining leases
or quarantined cleanup handles. Rejected pre-admission attempts can retire an
empty obligation; this grants no lease or authority. Failed cleanup stays owned
for retry, including when the process table no longer contains the window.
Ordinary applications retain bounded forced-close behavior. No new lease
version, app dependency, operator participant, or provider registration is added.
This accepts the host cleanup barrier, not a full-provider end-to-end teardown
or physical resource-release proof. See the [B4H protocol and evidence](m2-runtime-foundation.md#m2d-b4h-genuine-authority-provider-composition).
(Sources: `webgpu-os/shell/desktop/RealmOperatorMountDrain.js`;
`webgpu-os/shell/Desktop.js`; `webgpu-os/kernel/AppRuntimeCompositionRegistry.js`;
`webgpu-os/kernel/OperatorContext.js`; `webgpu-os/kernel/KernelBootstrap.js`.)

Piece 9 also supplies a separate host-owned diagnostic source and native
browser/OS adapter. `RealmRuntimeDiagnosticsSource` returns only the unchanged
`clock@1` and `logger@1` facades plus host-only `close()`. Its exact low-level
source records are captured without invoking them at construction. The native
adapter uses browser monotonic milliseconds and the existing OsLogger, with
no new timer, storage owner, provider registration, or app dependency.

The measurement clock rejects invalid/backward samples; its independent uint64
decimal tick is only source-instance-local diagnostic ordering, never activation
time or durable authority. A future provider must establish mount ownership.
The logger admits exactly 21 existing events and thirteen reviewed
scalar mappings before reusing the OS metadata sanitizer. Identities, hashes,
paths, arbitrary text, nested values, raw errors, and caller capabilities are
omitted. Logging contains callback failures and reentry; closure revokes only
these facades, not the shared logger or its persistence queue.

Future provider cleanup must keep diagnostics open until Entry and reverse
source teardown finish, because lifecycle transitions read the clock directly.
This accepts bounded diagnostic sources, not genuine resource telemetry,
authenticated acquisition, full-provider registration, or a visible city.
The flat ten-piece B4H ledger and all sixteen dependency keys remain unchanged.
See the [diagnostic protocol and evidence](m2-runtime-foundation.md#m2d-b4h-genuine-authority-provider-composition).
(Sources: `webgpu-os/kernel/realm/RealmRuntimeDiagnosticsSource.js`;
`webgpu-os/kernel/realm/RealmBrowserRuntimeDiagnosticsSource.js`;
`webgpu-os/kernel/OsLogger.js`.)

The next bounded accounting source lives in `GpuFrameCoordinator`, outside the
application's dependency record. `captureGpuFrameProducerTelemetrySource()`
authenticates an original registration handle through a private, native-pinned
WeakMap and exposes only frozen `{ snapshot, close }`. It reads the exact
original producer, including final callback accounting after unregister. The
legacy handle's own telemetry lookup is also pinned to that record, so it cannot
read a replacement with the same owner/surface names.

The observer separates coordinator callback counters and bounded CPU intervals
from `submissionsReported` and `gpuTimeReportedMs`. Missing timing samples remain
null. It exposes no owner/surface identifiers, raw errors or native capabilities.
Closure affects only that observer, not the producer, coordinator or resources.
An unregistered producer can still be finishing its callback. Neither an
observer receipt nor a zero accounting counter proves physical resource release.

The complete telemetry port still needs genuine Realm-owner attribution and
integration of the implemented original-teardown validator retained independently
of live identity checks.
Entry can release its process owner after telemetry close fails, then retry
telemetry later. Requiring live owner authentication on that retry would strand
cleanup. App-level VRAM estimates and Navi task budgets cannot substitute for
an exact-mount accounting source. See the [piece-9 source map and protocol](m2-runtime-foundation.md#m2d-b4h-genuine-authority-provider-composition).
(Sources: `webgpu-os/kernel/GpuFrameCoordinator.js`;
`webgpu-os/kernel/realm/RealmProcessOwnerIdentityAuthority.js`;
`webgpu-os/apps/the-virtual-realm/VirtualRealmEntry.js`;
`webgpu-os/kernel/VRAMTracker.js`;
`webgpu-os/kernel/navi/NaviResourceService.js`.)

The broker/tracker continuation now provides private exact-mount accounting for
buffers, textures, pipeline creations and shader-cache misses.
`captureGpuOwnerAllocationTelemetrySource()` accepts an original opaque GPU
mount lease and returns a separate frozen `{ snapshot, close }` observer.
Its eleven-field projection distinguishes requested buffer bytes, estimated
texture bytes and creation counters. Surface and other untracked resource
bytes remain null. Nothing is added to the sixteen application dependencies.

The scope is private and does not appear in allocation listings. Existing
app/global quotas and surface reserves remain aggregated. Release does not
destroy accepted resources; old resources remain attributed to their original
mount until supported retirement. Forgetting tracking makes all six numeric
fields unavailable permanently, including across a later same-app mount or
late async completion. Observed tracker/writer replacement also makes the
source unavailable; it cannot silently redirect to a replacement backend.

This is an unmodified standard-tracker seam, not physical VRAM, a native cleanup
certificate or same-origin backend isolation. The separate manager-surface source
now attributes its own reservations; reviewed missing-family sources remain open.
The future provider must still
join the GPU lease and frame source to genuine Realm identity and use the
separate original-teardown validator after owner release. See the [allocation source protocol](m2-runtime-foundation.md#m2d-b4h-genuine-authority-provider-composition).
(Sources: `webgpu-os/kernel/GpuDeviceBroker.js`;
`webgpu-os/kernel/VRAMTracker.js`; `webgpu-os/kernel/SurfaceManager.js`.)

`captureGpuSurfaceAllocationTelemetrySource()` accepts the original kernel
surface view, not the Realm adapter's distinct public receipt. Its separate
five-field projection reports exact-source reservation bytes/count, with nulls
after attribution is forgotten. Normal scoped removal reports retained zero;
replacement, stale resize and recovery rollback cannot steal another surface's
reservation. Device loss retains reservations and is not native-disposal proof.
The six-field kernel view, mount11 and dependency16 remain unchanged; no source
is added to the application dependency record. Compat surfaces remain outside
this source, and genuine Realm/mount joining remains future work.
(Sources: `webgpu-os/kernel/SurfaceManager.js`;
`webgpu-os/kernel/VRAMTracker.js`;
`tests/virtual-realm/m2-gpu-surface-allocation-source.test.js`.)

The kernel-private `RealmLifecycleAllocationAuthority` now owns this binding
and connects it to genuine lazy generation/session issuance. Its exact factory
accepts `{ operatorContext, generationStorageView, appId }`; its exact frozen
source is `{ attemptBinding, allocateGeneration, assertGenerationCurrent,
retireGeneration, observeRetirement, close }`. It uses the existing allocation,
currentness, and retirement requests, including mutable ordinary input records,
without altering the app adapters. Inputs are descriptor snapshots, not live
caller objects. Allocation remains after inspection and operator capture, with
one shared Promise per accepted attempt and fresh roots after a failed attempt
completes teardown. An issued session must also be genuinely retired.

An authentic single-method wrapper routes both direct retirement and the
retirement method through the same genuine session retire/observe/cache step.
This retains terminal evidence before teardown closes without exposing the raw
session. Close refuses pending allocation or unretired authority and requires
actual teardown; it does not abort or certify resource cleanup. A late issued
session that cannot be retired remains cleanup-required. The source deliberately
has no participant method or port discriminator. A genuine full lifecycle port
still needs authentic process-owner registration and real queued OS events;
none of these additions changes the sixteen dependencies or `lifecyclePort@1`.
(Source: `webgpu-os/kernel/realm/RealmLifecycleAllocationAuthority.js`.)

`RealmProcessOwnerIdentityAuthority` adds the next kernel-private prerequisite.
Its exact frozen `{ allocationAuthority }` factory accepts only a genuine
allocation source through a private WeakMap lookup and returns
`{ acquire, authenticate, close }`. Acquisition uses the existing four-field
owner request on the work root. It issues a restart-distinct, authentic private
`{ ownerId, release }` handle, never the six-method process-owner port handle.
Live repeats return the same handle; a claimed allocation cannot mint another
identity even through a separately constructed identity authority.

`authenticate({ appId, ownerId, signal })` joins the private current owner with
its exact work root and actual issued-session liveness. Its returned identity
tuple is a point-in-time observation, not reusable proof. Handle release requires
the original allocation's genuine cached retirement, remains usable after
operator switch/teardown/source close, and performs no storage I/O. Missing
retirement blocks release and identity-source close. No children, participants,
resource cleanup, activation authority, or provider registration is claimed.
The full process-owner port still requires the actual activation-selection
fence and terminal child evidence; the lifecycle port needs real host callbacks.
(Sources: `webgpu-os/kernel/realm/RealmProcessOwnerIdentityAuthority.js`;
`webgpu-os/kernel/realm/RealmLifecycleAllocationAuthority.js`.)

The separate private `captureRealmProcessOwnerTelemetrySource()` prerequisite
accepts only the genuine identity authority. Its frozen `{ capture }` source
consumes Entry's existing exact frozen begin request
`{ appId, ownerId, lifecycleGeneration, signal }` at the original work root.
It returns one stable frozen `{ identity, assertCurrent, assertTeardown }`
binding per live owner. Currentness rechecks the original owner before and after
genuine host checks. Teardown instead authenticates exactly frozen `{ signal }`
against the original live native cleanup root, including after retirement,
operator/work invalidation, owner release or identity-source close. It performs
no storage access or resource cleanup. Aborted or foreign teardown roots fail;
release/close never permits a fresh capture or ordinary work snapshot.

This is a retained cleanup prerequisite, not a telemetry port, aggregate
measurement or selected-Realm/GPU association. The allocation source retains
the validator privately through its original owner binding, with no added field
on any existing source, handle, participant, dependency or lease. The existing
Entry cleanup order and retry path are unchanged. A separate private syscall
bridge now preserves original producer provenance behind the guarded wrapper.
Joining still requires authenticated late attachment and genuine per-owner
attribution within a Desktop mount that can span several owner epochs.
See the [retained binding and source-joining boundaries](m2-runtime-foundation.md#m2d-b4h-genuine-authority-provider-composition).
(Sources: `webgpu-os/kernel/realm/RealmProcessOwnerIdentityAuthority.js`;
`webgpu-os/kernel/Syscalls.js`;
`webgpu-os/kernel/realm/RealmLifecycleAllocationAuthority.js`;
`webgpu-os/apps/the-virtual-realm/VirtualRealmEntry.js`.)

`captureRealmLifecycleCompositionTelemetrySource(composition)` now derives
that retained owner binding through the original lifecycle composition without
exposing its raw identity source. The private lookup accepts the original
six-field composition only, not its `ownerIdentity` facade, copied fields or a
proxy. Its frozen one-method source returns a stable three-field companion
keyed by the original genuine binding. Capture still authenticates each request
before consulting the cache; it never trusts matching labels alone.

Capture, publication and zero-argument currentness share the parent operation
fence, so reentrant close cannot hide an issued result. Closing denies new work
even after a failed close. One-argument teardown checks delegate directly to the
original validator and can succeed during partial close while its native root
remains live. Full composition close requires that root aborted, so subsequent
teardown validation rejects. Source lookup itself remains stable, not live
authority. Construction adds no storage access, subscriptions or source lease.

This does not join GPU dispatch. Future routes, callbacks and asynchronous
results must retain an immutable original owner epoch across B3's reused syscall
facade. Late invalidation must preserve cleanup-bearing results for exact
rollback. Existing GPU release routes must not wait for the later telemetry-close
request; Entry disposes presentation first. A retryable teardown validator is not
proof of retried GPU cleanup. The six composition fields, dependency16 and
v1/v2/v3 channels remain unchanged. See the
[private dispatch-join requirements](m2-runtime-foundation.md#m2d-b4h-genuine-authority-provider-composition).
(Sources: `webgpu-os/kernel/realm/RealmLifecyclePortComposition.js`;
`webgpu-os/kernel/realm/RealmM2RuntimeComposition.js`;
`webgpu-os/kernel/realm/RealmOwnerCoupledGpuPresentationPort.js`;
`webgpu-os/apps/the-virtual-realm/runtime/RealmGpuPresentationPortContract.js`;
`webgpu-os/apps/the-virtual-realm/VirtualRealmEntry.js`.)

`captureRealmOwnerCoupledGpuEpochSource(port)` now provides historical successful
presentation-result provenance for an original stable port and exact original
epoch. Its frozen source1 capture consumes the existing identity3 and returns
`{ identity, assertCurrent, assertResult }`. Currentness ends at release/rebind;
weak method-specific result membership remains historical, even for results
accepted before source capture. Copies, proxies and matching labels do not
prove original result membership. No result object, raw resource or callback is
returned by the assertion, and scalar epoch identity is not genuine ownership.

The controller now guards bind/release/dispose through reflective validation and
publication, and reserves pending forwarding before request reflection. Reentry
cannot overwrite a newer epoch, publish after dispose or release its replacement.
Retirement snapshots its receipt data descriptor before dispatch, avoiding both
malformed accessor invocation and a late caller read that could hide successful
cleanup. Controller5, bind4, release3, presentation9, dependency16 and existing
attempt/v3 wires remain unchanged.

A genuine owner binding must be installed before dispatch and enforced through
ordinary routes and retained callbacks. Joining that owner to historical results
afterward would not prove the owner was authorized at acceptance. No retrospective
joined-owner provider is added. See the [epoch source and temporal join boundary](m2-runtime-foundation.md#m2d-b4h-genuine-authority-provider-composition).
(Sources: `webgpu-os/kernel/realm/RealmOwnerCoupledGpuPresentationPort.js`;
`webgpu-os/kernel/realm/RealmM2RuntimeComposition.js`;
`webgpu-os/apps/the-virtual-realm/runtime/RealmGpuPresentationSyscallAdapter.js`.)

The next integration review found a specific teardown conflict. Entry aborts
work before disposing presentation, but the presenter destroys resources through
ordinary `scheduleJob` with a fresh local signal and retained facade callbacks.
Requiring genuine work currentness there would block cleanup. An operation ID
containing `:teardown` or an arbitrary live signal cannot authorize an exception.

The approved remedy is a separate, versioned, destruction-only GPU channel tied
to the original genuine owner, exact owned resources/generations and original
live teardown root. It must not accept arbitrary scheduling callbacks or grant
allocation, writes, rendering or submission. The inert v1 wire and original
buffer/texture issuer registry are implemented. The later authenticated cohort
endpoint below implements terminal destruction; its private delivery into the
standard adapter and presenter remains open. B3 supplies the separate
opt-in [pre-epoch lifecycle installer](m2-runtime-foundation.md#b3-pre-epoch-lifecycle-installation).
It authenticates original compositions, requires exact lifecycle-port reference
matching and reserves acquisition before one-time acquire4 descriptor capture.
The configured full owner's result must match the genuine owner, operator,
generation and work root before GPU epoch publication. Cleanup-bearing handles
remain available after rejection. No full process-owner service is invented.
At that lifecycle-installer gate, the direct source import grew B3 from48 to88;
Entry106, dependency16 and existing app/lifecycle shapes were unchanged. Its
historical receipts were183/183 across installer32 and five preserved browser
gates, with no failures/skips/blocked cases or console errors, and305/305 in
the exact22-file Python group. These receipts accept pre-epoch authentication and retained
rollback, not a live terminal channel or per-allocation ownership.

The next [prospective original allocation routes](m2-runtime-foundation.md#prospective-original-gpu-allocation-cohorts)
now join that original B3 owner to explicitly used buffer/texture creation.
The generic broker owns per-request attribution before resource inspection;
the separate Realm wrapper supplies its own genuine currentness check. Its
original-only source exposes identity4, historical resource snapshot9 and the
retained original-root teardown validator. Ordinary facade calls, including
recursive calls inside owned allocations, remain outside these cohorts.
This is not standard-adapter integration: the original B3 capture APIs require completed acquisition,
so a host must still bind immutable routes before adapter publication. The host
also must prove that its selected original same-app mount belongs to the full
provider. That allocation-only slice added no terminal execution, ordinary-work
denial or new app wire.
The new40-case browser gate plus seven preserved gates pass259/259 with zero
console errors; the final23-file Python regression passes325/325. Those receipts
accept the explicit prospective routes, not standard renderer integration.
(Sources: `webgpu-os/kernel/GpuDeviceBroker.js`;
`webgpu-os/kernel/realm/RealmGpuAllocationCohort.js`.)

The following [authenticated cohort terminal endpoint](m2-runtime-foundation.md#authenticated-cohort-terminal-destruction)
now supplies the existing frozen Delivery5/Port3 separately from those allocation
routes. It validates Request5 and the original live teardown root on every call,
then visits at most 256 retained original candidates. Successful synchronous
original destruction drains retention once; unavailable and failed operations
remain unresolved for explicit authorized retry. In-flight allocation seals
creation and rejects without a false empty receipt. Abandonment remains 0 without
an authentic loss source. The new endpoint remains unwired into Entry and the
presenter; ordinary cleanup and all existing app wires stay unchanged.
At that endpoint's acceptance, pre-publication integration still needed a
cycle-free original B3 binding and exact association with the configured GPU
facade. The later core split below supplies that prerequisite without importing
the compatibility wrapper back into B3 or patching an escaped facade.
The terminal slice passes **299/299** browser cases across nine gates and
**349/349** Python checks across 24 exact files. New coverage is40 browser and24
Python cases; those counts are included, not additional. These receipts accept
the separate endpoint, not renderer wiring, physical GPU reclamation, the full
provider or M1C production admission.
(Sources: `webgpu-os/kernel/GpuDeviceBroker.js`;
`webgpu-os/kernel/realm/RealmGpuAllocationCohort.js`.)

The [cycle-free pre-bind association](m2-runtime-foundation.md#cycle-free-pre-bind-gpu-allocation-association)
is now implemented. `installRealmM2RuntimeGpuAllocationBinding` authenticates
an exact original B3/mount/facade association before acquisition starts and only
after genuine lifecycle installation. Acquisition prepares a primary cohort from
the original companion through `RealmGpuAllocationCohortCore`, before epoch bind.
The configured device lookup must return the installed facade itself, not matching
labels, and is rechecked against original broker and owner authority. The original
B3 capture APIs require completed acquisition; the later stable-port lookup can
discover a paused source earlier without permitting allocation. The existing factory remains
a compatibility wrapper; B3 imports the core, never that wrapper.

Private Control4 is separate from Cohort3 and from all existing app wires.
Release pauses allocation, resumes only a failed pre-epoch retirement, and closes
irreversibly before source-owner release. Closed owner records drop their cohort
references while caller-held original observation and terminal handles preserve
historical cleanup access. At this slice's acceptance, the association added no
standard owned-allocation routes or presenter terminal transport. Final adapter reflection and every later
effect still require original-owner checks; a momentary device association is not
atomic publication or dispatch authority.

That pre-bind slice passed **339/339** browser cases across ten gates and **373/373**
Python checks across25 exact files. Source closures are broker9/core60/B396/
wrapper97/Entry106. The new40 browser/new24 Python cases are included. Earlier
counts are historical; all frozen dependencies, options, outputs and approved
v1/v2/v3 channels remain unchanged. Full-provider mount provenance, selected-Realm
activation, retryable presenter cleanup, production M1C admission and first-frame
acceptance remain open. Sources: `webgpu-os/kernel/realm/RealmM2RuntimeComposition.js`;
`webgpu-os/kernel/realm/RealmGpuAllocationCohortCore.js`;
`webgpu-os/kernel/GpuDeviceBroker.js`.

The subsequent [standard adapter cohort allocation routing](m2-runtime-foundation.md#standard-adapter-cohort-allocation-routing)
now implements the allocation part. A cached original WorkSource6 retains the
same cohort, historical observation and terminal delivery alongside genuine
work/facade checks. A factory-issued exact10 syscall namespace carries that
association privately into the authentic standard adapter, and opted-in B3 uses
the factory before epoch bind. Only `createBuffer` and `createTexture` route
through the original cohort; ordinary jobs, other methods and destruction retain
their previous behavior. Namespace copies cannot authenticate ownership, and
the exact adapter's selected cohort cannot be replaced by a same-identity sibling.

Raw facade acceptance checks original provenance/currentness after metadata
validation. This does not cover the outer broker's independent cached/after-await
publication boundaries. Valid genuine terminal authorization seals the work
proof, including empty and in-flight cleanup, while historical observation and
authorized retry remain available. Malformed requests or roots denied before
any successful authorization do not newly seal it; a later authorization
failure never reopens an existing seal. Adapter64 and owner-controller65 are recertified expanded
closures; Core60/B396/wrapper97/Entry106 and all existing app wires remain intact.

At the allocation-routing slice's acceptance, the next work was to bind the exact stable port and presenter generation to this
same selected source, privately deliver the original teardown root, and retain
failed or late cleanup handles for explicit retry. No presenter files or terminal
transport changed in this routing slice. All-effect denial follows only after
retry-safe cleanup replaces the ordinary-job path. This does not accept full
provider provenance, production M1C admission, first-frame or native reclamation.
The final browser sweep passes **431/431** across fourteen gates, including the
new32 and preserved legacy adapter18/owner-controller15/presenter27; these are
included totals, not evidence of newly integrated presenter cleanup.
The final exact28-file Python group passes **406/406** in146.72 seconds; prior
373 plus legacy adapter/port9 and new24 are included. Scoped documentation
validation preserves the same flat ledger without shared discovery regeneration.

The [stable presentation-port allocation association](m2-runtime-foundation.md#stable-presentation-port-allocation-association)
now implements the original stable-port/epoch pairing. The exact2
`captureRealmOwnerCoupledGpuAllocationSource(port, epochTelemetry)` lookup
returns the actual selected WorkSource6, or `null` for a genuine legacy pair.
It rejects copied/cross-port tokens and never selects a newer current epoch.
Historical capture remains available after abort, terminal sealing or retirement;
work and teardown retain their separate original checks. The result carries
allocation/terminal capabilities and is host-private, not merely telemetry or
an exclusive presenter claim. Existing epoch `assertResult` remains the receipt
forwarding proof; no global receipt registry is introduced.

Binding checks the selected source's app/owner/canonical lifecycle before
epoch publication, without introducing genuine callbacks after B3's pre-bind
proof. Production changes are limited to the controller and B3's private
publication fence. B3 pauses the primary cohort before epoch bind and resumes
only after `owner.bound` returns, immediately before its callback-free acquisition
completion tail. Early historical discovery returns a paused source, not early
allocation authority. Closed or terminal-sealed cohorts cannot reopen. The
regression reproduced two premature allocations (23/24) before the fix; all24
new cases pass afterward, including normal completed-acquisition allocation and
irreversible early terminal sealing. All app/epoch/terminal wires remain frozen.
Presenter-generation binding, private root delivery and retry-safe
cleanup are still required before all-effect denial. The same ten-piece ledger
and full-provider/physical-frame exclusions remain intact.

Final fixed-source verification passes **455/455** browser cases across fifteen
gates, with zero failures, skips, blocked cases or console errors, and **426/426**
Python checks across exactly29 files in143.87 seconds. These include the prior
431 browser/406 Python cases plus new24/new20, not newly integrated presenter
cleanup. The new browser closure is exactly195 guarded modules; production and
preserved browser closures remain unchanged. First Shard was not scanned.

The [original presenter-generation provenance](m2-runtime-foundation.md#original-presenter-generation-provenance)
prerequisite supplies a separate original-only Source1 and current Token4 with
local Identity2, native/private currentness, exact constructor-port evidence and
historical adopted-receipt membership. It returns no port, receipt, GPU resource
or cleanup authority. A token is minted before startup diagnostics/compilation;
receipt membership follows adoption and an independent callback-free currentness
gate. Retained old tokens never substitute a later generation's evidence.

This changes only the presenter module, reusing its existing resource-owner
import. Public presenter methods and all app/lifecycle wires remain frozen.
It does not reserve a cohort: the next integration needs an issuer-authenticated
pre-start host binding before capability admission. Post-start association alone
cannot establish exclusive renderer ownership. Original terminal delivery and
retry-safe cleanup remain required before ordinary-work denial or full M1C
production integration can be accepted.

Final browser verification passes **487/487** across sixteen gates, including
new32 and all prior455, with no failures, skips, blocked cases or console errors.
The new gate's pre-read-allowlisted closure is197; presenter31 and Entry106 are
unchanged. The actual-owned case proves receipt/epoch/cohort correlation before
controlled surface failure with zero resources, not native rendering. Three
hostile stale-evidence defects were witnessed before the private-currentness
gate fixed them; legacy startup and cleanup behavior remain outside that claim.
Final Python regression passes **446/446** across exactly30 files in157.75 seconds,
with no failures or skips. New20 is added to prior426; existing gates and fixture
files remain unchanged. All source walks preserve the pre-read exclusion guard.

The next [strict startup and fresh-cohort exclusivity proposal](m2-runtime-foundation.md#strict-presenter-startup-and-fresh-cohort-exclusivity-proposal)
is **implemented and verified as a bounded allocation-protection slice**. The approved
[dependency amendment](m2-runtime-foundation.md#implementation-preflight-and-dependency-amendment)
adds original-only issuer verification without weakening authentication or
widening app dependencies. Presenter-first and Controller-first module loading
both pass; the exact intentional module cycle is guarded rather than hidden.
The feature supplies both
an issuer-authenticated startup binding and a fresh-only cohort policy. At most
one original presenter generation may acquire a protected cohort's allocation
route. Reserve inside presenter startup's cleanup boundary before its diagnostic
callback, upload compilation and capability admission. Bind the actual original
port/epoch/source/adapter/request/adopted receipt, not matching labels or a
caller-supplied guard.

The carrier is an opt-in exact-six-field v4 lease, separate from dependency16
and the unchanged v1/v2/v3 wires. Registry, Desktop, factory and Entry preserve
the original opaque binding and existing attempt/lifecycle behaviors. Desktop
now recognizes v3/v4 for lifecycle transport and v2/v3/v4 for attempt forwarding.
The binding is an issuer-registered exact-two-field object with no callbacks;
shape validation alone cannot authenticate it. Registry rejects counterfeit
bindings before creating owned lifecycle wrappers and preserves quarantine/retry.
(Sources: `webgpu-os/kernel/AppRuntimeCompositionRegistry.js`;
`webgpu-os/shell/Desktop.js`; `webgpu-os/apps/the-virtual-realm/factory.js`;
`webgpu-os/apps/the-virtual-realm/VirtualRealmEntry.js`.)

Fresh protected cohorts enforce an opaque original winning route at actual
buffer/texture allocation, including sibling adapters, cached facades and bare
cohort methods. Each private call also binds its actual facade receipt, rejecting
another receipt on the same adapter. No ambient authorized-depth flag can bypass callback reentry
protection. Existing cohorts are not promoted or terminal-probed for emptiness.
Legacy unselected behavior remains unchanged. Claims become sticky before
capability dispatch and survive late results, abort, failed cleanup and disposal;
only issuer-proven pre-dispatch cancellation may release an unused claim.
Successful terminal cleanup permanently seals a cohort, requiring fresh issuance
for later startup. At that startup gate ordinary destruction remained the
presenter's cleanup path. The subsequent
[private terminal cleanup and retry ownership](m2-runtime-foundation.md#private-presenter-terminal-cleanup-and-retry-ownership)
now replaces it for the root-bound protected presenter. This is not full
GPU-effect isolation or full-provider/M1C/visible-city acceptance. Both the Core
factory and B3 protected installer are implemented. Startup verification passed204 distinct
behavioral browser cases, two fresh ESM import-order checks and two40-case
canonical-bundle reruns, plus520 Python checks (new26 and the selected494;
the earlier100 is included). The canonical bundles explicitly account for
the one expected absent-VirtualGPU probe each; they are not full OS builds.
See the linked foundation sections for exact evidence and remaining authority gaps.
Earlier preflight100 and prior487/446 receipts retain their historical scope.

Entry privately passes its own original teardown root beside the startup binding;
the existing host lease6, dependency16, start9, Source1 and Token4 do not grow.
The original controller captures a frozen cleanup1 from its retained historical
attempt's actual adapter, never a replacement epoch or caller-selected source.
Core authenticates the root and exact historical claim on capture and retries.
An unused predecessor returns `not-dispatched` without sealing or draining its
successor. Dispatched ownership remains irreversible and terminal sealing final.

Protected cleanup stops the producer, drains unpublished rollback handles and the
original native resource cohort, then releases the surface, subscription and
receipt. Failed phases reject and retain ownership; explicit stop/dispose retries
do not repeat completed effects. Late handles are retained before stale checks.
The protected broker's private retry policy preserves failed native handles
without adding presentation-wire fields. Device loss supplies no abandonment
authority. Entry retains its lifecycle, telemetry, participant, process owner and
same presenter when GPU cleanup fails, and avoids a second GPU dispose in the
same protected cleanup pass. At that terminal gate, ordinary-work denial and
full-provider integration remained subsequent work, not implied by teardown.
Final terminal verification passes458 browser/bundle executions:288 distinct
behavioral cases, two import checks and168 canonical repeats; new44 include37
presenter and seven genuine Entry teardown cases. The selected35-file Python
sweep passes562/562. Entry evidence covers its real roots/owner with an actual
protected presenter attached for teardown, not the full admission/ECS pipeline.
Exact receipt, test limits and reproduction are in the linked foundation section.

The next [root-enrolled ordinary-work continuation](m2-runtime-foundation.md#root-enrolled-ordinary-work-fencing)
now authenticates the original constructor root plus pre-dispatch terminal capture
before opting a claim into standard-route work checks. Rootless and externally
captured cleanup-only cases preserve their legacy policy. Exact original Core
proof fences facade caches, job/transfer/frame callbacks, nested command access,
and awaited work returns without denying terminal destruction or loss delivery.
Late cleanup-bearing candidates are retained before rejection; the final
Controller check applies only to facade/job/transfer results, not handles whose
cleanup ownership must first reach the Presenter. Public wires and the reviewed
four-member/five-edge authority cycle are unchanged.

The approved [original-cohort native work-view implementation](m2-runtime-foundation.md#original-cohort-native-work-view-implementation)
now carries the original claim into kernel method lookup, cache publication and
nested command/pass operations. It reuses retained original cohort admission for
a separate private WorkView8/Queue3 with exact route, adopted-receipt and
actual-facade binding. The private latch begins only after authentic adoption and
facade capture, not dispatch. The Adapter retains its actual original device
separately. No caller-supplied Realm authorizer, shared-facade policy mutation,
new app dependency or import-cycle amendment was added.

That native-view checkpoint recorded734/734 browser executions across20 gates and605/605 Python
checks across38 exact files. Ordinary90 and both original native-getter probes
pass in source and both canonical import orders. Separate descriptor conversion
failed its separate strict0/1 probe; arbitrary thenable conversion, raw resource children,
mapped memory and physical GPU execution are not certified. Frame-ready authority,
full-provider activation and production M1C-to-visible-city admission also remain
open. The linked evidence records actual source hashes, reproduction and limits.

The approved [protected shader descriptor profile](m2-runtime-foundation.md#protected-shader-descriptor-profile-implementation)
is accepted with its finite input limits, standard-only extension handling
and complete conversion before protected cache hits. Original shared-facade
behavior is preserved. Final verification passes887/887 browser executions across29
gates and625/625 Python checks across39 files, with40/40 affected checks rerun after
final test hardening. Descriptor2, shader-profile42 and genuine-native7 pass in
source and both canonical import orders. The two reviewed wider storage
dependencies are now included in exact test inventories; authority83, Entry155,
B3114 and wrapper115 remain unchanged. Native API/brand evidence is not physical
quiescence or production M1C-to-first-submitted-city-frame acceptance.

The [protected sampler conversion](m2-runtime-foundation.md#protected-sampler-descriptor-conversion)
now implements the explicitly approved installed-native numerical profile.
Like the reviewed Chrome151.0.7922.174, it rejects an out-of-range raw float
before rounding and saturates/truncates anisotropy rather than applying WebIDL
nearest-even rounding. Both previously failing strict native comparisons now
pass. Final bounded acceptance records1175/1175 browser executions across35 gates,
with sampler88/native8 passing in source and both canonical import orders.
Python evidence is644/645 followed by a narrow structural-test correction and
78/78 affected checks, not a fresh green645 run. The final browser invocation
records a transient60s connection allowance after a measured15s transport
timeout; production and runner source remain unchanged by that diagnostic.
No user-agent switch, browser admission rule, new wire or full provider is
introduced. Other-browser parity and visible-city integration remain unaccepted;
the linked evidence preserves historical failures and the exact reproduction.

The subsequent [binding-layout profile](m2-runtime-foundation.md#protected-binding-layout-conversion-review)
is approved: standard-sequence behavior, a4096-entry conversion cap and explicit
`bindingArraySize` rejection, with measured Chromium differences documented.
The complete protected snapshot is accepted in the existing Broker:126 profile
and27 native checks pass in source and both canonical import orders within the
fresh1634/1634 browser matrix;669/669 Python checks also pass. Its shared numeric
helper preserves the accepted sampler profile. The historical diagnostic's eight strict failures and eight
passing current twins remain recorded; they are not relabeled as acceptance.
Durable profile/native tests now supply acceptance evidence; exact receipts,
command reproduction and the documented test-only corrections are linked above.
This remains flat piece9, not a new milestone, full provider or visible-city
acceptance. The [pipeline-layout input review](m2-runtime-foundation.md#protected-pipeline-layout-conversion-review)
now maps nullable native BGL identities and current-standard immediateSize.
Its eight-piece reuse blueprint keeps ordinary forwarding and shader behavior
unchanged. The subsequent CONTINUE approves standard iterator behavior, an
independent4096-layout cap and full immediateSize conversion; the
[pipeline implementation](m2-runtime-foundation.md#approved-pipeline-layout-implementation)
is accepted with1955/1955 browser executions across47 gates and693/693 Python
checks across42 files. Profile43/native64 pass in source and both canonical
orders; all28 original revocation cases prevent native entry, creation and
publication. The historical separate62-case diagnostic has34 passes and28 strict failures:
post-call denial withholds results but still permits native creation after
revocation. The original63-case run and isolated group5 crashed during a
cross-frame/other-device attempt and remain incomplete. Acceptance is limited
to the approved pipeline-input snapshot; the browser crash is not a passing test
or Realm ownership evidence, and full provider composition remains unaccepted.
Separate brand-only and load-awaited same-owner cross-frame controls pass1/1
each; neither resolves the foreign-device crash or changes the proposed policy.

The next composition prerequisite is piece 3's
[protected-head observation and writer-ownership decision](m2-runtime-foundation.md#protected-head-observation-and-writer-ownership-decision).
Existing snapshot reads and post-write storage events cannot supply the live
B4A/B4F subscription guarantees. The user approved the single trusted local
writer owner and bounded client channel. The first
[reservation prerequisite](m2-runtime-foundation.md#single-owner-reservation-prerequisite)
passed118/118 browser cases and45/45 scoped Python checks, but is not an implemented writer barrier
or isolation boundary. The frozen app dependencies remain unchanged; no
production admission or full provider is enabled by this reservation.
The subsequent [cooperative head-write exclusion](m2-runtime-foundation.md#cooperative-head-write-exclusion)
passed151/151 browser cases and60/60 scoped Python checks. It excludes existing managed head
writes while a reservation is held, but adds no owner-authorized write path,
pre-mutation observation barrier, boot-owned lifetime, or client isolation.
The subsequent [admitted owner-operation drain](m2-runtime-foundation.md#admitted-owner-operation-drain)
adds a bounded trusted-kernel helper while preserving the reservation's three
fields. Close waits for admitted callbacks and native request settlement. It
passed 174/174 browser cases and 73/73 scoped Python checks; this does not make operator switching await the
drain or supply a protected write bypass. Those historical gates precede the
bounded owner-write integration; genuine boot binding and coherent live
observation still precede provider composition.

The original owner-write continuation resumed on 2026-09-26. Its
[bounded implementation](m2-runtime-foundation.md#resumed-owner-only-storage-writes-and-pre-mutation-invalidation)
is accepted with 207/207 browser cases and 98/98 scoped Python checks. It adds
owner-created selection/policy views, full write drain and pre-mutation
invalidation, with no provider activation or dependency-record change.
The optional source-city mouse-look proposal is deferred. Low-level observation
tokens do not substitute for the coherent B4A/B4F subscription protocol or
the required protected-backend/client isolation. The next
[attach-before-read observation source](m2-runtime-foundation.md#attach-before-read-coherent-local-head-observation)
is now accepted with 242/242 browser cases and 114/114 Python checks, not as a
new app dependency or optional camera feature. The
[standalone boot lifecycle](m2-runtime-foundation.md#standalone-boot-owned-local-head-lifecycle)
now binds genuine operator ownership and awaits retirement/drain, with an
explicit default-off kernel option. Verification passes 267/267 browser cases
and 135/135 Python checks; KernelBootstrap wiring is inspected as source, not
executed as full OS boot. Hosted opt-in remains rejected without handoff hooks.
The subsequent [one-shot B4A adapter](m2-runtime-foundation.md#one-shot-b4a-operator-context-adapter)
is now implemented on the original boot observation and host attempt. Its first
browser run passes 331/331 including 32 new cases; 198/198 CPU checks pass. It
preserves the exact original coordinator, authentic account partition, retained snapshot and work/teardown
lifetime. No app dependency changes. The subsequent
[retained-cut B4F adapter](m2-runtime-foundation.md#retained-cut-b4f-policy-adapter-and-lifecycle-notifications)
now binds the original verified policy to an actual issued session. Private
session/allocation/composition companions notify direct retirement, disposal and
first admitted composition close before cleanup. Invalidation does not prove
retirement or resource release. The adapter stops before conservative
service-stopped delivery; specific changed-head reasons are not inferred.
Reads retain one result without rereading storage, and subscriptions must match
its exact context and head. Final verification passes398/398 browser and232/232
CPU checks; the earlier transport-failed attempt is retained separately in the
foundation evidence. The subsequent
[Entry subscription connection](m2-runtime-foundation.md#entry-owned-operator-and-policy-subscriptions)
now subscribes B4A before allocation and reads/subscribes the exact B4F head
after genuine allocation but before owner acquisition. Invalidation synchronously
stops ordinary work; private original handles survive late returns and disposal
failures for retry. Startup/stop/cleanup joins publish before callbacks, including
restart validation. Frozen app contracts and dependency16 remain unchanged.
Genuine adapters remain one-shot and need fresh host-owned sources on restart.
The accepted bounded connection passes438/438 browser cases and270/270 Python
checks. The final artifact preserves the earlier transport failures separately;
the local harness adjustment changed no application code or test criteria.
The subsequent [bounded isolated-client channel](m2-runtime-foundation.md#controlled-isolated-client-local-head-channel)
now exposes separate asynchronous read/subscription methods over one original
host-issued native port. It authenticates original B4A/composition/work roots,
retains genuine disposer obligations and fences cancellation/terminal delivery.
Its opaque-origin host denies host DOM/OPFS and HTTP module/fetch access; native
tests cover first-load ordering, later navigation and bootstrap-failure cleanup.
Client exact grammar/context/head checks and lifecycle pinning do not independently
admit policies or recompute canonical digests; host B4F admission remains authoritative.
Browser verification passes471/471, including33 channel cases and all438
previous cases; final Python verification passes289/289.
This does not replace synchronous app ports, alter dependency16 or enable a
provider. Next is flat piece4's runtime-activation owner. Genuine hosted
freeze/resume/rollback, renderer placement and full provider/boot acceptance
remain unresolved. See the linked foundation evidence for the precise
actual-Entry versus controlled downstream-fixture execution boundary.

Original flat piece4 now has a bounded
[original Engine candidate provenance foundation](m2-runtime-foundation.md#original-engine-candidate-provenance).
Private weak registries bind the exact factory-issued adapter/result to original
requests, eligibility port and native work root, plus actual World/slot frames.
Permanent retirement precedes original cleanup and never revives after failed
cleanup retries. Malformed disposal inputs preserve original queued validation;
bounded diagnostics cannot turn optional provenance into a new legacy failure.
The public wires and dependency16 remain byte-exact. Candidate provenance proves
neither genuine admission/eligibility nor process ownership/prepared-CSE authority.
Real ECS and State-First tests use an explicitly controlled eligibility grammar.
Final verification passes504/504 browser cases and310/310 Python checks, including
all prior471/289 cases. Next is genuine admission-to-eligibility binding inside
original piece4, not provider activation or another nested milestone. Hosted
handoff, renderer placement, trusted CSE/clock/pin owners and full boot remain open.

The following [original admission context bridge](m2-runtime-foundation.md#original-admission-operator-context-bridge)
connects M1C's actual mutable context-consumer requests to retained original B4A
and actually issued lifecycle sources. Operation-local native cancellation never
replaces original work-root authority. Both methods return the same original
snapshot; permanent invalidation and shared close joins preserve upstream ownership.
The two-method service port is kernel-private, not a new app dependency or public
B4A wire. Actual admission constructor/context methods use matching protected
storage and explicit rejecting unused dependencies. This proves context integration,
not full verified loading, genuine admission policy/trust, eligibility or activation.
Existing storage shape/scope checks are not universal native-source authentication.
Final verification passes544/544 unique browser cases and338/338 CPU checks,
including all retained504/310 cases; source pins and public wires remain stable.
The subsequent
[original StorageManager service-view provenance](m2-runtime-foundation.md#original-storagemanager-service-view-provenance)
captures only original manager-issued views and exact context/scope/descriptor/root
references. Its lazy listener registration is native-membership checked, its
independent64-source cap affects only proof capture, and cancellation/closure
retires state before callbacks. Legacy binding, constructor and scoped-I/O stay
unchanged. The companion proves original issuance, not authentic boot-context
selection, arbitrary backend behavior, full admission or eligibility.
Final current-workspace acceptance passes580/580 unique browser cases and
372/372 CPU checks, including all retained544/338 cases. Current raw/served
pins match after a fresh rerun preserving a concurrent shared JSON-source change.
The completed
[original admission protected-storage cut binding](m2-runtime-foundation.md#original-admission-protected-storage-cut-binding)
joins that issued view to the original admission context/lifecycle cut with
exact original coordinator, scope, descriptor and work-root references. It
invalidates only its own state/listener and exposes no storage operations.
This does not yet prove boot-selected manager or backend authority.
Final acceptance passes610/610 unique browser cases and410/410 CPU checks,
including all retained580/372 cases. The independent new gate has209 acyclic
modules and30 native cases; the production closure has86 modules. Current raw
and served hashes match; original public contracts and old gate scopes stay fixed.
The stronger
[original boot-bound admission storage lineage](m2-runtime-foundation.md#original-boot-bound-admission-storage-lineage)
is implemented and accepted. Exact historical boot/adapter
Source1 guards add original manager/coordinator/composition provenance while
sharing the legacy lifetime and frozen Handle2/Source4/binding9. This does not
authenticate KernelBootstrap installation, isolated storage or admission results.
That historical checkpoint passes640/640 unique browser cases and445/445 CPU
checks, retaining every610/410 previous case. Exact closures86/209, native
work-root/lifetime fences, frozen public wires and older gate scopes remain
fixed. That checkpoint's378 raw/340 served hashes matched then; historical receipts are preserved.

[Original admission service constructor lineage](m2-runtime-foundation.md#original-admission-service-constructor-lineage)
now separates original completed base construction and thirteen retained
effective references from dependency authority, method integrity, currentness,
public-port provenance and accepted-load proof. This historical Source1 grants
no I/O, load, cleanup or activation capability; old service operations remain
byte-exact after additive reconstruction.
That historical checkpoint passes664/664 unique browser cases across21 gates and479/479
CPU checks across31 literal selectors, including every640/445 retained case.
The new gate has208 acyclic modules/24 cases and34 structural checks. That checkpoint's382
raw/343 served hashes matched then. A zero-case Windows startup-file failure remains
recorded separately; the unchanged-runner retry passes. This does not certify
dependency authority or original accepted-load results.
The subsequent
[original admission read-port issuance companion](m2-runtime-foundation.md#original-admission-read-port-issuance-lineage)
now supplies historical Source1.assertBinding1 linking the original frozen
port4 to its enrolled service. It preserves original arrow names, source text,
dispatch, values, promises and exceptions; writer3 and operation bodies remain
byte-exact. Substituted or altered freeze results preserve legacy behavior but
do not acquire lineage. The same 208-module gate retains 24 cases and adds 16; exact two-stage
raw reconstruction preserves both service checkpoints. Original composition
and actual post-await dependency authority remained separate requirements at that checkpoint.
Final corrected read-port acceptance was 680/680 unique native cases across 21 gates and
491/491 CPU checks across the same 31 selectors, retaining every 664 native/479
CPU semantic case with only three explicit service-pin parameter-ID updates.
All 382 raw/343 served hashes matched that checkpoint's scoped audit; old candidate
receipts, including a concurrent-source rejection, remain historical rather
than additive acceptance. Scope, receipts and exact restoration hashes are
recorded in the linked foundation section.
The subsequent
[original M2 admission composition construction cut](m2-runtime-foundation.md#original-m2-admission-composition-construction-cut)
adds a private historical Source1.assertAdmissionBinding9 for the nine actual raw
inputs supplied to the admission constructor after registry verification.
Original hidden service Source13 checks effective dependencies/defaults and the
read-port Source1 checks that same original service association. Omitted raw
defaults and null contracts remain distinct. Earlier mutable options are not
construction proof; original option reads, getter errors, async assimilation and
freeze substitutions remain legacy. Public result2/read4/Forge4/writer3 and the
sixteen-key app record remain unchanged. This does not authenticate the complete
publication/evidence/provisioning/writer graph or dependency implementations.
The new independent 272-module acyclic gate adds 24 cases, leaving the older
21 inventories fixed. That checkpoint passed 704/704 native cases across 22
gates and 515/515 CPU checks across 32 literal selectors; all earlier 680/491
exact identities remain. All 451 raw/410 served hashes matched its scoped
files. Receipts, exact raw restoration and retained fixture failure history are
in the linked foundation section. The next
[original publication-head constructor and composition cut](m2-runtime-foundation.md#original-publication-head-constructor-and-composition-cut)
is implemented as independent head/composition Source1 guards of five actual
raw inputs, joined to the original hidden head reference through unchanged
admission-source membership and serviceSource13. Original effective coercion,
fallback arrow, inherited inputs and asynchronous outcomes remain legacy;
captured SameValue retains NaN/signed zero without added generation validation.
Existing Source9/public ports are unchanged. That publication-head checkpoint passes
728/728 native cases across 23 gates and 539/539 CPU checks across 33 selectors;
every prior 704/515 case remains unchanged and in order. All 457 raw/413 served
hashes match the read-only audit. Focused verification passes 24/24 native and
48/48 CPU; exact receipts and preservation evidence are in the linked foundation
section. All owned jobs ended normally through the existing shared lock.
The new companions grant no
scope/dependency/method authority, currentness or writer-graph proof. Continue
original piece 4 with remaining dependency authority and peer associations, then original
verified-load results before one-shot eligibility; keep the live provider disabled.

The [original publication bridge and writer composition cut](m2-runtime-foundation.md#original-publication-bridge-and-writer-composition-cut)
adds an independent Source1 guard3 over actual bridge partition/clock/random
inputs, joined to original bridge construction, original writer issuance and
the same original head through unchanged prior membership. Captured own
descriptors retain omitted inputs without inherited getter calls. Original
writer5, public ports, defaults, dynamic dispatch and prior guards remain exact.
That bridge/writer-issuance checkpoint passes 752/752 native cases across 24 gates and
563/563 CPU checks across 34 selectors, retaining all earlier 728/539 case
identities unchanged and in order. All 462 raw/416 served hashes match; the
linked foundation section retains exact receipts and preservation proofs.
Focused checks pass 24/24 native and 72/72 CPU; all owned jobs ended normally.
At that checkpoint, retention by RealmForge/client, evidence/provisioning peers,
dependency authority and original accepted load remained unproved. No live
provider or activation authority is added.

The [original downstream publication writer retention](m2-runtime-foundation.md#original-downstream-publication-writer-retention)
adds private historical publisher/entry/client companions and an independent
same-writer composition join. It retains the actual client input literal and
original private state, without extra option reads, port issuance or await.
Original freeze/map call order, workflows, earlier guards and public wires stay
unchanged. Four complete prior sources reconstruct exactly under independent
review. Acceptance at that retention checkpoint passes 784/784 native cases
across 25 gates and 595/595
CPU checks across 35 selectors, retaining all prior 752/563 identities unchanged
and in exact order. All 467 raw/419 served hashes match; exact receipts and the
client witness repair are in the linked foundation section. All owned jobs ended
normally through the original shared lock. Forge-port issuance,
M1 verifier retention, remaining peers/dependency authority, accepted loading
and activation are not certified at that checkpoint. Keep the live provider disabled.

The [original M1 and Forge consumer associations](m2-runtime-foundation.md#original-m1-and-forge-consumer-associations)
now implement original M1 dependency retention, original Forge-port issuance to
the actual client and an independent original entry/client composition join.
Existing constructor defaults, ignored M1 freeze returns, Forge initializer
arrows, dynamic dispatch, prior companions and public wires remain unchanged.
Both complete prior production sources reconstruct exactly. Final acceptance
passes 808/808 native cases across 26 gates and 619/619 CPU checks across 36
selectors, retaining all prior 784/595 identities unchanged and in exact order.
All 472 raw/422 served hashes match final current files; the linked foundation
section records exact receipts and reproduction. Focused checks pass 24/24 native
and 104/104 CPU. All owned jobs ended normally through the original shared lock.
Historical consumer identity does not certify remaining
peers, dependency implementations, permission, currentness, accepted loading or
activation. No live provider is enabled.

The [original evidence resolver association](m2-runtime-foundation.md#original-evidence-resolver-association)
now implements a private original resolver guard4 and independent actual M1
consumer join. It captures the existing resolver literal once at its unchanged
post-await position, adds no accepted reads or operations and preserves all
earlier companions/public contracts. SameValue retains raw trust/profile NaN
and signed zeros; double validation reads, `.bind` and ignored freeze returns
stay unchanged. Both complete prior sources reconstruct exactly. Final tests
pass 832/832 native cases across 27 gates and 643/643 CPU checks across 37
selectors, retaining every prior 808/619 identity unchanged and in exact order.
All 477 raw/425 served hashes matched that checkpoint's final files. Focused
checks pass 24/24 native and 104/104 CPU. Receipts and the then-planned four-piece
provisioning-service/issued-port/composition connection are in the linked
foundation section. Historical resolver identity is not executed evidence,
dependency authority, currentness, accepted loading or activation. Keep the
live provider disabled.

The [original evidence provisioning argument association](m2-runtime-foundation.md#original-evidence-provisioning-argument-association)
now implements original service guard10, original service-issued port guard1
and independent actual raw constructor-cut guard10. Dense own slots preserve
undefined clock; the service's effective selected clock remains distinct.
Thirteen validation checks, double reads, `.bind`, profile normalization,
ignored constructor-freeze return, original port arrows, post-await positions
and every prior companion/public wire are preserved. Both complete prior raw
production files and prior helper/proof reconstruct exactly. Final acceptance
passes 868/868 native cases across 28 gates and 673/673 CPU checks across 38
selectors, retaining all 832/643 prior identities unchanged and in exact order.
All 482 raw/428 served hashes matched that checkpoint's files; focused checks pass
36/36 native and 110/110 CPU. Jobs ended normally through the original lock.
The linked foundation records receipts, reproduction and the then-planned
coordinator state/wrapper, original issued-port and actual client connection
blueprint. Historical argument
association does not certify coordinator consumption, dependency authority,
currentness, accepted loading or activation. Keep the live provider disabled;
First Shard and preview9018 were untouched.

The [original provisioning coordinator and client connection](m2-runtime-foundation.md#original-provisioning-coordinator-and-client-connection)
now retains actual original state10/wrapper2/wrapper3, issues original port3
and joins it to the actual client5 input. Coordinator guard8 binds non-clock
references while checking selected clock, derived ceiling, actual bind returns
and native stored-state identity privately. Composition guard9 retains actual
own literal inputs; raw omitted clock is neither the selected inherited/default
clock nor a wildcard. The original method/getter/freeze/default/dispatch behavior
and seven previous companions remain intact. Acceptance passes 904/904 native
cases across 29 gates and 703/703 CPU checks across 39 selectors, retaining every
prior 868/673 identity in exact order. All 487 raw/431 served hashes match final
current files; focused checks pass 36/36 native and 108/108 CPU. The linked
foundation records exact receipts, reproduction, the preserved fixture failure
and the mapped next load boundary. This
does not certify dependency implementations, currentness, provisioning execution,
accepted loading or activation; the live provider remains disabled.

The [original selection lease and completed release body](m2-runtime-foundation.md#original-selection-lease-and-completed-release-body)
adds historical constructor guard2, actual issued-lease guard5 and a separate
completed release-body guard5. The public coordinator, lease, admission read
port, six-field load result and app dependencies16 are unchanged. The new
release source records only a catch-free original body after Web Lock request
settlement; it is not evidence that a caller promise or original outer load
fulfilled. Acceptance passes940/940 native cases across30 gates and727/727 CPU
checks across40 selectors, retaining exact904/703 prior prefixes. All492
raw/434 served hashes match the final files; repaired focused native checks
pass36/36. The linked foundation preserves failed fixture receipts and exact
reproduction evidence. That release prerequisite alone does not prove outer
load fulfillment.

The approved [opt-in original completed-load channel](m2-runtime-foundation.md#opt-in-original-completed-load-channel)
now joins one original invocation, the ticket-bound actual normalized result,
genuine issued lease and catch-free release to exact original outer fulfillment.
A separate host-only composition factory retains the original composition
association without extending result2, read4, Forge4 or dependency16. The v2
operation returns P unchanged; its added reaction and rejection-handled effects
are explicit opt-in. The original v1 dynamic dispatch remains unobserved.
Acceptance passes976/976 raw-current native cases across36 gates, preserving
the exact940-case prefix and36 appended identities. CPU751/751 across41
selectors is24 raw-current proofs plus727 preserved checkpoint checks, with
exact order retained and complete three-owner inverse pins. Focused native36/36,
all504 raw/441 served hashes and strict receipt verification pass. The linked
foundation records retained failures, evidence hashes, reproduction and scoped
LOOP compliance. This historical guard8 is not supplied-dependency
authority, fresh currentness, eligibility, provider activation or a city frame.

The [dependency implementation and fresh selection blueprint](m2-runtime-foundation.md#dependency-implementation-and-fresh-selection-blueprint)
records the thirteen actual service inputs and delegated verifier/provisioning
dependencies. The human approved its six-piece build; the two original private
read-only catalog ports are implemented, with private shipped state and stable
original operations, not enrollment of mutable legacy instances. Independent
review found and closed the inherited byteLength buffer escape. Focused CPU24/24
and native24/24 pass with unchanged bindings. Full retained native1000/1000 across
37 gates preserves the exact976-case prefix and24 new tail. All512 raw/445 served
bindings reconcile, and independent receipt review passes. This accepts only the
two private catalog implementations; the original shared lock is released.
Original composition/result2/read4/Forge4/dependency16 remain unchanged. Complete
and verify the other implementation owners before composition
integration, then reacquire the existing native selection fence and full exact
currentness for the separately reviewed one-shot eligibility boundary.

The approved six-piece build is the
[admission native support blueprint](m2-runtime-foundation.md#admission-native-support-blueprint):
an isolated original port for captured native wall-time and sixteen-byte entropy,
with original-only implementation lookup and current-source verification. It is
implemented and bounded-accepted in an isolated owner: current CPU24/24, focused
native24/24 and retained native1024/1024 across38 gates pass. The full run keeps the
exact previous1000-case sequence and all445 prior served-source hashes; two older
raw-only files differ, as recorded in the foundation. It is not installed into
any caller. The diagnostic measurement clock
is not repurposed, legacy defaults stay unchanged, and native wall time does not
establish activation-time trust. Policy storage execution and contract validation
remain separate dependencies; a frozen wrapper or stable lookup does not complete
either. This stays inside original flat piece4 and adds no app dependency.

At that historical support checkpoint, the factory rejected inherited
descriptor-control slots before issuance without invoking their getters. It did
not retrofit the earlier catalog factories or operation-time conversions. The
newly uncovered seam remained open; the historical1000/1024-case receipts did
not cover it. That CPU preservation covered nine old pins and the browser maps
seven, with the two diagnostic owners outside those inventories. The completed
descriptor continuation below closes that specific gap.

The approved [catalog descriptor isolation blueprint](m2-runtime-foundation.md#catalog-descriptor-isolation-blueprint)
is now built and [accepted within its bounded model](m2-runtime-foundation.md#catalog-descriptor-isolation-current-acceptance).
All nine shared helper literals are isolated, including omitted byte-frame
enumerability, with original exports/function metadata/private membership
preserved. Support has only the approved comment correction; its executable
guard is unchanged. Three CPU profiles pass72/72 combined; native execution
passes1034/1034 across39 gates, retaining the exact1024 prefix plus10 new cases.
Eight CPU/six browser owner pins remain unchanged; the helper revision is
classified separately. Full bindings are526 raw/452 served, unchanged during
execution. Historical continuity is qualified509/519 raw and445/449 served:
six approved raw changes plus four outside-slice differences are recorded in
the foundation, not attributed or reverted. This accepts current-bound tests,
not those outside changes or full dependency authority. Remaining implementation
dependencies and fresh selection/currentness still precede one-shot eligibility;
no provider or first in-app city frame is activated.

The approved [four-piece contract catalog lookup build](m2-runtime-foundation.md#admission-contract-catalog-lookup-blueprint)
now has its separate kernel owner and six new verification files implemented.
[Current execution evidence](m2-runtime-foundation.md#admission-contract-catalog-lookup-current-acceptance)
is CPU16/16 and native1046/1046 across40 gates, preserving the exact1034-case
parent prefix plus12 focused cases. All109 shipped names return exact original
definition references. Thirteen CPU owner pins remain unchanged; focused/full
native bind10/11 of them, with absent owners recorded explicitly. All526 parent
raw and452 parent served bindings match; only seven raw/four served files are
added. The final audit passed and canonical acceptance/session memory are saved;
all four approved pieces are complete.
The one-operation original lookup port is not installed into this composition
and does not seal the original validators, storage, selection or currentness.
Those remaining implementation boundaries precede one-shot eligibility inside
original piece4; app dependency16 and provider/city-frame acceptance stay unchanged.

The separate contract freezes Port3 with one `destroyOwnedResources` method,
Identity4, Delivery5, Request5 and aggregate Receipt11. It validates native signal
branding/liveness, exact expected identity and BigInt count conservation, with
distinct `destroyed`, `abandoned` and `cleanup-pending` states. Validation does not
authenticate the original root, port, resource ownership or destruction evidence.
No supplied operation is invoked and no new port is installed. See the
[terminal cleanup v1 contract](m2-runtime-foundation.md#terminal-cleanup-v1-inert-contract).
(Source: `webgpu-os/apps/the-virtual-realm/runtime/RealmGpuTerminalCleanupContract.js`.)

The [original-resource issuer registry](m2-runtime-foundation.md#original-resource-issuer-registry)
captures buffer/texture identity and the original destructor before post-call
checks, rejects duplicate adoption, and retains unresolved rollback candidates.
Its source authenticates an exact original mount/facade pair and returns only
seven scalar observation fields. It exposes no destruction or enrollment API.
Neither that original mount nor a normal observed destructor return proves Realm
lifecycle ownership, terminal completion or physical GPU reclamation.
The new registry and three focused regressions passed 140/140 browser cases,
with 74/74 scoped Python checks; these do not accept the unfinished terminal
channel or per-allocation Realm ownership binding. The later B3 installer
authenticates a prospective owner epoch, not a resource cohort or every GPU effect.
(Source: `webgpu-os/kernel/GpuDeviceBroker.js`.)

The [pre-dispatch integration review](m2-runtime-foundation.md#pre-dispatch-integration-review-terminal-gpu-contract-decision)
maps the eight existing source groups and acceptance order. The existing
dependency16, attempt binding, v1/v2/v3 lifecycle channels and ten-piece roadmap
remain unchanged. Do not enable ordinary-work denial before original terminal
destruction is usable. The new inert contract passed 36/36 browser cases with no
console errors; its scoped six-file Python group passed 66/66, including 18 new
contract checks. These results do not certify future live-channel operations.
(Sources: `webgpu-os/apps/the-virtual-realm/VirtualRealmEntry.js`;
`webgpu-os/apps/the-virtual-realm/rendering/RealmStaticGpuPresenter.js`;
`webgpu-os/apps/the-virtual-realm/rendering/RealmStaticGpuResourceOwner.js`;
`webgpu-os/kernel/realm/RealmM2RuntimeComposition.js`.)

`captureGuardedGpuFrameProducerTelemetrySource(wrapper)` is a kernel-private
lookup over the original guarded five-method frame wrapper. It creates a fresh
existing coordinator observer for its original handle; it does not add a method
to the wrapper or a key to the app dependencies. Captures are independent and
retain historical original-record observation through unregister/replacement.
Copied/proxied wrappers reject without reflection. Custom unsupported handles
remain registration-compatible but cannot supply genuine frame accounting.
The original coordinator capture still accepts only its original handles.

Registration now fences lifecycle after GPU-consumer marking, before wrapper
publication, and attempts original-handle rollback on reentrant invalidation.
The bridge grants neither execution authority nor ownership of a selected Realm,
process epoch, surface or mount. It does not install a telemetry port or solve
late attachment. See the [guarded-frame provenance protocol](m2-runtime-foundation.md#m2d-b4h-genuine-authority-provider-composition).
(Sources: `webgpu-os/kernel/Syscalls.js`;
`webgpu-os/kernel/GpuFrameCoordinator.js`.)

The focused bridge gate passes 32/32; the fresh browser regression group passes
125/125 and the exact seven-file Python group passes 99/99. A served-only removal
of the private association causes 22 expected failures; the unchanged production
source then passes 32/32 again. The
[runtime evidence and remaining ownership boundaries](m2-runtime-foundation.md#m2d-b4h-genuine-authority-provider-composition)
distinguish this provenance prerequisite from full telemetry and first-frame
acceptance. First Shard was not scanned and no existing dependency wire changed.

`assertRealmGpuPresentationSurfaceProvenance(receipt, kernelView)` now verifies
historical pairing at the adapter boundary. The trusted caller supplies both
original objects; success returns `undefined`, never a raw view or observer.
Private weak pair membership adds no strong receipt-to-canvas retention. Copies,
proxies and wrong originals fail fixed frozen errors without reflective reads.
All existing presentation port and receipt shapes remain unchanged.

Historical pairing is independent of outer-broker acceptance, liveness,
exclusive ownership and accounting support. It can survive release or rejected
acquisition rollback. The separate kernel source must still authenticate the
view's genuine accounting, and the future provider must prove exact owner/epoch
attachment. See the [surface provenance and private-join boundaries](m2-runtime-foundation.md#m2d-b4h-genuine-authority-provider-composition).
(Sources: `webgpu-os/apps/the-virtual-realm/runtime/RealmGpuPresentationSyscallAdapter.js`;
`webgpu-os/apps/the-virtual-realm/runtime/RealmGpuPresentationPortContract.js`;
`webgpu-os/kernel/SurfaceManager.js`.)

Surface-pair verification passes 28/28 new browser cases and 206/206 distinct
final browser cases including the related adapter, broker, epoch, composition,
surface-accounting and guarded-frame regressions. The exact seven-file Python
group passes 86/86, including sixteen new checks. Adapter14/broker13,
Entry106/B3-48 and dependency16 remain unchanged; the new browser closure is
exact25 with zero skipped modules. These checks do not accept full telemetry,
B4H, physical GPU presentation or deterministic garbage collection.
(Sources: `tests/virtual-realm/m2-surface-receipt-provenance.test.js`;
`tests/virtual-realm/test_m2db4h_surface_receipt_provenance.py`.)

Removing pair publication only from a served copy produces 22 expected failures
and 6 passes. Unmodified production passes 28/28 again; the bounded helper exits
with all26 served file hashes unchanged on disk. This negative control does not
certify full owner attachment or disposal.

### Common port rules

Every injected port:

- is a plain frozen object or an explicitly branded capability object;
- declares `portName` and positive integer `version`;
- exposes exactly the methods listed below;
- rejects unknown option keys;
- accepts an `AbortSignal` on every asynchronous operation;
- accepts the construction abort signal during preflight; after operator capture
  and lifecycle-generation allocation, ordinary work operations check both the
  current operator and lifecycle generation before dispatch and after every
  await;
- returns deeply frozen plain data or an explicitly owned disposable handle;
- never returns native file handles, keys, tokens, raw GPU managers, sockets,
  mutable stores, functions inside records, or cross-operator paths.

The terminal B4G compatibility port admits no request and performs no
asynchronous operation. Its two synchronous methods ignore every argument,
including signals and callbacks; they return only the fixed terminal result
specified in [the surface/frame compatibility contract](#surfaceframeport1).
Its configuration-free factory rejects any supplied argument without inspecting
that argument. These rules do not relax validation for any operational port.

There are exactly two asynchronous pre-generation calls. The optional
synchronous `bindAttempt()` hook precedes both and performs no allocation.
`engineAdapterFactory.inspect()` is pure, operator-independent capability
inspection and checks only the construction abort signal.
`operatorContextPort.snapshot()` establishes the initial operator binding, so it
checks the construction signal plus its own snapshot consistency after await.
Every subsequent asynchronous call uses the captured operator
identity/generation and allocated lifecycle generation.
Teardown-only `retireGeneration()`, `abortCandidate()`, `abortCheckpoint()`,
active-bundle `close()`, and their owned cleanup calls are the sole current-
generation exceptions: they
accept only the separately prebound live teardown signal, require the same
captured owner/operator/generation identities, and require the lifecycle state
to be `retiring` or `retired` where applicable. They can finish cleanup after
the work root aborts, but cannot acquire, activate, publish, or rebind work.

### `operatorContextPort@1`

```javascript
snapshot({ signal })
// -> {
//      operatorIdentity,
//      operatorPartitionId,
//      operatorGeneration,
//      localRealmId,
//      authorityEpoch,
//      policyEpoch
//    }

subscribe({ listener, signal })
// -> { dispose() }

assertCurrent({ operatorIdentity, operatorGeneration, signal })
// -> same frozen context snapshot
```

The opaque `operatorPartitionId` is storage binding material. It is not a
filesystem path, public identity, or join key for telemetry.

### `processOwnerPort@1`

```javascript
acquire({ appId, operatorIdentity, lifecycleGeneration, signal })
// -> {
//      ownerId,
//      registerChild({ childId, childKind, initialOwnershipRole, dispose }),
//      transferChild({
//        childId,
//        expectedChildKind,
//        expectedOwnershipRole,
//        nextChildKind,
//        nextOwnershipRole,
//        transferReceiptSlot
//      }),
//      unregisterChild({ childId, terminalReceiptDigest }),
//      snapshotChildren({ childKinds }),
//      release({ reason })
//    }
```

`registerChild()` returns `{ childId, childKind, ownershipRole,
childRegistrationReceiptDigest }`. `transferChild()` atomically compares and
changes the registered kind and ownership role, returning `{ childId,
previousChildKind, nextChildKind, previousOwnershipRole, nextOwnershipRole,
transferReceiptDigest }` by filling the caller's prebound receipt slot without
allocation or yield; a mismatched `expectedChildKind` is a no-effect
failure, as is a mismatched `expectedOwnershipRole`. `unregisterChild()` returns
`{ childId, unregistered: true, childCountAfter,
childUnregistrationReceiptDigest }` only after the child's exact terminal
receipt is bound. `snapshotChildren()` returns one frozen generation-bound
ledger sorted by `(childKind, childId)` and accepts only the exact allowlisted
kinds requested by its owning trusted service. Activation cleanup kinds are
exactly `activation-staged`, `activation-current`,
`activation-handoff-displaced`, and `activation-superseded`; a displaced child
remains registered only to its predecessor owner. The returned owner rejects
duplicate child IDs, stale generations, unknown child kinds/roles, transfer or
snapshot after release, unregistration without terminal evidence, and
non-idempotent disposal.

An activation child is registered only as
`(activation-staged, candidate-owned)`. The only kind/role transfers are the
atomic tuples `(activation-staged, candidate-owned) -> (activation-current,
active-owned)`, `(activation-current, active-owned) ->
`(activation-superseded, disposal-owned)`, and `(activation-current,
active-owned) -> (activation-handoff-displaced,
predecessor-retained-owned)`. A current child may remain current while its own
lifecycle-close fence and disposal complete; a handoff-displaced or superseded
child retains that terminal cleanup kind through fence/resource disposal and
unregistration. No caller may change only one half of a tuple, transfer a child
between process owners, reverse a transition, or use unregister/register as a
transition substitute.

The activation service is the only caller allowed to register, transfer, or
unregister an activation-kind child, and each such ledger mutation holds the
same per-operator/Realm activation-selection fence used by visible commit. At
offer/selection it preallocates each `transferReceiptSlot` and irreversibly binds
that slot to the owner, lifecycle, child, expected tuple, and next tuple. While
the fence is held, the process-owner child observation and the matching tuple
transfer are one non-preemptible authority interval: no lifecycle callback,
abort, replacement, close, shutdown, or foreign session may mutate either bound
child between the immediate pre-CSE tuple assertion and its post-CSE transfer.
Final unregister reacquires that fence after terminal disposal evidence exists.

`RealmProcessOwnerChildUnregistrationReceiptV1` has exactly `format`, `version`,
`ownerId`, `lifecycleGeneration`, `childId`, `childKind`, `ownershipRole`,
`terminalReceiptDigest`, `childCountAfter`, `unregistered = true`, and
`receiptDigest`; only `receiptDigest` is excluded from its
`particle-realms.realm-process-owner-child-unregistration-receipt` version-1
self digest. It contains no dispose callback or child handle.

### `lifecyclePort@1`

```javascript
allocateGeneration({ appId, operatorIdentity, operatorGeneration, signal })
// -> { lifecycleGeneration, retirementHandle }

assertGenerationCurrent({
    appId,
    operatorIdentity,
    operatorGeneration,
    lifecycleGeneration,
    signal,
})
// -> { lifecycleGeneration, current: true }

registerParticipant({
    appId,
    ownerId,
    onSuspend,
    onResume,
    onClose,
    onOperatorChange,
    onDeviceLost,
    signal,
})
// -> { participantId, dispose() }

retireGeneration({
    retirementHandle,
    reason,
    signal,
})
// -> { lifecycleGeneration, retired: true,
//      lifecycleRetirementReceiptDigest }
```

Callbacks enqueue lifecycle intents. They do not perform re-entrant teardown
inside the OS callback. `allocateGeneration()` owns one durable, strictly
increasing uint64 decimal-text counter per `(operatorIdentity, appId)` inside
the OS lifecycle authority. It survives application and browser-process
restart; an interrupted allocation may leave a harmless gap but can never
reuse a value. `retirementHandle` is a non-serializable, single-generation,
single-method OS capability; it cannot allocate, inspect another operator, or
enter a handoff/public state. `retireGeneration()` is idempotent for that exact
generation and can finish after an operator switch without rebinding a general
operator capability. Its receipt digest authoritatively proves only that the
named generation is retired. The caller's `reason` remains a requested audit
label and cannot become trusted cause evidence.
The counter's durability does not imply a persisted retirement ledger or
rehydratable capability. A genuine process-local owner may retain terminal
observations only while its issued handles exist. After process loss, missing
observations remain unavailable; a high-water counter or caller-supplied digest
cannot prove retirement or permit durable activation/pin cleanup. Such recovery
requires the separate owning protocols. A newer same-account/app allocation
does not globally revoke every older live session: verified handoff may activate
a successor before retiring its predecessor. Retirement ends ordinary generation
authority; it does not certify that subsequent resource cleanup has completed.
The digest identifies receipt content; it is not a signature or an independent
grant. Consumers require the genuine bound owner's observation, not a copied
or independently recomputed digest string.
Every later ordinary-work asynchronous completion checks the local work abort
root and `assertGenerationCurrent()` before externally visible mutation. The
teardown-only exceptions above instead verify the exact bound retirement state
and live teardown root before and after each await. The app never constructs a
generation from a clock or in-memory counter.

### `runtimeHandoffPort@1`

```javascript
read({ operatorIdentity, localRealmId, maximumBytes, signal })
// -> exactly one of:
//    {
//      status: 'missing',
//      observedHandoffGeneration: '0',
//      exactStorageSha256: null
//    }
//    {
//      status: 'record',
//      observedHandoffGeneration,
//      exactStorageSha256,
//      record: RealmRuntimeHandoffRecordV1
//    }
//    {
//      status: 'cleared',
//      observedHandoffGeneration,
//      exactStorageSha256,
//      tombstoneDigest
//    }
//    {
//      status: 'invalid',
//      reasonCode
//    }
//    {
//      status: 'unavailable',
//      reasonCode
//    }

write({
    operatorIdentity,
    localRealmId,
    recordDraft,
    checkpointHandoffAuthorizationId,
    expectedHeadBinding,
    signal,
})
// -> {
//      status: 'written',
//      written: true,
//      handoffGeneration,
//      handoffRootReferenceId,
//      exactStorageSha256,
//      recordDigest,
//      checkpointBindingDigest
//    }
//  | {
//      status: 'predecessor',
//      written: false,
//      observedHandoffGeneration,
//      exactStorageSha256
//    }
//  | { status: 'unavailable', reasonCode }
//  | { status: 'invalid', reasonCode }

clear({ operatorIdentity, localRealmId, expectedHeadBinding, signal })
// -> {
//      status: 'cleared',
//      cleared: true,
//      handoffGeneration,
//      clearedRootReferenceId,
//      exactStorageSha256,
//      tombstoneDigest
//    }
//  | {
//      status: 'already-clear',
//      cleared: false,
//      observedHandoffGeneration,
//      exactStorageSha256,
//      tombstoneDigest?
//    }
//  | {
//      status: 'predecessor',
//      cleared: false,
//      observedHandoffGeneration,
//      exactStorageSha256
//    }
//  | { status: 'unavailable', reasonCode }
//  | { status: 'invalid', reasonCode }
```

`RealmRuntimeHandoffRecordV1` is the exact closed record below:

```text
format = particle-realms.realm-runtime-handoff-record
version = 1
operatorIdentity
localRealmId
handoffGeneration
previousHandoffStorageSha256?
handoffRootReferenceId
handoffManagerOperationId
processOwnerId
lifecycleGeneration
publicationHeadBinding
admissionHeadBinding
runtimeCapabilityProfileId
runtimeCapabilityProfileDigest
runtimeBundleId
checkpointBinding
safeAnchorId
operationsViewRequested
localPolicyId
localPolicyDigest
logicalCursorId?
recordDigest
```

`recordDraft` is exactly `{ operationsViewRequested }`. The trusted handoff
manager derives operator/Realm scope from the method arguments and injects every
head, profile, owner/lifecycle, bundle, checkpoint, anchor/cursor, and policy
field from the claimed checkpoint binding. The caller therefore cannot author
restoration authority. It must separately pass the process-local
`checkpointHandoffAuthorizationId` returned by a successful checkpoint commit.
The authorization is not a record field and can never be serialized, copied
into a handoff, omitted, or replaced by a caller-authored checkpoint ID.

For every write, that authorization is required and the trusted manager injects one exact
closed `RealmRuntimeCheckpointBindingV1`:

```text
format = particle-realms.realm-runtime-checkpoint-binding
version = 1
checkpointId
checkpointGeneration
checkpointHeadStorageSha256
checkpointRecordDigest
processOwnerId
lifecycleGeneration
admissionIndexDigest
publicationHeadBinding
admissionHeadBinding
runtimeCapabilityProfileId
runtimeCapabilityProfileDigest
runtimeBundleId
visiblePointerGeneration
liveVisibilityReceiptDigest
checkpointSourceProjectionDigest
checkpointSourceAuthorizationDigest
safeAnchorId
logicalCursorId?
localPolicyId
localPolicyDigest
bindingDigest
```

`bindingDigest` uses `computeRealmContentId()` with the displayed format/domain,
major version `1`, and only `bindingDigest` excluded. The checkpoint service
creates the binding only after exact head proposal readback and active-root
readiness. `processOwnerId`, `lifecycleGeneration`, and
`checkpointSourceAuthorizationDigest` come from the exact trusted checkpoint
record and cannot be supplied by the app. The handoff manager receives only the service-only
`runtimeCheckpointHandoffBindingPort@1`, never the checkpoint manager. Its exact
surface is:

```javascript
claimAuthorization({
    checkpointHandoffAuthorizationId,
    handoffManagerOperationId,
    handoffRootReferenceId,
    signal,
})
// -> { status: 'claimed', claimReceiptDigest,
//      checkpointBinding, checkpointGraphEdge }
//  | { status: 'invalid', reasonCode }
//  | { status: 'unavailable', reasonCode: 'manager-authority-unresolved' }

verifyBinding({
    checkpointBinding,
    checkpointGraphEdge,
    handoffRootReferenceId,
    handoffActiveRootStorageSha256,
    signal,
})
// -> { status: 'verified', checkpointBindingDigest,
//      checkpointGraphEdgeDigest }
//  | { status: 'invalid', reasonCode: 'checkpoint-binding-invalid' }
//  | { status: 'unavailable', reasonCode: 'manager-authority-unresolved' }

settleAuthorization({
    checkpointHandoffAuthorizationId,
    claimReceiptDigest,
    outcome,
    observedHandoffHeadStorageSha256,
    signal,
})
// -> { status: 'consumed' | 'restored' | 'recovery-pending',
//      settlementReceiptDigest }
//  | { status: 'not-found', reasonCode: 'authorization-missing' }
//  | { status: 'unavailable',
//      reasonCode: 'manager-authority-unresolved' }

releaseEdge({
    checkpointBindingDigest,
    checkpointGraphEdgeDigest,
    handoffRootReferenceId,
    handoffReleasedRootStorageSha256,
    signal,
})
// -> { status: 'released', edgeReleaseReceiptDigest }
//  | { status: 'predecessor', edgeReleaseReceiptDigest }
//  | { status: 'not-found', reasonCode: 'edge-missing' }
//  | { status: 'unavailable', reasonCode: 'manager-authority-unresolved' }
```

`outcome` is exactly `proposal`, `predecessor`, `nonpublication`, or
`uncertain`; the returned status must respectively be `consumed`, `restored`,
`restored`, or `recovery-pending`.
`consumed` means the authorization cannot be reused while its protected edge
remains active; it does not release the checkpoint root.
`observedHandoffHeadStorageSha256` is the exact proposal/predecessor observation
for the first two outcomes and is null only for `nonpublication` or `uncertain`.
`nonpublication` is legal only after the exact claim-bound handoff manager
operation proves that no head dispatch occurred, its prepared root has reached
the exact abandoned readback, and its manager-nonpublication receipt has been
read back; it is not a caller cancellation assertion. Claim failure
reasons are exactly `authorization-missing`, `authorization-used`,
`foreign-owner`, `foreign-realm`, `stale-lifecycle`, `binding-mismatch`, or
`checkpoint-root-unready`. This port cannot read, prepare, commit, retire, list,
or release a checkpoint.

The flat `RealmRuntimeHandoffOutcomeObserver` owns the exact internal
`runtimeHandoffOutcomeObservationPort@1` surface:

```javascript
observeOutcome({
    handoffManagerOperationId,
    handoffRootReferenceId,
    handoffExpectedHeadBindingDigest,
    checkpointGraphEdgeDigest,
    signal,
})
// -> { status: 'proposal', observedHandoffHeadStorageSha256,
//      proposedHandoffRecordStorageSha256 }
//  | { status: 'predecessor', observedHandoffHeadStorageSha256,
//      managerNonPublicationReceiptDigest, abandonedRootStorageSha256 }
//  | { status: 'nonpublication', managerNonPublicationReceiptDigest,
//      abandonedRootStorageSha256 }
//  | { status: 'unavailable',
//      reasonCode: 'manager-authority-unresolved' }
```

The observer receives only bounded stat/read faces for the fixed handoff manager
journal, its root-manager journal/root, and protected handoff head. It requires
the operation/root/expected-head/edge fields to equal that recovered journal.
`proposal` requires the head's exact storage SHA to equal the journal's complete
proposed manager-record SHA; `predecessor` requires a read-back dispatch marker,
the exact journal-captured predecessor binding, the root-manager journal at
`abandoned`, and matching manager-nonpublication and abandoned-root readbacks.
`nonpublication` requires
the dispatch marker authoritatively absent, the handoff head still equal to the
exact captured predecessor, the root-manager journal at `abandoned`, and exact
matching manager-nonpublication and abandoned-root readbacks. A merely missing
or not-yet-dispatched operation without that complete terminal evidence, a third
value, malformed state, or contradiction is unavailable.
It exposes no record bytes and cannot write, allocate, settle, or release.

`settleAuthorization()` never trusts the requested outcome. It independently
reconciles the exact proposal/predecessor bytes bound by the claim through one
service-only `runtimeHandoffOutcomeObservationPort@1`. That read-only port takes
the claimed handoff manager operation/root and edge digest, recovers the matching
fixed handoff manager journal, and compares its exact predecessor/proposal bytes
with the protected handoff head; it cannot write a head, root, journal, or cell.
The claimed cell and claim receipt bind the journal's exact expected-head
binding digest, so no caller-supplied outcome or SHA can substitute a third
value. A failure after claim but before head dispatch remains owned by the
handoff manager: recovery deterministically completes any claim-bound planned
root to the exact prepared form, drives that root through nonpublication and
abandonment, then uses the observer's complete `nonpublication` proof to move
`claimed -> issued`. It cannot strand the cell or restore it from absence alone.
A first
uncertain observation moves `claimed -> recovering` and returns one retained
`recovery-pending` receipt. Recovery calls the same method with the same
authorization and `claimReceiptDigest`: verified proposal moves
`recovering -> consumed-edge-active`, verified predecessor moves
`recovering -> issued`, verified terminal nonpublication moves
`claimed|recovering -> issued`, and continued uncertainty returns the
byte-identical retained receipt without advancing a sequence. No other call may leave
`recovering`, and a conflicting replay returns
`manager-authority-unresolved` without mutation.

The claimed internal `RealmRuntimeCheckpointGraphEdgeV1` has exactly `format`,
`version`, `operatorPartitionId`, `realmId`, `handoffManagerOperationId`,
`handoffRootReferenceId`, `checkpointRootReferenceId`,
`checkpointActiveRootStorageSha256`, `checkpointManagerOperationId`,
`checkpointHeadStorageSha256`, `checkpointRecordDigest`,
`checkpointBindingDigest`, and `edgeDigest`. Its format/domain is
`particle-realms.realm-runtime-checkpoint-graph-edge`, version `1`, and only
`edgeDigest` is excluded. It is kernel-private and never crosses an app port.

`claimReceiptDigest` names exact internal
`RealmRuntimeCheckpointHandoffClaimReceiptV1` fields `format`, `version`,
`operatorPartitionId`, `realmId`, `processOwnerId`, `lifecycleGeneration`,
`checkpointHandoffAuthorizationId`, `handoffManagerOperationId`,
`handoffRootReferenceId`, `checkpointBindingDigest`,
`checkpointGraphEdgeDigest`, `handoffExpectedHeadBindingDigest`,
`authorizationCellIndex`, `authorizationCellGeneration`,
`authorizationState = claimed`, `claimSequence`,
and `receiptDigest`. `settlementReceiptDigest` analogously names exact
`RealmRuntimeCheckpointHandoffSettlementReceiptV1` fields `format`, `version`,
the same operator/Realm/authorization/claim identities, `outcome`,
`authorizationState = consumed-edge-active | issued | recovering`, optional
`observedHandoffHeadStorageSha256`, optional
`managerNonPublicationReceiptDigest`, optional `abandonedRootStorageSha256`, the
same authorization cell identity,
`settlementSequence`, and `receiptDigest`.
Their respective domains are
`particle-realms.realm-runtime-checkpoint-handoff-claim-receipt` and
`particle-realms.realm-runtime-checkpoint-handoff-settlement-receipt`, version
`1`; only each `receiptDigest` is excluded. Sequences are positive durable
cell-local uint64 decimal text persisted in the exact authorization cell, never
wall time or cross-cell chronology.
For `outcome = proposal`, state is `consumed-edge-active`, the observed-head SHA
is required, and both nonpublication fields are forbidden. For `predecessor`,
state is `issued`, and the observed-head SHA plus manager-nonpublication/
abandoned-root pair are all required. For `nonpublication`, state is `issued`,
the observed-head
SHA is absent, and the manager-nonpublication/abandoned-root pair is required.
For `uncertain`, state is `recovering` and all three observation-proof fields are
absent. No mixed variant is valid.

`edgeReleaseReceiptDigest` names exact internal
`RealmRuntimeCheckpointHandoffEdgeReleaseReceiptV1` fields `format`, `version`,
`operatorPartitionId`, `realmId`, `checkpointBindingDigest`,
`checkpointGraphEdgeDigest`, `handoffRootReferenceId`,
`handoffReleasedRootStorageSha256`, `edgeState = released`, `releaseSequence`,
`authorizationCellIndex`, `authorizationCellGeneration`, and `receiptDigest`.
Its domain is
`particle-realms.realm-runtime-checkpoint-handoff-edge-release-receipt`, version
`1`, excluding only `receiptDigest`. It can be filled only after exact handoff-
root release readback. Exact replay while the cell remains `edge-released`
returns `predecessor` with the same digest; after safe vacancy/reuse it returns
`not-found` without a digest or allocation.

The checkpoint manager retains at most two fixed authorization/edge cells: one
for the current checkpoint and, during exact replacement, one predecessor edge-
retention cell. Each has exact edges
`issued -> claimed -> consumed-edge-active -> edge-released`,
`claimed -> issued` on proven predecessor or terminal nonpublication, and
`claimed -> recovering` on
uncertainty, followed only by `recovering -> consumed-edge-active` on proven
proposal or `recovering -> issued` on proven predecessor or terminal
nonpublication. Recovery observes
only the exact handoff proposal/predecessor bytes named by the claim and then
completes the corresponding edge. Consumed, evicted, or arbitrary IDs cannot allocate a cell
or claim again; a later checkpoint preparation invalidates an unclaimed older
authorization only after its cell is settled. Retirement of the checkpoint root
named by `consumed-edge-active` must refuse. One exact successor checkpoint may
be prepared in the free current cell while the predecessor edge remains active;
a third cell fails `checkpoint-edge-capacity`. Only `releaseEdge()` after the
old handoff root's exact released SHA removes that predecessor retention edge.
These are durable two-slot state machines, not process-local maps: restart reads
both fixed cells, validates every nested receipt/journal/root/head binding, and
resumes only the displayed transition. A malformed or contradictory cell makes
the binding port unavailable and blocks checkpoint retirement, handoff
publication, and collection rather than reconstructing authority from IDs.

The handoff root must retain the exact checkpoint graph edge before its own head
CAS. The binding's admission, publication, profile, owner/lifecycle, bundle,
anchor, cursor, and policy fields must equal the handoff record's corresponding
fields. Exact
handoff proposal consumes the authorization once. Exact predecessor performs no
handoff publication and returns the claim to its original issued state only
after exact manager-nonpublication and abandoned-root readback for the
unselected handoff root; a third or uncertain result freezes the
claim for manager recovery. A missing, reused, foreign-owner, foreign-Realm,
stale-lifecycle, mismatched, unready, or caller-fabricated authorization fails
before handoff-head mutation. Missing authorization is invalid; M2 has no
unbound or caller-authored handoff-record variant.
`expectedHeadBinding` has exactly
`handoffGeneration` and nullable `exactStorageSha256`. Generation zero with a
null SHA is legal only for an authoritatively missing never-initialized head;
every other generation is positive and requires the exact current storage SHA.

Clear never deletes the authority file. It writes
`RealmRuntimeHandoffTombstoneV1` with exactly:

```text
format = particle-realms.realm-runtime-handoff-tombstone
version = 1
operatorIdentity
localRealmId
handoffGeneration
previousHandoffStorageSha256
clearedRecordDigest
clearedRootReferenceId
clearedManagerOperationId
clearedAt
tombstoneDigest
```

`tombstoneDigest` uses `computeRealmContentId()` with the displayed
format/domain, major version `1`, and only `tombstoneDigest` excluded. A clear
against missing or the exact current tombstone is an idempotent no-effect and
returns `already-clear` with its current generation/binding; only clearing an
exact current record writes the next tombstone and returns `cleared`. Exact
predecessor returns `predecessor`. A third/malformed observation returns the
closed `unavailable` or `invalid` variant and never fabricates a clear.

The two admission head bindings use the exact nested shapes returned by
`bakeAdmissionPort.readHead()`. Generations are positive uint64 decimal text;
all IDs are nonempty control-free UTF-8 strings of at most 256 bytes;
`operationsViewRequested` is Boolean. `recordDigest` is produced by
`computeRealmContentId()` with domain and format
`particle-realms.realm-runtime-handoff-record`, major version `1`, and only
`recordDigest` excluded from the canonical payload. Unknown keys, alternate
encodings, and live values fail closed.

The handoff adapter owns the generation allocator. A successful write or clear
sets `handoffGeneration` to exactly `expected + 1`, copies the expected storage
SHA into `previousHandoffStorageSha256`, performs one exact predecessor CAS,
and reads back the exact record or tombstone. Generation one alone omits the
record's previous SHA. A CAS/readback uncertainty is reconciled only by
observing the exact predecessor or exact generated proposal; a third value is
unresolved. Neither process restart nor clear can reset or reuse a generation,
and malformed current authority blocks mutation rather than falling back to
generation zero.

The frozen base profile declares `maximumRuntimeHandoffBytes = 65536`.
`read()` receives exactly that value, and the adapter must stat/cap the record
before reading or allocating it. `invalid.reasonCode` is exactly `oversized`,
`future-version`, `malformed`, `live-value`, `digest-invalid`, or
`checkpoint-binding-invalid`, in that precedence order. A `record` result proves strict canonical JSON, the exact
closed V1 shape, `observedHandoffGeneration = record.handoffGeneration`, the
record digest, and the SHA-256 of the exact storage bytes. A `cleared` result
proves the same properties for the tombstone and preserves its durable
generation/SHA as the next writer's predecessor. `unavailable.reasonCode` is
exactly `root-recovery-pending` or `manager-authority-unresolved`. The trusted
handoff manager may return `record` only after it has recovered the matching
owner-manager journal, verified the exact `handoffRootReferenceId`, and observed
that root as `active`; record publication without that root proof returns
`unavailable` and exposes no record fields. The app repeats the
shape and digest checks because an injected test or future port implementation
is not trusted merely for carrying the right brand. The record may carry only the serializable
bindings listed above. It cannot carry an ECS handle, GPU slot, surface,
listener, controller, worker, storage object, function, key, or capability
token.

### `bakeAdmissionPort@1`

The app receives only the read face:

```javascript
readHead({
    operatorIdentity,
    localRealmId,
    runtimeCapabilityProfileId,
    runtimeCapabilityProfileDigest,
    signal,
})
// -> exactly one of:
//    { status: 'missing' }
//    {
//      status: 'migration-required',
//      reasonCode: 'manifest-only-publication',
//      publicationRootId
//    }
//    {
//      status: 'unavailable',
//      reasonCode,
//      recoverable
//    }
//    {
//      status: 'accepted',
//      publicationHeadBinding: {
//        publicationRootId,
//        publicationHeadGeneration,
//        publicationHeadStorageSha256
//      },
//      admissionHeadBinding: {
//        admissionIndexDigest,
//        admissionHeadGeneration,
//        admissionHeadStorageSha256
//      }
//    }

loadVerifiedPrivateBake({
    operatorIdentity,
    localRealmId,
    expectedPublicationHeadBinding,
    expectedAdmissionHeadBinding,
    runtimeCapabilityProfile,
    maximumBytes,
    signal,
})
// -> {
//      status: 'accepted',
//      admissionIndex,
//      verifiedPackage,
//      sanitizedVerificationSummary,
//      publicationHeadBinding: {
//        publicationRootId,
//        publicationHeadGeneration,
//        publicationHeadStorageSha256
//      },
//      admissionHeadBinding: {
//        admissionIndexDigest,
//        admissionHeadGeneration,
//        admissionHeadStorageSha256
//      }
//    }
//  | {
//      status: 'unavailable',
//      reasonCode,
//      recoverable
//    }
```

`unavailable.reasonCode` is exactly one of `corrupt-head`,
`missing-artifact`, `stale-publication`, `current-policy-rejected`,
`current-trust-rejected`, `runtime-profile-incompatible`,
`runtime-profile-too-large`, `unresolved-intent`, or `service-unavailable`.
Every status variant is an exact closed object: fields shown only on another
variant are forbidden.

`verifiedPackage` is the exact frozen 17-key M1C private-v2 object. The port
performs package/evidence/signature verification inside the trusted service.
It does not return signature envelopes, reviewed authoring evidence, policy
resolver handles, storage locations, or verification keys.

The two binding records are exact closed sanitized projections, not raw M1 or
M2 storage-head records. They exclude operator partition, operation identity,
blob IDs, previous-head SHA, timestamp, path, lock receipt, and native handle.

The two expected bindings passed to `loadVerifiedPrivateBake()` are copied
unchanged from one `accepted` `readHead()` result. The service requires both
complete bindings to remain current before its first graph read and again under
the selection fence immediately before returning. An admission-index digest
alone is insufficient because the same immutable index can be selected at a
later head generation.

Both profile fields come from the already validated
`engineAdapterFactory.inspect()` result. The service compares them with the
selected index before returning `accepted`; an incompatible or oversized
selection returns `runtime-profile-incompatible` or
`runtime-profile-too-large`, respectively. The later load call must carry the
same exact profile ID/digest/object and cannot widen or replace the profile used
by `readHead()`.

### Exact `RealmRuntimeCapabilityProfileV1`

The base profile is one complete closed contract, not only an ID plus a loose
limit fragment:

```text
format = particle-realms.realm-runtime-capability-profile
version = 1
runtimeCapabilityProfileId = runtime-capability:virtual-realm-m2-base-v1
engineApiVersion = 1
realmEngineAdapterPortName = realmEngineAdapter
realmEngineAdapterVersion = 1
activeBakeCsePortName = activeBakeCse
activeBakeCsePortVersion = 1
ecsWorldApiVersion = 1
stateFirstSourceApiVersion = 1
surfaceFrameApiVersion = 1
staticRendererApiVersion = 1
firstPersonControllerApiVersion = 1
numericProfileId = numeric:realm-runtime-f64-state-f32-gpu-v1
canonicalEncodingProfileId = canonicalization:realm-bake-json-v1
supportedFeatureIds
requiredAdapterMethodIds
requiredActiveBakeCseMethodIds
limits
runtimeCapabilityProfileDigest
```

`supportedFeatureIds` is exactly this code-point-sorted array:

```text
collision-navigation-static-v1
cse-active-bake-prepared-commit-v2
ecs-staged-materialization-v1
first-person-local-traversal-v1
local-operations-owner-view-v1
state-first-stable-id-projection-v1
webgpu-static-scene-v1
```

`requiredAdapterMethodIds` is exactly this code-point-sorted array:

```text
createCandidateWorld
createCollisionNavigation
createFirstPersonController
createLocalOperationsView
createRenderBundle
createStateFirstProjection
disposeCandidate
materializeStaticBake
prepareActiveBakeCommit
recoverDeviceResources
snapshotResourceLedger
```

`requiredActiveBakeCseMethodIds` is exactly this code-point-sorted array:

```text
commitPreparedSwap
discardPrepared
```

`limits` is one exact closed object:

```text
maximumStaticEntities                         = 65536
maximumPresentationSlots                     = 65536
maximumCollisionBindings                     = 65536
maximumNavigationBindings                    = 65536
maximumAudioEmitters                         = 4096
maximumLocalOperationsZones                  = 4096
maximumAdmissionPackagePayloadBytes          = 16777216
maximumAdmissionCanonicalNodes               = 100000
maximumAdmissionArrayItems                   = 100000
maximumAdmissionDepth                        = 64
maximumAdmissionStringBytes                  = 1048576
maximumAdmissionResourceBindings             = 65536
maximumAdmissionAuthoringEvidenceBindings    = 4098
maximumAdmissionSignatureBindings            = 5
maximumAdmissionSignatureRoleBindings        = 5
maximumAdmissionEvidenceReviewerBindings     = 256
maximumAdmissionInventoryChunkEntries        = 256
maximumAdmissionInventoryChunks              = 257
maximumAdmissionInventoryChunkBytes          = 16777216
maximumAdmissionInventoryChunkNodes          = 100000
maximumAdmissionArtifactPayloadBytes         = 16777216
maximumAdmissionGraphPayloadBytes            = 134217728
maximumRuntimeHandoffBytes                   = 65536
maximumPendingAdmissionIntents                = 64
maximumAdmissionPendingSlotBytes              = 4096
maximumAdmissionPendingSlotAggregateBytes     = 262144
maximumAdmissionControlRecordBytes            = 1048576
maximumAdmissionFixedControlAggregateBytes    = 335544320
maximumAdmissionTerminalAuditEntries          = 64
maximumAdmissionTerminalAuditBytes            = 8192
maximumAdmissionTerminalAuditAggregateBytes   = 524288
maximumRealmTrustKeyBindings                   = 1024
maximumAdmissionRootDirectoryEntries           = 1048576
maximumAdmissionRootDirectoryPageEntries       = 256
maximumAdmissionRootDirectoryPages             = 4096
maximumAdmissionRootDirectoryHeadBytes         = 16777216
maximumAdmissionArtifactDirectoryEntries       = 1048576
maximumAdmissionArtifactDirectoryPageEntries   = 256
maximumAdmissionArtifactDirectoryPages         = 4096
maximumAdmissionArtifactDirectoryHeadBytes     = 16777216
maximumAdmissionArtifactRegistrationSlots      = 64
maximumAdmissionEvidenceDirectoryEntries       = 1048576
maximumAdmissionEvidenceDirectoryPageEntries   = 256
maximumAdmissionEvidenceDirectoryPages         = 4096
maximumAdmissionEvidenceDirectoryHeadBytes     = 16777216
maximumAdmissionEvidenceRegistrationSlots      = 64
maximumAdmissionEvidenceRegistrationJournalAggregateBytes = 67108864
maximumAdmissionGcCandidateEntries             = 65536
maximumAdmissionGcCandidateChunkEntries        = 256
maximumAdmissionGcProgressChunkEntries         = 256
maximumAdmissionRootManagerJournalSlots        = 64
maximumAdmissionRootManagerJournalAggregateBytes = 201326592
```

The V1 `limits` object has exactly 52 ordered fields. Every integer is a
non-negative safe integer; fields documented as counts or
byte ceilings must additionally be positive. Unknown top-level, array, or limit
keys fail closed. `runtimeCapabilityProfileDigest` is computed with
`computeRealmContentId()` using format/domain
`particle-realms.realm-runtime-capability-profile`, major version `1`, and only
the digest field excluded. The registered, inspected, and adapter-declared
complete profile objects must be byte-identical. The M2B limit table must have
the same ordered key/value projection, while the admission index and handoff
must bind the exact ID/digest of that object. Device-specific observations do not mutate this profile; an
unsupported device rejects candidate creation and leaves the active bundle
unchanged. A semantic or limit change requires a new profile ID, digest,
contract fixture, and deployment.
The first normative base-profile fixture is generated from the exact expanded
object above, including `cse-active-bake-prepared-commit-v2`,
`prepareActiveBakeCommit`, both `requiredActiveBakeCseMethodIds`, and the
active-bake port name/version. Any draft digest that omitted those fields is
invalid and cannot enter the M2 catalog vectors.

### `engineAdapterFactory@1`

```javascript
inspect({ signal })
// -> {
//      factoryVersion,
//      adapterPortName: 'realmEngineAdapter',
//      adapterVersion: 1,
//      runtimeCapabilityProfile
//    }

create({
    ownerId,
    lifecycleGeneration,
    expectedRuntimeCapabilityProfileId,
    expectedRuntimeCapabilityProfileDigest,
    expectedRuntimeCapabilityProfile,
    signal,
})
// -> {
//      adapter: RealmEngineAdapter@1,
//      activeBakeCseBindingReceiptDigest
//    }
```

`inspect()` is side-effect-free and returns the complete frozen
`RealmRuntimeCapabilityProfileV1`; M2A validates its schema, digest, Engine
versions, and declared future adapter surface without constructing an adapter.
The created adapter exposes only the exact future M2 scene, ECS, State-First,
collision, navigation, input, audio, and resource-lifecycle methods. M2A
validates only the factory/inspection surface. The materialization slice calls
`create()` with the inspected ID, digest, and exact frozen registered profile,
then must prove that the returned adapter brand, version, methods, declared
profile ID, declared profile digest, canonical profile object, exact
`activeBakeCsePort@1` service facet, and one-time binding receipt all equal the
inspected descriptor before invoking any allocation. The OS composition root
injects that service facet directly into `RealmRuntimeActivationService`; the
app receives only its safe binding-receipt digest and the adapter's
`prepareActiveBakeCommit()` method. `activeBakeCsePort@1` exposes exactly
`commitPreparedSwap()` and `discardPrepared()` and is never an
`offerCandidate()` argument or app-returned value. An ID match alone is not
a capability-semantic match. The implementation
must import narrow Engine modules rather than the broad `EngineBootstrap.js`
or `engine/state/index.js` barrels. (Sources:
`engine/render/state/StateFirstEcsSourceAdapter.js`;
`engine/render/state/StateFirstSourceBridge.js`.)

The service retains exact `RealmActiveBakeCseBindingReceiptV1` with `format`,
`version`, `operatorPartitionId`, `realmId`, `cseRuntimeId`,
`cseRuntimeGeneration`, `ownershipModel = shared-operator-realm-session-view`,
`ownerId`, `lifecycleGeneration`, `runtimeCapabilityProfileId`,
`runtimeCapabilityProfileDigest`, `portName = activeBakeCse`, `portVersion = 1`,
`methodIds`, `bindingGeneration`, and `receiptDigest`. Its format/domain is
`particle-realms.realm-active-bake-cse-binding-receipt`, version `1`, and only
`receiptDigest` is excluded. `methodIds` is the exact registered sorted pair;
`cseRuntimeId` is an opaque service-issued ID at most 256 UTF-8 bytes;
`cseRuntimeGeneration` and `bindingGeneration` are positive uint64 decimal text.
The runtime identity/generation stays fixed across concurrent application
session views; `bindingGeneration` is one-time for the bound owner/lifecycle.
The first live view initializes canonical genesis, while every later live view
must observe the same runtime's exact current active record. The app receives
only `receiptDigest`; a duplicate, stale, different-runtime, or reset port
binding disposes the candidate and fails before offer.

The later adapter's `prepareActiveBakeCommit()` result is exactly
`{ preparedCseCommitHandle, preparedCseCommitReceipt,
preparedCseCommitDigest, preparedCseSwapReceiptDigest,
activeBakeOutputRecordDigest }`. The commit digest equals the exact safe
receipt's self digest; the swap digest is a separate one-way expectation built
after that commit digest; and the output-record digest names the staged exact
`CausalStateActiveBakeRecordV2` reached by the prepared post-root. The app may
only pass these values unchanged to `offerCandidate()`. These are the adapter's
exact app-facing projection names: Engine-internal `preparedCommitDigest` equals
`preparedCseCommitDigest`, and Engine-internal `preparedSwapReceiptDigest`
equals `preparedCseSwapReceiptDigest`; neither name translation changes bytes.

On a pre-transfer offer denial, the existing adapter method is used through the
exact aggregate shape `disposeCandidate({ offActiveCandidateHandle,
candidateGateSetHandle, preparedCseCommitHandle, reason, signal })`. It returns
one frozen disposal receipt only after the candidate resources and prepared CSE
stage are terminal. It cannot mutate the active pointer or call CSE step 8.

### `surfaceFramePort@1`

The accepted M2D-B4G boundary preserves the existing `surfaceFrame@1` slot but
closes the legacy acquisition route. It replaces the earlier prospective
surface/producer request and handle shapes with one terminal implementation:

```javascript
const surfaceFramePort = createRealmLegacySurfaceFramePort();

surfaceFramePort.acquireSurface();
surfaceFramePort.registerFrameProducer();
// Both synchronously return the same frozen null-prototype object:
// {
//   status: 'unavailable',
//   reasonCode: 'realm-gpu-presentation-required',
//   recoverable: false
// }
```

The port has exactly `portName`, `version`, `acquireSurface`, and
`registerFrameProducer`. Its zero-configuration factory returns the same frozen
null-prototype singleton on every valid call. Admission accepts only that
reviewed identity, not copies, proxy wrappers, or arbitrary callable adapters.
The validator rejects substitutes without inspecting or invoking them. Both
frozen zero-argument arrow methods ignore all arguments and their receiver;
they do not inspect, retain, await, or invoke signals, containers, callbacks,
handles, or thenables. A caller may safely await the returned result.

`recoverable: false` means that retrying this legacy method cannot acquire a
resource. It does not change the separate GPU port's recovery protocol.
There is no success, pending, disposal, resource-handle, or fallback variant.
`RealmRuntimeDependencyContract` requires the terminal identity in the existing
16-key dependency-v2 record. `RealmM2RuntimeComposition` validates it before GPU
syscall validation, runtime-profile verification, and process-owner processing,
then forwards the identical singleton. Rendering uses only the accepted
owner-coupled `realmGpuPresentation@1` path for its single surface and coordinated
producer. (Sources:
`webgpu-os/apps/the-virtual-realm/runtime/RealmLegacySurfaceFramePort.js`;
`webgpu-os/apps/the-virtual-realm/runtime/RealmRuntimeDependencyContract.js`;
`webgpu-os/kernel/realm/RealmM2RuntimeComposition.js`.)

### Remaining M2A ports

| Port | Required M2A method surface | M2A use |
| --- | --- | --- |
| `resourceTelemetryPort@1` | `beginOwner()`, `snapshotOwner()`, `closeOwner()` | Validate only; start counters when the process owner is acquired |
| `runtimeCheckpointPort@1` | `readLatest()`, `prepareCheckpoint()`, `commitCheckpoint()`, `abortCheckpoint()`, `retireCheckpoint()` | Validate only; the later checkpoint manager resolves protected admission storage, reasserts the app draft against the trusted current-active/anchor/policy source projection, returns only sanitized records or opaque correlations, distinguishes committed from exact no-effect abandonment, issues the separate handoff authorization only after root readiness, and exposes one exact teardown-only abort for a noncommitting preparation |
| `runtimeActivationPort@1` | `readActiveBundle()`, `prepareCandidateEligibility()`, `offerCandidate()`, `commitCandidate()`, `abortCandidate()` | Validate only; no candidate exists in M2A. M2C preparation returns only a bounded opaque request ID while the guard proof stays service-internal. `commitCandidate()` owns the selection fence, invokes the internal M2B activation guard, reasserts exact publication/admission heads plus current admission/evidence/trust policy, signature lifetime from the guard-private trusted service clock, and runtime-profile bindings, then performs exact synchronous liveness and immediate-time checks after durable pin-authorization readback and returns one narrow active-bundle teardown handle only after changing visibility |
| `actionAuthorityPort@1` | `submitProposal()`, `observeResult()` | Validate only; no proposal in M2A |
| `localOperatorPolicyPort@1` | `readPolicy()`, `subscribe()` | Validate only during startup. B4F permits a later owner-local policy read and data-only invalidation subscription after an accepted static package exists; ordinary construction invokes neither method |
| `clock@1` | `monotonicNow()`, `logicalTick()` | Lifecycle measurements and deterministic local sequencing only |
| `logger@1` | `debug()`, `info()`, `warn()`, `error()` | Sanitized event name plus bounded plain metadata |

The accepted B4F port name is `localOperatorPolicy`, version 1. Both operations
use the exact six-field operator/local-Realm context. A read request may carry
zero authority and policy epochs, but a successful `policy` result and every
subscription require positive epochs. Success carries the echoed context, one
exact nested `{ policyId, policyRevision, policyDigest }` head, and the accepted
M0 `LocalOperatorViewPolicyV1`; `invalid` and `unavailable` carry only their
closed reason code. The exact invalid reasons are `oversized`,
`future-version`, `malformed`, `live-value`, `digest-invalid`, and
`policy-binding-invalid`; unavailable reasons are `policy-unavailable` and
`policy-recovery-pending`.

Subscription binds the positive context and exact successful head. Its callback
receives only `{ eventKind, reasonCode }`, where `eventKind` is
`local-operator-policy-invalidated` and the reason is `context-invalidated`,
`policy-invalidated`, or `service-stopped`. The subscription and disposal shapes
are exactly `{ subscriptionId, dispose }` and
`{ subscriptionId, disposed: true }`. Data is bounded to 65,536 canonical bytes.
B4F owns no provider, policy store, monotonic head, renderer, view, minimap, or
mutation authority; digest-to-body truth remains trusted B4H work.

The composition root prebinds the activation port to the exact operator
partition, Realm, process owner, lifecycle/operator generations, inspected
runtime profile, work root, and teardown root. No method accepts replacements
for those authorities. The kernel service is shared only at the operator/Realm
activation boundary: it owns one visible pointer plus bounded per-process-owner
candidate/current/disposal slots, while each injected port view can address only
its prebound owner/lifecycle slot. The sole foreign-slot effect is the service-
internal, claim-authorized cross-session commit below: the caller cannot name a
foreign slot, and the service may close/mark only the exact observed predecessor
bound by the handoff claim. This is what permits a verified
cross-session displacement without transferring an old owner's child, resource,
or pin ledger to the new owner. The exact later-slice surface is:

```javascript
readActiveBundle({ signal })
// -> { status: 'absent', visiblePointerGeneration }
//  | { status: 'active', runtimeBundleId, admissionIndexDigest,
//      visiblePointerGeneration, visibleCommitReceiptDigest }
//  | { status: 'handoff-displaced', runtimeBundleId,
//      visiblePointerGeneration, crossSessionDisplacementReceiptDigest }
//  | { status: 'recovery-pending',
//      reason: 'cse-integrity-quarantined' }

prepareCandidateEligibility({
    expectedPublicationHeadBinding,
    expectedAdmissionHeadBinding,
    candidateAdmissionIndexDigest,
    signal,
})
// -> { status: 'prepared', activationPreparationId }
//  | { status: 'denied', reason }

offerCandidate({
    activationPreparationId,
    offActiveCandidateHandle,
    candidateGateSetHandle,
    preparedCseCommitHandle,
    preparedCseCommitReceipt,
    preparedCseCommitDigest,
    preparedCseSwapReceiptDigest,
    activeBakeOutputRecordDigest,
    signal,
})
// -> { status: 'offered', activationPreparationId, runtimeBundleId,
//      preparedCseCommitDigest, preparedCseSwapReceiptDigest,
//      activeBakeOutputRecordDigest }
//  | { status: 'denied', activationPreparationId, reason,
//      candidateOwnership: 'caller-retained' }
//  | { status: 'aborted', activationPreparationId, reason,
//      abortReceiptDigest }

commitCandidate({ activationPreparationId, signal })
// -> { status: 'committed', runtimeBundleId, visiblePointerGeneration,
//      visibleCommitReceiptDigest, activeBundleTeardownHandle }
//  | { status: 'denied', activationPreparationId, reason,
//      candidatePinRetirementReceiptDigest }
//  | { status: 'predecessor', activationPreparationId,
//      candidatePinRetirementReceiptDigest }
//  | { status: 'recovery-pending', activationPreparationId,
//      reason: 'manager-authority-unresolved' | 'cse-integrity-quarantined' }

abortCandidate({ activationPreparationId, reason, signal })
// -> { status: 'aborted', activationPreparationId, abortReceiptDigest }
//  | { status: 'already-terminal', activationPreparationId, terminalStatus,
//      abortReceiptDigest? }
//  | { status: 'not-found', reason: 'preparation-missing' }
//  | { status: 'recovery-pending', activationPreparationId,
//      reason: 'committing-authority-unresolved' |
//              'cse-integrity-quarantined' }
```

Every input is an exact frozen own-property record; unknown/inherited/symbol/
accessor fields fail before mutation. Every method except `abortCandidate()`
requires the exact prebound work signal; `abortCandidate()` requires the exact
still-live teardown signal and rejects the work signal.
`visiblePointerGeneration` is canonical non-negative uint64 decimal
text. IDs/digests are bounded canonical safe strings. The closed prepare-denial
reasons are `stale-publication`, `stale-admission`, `policy-changed`,
`trust-changed`, `profile-mismatch`, `signature-invalid`, `evidence-invalid`,
`lifecycle-inactive`, `operator-changed`, and `aborted`. Offer adds only
`preparation-missing`, `preparation-state`, `candidate-binding-invalid`,
`candidate-gates-open`, `prepared-cse-invalid`, and `pin-unavailable`. The first
five are pre-transfer `denied` results: the service allocates and retains
nothing, and the app's existing reverse-disposal entry still owns the complete
candidate aggregate. `pin-unavailable` occurs only after valid handles transfer;
the service converges cleanup and returns `status = aborted` plus the exact
receipt. Commit
adds only `activation-stale`, `immediate-liveness-denied`,
`immediate-time-denied`, `prepared-cse-invalid`, and `aborted`.

`offActiveCandidateHandle` is exactly branded `realmOffActiveCandidate@1` and
binds runtime-bundle, admission-index, State-First source, controller, and frame
barrier identities. `candidateGateSetHandle` is exactly branded
`realmCandidateGateSet@1` and binds that bundle plus its closed input,
interaction, source, controller, and frame gates. Both are opaque,
non-serializable, non-cloneable, and have no callable own properties.
`preparedCseCommitHandle`, exact frozen safe `preparedCseCommitReceipt`, and its
safe digest obey the Engine M2 prepared-commit contract. The receipt must
recompute `preparedCseCommitDigest`; its staged root, signatures, output record,
and canonical empty outbox are independently revalidated before transfer. The
separate `preparedCseSwapReceiptDigest` is the Engine-precomputed
digest of the exact receipt step 8 must return; it is not inside
`preparedCseCommitDigest`, so the two receipts form an acyclic one-way chain.
`activeBakeOutputRecordDigest` names the exact staged
`CausalStateActiveBakeRecordV2`; it is already inside the prepared-commit
receipt and both values must agree.
The Engine adapter's existing `disposeCandidate()` method consumes
the complete still-caller-owned off-active candidate, gate-set, and prepared-CSE
aggregate on a pre-transfer denial; it captures the Engine prepared-discard and
resource-disposal receipts without exposing `activeBakeCsePort@1` to the app.
The service independently validates both digests, returns the exact swap digest
in the accepted offer projection, and later requires it from CSE step 8.
Accepted offer atomically
relinquishes all three handles to the service; later caller use fails closed.

The service, not the app, calls its narrow runtime-pin manager during
`offerCandidate()`. `offered` is returned only after the exact pin root and
candidate manager record are active, the safe binding digest is computed, and
the staged teardown child is one-time bound to that manager operation/root.
Failure after transfer retires/releases any created pin and discards every
service-owned staged handle. Pre-transfer denial leaves those handles under the
app's already registered reverse-disposal entry. The
app never supplies or receives a manager operation ID, root reference, storage
SHA, root capability, or manager port.

`abortCandidate()` accepts reasons exactly `application-close`,
`operator-switch`, `device-loss`, `handoff-cancel`, or `activation-recovery`.
It aborts only `prepared` or `offered`; an offered abort first retires the active
candidate pin. `committing` returns recovery-pending and is reconciled by the
manager chain. `already-terminal.terminalStatus` is exactly `aborted`,
`committed`, `handoff-displaced-retained`, `closed`, `superseded`, or
`disposed`. Every returned object is
deeply frozen and contains no live handle except the committed result's one
teardown capability.

`abortReceiptDigest` names exact `RealmRuntimeCandidateAbortReceiptV1`. Its
closed `no-service-candidate | service-disposed` ownership variant binds the
preparation, optional bundle and prepared-CSE discard receipt, staged-child
close and unregistration evidence (the exact
`RealmRuntimeStagedCandidateCloseReceiptV1` followed by
`RealmProcessOwnerChildUnregistrationReceiptV1`), optional candidate-pin retirement, terminal
reason, and self digest. It is returned only after every service-owned resource
for that variant is terminal. An `already-terminal` result carries
`abortReceiptDigest` if and only if `terminalStatus = aborted`; every other
terminal status forbids it. `not-found` allocates no entry and returns no digest.

Terminal lookup is explicitly bounded. The service retains at most one
candidate terminal cell, and only until the next candidate preparation is
accepted; it evicts that cell only after cleanup is complete. Current-active
terminal evidence remains with the current slot, and superseded/disposed
evidence remains only with its bounded disposal slot until pin and child cleanup
complete. After eviction, every old preparation ID returns `not-found`; no
historical ID map or unbounded replay cache exists.

For a current pointer owned by a different process owner/lifecycle,
`RealmRuntimeActivationService` must use the service-only
`runtimeCrossSessionActivationBindingPort@1`; ordinary replacement is forbidden.
That port is owned by the trusted handoff service and injected only into the
activation service. Its exact asynchronous claim face is:

```javascript
claimDisplacement({
    activationPreparationId,
    candidateAdmissionIndexDigest,
    candidateRuntimeBundleId,
    observedPredecessorProcessOwnerId,
    observedPredecessorLifecycleGeneration,
    observedPredecessorRuntimeBundleId,
    observedPredecessorVisiblePointerGeneration,
    observedPredecessorLiveVisibilityReceiptDigest,
    signal,
})
// -> { status: 'claimed', crossSessionActivationClaimReceipt,
//      crossSessionActivationClaimHandle }
//  | { status: 'invalid', reasonCode }
//  | { status: 'unavailable', reasonCode: 'handoff-authority-unresolved' }
```

The port is prebound to the replacement owner/lifecycle and independently reads
the exact current handoff head, recovered active handoff root, complete
checkpoint edge/binding, and service-injected record. It requires the record's
old owner/lifecycle/bundle and current admission/head/profile bindings to equal
the observed predecessor and candidate, and requires the replacement lifecycle
to be strictly newer. Invalid reasons are exactly `handoff-missing`,
`handoff-cleared`, `handoff-binding-invalid`, `predecessor-mismatch`,
`candidate-mismatch`, or `lifecycle-lineage-invalid`. The claim holds one narrow
per-Realm handoff-head lease beneath the already-held activation-selection
lease; handoff write/clear never waits for selection, so the only lock order is
selection then handoff-head lease. One bounded claim exists per replacement
owner and a failed/predecessor commit cancels it without mutating handoff state.

`crossSessionActivationClaimReceipt` is exact frozen
`RealmRuntimeCrossSessionActivationClaimReceiptV1` with `format`, `version`,
`operatorPartitionId`, `realmId`, `handoffGeneration`,
`handoffHeadStorageSha256`, `handoffRecordDigest`,
`handoffRootReferenceId`, `handoffActiveRootStorageSha256`,
`checkpointBindingDigest`, `predecessorProcessOwnerId`,
`predecessorLifecycleGeneration`, `predecessorRuntimeBundleId`,
`predecessorVisiblePointerGeneration`,
`predecessorLiveVisibilityReceiptDigest`,
`replacementProcessOwnerId`, `replacementLifecycleGeneration`,
`activationPreparationId`, `candidateAdmissionIndexDigest`,
`candidateRuntimeBundleId`, `claimSequence`, and `receiptDigest`. Its domain is
`particle-realms.realm-runtime-cross-session-activation-claim-receipt`, version
`1`, excluding only `receiptDigest`; `claimSequence` is positive process-local
uint64 decimal text, never wall time.

`crossSessionActivationClaimHandle` is branded
`realmCrossSessionActivationClaim@1`, nonserializable, service-only, and
single-use. It exposes synchronous no-allocation
`commit({ visibleCommitReceiptDigest,
crossSessionDisplacementReceiptDigest })` and `cancel({ reason })`. Their exact
closed results are:

```javascript
// commit(...)
// -> { status: 'consumed',
//      crossSessionActivationSettlementReceiptDigest }
//  | { status: 'invalid', reasonCode: 'claim-binding-invalid' }
//  | { status: 'recovery-pending',
//      reasonCode: 'claim-authority-unresolved' }

// cancel(...)
// -> { status: 'cancelled',
//      crossSessionActivationSettlementReceiptDigest }
//  | { status: 'invalid', reasonCode: 'claim-binding-invalid' }
//  | { status: 'recovery-pending',
//      reasonCode: 'claim-authority-unresolved' }
```

Either terminal result settles and releases the handoff-head lease exactly
once. Commit independently checks both digests against the preallocated
activation/displacement slots. Cancel reasons are exactly `precommit-denied`,
`predecessor`, `work-aborted`, `operator-switch`, `lifecycle-retired`, or
`activation-recovery`. `crossSessionActivationSettlementReceiptDigest` names
exact frozen `RealmRuntimeCrossSessionActivationSettlementReceiptV1` fields
`format`, `version`, `operatorPartitionId`, `realmId`,
`crossSessionActivationClaimReceiptDigest`, `outcome = consumed | cancelled`,
optional `visibleCommitReceiptDigest`, optional
`crossSessionDisplacementReceiptDigest`, optional `cancellationReason`,
`settlementSequence`, and `receiptDigest`. The two visible/displacement digests
are both required only for `consumed`; `cancellationReason` is required only for
`cancelled`. Its domain is
`particle-realms.realm-runtime-cross-session-activation-settlement-receipt`,
version `1`, excluding only `receiptDigest`; `settlementSequence` is positive
process-local uint64 decimal text, never wall time. A binding mismatch returns
`invalid`, leaves no success receipt, releases the lease into bounded manager
recovery, and makes the activation result recovery-pending. An unavailable or
uncertain settlement authority returns the exact `recovery-pending` arm without
a settlement digest; the manager retains/reacquires the claim authority for
reconciliation and maps its reason to outer
`commitCandidate().reason = manager-authority-unresolved`. It keeps the handoff
record uncleared and never reports committed.

`abortCandidate()` is the teardown-only exception frozen by the common port
rules. Its `signal` must be the exact still-live teardown signal prebound to this
port; the work signal is rejected. It reasserts the captured operator, owner,
and lifecycle identities before and after every cleanup await, but accepts that
the bound lifecycle is retiring or retired. It may only discard, close,
unregister, retire/release a candidate pin, and settle fixed manager state. It
cannot prepare or commit a candidate, change the active pointer, open a gate, or
allocate a replacement.

A successful later-slice `commitCandidate()` result is one exact closed object:
`status = committed`, `runtimeBundleId`, `visiblePointerGeneration`,
`visibleCommitReceiptDigest`, and `activeBundleTeardownHandle`. The handle is a
frozen non-serializable branded single-bundle capability with exactly
`portName = realmActiveBundleTeardown`, `version = 1`, and one own method:

```javascript
close({ reason, signal })
// -> {
//      closed: true,
//      runtimeBundleId,
//      visiblePointerGeneration,
//      activeBundleCloseReceiptDigest
//    }
//  | {
//      closed: false,
//      status: 'lifecycle-active',
//      reason: 'lifecycle-retirement-required'
//    }
//  | {
//      closed: false,
//      status: 'recovery-pending',
//      reason: 'lifecycle-retirement-unresolved' |
//              'displacement-integrity-unresolved'
//    }
//  | {
//      closed: false,
//      status: 'superseded' | 'disposed',
//      supersessionReceiptDigest
//    }
```

The activation service preallocates the handle when a later slice successfully
offers its off-active candidate and registers it immediately as a staged
process-owner child before runtime-pin authorization or pointer mutation. It
initially binds the handle irreversibly to the exact operator partition, process
owner, lifecycle generation, bundle, pointer generation,
input/interaction/source/controller/frame gates, and still-live teardown root.
After the runtime pin is
active but before durable commit authorization, the trusted activation service
performs one internal one-time bind of that pin's exact manager operation and
root reference; no app method can set or replace it.
The guarded no-await commit block first passes M2B's exact synchronous
work-root/activation-state/operator/lifecycle/owner liveness check and then its
immediate-time check against the just-read-back pin-manager SHA, then atomically
transfers that already registered child from `(activation-staged,
candidate-owned)` to `(activation-current, active-owned)`; successful commit
merely returns the existing handle. Expiry, clock rollback/unavailability,
binding mismatch, abort, predecessor, uncertain recovery, or candidate disposal
performs zero candidate visibility mutation and closes/unregisters the staged
handle before reporting failure. It
cannot be cloned, serialized, handed off, invoked for another bundle, reopen a
pointer, retire a root, or reach a manager. `close()` is permitted only after
the lifecycle authority internally observes that exact generation retired; it
does not call ordinary `assertGenerationCurrent()`. It synchronously closes the
matching input/interaction/source/controller/frame gates. A still-current slot removes and
reads back only its exact active pointer; a `handoff-displaced-retained` slot
instead proves the pointer no longer names it and preserves the successor. It
then reads back the applicable closed state and returns one frozen receipt. Repeated
calls return the same receipt without another mutation. The teardown handle
stays usable after work-root abort only through the separate live teardown
signal and is disposed as a child after `close()`.

Calling `close()` before the bound lifecycle is retired returns the exact
`lifecycle-active` no-effect result. An unavailable or contradictory retirement
observation returns the exact `recovery-pending` no-effect result and leaves the
pointer, gates, handle, resources, and pin unchanged for retry. If service-only replacement has already
moved the bound bundle to `superseded` or `disposed`, the old handle returns that
exact terminal result and its retained supersession-receipt digest; it never
looks up, closes, or otherwise affects the replacement. The handle itself
retains that bounded terminal digest, so this behavior needs no historical
service lookup. A repeated successful retirement close returns the original
closed result and digest.
After retirement is proven, an unavailable, malformed, or mismatched retained
cross-session displacement receipt, gate readback, or successor-pointer proof
returns the exact `displacement-integrity-unresolved` recovery-pending result and
performs the same zero mutation. It never guesses that displacement succeeded.
The close receipt records the caller's `reason` only as
`requestedCloseReason` and separately binds the lifecycle authority's
`lifecycleRetirementReceiptDigest`; it never upgrades caller text into an
authoritative retirement cause. `close()` does not accept that digest from the
caller: the activation service reads it only from the bound retired variant of
`lifecycleRetirementObservationPort@1` while the teardown signal remains live.

Same-generation replacement is a distinct internal edge, not a public
`close()`. In the same no-await block that selects a verified replacement, the
activation service closes and reads back the old bundle's input, interaction,
State-First, controller, and frame gates, atomically transfers the old teardown
child from `(activation-current, active-owned)` to
`(activation-superseded, disposal-owned)`, and transfers that terminal child
plus the old resources to disposal ownership. The
old child is unregistered only after its post-frame GPU fence and exact resource
disposal, immediately before the old runtime pin is retired/released. It cannot
close the replacement bundle, require lifecycle retirement, or leak as an owned
active child.

Cross-session handoff displacement is a separate service-only edge. With the
exact live cross-session claim held, the same no-await visible-commit block
closes and reads back the predecessor's five gate families, writes the new
pointer and opens only the replacement gates, and moves the old owner slot from
`current-active -> handoff-displaced-retained` while atomically transferring its
registered teardown child from `(activation-current, active-owned)` to
`(activation-handoff-displaced, predecessor-retained-owned)`. It does not mark
that old child
superseded, transfer its resources, enter it in the replacement owner's disposal
ledger, or retire its runtime pin. The old slot retains one exact
`RealmRuntimeCrossSessionDisplacementReceiptV1` containing `format`, `version`,
`operatorPartitionId`, `realmId`, `crossSessionActivationClaimReceiptDigest`,
`predecessorProcessOwnerId`, `predecessorLifecycleGeneration`,
`predecessorRuntimeBundleId`, `predecessorVisiblePointerGeneration`,
`predecessorLiveVisibilityReceiptDigest`, `replacementProcessOwnerId`,
`replacementLifecycleGeneration`, `replacementRuntimeBundleId`,
`replacementVisiblePointerGeneration`,
`replacementLiveVisibilityReceiptDigest`, `visibleCommitReceiptDigest`,
`inputClosed = true`, `interactionClosed = true`, `stateFirstClosed = true`,
`controllerClosed = true`, `frameClosed = true`,
`predecessorOwnershipDisposition = retained-by-predecessor-owner`,
`predecessorRuntimePinDisposition = retained`,
`predecessorTeardownChildDisposition = handoff-displaced-retained`,
`displacementSequence`, and `receiptDigest`. Its format/domain is
`particle-realms.realm-runtime-cross-session-displacement-receipt`, version `1`,
excluding only `receiptDigest`; its sequence is process-local uint64 decimal
text, not wall time.

After the old lifecycle is authoritatively retired, that old handle verifies
its retained displacement receipt and already-closed gates, proves the visible
pointer no longer names its bundle, and closes with disposition
`handoff-displaced-pointer-preserved`. It never removes or reads through the
replacement pointer. The old owner then performs its own fence, resource/child
disposal, and pin retirement. A hostile CSE step-8 swap-receipt mismatch inside
the no-await commit transition quarantines both gate sets and returns recovery-pending rather
than transferring ownership or claiming success. A later old-handle close
mismatch instead returns `displacement-integrity-unresolved` with zero mutation;
it never closes or quarantines the successor gates.

## Dependency rejection order

Validation traverses the exact dependency-key order and applies each family's
locked admission rule. Equivalent invalid inputs therefore fail for the same
reason:

1. dependency object is a plain record with exact keys;
2. `dependencyVersion` is exactly `2`;
3. every required dependency exists;
4. `surfaceFramePort` passes only exact reviewed-singleton identity admission,
   without property inspection; each other port uses its exact family validator;
5. operational ports have their exact `portName`, `version`, and required own
   callable data properties;
6. no unknown method or field is present on a strict operational port;
7. no forbidden broad-manager marker or raw capability is present;
8. the clock is monotonic and the logger accepts sanitized records;
9. the dependency object and validated capability descriptors are frozen;
10. only then may lifecycle ownership begin.

No error path probes a global as a fallback.

## Lifecycle state machine

```text
new -> validating -> ready -> starting
starting -> waiting-for-admission
starting -> migration-required
starting -> unavailable
starting -> admission-ready
admission-ready -> staging    (M2C+)
staging -> active             (later M2 activation slice)
any owned state -> stopping -> stopped
```

`failed` is an outcome receipt, not a durable operational state. A failed
`validating` transition returns to `new` with zero acquired resources. A failure
after ownership begins runs the same reverse disposal stack as `stop()` and
ends at `stopped`.

Every transition has:

- prior state;
- next state;
- construction-attempt ID;
- lifecycle generation, nullable only before start-order step 5 allocates it;
- monotonic sequence;
- reason code;
- owner ID when acquired;
- bounded duration;
- sanitized failure class when rejected.

Preflight receipts for `new`, `validating`, and `ready` require the
construction-attempt ID, construction signal state, and null lifecycle
generation; they omit owner ID. From `starting` after generation allocation,
the generation is required, and owner ID becomes required immediately after
owner acquisition. No receipt fabricates an identity that does not yet exist.

Late work checks both the generation and local work-abort signal before it can mutate a
store, register a handle, offer a candidate, emit telemetry, or update visible
state.

## Start order

M2A startup is deliberately short:

1. Validate the complete dependency graph with zero runtime acquisition.
2. Allocate the construction-attempt ID and prepare its three distinct live
   native abort roots: construction, work, and teardown. This is
   pre-generation fencing only and allocates no lifecycle generation or runtime
   resource. The construction signal is passed to every preflight await.
3. If the optional host-attempt binding is present, call its captured
   `bindAttempt()` exactly once for this fresh attempt and require the frozen
   exact `{ bound: true }` receipt. Then call only
   `engineAdapterFactory.inspect()` and validate the frozen runtime capability
   profile with zero adapter or Engine allocation.
4. Capture and validate the current operator context.
5. Allocate a new durable lifecycle generation plus its retirement handle
   through `lifecyclePort`. The already prepared work and teardown roots remain
   local fences; session work never receives the teardown signal.
6. Acquire one process owner.
7. Register one lifecycle participant under that owner.
8. Start owner-attributed telemetry.
9. Read only the M2 admission-head status.
10. For an accepted admission only, call `runtimeHandoffPort.read()` with the
    captured operator/Realm and exact `maximumRuntimeHandoffBytes`; validate the
    record against the accepted head bindings, inspected profile ID/digest,
    operator, Realm, digest, and lifecycle lineage. Preserve only the frozen
    sanitized handoff observation defined below. No live resource is restored.
11. Publish exactly one immutable M2A session state: `waiting-for-admission` for
    a missing head, `migration-required`, `unavailable`, or `admission-ready` for
    an accepted head. `admission-ready` carries only the bounded head bindings
    returned by `readHead()` and still performs no package load or allocation.

If the admission status is `migration-required`, M2A exposes that status to the
trusted UI boundary and stops. It never invokes RealmForge, fabricates missing
package fields, or opens an empty scene.

## Stop order

1. Abort the construction-attempt signal, including while `inspect()` or the
   initial operator snapshot is still pending.
2. If a lifecycle generation exists, abort its work root, then retire that exact
   generation with its retirement handle and the still-live teardown signal; a
   later start allocates a strictly greater value.
3. Abort noncommitted activation/checkpoint requests through their
   exact teardown-only calls and the still-live teardown signal. Resolve each
   prepared/offered candidate or staged child first by its preparation and
   candidate identities, discard its CSE/staging owner, and retire/clean any
   candidate pin; an unresolved entry blocks shutdown. Then call
   `snapshotChildren()` for only the process owner's `activation-current`,
   `activation-handoff-displaced`, and `activation-superseded` kinds, receiving
   its canonical `(childKind, childId)` order and never protected storage. Join
   each returned child exactly once to the service's bounded current-active,
   handoff-displaced-retained, or superseded-disposal slot by `childId`; a
   missing, duplicate, foreign, or kind/role-mismatched join blocks shutdown.
   Freeze that bounded cleanup projection in descending
   `(visiblePointerGeneration, runtimeBundleId)` order before disposal begins.
4. If the ledger has a current-active or handoff-displaced-retained teardown
   handle, call its exact `close()` under the still-live teardown signal after
   retirement; require respectively removed-pointer or preserved-successor plus
   closed-gate readback and retain only its receipt digest. Superseded entries
   must already carry exact gate-close receipts.
5. For each ledger entry, prove its post-frame GPU fence or certified device-loss
   completion, dispose its controller/input, presentation/audio/GPU, CSE staging,
   ECS/static-store, and other owned children in reverse order, then unregister
   its terminal teardown child.
6. Prove step 3 cleaned every candidate pin, then retire/release/clean every exact
   current-active, handoff-displaced-retained, or superseded-disposal runtime-pin
   journal/root owned by the sorted bundle ledger. An unresolved entry blocks
   stopped state, owner release, and collection; singular-current shortcuts and
   storage listing are forbidden.
7. Close telemetry if started and retain its sanitized terminal receipt.
8. Dispose the lifecycle participant if registered.
9. Release the process owner, if acquired, only after its child count reaches zero.
10. Abort the teardown signal and publish the immutable stopped receipt.

Every step is conditional and idempotent. A pre-generation stop never fabricates
a lifecycle generation or owner. A second stop returns the original stopped
receipt.

## Handoff boundary

M2A may read a handoff record but cannot trust it as an active session. It
validates operator, Realm, admission head, lifecycle generation lineage,
runtime capability profile, and record digest. Live resources are always
rebuilt by later slices.

The handoff adapter result is reduced with one frozen precedence. Adapter
`invalid` reasons retain the exact order `oversized`, `future-version`,
`malformed`, `live-value`, `digest-invalid`, `checkpoint-binding-invalid`; a
syntactically valid record then
checks `foreign-operator`, `foreign-realm`, `profile-mismatch`, `stale-head`,
and `stale-generation`, in that order. Adapter `unavailable` is checked before
all record semantics and preserves the exact order `root-recovery-pending`,
`manager-authority-unresolved`. `stale-head` means either complete head
binding differs from the accepted admission observation. `stale-generation`
means the wrapper generation does not equal the record generation or the
stored `lifecycleGeneration` is not a positive uint64 strictly less than the
newly allocated lifecycle generation. Gaps are permitted after a crash; equal
or future lifecycle generations are not. The current file is the only handoff
authority, so no age heuristic or scan for an older generation is permitted.
The required checkpoint binding has already been verified by the manager with
its protected graph edge. The composition reducer independently recomputes its
digest and requires every admission/publication/profile/bundle/anchor/cursor/
policy field duplicated by the handoff to be equal before accepting it.

Adapter `missing` and verified `cleared` both reduce to internal `absent` for
session restoration. The composition root privately retains a valid raw
record/tombstone generation and storage SHA only as the expected predecessor for
a later authorized `write()` or `clear()`; those values never enter the reduced
session observation, public status, diagnostics, or telemetry. The exact
internal observation is one closed union:

```text
absent:
  status = absent

accepted:
  status = accepted
  handoffGeneration
  processOwnerId
  lifecycleGeneration
  handoffRootReferenceId
  publicationHeadBinding
  admissionHeadBinding
  runtimeCapabilityProfileId
  runtimeCapabilityProfileDigest
  runtimeBundleId
  checkpointBinding
  safeAnchorId
  operationsViewRequested
  localPolicyId
  localPolicyDigest
  logicalCursorId?

ignored:
  status = ignored
  reasonCode
```

`ignored.reasonCode` is exactly `root-recovery-pending`,
`manager-authority-unresolved`, `foreign-operator`, `foreign-realm`,
`stale-head`, `stale-generation`, `profile-mismatch`, `digest-invalid`,
`checkpoint-binding-invalid`, `oversized`, `malformed`, `future-version`, or
`live-value`. The observation is
kept inside the composition root and may be consumed only by M2C's staged
rebuild. It is not merged into the public M2A session state, telemetry, or the
`admission-ready` projection.

Handoff can restore only:

- last accepted publication and admission heads;
- last runtime bundle and exact verified checkpoint binding;
- first-person safe-anchor ID;
- whether Operations View was requested, never an active camera;
- local policy ID and digest;
- logical cursor and checkpoint-binding identity.

An incompatible or stale handoff is ignored with a sanitized receipt. It never
blocks a clean M2 start or changes a durable admission head.

## Diagnostics and event vocabulary

M2A uses fixed event names. Metadata excludes account IDs, file paths,
evidence IDs, source text, signature bytes, tokens, and native error objects.

```text
virtual-realm.m2a.validate.enter
virtual-realm.m2a.validate.accepted
virtual-realm.m2a.validate.rejected
virtual-realm.m2a.lifecycle.transition
virtual-realm.m2a.owner.acquired
virtual-realm.m2a.owner.released
virtual-realm.m2a.admission.status
virtual-realm.m2a.handoff.accepted
virtual-realm.m2a.handoff.rejected
virtual-realm.m2a.stop.enter
virtual-realm.m2a.stop.complete
virtual-realm.m2a.stop.error
```

## Ten implementation pieces

Each piece is independently reviewable and preserves the previous accepted
boundary.

1. **[NEW] M2 runtime catalog.** Add the separate frozen 11-definition target
   catalog over the existing registry; land no stub and prove M0-M1C stays 109.
2. **[NEW] Dependency contract.** Implement exact-key, version, method, and
   forbidden-capability validation with deterministic error order.
3. **[NEW] Lifecycle guard.** Implement state, generation, abort, and
   post-await currentness checks without owning another peer.
4. **[NEW] Process owner adapter.** Bind one OS process owner and exact child
   disposal accounting.
5. **[NEW] OS lifecycle adapter.** Queue close, suspend, resume, operator
   switch, and device-loss intents under the current generation.
6. **[NEW] Handoff codec/adapter.** Accept only serializable, digest-bound,
   operator-local recovery state.
7. **[NEW] Side-effect-free entry.** Compose peers, start in order, stop in
   reverse order, and expose immutable status only.
8. **[NEW] App manifest/factory.** Register one optional singleton app through
   existing WebGPU OS discovery with least-privilege permissions.
9. **[NEW] Browser acceptance suite.** Exercise imports, dependency failures,
   lifecycle races, operator changes, handoff, and exact disposal.
10. **[MODIFY] Canonical documentation.** Bind M2A evidence into the M2
    foundation, roadmap, certification plan, and session memory.

Rollback removes the opt-in app registration and M2A modules. M0-M1C contracts,
RealmForge bakes, and stored artifacts remain untouched.

## M2A browser acceptance matrix

| Gate | Required proof |
| --- | --- |
| `VR-M2A-001` | `index.js` import performs zero DOM, listener, process, surface, storage, network, GPU, audio, timer, or global registration work |
| `VR-M2A-002` | The separate runtime catalog initializes through the existing registry, reaches its locked 11-definition target without stubs, and never changes the 109-definition catalog or its order |
| `VR-M2A-003` | Missing, extra, wrong-version, inherited, accessor, symbol, mutable, or malformed dependency fields fail before acquisition |
| `VR-M2A-004` | Broad kernel/GPU/storage/network managers and ambient globals are rejected as dependencies |
| `VR-M2A-005` | Valid start validates the complete closed runtime profile, including exact Engine/adapter/numeric/features/methods/limits and digest, then acquires exactly one process owner and one lifecycle participant; later Engine creation accepts and returns that ID/digest/object as one inseparable binding |
| `VR-M2A-006` | Failed start disposes every acquired child in reverse order and leaves zero owner count |
| `VR-M2A-007` | Stop, double stop, stop during start, and restart use a separate live teardown signal; the post-pin no-await liveness check rejects retired, aborted, switched, released, or noncommitting work before visibility; shutdown retires the exact durable generation, resolves staged/candidate entries by preparation identity first, then snapshots only current, handoff-displaced-retained, and superseded bundles from the bounded predecessor-owner ledger, closes current or displaced visibility through its exact pointer branch, drains every disposal entry through exact fence/resource/child proof, and retires every owned pin journal/root before owner release; neither shutdown, ordinary same-owner replacement, nor claim-authorized cross-session displacement leaks late mutation, an old active gate, owned child, foreign-ledger transfer, or unresolved pin |
| `VR-M2A-008` | The OS lifecycle authority allocates a durable strictly increasing operator/app generation; operator switch or restart rejects every old asynchronous completion without reusing a generation |
| `VR-M2A-009` | A migration-required or unavailable head causes zero Engine, ECS, GPU, audio, input, or frame acquisition |
| `VR-M2A-010` | After accepted admission, handoff record/tombstone authority is stat/read under the exact 65,536-byte profile cap, returns a record only after exact matching active-root/manager-journal recovery plus mandatory checkpoint binding and complete protected graph-edge verification, rejects unbound or caller-authored restoration state, maps unavailable or closed adapter results through frozen reason precedence and monotonic generation lineage, and yields only the closed internal accepted/absent/ignored observation; it never enters public status, resets on clear, or restores live handles |
| `VR-M2A-011` | App discovery uses the normal manifest/factory path and registers one singleton surface intent |
| `VR-M2A-012` | Production modules contain no Playground import/probe and no First Shard dependency |
| `VR-M2A-013` | Diagnostics are bounded and contain no account ID, path, source, evidence payload, signature bytes, key, or token |
| `VR-M2A-014` | M0 39/39, Engine foundations 6/6, local operator 10/10, signer completion 6/6, independent Python 6/6, M1A 15/15, M1B 21/21, and M1C 35/35 remain passing with zero skips |

Skipped cases do not satisfy M2A.

### Accepted `m2-entry-contract` case ledger

The executable M2A suite passes exactly 25 cases with zero failures or skips.
Every named module exists and the browser harness publishes a terminal accepted
receipt.

| Case | Required assertion |
| --- | --- |
| `M2A-01` | Snapshot the frozen M0-M1C catalog at exactly 109 definitions and prove its ordered names and definitions are unchanged |
| `M2A-02` | Initialize the complete M2 catalog at exactly 11 definitions in the locked order above |
| `M2A-03` | Reject duplicate M2 names, formats, versions, and canonical definition identities |
| `M2A-04` | Validate and deeply freeze every complete M2 minimal fixture, including the exact runtime-profile arrays, limit object, and self-digest; no fixture is a stub |
| `M2A-05` | Resolve all 11 definitions by name and format/version through the existing registry behavior |
| `M2A-06` | Prove failed registration is atomic and leaves the prior registry snapshot unchanged |
| `M2A-07` | Reject missing and unknown contract names, formats, versions, and major versions deterministically |
| `M2A-08` | Validate the exact 71-field history-independent admission-index shape; selection operation, generation, and previous digest exist only in the mutable head codec |
| `M2A-09` | Require the exact private-v2 package discriminator and exact 17-key package inventory |
| `M2A-10` | Cross-bind operator partition, local Realm, publication scope/root/generation/storage SHA, admission-index digest, and admission-head generation/storage SHA |
| `M2A-11` | Keep Realm content IDs, exact-byte blob IDs, RealmForge hashes, stable semantic IDs, and logical artifact keys non-interchangeable |
| `M2A-12` | Cross-bind manifest, dependency closure, resource limits, layout, lookup, optimization, bake, and validation receipts |
| `M2A-13` | Validate chunked resource/evidence/signature inventory root and chunk digests, payload IDs, counts, byte totals, deterministic boundaries, order, and closure equality |
| `M2A-14` | Reject malformed inventory descriptors, resource/package-member/evidence/signature rows, cross-chunk duplicates, gaps, overlap, or noncanonical order |
| `M2A-15` | Reject duplicate IDs, dangling edges, unreachable nodes, cycles, depth overflow, count overflow, and byte overflow |
| `M2A-16` | Require the exact reviewed station, station evidence, Storylet policy, and complete Storylet authoring-evidence set |
| `M2A-17` | Cross-bind Storylet catalog, candidate index, dependency subclosure, policy, station, and validation receipt |
| `M2A-18` | Require the exact referenced signature-envelope set and projected publisher/key/algorithm/audience/lifetime fields |
| `M2A-19` | Bind exact verifier identity/version plus the complete registered runtime-capability object/ID/digest and admission-policy ID/digest |
| `M2A-20` | Recompute and reject substitution of every self-digest and exact-byte address |
| `M2A-21` | Reject inherited, accessor, symbol, sparse-array, exotic-prototype, mutable, and unknown JavaScript shapes |
| `M2A-22` | Enforce string, array, node, depth, canonical-byte, package-byte, evidence, and signature ceilings before expensive work |
| `M2A-23` | Reject raw storage, GPU, kernel, network, key, evidence-store, RealmForge, and ambient-global capabilities at the app boundary |
| `M2A-24` | Match independent Python canonical bytes and digests for frozen M2 admission vectors, including `U+E000` versus `U+10000` object-key ordering that distinguishes the two package hash profiles |
| `M2A-25` | Audit the exact 13-module runtime-contract import graph, zero side effects, no duplicate registry, and no M0-M1C catalog mutation |

The browser files use the same HTTP-loaded `TestHarness` convention as the
accepted RealmForge suites and the M0 startup-error catcher. The paired Python
suite is an independent canonical oracle, not a second implementation imported
by the browser.

The 25 catalog/index cases do not by themselves accept the M2A application
lifecycle. M2A also has a separate `m2-runtime-composition` suite targeting
exactly 30 passing cases and zero skips:

| Case | Required assertion |
| --- | --- |
| `M2A-RUNTIME-01` | Import `index.js` with poisoned globals and observe zero registration, DOM, listener, storage, network, process, timer, GPU, audio, or input side effect |
| `M2A-RUNTIME-02` | Discover the opt-in manifest/factory through the ordinary app registry with one singleton surface intent and least-privilege permissions |
| `M2A-RUNTIME-03` | Accept the current exact frozen 16-key dependency-v2 object and all exact port brands, versions, methods, and callable data properties, including the B4G terminal legacy singleton |
| `M2A-RUNTIME-04` | Reject each missing dependency key before acquisition |
| `M2A-RUNTIME-05` | Reject every extra string or symbol dependency key before acquisition |
| `M2A-RUNTIME-06` | Reject inherited properties, accessors, proxies, exotic prototypes, mutable descriptors, and wrong dependency versions deterministically |
| `M2A-RUNTIME-07` | Reject wrong port brands/versions, missing methods, extra strict-port methods, and non-callable method values in locked order |
| `M2A-RUNTIME-08` | Reject raw kernel, GPU, storage, network, evidence, key, RealmForge, and service-locator capabilities with no global fallback |
| `M2A-RUNTIME-09` | A valid start prepares distinct construction/work/teardown roots; when supplied, synchronously binds them to the host before inspection; inspects and validates the complete frozen runtime capability profile including the prepared-active-bake feature, adapter method, service-port methods, and regenerated digest fixture; captures one operator context; durably allocates one lifecycle generation/retirement handle without moving that allocation earlier; then acquires exactly one process owner and lifecycle participant in order; later Engine creation must bind the inspected profile ID, digest, exact object, and one service-only active-bake CSE port receipt |
| `M2A-RUNTIME-10` | Owner telemetry starts only after ownership and carries the same owner and lifecycle generation |
| `M2A-RUNTIME-11` | Missing admission publishes only `waiting-for-admission` and acquires no Engine, surface, frame, ECS, GPU, audio, input, or controller resource |
| `M2A-RUNTIME-12` | Migration-required and unavailable admission variants publish their exact bounded status and perform no migration, RealmForge import, storage write, or runtime allocation |
| `M2A-RUNTIME-13` | Accepted admission status publishes exact `admission-ready` head bindings as a read-only M2A observation and still performs no package load or later-slice allocation |
| `M2A-RUNTIME-14` | Failure after each acquisition point, including immediate liveness or trusted-time denial after exact durable pin authorization, performs zero candidate visibility mutation; offer passes/recomputes the exact safe prepared-CSE receipt, pre-transfer denial leaves the aggregate under the app's registered reverse-disposal entry, post-transfer abort uses only the teardown signal and vectors exact staged-close/unregistration/prepared-CSE/pin cleanup, committing recovery has its truthful variant, arbitrary or evicted IDs return no-allocation `not-found`, and hostile post-step-8 mismatch enters integrity quarantine rather than success or ordinary abort |
| `M2A-RUNTIME-15` | Normal stop aborts work, retires the exact durable generation, resolves staged/candidate entries by preparation identity and cleans their pins first, then snapshots only current, handoff-displaced-retained, and superseded bundles from the bounded predecessor-owner ledger, closes/readbacks the applicable removed-pointer or preserved-successor branch, drains every disposal entry after exact GPU-fence/resource proof, unregisters every terminal child, retires/releases/cleans every remaining owned pin journal/root, and blocks owner release on any unresolved entry; it then aborts teardown and returns one frozen receipt, while repeated close/stop returns the original receipts |
| `M2A-RUNTIME-16` | Double stop is idempotent and returns the original stopped receipt without a second disposal |
| `M2A-RUNTIME-17` | Stop during each startup await, including the runtime-pin manager CAS/readback, makes the synchronous post-readback liveness predicate reject the retired generation before pointer/gate/ownership mutation and converges on stopped with zero owner count |
| `M2A-RUNTIME-18` | Restart allocates a strictly greater durable generation and a new owner; its caller-addressed port view cannot observe, name, or mutate a prior session even when interrupted allocation left a gap, while the sole service-internal foreign-slot effect remains the exact claimed predecessor displacement bound by the verified handoff record and receipts |
| `M2A-RUNTIME-19` | `inspect()` checks the construction signal and initial `snapshot()` checks that signal plus snapshot consistency; every later async completion checks lifecycle abort/generation and operator identity/generation before mutation |
| `M2A-RUNTIME-20` | Operator switch fences the old session, disposes it fully, and cannot expose old admission status in the new operator context; same-generation verified replacement closes/readbacks old gates, terminalizes and transfers the old teardown child to disposal ownership, then unregisters it only after the GPU fence and old-resource disposal; the stale public handle returns only its retained superseded/disposed receipt and cannot close the replacement |
| `M2A-RUNTIME-21` | Suspend/resume callbacks enqueue non-reentrant intents and preserve one participant and owner |
| `M2A-RUNTIME-22` | Close and device-loss callbacks enter the same generation-fenced lifecycle queue; M2A fabricates no renderer recovery |
| `M2A-RUNTIME-23` | Process-owner child registration rejects duplicate IDs, stale generations, invalid kind/role tuples, transfer after release, expected-kind or expected-role mismatch, partial or reversed tuple transfer, cross-owner transfer, snapshot after release, unregistration without an exact terminal receipt, and non-idempotent child cleanup; only the three allowlisted atomic activation tuple transitions succeed, bounded sorted snapshots contain only requested staged/current/handoff-displaced/superseded activation kinds, every unregistration receipt binds the terminal kind and role, and a displaced child remains in its predecessor owner's ledger |
| `M2A-RUNTIME-24` | After accepted admission observation, a valid typed handoff record result is read under the exact profile byte cap only after the trusted manager proves its matching kind-payload root active, reconciles its owner-manager journal, and verifies the required checkpoint binding plus complete graph edge; it proves observed/storage generation and strictly older durable lifecycle lineage, accepts no caller-authored restoration authority, yields only the closed internal current-operator/Realm observation, restores no live resource, and is not merged into public session status |
| `M2A-RUNTIME-25` | Missing, valid cleared tombstone, root-recovery-pending, manager-authority-unresolved, invalid, foreign, stale, profile-mismatched, malformed, oversized, digest-invalid, future-version, or live-handle handoff results reduce through the frozen precedence to one exact sanitized outcome with no second app read or unbounded allocation; clear never resets the durable generation |
| `M2A-RUNTIME-26` | Admission, activation, policy, action, surface, and Engine ports expose no raw backing manager or unauthorized method through returned values; all five activation methods accept/reject their exact prebound shapes, offer transfers only the three branded opaque handles plus the exact frozen safe prepared receipt and internally activates/binds the pin, abort accepts only the teardown signal, and committed is the sole result carrying one live teardown capability |
| `M2A-RUNTIME-27` | Telemetry uses only the fixed event vocabulary, bounded scalar metadata, and owner-attributed counters |
| `M2A-RUNTIME-28` | Native errors, account IDs, partition paths, evidence IDs/payloads, source text, signatures, keys, tokens, and handles never enter diagnostics |
| `M2A-RUNTIME-29` | Production app and test bundle audits contain no Playground runtime import, demo expression, networking capability, RealmForge provider/compiler, or First Shard dependency |
| `M2A-RUNTIME-30` | M0 39/39, Engine foundations 6/6, local operator 10/10, signer completion 6/6, independent Python 6/6, M1A 15/15, M1B 21/21, and M1C 35/35 retain their exact accepted counts with zero skips |

Accepted files:

```text
tests/virtual-realm/
  m2-entry-contract.test.html
  m2-entry-contract.main.js
  m2-entry-contract.test.js
  m2-runtime-composition.test.html
  m2-runtime-composition.main.js
  m2-runtime-composition.test.js
  support/VirtualRealmM2AContractFixtures.js
  support/VirtualRealmM2ARuntimeFakes.js
  fixtures/m2-admission-index-v1-vectors.json
  test_m2_runtime_contract_vectors.py
```

Both browser pages hard-assert their case count and install the startup-error and
unhandled-rejection receipt guard before importing the main module.

The aggregate browser-runner prerequisite is closed:
`virtual-realm-m1a-private-bake.main.js` publishes the terminal
`data-test-status`/body status consumed by
`tests/network/run_realm_browser_tests.py` while preserving the exact 15-case
ledger.

## Acceptance evidence

M2A was accepted on 2026-09-03 with these unchanged-source gates:

- `m2-entry-contract`: 25/25, zero failed/skipped.
- `m2-runtime-composition`: 30/30, zero failed/skipped.
- Independent Python canonical vectors: 6/6.
- M0 39/39, Engine foundations 6/6, local operator 10/10, signer completion
  6/6, M1A 15/15, M1B 21/21, and M1C 35/35, all with zero skips.
- Full WebGPU OS static bundle: 2,791 modules, zero skipped.

The accepted runtime-contract catalog contains exactly 11 definitions across
13 import-inert modules. The original M0-M1C catalog remains exactly 109
definitions in its prior order and byte identity.

The later B4F integration preserves both catalog counts and the 16-key
dependency-v2 ABI. `RealmM2RuntimeComposition` validates local policy after
action authority and before GPU syscall, runtime-profile, or process-owner
acquisition, then forwards the identical validated port in the lease.
Historical B4F evidence recorded 60/60 hostile browser cases and 11/11
independent Python proofs. At that gate, the B4F, shared-dependency, Entry, and
composition closures were exactly 11, 23, 105, and 47 acyclic error-free modules.
Its scoped Python group passed 59/59, or 64/64 including the then-29-module
renderer closure; B4A-B4F plus M2A and B3 browser regressions passed 328/328 with
zero skips.

M2D-B4G now closes the final wire family with the terminal compatibility
singleton and preserves both catalog inventories and the 16-key dependency-v2
ABI. Its focused browser gate passes 24/24. The current B4G, shared-dependency,
Entry, production-composition, and renderer closures are exactly 1, 24, 106,
48, and 30 acyclic error-free modules. See the
[B4G compatibility acceptance ledger](m2-runtime-foundation.md#m2d-b4g-terminal-legacy-surfaceframe-compatibility)
for the integrated regression evidence. B4H is underway: the versioned
host-attempt binding transport is implemented, while the genuine provider,
process-owner and activation composition, visible city, controller, Operations
View, and minimap remain unaccepted. (Sources:
`webgpu-os/apps/the-virtual-realm/runtime/RealmLegacySurfaceFramePort.js`;
`webgpu-os/kernel/realm/RealmRuntimeAttemptBinding.js`;
`tests/virtual-realm/m2-legacy-surface-frame-port.test.js`.)

## M2B service boundary and M2C handoff

M2A passes no process-owner capability, operator-context capability, or app
lifecycle object into M2B. The independently composed trusted service is reached
only through `bakeAdmissionPort`. It owns admission storage, verification,
migration, and recovery outside the application.

After M2B can return a selected verified package through that read façade, the
application carries exactly these preconditions into the M2C loader slice:

- current frozen operator context;
- durable lifecycle generation and its work abort signal; the teardown signal
  never enters the loader;
- process owner child-registration capability;
- the frozen verified package, sanitized summary, and head bindings returned by
  the validated read-only `bakeAdmissionPort`;
- validated runtime capability profile;
- current publication/admission status;
- no acquired Engine, ECS, GPU, audio, input, or presentation resource.

The complete M2B storage, contract, evidence, signature, migration, and restart
protocol is frozen in
[M2B private-bake admission](m2b-private-bake-admission.md).

## See also

- [M1C Storylet and reviewed station bake](m1c-storylet-station-bake.md)
- [M2 runtime foundation](m2-runtime-foundation.md)
- [M2B private-bake admission](m2b-private-bake-admission.md)
- [M2 Engine and ECS foundation](../../engine/virtual-realm-m2-engine-foundation.md)
- [Security and privacy](security-privacy.md)
- [Certification plan](certification-plan.md)
