---
title: Genesis Ecology
description: Canonical cross-stack architecture for developmental software, cognition, inheritance, embodiment, program ecology, constructive metabolism, lineage, regulation, roles, culture, and safe open-ended composition.
updated: 2026-09-03
status: architecture baseline; M0-M1C Virtual Realm product baseline accepted and M2 underway without integrated acceptance; RF-GE0-RF-GE5 inert authoring evidence accepted; RF-GE6 and runtime implementation separately planned and gated
---

# Genesis Ecology

Genesis Ecology is a staged developmental substrate for the Engine, ECS,
RealmForge, AGI, WebGPU OS, and The Virtual Realm. Its inert RealmForge
authoring foundation is implemented through RF-GE5; the governed runtime remains
separately planned and gated. It changes the unit of design from a finished
object with one mutable genome into an ecology of descriptions, constructors,
regulators, learners, roles, cultures, and evidence.

The aim is not unrestricted self-modifying code. The aim is a system that can
propose, build, test, repair, specialize, recombine, package, and reuse real
software structures while every state-changing operation still passes through
the existing authority, validation, and commit boundaries.

This page is the canonical whole-stack decision record. The detailed execution
plans are:

- [Genesis Ecology Engine and ECS plan](../engine/genesis-ecology-engine-plan.md)
- [Genesis Ecology WebGPU OS plan](../webgpu-os/genesis-ecology-os-plan.md)
- [RealmForge Genesis Ecology](../webgpu-os/realmforge-genesis-ecology.md)
- [Virtual Realm Genesis Ecology integration](../webgpu-os/virtual-realm/genesis-ecology-integration.md)

Nothing on these pages retroactively changes the accepted Virtual Realm M0,
M1A, M1B, or M1C contracts. Genesis Ecology runtime integration remains a
separately versioned M2+ program; accepted RF-GE0-RF-GE5 authoring evidence is
inert and grants no runtime gate.

## Current implementation boundary

The implemented RealmForge gates stop at inert RF-GE5 authoring evidence:

- RF-GE0 freezes five identity records and validates their bounded linkage;
- RF-GE1 publishes the sealed, identity-only authored pack through atomic
  registry views;
- RF-GE1A freezes `GenesisInterfaceV1`, `GenesisConstraintV1`,
  `GenesisPartV1`, and `GenesisAssemblyV1` plus their closed graph verifier;
- RF-GE2 freezes exactly `ProductGenomeV1`, `FactoryGenomeV1`,
  `GenomeRevisionReferenceV1`, and `GenesisExecutionPlanV1`, validates genome
  lineage, and deterministically compiles and verifies constructive plans;
- RF-GE3 adds an audience-, disclosure-, and audience-scope-isolated
  process-local cache for exact verified Plans plus deterministic inert
  recursive package-candidate preparation through the existing
  `GenesisPartV1` contract;
- RF-GE4 freezes ten development, regulation, homeostasis, causal-closure,
  cognition, embodiment, inheritance, and reaction authored-program kinds
  represented by the accepted twelve-record golden corpus, then
  deterministically compiles and byte-verifies eight interpreter Plan fragments
  against one exact context and seals an eighteen-descriptor inert trust pack;
- RF-GE5 freezes eleven lineage, program-ecology, recognition, role, culture,
  quality-diversity, variation/evolution, environmental-memory, lifecycle, and
  organismality evidence records, then deterministically compiles and
  byte-verifies ten evidence Plan fragments bound to one verified RF-GE4 Plan
  and seals a twenty-one-descriptor inert trust pack.

The RF-GE2 matrix covers `BUILD`, `BREAK`, `REPAIR`, `FUSE`, `SPLIT`,
`SPECIALIZE`, `GENERALIZE`, `RECOMBINE`, `RECYCLE`, and `MUTATE`. The compiler
derives a canonical dependency closure, Part order, stage order, ready groups,
aggregate budget, and plan digest. Verification performs digest validation and
canonical deterministic recompilation. The isolated constructive domain pack
pins schemas, validators, compiler metadata, dependency coordinates, and exact
host implementation identities. Its binding checks require self-digest-bound
Factory Genomes and Plans plus exact trusted coordinates, but cannot resolve or
invoke those identities.

Every RF-GE2 plan remains data-only and explicitly `not-executed`. The catalog,
compiler, verifier, and provider do not grant authority, persist or publish a
plan, publish or mutate an authored or persistent registry, select an active
head, execute Factory stages, or
activate runtime state. WebGPU OS admission, execution, promotion, rollback,
ECS materialization, and Virtual Realm projection therefore remain later gates.
(Sources:
`webgpu-os/apps/the-virtual-realm/genesis/contracts/GenesisConstructiveContractCatalogV1.js`;
`webgpu-os/apps/the-virtual-realm/genesis/contracts/GenesisGenomeContractPrimitivesV1.js`;
`webgpu-os/apps/the-virtual-realm/genesis/contracts/GenesisGenomeGraphValidatorV1.js`;
`webgpu-os/apps/realmforge/modeler/genesis/GenesisFactoryPlanCompilerV1.js`;
`webgpu-os/apps/realmforge/modeler/genesis/GenesisEcologyConstructiveDomainPackV2.js`;
`webgpu-os/apps/realmforge/modeler/genesis/rf-ge2/index.js`.)

`GenesisIncrementalPlanCacheV1` can skip both compilation and deterministic
recompilation only for an exact source and complete cache-context hit. Every
non-exact miss still runs the complete RF-GE2 compiler and verifier. Such a miss
may reuse immutable dependency-index fragment objects, but never a semantic
partial Plan. Reverse-dependency metadata drives bounded changed-source and
explicit content-ID invalidation inside one process-local audience namespace.

