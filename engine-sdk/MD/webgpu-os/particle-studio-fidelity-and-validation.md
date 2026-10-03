---
title: Particle Studio Fidelity and Validation
description: Interpretation, evidence, comparison, and validation boundaries for Particle Realms Studio.
audience: users, reviewers, and app developers
updated: 2026-07-14
---

# Particle Studio Fidelity and Validation

Particle Realms Studio separates an attractive interactive result from a
validated result. A functioning GPU path, deterministic seed, high particle
count, smooth frame rate, or imported reference file does not establish
physical accuracy. Claims must be supported by the implemented model and
explicit evidence. (Sources:
`webgpu-os/factory/apps/particles/ParticleLabCatalog.js`,
`webgpu-os/factory/apps/particles/ParticleExternalStudy.js`)

This page is for users and reviewers who decide what a Studio result can and
cannot support.

## Interpretation labels

| Label or state | Meaning in the current product |
| --- | --- |
| `Artistic` | The preset prioritizes composition and motion. Physical names may be thematic. |
| `Educational Model` | The preset demonstrates a concept with explicit approximations and omissions. |
| `runtime-connected-with-fallback` | A compatible device may use mapped engine systems; another path remains available. |
| `available-not-connected` | A relevant engine system exists, but the preset is not wired to it in the app. |
| External `unvalidated` | Imported data has no review claim. |
| External `reference` | Data is retained as a comparison reference. |
| External `reviewed` | Review is asserted in the imported provenance. |
| External `validated` | The study supplies reviewer, solver, and solver-version provenance. It still does not validate Studio automatically. |

(Sources: `webgpu-os/factory/apps/particles/ParticleLabCatalog.js`,
`webgpu-os/factory/apps/particles/ParticleExternalStudy.js`)

## Runtime-path fidelity

The native path and custom WGSL path are different implementations. Seven
preset modes can map to native engine systems on compatible devices. Other
modes use the custom visual model. The Canvas 2D path is a generic recovery
preview. Backend status therefore belongs in every reproducibility record.
(Sources: `webgpu-os/factory/apps/particles/ParticleNativeState.js`,
`webgpu-os/factory/apps/particles/ParticleApp.js`)

Native rendering binds the engine world's position buffer directly, while
CPU-side views use a bounded readback prefix. The direct renderer proves that
the displayed positions came from the native world; it does not prove that the
world is calibrated. The Create secondary views are projections of one compact
sample, not full-resolution solution fields. (Sources:
`webgpu-os/factory/apps/particles/ParticleNativeRenderer.js`,
`webgpu-os/factory/apps/particles/ParticleNativeRuntime.js`,
`webgpu-os/factory/apps/particles/ParticleMultiViewRuntime.js`)

## Evidence classes

Keep these records distinct:

| Evidence | Required provenance | Permitted conclusion |
| --- | --- | --- |
| Runtime telemetry | Supplied timestamp and measured metric | Runtime behavior for the recorded session. |
| Sensor sample | Sensor ID, quantity, unit, source ID, sequence, timestamp, quality, and origin | The accepted measurement represented by that definition. |
| Compact reduction | Explicit finite values and, for integrals, explicit weights | The stated reduction over the supplied compact input. |
| External study | Source, author, solver/version, coordinate system, units, review metadata, assumptions, and limitations as applicable | Comparison to that imported reference. |

Missing measurements remain missing. Profiler stages remain empty until the
host supplies them. Compatibility-only prediction modules are not part of the
current six-workspace Studio. (Sources:
`webgpu-os/factory/apps/particles/ParticleLabTelemetry.js`,
`webgpu-os/factory/apps/particles/ParticleSensorRuntime.js`,
`webgpu-os/factory/apps/particles/ParticleQualityGovernor.js`)

## External-study boundary

Every normalized study sets `validatesNativePreview` to `false`; validation
rejects any other value. A study marked `validated` must name a reviewer,
solver, and solver version, but this describes the study's provenance only.
An unspecified coordinate system disables spatial-overlay claims. The current
Compare workspace matches measured and external series by exact quantity and
unit and displays an index-aligned comparison. (Sources:
`webgpu-os/factory/apps/particles/ParticleExternalStudy.js`,
`webgpu-os/factory/apps/particles/ParticleStudioAdvanced.js`)

The current implementation does not perform time interpolation, coordinate
registration, mesh conversion, uncertainty propagation, norm computation,
full-field comparison, or automatic pass/fail acceptance. Do those operations
in a reviewed external workflow before claiming validation.

## Reproducible comparison record

For a meaningful review, retain at least:

- project JSON, project schema version, preset ID, classification, and
  provenance;
- recipe graph and compiled graph signature;
- seed, supported mapped recipe settings, fixed step, and substeps;
- selected backend, browser/device information, granted limits, and quality
  profile;
- sensor definitions and exported samples with units and quality;
- external-study source, solver/version, coordinate system, assumptions,
  limitations, and reviewer metadata;
- the metric, alignment rule, tolerance, and decision made outside Studio.

Studio already persists or exports many of these records, but it does not
assemble a certification package or choose scientific tolerances. (Sources:
`webgpu-os/factory/apps/particles/ParticleLabProject.js`,
`webgpu-os/factory/apps/particles/ParticleRecipeGraph.js`,
`webgpu-os/factory/apps/particles/ParticleSensorRuntime.js`,
`webgpu-os/factory/apps/particles/ParticleExternalStudy.js`)

## Determinism boundary

Project seeds, canonical graph ordering, stable plan signatures, and fixed-step
recipe clock values support repeatable authored intent.
They do not guarantee bit-identical output across every GPU, browser, runtime
path, or floating-point implementation. The quality governor can also change
secondary-view and post-processing policy during automatic operation.
(Sources: `webgpu-os/factory/apps/particles/ParticleRecipeGraph.js`,
`webgpu-os/factory/apps/particles/ParticleRecipeRuntimeAdapter.js`,
`webgpu-os/factory/apps/particles/ParticleStudioDocument.js`,
`webgpu-os/factory/apps/particles/ParticleQualityGovernor.js`)

## Engineering-use gate

Do not use the interactive preview for safety, design certification, control
decisions, or engineering predictions unless an external process has verified
all of the following:

1. The executed equations, boundaries, material properties, units, and initial
   conditions match the intended problem.
2. The active runtime path is the one that was reviewed.
3. Grid or particle convergence, time-step sensitivity, and conservation or
   stability checks are appropriate and pass.
4. Measurements are complete, calibrated, and traceable.
5. Comparison alignment and uncertainty are documented.
6. Independent reference results and acceptance tolerances are reviewed.

Studio currently provides no certification workflow and no calibrated probe
chain. Preset limitations remain the controlling interpretation when these
conditions have not been met.

## Capability boundary

| Status | Fidelity or validation capability |
| --- | --- |
| Implemented | Honest demo classifications and limitations, backend reporting, provenance-bearing measurements, explicit missing data, and bounded external-study validation levels. |
| Partial | Deterministic authored graph and clock state support repeatable studies; external comparison is compatible-series and index aligned only. |
| Unsupported | Automatic validation transfer, full-field overlays, uncertainty propagation, calibrated probes, solver verification/certification, hard scientific performance claims, and guaranteed cross-device bitwise determinism. |

## See also

- [Particle Studio External Studies](particle-studio-external-studies.md)
- [Particle Studio Telemetry](particle-studio-telemetry.md)
- [Particle Studio Preset Authoring](particle-studio-preset-authoring.md)
- [Particle Studio Test Plan](particle-studio-test-plan.md)
- [Particle Studio Integration Map](particle-studio-integration-map.md)
