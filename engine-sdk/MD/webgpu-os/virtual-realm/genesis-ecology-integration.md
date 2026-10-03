---
title: Virtual Realm Genesis Ecology Integration
description: Truthful world design for the Software Foundry, Soul Seeds, development, cognition, inheritance, embodiment, program ecology, roles, culture, lineage, and constructive metabolism in The Virtual Realm.
audience: RealmForge authors, Virtual Realm architects, engine developers, security reviewers, and QA engineers
updated: 2026-09-03
status: M2+ integration plan; RF-GE0 through bounded, inert RF-GE5 RealmForge authoring evidence complete; no Genesis runtime gate advanced; grounded first-person and owner-private Operations View rules locked
---

# Virtual Realm Genesis Ecology Integration

Genesis Ecology turns The Virtual Realm from a static spatial twin into a
living, inspectable digital world. Real software can be constructed, repaired,
specialized, recombined, packaged, and represented as a place without treating
the biological metaphor as runtime authority.

It is an opt-in **Living Digital World** certification track over base Virtual
Realm V1. Its packages, runtime state, and gates are separate so a missing,
disabled, incompatible, or rejected Genesis extension leaves the accepted base
city usable. The intended complete product includes the track; modularity makes
its authority and rollback boundary explicit.

The world remains truthful:

- stable geography comes from verified RealmForge bakes;
- live activity comes from authorized WebGPU OS and ECS observations;
- real code becomes Code Matter only through an exact reveal authority;
- developmental and ecological inferences are labelled as inferences;
- decorative effects never impersonate real code, people, routes, or activity;
- Storylets stage presentation and powerless requests, not facts or authority.

This page extends the [world projection grammar](world-projection.md),
[Code Matter](code-matter.md), [Cityforms and SecureMesh](cityforms-securemesh.md),
[Storylets](storylets.md), and [Local City Operations View](local-operator-view.md).
The underlying system is defined by [Genesis Ecology](../../concepts/genesis-ecology.md)
and [RealmForge Genesis Ecology](../realmforge-genesis-ecology.md).

## Current implementation audit

The accepted Virtual Realm runtime boundary remains M0-M1C: 109 flat contracts
plus deterministic private, public, and refinement RealmForge bakes and data-
only Storylets. Separate inert Genesis authoring foundations are also complete:
RF-GE0's five-record identity catalog, the bounded RF-GE1 identity-only domain-
pack provider and factory-gated atomic registries, and RF-GE1A's exact
`GenesisInterfaceV1`, `GenesisConstraintV1`, `GenesisPartV1`, and
`GenesisAssemblyV1` wire contracts with their digest-first closed-graph
validator.

RF-GE2 has delivered exactly four inert constructive records:
`ProductGenomeV1`, `FactoryGenomeV1`, `GenomeRevisionReferenceV1`, and
`GenesisExecutionPlanV1`. Its deterministic compiler/verifier covers `BUILD`,
`BREAK`, `REPAIR`, `FUSE`, `SPLIT`, `SPECIALIZE`, `GENERALIZE`, `RECOMBINE`,
`RECYCLE`, and `MUTATE`. The isolated constructive pack pins the admitted
schema, validator, compiler, constructor, interpreter, stage, and variation-
operator coordinates. Factory verification binds the Factory self-digest and
exact trusted constructor, interpreter, stage, and variation-operator
coordinates. Plan verification binds the Plan self-digest, exact compiler and
version, and every stage coordinate. Both produce frozen, authority-free,
`not-executed` receipts.

RF-GE3 has delivered a bounded process-local exact verified Plan cache and
deterministic inert recursive package-candidate preparation. The cache separates
mutable namespaces by the exact `audienceClass`, `disclosureClass`, and
`audienceScopeContentId` triple. Its complete key binds canonical source plus
schema, migration, policy, limit, numeric, capability, feature, adapter,
compiler, cache, sealed-domain-pack, audience, disclosure, and audience-scope
identity. Only a byte-identical source and context hit reuses the original
frozen Plan, deterministic verification, Factory binding receipt, and Plan
binding receipt with zero compiler or verifier passes. Every cold or changed-
source miss still runs the complete RF-GE2 compiler and deterministic verifier;
reused dependency fragments are immutable index metadata, never semantic Plan
fragments or a partial-compilation claim.

The cache records forward and reverse content dependencies over interfaces,
constraints, Parts, Assemblies, Product and Factory Genomes, revision
references, the constructive intent, and external content references. Changed-
source diffing reverse-closes over both the old and new snapshots. Explicit
invalidation aggregates reverse edges from retained fragments, exact-entry
snapshots, and lineage snapshots. Entry, lineage, and fragment maps are bounded
FIFO structures. If fragment pressure removes an intermediate dependency, the
cache prunes every retained direct and transitive dependent, leaving the
remaining fragment map dependency-closed. Invalidation remains local to one
audience namespace and emits a digest-bound, authority-free receipt.

RF-GE3 also hardened `AssetDependencyGraph` without making it a new canonical
authority. Every wrapper over the same injected `EntityRegistry` shares one
private process-local reverse-adjacency index and first-insertion ordinal set.
Graph-bearing version heads and their dependency arrays are defensively frozen;
duplicate edges collapse in first-occurrence order; a registry key must equal
the stored `nodeId`; and the reverse index changes only after an accepted
versioned write, removing stale edges on a rewrite. `dependentsOf()` preserves
historical insertion order and Kahn build ordering consumes the shared index.
The mutable derived index is neither durable state nor digest-, audience-,
publication-, or evidence-authoritative graph content.