`prepareGenesisRecursivePackageCandidateV1()` revalidates the source graphs,
trusted bindings, inert Plan, Product-root Assembly, Factory policy, Part
closure, and external Interface surface. It emits a digest-valid
`GenesisPartV1` candidate and an internal deterministic descriptor whose
evidence remains `required-not-collected` and whose status remains
`awaiting-external-execution-and-verification`. RF-GE3 does not execute, collect
runtime evidence, publish, persist, install, mutate a registry, grant authority,
or activate anything. (Sources:
`webgpu-os/apps/realmforge/modeler/genesis/GenesisIncrementalPlanCacheV1.js`;
`webgpu-os/apps/realmforge/modeler/genesis/GenesisRecursivePackageCompilerV1.js`;
`webgpu-os/apps/realmforge/modeler/genesis/rf-ge3/index.js`.)

RF-GE4 and RF-GE5 remain description and verification layers. Their authored
records, compiled fragments, aggregate Plans, and sealed domain-pack providers
contain no executable payload, persistence port, registry publication,
identity mint, runtime activation, self-modification, or world authority.
RF-GE5 additionally requires the complete verified RF-GE4 authored closure and
the exact RF-GE4 interpreter Plan before it can compile. (Sources:
`webgpu-os/apps/realmforge/modeler/genesis/GenesisEcologyAuthoredProgramsV1.js`;
`webgpu-os/apps/realmforge/modeler/genesis/GenesisEcologyInterpreterCompilerV1.js`;
`webgpu-os/apps/realmforge/modeler/genesis/GenesisEcologyInterpreterDomainPackV4.js`;
`webgpu-os/apps/realmforge/modeler/genesis/GenesisEcologyEvidenceProgramsV1.js`;
`webgpu-os/apps/realmforge/modeler/genesis/GenesisEcologyEvidenceCompilerV1.js`;
`webgpu-os/apps/realmforge/modeler/genesis/GenesisEcologyEvidenceDomainPackV5.js`.)

## Program continuity ledger

This section is the canonical continuation point for the RealmForge authoring
track and the Virtual Realm runtime track. The tracks advance in parallel and
meet only at explicit admission gates. An authoring result can unlock the next
authoring plan; it cannot activate, project, publish, persist, or render itself.

```text
RealmForge authoring:
RF-GE5 accepted-authoring-only -> RF-GE6 -> RF-GE7 -> RF-GE8

Virtual Realm runtime:
M1C accepted -> integrated M2 -> M3A -> M3B -> M3C ... M7

Explicit crossings:
RF-GE6 evidence + accepted M2/M2-GE -> separately reviewed VR-GE0/VR-GE1 work
RF-GE7 evidence + accepted Storylet runtime path -> separately reviewed VR-GE4 work
RF-GE8 evidence + accepted publication/admission services -> public/refinement gates
```

The current flat gate ledger is:

| Order | Track | Gate or range | State | Normative plan/evidence | Required before advancement | Next gate | Explicitly not unlocked |
| ---: | --- | --- | --- | --- | --- | --- | --- |
| 0 | Virtual Realm base | M0, M1A, M1B, M1C | Accepted; frozen catalog remains 109 definitions and M1C remains 35 cases | [Virtual Realm roadmap](../webgpu-os/virtual-realm/implementation-roadmap.md); freeze-ledger milestone `virtual-realm-m1c` | Preserve every accepted byte and regression | Integrated M2 | M2, M3, Genesis runtime, public state, multiplayer |
| 1 | Virtual Realm static runtime | M2A-M2H and required Engine/ECS slices | Implementation underway; M2A and the admission-only M2B slice are accepted independently, not as integrated M2 | [Virtual Realm roadmap](../webgpu-os/virtual-realm/implementation-roadmap.md); M2 and Engine foundation plans | Accepted M1C plus every M2 subgate and regression | M3A observation ingress | M3A, M3B, live Genesis projection |
| 2 | Virtual Realm observation | M3A | Executable blueprint; not implemented | [M3A observation ingress](../webgpu-os/virtual-realm/m3a-observation-ingress.md) | Accepted integrated M2 | M3B disclosure/projection | Derived-state activation, topology, Code Matter, Storylets, remote presence |
| 3 | Virtual Realm derived state | M3B | Executable blueprint; not implemented | [M3B disclosure and dynamic projection](../webgpu-os/virtual-realm/m3b-disclosure-projection.md) | Accepted integrated M2, accepted implemented M3A, and accepted M3B-00 transaction capability | M3C topology transition | Rendering authority, topology creation, Code Matter, Storylets, SecureMesh, multiplayer |
| 4 | RealmForge authoring | RF-GE0-RF-GE5 | Accepted bounded inert authoring evidence | Freeze-ledger milestone `realmforge-rf-ge5` and the detailed [RealmForge plan](../webgpu-os/realmforge-genesis-ecology.md) | Preserve RF-GE0-RF-GE5 and M0-M1C bytes | RF-GE6 | Admission, execution, persistence, publication, identity mint, runtime activation |
| 5 | RealmForge projection authoring | RF-GE6 | Planned | [RealmForge plan](../webgpu-os/realmforge-genesis-ecology.md); [world-kit specification](../webgpu-os/virtual-realm/world-districts.md) | Accepted RF-GE5 authoring evidence | RF-GE7 | Live scan, mutable world authority, runtime projection or activation |
| 6 | RealmForge narrative authoring | RF-GE7 | Planned | [RealmForge plan](../webgpu-os/realmforge-genesis-ecology.md); existing data-only Storylet verifier boundary | Accepted RF-GE6 and verifier parity | RF-GE8 | Executable expressions, action dispatch, capability grant, success claims |
| 7 | RealmForge publication authoring | RF-GE8 | Planned | [RealmForge bake pipeline](../webgpu-os/virtual-realm/realmforge-pipeline.md) | Accepted RF-GE7 plus separately accepted admission/publication prerequisites | Release candidate evidence | Automatic installation, active-head selection, runtime activation |
| 8 | Genesis runtime | M2-GE, M3-GE, M3F, VR-GE | Planned and independently gated | [WebGPU OS plan](../webgpu-os/genesis-ecology-os-plan.md); [Virtual Realm integration](../webgpu-os/virtual-realm/genesis-ecology-integration.md) | Applicable accepted base-runtime gate plus exact admitted RF-GE evidence | Gate-specific successor only | Any authority not named by that gate |

