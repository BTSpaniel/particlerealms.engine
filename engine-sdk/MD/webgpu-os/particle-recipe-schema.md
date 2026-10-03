---
title: Particle Recipe Schema
description: Canonical recipe graph, execution plan, runtime bindings, validation, and migration contracts.
audience: app developers and preset authors
updated: 2026-07-13
---

# Particle Recipe Schema

Particle recipes use the strict JSON schema
`particle-realms.simulation-recipe.graph` version 1. The graph is an authored,
typed description. Compilation produces a deterministic
`particle-realms.simulation-recipe.execution-plan` version 1; the plan is not
itself a general-purpose runtime. (Source:
`webgpu-os/factory/apps/particles/ParticleRecipeGraph.js`)

This page is for app developers and preset authors who create, inspect, or
integrate current recipe documents.

## Related schema family

The current repository uses a family of bounded documents rather than the
design pack's proposed monolithic `particle-realms.simulation-recipe` file:

| Document | Current schema/version |
| --- | --- |
| Persisted project aggregate | `particle-realms.particle-project`, version 2 |
| Immutable built-in preset | `particle-realms.particle-preset`, version 1 |
| Recipe graph | `particle-realms.simulation-recipe.graph`, version 1 |
| Compiled plan description | `particle-realms.simulation-recipe.execution-plan`, version 1 |
| Scene sidecar | `particle-realms.scene`, version 1 |
| View sidecar | `particle-realms.views`, version 1 |
| Artist sidecar | `particle-realms.artist`, version 1 |
| Compare sidecar | `particle-realms.compare`, version 1 |
| Sensor definition/sample | `particle-realms.sensor.v1` / `particle-realms.sensor-sample.v1` |
| Twin project configuration | `particle-realms.twin-configuration`, version 1 |
| External study | `particle-realms.external-study`, version 1 |

(Sources: `webgpu-os/factory/apps/particles/ParticleProjectCore.js`,
`webgpu-os/factory/apps/particles/ParticleLabProject.js`,
`webgpu-os/factory/apps/particles/ParticleStudioDocument.js`,
`webgpu-os/factory/apps/particles/ParticleRecipeGraph.js`,
`webgpu-os/factory/apps/particles/ParticleSensorRuntime.js`,
`webgpu-os/factory/apps/particles/ParticleExternalStudy.js`)

Project v2 is the save/load envelope. Its exact top-level fields are `schema`,
`version`, `id`, `name`, `sourcePresetId`, `classification`, `tags`, `seed`,
`createdAt`, `modifiedAt`, `provenance`, `settings`, `studioDocument`,
`recipeGraph`, `sensorDefinitions`, `twinConfiguration`, `externalStudies`,
and `quality`. Unknown v2 fields fail validation. Runtime settings are limited
to the canonical mode, palette preset, interaction, count, force, size,
exposure, pause, camera, trails, bloom, orbit, brush, gravity, drag,
turbulence, cohesion, temperature, reaction, charge, and seed keys declared by
`DEFAULT_PARTICLE_SETTINGS`. (Source:
`webgpu-os/factory/apps/particles/ParticleLabProject.js`)

## Module boundary

`ParticleProjectCore.js` owns cycle-free preset construction, setting
normalization, seed normalization, and deterministic project hashing.
`ParticleRecipeGraph.js` may consume those primitives but never imports the
project aggregate. `ParticleLabProject.js` then composes both layers into the
strict project-v2 envelope. This dependency direction is required by the
classic release bundler, whose eager named-import snapshots cannot emulate
ES-module live bindings across a cycle.

Project/graph sidecar helpers are exported by `ParticleLabProject.js`:
`attachRecipeGraphToParticleProject()`, `recipeGraphFromParticleProject()`,
`serializeParticleProjectWithRecipeGraph()`, and
`deserializeParticleProjectWithRecipeGraph()`. Callers that previously
imported these four helpers from `ParticleRecipeGraph.js` must update only the
module path; their document contracts are unchanged. (Sources:
`webgpu-os/factory/apps/particles/ParticleProjectCore.js`,
`webgpu-os/factory/apps/particles/ParticleLabProject.js`)

