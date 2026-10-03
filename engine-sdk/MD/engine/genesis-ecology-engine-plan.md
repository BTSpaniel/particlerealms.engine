---
title: Genesis Ecology Engine and ECS Plan
description: Detailed Engine plan for the generic recipe kernel, ECS data layout, multirate systems, transactional structural change, persistence, scheduling, evaluation, and performance.
updated: 2026-08-28
status: implementation plan; current Engine behavior remains authoritative until each gate passes
---

# Genesis Ecology Engine and ECS Plan

Genesis Ecology is an Engine-wide upgrade. It does not replace the Engine with
an organism simulation. It adds reusable construction, development, regulation,
ecology, and evidence mechanisms to the existing ECS, state, scheduler, GPU,
render, persistence, simulation, and tooling boundaries.

The canonical model and security rules are in
[Genesis Ecology](../concepts/genesis-ecology.md). RealmForge uses this substrate
through [RealmForge Genesis Ecology](../webgpu-os/realmforge-genesis-ecology.md),
and The Virtual Realm consumes admitted projections through the
[Virtual Realm integration](../webgpu-os/virtual-realm/genesis-ecology-integration.md).
The exact prerequisite order and file-level M2 gates are frozen in
[Virtual Realm M2 Engine and ECS Foundation](virtual-realm-m2-engine-foundation.md).

## Current Engine baseline

The plan begins from the code that exists rather than designing a second Engine.

| Area | Current behavior | Consequence for the upgrade |
| --- | --- | --- |
| World | Signed bit-packed generational runtime handles; fixed simulation time; five default phases; serial system stepping; per-system timing | Preserve the public entity API where compatible, replace unsafe internal packing with validated positive safe-integer handles, keep persistent identity separate, and add explicit clock domains and a structural barrier |
| System registry | Stable topological order within phases using `before` and `after`; cycles fall back to stable order | Add strict opt-in cycle rejection, access declarations, and parallel ready sets |
| Archetype storage | Entity arrays plus JavaScript component arrays; swap removal; entity moves between archetypes | Evolve the owner to chunked/typed lanes without changing public entity identity |
| Query | Caches matching archetypes by storage version; `forEachEntity` snapshots each entity array and allocates per-entity helpers | Preserve compatibility and add allocation-free chunk/column iteration |
| Component registry | Defaults, normalization, validation, migration, and schema registration | Add optional storage, serialization, visibility, and write-policy metadata |
| Snapshot | Captures world debug/time/config/entity-table state | Add complete versioned component, clock, journal, and active-plan state |
| Persistence | Version 1 world and `worldSim` payload | Introduce a validated version 2 envelope with migration and atomic restore |
| Particle recipe | Closed schema, typed graph, size limits, canonical order, digest, diff impact, last-good plan | Extract reusable recipe mechanics and keep a particle adapter |
| Task scheduler | Frame-budget queues, priorities, idle work, and an internal WorkerPool; blocked and Promise-returning job correctness must be fixed before authority work | Keep it presentation/background-only until its correctness gate, then expose narrow scheduler ports without adding another global scheduler |
| Worker layer | A second standalone WorkerPool also exists | Consolidate behavior through one compatibility port before removal decisions |
| GPU scheduler | Priority compute work and frame-budget awareness | Run bounded data-parallel evaluation, never authority or canonical policy |
| Fact store | Monotonic facts plus tombstone revocation and order-independent roots | Record lineage, evidence, and lifecycle facts without destructive history edits |
| Commit coordinator | Capability, fencing, causal, idempotency, fact, and output checks exist, but current mutation can precede awaited signing/log completion | Add effect-digest binding and a complete staged-store swap before treating it as exception-safe semantic authority; project accepted changes into ECS afterward |
| State-first renderer | Read-only Transform and Renderable projection with dirty metadata | Reuse the pattern for phenotype visuals; do not make rendering semantic truth |

(Sources: `engine/ecs/world/World.js`;
`engine/ecs/systems/SystemRegistry.js`;
`engine/ecs/storage/ArchetypeStorage.js`; `engine/ecs/query/Query.js`;
`engine/ecs/components/ComponentRegistry.js`;
`engine/ecs/world/WorldPersistence.js`;
`engine/sim/particles/recipe/ParticleRecipeGraph.js`;
`engine/state/transaction/CommitCoordinator.js`;
`engine/render/state/StateFirstEcsSourceAdapter.js`.)