The recursive package path accepts only an exact cache instance, invokes its
captured base implementation rather than a caller override, and independently
reverifies the cached Plan against the exact source. It then revalidates both
source graphs, sealed Factory and Plan bindings, the inert packageable Plan,
Factory packaging policy, complete Part closure, maximum dependency depth, and
external Interface surface. It emits one digest-valid composite
`GenesisPartV1` candidate with direct Assembly-member dependencies and a
separate internal descriptor carrying the full transitive closure. Because the
Part content digest deliberately excludes its logical `partId`, the package
identity binds both `candidatePartId` and `candidatePartContentId`; an existing
logical ID or equivalent content under another logical ID fails closed.
Required external evidence remains `required-not-collected`, package state
remains `awaiting-external-execution-and-verification`, and publication
eligibility remains false.

RF-GE3 acceptance recorded 13/13 browser cases with zero console errors, 75/75
frozen browser regressions, 25/25 cross-gate Python Genesis vectors including
nine JavaScript/Python digest stages, and a 39-module isolated bundle with zero
skipped modules. Those counts prove the bounded authoring gate; they do not
certify an Engine, ECS, WebGPU OS, or Virtual Realm runtime.

None is a Virtual Realm runtime activation claim. RF-GE2 plans and RF-GE3
package candidates are explicitly data-only, authority-free, runtime-inactive,
and `not-executed`. The compiler, pack, cache, and package-candidate compiler do
not execute a Factory, resolve or
invoke host implementations, collect runtime evidence, persist or publish a
plan or candidate, publish or mutate an authored or persistent registry,
install a Part, or select an active head. The
complete Genesis catalog, extension loader, M2 runtime, M3 projections, and all
live ecological domains remain planned. The existence of this page, static
Foundry geometry, accepted inert catalogs and plans, or adjacent Engine Matter
support is not runtime evidence. (Sources:
`webgpu-os/apps/the-virtual-realm/contracts/VirtualRealmContractCatalog.js`;
`webgpu-os/apps/realmforge/virtual-realm/RealmForgeBakeEntry.js`;
`webgpu-os/apps/realmforge/modeler/genesis/GenesisEcologyDomainPackV1.js`;
`webgpu-os/apps/realmforge/modeler/genesis/GenesisAuthoredRegistryV1.js`;
`webgpu-os/apps/the-virtual-realm/genesis/contracts/GenesisPartsContractCatalogV1.js`;
`webgpu-os/apps/the-virtual-realm/genesis/contracts/GenesisPartsGraphValidatorV1.js`;
`webgpu-os/apps/the-virtual-realm/genesis/contracts/GenesisConstructiveContractCatalogV1.js`;
`webgpu-os/apps/the-virtual-realm/genesis/contracts/GenesisGenomeContractPrimitivesV1.js`;
`webgpu-os/apps/realmforge/modeler/genesis/GenesisFactoryPlanCompilerV1.js`;
`webgpu-os/apps/realmforge/modeler/genesis/GenesisEcologyConstructiveDomainPackV2.js`;
`webgpu-os/apps/realmforge/blueprint/AssetDependencyGraph.js`;
`webgpu-os/apps/realmforge/modeler/genesis/GenesisIncrementalPlanCacheV1.js`;
`webgpu-os/apps/realmforge/modeler/genesis/GenesisRecursivePackageCompilerV1.js`;
`webgpu-os/apps/realmforge/modeler/genesis/rf-ge2/index.js`;
`webgpu-os/apps/realmforge/modeler/genesis/rf-ge3/index.js`;
`MD/webgpu-os/realmforge-genesis-ecology.md`;
`MD/webgpu-os/virtual-realm/m2-runtime-foundation.md`;
`MD/webgpu-os/virtual-realm/m3-living-city-runtime.md`.)

RF-GE4 and RF-GE5 complete only bounded, inert RealmForge interpreter and
ecology-evidence authoring gates. RF-GE6 and later RealmForge gates, M2-GE,
M3-GE, and every live projection gate remain planned. No Virtual Realm
milestone can be claimed until its required RF-GE gates and M2 base-runtime
prerequisites pass independently.

## Flat RF-GE2 through RF-GE5 handoff map

RF-GE2 through RF-GE5 hand off immutable data and verification evidence between
peer systems. They do not hand off live objects, callbacks, storage handles,
capabilities, executable stages, ECS commands, renderer resources, or active-
head authority.

