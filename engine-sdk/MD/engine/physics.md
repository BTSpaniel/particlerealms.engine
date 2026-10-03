---
title: Physics & Simulation
description: GPU-accelerated cloth, rope, fluids, and rigid bodies — the mass-spring cloth solver, PBD rope, SPH and Eulerian fluids, ECS rigid bodies, PBD ragdoll, and the per-frame simulation order.
updated: 2026-09-29
---

# Physics & Simulation

The Engine combines CPU WebAssembly physics with GPU compute simulations. Its default PhysX adapter runs NVIDIA PhysX 5.11.0 on the CPU; GPU cloth, particles and fluids use their own compute solvers via [vGPU](vgpu.md).

## Shared PhysX 5.11 runtime

The custom Particle Engine build is named **PhysX PE**: `physx-pe.mjs`, `physx-pe.wasm`, and `physx-pe.d.ts`. `physx-js-webidl` identifies the upstream binding project and historical backups; it is no longer the active artifact name.

The [fabmax 5.11 public API review](physx-fabmax-review.md) compares its v2.8.0
release with this custom build and records independently specified enhancement
candidates. Matching SDK versions does not imply matching browser APIs.

Every shared PhysX world uses bounded Rust pose batches in the native heap for
dynamic and kinematic body readback. `world.poseReadbackStats` reports its backend,
registered bodies, batches and snapshot count. Velocity readback retains PhysX's
active-actor filtering, including bodies without ECS entity IDs. World teardown
unregisters actors before releasing their native storage. This removes individual
pose wrapper calls; it is not a measured frame-rate improvement.

RealmForge's rigid-body adapter now creates native PhysX PE bodies and applies
mass, inertia, velocities and restored poses to native actors. ECS, Editor,
construction, active rigs, Vehicle2 and the Playground share this world module.
The LIFE people-preview preflight resolves the same `physx-pe.mjs` loader.

All three release targets audit source physics consumers and ship the same
verified physics inventory. `python bundle_engine.py --target engine --production
--no-site` also rebuilds `release/engine-sdk`; open its `index.html` over HTTP to
check native startup. Platform and OS bundles are separate outputs and must each
be rebuilt after shared Engine changes. Dated validation snapshots remain historical.

`engine/sim/physics/runtime-manifest.json` records the exact custom loader, WASM, declarations, extension modules, shader corpus and upstream licenses. NVIDIA source is pinned to `ovphysx-0.6.3`, commit `da950a3537927784951853c66618036f332ca0ce`, with the fabmax WebIDL browser port. The original fabmax package metadata remains for attribution. The installed artifacts are a locally compiled upgrade.

`engine/sim/PhysicsRuntime.js`, exported as `PE.particlePhysicsRuntime`, provides:

- `ensurePhysXModule()` — the Engine's shared module, with SDK and extension ABI checks.
- `createPhysicsPoseBatch(options)` — Rust-backed native actor pose batching in the physics heap.
- `createPhysicsGpuBridge({ device, adapter })` — explicit WASM/GPU transfers, borrowing the caller's GPU device. `close()` releases its allocations and buffers without destroying that device.
- `BlastFamily(module, { chunks, bonds, health, bondAreasM2, stress })` — persistent native support graphs, accumulated bond damage and opt-in physical-area stress solving.
- `BlastAuthoring(module).fracture(options)` — native convex Voronoi cutting with explicit sites, interior triangles and physical bond geometry.
- `BlastScene(world, options)` — prefractured box or authored convex chunks represented by PhysX compounds. Native Blast splits determine fragment bodies; the adapter preserves mass, transformed poses and linear/angular motion. Anchored chunks hold their connected component until it separates. Legacy scenes call `applyContacts(world.contactEvents)` after stepping and before clearing contact events; physical scenes use `updateStress()` as described below. Dispose the scene before its borrowed world.
- `createFlowSolver({ device, shaderRoot, maxBlocks, cellSize, scene })` — NVIDIA's sparse host graph and coupled GPU solver. Await `step(dt)`; configure emission and its velocity with `setEmitter()` and pressure, combustion and vorticity with `setControls()`. Await `sampleVelocity(xyzPositions)` to gather trilinear world-space air velocities from the sparse atlas, with zero outside allocated cells. Await sampling before the next step or disposal. `dispose()` releases native and GPU resources while preserving the borrowed device.
- `FlowPhysXCollision(world, solver, options)` — native PhysX shapes and poses drive legacy sphere/box velocity obstacles, or opt-in solid transport/pressure boundaries when the installed descriptor advertises that ABI. Neither mode returns gas reaction forces to rigid bodies.
- `verifyPhysicsExtensions({ device, adapter, shaderRoot })` — native Blast Voronoi authoring, fracture/split and physical stress/replay checks, a 4,097-value Rust/WebGPU round trip, a 512-value Flow advection oracle, eight coupled Flow frames, eight sphere/box frames and eight point/mesh frames. Geometry checks sample independent layers against known velocities; obstacle checks measure stationary and moving boundaries. Unsupported devices report the missing feature or compute limits.

### Multiple Flow emitters and layers

`setScene({ layers, emitters })` replaces the authored scene atomically. Each layer
has a stable integer `id`, cell size, gravity and pressure/combustion/vorticity
controls. Emitters have unique IDs, a target layer, position, world-space
velocity and a sphere radius, box `halfSize`, point cloud or triangle mesh.
Transforms use an `xyzw` quaternion.
The scene ABI validates the whole configuration before committing it. Removing
an emitter stops injection while existing field contents continue evolving.
Removing a layer is different: that layer's simulation is retired.

`maxBlocks` is the shared sparse GPU allocation budget for the host, not a
per-layer allowance. Size it for all emitters and for blocks still retiring
after scene changes. When it fills, new emission regions may remain unallocated;
adding a layer does not reserve capacity for it. Inspect `solver.stats.activeBlocks`
and the sampled field when choosing a budget. The Engine transition check uses
64 blocks to exercise an existing field followed by two independent layers.

```js
const solver = await PE.particlePhysicsRuntime.createFlowSolver({
  device,
  scene: {
    layers: [{ id: 0, cellSize: 0.15 }, { id: 1, cellSize: 0.2 }],
    emitters: [
      { id: 1, layer: 0, type: 'sphere', radius: 0.45,
        velocity: [0, 2, 0], temperature: 1, fuel: 0.8,
        smoke: 0.5, coupleRateSmoke: 2 },
      { id: 2, layer: 1, type: 'box', halfSize: [0.4, 0.2, 0.4],
        position: [1, 0, 0], quaternion: [0, 0, 0, 1],
        velocity: [0, 1, 0], temperature: 0, fuel: 0,
        smoke: 0.5, coupleRateSmoke: 2 },
    ],
  },
});
try {
  await solver.step(1 / 60);
  const air = await solver.sampleVelocity(new Float32Array([1, 0, 0]), { layer: 1 });
} finally {
  await solver.dispose();
}
```

Use `setEmitter()` and `setControls()` for the original default single sphere.
After `setScene()`, update the full scene through that method; the legacy setters
reject rather than silently modifying a different emitter. A custom scene's
sampling defaults to layer 0. If it has no layer 0, specify the layer explicitly.
Unknown layer IDs reject. Await a successful step after changing the scene before
sampling newly added layers; their native metadata is produced by simulation.
`output.layers` reports the native layer IDs, world
block dimensions and packed layer/level keys used for sparse sampling.

