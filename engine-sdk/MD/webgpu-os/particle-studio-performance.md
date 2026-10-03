---
title: Particle Studio Performance
description: Runtime selection, resource ownership, bounded readback, adaptive quality, and measurement guidance.
audience: users, performance reviewers, and app developers
updated: 2026-07-14
---

# Particle Studio Performance

Particle Realms Studio chooses a runtime from granted browser and device
capabilities. Particle count alone is not a performance guarantee, and no
single frame-rate claim applies across modes, GPUs, browsers, display sizes,
or quality profiles. Report measured results together with their runtime path
and configuration. (Sources:
`webgpu-os/factory/apps/particles/ParticleApp.js`,
`webgpu-os/factory/apps/shared/GpuLabRuntime.js`)

This page is for developers and reviewers who tune Studio or publish measured
performance results.

## Runtime tiers

| Tier | Selection | Performance boundary |
| --- | --- | --- |
| Native engine | Mapped mode, eligible count, required exports, known device limits, and at least ten storage buffers per shader stage. | Steps `ParticleSimWorld` systems and renders the borrowed native position buffer. |
| Custom WGSL | WebGPU is available but the native mapping, eligibility, or native limit is unavailable. | Runs the preset's lightweight app model with an app-owned HDR pipeline. |
| Canvas 2D recovery | WebGPU initialization or recovery is unavailable. | Draws 5,000 generic points for continuity; the selected model is inactive. |

The app first considers an OS-shared GPU device. If native eligibility needs a
limit the shared device lacks, it may request a dedicated device for the app's
WebGPU fallback. A shared device is never destroyed by the app. (Sources:
`webgpu-os/factory/apps/particles/ParticleApp.js`,
`webgpu-os/factory/apps/shared/GpuLabRuntime.js`)

## Native eligibility and ceilings

The seven native-mapped modes are Galaxy and Orbital Clusters (`n-body`),
Flocking Ribbons (`flocking`), Cohesive Fluid (`sph`), Reaction Chamber
(`chemistry`), Magnetosphere (`electromagnetic`), and Molecular Lattice
(`lennard-jones`). Native CPU seed-state creation has a one-million-particle
hard bound. N-body profiles declare a 100,000-state bound, while the
interactive app further caps Galaxy and Orbital Clusters native selection at
10,000 because their current pairwise solve is expensive. All bounds remain
subject to the granted device limits. (Sources:
`webgpu-os/factory/apps/particles/ParticleNativeState.js`,
`webgpu-os/factory/apps/particles/ParticleApp.js`)

Other catalog modes are not native-connected and use the custom WGSL path.
The catalog macro permits counts up to ten million, but project normalization
and the tier selector clamp to the active runtime's recommended maximum.
(Sources: `webgpu-os/factory/apps/particles/ParticleLabCatalog.js`,
`webgpu-os/factory/apps/particles/ParticleApp.js`)

## GPU limits and ownership

`ParticleNativeRuntime` derives its hard maximum from granted storage-buffer,
buffer-size, dispatch, and workgroup limits and requires
`maxStorageBuffersPerShaderStage >= 10`. Initialization fails closed when
required native exports, limits, buffers, or configuration are invalid.
(Source: `webgpu-os/factory/apps/particles/ParticleNativeRuntime.js`)

The native runtime owns its `ParticleSimWorld` and readback staging buffers.
The native renderer owns its pipelines, bind groups, and uniforms but borrows
the world's position buffer. Teardown drains pending readback, destroys owned
world and renderer resources, and leaves a borrowed shared `GPUDevice` alive.
(Sources: `webgpu-os/factory/apps/particles/ParticleNativeRuntime.js`,
`webgpu-os/factory/apps/particles/ParticleNativeRenderer.js`)

## Direct rendering and readback

Native presentation binds one 16-byte `vec4<f32>` position record per particle
and renders additive LDR billboards without copying positions into a second
app simulation buffer. The renderer reports no HDR or trail capability. The
custom path instead stores 48 bytes of particle state and uses the app's HDR
compute/render/tone pipeline. (Sources:
`webgpu-os/factory/apps/particles/ParticleNativeRenderer.js`,
`webgpu-os/factory/apps/particles/ParticleApp.js`)

