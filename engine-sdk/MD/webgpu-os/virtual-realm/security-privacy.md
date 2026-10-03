---
title: Virtual Realm Security and Privacy
description: Authority, noninterference, public shells, protected source, hostile manifests, metadata, capabilities, epochs, telemetry, and threat invariants.
audience: security reviewers, network developers, architects, and QA engineers
updated: 2026-09-05
status: M0-M1C product baseline accepted; M2A and the admission-only M2B slice accepted, but integrated M2 remains underway and unaccepted; M3A and M3B remain executable blueprints; RF-GE0-RF-GE5 accepted as inert authoring evidence; RF-GE6 planned
---

# Virtual Realm Security and Privacy

The Virtual Realm treats privacy as an architectural property rather than a visual effect. Public presence, private truth, capability-refined access, Code Matter, Storylets, and multiplayer each have explicit authority and audience boundaries.

## Core invariants

1. A public Cityform is a complete-looking sanitized representation, not an exact private PC model.
2. Private, public, and refinement artifacts compile independently.
3. Changing private-only state cannot change the public shell while public inputs remain identical.
4. Discovery is not identity.
5. Identity is not authority.
6. Proximity grants nothing.
7. Every bridge direction receives a separate capability intersection.
8. Capabilities are object-bound, action-specific, expiring, and default-deny.
9. Security state changes before the corresponding visual state.
10. Every protected packet and refinement binds a current epoch.
11. Bridge geometry is presentation, not enforcement.
12. Remote visual data is hostile input.
13. Public presence is explicit and rate-limited.
14. Chronicles and telemetry are privacy boundaries.
15. Revocation stops future access but cannot erase data already disclosed.
16. Local operator identity is not sufficient by itself; the Operations View requires a current local authority receipt and positive capability epoch for the exact local Realm.
17. The Operations View and minimap are `owner-private + local-private`, are never published or transported, and admit no connected-Cityform or remote-world record.
18. Camera position, map visibility, selection, picking, and local presentation never grant zone-management authority.
19. Connected Cityforms, station approach, Traveler locomotion, gates, and bridges remain first-person; the local owner's Operations View is the only non-first-person presentation.
20. Compiler evidence and publication receipts are local records, not content resources, network payloads, or authority grants.
21. RealmForge Genesis cache hits, invalidation receipts, binding receipts, and recursive package candidates are inert authoring evidence; no later Engine, ECS, OS, renderer, or publisher may treat them as execution, admission, installation, publication, or activation authority.

## Local Operations View privacy boundary

The local Operations View is more sensitive than a public Cityform shell because it derives from the authorized private bake. Its input closure is constructed independently before ECS and rendering. It contains only the exact local Realm, current private bake/layout, admitted local cells, local deltas, and current operator authority. It does not load a mixed encounter scene and hide remote objects afterward.

Connected Cityforms, public shells, remote poses, PresenceSessions, RendezvousFrames, bridges, remote Travelers, station destinations, remote routes, and their IDs are structurally impossible in `LocalOperatorViewSnapshotV1` and `LocalCityMinimapSnapshotV1`. The local station building may remain as local geography, but any external connection terminates at a content-free local boundary marker.

The snapshots never leave the local runtime through SecureMesh, public presence, Chronicle sharing, telemetry, crash reporting, or an in-application streaming surface. The renderer, accessibility projection, object-ID buffer, picking system, and minimap all consume the same accepted local-only closure. A hidden remote GPU buffer or pick record is still a privacy failure even if no visible pixel shows it.

The application cannot prevent operating-system screenshots, screen recording, a compromised same-origin context, or human observation of an unlocked owner-private view. It displays a persistent owner-private indicator, minimizes lifetime, tears down resources on exit or revocation, and makes that limitation explicit.

The local-isometric and local-eagle-eye modes never become traversal cameras. They cannot include a connected Cityform, remote Traveler, bridge, or rendezvous frame. Their zone controls produce powerless proposals that still require the generic authority-receipt, authoritative-observation, and delta path before the world may present a completed change.

## Threat model

| Threat | Required defense and honest limitation |
| --- | --- |
| Curious unauthenticated peer | Receives only a rate-limited beacon and explicitly public shell data |
| Authenticated peer without consent | May remain a destination-board entry; no Traveler, bridge, or private destination appears |
| Authorized peer exceeding its grant | Object, action, direction, audience, expiry, policy, capability epoch, and bridge epoch checks fail closed |
| Malicious signed public-shell publisher | Signature proves publisher identity only; strict schemas, shipped archetypes, resource quotas, and GPU-safe validation still apply |
| Malicious Storylet package | Data-only exact-key parser, dependency closure, proposal allowlist, powerless action port, and authority receipts prevent execution or escalation |
| Replay or stale reconnect | Nonces, transcript binding, shell revision, expiry, capability epoch, and bridge epoch reject reuse |
| Traffic observer | Encrypted protected content, opaque locators, padded or bucketed public schedules where required, and no plaintext-derived public identifiers |
| Compromised renderer | Required target: cannot create kernel authority. Shared-origin executable code is not yet isolated from storage binding or native OPFS; the B4H provider remains unaccepted pending the enforcement gate below. Sensitive input is minimized, but unlocked content cannot be protected from its own compromised consumer. |
| Dishonest local scanner | Coverage and commitments show what the scanner claimed and later byte consistency; they do not prove the scanner was honest |
| GPU or JavaScript memory residue | Bounded lifetime and disposal reduce exposure; browser APIs cannot guarantee secure erasure |
| Screenshot, recording, or human memory | Revocation stops future delivery but cannot retract information already observed |
| Local operator view accidentally joins multiplayer state | Separate local-only projection, exact Realm/owner/bake/layout binding, closed local cell/anchor/zone membership, prohibited network-peer imports, and connected-content exclusion before scene assembly |
| Remote command attempts to open or steer the Operations View | Entry is an explicit local UI action under current local authority; remote, Storylet, station, rendezvous, and bridge inputs have no view-transition port |
| Side-channel through geometry or timing | Independent public compilation and noninterference tests prevent private counts, shapes, adjacency, activity, and timing from changing public output |
| Replayed or cross-audience Genesis cache/package evidence | Exact source and complete context keys, structurally separate audience namespaces, sealed Factory/Plan bindings, deterministic repreparation, and a mandatory later independent admission compile prevent authoring evidence from becoming runtime authority |

### Current shared-origin enforcement gap

The B4H policy, local-selection, and lifecycle-generation head sources use trusted
kernel-module construction. Their exact schemas, view identity brands, scope
fences, monotonic epochs, compare-and-swap, and readback do not establish an
isolation boundary against hostile executable code in the same browser origin.
The static Entry and B3 import-closure gates prove the shipped dependency graph,
not a runtime prohibition on arbitrary imports or browser storage APIs.

The existing exported `StorageManager.bindOperatorServiceRoot()` accepts a
caller-supplied operator scope and current-scope provider. Public descriptor and
view factories are construction APIs, not proof of permission to acquire a
protected root. Separately, `OPFSDriver` obtains the origin's storage through
`navigator.storage.getDirectory()`. Code with the same native origin storage
access can bypass application-level path checks and binding APIs. Hiding paths,
hashing service names, or making a binding token unforgeable cannot alone stop
that backend bypass. This is a current trust limitation, not a newly granted
application capability. (Sources: `webgpu-os/storage/StorageManager.js`
`bindOperatorServiceRoot`; `webgpu-os/kernel/OperatorPrivateServiceStorageView.js`;
`webgpu-os/kernel/schema/OperatorScope.js`; `webgpu-os/storage/OPFSDriver.js`.)

Before activating B4A/B4F adapters or the full B4H provider, the OS must enforce
both authenticated kernel-controlled service acquisition and isolation of the
underlying protected storage from untrusted executable consumers. A verified
runtime boundary may supply both properties, but its evidence must cover
dynamic imports, forged operator contexts, native storage access, and leaked
handles, not only the sanctioned import closure. Merely moving code to another
same-origin module or worker is not an isolation proof. No broader OS isolation
change or provider registration was implemented by this bounded source slice.

The inspected `PackageHostRealm` already omits `allow-same-origin`, but Desktop
does not use it for the Virtual Realm factory/GPU path. Its existing bridge
cannot satisfy B4A/B4F: subscriptions become no-ops, uncloneable results are
dropped, syscall dispatch is reflective, and provider-specific bounded channels
and revocation are absent. Reusing its iframe primitive is not acceptance of
that bridge for authority-bearing Realm ports. Browser tests must prove that
the isolated consumer cannot observe an OS-origin OPFS sentinel, import
privileged code to regain host authority, or use leaked/cancelled capabilities.
GPU/renderer placement and its bounded bridge remain explicit design work;
there is no shared-origin fallback exemption. (Sources:
`webgpu-os/shell/PackageHostRealm.js`; `webgpu-os/shell/Desktop.js`.)