The immutable cross-track freeze ledger is
`tests/realmforge/fixtures/realmforge-m1c-rf-ge5-freeze-ledger-v1.json`.
Its physical SHA-256 is
`98BC37EE4E17518C54168ABC585DE7D634A1E27C4B30C981788729FED76754C4`,
its `milestonesSha256` is
`328bd8322861ff3fa452726fb42e169d2630b5f814d3ee24e66a070ded04da7f`,
and it explicitly records `authorityBearing = false` and
`runtimeActivation = false`. It pins the M1C 35-case milestone and the RF-GE5
29-case milestone independently. Aggregate historical regression totals are
supporting evidence, not replacements for those direct milestone counts.

Historical task provenance is a separate, flat information plane:

| Order | Source kind | Source title | Locator | Related results | Observed task state | Evidentiary status |
| ---: | --- | --- | --- | --- | --- | --- |
| 0 | Codex task | `RealmForge integration ledger` | `codex://threads/01a03ae7-26f8-7ad0-a598-6b547b6fb0b9` | RF-GE2 through RF-GE5 result summaries and later RealmForge integration work | Historical source task; live task state is intentionally not tracked in canonical architecture documentation | `pointer-only` |

The provenance row locates prior work; it is not a contract, receipt, test
result, dependency, or authority source. Only checked-in canonical artifacts and
independently reproducible acceptance evidence can change a gate state.

If this ledger becomes machine-readable, it must use two unnested peer record
families so history cannot impersonate evidence. `GateContinuityRowV1` contains,
in order, `continuityOrder`, `trackId`, `gateId`, `gateState`,
`normativePlanPath`, `acceptanceEvidenceId`, `acceptanceEvidenceDigest`,
`authorityCeiling`, `requiredGateIds`, `planningUnlockIds`,
`explicitlyNotUnlockedIds`, `nextGateId`, and `rowDigest`.
`HistoricalProvenanceRowV1` contains, in order, `provenanceOrder`,
`provenanceId`, `relatedGateId`, `sourceKind`, `sourceTitle`, `sourceLocator`,
`observedOutcome`, `evidentiaryStatus`, and `rowDigest`. Neither family nests the
other, and a provenance ID is forbidden anywhere an acceptance-evidence ID is
required.

## Locked decisions

1. A **Soul Seed** is an immutable causal identity root. It identifies an
   origin, lineage, and policy domain; it is not a literal blueprint, current
   behavior, secret, capability, or proof of personhood.
2. A **genome** is a developmental grammar: parts, interfaces, topology,
   configuration, construction rules, repair rules, and bounded variation
   operators. It does not directly execute.
3. **Development**, **regulation**, **learning**, **evolution**, and **culture**
   are separate clock domains with separate state and evidence.
4. Structural change is transactional. A candidate is compiled and evaluated
   outside the active world, then committed at a deterministic ECS barrier or
   rejected without altering the last-good phenotype.
5. Quality diversity is the default population strategy. A single scalar
   fitness score cannot define the entire ecology.
6. Roles are evidence-backed relationships between entities and environments.
   They are not fixed classes embedded in identity.
7. Learning, culture, mutation, Storylets, renderers, and projections emit
   powerless proposals. None can grant authority or claim a completed action.
8. A compiled and verified assembly may be packaged as a new immutable part.
   This recursive packaging is the basis of faster recipes and higher-order
   construction.
9. The Engine owns reusable runtime mechanisms. RealmForge authors and compiles
   constructive descriptions. WebGPU OS owns authority and lifecycle. The
   Virtual Realm projects admitted truth into place.
10. The design remains flat and modular. No `GenesisManager`, organism god
    object, nested mutable genome tree, or all-knowing world service is added.
11. A cognitive world model stores attributed observations, predictions,
    uncertainty, and counterfactuals. Prediction error may drive learning or a
    powerless endogenous-goal proposal; it never becomes world truth or
    authority merely because an organism believes it.
12. Genetic, epigenetic, developmental, behavioral, cultural, computational,
    and environmental inheritance remain distinct, attributed channels.
    Inheriting a road, institution, or repository means entering a world that
    contains it, not copying it into a Soul Seed.
13. Organisms may construct niches and externalize memory into admitted world
    state. Persistent geography still changes only through a verified topology
    transition and never through an uncommitted ecological inference.
14. Metamorphosis, host migration, component replacement, and distributed
    embodiment may change phenotype topology without changing Eidos continuity.
    The runtime records which admitted body or hosts realize that continuity.
15. Pruning, apoptosis, immune-style recognition, quarantine, and repair are
    governed lifecycle mechanisms. They do not bypass storage retention,
    capability, zeroization, or rollback authority.

## The model stack

| Layer | Canonical responsibility | Mutable? | Authority? |
| --- | --- | --- | --- |
| Soul Seed | Immutable origin, lineage root, identity domain, mint receipt reference | No | No |
| Lineage | Parentage, recombination, variation, construction, and lifecycle events | Append-only | No |
| Product genome | What the resulting assembly must contain and expose | Versioned descriptions | No |
| Factory genome | How constructors build, verify, repair, and package the product | Versioned descriptions | No |
| Regulatory network | Context-sensitive activation, suppression, timing, and resource allocation | Bounded state | No |
| Epigenome | Heritable or retained regulatory marks with declared scope and decay | Bounded state | No |
| Homeostatic profile | Viability ranges, sensed variables, controllers, and recovery policy | Bounded state | No |
| Phenotype | The admitted active assembly and its ECS projection | Transactional | Only through receipts |
| Learner state | Policy, value, memory, and adaptation within one admitted phenotype | Bounded state | No |
| Cognitive world model | Attributed beliefs, predictions, uncertainty, causal hypotheses, and counterfactuals | Bounded and evidence-linked | No |
| Endogenous goals | Curiosity, information-gain, and homeostatic goal proposals | Transactional proposals | No |
| Embodiment | Admitted body, host set, sensors, compute, storage, energy, communication, and actions | Versioned topology | Only through receipts |
| Inheritance channels | Genetic, epigenetic, developmental, behavioral, cultural, computational, and environmental transfer | Versioned and attributed | No |
| Role evidence | Observed participation in environmental and social functions | Append-only evidence | No |
| Cultural belief space | Transmitted conventions, practices, models, and selection pressures | Versioned and attributed | No |
| Recognition profile | Self, descendant, symbiont, unknown, damaged, and hostile classifications plus response policy | Bounded state and proposals | No |
| Ecology | Population, resources, reactions, niches, archives, and selection policy | Governed world state | Only through kernel policy |