| Plane | Delivered RF-GE2/RF-GE3 substrate | Delivered RF-GE4 evidence | Delivered RF-GE5 evidence | Permitted handoff now | Still-required independent gate |
| --- | --- | --- | --- | --- | --- |
| RealmForge authoring | Flat Parts and Genome graphs, deterministic digest-bound `GenesisExecutionPlanV1`, exact verified-Plan reuse, dependency-invalidation evidence, and an inert composite-Part candidate | Twelve typed authored-program records, eight deterministic interpreter fragments, exact aggregate Plan/context verification, and sealed implementation locks | Eleven typed evidence-program records, ten deterministic evidence fragments, exact RF-GE4 closure/Plan binding, and a sealed verification-only trust pack | Review, compare, preview, invalidate, reprepare, and byte-verify immutable authoring evidence | RF-GE6 projection grammar/world kits; later external execution, evidence collection, registry publication, installation, and active-head selection |
| Recipe system | Ten-operation Factory plan, canonical closure, ready groups, budgets, expected outputs, binding receipts, exact-hit work elimination, and metadata-only dependency-fragment reuse | Data-only development/regulation/homeostasis/cognition/embodiment/inheritance/reaction program grammar and deterministic interpreter Plan | Data-only lineage/ecology/recognition/role/culture/QD/variation/memory/lifecycle/organismality evidence grammar and deterministic evidence Plan | Reuse an original verified Plan only under its complete identical key and inspect typed fragments as authoring evidence | Generic Engine recipe-kernel extraction, semantic-fragment admission, scheduler parity, durable artifact policy, trusted execution, and independent evidence capture |
| Dependency graph | Content-addressed forward closure plus a shared process-local reverse index, old/new reverse-closure diffing, FIFO-safe pruning, and namespace-local invalidation | Closed authored-program graph and exact interpreter-fragment dependencies | Complete RF-GE4 closure plus evidence-program/fragment dependency, lineage, audience, participant, and variation-target proofs | Mark authoring candidates, previews, or future bake inputs dirty by exact content identity and verify closed graphs | Versioned persistent dependency artifacts, recovery/rebuild, authority-reviewed invalidation, retention, and runtime admission |
| Engine | Data-only Plan coordinates that no RealmForge provider can resolve or invoke, plus frozen cache/package evidence without callable implementation | Inert authored programs and interpreter fragments only | Inert evidence programs and evidence fragments only | Revalidate inputs, estimate future work, and stage an inert candidate outside the live World | Trusted operation resolution, resource reservation, isolated execution, deterministic replay, evidence capture, and rollback |
| ECS | Immutable construction/program/evidence descriptions only | No component mutation, command buffer, schedule, or entity state | No component mutation, command buffer, schedule, or entity state | Offline validation and planning only | Chunk/dirty-generation substrate, fixed commit barrier, admitted phenotype mapping, save/restore, and authoritative observation |
| WebGPU OS | No kernel capability, storage transaction, publisher, persistent cache, package authority, or current-root decision | No execution/admission port and no persistence or authority | No execution/admission port, identity mint, self-modification, or authority | Accept records only as untrusted-to-runtime authoring input | Independent source resolution/recompilation, current policy/capability admission, exact metering, execution, promotion CAS, revocation, and rollback |
| Virtual Realm | No visible world state; at most a separate non-colliding, non-navigable, non-public owner-local authoring preview with explicit evidence debt | No developmental, cognitive, embodiment, inheritance, regulation, or reaction world state | No lineage, role, culture, QD, lifecycle, organismality, or environmental-memory world state | Inspect source and verification evidence only in a separately labelled owner-local authoring surface | RF-GE6 reviewed static kits, stable bake, admission, staging, atomic reproject, ECS confirmation, audience projection, and truthful runtime observations |