## Graph document

The normalized document contains schema and version identifiers, graph
identity and revision, metadata and provenance, a seed, nodes, edges, and
extensions. Node and edge IDs are stable and serialization is canonical even
when input arrays arrive in a different order. A graph is limited to 2 MiB,
512 nodes, and 2,048 edges. Unknown graph, node, port, and edge fields are
rejected by strict validation. (Source:
`webgpu-os/factory/apps/particles/ParticleRecipeGraph.js`)

The supported node families are:

- Project/Metadata, World/Units, Domain/Coordinates, Geometry, and
  Discretization.
- Boundary, Material, Substance, Emitter, Initial Condition, Field, Force,
  Solver, Coupling, Constraint, and Physics Body.
- Sensor, Reduction, Visualizer, Camera, View Layout, Timeline, Audio Input,
  Audio Graph/Patch, Telemetry Input, Data Transform, and Alert/Rule.
- External Study and Export/Output.

The type system includes `Metadata`, `World`, `Domain`, `Geometry`, `Surface`,
`Volume`, `Discretization`, `Scalar`, `Vector`, `Tensor`, `Field2D`, `Field3D`,
`ParticleSet`, `SubstanceSet`, `Material`, `BoundaryCondition`, `SolverState`,
`PhysicsBody`, `Constraint`, `TimeSeries`, `Event`, `AudioSignal`,
`TelemetryStream`, `RenderLayer`, `Camera`, `ExternalStudy`, and `Output`.
(Source: `webgpu-os/factory/apps/particles/ParticleRecipeGraph.js`)

## Validation and compilation

Validation checks the schema and version, identifiers, limits, registered node
types, port names, edge direction and type compatibility, input cardinality,
required inputs, cycles, and declared subsystem availability. Compilation only
runs for a valid graph and produces a deterministic topological step list,
required-subsystem list, output bindings, source-graph snapshot, graph hash,
signature, and aggregate change impact. The plan validator can independently
confirm that output against its source graph. (Source:
`webgpu-os/factory/apps/particles/ParticleRecipeGraph.js`)

If a current graph is invalid, the compiler may return a separately validated
previous plan marked stale. An invalid previous plan is ignored. `ParticleApp`
does not apply invalid authored settings to the running simulation. (Sources:
`webgpu-os/factory/apps/particles/ParticleRecipeGraph.js`,
`webgpu-os/factory/apps/particles/ParticleApp.js`)

## Change impact

Every node declares one of these impacts, ordered from least to most invasive:

| Impact | Runtime meaning |
| --- | --- |
| `none` | No runtime mutation is required. |
| `authoring-only` | The change is retained as authored metadata. |
| `uniform-update` | Mapped live settings may be updated without rebuilding resources. |
| `resource-resize` | Size-dependent resources may need replacement. |
| `pipeline-specialization` | Shader or pipeline specialization may change. |
| `solver-reset-required` | Solver state must be reset. |
| `full-graph-rebuild` | The mapped runtime must rebuild from the plan. |

The compiler reports impact; the current adapter and app decide which mapped
effects they can apply. Unsupported graph families do not become executable
merely because they have an impact declaration. (Sources:
`webgpu-os/factory/apps/particles/ParticleRecipeGraph.js`,
`webgpu-os/factory/apps/particles/ParticleRecipeRuntimeAdapter.js`)

## Current runtime bindings

`adaptParticleRecipeExecutionPlan()` validates the plan before constructing a
normalized ParticleApp settings patch and fixed-step clock. These are the
implemented bindings:

