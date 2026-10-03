---
title: Particle Studio Test Plan
description: Automated, real-device, manual, performance, and release verification for Particle Realms Studio.
audience: developers, reviewers, and release engineers
updated: 2026-07-15
---

# Particle Studio Test Plan

This plan verifies current repository behavior and records gaps against the
broader Simulation Studio design pack. Passing structural and runtime tests
does not establish scientific validity or performance on hardware that was not
measured.

This page is for developers and release reviewers who need repeatable coverage
and explicit acceptance-test gaps.

## Evidence levels

| Level | Evidence |
| --- | --- |
| Contract | Pure validation, normalization, migration, serialization, and deterministic helper checks. |
| Browser integration | DOM, controller, persistence seam, and fallback behavior in a served ES-module page. |
| Real WebGPU | Pipeline creation or real engine world execution on an actual granted `GPUDevice`. |
| Manual UX | Keyboard, focus, responsive layout, warning semantics, reduced motion, and recovery observation. |
| Scientific validation | Independent equation, convergence, calibration, uncertainty, and reference review. Not supplied by current tests. |

All browser pages must be served over HTTP. Start the repository server with
the repository command, then open the relevant test route under
`http://127.0.0.1:9001/`. (Source: `AGENTS.md`)

```bash
python start_server.py
```

## Automated inventory

| Suite | Current scope |
| --- | --- |
| `tests/particle-project-v2.html` | 29 project-v2 creation, deterministic serialization, migration, strict-field, Studio-sidecar, sensor, Twin, external-study, quality, and round-trip cases. |
| `tests/particle-recipe-graph.html` | 28 graph registry, type, topology, validation, deterministic compile, impact, migration, last-valid, runtime-adapter, direct-sync, and observability cases. |
| `webgpu-os/factory/apps/particles/tests/particle-studio-advanced-controller.html` | 36 checks covering the four current advanced workspaces, visual Recipe add/connect/remove/recovery behavior, measured preview, compatibility-only Artist/Twin controller contracts, canonical edits, bounded samples, external import, overflow, and ownership. |
| `webgpu-os/factory/apps/particles/tests/particle-runtime-tests.html` | Browser harness for sensor and Twin runtime unit modules. |
| `webgpu-os/factory/testing/smoke/particle-studio-advanced.html` | 20 advanced-domain checks including automatic count pressure, headroom, quantization, and hardware-ceiling decisions. |
| `webgpu-os/factory/testing/smoke/particle-camera-views.html` | Focused home-camera, stratified readback, projection aspect-ratio, render, and sample-provenance checks. |
| `webgpu-os/factory/apps/particles/tests/ParticleSensorRuntime.test.js` | Definition, sample, quality, reduction, export, and provenance contracts. |
| `webgpu-os/factory/apps/particles/tests/ParticleTwinRuntime.test.js` | Connector state, append-only truth, replay, branches, predictions, and alerts. |
| `webgpu-os/factory/testing/smoke/particle-native-state.html` | Deterministic native state generation and mapped-mode contracts. |
| `webgpu-os/factory/testing/smoke/particle-native-runtime.html` | Native discovery, limits, world lifecycle, stepping, bounded readback, and teardown. |
| `webgpu-os/factory/testing/smoke/particle-native-renderer.html` | Borrowed-buffer validation, rendering, ownership, and teardown. |
| `webgpu-os/factory/testing/smoke/particle-sim-world-regressions.html` | Engine-world regressions used by the app's native path. |
| `webgpu-os/factory/apps/particles/tests/particle-app-native-integration.html` | 22 real-device checks covering native selection, closed-by-default tuning, automatic population UI and reallocation, recipe mapping, invalid-plan retention, fixed clock, readback, layout, and unmount ownership. |
| `tests/particle-runtime-compile-smoke.html` | Fourteen real-WebGPU render/compute pipeline compile checks for exported particle shaders. |

(Sources: the listed test files.)

## Core contract gate

Run the project, recipe, sensor, and compatibility Twin suites and require zero failures.
Confirm these negative paths explicitly:

