---
title: Virtual Realm Implementation Roadmap
description: Dependency-ordered milestones, deliverables, exclusions, validation gates, rollback boundaries, and approval points for building The Virtual Realm.
audience: project leads, implementers, reviewers, and QA engineers
updated: 2026-10-01
status: M0-M1C, M2A, admission-only M2B, non-visible M2C, CPU-only M2D-A, M2D-B0, M2D-B1, the isolated dependency-injected M2D-B2 static GPU presentation foundation, the M2D-B3 trusted production-composition substrate, and the exact provider-free M2D-B4A through M2D-B4F authority wire contracts and M2D-B4G terminal legacy compatibility accepted; standalone native source-city rendering verified; M2D-B4H genuine-source construction is underway with protected per-Realm local-policy and per-account current-local-Realm/authority-epoch head sources implemented; B4H, the remaining genuine sources and adapters, full authority-provider registration, integrated in-app city presentation, M2E-M2H, and integrated M2 remain unaccepted; M3A/M3B remain executable blueprints; RF-GE0-RF-GE5 are accepted inert authoring evidence and RF-GE6 is planned
---

# Virtual Realm Implementation Roadmap

The Virtual Realm implementation proceeds through eight gated milestones. A failed gate stops advancement without invalidating previously accepted artifacts. Each milestone remains modular and leaves a recoverable rollback boundary. The M0-M1C product baseline is accepted. M2 implementation is underway; M2A, admission-only M2B, non-visible M2C, CPU-only M2D-A, M2D-B0 renderer-profile admission, M2D-B1 deterministic CPU draw packets, the isolated dependency-injected M2D-B2 static GPU presentation foundation, the M2D-B3 trusted production-composition substrate, and the exact provider-free M2D-B4A through M2D-B4F authority wire contracts and M2D-B4G terminal legacy compatibility are accepted independently. B4H has implemented bounded protected heads, boot-owned coherent observation, one-shot B4A and retained-cut B4F adapters with genuine issued-session invalidation, Entry subscriptions/disposal, and a bounded opaque-origin read-only local-head channel. B4H is not accepted. Activation, checkpoint, handoff, action, full isolated provider/renderer placement and full-provider integration remain outstanding. None of these slices constitutes accepted integrated M2. Physical native-GPU rendering is now verified in the separate source-city workbench; integrated in-app presentation remains open. M3A and M3B remain executable blueprints.

## Build commencement and first walkable gate

**Visible-city continuation, 2026-09-20:** the user prioritized visible city work
while the full provider remains unfinished. The new
[source-city workbench](source-city-workbench.md) renders 36 genuine captured
project files and 49 captured imports through the existing native GPU draw code.
Its first-person city frame, local WASD/drag/arrow navigation, footprint blocking,
resize, close and reopen are verified on real hardware. Captured source buildings
can now be selected by click, crosshair/Enter or the shared file inspector and
highlighted using the same native instance buffer. Movement updates the
existing camera buffer without rebuilding geometry or render targets. Selecting
a building now traces its captured outgoing and incoming imports; the inspector
can isolate one road or select the other endpoint without moving the player.
One bounded instance upload preserves the existing transfer budget and resource
count. Captured paths now derive 14 flat directory records; selecting a directory
outlines its captured descendant buildings, with parent/member navigation and
captured totals. Four appended parcel edges per file preserve the original
building/road IDs and placements. The directory checkpoint passes 95/95 browser
cases, 58/58 Python checks and native GPU parcel/road-change restoration,
selection reconciliation, movement and lifecycle checks. It remains
read-only historical metadata, not a live app, private bake, M1C admission,
networking map or completed B4H. The optional kernel profile now adds four
explicit WebGPU OS source buildings in a separate 40-file capture, preserving
the original 36-file capture and compiled baseline buffers. Rose buildings
extend the street without moving the existing buildings. Captured imports stay
at 49; no kernel road is invented when its source endpoints lie outside the
inventory. Profile navigation closes the current GPU session first. The kernel
checkpoint passes 115/115 browser model cases, 74/74 Python checks and the native
126-metre walk, kernel selection/parcel restoration, resize/reopen, invalid-profile
and close-before-document-commit checks. The same scene budgets and metadata-only
boundary apply. World-anchored district/building labels now follow submitted
camera frames in both inventories, with source-derived names/counts, distance
and building-box occlusion, non-overlap and a visibility toggle. Native walking,
click-through selection, resize and both toggle preferences on reopen pass;
annotations add no GPU resources or source access. This checkpoint passes
135/135 browser cases and 79/79 Python checks. Labels are DOM annotations over
the real GPU view, not GPU text-depth or a live source feed.