| Plan data | Applied setting or runtime state |
| --- | --- |
| Graph `seed` | Project seed. |
| `extensions.sourceModeId` | Mode when it names a registered Particle preset. |
| `discretization.particles.targetCount` | Particle `count`. |
| `field.vector.strength` | `force`. |
| `initial-condition.state.temperature` | `temperature`. |
| `visualizer.native.pointSize` | Point `size`. |
| `visualizer.native.exposure` | `exposure`. |
| `camera.view.distance` | `cameraDistance`. |
| Solver `nativeType: sph` | `fluid` mode. |
| Solver `nativeType: n-body` | `nbody` mode. |
| Solver `fixedStep` and `substeps` | Fixed simulation clock; fixed step is clamped to 0.000001..1 second and substeps to 1..64. |

`particle-runtime`, `sph`, and `n-body` are the adapter's bound solver types.
Unsupported solver types produce a warning and retain the current mode. A
visualizer other than `point-particles` also produces a warning. Count is
normalized against the runtime maximum and the result records any clamp.
(Source:
`webgpu-os/factory/apps/particles/ParticleRecipeRuntimeAdapter.js`)

`ParticleApp` advances the native world using the adapted fixed step and
substeps. A clock change resets the native time accumulator so time from the
previous clock is not reinterpreted under the new one. (Source:
`webgpu-os/factory/apps/particles/ParticleApp.js`)

## Direct-control synchronization

Quick and Standard controls remain usable. On save,
`synchronizeParticleRecipeGraphSettings()` updates only enabled mapped default
nodes: `discretization.main`, `emitter.main`, `field.main`,
`visualizer.main`, and `camera.main`, plus the graph seed and
`extensions.sourceModeId`. It preserves custom nodes, edges, stable IDs, and
provenance, and increments the revision only when normalized graph state
changes. (Sources:
`webgpu-os/factory/apps/particles/ParticleRecipeRuntimeAdapter.js`,
`webgpu-os/factory/apps/particles/ParticleApp.js`)

This representative fragment shows the exact count binding in a default graph.
It is a node fragment, not a standalone graph document:

```json
{
  "id": "discretization.main",
  "type": "discretization.particles",
  "enabled": true,
  "parameters": {
    "targetCount": 150000,
    "representation": "particles"
  }
}
```

(Source: `webgpu-os/factory/apps/particles/ParticleRecipeGraph.js`)

## Editing and migration

The graph module provides immutable helpers for node, edge, parameter, and
enabled-state edits. These source-level APIs support complete graph editing,
but the current Recipe workspace presents parameter and enabled-state editing
rather than a full graphical node canvas. Version-0 graph documents migrate to
version 1; documents from an unknown future version fail instead of being
silently reinterpreted. (Sources:
`webgpu-os/factory/apps/particles/ParticleRecipeGraph.js`,
`webgpu-os/factory/apps/particles/ParticleStudioAdvanced.js`)

Project-v1 documents and the legacy
`webgpu-os.particles.workspace.v4` settings payload migrate into project v2.
Canonical project JSON is limited to 32 MiB; graph JSON is limited to 2 MiB;
each external study is limited to 4 MiB. Twin configuration is scanned
recursively for credential-like fields, and runtime Twin truth/state is
rejected from the persisted project. Unknown future versions fail closed.
(Source: `webgpu-os/factory/apps/particles/ParticleLabProject.js`)

## Capability boundary

| Status | Recipe capability |
| --- | --- |
| Implemented | Strict graph validation, canonical serialization, deterministic compilation and plan validation, immutable edits, version-0 migration, last-valid-plan retention, mapped ParticleApp bindings, and direct-control synchronization. |
| Partial | Current UI edits the authored graph but is not a complete visual graph editor; execution covers only the table in Current runtime bindings. |
| Unsupported | Arbitrary node instantiation, generic subsystem dispatch, audio execution, remote studies/jobs, output publishing, graph collaboration/history, and a standalone runtime recipe player. |

## See also

- [Particle Studio Architecture](particle-studio-architecture.md)
- [Particle Studio Preset Authoring](particle-studio-preset-authoring.md)
- [Particle Studio Test Plan](particle-studio-test-plan.md)
- [Particle Studio Integration Map](particle-studio-integration-map.md)
