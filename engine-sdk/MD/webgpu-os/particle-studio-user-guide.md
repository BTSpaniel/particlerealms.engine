---
title: Particle Studio User Guide
description: Task-oriented guide to the current Particle Realms Studio workspaces and evidence boundaries.
audience: Particle Realms Studio users
updated: 2026-07-15
---

# Particle Studio User Guide

Particle Realms Studio is the Particle Sandbox application inside WebGPU OS.
It provides six workspaces for selecting, running, safely tuning, inspecting,
and comparing particle projects. Full brush construction belongs in Paint
Studio; the reusable node/part builder belongs in the developing RealmForge.
Particle Realms reads the same portable project and recipe documents they
produce. Results are artistic or educational previews unless your own evidence
and validation process establishes otherwise.
(Sources: `webgpu-os/factory/apps/particles/ParticleStudioShell.js`,
`webgpu-os/factory/apps/particles/ParticleLabCatalog.js`)

This guide is for users who want to run and inspect current Studio projects
without confusing authored previews with measured or validated evidence.

## Before opening Studio

Run WebGPU OS over HTTP in a browser with WebGPU enabled for the native or
custom GPU paths. The application can remain accessible in generic Canvas 2D
recovery mode when WebGPU is unavailable, but that mode does not execute the
selected model. Open **Particle Sandbox** from the WebGPU OS app catalog and
check the backend label before interpreting the scene. (Sources:
`webgpu-os/apps/particles/factory.js`,
`webgpu-os/factory/apps/particles/ParticleApp.js`)

## Choose and run a recipe demo

1. Open **Discover** and filter the 40 built-in recipe demos by category, tag,
   difficulty, or search text.
2. Read the demo's classification, model description, and limitations.
3. Use **Run Demo** to create a fresh normal project from its canonical recipe,
   or **Build from Recipe** to create an editable remix. **Inspect Recipe
   Graph** shows the actual typed graph used by the demo.
4. Simulate opens with the full canvas visible. Choose **Tuning** or press `B`
   only when you want the advanced drawer.

Favorites and recent choices are local convenience state. A preset labeled
`Artistic` prioritizes composition; `Educational Model` demonstrates a concept
with stated limitations. Neither label means calibrated or certified.
Each card has an animated composition-specific preview, so an ocean, fountain,
galaxy, flock, or storm is recognizable before the full runtime opens.
(Sources: `webgpu-os/factory/apps/particles/ParticleLabCatalog.js`,
`webgpu-os/factory/apps/particles/ParticleStudioAdvanced.js`)

## Tune the live simulation

The tuning drawer stays closed when **Simulate** becomes active. Open it with
the toolbar action or `B`, and close it with the drawer button, toolbar action,
`B`, or `Escape`.

Particle population is automatic. Studio samples delivered frame cadence,
smooths several observations, and uses hysteresis plus a reallocation cooldown
to move population toward a stable 60 FPS. The Simulate row shows the current
automatic population but provides no count or cap input. The only ceiling is
the current GPU/runtime safety contract; users do not configure it. Population
changes rebuild size-dependent resources. Other controls update the active
configuration according to their declared impact. The active backend report
identifies whether Studio is using the native engine path, the custom WGSL
path, or the generic recovery preview. (Sources:
`webgpu-os/factory/apps/particles/ParticleApp.js`,
`webgpu-os/factory/apps/particles/ParticleLabCatalog.js`)

Direct controls synchronize the mapped nodes in the current recipe on save.
That synchronization preserves custom graph topology and unsupported authored
intent. It does not convert every recipe node into running engine state.
(Source:
`webgpu-os/factory/apps/particles/ParticleRecipeRuntimeAdapter.js`)

Studio has three control-detail levels. **Quick** shows Effect, automatic Particles,
Force, and Size. **Standard** also shows Palette and Brush. **Advanced** keeps
the Standard row. Changing detail level never opens the tuning drawer. The drawer groups
the remaining current settings under Interaction, Dynamics, Matter, and
Presentation. Advanced is a broader settings surface, not a promise that every
typed recipe node has a dedicated widget. (Source:
`webgpu-os/factory/apps/particles/ParticleApp.js`)

## Choose a simulation view

The three buttons at the top center of **Simulate** select one authoritative
perspective and two bounded inspection views:

- **Perspective** (`◈`) shows the live 3D renderer. Drag to orbit, use the
  mouse wheel to dolly, and choose **Home camera** to restore the complete
  camera authored for the selected preset. Changing presets also resolves a
  fresh complete home camera, so yaw or pitch from the previous preset cannot
  leak into the next scene.