The separation is a correctness boundary. A useful learned behavior does not
rewrite lineage. A regulatory mark does not silently alter the immutable genome.
A high organismality score does not mint an identity. A rendered phenotype is
not the authoritative state.

## Research-complete capability ledger

The research program is complete only when every adopted direction has an
explicit data, runtime, authority, and projection boundary. Similar biological
terms do not collapse these responsibilities into one mechanism.

| Upgrade family | Canonical mechanism | Required boundary |
| --- | --- | --- |
| Developmental encoding and morphogenesis | Local graph-growth, reuse, differentiation, metamorphosis, self-repair, and pruning rules | Candidate topology develops offside; only a receipt-bound barrier changes the active phenotype |
| Regulation, artificial signals, and epigenetics | Regulatory Signal Fabric channels, activation/suppression, retained marks, scope, strength, and decay | Regulation changes expression, not immutable Soul Seed identity or published genome bytes |
| Homeostasis, autopoiesis, and causal closure | Viability bands, controlled variables, recovery policy, self-maintenance evidence, and internally maintained requirements | Homeostatic error creates bounded work or proposals, never privileged action |
| Cognitive world models and endogenous goals | Observations, beliefs, predictions, uncertainty, counterfactuals, curiosity, and information-gain proposals | Belief and prediction remain claim-axis labelled; generated goals remain powerless |
| Learning, development, evolution, and meta-evolution | Independent clocks and state for acquired knowledge, lifetime topology, inherited grammar, and variation-regime descriptions | A mechanism may propose changes to another mechanism only through the same isolated candidate lifecycle |
| Embodiment and distributed organisms | Body/host capability profiles and one Eidos continuity mapped to one or more admitted hosts | Host loss or replacement does not silently fork identity, capability, or ownership |
| Inheritance and niche construction | Seven attributed inheritance channels plus durable environmental memory and world-change proposals | Environmental inheritance references admitted world artifacts; it does not rewrite descendants |
| Reaction and program ecology | Indexed reactions plus cooperation, competition, mutualism, commensalism, parasitism, predation, and resource exchange | Relationship labels derive from evidence and grant no execution or network authority |
| Recognition and immune responses | Versioned recognition evidence and tolerate, test, quarantine, reject, repair, or release proposals | Kernel security and storage quarantine remain the authority owners |
| Role proliferation and major transitions | Evidence-backed roles, new role-vocabulary proposals, collective integration, organization-first identity proposals, and higher-order-organism proposals | Roles do not grant capabilities; collective identity requires a separate mint receipt |
| Culture and social topology | Attributed belief spaces and noisy transmission over explicit trust, kinship, trade, geography, language, and infrastructure | Culture can bias proposals and evaluation, never policy or facts |
| Quality diversity and evolvability | Versioned descriptor spaces, niches, lineage, archive coverage, and evolvability evidence | No universal scalar winner and no archive-to-activation shortcut |
| Dormancy, extinction, and temporal ecology | Distinct active, dormant, archived, extinct, known-extinct, forgotten, recycled, and deleted states | Retention and reactivation follow explicit policy and evidence |
| Storylet Algebra | Role/relationship reactions, composition, specialization, and institution-forming proposals | Algebra lowers to data-only Storylets and powerless requests |
| Constructive metabolism | Product/factory genomes, typed parts, build/break/repair/fuse/split/specialize/generalize/recombine/recycle/mutate, and recursive packaging | Trusted constructors, policy, commit, and rollback mechanisms remain non-evolvable |

The [Engine and ECS plan](../engine/genesis-ecology-engine-plan.md),
[RealmForge plan](../webgpu-os/realmforge-genesis-ecology.md), and
[Virtual Realm integration](../webgpu-os/virtual-realm/genesis-ecology-integration.md)
assign concrete owners and gates to this ledger.

## Causal pipeline

Genesis Ecology uses four strict planes:

1. The **Causal State Engine (CSE)** is canonical truth for identity, genome
   heads, lineage, resources, logical clocks, deterministic streams, and
   accepted construction or lifecycle transitions.
2. The **ECS** is the deterministic high-performance materialization of
   committed CSE state.
3. **Workers and GPU compute** compile, simulate, evaluate, and propose. Their
   results are noncanonical until verified and committed.
4. **Physics, rendering, audio, UI, and world projection** are effect and
   observation planes. They cannot define identity or accepted evolution.

An ECS entity handle, GPU index, retained-render slot, native physics handle,
or process ID is therefore never a Soul Seed. Stable identity survives runtime
rematerialization and points into versioned CSE records.

```mermaid
flowchart LR
  seed["Soul Seed identity root"] --> lineage["Lineage and inherited descriptions"]
  lineage --> genome["Product and factory genomes"]
  genome --> compile["Deterministic recipe compiler"]
  compile --> candidate["Isolated candidate phenotype"]
  candidate --> evaluate["Validation, simulation, tests, budgets, QD descriptors"]
  evaluate --> proposal["Constructive metabolism proposal"]
  proposal --> authority["WebGPU OS policy and authority"]
  authority --> barrier["Deterministic ECS commit barrier"]
  barrier --> active["Active phenotype"]
  active --> observe["Facts, regulation, homeostasis, roles, learning"]
  observe --> archive["Evidence, lineage, culture, QD archive"]
  archive --> genome
```

Only the authority-to-barrier edge may replace active structural state. Every
other edge transports immutable descriptions, bounded state, observations, or
proposals.

## Constructive metabolism

Constructive metabolism is the shared operation vocabulary for the software
factory. Each operation is a typed proposal over immutable inputs and produces
an independently verifiable candidate and receipt.

