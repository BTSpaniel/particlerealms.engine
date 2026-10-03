---
title: Particle Realms Studio
description: Current workspaces, project schema, native GPU path, evidence boundaries, persistence, and recovery behavior in Particle Realms Studio.
audience: users and app developers
updated: 2026-07-15
---

# Particle Realms Studio

Particle Realms Studio is the WebGPU OS runtime for running, tuning, validating,
and inspecting recipe-built particle simulations. The portable project and
typed recipe formats are shared authoring contracts: Paint Studio owns
brush-driven construction, while the developing RealmForge owns the reusable
node/part builder. Particle Realms consumes those recipes and forms its demos
through the same project path. The interface does not treat a visual preview as
calibrated or scientifically validated output.

## Studio workspaces

The shell exposes six keyboard-accessible workspaces. Arrow keys move among
workspace tabs, status updates use an ARIA live region, and the tuning drawer
opens only from the explicit Tuning action or `B` keyboard shortcut. (Source:
`webgpu-os/factory/apps/particles/ParticleStudioShell.js`)

| Workspace | Current behavior | Truth boundary |
| --- | --- | --- |
| Discover | Searches and filters 40 recipe-backed demos with distinct animated previews, tracks favorites and recent demos, and provides Run Demo, Build from Recipe, and Inspect Recipe Graph actions. | Every demo creates a normal project and typed recipe graph through the same public authoring path. |
| Create | Provides the current compatibility scene workbench and bounded top, density, velocity, and history projections from one native sample. New brush-based construction belongs in Paint Studio. | Secondary views are Canvas 2D projections of one bounded readback, not independent solver runs or validated engineering fields. |
| Recipe | Builds the portable typed graph visually: add/remove parts, connect compatible sockets, drag nodes, tune parameters, inspect diagnostics, and view a compact measured preview. RealmForge remains the intended reusable cross-product node/part authoring owner as it matures. | The embedded preview is a bounded projection of native readback, not a second solver. Only documented ParticleApp bindings execute; unsupported node families remain authored plan intent. |
| Simulate | Hosts the live canvas, playback, camera, interaction, an explicit tuning drawer, and an automatic particle population targeting 60 FPS. | The reported backend identifies the active native, custom WGSL, or recovery path. Population is bounded only by the active runtime/device safety contract, not a user-configurable cap. |
| Analyze | Displays accepted measured sensor and runtime series and exports them as CSV or JSON with provenance. | Missing measurements and stage attribution remain absent. The Studio does not synthesize them. |
| Compare | Captures explicit settings snapshots and compares compatible measured and imported external series. | A settings snapshot is not a second simulation. External data does not automatically validate the preview. |

Create, Recipe, Analyze, and Compare are coordinated by
`ParticleStudioAdvanced`. It edits versioned sidecars and displays supplied
runtime measurements, but it does not step a solver or invent sensor values.
Legacy Artist and Twin sidecar fields remain readable in project v2 so older
documents round-trip without data loss, but they are not current workspaces.
(Source:
`webgpu-os/factory/apps/particles/ParticleStudioAdvanced.js`)

## Recipe-backed demo catalog

The catalog contains 40 stable demos across Cosmic, Fields, Matter, Life, and
Events. Running a demo creates a fresh project with a canonical typed recipe;
building from it creates an editable remix through the same project factory.
Every source preset uses one of two classifications: `Artistic` or
`Educational Model`. Each record also declares tags, difficulty, fidelity,
macro controls, known limitations, and native migration metadata. (Source:
`webgpu-os/factory/apps/particles/ParticleLabCatalog.js`)

| Category | Presets |
| --- | --- |
| Cosmic | Spiral Galaxy, Orbital Clusters, Supernova Shell, Black-Hole Accretion, Comet Storm, Planetary Rings, Pulsar Jets, Globular Star Cluster |
| Fields | Quantum Vortex, Curl-Noise Nebula, Magnetosphere, Aurora Curtains, Tornado Field, Lightning Cage, Solar Wind Stream, Gravity Lens, Magnetic Reconnection, Vector Weave |
| Matter | Thermal Fountain, Reaction Chamber, Cohesive Fluid, Molecular Lattice, Ocean Waves, Waterfall Canyon, Lava Flow, Crystal Growth, Smoke Chamber |
| Life | Strange Attractor, Flocking Ribbons, Jellyfish Bloom, Firefly Swarm, Mycelium Growth, Plankton Current, Neural Pulse Web |
| Events | Event Fireworks, Meteor Shower, Rainstorm, Snow Globe, Sandstorm Wall, Geyser Burst |