- unknown project-v2, settings, Studio-sidecar, graph, node, port, and edge
  fields fail closed;
- future project and graph versions fail closed;
- project-v1, graph-v0, and legacy workspace-v4 compatible inputs migrate
  deterministically;
- duplicate IDs, cycles, incompatible ports, cardinality violations, missing
  required inputs, and unavailable required subsystems report exact errors;
- a tampered previous plan is rejected and an invalid current graph cannot
  replace the live settings;
- credentials and Twin runtime truth cannot enter the project document;
- external studies cannot claim to validate the native preview;
- missing measurements remain missing and integral reduction requires weights.

(Sources: `tests/particle-project-v2.html`,
`tests/particle-recipe-graph.html`,
`webgpu-os/factory/apps/particles/tests/ParticleSensorRuntime.test.js`,
`webgpu-os/factory/apps/particles/tests/ParticleTwinRuntime.test.js`)

## Recipe-runtime gate

Verify both pure and app-integrated behavior:

1. The compiled plan validates against its source graph and has a stable
   signature and topological order.
2. Seed, count, force, temperature, point size, exposure, camera distance,
   supported solver type, fixed step, and substeps apply through the adapter.
3. An unsupported solver or visualizer reports a warning and retains safe
   runtime state.
4. Direct controls update only mapped enabled default nodes and preserve custom
   topology, IDs, provenance, and source immutability.
5. Uniform changes preserve the native world; resize or rebuild impacts follow
   the app policy.
6. A fixed-step/substep change resets accumulated native time and requests one
   solver rebuild.
7. An invalid recipe preserves the complete last-valid project and settings.
8. The visual builder can add, connect, disconnect, position, and remove typed
   parts through canonical graph helpers.
9. A disconnected required part remains visible with exact diagnostics and a
   stale last-valid plan, then commits only after repair.
10. The embedded preview accepts only explicitly native bounded samples and
    opens the shared Simulate workspace for the full live view.

(Sources: `tests/particle-recipe-graph.html`,
`webgpu-os/factory/apps/particles/tests/particle-app-native-integration.html`)

## GPU and lifecycle matrix

Exercise at least these environments:

| Environment | Expected result |
| --- | --- |
| WebGPU, mapped mode, sufficient limits | Native runtime and direct renderer become ready. |
| WebGPU, mapped mode, fewer than ten storage buffers per stage | Native path is deferred; supported custom WGSL path remains usable. |
| WebGPU, unmapped mode | Custom WGSL path runs and backend labeling is accurate. |
| No WebGPU or failed initialization | Generic Canvas 2D recovery preview is labeled selected-model inactive. |
| OS-shared device | App teardown leaves the borrowed device alive. |
| Dedicated device | App teardown releases app-owned GPU resources. |
| Device loss | Authored project survives, recovery preview appears, and retry is exposed. |

For every native mapped mode, validate finite deterministic seed arrays, exact
required attributes, granted maximums, one solver step, direct position-buffer
binding, a bounded sample, busy-readback handling, and idempotent destruction.
(Sources: `webgpu-os/factory/apps/particles/ParticleNativeState.js`,
`webgpu-os/factory/apps/particles/ParticleNativeRuntime.js`,
`webgpu-os/factory/apps/particles/ParticleNativeRenderer.js`,
`webgpu-os/factory/apps/particles/ParticleApp.js`)

## Manual UX and accessibility gate

- At 660 × 480 and representative larger containers, confirm no advanced root
  has horizontal overflow and the main canvas remains usable.
- Use keyboard only to traverse all six workspace tabs, open and close the
  tuning drawer, activate primary actions, edit Recipe controls, import a local
  study, and export measured data.
- Confirm Simulate and Advanced detail entry keep tuning closed; the Tuning
  action and `B` shortcut open it explicitly and focus remains trapped/restored.
- Confirm no particle count, maximum, or cap input exists. Sustained low cadence
  must reduce the automatic population once, sustained headroom must grow it,
  and runtime/device safety ceilings must remain enforced internally.