| Operation | Meaning | Required evidence |
| --- | --- | --- |
| `BUILD` | Assemble a product from parts and interfaces | Dependency closure, resource budget, tests |
| `BREAK` | Disassemble an assembly without losing provenance | Ownership, reversibility, recovered-part manifest |
| `REPAIR` | Restore violated invariants using admitted parts or transformations | Fault evidence, repair proof, regression result |
| `FUSE` | Combine compatible assemblies into a higher-order product | Interface compatibility, conflict resolution, new closure |
| `SPLIT` | Partition an assembly while preserving valid boundaries | Cut-set proof, ownership, independent validation |
| `SPECIALIZE` | Narrow behavior or interfaces for one niche | Declared lost capabilities, target descriptors, tests |
| `GENERALIZE` | Expand supported contexts without erasing guarantees | Compatibility matrix, expanded tests, resource delta |
| `RECOMBINE` | Produce a candidate from multiple lineages | Parent revisions, recombination trace, conflict policy |
| `RECYCLE` | Return safe parts and resources to admitted pools | Teardown, zeroization, reference, and retention evidence |
| `MUTATE` | Apply one bounded variation operator to descriptions | Operator identity, seed, limits, deterministic replay |

The verb never implies success. The accepted state transition is represented by
an authority receipt plus a commit receipt. Failed candidates remain isolated
and may be retained as research evidence without becoming live world state.

## Generic recipe kernel

Particle recipes already demonstrate strict validation, typed ports, canonical
ordering, content fingerprints, change-impact classification, and last-good
plan retention. RealmForge runtime plans already demonstrate immutable plan
compilation, content-addressed cache keys, target-capability binding, and
verification. Genesis Ecology extracts their shared mechanics into one generic
Engine recipe kernel while retaining domain-specific adapters. (Sources:
`engine/sim/particles/recipe/ParticleRecipeGraph.js`;
`webgpu-os/apps/realmforge/modeler/runtime-plan/RealmForgeRecipeRuntimePlan.js`.)

The generic kernel owns:

- closed schemas, limits, unknown-key rejection, and version migration;
- typed nodes, ports, interfaces, constraints, and dependency closures;
- deterministic canonicalization and content digests;
- validated-revision branding so one revision is not normalized repeatedly;
- adjacency indexes and deterministic ready sets;
- per-node and per-subgraph digests for incremental invalidation;
- change-impact classification and last-good plan retention;
- content-addressed plan caches bound to compiler, policy, and target versions;
- parallel compilation of independent ready sets through existing scheduler
  ports;
- immutable execution plans, evidence bundles, and rollback references.

Domain adapters continue to own meaning. The particle adapter maps recipe nodes
to particle subsystems. RealmForge maps parts and assemblies to construction
plans. Genesis Ecology maps developmental and metabolic descriptions to
candidate state. The generic kernel does not know particles, buildings,
organisms, permissions, or renderers.

### Recipe performance baseline

The current particle compiler validates before compilation, then computes a
hash through another normalization path, computes a change classification over
previous and next graphs, repeatedly sorts a ready array, and filters the full
edge list for each execution step. This is correct for bounded graphs but gives
the extraction a concrete optimization target. (Source:
`engine/sim/particles/recipe/ParticleRecipeGraph.js` lines 944-1096.)

The planned fast path is:

1. Parse and validate one revision once.
2. Build node, incoming-edge, outgoing-edge, and interface indexes once.
3. Canonicalize and digest once, retaining node and subgraph digests.
4. Diff against cached digests before rebuilding semantic steps.
5. Compile independent ready sets through the existing scheduler abstraction.
6. Reuse unchanged plan fragments and recursively packaged subassemblies.
7. Emit one evidence bundle containing timing, cache, invalidation, and budget
   counters.

The bounded RF-GE3 implementation proves only the safe exact-hit and dependency-
metadata subset of this path. Exact verified Plan hits skip the compiler and
verifier. Changed-source misses still compile and verify the whole semantic
Plan; reused dependency-index fragment objects do not constitute incremental
semantic compilation. The generic Engine extraction, scheduler acceleration,
and broader fragment compilation remain planned.

Absolute latency budgets are recorded only after GE0 benchmarks establish
device-class baselines. RF-GE3 currently proves deterministic work elimination
for exact hits through compiler-pass counters, not comparative wall-clock
improvement. Measured improvement without changing canonical bytes, validation
results, execution order, or last-good behavior remains an acceptance criterion
for the wider generic Engine extraction.

## ECS developmental substrate

The current ECS has generational entity IDs, archetype movement, query caching,
ordered phases, stable dependency ordering, world stepping, and per-system
timing. Those are retained. (Sources: `engine/ecs/world/World.js`;
`engine/ecs/storage/ArchetypeStorage.js`; `engine/ecs/query/Query.js`;
`engine/ecs/systems/SystemRegistry.js`.)

Genesis Ecology requires additive ECS capabilities:

- chunk and column iteration without an entity-array clone and per-entity
  closure allocation;
- fixed-size typed lanes for hot regulatory, homeostatic, resource, and role
  state, with immutable cold records referenced by content ID;
- declared component read/write sets on systems;
- deterministic parallel ready sets for systems with disjoint writes;
- a structural command buffer committed at a fixed tick barrier;
- archetype, column, and dirty-range generations for incremental projections;
- complete component snapshots, lineage journals, and versioned restoration;
- multiple logical clocks so development, learning, evolution, and culture do
  not execute at render frequency;
- bounded event and reaction indexes instead of whole-world scans;
- stable identity and phenotype references that survive layout migration.

The existing `forEachEntity` path remains compatible during migration. A new
chunk path is opt-in until parity, determinism, and benchmark gates pass. The
active archetype store is never structurally modified while a query is
iterating.

## Clock domains