## Canonical truth boundary

The existing state stack is the clean-room foundation for a production Causal
State Engine:

- `EntityRegistry` owns stable versioned entity content;
- `FactStore` owns monotonic facts and tombstones;
- `Transaction`, `ProposalPool`, and `CommitCoordinator` own proposal,
  conflict, capability, causal, fencing, and commit semantics;
- `USORegistry` owns single-spend resources where conservation matters;
- `SimulationClock` owns independent deterministic clocks;
- `PredictionSandbox` and `BeliefStore` keep predicted state noncanonical;
- `SchemaEvolutionRegistry` owns version planning and pure migrations;
- `EventLog`, `Checkpoint`, `StateRoot`, and `SaveSystem` supply evidence and
  durable-write patterns.

(Sources: `engine/state/entity/EntityRegistry.js`;
`engine/state/transaction/ProposalPool.js`;
`engine/state/transaction/CommitCoordinator.js`;
`engine/state/uso/USORegistry.js`; `engine/state/time/SimulationClock.js`;
`engine/state/worldmodel/PredictionSandbox.js`;
`engine/core/schema/SchemaEvolutionRegistry.js`.)

CSE records are canonical. ECS is a rebuildable materialization optimized for
queries and systems. An accepted CSE transition projects into ECS at a barrier;
an ECS value never silently rewrites a canonical genome, lineage, or resource
head.

The current Engine bootstrap labels the state namespace as Playground-only.
Genesis must clean-room the proven state patterns into a side-effect-free
production composition and export boundary. It must not depend on Playground
registration or boot behavior. (Source: `engine/EngineBootstrap.js` lines
935-950.)

## GE0-GE2 correctness blockers

These issues are prerequisites, not optional optimizations:

1. ECS runtime handles are not persistent identity. The packed 20-bit entity
   index leaves a bitwise generation field that eventually becomes negative
   and can wrap. Soul Seed and Eidos identity require separate stable IDs.
2. `destroyEntity()` does not currently remove the entity's archetype row.
   Destruction cleanup must become exact before lifecycle and recycling are
   authoritative.
3. World capture is a debug snapshot, defaults to a bounded entity-table view,
   and omits components, clocks, RNG, systems, and native descriptors. It cannot
   be called rollback.
4. `stepWorld()` and `stepWorldFrame()` duplicate execution and continue after
   system exceptions. Authoritative Genesis stages need one executor with an
   abort/rollback failure policy.
5. `TaskScheduler` can drop a dependency-blocked popped job and can mark a
   Promise-returning callback complete without awaiting it. Canonical work must
   not use that path until dependency retention, async completion, cancellation,
   timeout, and generation fencing are fixed.
6. `CommitCoordinator` mutates multiple stores before awaited signing and event
   publication. A later exception can leave a partial logical commit. Genesis
   authority requires staged immutable-store swap or prepare/apply/undo.
7. `WorldDynamics` reseeds its RNG on each `run()` call, so one two-step run can
   differ from two one-step runs. Randomness must derive from seed, domain, and
   logical tick or persist its cursor.
8. Nested canonical entity content is frozen only at the record boundary.
   Canonical content must be cloned and deeply frozen or stored immutably.
9. Direct component writes, physics writeback, and mutable component references
   bypass future dirty and revision tracking. Genesis-affecting writes must use
   journaled value or structural commands.

(Sources: `engine/ecs/world/World.js`;
`engine/core/scheduler/TaskScheduler.js`;
`engine/state/transaction/CommitCoordinator.js`;
`engine/state/sim/WorldDynamics.js`; `engine/state/entity/EntityRegistry.js`;
`engine/ecs/systems/PhysicsSystem.js`.)

## Engine ownership map

