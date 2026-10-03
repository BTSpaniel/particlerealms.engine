---
title: Fabmax PhysX 5.11 public API review
description: A documented comparison of fabmax v2.8.0 and PhysX PE, with independently specified enhancement candidates.
updated: 2026-09-29
---

# Fabmax PhysX 5.11 public API review

This review compares the public interfaces of fabmax `physx-js-webidl` v2.8.0
with PhysX PE. It identifies useful additions without replacing the custom
runtime or importing upstream implementation changes.

## Release and scope

Fabmax published [v2.8.0 on September 27, 2026](https://github.com/fabmax/physx-js-webidl/releases/tag/v2.8.0),
upgrading its bindings to PhysX 5.11.0. PhysX PE already uses that SDK version.
The [tagged README](https://github.com/fabmax/physx-js-webidl/blob/v2.8.0/README.md)
documents browser WASM bindings for rigid bodies, joints, articulations,
vehicles, character controllers and serialization. It excludes CUDA.
Neither that feature list nor the release announcement establishes Blast,
WebGPU Flow, adaptive smoke resolution or unlimited physical detail.

Fabmax's [Kool engine](https://github.com/kool-engine/kool/blob/main/README.md)
documents WebGPU rendering and instanced geometry with levels of detail.
Those rendering features do not establish that its browser PhysX solver
executes on the GPU. The separate `webidl-util` project generates language
bindings; it is not a fluid solver.

## Review boundary and reproducibility

The review uses release metadata, the tagged README, public TypeScript and
WebIDL declarations, public issue descriptions and NVIDIA API documentation.
No upstream implementation patch or diff was imported into the new work.
The current PhysX PE runtime already contains licensed NVIDIA and fabmax code;
this review does not relabel that existing code as independently authored.
Existing licenses and notices remain required.

Publisher-verified release artifacts are staged in
`tmp/physx-fabmax-v2.8.0/`. `provenance.json` records asset URLs, byte counts and
SHA-256 hashes. The public API comparison can be repeated with:

```powershell
python artifacts/fabmax-physx-review-2026-09-29/compare_public_api.py
```

`artifacts/fabmax-physx-review-2026-09-29/api-name-comparison.json` records the
declaration inputs and their hashes.
The candidate declarations are generated from its current public IDL using
the repository's `tools/generate_physx_types.py`; they are byte-identical to
the installed `physx-pe.d.ts`. No candidate or installed binary is modified
by this comparison. Declaration presence is not an execution test.

Both inventories contain 384 classes. Fabmax additionally declares
`PxPerformanceEnvelope`; the local generator additionally declares `VoidPtr`.
The comparison also finds five method-name gaps, two property gaps and twenty
enum-member gaps. Many other reported signature differences only reflect
`unknown` versus the local `VoidPtr` type. `BaseVehicle` exists in both.

## Useful enhancement candidates

These are proposed additions, not newly enabled features. A separate native
build and executed tests must precede advertising them as supported.

| Public interface difference | Potential use in this stack | Required validation |
| --- | --- | --- |
| Rigid-body linear/angular acceleration getters and the body-acceleration scene flag | Measured motion diagnostics and sensor observations | Enable the flag at scene creation; test known force/mass and torque/inertia cases, disabled behavior, sleeping bodies and articulations. |
| Articulation drive envelopes and drive-parameter readback | Motors whose available effort changes with speed | Test effort/speed limits and preserve existing numeric-force drive construction. The public drive constructor differs between these declarations. |
| Gyroscopic-force control | Asymmetric spinning debris and rigid assemblies | Compare torque-free angular momentum and energy over multiple timesteps. A spherical baseball alone is not a useful asymmetric-inertia test. |
| Triangle-mesh geometry epsilon | Explicit ray/triangle query tolerance for imported meshes | Exercise ray hits at different metric scales and preserve the zero value's automatic default. |
| OmniPVD sampling-state and stop controls | Bounded diagnostic captures | Verify actual build support, start/stop ownership and cleanup before exposing UI controls. |

NVIDIA documents that rigid-dynamic acceleration getters need
[`eENABLE_BODY_ACCELERATIONS`](https://nvidia-omniverse.github.io/PhysX/physx/latest/_api_build/structPxSceneFlag.html).
The default is disabled, so adding getters alone would produce misleading zero
readings. These measurements also do not replace the contact impulses used
by the existing Blast stress adapter.

The name “performance envelope” describes motor effort versus speed. It is not
a frame-rate optimization. Some other enum differences concern GPU-specific
features; a declaration does not make CUDA available in browser WASM.

The query-tolerance meaning follows the pinned
[`PxTriangleMeshDesc` public declaration](https://github.com/NVIDIA-Omniverse/PhysX/blob/da950a3537927784951853c66618036f332ca0ce/physx/include/cooking/PxTriangleMeshDesc.h).
The [rigid-body flag documentation](https://nvidia-omniverse.github.io/PhysX/physx/5.6.1/_api_build/structPxRigidBodyFlag.html)
describes gyroscopic control. The pinned
[`PxOmniPvd` interface](https://github.com/NVIDIA-Omniverse/PhysX/blob/da950a3537927784951853c66618036f332ca0ce/physx/include/omnipvd/PxOmniPvd.h)
also specifies that stopping sampling does not flush or close the stream.

## Existing optimizations to retain

The upstream [batch-readback issue](https://github.com/fabmax/physx-js-webidl/issues/60)
is an open proposal, with author-reported microbenchmarks from another machine
and SDK build. It is not a merged v2.8.0 feature or evidence of an overall
frame-rate gain in this project.

PhysX PE already uses `engine/sim/PhysicsPoseReadback.js` and its Rust batch
adapter. Keep that ownership and cleanup path. Measure pose synchronization,
native collision solving, Flow GPU work and rendering separately before
claiming a new bottleneck or speedup.

The fire/smoke presentation work reuses this project's GPU quality governor
and `engine/core/gpu/ProgressiveTilePlanner.js`, shared with the Fractal app.
Paused rendering can refine every output pixel while preserving one completed
native field. This improves presentation sampling; it does not create unresolved
physical vortices or refine the native gas grid.

## Implementation rule

For an adopted feature, record its public behavior and tests first. Implement
the missing bridge in the existing first-party build layer, preserving current
APIs and resource ownership. Compare analytic results and observable behavior,
then run the normal native, browser, consumer and release checks. Keep the
PhysX PE name, Rust transfers, Blast and Flow extensions and license inventory.
Do not replace the custom WASM with the stock fabmax release.

## See also

- [Physics and simulation](physics.md)
- [GPU physics engine](gpu-physics.md)
- [Fabmax v2.8.0 release](https://github.com/fabmax/physx-js-webidl/releases/tag/v2.8.0)
- [Fabmax public declarations](https://github.com/fabmax/physx-js-webidl/releases/download/v2.8.0/physx-js-webidl.d.ts)