An RF-GE3 invalidation may dirty an authoring preview or future bake candidate;
RF-GE4/RF-GE5 graph or binding failure may invalidate their authoring evidence.
Neither action can delete or move a live ECS entity, rewrite stable geography,
advance a Foundry lifecycle, open a route, create a public shell, or authorize a
Storylet outcome. Any later Engine or WebGPU OS consumer must resolve the exact
source under current trust policy, independently compile and verify it, and
admit it through the normal authority and commit path before the Virtual Realm
may present completion. The cross-track sequence and RF-GE6 next gate are fixed
by the [Genesis Ecology program continuity ledger](../../concepts/genesis-ecology.md#program-continuity-ledger).

## Experience lock

Grounded first person remains the only traversal mode for Travelers, visitors,
multiplayer encounters, trains, bridges, Code Matter inspection, and replay.

The sole overview exception remains the explicitly entered, authenticated,
owner-private Local City Operations View for exactly the local operator's own
Cityform. It may provide bounded isometric or eagle-eye framing and an own-city
minimap. It cannot follow a Traveler, navigate, survey a connected Cityform, or
gain authority. Genesis Ecology adds owner-local management projections to that
existing view; it does not add another camera mode.

## Base-bake sidecar

RF-GE6 plans `GenesisRealmExtensionManifestV1` as an inert, unpublished
72-field sidecar. It binds one exact base-bake ID/digest; its exact compilation
input receives the complete accepted base manifest and signed base-layout
receipt, derives their ID/digest bindings, and covers both records. It also
binds its own audience projection and source revision, six-kit district
assembly, unsigned `GenesisSpatialLayoutEvidenceV1`, projection
grammar, owner-only Genesis Operations evidence rows where applicable,
compiler/domain-pack identities, both resource-limit profiles, exact work
accounting, dependency closure, and issue/expiry logical ticks. Its publisher
and signature fields are exactly `null`; it is not independently activatable.

Those owner-only rows are embedded in unsigned layout evidence; public and
refined evidence carries literal `null` Operations fields. RF-GE6 does not
construct `LocalOperationsLookupResourceContract`. RF-GE8 may do so only after
accepting a signed extension-layout receipt and deterministically revalidating
the converted lookup against the unchanged accepted contract.

The 72-field V1 manifest has no Storylet field. RF-GE7 may produce a separate
24-field data-only `GenesisStoryletExtensionManifestV1` plus unsigned Storylet-
compilation evidence, with a one-way ID/digest binding to the RF-GE6 manifest.
RF-GE8 alone may bind both into reviewed publication,
an accepted signed `RealmSpatialLayoutReceiptContract`, rollback, admission,
and activation evidence.

It never adds keys to the accepted base manifest or the frozen 109-contract
catalog. M2-GE may load static Continuity Core, Foundry District, and
Maintenance Works kits plus reserved sockets. All live phenotype and ecology
begins in M3. The exact district grammar is in
[World districts and facilities](world-districts.md).

## The city is a truthful developmental body

Each Cityform is the public spatial body of one computer or admitted higher-order
system. Its persistent structure reflects a verified authored topology. Its
moment-to-moment behavior reflects audience-safe observations. Its history is
represented by lineage and Chronicle evidence.

The mapping is:

| Digital reality | Stable world form | Live presentation |
| --- | --- | --- |
| Soul Seed identity root | Invariant causal-origin/policy core or signed continuity chamber | Presence and lineage attestations, never secret seed material |
| Eidos identity | Stable admitted organism-continuity seal under exactly one Soul Seed root | Versioned phenotype and predecessor heads |
| Product genome | Structural lattice, developmental grammar, and assembly grammar | Currently expressed modules highlighted |
| Factory genome | Foundry plan, constructor/interpreter halls, test and recursive-packaging paths | Build queue and admitted operation state |
| Regulatory network | Signal rails, shutters, gates, switching membranes | Bounded pulses and activation state |
| Epigenome | Retained seals, overlays, marks, and routing bias | Mark strength, scope, age, and decay |
| Homeostasis | Stabilizer towers, reservoirs, regulators, and maintenance loops | Target bands, error, recovery, and degraded state |
| Cognitive world model | Observatory, hypothesis tables, and bounded belief-map surfaces | Attributed observations, predictions, uncertainty, counterfactuals, and prediction error |
| Endogenous goals | Inquiry desks, investigation routes, and proposal beacons | Curiosity, information-gain, or homeostatic goal proposals and authoritative outcomes |
| Phenotype | Current buildings, machines, surfaces, and public silhouette | Health, work, traffic, and temporary adaptation |
| Embodiment | One or more admitted body/host facilities bound by a continuity route | Current sensors, compute, storage, energy, movement, communication, migration, and host loss |
| Inheritance and environmental memory | Lineage channels plus roads, books, repositories, institutions, and durable works | Attributed genetic, epigenetic, developmental, behavioral, cultural, computational, and environmental inheritance events |
| Resource ecology | Warehouses, reservoirs, feeds, and reclamation systems | Authenticated flow, pressure, contention, and shortage |
| Reaction ecology | Workshops, junctions, chambers, and exchange tables | Actual reaction proposals, receipts, flux, and failure |
| Program ecology and recognition | Symbiosis docks, competition lanes, quarantine/test chambers, and immune checkpoints | Cooperation, competition, mutualism, parasitism, damage, recognition, quarantine, repair, rejection, and release evidence |
| Role ecology | Work cells, stations, guild halls, and service districts | Recognized occupancy, confidence, release, and vacancy |
| Cultural belief space | Libraries, archives, schools, forums, and civic-memory towers | Attributed transmission, confidence, adoption, dissent |
| Quality Diversity (QD) archive | Museum, seed vault, or possibility garden | Archive coverage and admitted candidate comparisons |
| Lineage | Vertical (+Y) ancestry strata, roots, and Chronicle trails | Birth, recombination, repair, divergence, dormancy |
| Dormancy | Dark but addressable cold archive | Dormant, archived, extinct, and deleted remain distinct |
| Higher-order organism | Signed continuity field around cooperating flat entities | Assessment evidence and separately authorized mint state |
| Metamorphosis and pruning | Phase gates, repair scaffolds, dormant branches, and decomposition lines | Admitted stage transition, reroute, replacement, pruning, apoptosis, salvage, and rollback evidence |

The visual grammar never claims that an attractive structure is alive or
conscious. It shows exact state classes and their evidence.

## The Software Foundry

Constructive metabolism appears as a real factory district, not a decorative
crafting menu. It contains:

- immutable part vaults indexed by content identity;
- interface docks that expose typed sockets and compatibility;
- product-genome design halls;
- factory-genome control halls;
- staging bays for isolated candidate assemblies;
- build, break, repair, fuse, split, specialize, generalize, recombine,
  recycle, and mutate lines;
- test chambers for correctness, security, performance, and privacy;
- repair bays bound to real fault and repair receipts;
- recycle vaults that show admitted recovery and zeroization state;
- packaging bays where verified assemblies become reusable parts;
- QD archives that preserve distinct viable designs rather than one winner.

Every visible operation has a lifecycle state:

| State | Meaning in the world |
| --- | --- |
| Authored | A reviewable description exists; no execution is implied |
| Proposed | A bounded operation request was submitted |
| Compiling | An isolated plan is being prepared |
| Evaluating | Declared tests and budgets are running |
| Rejected | The candidate did not gain activation authority |
| Accepted | An authority receipt admits the candidate for commit |
| Activating | The ECS is applying the transition at its commit barrier |
| Active | Authoritative observation confirms the phenotype |
| Degraded | An admitted invariant is outside its target band |
| Repairing | An authorized repair operation is active |
| Rolled back | Last-good state was restored |
| Packaged | A verified assembly is available as an immutable part |
| Recycling | Authorized teardown and recovery are occurring |

Light, sound, signs, and Storylets may explain a state. They cannot advance it.

RF-GE3 evidence is not a visible Foundry lifecycle transition. Its inert Part
candidate cannot appear as evaluating, accepted, active, packaged, or recycling
until later external execution, evidence, authority, commit, publication, and
projection gates produce the corresponding authoritative records.

## Stable geography versus live ecology

RealmForge owns stable spatial memory:

- district placement;
- building footprints;
- roads and permanent conduits;
- navigation anchors and collision;
- factory, archive, role, cultural, and station kits;
- LOD, materials, public silhouette, and disclosure bindings.

The Engine and WebGPU OS own live truth:

- current entities and phenotype heads;
- expressed regulation and homeostatic measurements;
- reactions, resources, processes, traffic, and work;
- faults, repairs, activation, dormancy, and rollback;
- role recognition, cultural transmission, and lineage events;
- authority, capability epochs, revocation, and network presence.

A live delta animates an existing admitted anchor. It cannot create a permanent
street, building, socket, or bridge. A durable environmental adaptation becomes
geography only through a new topology revision, isolated RealmForge bake,
verification, staging, and atomic reproject. This protects spatial memory and
prevents the city from thrashing whenever a regulatory signal changes.

## Roads are semantic, not arbitrary graph edges

The world uses several visually distinct connection classes:

| Connection | World form | Source of truth | Traversable? |
| --- | --- | --- | --- |
| Containment | Streets, blocks, floors, and +Z strata | Filesystem and package hierarchy | Only where a verified route exists |
| Dependency | Utility conduits, cable trays, or service tunnels | Module, asset, and recipe dependency closure | Usually no |
| Interface/service | Docks, ports, pipes, and local transit lanes | Typed provides/requires interfaces | Only by authored navigation policy |
| Resource flow | Freight lines, reservoirs, and supply pipes | Admitted resource-flow observations | No automatic traversal |
| Regulatory signal | Luminous signal lanes and switching gates | Regulatory snapshot | No |
| Cultural transmission | Attributed civic routes and archive links | Cultural transmission receipts | No |
| Lineage | Root paths and Chronicle trails | Append-only lineage evidence | Inspectable, not ordinary travel |
| SecureMesh route | Rail, platform, train, switch, and destination board | Audience-safe live network evidence | Only after capability and bridge admission |
| Authority | Gate, checkpoint, seal, and epoch indicator | WebGPU OS capability and receipt state | The actual security check is non-visual |
| Construction logistics | Foundry track, staging route, and packaging line | Constructive operation plan and receipts | Local factory movement only |

An arbitrary edge in a code, role, belief, or dependency graph does not become a
road. A road exists only when its semantic class has a projection rule and its
endpoints have an admitted spatial binding.

## SecureMesh remains the train station and hub

SecureMesh Exchange is the visible center of networking. Real connections
create typed station observations:

- a discovered peer may create an audience-safe arrival indication;
- an authenticated presence may occupy an admitted platform;
- a route negotiation may animate switches without implying access;
- a capability grant may open the corresponding local gate for its epoch;
- traffic may appear as bounded trains, packets, or freight when disclosure
  allows it;
- revocation closes gates and invalidates dependent bridge epochs;
- disconnect, expiry, or split-brain resolution tears down the live route.

The station does not authenticate, authorize, connect, or route by animation.
It reflects receipts and observations from the SecureMesh and authority ports.

## Cityforms meet like people

Each user's computer travels through the shared digital world as a Cityform.
When two public presences enter an admitted rendezvous range, clients may stage
their prebaked public Cityform shells near each other. This makes the computers
physically present without exchanging their private worlds.

The encounter sequence is:

1. Each client already owns its private bake and a separately compiled public
   shell.
2. SecureMesh exchanges public presence, shell identity, rendezvous frame, and
   compatible protocol evidence.
3. Each client verifies the remote public package before staging it.
4. The rendezvous protocol computes deterministic relative Cityform poses.
5. Local stations select compatible public sockets.
6. A connection request produces a proposed route and bridge closure.
7. Exact capabilities determine which endpoints and resources may be included.
8. Each side independently bakes or verifies its permitted bridge half.
9. Traversal opens only after matching epochs, authority, geometry, collision,
   navigation, and bridge receipts exist.
10. Revocation or disconnect disposes the bridge and remote live deltas while
    the public shell may remain only under its cache and presence policy.

The remote shell is a complete visual product, not a blurred reconstruction of
private data. It is prebaked from explicit public appearance inputs. A viewer
can see another Cityform as a coherent city while private filesystem names,
source, processes, permissions, exact topology, genome, epigenome, learner
state, culture, and private routes are structurally absent from the package.

This is the world equivalent of seeing a building exterior without receiving
its private floor plans or records.

## Code Matter is real code

Code Matter has three visible disclosure states:

1. **Sealed**: geometry and non-reversible public appearance only.
2. **Structured**: authorized type, syntax, dependency, or module structure
   without exact source bytes.
3. **Revealed**: exact authorized bytes, tokenized for the exact revision and
   visible range.

The falling or surface glyphs are not fake Matrix-style filler. Revealed glyphs
map to the real authorized token stream. Structured glyphs map to disclosed
syntax or semantic records and are visually distinct from exact source.
Decorative code-like noise is prohibited because it would be indistinguishable
from data.

The renderer never opens source. `CodeMatterSourcePort` supplies only the exact
authorized object, revision, range, and lease. The vault, tokenizer, line
streamer, private atlas, and renderer remain separate peers. Remote public
shells cannot carry reversible private glyph data. (Sources:
`MD/webgpu-os/virtual-realm/code-matter.md`;
`MD/webgpu-os/virtual-realm/architecture.md` lines 445-457.)

## Development in the world

Development is presented as a sequence of evidence-bound states:

- an authored grammar appears as a reviewable lattice;
- a candidate stage appears only in a visibly isolated preview or test chamber;
- passed validation illuminates the relevant evidence surfaces;
- accepted activation moves through the ECS commit barrier;
- confirmed phenotype change updates the stable object bindings;
- rejected branches remain in the QD archive or Chronicle when retention allows;
- repair, specialization, and recombination expose their lineage rather than
  pretending the result appeared from nowhere.

Prospective geometry is always styled as a proposal. It has no collision,
navigation, object authority, or public presence until activated.

## Regulation, artificial signals, and homeostasis

Regulatory state can be understood spatially without rebuilding the city:

- signal lanes carry bounded pulses between admitted anchors;
- gates show activation or suppression;
- epigenetic marks show retained bias, scope, strength, age, and decay;
- homeostatic towers display target bands and measured error;
- recovery routes show an active authorized response;
- degraded state is distinguishable from unknown, stale, unavailable, and
  intentionally undisclosed state.

Together these typed lanes form the visible Regulatory Signal Fabric. They do
not form a second authority or a decorative activity generator.

The signals correspond to actual normalized state. The renderer applies LOD and
aggregation, but it cannot invent activity to make the city appear alive.

## Cognition, learning, and endogenous goals

The Virtual Realm presents an organism's world model as attributed belief, not
as reality. An authorized cognitive projection may show observations,
predictions, confidence, uncertainty, causal hypotheses, counterfactuals, and
prediction error. Every surface carries the existing assertion, provenance,
evidence-quality, audience, freshness, and temporal axes.

Learning, development, evolution, and culture use distinct visual grammar and
logical clocks:

- learning changes knowledge or policy within one admitted phenotype;
- development changes lifetime structure through a staged phenotype proposal;
- evolution proposes inherited grammar or variation-regime changes between
  lineages;
- culture changes attributed shared knowledge through transmission.

Homeostatic error, curiosity, novelty, or expected information gain may produce
an endogenous goal proposal. The world can show the proposal, alternatives,
selection evidence, and later outcome. It cannot present a believed cause as an
observation, a proposed goal as an action, or a predicted result as completed.

## Inheritance, embodiment, and niche construction

The world distinguishes genetic, epigenetic, developmental, behavioral,
cultural, computational, and environmental inheritance. Lineage routes identify
the channel and evidence. Environmental inheritance appears through admitted
external memory such as roads, irrigation, buildings, books, repositories,
institutions, markets, and network topology; those artifacts are not copied
into a descendant's Soul Seed.

An Eidos may inhabit one body or a distributed admitted host set. Its visible
morphology exposes only audience-safe sensor, compute, storage, energy,
movement, and communication affordances. Host loss, migration, component
replacement, repair, or metamorphosis changes the phenotype while the stable
continuity route identifies whether it remains the same Eidos. A renderer never
infers continuity from visual similarity.

Niche construction closes the ecology loop: an organism can propose a durable
world change that alters later selection pressures. Live evidence first creates
only a powerless topology intent. Stable geography changes only after external
admission, isolated RealmForge compilation, verification, staging, and atomic
activation. Roads and facilities therefore become truthful environmental memory
without allowing transient adaptation to thrash the city.

## Reaction ecology

Reaction rules describe what transformations are possible. Reaction events
record what was proposed, admitted, consumed, produced, failed, or rolled back.

In the world:

- resources retain identity and quantity semantics appropriate to the audience;
- catalysts appear as required facilities or services rather than consumed
  products;
- contention and shortage use explicit state, not random visual congestion;
- failed reactions retain fault and compensation evidence;
- bounded local reactions may animate at runtime;
- durable new facilities still require a bake transition.

Reaction indexes select only rules affected by changed inputs. Whole-city rule
scans on every frame are prohibited.

## Program ecology and immune recognition

Programs and modular assemblies may have evidence-backed cooperation,
competition, mutualism, commensalism, parasitism, predation, and resource-
exchange relations. The projection identifies the relationship, participants,
scope, observed effects, confidence, and time interval. It does not infer an
ecological label from proximity or shared color.

Recognition profiles distinguish self, trusted descendants, admitted symbionts,
unknown, damaged, and hostile classifications. The city can show tolerate,
test, quarantine, reject, repair, and release proposals or receipts through
explicit checkpoints and chambers. Visual recognition never replaces kernel
validation, security policy, storage quarantine, or capability revocation.

## Roles and niches

A role district is not created because an entity was assigned a class name. It
appears when versioned recognition criteria are satisfied by admitted evidence.

The projection distinguishes:

- possible role supported by authored infrastructure;
- candidate role under evaluation;
- recognized active role;
- degraded or contested role;
- released or vacant role;
- historical role retained only in Chronicle.

Role recognition never grants a capability. A service role can make an entity
eligible for an action request, but the normal WebGPU OS authority path still
decides whether that action occurs.

Role proliferation can propose new functional vocabulary when recurring
interactions do not fit the current role catalog. Persistent cooperation may
also produce collective-integration evidence for a guild, institution, city, or
distributed system. Those major transitions may stage an organization-first or higher-order
organism proposal, but only a separate mint authority can establish a new Soul
Seed. Existing participant identities remain intact.

## Culture and belief spaces

Cultures can form visible libraries, forums, schools, practices, and civic
memory without converting belief into fact. Each presentation carries:

- source and audience;
- assertion class: observed, asserted, inferred, hypothetical, simulated, or
  decorative;
- confidence and disagreement where applicable;
- transmission path and logical time;
- privacy and retention class.

Cultural state can influence factory proposal selection, role expectations,
Storylet eligibility, and environmental design preferences. It cannot override
kernel constraints, privacy policy, compiler limits, or authority.

Transmission follows explicit social topology: trust, kinship, trade,
geography, language, teaching ability, communication infrastructure, and noise.
The receiver's resulting belief may differ from the source. The projection
retains attribution, transformation evidence, disagreement, and uncertainty
instead of presenting culture as a magically synchronized faction value.

## Quality-diversity archive

The archive is a navigable possibility space for authorized local users. It can
show different viable assemblies across declared descriptor axes, their lineage,
tradeoffs, tests, and niches. It does not rank one universal champion.

In first person, the archive appears as a museum, vault, garden, or observatory.
The Local City Operations View may show an owner-private aggregate map for the
local archive only. Remote archives are absent unless explicitly published as
their own public products.

## Dormancy, extinction, pruning, and recycling

These states use different places and visuals:

- a dormant entity moves to a cold but addressable chamber;
- an archived candidate remains immutable evidence without a live body;
- an extinct lineage has no admitted live instances under the named scope;
- a known-extinct lineage retains engine or Chronicle provenance but no
  world-accessible instance;
- a forgotten lineage has lost the policy-permitted world and historical
  references required for ordinary reconstruction;
- a pruned structure follows an authorized teardown and reference policy;
- a recycled assembly exposes recovered parts and disposal evidence;
- deleted private data leaves only the retention evidence permitted by policy.

Darkness or absence is not proof of deletion. The exact lifecycle state comes
from its evidence record.

Metamorphosis, structural self-repair, pruning, and apoptosis are shown as
distinct admitted transitions. Repair targets a viable organization rather than
requiring byte-for-byte restoration of the prior structure. Decomposition and
salvage retain the lineage and recovered-part evidence allowed by policy.

## Soul Seeds, organismality, and higher-order forms

The Soul Seed is represented by a stable causal core across phenotype changes.
Its visible identity binds to an immutable root and mint receipt, not to current
appearance.

An organismality assessment may evaluate boundary maintenance, repair,
coordinated resource use, internal regulation, persistence, and causal closure.
The result can appear as an evidence field around cooperating entities. It does
not automatically create a new person, owner, capability domain, or Soul Seed.

A higher-order Soul Seed requires a separate proposal and explicit mint
authority. If accepted, the collective remains a graph of flat entities and
relations. The visual field does not imply a nested runtime manager.

Seed-first and organization-first origins use the same continuity rules after
minting. Their different origin evidence remains visible in lineage and
Chronicle projections.

## Storylet Algebra in the world

Storylet Algebra composes declarative scenarios over roles, relations,
developmental stages, reactions, beliefs and uncertainty, endogenous goals,
inheritance, embodiment, recognition, niche construction, evidence, and
lifecycle states. Useful
Storylets include:

- first construction and package orientation;
- guided repair with truthful fault and receipt updates;
- role apprenticeship and recognition ceremonies;
- cultural transmission and disagreement;
- resource shortage, recovery, and explanation;
- dormancy, reactivation, lineage reunion, and Chronicle replay;
- SecureMesh arrival, inspection, exchange, and bridge opening;
- QD archive tours comparing real candidate evidence.

The algebra compiles into the existing data-only Storylet boundary. Presentation
commands remain reversible. Action requests remain powerless. A Storylet waits
for the authoritative receipt and observation before presenting completion.

## Local City Operations View

The owner-private Operations View gains local-only management surfaces for:

- zone placement proposals for factories, archives, cultural sites, and role
  facilities;
- current bake and topology revision;
- local phenotype, homeostasis, resource, repair, and dormancy summaries;
- local recipe queues and candidate evaluation status;
- local QD coverage and lineage aggregates;
- admitted local roads and facilities;
- alerts and proposed rebakes.

It does not show remote Cityforms, remote routes, remote shells, remote roles,
remote culture, remote genome data, rendezvous coordinates, bridge geometry, or
connected-city activity. SecureMesh may show only content-free local platform
boundary state. All changes leave the view as generic action proposals and wait
for external authority receipts.

## Rendering and performance

The renderer separates four products:

1. **Stable static bake**: geography, collision, navigation, anchors, HLOD,
   public silhouette.
2. **Live ECS instances**: admitted phenotype, activity, signals, resources,
   roles, and events.
3. **Private Code Matter**: lease-bound exact glyph pages and visible ranges.
4. **Presentation layer**: Storylets, accessibility, provenance, uncertainty,
   selection, and operator UI.

Performance rules:

- no full rebake for high-frequency state;
- no full-world query for one changed signal, reaction, role, or recipe;
- use ECS dirty generations and bounded delta reducers;
- use semantic LOD: distant state becomes truthful aggregates, not fabricated
  details;
- stream public shell cells before proximity encounters;
- retain compatible coordinates and cache routes/HLOD independently;
- batch independent plan and digest work without changing canonical order;
- GPU evaluates bounded data-parallel fields and instances, while CPU policy
  remains authoritative;
- every private atlas, world cell, candidate preview, and remote shell has an
  explicit lifetime and disposal path.

## Required future projection records

RF-GE6 plans exactly these 16 flat records in its separate catalog, not in
M0-M1C or the accepted 109-record Virtual Realm catalog:

- `GenesisProjectionRuleV1`
- `GenesisProjectionGrammarV1`
- `GenesisWorldKitV1`
- `GenesisWorldKitReviewReceiptV1`
- `GenesisDistrictAssemblyV1`
- `GenesisSpatialLayoutEvidenceV1`
- `GenesisStablePlacementIndexV1`
- `GenesisCoordinateRetentionReceiptV1`
- `GenesisRelocationReceiptV1`
- `GenesisAccessibilityClosureReceiptV1`
- `GenesisDisclosureVerificationReceiptV1`
- `GenesisPublicNoninterferenceReceiptV1`
- `GenesisRefinementIsolationReceiptV1`
- `GenesisRealmExtensionManifestV1`
- `GenesisProjectionCompilationReceiptV1`
- `GenesisProjectionVerificationReceiptV1`

RF-GE6 derives candidate static projection bindings and static world products
that validate against the accepted contract definitions; it does not create a
replacement `GenesisProjectionBindingV1`, live observation,
projection-delta, topology-admission, or signed layout-receipt contracts. Later
VR-GE2+ work may separately specify live-domain observation, delta, lineage,
collective-continuity, and topology-admission records without changing this
frozen RF-GE6 catalog.

Each live domain uses closed observation, projection-delta, and owner-private
lookup records rather than an open payload bag:

| Domain | Planned observation records | Planned projection and lookup records |
| --- | --- | --- |
| Development and phenotype | `GenesisDevelopmentObservationV1`, `GenesisPhenotypeObservationV1`, `GenesisStructuralRepairObservationV1` | `GenesisPhenotypeProjectionDeltaV1`, `LocalGenesisDevelopmentLookupV1` |
| Regulation and homeostasis | `GenesisRegulationObservationV1`, `GenesisHomeostasisObservationV1`, `GenesisCausalClosureObservationV1` | `GenesisRegulationProjectionDeltaV1`, `LocalGenesisHomeostasisLookupV1` |
| Foundry, resources, and reactions | `GenesisConstructiveMetabolismObservationV1`, `GenesisResourceFlowObservationV1`, `GenesisReactionObservationV1` | `GenesisFoundryProjectionDeltaV1`, `LocalGenesisFoundryLookupV1` |
| Cognition and endogenous goals | `GenesisCognitiveWorldModelObservationV1`, `GenesisPredictionErrorObservationV1`, `GenesisEndogenousGoalObservationV1` | `GenesisCognitionProjectionDeltaV1`, `LocalGenesisCognitionLookupV1` |
| Embodiment and metamorphosis | `GenesisEmbodimentObservationV1`, `GenesisHostContinuityObservationV1`, `GenesisMetamorphosisObservationV1` | `GenesisEmbodimentProjectionDeltaV1`, `LocalGenesisEmbodimentLookupV1` |
| Inheritance and niche construction | `GenesisInheritanceObservationV1`, `GenesisEnvironmentalMemoryObservationV1`, `GenesisNicheConstructionObservationV1` | `GenesisInheritanceProjectionDeltaV1`, `LocalGenesisInheritanceLookupV1` |
| Program ecology and recognition | `GenesisProgramEcologyObservationV1`, `GenesisRecognitionObservationV1`, `GenesisImmuneResponseObservationV1` | `GenesisEcologyProjectionDeltaV1`, `LocalGenesisEcologyLookupV1` |
| Roles, culture, and social topology | `GenesisRoleObservationV1`, `GenesisCultureObservationV1`, `GenesisSocialTopologyObservationV1` | `GenesisRoleCultureProjectionDeltaV1`, `LocalGenesisRoleCultureLookupV1` |
| QD, lineage, and meta-evolution | `GenesisQualityDiversityObservationV1`, `GenesisLineageObservationV1`, `GenesisEvolutionRegimeObservationV1` | `GenesisEvolutionProjectionDeltaV1`, `LocalGenesisEvolutionLookupV1` |
| Lifecycle and organismality | `GenesisLifecycleObservationV1`, `GenesisPruningObservationV1`, `GenesisApoptosisObservationV1`, `GenesisCollectiveIntegrationObservationV1` | `GenesisLifecycleProjectionDeltaV1`, `LocalGenesisLifecycleLookupV1` |

Each record binds an audience, bake revision, policy, dependency closure,
evidence references, freshness, quality, claim axis, and resource ceiling.

## Integration gates

| Gate | World capability | Acceptance evidence |
| --- | --- | --- |
| VR-GE0 | Projection vocabulary and hostile contract vectors | Exact keys, sizes, no-authority, no-fake-data tests |
| VR-GE1 | Owner-private foundry and static Genesis kits | Closure, layout, HLOD, collision, navigation, accessibility |
| VR-GE2 | Live phenotype, regulation, homeostasis, cognition, embodiment, inheritance, resource, and reaction deltas | Ordering, deduplication, belief/fact separation, host-loss, LOD, stale/unknown/disclosed distinctions |
| VR-GE3 | Program ecology, recognition, roles, social topology, culture, lineage, QD, meta-evolution, niche construction, dormancy, metamorphosis, pruning, and organismality evidence | Claim-axis, environmental-memory, privacy, retention, no-security-shortcut, and no-mint-shortcut tests |
| VR-GE4 | Storylet Algebra lowering and runtime presentation | Deterministic decision, powerless requests, Chronicle replay |
| VR-GE5 | Owner-private Operations View additions | Local-only closure and structural remote exclusion |
| VR-GE6 | Public Genesis Cityform shells | Independent public compile and noninterference |
| VR-GE7 | SecureMesh rendezvous and bridge integration | Pose, socket, epoch, capability, revocation, and disposal tests |
| VR-GE8 | Release rendering and long-run ecology | Device matrix, memory, soak, accessibility, privacy, recovery |

These gates align with the existing M2-M7 roadmap. They do not change the
accepted M1 bake foundation. The exact numbered acceptance cases are canonical
in [Certification plan](certification-plan.md#genesis-living-digital-world-gates).

First Shard content remains excluded. No source, test, architecture, mechanic,
art direction, runtime, or dependency from that application participates in
this integration.

## Acceptance definition

The Virtual Realm integration is complete only when a person can walk through a
stable first-person city, inspect real authorized Code Matter, and see a real
Software Foundry `BUILD`, `BREAK`, `REPAIR`, `FUSE`, `SPLIT`, `SPECIALIZE`,
`GENERALIZE`, `RECOMBINE`, `RECYCLE`, and `MUTATE` verified software with
salvage and recursive packaging. The person must also be able to understand
cognition, inheritance, embodiment, regulation, program ecology, roles,
culture, temporal lifecycle, and niche construction through
provenance-bearing visuals, meet another complete prebaked Cityform without
receiving its private data, and traverse a bridge only after both sides prove
the same admitted connection. Anything less is a visualization study, not the
living Digital World.

## See also

- [World districts and facilities](world-districts.md)
- [M2 runtime foundation](m2-runtime-foundation.md)
- [M3 living city runtime](m3-living-city-runtime.md)
- [Cityform encounter runtime](cityform-encounter-runtime.md)
- [M2 Engine and ECS foundation](../../engine/virtual-realm-m2-engine-foundation.md)
- [Certification plan](certification-plan.md)