| Engine owner | Planned responsibility | Does not own |
| --- | --- | --- |
| Recipe kernel | Generic validation, canonicalization, digest, diff, dependency, cache, compile evidence | Domain meaning or authority |
| ECS world | Active entity/component projection, logical clocks, deterministic structural barrier | Authored genome documents or package policy |
| ECS storage | Hot/cold component layout, chunks, generations, dirty ranges | Persistent content store |
| ECS query | Deterministic entity and chunk views | Mutation during iteration |
| ECS system registry | Phase ordering, access graph, ready sets, cycle evidence | Worker implementation or WebGPU OS policy |
| State subsystem | Facts, causal relationships, transactions, authority receipts | Rendering |
| Scheduler ports | CPU worker and GPU evaluation dispatch | Canonical output ordering |
| Persistence | Complete save/restore envelope and migration | Authority to activate an unverified save |
| Simulation adapters | Bounded evaluation environments and resource accounting | Candidate activation |
| Render adapters | Read-only phenotype and ecology instances | Truth inference or source access |
| Engine bootstrap | Stable exports and opt-in composition helpers | Automatic boot or hidden global activation |

## Generic recipe kernel

### Extraction boundary

The particle recipe module remains the compatibility API. Shared mechanics move
behind it into a domain-neutral Engine layer:

- graph envelope and limit validation;
- typed node, port, edge, interface, and constraint primitives;
- deterministic canonicalization;
- canonical digest and subgraph digests;
- deterministic dependency order and parallel ready sets;
- validated-revision identity;
- change-impact classification;
- plan-fragment cache;
- last-good plan retention;
- compile and verification evidence.

Particle node families, parameters, settings, subsystem bindings, and runtime
adapter behavior remain in the particle domain. RealmForge and Genesis Ecology
supply their own registries and adapters. The generic layer cannot import those
domains.

### Current hot paths

The existing particle compiler provides a concrete benchmark corpus. Its
current plan build:

- validates the incoming graph;
- hashes through normalization;
- normalizes previous and next graphs during change classification;
- repeatedly sorts and shifts the ready queue;
- filters all edges for every compiled node;
- repeatedly stable-stringifies values during comparison.

(Source: `engine/sim/particles/recipe/ParticleRecipeGraph.js` lines 944-1096.)

The optimized path builds one indexed validated revision:

```text
Parsed input
  -> closed validation
  -> canonical node/interface/edge tables
  -> incomingByNode + outgoingByNode + reverseDependencies
  -> node digests + subgraph digests + root digest
  -> previous-revision digest diff
  -> invalidated ready sets only
  -> reused + rebuilt plan fragments
  -> immutable plan and evidence
```

### Cache identity

Every cached plan or fragment key includes:

- source root digest and relevant subgraph digest;
- schema and migration version;
- compiler and domain-registry versions;
- policy and limit-profile versions;
- target capability and numeric profiles;
- audience and disclosure class when output can differ by audience;
- adapter version;
- deterministic feature flags.

Private, public, and refinement products never share an output cache namespace.
Reusable public inputs may share only when their full keys and source closures
are independently public.

### Ready-set compilation

Dependency order is canonical. Nodes in one ready set may compile concurrently
only when:

- their inputs are already fixed;
- they have no shared mutable compiler state;
- their registry definitions are immutable;
- the result array is restored to canonical node order;
- diagnostics are sorted by stable code and path;
- cancellation cannot publish a partial plan.

Concurrency is an execution optimization, not part of the canonical result.

## ECS storage evolution

### Hot, cold, and evidence data

| Storage class | Examples | ECS representation |
| --- | --- | --- |
| Hot numeric | signal levels, target error, resource quantity, clock counters, dirty flags | Fixed-width typed columns in archetype chunks |
| Hot small enum/reference | lifecycle state, stage, active plan index, role-state code | Typed scalar column or stable interned ID |
| Cold immutable | genomes, factory plans, grammars, policies, part closures | Content ID reference to immutable store |
| Bounded mutable | epigenetic marks, reaction candidates, role counters | Fixed-capacity buffers or side tables with explicit limits |
| Append-only evidence | lineage, receipts, Chronicle, assessment results | External journal/fact store referenced by head ID |
| Render projection | matrices, bounds, material/mesh IDs, visual state | Existing state-first render path plus Genesis visual components |

Large genomes, culture graphs, source, package bytes, and evidence histories do
not live as copied objects on every entity.

### Component definition metadata

The existing `defineComponentType` gains optional metadata while retaining
current defaults:

- `storageClass`: object, numeric column, fixed vector, interned reference, or
  bounded side table;
