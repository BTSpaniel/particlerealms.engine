---
title: Particle System
description: The engine's flagship GPU particle system — matter states, emitters, the per-frame compute pipeline, advanced subsystems (thermal, SPH, flocking, bonds), performance tricks, and rendering.
updated: 2026-09-05
---

# Particle System

The engine's flagship subsystem: large-scale GPU particles with physics, thermal simulation, chemistry, SPH fluids, SDF collision, flocking, and volumetric rendering. Everything runs on compute shaders via [vGPU](vgpu.md).

> **Scale:** the particle system spans 60+ simulation files and 30+ rendering files — the largest subsystem in the engine. This page covers the architecture and key concepts.

## Architecture

Three distinct layers:

```text
┌─────────────────────────────────────────────┐
│  Editor / Game API                           │
│  EditorParticles.js — orchestrates per-frame │
├─────────────────────────────────────────────┤
│  Rendering Layer (engine/render/particles/)  │
│  SDF Billboard · Half-Res Composite · Beams  │
│  Bonds · Decals · Distortion · Mesh · Trail  │
├─────────────────────────────────────────────┤
│  Simulation Layer (engine/sim/particles/)    │
│  ParticleSimWorld — main compute shader      │
│  + 30 advanced subsystems (GPU compute)      │
├─────────────────────────────────────────────┤
│  Emitter System (ParticleEmitterSystem.js)   │
│  Presets, spawn shapes, rate control         │
└─────────────────────────────────────────────┘
```

## Per-frame pipeline

Each frame in `EditorParticles.js`:

1. **Emit** — spawn new particles from active emitters into GPU buffers.
2. **Alive-list compaction** — a GPU scan writes alive particle indices (skip dead slots).
3. **Main sim** — GPU compute: gravity, curl noise, forces, integration, lifetime.
4. **Advanced systems** — thermal, SPH, flocking, bonds, chemistry, constraints.
5. **Sort** — radix sort by camera distance for correct alpha blending.
6. **Collisions** — SDF collision against entity meshes + ground plane.
7. **Light extraction** — GPU compute finds the hottest particles → async readback → `LightManager`.
8. **Render** — SDF billboard at half-res → additive composite onto the scene.

## Emitter system

`ParticleEmitterSystem.js` manages emitter presets and spawning.

### Matter states

| State | Phase value | Render mode | Examples |
| --- | --- | --- | --- |
| Solid | `0` | Matte diffuse + specular | Sparks, debris, snow |
| Liquid | `1` | Fresnel + refraction | Water, blood, rain |
| Gas | `2` | Volumetric (Beer-Lambert) | Smoke, steam, fog |
| Plasma | `3` | Emissive glow | Fire core, lightning, magic |

### Spawn shapes

`ParticleSpawnShapes.js` provides configurable emission geometries: **point**, **sphere** (surface or volume), **box**, **cone**, **ring** (torus), and **mesh surface** (emit from mesh triangles via `MeshToParticlesCompute.js`).

## GPU simulation

The core sim runs in `ParticleSimWorld.js` — a large compute shader processing all particles each frame. Buffer layout:

| Buffer | Per-particle data | Stride |
| --- | --- | --- |
| Position | `vec4(x, y, z, lifetime)` | 16 bytes |
| Velocity | `vec4(vx, vy, vz, age)` | 16 bytes |
| Thermal | `vec4(temperature, heat, packedMaterial, latentEnergy)` | 16 bytes |
| Color | `vec4(r, g, b, size)` | 16 bytes |

> **`thermalData.z` packing:** lower 8 bits = material index (0–15), upper bits = collision group ID. Encode: `(groupId << 8) | materialIdx`. Decode in WGSL: `materialIdx = u32(thermal.z) & 0xFFu`.

### Advanced subsystems

Initialized via `initAllAdvancedSystems()`:

- **Thermal & chemistry** — temperature with material-specific melt/boil points, latent heat, and phase transitions (16 material presets: water, metal, wax, lava, etc.).
- **SPH fluids** — smoothed-particle hydrodynamics (pressure, viscosity, surface tension).
- **SDF collision** — particles collide with entity meshes via signed distance fields (sphere/box/cylinder), per-entity SDF from `PrefabRegistry`.
- **Flocking** — boids (separation, alignment, cohesion) using a neighbor grid.
- **Bonds** — spring connections for soft-body/cloth-like behavior (async CPU readback for bond evaluation).
- **Electromagnetic** — electric/magnetic field forces, charged interactions.
- **Constraints** — distance/position/velocity constraints (rope, chains, attached particles).
- **Event system** — particle events (collision, death, threshold) that trigger sub-emissions or gameplay actions.

