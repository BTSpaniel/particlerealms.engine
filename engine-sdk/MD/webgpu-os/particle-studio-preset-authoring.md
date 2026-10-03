---
title: Particle Studio Preset Authoring
description: Contracts and review guidance for built-in Particle Realms Studio presets.
audience: preset authors and app developers
updated: 2026-07-15
---

# Particle Studio Preset Authoring

Particle Realms presets are curated source records in
`ParticleLabCatalog.js`. The catalog currently contains 40 immutable built-in
presets. It is not a user-installable preset marketplace, and importing a
project does not register a new global preset. (Sources:
`webgpu-os/factory/apps/particles/ParticleLabCatalog.js`,
`webgpu-os/factory/apps/particles/ParticleLabProject.js`)

This guide is for developers who maintain the built-in catalog and its project
and recipe defaults.

## Required preset record

Each `PARTICLE_MODES` entry supplies:

| Field | Contract |
| --- | --- |
| `presetId` | Stable, versioned catalog identity. |
| `label` and `title` | Short and display names. |
| `id` | Stable numeric catalog identity used by projects and discovery. |
| `runtimeId` | Numeric custom-solver family ID. Variants may share an audited solver family, while a dedicated solver uses its own ID. |
| `previewKind` | Named animated Discover composition. It must visually distinguish the preset rather than reuse a generic particle cloud. |
| `category` | One of `cosmic`, `fields`, `matter`, `life`, or `events`. |
| `classification` | Exactly `Artistic` or `Educational Model`. |
| `tags` | Search and discovery labels. |
| `difficulty` and `fidelity` | User-facing complexity and model-fidelity description. |
| `systems`, `model`, and `description` | Concise account of the behavior that is actually present. |
| `limitations` | Explicit omissions and interpretation limits. |
| `macros` | Keys from the shared macro registry. |
| `nativeMigration` | Honest native-engine connection status, systems, and note. |
| `defaults` | Complete normalized ParticleApp starting settings. |

`defineMode()` freezes tags, limitations, defaults, and resolved macro
descriptors. Unknown macro keys throw during module evaluation. Keep IDs and
`presetId` values stable after release; project provenance depends on them.
(Source: `webgpu-os/factory/apps/particles/ParticleLabCatalog.js`)

## Current catalog

| Category | Built-in presets |
| --- | --- |
| Cosmic | Spiral Galaxy, Orbital Clusters, Supernova Shell, Black-Hole Accretion, Comet Storm, Planetary Rings, Pulsar Jets, Globular Star Cluster |
| Fields | Quantum Vortex, Curl-Noise Nebula, Magnetosphere, Aurora Curtains, Tornado Field, Lightning Cage, Solar Wind Stream, Gravity Lens, Magnetic Reconnection, Vector Weave |
| Matter | Thermal Fountain, Reaction Chamber, Cohesive Fluid, Molecular Lattice, Ocean Waves, Waterfall Canyon, Lava Flow, Crystal Growth, Smoke Chamber |
| Life | Strange Attractor, Flocking Ribbons, Jellyfish Bloom, Firefly Swarm, Mycelium Growth, Plankton Current, Neural Pulse Web |
| Events | Event Fireworks, Meteor Shower, Rainstorm, Snow Globe, Sandstorm Wall, Geyser Burst |

The classification is intentionally conservative and declared independently on
every record. A title alone must never imply a solver that the model does not
implement. For example, Quantum Vortex explicitly states that its name is
thematic rather than a quantum-fluid solve, while Ocean Waves identifies its
layered procedural wave sheet and its non-CFD limitation.
(Source: `webgpu-os/factory/apps/particles/ParticleLabCatalog.js`)

## Macro controls

Authors select controls from a shared registry rather than defining ad hoc UI
ranges inside a preset:

| Key | Range | Unit |
| --- | --- | --- |
| `count` | 1,000..10,000,000, integer step 1,000 | particles |
| `force` | 0.1..4 | relative |
| `size` | 0.35..8 | px |
| `exposure` | 0.35..3 | EV |
| `gravity` | -3..3 | relative |
| `drag` | 0.94..1 | ratio |
| `turbulence` | 0..4 | relative |
| `cohesion` | 0..4 | relative |
| `temperature` | 50..15,000 | K |
| `reactionRate` | 0..3 | relative |
| `charge` | -3..3 | relative |
| `trailPersistence` | 0.7..0.98 | ratio |
| `bloom` | 0..2 | relative |
| `autoOrbit` | 0..1 | speed |

