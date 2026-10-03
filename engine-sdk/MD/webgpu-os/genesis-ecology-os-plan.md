---
title: Genesis Ecology WebGPU OS Plan
description: Kernel, storage, package, process, GPU, network, Factory, Editor, Plauna, and AGI integration plan for trusted Genesis Ecology services.
updated: 2026-09-03
status: cross-stack implementation plan; M0-M1C, M2A, and the admission-only M2B slice accepted while integrated M2 remains underway and unaccepted; bounded inert RealmForge RF-GE0-RF-GE5 authoring evidence accepted; RF-GE6 and OS authority/privacy gates planned before activation
---

# Genesis Ecology WebGPU OS Plan

WebGPU OS turns the Engine's Genesis Ecology substrate into a governed service.
The OS owns admission, authority, private storage, immutable artifacts, process
lifecycle, resource ceilings, promotion, revocation, networking, and recovery.
RealmForge and Editor author descriptions. AGI proposes candidates. Plauna and
The Virtual Realm consume projections. None of those consumers becomes the
canonical owner.

Read [Genesis Ecology](../concepts/genesis-ecology.md) and the
[Engine and ECS plan](../engine/genesis-ecology-engine-plan.md) first. The
Virtual Realm execution order is expanded in
[M2 runtime foundation](virtual-realm/m2-runtime-foundation.md),
[M3 living city runtime](virtual-realm/m3-living-city-runtime.md), and
[Cityform encounter runtime](virtual-realm/cityform-encounter-runtime.md).

## Service shape

```text
Versioned contracts
  -> canonical compiler
  -> package and artifact admission
  -> immutable artifact store
  -> trusted operation interpreter
  -> dependency and resource scheduler
  -> operator-private Genesis state
  -> semantic promotion transaction
  -> ECS materialization
  -> redacted phenotype projections
  -> Plauna, Virtual Realm, and network consumers

AGI, culture, mutation, and Storylets
  -> candidate proposals and evidence only
  -> deterministic verifier
  -> semantic promotion transaction or rejection
```

The service is a flat group of injected peers. It is not a process with hidden
ambient access and not a nested organism manager.

## Implemented authoring prerequisites

RealmForge RF-GE2 supplies the data-only contract and Plan prerequisite for
later OS admission. Its separate constructive catalog contains exactly
`ProductGenomeV1`, `FactoryGenomeV1`, `GenomeRevisionReferenceV1`, and
`GenesisExecutionPlanV1`. Its shared operation matrix freezes `BUILD`, `BREAK`,
`REPAIR`, `FUSE`, `SPLIT`, `SPECIALIZE`, `GENERALIZE`, `RECOMBINE`, `RECYCLE`,
and `MUTATE` cardinalities, policies, required stages and evidence, and expected
outputs.

`compileGenesisFactoryPlanV1()` validates Parts and genome graphs and derives a
canonical closure, Part order, Factory step DAG, ready groups, budgets, and
SHA-256 plan digest. `verifyGenesisFactoryPlanV1()` validates that digest and
requires canonical equality with a deterministic rerun of the same pure
compiler implementation.
The isolated `realmforge.genesis-ecology.constructive@2.0.0` pack pins exact
schema, validator, compiler, constructor, interpreter, stage, and variation-
operator descriptors and dependencies. It verifies self-digest-bound Factory
and Plan bindings against those exact coordinates without resolving them.

The bounded RF-GE3 authoring gate now layers process-local cache and recursive
package-candidate evidence over that prerequisite. `GenesisIncrementalPlanCacheV1`
isolates namespaces by exact audience, disclosure, and audience-scope identity
and binds the complete source, compiler, pack, policy, schema, migration,
numeric, capability, adapter, limit, and deterministic-feature context. An
exact source and context hit reuses the frozen verified Plan and binding
receipts without compiling or deterministically recompiling. Every non-exact
miss still runs the complete RF-GE2 compiler and verifier; only immutable
dependency-index fragment objects may be reused. Reverse-dependency metadata
supports bounded process-local invalidation but creates no persistent cache.