## Performance optimizations

- **Alive-list compaction** — a GPU scan builds an alive list of active indices; the main sim dispatches only `aliveCount` threads via indirect dispatch.
- **Radix sort** — 4-bit radix sort replaces bitonic. For 100M particles: 24 dispatches (8 passes × 3) vs ~289 for bitonic (`ParticleRadixSort.js`).
- **FBM noise pre-bake** — `ParticleNoiseTexture.js` first bakes three decorrelated vector-potential channels, then takes one periodic centered-difference curl on the volume lattice. The octave count follows grid resolution and tiling period to avoid undersampling; at period 16, 64³ uses two, 128³ uses three, and 256³ uses four. Configurations with fewer than two lattice samples per base-noise cell are rejected. Creation resolves WebGPU validation and out-of-memory scopes before exposing the resources. Runtime tracers use one filtered `textureSampleLevel` instead of evaluating procedural curl per particle. (Source: `engine/sim/particles/ParticleNoiseTexture.js`.)
- **Neighbor grid** — spatial-hash grid for O(1) neighbor queries (SPH, flocking, bonds), rebuilt each frame on GPU.
- **Selectable long-range solver** — direct, open-boundary FMM, periodic PME, or experimental periodic ESP. See [Particle Long-Range Solvers](particle-long-range.md) for the boundary and accuracy tradeoffs.
- **Particle Storm saturation benchmark** — the Playground's first and default demo targets 60 FPS presentation quality and grows population against a separately measured 30 FPS floor. Fifty million particles is a calibration waypoint, not a population ceiling; growth continues until measured frame pressure, WebGPU's 32-bit identity space, or an adapter allocation failure stops it. The baseline uses a 16-byte binary16-packed record while retaining `f32` arithmetic. Optional experiments compose in a fixed pipeline order independent of activation order: state storage, pressure handling, learned control, then HDR resolve. Experiments 2 and 5 select the 12-byte `particle-storm/kinematics-f16x6-v1` record: three `u32` words hold three half-float positions and three half-float velocities. A staggered simulation clock determines recycling by particle identity, so lifetime storage no longer consumes velocity precision. The previous signed 11-bit velocity encoding rounded small forces away on each 1/240 s step and produced visible straight lanes at high counts. The live-state sampler recognizes the new format separately and reports its unstored lifetime as unavailable. Experiment 5 continues to avoid the artifacting all-in-one 8-byte trial. A separate one-way 8-byte retained tier remains available to the pressure stage; it preserves analytic motion but no longer runs the full vortex/noise integration. Three 4-byte-aligned `u32` members retain a 12-byte storage stride. (Sources: `tests/playground/src/demos/particleStorm.js`, `tests/playground/src/demos/particleStormLiveStateSampler.js`.)

  The radial force and area-correct spawn distribution share a smooth bottom-to-top funnel profile. Stable per-identity radius variation gives the funnel thickness without collapsing every state onto one shell. This replaces the symmetric absolute-height profile that authored a straight-sided hourglass. Each selected state deposits one density equivalent, independent of age. Population-normalized density uses a rational shoulder, `d / (d + 4.5)`, to retain contrast as counts increase; a symmetric filter reduces pixel noise before the HDR presentation. (Source: `tests/playground/src/demos/particleStorm.js`.)

  Retained reconstruction is anchored to each stored position and initial velocity. It does not add an age-driven sinusoidal offset, and render-bank selection is stable for a particle identity instead of cycling its hue with age. The anisotropic page-moment renderer remains presentation-disabled until live pixel-temporal evidence certifies it, so unsafe or uncertified pages stay on canonical raw rendering. This removes synthetic motion and colour churn from memory-pressure handling without pretending that a statistical proxy is visually equivalent. (Source: `tests/playground/src/demos/particleStorm.js`.)

  The fused simulation/density pass feeds a recursive least-squares model of `GPU ms = fixed + simulation cost × simulated millions + raster cost × rendered millions`. The model remains advisory until samples vary independently in simulated count and render fraction, preventing a false split while both columns are identical at 100% rendering. Under pressure, the governor changes by no more than one 1/256 cohort per adjustment and never drops below 160/256, or 62.5%, rendered. Every complete 256-particle block contributes an exact quota selected by a hashed bit-reversal permutation. Storm holds the selection phase stable, preserving the same nested samples as the quota changes; partial blocks also receive an exact quota. This point-wise transition follows the continuous-LOD finding that gradual density changes are less irritating than chunk popping. An optional two-frame density-history blend suppresses residual noise and rejects history after sharp camera or mouse-force changes, following the temporal-stability motivation of spatiotemporal blue-noise work without introducing long TAA ghost trails.

  A single fullscreen pass resolves the density buffer to HDR, replacing tens of millions of point draws. The HDR path operates at 75% internal resolution, uses renderable `rg11b10ufloat` when available, and falls back to `rgba16float`. The density implementation supports one, two, four, or eight privatized banks, but defaults to the empirically faster single bank on the tested adapter; `stormBanks` remains a direct benchmark override. Backing storage grows only when active particles nearly fill existing primary capacity. Sustained pressure first lowers render quota, can transition a full-dynamics chunk to the retained tier, then retires particles gradually. (Sources: `tests/playground/src/demos/particleStorm.js`, `tests/playground/src/demos/particleStormTuning.js`, `tests/playground/src/core/experiments.js`, [WGSL structure and array layout](https://gpuweb.github.io/gpuweb/wgsl/#alignment-and-size), [WGSL data packing built-ins](https://gpuweb.github.io/gpuweb/wgsl/#pack-builtin-functions), [WebGPU supported limits](https://gpuweb.github.io/types/interfaces/GPUSupportedLimits.html), [MDN `GPUOutOfMemoryError`](https://developer.mozilla.org/en-US/docs/Web/API/GPUOutOfMemoryError), [TU Wien continuous point-cloud LOD](https://www.cg.tuwien.ac.at/research/publications/2019/schuetz-2019-CLOD/), [NVIDIA scalar spatiotemporal blue-noise masks](https://research.nvidia.com/publication/2021-12_scalar-spatiotemporal-blue-noise-masks), [Rendering Point Clouds with Compute Shaders](https://arxiv.org/abs/1908.02681), [Software Rasterization of 2 Billion Points in Real Time](https://arxiv.org/abs/2204.01287).)

- **Curl Noise Flow Atlas** — the Playground Curl demo reuses Storm's chunked allocation, two-dimensional dispatch, exact-quota point selection, timing governor, fused compute-density raster, short HDR history, glow, and tone mapping. It stores bounded position plus lifetime in two packed `u32` words, or 8 bytes per tracer, and derives velocity from the shared field. Four aggregate State-First emitter cohorts select point, splat, line, field, or low-mesh deposition without per-particle CPU objects or state removal. Five authored emitter and analytic-vortex studies provide composition without changing the uncapped measured-growth policy. See [Curl Noise Flow Atlas](curl-noise-flow-atlas.md) for measurement semantics and controls. (Sources: `tests/playground/src/demos/curlNoise.js`, `tests/playground/src/demos/curl/shaders.js`, `tests/playground/src/demos/curl/model.js`.)

- **Galaxy Mythic Spiral Atlas** — the Playground Galaxy demo stores one 4-byte orbital state per active tracer, advances every active orbit, and reuses Storm's exact-quota density selection and learned governor. Eight atomic planes separate old stars, young stars, H-II emission, and dust. Four aggregate population proxies plus the resolved field feed State-First buckets without reading orbital state back to the CPU; bucket quality modulates continuous deposition energy and never deletes a family. The HDR resolve applies exponential dust extinction before fantasy color grading. Five authored studies add bars, rings, a tidal wake, outer spurs, and a sparse polar veil without presenting the result as an N-body simulation. See [Galaxy Mythic Spiral Atlas](galaxy-mythic-spiral-atlas.md) for its art direction, measurement semantics, and scientific boundary. (Sources: `tests/playground/src/demos/galaxy.js`, `tests/playground/src/demos/galaxy/model.js`, `tests/playground/src/demos/galaxy/shaders.js`.)

## Rendering

The primary renderer (`ParticleSdfRenderer.js`) draws each particle as a camera-facing quad and raymarches a signed distance field in the fragment shader for volumetric shapes. The fragment shader branches by matter phase:

- **Solid (0)** — matte diffuse + subtle specular, opaque sphere.
- **Liquid (1)** — broad specular, Fresnel reflection, transparent center.
- **Gas (2)** — volumetric raymarch with Beer-Lambert transmittance, Henyey-Greenstein phase function, depth-based self-shadowing.
- **Plasma (3)** — pure emissive glow.

Lifetime effects modulate color/size/alpha via GPU textures: a `rgba8unorm` 1D color gradient (`textureSampleLevel`) and a `rgba32float` lifetime-curves texture (`textureLoad`, unfilterable). Hot particles use the Tanner Helland blackbody approximation (CIE 1931); very hot particles (`thermalGlow > 0.5`) get an emissive bloom boost.

Additional renderers: `ParticleBeamRenderer` (lasers/lightning), `ParticleBondRenderer` (springs), `ParticleDecalRenderer` (impact decals), `ParticleDistortionRenderer` (heat haze), `ParticleMeshRenderer` (mesh-shaped debris), `ParticleTrailHistory` (ribbons/trails), `ParticleSPHSurfaceRenderer` (screen-space fluid), `RopeGPURenderer` (rope/chain).

Adaptive particle presentation uses shared fail-closed foundations. `ParticlePresentationSourceStamp` separates topology and membership identity from telemetry sample cadence. `ParticleKinematicsSpatialPager` Morton-clusters positions before page formation, recursively subdivides unsafe covariance bounds, and leaves irreducible pages explicitly raw-owned. `ParticleVisualContinuityCertificate` compares canonical and candidate pixels across time for silhouette, centroid, edge, luminance, colour, energy, connected outliers, periodic-grid energy, flicker, and flash while binding the evidence to the live camera, shaders, target, exposure, device, history, and revisions. `ParticlePresentationTransitionCompositor` can promote only certified candidates at a frame boundary, keeps canonical presentation resident during a conserved blend, and immediately restores canonical rendering when evidence becomes stale or incompatible. None of these presentation contracts grants simulation authority. (Sources: `engine/render/morphfield/systems/ParticlePresentationSourceStamp.js`, `engine/matter/codec/ParticleKinematicsSpatialPager.js`, `engine/render/morphfield/systems/ParticleVisualContinuityCertificate.js`, `engine/render/morphfield/systems/ParticlePresentationTransitionCompositor.js`.)

## Audio integration

`ParticleAudioBridge.js` maps particle substance properties (temperature, density, velocity) to procedural audio parameters — fire crackles, water splashes, and wind howls are generated from particle state, with no pre-recorded samples.

## Key files

| File | Purpose |
| --- | --- |
| `sim/particles/ParticleSimWorld.js` | Core GPU compute sim |
| `sim/particles/ParticleEmitterSystem.js` | Emitter presets and spawning |
| `sim/particles/ParticleAdvanced.js` | Advanced subsystem orchestration |
| `sim/particles/ParticleFMM.js` | Open-boundary uniform-octree FMM |
| `sim/particles/ParticleMeshEwald.js` | Periodic PME and experimental ESP |
| `sim/particles/ParticleConstraints.js` | Distance/position constraints |
| `render/particles/ParticleSdfRenderer.js` | SDF billboard rendering |
| `render/particles/ParticleHalfResComposite.js` | Half-res compositing |
| `render/shaders/modules/core/particles_sdf_billboard.js` | Main SDF particle shader |
| `editor/js/modules/EditorParticles.js` | Per-frame orchestration |

## See also

- [Adaptive Matter Continuum](adaptive-matter-continuum.md) — hierarchical packet ownership, automatic fidelity, adaptive SPH, sparse fields, real bond fracture, phase transcoding, conservation, and replay.
- [Kuramoto Resonance Field](kuramoto-resonance-field.md) — a phase-oscillator lab that reuses compute-density and HDR rendering principles while keeping its real oscillator count separate from stateless visual samples.
- [Curl Noise Flow Atlas](curl-noise-flow-atlas.md) — adaptive procedural-flow art with packed tracers and compute-density rendering.
- [Galaxy Mythic Spiral Atlas](galaxy-mythic-spiral-atlas.md) — adaptive orbital-tracer art with physical dust attenuation and five fantasy studies.
- [Particle Long-Range Solvers](particle-long-range.md)
- [Physics and Simulation](physics.md)