- `numericType` and `width` for typed columns;
- `serializeVersion`, `serialize`, and `migrate`;
- `visibilityClass` for private/public/refinement projection eligibility;
- `writePolicy`: direct value write, command-buffer-only structural write, or
  immutable reference replacement;
- `dirtyChannels` for render, save, network, inspector, and ecology indexes.

Legacy components continue to use object storage until explicitly migrated.

### Chunked archetypes

`ArchetypeStorage` remains the public owner. Internally it gains fixed-capacity
chunks and column descriptors. The migration must preserve:

- generational entity IDs;
- swap-remove semantics or an equivalently deterministic row relocation rule;
- exact component defaults and validators;
- direct component reads and writes;
- archetype query matching;
- existing public helper behavior.

Each structural or value mutation advances the relevant generations:

- archetype-set generation;
- archetype structural generation;
- chunk structural generation;
- component-column value generation;
- dirty range or dirty row set;
- world projection generation.

The current storage-wide version advances when an archetype is created. It is
retained for query-shape invalidation but is not sufficient for incremental save,
render, reaction, or network projection. (Source:
`engine/ecs/storage/ArchetypeStorage.js` lines 34-73.)

## Query API

The existing API remains:

```js
forEachEntity(world, query, callback)
```

The additive fast path is conceptually:

```js
forEachChunk(world, query, access, (chunkView) => {
  // stable entity IDs and declared column views
})
```

`chunkView` is valid only for the callback lifetime. It exposes only declared
read or write columns. A system cannot retain the view, change structure, add a
component, remove an entity, or access an undeclared column through it.

The current `forEachEntity` clones `archetype.entities` and constructs per-entity
access helpers. Compatibility keeps that safe behavior; hot Genesis systems use
chunk views after parity tests. (Source: `engine/ecs/query/Query.js` lines
91-132.)

## System access graph

System descriptors gain optional declarations:

- `reads`: component or resource channels;
- `writes`: component or resource channels;
- `structuralWrites`: entity/component topology commands;
- `clock`: fixed tick, regulation, homeostasis, behavior, learning,
  development, evolution, or culture;
- `determinism`: deterministic, seeded, evidence-only, or presentation-only;
- `workClass`: main-thread, worker-safe, GPU-evaluation, or external-port;
- `budgetClass`: critical, frame, background, or offline;
- `failurePolicy`: reject tick, retain prior output, disable system, or surface
  degraded evidence.

Explicit `before` and `after` constraints remain. Access conflicts add edges.
The scheduler emits stable parallel ready sets for disjoint systems and returns
their results in canonical system order.

Legacy schedules preserve the current stable fallback on cycles. A Genesis
strict schedule rejects a dependency cycle during registration or activation
and emits the complete cycle evidence instead of silently selecting fallback
order. (Source: `engine/ecs/systems/SystemRegistry.js` lines 54-141.)

## Structural command barrier

No developmental, metabolic, learning, role, cultural, or Storylet system may
move an entity between archetypes while a query is active.

Structural intent enters a command buffer containing:

- command kind and stable command ID;
- target entity and expected generation;
- expected world, topology, and active phenotype revisions;
- proposed component additions, removals, or immutable reference replacements;
- causal parent and authority receipt references;
- idempotency and fencing data;
- required preconditions;
- rollback or compensation reference.

The barrier executes after the relevant fixed simulation phase:

1. Freeze and sort commands canonically.
2. Reject duplicate, stale, conflicting, or unauthorized commands.
3. Apply accepted semantic transaction receipts.
4. Apply structural changes in stable entity and component order.
5. Update generations, indexes, and dirty channels.
6. Emit an ECS projection receipt and observation.
7. Dispose command payloads exactly once.

The state `CommitCoordinator` remains the semantic authority boundary. The ECS
barrier is its in-memory projection boundary, not a replacement. Renderers and
Storylets report success only after the post-barrier observation exists.

## Planned reference components

These components carry immutable IDs or bounded state. Names reserve distinct
responsibilities; they are not one nested organism component.