`RealmLocalOperatorSnapshotSource` performs a private read-only coherent join,
not a security-boundary upgrade. Its selection/policy cut can become stale
immediately after return. It neither certifies current capability/lifecycle
authority nor supplies the missing invalidation and isolation mechanisms.
(Source: `webgpu-os/kernel/realm/RealmLocalOperatorSnapshotSource.js`.)

`RealmLifecycleGenerationHeadStorage` supplies a retained per-account/app
reservation high-water mark, not active or terminal lifecycle truth. A read
cannot issue a generation; an uncertain dispatched write may leave a gap and
must be recovered before allocating a new value. Exact predecessor CAS,
non-deletable service grammar, and canonical checks protect cooperative source
operations, not hostile native OPFS writes, profile rollback, browser-data
loss, or storage eviction. Absence after losing previously trusted lineage is
not proof of a fresh lifecycle incarnation. The eventual lifecycle owner must
address that admission boundary and mint only exact-generation teardown
authority for retirement after operator switch; a stale ordinary operator
view must never be rebound as general old-account access. No lifecycle handle,
retirement proof, participant, or provider is created by this source. (Source:
`webgpu-os/kernel/realm/RealmLifecycleGenerationHeadStorage.js`.)

The kernel-only `RealmLifecycleSessionAuthority` now binds a newly confirmed
reservation to the real captured operator and distinct native work/teardown
roots. Ordinary assertions recheck that operator; invalidation is permanent
for this session. A newer reservation is not retirement of another session.
Its authentic single-method handle performs synchronous post-switch retirement
without storage authority. The exact-session observer releases the privately
prepared receipt digest only after the terminal transition; caller labels,
digest strings, handle copies, and unbound method calls do not create proof.
Disposal or work invalidation alone is not retirement. Teardown abort revokes
retirement and observation. This process-local evidence cannot reconstruct
old capabilities, prove earlier-process retirement, or release durable pins.
The approved separate v2 host lease now transports Entry's explicit native root
binding without changing `lifecyclePort@1` or the sixteen dependency keys. This
public session factory is not an authenticated acquisition grant or same-origin isolation.
StorageManager's stale-scope checks are unchanged. (Source:
`webgpu-os/kernel/realm/RealmLifecycleSessionAuthority.js`.)

Only the exact frozen three-field `realmRuntimeAttemptBinding@1` capability
crosses the mount context. The host privately retains capture and closure; the
app gets neither the controller nor ambient access to other attempts. Entry
supplies three distinct, live native roots synchronously before inspection.
Capture requires the identical construction root and live work/teardown roots.
The hook never reserves a generation, grants operator authority, or replaces
the independent allocation/currentness checks. Invalid, mutable, accessor,
inherited, asynchronous, or mixed-version inputs fail closed. Reentrant record
inspection cannot bind after closure; native state, not events or shadow
properties, controls abort decisions. The same live triple is idempotent;
replacement waits for genuine teardown and cannot reuse any earlier root.

Binding closure does not abort caller roots or prove owner/resource retirement,
cleanup completion, or durable pin release. Standard native rejected Promise
receipts are handled without caller `then`/`catch`; exotic Promise species are
not assimilated. These checks assume trusted intrinsics and explicit local
capability construction. They do not authenticate host acquisition, transport
AbortSignals across isolated execution, or protect native OPFS from hostile
same-origin code. The full lifecycle owner and isolated provider remain open.
(Sources: `webgpu-os/kernel/realm/RealmRuntimeAttemptBinding.js`;
`webgpu-os/apps/the-virtual-realm/runtime/RealmRuntimeValidationPrimitives.js`;
`webgpu-os/kernel/AppRuntimeCompositionRegistry.js`.)

`RealmLifecycleAllocationAuthority` privately connects that binding to the
real operator and protected generation service. It rejects caller identity
substitution and snapshots mutable lifecycle requests without invoking getters.
An accepted attempt shares one allocation; construction and final Promise
delivery both recheck scope and all bound roots. Late issued authority is
retired privately or retained cleanup-required, never treated as an unissued
gap. The authentic one-method wrapper routes direct retirement and the source
method through the same underlying retire/observe/cache step while teardown is
live. Close uses only that privately retained genuine evidence, not a digest
supplied by the app, root abortion, or the durable high-water mark. Exact
post-switch retirement performs no old-account I/O. Missing previous-process
evidence remains unavailable. This source adds neither participant authority nor
authenticated host acquisition, backend isolation, or durable resource/pin
recovery. (Source: `webgpu-os/kernel/realm/RealmLifecycleAllocationAuthority.js`.)