`Artistic` means the preset prioritizes visual composition. `Educational
Model` means it demonstrates a concept with explicit limitations. Neither
classification means the result is calibrated, validated, or suitable for
engineering decisions. Built-in preset documents are deeply frozen so a
project cannot mutate the catalog definition. (Source:
`webgpu-os/factory/apps/particles/ParticleLabProject.js`)

Every catalog record also names its animated preview composition. Catalog `id`
is stable project identity, while `runtimeId` selects a verified custom-solver
family. Variants can reuse an audited family without colliding with catalog
identity. Ocean Waves uses dedicated runtime ID 15 for its layered traveling
wave sheet; it remains an artistic/educational particle surface, not a CFD or
Navier-Stokes result.

## Versioned Studio projects

A project is a validated JSON document with schema
`particle-realms.particle-project` version `2`. Version 2 keeps the original
identity, provenance, seed, timestamps, classification, tags, and normalized
settings, then adds the complete Studio authoring state. (Source:
`webgpu-os/factory/apps/particles/ParticleLabProject.js`)

| Field | Persisted content |
| --- | --- |
| `studioDocument` | Scene, view, artist, and comparison authoring documents. |
| `recipeGraph` | Canonical typed recipe graph. |
| `sensorDefinitions` | Validated sensor definitions in stable ID order. |
| `twinConfiguration` | Disconnected-safe connector configuration and validated alert rules. Runtime truth and credentials are excluded. |
| `externalStudies` | Up to eight normalized studies. Each imported study is limited to 4 MiB. |
| `quality` | Authored automatic/profile/target-frame-time intent, not transient device pressure. |

Canonical version-2 validation rejects unknown project and settings fields.
Serialization is stable and limited to 32 MiB. Version-1 projects migrate
deterministically to version 2, and the former
`webgpu-os.particles.workspace.v4` settings payload remains an import path.
(Source: `webgpu-os/factory/apps/particles/ParticleLabProject.js`)

The project layer provides these primary operations:

- `createParticleProject()` creates a version-2 project from an immutable
  built-in preset.
- `migrateParticleProjectV1()` upgrades a compatible version-1 document.
- `normalizeParticleProject()` repairs compatible input into the canonical
  current schema.
- `validateParticleProject()` reports errors and warnings without silently
  accepting a non-canonical document.
- `migrateParticleWorkspaceV4()` imports the legacy workspace settings.
- `serializeParticleProject()` and `deserializeParticleProject()` implement
  validated JSON export and import.
- `remixParticleProject()` creates a new identity and records its source. It
  preserves the seed unless the caller requests a new one.

### Project API example

The following browser module code creates, exports, imports, and remixes a
project:

```javascript
import {
  createParticleProject,
  deserializeParticleProject,
  remixParticleProject,
  serializeParticleProject,
} from './webgpu-os/factory/apps/particles/ParticleLabProject.js';

const project = createParticleProject(
  'particle-realms.preset.galaxy.v1',
  { name: 'My Spiral Study', seed: 42017 },
);

const exportedJson = serializeParticleProject(project);
const importedProject = deserializeParticleProject(exportedJson);
const remix = remixParticleProject(importedProject, {
  name: 'My Spiral Study Remix',
});
```

The project seed initializes both the custom model and the native CPU seed
state deterministically for the same settings. This does not promise
bit-identical GPU evolution across implementations. (Sources:
`webgpu-os/factory/apps/particles/ParticleApp.js`,
`webgpu-os/factory/apps/particles/ParticleNativeState.js`)

## Typed recipe graph