Use the shared label, type, minimum, maximum, step, and unit exactly. The
runtime normalizer remains authoritative and may clamp against device or app
limits. A physical-looking unit on one control does not make the entire model
calibrated. (Sources:
`webgpu-os/factory/apps/particles/ParticleLabCatalog.js`,
`webgpu-os/factory/apps/particles/ParticleLabProject.js`)

## Defaults and reproducibility

Defaults should form a complete, finite settings patch accepted by the project
normalizer. Preserve a fixed seed in derived project fixtures when a visual or
behavioral comparison must be repeatable. Count affects allocation and native
eligibility; do not use a large default merely to make the preset look dense.
Camera distance, palette, exposure, size, and optional trails should produce a
legible first frame without hiding the model's limitations. (Sources:
`webgpu-os/factory/apps/particles/ParticleLabProject.js`,
`webgpu-os/factory/apps/particles/ParticleApp.js`)

## Model and limitation text

A useful preset description answers four separate questions:

1. What algorithm or approximation moves the particles?
2. Which controls have meaningful effects in that implementation?
3. Which familiar physical process is only suggested visually?
4. Which conclusions must not be drawn from the result?

Do not call procedural curl noise CFD, a global cohesion field SPH, a thematic
vortex quantum physics, or a rule-based color change molecular kinetics. The
existing catalog follows this separation in every `model` and `limitations`
record. (Source: `webgpu-os/factory/apps/particles/ParticleLabCatalog.js`)

## Native-engine status

`nativeMigration.status` is descriptive runtime truth:

| Status | Current presets |
| --- | --- |
| `runtime-connected-with-fallback` | Spiral Galaxy, Flocking Ribbons, Magnetosphere, Reaction Chamber, Cohesive Fluid, Molecular Lattice, Orbital Clusters |
| `available-not-connected` | The other 33 presets, including the 25 authored variants and the eight original custom-model presets. |

Connected presets map to audited native systems on compatible devices and
retain a fallback path. The status does not mean both paths are numerically
equivalent. `technologySummary()` reports the current connection and its
limitations; update the status only when the active app path is actually
wired and verified. (Sources:
`webgpu-os/factory/apps/particles/ParticleLabCatalog.js`,
`webgpu-os/factory/apps/particles/ParticleNativeState.js`)

## Recipe and project generation

`createParticleProject()` creates a project-v2 document from a catalog preset,
including its provenance, normalized settings, default Studio document, and
default typed recipe graph. `remixParticleProject()` creates a derived project
without mutating the frozen source preset. Mapped direct controls synchronize
default graph nodes, while custom and unsupported nodes remain authored.
(Sources: `webgpu-os/factory/apps/particles/ParticleLabProject.js`,
`webgpu-os/factory/apps/particles/ParticleRecipeGraph.js`,
`webgpu-os/factory/apps/particles/ParticleRecipeRuntimeAdapter.js`)

## Author review checklist

- Use a new stable `presetId` and an unused numeric catalog `id`.
- Reuse an audited `runtimeId` only when the model and limitations truthfully
  match that solver family; otherwise add and verify a dedicated runtime branch.
- Give every preset a distinct `previewKind` and review its animated card.
- Select an existing category and an exact supported classification.
- Reuse only registered macro keys and keep defaults inside their ranges.
- State the implemented model and at least one concrete limitation.
- Name only engine systems that exist and report their actual connection
  status.
- Verify creation, normalization, serialization, remix provenance, recipe
  compilation, both available runtime paths, and recovery behavior.
- Confirm all user-facing claims remain true at low and high supported counts.

The checked-in browser suites are the source of executable coverage; visual
review supplements them but does not replace schema and runtime tests. (See
`tests/particle-project-v2.html`, `tests/particle-recipe-graph.html`, and the
native particle integration tests under `tests/`.)

## Capability boundary

| Status | Preset capability |
| --- | --- |
| Implemented | Immutable 40-preset catalog, categories, distinct animated previews, search metadata, truthful classifications, shared macros, defaults, limitations, project/remix creation, and native connection metadata. |
| Partial | Seven presets have native runtime mappings; other presets run the custom model or recovery path. |
| Unsupported | Runtime installation of third-party catalog presets, preset marketplace, arbitrary preset scripts, and a claim that native and custom paths are numerically identical. |

## See also

- [Particle Studio User Guide](particle-studio-user-guide.md)
- [Particle Recipe Schema](particle-recipe-schema.md)
- [Particle Studio Fidelity and Validation](particle-studio-fidelity-and-validation.md)
- [Particle Studio Test Plan](particle-studio-test-plan.md)