Selection and policy sources still grant no capability, network access, local
Operations View, or activation. Full M2 remains unaccepted. The next integration
work and its flat ownership boundaries are recorded in
[B4H genuine authority provider composition](m2-runtime-foundation.md#m2d-b4h-genuine-authority-provider-composition).

## Public noninterference

Public noninterference is the strongest privacy requirement:

> Two radically different private machines with identical declared public inputs must produce byte-identical public manifests and identical canonical public-scene digests.

Public compilation cannot consume private counts, paths, sizes, types, adjacency, hashes, process lists, update timing, glyph patterns, collision, navigation, or hidden eligibility results.

The build fails when public dependency closure reaches a private, unlabeled, refinement-only, or forbidden resource.

### Implemented M1B public-shell enforcement

The M1B compiler accepts an explicit `RealmAudienceSourceProjectionV1`, a caller-authored `RealmPublicAppearanceSourceV1`, and a public resource-limit profile. It exposes no owner-private bake or private-source input. The appearance compiler requires the exact shipped `PublicSecureMeshShellKit` archetype, HLOD, safe-text, gate, socket, protocol, and renderer references. That kit is static appearance data, not a live SecureMesh client, renderer, discovered Cityform, or complete public city. Projection relationship records are validated and budgeted but are not converted into roads by this slice.

The coordinator compiles the same public input twice and canonical-compares the results. A signed `RealmPublicNoninterferenceReceiptV1` records two byte-identical runs, zero private reads, zero cross-audience cache hits, and zero forbidden reachability. This is structural evidence for the supplied public-only inputs; it is not a formal proof over mutations of a real private store. The exact public verifier rejects unknown keys, self-digest mismatches, signature failures, closure drift, cross-record binding failures, local evidence in public reachability, or a nonzero private-access count. (Source: `webgpu-os/apps/realmforge/virtual-realm/RealmAudienceBakeCoordinator.js`; `webgpu-os/apps/realmforge/virtual-realm/compilers/RealmPublicAppearanceCompiler.js`; `webgpu-os/apps/realmforge/virtual-realm/publication/RealmPublicBakePackageVerifier.js`.)

The 13-key compiler result contains the owner-private/local-private noninterference receipt and its signature because the local verifier needs them. It is therefore a verification package, not a transport payload. `publishPublicShell()` creates a stripped public artifact plan that omits the audience projection, caller appearance source, limit profile, local receipt, and local receipt signature. The publication receipt returned by the publisher remains local and is not written into the public content graph. (Source: `webgpu-os/apps/realmforge/virtual-realm/publication/RealmAudiencePackagePublisher.js`.)

## Implemented M1B sealed refinement enforcement

Access refinement begins by reverifying the complete base public-shell verification package and its named refinement socket. The injected authority adapter must echo the exact audience, capability, allowed actions, resource scopes, capability epoch, bridge epoch, and authority context. The scope compiler then requires the supplied payload IDs to equal the capability-refined projection records exactly. Public, owner-private, forbidden, unlabeled, stale, and out-of-scope records fail closed.

The canonical 14-key refinement plaintext binds its base public shell, socket, audience projection, authority context, resource-limit profile, resources, dependency closure, visual manifest, semantic-scene digest, and signatures. The encryption adapter seals it with AES-GCM-256 using a 96-bit IV and 128-bit tag. Authenticated data binds the audience, capability, actions, scopes, epochs, authority, base shell, bake, closure, ciphertext context, key generation, and lifetime. The compiler immediately opens the ciphertext and requires a byte-identical round trip before it emits the signed `RealmRefinementEncryptionEnvelopeV1` and `RealmAccessRefinementV1` roots.

The exact nine-key sealed verifier package contains ciphertext plus explicit authenticated data and a signed owner-private/local-private `RealmRefinementScopeReceiptV1`. It exposes audience identity, allowed actions, resource scopes, epochs, and binding digests in outer metadata; M1B does not claim anonymous refinement metadata. `publishAccessRefinement()` writes the ciphertext under its opaque locator, the encryption-envelope record, non-local signatures, and the access-refinement root. It never writes plaintext, explicit authenticated-data record, local scope receipt, or its signature. The publication receipt also remains local. (Source: `webgpu-os/apps/realmforge/virtual-realm/compilers/RealmAccessRefinementCompiler.js`; `webgpu-os/apps/realmforge/virtual-realm/publication/RealmRefinementBakePackageVerifier.js`; `webgpu-os/apps/realmforge/virtual-realm/publication/RealmAudiencePackagePublisher.js`.)

Key trust, key distribution, rotation, revocation, and durable cross-process nonce allocation remain external responsibilities. The included default encryption adapter tracks nonce reuse only for its own in-memory lifetime. M1B also does not provide live transport, a remote package reassembly API, or delivery of exact source into Code Matter.

## Publication and rollback boundary

Both audience publishers require immutable write/read and active-root read/compare-and-swap ports. They verify the candidate, confirm the expected prior root, write and read back every immutable artifact, reverify, and then perform one terminal root compare-and-swap. Failure or conflict leaves the previous active root selected. Already staged content-addressed artifacts may remain unreachable; rollback does not physically delete immutable data.

The publisher returns a local publication receipt to its caller. That receipt is never part of the immutable artifact plan and cannot become a dependency or authority token. The storage port is an abstract content store, not proof of CDN, SecureMesh, ICP, multiplayer, or network delivery. See [M1B public shell and access-refinement packages](m1b-public-refinement-packages.md) for the exact package and artifact inventories.

## RF-GE2 through RF-GE5 inert authoring trust boundary

RF-GE2 through RF-GE5 are delivered RealmForge authoring gates, not Virtual
Realm runtime gates. RF-GE2 emits a data-only, digest-bound
`GenesisExecutionPlanV1`. RF-GE3 may retain that Plan only in a bounded process-
local cache and may derive one inert `GenesisPartV1` recursive package
candidate. RF-GE4 freezes ten authored-program kinds represented by the accepted
twelve-record golden corpus, eight deterministic interpreter fragments, one
exact context-bound aggregate Plan, and a sealed eighteen-descriptor inert trust
pack. RF-GE5 freezes eleven ecology-evidence program kinds, ten deterministic
evidence fragments, one exact aggregate Plan bound to verified RF-GE4 closure,
and a sealed twenty-one-descriptor inert trust pack. Their records contain no
live implementation, capability, storage handle, ECS command, renderer object,
active-root decision, or runtime port.

The cache namespace is the exact three-field identity:

- `audienceClass`;
- `disclosureClass`;
- `audienceScopeContentId`.

No entry, fragment, lineage snapshot, or explicit invalidation crosses that
namespace boundary. The selected Product Genome audience must equal the cache
audience. The caller supplies exactly eleven context fields:
`adapterVersion`, `audienceClass`, `audienceScopeContentId`, `disclosureClass`,
`featureFlags`, `limitProfileVersion`, `migrationVersion`, `numericProfileId`,
`policyVersion`, `schemaVersion`, and `targetCapabilityProfileDigest`.
Normalization additionally binds the exact compiler implementation and version;
cache implementation and version; constructive domain-pack ID, version,
manifest digest, and publication digest. The cache key binds that complete
normalized context together with the canonical compilation input and its
source-root digest. Feature flags are sorted and unique, and an apparent exact
hit still rejects canonical-source, canonical-context, or context-fingerprint
disagreement as a collision or rebinding attempt.

Only that complete exact hit may return the original frozen Plan,
deterministic-verification receipt, Factory binding receipt, and Plan binding
receipt with zero compiler and verifier passes. Every cold or changed-source
miss executes the full RF-GE2 compiler and deterministic verifier. A changed-
source miss may reuse only immutable dependency-index fragment objects. It does
not reuse a semantic Plan fragment, skip graph or contract validation, or prove
partial compilation. Wall-clock timings are telemetry outside digest-bearing
evidence; deterministic pass and fragment counters are the stable work claim.

The cache bounds exact entries, lineage snapshots, and dependency fragments.
Changed-source diffing computes the reverse closure in both the prior and
current snapshots. Explicit invalidation aggregates reverse edges from retained
fragment metadata, exact-entry snapshots, and lineage snapshots. If FIFO
pressure evicts an intermediate fragment, every retained direct and transitive
dependent is pruned, keeping the fragment map dependency-closed. The resulting
invalidation receipt is bound to the same audience/disclosure/scope namespace
and remains non-persistent and authority-free. The separate
`AssetDependencyGraph` reverse index follows the same trust principle: immutable
version heads and frozen dependency arrays are authoritative, while its shared
reverse adjacency is private, mutable, process-local derived state updated only
after an accepted versioned write. It is not a persistent or digest-bearing
authority record.

The cache constructor accepts only the sealed constructive domain-pack provider.
Factory verification requires the exact self-digest and trusted constructor,
interpreter, stage, and variation-operator coordinates. Plan verification
requires the exact self-digest, compiler implementation and version, and every
stage coordinate. The provider cannot resolve, install, or invoke those
implementations. Exact hits reuse the already verified frozen receipts; misses
repeat both binding checks.

Recursive package preparation accepts only an exact
`GenesisIncrementalPlanCacheV1` instance, invokes the captured base compile
method rather than a caller override, and independently verifies the returned
Plan against the exact source before deriving anything. It then repeats Parts
and Genome graph validation, sealed Factory and Plan binding verification,
Factory package-policy checks, closure resolution, and Interface-surface
derivation. The candidate's ordinary Part content digest intentionally excludes
its logical Part ID, so the internal package identity binds both
`candidatePartId` and `candidatePartContentId`. An existing logical ID and an
equivalent content digest already present under another logical ID both fail
closed. Deterministic verification reprepares the candidate from the exact input
and requires canonical equality.

Any future Engine or WebGPU OS admission path must treat every RF-GE2-RF-GE5
artifact as untrusted-to-runtime input. It must resolve the exact immutable
source, current schema and pack, policy, capability and resource profiles,
independently compile and deterministically verify the Plan, revalidate Factory
and Plan bindings, and then pass the normal execution, evidence, admission,
promotion, rollback, ECS commit, and observation gates. An RF-GE3 cache hit,
package digest, RF-GE4 interpreter Plan, or RF-GE5 evidence Plan cannot
substitute for that independent compile.

RF-GE2-RF-GE5 perform no durable cache persistence, plan or candidate
publication, authored-registry mutation, Factory-stage execution, external-
evidence collection, Part installation, active-head selection, capability or
authority grant, ECS materialization, renderer publication, network delivery,
identity minting, self-modification, or runtime activation. Required package evidence remains
`required-not-collected`, package state remains
`awaiting-external-execution-and-verification`, execution remains
`not-executed`, and publication eligibility remains false. (Sources:
`webgpu-os/apps/realmforge/blueprint/AssetDependencyGraph.js`;
`webgpu-os/apps/realmforge/modeler/genesis/GenesisEcologyConstructiveDomainPackV2.js`;
`webgpu-os/apps/realmforge/modeler/genesis/GenesisIncrementalPlanCacheV1.js`;
`webgpu-os/apps/realmforge/modeler/genesis/GenesisRecursivePackageCompilerV1.js`;
`webgpu-os/apps/realmforge/modeler/genesis/rf-ge3/index.js`.)

## M2 private runtime admission

A selected private manifest is not enough to start the runtime. The current M1
private publisher does not persist the complete private-v2 package, its
resource envelopes, receipts, reviewed station evidence, or referenced
signature envelopes. M2 admits a city only through an owner-partitioned
`RealmPrivateBakeAdmissionIndexV1` that binds the complete canonical package and
external evidence by strong content identity. A manifest-only root returns
`migration-required` and causes no ECS, GPU, audio, input, or Operations
allocation. (Source:
`webgpu-os/apps/realmforge/virtual-realm/publication/RealmBakePublisher.js`.)

The trusted admission verifier resolves every required signature envelope,
recomputes the private M1C package, and checks current policy before it returns
a frozen verified package to the loader. The Virtual Realm app receives no key
resolver, signing key, RealmForge compiler, station provider, or raw evidence
store. The kernel-owned service composes publication lookup, exact-byte content
storage, evidence resolution, signature closure, M1C verification, migration,
and admission-head mutation. The app receives only the read face of
`bakeAdmissionPort@1`: head status and load of one currently selected, fully
rehydrated, frozen verified package. Its separate runtime verifier checks only
M2 compatibility, local-only closure, resource ceilings, and materialization
constraints.

The service, not RealmForge or the app, generates each admission operation ID,
freezes the proposed head and timestamp, writes the fixed proposal plus durable
intent, and CASes a fixed pending slot carrying prior terminal-audit lineage
under the maintenance fence. Only verified pending-slot
readback makes the intent/proposal graph a discoverable GC root. After releasing
maintenance and acquiring selection, the service rechecks that slot plus absent
result/dispatch before writing a dispatch marker and mutating the head; a
separate durable marker bounds its sole recovery-retry opportunity. The result
is archived in the matching fixed terminal slot, and exact reclaiming deletes
only the unchanged five-operation control set before reuse. A caller cannot nominate an operation ID, control path, operator
partition, resolved key, or evidence object.

The admission index binds the exact canonical package blob, a separate bounded
chunked inventory for resource, authoring-evidence, and signature bindings, ten
package-member bindings, verifier/profile revisions, logical artifact keys,
byte lengths, and its own semantic digest. Stable resource IDs never address
immutable bytes. Exact-byte blob IDs, Realm semantic content IDs, RealmForge
hashes, and logical keys retain their existing namespaces and validators.

Admission data lives below a kernel-only operator/service root outside the
generic app-writable `/user` tree. Ordinary write, move, copy, delete, trash,
version restore, and backup restore cannot address it. The content port performs
bounded cancellable raw exact-byte reads; the legacy unbounded base64 blob read
is not an admissible M2 path.

`RealmAdmissionSelectionCoordinator` is one same-origin operator/private-Realm
fence shared by production M1 private-head, current admission-policy, the single
five-role Realm-scoped Ed25519 key/revocation policy, M2 admission/rollback, and final activation
authority paths. Admission, durable root producers, and collection use a
separate operator/service maintenance fence. Admission releases maintenance
after verified pending-slot readback before acquiring selection; the fences are
never nested in reverse order. Neither receipt claims exclusion against an
external process. A backend or writer that cannot join its assigned fence fails
the M2 gate.

Final activation also reads the trusted service clock while retaining selection
and requires the durable commit-authorization instant to remain inside every
verified signature envelope lifetime. That clock persists one nondecreasing
Realm high-water head
through exact predecessor/proposal CAS, physical storage-SHA lineage, semantic
observation lineage, bounded stat-before-read, and exact readback beneath a
separately branded kernel-only non-versioned service view. Outcome uncertainty,
rollback, malformed lineage, or restart discontinuity denies activation. The
app's monotonic presentation clock is not signature-time authority, and an
expired proof cannot make a staged candidate visible. After exact durable
runtime-pin authorization readback, the first phase of the same synchronous
no-await block rechecks bound work-root, activation-state, operator-generation,
lifecycle, and owner liveness, then makes a second nonpersisting trusted-time
safety check bound to that physical manager SHA. It advances no durable high-water authority: the
persisted commit observation remains the lineage point. Expiry, rollback,
unavailability, or binding denial performs zero pointer/gate/ownership mutation
and retires the authorized candidate pin.

Future collection cannot enumerate hash-named paths. Bounded root, artifact,
and evidence-binding directories must discover every admission/durable root,
every service content blob, and every provisioned evidence/signature payload.
Realm-scoped prepared/active/abandoned/released roots require exact kind payloads,
owner-manager journals, target verification, and successor-active retirement
authority. A handoff payload's complete graph edge keeps its checkpoint root
reachable until exact edge-release readback. The collector uses deterministic cursor batches,
fixed candidate/progress controls, and exact quarantine/delete observations,
and aborts the whole pass on any missing, corrupt, incomplete, unregistered, or
contradictory authority. Collection is disabled until all directories,
historical backfills, journals, and recovery receipts are certified.

Opaque M1C evidence references resolve only through absent-only Realm-scoped
bindings written by an authenticated provisioner under one immutable evidence
policy. Storylet-authoring evidence additionally requires a single-use review
authorization, exact reviewer identity, and the complete policy invariant set.
The closed four-kind evidence table and six-row/five-role signature map admit
exactly four-or-five signature envelopes. A signature key must be currently
active; a pre-revocation timestamp is historical evidence, not activation
authority. Public SPKI is imported as a verify-only key
inside the trust adapter; raw evidence, key bytes, and resolver capabilities do
not cross into the application.

Admission evidence, receipts, compiler diagnostics, and signature envelopes
stay outside ECS, render resources, semantic mirrors, Operations snapshots,
telemetry, and captures. M1C Storylet definitions, templates, cues, candidate
index, subclosure, and catalog remain inert immutable records throughout M2.
Public-shell and access-refinement roots are structurally unavailable to the
base M2 private loader.

Publication, durable admission, and runtime activation use independent heads
and receipts. A successful transition in one plane never authorizes or implies
another. Before dispatch, failure preserves that authority. After admission CAS
dispatch, reconciliation may prove either the exact predecessor or proposal;
committed storage is recorded even if current verification makes it ineligible.
Operator switch, failed staging, process restart, device loss, stale policy, or
committed-ineligible admission never changes the visible city until a complete
replacement passes the separate activation barrier. That barrier retains the
selection fence and closed frame/input/source gates while it reasserts both
heads, current admission/evidence/trust policy, signature closure, the exact
registered runtime profile, and trusted-clock lifetime. It first readbacks the
exact runtime-pin `visible-committed` authorization record, then makes the bound
immediate-liveness and immediate-time predicates the first phase of one
synchronous no-await CSE/pointer/ownership/gate-open block before releasing the fence. Every
active-bake CSE writer uses the same fence and reasserts the exact predecessor,
so that block cannot discover a late conflict after closing old gates.
The prepared active-bake CSE capsule binds the canonical generation-zero
inactive predecessor for first activation or the exact active predecessor for
replacement, the exact safe prepared-commit receipt/digest, the next exact active-bake output record, a separate acyclic
expected step-8 swap-receipt digest, and zero external-effect intents plus the
exact empty outbox digest. Live visibility binds the actual returned swap
receipt before pointer/gate opening; durable authorization alone cannot claim a
displayed bundle or dispatch an action or network/storage effect.
An impossible post-step-8 receipt/shape mismatch is explicit integrity
quarantine: both gate sets stay closed, no pointer or ownership success is
published, and restart must reconcile the authoritative CSE record before any
Realm presentation. It cannot be mislabeled as an ordinary abort.
Predecessor, uncertain manager state, immediate-liveness denial, or immediate-time denial exposes no
candidate. Same-generation verified replacement moves the old terminal teardown
child and resources to disposal ownership after gate readback; only the GPU
fence and exact resource disposal permit child unregister and old-pin release.
Candidate-abort and terminal replay are bounded, opaque IDs use a narrow kernel
CSPRNG port, prepared/offered/committing cleanup has truthful exact receipts,
abort runs only through the still-live teardown signal after work-root abort,
and stale superseded/disposed teardown handles are no-effect. A
close receipt binds authoritative lifecycle-retirement evidence separately from
the caller's requested reason.

Static checkpoints and stable handoffs use separate monotonic heads, tombstones,
root references, and fixed owner-manager journals. Neither record is readable as
resumable until its matching root is proven active. A checkpoint request is
reasserted against a trusted current-active/head/profile/anchor/cursor/policy
projection; commit holds a narrow activation-selection source lease through head
CAS and normal root readiness and stores the exact source authorization. Exact
predecessor or source change returns explicit nonpublication and complete
prepared-root abandonment. The handoff manager accepts only a one-field
Operations preference draft and requires a single-use process-local service
authorization; it injects every owner/lifecycle/head/profile/bundle/anchor/
cursor/policy field from the exact checkpoint binding, retains the complete
protected graph edge in the handoff root payload, and verifies both before read.
Old checkpoint/handoff roots retire under exact successor-active authority, and
retirement of the checkpoint named by an active retention edge remains blocked
until a released handoff root releases that edge. One successor checkpoint may
use the free bounded current cell while the predecessor is retained; a third
cell fails closed. A new session must activate
its own runtime pin and complete the guarded visible commit before it clears the
handoff; the old session retains its own current pin through lifecycle
retirement, close, GPU fence, and resource/child disposal rather than entering
the new session's same-generation disposal ledger. These internal records never carry source bytes, live handles,
capability tokens, partition paths, or public presence.

After process restart, the loader re-observes the versioned M1 private head and
requires its scope, root, generation, and exact storage SHA to equal the selected
admission index. It also requires the exact current admission policy, immutable
evidence policy, authenticated evidence bindings, five-role trust policy, and
currently active verification keys. Mismatch returns `stale-publication`,
`current-policy-rejected`, or `current-trust-rejected` before runtime
allocation; historical immutable bytes remain evidence, not current authority.

The current storage authority proves cooperative same-origin serialization and
explicitly does not prove external-process CAS. A stale-operator write may have
committed inside the old partition; it is reconciled only after that operator is
current again through a newly captured storage view. It is never inspected from
the replacement operator context.

The exact trust and restart protocol is frozen in
[M2B private-bake admission](m2b-private-bake-admission.md); the app capability
surface is frozen in [M2A runtime composition](m2a-runtime-composition.md).

## M3A local observation ingress

M3A creates no public or remote audience. Its app-facing
`realmObservationIngressPort@1` is prebound by the trusted OS to one exact
operator partition, Realm, operator generation, process owner, M2 lifecycle,
active bundle/CSE output/visible commit, publication and admission heads,
runtime profile, `owner-private + local-private` audience, and separately
verified M3A safe-normalization/profile/catalog/manifest policy plus the current
kernel pseudonym-key authority, epoch, and commitment. That portable receipt is
produced by one read-only selection-fenced continuation projection from M2's retained initial operator
projection plus current assertions; M3A cannot invoke another initial operator
snapshot. The same projection exposes a post-loss ready presentation only with
the conditionally present accepted `RealmDeviceRecoveryReceiptV1` ID/digest and
a twice-equal kernel-only verification of its lost/replacement generations,
runtime bundle, restored source binding, and resumed state.
A separate process-local M3A
extension-child claim binds opaque work/teardown roots and never enters or
widens M2's frozen child ledger. The caller cannot request another audience,
scope, child, root, or replacement binding.

Raw WebGPU OS authority data crosses no app boundary. Trusted adapters perform
irreversible kernel safe normalization first; M3B later performs only a pure
semantic disclosure over those already safe records. The Realm ledger stores
neither raw source events nor a reversible redaction cache.

Opaque local identities use only the restricted
`realmObservationPseudonymKeyPort@1`: a durable random 256-bit operator-partition
key remains kernel-private, while its authority ID, monotonic epoch, and HMAC
commitment bind every portable receipt, cursor, and checkpoint. The port accepts
only bounded raw identity bytes plus a manifest-owned source/rule and returns one
full HMAC pseudonym; it exposes no key, preimage, generic HMAC, or storage handle.
Consumer restart preserves the epoch. Explicit key rotation atomically changes
the key/commitment, advances all seven source generations, invalidates every old
cursor/checkpoint binding, and requires fresh bounded snapshots before append.
Kernel-only append-only references retain old ledger-segment, checkpoint, and
recovery-journal epochs until exact type-matched retirement evidence and graph
closure permit release. Old key material retires only at verified zero
references; an atomic terminal binding-drain CAS releases the complete final
old-binding reference set without deleting its immutable data roots, and
authenticated metadata remains as a non-reactivating tombstone. The drain reason
is derived through a seven-row continuation precedence map that keeps
normalization-policy change distinct from M2 binding change, then immutably
latched so later state cannot reclassify a retry. Exact released/absent-after-
restart aggregate evidence gates retirement. Projection issuance and row
registration are atomic; a live acquired generation requires object-identical
close, a zero-issued generation requires sealed nonissuance, and only a durably
retired generation may use a cumulative zero-handle/zero-in-flight fence. The
aggregate evidence, retirement record, and CAS bind the current proof plus every
required prior fence, or the sole absent fence. A blocked drain reveals only
bounded reference/edge digests plus a closed seven-kind condition and count
projection, never live-handle identities, operation identities, logical keys,
secrets, or raw edges.

The seven-source M3A manifest binds every row to its exact adapter, port,
already implemented M0 source-schema versions, normalization-profile pair,
retention class, and explicit degraded-start rule, then enforces these threat
boundaries:

| Source | Required security property |
| --- | --- |
| Boot | No raw log, exception, stack, environment, credential, path, fingerprint, or inferred readiness |
| Canonical filesystem/storage | One raw mutation becomes one primary M0 observation; no raw path/name/content/hash/handle/key/value/journal/protected-root/error, host scan, double count, or recursive observation of M3A's own storage |
| Process | Opaque identities and explicit quality-labelled metrics only; no command, argument, environment, credential, private UI, handle, source path, manifest, or stack |
| IPC | Opaque endpoints/classes/lifecycle/metrics only; no payload, transfer, port, callback, token, credential, name, or reflected error |
| Syscall | Guard-bound typed lifecycle and retained correlation only; no argument, result, path, value, byte, key, handle, command, stack, or dispatch authority |
| Authority | Strict permission/action-result allowlists; no token, signing/approval material, manifest, predicate, rule graph, raw audit log, authority method, or unverified receipt bytes |
| Local network | Local boundary state only; peer identity/count, remote presence, address/URL, ICE/SDP, packet/message, ticket/capability/membership, contact, Traveler, Cityform, station occupant, and remote Operations state are structurally absent |

The cursor and ledger protocol treats delivery ambiguity as evidence, never as
permission to guess. Byte-identical duplicates are idempotent; a same-sequence
byte conflict quarantines the source. Gap or overflow preserves the last
accepted cursor, marks that source stale, and requires a fresh bounded snapshot.
Recovery freezes a process-independent semantic opening-cut digest, binds its
attempt-specific recovered receipt byte-for-byte to the referenced opening
receipt, and proves either one or more consecutive committed appends cover the
exact nonempty cut or an empty no-record commit preserves the verified ledger
head. It never fabricates an empty batch or equates distinct attempt receipts.
Security, failure, authority, denial, revocation, expiry, lifecycle, and
causally referenced records cannot be coalesced away.

M3A uses a separate protected checkpoint sidecar with an exact closed, ordered,
4,096-edge-capped, self-digested, target-resolved complete edge set only to its
own required ledger/causal/authority/recovery/projection roots. The portable
M2 binding is equality-validation material, not a retention edge: only lawful
M2 roots keep M2 state alive, and M2 retirement makes an old M3A checkpoint
stale. M3A does not widen M2 checkpoint/handoff V1, and M2's advisory logical
cursor is not M3 restore authority. No listener, ring, handle, callback, abort
controller, port, raw record, key material, work root, or GPU object is
serialized; only the bound key authority ID, epoch, and commitment are portable.
The exact compaction union derives only the oldest excess closed-segment prefix,
proves its boundaries and three checkpoint-derived retained-root digests, and
while the binding is current releases segment epoch references only after
committed readback; the complete-set terminal drain is restricted to a proven
retired binding. After prior
normal releases settle, teardown aborts and settles projection calls, verifies
the object-identical identity-projection close, freezes the current live-
resource cohort, and pairs each row by kind/ordinal/binding while independently
proving its owned-to-released state/digest transition before the single
aggregate release.

The exact profiles, port unions, source allowlists, ledger/checkpoint receipts,
lifecycle, hostile cases, and `VR-M3A-*` gates are frozen in
[M3A Observation Ingress](m3a-observation-ingress.md).

## M3B disclosure and dynamic projection

M3B consumes only M3A safe-normalized `owner-private + local-private` bytes. It
cannot make an unsafe record safe, reconstruct raw input, or widen audience. Its
V1 disclosure operation is exactly preserve byte for byte or omit with one
closed reason. M3B never assigns the same observation identity to altered bytes.

The app receives exactly three prebound ports:

```text
realmObservationBatchReaderPort@1
realmProjectionContextPort@1
realmProjectionCommitPort@1
```

Each port projects the same exact 53-field logical binding pair but has a
different code-shipped ten-field descriptor: `format`, `version`, `portName`,
`portVersion`, `bindingContractVersion`, the runtime-binding pair, ordered
`methodRows`, `maximumRequestBytes`, and `descriptorDigest`. Every method row has
exactly `methodOrder`, `methodId`, `resultKindIds`, `resultDomainId`, and
`rowDigest`, and uses the closed domain
`particle-realms.m3b-port-result/<portName>/<methodId>@1`. The exact reader,
context, and commit request ceilings are 65,536, 33,554,432, and 536,870,912
bytes. Every non-descriptor call uses the exact request-bound eight-key result
envelope with format `particle-realms.m3b-port-result`, version `1`, and the
descriptor's closed per-method status/payload union. Its ID binds the method-
specific result domain and canonical data-only request digest; that request
digest begins with the descriptor's exact `portName` and `methodId` before the
ordered field-name/value projection. Caller signals are
identity-checked but excluded from canonical request bytes and byte accounting;
the result digest covers the exact eight-key envelope with only itself omitted.
An empty or reason-only result therefore cannot replay across methods.
Presentation/device/current-authority state is a separate 14-field ephemeral
fence.

The exact 14-field M3B catalog receipt binds an embedded 17-field code-shipped
reference-descriptor pack and a compiled 12-field registry. The sole 21-field
source matrix freezes exact import/shape/recovery/domain/carrier/producer-seed/
producer-variant/direct-edge/alias-source/literal-alias/reference counts of
3/6/9/50/78/87/111/111/108/105/137. The pack has exactly 50 definition
descriptors, 50 dependency extractors, 78 source-authority rules, and 78 producer
predicates; the registry has exactly three accepted imports, 50 domains, and 78
carrier rows. Every selector/condition operator has a fixed
arity and typed operand shape, every path has an explicit scope, every owner and
resolver is pinned, and every allowed producer-consumer edge is hash-derived.
Unknown rows, host-language predicates, ambiguous aliases, or root/M2-target/
pinned-import role substitution fail before allocation.

The reader exposes only the next bounded M3A batch, exact safe record bytes,
exact variants for all seven source-state slots, one exact nested source-
generation extractor, M3A-owned durable tick evidence, and evidence-complete
retention/source/escrow state. `ready` and `source-state-ready` include the exact
11-field M3A retention projection, complete 15-field candidate escrow manifest
with embedded canonical bytes, and canonical `readCallReceiptBytes` for the exact
18-field receipt plus its pair; `idle` proves the last source snapshot is byte-
identical and creates no escrow or artifact. A verified
gap may report retained-head/floor state and recovery references but never
partial records or authority to ACK, checkpoint, compact, or recover M3A.

The context opens/closes one independently generated extension-child session.
Static resolution accepts only subject IDs and returns their complete authorized
projection-binding and anchor closure; callers cannot supply or probe anchor
IDs. Every `ready` or `missing` response returns canonical
`staticResolutionReceiptBytes` for the exact 24-field receipt plus its pair, with
disposition respectively `complete` or `partial-missing`. For
every structurally valid permission/action-result record, recorded authority
resolution occurs before the 28-field observation cut and disclosure decision
freeze and returns the complete 15-field receipt/signature/trust/correlation
escrow manifest plus canonical `authorityResolutionReceiptBytes` for one exact
21-field maximum receipt vocabulary and the complete current snapshot bytes. The
19-own-key recorded-mode receipt variant forbids the current pair, keeping
ephemeral current state out of the durable cut and escrow. The 13-own-key
current-only variant forbids
recorded batch/source/escrow fields. The separately scoped current-authority
value is one complete 13-field `resolved` or `unavailable` snapshot bound by the
fence and can only preserve or close a recorded gate. No empty, partial, or
caller-fabricated current snapshot can mean success, and the context returns no
token or authority method.

The commit port reads a complete immutable prior base plus the root-store-
authored candidate lineage-floor anchor, reruns the neutral shared semantic
kernel, prepares the complete bundle off-active, keeps separate 24/18/18-field
application/recovery/selector-retirement journals under one shared quota, and
performs one durable selector CAS. It reconciles uncertainty, owns the exact
37-field recovery receipt bound to terminal recovery-attempt evidence, detaches
sources through the exact 24-field receipt, settles candidate leases, and moves
already root-store-owned current or lineage roots/escrow/leases internally to the
retained owner. It returns exact close and 21-field quarantine-to-retained
evidence. No port exposes a raw M2 continuation, store,
ECS/Engine/CSE object,
renderer, GPU object, capability, source ACK, ledger append, M3A checkpoint
writer, or topology/bake authority.

Expiry accepts only the exact service-issued due receipt grounded exclusively in
M3A-owned durable tick evidence. Teardown uses the separate exact 18-field
selector-retirement record, 24-field detach receipt, and 21-field quarantine
receipt under the shared aggregate quota.

Application, recovery, detach, and quarantine receipt IDs/digests are
constructive rather than prose-defined. Conditional variants bind a fixed-order
Boolean presence vector and exact ordered field-name/value rows, so omission is
not interchangeable with `null`. Quarantine also binds each operation-evidence
row to its selected journal schema and persists an exact ordered ten-field
resource inventory under its count/aggregate digest. Missing, duplicated,
cross-kind, reordered, session-owned, or already-settled entries fail the
all-or-nothing ownership transfer.

Eight primary projectors uniquely own the nine M3A kinds.
`RealmPermissionProjector` owns both `permission` and `action-result` inside one
authority domain, preventing double consumption and keeping terminal-success
correlation under one owner. `RealmHistoricalWitnessProjector` owns no kind,
reads no raw or omitted observation bytes, and accepts only one complete already
accepted historical primary outcome. It emits at most one nonrecursive
historical presentation Delta by reusing the exact accepted primary command; it
never mints or rewrites a second command and cannot influence current state. A valid
zero-primary-output historical outcome is still consumed exactly once and emits
one zero-output witness outcome; historical primary deltas remain closure-only,
and only an emitted witness artifact may enter the disabled historical store.

The exact 41-field projection batch carries equal-length dynamic
`presentationCommandIds` and `presentationCommandDigests` arrays. Presentation
commands are not a fourth static carrier. Every command must join exactly one
batch pair, one pure-compiled or retained-origin protected-closure byte object,
and at least one admitted ID-only presentation Delta. Free, missing, uncited,
conflicting, or multiply resolved command bytes reject the candidate. Command
bytes count through protected closure, never `deltaByteCount`. Command
identity binds runtime binding, projector, observation, slot, binding subject,
selected anchor, command kind, and content digest; current-presentation semantic
identity is independently derived.

M3B applies one exact semantic-axis transition matrix and never upgrades
provenance, evidence quality, availability, freshness, temporal mode, assertion
state, truth, or authority. Historical completion requires the exact authority
receipt to have verified for its recorded decision/dispatch/result chain plus the
matching terminal M3A action-result observation. Current grant/epoch/revocation
state never enters DynamicStore, ECS, State-First, root, or replay identity.
Current gate visibility and interaction are a separate trusted-adapter
conjunctive mask over the complete fence-bound snapshot, source health, and
expiry. The authority owner invalidates the fence before publishing a change or
wake; the adapter may preserve or close a gate, never open/grant one. Later
revocation does not rewrite history, and historical success never grants present
access. A permission record, receipt reference,
projection, selector receipt, State-First source, or render result alone is
insufficient.

The only admitted M3B delta operations are `entity`, `route`, `gate`, `traffic`,
`structure`, and `presentation`. Code Matter, station/bridge routes, public
objects, remote presence, Genesis, topology, collision, navigation, HLOD,
sockets, static IDs, and bake mutation are structurally rejected. An unbound
filesystem structural event produces zero geometry plus at most one bounded
powerless M3C review row; it can mark an already bound object stale/partial only
where an existing M0 operation permits.

Every base-M3B IPC, syscall, and network route is `non-traversable`. M3A admits
six local-network event variants; `authenticated` is unrepresentable because it
requires `peerIdentityRef`, and peer authentication remains M5 work.

Input cuts are exactly the closed 28-field observation-batch, source-state, or
expiry variants. The latter two emit one maintenance outcome and no M0 delta. A
bundle-wide seven-slot health/generation/expiry overlay uses the exact nested M3A
source generation and protected finite-expiry authority pair. Source-state uses
the changed M3A-owned snapshot tick and applies every newly due fail-closed meet.
Only current traffic derives finite expiry, exactly as saturating cut tick plus
one; every other primary Delta uses expiry `"0"`.
Expiry is legal only when a newer source snapshot preserves the seven slot bytes
and supplies the exact 16-field `RealmProjectionExpiryDueReceiptV1`; that receipt
proves the least finite boundary strictly beyond the prior frontier is due under
M3A-owned tick evidence. Wall time, callbacks, wake order, retry, and frames
cannot issue it. The overlay can mask every affected entry without an unbounded
per-entry rewrite; it can only stale, deny, deactivate, detach, remove, or clean
already ineligible state. It never reactivates an older-generation entry,
rewrites recorded history, grants authority, or advances the M3A batch cursor.

Stateful same-key projection is sequential: app and trusted prepare independently
reconstruct the exact `transitionBase` chain, apply exhaustive DynamicStore
lowering, retain every Delta/outcome in protected closure, and materialize only
the final candidate. The exact 16-field pre-freeze work-count plan covers all 15
work components; the conservative independent-ceiling sum is 347137 without
claiming simultaneous attainability across exclusive cut kinds.

One separately versioned M3 transaction capability builds an immutable 27-field
bundle off-active: self-contained 37-field root/root-owned evidence closure,
cursor, six-channel DynamicStore, full stable-ID ECS overlay, flat unique
dependency-complete semantic-only State-First source, seven source slots,
identical floor anchor, generation, and covering M2 artifact lease. Acceptance,
the 42-field intent, candidate closure, floor, and root remain lease-neutral and
bind only the deterministic lease-target set. Trusted prepare alone acquires a
nonexpiring service-only root-store-scoped lease after replay and readback;
`logicalExpiryTick` is `0`, and finite or caller-renewable leases are rejected.
One durable ten-field selector-generation CAS is the sole logical linearization
point. A process-local mirror, GPU upload, and rendered frame are not commits. A
failure before durable dispatch changes no selector. A proven competitor
produces `conflict`. Any ambiguous post-dispatch result is `recovery-pending`;
the durable journal and selector must prove committed, conflict, or noncommit
before retry. The applied cursor cannot advance an M3A source ACK, ledger head,
floor, checkpoint, compaction decision, or recovery state.

Every root closes exact input/source, M3A retention/source/checkpoint/recovery/
tick and reader-escrow evidence, subject-resolved static targets, recorded
authority receipts/signatures/trust/correlation and authority escrow, the due
receipt when present, observation, outcome, delta/payload, store-entry, full-ECS,
State-First, and lineage bytes through frozen per-kind traversal. Every
`root-object` occurrence resolves one root-owned canonical entry, every
`m2-target` occurrence resolves one separate deterministic lease-target row,
and every `pinned-import` occurrence resolves only through its accepted catalog;
the three roles cannot substitute. Required M3A/authority bytes are root-owned
canonical copies. The 12-field candidate lineage-floor
anchor is a root-store-authored root-owned closure entry without a candidate-root
backlink, closing the bounded suffix without a cycle. Four roots and the
aggregate-byte ceiling apply to current, candidates, lineage-retained, retained-
owner, and quarantined evidence. A selected root, escrow, and nonexpiring lease
are already root-store-owned after selector readback; normal disposal only moves
them internally from current-selection ownership to the durable retained owner.
Unresolved ownership alone transfers to bounded quarantine.

Binding replacement is not a cut. Context supplies the exact 21-field empty/
present predecessor descriptor; detach accepts only those bytes and issues the
exact 25-field transition receipt after selector retirement, complete M2 static
fallback, and ECS/State-First detach evidence. The successor session remains
ineligible until the predecessor is proven retired. Terminal disposal is one
exact 38-field receipt with reader/context/extension/commit close evidence, an
always-present 15-field candidate-lease settlement receipt, conditional retained-
root/transition/quarantine pairs, and exact 16-field before/after resource
snapshots. Their counters are exactly `candidateCount`, `preparedCount`,
`readerEscrowCount`, `candidateLeaseCount`, `sessionCandidateRootCount`,
`callbackCount`, and `inFlightCount`; these are session-scoped service resources,
never app-owned handles. Every after-transfer count is zero, and each before-
snapshot member maps exactly once to terminal evidence.

M3B registers only the existing `projection-root` resolver. Registration does
not create a checkpoint edge. Only the M3A checkpoint owner may include the
existing `checkpoint-to-projection-root` edge during its ordinary commit. M3B
has no request/write/release method and defines no duplicate checkpoint-link
receipt.

The exact M3B hostile inventory is:

| Threat | Required safe result |
| --- | --- |
| `M3B-T01` included-byte substitution or widening | Reject the complete cut |
| `M3B-T02` omitted-record resurrection | Reject and quarantine the result |
| `M3B-T03` primary-owner spoof or cross-projector output | Reject the complete batch |
| `M3B-T04` cross-binding/operator/lifecycle/key-epoch replay | Reject before allocation |
| `M3B-T05` filesystem topology laundering | Zero geometry; bounded structural evidence only |
| `M3B-T06` permission-only, forged, time-shifted, stale-fence, or incomplete-current-authority success | Require recorded-time chain evidence plus a complete synchronously invalidated current-authority mask; historical completion never grants current access |
| `M3B-T07` delta or semantic-key equivocation | Quarantine the complete batch |
| `M3B-T08` duplicate/gap/reorder cursor corruption | Exact idempotency or visible recovery block |
| `M3B-T09` count/byte/work/root/aggregate/journal/escrow/quarantine exhaustion | Reject or retain explicitly owned evidence without partial state |
| `M3B-T10` stale or cross-bake anchor binding | Zero output or stale-binding rejection |
| `M3B-T11` torn state apply or divergent in-memory mirror | Durable selector chooses one complete bundle; hide dynamic presentation until reconciliation |
| `M3B-T12` blind retry or false noncommit after uncertain CAS | Retain and reconcile exact journal/selector/intent evidence |
| `M3B-T13` forged root, evidence escrow, lease target/receipt, lineage floor, reference-descriptor/registry edge, or checkpoint edge | Reject; use complete static fallback if needed |
| `M3B-T14` pre-recovery device apply or early reveal | Keep dynamic presentation closed and static visible until head/floor/cursor/source/authority/expiry catch-up and protected closed-to-ready transition |
| `M3B-T15` live handle/function/callback/Promise/object smuggling | Structural rejection |
| `M3B-T16` diagnostics or reflected-error exfiltration | Fixed redacted code/count/bucket only |
| `M3B-T17` witness influence on current state | Reject witness output and preserve primary state |
| `M3B-T18` journal/selector/lifecycle ABA or post-stop completion | Exact attempt/generation/transition fences, durable healthy-root ownership, and no mutation |
| `M3B-T19` RF-GE authoring/cache/candidate treated as execution | Reject before projection/application |
| `M3B-T20` renderer/geometry/topology/public/code/Genesis/station/bridge/remote mutation | Reject the complete candidate |

Device loss changes no logical binding/root/selector. It closes dynamic
presentation while the complete M2 static city remains visible. M3A may continue
bounded CPU admission. After accepted M2 recovery establishes a `recovering`
fence, ordinary prepare/commit may advance only a contiguous same-binding CPU
catch-up and every resulting selector stays hidden. Commit-port
`recover(device-resume)` then independently verifies retained head/floor,
cursor/source/authority/expiry catch-up and selector readback and owns the one
durable recovering-to-ready presentation-gate transition. No CPU catch-up commit
may reveal itself or issue the ready fence.
Operator, M2, M3A, pseudonym, or logical-binding replacement retires the old
session and starts a separate strict M3A-batch-1 genesis; it is not an input-cut
or recovery rewrite. Bake/layout divergence stops incremental application and
hands evidence to M3C. Missing or corrupt state, a released, invalid, or
noncovering lease, an over-limit closure, or unresolvable M3B evidence falls back
to the complete accepted M2 static city.

The exact schemas, result unions, limits, state machines, cases, and gates are
frozen in
[M3B Disclosure and Dynamic Projection](m3b-disclosure-projection.md).

## Security boundary versus visual boundary

- The kernel and Realm Shield enforce authority.
- RealmLink establishes authenticated, capability-aware communication.
- WebGPU OS syscalls confine resource access.
- The renderer displays the resulting state.
- A gate, ticket, platform, bridge, glyph veil, or Storylet has no independent security power.

A compromised renderer cannot create authority by drawing an open door. This
does not claim that hostile same-origin JavaScript is confined by the current
storage APIs; the [shared-origin enforcement gap](#current-shared-origin-enforcement-gap)
must be closed before provider activation. A compromised remote shell cannot
execute because shells contain data-only references to shipped safe archetypes.

## Hostile public manifests

Public shell validation rejects:

- Unknown schema or incompatible version.
- Invalid signature, expiry, identity, or content ID.
- Oversized arrays, geometry, textures, glyph sets, bounds, or nesting.
- NaN, Infinity, invalid transforms, or numeric overflow.
- Arbitrary JavaScript, shaders, WASM, workers, or executable expressions.
- External and arbitrary URLs.
- Filesystem paths or native handles.
- Unshipped archetypes.
- Unapproved material features.
- Resource graphs that exceed depth, count, byte, time, or GPU budgets.

Signing a malicious manifest does not bypass schema validation or quotas.

## Identity and consent

- Raw discovery may create an unattributed distant signal.
- A signed identity and valid Realm Passport permit attributed public presence.
- Mutual presence consent permits Traveler arrival.
- Capability negotiation permits specific actions or destinations.
- A shell signature proves publication by an identity. It does not prove correspondence to the private PC.

`meshStatus()` intentionally provides bounded peer metrics and cannot substitute for authenticated Traveler identity. Identity comes from the Realm Passport and RealmLink path.

## Capability and bridge binding

Every docking offer binds:

- Both Realm identities.
- Direction.
- Link and session transcript.
- Source and destination gate IDs.
- Public shell revisions.
- Requested action and object scope.
- Protocol and compiler versions.
- Active PresenceSession ID and epoch.
- Active RendezvousFrame ID and rendezvous epoch.
- A non-reusable offer nonce, an independent proposed bridge-generation nonce, issue time, and expiry.
- The expected previous bridge epoch only when renegotiating an existing generation.

An offer precedes bridge activation and cannot bind or claim a current new bridge epoch. Every grant binds the exact offer and digest, repeats the encounter, transcript, shell, gate, direction, policy, and capability context, binds the proposed generation-nonce digest, and allocates the prospective next bridge epoch. The recipe, both semantic bridge digests, and signed `BridgeEpochV1` activation record bind that same epoch. Protected traffic begins only after activation.

V1 does not allow wildcard grants or hidden-destination enumeration. Unauthorized clients cannot enumerate private gate IDs, district counts, collision, navigation, or refinement availability.

## Protected content addressing

Public shells may use ordinary public content IDs. Protected refinements and source chunks use audience-specific encryption and opaque locators. An unsalted plaintext hash cannot appear publicly because it enables cross-user correlation and dictionary attacks.

## Storylet privacy

Public Storylets consume only public observations. They cannot evaluate a private condition and merely hide the result. The fact that a private trigger fired is itself sensitive.

Storylet telemetry contains definition and instance state, timing buckets, outcome classes, and opaque references. It does not contain private predicates, exact input values, source, paths, capability tokens, or hidden participant data.

Replay disables action ports. Historical Storylets cannot mutate the live OS.

## Chronicle privacy

Chronicle records semantic transitions and stable opaque references. It never stores:

- Exact source.
- Raw filenames or paths outside an authorized local record.
- Private topology.
- Capability secrets or raw grant tokens.
- Encryption keys or nonces.
- Hidden gate IDs.
- Raw network packets.
- Unnecessary precise behavior or timing.

When a digest or local reference suffices, Chronicle does not duplicate the payload.

## Presence timing privacy

Private activity must not change public:

- Beacon timing.
- Manifest digest.
- Packet size.
- Skyline geometry.
- Storylet eligibility.
- Animation timing.
- Public collision or navigation.

These guarantees apply to the dedicated public presence and shell-publication channel. Public updates occur only from explicit public inputs and bucketed publication schedules, using the contract's fixed envelope classes where required.

V1 does not claim network-wide traffic-flow confidentiality. Peer session establishment, keepalives, public route use, disconnects, and congestion can expose documented timing and size classes. Hiding those signals would require separately specified padding, cover traffic, relay policy, and anonymity protections.

## Revocation and cleanup

After revocation completes:

- New protected payloads fail.
- Stale epoch traffic fails.
- New source chunks fail.
- Protected Storylets cancel.
- Refinement loading stops.
- Protected collision, navigation, interaction, geometry, and audio unload.
- Ephemeral keys and accessible caches release within defined bounds.
- A reconnect performs fresh authentication and negotiation.

JavaScript and GPU APIs cannot guarantee secure erasure. The product states that limitation directly.

## Security acceptance criteria

- Untrusted executable consumers cannot acquire protected service roots through forged scopes or public construction exports, or bypass those controls through native origin storage or leaked handles; source import-closure tests alone do not satisfy this pending B4H gate.
- Seeded secrets never appear in public manifests, traces, logs, telemetry, Chronicle records, GPU labels, crash reports, or public caches.
- Spoofed, expired, replayed, unknown, or downgraded identities create no Traveler, bridge, or protected route.
- An authenticated peer without presence consent remains a board entry.
- Asymmetric capability tests prove A-to-B and B-to-A independence.
- OS permission loss retracts affected authority without trusting presentation state.
- Malformed and resource-exhaustion manifests fail without executing or destabilizing the GPU.
- Version mismatch or bridge-digest disagreement fails closed to station-only presence.
- Private-only changes cannot alter the canonical public semantic scene or public Storylet timeline. Reference-renderer pixels must remain within the frozen regression tolerance profile; cross-GPU byte identity is not claimed.
- Disconnect cleanup removes every protected interactive surface within the declared bound.
- Operations View entry fails without current local owner identity, authority receipt, positive capability epoch, active private bake, layout receipt, or when any independently viewed/foreign Realm reference is attempted; the record can name only `localRealmId`.
- Different connected-Cityform, shell, Traveler, rendezvous, and bridge states produce byte-identical operator snapshots and minimaps for identical declared local input.
- Connected-content IDs appear in no operator CPU record, GPU resource, draw, pick, accessibility output, telemetry, Chronicle, or in-application capture.
- Camera, minimap, selection, focus, and Storylet cues never authorize a zone change; only the generic proposal, authority receipt, authoritative observation, and delta chain may present completion.
- RF-GE3 cache namespaces are structurally separated by exact audience, disclosure, and audience scope; every complete-key dimension changes cache identity, and a rejected or cache-forbidden request retains no reusable Plan.
- Every non-exact RF-GE3 request runs the complete RF-GE2 compile and deterministic verification path; metadata-fragment reuse never becomes semantic partial-Plan reuse.
- FIFO fragment pressure and explicit invalidation remove the complete direct and transitive reverse closure without crossing an audience namespace.
- A recursive package candidate binds both logical Part identity and content identity, remains non-persistent, non-published, non-installed, authority-free, runtime-inactive, and `not-executed`, and cannot enter ECS or presentation without an independent current-policy compile, verification, admission, commit, and observation chain.
- M3A admits only safe-normalized owner-private records through its exact prebound tuple; raw source data and pseudonym-key/preimage bytes never enter app, ledger, diagnostics, telemetry, crash reporting, GPU labels, or Chronicle.
- M3A's portable binding is selection-fenced equality evidence; its one
  process-local extension child mutates no M2 child tuple, and its checkpoint
  retains no M2 root. M2 retirement invalidates rather than becoming pinned by
  M3A.
- Gap, overflow, equivocation, source replacement, stale generation, operator switch, and uncertain ledger/checkpoint dispatch fail visibly closed without advancing an accepted cursor or changing M2 state.
- M3A local-network bytes remain identical when only remote peer identity, count, presence, address, packet, Traveler, Cityform, station, or remote Operations state changes because those inputs are structurally unavailable to the adapter.
- The public verification package has exactly 13 keys, its closure is public-only, every self-digest and required signature verifies, and its local noninterference receipt and receipt signature appear in no published artifact.
- The sealed refinement verification package has exactly nine outer keys and decrypts to exactly 14 canonical plaintext keys; exact authority, scope, epoch, base-shell, socket, closure, ciphertext, authenticated-data, and signature bindings all verify.
- The refinement scope receipt, its signature, explicit authenticated-data record, and decrypted plaintext appear in no published artifact; the publication receipt remains local for both audience jobs.

## See also

- [Virtual Realm Genesis Ecology integration](genesis-ecology-integration.md)
- [RealmForge Genesis Ecology](../realmforge-genesis-ecology.md)
- [M2 runtime foundation](m2-runtime-foundation.md)
- [M2A runtime composition](m2a-runtime-composition.md)
- [M2B private-bake admission](m2b-private-bake-admission.md)
- [M3A observation ingress](m3a-observation-ingress.md)
- [M3B disclosure and dynamic projection](m3b-disclosure-projection.md)
- [M3 living city runtime](m3-living-city-runtime.md)
- [World districts and facilities](world-districts.md)
- [Cityform encounter runtime](cityform-encounter-runtime.md)
- [Local City Operations View](local-operator-view.md)
- [Contract catalog](contracts.md)
- [M1B public shell and access-refinement packages](m1b-public-refinement-packages.md)
- [M1C Storylet and reviewed station bake](m1c-storylet-station-bake.md)
- [Code Matter](code-matter.md)
- [Cityforms and SecureMesh](cityforms-securemesh.md)
- [Storylets](storylets.md)
- [Security and Trust Model](../../concepts/security-model.md)