`prepareGenesisRecursivePackageCandidateV1()` revalidates the Parts and genome
graphs, trusted Factory and Plan bindings, inert packageable Plan, Factory
external-verification policy, Part closure, and external Interface surface. It
emits an ordinary digest-valid `GenesisPartV1` candidate and an internal
deterministic descriptor. Required build, test, privacy, resource, rollback,
and external-verification evidence remains explicitly uncollected, and the
candidate remains ineligible for publication. (Sources:
`webgpu-os/apps/realmforge/modeler/genesis/GenesisIncrementalPlanCacheV1.js`;
`webgpu-os/apps/realmforge/modeler/genesis/GenesisRecursivePackageCompilerV1.js`;
`webgpu-os/apps/realmforge/modeler/genesis/rf-ge3/index.js`.)

RF-GE4 then freezes ten typed development, regulation, homeostasis, causal-
closure, cognition, embodiment, inheritance, and reaction authored-program
kinds represented by the accepted twelve-record golden corpus, deterministically
compiles eight interpreter fragments, and seals an eighteen-descriptor inert
trust pack. RF-GE5
freezes eleven lineage, program-ecology, recognition, role, culture, quality-
diversity, variation/evolution, environmental-memory, lifecycle, and
organismality evidence-program records and deterministically compiles ten
evidence fragments against the exact verified RF-GE4 Plan, then seals a twenty-
one-descriptor inert trust pack. Both layers are
bounded, data-only, verification-only authoring evidence. Their providers expose
no execution, storage, publication, registry mutation, identity-mint, self-
modification, capability, or runtime-activation surface. (Sources:
`webgpu-os/apps/realmforge/modeler/genesis/GenesisEcologyAuthoredProgramsV1.js`;
`webgpu-os/apps/realmforge/modeler/genesis/GenesisEcologyInterpreterCompilerV1.js`;
`webgpu-os/apps/realmforge/modeler/genesis/GenesisEcologyInterpreterDomainPackV4.js`;
`webgpu-os/apps/realmforge/modeler/genesis/GenesisEcologyEvidenceProgramsV1.js`;
`webgpu-os/apps/realmforge/modeler/genesis/GenesisEcologyEvidenceCompilerV1.js`;
`webgpu-os/apps/realmforge/modeler/genesis/GenesisEcologyEvidenceDomainPackV5.js`.)

These prerequisites implement no OS service in the diagram below. Every plan is
marked `containsExecutableCode: false`, `authorityBearing: false`,
`grantsAuthority: false`, `runtimeActivation: false`, and
`executionStatus: not-executed`. The pack cannot resolve, install, or invoke a
host implementation; execute a Factory; persist or publish a plan; publish or
mutate an authored or persistent registry; or activate runtime state. RF-GE3
also cannot execute or collect runtime evidence, persist a cache or candidate,
publish or install a Part, or make the candidate eligible for publication.
RF-GE4 and RF-GE5 cannot reinterpret that candidate as execution evidence or
promote their authored/evidence programs into a live service.
Artifact admission, trusted operation interpretation, resource reservation,
promotion, rollback, ECS materialization, and projection remain the planned OS
gates on this page. (Sources:
`webgpu-os/apps/the-virtual-realm/genesis/contracts/GenesisConstructiveContractCatalogV1.js`;
`webgpu-os/apps/the-virtual-realm/genesis/contracts/GenesisGenomeContractPrimitivesV1.js`;
`webgpu-os/apps/realmforge/modeler/genesis/GenesisFactoryPlanCompilerV1.js`;
`webgpu-os/apps/realmforge/modeler/genesis/GenesisEcologyConstructiveDomainPackV2.js`;
`webgpu-os/apps/realmforge/modeler/genesis/rf-ge2/index.js`.)