- **Top** (`⊤`) shows a fixed X/Z projection of a stratified sample taken
  across the active particle population.
- **Density** (`▦`) bins the same kind of fixed X/Z sample into a heatmap.

Top and Density preserve the sampled world aspect ratio. They do not stretch
each axis independently. Their fixed projection canvas blocks interactions
with the hidden perspective camera, and **Home camera** remains disabled until
Perspective is active again. Both projections are bounded inspection views,
not independent solver runs or full-state scientific fields. (Sources:
`webgpu-os/factory/apps/particles/ParticleApp.js`,
`webgpu-os/factory/apps/particles/ParticleMultiViewRuntime.js`)

## Author the scene in Create

**Create** edits versioned scene objects organized as domain, geometry,
boundaries, materials, emitters, fields, solvers, couplings, sensors,
visualizers, cameras, audio, timeline, telemetry, and outputs. Objects carry
stable IDs, enabled state, transform, type, label, and free-form parameters.
(Source: `webgpu-os/factory/apps/particles/ParticleStudioDocument.js`)

The Perspective, Top, Density, Velocity, and History displays are compact views
derived from one bounded native sample. They are not independent camera
renders, separate solver runs, full-state field slices, or calibrated
engineering plots. Scene-tree edits are authored document changes; the current
UI is not a complete ECS editor with transform gizmos and undo history.
(Sources: `webgpu-os/factory/apps/particles/ParticleMultiViewRuntime.js`,
`webgpu-os/factory/apps/particles/ParticleStudioAdvanced.js`)

## Edit a recipe

**Recipe** opens a full-width visual builder. Use **Add node** to insert a
registered typed part, choose compatible **From output** and **To input**
sockets to connect it, drag cards to organize the graph, and select any card
to edit its safe parameters or exact X/Y position. Connections and selected
parts have explicit remove actions. The right-side preview renders the latest
bounded native readback; **Open live Simulate** moves to the authoritative
simulation canvas.

The status badges distinguish `graph valid`, `graph invalid`, `plan current`,
and `last-valid plan retained`. An incomplete part stays visible with exact
diagnostics, but it is not persisted or applied to the runtime. Complete its
required connections or remove it to recover the current executable plan.
(Sources: `webgpu-os/factory/apps/particles/ParticleRecipeGraph.js`,
`webgpu-os/factory/apps/particles/ParticleApp.js`)

The current runtime mapping covers seed, particle count, force, temperature,
point size, exposure, camera distance, supported solver mode, fixed step, and
substeps. Other node families remain saved and inspectable but do not execute.
The Recipe workspace is the Particle Realms compatibility builder for composing
and previewing simulations from portable parts. Paint Studio remains the owner
of brush-driven construction, and RealmForge remains the developing owner of
the reusable cross-product node/part authoring experience. (Sources:
`webgpu-os/factory/apps/particles/ParticleRecipeRuntimeAdapter.js`,
`webgpu-os/factory/apps/particles/ParticleStudioAdvanced.js`)

## Analyze measured data

**Analyze** displays accepted runtime and sensor series and can export sensor
records as JSON or CSV. A sensor definition identifies its quantity, unit,
source, sampling rate, reduction, and stale policy. Samples retain sequence,
timestamp, quality, and origin provenance. Missing metrics remain absent or
explicitly missing; Studio does not fill gaps with plausible values.
(Sources: `webgpu-os/factory/apps/particles/ParticleSensorRuntime.js`,
`webgpu-os/factory/apps/particles/ParticleLabTelemetry.js`)

The sensor runtime accepts supplied measurements and can reduce a bounded
compact numeric array. It does not currently read arbitrary solver fields or
install a full GPU probe/reduction pipeline by itself.

## Compare projects and external data

**Compare** can capture a candidate settings snapshot and display compatible
measured and external time series. Side-by-side project settings are not a
second simultaneously running simulation. Imported CSV or JSON studies are
bounded, retain source metadata, and default to unvalidated. Compare only
series with matching quantity and unit. (Sources:
`webgpu-os/factory/apps/particles/ParticleStudioDocument.js`,
`webgpu-os/factory/apps/particles/ParticleExternalStudy.js`,
`webgpu-os/factory/apps/particles/ParticleStudioAdvanced.js`)

An imported study never automatically validates the preview. Studio does not
currently submit remote solver jobs, ingest full scientific fields, or align a
spatial external field over the 3D viewport.

## Compatibility-only legacy sidecars