| Component | Contents |
| --- | --- |
| `SoulSeedRef` | Immutable identity-root and mint-receipt IDs |
| `EidosId` | Stable causal identity mapped independently from the runtime ECS handle |
| `LineageHeadRef` | Current append-only lineage head |
| `ProductGenomeRef` | Active product-genome content ID |
| `FactoryGenomeRef` | Active factory-genome content ID |
| `PhenotypeManifestRef` | Active admitted phenotype and activation receipt |
| `DevelopmentClock` | Current stage, epoch, due pulse, and deterministic stream position |
| `RegulatoryState` | Bounded signal/expression lanes and generation |
| `EpigenomeStateRef` | Immutable snapshot head or bounded mark-table reference |
| `HomeostasisState` | Target errors, controller state, recovery and health code |
| `ResourceState` | Bounded resource quantities, reservations, and generation |
| `ReactionCandidateState` | Bounded candidate-set reference and due epoch |
| `RoleEvidenceState` | Incremental evidence counters and recognized-role head |
| `CulturalStateRef` | Attributed belief-space head and transmission generation |
| `LifecycleState` | Active, degraded, dormant, archived, extinct, recycling, disposed |
| `GenesisProjectionState` | Audience-safe visual dirty channels and evidence quality |

Secrets, source bytes, capability tokens, private culture graphs, and complete
lineage histories are not components.

## Flat planned systems

- `DevelopmentClockSystem`
- `RegulatorySignalSystem`
- `EpigeneticDecaySystem`
- `HomeostasisSystem`
- `ResourceAccountingSystem`
- `ReactionCandidateIndexSystem`
- `ReactionEvaluationSystem`
- `ConstructiveProposalSystem`
- `RoleEvidenceSystem`
- `CulturalTransmissionSystem`
- `LineageJournalProjectionSystem`
- `LifecycleTransitionSystem`
- `GenesisProjectionDirtySystem`

Each system owns one transformation and receives dependencies through the
composition root. The systems do not construct one another and do not call
WebGPU OS capabilities directly.

## Multirate execution

High-frequency visual and physical systems continue at frame and fixed-tick
rates. Genesis layers run only when their explicit logical clocks are due:

| Layer | Trigger strategy |
| --- | --- |
| Regulation | Fixed logical pulse plus changed-input dirty set |
| Homeostasis | Fixed logical pulse plus threshold crossing |
| Reactions | Changed resource/signal indexes plus due rules |
| Behavior | Bounded policy cadence |
| Learning | Explicit batch or background budget |
| Development | Stage deadline, admitted event, or authorized transition |
| Evolution | Explicit ecology epoch or offline evaluation job |
| Culture | Attributed transmission event or cultural epoch |

Pausing rendering does not alter canonical slow-clock results. Frame-rate
variation cannot advance evolution. Logical clocks and seeded streams are saved
and restored.

## Reaction and role indexes

The reaction subsystem maintains reverse indexes from changed inputs, signals,
resources, interfaces, and location scopes to potentially affected rules. One
dirty input evaluates only its bounded candidate set.

Role recognition maintains incremental evidence counters and relationship
indexes. It does not rescan every entity-role-environment combination. Changes
to evidence or criteria invalidate only the relevant candidates. Recognition
and release results become receipts before projection.

Both indexes are rebuildable derived state. Their canonical source remains the
admitted definitions and evidence records.

## CPU, workers, and GPU

The Engine already has a frame-budget task scheduler, an internal WorkerPool, a
standalone WorkerPool, and an async GPU compute scheduler. Genesis adds ports
over these mechanisms and does not introduce another scheduler. (Sources:
`engine/core/scheduler/TaskScheduler.js`;
`engine/core/workers/WorkerPool.js`;
`engine/core/gpu/AsyncComputeScheduler.js`.)

### CPU main thread

Owns canonical validation, authority checks, commit ordering, ECS structure,
resource lifetimes, final digest assembly, and publication decisions.

### Workers

May perform independent validated subgraph compilation, static analysis,
candidate simulation, descriptor extraction, and digest work. Inputs and
outputs are immutable transferable records. Worker failure cannot publish a
partial plan.

### GPU

May evaluate bounded regulatory fields, reaction batches, phenotype metrics,
QD descriptors, and visual instance data. WGSL and buffer layouts pass normal
validation and resource ceilings. GPU floating-point results are not used as
canonical authority unless a declared numeric profile and reproducibility gate
explicitly permit the use. Security, capability, minting, and commit decisions
remain on the CPU authority path.

## State, causality, and evidence