- Switch among Perspective, Top, and Density. Confirm preset changes and Home
  restore the selected preset's complete camera, Top and Density preserve world
  aspect ratio, fixed projections do not change the hidden orbit camera, and
  returning to Perspective re-enables Home.
- At narrow and wide sizes, confirm Recipe fills its workspace, graph overflow
  stays inside the graph scroller, controls wrap without root overflow, and the
  measured-preview label remains visible.
- Confirm focus enters the drawer and returns to its opener; status changes are
  announced; warnings contain text or icons in addition to color.
- With reduced motion enabled, confirm the tuning transition is disabled.
- Play and Remix a preset without opening Recipe; Reveal Recipe then exposes
  exact validation and adapter-bound status.
- Confirm backend, classification, limitation, missing/stale, external,
  historical replay, and predicted labels remain visible at narrow widths.
- Import malformed, oversized, future-version, credential-bearing, and
  validation-claiming documents and confirm actionable failures.

(Sources: `webgpu-os/factory/apps/particles/ParticleStudioShell.js`,
`webgpu-os/factory/apps/particles/ParticleStudioAdvanced.js`,
`webgpu-os/factory/apps/particles/ParticleApp.js`)

## Performance and resource gate

Warm each runtime before measurement. Record raw telemetry and the environment
listed in the performance guide. Verify bounded 500 ms/4,096-particle prefix
readback for evidence workspaces, bounded 500 ms/16,384-particle stratified
readback for active Simulate projections, no full-state chart readback, stable resource counts during playback,
owned-resource release across preset rebuilds, shared-device preservation,
quality hysteresis/cooldown, manual memory-pressure decisions, and empty
profiler stages when attribution is not supplied. Use browser/GPU diagnostics
to check allocation behavior; source inspection alone is not proof of no
per-frame allocation. (Sources:
`webgpu-os/factory/apps/particles/ParticleApp.js`,
`webgpu-os/factory/apps/particles/ParticleQualityGovernor.js`)

## Master Prompt acceptance traceability

`Implemented` means current source and a listed gate cover the core claim.
`Partial` means only the narrower behavior shown is present. `Unsupported`
means the target feature is absent; a passing adjacent test must not be used as
evidence for it.