| Clock | Typical owner | What advances on it |
| --- | --- | --- |
| Frame | renderer and presentation | interpolation, visibility, animation |
| Fixed simulation tick | World and simulation systems | physics, authoritative local dynamics |
| Regulation pulse | regulatory scheduler | signals, expression, suppression, decay |
| Homeostasis pulse | homeostatic controllers | error sensing, resource allocation, recovery |
| Behavior pulse | behavior systems | decisions and actions within the phenotype |
| Learning batch | AGI training coordinator | policy and model updates |
| Development epoch | developmental coordinator | staged growth and phenotype transitions |
| Evolution epoch | ecology coordinator | selection, recombination, mutation proposals |
| Cultural epoch | cultural transmission coordinator | attributed belief and practice propagation |

All clocks are explicit inputs. Wall-clock time, frame rate, and nondeterministic
randomness cannot silently alter canonical developmental results.

## Flat contract families

The Genesis catalog is separate from the frozen Virtual Realm M0-M1C catalog.
Each entry is a peer module with a closed versioned record. The Identity and
Parts rows, the three Genomes records, and `GenesisExecutionPlanV1` are now
implemented by RF-GE0 through RF-GE2. RF-GE3 adds no published wire family: its
package output is an existing `GenesisPartV1` candidate, and its package
descriptor and cache evidence remain internal inert authoring evidence. RF-GE4
and RF-GE5 add separate typed authored-program and evidence-program catalogs;
they do not activate the runtime-facing families below. Remaining names reserve
responsibilities for their later gates, and listing a name does not claim
runtime support.

| Family | Records |
| --- | --- |
| Identity | `SoulSeedIdentityRootV1`, `EidosIdentityV1`, `EidosContinuityReferenceV1`, `SoulSeedMintProposalV1`, `SoulSeedMintAuthorityReceiptV1` |
| Lineage | `LineageEventV1`, `RecombinationTraceV1`, `VariationOperatorReceiptV1` |
| Parts | `GenesisPartV1`, `GenesisInterfaceV1`, `GenesisConstraintV1`, `GenesisAssemblyV1` |
| Genomes | `ProductGenomeV1`, `FactoryGenomeV1`, `GenomeRevisionReferenceV1` |
| Recipes | `GenesisAssemblyRecipeV1`, `GenesisExecutionPlanV1`, `GenesisRecipeChangeSetV1`, `GenesisPlanEvidenceV1` |
| Development | `DevelopmentalGrammarV1`, `DevelopmentStageV1`, `PhenotypeManifestV1`, `PhenotypeTransitionProposalV1`, `StructuralRepairProposalV1` |
| Regulation | `RegulatoryNetworkV1`, `EpigenomeStateV1`, `SignalFieldSnapshotV1`, `HomeostaticProfileV1`, `HomeostaticStateV1`, `CausalClosureProfileV1` |
| Cognition | `CognitiveWorldModelV1`, `PredictionErrorEventV1`, `EndogenousGoalProposalV1` |
| Embodiment | `EmbodimentCapabilityProfileV1`, `DistributedMorphologyV1`, `MetamorphosisProposalV1` |
| Inheritance | `InheritancePolicyV1`, `InheritanceEventV1`, `EnvironmentalMemoryRecordV1`, `NicheConstructionProposalV1` |
| Metabolism | `ConstructiveMetabolismProposalV1`, `ConstructiveMetabolismReceiptV1`, `ResourceFlowSnapshotV1`, `ReactionRuleV1` |
| Ecology | `NicheDescriptorV1`, `ProgramEcologyRelationV1`, `ProgramEcologyObservationV1`, `QualityDiversityDescriptorSpaceV1`, `QualityDiversityArchivePolicyV1`, `QualityDiversityArchiveReceiptV1` |
| Recognition | `RecognitionProfileV1`, `RecognitionAssessmentV1`, `ImmuneResponseProposalV1`, `PruningProposalV1` |
| Meta-evolution | `VariationProgramV1`, `EvolutionRegimeV1`, `EvolutionRegimeProposalV1` |
| Roles | `RoleEvidenceV1`, `RoleRecognitionReceiptV1`, `RoleRelationshipV1`, `RoleVocabularyProposalV1`, `InstitutionFormationProposalV1` |
| Culture | `CulturalBeliefSpaceV1`, `CulturalTransmissionEventV1`, `SocialTopologyV1`, `EnvironmentalInheritanceV1` |
| Lifecycle | `DormancyTransitionV1`, `ReactivationProposalV1`, `ReactivationReceiptV1`, `ArchiveTransitionV1`, `ExtinctionEvidenceV1`, `PruningProposalV1`, `PruningReceiptV1`, `ApoptosisProposalV1`, `ApoptosisReceiptV1`, `RecyclingReceiptV1`, `DeletionRetentionReceiptV1`, `ZeroizationReceiptV1` |
| Storylets | `StoryletRoleAlgebraV1`, `StoryletRoleAlgebraLoweringReceiptV1` |
| Organismality | `CausalClosureAssessmentV1`, `OrganismalityAssessmentReceiptV1`, `CollectiveIntegrationAssessmentV1`, `HigherOrderOrganismProposalV1` |

`OrganismalityAssessmentReceiptV1` records criteria and evidence. It has no
authority edge to identity minting, package installation, network capability,
resource ownership, or legal status.

## Whole-stack impact map