The monotonic `FactStore` and causal commit path are a natural evidence plane:

- lineage events append and previous facts are tombstoned rather than erased;
- candidate evaluations bind causal parents and exact evaluator versions;
- activation consumes the relevant proposal output and records the accepted
  phenotype head;
- rollback is a new causal transition to a prior content root, not deletion of
  the failed branch;
- dormancy, reactivation, extinction, pruning, recycling, and disposal remain
  distinct events;
- world models and learned predictions are stored with inferred or simulated
  claim axes and cannot become observations by being committed.

(Sources: `engine/state/facts/FactStore.js`;
`engine/state/transaction/CommitCoordinator.js`;
`engine/state/worldmodel/CausalDynamics.js`.)

## Persistence version 2

The current world snapshot returns the debug/time/config/entity-table snapshot,
and the version 1 save envelope optionally adds `worldSim`. It does not provide
a complete ECS component snapshot. (Sources: `engine/ecs/world/World.js` lines
177-229; `engine/ecs/world/WorldPersistence.js`.)

The planned version 2 envelope contains:

- world identity, schema version, config, clocks, and deterministic streams;
- entity generations and alive/free state;
- component schema versions and complete archetype/chunk contents;
- immutable content references for genomes, plans, policies, and packages;
- active phenotype, lineage, lifecycle, and authority-receipt references;
- structural command barrier state restricted to a safe checkpoint boundary;
- derived-index versions and rebuild instructions;
- `worldSim` state under its existing owner;
- root digest and migration evidence.

Restore is two-phase:

1. Parse, size-check, migrate, resolve immutable dependencies, and validate into
   an isolated candidate world.
2. Rebuild derived indexes, verify roots, and atomically replace the active
   world only after every required dependency passes.

A failed restore leaves the current world untouched. Version 1 payloads remain
accepted through an explicit migration that records absent component state
rather than inventing it.

## Rendering boundary

`StateFirstEcsSourceAdapter` is already a read-only projection from authoritative
Transform and Renderable components. Genesis follows the same pattern with
separate typed observation adapters for phenotype, regulation, resources,
roles, lineage, and lifecycle. (Source:
`engine/render/state/StateFirstEcsSourceAdapter.js`.)

The adapters:

- read admitted ECS state and immutable evidence references;
- publish stable IDs, generations, quality, freshness, and dirty channels;
- omit fields outside the requested audience;
- never infer authority or open source content;
- never write ECS state;
- preserve unknown, stale, unavailable, undisclosed, inferred, and decorative
  distinctions.

The Virtual Realm renderer consumes those projections. It does not import ECS
storage internals.

## Engine-wide subsystem integration

| Subsystem | Integration |
| --- | --- |
| Core resources | Resolve immutable part, genome, plan, shader, mesh, and evidence content IDs |
| Frame pipeline | Schedule read-only Genesis projection and bounded GPU evaluation passes |
| Memory | Track chunk, side-table, candidate, cache, atlas, and archive budgets |
| Events | Carry typed immutable observations, receipts, invalidations, and disposal events |
| ECS | Own active phenotype state and structural barrier |
| Render | Draw admitted static/dynamic projections with semantic LOD |
| Particles | Retain domain adapter while reusing generic recipe kernel |
| Physics | Evaluate candidate constraints through existing public boundaries; no binding changes |
| World simulation | Supply bounded environmental and resource observations |
| Networking | Serialize only audience-safe, versioned projection records through existing ports |
| Audio | Sonify evidence classes and state without creating a truth source |
| Save/load | Persist complete state and content references with migration |
| Debug/inspection | Expose clocks, generations, ready sets, cache reuse, lineage, and receipts |
| Bootstrap | Export opt-in Genesis constructors without side effects or auto-boot |

Vendored code, `engine/kaolin/`, and PhysX bindings remain unmodified.
First Shard source, tests, architecture, runtime, and dependencies remain
excluded.

## Benchmark corpus and gates

GE0 records cold and warm results for:

- current particle recipes at minimum, median, and maximum admitted graph size;
- RealmForge runtime plans with shared subassemblies;
- synthetic wide, deep, and high-fan-out valid graphs;
- invalid graphs covering every rejection class;
- ECS worlds spanning archetype count, chunk occupancy, structural churn, and
  hot/cold component mixes;