| Acceptance | Status | Current evidence or gap |
| ---: | --- | --- |
| 1 | Partial | WebGPU OS app reuses engine simulation but owns app presentation paths; it is not an editor-native workspace. |
| 2 | Partial | A validated plan reaches documented ParticleApp bindings only, not arbitrary native APIs. |
| 3 | Unsupported | No representative playground-demo conversion gate is part of this work. |
| 4 | Implemented | Native app integration and runtime/renderer smoke tests verify owned teardown and shared-device boundaries. |
| 5 | Partial | Create shows four compact projections/charts from one bounded native sample, not full fields. |
| 6 | Unsupported | No independent second-camera execution test or general multi-camera renderer exists. |
| 7 | Partial | Quality policy suspends excess optional views; there is no general renderer-pane scheduler. |
| 8 | Implemented | Optional-view policy is separate from the recipe fixed-step clock. |
| 9 | Partial | The Studio document emits a 2.5D interpretation warning; verify the visible label manually. |
| 10 | Partial | Compare labels a settings snapshot and does not create a second solver. |
| 11 | Unsupported | Mapped controls synchronize, but general gizmo, timeline-to-solver, and collaboration sync are absent. |
| 12 | Implemented | Recipe and real native app tests verify uniform edits preserve the native world. |
| 13 | Partial | Impact classes and rebuild/reset policy exist; manually verify warning copy for every rebuild path. |
| 14 | Implemented | Exact graph errors and last-valid project/settings retention are automated. |
| 15 | Partial | Project round-trip preserves current sidecars, IDs, seed, views, graph, and sensors; a general macro document is absent. |
| 16 | Partial | Project-v1, graph-v0, and workspace-v4 migration preserve supported provenance; incompatible-feature warning coverage is limited. |
| 17 | Partial | Compact reductions avoid full-field input, but no solver-connected GPU probe pipeline exists. |
| 18 | Partial | Analyze shows quantity/unit/latest/quality; complete range/time/dataset legend coverage requires manual review. |
| 19 | Implemented | Missing values and unsupported attribution remain absent. |
| 20 | Implemented | Sensor CSV/JSON export is covered against accepted records. |
| 21 | Unsupported | Ocean in a Bottle is not a current built-in preset. |
| 22 | Partial | Galaxy and Orbital Clusters map to native n-body with deterministic seed state; “Black Hole” is not a current preset. |
| 23 | Implemented | Tornado Field exposes `Educational Model` and limitations in the catalog. |
| 24 | Unsupported | Rocket and car wind-tunnel presets and Engineering Preview classification are absent. |
| 25 | Partial | Seven mapped presets reuse engine systems; no converted-demo equivalence suite exists. |
| 26 | Implemented | Twin replay and isolated what-if branch behavior are covered without truth mutation. |
| 27 | Implemented | Missing, stale, and numeric zero remain distinct sensor states. |
| 28 | Partial | Provenance is retained, but spatial overlay is unsupported. |
| 29 | Implemented | Schema and controller tests enforce non-transfer of validation. |
| 30 | Partial | Six attribution fields exist, but remain empty unless supplied by a host. |
| 31 | Partial | Stable-playback allocation must be measured; current suites do not prove it across hardware. |
| 32 | Implemented | Evidence sampling is a bounded prefix; Simulate projections use bounded stratified blocks; telemetry charts do not request full state. |
| 33 | Partial | Rebuild and teardown release owned resources; repeat-switch memory measurement remains manual. |
| 34 | Implemented | Device-loss recovery preserves authored project state and activates labeled recovery. |
| 35 | Partial | Governor handles explicit pressure and reduces optional quality; no complete OS pressure feed is attached. |
| 36 | Implemented | Discover Play and Remix are available without opening Recipe. |
| 37 | Partial | The typed registry covers all recipe families, but current UI is not a complete graphical editor. |
| 38 | Implemented | Tab keyboard behavior, focus management, labels, and live status are present; keep manual regression coverage. |
| 39 | Partial | Warnings include text; complete contrast and non-color-only visual review remains manual. |
| 40 | Partial | The app follows WebGPU OS shell conventions; editor-native layout preservation is outside current scope. |

## Release gates

After code and docs stop moving:

1. Run every suite in the automated inventory on at least one real WebGPU
   adapter and record browser/device details.
2. Run `python bundle_engine.py --target webgpu-os`; require zero bundle errors.
3. Run `python MD/tools/build_docs.py` and `python MD/tools/build_llms.py`;
   require clean navigation and generated discovery output.
4. Serve the bundled target and repeat mount, native/custom/recovery,
   persistence, import/export, keyboard, responsive, and unmount smoke tests.
5. Archive raw results, failures, console logs, screenshots, and environment
   metadata. Do not convert an unsupported acceptance item to passing because
   a related lower-scope check succeeded.

## Known gaps

There is no complete editor-native, standalone runtime-player, Publish,
collaboration, external-job, calibrated-field, scientific convergence,
reference-image, video-export, or cross-hardware performance suite. Real-device
WebGPU coverage is necessarily adapter-specific. These are product and
validation gaps, not reasons to weaken the current strict tests.

## Capability boundary

| Status | Test coverage |
| --- | --- |
| Implemented | Strict project/graph/sensor/Twin contracts, advanced-controller behavior, native state/runtime/renderer smoke pages, engine regressions, real app-native integration, and shader compilation. |
| Partial | Device-loss, memory pressure, stable-allocation, responsive, accessibility, and cross-device performance require manual and multi-environment evidence. |
| Unsupported | Certification of scientific accuracy and automated coverage for absent editor-native, Publish, collaboration, remote-job, full-field, video, and runtime-player features. |

## See also

- [Particle Studio Architecture](particle-studio-architecture.md)
- [Particle Recipe Schema](particle-recipe-schema.md)
- [Particle Studio Fidelity and Validation](particle-studio-fidelity-and-validation.md)
- [Particle Studio Performance](particle-studio-performance.md)
- [Particle Studio Integration Map](particle-studio-integration-map.md)