| Owner | Existing mechanisms to reuse | Current or planned Genesis Ecology responsibility | Change class |
| --- | --- | --- | --- |
| Engine recipe layer | Particle graph validation, hashes, change impact, last-good plan | Extract generic recipe kernel and preserve particle adapter | Core modification |
| ECS world | Generational IDs, fixed tick, system phases, metrics | Structural barrier, clock domains, complete snapshots, lifecycle journal | Core modification |
| ECS storage/query | Archetypes, cached matching queries, direct component set | Chunk views, typed hot columns, dirty generations, allocation-free iteration | Core modification |
| ECS system registry | Stable phase/dependency order | Read/write declarations and deterministic parallel ready sets | Core modification |
| Engine schedulers | Task scheduler, worker pool, GPU async scheduler | Shared ports for compile/evaluate work; no fourth scheduler | Adapter and consolidation |
| Engine state | Fact store, commit coordinator, causal dynamics | Evidence facts, candidate state, causal lineage, authority-bound commit | Additive integration |
| Engine render | State-first ECS source projection | Phenotype and ecology visual projections from admitted ECS state | Additive adapter |
| Engine persistence | World and simulation save payloads | Versioned component snapshots, immutable roots, journals, cache references | Versioned expansion |
| Engine simulation | Particle, physics, world, and resource simulation | Bounded developmental tests, reaction evaluation, resource accounting | Additive adapters |
| AGI | Observations, rewards, curriculum, PPO, tensors, checkpoints | Learners and evaluators; QD descriptors and archives remain separate from scalar reward | Additive subsystem |
| Editor | Scene, asset, graph, and inspection tools | Genome, lineage, regulatory, reaction, role, culture, and evidence inspectors | Tooling expansion |
| Plauna | DOM/GPU surfaces and widgets | Accessible authoring, review, diff, archive, and operator panels | UI expansion |
| WebGPU OS kernel | Syscalls, capabilities, lifecycle, scheduling | Policy, resource ceilings, mint authority, activation, revocation, disposal | Security-critical integration |
| WebGPU OS storage | VFS, packages, immutable resources | Content-addressed parts, closures, lineage, archives, retention and zeroization | Storage expansion |
| RealmForge | `.proasset`, verified recipes, resource graphs, runtime plans | Implemented inert Parts, Product/Factory Genomes, deterministic constructive plans, process-local exact Plan caching, inert recursive package candidates, RF-GE4 authored-program/interpreter evidence, and RF-GE5 evidence compiler/trust pack; RF-GE6 reviewed projection kits and every runtime-admission seam remain planned | Major authoring expansion |
| The Virtual Realm | Audience bakes, projections, Code Matter, Storylets | Truthful spatial projection of development, ecology, factories, roles, and culture | M2+ integration |
| SecureMesh | Typed observations and capability-mediated transport | Public ecology shells and admitted encounter evidence, never private genome leakage | Later adapter |
| Tests and docs | Browser gates, Python vectors, bundles, docs validation | Determinism, replay, privacy, performance, mutation, restore, and long-run ecology gates | Cross-cutting |

Vendored code, NVIDIA Kaolin, PhysX bindings, binaries, lockfiles, and generated
reference content remain outside this plan. Genesis Ecology integrates through
their existing public boundaries and does not modify them.

## Security and containment

### Data is evolvable; authority is not

An evolvable record may describe code selection, configuration, wiring,
constraints, tests, or resource use. It may not contain executable JavaScript,
WGSL accepted without the existing shader checks, dynamic imports, syscall
handles, capability tokens, cryptographic keys, or authority receipts.

### Candidate lifecycle

1. An attributed proposer submits a closed, size-bounded description delta.
2. The generic recipe kernel validates and canonicalizes it.
3. RealmForge or an Engine adapter builds an isolated candidate.
4. Static, simulation, security, privacy, resource, and regression evaluators
   produce independent evidence.
5. QD indexing may retain the candidate as research evidence.
6. WebGPU OS policy either rejects it or issues a narrowly scoped authority
   receipt.
7. The ECS applies an accepted transition at its structural barrier.
8. Activation, rollback, disposal, and lineage events are journaled.

There is no in-place genome execution and no mutation of active code bytes.

### Identity minting

A higher-order structure may accumulate evidence of boundary maintenance,
repair, coordinated resource use, persistence, and internal regulation. That
can create `HigherOrderOrganismProposalV1`. Only an explicit policy service may
issue a Soul Seed mint receipt. Scores, Storylets, social consensus, renderers,
and evolutionary success cannot bypass that service.

### Multiplayer and disclosure

Private developmental state stays local. Public Cityform appearance is built
from explicit public inputs, and capability refinements carry only the exact
authorized closure. Other users can see a complete public shell without
receiving the private filesystem, source, genome, epigenome, learner state, or
cultural archive that produced it. This extends the existing Virtual Realm
audience separation instead of weakening it.

## Quality diversity, niches, and archives

The ecology maintains a bounded archive keyed by declared behavioral and
structural descriptors. Examples include repair latency, energy cost,
interface breadth, robustness, material efficiency, accessibility, latency,
and role coverage. Descriptor definitions and normalization are versioned.

The archive is not a leaderboard and not an authority source. It preserves
different viable strategies, supports deterministic parent selection under a
declared policy, and prevents one scalar reward from erasing useful diversity.
Archive admission records the candidate digest, descriptor vector, evaluator
versions, constraints, and replacement decision.

Dormancy, archival retention, extinction, and deletion are distinct states:

- **Dormant**: viable identity retained but not executing.
- **Archived**: immutable evidence retained; no live instance is implied.
- **Extinct**: no live admitted instance remains under the stated scope.
- **Deleted**: data was removed under an authorized retention and zeroization
  policy.

## Roles, cultures, and Storylet Algebra

A role is recognized from repeated evidence that an entity participates in a
function within a particular context. New roles may emerge when stable patterns
cannot be represented by the current vocabulary. Role recognition changes
descriptions and indexes; it does not silently grant capabilities.

A cultural belief space stores attributed conventions, models, practices, and
selection preferences. Transmission records the source, audience, mutation,
social path, confidence, and retention policy. Culture may influence which
factory candidates are proposed or evaluated, but kernel safety constraints
remain outside culture.

Storylet Algebra composes scenarios over roles, relations, evidence, and
authorized proposals. It can stage development, repair, apprenticeship,
exchange, conflict, dormancy, and recovery. A Storylet still cannot mutate the
world, mint identity, or announce success before the authoritative receipt and
observation chain exist.

## Program gates