Scene emitters use shared bridge defaults, including
velocity `[0, 0, 400]`, so applications should set velocity and dimensions
explicitly. Coupling rates control relaxation toward target fields;
`allocationScale: 0` stops allocating new blocks, and `applyPostPressure` applies
velocity after pressure projection. Neither option provides a resolved solid
boundary or two-way rigid-body collision. Geometry emitters use `allocateMask`
instead of `allocationScale`. See NVIDIA's
[Flow emitter settings](https://docs.omniverse.nvidia.com/kit/docs/flow/latest/settings.html).

### Flow point and mesh emission

The additive geometry ABI preserves scene ABI 1. A `points` emitter takes flat
xyz `positions`. A `mesh` emitter takes the same positions plus `indices`, an
array of unsigned vertex indices in triangle order. Both optionally take flat
xyz `velocities`, with either no entries or exactly one velocity per vertex.
These velocities and the common `velocity` target use world axes. The native
host owns copies: modifying an input array after `setScene()` has no effect.
Submit the scene again to change geometry; stable emitter IDs retain identity
while internal revisions invalidate geometry and topology caches.
Per-vertex colors/density fields, streamed geometry and multi-level emission
controls are not exposed by this geometry ABI.

```js
solver.setScene({
  layers: [{ id: 0, cellSize: 0.1 }],
  emitters: [
    { id: 10, type: 'points',
      positions: new Float32Array([-0.2, 0, 0, 0.2, 0, 0]),
      velocity: [0, 1, 0], temperature: 0, fuel: 0,
      smoke: 0.5, coupleRateSmoke: 2 },
    { id: 20, type: 'mesh',
      positions: new Float32Array([-0.4, -0.4, 0, 0.4, -0.4, 0, 0, 0.4, 0]),
      indices: new Uint32Array([0, 1, 2]),
      position: [1, 0, 0], minDistance: -0.1, maxDistance: 0.1,
      velocity: [0, 0, 1], temperature: 0, fuel: 0,
      smoke: 0.5, coupleRateSmoke: 2 },
  ],
});
```

Points deposit into neighboring grid cells with native quantized trilinear
weights. They are emission samples, not independently simulated particles or
spheres. This single-level API rejects point widths and radii because the
upstream width settings affect level selection rather than a splat radius here.
Meshes emit in the signed-distance shell between `minDistance` and `maxDistance`
(defaults −0.8 and 0.3); `orientationLeftHanded` reverses the normal convention.
This is emission from a surface, not a solid collision boundary. Sparse mesh
allocation follows vertices and neighboring blocks, so tessellate large surfaces
or preallocate their interior region rather than assuming a huge triangle
allocates every intersected block.
The pinned upstream nearest-triangle routine can report zero distance for an
exactly coplanar sample even outside a triangle. Coverage and nearest-face
selection can therefore be ambiguous in that plane. Per-vertex velocity checks
include off-plane shell samples; this bridge does not claim corrected coplanar
coverage/interpolation or alter NVIDIA's geometry algorithm.

`allocateMask: false` stops geometry from allocating new sparse blocks while
allowing emission into existing blocks. Invalid indices, degenerate triangles,
nonfinite coordinates and mismatched attributes reject before scene replacement.
The browser checks power-of-two native buffer growth against the borrowed
device's storage/buffer limits; mesh hierarchy depth also bounds triangle count.
These admission checks do not promise recovery from process-wide out-of-memory
failures. Native input validation independently checks heap spans and geometry.

Point scan kernels additionally require a device configured for at least eleven
storage buffers per shader stage. The Engine's `physx-flow` GPU capability profile
requests this alongside `float32-filterable` and the 1,024-lane compute limits.
The Playground requests the supported binding count at startup. A borrowed
device cannot be upgraded: point emission rejects an eight-binding device before
changing the scene, while sphere/box/mesh emitters remain available on that
binding limit. The OS baseline rendering profile keeps its existing requirements.

### Flow obstacles driven by PhysX

`solver.setColliders(records)` atomically replaces the obstacle list. Each record
has a persistent nonzero unsigned `id`, an existing `layer`, a sphere `radius`
or box `halfSize`, `position`, and `quaternion`. Optional settings are
`coupleRateVelocity` (default 120/s), `multisample` (true), `enabled` (true), and
`resetMotion` (false). IDs retain independent native transform history across
reordering. New, changed-type and reset obstacles start without teleport velocity.
Remove an obstacle before removing its layer. This ABI accepts at most 1,024 obstacles.

These are NVIDIA velocity emitters applied after the native grid solve. They do
not allocate sparse cells, add scalar fields, create pressure-solver solid cells,
or return reaction forces to PhysX. The grid must already exist in the region.
Coupling relaxes velocity toward rigid motion rather than guaranteeing an exact
no-slip boundary at every rate and timestep. The sphere operator applies two
half-step corrections: at full coverage, 120/s and 1/240 s remove 43.75% of the
velocity difference. A larger rate reaches the target more strongly. Corrections
remain in the canonical velocity texture; allocation feedback observes the
additional correction on the next step. This follows NVIDIA's
[documented collision approach](https://docs.omniverse.nvidia.com/extensions/latest/ext_fluid-dynamics/understanding.html).

Use the Engine adapter to track real native shapes, including compound local
poses, rather than copying potentially stale body arrays:

```js
const coupling = new PE.particlePhysicsRuntime.FlowPhysXCollision(world, solver);
coupling.bind(body, { layer: 0, coupleRateVelocity: 120 });
// For each physical timestep, step world first, then:
await coupling.step(dt);
// After an authored teleport, call coupling.resetMotion(body) before that step.
// Dispose coupling before its borrowed solver and world:
await coupling.dispose();
```

The adapter owns the solver's collider list. It supports sphere/box simulation
shapes, rejects unsupported capsule/mesh shapes, and automatically retires removed
bodies. `setEnabled(body, enabled)` controls a binding; `unbind(body)` removes it
on the next adapter step. It does not own or dispose the bodies, emitters, world,
solver or GPU device. Cloth's sampled Flow airflow remains one-way coupling.
(Sources: `engine/sim/FlowPhysXCollision.js` and the installed Flow host bridge.)

### Solid Flow boundaries and finite sources

Boundary-capable builds advertise `flowSolidBoundaryAbi: 1` in the runtime
descriptor. With that capability, opt in through the same adapter:

```js
const coupling = new PE.particlePhysicsRuntime.FlowPhysXCollision(world, solver, {
  solidBoundaries: true,
});
coupling.bind(body);
// After the PhysX step:
await coupling.step(dt);
```

This mode supports native spheres, oriented boxes, planes and scaled convex
hulls. It reads actual compound shapes and rejects unsupported shapes.
`syncBodies(bodies)` reconciles ownership after fracture;
`setAdditionalGeometry(records)` supplies solved surfaces without a rigid proxy,
such as the sandbox's elastic glass. Additional records need persistent string
keys. Dispose the adapter before its borrowed solver and world.

The underlying `setSolidBoundaries(records)` owns exact geometry used by source
masking, transport and pressure passes. Segment tests catch walls thinner than
a grid cell; boundary-aware interpolation excludes donors across those walls.
The pressure pass caches its six exact face barriers once per step and reuses
them across forty Jacobi iterations. Moving boundaries still contribute their
native rigid velocity. The GPU view uses the same geometry for donor selection
and ray clipping. Real openings remain traversable. These checks do not establish
arbitrary-shape support, unlimited precision or two-way gas/rigid momentum exchange.

The independent `flowScalarSourceAbi: 1` enables `setScalarSources(records)`.
Sources add integrated normalized-field volumes per second, including signed
temperature changes. The completed `scalarSourceReceipt` reports the actual
GPU-requested, applied and deferred quantities. Sparse residency, source/solid
intersection, cooling clamps and floating-point representability can defer
material. A caller must settle its finite obligation from the receipt, not from
the request alone. Using either new API latches exact requested timesteps for
that solver's lifetime; legacy callers retain their existing stepping contract.

Both APIs require matching native, JavaScript and shader inventories. Check the
installed descriptor; the presence of new Engine adapter code alone does not
upgrade an older binary. These are first-party extensions of the pinned Flow
solver, not claims that NVIDIA's original velocity emitters enforce solid walls.
(Sources: `engine/sim/FlowPhysXCollision.js`, `engine/sim/PhysicsRuntime.js`, and
the external native build's verified solid/scalar shader manifests.)

### Native Blast mesh authoring

`new BlastAuthoring(module).fracture({ positions, indices, sites, normals, uvs,
interiorMaterialId })` invokes NVIDIA's Voronoi fracture tool on the CPU in WASM.
The mesh must be closed, convex, consistently wound and nondegenerate. Sites are
explicit flat xyz coordinates, making the requested cut deterministic. Normals
and UVs are optional; the interior material ID defaults to 1,000.

The returned plain-data record contains centroid/volume chunks, chunk-local
triangle positions/normals/UVs/material IDs, and bond endpoints, areas, centroids
and normals. It owns no WASM allocations. Native result storage is released after
copying, including on failure. Pass the record into the existing scene adapter:

```js
const authored = new PE.particlePhysicsRuntime.BlastAuthoring(module).fracture({
  positions: mesh.positions, indices: mesh.indices, sites,
});
const scene = new PE.particlePhysicsRuntime.BlastScene(world, {
  ...authored, density: 2_400, position: [0, 4, 0],
});
// Render each chunk using scene.meshTypes[index] and scene.chunkPose(index).
// Native bond damage or configured stress separates the actual convex bodies.
```

Every chunk is cooked as an actual convex collider. Additional shapes are attached
to the compound, and native mass/inertia is updated. Mesh validation checks welded
manifold topology, outward convexity, volume and centroid. Cooked polygon planes
and volume must match the authored mesh. Each hull supports at most 255 geometric
vertices; concave/decomposed meshes are rejected rather than approximated by boxes.
Interior material IDs remain in `scene.chunks[index].geometry.materialIds` for
renderers to select surface materials. The shared mesh registry supplies the
positions, normals, UVs and indices.

Version-3 family/scene snapshots retain true cut-face bond geometry and render
meshes alongside the ordered damage/stress journal. Versions 1 and 2 remain
supported. Scene disposal releases its actors, cooked meshes and mesh registrations.
This slice does not expose Toolkit, arbitrary hierarchical fracture, VHACD,
mesh cleaning, upstream ExtPhysX joints or ExtSerialization.
(Sources: `BlastAuthoring.js`, `BlastGeometry.js`, `BlastFamily.js` and
`BlastScene.js` under `engine/sim/destruction/`.)

### Blast scene snapshots

`family.snapshot()` and `scene.snapshot()` return versioned, JSON-compatible
Engine records. Restore with `BlastFamily.restore(module, data)` or
`BlastScene.restore(world, data, { log })`. Scene restoration rebuilds the native
support graph and cumulative damage, checks native partitions, and restores
fragment position, rotation, linear/angular velocity, sleep, anchoring and scene
settings. New actor/entity IDs are assigned; chunk indices remain stable.

The snapshot replays successful native damage commands in their original order.
It does not sum damage because native float rounding can change fracture
thresholds. Snapshot size and restore time grow with that history. It is an
Engine replay format, not an NVIDIA ExtSerialization binary and not a checkpoint
of the complete PhysX contact/constraint solver. The caller supplies and owns
the destination physics world.

If native fracture succeeds but creating a physical fragment fails, the scene
sets `needsReconciliation`. Call `scene.reconcile()` before stepping the world
again; reconciliation repairs the physical representation without applying the
damage twice. Invalid snapshots and partial restore failures release newly
created native resources.

### Native Blast stress

`bondAreasM2` explicitly opts a family into physical bonds. It has one positive
cross-sectional area in square metres per authored bond; `health` then means the
initial surviving fraction in `(0, 1]`. Without those areas, existing families
retain their arbitrary damage-unit contract and cannot run stress. In a physical
family, manual `damage(bond, amount)` removes area in square metres.

`stress` supplies `densityKgM3`, optional `anchoredChunks` indices, and `settings`.
The pressure settings are `compressionElasticLimitPa`, `compressionFatalLimitPa`,
`tensionElasticLimitPa`, `tensionFatalLimitPa`, `shearElasticLimitPa` and
`shearFatalLimitPa`. A fatal limit must exceed its elastic limit. Compression
defaults to 1/2 Pa, with tension and shear inheriting it; these defaults are not
a calibrated material preset. Choose measured limits for the intended material.
`maxSolverIterationsPerFrame` defaults to 25. Graph reduction remains disabled.
See NVIDIA's [stress settings and pressure units](https://nvidia-omniverse.github.io/PhysX/blast/_build/docs/blast-sdk/latest/struct_nv_1_1_blast_1_1_ext_stress_solver_settings.html).

`family.updateStress(flatForcesN)` takes one xyz force in newtons per chunk in
authored local axes. It executes the real NVIDIA ExtStress solver, applies its
fracture commands and updates native actor ownership. Each call replaces the
previous loads. The receipt includes convergence, linear/angular solver error,
remaining bond areas and chunk groups. Zero-mass anchors resist acceleration;
an unsupported assembly under uniform gravity instead falls together.

For physical box scenes, pass `bondAreasM2` and `stress: { settings }` to
`BlastScene`. Density and anchored nodes come from the scene's own chunk geometry.
After stepping PhysX, call `scene.updateStress({ gravity, forces, contactEvents,
dt })`. Each optional force is `{ chunk, forceN: [x, y, z] }` in world axes.
The adapter rotates loads into each current fragment's local frame and maps each
contact's mean force, impulse divided by the physical timestep, to its nearest
owned chunk. It resolves both actors and all manifold points before splitting.
These are fracture loads; PhysX has already integrated the contact impulse.
This mapping approximates contact distribution and does not automatically add
centrifugal loads. Physical scenes reject the legacy `applyContacts()` damage
heuristic so its arbitrary damage scale cannot silently become square metres.

Partial area loss follows the upstream **per-update** damage rule. It is not a
time-calibrated fatigue law: changing the number of updates can change damage.
The Engine's version-2 physical snapshots record every stress update, including
zero-load updates, interleaved with manual damage. Replay reconstructs native
warm-start state and checks areas, solver state and partitions. Legacy version-1
snapshots remain supported. Stress settings are fixed at construction. Builds
with native stress-mass ABI 1 additionally support `scene.setChunkMasses(values)`:
actual compound mass, centre of mass, inertia and native stress-node mass update
together while every material point retains its rigid velocity. This models mass
leaving at the material's current velocity; it is not an impulse applied to the
remaining solid. Released leaf actors belong to their new owner.

ExtStress executes on the CPU in WASM with NVIDIA's scalar solver. The pinned
build uses checked platform adapters for x86 include/CPU-query assumptions and
fixed WASM floating-point behavior; it does not claim GPU or AVX acceleration.
The upstream solver algorithms and source hashes remain recorded separately
from that portability layer. Native node inertia uses the upstream
volume-equivalent sphere approximation. Legacy physical graphs derive bond
normals/centroids from chunk centers; authored version-3 graphs preserve actual
cut-face normals/centroids. This is not finite-element analysis. The browser API
does not expose stress debug lines, excess-force queries or graph reduction.

The Engine's existing scalar/SIMD/threaded compute WASM remains separately owned. It does not share the physics heap automatically. Applications must explicitly copy data between these runtimes.

Blast 5.0.6 core and the Flow host graph are linked into the same PhysX PE WASM.
Blast's authoring adapter generates convex Voronoi fragments; the scene adapter
accepts those meshes and prefractured boxes with physical bonds. Flow executes
sparse allocation, emission, density/velocity advection, combustion, vorticity,
multigrid pressure projection and GPU summary feedback. Its browser API currently
exposes sphere, oriented box, point and triangle mesh emitters on independent
layers, plus sparse atlas outputs. It requires a borrowed device
with `float32-filterable`, 1,024 compute invocations per workgroup and workgroup
size X of 1,024. The Playground requests these limits when supported; Engine
callers can explicitly acquire the `physx-flow` GPU capability profile.
The bridge specializes WGSL storage formats and preserves zero-border sampling.
It waits for GPU completion before native readback and resource recycling.

Flow ships 97 generated WGSL modules and 96 accepted pipelines. The optional
`EmitterNanoVdbCS` pipeline remains excluded; the browser solver does not expose
NanoVDB emission or upstream rendering. PhysX sphere/box obstacle coupling is
explicit through `FlowPhysXCollision`, with no reaction-force feedback.
The SPH pressure chamber remains the existing PBF simulation.

### Support boundary

PhysX PE includes real native Blast and NVIDIA Flow components; it does **not**
expose every upstream SDK feature. A successful extension smoke test establishes
the tested path, not full SDK parity. The current public boundary is:

| Component | Available in this browser build | Not exposed by this build |
| --- | --- | --- |
| PhysX 5.11.0 | Native CPU/WASM rigid bodies, queries, mesh cooking, joints, articulations, Vehicle2 and Rust SIMD pose transfers | NVIDIA CUDA simulation; the Engine's WebGPU particle and cloth solvers remain separate implementations. |
| Blast 5.0.6 | Persistent native support graphs, cumulative bond damage, native partitioning, compound scene integration, scalar CPU/WASM ExtStress with physical bond geometry, convex Voronoi mesh authoring and versioned Engine snapshot/restore | Toolkit, arbitrary concave fracture/decomposition, upstream ExtPhysX joint management and ExtSerialization, arbitrary chunk hierarchies and user damage programs. |
| NVIDIA Flow | Native sparse host scheduling with WebGPU emission, advection, combustion, vorticity, multigrid pressure, allocation feedback, multiple sphere/box/point/mesh emitters, independent layers, layer-specific world-space velocity gather and one-way native sphere/box obstacles driven by PhysX | Texture emitter APIs, NanoVDB emission, upstream renderers and automatic two-way collision coupling to PhysX or cloth. |

The Blast bridge represents one support layer beneath a synthetic root. Legacy
graphs use uniform initial health and unit-area bonds; physical graphs require
explicit per-bond areas and a surviving-area fraction. It accepts connected graphs of
2–4,096 chunks and at most 65,536 bonds. `BlastScene` adds box/convex geometry
and anchoring; these are Engine integration features, not upstream ExtPhysX.
All contact damage targets are resolved before native splits replace actors, so
later contact points in the same frame still reach their original bonds.
(Sources: `engine/sim/destruction/BlastFamily.js`, `BlastScene.js`, installed
`evidence/upgrade-511.json`, and the pinned native build's `pr_blast_wasm.cpp`.)

Flow's additive scene ABI configures up to 32 independent layers and 1,024 emitters per host. Its
97 shader modules are an inventory: accepting 96 pipelines is distinct from
executing every operator. Runtime verification reports the passes actually
dispatched. The excluded NanoVDB pipeline must remain explicitly unavailable.
(Sources: `engine/sim/physics/addons/flow_host_webgpu.mjs`,
`flow-wgsl/manifest.json`, and `engine/sim/PhysicsRuntime.js`.)

These distinctions follow NVIDIA's separation of the [Blast low-level,
Toolkit and extension APIs](https://nvidia-omniverse.github.io/PhysX/blast/index.html)
and its wider [Flow emitter and solver settings](https://docs.omniverse.nvidia.com/kit/docs/flow/latest/settings.html).
The Matter Journey's SPH/MAC water and phase-change solver is Engine code;
installing Flow does not make that simulation an NVIDIA Flow solver.

The [Physics sandbox](../../tests/playground/index.html?demo=physics-runtime&view=focus)
is the first entry under **Simulation**, titled **Physics sandbox · Glass, brick,
Blast & Flow**. It uses the same Engine API and the Playground's existing GPU
device. Choose glass, brick or the original test panel; pitch a spinning baseball,
roll it along the floor, or use the heavier test sphere. The baseball has a
0.145 kg mass and 73.8 mm diameter; its visible stitches follow its native rotation.
PhysX and Blast execute on CPU/WASM. Flow and drawing use WebGPU. The displayed
simulation rate counts completed physical time, independently of rendering FPS.

The default glass pane is 3 mm thick. A 64-mode, simply supported elastic plate
solves bending, surface tensile stress and finite-patch sphere contact before fracture.
Seeded flaws are persistent; weathering lowers their strength. First failure
generates impact-centered radial and circumferential cells, then native Blast
partitions them into PhysX islands. The handoff records mass, fracture work,
rigid kinetic energy, unresolved energy and subsequent gravity work. Slow motion
scales the whole simulation clock and resolves the fast bending response; it
does not delay a decorative crack animation.

This is a reduced small-deflection model of annealed glass, with approximate
transparent shading. It does not resolve three-dimensional crack tips, optical
refraction, nonlinear membrane strain or the residual stress of tempered glass.
Radial and concentric fracture patterns and back-face tensile failure are
supported by [NIST's glass fracture guide](https://www.nist.gov/document/glassfracturespdf)
and [Nakajima Glass's impact explanation](https://www.ngci.co.jp/en/tech/tech_kn27/).
The implemented flaw and fracture-work parameters are demonstration estimates,
not material certification.

The 3.14 × 1.79 × 0.065 m brick wall now contains 348 clay bricks and 646 mortar
groups across its 10 mm joints. These 994 groups contain 4,074 convex material
cells. Each brick partitions into six pyramids around a seeded interior point;
48 selected pyramids also contain an angular corner chip cut from the same clay
volume. Mortar has its own physical volume, mass and collision shapes. Each
mortar group partitions across the joint thickness into a slab and two triangular
prisms, so bulk fracture can leave mortar attached on both sides of a joint.
(Sources: `tests/playground/src/demos/physicsRuntime/fractureMaterials.js` and
`masonryGeometry.js`.)

The bond graph distinguishes clay fracture, mortar cohesion and attachment at
the brick–mortar interface. Losing an attachment does not erase the mortar;
its cells remain with their native actor until further fracture separates them.
Weathering changes the seeded cohesive area without removing material mass.
This separation reflects the distinct bulk and interface mechanisms in
[mesoscale masonry fracture research](https://pmc.ncbi.nlm.nih.gov/articles/PMC11688205/).
[Experimental interface shear tests](https://ascelibrary.org/doi/10.1061/%28ASCE%29MT.1943-5533.0002961)
also distinguish cohesive failure from residual friction and show that failure
can remove material from the brick surface. The demonstration does not calibrate
these mechanisms to a particular brick batch or mortar mix.

Intact groups use a combined cuboid collider only after partition validation.
The validator checks complete, unique ownership, triangle-derived volumes,
convex non-overlap and cancellation of internal faces within bounded float32
tolerances. Fractured cells use their actual convex hulls. Contact projection
measures distance to the triangle surface; axis-aligned bounds only accelerate
the search. Bottom anchors require an exterior downward face on the base plane,
rather than a corner that merely touches it. The renderer uses the owned mortar
cells without the former decorative joint bridges. When the runtime advertises
the solid-boundary ABI, Flow also receives those actual hulls. The legacy
velocity-obstacle mode does not provide this solid non-penetration boundary.
(Sources: `engine/sim/destruction/BlastCollisionGeometry.js`, `BlastScene.js`,
and the sandbox's `brickContactProjection.js`, `model.js`, `renderer.js` and
`surfaceBoundaries.js`.)

The auxiliary stress graph resolves untouched brick and mortar groups as whole
support nodes. A measured contact refines the struck group before projecting
force and moment; detached face cells can then expose their smaller clay chips.
Coarse nodes retain actual volume, mass and mass-weighted centers. The fine
native graph remains authoritative for surviving bond area, actor ownership
and shape geometry. Rebuilding the auxiliary graph never joins separate physical
actors; this graph remains demo-owned state outside the generic Blast snapshot.
(Source: `tests/playground/src/demos/physicsRuntime/brickStressHierarchy.js`.)

PhysX rigid bodies and the contact projection use the authored material masses.
The legacy native ExtStress estimator, however, equalizes dynamic node masses
and recenters bonds between dynamic nodes. These internal approximations do not
preserve the corresponding mixed-mass force balance or authored eccentric
moment arms. Supplying physical masses to the adapter alone does not correct
them. An isolated additive physical-stress candidate preserves node mass,
volume-derived isotropic inertia and authored bond offsets, and withholds
fracture until the fixed-load solve converges. Its stricter relative tolerance
is bound into version-5 family and scene checkpoints; the reported convergence
residuals are normalized normal-equation residuals, not forces or moments.
Eight independent native checks pass, including unequal-mass cut forces,
eccentric cut moments, zero internal load in uniform free fall, pending replay
and numerical failure without damage. Legacy results match the installed
runtime. Full-wall admission subsequently failed: a longer converged solve
damaged 165 mortar interfaces under self-weight alone. Independent force and
moment checks confirmed equilibrium, but the original minimum-impulse graph
operator did not weight load sharing by interface stiffness or area. This
candidate is not installed; convergence alone does not establish material
stability. The stress inertia remains the upstream
volume-sphere approximation; PhysX rigid bodies retain their convex mass
tensors. (Sources: `engine/sim/destruction/BlastFamily.js`, the sandbox's
`brickStressHierarchy.js`, and `ConjugateGradientImpulseSolver::initialize` in
the pinned NVIDIA `NvBlastExtStressSolver.cpp`.)

A separate section-based candidate integrates normal and shear stiffness over
each actual face polygon. Its six-axis section matrix maps displacement and
rotation into force and moment; the native solve minimizes complementary elastic
energy while satisfying equilibrium. Vertex traction maps recover normal and
shear pressure for each owning fine patch, so damage need not spread across
every patch in one aggregated joint. The auxiliary solver returns these damage
fractions without modifying its own health. The fine native family applies
accepted damage and the auxiliary sections rebuild from its survivors.
Independent analytic rectangle, unequal-area, rigid-transform, subdivision,
mixed-material and free-fall checks pass. The browser compiler also passes 25
checks against independent references and invalid inputs. A separate sparse
solve re-integrates all 2,534 owned sections and 19,464 traction samples of the
994-node wall; it predicts zero damaged patches under self-weight, with maximum
equilibrium residuals of 1.86e-11 N and 4.11e-13 N m. This is CPU mathematical
evidence. Native convergence, runtime wall stability, impact and real-time
acceptance are still pending. This model uses
explicit demonstration elastic moduli of 12 GPa for clay and 3 GPa for mortar,
both with Poisson ratio 0.2; they are separate from seeded strength and are not
calibrated product properties. Section numerical revision 2 uses version-6
checkpoints carrying the complete operator and traction maps. Original
unweighted physical revision 1 retains version 5.

The first native section candidate failed its original-physical empty-checkpoint
gate because an upstream stress counter was not initialized before the first
solve. A separate candidate initializes that counter only when physical mode is
enabled; the failing binary and receipts remain preserved. This correction has
passed all eight original physical checks and bit-exact original-physical and
installed legacy comparisons. After an additive correction explicitly represented
symmetric fixture stiffness, all seven original native section references passed,
along with replay, continuation, topology and rejection checks. The remaining
fixture assertion confused fine patch IDs with native bond IDs. A separate
four-body, four-bond reference now checks two actual parallel paths: increasing
the weaker path's stiffness shifts the independently calculated load from
20/80 N to 50/50 N. That native check exposed a terminal failure before the
solver started, with health and ownership preserved. The full-wall native solve
is held while a separate candidate corrects factor-conversion admission. The
material strengths, solver tolerance and work budget have not been relaxed.
(Sources: `engine/sim/destruction/BlastInterfaceSections.js`, `BlastFamily.js`,
`BlastScene.js`, and the sandbox's `masonrySections.js` and
`brickStressHierarchy.js`.) Interface stiffness and failure are distinct inputs
in [cohesive traction laws](https://docs.software.vt.edu/abaqusv2025/English/SIMACAEITNRefMap/simaitn-c-cohesivebehavior.htm).

The clay chips debit their source cell's volume and mass; they are not additional
particles spawned on impact. Released chips use equivalent-sphere drag in still
air. They represent resolved rigid debris, not a powder-size distribution or a
Flow-coupled aerosol. The authored failure cells also constrain possible crack
paths; this is not a continuum crack-tip solver. Clay and mortar volumes and
mass totals have been independently checked, but native runtime fracture
acceptance for this revised geometry is still pending. Effective strengths and
weathering remain demonstration parameters. Thousands of colliding fragments
remain CPU/WASM work, and rendering FPS alone does not establish real-time
fracture performance. (Sources: `fractureMaterials.js` and `model.js` in
`tests/playground/src/demos/physicsRuntime/`.)

Fracture-capable shapes request initial, persistent and CCD contact reports.
Speculative CCD can report an initial contact with zero impulse before the real
collision; relying only on that first notification loses the later fracture
load. Terminal fragments keep collision solving and CCD but stop requesting
unneeded reports. A fracture-capable partner can still request their contact.

The burner supplies cold gaseous fuel and a separate heat-only pilot. Native
Flow advection carries heat into neighbouring fuel, combustion consumes fuel,
and buoyancy and vorticity move the hot gases. The pilot and fuel supply can be
switched off independently; existing gas is not erased. Native Flow combustion
does not by itself model solid-fuel pyrolysis, oxygen transport or calibrated
chemical kinetics. Smoke mode supplies heated smoke without new
fuel. Residual fuel from an earlier fire may still react with existing heat.

Boundary-, scalar-source- and mass-capable builds also enable the sandbox's
combustible pine crate. The same 192 material cells own its visible panels,
native Blast bonds, PhysX geometry and Flow boundary. A reduced one-dimensional
thermal model integrates conduction, moisture loss, pyrolysis and char oxidation;
four GPU samples per exposed face supply measured gas fields. The demonstration
explicitly converts Flow's normalized temperature with
`T = 293.15 + 1200 * temperature` kelvin and uses a prescribed atmospheric oxygen
reservoir. This is not a sealed-enclosure oxygen or full gas-energy solver.

Each face queues finite fuel and separate heating/cooling obligations. A step
integrates historical rates in order at one unchanged oriented source volume.
Actual native receipts settle that history in order. Tiny representability
remainders remain accounted for and can share a later same-volume request;
moving sources and opposite heat signs are never merged. Unresident amounts
remain pending. Diagnostics distinguish exported, requested, applied, deferred
and explicitly retired quantities.

Heat damage reduces surviving bond area and physical mass. Native fragments
separate through Blast and PhysX. A spent isolated leaf can transfer into
nonoverlapping ash grains that preserve its mass, centre of mass, inertia,
linear/angular momentum and kinetic energy; if that representation cannot fit,
it remains an ash flake. Ash remains physical debris. Steam, carbon dioxide and
latent-energy exports have separate ledgers, rather than an asserted complete
native gas-species model. Effective pine inputs are pinned to the cited FDS
material record; coupling coefficients and oxygen closure remain explicit model
choices. Controlled burnout/ash tests and a short live heating test establish
different properties; neither alone proves self-sustained fire spread.
(Sources: `engine/sim/combustion/WoodFireMaterial.js`, `WoodCombustion.js`,
`tests/playground/src/demos/physicsRuntime/woodAssembly.js` and
`woodSourceQueue.js`.)

The renderer uses native temperature, fuel, burn and smoke fields. Smoke
absorption and self-shadowing follow volume light transport; the flame's
blackbody colour ramp and exposure are display settings. Flow's normalized
temperature is not measured Kelvin, and its advected burn channel is not
heat-release power in watts. GPU quadrature of that same emission produces a
finite-radius light on nearby surfaces. This is an approximate area light,
without geometric fire-light shadows; it introduces no periodic flicker or
CPU field readback. These distinctions follow NVIDIA's
[Flow advection and emitter settings](https://docs.omniverse.nvidia.com/kit/docs/flow/latest/settings.html)
and [fluid simulation and rendering guidance](https://developer.nvidia.com/gpugems/gpugems3/part-v-physics-simulation/chapter-30-real-time-simulation-and-rendering-3d-fluids).

The sandbox has no fixed smoke presentation box. A completed-frame GPU copy of
the native sparse atlas and addressing table supplies the view while the next
Flow step runs. GPU reduction derives the active extent; sparse ray traversal
skips empty blocks and samples occupied cells at native resolution. Lighting is
cached per sparse block. Extents describe resident data, not world walls, and
normal rendering performs no CPU field readback. The volume uses a cached
reduced-resolution image with depth-guided reconstruction; detected depth
discontinuities use the original full-resolution ray. Camera, opaque pose,
geometry and native-field changes invalidate that image. Stable presentations
only composite it. Rendering resolution can adapt to GPU pressure without
changing native cell spacing or physical time. GPU residency still has a finite
allocation budget. The native ground is an infinite plane, rendered by a ray-plane
intersection, and projectiles are removed only by explicit reset or disposal.
Camera clipping and floating-point precision remain separate concerns. The
engine's `FloatingOrigin` and hierarchical-coordinate utilities do not by
themselves establish a coordinated rebase of this native PhysX/Flow scene.

Auto presentation reuses the Engine GPU quality governor; High and Full select
explicit sampling policies. Actual GPU timestamps, CPU submission cost and
completion latency remain separate measurements. Auto quality uses measured
render cost and older unfinished render submissions. The current submission
does not count as accumulated queue debt. Coupled physics/wood wall time remains
visible in diagnostics and the real-time rate, but does not lower pixel detail
when rendering has spare budget. When paused, the existing
Fractal progressive tile planner refines every output pixel against one fixed
completed field. Changing quality does not advance simulation. This removes a
fixed presentation pixel cap, but does not invent sub-grid gas motion or provide
infinite physical detail. Native cell spacing remains 0.1 m in this demonstration.

The completed snapshot caches conservative solid candidates and donor occupancy
for each eight-cell interpolation neighbourhood. Rendering, surface heat queries,
shadows and reflected fire light reuse those results. Clear neighbourhoods retain
hardware interpolation; possible intersections run the original leaf bounds,
point and segment tests against at most eight cached BVH leaves. More candidates
fall back to the complete BVH. Uncertain coordinates repeat the original
broadphase, and a cache exceeding device buffer limits uses the original sampling
path. None of these fallbacks discards geometry. The cache is rebuilt from the
matching geometry and sparse mapping on every snapshot, including moving solids
and newly opened holes.

Paused refinement estimates work by pixel area. An expensive pending tile is
subdivided without discarding finished pixels. If even the minimum tile exceeds
the spare budget, a clear GPU queue admits one tile and reports that over-budget
progress explicitly. Native simulation stays paused throughout refinement.
Delayed GPU timing results retain the phase in which they were measured; a
pause/resume transition cannot charge a paused refinement to the live quality
budget. Current CPU and queue observations remain available during that transition.
(Sources: `flowSparse.js`, `flowSnapshot.js` and `flowPresentation.js` in the
sandbox directory.)

Sources: `tests/playground/src/demos/physicsRuntime/` and
`engine/sim/destruction/`. The sandbox also retains the falling reference body
and repeatable native extension checks. Engine, Editor, homepage and WebGPU OS
releases receive the same verified asset inventory through the Python bundler;
consumer synchronization carries the physics sidecars with the compiled runtime.

Verification commands, from the repository root:

```bash
python tools/install_physics_runtime.py
python tests/run_physx_upgrade_acceptance.py --full-consumers --playground --construction --extensions
python tests/run_flow_acceptance.py
python tests/run_physx_release_matrix.py
python -m unittest bundler.tests.test_physics_runtime
python bundle_engine.py --target platform --production --release --no-cache
```

The installed-runtime Flow acceptance runs 120 emitting frames and 24 frames
with emission stopped, checks a separate affine velocity-sampling oracle,
toggles solver controls, tests isolated contexts and cleanup, and compiles the
97 modules and 96 supported pipelines. It records source hashes before and
after the run. Combustion is checked against independent reaction equations for
ignition, fuel exhaustion, cooling and temperature bounds, then against matched
native runs with combustion disabled/enabled. These are NVIDIA's normalized
temperature/fuel fields, not calibrated SI chemistry.
The release matrix separately boots Engine, OS, Platform and SDK
builds and the compact site's archive delivery; run it after rebuilding those
targets. The shared testing/evals catalog exposes these runners as
`gpu:physx-pe-consumers`, `gpu:flow-installed`, and
`gpu:physx-release-matrix` in `tools/testing_platform/suites.json`.
These tests use real Chrome
WebGPU on the current machine, not a cross-device certification.

Installing a newly tested workbench uses `python tools/install_physics_runtime.py --workbench PATH --install`. It requires matching workbench and real Engine acceptance receipts, preserves replaced bytes under `artifacts/physics-runtime-rollback/`, and regenerates declarations from the current WebIDL using Python.

For the separate project implementations of WebGPU rigid bodies, constraints,
soft bodies and geometry queries, see [GPU Physics Engine](gpu-physics.md).
Their presence does not establish upstream PhysX feature parity.

## Cloth simulation

A mass-spring cloth solver in `engine/sim/cloth/`. Each cloth is a grid of particles connected by structural, shear, and bending springs, solved on GPU compute. Configurable: stiffness (spring force coefficient), damping (velocity damping), per-cloth gravity override, wind (directional force with turbulence noise), pin constraints (fixed vertices), and sphere/plane collision response.

The [Woven Cloth impact lab](../../tests/playground/index.html?demo=woven-cloth&view=focus)
uses `PE.particleWovenCloth.GpuWovenCloth` by default. It uploads the editor's
`WovenCloth` authoring graph once, then solves independent warp/weft masses,
compliant crossings, bends, tensile breaks and swept contacts in WebGPU compute.
The GPU also advances the spheres and supplies positions and fracture flags
directly to the renderer. No live yarn positions or meshes are rebuilt on the
CPU. This is a constrained weave model; sliding friction between individual
fibers and torsional mechanics are not resolved.

Click to throw GPU spheres. Contact corrections are mass weighted and act on
both the sphere and yarns. Controls adjust launch speed, yarn strength, wind,
pinning and thread visibility. Cuts disable real yarn constraints and their
supporting bend spans; unsupported crossings release, and affected surface cells
disappear. Try 2 N yarn and a 32 m/s throw for a puncture. Reset rebuilds the weave.
The default GPU grid contains 50 yarns, 150 independent ply chains and 3,750
physical masses. Total cloth mass and nominal yarn strength are shared across
plies, not multiplied by their number.

The explicit `clothBackend=cpu` URL option retains the CPU XPBD reference with
native PhysX PE projectiles. The default GPU spheres use the Engine woven solver;
they are not native PhysX CUDA bodies. Other editor rope/chain consumers are not
implicitly migrated by this Playground change. Sources:
`engine/sim/cloth/GpuWovenCloth.js`, `engine/sim/cloth/WovenClothGpuShaders.js`,
`tests/playground/src/demos/cloth/gpuDemo.js`, and `cloth.js`.

The lab shares the editor's cotton, wool, silk, nylon and hemp yarn properties
through `engine/sim/cloth/FiberMaterials.js`; the editor's existing imports remain
valid. Plain, 2/2 twill and 5-end satin use different over/under drafts. These are
estimated yarn responses, not measured fabric calibration. The normalized
material record uses the sewing system's existing cloth material contract.

Choose a solid blanket, individual yarns, or both. **Single yarn · fast** merges
an intact bundle into one drawn tube; partially broken bundles expose their
surviving physical plies automatically. **Individual plies · inspection** draws
each independent chain. Changing the view leaves physics unchanged. Changing
ply count (one to six), S/Z lay, turns per metre or strength variability rebuilds
the physical construction. Inspect weave enables the detailed view. The geometry
is enlarged for inspection.

Each ply owns its particles, structural segments, bend dependencies, tensile
multiplier and rupture flags. A severed segment releases only its dependent bend
spans and local inter-ply cohesion; it never marks neighbouring ply segments as
broken. A surface cell remains while a complete ply layer supports its edges;
collision reactions are distributed to those surviving layers. This is a reduced
model with twist sampled at yarn nodes and local cohesive links, not resolved
microscopic fibres, frictional sliding or a calibrated torsional/untwisting model.

The GPU distance solver consumes the sewing system's normalized warp/weft
strain–traction curves. Sheet traction (N/m) is multiplied by the tributary width
assigned to each ply; the secant compliance is converted to a length constraint.
Within the supplied range this matches the sewing curve response. Beyond its
endpoints the yarn backend retains endpoint secant stiffness; this extension
is an approximation, not measured response or the sewing solver's strict
range-rejection behavior.
`new WovenCloth({ material: profile })` accepts the same validated physical
material contract, including recorded curves and provenance. The Playground uses
the generic estimated light-woven traction curves and the editor fibre presets
for bending/damping; its material names are not measured fabric calibrations.

Rupture uses each segment's tensile multiplier after the structural solve.
**Ply strength variation** defaults to a declared 15% estimated manufacturing
variation, deterministic in material coordinates. Ply capacities are normalized
so their sum stays equal to the nominal yarn strength. Zero variation remains
available: equal materials under exactly symmetric loads can physically fail
together. The tension view colours individual plies by force divided by their
breaking capacity; the extension view reaches red at 10% local extension. Warp
and weft maximum extension and partially torn yarn segments are reported
separately. Source: `engine/sim/cloth/WovenPlyGraph.js` and the shared sewing
contract `engine/sim/cloth/triangular/materials.js`.

The GPU solver uses colored XPBD passes and atomic Jacobi contact corrections,
with four 1/480-second substeps per 1/120-second step. Swept vertex/triangle,
yarn/yarn, exposed-yarn/sphere and sphere/sphere tests use current fracture flags.
Slowly converging grazing trajectories retain a speculative separating plane
instead of being discarded. `speculativeContacts` counts those conservative
candidates; finite iterations are not a mathematical nonpenetration guarantee.
GPU swept bounds reject separated 64-element groups before detailed contact
tests. Bounds and cached triangle positions include old and current positions
and are rebuilt before every contact correction iteration. For larger meshes,
the GPU compacts overlapping group/feature pairs and writes indirect dispatch
arguments. Detailed collision work runs only for those candidates. The queue
reserves every possible pair; dense folds cannot silently overflow it. Small
meshes and devices whose buffer or dispatch limits cannot hold the queue use
direct dispatch with the same collision tests. The default three-ply queue
reserves about 8.3 MiB; six plies reserve about 29 MiB. Worst-case candidate
storage and contact work still grow quadratically with the segment count.

Ordered solver dispatches share compute passes, with a pass boundary and a
12-byte GPU-to-GPU argument copy before each indirect contact dispatch. Weave
passes launch only the nodes of their constraint colour. One 64-thread
workgroup reduces display statistics instead of one thread scanning the whole
graph. The timestep, solver iteration counts and independent ply physics are
unchanged. For differential testing, `broadPhase`, `batchDispatches` and
`optimizedKernels` can be disabled on a `GpuWovenCloth` instance; all default to
enabled. `tests/run_woven_gpu_performance.py` compares complete particle/link
states and receipts across rest, impact and folded cases. Its `--profile` mode
uses GPU timestamps with separate passes for stage attribution; paired runs
measure normal batched submission through GPU completion.

The UI reads a 96-byte diagnostic receipt at most ten times per second. It labels
CPU command and draw submission times separately; neither is GPU execution time.
The simulation-speed readout measures GPU-completed steps against wall time,
independently of rendering FPS; 1.00× means real-time physics. Pause reports zero.
Cut and pin-release actions wait for an in-progress fabric reset to finish.
`GpuWovenCloth.snapshot()` is an explicit test/debug readback and is not used by
the live demo. GPU errors stop simulation rather than silently falling back to
CPU physics. Sources: `engine/sim/cloth/GpuWovenCloth.js`,
`tests/playground/src/demos/cloth/gpuRenderer.js`, and `cloth/gpuDemo.js`.

Flow supplies sampled velocities at the yarn masses and the GPU applies bounded
drag. The resident path generates sampling queries from the GPU node buffer and
uses the native Flow sparse gather directly into the GPU air buffer. Its initial
dummy query creates the existing sampler; live positions and air samples remain
on the device. The air-source control selects Flow, manual wind, or both. Coupling
is one-way: cloth does not obstruct or push air back into Flow. Flow still uses
its native WASM host to schedule GPU work and receive its own sparse-grid summary.
Unsupported devices report Flow as unavailable; manual wind remains usable.
The controller serializes Flow work, rejects stale samples after resets and
awaits cleanup when switching demos. Source: `cloth/airflow.js`.

### Textile structure and intended use

Fiber, yarn and fabric construction are separate choices. Cotton, wool, nylon,
polyester and para-aramid describe fibers. A yarn can contain staple fibers or
continuous filaments, and multiple yarns can be plied together. Singles twist
and ply twist are distinct; plying commonly reverses the singles' twist.
Linear density (tex: grams per kilometre), ply count and twist rate are more
useful physical inputs than a decorative rope radius alone.
[CottonWorks yarn construction](https://cottonworks.com/learning-hub/yarn-manufacturing/yarn-ply-counts-and-treatments/).

Woven fabric interlaces warp and weft. Plain weave alternates over/under;
twill offsets the repeat to produce diagonals; satin distributes binding
points among longer floats. Knitting instead intermeshes loops. A color or
printed motif can be independent of this mechanical structure.
[CottonWorks weaving](https://cottonworks.com/learning-hub/weaving/weaving-basics/),
[satin](https://cottonworks.com/encyclopedia-item/satin/) and
[knitting](https://cottonworks.com/learning-hub/knitting/knit-basics/).

| Application | Construction examples | Modeling consequence |
| --- | --- | --- |
| Flags | Woven polyester; lightweight knitted polyester or mesh | Distinguish yarn crossings from loops; air permeability, hems, hoist attachments and free edges affect motion. |
| Sheets | Plain-weave percale; longer-float sateen | Support repeat drafts, yarn spacing and directional bending/shear. |
| Blankets | Waffle or basket weaves, knitted blankets, layered quilts | A thick appearance alone does not supply loft, loop topology or connections between quilt layers. |
| Clothing | Woven shirts/denim; jersey, rib and interlock knits | Pattern panels, grain, seams and loop deformation require their own representation. |
| Tarps | Reinforced ripstop fabric with a coating | Reinforcement changes the yarn graph/properties; coating and waterproofness are separate from weave. |
| Kevlar fabrics | Para-aramid woven fabrics, laminates and unidirectional constructions | Fiber identity does not select the architecture or establish protection performance; use actual fabric and assembly data. |
| Metal mesh | Woven wire or interlinked, sometimes welded rings | Woven wire needs wire bending/contact; chainmail needs ring geometry, connectivity and ring/joint failure. |

The examples are supported by manufacturers' construction descriptions:
[Flagmakers material guide](https://www.flagmakers.co.uk/media/u1cdrrdg/flagmakers-brochure-2018.pdf),
[Brooklinen sheet constructions](https://www.brooklinen.com/pages/about-sheets),
[Boll & Branch waffle blanket](https://www.bollandbranch.com/products/waffle-bed-blanket-1/),
[Hilleberg ripstop and coatings](https://docs.hilleberg.net/Hilleberg2022Handbook-EN.pdf),
[DuPont Kevlar fabric families](https://www.dupont.com/content/dam/aramids/amer/us/en/safety/public/documents/en/DuPont_Kevlar_Body_Armor_Brochure.pdf),
and [WDavis welded ring mesh](https://www.wdmesh.com/wp-content/uploads/2024/06/Ring-Mesh-Spec-Sheet.pdf).
The modeling consequences are engineering recommendations, not measured
material coefficients. Sources reviewed 2026-09-19.

The impact lab currently represents constrained woven yarns. Its editor fiber
presets are estimated preview parameters, not calibrated finished textiles.
The default GPU backend gives each ply independent physics masses; the explicit
CPU reference retains decorative plies. The solid surface is a presentation of
surviving weave cells, not an additional shell
solver. Knit loops, coating mechanics, layered quilts, calibrated para-aramid
failure and contacting chainmail rings are separate work; changing a preset
name cannot provide those behaviors.

For a more faithful yarn solver, the priority is contact and sliding friction,
followed by yarn bending/torsion and validated failure data. Woven-cloth research
models yarn properties, the weave draft and frictional contact together;
knitted-cloth research models connected yarn curves with bending and contact.
This supports keeping topology separate from material coefficients and using
coarse cloth physics with finer rendering only when that approximation is
declared. [Cirio et al., woven yarn simulation](https://www.ccs.upm.es/research/publications/yarn-level-simulation-of-woven-cloth/),
[Cornell yarn-based cloth research](https://www.cs.cornell.edu/projects/YarnCloth/).

## Rope physics

A Position-Based Dynamics (PBD) rope solver in `engine/sim/particles/RopePhysics.js`. Ropes are chains of particles with distance constraints solved iteratively:

- **PBD constraints** — distance constraints with configurable compliance.
- **Material properties** — stiffness, damping, mass per unit length (`RopeMaterial.js`).
- **Particle interaction** — ropes interact with the particle system (`RopeParticleInteraction.js`).
- **GPU rendering** — smooth tube rendering with normals and lighting (`RopeGPURenderer.js`).

## Fluid simulation

Two approaches:

- **Lagrangian (SPH)** — smoothed-particle hydrodynamics via the [particle system](particles.md). Each fluid particle carries density, pressure, and viscosity; the solver computes inter-particle forces using a neighbor grid (`ParticleSPH.js`).
- **Eulerian (grid-based)** — `ParticleEulerianFluid.js` solves the Navier-Stokes equations on a 3D grid using pressure projection and velocity advection, suitable for contained volumes (pools, rivers).

## Rigid body physics

The ECS `PhysicsBody` component drives rigid-body simulation: body types (dynamic, kinematic, static), collider shapes (sphere, box, capsule, mesh via the `Collider` component), forces (gravity, impulses, torques), and constraints (distance, hinge, ball-socket).

## PBD ragdoll

A Position-Based Dynamics ragdoll solver for character physics — joint limits, bone chains, and muscle constraints. It integrates with the [AGI](../agi/overview.md) system for learning-based locomotion.

## Simulation update

`SimulationUpdate.js` orchestrates all simulation systems each frame, in order:

1. ECS physics system tick (rigid bodies, colliders).
2. Cloth solver step (GPU compute).
3. Rope constraint solving (PBD iterations).
4. Particle simulation (main compute + advanced subsystems).
5. Fluid pressure solve (if active).

## Key files

| File | Purpose |
| --- | --- |
| `sim/SimulationUpdate.js` | Master simulation orchestrator |
| `sim/cloth/` | Mass-spring cloth solver |
| `sim/fluids/` | Eulerian fluid volumes |
| `sim/physics/` | Rigid body physics system |
| `sim/particles/RopePhysics.js` | PBD rope solver |
| `sim/particles/RopeMaterial.js` | Rope material properties |
| `sim/particles/ParticleSPH.js` | SPH fluid solver |
| `sim/particles/ParticleEulerianFluid.js` | Grid-based fluid |
| `sim/particles/ParticleConstraints.js` | Distance/position constraints |