The `particle-realms.simulation-recipe.graph` version-1 document contains
typed node families, typed input and output ports, nodes, and edges. Its
validator checks unknown types, endpoint compatibility, required inputs,
single-input cardinality, and cycles. Graph changes receive an impact class,
and a failed compile can retain the last valid plan for inspection. (Source:
`webgpu-os/factory/apps/particles/ParticleRecipeGraph.js`)

The Recipe Builder renders canonical nodes and typed edges on a pannable,
horizontally contained canvas. Its palette uses the shared node registry, and
all add, remove, connect, disconnect, position, and parameter operations call
the same graph helpers used by imported recipes. An incomplete edit remains
visible as an authored draft with exact diagnostics while the persisted
project and executable plan stay on the last valid graph. Removing or wiring
the incomplete part recompiles and persists the recovered graph. The compact
preview consumes the same bounded native sample as Create; **Open live
Simulate** switches to the single authoritative simulation canvas. (Source:
`webgpu-os/factory/apps/particles/ParticleStudioAdvanced.js`)

`compileParticleRecipeGraph()` produces a deterministic
`particle-realms.simulation-recipe.execution-plan` with the execution model
`adapter-bound-native-subsystems`. `ParticleRecipeRuntimeAdapter` applies the
validated graph seed, particle count, force, point size, exposure, camera
distance, supported solver type, fixed step, and substep count to
`ParticleApp`. Direct Quick and Standard edits synchronize those mapped nodes
without replacing custom graph topology. An invalid graph leaves the current
runtime settings and the controller's last-valid plan in place. Other node
families remain validated authoring intent rather than claimed engine
execution. (Sources:
`webgpu-os/factory/apps/particles/ParticleRecipeRuntimeAdapter.js`,
`webgpu-os/factory/apps/particles/ParticleApp.js`)

## GPU runtime paths

The app chooses among three truthful runtime levels:

1. An audited native mode uses `ParticleNativeRuntime` to create and step an
   engine `ParticleSimWorld`. `ParticleNativeRenderer` reads the world's
   borrowed position buffer directly.
2. An unsupported, over-limit, or unavailable native mode uses the existing
   custom compute and HDR render WGSL path.
3. If WebGPU initialization or recovery fails, a generic Canvas 2D preview
   capped at 5,000 points preserves visual continuity. It does not simulate
   the selected model.

The native adapter currently maps these project modes:

| Project mode | Native system | Native state attributes |
| --- | --- | --- |
| `galaxy`, `nbody` | n-body | mass |
| `flock` | flocking | base particle state |
| `fluid` | SPH | base particle state |
| `chemistry` | chemistry | unsigned element and valence state |
| `electromagnetic` | electromagnetic | floating-point charge state |
| `molecular` | Lennard-Jones | unsigned element state |

The native path requires the granted device to expose at least 10 storage
buffers per shader stage. A dedicated device request asks for that exact
limit. A shared OS device is immutable, so the Studio validates its granted
limit and uses the custom path when it is insufficient. Galaxy and n-body
also have a 10,000-particle interactive ceiling in the app; native state has a
100,000-particle ceiling for those modes and a 1,000,000-particle ceiling for
the other mapped modes, subject to actual device limits. (Sources:
`webgpu-os/factory/apps/shared/GpuLabRuntime.js`,
`webgpu-os/factory/apps/particles/ParticleApp.js`,
`webgpu-os/factory/apps/particles/ParticleNativeState.js`)

The native renderer binds the borrowed `vec4<f32>` position buffer with a
16-byte stride. It renders additive LDR points and reports HDR and trails as
unavailable. Camera controls remain active, but the custom WGSL brush is not
connected to the native world. Cleanup destroys only resources owned by the
adapter and renderer, not an OS-owned device or borrowed world buffer.
(Sources: `webgpu-os/factory/apps/particles/ParticleNativeRuntime.js`,
`webgpu-os/factory/apps/particles/ParticleNativeRenderer.js`)

## Bounded views and measured evidence

The native frame loop samples Create, Analyze, and Compare no
more frequently than once every 500 ms; Create also exposes an explicit sample
request. Each sample is a bounded prefix of at most 4,096 particles and
contains positions plus velocity and thermal arrays only when the engine
exports those readbacks. The sample reports when it is truncated. It does not
interpolate, resample, or reconstruct the full field. (Sources:
`webgpu-os/factory/apps/particles/ParticleApp.js`,
`webgpu-os/factory/apps/particles/ParticleNativeRuntime.js`)