- multirate regulatory, reaction, role, and cultural workloads;
- save, restore, rollback, and index rebuild;
- worker-disabled, worker-message, shared-memory, and GPU-disabled profiles.

Required counters include:

- validation, canonicalization, digest, diff, compile, verification, and total
  time;
- cache hit class, invalidated nodes, reused fragments, ready-set width, worker
  queue time, GPU dispatch, upload, and readback;
- query calls, entities, chunks, rows, allocations, structural moves, dirty
  columns, and command-barrier time;
- snapshot bytes, immutable dependency bytes, restore time, and rebuilt indexes.

The gates compare like-for-like outputs. No speed claim is accepted if canonical
bytes, error ordering, execution order, evidence, or last-good behavior changes.

## Implementation work packages

| Package | Change | Verification | Rollback |
| --- | --- | --- | --- |
| EN-GE0 | Freeze source map, contracts, limits, vectors, and benchmarks | Reproducible baseline on supported browser profiles | Documentation and fixtures only |
| EN-GE1 | Extract generic recipe kernel behind particle compatibility API | Existing particle suites plus byte, error, plan, and cache parity | Restore direct particle implementation |
| EN-GE2 | Add indexed digests, incremental invalidation, and scheduler ports | Cold/warm benchmarks and deterministic concurrency | Disable fragment reuse and concurrency |
| EN-GE3 | Add component layout metadata and chunk query API | Legacy component/query parity and allocation tests | Object storage and `forEachEntity` remain |
| EN-GE4 | Add access graph, strict schedules, clock domains, and command barrier | Cycle, conflict, replay, cancellation, and structural churn tests | Genesis system group disabled |
| EN-GE5 | Add complete persistence V2 and atomic restore | Round-trip, migration, corrupt input, missing content, rollback | Retain V1 loader and current world |
| EN-GE6 | Add regulatory, homeostatic, reaction, resource, role, culture, and lifecycle systems | Multirate, bounds, fault, long-run, and no-authority tests | Unregister each flat system independently |
| EN-GE7 | Add worker/GPU candidate evaluators and QD archive adapter | CPU reference parity, device loss, cancellation, budget tests | CPU bounded evaluator |
| EN-GE8 | Add render/network/debug observation adapters and stable exports | Audience, dirty-delta, LOD, disposal, import, bundle tests | Existing state-first render path |

Each package is complete and separately gated. No package requires a partial
world rewrite to be useful.

## Test matrix

| Risk | Required test family |
| --- | --- |
| Canonical drift | Independent Python vectors plus browser vectors |
| Recipe regression | Particle validation, serialization, hash, diff, plan, and last-good parity |
| Nondeterminism | Reordered input, repeated compile, worker count, cancellation, replay |
| ECS correctness | Entity generation, archetype move, query parity, component validation, barrier conflicts |
| Persistence | V1 migration, V2 round-trip, missing content, schema migration, corrupted chunk, atomic failure |
| Security | Unknown keys, oversize graphs, forged receipts, stale epochs, unauthorized mutation, dynamic-code rejection |
| Privacy | Private/public/refinement cache and projection noninterference |
| Performance | Cold/warm recipe, allocation, structural churn, multirate, worker/GPU, long session |
| Resilience | Device loss, worker crash, evaluator timeout, partial cache, restore interruption |
| Lifecycle | Build, reject, activate, repair, rollback, dormancy, reactivate, recycle, dispose |

## Engine acceptance definition

The Engine portion is complete when the same admitted input produces the same
plan and lineage on every supported execution profile, recipe compilation shows
measured improvement, hot Genesis systems avoid per-entity allocation, structural
changes occur only at deterministic barriers, complete state can be restored,
candidate failure preserves the last-good world, and every renderer or network
consumer receives only read-only audience-safe observations.

## See also

- [Virtual Realm M2 Engine and ECS Foundation](virtual-realm-m2-engine-foundation.md)
- [Virtual Realm M2 Runtime Foundation](../webgpu-os/virtual-realm/m2-runtime-foundation.md)
- [Virtual Realm M3 Living City Runtime](../webgpu-os/virtual-realm/m3-living-city-runtime.md)
- [RealmForge Genesis Ecology](../webgpu-os/realmforge-genesis-ecology.md)