The canonical cross-track state and next-gate order are recorded in the
[Genesis Ecology program continuity ledger](../concepts/genesis-ecology.md#program-continuity-ledger).
The checked-in M1C/RF-GE5 freeze ledger is acceptance evidence; historical task
summaries are provenance pointers only. The next RealmForge authoring gate is
RF-GE6 projection grammar and reviewed world kits. No OS or Virtual Realm
runtime gate advances merely because RF-GE6 planning or authoring proceeds.

## Composition and boot order

Genesis is constructed after cryptography, storage, trust, packages, and
permissions, and before user-facing projections consume it. The composition
root injects:

- operator context and generation;
- capability and rule-graph ports;
- semantic transaction and provenance ports;
- operator-private storage and immutable content storage;
- package admission and trusted-operation registry;
- process, worker, CPU, GPU, and memory budget ports;
- Engine CSE and ECS projection ports;
- event, checkpoint, replay, and rollback ports;
- network publication and verification ports;
- telemetry with private-data redaction.

Genesis registers as an operator lifecycle participant. Freeze, drain, handoff,
rebind, resume, revocation, and disposal are generation-fenced. Work from a stale
operator generation fails closed. (Sources: `webgpu-os/kernel/OperatorContext.js`;
`webgpu-os/kernel/KernelBootstrap.js`; `webgpu-os/index.js`.)

Factory receives Genesis as parallel injected services and the shared ECS port
where materialization is required. Factory does not own lifecycle or authority.
Adding an internal kernel service does not require changing the exact public app
parts barrel solely to make the service exist. (Sources:
`webgpu-os/factory/index.js`; `tests/factory/app-parts-contract.html`.)

## Flat service peers

- `GenesisContractCatalog`
- `GenesisCanonicalCompiler`
- `GenesisArtifactAdmissionService`
- `GenesisArtifactStore`
- `GenesisOperationRegistry`
- `GenesisOperationInterpreter`
- `GenesisResourceLedger`
- `GenesisDependencyScheduler`
- `GenesisPrivateStateStore`
- `GenesisPromotionCoordinator`
- `GenesisCheckpointCoordinator`
- `GenesisProjectionRedactor`
- `GenesisPublicPhenotypePublisher`
- `GenesisNetworkExchangePort`
- `GenesisLifecycleParticipant`
- `GenesisDiagnostics`

Only the OS composition root constructs concrete peers. A compiler does not open
storage. A store does not execute recipes. A projection service does not grant
authority. A network publisher does not inspect private state.

## Virtual Realm M2-M6 integration deltas

The present OS has useful primitives but not a Virtual Realm runtime. These
changes are dependencies, not assumed existing features:

| OS area | Existing owner | Required addition | Milestone |
| --- | --- | --- | --- |
| App discovery | `webgpu-os/kernel/AppRegistry.js` | Virtual Realm manifest, side-effect-free entry, guarded port namespace, and process ownership | M2 |
| Kernel composition | `webgpu-os/kernel/KernelBootstrap.js` | Flat Realm/Genesis service bundle after crypto, storage, admission, and permissions | M2 |
| Operator lifecycle | `webgpu-os/kernel/OperatorContext.js` and `webgpu-os/kernel/AppRegistrationScope.js` | Register Realm participant before activation; generation-fence start, switch, close, and disposal | M2 |
| Stable runtime | `webgpu-os/bootstrap/StableBootstrap.js`, `webgpu-os/platform/runtime-host/StableRuntimeHost.js`, and `webgpu-os/platform/runtime-host/KernelRuntimeHandoff.js` | Serializable Realm roots, safe anchor, cursor/checkpoint identities, and no live handles | M2/M3 |
| Artifact publication | RealmForge publisher plus `webgpu-os/storage/RealmContentStore.js` | Exact immutable write/readback, active-root read, compare-and-swap, owner partitions, and crash recovery | M2 |
| Frame/surface | `webgpu-os/kernel/GpuFrameCoordinator.js` | One Realm surface, one coordinated producer, lifecycle-safe staging owner, and resource ledger | M2 |
| OS observations | Process, VFS, syscalls, permissions, storage, boot, and network owners | Generation/sequence ledger and sanitized snapshot/subscription adapters before Realm projectors | M3 |
| Private history | Operator-private storage | Encrypted Realm cursor/checkpoint/Chronicle/Genesis layout and retention | M3 |
| Public shell transport | Owner-scoped content fetch | Transport verifier distinct from local compiler admission; bounded reassembly, expiry, revocation, and operator-scoped cache | M4 |
| SecureMesh exchange | `webgpu-os/drivers/NetworkDriver.js` and RealmLink | Kernel-owned `VirtualRealmNetworkExchangePort` with a minimal wire allowlist; no generic app networking | M5 |
| Network retention | `webgpu-os/platform/network-host/StableNetworkHost.js` | Replace array-front removal with a bounded ring before pose traffic | M5 |
| Feature gates | Realm network feature policy | Separate shell, presence-session, Traveler, rendezvous, docking, and bridge flags | M4-M6 |
| Operations UI | `plauna/core/StateStore.js`, `plauna/core/BindingEngine.js`, `plauna/core/DirtyGraph.js`, and workspace peers | Owner-private indexed/batched read model and one local Operations workspace built before scene assembly | M2/M3 |
| AGI shadow | AGI checkpoint, graph, program, and memory planners | Capability-free deterministic candidate/evidence port; no promotion, storage mutation, ECS mutation, or publication authority | M3-GE |

The OS exposes narrow generation-fenced ports, not concrete kernel managers.
The Virtual Realm application never receives raw peer messages, generic mesh
send, signing keys, capability tokens, storage drivers, mutable process tables,
or the GPU host.

## Capability model

Capabilities remain explicit and separate:

| Capability class | Example purpose | Never implies |
| --- | --- | --- |
| Author | Create or revise data-only genome and recipe descriptions | Execute or publish |
| Inspect private | Read exact local Genesis state under operator scope | Mutate or disclose |
| Compile | Produce a candidate plan from admitted descriptions | Activate it |
| Evaluate | Run bounded tests or simulations | Treat result as truth |
| Execute operation | Invoke one trusted constructive opcode with bounded arguments | Replace policy or interpreter |
| Promote | Request semantic activation of one verified candidate | Mint identity |
| Mint identity | Issue a Soul Seed root after the separate policy gate | General package or network authority |
| Publish projection | Publish one signed audience-safe phenotype | Publish private genome or source |
| Exchange culture | Transport explicitly public cultural motifs and receipts | Read local belief space |
| Manage local ecology | Submit owner-local lifecycle and zone proposals | Manage another Cityform |

Permissions default to deny. UI visibility, role recognition, organismality,
fitness, reputation, proximity, a Storylet, or possession of a public shell does
not create a capability. (Sources: `webgpu-os/kernel/Permissions.js`;
`webgpu-os/kernel/RuleGraph.js`;
`webgpu-os/packages/CapabilityMap.js`.)

## Trusted operation interpreter

Canonical recipes contain operation IDs and closed bounded arguments, never
JavaScript functions, source strings, dynamic imports, URLs, syscall handles,
GPU handles, or capability tokens.

RF-GE2 already validates the following vocabulary as inert constructive-plan
data. The future OS trusted registry and interpreter will resolve and execute
only separately admitted host operations:

`BUILD`, `BREAK`, `REPAIR`, `FUSE`, `SPLIT`, `SPECIALIZE`, `GENERALIZE`,
`RECOMBINE`, `RECYCLE`, and `MUTATE`.

Each operation declares:

- versioned input and output schemas;
- required capabilities;
- resource dimensions and ceilings;
- determinism class;
- allowed worker or GPU partitions;
- failure, compensation, cancellation, and timeout policy;
- evidence and receipt requirements;
- cacheability and invalidation rules;
- lifecycle and disposal obligations.

Execution passes through guarded syscalls and the process owner scope. A factory
genome can select and compose admitted operations; it cannot replace the
assembler, schema migrator, package verifier, capability checker, promotion
coordinator, or operation registry. (Sources: `webgpu-os/kernel/Syscalls.js`;
`webgpu-os/kernel/AppRegistrationScope.js`.)

If user-authored executable code is ever added later, it uses the existing
opaque sandboxed realm and nonce-guarded RPC boundary. Declarative recipes plus
trusted operation IDs remain the preferred design. (Source:
`webgpu-os/shell/PackageHostRealm.js`.)

## Package and artifact admission

Package Manager remains the executable-artifact chokepoint. Admission verifies:

- exact schema and supported version;
- canonical digest and dependency closure;
- signature and signing lineage;
- provenance and publisher trust policy;
- requested capabilities and rule-graph result;
- compiler and operation-set compatibility;
- device and numeric profile compatibility;
- resource limits and lifecycle declarations;
- public/private/refinement classification;
- revocation state.

Package revocation invalidates dependent compiler, plan, operation, and
projection caches. Behavioral scores do not substitute for provenance. (Sources:
`webgpu-os/packages/PackageManager.js`;
`webgpu-os/packages/PackageLoader.js`;
`webgpu-os/kernel/ProvenanceChecker.js`;
`webgpu-os/kernel/SigningLineage.js`.)

## Protocol compatibility

Peers negotiate contract, compiler, operation-set, projection, and evidence
versions before exchanging or executing Genesis artifacts. Unknown future
versions fail closed unless explicitly negotiated.

Descriptor hashes bind the complete visible interface. Negotiation does not
grant the capability it describes. (Sources:
`webgpu-os/kernel/protocol/CapabilityNegotiator.js`;
`webgpu-os/kernel/protocol/ParticleRealmsProtocol.js`;
`webgpu-os/kernel/attestation/CapabilityAttestation.js`;
`webgpu-os/kernel/attestation/DescriptorHashStore.js`.)

## Storage ownership

### Operator-private state

The operator-scoped store contains encrypted or access-controlled:

- Soul Seed private material and private lineage details;
- active genome and factory heads;
- epigenome, homeostasis, learner, role, and local cultural state;
- mutation and candidate history;
- exact resource ownership and reservations;
- local Cityform management state;
- private checkpoints and event-segment references.

Records are sharded by stable identity and logical epoch, not runtime operator
generation. Every dispatch verifies the current generation. The operator
generation itself is not persisted as domain truth. (Sources:
`webgpu-os/kernel/OperatorStorageView.js`;
`webgpu-os/storage/AppSandbox.js`.)

The sandbox has finite record and plaintext limits, so organism state is not one
ever-growing document. Event segments, checkpoint manifests, immutable content,
and bounded current heads are separate records.

### Immutable content

`RealmContentStore` holds content-addressed:

- compiled plans and reusable plan fragments;
- admitted parts and recursively packaged assemblies;
- public geometry and HLOD;
- redacted phenotype capsules;
- immutable evidence and branch heads appropriate to the store's audience.

Raw private genome, epigenome, private source, keys, and private cultural state
do not enter shared content merely because they can be hashed. The content store
receives operator-scoped storage through injection. (Source:
`webgpu-os/storage/RealmContentStore.js`.)

### Durable transactions

Storage uses atomic or compare-and-swap writes, canonical digests, schema
versions, recovery journaling, and verified primary/backup promotion. Append-only
event segments plus periodic checkpoints avoid rewriting complete histories.
(Sources: `webgpu-os/storage/StorageManager.js`;
`engine/core/save/SaveSystem.js`.)

## Semantic promotion transaction

`SemanticTransaction` is the OS promotion primitive for build, repair, fusion,
recombination, recycling, phenotype replacement, dormancy, and rollback.

The promotion sequence is:

1. Preview exact semantic and resource changes.
2. Bind expected state, genome, compiler, policy, operation-set, and operator
   generations.
3. Reverify capabilities, signatures, dependencies, budgets, and conflicts.
4. Verify candidate evaluation and last-good rollback references.
5. Commit immutable heads and resource changes atomically.
6. Emit a hash-bound promotion receipt and external-effect intents.
7. Project the accepted state into Engine ECS at its deterministic barrier.
8. Confirm the post-barrier observation before publishing success.

Undo is a new semantic transition, not deletion of history. (Source:
`webgpu-os/kernel/execution/SemanticTransaction.js`.)

The Engine CSE multi-store atomicity blocker must be resolved before the OS treats
Genesis promotion as authoritative. OS semantic promotion and Engine CSE commit
must share one prepare/commit protocol or a recoverable saga with exact fencing;
neither may report success while the other remains partial.

## Checkpoint, replay, rollback, and handoff

A Genesis checkpoint binds:

- stable identity and current semantic root;
- genome, epigenome, phenotype, resource, role, culture, and lifecycle heads;
- logical clocks and deterministic stream cursors;
- event-segment head and causal parents;
- compiler, operation-set, schema, policy, and evaluator versions;
- immutable dependency manifest;
- ECS materialization digest;
- rollback target and recovery policy.

Replay verifies the chain and uses the same compiler and operation versions.
Runtime handoff carries only serializable stable IDs, checkpoint hashes, event
cursors, versions, and cache descriptors. It never carries keys, sockets,
storage handles, GPU handles, surfaces, or live capability objects. (Sources:
`webgpu-os/kernel/time/CheckpointManager.js`;
`webgpu-os/kernel/time/ReplayEngine.js`;
`webgpu-os/platform/runtime-host/KernelRuntimeHandoff.js`.)

## Scheduling and resource accounting

The OS reuses the existing dependency and parallel schedulers, but Genesis adds:

- dangling-dependency and cycle rejection;
- stable ready-set ordering;
- abort, cancellation, timeout, and generation fencing;
- exact per-step host memory, GPU memory, CPU, GPU, storage, bandwidth, entity,
  graph, queue, and wall-budget measurements;
- reservations acquired before allocation;
- atomic release or rollback on failure;
- deterministic result publication independent of completion order;
- owner-scoped process cleanup and suspension.

`ProcessTable` telemetry remains useful for operator visibility, but its sampled
CPU, DOM, and heap values are not exact recipe resource truth. (Sources:
`webgpu-os/kernel/time/DependencyScheduler.js`;
`webgpu-os/kernel/time/ParallelTaskScheduler.js`;
`webgpu-os/kernel/ProcessTable.js`.)

## GPU admission

Every Genesis compute or render producer registers with `GpuFrameCoordinator`
under an owner, surface, operator generation, visibility, priority, cadence, and
budget. Hidden or distant projections can be throttled or suspended, but
correctness-critical development and repair cannot depend on spare frame time.

Recipe code never holds a raw GPU device, surface, or subsurface. GPU loss
invalidates device-bound plans and produces a recoverable lifecycle event.
Canonical promotion uses only declared determinism classes with CPU/reference
parity evidence. (Sources: `webgpu-os/kernel/GpuFrameCoordinator.js`;
`webgpu-os/kernel/SurfaceManager.js`.)

## Network and public phenotype

The network receives signed, audience-safe products only:

- public phenotype projection;
- public geometry and accessibility envelope;
- opaque artifact and lineage-head references;
- exact public role and status fields;
- explicitly public cultural motifs;
- capability attestations and connection receipts.

It does not receive private genome, epigenome, source, filesystem topology,
belief space, learner state, mutation history, resource ownership, or private
factory evidence.

Sessions are owner-scoped and released on process or operator teardown. Stable
network clients freeze, rebind, and resume across operator generations under
bounded retention. A remote public projection is verified before The Virtual
Realm stages it. (Sources: `webgpu-os/drivers/NetworkDriver.js`;
`webgpu-os/platform/network-host/StableNetworkClient.js`;
`webgpu-os/platform/network-host/StableNetworkHost.js`.)

## Factory integration

Factory contributes reusable discovery and composition mechanisms:

- typed provides/consumes indexes;
- provider and consumer compatibility;
- part co-occurrence as one weak symbiosis feature;
- preflight and reverse-order compensation;
- bounded channels for observable projections;
- compositor surfaces for inspectors and controls.

Genesis adds a parallel `GenesisPartV1` contract instead of overloading UI
`PART_TYPES`. Canonical recipe records prohibit raw executable behavior.
Unsatisfied, duplicate, ambiguous, or incompatible providers are fatal at
compile time. Pairwise co-occurrence is not causal fitness or organismality
proof. Mutable contribution trust remains advisory UI reputation and cannot
admit or execute a recipe. (Sources:
`webgpu-os/factory/registry/types.js`;
`webgpu-os/factory/registry/capabilities.js`;
`webgpu-os/factory/registry/co-occurrence.js`;
`webgpu-os/factory/contributions/loader.js`.)

High-rate ecology channels replace repeated array shifting with bounded fixed
ring buffers while preserving explicit backpressure and dropped-event metrics.

## Editor integration

Editor adds thin registered tools rather than expanding its main application
into a Genesis coordinator:

- product and factory genome graph;
- part and interface editor;
- development and regulatory graph;
- homeostasis and reaction rule editor;
- repair and variation operator editor;
- lineage and QD archive browser;
- role and cultural topology editor;
- candidate diff, test, resource, receipt, and bake inspector.

Project layouts gain Genesis folders through an explicit versioned migration.
Asset Registry gains immutable artifact types. Scenes reference compiled
artifacts by digest; scene wires are not executable recipe ports. AutoSave and
method wrapping are not the canonical transaction log. Exports include admitted
artifacts and public receipts, never private runtime state. (Sources:
`editor/js/ProjectManager.js`; `editor/js/project/AssetRegistry.js`;
`editor/js/project/AutoSave.js`; `editor/js/project/ProjectExporter.js`.)

The material, audio, and MATS graph editors provide clean interaction patterns
for nodes, typed ports, wires, minimaps, history, import, and export. Genesis
uses its own exact contract and compiler because existing authoring graphs may
tolerate type mismatch or partial ordering that a constructive plan must reject.

## Plauna integration

Plauna stores and renders redacted read models only:

- local ecology status and alerts;
- recipe queue and evaluation summaries;
- genome and phenotype diffs appropriate to the operator;
- lineage, QD, role, culture, and lifecycle summaries;
- owner-private Cityform Operations panels and minimap;
- public phenotype and connection status.

Projection updates are batched. Large ecologies require indexed path-pattern
subscriptions and reverse computed-dependency indexes instead of full scans.
Dirty propagation and rAF scheduling remain presentation mechanisms and never
advance canonical simulation. Per-view and per-generation GPU resources are
cached and disposed through the workspace lifecycle. (Sources:
`plauna/core/StateStore.js`; `plauna/core/BindingEngine.js`;
`plauna/core/DirtyGraph.js`; `plauna/workspace/WorkspaceManager.js`.)

## AGI integration

AGI is a shadow proposal and evaluation plane:

- candidate scoring and curriculum;
- learned proposal generation;
- quality-diversity descriptor models;
- regulatory and developmental policy experiments;
- resource, performance, repair, and niche prediction;
- cultural model and role hypothesis generation.

Existing PPO and experience paths use nondeterministic randomness or telemetry
time and are not canonical evolution. QD, MAP-Elites, regulatory genomes,
epigenomes, organismality, role ecology, and cultural selection are new isolated
services rather than aliases for scalar reward. (Sources:
`agi/brain/ExperienceBuffer.js`; `agi/brain/trainers/PPOTrainer.js`;
`agi/core/CurriculumManager.js`.)

Useful mechanisms to reuse include strict checkpoint contracts, bounded training
state channels, cached graph topology, parallel program compilation, prewarming,
tensor lifetime planning, static memory preflight, and bind-group caches. Recipe
identity uses a canonical cryptographic digest rather than a 32-bit cache hash.
(Sources: `agi/persistence/CheckpointContracts.js`;
`agi/particle_voice/nn/core/ParticleProgram.js`;
`agi/particle_voice/nn/memory/TensorLifetimePlanner.js`;
`agi/llm/inference/StaticMemoryPlanner.js`.)

Every AGI output carries inputs, model and policy versions, deterministic or
nondeterministic classification, confidence, resource use, and evidence. It
enters the candidate verifier and cannot directly mutate CSE, ECS, packages,
permissions, or public projections.

## Storylet integration

The current Storylet eligibility and failure patterns can narrow episodes and
support trusted compensation. A Genesis-neutral deterministic episode contract
adopts definition hashing, injected logical clocks, compare-and-swap revisions,
and proposal-only transitions. Forced transitions remain trusted-only. (Sources:
`webgpu-os/kernel/storylets/StoryletRuntime.js`;
`webgpu-os/kernel/storylets/NaviTaskEpisodeRuntime.js`.)

The Virtual Realm's accepted data-only Storylet system remains the world-facing
boundary. Rich Role Algebra lowers to those safe artifacts; it does not import a
Navi task runtime as world authority.

## Privacy classification

| Data | Default class | Public form when allowed |
| --- | --- | --- |
| Soul Seed public root | Operator-private until minted/publication policy allows | Opaque signed continuity ID |
| Secret seed material | Secret | Never public |
| Product/factory genome | Private | Non-reversible public phenotype only |
| Epigenome/homeostasis | Private | Explicit coarse status fields only |
| Source/filesystem | Private | Prebaked silhouette; exact Code Matter only by lease |
| Lineage | Private or relationship-sensitive | Opaque head or selected public ancestry |
| Role | Audience-scoped | Explicit public role receipt fields |
| Culture/beliefs | Private and social-sensitive | Explicitly published motifs with attribution |
| Candidate and mutation history | Private | Selected public provenance receipt |
| Organismality evidence | Private by default | Explicit signed assessment summary |
| Public phenotype | Public artifact | Complete prebaked shell without private closure |

## Cross-stack performance plan

1. Canonicalize and hash each input revision once.
2. Compile one strict DAG with no dangling, ambiguous, incompatible, or partial
   ordering.
3. Cache per-node, subgraph, plan, pipeline, bind-group, geometry, HLOD, and
   projection products under complete cryptographic keys.
4. Execute independent branches through the existing parallel scheduler and
   publish results in deterministic order.
5. Use a versioned compiler worker protocol; do not overload storage-worker
   task names silently.
6. Prewarm admitted GPU programs and preflight tensor/resource lifetimes.
7. Register and budget every active GPU producer.
8. Persist event segments and periodic checkpoints instead of rewriting complete
   organism histories.
9. Batch Plauna updates and index subscriptions/dependencies.
10. Use ring buffers for high-rate telemetry.
11. Separate exact recipe accounting from approximate process telemetry.
12. Throttle presentation by visibility without changing canonical clocks.

The current bounded RF-GE3 cache proves only exact verified Plan reuse and
reverse-dependency metadata. It makes no semantic partial-compilation speed
claim: every cold or changed-source miss still performs the full compiler and
deterministic verifier path. The broader indexed-digest, scheduler, persistent-
artifact, and runtime invalidation work in this performance plan remains gated.

## Migration order

| OS gate | Deliverable | Required proof |
| --- | --- | --- |
| OS-GE0 | Contracts, canonicalization, capability matrix, privacy classes, seed/tick rules | Exact vectors, future-version rejection, hostile input tests |
| OS-GE1 | Private store, immutable artifacts, event/checkpoint/receipt ledger | CAS, recovery, encryption, operator-switch, stale-generation tests |
| OS-GE2 | Trusted operation registry, interpreter, exact resource meter | Illegal opcode, package, capability, budget, compensation tests |
| OS-GE3 | Semantic promotion, CSE/ECS barrier handshake, rollback | Atomic failure injection, replay, undo, last-good tests |
| OS-GE4 | Scheduler, workers, GPU admission, process ownership, handoff | Async, cancellation, device loss, generation, deterministic-order tests |
| OS-GE5 | RealmForge, Factory, and Editor authoring and admission | Schema, graph, package, provenance, export tests |
| OS-GE6 | Redaction, Plauna inspector, local Operations tools | Private/public noninterference and local-only closure tests |
| OS-GE7 | Virtual Realm public phenotype and SecureMesh exchange | Signature, attestation, epoch, revocation, cache and shell tests |
| OS-GE8 | AGI shadow QD/evolvability and canary promotion | Proposal non-authority, verifier, quarantine, rollback tests |
| OS-GE9 | Organismality and higher-order mint policy | Evidence integrity, no-shortcut, abuse, lifecycle, recovery tests |

AGI evolution and mesh culture exchange do not begin before deterministic replay,
redaction, capability admission, and rollback are proven.

## Test gates

- canonical byte equality across input order and execution profile;
- deterministic replay equality and chunking-independent random streams;
- schema migration, downgrade policy, and unknown-future rejection;
- malicious records, illegal opcodes, dynamic-code, limit, and graph attacks;
- package signature, lineage, capability, and revocation denial;
- operator-switch and stale-generation write rejection;
- private/public/refinement cache and redaction noninterference;
- worker/main-thread and admitted CPU/GPU parity;
- dependency cancellation, timeout, local failure, and ordered publication;
- device loss, surface loss, process death, runtime handoff, and recovery;
- exact budget reservation, failure release, and compensation;
- checkpoint chain verification, replay, rollback, and semantic undo;
- network signature, attestation, protocol negotiation, epoch, and disposal;
- AGI, role, culture, Storylet, fitness, and organismality non-authority.

## Explicit non-goals

- Executing evolved arbitrary JavaScript or WGSL.
- Storing private genomes or epigenomes in shared public CAS.
- Treating Factory trust, co-occurrence, AGI reward, or organismality as package
  admission or capability authority.
- Driving canonical development from rAF, audio time, network arrival order,
  worker completion, or measured spare GPU time.
- Letting Editor scene links become executable recipe interfaces.
- Using Plauna state or OS app-state history as the biological archive.
- Passing live storage, GPU, network, signing, or secret handles through runtime
  handoff.
- Making RealmForge, Factory, Editor, AGI, Plauna, or The Virtual Realm the
  lifecycle owner of canonical Genesis state.
- Using First Shard source, tests, architecture, runtime, or dependencies.

## OS acceptance definition

The WebGPU OS portion is complete when it can admit a signed declarative recipe,
compile and execute only trusted bounded operations, reserve exact resources,
store private and immutable state in the correct scopes, atomically promote or
roll back a candidate, rematerialize ECS, survive operator and runtime handoff,
publish a signed noninterfering public phenotype, revoke every dependent cache
and session, and prove that no advisory system can cross the authority boundary.

## See also

- [Virtual Realm M2 Runtime Foundation](virtual-realm/m2-runtime-foundation.md)
- [Virtual Realm M3 Living City Runtime](virtual-realm/m3-living-city-runtime.md)
- [Virtual Realm World Districts and Facilities](virtual-realm/world-districts.md)
- [Virtual Realm Cityform Encounter Runtime](virtual-realm/cityform-encounter-runtime.md)
- [Virtual Realm M2 Engine and ECS Foundation](../engine/virtual-realm-m2-engine-foundation.md)