`ParticleMultiViewRuntime` projects that one sample into top, density,
velocity, and time-history Canvas 2D views. These are interaction aids, not
scientific field renderers. The quality governor can select a lower profile
from measured frame windows; profiles change secondary-view scale and rate and
can suspend extra views. Profiler rows remain empty until the host supplies
explicit stage attribution. (Sources:
`webgpu-os/factory/apps/particles/ParticleMultiViewRuntime.js`,
`webgpu-os/factory/apps/particles/ParticleQualityGovernor.js`)

The measured runtime telemetry contract accepts finite non-negative `fps`,
`frameMs`, `submitMs`, `gpuMs`, `particleCount`, and `particleBytes` values.
Unavailable GPU timing stays absent. Analyze converts accepted measurements
into provenance-bearing sensor samples; it never fills missing series with
synthetic data. Compare matches only the same quantity and unit when it pairs
measured and external series. (Sources:
`webgpu-os/factory/apps/particles/ParticleLabTelemetry.js`,
`webgpu-os/factory/apps/particles/ParticleSensorRuntime.js`,
`webgpu-os/factory/apps/particles/ParticleExternalStudy.js`)

## Legacy Twin compatibility boundary

Project v2 can still round-trip an older Twin configuration containing a
manual, disconnected-safe
connector description and alert rules that reference persisted sensor IDs.
Credential-like fields are rejected. Loading a project never opens a
connection, and the current six-stage Studio exposes no Twin workspace.
(Sources: `webgpu-os/factory/apps/particles/ParticleLabProject.js`,
`webgpu-os/factory/apps/particles/ParticleTwinRuntime.js`)

The retained `ParticleTwinRuntime` remains independently tested for older
integrations, but `ParticleApp` does not mount its controls in the current
product workflow. This preserves documents and code consumers without making
Digital Twin a user-facing simulation-building stage.

## Causal and durable persistence

Studio persists a complete `particle-realms.studio-workspace` version-2
snapshot. It loads the app-scoped Causal State Engine (CSE) first, then the
encrypted app sandbox, then the old local-storage key as a migration fallback.
Writes are debounced, use an expected CSE version, and mirror to the sandbox.
The legacy key is removed after either durable service succeeds. (Sources:
`webgpu-os/factory/apps/particles/ParticleApp.js`,
`webgpu-os/factory/apps/particles/ParticleStudioPersistence.js`)

Guarded state syscalls inject the authenticated app ID. `AppStateEngine.put()`
creates immutable versions, stamps successful writes with a hybrid logical
clock, and appends a hash-chained event. CSE values are limited to 64 KiB, so a
larger valid project may be stored by the sandbox mirror even when the CSE
write is rejected. The save result reports which persistence service
succeeded. (Sources: `webgpu-os/kernel/Syscalls.js`,
`webgpu-os/kernel/state/AppStateEngine.js`,
`webgpu-os/storage/AppSandbox.js`)

An expected-version conflict does not become an invented consensus result.
Studio reloads the current CSE head, retries the explicit local edit once as
`project.reconciled`, and leaves the conflict visible in the CSE timeline.

## Current limitations

- Recipe execution is limited to the mapped ParticleApp settings and clock;
  arbitrary subsystem, audio, output, and coupling nodes are not dispatched.
- Native mode coverage is limited to the seven mappings listed above.
- Native rendering is LDR and has no trails or solver-connected brush.
- Native readback is bounded and cannot represent a complete scientific field.
- Multi-view projections and external comparisons are not scientific
  validation or calibration.
- Compatibility-only Artist/Twin sidecars are not visible workspaces.
- Sensors are runtime measurements, not calibrated physical instruments.

Use each preset's Discover limitations and the active backend label before
interpreting a result.

## See also

- [Particle Studio Integration Map](particle-studio-integration-map.md)
- [Engine Particle System](../engine/particles.md)
- [GPU Device Sharing](../concepts/gpu-device-sharing.md)
- [Security and Trust Model](../concepts/security-model.md)