Project v2 still validates and round-trips older Artist timeline and Twin
configuration sidecars so existing files are not destroyed. They are not
visible Studio workspaces and are not part of the current recipe-authoring
workflow. Credential-like Twin fields and transient runtime truth remain
rejected from persisted projects. (Source:
`webgpu-os/factory/apps/particles/ParticleLabProject.js`)

## Choose a quality profile

Available profiles are **Economy**, **Interactive**, **High**, and
**Cinematic**. They control secondary-view scale and rate, maximum secondary
views, sensor-rate scale, trails, and post quality. Automatic mode observes a
window of measured frame times and changes one profile step after hysteresis
and cooldown rules. Critical memory pressure selects Economy; moderate
pressure caps the result at Interactive. (Source:
`webgpu-os/factory/apps/particles/ParticleQualityGovernor.js`)

Only automatic/profile/target-frame-time intent is persisted. Transient memory
pressure and profiler history are runtime observations.

## Save, export, import, and recover

Studio saves complete project snapshots through app-scoped causal state and
the encrypted sandbox, with legacy local storage as a compatibility fallback.
Project JSON uses a strict versioned schema and is limited to 32 MiB. Imports
from future unknown versions or with unknown canonical fields fail instead of
being guessed. (Sources:
`webgpu-os/factory/apps/particles/ParticleStudioPersistence.js`,
`webgpu-os/factory/apps/particles/ParticleLabProject.js`)

If GPU initialization or recovery fails, Studio may display a Canvas 2D
recovery preview so the project remains accessible. That preview is generic;
verify the backend status before interpreting behavior. Authored project state
is preserved across device-loss recovery. (Source:
`webgpu-os/factory/apps/particles/ParticleApp.js`)

## Keyboard and accessibility behavior

Workspace tabs support arrow-key movement, status changes are announced in an
ARIA live region, and the tuning drawer restores focus when closed. Standard
form labels and buttons are used throughout the shell. With reduced-motion
preference enabled, the tuning drawer transition is disabled. (Source:
`webgpu-os/factory/apps/particles/ParticleStudioShell.js`)

## Troubleshooting checklist

- **Selected model inactive:** Canvas 2D recovery is active. Retry WebGPU and
  confirm browser support, adapter access, and device status.
- **Native backend not selected:** the mode may be unmapped, the count may
  exceed its interactive ceiling, or the device may grant fewer than ten
  storage buffers per shader stage. The labeled custom path is expected.
- **Recipe did not apply:** read the exact graph diagnostics. Studio keeps the
  last valid project and settings when validation fails.
- **No chart value:** confirm a matching sensor definition and a supplied
  provenance-bearing sample. Missing measurements are intentionally empty.
- **External series not compared:** quantity and unit must exactly match a
  measured scalar series; Studio does not convert units or align time.
- **Import rejected:** confirm schema/version, canonical fields, size limits,
  and the absence of credential-like legacy Twin configuration.
- **After device loss:** preserve the project, use the labeled recovery view,
  then retry GPU initialization. Do not treat recovery motion as model output.

(Sources: `webgpu-os/factory/apps/particles/ParticleApp.js`,
`webgpu-os/factory/apps/particles/ParticleRecipeGraph.js`,
`webgpu-os/factory/apps/particles/ParticleSensorRuntime.js`,
`webgpu-os/factory/apps/particles/ParticleExternalStudy.js`,
`webgpu-os/factory/apps/particles/ParticleLabProject.js`)

Before sharing a result, export the project and measured data, record the
backend, preset classification and limitations, seed, recipe signature, fixed
step/substeps, quality profile, browser/device, and any fallback or missing
measurement. This record makes the result reviewable without elevating it to a
validation claim.

## Capability boundary

| Status | User-facing capability |
| --- | --- |
| Implemented | Discover, Create, Recipe, Simulate, Analyze, and Compare; recipe-backed demos; explicit Simulate tuning; automatic 60 FPS particle population; project import/export; measured-data export; local persistence; and labeled recovery. |
| Partial | Create uses bounded projections, Recipe executes mapped controls only, and Compare is settings/scalar-series based. |
| Unsupported | Editor-native gizmos/undo, Publish, Artist, or Twin workspaces, live connectors, remote solver jobs, full-field overlays, collaboration, and a standalone runtime player. |

## See also

- [Particle Realms Studio](particle-realms-studio.md)
- [Particle Studio Preset Authoring](particle-studio-preset-authoring.md)
- [Particle Recipe Schema](particle-recipe-schema.md)
- [Particle Studio Fidelity and Validation](particle-studio-fidelity-and-validation.md)
- [Particle Studio External Studies](particle-studio-external-studies.md)