Advanced workspaces request a native sample no more often than every 500 ms in
Create, Analyze, or Compare. Each automatic sample is capped at
4,096 particles; each requested vector stream allocates exactly count × 16
bytes. The result is labeled `native-readback` and reports truncation. This is
bounded inspection, not full particle-state readback. (Sources:
`webgpu-os/factory/apps/particles/ParticleApp.js`,
`webgpu-os/factory/apps/particles/ParticleNativeRuntime.js`)

## Quality profiles

| Profile | View scale | View rate | Max secondary views | Sensor-rate scale | Trails | Post quality |
| --- | ---: | ---: | ---: | ---: | --- | ---: |
| Economy | 0.5 | 5 Hz | 1 | 0.5 | off | 0.35 |
| Interactive | 0.7 | 15 Hz | 3 | 1 | on | 0.7 |
| High | 1 | 30 Hz | 5 | 1 | on | 1 |
| Cinematic | 1 | 60 Hz | 7 | 1 | on | 1.25 |

The current advanced UI applies the maximum-secondary-view policy and optional
view quality behavior. Not every profile field controls every native/custom
solver or renderer feature yet. In particular, the native renderer reports no
trails even when the authored profile permits them. (Sources:
`webgpu-os/factory/apps/particles/ParticleQualityGovernor.js`,
`webgpu-os/factory/apps/particles/ParticleStudioAdvanced.js`,
`webgpu-os/factory/apps/particles/ParticleNativeRenderer.js`)

Automatic quality uses a 45-sample frame window by default, at least 15
samples before a decision, a two-second cooldown, and separate degrade and
upgrade thresholds around a 4..100 ms target. It changes one profile at a
time. Critical memory pressure selects Economy; moderate pressure caps the
profile at Interactive. Studio currently has the pressure API but no complete
automatic OS memory-pressure feed. (Source:
`webgpu-os/factory/apps/particles/ParticleQualityGovernor.js`)

## Measurements and attribution

The app records observed FPS, frame duration, queue-submit duration, measured
GPU duration when supplied, particle count, and allocated particle bytes at an
approximately 500 ms reporting cadence. History is bounded and missing values
remain missing. (Sources:
`webgpu-os/factory/apps/particles/ParticleApp.js`,
`webgpu-os/factory/apps/particles/ParticleLabTelemetry.js`)

Stage attribution accepts explicit `solver`, `sensor`, `view`, `post`,
`preview`, and `readback` timings. It does not infer a decomposition from
total frame time. Until instrumentation supplies a stage, its summary remains
empty. (Source:
`webgpu-os/factory/apps/particles/ParticleQualityGovernor.js`)

## Device loss and recovery

Device loss logs the reason, destroys GPU-owned state, preserves the authored
project, activates the generic Canvas 2D recovery preview, and exposes retry.
Recovery mode should be reported as a different runtime, never as an equivalent
performance result for the selected model. (Source:
`webgpu-os/factory/apps/particles/ParticleApp.js`)

## Performance report checklist

Record the browser and version, OS, GPU/driver, display and canvas size, device
kind (shared or dedicated), granted limits, preset and seed, recipe signature,
runtime backend, particle count, fixed step/substeps, quality profile, sample
duration, warm-up, FPS/frame-time distribution, submit/GPU measurements when
available, memory estimate, readback activity, and any device loss or fallback.
Compare like-for-like runs and publish raw samples with the summary. Avoid
marketing a best frame as sustained performance.

## Capability boundary

| Status | Performance capability |
| --- | --- |
| Implemented | Capability-based runtime selection, strict native limits, shared-device ownership, direct native position rendering, bounded readback, measured runtime telemetry, four quality profiles, hysteresis/cooldown, and device-loss recovery. |
| Partial | Quality policy currently governs optional views more completely than solver/render state; memory-pressure handling requires a caller; profiler stages require supplied measurements. |
| Unsupported | Universal hardware claims, complete pass/draw/dispatch attribution, automatic benchmark matrix, full-state chart readback, performance-equivalent recovery preview, and guaranteed allocation-free playback without measurement. |

## See also

- [Particle Studio Architecture](particle-studio-architecture.md)
- [Particle Studio Telemetry](particle-studio-telemetry.md)
- [Particle Studio Test Plan](particle-studio-test-plan.md)
- [Particle Studio Fidelity and Validation](particle-studio-fidelity-and-validation.md)