The source-city compiler now lives in the opt-in RealmForge module
`webgpu-os/apps/realmforge/virtual-realm/RealmSourceCityRecipeCompiler.js`.
The original workbench module is a two-export compatibility shim, not a second
compiler. A frozen recipe descriptor and data-only build report bind the
captured source, complete scene metadata and four original upload buffers.
Both cities retain their independently measured pre-move metadata and byte
fingerprints. This checkpoint passes 151/151 browser model cases and 83/83
Python checks, plus seven subtests. It does not register a RealmForge editor
document, publish an asset, complete RF-GE6 or bypass M1C admission.
Versioned authored recipe inputs are now implemented alongside the unchanged
V1 API: an exact source-bound seven-field design record controls building width,
row spacing and height contribution within reviewed integer bounds. V2 uses the
same generator; its defaults preserve every original scene metadata field and
upload byte. The visible Wide streets preset works in both inventories, with
source bindings and independently checked build reports. Ordinary design/profile
navigation releases the old GPU session before committing the next document.
This checkpoint passes 167/167 browser cases and 87/87 Python checks plus seven
subtests, including native authored geometry, selection, movement and restoration
of the byte-identical original canvas image. See the
[authored-design evidence](source-city-workbench.md#authored-city-design-checkpoint).
The bounded in-memory design editor now adds width, spacing and height inputs
with Apply and Restore. It validates and compiles before retiring the current
view, skips unchanged parameters, and restores the original V1 recipe on request.
Explicit Close cancels pending edits, including restoration of the prior CPU
design after a candidate was installed. Reopen retains the applied in-memory
design; page navigation discards custom edits. Acceptance includes 167/167
browser cases, 93/93 Python checks plus seven subtests, and native Apply/Restore,
invalid/no-op preservation, phase-observed API cancellation and exact original
PNG restoration. Native GPU-failure recovery is not claimed as dynamically
exercised; see the [editor evidence and limits](source-city-workbench.md#in-memory-editor-checkpoint).
Manual source-bound Save/Open is now implemented and verified under the approved
`design.source-city` contract. The closed `.proasset` family catalog adds only
`design`; the strict adapter validates one authored resource with the unchanged
seven-field payload and all-null entrypoints. Existing document-store history,
revision publication and both expected-head guards are reused. The standalone
composition lazily borrows genuine origin-local storage without OS initialization,
autosave or account/runtime authority. Save uses the last successfully verified
design and leaves the GPU intact. Open checks source binding before using the
existing scene-replacement lifecycle. Native fresh-page reopen reproduces the
custom report, buffers and stable saved identity; stale writers and corrupt
evidence reject. Acceptance passes 188/188 browser cases, 101/101 Python checks
plus seven subtests and the full native city suite. See the
[saved-design evidence](source-city-workbench.md#saved-design-acceptance-checkpoint).
Full RealmForge Modeler editor registration and the original provider ledger
remain separate work; neither missing authority is replaced by a fixture.

**Prior graphics continuation:** the stalled pipeline-layout slice is accepted.
Its [completed verification](m2-runtime-foundation.md#approved-pipeline-layout-implementation)
records1955/1955 browser executions across47 gates and693/693 Python checks
across42 files, with unchanged production bytes and all251 browser-bound local
sources verified. All28 formerly failing revocation cases now prevent native
creation in source and both canonical import orders. The prior interruption and
failed diagnostic remain historical evidence, not current blockers for this slice.

**Approved continuation, 2026-09-19:** piece 3 needs genuine pre-change
observation of the selection and policy heads. The existing storage events arrive
after mutation; a listener attached to one view misses other independently
acquired views. The [source-backed continuation plan](m2-runtime-foundation.md#protected-head-observation-and-writer-ownership-decision)
now records approval for one enforced, trusted local owner for those writes,
with bounded client communication. The first
[owner reservation prerequisite](m2-runtime-foundation.md#single-owner-reservation-prerequisite)
is accepted with118/118 browser cases and45/45 scoped Python checks. It does not enforce existing writers
or provide the observation/client channel, and it does not centralize multiplayer
or unrelated filesystem storage. Those remaining integration requirements still
apply before activation; no full owner or provider acceptance is implied.
The next [cooperative head-write exclusion](m2-runtime-foundation.md#cooperative-head-write-exclusion)
passed151/151 browser cases and60/60 scoped Python checks: existing managed selection/policy
writes hold shared account reservations through their complete conditional write
and readback. The next [admitted owner-operation drain](m2-runtime-foundation.md#admitted-owner-operation-drain)
keeps close pending until tracked callbacks settle, even if native lock loss
settles the request first. It passed 174/174 browser cases and 73/73 scoped Python checks.
The later owner-write integration completes the opted-in manager binding,
owner-only write path and pre-mutation tokens. The later coherent observation
and standalone boot binding now connect genuine operator ownership and awaited
shutdown in bounded scope, without creating new milestones. The kernel option
remains off by default. B4A and B4F adapters now share the retained cut and genuine
issued-session lifetime; Entry owns their subscriptions and retryable disposal.
The bounded isolated-client transport is now implemented with native isolation
evidence. Hosted handoff, full provider/renderer placement and full boot/provider
verification remain required before activation.

The next integrated product milestone remains the live in-app local city. The
remaining [provider ledger](m2-runtime-foundation.md#remaining-provider-integration-and-flat-construction-ledger)
is still open: genuine production M1C admission/runtime ownership and full
provider composition must be completed, alongside the remaining native
argument/return and resource-lifetime requirements. This pipeline acceptance
does not resolve the separate cross-frame/foreign-device browser crash or
authorize enabling an incomplete provider. The standalone workbench now provides
actual rendering, bounded local first-person movement and real source-building
picking in that view; local-only Operations View remains later.

**Original continuation accepted in bounded scope, 2026-09-26:** the user returned
to piece 3 after the accepted source-city editor, inspector and passive map. The
[owner-write implementation](m2-runtime-foundation.md#resumed-owner-only-storage-writes-and-pre-mutation-invalidation)
binds the original reservation to a genuine manager lifetime and owner-created
head views, with invalidation before mutation. Verification passes 207/207
browser cases and 98/98 scoped Python checks. This does not complete piece 3.
The optional mouse-look proposal is deferred and is not a dependency of this
integration. The [attach-before-read observation continuation](m2-runtime-foundation.md#attach-before-read-coherent-local-head-observation)
is now accepted on this owner, reusing the unchanged snapshot reader. Its
combined verification passes 242/242 browser cases and 114/114 Python checks.
The [standalone boot lifecycle](m2-runtime-foundation.md#standalone-boot-owned-local-head-lifecycle)
is now connected with a default-off kernel option, genuine operator acquisition,
transition drains and idempotent shutdown joining. Its combined verification
passes 267/267 browser and 135/135 Python checks. Kernel wiring is source-checked;
full OS boot was not executed. Hosted opt-in is rejected until handoff is wired.
The next [one-shot B4A adapter](m2-runtime-foundation.md#one-shot-b4a-operator-context-adapter)
now projects the real cut through the unchanged app wire and retains it across
currentness/subscription checks. Its first browser run passes 331/331 including
32 new cases; 198/198 CPU checks pass. Sources must share the original coordinator,
not just account and generation labels. The subsequent
[B4F policy adapter](m2-runtime-foundation.md#retained-cut-b4f-policy-adapter-and-lifecycle-notifications)
now binds that original cut to the actual issued lifecycle, including direct
retirement, disposal and first admitted composition close. Final verification
passes398/398 browser and232/232 CPU checks. An earlier cross-frame module-load
transport failure is retained in the evidence; the full unchanged-source retry
passed. It exposes no writers or refreshed observations. The subsequent
[Entry subscription connection](m2-runtime-foundation.md#entry-owned-operator-and-policy-subscriptions)
now owns B4A/B4F subscriptions, synchronous invalidation and attempt-scoped
retryable disposal. Startup/stop/cleanup joins publish before callbacks, and
restart diagnostics cannot reuse an old stopped receipt. Genuine one-shot
adapters still require fresh host-owned sources for a new attempt.
Bounded acceptance passes438/438 browser cases and270/270 Python checks. Earlier
transport-failed browser attempts remain separately recorded; the final local
harness adjustment changed no application code or test criterion.
The subsequent [controlled isolated-client channel](m2-runtime-foundation.md#controlled-isolated-client-local-head-channel)
now binds original B4A/B4F sources and the actual issued lifecycle to one native
MessagePort. Exact bounded asynchronous requests, real subscriptions,
cancellation, terminal events and retryable host-owned cleanup are implemented.
Native opaque-origin tests prove host DOM/OPFS, HTTP import and fetch denial,
first-load ordering, navigation drain and bootstrap-failure cleanup. Client
transport/context validation does not duplicate host canonical policy admission.
It changes none of the sixteen app dependencies and is not a generic package
bridge or completed live city. Browser verification passes471/471, including
33 new cases and all438 previous cases; final Python verification passes289/289.
Original flat piece4 now has the bounded
[original Engine candidate provenance foundation](m2-runtime-foundation.md#original-engine-candidate-provenance).
It authenticates the actual factory-issued adapter/result, original request/port/root
bindings and real ECS/slot frames, with permanent retirement before cleanup and
no duplicate resource owner. Mutable-option and duck-signal legacy behavior stays
compatible without receiving that stronger proof. Candidate provenance grants no
eligibility, genuine process ownership or prepared-CSE authority. Final verification
passes504/504 browser cases and310/310 Python checks, including all prior471/289
cases. No dependency or public wire changes, no live provider activation.
The completed bounded continuation supplies the
[original admission operator-context bridge](m2-runtime-foundation.md#original-admission-operator-context-bridge).
It adapts M1C's mutable operation requests to genuine retained B4A/issued-lifecycle
sources without changing those wires or confusing operation cancellation with
original work lifetime. Actual admission context methods are exercised; complete
admission loading/policy/trust and one-shot eligibility remain separate.
Final verification passes544/544 unique browser cases and338/338 CPU checks,
including all prior504/310 cases, with unchanged public contracts/dependency16.
The subsequent bounded continuation implemented
[original StorageManager service-view provenance](m2-runtime-foundation.md#original-storagemanager-service-view-provenance).
Its private original-issuance registry, exact-reference binding and native lifetime
checks preserve the legacy public binding/constructor/scoped-I/O sections. Lazy
registration, terminal cleanup and an independent64-source cap add no I/O or
public dependencies. This authenticates the manager issuer and original references,
not boot-context selection, backend isolation or full admission authority.
Final current-workspace verification passes580/580 unique browser cases and
372/372 CPU checks, including all retained544/338 cases. A concurrent shared
JSON-source change triggered fresh full runs; historical receipts are kept separate.
The completed
[original admission protected-storage cut binding](m2-runtime-foundation.md#original-admission-protected-storage-cut-binding)
joins that issued-view proof to the original admission context/lifecycle cut,
with exact coordinator, descriptor, scope and work-root references and own-only
terminal cleanup. It does not prove boot-selected manager or backend authority.
Final current-workspace acceptance passes610/610 unique browser cases and
410/410 CPU checks, retaining every580/372 previous case. Exact source/browser
closures86/209 are acyclic; frozen public wires and old gate scopes are unchanged.
The stronger
[original boot-bound storage mode](m2-runtime-foundation.md#original-boot-bound-admission-storage-lineage)
is implemented and accepted. Separate historical Source1 guards
bind the adapter to its original boot/composition/coordinator and the boot to
its original manager/coordinator; both modes reuse one lifetime owner and the
same frozen records. Legacy behavior remains available, without inheriting the
stronger provenance. This is not KernelBootstrap installation or backend isolation.
That historical checkpoint passes640/640 unique browser cases and445/445 CPU
checks, including every610/410 retained case. Exact source/browser closures
remain86/209; original public wires and old gate scopes stay fixed. All378 raw
pins and340 served hashes matched that historical checkpoint's files. Earlier acceptance remains
historical evidence, not additive execution totals.

[Original admission service constructor lineage](m2-runtime-foundation.md#original-admission-service-constructor-lineage)
now supplies a separate historical Source1 with exact thirteen-reference
binding. It authenticates qualifying completed base construction, not mutable
dependency implementations, method integrity, currentness, public ports or
accepted load results. The service's prior raw bytes reconstruct exactly after
removing the additions; the frozen app dependencies and old operations stay fixed.
That historical checkpoint passes664/664 unique native browser cases across21 gates and
479/479 CPU checks across31 literal selectors, retaining every640/445 prior case.
The separate new browser closure is208 acyclic modules with24 cases;34 new CPU
checks prove preservation and grammar. All382 raw pins and343 served
hashes matched that checkpoint. One zero-case Windows startup-file failure was retained before an
unchanged-runner fresh-profile retry passed. Details and receipts are in the
linked foundation section; no admission result or live activation is certified.
The subsequent
[original admission read-port issuance companion](m2-runtime-foundation.md#original-admission-read-port-issuance-lineage)
now binds the genuine frozen read port to its original enrolled service without
changing port4, writer3, operation bodies or dynamic method dispatch. Its
historical Source1 grants no currentness or accepted-load authority. Exact raw
reconstruction preserves both earlier service checkpoints; the existing 208-module
gate retains 24 cases and adds 16. Original M2 composition's actual post-await
dependencies remained separate from mutable options or early labels at that checkpoint.
The final corrected read-port checkpoint passed 680/680 unique native cases across 21 gates and
491/491 CPU checks across the unchanged 31 selectors. Every 664 native/479 CPU
semantic case is retained, with only three exact service-pin parameter-ID
updates; 16 native and 12 CPU checks were added. All 382 raw/343 served hashes matched
that checkpoint's acceptance audit. Two earlier candidate receipts remain historical,
including a correctly rejected run with a concurrent shared-source hash change.
See the linked foundation section for receipts, restoration hashes and scope.
The subsequent
[original M2 admission composition construction cut](m2-runtime-foundation.md#original-m2-admission-composition-construction-cut)
now binds exactly nine actual raw admission-service inputs captured after registry
verification, including raw omitted defaults and null contracts. Its private
Source1.assertAdmissionBinding9 also relies on the original hidden service's
effective Source13 and original read-port association. It does not snapshot
options early, change legacy property reads/async outcomes or certify the full
writer/publication/evidence provisioning graph. Public ports and all sixteen app
dependencies remain unchanged. The independent gate adds 24 cases in an exact
272-module acyclic inventory without expanding older inventories. That checkpoint
passed 704/704 native cases across 22 gates and 515/515 CPU checks across 32 literal
selectors, retaining all earlier 680/491 exact case identities. All 451 raw/410
served hashes matched its scoped audit; receipts, restoration proofs and
two retained fixture failures are recorded in the linked foundation section.
The next
[original publication-head constructor and composition cut](m2-runtime-foundation.md#original-publication-head-constructor-and-composition-cut)
is implemented with two independent historical Source1 guards of five raw
inputs. It joins the genuine original head's constructor to the actual later
publication literal and the same hidden head reference retained by the original
admission service, without changing the existing admission guard9 or public
ports. Captured SameValue preserves raw defaults, null generation, NaN and signed
zero without new validation/coercion. All original operations and two whole-file
checkpoints reconstruct exactly. That publication-head checkpoint passes 728/728 native
cases across 23 gates and 539/539 CPU checks across 33 literal selectors, retaining
every prior 704/515 case unchanged and in order. The read-only audit matches all
457 raw/413 served hashes; focused checks pass 24/24 native and 48/48 CPU.
Receipts and exact preservation evidence are recorded in the linked foundation
section. All owned jobs ended normally through the existing shared lock. This does
not certify immutable scope, method/dependency authority or the bridge/writer
graph. Next authenticate remaining dependency implementations and bridge,
evidence, provisioning and writer associations, then original verified-load binding
inside the same original piece 4 before one-shot eligibility;
hosted freeze/resume/rollback handoff, renderer placement and full provider/boot
verification remain required before enabling the live provider.

The [original publication bridge and writer composition cut](m2-runtime-foundation.md#original-publication-bridge-and-writer-composition-cut)
now adds effective bridge constructor proof, original writer issuance and their
actual post-await association with the same original head. Its raw guard binds
the three actual bridge partition/clock/random inputs, independently of the
earlier admission/head guards. Omitted fields use captured own descriptors,
not late inherited getters. Original publication writer5, admission writer3,
public ports, defaults, dynamic dispatch and all sixteen dependencies stay
unchanged. That bridge/writer-issuance checkpoint passes 752/752 native cases across 24 gates
and 563/563 CPU checks across 34 selectors, retaining all earlier 728/539 case
identities unchanged and in order. All 462 raw/416 served hashes match; exact
receipts and preservation proofs are in the linked foundation section. Focused
checks pass 24/24 native and 72/72 CPU; all owned jobs ended normally through
the original lock. That checkpoint did not prove secure
writer retention in RealmForge/client, remaining evidence/provisioning peers,
dependency authority, accepted load or activation. Those associations and the
existing release/currentness/eligibility work remain inside original piece 4.

The [original downstream publication writer retention](m2-runtime-foundation.md#original-downstream-publication-writer-retention)
now binds the original hidden RealmForge publisher, its frozen entry and the
client's original private state to the same issued writer. It captures the
existing client literal, preserves omitted migration through own descriptors,
and leaves the earlier guards and all public contracts unchanged. Independent
source review reconstructs the four entire prior files exactly. Acceptance at
that retention checkpoint passes 784/784 native cases across 25 gates and
595/595 CPU checks across 35
selectors, retaining every prior 752/563 identity unchanged and in exact order.
All 467 raw/419 served hashes match; the linked foundation section records exact
receipts, the repaired client mutation witness and retained development history.
All owned jobs ended normally through the original shared lock. Historical
retention did not authenticate Forge-port issuance, M1 verifier retention,
evidence/provisioning peers, dependency authority, accepted loading or activation.
Those associations remained
inside original flat piece 4; the live provider stays disabled.

The [original M1 and Forge consumer associations](m2-runtime-foundation.md#original-m1-and-forge-consumer-associations)
are implemented in bounded scope: completed original M1 dependency retention,
original Forge-port issuance to its actual client and an independent composition
join to the actual entry/client. Earlier companions and all public contracts
remain unchanged; both complete prior production sources reconstruct exactly.
Final acceptance passes 808/808 native cases across 26 gates and 619/619 CPU
checks across 36 selectors, retaining all prior 784/595 identities unchanged
and in exact order. All 472 raw/422 served hashes match final current files;
exact receipts and reproduction are in the linked foundation section. Focused
checks pass 24/24 native and 104/104 CPU; all owned jobs ended normally through
the original shared lock. These historical associations do not
certify remaining evidence/provisioning peers, delegated implementations,
currentness, accepted loading or activation. The live provider remains disabled.

The [original evidence resolver association](m2-runtime-foundation.md#original-evidence-resolver-association)
is implemented in bounded scope: actual resolver constructor guard4 and an
independent join through the same original M1 adapter and prior consumer graph.
Original assignment/validation order, double method reads, `.bind`, ignored
freeze returns and operations remain unchanged. Raw trust/profile values use
SameValue, including accepted NaN and signed zero. Both complete prior sources
reconstruct exactly. Final acceptance passes 832/832 native cases across 27
gates and 643/643 CPU checks across 37 selectors, retaining every prior 808/619
identity unchanged and in exact order. All 477 raw/425 served hashes matched
that checkpoint's final files; the foundation records receipts and reproduction.
Focused checks pass 24/24 native and 104/104 CPU. Its next blueprint covered
original provisioning-service retention, its original issued port, the actual
service/coordinator constructor-input association and durable preservation.
These historical associations do not certify dependency authority, accepted
loading or activation; the live provider stays disabled.

The [original evidence provisioning argument association](m2-runtime-foundation.md#original-evidence-provisioning-argument-association)
now completes that four-piece blueprint: original service retention, original
service-issued port and actual coordinator constructor-input association, plus
durable preservation. Service guard10 binds effective selected values; port
guard1 binds its original service; composition guard10 retains the actual raw
service inputs, including undefined rather than an invented default clock.
Original operations, reads, defaults, exceptions and all public wires remain
unchanged. Both complete prior production sources and the prior helper/proof
reconstruct to their unchanged pins. Acceptance passes 868/868 native cases
across 28 gates and 673/673 CPU checks across 38 selectors, preserving all
832/643 prior identities unchanged and in exact order. All 482 raw/428 served
hashes matched that checkpoint's files; focused checks pass 36/36 native and 110/110
CPU. Exact receipts, reproduction and the then-planned four flat pieces are
recorded in the linked foundation section. That checkpoint left coordinator
state/wrapper retention, original issuance and actual client connection open.
Its argument association does not prove coordinator consumption, delegated
implementation authority, accepted loading or activation. The live provider
stays disabled; First Shard and preview9018 were untouched.

The [original provisioning coordinator and client connection](m2-runtime-foundation.md#original-provisioning-coordinator-and-client-connection)
implements those four pieces without changing the original runtime wires:
native original state10/wrapper2/wrapper3 retention, original port3 issuance,
the actual client5 connection and durable byte/identity preservation. Source
guard8 binds non-clock constructor references; selected clock and derived ceiling
stay private. Independent composition guard9 binds actual own literal inputs,
including raw omitted clock rather than a wildcard or invented default. Both
inherited-option and own-undefined constructor paths retain their original reads.
Acceptance passes 904/904 native cases across 29 gates and 703/703 CPU checks
across 39 selectors, retaining every prior 868/673 identity in exact order.
All 487 raw/431 served hashes match final current files; focused checks pass
36/36 native and 108/108 CPU. The linked foundation records exact receipts,
reproduction, the preserved fixture failure and the mapped next load boundary.
Dependency implementation authority and exact original accepted-load lineage
still precede activation; the ten flat pieces remain unchanged.

The [original selection lease and completed release body](m2-runtime-foundation.md#original-selection-lease-and-completed-release-body)
implements the next selection prerequisite in four flat pieces. Its sources
retain original constructor guard2, issued-lease guard5 and separate completed
release-body guard5. Coordinator fields remain mutable; the lease retains its
original ten keys, methods and getter. Release proof waits for the existing Web
Lock request await and declines on either catch, including falsy failures whose
legacy outcome still fulfills. No public promise, successful load, dependency
authority or activation is certified. Acceptance passes940/940 native cases
across30 gates and727/727 CPU checks across40 selectors, retaining every prior
904/703 identity as exact ordered prefixes. All492 raw/434 served hashes match;
repaired focused native checks pass36/36. Failed fixture receipts remain saved.
The selection prerequisite alone does not provide outer-load association.

The user has now approved the [opt-in original completed-load channel](m2-runtime-foundation.md#opt-in-original-completed-load-channel).
Five flat pieces inside piece4 join a ticket-bound original normalized result,
one original invocation, the exact outer promise and catch-free original lease
release, with a separate original-composition association. The non-async v2
host-only operation returns that same promise unchanged and adds the explicitly
approved observer/rejection-handled effects. Existing v1 dispatch, public ports
and dependency16 remain unchanged. Bounded acceptance passes976/976 raw-current
native cases across36 gates, retaining the exact940-case prefix. CPU751/751
across41 selectors consists of24 current-source proofs plus the exact727-case
checkpoint prefix; it is not751 current-runtime checks. Focused native36/36,
all504 raw/441 served hashes, complete three-owner inverse pins and strict
receipt verification pass. Retained routing/deadline failures and exact
reproduction evidence are compiled in the linked foundation. Dependency
implementation authority and freshly reacquired currentness remain
separate before eligibility. No provider or city-frame activation is introduced.

The [dependency implementation and fresh selection blueprint](m2-runtime-foundation.md#dependency-implementation-and-fresh-selection-blueprint)
maps all thirteen actual admission-service inputs and the verifier's transitive
dependencies. Its approved six-piece build now implements private read-only ports
for the two existing shipped catalogs, using original method bodies, independently
captured native digest checks, exact private-tree comparison and immutable byte
frames. Focused CPU24/24 and native24/24 pass; full retained native1000/1000 across
37 gates preserves the exact976-case prefix plus24 new identities, with512 raw/
445 served bindings reconciled and independent receipt audit passed. The catalog
build is bounded-accepted, not integrated runtime or city acceptance. Legacy
registries, composition and dependency16 stay unchanged; the new ports are not
integrated. Fresh use must reacquire the
existing native selection fence and exact authority/context checks; completed
history cannot reuse a released lease. This is original flat piece4, not another
milestone, and it preserves the already built city plan/renderer work.

The approved build remains in piece4:
[admission native support](m2-runtime-foundation.md#admission-native-support-blueprint)
captures the intended native clock and entropy implementations in a separate
two-operation original port. The human approved its six flat pieces with “continue
build it”; the isolated owner is written, independently reviewed and bounded-
accepted by current CPU24/24, focused native24/24 and retained native1024/1024
across38 gates. Legacy callers, the diagnostic clock, original composition and
dependency16 remain unchanged. This completes no activation clock, policy/storage
authority, contract validation or fresh-use join. The full run preserves the
exact previous1000-case sequence and445 served-source hashes; two older raw-only
files differ from that checkpoint. See the foundation for exact receipt/binding
evidence and the distinction between CPU9-pin and browser7-pin coverage. Preserve
the historical1000-case catalog receipt rather than relabel it as new-owner proof.

At the historical support-only checkpoint, the pre-issuance guard closed
inherited descriptor-control callbacks and method substitution without altering
the shared helper. The catalog factories' operation-time descriptor seam remained
open and was not covered by the historical1000/1024-case receipts. The completed
descriptor continuation below closes that specific gap. The support port remains
uninstalled; full provider/city acceptance is still open.

The [six-piece catalog descriptor isolation build](m2-runtime-foundation.md#catalog-descriptor-isolation-blueprint)
is approved, implemented and [boundedly accepted](m2-runtime-foundation.md#catalog-descriptor-isolation-current-acceptance)
inside original piece4. All nine conversions use private null-prototype
descriptors; inferred names/source, exports, membership and support guard
behavior are preserved. Current CPU profiles pass72/72 combined and the native
profile1034/1034 across39 gates, with the original1024 sequence plus10 new cases.
Current full bindings526 raw/452 served are stable during execution. The
foundation records509/519 raw and445/449 served historical matches, distinguishing
six approved source/tool revisions from four untouched outside-slice differences.
Do not claim blanket source continuity or authority over those changes. Eight
old CPU/six browser owner pins remain unchanged; helper and support-comment
revisions have exact parent comparisons. Next remains implementation-dependency
completion and fresh selection/currentness before eligibility. Provider
installation and the first in-app city frame remain open; the existing city
workbench/renderer/inspector and original milestone order are preserved.

The approved [four-piece original contract lookup build](m2-runtime-foundation.md#admission-contract-catalog-lookup-blueprint)
has current CPU16/16 and native1046/1046 across40 gates in its
[bounded execution record](m2-runtime-foundation.md#admission-contract-catalog-lookup-current-acceptance).
It adds a separate `get(name)` owner and original-only Source lookup, preserving
all109 shipped definition identities,13 CPU owner pins and every1034 parent
case identity/order. The full receipt retains all526 raw/452 served parent
bindings unchanged and adds only seven raw/four served files. Final current-file
audit passed and memory closure is saved; all four approved pieces are complete.
This is not provider installation or
sealed schema/semantic validation. Complete the remaining policy-storage and
validation execution boundaries, then fresh selection/currentness, inside the
existing piece4. Do not reset city work or advance the original milestone order.

The completed independent CPU component is the
[plan-bound city inspection resolver](m2-runtime-foundation.md#next-independent-build-plan-bound-city-inspection),
four flat pieces inside the already planned read-only half of M2G. It reuses
the real M2D-A object bindings and semantic records to answer what an object
represents, without a GPU, camera, live pick, or provider. Its three-operation
CPU module passed25/25 browser cases, the existing30/30 static-plan regressions,
and12/12 Python checks. This bounded acceptance does not replace the remaining
M2D/M2E/M2F prerequisites or complete integrated M2G. Keep authored
scenery distinct from stable system objects, preserve sealed code, and add no
runtime or remote access. The existing ten-piece B4H ledger remains unchanged.

Current B4H progress extends beyond the initial protected-head sources: bounded
generation/session allocation, private process-owner identity, v3 host lifecycle
transport, participant notification, lifecycle-port composition, operator-switch
cleanup ownership, diagnostic clock/logger sources, exact-producer frame
accounting, private exact-mount buffer/texture/creation accounting and separate
original-surface reservation accounting and a retained original-owner teardown
validator are implemented. A private guarded-frame bridge now preserves original
producer provenance without changing the syscall wrapper. A separate weak-pair
check authenticates historical adapter receipt/view pairing without returning
either object or proving ownership. Their individual
acceptance does not install the full provider.
The opt-in [B3 pre-epoch lifecycle installer](m2-runtime-foundation.md#b3-pre-epoch-lifecycle-installation)
now authenticates original lifecycle ownership before GPU epoch publication.
It does not enroll individual resources or enable ordinary-work denial.
Its direct source import changed B3 closure48 to88 at that earlier gate.
The implemented [cycle-free pre-bind association](m2-runtime-foundation.md#cycle-free-pre-bind-gpu-allocation-association)
now prepares original owner-bound cohorts before GPU epoch binding and checks
the exact configured facade. Its B396/core60/wrapper97 and Entry106 closures,
like earlier B348/B388 measurements, are historical gate evidence. The
protected-startup/terminal gate measurements were80 for the reviewed authority
component, B3111, wrapper112 and Entry152. The later upstream schema move adds
exactly three reviewed modules: recorded accepted counts were83, B3114, wrapper115 and
Entry155, with the same four-member/five-edge authority component.
The following [standard adapter cohort allocation routing](m2-runtime-foundation.md#standard-adapter-cohort-allocation-routing)
now routes opted-in buffer/texture creation through that exact primary cohort.
Adapter64 and owner-controller65 were that gate's expanded reviewed closures.
The later [private terminal cleanup](m2-runtime-foundation.md#private-presenter-terminal-cleanup-and-retry-ownership)
now supplies retry-safe protected teardown. The following
[root-enrolled ordinary-work fencing](m2-runtime-foundation.md#root-enrolled-ordinary-work-fencing)
adds standard-route cache, callback, nested-command and awaited-result checks
while preserving rootless policy and independent terminal retries.
The approved [original-cohort native work-view implementation](m2-runtime-foundation.md#original-cohort-native-work-view-implementation)
now carries original proof into native method lookup, cache publication and
nested commands without changing shared-facade policy or public dependencies.
The 2026-09-12 native-view checkpoint recorded734/734 browser executions and605/605 Python checks;
ordinary90 and the original native2 pass in source and both canonical import
orders. Descriptor conversion failed a separate strict0/1 probe at that checkpoint. Native-return
conversion, opaque-resource children, physical GPU execution and visible-city
integration stay open; this is not full GPU-effect isolation.
The approved [protected shader conversion profile](m2-runtime-foundation.md#protected-shader-descriptor-profile-implementation)
is now accepted with its exact finite limits, standard-only handling and complete
conversion before protected cache hits:887/887 browser executions across29 gates,
625/625 Python checks across39 files, then40/40 affected checks rerun after final
test hardening. Descriptor2, shader-profile42 and genuine-native7 pass in source
and both canonical import orders. No visible-city or full GPU-isolation claim is added.
Only two reviewed storage nodes were added to the wider test inventories;
authority83, Entry155, B3114 and wrapper115 remain unchanged. This is still flat
piece9, with original shared-facade policy and independent cleanup preserved.
The [protected sampler conversion](m2-runtime-foundation.md#protected-sampler-descriptor-conversion)
implements the approved installed-native profile: raw float-limit rejection
before rounding and saturating/truncating anisotropy. The numerical differences
from WebIDL are explicit, and both strict native comparisons now pass. This
bounded slice is accepted:1175/1175 browser executions across35 gates, including
sampler88/native8 in source and both canonical import orders. Python evidence
is644/645 followed by a corrected structural-test check and78/78 affected cases;
it is not a fresh green645 run. The recorded browser invocation uses a transient
60s connection allowance with the unchanged90s polling deadline. The subsequent
[binding-layout conversion profile](m2-runtime-foundation.md#protected-binding-layout-conversion-review)
is accepted with1634/1634 browser executions across41 selections and a fresh
669/669 Python run across41 literal files. Its126 profile/27 native cases pass
in source and both canonical import orders. It uses
standard-sequence traversal, a4096-entry conversion cap and explicit experimental
member rejection. Historical strict diagnostic failures, measured Chromium
differences and the old in-memory-only source limitation remain preserved;
durable profile/native tests now provide the bounded acceptance evidence. This adds
no browser admission rule, new wire, full provider or visible-city acceptance;
it remains existing flat piece9 and preserves the accepted sampler profile.
The [bounded pipeline-layout input review](m2-runtime-foundation.md#protected-pipeline-layout-conversion-review)
now maps nullable native layout identities, the standard immediateSize field and
an eight-piece reuse blueprint. The subsequent CONTINUE explicitly approved standard
iteration, an independent4096-layout cap and full immediateSize conversion.
The [approved implementation](m2-runtime-foundation.md#approved-pipeline-layout-implementation)
is accepted with1955/1955 browser and693/693 Python checks. A historical separate62-case diagnostic completed34 passes and28 strict
failures, proving post-revocation native creation despite withheld publication.
The original63-case run and isolated group5 crashed during a cross-frame/other-
device attempt; those remain incomplete, not accepted tests. No new ownership
rule is inferred from either result. Separate native
brand-only and load-awaited same-owner cross-frame controls pass1/1 each without
resolving the foreign-device crash or replacing the interrupted test.
The [stable-port/epoch association](m2-runtime-foundation.md#stable-presentation-port-allocation-association)
now preserves that exact selected allocation source through retirement. It does
not yet bind a presenter generation or establish exclusive cleanup ownership.
The [original presenter-generation provenance](m2-runtime-foundation.md#original-presenter-generation-provenance)
prerequisite now supplies exact local-generation, constructor-port and adopted-
receipt evidence. The [strict startup and fresh-cohort exclusivity proposal](m2-runtime-foundation.md#strict-presenter-startup-and-fresh-cohort-exclusivity-proposal)
now implements the opt-in v4 host carrier and fresh-only protected allocation
policy, verified as a bounded allocation-protection slice. The approved
[issuer-dependency amendment](m2-runtime-foundation.md#implementation-preflight-and-dependency-amendment)
uses original-only issuer verification and an explicitly guarded module cycle;
it does not substitute a callback registrar for authentication.
Genuine exact-mount resource telemetry,
activation-authorized process children, recovery reconciliation,
authenticated acquisition/backend isolation, the remaining authority owners,
and the real M1C-to-first-submitted-frame route remain open. The current source
ledger below is the flat ten-piece continuation, not another milestone tree.
(Sources: `webgpu-os/kernel/realm/RealmLifecyclePortComposition.js`;
`webgpu-os/shell/desktop/RealmOperatorMountDrain.js`;
`webgpu-os/kernel/realm/RealmRuntimeDiagnosticsSource.js`;
`webgpu-os/kernel/GpuFrameCoordinator.js`;
`webgpu-os/kernel/GpuDeviceBroker.js`; `webgpu-os/kernel/VRAMTracker.js`;
`webgpu-os/kernel/SurfaceManager.js`;
`webgpu-os/kernel/Syscalls.js`;
`webgpu-os/apps/the-virtual-realm/runtime/RealmGpuPresentationSyscallAdapter.js`;
`webgpu-os/kernel/realm/RealmProcessOwnerIdentityAuthority.js`;
`webgpu-os/kernel/realm/RealmLifecycleAllocationAuthority.js`.)

Building has begun. M0-M1C are the accepted foundation; integrated M2 is the
active first walkable, static-Cityform gate and is not yet accepted. After M2,
M3A, then M3B, then the later M3 slices make that Cityform living. RF-GE6 may
advance in parallel only as an inert authoring compiler and grants no runtime or
Virtual Realm gate.

M2A and the admission-only M2B slice are accepted. M2C now independently
reconstructs and verifies the admitted private bake, then materializes its
immutable static store, ECS state, and State-First semantic source without
making the city visible. Its app/Engine slice is accepted. M2D-A now compiles
that real state into a digest-bound immutable CPU render plan without surfaces,
frames, GPU allocation, visibility, or interaction, and is accepted. M2D-B0 now
admits the complete frozen renderer profile without allocation and is accepted.
M2D-B1 now supplies deterministic CPU draw packets. M2D-B2 supplies the
isolated first GPU presenter and its fail-closed lifecycle substrate. M2D-B3
supplies the trusted registry, exact dependency-v2 assembler, owner-coupled GPU
epoch, and Desktop lease transport. B4H genuine-source construction is underway;
the genuine full authority provider and its first physical non-black visible
frame remain outstanding. M2E adds grounded
first-person traversal, M2F adds the owner-only Operations View and minimap,
M2G adds read-only interaction/proposals, and M2H accepts the integrated first
walkable Cityform with recovery, performance, and accessibility evidence.

The executable continuation is expanded in eight blueprints:

- [M2A runtime composition](m2a-runtime-composition.md) for the exact app
  boundary, flat peer ownership, 11-definition runtime catalog, lifecycle,
  generation fencing, handoff, and entry-contract gates;
- [M2B private-bake admission](m2b-private-bake-admission.md) for the exact
  M1C v2 capsule, admission index, resource inventory, evidence/signature
  closure, durable head, restart, migration, and failure protocol;
- [M2 runtime foundation](m2-runtime-foundation.md) for the discoverable app,
  artifact store, Engine scene, first-person controller, local Operations View,
  lifecycle, handoff, and recovery;
- [World districts and facilities](world-districts.md) for the exact RealmForge
  Root Spine, Exchange, five territories, Genesis kits, and semantic roads;
- [M3 living city runtime](m3-living-city-runtime.md) for normalized OS
  observations, dynamic projection, Code Matter, Storylets, Genesis, topology,
  Chronicle, and local Operations reconciliation;
- [M3A observation ingress](m3a-observation-ingress.md) for the separate
  two-port composition, seven trusted sources over nine existing M0 observation
  kinds, atomic cursor handshake, exact limits, deterministic vector cuts,
  ledger/checkpoint/recovery, source privacy, and 22-gate/48-case acceptance;
- [M3B disclosure and dynamic projection](m3b-disclosure-projection.md) for the
  separate three-port composition, 16-definition/18-module catalog, preserve-or-omit
  disclosure after recorded-authority resolution, eight primary domain
  projectors, non-owning historical witness, three exact 28-field cuts,
  transactional DynamicStore/ECS/State-First source update, self-contained
  projection root, exact recovery/disposal protocols, and 20-gate/48-case
  acceptance;
- [Cityform encounter runtime](cityform-encounter-runtime.md) for M4 public
  shells, M5 station presence, and M6 locomotion/rendezvous/docking.

## M0: specification and contract freeze (complete)

### Scope

- Freeze terminology, ownership, authority, scope, units, coordinate policies, disclosure classes, Storylet rules, originality rules, and flat dependency constraints.
- Define every V1 contract as a separate versioned module.
- Freeze `RealmScanScopeV1` with explicit allow roots, opaque hard-deny subtree handles, canonical and symlink-safe containment, pre-access checks, and content-safe diagnostics.
- Freeze canonical content encoding, acyclic content-address order, external `SignatureEnvelopeV1` preimages, and signer-set rules with cross-client vectors.
- Freeze `RealmStoryletInstanceHeadV1`, authored episode heads, external persistence receipts, exact logical-clock and PCG vectors, coordinator terms, and outer recovery state.
- Freeze the Playground clean-room boundary: public Engine API versus independently restated invariant versus preview-only expression versus deferred implementation.
- Freeze the source-to-CSE-authority-to-observation-to-disclosure-to-State-First-to-frame flow, truth-plane matrix, injected Engine adapter seam, lifecycle generations, and audience-safe historical-witness mapping.
- Freeze the two approved view modes, local operator authority binding, local-only overview/minimap projection, connected-Cityform structural exclusion, and powerless zone-management proposal path.
- Select reference hardware and supported browser/device tiers.
- Define the documentation and independent-rewrite ledger.

### Deliverables

- Contract schemas and examples.
- Canonical digest, signature-envelope, logical-clock, deterministic-random, and safe-text conformance vectors.
- Module and port catalog.
- Import-boundary rules.
- Threat model.
- Originality ledger.
- Playground clean-room source ledger, production-ban list, adapter contract, and certification matrix.
- Local operator policy, view snapshot, minimap snapshot, and zone-management proposal contracts with adversarial local/remote isolation fixtures.
- Reference hardware and measurement protocol.

### Gate

- Every source of truth has one owner.
- No public/private ambiguity remains.
- No contract uses source, test, design, mechanic, scan result, or dependency material from the explicitly excluded application.
- No runtime implementation begins before contract review passes.
- Synthetic decoy-scope tests prove a hard-denied subtree is never enumerated, statted, opened, hashed, watched, previewed, retried, or named in logs; the actual excluded application is never used as a fixture.
- Content-address DAG, signature-envelope, six-axis semantics, safe-text, presence-only Traveler, and Storylet outer-lifecycle certification gates have complete frozen fixtures and no cross-record cycle.
- No production module imports `tests/playground/**`, reads Playground loader globals, copies demo WGSL/UI/camera expression, or substitutes demo-authored graph topology or a fallback for live evidence.
- Presentation order cannot create causality; projection, belief, similarity, rejected history, State-First decisions, Storylets, and frames cannot grant authority or claim a terminal result.
- Local operations records are exactly owner-private and local-private, expose only `localRealmId` with no foreign/viewed-Realm slot, require current authority, reject connected-content fields, and cannot bypass the generic action authority chain.

### Exclusions

No renderer, scanner, multiplayer runtime, or production Storylet implementation.

### Rollback boundary

M0 is implemented as an additive, side-effect-free contract package under `webgpu-os/apps/the-virtual-realm/contracts/`, with browser and Python conformance fixtures under `tests/network/realm/`. It performs no runtime registration unless an explicit composition root calls `initVirtualRealmContractRegistry()`. The package, catalog entry, fixtures, and this documentation update therefore remain independently revertible without touching Engine, WebGPU OS runtime state, RealmForge documents, SecureMesh, or user data.

### Implementation evidence

- 100 independently owned flat M0 V1 contract modules, three verified M1A additions, four verified M1B additions, and two verified M1C contract additions, for one ordered 109-contract catalog.
- Strict bounded plain-JSON preflight with malformed-Unicode, NFC, cycle, accessor, symbol, inherited-field, prototype-pollution, unsafe-number, depth, count, and byte rejection.
- Atomic all-or-nothing versioned registration with exact name/format lookup and idempotent full initialization.
- Frozen code-point-sorted canonical JSON, length-prefixed content and signature preimages, SHA-256 content IDs, PCG-XSH-RR 64/32, unbiased bounded selection, and logical-clock merge/term rules.
- Synthetic cross-client vectors, 100-contract browser conformance, an independent Python verifier, a real-Engine clean-room foundation browser harness, a dedicated exact multi-party signer-acceptance harness, and a dedicated local-operator isolation harness.
- A normative CSE/URC/State-First/Root-Algebra clean-room foundation with all 15 allow-listed Playground sources plus `engine/state/index.js` cited and dispositioned; no runtime code is imported from them.
- Executable clean-room evidence proves CSE commit/replay/conflict behavior, capability attenuation and non-authoritative belief boundaries, URC projection-versus-commit behavior, State-First content-identity preservation, deterministic retrieve-then-exact verification, and proof-gated Root Algebra CPU/WGSL plans.
- Active authority, capability, presence-session, rendezvous, bridge, key, allocator, and clock epochs reject zero; inactive scope fields remain absent and predecessor/baseline epoch zero remains representable.
- Dedicated local operator conformance proves camera bounds, loaded-cell map closure, connected-Cityform noninterference, and powerless zone proposals.

## M1: RealmForge bake foundation

M1 is divided into three independently gated slices. M1A proves one complete owner-private vertical path, M1B introduces transported audiences, and M1C completes authored Storylet compilation and reviewed richer station content without reopening either accepted slice.

### M1A: owner-private SecureMesh station bake (complete)

#### Scope

- Implement one deterministic `PrivateRealmBake` rooted by `RealmVisualBakeManifestV1`.
- Compile stable +Z Root Spine geography and one deliberately bounded SecureMesh station fixture.
- Compile the ten typed static visual-resource families: geometry, material, lighting, collision, navigation, socket, LOD, projection binding, glyph style, and audio zone.
- Compile one typed owner-private local-operations lookup containing canonical local zones, anchors, cells, routes, landmarks, bounds, camera bounds, and map HLOD.
- Bind one strict fail-closed bake resource-limit profile.
- Implement the optional `RealmProofGatedOptimizer` behind the pure compiler seam while retaining the mandatory unoptimized baseline path.
- Compute the exact private dependency closure, verify every cross-record binding, publish immutable content, and compare-and-swap the active private root.

#### Deliverables

- Sole `RealmForgeBakeEntry` composition root and flat injected peers.
- Immutable input envelope, resource envelopes, private closure, verified package, and external evidence records.
- Bound `RealmSpatialLayoutPolicyV1` and receipt for the +Z Root Spine, station, cells, anchors, routes, HLOD, collision, and navigation.
- `LocalOperationsLookupResourceContract`, `RealmBakeResourceLimitProfileContract`, and `RealmProofGatedOptimizationReceiptContract` additions. The verified inventory is 103 contracts: 100 M0 plus three M1A.
- Resource-first, closure-next, manifest-last publication with active-root compare-and-swap.
- Failure injection and rollback evidence that leaves `.proasset` source and the prior active root unchanged.

#### Gate

- Identical accepted inputs produce byte-identical canonical resource, closure, layout, lookup, and manifest payloads.
- The Root Spine occupies positive local Z; the station landmark, anchors, routes, HLOD, collision, and navigation match the bound policy.
- Every dependency resolves, every byte/count/depth total is recomputed, and no post-manifest evidence enters the content DAG.
- The local-operations lookup is closed over exactly one private Realm and contains no public shell, refinement, presence, rendezvous, bridge, Traveler, connected-Cityform, or foreign-Realm dependency.
- Exact resource ceilings pass; a ceiling exceeded by one rejects before publication.
- Missing proof, failed law, exceeded bound, counterexample, version mismatch, CPU parity failure, WGSL parity failure, or unsupported device closes the optimization gate and returns valid baseline semantics.
- Invalid publication leaves the prior bake active, and rollback never mutates `.proasset` source.
- Browser, cross-record, publication-order, rollback, and flat-import evidence passes. The M1A suite passed 15/15 with zero skips.

#### Exclusions

No public shell, access refinement, Storylet compiler, richer station kit, live observation, renderer, local Operations View runtime, multiplayer, or networking.

#### Rollback boundary

Discard or leave unreachable the candidate's immutable content and retain the prior active root. Never change the `.proasset` source.

The complete M1A implementation boundary is specified in [M1A owner-private SecureMesh station bake](m1a-private-securemesh-bake.md).

### M1B: independent public and refinement packages (complete)

#### Scope

- Implement `PublicRealmShell` from an explicit public appearance projection whose provider cannot read private input.
- Implement `AccessRefinement` from one capability-scoped projection, audience, expiry, and active epochs.
- Keep owner-private, public, and refinement resources, closures, manifests, verification packages, and publication roots independent; no public or refinement compiler may reuse an owner-private intermediate or cross-audience cache entry.
- Establish structural public noninterference through a public-only input surface, two independent byte-compared runs, exact public closure, and zero private-read, cross-audience-cache, and forbidden-reachability counters.

#### Deliverables

- One public SecureMesh shell kit, explicit public appearance compiler, public shell compiler, audience visual assembler, exact public closure, hardened package verifier, signatures, and immutable compare-and-swap publication.
- One capability-scoped refinement compiler path with an authority-verification port, exact refinement closure, signed visual manifest, AES-GCM-256 encryption adapter seam, sealed access record, hardened package verifier, and opaque-locator publication.
- Byte-identical public semantic output under identical explicit public input and publication schedule, recorded by a signed owner-private/local-private noninterference receipt with the documented two-run evidence limit.
- Signed owner-private/local-private refinement-scope evidence that proves exact resource scope, active epochs, expiry containment, and zero forbidden reachability.
- Four additive contracts: `RealmPublicAppearanceSourceContract`, `RealmRefinementEncryptionEnvelopeContract`, `RealmPublicNoninterferenceReceiptContract`, and `RealmRefinementScopeReceiptContract`. The verified inventory is 107 contracts: 100 M0, three M1A, and four M1B.

#### Gate

- Public closure contains only public-explicit resources and cannot reach private, refinement, forbidden, construct-only, or unlabeled data.
- Refinement closure contains only the exact granted scope and active capability/bridge epochs.
- The public compiler has no private coordinate, anchor, route, cache key, source digest, relocation set, lookup record, or private timing input. The refinement compiler can reach only the exact authority-approved scoped records and cannot reach the rest of the private projection.
- Public publication excludes the noninterference receipt and its signature. Refinement publication excludes the scope receipt, its signature, authenticated-data record, and decrypted canonical plaintext.
- A failed compile, verification, immutable readback, or active-root compare-and-swap leaves the previously selected public or refinement root active.

#### Exclusions

No authored Storylet compilation, richer station kits, live runtime, presence, rendezvous, bridge activation, or network transport.

#### Rollback boundary

Discard or leave unreachable the candidate's immutable public resources or sealed refinement ciphertext and retain the prior audience root. The publisher never mutates the owner-private bake or `.proasset` source. Local publication receipts stay outside every public or refinement artifact closure.

#### Implementation evidence

- `RealmForgeBakeEntry` exposes `compilePublicShell()`, `verifyPublicShell()`, `publishPublicShell()`, `compileAccessRefinement()`, `verifyAccessRefinement()`, and `publishAccessRefinement()` through the existing composition boundary.
- Public compilation performs two independent runs and rejects any canonical difference before it creates the local noninterference receipt.
- Public verification recomputes contract self-digests, resource bytes, exact dependency closure, cross-record bindings, package signatures, and local noninterference evidence.
- Refinement verification recomputes outer records, authenticated data, ciphertext digest, exact signatures, decrypted canonical plaintext, audience closure, scope equality, lifetime, and current epochs.
- Public and refinement publication plans omit local certification receipts and switch active roots only after immutable write/readback verification.

The complete M1B implementation boundary is specified in [M1B public shell and access-refinement packages](m1b-public-refinement-packages.md). (Source: `webgpu-os/apps/realmforge/virtual-realm/RealmForgeBakeEntry.js`; `webgpu-os/apps/realmforge/virtual-realm/RealmAudienceBakeCoordinator.js`; `webgpu-os/apps/realmforge/virtual-realm/publication/RealmAudiencePackagePublisher.js`.)

### M1C: authored Storylets, richer station kits, and M1 closure (complete)

#### Scope

- Implement the declarative Storylet definition and catalog compiler with its independent audience closure.
- Expand the initial station fixture into reviewed richer station kits without changing the flat package or authority model.
- Complete authoring-preview, accessibility, provenance, compatibility, and visual-QA adapters required for the full M1 bake foundation.
- Add opt-in version-2 private, public, and access-refinement compile paths while preserving the exact version-1 paths.

#### Deliverables

- Storylet catalog compiler and validation receipts.
- Reviewed station-kit resources and complete authoring evidence.
- Final private, public, and refinement bake certification closure.
- Two additive flat contracts, bringing the verified ordered catalog to 109 modules.
- One exact 35-case browser gate covering determinism, hostile input, policy, graph closure, audience isolation, station review, publication, rollback, and import boundaries.

#### Gate

- Storylet resources are deterministic, audience-local, dependency-closed, bounded, and non-authoritative.
- Richer station resources preserve required geography, clearance, navigation, accessibility, provenance, disclosure, and resource budgets.
- Every original M1 bake and dependency gate passes across all three artifact variants.
- The accepted M1C harness reported exactly 35 passes, zero failures, and zero skips on 2026-08-28.

#### Exclusions

No live OS observations, ECS projection, grounded traversal, local Operations View rendering, presence, rendezvous, bridges, or networking. Those begin in M2 or later.

#### Rollback boundary

The version-1 compile, verify, publish, and active-root paths remain unchanged. A version-2 candidate cannot become selectable until complete verification, immutable write/readback, and terminal compare-and-swap succeed. Failure retains the prior audience root and never mutates `.proasset` source; newly written unreachable immutable content may be collected later.

#### Implementation evidence

The 109-contract catalog, 39-case contract browser suite, six independent Python vectors, 15-case M1A regression, 21-case M1B regression, and exact 35-case M1C gate are verified. M1C is complete. Its entry bundle resolved 110 modules with zero skipped, and its harness bundle resolved 114 modules with zero skipped.

The frozen module graph, input DTO, reviewed station evidence, version-2 package boundaries, publication stripping rules, exclusions, rollback, and accepted evidence ledger are specified in [M1C Storylet and reviewed station bake](m1c-storylet-station-bake.md).

### M1C-to-M2 durability handoff

M1C is the required producer floor for full M2. The runtime consumes the exact
owner-private version-2 result of `verifyPrivateBake()`, including the reviewed
station, safe text, resource envelopes, inert Storylet catalog, policies,
closures, receipts, and external evidence references. It does not consume
RealmForge authoring DTOs or instantiate RealmForge compiler/provider peers.

The current private publisher selects a manifest root after persisting resource
record text, the dependency closure, and the manifest. That root cannot
reconstruct the exact 17-key version-2 package after restart. Before M2 runtime
implementation, add a content-addressed package artifact, chunked exact
resource/evidence/signature inventories, and owner-partitioned
`RealmPrivateBakeAdmissionIndexV1` that retain the full resource graph,
policy/receipt records, Storylet/station evidence, exact signature envelopes,
verifier identity, artifact keys, byte lengths, and exact digests. Existing
manifest-only roots require an explicit recompile, reverify, and admission
migration; runtime startup never guesses missing records. (Source:
`webgpu-os/apps/realmforge/virtual-realm/publication/RealmBakePublisher.js`.)

Keep the M1 publication root, M2 durable admission head, and M2 in-memory active
bundle as three independent transitions. The admission service owns the first
production task after the M1C gate and before any Engine materialization.
The production M1 storage adapter must expose root, monotonic generation, and
exact head-file SHA so M2 can detect ABA; the accepted M1 compiler/publisher API
and package bytes remain unchanged.
Its executable sequence is [M2A runtime composition](m2a-runtime-composition.md)
followed by [M2B private-bake admission](m2b-private-bake-admission.md).

## Genesis Ecology program overlay (M2+)

Genesis Ecology is a separately gated cross-stack program. It does not reopen
M0-M1C. Its dependency order is defined by the
[whole-stack architecture](../../concepts/genesis-ecology.md),
[Engine and ECS plan](../../engine/genesis-ecology-engine-plan.md),
[WebGPU OS plan](../genesis-ecology-os-plan.md),
[RealmForge plan](../realmforge-genesis-ecology.md), and
[world integration](genesis-ecology-integration.md).

Base Virtual Realm V1 and the Living Digital World track share M2-M7, but they
have separate acceptance. Base V1 may certify without Genesis. The Living
Digital World label additionally requires M2-GE and the canonical VR-GE gates.
Genesis packages are independently activatable sidecars bound to exact accepted
base-bake roots; they never widen the frozen M0-M1C manifests or catalog.

| Existing milestone | Genesis Ecology contribution |
| --- | --- |
| Before and inside M2 | CSE correctness, stable identity, full persistence, generic recipe kernel, ECS barriers/chunk paths, OS admission and private state |
| M2 | Static Continuity Core, Foundry District, and Maintenance Works kits; immutable identity/binding references; reserved sockets; no live phenotype |
| M3 | Live development, regulation, homeostasis, reactions, lineage, QD, roles, culture, dormancy, and Storylet Algebra |
| M4-GE | Independently compiled public Genesis appearance extension and noninterference |
| M5-GE | Signed public ecology status and attributed, consented cultural motif exchange through SecureMesh |
| M6-GE | Capability-bound factory or role proposals across deterministic docking bridges |
| M7 | Long-run ecology, replay, recovery, performance, accessibility, privacy, and release certification |

AGI-led evolution, culture exchange, organismality assessment, and higher-order
Soul Seed proposals remain disabled until deterministic replay, exact resource
accounting, redaction, authority admission, rollback, and lifecycle disposal are
proven.

RealmForge RF-GE1A reports the exact `GenesisPartV1`, `GenesisInterfaceV1`,
`GenesisConstraintV1`, and `GenesisAssemblyV1` wires plus their digest-first
closed-graph validator in a separate inert Parts catalog. RF-GE2 has delivered
the separate four-record Product Genome, Factory Genome, revision-reference,
and constructive-Plan catalog; its deterministic compiler/verifier; and its
sealed 25-registration constructive trust pack. RF-GE3 has delivered only the
bounded process-local exact verified Plan cache, reverse-dependency invalidation
evidence, and deterministic inert recursive package candidates. These gates
close later M3F authoring and cache prerequisites, but do not advance a Virtual
Realm runtime gate by themselves. M3F still needs a catalog-version adapter,
separate extension closure/admission verifier, safe projectors, rollback, and
its own gates. Factory execution, admission, active-head selection,
persistence, promotion, rollback authority, ECS materialization, publication,
installation, and Virtual Realm projection remain later independently gated
work beyond RF-GE5. RF-GE4 and RF-GE5 contribute only accepted, inert authoring
evidence and no runtime authority. Base M3A has no
Genesis dependency.

## M2: grounded Engine and local operations foundation

### Current M2C through M2D-B4G acceptance status

The non-visible M2C app/Engine slice is accepted.
`VirtualRealmEntry.stageStaticCandidate()` is additive, while ordinary
`start()` remains the accepted admission-only path. The implementation consumes
the real frozen six-field M2B accepted result, independently verifies the exact
owner-private M1C version-2 package, and requires an opaque
`prepareCandidateEligibility()` result before allocating the immutable CPU
store or adapter. Before a candidate World exists, the Engine adapter consumes
that preparation exactly once with exact bundle, Realm, lifecycle, admission,
package-blob, and RealmForge-digest bindings. Its factory inspection and creation
also repeat one exact active-bake CSE binding digest; mismatch and replay allocate
nothing.

The reference reconstruction retains 48 verified rows, projects 36 canonical
Realm-content-ID snapshot indexes, retains six Storylet rows as inert data, and
accounts for 522,488 unique graph bytes. Exactly 19 topology nodes and edges
become static ECS objects. Each receives a stable authored string ID, a separate
positive-safe local ECS handle, and a separate dense slot with a positive reuse
generation. Materialization installs exactly seven components and derives
world-space AABBs. One immutable State-First source is attached only to a
disabled/off-active candidate. Reverse disposal closes its decisions, detaches
the source, releases every ECS row and slot, drops the retired candidate World,
then releases the CPU store. Failed release retains exact ownership in a
retryable `cleanup-pending` ledger. Verification uses 12 closed recursive payload
schemas, exact bidirectional topology coverage, and bounded indexed reference
resolution; reference navigation binds three objects including one fully covered
edge. Later adapter methods deny with zero allocation. (Sources:
`webgpu-os/apps/the-virtual-realm/VirtualRealmEntry.js`;
`webgpu-os/apps/the-virtual-realm/security/RealmRuntimePackageVerifier.js`;
`webgpu-os/apps/the-virtual-realm/runtime/RealmStaticStore.js`;
`webgpu-os/apps/the-virtual-realm/runtime/RealmEngineAdapter.js`;
`webgpu-os/apps/the-virtual-realm/runtime/RealmEcsSynchronizer.js`;
`engine/ecs/world/World.js`;
`engine/render/state/StateFirstPresentationSlots.js`.)

Accepted evidence is 24/24 loader browser cases, 24/24 ECS materialization
browser cases, 28/28 ECS-handle compatibility cases, 11/11 focused
Engine-foundation browser cases, 6/6 unchanged M0 Engine-foundation browser
cases, 16/16 established Python proofs, 30/30 M2D-A render-plan browser cases,
5/5 M2D-A confinement proofs, 39/39 M2D-B0 renderer-profile browser cases,
5/5 M2D-B0 confinement proofs, 36/36 M2D-B1 draw-packet browser cases, 9/9
M2D-B1 Python proofs, 60/60 GPU-presentation-port browser cases, 5/5 port
Python proofs, 18/18 syscall-adapter browser cases, 4/4 adapter Python proofs,
27/27 static-presenter cases, 24/24 kernel capability-admission cases, 19/19
runtime-recovery cases, 13/13 frame-coordinator cases, 13/13 application-surface
lifecycle cases, 2/2 manifest-classification proofs, 20/20 real isolated
`AppRegistry` cases, 11/11 factory-integration cases, 8/8 real Desktop
terminal/lease-transport cases, 11/11 production-composition cases, 5/5
independent composition proofs, and 15/15 owner-coupled GPU epoch cases.
M2D-B4A adds 17/17 hostile operator-context browser cases and 6/6 independent
closure/confinement proofs. M2D-B4B adds 30/30 hostile runtime-activation
browser cases and 7/7 independent closure/confinement proofs. M2D-B4C adds
45/45 hostile runtime-checkpoint browser cases and 7/7 independent
closure/confinement proofs. M2D-B4D adds 60/60 hostile runtime-handoff browser
cases and 10/10 independent closure/confinement proofs. M2D-B4E adds 75/75
hostile action-authority browser cases and 11/11 independent closure/
confinement proofs. M2D-B4F adds 60/60 hostile local-operator-policy browser
cases and 11/11 independent closure/confinement proofs. M2D-B4G adds 24/24
hostile terminal-compatibility browser cases and 8/8 independent confinement
proofs. The combined B4A-B4G plus M2A/B3 browser matrix passes 352/352 with
zero skips. The scoped B4A-B4G/Entry/production-composition Python regression
set passes 67/67; the same set plus renderer confinement passes 72/72. Isolated
verifier/adapter/assembler/profile/draw-packet/current-Entry closures contain 51, 27,
18, 12, 18, and 106 modules; the B2 port and
syscall-adapter closures contain 13 and 14 modules; the historical B3-acceptance
composition closure contained exactly 37 modules, and the owner-coupled GPU
closure contains exactly 15 modules. The B4A contract closure contains exactly
one import-inert module. The B4B activation/
eligibility closure contains exactly three cycle-free modules: activation,
candidate eligibility, and the import-inert shared validation-primitives leaf.
The B4C contract is one import-inert module, and its adapter
closure contains exactly 15 modules. The B4D contract is one import-inert
module, and the existing handoff-adapter closure contains exactly 16 modules.
The B4E contract closure contains exactly 16 modules. The B4F contract closure
contains exactly 11 modules. B4G is one import-inert module; the current shared
runtime-dependency, Entry, production-composition, and renderer closures contain
24, 106, 48, and 30 modules respectively.
Every focused
browser gate reports zero skips. The M2D-A, M2D-B0, M2D-B1, M2D-B2-foundation,
application-boundary, B3 composition, B4A operator-context, B4B activation-wire,
B4C checkpoint-wire, B4D handoff-wire, and B4E action-authority-wire evidence
is recorded by
`tests/virtual-realm/m2-static-render-plan.test.html`,
`tests/virtual-realm/m2-static-render-plan.test.js`,
`tests/virtual-realm/test_m2d_renderer_import_confinement.py`,
`tests/virtual-realm/m2-static-renderer-profile.test.html`,
`tests/virtual-realm/m2-static-renderer-profile.test.js`,
`tests/virtual-realm/test_m2db_renderer_profile_import_confinement.py`,
`tests/virtual-realm/m2-static-draw-packet.test.html`,
`tests/virtual-realm/m2-static-draw-packet.test.js`,
`tests/virtual-realm/test_m2db_draw_packet_compiler.py`,
`tests/virtual-realm/test_m2b_app_import_confinement.py`, and
`tests/virtual-realm/test_virtual_realm_manifest.py`. Real isolated discovery
and launch-path evidence is recorded by
`tests/virtual-realm/virtual-realm-manifest-registry.test.html` and
`tests/virtual-realm/m2-factory-integration.test.html`. The exact Desktop branch
evidence is recorded by
`tests/virtual-realm/m2-desktop-terminal-factory.test.html`. The exact B3
assembler, owner/GPU coupling, and independent structural evidence is recorded
by `tests/virtual-realm/m2-runtime-production-composition.test.html`,
`tests/virtual-realm/test_m2db3_runtime_production_composition.py`, and
`tests/virtual-realm/m2-owner-coupled-gpu-presentation.test.html`. The exact B4A
wire evidence is recorded by
`tests/virtual-realm/m2-operator-context-port-contract.test.html` and
`tests/virtual-realm/test_m2db4a_operator_context_port_contract.py`. The exact
B4B wire evidence is recorded by
`tests/virtual-realm/m2-runtime-activation-port-contract.test.html` and
`tests/virtual-realm/test_m2db4b_runtime_activation_port_contract.py`. The exact
B4C wire evidence is recorded by
`tests/virtual-realm/m2-runtime-checkpoint-port-contract.test.html`,
`tests/virtual-realm/m2-runtime-checkpoint-port-contract.test.js`,
`tests/virtual-realm/m2-runtime-checkpoint-port-contract.main.js`, and
`tests/virtual-realm/test_m2db4c_runtime_checkpoint_port_contract.py`. The exact
B4D wire evidence is recorded by
`tests/virtual-realm/m2-runtime-handoff-port-contract.test.html`,
`tests/virtual-realm/m2-runtime-handoff-port-contract.test.js`,
`tests/virtual-realm/m2-runtime-handoff-port-contract.main.js`, and
`tests/virtual-realm/test_m2db4d_runtime_handoff_port_contract.py`. The exact
B4E wire evidence is recorded by
`tests/virtual-realm/m2-action-authority-port-contract.test.html`,
`tests/virtual-realm/m2-action-authority-port-contract.test.js`,
`tests/virtual-realm/m2-action-authority-port-contract.main.js`, and
`tests/virtual-realm/test_m2db4e_action_authority_port_contract.py`.

`VirtualRealmEntry.planStaticScene()` is the only M2D-A trigger. It binds the
authentic store, M2C State-First source, runtime profile, candidate World, and
lifecycle generation into a closed render-resource graph; deterministic object,
geometry, material, light, LOD, projection, and style-only glyph records; and
canonical plan/receipt digests. The exact receipt remains CPU-only, off-active,
invisible, noninteractive, and records zero surfaces, frame producers, and GPU
resources. The application manifest now uses the schema-admitted
`category: "games"` and `section: "Games"`. A 20-case isolated integration gate
proves real `AppRegistry` registration without enumerating other manifests or
evaluating the application entry. A separate eleven-case gate proves the migrated
lazy factory path no longer falls through to constructor guessing; until the
genuine full composition provider is registered, it renders a recoverable unavailable state
without creating an Entry, surface, frame producer, or GPU resource. Its
dependency-injected path proves one persistent canvas stays hidden while ready,
appears only after the first submitted frame, and hides on device loss. The
accepted B3 Desktop branch now opens one Virtual-Realm-only trusted lease,
injects its validated dependency closure, and closes the lease only after
Entry/factory cleanup. Missing composition preserves the recoverable fallback;
invalid, late, or aborted composition closes without mounting.
(Sources: `webgpu-os/apps/the-virtual-realm/VirtualRealmEntry.js`;
`webgpu-os/apps/the-virtual-realm/rendering/RealmSceneAssembler.js`;
`webgpu-os/apps/the-virtual-realm/rendering/RealmStaticRenderPlanContract.js`;
`webgpu-os/apps/the-virtual-realm/rendering/RealmStaticRendererProfileContract.js`;
`webgpu-os/apps/the-virtual-realm/manifest.json`;
`webgpu-os/kernel/AppRuntimeCompositionRegistry.js`;
`webgpu-os/kernel/realm/RealmM2RuntimeComposition.js`;
`webgpu-os/kernel/realm/RealmOwnerCoupledGpuPresentationPort.js`;
`webgpu-os/shell/Desktop.js`.)

M2D-B0 admits one pinned `static-high-v1` renderer profile and its separately
bound zero-allocation receipt. The profile freezes the Engine-correct `+Z`
world-forward camera, pass/depth/resolve topology, authored-first total material
resolution, identity and disclosure values, bounded metre-space light kernels,
metadata-only LOD, deterministic segment-frame and post-`float32` separation
rules, and closed device/resource/canonical budgets. It still reports zero
surfaces, frame producers, GPU resources, visible output, and interaction.
M2D-B1 now deterministically expands the four geometry kinds through one
Engine unit-cube template; resolves authored-first materials; emits exact
instance, material, light, LOD, and pass records; enforces positive `uint32`
identity lanes; and publishes outward-conservative float32 bounds derived from
all eight transformed corners. `VirtualRealmEntry.compileStaticDrawPackets()`
owns this explicit phase and reverse cleanup while exposing no retained plan.
Its accepted receipt still reports zero surfaces, frame producers, GPU
resources, visibility, culling, LOD selection, and interaction. The isolated
M2D-B2 foundation now adds exact GPU capability admission, a nine-operation
owner-bound broker, bounded real-broker-compatible work, persistent-canvas
surface plumbing, an exact sRGB presentation view, static geometry/identity/ACES
passes, first-frame visibility, device-loss invalidation, idempotent terminal
retirement, and clean replacement-generation admission. Focused final audit
found no remaining P0, P1, or P2 implementation defect in this bounded surface.
(Sources:
`webgpu-os/kernel/GpuPresentationCapabilityAdmission.js`;
`webgpu-os/apps/the-virtual-realm/runtime/RealmGpuPresentationPortContract.js`;
`webgpu-os/apps/the-virtual-realm/runtime/RealmGpuPresentationSyscallAdapter.js`;
`webgpu-os/apps/the-virtual-realm/rendering/RealmStaticGpuPresenter.js`;
`webgpu-os/apps/the-virtual-realm/VirtualRealmEntry.js`;
`webgpu-os/apps/the-virtual-realm/factory.js`.)

The accepted M2D-B3 substrate adds `AppRuntimeCompositionRegistry`, guarded
`Desktop` lease transport and cleanup ordering, the exact
`RealmM2RuntimeComposition` 16-key dependency-version-2 assembler, and an
owner-coupled GPU epoch port. It confines raw syscalls and the source process
owner inside the trusted OS composition. Registry requests, returned leases,
and injected dependencies are own-data-descriptor snapshots; accessor,
inherited, symbol, or later prototype changes cannot redirect them. Invalid-
lease cleanup is quarantined until retry succeeds, and a failed concurrent
registry destroy remains retryable. GPU syscall methods are captured into a
private frozen facade, while source-owner operations are captured before
prototype mutation can replace them. The assembler reuses one
`runtimeActivationPort` for Engine candidate preparation and consumption and
binds each GPU epoch to the exact acquired owner/generation while requiring a
distinct owner on restart. Release synchronously fences child and GPU work,
retires the GPU epoch before the source owner, remains retryable after partial
failure, and cannot be invoked by lease close while an Entry owner is active. A
rejected owner acquisition retains its GPU-first cleanup phase for close retry.
No non-Virtual-Realm app can obtain or invoke the opener.

The teardown path is retryable across every retained wrapper. Factory cleanup,
Desktop's provisional handoff, the composition-bound cleanup, Desktop's
`app-unmount` close phase, and the lazy factory delegate each share one in-flight
attempt, clear only a rejected attempt, and cache success. Retrying a failed
inner phase does not repeat lifecycle or owner phases that already retired.
Focused evidence remains 11/11 factory and 8/8 Desktop cases, while the lazy
factory contract is now 27/27 with both settled and in-flight
reject-once/succeed-on-retry cases.

M2D-B4A independently freezes the exact `operatorContext@1` application wire
in `webgpu-os/apps/the-virtual-realm/runtime/RealmOperatorContextPortContract.js`.
Its port exposes only `snapshot`, `subscribe`, and `assertCurrent`; its snapshot
is the exact six-field operator/partition/generation/local-Realm/authority-epoch/
policy-epoch record. Requests, snapshots, invalidation events, subscriptions,
and disposal receipts are frozen own-data records. An invalidation callback
receives only `operator-context-invalidated` plus a closed reason code and never
receives the current or replacement operator identity. The contract preserves
AbortSignal and callback identity without inspecting or invoking opaque
functions, rejects already-aborted work, and fails closed on mutable, inherited,
accessor, symbol, exotic, extra-field, and hostile proxy shapes. Entry and the
lifecycle-generation guard now construct the exact frozen snapshot and
assert-current requests rather than passing mutable object literals.

B4A deliberately installs no provider. B4H now supplies `localRealmId` and
`authorityEpoch` together through the protected per-account
`RealmLocalSelectionHeadStorage`; the epoch advances across Realm changes.
`policyEpoch` comes from the selected Realm's protected local-policy head.
The missing adapter must bind these to Kernel account and generation state and
fail unavailable for a missing or cleared selection, never manufacture a Realm
sentinel. Panel or mount IDs, public profiles, directory enumeration, and
Passport Realm identity cannot supply these values.

M2D-B4B independently freezes the complete provider-free
`realmRuntimeActivation@1` application grammar in
`runtime/RealmRuntimeActivationPortContract.js`. The six-method port is exactly
`readActiveBundle`, `prepareCandidateEligibility`,
`consumeCandidateEligibility`, `offerCandidate`, `commitCandidate`, and
`abortCandidate`. It re-exports the accepted M2C eligibility/consume/legacy-
abort grammar and adds all active-read, offer, commit, full activation-abort,
and `realmActiveBundleTeardown@1.close()` request/result variants. Every record
is an exact frozen own-data shape with closed status and reason vocabularies,
canonical identifier/content-ID/uint64 bounds, preparation/result correlation,
and cancellation policy split between forward work and teardown.

Offer admission binds three distinct identity-only opaque handles to an exact
16-field safe `CausalStatePreparedCommitReceiptV2` receipt. The outer prepared-commit
and active-bake-output digests must equal the receipt fields synchronously, but
the app contract intentionally does not recompute a cryptographic self-digest
or validate private handle brands. Those checks, ownership transfer, durable
pinning, CSE step 8, visible-pointer mutation, and gate opening belong only to a
future trusted `RealmRuntimeActivationService`. No Entry path invokes offer or
commit, no provider or state store is added, and ordinary launch behavior is
unchanged. The accepted application correlation name is
`eligibilityPreparationId`; older planning prose that says
`activationPreparationId` names the same internal lineage and does not create a
second public token. Consumption is one-shot authorization for candidate
materialization; a genuine service may retain only the bounded correlated state
needed for the later offer, while the M2C fixture's deleted map entry is not a
provider-state specification. Before B4H installs a provider, the existing
legacy M2C abort call sites and fixtures must migrate atomically to B4B's rich
abort reasons/results on the same method; the compatibility validators are not
permission for one final caller to receive ambiguous result shapes.

Focused B4B evidence is 30/30 hostile browser cases and 7/7 independent Python
closure/confinement proofs. The combined activation, eligibility, and shared
validation closure is exactly 15 cycle-free modules. The tests cover every
terminal variant, replay, pre-aborted forward work, cancellation-safe cleanup,
descriptor and proxy attacks, opaque-handle non-reflection, handle aliasing,
prepared-CSE equality, and absence of provider or ambient execution authority.

M2D-B4C independently freezes the complete provider-free
`realmRuntimeCheckpoint@1` application grammar in
`runtime/RealmRuntimeCheckpointPortContract.js`. The exact five-method port is
`readLatest`, `prepareCheckpoint`, `commitCheckpoint`, `abortCheckpoint`, and
`retireCheckpoint`. Every request and result is an exact frozen own-data record
with closed status and reason vocabularies. Validation rejects mutable,
inherited, accessor, symbol-bearing, exotic, extra-field, shape-shifting, and
inspection-throwing values without invoking a port method.

The read request is exactly `{ localRealmId, maximumBytes, signal }`.
`maximumBytes` must equal the accepted runtime profile's
`maximumAdmissionControlRecordBytes`, currently `1048576`. The result is exactly
one of `missing`, `record`, `cleared`, `invalid`, or `unavailable`. Missing is
the unique generation-`0`/null-SHA observation. Record carries one sanitized
checkpoint projection and its exact `RealmRuntimeCheckpointBindingV1`.
Cleared carries the observed positive generation, exact storage SHA, and
tombstone digest. Invalid is closed to `oversized`, `future-version`,
`malformed`, `live-value`, `digest-invalid`, or
`checkpoint-binding-invalid`. Unavailable is closed to
`root-recovery-pending` or `manager-authority-unresolved`.

Preparation accepts only a local Realm, exact checkpoint draft, exact expected
head binding, and live signal. Its result is `prepared`, `busy`, or
`unavailable`. Commit accepts only the bounded single-use
`checkpointPreparationId` correlation and live signal. Its result is
`committed`, `not-committed`, `unavailable`, or `invalid`. The committed result
alone carries a checkpoint plus a separate bounded
`checkpointHandoffAuthorizationId`; it does not grant checkpoint-read
authority. Exact predecessor retention and checkpoint-source change are
explicit `not-committed` outcomes with an abandonment-receipt digest. Source
unavailability or unresolved manager/root state stays unavailable rather than
being mislabeled as a successful or proven-no-effect commit.

Abort accepts exactly one preparation correlation, the closed teardown reason
`application-close`, `operator-switch`, `device-loss`, `handoff-cancel`, or
`checkpoint-recovery`, and a live teardown signal. Its result is `aborted`,
`already-terminal`, `not-found`, or `recovery-pending`. An already-terminal
result is closed to `abandoned`, `committed`, or `retired`; only an abandoned
terminal may carry the retained abort-receipt digest. Retirement accepts the
local Realm, exact expected head binding, and live signal. It returns
`cleared`, `busy`, `invalid`, or `unavailable`; the sole busy reason is
`checkpoint-handoff-edge-active`.

The exact head binding requires generation `0` with null SHA only for a
never-initialized head and positive generation with a canonical storage SHA
otherwise. Draft validation cross-binds the top-level admission-index digest to
the nested admission head. A record projection cross-binds its observed
generation, storage SHA, checkpoint ID, accepted heads, profile, bundle,
anchor, optional cursor presence/value, policy, and record digest to the nested
checkpoint binding. The binding also preserves process owner, lifecycle,
visible pointer/live-visibility evidence, and checkpoint-source projection and
authorization digests. B4C validates their exact syntax and equality but does
not recompute a content digest or treat any digest as authority.

`RealmRuntimeCheckpointAdapter` now validates the complete port, derives the
fixed read cap from the already validated frozen runtime profile, emits only the
exact read request, and validates the returned observation after pre/post
lifecycle-generation fences. `RealmM2RuntimeComposition` validates the port
before GPU, profile, or process-owner acquisition and preserves its identity in
the dependency lease. `VirtualRealmEntry` supplies the validated profile to the
adapter, but normal startup still performs no checkpoint call. (Sources:
`webgpu-os/apps/the-virtual-realm/runtime/RealmRuntimeCheckpointPortContract.js`;
`webgpu-os/apps/the-virtual-realm/runtime/RealmRuntimeCheckpointAdapter.js`;
`webgpu-os/apps/the-virtual-realm/VirtualRealmEntry.js`;
`webgpu-os/kernel/realm/RealmM2RuntimeComposition.js`.)

B4C deliberately installs no provider. It allocates no preparation or handoff
authorization, reads no protected bytes, retains no correlation, acquires no
checkpoint-source lease, performs no CAS, creates no root or journal, and
retires no checkpoint. Those operations remain with the future protected
checkpoint head, source service, and root manager. The First Shard remains
excluded.

Focused B4C evidence is 45/45 hostile browser contract cases and 7/7
independent Python closure/confinement proofs. The checkpoint contract is one
import-inert module with zero imports, cycles, or parse errors. At B4C
acceptance, integration closures were acyclic and error-free at 15 modules for
the checkpoint adapter, 96 for Entry, and 36 for
`RealmM2RuntimeComposition`, with no First Shard dependency. The then-current
combined scoped B4A/B4B/Entry/composition Python regressions passed 20/20; M2A
runtime composition passed 30/30 and B3 production composition passed 11/11.

M2D-B4D independently freezes the complete provider-free
`realmRuntimeHandoff@1` application grammar in
`runtime/RealmRuntimeHandoffPortContract.js`. Its exact three-method port is
`read`, `write`, and `clear`. All requests, observations, and mutation outcomes
are exact frozen own-data records; field and reason catalogs are exact frozen
arrays. The contract is import-inert, invokes none of the supplied methods or
opaque functions, and fails closed on mutable, inherited, accessor, symbol-
bearing, exotic, widened, inspection-throwing, and shape-shifting records.

Read carries exactly `{ operatorIdentity, localRealmId, maximumBytes, signal }`.
The byte ceiling is the frozen runtime profile's
`maximumRuntimeHandoffBytes`, exactly `65536`. Read returns `missing`, `record`,
`cleared`, `invalid`, or `unavailable`. Missing alone is generation `0` with a
null storage SHA. Record carries a complete sanitized
`RealmRuntimeHandoffRecordV1`; cleared carries a positive observed generation,
the exact storage SHA, and a tombstone digest. Invalid read and clear results
are closed to `oversized`, `future-version`, `malformed`, `live-value`,
`digest-invalid`, and `checkpoint-binding-invalid`. Unavailable is closed to
`root-recovery-pending` and `manager-authority-unresolved`.

Write carries only operator and local-Realm identity, the advisory
`{ operationsViewRequested }` draft, one canonical
`checkpointHandoffAuthorizationId`, one exact expected handoff head, and a live
signal. The caller cannot author roots, graph edges, runtime pins, manager
operations, checkpoint bindings, storage locations, or live handles. A write
result is exactly `written`, `predecessor`, `invalid`, or `unavailable`.
Successful evidence advances the expected generation exactly once and exposes
only the new root reference, exact storage SHA, record digest, and checkpoint-
binding digest. A no-effect predecessor is bound to the exact expected
generation/SHA. Every private authorization failure is deliberately collapsed
to the single public `handoff-authorization-invalid` reason so the wire cannot
be used as an identity, replay, retention, or checkpoint-state oracle.

Clear carries only operator and local-Realm identity, the exact expected head,
and a live signal. Its result is `cleared`, `already-clear`, `predecessor`,
`invalid`, or `unavailable`. A never-initialized `0`/null head cannot return
`cleared`; among settled idempotent outcomes it permits only `already-clear`
without a tombstone. `Predecessor`, `invalid`, and `unavailable` remain legal.
A positive already-clear observation must carry its exact SHA and tombstone
digest. A newly cleared result advances the expected positive generation
exactly once and returns the retired root reference, successor SHA, and
tombstone digest. Incomplete root, retained-edge, or checkpoint-release
settlement remains `root-recovery-pending`; it cannot be reported as cleared.

The handoff-record grammar preserves four exact variants: generation one or a
replacement generation, each with or without `logicalCursorId`.
`previousHandoffStorageSha256` is forbidden at generation one and mandatory
after it. The record cross-binds process owner, lifecycle, admission index, both
publication/admission heads, runtime profile, runtime bundle, safe anchor,
optional cursor presence/value, and local policy to the nested accepted
`RealmRuntimeCheckpointBindingV1`. B4D validates exact shape, canonical
identifier/uint64/SHA/content-ID syntax, and every duplicated equality. It does
not recompute a digest, validate an authorization, perform CAS, or prove a
root, protected graph edge, runtime pin, or durable settlement.

`RealmRuntimeHandoffAdapter` now validates the complete port and frozen 65,536-
byte profile cap, emits the exact read request under pre/post lifecycle fences,
validates the returned variant, and descriptor-snapshots a record before the
existing semantic and cryptographic reduction. Accepted operator identity is
retained only inside the private observation; the public application status
continues to expose none of the record, checkpoint binding, operator, process
owner, runtime bundle, root, or manager-operation fields. The adapter exposes
no write or clear method. `RealmM2RuntimeComposition` validates handoff before
GPU, profile, or source-owner acquisition and forwards the identical validated
port in its frozen dependency lease. Existing fakes throw if runtime code ever
calls write or clear. (Sources:
`webgpu-os/apps/the-virtual-realm/runtime/RealmRuntimeHandoffPortContract.js`;
`webgpu-os/apps/the-virtual-realm/runtime/RealmRuntimeHandoffAdapter.js`;
`webgpu-os/apps/the-virtual-realm/runtime-contracts/RealmRuntimeHandoffRecordContract.js`;
`webgpu-os/kernel/realm/RealmM2RuntimeComposition.js`.)

B4D installs no provider, protected head, storage path, journal, authorization
issuer, retained graph edge, runtime pin, root manager, checkpoint release,
cross-session activation, or live runtime restoration. Focused evidence is
60/60 hostile browser cases and 10/10 independent Python proofs. The B4D
contract closure is exactly one import-inert module; the handoff adapter,
Entry, and composition closures at B4D acceptance were respectively 16, 97,
and 37 acyclic error-free modules. The then-current scoped B4A-B4D/Entry/
composition Python suite passed 37/37. B4A, B4B, B4C, M2A composition, and B3
production browser regressions passed 17/17, 30/30, 45/45, 30/30, and 11/11.
No closure imported or referenced the First Shard.

M2D-B4E independently freezes the provider-free `realmActionAuthority@1`
application grammar in
`runtime/RealmActionAuthorityPortContract.js`. Its exact port is
`{ portName, version, submitProposal, observeResult }`. Validation preserves
the two callable identities and invokes neither method. Every public data
validator is descriptor-first, exact-shape, and bounded, and preserves the
identity of a complete proven frozen input; creators and snapshot helpers
produce detached frozen values. Mutable, inherited, accessor, symbol-bearing,
exotic, cyclic, functional, inspection-throwing, and shape-shifting data fails
closed.

Every submit is bound to the exact seven-field owner-local context:
`operatorIdentity`, `operatorGeneration`, `localRealmId`,
`lifecycleGeneration`, `authorityEpoch`, `policyEpoch`, and
`activeBundleBinding`. The nested active-bundle binding is exactly
`runtimeBundleId`, `admissionIndexDigest`, `visiblePointerGeneration`, and
`visibleCommitReceiptDigest`. The request then adds only the frozen M0
`RealmActionProposalV1` and a live `AbortSignal`. Operator and actor remain
distinct identities. The proposal Realm must equal `localRealmId`; audience
must be `owner-private`; disclosure must be `local-private`; and presence,
rendezvous, and bridge fields are structurally forbidden.

The wire reuses the existing M0 proposal, authority-receipt, and result
definitions while adding the stricter application-boundary invariants needed
before a provider may exist. Content identifiers are exactly
`sha256:256:<64 lowercase hexadecimal>`. `operationNonce` is exactly 64
lowercase hexadecimal characters. Proposal and receipt lifetimes are finite,
positive, strictly ordered, and capped at 300,000 milliseconds; an allowed
receipt is contained inside the proposal lifetime. `manage-local-zone`
requires both `capabilityEpoch` and `expectedStateRevision`, but the frozen M0
receipt grammar cannot authorize it, so B4E admits the request shape while
forcing every attempted allowed receipt to fail closed.

Submit returns exactly `receipt`, `invalid`, or `unavailable`. A receipt result
echoes all seven context fields and carries the outer authority-receipt ID and
digest, an exact `action-result-correlation:v1:<64 lowercase hexadecimal>` ID,
and the frozen receipt. Every decision, including non-allow, receives that
result correlation. An allowed receipt alone may expose a complete capability
tuple and must remain `pending-result`; every non-allow receipt omits the tuple,
is `not-dispatched`, and maps denial or replay conflict to the same public
`action-authorization-invalid` reason. Thus the application cannot probe
private capability, replay, or policy state.

Observe repeats the complete context and exactly seven correlation fields:
proposal ID/digest, authority-receipt ID/digest, dispatch ID, idempotency key,
and result-correlation ID. It returns `pending`, `terminal`, `invalid`, or
`unavailable`; there is deliberately no `missing` or `not-found` oracle. A
non-allow receipt cannot remain pending. Terminal results must cross-bind every
available proposal, receipt, dispatch, idempotency, target, action, epoch, and
result identity. `resultingStateRevision` appears if and only if the outcome is
`succeeded`; a non-allow terminal outcome and reason must exactly match its
receipt.

Both request/result families are capped at 65,536 canonical bytes. Invalid
submit reasons are exactly `oversized`, `future-version`, `malformed`,
`live-value`, `digest-invalid`, `proposal-binding-invalid`, and
`action-authorization-invalid`. Invalid observe reasons replace the final two
with `result-correlation-invalid`. Both operations share only
`authority-unavailable`, `action-capacity-unavailable`, and
`settlement-recovery-pending` as unavailable results.

`RealmRuntimeDependencyContract` now validates the exact B4E port, preventing a
direct `VirtualRealmEntry` construction from bypassing this boundary.
`RealmM2RuntimeComposition` validates it after the handoff wire and before GPU,
profile, or source-owner acquisition, then preserves the identical callable
object in the dependency-v2 lease. The import-inert
`RealmRuntimeValidationPrimitives` leaf now owns the shared error, exact-record,
identifier, uint64, signal, and head-binding helpers. The aggregate dependency
contract re-exports those exact bindings, while B4B candidate eligibility
imports the leaf directly; B4B therefore cannot reach or acquire B4E through an
inverted aggregate import. Ordinary startup calls neither
`submitProposal` nor `observeResult`, and no action adapter, dispatcher,
executor, operations panel, provider, state, cache, clock, entropy source,
storage path, or network route was introduced.

B4E is wire syntax and correlation, not action authority. The future B4H owner
must recompute digests, mint unpredictable unique correlations, enforce
single-spend and exact-retry behavior, reassert current operator/Realm/
lifecycle/authority/policy/bundle bindings immediately before dispatch, make
dispatch and durable settlement atomic, and recover incomplete work without
reporting false success. Focused evidence is 75/75 hostile browser cases and
11/11 independent Python proofs. The B4E, shared dependency, Entry, and
composition closures at B4E acceptance were exactly 16, 21, 103, and 45
acyclic error-free modules. The then-current scoped B4A-B4E/Entry/composition
Python suite passed 48/48; B4A-B4E plus M2A and B3 browser regressions passed
268/268 with zero skips.

M2D-B4F independently freezes the provider-free `localOperatorPolicy@1`
application grammar in
`runtime/RealmLocalOperatorPolicyPortContract.js`. Its exact port is
`{ portName, version, readPolicy, subscribe }`. Port, request, callback,
`AbortSignal`, subscription, and disposal-function identities remain opaque;
validation invokes none of them. Pure policy, read-result, invalidation, and
disposal validation returns detached, deeply frozen data snapshots. Hostile
mutable, inherited, accessor, symbol-bearing, exotic, cyclic, functional,
inspection-throwing, and shape-shifting data fails closed.

A read request contains exactly `operatorIdentity`, `operatorGeneration`,
`localRealmId`, `lifecycleGeneration`, `authorityEpoch`, `policyEpoch`, and a
live `signal`. The two epochs may be zero only in this request so the existing
B4A unavailable-context path remains representable. A successful `policy`
result requires both epochs to be positive, echoes all six context fields, and
adds exactly one nested `head` plus the accepted M0
`LocalOperatorViewPolicyV1`. The head is exactly `policyId`, `policyRevision`,
and a `sha256:256:<64 lowercase hexadecimal>` `policyDigest`. Policy owner and
local Realm must equal the read context, while policy ID, revision, and digest
must equal the head. B4F validates syntax and equality only; it does not claim
that the digest was recomputed from the policy body.

Read statuses are only `policy`, `invalid`, and `unavailable`. Invalid reasons
are exactly `oversized`, `future-version`, `malformed`, `live-value`,
`digest-invalid`, and `policy-binding-invalid`; unavailable reasons are only
`policy-unavailable` and `policy-recovery-pending`. There is no missing-policy
identity oracle. Read and policy data are capped at 65,536 canonical bytes.

A subscribe request repeats the same context with positive authority and
policy epochs, the same exact head, an opaque `onInvalidated` callback, and a
live signal. When correlated with a successful read, every context and head
field must match. Its only event is exactly
`{ eventKind: 'local-operator-policy-invalidated', reasonCode }`, where the
reason is `context-invalidated`, `policy-invalidated`, or `service-stopped`.
The event is data-only: it cannot carry a replacement policy, foreign Realm,
connected-city data, projection, handle, provider, or authority. Subscription
and disposal shapes are exactly `{ subscriptionId, dispose }` and
`{ subscriptionId, disposed: true }`.

B4F hardens the existing `localOperatorPolicyPort` slot without adding a
seventeenth dependency key. Runtime dependency validation applies the full
B4F contract; trusted composition validates it immediately after action
authority and before GPU syscalls, capability-profile inspection, or process-
owner acquisition, then forwards the identical accepted object. At the original
contract checkpoint ordinary startup invoked neither method. B4F added no provider, policy store, monotonic
head, clock, recovery journal, view, minimap, controller, renderer, World/ECS
mutation, network route, or foreign-city projection. B4H has since implemented
separate kernel-only policy and current-selection/authority-epoch head sources,
sharing the same protected write-recovery transaction helper. Bounded B4A/B4F
adapters now retain one coherent current-Realm/authority/policy observation and
reassert the actual issued lifecycle, with synchronous terminal invalidation.
The later [Entry connection](m2-runtime-foundation.md#entry-owned-operator-and-policy-subscriptions)
now consumes policy reads and subscriptions with retryable disposal. Full
provider integration remains outstanding; the unchanged wire contract alone
did not implement those adapters or consumers.

The B4F hardening also closes two pre-existing cross-record substitution gaps:
zone-management proposal acceptance and minimap acceptance now require the
supplied policy's `policyId`, `policyRevision`, `localRealmId`, and
`ownerIdentity` to match the accepted target record. Schema-valid foreign
policies therefore fail before their permissions or limits can be consumed.

Focused B4F evidence is 60/60 hostile browser cases and 11/11 independent
Python proofs. At B4F acceptance, the B4F, shared dependency, Entry,
production-composition, and renderer closures were exactly 11, 23, 105, 47,
and 29 acyclic error-free
modules. The scoped B4A-B4F/Entry/production-composition Python suite passes
59/59, or 64/64 with the renderer confinement proof included. B4A-B4F plus M2A
and B3 browser regressions pass 328/328 with zero skips.

### Accepted M2D-B4G terminal legacy compatibility

`RealmLegacySurfaceFramePort.js` completes the seventh flat boundary. The
existing `surfaceFrame@1` slot remains in the exact 16-key dependency-v2 record.
Its reviewed singleton exposes only `portName`, `version`, `acquireSurface`,
and `registerFrameProducer`. Both methods synchronously return the same frozen
`{ status: 'unavailable', reasonCode: 'realm-gpu-presentation-required', recoverable: false }`
record. No request is admitted or inspected; arguments, callbacks, signals,
receivers, and revoked proxies cannot trigger a resource operation.

The factory accepts no configuration. Port and result have null prototypes;
methods are frozen. Exact singleton-identity admission rejects structural
copies and proxies without executing their traps or callables. Both aggregate
dependency validation and trusted composition enforce this boundary, with
composition validating before GPU/profile/process-owner inspection. It forwards
the accepted identity, never raw surface/frame wrappers. The genuine
owner-coupled GPU presentation path remains the only GPU route.

B4G passes 24/24 hostile browser cases and 8/8 independent Python proofs. The
current B4A-B4G plus M2A/B3 browser matrix passes 352/352, and the scoped Python
matrix including renderer confinement passes 72/72. Exact error-free acyclic
closures are B4G 1, dependency 24, Entry 106, composition 48, and renderer 30.
The dedicated [terminal compatibility specification](m2-runtime-foundation.md#m2d-b4g-terminal-legacy-surfaceframe-compatibility)
records the complete API, same-module requirement, diagnostic boundary,
failure behavior, source paths, and rollback contract.

All seven B4 wire boundaries are accepted. B4H genuine-source construction is
underway and remains unaccepted. The bounded kernel-only policy and selection
sources are
`RealmLocalOperatorPolicyHeadStorage` for each explicit Realm's policy and
`RealmLocalSelectionHeadStorage` for the captured account's current local Realm
and authority epoch. Both require a genuine generation-fenced protected storage
view. Passport, mounts, panels, runtime profiles, and directory enumeration do
not supply account, Realm, or epoch authority.
The separate read-only operator snapshot, reserved-generation head, and
process-local lifecycle session prerequisites are recorded in the flat
readiness ledger below; none is the complete live authority provider.

The storage-source claim has an explicit trusted-construction premise. The
exported `storageManager.bindOperatorServiceRoot()` currently accepts a
caller-created `OperatorScope` and current-scope callback; service descriptors
and the branded-view factory are also importable. A genuine view brand therefore
does not prove that a hostile same-origin module obtained it from Kernel.
The source gates prove typed head, scope-fencing, and transaction behavior under
trusted module construction, not hostile same-origin import isolation. Before
B4A/B4F adapter or provider activation, require both authenticated
kernel-controlled acquisition and enforced backend isolation that prevents
native same-origin OPFS access and import-based bypass. `OPFSDriver` obtains
the origin-wide storage root; manager guards apply only to calls through its
API. Acquisition tokens, same-origin workers, and source import allowlists do
not isolate that native backend. The dependency remains inside pieces 3 and 10;
no new subgate is created. See the
[current shared-origin enforcement gap](security-privacy.md#current-shared-origin-enforcement-gap).
(Sources:
`webgpu-os/storage/StorageManager.js`;
`webgpu-os/storage/OPFSDriver.js`;
`webgpu-os/kernel/OperatorPrivateServiceStorageView.js`;
`webgpu-os/kernel/schema/OperatorScope.js`.)

The policy source verifies the canonical M0 `LocalOperatorViewPolicyV1` body
and digest, preserves one stable `policyId`, treats revision IDs as opaque,
advances uint64 `policyEpoch` by exactly one, and binds each successor to its
exact predecessor storage SHA-256. Its unchanged-policy path performs zero
writes. The closed `virtual-realm-local-policy-v1` service admits only the
Realm-hashed policy control path, with no delete, list, or content authority.

The selection source uses one fixed `/selection/head.json` control record,
bounded to 4,096 bytes, inside the per-account
`virtual-realm-local-selection-v1` service. The exact six-field record binds
format, version, account principal, nullable `localRealmId`, `authorityEpoch`,
and predecessor storage SHA. Its positive uint64 epoch advances across every
Realm change and survives reopen, including A-to-B-to-A changes. Clearing
persists a positive-epoch null-Realm tombstone; it never deletes or resets the
head. Repeating the same selection without an explicit advance writes nothing.
`advanceAuthority: true` requires and retains the current non-null selected
Realm; it invalidates the prior epoch but grants no capability. Callers cannot
supply the next epoch. Missing storage is represented only internally by epoch
zero and null SHA, not as a selected Realm.

Both sources reuse `RealmProtectedHeadStorage` for native-signal and scope
fencing, bounded canonical exact-byte reads, exact expected epoch/SHA comparison,
successor validation, CAS receipts, exact readback, and unknown-write recovery.
Its fixed domain hooks are kernel implementation details, not a registration
framework or an application-supplied schema. Source-private diagnostics remain
frozen and non-disclosing. A private `writeSequence` prevents an older or
overlapping read from clearing an uncertain write's recovery fence.

Each policy/selection source exposes only trusted `readCurrent`,
`assertCurrent`, and
`replaceCurrent` methods. Neither is an application port. The next missing
adapter must bind Kernel account/generation, selected Realm/`authorityEpoch`,
and that Realm's `policyEpoch` into the accepted B4A/B4F contracts; missing or
cleared selection fails unavailable without a sentinel. It must also reassert
lifecycle state and produce bounded invalidation. No source registers an opener,
grants Realm ownership, or changes the B3 or Entry import closures. Ordinary
launch remains recoverably unavailable. A physical non-black WebGPU Cityform
frame, controller, Operations View, minimap, visible bundle swap, M2E, and
integrated M2 remain unaccepted. (Sources:
`webgpu-os/kernel/realm/RealmLocalOperatorPolicyHeadStorage.js`;
`webgpu-os/kernel/realm/RealmLocalSelectionHeadStorage.js`;
`webgpu-os/kernel/realm/RealmProtectedHeadStorage.js`;
`webgpu-os/kernel/OperatorPrivateServiceStorageView.js`.)

### Flat M2D-B4 authority sequence

The authority work has seven accepted boundaries: six provider-free wire
contracts and one complete terminal compatibility implementation. Every module
remains a peer; no family imports, discovers, or owns another family. B4H alone
composes the genuine source owners and stateless B4G compatibility port.

| Gate | Flat contract family | Genuine trusted source | Acceptance boundary |
| --- | --- | --- | --- |
| M2D-B4A — accepted | `operatorContext@1` snapshot/assert/subscribe/dispose | Provider-free contract; B4H now has a bounded one-shot adapter over original active operator scope and the boot-owned coherent local-Realm/authority/policy observation | Original acceptance is the exact non-disclosing wire; bounded source evidence is recorded separately under B4H. No full provider or guessed fields. |
| M2D-B4B — accepted | Runtime activation read/eligibility/offer/commit/abort/active teardown | Provider-free contract now; later `RealmRuntimeActivationService`, active-bundle head, guard-private activation clock, activation root leases, private handle brands, and active-bake CSE runtime | Exact replay, stale-head, owner, generation, bundle, eligibility, prepared-CSE, result, and cleanup wire bindings only; no provider, ownership transfer, CSE swap, pointer mutation, or gate opening |
| M2D-B4C — accepted | Checkpoint read/prepare/commit/abort/retire | Provider-free contract now; later protected checkpoint head, root manager, checkpoint-source lease, profile and lifecycle bindings | Exact request/result, projection/binding, correlation, cancellation, no-effect, and cleanup-evidence wires only; no provider, storage, CAS, root activation/retirement, or handoff authority |
| M2D-B4D — accepted | Handoff read/write/clear | Provider-free contract now; later protected handoff head, verified checkpoint binding/retained graph edge, runtime pin, profile and local policy | Exact request/result, record/checkpoint cross-binding, CAS-result, no-effect, tombstone-lineage, and public-denial wires only; no provider, live handle, runtime restoration, root/edge/pin mutation, or cross-operator authority |
| M2D-B4E — accepted | `realmActionAuthority@1` submit/observe proposal-result wire | Provider-free contract now; later Local Operations authority over the active bundle and current operator/Realm/lifecycle/authority/policy epochs | Exact owner-local context, proposal/receipt/result snapshots, finite lifetime, seven-field correlation, generic denial, pending/terminal, and closed recovery wires only; no provider, replay ledger, entropy, digest recomputation, dispatch, execution, mutation, or result store |
| M2D-B4F — accepted | `localOperatorPolicy@1` read/subscribe | Provider-free contract plus implemented kernel-only protected policy head, bounded retained-cut adapter with actual issued-session invalidation, and Entry subscription/disposal integration. | Original acceptance is the exact six-field owner-local context, nested policy head, positive-success epochs, three read statuses, data-only invalidation, teardown receipt and65,536-byte bound. B4H source evidence is separate; no full provider, view, minimap, mutation or foreign-city projection. |
| M2D-B4G — accepted | Legacy surface/frame compatibility | Stateless reviewed singleton; the accepted owner-coupled GPU presentation path retains sole GPU authority | Both methods return exact terminal unavailable/reason/recoverable-false data; singleton-identity admission rejects copied or wrapped raw implementations before GPU/profile/owner inspection |
| M2D-B4H — underway, not accepted | Genuine production authority provider | Protected policy/current-selection sources, boot observation, bounded B4A/B4F adapters, Entry subscriptions and the bounded isolated local-head channel are implemented. Remaining genuine owners, full isolated provider/renderer placement, accepted B4G singleton and B3 opener still require full composition. | Atomically capture one exact dependency-v2 lease, register once for only The Virtual Realm, and leak no manager, source, secret, token, syscall, or kernel object |

B4H must use low-level trusted sources, not a fixture that supplies ready runtime
ports or a preassembled dependency closure. Its gate must parameterize failure
at every acquisition await, preserve reverse cleanup, share concurrent cleanup,
retry rejected cleanup without repeating successful phases, fence close during
every effectful operation, and invalidate every retained closure on operator
switch or device loss. A genuine M1C route must pass admission, stage,
materialize, plan, compile, present, and first submitted frame through the real
composition. Existing M2C fixtures cannot satisfy that evidence because they
already provide bake and activation ports.

The provider import proof starts from exact roots, pins the allowed RealmForge
private-bake files individually, and rejects app-to-provider, provider-to-
ambient-authority, Playground, demo, test-support, and First Shard reachability.
Unexported sentinel secrets in each low-level source must remain absent from
leases, dependencies, results, errors, and diagnostics.

#### B4H genuine-source readiness ledger

The following rows are ten flat construction pieces, not renamed B4H subgates
or nested authority families. Pieces 1 and 2 are implemented bounded sources.
They do not accept B4H or authorize a provider. Piece 3 now includes the private
read-only `RealmLocalOperatorSnapshotSource`: captured Kernel operator plus
selection S1, selected policy P1, and an exact epoch/SHA reassertion of S1.
Missing or cleared selection does no policy I/O; missing policy still reasserts
S1. The source returns point-in-time evidence only, with no lifecycle or
partition identity inferred. Live adapters/invalidation and authenticated,
backend-isolated acquisition remain the next integration boundary. The
[B4H runtime specification](m2-runtime-foundation.md#m2d-b4h-genuine-authority-provider-composition)
records its exact nine-field result and the inspected package-sandbox/GPU and
lifecycle-owner gaps. (Source:
`webgpu-os/kernel/realm/RealmLocalOperatorSnapshotSource.js`.)

Piece 9 now includes `RealmLifecycleGenerationHeadStorage`, a reserved uint64
high-water source per account and app, not a lifecycle provider. Its exact
`readCurrent`/`allocateNext` surface reuses protected-head CAS and stores a
non-deletable 4,096-byte app-hashed head. Every confirmed allocation advances;
an uncertain allocation may leave a gap. A recovery read cannot issue the
observed value, and maximum uint64 cannot wrap. The source supplies no current
or retired state, retirement handle, process-owner binding, participant, or
intent. Ordinary current-scope storage cannot perform old-operator retirement
after a switch. The [runtime specification](m2-runtime-foundation.md#m2d-b4h-genuine-authority-provider-composition)
records the exact wire, retained-storage limits, and remaining lifecycle
sequence. (Source: `webgpu-os/kernel/realm/RealmLifecycleGenerationHeadStorage.js`.)

The reserved-generation continuation verified 32/32 generation browser cases after strengthened
recovery/concurrency checks, plus shared storage24, policy24, selection32, and
snapshot24: 136/136 distinct browser cases, zero failures/skips. The new
generation Python gate passes 10/10 within the scoped 110/110 group. Its exact
closure is 45 modules; helper44, Entry106, and B3-composition48 are unchanged.
The gate tests retained OPFS reopen and fresh scopes, not forced process-crash,
eviction, profile-rollback, or complete live-lifecycle recovery. Those remain
explicit in the runtime specification. No provider, frame, or integrated M2
acceptance follows from these source receipts. (Sources:
`tests/virtual-realm/m2-lifecycle-generation-head-storage.test.js`;
`tests/virtual-realm/test_m2db4h_lifecycle_generation_head_storage.py`.)

Piece 9 now also has `RealmLifecycleSessionAuthority`: real operator capture,
fresh confirmed allocation, private per-session liveness, synchronous
operator/abort invalidation, and exact post-switch retirement without storage.
Its authentic single-method handle and separately prebound teardown root remain
usable after work invalidation or listener disposal; a newer same-account/app
reservation does not retire an older live session. A privately prepared receipt
digest becomes observable only after the terminal transition. The generation
counter is durable; session handles and terminal observations are not restored
after process loss. This does not settle durable orphan/pin recovery.

The approved versioned host-attempt binding now supplies an explicit route for
the trusted host to capture Entry's three distinct native construction, work,
and teardown roots. A v2 lease keeps `attemptBinding` outside the unchanged
sixteen-key dependency record; v1 remains exactly `{ dependencies, close }`.
Desktop forwards it through a separate factory-context key and Entry's optional
second argument. The synchronous bind occurs before inspection, without moving
allocation ahead of the existing operator snapshot. A host can capture those
roots privately only with the exact bound construction root. Restart requires
the previous teardown to have ended and three fresh roots; closing the binding
does not prove retirement or resource release. This does not yet implement the
complete lifecycle port: genuine process-owner/participant authority, queued
intents, authenticated terminal observation, and recovery remain required.
Full B4H, provider isolation, and the first frame remain unaccepted. (Sources:
`webgpu-os/kernel/realm/RealmLifecycleSessionAuthority.js`;
`webgpu-os/kernel/realm/RealmRuntimeAttemptBinding.js`;
`webgpu-os/apps/the-virtual-realm/VirtualRealmEntry.js`.)

The next piece 9 continuation implements `RealmLifecycleAllocationAuthority`,
connecting the captured roots to genuine lazy session allocation, currentness,
and synchronous retirement. Its six-field private source has no `portName` or
participant method and therefore does not claim the full lifecycle port.
Existing mutable allocation/currentness/retirement requests are snapshotted
without getters. Each attempt shares one allocation Promise; failure requires
fresh roots after teardown, and replacing an issued session also requires its
genuine retirement. Both direct issued-handle retirement and the retirement
method cache the underlying terminal observation before teardown ends. Close
refuses pending or unretired authority and never forces abort or cleanup.
Unissued reservation gaps remain distinct from issued cleanup-required sessions.
The exact factory/source shapes and failure policy are in the
[B4H runtime specification](m2-runtime-foundation.md#m2d-b4h-genuine-authority-provider-composition).
Process-owner/participant registration, queued intents, recovery, and the full
provider remain follow-on work in the same ten-piece plan. (Source:
`webgpu-os/kernel/realm/RealmLifecycleAllocationAuthority.js`.)

The next piece 9 continuation implements the genuine private
`RealmProcessOwnerIdentityAuthority`. It acquires one restart-distinct identity
from an actually issued allocation using the existing work-root owner request.
Its private lookup authenticates the current owner against real session liveness;
owner IDs and copied observations alone are not authority. A weak claim set
prevents a second owner for the same issued binding. Release requires that exact
allocation's cached genuine retirement, which remains available after switch,
teardown, or allocation close without reopening storage. Missing retirement
keeps identity ownership unresolved and blocks close.

This is an identity prerequisite, not a partial implementation of the full
six-method process-owner handle. Real activation-child authority and host
callback/participant integration remain required. Boot-only operator participant
registration and generic visibility/GPU events cannot substitute for that
integration. No port discriminator, app import, dependency key, provider,
camera, or frame changes. The plan still has exactly ten flat B4H pieces.
(Sources: `webgpu-os/kernel/realm/RealmProcessOwnerIdentityAuthority.js`;
`webgpu-os/kernel/realm/RealmLifecycleAllocationAuthority.js`.)

The session continuation verifies 32/32 new browser cases, including the final
simultaneous-factory and post-hash cancellation/scope checks, plus the freshly
rerun generation32, storage24, policy24, selection32, and snapshot24 suites:
168/168 distinct cases, no failures/skips/console errors. Its independent
Python gate passes 10/10 within the fresh 120/120 scoped regression group.
Session47, counter45, Entry106, and B3-composition48 acyclic closures are exact;
Entry/B3 cannot reach the new kernel source. These receipts prove the bounded
session authority, not provider activation, process-crash recovery, or a visible
city. The [runtime evidence](m2-runtime-foundation.md#m2d-b4h-genuine-authority-provider-composition)
records the complete scope. (Sources:
`tests/virtual-realm/m2-lifecycle-session-authority.test.js`;
`tests/virtual-realm/test_m2db4h_lifecycle_session_authority.py`.)

The approved host-attempt continuation verifies 32/32 new browser cases,
including real protected OPFS sessions allocated lazily through actual Entry,
pre-allocation cancellation, fresh restart roots, synchronous receipt rejection,
reentrant close fencing, and exact versioned lease cleanup. Desktop forwarding
is 9/9. The fresh twelve-suite group is **286/286 distinct browser cases**, with
zero failures, skips, or console errors; the independent new Python gate is
10/10 within **130/130** scoped checks. Controller2, registry2, leaf1, Entry106,
and B3-composition48 closures are exact and acyclic. Entry/B3 cannot import the
private kernel controller or lifecycle sources. Existing M0/M1C and M2 catalog
counts and the sixteen dependency keys remain frozen. These are bounded host
binding receipts, not full provider or first-frame acceptance. Full evidence
and the unchanged ten-piece ledger are in the
[B4H runtime specification](m2-runtime-foundation.md#m2d-b4h-genuine-authority-provider-composition).
(Sources: `tests/virtual-realm/m2-runtime-attempt-binding.test.js`;
`tests/virtual-realm/m2-desktop-terminal-factory.test.js`;
`tests/virtual-realm/test_m2db4h_runtime_attempt_binding.py`.)

The allocation-owner continuation adds 32/32 browser cases and an independent
10/10 Python gate. The fresh complete scoped groups pass **318/318 browser
cases** and **140/140 Python checks**, with no final browser failures, skips, or
console errors. Its final Promise-delivery cancellation test catches removal of
that fence; the source was then restored byte-for-byte and the gate rerun green.
Exact acyclic closures are allocation49, unchanged Entry106 and B3-composition48.
Actual Entry calls the new production methods directly in the bounded integration
gate, but other unfinished ports remain explicit fixtures. No full provider,
participant, process owner, or visible city is claimed. See the
[runtime evidence](m2-runtime-foundation.md#m2d-b4h-genuine-authority-provider-composition).
(Sources: `tests/virtual-realm/m2-lifecycle-allocation-authority.test.js`;
`tests/virtual-realm/test_m2db4h_lifecycle_allocation_authority.py`.)

The private identity continuation adds **34/34 browser cases** and **12/12
independent Python checks**. The freshly rerun scoped matrices pass **352/352
browser cases** and **152/152 Python checks**, with no final browser failures,
skips, or console errors. New cases reproduce competing-claim and
close-during-currentness failures before the fix, then pass after acquisition's
final no-callback publication guard. Exact trusted closure50 is isolated from
unchanged Entry106 and B3-composition48; the allocation closure remains49.
These checks accept the identity prerequisite only, not the full owner port,
participant bridge, or visible city. See the
[runtime evidence](m2-runtime-foundation.md#m2d-b4h-genuine-authority-provider-composition).
(Sources: `tests/virtual-realm/m2-process-owner-identity-authority.test.js`;
`tests/virtual-realm/test_m2db4h_process_owner_identity_authority.py`.)

The approved v3 continuation supplies the separate host-only lifecycle channel
without changing v1/v2 leases, `realmRuntimeAttemptBinding@1`, or dependency16.
Desktop privately routes/coalesces suspension, ordinary and forced close, and
matching logical coordinator loss to the captured mount. Source callbacks
synchronously acknowledge enqueueing; wrapped host calls are deferred and
bounded to 64 pending notifications. Lease close/destruction fences callbacks
immediately, settles transport work, then preserves retryable raw cleanup.
Nothing is exposed as an app hook, and acknowledgement never substitutes for
Entry teardown completion. The following piece-9 continuation supplies the genuine authenticated
participant source and its retained terminal identity; operator-switch drain
and activation-authorized child ownership remain separate unfinished work.

Verification adds host-channel36 and extends Desktop9 to Desktop17. The fresh
fifteen-suite matrix passes **396/396 browser cases**, with zero final failures,
skips, or console errors; scoped Python passes **164/164**, including the new
12-case confinement gate. Exact closures are host-channel2 and registry3,
with Entry106 and B3-composition48 unchanged. These are transport receipts,
not full-provider, physical-GPU-loss, renderer-pause, or visible-city acceptance.
The plan still has exactly ten flat B4H pieces. See the
[protocol and evidence](m2-runtime-foundation.md#m2d-b4h-genuine-authority-provider-composition).
(Sources: `webgpu-os/kernel/realm/RealmRuntimeHostLifecycleChannel.js`;
`webgpu-os/kernel/AppRuntimeCompositionRegistry.js`; `webgpu-os/shell/Desktop.js`;
`tests/virtual-realm/m2-runtime-host-lifecycle.test.js`;
`tests/virtual-realm/m2-desktop-terminal-factory.test.js`;
`tests/virtual-realm/test_m2db4h_runtime_host_lifecycle.py`.)

The genuine participant continuation privately binds the original owner/work
identity and the original coordinator's invalidation stream. Its exact source3
is `{ registerParticipant, hostLifecycle, close }`; the existing mutable
registration8 and frozen participant2 remain unchanged. Ordinary callbacks need
current authority. First-terminal callbacks retain the original unreleased
identity after work/operator invalidation, without reopening old storage.
Disposal fences immediately and settles only owned invocations. Source close
cannot manufacture participant, owner, or resource cleanup.

This continuation adds **40/40 browser cases** and **16/16 independent Python
checks**. The fresh complete scoped matrices pass **436/436 browser cases** and
**180/180 Python checks**, with no final browser errors, failures, or skips.
The close-before-unsubscribe regression fails when that fence is deliberately
moved, then passes after byte-identical restoration. Exact trusted closures
are participant51, identity50 and allocation49; Entry106/B3-composition48 and
dependency16 are unchanged. The following piece-9 continuation composes the
genuine lifecycle methods with explicit source cleanup ownership. Boot-owned
operator-switch drain, full activation-child process ownership, other support
ports, provider isolation and a visible city remain unfinished. See the
[participant protocol and acceptance evidence](m2-runtime-foundation.md#m2d-b4h-genuine-authority-provider-composition).
(Sources: `webgpu-os/kernel/realm/RealmLifecycleParticipantAuthority.js`;
`tests/virtual-realm/m2-lifecycle-participant-authority.test.js`;
`tests/virtual-realm/test_m2db4h_lifecycle_participant_authority.py`.)

`RealmLifecyclePortComposition` now owns genuine allocation, identity and
participant sources behind the unchanged four-method `realmLifecycle@1` port.
Its separate host helpers retain the existing attempt/v3 wires and expose only
guarded owner identity acquisition/authentication and retirement observation.
No new app dependency or full process-owner handle is introduced.

Close fences new app/owner/attempt work, closes the three sources in reverse
creation order, and retains each successfully completed phase for retry.
Outstanding retirement, observation and authentic disposal/release handles
remain usable. Reentrant close cannot hide a newly issued handle, and pending
allocation promises keep their original cleanup result. Successful source close
does not perform or certify Entry teardown, boot-owned operator-switch drain,
resource cleanup, or rendering. The ten-piece ledger remains flat. The following
host cleanup continuation establishes ownership at the real operator
transition boundary; process-child authority still depends on the unfinished
activation owner. Full-provider and visible-city acceptance remain ahead.
(Source: `webgpu-os/kernel/realm/RealmLifecyclePortComposition.js`.)

The composition continuation passes **37/37 new browser cases**, with
**305/305** distinct cases across its freshly rerun eleven-suite browser group
and **196/196** scoped Python checks, including the new16-case gate. All final
browser runs have zero failures, skips and console errors. The previous wider
436-case browser matrix is historical, not included in this subtotal.
Removing the synchronous close guard makes seven targeted cases fail; restoring
the byte-identical source returns37/37. The trusted closure is exactly52 modules,
with existing authority, Entry, B3, dependency16 and catalog boundaries preserved.
See the [composition protocol and measured evidence](m2-runtime-foundation.md#m2d-b4h-genuine-authority-provider-composition).
(Sources: `tests/virtual-realm/m2-lifecycle-port-composition.test.js`;
`tests/virtual-realm/test_m2db4h_lifecycle_port_composition.py`.)

The operator-transition continuation adds `RealmOperatorMountDrain`, a private
Desktop ledger keyed by exact mount entries. It retains pending factory mounts
and original cleanup after provisional, ordinary, or forced window removal.
The existing boot-owned `desktop-shell` drain now waits this ledger before
OperatorContext can activate, bind, or resume a replacement operator. Actual
factory cleanup precedes original-request registry retirement. Neither a
notification acknowledgement nor a force-close timeout clears that obligation.

The registry's new host-only `retireOpen(originalRequest)` uses private exact
object identity. It fences further opens for that request and waits its pending
opens, active leases, and quarantined cleanup. Pre-admission failures add no
authority. A fresh rejected attempt has empty cleanup; a reused request still
owns any earlier handles. Failed cleanup rejects
the transition and remains retryable; completed work is not replayed. Other
apps keep their existing bounded force-close behavior. This does not install a
runtime provider or modify the sixteen dependencies or v1/v2/v3 lease wires.

The diagnostics continuation supplies piece 9's bounded clock/logger
sources; genuine resource telemetry and recovery ownership remain unfinished.
Activation-authorized child ownership still requires piece 4's genuine
activation owner. The full-provider gate must combine these sources and prove
actual Entry teardown and the M1C-to-first-submitted-frame route; the transport
fixtures used for this host barrier do not establish that route or a visible
city. See the [protocol and measured evidence](m2-runtime-foundation.md#m2d-b4h-genuine-authority-provider-composition).
(Sources: `webgpu-os/shell/desktop/RealmOperatorMountDrain.js`;
`webgpu-os/shell/Desktop.js`; `webgpu-os/kernel/AppRuntimeCompositionRegistry.js`;
`webgpu-os/kernel/KernelBootstrap.js`; `webgpu-os/kernel/OperatorContext.js`.)

The operator-transition continuation passes **18/18 operator-transition browser cases** and
**14/14 original-open retirement cases**. Together with eleven freshly rerun
adjacent suites, the distinct browser subtotal is **337/337**, with zero final
failures, skips, or console errors. The scoped Python group passes **212/212**,
including the new16-check gate. A separate read-only HTTP mutation bypasses
the barrier and causes14 targeted failures; production source bytes remain
unchanged. An independent audit identified and verified the correction for
destroyed-registry pre-admission cleanup ownership. Source/helper closures are
registry3 and drain2; Entry106, B3-composition48, dependency16, and the frozen
M0-M1C catalog remain unchanged. No full OS bundle or broad documentation
generator was run for this scoped continuation.
(Sources: `tests/virtual-realm/m2-operator-transition-drain.test.js`;
`tests/virtual-realm/m2-runtime-open-retirement.test.js`;
`tests/virtual-realm/test_m2db4h_operator_transition_drain.py`.)

The diagnostics continuation supplies genuine native monotonic measurements,
source-instance-local uint64 decimal sequencing, and a closed-schema logger over the
existing OS sink. It retains the exact v1 clock/logger wires and adds only a
host-owned close operation outside the sixteen app dependencies. Diagnostic
time cannot substitute for activation time, lineage, or resource telemetry.
The fixed 21-event, thirteen-field projection omits identities and arbitrary
text; failures and reentry cannot escape through logging. Future cleanup must
keep these sources open through Entry and reverse-source teardown, and must not
close the shared OS logger. Mount ownership is a future provider obligation,
not something these source factories authenticate. See the [diagnostic protocol](m2-runtime-foundation.md#m2d-b4h-genuine-authority-provider-composition).
(Sources: `webgpu-os/kernel/realm/RealmRuntimeDiagnosticsSource.js`;
`webgpu-os/kernel/realm/RealmBrowserRuntimeDiagnosticsSource.js`.)

Diagnostics acceptance is **32/32 browser cases**, or **210/210** distinct cases
including eight freshly rerun adjacent suites, with zero final failures, skips,
or console errors. The scoped Python group passes **229/229**, including 17 new
checks. A separate counter-boundary probe passes six assertions; a served-copy
rollback mutation triggers exactly the expected failing case. Neither probe
changes repository source or adds a production test hook. Exact source closures
are 29/30; Entry 106, B3-composition 48, dependency 16 and both ten-piece ledgers
remain unchanged. This accepts the bounded diagnostic sources, not all piece 9
or B4H. Next, establish genuine owner-attributed telemetry and remaining
reconciliation, retaining piece 4's activation prerequisite for process children.
See the [measured evidence and remaining boundaries](m2-runtime-foundation.md#m2d-b4h-genuine-authority-provider-composition).
(Sources: `tests/virtual-realm/m2-runtime-diagnostics-source.test.js`;
`tests/virtual-realm/test_m2db4h_runtime_diagnostics_source.py`.)

The frame-accounting continuation implements an observation-only source over
one authentic `GpuFrameCoordinator` producer handle. Capture uses private
object identity, not owner/surface strings. The legacy handle's `telemetry()`
now also reads its original record, preventing a retired handle from reading a
replacement producer. Each capture exposes only frozen `snapshot()` and
idempotent `close()` functions; closing one observer never unregisters work or
closes other observers. The source remains readable after producer retirement,
cache eviction, and coordinator destruction, including accounting finalized by
an already-running callback. Retirement alone is not callback quiescence.

The exact eleven-field snapshot contains registration state, GPU generation,
bounded counters, and two four-field timing projections over the latest sixty
samples. Missing timing is `null`, not measured zero. CPU timing is the
coordinator's callback interval; GPU timing and submissions are explicitly
reported accounting, not physical GPU duration or counted queue submissions.
No owner/surface identifiers, callbacks, raw errors, or authority handles escape.
This does not implement `resourceTelemetryPort` or alter its frozen wire.
See the [source map and exact projection](m2-runtime-foundation.md#m2d-b4h-genuine-authority-provider-composition).
(Sources: `webgpu-os/kernel/GpuFrameCoordinator.js`;
`tests/virtual-realm/m2-frame-producer-telemetry-source.test.js`.)

The mount-allocation continuation now preserves exact mount identity across the
GPU broker/allocation tracker boundary for buffers, textures and creation
counters while retaining app quotas and resource-family semantics. App-wide
requested-byte totals cannot distinguish replacement mounts, and requested
bytes are not physical VRAM. Navi's
task/branch reservation and settlement accounting cannot supply this Realm
measurement. The full telemetry adapter also needs authenticated begin-time
binding and original teardown ownership that survives process-owner release:
Entry can retry failed telemetry close after releasing that owner. Final
snapshots, zero tracker counts, and released owners are not GPU disposal proof.
Activation-authorized children, recovery, and full-provider integration remain
separate work in the existing flat ledger; no eleventh piece is introduced.

Frame-source acceptance is **28/28 browser cases**, or **255/255 distinct cases**
including ten freshly rerun adjacent suites; zero final failures or skips.
The scoped Python group passes **244/244**, including fifteen new checks.
The sweep corrected only a shared Desktop fixture's missing inert Navi
constructor defaults; production Desktop/Navi remain unchanged. A served-only
rollback to the old keyed lookup triggers exactly three targeted failures,
without changing repository source. No physical GPU, full-provider, or visible
city acceptance is implied. Entry106, B3-composition48, dependency16, and both
ten-piece ledgers remain unchanged. See the [full evidence and source limits](m2-runtime-foundation.md#m2d-b4h-genuine-authority-provider-composition).
(Sources: `tests/virtual-realm/m2-frame-producer-telemetry-source.test.js`;
`tests/virtual-realm/test_m2db4h_frame_producer_telemetry_source.py`;
`tests/virtual-realm/m2-desktop-terminal-factory.test.js`.)

The mount-allocation source exposes an eleven-field frozen projection through
an exact original GPU lease, not app-name lookup. A powerless scope token stays
in private tracker indexes; public allocation records and app/global quotas do
not change. Accepted buffer/texture charges survive owner release and remain
separate from replacements. Pipeline/shader numbers are creation accounting.
Forgetting tracking produces unavailable numeric fields, never measured zero
or cleanup success. Surface and other untracked bytes are always null.

Capture and snapshot reject observed tracker/writer replacement permanently.
Writer descriptor checks do not invoke accessors, and optional telemetry setup
failure does not prevent ordinary mounting. Reentrant host getters cannot
replace mount identity or return an observation after its close. This is a
standard unmodified-tracker seam, not an arbitrary host-instrumentation or
same-origin isolation guarantee. A separate original-manager-surface source now
covers acquisition, resize, recovery and release. The next piece-9 work is genuine
Realm-source joining using the retained cleanup binding. Full telemetry, remaining
authority owners, provider registration and the first real city frame remain
open. See the [exact source protocol and remaining work](m2-runtime-foundation.md#m2d-b4h-genuine-authority-provider-composition).
(Sources: `webgpu-os/kernel/GpuDeviceBroker.js`;
`webgpu-os/kernel/VRAMTracker.js`; `webgpu-os/kernel/SurfaceManager.js`.)

The mount source passes **36/36 browser cases**, with **291/291 distinct browser
cases** across the adjacent regression sweep, and **263/263 scoped Python
checks**, including nineteen new checks. The mount and Desktop gates and exact
Python group were rerun after the final legacy texture-dispatch correction.
Removing attribution only from a served copy produces 21 expected failures;
production bytes are unchanged.
Broker9/tracker7 math-only closures preserve Entry106, B3-composition48 and
dependency16. These are instrumented transport and accounting results, not
physical WebGPU or full-provider acceptance. See the [source evidence](m2-runtime-foundation.md#m2d-b4h-genuine-authority-provider-composition).
(Sources: `tests/virtual-realm/m2-gpu-mount-allocation-source.test.js`;
`tests/virtual-realm/test_m2db4h_gpu_mount_allocation_source.py`.)

The surface continuation provides an independent five-field reservation source
selected only by the original six-field kernel surface view. Private scopes
preserve original ownership through resize, device recovery, rollback and
release. Stale cleanup cannot erase a replacement reservation or unconfigure
its reused injected canvas. Unscoped displacement and host forget produce
unavailable values rather than inferred cleanup. Quota totals remain app-wide;
device loss retains reservations. This is not physical VRAM or native disposal.

Surface writer validation stays separate from the frozen mount writer set.
No app dependency or runtime lease is widened. The mount projection still
leaves surface bytes null: genuine Realm/mount/source joining has not happened.
Compat surfaces, missing resource families and the full provider remain open.
See the [source contract and ownership boundaries](m2-runtime-foundation.md#m2d-b4h-genuine-authority-provider-composition).
(Sources: `webgpu-os/kernel/SurfaceManager.js`;
`webgpu-os/kernel/VRAMTracker.js`;
`tests/virtual-realm/m2-gpu-surface-allocation-source.test.js`.)

The surface gate passes **42/42**, with **290/290 distinct browser cases** across
the fresh adjacent accounting, presentation, composition, Desktop and isolated
kernel-recovery sweep. The final exact 26-file Python group passes **283/283**,
including twenty new checks; manager/tracker closures remain eight/seven modules.
Removing attribution only from a served copy causes
**31 expected failures and 11 passes**; production bytes are unchanged. These
results accept the original-manager-surface reservation source, not full Realm
telemetry or a physical-GPU city frame.
(Sources: `tests/virtual-realm/m2-gpu-surface-allocation-source.test.js`;
`tests/kernel/gpu-runtime-recovery.test.js`;
`tests/virtual-realm/test_m2db4h_gpu_surface_allocation_source.py`.)

The retained cleanup continuation adds a private source over a genuine
process-owner identity, not the full telemetry port. It authenticates Entry's
existing begin request once and caches exactly
`{ identity, assertCurrent, assertTeardown }`. Work validation remains revocable;
cleanup validation retains only the original native live teardown authority
through owner release and identity-source close. It neither accesses storage nor
requires successful retirement, and fails after native teardown abort. This
supports Entry's existing retry order without exposing roots or widening wires.

The private guarded-frame bridge now preserves the original coordinator producer
behind its syscall wrapper. The next joining step must distinguish Realm owner epochs within one
Desktop GPU mount. Entry begins telemetry before surface/producer acquisition,
so their later attachment needs trusted original-source provenance. Mount-wide
totals cannot be labeled as one owner, even with
baseline subtraction. Selected-Realm/activation provenance and missing resource
coverage also remain unresolved. Keep these requirements inside flat piece 9;
no new nested milestones or aggregate telemetry contracts are introduced.
See the [retained cleanup protocol and next-work boundaries](m2-runtime-foundation.md#m2d-b4h-genuine-authority-provider-composition).
(Sources: `webgpu-os/kernel/realm/RealmProcessOwnerIdentityAuthority.js`;
`webgpu-os/kernel/realm/RealmLifecycleAllocationAuthority.js`;
`webgpu-os/kernel/Syscalls.js`; `webgpu-os/shell/Desktop.js`.)

Retained-binding acceptance passes **32/32** new browser cases and
**230/230 distinct cases** across the fresh identity, allocation, participant,
lifecycle/runtime composition and Entry regression sweep. There are zero final
browser failures, skips or console errors. The exact nine-file Python group
passes **121/121**, including nineteen new checks. Existing source/public wires
and allocation49/identity50/participant51/Entry106/B3-48 module closures remain
unchanged. These results accept only the cleanup prerequisite, not joined
measurements, the complete provider or the visible city.
(Sources: `tests/virtual-realm/m2-process-owner-telemetry-binding.test.js`;
`tests/virtual-realm/test_m2db4h_process_owner_telemetry_binding.py`.)

Restoring the old live-owner restriction only in a served copy causes
**10 expected failures and 22 passes** in the same gate; the unmodified source
then passes 32/32 again. The pinned localhost helper exits successfully with
both production hashes unchanged. This negative control proves the gate rejects
the broken retained-cleanup behavior, not complete resource cleanup.

The guarded-frame continuation implements a private original-wrapper lookup in
`Syscalls.js`, delegating to the existing coordinator observer. The app-facing
wrapper stays exactly five methods; each capture has its own frozen two-method
observer and unchanged eleven-field accounting projection. Copies, proxies and
matching labels reject without caller-property reads. Historical original-record
observation survives unregister, mount revocation and same-label replacement.
Custom non-genuine handles retain legacy registration behavior but cannot supply
the source. Final lifecycle fencing prevents stale wrapper publication after
reentrant GPU-consumer marking and attempts original-handle rollback.

This is observation provenance, not Realm/process-epoch ownership, fresh
registration proof, execution authority or disposal evidence. No app dependency,
lease, aggregate telemetry contract or full-provider registration changes.
Trusted late attachment, per-owner attribution across shared-mount epochs,
selected-Realm/activation provenance and missing-family coverage remain open.
See the [guarded-frame source protocol](m2-runtime-foundation.md#m2d-b4h-genuine-authority-provider-composition).
(Sources: `webgpu-os/kernel/Syscalls.js`;
`webgpu-os/kernel/GpuFrameCoordinator.js`;
`tests/virtual-realm/m2-guarded-frame-telemetry-source.test.js`.)

Guarded-frame acceptance passes **32/32 new browser cases** and **125/125
distinct fresh browser cases** including original frame, syscall-adapter,
owner-coupled presentation, production-composition and existing kernel
device-authority regressions. The exact seven-file Python group passes
**99/99**, including seventeen new checks. Positive runs have zero failures,
skips or console errors. Source-gated closures remain exact at 39 Syscalls,
42 new-browser and 41 device-authority modules, with zero skipped dependencies.

A served-only missing-association mutation produces **22 expected failures and
10 passes**; unmodified production passes 32/32 again. Helpers exit normally,
production hashes remain unchanged by that experiment and First Shard is not
scanned. No broad OS bundle or global discovery regeneration was run. These
results accept only original-producer observation and stale-publication fencing,
not the complete telemetry/provider join or physical visible-city presentation.
(Sources: `tests/virtual-realm/test_m2db4h_guarded_frame_telemetry_source.py`;
`tests/kernel/gpu-device-authority.test.js`.)

The surface-receipt continuation privately verifies an original adapter receipt
against its actual returned kernel view. The exact two-argument check returns
`undefined`; it exposes no raw resource, callback or observer. Weak pair
membership prevents a retained scalar receipt from newly retaining its former
canvas/context. Existing app port shapes, module imports and rollback remain
unchanged. No nested milestone is added.

Success proves historical issuance only. Genuine manager accounting, outer
broker acceptance, currentness, exclusive ownership, selected-Realm/activation
and exact owner/epoch attachment remain independent. Retired or rejected original
pairs may still match; copied or substituted objects do not. The next private
join must prove original dispatch membership and late-attachment currentness
against the genuine retained owner binding, without whole-mount inference or
repurposing the approved attempt/v3 channels. See the
[surface provenance protocol](m2-runtime-foundation.md#m2d-b4h-genuine-authority-provider-composition).
(Sources: `webgpu-os/apps/the-virtual-realm/runtime/RealmGpuPresentationSyscallAdapter.js`;
`webgpu-os/kernel/realm/RealmM2RuntimeComposition.js`;
`webgpu-os/kernel/realm/RealmProcessOwnerIdentityAuthority.js`.)

Surface-pair acceptance passes **28/28 new browser cases** and **206/206 distinct
final browser cases**, with zero final failures, skips or console errors. The
exact seven-file Python group passes **86/86**, including sixteen new checks.
Adapter14/broker13, Entry106/B3-48 and dependency16 remain unchanged; the new
browser closure is exact25, with no skipped or unreviewed dependency. A resize
test was corrected to respect the existing pixel cap; no production quota was
relaxed. No full OS bundle/global discovery regeneration or First Shard scan
was run. These results accept historical pairing only, not joined owner
measurements or visible-city presentation.
(Sources: `tests/virtual-realm/m2-surface-receipt-provenance.test.js`;
`tests/virtual-realm/test_m2db4h_surface_receipt_provenance.py`.)

The served-only missing-publication negative control produces **22 expected
failures and 6 passes**; unchanged production then passes 28/28 again. The
bounded helper exits successfully with all26 served file hashes unchanged on
disk. Historical pairing remains the only newly accepted prerequisite.

The lifecycle-composition companion continuation exposes no new public field.
`captureRealmLifecycleCompositionTelemetrySource()` accepts the original
six-field composition through a private native-pinned lookup and derives the
genuine retained identity binding behind its forwarding facade. Capture,
publication and currentness share the existing operation-depth fence; teardown
retains the original validator independently of the parent work fence. Partial
close can leave valid teardown authority, while successful full close requires
that root aborted and therefore rejects later teardown checks. No extra source
lease, storage access, subscription, dependency or lifecycle channel is added.

Companion acceptance passes **32/32 new browser cases**, including protected
OPFS, and **201/201 distinct final browser cases** across seven suites, with
zero final failures, skips or console errors. The exact eight-file Python group
passes **104/104**, including sixteen new and all sixteen prior composition
checks. Production52, Entry106, B3-48 and browser74 import boundaries remain
unchanged. A served-only missing-currentness-fence mutation produces four
expected failures and 28 passes; unmodified production then passes 32/32 again.
Two initial expectations were corrected for actual listener retirement and
genuine error precedence, without changing production behavior. Broad runners
and discovery regeneration remain deferred; First Shard was not scanned.
(Sources: `tests/virtual-realm/m2-lifecycle-composition-telemetry-source.test.js`;
`tests/virtual-realm/test_m2db4h_lifecycle_composition_telemetry_source.py`.)

The GPU-epoch continuation adds private original-port/original-epoch observation
and weak method-specific membership for successful presentation results. It also
closes reentrant bind/release/dispose and admission-reflection gaps in the
existing controller. An old release cannot clear a replacement; nested bind
cannot overwrite a newer epoch or publish after disposal. Pending dispatch is
reserved before request reflection, and retirement snapshots its data descriptor
before effects without invoking malformed accessors. All legacy public shapes
and the flat ledger remain unchanged.

The new `captureRealmOwnerCoupledGpuEpochSource()` companion proves historical
successful forwarding only, not genuine owner authorization at dispatch, native
GPU allocation or callback execution. History can precede source capture and
survive epoch release. A retrospective owner join was rejected by audit: genuine
identity must be installed before first dispatch and checked within ordinary
routes and retained callbacks. No look-alike joined-owner provider was added.
See the [epoch history and temporal authorization boundary](m2-runtime-foundation.md#m2d-b4h-genuine-authority-provider-composition).
(Sources: `webgpu-os/kernel/realm/RealmOwnerCoupledGpuPresentationPort.js`;
`webgpu-os/kernel/realm/RealmM2RuntimeComposition.js`;
`webgpu-os/apps/the-virtual-realm/runtime/RealmGpuPresentationSyscallAdapter.js`.)

This GPU-epoch slice passes **200/200 distinct final browser cases** across the
new 36-case source gate and the existing controller, production composition,
adapter, broker, surface provenance and lifecycle-companion gates, with zero
failures, skips or console errors. The exact six-file Python group passes
**64/64**, including eighteen new checks. Separate in-memory membership and
control-guard removals produce fourteen and five expected failures, respectively;
both helpers exit 0 and confirm all twenty approved disk files unchanged. The
controller, B3 and Entry closures remain 15/48/106 modules. This acceptance is
limited to historical provenance and control hardening, not physical GPU
measurement or genuine owner authorization. No broad runner, full bundle or
shared discovery regeneration was run; First Shard was not scanned.
(Sources: `tests/virtual-realm/m2-gpu-presentation-epoch-source.test.js`;
`tests/virtual-realm/test_m2db4h_gpu_presentation_epoch_source.py`.)

Actual GPU dispatch joining remains next within piece 9. The recorded protocol
requires immutable original owner epochs for reused syscall routes and delayed
callbacks, currentness checks around reentrant/asynchronous dispatch, retained
cleanup-bearing results after late invalidation, and independent terminal
resource authority that preserves Entry's presentation-before-telemetry cleanup
order. B2's memoized cleanup failure is not retried destruction. Per-resource
ownership, selected-Realm/activation provenance and missing-family coverage are
still open; no complete telemetry or visible-city claim follows from this
companion. See the [companion and dispatch-join protocol](m2-runtime-foundation.md#m2d-b4h-genuine-authority-provider-composition).
(Sources: `webgpu-os/kernel/realm/RealmLifecyclePortComposition.js`;
`webgpu-os/kernel/realm/RealmM2RuntimeComposition.js`;
`webgpu-os/apps/the-virtual-realm/VirtualRealmEntry.js`;
`webgpu-os/apps/the-virtual-realm/runtime/RealmGpuPresentationPortContract.js`.)

The piece-9 terminal GPU contract decision is approved. Current
presentation cleanup calls ordinary `scheduleJob` with a fresh local signal
after Entry has aborted work. Enforcing genuine work currentness first would
block destruction; a caller's `:teardown` label must not bypass the check.
The approved separate versioned destruction-only channel must authenticate
the original owner, resource/generation and live teardown root, without granting
arbitrary callbacks, allocation, writes, rendering or submission. Its separate
inert v1 validators now freeze Port3, Identity4, Delivery5, Request5 and Receipt11.
Counts conserve exactly with BigInt and distinguish destruction, abandonment and
unresolved cleanup. No live channel, issuer binding or dispatch enforcement is
enabled by this contract-only build. See the [v1 wire and authority boundary](m2-runtime-foundation.md#terminal-cleanup-v1-inert-contract).

The subsequent [original-resource issuer registry](m2-runtime-foundation.md#original-resource-issuer-registry)
is implemented for buffers and textures in the real GPU broker. It reserves
exact object identity before destructor inspection, prevents duplicate rollback
from destroying an earlier issuance, and retains unresolved private candidates.
The exact mount/facade source is read-only. Observed original-call return is not
physical reclamation or Realm teardown. Genuine pre-allocation Realm ownership
and the authenticated terminal destruction channel still need integration.
The registry slice passed 140/140 browser cases across four focused gates and
74/74 scoped Python checks. Those counts cover the issuer prerequisite and
regressions, not the unfinished Realm binding or terminal channel.
(Source: `webgpu-os/kernel/GpuDeviceBroker.js`.)

The [B3 pre-epoch lifecycle installer](m2-runtime-foundation.md#b3-pre-epoch-lifecycle-installation)
now authenticates the original lifecycle composition before B3 acquisition and
requires its exact lifecycle-port reference. It snapshots original acquire4 after
reserving acquisition, matches the genuine owner/operator/generation/work root,
and fences reentrant closure before publishing the GPU epoch. Rejected ownership
retains its original cleanup-bearing handle. This host-private opt-in does not
enroll resources or manufacture the missing full process-owner service. At that
lifecycle-installer gate, B3 imported the genuine source and grew from48 to88;
Entry106 and the frozen wire shapes were unchanged. Those historical receipts
were183/183 across the new32-case gate and five preserved browser gates,
and305/305 in the exact22-file Python group. They accept the pre-epoch
installation prerequisite, not dispatch denial or resource ownership.
The following [prospective allocation-cohort slice](m2-runtime-foundation.md#prospective-original-gpu-allocation-cohorts)
adds explicit buffer/texture routes with genuine owner checks and original
per-allocation membership. It never adopts old resources or labels an entire
shared mount. Its original-only source preserves historical membership and
original-root teardown validation after creation closes. These routes remain
unwired into the standard adapter; pre-publication integration and full-provider
mount association still require proof. Neither creation closure nor observed
destructor return is terminal cleanup completion.
The cohort slice passes259/259 browser cases across eight gates and325/325
Python checks across23 exact files. It preserves the existing ten-piece plan;
production M1C admission and the first submitted city frame remain unaccepted.
The [authenticated cohort terminal endpoint](m2-runtime-foundation.md#authenticated-cohort-terminal-destruction)
now implements original-root-authorized destruction through the existing
Delivery5/Port3 wire. Each explicit call visits at most 256 retained candidates,
reports exact cumulative counts and retains unresolved failures for authorized
retry. In-flight allocation seals and rejects without a misleading receipt;
abandonment remains 0 without authentic loss evidence. At that endpoint's
acceptance, standard renderer delivery, cycle-free pre-bind ownership and the
full-provider mount association remained open.
The terminal slice passes **299/299** browser cases across nine gates and
**349/349** Python checks across 24 exact files, including its new40 browser and24
Python cases. Final browser runs have no failures, skips, blocked cases or console
errors. These are bounded endpoint receipts, not physical GPU reclamation,
renderer integration, full-provider or production M1C acceptance.

The next [cycle-free pre-bind association](m2-runtime-foundation.md#cycle-free-pre-bind-gpu-allocation-association)
is now implemented within piece 9. The original-companion core prepares a genuine
primary cohort before GPU epoch binding. An opt-in pre-acquisition B3 installation
authenticates the original mount/facade pair and compares actual configured
`getDevice()` returns by reference, with reentry and currentness checks. Primary
capture waits for completed acquisition; legacy factories remain compatible.
Private controls pause on release, resume only recoverable pre-epoch failures,
and retire irreversibly with epoch ownership while preserving original terminal
cleanup. Retired owner records drop their cohort references.

That pre-bind slice passed **339/339** browser cases across ten gates and **373/373**
Python checks across 25 exact files, including40 and24 new cases respectively.
Source closures are broker9/core60/B396/wrapper97/Entry106; all browser closures
were allowlisted before traversal. Earlier B388/cohort96 receipts are historical.
The association is momentary, not an atomic final-publication or dispatch check.
At that acceptance, standard buffer/texture routing, private terminal presenter
delivery and retry-safe cleanup remained open. Final adapter reflection must not bypass the original work
root through a distinct request signal. Neither a first submitted city frame nor
the full provider, M1C production opener or native reclamation is accepted.

The [standard adapter cohort allocation routing](m2-runtime-foundation.md#standard-adapter-cohort-allocation-routing)
continuation now implements the first of those remaining items. The exact
original WorkSource6 and factory-issued syscall namespace bind standard
buffer/texture creation to the selected cohort before B3 epoch publication.
Genuine terminal authorization seals this work proof without discarding its
historical observation or original terminal endpoint. Malformed requests and
roots denied before any successful authorization do not newly seal work;
later authorization failure never reopens an established seal. The raw adapter checks the
exact original facade after metadata validation; outer broker cached and
post-await publication boundaries remain deferred.

Ordinary jobs, transfers, other methods and destruction are preserved. The
original-adapter source lookup itself does not recognize the stable owner-controller
port or bind a presenter. Next: connect that exact selected source to the exact
presenter generation, deliver the original teardown root privately, and retain
failed and late handles for retry-safe cleanup. This must prevent same-identity
empty-sibling substitution and competing presenter claims. Device recovery may
not silently replace the frozen original mount/facade pair. The same ten-piece
plan and full-provider/physical-frame exclusions remain in force.
Final browser verification is **431/431** across fourteen gates with no failures,
skips, blocked cases or final-run console errors. New32, prior339 and legacy
adapter18/owner-controller15/presenter27 are included in that total.
The final exact28-file Python group passes **406/406** in146.72 seconds,
including prior373, legacy adapter/port9 and new24. Scoped source/documentation
hygiene is clean; shared discovery regeneration remains deferred.

The next implemented prerequisite is the
[stable presentation-port allocation association](m2-runtime-foundation.md#stable-presentation-port-allocation-association).
An exact original stable-port/epoch-token pair now resolves the actual selected
WorkSource6 (or authentic legacy `null`) before capability admission and after
retirement. It never replaces an old selection with a newer current epoch.
The controller matches the owned source's immutable identity before publication;
existing receipt-forwarding evidence is reused, not globally re-registered.
The returned source carries allocation/terminal handles, not sandbox isolation
or exclusive presenter ownership. Presenter generation/cleanup claims, private
teardown-root delivery and retry-safe cleanup remain next within piece9.

The same slice fixes B3's private publication fence: the primary cohort remains
paused through `owner.bound` and resumes only in the callback-free acquisition
completion tail. Early historical source discovery is possible, but early work
checks and allocation stay denied; a terminal seal cannot be reopened. The new
regression first reproduced two premature allocations (23/24), then passes24/24
with the fix. Only the controller and B3 change in production; public wires and
presenter behavior remain unchanged. Final verification passes **455/455**
browser cases across fifteen gates and **426/426** Python checks across29 exact
files in143.87 seconds, with no failures or skips. Browser blocked/error counts
are zero. The new guarded browser closure is195 modules. First Shard was not
scanned; no broad bundle or shared discovery generation ran.

The next implemented prerequisite is
[original presenter-generation provenance](m2-runtime-foundation.md#original-presenter-generation-provenance):
original-only Source1, current Token4 and local Identity2 prove the actual
presenter generation, exact constructor port and historically adopted receipt.
Native/private currentness fences stale evidence without changing legacy cleanup.
The source returns no port, receipt, allocation route or terminal authority.
Only the presenter module changes, with no new import edge or public wire.

At that provenance-only gate, exclusive ownership was not yet enforced. Its next
requirement was an issuer-authenticated pre-start host binding that reserved the
actual cohort before admission and combined these presenter proofs with the exact
stable-port/epoch/source/receipt association. Post-start claims can be too late.
Failed cleanup must not release a claim merely because legacy stop reports
disposal. The startup and terminal continuations implement those later piece9
requirements; no full-provider/M1C or visible-city acceptance follows.

The new provenance gate passes32/32; final browser regression passes **487/487**
across sixteen gates with no failures, skips, blocked cases or console errors.
Three stale-evidence witnesses now reject correctly without changing legacy
startup/cleanup flow. The new browser closure197 is pre-read allowlisted;
presenter31, old presenter-browser37 and Entry106 remain unchanged. Both plans
retain ten flat pieces and identical piece9 rows. First Shard was not scanned.
Final Python regression passes **446/446** across exactly30 files in157.75 seconds,
with zero failures or skips. The new20 adds to prior426 without modifying existing
test gates or fixtures. No broad bundle or shared discovery generator ran.

The next [strict startup and fresh-cohort exclusivity proposal](m2-runtime-foundation.md#strict-presenter-startup-and-fresh-cohort-exclusivity-proposal)
is implemented and verified within the same eight bounded steps of existing
piece9. The issuer-dependency amendment is approved.
This is not a new milestone. The implementation pairs an issuer-authenticated startup binding with fresh-only
source-wide protected allocation. At most one original presenter generation can
reach capability dispatch for a protected cohort; unused pre-dispatch reservations
may be released. A claim map without actual allocator enforcement is insufficient.

The exact-six-field v4 lease carries a separately versioned original binding through
registry, Desktop, factory and Entry, preserving the frozen dependency16 and all
v1/v2/v3 behavior. Both Desktop version predicates preserve attempt and lifecycle
forwarding. The binding is an opaque issuer member, not a supplied validator.
Reservation runs inside presenter startup's cleanup boundary before started
diagnostics/upload compilation. Actual request, epoch, source, adapter, constructor
binding and adopted receipt evidence join the selected route. Protected calls
reject losing/cached/bare routes, wrong facade receipts and callback reentry at
effect time. Existing legacy cohorts are not promoted.

Release is allowed only for issuer-proven unused pre-dispatch cancellation.
Once capability dispatch begins, uncertain/late results, stop, disposal and
failed cleanup retain the claim. Terminal completion permanently seals that
source; a later startup needs a fresh cohort. Do not infer cleanup from
`disposed: true`, zero handles or ordinary receipts. Private terminal delivery
and retry-safe failed/late-handle retention are implemented in the continuation
below; the later root-enrolled wrapper checks still do not establish general
native-effect denial. Startup verification passed204 distinct behavioral browser
cases, two ESM import-order checks and two40-case canonical-bundle reruns:286
successful executions, not286 distinct cases. There are zero skips, denied
requests or unexpected browser errors. Each scoped bundle explicitly asserts
its one absent-VirtualGPU probe; no whole-OS build is claimed. The new Python
gate passes26/26 and the final selected32-file regression passes494/494,
including the earlier100. Current Python verification totals520/520.
The earlier487/446 totals remain historical. Exact receipts and reproduced
commands are in the linked foundation section.

The [private presenter terminal cleanup continuation](m2-runtime-foundation.md#private-presenter-terminal-cleanup-and-retry-ownership)
now captures the original historical attempt's cleanup capability before any
startup diagnostic or admission. Entry supplies its exact existing teardown root
privately, keeping the host lease6, dependency16, start9, Source1 and Token4 frozen.
The actual adapter and Core revalidate that root and claim through terminal drain.
Unused historical reservations cannot seal or drain a successor. Dispatched claims
remain sticky; current-work loss and absent receipt adoption cannot select another
cohort or suppress required cleanup.

Root-bound protected presenter cleanup retains failed and late handles, shares concurrent
stops, avoids the startup/stop wait cycle and replaces ordinary-job destruction
with original cohort proof. Native destruction must finish without unresolved or
abandoned resources. The private retry-policy broker and adapter retain even
unpublished rollback candidates. Entry keeps the same presenter, root and upstream
owner on rejection, and does not repeat GPU disposal within one cleanup pass.
Permanent dispose intent still permits explicit cleanup retry. Device loss is
not permission to abandon resources.

The terminal continuation passes458 browser/bundle executions:288 distinct
behavioral cases, two fresh ESM import checks and168 canonical repeats. New44
cover37 presenter and seven genuine Entry teardown cases. The final selected
35-file Python sweep passes562/562. Entry evidence uses its real lifecycle roots
and owner with an actual protected presenter attached; it does not substitute for
the full admission/ECS recipe or physical first-frame gate. The linked foundation
section records source hashes, the durable receipt, exclusions and reproduction.

The [root-enrolled ordinary-work continuation](m2-runtime-foundation.md#root-enrolled-ordinary-work-fencing)
now protects standard-route cached/after-await publication, retained/delayed
callbacks and nested command access without blocking original cleanup. Its
constructor-root/pre-dispatch enrollment preserves binding-only legacy policy.
The approved [native work-view implementation](m2-runtime-foundation.md#original-cohort-native-work-view-implementation)
now closes both recorded native-method getter-revocation failures, with separate
view caches, command/pass aliases and finished-buffer provenance. The next
boundary is schema-directed descriptor and separate native-return conversion;
the strict descriptor witness remains0/1, not accepted. Raw resource children,
mapped memory and frame-ready authority require separate coverage.
Full-provider mount/backend isolation, exact resource telemetry,
selected-Realm/activation authority, recovery and the production M1C-to-city-frame
gate remain open. The full [source map and build order](m2-runtime-foundation.md#pre-dispatch-integration-review-terminal-gpu-contract-decision)
stay within piece 9. Existing v1/v2/v3 channels and dependency16 remain frozen.
The retained [native work-view approval blueprint](m2-runtime-foundation.md#original-cohort-native-work-view-proposal)
records eight bounded implementation/review pieces under the same flat piece9.
Its approved method/cache/command implementation adds no milestone and keeps the
ten-piece ledger unchanged. Original device identity and independent terminal
cleanup remain separate from the derived work view.
The earlier inert-contract gate passed 36/36 browser cases with no console errors
and a scoped 66/66 Python group, including 18 new contract checks. Those historical
contract receipts did not accept destruction operations; the terminal continuation
requires its separate implementation and behavioral evidence.
(Sources: `webgpu-os/kernel/realm/RealmM2RuntimeComposition.js`;
`webgpu-os/apps/the-virtual-realm/runtime/RealmGpuTerminalCleanupContract.js`;
`webgpu-os/apps/the-virtual-realm/VirtualRealmEntry.js`;
`webgpu-os/apps/the-virtual-realm/rendering/RealmStaticGpuPresenter.js`.)

| Piece | Current state | Remaining acceptance work |
| --- | --- | --- |
| 1. Protected local-policy head source | Implemented bounded source. `RealmLocalOperatorPolicyHeadStorage` preserves canonical M0 policy verification, exact predecessor SHA, and per-Realm uint64 `policyEpoch` through the shared transaction helper. | Keep writes kernel-private and compose the selected Realm's head through piece 3. This source does not accept B4H. |
| 2. Current-local-Realm and authority-epoch sources | Implemented bounded source. `RealmLocalSelectionHeadStorage` owns one 4,096-byte per-account head and an epoch global across that account's Realm selections, with persisted null tombstones and no reset/delete path. | Keep the source private; bind only its current non-null selection and exact epoch into piece 3. Selection and epoch changes grant no ownership or capability. |
| 3. Operator-context and local-policy adapters | Coherent snapshot, owner-write/pre-mutation invalidation, attach-before-read observation, default-off standalone boot lifecycle, one-shot B4A and retained-cut B4F adapters implemented in bounded scope. Original issued-session notifications, Entry subscriptions and the bounded opaque-origin local-head channel are connected. Hosted handoff, full provider/renderer placement and full OS boot verification remain open. | Reuse the original adapters, boot binding, observation source, `RealmLocalHeadChannel` and unchanged snapshot join. Preserve original roots, genuine correlated subscription delivery, synchronous cancellation, exact retained failed-disposal handles and publish-before-callback joins. Continue to piece4 without provider activation. Keep hosted opt-in rejected until real freeze/resume/rollback handoff is wired. Retain exact observations across snapshot/subscribe; invalidation is not retirement/resource-cleanup evidence. Client grammar/context checks do not replace host canonical policy admission or synchronous app ports. Missing/cleared selection stays unavailable. Expose no writers or raw GPU authority. |
| 4. Runtime-activation owner | Original factory/ECS candidate provenance, private original admission context bridge, StorageManager-issued service-view provenance, original admission protected-storage cut binding, stronger original boot/adapter-selected manager lineage, historical original admission-service constructor lineage, original read-port issuance lineage and original M2 admission composition's actual nine-input post-await construction cut verified in bounded scope. Original publication head, bridge constructor, writer issuance, downstream retention through RealmForge entry/publisher and client, original M1 dependency retention, original Forge-port/client issuance, independent actual consumer join, same-M1 original evidence resolver association, original provisioning-service/issued-port/coordinator argument association and original coordinator state/wrapper retention, port issuance and actual client connection, original selection construction, actual lease issuance and catch-free completed release history are verified. The approved opt-in completed-load channel joins one original invocation, ticket-bound actual normalized six-field result, genuine lease/release, exact original outer fulfillment and original composition association:976/976 raw-current native checks;24 current-source plus727 checkpoint CPU checks,751 total. Activation owner remains unimplemented. | Reuse the original candidate/context/storage/boot/service/read-port/publication/composition lineage companions and existing cleanup owners. Preserve the exact protected-storage cut, accepted completed-load history, bare-return adoption/error boundary, unchanged v1 path and explicit v2 observer effects. Next authenticate supplied dependency implementations and freshly reacquire selection/currentness before one-shot eligibility. Historical completed loading is not dependency authority or currentness. Then implement active-bundle head, private handles, prepared-CSE verification, trusted clock, runtime pins, activation children, recovery and exact active-bake binding required by B4B. Historical construction, issuance, retention and argument association do not prove dynamic method integrity, immutable scope, provisioning execution or the full composition graph. Original factory-retained boot selection does not certify KernelBootstrap installation or replaceable backend behavior. Context/candidate provenance and correlated labels do not authenticate supplied admission, policy, trust or eligibility ports. |
| 5. Runtime-checkpoint owner | Not implemented. | Own the checkpoint-source lease, protected head and root transaction, retention, retirement, and restart recovery required by B4C. |
| 6. Runtime-handoff owner | Not implemented. | Bind the protected handoff head to a verified checkpoint edge, runtime pin, profile, policy, CAS lineage, tombstone, and recovery required by B4D. |
| 7. Action-authority owner | Not implemented. | Mint secure correlations, own replay and result ledgers, reassert the active bundle and current context immediately before dispatch, and recover partial settlement required by B4E. |
| 8. Production M1C admission sources | Not integrated into a production opener. | Supply the existing private-bake admission composition with genuine generation-bound storage, content, policy, trust, evidence, quota, selection, and signature sources. Keep all writer authority private. |
| 9. Runtime support sources | Durable reservation, session authority, versioned attempt binding, allocation/currentness/retirement owner, genuine private process-owner identity, approved v3 transport, participant notification, genuine lifecycle-port composition, boot-owned operator-switch cleanup tracking, bounded diagnostic clock/logger sources, exact-producer frame accounting, private exact-mount buffer/texture/creation accounting, separate original-surface reservation accounting and retained original-owner teardown authentication are implemented, with a private guarded-frame bridge, weak historical surface receipt/view pairing and a composition-derived genuine-owner companion plus historical original-epoch presentation-result provenance and reentrant GPU-control protection. The separate terminal-cleanup v1 inert wire is accepted; it grants no destruction authority. The private original buffer/texture issuer registry and captured-operation rollback are implemented; their read-only source does not establish Realm lifecycle ownership. The opt-in original B3/lifecycle composition installer authenticates the configured owner before GPU epoch publication. Separate original allocation cohorts now join that genuine owner prospectively to explicit buffer/texture routes, preserving disjoint membership across shared mounts and retained original-root teardown validation. A separate original-only terminal delivery now provides bounded destruction with genuine teardown revalidation, exact cumulative counts, retention draining and explicit unresolved retries. The original-companion core and opt-in pre-acquisition original mount/facade installation now prepare a genuine primary cohort before GPU epoch binding, validate exact configured device returns and preserve retryable private-control retirement; the original B3 capture APIs still require completed acquisition. Early exact stable-port/epoch lookup may expose a paused source, while work checks and allocation remain closed through owner.bound until callback-free acquisition completion; resume cannot reopen an explicit close or terminal seal. The standard adapter now routes opted-in buffer/texture creation through that exact original cohort using a factory-issued syscall namespace and cached original work/facade proof. Its original-only source lookup preserves the actual selected cohort and terminal endpoint; raw post-metadata checks are implemented, with later root-enrolled standard-route cached/after-await checks described below. The exact original stable-port/epoch pair now resolves that epoch's actual selected allocation source before capability admission and after retirement, without current-epoch substitution or a global receipt registry. Original presenter-generation Source1/Token4 provenance now supplies native/private currentness, exact constructor-port identity and historical adopted-receipt evidence, without returning those capabilities or reserving a cohort. The approved separate v4 host carrier and fresh-only protected allocation policy are implemented with original issuer authentication, constructor binding, pre-diagnostic reservation, original request and adopted-receipt evidence, source-global exclusive claims and exact receipt-bound buffer/texture routes. Legacy v1/v2/v3 wires and dependency16 remain unchanged. The exact four-member, five-edge lazy authority module cycle is explicitly guarded and both initial import orders execute. Private original-attempt terminal delivery and retry-safe protected presenter/Entry cleanup are implemented: native teardown-root authentication, historical dispatched-claim binding, unused-predecessor isolation, retained late and unpublished rollback candidates, phased retry, zero-abandonment resource proof, and upstream owner retention on rejection. The root-bound terminal-cleanup path no longer schedules ordinary-job destruction. Root-enrolled standard-route work fencing now binds original constructor-root and pre-dispatch cleanup choice, exact adopted receipt, current owner/mount and unsealed work; it covers facade caches, scoped job/transfer/frame callbacks, nested command access and awaited work returns while retaining late cleanup handles and preserving rootless policy. The approved separate original-cohort WorkView8/Queue3 now carries adopted claim proof into native method lookup, view-local cache publication and nested command/pass operations, with private finished-buffer provenance; both recorded native-getter probes pass. The approved bounded protected-shader profile now snapshots standard fields before native/cache effects; descriptor2, profile42 and genuine-native7 pass in source and both canonical import orders. The protected sampler snapshot is accepted with the explicitly approved installed-native numeric profile; sampler88 and genuine-native8 pass in source and both canonical import orders within the final1175/1175 browser matrix. Its documented WebIDL differences and recorded transient test-transport allowance do not introduce a browser admission rule. The approved binding-layout snapshot is accepted with standard-sequence traversal, a4096-entry conversion cap and explicit experimental-member rejection:126 profile and27 native checks pass in source and both canonical import orders within the fresh1634/1634 browser matrix, with669/669 Python checks across41 literal files. The measured native differences, historical failures and exact reproduction evidence remain documented. The approved pipeline-layout snapshot is accepted with nullable genuine BGL identity, standard traversal, an independent4096-layout cap and full immediateSize conversion:43 profile and64 native checks pass in source and both canonical import orders within1955/1955 browser executions, with693/693 Python checks. All28 original revoking native witnesses now prevent entry, creation and publication. The documented cross-frame/foreign-device crash remains unresolved. Other native conversion families remain separate. Full process-owner authority and genuine resource telemetry remain missing. | Preserve terminal registration identity, actual mount/cleanup ownership and queued same-generation notifications without treating acceptance as teardown completion. Prove full-provider Entry teardown; supply activation-authorized child ownership and restart reconciliation. Preserve the verified protected-startup slice without treating buffer/texture exclusion as full GPU-effect isolation. Preserve irreversible post-dispatch claims, retained late candidates and release only proven unused pre-dispatch reservations. Never promote old cohorts or reopen terminal seals. Preserve the private terminal channel, explicit failed/late-handle retries and root-enrolled standard-route fences without treating them as full GPU-effect isolation. Preserve the accepted original-cohort native work view without a supplied-authorizer shortcut or shared-facade policy contamination. Preserve the accepted shader/sampler/binding-layout profiles and strict native comparisons. The pipeline-layout review demonstrates28 post-revocation native effects in a separate62-case diagnostic (34 passed,28 failed); original63/group5 browser crashes remain unresolved, not passing evidence. The user has explicitly approved standard iterator traversal, an independent4096-element conversion cap and full standard immediateSize conversion. Preserve the accepted eight-piece protected snapshot and its exact native/structural regressions; this does not accept other native argument/return families or provider activation. Preserve native BGL identity without inferring device or Realm ownership. Keep remaining native argument families and native-return/thenable conversion separate. Shader and sampler conversion do not prove those boundaries. Cover raw resource children/mapped memory and authentic frame readiness separately; owned allocation routing alone is not full renderer integration. Prove the host-selected mount belongs to the full provider and complete native effect-time owner checks beyond the reviewed standard routes/callbacks; complete retained late-result cleanup, exact per-owner attribution across shared-mount epochs, selected-Realm/activation identity, late source attachment and reviewed missing-family coverage, then acquire genuine telemetry/full process-owner ports with reverse retryable cleanup. Keep telemetry teardown distinct from bounded original-cohort destruction retries, and add authentic loss evidence before claiming abandonment. Retain diagnostics until Entry and reverse-source teardown finish. |
| 10. Full provider, registration, and evidence | Not implemented. | Prove both authenticated acquisition and enforced backend isolation from piece 3; tokens, same-origin workers, and import allowlists alone are insufficient. Atomically capture one operator, Realm, epoch, profile, and bake binding; acquire pieces 3–9; reuse B4G; call B3; register one opener at boot; and prove every-await failure cleanup, concurrent/retry cleanup, operator/device invalidation, secret non-disclosure, exact 16-key output, no writer leakage, and the real M1C-to-first-submitted-frame route. |

Historical first-source evidence passed 24/24 policy-head browser cases over
real OPFS and injected failure paths, 24/24 shared private-service storage cases,
and 9/9 independent Python checks, with zero browser failures or skips. This
48-browser-plus-9-Python subtotal proves only the earlier source boundary; it
does not accept B4H or alter B4G's historical 352/352 core browser count,
371/371 count including transport, or 72/72 Python count. The policy source's
historical standalone closure contained 45 modules.

The earlier continuation regression sweep passed 502/502 browser cases with no
failures or skips: B4A-B4G/runtime/factory/Desktop 371, Entry 25, source/storage
48, private publication 21, admission codecs 15, and M1C handoff 22. Its scoped
Python group passed 81/81, including the nine policy-source checks. Those
receipts remain historical and do not certify subsequent source changes.

Current measured acyclic closures contain 44 modules for the shared protected
transaction helper, 45 for selection, and 46 for policy. Entry and B3 composition
remain at 106 and 48 modules and cannot reach these private sources. The selection-source
continuation recorded 32/32 selection browser cases, the preserved 24/24 policy
cases after extraction, and 24/24 shared storage cases: 80/80 total with zero
failures or skips. Its focused policy/selection Python checks passed 18/18, a subset
of its 90/90 scoped Python regression receipt after source hardening.
Both source gates share genuine OPFS and
fault-injection fixtures; the selection gate includes an exact golden storage
SHA and sibling diagnostic-forgery rejection. That continuation's browser regression
sweep passed 534/534 distinct cases with zero failures or skips: the 371-case
B4A-B4G/runtime/factory/Desktop group, Entry 25, source/storage 80, private
publication 21, admission codecs 15, and M1C handoff 22. The selection and
policy receipts include the latest hostile-input and scope-fence checks.
No source subtotal, import proof, or regression result accepts B4H or a physical
frame. Broad discovery generation remains
deferred to preserve the First Shard exclusion and concurrent task ownership. (Sources:
`tests/virtual-realm/m2-local-operator-policy-head-storage.test.js`;
`tests/virtual-realm/m2-local-selection-head-storage.test.js`;
`tests/virtual-realm/RealmProtectedHeadTestFixtures.js`;
`tests/virtual-realm/m2-private-service-storage.test.js`;
`tests/virtual-realm/test_m2db4h_local_operator_policy_head_storage.py`;
`tests/virtual-realm/test_m2db4h_local_selection_head_storage.py`.)

The snapshot-source continuation freshly passes 24/24 new snapshot browser
cases, 32/32 selection, 24/24 policy, and 24/24 shared storage cases: 104/104
source/storage checks. Kernel operator-context tests add 9/9, yielding 113/113
distinct browser checks with zero failures/skips. The full earlier 534-case
matrix was not rerun or mechanically added. New snapshot Python proofs pass
10/10; all three source groups pass 28/28 within the wider 100/100 scoped Python
receipt. The snapshot source has exactly 49 acyclic error-free modules; Entry106
and B3-composition48 remain unchanged and exclude it. This accepts the bounded
point-in-time join, not piece 3's live adapters or full B4H. (Sources:
`tests/virtual-realm/m2-local-operator-snapshot-source.test.js`;
`tests/virtual-realm/test_m2db4h_local_operator_snapshot_source.py`;
`tests/webgpu-os-operator-context.test.js`.)

### Scope

- Preserve the accepted schema-admissible application manifest,
  side-effect-free `VirtualRealmEntry`, flat runtime peers, process ownership,
  operator lifecycle, exact 16-key dependency-version-2 boundary, and stable-runtime
  checkpoint/handoff ports.
- Implement the six genuine authority owners against the accepted wire
  contracts, reuse B4G's stateless terminal port, then register one genuine full provider through
  the accepted B3 trusted lease path. Neither
  surface nor frame authority is part of the accepted M2D-A plan, M2D-B0
  profile, or M2D-B1 CPU packet gates.
- Give the application only a read-only `bakeAdmissionPort`; keep publication
  lookup, immutable storage, admission-head mutation, evidence resolution,
  signature verification, keys, and migration inside the trusted OS service.
- Add a kernel-only operator/service storage root outside app-writable `/user`,
  bounded cancellable exact-byte content methods, versioned/ABA-resistant M1
  publication observation, structured M2 head CAS, fixed pending slots,
  fixed proposal/intent/dispatch/retry/result controls, prior/current terminal
  audits and reclaiming cleanup, exact admission-policy codec, five-role
  Realm-scoped Ed25519 trust policy, immutable complete runtime/evidence-policy
  registries, authenticated four-kind evidence provisioning and six-row signature resolution,
  `RealmAdmissionSelectionCoordinator`, the separate root-maintenance fence,
  guard-private trusted activation clock, narrow secure-random ID port, flat
  activation and checkpoint-source/commit-lease services, kind-bound durable
  root payloads, successor-active retirement, bounded Realm-scoped root/artifact/
  evidence-directory and journaled GC prerequisites with completed-sweep
  rollover, and bounded restart recovery.
- Implement the composition-root-injected `RealmEngineAdapter` and `RealmStateFirstPresentationAdapter` without globals, module probing, service locators, Playground imports, or compatibility fallbacks.
- Reconstruct, independently verify, and load one complete owner-private M1C
  version-2 static bake from its durable admission capsule.
- Implement grounded first-person traversal, collision, interaction, baseline lighting, spatial audio, and device recovery.
- Implement the explicitly entered Local Operations View and minimap over a static private bake, with bounded isometric/eagle-eye framing and no live zone mutation.
- Optionally load a static `GenesisRealmExtensionManifestV1` with kits and
  identity bindings but no live ecology.

### Deliverables

- Dedicated Realm scene.
- First-person controller.
- Local operator policy store, local-only projector, operations camera controller, minimap projector, and zone selection store.
- Static and dynamic stores.
- ECS synchronization.
- Geometry, lighting, effects, and audio presentation.
- Device-loss recovery barrier.
- State-First source registration, frame measurements, lifecycle-generation fencing, and idempotent detach/disposal evidence.
- Production artifact-store adapter, owner partitions, process/lifecycle
  adapter, monotonic runtime-checkpoint and handoff records/tombstones, trusted
  current-active checkpoint projection/authorization lease, mandatory service-
  injected checkpoint binding and complete protected handoff graph edge with
  claim/verify/settle/release-edge state, trusted root managers, plural disposal pins, and
  one-surface resource ledger.
- Flat single-responsibility private-bake admission codec peers,
  content-addressed 17-key package artifact,
  71-field durable admission index, chunked resource/evidence/signature
  inventories, exact evidence provisioner/resolver, protected non-versioned
  service storage, structured M1/M2/admission/trust policy heads, pending,
  terminal-audit, intent, proposal, dispatch, recovery-retry, result,
  prepared/active/abandoned/released durable-root, root/artifact/evidence-directory,
  manager/registration/candidate/progress journal codecs, monotonic
  activation-clock/checkpoint/handoff heads and tombstones, exact active-bake
  genesis/active-output/prepare/discard/swap/staged-close/abort/integrity-
  quarantine/close/supersession evidence,
  plus the explicit
  manifest-only-root migration command.
- Immutable safe-text store and inert Storylet catalog store with no scheduler,
  instance, episode, proposal, or presentation port.

### Gate

- No camera path exists outside grounded first-person traversal and the bounded owner-private local Operations View. The operations controller cannot traverse, orbit freely, follow a Traveler, or frame another Realm.
- Stairs, slopes, doors, head clearance, and interaction pass.
- Runtime imports no RealmForge UI.
- Runtime imports no Playground source or presentation asset; the shipping bundle contains no demo camera, WGSL, UI text, identifiers, loader globals, or authored graph topology.
- Missing or incompatible Engine APIs fail closed as unavailable presentation and cannot silently retain a native mode while claiming State-First behavior.
- Source registration, cancellation at every await boundary, double disposal, device loss, and restart leave no stale source, GPU resource, pointer lock, listener, or presentation decision.
- Device recovery rebuilds resources exactly once without duplicate entities.
- Static operations entry requires current local authority and exact Realm/bake/layout binding; connected-Cityform, public-shell, presence, rendezvous, bridge, and Traveler records are structurally unaddressable.
- Before CAS dispatch, failure preserves the prior head; after dispatch, only
  exact predecessor or proposal is admissible and fixed-slot recovery must
  classify it. Operator switch, interrupted launch, handoff, and application
  close never activate or change to an unverified replacement and never leave
  partial visibility or a stale owner; lifecycle close may transition the exact
  old bundle to absent through its bound teardown receipt.
- Process restart reconstructs the same private-v2 package digest and Storylet
  catalog digest from the admission index before allocation, but only after the
  current M1 scope/root/generation/storage SHA and admission policy still match
  that index and the same immutable registered runtime profile is available.
- A valid package beyond the bound 16 MiB/100,000-node base runtime profile is
  rejected explicitly as too large with zero admission writes; raising the
  profile requires the separate streaming-codec scale gate.
- A manifest-only root, invalid external signature, public/refinement root,
  unknown package version, or missing M1C evidence fails closed.
- Publication-head selection, admission-head selection, and runtime-bundle
  activation cannot imply or silently perform one another. Final visibility
  reasserts both heads plus current admission/evidence/trust/signature/profile
  closure and exact active-bake CSE predecessor under the same retained selection
  fence as the bundle swap. The exact safe prepared-commit receipt/digest, separate acyclic expected swap
  receipt, and exact next active-record digest are independently bound; live
  visibility requires the actual step-8 receipt before pointer/gate opening.
  After durable pin readback, the no-await block first
  rechecks work-root, activation-state, operator-generation, lifecycle, and owner
  liveness, then makes the synchronous immediate-time safety predicate bound to
  that physical SHA; either denial changes no visible state and retires the
  candidate pin. Candidate aborts, terminal replay, and stale teardown handles
  have bounded exact result unions and use the teardown root after work abort;
  a hostile post-step-8 mismatch quarantines both gate sets and reports no
  success or ordinary abort. Verified replacement closes/readbacks the
  old gates and transfers its superseded child to GPU-fenced disposal ownership.
- A static checkpoint is committed only when a trusted service reproduces the
  exact current bundle/pointer/live receipt, heads/profile, safe anchor/cursor,
  and policy and holds its narrow activation-selection lease through head CAS
  and normal root readiness; predecessor or source change has an explicit no-
  publication abandonment result. Handoff accepts only the caller's Operations
  preference, requires a service-issued authorization, injects every restoration
  field from the verified checkpoint binding, retains the complete graph edge in
  its root payload, and releases that edge only after handoff-root release.
  Checkpoint/handoff replacement uses exact successor-active retirement evidence.
- Future content deletion remains disabled until every content producer and
  evidence binding is directory-registered, historical blobs are backfilled,
  deterministic batch continuation is proven, and quarantine/delete outcome
  recovery plus unchanged-directory completed-sweep rollover passes without
  skipping an unverified authority or permanently stranding an earlier blob.
- The separate M2 catalog reaches exactly 11 complete definitions through the
  existing registry while the frozen M0-M1C catalog remains exactly 109; no
  placeholder or combined catalog is accepted.
- The 25-case catalog/index suite, 30-case runtime-composition lifecycle suite,
  32-case durable M1C admission-handoff suite, and independent 12-case stable
  checkpoint/OS-lifecycle handoff suite all pass with zero skips before later M2
  slices begin.
- Every M1C Storylet resource verifies and remains inert throughout M2.
- Optional Genesis rejection leaves the accepted base city byte-identical and
  renders no unobserved phenotype or activity.

### Exclusions

No live OS data, Code Matter reveal, or multiplayer.

### Rollback boundary

Disabling the runtime preserves both the M1 publication root and last accepted
durable admission head. Rolling back either head does not rewrite immutable
artifacts or mutate the other head.

## M3: local living city, Code Matter, and local Storylets

The dependency-valid first slice is the separate
[M3A observation-ingress work package](m3a-observation-ingress.md). Its plan may
be reviewed before M2 implementation completes, but its runtime cannot start
until the integrated M2 gate is accepted.

The dependency-valid second slice is
[M3B disclosure and dynamic projection](m3b-disclosure-projection.md). Its plan
may be reviewed now, but implementation and runtime acceptance require both
accepted integrated M2 and accepted implemented M3A with all 22 gates and 48
cases passing. M3B-00 must then separately implement and accept the M3
projection-transaction profile, immutable full-bundle codecs, root-store-scoped
nonexpiring artifact leases,
root-owned reader/recorded-authority evidence escrow, retained M3A head/floor
evidence, retained-root ownership, durable selector CAS, exact journal/readback,
the commit-port recovery path, 14-field authority/device presentation-fence
vocabulary, and fail-closed process-local mirror;
this does not widen M2 V1.

### Scope

- Instrument trusted OS boundaries and add normalized, generation-fenced boot,
  canonical filesystem/storage, process, IPC, syscall, authority, and
  local-network source ports behind one prebound aggregate ingress service;
  derive its portable M2 scope under one selection fence, claim runtime work
  through an independent M3A extension owner, and neither scrape managers nor
  widen M2 V1 or its child-tuple domain.
- Bind all seven source rows to exact adapter/port/M0 schema versions and one
  irreversible normalization profile; derive continuation from M2's retained
  initial operator projection plus current assertions and require accepted
  recovery-receipt evidence through the exact internal recovery-observation
   union before post-loss presentation resumes. Bind opaque identities to a
   kernel-only durable operator-partition HMAC authority/epoch/commitment with
   exact preimage bytes, restart stability, explicit rotation, cursor/checkpoint
   invalidation, fresh seven-source generations, kernel-only historical epoch-
   reference accounting, an exact seven-row terminal-reason precedence map with
   a distinct normalization-policy-change reason and immutable record-first
   latch, generation-branded projection handles, atomic issuance/row registration
   or sealed nonissuance, object-identical live close, cumulative retired-
   generation zero-handle/zero-in-flight fences, exact complete-lineage
   extension-aggregate terminal evidence, a complete-set terminal old-binding
   drain, a seven-kind bounded safe blocker projection, and permanent non-
   reactivating retirement metadata.
- Add the separate three-port M3B composition and 16-definition/18-module
  projection catalog, exact 57-field/47-ceiling profile, 53-field logical
  binding, separate exact ten-field port descriptors, exact eight-key method/
  request-bound service result envelopes and closed payload unions, plus
  receipt-returning session/recover/begin-stop/close/detach surfaces and
  internal healthy-transfer evidence without widening M2's 16 keys or M3A's
  two keys.
- In that existing catalog module, compile the exact 14-field catalog receipt,
  its embedded 17-field reference-descriptor pack containing 50 definitions, 50
  extractors, 78 authority rules, and 78 producer predicates, and the 12-field
  three-import/50-domain/78-carrier registry. Compile the sole 21-field source
  matrix with exact import/shape/recovery/domain/carrier/producer-seed/producer-
  variant/direct-edge/alias-source/literal-alias/reference counts of
  3/6/9/50/78/87/111/111/108/105/137. Freeze authoritative definition
  bytes, dependency roles, selector/condition operator arity, scoped authority
  paths, producer variants, hash-derived edge IDs, exact aliases, bytes rules,
  owners, and resolvers in checked-in JavaScript plus independent JSON/Python
  vectors; add no callable runtime authority or extra wire definition.
- Freeze reader/context/commit request ceilings at 65,536/33,554,432/
  536,870,912 bytes. Require every live non-descriptor request to be a closed
  null-prototype object with exact own-key order and conditional presence;
  work/cancellation signal is the final live key when present, while no-argument
  close uses the canonical empty-record digest. Compute
  `canonicalRequestDigest` with `particle-realms.m3b-port-request@1` from the
  exact `portName`, `methodId`, and ordered data-only field-name/value sequence before
  dispatch, excluding those object-identical
  signals as identity-free control. Derive `resultId` with the
  existing M0 content-ID function over `(resultDomainId,
  canonicalRequestDigest, format, version, status, runtimeBindingId,
  runtimeBindingDigest, payload)`, where format is
  `particle-realms.m3b-port-result` and version is `1`, then digest the eight-key
  envelope with only `resultDigest` omitted.
- Add preserve-or-omit owner-private disclosure, eight explicit primary domain
  projectors over the nine M3A kinds, one zero-owner historical witness, and the
  embedded 16-field recipe matrix with 53 event rows, 130 primary operation
  slots, 16 descriptor roles, and one witness recipe,
  exact semantic-axis transitions, deterministic primary outcomes, frozen-M0
  `RealmDeltaV1` identity, and exactly three 28-field cut kinds. Resolve every
  authority-domain observation once through bounded recorded evidence and
  complete escrow before disclosure. Return canonical
  `authorityResolutionReceiptBytes` plus their pair in both recorded-batch and
  current-only modes; recorded mode additionally returns the exact 15-field
  escrow-manifest bytes. The internal resolution receipt has a closed 21-field
  maximum vocabulary with 19 own keys in recorded mode and 13 own keys in
  current-only mode. Keep the separate complete 13-field current-authority
  snapshot fence-only. Resolve static bindings from subject IDs only, return the
  complete authorized binding/anchor closure and canonical
  `staticResolutionReceiptBytes` plus their pair under the exact 24-field
  internal receipt, and never accept a caller-supplied anchor probe. Keep
  permission and action-result under one authority-domain owner; keep Code
  Matter out until M3D.
- Freeze the exact 41-field `RealmProjectionBatchV1` with equal-length dynamic
  `presentationCommandIds` and `presentationCommandDigests`. Commands are not a
  fourth static carrier: each joins exactly one batch pair, one pure-compiled or
  retained-origin protected-closure byte object, and at least one admitted ID-
  only presentation Delta. Reject free, missing, uncited, conflicting, or
  multiply resolved command bytes. Count command bytes through protected
  closure, never `deltaByteCount`. Bind command identity to runtime binding,
  projector, observation, slot, binding subject, selected anchor, command kind,
  and content digest while deriving the current-presentation semantic key
  independently. The historical witness reuses the exact accepted primary
  command and emits only a witness Delta, never a second command.
- Admit exactly M3A's six local-network event variants and reject
  `authenticated`, which requires excluded `peerIdentityRef` and remains M5
  work. Require every base-M3B IPC, syscall, and network route to remain
  `non-traversable`.
- Add the neutral import-inert semantic kernel used by app and trusted prepare;
  pure maintenance compiler; exact sequential `transitionBase` reconstruction;
  exhaustive Delta-to-entry lowering; six-channel reducer/candidate split; seven-slot
  fail-closed overlay with exact nested generation/finite-expiry evidence; one
  11-field retained-head/floor state value always on `ready`, `source-state-
  ready`, and byte-identical `idle`, with `gap` legal only when that value
  verifies and `unavailable` otherwise; evidence-complete `ready` and
  `source-state-ready` reader escrows whose results return canonical
  `readCallReceiptBytes` plus their pair; saturating cut-tick-plus-one expiry for
  current traffic and expiry `"0"` for every other primary Delta; exact service-
  issued due proof grounded exclusively in M3A-owned durable tick evidence;
  self-contained DynamicStore; full stable-ID ECS overlay; flat unique
  dependency-complete semantic-only State-First source; frozen protected-closure
  walker with root-owned M3A/recorded-authority escrow and floor bytes; lease-
  neutral 37-field root and target set; 27-field selected bundle with a covering
  nonexpiring M2 lease; separate 24/18/18-field application/recovery/selector-
  retirement journals under one shared quota, durable ABA rules, selector CAS/readback, proven-
  noncommit retry, and hidden CPU-tail commits behind an accepted `recovering`
  fence. Complete device resume through commit-port `recover()` with exact
  retention-head/floor, terminal 18-field recovery-attempt evidence, selector-
  read, 22-field catch-up, and closed-to-ready evidence in the exact 37-field
  receipt supplied by the trusted `RealmProjectionRecoveryService`. Use the exact
  21-field empty/present binding-transition descriptor, 21/25-field transition
  receipt, 18-field selector-retirement record, 24-field detach receipt, 21-field
  quarantine receipt, and exact 38-field disposal
  receipt with candidate-lease settlement and paired 16-field resource snapshots
  whose `candidateLeaseCount`, `sessionCandidateRootCount`, and five other
  session-service counts reach zero after internal retained-owner or quarantine
  transfer. Use the exact 16-field pre-freeze work-count plan for all 15 work
  components and independently reproduce the conservative 347137 ceiling sum
  without claiming the exclusive cut maxima are simultaneously attainable. M2
  retains its static baseline, codecs, barriers, adapter, renderer, and device
  recovery behind narrow injected facets.
- Implement the application/recovery/detach/quarantine receipt ID and digest
  preimages with exact hash-only presence vectors and ordered field-name/value
  rows. Implement quarantine's four-field operation-evidence rows and persisted
  ten-field resource-inventory rows with fixed kind order, dense order, exact
  count, aggregate digest, and one-to-one projection of every transferred
  journal/resource obligation. Test omission versus `null`, cross-kind records,
  duplicates, reordered rows, false count/digest, and all-or-nothing transfer.
- Add structural source-generation detection, bounded coalescing, the cross-root bake request and activation protocol, ordered observation buffering, full reprojection, atomic activation, and pre-commit rollback.
- Add the GPU glyph renderer and local reveal vault.
- Add orientation, inspection, ambient truth, operational proposal, incident, and recovery Storylets.
- Add coverage and provenance surfaces.
- Add authorized local dynamic overlays, minimap updates, and the local-zone management proposal adapter using the existing generic authority and observation chain.
- Optionally add the separate Genesis catalog and extension loader, deterministic
  AGI shadow, Foundry canary, ecology projectors, Storylet Role Algebra,
  Genesis Operations sidecars, and persistent-topology intent policy.

### Deliverables

- Stable local geography with real live activity.
- One fully cited boot-to-process-to-syscall-to-IPC-to-storage/network route sequence using only normalized observations and immutable deltas.
- Local sealed, structured, and revealed Code Matter.
- Read-only action path.
- Deterministic local Storylet catalog and lifecycle.
- Storylet Chronicle records and side-effect-free replay foundation.
- Controlled automatic local-private topology refresh with explicit activation receipts.
- Owner-private canonical and rejected-history witnesses with explicit temporal, assertion, provenance, evidence-quality, disclosure, retention, and expiry fields.
- Live owner-private zone status, alert thresholds, visibility proposals, rebake requests, and authoritative reconciliation in both first-person and Operations View surfaces.
- Canonical observation ledger, encrypted owner-private cursor/checkpoint store,
  source restart recovery, and serializable runtime handoff.
- Separate protected M3A checkpoint graph over M3-owned roots with
  a closed ordered/capped/self-digested edge schema and validation-only equality
  to current M2 state, exact binding-bound seven-slot cursors, and pseudonym-key
  epoch; M2 checkpoint/handoff V1 and its closed root-kind domain
  remain exact, and any cross-session living-runtime continuation is a later M3I
  versioned sidecar rather than an advisory cursor claim.
- Separate M3B projection root over exact profile/catalog/manifest/policy,
  semantic-transition/transaction-capability binding, 28-field input cuts,
  source retention-head/floor and due evidence, subject-authorized static
  closure, pre-disclosure recorded-authority evidence, disclosure/primary/
  witness/maintenance outcomes, frozen-M0 delta closure, independent applied
  cursor, self-contained DynamicStore, full ECS overlay, dependency-complete flat
  State-First source, root-owned reader/authority escrow and floor bytes,
  deterministic artifact lease-target set, bundle-bound nonexpiring covering
  lease, and bounded lineage.
  M3B registers the existing M3A `projection-root` resolver but owns no M3A
  checkpoint-link request/write/release authority.
- Exact M3B reference evidence: one 21-field source matrix with
  3/6/9/50/78/87/111/111/108/105/137 counts; the derived 50-definition/50-
  extractor/78-authority-rule/78-predicate pack; the three-import/50-domain/78-
  carrier registry; and the 137-row alias graph.
- Exact M3B projector evidence: the 53-event/130-primary-slot/16-descriptor-role/
  one-witness recipe matrix, 41-field projection batch, dynamic command pair/
  protected-closure/ID-only-Delta join, witness command reuse, sequential
  `transitionBase`, exhaustive lowering, and the 347137 conservative work sum.

### Gate

- Exact source reveal verifies byte for byte.
- No gameplay or Storylet mutation authority exists.
- Estimated metrics remain labeled.
- Decorative effects cannot be mistaken for telemetry.
- Every boot phase, syscall route, IPC path, storage operation, and network path cites its exact observation chain; missing or denied evidence remains sealed, absent, or stopped rather than inferred.
- Identical Storylet inputs produce identical semantic timelines.
- A failed or stale topology candidate leaves the prior bake active, disposes staged resources, and loses no ordered observations.
- Concurrent observations remain unordered without explicit causal parents, and rendering order cannot synthesize a happens-before edge.
- Selecting, rendering, or retaining a branch cannot commit it; only the owning authority's receipt and terminal observation can drive completed-success presentation.
- Map selection and camera focus remain presentation-only; a zone proposal cannot present completion before its generic authority receipt and terminal authoritative observation.
- Storage and VFS cannot double-count one source event; raw paths, payloads,
  arguments, tokens, handles, stack traces, and reflected errors never cross
  the observation boundary.
- All 22 M3A ingress gates and exactly 48 M3A cases pass with zero skips; the
  same sealed source generations reproduce byte-identical batches under
   delivery variation and same-binding consumer restart because process-local
   generation/cycle state is excluded, while a true source restart advances
   generation and reproduces the semantic opening cut plus appended or empty
   no-record commit evidence while attempt-local recovery receipt identities
   remain distinct. Key rotation instead creates a new binding, advances all seven
    source generations, and admits no cross-epoch cursor, record, or checkpoint.
- All 20 M3B gates and exactly 48 M3B cases pass with zero skips. Included M3A
  bytes remain exact, omissions are explicit, primary ownership is unique,
  structural/audience/policy mismatch rejects rather than omits, every authority-
  domain observation is resolved once into bounded recorded escrow before
  disclosure, current authority is a complete synchronously invalidated fence-
  only mask, and subject-only static resolution admits no caller anchor probe.
  Historical primary deltas remain closure-only and witness output cannot affect
  current state. Strict empty-head genesis begins at M3A
  batch 1, and one M3A batch creates one deterministic M3B batch including
  zero-delta output. Source-state/expiry maintenance uses exact 28-field cuts,
  advances no M3A batch cursor, and accepts an expiry boundary only with exact
  service-issued due evidence grounded exclusively in M3A-owned durable tick
  evidence above the prior frontier and at or below the proven tick.
- No M3B projector can invent an anchor, entity geography, road, collision,
  navigation, HLOD, authority, Code Matter, station, bridge, public object, or
  remote presence. Unbound filesystem structural change creates zero geometry
  plus bounded powerless M3C review evidence only.
- One off-active immutable bundle contains the self-contained root/closure,
  root-owned reader/authority evidence escrow, exact floor anchor, nonexpiring
  covering lease, independent cursor, DynamicStore, full stable-ID ECS overlay,
  and dependency-complete flat State-First CPU source. One durable selector-
  generation CAS is the sole logical commit; process-local mirror/device failure
  hides dynamic state while static remains visible. During accepted device
  recovery, contiguous CPU work may commit only behind an unchanged `recovering`
  fence. Reveal then requires commit-port recovery proof over complete retained
  head/floor/cursor/source/authority/expiry state, a durable selector-read/
  catch-up receipt, and one protected closed-to-ready transition.
  Proven conflicts name their competitor; uncertain
  dispatch reconciles journal and selector, and only durable proven noncommit
  permits an identical retry. Missing/corrupt/released/invalid/noncovering-lease
  or over-limit state uses complete M2 static fallback. Empty/present binding
  retirement uses the exact 21-field descriptor, 21/25-field transition receipt,
  separate 18-field selector-retirement record, exact 24-field detach receipt,
  and conditional 21-field quarantine receipt. Stop/double-stop
  first freezes the trusted before inventory through `beginStop()` and its exact
  16-field stop receipt, captures/closes the presentation fence, then uses the
  exact 38-field disposal variants with
  candidate settlement, extension release, paired resource snapshots, internal
  current/lineage-to-retained transition, or bounded quarantine-to-retained
  transition. A blocked close issues no
  terminal evidence; context `closeSession()` verifies all settlement evidence
  and runs last.
- Compaction exposes one exact result union, derives only the oldest excess
  closed-segment prefix with verified segment/batch boundaries and checkpoint-
  derived retained-root proofs, and while a binding is current releases epoch
  references only from a committed receipt; a proven retired binding uses the
  separate complete-set terminal drain, resolves its immutable reason latch and
  extension-aggregate terminal evidence, binds current object-identical close or
  sealed nonissuance plus any required prior-generation fence, or the sole
  absent-after-restart fence, and reports every blocked precondition through
  the closed safe blocker projection. After prior normal releases settle, aggregate release
  requires exact identity-projection close readback and paired private snapshots
  over the current live-resource cohort proving each owned-to-released row
  transition and zero remaining ownership.
- Genesis shadow candidates cannot mutate storage, ECS, network publication, or
  promotion state; the optional extension may be removed while the base city
  remains active.

### Exclusions

No public shell publication or peer arrival.

### Rollback boundary

Observation adapters can disable individually while the static city remains
usable. M3A rollback closes its one independent M3A extension child and
protected app lease but neither registers nor changes an M2 process child, bake,
pointer, CSE root, ECS, or RealmForge artifact.

M3B rollback closes its independent entry, reconciles every dispatched intent,
freezes the trusted before inventory through `beginStop()`,
detaches its dynamic ECS/State-First source, settles every abandoned candidate
lease through the explicit candidate-lease receipt, moves already root-store-owned
healthy current or lineage root/escrow/nonexpiring lease internally to the durable
retained owner, or moves quarantine-owned state through its bounded quarantine-to-
retained transition.
Its 38-field disposal receipt binds extension release and exact before/after
resource snapshots whose `candidateLeaseCount`, `sessionCandidateRootCount`,
callback, in-flight, candidate, prepared, and reader-escrow counts reach zero,
then context `closeSession()` verifies that evidence and runs last. A blocked
attempt returns no terminal receipt and preserves the same stop for retry. This leaves the
accepted M2 static city and M3A ledger/checkpoint intact. Verified or unresolved
projection roots remain under bounded protected retention until safe release is
proven.

## M4: public shell and privacy boundary

### Scope

- Add a transported-public-shell verifier distinct from the local compiler
  admission verifier, then integrate bounded staging, runtime loading,
  operator-scoped cache expiry, presence controls, hostile-content quotas, and
  public Storylet compilation.
- Add secret sentinels, network-capture inspection, and public noninterference tests.
- Add operator-view noninterference tests proving connected/public state cannot enter or perturb the local-only map for identical local inputs.

### Deliverables

- Runtime loading and caching of the signed M1B `PublicRealmShell`.
- Runtime enforcement for the shipped public archetype registry.
- Public presence controls.
- Public shell and Storylet cache.
- Privacy evidence.
- Optional independently compiled public Genesis appearance extension.

### Gate

- Private-only changes do not alter public manifests, canonical semantic-scene digests, or public Storylet timelines. Reference pixels remain within the frozen regression tolerance profile.
- Network capture contains no private path, count, topology, process data, plaintext hash, or hidden eligibility fact.
- Malicious manifests cannot execute or exhaust bounded resources.
- Local operator snapshots and minimaps never enter public manifests, publication timing, public Storylets, or network transport.
- The transported verifier rejects private/local-only record classes without
  requiring the publisher's local-only noninterference evidence.

### Exclusions

No authenticated Traveler or bridge.

### Rollback boundary

Public presence can disable without affecting local private Realm use.

## M5: SecureMesh Exchange

### Scope

- Add a kernel-owned, wire-allowlisted Virtual Realm exchange port, SecureMesh
  observation, destination board, public identity verification, mutual presence
  consent, `PresenceSessionV1`, Cityform visibility, safe Traveler appearance,
  station-only authenticated Traveler arrival, host-authoritative movement,
  route presentation, and station Storylets.

### Deliverables

- Station state reducer.
- Presence verifier.
- Presence-session reducer with consent, expiry, disconnect, identity-revocation, and monotonic epoch handling.
- Public shell verifier and cache.
- Traveler appearance verifier, presence-grant reducer, movement-intent port, host movement authority, and authoritative pose projector.
- Direct and relay presentation.
- Arrival, degradation, denial, disconnect, and departure Storylets.
- Bounded network-event ring buffer before admitting pose traffic.
- Optional public Genesis status and attributed cultural motif exchange.

### Gate

- No Traveler appears before identity and mutual consent.
- A Traveler can arrive at the station with an active PresenceSession and no RendezvousFrame or bridge.
- Consent withdrawal, session expiry, disconnect, or identity revocation advances or closes the presence epoch, removes the Traveler and protected interaction, and cannot leave a stale host-authoritative pose active.
- Visitor movement intents cannot self-assert position through host collision, navigation, gates, or presence scope.
- No presentation event grants authority.
- Every station state matches real transport state.
- A closed or dormant runtime never appears falsely online.
- Authenticated peers, remote shells, and station-arrival Travelers remain absent from the Local Operations View and minimap; only the local station landmark and content-free local boundary status may remain.
- The application has no generic network-send or raw peer-message authority.
- A received cultural motif is explicitly attributed, consented, bounded,
  expiry/retention controlled, and never auto-adopted as belief.

### Exclusions

No Cityform approach or bridge traversal.

### Rollback boundary

SecureMesh remains operational through its existing non-Realm surfaces.

## M6: Cityform rendezvous and deterministic docking

### Scope

- Freeze and certify the V1 hierarchical-coordinate, camera-relative GPU, floating-origin rebase, precision, pose interpolation, and bridge-endpoint quantization policy before enabling approach.
- Add first-person station-mediated Cityform locomotion proposals, signed
  virtual RealmPose, federated RendezvousFrames, Cityform approach, directional
  grants, independently built bridge halves, recipes, semantic digests, epochs,
  revocation, reconnect, and shared docking Storylets.

### Deliverables

- Rendezvous and pose contracts.
- Coordinate-rebase and numeric-precision receipts across rendering, culling, collision, navigation, picking, audio, Chronicle, and bridge compilation.
- Docking protocol.
- Deterministic bridge compiler.
- Epoch-aware bridge reducer.
- Multiplayer Storylet synchronization.
- Revocation cleanup.
- Optional capability-bound public factory/role proposals.

### Gate

- Both clients produce the same canonical bridge recipe digest.
- Rebase at the maximum certified separation changes no semantic pose, collision result, pick identity, audio source relationship, Storylet state, or bridge digest.
- Digest or version disagreement fails closed.
- A track appears only after active directional authority.
- Revocation rejects protected traffic before protected presentation remains interactive.
- Cityforms cannot separate while traversal remains open.
- Shared Storylet clients agree on recipe, phase, epoch, and completion.
- Docking, RendezvousFrame, bridge, remote Cityform, and remote Traveler changes leave byte-identical local operator snapshots for identical declared local inputs.
- Only the owning Realm authority can move a Cityform; the Traveler remains
  grounded first person and the internal local city frame does not move.

### Exclusions

No private refinement delivery or permanent global coordinates.

### Rollback boundary

Station-only authenticated presence remains available if docking disables.

## M7: certification and release slice

### Scope

- Complete HLOD, streaming stress validation, visual baselines, network fault injection, long-session resource testing, accessibility, security, privacy, Storylet replay, and documentation. M7 reruns the already required M6 coordinate suite under release load; it does not introduce the coordinate policy after docking exists.

### Deliverables

- Release candidate vertical slice.
- Performance and visual evidence.
- Security and privacy receipts.
- Accessibility report.
- Architecture import checks.
- Operational documentation.

### Gate

- The approved 60 Hz target passes on reference hardware.
- GPU memory and resource counts plateau under repeated streaming.
- Public/private isolation passes.
- First-person legibility passes at supported resolutions and DPRs.
- Operations camera, minimap, zone selection, semantic mirror, owner-private indicator, transition comfort, and connected-content isolation pass at supported resolutions and DPRs.
- Reduced motion, high contrast, keyboard/gamepad, captions, and semantic mirror pass.
- Device loss during arrival or bridge state creates no duplicate entity.
- Exclusion evidence confirms that only explicit exclusion assertions name The First Shard and no source, test, documentation content, design, scan result, or dependency from it exists in the Realm package.

### Exclusions

All features listed in the deferred scope remain excluded from V1.

### Rollback boundary

Each optional presentation tier can disable independently while preserving authoritative state and the baseline renderer.

## Deferred roadmap

- Capability-scoped remote interior refinements.
- Remote exact-source reveal after irreversible-disclosure review.
- Multi-city and group rendezvous.
- MLS-style group epochs.
- Permanent global spatial authority.
- User-supplied remote visual assets under a separate sandbox contract.
- Zero-knowledge correspondence proofs.
- Native whole-PC adapters.
- External network visualizations such as ICP.
- VR support.
- Any remote, shared, spectator, fleet, group, or connected-Cityform overview; V1 Operations View is exactly one local owner and one local Cityform.

## Approval model

Every milestone requires:

1. Contract approval.
2. Implementation approval.
3. Test evidence.
4. Security and privacy review where authority or disclosure changes.
5. Documentation update.
6. Session Memory update.

Passing a milestone authorizes the next milestone's planning. It does not silently authorize deferred features.

## See also

- [The Virtual Realm](index.md)
- [Architecture and ownership](architecture.md)
- [M1B public shell and access-refinement packages](m1b-public-refinement-packages.md)
- [Playground clean-room foundations](playground-clean-room-foundations.md)
- [Contract catalog](contracts.md)
- [Security and privacy](security-privacy.md)
- [Certification plan](certification-plan.md)
- [M3A Observation Ingress](m3a-observation-ingress.md)
- [M3B Disclosure and Dynamic Projection](m3b-disclosure-projection.md)