| Gate | Scope | Required evidence | Rollback boundary |
| --- | --- | --- | --- |
| GE0 | Freeze terminology, source map, benchmarks, and deterministic vectors | Baseline corpus, timings, memory, canonical vectors | Documentation only |
| GE1 | Extract generic recipe kernel behind the particle adapter | Byte parity, validation parity, plan parity, benchmark improvement | Restore original adapter path |
| GE2 | Add ECS chunk queries, dirty generations, command barrier, and clock domains | Legacy parity, deterministic replay, save/restore, soak and allocation tests | Keep legacy entity iteration active |
| GE3 | Integrate the implemented RealmForge Parts, interfaces, and Product/Factory Genomes with incremental caches, invalidation, and recursive packaging; the bounded RealmForge exact-cache and inert package-candidate slice is implemented, while Engine and OS integration remain planned | Closure, exact-hit and full-miss parity, cache isolation, invalidation, resource, mutation, rollback, and security tests | Do not activate candidate format |
| GE4 | Add development, regulation, epigenome, homeostasis, cognition, embodiment, inheritance, and reaction substrate | Multirate replay, belief/fact separation, bounded-state, host-loss recovery, and fault-injection tests | Disable Genesis systems as a group |
| GE5 | Add lineage, program ecology, recognition, QD archive, roles, culture, niche construction, dormancy, meta-evolution, and organismality evidence | Archive determinism, lineage integrity, social-topology attribution, no-authority, retention, and environmental-memory tests | Retain evidence without live activation |
| GE6 | Add Virtual Realm projections and Storylet Algebra | Truth/provenance, privacy, first-person, Operations View, LOD, accessibility gates | Fall back to current stable projections |
| GE7 | Add SecureMesh ecology exchange and higher-order mint proposals | Noninterference, ciphertext, epoch, revocation, split-brain, abuse tests | Local-only ecology mode |
| GE8 | Release certification | Cross-device performance, long-run ecology, security, privacy, migration, docs | Last certified stack release |

Every gate is additive. GE1-GE8 do not reopen accepted Virtual Realm M0-M1C
bytes or redefine their evidence.

## Measurement and observability

The following measurements are mandatory before optimization claims are made:

- validation, canonicalization, digest, diff, compile, verification, and cache
  times by recipe revision;
- nodes, edges, interfaces, ready-set width, invalidated subgraphs, and reused
  fragments;
- ECS entities, archetypes, chunks, moved rows, structural commands, dirty
  columns, query allocations, and system ready-set width;
- worker queue time, CPU time, GPU evaluation time, upload bytes, and readback
  bytes;
- phenotype activation, rollback, repair, dormancy, disposal, and restore time;
- archive insertions, replacements, descriptor coverage, and lineage depth;
- public, private, and refinement output bytes with noninterference evidence.

Logs use content IDs and evidence IDs. They do not print private source,
plaintext refinement content, keys, raw capability tokens, or hidden genomes.

## Research adoption ledger

The research establishes design directions, not implementation claims.

| Primary source | Adopted direction | Boundary in this architecture |
| --- | --- | --- |
| [Developmental Graph Cellular Automata, University of York (2025)](https://etheses.whiterose.ac.uk/id/eprint/38431/) | Indirect developmental encodings and graph-based growth | Used for candidate construction; active structural commits remain transactional |
| [Open-Ended Development in Role Systems, Portland State University (2026)](https://pdxscholar.library.pdx.edu/open_access_etds/7108/) | Role proliferation and development beyond fixed taxonomies | Roles remain evidence-backed and non-authoritative |
| [Necessary Conditions for Open-Ended Evolution, University of Central Florida (2018)](https://stars.library.ucf.edu/etd/5965/) | Explicit environmental and systemic conditions for open-endedness | Open-ended proposals remain inside finite resource and policy ceilings |
| [Quality Diversity, University of Central Florida (2019)](https://stars.library.ucf.edu/etd/6298/) | Preserve many high-quality behavioral niches | QD archive is separate from authority and scalar RL reward |
| [Artificial Epigenetic Network, University of York (2013)](https://etheses.whiterose.ac.uk/id/eprint/5077/) | Regulatory and epigenetic control over expressed behavior | Epigenome is bounded versioned state, separate from the genome |
| [Hardware Implementation of Artificial Epigenetic Networks, University of York (2019)](https://etheses.whiterose.ac.uk/view/creators/Walter%3D3AAndrew%3D3A%3D3A.html) | Data-parallel regulatory evaluation | GPU use is bounded evaluation, never policy or canonical authority |
| [Homeostatic Adaptive Networks, University of Leeds (2006)](https://etheses.whiterose.ac.uk/id/eprint/1344/) | Internal viability variables and adaptive regulation | Homeostatic profiles declare ranges, controllers, and recovery policy |
| [Pathways to Autopoiesis, University of Bristol (2019)](https://research-information.bris.ac.uk/en/studentTheses/pathways-to-autopoiesis/) | Operational tests for self-maintaining organization | Organismality is an evidence assessment, not an identity shortcut |
| [RESAC artificial chemistry, TU Dortmund](https://eldorado.tu-dortmund.de/items/efdcbf49-7499-4ae6-b72f-45d57ef88a60/full) | Reaction rules, artificial chemistry, and emergent organization | Reactions are indexed bounded proposals with explicit resources |

## Explicit non-goals

- Claiming consciousness, sentience, life, legal personhood, or moral status
  from a score or simulation.
- Allowing generated code or evolved shader text to execute without the normal
  parser, validator, policy, and resource gates.
- Replacing physics, particles, audio, networking, rendering, or storage with
  one biological metaphor.
- Rebuilding an entire Cityform whenever regulation or learning state changes.
- Rendering inferred or decorative activity as if it were observed truth.
- Sending private genomes, source, filesystem structure, learner state, or
  cultural archives merely so another player can see a public Cityform.
- Creating a second ECS, scheduler, package manager, authority service, or
  RealmForge runtime inside The Virtual Realm.
- Modifying vendored or generated sources as part of the program.
- Using First Shard source, tests, architecture, mechanics, art direction,
  dependencies, or imported planning material. That application remains outside
  the research and implementation boundary.

## Acceptance definition

Genesis Ecology is real only when the implementation can replay a lineage,
compile the same recipe to the same canonical plan, restore complete phenotype
state, prove bounded mutations, retain a last-good active assembly, measure
recipe speedups, project only authorized truth, and revoke or roll back every
activated candidate. A convincing animation without those properties is not
the feature.
