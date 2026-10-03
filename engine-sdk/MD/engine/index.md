---
title: Engine
description: Section index for the engine — the WebGPU runtime foundation of the stack (overview, architecture, getting started, API reference).
updated: 2026-06-05
---

# Engine

The WebGPU runtime foundation of the stack. Source: `engine/`.

## In this section

- [Overview](overview.md) — what the engine is and its modules.
- [Architecture](architecture.md) — how core, ECS, render, sim, net, and gameplay compose.
- [Getting Started](getting-started.md) — bootstrap entry points and minimal flow.

### Deep dives

- [Shared NPC intelligence](shared-npc-intelligence.md) — actor-private tasks, evidence, persistence and admitted host integration.
- [Virtual GPU (vGPU)](vgpu.md) — the GPU abstraction every system builds on.
- [Managed Compute and WebAssembly](compute.md) — owned asynchronous jobs, approved math operations, Wasm variants, and reproducible builds.
- [ECS v2](ecs.md) — worlds, entities, components, systems, archetype storage.
- [Rendering](rendering.md) — the multi-pass pipeline, lighting, and compositing.
- [Tetrahedral Cage Lab](tetrahedral-cage-lab.md) — independent cage compilation and opt-in ray-tracing acceleration measurements.
- [MorphField R2](morphfield.md) — semantic fields, compiled Fieldlets, certified queries, assets, renderer contracts, and the gate-controlled delivery checklist.
- [Shaders & WGSL](shaders.md) — modular shaders, the composer, and the preprocessor.
- [Particle System](particles.md) — GPU particles, matter states, and the sim pipeline.
- [Adaptive Matter Continuum](adaptive-matter-continuum.md) — persistent packets, automatic fidelity, adaptive fluids, structural bonds, phase transcoding, conservation, and replay.
- [Galaxy Mythic Spiral Atlas](galaxy-mythic-spiral-atlas.md) — adaptive orbital tracers, dust extinction, and fantasy spiral studies.
- [Curl Noise Flow Atlas](curl-noise-flow-atlas.md) — packed GPU tracers and compute-density flow art.
- [Kuramoto Resonance Field](kuramoto-resonance-field.md) — CPU and GPU phase-oscillator labs with high-count HDR visualization.
- [Physics & Simulation](physics.md) — cloth, rope, fluids, and rigid bodies.
- [Surface Fields and Surface Lab](surface-fields.md) — conserved surface water, native pine coatings, material appearance, and exact owner checkpoints.
- [GPU Physics Engine](gpu-physics.md) — WebGPU compute physics with PhysX 5 parity.
- [Math Library](math.md) — 350+ pure vector/matrix/quaternion/packing functions.
- [Math Contract](math-contract.md) — required matrix, quaternion, projection, tolerance, and parity rules for shared math.
- [Audio](audio.md) — procedural node-graph synthesis and particle-driven sound.

### Reference

- **API Reference** — per-file symbol reference generated from source by `tools/extract_api.py` (browse `engine/reference/`).

## Module map

```text
engine/
  core/        GPU device, frame graph/pipeline, math, memory, scheduler, save, workers, ResourceManager
  ecs/         EntityManager, EntitySchema, ComponentHealer, components, systems, query, storage, prefabs, world
  render/      renderers, materials, passes, lighting, culling, post-process, sdf, volumes, particles
  sim/         SimulationUpdate + physics, particles, fluids, cloth, ai, world
  net/         protocol, replication, client, server
  collab/      multi-user mesh (identity, integrity, presence, sync)
  audio/       audio core, synth, spatial
  animation/   animation systems
  gameplay/    rules (RuleGraph), events (EventGraph), ai, narrative, perception
  voxel/ world/ voxel + world systems
  resources/   resource/package system
  mod/         scripting API + sandbox
  ui/ tools/   runtime UI, inspector/profiler
  compat/      asset importers / compatibility
```

## Related concepts

- [GPU Device Sharing](../concepts/gpu-device-sharing.md)
- [Data Flow](../concepts/data-flow.md)
